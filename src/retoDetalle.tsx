// ★★ LA HISTORIA DE UN RETO DEL MES — «¿lo cumplo de verdad, o solo este mes?».
//
// Idea de RoGiz7 (2026-09-16), después de darse cuenta de por qué le chirriaban los retos junto al
// medallero: **son cosas con vidas opuestas**. Una medalla es acumulativa y permanente; un reto se
// reinicia el día 1. Verlos en la misma tira los confundía, y una tarjeta suelta con un porcentaje
// no cuenta ninguna historia. Su petición: *«que al pinchar en el reto salga la estadística de la
// evolución, qué meses conseguiste los logros y a qué cota, para ver tu evolución real»*.
//
// ★ LA COTA ES UNA ESCALERA, NO UNA LÍNEA, y de ahí sale todo el dibujo. En una medalla el umbral
//   de oro es fijo y por eso se pinta como una raya recta. Aquí **la cota cambia cada mes**, porque
//   la pone tu propio mes anterior. Dibujarla plana sería mentir, y además perdería lo único que
//   esto tiene de interesante: **tu buen mes te sube el listón del siguiente**, que es justo por lo
//   que un reto encadenado es difícil. La escalera lo enseña sin explicarlo.
//
// ⚠️ HAY MESES SIN COTA, y se ven distintos a propósito: si el mes anterior no tocaste esa
//    actividad, ese mes NO hubo reto (`push_challenge` exige listón). Pintarles una cota inventada
//    sería enseñar un listón que nadie tuvo delante.
//
// Los números los calcula RUST (`get_challenge_history`) y aquí no se calcula ninguna cota: la
// regla `next_125` vive en un solo sitio. Ver el comentario de `retos_historia`.
import { createPortal } from "react-dom";
import { tr, getLang } from "./i18n";
import { fmtIsk, fmtSp, typeIcon } from "./format";
import type { RetoMes } from "./types";
import type { Tab } from "./constants";

