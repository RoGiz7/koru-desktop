// Sección Patrimonio (networth) + Wallet: evolución del valor líquido+assets, y balance/ingresos/
// gastos/movimientos con tendencia mensual. Extraído de App.tsx. NetworthChart es interno.
import { useState, useEffect } from "react";
import { tr } from "./i18n";
import { fmtIsk, weekKey, daysAgo } from "./format";
import { Kpi, MultiLineProgress, Donut, Th, DONUT_COLORS, RangePresets, maxOf } from "./charts";
import type { NetworthView, NetworthPoint, WalletView, WalletSeries, WalletCatDay, WalletCharDay } from "./types";

export function NetworthViewC(props: { data: NetworthView | null; busy: boolean }) {
  const { data, busy } = props;
  if (!data && busy) return <p className="muted">{tr("Cargando…")}</p>;
  if (!data) return null;
  const s = data.series;

  return (
    <>
      <div className="kpis">
        <Kpi label={tr("Patrimonio total")} value={fmtIsk(data.total)} />
        <Kpi label={tr("Líquido (wallet)")} value={fmtIsk(data.liquid)} />
        <Kpi label={tr("Valor de assets")} value={fmtIsk(data.asset_value)} />
        <Kpi label={tr("Snapshots")} value={s.length} />
      </div>

      {data.total > 0 && (
        <div className="panel resumen-panel" style={{ maxWidth: 540, marginBottom: "0.8rem" }}>
          <h4>{tr("Composición del patrimonio")}</h4>
          <Donut
            items={[
              { label: tr("Líquido (wallet)"), value: data.liquid },
              { label: tr("Valor de assets"), value: data.asset_value },
            ]}
            fmt={fmtIsk}
          />
        </div>
      )}

      {data.prices_loaded === 0 && (
        <p className="muted" style={{ marginTop: 8 }}>
          {tr("Aún no hay precios de mercado en la BD, así que los assets no están valorados. Se descargan solos en la próxima sincronización (endpoint público de ESI).")}
        </p>
      )}

      {s.length === 0 && (
        <p className="muted" style={{ marginTop: 12 }}>
          {tr("Todavía no hay histórico. Cada sincronización guarda un snapshot diario de tu patrimonio; la curva de evolución aparecerá a partir del segundo día.")}
        </p>
      )}

      {s.length === 1 && (
        <p className="muted" style={{ marginTop: 12 }}>
          {tr("Primer snapshot guardado")} ({s[0].date}). {tr("La gráfica de evolución necesita al menos dos días de datos.")}
        </p>
      )}

      {s.length >= 2 && <NetworthChart series={s} />}

      {s.length >= 2 && (
        <p className="muted" style={{ marginTop: 8, fontSize: "0.78rem" }}>
          {tr("Valor de assets estimado con el precio medio de mercado (average price de ESI), no con órdenes reales de Jita, y EXCLUYENDO blueprints (su precio base infla el total). Útil como tendencia, no como liquidación exacta. Los snapshots anteriores a esta versión aún incluyen blueprints (verás un escalón).")}
        </p>
      )}
    </>
  );
}

