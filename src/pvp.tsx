// Sección PvP: killmails (eficacia ISK, actividad de combate) con scrub temporal de tendencia
// y vista tabla/gráfica. Extraído de App.tsx. TrendScrub/ViewToggle son internos de esta vista.
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { tr } from "./i18n";
import { fmtIsk, fmtSp, shipIcon, zkillUrl, daysAgo, weekKey } from "./format";
import { Kpi, Bars, Th, MultiLineProgress, RangePresets } from "./charts";
import { loadNewEden } from "./neweden";
import type { PvpStats, PvpTrendPoint, KillmailRow, NameCount, TopSeriesPoint } from "./types";

// ---- Gráfica ÚNICA de actividad PvP ----
// Unifica tendencia (Kills/Losses) + top naves + top sistemas en una sola multilínea.
// Todas las series se alinean por semana ISO (weekKey) y se eligen con chips por grupo.

// Paletas locales: evitan chocar con el verde de Kills y el rojo de Losses.
const SHIP_COLORS = ["#4f9cff", "#a371f7", "#d29922", "#db61a2", "#6e7681"];
const SYS_COLORS = ["#2dd4bf", "#f0883e", "#c9adf9", "#8b949e", "#58d0ff"];

type USeries = {
  key: string;
  name: string;
  color: string;
  counts: Map<string, number>;
  dates: Map<string, string>;
};

function mkSeries(key: string, name: string, color: string): USeries {
  return { key, name, color, counts: new Map(), dates: new Map() };
}

function addPt(s: USeries, date: string, count: number) {
  const w = weekKey(date);
  s.counts.set(w, (s.counts.get(w) ?? 0) + count);
  const c = s.dates.get(w);
  if (!c || date < c) s.dates.set(w, date);
}

/// Convierte los puntos de un top (naves/sistemas) en series: rankea DENTRO del rango
/// (el backend manda 12 candidatos del histórico) y se queda con los 5 mayores.
function topOf(
  points: TopSeriesPoint[] | null,
  names: NameCount[],
  from: string,
  to: string,
  colors: string[],
  prefix: string
): USeries[] {
  if (!points) return [];
  const nameOf = new Map(names.map((n) => [n.id, n.name ?? `#${n.id}`]));
  const pts = points.filter((p) => (!from || p.date >= from) && (!to || p.date <= to));
  const totals = new Map<number, number>();
  for (const p of pts) totals.set(p.id, (totals.get(p.id) ?? 0) + p.count);
  const ids = [...totals.keys()].sort((a, b) => totals.get(b)! - totals.get(a)!).slice(0, 5);
  const nameById = new Map<number, string>();
  for (const p of pts) if (p.name) nameById.set(p.id, p.name);
  const defs = ids.map((id, i) =>
    mkSeries(`${prefix}${id}`, nameById.get(id) ?? nameOf.get(id) ?? `#${id}`, colors[i % colors.length])
  );
  const byId = new Map(ids.map((id, i) => [id, defs[i]]));
  for (const p of pts) {
    const d = byId.get(p.id);
    if (d) addPt(d, p.date, p.count);
  }
  return defs;
}

