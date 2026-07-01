// Sección Actividad: actividad diaria de killmails y horas calientes (UTC EVE), por mes.
// Extraído de App.tsx. KLColumns (columnas horarias) y KLLegend (leyenda) son internos.
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { fmtIsk, fmtSp, MONTH_NAMES } from "./format";
import type { PvpActivity } from "./types";

function KLColumns({
  items,
  labelEvery = 1,
}: {
  items: { label: string; kills: number; losses: number }[];
  labelEvery?: number;
}) {
  if (items.length === 0) return <p className="muted small">{tr("Sin actividad.")}</p>;
  const max = Math.max(...items.map((i) => i.kills + i.losses), 1);
  return (
    <div className="klcols">
      {items.map((it, i) => (
        <div
          className="klcol"
          key={i}
          title={`${it.label} · ${it.kills} kills / ${it.losses} losses`}
        >
          <div className="klcol-bars">
            <div className="klcol-loss" style={{ height: `${(it.losses / max) * 100}%` }} />
            <div className="klcol-kill" style={{ height: `${(it.kills / max) * 100}%` }} />
          </div>
          <span className="klcol-label">{i % labelEvery === 0 ? it.label : ""}</span>
        </div>
      ))}
    </div>
  );
}

export function ActividadView({ subject }: { subject: number | "global" }) {
  const isGlobal = subject === "global";
  const [periods, setPeriods] = useState<string[] | null>(null);
  const [period, setPeriod] = useState<string>("");
  const [data, setData] = useState<PvpActivity | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const ps = isGlobal
          ? await invoke<string[]>("get_pvp_periods_global")
          : await invoke<string[]>("get_pvp_periods", { characterId: subject });
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
          ? await invoke<PvpActivity>("get_pvp_activity_global", { period })
          : await invoke<PvpActivity>("get_pvp_activity", { characterId: subject, period });
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
        {tr("Sin killmails registrados. Sincroniza el PvP de tus personajes para ver tu actividad.")}
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
            const first = periods.find((p) => p.startsWith(e.target.value));
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
          <div className="resumen-kpis act-kpis">
            <div className="rk-card rk-in">
              <span className="rk-label">{tr("Kills")}</span>
              <span className="rk-value pos">{fmtSp(data.kills)}</span>
              <span className="muted small">{fmtIsk(data.isk_destroyed)} ISK</span>
            </div>
            <div className="rk-card rk-out">
              <span className="rk-label">{tr("Losses")}</span>
              <span className="rk-value neg">{fmtSp(data.losses)}</span>
              <span className="muted small">{fmtIsk(data.isk_lost)} ISK</span>
            </div>
            <div className="rk-card rk-net">
              <span className="rk-label">{tr("Eficacia ISK")}</span>
              <span className="rk-value">{data.efficiency.toFixed(1)}%</span>
            </div>
          </div>

          <div className="top-list">
            <h4>{tr("Actividad diaria")} · {tr(MONTH_NAMES[parseInt(curMonth, 10) - 1])} {curYear}</h4>
            <KLColumns
              items={data.daily.map((d) => ({
                label: d.date.slice(8, 10),
                kills: d.kills,
                losses: d.losses,
              }))}
            />
            <KLLegend />
          </div>

          <div className="top-list">
            <h4>🔥 {tr("Horas calientes (UTC EVE)")}</h4>
            <KLColumns
              items={data.hourly.map((h) => ({
                label: String(h.hour).padStart(2, "0"),
                kills: h.kills,
                losses: h.losses,
              }))}
            />
            <KLLegend />
          </div>
        </>
      )}
    </>
  );
}

function KLLegend() {
  return (
    <div className="kl-legend">
      <span>
        <span className="kl-dot kl-dot-kill" /> {tr("Kills")}
      </span>
      <span>
        <span className="kl-dot kl-dot-loss" /> {tr("Losses")}
      </span>
    </div>
  );
}

/* ---------- Minería pro ---------- */
