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
// ★ LA FILA ES UN RESUMEN; EL DETALLE ESTÁ EN SU VENTANA (pedido suyo el mismo día). Pinchando
//   una nota se abre en grande: texto, a quién le toca, dónde está clavada, sus pilotos, su aviso.
//   Se quitó la edición EN LÍNEA al añadirlo — tener dos formas de editar lo mismo es la vía
//   segura para que una se quede atrás.
//
// ★ Lo que NO se puede hacer desde aquí, y es deliberado: clavar la nota en un sistema o en un
//   hangar. Eso se hace desde la ficha de ese sitio, que es donde tienes el contexto delante.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { typeIcon } from "./format";
import { loadNewEden } from "./neweden";
import { AnclarPiloto, BuscarTipo, NombrePiloto, NombreTipo, TipoIcono } from "./notas";
import { SystemSearch } from "./map";
import type { Note, NoteStep, Character, NeSystem } from "./types";

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


/** ★ N4 — LAS PARTES DE UNA NOTA. «Los siete objetos que me faltan para el proyecto», «los cinco
 *  láseres que presté». Es lo que convierte apuntar algo en planificar algo: el progreso contesta
 *  a «¿ya se cumplió en parte o del todo?».
 *
 *  En esta fase se tachan A MANO. La fase 2 es que las tache Koru con el disparador que ya existe
 *  —cada parte espera un objeto en un sitio— y por eso la tabla guarda `done_by`: dentro de un mes,
 *  saber si aquello llegó de verdad o si alguien lo dio por bueno es la diferencia entre un dato y
 *  una suposición. */
