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
import { typeIcon, bpIcon } from "./format";
import type { Note, Character } from "./types";
import { loadJson } from "./staticJson";

/** Iconografía EVE primero (regla de RoGiz7, 2026-07-29): antes de poner un emoji, buscar qué ítem
 *  de EVE representa la cosa. `3814` = «informes», un trade good viejo y genérico cuyo icono es un
 *  documento. Cambiar aquí y cambia en todas partes; el emoji queda de reserva si el Image Server
 *  no responde, que es lo que ya se hace en el resto de la app. */
const NOTA_TID = 3814;

/** Catálogo de tipos para el disparador de inventario. `public/market_types.json` son 19.369
 *  entradas: se carga UNA vez y en cuanto alguien abre el buscador, no al montar el modal.
 *  Su caché propia (un `let CAT` de módulo) funcionaba bien, pero era LA SUYA: Comercio y el
 *  índice de botín tenían la suya, y el mismo mega se podía bajar tres veces por sesión. Ahora
 *  el dueño del fichero es staticJson.ts y lo comparten los tres. */
type TipoCat = { i: number; n: string };
function catalogo(): Promise<TipoCat[]> {
  return loadJson<TipoCat[]>("/market_types.json", []);
}

/** Nombre de un tipo desde el catálogo ya cargado. `null` mientras no esté. */
function useNombreTipo(typeId: number | null): string | null {
  const [nombre, setNombre] = useState<string | null>(null);
  useEffect(() => {
    if (!typeId) return;
    let vivo = true;
    void catalogo().then((c) => {
      if (vivo) setNombre(c.find((t) => t.i === typeId)?.n ?? null);
    });
    return () => {
      vivo = false;
    };
  }, [typeId]);
  return nombre;
}

/** Icono de un tipo, aguantando el caso de los BLUEPRINTS.
 *
 *  ⚠️ El servidor de EVE tiene variantes propias para los planos (`bp`) y **NO responde a `/icon`**:
 *  con `typeIcon` salen rotos. Lo pilló RoGiz7 al esperar una «Carbon Fiber Reaction Formula», que
 *  es un plano. Se prueba el icono normal y, si falla, la variante de plano; si tampoco, se calla.
 *  Las fórmulas de reacción son de lo más razonable que alguien puede esperar en un deliver, así
 *  que este caso no es raro. */
export function TipoIcono({ typeId, size = 16 }: { typeId: number; size?: number }) {
  const [paso, setPaso] = useState<0 | 1 | 2>(0);
  if (paso === 2) return null;
  return (
    <img
      src={paso === 0 ? typeIcon(typeId, 32) : bpIcon(typeId, true, 32)}
      width={size}
      height={size}
      alt=""
      loading="lazy"
      onError={() => setPaso((p) => (p === 0 ? 1 : 2))}
    />
  );
}

/** Nombre de un piloto anclado. Se guarda el ID, así que el nombre hay que resolverlo — y se
 *  cachea en memoria porque la misma nota puede repetirlo y varias notas compartir piloto. */
const PILOTOS = new Map<number, string>();
export function NombrePiloto({ id }: { id: number }) {
  const [nombre, setNombre] = useState<string | null>(PILOTOS.get(id) ?? null);
  useEffect(() => {
    if (PILOTOS.has(id)) return;
    let vivo = true;
    invoke<Record<number, string>>("resolve_ids", { ids: [id] })
      .then((m) => {
        const n = m[id];
        if (n) PILOTOS.set(id, n);
        if (vivo && n) setNombre(n);
      })
      .catch((e) => console.error("resolve_ids", e));
    return () => {
      vivo = false;
    };
  }, [id]);
  return <>{nombre ?? `#${id}`}</>;
}

/** «Se lo dejé a Reclutador»: ancla la nota a un piloto REAL, resolviendo su nombre por ESI.
 *
 *  Se guarda el ID y no el texto porque un nombre escrito de dos formas serían dos pilotos, y
 *  entonces «¿qué le he prestado a este tío?» no podría contestarse nunca.
 *
 *  ★ AUTOCOMPLETAR (pedido suyo, 2026-08-31). ESI **no busca por aproximación**: exige el nombre
 *    exacto y sin una letra de más, lo cual es horrible para escribir. Pero Koru ya conoce un
 *    montón de gente —tu intel, con quién has volado, tus conversaciones— porque todo eso pasa por
 *    `name_cache`. Así que se busca AHÍ mientras escribes, y solo se cae a ESI (nombre exacto)
 *    cuando el piloto es alguien que Koru no ha visto nunca.
 *    Las dos vías se distinguen en pantalla: lo local se ofrece, lo de ESI hay que pedirlo. */