const MESES_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2026-09` → `sep 26`. Corto a propósito: en el eje caben doce y hay que poder leerlos. */
function mesCorto(m: string): string {
  const [a, b] = m.split("-");
  const i = Math.max(0, Math.min(11, parseInt(b, 10) - 1));
  return `${(getLang() === "es" ? MESES_ES : MESES_EN)[i]} ${a.slice(2)}`;
}

const fmtVal = (v: number, unit: string) => (unit === "isk" ? fmtIsk(v) : fmtSp(Math.round(v)));

/** Compacta para el eje: ahí no cabe «1.234.567.890 ISK». */
function compacto(v: number, unit: string): string {
  if (unit !== "isk") return String(Math.round(v));
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `${Math.round(v / 1e6)}M`;
  if (Math.abs(v) >= 1e3) return `${Math.round(v / 1e3)}K`;
  return String(Math.round(v));
}

export function RetoDetalle({
  ui,
  unit,
  historia,
  tab,
  onIrA,
  onClose,
}: {
  ui: { label: string; icon: string; tid?: number };
  unit: string;
  historia: RetoMes[];
  /** La sección de la que vive este reto. Sin ella, el botón no se pinta. */
  tab?: Tab;
  onIrA?: (t: Tab) => void;
  onClose: () => void;
}) {
  // Los últimos 24 meses como mucho: más no cabe legible y nadie compara con hace tres años.
  const pts = historia.slice(-24);
  const n = pts.length;
  // Solo cuentan los meses en los que HUBO reto. Los demás no se puntúan ni a favor ni en contra.
  const conReto = pts.filter((p) => p.target != null);
  const logrados = conReto.filter((p) => p.achieved).length;
  const mejor = pts.reduce<RetoMes | null>((a, b) => (a && a.value >= b.value ? a : b), null);
  // Racha viva: meses seguidos cumpliendo, contando desde el final hacia atrás. Un mes SIN reto no
  // rompe la racha —no había nada que cumplir— pero tampoco suma.
  let racha = 0;
  for (let i = pts.length - 1; i >= 0; i--) {
    if (pts[i].target == null) continue;
    if (pts[i].achieved) racha++;
    else break;
  }

  const W = 620;
  const H = 210;
  const padL = 44;
  const padR = 12;
  const padT = 14;
  const padB = 26;
  const techo = Math.max(1, ...pts.map((p) => Math.max(p.value, p.target ?? 0)));
  const x = (i: number) => padL + ((W - padL - padR) * (i + 0.5)) / Math.max(1, n);
  const ancho = Math.max(4, ((W - padL - padR) / Math.max(1, n)) * 0.62);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / techo);

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="md-modal" onClick={(e) => e.stopPropagation()}>
        <div className="md-head">
          <div className="md-title">
            <strong>
              {ui.tid ? (
                <img className="bit-icon-img" src={typeIcon(ui.tid, 32)} alt="" loading="lazy" />
              ) : (
                <span className="bit-icon">{ui.icon}</span>
              )}{" "}
              {tr(ui.label)}
            </strong>
            <span className="muted small">{tr("Tu historia mes a mes, con la cota que tenías cada vez")}</span>
          </div>
          <button className="loot-modal-x" onClick={onClose} title={tr("Cerrar")}>
            ✕
          </button>
        </div>

        {conReto.length === 0 ? (
          <div className="md-empty muted">
            {tr("Todavía no hay historia que enseñar para este reto.")}
            <div className="small">
              {tr("Hace falta un mes con actividad para que el siguiente tenga cota: el listón lo pone tu mes anterior.")}
            </div>
          </div>
        ) : (
          <>
            {/* El estado de un vistazo. `logrados/conReto` y no sobre el total de meses: los meses
                sin reto no cuentan, y meterlos en el denominador haría bajar la cifra por meses en
                los que no había nada que cumplir. */}
            <div className="md-tiers">
              <div className="md-now">
                <span className="md-now-val">
                  {logrados}/{conReto.length}
                </span>
                <span className="muted small">{tr("meses cumplidos")}</span>
              </div>
              <div className="md-tier on">
                <span className="md-tier-name">{tr("Racha")}</span>
                <span className="md-tier-th">{racha}</span>
                <span className="muted small">{racha === 1 ? tr("mes seguido") : tr("meses seguidos")}</span>
              </div>
              <div className="md-tier on">
                <span className="md-tier-name">{tr("Tu mejor mes")}</span>
                <span className="md-tier-th">{mejor ? fmtVal(mejor.value, unit) : "—"}</span>
                <span className="muted small">{mejor ? mesCorto(mejor.month) : ""}</span>
              </div>
            </div>

            <div className="md-chartwrap">
              <svg className="md-chart" viewBox={`0 0 ${W} ${H}`} role="img">
                {/* Las barras: lo que hiciste. Verde si pasaste la cota de ESE mes. */}
                {pts.map((p, i) => {
                  const alto = Math.max(0, H - padB - y(p.value));
                  const clase = p.target == null ? "reto-b-sin" : p.achieved ? "reto-b-ok" : "reto-b-no";
                  return (
                    <rect
                      key={p.month}
                      className={clase}
                      x={x(i) - ancho / 2}
                      y={y(p.value)}
                      width={ancho}
                      height={alto}
                      rx={1}
                    >
                      <title>
                        {`${mesCorto(p.month)} · ${fmtVal(p.value, unit)}`}
                        {p.target != null
                          ? ` · ${tr("cota")} ${fmtVal(p.target, unit)}${p.achieved ? " ✔" : ""}`
                          : ` · ${tr("ese mes no hubo reto")}`}
                      </title>
                    </rect>
                  );
                })}
                {/* ★ LA ESCALERA DE LA COTA. Un tramo horizontal por mes, y hueco donde no hubo
                    reto — el hueco es información, no un fallo de dibujo. */}
                {pts.map((p, i) =>
                  p.target == null ? null : (
                    <line
                      key={`c${p.month}`}
                      className="reto-cota"
                      x1={x(i) - ancho / 2 - 2}
                      y1={y(p.target)}
                      x2={x(i) + ancho / 2 + 2}
                      y2={y(p.target)}
                    />
                  ),
                )}
                {/* Eje: el techo y la mitad, nada más. Un eje lleno de cifras tapa las barras. */}
                {[techo, techo / 2].map((v, i) => (
                  <text key={i} x={padL - 6} y={y(v) + 3} className="md-thlabel" textAnchor="end">
                    {compacto(v, unit)}
                  </text>
                ))}
                {/* Meses: se pintan salteados si no caben, para que se lean. */}
                {pts.map((p, i) =>
                  i % Math.ceil(n / 8) === 0 ? (
                    <text key={`m${p.month}`} x={x(i)} y={H - 8} className="md-thlabel" textAnchor="middle">
                      {mesCorto(p.month)}
                    </text>
                  ) : null,
                )}
              </svg>
            </div>

            <p className="muted small reto-leyenda">
              {tr("La línea de cada mes es la cota que tenías entonces: la pone tu mes anterior, así que un buen mes te sube el listón del siguiente.")}
            </p>
          </>
        )}

        {tab && onIrA && (
          <div className="md-foot">
            <button className="pp-add" onClick={() => onIrA(tab)}>
              {tr("Ver esta actividad en su sección")}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
