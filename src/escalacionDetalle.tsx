// ★★ DETALLE DE UNA ESCALACIÓN ARCHIVADA — «¿cómo fue aquélla?» (idea de RoGiz7, 2026-09-16).
//
// ★ LO QUE JUSTIFICA LA VENTANA, y no es «más información»: hay datos que Koru YA GUARDA de cada
//   escalación y que **no se ven en ninguna parte**. Medido antes de escribir esto:
//
//   · `loot_note` — la «nota del botín» que TE PIDE el modal al cerrar. Se guarda y no se enseña.
//     Exploración sí la pinta (`explorationLog.tsx`), los abismos ni la piden. **Escalaciones era
//     la única pantalla que te la pedía y se la quedaba**: un campo de solo escritura.
//   · La cronología de la venta (`cobrada_at`, `entregada_at`, `acceso_retirado_at`): nada.
//   · La cadena (`cadena_id`): una expedición de cuatro partes no decía que lo fuera.
//   · `entry_cost`, y el resultado de CADA piloto (`outcome`, `lost_value`): la tabla pone
//     retratos, no quién murió ni lo que le costó.
//
// ⚠️ LO QUE ESTA VENTANA **NO** PUEDE ENSEÑAR, y hay que decirlo aquí para que nadie lo prometa
//    más adelante: **el botín detallado no está guardado.** `activity_runs` tiene `loot_isk` (un
//    número) y `loot_note` (texto). El pegado del inventario se valora y se tira. Así que aquí no
//    hay lista de objetos ni la habrá para las escalaciones pasadas — por eso la nota del botín,
//    que es lo único que queda de aquel pegado, sale destacada y no en letra pequeña.
//
// Se monta por PORTAL en <body> por el mismo motivo que los demás modales: las secciones van
// dentro de `.panel-art-wrap`, que con `isolation: isolate` dejaría la ventana presa.
import { createPortal } from "react-dom";
import { tr } from "./i18n";
import { fmtIsk, typeIcon } from "./format";
// Hoy, sin `onFicha`, esto pinta texto plano — igual que en las otras dos veces que se usa para un
// comprador. Va puesto de todas formas: el día que se cablee la ficha del piloto, dejar aquí el
// nombre a pelo sería el caso clásico de arreglarlo en un sitio y no en su hermano.
import { PilotoNombre } from "./fichaPiloto";

/** Solo lo que esta ventana pinta. Mismo criterio que el resto de la pantalla: declarar un campo
 *  es prometer que se enseña. */
export type EscDet = {
  titulo: string;
  ded: number | null;
  faccion_id: number | null;
  system_name: string;
  cadena_id: number | null;
  parte: number;
  modo: string;
  estado: string;
  abierta_at: string;
  caduca_at: string;
  cerrada_at: string | null;
  character_id: number | null;
  comprador: string | null;
  precio: number | null;
  lista_acceso: string | null;
  cobrada_at: string | null;
  entregada_at: string | null;
  acceso_retirado_at: string | null;
  nota: string | null;
};

export type RunDet = {
  outcome?: string;
  loot_isk: number | null;
  loot_note?: string | null;
  ship_loss_isk: number | null;
  entry_cost?: number | null;
  started_at: string | null;
  ended_at: string | null;
  ship_type_id: number | null;
  chars?: {
    character_id: number;
    ship_type_id: number | null;
    outcome?: string;
    lost_value?: number;
  }[];
};

/** `2026-09-16T21:40:03Z` → `2026-09-16 21:40`. Se CORTA la cadena en vez de pasarla por `Date`:
 *  las horas de EVE son UTC y convertirlas a la zona del equipo haría que la cronología de una
 *  venta no cuadrara con lo que se vio en el juego. El resto de la app también corta. */
const fecha = (s: string | null | undefined): string =>
  s ? `${s.slice(0, 10)} ${s.slice(11, 16)}` : "—";

const facLogo = (id: number) => `https://images.evetech.net/corporations/${id}/logo?size=32`;

/** Una fila `etiqueta: valor`. No se pinta si no hay valor: una ficha llena de guiones se lee como
 *  que faltan datos, cuando lo que pasa es que esa escalación no tuvo esa parte. */
function Dato({ k, v, tone }: { k: string; v: React.ReactNode; tone?: "pos" | "neg" }) {
  if (v == null || v === "" || v === "—") return null;
  return (
    <div className="esc-det-fila">
      <span className="esc-det-k">{k}</span>
      <span className={tone === "pos" ? "kpi-pos" : tone === "neg" ? "kpi-neg" : ""}>{v}</span>
    </div>
  );
}

