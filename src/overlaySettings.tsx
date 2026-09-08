// Ajustes del overlay de avisos (la ventanita que flota sobre el juego). Ver `overlay.tsx` para
// el porqué de la función y las reglas anti-ruido.
//
// Dos decisiones que están aquí a propósito:
//   · APAGADO DE FÁBRICA. Un aviso flotante que aparece sin que nadie lo haya pedido es motivo de
//     desinstalación. Se enciende a mano, una vez.
//   · LISTA BLANCA, no negra. Hoy solo el intel. Cuando haya más avisos, el jugador AÑADE los que
//     quiera en vez de tener que ir apagando los que le sobran.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm as dialogConfirm } from "@tauri-apps/plugin-dialog";
import {
  anotarResultado,
  aprenderNombresMinuscula,
  escucharReconstruccion,
  estadoReconstruccion,
  reconPendiente,
  reconstruirAvistamientos,
} from "./reconstruirIntel";
import { tr } from "./i18n";
import { ALERT_SOUNDS, playAlertChoice, beep } from "./sound";
import type { IntelConfig, LogDirCandidate } from "./types";

/** Config del intel que se pone UNA VEZ y no se vuelve a tocar: de dónde se lee, qué canales,
 *  cuánto dura un avistamiento y qué suena. Vivía en el panel de 280 px del mapa, donde no cabía
 *  y competía por sitio con lo que sí se toca volando (umbral de saltos, pilotos, anclas).
 *  Aquí hay ancho de sobra: los canales pasan de un desplegable a una lista que se ve entera. */
