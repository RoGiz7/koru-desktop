// NOTAS Y TAREAS — todas tus notas en un sitio.
//
// ★ POR QUÉ EXISTE (RoGiz7, 2026-08-31, al arreglar el modal). El motor de notas era potente y
//   estaba REPARTIDO: solo se llegaba a una nota desde su ancla —la ficha de un sistema en el mapa
//   o una ubicación en el inventario—. Si apuntabas algo en un sistema y no volvías a ese sistema,
//   esa nota no la veías nunca más. Para «anotar cosas y tareas», eso es medio motor.
//
// ★ Y HABÍA UN AGUJERO PEOR: el modelo permite notas SIN ancla —la lista de la compra— pero no
//   había forma de crear ninguna, porque a las notas solo se llegaba desde un ancla. Aquí sí.
//
// ★ LO QUE NO HACE, a propósito: no duplica el detalle del modal (anclar pilotos, elegir el tipo
//   que esperas). Eso vive donde está el contexto. Aquí se ve TODO lo pendiente, se cierra, se
//   edita el texto y se dice a quién le toca — que es lo que se hace con una lista de tareas.
import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { typeIcon } from "./format";
import { loadNewEden } from "./neweden";
import type { Note, Character } from "./types";

/** Iconografía EVE (regla de la casa), typeIDs verificados contra public/market_types.json:
 *  439 afterburner = moverse/llegar · 17366 Station Container = un hangar · 3355 Social = una
 *  persona · 2454 = un tipo de objeto cualquiera no aplica, así que el ancla `type` usa el icono
 *  del PROPIO objeto, que es más informativo que cualquier símbolo. */
const TID_LLEGAR = 439;
const TID_HANGAR = 17366;
const TID_PILOTO = 3355;

function Icono({ tid, size = 14 }: { tid: number; size?: number }) {
  return <img src={typeIcon(tid, 32) ?? undefined} width={size} height={size} alt="" loading="lazy" />;
}