export function EscalacionDetalle({
  esc,
  run,
  charName,
  shipName,
  onClose,
}: {
  esc: EscDet;
  run: RunDet | undefined;
  charName: (id: number) => string;
  shipName: (id: number) => string;
  onClose: () => void;
}) {
  const vendida = esc.modo === "venta";
  const dur = (() => {
    if (!run?.started_at || !run.ended_at) return null;
    const min = Math.round((Date.parse(run.ended_at) - Date.parse(run.started_at)) / 60000);
    // Una run cerrada en el mismo gesto («Hecha» sin «Voy») dura ~0: no se pinta un «0 min» que se
    // leería como que la hiciste en cero. Misma regla que el histórico.
    return min >= 1 ? `${min} min` : null;
  })();

  // Los participantes: si la run no tiene tabla hija, el dueño es el único que voló.
  const parts = run?.chars?.length
    ? run.chars
    : esc.character_id != null
      ? [{ character_id: esc.character_id, ship_type_id: run?.ship_type_id ?? null }]
      : [];

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal esc-det" onClick={(e) => e.stopPropagation()}>
        <div className="loot-modal-head">
          <strong>
            {esc.faccion_id != null ? (
              <img src={facLogo(esc.faccion_id)} alt="" width={18} height={18} style={{ verticalAlign: "-4px", marginRight: "0.35rem" }} />
            ) : null}
            {esc.titulo || tr("Escalación")}
          </strong>
          <button className="loot-modal-x" onClick={onClose} title={tr("Cerrar")}>
            ✕
          </button>
        </div>

        <div className="esc-det-sec">
          <Dato k={tr("Sistema")} v={esc.system_name} />
          <Dato k={tr("Valoración DED")} v={esc.ded != null ? `${esc.ded}/10` : null} />
          {/* La cadena: las expediciones sin rating son de hasta CUATRO partes, y cada parte da 24 h
              nuevas. Que una escalación sea la parte 3 de algo explica su reloj, y hasta ahora no
              se veía en ningún sitio. */}
          <Dato
            k={tr("Cadena")}
            v={esc.cadena_id != null ? `${tr("parte")} ${esc.parte}` : null}
          />
          <Dato k={tr("Modalidad")} v={vendida ? `💰 ${tr("vendida")}` : tr("propia")} />
          <Dato
            k={tr("Estado")}
            v={tr(esc.estado)}
            tone={esc.estado === "caducada" || esc.estado === "perdida" ? "neg" : undefined}
          />
        </div>

        {/* ---- la run ---- */}
        <div className="esc-det-sec">
          <h5>{tr("Cómo fue")}</h5>
          {!run ? (
            <p className="muted small">
              {tr("No se registró ninguna run: de esta escalación solo queda lo apuntado arriba.")}
            </p>
          ) : (
            <>
              <Dato k={tr("Duración")} v={dur} />
              <Dato k={tr("Botín")} v={run.loot_isk != null ? fmtIsk(run.loot_isk) : null} tone="pos" />
              <Dato k={tr("Coste de entrada")} v={run.entry_cost != null ? fmtIsk(run.entry_cost) : null} tone="neg" />
              <Dato
                k={tr("Nave perdida")}
                v={run.ship_loss_isk != null ? fmtIsk(run.ship_loss_isk) : null}
                tone="neg"
              />
              {/* ★ LA NOTA DEL BOTÍN, DESTACADA. Es lo ÚNICO que queda de aquel pegado del
                  inventario —los objetos no se guardan—, así que ponerla en letra pequeña sería
                  esconder la mejor pista de qué cayó. Y hasta hoy no se veía en ninguna parte. */}
              {run.loot_note ? (
                <div className="esc-det-nota">
                  <span className="esc-det-k">{tr("Nota del botín")}</span>
                  <div>{run.loot_note}</div>
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* ---- quién fue ---- */}
        {parts.length > 0 && (
          <div className="esc-det-sec">
            <h5>{tr("Quién fue")}</h5>
            {parts.map((p) => {
              const muerto = p.outcome === "dead";
              return (
                <div className="esc-det-fila" key={p.character_id}>
                  <span>
                    <img
                      src={`https://images.evetech.net/characters/${p.character_id}/portrait?size=32`}
                      alt=""
                      width={18}
                      height={18}
                      style={{ borderRadius: "50%", verticalAlign: "-4px", marginRight: "0.35rem" }}
                    />
                    {charName(p.character_id)}
                    {/* El que la tenía va marcado: en multibox contesta «¿de quién era?». */}
                    {p.character_id === esc.character_id ? (
                      <span className="muted small"> · {tr("suya")}</span>
                    ) : null}
                  </span>
                  <span className={muerto ? "kpi-neg" : ""}>
                    {p.ship_type_id != null ? (
                      <img
                        src={typeIcon(p.ship_type_id, 32)}
                        alt=""
                        width={18}
                        height={18}
                        style={{ verticalAlign: "-4px", marginRight: "0.3rem" }}
                        title={shipName(p.ship_type_id)}
                      />
                    ) : null}
                    {p.ship_type_id != null ? shipName(p.ship_type_id) : ""}
                    {muerto ? ` · 💀${p.lost_value ? ` ${fmtIsk(p.lost_value)}` : ""}` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* ---- la venta ---- */}
        {vendida && (
          <div className="esc-det-sec">
            <h5>💰 {tr("La venta")}</h5>
            <Dato
              k={tr("Comprador")}
              v={esc.comprador ? <PilotoNombre nombre={esc.comprador} /> : null}
            />
            <Dato k={tr("Precio")} v={esc.precio != null ? fmtIsk(esc.precio) : null} tone="pos" />
            <Dato k={tr("Lista de acceso")} v={esc.lista_acceso} />
          </div>
        )}

        {/* ---- cronología ---- */}
        <div className="esc-det-sec">
          <h5>{tr("Cronología")}</h5>
          <Dato k={tr("Apuntada")} v={fecha(esc.abierta_at)} />
          <Dato k={tr("Caducaba")} v={fecha(esc.caduca_at)} />
          {vendida && <Dato k={tr("Cobrada")} v={fecha(esc.cobrada_at)} />}
          {vendida && <Dato k={tr("Acceso dado")} v={fecha(esc.entregada_at)} />}
          {/* ★ El que de verdad importa de la modalidad de venta: mientras no se retire el acceso,
              el comprador sigue dentro de tu safe y la ranura sigue ocupada. */}
          {vendida && <Dato k={tr("Acceso retirado")} v={fecha(esc.acceso_retirado_at)} />}
          <Dato k={tr("Cerrada")} v={fecha(esc.cerrada_at)} />
        </div>

        {esc.nota ? (
          <div className="esc-det-nota">
            <span className="esc-det-k">{tr("Nota")}</span>
            <div>{esc.nota}</div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