export function AnclarPiloto({ onPick }: { onPick: (id: number, nombre: string) => void }) {
  const [q, setQ] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [nada, setNada] = useState(false);
  const [sug, setSug] = useState<[number, string][]>([]);

  // Sugerencias locales según escribes. Sin debounce a propósito: es una consulta a SQLite sobre
  // una tabla indexada, no una llamada de red.
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) {
      setSug([]);
      return;
    }
    let vivo = true;
    invoke<[number, string][]>("search_pilots", { q: t })
      .then((r) => vivo && setSug(r))
      .catch(() => vivo && setSug([]));
    return () => {
      vivo = false;
    };
  }, [q]);

  /** Plan B: el nombre EXACTO contra ESI, para alguien que Koru no conoce todavía. */
  async function buscarEsi() {
    const n = q.trim();
    if (!n) return;
    setBuscando(true);
    setNada(false);
    try {
      const p = await invoke<{ character_id: number; name: string } | null>("resolve_pilot", {
        name: n,
      });
      if (p) {
        onPick(p.character_id, p.name);
        setQ("");
        setSug([]);
      } else {
        setNada(true);
      }
    } catch (e) {
      console.error("resolve_pilot", e);
      setNada(true);
    } finally {
      setBuscando(false);
    }
  }

  return (
    <div className="nota-buscar">
      <input
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setNada(false);
        }}
        onKeyDown={(e) => e.key === "Enter" && void buscarEsi()}
        placeholder={buscando ? tr("Buscando…") : tr("Nombre del piloto")}
        autoFocus
      />
      {sug.length > 0 && (
        <div className="nota-res">
          {sug.map(([id, nombre]) => (
            <button
              key={id}
              className="nota-res-item"
              onClick={() => {
                onPick(id, nombre);
                setQ("");
                setSug([]);
              }}
            >
              <img
                src={`https://images.evetech.net/characters/${id}/portrait?size=32`}
                width={18}
                height={18}
                alt=""
                loading="lazy"
              />
              {nombre}
            </button>
          ))}
        </div>
      )}
      {/* Si no está entre los conocidos, se puede pedir a ESI — pero con el nombre EXACTO, y se
          dice, para que un «no existe» no se lea como «lo he buscado mal». */}
      {q.trim().length >= 2 && sug.length === 0 && !buscando && (
        <button className="nota-hechas" onClick={() => void buscarEsi()}>
          {tr("Buscar en ESI (nombre exacto)")}
        </button>
      )}
      {nada && <span className="muted small">{tr("No existe ese piloto")}</span>}
    </div>
  );
}

/** El nombre de lo que esperas. Sin él, tres notas esperando cosas distintas se leen todas igual
 *  —«Avisar cuando llegue»— y la función deja de servir en cuanto tienes más de una. */
export function NombreTipo({ id }: { id: number }) {
  const n = useNombreTipo(id);
  return <>{n ?? `#${id}`}</>;
}