function UnifiedPvpChart({
  trend,
  shipSeries,
  sysSeries,
  shipNames,
  sysNames,
  from,
  to,
}: {
  trend: PvpTrendPoint[];
  shipSeries: TopSeriesPoint[] | null;
  sysSeries: TopSeriesPoint[] | null;
  shipNames: NameCount[];
  sysNames: NameCount[];
  from: string;
  to: string;
}) {
  // Series visibles (por clave). Por defecto, la tendencia.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(["kills", "losses"]));
  const toggle = (k: string) =>
    setSelected((prev) => {
      const nx = new Set(prev);
      if (nx.has(k)) nx.delete(k);
      else nx.add(k);
      return nx;
    });

  if (trend.length < 2)
    return <p className="muted small">{tr("Hace falta historial de varias semanas para ver la tendencia.")}</p>;

  const trendSel = trend.filter((p) => (!from || p.date >= from) && (!to || p.date <= to));
  const kills = trendSel.reduce((a, p) => a + p.kills, 0);
  const losses = trendSel.reduce((a, p) => a + p.losses, 0);
  const iskD = trendSel.reduce((a, p) => a + p.isk_destroyed, 0);
  const iskL = trendSel.reduce((a, p) => a + p.isk_lost, 0);
  const eff = iskD + iskL > 0 ? (iskD / (iskD + iskL)) * 100 : 0;

  const sKills = mkSeries("kills", "Kills", "#3fb950");
  const sLosses = mkSeries("losses", "Losses", "#e5534b");
  for (const p of trendSel) {
    addPt(sKills, p.date, p.kills);
    addPt(sLosses, p.date, p.losses);
  }
  const ships = topOf(shipSeries, shipNames, from, to, SHIP_COLORS, "n");
  const systems = topOf(sysSeries, sysNames, from, to, SYS_COLORS, "s");
  const active = [sKills, sLosses, ...ships, ...systems].filter((s) => selected.has(s.key));

  // Semanas = unión de las series activas; etiqueta = primera fecha vista en esa semana.
  const weekDates = new Map<string, string>();
  for (const s of active)
    for (const [w, d] of s.dates) {
      const c = weekDates.get(w);
      if (!c || d < c) weekDates.set(w, d);
    }
  const weeks = [...weekDates.keys()].sort((a, b) =>
    weekDates.get(a)! < weekDates.get(b)! ? -1 : 1
  );
  const labels = weeks.map((w) => weekDates.get(w)!);
  const series = active.map((s) => ({
    name: s.name,
    color: s.color,
    values: weeks.map((w) => s.counts.get(w) ?? 0),
  }));

  const chip = (s: USeries) => (
    <button
      key={s.key}
      className={`mll-chip${selected.has(s.key) ? " active" : ""}`}
      onClick={() => toggle(s.key)}
      title={s.name}
    >
      <i style={{ background: s.color }} /> {s.name}
    </button>
  );

  return (
    <div className="trend-chart">
      <div className="multiline-legend">
        <span className="muted small">{tr("Tendencia")}:</span>
        {chip(sKills)}
        {chip(sLosses)}
        {ships.length > 0 && <span className="muted small">· {tr("Naves")}:</span>}
        {ships.map(chip)}
        {systems.length > 0 && <span className="muted small">· {tr("Sistemas")}:</span>}
        {systems.map(chip)}
      </div>

      {active.length === 0 ? (
        <p className="muted small">{tr("Elige al menos una serie en la leyenda.")}</p>
      ) : weeks.length >= 2 ? (
        <MultiLineProgress labels={labels} series={series} fmt={fmtSp} legend={false} />
      ) : (
        <p className="muted small">{tr("Sin datos en el rango elegido.")}</p>
      )}
      {labels.length > 0 && (
        <div className="muted small">
          {labels[0]} → {labels[labels.length - 1]} · {labels.length} {tr("semanas")}
        </div>
      )}

      <div className="kpis" style={{ marginTop: "0.6rem" }}>
        <Kpi label="Kills" value={fmtSp(kills)} tone="pos" />
        <Kpi label="Losses" value={fmtSp(losses)} tone="neg" />
        <Kpi label={tr("ISK destruido")} value={fmtIsk(iskD)} tone="pos" />
        <Kpi label={tr("ISK perdido")} value={fmtIsk(iskL)} tone="neg" />
        <Kpi label={tr("Eficacia")} value={`${eff.toFixed(0)}%`} tone={eff >= 50 ? "pos" : "neg"} />
      </div>
    </div>
  );
}

