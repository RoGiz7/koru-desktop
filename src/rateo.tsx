// Sección PvE · Rateo: ISK por bounties con granularidad/rango, por sistema o personaje, ratas
// especiales y papeles de Abyssals/CRAB. Extraído de App.tsx. PapersBlock es interno (solo Rateo).
import { useState, useEffect } from "react";
import { loadNewEden } from "./neweden";
import { tr } from "./i18n";
import { fmtIsk, fmtSp, typeIcon, weekKey, daysAgo } from "./format";
import { Kpi, MultiLineProgress, DONUT_COLORS, RangePresets } from "./charts";
import type { RattingDetail, SpecialRatsResult, PaperSeries, AbyssalsData } from "./types";

// Cabecera de tabla ordenable reutilizable. Click → ordena por esa columna; reclick → invierte.
export function RateoView({
  data,
  special,
  charNames,
  paperSeries,
  abyssals,
  busy,
}: {
  data: RattingDetail | null;
  special: SpecialRatsResult | null;
  charNames: Map<number, string>;
  paperSeries: PaperSeries | null;
  abyssals: AbyssalsData | null;
  busy: boolean;
}) {
  const [gran, setGran] = useState<"day" | "week" | "month" | "year">(
    () => (localStorage.getItem("koru-rateo-gran") as "day" | "week" | "month" | "year") || "day",
  );
  const cumulative: boolean = false; // "Acumulado" retirado; los presets de rango lo sustituyen.
  const [from, setFrom] = useState(daysAgo(90));
  const [to, setTo] = useState("");
  const [dim, setDim] = useState<"sys" | "char">(
    () => (localStorage.getItem("koru-rateo-dim") as "sys" | "char") || "sys",
  );
  const [names, setNames] = useState<Map<number, string>>(new Map());
  useEffect(() => {
    localStorage.setItem("koru-rateo-gran", gran);
  }, [gran]);
  useEffect(() => {
    localStorage.setItem("koru-rateo-dim", dim);
  }, [dim]);

  useEffect(() => {
    loadNewEden()
      .then((ne) => setNames(new Map(ne.systems.map((s) => [s.id, s.n]))))
      .catch(() => {});
  }, []);

  if (!data)
    return (
      <>
        <p className="muted">{busy ? tr("Cargando…") : tr("Sin datos.")}</p>
        <PapersBlock series={paperSeries} data={abyssals} />
      </>
    );
  if (data.entries === 0)
    return (
      <>
        <p className="muted small">
          {tr("Sin ingresos de rateo en el journal. Sincroniza la wallet del personaje (sección Wallet) para empezar a acumular el histórico en tu PC.")}
        </p>
        <PapersBlock series={paperSeries} data={abyssals} />
      </>
    );

  const sysName = (id: number) => names.get(id) ?? `#${id}`;
  const granLabel =
    gran === "day" ? tr("día") : gran === "week" ? tr("semana") : gran === "month" ? tr("mes") : tr("año");

  // Filtra por rango de fechas (YYYY-MM-DD) y agrupa por granularidad.
  const daily = data.daily.filter((d) => (!from || d.date >= from) && (!to || d.date <= to));
  const bucketKey = (date: string) =>
    gran === "year"
      ? date.slice(0, 4)
      : gran === "month"
        ? date.slice(0, 7)
        : gran === "week"
          ? weekKey(date)
          : date;
  const buckets = new Map<string, { isk: number; rats: number }>();
  for (const d of daily) {
    const k = bucketKey(d.date);
    const e = buckets.get(k) ?? { isk: 0, rats: 0 };
    e.isk += d.bounty + d.ess;
    e.rats += d.rats;
    buckets.set(k, e);
  }
  let series = [...buckets.entries()].map(([label, v]) => ({ label, isk: v.isk, rats: v.rats }));
  if (cumulative) {
    let accI = 0;
    let accR = 0;
    series = series.map((s) => ({ ...s, isk: (accI += s.isk), rats: (accR += s.rats) }));
  }

  // KPIs del RANGO seleccionado (no del histórico entero) → más fiel a "lo de ahora".
  const rangeBounty = daily.reduce((a, d) => a + d.bounty, 0);
  const rangeEss = daily.reduce((a, d) => a + d.ess, 0);
  const rangeRats = daily.reduce((a, d) => a + d.rats, 0);
  const totalIsk = rangeBounty + rangeEss;
  // Total histórico (para el % del "Detalle por sistema", que sigue siendo all-time por datos).
  const allTimeIsk = data.total_bounty + data.total_ess;
  // ISK/hora estimado: escala las horas activas totales por la fracción de días activos en el rango.
  const totalActiveDays = data.daily.filter((d) => d.bounty + d.ess > 0).length;
  const rangeActiveDays = daily.filter((d) => d.bounty + d.ess > 0).length;
  const rangeHours =
    totalActiveDays > 0 ? (data.active_hours * rangeActiveDays) / totalActiveDays : 0;
  const iskPerHour = rangeHours > 0 ? totalIsk / rangeHours : 0;
  const rateoYears = [...new Set(data.daily.map((d) => +d.date.slice(0, 4)))].sort((a, b) => b - a);
  const topSystems = data.by_system.slice(0, 12);

  // Series por sistema (top 6) alineadas con los mismos buckets que la línea total.
  const labels = series.map((s) => s.label);
  const sysBuckets = new Map<number, Map<string, number>>();
  for (const r of data.daily_by_system) {
    if ((from && r.date < from) || (to && r.date > to)) continue;
    const k = bucketKey(r.date);
    let m = sysBuckets.get(r.system_id);
    if (!m) {
      m = new Map();
      sysBuckets.set(r.system_id, m);
    }
    m.set(k, (m.get(k) ?? 0) + r.isk);
  }
  const sysVals = (sysId: number) => {
    const m = sysBuckets.get(sysId);
    let acc = 0;
    return labels.map((lab) => {
      const v = m?.get(lab) ?? 0;
      return cumulative ? (acc += v) : v;
    });
  };
  const sysLineSeries = [
    { name: tr("Total"), color: "#c8d3df", values: series.map((s) => s.isk) },
    ...data.by_system.slice(0, 6).map((s, i) => ({
      name: sysName(s.system_id),
      color: DONUT_COLORS[i % DONUT_COLORS.length],
      values: sysVals(s.system_id),
    })),
  ];

  // Series por PERSONAJE (quién aporta más ISK). Solo útil en global (varios pj).
  const charBuckets = new Map<number, Map<string, number>>();
  for (const r of data.daily_by_char) {
    if ((from && r.date < from) || (to && r.date > to)) continue;
    const k = bucketKey(r.date);
    let m = charBuckets.get(r.character_id);
    if (!m) {
      m = new Map();
      charBuckets.set(r.character_id, m);
    }
    m.set(k, (m.get(k) ?? 0) + r.isk);
  }
  const charTotals = [...charBuckets.entries()]
    .map(([id, m]) => ({ id, total: [...m.values()].reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total);
  const charVals = (id: number) => {
    const m = charBuckets.get(id);
    let acc = 0;
    return labels.map((lab) => {
      const v = m?.get(lab) ?? 0;
      return cumulative ? (acc += v) : v;
    });
  };
  const charLineSeries = [
    { name: tr("Total"), color: "#c8d3df", values: series.map((s) => s.isk) },
    ...charTotals.slice(0, 8).map((c, i) => ({
      name: charNames.get(c.id) ?? `#${c.id}`,
      color: DONUT_COLORS[i % DONUT_COLORS.length],
      values: charVals(c.id),
    })),
  ];
  const multiChar = charTotals.length > 1; // solo ofrecer "por personaje" si hay varios
  const lineSeries = dim === "char" && multiChar ? charLineSeries : sysLineSeries;

  return (
    <>
      <div className="kpis">
        <Kpi label={tr("ISK total (bounty + ESS)")} value={fmtIsk(totalIsk)} tone="pos" />
        <Kpi label={tr("Bounties")} value={fmtIsk(rangeBounty)} tone="pos" />
        <Kpi label={tr("ESS")} value={fmtIsk(rangeEss)} tone="pos" />
        <Kpi label={tr("Ratas eliminadas")} value={fmtSp(rangeRats)} />
        <Kpi
          label={tr("Ratas especiales")}
          value={special ? fmtSp(special.total) : "…"}
          tone={special && special.total > 0 ? "pos" : undefined}
        />
        <Kpi label={tr("ISK / hora (estim.)")} value={fmtIsk(iskPerHour)} />
      </div>

      <div className="rateo-controls">
        <div className="seg">
          {(["day", "week", "month"] as const).map((g) => (
            <button key={g} className={gran === g ? "active" : ""} onClick={() => setGran(g)}>
              {g === "day" ? tr("Día") : g === "week" ? tr("Semana") : g === "month" ? tr("Mes") : tr("Año")}
            </button>
          ))}
        </div>
        <RangePresets from={from} to={to} setFrom={setFrom} setTo={setTo} years={rateoYears} />
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
      </div>

      <div className="top-list">
        <div className="rateo-charthead">
          <h4>
            {cumulative ? `ISK (${tr("acumulado")})` : "ISK"} {tr("por")} {granLabel}
          </h4>
          {multiChar && (
            <div className="seg seg-sm">
              <button className={dim === "sys" ? "active" : ""} onClick={() => setDim("sys")}>
                {tr("Por sistema")}
              </button>
              <button className={dim === "char" ? "active" : ""} onClick={() => setDim("char")}>
                {tr("Por personaje")}
              </button>
            </div>
          )}
        </div>
        <MultiLineProgress labels={labels} series={lineSeries} fmt={fmtIsk} />
      </div>

      {special && special.by_type.length > 0 && (
        <div className="top-list">
          <h4>
            {tr("Ratas especiales")} ·{" "}
            <span className="muted small">
              {special.officers} {tr("oficiales")} · {special.capitals} {tr("capitales")} ·{" "}
              {special.faction} {tr("faction")}
            </span>
          </h4>
          <div className="special-rats">
            {special.by_type.map((r) => (
              <div className="special-rat" key={r.type_id} title={r.name ?? `#${r.type_id}`}>
                <img src={typeIcon(r.type_id, 32)} alt="" width={26} height={26} />
                <span className="special-rat-name">{r.name ?? `#${r.type_id}`}</span>
                <span className={`special-rat-tag ${r.class}`}>
                  {r.class === "officer"
                    ? tr("Oficial")
                    : r.class === "capital"
                      ? tr("Capital")
                      : tr("Faction")}
                </span>
                <span className="special-rat-count">×{fmtSp(r.count)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {special == null && (
        <div className="top-list">
          <p className="muted small">{tr("Calculando ratas especiales… (puede tardar la 1ª vez)")}</p>
        </div>
      )}

      <div className="top-list">
        <h4>{tr("Detalle por sistema")}</h4>
        <table className="km-table">
          <thead>
            <tr>
              <th>{tr("Sistema")}</th>
              <th>ISK</th>
              <th>%</th>
              <th>ISK/h</th>
              <th>Bounty</th>
              <th>ESS</th>
              <th>{tr("Ratas")}</th>
              <th>{tr("Ratas especiales")}</th>
            </tr>
          </thead>
          <tbody>
            {topSystems.map((s) => {
              const sp = special?.by_system.find((b) => b.system_id === s.system_id);
              const pct = allTimeIsk > 0 ? (s.isk / allTimeIsk) * 100 : 0;
              const iskH = s.active_hours > 0 ? s.isk / s.active_hours : 0;
              return (
                <tr key={s.system_id}>
                  <td>{sysName(s.system_id)}</td>
                  <td>{fmtIsk(s.isk)}</td>
                  <td className="muted">{pct.toFixed(1)}%</td>
                  <td>{s.active_hours > 0 ? fmtIsk(iskH) : "—"}</td>
                  <td>{fmtIsk(s.bounty)}</td>
                  <td>{fmtIsk(s.ess)}</td>
                  <td>{fmtSp(s.rats)}</td>
                  <td>
                    {sp ? (
                      <div className="sys-special">
                        {sp.by_type.map((r) => (
                          <span
                            key={r.type_id}
                            className={`special-rat-tag ${r.class}`}
                            title={`${r.name ?? `#${r.type_id}`} ×${r.count} (${
                              r.class === "officer"
                                ? tr("Oficial")
                                : r.class === "capital"
                                  ? tr("Capital")
                                  : tr("Faction")
                            })`}
                          >
                            {r.name ?? `#${r.type_id}`} ×{r.count}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <PapersBlock series={paperSeries} data={abyssals} />
    </>
  );
}

/* ---------- Resumen (dashboard financiero) ---------- */

function PapersBlock({
  series,
  data,
}: {
  series: PaperSeries | null;
  data: AbyssalsData | null;
}) {
  const srcLabel: Record<string, string> = { abyssal: tr("Abyssals"), crab: tr("CRAB") };
  const srcColor: Record<string, string> = { abyssal: DONUT_COLORS[0], crab: DONUT_COLORS[1] };
  const days = series?.daily ?? [];
  const dates = [...new Set(days.map((d) => d.date))].sort();
  const sources = [...new Set(days.map((d) => d.source))];
  const valAt = (date: string, src: string) =>
    days.find((d) => d.date === date && d.source === src)?.value ?? 0;
  const chartSeries = sources.map((src) => ({
    name: srcLabel[src] ?? src,
    color: srcColor[src] ?? DONUT_COLORS[0],
    values: dates.map((d) => valAt(d, src)),
  }));
  const groups = (data?.papers ?? []).filter((g) => g.qty > 0);
  return (
    <div className="papers-block">
      <h4>💠 {tr("Papeles (loot redimible — estimado)")}</h4>
      <p className="muted small">
        {tr("Valor ESTIMADO a precio de mercado del loot redimible (Abyssals + CRAB). La gráfica ACUMULA los papeles que vas ganando (detecta las subidas de cantidad en tus assets en cada sync y las suma, como el ISK del wallet); vender no resta. No es ISK realizado: es una estimación a mercado.")}
      </p>
      {dates.length >= 2 ? (
        <>
          <div className="rateo-charthead">
            <span className="muted small">{tr("Papeles acumulados (ganados) · valor estimado a mercado")}</span>
          </div>
          <MultiLineProgress labels={dates} series={chartSeries} fmt={fmtIsk} />
        </>
      ) : (
        <p className="muted small">
          {tr("La gráfica acumulada se construye con el tiempo: cada sync (y cada vez que abres esta vista) guarda una foto del inventario y suma lo nuevo. Necesita al menos dos lecturas en días distintos.")}
        </p>
      )}
      {data && (
        <>
          <div className="kpis">
            <Kpi label={tr("Papeles en inventario")} value={fmtSp(data.papers_qty)} />
            <Kpi label={tr("Valor estimado (mercado)")} value={fmtIsk(data.papers_value)} tone="pos" />
          </div>
          {groups.length === 0 ? (
            <p className="muted small">
              {tr("No tienes papeles en assets (o falta el scope de assets). Es el loot redimible que vendes en el mercado.")}
            </p>
          ) : (
            <div className="resumen-grid">
              {groups.map((g) => (
                <div className="top-list" key={g.type_id}>
                  <h4 style={{ color: srcColor[g.source] }}>
                    {tr("Inventario")} {srcLabel[g.source] ?? g.name}
                  </h4>
                  <div className="kpis">
                    <Kpi label={tr("Cantidad")} value={fmtSp(g.qty)} />
                    <Kpi label={tr("Valor estimado")} value={fmtIsk(g.value)} tone="pos" />
                  </div>
                  <table className="km-table cat-table">
                    <thead>
                      <tr>
                        <th>{tr("Ubicación")}</th>
                        <th style={{ textAlign: "right" }}>{tr("Cantidad")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.by_loc.map((p, i) => (
                        <tr key={i}>
                          <td>{p.location_name || `#${p.system_id}`}</td>
                          <td style={{ textAlign: "right" }}>{fmtSp(p.quantity)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
