// Sección PvP: killmails (eficacia ISK, actividad de combate) con scrub temporal de tendencia
// y vista tabla/gráfica. Extraído de App.tsx. TrendScrub/ViewToggle son internos de esta vista.
import { useState, useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { tr } from "./i18n";
import { fmtIsk, fmtSp, shipIcon, zkillUrl, MONTH_NAMES } from "./format";
import { Kpi, Bars, Th, TopList } from "./charts";
import type { PvpStats, PvpTrendPoint, KillmailRow } from "./types";

// la gráfica sombrea el tramo elegido y los KPIs se recalculan para esa ventana.
function TrendScrub({ points }: { points: PvpTrendPoint[] }) {
  const n = points.length;
  const [range, setRange] = useState<[number, number]>([0, Math.max(0, n - 1)]);
  useEffect(() => {
    setRange([0, Math.max(0, n - 1)]);
  }, [n]);

  if (n < 2)
    return <p className="muted small">Hace falta historial de varias semanas para ver la tendencia.</p>;

  const lo = Math.min(range[0], range[1]);
  const hi = Math.max(range[0], range[1]);
  const sel = points.slice(lo, hi + 1);
  const sum = (k: "kills" | "losses" | "isk_destroyed" | "isk_lost") =>
    sel.reduce((a, p) => a + p[k], 0);
  const kills = sum("kills");
  const losses = sum("losses");
  const iskD = sum("isk_destroyed");
  const iskL = sum("isk_lost");
  const eff = iskD + iskL > 0 ? (iskD / (iskD + iskL)) * 100 : 0;

  const years = [...new Set(points.map((p) => p.date.slice(0, 4)))];
  const curYear = points[lo].date.slice(0, 4);
  const curMonth = points[lo].date.slice(0, 7);
  const monthsOfYear = [
    ...new Set(points.filter((p) => p.date.startsWith(curYear)).map((p) => p.date.slice(0, 7))),
  ];
  const setToYear = (y: string) => {
    const idxs = points.map((p, i) => [p.date.slice(0, 4), i] as const).filter(([yy]) => yy === y);
    if (idxs.length) setRange([idxs[0][1], idxs[idxs.length - 1][1]]);
  };
  const setToMonth = (ym: string) => {
    const idxs = points.map((p, i) => [p.date.slice(0, 7), i] as const).filter(([mm]) => mm === ym);
    if (idxs.length) setRange([idxs[0][1], idxs[idxs.length - 1][1]]);
  };

  const W = 600;
  const H = 190;
  const PAD = 30;
  const maxY = Math.max(...points.flatMap((p) => [p.kills, p.losses]), 1);
  const x = (i: number) => PAD + (i / (n - 1)) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - (v / maxY) * (H - 2 * PAD);
  const path = (key: "kills" | "losses") =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(" ");
  const labels = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];

  return (
    <div className="trend-chart">
      <div className="resumen-period" style={{ marginBottom: "0.5rem" }}>
        <span className="rp-label">📅 Ventana</span>
        <select value={curYear} onChange={(e) => setToYear(e.target.value)}>
          {years.map((yy) => (
            <option key={yy} value={yy}>
              {yy}
            </option>
          ))}
        </select>
        <select value={curMonth} onChange={(e) => setToMonth(e.target.value)}>
          {monthsOfYear.map((m) => (
            <option key={m} value={m}>
              {MONTH_NAMES[parseInt(m.slice(5, 7), 10) - 1]}
            </option>
          ))}
        </select>
        <button className="rateo-clear" onClick={() => setRange([0, n - 1])}>
          Todo
        </button>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="trend-svg" preserveAspectRatio="none">
        <rect
          x={x(lo)}
          y={PAD - 6}
          width={Math.max(x(hi) - x(lo), 1)}
          height={H - PAD - (PAD - 6)}
          fill="#4f9cff"
          fillOpacity={0.12}
        />
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#2a3340" strokeWidth={1} />
        <path d={path("losses")} fill="none" stroke="#e5534b" strokeWidth={2} />
        <path d={path("kills")} fill="none" stroke="#3fb950" strokeWidth={2} />
        {labels.map((i) => (
          <text key={i} x={x(i)} y={H - PAD + 16} textAnchor="middle" className="trend-x">
            {points[i].date}
          </text>
        ))}
      </svg>

      <div className="scrub-sliders">
        <input
          type="range"
          min={0}
          max={n - 1}
          value={lo}
          onChange={(e) => setRange([Math.min(+e.target.value, hi), hi])}
        />
        <input
          type="range"
          min={0}
          max={n - 1}
          value={hi}
          onChange={(e) => setRange([lo, Math.max(+e.target.value, lo)])}
        />
      </div>
      <div className="muted small">
        {points[lo].date} → {points[hi].date} · {sel.length} semanas
      </div>

      <div className="kpis" style={{ marginTop: "0.6rem" }}>
        <Kpi label="Kills" value={fmtSp(kills)} tone="pos" />
        <Kpi label="Losses" value={fmtSp(losses)} tone="neg" />
        <Kpi label="ISK destruido" value={fmtIsk(iskD)} tone="pos" />
        <Kpi label="ISK perdido" value={fmtIsk(iskL)} tone="neg" />
        <Kpi label="Eficacia" value={`${eff.toFixed(0)}%`} tone={eff >= 50 ? "pos" : "neg"} />
      </div>

      <div className="trend-legend">
        <span>
          <span className="ldot" style={{ background: "#3fb950" }} /> Kills
        </span>
        <span>
          <span className="ldot" style={{ background: "#e5534b" }} /> Losses
        </span>
      </div>
    </div>
  );
}

