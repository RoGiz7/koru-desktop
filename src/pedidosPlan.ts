// Pedidos — el MOTOR de la fase P1 (SPEC_PEDIDOS.md): demanda conjunta de varios pedidos contra tu
// stock. Puro (sin React ni invoke) para poder probarlo aparte con datos reales.
//
// Qué hace, en orden:
//   1. Ordena los pedidos ACTIVOS: prioridad manual (mayor primero) y, a igual prioridad, la fecha
//      de entrega (sin fecha, al final). El primero se lleva el stock que necesita; el siguiente ve
//      lo que queda. Es la regla que él eligió el 2026-10-19.
//   2. Para cada pedido baja por el árbol de materiales con las MISMAS fórmulas de Fabricación
//      (`matFactor`/`matQty`, verificadas contra el juego) y los bonos de la ficha elegida.
//   3. En CADA nodo, antes de fabricar, mira el stock: si ya tienes componentes hechos, se usan y no
//      se baja más por esa rama (es lo que haría cualquiera: no fabricas lo que ya tienes).
//   4. Un intermedio se FABRICA solo si tienes su plano. Si no, es una hoja: hay que conseguirlo
//      (comprarlo, minarlo… eso es la fase P2). El producto del pedido se despliega siempre, para
//      poder estimar aunque aún no tengas el plano — y se dice.
//   5. Lo que sobra de un job (una run da 3 y hacían falta 2) vuelve al stock para el pedido
//      siguiente.
//
// Lo que NO hace todavía (y se dice en pantalla): juntar lotes entre pedidos con su redondeo
// conjunto, slots, fechas (P3); decidir de dónde sale cada hoja (P2); reacciones como rama
// fabricable (aquí una entrada que sale de reacción es una hoja, marcada como tal).

import { matFactor, matQty } from "./industry";
import type { BpIndustry, BpTree, Bonos } from "./industry";

export type OrderStatus = "pending" | "in_progress" | "ready" | "delivered" | "cancelled";

export type ProductionOrder = {
  id: number | null;
  client_name: string;
  client_char_id: number | null;
  product_type_id: number;
  product_name: string;
  qty: number;
  due_date: string | null;
  price: number | null;
  priority: number;
  status: OrderStatus;
  note: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

/** Pedidos que entran al plan. Los listos, entregados y cancelados ya no piden material. */
export const ACTIVE: OrderStatus[] = ["pending", "in_progress"];

/** Tu mejor copia de cada plano: ME para el cálculo, y si es original o cuántas runs te quedan. */
export type OwnedBp = { me: number; bpo: boolean; runs: number };

export type PlanInput = {
  orders: ProductionOrder[];
  ind: BpIndustry;
  tree: BpTree | null;
  /** producto → plano que lo fabrica (solo publicados, actividad `m`). */
  bpByProduct: Map<number, string>;
  /** producto → fórmula de reacción (solo para ETIQUETAR la hoja; aquí no se reacciona). */
  reactByProduct: Map<number, string>;
  /** typeID del PLANO → tu mejor copia. */
  owned: Map<number, OwnedBp>;
  /** Bonos de la ficha por producto (null = sin ficha / sin planta: solo ME). */
  bonosFor: ((cat: number | null, grp: number | null) => Bonos) | null;
  /** Stock EN la instalación (null = ficha sin estructura conocida: no se distingue). */
  stockHere: Map<number, number> | null;
  /** Stock TOTAL de todas tus ubicaciones (incluye el de la instalación). */
  stockAll: Map<number, number>;
};

/** Un job a lanzar para un pedido. */
export type BuildLine = {
  tid: number;
  bp: number;
  runs: number;
  /** Unidades que salen (runs × salida por run). */
  units: number;
  /** ¿Tienes el plano? Si no, es una estimación con ME 0. */
  owned: boolean;
  me: number;
  /** Runs que te quedan si es copia (Infinity si es original). */
  bpRuns: number;
  depth: number;
};

/** Un material que hace falta: lo que sale del stock y lo que falta. */
export type NeedLine = {
  tid: number;
  need: number;
  fromHere: number;
  /** Sale de tu stock pero está en OTRO sitio: hay que traerlo. */
  fromElsewhere: number;
  missing: number;
  /** Cómo se podría conseguir lo que falta, para etiquetar (la decisión es P2). */
  kind: "leaf" | "reaction" | "build-no-bp";
};

export type OrderPlan = {
  order: ProductionOrder;
  builds: BuildLine[];
  /** Hojas (lo que no se fabrica): materiales a conseguir o ya en stock. */
  needs: NeedLine[];
  /** Producto o componentes que ya tenías hechos y cubren parte del pedido. */
  covered: NeedLine[];
  /** ¿Tienes el plano del producto final? */
  rootOwned: boolean;
  /** Ninguna hoja falta y todos los planos son tuyos: puedes empezar YA. */
  canStart: boolean;
  /** Algún plano es copia y no le quedan runs suficientes. */
  shortRuns: { bp: number; tid: number; need: number; have: number }[];
  /** El catálogo no sabe fabricar el producto (no hay plano publicado). */
  noRecipe: boolean;
};

export type PlanResult = {
  plans: OrderPlan[];
  /** Todo lo que falta entre todos los pedidos, por tipo. */
  missingTotal: Map<number, number>;
  /** Todo lo que hay que traer de otro sitio, por tipo. */
  bringTotal: Map<number, number>;
  /** Jobs sumados por producto entre todos los pedidos (runs y unidades), con cuántos pedidos. */
  buildTotal: Map<number, { runs: number; units: number; orders: number; owned: boolean }>;
};

const MAX_DEPTH = 12;

/** Orden de reparto del stock: prioridad manual, luego fecha (sin fecha al final), luego el id. */
export function sortOrders(orders: ProductionOrder[]): ProductionOrder[] {
  return [...orders].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const da = a.due_date ?? "9999-99-99";
    const db = b.due_date ?? "9999-99-99";
    if (da !== db) return da < db ? -1 : 1;
    return (a.id ?? 0) - (b.id ?? 0);
  });
}

