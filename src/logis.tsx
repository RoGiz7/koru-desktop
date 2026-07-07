// Apartado "Logis" (Fase B): resumen de curación remota + gráfica (líneas activables, filtros
// día/semana/mes/año como el resto) + histórico de pilotos con icono de nave. Todo del gamelog local.
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { typeIcon, weekKey } from "./format";
import { MultiLineProgress, RangePresets } from "./charts";
import type { LogiSummary, LogiSeries, LogiPilot, LogiBreakdown } from "./types";

const fmtHp = (n: number) => Math.round(n).toLocaleString();
type Gran = "day" | "week" | "month" | "year";
type Mode = "type" | "pilot" | "ship" | "module";
// Paleta para las líneas del desglose (hasta 8 entidades).
const PALETTE = ["#57c785", "#5b9bd1", "#e0a458", "#c46b9e", "#8a7bd8", "#4bb6b6", "#d76a6a", "#9aa63a"];

// Agrega un desglose (fechas por día + series) a la granularidad elegida, filtrando por rango.
function aggregateBreak(bd: LogiBreakdown, gran: Gran, from: string, to: string) {
  const bkey = (d: string) =>
    gran === "year" ? d.slice(0, 4) : gran === "month" ? d.slice(0, 7) : gran === "week" ? weekKey(d) : d;
  const keySet = new Set<string>();
  const idxOf = new Map<string, number>();
  bd.dates.forEach((d) => {
    if ((from && d < from) || (to && d > to)) return;
    keySet.add(bkey(d));
  });
  const labels = [...keySet].sort();
  labels.forEach((k, i) => idxOf.set(k, i));
  const series = bd.series.map((s) => {
    const values = new Array(labels.length).fill(0);
    bd.dates.forEach((d, i) => {
      if ((from && d < from) || (to && d > to)) return;
      values[idxOf.get(bkey(d))!] += s.values[i];
    });
    return { name: s.name, values };
  });
  return { labels, series };
}

// Agrega la serie diaria a la granularidad elegida (igual que las otras gráficas), filtrando por rango.
function aggregate(s: LogiSeries, gran: Gran, from: string, to: string) {
  const bkey = (d: string) =>
    gran === "year" ? d.slice(0, 4) : gran === "month" ? d.slice(0, 7) : gran === "week" ? weekKey(d) : d;
  const map = new Map<string, number[]>();
  s.labels.forEach((d, i) => {
    if ((from && d < from) || (to && d > to)) return;
    const k = bkey(d);
    const e = map.get(k) ?? [0, 0, 0, 0, 0, 0];
    e[0] += s.given_shield[i];
    e[1] += s.given_armor[i];
    e[2] += s.given_hull[i];
    e[3] += s.recv_shield[i];
    e[4] += s.recv_armor[i];
    e[5] += s.recv_hull[i];
    map.set(k, e);
  });
  const keys = [...map.keys()].sort();
  const col = (idx: number) => keys.map((k) => map.get(k)![idx]);
  const tot = (a: number, b: number, c: number) => keys.map((k) => { const e = map.get(k)!; return e[a] + e[b] + e[c]; });
  return { labels: keys, cols: [col(0), col(1), col(2), col(3), col(4), col(5)], givenTot: tot(0, 1, 2), recvTot: tot(3, 4, 5) };
}