// Tendencia de Wallet con scrub: ingresos/gastos por mes, ventana deslizante y KPIs del tramo.
// Conmutador Tabla / Gráfica reutilizable.
function ViewToggle({ chart, onChange }: { chart: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="view-toggle">
      <div className="seg">
        <button className={!chart ? "active" : ""} onClick={() => onChange(false)}>
          {tr("Tabla")}
        </button>
        <button className={chart ? "active" : ""} onClick={() => onChange(true)}>
          {tr("Gráfica")}
        </button>
      </div>
    </div>
  );
}

export function PvpView(props: {
  stats: PvpStats | null;
  trend?: PvpTrendPoint[] | null;
  busy: boolean;
  progress: { processed: number; page: number } | null;
  elapsed: number;
  global?: boolean;
  onSync?: () => void;
  onSyncFull?: () => void;
  onReprocess?: () => void;
  onCancel?: () => void;
  onExport?: () => void;
  kmRows: KillmailRow[];
  kmTotal: number;
  kmKind: "all" | "kill" | "loss";
  kmOffset: number;
  kmLimit: number;
  onKmKind: (k: "all" | "kill" | "loss") => void;
  onKmPage: (offset: number) => void;
}) {
  const {
    stats,
    trend,
    busy,
    progress,
    elapsed,
    global,
    onSync,
    onSyncFull,
    onReprocess,
    onCancel,
    onExport,
    kmRows,
    kmTotal,
    kmKind,
    kmOffset,
    kmLimit,
    onKmKind,
    onKmPage,
  } = props;
  const [chart, setChart] = useState(true); // PvP por defecto en Gráfica
  const [kmSort, setKmSort] = useState<{ col: string; dir: 1 | -1 }>({ col: "date", dir: -1 });
  const onKmSort = (col: string) =>
    setKmSort((s) => (s.col === col ? { col, dir: s.dir === 1 ? -1 : 1 } : { col, dir: 1 }));
  const kmSorted = [...kmRows].sort((a, b) => {
    const d = kmSort.dir;
    switch (kmSort.col) {
      case "type":
        return ((a.is_loss ? 1 : 0) - (b.is_loss ? 1 : 0)) * d;
      case "ship":
        return (a.ship_name ?? "").localeCompare(b.ship_name ?? "") * d;
      case "sys":
        return (a.system_name ?? "").localeCompare(b.system_name ?? "") * d;
      case "dmg":
        return ((a.char_damage ?? 0) - (b.char_damage ?? 0)) * d;
      case "isk":
        return ((a.isk_value ?? 0) - (b.isk_value ?? 0)) * d;
      default:
        return (a.killed_at ?? "").localeCompare(b.killed_at ?? "") * d;
    }
  });
  return (
    <>
      {!global && (
        <div className="pvp-toolbar">
          <button onClick={onSync} disabled={busy}>
            {busy ? tr("Trabajando…") : tr("Sincronizar recientes")}
          </button>
          <button onClick={onSyncFull} disabled={busy}>
            {tr("Sincronizar histórico (zKill)")}
          </button>
          <button onClick={onReprocess} disabled={busy} title={tr("Recalcula daño, final blow y nave víctima desde la caché")}>
            {tr("Reprocesar daño")}
          </button>
          <button onClick={onExport}>{tr("Exportar CSV")}</button>
        </div>
      )}
      {progress !== null && (
        <div className="sync-progress">
          <span className="spinner" />
          <span>
            {tr("Trabajando…")} <strong>{fmtSp(progress.processed)}</strong> killmails
            {progress.page > 0 ? ` (${tr("página")} ${progress.page})` : ""} · {elapsed}s
          </span>
          <span className="muted small">{tr("No cierres la app.")}</span>
          <button className="danger" onClick={onCancel}>
            {tr("Cancelar")}
          </button>
        </div>
      )}
      {!stats && busy && <p className="muted">{tr("Cargando…")}</p>}
      {stats && (
        <>
          <div className="kpis">
            <Kpi label={tr("Kills")} value={stats.kills} />
            <Kpi label={tr("Losses")} value={stats.losses} />
            <Kpi label={tr("Solo kills")} value={stats.solo_kills} />
            <Kpi label={tr("Final blows")} value={stats.final_blows} />
            <Kpi label={tr("Top damage")} value={stats.top_damage_kills} />
            <Kpi label={tr("Eficacia ISK")} value={`${stats.efficiency.toFixed(1)}%`} tone={stats.efficiency >= 50 ? "pos" : "neg"} />
            <Kpi label={tr("ISK destruido")} value={fmtIsk(stats.isk_destroyed)} tone="pos" />
            <Kpi label={tr("ISK perdido")} value={fmtIsk(stats.isk_lost)} tone="neg" />
          </div>
          <ViewToggle chart={chart} onChange={setChart} />
          {chart ? (
            <>
              <div className="top-list">
                <h4>{tr("Tendencia (kills/losses por semana) · arrastra para enfocar una ventana")}</h4>
                {trend ? <TrendScrub points={trend} /> : <p className="muted small">{tr("Cargando…")}</p>}
              </div>
              <div className="tops">
                <div className="top-list">
                  <h4>{tr("Top naves")}</h4>
                  <Bars items={stats.top_ships.map((s) => ({ label: s.name ?? `#${s.id}`, value: s.count }))} />
                </div>
                <div className="top-list">
                  <h4>{tr("Top sistemas")}</h4>
                  <Bars
                    items={stats.top_systems.map((s) => ({ label: s.name ?? `#${s.id}`, value: s.count }))}
                    color="#e3a13a"
                  />
                </div>
              </div>
              <div className="tops">
                <div className="top-list">
                  <h4>{tr("Kills vs Losses")}</h4>
                  <Bars
                    items={[
                      { label: tr("Kills"), value: stats.kills },
                      { label: tr("Losses"), value: stats.losses },
                    ]}
                    color="#3fb950"
                  />
                </div>
                <div className="top-list">
                  <h4>{tr("ISK destruido vs perdido")}</h4>
                  <Bars
                    items={[
                      { label: tr("Destruido"), value: stats.isk_destroyed },
                      { label: tr("Perdido"), value: stats.isk_lost },
                    ]}
                    color="#e5534b"
                    fmt={fmtIsk}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="tops">
              <TopList title={tr("Top naves")} items={stats.top_ships} icon="render" />
              <div className="top-list">
                <h4>{tr("Top sistemas")}</h4>
                {stats.top_systems.length === 0 && <p className="muted small">{tr("Sin datos.")}</p>}
                <ol>
                  {stats.top_systems.map((it) => (
                    <li key={it.id}>
                      {it.name ?? `#${it.id}`} <span className="muted">({it.count})</span>
                      {it.region && <span className="region"> · {it.region}</span>}
                      {it.name && (
                        <button
                          className="dotlan-link"
                          title={`${tr("Ver")} ${it.name} ${tr("en Dotlan")}`}
                          onClick={() =>
                            openUrl(`https://evemaps.dotlan.net/system/${it.name!.replace(/ /g, "_")}`)
                          }
                        >
                          🗺
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}

          {stats.top_expensive.length > 0 && (
            <>
              <h4>{tr("Kills más caros")}</h4>
              <table className="km-table">
                <thead>
                  <tr>
                    <th>{tr("Nave destruida")}</th>
                    <th>{tr("Sistema")}</th>
                    <th>ISK</th>
                    <th>{tr("Fecha")}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.top_expensive.map((k) => (
                    <tr
                      key={k.killmail_id}
                      className="clickable kill"
                      onClick={() => openUrl(zkillUrl(k.killmail_id))}
                      title={tr("Abrir en zKillboard")}
                    >
                      <td className="ship-cell">
                        {shipIcon(k.victim_ship_id) && (
                          <img className="ship-img" src={shipIcon(k.victim_ship_id)!} alt="" loading="lazy" />
                        )}
                        <span>{k.victim_ship_name ?? (k.victim_ship_id ?? "-")}</span>
                      </td>
                      <td>{k.system_name ?? (k.system_id ?? "-")}</td>
                      <td>{k.isk_value ? fmtIsk(k.isk_value) : "-"}</td>
                      <td>{k.killed_at?.replace("T", " ").slice(0, 16) ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}

      <div className="km-header">
        <h4>Killmails</h4>
        <div className="km-filters">
          {(["all", "kill", "loss"] as const).map((k) => (
            <button
              key={k}
              className={`tab ${kmKind === k ? "active" : ""}`}
              onClick={() => onKmKind(k)}
            >
              {k === "all" ? tr("Todos") : k === "kill" ? tr("Kills") : tr("Losses")}
            </button>
          ))}
        </div>
      </div>
      <table className="km-table">
        <thead>
          <tr>
            <Th label={tr("Tipo")} col="type" sort={kmSort} onSort={onKmSort} />
            <Th label={tr("Nave")} col="ship" sort={kmSort} onSort={onKmSort} />
            <Th label={tr("Sistema")} col="sys" sort={kmSort} onSort={onKmSort} />
            <Th label={tr("Daño")} col="dmg" sort={kmSort} onSort={onKmSort} />
            <Th label="ISK" col="isk" sort={kmSort} onSort={onKmSort} />
            <Th label={tr("Fecha")} col="date" sort={kmSort} onSort={onKmSort} />
          </tr>
        </thead>
        <tbody>
          {kmSorted.map((k) => (
            <tr
              key={k.killmail_id}
              className={`clickable ${k.is_loss ? "loss" : "kill"}`}
              onClick={() => openUrl(zkillUrl(k.killmail_id))}
              title={tr("Abrir en zKillboard")}
            >
              <td>
                {k.is_loss ? "loss" : "kill"}
                {!k.is_loss && k.solo ? " · solo" : ""}
                {k.final_blow && <span className="badge fb">FB</span>}
                {k.top_damage && <span className="badge td">TD</span>}
              </td>
              <td className="ship-cell">
                {shipIcon(k.ship_type_id) && (
                  <img className="ship-img" src={shipIcon(k.ship_type_id)!} alt="" loading="lazy" />
                )}
                <span>{k.ship_name ?? (k.ship_type_id ?? "-")}</span>
              </td>
              <td>{k.system_name ?? (k.system_id ?? "-")}</td>
              <td>{k.char_damage != null ? fmtSp(k.char_damage) : "-"}</td>
              <td>{k.isk_value ? fmtIsk(k.isk_value) : "-"}</td>
              <td>{k.killed_at?.replace("T", " ").slice(0, 16) ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="km-pager">
        <button disabled={kmOffset <= 0} onClick={() => onKmPage(Math.max(0, kmOffset - kmLimit))}>
          ← {tr("Anterior")}
        </button>
        <span className="muted">
          {kmTotal === 0
            ? tr("Sin killmails")
            : `${kmOffset + 1}–${Math.min(kmOffset + kmLimit, kmTotal)} ${tr("de")} ${fmtSp(kmTotal)}`}
        </span>
        <button
          disabled={kmOffset + kmLimit >= kmTotal}
          onClick={() => onKmPage(kmOffset + kmLimit)}
        >
          {tr("Siguiente")} →
        </button>
      </div>
    </>
  );
}
