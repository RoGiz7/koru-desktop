// Sección Resumen: balance del mes, ingresos/gastos por categoría con comparativa vs mes previo.
// Extraído de App.tsx. DeltaBadge (variación %) y CatTable (tabla por categoría) son internos.
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { fmtIsk, MONTH_NAMES } from "./format";
import { Donut, DONUT_COLORS } from "./charts";
import type { FinancialSummary, CategorySum } from "./types";

// Fecha (YYYY-MM-DD) de hace N días, para acotar las gráficas a una ventana reciente por defecto.
function DeltaBadge({ cur, prev, invert = false }: { cur: number; prev: number; invert?: boolean }) {
  let txt: string;
  let dir: number; // 1 sube, -1 baja, 0 igual
  if (prev === 0) {
    if (cur === 0) {
      txt = "—";
      dir = 0;
    } else {
      txt = tr("nuevo");
      dir = 1;
    }
  } else {
    const p = ((cur - prev) / Math.abs(prev)) * 100;
    const arrow = p > 0 ? "↑" : p < 0 ? "↓" : "→";
    txt = `${arrow} ${Math.abs(p).toFixed(1)}%`;
    dir = p > 0.05 ? 1 : p < -0.05 ? -1 : 0;
  }
  const good = invert ? dir < 0 : dir > 0;
  const bad = invert ? dir > 0 : dir < 0;
  const cls = good ? "delta-pos" : bad ? "delta-neg" : "delta-flat";
  return <span className={`delta ${cls}`}>{txt}</span>;
}

function CatTable({ rows, invert }: { rows: CategorySum[]; invert: boolean }) {
  if (rows.length === 0) return <p className="muted small">{tr("Sin movimientos.")}</p>;
  return (
    <table className="km-table cat-table">
      <thead>
        <tr>
          <th>{tr("Categoría")}</th>
          <th style={{ textAlign: "right" }}>ISK</th>
          <th style={{ textAlign: "right" }}>{tr("vs anterior")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>
              <span className="cat-dot" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
              {tr(r.category)}
            </td>
            <td style={{ textAlign: "right" }}>{fmtIsk(r.isk)}</td>
            <td style={{ textAlign: "right" }}>
              <DeltaBadge cur={r.isk} prev={r.prev_isk} invert={invert} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ResumenView({ subject }: { subject: number | "global" }) {
  const isGlobal = subject === "global";
  const [periods, setPeriods] = useState<string[] | null>(null);
  const [period, setPeriod] = useState<string>("");
  const [data, setData] = useState<FinancialSummary | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const ps = isGlobal
          ? await invoke<string[]>("get_summary_periods_global")
          : await invoke<string[]>("get_summary_periods", { characterId: subject });
        if (!alive) return;
        setPeriods(ps);
        setPeriod((p) => (p && ps.includes(p) ? p : ps[0] ?? ""));
      } catch {
        if (alive) setPeriods([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [subject]);

  useEffect(() => {
    if (!period) return;
    let alive = true;
    setBusy(true);
    (async () => {
      try {
        const d = isGlobal
          ? await invoke<FinancialSummary>("get_summary_global", { period })
          : await invoke<FinancialSummary>("get_summary", { characterId: subject, period });
        if (alive) setData(d);
      } catch {
        if (alive) setData(null);
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [subject, period]);

  if (periods === null) return <p className="muted">{tr("Cargando…")}</p>;
  if (periods.length === 0)
    return (
      <p className="muted small">
        {tr("Sin movimientos en el journal. Sincroniza la wallet de tus personajes (sección Wallet) para ver tu resumen.")}
      </p>
    );

  const years = [...new Set(periods.map((p) => p.slice(0, 4)))];
  const curYear = period.slice(0, 4);
  const curMonth = period.slice(5, 7);
  const monthsOfYear = periods.filter((p) => p.startsWith(curYear));

  return (
    <>
      <div className="resumen-period">
        <span className="rp-label">📅 {tr("Período")}</span>
        <select
          value={curYear}
          onChange={(e) => {
            const y = e.target.value;
            const first = periods.find((p) => p.startsWith(y));
            if (first) setPeriod(first);
          }}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <select value={period} onChange={(e) => setPeriod(e.target.value)}>
          {monthsOfYear.map((p) => (
            <option key={p} value={p}>
              {tr(MONTH_NAMES[parseInt(p.slice(5, 7), 10) - 1])}
            </option>
          ))}
        </select>
        <span className="rp-show">
          {tr("Mostrando")} {tr(MONTH_NAMES[parseInt(curMonth, 10) - 1])} {curYear}
          {busy ? ` · ${tr("actualizando…")}` : ""}
        </span>
      </div>

      {data && (
        <>
          <div className="resumen-kpis">
            <div className="rk-card rk-net">
              <span className="rk-label">{tr("Balance del mes")}</span>
              <span className={`rk-value ${data.net >= 0 ? "pos" : "neg"}`}>{fmtIsk(data.net)} ISK</span>
              <DeltaBadge cur={data.net} prev={data.prev_net} />
            </div>
            <div className="rk-card rk-in">
              <span className="rk-label">↑ {tr("Ingresos")}</span>
              <span className="rk-value pos">{fmtIsk(data.income_total)}</span>
              <DeltaBadge cur={data.income_total} prev={data.prev_income_total} />
            </div>
            <div className="rk-card rk-out">
              <span className="rk-label">↓ {tr("Gastos")}</span>
              <span className="rk-value neg">{fmtIsk(data.expense_total)}</span>
              <DeltaBadge cur={data.expense_total} prev={data.prev_expense_total} invert />
            </div>
          </div>

          <div className="resumen-grid">
            <div className="panel resumen-panel">
              <h4>{tr("Distribución de ingresos")}</h4>
              <Donut items={data.income_by_category.map((c) => ({ label: c.category, value: c.isk }))} fmt={fmtIsk} />
            </div>
            <div className="panel resumen-panel">
              <h4>{tr("Ingresos por categoría")}</h4>
              <CatTable rows={data.income_by_category} invert={false} />
            </div>
            <div className="panel resumen-panel">
              <h4>{tr("Distribución de gastos")}</h4>
              <Donut items={data.expense_by_category.map((c) => ({ label: c.category, value: c.isk }))} fmt={fmtIsk} />
            </div>
            <div className="panel resumen-panel">
              <h4>{tr("Gastos por categoría")}</h4>
              <CatTable rows={data.expense_by_category} invert={true} />
            </div>
          </div>
        </>
      )}
    </>
  );
}

/* ---------- Actividad PvP (diaria + horas calientes) ---------- */
