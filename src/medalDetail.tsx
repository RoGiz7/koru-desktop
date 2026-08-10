// Ficha de medalla: la ventana que se abre al pulsar una medalla del medallero.
//
// POR QUÉ EXISTE. Antes esto era un mini-gráfico de 300×92 px dentro de la propia tarjeta, y no se
// entendía nada — por dos motivos, uno de espacio y otro de fondo:
//   1. La serie era ACUMULADA, y una suma corrida solo puede subir. Por construcción no tiene
//      fluctuaciones que mirar: un mes a cero y un mes bueno se ven igual de planos cuando el total
//      ya es grande. La historia («¿qué mes le di fuerte? ¿cuándo lo dejé?») vive en el DELTA
//      mensual, que es justo lo que el acumulado borra.
//   2. La escala se calculaba contra el umbral de ORO, así que si ibas por el 7% del oro tu curva
//      vivía aplastada contra el suelo del cuadro.
//
// Aquí se pintan LAS DOS: barras = lo de cada mes (el ritmo), línea = el acumulado (el que cruza
// los umbrales), y encima los hitos de bronce/plata/oro con su fecha. Más un resumen en cristiano,
// porque el gráfico enseña pero no dice.
//
// Las series `max` (patrimonio, killmail más caro, ISK/h récord) se leen distinto: la barra es el
// valor REAL de ese mes —que sube y baja, ahí sí hay fluctuación— y la línea es el récord vigente,
// una escalera que nunca baja.
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { tr } from "./i18n";
import { fmtIsk, fmtSp, fmtCompact, MONTH_NAMES } from "./format";
import type { AchievementState, AchSeries, SeriesPoint } from "./types";

const TIER_COLOR = ["", "#cd7f32", "#c9d1d9", "#e8be3f"];
const TIER_NAME = ["", "Bronce", "Plata", "Oro"];

function fmtVal(v: number, unit: string): string {
  return unit === "isk" ? fmtIsk(v) : fmtSp(Math.round(v));
}

/** "2026-08" → "ago 2026". Mes corto para que quepan muchos en el eje. */
function monthLabel(m: string): string {
  const [y, mm] = m.split("-");
  const name = MONTH_NAMES[Number(mm) - 1] ?? mm;
  return `${tr(name).slice(0, 3).toLowerCase()} ${y}`;
}

/** Rangos de tiempo del filtro. `null` = sin límite (todo el histórico). */
const RANGES: { key: string; label: string; months: number | null }[] = [
  { key: "all", label: "Todo", months: null },
  { key: "24", label: "2 años", months: 24 },
  { key: "12", label: "12 meses", months: 12 },
  { key: "6", label: "6 meses", months: 6 },
];

/** Mes en el que se cruzó cada umbral, leído de la propia serie (no de unlocked_at: así el hito
 *  cae en el punto EXACTO de la línea que lo cruza y no queda descolgado del dibujo). */
function tierMonths(points: SeriesPoint[], thresholds: [number, number, number]): (string | null)[] {
  return thresholds.map((th) => points.find((p) => p.value >= th && th > 0)?.month ?? null);
}

