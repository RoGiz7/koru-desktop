// Pedidos — fase P3 (SPEC_PEDIDOS.md): ¿CUÁNDO? Reparte los jobs de todos los pedidos entre tus
// personajes y saca una fecha estimada por pedido. Puro (sin React ni invoke), para probarlo aparte.
//
// El modelo, y lo que NO modela (se dice en pantalla):
//   · Cada personaje tiene 1 + Mass Production + Advanced Mass Production ranuras de fabricación.
//     Las que ya están ocupadas por jobs en marcha quedan libres cuando esos acaban.
//   · Un job solo lo puede lanzar quien tiene las skills que pide el plano (el juego no le deja).
//   · Duración por run = t_base × (1 − TE/100) × Industry (−4 %/nivel) × Advanced Industry
//     (−3 %/nivel) × instalación (rigs que aplican + estructura). La fórmula de F1, verificada al
//     segundo contra el juego.
//   · Un job no empieza hasta que acaban los jobs de sus componentes (el árbol del plan).
//   · Los jobs largos se trocean en partes de como mucho `chunkH` horas para repartirlos entre
//     ranuras libres — es lo que hace cualquiera con 26 runs de componentes capitales.
//   · Reparto voraz: los pedidos en su orden (prioridad, fecha), dentro de cada uno primero los
//     componentes más profundos, y cada parte a la ranura que ANTES la termina.
//   · NO modela la llegada de materiales: las fechas cuentan desde que tengas lo que falta.
//     Tampoco el transporte, ni que el producto final se fabrique en otra instalación.

import type { BpIndustry, BpTree } from "./industry";
import type { OrderPlan } from "./pedidosPlan";

export const INDUSTRY_SKILL = 3380;
export const ADV_INDUSTRY_SKILL = 3388;
export const MASS_PRODUCTION = 3387;
export const ADV_MASS_PRODUCTION = 24625;

export type Fabricante = { character_id: number; name: string; levels: Record<number, number> };

export type JobProgramado = {
  orderId: number | null;
  orderName: string;
  tid: number;
  runs: number;
  /** Parte i de n (si el job se troceó). */
  parte: number;
  partes: number;
  charId: number;
  charName: string;
  inicio: number; // ms
  fin: number; // ms
  /** Plano que no tienes: la fila es una estimación (no se puede lanzar hoy). */
  sinPlano: boolean;
};

export type FechaPedido = {
  orderId: number | null;
  fin: number | null; // null = no se puede programar (nadie tiene las skills)
  /** Jobs de este pedido que nadie de tus personajes puede lanzar. */
  sinFabricante: number;
  jobs: number;
};

export type Calendario = {
  jobs: JobProgramado[];
  fechas: Map<number | null, FechaPedido>;
  /** Ranuras por personaje (total) y cuántas estaban ya ocupadas al empezar. */
  ranuras: { charId: number; name: string; total: number; ocupadas: number }[];
};

export type CalInput = {
  plans: OrderPlan[];
  ind: BpIndustry;
  tree: BpTree | null;
  /** Factor de la instalación por producto (rigs × estructura). */
  timeFor: (cat: number | null, grp: number | null) => number;
  chars: Fabricante[];
  /** Fin (ms) de cada job de FABRICACIÓN ya en marcha, por personaje. */
  ocupado: Map<number, number[]>;
  ahora: number;
  /** Tamaño máximo de cada parte, en horas (0 = no trocear). */
  chunkH: number;
};

export function ranurasDe(c: Fabricante): number {
  return 1 + (c.levels[MASS_PRODUCTION] ?? 0) + (c.levels[ADV_MASS_PRODUCTION] ?? 0);
}

export function skillFactor(c: Fabricante): number {
  return (1 - 0.04 * (c.levels[INDUSTRY_SKILL] ?? 0)) * (1 - 0.03 * (c.levels[ADV_INDUSTRY_SKILL] ?? 0));
}

