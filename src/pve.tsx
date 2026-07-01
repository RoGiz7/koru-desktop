// Sección PvE · Minería (histórico y valoración de mineral), Guerra de Facciones y Abyssals
// (estimación por loot/journal). Extraído de App.tsx.
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { loadNewEden } from "./neweden";
import { tr } from "./i18n";
import { fmtIsk, fmtSp, weekKey, daysAgo } from "./format";
import { TypeIcon, Kpi, MultiLineProgress, DONUT_COLORS, RangePresets } from "./charts";
import { FW_FACTIONS } from "./constants";
import type { MiningSeries, MineDimDay, FactionalView as FactionalData, AbyssalsData } from "./types";

export function MineriaView({
  subject,
  charNames,
  onSyncMining,
}: {
  subject: number | "global";
  charNames: Map<number, string>;
  onSyncMining?: (id: number) => Promise<void>;
}) {
  const isGlobal = subject === "global";
  const [series, setSeries] = useState<MiningSeries | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [names, setNames] = useState<Map<number, string>>(new Map());
  const [gran, setGran] = useState<"day" | "week" | "month" | "year">(
    () => (localStorage.getItem("koru-mineria-gran") as "day" | "week" | "month" | "year") || "month",
  );
  const cumulative: boolean = false; // "Acumulado" retirado; los presets de rango lo sustituyen.
  const [from, setFrom] = useState(daysAgo(90));
  const [to, setTo] = useState("");
  const [dim, setDim] = useState<"sys" | "char" | "ore">(
    () => (localStorage.getItem("koru-mineria-dim") as "sys" | "char" | "ore") || "ore",
  );
  const [mode, setMode] = useState<"units" | "m3" | "bruto" | "comp" | "reproc">(
    () => (localStorage.getItem("koru-mineria-mode") as "units" | "m3" | "bruto" | "comp" | "reproc") || "bruto",
  );
  useEffect(() => {
    localStorage.setItem("koru-mineria-gran", gran);
  }, [gran]);
  useEffect(() => {
    localStorage.setItem("koru-mineria-dim", dim);
  }, [dim]);
  useEffect(() => {
    localStorage.setItem("koru-mineria-mode", mode);
  }, [mode]);

  useEffect(() => {
    loadNewEden()
      .then((ne) => setNames(new Map(ne.systems.map((s) => [s.id, s.n]))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    (async () => {
      try {
        const d = isGlobal
          ? await invoke<MiningSeries>("get_mining_series_global", { mode })
          : await invoke<MiningSeries>("get_mining_series", { characterId: subject, mode });
        if (alive) setSeries(d);
      } catch {
        if (alive) setSeries(null);
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [subject, reload, mode]);

  async function doSync() {
    if (typeof subject !== "number" || !onSyncMining) return;
    await onSyncMining(subject);
    setReload((r) => r + 1);
  }

  if (!series) return <p className="muted">{busy ? tr("Cargando…") : tr("Sin datos.")}</p>;
  if (series.daily.length === 0)
    return (
      <p className="muted small">
        {tr("Sin registro de minería. Sincroniza la minería de tus personajes (sección Industria) para ver tu histórico.")}
      </p>
    );

  const sysName = (id: number) => names.get(id) ?? `#${id}`;
  const oreNames = new Map(series.ore_names);
  const oreName = (id: number) => oreNames.get(id) ?? `#${id}`;
  const granLabel =
    gran === "day" ? tr("día") : gran === "week" ? tr("semana") : gran === "month" ? tr("mes") : tr("año");
  // Formato y etiqueta según el modo de valoración.
  const valFmt =
    mode === "units"
      ? (n: number) => fmtSp(Math.round(n))
      : mode === "m3"
        ? (n: number) => `${fmtSp(Math.round(n))} m³`
        : fmtIsk;
  const modeLabel =
    mode === "units"
      ? tr("Unidades")
      : mode === "m3"
        ? "m³"
        : mode === "comp"
          ? tr("Valor comprimido")
          : mode === "reproc"
            ? tr("Valor reprocesado 85%")
            : tr("Valor bruto");

  const inRange = (date: string) => (!from || date >= from) && (!to || date <= to);
  const bucketKey = (date: string) =>
    gran === "year"
      ? date.slice(0, 4)
      : gran === "month"
        ? date.slice(0, 7)
        : gran === "week"
          ? weekKey(date)
          : date;

  // Serie Total (valor ISK por bucket).
  const tot = new Map<string, number>();
  for (const d of series.daily) {
    if (!inRange(d.date)) continue;
    const k = bucketKey(d.date);
    tot.set(k, (tot.get(k) ?? 0) + d.value);
  }
  const totalSeries = [...tot.entries()].map(([label, value]) => ({ label, value }));
  const labels = totalSeries.map((s) => s.label);
  const totVals = () => {
    let acc = 0;
    return totalSeries.map((s) => (cumulative ? (acc += s.value) : s.value));
  };

  const dimBuckets = (rows: MineDimDay[]) => {
    const m = new Map<number, Map<string, number>>();
    for (const r of rows) {
      if (!inRange(r.date)) continue;
      const k = bucketKey(r.date);
      let mm = m.get(r.id);
      if (!mm) {
        mm = new Map();
        m.set(r.id, mm);
      }
      mm.set(k, (mm.get(k) ?? 0) + r.value);
    }
    return m;
  };
  const mkVals = (m: Map<string, number> | undefined) => {
    let acc = 0;
    return labels.map((l) => {
      const v = m?.get(l) ?? 0;
      return cumulative ? (acc += v) : v;
    });
  };
  const buildDim = (rows: MineDimDay[], nameFn: (id: number) => string) => {
    const m = dimBuckets(rows);
    const totals = [...m.entries()]
      .map(([id, mm]) => ({ id, total: [...mm.values()].reduce((a, b) => a + b, 0) }))
      .sort((a, b) => b.total - a.total);
    return totals.slice(0, 8).map((t, i) => ({
      name: nameFn(t.id),
      color: DONUT_COLORS[i % DONUT_COLORS.length],
      values: mkVals(m.get(t.id)),
    }));
  };
  const totalLine = { name: tr("Total"), color: "#c8d3df", values: totVals() };
  const sysSeries = [totalLine, ...buildDim(series.daily_by_system, sysName)];
  const charSeries = [totalLine, ...buildDim(series.daily_by_char, (id) => charNames.get(id) ?? `#${id}`)];
  const oreSeries = [totalLine, ...buildDim(series.daily_by_ore, oreName)];
  const multiChar = new Set(series.daily_by_char.map((r) => r.id)).size > 1;
  const lineSeries = dim === "char" && multiChar ? charSeries : dim === "ore" ? oreSeries : sysSeries;

  // "Mineral extraído" (agregado al rango filtrado) desde daily_by_ore.
  const oreAgg = new Map<number, { units: number; value: number }>();
  for (const r of series.daily_by_ore) {
    if (!inRange(r.date)) continue;
    const e = oreAgg.get(r.id) ?? { units: 0, value: 0 };
    e.units += r.units;
    e.value += r.value;
    oreAgg.set(r.id, e);
  }
  const oreRows = [...oreAgg.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.value - a.value);
  const rangeValue = oreRows.reduce((a, o) => a + o.value, 0);
  const rangeUnits = oreRows.reduce((a, o) => a + o.units, 0);
  const mineriaYears = [...new Set(series.daily_by_ore.map((r) => +r.date.slice(0, 4)))]
    .filter((y) => y > 0)
    .sort((a, b) => b - a);

  return (
    <>
      <div className="km-header">
        <div className="kpis" style={{ flex: 1 }}>
          <Kpi label={modeLabel} value={valFmt(rangeValue)} tone={mode === "units" || mode === "m3" ? undefined : "pos"} />
          <Kpi label={tr("Unidades minadas")} value={fmtSp(rangeUnits)} />
          <Kpi label={tr("Tipos de mineral")} value={fmtSp(oreRows.length)} />
        </div>
        {!isGlobal && (
          <button onClick={doSync} disabled={busy}>
            {busy ? tr("Trabajando…") : tr("Sincronizar minería")}
          </button>
        )}
      </div>

      <div className="rateo-controls">
        <div className="seg">
          {(["day", "week", "month"] as const).map((g) => (
            <button key={g} className={gran === g ? "active" : ""} onClick={() => setGran(g)}>
              {g === "day" ? tr("Día") : g === "week" ? tr("Semana") : g === "month" ? tr("Mes") : tr("Año")}
            </button>
          ))}
        </div>
        <RangePresets from={from} to={to} setFrom={setFrom} setTo={setTo} years={mineriaYears} />
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
            Limpiar
          </button>
        )}
        <div className="seg seg-sm" title={tr("Cómo valorar lo minado")}>
          {(
            [
              ["units", "U"],
              ["m3", "m³"],
              ["bruto", tr("Bruto")],
              ["comp", tr("Comp.")],
              ["reproc", "85%"],
            ] as const
          ).map(([m, lbl]) => (
            <button key={m} className={mode === m ? "active" : ""} onClick={() => setMode(m)}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      <div className="top-list">
        <div className="rateo-charthead">
          <h4>
            {modeLabel}
            {cumulative ? ` (${tr("acumulado")})` : ""} {tr("por")} {granLabel}
          </h4>
          <div className="seg seg-sm">
            <button className={dim === "ore" ? "active" : ""} onClick={() => setDim("ore")}>
              {tr("Por mineral")}
            </button>
            <button className={dim === "sys" ? "active" : ""} onClick={() => setDim("sys")}>
              {tr("Por sistema")}
            </button>
            {multiChar && (
              <button className={dim === "char" ? "active" : ""} onClick={() => setDim("char")}>
                {tr("Por personaje")}
              </button>
            )}
          </div>
        </div>
        <MultiLineProgress labels={labels} series={lineSeries} fmt={valFmt} />
      </div>

      <div className="top-list">
        <h4>{tr("Mineral extraído")}</h4>
        {oreRows.length === 0 ? (
          <p className="muted small">{tr("Sin minería en el rango.")}</p>
        ) : (
          <table className="km-table cat-table">
            <thead>
              <tr>
                <th>{tr("Mineral")}</th>
                <th style={{ textAlign: "right" }}>{tr("Unidades")}</th>
                <th style={{ textAlign: "right" }}>{modeLabel}</th>
              </tr>
            </thead>
            <tbody>
              {oreRows.map((o) => (
                <tr key={o.id}>
                  <td>
                    <TypeIcon typeId={o.id} />
                    {oreName(o.id)}
                  </td>
                  <td style={{ textAlign: "right" }}>{fmtSp(o.units)}</td>
                  <td style={{ textAlign: "right" }}>{valFmt(o.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

/* ---------- PvE: Factional + Abyssals ---------- */
export function FactionalSection({ data, busy }: { data: FactionalData | null; busy: boolean }) {
  if (!data) return <p className="muted">{busy ? tr("Cargando…") : tr("Sin datos.")}</p>;
  if (!data.enlisted)
    return (
      <p className="muted small">
        {tr("Este personaje no está enlistado en la Guerra de Facciones.")}
      </p>
    );
  const fac = data.faction_id ? FW_FACTIONS[data.faction_id] : null;
  const counts = (c: FactionalData["kills"]) => (
    <table className="km-table cat-table">
      <tbody>
        <tr>
          <td>{tr("Ayer")}</td>
          <td style={{ textAlign: "right" }}>{fmtSp(c.yesterday)}</td>
        </tr>
        <tr>
          <td>{tr("Última semana")}</td>
          <td style={{ textAlign: "right" }}>{fmtSp(c.last_week)}</td>
        </tr>
        <tr>
          <td>{tr("Total")}</td>
          <td style={{ textAlign: "right" }}>{fmtSp(c.total)}</td>
        </tr>
      </tbody>
    </table>
  );
  return (
    <>
      <div className="kpis">
        <div className="kpi" style={fac ? { borderTopColor: fac.color } : undefined}>
          <div className="kpi-value">
            {fac?.name ?? (data.faction_id ? `#${data.faction_id}` : "—")}
          </div>
          <div className="kpi-label">{tr("Facción")}</div>
        </div>
        {data.current_rank != null && <Kpi label={tr("Rango actual")} value={data.current_rank} />}
        {data.highest_rank != null && <Kpi label={tr("Rango máximo")} value={data.highest_rank} />}
        {data.enlisted_on && <Kpi label={tr("Enlistado")} value={data.enlisted_on.slice(0, 10)} />}
      </div>
      <div className="resumen-grid">
        <div className="panel resumen-panel">
          <h4>{tr("Kills")}</h4>
          {counts(data.kills)}
        </div>
        <div className="panel resumen-panel">
          <h4>Victory Points</h4>
          {counts(data.victory_points)}
        </div>
      </div>
    </>
  );
}


export function AbyssalsSection({ data, busy }: { data: AbyssalsData | null; busy: boolean }) {
  if (!data) return <p className="muted">{busy ? tr("Cargando…") : tr("Sin datos.")}</p>;
  return (
    <>
      <p className="muted small" style={{ marginTop: "1rem" }}>
        ⚠️ {tr("ESI no expone las runs abisales. Esto es una estimación a partir de tus compras de filamentos, ahora acumuladas en tu PC (cada sync guarda las nuevas; 1 filamento ≈ 1 run). Sincroniza la wallet con frecuencia para no perder transacciones fuera de la ventana de ESI.")}
      </p>
      {data.by_filament.length === 0 ? (
        <p className="muted small">
          {tr("No se han detectado compras de filamentos en la ventana de transacciones.")}
        </p>
      ) : (
        <>
          <div className="kpis">
            <Kpi label={tr("Runs estimadas")} value={fmtSp(data.runs_est)} />
            <Kpi label={tr("ISK en filamentos")} value={fmtIsk(data.isk_spent)} tone="neg" />
            <Kpi label={tr("Tipos de filamento")} value={fmtSp(data.by_filament.length)} />
          </div>
          <div className="top-list">
            <h4>{tr("Por filamento")}</h4>
            <table className="km-table cat-table">
              <thead>
                <tr>
                  <th>{tr("Filamento")}</th>
                  <th style={{ textAlign: "right" }}>{tr("Cantidad")}</th>
                  <th style={{ textAlign: "right" }}>ISK</th>
                </tr>
              </thead>
              <tbody>
                {data.by_filament.map((f, i) => (
                  <tr key={i}>
                    <td>{f.name}</td>
                    <td style={{ textAlign: "right" }}>{fmtSp(f.count)}</td>
                    <td style={{ textAlign: "right" }}>{fmtIsk(f.isk)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

/* ---------- Contactos + Standings (Personaje) ---------- */
