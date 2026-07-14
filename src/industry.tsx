// Sección Industria: trabajos de producción activos (estado y tiempo restante) por personaje o global.
// Extraído de App.tsx. fmtRemain (formatea el tiempo restante de un job) es interno.
import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr, getLang } from "./i18n";
import { fmtSp, fmtIsk, bpIcon, typeIcon } from "./format";
import { Kpi } from "./charts";
import type { JobView, Blueprint } from "./types";

/** public/bp_tree.json — categoría y grupo de INVENTARIO del PRODUCTO de cada blueprint, con
 *  nombres ES/EN del SDE. Es la jerarquía que usa el cliente de EVE en su ventana de planos.
 *  (El árbol de MERCADO de planos NO vale: mete los supercarriers dentro de "Carriers" — la Nyx
 *  salía como portanave. Cazado por RoGi7 y verificado en EVE Ref.) */
type BpTree = {
  bp: Record<string, [number, number]>; // blueprintTypeID → [categoríaID, grupoID]
  cat: Record<string, { es: string; en: string }>;
  grp: Record<string, { es: string; en: string }>;
};

/* ---------- F1a: árbol BOM ---------- */

/** public/bp_industry.json (R3): actividad → tiempo, insumos [[tid,qty]], producto, skills. */
type BpAct = { t: number; in: [number, number][]; out: number[][] };
type BpIndustry = Record<string, { m?: BpAct; i?: BpAct; r?: BpAct; c?: number; max?: number }>;
/** Catálogo de nombres (public/market_types.json). Los ítems se muestran en INGLÉS a propósito. */
type MType = { i: number; n: string; g: number };

/** public/industry_rigs.json (SDE): bonos de industria de las estructuras Upwell y de sus rigs.
 *  Estructura: FACTORES ya listos (0.99 = −1 %). Rig: % BASE negativo, a multiplicar por la
 *  seguridad. `scope` = nombre del efecto del SDE (p. ej. "AllShipManufacture"): dice a qué aplica. */
type IndustryRigs = {
  /** Grupos donde ENTRA la Standup Manufacturing Plant I, leídos de sus propios `canFitShipGroupNN`:
   *  1657 Citadel · 1404 Engineering Complex · 1406 Refinery. Fuera de ahí no se fabrica, punto. */
  mfg_groups: number[];
  /** Toda estructura publicada → su grupo. Sirve para descartar las que no pueden fabricar. */
  kinds: Record<string, { n: { es: string; en: string }; g: number; gn: string }>;
  structures: Record<
    string,
    { n: { es: string; en: string }; mat: number | null; cost: number | null; time: number | null; slots: number; size: number }
  >;
  rigs: Record<
    string,
    {
      n: { es: string; en: string };
      mat: number;
      time: number;
      cost: number;
      sec: { hi?: number; low?: number; null?: number };
      size: number;
      scope: string | null;
    }
  >;
};

/** Ficha de instalación (tabla `facility`). Es el registro del fabricante: idea de RoGi7, y nace de
 *  un hecho concreto — los rigs y los servicios de una estructura NO se ven in-game si no eres
 *  Director, y ESI tampoco los da. Así que no hay nada que deducir: lo declara quien lo sabe.
 *  Aquí NO se guardan porcentajes; los bonos se derivan del SDE con `type_id` y `rigs` al calcular. */
type Facility = {
  id: number;
  structure_id: number | null;
  name: string;
  system_id: number;
  type_id: number | null;
  has_mfg: boolean;
  rigs: number[];
  tax: number;
  eligible: boolean;
  source: string; // 'esi' descubierta · 'manual' escrita a mano
  notes: string | null;
};
const PICK_KEY = "koru_bom_facility"; // última elegida: preferencia de UI, no dato
/** Recargo de la CCS: 4 % del VEO, global del juego y NO configurable (verificado: 11.196 de 279.893). */
const CCS_SURCHARGE = 0.04;

/** A qué CATEGORÍA de producto aplica cada alcance de rig. **Solo los que podemos afirmar.**
 *  `AllShipManufacture` → Nave está VERIFICADO con el fixture (Bantam, categoría 6 → 20.307 exactos).
 *  Los que no están aquí (los de tamaño concreto: Small/Medium/Large/Cap, componentes…) se marcan
 *  «sin mapear» y NO se aplican: preferimos quedarnos cortos y decirlo, a inventar un bono. */
const SCOPE_CAT: Record<string, number[]> = {
  AllShipManufacture: [6], // Nave
  EquipmentManufacture: [7], // Módulo
  AmmoManufacture: [8], // Carga
  DroneManufacture: [18, 87], // Dron y Caza
  StructureManufacture: [65], // Estructura
};

/** Qué tan lejos llega esta ficha. NO es un «esto es aproximado» genérico: la fórmula está
 *  verificada al ítem contra un job real (Bantam: 20307/3808/1587/318 exactos), así que rebajarla
 *  toda por igual sería mentir a la baja. Lo que puede fallar es la FICHA, y aquí se dice cuál de
 *  sus piezas falta. La única incertidumbre que no podemos cerrar: que la estación haya cambiado
 *  desde que la declaraste — ESI no lo cuenta y Koru no puede saberlo. */
function Confianza({ f, bonos }: { f: Facility; bonos: Bonos | null }) {
  const falta: string[] = [];
  if (f.type_id == null) falta.push(tr("el tipo de estructura (sus 3 bonos)"));
  if (f.rigs.length === 0) falta.push(tr("los rigs"));
  if (f.tax === 0) falta.push(tr("el impuesto del centro"));
  const dudosos = (bonos?.rigs ?? []).filter((r) => r.state === "unmapped").length;

  if (falta.length === 0 && dudosos === 0)
    return (
      <span
        className="bom-conf ok"
        title={tr("Ficha completa: tipo, rigs e impuesto declarados. Con estos datos la cuenta cuadra al ítem con el juego — lo verificamos contra un job real. El único margen que queda es que la estación haya cambiado desde que la rellenaste: eso ESI no lo dice y Koru no puede saberlo.")}
      >
        ✓ {tr("ficha completa")}
      </span>
    );
  return (
    <span
      className="bom-conf warn"
      title={
        (falta.length
          ? `${tr("Estimación: te falta declarar")} ${falta.join(", ")}. ${tr("Lo que falta se calcula como si no existiera, así que la cuenta se queda CORTA, nunca larga.")}`
          : "") +
        (dudosos
          ? ` ${dudosos} ${tr("rig(s) con alcance sin mapear: no los aplicamos.")}`
          : "")
      }
    >
      ~ {tr("estimación")}
      {falta.length > 0 && ` (${tr("falta")}: ${falta.length})`}
    </span>
  );
}