export function IntelSettings({ intel }: { intel: IntelConfig }) {
  /** Resultado del buscador. `null` = todavía no se ha buscado (no es lo mismo que «no hay»). */
  const [hallazgos, setHallazgos] = useState<LogDirCandidate[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  /** Busca la carpeta de chats sin preguntarle nada al usuario.
   *
   *  Con UNA candidata se pone sola: hacer clic otra vez para confirmar lo que solo puede ser una
   *  cosa es papeleo. Con VARIAS se pregunta — elegir por él entre dos instalaciones sería adivinar,
   *  y aquí adivinar se paga con el intel mudo, que falla en silencio. */
  const buscar = async () => {
    setBuscando(true);
    try {
      const r = await invoke<LogDirCandidate[]>("find_eve_log_dirs", { sub: "Chatlogs" });
      setHallazgos(r);
      if (r.length === 1) intel.onSetFolder?.(r[0].path);
    } catch {
      setHallazgos([]);
    } finally {
      setBuscando(false);
    }
  };

  // --- El archivo de líneas de intel (`intel_line`) ---
  /** `[cuántas, primera_ms, última_ms]`. `null` = todavía no se ha preguntado. */
  const [archivo, setArchivo] = useState<[number, number | null, number | null] | null>(null);
  const [buscaCanal, setBuscaCanal] = useState("");
  // ★ El estado de la reconstrucción se LEE del módulo, no se guarda aquí: si no, salir de Ajustes
  //   a mitad dejaba el panel como si no pasara nada mientras el proceso seguía corriendo a solas
  //   — y el botón habilitado para lanzar una segunda que purgaría lo de la primera. Lo vio él en
  //   vivo, al 46 %.
  const [rehaciendo, setRehaciendo] = useState(() => estadoReconstruccion().activo);
  const [progreso, setProgreso] = useState(() => estadoReconstruccion().progreso);
  useEffect(() => {
    const e = estadoReconstruccion();
    setRehaciendo(e.activo);
    setProgreso(e.progreso);
    if (e.resultado) setResultado(e.resultado);
    return escucharReconstruccion((n) => {
      setRehaciendo(n.activo);
      setProgreso(n.progreso);
      if (n.resultado) setResultado(n.resultado);
    });
  }, []);
  /** Rehace `intel_sightings` desde las líneas guardadas. Ver `reconstruirIntel.ts` para el porqué
   *  y para las tres decisiones que lo hacen seguro (un solo troceador, sin ESI, por páginas).
   *
   *  Se avisa ANTES con `dialogConfirm` porque durante la pasada los avistamientos están vacíos: si
   *  cerrase Koru a medias, el rastro histórico de sus hostiles se quedaría incompleto hasta que lo
   *  volviera a lanzar. No se pierde nada —las líneas siguen ahí— pero hay que decirlo. */
  /** Una pasada a medias, si la hay. `null` = todavía no se ha mirado. */
  const [pendiente, setPendiente] = useState<
    { pct: number; continuable: boolean } | null | false
  >(null);
  const mirarPendiente = () =>
    reconPendiente()
      .then((r) => setPendiente(r.hay ? { pct: r.pct, continuable: r.continuable } : false))
      .catch(() => setPendiente(false));
  useEffect(() => {
    mirarPendiente();
  }, []);

  /** Continúa por donde se cortó. Sin preguntar nada: la purga ya se hizo y no se repite, así que
   *  aquí no hay ninguna decisión destructiva que confirmar. */
  const continuar = async () => {
    setResultado(null);
    try {
      const r = await reconstruirAvistamientos(undefined, true);
      anotarResultado(
        `${tr("Borrados")} ${r.borrados.toLocaleString()} · ${tr("ahora")} ${r.avistamientos.toLocaleString()} ${tr("avistamientos")} · ${r.lineas.toLocaleString()} ${tr("líneas releídas")}`,
      );
      contar();
      mirarPendiente();
    } catch (e) {
      anotarResultado(`${tr("No se pudo rehacer")}: ${String(e)}`);
      mirarPendiente();
    }
  };

  const rehacer = async () => {
    const ok = await dialogConfirm(
      tr(
        "Se van a borrar los avistamientos y a rehacer desde las líneas guardadas. No se pierde nada: las líneas se conservan. Tarda un rato y conviene no cerrar Koru mientras.",
      ),
      { title: tr("Rehacer los avistamientos"), kind: "warning" },
    );
    if (!ok) return;
    setResultado(null);
    try {
      const r = await reconstruirAvistamientos();
      // Se enseñan las DOS cifras a propósito: cuántos se van y cuántos quedan. Que no coincidan es
      // el resultado, no un error — es la basura que se va y los nombres que antes se partían.
      //
      // ⚠️ Y se dice **«Borrados X · ahora Y»**, no «X → Y». La flecha se leía como «tenías X y
      // ahora tienes Y», y eso solo es cierto tras una pasada completa: después de una interrumpida,
      // X es lo que había escrito la pasada a medias. A él le salió «15.824 → 587.918» cuando su
      // histórico real de antes eran 570.190. Un cartel que engaña justo en el caso raro es peor que
      // uno feo, porque el caso raro es cuando se mira.
      anotarResultado(
        `${tr("Borrados")} ${r.borrados.toLocaleString()} · ${tr("ahora")} ${r.avistamientos.toLocaleString()} ${tr("avistamientos")} · ${r.lineas.toLocaleString()} ${tr("líneas releídas")}`,
      );
      contar();
      mirarPendiente();
    } catch (e) {
      anotarResultado(`${tr("No se pudo rehacer")}: ${String(e)}`);
      mirarPendiente();
    }
  };
  /** ★★ APRENDER LOS NOMBRES EN MINÚSCULA. Ver `aprenderNombresMinuscula` para el porqué: sin esto,
   *  la puerta de minúsculas del troceador no puede abrirse nunca, porque `name_cache` solo tiene lo
   *  que Koru ya preguntó y Koru nunca preguntó por una minúscula.
   *
   *  No borra nada, así que **no se confirma**: lo peor que puede pasar es gastar unas peticiones.
   *  Y se puede repetir: lo ya sabido no se vuelve a preguntar. */
  const [aprendiendo, setAprendiendo] = useState(false);
  /** ⚠️ El texto del botón lleva la FASE, no solo un porcentaje. Antes decía «Aprendiendo… 100 %»
   *  durante toda la parte de preguntar a ESI, que es la que de verdad tarda — un 100 % que no ha
   *  terminado. Lo vio él en pantalla. */
  const [progAprender, setProgAprender] = useState("");
  /** ★★ CUÁNTOS VEREDICTOS NUEVOS TRAJO LA ÚLTIMA PASADA (2026-09-08, pregunta suya).
   *
   *  Él preguntó si aprender no debería lanzar el rehacer al terminar. Encadenarlos NO, por dos
   *  motivos: rehacer **purga los avistamientos**, y lanzar algo destructivo como efecto secundario
   *  de algo que suena inofensivo es de lo que no se deshace con un «vaya»; y si una tanda de ESI
   *  falla, encadenar reconstruiría sobre una caché a medias.
   *
   *  Pero tenía razón en el fondo: **aprender no hace nada visible por sí solo**. Crece `name_cache`
   *  y ya; los avistamientos no se mueven hasta que rehaces. Un botón cuyo efecto no existe hasta
   *  que pulsas otro es medio botón — y el cartel te obligaba a RECORDAR el orden («Hazlo antes de
   *  rehacer»), que es justo el tipo de regla que la gente se salta.
   *
   *  Así que ni encadenar ni dejarlo: al terminar, **el resultado termina en el botón**, con la
   *  cifra delante. Y si no aprendió nada, se dice y el botón no aparece — rehacer son veinte
   *  minutos y no se regalan.
   *
   *  ⚠️ El número es el CRECIMIENTO REAL de `name_cache`, no «cuántos se preguntaron»: se pregunta
   *  también por cosas que ya tenían veredicto, y ese número no significaría nada. Y cuenta los DOS
   *  veredictos —sí y no—, porque un «no» también cambia los avistamientos: retira a un piloto que
   *  hasta ahora se fichaba.
   *
   *  ⚠️ Esto SÍ vive en el componente, a diferencia del progreso de los trabajos largos: es un
   *  empujón de después, no un proceso. Si te sales de Ajustes se pierde — y no pasa nada, porque el
   *  resultado de la pasada sigue escrito (`anotarResultado`, que sí es de módulo) y volver a pulsar
   *  aprender no cuesta ninguna petición: lo ya sabido no se repregunta. */
  const [veredictosNuevos, setVeredictosNuevos] = useState<number | null>(null);
  const tamCache = async () => {
    const [si, no] = await Promise.all([
      invoke<string[]>("intel_existentes"),
      invoke<string[]>("intel_inexistentes"),
    ]);
    return si.length + no.length;
  };
  const aprender = async () => {
    setAprendiendo(true);
    setResultado(null);
    setVeredictosNuevos(null);
    const antes = await tamCache().catch(() => -1);
    try {
      const r = await aprenderNombresMinuscula((p) =>
        setProgAprender(
          p.fase === "leyendo"
            ? `${tr("Leyendo…")} ${p.total > 0 ? Math.min(100, Math.round((p.lineas / p.total) * 100)) : 0}%`
            : `${tr("Preguntando…")} ${p.hechos}/${p.candidatos}`,
        ),
      );
      anotarResultado(
        `${tr("Nombres preguntados")}: ${r.preguntados.toLocaleString()} · ${tr("son personas")}: ${r.personas.toLocaleString()}`,
      );
      // Si no se pudo medir el antes (`-1`), se ofrece rehacer igual: mejor ofrecer de más que
      // callarse y dejar el trabajo a medias sin decirlo.
      const despues = await tamCache().catch(() => -1);
      setVeredictosNuevos(antes < 0 || despues < 0 ? r.personas : despues - antes);
    } catch (e) {
      anotarResultado(`${tr("No se pudo aprender")}: ${String(e)}`);
    } finally {
      setAprendiendo(false);
      setProgAprender("");
    }
  };
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const contar = () =>
    invoke<[number, number | null, number | null]>("intel_lines_stats")
      .then(setArchivo)
      .catch(() => setArchivo([0, null, null]));
  useEffect(() => {
    contar();
  }, []);
  /** Trae de golpe lo ya cantado: una pasada por TODOS los logs de los canales marcados.
   *
   *  Se puede pulsar las veces que haga falta — `INSERT OR IGNORE` hace que la segunda pasada no
   *  cambie nada. Por eso se enseñan las NUEVAS y no las leídas: si dijera «246.188 líneas» cada
   *  vez, parecería que duplica. */
  const importar = async () => {
    setImportando(true);
    setResultado(null);
    try {
      const r = await invoke<{ ficheros: number; lineas: number; nuevas: number; ms: number }>(
        "intel_import_historico",
        { folder: intel.folder, channels: intel.channels },
      );
      setResultado(
        `${r.ficheros.toLocaleString()} ${tr("ficheros")} · ${r.lineas.toLocaleString()} ${tr(
          "líneas leídas",
        )} · ${r.nuevas.toLocaleString()} ${tr("nuevas")} · ${(r.ms / 1000).toFixed(1)} s`,
      );
      contar();
    } catch (e) {
      // El error se ENSEÑA. Una importación que no hace nada y no dice por qué es peor que un error.
      setResultado(`${tr("No se pudo importar")}: ${String(e)}`);
    } finally {
      setImportando(false);
    }
  };

  return (
    <>
      <div className="tb-settings-title small muted">{tr("Lectura de los chats de intel")}</div>

      <div className="tb-settings-item">
        <span className="tb-si-ic">📁</span>
        <span className="tb-si-tx">
          <strong>{tr("Carpeta de logs de EVE")}</strong>
          <span className="small muted">
            {tr("Donde el juego escribe los chats. Sin esto el intel no puede leer nada.")}
          </span>
          <div className="ovs-row">
            <span className={`ovs-path${intel.folder ? "" : " ovs-path-vacio"}`} title={intel.folder}>
              {intel.folder || tr("(sin definir)")}
            </span>
            {/* BUSCAR va ANTES que Elegir: pedirle a alguien la ruta de un prefijo de Proton es
                pedirle demasiado, y el que no sabe ni por dónde empezar es justo el que más lo
                necesita. Elegir a mano se queda para quien tenga una instalación rara. */}
            <button onClick={buscar} disabled={buscando}>
              {buscando ? tr("Buscando…") : `🔎 ${tr("Buscar")}`}
            </button>
            <button onClick={intel.onPickFolder}>{tr("Elegir…")}</button>
          </div>
          {/* Con UNA candidata se pone sola y se dice cuál. Con VARIAS se pregunta: elegir por él
              entre dos instalaciones sería adivinar, y adivinar aquí se paga con el intel mudo. */}
          {hallazgos !== null && hallazgos.length > 1 && (
            <div className="ovs-hallazgos small">
              {tr("Se encontraron varias. Elige la tuya:")}
              {hallazgos.map((h) => (
                <button key={h.path} className="ovs-hallazgo" onClick={() => intel.onSetFolder?.(h.path)}>
                  <strong>{h.source}</strong> · {h.files} {tr("ficheros")}
                  <span className="muted"> — {h.path}</span>
                </button>
              ))}
            </div>
          )}
          {hallazgos !== null && hallazgos.length === 0 && (
            <div className="small ovs-chan-err">
              {tr(
                "No se encontró ninguna carpeta con chats. Se ha mirado en las bibliotecas de Steam declaradas (incluidas las de otros discos), en Wine, en Lutris y en Documentos. Si tu EVE está en otro sitio, elígela a mano.",
              )}
            </div>
          )}
        </span>
      </div>

      <div className="tb-settings-item">
        <span className="tb-si-ic">💬</span>
        <span className="tb-si-tx">
          <strong>{tr("Canales que se vigilan")}</strong>
          {/* Tres estados, no dos. El del medio faltaba y era el que dejaba tirado a quien tiene
              la carpeta bien pero Koru no puede abrirla: el cartel culpaba a la carpeta. */}
          <span className={`small ${intel.channelsError ? "ovs-chan-err" : "muted"}`}>
            {intel.channelsError
              ? intel.channelsError
              : intel.availChannels.length === 0
                ? // No basta con «no hay»: se cuenta LO QUE SE VIO. Cero entradas es una carpeta
                  // equivocada; muchos .txt sin ninguno válido es otro problema, y el ejemplo lo
                  // enseña en vez de obligar a adivinarlo.
                  intel.scan
                  ? `${tr("Leí la carpeta")}: ${intel.scan.entries} ${tr("ficheros dentro")}, ${intel.scan.txt} .txt${
                      intel.scan.sample ? ` · ${tr("ejemplo")}: ${intel.scan.sample}` : ""
                    }`
                  : tr("No se encontraron canales en la carpeta.")
                : `${intel.channels.length} / ${intel.availChannels.length} ${tr("vigilados")}`}
          </span>
          {/* ★ SOLO LOS ELEGIDOS, Y UN BUSCADOR PARA AÑADIR. Antes eran 153 casillas en una parrilla
              con barra de desplazamiento propia: para ver los DOS que de verdad vigilas había que
              rebuscarlos entre `WindrunnerFits`, `bigaugswarm` y `Why Was I Ganked_`. Y el número
              solo crece — al aprender a mirar en `old\` pasó de 14 canales a 153.

              La lista completa no desaparece, se pide: se escribe y aparece. Es lo mismo que hace
              el buscador de sistemas del mapa, y por eso se ve igual. */}
          <div className="ovs-chans-sel">
            {intel.channels.length === 0 && (
              <span className="small muted">{tr("Ninguno todavía.")}</span>
            )}
            {intel.channels.map((c) => (
              <button
                key={c}
                className="ovs-chip"
                title={tr("Dejar de vigilar")}
                onClick={() => intel.onConfig({ channels: intel.channels.filter((x) => x !== c) })}
              >
                {c} <span className="ovs-chip-x">✕</span>
              </button>
            ))}
          </div>
          <div className="ovs-chan-add sys-search">
            <input
              value={buscaCanal}
              onChange={(e) => setBuscaCanal(e.target.value)}
              placeholder={`${tr("Añadir canal…")}  (${intel.availChannels.length})`}
            />
            {buscaCanal.trim() !== "" && (
              <ul className="sys-search-list">
                {(() => {
                  const q = buscaCanal.trim().toLowerCase();
                  const hay = intel.availChannels
                    .filter((c) => !intel.channels.includes(c) && c.toLowerCase().includes(q))
                    // Primero los que EMPIEZAN por lo escrito: quien teclea «delve» busca
                    // «delve.imperium», no «xxx-delve-yyy».
                    .sort((a, b) => {
                      const pa = Number(a.toLowerCase().startsWith(q));
                      const pb = Number(b.toLowerCase().startsWith(q));
                      return pb - pa || a.localeCompare(b);
                    });
                  if (hay.length === 0) {
                    return <li className="muted">{tr("Ningún canal con ese nombre.")}</li>;
                  }
                  return hay.slice(0, 12).map((c) => (
                    <li
                      key={c}
                      onClick={() => {
                        intel.onConfig({ channels: [...intel.channels, c] });
                        setBuscaCanal("");
                      }}
                    >
                      {c}
                    </li>
                  ));
                })()}
              </ul>
            )}
          </div>
        </span>
      </div>

      {/* ★★ EL ARCHIVO. Idea de RoGiz7 (2026-09-08): hasta ahora Koru guardaba la CONCLUSIÓN de
          cada línea y tiraba la línea. Eso hacía que sus errores fueran permanentes —una línea que
          decía «Lucy Lee 1» quedó archivada como «Lucy Lee» y no había forma de rehacerla— y que
          todo el histórico dependiera de una carpeta de EVE que Koru no controla.

          Va DEBAJO de los canales a propósito: importa lo que esté marcado ahí arriba, así que la
          decisión de qué canales se guardan se toma justo antes de pulsar. */}
      <div className="tb-settings-item">
        <span className="tb-si-ic">🗄️</span>
        <span className="tb-si-tx">
          <strong>{tr("Archivo del intel")}</strong>
          <span className="small muted">
            {tr(
              "Koru guarda cada línea tal como se escribió. Sirve para rehacer los avistamientos cuando se mejora el lector, y para que tu histórico sobreviva a una limpieza de la carpeta de EVE.",
            )}
          </span>
          <div className="ovs-row">
            <span className="small">
              {archivo == null
                ? tr("contando…")
                : archivo[0] === 0
                  ? tr("todavía no hay nada guardado")
                  : `${archivo[0].toLocaleString()} ${tr("líneas")}${
                      archivo[1] ? ` · ${tr("desde")} ${new Date(archivo[1]).toLocaleDateString()}` : ""
                    }`}
            </span>
            <button onClick={importar} disabled={importando || !intel.folder || intel.channels.length === 0}>
              {importando ? tr("Importando…") : `📥 ${tr("Importar lo ya cantado")}`}
            </button>
          </div>
          {/* Se dice cuántas eran NUEVAS, no cuántas se leyeron: repetir la importación es inocuo
              (la clave las deduplica) y sin ese número la segunda pasada parecería no hacer nada. */}
          {resultado && <div className="small ovs-hallazgos">{resultado}</div>}
          {/* ★ REHACER LOS AVISTAMIENTOS. Esto es para lo que se guardan las líneas: cada mejora del
              lector alcanza también a lo ya guardado. Va debajo de la importación porque ese es el
              orden real — primero se tiene el material, después se reprocesa. */}
          {archivo != null && archivo[0] > 0 && (
            <div className="ovs-row" style={{ marginTop: "0.5rem" }}>
              {/* ★ CON UNA PASADA A MEDIAS, «Continuar» va PRIMERO y «Empezar de cero» al lado.
                  Reanudar en silencio sería tan malo como perder el trabajo: quien vuelve tiene
                  que ver que quedó algo a medias y decidir. */}
              {/* ⚠️ BLOQUEADOS MIENTRAS SE APRENDE, y no es cosmético. La reconstrucción carga los
                  veredictos de `name_cache` UNA vez, al empezar: si arranca mientras las preguntas
                  siguen en vuelo, se pierde todo lo que llegue después y hay que repetir 20 minutos.
                  Se lo advertí por escrito… y el botón le dejaba hacerlo igual. Un aviso que el
                  código no respalda no es una salvaguarda. */}
              {pendiente && pendiente.continuable && !rehaciendo && (
                <button onClick={continuar} disabled={importando || aprendiendo}>
                  ▶️ {tr("Continuar")} ({pendiente.pct} %)
                </button>
              )}
              <button onClick={rehacer} disabled={rehaciendo || importando || aprendiendo}>
                {rehaciendo
                  ? `${tr("Rehaciendo…")} ${progreso}%`
                  : pendiente && pendiente.continuable
                    ? `♻️ ${tr("Empezar de cero")}`
                    : `♻️ ${tr("Rehacer los avistamientos")}`}
              </button>
              <span className="small muted">
                {pendiente && !pendiente.continuable
                  ? tr(
                      "Quedó una pasada a medias, pero la hizo otra versión de Koru: se empieza de cero para no mezclar dos lectores distintos.",
                    )
                  : tr("Vuelve a leer todo lo guardado con el lector de hoy.")}
              </span>
            </div>
          )}
          {/* ★★ APRENDER NOMBRES. Va ANTES de rehacer en el orden lógico —primero se aprende, luego
              se reprocesa— pero se pinta debajo porque rehacer es lo que la gente busca. */}
          {archivo != null && archivo[0] > 0 && (
            <div className="ovs-row" style={{ marginTop: "0.5rem" }}>
              <button onClick={aprender} disabled={aprendiendo || rehaciendo || importando}>
                {aprendiendo ? progAprender : `🔤 ${tr("Aprender nombres en minúscula")}`}
              </button>
              <span className="small muted">
                {tr(
                  "Mucha gente escribe los nombres en minúscula y Koru los tiraba. Esto recorre lo guardado y pregunta UNA vez por cada uno; la respuesta se queda para siempre.",
                )}
              </span>
            </div>
          )}
          {/* ★★ LO QUE ACABA DE APRENDERSE, TERMINANDO EN UN BOTÓN. Ver `veredictosNuevos`.
              Antes esto era una frase que te pedía RECORDAR el orden; ahora el orden lo lleva la
              pantalla. Y solo sale si de verdad hay algo que reprocesar: rehacer son ~20 minutos. */}
          {veredictosNuevos != null && !aprendiendo && !rehaciendo && (
            <div className="ovs-row" style={{ marginTop: "0.5rem" }}>
              {veredictosNuevos > 0 ? (
                <>
                  <button onClick={() => { setVeredictosNuevos(null); void rehacer(); }}>
                    ♻️ {tr("Rehacer los avistamientos")}
                  </button>
                  <span className="small">
                    {`${veredictosNuevos.toLocaleString()} ${tr("veredictos nuevos. Para que entren en tus avistamientos hay que releer lo guardado; tarda un rato.")}`}
                  </span>
                </>
              ) : (
                <span className="small muted">
                  {tr("Nada nuevo que aprender: no hace falta rehacer los avistamientos.")}
                </span>
              )}
            </div>
          )}
          {intel.channels.length === 0 && (
            <div className="small muted">{tr("Marca antes los canales que quieres archivar.")}</div>
          )}
        </span>
      </div>

      <div className="tb-settings-item">
        <span className="tb-si-ic">⏱️</span>
        <span className="tb-si-tx">
          <strong>{tr("Cuánto vive un avistamiento")}</strong>
          <span className="small muted">
            {tr("Recencia: qué se considera «pasando ahora». Rastro: cuánto queda pintado en el mapa.")}
          </span>
          <div className="ovs-row">
            <label className="ovs-num">
              <span className="muted small">{tr("Recencia (min)")}</span>
              <input
                type="number"
                min={1}
                max={180}
                value={intel.recency}
                onChange={(e) => intel.onConfig({ recency: Math.max(1, Number(e.target.value)) })}
              />
            </label>
            <label className="ovs-num">
              <span className="muted small">{tr("Rastro (min)")}</span>
              <input
                type="number"
                min={0}
                max={720}
                value={intel.trailMin}
                title={tr("Antigüedad máxima de un avistamiento en el rastro. 0 = sin límite.")}
                onChange={(e) => intel.onConfig({ trailMin: Math.max(0, Number(e.target.value)) })}
              />
            </label>
          </div>
        </span>
      </div>

      <div className="tb-settings-item">
        <span className="tb-si-ic">🔊</span>
        <span className="tb-si-tx">
          <strong>{tr("Sonido al detectar algo cerca")}</strong>
          <span className="small muted">
            {tr("Suena solo cuando el aviso entra en tu umbral de saltos.")}
          </span>
          <div className="ovs-row">
            <label className="ovs-chk">
              <input
                type="checkbox"
                checked={intel.sound}
                onChange={(e) => {
                  if (e.target.checked) beep(); // gesto del usuario → desbloquea el audio
                  intel.onConfig({ sound: e.target.checked });
                }}
              />
              {tr("Activado")}
            </label>
            <select
              value={intel.soundChoice}
              disabled={!intel.sound}
              onChange={(e) => {
                if (e.target.value === "custom" && !intel.soundFile) {
                  intel.onPickSound();
                } else {
                  intel.onConfig({ soundChoice: e.target.value });
                }
              }}
            >
              {ALERT_SOUNDS.map((s) => (
                <option key={s.key} value={s.key}>
                  {tr(s.label)}
                </option>
              ))}
            </select>
            <button disabled={!intel.sound} onClick={() => playAlertChoice(intel.soundChoice)}>
              {tr("Probar")}
            </button>
          </div>
          {intel.soundChoice === "custom" && (
            <div className="ovs-row">
              <span className="ovs-path" title={intel.soundFile}>
                {intel.soundFile ? intel.soundFile.split(/[\\/]/).pop() : tr("(ningún archivo)")}
              </span>
              <button onClick={intel.onPickSound}>{tr("Elegir…")}</button>
            </div>
          )}
        </span>
      </div>
    </>
  );
}

type OverlayDebug = {
  exists: boolean;
  visible: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
  on_screen: boolean;
  monitors: MonitorInfo[];
};

type MonitorInfo = {
  index: number;
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  is_primary: boolean;
};

/** Posiciones posibles, en orden de lectura (arriba de izquierda a derecha, luego abajo).
 *  El centro lo pidió RoGiz7: arriba en medio queda sobre una zona del HUD de EVE que casi siempre
 *  está despejada, así que es buen sitio para un aviso. */
const ESQUINAS = [
  { k: "tl", label: "Arriba izquierda" },
  { k: "tc", label: "Arriba centro" },
  { k: "tr", label: "Arriba derecha" },
  { k: "bl", label: "Abajo izquierda" },
  { k: "bc", label: "Abajo centro" },
  { k: "br", label: "Abajo derecha" },
] as const;

export function OverlaySettings() {
  /** ¿Lo movió a mano? Entonces las esquinas no mandan, y hay que poder volver atrás: si no, un
   *  arrastre accidental deja los controles de Ajustes muertos para siempre y sin explicación. */
  const [libre, setLibre] = useState(() => localStorage.getItem("koru-overlay-libre"));
  const [on, setOn] = useState(() => localStorage.getItem("koru-overlay") === "1");
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [mon, setMon] = useState(() => Number(localStorage.getItem("koru-overlay-mon") ?? 0));
  const [corner, setCorner] = useState(() => localStorage.getItem("koru-overlay-corner") ?? "tr");
  const [margin, setMargin] = useState(() => Number(localStorage.getItem("koru-overlay-margin") ?? 24));
  const [dbg, setDbg] = useState<OverlayDebug | null>(null);
  const [vida, setVida] = useState(() => Number(localStorage.getItem("koru-overlay-vida") ?? 20));

  useEffect(() => {
    invoke<MonitorInfo[]>("overlay_monitors").then(setMonitors).catch(() => setMonitors([]));
  }, []);

  /** Guarda y aplica de golpe: la posición se ve al instante con el botón de prueba. */
  const aplicar = (m = mon, c = corner, g = margin) => {
    localStorage.setItem("koru-overlay-mon", String(m));
    localStorage.setItem("koru-overlay-corner", c);
    localStorage.setItem("koru-overlay-margin", String(g));
    void invoke("overlay_place", { monitor: m, corner: c, margin: g }).catch(() => {});
  };

  /** Encender CREA la ventana; apagar la DESTRUYE. No basta con esconderla: una webview oculta
   *  cuesta memoria igual, y esta función viene apagada de fábrica. */
  const encender = (v: boolean) =>
    void invoke("overlay_enable", { enabled: v, monitor: mon, corner, margin }).catch(() => {});

  return (
    <>
      <div className="tb-settings-title small muted">{tr("Avisos sobre el juego")}</div>
      {libre && (
        <div className="tb-settings-item">
          <span className="tb-si-ic">✋</span>
          <span className="tb-si-tx">
            <strong>{tr("El aviso está colocado a mano")}</strong>
            <span className="small muted">
              {tr("Lo arrastraste a un sitio concreto, así que el monitor y la esquina de abajo no se aplican.")}
            </span>
            <div className="ovs-row">
              <button
                onClick={() => {
                  localStorage.removeItem("koru-overlay-libre");
                  setLibre(null);
                  void invoke("overlay_pos_libre", { x: null, y: null }).catch(() => {});
                  aplicar();
                }}
              >
                {tr("Volver a la esquina")}
              </button>
            </div>
          </span>
        </div>
      )}

      <label className="tb-settings-item" style={{ cursor: "pointer" }}>
        <span className="tb-si-ic">🔔</span>
        <span className="tb-si-tx">
          <strong>{tr("Mostrar los avisos flotando sobre el juego")}</strong>
          <span className="small muted">
            {tr(
              "Una ventanita sin bordes en la esquina que elijas. Al pulsarla, Koru se pone delante y abre el mapa en ese sistema.",
            )}
          </span>
        </span>
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            const v = e.target.checked;
            setOn(v);
            localStorage.setItem("koru-overlay", v ? "1" : "0");
            // localStorage no notifica a nadie dentro de la MISMA ventana (el evento `storage` solo
            // salta entre pestañas). Sin este aviso, el vigilante de Rust seguiría con el valor
            // viejo hasta que cambiara cualquier otra cosa del intel: el interruptor "no haría nada"
            // durante un rato, que es la peor clase de fallo.
            window.dispatchEvent(new Event("koru-overlay-changed"));
            encender(v);
          }}
        />
      </label>

      {on && (
        <>
          {/* Elegir monitor y esquina, en vez de perseguir la ventana de EVE. Con multibox hay
              varios clientes y rastrearlos es frágil: cambian de tamaño, se minimizan, cambian de
              pantalla. Que el jugador señale un hueco libre no se rompe nunca. */}
          <div className="tb-settings-item">
            <span className="tb-si-ic">🖥️</span>
            <span className="tb-si-tx">
              <strong>{tr("Dónde aparece")}</strong>
              <span className="small muted">
                {tr("Elige un hueco que no te tape nada del juego.")}
              </span>
              <div className="ovs-row">
                <select
                  value={mon}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setMon(v);
                    aplicar(v);
                  }}
                >
                  {monitors.length === 0 && <option value={0}>{tr("Monitor principal")}</option>}
                  {monitors.map((m) => (
                    <option key={m.index} value={m.index}>
                      {m.index + 1}. {m.width}×{m.height}
                      {m.is_primary ? ` · ${tr("principal")}` : ""}
                    </option>
                  ))}
                </select>
                <select
                  value={corner}
                  onChange={(e) => {
                    setCorner(e.target.value);
                    aplicar(mon, e.target.value);
                  }}
                >
                  {ESQUINAS.map((c) => (
                    <option key={c.k} value={c.k}>
                      {tr(c.label)}
                    </option>
                  ))}
                </select>
                <label className="small muted ovs-margin">
                  {tr("Margen")}
                  <input
                    type="number"
                    min={0}
                    max={400}
                    value={margin}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setMargin(v);
                      aplicar(mon, corner, v);
                    }}
                  />
                </label>
              </div>
            </span>
          </div>

          {/* Duración. «Hasta cerrarlo» es seguro porque el aviso lleva la EDAD en vivo: un intel
              fijo de hace diez minutos ya no es información, es ruido peligroso, y sin la edad no
              habría forma de notarlo. */}
          <div className="tb-settings-item">
            <span className="tb-si-ic">⏱️</span>
            <span className="tb-si-tx">
              <strong>{tr("Cuánto dura en pantalla")}</strong>
              <span className="small muted">
                {tr("El aviso enseña siempre cuánto tiempo hace que se cantó, así que no engaña por mucho que dure.")}
              </span>
              <div className="ovs-row">
                <select
                  value={vida}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setVida(v);
                    localStorage.setItem("koru-overlay-vida", String(v));
                  }}
                >
                  <option value={12}>12 {tr("segundos")}</option>
                  <option value={20}>20 {tr("segundos")}</option>
                  <option value={45}>45 {tr("segundos")}</option>
                  <option value={90}>90 {tr("segundos")}</option>
                  <option value={0}>{tr("Hasta que lo cierre o lo pulse")}</option>
                </select>
              </div>
            </span>
          </div>

          {/* Sin esto, colocar la ventana sería imposible salvo esperando a que aparezca un hostil. */}
          <button
            className="tb-settings-item"
            onClick={() => {
              // Se asegura la ventana ANTES de probar: ahora se crea bajo demanda y su construcción
              // se encola en el hilo principal, así que justo tras encender puede no existir todavía.
              // Sin esto, el primer clic al botón de prueba no haría nada y parecería roto.
              encender(true);
              // Los textos del aviso de prueba se mandan YA TRADUCIDOS: el diccionario vive aquí,
              // en el frontend, y el Rust no tiene forma de saber en qué idioma está la app.
              window.setTimeout(
                () =>
                  void invoke("overlay_test", {
                    mensaje: tr("Aviso de prueba: así se verá el intel sobre el juego."),
                    alt: tr("Alt de prueba"),
                    hostil: tr("Piloto de prueba"),
                  }).catch(() => {}),
                220,
              );
              // La radiografía se pide DESPUÉS de mostrar, para leer el estado real ya visible.
              window.setTimeout(() => {
                invoke<OverlayDebug>("overlay_debug").then(setDbg).catch(() => setDbg(null));
              }, 600);
            }}
          >
            <span className="tb-si-ic">👁️</span>
            <span className="tb-si-tx">
              <strong>{tr("Ver un aviso de prueba")}</strong>
              <span className="small muted">
                {tr("Lanza uno de mentira para colocarlo sin esperar a que salte de verdad.")}
              </span>
            </span>
          </button>

          {/* Radiografía de la ventana. Una ventana transparente y sin bordes que no se ve puede ser
              cuatro cosas distintas —no existe, está fuera de pantalla, está detrás, o existe y no
              pinta— y a ojo las cuatro son idénticas: nada. Esto las separa. */}
          {dbg && (
            <div className="small muted ovs-dbg">
              {!dbg.exists ? (
                <b className="bad">{tr("La ventana del aviso no existe. Es un problema de configuración, no de pintado.")}</b>
              ) : !dbg.on_screen ? (
                <b className="bad">
                  {tr("La ventana existe pero está FUERA de la pantalla")} — {dbg.x},{dbg.y} · {dbg.w}×{dbg.h}
                </b>
              ) : !dbg.visible ? (
                <b className="bad">{tr("La ventana existe y está colocada, pero oculta.")}</b>
              ) : (
                <span>
                  {tr("La ventana está visible y en pantalla")} — {dbg.x},{dbg.y} · {dbg.w}×{dbg.h} ·{" "}
                  {tr("escala")} {dbg.scale}×.{" "}
                  {tr("Si aun así no la ves, el problema es el pintado (transparencia).")}
                </span>
              )}
              <div>
                {dbg.monitors.length} {tr("monitores")}:{" "}
                {dbg.monitors.map((m) => `${m.width}×${m.height} @${m.x},${m.y}`).join(" · ")}
              </div>
            </div>
          )}

          <div className="tb-settings-title small muted" style={{ marginTop: ".6rem" }}>
            {tr("Qué avisos salen aquí")}
          </div>
          <div className="tb-settings-item">
            <span className="tb-si-ic">📡</span>
            <span className="tb-si-tx">
              <strong>{tr("Intel de proximidad")}</strong>
              <span className="small muted">
                {tr(
                  "De momento el único. El criterio: solo sale aquí lo que te haría actuar en los próximos segundos — lo demás (planetología, logros, trabajos) vive en la app, que son cosas de cuando atracas.",
                )}
              </span>
            </span>
          </div>

          <div className="small muted" style={{ padding: "0 .2rem .4rem" }}>
            {tr(
              "Si juegas en pantalla completa exclusiva no se verá: EVE tapa cualquier ventana. Cambia a ventana o ventana sin bordes.",
            )}
          </div>
        </>
      )}
    </>
  );
}