/** Buscador de tipo para «avisarme cuando lleguen X aquí». */
export function BuscarTipo({ onPick }: { onPick: (t: TipoCat) => void }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<TipoCat[] | null>(null);

  useEffect(() => {
    void catalogo().then(setCat);
  }, []);

  const ql = q.trim().toLowerCase();
  // Un mínimo de 2 letras: con una sola, filtrar 19.000 nombres devuelve ruido y cuesta.
  const res = ql.length < 2 || !cat
    ? []
    : cat.filter((t) => t.n.toLowerCase().includes(ql)).slice(0, 8);

  return (
    <div className="nota-buscar">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={cat ? tr("¿Qué esperas que llegue?") : tr("Cargando…")}
        autoFocus
      />
      {res.length > 0 && (
        <div className="nota-res">
          {res.map((t) => (
            <button key={t.i} className="nota-res-item" onClick={() => onPick(t)}>
              <TipoIcono typeId={t.i} size={18} />
              {t.n}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
  /** Id de la nota cuyo buscador de tipo está abierto (N2b). */
  const [esperando, setEsperando] = useState<number | null>(null);
  /** Id de la nota que se está editando, y su borrador. */
  const [editando, setEditando] = useState<number | null>(null);
  const [borrador, setBorrador] = useState("");
  /** Id de la nota cuyo buscador de piloto está abierto. */
  const [pilotando, setPilotando] = useState<number | null>(null);
  /** ★ El disparador, ELEGIDO AL CREAR y no después (2026-08-31).
   *
   *  Su queja, textual: «no es muy amigable saber las opciones que hay para crear la nota». Y al
   *  mirarlo, el problema no era que estuviera escondido: **todo lo potente —anclar un piloto, el
   *  disparador, a quién le toca— vivía DENTRO de una nota ya creada**, así que con «Sin notas» el
   *  modal no tenía absolutamente nada que enseñar. Superficie cero.
   *
   *  Y la regla de la casa dice que el valor de este motor está en el DISPARADOR, no en el check.
   *  Si es lo que más vale, tiene que estar en la primera pantalla, no descubrirse al segundo uso. */
  const [avisar, setAvisar] = useState(false);
  const [avisarUna, setAvisarUna] = useState(true);

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
      const id = await invoke<number>("create_note", {
        subjectId: subject,
        body,
        pinned: false,
        anchors: [{ kind, id: anchorId }],
      });
      // La nota nace CON su disparador si lo pediste al escribirla. Solo en notas de sistema: ahí
      // el disparador es el propio ancla («avisarme al llegar AQUÍ») y no hay nada que elegir.
      // En una ubicación hay que decir QUÉ esperas, así que eso sigue siendo un segundo paso.
      if (avisar && kind === "system") {
        await invoke("set_note_trigger", { id, systemId: anchorId, once: avisarUna });
      }
      setTexto("");
      setAvisar(false);
      cargar();
    } catch (e) {
      console.error("create_note", e);
    }
  }

  /** Guarda el texto editado. `clearAnchors: false` es importante: `update_note` reemplaza la lista
   *  de anclas, y corregir una falta de ortografía no puede desanclar la nota de su sitio ni del
   *  piloto al que se la prestaste. */
  async function guardarEdicion(n: Note) {
    const body = borrador.trim();
    if (!body || body === n.body) {
      setEditando(null);
      return;
    }
    try {
      await invoke("update_note", {
        id: n.id,
        body,
        pinned: n.pinned,
        anchors: [],
        clearAnchors: false,
      });
      setEditando(null);
      cargar();
    } catch (e) {
      console.error("update_note", e);
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
          {/* EL DISPARADOR, OFRECIDO ANTES DE GUARDAR. Es lo que distingue esta nota de un post-it:
              una aplicación de notas no sabe dónde estás. Por eso va aquí y no escondido dentro de
              la nota ya creada. */}
          {kind === "system" && (
            <label className="nota-avisar">
              <input type="checkbox" checked={avisar} onChange={(e) => setAvisar(e.target.checked)} />
              {tr("Avisarme al llegar aquí")}
              {avisar && (
                <select
                  className="nota-quien"
                  value={avisarUna ? "1" : "0"}
                  onChange={(e) => setAvisarUna(e.target.value === "1")}
                  onClick={(e) => e.preventDefault()}
                  title={tr("Una vez avisa y archiva la nota; siempre la deja abierta")}
                >
                  <option value="1">{tr("una vez")}</option>
                  <option value="0">{tr("cada visita")}</option>
                </select>
              )}
            </label>
          )}
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
                  {/* EDITAR: una nota se corrige o se amplía —«esto se lo dejé a Reclutador»— y
                      sin esto habría que borrarla y reescribirla, perdiendo su fecha, sus anclas
                      y su disparador. */}
                  {editando === n.id ? (
                    <div className="nota-form">
                      <textarea
                        value={borrador}
                        onChange={(e) => setBorrador(e.target.value)}
                        rows={3}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void guardarEdicion(n);
                          if (e.key === "Escape") setEditando(null);
                        }}
                      />
                      <div className="nota-meta">
                        <button className="nota-save" onClick={() => void guardarEdicion(n)}>
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
                  {/* PILOTOS anclados: quién tiene esto, o con quién va la cosa. */}
                  <div className="nota-pilotos">
                    {n.anchors
                      .filter((a) => a.kind === "character")
                      .map((a) => (
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
                                    noteId: n.id,
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
                    {pilotando === n.id ? (
                      <AnclarPiloto
                        onPick={(id) =>
                          void accion(async () => {
                            await invoke("add_note_anchor", {
                              noteId: n.id,
                              kind: "character",
                              anchorId: id,
                            });
                            setPilotando(null);
                          }, "add_note_anchor")
                        }
                      />
                    ) : (
                      <button className="nota-hechas" onClick={() => setPilotando(n.id)}>
                        + {tr("Piloto")}
                      </button>
                    )}
                  </div>
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
                  {/* ★ N2 — EL DISPARADOR. Solo tiene sentido en notas de SISTEMA: el disparador
                      es el propio ancla («avisarme al llegar AQUÍ»), así que no hace falta ningún
                      selector. Es lo que convierte la nota en algo que un post-it no puede hacer. */}
                  {/* ★ N2b — «AVISARME CUANDO LLEGUE X AQUÍ». Solo en notas de UBICACIÓN: el sitio
                      es el ancla y el tipo se elige. Para lo que llega SIN TI —un courier, o un
                      piloto que te hace un deliver de palabra—, porque tu propia carga ya sabes
                      cuándo llega. */}
                  {kind === "location" && (
                    <div className="nota-trig">
                      {n.trigger_kind === "asset" ? (
                        <>
                          <TipoIcono typeId={n.trigger_id} />
                          <span>
                            {tr("Avisar cuando llegue")}: <b><NombreTipo id={n.trigger_id} /></b>
                          </span>
                          <button
                            className="nota-btn del"
                            title={tr("Quitar el aviso")}
                            onClick={() =>
                              void accion(
                                () =>
                                  invoke("set_note_trigger", {
                                    id: n.id,
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
                        </>
                      ) : esperando === n.id ? (
                        <BuscarTipo
                          onPick={(t) =>
                            void accion(async () => {
                              await invoke("set_note_trigger", {
                                id: n.id,
                                systemId: t.i, // el TIPO va en trigger_id; el sitio es el ancla
                                once: true,
                                kind: "asset",
                              });
                              setEsperando(null);
                            }, "set_note_trigger")
                          }
                        />
                      ) : (
                        <button className="nota-hechas" onClick={() => setEsperando(n.id)}>
                          + {tr("Avisarme cuando llegue algo aquí")}
                        </button>
                      )}
                    </div>
                  )}
                  {kind === "system" && (
                    <div className="nota-trig">
                      <label>
                        <input
                          type="checkbox"
                          checked={n.trigger_kind === "arrive"}
                          onChange={(e) =>
                            void accion(
                              () =>
                                invoke("set_note_trigger", {
                                  id: n.id,
                                  systemId: e.target.checked ? anchorId : 0,
                                  once: n.trigger_once,
                                }),
                              "set_note_trigger",
                            )
                          }
                        />
                        {tr("Avisarme al llegar aquí")}
                      </label>
                      {n.trigger_kind === "arrive" && (
                        <select
                          className="nota-quien"
                          value={n.trigger_once ? "1" : "0"}
                          onChange={(e) =>
                            void accion(
                              () =>
                                invoke("set_note_trigger", {
                                  id: n.id,
                                  systemId: anchorId,
                                  once: e.target.value === "1",
                                }),
                              "set_note_trigger",
                            )
                          }
                          title={tr("Una vez avisa y archiva la nota; siempre la deja abierta")}
                        >
                          <option value="1">{tr("una vez")}</option>
                          <option value="0">{tr("cada visita")}</option>
                        </select>
                      )}
                    </div>
                  )}
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
          /* ★ EL VACÍO QUE ENSEÑA. Antes ponía «Sin notas» y punto — y como todos los controles
             potentes viven dentro de una nota existente, con cero notas el modal no enseñaba NADA
             de lo que sabe hacer. Aquí se cuenta, y en función del ancla, porque lo que una nota
             puede hacer en un sistema no es lo que puede hacer en un hangar.
             Mismo criterio que Campañas, Flotas o Social: el cartel explica dónde nace la duda.
             ICONOGRAFÍA EVE, no emoji (regla de RoGiz7): 439 afterburner = moverse/llegar (el mismo
             que unifica la navegación en el mapa) · 17366 Station Container = que llegue algo a un
             hangar · 3355 Social = tratar con una persona · 3348 Leadership = delegar en quién.
             Los cuatro typeID verificados contra public/market_types.json, nunca de memoria. */
          <div className="nota-vacio">
            <div className="muted small">{tr("Aquí no tienes nada apuntado todavía.")}</div>
            <ul className="nota-puede">
              {kind === "system" && (
                <li>
                  <TipoIcono typeId={439} /> <b>{tr("Avisarte al llegar aquí")}</b> —{" "}
                  {tr("marca la casilla de arriba y Koru te lo recuerda cuando entres, una vez o cada visita.")}
                </li>
              )}
              {kind === "location" && (
                <li>
                  <TipoIcono typeId={17366} /> <b>{tr("Avisarte cuando llegue algo a este hangar")}</b> —{" "}
                  {tr("útil para un courier o para lo que otro piloto te va a entregar; lo tuyo ya sabes cuándo llega.")}
                </li>
              )}
              <li>
                <TipoIcono typeId={3355} /> <b>{tr("Anclarla a un piloto")}</b> —{" "}
                {tr("«esto se lo dejé a fulano»; luego se puede consultar por persona.")}
              </li>
              <li>
                <TipoIcono typeId={3348} /> <b>{tr("Decir a quién le toca")}</b> —{" "}
                {tr("con varios personajes, «que lo compre Vera» es otra tarea distinta.")}
              </li>
            </ul>
            <div className="muted small">
              {tr("Todo eso se elige en la propia nota, en cuanto escribas la primera.")}
            </div>
          </div>
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
