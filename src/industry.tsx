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
 *  salía como portanave. Cazado por Zigor y verificado en EVE Ref.) */
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

/** Config de la instalación. ESI NO expone rigs ni bonos de estructura → se pone a mano (como
 *  Ravworks). Vive en localStorage: el cálculo es 100% del frontend, no necesita backend.
 *  El SISTEMA no es un bono: de él salen el índice de coste (ESI) y el multiplicador de seguridad
 *  del rig, así que se elige una vez y Koru deduce los dos. */
type InstallCfg = {
  system: string; // nombre del sistema (p. ej. "C-J6MT")
  structMat: number; // bonif. de CONSUMO DE MATERIALES de la estructura (%)
  rigMe: number; // valor BASE del rig ME (%), NO el efectivo que muestra EVE
  structCost: number; // bonif. de COSTE DEL TRABAJO de la estructura (%)
  facilityTax: number; // impuesto del centro (%)
};
const CFG_KEY = "koru_bom_cfg";
/** Neutral por defecto: preferimos que el usuario lo configure a inventárselo. */
const CFG_DEF: InstallCfg = { system: "", structMat: 0, rigMe: 0, structCost: 0, facilityTax: 0 };
/** Recargo de la CCS: 4 % del VEO, global del juego y NO configurable (verificado: 11.196 de 279.893). */
const CCS_SURCHARGE = 0.04;

/** Multiplicador de los rigs según la seguridad del sistema (verificado por partida doble con el
 *  fixture: rig ME 2,4 × 2,1 = 5,04 % y rig TE 24 × 2,1 = 50,4 %). EVE clasifica por la seguridad
 *  REDONDEADA a un decimal: C-J6MT vale −0,29 pero se muestra (y cuenta) como −0,3 → nullsec. */
function secMultOf(sec: number): number {
  const disp = Math.round(sec * 10) / 10;
  return disp >= 0.5 ? 1 : disp >= 0.1 ? 1.9 : 2.1;
}

function loadCfg(): InstallCfg {
  try {
    return { ...CFG_DEF, ...JSON.parse(localStorage.getItem(CFG_KEY) ?? "{}") };
  } catch {
    return { ...CFG_DEF };
  }
}

/** Factor de material VERIFICADO contra el juego (fixture Bantam ME10 en Sotiyo nullsec):
 *  (1−ME) × (1−bonif_estructura) × (1−rig_base×multiplicador_de_seguridad).
 *  ⚠️ El rig se calcula desde su valor BASE: EVE muestra el efectivo REDONDEADO (−5,0 % cuando en
 *  realidad es −5,04 %) y con el de pantalla el árbol miente (20.315 en vez de 20.307). */