export function NotasVista({ subject }: { subject: number | "global" }) {
  const subjectId = typeof subject === "number" ? subject : 0;
  const [notas, setNotas] = useState<Note[] | null>(null);
  const [pjs, setPjs] = useState<Character[]>([]);
  const [sys, setSys] = useState<Map<number, string>>(new Map());
  const [verHechas, setVerHechas] = useState(false);
  const [texto, setTexto] = useState("");
  const [editando, setEditando] = useState<number | null>(null);
  const [borrador, setBorrador] = useState("");

  const cargar = useCallback(() => {
    invoke<Note[]>("get_notes", { subjectId, includeDone: true })
      .then(setNotas)
      .catch((e) => {
        console.error("get_notes", e);
        setNotas([]);
      });
  }, [subjectId]);

  useEffect(cargar, [cargar]);

  useEffect(() => {
    invoke<Character[]>("list_characters").then(setPjs).catch(() => {});
    loadNewEden()
      .then((ne) => setSys(new Map(ne.systems.map((s) => [s.id, s.n]))))
      .catch(() => {});
  }, []);

  async function accion(fn: () => Promise<unknown>, nombre: string) {
    try {
      await fn();
      cargar();
    } catch (e) {
      console.error(nombre, e);
    }
  }

  /** Una nota SIN ancla: la lista de la compra. Es el caso que el modelo permitía y la interfaz
   *  hacía imposible, porque a las notas solo se llegaba desde un sistema o un hangar. */
  async function crear() {
    const body = texto.trim();
    if (!body) return;
    await accion(
      () => invoke("create_note", { subjectId, body, pinned: false, anchors: [] }),
      "create_note",
    );
    setTexto("");
  }

  const abiertas = useMemo(() => (notas ?? []).filter((n) => !n.done_at), [notas]);
  const hechas = useMemo(() => (notas ?? []).filter((n) => n.done_at), [notas]);
  /** Con disparador arriba: son las que van a hablarte solas, y por tanto las que más valen. */
  const orden = useMemo(
    () => [...abiertas].sort((a, b) => Number(!!b.trigger_kind) - Number(!!a.trigger_kind)),
    [abiertas],
  );

  const nombrePj = (id: number) => pjs.find((p) => p.character_id === id)?.name ?? `#${id}`;

  function Fila({ n }: { n: Note }) {
    const hecha = !!n.done_at;
    return (
      <div className={`nv-fila${hecha ? " hecha" : ""}${n.pinned ? " pin" : ""}`}>
        <div className="nv-cuerpo">
          {editando === n.id ? (
            <div className="nota-form">
              <textarea
                value={borrador}
                onChange={(e) => setBorrador(e.target.value)}
                rows={2}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Escape") setEditando(null);
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    void accion(
                      () =>
                        invoke("update_note", {
                          id: n.id,
                          body: borrador.trim() || n.body,
                          pinned: n.pinned,
                          anchors: [],
                          // ⚠️ Nunca borrar anclas al corregir una errata: `update_note` REEMPLAZA
                          // la lista, y una falta de ortografía no puede desanclar la nota.
                          clearAnchors: false,
                        }),
                      "update_note",
                    ).then(() => setEditando(null));
                  }
                }}
              />
              <div className="nota-meta">
                <button
                  className="nota-save"
                  onClick={() =>
                    void accion(
                      () =>
                        invoke("update_note", {
                          id: n.id,
                          body: borrador.trim() || n.body,
                          pinned: n.pinned,
                          anchors: [],
                          clearAnchors: false,
                        }),
                      "update_note",
                    ).then(() => setEditando(null))
                  }
                >
                  {tr("Guardar")}
                </button>
                <button className="nota-hechas" onClick={() => setEditando(null)}>
                  {tr("Cancelar")}
                </button>
              </div>
            </div>
          ) : (
            <span
              className="nota-body editable"
              title={tr("Pulsa para editar")}
              onClick={() => {
                setEditando(n.id);
                setBorrador(n.body);
              }}
            >
              {n.body}
            </span>
          )}

          <div className="nv-tags">
            {/* DE DÓNDE VIENE. Sin esto, una lista de frases sueltas no dice a qué se refiere
                cada una — y el ancla es justo lo que distingue esta libreta de un bloc de notas. */}
            {n.anchors.map((a) => {
              if (a.kind === "system")
                return (
                  <span key={`s${a.id}`} className="nv-tag" title={tr("Sistema")}>
                    <Icono tid={TID_LLEGAR} /> {sys.get(a.id) ?? `#${a.id}`}
                  </span>
                );
              if (a.kind === "location")
                return (
                  <span key={`l${a.id}`} className="nv-tag" title={tr("Hangar o estructura")}>
                    <Icono tid={TID_HANGAR} /> {tr("hangar")}
                  </span>
                );
              if (a.kind === "character")
                return (
                  <span key={`c${a.id}`} className="nv-tag" title={tr("Piloto")}>
                    <img
                      src={`https://images.evetech.net/characters/${a.id}/portrait?size=32`}
                      width={14}
                      height={14}
                      alt=""
                      loading="lazy"
                    />
                    <Icono tid={TID_PILOTO} />
                  </span>
                );
              return (
                <span key={`t${a.id}`} className="nv-tag" title={tr("Objeto")}>
                  <Icono tid={a.id} />
                </span>
              );
            })}
            {/* EL DISPARADOR: lo que hace que esta nota te hable sola. */}
            {n.trigger_kind === "arrive" && (
              <span className="nv-tag disp" title={tr("Te avisa al llegar")}>
                <Icono tid={TID_LLEGAR} /> {sys.get(n.trigger_id) ?? `#${n.trigger_id}`}
                {n.trigger_once ? "" : ` · ${tr("cada visita")}`}
              </span>
            )}
            {n.trigger_kind === "asset" && (
              <span className="nv-tag disp" title={tr("Te avisa cuando llegue")}>
                <Icono tid={n.trigger_id} /> {tr("al llegar")}
              </span>
            )}
            {n.subject_id !== 0 && (
              <span className="nv-tag" title={tr("¿A quién le toca?")}>
                {nombrePj(n.subject_id)}
              </span>
            )}
            <span className="muted small">{(n.done_at ?? n.created_at).slice(0, 10)}</span>
          </div>
        </div>

        {!hecha && (
          <button
            className="nota-btn"
            title={tr("Marcar como hecha")}
            onClick={() =>
              void accion(() => invoke("set_note_done", { id: n.id, done: true }), "set_note_done")
            }
          >
            ✓
          </button>
        )}
        {hecha && (
          <button
            className="nota-btn"
            title={tr("Reabrir")}
            onClick={() =>
              void accion(() => invoke("set_note_done", { id: n.id, done: false }), "set_note_done")
            }
          >
            ↺
          </button>
        )}
        <button
          className="nota-btn del"
          title={tr("Borrar")}
          onClick={() => void accion(() => invoke("delete_note", { id: n.id }), "delete_note")}
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <>
      <p className="muted small">
        {tr(
          "Todo lo que has apuntado, venga de donde venga. Las que te avisan solas van primero. Para anclar una nota a un sistema, a un hangar o a un piloto, se hace desde su propia ficha.",
        )}
      </p>

      <div className="nota-form nv-nueva">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={2}
          placeholder={tr("Apunta algo — sin atarlo a ningún sitio")}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void crear();
          }}
        />
        <button className="nota-save" onClick={() => void crear()} disabled={!texto.trim()}>
          {tr("Guardar")}
        </button>
      </div>

      {notas === null && <p className="muted small">{tr("Cargando…")}</p>}

      {notas !== null && orden.length === 0 && (
        <p className="muted small">{tr("No tienes nada pendiente.")}</p>
      )}

      {orden.length > 0 && (
        <div className="nv-lista">
          {orden.map((n) => (
            <Fila key={n.id} n={n} />
          ))}
        </div>
      )}

      {hechas.length > 0 && (
        <>
          <button className="nota-hechas" onClick={() => setVerHechas((v) => !v)}>
            {verHechas ? "▾" : "▸"} {tr("Hechas")} ({hechas.length})
          </button>
          {verHechas && (
            <div className="nv-lista hechas">
              {hechas.map((n) => (
                <Fila key={n.id} n={n} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