/** `rigSize` del SDE → etiqueta. Raitaru/Athanor = 2 (M) · Azbel/Fortizar = 3 (L) · Sotiyo = 4 (XL). */
const RIG_SIZE: Record<number, string> = { 1: "S", 2: "M", 3: "L", 4: "XL" };

/** Multiplicador del rig según la seguridad. Los valores viven en el propio rig (`sec`), pero la
 *  BANDA se decide con la seguridad REDONDEADA a un decimal: C-J6MT vale −0,29 y cuenta como −0,3. */
function secBand(sec: number): "hi" | "low" | "null" {
  const disp = Math.round(sec * 10) / 10;
  return disp >= 0.5 ? "hi" : disp >= 0.1 ? "low" : "null";
}

/** Bonos de la instalación ya resueltos desde el dato, listos para el cálculo. */
type Bonos = {
  /** Factor de material de la estructura (0.99 = −1 %). 1 = sin bono (p. ej. un Fortizar). */
  strMat: number;
  /** Factor de coste del trabajo de la estructura (0.95 = −5 %). */
  strCost: number;
  /** Rigs de la ficha con su estado para ESTE producto. */
  rigs: { id: number; name: string; mat: number; eff: number; state: "on" | "off" | "unmapped" }[];
};

/** Factor de material VERIFICADO contra el juego (fixture Bantam ME10 en Sotiyo nullsec):
 *  (1−ME) × factor_estructura × Π(1 + rig_base×mult_seguridad/100) de los rigs que APLICAN.
 *  Todo sale del SDE: el 0.99 del Sotiyo, el −2,4 del rig y el ×2,1 del nullsec. Nada a mano.
 *  ⚠️ Nunca usar el % que muestra EVE: viene redondeado (−5,0 % cuando es −5,04 %) y miente. */
function matFactor(me: number, b: Bonos | null): number {
  let f = 1 - me / 100;
  if (!b) return f;
  f *= b.strMat;
  for (const r of b.rigs) if (r.state === "on") f *= 1 + r.eff / 100;
  return f;
}

/** Cantidad real que pide EVE. `ceil`, con el mínimo de 1 por carrera. */
function matQty(base: number, runs: number, factor: number): number {
  return Math.max(runs, Math.ceil(base * runs * factor));
}