function Partes({ noteId, onCambio }: { noteId: number; onCambio: () => void }) {
  const [pasos, setPasos] = useState<NoteStep[] | null>(null);
  const [texto, setTexto] = useState("");
  /** Modo «elegir objetos»: el caso del comerciante — una nota con los siete objetos que necesita.
   *  El buscador se queda ABIERTO al elegir, porque nadie añade uno solo. */
  const [eligiendo, setEligiendo] = useState(false);
  /** Modo «elegir pilotos»: el caso del minero — una tarea por cada uno al que prestó un láser.
   *  Además de crear la tarea, el piloto se ancla A LA NOTA: así «¿qué le he prestado a este tío?»
   *  sigue teniendo respuesta desde su ficha. */
  const [pilotos, setPilotos] = useState(false);

  const cargar = useCallback(() => {
    invoke<NoteStep[]>("note_steps", { noteId })
      .then(setPasos)
      .catch((e) => {
        console.error("note_steps", e);
        setPasos([]);
      });
  }, [noteId]);
  useEffect(cargar, [cargar]);

  async function accion(fn: () => Promise<unknown>, nombre: string) {
    try {
      await fn();
      cargar();
      onCambio(); // el «3/7» de la lista vive fuera: hay que refrescarlo también
    } catch (e) {
      console.error(nombre, e);
    }
  }

  const hechas = (pasos ?? []).filter((p) => p.done_at).length;
  const total = pasos?.length ?? 0;

  return (
    <div className="nd-partes">
      <div className="nd-linea">
        <span className="muted small">{tr("Tareas")}</span>
        {total > 0 && (
          <span className="nv-tag">
            {hechas}/{total}
          </span>
        )}
        {total > 0 && (
          <span className="nd-barra" title={`${hechas}/${total}`}>
            <span style={{ width: `${(hechas / total) * 100}%` }} />
          </span>
        )}
      </div>

      {(pasos ?? []).map((p) => (
        <div key={p.id} className={`nd-paso${p.done_at ? " hecha" : ""}`}>
          <input
            type="checkbox"
            checked={!!p.done_at}
            onChange={(e) =>
              void accion(
                () =>
                  invoke("set_note_step_done", { id: p.id, done: e.target.checked, by: "mano" }),
                "set_note_step_done",
              )
            }
          />
          {p.trigger_id > 0 && <TipoIcono typeId={p.trigger_id} size={16} />}
          <span className="nd-paso-txt">{p.body}</span>
          {/* CUÁNTAS hacen falta. Solo tiene sentido en una tarea con objeto: en «llamar a X» no
              significa nada. Vacío = con que aparezca una, vale — que es como se comportaba antes
              de existir esta casilla, así que ninguna tarea vieja cambia de conducta. */}
          {p.trigger_id > 0 && !p.done_at && (
            <input
              className="nd-qty"
              type="number"
              min={0}
              placeholder="×1"
              title={tr("Cuántas hacen falta para darla por cumplida")}
              defaultValue={p.qty > 0 ? p.qty : ""}
              onBlur={(e) => {
                const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                if (n === p.qty) return;
                void accion(
                  () => invoke("set_note_step_qty", { id: p.id, qty: n }),
                  "set_note_step_qty",
                );
              }}
            />
          )}
          {/* Tachada: la cantidad se queda escrita. Si desapareciera al cumplirse, el proyecto
              perdería justo el dato de cuánto pedía. */}
          {p.done_at && p.qty > 0 && <span className="nv-tag">×{p.qty}</span>}
          {/* Quién la cerró. Con una parte tachada a mano y otra por un aviso, la diferencia
              importa — y hoy TODAS son a mano, así que solo se dice cuando no lo es. */}
          {p.done_at && p.done_by && p.done_by !== "mano" && (
            <span className="nv-tag disp">{p.done_by}</span>
          )}
          <button
            className="nota-btn del"
            title={tr("Quitar la tarea")}
            onClick={() =>
              void accion(() => invoke("delete_note_step", { id: p.id }), "delete_note_step")
            }
          >
            ✕
          </button>
        </div>
      ))}

      {/* AÑADIR VARIOS OBJETOS DE GOLPE. Cada objeto es una tarea, y se guarda su typeID para que
          se vea con su icono — y para que la fase 2 pueda tacharla sola cuando llegue al hangar.
          ⚠️ Se guarda el typeID SIN `trigger_kind`: mientras no exista quien lo vigile, la tarea
          NO promete nada. La promesa se activa el día que haya código que la cumpla. */}
      {eligiendo ? (
        <div className="nd-paso nueva">
          <BuscarTipo
            onPick={(t) =>
              void accion(
                () => invoke("add_note_step", { noteId, body: t.n, typeId: t.i }),
                "add_note_step",
              )
            }
          />
          <button className="nota-hechas" onClick={() => setEligiendo(false)}>
            {tr("Listo")}
          </button>
        </div>
      ) : (
        <button className="nota-hechas nd-elegir" onClick={() => setEligiendo(true)}>
          + {tr("Añadir objetos")}
        </button>
      )}

      {pilotos ? (
        <div className="nd-paso nueva">
          <AnclarPiloto
            onPick={(id, nombre) =>
              void accion(async () => {
                await invoke("add_note_step", { noteId, body: nombre });
                // El piloto queda anclado a la nota, no solo escrito en la tarea: un nombre en un
                // texto no se puede consultar; un ancla sí.
                await invoke("add_note_anchor", { noteId, kind: "character", anchorId: id });
              }, "add_note_step+anchor")
            }
          />
          <button className="nota-hechas" onClick={() => setPilotos(false)}>
            {tr("Listo")}
          </button>
        </div>
      ) : (
        <button className="nota-hechas nd-elegir" onClick={() => setPilotos(true)}>
          + {tr("Añadir pilotos")}
        </button>
      )}

      <div className="nd-paso nueva">
        <input
          type="text"
          value={texto}
          placeholder={tr("Añadir una tarea…")}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !texto.trim()) return;
            void accion(
              () => invoke("add_note_step", { noteId, body: texto.trim() }),
              "add_note_step",
            ).then(() => setTexto(""));
          }}
        />
        <button
          className="nota-hechas"
          disabled={!texto.trim()}
          onClick={() =>
            void accion(
              () => invoke("add_note_step", { noteId, body: texto.trim() }),
              "add_note_step",
            ).then(() => setTexto(""))
          }
        >
          + {tr("Añadir")}
        </button>
      </div>
    </div>
  );
}

