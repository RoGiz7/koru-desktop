// EL MOTOR HUMANO (N1) — notas ancladas a algo del juego.
// Ver documentacion/SPEC_MOTOR_HUMANO.md.
//
// Todo lo demás que guarda Koru lo genera el juego. Esto lo escribe el jugador, y es lo único que
// ESI no puede contradecir. De ahí una diferencia práctica con el resto de la app: no puede vivir
// meses sin pantalla, porque una nota que no se puede escribir no existe.
//
// ★ DOS PIEZAS, y la separación es idea de RoGiz7 (2026-08-11): un CHIP diminuto donde estés
//   mirando («📌 2») y todo el detalle en un MODAL. La primera versión metía el formulario entero
//   dentro de la ficha del sistema y empujaba «Ruta desde» y «Evitar» hacia abajo; con tres notas
//   habría sido inusable. Y el modal no es solo comodidad: es donde caben las anclas múltiples y
//   los disparadores de N2, que en 280 píxeles no habrían cabido nunca.
//
// El componente es SELF-CONTAINED a propósito (patrón de lealtad.tsx/freelance.tsx): recibe a qué
// está pegado y se ocupa él de todo. Así se puede clavar en la ficha de un sistema, en la de un
// tipo o en la de una estación sin que ninguna de esas vistas tenga que saber nada del modelo.
import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { typeIcon } from "./format";
import type { Note, Character } from "./types";

/** Iconografía EVE primero (regla de RoGiz7, 2026-07-29): antes de poner un emoji, buscar qué ítem
 *  de EVE representa la cosa. `3814` = «informes», un trade good viejo y genérico cuyo icono es un
 *  documento. Cambiar aquí y cambia en todas partes; el emoji queda de reserva si el Image Server
 *  no responde, que es lo que ya se hace en el resto de la app. */
const NOTA_TID = 3814;

/** El icono de las notas, con el emoji como red. */
function NotaGlifo({ size = 14 }: { size?: number }) {
  const [roto, setRoto] = useState(false);
  if (roto) return <span>📌</span>;
  return (
    <img
      className="nota-ico"
      src={typeIcon(NOTA_TID, 32)}
      width={size}
      height={size}
      alt=""
      loading="lazy"
      onError={() => setRoto(true)}
    />
  );
}

type Props = {
  /** `system` | `type` | `location` | `character` */
  kind: string;
  anchorId: number;
  /** 0 = Global. Las notas nuevas se crean con este sujeto. */
  subject: number;
  /** Nombre de la cosa a la que están pegadas (para el título del modal). */
  anchorName?: string;
};

export function NotasAncla({ kind, anchorId, subject, anchorName }: Props) {
  const [notas, setNotas] = useState<Note[] | null>(null);
  const [abierto, setAbierto] = useState(false);

  const cargar = useCallback(() => {
    invoke<Note[]>("get_notes_for", { kind, anchorId, subjectId: subject })
      .then(setNotas)
      // El catch AVISA: un `.catch(() => {})` sobre un invoke convierte un error de firma en un
      // no-op mudo, y ya nos costó una hora con el clic del overlay.
      .catch((e) => {
        console.error("get_notes_for", e);
        setNotas([]);
      });
  }, [kind, anchorId, subject]);

  useEffect(() => {
    setNotas(null);
    setAbierto(false);
    cargar();
  }, [cargar]);

  const n = notas?.length ?? 0;

  return (
    <>
      <button
        className={`nota-chip${n > 0 ? " hay" : ""}`}
        onClick={() => setAbierto(true)}
        title={tr("Tus notas aquí")}
      >
        <NotaGlifo />
        {tr("Notas")}
        {n > 0 && <span className="nota-cuenta">{n}</span>}
      </button>
      {abierto && (
        <NotasModal
          kind={kind}
          anchorId={anchorId}
          subject={subject}
          anchorName={anchorName}
          onClose={() => {
            setAbierto(false);
            cargar(); // el contador refleja lo que se haya hecho dentro
          }}
        />
      )}
    </>
  );
}

/** El detalle. Se monta por PORTAL en <body>: dentro de la ficha del mapa quedaría preso del
 *  contexto de apilamiento del panel. Mismo patrón que LootPasteModal y medalDetail. */