export function planOrders(inp: PlanInput): PlanResult {
  const { ind, tree, bpByProduct, reactByProduct, owned, bonosFor } = inp;
  // Pools mutables: el stock se va GASTANDO pedido a pedido. El de la instalación primero.
  const here = new Map(inp.stockHere ?? []);
  const all = new Map(inp.stockAll);
  // Lo que «no está aquí» = total − instalación (si se conoce la instalación).
  const elsewhere = new Map<number, number>();
  for (const [tid, q] of all) {
    const h = inp.stockHere?.get(tid) ?? 0;
    const e = q - h;
    if (e > 0) elsewhere.set(tid, e);
  }
  // Sin instalación conocida, todo el stock cuenta como «aquí»: no se puede distinguir, y decir
  // «tráelo» de algo que quizá ya está ahí sería inventar un viaje.
  if (inp.stockHere == null) {
    here.clear();
    for (const [tid, q] of all) here.set(tid, q);
    elsewhere.clear();
  }
  // Runs de copia que se van consumiendo entre pedidos.
  const runsLeft = new Map<number, number>();
  for (const [bp, o] of owned) runsLeft.set(bp, o.bpo ? Infinity : o.runs);

  const take = (tid: number, qty: number) => {
    const h = Math.min(here.get(tid) ?? 0, qty);
    if (h > 0) here.set(tid, (here.get(tid) ?? 0) - h);
    const e = Math.min(elsewhere.get(tid) ?? 0, qty - h);
    if (e > 0) elsewhere.set(tid, (elsewhere.get(tid) ?? 0) - e);
    return { h, e, rest: qty - h - e };
  };

  const plans: OrderPlan[] = [];
  const missingTotal = new Map<number, number>();
  const bringTotal = new Map<number, number>();
  const buildTotal = new Map<number, { runs: number; units: number; orders: number; owned: boolean }>();

  for (const order of sortOrders(inp.orders.filter((o) => ACTIVE.includes(o.status)))) {
    const builds: BuildLine[] = [];
    const needs = new Map<number, NeedLine>();
    const covered = new Map<number, NeedLine>();
    const shortRuns: OrderPlan["shortRuns"] = [];
    const rootBp = bpByProduct.get(order.product_type_id) ?? null;
    const rootOwned = rootBp != null && owned.has(Number(rootBp));

    const addTo = (m: Map<number, NeedLine>, tid: number, kind: NeedLine["kind"], need: number, h: number, e: number, rest: number) => {
      const cur = m.get(tid) ?? { tid, need: 0, fromHere: 0, fromElsewhere: 0, missing: 0, kind };
      cur.need += need;
      cur.fromHere += h;
      cur.fromElsewhere += e;
      cur.missing += rest;
      m.set(tid, cur);
    };

    const walk = (tid: number, qty: number, depth: number) => {
      if (qty <= 0) return;
      // 1) Stock primero, en cualquier nivel (también el producto final ya hecho).
      const { h, e, rest } = take(tid, qty);
      const bp = bpByProduct.get(tid) ?? null;
      const bpOwned = bp != null && owned.has(Number(bp));
      // ¿Se fabrica? El raíz siempre (para estimar); un intermedio solo si el plano es tuyo.
      const build = bp != null && (depth === 0 || bpOwned) && depth < MAX_DEPTH;
      if (!build) {
        const kind: NeedLine["kind"] = reactByProduct.has(tid)
          ? "reaction"
          : bp != null
            ? "build-no-bp"
            : "leaf";
        addTo(needs, tid, kind, qty, h, e, rest);
        return;
      }
      if (h + e > 0) addTo(covered, tid, "leaf", h + e, h, e, 0);
      if (rest <= 0) return;
      const act = ind[bp]?.m;
      if (!act) return;
      const outQty = act.out?.[0]?.[1] ?? 1;
      const runs = Math.ceil(rest / outQty);
      const ob = owned.get(Number(bp));
      const me = ob?.me ?? 0;
      const [c, g] = tree?.bp[bp] ?? [null, null];
      const f = matFactor(me, bonosFor ? bonosFor(c, g) : null);
      // Copias: ¿quedan runs?
      const left = runsLeft.get(Number(bp));
      if (left != null && left !== Infinity) {
        if (left < runs) shortRuns.push({ bp: Number(bp), tid, need: runs, have: left });
        runsLeft.set(Number(bp), Math.max(0, left - runs));
      }
      builds.push({
        tid,
        bp: Number(bp),
        runs,
        units: runs * outQty,
        owned: bpOwned,
        me,
        bpRuns: ob ? (ob.bpo ? Infinity : ob.runs) : 0,
        depth,
      });
      // Lo que sobra de la última run vuelve al stock de la instalación (se fabrica ahí).
      const surplus = runs * outQty - rest;
      if (surplus > 0) here.set(tid, (here.get(tid) ?? 0) + surplus);
      for (const [mt, base] of act.in) walk(mt, matQty(base, runs, f), depth + 1);
    };

    walk(order.product_type_id, order.qty, 0);

    const needList = [...needs.values()];
    for (const n of needList) {
      if (n.missing > 0) missingTotal.set(n.tid, (missingTotal.get(n.tid) ?? 0) + n.missing);
      if (n.fromElsewhere > 0) bringTotal.set(n.tid, (bringTotal.get(n.tid) ?? 0) + n.fromElsewhere);
    }
    for (const c of covered.values())
      if (c.fromElsewhere > 0) bringTotal.set(c.tid, (bringTotal.get(c.tid) ?? 0) + c.fromElsewhere);
    // Un mismo componente puede colgar de dos ramas del MISMO pedido: cuenta como un pedido.
    const vistos = new Set<number>();
    for (const b of builds) {
      const cur = buildTotal.get(b.tid) ?? { runs: 0, units: 0, orders: 0, owned: b.owned };
      cur.runs += b.runs;
      cur.units += b.units;
      if (!vistos.has(b.tid)) cur.orders += 1;
      vistos.add(b.tid);
      buildTotal.set(b.tid, cur);
    }
    const allOwned = builds.every((b) => b.owned);
    plans.push({
      order,
      builds,
      needs: needList,
      covered: [...covered.values()],
      rootOwned,
      canStart: rootBp != null && allOwned && shortRuns.length === 0 && needList.every((n) => n.missing === 0),
      shortRuns,
      noRecipe: rootBp == null,
    });
  }
  return { plans, missingTotal, bringTotal, buildTotal };
}
