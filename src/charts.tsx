import { useState, useEffect } from "react";
import { fmtSp, fmtIsk, typeIcon, typeRender, daysAgo } from "./format";
import { tr } from "./i18n";
import type { NameCount } from "./types";

// Icono de un tipo de EVE; cae a blueprint si la imagen normal falla.
export function TypeIcon({
  typeId,
  size = 32,
  className = "type-ico",
}: {
  typeId: number;
  size?: number;
  className?: string;
}) {
  const [src, setSrc] = useState(typeIcon(typeId, size));
  useEffect(() => setSrc(typeIcon(typeId, size)), [typeId, size]);
  return (
    <img
      className={className}
      src={src}
      alt=""
      loading="lazy"
      onError={() => {
        const bp = `https://images.evetech.net/types/${typeId}/bp?size=${size}`;
        if (src !== bp) setSrc(bp);
      }}
    />
  );
}

// Icono de una capa del mapa: arte real de EVE si tiene typeId, si no el emoji.
export function OverlayIcon({ o }: { o: { icon: string; typeId?: number } }) {
  return o.typeId ? <img src={typeIcon(o.typeId, 32)} alt="" loading="lazy" /> : <>{o.icon}</>;
}

// Lista top-N con icono opcional.
export function TopList({
  title,
  items,
  icon,
}: {
  title: string;
  items: NameCount[];
  icon?: "icon" | "render";
}) {
  return (
    <div className="top-list">
      <h4>{title}</h4>
      {items.length === 0 && <p className="muted small">{tr("Sin datos.")}</p>}
      <ol className={icon ? "with-ico" : ""}>
        {items.map((it) => (
          <li key={it.id}>
            {icon &&
              (icon === "render" ? (
                <img className="type-ico" src={typeRender(it.id)} alt="" loading="lazy" />
              ) : (
                <TypeIcon typeId={it.id} />
              ))}
            {it.name ?? `#${it.id}`} <span className="muted">({it.count})</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// Paleta estable para donuts y series multilínea.
export const DONUT_COLORS = [
  "#4f9cff", "#a371f7", "#3fb950", "#d29922", "#db61a2",
  "#e5534b", "#2dd4bf", "#f0883e", "#8b949e", "#6e7681",
];

export function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "pos" | "neg";
}) {
  return (
    <div className="kpi">
      <div className={`kpi-value ${tone === "pos" ? "kpi-pos" : tone === "neg" ? "kpi-neg" : ""}`}>
        {value}
      </div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}

// Cabecera de tabla ordenable.
export function Th({
  label,
  col,
  sort,
  onSort,
}: {
  label: string;
  col: string;
  sort: { col: string; dir: 1 | -1 };
  onSort: (col: string) => void;
}) {
  const active = sort.col === col;
  return (
    <th className="th-sort" onClick={() => onSort(col)} title={tr("Ordenar")}>
      {label} <span className="th-arrow">{active ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span>
    </th>
  );
}

// Gráfica de barras horizontales reutilizable (SVG/CSS propio, sin dependencias).
export function Bars({
  items,
  color = "#4f9cff",
  fmt = fmtSp,
}: {
  items: { label: string; value: number }[];
  color?: string;
  fmt?: (n: number) => string;
}) {
  if (items.length === 0) return <p className="muted small">Sin datos.</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  const total = items.reduce((s, i) => s + i.value, 0);
  return (
    <div className="bars">
      {items.map((it, i) => {
        const pct = total > 0 ? (it.value / total) * 100 : 0;
        return (
          <div
            className="bar-row"
            key={i}
            title={`${it.label}: ${fmt(it.value)} · ${pct.toFixed(1)}% del total`}
          >
            <span className="bar-label">{it.label}</span>
            <span className="bar-track">
              <span
                className="bar-fill"
                style={{ width: `${Math.max((it.value / max) * 100, 1.5)}%`, background: color }}
              />
            </span>
            <span className="bar-val">{fmt(it.value)}</span>
          </div>
        );
      })}
    </div>
  );
}

// Path suave (Catmull-Rom → bézier) que pasa por todos los puntos.
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${pts[0].x} ${pts[0].y}`;
  let d = `M${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

// Varias curvas suaves superpuestas. Leyenda que aísla una serie al pulsarla; soporta negativos.
export function MultiLineProgress({
  labels,
  series,
  fmt = fmtIsk,
  legend = true,
}: {
  labels: string[];
  series: { name: string; color: string; values: number[]; dash?: boolean }[];
  fmt?: (n: number) => string;
  /// false = sin leyenda propia (el contenedor gestiona qué series entran).
  legend?: boolean;
}) {
  const [iso, setIso] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  if (labels.length === 0) return <p className="muted small">Sin datos.</p>;
  const vis = legend && iso ? series.filter((s) => s.name === iso) : series;
  const n = labels.length;
  const W = 760;
  const H = 250;
  const PADL = 52;
  const PADR = 14;
  const PADTOP = 14;
  const PADBOT = 26;
  const plotW = W - PADL - PADR;
  const plotH = H - PADTOP - PADBOT;
  const baseY = PADTOP + plotH;
  const flat = vis.flatMap((s) => s.values);
  const dMax = Math.max(1, ...flat);
  const dMin = Math.min(0, ...flat);
  const span = dMax - dMin || 1;
  const x = (i: number) => (n === 1 ? PADL + plotW / 2 : PADL + (i / (n - 1)) * plotW);
  const y = (v: number) => baseY - ((v - dMin) / span) * plotH;
  const zeroY = y(0);
  const step = Math.max(1, Math.ceil(n / 7));
  const grid = [0, 0.25, 0.5, 0.75, 1];
  const uid = labels.length + "-" + vis.length;
  return (
    <div className="line-wrap">
      {legend && (
        <div className="multiline-legend">
          <button className={`mll-chip${iso == null ? " active" : ""}`} onClick={() => setIso(null)}>
            {tr("Todos")}
          </button>
          {series.map((s) => (
            <button
              key={s.name}
              className={`mll-chip${iso === s.name ? " active" : ""}`}
              onClick={() => setIso((p) => (p === s.name ? null : s.name))}
              title={s.name}
            >
              <i style={{ background: s.color }} /> {s.name}
            </button>
          ))}
        </div>
      )}
      <svg
        className="ml-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          {vis.map((s, si) => (
            <linearGradient key={s.name} id={`mlg-${uid}-${si}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.32" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
          <filter id={`mlglow-${uid}`} x="-5%" y="-20%" width="110%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="2.2" floodColor="#000" floodOpacity="0.5" />
          </filter>
        </defs>
        {grid.map((g, gi) => {
          const gy = baseY - g * plotH;
          return (
            <g key={gi}>
              <line x1={PADL} y1={gy} x2={W - PADR} y2={gy} stroke="rgba(255,255,255,0.06)" />
              <text x={PADL - 8} y={gy + 3} textAnchor="end" className="ml-ylabel">
                {fmt(dMin + g * span)}
              </text>
            </g>
          );
        })}
        {dMin < 0 && (
          <line x1={PADL} y1={zeroY} x2={W - PADR} y2={zeroY} stroke="rgba(255,255,255,0.25)" strokeDasharray="3 3" />
        )}
        {vis.length <= 2 &&
          vis.map((s, si) => (
            <path
              key={`a-${s.name}`}
              d={`${smoothPath(s.values.map((v, i) => ({ x: x(i), y: y(v) })))} L${x(n - 1).toFixed(1)} ${zeroY.toFixed(1)} L${x(0).toFixed(1)} ${zeroY.toFixed(1)} Z`}
              fill={`url(#mlg-${uid}-${si})`}
            />
          ))}
        {vis.map((s) => (
          <path
            key={s.name}
            d={smoothPath(s.values.map((v, i) => ({ x: x(i), y: y(v) })))}
            fill="none"
            stroke={s.color}
            strokeWidth={iso ? 2.6 : 2}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={s.dash ? "6 4" : undefined}
            filter={`url(#mlglow-${uid})`}
          />
        ))}
        {labels.map((lab, i) => (
          <g key={i}>
            {hover === i && (
              <line x1={x(i)} y1={PADTOP} x2={x(i)} y2={baseY} stroke="rgba(255,255,255,0.18)" />
            )}
            {hover === i &&
              vis.map((s) => (
                <circle key={s.name} cx={x(i)} cy={y(s.values[i])} r={3.6} fill={s.color} stroke="#0d121a" strokeWidth={1} />
              ))}
            <rect
              x={i === 0 ? PADL : x(i) - plotW / (n - 1) / 2}
              y={PADTOP}
              width={n === 1 ? plotW : plotW / (n - 1)}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
            {i % step === 0 && (
              <text
                x={x(i)}
                y={H - 8}
                textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
                className="combo-xlabel"
              >
                {lab}
              </text>
            )}
          </g>
        ))}
      </svg>
      {hover != null && (
        <div className="combo-tip">
          <strong>{labels[hover]}</strong>
          {vis.map((s) => (
            <span key={s.name} style={{ color: s.color }}>
              {s.name}: {fmt(s.values[hover])}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function Donut({
  items,
  fmt = (n: number) => n.toLocaleString("es-ES"),
}: {
  items: { label: string; value: number }[];
  fmt?: (n: number) => string;
}) {
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const all = items.map((it, i) => ({ ...it, i })).filter((it) => it.value > 0);
  if (all.length === 0) return <p className="muted small">Sin datos.</p>;
  const visible = all.filter((it) => !hidden.has(it.i));
  const total = visible.reduce((s, it) => s + it.value, 0);
  const R = 60;
  const C = 2 * Math.PI * R;
  let acc = 0;
  const hovered = hover != null ? items[hover] : null;
  const hoveredPct =
    hovered && total > 0 && !hidden.has(hover as number) ? (hovered.value / total) * 100 : null;

  const toggle = (i: number) =>
    setHidden((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  return (
    <div className="donut-wrap">
      <div className="donut-chart">
        <svg viewBox="0 0 160 160" className="donut-svg">
          <g transform="rotate(-90 80 80)">
            {visible.map((it) => {
              const frac = total > 0 ? it.value / total : 0;
              const dash = frac * C;
              const off = -acc;
              acc += dash;
              const dim = hover != null && hover !== it.i;
              return (
                <circle
                  key={it.i}
                  cx="80"
                  cy="80"
                  r={R}
                  fill="none"
                  stroke={DONUT_COLORS[it.i % DONUT_COLORS.length]}
                  strokeWidth={hover === it.i ? 26 : 22}
                  strokeDasharray={`${dash} ${C - dash}`}
                  strokeDashoffset={off}
                  opacity={dim ? 0.35 : 1}
                  style={{ cursor: "pointer", transition: "stroke-width .1s, opacity .1s" }}
                  onMouseEnter={() => setHover(it.i)}
                  onMouseLeave={() => setHover(null)}
                >
                  <title>{`${it.label}: ${fmt(it.value)} (${((it.value / total) * 100).toFixed(1)}%)`}</title>
                </circle>
              );
            })}
          </g>
        </svg>
        <div className="donut-center">
          {hovered && hoveredPct != null ? (
            <>
              <strong>{hoveredPct.toFixed(1)}%</strong>
              <span>{hovered.label}</span>
            </>
          ) : (
            <>
              <strong>{fmt(total)}</strong>
              <span>total</span>
            </>
          )}
        </div>
      </div>
      <ul className="donut-legend">
        {all.map((it) => {
          const off = hidden.has(it.i);
          const pct = total > 0 && !off ? (it.value / total) * 100 : 0;
          return (
            <li
              key={it.i}
              className={off ? "is-off" : ""}
              title="Clic para ocultar/mostrar"
              onClick={() => toggle(it.i)}
              onMouseEnter={() => !off && setHover(it.i)}
              onMouseLeave={() => setHover(null)}
            >
              <span
                className="donut-dot"
                style={{ background: DONUT_COLORS[it.i % DONUT_COLORS.length] }}
              />
              <span className="donut-leg-label">{it.label}</span>
              <span className="donut-leg-val">{off ? "oculto" : `${fmt(it.value)} · ${pct.toFixed(0)}%`}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Presets de rango reutilizables para todas las gráficas temporales: 90 días (defecto) · Este año ·
// selector de año concreto · Todo. Evita mostrar de golpe el acumulado histórico (poco fiel a "ahora").
export function RangePresets({
  from,
  to,
  setFrom,
  setTo,
  years,
}: {
  from: string;
  to: string;
  setFrom: (s: string) => void;
  setTo: (s: string) => void;
  years?: number[];
}) {
  const year = new Date().getUTCFullYear();
  const isAll = !from && !to;
  const pickedYear = from.endsWith("-01-01") && to.endsWith("-12-31") && from.slice(0, 4) === to.slice(0, 4) ? from.slice(0, 4) : "";
  return (
    <div className="range-presets">
      <div className="seg seg-sm">
        <button
          className={from === daysAgo(90) && !to ? "active" : ""}
          onClick={() => {
            setFrom(daysAgo(90));
            setTo("");
          }}
        >
          {tr("90 días")}
        </button>
        <button
          className={from === `${year}-01-01` && !to ? "active" : ""}
          onClick={() => {
            setFrom(`${year}-01-01`);
            setTo("");
          }}
        >
          {tr("Este año")}
        </button>
        <button className={isAll ? "active" : ""} onClick={() => { setFrom(""); setTo(""); }}>
          {tr("Todo")}
        </button>
      </div>
      {years && years.length > 0 && (
        <select
          className="range-year"
          value={pickedYear}
          onChange={(e) => {
            const y = e.target.value;
            if (y) {
              setFrom(`${y}-01-01`);
              setTo(`${y}-12-31`);
            }
          }}
        >
          <option value="">{tr("Año…")}</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