function PilotList({ title, pilots, shipTid }: { title: string; pilots: LogiPilot[]; shipTid: Record<string, number> }) {
  const top = pilots.slice(0, 10);
  return (
    <div className="logi-col logi-table-wrap">
      <div className="logi-dir">
        {title} <span className="muted small">(top 10)</span>
      </div>
      {top.length === 0 ? (
        <div className="muted small">—</div>
      ) : (
        <table className="logi-table">
          <thead>
            <tr>
              <th>{tr("Personaje")}</th>
              <th>{tr("Nave")}</th>
              <th>{tr("Módulo")}</th>
              <th className="lt-hp" title={tr("Escudo")}>
                <img className="hp-ico" src={typeIcon(3608, 32)} alt={tr("Escudo")} />
              </th>
              <th className="lt-hp" title={tr("Blindaje")}>
                <img className="hp-ico" src={typeIcon(26914, 32)} alt={tr("Blindaje")} />
              </th>
              <th className="lt-hp" title={tr("Casco")}>
                <img className="hp-ico" src={typeIcon(3986, 32)} alt={tr("Casco")} />
              </th>
              <th className="lt-hp">{tr("Total")}</th>
            </tr>
          </thead>
          <tbody>
            {top.map((p) => {
              const tid = p.ship ? shipTid[p.ship.toLowerCase()] : 0;
              return (
                <tr key={p.pilot}>
                  <td className="lt-char">
                    {p.char_id > 0 ? (
                      <img
                        className="lp-portrait"
                        src={`https://images.evetech.net/characters/${p.char_id}/portrait?size=32`}
                        alt=""
                        loading="lazy"
                      />
                    ) : null}
                    {p.pilot}
                  </td>
                  <td className="lt-ship">
                    {tid ? <img className="type-ico" src={typeIcon(tid, 32)} alt="" loading="lazy" /> : null}
                    <span className="muted small">{p.ship}</span>
                  </td>
                  <td className="muted small lt-mod" title={p.module}>
                    {p.module}
                  </td>
                  <td className="lt-hp">{p.hp_shield > 0 ? fmtHp(p.hp_shield) : "·"}</td>
                  <td className="lt-hp">{p.hp_armor > 0 ? fmtHp(p.hp_armor) : "·"}</td>
                  <td className="lt-hp">{p.hp_hull > 0 ? fmtHp(p.hp_hull) : "·"}</td>
                  <td className="lt-hp">
                    <strong>{fmtHp(p.hp)}</strong> <span className="muted small">· {p.reps}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function LogisView({ subject }: { subject?: number | "global" }) {
  const subjectId = typeof subject === "number" ? subject : 0;
  const [sum, setSum] = useState<LogiSummary | null>(null);
  const [series, setSeries] = useState<LogiSeries | null>(null);
  const [given, setGiven] = useState<LogiPilot[]>([]);
  const [recv, setRecv] = useState<LogiPilot[]>([]);
  const [gran, setGran] = useState<Gran>(() => (localStorage.getItem("koru-logi-gran") as Gran) || "month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [shipTid, setShipTid] = useState<Record<string, number>>({});
  const [mode, setMode] = useState<Mode>("type");
  const [bdDir, setBdDir] = useState<"given" | "received">("received");
  const [bd, setBd] = useState<LogiBreakdown | null>(null);

  useEffect(() => {
    fetch("/ship_names.json").then((r) => r.json()).then(setShipTid).catch(() => setShipTid({}));
  }, []);
  useEffect(() => {
    localStorage.setItem("koru-logi-gran", gran);
  }, [gran]);
  useEffect(() => {
    invoke<LogiSummary>("get_logi_summary", { subjectId }).then(setSum).catch(() => setSum(null));
    invoke<LogiSeries>("get_logi_series", { subjectId }).then(setSeries).catch(() => setSeries(null));
    invoke<LogiPilot[]>("get_logi_pilots", { subjectId, direction: "given" }).then(setGiven).catch(() => setGiven([]));
    invoke<LogiPilot[]>("get_logi_pilots", { subjectId, direction: "received" }).then(setRecv).catch(() => setRecv([]));
  }, [subjectId]);
  // Desglose por dimensión: se pide al backend cuando el modo no es "type".
  useEffect(() => {
    if (mode === "type") {
      setBd(null);
      return;
    }
    invoke<LogiBreakdown>("get_logi_breakdown", { subjectId, direction: bdDir, dimension: mode })
      .then(setBd)
      .catch(() => setBd(null));
  }, [subjectId, mode, bdDir]);

  const givenTot = sum ? sum.given_shield + sum.given_armor + sum.given_hull : 0;
  const recvTot = sum ? sum.recv_shield + sum.recv_armor + sum.recv_hull : 0;
  const empty = givenTot === 0 && recvTot === 0;

  const agg = series ? aggregate(series, gran, from, to) : null;
  const years = series ? [...new Set(series.labels.map((d) => +d.slice(0, 4)))].sort((a, b) => b - a) : [];
  const bdAgg = mode !== "type" && bd ? aggregateBreak(bd, gran, from, to) : null;
  const chartLabels = mode === "type" ? agg?.labels ?? [] : bdAgg?.labels ?? [];
  const chartSeries =
    mode === "type"
      ? agg
        ? [
            { name: tr("Total dado"), color: "#57c785", values: agg.givenTot },
            { name: tr("Total recibido"), color: "#5b9bd1", values: agg.recvTot },
            { name: tr("Escudo dado"), color: "#7ec8ff", values: agg.cols[0] },
            { name: tr("Blindaje dado"), color: "#ffbf69", values: agg.cols[1] },
            { name: tr("Casco dado"), color: "#d7d7d7", values: agg.cols[2] },
            { name: tr("Escudo recibido"), color: "#2e6da4", values: agg.cols[3] },
            { name: tr("Blindaje recibido"), color: "#b36b1e", values: agg.cols[4] },
            { name: tr("Casco recibido"), color: "#7a7a7a", values: agg.cols[5] },
          ].filter((s) => s.values.some((v) => v > 0))
        : []
      : bdAgg
      ? bdAgg.series
          .map((s, i) => ({ name: s.name, color: PALETTE[i % PALETTE.length], values: s.values }))
          .filter((s) => s.values.some((v) => v > 0))
      : [];
  const GRANS: Gran[] = ["day", "week", "month", "year"];
  const MODES: Mode[] = ["type", "pilot", "ship", "module"];
  const modeLabel = (m: Mode) =>
    m === "type" ? tr("Tipo") : m === "pilot" ? tr("Personaje") : m === "ship" ? tr("Nave") : tr("Módulo");
  const granLabel = (g: Gran) => (g === "day" ? tr("Día") : g === "week" ? tr("Semana") : g === "month" ? tr("Mes") : tr("Año"));
  const chartHead =
    mode === "type"
      ? `${tr("HP curados por")} ${granLabel(gran).toLowerCase()}`
      : `${modeLabel(mode)} · ${bdDir === "given" ? tr("Dado") : tr("Recibido")} · ${tr("top 8")} · ${tr(
          "por"
        )} ${granLabel(gran).toLowerCase()}`;

  return (
    <div className="logis-view">
      <div className="bit-head">
        <h4>🏥 {tr("Logis")}</h4>
        <span className="muted small">{tr("Reparación remota, del histórico de combate")}</span>
      </div>

      {empty ? (
        <p className="muted small">
          {tr("Aún no hay datos de logi. Abre ⚙️ Ajustes → Logs de EVE y pulsa Escanear para leer tus gamelogs.")}
        </p>
      ) : (
        <>
          <div className="logi-panel">
            <div className="logi-cols">
              <div className="logi-col">
                <div className="logi-dir">
                  {tr("Curación dada")} <span className="logi-total">{fmtHp(givenTot)} HP</span>
                </div>
                <div className="muted small logi-hpline">
                  <img className="hp-ico" src={typeIcon(3608, 32)} alt={tr("Escudo")} /> {fmtHp(sum!.given_shield)} ·{" "}
                  <img className="hp-ico" src={typeIcon(26914, 32)} alt={tr("Blindaje")} /> {fmtHp(sum!.given_armor)} ·{" "}
                  <img className="hp-ico" src={typeIcon(3986, 32)} alt={tr("Casco")} /> {fmtHp(sum!.given_hull)}
                </div>
              </div>
              <div className="logi-col">
                <div className="logi-dir">
                  {tr("Reps recibidas")} <span className="logi-total">{fmtHp(recvTot)} HP</span>
                </div>
                <div className="muted small logi-hpline">
                  <img className="hp-ico" src={typeIcon(3608, 32)} alt={tr("Escudo")} /> {fmtHp(sum!.recv_shield)} ·{" "}
                  <img className="hp-ico" src={typeIcon(26914, 32)} alt={tr("Blindaje")} /> {fmtHp(sum!.recv_armor)} ·{" "}
                  <img className="hp-ico" src={typeIcon(3986, 32)} alt={tr("Casco")} /> {fmtHp(sum!.recv_hull)}
                </div>
              </div>
            </div>
          </div>

          {!empty && (
            <div className="logis-chart">
              <div className="logi-gran rateo-controls">
                <div className="seg seg-sm">
                  {GRANS.map((g) => (
                    <button key={g} className={gran === g ? "active" : ""} onClick={() => setGran(g)}>
                      {granLabel(g)}
                    </button>
                  ))}
                </div>
                {/* Desglose: por tipo de HP, o cruzando por personaje / nave / módulo */}
                <div className="seg seg-sm" title={tr("Desglose")}>
                  {MODES.map((m) => (
                    <button key={m} className={mode === m ? "active" : ""} onClick={() => setMode(m)}>
                      {modeLabel(m)}
                    </button>
                  ))}
                </div>
                {mode !== "type" && (
                  <div className="seg seg-sm">
                    <button className={bdDir === "given" ? "active" : ""} onClick={() => setBdDir("given")}>
                      {tr("Dado")}
                    </button>
                    <button className={bdDir === "received" ? "active" : ""} onClick={() => setBdDir("received")}>
                      {tr("Recibido")}
                    </button>
                  </div>
                )}
                <RangePresets from={from} to={to} setFrom={setFrom} setTo={setTo} years={years} />
                <label className="rateo-date">
                  {tr("Desde")} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </label>
                <label className="rateo-date">
                  {tr("Hasta")} <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </label>
                {(from || to) && (
                  <button
                    className="rateo-clear"
                    onClick={() => {
                      setFrom("");
                      setTo("");
                    }}
                  >
                    {tr("Limpiar")}
                  </button>
                )}
              </div>
              <div className="logi-charthead muted small">{chartHead}</div>
              {chartSeries.length > 0 ? (
                <MultiLineProgress labels={chartLabels} series={chartSeries} fmt={fmtHp} />
              ) : (
                <div className="muted small">{tr("Sin datos para este desglose.")}</div>
              )}
            </div>
          )}

          <div className="logi-tables">
            <PilotList title={tr("A quién curaste")} pilots={given} shipTid={shipTid} />
            <PilotList title={tr("De quién recibiste")} pilots={recv} shipTid={shipTid} />
          </div>
        </>
      )}
    </div>
  );
}
