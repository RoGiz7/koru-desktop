// Estado y efectos propios de la capa de Intel en vivo, encapsulados en un hook. NO gestiona la
// selección compartida del mapa (`selected`/`intelDetail`) ni `openIntelDetail`, que se quedan en
// MapView; este hook los RECIBE. Cubre: ficha de detalle (entidades), panel de config, alertas
// (banner + sonido, escuchando el evento "intel-alert" del hilo de Rust), arranque/parada del
// watcher, envío del grafo a Rust y registro de avistamientos (hostiles habituales).
// Los efectos se movieron VERBATIM desde map.tsx con sus mismas dependencias → comportamiento igual.
import { useState, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { tr } from "./i18n";
import { ensureNotifPerm, playAlertChoice, loadCustomSound } from "./sound";
import { classifyIntel } from "./intel";
import type { IntelRep, IntelFeedRow } from "./intel";
import type { Geo } from "./mapOverlays";
import type { MapOverlay } from "./constants";
import type { IntelConfig, NewEden, CharLoc } from "./types";

export type IntelDetail = {
  sysId: number | null;
  sysName: string | null;
  ts: number;
  author: string;
  message: string;
} | null;

type IntelReports = { rep: Map<number, IntelRep>; feed: IntelFeedRow[] } | null;

export function useIntel({
  geo,
  ne,
  intel,
  overlay,
  intelDetail,
  shipNames,
  noExisten,
  existen,
  alias,
  intelReports,
  intelOrigins,
  charLocations,
}: {
  geo: Geo | null;
  ne: NewEden | null;
  intel?: IntelConfig;
  overlay: MapOverlay;
  intelDetail: IntelDetail;
  shipNames: Map<string, number>;
  /** Nombres que ESI dijo que no existen — ver `classifyIntel`. Sin esto, `WH` o `YPW` seguirían
   *  saliendo como hostiles en la tarjeta y en el aviso. */
  noExisten?: Set<string>;
  /** Y los que ESI SÍ confirmó, para aceptar un piloto en minúscula que vaya en posición de
   *  reporte. Si no llega, el troceador se comporta igual que antes. Ver `classifyIntel`. */
  existen?: Set<string>;
  /** Las correcciones a mano del piloto — ver `classifyIntel`. Viaja con los otros tres
   *  catálogos: si llegara a unos sitios y a otros no, la tarjeta y el feed dirían cosas
   *  distintas de la misma línea, que es el fallo de las DOS VERDADES ya documentado. */
  alias?: Map<string, string>;
  intelReports: IntelReports;
  intelOrigins: number[];
  /** Dónde está y en qué vuela cada personaje tuyo. Se manda a Rust para que el aviso pueda decir
   *  «a 3 saltos de Vera, en Venture» en vez de solo «a 3 saltos». Ver overlay.tsx. */
  charLocations?: CharLoc[];
}) {
  const [intelEntities, setIntelEntities] = useState<{
    characters: { id: number; name: string }[];
    ships: { id: number; name: string }[];
  } | null>(null);
  const [intelEntLoading, setIntelEntLoading] = useState(false);
  const [intelTrackPilot, setIntelTrackPilot] = useState<string | null>(null);
  const [chanOpen, setChanOpen] = useState(false);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [anchorInput, setAnchorInput] = useState("");
  const [intelAlert, setIntelAlert] = useState<{
    text: string;
    /// Reportes ADICIONALES llegados con el banner visible (el "+N más" del texto).
    extra: number;
    /// Saltos del titular vigente: el más CERCANO manda; el resto solo engorda el +N.
    jumps: number;
    report: { sysId: number; sysName: string; ts: number; author: string; message: string };
  } | null>(null);
  // Espejo del banner para leerlo dentro del listener sin side-effects en el updater (y para
  // que un cierre manual desde el mapa (setIntelAlert(null)) también resetee el contador).
  const intelAlertRef = useRef<typeof intelAlert>(null);
  useEffect(() => {
    intelAlertRef.current = intelAlert;
  }, [intelAlert]);
  const intelAlertTimer = useRef<number | null>(null);
  /** ★★ LOS CATÁLOGOS, EN UN ESPEJO. Idea suya, y hace falta por una trampa de React: el `listen`
   *  de «intel-alert» se registra UNA vez y su clausura se queda con los valores del primer render
   *  —cuando `geo` todavía es `null`—. Sin este espejo, el troceo de abajo se haría siempre con un
   *  catálogo vacío y el overlay nunca mejoraría. Compilando en verde, además. */
  const catalogosRef = useRef({ geo, shipNames, noExisten, existen, alias });
  useEffect(() => {
    catalogosRef.current = { geo, shipNames, noExisten, existen, alias };
  }, [geo, shipNames, noExisten, existen, alias]);

  // Nº de hostiles del reporte abierto (del +N o, si no, de los pilotos listados) → flota vs solo.
  const intelDetailCount = useMemo(() => {
    if (!intelDetail || !geo) return null;
    const p = classifyIntel(intelDetail.message, geo.nameIdx, shipNames, noExisten, geo.zonaIdx, existen, alias);
    return p.count ?? (p.pilots.length || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intelDetail, shipNames, noExisten, existen]);

  // Abrir la config automáticamente si la capa intel está activa y aún no hay canales elegidos.
  // Y pedir permiso de notificación al entrar (para que el SO pregunte en buen momento).
  useEffect(() => {
    if (overlay === "intel" && intel) {
      if (intel.channels.length === 0) setCfgOpen(true);
      void ensureNotifPerm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay]);

  // Resuelve entidades al abrir la tarjeta. Naves = clasificación LOCAL (SDE), pilotos = ESI
  // solo sobre los candidatos limpios (sin naves ni jerga) → ya no salen Eris/ansi/near como pilotos.
  useEffect(() => {
    if (!intelDetail || !geo) return;
    const p = classifyIntel(intelDetail.message, geo.nameIdx, shipNames, noExisten, geo.zonaIdx, existen, alias);
    // naves locales, deduplicadas por type_id
    const shipMap = new Map<number, string>();
    for (const s of p.ships) shipMap.set(s.id, s.name);
    const ships = [...shipMap].map(([id, name]) => ({ id, name }));
    const pilots = [...new Set(p.pilots)];
    // ★★ LAS DOS LECTURAS DE UN NOMBRE PARTIDO POR UN SISTEMA (ver `pilotAlts` en intel.ts).
    //
    // `X-ABCD Dee Yona vector-Z` daba el piloto «Dee» porque **«Yona» es un sistema de verdad**
    // (Essence, highsec, a 23 saltos de X-ABCD) y cortaba el nombre. Y «Dee» resuelve a otra
    // persona: el aviso enlazaba al killboard equivocado — lo reportó Sir Rayl.
    //
    // No se elige aquí: se mandan las DOS y **decide quien puede comprobarlo**, que es el índice
    // local y, si no lo sabe, ESI. No cuesta ninguna petición extra: los desconocidos ya iban en
    // la misma llamada en lote.
    const largos = p.pilotAlts.map((a) => a.largo);
    if (pilots.length === 0 && largos.length === 0) {
      setIntelEntities({ characters: [], ships });
      return;
    }
    setIntelEntLoading(true);
    invoke<{ characters: { id: number; name: string }[] }>("resolve_intel_entities", {
      names: [...new Set([...pilots, ...largos])],
    })
      .then((e) => {
        // Si la lectura LARGA existe, gana y la corta desaparece: «Dee Yona» y «Dee» no son dos
        // hostiles, son una lectura buena y otra mala del mismo. Si NO existe, no se toca nada y
        // todo se queda exactamente como estaba.
        const resueltos = new Set(e.characters.map((c) => c.name.toLowerCase()));
        const fuera = new Set(
          p.pilotAlts
            .filter((a) => resueltos.has(a.largo.toLowerCase()))
            .map((a) => a.corto.toLowerCase()),
        );
        const characters = e.characters.filter((c) => !fuera.has(c.name.toLowerCase()));
        setIntelEntities({ characters, ships });
      })
      .catch(() => setIntelEntities({ characters: [], ships }))
      .finally(() => setIntelEntLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intelDetail, shipNames, noExisten, existen]);

  // --- Intel: aprender "hostiles habituales" ---
  // Cada línea NUEVA aporta sus pilotos al índice (seen_count++ en backend). Dedup por clave de
  // línea (ts+autor+msg) para no recontar la misma línea en cada poll. El backend auto-resuelve por
  // ESI a quien cruce el umbral (cazador habitual que no está en Rivales/killmails).
  const intelSightedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!intelReports) return;
    const fresh: {
      name: string;
      system_id: number | null;
      ts_ms: number;
      ship_type_id: number | null;
    }[] = [];
    for (const f of intelReports.feed) {
      if (!f.pilots || f.pilots.length === 0) continue;
      const key = `${f.ts}|${f.author}|${f.message}`;
      if (intelSightedRef.current.has(key)) continue;
      intelSightedRef.current.add(key);
      // Solo atribuimos nave si la línea tiene UN único piloto (si no, no se sabe de quién es).
      const shipId = f.pilots.length === 1 && f.ships.length >= 1 ? f.ships[0].id : null;
      for (const name of f.pilots)
        fresh.push({ name, system_id: f.sysId, ts_ms: f.ts, ship_type_id: shipId });
    }
    if (fresh.length === 0) return;
    // Acotar el set para no crecer sin fin (las claves viejas caen fuera de recencia igualmente).
    if (intelSightedRef.current.size > 4000) {
      intelSightedRef.current = new Set(
        [...intelSightedRef.current].slice(-2000),
      );
    }
    invoke("intel_record_sightings", { sightings: fresh, threshold: 5 }).catch(
      () => {},
    );
  }, [intelReports]);

  // `clr/clear` = "olvídate de la alerta": si el sistema del banner deja de estar en los reportes
  // (alguien lo limpió), descartamos el aviso, no solo el círculo del mapa.
  useEffect(() => {
    if (!intelAlert || !intelReports) return;
    const sid = intelAlert.report.sysId;
    if (sid != null && !intelReports.rep.has(sid)) {
      setIntelAlert(null);
      intel?.onClearAlert?.();
    }
  }, [intelReports, intelAlert]);

  // Enviar el grafo (nombres↔id + aristas) a Rust una vez, en cuanto haya datos del mapa.
  useEffect(() => {
    if (!geo || !ne) return;
    // Se manda el nombre BIEN ESCRITO (`s.n`), no la clave de `nameIdx`, que está en minúsculas
    // porque su oficio es parsear el chat. Rust construye su `name_to_id` con `.to_lowercase()`,
    // así que el matching no se entera del cambio; el que sí se entera es `id_to_name`, que es de
    // donde salen los nombres que LEE el jugador.
    //
    // Llevaba mal desde siempre y no se veía: el único consumidor era el título de la tarjeta, y
    // `.ov-sys` lo pone en mayúsculas por CSS. Salió a la luz al nombrar el ancla en el aviso
    // («de ttp-2b») y afecta también al título de la notificación del sistema.
    const names: [string, number][] = [...geo.nameIdx.values()].map((s) => [s.n, s.id]);
    const edges: [number, number][] = ne.jumps as [number, number][];
    // La REGIÓN de cada sistema. Se manda aquí porque esta ventana ya tiene New Eden cargado y el
    // overlay no puede permitirse ese megabyte — es una ventana que vive sobre el juego.
    // La usa para que un renglón de otra región diga de dónde viene: con dos canales de intel, dos
    // avisos lejanos entre sí no son la misma pelea. Ver `IntelGraph::id_to_region`.
    const reg = new Map(ne.regions.map((r) => [r.id, r.n] as const));
    const regions: [number, string][] = [...geo.nameIdx.values()].flatMap((s) => {
      const n = reg.get(s.r);
      return n ? ([[s.id, n]] as [number, string][]) : [];
    });
    invoke("set_intel_graph", { names, edges, regions }).catch(() => {});
  }, [geo, ne]);

  // Interruptor del aviso flotante. Se guarda en localStorage (es preferencia de UI, no dato), pero
  // hace falta ESTADO para que el efecto de abajo se vuelva a lanzar al cambiarlo. Ver el
  // dispatchEvent de overlaySettings.tsx.
  const [overlayOn, setOverlayOn] = useState(() => localStorage.getItem("koru-overlay") === "1");
  useEffect(() => {
    const h = () => setOverlayOn(localStorage.getItem("koru-overlay") === "1");
    window.addEventListener("koru-overlay-changed", h);
    return () => window.removeEventListener("koru-overlay-changed", h);
  }, []);

  // Arrancar / reconfigurar / detener el vigilante de Rust según la capa y la config.
  useEffect(() => {
    // Corre si el interruptor "Intel en vivo" está ON, o si estás viendo la capa intel (back-compat).
    const shouldRun = !!intel && (intel.live || overlay === "intel");
    if (!shouldRun || !intel.folder || intel.channels.length === 0) {
      invoke("stop_intel_watch").catch(() => {});
      return;
    }
    invoke("start_intel_watch", {
      folder: intel.folder,
      channels: intel.channels,
      recencyMinutes: intel.recency,
      origins: intelOrigins,
      // Las anclas van TAMBIÉN sueltas, aunque `origins` ya las lleve dentro: mezcladas no se
      // pueden nombrar, y el aviso necesita poder decir «de 88a-ra» cuando no hay ningún piloto
      // cerca. Antes en ese caso salía un número sin dueño.
      anchors: intel.anchors,
      // Sistemas silenciados. Rust compara `until_ms` con su propio reloj, así que un silencio
      // temporal caduca aunque no se vuelva a reconfigurar el vigilante.
      muted: intel.muted ?? [],
      alertJumps: intel.alertJumps,
      // ALERTAS (sonido/banner/notificación) SOLO con el interruptor maestro ON. Con OFF el vigilante
      // sigue leyendo (feed/puntos en la capa intel), pero NO alerta. Fix del "OFF sigue sonando".
      alertsEnabled: intel.live,
      // Contexto de companion para el overlay: quién tuyo está cerca y en qué nave va.
      pilots: (charLocations ?? []).map((c) => ({
        name: c.name,
        system_id: c.system_id,
        ship: c.ship ?? null,
        ship_type_id: c.ship_type_id ?? null,
      })),
      // Interruptor propio del aviso flotante. Apagado de fábrica y aparte del maestro: hay quien
      // quiere sonido sin ventanita encima del juego, y al revés.
      overlayEnabled: overlayOn,
    }).catch(() => {});
    return () => {
      // Solo paramos al desmontar/recambiar si NO está el modo en vivo (si está ON, sigue corriendo).
      if (!intel?.live) invoke("stop_intel_watch").catch(() => {});
    };
  }, [overlay, intel?.live, intel?.folder, intel?.channels, intel?.recency, intel?.alertJumps, intel?.anchors, intel?.muted, intelOrigins, charLocations, overlayOn]);

  // Escuchar las alertas que emite el hilo de Rust → banner + sonido (la notificación nativa
  // ya la lanza Rust, así que aquí NO la repetimos).
  //
  // "+N más": si llegan varios reportes con el banner visible, NO se pisan — el titular es el
  // más CERCANO en saltos (una alerta a 2 saltos no la tapa ruido a 9) y el resto se cuenta.
  // El timer se RENUEVA con cada reporte (antes, el timer del primero cerraba antes de tiempo
  // los banners que lo sustituían). El contador se resetea al cerrar el banner (timeout, clr o
  // clic), porque el espejo intelAlertRef sigue al estado.
  useEffect(() => {
    const un = listen<{
      sys_id: number;
      system: string;
      jumps: number;
      author: string;
      message: string;
      ts_ms: number;
    }>("intel-alert", (e) => {
      const a = e.payload;
      const prev = intelAlertRef.current;
      const extra = prev ? prev.extra + 1 : 0;
      const lead =
        !prev || a.jumps <= prev.jumps
          ? {
              jumps: a.jumps,
              report: { sysId: a.sys_id, sysName: a.system, ts: a.ts_ms, author: a.author, message: a.message },
            }
          : { jumps: prev.jumps, report: prev.report };
      const text =
        `⚠ ${tr("Intel a")} ${lead.jumps} ${tr("salto(s)")}: ${lead.report.sysName} — ${lead.report.author}` +
        (extra > 0 ? ` · +${extra} ${tr("más")}` : "");
      const next = { text, extra, jumps: lead.jumps, report: lead.report };
      intelAlertRef.current = next;
      setIntelAlert(next);
      // ★★ EL OVERLAY NO TIENE POR QUÉ TROCEAR: QUE CONSUMA LO QUE EL MAPA YA TIENE (idea suya).
      //
      //  Caso real suyo, en la misma línea y a la vez: el mapa decía **«ACG JITA»** con su retrato y
      //  el overlay **«ACG»** con un interrogante. El troceador de Rust no sabe de `name_cache`, ni
      //  de apodos de nave, ni de las dos lecturas de un nombre partido — le faltan los quince
      //  mecanismos que se le han ido añadiendo al de la app.
      //
      //  Mi plan era cargar `neweden.json` (1 MB) en la ventana del overlay para que troceara por su
      //  cuenta. **Él propuso lo correcto**: eso son DOS sitios haciendo el mismo trabajo, que es
      //  justo lo que estamos arreglando. Aquí ya está troceado; solo hay que mandarlo.
      //  Queda consistente POR CONSTRUCCIÓN: no puede volver a haber dos respuestas, es el mismo dato.
      //
      //  ⚠️ NO retrasa la alarma ni depende de esto: el overlay pinta primero lo de Rust y se mejora
      //  al llegar esto. Si esta ventana está dormida o el evento no llega, se queda EXACTAMENTE
      //  como hoy. Nunca peor.
      //
      //  ⚠️ Va sin `character_id`: el retrato lo resuelve Rust sobre el nombre que él sacó, y aquí
      //  el nombre puede ser otro (más largo y correcto). Mejor el nombre bueno sin cara que la cara
      //  de un nombre a medias.
      const cat = catalogosRef.current;
      if (cat.geo) {
        try {
          const p = classifyIntel(
            a.message, cat.geo.nameIdx, cat.shipNames, cat.noExisten, cat.geo.zonaIdx, cat.existen, cat.alias,
          );
          void emit("intel-parse", {
            key: `${a.sys_id}-${a.ts_ms}`,
            hostiles: p.pilots.map((n) => ({ name: n, character_id: null })),
            ships: p.ships.map((s) => ({ type_id: s.id, name: s.name })),
            count: p.count,
          });
        } catch {
          /* el aviso ya está dado: que el overlay se quede con lo de Rust es un final aceptable */
        }
      }
      intel?.onIntelAlert?.(text); // toast global (visible en cualquier sección)
      if (intel?.sound) playAlertChoice(intel.soundChoice);
      if (intelAlertTimer.current) window.clearTimeout(intelAlertTimer.current);
      intelAlertTimer.current = window.setTimeout(() => setIntelAlert(null), 12000);
    });
    return () => {
      un.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intel?.sound, intel?.soundChoice]);

  // Cargar el sonido personalizado cuando se elige/ cambia el archivo.
  useEffect(() => {
    if (intel?.soundChoice === "custom" && intel?.soundFile) {
      void loadCustomSound(intel.soundFile);
    }
  }, [intel?.soundChoice, intel?.soundFile]);

  return {
    intelEntities,
    setIntelEntities,
    intelEntLoading,
    intelTrackPilot,
    setIntelTrackPilot,
    chanOpen,
    setChanOpen,
    cfgOpen,
    setCfgOpen,
    anchorInput,
    setAnchorInput,
    intelDetailCount,
    intelAlert,
    setIntelAlert,
  };
}
