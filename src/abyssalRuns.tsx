// RUNS cronometradas (sesión + cronómetro + loot valorado + resultado), la capa DETALLADA que
// el asset-diff no puede dar: ISK/hora por tier/clima, tasa de muerte y P&L honesto (loot − naves
// perdidas). Mismo patrón que la exploración. Backend: activity_runs / run_* commands (filtrados por
// `activity`). Sirve a DOS actividades con la prop `activity`: "abyssal" (filamentos 6×5, cuenta atrás
// de 20 min) y "crab" (beacon CONCORD Rogue Analysis 60244 / variante Carrier 92183; sin clima ni tope).
// Diseño: documentacion/koru-desktop-ABYSSAL_CRAB_RUNS_diseno.md. RoGiz7, 2026-07-24 (CRAB 2026-07-28).
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { fmtIsk, typeIcon } from "./format";
import { fmtDuration } from "./signaturesControl";
import { LootPasteModal } from "./lootPasteModal";
import { buildLootIndex, parseIskShorthand, type LootIndex } from "./lootPaste";
import type { ActivityRun } from "./types";

/** Filamentos abisales: 6 tiers × 5 climas → typeID real (icono + identidad). Verificados contra el
 *  catálogo de mercado. El tope del abismo son 20 min. */
const TIERS: { t: string; n: string }[] = [
  { t: "Calm", n: "T1" },
  { t: "Agitated", n: "T2" },
  { t: "Fierce", n: "T3" },
  { t: "Raging", n: "T4" },
  { t: "Chaotic", n: "T5" },
  { t: "Cataclysmic", n: "T6" },
];
const WEATHERS = ["Dark", "Electrical", "Exotic", "Firestorm", "Gamma"];
// Colores canónicos de los climas abisales del juego (para teñir la caja de sesión y las pestañas).
const WEATHER_COLORS: Record<string, string> = {
  Dark: "#8b5cf6", // violeta
  Electrical: "#38bdf8", // azul
  Exotic: "#34d399", // verde
  Firestorm: "#fb7185", // rojo/coral
  Gamma: "#fbbf24", // dorado
};
const weatherColor = (w?: string | null): string => (w && WEATHER_COLORS[w]) || "#4f9cff";
// Color por resultado de la run (verde/rojo/gris), para virar la caja al terminar y lavar las filas.
const outcomeColor = (o?: string | null): string =>
  o === "done" ? "#34d399" : o === "died" ? "#ff6b6b" : "#8b949e";
const FILAMENTS: Record<string, Record<string, number>> = {
  Calm: { Dark: 47762, Electrical: 47765, Exotic: 47761, Firestorm: 47763, Gamma: 47764 },
  Agitated: { Dark: 47892, Electrical: 47904, Exotic: 47888, Firestorm: 47896, Gamma: 47900 },
  Fierce: { Dark: 47893, Electrical: 47905, Exotic: 47889, Firestorm: 47897, Gamma: 47901 },
  Raging: { Dark: 47894, Electrical: 47906, Exotic: 47890, Firestorm: 47898, Gamma: 47902 },
  Chaotic: { Dark: 47895, Electrical: 47907, Exotic: 47891, Firestorm: 47899, Gamma: 47903 },
  Cataclysmic: { Dark: 56140, Electrical: 56139, Exotic: 56141, Firestorm: 56142, Gamma: 56143 },
};
const ABYSS_LIMIT_MS = 20 * 60 * 1000;

/** Beacons CRAB (CONCORD Rogue Analysis Beacon): estándar + variante Carrier. Sin tier/clima.
 *  Nombres verificados contra public/market_types.json. */
const CRAB_BEACONS: { id: number; name: string }[] = [
  { id: 60244, name: "CONCORD Rogue Analysis Beacon" },
  { id: 92183, name: "CONCORD-Carrier Rogue Analysis Beacon" },
];

/** Catálogo de naves (public/ships.json) para la nave OPCIONAL de la run (P&L por nave). */
type ShipEntry = { i: number; n: string; g: string };

// Filtro de tiempo del histórico (ventana rodante), igual que en Exploración.
const PERIODS: { key: string; label: string; ms: number }[] = [
  { key: "day", label: "Día", ms: 24 * 3600e3 },
  { key: "week", label: "Semana", ms: 7 * 24 * 3600e3 },
  { key: "month", label: "Mes", ms: 30 * 24 * 3600e3 },
  { key: "year", label: "Año", ms: 365 * 24 * 3600e3 },
  { key: "all", label: "Todo", ms: 0 },
];