/** LA NOTA ABIERTA EN GRANDE (petición suya, 2026-08-31): «que se pueda desplegar en ventana
 *  emergente, tanto para consultar los detalles como para manipularla».
 *
 *  ★ Y arregla un hueco que la lista destapó: TODO lo que se le puede hacer a una nota —ponerle
 *    disparador, anclarle un piloto— vivía en el modal que cuelga de un ancla. Así que **una nota
 *    sin ancla no tenía forma de recibir nada**: nacía muda y se quedaba muda. Aquí sí.
 *
 *  Las piezas (buscar piloto, buscar tipo, iconos, nombres) se IMPORTAN de notas.tsx en vez de
 *  reescribirse: dos implementaciones de lo mismo divergirían sin que nadie lo viera. */
function NotaDetalle({
  nota,
  pjs,
  sys,
  sysArr,
  onCambio,
  onClose,
}: {
  nota: Note;
  pjs: Character[];
  sys: Map<number, string>;
  sysArr: NeSystem[];
  onCambio: () => void;
  onClose: () => void;
}) {
  const [borrador, setBorrador] = useState(nota.body);
  const [pilotando, setPilotando] = useState(false);
  const [esperando, setEsperando] = useState(false);
  /** Buscador de sistema abierto para CLAVAR la nota. Antes solo se podía anclar desde el mapa;
   *  planificando, lo natural es decir «esto es en X» sin salir de aquí. */
  const [anclando, setAnclando] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  async function accion(fn: () => Promise<unknown>, nombre: string) {
    try {
      await fn();
      onCambio();
    } catch (e) {
      console.error(nombre, e);
    }
  }

  const sistemas = nota.anchors.filter((a) => a.kind === "system");
  // El disparador de llegada cuelga del PRIMER sistema clavado: avisar en varios a la vez
  // sería otro diseño, y hoy `note` solo guarda un `trigger_id`.
  const sistema = sistemas[0];
  const hangar = nota.anchors.find((a) => a.kind === "location");
  const pilotos = nota.anchors.filter((a) => a.kind === "character");
  const objetos = nota.anchors.filter((a) => a.kind === "type");

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="nota-modal" onClick={(e) => e.stopPropagation()}>
        <div className="loot-modal-head">
          <strong className="nota-titulo">
            <TipoIcono typeId={3814} size={18} />
            {tr("Nota")}
          </strong>
          <button className="loot-modal-x" onClick={onClose} title={tr("Cerrar")}>
            ✕
          </button>
        </div>

        <div className="nota-form">
          <textarea
            value={borrador}
            onChange={(e) => setBorrador(e.target.value)}
            rows={4}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
            }}
          />
          <button
            className="nota-save"
            disabled={!borrador.trim() || borrador === nota.body}
            onClick={() =>
              void accion(
                () =>
                  invoke("update_note", {
                    id: nota.id,
                    body: borrador.trim(),
                    pinned: nota.pinned,
                    anchors: [],
                    // Nunca vaciar las anclas al corregir el texto (ver notas.tsx).
                    clearAnchors: false,
                  }),
                "update_note",
              )
            }
          >
            {tr("Guardar")}
          </button>
        </div>

        {/* A QUIÉN LE TOCA. Con varios personajes, «que lo compre Vera» es otra tarea. */}
        <div className="nd-linea">
          <span className="muted small">{tr("¿A quién le toca?")}</span>
          <select
            className="nota-quien"
            value={nota.subject_id}
            onChange={(e) =>
              void accion(
                () => invoke("set_note_subject", { id: nota.id, subjectId: Number(e.target.value) }),
                "set_note_subject",
              )
            }
          >
            <option value={0}>{tr("Cualquiera")}</option>
            {pjs.map((p) => (
              <option key={p.character_id} value={p.character_id}>
                {p.name}
              </option>
            ))}
          </select>
          <label className="nota-avisar">
            <input
              type="checkbox"
              checked={nota.pinned}
              onChange={(e) =>
                void accion(
                  () =>
                    invoke("update_note", {
                      id: nota.id,
                      body: nota.body,
                      pinned: e.target.checked,
                      anchors: [],
                      clearAnchors: false,
                    }),
                  "update_note",
                )
              }
            />
            {tr("Destacada")}
          </label>
        </div>

        {/* DÓNDE ESTÁ CLAVADA. Se enseña aunque no se pueda cambiar desde aquí: un ancla de sistema
            o de hangar se pone desde su propia ficha, que es donde tienes el contexto delante. */}
        <div className="nd-linea">
            <span className="muted small">{tr("Clavada en")}</span>
            {hangar && (
              <span className="nv-tag">
                <TipoIcono typeId={17366} size={14} /> {tr("hangar")}
              </span>
            )}
            {objetos.map((o) => (
              <span key={o.id} className="nv-tag">
                <TipoIcono typeId={o.id} size={14} /> <NombreTipo id={o.id} />
              </span>
            ))}
            {/* Clavar a un sistema DESDE AQUÍ, con el mismo buscador que el mapa. Se puede clavar
                a varios: «esto hay que hacerlo en cualquiera de estos tres». Quitarlo también. */}
            {sistemas.map((a) => (
              <span key={`sq${a.id}`} className="nv-tag">
                <TipoIcono typeId={439} size={14} /> {sys.get(a.id) ?? `#${a.id}`}
                <button
                  className="nota-btn del"
                  title={tr("Desclavar")}
                  onClick={() =>
                    void accion(
                      () =>
                        invoke("remove_note_anchor", {
                          noteId: nota.id,
                          kind: "system",
                          anchorId: a.id,
                        }),
                      "remove_note_anchor",
                    )
                  }
                >
                  ✕
                </button>
              </span>
            ))}
            {anclando ? (
              <SystemSearch
                systems={sysArr}
                value={null}
                placeholder={tr("Buscar sistema…")}
                onPick={(id) =>
                  void accion(async () => {
                    await invoke("add_note_anchor", {
                      noteId: nota.id,
                      kind: "system",
                      anchorId: id,
                    });
                    setAnclando(false);
                  }, "add_note_anchor")
                }
              />
            ) : (
              <button className="nota-hechas" onClick={() => setAnclando(true)}>
                + {tr("Sistema")}
              </button>
            )}
          </div>

        {/* PILOTOS: «esto se lo dejé a fulano». Aquí SÍ se puede añadir y quitar. */}
        <div className="nd-linea">
          <span className="muted small">{tr("Pilotos")}</span>
          {pilotos.map((a) => (
            <span key={a.id} className="nota-piloto">
              <img
                src={`https://images.evetech.net/characters/${a.id}/portrait?size=32`}
                width={18}
                height={18}
                alt=""
                loading="lazy"
              />
              <NombrePiloto id={a.id} />
              <button
                className="nota-btn del"
                title={tr("Quitar")}
                onClick={() =>
                  void accion(
                    () =>
                      invoke("remove_note_anchor", {
                        noteId: nota.id,
                        kind: "character",
                        anchorId: a.id,
                      }),
                    "remove_note_anchor",
                  )
                }
              >
                ✕
              </button>
            </span>
          ))}
          {pilotando ? (
            <AnclarPiloto
              onPick={(id) =>
                void accion(async () => {
                  await invoke("add_note_anchor", {
                    noteId: nota.id,
                    kind: "character",
                    anchorId: id,
                  });
                  setPilotando(false);
                }, "add_note_anchor")
              }
            />
          ) : (
            <button className="nota-hechas" onClick={() => setPilotando(true)}>
              + {tr("Piloto")}
            </button>
          )}
        </div>

        {/* EL DISPARADOR. Lo que se puede ofrecer depende de a qué esté clavada la nota: el
            disparador ES el ancla. Sin ancla no hay nada que disparar, y se dice. */}
        <div className="nd-linea nota-trig">
          <span className="muted small">{tr("Aviso")}</span>
          {sistema && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={nota.trigger_kind === "arrive"}
                  onChange={(e) =>
                    void accion(
                      () =>
                        invoke("set_note_trigger", {
                          id: nota.id,
                          systemId: e.target.checked ? sistema.id : 0,
                          once: nota.trigger_once,
                        }),
                      "set_note_trigger",
                    )
                  }
                />
                {tr("Avisarme al llegar a")} {sys.get(sistema.id) ?? `#${sistema.id}`}
              </label>
              {nota.trigger_kind === "arrive" && (
                <select
                  className="nota-quien"
                  value={nota.trigger_once ? "1" : "0"}
                  onChange={(e) =>
                    void accion(
                      () =>
                        invoke("set_note_trigger", {
                          id: nota.id,
                          systemId: sistema.id,
                          once: e.target.value === "1",
                        }),
                      "set_note_trigger",
                    )
                  }
                >
                  <option value="1">{tr("una vez")}</option>
                  <option value="0">{tr("cada visita")}</option>
                </select>
              )}
            </>
          )}
          {hangar && nota.trigger_kind !== "arrive" && (
            <>
              {nota.trigger_kind === "asset" ? (
                <span className="nv-tag disp">
                  <TipoIcono typeId={nota.trigger_id} size={14} />{" "}
                  <NombreTipo id={nota.trigger_id} />
                  <button
                    className="nota-btn del"
                    title={tr("Quitar el aviso")}
                    onClick={() =>
                      void accion(
                        () =>
                          invoke("set_note_trigger", {
                            id: nota.id,
                            systemId: 0,
                            once: true,
                            kind: "asset",
                          }),
                        "set_note_trigger",
                      )
                    }
                  >
                    ✕
                  </button>
                </span>
              ) : esperando ? (
                <BuscarTipo
                  onPick={(t) =>
                    void accion(async () => {
                      await invoke("set_note_trigger", {
                        id: nota.id,
                        systemId: t.i,
                        once: true,
                        kind: "asset",
                      });
                      setEsperando(false);
                    }, "set_note_trigger")
                  }
                />
              ) : (
                <button className="nota-hechas" onClick={() => setEsperando(true)}>
                  + {tr("Avisarme cuando llegue algo aquí")}
                </button>
              )}
            </>
          )}
          {!sistema && !hangar && (
            <span className="muted small">
              {tr("Esta nota no está clavada en ningún sitio, así que no hay nada que la dispare. Ánclala desde la ficha de un sistema o de un hangar.")}
            </span>
          )}
        </div>

        <Partes noteId={nota.id} onCambio={onCambio} />

        <div className="nd-linea muted small">
          {tr("Creada")}: {nota.created_at.slice(0, 10)}
          {nota.done_at && ` · ${tr("Hecha")}: ${nota.done_at.slice(0, 10)}`}
        </div>

        <div className="nd-acciones">
          <button
            className="nota-save"
            onClick={() =>
              void accion(
                () => invoke("set_note_done", { id: nota.id, done: !nota.done_at }),
                "set_note_done",
              ).then(onClose)
            }
          >
            {nota.done_at ? `↺ ${tr("Reabrir")}` : `✓ ${tr("Marcar como hecha")}`}
          </button>
          <button
            className="nota-hechas"
            onClick={() =>
              void accion(() => invoke("delete_note", { id: nota.id }), "delete_note").then(onClose)
            }
          >
            {tr("Borrar")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** NUEVA NOTA en ventana (pedido suyo, 2026-08-31): un botón, no un cuadro de texto suelto en
 *  medio de la sección.
 *
 *  Aquí solo van las opciones que NO necesitan que la nota exista todavía (texto, a quién le toca,
 *  destacada). Al guardar se crea y **se encadena con su detalle**, que es donde se le ponen
 *  pilotos y avisos. Así no quedan notas vacías si cambias de idea a mitad: nada se crea hasta que
 *  hay texto y pulsas Guardar. */
function NotaNueva({
  subjectId,
  pjs,
  onCreada,
  onClose,
}: {
  subjectId: number;
  pjs: Character[];
  onCreada: (id: number) => void;
  onClose: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [quien, setQuien] = useState(subjectId);
  const [destacada, setDestacada] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  async function crear() {
    const body = texto.trim();
    if (!body) return;
    try {
      const id = await invoke<number>("create_note", {
        subjectId: quien,
        body,
        pinned: destacada,
        anchors: [],
      });
      onCreada(id);
    } catch (e) {
      console.error("create_note", e);
    }
  }

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="nota-modal" onClick={(e) => e.stopPropagation()}>
        <div className="loot-modal-head">
          <strong className="nota-titulo">
            <TipoIcono typeId={3814} size={18} />
            {tr("Nueva nota")}
          </strong>
          <button className="loot-modal-x" onClick={onClose} title={tr("Cerrar")}>
            ✕
          </button>
        </div>

        <div className="nota-form">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={4}
            autoFocus
            placeholder={tr("¿Qué hay que recordar o hacer?")}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void crear();
            }}
          />
        </div>

        <div className="nd-linea">
          <span className="muted small">{tr("¿A quién le toca?")}</span>
          <select className="nota-quien" value={quien} onChange={(e) => setQuien(Number(e.target.value))}>
            <option value={0}>{tr("Cualquiera")}</option>
            {pjs.map((p) => (
              <option key={p.character_id} value={p.character_id}>
                {p.name}
              </option>
            ))}
          </select>
          <label className="nota-avisar">
            <input type="checkbox" checked={destacada} onChange={(e) => setDestacada(e.target.checked)} />
            {tr("Destacada")}
          </label>
        </div>

        <div className="nd-linea muted small">
          {tr("Al guardar se abre la nota para ponerle pilotos o un aviso.")}
        </div>

        <div className="nd-acciones">
          <button className="nota-save" onClick={() => void crear()} disabled={!texto.trim()}>
            {tr("Guardar")}
          </button>
          <button className="nota-hechas" onClick={onClose}>
            {tr("Cancelar")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function NotasVista({ subject }: { subject: number | "global" }) {
  const subjectId = typeof subject === "number" ? subject : 0;
  const [notas, setNotas] = useState<Note[] | null>(null);
  const [pjs, setPjs] = useState<Character[]>([]);
  const [sys, setSys] = useState<Map<number, string>>(new Map());
  const [sysArr, setSysArr] = useState<NeSystem[]>([]);
  const [verHechas, setVerHechas] = useState(false);
  const [nueva, setNueva] = useState(false);
  /** Nota abierta en grande. La edición EN LÍNEA se quitó: tener dos formas de editar lo mismo
   *  es la vía segura para que una de las dos se quede atrás. El detalle es el sitio. */
  const [abierta, setAbierta] = useState<number | null>(null);

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
      .then((ne) => {
        setSys(new Map(ne.systems.map((s) => [s.id, s.n])));
        setSysArr(ne.systems);
      })
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

  const abiertas = useMemo(() => (notas ?? []).filter((n) => !n.done_at), [notas]);
  const hechas = useMemo(() => (notas ?? []).filter((n) => n.done_at), [notas]);
  /** Con disparador arriba: son las que van a hablarte solas, y por tanto las que más valen. */
  const orden = useMemo(
    () =>
      [...abiertas].sort(
        (a, b) =>
          // Destacadas primero, luego las que avisan solas: las dos formas de decir «esta importa».
          Number(b.pinned) - Number(a.pinned) ||
          Number(!!b.trigger_kind) - Number(!!a.trigger_kind),
      ),
    [abiertas],
  );

  const nombrePj = (id: number) => pjs.find((p) => p.character_id === id)?.name ?? `#${id}`;

  function Fila({ n }: { n: Note }) {
    const hecha = !!n.done_at;
    return (
      <div className={`nv-fila${hecha ? " hecha" : ""}${n.pinned ? " pin" : ""}`}>
        <div className="nv-cuerpo">
          {/* Abrir en grande: la fila es un resumen, y todo lo que se le puede hacer a una nota
              —disparador, pilotos, a quién le toca— vive en el detalle. */}
          <span
            className="nota-body editable"
            title={tr("Abrir la nota")}
            onClick={() => setAbierta(n.id)}
          >
            {n.body}
          </span>

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
            {n.steps_total > 0 && (
              <span
                className={`nv-tag${n.steps_done === n.steps_total ? " disp" : ""}`}
                title={tr("Tareas hechas")}
              >
                {n.steps_done}/{n.steps_total}
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

      <button className="ida-btn ida-primary nv-btn" onClick={() => setNueva(true)}>
        + {tr("Nueva nota")}
      </button>

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

      {nueva && (
        <NotaNueva
          subjectId={subjectId}
          pjs={pjs}
          onClose={() => setNueva(false)}
          onCreada={(id) => {
            setNueva(false);
            cargar();
            setAbierta(id); // encadenado: sigue configurándola sin buscarla en la lista
          }}
        />
      )}

      {abierta !== null && (() => {
        const n = (notas ?? []).find((x) => x.id === abierta);
        // Si la nota desapareció (borrada desde el propio detalle), no hay nada que pintar.
        return n ? (
          <NotaDetalle
            nota={n}
            pjs={pjs}
            sys={sys}
            sysArr={sysArr}
            onCambio={cargar}
            onClose={() => setAbierta(null)}
          />
        ) : null;
      })()}

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
