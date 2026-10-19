// Pedidos — fase P1 de SPEC_PEDIDOS.md (2026-10-19).
//
// Nació de un encargo real («¿qué tan rápido me podrías fabricar un Phoenix Navy Issue?»). Un
// pedido es QUÉ fabricar, CUÁNTO, PARA QUIÉN y PARA CUÁNDO; la sección junta TODOS los pedidos
// activos y los cruza con lo que ya tienes para contestar la pregunta que de verdad importa con
// varios clientes: **qué puedo empezar ya, y qué me falta para el resto**.
//
// El cálculo es el motor de Fabricación (mismas fórmulas, mismos bonos de ficha), en
// `pedidosPlan.ts`. Rust solo guarda los pedidos. Lo que esta fase NO hace —de dónde sacar cada
// cosa que falta, lotes con su redondeo conjunto, slots y fechas— se dice en pantalla: son P2 y P3.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr, getLang } from "./i18n";
import { fmtIsk, fmtSp, typeIcon } from "./format";
import { Kpi } from "./charts";
import { loadJson } from "./staticJson";
import { loadNewEden } from "./neweden";
import { parseIskShorthand, iskCorto } from "./isk";
import { AnclarPiloto } from "./notas";
import { makeBonosFor, makeTimeFor } from "./industry";
import {
  programar,
  INDUSTRY_SKILL,
  ADV_INDUSTRY_SKILL,
  MASS_PRODUCTION,
  ADV_MASS_PRODUCTION,
  type Fabricante,
  type Calendario,
  type FechaPedido,
} from "./pedidosCalendario";
import { ObtencionBlock } from "./pedidosObtencion";
import type { Tab } from "./constants";
import type { BpIndustry, BpTree, IndustryRigs, Facility } from "./industry";
import type { Blueprint } from "./types";

/** P4: un job sin entregar, tal como lo devuelve `orders_wip`. */
type WipJob = {
  job_id: number;
  character_id: number;
  activity_id: number;
  product_type_id: number | null;
  blueprint_type_id: number;
  runs: number;
  status: string | null;
  end_date: string | null;
};
import {
  planOrders,
  sortOrders,
  ACTIVE,
  type ProductionOrder,
  type OrderStatus,
  type OwnedBp,
  type OrderPlan,
  type NeedLine,
} from "./pedidosPlan";

type MType = { i: number; n: string; g: number };
type StockRow = { type_id: number; quantity: number; location_id: number };

/** La misma clave que el panel de Fabricación: la última instalación elegida es una preferencia,
 *  y si ya calculas en un Sotiyo allí, aquí empiezas en el mismo. */
const PICK_KEY = "koru_bom_facility";
/** P3: tamaño máximo de cada parte de un job largo, en horas (0 = no trocear). Preferencia. */
const CHUNK_KEY = "koru_ped_trozo";

const STATUS: { k: OrderStatus; label: string }[] = [
  { k: "pending", label: "Pendiente" },
  { k: "in_progress", label: "En curso" },
  { k: "ready", label: "Listo" },
  { k: "delivered", label: "Entregado" },
  { k: "cancelled", label: "Cancelado" },
];

const VACIO: ProductionOrder = {
  id: null,
  client_name: "",
  client_char_id: null,
  product_type_id: 0,
  product_name: "",
  qty: 1,
  due_date: null,
  price: null,
  priority: 0,
  status: "pending",
  note: null,
};