function NotasModal({
  kind,
  anchorId,
  subject,
  anchorName,
  onClose,
}: Props & { onClose: () => void }) {
  const [notas, setNotas] = useState<Note[] | null>(null);
  const [texto, setTexto] = useState("");
  const [pjs, setPjs] = useState<Character[]>([]);
  const [verHechas, setVerHechas] = useState(false);

  const cargar = useCallback(() => {
    invoke<Note[]>("get_notes_for", { kind, anchorId, subjectId: subject })
      .then(setNotas)
      .catch((e) => {
        console.error("get_notes_for", e);
        setNotas([]);
      });
  }, [kind, anchorId, subject]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    let vivo = true;
    invoke<Character[]>("list_characters")
      .then((l) => vivo && setPjs(l))
      .catch((e) => console.error("list_characters", e));
    return () => {
      vivo = false;
    };
  }, []);

  // Escape cierra, como los demás modales de la app.
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  async function crear() {
    const body = texto.trim();
    if (!body) return;
    try {
      await invoke("create_note", {
        subjectId: subject,
        body,
        pinned: false,
        anchors: [{ kind, id: anchorId }],
      });
      setTexto("");
      cargar();
    } catch (e) {
      console.error("create_note", e);
    }
  }

  async function accion(fn: () => Promise<unknown>, nombre: string) {
    try {
      await fn();
      cargar();
    } catch (e) {
      console.error(nombre, e);
    }
  }

  const hay = (notas?.length ?? 0) > 0;

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="nota-modal" onClick={(e) => e.stopPropagation()}>
        <div className="loot-modal-head">
          <strong className="nota-titulo">
            <NotaGlifo size={18} />
            {tr("Notas")}
            {anchorName ? ` · ${anchorName}` : ""}
          </strong>
          <button className="loot-modal-x" onClick={onClose} title={tr("Cerrar")}>
            ✕
          </button>
        </div>

        <div className="nota-form">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={tr("Lo que quieras recordar de este sitio…")}
            rows={3}
            autoFocus
            onKeyDown={(e) => {
              // Ctrl+Enter guarda; Enter solo salta de línea (una nota puede tener varias).
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void crear();
            }}
          />
          <button className="nota-save" onClick={() => void crear()} disabled={!texto.trim()}>
            {tr("Guardar")}
          </button>
        </div>

        {notas === null ? (
          <div className="muted small">…</div>
        ) : hay ? (
          <div className="nota-list">
            {notas.map((n) => (
              <div key={n.id} className={`nota-row${n.pinned ? " pin" : ""}`}>
                <div className="nota-main">
                  <span className="nota-body">{n.body}</span>
                  <div className="nota-meta">
                    {/* A QUIÉN LE TOCA. Con varios personajes, «que Vera compre los cristales» es
                        una tarea distinta de «comprar cristales» — y cuando la nota tenga
                        disparador (N2), esto decide de quién se espera. */}
                    <select
                      className="nota-quien"
                      value={n.subject_id}
                      onChange={(e) =>
                        void accion(
                          () =>
                            invoke("set_note_subject", {
                              id: n.id,
                              subjectId: Number(e.target.value),
                            }),
                          "set_note_subject",
                        )
                      }
                      title={tr("¿A quién le toca?")}
                    >
                      <option value={0}>{tr("Cualquiera")}</option>
                      {pjs.map((p) => (
                        <option key={p.character_id} value={p.character_id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <span className="muted small">{n.created_at.slice(0, 10)}</span>
                  </div>
                </div>
                <button
                  className="nota-btn"
                  onClick={() =>
                    void accion(
                      () => invoke("set_note_done", { id: n.id, done: true }),
                      "set_note_done",
                    )
                  }
                  title={tr("Marcar como hecha")}
                >
                  ✓
                </button>
                <button
                  className="nota-btn del"
                  onClick={() =>
                    void accion(() => invoke("delete_note", { id: n.id }), "delete_note")
                  }
                  title={tr("Borrar")}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted small nota-vacio">{tr("Sin notas")}</div>
        )}

        {/* Las cerradas no se borran: lo que te propusiste vale como histórico. */}
        <button className="nota-hechas" onClick={() => setVerHechas((v) => !v)}>
          {verHechas ? "▾" : "▸"} {tr("Hechas")}
        </button>
        {verHechas && <NotasHechas kind={kind} anchorId={anchorId} subject={subject} />}
      </div>
    </div>,
    document.body,
  );
}

/** Las notas ya cerradas de esta ancla. Se piden aparte y solo al desplegarlas: son las que menos
 *  se miran, y no tiene sentido pagarlas en cada apertura del modal. */
function NotasHechas({ kind, anchorId, subject }: Props) {
  const [rows, setRows] = useState<Note[] | null>(null);

  useEffect(() => {
    invoke<Note[]>("get_notes", { subjectId: subject, includeDone: true })
      .then((all) =>
        setRows(
          all.filter(
            (n) => n.done_at && n.anchors.some((a) => a.kind === kind && a.id === anchorId),
          ),
        ),
      )
      .catch((e) => {
        console.error("get_notes", e);
        setRows([]);
      });
  }, [kind, anchorId, subject]);

  if (rows === null) return <div className="muted small">…</div>;
  if (rows.length === 0) return <div className="muted small nota-vacio">{tr("Sin notas")}</div>;
  return (
    <div className="nota-list hechas">
      {rows.map((n) => (
        <div key={n.id} className="nota-row hecha">
          <span className="nota-body">{n.body}</span>
          <span className="muted small">{n.done_at!.slice(0, 10)}</span>
        </div>
      ))}
    </div>
  );
}