/// Mini gráfico de líneas (SVG propio) para la evolución del patrimonio.
function NetworthChart(props: { series: NetworthPoint[] }) {
  const { series } = props;
  const W = 760;
  const H = 260;
  const padL = 8;
  const padR = 8;
  const padT = 14;
  const padB = 22;
  const n = series.length;
  // spread NO: con una serie larga revienta la pila y la app se va a negro. Ver maxOf en charts.tsx.
  const maxV = maxOf(series.map((p) => p.total), 1);
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v / maxV) * (H - padT - padB);
  const line = (key: "total" | "liquid" | "asset_value") =>
    series.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");

  // Área bajo la curva del total.
  const area =
    `M${x(0).toFixed(1)},${y(series[0].total).toFixed(1)} ` +
    series.map((p, i) => `L${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join(" ") +
    ` L${x(n - 1).toFixed(1)},${(H - padB).toFixed(1)} L${x(0).toFixed(1)},${(H - padB).toFixed(1)} Z`;

  const first = series[0];
  const last = series[n - 1];
  const delta = last.total - first.total;
  const pct = first.total > 0 ? (delta / first.total) * 100 : 0;

  return (
    <div className="nw-chart">
      <div className="nw-chart-head">
        <span className="nw-legend">
          <i className="dot total" /> {tr("Total")}
          <i className="dot liquid" /> {tr("Líquido")}
          <i className="dot asset" /> {tr("Assets")}
        </span>
        <span className={`nw-delta ${delta >= 0 ? "up" : "down"}`}>
          {delta >= 0 ? "▲" : "▼"} {fmtIsk(Math.abs(delta))} ({pct >= 0 ? "+" : ""}
          {pct.toFixed(1)}%)
        </span>
      </div>
      <svg className="nw-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <path className="nw-area" d={area} />
        <path className="nw-line asset" d={line("asset_value")} />
        <path className="nw-line liquid" d={line("liquid")} />
        <path className="nw-line total" d={line("total")} />
      </svg>
      <div className="nw-axis">
        <span>{first.date}</span>
        <span className="muted">{tr("máx")} {fmtIsk(maxV)}</span>
        <span>{last.date}</span>
      </div>
    </div>
  );
}

export function WalletViewC(props: {
  data: WalletView | null;
  series?: WalletSeries | null;
  charNames?: Map<number, string>;
  busy: boolean;
  global?: boolean;
  onSync?: () => void;
}) {
  const { data, series, charNames, busy, global, onSync } = props;
  const [gran, setGran] = useState<"day" | "week" | "month" | "year">(
    () => (localStorage.getItem("koru-wallet-gran") as "day" | "week" | "month" | "year") || "month",
  );
  const cumulative: boolean = false; // "Acumulado" retirado; los presets de rango lo sustituyen.
  const [from, setFrom] = useState(daysAgo(90));
  const [to, setTo] = useState("");
  const [dim, setDim] = useState<"flux" | "cat" | "char">(
    () => (localStorage.getItem("koru-wallet-dim") as "flux" | "cat" | "char") || "flux",
  );
  useEffect(() => {
    localStorage.setItem("koru-wallet-gran", gran);
  }, [gran]);
  useEffect(() => {
    localStorage.setItem("koru-wallet-dim", dim);
  }, [dim]);
  const [wSort, setWSort] = useState<{ col: string; dir: 1 | -1 }>({ col: "date", dir: -1 });
  const onWSort = (col: string) =>
    setWSort((s) => (s.col === col ? { col, dir: s.dir === 1 ? -1 : 1 } : { col, dir: 1 }));
  const wRows = [...(data?.stats.recent ?? [])].sort((a, b) => {
    const d = wSort.dir;
    switch (wSort.col) {
      case "type":
        return (a.ref_type ?? "").localeCompare(b.ref_type ?? "") * d;
      case "amount":
        return ((a.amount ?? 0) - (b.amount ?? 0)) * d;
      case "balance":
        return ((a.balance ?? 0) - (b.balance ?? 0)) * d;
      default:
        return (a.date ?? "").localeCompare(b.date ?? "") * d;
    }
  });

  // --- Gráfica unificada (multilínea) ---
  const granLabel =
    gran === "day" ? tr("día") : gran === "week" ? tr("semana") : gran === "month" ? tr("mes") : tr("año");
  const inRange = (date: string) => (!from || date >= from) && (!to || date <= to);
  const bucketKey = (date: string) =>
    gran === "year"
      ? date.slice(0, 4)
      : gran === "month"
        ? date.slice(0, 7)
        : gran === "week"
          ? weekKey(date)
          : date;
  const dayMap = new Map<string, { inc: number; exp: number }>();
  for (const d of series?.daily ?? []) {
    if (!inRange(d.date)) continue;
    const k = bucketKey(d.date);
    const e = dayMap.get(k) ?? { inc: 0, exp: 0 };
    e.inc += d.income;
    e.exp += d.expense;
    dayMap.set(k, e);
  }
  // KPIs del RANGO seleccionado (Ingresos/Gastos/Neto) en vez del histórico completo.
  const rangeInc = (series?.daily ?? [])
    .filter((d) => inRange(d.date))
    .reduce((a, d) => a + d.income, 0);
  const rangeExp = (series?.daily ?? [])
    .filter((d) => inRange(d.date))
    .reduce((a, d) => a + d.expense, 0);
  const walletYears = [...new Set((series?.daily ?? []).map((d) => +d.date.slice(0, 4)))]
    .filter((y) => y > 0)
    .sort((a, b) => b - a);
  const labels = [...dayMap.keys()];
  const cum = (arr: number[]) => {
    if (!cumulative) return arr;
    let a = 0;
    return arr.map((v) => (a += v));
  };
  const fluxSeries = [
    { name: tr("Ingresos"), color: "#3fb950", values: cum(labels.map((l) => dayMap.get(l)!.inc)) },
    { name: tr("Gastos"), color: "#e5534b", values: cum(labels.map((l) => dayMap.get(l)!.exp)) },
    {
      name: tr("Neto"),
      color: "#c8d3df",
      values: cum(labels.map((l) => dayMap.get(l)!.inc + dayMap.get(l)!.exp)),
    },
  ];
  const buildSigned = (
    rows: { id: string | number; date: string; net: number }[],
    nameFn: (id: string | number) => string,
  ) => {
    const m = new Map<string | number, Map<string, number>>();
    for (const r of rows) {
      if (!inRange(r.date)) continue;
      const k = bucketKey(r.date);
      let mm = m.get(r.id);
      if (!mm) {
        mm = new Map();
        m.set(r.id, mm);
      }
      mm.set(k, (mm.get(k) ?? 0) + r.net);
    }
    const totals = [...m.entries()]
      .map(([id, mm]) => ({ id, total: Math.abs([...mm.values()].reduce((a, b) => a + b, 0)) }))
      .sort((a, b) => b.total - a.total);
    return totals.slice(0, 8).map((t, i) => ({
      name: nameFn(t.id),
      color: DONUT_COLORS[i % DONUT_COLORS.length],
      values: cum(labels.map((l) => m.get(t.id)?.get(l) ?? 0)),
    }));
  };
  const catSeries = buildSigned(
    (series?.by_cat ?? []).map((r: WalletCatDay) => ({ id: r.cat, date: r.date, net: r.net })),
    (id) => tr(String(id)),
  );
  const charSeries = buildSigned(
    (series?.by_char ?? []).map((r: WalletCharDay) => ({ id: r.character_id, date: r.date, net: r.net })),
    (id) => charNames?.get(Number(id)) ?? `#${id}`,
  );
  const multiChar = new Set((series?.by_char ?? []).map((r) => r.character_id)).size > 1;
  const lineSeries = dim === "cat" ? catSeries : dim === "char" && multiChar ? charSeries : fluxSeries;

  return (
    <>
      {!global && (
        <div className="pvp-toolbar">
          <button onClick={onSync} disabled={busy}>
            {busy ? tr("Trabajando…") : tr("Sincronizar wallet")}
          </button>
        </div>
      )}
      {!data && busy && <p className="muted">{tr("Cargando…")}</p>}
      {data && (
        <>
          <div className="kpis">
            <Kpi label={tr("Balance")} value={fmtIsk(data.balance)} />
            <Kpi label={tr("Ingresos")} value={fmtIsk(rangeInc)} tone="pos" />
            <Kpi label={tr("Gastos")} value={fmtIsk(rangeExp)} tone="neg" />
            <Kpi
              label={tr("Neto")}
              value={fmtIsk(rangeInc - rangeExp)}
              tone={rangeInc - rangeExp >= 0 ? "pos" : "neg"}
            />
            <Kpi label={tr("Movimientos")} value={data.stats.entries} />
          </div>
          <div className="rateo-controls">
            <div className="seg">
              {(["day", "week", "month"] as const).map((g) => (
                <button key={g} className={gran === g ? "active" : ""} onClick={() => setGran(g)}>
                  {g === "day" ? tr("Día") : g === "week" ? tr("Semana") : g === "month" ? tr("Mes") : tr("Año")}
                </button>
              ))}
            </div>
            <RangePresets from={from} to={to} setFrom={setFrom} setTo={setTo} years={walletYears} />
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
              <div className="seg seg-sm">
                <button className={dim === "flux" ? "active" : ""} onClick={() => setDim("flux")}>
                  {tr("Flujo")}
                </button>
                <button className={dim === "cat" ? "active" : ""} onClick={() => setDim("cat")}>
                  {tr("Por categoría")}
                </button>
                {multiChar && (
                  <button className={dim === "char" ? "active" : ""} onClick={() => setDim("char")}>
                    {tr("Por personaje")}
                  </button>
                )}
              </div>
            </div>
            {!series ? (
              <p className="muted small">{tr("Cargando…")}</p>
            ) : labels.length === 0 ? (
              <p className="muted small">{tr("Sin datos.")}</p>
            ) : (
              <MultiLineProgress labels={labels} series={lineSeries} fmt={fmtIsk} />
            )}
          </div>

          <h4>{tr("Movimientos recientes")}</h4>
          <table className="km-table">
            <thead>
              <tr>
                <Th label={tr("Fecha")} col="date" sort={wSort} onSort={onWSort} />
                <Th label={tr("Tipo")} col="type" sort={wSort} onSort={onWSort} />
                <Th label={tr("Cantidad")} col="amount" sort={wSort} onSort={onWSort} />
                <Th label={tr("Balance")} col="balance" sort={wSort} onSort={onWSort} />
              </tr>
            </thead>
            <tbody>
              {wRows.map((j) => (
                <tr key={j.id} className={(j.amount ?? 0) >= 0 ? "kill" : "loss"}>
                  <td>{j.date?.replace("T", " ").slice(0, 16) ?? "-"}</td>
                  <td>{j.ref_type ?? "-"}</td>
                  <td>{j.amount != null ? fmtIsk(j.amount) : "-"}</td>
                  <td>{j.balance != null ? fmtIsk(j.balance) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