function matFactor(me: number, cfg: InstallCfg, secMult: number): number {
  const rig = (cfg.rigMe * secMult) / 100;
  return (1 - me / 100) * (1 - cfg.structMat / 100) * (1 - rig);
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
  return (
    <>
      <JobsBlock jobs={props.jobs} busy={props.busy} global={props.global} />
      <BlueprintLibrary subject={props.subject} global={props.global} />
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
}: {
  bp: Blueprint;
  owned: Blueprint[];
  subject: number | "global";
  onClose: () => void;
}) {
  const [ind, setInd] = useState<BpIndustry | null>(null);
  const [names, setNames] = useState<Map<number, string>>(new Map());
  const [stock, setStock] = useState<Map<number, number> | null>(null);
  const [runs, setRuns] = useState(1);
  const [cfg, setCfg] = useState<InstallCfg>(loadCfg);
  const [open, setOpen] = useState<Set<number>>(new Set());
  // F1b: sistemas (para índice + seguridad), índice de coste y adjusted_price (el VEO usa ESTE).
  const [sys, setSys] = useState<{ id: number; n: string; s: number }[] | null>(null);
  const [idx, setIdx] = useState<Record<string, number> | null>(null);
  const [adj, setAdj] = useState<Map<number, number>>(new Map());

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
  }, []);

  // Sistema elegido → seguridad (multiplicador del rig) e índice de coste (ESI, público).
  const sysHit = useMemo(
    () =>
      cfg.system.trim()
        ? (sys ?? []).find((x) => x.n.toLowerCase() === cfg.system.trim().toLowerCase()) ?? null
        : null,
    [sys, cfg.system],
  );
  const secMult = sysHit ? secMultOf(sysHit.s) : 1;
  useEffect(() => {
    if (!sysHit) {
      setIdx(null);
      return;
    }
    invoke<Record<string, number>>("get_industry_index", { systemId: sysHit.id })
      .then(setIdx)
      .catch(() => setIdx(null));
  }, [sysHit?.id]);

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

  const saveCfg = (c: InstallCfg) => {
    setCfg(c);
    localStorage.setItem(CFG_KEY, JSON.stringify(c));
  };

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
      const f = matFactor(me ?? 0, cfg, secMult);
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
  }, [ind, bp, runs, cfg, secMult, open, meOf, bpByProduct]);

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
    const brutoTotal = bruto * (1 - cfg.structCost / 100);
    const tax = veo * (cfg.facilityTax / 100);
    const ccs = veo * CCS_SURCHARGE;
    return { veo, faltan, index, bruto, brutoTotal, tax, ccs, total: brutoTotal + tax + ccs };
  }, [act, adj, runs, idx, cfg.structCost, cfg.facilityTax]);
  const product = act?.out?.[0]?.[0];
  const perRun = act?.out?.[0]?.[1] ?? 1;
  const maxRuns = bp.quantity === -1 ? 1_000_000 : Math.max(1, bp.runs);
  const rigEff = (cfg.rigMe * secMult).toFixed(2);

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
        <label title={tr("El % de «MODIFICADORES DEL CONSUMO DE MATERIALES» del tooltip de tu estructura. NO el de duración del trabajo ni el de coste del trabajo: tu estructura tiene tres bonos distintos con el mismo nombre.")}>
          {tr("Estructura: materiales")}{" "}
          <input
            type="number"
            step="0.1"
            value={cfg.structMat}
            onChange={(e) => saveCfg({ ...cfg, structMat: Number(e.target.value) || 0 })}
          />{" "}
          %
        </label>
        <label title={tr("Valor BASE del rig de material (T1 ≈ 2,0 · T2 ≈ 2,4). NO el % que muestra EVE: ese ya viene multiplicado por la seguridad y redondeado.")}>
          {tr("Rig ME base")}{" "}
          <input
            type="number"
            step="0.1"
            value={cfg.rigMe}
            onChange={(e) => saveCfg({ ...cfg, rigMe: Number(e.target.value) || 0 })}
          />{" "}
          %
        </label>
        <label title={tr("El sistema de tu estructura. De él salen el índice de coste (ESI) y el multiplicador de seguridad del rig: no hace falta que los pongas tú.")}>
          {tr("Sistema")}{" "}
          <input
            style={{ width: "6.5rem" }}
            value={cfg.system}
            onChange={(e) => saveCfg({ ...cfg, system: e.target.value })}
            placeholder="C-J6MT"
          />
        </label>
        <label title={tr("Bonificación de COSTE DEL TRABAJO de la estructura (va sobre el bruto, no sobre el VEO)")}>
          {tr("Estructura: coste")}{" "}
          <input
            type="number"
            step="0.1"
            value={cfg.structCost}
            onChange={(e) => saveCfg({ ...cfg, structCost: Number(e.target.value) || 0 })}
          />{" "}
          %
        </label>
        <label title={tr("Impuesto del centro (sobre el VEO)")}>
          {tr("Impuesto centro")}{" "}
          <input
            type="number"
            step="0.1"
            value={cfg.facilityTax}
            onChange={(e) => saveCfg({ ...cfg, facilityTax: Number(e.target.value) || 0 })}
          />{" "}
          %
        </label>
        <span className="muted">
          {sysHit
            ? `${tr("sec")} ${sysHit.s.toFixed(1)} → ${tr("rig efectivo")} ${rigEff}%${
                idx?.manufacturing != null
                  ? ` · ${tr("índice")} ${(idx.manufacturing * 100).toFixed(2)}%`
                  : ""
              }`
            : cfg.system.trim()
              ? tr("sistema no encontrado")
              : tr("elige sistema para el coste")}
        </span>
      </div>
      <p className="muted small">
        {tr("Ojo: tu estructura tiene TRES bonos con el mismo nombre (duración, consumo de materiales y coste del trabajo). Aquí solo cuenta el de CONSUMO DE MATERIALES. Y el rig se pide en su valor BASE (T1 ≈ 2,0 · T2 ≈ 2,4) porque el % que muestra EVE ya viene multiplicado por la seguridad y redondeado — con el de pantalla el árbol miente.")}
      </p>

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
              {tr("Sin índice de coste: elige un sistema válido para calcular el coste del trabajo.")}
            </div>
          ) : (
            <>
              <div className="bom-cost-row muted">
                <span>
                  {tr("Índice de coste en sistema")} ({(cost.index * 100).toFixed(2)}%)
                </span>
                <span>{fmtIsk(cost.bruto!)}</span>
              </div>
              {cfg.structCost > 0 && (
                <div className="bom-cost-row muted">
                  <span>
                    {tr("Bonificación de estructura")} (−{cfg.structCost}%)
                  </span>
                  <span>−{fmtIsk(cost.bruto! - cost.brutoTotal!)}</span>
                </div>
              )}
              <div className="bom-cost-row muted">
                <span>
                  {tr("Impuesto de centro")} ({cfg.facilityTax}% VEO)
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
 *  Los nombres de grupo salen del SDE y YA vienen bilingües (`n` EN / `ne` ES). Idea de Zigor. */
function BlueprintLibrary({ subject, global }: { subject: number | "global"; global?: boolean }) {
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
      {bom && <BomPanel bp={bom} owned={bps} subject={subject} onClose={() => setBom(null)} />}
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
