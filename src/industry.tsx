// Sección Industria: trabajos de producción activos (estado y tiempo restante) por personaje o global.
// Extraído de App.tsx. fmtRemain (formatea el tiempo restante de un job) es interno.
import { useState } from "react";
import { tr } from "./i18n";
import { fmtSp } from "./format";
import { Kpi } from "./charts";
import type { JobView } from "./types";

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

export function IndustryView(props: { jobs: JobView[] | null; busy: boolean; global?: boolean }) {
  const { jobs, busy, global } = props;
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