export function programar(inp: CalInput): Calendario {
  const { plans, ind, tree, timeFor, chars, ahora } = inp;
  // Ranuras: una lista de «libre desde» por personaje.
  const slots = new Map<number, number[]>();
  const ranuras: Calendario["ranuras"] = [];
  for (const c of chars) {
    const total = ranurasDe(c);
    const busy = (inp.ocupado.get(c.character_id) ?? []).filter((t) => t > ahora).sort((a, b) => a - b);
    const libres: number[] = [];
    for (let i = 0; i < total; i++) libres.push(busy[i] ?? ahora);
    slots.set(c.character_id, libres);
    ranuras.push({ charId: c.character_id, name: c.name, total, ocupadas: Math.min(total, busy.length) });
  }

  const jobs: JobProgramado[] = [];
  const fechas = new Map<number | null, FechaPedido>();

  for (const p of plans) {
    const orderId = p.order.id;
    const fin = new Map<number, number>(); // índice de build → cuándo acaba (ms)
    let sinFabricante = 0;
    // Hijos primero: el más profundo antes. Con el mismo nivel, el orden del árbol.
    const orden = p.builds.map((b, i) => ({ b, i })).sort((a, z) => z.b.depth - a.b.depth || a.i - z.i);
    // Hijos de cada build, para saber cuándo puede empezar.
    const hijos = new Map<number, number[]>();
    p.builds.forEach((b, i) => {
      if (b.parent != null) {
        if (!hijos.has(b.parent)) hijos.set(b.parent, []);
        hijos.get(b.parent)!.push(i);
      }
    });

    for (const { b, i } of orden) {
      const act = ind[String(b.bp)]?.m;
      if (!act) continue;
      const req = act.sk ?? [];
      const capaces = chars.filter((c) => req.every(([s, lvl]) => (c.levels[s] ?? 0) >= lvl));
      const listo = Math.max(ahora, b.espera ?? 0, ...(hijos.get(i) ?? []).map((h) => fin.get(h) ?? ahora));
      if (capaces.length === 0) {
        sinFabricante++;
        fin.set(i, listo);
        continue;
      }
      const [cat, grp] = tree?.bp[String(b.bp)] ?? [null, null];
      const base = act.t * (1 - b.te / 100) * timeFor(cat, grp); // s por run, sin skills
      const mejorF = Math.min(...capaces.map(skillFactor));
      const durTotal = (base * mejorF * b.runs) / 3600; // horas con el más rápido
      const partes =
        inp.chunkH > 0 && durTotal > inp.chunkH ? Math.min(b.runs, Math.ceil(durTotal / inp.chunkH)) : 1;
      let acaba = listo;
      let resto = b.runs;
      for (let k = 0; k < partes; k++) {
        const runs = Math.ceil(resto / (partes - k));
        resto -= runs;
        // La ranura que ANTES termina esta parte (no la que antes empieza: un alt lento puede
        // empezar antes y acabar después).
        let mejor: { c: Fabricante; s: number; ini: number; fin: number } | null = null;
        for (const c of capaces) {
          const ls = slots.get(c.character_id)!;
          const dur = base * skillFactor(c) * runs * 1000;
          for (let s = 0; s < ls.length; s++) {
            const ini = Math.max(ls[s], listo);
            const f = ini + dur;
            if (!mejor || f < mejor.fin) mejor = { c, s, ini, fin: f };
          }
        }
        const m = mejor!;
        slots.get(m.c.character_id)![m.s] = m.fin;
        jobs.push({
          orderId,
          orderName: p.order.product_name,
          tid: b.tid,
          runs,
          parte: k + 1,
          partes,
          charId: m.c.character_id,
          charName: m.c.name,
          inicio: m.ini,
          fin: m.fin,
          sinPlano: !b.owned,
        });
        acaba = Math.max(acaba, m.fin);
      }
      fin.set(i, acaba);
    }
    // P4: si el producto (o parte) viene de un job ya en marcha, el pedido no está antes de eso.
    const finPedido = Math.max(p.builds.length ? Math.max(...[...fin.values()]) : ahora, p.esperaRaiz ?? 0);
    fechas.set(orderId, {
      orderId,
      fin: sinFabricante > 0 ? null : finPedido,
      sinFabricante,
      jobs: jobs.filter((j) => j.orderId === orderId).length,
    });
  }
  jobs.sort((a, b) => a.inicio - b.inicio || a.fin - b.fin);
  return { jobs, fechas, ranuras };
}
