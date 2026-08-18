// Modal flotante para meter el BOTÍN al marcar sitios como hechos. Pegas el loot del carguero o de la
// estación (EVE lo copia con su columna de precio estimado → sumamos ese valor, exacto y como lo ves
// en el juego), o tecleas el ISK a mano. Si cierras VARIOS sitios a la vez, el total se reparte a
// partes iguales entre ellos (aproximado a propósito: cuando acumulas loot de varias anomalías no se
// puede saber exacto, pero el conjunto es fiel). Ver `lootPaste.ts` (parser, validado con pegados
// reales) y el diseño en documentacion/koru-desktop-EXPLORACION_HISTORICO_diseno.md.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { fmtIsk } from "./format";
import { parseLootPaste, parseIskShorthand, type LootIndex } from "./lootPaste";

type Props = {
  open: boolean;
  /** Cuántos sitios se van a cerrar con este loot (para el reparto). */
  siteCount: number;
  index: LootIndex;
  /** Devuelve el ISK total (o null si no se metió botín) y una nota corta del loot. */
  onConfirm: (totalIsk: number | null, note: string) => void;
  onCancel: () => void;
  busy?: boolean;
  /** Título de la cabecera. Si se omite, «Botín de N sitio(s)» (contexto exploración). */
  title?: string;
  /** Texto del botón de confirmar. Si se omite, «Marcar hechas (N)» (contexto exploración). */
  confirmLabel?: string;
};

