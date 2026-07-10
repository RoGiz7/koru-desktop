// Sección PvE · Minería (histórico y valoración de mineral), Guerra de Facciones y Abyssals
// (estimación por loot/journal). Extraído de App.tsx.
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { loadNewEden } from "./neweden";
import { tr } from "./i18n";
import { fmtIsk, fmtSp, weekKey, daysAgo } from "./format";
import { TypeIcon, Kpi, MultiLineProgress, DONUT_COLORS, RangePresets } from "./charts";
import { FW_FACTIONS } from "./constants";
import type { MiningSeries, MineDimDay, FactionalView as FactionalData, AbyssalsData, GamelogRecon, GamelogMiningValued } from "./types";

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

  // Fusión visual (opt-in): del gamelog sacamos lo LOG-ONLY (extraído — cuadra con ESI — y el
  // desperdicio, que ESI no expone). Fuente separada, líneas discontinuas. Solo en modo unidades.
  // Extraído/Crítico VALORADOS por el modo actual (m³/bruto/comp/85%): el backend reusa ore_per_unit.
  const [glValExt, setGlValExt] = useState<{ date: string; value: number }[]>([]);
  const [glValCrit, setGlValCrit] = useState<{ date: string; value: number }[]>([]);
  const [glByOre, setGlByOre] = useState<{ id: number; date: string; value: number }[]>([]);
  // Fase D — extraído por SISTEMA (nombre, que es lo que da el chatlog) y qué parte del total cubre.
  const [glBySys, setGlBySys] = useState<{ system: string; date: string; value: number }[]>([]);
  const [glSysCov, setGlSysCov] = useState(0);
  // Nombres de las menas que solo aparecen en el gamelog (ESI no las nombra → saldrían como "#45494").
  const [glOreNames, setGlOreNames] = useState<Map<number, string>>(new Map());
  const [glWaste, setGlWaste] = useState<{ date: string; value: number }[]>([]); // solo unidades (sin mena)
  const [showGl, setShowGl] = useState(() => localStorage.getItem("koru-mineria-gl") === "1");
  useEffect(() => {
    localStorage.setItem("koru-mineria-gl", showGl ? "1" : "0");
  }, [showGl]);
  useEffect(() => {
    const sid = typeof subject === "number" ? subject : 0;
    invoke<GamelogRecon>("get_gamelog_recon", { subjectId: sid })
      .then((r) => setGlWaste(r.mining_waste_series))
      .catch(() => setGlWaste([]));
  }, [subject]);
  useEffect(() => {
    const sid = typeof subject === "number" ? subject : 0;
    invoke<GamelogMiningValued>("get_gamelog_mining_valued", { subjectId: sid, mode })
      .then((v) => {
        setGlValExt(v.extracted);
        setGlValCrit(v.crit);
        setGlByOre(v.by_ore);
        setGlOreNames(new Map(v.ore_names ?? []));
        setGlBySys(v.by_sys ?? []);
        setGlSysCov(v.sys_covered ?? 0);
      })
      .catch(() => {
        setGlValExt([]);
        setGlValCrit([]);
        setGlByOre([]);
        setGlOreNames(new Map());
        setGlBySys([]);
        setGlSysCov(0);
      });
  }, [subject, mode]);

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
  // Nombre de mena: primero el catálogo de ESI; si la mena solo vive en el histórico del gamelog,
  // el nombre lo trae el propio comando del gamelog. Solo así dejamos de ver "#45494".
  const oreName = (id: number) =>
    id < 0 ? tr("Sin identificar") : oreNames.get(id) ?? glOreNames.get(id) ?? `#${id}`;
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
  // Fusión opcional con el gamelog. Extraído y Crítico van VALORADOS en el modo actual (m³/bruto/…),
  // así Extraído cuadra con el Total de ESI en cualquier modo. El Desperdiciado no lleva mena en el
  // log → solo se puede mostrar en modo "unidades".
  const glBk = new Map<string, number>();
  for (const d of glValExt) {
    if (!inRange(d.date)) continue;
    const k = bucketKey(d.date);
    glBk.set(k, (glBk.get(k) ?? 0) + d.value);
  }
  const glCBk = new Map<string, number>();
  for (const d of glValCrit) {
    if (!inRange(d.date)) continue;
    const k = bucketKey(d.date);
    glCBk.set(k, (glCBk.get(k) ?? 0) + d.value);
  }
  const glWBk = new Map<string, number>();
  if (mode === "units") {
    for (const d of glWaste) {
      if (!inRange(d.date)) continue;
      const k = bucketKey(d.date);
      glWBk.set(k, (glWBk.get(k) ?? 0) + d.value);
    }
  }
  const glOn = showGl && (glBk.size > 0 || glWBk.size > 0);
  const totalMap = new Map(totalSeries.map((s) => [s.label, s.value]));
  const labels = glOn
    ? [...new Set([...totalSeries.map((s) => s.label), ...glBk.keys(), ...glCBk.keys(), ...glWBk.keys()])].sort()
    : totalSeries.map((s) => s.label);

  // Empalme ESI↔gamelog: dentro/después de la ventana de ESI mandan los datos de ESI; ANTES de la
  // fecha más antigua de ESI, se rellena con el gamelog (valorado en el modo actual). Sin doble conteo:
  // base+crít del gamelog ya = ESI en el solape, así que el corte es limpio.
  // La "ventana de ESI" empieza donde ESI trae mena REAL (id>=0). El histórico con mena sin resolver
  // (#-1, no valorable) queda ANTES de ese corte → lo rellena el gamelog (que sí trae mena y valor).
  // Si ESI no tiene mena real en el rango, esiMin=null → el empalme usa gamelog en todo el tramo.
  const esiOreLabels = series.daily_by_ore
    .filter((r) => r.id >= 0 && inRange(r.date))
    .map((r) => bucketKey(r.date));
  const esiMin = esiOreLabels.length ? esiOreLabels.reduce((a, b) => (a < b ? a : b)) : null;
  const splice = (esiMap: Map<string, number>, glMap: Map<string, number>) =>
    labels.map((l) => (esiMin != null && l >= esiMin ? (esiMap.get(l) ?? 0) : (glMap.get(l) ?? 0)));
  // Gamelog por mena (id type_id) → Map<id, Map<bucket, value>>, para empalmar cada mineral.
  const glOreBuckets = new Map<number, Map<string, number>>();
  if (glOn) {
    for (const d of glByOre) {
      if (!inRange(d.date)) continue;
      const k = bucketKey(d.date);
      let mm = glOreBuckets.get(d.id);
      if (!mm) {
        mm = new Map();
        glOreBuckets.set(d.id, mm);
      }
      mm.set(k, (mm.get(k) ?? 0) + d.value);
    }
  }

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
  // Total EMPALMADO cuando el gamelog está activo (ESI en su ventana + gamelog antes); si no, ESI.
  const totalLine = {
    name: tr("Total"),
    color: "#c8d3df",
    values: glOn ? splice(totalMap, glBk) : labels.map((l) => totalMap.get(l) ?? 0),
  };
  // Color estable por posición. La paleta base tiene 10; a partir de ahí generamos tonos separados
  // por el ángulo áureo, que reparte los matices sin repetir aunque haya 40 menas.
  const oreColor = (i: number) =>
    i < DONUT_COLORS.length ? DONUT_COLORS[i] : `hsl(${(i * 137.5) % 360} 62% 62%)`;

  // Dibujamos TODAS las menas identificadas, cada una con su nombre. Nada de recortar a un top-N:
  // cualquier recorte deja fuera lo que dominó algún tramo y lo tira a un cajón "Otros" que no dice
  // nada. La leyenda permite aislar las que interesen. Cada mena = ESI donde cubre + gamelog antes
  // (si el empalme está activo). Solo menas REALES (id>=0): el #-1 sin resolver no es línea propia.
  const oreLineData = () => {
    const esiOre = dimBuckets(series.daily_by_ore.filter((r) => r.id >= 0));
    const ids = new Set<number>([...esiOre.keys(), ...(glOn ? glOreBuckets.keys() : [])]);
    return [...ids]
      .map((id) => {
        const e = esiOre.get(id) ?? new Map<string, number>();
        const g = glOreBuckets.get(id) ?? new Map<string, number>();
        const vals = glOn ? splice(e, g) : mkVals(e);
        return { id, vals, total: vals.reduce((a, b) => a + b, 0) };
      })
      .filter((s) => s.total > 0)
      .sort((a, b) => b.total - a.total)
      .map((s, i) => ({ name: oreName(s.id), color: oreColor(i), values: s.vals }));
  };
  // Fase D — «Por sistema» empalmado. Antes solo cubría la ventana del mining_ledger de ESI (2023 en
  // adelante); el chatlog de Local sabe dónde estabas desde 2019. El sistema se empalma por NOMBRE,
  // que es lo único que da el chatlog: mismo corte que las menas, ESI donde llega y gamelog antes.
  const glSysBuckets = new Map<string, Map<string, number>>();
  if (glOn) {
    for (const d of glBySys) {
      if (!inRange(d.date)) continue;
      const k = bucketKey(d.date);
      let mm = glSysBuckets.get(d.system);
      if (!mm) {
        mm = new Map();
        glSysBuckets.set(d.system, mm);
      }
      mm.set(k, (mm.get(k) ?? 0) + d.value);
    }
  }
  const sysLineData = () => {
    const esiSys = new Map<string, Map<string, number>>();
    for (const r of series.daily_by_system) {
      if (!inRange(r.date)) continue;
      const k = bucketKey(r.date);
      const n = sysName(r.id);
      let mm = esiSys.get(n);
      if (!mm) {
        mm = new Map();
        esiSys.set(n, mm);
      }
      mm.set(k, (mm.get(k) ?? 0) + r.value);
    }
    const all = new Set<string>([...esiSys.keys(), ...(glOn ? glSysBuckets.keys() : [])]);
    return [...all]
      .map((n) => {
        const e = esiSys.get(n) ?? new Map<string, number>();
        const g = glSysBuckets.get(n) ?? new Map<string, number>();
        const vals = glOn ? splice(e, g) : mkVals(e);
        return { n, vals, total: vals.reduce((a, b) => a + b, 0) };
      })
      .filter((s) => s.total > 0)
      .sort((a, b) => b.total - a.total)
      .map((s, i) => ({ name: s.n, color: oreColor(i), values: s.vals }));
  };
  // Sin gamelog, el desglose de ESI se recorta al top 8 como siempre. Con gamelog dibujamos todos los
  // sistemas: recortar tiraría a un cajón el sistema que dominó un año entero.
  const sysSeries = [totalLine, ...(glOn ? sysLineData() : buildDim(series.daily_by_system, sysName))];
  const charSeries = [totalLine, ...buildDim(series.daily_by_char, (id) => charNames.get(id) ?? `#${id}`)];
  // Ya se dibujan TODAS las menas identificadas, así que un residuo aquí significa mineral que no
  // hemos sabido nombrar (el #-1 de ESI, o una mena que el catálogo no reconoce). Eso es una SEÑAL,
  // no un cajón: solo lo mostramos si pesa de verdad (>1% del total del periodo), para que se vea.
  const withOthers = (lines: { name: string; color: string; values: number[] }[]) => {
    const others = totalLine.values.map((t, i) => {
      const shown = lines.reduce((a, l) => a + (l.values[i] ?? 0), 0);
      const rest = t - shown;
      return rest > 0.5 ? rest : 0;
    });
    const sumTotal = totalLine.values.reduce((a, b) => a + b, 0);
    const sumOthers = others.reduce((a, b) => a + b, 0);
    return sumTotal > 0 && sumOthers / sumTotal > 0.01
      ? [...lines, { name: tr("Sin identificar"), color: "#8b949e", values: others }]
      : lines;
  };
  const oreSeries = [totalLine, ...withOthers(oreLineData())];
  const multiChar = new Set(series.daily_by_char.map((r) => r.id)).size > 1;
  const baseLines = dim === "char" && multiChar ? charSeries : dim === "ore" ? oreSeries : sysSeries;
  // Extras LOG-ONLY del gamelog (discontinuos): Crítico (parte del total, bonus Equinox) y
  // Desperdiciado (residuo destruido, solo en modo unidades). El Extraído ya va empalmado arriba.
  const glCritLine = { name: tr("Crítico (gamelog)"), color: "#57c785", values: labels.map((l) => glCBk.get(l) ?? 0), dash: true };
  // Bajo cero: es mena destruida, no extraída. Igual que "No ingresado" en Rateo. El dato guardado es
  // positivo; solo se niega al pintar, porque su naturaleza es la de una pérdida.
  const glWasteLine = { name: tr("Desperdiciado (gamelog)"), color: "#d76a6a", values: labels.map((l) => -(glWBk.get(l) ?? 0)), dash: true };
  const lineSeries = glOn
    ? [...baseLines, ...(glCBk.size > 0 ? [glCritLine] : []), ...(glWBk.size > 0 ? [glWasteLine] : [])]
    : baseLines;

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
  // Años seleccionables = los que la gráfica puede pintar. El ledger de ESI solo cubre su ventana
  // reciente; los años de atrás los aporta el gamelog, así que solo se ofrecen si está empalmando.
  const yearDates = glOn
    ? [...series.daily.map((r) => r.date), ...glValExt.map((d) => d.date)]
    : series.daily.map((r) => r.date);
  const mineriaYears = [...new Set(yearDates.map((d) => +d.slice(0, 4)))]
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
        {glValExt.length > 0 && (
          <button
            className={`gl-toggle${showGl ? " active" : ""}`}
            onClick={() => setShowGl((v) => !v)}
            title={tr("Superpone Extraído (cuadra con ESI) + Crítico + Desperdiciado del gamelog (líneas discontinuas)")}
          >
            ┈ {tr("gamelog")}
          </button>
        )}
      </div>
      {showGl && mode !== "units" && glWaste.length > 0 && (
        <p className="muted small gl-note">
          {tr("El desperdiciado solo se muestra en modo «Unidades» (el log no indica la mena del residuo).")}
        </p>
      )}
      {/* El desglose por sistema del gamelog no cubre el 100%: hay sesiones sin su chatlog. Decirlo. */}
      {glOn && dim === "sys" && glSysCov > 0 && glSysCov < 0.995 && (
        <p className="muted small gl-note">
          {tr("Del extraído del gamelog, se pudo situar en un sistema el")} {(glSysCov * 100).toFixed(0)}%
          {" — "}
          {tr("el resto cuenta en el Total, pero no en ninguna línea de sistema.")}
        </p>
      )}

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
