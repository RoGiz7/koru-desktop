// Modal flotante para meter el BOTÍN al marcar sitios como hechos. Pegas el loot del carguero o de la
// estación (EVE lo copia con su columna de precio estimado → sumamos ese valor, exacto y como lo ves
// en el juego), o tecleas el ISK a mano. Si cierras VARIOS sitios a la vez, el total se reparte a
// partes iguales entre ellos (aproximado a propósito: cuando acumulas loot de varias anomalías no se
// puede saber exacto, pero el conjunto es fiel). Ver `lootPaste.ts` (parser, validado con pegados
// reales) y el diseño en documentacion/koru-desktop-EXPLORACION_HISTORICO_diseno.md.
import { useEffect, useMemo, useState } from "react";
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
    const unpriced = parse.items.filter((i) => i.iskFromPaste == null && i.typeId != null);
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
  }, [parse]);

  if (!open) return null;

  const computed = (parse?.totalFromPaste ?? 0) + fallbackIsk;
  const manual = parseIskShorthand(override);
  const total = override.trim() ? manual : computed > 0 ? computed : null;
  const perSite = total != null && siteCount > 1 ? total / siteCount : total;
  const unresolved = parse ? parse.items.filter((i) => i.iskFromPaste == null && i.typeId == null).length : 0;

  return (
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
                      {it.iskFromPaste != null ? fmtIsk(it.iskFromPaste) : <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
    </div>
  );
}
