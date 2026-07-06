// Apartado "Logis" (Fase B): resumen de curación remota + gráfica (líneas activables, filtros
// día/semana/mes/año como el resto) + histórico de pilotos con icono de nave. Todo del gamelog local.
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { typeIcon, weekKey } from "./format";
import { MultiLineProgress } from "./charts";
import type { LogiSummary, LogiSeries, LogiPilot } from "./types";

const fmtHp = (n: number) => Math.round(n).toLocaleString();
type Gran = "day" | "week" | "month" | "year";

// Agrega la serie diaria a la granularidad elegida (igual que las otras gráficas).
function aggregate(s: LogiSeries, gran: Gran) {
  const bkey = (d: string) =>
    gran === "year" ? d.slice(0, 4) : gran === "month" ? d.slice(0, 7) : gran === "week" ? weekKey(d) : d;
  const map = new Map<string, number[]>();
  s.labels.forEach((d, i) => {
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
  return (
    <div className="logi-col">
      <div className="logi-dir">{title}</div>
      {pilots.length === 0 ? (
        <div className="muted small">—</div>
      ) : (
        <ul className="logi-pilots">
          {pilots.slice(0, 20).map((p) => {
            const tid = p.ship ? shipTid[p.ship.toLowerCase()] : 0;
            return (
              <li key={p.pilot}>
                <span className="lp-name">
                  {p.char_id > 0 ? (
                    <img
                      className="lp-portrait"
                      src={`https://images.evetech.net/characters/${p.char_id}/portrait?size=32`}
                      alt=""
                      loading="lazy"
                    />
                  ) : null}
                  {tid ? <img className="type-ico" src={typeIcon(tid, 32)} alt="" loading="lazy" title={p.ship} /> : null}
                  {p.pilot}
                </span>
                <span className="muted small">
                  {fmtHp(p.hp)} HP · {p.reps} reps
                </span>
              </li>
            );
          })}
        </ul>
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
  const [shipTid, setShipTid] = useState<Record<string, number>>({});

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

  const givenTot = sum ? sum.given_shield + sum.given_armor + sum.given_hull : 0;
  const recvTot = sum ? sum.recv_shield + sum.recv_armor + sum.recv_hull : 0;
  const empty = givenTot === 0 && recvTot === 0;

  const agg = series ? aggregate(series, gran) : null;
  const chartSeries = agg
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
    : [];
  const GRANS: Gran[] = ["day", "week", "month", "year"];
  const granLabel = (g: Gran) => (g === "day" ? tr("Día") : g === "week" ? tr("Semana") : g === "month" ? tr("Mes") : tr("Año"));

  return (
    <div className="logis-view">
      <div className="bit-head">
        <h4>🏥 {tr("Logis")}</h4>
        <span className="muted small">{tr("Reparación remota, del histórico de combate")}</span>
      </div>

      {empty ? (
        <p className="muted small">
          {tr("Aún no hay datos de logi. Ve a «Trabajos y proyectos» → Escanear para leer tus gamelogs.")}
        </p>
      ) : (
        <>
          <div className="logi-panel">
            <div className="logi-cols">
              <div className="logi-col">
                <div className="logi-dir">
                  {tr("Curación dada")} <span className="logi-total">{fmtHp(givenTot)} HP</span>
                </div>
                <div className="muted small">
                  🛡️ {fmtHp(sum!.given_shield)} · 🟧 {fmtHp(sum!.given_armor)} · 🔧 {fmtHp(sum!.given_hull)}
                </div>
              </div>
              <div className="logi-col">
                <div className="logi-dir">
                  {tr("Reps recibidas")} <span className="logi-total">{fmtHp(recvTot)} HP</span>
                </div>
                <div className="muted small">
                  🛡️ {fmtHp(sum!.recv_shield)} · 🟧 {fmtHp(sum!.recv_armor)} · 🔧 {fmtHp(sum!.recv_hull)}
                </div>
              </div>
            </div>
          </div>

          {chartSeries.length > 0 && agg && (
            <div className="logis-chart">
              <div className="logi-gran">
                {GRANS.map((g) => (
                  <button key={g} className={gran === g ? "active" : ""} onClick={() => setGran(g)}>
                    {granLabel(g)}
                  </button>
                ))}
                <span className="muted small">{tr("HP curados por")} {granLabel(gran).toLowerCase()}</span>
              </div>
              <MultiLineProgress labels={agg.labels} series={chartSeries} fmt={fmtHp} />
            </div>
          )}

          <div className="logi-cols logis-pilots-row">
            <PilotList title={tr("A quién curaste")} pilots={given} shipTid={shipTid} />
            <PilotList title={tr("De quién recibiste")} pilots={recv} shipTid={shipTid} />
          </div>
        </>
      )}
    </div>
  );
}