// Botón "ver en Dotlan" reutilizable (kills más caros, killmails). Para el nonbre de región
// se usa el SDE local (neweden.json), a prueba de downtime y sin llamadas ESI.
function DotlanBtn({ system }: { system: string | null | undefined }) {
  if (!system) return null;
  return (
    <button
      className="dotlan-link"
      title={`${tr("Ver")} ${system} ${tr("en Dotlan")}`}
      onClick={(e) => {
        e.stopPropagation(); // la fila abre zKill; este botón solo Dotlan
        openUrl(`https://evemaps.dotlan.net/system/${system.replace(/ /g, "_")}`);
      }}
    >
      🗺
    </button>
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
  /// id del personaje activo, o null en Global (para las series de tops).
  subjectChar?: number | null;
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
    subjectChar,
  } = props;

  // Rango compartido por las tres gráficas de líneas (tendencia + tops). 90 días por defecto.
  const [from, setFrom] = useState(daysAgo(90));
  const [to, setTo] = useState("");
  const rangeYears = trend
    ? [...new Set(trend.map((p) => +p.date.slice(0, 4)))].sort((a, b) => a - b)
    : [];

  // Series semanales de los tops (del histórico local). Naves con conmutador:
  // "ship" = con las que vuelas · "victim" = las que destruyes.
  const [shipDim, setShipDim] = useState<"ship" | "victim">("ship");
  const [shipSeries, setShipSeries] = useState<TopSeriesPoint[] | null>(null);
  const [sysSeries, setSysSeries] = useState<TopSeriesPoint[] | null>(null);
  useEffect(() => {
    let alive = true;
    setShipSeries(null);
    invoke<TopSeriesPoint[]>("get_pvp_top_series", { characterId: subjectChar ?? null, dim: shipDim })
      .then((r) => {
        if (alive) setShipSeries(r);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [subjectChar, shipDim]);
  useEffect(() => {
    let alive = true;
    setSysSeries(null);
    invoke<TopSeriesPoint[]>("get_pvp_top_series", { characterId: subjectChar ?? null, dim: "system" })
      .then((r) => {
        if (alive) setSysSeries(r);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [subjectChar]);
  // Región por sistema desde el SDE local (para kills más caros y killmails).
  const [regionOf, setRegionOf] = useState<Map<number, string> | null>(null);
  useEffect(() => {
    loadNewEden()
      .then((ne) => {
        const rn = new Map(ne.regions.map((r) => [r.id, r.n]));
        setRegionOf(new Map(ne.systems.map((s) => [s.id, rn.get(s.r) ?? ""])));
      })
      .catch(() => {});
  }, []);
  const regionName = (sysId: number | null) =>
    (sysId != null ? regionOf?.get(sysId) : undefined) || null;

  const [kmSort, setKmSort] = useState<{ col: string; dir: 1 | -1 }>({ col: "date", dir: -1 });
  const onKmSort = (col: string) =>
    setKmSort((s) => (s.col === col ? { col, dir: s.dir === 1 ? -1 : 1 } : { col, dir: 1 }));
  // Columna Nave: en un KILL lo relevante es lo que DESTRUISTE (nave víctima, como zKill);
  // en una LOSS, lo que perdiste (tu nave). Tu nave en kills queda en el tooltip.
  const shownShipId = (k: (typeof kmRows)[number]) =>
    k.is_loss ? k.ship_type_id : k.victim_ship_id ?? k.ship_type_id;
  const shownShipName = (k: (typeof kmRows)[number]) =>
    k.is_loss ? k.ship_name : k.victim_ship_name ?? k.ship_name;
  const kmSorted = [...kmRows].sort((a, b) => {
    const d = kmSort.dir;
    switch (kmSort.col) {
      case "type":
        return ((a.is_loss ? 1 : 0) - (b.is_loss ? 1 : 0)) * d;
      case "ship":
        return (shownShipName(a) ?? "").localeCompare(shownShipName(b) ?? "") * d;
      case "sys":
        return (a.system_name ?? "").localeCompare(b.system_name ?? "") * d;
      case "region":
        return (regionName(a.system_id) ?? "").localeCompare(regionName(b.system_id) ?? "") * d;
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
          {/* Vista única (Tabla+Gráfica integradas): rango → tendencia → tops → tablas. */}
          <div className="rateo-controls">
            <RangePresets from={from} to={to} setFrom={setFrom} setTo={setTo} years={rangeYears} />
            <label className="rateo-date">
              {tr("Desde")} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="rateo-date">
              {tr("Hasta")} <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
          <div className="top-list">
            <h4>
              {tr("Actividad PvP")}{" "}
              <span className="muted small">· {tr("semanal · combina series en la leyenda")}</span>
            </h4>
            <div className="seg seg-sm" style={{ marginBottom: "0.4rem" }}>
              <button className={shipDim === "ship" ? "active" : ""} onClick={() => setShipDim("ship")}>
                {tr("Naves: con las que vuelas")}
              </button>
              <button className={shipDim === "victim" ? "active" : ""} onClick={() => setShipDim("victim")}>
                {tr("Naves: destruidas")}
              </button>
            </div>
            {trend ? (
              <UnifiedPvpChart
                trend={trend}
                shipSeries={shipSeries}
                sysSeries={sysSeries}
                shipNames={stats.top_ships}
                sysNames={stats.top_systems}
                from={from}
                to={to}
              />
            ) : (
              <p className="muted small">{tr("Cargando…")}</p>
            )}
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

          {stats.top_expensive.length > 0 && (
            <>
              <h4>{tr("Kills más caros")}</h4>
              <table className="km-table">
                <thead>
                  <tr>
                    <th>{tr("Nave destruida")}</th>
                    <th>{tr("Sistema")}</th>
                    <th>{tr("Región")}</th>
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
                      <td>
                        {k.system_name ?? (k.system_id ?? "-")}
                        <DotlanBtn system={k.system_name} />
                      </td>
                      <td className="muted">{regionName(k.system_id) ?? "-"}</td>
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
            <Th label={tr("Región")} col="region" sort={kmSort} onSort={onKmSort} />
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
              <td
                className="ship-cell"
                title={!k.is_loss && k.ship_name ? `${tr("Tu nave")}: ${k.ship_name}` : undefined}
              >
                {shipIcon(shownShipId(k)) && (
                  <img className="ship-img" src={shipIcon(shownShipId(k))!} alt="" loading="lazy" />
                )}
                <span>{shownShipName(k) ?? (shownShipId(k) ?? "-")}</span>
              </td>
              <td>
                {k.system_name ?? (k.system_id ?? "-")}
                <DotlanBtn system={k.system_name} />
              </td>
              <td className="muted">{regionName(k.system_id) ?? "-"}</td>
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