export function LootPasteModal({ open, siteCount, index, onConfirm, onCancel, busy, title, confirmLabel }: Props) {
  const [text, setText] = useState("");
  const [override, setOverride] = useState(""); // ISK a mano (prevalece sobre el pegado)
  const [note, setNote] = useState("");
  const [fallbackIsk, setFallbackIsk] = useState(0); // valor de items sin precio en el pegado

  const parse = useMemo(() => (text.trim() ? parseLootPaste(text, index) : null), [text, index]);

  /** ---- LOS BLUEPRINTS DEL BOTÍN NO SE VALORAN (2026-08-13) ----
   *
   *  Lo avisó un jugador viendo cifras raras en abisales. El motivo es de EVE, no de Koru: **un BPC
   *  y su BPO comparten typeID**, y **un BPC no se puede vender en el mercado** — solo por contrato.
   *  Así que cualquier precio de mercado aplicado a una copia es el precio de OTRA cosa.
   *
   *  En el botín no hay forma de saber si es copia u original: el texto que copia el juego no lo
   *  dice. Pero lo que cae en abisales y exploración son **copias, siempre**, así que la regla
   *  correcta aquí es no valorarlos. Se listan aparte para que se vean y puedas ponerles tú el ISK
   *  que valgan por contrato — que es donde de verdad tienen precio.
   *
   *  El conjunto sale de `bp_tree.json`, que ya se sirve para el planificador de industria: son
   *  typeIDs, así que funciona con el juego en cualquier idioma. */
  const [bpSet, setBpSet] = useState<Set<number> | null>(null);
  useEffect(() => {
    if (!open || bpSet) return;
    fetch("/bp_tree.json")
      .then((r) => r.json())
      .then((d: { bp?: Record<string, unknown> }) =>
        setBpSet(new Set(Object.keys(d.bp ?? {}).map(Number))),
      )
      .catch(() => setBpSet(new Set()));
  }, [open, bpSet]);

  const esBlueprint = (tid: number | null) => tid != null && (bpSet?.has(tid) ?? false);
  const blueprints = parse ? parse.items.filter((i) => esBlueprint(i.typeId)) : [];
  /** Lo que el PEGADO les puso y hay que descontar del total: el juego sí les pone precio. */
  const bpIskDelPegado = blueprints.reduce((a, i) => a + (i.iskFromPaste ?? 0), 0);

  // Al limpiar el modal cada vez que se abre.
  useEffect(() => {
    if (open) {
      setText("");
      setOverride("");
      setNote("");
      setFallbackIsk(0);
    }
  }, [open]);

  // Red: los items que el pegado NO trajo con precio, pero que reconocimos (typeId), se valoran con
  // los precios locales (los mismos que el resto de assets). El camino normal es la columna de EVE.
  useEffect(() => {
    if (!parse) {
      setFallbackIsk(0);
      return;
    }
    const unpriced = parse.items.filter(
      (i) => i.iskFromPaste == null && i.typeId != null && !esBlueprint(i.typeId),
    );
    if (unpriced.length === 0) {
      setFallbackIsk(0);
      return;
    }
    const ids = [...new Set(unpriced.map((i) => i.typeId as number))];
    invoke<Record<number, number>>("get_type_prices", { ids })
      .then((prices) => {
        let f = 0;
        for (const it of unpriced) {
          const p = prices[it.typeId as number];
          if (p) f += p * it.qty;
        }
        setFallbackIsk(f);
      })
      .catch(() => setFallbackIsk(0));
    // `bpSet` entra en las dependencias: hasta que carga no se sabe qué es blueprint, y sin esto
    // el primer cálculo se haría con la lista vacía y los contaría.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parse, bpSet]);

  if (!open) return null;

  const computed = (parse?.totalFromPaste ?? 0) - bpIskDelPegado + fallbackIsk;
  const manual = parseIskShorthand(override);
  const total = override.trim() ? manual : computed > 0 ? computed : null;
  const perSite = total != null && siteCount > 1 ? total / siteCount : total;
  const unresolved = parse ? parse.items.filter((i) => i.iskFromPaste == null && i.typeId == null).length : 0;

  // Portal al body por el mismo motivo que la ficha de medalla: las secciones van dentro de
  // `.panel-art-wrap`, que con `isolation: isolate` crea un contexto de apilamiento y deja al
  // modal preso —los controles del mapa se le pintaban encima—. Ver medalDetail.tsx.
  return createPortal(
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal loot-modal" onClick={(e) => e.stopPropagation()}>
        <div className="loot-modal-head">
          <strong>
            💰 {title ?? `${tr("Botín de")} ${siteCount} ${siteCount === 1 ? tr("sitio") : tr("sitios")}`}
          </strong>
          <button className="loot-modal-x" onClick={onCancel} title={tr("Cerrar")}>
            ✕
          </button>
        </div>

        <div className="small muted">
          {tr(
            "Pega el loot del carguero o de la estación (Ctrl+A, Ctrl+C en el inventario). Si tienes la columna «Precio estimado» activa, se suma sola. También puedes teclear el ISK a mano abajo.",
          )}
        </div>

        <textarea
          className="loot-modal-paste"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder={tr("Pega aquí el loot…")}
          autoFocus
        />

        {parse && (
          <div className="loot-modal-items">
            <table className="small sig-table">
              <thead>
                <tr className="sig-th">
                  <th>{tr("Item")}</th>
                  <th style={{ textAlign: "right" }}>{tr("Cant.")}</th>
                  <th style={{ textAlign: "right" }}>{tr("Valor")}</th>
                </tr>
              </thead>
              <tbody>
                {parse.items.map((it, i) => (
                  <tr key={i}>
                    <td>
                      {it.name}
                      {it.typeId == null && it.iskFromPaste == null && (
                        <span className="muted" title={tr("No reconocido; no cuenta al total")}>
                          {" "}
                          ⚠
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }} className="muted">
                      {it.qty}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {/* Un blueprint se enseña TACHADO con su precio, no sin él: así se ve que
                          Koru lo ha reconocido y ha decidido no contarlo. Un guion a secas
                          parecería que no supo leerlo. */}
                      {esBlueprint(it.typeId) ? (
                        <span className="loot-bp" title={tr("Los blueprints no se venden en el mercado: no cuentan al total. Añade su valor a mano si lo vendes por contrato.")}>
                          {it.iskFromPaste != null ? fmtIsk(it.iskFromPaste) : "—"}
                        </span>
                      ) : it.iskFromPaste != null ? (
                        fmtIsk(it.iskFromPaste)
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {blueprints.length > 0 && (
              <div className="muted small loot-bp-nota">
                {blueprints.length}{" "}
                {blueprints.length === 1 ? tr("blueprint no contado") : tr("blueprints no contados")}
                {bpIskDelPegado > 0 && <> · {tr("el juego les ponía")} {fmtIsk(bpIskDelPegado)}</>}
                {". "}
                {tr("No se venden en el mercado, solo por contrato: pon su valor a mano si lo sabes.")}
              </div>
            )}
            <div className="small muted" style={{ marginTop: 4 }}>
              {parse.items.length} {tr("items")} · {parse.pricedLines} {tr("con precio de EVE")}
              {unresolved > 0 ? ` · ${unresolved} ${tr("sin reconocer")}` : ""}
            </div>
          </div>
        )}

        <div className="loot-modal-row">
          <span className="small muted">{tr("ISK a mano")}:</span>
          <input
            className="small"
            value={override}
            onChange={(e) => setOverride(e.target.value)}
            placeholder={computed > 0 ? fmtIsk(computed) : tr("p.ej. 45m")}
            style={{ width: 130 }}
          />
          <input
            className="small"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={tr("nota del botín (opcional)")}
            style={{ flex: 1, minWidth: 120 }}
          />
        </div>

        <div className="loot-modal-total">
          <span>
            {tr("Total")}: <strong>{total != null ? `${fmtIsk(total)} ISK` : "—"}</strong>
          </span>
          {total != null && siteCount > 1 && (
            <span className="muted small">
              {" · "}
              {tr("reparto")}: {siteCount} × {fmtIsk(perSite as number)}
            </span>
          )}
        </div>

        <div className="loot-modal-actions">
          <button className="pp-add" onClick={() => onConfirm(total, note.trim())} disabled={busy}>
            ✓ {confirmLabel ?? `${tr("Marcar hechas")} (${siteCount})`}
          </button>
          <button className="pp-add" onClick={onCancel} disabled={busy}>
            {tr("Cancelar")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
