// Sección Industria: trabajos de producción activos (estado y tiempo restante) por personaje o global.
// Extraído de App.tsx. fmtRemain (formatea el tiempo restante de un job) es interno.
import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr, getLang } from "./i18n";
import { fmtSp, bpIcon } from "./format";
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
              <tr key={`${b.type_id}-${i}`}>
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