/** Días hasta la fecha de entrega (negativo = pasada). null sin fecha. */
function diasHasta(d: string | null): number | null {
  if (!d) return null;
  const t = Date.parse(`${d}T23:59:59Z`);
  if (!isFinite(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
}

export function PedidosSection({
  subject,
  onIr,
  onDonde,
}: {
  subject: number | "global";
  /** Abrir otra sección (las vías de obtención enlazan a la que resuelve cada material). */
  onIr: (t: Tab) => void;
  /** Abrir Assets buscando ese nombre: «¿dónde lo tengo?». */
  onDonde: (nombre: string) => void;
}) {
  const es = getLang() === "es";
  const [orders, setOrders] = useState<ProductionOrder[] | null>(null);
  const [ind, setInd] = useState<BpIndustry | null>(null);
  const [tree, setTree] = useState<BpTree | null>(null);
  const [ir, setIr] = useState<IndustryRigs | null>(null);
  const [names, setNames] = useState<Map<number, string>>(new Map());
  const [grupos, setGrupos] = useState<Map<number, number>>(new Map());
  const [vols, setVols] = useState<Map<number, number>>(new Map());
  const [sys, setSys] = useState<{ id: number; n: string; s: number }[] | null>(null);
  const [facs, setFacs] = useState<Facility[] | null>(null);
  const [bps, setBps] = useState<Blueprint[] | null>(null);
  const [stockRows, setStockRows] = useState<StockRow[] | null>(null);
  const [prices, setPrices] = useState<Map<number, number>>(new Map());
  const [pick, setPick] = useState<number | null>(() => {
    try {
      const v = Number(localStorage.getItem(PICK_KEY));
      return v > 0 ? v : null;
    } catch {
      return null;
    }
  });
  const [form, setForm] = useState<ProductionOrder | null>(null);
  const [abierto, setAbierto] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  // P3 — calendario: skills de todos tus personajes, jobs de fabricación en marcha y el troceo.
  const [chars, setChars] = useState<Fabricante[] | null>(null);
  /** P4: jobs de fabricación/reacción sin entregar (BD local que llena el auto_sync). */
  const [wipJobs, setWipJobs] = useState<WipJob[] | null>(null);
  const [chunkH, setChunkH] = useState<number>(() => {
    try {
      const v = localStorage.getItem(CHUNK_KEY);
      return v != null && !isNaN(Number(v)) ? Number(v) : 24;
    } catch {
      return 24;
    }
  });
  const [verTodos, setVerTodos] = useState(false);

  const recargar = () =>
    invoke<ProductionOrder[]>("orders_list")
      .then(setOrders)
      .catch((e) => {
        console.error("orders_list", e);
        setOrders([]);
      });

  useEffect(() => {
    void recargar();
    loadJson<BpIndustry>("/bp_industry.json", {} as BpIndustry).then(setInd);
    loadJson<BpTree | null>("/bp_tree.json", null).then(setTree);
    loadJson<IndustryRigs | null>("/industry_rigs.json", null).then(setIr);
    loadJson<MType[]>("/market_types.json", []).then((m) => {
      setNames(new Map(m.map((t) => [t.i, t.n])));
      setGrupos(new Map(m.map((t) => [t.i, t.g])));
    });
    loadJson<Record<string, number>>("/type_volumes.json", {}).then((d) =>
      setVols(new Map(Object.entries(d).map(([k, v]) => [Number(k), v]))),
    );
    loadNewEden()
      .then((d) => setSys(d.systems))
      .catch(() => setSys([]));
    invoke<Facility[]>("facility_list").then(setFacs).catch(() => setFacs([]));
  }, []);

  // Planos y stock dependen del sujeto: en Global cuentan todos tus personajes.
  useEffect(() => {
    setBps(null);
    setStockRows(null);
    const b =
      subject === "global"
        ? invoke<Blueprint[]>("get_blueprints_global")
        : invoke<Blueprint[]>("get_blueprints", { characterId: subject });
    b.then(setBps).catch(() => setBps([]));
    const s =
      subject === "global"
        ? invoke<StockRow[]>("get_assets_detail_global")
        : invoke<StockRow[]>("get_assets_detail", { characterId: subject });
    s.then(setStockRows).catch(() => setStockRows([]));
  }, [subject]);

  const nameOf = (tid: number) => names.get(tid) ?? `#${tid}`;

  // Índices del catálogo: producto → plano (solo publicados) y producto → fórmula de reacción.
  const { bpByProduct, reactByProduct } = useMemo(() => {
    const m = new Map<number, string>();
    const r = new Map<number, string>();
    for (const [bid, v] of Object.entries(ind ?? {})) {
      if (v.np) continue; // ver BpIndustry.np: un plano que no existe en el juego no es una rama
      const out = v.m?.out?.[0]?.[0];
      if (out != null) m.set(out, bid);
      const ro = v.r?.out?.[0]?.[0];
      if (ro != null) r.set(ro, bid);
    }
    return { bpByProduct: m, reactByProduct: r };
  }, [ind]);

  // Lo que se puede pedir: todo producto con plano publicado.
  const productos = useMemo(
    () =>
      [...bpByProduct.keys()]
        .map((tid) => ({ tid, n: names.get(tid) ?? "" }))
        .filter((p) => p.n)
        .sort((a, b) => a.n.localeCompare(b.n)),
    [bpByProduct, names],
  );

  // Tus planos: mejor ME por plano; si alguno es original, sin límite de runs; si no, la suma de
  // las runs que te quedan en las copias.
  const owned = useMemo(() => {
    const m = new Map<number, OwnedBp>();
    for (const b of bps ?? []) {
      const cur = m.get(b.type_id) ?? { me: b.me, te: b.te, bpo: false, runs: 0 };
      cur.me = Math.max(cur.me, b.me);
      cur.te = Math.max(cur.te, b.te);
      if (b.runs === -1) cur.bpo = true;
      else if (b.runs > 0) cur.runs += b.runs;
      m.set(b.type_id, cur);
    }
    return m;
  }, [bps]);

  const usable = useMemo(() => (facs ?? []).filter((f) => f.eligible && f.has_mfg), [facs]);
  const st = useMemo(() => usable.find((f) => f.id === pick) ?? null, [usable, pick]);
  const sec = useMemo(() => {
    if (!st) return null;
    return (sys ?? []).find((x) => x.id === st.system_id)?.s ?? null;
  }, [st, sys]);
  const bonosFor = useMemo(() => makeBonosFor(st, ir, sec, es), [st, ir, sec, es]);
  const timeFor = useMemo(() => makeTimeFor(st, ir, sec), [st, ir, sec]);

  const stockAll = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of stockRows ?? []) m.set(r.type_id, (m.get(r.type_id) ?? 0) + r.quantity);
    return m;
  }, [stockRows]);
  const stockHere = useMemo(() => {
    if (stockRows == null || st?.structure_id == null) return null;
    const m = new Map<number, number>();
    for (const r of stockRows)
      if (r.location_id === st.structure_id) m.set(r.type_id, (m.get(r.type_id) ?? 0) + r.quantity);
    return m;
  }, [stockRows, st?.structure_id]);

  // P4: lo que está en el horno. Se relee al entrar y cada 5 minutos (el auto_sync lo refresca
  // cada 30, así que esto basta para que un job recién lanzado salga de la cola sin recargar).
  useEffect(() => {
    let vivo = true;
    const cargar = () =>
      invoke<WipJob[]>("orders_wip")
        .then((r) => vivo && setWipJobs(r))
        .catch(() => vivo && setWipJobs([]));
    void cargar();
    const t = window.setInterval(cargar, 5 * 60 * 1000);
    return () => {
      vivo = false;
      window.clearInterval(t);
    };
  }, []);
  const wip = useMemo(() => {
    const m = new Map<number, { units: number; fin: number }[]>();
    if (!ind) return m;
    const ahora = Date.now();
    for (const j of wipJobs ?? []) {
      if (j.product_type_id == null) continue;
      // Con un personaje elegido, solo sus jobs (igual que el stock); en Global, todos.
      if (subject !== "global" && j.character_id !== subject) continue;
      const b = ind[String(j.blueprint_type_id)];
      const act = j.activity_id === 1 ? b?.m : b?.r;
      const porRun = act?.out?.[0]?.[1] ?? 1;
      const fin = j.end_date ? Date.parse(j.end_date) : ahora;
      if (!m.has(j.product_type_id)) m.set(j.product_type_id, []);
      m.get(j.product_type_id)!.push({ units: j.runs * porRun, fin: isFinite(fin) ? fin : ahora });
    }
    return m;
  }, [wipJobs, ind, subject]);

  const listo = orders != null && ind != null && bps != null && stockRows != null && wipJobs != null;
  const plan = useMemo(() => {
    if (!listo) return null;
    return planOrders({
      orders: orders!,
      ind: ind!,
      tree,
      bpByProduct,
      reactByProduct,
      owned,
      bonosFor,
      stockHere,
      stockAll,
      wip,
    });
  }, [listo, orders, ind, tree, bpByProduct, reactByProduct, owned, bonosFor, stockHere, stockAll, wip]);

  // Precio medio de lo que falta (estimación: P2 decidirá comprar/minar/PI con su precio de hub).
  useEffect(() => {
    if (!plan) return;
    const ids = [...new Set([...plan.missingTotal.keys(), ...plan.bringTotal.keys()])];
    if (ids.length === 0) return;
    invoke<Record<number, number>>("get_type_prices", { ids })
      .then((r) => setPrices(new Map(Object.entries(r).map(([k, v]) => [Number(k), v]))))
      .catch(() => setPrices(new Map()));
  }, [plan]);

  const iskDe = (m: Map<number, number>) => {
    let s = 0;
    let sinPrecio = 0;
    for (const [tid, q] of m) {
      const p = prices.get(tid);
      if (p == null) sinPrecio++;
      else s += p * q;
    }
    return { s, sinPrecio };
  };
  const m3De = (m: Map<number, number>) => {
    let s = 0;
    for (const [tid, q] of m) s += (vols.get(tid) ?? 0) * q;
    return s;
  };

  async function guardar(o: ProductionOrder) {
    setError("");
    try {
      await invoke<number>("order_save", { order: o });
      await recargar();
      return true;
    } catch (e) {
      console.error("order_save", e);
      setError(String(e));
      return false;
    }
  }

  async function borrar(o: ProductionOrder) {
    if (o.id == null) return;
    if (!window.confirm(`${tr("¿Borrar el pedido de")} ${o.product_name}?`)) return;
    try {
      await invoke("order_delete", { id: o.id });
      await recargar();
    } catch (e) {
      console.error("order_delete", e);
      setError(String(e));
    }
  }

  const activos = (orders ?? []).filter((o) => ACTIVE.includes(o.status));
  const cerrados = (orders ?? []).filter((o) => !ACTIVE.includes(o.status));
  const planDe = new Map<number, OrderPlan>();
  for (const p of plan?.plans ?? []) if (p.order.id != null) planDe.set(p.order.id, p);

  const falta = plan ? iskDe(plan.missingTotal) : { s: 0, sinPrecio: 0 };
  const empezables = plan?.plans.filter((p) => p.canStart).length ?? 0;

  // P3: skills de TODOS tus personajes (velocidad, ranuras y las que piden los planos del plan) y
  // los jobs de fabricación que ya ocupan ranuras. Se cargan cuando hay plan.
  const skillIds = useMemo(() => {
    const s = new Set<number>([INDUSTRY_SKILL, ADV_INDUSTRY_SKILL, MASS_PRODUCTION, ADV_MASS_PRODUCTION]);
    for (const p of plan?.plans ?? [])
      for (const b of p.builds) for (const [sk] of ind?.[String(b.bp)]?.m?.sk ?? []) s.add(sk);
    return [...s].sort((a, b) => a - b);
  }, [plan, ind]);
  const skillKey = skillIds.join(",");
  useEffect(() => {
    if (!plan || plan.plans.length === 0) return;
    invoke<Fabricante[]>("get_skill_levels_all", { ids: skillKey.split(",").map(Number) })
      .then(setChars)
      .catch(() => setChars([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillKey]);

  const cal: Calendario | null = useMemo(() => {
    if (!plan || !ind || !chars || chars.length === 0) return null;
    // En Global se reparten entre todos; con un personaje elegido, solo entre él.
    const quien = subject === "global" ? chars : chars.filter((c) => c.character_id === subject);
    if (quien.length === 0) return null;
    const ahora = Date.now();
    // Ranuras de FABRICACIÓN ocupadas: los jobs de fabricación (actividad 1) que aún corren.
    const ocupado = new Map<number, number[]>();
    for (const j of wipJobs ?? []) {
      if (j.activity_id !== 1 || !j.end_date) continue;
      const fin = Date.parse(j.end_date);
      if (!(fin > ahora)) continue;
      if (!ocupado.has(j.character_id)) ocupado.set(j.character_id, []);
      ocupado.get(j.character_id)!.push(fin);
    }
    return programar({ plans: plan.plans, ind, tree, timeFor, chars: quien, ocupado, ahora, chunkH });
  }, [plan, ind, tree, chars, wipJobs, subject, timeFor, chunkH]);

  return (
    <div className="ped">
      <details className="fab-que">
        <summary>❓ {tr("Qué es esto")}</summary>
        <p className="small">
          {tr("Apunta lo que te encargan —qué, cuánto, para quién y para cuándo— y Koru junta todos los pedidos y los cruza con lo que ya tienes: tus planos, tus hangares y tu instalación. El que antes vence se lleva primero el stock, y el siguiente ve lo que queda.")}
        </p>
        <p className="small">
          {tr("Para cada pedido te dice si puedes empezarlo ya, qué jobs hay que lanzar y qué materiales faltan. Un componente se fabrica si tienes su plano; si no, sale como algo a conseguir. Lo que ya tienes hecho se usa antes de fabricar más, y lo que sobra de un job pasa al pedido siguiente.")}
        </p>
        <p className="small muted">
          {tr("Todavía no: de dónde sacar cada cosa que falta (comprar, minar, planetología, traer…), juntar los jobs de varios pedidos con su redondeo, y las fechas según tus slots. Llegan en las próximas fases.")}
        </p>
      </details>

      <div className="ped-barra">
        <label className="small">
          🏭 {tr("Calcular con la instalación")}{" "}
          <select
            value={st?.id ?? ""}
            onChange={(e) => {
              const v = Number(e.target.value) || null;
              setPick(v);
              try {
                if (v) localStorage.setItem(PICK_KEY, String(v));
              } catch {
                /* preferencia: si no se puede guardar, no pasa nada */
              }
            }}
          >
            <option value="">{tr("— sin instalación (solo ME) —")}</option>
            {usable.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <button className="pp-add" onClick={() => setForm({ ...VACIO })} disabled={!ind}>
          ＋ {tr("Nuevo pedido")}
        </button>
      </div>
      {st && stockHere == null && (
        <p className="muted small">
          {tr("Esta ficha no tiene estructura conocida: no se distingue lo que está en la instalación de lo que hay que traer.")}
        </p>
      )}

      {form && (
        <FormPedido
          inicial={form}
          productos={productos}
          onCancel={() => setForm(null)}
          onSave={async (o) => {
            if (await guardar(o)) setForm(null);
          }}
        />
      )}
      {error && <p className="ped-err small">{error}</p>}

      {!listo ? (
        <p className="muted">{tr("Cargando…")}</p>
      ) : activos.length === 0 && !form ? (
        <p className="muted">
          {tr("No hay pedidos activos. Pulsa «Nuevo pedido» para apuntar el primero.")}
        </p>
      ) : (
        <>
          <div className="kpis">
            <Kpi label={tr("Pedidos activos")} value={fmtSp(activos.length)} />
            <Kpi label={tr("Se pueden empezar ya")} value={fmtSp(empezables)} tone={empezables > 0 ? "pos" : undefined} />
            <Kpi label={tr("Tipos que faltan")} value={fmtSp(plan?.missingTotal.size ?? 0)} />
            <Kpi label={tr("Lo que falta (precio medio)")} value={`${fmtIsk(falta.s)}${falta.sinPrecio ? " *" : ""}`} />
            <Kpi label={tr("A traer de otros hangares")} value={`${fmtSp(Math.round(m3De(plan?.bringTotal ?? new Map())))} m³`} />
          </div>

          <h4>📋 {tr("Pedidos, en el orden en que se reparten el stock")}</h4>
          {sortOrders(activos).map((o) => {
            const p = o.id != null ? planDe.get(o.id) : undefined;
            const abi = o.id != null && abierto.has(o.id);
            return (
              <div key={o.id ?? 0} className={`ped-card${p?.canStart ? " ped-ok" : ""}`}>
                <div className="ped-cab">
                  <img className="kind-glyph" src={typeIcon(o.product_type_id, 32)} alt="" />
                  <button
                    className="linklike ped-titulo"
                    onClick={() => {
                      if (o.id == null) return;
                      const n = new Set(abierto);
                      if (n.has(o.id)) n.delete(o.id);
                      else n.add(o.id);
                      setAbierto(n);
                    }}
                  >
                    {abi ? "▾" : "▸"} {o.product_name} ×{fmtSp(o.qty)}
                  </button>
                  <span className="small">
                    {o.client_char_id != null ? (
                      <>
                        <img
                          className="ped-retrato"
                          src={`https://images.evetech.net/characters/${o.client_char_id}/portrait?size=32`}
                          alt=""
                        />{" "}
                        {o.client_name}
                      </>
                    ) : o.client_name ? (
                      o.client_name
                    ) : (
                      <span className="muted">{tr("pedido propio")}</span>
                    )}
                  </span>
                  <FechaEntrega d={o.due_date} />
                  {cal && o.id != null && <Eta f={cal.fechas.get(o.id)} due={o.due_date} />}
                  {o.price != null && <span className="small muted">{fmtIsk(o.price)}</span>}
                  <span className="ped-estado">
                    <PlanBadge p={p} />
                    {/* P4: Koru PROPONE el cambio de estado con lo que ve; el clic es tuyo. Un
                        producto en tu hangar puede ser tuyo y no del cliente: por eso no se marca solo. */}
                    {p?.enHangar && o.status !== "ready" && (
                      <button className="pp-add small ped-sugiere" onClick={() => guardar({ ...o, status: "ready" })}>
                        ✔ {tr("Marcar listo")}
                      </button>
                    )}
                    {p && !p.enHangar && o.status === "pending" && p.enMarcha.length > 0 && (
                      <button className="pp-add small ped-sugiere" onClick={() => guardar({ ...o, status: "in_progress" })}>
                        ▶ {tr("Marcar en curso")}
                      </button>
                    )}
                  </span>
                  <span className="ped-acciones">
                    <button className="pp-add small" title={tr("Subir prioridad")} onClick={() => guardar({ ...o, priority: o.priority + 1 })}>
                      ▲
                    </button>
                    <button className="pp-add small" title={tr("Bajar prioridad")} onClick={() => guardar({ ...o, priority: o.priority - 1 })}>
                      ▼
                    </button>
                    <select
                      className="small"
                      value={o.status}
                      onChange={(e) => guardar({ ...o, status: e.target.value as OrderStatus })}
                    >
                      {STATUS.map((s) => (
                        <option key={s.k} value={s.k}>
                          {tr(s.label)}
                        </option>
                      ))}
                    </select>
                    <button className="pp-add small" onClick={() => setForm({ ...o })}>
                      ✎
                    </button>
                    <button className="pp-add small" onClick={() => borrar(o)}>
                      🗑
                    </button>
                  </span>
                </div>
                {o.priority !== 0 && (
                  <p className="muted small ped-nota">
                    {tr("Prioridad manual")}: {o.priority > 0 ? `+${o.priority}` : o.priority}
                  </p>
                )}
                {o.note && <p className="small ped-nota">{o.note}</p>}
                {abi && p && <DetallePlan p={p} nameOf={nameOf} prices={prices} />}
              </div>
            );
          })}

          {plan && plan.buildTotal.size > 0 && (
            <CalendarioBlock
              cal={cal}
              cargando={chars == null}
              chunkH={chunkH}
              setChunkH={(v) => {
                setChunkH(v);
                try {
                  localStorage.setItem(CHUNK_KEY, String(v));
                } catch {
                  /* preferencia */
                }
              }}
              verTodos={verTodos}
              setVerTodos={setVerTodos}
              nameOf={nameOf}
              conInstalacion={st != null}
            />
          )}

          {plan && plan.buildTotal.size > 0 && (
            <>
              <h4>🔧 {tr("Fabricar en total")}</h4>
              <p className="muted small">
                {tr("Los jobs de todos los pedidos sumados por producto. Cuando un componente lo piden varios pedidos, aquí se ve junto; el redondeo conjunto en un solo job llega con la fase de lotes.")}
              </p>
              <table className="km-table cat-table">
                <thead>
                  <tr>
                    <th>{tr("Producto")}</th>
                    <th className="num">{tr("Runs")}</th>
                    <th className="num">{tr("Unidades")}</th>
                    <th className="num">{tr("Pedidos")}</th>
                    <th>{tr("Plano")}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...plan.buildTotal]
                    .sort((a, b) => b[1].runs - a[1].runs)
                    .map(([tid, v]) => (
                      <tr key={tid}>
                        <td>
                          <img className="kind-glyph" src={typeIcon(tid, 32)} alt="" /> {nameOf(tid)}
                        </td>
                        <td className="num">{fmtSp(v.runs)}</td>
                        <td className="num">{fmtSp(v.units)}</td>
                        <td className="num">{v.orders}</td>
                        <td className="small">{v.owned ? "✓" : <span className="ped-aviso">{tr("no lo tienes")}</span>}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </>
          )}

          {plan && plan.missingTotal.size > 0 && (
            <ObtencionBlock
              missing={plan.missingTotal}
              reacciones={
                new Set(plan.plans.flatMap((p) => p.needs.filter((n) => n.kind === "reaction").map((n) => n.tid)))
              }
              nameOf={nameOf}
              groupOf={(t) => grupos.get(t) ?? null}
              vols={vols}
              subject={subject}
              onIr={onIr}
            />
          )}
          {plan && plan.bringTotal.size > 0 && (
            <TablaTipos
              titulo={`📦 ${tr("Lo tienes, pero en otro sitio: hay que traerlo")}`}
              nota={tr("Stock tuyo que los pedidos usan y que no está en la instalación elegida.")}
              m={plan.bringTotal}
              nameOf={nameOf}
              prices={prices}
              vols={vols}
              onDonde={onDonde}
            />
          )}
        </>
      )}

      {cerrados.length > 0 && (
        <details className="ped-cerrados">
          <summary className="small">
            {tr("Pedidos cerrados")} ({cerrados.length})
          </summary>
          <table className="km-table cat-table">
            <tbody>
              {cerrados.map((o) => (
                <tr key={o.id ?? 0}>
                  <td>
                    <img className="kind-glyph" src={typeIcon(o.product_type_id, 32)} alt="" /> {o.product_name} ×{fmtSp(o.qty)}
                  </td>
                  <td className="small">{o.client_name || tr("pedido propio")}</td>
                  <td className="small">{tr(STATUS.find((s) => s.k === o.status)?.label ?? o.status)}</td>
                  <td className="small">{o.price != null ? fmtIsk(o.price) : ""}</td>
                  <td>
                    <select
                      className="small"
                      value={o.status}
                      onChange={(e) => guardar({ ...o, status: e.target.value as OrderStatus })}
                    >
                      {STATUS.map((s) => (
                        <option key={s.k} value={s.k}>
                          {tr(s.label)}
                        </option>
                      ))}
                    </select>{" "}
                    <button className="pp-add small" onClick={() => borrar(o)}>
                      🗑
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

function FechaEntrega({ d }: { d: string | null }) {
  const n = diasHasta(d);
  if (d == null || n == null) return <span className="small muted">{tr("sin fecha")}</span>;
  const cls = n < 0 ? "ped-tarde" : n <= 3 ? "ped-justo" : "muted";
  const txt = n < 0 ? `${tr("vencido hace")} ${-n} ${tr("d")}` : n === 0 ? tr("vence hoy") : `${tr("en")} ${n} ${tr("d")}`;
  return (
    <span className={`small ${cls}`} title={d}>
      📅 {d} · {txt}
    </span>
  );
}

function PlanBadge({ p }: { p: OrderPlan | undefined }) {
  if (!p) return null;
  if (p.enHangar) return <span className="ped-si small">📦 {tr("Ya está en tus hangares")}</span>;
  if (p.noRecipe) return <span className="ped-aviso small">⚠ {tr("no hay plano que lo fabrique")}</span>;
  const enHorno = p.enMarcha.length;
  if (p.canStart)
    return (
      <span className="ped-si small">
        {enHorno > 0 && <span className="ped-horno">🏭 {enHorno} {tr("en marcha")} · </span>}✅{" "}
        {p.builds.length === 0 ? tr("Solo falta que acaben los jobs") : tr("Se puede empezar")}
      </span>
    );
  const faltan = p.needs.filter((n) => n.missing > 0).length;
  return (
    <span className="small">
      {enHorno > 0 && <span className="ped-horno">🏭 {enHorno} {tr("en marcha")} · </span>}
      {!p.rootOwned && <span className="ped-aviso">⚠ {tr("sin el plano (estimado con ME 0)")} · </span>}
      {p.shortRuns.length > 0 && <span className="ped-aviso">⚠ {tr("copia sin runs suficientes")} · </span>}
      {faltan > 0 ? (
        <span className="ped-no">
          ❌ {tr("faltan")} {faltan} {tr("materiales")}
        </span>
      ) : (
        <span className="ped-no">❌ {tr("faltan planos")}</span>
      )}
    </span>
  );
}

const KIND_LABEL: Record<NeedLine["kind"], string> = {
  leaf: "",
  reaction: "⚗️ sale de reacción",
  "build-no-bp": "🔧 fabricable si tuvieras el plano",
};

function DetallePlan({
  p,
  nameOf,
  prices,
}: {
  p: OrderPlan;
  nameOf: (t: number) => string;
  prices: Map<number, number>;
}) {
  const faltan = p.needs.filter((n) => n.missing > 0);
  const tienes = p.needs.filter((n) => n.missing === 0);
  return (
    <div className="ped-detalle">
      {p.covered.some((c) => c.fromHere + c.fromElsewhere > 0) && (
        <p className="small">
          ♻️ {tr("Ya lo tienes hecho")}:{" "}
          {p.covered
            .filter((c) => c.fromHere + c.fromElsewhere > 0)
            .map((c) => `${nameOf(c.tid)} ×${fmtSp(c.fromHere + c.fromElsewhere)}`)
            .join(" · ")}
        </p>
      )}
      {p.enMarcha.length > 0 && (
        <p className="small">
          🏭 {tr("En marcha (jobs ya lanzados)")}:{" "}
          {p.enMarcha
            .map((w) => `${nameOf(w.tid)} ×${fmtSp(w.units)} (${w.fin > Date.now() ? `${tr("acaba")} ${fechaCorta(w.fin)}` : tr("listo para recoger")})`)
            .join(" · ")}
        </p>
      )}
      {p.builds.length > 0 && (
        <>
          <h5>🔧 {tr("Jobs de este pedido")}</h5>
          <table className="km-table cat-table">
            <thead>
              <tr>
                <th>{tr("Producto")}</th>
                <th className="num">{tr("Runs")}</th>
                <th className="num">ME</th>
                <th>{tr("Plano")}</th>
              </tr>
            </thead>
            <tbody>
              {p.builds.map((b, i) => (
                <tr key={`${b.tid}-${i}`}>
                  <td style={{ paddingLeft: `${0.4 + b.depth * 1}rem` }}>
                    <img className="kind-glyph" src={typeIcon(b.tid, 32)} alt="" /> {nameOf(b.tid)}
                  </td>
                  <td className="num">{fmtSp(b.runs)}</td>
                  <td className="num">{b.me}</td>
                  <td className="small">
                    {!b.owned ? (
                      <span className="ped-aviso">{tr("no lo tienes")}</span>
                    ) : b.bpRuns === Infinity ? (
                      tr("original")
                    ) : (
                      `${tr("copia")} · ${fmtSp(b.bpRuns)} ${b.bpRuns === 1 ? "run" : tr("runs")}`
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {p.shortRuns.length > 0 && (
        <p className="small ped-aviso">
          ⚠ {p.shortRuns.map((s) => `${nameOf(s.tid)}: ${tr("hacen falta")} ${s.need} runs, ${tr("quedan")} ${s.have}`).join(" · ")}
        </p>
      )}
      {faltan.length > 0 && (
        <>
          <h5>❌ {tr("Lo que falta para este pedido")}</h5>
          <table className="km-table cat-table">
            <thead>
              <tr>
                <th>{tr("Material")}</th>
                <th className="num">{tr("Necesita")}</th>
                <th className="num">{tr("En la instalación")}</th>
                <th className="num">{tr("En otro sitio")}</th>
                <th className="num">{tr("Falta")}</th>
                <th className="num">{tr("Precio medio")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {faltan
                .sort((a, b) => (prices.get(b.tid) ?? 0) * b.missing - (prices.get(a.tid) ?? 0) * a.missing)
                .map((n) => (
                  <tr key={n.tid}>
                    <td>
                      <img className="kind-glyph" src={typeIcon(n.tid, 32)} alt="" /> {nameOf(n.tid)}
                    </td>
                    <td className="num">{fmtSp(n.need)}</td>
                    <td className="num">{n.fromHere ? fmtSp(n.fromHere) : ""}</td>
                    <td className="num">{n.fromElsewhere ? fmtSp(n.fromElsewhere) : ""}</td>
                    <td className="num ped-no">{fmtSp(n.missing)}</td>
                    <td className="num">{prices.has(n.tid) ? fmtIsk((prices.get(n.tid) ?? 0) * n.missing) : "—"}</td>
                    <td className="small muted">{KIND_LABEL[n.kind] ? tr(KIND_LABEL[n.kind]) : ""}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}
      {tienes.length > 0 && (
        <p className="small muted">
          ✓ {tr("Cubierto con tu stock")}: {tienes.map((n) => `${nameOf(n.tid)} ×${fmtSp(n.need)}`).join(" · ")}
        </p>
      )}
    </div>
  );
}

function TablaTipos({
  titulo,
  nota,
  m,
  nameOf,
  prices,
  vols,
  onDonde,
}: {
  titulo: string;
  nota: string;
  m: Map<number, number>;
  nameOf: (t: number) => string;
  prices: Map<number, number>;
  vols: Map<number, number>;
  onDonde?: (nombre: string) => void;
}) {
  const filas = [...m].sort((a, b) => (prices.get(b[0]) ?? 0) * b[1] - (prices.get(a[0]) ?? 0) * a[1]);
  let isk = 0;
  let m3 = 0;
  for (const [tid, q] of filas) {
    isk += (prices.get(tid) ?? 0) * q;
    m3 += (vols.get(tid) ?? 0) * q;
  }
  return (
    <>
      <h4>{titulo}</h4>
      <p className="muted small">
        {nota} {fmtSp(filas.length)} {tr("tipos")} · {fmtIsk(isk)} · {fmtSp(Math.round(m3))} m³
      </p>
      <table className="km-table cat-table">
        <thead>
          <tr>
            <th>{tr("Material")}</th>
            <th className="num">{tr("Cantidad")}</th>
            <th className="num">m³</th>
            <th className="num">{tr("Precio medio")}</th>
            {onDonde && <th></th>}
          </tr>
        </thead>
        <tbody>
          {filas.map(([tid, q]) => (
            <tr key={tid}>
              <td>
                <img className="kind-glyph" src={typeIcon(tid, 32)} alt="" /> {nameOf(tid)}
              </td>
              <td className="num">{fmtSp(q)}</td>
              <td className="num">{vols.has(tid) ? fmtSp(Math.round((vols.get(tid) ?? 0) * q)) : "—"}</td>
              <td className="num">{prices.has(tid) ? fmtIsk((prices.get(tid) ?? 0) * q) : "—"}</td>
              {onDonde && (
                <td>
                  <button className="linklike small" onClick={() => onDonde(nameOf(tid))}>
                    📍 {tr("Ver dónde")}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function FormPedido({
  inicial,
  productos,
  onCancel,
  onSave,
}: {
  inicial: ProductionOrder;
  productos: { tid: number; n: string }[];
  onCancel: () => void;
  onSave: (o: ProductionOrder) => void;
}) {
  const [o, setO] = useState<ProductionOrder>(inicial);
  const [q, setQ] = useState(inicial.product_name);
  const [precio, setPrecio] = useState(iskCorto(inicial.price));
  const [anclar, setAnclar] = useState(false);

  const sugerencias = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2 || (o.product_type_id && o.product_name === q)) return [];
    const empieza = productos.filter((p) => p.n.toLowerCase().startsWith(t));
    const contiene = productos.filter((p) => !p.n.toLowerCase().startsWith(t) && p.n.toLowerCase().includes(t));
    return [...empieza, ...contiene].slice(0, 12);
  }, [q, productos, o.product_type_id, o.product_name]);

  const precioNum = parseIskShorthand(precio);
  const precioMal = precio.trim() !== "" && precioNum == null;
  const valido = o.product_type_id > 0 && o.qty > 0 && !precioMal;

  return (
    <div className="ped-form">
      <h4>{o.id == null ? `＋ ${tr("Nuevo pedido")}` : `✎ ${tr("Editar pedido")}`}</h4>
      <div className="ped-form-fila">
        <label>
          {tr("Producto")}
          <input
            type="search"
            value={q}
            placeholder={tr("Escribe el nombre (p. ej. Hammerhead II)")}
            onChange={(e) => {
              setQ(e.target.value);
              setO({ ...o, product_type_id: 0, product_name: "" });
            }}
            autoFocus
          />
        </label>
        {o.product_type_id > 0 && <img className="kind-glyph" src={typeIcon(o.product_type_id, 32)} alt="" />}
        <label>
          {tr("Cantidad")}
          <input
            type="number"
            min={1}
            value={o.qty}
            onChange={(e) => setO({ ...o, qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
            style={{ width: "6rem" }}
          />
        </label>
      </div>
      {sugerencias.length > 0 && (
        <div className="ped-sug">
          {sugerencias.map((p) => (
            <button
              key={p.tid}
              className="linklike small"
              onClick={() => {
                setO({ ...o, product_type_id: p.tid, product_name: p.n });
                setQ(p.n);
              }}
            >
              <img className="kind-glyph" src={typeIcon(p.tid, 32)} alt="" /> {p.n}
            </button>
          ))}
        </div>
      )}
      <div className="ped-form-fila">
        <label>
          {tr("Cliente")}
          <input
            type="text"
            value={o.client_name}
            placeholder={tr("vacío = pedido propio")}
            onChange={(e) => setO({ ...o, client_name: e.target.value, client_char_id: null })}
          />
        </label>
        {o.client_char_id != null ? (
          <span className="small ped-si">
            <img
              className="ped-retrato"
              src={`https://images.evetech.net/characters/${o.client_char_id}/portrait?size=32`}
              alt=""
            />{" "}
            ✓ {tr("piloto comprobado")}
          </span>
        ) : (
          <button className="pp-add small" onClick={() => setAnclar(!anclar)}>
            🔎 {tr("Buscar piloto de EVE")}
          </button>
        )}
      </div>
      {anclar && o.client_char_id == null && (
        <AnclarPiloto
          onPick={(id, nombre) => {
            setO({ ...o, client_char_id: id, client_name: nombre });
            setAnclar(false);
          }}
        />
      )}
      <div className="ped-form-fila">
        <label>
          {tr("Fecha de entrega")}
          <input
            type="date"
            value={o.due_date ?? ""}
            onChange={(e) => setO({ ...o, due_date: e.target.value || null })}
          />
        </label>
        <label>
          {tr("Precio acordado")}
          <input
            type="text"
            value={precio}
            placeholder={tr("opcional, p. ej. 5,2b")}
            onChange={(e) => setPrecio(e.target.value)}
            className={precioMal ? "ped-mal" : ""}
            style={{ width: "9rem" }}
          />
        </label>
      </div>
      <label className="ped-form-nota">
        {tr("Nota")}
        <input type="text" value={o.note ?? ""} onChange={(e) => setO({ ...o, note: e.target.value || null })} />
      </label>
      <div className="ped-form-fila">
        <button className="pp-add" disabled={!valido} onClick={() => onSave({ ...o, price: precioNum })}>
          💾 {tr("Guardar")}
        </button>
        <button className="pp-add" onClick={onCancel}>
          {tr("Cancelar")}
        </button>
        {!o.product_type_id && <span className="muted small">{tr("Elige el producto de la lista")}</span>}
      </div>
    </div>
  );
}

/** Fecha corta local: «24 oct 11:18». */
function fechaCorta(ms: number): string {
  return new Date(ms).toLocaleString(getLang() === "es" ? "es-ES" : "en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** La fecha estimada de un pedido, comparada con la de entrega. */
function Eta({ f, due }: { f: FechaPedido | undefined; due: string | null }) {
  if (!f) return null;
  if (f.fin == null)
    return (
      <span className="small ped-aviso" title={tr("Ninguno de tus personajes tiene las skills que piden algunos planos")}>
        ⏱ {tr("sin fabricante para")} {f.sinFabricante} {tr("jobs")}
      </span>
    );
  let veredicto: ReactNode = null;
  if (due) {
    const limite = Date.parse(`${due}T23:59:59Z`);
    if (isFinite(limite)) {
      const dias = Math.ceil((f.fin - limite) / 86_400_000);
      veredicto =
        f.fin <= limite ? (
          <span className="ped-si"> ✓</span>
        ) : (
          <span className="ped-no">
            {" "}
            · {dias} {tr("d tarde")}
          </span>
        );
    }
  }
  return (
    <span className="small" title={tr("Fecha estimada contando desde que tengas los materiales que faltan")}>
      ⏱ {tr("listo")} ~{fechaCorta(f.fin)}
      {veredicto}
    </span>
  );
}

function CalendarioBlock({
  cal,
  cargando,
  chunkH,
  setChunkH,
  verTodos,
  setVerTodos,
  nameOf,
  conInstalacion,
}: {
  cal: Calendario | null;
  cargando: boolean;
  chunkH: number;
  setChunkH: (v: number) => void;
  verTodos: boolean;
  setVerTodos: (v: boolean) => void;
  nameOf: (t: number) => string;
  conInstalacion: boolean;
}) {
  const LIMITE = 40;
  const jobs = cal?.jobs ?? [];
  const visibles = verTodos ? jobs : jobs.slice(0, LIMITE);
  const fin = jobs.length ? Math.max(...jobs.map((j) => j.fin)) : null;
  return (
    <>
      <h4>⏱ {tr("Calendario de fabricación")}</h4>
      <p className="muted small">
        {tr("Reparte los jobs de todos los pedidos entre tus personajes: cada uno con sus ranuras de fabricación (1 + Mass Production + Advanced Mass Production), descontando las que ya tienes ocupadas, y solo quien tiene las skills que pide el plano. Un job no empieza hasta que acaban sus componentes. Las fechas cuentan desde que tengas los materiales que faltan: ni las compras, ni la minería, ni el transporte entran todavía.")}
        {!conInstalacion && ` ${tr("Sin instalación elegida, las duraciones van sin bonos de estructura ni rigs.")}`}
      </p>
      <p className="small">
        {tr("Trocear jobs largos en partes de")}{" "}
        <select value={chunkH} onChange={(e) => setChunkH(Number(e.target.value))}>
          <option value={0}>{tr("no trocear")}</option>
          <option value={12}>12 h</option>
          <option value={24}>1 {tr("día")}</option>
          <option value={72}>3 {tr("días")}</option>
          <option value={168}>7 {tr("días")}</option>
        </select>
        {cal && (
          <span className="muted">
            {" "}
            ·{" "}
            {cal.ranuras
              .map((r) => `${r.name}: ${r.total} ${tr("ranuras")}${r.ocupadas ? ` (${r.ocupadas} ${tr("ocupadas")})` : ""}`)
              .join(" · ")}
          </span>
        )}
      </p>
      {cargando ? (
        <p className="muted small">{tr("Cargando…")}</p>
      ) : !cal ? (
        <p className="muted small">{tr("No hay personajes con las skills de fabricación cargadas para repartir los jobs.")}</p>
      ) : (
        <>
          {fin != null && (
            <p className="small">
              {fmtSp(jobs.length)} {tr("jobs")} · {tr("todo listo hacia")} <strong>{fechaCorta(fin)}</strong>
            </p>
          )}
          <table className="km-table cat-table">
            <thead>
              <tr>
                <th>{tr("Empieza")}</th>
                <th>{tr("Termina")}</th>
                <th>{tr("Producto")}</th>
                <th className="num">{tr("Runs")}</th>
                <th>{tr("Pedido")}</th>
                <th>{tr("Personaje")}</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((j, i) => (
                <tr key={i}>
                  <td className="small">{fechaCorta(j.inicio)}</td>
                  <td className="small">{fechaCorta(j.fin)}</td>
                  <td>
                    <img className="kind-glyph" src={typeIcon(j.tid, 32)} alt="" /> {nameOf(j.tid)}
                    {j.partes > 1 && <span className="muted small"> ({j.parte}/{j.partes})</span>}
                    {j.sinPlano && <span className="ped-aviso small"> · {tr("no lo tienes")}</span>}
                  </td>
                  <td className="num">{fmtSp(j.runs)}</td>
                  <td className="small">{j.orderName}</td>
                  <td className="small">
                    <img
                      className="ped-retrato"
                      src={`https://images.evetech.net/characters/${j.charId}/portrait?size=32`}
                      alt=""
                    />{" "}
                    {j.charName}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {jobs.length > LIMITE && (
            <button className="linklike small" onClick={() => setVerTodos(!verTodos)}>
              {verTodos ? tr("Ver menos") : `${tr("Ver los")} ${jobs.length} ${tr("jobs")}`}
            </button>
          )}
        </>
      )}
    </>
  );
}
