// Sección PvP: killmails (eficacia ISK, actividad de combate) con scrub temporal de tendencia
// y vista tabla/gráfica. Extraído de App.tsx. TrendScrub/ViewToggle son internos de esta vista.
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { tr } from "./i18n";
import { fmtIsk, fmtSp, shipIcon, zkillUrl, daysAgo, weekKey } from "./format";
import { Kpi, Bars, Th, MultiLineProgress, RangePresets } from "./charts";
import { loadNewEden } from "./neweden";
import type { PvpStats, PvpTrendPoint, KillmailRow, NameCount, TopSeriesPoint, GamelogPvpRow, GamelogPvpDay } from "./types";

// ---- Gráfica ÚNICA de actividad PvP ----
// Unifica tendencia (Kills/Losses) + top naves + top sistemas en una sola multilínea.
// Todas las series se alinean por semana ISO (weekKey) y se eligen con chips por grupo.

// Paletas locales: evitan chocar con el verde de Kills y el rojo de Losses.
const SHIP_COLORS = ["#4f9cff", "#a371f7", "#d29922", "#db61a2", "#6e7681"];
const SYS_COLORS = ["#2dd4bf", "#f0883e", "#c9adf9", "#8b949e", "#58d0ff"];

// Deployables y POS sin prefijo de sistema en el nombre (CRAB Beacon, torres, aduanas,
// contenedores…): el parser no los puede marcar como estructura (kind=3 exige "SYS - "), pero el
// TIPO los delata. La misma regla filtra la tabla cara a cara Y la serie de la gráfica.
const STRUCT_TYPES =
  /control tower|customs office|container|beacon|jammer|cyno|jump gate|array|battery|silo|bunker|depot|mobile |skyhook/i;

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
  pvpDays,
  from,
  to,
}: {
  trend: PvpTrendPoint[];
  shipSeries: TopSeriesPoint[] | null;
  sysSeries: TopSeriesPoint[] | null;
  shipNames: NameCount[];
  sysNames: NameCount[];
  /// Serie diaria del gamelog (daño contra jugadores, naves/drones). null = sin datos/escaneo.
  pvpDays: GamelogPvpDay[] | null;
  from: string;
  to: string;
}) {
  // Magnitud de la gráfica. Kills y daño NO comparten eje (miles vs millones): cada una el suyo,
  // como en Rateo. "dmg" = daño real contra jugadores del gamelog, peleas sin killmail incluidas.
  const [mag, setMag] = useState<"kills" | "dmg">("kills");
  // Series visibles (por clave). Por defecto, la tendencia de la magnitud activa.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(["kills", "losses"]));
  const toggle = (k: string) =>
    setSelected((prev) => {
      const nx = new Set(prev);
      if (nx.has(k)) nx.delete(k);
      else nx.add(k);
      return nx;
    });
  const switchMag = (m: "kills" | "dmg") => {
    setMag(m);
    setSelected(new Set(m === "kills" ? ["kills", "losses"] : ["gdado", "grecibido"]));
  };

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

  // --- Magnitud "Daño PvP (gamelog)": daño dado/recibido semanal + top-5 rivales del rango. ---
  // Fuera deployables (CRAB/POS/aduanas, por tipo): esto va de peleas contra gente.
  const pvpSel = (pvpDays ?? []).filter(
    (p) => (!from || p.date >= from) && (!to || p.date <= to) && !STRUCT_TYPES.test(p.ship)
  );
  const sDado = mkSeries("gdado", tr("Daño dado"), "#3fb950");
  const sRecibido = mkSeries("grecibido", tr("Daño recibido"), "#e5534b");
  const rivalTotals = new Map<string, number>();
  for (const p of pvpSel) {
    addPt(p.done ? sDado : sRecibido, p.date, p.dmg);
    // El ranking de rivales cruza ambos sentidos: quien más te pegó también cuenta.
    rivalTotals.set(p.pilot, (rivalTotals.get(p.pilot) ?? 0) + p.dmg);
  }
  const rivalNames = [...rivalTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => n);
  const rivals = rivalNames.map((n, i) => mkSeries(`r${n}`, n, SHIP_COLORS[i % SHIP_COLORS.length]));
  const rivalBy = new Map(rivalNames.map((n, i) => [n, rivals[i]]));
  for (const p of pvpSel) {
    const s = rivalBy.get(p.pilot);
    if (s) addPt(s, p.date, p.dmg);
  }

  const pool = mag === "kills" ? [sKills, sLosses, ...ships, ...systems] : [sDado, sRecibido, ...rivals];
  const active = pool.filter((s) => selected.has(s.key));

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

  const dmgDado = pvpSel.reduce((a, p) => a + (p.done ? p.dmg : 0), 0);
  const dmgRecibido = pvpSel.reduce((a, p) => a + (p.done ? 0 : p.dmg), 0);

  return (
    <div className="trend-chart">
      <div className="multiline-legend">
        {/* Conmutador de magnitud: killmails (ESI/zKill) o daño contra jugadores (gamelog).
            Solo aparece si el gamelog aportó datos; sin escaneo, la gráfica es la de siempre. */}
        {(pvpDays?.length ?? 0) > 0 && (
          <span className="tabs" style={{ marginRight: "0.4rem" }}>
            {(["kills", "dmg"] as const).map((m) => (
              <button key={m} className={`tab ${mag === m ? "active" : ""}`} onClick={() => switchMag(m)}>
                {m === "kills" ? "Kills" : tr("Daño PvP (gamelog)")}
              </button>
            ))}
          </span>
        )}
        {mag === "kills" ? (
          <>
            <span className="muted small">{tr("Tendencia")}:</span>
            {chip(sKills)}
            {chip(sLosses)}
            {ships.length > 0 && <span className="muted small">· {tr("Naves")}:</span>}
            {ships.map(chip)}
            {systems.length > 0 && <span className="muted small">· {tr("Sistemas")}:</span>}
            {systems.map(chip)}
          </>
        ) : (
          <>
            <span className="muted small">{tr("Daño")}:</span>
            {chip(sDado)}
            {chip(sRecibido)}
            {rivals.length > 0 && <span className="muted small">· {tr("Rivales")}:</span>}
            {rivals.map(chip)}
          </>
        )}
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

      {mag === "kills" ? (
        <div className="kpis" style={{ marginTop: "0.6rem" }}>
          <Kpi label="Kills" value={fmtSp(kills)} tone="pos" />
          <Kpi label="Losses" value={fmtSp(losses)} tone="neg" />
          <Kpi label={tr("ISK destruido")} value={fmtIsk(iskD)} tone="pos" />
          <Kpi label={tr("ISK perdido")} value={fmtIsk(iskL)} tone="neg" />
          <Kpi label={tr("Eficacia")} value={`${eff.toFixed(0)}%`} tone={eff >= 50 ? "pos" : "neg"} />
        </div>
      ) : (
        <div className="kpis" style={{ marginTop: "0.6rem" }}>
          <Kpi label={tr("Daño dado")} value={fmtSp(dmgDado)} tone="pos" />
          <Kpi label={tr("Daño recibido")} value={fmtSp(dmgRecibido)} tone="neg" />
          <Kpi label={tr("Rivales")} value={fmtSp(rivalTotals.size)} />
          {/* Es daño del log de combate, no muertes: la honestidad de siempre. */}
        </div>
      )}
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
  /// Latidos de datos (App): relanzan las peticiones internas al sincronizar/escanear,
  /// para que la gráfica abierta cambie sola según pasan las cosas.
  syncTick?: number;
  glTick?: number;
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
    syncTick,
    glTick,
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
  // Serie diaria del PvP del gamelog (daño contra jugadores) para la magnitud "Daño PvP".
  const [pvpDays, setPvpDays] = useState<GamelogPvpDay[] | null>(null);
  useEffect(() => {
    let alive = true;
    invoke<GamelogPvpDay[]>("get_gamelog_pvp_series", { subjectId: subjectChar ?? 0 })
      .then((r) => alive && setPvpDays(r))
      .catch(() => alive && setPvpDays(null));
    return () => {
      alive = false;
    };
    // glTick: al acabar un escaneo de gamelogs, la serie de daño PvP se refresca sola.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectChar, glTick]);
  useEffect(() => {
    let alive = true;
    // Sin reset a null: en el refresco de fondo (syncTick) los datos se intercambian en sitio,
    // sin parpadeo — la gráfica "se mueve", no se apaga y enciende.
    invoke<TopSeriesPoint[]>("get_pvp_top_series", { characterId: subjectChar ?? null, dim: shipDim })
      .then((r) => {
        if (alive) setShipSeries(r);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectChar, shipDim, syncTick]);
  useEffect(() => {
    let alive = true;
    invoke<TopSeriesPoint[]>("get_pvp_top_series", { characterId: subjectChar ?? null, dim: "system" })
      .then((r) => {
        if (alive) setSysSeries(r);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectChar, syncTick]);
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
                pvpDays={pvpDays}
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

      {/* Cara a cara del gamelog: daño real contra jugadores, CON y SIN killmail. */}
      <GamelogPvpBlock subjectChar={subjectChar ?? null} glTick={glTick} />
    </>
  );
}

// ---- PvP del gamelog (#45): contra quién pegaste y quién te pegó, del log de combate. ----
// Lo que zKill nunca tendrá: las peleas sin killmail. La misma honestidad que Daño por arma:
// esto es DAÑO y fallos, no muertes — y tu propia nave el gamelog no la dice.
function GamelogPvpBlock({ subjectChar, glTick }: { subjectChar: number | null; glTick?: number }) {
  const [rows, setRows] = useState<GamelogPvpRow[]>([]);
  const [kind, setKind] = useState<"ships" | "structs">("ships");
  useEffect(() => {
    let alive = true;
    invoke<GamelogPvpRow[]>("get_gamelog_pvp", { subjectId: subjectChar ?? 0 })
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
    // glTick: la tabla se refresca sola al completar un escaneo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectChar, glTick]);

  // Fusiona dado/recibido por (piloto, ticker): una fila por rival, con ambos sentidos.
  // (STRUCT_TYPES, arriba: deployables/POS sin prefijo van a la pestaña Estructuras.)
  type Face = {
    pilot: string;
    ticker: string;
    ship: string;
    dmgDone: number;
    shotsDone: number;
    wrecks: number;
    missesDone: number;
    dmgTaken: number;
    shotsTaken: number;
    missesTaken: number;
    last: string;
  };
  const faces = new Map<string, Face>();
  for (const r of rows) {
    const wantStructs = kind === "structs";
    const isStruct = r.kind === 3 || STRUCT_TYPES.test(r.ship);
    if (isStruct !== wantStructs) continue;
    const k = `${r.pilot}|${r.ticker}`;
    const f =
      faces.get(k) ??
      ({
        pilot: r.pilot,
        ticker: r.ticker,
        ship: "",
        dmgDone: 0,
        shotsDone: 0,
        wrecks: 0,
        missesDone: 0,
        dmgTaken: 0,
        shotsTaken: 0,
        missesTaken: 0,
        last: "",
      } as Face);
    if (r.ship && (!f.ship || r.dmg > 0)) f.ship = r.ship; // la nave con la que más se le vio
    if (r.done) {
      f.dmgDone += r.dmg;
      f.shotsDone += r.shots;
      f.wrecks += r.wrecks;
      f.missesDone += r.misses;
    } else {
      f.dmgTaken += r.dmg;
      f.shotsTaken += r.shots;
      f.missesTaken += r.misses;
    }
    if (r.last > f.last) f.last = r.last;
    faces.set(k, f);
  }
  const list = [...faces.values()].sort(
    (a, b) => b.dmgDone + b.dmgTaken - (a.dmgDone + a.dmgTaken)
  );
  const TOP = 30;
  const shown = list.slice(0, TOP);

  return (
    <>
      <div className="km-header" style={{ marginTop: "1.5rem" }}>
        <h4>⚔️ {tr("Cara a cara (gamelog)")}</h4>
        <div className="km-filters">
          {(["ships", "structs"] as const).map((k) => (
            <button key={k} className={`tab ${kind === k ? "active" : ""}`} onClick={() => setKind(k)}>
              {k === "ships" ? tr("Naves y drones") : tr("Estructuras")}
            </button>
          ))}
        </div>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        {tr("Daño real contra jugadores, con y sin killmail — del log de combate, desde 2019. Daño y fallos, no muertes.")}
      </p>
      {list.length === 0 ? (
        <p className="muted small">
          {tr("Sin datos todavía: reescanea tus gamelogs en ⚙️ Ajustes → Logs de EVE para poblar esta tabla.")}
        </p>
      ) : (
        <>
          <table className="km-table">
            <thead>
              <tr>
                <th>{kind === "structs" ? tr("Estructura") : tr("Piloto")}</th>
                <th>{kind === "structs" ? tr("Tipo") : tr("Nave")}</th>
                <th title={tr("Daño que le hiciste")}>{tr("Daño dado")}</th>
                <th title={tr("Golpes · de ellos wrecking")}>{tr("Golpes")}</th>
                <th title={tr("Tus disparos que no acertaron")}>{tr("Fallos")}</th>
                <th title={tr("Daño que te hizo")}>{tr("Daño recibido")}</th>
                <th title={tr("Sus disparos que no te acertaron")}>{tr("Te falló")}</th>
                <th>{tr("Última vez")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((f) => (
                <tr key={`${f.pilot}|${f.ticker}`}>
                  <td title={f.ticker ? `[${f.ticker}]` : undefined}>
                    {f.pilot}
                    {f.ticker && <span className="muted small"> [{f.ticker}]</span>}
                  </td>
                  <td className="muted">{f.ship || "-"}</td>
                  <td>{f.dmgDone > 0 ? fmtSp(f.dmgDone) : "-"}</td>
                  <td>
                    {f.shotsDone > 0 ? fmtSp(f.shotsDone) : "-"}
                    {f.wrecks > 0 && <span className="muted small"> · {fmtSp(f.wrecks)}💥</span>}
                  </td>
                  <td className="muted">{f.missesDone > 0 ? fmtSp(f.missesDone) : "-"}</td>
                  <td>{f.dmgTaken > 0 ? fmtSp(f.dmgTaken) : "-"}</td>
                  <td className="muted">{f.missesTaken > 0 ? fmtSp(f.missesTaken) : "-"}</td>
                  <td className="muted">{f.last || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length > TOP && (
            <p className="muted small">
              {tr("y")} {fmtSp(list.length - TOP)} {tr("rivales más (ordenado por daño cruzado)")}
            </p>
          )}
        </>
      )}
    </>
  );
}
