// ★★ DETALLE DE UNA ESCALACIÓN ARCHIVADA — «¿cómo fue aquélla?» (idea de RoGiz7, 2026-09-16).
//
// ★ LO QUE JUSTIFICA LA VENTANA, y no es «más información»: hay datos que Koru YA GUARDA de cada
//   escalación y que **no se ven en ninguna parte**. Medido antes de escribir esto:
//
//   · `loot_note` — la «nota del botín» que TE PIDE el modal al cerrar. Se guarda y no se enseña.
//     Exploración sí la pinta (`explorationLog.tsx`), los abismos ni la pedían. **Escalaciones era
//     la única pantalla que te la pedía y se la quedaba**: un campo de solo escritura.
//   · La cronología de la venta (`cobrada_at`, `entregada_at`, `acceso_retirado_at`): nada.
//   · La cadena (`cadena_id`): una expedición de cuatro partes no decía que lo fuera.
//   · `entry_cost`, y el resultado de CADA piloto (`outcome`, `lost_value`): la tabla pone
//     retratos, no quién murió ni lo que le costó.
//
// ⚠️ ESTE ENCABEZADO DECÍA HASTA HOY QUE «EL BOTÍN DETALLADO NO ESTÁ GUARDADO» y que aquí no habría
//    lista de objetos «ni la habrá». **Dejó de ser cierto el mismo día que se escribió**: unas horas
//    después nació `run_loot` y esta ficha ya pide el desglose. Se deja dicho en vez de borrarlo
//    porque es el ejemplo de manual del aviso del checklist de release —*«una viñeta escrita a
//    mediodía puede ser falsa por la tarde»*—, aplicado a un comentario de código en vez de a una
//    nota de release. Lo que sigue siendo verdad: **las runs anteriores al 2026-09-16 solo tienen el
//    total**, y la ficha lo dice con esas palabras en vez de dejar un hueco que parezca un fallo.
//
// Las piezas que esta ficha comparte con la de abismos y CRAB viven en `fichaRun.tsx`: el desglose
// del botín, quién fue y el bloque de borrar. Aquí queda SOLO lo que es propio de una escalación
// —el sitio, la cadena, la venta y su cronología—, que es justamente lo que no tiene sentido
// enseñar en un abismo.
//
// Se monta por PORTAL en <body> por el mismo motivo que los demás modales: las secciones van
// dentro de `.panel-art-wrap`, que con `isolation: isolate` dejaría la ventana presa.
import { createPortal } from "react-dom";
import { tr } from "./i18n";
import { fmtIsk } from "./format";
import { BloqueBorrar, ComoFue, Dato, QuienFue, fechaCorta, type RunDet } from "./fichaRun";
// Hoy, sin `onFicha`, esto pinta texto plano — igual que en las otras dos veces que se usa para un
// comprador. Va puesto de todas formas: el día que se cablee la ficha del piloto, dejar aquí el
// nombre a pelo sería el caso clásico de arreglarlo en un sitio y no en su hermano.
import { PilotoNombre } from "./fichaPiloto";

export type { RunDet };

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

const facLogo = (id: number) => `https://images.evetech.net/corporations/${id}/logo?size=32`;

export function EscalacionDetalle({
  esc,
  runId,
  partesEnCadena,
  run,
  charName,
  shipName,
  onBorrar,
  onClose,
}: {
  esc: EscDet;
  /** El id de la run enlazada. Va aparte de `run` porque el desglose del botín se pide por id y
   *  `run` puede no haber llegado todavía al mapa del histórico. */
  runId: number | null;
  /** ★ Cuántas escalaciones comparten su `cadena_id`, contando ésta.
   *
   *  🚨 NO se puede deducir de `cadena_id`: sin `cadena_de`, `escalacion_abrir` hace
   *  `SET cadena_id = id`, o sea que **una escalación suelta se apunta a sí misma** y `cadena_id`
   *  nunca es null. La primera versión de esta ficha enseñaba «Cadena: parte 1» en TODAS por eso.
   *  Con 1 aquí no es una cadena y la fila no se pinta; con más, dice «parte 2 de 3». */
  partesEnCadena: number;
  run: RunDet | undefined;
  charName: (id: number) => string;
  shipName: (id: number) => string;
  /** Borrar esta escalación. La ficha solo PIDE la confirmación; el borrado lo hace quien la
   *  monta, que es quien sabe recargar las listas después. */
  onBorrar: () => void;
  onClose: () => void;
}) {
  const vendida = esc.modo === "venta";

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
              nuevas al completarse la anterior. Que una escalación sea la parte 3 de algo explica
              su reloj, y no se veía en ningún sitio.
              La condición es el NÚMERO DE HERMANAS, no `cadena_id != null` — ver `partesEnCadena`:
              con `cadena_id` apuntándose a sí misma, esa comprobación era siempre cierta. */}
          {/* ⚠️ `parte > partesEnCadena` NO es imposible: si se borra una parte anterior, quedan
              una «parte 3» y una «parte 2» de una cadena de dos, y decir «parte 3 de 2» sería una
              cifra falsa. Lo cazó la prueba en SQLite, no el razonamiento. Cuando no cuadra se
              enseña solo el número de parte, que es el dato que sigue siendo cierto. */}
          <Dato
            k={tr("Cadena")}
            v={
              partesEnCadena <= 1
                ? null
                : esc.parte > partesEnCadena
                  ? `${tr("parte")} ${esc.parte}`
                  : `${tr("parte")} ${esc.parte} ${tr("de")} ${partesEnCadena}`
            }
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
            <ComoFue run={run} runId={runId} />
          )}
        </div>

        <QuienFue
          parts={parts}
          duenoId={esc.character_id}
          marcaDueno={tr("suya")}
          charName={charName}
          shipName={shipName}
        />

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
          <Dato k={tr("Apuntada")} v={fechaCorta(esc.abierta_at)} />
          <Dato k={tr("Caducaba")} v={fechaCorta(esc.caduca_at)} />
          {vendida && <Dato k={tr("Cobrada")} v={fechaCorta(esc.cobrada_at)} />}
          {vendida && <Dato k={tr("Acceso dado")} v={fechaCorta(esc.entregada_at)} />}
          {/* ★ El que de verdad importa de la modalidad de venta: mientras no se retire el acceso,
              el comprador sigue dentro de tu safe y la ranura sigue ocupada. */}
          {vendida && <Dato k={tr("Acceso retirado")} v={fechaCorta(esc.acceso_retirado_at)} />}
          <Dato k={tr("Cerrada")} v={fechaCorta(esc.cerrada_at)} />
        </div>

        {esc.nota ? (
          <div className="esc-det-nota">
            <span className="esc-det-k">{tr("Nota")}</span>
            <div>{esc.nota}</div>
          </div>
        ) : null}

        <BloqueBorrar
          etiqueta={tr("Borrar esta escalación")}
          aviso={
            run
              ? tr("Se borra la escalación y su run, con el botín que tuviera anotado.")
              : tr("Se borra la escalación.")
          }
          onBorrar={onBorrar}
        />
      </div>
    </div>,
    document.body,
  );
}
