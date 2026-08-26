// Sección SOCIAL — el historial de tus conversaciones privadas, reconstruido de los chatlogs.
//
// ★ POR QUÉ EXISTE (idea de RoGiz7, 2026-08-22): EVE escribe un log por cada chat privado y luego
//   no deja releerlos desde el juego. Es otro histórico de tu vida en EVE que se genera y no se
//   enseña — el hermano hablado de «Con quién vuelas»: allí con quién VUELAS, aquí con quién HABLAS.
//
// ★ LO QUE SE MIDIÓ ANTES DE CONSTRUIR (contra el corpus real, 2020→2026) y esta vista asume:
//   · La identidad de una conversación es su `private_{uuid}`, compartido entre los dos lados →
//     el multibox ya viene deduplicado de la BD; aquí no hay que fusionar nada.
//   · El interlocutor sale del CUERPO. La fila con `quien = ""` agrupa lo que no tiene interlocutor
//     externo: charlas entre tus propios personajes y mensajes que nadie contestó.
//   · Escanear es un BOTÓN, no un vigilante: leer conversaciones privadas es un acto deliberado
//     (mismo criterio que el grabador de flotas).
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { fmtSp } from "./format";
import { PilotoNombre } from "./fichaPiloto";

export type SocialConvo = {
  quienes: string[]; // [] = solo-tú / entre tus personajes; 2+ = grupal
  convos: number;
  msgs: number;
  first_ts: number;
  last_ts: number;
};
export type SocialMsg = { ts: number; author: string; text: string; me: boolean };
type ScanStats = { files_seen: number; files_read: number; privates: number; new_messages: number };

function fmtFecha(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toISOString().slice(0, 10);
}
function fmtHora(ts: number): string {
  // Con segundos, como el chat del juego: [10:42:31].
  const d = new Date(ts * 1000);
  return d.toISOString().slice(11, 19);
}

/** Tono ESTABLE por nombre de autor (hash → hue). Estable a propósito: que Zigor77 sea siempre
 *  del mismo color, en cualquier hilo y en cualquier sesión — un color que baila no identifica. */
function hueDe(nombre: string): number {
  let h = 0;
  for (let i = 0; i < nombre.length; i++) h = (h * 31 + nombre.charCodeAt(i)) >>> 0;
  return h % 360;
}
/** Colores de burbuja para el tema oscuro: fondo apagado, borde y nombre más vivos. */
function estiloBurbuja(nombre: string, mio: boolean): CSSProperties {
  const h = hueDe(nombre);
  return {
    background: `hsl(${h} ${mio ? 42 : 26}% ${mio ? 20 : 16}%)`,
    borderColor: `hsl(${h} 45% 32%)`,
  };
}
function colorAutor(nombre: string): CSSProperties {
  return { color: `hsl(${hueDe(nombre)} 65% 68%)` };
}

/** Retrato del personaje si su nombre resolvió a un ID; si no, círculo con la inicial y SU color.
 *  El fallback importa: un piloto renombrado o biomasado ya no resuelve en ESI, pero su historial
 *  sigue aquí y la vista no puede romperse por eso. */
function Avatar({
  nombre,
  id,
  size,
  oculto,
}: {
  nombre: string;
  id: number | undefined;
  size: number;
  oculto?: boolean;
}) {
  const st: CSSProperties = {
    width: size,
    height: size,
    visibility: oculto ? "hidden" : undefined,
  };
  if (id) {
    return (
      <img
        className="soc-avatar"
        style={st}
        src={`https://images.evetech.net/characters/${id}/portrait?size=${size <= 32 ? 32 : 64}`}
        alt={nombre}
        title={nombre}
        loading="lazy"
      />
    );
  }
  return (
    <span
      className="soc-avatar soc-avatar-ini"
      style={{ ...st, background: `hsl(${hueDe(nombre)} 40% 30%)` }}
      title={nombre}
    >
      {nombre.charAt(0).toUpperCase()}
    </span>
  );
}