export function MedalDetail({
  a,
  ui,
  series,
  onClose,
}: {
  a: AchievementState;
  ui: { icon: string; label: string; desc: string; tid?: number };
  series?: AchSeries;
  onClose: () => void;
}) {
  const [range, setRange] = useState("all");
  const [hover, setHover] = useState<number | null>(null);

  const all = series?.points ?? [];
  const kind = series?.kind ?? "cum";
  // Los hitos se buscan SIEMPRE sobre la serie completa: si recortas a 6 meses, el mes en que
  // cruzaste bronce hace dos años sigue siendo ese, no el primero que quede a la vista.
  const crossed = useMemo(() => tierMonths(all, a.thresholds), [all, a.thresholds]);

  const pts = useMemo(() => {
    const n = RANGES.find((r) => r.key === range)?.months;
    return n == null ? all : all.slice(-n);
  }, [all, range]);

  // ---- Resumen en cristiano. Todo se deriva del dato; si no hay dato, no se inventa nada. ----
  const resumen = useMemo(() => {
    if (pts.length === 0) return [];
    const out: string[] = [];
    const best = pts.reduce((x, p) => (p.delta > x.delta ? p : x), pts[0]);
    if (best.delta > 0) {
      out.push(
        kind === "max"
          ? `${tr("Tu mejor mes fue")} ${monthLabel(best.month)} (${fmtVal(best.delta, a.unit)}).`
          : `${tr("Tu mejor mes fue")} ${monthLabel(best.month)}: ${fmtVal(best.delta, a.unit)}.`,
      );
    }
    // Racha de meses seguidos sumando, contada desde el final hacia atrás.
    let racha = 0;
    for (let i = pts.length - 1; i >= 0 && pts[i].delta > 0; i--) racha++;
    if (racha >= 2) out.push(`${tr("Llevas")} ${racha} ${tr("meses seguidos sumando")}.`);
    else if (racha === 0) out.push(tr("Este mes todavía no has sumado nada aquí."));

    // Estimación al siguiente tier: SOLO con el ritmo de los últimos 3 meses y SOLO si ese ritmo
    // existe. Sin ritmo no hay fecha — decir "nunca" o inventar un número sería mentir.
    if (a.level < 3 && kind === "cum") {
      const next = a.thresholds[a.level];
      const falta = next - a.value;
      const ult3 = pts.slice(-3);
      const ritmo = ult3.reduce((s, p) => s + p.delta, 0) / Math.max(1, ult3.length);
      const meses = ritmo > 0 ? Math.ceil(falta / ritmo) : Infinity;
      // Tope de 36 meses a propósito. Una estimación a seis años vista es aritméticamente
      // correcta e informativamente basura: nadie planifica así y solo consigue desanimar.
      // Pasado el tope se dice lo que falta, que es un dato duro y no una promesa.
      if (falta > 0 && ritmo > 0 && meses <= 36) {
        const d = new Date();
        d.setMonth(d.getMonth() + meses);
        const cuando = `${tr(MONTH_NAMES[d.getMonth()])} ${d.getFullYear()}`;
        out.push(
          `${tr("Al ritmo de los últimos 3 meses llegas a")} ${tr(TIER_NAME[a.level + 1])} ${tr("sobre")} ${cuando}.`,
        );
      } else if (falta > 0) {
        out.push(`${tr("Te faltan")} ${fmtVal(falta, a.unit)} ${tr("para")} ${tr(TIER_NAME[a.level + 1])}.`);
      }
    }
    return out;
  }, [pts, a, kind]);

  // ---- Geometría. Dos escalas independientes: las barras contra el mejor mes, la línea contra
  // el acumulado final. Compartir escala aplastaría las barras hasta hacerlas invisibles. ----
  const W = 760;
  const H = 260;
  const padL = 8;
  const padR = 8;
  const padT = 14;
  const padB = 26;
  const n = pts.length;
  const maxDelta = Math.max(...pts.map((p) => Math.abs(p.delta)), 1);
  // La línea sí mira al umbral siguiente (no al de oro): así ves de verdad lo cerca que estás del
  // que te toca, en vez de vivir aplastado contra el suelo por culpa de un oro lejanísimo.
  const nextTh = a.thresholds[Math.min(a.level, 2)];
  const maxLine = Math.max(...pts.map((p) => p.value), a.level >= 3 ? 0 : nextTh, 1);
  const bw = n > 0 ? (W - padL - padR) / n : 0;
  const xc = (i: number) => padL + bw * (i + 0.5);
  const yBar = (v: number) => H - padB - (Math.abs(v) / maxDelta) * (H - padT - padB) * 0.55;
  const yLine = (v: number) => H - padB - Math.min(1, v / maxLine) * (H - padT - padB);
  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${xc(i).toFixed(1)},${yLine(p.value).toFixed(1)}`).join(" ");
  const hp = hover != null ? pts[hover] : null;

  // ⚠️ PORTAL A `document.body`, y no es opcional. Cada sección va envuelta en `.panel-art-wrap`,
  // que lleva `isolation: isolate` para poder mandar el fondo de nave a z:-1. Eso crea un CONTEXTO
  // DE APILAMIENTO propio: dentro de él, el z-index del modal solo compite con sus hermanos de
  // sección, así que los controles del mapa (zoom, capas, Sistemas/Regiones) se le pintaban encima
  // por muy alto que fuera el número. Sacándolo al body el modal deja de estar preso del contexto.
  // Reportado por RoGiz7 con la app maximizada, 2026-08-05.
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="md-modal" onClick={(e) => e.stopPropagation()}>
        <div className="md-head">
          <div className="md-title">
            <strong>{tr(ui.label)}</strong>
            <span className="muted small">{tr(ui.desc)}</span>
          </div>
          <button className="loot-modal-x" onClick={onClose} title={tr("Cerrar")}>
            ✕
          </button>
        </div>

        {/* Cifra actual + los tres hitos con su fecha: el "estado" de un vistazo. */}
        <div className="md-tiers">
          <div className="md-now">
            <span className="md-now-val">{fmtVal(a.value, a.unit)}</span>
            <span className="muted small">{kind === "max" ? tr("mejor marca") : tr("total acumulado")}</span>
          </div>
          {[1, 2, 3].map((lvl) => (
            <div key={lvl} className={`md-tier${a.level >= lvl ? " on" : ""}`} style={{ color: TIER_COLOR[lvl] }}>
              <span className="md-tier-name">{tr(TIER_NAME[lvl])}</span>
              <span className="md-tier-th">{fmtVal(a.thresholds[lvl - 1], a.unit)}</span>
              <span className="muted small">
                {a.level >= lvl
                  ? (a.unlocked_at[lvl - 1] ?? (crossed[lvl - 1] ? monthLabel(crossed[lvl - 1]!) : "✔"))
                  : "—"}
              </span>
            </div>
          ))}
        </div>

        {n === 0 ? (
          <div className="md-empty muted">
            {tr("Todavía no hay evolución que enseñar para esta medalla.")}
            <div className="small">
              {tr("Aparecerá en cuanto Koru tenga al menos un mes de histórico de esta actividad.")}
            </div>
          </div>
        ) : (
          <>
            <div className="md-toolbar">
              <div className="bit-cat-tabs md-ranges">
                {RANGES.map((r) => (
                  <button
                    key={r.key}
                    className={range === r.key ? "active" : ""}
                    onClick={() => setRange(r.key)}
                    disabled={r.months != null && all.length <= r.months}
                  >
                    {tr(r.label)}
                  </button>
                ))}
              </div>
              <span className="muted small">
                {monthLabel(pts[0].month)} — {monthLabel(pts[n - 1].month)} · {n} {tr("meses")}
              </span>
            </div>

            <div className="md-chartwrap">
              <svg className="md-chart" viewBox={`0 0 ${W} ${H}`} role="img">
                {/* Umbrales: solo los que caben en la escala, para no dibujar líneas fuera del cuadro. */}
                {[0, 1, 2].map((t) => {
                  const v = a.thresholds[t];
                  if (v <= 0 || v > maxLine) return null;
                  return (
                    <g key={t}>
                      <line
                        x1={padL}
                        y1={yLine(v)}
                        x2={W - padR}
                        y2={yLine(v)}
                        stroke={TIER_COLOR[t + 1]}
                        strokeWidth={1}
                        strokeDasharray="4 4"
                        opacity={0.65}
                      />
                      <text x={W - padR - 2} y={yLine(v) - 4} className="md-thlabel" textAnchor="end" fill={TIER_COLOR[t + 1]}>
                        {tr(TIER_NAME[t + 1])} · {fmtCompact(v)}
                      </text>
                    </g>
                  );
                })}

                {/* Barras: lo de cada mes. Aquí es donde se ve el ritmo. */}
                {pts.map((p, i) => {
                  const y = yBar(p.delta);
                  return (
                    <rect
                      key={p.month}
                      className={`md-bar${hover === i ? " hot" : ""}`}
                      x={xc(i) - Math.max(1.5, bw * 0.34)}
                      y={y}
                      width={Math.max(3, bw * 0.68)}
                      height={Math.max(0, H - padB - y)}
                      rx={1.5}
                    />
                  );
                })}

                {/* Línea del acumulado / récord. */}
                <path className="md-line" d={linePath} />

                {/* Hitos: dónde cruzó cada tier, clavados en la línea. */}
                {crossed.map((mo, t) => {
                  const i = mo ? pts.findIndex((p) => p.month === mo) : -1;
                  if (i < 0) return null;
                  return (
                    <circle key={t} cx={xc(i)} cy={yLine(pts[i].value)} r={4.5} fill={TIER_COLOR[t + 1]} stroke="#0b0e13" strokeWidth={1.5}>
                      <title>{`${tr(TIER_NAME[t + 1])} — ${monthLabel(mo!)}`}</title>
                    </circle>
                  );
                })}

                {/* Base + zonas invisibles de hover (una por mes, a todo el alto: así no hay que
                    acertarle a una barra de 3 px de ancho). */}
                <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} className="md-axis" />
                {pts.map((p, i) => (
                  <rect
                    key={`h${p.month}`}
                    x={xc(i) - bw / 2}
                    y={0}
                    width={bw}
                    height={H}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                  />
                ))}
                {hover != null && <line x1={xc(hover)} y1={padT} x2={xc(hover)} y2={H - padB} className="md-cursor" />}

                {/* Eje: primer mes, último y el de en medio. Más etiquetas se solaparían. */}
                {[0, Math.floor((n - 1) / 2), n - 1]
                  .filter((i, k, arr) => i >= 0 && arr.indexOf(i) === k)
                  .map((i) => (
                    <text
                      key={`x${i}`}
                      x={xc(i)}
                      y={H - 8}
                      className="md-xlabel"
                      textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
                    >
                      {monthLabel(pts[i].month)}
                    </text>
                  ))}
              </svg>

              <div className="md-hoverbox">
                {hp ? (
                  <>
                    <strong>{monthLabel(hp.month)}</strong>
                    <span>
                      {kind === "max" ? tr("ese mes") : tr("en el mes")}: <b>{fmtVal(hp.delta, a.unit)}</b>
                    </span>
                    <span className="muted">
                      {kind === "max" ? tr("récord entonces") : tr("acumulado")}: {fmtVal(hp.value, a.unit)}
                    </span>
                  </>
                ) : (
                  <span className="muted small">{tr("Pasa el ratón por la gráfica para ver cada mes.")}</span>
                )}
              </div>
            </div>

            <div className="md-legend muted small">
              <span>
                <i className="md-key-bar" /> {kind === "max" ? tr("Valor de cada mes") : tr("Lo que sumaste ese mes")}
              </span>
              <span>
                <i className="md-key-line" /> {kind === "max" ? tr("Récord vigente") : tr("Total acumulado")}
              </span>
              <span>
                <i className="md-key-dot" /> {tr("Cuándo cruzaste cada nivel")}
              </span>
            </div>

            {resumen.length > 0 && (
              <div className="md-summary">
                {resumen.map((s, i) => (
                  <span key={i}>{s}</span>
                ))}
              </div>
            )}

            {/* La tabla es el dato en crudo: lo que la gráfica insinúa, aquí se lee. Del más
                reciente al más viejo, porque lo que interesa casi siempre es el final. */}
            <details className="md-table">
              <summary className="muted small">
                {tr("Ver mes a mes")} ({n})
              </summary>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>{tr("Mes")}</th>
                    <th className="num">{kind === "max" ? tr("Ese mes") : tr("En el mes")}</th>
                    <th className="num">{kind === "max" ? tr("Récord") : tr("Acumulado")}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...pts].reverse().map((p) => (
                    <tr key={p.month} className={p.delta === 0 ? "muted" : ""}>
                      <td>{monthLabel(p.month)}</td>
                      <td className="num">{p.delta === 0 ? "—" : fmtVal(p.delta, a.unit)}</td>
                      <td className="num">{fmtVal(p.value, a.unit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