function fmtMMSS(ms: number): string {
  const neg = ms < 0;
  const s = Math.floor(Math.abs(ms) / 1000);
  return `${neg ? "-" : ""}${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function AbyssalRunsView({
  charId,
  activity = "abyssal",
}: {
  charId?: number | null;
  activity?: "abyssal" | "crab";
}) {
  const isCrab = activity === "crab";
  const [active, setActive] = useState<ActivityRun | null>(null);
  const [runs, setRuns] = useState<ActivityRun[]>([]);
  const [tier, setTier] = useState("Raging");
  const [weather, setWeather] = useState("Gamma");
  const [beacon, setBeacon] = useState(CRAB_BEACONS[0].id); // beacon elegido (solo CRAB)
  // Nave OPCIONAL con la que corres (datalist de ships.json → typeID). Recomendación 8.3: no bloquea.
  const [ships, setShips] = useState<ShipEntry[]>([]);
  const [shipName, setShipName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  // Fin de run: resultado elegido + botín + nave perdida (si muerte).
  const [finishing, setFinishing] = useState<null | "done" | "died" | "aborted">(null);
  const [finLoot, setFinLoot] = useState("");
  const [finShipLoss, setFinShipLoss] = useState("");
  const [lootOpen, setLootOpen] = useState(false);
  // A dónde va el botín pegado: "finish" (panel de terminar) o el id de una fila en edición.
  const [lootTarget, setLootTarget] = useState<"finish" | number>("finish");
  const [lootIndex, setLootIndex] = useState<LootIndex>(new Map());
  // Edición en línea de una run ya cerrada (corregir botín / nave olvidados) vía run_set.
  const [editId, setEditId] = useState<number | null>(null);
  const [editLoot, setEditLoot] = useState("");
  const [editShip, setEditShip] = useState("");
  const [now, setNow] = useState(Date.now());
  const [period, setPeriod] = useState<string>("all"); // filtro de tiempo del histórico
  const [filTab, setFilTab] = useState<string>("all"); // pestaña por filamento ("all" = todos)

  // Reloj para el cronómetro en vivo (1 s).
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    buildLootIndex().then(setLootIndex);
    fetch("/ships.json")
      .then((r) => r.json())
      .then(setShips)
      .catch(() => {});
  }, []);

  async function reload() {
    try {
      const [a, list] = await Promise.all([
        invoke<ActivityRun | null>("run_active", { activity, characterId: charId ?? null }),
        invoke<ActivityRun[]>("run_list", { activity }),
      ]);
      setActive(a ?? null);
      setRuns(charId == null ? list : list.filter((r) => r.character_id === charId || r.character_id == null));
    } catch (e) {
      setMsg(`${tr("Error")}: ${String(e).slice(0, 160)}`);
    }
  }
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charId, activity]);

  // Variante a iniciar: filamento (tier+clima) en abisales; beacon en CRAB.
  const crabBeacon = CRAB_BEACONS.find((b) => b.id === beacon) ?? CRAB_BEACONS[0];
  const filamentId = isCrab ? crabBeacon.id : FILAMENTS[tier]?.[weather];
  // Nave elegida (match exacto, sin distinguir mayúsculas). Vacío o sin match = null (opcional).
  const shipMatch = useMemo(() => {
    const q = shipName.trim().toLowerCase();
    return q ? (ships.find((s) => s.n.toLowerCase() === q) ?? null) : null;
  }, [ships, shipName]);

  async function startRun() {
    if (!filamentId) return;
    setBusy(true);
    setMsg("");
    try {
      await invoke<number>("run_start", {
        activity,
        variantId: filamentId,
        variantName: isCrab ? crabBeacon.name : `${tier} ${weather} Filament`,
        tier: isCrab ? null : tier,
        weather: isCrab ? null : weather,
        systemId: null,
        systemName: "",
        shipTypeId: shipMatch?.i ?? null,
        characterId: charId ?? null,
      });
      await reload();
    } catch (e) {
      setMsg(`${tr("Error")}: ${String(e).slice(0, 160)}`);
    } finally {
      setBusy(false);
    }
  }

  async function endRun() {
    if (!active || !finishing) return;
    setBusy(true);
    setMsg("");
    try {
      await invoke("run_end", {
        id: active.id,
        outcome: finishing,
        lootIsk: finishing === "aborted" ? null : parseIskShorthand(finLoot),
        lootNote: null,
        shipLossIsk: finishing === "died" ? parseIskShorthand(finShipLoss) : null,
        note: null,
      });
      setFinishing(null);
      setFinLoot("");
      setFinShipLoss("");
      await reload();
    } catch (e) {
      setMsg(`${tr("Error")}: ${String(e).slice(0, 160)}`);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(r: ActivityRun) {
    setEditId(r.id);
    setEditLoot(r.loot_isk != null ? String(r.loot_isk) : "");
    setEditShip(r.ship_loss_isk != null ? String(r.ship_loss_isk) : "");
  }
  async function saveEdit(r: ActivityRun) {
    setBusy(true);
    setMsg("");
    try {
      await invoke("run_set", {
        id: r.id,
        lootIsk: parseIskShorthand(editLoot),
        lootNote: null,
        shipLossIsk: r.outcome === "died" ? parseIskShorthand(editShip) : (r.ship_loss_isk ?? null),
        note: null,
      });
      setEditId(null);
      await reload();
    } catch (e) {
      setMsg(`${tr("Error")}: ${String(e).slice(0, 160)}`);
    } finally {
      setBusy(false);
    }
  }

  // Ventana de tiempo elegida (día/semana/mes/año/todo), sobre la fecha de fin (o inicio si sigue abierta).
  const periodMs = PERIODS.find((p) => p.key === period)?.ms ?? 0;
  const periodRows = useMemo(
    () => (periodMs === 0 ? runs : runs.filter((r) => now - new Date(r.ended_at ?? r.started_at).getTime() <= periodMs)),
    [runs, periodMs, now],
  );
  // Pestañas por variante presentes en la ventana: tier+clima (abisales) o nombre del beacon (CRAB).
  const filTabs = useMemo(() => {
    const m = new Map<string, { label: string; variantId: number | null; weather: string | null; n: number }>();
    for (const r of periodRows) {
      const key = r.tier || r.weather ? `${r.tier ?? "?"} ${r.weather ?? ""}`.trim() : r.variant_name || "?";
      const e = m.get(key) ?? { label: r.variant_name || key, variantId: r.variant_id, weather: r.weather, n: 0 };
      e.n += 1;
      m.set(key, e);
    }
    return [...m.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.n - a.n);
  }, [periodRows]);
  const filKey = (r: ActivityRun) =>
    r.tier || r.weather ? `${r.tier ?? "?"} ${r.weather ?? ""}`.trim() : r.variant_name || "?";
  const viewRows = useMemo(
    () => (filTab === "all" ? periodRows : periodRows.filter((r) => filKey(r) === filTab)),
    [periodRows, filTab],
  );

  // Estadísticas de las runs finalizadas (no abortadas): P&L honesto y tasa de muerte.
  const stats = useMemo(() => {
    let n = 0,
      deaths = 0,
      loot = 0,
      shipLoss = 0,
      ms = 0;
    for (const r of viewRows) {
      if (r.outcome === "aborted") continue;
      n += 1;
      if (r.outcome === "died") deaths += 1;
      loot += r.loot_isk ?? 0;
      shipLoss += r.ship_loss_isk ?? 0;
      const d = r.ended_at ? new Date(r.ended_at).getTime() - new Date(r.started_at).getTime() : 0;
      if (d > 0) ms += d;
    }
    const net = loot - shipLoss;
    const hours = ms / 3_600_000;
    return { n, deaths, loot, shipLoss, net, hours, iskPerHour: hours > 0 ? net / hours : 0 };
  }, [viewRows]);

  // P&L POR NAVE (sobre la vista filtrada): ahora que la nave se registra, responde «¿con qué nave
  // gano más por hora y muero menos?». Solo runs con nave anotada (las sin nave no entran aquí).
  const shipStats = useMemo(() => {
    const m = new Map<number, { n: number; deaths: number; loot: number; shipLoss: number; ms: number }>();
    for (const r of viewRows) {
      if (r.outcome === "aborted" || r.ship_type_id == null) continue;
      const e = m.get(r.ship_type_id) ?? { n: 0, deaths: 0, loot: 0, shipLoss: 0, ms: 0 };
      e.n += 1;
      if (r.outcome === "died") e.deaths += 1;
      e.loot += r.loot_isk ?? 0;
      e.shipLoss += r.ship_loss_isk ?? 0;
      const d = r.ended_at ? new Date(r.ended_at).getTime() - new Date(r.started_at).getTime() : 0;
      if (d > 0) e.ms += d;
      m.set(r.ship_type_id, e);
    }
    return [...m.entries()]
      .map(([tid, v]) => ({
        tid,
        ...v,
        net: v.loot - v.shipLoss,
        iskH: v.ms > 0 ? (v.loot - v.shipLoss) / (v.ms / 3_600_000) : 0,
      }))
      .sort((a, b) => b.net - a.net);
  }, [viewRows]);
  const shipNameOf = (tid: number) => ships.find((s) => s.i === tid)?.n ?? `#${tid}`;

  const elapsed = active ? now - new Date(active.started_at).getTime() : 0;
  const remaining = ABYSS_LIMIT_MS - elapsed; // solo abisales (tope duro de 20 min; CRAB no tiene)
  // La caja en curso se tiñe por el clima del filamento (CRAB: azul CONCORD por defecto);
  // al elegir resultado vira a verde/rojo/gris.
  const activeCol = finishing ? outcomeColor(finishing) : weatherColor(active?.weather);
  const startCol = isCrab ? weatherColor(null) : weatherColor(weather);

  return (
    <div className="abyss-runs">
      <h4 style={{ marginBottom: 4 }}>⏱️ {tr("Runs cronometradas")}</h4>

      {/* ---- Sesión: iniciar o en curso ---- */}
      {active ? (
        <div
          className="abyss-active"
          style={{ background: `linear-gradient(90deg, ${activeCol}26, transparent 70%)`, borderColor: `${activeCol}88` }}
        >
          {active.variant_id && (
            <img className="kind-glyph" src={typeIcon(active.variant_id, 32)} alt="" style={{ width: 22, height: 22 }} />
          )}
          <strong>{active.variant_name}</strong>
          {active.ship_type_id && (
            <img className="kind-glyph" src={typeIcon(active.ship_type_id, 32)} alt="" title={tr("Nave de la run")} style={{ width: 20, height: 20, borderRadius: 3 }} />
          )}
          <span className="abyss-timer">{fmtMMSS(elapsed)}</span>
          {!isCrab && (
            <span className={`abyss-count small${remaining < 2 * 60 * 1000 ? " danger" : ""}`}>
              {remaining >= 0 ? `${tr("quedan")} ${fmtMMSS(remaining)}` : `${tr("pasado")} ${fmtMMSS(remaining)}`}
            </span>
          )}
          {finishing == null ? (
            <span className="abyss-end-btns">
              <button className="pp-add" onClick={() => setFinishing("done")}>✓ {tr("Completada")}</button>
              <button className="pp-add sig-del-btn" onClick={() => setFinishing("died")}>💀 {tr("Muerto")}</button>
              <button className="pp-add" onClick={() => setFinishing("aborted")} disabled={busy}>✕ {tr("Abortada")}</button>
            </span>
          ) : finishing === "aborted" ? (
            <span className="abyss-end-btns">
              <button className="pp-add" onClick={endRun} disabled={busy}>{tr("Confirmar abortar")}</button>
              <button className="pp-add" onClick={() => setFinishing(null)} disabled={busy}>{tr("Cancelar")}</button>
            </span>
          ) : (
            <span className="abyss-finish">
              <span className="small muted">{tr("Botín")}:</span>
              <input className="small" value={finLoot} onChange={(e) => setFinLoot(e.target.value)} placeholder={tr("ISK (p.ej. 45m)")} style={{ width: 100 }} />
              <button className="pp-add" onClick={() => { setLootTarget("finish"); setLootOpen(true); }}>📋 {tr("Pegar loot")}</button>
              {finishing === "died" && (
                <>
                  <span className="small muted">{tr("Nave perdida")}:</span>
                  <input className="small" value={finShipLoss} onChange={(e) => setFinShipLoss(e.target.value)} placeholder={tr("ISK")} style={{ width: 100 }} />
                </>
              )}
              <button className="pp-add" onClick={endRun} disabled={busy}>{tr("Guardar run")}</button>
              <button className="pp-add" onClick={() => setFinishing(null)} disabled={busy}>{tr("Cancelar")}</button>
            </span>
          )}
        </div>
      ) : (
        <div
          className="abyss-active abyss-start"
          style={{ background: `linear-gradient(90deg, ${startCol}1c, transparent 70%)`, borderColor: `${startCol}66` }}
        >
          {isCrab ? (
            <select className="small" value={beacon} onChange={(e) => setBeacon(Number(e.target.value))}>
              {CRAB_BEACONS.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          ) : (
            <>
              <select className="small" value={tier} onChange={(e) => setTier(e.target.value)}>
                {TIERS.map((t) => (
                  <option key={t.t} value={t.t}>{t.n} · {t.t}</option>
                ))}
              </select>
              <select className="small" value={weather} onChange={(e) => setWeather(e.target.value)}>
                {WEATHERS.map((w) => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
            </>
          )}
          {filamentId && <img className="kind-glyph" src={typeIcon(filamentId, 32)} alt="" style={{ width: 22, height: 22 }} />}
          <input
            className="small"
            list="run-ships"
            value={shipName}
            onChange={(e) => setShipName(e.target.value)}
            placeholder={tr("Nave (opcional)")}
            style={{ width: 130 }}
          />
          <datalist id="run-ships">
            {ships.map((s) => (
              <option key={s.i} value={s.n}>{s.g}</option>
            ))}
          </datalist>
          {shipMatch && (
            <img className="kind-glyph" src={typeIcon(shipMatch.i, 32)} alt="" title={shipMatch.n} style={{ width: 22, height: 22 }} />
          )}
          <button className="pp-add" onClick={startRun} disabled={busy || !filamentId}>▶ {tr("Iniciar run")}</button>
        </div>
      )}

      {/* ---- Estadísticas + histórico de runs ---- */}
      {runs.length > 0 && (
        <>
          {/* Filtro de tiempo (ventana rodante). */}
          <div className="explog-periods">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                className={`explog-period${period === p.key ? " on" : ""}`}
                onClick={() => setPeriod(p.key)}
              >
                {tr(p.label)}
              </button>
            ))}
          </div>

          {/* Pestañas por filamento (tier+clima). */}
          <div className="sig-btabs">
            <button className={`sig-btab${filTab === "all" ? " on" : ""}`} onClick={() => setFilTab("all")}>
              {tr("Todos")} <span className="muted">({periodRows.length})</span>
            </button>
            {filTabs.map((f) => (
              <button
                key={f.key}
                className={`sig-btab${filTab === f.key ? " on" : ""}`}
                onClick={() => setFilTab(f.key)}
                style={{ borderLeft: `3px solid ${weatherColor(f.weather)}` }}
              >
                {f.variantId && <img className="kind-glyph" src={typeIcon(f.variantId, 32)} alt="" />} {f.label}{" "}
                <span className="muted">({f.n})</span>
              </button>
            ))}
          </div>

          <div className="explog-stats" style={{ marginTop: "0.6rem" }}>
            <div className="explog-stat">
              <div className="explog-stat-n">{stats.n}</div>
              <div className="explog-stat-l small muted">{tr("runs")}</div>
            </div>
            <div className="explog-stat">
              <div className="explog-stat-n">{fmtIsk(stats.net)}</div>
              <div className="explog-stat-l small muted">{tr("P&L neto (ISK)")}</div>
            </div>
            <div className="explog-stat">
              <div className="explog-stat-n">{fmtIsk(stats.iskPerHour)}</div>
              <div className="explog-stat-l small muted">{tr("ISK/hora neto")}</div>
            </div>
            <div className="explog-stat">
              <div className="explog-stat-n">{stats.n > 0 ? Math.round((stats.deaths / stats.n) * 100) : 0}%</div>
              <div className="explog-stat-l small muted">{tr("tasa de muerte")}</div>
            </div>
          </div>

          {/* P&L por nave (solo si hay runs con nave anotada en la vista actual). */}
          {shipStats.length > 0 && (
            <>
              <h4 style={{ margin: "0.6rem 0 0.2rem" }}>🚀 {tr("Por nave")}</h4>
              <table className="small sig-table">
                <thead>
                  <tr className="sig-th">
                    <th>{tr("Nave")}</th>
                    <th style={{ textAlign: "right" }}>{tr("runs")}</th>
                    <th style={{ textAlign: "right" }}>{tr("tasa de muerte")}</th>
                    <th style={{ textAlign: "right" }}>{tr("P&L neto (ISK)")}</th>
                    <th style={{ textAlign: "right" }}>{tr("ISK/hora neto")}</th>
                  </tr>
                </thead>
                <tbody>
                  {shipStats.map((s) => (
                    <tr key={s.tid}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <img className="kind-glyph" src={typeIcon(s.tid, 32)} alt="" style={{ borderRadius: 3 }} /> {shipNameOf(s.tid)}
                      </td>
                      <td style={{ textAlign: "right" }}>{s.n}</td>
                      <td style={{ textAlign: "right" }} className={s.deaths > 0 ? "abyss-died" : ""}>
                        {Math.round((s.deaths / s.n) * 100)}%
                      </td>
                      <td style={{ textAlign: "right" }}>{fmtIsk(s.net)}</td>
                      <td style={{ textAlign: "right" }}>{fmtIsk(s.iskH)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <table className="small sig-table" style={{ marginTop: "0.4rem" }}>
            <thead>
              <tr className="sig-th">
                <th>{tr("Fecha")}</th>
                <th>{isCrab ? tr("Beacon") : tr("Filamento")}</th>
                <th>{tr("Duración")}</th>
                <th>{tr("Resultado")}</th>
                <th style={{ textAlign: "right" }}>{tr("Botín")}</th>
                <th style={{ textAlign: "right" }}>{tr("Nave perdida")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {viewRows.map((r) => (
                <tr
                  key={r.id}
                  style={{
                    background: `linear-gradient(90deg, ${outcomeColor(r.outcome)}14, transparent 60%)`,
                    borderLeft: `3px solid ${outcomeColor(r.outcome)}`,
                  }}
                >
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{(r.ended_at ?? r.started_at).slice(0, 10)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {r.variant_id && <img className="kind-glyph" src={typeIcon(r.variant_id, 32)} alt="" />} {r.variant_name}
                    {r.ship_type_id && (
                      <img className="kind-glyph" src={typeIcon(r.ship_type_id, 32)} alt="" title={tr("Nave de la run")} style={{ marginLeft: 4, borderRadius: 3 }} />
                    )}
                  </td>
                  <td className="muted">{fmtDuration(r.started_at, r.ended_at) ?? "—"}</td>
                  <td className={r.outcome === "died" ? "abyss-died" : ""}>
                    {r.outcome === "died" ? `💀 ${tr("Muerto")}` : r.outcome === "aborted" ? tr("Abortada") : `✓ ${tr("Completada")}`}
                  </td>
                  {editId === r.id ? (
                    <>
                      <td style={{ textAlign: "right" }}>
                        <input className="small" value={editLoot} onChange={(e) => setEditLoot(e.target.value)} placeholder={tr("ISK (p.ej. 45m)")} style={{ width: 90 }} />
                        <button className="sig-done-btn" title={tr("Pegar loot")} onClick={() => { setLootTarget(r.id); setLootOpen(true); }}>📋</button>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {r.outcome === "died" ? (
                          <input className="small" value={editShip} onChange={(e) => setEditShip(e.target.value)} placeholder={tr("ISK")} style={{ width: 80 }} />
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button className="sig-done-btn" title={tr("Guardar")} onClick={() => saveEdit(r)} disabled={busy}>✓</button>
                        <button className="sig-done-btn" title={tr("Cancelar")} onClick={() => setEditId(null)} disabled={busy}>✕</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={{ textAlign: "right" }}>{r.loot_isk != null ? fmtIsk(r.loot_isk) : <span className="muted">—</span>}</td>
                      <td style={{ textAlign: "right" }} className="abyss-died">
                        {r.ship_loss_isk != null ? `-${fmtIsk(r.ship_loss_isk)}` : <span className="muted">—</span>}
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button className="sig-done-btn" title={tr("Editar")} onClick={() => startEdit(r)} disabled={busy || r.outcome === "aborted"}>✏️</button>
                        <button className="sig-done-btn" title={tr("Eliminar")} onClick={() => invoke("run_delete", { id: r.id }).then(reload)} disabled={busy}>🗑</button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <LootPasteModal
        open={lootOpen}
        siteCount={1}
        index={lootIndex}
        busy={busy}
        title={tr("Botín de la run")}
        confirmLabel={tr("Usar botín")}
        onCancel={() => setLootOpen(false)}
        onConfirm={(isk) => {
          if (isk != null) {
            if (lootTarget === "finish") setFinLoot(String(isk));
            else setEditLoot(String(isk));
          }
          setLootOpen(false);
        }}
      />

      {msg && <div className="small muted">{msg}</div>}
    </div>
  );
}