function fmtRemain(end: string | null): { text: string; ready: boolean } {
  if (!end) return { text: "-", ready: false };
  const ms = Date.parse(end) - Date.now();
  if (Number.isNaN(ms)) return { text: "-", ready: false };
  if (ms <= 0) return { text: `✅ ${tr("listo")}`, ready: true };
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  const text = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${mm}m` : `${mm}m`;
  return { text, ready: false };
}

/** Sección Industria = jobs + biblioteca de blueprints.
 *  La biblioteca se pinta SIEMPRE: vive de otro scope (read_blueprints) y no debe desaparecer
 *  porque este personaje no tenga jobs (o no haya concedido el scope de jobs). */
export function IndustryView(props: {
  jobs: JobView[] | null;
  busy: boolean;
  global?: boolean;
  subject: number | "global";
}) {
  // El registro de instalaciones vive aquí arriba para que el árbol BOM (abajo, en la biblioteca)
  // se entere cuando editas una ficha: `facsVersion` sube y el BomPanel recarga de la BD.
  const [facsVersion, setFacsVersion] = useState(0);
  return (
    <>
      <JobsBlock jobs={props.jobs} busy={props.busy} global={props.global} />
      <FacilitiesBlock onChange={() => setFacsVersion((v) => v + 1)} />
      <BlueprintLibrary
        subject={props.subject}
        global={props.global}
        facsVersion={facsVersion}
      />
    </>
  );
}

function JobsBlock({
  jobs,
  busy,
  global,
}: {
  jobs: JobView[] | null;
  busy: boolean;
  global?: boolean;
}) {
  const [act, setAct] = useState<string>("all");
  if (!jobs && busy) return <p className="muted">{tr("Cargando…")}</p>;
  if (!jobs) return <p className="muted small">{tr("Sin datos.")}</p>;

  const isReady = (j: JobView) =>
    j.status === "ready" || j.status === "delivered" || fmtRemain(j.end_date).ready;
  const readyCount = jobs.filter(isReady).length;
  // Próximo en terminar (entre los que aún no están listos).
  const upcoming = jobs
    .filter((j) => j.end_date && !isReady(j))
    .sort((a, b) => Date.parse(a.end_date!) - Date.parse(b.end_date!));
  const nextEta = upcoming[0] ? fmtRemain(upcoming[0].end_date).text : "—";

  const activities = [...new Set(jobs.map((j) => j.activity))];
  const shown = act === "all" ? jobs : jobs.filter((j) => j.activity === act);
  // Listos primero, luego por fecha de fin.
  const ordered = [...shown].sort((a, b) => {
    const ra = isReady(a) ? 0 : 1;
    const rb = isReady(b) ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return Date.parse(a.end_date ?? "9999") - Date.parse(b.end_date ?? "9999");
  });

  return (
    <>
      <div className="kpis">
        <Kpi label={tr("Jobs activos")} value={fmtSp(jobs.length)} />
        <Kpi label={tr("Listos para recoger")} value={fmtSp(readyCount)} tone={readyCount > 0 ? "pos" : undefined} />
        <Kpi label={tr("Próximo en terminar")} value={nextEta} />
      </div>

      {activities.length > 1 && (
        <div className="rateo-controls">
          <div className="seg seg-sm">
            <button className={act === "all" ? "active" : ""} onClick={() => setAct("all")}>
              {tr("Todas")}
            </button>
            {activities.map((a) => (
              <button key={a} className={act === a ? "active" : ""} onClick={() => setAct(a)}>
                {a}
              </button>
            ))}
          </div>
        </div>
      )}

      <h4>{tr("Jobs de industria")}</h4>
      {ordered.length === 0 ? (
        <p className="muted small">{tr("Sin jobs activos.")}</p>
      ) : (
        <table className="km-table">
          <thead>
            <tr>
              {global && <th>{tr("Personaje")}</th>}
              <th>{tr("Actividad")}</th>
              <th>{tr("Producto / Blueprint")}</th>
              <th>{tr("Runs")}</th>
              <th>{tr("Estado")}</th>
              <th>{tr("Restante")}</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((j) => {
              const rem = fmtRemain(j.end_date);
              return (
                <tr key={j.job_id} className={rem.ready ? "job-ready" : ""}>
                  {global && <td>{j.character ?? "-"}</td>}
                  <td>{j.activity}</td>
                  <td>{j.product_name ?? j.blueprint_name ?? "-"}</td>
                  <td>{j.runs}</td>
                  <td>{j.status ?? "-"}</td>
                  <td>{rem.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

/** F1a — Árbol BOM: qué hace falta para fabricar ESTE plano, con TU ME y los bonos de TU
 *  instalación. Fórmula verificada contra el juego (ver SPEC_F1_FABRICACION.md). Sin ISK todavía:
 *  primero que el árbol sea CIERTO; el dinero llega en F1b. */
function BomPanel({
  bp,
  owned,
  subject,
  onClose,
  facsVersion,
}: {
  bp: Blueprint;
  owned: Blueprint[];
  subject: number | "global";
  onClose: () => void;
  /** Sube cada vez que tocas una ficha arriba: así el árbol recarga el registro y no se queda
   *  calculando con los bonos de antes. */
  facsVersion: number;
}) {
  const [ind, setInd] = useState<BpIndustry | null>(null);
  const [names, setNames] = useState<Map<number, string>>(new Map());
  const [stock, setStock] = useState<Map<number, number> | null>(null);
  const [runs, setRuns] = useState(1);
  const [open, setOpen] = useState<Set<number>>(new Set());
  // F1b/F1c: sistemas, índice de coste, adjusted_price, estructuras (ESI) y bonos del SDE.
  const [sys, setSys] = useState<{ id: number; n: string; s: number }[] | null>(null);
  const [idx, setIdx] = useState<Record<string, number> | null>(null);
  const [adj, setAdj] = useState<Map<number, number>>(new Map());
  const [ir, setIr] = useState<IndustryRigs | null>(null);
  const [tree, setTree] = useState<BpTree | null>(null);
  /** F1c: el registro de instalaciones (BD). El BOM ya no pregunta a ESI qué estructuras tienes:
   *  usa las fichas que TÚ has declarado, porque ESI no sabe ni los rigs ni los servicios. */
  const [facs, setFacs] = useState<Facility[] | null>(null);
  const [pick, setPick] = useState<number | null>(() => {
    const v = Number(localStorage.getItem(PICK_KEY)); // solo la ÚLTIMA elegida: preferencia, no dato
    return v > 0 ? v : null;
  });

  useEffect(() => {
    fetch("/bp_industry.json").then((r) => r.json()).then(setInd).catch(() => setInd({}));
    fetch("/market_types.json")
      .then((r) => r.json())
      .then((m: MType[]) => setNames(new Map(m.map((t) => [t.i, t.n]))))
      .catch(() => setNames(new Map()));
    fetch("/neweden.json")
      .then((r) => r.json())
      .then((d: { systems: { id: number; n: string; s: number }[] }) => setSys(d.systems))
      .catch(() => setSys([]));
    fetch("/industry_rigs.json").then((r) => r.json()).then(setIr).catch(() => setIr(null));
    fetch("/bp_tree.json").then((r) => r.json()).then(setTree).catch(() => setTree(null));
    invoke<Facility[]>("facility_list").then(setFacs).catch(() => setFacs([]));
  }, [facsVersion]);

  /** Elegibles: las que TÚ has marcado y declarado con planta de fabricación. Sin ficha no salen —
   *  no vamos a ofrecerte una estructura de la que no sabemos nada como si supiéramos algo. */
  const usable = useMemo(() => (facs ?? []).filter((f) => f.eligible && f.has_mfg), [facs]);
  const st = useMemo(() => usable.find((f) => f.id === pick) ?? null, [usable, pick]);
  const sysHit = useMemo(
    () => (st ? (sys ?? []).find((x) => x.id === st.system_id) ?? null : null),
    [sys, st],
  );

  // Índice de coste del sistema de la estructura (ESI, público).
  useEffect(() => {
    if (!st) {
      setIdx(null);
      return;
    }
    invoke<Record<string, number>>("get_industry_index", { systemId: st.system_id })
      .then(setIdx)
      .catch(() => setIdx(null));
  }, [st?.system_id]);

  const es = getLang() === "es";
  /** Categoría del PRODUCTO de este plano: decide qué rigs aplican (Bantam → 6 = Nave). */
  const prodCat = tree?.bp[String(bp.type_id)]?.[0] ?? null;

  /** Bonos resueltos DESDE EL DATO: los 3 de la estructura (SDE, por su tipo) y los rigs de la
   *  ficha con su bono efectivo (base × multiplicador de la banda de seguridad) y si aplican. */
  const bonos: Bonos | null = useMemo(() => {
    if (!st || !ir) return null;
    const sd = st.type_id != null ? ir.structures[String(st.type_id)] : null;
    const band = sysHit ? secBand(sysHit.s) : "hi";
    const rigs = st.rigs.map((id) => {
      const r = ir.rigs[String(id)];
      if (!r) return { id, name: `#${id}`, mat: 0, eff: 0, state: "unmapped" as const };
      const eff = r.mat * (r.sec[band] ?? 1);
      const cats = r.scope ? SCOPE_CAT[r.scope] : undefined;
      const state = !cats
        ? ("unmapped" as const) // alcance que aún no afirmamos: NO se aplica, y se dice
        : prodCat != null && cats.includes(prodCat)
          ? ("on" as const)
          : ("off" as const);
      return { id, name: es ? r.n.es : r.n.en, mat: r.mat, eff, state };
    });
    // Fortizar y compañía no tienen bono de material: `null` = sin bono (factor 1), NO cero.
    return { strMat: sd?.mat ?? 1, strCost: sd?.cost ?? 1, rigs };
  }, [st, ir, sysHit, prodCat, es]);

  // Stock real: lo que ya tienes, para el "te falta". Multi-personaje si el sujeto es Global.
  useEffect(() => {
    const p =
      subject === "global"
        ? invoke<{ type_id: number; quantity: number }[]>("get_assets_detail_global")
        : invoke<{ type_id: number; quantity: number }[]>("get_assets_detail", {
            characterId: subject,
          });
    p.then((list) => {
      const m = new Map<number, number>();
      for (const r of list) m.set(r.type_id, (m.get(r.type_id) ?? 0) + r.quantity);
      setStock(m);
    }).catch(() => setStock(new Map()));
  }, [subject]);

  // producto → blueprint que lo fabrica (para saber qué material es a su vez fabricable)
  const bpByProduct = useMemo(() => {
    const m = new Map<number, string>();
    for (const [bid, v] of Object.entries(ind ?? {})) {
      const out = v.m?.out?.[0]?.[0];
      if (out != null) m.set(out, bid);
    }
    return m;
  }, [ind]);

  // Tu MEJOR ME por blueprint (si tienes varias copias del mismo plano).
  const meOf = useMemo(() => {
    const m = new Map<number, number>();
    for (const b of owned) {
      const cur = m.get(b.type_id);
      if (cur == null || b.me > cur) m.set(b.type_id, b.me);
    }
    return m;
  }, [owned]);

  const nameOf = (tid: number) => names.get(tid) ?? `#${tid}`;

  type Row = {
    tid: number;
    qty: number;
    depth: number;
    subBp: string | null;
    /** ME usado para calcular los hijos de este nodo (null = no tienes el plano → estimado a 0). */
    childMe: number | null;
  };

  const rows = useMemo(() => {
    const out: Row[] = [];
    if (!ind) return out;
    const walk = (bpId: string, n: number, depth: number) => {
      const act = ind[bpId]?.m;
      if (!act) return;
      const me = meOf.get(Number(bpId));
      const f = matFactor(me ?? 0, bonos);
      for (const [tid, base] of act.in) {
        const qty = matQty(base, n, f);
        const sb = bpByProduct.get(tid) ?? null;
        const childMe = sb ? (meOf.get(Number(sb)) ?? null) : null;
        out.push({ tid, qty, depth, subBp: sb, childMe });
        if (sb && open.has(tid)) {
          const outQty = ind[sb]?.m?.out?.[0]?.[1] ?? 1;
          walk(sb, Math.ceil(qty / outQty), depth + 1);
        }
      }
    };
    walk(String(bp.type_id), runs, 0);
    return out;
  }, [ind, bp, runs, bonos, open, meOf, bpByProduct]);

  const act = ind?.[String(bp.type_id)]?.m;

  // --- F1b: coste del trabajo, con la fórmula VERIFICADA al ISK contra el juego ---
  // El VEO usa las cantidades BASE del blueprint (NO las de tras-ME) y el `adjusted_price`.
  useEffect(() => {
    const ids = (act?.in ?? []).map(([tid]) => tid);
    if (ids.length === 0) return;
    invoke<Record<number, number>>("get_type_adjusted_prices", { ids })
      .then((r) => setAdj(new Map(Object.entries(r).map(([k, v]) => [Number(k), v]))))
      .catch(() => setAdj(new Map()));
  }, [act]);

  const cost = useMemo(() => {
    if (!act) return null;
    let veo = 0;
    let faltan = 0;
    for (const [tid, base] of act.in) {
      const p = adj.get(tid);
      if (p == null) faltan++;
      veo += base * runs * (p ?? 0);
    }
    const index = idx?.manufacturing ?? null;
    if (index == null) return { veo, faltan, index: null as number | null };
    const bruto = veo * index;
    // La bonificación de coste de la estructura sale del SDE (Sotiyo 0.95) y va sobre el BRUTO.
    const brutoTotal = bruto * (bonos?.strCost ?? 1);
    const tax = veo * ((st?.tax ?? 0) / 100); // el impuesto lo pone el dueño: ni ESI ni SDE lo saben
    const ccs = veo * CCS_SURCHARGE;
    return { veo, faltan, index, bruto, brutoTotal, tax, ccs, total: brutoTotal + tax + ccs };
  }, [act, adj, runs, idx, bonos, (st?.tax ?? 0)]);
  const product = act?.out?.[0]?.[0];
  const perRun = act?.out?.[0]?.[1] ?? 1;
  const maxRuns = bp.quantity === -1 ? 1_000_000 : Math.max(1, bp.runs);

  if (!ind) return <p className="muted small">{tr("Cargando…")}</p>;
  if (!act)
    return (
      <div className="bom-panel">
        <div className="bom-head">
          <strong>{bp.name ?? `#${bp.type_id}`}</strong>
          <button className="sys-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="muted small">{tr("Este plano no fabrica nada (o el SDE no lo tiene).")}</p>
      </div>
    );

  return (
    <div className="bom-panel">
      <div className="bom-head">
        <img src={bpIcon(bp.type_id, bp.quantity === -1, 32)} alt="" width={20} height={20} />
        <strong>{bp.name ?? `#${bp.type_id}`}</strong>
        <span className="muted small">
          ME {bp.me}% · TE {bp.te}% · {tr("produce")} {fmtSp(perRun * runs)}{" "}
          {product != null ? nameOf(product) : ""}
        </span>
        <button className="sys-close" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="bom-cfg small">
        <label>
          {tr("Carreras")}{" "}
          <input
            type="number"
            min={1}
            max={maxRuns}
            value={runs}
            onChange={(e) => setRuns(Math.max(1, Math.min(maxRuns, Number(e.target.value) || 1)))}
          />
        </label>
        <span className="bom-sep">·</span>
        <label title={tr("Tus fichas de instalación marcadas como elegibles. De la ficha salen el sistema (→ índice de coste y banda de seguridad), el tipo (→ los 3 bonos del SDE) y los rigs. Se editan en «Mis instalaciones», arriba.")}>
          {tr("Instalación")}{" "}
          <select
            style={{ width: "16rem" }}
            value={pick ?? ""}
            onChange={(e) => {
              const v = Number(e.target.value) || null;
              setPick(v);
              if (v) localStorage.setItem(PICK_KEY, String(v));
            }}
          >
            <option value="">{tr("— Elige tu instalación —")}</option>
            {usable.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <span className="muted">
          {usable.length === 0
            ? tr("aún no tienes fichas elegibles: créala arriba, en «Mis instalaciones»")
            : !st
              ? tr("elige una instalación para el coste y los bonos")
              : `${sysHit?.n ?? `#${st.system_id}`} · ${tr("sec")} ${sysHit ? sysHit.s.toFixed(1) : "?"}${
                  st.type_id && ir?.structures[String(st.type_id)]
                    ? ` · ${ir.structures[String(st.type_id)].n.en}`
                    : ""
                }${
                  idx?.manufacturing != null
                    ? ` · ${tr("índice")} ${(idx.manufacturing * 100).toFixed(2)}%`
                    : ""
                }${st.tax > 0 ? ` · ${tr("impuesto")} ${st.tax}%` : ""}`}
        </span>
        {st && <Confianza f={st} bonos={bonos} />}
      </div>

      {/* F1b — Coste del trabajo. Fórmula verificada al ISK contra el juego (fixture Bantam:
          279.893 × 0,0998 = 27.938 → −5% = 26.541 · +1% VEO = 2.799 · +4% VEO = 11.196 → 40.536).
          Ojo al orden: la bonificación de estructura va sobre el BRUTO; los impuestos, sobre el VEO. */}
      {cost && (
        <div className="bom-cost small">
          <div className="bom-cost-row">
            <span>{tr("Valor estimado del objeto (VEO)")}</span>
            <strong>{fmtIsk(cost.veo)}</strong>
          </div>
          {cost.index == null ? (
            <div className="muted">
              {tr("Sin índice de coste: elige una estructura para calcular el coste del trabajo.")}
            </div>
          ) : (
            <>
              <div className="bom-cost-row muted">
                <span>
                  {tr("Índice de coste en sistema")} ({(cost.index * 100).toFixed(2)}%)
                </span>
                <span>{fmtIsk(cost.bruto!)}</span>
              </div>
              {(bonos?.strCost ?? 1) !== 1 && (
                <div className="bom-cost-row muted">
                  <span>
                    {tr("Bonificación de estructura")} (−
                    {((1 - (bonos?.strCost ?? 1)) * 100).toFixed(0)}%)
                  </span>
                  <span>−{fmtIsk(cost.bruto! - cost.brutoTotal!)}</span>
                </div>
              )}
              <div className="bom-cost-row muted">
                <span>
                  {tr("Impuesto de centro")} ({(st?.tax ?? 0)}% VEO)
                </span>
                <span>+{fmtIsk(cost.tax!)}</span>
              </div>
              <div className="bom-cost-row muted">
                <span>{tr("Recargo de CCS")} (4% VEO)</span>
                <span>+{fmtIsk(cost.ccs!)}</span>
              </div>
              <div className="bom-cost-row bom-cost-total">
                <span>{tr("Coste total del trabajo")}</span>
                <strong>{fmtIsk(cost.total!)}</strong>
              </div>
            </>
          )}
          {cost.faltan > 0 && (
            <div className="muted">
              ⚠ {cost.faltan} {tr("material(es) sin adjusted_price: el VEO se queda corto. Sincroniza precios.")}
            </div>
          )}
        </div>
      )}

      <table className="km-table bom-table">
        <thead>
          <tr>
            <th>{tr("Material")}</th>
            <th>{tr("Necesitas")}</th>
            <th>{tr("Tienes")}</th>
            <th>{tr("Te falta")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const have = stock?.get(r.tid) ?? 0;
            const miss = Math.max(0, r.qty - have);
            const isOpen = open.has(r.tid);
            return (
              <tr key={`${r.tid}-${r.depth}-${i}`} className={miss === 0 ? "bom-ok" : ""}>
                <td style={{ paddingLeft: `${0.4 + r.depth * 1.1}rem` }}>
                  {r.subBp ? (
                    <button
                      className="bom-exp"
                      onClick={() => {
                        const s = new Set(open);
                        isOpen ? s.delete(r.tid) : s.add(r.tid);
                        setOpen(s);
                      }}
                      title={tr("Desplegar sus materiales")}
                    >
                      {isOpen ? "▾" : "▸"}
                    </button>
                  ) : (
                    <span className="bom-exp bom-leaf">·</span>
                  )}
                  <img src={typeIcon(r.tid, 32)} alt="" width={16} height={16} /> {nameOf(r.tid)}
                  {r.subBp && isOpen && (
                    <span className="muted small">
                      {" "}
                      — ME {r.childMe ?? 0}%{r.childMe == null ? ` (${tr("estimado")})` : ""}
                    </span>
                  )}
                </td>
                <td>{fmtSp(r.qty)}</td>
                <td className="muted">{stock == null ? "…" : fmtSp(have)}</td>
                <td className={miss > 0 ? "bom-miss" : "bom-ok-txt"}>
                  {stock == null ? "…" : miss > 0 ? fmtSp(miss) : "✓"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">
        {tr("«Tienes» suma tus assets (los del personaje activo, o de todos en Global). Un material desplegado usa el ME de TU plano; si no lo tienes, se calcula con ME 0 y se marca «estimado» — nunca se disfraza de real.")}
      </p>
    </div>
  );
}

/** F1a — Tu biblioteca de blueprints con los ME/TE REALES (scope read_blueprints, R4).
 *  Con 2.000+ planos una tabla plana no vale: se navega como Assets, por pestañas de categoría
 *  (nivel 1 del árbol de mercado: Naves, Munición…) + subpestañas (Fragatas, Cruceros…) + buscador.
 *  Los nombres de grupo salen del SDE y YA vienen bilingües (`n` EN / `ne` ES). Idea de RoGi7. */
function BlueprintLibrary({
  subject,
  global,
  facsVersion,
}: {
  subject: number | "global";
  global?: boolean;
  facsVersion: number;
}) {
  const [bps, setBps] = useState<Blueprint[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [tree, setTree] = useState<BpTree | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<number | "">("");
  const [sub, setSub] = useState<number | "">("");
  const [bom, setBom] = useState<Blueprint | null>(null); // plano abierto en el árbol BOM

  useEffect(() => {
    fetch("/bp_tree.json").then((r) => r.json()).then(setTree).catch(() => setTree(null));
  }, []);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    setDenied(false);
    const p =
      subject === "global"
        ? invoke<Blueprint[]>("get_blueprints_global")
        : invoke<Blueprint[]>("get_blueprints", { characterId: subject });
    p.then((v) => alive && setBps(v))
      .catch(() => {
        if (alive) {
          setBps(null);
          setDenied(true); // sin scope todavía: se dice, no se disimula
        }
      })
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [subject]);

  const es = getLang() === "es";
  const catName = (id: number) => {
    const e = tree?.cat[String(id)];
    return e ? (es ? e.es : e.en) : `#${id}`;
  };
  const grpName = (id: number) => {
    const e = tree?.grp[String(id)];
    return e ? (es ? e.es : e.en) : `#${id}`;
  };

  // Cada blueprint con la categoría y el grupo de su PRODUCTO (null = sin producto resoluble).
  const rows = useMemo(
    () =>
      (bps ?? []).map((bp) => {
        const e = tree?.bp[String(bp.type_id)];
        return { bp, l1: e ? e[0] : null, l2: e ? e[1] : null };
      }),
    [bps, tree],
  );

  const tally = (
    pick: (r: (typeof rows)[number]) => number | null,
    name: (id: number) => string,
    only?: number | "",
  ) => {
    const c = new Map<number, number>();
    for (const r of rows) {
      if (only !== undefined && only !== "" && r.l1 !== only) continue;
      const id = pick(r);
      if (id != null) c.set(id, (c.get(id) ?? 0) + 1);
    }
    return [...c.entries()]
      .map(([id, n]) => ({ id, n, label: name(id) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  };
  // `es` en las deps: al cambiar de idioma hay que reetiquetar las pestañas.
  const cats = useMemo(() => tally((r) => r.l1, catName), [rows, tree, es]);
  const subs = useMemo(
    () => (cat === "" ? [] : tally((r) => r.l2, grpName, cat)),
    [rows, cat, tree, es],
  );

  const ql = q.trim().toLowerCase();
  const shown = rows
    .filter((r) => (cat === "" || r.l1 === cat) && (sub === "" || r.l2 === sub))
    .filter((r) => ql === "" || (r.bp.name ?? "").toLowerCase().includes(ql))
    .sort((a, b) => (a.bp.name ?? "").localeCompare(b.bp.name ?? ""));

  if (busy && !bps) return <p className="muted">{tr("Cargando biblioteca de blueprints…")}</p>;
  if (denied)
    return (
      <p className="muted small">
        {tr("Sin acceso a tus blueprints: concede el grupo «Industria» en «Conceder acceso».")}
      </p>
    );
  if (!bps || bps.length === 0) return <p className="muted small">{tr("No tienes blueprints.")}</p>;

  const bpo = bps.filter((b) => b.quantity === -1).length;
  const LIMIT = 300;

  return (
    <div className="bp-lib">
      <h4>📘 {tr("Tu biblioteca de blueprints")}</h4>
      {bom && (
        <BomPanel
          bp={bom}
          owned={bps}
          subject={subject}
          onClose={() => setBom(null)}
          facsVersion={facsVersion}
        />
      )}
      <div className="kpis">
        <Kpi label={tr("Blueprints")} value={fmtSp(bps.length)} />
        <Kpi label="BPO" value={fmtSp(bpo)} />
        <Kpi label="BPC" value={fmtSp(bps.length - bpo)} />
      </div>

      <div className="tabs" style={{ marginTop: "0.5rem" }}>
        <button
          className={`tab ${cat === "" ? "active" : ""}`}
          onClick={() => {
            setCat("");
            setSub("");
          }}
        >
          {tr("Todos")} ({fmtSp(rows.length)})
        </button>
        {cats.map((c) => (
          <button
            key={c.id}
            className={`tab ${cat === c.id ? "active" : ""}`}
            onClick={() => {
              setCat(c.id);
              setSub("");
            }}
          >
            {c.label} ({fmtSp(c.n)})
          </button>
        ))}
      </div>

      {cat !== "" && subs.length > 1 && (
        <div className="tabs bp-subtabs">
          <button className={`tab ${sub === "" ? "active" : ""}`} onClick={() => setSub("")}>
            {tr("Todas")}
          </button>
          {subs.map((s) => (
            <button
              key={s.id}
              className={`tab ${sub === s.id ? "active" : ""}`}
              onClick={() => setSub(s.id)}
            >
              {s.label} ({fmtSp(s.n)})
            </button>
          ))}
        </div>
      )}

      <div className="asset-search">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tr("Buscar blueprint…")}
        />
      </div>

      <table className="km-table">
        <thead>
          <tr>
            {global && <th>{tr("Personaje")}</th>}
            <th>{tr("Blueprint")}</th>
            <th>{tr("Tipo")}</th>
            <th>ME</th>
            <th>TE</th>
            <th>{tr("Runs")}</th>
          </tr>
        </thead>
        <tbody>
          {shown.slice(0, LIMIT).map((r, i) => {
            const b = r.bp;
            const isBpo = b.quantity === -1;
            return (
              <tr
                key={`${b.type_id}-${i}`}
                className="bp-row"
                onClick={() => setBom(b)}
                title={tr("Ver qué hace falta para fabricarlo")}
              >
                {global && <td>{b.character ?? "-"}</td>}
                <td>
                  <img src={bpIcon(b.type_id, isBpo, 32)} alt="" width={18} height={18} />{" "}
                  {b.name ?? `#${b.type_id}`}
                </td>
                <td className={isBpo ? "bp-bpo" : "bp-bpc"}>{isBpo ? "BPO" : "BPC"}</td>
                <td>{b.me}%</td>
                <td>{b.te}%</td>
                <td>{isBpo ? "∞" : fmtSp(b.runs)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {shown.length > LIMIT && (
        <p className="muted small">
          {tr("Mostrando los primeros")} {LIMIT} / {fmtSp(shown.length)} —{" "}
          {tr("afina con las pestañas o el buscador.")}
        </p>
      )}
    </div>
  );
}

/* ============================ F1c — Mis instalaciones ============================
 *
 * El registro de estructuras del fabricante. Idea de RoGi7, y corrige el rumbo anterior: intentar
 * DEDUCIR qué tiene cada estructura es imposible — los rigs y los servicios no los da ESI (solo a
 * un Director vía /corporations/{id}/structures/) ni se ven in-game sin roles.
 * Por eso las alianzas publican hojas de cálculo con las mejoras de sus estaciones.
 *
 * La respuesta no es importar la hoja de una alianza concreta (serviría a esa alianza y a nadie
 * más), sino un ASISTENTE que le pregunte al fabricante lo que sabe. La hoja de los Goons sirvió
 * para validar el modelo de datos, no como fuente: su forma —Sistema | Estructura | Nombre |
 * Servicios | Rig 1-3— es exactamente lo que se pregunta aquí. Y confirmó el fixture por su cuenta
 * (dice que el Sotiyo de C-J6MT lleva el rig 37181, el mismo que dedujimos del job del Bantam).
 *
 * Regla de oro: aquí NO se piden porcentajes. Se pide QUÉ es y QUÉ lleva; los números los pone el
 * SDE. Pedir % a mano fue la trampa que ya nos mordió (tres bonos con el mismo nombre in-game, y
 * el % del rig se muestra redondeado: −5,0 % cuando en realidad es −5,04 %).
 */
function FacilitiesBlock({ onChange }: { onChange: () => void }) {
  const [facs, setFacs] = useState<Facility[] | null>(null);
  const [ir, setIr] = useState<IndustryRigs | null>(null);
  const [sys, setSys] = useState<{ id: number; n: string; s: number }[] | null>(null);
  const [edit, setEdit] = useState<Facility | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    invoke<Facility[]>("facility_list")
      .then(setFacs)
      .catch(() => setFacs([]));
  };
  useEffect(() => {
    load();
    fetch("/industry_rigs.json").then((r) => r.json()).then(setIr).catch(() => setIr(null));
    fetch("/neweden.json")
      .then((r) => r.json())
      .then((d: { systems: { id: number; n: string; s: number }[] }) => setSys(d.systems))
      .catch(() => setSys([]));
  }, []);

  const save = async (f: Facility) => {
    await invoke("facility_upsert", { facility: f });
    setEdit(null);
    load();
    onChange();
  };
  const remove = async (id: number) => {
    await invoke("facility_delete", { id });
    load();
    onChange();
  };
  const toggle = async (f: Facility, k: "eligible" | "has_mfg") => save({ ...f, [k]: !f[k] });

  /** Trae de ESI las estructuras que ya conocemos, para no empezar con la lista en blanco. Solo
   *  rellena lo que ESI sabe (nombre/sistema/tipo) y las deja SIN marcar: una ficha sin declarar no
   *  debe colarse en el desplegable como si supiéramos sus rigs. */
  const seed = async () => {
    setBusy(true);
    try {
      const n = await invoke<number>("facility_seed_from_esi");
      load();
      onChange();
      if (n === 0) alert(tr("No hay estructuras nuevas que traer: ya están todas en tu registro."));
    } catch {
      alert(tr("No se pudo consultar ESI. ¿Has concedido el permiso «read_structures»?"));
    } finally {
      setBusy(false);
    }
  };

  const nuevo = (): Facility => ({
    id: 0,
    structure_id: null,
    name: "",
    system_id: 0,
    type_id: null,
    has_mfg: true,
    rigs: [],
    tax: 0,
    eligible: true,
    source: "manual",
    notes: null,
  });

  const sysName = (id: number) => (sys ?? []).find((s) => s.id === id)?.n ?? `#${id}`;

  return (
    <div className="fac-block">
      <div className="fac-head">
        <strong>{tr("Mis instalaciones")}</strong>
        <span className="muted small">
          {tr("EVE no enseña los rigs ni los servicios de una estructura si no tienes roles, y ESI tampoco. Así que lo pones tú: Koru saca los números del SDE a partir de lo que declares.")}
        </span>
        <button onClick={() => setEdit(nuevo())}>+ {tr("Nueva ficha")}</button>
        <button onClick={seed} disabled={busy} title={tr("Trae de ESI las estructuras que ya conocemos por tus assets, con su nombre, sistema y tipo. Los rigs y los servicios los tendrás que declarar tú: eso ESI no lo da.")}>
          {busy ? tr("Buscando…") : tr("Traer de ESI")}
        </button>
      </div>

      {facs === null ? (
        <p className="muted small">{tr("Cargando…")}</p>
      ) : facs.length === 0 ? (
        <p className="muted small">
          {tr("Aún no tienes fichas. Crea una a mano, o trae de ESI las que ya conocemos y complétalas.")}
        </p>
      ) : (
        <table className="fac-table small">
          <thead>
            <tr>
              <th title={tr("Solo las marcadas salen en el desplegable del árbol BOM.")}>{tr("Usar")}</th>
              <th>{tr("Nombre")}</th>
              <th>{tr("Sistema")}</th>
              <th>{tr("Tipo")}</th>
              <th title={tr("¿Tiene la planta de fabricación instalada? Sin ella no se puede fabricar ahí.")}>{tr("Fabrica")}</th>
              <th>{tr("Rigs")}</th>
              <th>{tr("Impuesto")}</th>
              <th>{tr("Origen")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {facs.map((f) => {
              const k = f.type_id != null ? ir?.kinds?.[String(f.type_id)] : null;
              const puede = !k || !ir?.mfg_groups?.length || ir.mfg_groups.includes(k.g);
              return (
                <tr key={f.id} className={f.eligible ? "" : "fac-off"}>
                  <td>
                    <input
                      type="checkbox"
                      checked={f.eligible}
                      disabled={!puede}
                      onChange={() => toggle(f, "eligible")}
                    />
                  </td>
                  <td>{f.name}</td>
                  <td>{sysName(f.system_id)}</td>
                  <td>{k ? k.n.en : <span className="muted">{tr("sin declarar")}</span>}</td>
                  <td>
                    {!puede ? (
                      // No es opinión: el módulo de fabricación lleva en el SDE los grupos donde
                      // encaja, y este tipo no está entre ellos.
                      <span
                        className="muted"
                        title={tr("Este tipo de estructura no admite la planta de fabricación: lo dice el propio módulo en el SDE (solo encaja en Citadel, Engineering Complex y Refinery).")}
                      >
                        {tr("no puede")}
                      </span>
                    ) : (
                      <input
                        type="checkbox"
                        checked={f.has_mfg}
                        onChange={() => toggle(f, "has_mfg")}
                      />
                    )}
                  </td>
                  <td>{f.rigs.length || <span className="muted">—</span>}</td>
                  <td>{f.tax ? `${f.tax}%` : <span className="muted">—</span>}</td>
                  <td className="muted">{f.source === "esi" ? "ESI" : tr("a mano")}</td>
                  <td>
                    <button className="bom-exp" onClick={() => setEdit(f)}>
                      {tr("Editar")}
                    </button>
                    <button
                      className="bom-exp"
                      onClick={() => confirm(tr("¿Borrar esta ficha?")) && remove(f.id)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {edit && ir && sys && (
        <FacilityWizard
          f={edit}
          ir={ir}
          sys={sys}
          onSave={save}
          onCancel={() => setEdit(null)}
        />
      )}
    </div>
  );
}

/** El asistente. Una sola pantalla con los pasos a la vista (no un wizard de «siguiente, siguiente»:
 *  el fabricante que ya sabe lo que hace no debería tener que pasar 5 pantallas para cambiar el
 *  impuesto). Cada campo dice de dónde sale su número. */
function FacilityWizard({
  f,
  ir,
  sys,
  onSave,
  onCancel,
}: {
  f: Facility;
  ir: IndustryRigs;
  sys: { id: number; n: string; s: number }[];
  onSave: (f: Facility) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<Facility>(f);
  const [q, setQ] = useState("");
  const [allRigs, setAllRigs] = useState(false);
  const es = getLang() === "es";
  const set = (p: Partial<Facility>) => setD({ ...d, ...p });

  const sysHit = sys.find((s) => s.id === d.system_id) ?? null;
  const cands = q.trim().length >= 2
    ? sys.filter((s) => s.n.toLowerCase().startsWith(q.trim().toLowerCase())).slice(0, 8)
    : [];
  const sd = d.type_id != null ? ir.structures[String(d.type_id)] : null;
  const kind = d.type_id != null ? ir.kinds?.[String(d.type_id)] : null;
  const puede = !kind || !ir.mfg_groups?.length || ir.mfg_groups.includes(kind.g);
  const band = sysHit ? secBand(sysHit.s) : null;
  const listos = d.name.trim() !== "" && d.system_id > 0;

  // Tipos ofrecidos: los que admiten la planta de fabricación, según el propio módulo (SDE).
  const tipos = Object.entries(ir.kinds ?? {})
    .filter(([, k]) => !ir.mfg_groups?.length || ir.mfg_groups.includes(k.g))
    .sort((a, b) => a[1].n.en.localeCompare(b[1].n.en));

  return (
    <div className="fac-wiz">
      <div className="fac-wiz-head">
        <strong>{d.id ? tr("Editar ficha") : tr("Nueva ficha de instalación")}</strong>
        <button className="sys-close" onClick={onCancel}>
          ✕
        </button>
      </div>

      <p className="muted small">
        {tr("Rellena lo que sepas. Lo que dejes en blanco no se inventa: se calcula como si no existiera, así que la cuenta se queda corta y Koru te lo dice. Cuanto más completa, más se acerca — con la ficha entera cuadra al ítem con el juego.")}
      </p>

      <label className="fac-f">
        <span>1 · {tr("Nombre")}</span>
        <input
          value={d.name}
          placeholder={tr("p. ej. Sotiyo de C-J6MT (naves T2)")}
          onChange={(e) => set({ name: e.target.value })}
        />
        <em className="muted">{tr("para ti: el que te ayude a reconocerla")}</em>
      </label>

      <label className="fac-f">
        <span>2 · {tr("Sistema")}</span>
        <span>
          <input
            value={q}
            placeholder={sysHit ? sysHit.n : tr("escribe 2 letras…")}
            onChange={(e) => setQ(e.target.value)}
          />
          {cands.length > 0 && (
            <span className="fac-cands">
              {cands.map((s) => (
                <button
                  key={s.id}
                  className="bom-exp"
                  onClick={() => {
                    set({ system_id: s.id });
                    setQ("");
                  }}
                >
                  {s.n} ({s.s.toFixed(1)})
                </button>
              ))}
            </span>
          )}
        </span>
        <em className="muted">
          {sysHit
            ? `${sysHit.n} · ${tr("sec")} ${sysHit.s.toFixed(1)} → ${tr("de aquí salen el índice de coste (ESI, en vivo) y el multiplicador de los rigs")}`
            : tr("obligatorio: sin sistema no hay índice de coste ni banda de seguridad")}
        </em>
      </label>

      <label className="fac-f">
        <span>3 · {tr("Tipo")}</span>
        <select
          value={d.type_id ?? ""}
          onChange={(e) => set({ type_id: Number(e.target.value) || null, rigs: [] })}
        >
          <option value="">{tr("— no lo sé —")}</option>
          {tipos.map(([id, k]) => (
            <option key={id} value={id}>
              {(es ? k.n.es : k.n.en) + ` · ${k.gn}`}
            </option>
          ))}
        </select>
        <em className="muted">
          {sd
            ? `${tr("bonos del SDE")}: ${sd.mat != null ? `${tr("material")} ${((1 - sd.mat) * 100).toFixed(0)}%` : tr("sin bono de material")} · ${tr("coste")} ${(((1 - (sd.cost ?? 1)) * 100)).toFixed(0)}% · ${tr("tiempo")} ${(((1 - (sd.time ?? 1)) * 100)).toFixed(0)}%`
            : d.type_id
              ? tr("este tipo no tiene bonos de industria (una Citadel normal, p. ej.): se calcula sin ellos")
              : tr("si lo dejas en blanco calculamos SIN los bonos de estructura: te quedarás corto")}
        </em>
      </label>

      <label className="fac-f">
        <span>4 · {tr("Servicios")}</span>
        <span>
          <input
            type="checkbox"
            checked={d.has_mfg}
            disabled={!puede}
            onChange={(e) => set({ has_mfg: e.target.checked })}
          />{" "}
          {tr("tiene planta de fabricación instalada")}
        </span>
        <em className="muted">
          {!puede
            ? tr("este tipo NO admite la planta: lo dice el propio módulo en el SDE")
            : tr("si no la tiene, no podrás fabricar ahí y no saldrá en el desplegable")}
        </em>
      </label>

      <div className="fac-f">
        <span>5 · {tr("Rigs")}</span>
        <span className="fac-rigs">
          {d.rigs.map((id) => {
            const r = ir.rigs[String(id)];
            return (
              <span key={id} className="fac-rig">
                {r ? (es ? r.n.es : r.n.en) : `#${id}`}
                <button
                  className="bom-exp"
                  onClick={() => set({ rigs: d.rigs.filter((x) => x !== id) })}
                >
                  ✕
                </button>
              </span>
            );
          })}
          {sd && d.rigs.length >= sd.slots && (
            <em className="muted">
              {tr("has llenado los")} {sd.slots} {tr("slots de esta estructura")}
            </em>
          )}
          <select
            value=""
            onChange={(e) => {
              const id = Number(e.target.value);
              if (id && !d.rigs.includes(id)) set({ rigs: [...d.rigs, id] });
            }}
          >
            <option value="">{tr("+ añadir rig…")}</option>
            {Object.entries(ir.rigs)
              .filter(([, r]) => r.scope && r.mat !== 0)
              // Tamaño: rig y estructura comparten el atributo `rigSize` del SDE — el MISMO que usan
              // los rigs de nave, donde la regla es coincidencia EXACTA, y el devblog lo respalda
              // (al pasar de Raitaru a Sotiyo se cambian los rigs M por XL). Pero ninguna fuente
              // dura lo afirma para estructuras, así que dejamos la escotilla: si tu rig no sale,
              // la hipótesis rota es la nuestra, no tus datos.
              .filter(([, r]) => allRigs || !sd || r.size === sd.size)
              .sort((a, b) => a[1].n.en.localeCompare(b[1].n.en))
              .map(([id, r]) => (
                <option key={id} value={id}>
                  {RIG_SIZE[r.size] ?? "?"} · {es ? r.n.es : r.n.en}
                </option>
              ))}
          </select>
          <label className="bom-rig-all">
            <input
              type="checkbox"
              checked={allRigs}
              onChange={(e) => setAllRigs(e.target.checked)}
            />{" "}
            {tr("ver rigs de todos los tamaños")}
          </label>
        </span>
        <em className="muted">
          {d.rigs.length === 0
            ? tr("¿no los sabes? Déjalo vacío: calcularemos sin ellos y te lo diremos. Mejor quedarse corto que inventar un bono.")
            : band
              ? `${tr("en")} ${band === "null" ? "nullsec/WH" : band === "low" ? "lowsec" : "highsec"} ${tr("sus bonos base se multiplican por")} ${ir.rigs[String(d.rigs[0])]?.sec[band] ?? 1}`
              : tr("elige el sistema para saber cuánto rinden")}
        </em>
      </div>

      <label className="fac-f">
        <span>6 · {tr("Impuesto")}</span>
        <span>
          <input
            type="number"
            step="0.1"
            value={d.tax}
            onChange={(e) => set({ tax: Number(e.target.value) || 0 })}
          />{" "}
          %
        </span>
        <em className="muted">
          {tr("el que cobra el dueño de la estructura. Sale en el desglose de coste del job, in-game. Nadie más lo sabe: ni ESI ni el SDE.")}
        </em>
      </label>

      <div className="fac-wiz-foot">
        <span className="muted small">
          {tr("Ojo: esto es una foto de lo que TÚ sabes hoy. Si la estación cambia sus rigs o su impuesto, Koru no se entera — vuelve aquí y edítala.")}
        </span>
        <button onClick={onCancel}>{tr("Cancelar")}</button>
        <button
          disabled={!listos}
          title={listos ? "" : tr("hacen falta el nombre y el sistema")}
          onClick={() => onSave(d)}
        >
          {tr("Guardar ficha")}
        </button>
      </div>
    </div>
  );
}