export function SocialView({
  folder,
  onFicha,
}: {
  folder: string;
  /** Abrir LA FICHA del interlocutor (quién es para ti, más allá de lo hablado). */
  onFicha?: (name: string, id?: number | null) => void;
}) {
  const [convos, setConvos] = useState<SocialConvo[] | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null); // clave = quienes.join(",")
  const [hilo, setHilo] = useState<SocialMsg[] | null>(null);
  const [filtro, setFiltro] = useState("");
  // Orden de la lista: por defecto lo vivo arriba (última actividad); invertido, las más antiguas
  // primero POR SU PRIMER MENSAJE — para pasear el histórico desde 2020, que es a lo que se viene.
  const [recientes, setRecientes] = useState(true);
  // Orden DENTRO del hilo: cronológico por defecto (leer una conversación de arriba abajo), o lo
  // último primero (ver por dónde iba la cosa sin bajar seis años de scroll).
  const [hiloRecientes, setHiloRecientes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanStats, setScanStats] = useState<ScanStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // nombre → character_id, para los retratos. Se resuelve en LOTE con el mismo comando que usa el
  // intel (caché local + ESI + caché negativa): cero red la segunda vez. Lo que no resuelve
  // (renombrado, biomasado) se queda sin entrada y el Avatar cae a la inicial con su color.
  const [ids, setIds] = useState<Record<string, number>>({});

  const resolver = (nombres: string[]) => {
    const faltan = [...new Set(nombres.filter((n) => n && ids[n] === undefined))];
    if (faltan.length === 0) return;
    invoke<{ characters: { id: number; name: string }[] }>("resolve_intel_entities", {
      names: faltan,
    })
      .then((r) => {
        setIds((prev) => {
          const nx = { ...prev };
          for (const c of r.characters) nx[c.name] = c.id;
          return nx;
        });
      })
      .catch(() => {}); // sin red no hay retratos, pero la sección sigue entera
  };

  const cargar = () => {
    invoke<SocialConvo[]>("social_overview")
      .then((cs) => {
        setConvos(cs);
        resolver(cs.flatMap((c) => c.quienes));
      })
      .catch((e) => setErr(String(e)));
  };
  useEffect(cargar, []);

  const escanear = async () => {
    setBusy(true);
    setErr(null);
    try {
      const st = await invoke<ScanStats>("social_scan", { folder });
      setScanStats(st);
      // A partir del primer escaneo manual, el auto_sync lo mantiene fresco (ver App.tsx): el
      // acto deliberado es EMPEZAR a leer; mantenerlo al día ya es mantenimiento.
      localStorage.setItem("koru-social-scanned", "1");
      cargar();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const abrir = async (c: SocialConvo) => {
    setAbierta(c.quienes.join(","));
    setHilo(null);
    try {
      // La firma viaja ENTERA: el hilo son las conversaciones con exactamente esta gente.
      // Un grupo no se mezcla con el 1:1 de uno de sus miembros.
      const ms = await invoke<SocialMsg[]>("social_thread", { quienes: c.quienes });
      setHilo(ms);
      resolver(ms.map((m) => m.author)); // también TUS personajes: cada uno con su cara
    } catch (e) {
      setErr(String(e));
    }
  };

  const lista = useMemo(() => {
    if (!convos) return [];
    const f = filtro.trim().toLowerCase();
    const filtradas = convos.filter((c) => !f || c.quienes.join(", ").toLowerCase().includes(f));
    return [...filtradas].sort((a, b) =>
      recientes ? b.last_ts - a.last_ts : a.first_ts - b.first_ts,
    );
  }, [convos, filtro, recientes]);

  const vacio = convos !== null && convos.length === 0;

  return (
    <>
      <p className="muted small">
        {tr(
          "Tus conversaciones privadas, reconstruidas de los chatlogs que el juego escribe y luego no deja releer. Solo lectura: Koru no puede escribir en un chat, y no quiere.",
        )}
      </p>

      <div className="soc-scan">
        <button className="ida-btn ida-primary" onClick={escanear} disabled={busy || !folder}>
          {busy ? tr("Escaneando…") : tr("Escanear conversaciones")}
        </button>
        {!folder && (
          <span className="small muted">
            {tr("Falta la carpeta de chats: es la misma del intel, en Ajustes → Intel.")}
          </span>
        )}
        {scanStats && (
          <span className="small muted">
            {tr("FICHEROS ficheros mirados · PRIV privados · NUEVOS mensajes nuevos")
              .replace("FICHEROS", fmtSp(scanStats.files_read))
              .replace("PRIV", fmtSp(scanStats.privates))
              .replace("NUEVOS", fmtSp(scanStats.new_messages))}
          </span>
        )}
      </div>

      {err && <p className="small fits-err">{err}</p>}

      {vacio && (
        <p className="muted">
          {tr(
            "Todavía no hay nada: pulsa «Escanear conversaciones». La primera pasada mira toda la carpeta; las siguientes solo lo nuevo.",
          )}
        </p>
      )}

      {convos && convos.length > 0 && (
        <div className="soc-cols">
          <div className="soc-lista">
            <input
              type="text"
              className="soc-buscar"
              placeholder={tr("Buscar piloto…")}
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
            />
            <button
              className="soc-orden small"
              onClick={() => setRecientes((r) => !r)}
              title={tr("Cambiar el orden de la lista")}
            >
              {recientes ? `↓ ${tr("Recientes primero")}` : `↑ ${tr("Antiguas primero")}`}
            </button>
            {lista.map((c) => {
              const clave = c.quienes.join(",");
              return (
                <button
                  key={clave || "(mios)"}
                  className={`soc-item${abierta === clave ? " on" : ""}`}
                  onClick={() => abrir(c)}
                >
                  {c.quienes.length === 0 ? (
                    <span className="soc-avatar soc-avatar-ini" style={{ width: 32, height: 32 }}>
                      👥
                    </span>
                  ) : (
                    <span className="soc-caras">
                      {c.quienes.slice(0, 2).map((n) => (
                        <Avatar key={n} nombre={n} id={ids[n]} size={32} />
                      ))}
                    </span>
                  )}
                  <span className="soc-item-txt">
                    <span className="soc-nombre">
                      {c.quienes.length === 0 ? (
                        tr("Entre tus personajes / sin respuesta")
                      ) : c.quienes.length > 1 ? (
                        `${tr("Grupo")}: ${c.quienes.join(", ")}`
                      ) : (
                        // PilotoNombre lleva stopPropagation de serie: la fila entera YA es un
                        // botón (abrir el hilo) y el nombre no debe robarle el clic sin querer.
                        <PilotoNombre
                          nombre={c.quienes[0]}
                          id={ids[c.quienes[0]]}
                          onFicha={onFicha}
                        />
                      )}
                    </span>
                    <span className="soc-meta small muted">
                      {fmtSp(c.msgs)} {tr("msgs")} · {fmtFecha(c.first_ts)} → {fmtFecha(c.last_ts)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="soc-hilo">
            {abierta === null && (
              <p className="muted small">{tr("Elige una conversación de la lista.")}</p>
            )}
            {abierta !== null && hilo === null && <p className="muted small">{tr("Cargando…")}</p>}
            {hilo && hilo.length === 0 && (
              <p className="muted small">{tr("Sin mensajes.")}</p>
            )}
            {hilo && hilo.length > 0 && (
              <button
                className="soc-orden small soc-orden-hilo"
                onClick={() => setHiloRecientes((r) => !r)}
                title={tr("Cambiar el orden de los mensajes")}
              >
                {hiloRecientes ? `↑ ${tr("Recientes primero")}` : `↓ ${tr("Cronológico")}`}
              </button>
            )}
            {hilo &&
              (() => {
                // Lado de cada burbuja, estilo WhatsApp: lo del otro a la IZQUIERDA, lo tuyo a la
                // DERECHA. En el cubo «entre tus personajes» todos son tuyos, así que el lado sale
                // del ORDEN de aparición del autor (1º izquierda, 2º derecha, y alternando) — con
                // dos alts hablando queda exactamente como un chat normal.
                // ⚠️ El orden de aparición se calcula SIEMPRE sobre el hilo cronológico: si saliera
                // del orden mostrado, invertir la vista cambiaría a cada uno de lado.
                const orden: string[] = [];
                for (const m of hilo) if (!orden.includes(m.author)) orden.push(m.author);
                const derecha = (m: SocialMsg) =>
                  abierta === "" ? orden.indexOf(m.author) % 2 === 1 : m.me;
                const mostrado = hiloRecientes ? [...hilo].reverse() : hilo;
                return mostrado.map((m, i) => {
                  const nuevoDia = i === 0 || fmtFecha(mostrado[i - 1].ts) !== fmtFecha(m.ts);
                  // El autor solo se rotula cuando CAMBIA (o al cambiar de día): como en cualquier
                  // chat, la ristra de mensajes seguidos del mismo ya se reconoce por color y lado.
                  const rotular =
                    nuevoDia || i === 0 || mostrado[i - 1].author !== m.author;
                  const dcha = derecha(m);
                  return (
                    <div key={`${m.ts}-${m.author}-${i}`} className="soc-fila">
                      {nuevoDia && <div className="soc-dia small muted">{fmtFecha(m.ts)}</div>}
                      <div className={`soc-msgrow${dcha ? " mio" : ""}`}>
                        {/* El hueco del avatar se reserva SIEMPRE (oculto si no rotula): sin él,
                            las burbujas seguidas del mismo autor bailarían de columna. */}
                        <Avatar nombre={m.author} id={ids[m.author]} size={28} oculto={!rotular} />
                        {/* La línea es EVE puro —[hora] Autor > texto— dentro de la burbuja
                            WhatsApp: lados, colita y color por autor. El autor solo se repite al
                            cambiar, como arriba; la hora va SIEMPRE, que es lo que da el ritmo de
                            la conversación en el juego. */}
                        <div
                          className={`soc-msg${dcha ? " mio" : ""}`}
                          style={estiloBurbuja(m.author, m.me)}
                        >
                          <span className="soc-linea">
                            <span className="soc-hora small muted">[{fmtHora(m.ts)}]</span>{" "}
                            {rotular && (
                              <>
                                <span className="soc-autor" style={colorAutor(m.author)}>
                                  {/* El autor de una burbuja también es una persona con ficha. */}
                                  <PilotoNombre nombre={m.author} id={ids[m.author]} onFicha={onFicha} />
                                </span>
                                <span className="soc-sep muted"> &gt; </span>
                              </>
                            )}
                            <span className="soc-texto">{m.text}</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
          </div>
        </div>
      )}

      {/* La advertencia va DENTRO de la sección, como en Flotas: es de lo más sensible que enseña
          Koru — conversaciones de OTRAS personas — y quien la abre debe saberlo aquí, no en unos
          ajustes que nadie lee. */}
      <p className="small muted soc-privacidad">
        {tr(
          "Esto son conversaciones privadas: las tuyas y las de quienes hablaron contigo. Se quedan en tu ordenador y no se envían a ningún sitio — y son lo último que debería salir en una captura.",
        )}
      </p>
    </>
  );
}
