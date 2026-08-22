import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { fmtAgo, fmtIsk, fmtSp, fmtMin, fmtCompact, secColor, ownerColor, heatColor, typeIcon } from "./format";
import { OverlayIcon, maxOf } from "./charts";
import { findRoute, proximityBFS, type RouteMode } from "./mapRoute";
import { renderBackdrop, renderSov, renderFw, renderStandings, renderAgents, renderCorps, renderIncursions, renderThera, renderSignatures, MapScaleLegend, MapTrailLegend, scaleFor } from "./mapOverlays";
import type { SignatureSummary, SignatureRow } from "./signatures";
import { computeJumpFuel, computeJumpFatEst, computeJumpReach } from "./jumpCalc";
import { useJumpPlanner } from "./useJumpPlanner";
import { useRoutePlanner } from "./useRoutePlanner";
import { useHuntTrack } from "./useHuntTrack";
import { useIntel } from "./useIntel";
import { buildIntelReports, pilotTrack } from "./intel";
import { loadNewEden } from "./neweden";
import { galon, loadShipNames, type Roster, type OpPlayback } from "./flotas";
import { edgeKey, ANSIBLEX_TYPE_ID, type AnsiblexRow } from "./ansiblex";
import { OVERLAYS, OVERLAY_CATS, SUBFILTERS, FW_FACTIONS, POIS } from "./constants";
import type { MapOverlay, Tab } from "./constants";
import { openExternal } from "./openExternal";
import { NotasAncla } from "./notas";
import type {
  IntelConfig,
  SysActivity,
  SovSystem,
  FwSystem,
  PiSystem,
  Incursion,
  WhConn,
  CharLoc,
  Character,
  NewEden,
  NeSystem,
  SystemKills,
  SystemJumps,
  JumpShip,
  RouteStop,
  Trip,
} from "./types";

const MAP_W = 1000;
const MAP_H = 760;
const MAP_PAD = 16;
// Icono real del Ansiblex (SDE type 35841) para el badge de «vía puente», en vez del emoji 🌉.
const ANSI_ICON = typeIcon(ANSIBLEX_TYPE_ID, 32);

// Hubs de wormhole (eve-scout). Turnur ES un sistema real de k-space (está en neweden.json con su
// posición). Thera es J-space y NO está en neweden → nodo SINTÉTICO: se le da una posición (el
// centroide de sus conexiones) solo para poder dibujarlo y rutar a través de él.
const THERA_ID = 31000005;
const TURNUR_ID = 30002086;

/** Arco de un Ansiblex entre dos puntos ya proyectados. Curvo, no recto: un puente une sistemas
 *  LEJANOS y la recta cruzaría media región confundiéndose con la maraña de stargates. El punto de
 *  control se aparta de la mitad en perpendicular (−dy, dx) un BOW del largo, así la comba sale
 *  proporcional. Se pasa SIEMPRE el par en orden canónico (id menor primero) para que el mismo
 *  puente combe igual lo dibujemos desde la red o desde la ruta. */
const ANSI_BOW = 0.12;

/* Rastros del modo Intel. Dos colores con significado fijo, los mismos que los botones:
 *   INTERCEPT (rojo)  = a quién persigues AHORA.   HUNT (morado) = a quién tienes en seguimiento.
 * TRACK_DOT es la clave para que el mapa siga siendo legible: el punto del rastro va a la MITAD del
 * de una alerta (1,3) porque cae en el mismo sistema que un aviso y, siendo igual o mayor, lo tapaba
 * — perdías un aviso NUEVO de otro piloto justo donde más miras. */
const INTERCEPT = "#ff5c5c";
const INTERCEPT_DIM = "#c9383d";
const HUNT = "#ff6ad5";
const TRACK_DOT = 0.9;

/** Antigüedad compacta para las etiquetas del rastro: 45s · 12min · 2h10.
 *  Sin `tr()` a propósito: «s», «min» y «h» se escriben igual en los dos idiomas, así que la
 *  etiqueta no añade claves al diccionario (que ya ronda las 1.360 y donde los choques rompen el
 *  build). */
function fmtAge(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest > 0 ? `${h}h${rest}` : `${h}h`;
}

/** Radio en unidades de mundo que DEJA DE CRECER al llegar a `capPx`. Mismo criterio que los nodos
 *  del fondo: sin tope, cualquier círculo se convierte en una mancha de media pantalla al acercar. */
function cappedR(base: number, capPx: number, z: number): number {
  return Math.min(base, capPx / Math.max(z, 0.001));
}

/** Rampa 0→1 entre dos zooms, para encadenar los niveles de detalle sin saltos secos.
 *  Con ella un nivel de etiquetas se DESVANECE mientras el siguiente aparece, en vez de que uno
 *  desaparezca de golpe y el otro salte de la nada en el mismo fotograma. */
function ramp(v: number, a: number, b: number): number {
  return Math.max(0, Math.min(1, (v - a) / (b - a)));
}

/** Colocador de etiquetas que DESCARTA las que se solaparían con una ya puesta.
 *  Primero lo hice con una rejilla («una etiqueta por celda») y no bastaba: dos nombres en celdas
 *  vecinas se siguen pisando si uno es largo. Aquí se compara la CAJA real de cada etiqueta, y para
 *  no cotejar todas contra todas las aceptadas se guardan en cubos gruesos: solo se miran las de los
 *  cubos que toca la caja candidata.
 *  Todo en unidades del viewBox (que es donde vienen `sx`/`sy`), no en píxeles de mundo. */
type LabelBox = { x0: number; x1: number; y0: number; y1: number };
function makeLabelPlacer(cellVb = 90) {
  const buckets = new Map<string, LabelBox[]>();
  const cellsOf = (b: LabelBox) => {
    const out: string[] = [];
    for (let cx = Math.floor(b.x0 / cellVb); cx <= Math.floor(b.x1 / cellVb); cx++)
      for (let cy = Math.floor(b.y0 / cellVb); cy <= Math.floor(b.y1 / cellVb); cy++)
        out.push(`${cx}:${cy}`);
    return out;
  };
  /** @returns true si cabe (y la reserva); false si choca y hay que callarla. */
  return function place(
    sx: number,
    sy: number,
    text: string,
    font: number,
    opts: { middle?: boolean; spacing?: number } = {},
  ): boolean {
    // Ancho estimado: 0,6·font por carácter es lo típico de una sans, más el espaciado entre letras.
    const w = text.length * (font * 0.6 + (opts.spacing ?? 0));
    const x0 = opts.middle ? sx - w / 2 : sx;
    const box: LabelBox = { x0, x1: x0 + w, y0: sy - font * 0.8, y1: sy + font * 0.25 };
    const cells = cellsOf(box);
    for (const c of cells) {
      for (const b of buckets.get(c) ?? []) {
        if (box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0) return false;
      }
    }
    for (const c of cells) {
      const arr = buckets.get(c);
      if (arr) arr.push(box);
      else buckets.set(c, [box]);
    }
    return true;
  };
}

/** Cuánto BAJA la etiqueta de edad respecto al último avistamiento.
 *  Se mide desde el halo de la alerta de piloto seguido —el círculo MÁS GRANDE que puede coincidir en
 *  ese mismo sistema— más un margen, así que la sigue aunque cambie con el zoom. Con el desfase
 *  pequeño de antes (~6 px) la cifra caía DENTRO del marcador y no se leía. Va debajo porque el
 *  nombre del sistema ocupa el lado superior derecho. */
function ageOffset(z: number): number {
  return cappedR(6.4, 20, z) + 6 / Math.max(z, 0.001);
}

/** Flechas de dirección repartidas por una secuencia de puntos. Sustituye a `marker-mid`, que daba
 *  tres problemas: solo dispara en vértices INTERMEDIOS (un rastro de dos avistamientos se quedaba
 *  sin ninguna), la flecha caía sobre el punto del sistema y quedaba tapada, y si el piloto había
 *  IDO Y VUELTO por el mismo tramo las dos flechas se pisaban exactamente.
 *  Aquí van a mitad de tramo y, cuando el mismo tramo se repite, la repetición se aparta a un lado y
 *  otro del centro. **El apartado se calcula desde el TAMAÑO de la flecha, no como una fracción
 *  fija**: una fracción constante del tramo se ve amplia al acercar el zoom pero se encoge al
 *  alejarlo, mientras que la flecha mide siempre lo mismo en pantalla → a poca escala volverían a
 *  pisarse. `fade` atenúa de lo más viejo a lo más nuevo.
 *  El tamaño se divide por el zoom a mano: los marcadores SVG no admiten `non-scaling-stroke`. */
function trailArrows(
  pts: { px: number; py: number }[],
  col: string,
  z: number,
  opts: { fade?: boolean; size?: number; opacity?: number } = {},
): React.ReactNode[] {
  const s = (opts.size ?? 9) / Math.max(z, 0.001);
  const n = pts.length - 1;
  if (n < 1) return [];
  const seen = new Map<string, number>();
  const out: React.ReactNode[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.px - a.px;
    const dy = b.py - a.py;
    const len = Math.hypot(dx, dy);
    // Tramo más corto que la propia flecha: dibujarla solo añadiría ruido sobre los dos puntos.
    // El margen es 1,8× (y no 2,4×) porque al agrandar la flecha se perdían saltos cortos.
    if (len < s * 1.8) continue;
    const ka = `${a.px.toFixed(2)},${a.py.toFixed(2)}`;
    const kb = `${b.px.toFixed(2)},${b.py.toFixed(2)}`;
    const key = ka <= kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    const rep = seen.get(key) ?? 0;
    seen.set(key, rep + 1);
    // Separación entre flechas del mismo tramo: 2,2 veces el tamaño de la flecha. Si ni apartándolas
    // el máximo (35 % del tramo) caben sin pisarse —tramo corto o zoom bajo—, la repetición NO se
    // dibuja: mejor una flecha limpia que dos amontonadas. Al acercar el zoom aparecen solas.
    const need = (s * 2.2) / len;
    if (rep > 0 && need > 0.35) continue;
    const k = Math.ceil(rep / 2) * (rep % 2 === 1 ? -1 : 1);
    // El desplazamiento se mide SIEMPRE desde el extremo canónico (el mismo para ida y para vuelta).
    // Midiéndolo desde el origen de cada tramo, la vuelta con fracción 0,38 caía en el mismo punto
    // del mapa que la ida con 0,62: las dos flechas del ida-y-vuelta acababan superpuestas.
    const fwd = ka <= kb;
    const f = Math.max(0.1, Math.min(0.9, 0.5 + k * Math.min(need, 0.35)));
    const org = fwd ? a : b;
    const sx = (fwd ? dx : -dx) * f;
    const sy = (fwd ? dy : -dy) * f;
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    const op = opts.fade ? 0.3 + 0.7 * ((i + 1) / n) : (opts.opacity ?? 1);
    out.push(
      <path
        key={`ar-${i}`}
        d={`M${-s * 0.9},${-s * 0.62} L${s * 0.95},0 L${-s * 0.9},${s * 0.62} Z`}
        fill={col}
        fillOpacity={op}
        transform={`translate(${org.px + sx} ${org.py + sy}) rotate(${ang})`}
        pointerEvents="none"
      />,
    );
  }
  return out;
}
function ansiArc(pa: { px: number; py: number }, pb: { px: number; py: number }): string {
  const dx = pb.px - pa.px;
  const dy = pb.py - pa.py;
  const cx = (pa.px + pb.px) / 2 - dy * ANSI_BOW;
  const cy = (pa.py + pb.py) / 2 + dx * ANSI_BOW;
  return (
    `M${pa.px.toFixed(1)} ${pa.py.toFixed(1)}` +
    `Q${cx.toFixed(1)} ${cy.toFixed(1)} ${pb.px.toFixed(1)} ${pb.py.toFixed(1)}`
  );
}
// Badge reutilizable con el icono del juego. Se usa igual en la cabecera de ruta, en la lista de
// sistemas y en el feed de intel, para que «vía Ansiblex» se vea siempre igual.
function AnsiBadge({ size = 12 }: { size?: number }) {
  return (
    <img
      src={ANSI_ICON}
      alt="Ansiblex"
      width={size}
      height={size}
      style={{ verticalAlign: "-2px", borderRadius: 2 }}
    />
  );
}


// Facciones de la Guerra de Facciones (los 4 imperios). Color + nombre por faction_id.
function SystemSearch(props: {
  systems: NeSystem[];
  value: number | null;
  placeholder?: string;
  onPick: (id: number) => void;
}) {
  const { systems, value, placeholder, onPick } = props;
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const chosen = value != null ? systems.find((s) => s.id === value) : undefined;
  const text = focused ? q : chosen?.n ?? q;
  const ql = q.trim().toLowerCase();
  const matches =
    focused && ql.length >= 2
      ? systems.filter((s) => s.n.toLowerCase().includes(ql)).slice(0, 8)
      : [];
  return (
    <div className="sys-search">
      <input
        value={text}
        placeholder={placeholder}
        onFocus={() => {
          setFocused(true);
          setQ("");
        }}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onChange={(e) => setQ(e.target.value)}
      />
      {matches.length > 0 && (
        <ul className="sys-search-list">
          {matches.map((m) => (
            <li
              key={m.id}
              onMouseDown={() => {
                onPick(m.id);
                setFocused(false);
              }}
            >
              {m.n} <span className="muted">{m.s.toFixed(1)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MapView(props: {
  data: SysActivity[] | null;
  busy: boolean;
  overlay: MapOverlay;
  onOverlayChange: (o: MapOverlay) => void;
  /** Sujeto activo (0 = Global). Lo usan las notas de la ficha de sistema. */
  subjectId?: number;
  assetsBySystem?: Map<number, number> | null;
  miningBySystem?: Map<number, number> | null;
  sovBySystem?: Map<number, SovSystem> | null;
  fwBySystem?: Map<number, FwSystem> | null;
  piBySystem?: Map<number, PiSystem> | null;
  factionStandings?: Map<number, number> | null;
  agentSystems?: Map<number, number> | null;
  corpSystems?: Map<number, number> | null;
  agentDetails?: Map<number, { id: number; name: string; level: number }[]> | null;
  corpDetails?: Map<number, { id: number; name: string; lp: number }[]> | null;
  incursions?: Incursion[] | null;
  theraConns?: WhConn[] | null;
  /** Abre Ajustes → Intel. La config estable ya no vive aquí, pero desde aquí se llega. */
  onOpenIntelSettings?: () => void;
  onNeedThera?: () => void;
  intel?: IntelConfig;
  hereSystemId?: number | null;
  hereCharId?: number | null;
  charLocations?: CharLoc[];
  characters?: Character[];
  onSystemAssets?: (systemName: string) => void;
  onOpenCazador?: (name?: string) => void;
  onOpenMisiones?: () => void;
  onOpenPi?: () => void;
  /** Salta a una sección de la app. Genérico a propósito: el mapa enlaza a media docena de sitios y
   *  un callback por sección sería una prop nueva cada vez. */
  onOpenTab?: (tab: Tab) => void;
  openTrack?: { name: string; nonce: number } | null;
  /** Petición de CENTRAR un sistema, desde otra sección (inventario, naves, assets…). El `nonce`
   *  fuerza el re-disparo si pides dos veces el mismo sistema — mismo patrón que openTrack. */
  focusReq?: { sysId: number; nonce: number } | null;
  /** La op EN VIVO del grabador, entera. null = no hay op. Con ella el mapa pinta los anillos
   *  verdes de flota SOBRE cualquier capa (no es una capa: es una presencia, como la ruta) y
   *  llena la pestaña «Flota» de la tarjeta derecha — el roster junto al feed de intel. */
  fleetRoster?: Roster | null;
  /** E4: REPRODUCIR una op grabada sobre el mapa. Mientras hay reproducción, los anillos verdes
   *  leen el instante T (no el vivo) y la tarjeta derecha gana la pestaña «Op» con los mandos. */
  playback?: OpPlayback | null;
  onPlaybackClose?: () => void;
  /** Aviso a abrir en la ficha, pedido desde el overlay flotante. Ver el efecto más abajo. */
  openIntelReq?: {
    sysId: number;
    sysName: string;
    ts: number;
    author: string;
    message: string;
    nonce: number;
  } | null;
}) {
  const {
    data,
    overlay,
    onOverlayChange,
    subjectId = 0,
    intel,
    onSystemAssets,
    onOpenCazador,
    onOpenMisiones,
    onOpenPi,
    onOpenTab,
    onOpenIntelSettings,
    openTrack,
    focusReq,
    fleetRoster,
    playback,
    onPlaybackClose,
    openIntelReq,
    assetsBySystem,
    miningBySystem,
    sovBySystem,
    fwBySystem,
    piBySystem,
    factionStandings,
    agentSystems,
    corpSystems,
    agentDetails,
    corpDetails,
    incursions,
    theraConns,
    onNeedThera,
    hereSystemId,
    hereCharId,
    charLocations,
    characters = [],
  } = props;
  const [ne, setNe] = useState<NewEden | null>(null);
  const [factionMap, setFactionMap] = useState<Record<string, number> | null>(null);
  const [liveKills, setLiveKills] = useState<Map<number, number> | null>(null);
  const [liveJumps, setLiveJumps] = useState<Map<number, number> | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const [view, setView] = useState({ z: 1, x: 0, y: 0 });
  const [selected, setSelected] = useState<number | null>(null);
  const [hover, setHover] = useState<{ sid: number; sx: number; sy: number } | null>(null);
  // Disposición del mapa: sistemas (los ~5.000) o REGIONES (los ~70 centroides). No es zoom, es
  // colapsar el grafo — una vista estratégica que no se puede obtener alejando. Se recuerda.
  const [layout, setLayout] = useState<"systems" | "regions">(
    () => (localStorage.getItem("koru-map-layout") === "regions" ? "regions" : "systems")
  );
  const changeLayout = (l: "systems" | "regions") => {
    setLayout(l);
    localStorage.setItem("koru-map-layout", l);
  };
  // Regiones DESPLEGADAS dentro de la vista de regiones: se ven sus sistemas, el resto siguen
  // plegadas en su nodo. Así abres solo lo que te interesa en vez de todo New Eden de golpe.
  const [openRegions, setOpenRegions] = useState<Set<number>>(new Set());
  const toggleRegion = (id: number) =>
    setOpenRegions((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const [subFilter, setSubFilter] = useState<string>("all"); // sub-filtro de la capa activa
  // Reset al cambiar de capa. El recorrido no tiene «todos» (su sub-filtro es una ventana de
  // tiempo), así que arranca en 6 h: suficiente para ver la sesión de hoy sin cargar una semana.
  useEffect(() => setSubFilter(overlay === "recorrido" ? "6" : "all"), [overlay]);
  const [openCat, setOpenCat] = useState<string | null>(null); // desplegable de categoría de capas abierto
  const [ctxCollapsed, setCtxCollapsed] = useState(false); // panel de contexto plegado
  // Planificador de rutas: estado (modo + paradas) encapsulado en su hook.
  const {
    routeActive,
    setRouteActive,
    routeMode,
    setRouteMode,
    routeStops,
    setRouteStops,
    useAnsiblex,
    setUseAnsiblex,
    useWormholes,
    setUseWormholes,
    useSigWormholes,
    setUseSigWormholes,
    avoid,
    toggleAvoid,
    clearAvoid,
  } = useRoutePlanner();
  // Ancla para el botón «Detalle de navegación» de la tarjeta de ruta: baja a la sección de abajo.
  const navRef = useRef<HTMLDivElement | null>(null);
  // La columna derecha es UNA tarjeta con pestañas (antes eran cuatro apiladas y tapaban el mapa).
  // `cardOpen` pliega la tarjeta entera dejando solo la barra de pestañas.
  type RightTab = "ruta" | "rastro" | "aviso" | "habituales" | "sistema" | "viajes" | "flota" | "op";
  const [rightTab, setRightTab] = useState<RightTab>("ruta");
  const [cardOpen, setCardOpen] = useState(true);
  // Nombres de nave para la pestaña Flota (promesa compartida con la sección Flotas).
  const [fltShipNames, setFltShipNames] = useState<Map<number, string>>(new Map());
  useEffect(() => {
    if (!fleetRoster && !playback) return;
    loadShipNames().then(setFltShipNames).catch(() => {});
  }, [fleetRoster != null, playback != null]); // eslint-disable-line react-hooks/exhaustive-deps
  // Si la op termina con la pestaña Flota abierta, la tarjeta no puede quedarse en un panel que
  // ya no existe: cae a Ruta (la pestaña por defecto).
  useEffect(() => {
    if (rightTab === "flota" && !fleetRoster) setRightTab("ruta");
  }, [rightTab, fleetRoster]);

  // ---- E4: EL REPRODUCTOR de una op sobre el mapa ----
  // El reloj vive aquí (no en App): es un asunto del mapa, como el zoom. 100 ms de tick para que
  // el movimiento se vea fluido a cualquier velocidad; el trabajo por tick es trivial.
  const [pbT, setPbT] = useState(0);
  const [pbPlaying, setPbPlaying] = useState(false);
  const [pbSpeed, setPbSpeed] = useState(30); // ×30: una op de 30 min cabe en un minuto
  useEffect(() => {
    if (!playback) {
      setPbPlaying(false);
      return;
    }
    setPbT(playback.t0);
    setPbPlaying(true);
    setRightTab("op");
    setCardOpen(true);
  }, [playback]);
  useEffect(() => {
    if (!pbPlaying || !playback) return;
    const id = window.setInterval(() => {
      setPbT((t) => {
        const nx = t + 100 * pbSpeed;
        if (nx >= playback.t1) {
          setPbPlaying(false);
          return playback.t1;
        }
        return nx;
      });
    }, 100);
    return () => window.clearInterval(id);
  }, [pbPlaying, pbSpeed, playback]);
  useEffect(() => {
    if (rightTab === "op" && !playback) setRightTab("ruta");
  }, [rightTab, playback]);
  // Posiciones de la flota EN EL INSTANTE T, derivadas de los eventos (misma fuente que la cinta:
  // cada evento lleva el estado nuevo; leave = ausencia). Los eventos vienen ordenados.
  const pbState = useMemo(() => {
    if (!playback) return null;
    const per = new Map<
      number,
      { present: boolean; system: number | null; ship: number | null }
    >();
    for (const e of playback.events) {
      if (Date.parse(e.at) > pbT) break;
      if (e.kind === "leave")
        per.set(e.character_id, { present: false, system: null, ship: per.get(e.character_id)?.ship ?? null });
      else per.set(e.character_id, { present: true, system: e.system_id, ship: e.ship_type_id });
    }
    const porSys = new Map<number, number>();
    for (const v of per.values())
      if (v.present && v.system != null) porSys.set(v.system, (porSys.get(v.system) ?? 0) + 1);
    // La composición EN T, para la tarjeta: quién iba con qué en este instante (cambia al
    // reproducir — pedido de RoGiz7: «si cambió, que se vea de un golpe de vista»).
    const personas = [...per.entries()]
      .map(([charId, v]) => ({
        charId,
        quien: playback.names[String(charId)] ?? `#${charId}`,
        ...v,
      }))
      .sort((a, b) => a.quien.localeCompare(b.quien));
    return { porSys, personas };
  }, [playback, pbT]);
  // Red de Ansiblex de la alianza (declarada por el piloto en Ajustes; ESI no la publica).
  const [ansiRows, setAnsiRows] = useState<AnsiblexRow[]>([]);
  useEffect(() => {
    invoke<AnsiblexRow[]>("ansiblex_list")
      .then(setAnsiRows)
      .catch(() => setAnsiRows([]));
  }, []);
  // Planificador de saltos de capital (jump drive): estado + skills/fatiga encapsulados en su hook.
  const {
    jumpActive,
    setJumpActive,
    jumpOrigin,
    setJumpOrigin,
    jumpDest,
    setJumpDest,
    jumpRange,
    setJumpRange,
    jumpShips,
    jumpShip,
    setJumpShip,
    jdcLevel,
    setJdcLevel,
    jfcLevel,
    setJfcLevel,
    jumpChar,
    setJumpChar,
    jumpOwned,
    jumpFatMissing,
    selShip,
    curFatMin,
  } = useJumpPlanner();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const clickTimer = useRef<number | null>(null);
  const movedRef = useRef(false);
  // Zoom con rueda: el mapa se "arma" cuando el cursor lleva un instante dentro (~140 ms)
  // o al hacer clic. Una pasada rápida mientras scrolleas la página NO llega a armarlo, así
  // que no roba el scroll. La comprobación se hace en el momento de la rueda (más fiable que
  // depender de un setTimeout). `insideSince` = timestamp de entrada (0 = fuera).
  const DWELL_MS = 140;
  const [mapActive, setMapActive] = useState(false); // solo para el borde visual
  const insideSince = useRef(0);
  const borderTimer = useRef<number | null>(null);
  const enterMap = () => {
    if (insideSince.current === 0) insideSince.current = performance.now();
    if (borderTimer.current == null) {
      borderTimer.current = window.setTimeout(() => {
        borderTimer.current = null;
        if (insideSince.current > 0) setMapActive(true);
      }, DWELL_MS);
    }
  };
  const leaveMap = () => {
    insideSince.current = 0;
    if (borderTimer.current != null) {
      window.clearTimeout(borderTimer.current);
      borderTimer.current = null;
    }
    setMapActive(false);
  };
  const forceActive = () => {
    insideSince.current = performance.now() - 10000; // armado inmediato (clic)
    setMapActive(true);
  };
  useEffect(
    () => () => {
      if (borderTimer.current != null) window.clearTimeout(borderTimer.current);
    },
    []
  );

  useEffect(() => {
    loadNewEden().then(setNe).catch(() => {});
    // Facción NPC por sistema (del SDE) para la capa de standings.
    fetch("/system-factions.json")
      .then((r) => r.json())
      .then(setFactionMap)
      .catch(() => {});
    // Actividad en vivo (1h) para tooltips, siempre disponible.
    invoke<SystemKills[]>("get_system_kills")
      .then((rows) => {
        const m = new Map<number, number>();
        for (const r of rows) m.set(r.system_id, r.ship_kills + r.pod_kills);
        setLiveKills(m);
      })
      .catch(() => {});
    invoke<SystemJumps[]>("get_system_jumps")
      .then((rows) => {
        const m = new Map<number, number>();
        for (const r of rows) m.set(r.system_id, r.ship_jumps);
        setLiveJumps(m);
      })
      .catch(() => {});
  }, []);

  // Convierte coords de pantalla a coords del viewBox usando la matriz real del SVG
  // (correcto aunque haya letterbox por max-height / aspect ratio distinto).
  function clientToVB(clientX: number, clientY: number): { x: number; y: number } | null {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }
  // Listener de rueda NO pasivo: así podemos preventDefault y el zoom no scrollea la página.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      // Solo capturamos la rueda si el cursor lleva ya un instante dentro del mapa
      // (evita robar el scroll en una pasada rápida). Si no, dejamos pasar → scroll de página.
      const armed = insideSince.current > 0 && performance.now() - insideSince.current >= DWELL_MS;
      if (!armed) return;
      e.preventDefault();
      const vb = clientToVB(e.clientX, e.clientY);
      if (!vb) return;
      setView((v) => {
        const nz = Math.min(Math.max(v.z * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 1), 24);
        const wx = (vb.x - v.x) / v.z;
        const wy = (vb.y - v.y) / v.z;
        return { z: nz, x: vb.x - wx * nz, y: vb.y - wy * nz };
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
    // Depende de `ne`: el SVG no existe hasta que carga el SDE; al aparecer, re-engancha.
  }, [ne]);

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    // Empezar a arrastrar CORTA la animación de focusSystem: si no, el rAF y el drag se pelean
    // por la cámara durante ~300 ms y el mapa tiembla. El usuario manda, siempre.
    if (focusRaf.current != null) {
      cancelAnimationFrame(focusRaf.current);
      focusRaf.current = null;
    }
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
    movedRef.current = false;
    forceActive(); // interactuar (clic/arrastre) arma el zoom de inmediato
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (insideSince.current === 0) enterMap(); // fallback si onPointerEnter no llegó
    if (drag.current) {
      const dx = e.clientX - drag.current.x;
      const dy = e.clientY - drag.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) {
        drag.current.moved = true;
        movedRef.current = true;
      }
      drag.current.x = e.clientX;
      drag.current.y = e.clientY;
      // Convierte el desplazamiento de pantalla a unidades del viewBox con la escala real.
      const ctm = svgRef.current?.getScreenCTM();
      const sx = ctm && ctm.a ? 1 / ctm.a : 1;
      const sy = ctm && ctm.d ? 1 / ctm.d : 1;
      setView((v) => ({ ...v, x: v.x + dx * sx, y: v.y + dy * sy }));
      return;
    }
    // Detección de sistema bajo el cursor (para el tooltip), eficiente.
    // En vista de REGIONES no hay sistemas pintados: buscarlos igual sacaba la ficha de un sistema
    // invisible bajo el cursor. Cada región ya lleva su propio <title>.
    if (layout !== "systems") {
      if (hover) setHover(null);
      return;
    }
    const rect = svgRef.current?.getBoundingClientRect();
    const vb = clientToVB(e.clientX, e.clientY);
    if (!rect || !vb || !geo) return;
    const wx = (vb.x - view.x) / view.z;
    const wy = (vb.y - view.y) / view.z;
    const thr = 14 / view.z;
    let bestId = -1;
    let bestD = thr;
    for (const s of geo.idx.values()) {
      const p = geo.proj(s);
      const dd = Math.abs(p.px - wx) + Math.abs(p.py - wy);
      if (dd < bestD) {
        bestD = dd;
        bestId = s.id;
      }
    }
    const nid = bestId >= 0 ? bestId : null;
    setHover((prev) => {
      if ((prev?.sid ?? null) === nid) return prev; // sin cambio → sin re-render
      return nid == null ? null : { sid: nid, sx: e.clientX - rect.left, sy: e.clientY - rect.top };
    });
  }
  function onPointerUp() {
    drag.current = null;
  }
  // Zoom con botones manteniendo fijo el centro del viewport actual.
  function zoomBy(factor: number) {
    setView((v) => {
      const nz = Math.min(Math.max(v.z * factor, 1), 24);
      const cx = MAP_W / 2;
      const cy = MAP_H / 2;
      const wx = (cx - v.x) / v.z;
      const wy = (cy - v.y) / v.z;
      return { z: nz, x: cx - wx * nz, y: cy - wy * nz };
    });
  }
  function onDoubleClick(e: React.MouseEvent<SVGSVGElement>) {
    if (clickTimer.current) {
      window.clearTimeout(clickTimer.current); // cancela la selección pendiente
      clickTimer.current = null;
    }
    const vb = clientToVB(e.clientX, e.clientY);
    if (!vb) return;
    setView((v) => {
      const nz = Math.min(v.z * 1.8, 24);
      const wx = (vb.x - v.x) / v.z;
      const wy = (vb.y - v.y) / v.z;
      return { z: nz, x: vb.x - wx * nz, y: vb.y - wy * nz };
    });
  }
  // Click "diferido": si llega un doble-click antes de 200ms, se cancela (solo zoom, sin seleccionar).
  function clickSystem(sid: number) {
    if (movedRef.current) return; // fue un paneo
    if (clickTimer.current) window.clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(() => {
      selectSystem(sid);
      clickTimer.current = null;
    }, 200);
  }

  function selectSystem(sid: number) {
    if (drag.current?.moved) return; // fue un paneo, no un click
    if (jumpActive) {
      // Primer click fija el origen; los siguientes fijan el destino (para fuel/distancia).
      if (jumpOrigin == null) setJumpOrigin(sid);
      else setJumpDest(sid);
      return;
    }
    if (routeActive) {
      // En interceptación la ruta la MANDA el objetivo, no las paradas: un click no debe apilar
      // waypoints (eso dejaba una ruta enredada), sino RE-APUNTAR la interceptación al sistema
      // clicado. El origen sigue siendo tu cazador. Esto también deja re-apuntar clicando un punto
      // rojo de intel. La elección manual manda sobre el seguimiento hasta que apagues y vuelvas.
      if (intercepting) {
        setManualTarget(sid);
        return;
      }
      setRouteStops((prev) => {
        const i = prev.indexOf(null);
        if (i >= 0) {
          const copy = [...prev];
          copy[i] = sid;
          return copy;
        }
        return [...prev, sid];
      });
      return;
    }
    setIntelDetail(null); // panel de sistema y tarjeta de detalle comparten sitio
    setSelected(sid);
  }

  useEffect(() => {
    if ((overlay === "kills" || routeActive) && !liveKills) {
      setLiveBusy(true);
      invoke<SystemKills[]>("get_system_kills")
        .then((rows) => {
          const m = new Map<number, number>();
          for (const r of rows) m.set(r.system_id, r.ship_kills + r.pod_kills);
          setLiveKills(m);
        })
        .catch(() => {})
        .finally(() => setLiveBusy(false));
    }
    if (overlay === "jumps" && !liveJumps) {
      setLiveBusy(true);
      invoke<SystemJumps[]>("get_system_jumps")
        .then((rows) => {
          const m = new Map<number, number>();
          for (const r of rows) m.set(r.system_id, r.ship_jumps);
          setLiveJumps(m);
        })
        .catch(() => {})
        .finally(() => setLiveBusy(false));
    }
  }, [overlay, routeActive, liveKills, liveJumps]);

  // Proyección + backdrop (líneas) + centroides de región, memorizado por el dataset.
  const geo = useMemo(() => {
    if (!ne) return null;
    let xMin = Infinity,
      xMax = -Infinity,
      yMin = Infinity,
      yMax = -Infinity;
    for (const s of ne.systems) {
      const py = -s.y;
      if (s.x < xMin) xMin = s.x;
      if (s.x > xMax) xMax = s.x;
      if (py < yMin) yMin = py;
      if (py > yMax) yMax = py;
    }
    const xr = xMax - xMin || 1;
    const yr = yMax - yMin || 1;
    const scale = Math.min((MAP_W - 2 * MAP_PAD) / xr, (MAP_H - 2 * MAP_PAD) / yr);
    const offX = (MAP_W - xr * scale) / 2;
    const offY = (MAP_H - yr * scale) / 2;
    const proj = (s: NeSystem) => ({
      px: offX + (s.x - xMin) * scale,
      py: offY + (-s.y - yMin) * scale,
    });
    const idx = new Map<number, NeSystem>(ne.systems.map((s) => [s.id, s]));
    const nameIdx = new Map<string, NeSystem>(ne.systems.map((s) => [s.n.toLowerCase(), s]));
    const adj = new Map<number, number[]>();
    let jumpsPath = "";
    for (const [a, b] of ne.jumps) {
      const sa = idx.get(a);
      const sb = idx.get(b);
      if (!sa || !sb) continue;
      (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
      (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
      const pa = proj(sa);
      const pb = proj(sb);
      jumpsPath += `M${pa.px.toFixed(1)} ${pa.py.toFixed(1)}L${pb.px.toFixed(1)} ${pb.py.toFixed(1)}`;
    }
    // Centroides de región y constelación (para etiquetas LOD).
    const centroids = (key: (s: NeSystem) => number, names: Map<number, string>) => {
      const acc = new Map<number, { sx: number; sy: number; n: number }>();
      for (const s of ne.systems) {
        const p = proj(s);
        const a = acc.get(key(s)) ?? { sx: 0, sy: 0, n: 0 };
        a.sx += p.px;
        a.sy += p.py;
        a.n += 1;
        acc.set(key(s), a);
      }
      return [...acc.entries()].map(([id, a]) => ({
        id,
        name: names.get(id) ?? "",
        px: a.sx / a.n,
        py: a.sy / a.n,
        count: a.n,
      }));
    };
    const regionLabels = centroids(
      (s) => s.r,
      new Map(ne.regions.map((r) => [r.id, r.n]))
    );
    const constLabels = centroids(
      (s) => s.c,
      new Map(ne.constellations.map((c) => [c.id, c.n]))
    );
    // Grafo de REGIONES (vista de disposición «Regiones»): los nodos son los centroides que ya
    // calculamos para las etiquetas, y las aristas salen de los stargates que cruzan de una región
    // a otra. Se hace aquí, dentro de `geo`, porque depende solo del SDE y ya estamos recorriendo
    // los ~13.000 saltos: montarlo aparte sería recorrerlos dos veces.
    const regionOf = new Map<number, number>(ne.systems.map((s) => [s.id, s.r]));
    const seenPair = new Set<string>();
    const regionEdges: [number, number][] = [];
    for (const [a, b] of ne.jumps) {
      const ra = regionOf.get(a);
      const rb = regionOf.get(b);
      if (ra == null || rb == null || ra === rb) continue;
      const k = ra < rb ? `${ra}-${rb}` : `${rb}-${ra}`;
      if (seenPair.has(k)) continue;
      seenPair.add(k);
      regionEdges.push(ra < rb ? [ra, rb] : [rb, ra]);
    }
    const regionPos = new Map(regionLabels.map((r) => [r.id, r]));
    // Sistemas de cada región, para poder DESPLEGAR una sola sin recorrer los 5.000 cada vez.
    const byRegion = new Map<number, NeSystem[]>();
    for (const s of ne.systems) {
      const arr = byRegion.get(s.r);
      if (arr) arr.push(s);
      else byRegion.set(s.r, [s]);
    }
    return {
      proj,
      idx,
      nameIdx,
      adj,
      jumpsPath,
      regionLabels,
      constLabels,
      regionOf,
      regionEdges,
      regionPos,
      byRegion,
    };
  }, [ne]);

  // Centra la vista en un punto del mundo con el zoom dado. El transform es `mundo * z + offset`,
  // así que para dejar (wx,wy) en el centro: offset = centro − mundo*z.
  function focusOn(wx: number, wy: number, z: number) {
    const nz = Math.min(Math.max(z, 1), 24);
    setView({ z: nz, x: MAP_W / 2 - wx * nz, y: MAP_H / 2 - wy * nz });
  }

  // ★ CENTRAR EL MAPA EN UN SISTEMA (idea de RoGiz7, 2026-08-22) — LA ÚNICA PUERTA para hacerlo.
  // Todos los llamantes (feed de intel, saltos calientes de la ruta, buscadores…) pasan por aquí:
  // separar «centrar desde intel» de «centrar desde ruta» sería la vía segura para que diverjan
  // sin que nadie se entere — misma lección que las dos tarjetas del mapa.
  // Las cuatro reglas, decididas a propósito:
  //  1. Centrar NO cambia el marco mental: el zoom no baja nunca; solo sube si estabas lejísimos
  //     (mismo criterio y misma cifra que el clic de región, 2.6).
  //  2. Se ANIMA corto (~280 ms): un salto instantáneo te deja sin saber de dónde venías — la
  //     ceguera de cámara. rAF sobre el estado `view`, cancelando la animación anterior.
  //  3. La llegada se MARCA con un pulso que se apaga solo: centrar sin que se distinga cuál de
  //     los puntos es no es centrar nada.
  //  4. Solo se llama desde ACCIONES del usuario (clics) — un aviso de intel jamás mueve la
  //     cámara por su cuenta.
  const viewRef = useRef(view);
  viewRef.current = view;
  const focusRaf = useRef<number | null>(null);
  const [focusPulse, setFocusPulse] = useState<{ sid: number; k: number } | null>(null);
  const focusSystem = useCallback(
    (sid: number | null | undefined) => {
      if (sid == null || !geo) return;
      const s = geo.idx.get(sid);
      if (!s) return;
      // En la vista de regiones, el sistema no existe en pantalla si su región está plegada:
      // centrar ahí sería mover la cámara hacia nada. Se despliega su región primero.
      if (layout === "regions") {
        setOpenRegions((prev) => {
          const nx = new Set(prev);
          nx.add(s.r);
          return nx;
        });
      }
      const p = geo.proj(s);
      const from = viewRef.current;
      const nz = Math.min(Math.max(from.z, 2.6), 24);
      const to = { z: nz, x: MAP_W / 2 - p.px * nz, y: MAP_H / 2 - p.py * nz };
      if (focusRaf.current != null) cancelAnimationFrame(focusRaf.current);
      const t0 = performance.now();
      const DUR = 280;
      const paso = (t: number) => {
        const k = Math.min((t - t0) / DUR, 1);
        const e = 1 - Math.pow(1 - k, 3); // easeOutCubic: llega suave, sin frenazo
        setView({
          z: from.z + (to.z - from.z) * e,
          x: from.x + (to.x - from.x) * e,
          y: from.y + (to.y - from.y) * e,
        });
        focusRaf.current = k < 1 ? requestAnimationFrame(paso) : null;
      };
      focusRaf.current = requestAnimationFrame(paso);
      setFocusPulse({ sid, k: Date.now() });
    },
    [geo, layout],
  );

  // Petición de centrado desde OTRA sección (fase 2 del centrado: inventario, naves, assets…).
  // ⚠️ La guarda de `geo` importa: si vienes de otra pestaña el mapa puede estar recién montado y
  // sin geometría todavía — sin ella, la petición se perdería en silencio. El nonce consumido se
  // recuerda para no re-centrar cuando `geo` cambie por otros motivos.
  const focusReqDone = useRef(0);
  useEffect(() => {
    if (!focusReq || !geo) return;
    if (focusReq.nonce === focusReqDone.current) return;
    focusReqDone.current = focusReq.nonce;
    focusSystem(focusReq.sysId);
  }, [focusReq, geo, focusSystem]);

  // El NARRADOR (pedido de RoGiz7 al estrenar el reproductor): lo sucedido hasta T, lo último
  // arriba — el feed de la izquierda contando la op mientras el mapa la mueve.
  // Líneas ESTRUCTURADAS (no texto plano): el render pone iconografía EVE — retrato circular del
  // piloto, icono real de la nave, y el sistema como enlace que CENTRA (focusSystem, la de
  // siempre). Pedido de RoGiz7: «mejorar un pelín la estética hacia EVE».
  const pbFeed = useMemo(() => {
    if (!playback) return null;
    type Linea = {
      ts: number;
      clase: string;
      /** Marcador para lo que no es una persona de la flota (☠ ✝ ⚠). */
      icon?: string;
      /** Texto ANTES del sujeto («la flota mata a»). */
      pre?: string;
      charId?: number | null;
      quien?: string | null;
      /** El verbo, tras el sujeto («salta a», «entra en la flota ·»). */
      verbo: string;
      sysId?: number | null;
      shipId?: number | null;
    };
    const out: Linea[] = [];
    for (const e of playback.events) {
      const ts = Date.parse(e.at);
      if (ts > pbT) break;
      const quien = playback.names[String(e.character_id)] ?? `#${e.character_id}`;
      const base = { ts, clase: e.kind, charId: e.character_id, quien };
      if (e.kind === "join")
        out.push({ ...base, verbo: tr("entra en la flota"), sysId: e.system_id, shipId: e.ship_type_id });
      else if (e.kind === "leave") out.push({ ...base, verbo: tr("sale de la flota") });
      else if (e.kind === "move") out.push({ ...base, verbo: tr("salta a"), sysId: e.system_id });
      else if (e.kind === "ship")
        out.push({ ...base, verbo: tr("cambia a"), shipId: e.ship_type_id });
      else if (e.kind === "dock") out.push({ ...base, verbo: tr("atraca"), sysId: e.system_id });
      else if (e.kind === "undock")
        out.push({ ...base, verbo: tr("desatraca"), sysId: e.system_id });
    }
    for (const k of playback.kills) {
      const ts = Date.parse(k.at);
      if (ts > pbT) continue;
      out.push(
        k.loss
          ? { ts, clase: "perdida", icon: "✝", charId: k.victim_id, quien: k.victim_name ?? "?", verbo: tr("pierde su"), shipId: k.victim_ship }
          : { ts, clase: "kill", icon: "☠", pre: tr("la flota mata a"), charId: k.victim_id, quien: k.victim_name ?? "?", verbo: "", shipId: k.victim_ship },
      );
    }
    for (const r of playback.intel) {
      if (r.ts_ms > pbT) continue;
      out.push({ ts: r.ts_ms, clase: "intel", icon: "⚠", quien: r.name, verbo: "·", sysId: r.system_id });
    }
    out.sort((a, b) => b.ts - a.ts);
    return out.slice(0, 14);
  }, [playback, pbT]);


  // Red de Ansiblex proyectada sobre el mapa: aristas para el grafo + trazo para pintarlas.
  // Va en su PROPIO memo y no dentro de `geo` a propósito: geo recorre los ~5.000 sistemas y las
  // ~13.000 conexiones de New Eden, y no queremos rehacer todo eso cada vez que el piloto
  // reimporta la red.
  const ansi = useMemo(() => {
    if (!geo || ansiRows.length === 0) return null;
    const adj = new Map<number, number[]>();
    const keys = new Set<string>();
    let path = "";
    let drawn = 0;
    for (const b of ansiRows) {
      const sa = geo.idx.get(b.a_id);
      const sb = geo.idx.get(b.b_id);
      if (!sa || !sb) continue; // puente a un sistema que el SDE ya no conoce → no inventamos
      (adj.get(b.a_id) ?? adj.set(b.a_id, []).get(b.a_id)!).push(b.b_id);
      (adj.get(b.b_id) ?? adj.set(b.b_id, []).get(b.b_id)!).push(b.a_id);
      keys.add(edgeKey(b.a_id, b.b_id));
      // Los pares vienen en orden canónico (a_id < b_id) desde la tabla, así que el arco es estable.
      path += ansiArc(geo.proj(sa), geo.proj(sb));
      drawn++;
    }
    return { adj, keys, path, drawn };
  }, [geo, ansiRows]);

  // Red de wormholes de eve-scout (Thera/Turnur) proyectada sobre el mapa. Cada conexión une un
  // sistema de k-space con un HUB. Turnur es un nodo real; Thera es sintético (centroide de sus
  // conexiones) porque no está en el SDE. Modelo idéntico a `ansi`: aristas + trazo + índices.
  const wh = useMemo(() => {
    if (!geo || !theraConns || theraConns.length === 0) return null;
    // Posición de Thera = centroide de sus in-systems (para poder dibujarla y que las líneas
    // converjan ahí). Turnur usa su posición real del SDE.
    const theraK = theraConns
      .filter((c) => c.hub === "Thera")
      .map((c) => geo.idx.get(c.system_id))
      .filter((s): s is NeSystem => !!s)
      .map((s) => geo.proj(s));
    const hubPos = new Map<number, { px: number; py: number }>();
    if (theraK.length) {
      hubPos.set(THERA_ID, {
        px: theraK.reduce((a, p) => a + p.px, 0) / theraK.length,
        py: theraK.reduce((a, p) => a + p.py, 0) / theraK.length,
      });
    }
    const turnur = geo.idx.get(TURNUR_ID);
    if (turnur) hubPos.set(TURNUR_ID, geo.proj(turnur));
    const hubName = new Map<number, string>([
      [THERA_ID, "Thera"],
      [TURNUR_ID, "Turnur"],
    ]);

    const adj = new Map<number, number[]>();
    const keys = new Set<string>();
    let path = "";
    let drawn = 0;
    for (const c of theraConns) {
      const hubId = c.hub === "Turnur" ? TURNUR_ID : THERA_ID;
      const sysP = geo.idx.get(c.system_id);
      const hubP = hubPos.get(hubId);
      if (!sysP || !hubP || c.system_id === hubId) continue; // sin posición → no lo pintamos
      (adj.get(c.system_id) ?? adj.set(c.system_id, []).get(c.system_id)!).push(hubId);
      (adj.get(hubId) ?? adj.set(hubId, []).get(hubId)!).push(c.system_id);
      keys.add(edgeKey(c.system_id, hubId));
      const pa = geo.proj(sysP);
      path += `M${pa.px.toFixed(1)} ${pa.py.toFixed(1)}L${hubP.px.toFixed(1)} ${hubP.py.toFixed(1)}`;
      drawn++;
    }
    return { adj, keys, path, hubPos, hubName, drawn };
  }, [geo, theraConns]);

  // Cargar las conexiones de eve-scout en cuanto se enciende el rutado por wormholes (si no están
  // ya cargadas de haber abierto la capa). El fetch vive en App (get_thera_connections).
  useEffect(() => {
    if (useWormholes && !theraConns) onNeedThera?.();
  }, [useWormholes, theraConns, onNeedThera]);

  // TUS wormholes escaneados y anotados con destino. Se cargan de la BD local al encender su rutado
  // (o al abrir la capa de firmas). El destino lo escribiste como texto: aquí se resuelve a sistema.
  // Se cargan en cuanto hay motivo para necesitarlos: rutando, con su rutado ya encendido, o mirando
  // la capa de firmas. Cargarlos solo con el toggle encendido sería un pez que se muerde la cola —el
  // botón «Mis WH» no aparecería nunca, porque depende de que estos datos existan.
  const [sigWhNotes, setSigWhNotes] = useState<SignatureRow[] | null>(null);
  useEffect(() => {
    const wanted = useSigWormholes || overlay === "firmas" || routeActive || jumpActive;
    if (wanted && sigWhNotes == null) {
      invoke<SignatureRow[]>("signatures_wormhole_notes").then(setSigWhNotes).catch(() => setSigWhNotes([]));
    }
  }, [useSigWormholes, overlay, routeActive, jumpActive, sigWhNotes]);

  // Aristas de ruta a partir de tus wormholes anotados. Mismo modelo que `wh` (adj + trazo + claves),
  // pero aquí las dos puntas son sistemas REALES: el agujero está en `system_id` y el destino es la
  // nota resuelta contra el SDE. Validado en Python: dedup del par, descarte de notas que no
  // resuelven y de bucles, bidireccional, y NO muta `geo.adj` (la alarma nunca ve estos atajos).
  const sigWh = useMemo(() => {
    if (!geo || !sigWhNotes || sigWhNotes.length === 0) return null;
    const adj = new Map<number, number[]>();
    const keys = new Set<string>();
    const edges: { a: number; b: number; sigId: string }[] = [];
    let path = "";
    let unresolved = 0;
    for (const w of sigWhNotes) {
      const dest = w.note ? geo.nameIdx.get(w.note.trim().toLowerCase()) : undefined;
      if (!dest) {
        unresolved++;
        continue; // la nota no es un sistema (p. ej. "C2", "colapsando") → informativa, no arista
      }
      if (dest.id === w.system_id) continue; // bucle
      const k = edgeKey(w.system_id, dest.id);
      if (keys.has(k)) continue; // dedup del mismo par
      keys.add(k);
      (adj.get(w.system_id) ?? adj.set(w.system_id, []).get(w.system_id)!).push(dest.id);
      (adj.get(dest.id) ?? adj.set(dest.id, []).get(dest.id)!).push(w.system_id);
      edges.push({ a: w.system_id, b: dest.id, sigId: w.sig_id });
      const src = geo.idx.get(w.system_id);
      if (src) {
        const pa = geo.proj(src);
        const pb = geo.proj(dest);
        path += `M${pa.px.toFixed(1)} ${pa.py.toFixed(1)}L${pb.px.toFixed(1)} ${pb.py.toFixed(1)}`;
      }
    }
    return { adj, keys, edges, path, unresolved };
  }, [geo, sigWhNotes]);

  // Posición de un sistema del grafo, incluyendo los hubs sintéticos (Thera). Para pintar la ruta
  // y las líneas cuando el camino pasa por un nodo que no está en el SDE.
  const posOf = (sid: number): { px: number; py: number } | null => {
    const s = geo?.idx.get(sid);
    if (s) return geo!.proj(s);
    return wh?.hubPos.get(sid) ?? null;
  };
  // Nombre de un sistema del grafo, incluyendo los hubs sintéticos.
  const nameOf = (sid: number): string =>
    geo?.idx.get(sid)?.n ?? wh?.hubName.get(sid) ?? `#${sid}`;

  // Fondo de estrellas memorizado (no se reconstruye al mover el ratón / hover).
  // LOD del backdrop: en vista galaxia (muy alejado) pinta 1 de cada 3 sistemas (se solapan igual).
  const bgStride = view.z < 1.8 ? 3 : 1;
  const bgZoom = Math.max(1, Math.round(view.z));
  const backdropCircles = useMemo(
    // El zoom se cuantiza a enteros a propósito: el radio depende de él, y sin cuantizar este memo
    // (5.000 círculos) se recrearía en cada píxel de zoom. Con enteros son ~24 veces en todo el
    // recorrido, que es gratis.
    () => renderBackdrop(geo, ne, overlay, bgStride, bgZoom),
    [geo, ne, overlay, bgStride, bgZoom],
  );

  // Soberanía memorizada (círculos coloreados por dueño).
  const sovCircles = useMemo(
    () => renderSov(geo, overlay, sovBySystem, subFilter),
    [geo, overlay, sovBySystem, subFilter],
  );

  // Guerra de facciones: color = imperio que controla; radio/intensidad = cuán disputado.
  const fwCircles = useMemo(
    () => renderFw(geo, overlay, fwBySystem, subFilter),
    [geo, overlay, fwBySystem, subFilter],
  );

  // Standings por sistema: color = tu standing con la facción NPC que controla el sistema.
  const standingCircles = useMemo(
    () => renderStandings(geo, overlay, factionMap, factionStandings),
    [geo, overlay, factionMap, factionStandings],
  );

  // Tus agentes: sistemas donde tienes agentes (de tus standings), color = nivel del mejor agente.
  const agentCircles = useMemo(
    () => renderAgents(geo, overlay, agentSystems),
    [geo, overlay, agentSystems],
  );

  // Mis corps NPC (LP): sistemas donde tus corps con LP tienen estaciones (dónde gastar LP).
  const corpNpcCircles = useMemo(
    () => renderCorps(geo, overlay, corpSystems),
    [geo, overlay, corpSystems],
  );

  // Incursiones de Sansha: sistemas infestados; el de staging más grande. Color = estado.
  const incursionCircles = useMemo(
    () => renderIncursions(geo, overlay, incursions),
    [geo, overlay, incursions],
  );

  // Capa de wormholes (eve-scout): marca los sistemas con conexión Thera/Turnur.
  const theraCircles = useMemo(
    () => renderThera(geo, overlay, theraConns),
    [geo, overlay, theraConns],
  );

  // Capa de FIRMAS escaneadas (tuyas, de la BD local). Se carga sola al activar la capa: es local y
  // barato, así que no necesita bajar por props desde App como Thera/eve-scout.
  const [sigSummary, setSigSummary] = useState<SignatureSummary[] | null>(null);
  useEffect(() => {
    if (overlay !== "firmas") return;
    invoke<SignatureSummary[]>("signatures_summary").then(setSigSummary).catch(() => setSigSummary([]));
  }, [overlay]);
  const sigCircles = useMemo(
    () => renderSignatures(geo, overlay, sigSummary, view.z),
    [geo, overlay, sigSummary, view.z],
  );

  // Pilotos EXCLUIDOS de la proximidad de intel. Petición de RoGiz7: un alt aparcado en Jita
  // convertiría media galaxia en «cerca» y el intel cantaría sin parar. Se guardan los apagados
  // (no los encendidos) para que un personaje NUEVO entre activo por defecto.
  const [pilotsOff, setPilotsOff] = useState<Set<number>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("koru-intel-pilots-off") || "[]") as number[]);
    } catch {
      return new Set();
    }
  });
  /** ¿Enseñar también los desconectados? Apagado por defecto. */
  const [verTodosPilotos, setVerTodosPilotos] = useState(false);
  const togglePilot = (id: number) =>
    setPilotsOff((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      localStorage.setItem("koru-intel-pilots-off", JSON.stringify([...n]));
      return n;
    });

  /** Tus pilotos que CUENTAN para el intel: encendidos y conectados.
   *
   *  Lo de «conectado» no es un adorno: `/characters/{id}/location/` devuelve la última posición
   *  conocida aunque el piloto lleve horas desconectado. Sin filtrar, Koru mediría la distancia a
   *  un fantasma y avisaría de un peligro que no corre nadie. Si el scope no está concedido,
   *  `online` llega `null` y se acepta —mejor un dato de más que ninguno—. */
  const intelPilots = useMemo(
    () => (charLocations ?? []).filter((c) => !pilotsOff.has(c.id) && c.online !== false),
    [charLocations, pilotsOff],
  );

  // Orígenes de proximidad: TUS PILOTOS ACTIVOS + los puntos de ancla (sin duplicados).
  //
  // Antes solo entraban el sistema del sujeto y las anclas, y en modo Global el sujeto es `null`:
  // los orígenes quedaban reducidos a las anclas. Por eso el feed decía «6 saltos» (a un ancla
  // donde no hay nadie) mientras el aviso flotante decía 5 (a un piloto de verdad). Con los pilotos
  // dentro, las tres superficies —feed, mapa y overlay— miden por fin lo mismo.
  const intelOrigins = useMemo(() => {
    const set = new Set<number>();
    if (hereSystemId != null) set.add(hereSystemId);
    for (const p of intelPilots) set.add(p.system_id);
    for (const a of intel?.anchors ?? []) set.add(a);
    return [...set];
  }, [hereSystemId, intelPilots, intel?.anchors]);

  // --- Intel: proximidad (BFS multi-origen: distancia al más cercano de los orígenes) ---
  //
  // SOLO STARGATES, y es una decisión, no un olvido. Este número alimenta LA ALARMA, y la alarma
  // mide una cosa concreta: cómo de rápido pueden llegar ELLOS hasta ti. Los Ansiblex de tu
  // alianza no les sirven —la ACL los deja fuera, y desde sept-2026 es alianza-only—, así que
  // meterlos aquí acortaría el camino por una vía que el hostil NO puede tomar: diría «a 3 saltos»
  // cuando necesita 11. Falsas alarmas justo donde una falsa alarma quema la confianza en todas
  // las demás. Y hay un agravante: los hostiles tienen SUS puentes en su espacio, que no conocemos
  // → la amenaza real a través de puentes no es difícil de calcular, es incognoscible.
  const jumpsFrom = useMemo(
    () => (!geo || intelOrigins.length === 0 ? null : proximityBFS(geo.adj, intelOrigins)),
    [geo, intelOrigins],
  );

  // --- Caza: ¿en cuánto llegas TÚ allí? (puertas + Ansiblex) ---
  //
  // La otra mitad de la pregunta, y la que le da sentido al cazador. Mismo grafo, dirección
  // opuesta: para venir a por ti el hostil no puede usar tus puentes, pero para ir a por él TÚ sí.
  // Por eso este número va APARTE del de la alarma y nunca lo sustituye: son dos cosas distintas
  // que hasta ahora compartían cifra.
  // El origen es dónde ESTÁS, no las anclas: sales de donde estás sentado, no de tu staging. Si no
  // sabemos tu posición, caemos a las anclas para que el dato siga sirviendo de algo.
  const huntFrom = useMemo(() => {
    if (!geo || !ansi) return null;
    const origins = hereSystemId != null ? [hereSystemId] : intelOrigins;
    if (origins.length === 0) return null;
    const merged = new Map(geo.adj);
    for (const [from, tos] of ansi.adj) {
      merged.set(from, [...(merged.get(from) ?? []), ...tos]);
    }
    return proximityBFS(merged, origins);
  }, [geo, ansi, hereSystemId, intelOrigins]);

  // --- Intel: parsear líneas → reportes por sistema + feed cronológico ---
  // Nombres de naves del SDE (nombre minúsculas → type_id) para clasificar tokens localmente.
  const [shipNames, setShipNames] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    fetch("/ship_names.json")
      .then((r) => r.json())
      .then((o: Record<string, number>) => setShipNames(new Map(Object.entries(o))))
      .catch(() => {});
  }, []);

  const intelReports = useMemo(
    () => (geo && intel ? buildIntelReports(intel.lines, geo.nameIdx, shipNames) : null),
    [geo, intel?.lines, shipNames],
  );

  // --- Modo cazador: rastro HISTÓRICO persistente de un objetivo (tabla intel_sightings) ---
  // El nº de líneas de intel es la señal de refresco: cuando llega un canto nuevo, el rastro del
  // perseguido se vuelve a consultar, y con él su último sistema → la interceptación se re-traza.
  const { huntPilots, huntTracks, loadHuntTrack, dropHuntPilot, clearHuntTrack } = useHuntTrack(
    openTrack,
    intel?.lines.length ?? 0
  );
  // Interceptación viva: la ruta se ata a UN piloto de los que sigues (solo puedes volar a un sitio).
  // `interceptPilot` dice a cuál. El origen es dónde está TU cazador (`hereSystemId`); el destino, el
  // último sistema donde lo cantaron. Se re-traza sola si se mueve. Ver el efecto más abajo.
  const [intercepting, setIntercepting] = useState(false);
  const [interceptPilot, setInterceptPilot] = useState<string | null>(null);
  // Reloj de refresco de las etiquetas de edad del rastro. Sin él, «4min» se quedaría congelado
  // hasta que llegara intel nuevo, que es justo cuando MENOS te fías de una cifra de tiempo.
  const [ageTick, setAgeTick] = useState(0);
  useEffect(() => {
    if (overlay !== "intel") return;
    const id = window.setInterval(() => setAgeTick((t) => t + 1), 15000);
    return () => window.clearInterval(id);
  }, [overlay]);
  // ---- Capa RECORRIDO: por dónde has pasado de verdad ----
  //
  // Sale de `location_track`, que escribe el sondeo de posición: una fila por VISITA, con el primer
  // y el último instante en que se te vio allí. Ojo con dos cosas al leer esto, porque son la
  // diferencia entre informar y mentir:
  //   · El tiempo en un sistema es `seen_ms - entered_ms` (lo observado). Nunca «hasta ahora».
  //   · El hueco entre el `seen_ms` de un tramo y el `entered_ms` del siguiente es CEGUERA (Koru
  //     cerrado, o el piloto desconectado), no un salto. Se dibuja distinto a propósito.
  const [track, setTrack] = useState<RouteStop[]>([]);
  const horasTrack = Number(subFilter) > 0 ? Number(subFilter) : 6;
  useEffect(() => {
    if (overlay !== "recorrido") {
      setTrack([]);
      return;
    }
    const cargar = () => {
      const hasta = Date.now();
      invoke<RouteStop[]>("get_track", {
        characterId: hereCharId ?? null,
        desdeMs: hasta - horasTrack * 3600_000,
        hastaMs: hasta,
      })
        .then(setTrack)
        .catch(() => setTrack([]));
    };
    cargar();
    // Al ritmo del sondeo de posición: mirando esta capa mientras vuelas, el rastro crece solo.
    const id = window.setInterval(cargar, 30_000);
    return () => window.clearInterval(id);
  }, [overlay, horasTrack, hereCharId]);

  // ---- VIAJES: lo que PASÓ, con sus incidentes (2026-08-12) ----
  // No hay tabla de viajes: el Rust los DEDUCE de `location_track` cada vez que se piden. Así, el
  // día que cambien los umbrales, el pasado se recalcula solo en vez de convivir con dos criterios.
  // Ver el comentario largo de `get_trips` en commands.rs.
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripOpen, setTripOpen] = useState<number | null>(null);
  useEffect(() => {
    if (overlay !== "recorrido") {
      setTrips([]);
      return;
    }
    const hasta = Date.now();
    invoke<Trip[]>("get_trips", {
      characterId: hereCharId ?? null,
      desdeMs: hasta - horasTrack * 3600_000,
      hastaMs: hasta,
      paradaMin: null,
      cegueraMin: null,
      minSaltos: null,
      previoMin: null,
    })
      .then(setTrips)
      .catch(() => setTrips([]));
  }, [overlay, horasTrack, hereCharId, track.length]);

  /** ---- VIAJES AGRUPADOS: un movimiento, no N pilotos ----
   *
   *  El Rust trocea POR PILOTO, y tiene que hacerlo: si mezclara personajes se inventaría viajes
   *  saltando de un alt a otro. Pero al enseñarlo, tres alts moviéndose juntos **no son tres
   *  viajes**: son una flota tuya. Con 9 personajes la lista se llenaba de repetidos idénticos.
   *
   *  ⚠️ CUÁNDO SON «EL MISMO»: mismo recorrido exacto (la lista de sistemas, en orden) **y**
   *  ventanas de tiempo que se solapan. Las dos condiciones hacen falta: solo el recorrido juntaría
   *  el viaje de hoy con el mismo trayecto de la semana pasada; solo el tiempo juntaría a dos alts
   *  que casualmente volaban a la vez por sitios distintos.
   *
   *  Los INCIDENTES se suman entre pilotos a propósito: si a uno de la flota le mataron, eso pasó
   *  en el viaje, no «en el viaje de otro».
   */
  type ViajeGrupo = {
    key: string;
    base: Trip;
    pilotos: string[];
    events: Trip["events"];
  };
  const viajesAgrupados = useMemo<ViajeGrupo[]>(() => {
    const out: ViajeGrupo[] = [];
    for (const v of trips) {
      const ruta = v.legs.map((l) => l.system_id).join(">");
      const g = out.find(
        (x) =>
          x.base.legs.map((l) => l.system_id).join(">") === ruta &&
          // Solapan si ninguno acaba antes de que el otro empiece.
          x.base.started_ms <= v.ended_ms &&
          v.started_ms <= x.base.ended_ms,
      );
      if (g) {
        if (!g.pilotos.includes(v.name)) g.pilotos.push(v.name);
        g.events = [...g.events, ...v.events].sort((a, b) => a.ts_ms - b.ts_ms);
      } else {
        out.push({ key: `${v.character_id}-${v.started_ms}`, base: v, pilotos: [v.name], events: v.events });
      }
    }
    return out;
  }, [trips]);

  /** El rótulo de un viaje. En una IDA Y VUELTA, «C-J6MT → C-J6MT» no dice nada: lo que quieres
   *  saber es **hasta dónde llegaste**, no que volviste a casa. Se usa el punto medio del recorrido,
   *  que en un trayecto de ida y vuelta ES el punto de retorno. */
  const rotuloViaje = useCallback(
    (v: Trip): { txt: string; vuelta: boolean } => {
      if (v.from_system !== v.to_system || v.legs.length < 3) {
        return { txt: `${nameOf(v.from_system)} → ${nameOf(v.to_system)}`, vuelta: false };
      }
      // El punto MÁS ADENTRADO del recorrido, no el del medio. El medio falla en cuanto el viaje
      // pasa por casa a mitad de camino —dos vueltas cortas seguidas— y entonces el rótulo repite
      // el origen y no dice nada, que es justo lo que veníamos a arreglar.
      // «Adentrado» = lo lejos que está de CUALQUIERA de los dos extremos: `min(i, últimos-i)`.
      const n = v.legs.length - 1;
      let lejos: number | null = null;
      let mejor = -1;
      v.legs.forEach((l, i) => {
        if (l.system_id === v.from_system) return; // casa no cuenta como destino
        const hondura = Math.min(i, n - i);
        if (hondura > mejor) {
          mejor = hondura;
          lejos = l.system_id;
        }
      });
      if (lejos == null) {
        // Todo el viaje fue dentro del mismo sistema: raro, pero no vamos a inventar un destino.
        return { txt: `${nameOf(v.from_system)} ↻`, vuelta: true };
      }
      return { txt: `${nameOf(v.from_system)} ↻ ${nameOf(lejos)}`, vuelta: true };
    },
    [nameOf],
  );

  /** EL VIAJE ELEGIDO, listo para pintar. `tripOpen` es el `started_ms` del que está desplegado en
   *  la pestaña Viajes: abrir uno y verlo en el mapa son la misma acción, no dos.
   *
   *  El recorrido de un viaje se pinta APARTE del rastro general y encima de él: el rastro dice
   *  «por aquí anduviste estas horas», y el viaje dice «ESTE trayecto, con lo que pasó». Si
   *  compartieran trazo no se distinguiría uno del otro. */
  const grupoSel = useMemo(
    () => (tripOpen == null ? null : (viajesAgrupados.find((g) => g.base.started_ms === tripOpen) ?? null)),
    [viajesAgrupados, tripOpen],
  );
  const viajeSel = grupoSel?.base ?? null;

  const viajeSegs = useMemo(() => {
    if (!geo || !viajeSel) return null;
    const segs: { key: string; a: number; b: number; ciego: boolean }[] = [];
    for (let i = 1; i < viajeSel.legs.length; i++) {
      const prev = viajeSel.legs[i - 1];
      const cur = viajeSel.legs[i];
      segs.push({
        key: `vj-${i}`,
        a: prev.system_id,
        b: cur.system_id,
        // La ceguera se dibuja distinta SIEMPRE: un tramo con hueco no es un salto observado, y
        // pintarlo igual sería afirmar un camino que nadie vio. Misma regla que el rastro.
        ciego: cur.blind_before_ms > 0,
      });
    }
    // Los incidentes, agrupados por sistema: en uno pueden pasar varias cosas.
    const porSistema = new Map<number, { intel: number; loss: number; kill: number }>();
    for (const e of (grupoSel?.events ?? viajeSel.events)) {
      const x = porSistema.get(e.system_id) ?? { intel: 0, loss: 0, kill: 0 };
      x[e.kind] += 1;
      porSistema.set(e.system_id, x);
    }
    return { segs, porSistema };
  }, [geo, viajeSel, grupoSel]);

  /** Tramos del recorrido, por piloto y en orden. Cada uno sabe si viene de un salto real
   *  (sistemas vecinos en el grafo), de un tramo que no vimos entero, o de un rato ciego. */
  const trackSegs = useMemo(() => {
    if (!geo || overlay !== "recorrido" || track.length === 0) return null;
    // Más de 3 sondeos sin vernos = ceguera. Mismo corte que usa `track_note` en Rust.
    const CIEGO_MS = 90_000;
    const porPiloto = new Map<number, RouteStop[]>();
    for (const t of track) {
      const arr = porPiloto.get(t.character_id) ?? [];
      arr.push(t);
      porPiloto.set(t.character_id, arr);
    }
    const segs: {
      key: string;
      a: number;
      b: number;
      kind: "salto" | "sinver" | "ciego";
      name: string;
    }[] = [];
    for (const [cid, pts] of porPiloto) {
      for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1];
        const cur = pts[i];
        const hueco = cur.entered_ms - prev.seen_ms;
        const vecinos = (geo.adj.get(prev.system_id) ?? []).includes(cur.system_id);
        segs.push({
          key: `tk-${cid}-${i}`,
          a: prev.system_id,
          b: cur.system_id,
          // Vecinos y sin hueco = lo vimos saltar. Vecinos con hueco, o no vecinos: pasó algo en
          // medio que no presenciamos. Se distingue porque una línea recta entre dos sistemas
          // lejanos, pintada igual que un salto, sería una ruta inventada.
          kind: hueco > CIEGO_MS ? "ciego" : vecinos ? "salto" : "sinver",
          name: cur.name,
        });
      }
    }
    return { segs, porPiloto };
  }, [geo, overlay, track]);

  // Re-apuntado MANUAL: si clicas un sistema durante la interceptación, la ruta va ahí (desde tu
  // cazador) en vez de al último avistamiento. Manda sobre el seguimiento hasta que apagues o
  // cambies de objetivo. null = sin override, sigue al perseguido.
  const [manualTarget, setManualTarget] = useState<number | null>(null);
  // Último sistema donde se vio al perseguido = destino de la caza. El rastro viene de más viejo a
  // más nuevo (el marcador de flecha ya apunta al final), así que el último punto es el más fresco.
  const huntTarget = useMemo(() => {
    const t = interceptPilot ? huntTracks.get(interceptPilot) : undefined;
    if (!t || t.length === 0) return null;
    return t[t.length - 1].system_id;
  }, [huntTracks, interceptPilot]);
  // Al cambiar de objetivo se olvida el re-apuntado manual (te re-enganchas al nuevo).
  useEffect(() => {
    setManualTarget(null);
  }, [interceptPilot]);
  // Nombres seguidos en minúsculas, para cotejar contra los pilotos de cada aviso sin repetir el
  // toLowerCase en cada pintado del mapa.
  const huntSet = useMemo(
    () => new Set(huntPilots.map((p) => p.toLowerCase())),
    [huntPilots]
  );

  // --- Intel: círculos en el mapa (rojo, opacidad por recencia) ---
  const intelCircles = useMemo(() => {
    if (!geo || overlay !== "intel" || !intelReports) return null;
    const now = Date.now();
    const recencyMs = (intel?.recency ?? 30) * 60000;
    return [...intelReports.rep.entries()].map(([sid, r]) => {
      const s = geo.idx.get(sid);
      if (!s) return null;
      const p = geo.proj(s);
      const op = Math.max(0.18, 1 - (now - r.ts) / recencyMs);
      const j = jumpsFrom?.get(sid);
      // `h` = tu tiempo de llegada usando también los puentes. NO entra en `near` ni en el filtro:
      // la alarma y el rango siguen mandando sobre `j`, que es lo que mide la amenaza.
      const h = huntFrom?.get(sid);
      const near = j != null && j <= (intel?.alertJumps ?? 0);
      // Filtro "solo en rango": oculta lo que esté fuera del umbral de saltos.
      if (intel?.onlyRange && !near) return null;
      // ¿El aviso menciona a alguien que sigues? Entonces se pinta MORADO (el mismo de los botones
      // de Seguir/Interceptar) en vez de rojo: con el mapa lleno de alertas, la que te importa tiene
      // que cantar sola. El resto siguen en rojo, que es la amenaza genérica.
      const tracked = huntSet.size > 0 && r.pilots.some((p) => huntSet.has(p.toLowerCase()));
      const col = tracked ? "#ff6ad5" : "#ff3b3b";
      return (
        <g
          key={`intel-${sid}`}
          style={{ cursor: "pointer" }}
          onClick={(e) => {
            e.stopPropagation();
            if (movedRef.current) return; // fue un paneo
            // Clicar un punto rojo SIEMPRE abre su aviso. Antes, con el modo Ruta activo (que la
            // interceptación enciende sola), el click se desviaba a «poner parada» y el aviso ya no
            // salía: comportamiento distinto según el modo = confuso. Para rutar a un sistema con
            // alerta está el botón «Destino» dentro del propio aviso, que es explícito.
            openIntelDetail({ sysId: sid, sysName: s.n, ts: r.ts, author: r.author, message: r.message });
          }}
        >
          {/* Solo los sistemas cercanos pulsan (animación). Los lejanos = anillo estático
              → reduce drásticamente el nº de animaciones SMIL y el repintado del SVG. */}
          {near ? (
            <g transform={`translate(${p.px} ${p.py})`} pointerEvents="none">
              <circle
                className="intel-ring-pulse"
                r={cappedR(2.8, 10, view.z)}
                fill="none"
                stroke={col}
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                style={{ ["--intel-op"]: op * 0.85 } as React.CSSProperties}
              />
            </g>
          ) : (
            <circle
              cx={p.px}
              cy={p.py}
              r={cappedR(4.2, 14, view.z)}
              fill="none"
              stroke={col}
              strokeOpacity={op * 0.3}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          )}
          {/* Halo extra para los seguidos: destaca aunque el punto quede lejos y pequeño. */}
          {tracked && (
            <circle
              cx={p.px}
              cy={p.py}
              r={cappedR(6.4, 20, view.z)}
              fill="none"
              stroke={col}
              strokeOpacity={op * 0.5}
              strokeWidth={1.2}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          )}
          {/* zona de click ampliada (invisible) para acertar fácil el punto + tooltip */}
          <circle cx={p.px} cy={p.py} r={cappedR(5.2, 18, view.z)} fill="transparent">
            {/* Dos cifras y bien separadas: los saltos por PUERTA (lo que mide la amenaza) y, si
                hay red importada y acorta, en cuánto llegas TÚ usando además tus Ansiblex. */}
            <title>{`${s.n}${j != null ? ` · ${j} ${tr("saltos")}` : ""}${
              h != null && j != null && h < j ? ` · ${tr("llegas en")} ${h} (Ansiblex)` : ""
            }\n${r.author}: ${r.message}\n${tr("(clic para ver detalle)")}`}</title>
          </circle>
          <circle
            cx={p.px}
            cy={p.py}
            r={cappedR(tracked ? 3.2 : 2.6, tracked ? 10 : 8.4, view.z)}
            fill={col}
            fillOpacity={op}
            stroke="#0a0d12"
            strokeWidth={0.7}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        </g>
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, overlay, intelReports, jumpsFrom, huntFrom, intel?.recency, intel?.alertJumps, intel?.onlyRange, huntSet, view.z]);

  // --- Intel: marcadores de los puntos de ancla (anclas de proximidad) ---
  const intelAnchorMarkers = useMemo(() => {
    if (!geo || overlay !== "intel") return null;
    const z = view.z;
    return (intel?.anchors ?? []).map((sid) => {
      const s = geo.idx.get(sid);
      if (!s) return null;
      const p = geo.proj(s);
      return (
        <g key={`anchor-${sid}`} pointerEvents="none">
          <circle
            cx={p.px}
            cy={p.py}
            r={2.4 / z}
            fill="none"
            stroke="#5ad6ff"
            strokeWidth={0.5 / z}
            strokeDasharray={`${1.1 / z} ${0.9 / z}`}
          />
          <text
            x={p.px}
            y={p.py + 0.9 / z}
            textAnchor="middle"
            style={{ fontSize: `${2.6 / z}px` }}
            fill="#5ad6ff"
          >
            ⚓
          </text>
        </g>
      );
    });
  }, [geo, overlay, intel?.anchors, view.z]);

  /** ¿Está este sistema silenciado AHORA? Se compara con el reloj en vez de limpiar la lista:
   *  un silencio de una hora tiene que dejar de callar solo, sin que nadie pase a barrer. */
  const estaSilenciado = useCallback(
    (sid: number) => {
      const now = Date.now();
      return (intel?.muted ?? []).some((m) => m.system_id === sid && (m.until_ms == null || m.until_ms > now));
    },
    [intel?.muted],
  );

  /** Silencia / desilencia un sistema. `horas` undefined = indefinido. */
  const alternarSilencio = useCallback(
    (sid: number, horas?: number) => {
      if (!intel) return;
      const now = Date.now();
      const vivos = (intel.muted ?? []).filter((m) => m.until_ms == null || m.until_ms > now);
      const ya = vivos.some((m) => m.system_id === sid);
      intel.onConfig({
        muted: ya
          ? vivos.filter((m) => m.system_id !== sid)
          : [...vivos, { system_id: sid, until_ms: horas ? now + horas * 3600_000 : null }],
      });
    },
    [intel],
  );

  // --- Intel: marcadores de los sistemas SILENCIADOS ---
  //
  // Existe por seguridad, no por adorno. Un sistema callado por silencio es indistinguible de uno
  // sin intel: sin esta marca, el silencio es una trampa que te pones tú y se te olvida. Va en la
  // capa de intel, junto a las anclas, y en ámbar apagado para no competir con los avisos.
  const intelMutedMarkers = useMemo(() => {
    if (!geo || overlay !== "intel") return null;
    const z = view.z;
    const now = Date.now();
    return (intel?.muted ?? [])
      .filter((m) => m.until_ms == null || m.until_ms > now)
      .map((m) => {
        const s = geo.idx.get(m.system_id);
        if (!s) return null;
        const p = geo.proj(s);
        // Desplazado a la derecha porque el ⚓ del ancla se pinta en el MISMO punto: un sistema
        // anclado y silenciado a la vez —que es un caso muy normal, tu staging— dibujaba los dos
        // emojis encima y no se leía ninguno.
        const dx = (intel?.anchors ?? []).includes(m.system_id) ? 2.6 / z : 0;
        return (
          <g key={`muted-${m.system_id}`} pointerEvents="none">
            <text
              x={p.px + dx}
              y={p.py + 0.9 / z}
              textAnchor="middle"
              style={{ fontSize: `${2.6 / z}px`, opacity: 0.75 }}
              fill="#d8a03a"
            >
              🔇
            </text>
          </g>
        );
      });
  }, [geo, overlay, intel?.muted, intel?.anchors, view.z]);

  // --- Intel: tarjeta de detalle (piloto/nave/ruta/zKill) ---
  const [intelDetail, setIntelDetail] = useState<{
    sysId: number | null;
    sysName: string | null;
    ts: number;
    author: string;
    message: string;
  } | null>(null);
  // Capa de Intel: ficha de detalle + panel de config (hook useIntel, Tanda A).
  const {
    intelEntities,
    setIntelEntities,
    intelEntLoading,
    intelTrackPilot,
    setIntelTrackPilot,
    cfgOpen,
    setCfgOpen,
    anchorInput,
    setAnchorInput,
    intelDetailCount,
    intelAlert,
    setIntelAlert,
  } = useIntel({ geo, ne, intel, overlay, intelDetail, shipNames, intelReports, intelOrigins, charLocations: intelPilots });
  // La FICHA del hostil vive ahora en la sección PvP → Cazador (onOpenCazador). El mapa solo
  // conserva feed + proximidad + rastro (huntTrack).
  // --- Hostiles habituales (aprendidos del intel por nº de menciones) ---
  type HabitualHostile = {
    name_lower: string;
    character_id: number | null;
    name: string;
    seen_count: number;
    last_seen: string | null;
    last_system_id: number | null;
  };
  const [habitualOpen, setHabitualOpen] = useState(false);
  const [habitual, setHabitual] = useState<HabitualHostile[] | null>(null);
  async function loadHabitual() {
    try {
      const r = await invoke<HabitualHostile[]>("get_habitual_hostiles", {
        minCount: 3,
        limit: 100,
      });
      setHabitual(r);
    } catch {
      setHabitual([]);
    }
  }

  // Abre la ficha de un aviso en la tarjeta de la derecha. La tarjeta de detalle, el panel de
  // sistema y la de habituales COMPARTEN ese sitio, así que abrir una cierra las otras dos.
  // (Aquí había un comentario suelto sobre «generar candidatos» que describía una función ya
  //  desaparecida; se sustituye por lo que de verdad hay debajo.)
  function openIntelDetail(r: {
    sysId: number | null;
    sysName: string | null;
    ts: number;
    author: string;
    message: string;
  }) {
    setSelected(null); // la tarjeta de detalle y el panel de sistema comparten sitio (derecha)
    setHabitualOpen(false); // y también con la tarjeta de habituales
    setIntelDetail(r);
    setIntelEntities(null);
    setIntelTrackPilot(null);
    setRightTab("aviso"); // al abrir un aviso, la tarjeta salta a su pestaña
    setCardOpen(true); // y se despliega, si estaba plegada
    // Y CENTRAR el mapa en el sistema del aviso: por aquí pasan el feed, el aviso flotante y los
    // saltos calientes de la ruta — un solo enganche cubre a los tres. Siempre es un clic del
    // usuario, así que la regla de «la cámara solo se mueve si se le pide» se cumple sola.
    focusSystem(r.sysId);
  }

  // Clic en el aviso FLOTANTE → abre aquí su ficha completa (seguir, interceptar, ficha del
  // hostil, poner destino). El `nonce` es la dependencia y no el `sysId`: pinchar dos veces el
  // mismo aviso tiene que volver a abrirlo, y con el id solo React no vería cambio alguno.
  useEffect(() => {
    if (!openIntelReq) return;
    openIntelDetail({
      sysId: openIntelReq.sysId,
      sysName: openIntelReq.sysName,
      ts: openIntelReq.ts,
      author: openIntelReq.author,
      message: openIntelReq.message,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openIntelReq?.nonce]);



  // Polilínea de la ruta del piloto seleccionado (sobre el grafo del mapa).
  // EL COLOR LO DA EL PAPEL, NO LA FUENTE DEL DATO: rojo = a quien persigues, morado = a quien
  // vigilas. Antes «Interceptando ✓» no pintaba nada rojo porque el rastro rojo colgaba de otro
  // estado (`intelTrackPilot`, el botón «Trazar ruta según reportes» de la ficha). Y como solo se
  // puede interceptar a alguien a quien YA sigues, encender los dos habría dibujado dos rastros del
  // mismo piloto encima. Así que el que colorea es `huntTrackLine` (abajo) y este rastro efímero se
  // calla cuando el piloto ya va por esa vía, que además guarda más historia.
  const trailMin = intel?.trailMin ?? 60;
  const intelTrackLine = useMemo(() => {
    if (!geo || overlay !== "intel" || !intelTrackPilot) return null;
    if (huntTracks.has(intelTrackPilot)) return null;
    const cutoff = trailMin > 0 ? Date.now() - trailMin * 60000 : 0;
    const track = pilotTrack(intelTrackPilot, intelReports?.feed ?? []).filter((t) => t.ts >= cutoff);
    const pts = track
      .map((t) => ({ s: geo.idx.get(t.sysId), ts: t.ts }))
      .filter((x): x is { s: NeSystem; ts: number } => !!x.s)
      .map((x) => ({ ...geo.proj(x.s), ts: x.ts }));
    if (pts.length < 1) return null;
    const first = pts[0];
    const last = pts[pts.length - 1];
    const dot = cappedR(TRACK_DOT, 3.2, view.z);
    return (
      <g>
        {/* Un TRAMO por salto, atenuado según su antigüedad: el más viejo al 20 %, el último a plena
            luz. Sin esto, un rastro largo era una maraña uniforme en la que no se sabía por dónde
            había empezado. Se dibuja tramo a tramo (y no una polilínea única) precisamente porque
            cada uno lleva su propia opacidad. */}
        {pts.slice(0, -1).map((a, i) => {
          const b = pts[i + 1];
          return (
            <line
              key={`ts-${i}`}
              x1={a.px}
              y1={a.py}
              x2={b.px}
              y2={b.py}
              stroke={INTERCEPT}
              strokeOpacity={0.2 + 0.8 * ((i + 1) / (pts.length - 1))}
              strokeWidth={1.8}
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
            />
          );
        })}
        {trailArrows(pts, INTERCEPT, view.z, { fade: true, size: 9 })}
        {/* Puntos del rastro a MEDIA alerta (ver TRACK_DOT): el sistema donde está el objetivo suele
            tener además su propio aviso rojo, y el punto del rastro lo tapaba. */}
        {pts.slice(1, -1).map((p, i) => (
          <circle key={`tk-${i}`} cx={p.px} cy={p.py} r={dot * 0.7} fill={INTERCEPT_DIM} />
        ))}
        {/* origen (hueco) */}
        <circle cx={first.px} cy={first.py} r={dot * 0.85} fill="#0a0d12" stroke={INTERCEPT_DIM} strokeWidth={0.25}>
          <title>{tr("Origen")}</title>
        </circle>
        {/* destino / posición más reciente */}
        {pts.length >= 2 && (
          <circle cx={last.px} cy={last.py} r={dot} fill={INTERCEPT} stroke="#0a0d12" strokeWidth={0.15}>
            <title>{tr("Último reporte")}</title>
          </circle>
        )}
        {/* La EDAD del último avistamiento. La atenuación da el orden de los saltos, no el reloj: sin
            esta cifra, «estuvo ahí hace 40 segundos» y «hace 20 minutos» se dibujan igual, y son
            decisiones opuestas para el que persigue. */}
        <text
          x={last.px}
          y={last.py + ageOffset(view.z)}
          textAnchor="middle"
          className="map-trail-age"
          style={{ fontSize: `${12 / view.z}px`, fill: INTERCEPT }}
          pointerEvents="none"
        >
          {fmtAge(last.ts)}
        </text>
      </g>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, overlay, intelTrackPilot, huntTracks, intelReports, view.z, trailMin, ageTick]);

  // Modo cazador: polilínea del rastro HISTÓRICO del objetivo (de la tabla intel_sightings, persiste
  // entre sesiones). Color magenta para distinguirlo del rastro de sesión (naranja). Colapsa sistemas
  // consecutivos repetidos y dibuja flujo direccional + flecha al último avistamiento.
  const huntTrackLine = useMemo(() => {
    if (!geo || overlay !== "intel" || huntTracks.size === 0) return null;
    // Un rastro por piloto seguido. El que estás interceptando va más marcado; los demás, atenuados,
    // para que se vea a quién persigues sin perder de vista dónde andan los otros.
    const cutoff = trailMin > 0 ? Date.now() - trailMin * 60000 : 0;
    const lines = [...huntTracks.entries()].map(([name, track]) => {
      if (!track || track.length === 0) return null;
      // El rastro CADUCA: `get_pilot_track` devuelve hasta 200 avistamientos y en una sesión larga
      // acababas con líneas de hace horas compitiendo por la vista con las de ahora mismo. Se filtra
      // aquí y no en la consulta para que cambiar el umbral no obligue a ir a la base de datos.
      const fresh = track.filter((p) => p.ts_ms >= cutoff);
      if (fresh.length === 0) return null;
      // Colapsa sistemas consecutivos repetidos, quedándose con el ts del PRIMER paso por él.
      const seq: { sid: number; ts: number }[] = [];
      for (const p of fresh) {
        if (seq.length === 0 || seq[seq.length - 1].sid !== p.system_id)
          seq.push({ sid: p.system_id, ts: p.ts_ms });
      }
      const pts = seq
        .map((q) => ({ s: geo.idx.get(q.sid), ts: q.ts }))
        .filter((x): x is { s: NeSystem; ts: number } => !!x.s)
        .map((x) => ({ ...geo.proj(x.s), ts: x.ts }));
      if (pts.length < 1) return null;
      const first = pts[0];
      const last = pts[pts.length - 1];
      const main = interceptPilot === name;
      // ROJO al que persigues, morado a los demás: pulsar «Interceptar» tiene así una consecuencia
      // inmediata e inconfundible en el mapa, sin añadir un segundo trazo encima del suyo.
      const col = main ? INTERCEPT : HUNT;
      const op = main ? 1 : 0.45;
      const dot = cappedR(TRACK_DOT, 3.2, view.z);
      return (
        <g key={`hunt-${name}`} opacity={op}>
          {/* Tramo a tramo, atenuado de lo más VIEJO a lo más NUEVO (20 % → 100 %). Fuera el halo
              ancho que llevaba debajo: sumado al trazo hacía una cinta gruesa y era la mitad del
              «demasiado grande». Aquí manda la dirección, no el grosor. */}
          {pts.slice(0, -1).map((a, i) => {
            const b = pts[i + 1];
            return (
              <line
                key={`hs-${i}`}
                x1={a.px}
                y1={a.py}
                x2={b.px}
                y2={b.py}
                stroke={col}
                strokeOpacity={0.2 + 0.8 * ((i + 1) / (pts.length - 1))}
                strokeWidth={main ? 1.5 : 1.1}
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
                strokeDasharray="4 5"
              />
            );
          })}
          {trailArrows(pts, col, view.z, { fade: true, size: main ? 9 : 7.2 })}
          {/* Puntos a MEDIA alerta: el último avistamiento cae justo donde el sistema puede tener un
              aviso nuevo de OTRO piloto, y antes (r=1.6, mayor que la propia alerta) lo tapaba. */}
          {pts.slice(1, -1).map((p, i) => (
            <circle key={`h-${i}`} cx={p.px} cy={p.py} r={dot * 0.7} fill={col} fillOpacity={0.55} />
          ))}
          <circle cx={first.px} cy={first.py} r={dot * 0.85} fill="#0a0d12" stroke={col} strokeWidth={0.25}>
            <title>{`${name} — ${tr("Primer avistamiento")}`}</title>
          </circle>
          {pts.length >= 2 && (
            <circle cx={last.px} cy={last.py} r={dot} fill={col} stroke="#0a0d12" strokeWidth={0.15}>
              <title>{`${name} — ${tr("Último avistamiento")}`}</title>
            </circle>
          )}
          {/* Edad del último avistamiento. Con VARIOS seguidos es lo que separa «este acaba de pasar»
              de «este lleva media hora sin aparecer», que con solo la línea se ven idénticos. */}
          <text
            x={last.px}
            y={last.py + ageOffset(view.z)}
            textAnchor="middle"
            className="map-trail-age"
            style={{ fontSize: `${12 / view.z}px`, fill: col }}
            pointerEvents="none"
          >
            {fmtAge(last.ts)}
          </text>
        </g>
      );
    });
    if (lines.every((l) => l === null)) return null;
    return <g>{lines}</g>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, overlay, huntTracks, interceptPilot, view.z, trailMin, ageTick]);

  // Combustible (isótopos) y distancia al destino elegido.
  // fuel = dist(LY) × fuelPerLy × (1 − 10%·Jump Fuel Conservation).
  const jumpFuel = useMemo(
    () => computeJumpFuel(geo, selShip, jumpOrigin, jumpDest, jfcLevel, jumpRange),
    [geo, selShip, jumpOrigin, jumpDest, jfcLevel, jumpRange],
  );

  // Estimación del salto al destino: cooldown de activación y fatiga resultante.
  // Fórmula EVE (EVE Uni): cooldown = max(1+LY, fatigaPre/10) [máx 30 min];
  // fatiga nueva = max(10·(1+LY), fatigaPre·(1+LY)) [máx 5 h]. Las JF/Rorqual reducen
  // mucho la fatiga (bono de rol −90% sobre la distancia efectiva): mostramos el máximo.
  const jumpFatEst = useMemo(
    () => computeJumpFatEst(selShip, jumpFuel, curFatMin),
    [selShip, jumpFuel, curFatMin],
  );

  // Sistemas alcanzables por salto de capital (low/null dentro del rango LY).
  const jumpReach = useMemo(
    () => computeJumpReach(geo, jumpOrigin, jumpRange),
    [geo, jumpOrigin, jumpRange],
  );

  // Grafo sobre el que se rutea. El de stargates tal cual, más las aristas EXTRA que estén
  // encendidas: Ansiblex (puentes de la alianza) y/o wormholes (Thera/Turnur de eve-scout). Copiamos
  // solo los arrays que tocamos, para no mutar `geo.adj` (lo comparten la proximidad de intel y el
  // BFS — a propósito: la ALARMA nunca cuenta con puentes ni WH, solo puertas).
  const routeAdj = useMemo(() => {
    if (!geo) return null;
    const addAnsi = ansi && useAnsiblex;
    const addWh = wh && useWormholes;
    const addSigWh = sigWh && useSigWormholes;
    if (!addAnsi && !addWh && !addSigWh) return geo.adj;
    const merged = new Map(geo.adj);
    const extra = (src: Map<number, number[]>) => {
      for (const [from, tos] of src) {
        merged.set(from, [...(merged.get(from) ?? []), ...tos]);
      }
    };
    if (addAnsi) extra(ansi!.adj);
    if (addWh) extra(wh!.adj);
    if (addSigWh) extra(sigWh!.adj);
    return merged;
  }, [geo, ansi, useAnsiblex, wh, useWormholes, sigWh, useSigWormholes]);

  // Interceptación: mientras esté activa, la ruta la MANDA el objetivo, no las paradas manuales.
  // Origen = tu cazador (personaje activo). Destino = último sistema donde lo vieron. Al moverse él,
  // `huntTarget` cambia y esto re-traza. Si perdemos su rastro o tu posición, se apaga sola: una
  // ruta de caza a un fantasma engaña más que ayuda.
  useEffect(() => {
    if (!intercepting) return;
    // El destino: lo que hayas clicado a mano, o si no, el último avistamiento del perseguido.
    const dest = manualTarget ?? huntTarget;
    if (hereSystemId == null || dest == null || hereSystemId === dest) return;
    setRouteStops([hereSystemId, dest]);
  }, [intercepting, hereSystemId, huntTarget, manualTarget, setRouteStops]);
  // Se apaga si dejas de seguir al piloto (el chip desaparece y no tendría objetivo).
  useEffect(() => {
    if (intercepting && (!interceptPilot || !huntPilots.includes(interceptPilot))) {
      setIntercepting(false);
      setInterceptPilot(null);
    }
  }, [intercepting, interceptPilot, huntPilots]);
  // Cuando la interceptación se APAGA (por el botón, por el ✕ del rastro o porque perdimos al
  // piloto), hay que borrar SU ruta: si no, la línea amarilla y la lista se quedan colgadas sobre
  // el mapa (justo el solapamiento que se veía al quitar el seguimiento). Un solo sitio para las
  // tres vías de apagado, con un ref para distinguir «se acaba de apagar» de «lleva rato apagada».
  const wasIntercepting = useRef(false);
  useEffect(() => {
    if (wasIntercepting.current && !intercepting) {
      setRouteStops([null]);
      setManualTarget(null);
    }
    wasIntercepting.current = intercepting;
  }, [intercepting, setRouteStops]);

  const routePath = useMemo(() => {
    if (!geo || !routeAdj) return null;
    const stops = routeStops.filter((s): s is number => s != null);
    if (stops.length < 2) return null;
    const full: number[] = [];
    for (let i = 0; i < stops.length - 1; i++) {
      const seg = findRoute(routeAdj, geo.idx, stops[i], stops[i + 1], routeMode, avoid);
      if (!seg) return null;
      if (i === 0) full.push(...seg);
      else full.push(...seg.slice(1));
    }
    return full;
  }, [geo, routeAdj, routeStops, routeMode, avoid]);

  // ---- ¿HAY AVISOS DE INTEL EN LA RUTA QUE ACABAS DE TRAZAR? (idea de RoGiz7, 2026-08-12) ----
  //
  // Hasta hoy las dos capas convivían en el mapa pero NO se hablaban: el intel pintaba sistemas
  // calientes, el planificador trazaba una línea, y eras tú quien miraba si se cruzaban. Es una
  // intersección de dos conjuntos que ya estaban los dos en memoria: cero ESI, cero BD, cero SDE.
  //
  // TRES DECISIONES, que son lo que separa esto de un contador inútil:
  //  1. **Se recorre `routePath`, no los vecinos.** Con Ansiblex y wormholes la ruta NO es una
  //     cadena de sistemas contiguos; recalcular adyacencias daría una lista distinta a la que se
  //     está pintando en amarillo.
  //  2. **Manda la ANTIGÜEDAD, y se reutiliza el umbral del feed (`intel.recency`).** Un aviso de
  //     hace 40 min en tu ruta no es lo mismo que uno de hace 2, y un umbral propio inventado aquí
  //     acabaría contradiciendo a la propia capa de intel. Un solo criterio en toda la app.
  //  3. **NO se filtra por capa.** El intel corre aunque estés mirando Ansiblex o Recorrido, y si
  //     hay un aviso en tu ruta lo quieres saber igual. Sin la capa Intel puesta no hay puntos rojos
  //     en el mapa, así que es justo cuando MÁS falta hace.
  //
  // ⚠️ Esto NO es una alarma y no debe sonar: el intel ya tiene la suya por proximidad
  // (ver koru-intel-defensa-vs-caza). Esto es información al PLANIFICAR.
  const intelEnRuta = useMemo(() => {
    if (!routePath || routePath.length < 2 || !intelReports || intelReports.rep.size === 0) return [];
    const now = Date.now();
    const ventanaMs = (intel?.recency ?? 30) * 60000;
    const out: { sid: number; name: string; ts: number; salto: number; count: number | null; author: string; message: string }[] = [];
    for (let i = 0; i < routePath.length; i++) {
      const r = intelReports.rep.get(routePath[i]);
      if (!r || now - r.ts > ventanaMs) continue;
      // `salto` es la posición en la ruta: el 0 es donde estás, así que «salto 4» se lee solo.
      out.push({ sid: routePath[i], name: r.name, ts: r.ts, salto: i, count: r.count, author: r.author, message: r.message });
    }
    return out;
    // `ageTick` entra a propósito: es el latido de 15 s que ya refresca las edades del intel. Sin él
    // un aviso caducaría en silencio y la lista seguiría enseñándolo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routePath, intelReports, intel?.recency, ageTick]);

  // Paradas de la ruta en orden (sin huecos). Es lo que se manda a EVE como waypoints: así se puede
  // forzar un camino con escalas (cazar pasando por X, o un viaje planificado), no solo el destino.
  const routeWaypoints = useMemo(
    () => routeStops.filter((s): s is number => s != null),
    [routeStops]
  );
  // ¿El personaje activo tiene el permiso de escribir waypoint? Si no, el botón lo explica en vez
  // de fallar con un 403 opaco.
  const canWaypoint = useMemo(() => {
    if (hereCharId == null) return false;
    const c = characters.find((x) => x.character_id === hereCharId);
    return !!c?.scopes?.includes("esi-ui.write_waypoint.v1");
  }, [hereCharId, characters]);
  const [sendingEve, setSendingEve] = useState(false);
  const [eveMsg, setEveMsg] = useState("");
  // Manda TODAS las paradas como waypoints en orden. El backend limpia con la primera y encadena el
  // resto. Con una sola parada = poner destino; con varias = fija la ruta con sus escalas en EVE.
  async function sendToEve(waypoints: number[]) {
    if (hereCharId == null || waypoints.length === 0) return;
    // Si la primera parada es donde ya estás (típico en interceptación: origen = tu sistema), la
    // quitamos: EVE rutea desde tu posición real, mandarla sería un waypoint redundante en tu propio
    // sistema. Pero si el origen es OTRO sistema (ruta planificada desde otro punto), se respeta.
    let wps = waypoints;
    if (wps.length > 1 && hereSystemId != null && wps[0] === hereSystemId) {
      wps = wps.slice(1);
    }
    setSendingEve(true);
    setEveMsg("");
    try {
      await invoke("set_ingame_route", {
        characterId: hereCharId,
        destinationIds: wps,
      });
      const last = geo?.idx.get(wps[wps.length - 1]);
      const n = wps.length;
      setEveMsg(
        n > 1
          ? `✓ ${tr("Ruta en EVE")}: ${n} ${tr("paradas")} → ${last?.n ?? ""}`
          : `✓ ${tr("Destino en EVE")}: ${last?.n ?? wps[0]}`
      );
    } catch (e) {
      setEveMsg(String(e).slice(0, 160));
    } finally {
      setSendingEve(false);
      window.setTimeout(() => setEveMsg(""), 5000);
    }
  }

  // Índices de la ruta a los que se llegó CRUZANDO UN PUENTE (no por stargate). Sirve para marcar
  // el tramo en la lista: un salto por Ansiblex no se prepara igual que uno por puerta.
  // Se exige que el par NO sea además vecino por stargate, para no etiquetar de puente un tramo
  // que también se podía hacer por puerta.
  const ansiLegs = useMemo(() => {
    const legs = new Set<number>();
    if (!routePath || !ansi || !useAnsiblex || !geo) return legs;
    for (let i = 1; i < routePath.length; i++) {
      const u = routePath[i - 1];
      const v = routePath[i];
      if (ansi.keys.has(edgeKey(u, v)) && !(geo.adj.get(u) ?? []).includes(v)) legs.add(i);
    }
    return legs;
  }, [routePath, ansi, useAnsiblex, geo]);

  // Arcos SOLO de los puentes que la ruta usa. En Intel pintar los 97 tapaba los avisos: ahí interesa
  // ver por dónde vas, no la telaraña entera de la alianza.
  const ansiRouteD = useMemo(() => {
    if (!geo || !routePath || ansiLegs.size === 0) return "";
    let d = "";
    for (const i of ansiLegs) {
      const u = routePath[i - 1];
      const v = routePath[i];
      // Orden canónico, para que el arco coincida exactamente con el de la red.
      const [a, b] = u < v ? [u, v] : [v, u];
      const sa = geo.idx.get(a);
      const sb = geo.idx.get(b);
      if (!sa || !sb) continue;
      d += ansiArc(geo.proj(sa), geo.proj(sb));
    }
    return d;
  }, [geo, routePath, ansiLegs]);

  // Marcas de los sistemas VETADOS. Se pintan en TODAS las capas, no solo con la ruta activa: es una
  // decisión tuya que afecta a cualquier cálculo, y hasta ahora solo se veía en la lista de abajo —
  // trazabas una ruta sin saber por dónde le estabas prohibiendo pasar.
  // Señal de prohibido (aro + barra), en rojo y a tamaño de pantalla constante (r / view.z).
  const avoidMarkers = useMemo(() => {
    if (!geo || avoid.size === 0) return null;
    // Señal de PROHIBIDO grande y opaca. Tiene que gritar: si el piloto no se entera de que bloqueó
    // un sistema, no entiende por qué la ruta da un rodeo. Cuatro capas para que se lea sobre
    // cualquier fondo (nodos, líneas de stargate, arcos de Ansiblex, heatmaps):
    //   resplandor exterior · disco oscuro que tapa lo de debajo · aro rojo grueso · barra diagonal.
    const R = 7;
    return [...avoid].map((sid) => {
      const s = geo.idx.get(sid);
      if (!s) return null;
      const p = geo.proj(s);
      const r = R / view.z;
      const d = (R * 0.66) / view.z; // media diagonal de la barra, inscrita en el aro
      const w = 1.9 / view.z;
      return (
        <g key={`avoid-${sid}`} pointerEvents="none">
          <circle
            cx={p.px}
            cy={p.py}
            r={r * 1.4}
            fill="none"
            stroke="#ff4d4d"
            strokeOpacity={0.22}
            strokeWidth={2.6 / view.z}
          />
          <circle cx={p.px} cy={p.py} r={r} fill="#12070a" fillOpacity={0.88} />
          <circle cx={p.px} cy={p.py} r={r} fill="none" stroke="#ff4d4d" strokeWidth={w} />
          <line
            x1={p.px - d}
            y1={p.py + d}
            x2={p.px + d}
            y2={p.py - d}
            stroke="#ff4d4d"
            strokeWidth={w}
            strokeLinecap="round"
          />
        </g>
      );
    });
  }, [geo, avoid, view.z]);

  // Igual pero para wormholes: índices a los que se llegó cruzando un WH (in-system ↔ hub).
  const whLegs = useMemo(() => {
    const legs = new Set<number>();
    if (!routePath || !wh || !useWormholes || !geo) return legs;
    for (let i = 1; i < routePath.length; i++) {
      const u = routePath[i - 1];
      const v = routePath[i];
      if (wh.keys.has(edgeKey(u, v)) && !(geo.adj.get(u) ?? []).includes(v)) legs.add(i);
    }
    return legs;
  }, [routePath, wh, useWormholes, geo]);

  // Y para TUS wormholes escaneados: los tramos de la ruta que cruzan un agujero tuyo anotado.
  const sigWhLegs = useMemo(() => {
    const legs = new Set<number>();
    if (!routePath || !sigWh || !useSigWormholes || !geo) return legs;
    for (let i = 1; i < routePath.length; i++) {
      const u = routePath[i - 1];
      const v = routePath[i];
      if (sigWh.keys.has(edgeKey(u, v)) && !(geo.adj.get(u) ?? []).includes(v)) legs.add(i);
    }
    return legs;
  }, [routePath, sigWh, useSigWormholes, geo]);

  // Pestañas disponibles de la tarjeta derecha: solo las que tienen algo que enseñar. Una pestaña
  // vacía es ruido, y si no hay ninguna la tarjeta entera desaparece y el mapa queda limpio.
  const rightTabs = useMemo(() => {
    // Orden de lectura del cazador: primero lo que acaba de pasar (el aviso), luego a quién sigues,
    // y la ruta al final — que es la consecuencia, no el punto de partida.
    const t: { id: RightTab; label: string; typeId?: number }[] = [];
    if (overlay === "intel" && intelDetail) t.push({ id: "aviso", label: `📡 ${tr("Aviso")}` });
    // La ficha del sistema entra aquí SOLO en Intel: en las demás capas flota arriba a la izquierda,
    // donde no estorba a nadie. Aquí la esquina ya está ocupada y compartir tarjeta es la salida.
    if (overlay === "intel" && selected != null && geo?.idx.get(selected))
      t.push({ id: "sistema", label: `🪐 ${tr("Sistema")}` });
    if (overlay === "intel" && huntPilots.length > 0)
      t.push({ id: "rastro", label: `🎯 ${tr("Rastro")}` });
    if (overlay === "intel" && habitualOpen)
      t.push({ id: "habituales", label: `👥 ${tr("Habituales")}` });
    if (routeActive) t.push({ id: "ruta", label: tr("Ruta"), typeId: 439 });
    // La op EN VIVO: el roster del FC junto al feed de intel — quién, con qué y dónde, sin salir
    // del mapa. 42530 = Skirmish Command Burst I, el mismo icono que la sección Flotas.
    if (fleetRoster && fleetRoster.members.some((m) => m.present))
      t.push({ id: "flota", label: tr("Flota"), typeId: 42530 });
    // E4: los mandos del reproductor, mientras hay una op reproduciéndose.
    if (playback) t.push({ id: "op", label: `▶ ${tr("Op")}` });
    // Los viajes solo tienen sentido mirando el Recorrido: es la misma capa, contada.
    // 439 = «1MN Afterburner I», verificado en `market_types.json` (grupo 542, Propulsion Module).
    // Lo eligió RoGiz7 y encaja solo: un viaje es movimiento, y el afterburner es EL módulo de
    // moverse. El emoji 🧳 se quedaba además en caja vacía en su Windows.
    if (overlay === "recorrido") t.push({ id: "viajes", label: tr("Viajes"), typeId: 439 });
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeActive, overlay, huntPilots, intelDetail, habitualOpen, selected, geo, fleetRoster, playback]);
  // Pinchar un sistema en el mapa es un acto deliberado: la tarjeta salta a su pestaña. Sin esto
  // seleccionas un sistema, no ves nada cambiar y parece que el clic no ha hecho nada.
  useEffect(() => {
    if (overlay === "intel" && selected != null) setRightTab("sistema");
  }, [selected, overlay]);
  // Si la pestaña activa deja de existir (cerraste el aviso, soltaste el rastro…), cae a la primera
  // disponible en vez de dejar la tarjeta en blanco.
  useEffect(() => {
    if (rightTabs.length > 0 && !rightTabs.some((t) => t.id === rightTab)) {
      setRightTab(rightTabs[0].id);
    }
  }, [rightTabs, rightTab]);

  // (Aquí vivió un ResizeObserver que empujaba la ficha de sistema por debajo de la columna derecha
  // para que no se solaparan. Lo sustituye la pestaña «Sistema»: con la tarjeta de Ruta desplegada,
  // el empujón dejaba la ficha fuera de la pantalla. Un solapamiento se ve; quedarse fuera, no.)

  if (!ne || !geo) return <p className="muted">{tr("Cargando mapa…")}</p>;

  const pvp = data ?? [];
  // spread NO: New Eden tiene ~5.000 sistemas y esto crece. Ver maxOf en charts.tsx.
  const maxAct = maxOf(pvp.map((d) => d.kills + d.losses), 1);
  const totalKills = pvp.reduce((s, d) => s + d.kills, 0);
  const totalLosses = pvp.reduce((s, d) => s + d.losses, 0);
  const labeled = new Set(
    [...pvp]
      .sort((a, b) => b.kills + b.losses - (a.kills + a.losses))
      .slice(0, 12)
      .map((d) => d.system_id)
  );

  // Salud de PI → color por horas del peor extractor (gris = sin extractor programado).
  const piHealthColor = (h: number | null): string =>
    h == null ? "#8a8a8a" : h <= 0 ? "#e5534b" : h <= 6 ? "#f0883e" : h <= 24 ? "#d29922" : "#3fb950";
  const liveMap =
    overlay === "kills"
      ? liveKills
      : overlay === "jumps"
      ? liveJumps
      : overlay === "assets"
      ? assetsBySystem ?? null
      : overlay === "mineria"
      ? miningBySystem ?? null
      : overlay === "pi"
      ? piBySystem
        ? new Map<number, number>(
            [...piBySystem.entries()].map(([sid, v]) => [sid, v.colonies] as [number, number]),
          )
        : null
      : null;
  const liveMax = liveMap ? maxOf([...liveMap.values()], 1) : 1; // spread NO: ver maxOf
  // ===== Vista por REGIONES =====
  // Lo que la hace útil y no decorativa: la capa activa se AGREGA por región. Ver de un vistazo
  // dónde se concentran los kills de esta hora, tus assets o tu minería es una pregunta que hoy no
  // se puede responder en Koru de ninguna forma — alejando el mapa solo ves puntos más pequeños.
  // NO es un useMemo a propósito: depende de `liveMap`, que se calcula DESPUÉS del `return` temprano
  // del componente, y un hook ahí rompe la regla de hooks («Rendered more hooks than during the
  // previous render»). Es un cálculo barato — recorre la capa activa y ~70 regiones.
  const regionView = (() => {
    if (!geo || layout !== "regions") return null;
    // Suma de la capa activa por región (si la capa es cuantitativa).
    const agg = new Map<number, number>();
    if (liveMap) {
      for (const [sid, v] of liveMap) {
        const r = geo.regionOf.get(sid);
        if (r == null || v <= 0) continue;
        agg.set(r, (agg.get(r) ?? 0) + v);
      }
    }
    // maxOf y no spread: `Math.max(...)` revienta la pila con arrays grandes (ver charts.tsx).
    const aggMax = maxOf([...agg.values()], 0);
    const nodes = geo.regionLabels.map((r) => ({
      ...r,
      value: agg.get(r.id) ?? 0,
    }));
    return { nodes, aggMax, hasAgg: agg.size > 0 };
  })();

  // Sistemas que llevan insignia numérica: los N mayores de la capa.
  // NO vale con "que el círculo sea grande": el radio se normaliza al máximo, así que en una hora
  // floja (máx 6 kills) TODOS los círculos salen grandes y se numerarían los 400 → nube ilegible.
  // Un tope fijo garantiza que siempre se etiqueta lo que importa y nunca satura.
  const LIVE_LABELS = 40;
  const liveTop = (() => {
    if (!liveMap) return null;
    const vals = [...liveMap.entries()].filter(([, v]) => v > 0);
    if (vals.length <= LIVE_LABELS) return new Set(vals.map(([sid]) => sid));
    vals.sort((a, b) => b[1] - a[1]);
    return new Set(vals.slice(0, LIVE_LABELS).map(([sid]) => sid));
  })();
  const liveColor = overlay === "assets" ? "#5fd0c0" : overlay === "mineria" ? "#d8b24a" : null;

  const legend =
    overlay === "ubicacion"
      ? (charLocations?.length ?? 0) > 0
        ? "Dónde están tus personajes ahora mismo."
        : "Ningún personaje con ubicación. Inicia sesión con la feature “Ubicación (sistema actual)” para verlos en el mapa."
      : overlay === "poi"
      ? "Lugares notables de New Eden: hubs comerciales, sistemas históricos y puntos calientes de PvP."
      : overlay === "pvp"
      ? "Tu actividad PvP: tamaño = volumen, color = seguridad."
      : overlay === "security"
      ? "Cluster coloreado por seguridad (verde high · naranja low · rojo null)."
      : overlay === "soberania"
      ? "Soberanía: cada color es una alianza/facción que controla el sistema."
      : overlay === "fw"
      ? "Guerra de facciones: color = imperio que controla; tamaño/intensidad = cuán disputado está el sistema."
      : overlay === "incursion"
      ? "Incursiones de Sansha: sistemas infestados (el más grande = staging). Color = estado (rojo establecida · naranja movilizando · amarillo retirándose)."
      : overlay === "wormholes"
      ? "Conexiones de wormhole a Thera/Turnur (datos de eve-scout): sistemas k-space con salida (cian = Thera, naranja = Turnur). El tooltip muestra tipo, tamaño máx y horas restantes."
      : overlay === "firmas"
      ? "Tus firmas del escáner de sondas, por sistema (violeta = wormhole con destino anotado · cian = wormhole sin destino · ámbar = firmas sin identificar · gris = todo identificado). Se pegan y guardan en Ajustes → Firmas."
      : overlay === "kills"
      ? "Kills de jugadores en la última hora (datos en vivo de ESI)."
      : overlay === "jumps"
      ? "Saltos por sistema en la última hora (datos en vivo de ESI)."
      : overlay === "mineria"
      ? "Dónde has minado (mining ledger, últimos 90 días)."
      : overlay === "pi"
      ? "Salud de tus colonias de PI por sistema: verde = sano · ámbar <24h · rojo parado · gris sin extractor. Tamaño = nº de colonias."
      : "Dónde tienes assets (estaciones, estructuras y en el espacio).";

  // Capa activa + KPI contextual para el panel de la derecha
  const activeOverlay = OVERLAYS.find((o) => o.key === overlay) ?? OVERLAYS[0];

  // A dónde lleva cada capa dentro de la app. El mapa del juego hace esto (desde la capa de menas te
  // ofrece «abre el diario de minería») y es lo que evita que el mapa sea un callejón sin salida:
  // ves algo interesante y saltas al sitio donde puedes trabajar con ello.
  const ctxLink: { tab: Tab; label: string } | null =
    overlay === "mineria"
      ? { tab: "mineria", label: tr("Abrir tu minería") }
      : overlay === "assets"
      ? { tab: "assets", label: tr("Abrir tus assets") }
      : overlay === "pvp"
      ? { tab: "pvp", label: tr("Abrir tu PvP") }
      : overlay === "kills"
      ? { tab: "cazador", label: tr("Abrir Cazador") }
      : overlay === "pi"
      ? { tab: "planetologia", label: tr("Abrir Planetología") }
      : overlay === "agentes"
      ? { tab: "lealtad", label: tr("Abrir Misiones") }
      : overlay === "corps_npc"
      ? { tab: "lealtad", label: tr("Abrir Lealtad") }
      : overlay === "standings"
      ? { tab: "contactos", label: tr("Abrir Contactos") }
      : null;
  const ctxKpi: { value: string; label: string } | null =
    overlay === "soberania" && sovBySystem
      ? { value: fmtSp(new Set([...sovBySystem.values()].map((v) => v.owner_id ?? 0)).size), label: "Dueños distintos" }
      : overlay === "fw" && fwBySystem
      ? {
          value: fmtSp(
            [...fwBySystem.values()].filter(
              (f) => f.contested === "contested" || f.contested === "vulnerable"
            ).length
          ),
          label: "Sistemas disputados",
        }
      : overlay === "standings" && factionMap && factionStandings
      ? {
          value: fmtSp(
            Object.values(factionMap).filter((f) => (factionStandings.get(f) ?? 0) > 0).length
          ),
          label: "Sistemas con standing +",
        }
      : overlay === "incursion" && incursions
      ? { value: fmtSp(incursions.length), label: "Incursiones activas" }
      : overlay === "wormholes" && theraConns
      ? { value: fmtSp(theraConns.length), label: "Conexiones Thera/Turnur" }
      : overlay === "firmas" && sigSummary
      ? { value: fmtSp(sigSummary.length), label: "Sistemas con firmas" }
      : overlay === "ubicacion"
      ? { value: fmtSp(charLocations?.length ?? 0), label: "Personajes situados" }
      : overlay === "poi"
      ? { value: fmtSp(POIS.filter((p) => geo?.nameIdx.get(p.name.toLowerCase())).length), label: "Lugares en el mapa" }
      : liveMap
      ? { value: fmtSp(liveMap.size), label: "Sistemas con datos" }
      : null;

  // KPIs contextuales a la capa activa (no genéricos): los de PvP solo en la capa PvP.
  const ctxKpis: { value: string; label: string }[] =
    overlay === "pvp"
      ? [
          { value: fmtSp(pvp.length), label: "Sistemas (tu PvP)" },
          { value: fmtSp(totalKills), label: "Kills" },
          { value: fmtSp(totalLosses), label: "Losses" },
        ]
      : ctxKpi
      ? [ctxKpi]
      : [];

  // LA FICHA DE SISTEMA, en una variable y no inline: se pinta en DOS sitios distintos —flotando
  // arriba a la izquierda en las capas normales, y como PESTAÑA de la tarjeta derecha en Intel—.
  // Motivo (RoGiz7, 2026-08-12): en Intel esa esquina ya es de la columna Ruta/Aviso y las dos
  // tarjetas se tapaban. Empujar la ficha hacia abajo con un ResizeObserver lo arreglaba a medias:
  // con la Ruta desplegada, la ficha quedaba fuera de la pantalla. Con pestañas el problema no
  // existe, porque solo hay una tarjeta.
  const fichaSistema =
    selected != null && geo.idx.get(selected)
      ? (() => {
            const s = geo.idx.get(selected)!;
            const act = pvp.find((d) => d.system_id === selected);
            const region = ne.regions.find((r) => r.id === s.r)?.n ?? "";
            const kv = liveKills?.get(selected);
            const jv = liveJumps?.get(selected);
            const av = assetsBySystem?.get(selected);
            return (
              <div className={`sys-panel${overlay === "intel" ? " intel" : ""}`}>
                <div className="sys-panel-head">
                  <strong>{s.n}</strong>
                  {/* EL MOTOR HUMANO (N1). El chip va PEGADO AL NOMBRE (RoGiz7, 2026-08-12): una
                      nota es lo que TÚ sabes de este sistema, así que pertenece a su identidad, no
                      a la lista de acciones donde estaba —allí se leía como un botón más entre
                      «Evitar» y «Anclar». Delante de zKill y Dotlan porque es tuyo y ellos son de
                      fuera. Solo el CHIP: el detalle se abre en modal. Ver SPEC_MOTOR_HUMANO.md. */}
                  <NotasAncla
                    kind="system"
                    anchorId={selected}
                    subject={subjectId}
                    anchorName={s.n}
                  />
                  {/* Las webs externas, PEGADAS AL NOMBRE y como enlaces — el mismo trato que en la
                      tarjeta de aviso. Hablan de ESTE sistema, así que se leen donde se lee su
                      nombre; al pie y con forma de botón competían con «Silenciar aquí», que sí
                      cambia algo dentro de Koru. */}
                  <button
                    className="intel-head-link"
                    title={tr("Abrir el sistema en zKillboard")}
                    onClick={() => openExternal(`https://zkillboard.com/system/${selected}/`)}
                  >
                    zKill
                  </button>
                  <button
                    className="intel-head-link push"
                    title={tr("Abrir el sistema en Dotlan")}
                    onClick={() =>
                      openExternal(`https://evemaps.dotlan.net/system/${s.n.replace(/ /g, "_")}`)
                    }
                  >
                    Dotlan
                  </button>
                  <button className="sys-close" onClick={() => setSelected(null)}>
                    ✕
                  </button>
                </div>
                <div className="muted small">
                  {tr("Seguridad")} <span style={{ color: secColor(s.s) }}>{s.s.toFixed(1)}</span> · {region}
                </div>
                {overlay !== "pi" && (
                  <div className="sys-stats">
                    {/* TU HISTORIA AQUÍ, en una línea (2026-08-12). Antes eran tres renglones —kills,
                        losses y ISK— y RoGiz7 preguntó si seguían teniendo sentido. La respuesta es
                        que sí, pero no como contadores: lo que decide si entras es el BALANCE, no el
                        número. «8 y 13» en tres líneas dice una sola cosa, y la dice a gritos.
                        «Tu ISK» se va: es un trofeo, no intel — no responde a «¿entro o no?», y es
                        justo la cifra que estorba en una captura para los foros. Sigue en la sección
                        de PvP, que es donde vas A MIRAR el balance, no en la tarjeta que abres en
                        caliente con un hostil a dos saltos.
                        Si nunca has peleado aquí no se pinta nada: un «0 · 0» ocupa sitio para decir
                        que no hay dato. */}
                    {act && act.kills + act.losses > 0 && (
                      <div
                        className="sys-mine"
                        title={tr("Tu historial de PvP en este sistema. Lo que importa es el balance: si has muerto aquí más de lo que has matado, el sistema ya te ha avisado una vez.")}
                      >
                        {tr("Aquí")}: <strong className="k">{act.kills}</strong> kills ·{" "}
                        <strong className="l">{act.losses}</strong> losses
                      </div>
                    )}
                    {kv != null && <div>{tr("Kills 1h")}: <strong>{kv}</strong></div>}
                    {jv != null && <div>{tr("Jumps 1h")}: <strong>{jv}</strong></div>}
                    {av != null && <div>{tr("Assets (stacks)")}: <strong>{av}</strong></div>}
                  </div>
                )}
                {overlay === "agentes" && (agentDetails?.get(selected)?.length ?? 0) > 0 && (
                  <div className="sys-agents">
                    <div className="muted small">🧑‍✈️ {tr("Tus agentes aquí")}:</div>
                    {agentDetails!
                      .get(selected)!
                      .slice()
                      .sort((a, b) => b.level - a.level)
                      .map((ag, i) => (
                        <div key={i} className="sys-agent-row">
                          <img
                            src={`https://images.evetech.net/characters/${ag.id}/portrait?size=32`}
                            alt=""
                            loading="lazy"
                          />
                          <span className="ag-lvl">L{ag.level}</span>
                          <span>{ag.name}</span>
                        </div>
                      ))}
                  </div>
                )}
                {overlay === "corps_npc" && (corpDetails?.get(selected)?.length ?? 0) > 0 && (
                  <div className="sys-agents">
                    <div className="muted small">🏢 {tr("Tus corps NPC aquí")}:</div>
                    {corpDetails!
                      .get(selected)!
                      .slice()
                      .sort((a, b) => b.lp - a.lp)
                      .map((c, i) => (
                        <div key={i} className="sys-agent-row">
                          <img
                            src={`https://images.evetech.net/corporations/${c.id}/logo?size=32`}
                            alt=""
                            loading="lazy"
                          />
                          <span>{c.name}</span>
                          <span className="muted small" style={{ marginLeft: "auto" }}>
                            {c.lp.toLocaleString()} LP
                          </span>
                        </div>
                      ))}
                  </div>
                )}
                {overlay === "pi" && (piBySystem?.get(selected)?.detail.length ?? 0) > 0 && (
                  <div className="sys-agents">
                    <div className="muted small">🪐 {tr("Colonias de PI aquí")}:</div>
                    {piBySystem!
                      .get(selected)!
                      .detail.slice()
                      .sort((a, b) => (a.worst_hours ?? 1e9) - (b.worst_hours ?? 1e9))
                      .map((col, i) => (
                        <div key={i} className="pi-sys-colony">
                          <span className="pi-sys-planet">{col.planet_type}</span>
                          <span className="muted small">{col.character}</span>
                          {col.products.map((pid) => (
                            <img
                              key={pid}
                              src={typeIcon(pid, 32) ?? undefined}
                              alt=""
                              width={14}
                              height={14}
                            />
                          ))}
                          {col.factories > 0 && <span className="muted small">🏭{col.factories}</span>}
                          <span
                            className="pi-sys-worst"
                            style={{ marginLeft: "auto", color: piHealthColor(col.worst_hours) }}
                          >
                            {col.worst_hours == null
                              ? tr("sin extractor")
                              : col.worst_hours <= 0
                                ? tr("parado")
                                : `${Math.ceil(col.worst_hours)}h`}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
                {overlay === "pi" && onOpenPi && (
                  <button
                    className="sys-assets-btn"
                    onClick={() => {
                      onOpenPi();
                      setSelected(null);
                    }}
                  >
                    🪐 {tr("Ver en Planetología")}
                  </button>
                )}
                {(overlay === "agentes" || overlay === "corps_npc") && onOpenMisiones && (
                  <button
                    className="sys-assets-btn"
                    onClick={() => {
                      onOpenMisiones();
                      setSelected(null);
                    }}
                  >
                    📋 {tr("Ver todo en Misiones")}
                  </button>
                )}
                {/* ACCIONES sobre el sistema, DOS POR FILA y en un solo bloque tras un separador —
                    el mismo lenguaje que la tarjeta de aviso, que es el que RoGiz7 dio por bueno.
                    Antes iban en tres grupos distintos (rutas / herramientas / webs) y la tarjeta se
                    leía como tres tarjetas pegadas.
                    El orden va de MIRAR a CONFIGURAR: rutas arriba, assets y veto en medio, y las
                    dos que tocan el intel abajo. */}
                <div className="sys-acts">
                  <button
                    className="ida-btn ida-primary"
                    onClick={() => {
                      setJumpActive(false);
                      setRouteActive(true);
                      setRouteStops([selected, null]);
                      setSelected(null);
                    }}
                  >
                    {tr("Ruta desde")}
                  </button>
                  <button
                    className="ida-btn"
                    onClick={() => {
                      setRouteActive(false);
                      setJumpActive(true);
                      setJumpOrigin(selected);
                      setJumpDest(null);
                      setSelected(null);
                    }}
                  >
                    {tr("Saltar desde")}
                  </button>
                  {/* Vetar desde el propio mapa: es donde ves que un sistema está caliente. Antes
                      solo se podía desde el buscador de la sección de abajo. */}
                  <button
                    className={`ida-btn${avoid.has(selected) ? " avoid-on" : ""}`}
                    title={tr("Los sistemas vetados se saltan al calcular cualquier ruta.")}
                    onClick={() => toggleAvoid(selected)}
                  >
                    🚫 {avoid.has(selected) ? tr("Vetado ✓") : tr("Evitar")}
                  </button>
                  {onSystemAssets && (
                  <button
                    className="ida-btn"
                    onClick={() => {
                      onSystemAssets(s.n);
                      setSelected(null);
                    }}
                  >
                    📦 {tr("Mis assets aquí")}
                  </button>
                )}
                {overlay === "intel" && intel && (
                  <button
                    className="ida-btn"
                    onClick={() => {
                      const has = intel.anchors.includes(selected);
                      intel.onConfig({
                        anchors: has
                          ? intel.anchors.filter((x) => x !== selected)
                          : [...intel.anchors, selected],
                      });
                    }}
                  >
                    {intel.anchors.includes(selected) ? `⚓ ${tr("Quitar ancla")}` : `⚓ ${tr("Anclar aquí")}`}
                  </button>
                )}
                {overlay === "intel" && intel && (
                  <button
                    className="ida-btn"
                    title={tr("Calla la alarma de este sistema. El aviso SIGUE saliendo en el feed y en el mapa.")}
                    onClick={(e) => {
                      // Con Alt = silencio de 1 hora. El motivo para callar un sistema casi siempre
                      // es temporal («esta noche rateo aquí»), y un silencio indefinido que se te
                      // olvida quitar es justo el que te mata tres semanas después.
                      alternarSilencio(selected, e.altKey ? 1 : undefined);
                    }}
                  >
                    {estaSilenciado(selected) ? `🔔 ${tr("Volver a avisar")}` : `🔇 ${tr("Silenciar aquí")}`}
                  </button>
                )}
                </div>
              </div>
            );
        })()
      : null;

  return (
    <>
      <p className="muted small">
        {tr("New Eden completo (líneas = stargates).")}
        {liveBusy && ` · ${tr("cargando datos en vivo…")}`}
      </p>
      <div className="map-wrap">

        {jumpActive && (
        <div className="route-panel map-navcard">
          {characters.length > 0 && (
            <div className="route-panel-head">
              <label className="muted small">
                {tr("Cargar de")}:&nbsp;
                <select
                  value={jumpChar ?? ""}
                  onChange={(e) => setJumpChar(e.target.value ? +e.target.value : null)}
                >
                  <option value="">{tr("— manual —")}</option>
                  {characters.map((c) => (
                    <option key={c.character_id} value={c.character_id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              {jumpChar != null && <span className="muted small">{tr("★ = la tienes")}</span>}
            </div>
          )}
          <div className="route-panel-head">
            <label className="muted small">
              {tr("Nave")}:&nbsp;
              <select value={jumpShip} onChange={(e) => setJumpShip(e.target.value)}>
                <option value="">{tr("— manual —")}</option>
                {Object.entries(
                  jumpShips.reduce<Record<string, JumpShip[]>>((acc, s) => {
                    (acc[s.group] ||= []).push(s);
                    return acc;
                  }, {})
                ).map(([grp, list]) => (
                  <optgroup key={grp} label={grp}>
                    {[...list]
                      .sort(
                        (a, b) =>
                          (jumpOwned.has(b.id) ? 1 : 0) - (jumpOwned.has(a.id) ? 1 : 0)
                      )
                      .map((s) => (
                        <option key={s.name} value={s.name}>
                          {jumpOwned.has(s.id) ? "★ " : ""}
                          {s.name}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
          </div>
          <div className="route-panel-head">
            {selShip ? (
              <span className="muted small" title={tr("Calculado por nave y Jump Drive Calibration")}>
                {tr("Rango")}: <b>{jumpRange}</b> LY
              </span>
            ) : (
              <label className="muted small">
                {tr("Rango (LY)")}:&nbsp;
                <input
                  type="number"
                  min={1}
                  max={12}
                  step={0.1}
                  value={jumpRange}
                  onChange={(e) => setJumpRange(Math.max(0, parseFloat(e.target.value) || 0))}
                  style={{ width: "4.5rem" }}
                />
              </label>
            )}
            <label className="muted small" title={tr("Jump Drive Calibration: +20% de rango por nivel (a V se dobla)")}>
              JDC:&nbsp;
              <select value={jdcLevel} onChange={(e) => setJdcLevel(+e.target.value)}>
                {[0, 1, 2, 3, 4, 5].map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="muted small" title={tr("Jump Fuel Conservation: −10% de consumo por nivel")}>
              JFC:&nbsp;
              <select value={jfcLevel} onChange={(e) => setJfcLevel(+e.target.value)}>
                {[0, 1, 2, 3, 4, 5].map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <span className="muted small">
              {jumpReach ? `${jumpReach.size} ${tr("sistemas al alcance")}` : tr("elige el origen")}
            </span>
          </div>
          <div className="route-stop">
            <span className="route-stop-label">{tr("Origen")}</span>
            <SystemSearch
              systems={ne.systems}
              value={jumpOrigin}
              placeholder={tr("Sistema de salto…")}
              onPick={(id) => {
                setJumpOrigin(id);
                focusSystem(id); // buscar un sistema ES querer verlo
              }}
            />
          </div>
          <div className="route-stop">
            <span className="route-stop-label">{tr("Destino")}</span>
            <SystemSearch
              systems={ne.systems}
              value={jumpDest}
              placeholder={tr("Destino (para el fuel)…")}
              onPick={(id) => {
                setJumpDest(id);
                focusSystem(id); // buscar un sistema ES querer verlo
              }}
            />
          </div>
          {jumpFuel && (
            <div className={`jump-fuel ${jumpFuel.inRange ? "" : "out"}`}>
              <span>
                <b>{jumpFuel.dist.toFixed(2)}</b> LY
              </span>
              <span>
                ⛽ <b>{fmtSp(jumpFuel.fuel)}</b> {jumpFuel.isotope}
              </span>
              {!jumpFuel.inRange && <span className="jump-oor">⚠️ {tr("fuera de rango")}</span>}
            </div>
          )}
          {jumpChar != null && (
            <div className="jump-fatigue">
              {jumpFatMissing ? (
                <span className="small muted">
                  ⏳ {tr("Fatiga: falta el acceso. Pulsa «Conceder acceso» y vuelve a iniciar sesión con este personaje para verla.")}
                </span>
              ) : (
                <>
                  <span className="small">
                    ⏳ {tr("Fatiga actual")}: <b>{curFatMin >= 1 ? fmtMin(curFatMin) : tr("ninguna")}</b>
                  </span>
                  {jumpFatEst && jumpFuel && (
                    <span className="small muted">
                      {tr("tras saltar → cooldown")} ~{fmtMin(jumpFatEst.cooldown)} · {tr("fatiga")} ~
                      {fmtMin(jumpFatEst.newFat)}
                      {jumpFatEst.reduced ? ` ${tr("(máx; tu nave reduce fatiga)")}` : ""}
                    </span>
                  )}
                </>
              )}
            </div>
          )}
          <p className="muted small">
            {tr("Elige tu nave (rango y fuel salen del SDE) y tus skills; el rango se calcula solo. Click en el mapa: 1º fija el origen, 2º el destino. Resalta en morado los low/null alcanzables.")}
          </p>
        </div>
      )}
        {!mapActive && (
          <div className="map-zoom-hint">{tr("Posa el ratón un instante para activar el zoom con rueda")}</div>
        )}
        {intelAlert && (
          <div
            className="intel-alert"
            onClick={() => {
              openIntelDetail(intelAlert.report);
              setSelected(intelAlert.report.sysId);
              setIntelAlert(null);
            }}
            title={tr("Ver detalle")}
          >
            {intelAlert.text}
            <span className="intel-alert-cta">{tr("ver detalle")} ▸</span>
          </div>
        )}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${MAP_W} ${MAP_H}`}
          className={`eve-map ${hover ? "over-sys" : ""} ${mapActive ? "active" : ""}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerEnter={enterMap}
          onPointerLeave={() => {
            onPointerUp();
            setHover(null);
            leaveMap(); // al salir del mapa, la rueda vuelve a scrollear la página
          }}
          onClick={() => {
            if (hover) clickSystem(hover.sid);
          }}
          onDoubleClick={onDoubleClick}
        >
          <rect x="0" y="0" width={MAP_W} height={MAP_H} fill="#0a0d12" />
          <g transform={`translate(${view.x} ${view.y}) scale(${view.z})`}>
            {/* DISPOSICIÓN: o los ~5.000 sistemas, o los ~70 nodos-región. No es un zoom: es
                colapsar el grafo, y por eso son dos ramas de pintado distintas. */}
            {layout === "regions" ? (
              <>
                {/* Enlaces región↔región. Se OCULTA el enlace si las dos puntas están desplegadas:
                    ahí ya se ven los stargates de verdad y la recta entre centroides estorbaría. */}
                {geo.regionEdges.map(([ra, rb], i) => {
                  if (openRegions.has(ra) && openRegions.has(rb)) return null;
                  const a = geo.regionPos.get(ra);
                  const b = geo.regionPos.get(rb);
                  if (!a || !b) return null;
                  return (
                    <line
                      key={`re-${i}`}
                      x1={a.px}
                      y1={a.py}
                      x2={b.px}
                      y2={b.py}
                      stroke="#2b3a4d"
                      strokeWidth={0.9 / view.z}
                      opacity={0.75}
                    />
                  );
                })}
                {/* ---- Regiones DESPLEGADAS: sus sistemas de verdad ---- */}
                {openRegions.size > 0 && (
                  <>
                    {/* Stargates cuyos DOS extremos están en regiones abiertas. */}
                    <path
                      d={ne.jumps
                        .map(([a, b]) => {
                          const ra = geo.regionOf.get(a);
                          const rb = geo.regionOf.get(b);
                          if (ra == null || rb == null) return "";
                          if (!openRegions.has(ra) || !openRegions.has(rb)) return "";
                          const sa = geo.idx.get(a);
                          const sb = geo.idx.get(b);
                          if (!sa || !sb) return "";
                          const pa = geo.proj(sa);
                          const pb = geo.proj(sb);
                          return `M${pa.px.toFixed(1)} ${pa.py.toFixed(1)}L${pb.px.toFixed(1)} ${pb.py.toFixed(1)}`;
                        })
                        .join("")}
                      stroke="#39465a"
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                      fill="none"
                      opacity={0.9}
                    />
                    {[...openRegions].map((rid) =>
                      (geo.byRegion.get(rid) ?? []).map((s) => {
                        const p = geo.proj(s);
                        const v = liveMap?.get(s.id) ?? 0;
                        const hasV = v > 0;
                        return (
                          <g
                            key={`os-${s.id}`}
                            className="clickable-sys"
                            onClick={(e) => {
                              e.stopPropagation();
                              clickSystem(s.id);
                            }}
                          >
                            {/* Nodo del sistema con el MISMO lenguaje visual que el modo Sistemas:
                                radio en unidades de MUNDO (crece con el zoom), no de pantalla. Con
                                radio de pantalla fija quedaban como puntitos al acercar. */}
                            <circle
                              cx={p.px}
                              cy={p.py}
                              r={Math.min(0.9, 5.5 / view.z)}
                              fill={overlay === "security" ? secColor(s.s) : "#8b97a8"}
                            >
                              <title>{`${s.n} (sec ${s.s.toFixed(1)})${
                                hasV ? `\n${tr(activeOverlay.label)}: ${fmtSp(v)}` : ""
                              }`}</title>
                            </circle>
                            {/* Encima, el valor de la capa activa (tamaño de pantalla, como el
                                overlay en vivo del modo Sistemas). */}
                            {hasV && (
                              <circle
                                cx={p.px}
                                cy={p.py}
                                r={(1.5 + Math.sqrt(v / liveMax) * 14) / view.z}
                                fill={liveColor ?? heatColor(v / liveMax)}
                                fillOpacity={0.55}
                                pointerEvents="none"
                              />
                            )}
                            {view.z >= 2.2 && (
                              <text
                                x={p.px + 1.5}
                                y={p.py + 1}
                                className="map-label"
                                style={{ fontSize: `${12.5 / view.z}px` }}
                                pointerEvents="none"
                              >
                                {s.n}
                              </text>
                            )}
                          </g>
                        );
                      })
                    )}
                    {/* Etiqueta de la región abierta + cómo volver a plegarla. */}
                    {[...openRegions].map((rid) => {
                      const r = geo.regionPos.get(rid);
                      if (!r) return null;
                      return (
                        <g
                          key={`ol-${rid}`}
                          className="clickable-sys"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleRegion(rid);
                          }}
                        >
                          {/* Zona de clic REAL detrás del texto: `.map-label` lleva
                              `pointer-events: none`, así que el rótulo por sí solo nunca recibía el
                              clic y la región no se podía replegar. */}
                          {(() => {
                            // Ancho según el largo del nombre: con uno fijo, «Vale of the Silent»
                            // se salía de la cápsula y «Curse» nadaba dentro.
                            const w = (r.name.length * 8.5 + 40) / view.z;
                            const h = 26 / view.z;
                            return (
                              <rect
                                x={r.px - w / 2}
                                y={r.py - h / 2}
                                width={w}
                                height={h}
                                rx={6 / view.z}
                                fill="#0a0d12"
                                fillOpacity={0.85}
                                stroke="#5a6a80"
                                strokeWidth={1 / view.z}
                              />
                            );
                          })()}
                          <text
                            x={r.px}
                            y={r.py}
                            textAnchor="middle"
                            dominantBaseline="central"
                            className="region-open-label"
                            style={{ fontSize: `${15 / view.z}px` }}
                          >
                            {r.name} ✕
                          </text>
                        </g>
                      );
                    })}
                  </>
                )}
                {regionView?.nodes.map((r) => {
                  if (openRegions.has(r.id)) return null; // desplegada: se pintan sus sistemas
                  // Radio: por el VALOR de la capa si la hay; si no, por nº de sistemas. Así la
                  // vista responde a lo que estés mirando y no siempre a lo mismo.
                  const t = regionView.hasAgg
                    ? r.value / (regionView.aggMax || 1)
                    : r.count / 110;
                  const rad = (4.5 + Math.sqrt(Math.max(0, t)) * 13) / view.z;
                  const dim = regionView.hasAgg && r.value <= 0;
                  return (
                    <g
                      key={`rn-${r.id}`}
                      className="clickable-sys"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Clic = DESPLEGAR esa región (las demás siguen plegadas). Antes esto se
                        // iba al mapa entero de sistemas y volvías a tener New Eden completo
                        // delante, que es justo lo que esta vista viene a evitar.
                        toggleRegion(r.id);
                        // Y centrar en ella: sus sistemas ocupan poco y si no, se abren fuera de
                        // la vista. Solo sube el zoom si estabas muy alejado; no lo baja nunca.
                        focusOn(r.px, r.py, Math.max(view.z, 2.6));
                      }}
                    >
                      <circle
                        cx={r.px}
                        cy={r.py}
                        r={rad}
                        fill={regionView.hasAgg ? heatColor(t) : "#4a5a70"}
                        fillOpacity={dim ? 0.18 : 0.62}
                        stroke="#0a0d12"
                        strokeWidth={0.4 / view.z}
                      >
                        <title>{`${r.name}\n${r.count} ${tr("sistemas")}${
                          regionView.hasAgg ? `\n${tr(activeOverlay.label)}: ${fmtSp(r.value)}` : ""
                        }`}</title>
                      </circle>
                      {regionView.hasAgg && r.value > 0 && rad * view.z >= 5 && (
                        <text
                          x={r.px}
                          y={r.py}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontSize={Math.min(rad * view.z * 0.8, 11) / view.z}
                          fontWeight={700}
                          fill="#0a0d12"
                          pointerEvents="none"
                        >
                          {fmtCompact(r.value)}
                        </text>
                      )}
                      <text
                        x={r.px}
                        y={r.py + rad + 9 / view.z}
                        textAnchor="middle"
                        className="map-label"
                        style={{ fontSize: `${13 / view.z}px` }}
                        pointerEvents="none"
                      >
                        {r.name}
                      </text>
                    </g>
                  );
                })}
              </>
            ) : (
              <>
            {/* etiquetas con nivel de detalle (LOD) según el zoom */}
            {/* El `letter-spacing: 1px` de `.region-label` está en unidades LOCALES, así que el zoom lo
                multiplica mientras el tamaño de letra se compensa dividiéndolo: a zoom medio salía un
                «E L Y S I U M» estirado. Se fija aquí, proporcional a la letra, para que el
                espaciado se vea igual a cualquier escala. */}
            {view.z < 2.9 &&
              (() => {
                const place = makeLabelPlacer();
                const F = 16;
                const SP = 1.2;
                const op = 1 - ramp(view.z, 2.2, 2.9); // se apaga MIENTRAS asoman las constelaciones
                return geo.regionLabels
                  .filter((r) => place(view.x + r.px * view.z, view.y + r.py * view.z, r.name, F, { middle: true, spacing: SP }))
                  .map((r, i) => (
                    <text
                      key={`r-${i}`}
                      x={r.px}
                      y={r.py}
                      className="region-label"
                      textAnchor="middle"
                      opacity={op}
                      style={{ fontSize: `${F / view.z}px`, letterSpacing: `${SP / view.z}px` }}
                    >
                      {r.name}
                    </text>
                  ));
              })()}
            {view.z >= 2.2 && view.z < 6.4 &&
              (() => {
                const place = makeLabelPlacer();
                const F = 13;
                const SP = 1.2;
                // Entra según se van las regiones y se apaga según asoman los nombres de sistema.
                const op = ramp(view.z, 2.2, 2.9) * (1 - ramp(view.z, 5.6, 6.4));
                return geo.constLabels
                  .filter((c) => place(view.x + c.px * view.z, view.y + c.py * view.z, c.name, F, { middle: true, spacing: SP }))
                  .map((c, i) => (
                    <text
                      key={`c-${i}`}
                      x={c.px}
                      y={c.py}
                      className="region-label"
                      textAnchor="middle"
                      opacity={op}
                      style={{ fontSize: `${F / view.z}px`, letterSpacing: `${SP / view.z}px` }}
                    >
                      {c.name}
                    </text>
                  ));
              })()}
            {/* Nombres de sistema CON DESCARTE POR SOLAPE. Antes se pintaban todos los que cayeran
                dentro del encuadre y a zoom medio salían cientos amontonados: una sopa de letras
                ilegible en la que no se distinguía ningún nombre — peor que no poner ninguno.
                Ahora la pantalla se trocea en celdas del tamaño de una etiqueta y cada celda admite
                UNA sola; el resto se calla hasta que al acercar el zoom queda sitio, que es como se
                comporta el mapa del juego.
                El orden importa: los sistemas con AVISO, los de la ruta y donde estás van PRIMERO,
                así que si hay pelea por un hueco gana el nombre que necesitas leer.
                ATENUACIÓN: justo al cruzar el umbral (z=6) los nombres entran tenues y se van
                aclarando hasta z=11. Ahí es donde más apretados están, y en gris apagado se leen como
                una textura de fondo en vez de gritar todos a la vez; al acercarte, cuando ya hay
                sitio de sobra, llegan a pleno contraste. Los PRIORITARIOS se saltan la atenuación:
                un sistema con hostiles no puede desvanecerse porque el mapa esté apretado. */}
            {view.z >= 5.6 &&
              (() => {
                const place = makeLabelPlacer();
                const out: React.ReactNode[] = [];
                const fadeIn = ramp(view.z, 5.6, 6.4);
                const dim = fadeIn * (0.32 + 0.68 * ramp(view.z, 6.4, 11));
                const push = (s: NeSystem, keyLabel: boolean) => {
                  const p = geo.proj(s);
                  const sx = view.x + p.px * view.z;
                  const sy = view.y + p.py * view.z;
                  if (sx < 0 || sx > MAP_W || sy < 0 || sy > MAP_H) return;
                  if (!place(sx + 5, sy + 4, s.n, 12.5)) return;
                  out.push(
                    <text
                      key={`sl-${s.id}`}
                      x={p.px + 5 / view.z}
                      y={p.py + 4 / view.z}
                      className="map-label"
                      opacity={keyLabel ? fadeIn : dim}
                      style={{ fontSize: `${12.5 / view.z}px` }}
                    >
                      {s.n}
                    </text>,
                  );
                };
                const first = new Set<number>([
                  ...(intelReports ? [...intelReports.rep.keys()] : []),
                  ...(routePath ?? []),
                  ...(hereSystemId != null ? [hereSystemId] : []),
                  ...(selected != null ? [selected] : []),
                ]);
                for (const sid of first) {
                  const s = geo.idx.get(sid);
                  if (s) push(s, true);
                }
                for (const s of ne.systems) if (!first.has(s.id)) push(s, false);
                return out;
              })()}
            {/* LOD: en la vista galaxia (muy alejado) la maraña de saltos es ilegible y cara de
                pintar → se oculta; reaparece al acercar el zoom. */}
            {view.z >= 1.8 && (
              // `vectorEffect="non-scaling-stroke"` = el grosor se mide en PÍXELES DE PANTALLA y no
              // lo toca el zoom. Antes iba en unidades de mundo y al acercarte las líneas engordaban
              // hasta competir con los nodos (en el juego la línea es fina siempre, ~1px).
              <path
                d={geo.jumpsPath}
                stroke="#39465a"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                fill="none"
                opacity={0.75}
              />
            )}
            {/* Red de Ansiblex, en verde y curvada como en el mapa del propio juego.
                SOLO en Navegación: fuera de ahí es ruido — tapaba la maraña de stargates y competía
                con las capas de kills/sov/intel, que son las que se miran en el resto de modos.
                Dos trazos superpuestos: un halo ancho y translúcido + un núcleo fino y brillante.
                Eso es lo que hace que se lean como un hilo luminoso y no como un rotulador. */}
            {(() => {
              if (!ansi) return null;
              // En INTEL solo los puentes que usa la ruta (si no, los 97 arcos tapan los avisos, y
              // ahí lo que miras es la caza). En Navegación, la red entera: es donde la quieres ver
              // para planificar por dónde tirar.
              const d =
                overlay === "intel"
                  ? ansiRouteD
                  : routeActive || jumpActive
                    ? ansi.path
                    : "";
              if (!d) return null;
              return (
                <g className="map-ansi" fill="none" strokeLinecap="round" vectorEffect="non-scaling-stroke">
                  <path d={d} stroke="#3fb950" strokeWidth={5} vectorEffect="non-scaling-stroke" opacity={0.14} />
                  <path d={d} stroke="#56d364" strokeWidth={1.8} vectorEffect="non-scaling-stroke" opacity={0.9} />
                </g>
              );
            })()}
            {/* Red de wormholes (Thera/Turnur), en cian, cuando el rutado por WH está activo. Las
                líneas convergen en el hub; Thera es un nodo sintético (rombo) porque no está en el
                SDE. Solo en Navegación, para no competir con las capas del resto de modos. */}
            {/* Misma regla que los Ansiblex: en Intel no se pinta la red de WH (los tramos que la
                ruta cruza ya salen como línea cian discontinua). En Navegación, la red entera. */}
            {wh && useWormholes && overlay !== "intel" && (routeActive || jumpActive) && (
              <g className="map-wh" fill="none" strokeLinecap="round" pointerEvents="none">
                <path d={wh.path} stroke="#3ad6e0" strokeWidth={4.5} vectorEffect="non-scaling-stroke" opacity={0.12} />
                <path d={wh.path} stroke="#3ad6e0" strokeWidth={1.6} vectorEffect="non-scaling-stroke" opacity={0.7} />
                {wh.hubPos.has(THERA_ID) && (
                  <rect
                    x={wh.hubPos.get(THERA_ID)!.px - 1.3}
                    y={wh.hubPos.get(THERA_ID)!.py - 1.3}
                    width={2.6}
                    height={2.6}
                    transform={`rotate(45 ${wh.hubPos.get(THERA_ID)!.px} ${wh.hubPos.get(THERA_ID)!.py})`}
                    fill="#3ad6e0"
                    stroke="#0a0d12"
                    strokeWidth={0.4}
                  />
                )}
              </g>
            )}
            {/* TUS wormholes escaneados con destino, en VIOLETA (el mismo de la capa de firmas): línea
                directa entre los dos sistemas reales. Se pintan con el rutado por sig-WH encendido, o
                sobre la capa de firmas para verlos aunque no estés rutando. */}
            {sigWh && (useSigWormholes || overlay === "firmas") && overlay !== "intel" && (
              <g className="map-sigwh" fill="none" strokeLinecap="round" pointerEvents="none">
                <path d={sigWh.path} stroke="#b06bff" strokeWidth={4.5} vectorEffect="non-scaling-stroke" opacity={0.12} />
                <path d={sigWh.path} stroke="#b06bff" strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeDasharray="5 4" opacity={0.75} />
              </g>
            )}
            {/* backdrop de sistemas (memorizado) */}
            {backdropCircles}
            {/* overlay de soberanía (memorizado) */}
            {sovCircles}
            {/* overlay Guerra de facciones (memorizado) */}
            {fwCircles}
            {/* overlay Standings por sistema (memorizado) */}
            {standingCircles}
            {/* overlay Tus agentes (memorizado) */}
            {agentCircles}
            {/* overlay Mis corps NPC / LP (memorizado) */}
            {corpNpcCircles}
            {/* overlay Incursiones (memorizado) */}
            {incursionCircles}
            {theraCircles}
            {/* overlay Firmas escaneadas (tuyas, memorizado) */}
            {sigCircles}
            {/* overlay Intel en vivo (memorizado) */}
            {intelAnchorMarkers}
            {intelMutedMarkers}
            {intelTrackLine}
            {huntTrackLine}
            {intelCircles}
            {/* overlay PvP */}
            {overlay === "pvp" &&
              pvp.map((d) => {
                const s = geo.idx.get(d.system_id);
                if (!s) return null;
                const p = geo.proj(s);
                const r = (2 + Math.sqrt((d.kills + d.losses) / maxAct) * 18) / view.z;
                return (
                  <circle
                    key={d.system_id}
                    cx={p.px}
                    cy={p.py}
                    r={r}
                    fill={secColor(s.s)}
                    fillOpacity={0.5}
                    stroke={secColor(s.s)}
                    strokeOpacity={0.9}
                    className="clickable-sys"
                    onClick={(e) => {
                      e.stopPropagation();
                      clickSystem(d.system_id);
                    }}
                  >
                    <title>{`${s.n}  (sec ${s.s.toFixed(1)})\nKills: ${d.kills} · Losses: ${d.losses} · ISK: ${fmtIsk(d.isk)}`}</title>
                  </circle>
                );
              })}
            {/* overlays en vivo (kills / jumps) */}
            {liveMap &&
              [...liveMap.entries()].map(([sid, v]) => {
                const s = geo.idx.get(sid);
                if (!s || v <= 0) return null;
                const p = geo.proj(s);
                const r = (1.5 + Math.sqrt(v / liveMax) * 16) / view.z;
                const pi = overlay === "pi" ? piBySystem?.get(sid) ?? null : null;
                const fill = pi ? piHealthColor(pi.worst_hours) : liveColor ?? heatColor(v / liveMax);
                const label = pi
                  ? `${v} ${v === 1 ? "colonia" : "colonias"}${
                      pi.worst_hours != null
                        ? ` · peor: ${pi.worst_hours <= 0 ? "parado" : `${Math.ceil(pi.worst_hours)}h`}`
                        : " · sin extractor programado"
                    }${pi.dead > 0 ? ` · ${pi.dead} parada(s)` : ""}`
                  : `${
                      overlay === "kills"
                        ? "Kills"
                        : overlay === "jumps"
                        ? "Jumps"
                        : overlay === "mineria"
                        ? "Minado"
                        : "Assets (stacks)"
                    }: ${fmtSp(v)}`;
                // Insignia numérica dentro del nodo, como el mapa del juego: se lee la cantidad sin
                // tener que posar el ratón. Solo si el círculo da de sí para la cifra — con ~5.000
                // sistemas, numerarlos todos sería una nube ilegible. `rBase` es el radio ANTES de
                // dividir por el zoom, así el criterio no cambia al acercar o alejar.
                const rBase = 1.5 + Math.sqrt(v / liveMax) * 16;
                const showNum = !!liveTop?.has(sid) && rBase >= 4.5;
                const fontBase = Math.min(rBase * 0.95, 7);
                return (
                  <g key={`live-${sid}`}>
                    <circle
                      cx={p.px}
                      cy={p.py}
                      r={r}
                      fill={fill}
                      fillOpacity={overlay === "pi" ? 0.7 : 0.55}
                      className="clickable-sys"
                      onClick={(e) => {
                        e.stopPropagation();
                        clickSystem(sid);
                      }}
                    >
                      <title>{`${s.n}\n${label}`}</title>
                    </circle>
                    {showNum && (
                      <text
                        x={p.px}
                        y={p.py}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={fontBase / view.z}
                        fontWeight={700}
                        fill="#0a0d12"
                        pointerEvents="none"
                      >
                        {fmtCompact(v)}
                      </text>
                    )}
                  </g>
                );
              })}
            {/* Sistemas vetados (por encima de las capas, por debajo de la ruta) */}
            {avoidMarkers}
            {/* ruta planificada */}
            {routePath && routePath.length > 1 && (() => {
              // La línea AMARILLA solo cubre puertas y Ansiblex. Los saltos por wormhole se pintan
              // aparte, en CIAN DISCONTINUO, directos entre los dos sistemas reales que unen — así la
              // línea NO se desvía al centroide de Thera (el pico feo) y un WH se lee como lo que es:
              // «entras aquí, sales allá», sin recorrido intermedio.
              const isSynthHub = (sid: number) => !geo.idx.get(sid) && !!wh?.hubName.has(sid);
              let yellow = "";
              let pen = false; // ¿venimos dibujando una sub-línea?
              // Tramos continuos de la línea amarilla, para poder pintarles el SENTIDO. Se acumulan
              // aparte porque la ruta se parte en varias sub-líneas (los saltos WH la interrumpen) y
              // una flecha entre dos sub-líneas señalaría un camino que no existe.
              const runs: { px: number; py: number }[][] = [];
              for (let i = 0; i < routePath.length; i++) {
                // No unir la línea amarilla por encima de un salto por wormhole (de eve-scout o tuyo).
                if (i > 0 && (whLegs.has(i) || sigWhLegs.has(i))) pen = false;
                if (isSynthHub(routePath[i])) {
                  pen = false; // el hub sintético no atrae la línea
                  continue;
                }
                const p = posOf(routePath[i]);
                if (!p) {
                  pen = false;
                  continue;
                }
                yellow += `${pen ? "L" : "M"}${p.px.toFixed(1)} ${p.py.toFixed(1)}`;
                if (pen) runs[runs.length - 1].push(p);
                else runs.push([p]);
                pen = true;
              }
              // Segmentos WH: para Thera (sintético) se colapsa vecino↔vecino; para Turnur (real) se
              // dibuja a través de su posición real.
              const whD: string[] = [];
              const seg = (a: number, b: number) => {
                const pa = posOf(a);
                const pb = posOf(b);
                if (pa && pb)
                  whD.push(`M${pa.px.toFixed(1)} ${pa.py.toFixed(1)}L${pb.px.toFixed(1)} ${pb.py.toFixed(1)}`);
              };
              for (let j = 0; j < routePath.length; j++) {
                if (isSynthHub(routePath[j])) seg(routePath[j - 1], routePath[j + 1]);
              }
              for (let i = 1; i < routePath.length; i++) {
                if (!whLegs.has(i)) continue;
                if (isSynthHub(routePath[i]) || isSynthHub(routePath[i - 1])) continue; // ya colapsado
                seg(routePath[i - 1], routePath[i]);
              }
              // Tramos por TUS wormholes: dos sistemas reales, línea violeta directa. Sin hubs
              // sintéticos que colapsar, así que es un segmento simple por cada salto.
              const sigWhD: string[] = [];
              for (let i = 1; i < routePath.length; i++) {
                if (!sigWhLegs.has(i)) continue;
                const pa = posOf(routePath[i - 1]);
                const pb = posOf(routePath[i]);
                if (pa && pb)
                  sigWhD.push(`M${pa.px.toFixed(1)} ${pa.py.toFixed(1)}L${pb.px.toFixed(1)} ${pb.py.toFixed(1)}`);
              }
              return (
                <>
                  {yellow && (
                    <path
                      d={yellow}
                      fill="none"
                      stroke="#ffd54a"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                      strokeLinejoin="round"
                      opacity={0.95}
                    />
                  )}
                  {/* Sentido de la marcha. La ruta ya se lee de origen a destino en la lista de
                      abajo, pero sobre el mapa —con la línea cruzando media galaxia y pudiendo
                      volver sobre sí misma por un Ansiblex— no había forma de saber hacia dónde
                      vas mirando solo el trazo. Sin atenuar: aquí todos los tramos valen igual. */}
                  {runs.map((r, i) => (
                    <g key={`ra-${i}`}>{trailArrows(r, "#ffd54a", view.z, { size: 9, opacity: 0.95 })}</g>
                  ))}
                  {whD.length > 0 && (
                    <path
                      d={whD.join("")}
                      fill="none"
                      stroke="#3ad6e0"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                      strokeDasharray="4 3"
                      strokeLinecap="round"
                      opacity={0.9}
                    />
                  )}
                  {sigWhD.length > 0 && (
                    <path
                      d={sigWhD.join("")}
                      fill="none"
                      stroke="#b06bff"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                      strokeDasharray="5 4"
                      strokeLinecap="round"
                      opacity={0.9}
                    />
                  )}
                  {/* Los saltos calientes, marcados SOBRE la línea. Va aquí y no en la capa de intel
                      porque tiene que verse en CUALQUIER capa: sin Intel puesta no hay puntos rojos
                      y la ruta parecería limpia. `pointerEvents=none` para no robarle el clic al
                      sistema que hay debajo. */}
                  {intelEnRuta.map((h) => {
                    const p = posOf(h.sid);
                    if (!p) return null;
                    return (
                      <circle
                        key={`ri-${h.sid}`}
                        cx={p.px}
                        cy={p.py}
                        r={8 / view.z}
                        fill="none"
                        stroke="#ff3b3b"
                        strokeWidth={2}
                        vectorEffect="non-scaling-stroke"
                        opacity={0.95}
                        pointerEvents="none"
                      />
                    );
                  })}
                </>
              );
            })()}
            {routeStops.map((sid, i) =>
              sid != null && geo.idx.get(sid) ? (
                <circle
                  key={`rep-${i}`}
                  cx={geo.proj(geo.idx.get(sid)!).px}
                  cy={geo.proj(geo.idx.get(sid)!).py}
                  r={5.5 / view.z}
                  fill={i === 0 ? "#7fdc8f" : "#ffd54a"}
                  stroke="#0a0d12"
                  strokeWidth={0.8 / view.z}
                />
              ) : null
            )}
            {/* alcance de salto de capital */}
            {jumpActive &&
              jumpReach &&
              [...jumpReach.keys()].map((sid) => {
                const s = geo.idx.get(sid);
                if (!s) return null;
                const p = geo.proj(s);
                return (
                  <circle key={`jr-${sid}`} cx={p.px} cy={p.py} r={3.4 / view.z} fill="#b07cff" fillOpacity={0.6}>
                    <title>{`${s.n} (sec ${s.s.toFixed(1)})\n${jumpReach.get(sid)!.toFixed(2)} LY`}</title>
                  </circle>
                );
              })}
            {jumpActive &&
              jumpOrigin != null &&
              geo.idx.get(jumpOrigin) &&
              (() => {
                const p = geo.proj(geo.idx.get(jumpOrigin)!);
                return <circle cx={p.px} cy={p.py} r={6.5 / view.z} fill="#7fd8ff" stroke="#0a0d12" strokeWidth={0.8 / view.z} />;
              })()}
            {/* Capa RECORRIDO: por dónde has pasado, con los huecos DECLARADOS.
                Tres trazos distintos y no uno solo, porque un rastro pintado como continuo
                afirmaría rutas que Koru no vio: continuo = salto entre vecinos observado;
                punteado corto = pasó por sistemas intermedios que no presenciamos; punteado largo
                y apagado = rato ciego (app cerrada o piloto desconectado). */}
            {overlay === "recorrido" &&
              trackSegs &&
              trackSegs.segs.map((sg) => {
                const a = geo.idx.get(sg.a);
                const b = geo.idx.get(sg.b);
                if (!a || !b) return null;
                const pa = geo.proj(a);
                const pb = geo.proj(b);
                const w = 1.8 / view.z;
                return (
                  <line
                    key={sg.key}
                    x1={pa.px}
                    y1={pa.py}
                    x2={pb.px}
                    y2={pb.py}
                    stroke={sg.kind === "ciego" ? "#5a6675" : "#7fd8ff"}
                    strokeWidth={sg.kind === "salto" ? w : w * 0.8}
                    strokeLinecap="round"
                    opacity={sg.kind === "ciego" ? 0.38 : sg.kind === "sinver" ? 0.6 : 0.85}
                    strokeDasharray={
                      sg.kind === "salto"
                        ? undefined
                        : sg.kind === "sinver"
                        ? `${3 / view.z} ${3 / view.z}`
                        : `${1.5 / view.z} ${5 / view.z}`
                    }
                  >
                    <title>
                      {sg.kind === "salto"
                        ? `${sg.name}: ${a.n} → ${b.n}`
                        : sg.kind === "sinver"
                        ? `${sg.name}: ${a.n} → ${b.n}\n${tr("Pasó por sistemas que Koru no llegó a ver.")}`
                        : `${sg.name}: ${a.n} → ${b.n}\n${tr("Sin cobertura: Koru estaba cerrado o el piloto desconectado.")}`}
                    </title>
                  </line>
                );
              })}
            {/* EL VIAJE ELEGIDO, por encima del rastro. En AZUL —el mismo de su tarjeta— y más
                grueso: el rastro es «por dónde anduviste», el viaje es «ESTE trayecto». */}
            {viajeSegs &&
              viajeSegs.segs.map((sg) => {
                const a = geo.idx.get(sg.a);
                const b = geo.idx.get(sg.b);
                if (!a || !b) return null;
                const pa = geo.proj(a);
                const pb = geo.proj(b);
                return (
                  <line
                    key={sg.key}
                    x1={pa.px}
                    y1={pa.py}
                    x2={pb.px}
                    y2={pb.py}
                    stroke="#4aa3df"
                    strokeWidth={3 / view.z}
                    strokeLinecap="round"
                    opacity={sg.ciego ? 0.35 : 0.95}
                    strokeDasharray={sg.ciego ? `${2 / view.z} ${5 / view.z}` : undefined}
                  >
                    <title>
                      {sg.ciego
                        ? `${a.n} → ${b.n}\n${tr("Sin cobertura: Koru estaba cerrado o el piloto desconectado.")}`
                        : `${a.n} → ${b.n}`}
                    </title>
                  </line>
                );
              })}
            {/* Los INCIDENTES, sobre el sistema donde pasaron. Es lo que convierte el trazo en una
                historia: aquí te cantaron, aquí perdiste la nave. */}
            {viajeSegs &&
              [...viajeSegs.porSistema.entries()].map(([sid, n]) => {
                const s2 = geo.idx.get(sid);
                if (!s2) return null;
                const p = geo.proj(s2);
                return (
                  <g key={`vi-${sid}`} pointerEvents="none">
                    {n.intel > 0 && (
                      <circle
                        cx={p.px}
                        cy={p.py}
                        r={8 / view.z}
                        fill="none"
                        stroke="#ff3b3b"
                        strokeWidth={2}
                        vectorEffect="non-scaling-stroke"
                        opacity={0.95}
                      />
                    )}
                    {/* Una pérdida no es un aviso: se pinta RELLENA para que se vea de lejos, y en
                        un anillo más grande para que no la tape el del intel si coinciden. */}
                    {n.loss > 0 && (
                      <circle cx={p.px} cy={p.py} r={4.5 / view.z} fill="#e5534b" stroke="#0a0d12" strokeWidth={0.8 / view.z} />
                    )}
                    {n.kill > 0 && n.loss === 0 && (
                      <circle cx={p.px} cy={p.py} r={4 / view.z} fill="#3fb950" stroke="#0a0d12" strokeWidth={0.8 / view.z} />
                    )}
                  </g>
                );
              })}
            {/* Paradas: el tamaño es el tiempo OBSERVADO allí, nunca «hasta ahora». */}
            {overlay === "recorrido" &&
              trackSegs &&
              [...trackSegs.porPiloto.values()].flatMap((pts) =>
                pts.map((t, i) => {
                  const s = geo.idx.get(t.system_id);
                  if (!s) return null;
                  const p = geo.proj(s);
                  const min = (t.seen_ms - t.entered_ms) / 60000;
                  // Raíz cuadrada: media hora parada no puede tapar medio mapa. Y un mínimo, porque
                  // un sistema de paso (0 min observados) sigue siendo un sitio donde estuviste.
                  const r = cappedR(2 + Math.min(6, Math.sqrt(min)), 12, view.z);
                  const ultimo = i === pts.length - 1;
                  return (
                    <circle
                      key={`tkp-${t.character_id}-${t.entered_ms}`}
                      cx={p.px}
                      cy={p.py}
                      r={r}
                      fill={ultimo ? "#7fd8ff" : "none"}
                      stroke="#7fd8ff"
                      strokeWidth={1.2 / view.z}
                      opacity={ultimo ? 0.95 : 0.7}
                    >
                      <title>
                        {`${t.name} · ${s.n}\n${
                          min >= 1
                            ? `${tr("Visto aquí")} ${fmtMin(min)}`
                            : tr("De paso")
                        }\n${new Date(t.entered_ms).toLocaleString()}`}
                      </title>
                    </circle>
                  );
                })
              )}
            {/* Capa INTEL: tus pilotos activos, en cian y SUBORDINADOS.
                Un radar sin la marca de tu propia nave no sirve: la capa enseñaba las amenazas pero
                no dónde estás tú, así que no podía responder «¿esto me afecta?» sin cambiar de capa.
                Van pequeños a propósito — son referencia, no el sujeto.
                CON NOMBRE desde que la posición se refresca de verdad (antes solo en el tooltip):
                con varios pilotos repartidos, un círculo mudo obliga a pasar el ratón uno por uno
                justo cuando no hay tiempo. La etiqueta va apagada y por debajo de los avisos en
                contraste, que siguen mandando. */}
            {overlay === "intel" &&
              intelPilots.map((c) => {
                const s = geo.idx.get(c.system_id);
                if (!s) return null;
                const p = geo.proj(s);
                return (
                  <g key={`ipil-${c.id}`}>
                    <circle
                      cx={p.px}
                      cy={p.py}
                      r={cappedR(3.4, 9, view.z)}
                      fill="none"
                      stroke="#7fd8ff"
                      strokeWidth={1.4 / view.z}
                      opacity={0.9}
                    >
                      <title>{`${c.name}${c.ship ? ` · ${c.ship}` : ""}\n${s.n}`}</title>
                    </circle>
                    <circle cx={p.px} cy={p.py} r={cappedR(1.2, 3, view.z)} fill="#7fd8ff" />
                    <text
                      x={p.px}
                      y={p.py - cappedR(3.4, 9, view.z) - 3 / view.z}
                      className="map-label intel-pilot-label"
                      textAnchor="middle"
                      style={{ fontSize: `${11 / view.z}px` }}
                    >
                      {c.name}
                    </text>
                  </g>
                );
              })}

            {/* overlay Ubicación: dónde están tus personajes (agrupados por sistema) */}
            {overlay === "ubicacion" &&
              (() => {
                const bySys = new Map<number, CharLoc[]>();
                for (const c of charLocations ?? []) {
                  const arr = bySys.get(c.system_id) ?? [];
                  arr.push(c);
                  bySys.set(c.system_id, arr);
                }
                return [...bySys.entries()].map(([sysId, list]) => {
                  const s = geo.idx.get(sysId);
                  if (!s) return null;
                  const p = geo.proj(s);
                  const r = 4.6 / view.z;
                  return (
                    <g key={`loc-${sysId}`}>
                      <circle cx={p.px} cy={p.py} r={r} fill="#7fd8ff" stroke="#0a0d12" strokeWidth={0.6 / view.z}>
                        <title>{`${s.n} (sec ${s.s.toFixed(1)})\n${list.map((c) => c.name).join("\n")}`}</title>
                      </circle>
                      {list.map((c, i) => (
                        <text
                          key={c.id}
                          x={p.px + 6 / view.z}
                          y={p.py + (4 + i * 13) / view.z}
                          className="map-label"
                          style={{ fontSize: `${13 / view.z}px` }}
                        >
                          {c.name}
                        </text>
                      ))}
                    </g>
                  );
                });
              })()}
            {/* capa Lugares notables (POI) */}
            {overlay === "poi" &&
              POIS.map((poi) => {
                if (subFilter !== "all" && poi.kind !== subFilter) return null;
                const s = geo.nameIdx.get(poi.name.toLowerCase());
                if (!s) return null;
                const p = geo.proj(s);
                const col =
                  poi.kind === "hub" ? "#d8b24a" : poi.kind === "pvp" ? "#ff6b6b" : "#7fd8ff";
                const r = 3.9 / view.z;
                return (
                  <g key={`poi-${poi.name}`} className="clickable-sys" onClick={() => clickSystem(s.id)}>
                    <circle cx={p.px} cy={p.py} r={r * 2.4} fill={col} opacity={0.18} />
                    <circle cx={p.px} cy={p.py} r={r} fill={col} stroke="#0a0d12" strokeWidth={0.6 / view.z}>
                      <title>{`${poi.name} — ${poi.note}`}</title>
                    </circle>
                    <text
                      x={p.px + 5 / view.z}
                      y={p.py + 3.5 / view.z}
                      className="map-label"
                      style={{ fontSize: `${12 / view.z}px`, fill: col }}
                    >
                      {poi.name}
                    </text>
                  </g>
                );
              })}
            {/* marcador "estás aquí" (sistema actual del personaje) */}
            {hereSystemId != null &&
              geo.idx.get(hereSystemId) &&
              (() => {
                const p = geo.proj(geo.idx.get(hereSystemId)!);
                const r = 5.4 / view.z;
                return (
                  <g>
                    <circle cx={p.px} cy={p.py} r={r} fill="#7fd8ff">
                      <title>{`${tr("Aquí")}: ${geo.idx.get(hereSystemId)!.n}`}</title>
                    </circle>
                    <circle cx={p.px} cy={p.py} r={r * 2} fill="none" stroke="#7fd8ff" strokeWidth={1 / view.z}>
                      <animate attributeName="r" from={`${r}`} to={`${r * 3}`} dur="1.6s" repeatCount="indefinite" />
                      <animate attributeName="opacity" from="0.9" to="0" dur="1.6s" repeatCount="indefinite" />
                    </circle>
                  </g>
                );
              })()}
            {/* anillo del sistema seleccionado */}
            {selected != null &&
              geo.idx.get(selected) &&
              (() => {
                const p = geo.proj(geo.idx.get(selected)!);
                return <circle cx={p.px} cy={p.py} r={6 / view.z} fill="none" stroke="#7fd8ff" strokeWidth={1.2 / view.z} />;
              })()}
            {/* etiquetas de tus sistemas más activos (solo en overlay PvP) */}
            {overlay === "pvp" &&
              pvp
                .filter((d) => labeled.has(d.system_id))
                .map((d) => {
                  const s = geo.idx.get(d.system_id);
                  if (!s) return null;
                  const p = geo.proj(s);
                  return (
                    <text
                      key={`l-${d.system_id}`}
                      x={p.px + 6 / view.z}
                      y={p.py + 4 / view.z}
                      className="map-label"
                      style={{ fontSize: `${13 / view.z}px` }}
                    >
                      {s.n}
                    </text>
                  );
                })}
              </>
            )}
            {/* FLOTA EN VIVO, sobre CUALQUIER capa (no es una capa: es una presencia, como la
                ruta). VERDE a propósito — pedido de RoGiz7 al ver la v1 naranja: en un mapa donde
                el rojo/naranja significa pelea, los tuyos no pueden vestir de hostil. */}
            {(playback ? pbState : fleetRoster) &&
              (() => {
                // Reproduciendo, los anillos leen el instante T; si no, la op EN VIVO. Nunca los
                // dos: una sola verdad en pantalla.
                let porSys: Map<number, number>;
                if (playback && pbState) {
                  porSys = pbState.porSys;
                } else {
                  porSys = new Map<number, number>();
                  for (const m of fleetRoster!.members)
                    if (m.present && m.system_id != null)
                      porSys.set(m.system_id, (porSys.get(m.system_id) ?? 0) + 1);
                }
                return [...porSys.entries()].map(([sid, n]) => {
                  const s = geo.idx.get(sid);
                  if (!s) return null;
                  const p = geo.proj(s);
                  return (
                    <g
                      key={`fl-${sid}`}
                      className="flota-marca"
                      transform={`translate(${p.px} ${p.py}) scale(${1 / view.z})`}
                    >
                      <circle className="flota-anillo" r="9" />
                      <text className="flota-n" y="-13" textAnchor="middle">
                        {n}
                      </text>
                    </g>
                  );
                });
              })()}
            {/* Reproducción: los cantos de intel de la op, como pulso rojo en su sistema durante
                los ~20 s (de tiempo de juego) que siguen al canto. La autopsia, en movimiento. */}
            {playback &&
              playback.intel
                .filter((r) => r.ts_ms <= pbT && r.ts_ms > pbT - 20000)
                .map((r) => {
                  const s = geo.idx.get(r.system_id);
                  if (!s) return null;
                  const p = geo.proj(s);
                  return (
                    <g
                      key={`pbi-${r.ts_ms}-${r.system_id}`}
                      className="pb-intel"
                      transform={`translate(${p.px} ${p.py}) scale(${1 / view.z})`}
                    >
                      <circle r="12" />
                    </g>
                  );
                })}
            {/* Pulso de llegada de focusSystem: DOS anillos que se expanden y se apagan solos
                (CSS, una sola pasada). La `key` con el instante fuerza a React a recrear el nodo
                si centras dos veces el mismo sistema — sin ella la animación no se relanza. */}
            {focusPulse &&
              (() => {
                const s = geo.idx.get(focusPulse.sid);
                if (!s) return null;
                const p = geo.proj(s);
                return (
                  <g key={focusPulse.k} className="focus-pulse" transform={`translate(${p.px} ${p.py}) scale(${1 / view.z})`}>
                    <circle className="fp-a" r="10" />
                    <circle className="fp-b" r="10" />
                  </g>
                );
              })()}
          </g>
        </svg>

        {hover &&
          geo.idx.get(hover.sid) &&
          (() => {
            const s = geo.idx.get(hover.sid)!;
            const region = ne.regions.find((r) => r.id === s.r)?.n ?? "";
            const kv = liveKills?.get(hover.sid) ?? 0;
            const jv = liveJumps?.get(hover.sid) ?? 0;
            const sov = sovBySystem?.get(hover.sid);
            const fw = fwBySystem?.get(hover.sid);
            const fwFac = fw ? FW_FACTIONS[fw.owner_faction_id] : undefined;
            return (
              <div className="map-tip" style={{ left: hover.sx + 14, top: hover.sy + 14 }}>
                <div>
                  <strong>{s.n}</strong>{" "}
                  <span style={{ color: secColor(s.s) }}>{s.s.toFixed(1)}</span>
                </div>
                <div className="muted small">{region}</div>
                {sov?.owner_name && (
                  <div className="small" style={{ color: sov.owner_id ? ownerColor(sov.owner_id) : undefined }}>
                    {sov.owner_name}
                  </div>
                )}
                {fwFac && (
                  <div className="small" style={{ color: fwFac.color }}>
                    {fwFac.name}
                    {fw?.contested && fw.contested !== "uncontested" ? ` · ${fw.contested}` : ""}
                  </div>
                )}
                <div className="small">
                  Kills 1h: <strong className={kv > 0 ? "tip-hot" : ""}>{kv}</strong>
                </div>
                <div className="small">Jumps 1h: {jv}</div>
              </div>
            );
          })()}

        {/* Leyenda de la capa activa, abajo a la izquierda como en el mapa del juego. Sin esto el
            color de un heatmap no significa nada para quien lo mira. */}
        <MapScaleLegend scale={scaleFor(overlay, liveMax)} />
        {/* Clave de los trazos, solo con lo que hay pintado en este momento. */}
        <MapTrailLegend
          items={[
            ...(overlay === "intel" && interceptPilot
              ? [{ color: INTERCEPT, label: `${tr("Interceptando")}: ${interceptPilot}`, dash: true }]
              : []),
            ...(overlay === "intel" && huntTracks.size > (interceptPilot ? 1 : 0)
              ? [
                  {
                    color: HUNT,
                    label: `${tr("Seguido")} (${huntTracks.size - (interceptPilot ? 1 : 0)})`,
                    dash: true,
                  },
                ]
              : []),
            ...(overlay === "intel" && intelTrackPilot && !huntTracks.has(intelTrackPilot)
              ? [{ color: INTERCEPT, label: `${tr("Rastro")}: ${intelTrackPilot}` }]
              : []),
            // Recorrido: la clave NO es decorativa. Sin ella, el punteado se lee como «fui por
            // aquí» cuando significa justo lo contrario — que Koru no lo vio.
            ...(overlay === "recorrido" && trackSegs
              ? [
                  ...(trackSegs.segs.some((s) => s.kind === "salto")
                    ? [{ color: "#7fd8ff", label: tr("Salto visto") }]
                    : []),
                  ...(trackSegs.segs.some((s) => s.kind === "sinver")
                    ? [{ color: "#7fd8ff", label: tr("Tramo no visto"), dash: true }]
                    : []),
                  ...(trackSegs.segs.some((s) => s.kind === "ciego")
                    ? [{ color: "#5a6675", label: tr("Sin cobertura"), dash: true }]
                    : []),
                ]
              : []),
            // El viaje elegido y sus incidentes. Solo aparecen cuando hay uno abierto: una leyenda
            // que explica algo que no está en pantalla es ruido.
            ...(viajeSegs
              ? [
                  { color: "#4aa3df", label: tr("Viaje elegido") },
                  ...([...viajeSegs.porSistema.values()].some((n) => n.intel > 0)
                    ? [{ color: "#ff3b3b", label: tr("Aviso de intel") }]
                    : []),
                  ...([...viajeSegs.porSistema.values()].some((n) => n.loss > 0)
                    ? [{ color: "#e5534b", label: tr("Nave perdida") }]
                    : []),
                ]
              : []),
            ...(routePath && routePath.length > 1 ? [{ color: "#ffd54a", label: tr("Ruta") }] : []),
            ...(ansi && useAnsiblex && (overlay === "intel" || routeActive || jumpActive)
              ? [{ color: "#56d364", label: tr("Ansiblex") }]
              : []),
            ...(wh && useWormholes && (routeActive || jumpActive)
              ? [{ color: "#3ad6e0", label: "Wormhole", dash: true }]
              : []),
            ...(sigWh && (useSigWormholes || overlay === "firmas") && sigWh.edges.length > 0
              ? [{ color: "#b06bff", label: tr("Mis WH"), dash: true }]
              : []),
          ]}
        />

        <div className="map-zoom">
          <button onClick={() => zoomBy(1.3)}>+</button>
          <button onClick={() => zoomBy(1 / 1.3)}>−</button>
          <button onClick={() => setView({ z: 1, x: 0, y: 0 })} title="Reset">⟲</button>
        </div>

        {/* EL NARRADOR del reproductor (izquierda): lo sucedido hasta T, lo último arriba.
            Mientras se reproduce, este panel ES la izquierda — la ficha y el feed vivo se
            apartan: rebobinar es un modo de análisis, y dos relojes a la vez confunden. */}
        {playback && pbFeed && (
          <div className="intel-panel pb-narrador">
            <div className="intel-head">
              <strong>🎞 {playback.name}</strong>
            </div>
            <div className="intel-feed">
              {pbFeed.length === 0 && (
                <div className="muted small intel-feed-vacio">{tr("Aún no ha pasado nada.")}</div>
              )}
              {pbFeed.map((l, i) => (
                <div key={`${l.ts}-${i}`} className={`pb-linea pb-l-${l.clase}`}>
                  <span className="ops-ev-hora small muted">
                    [{new Date(l.ts).toISOString().slice(11, 19)}]
                  </span>
                  {l.icon && <span className="pb-l-ico">{l.icon}</span>}
                  {l.pre && <span> {l.pre} </span>}
                  {/* Retrato circular: iconografía EVE primero. El intel no lo lleva (⚠ basta:
                      es un aviso, no una entrada de persona) y un caído sin id tampoco. */}
                  {l.charId != null && l.clase !== "intel" && (
                    <img
                      className="pb-cara"
                      src={`https://images.evetech.net/characters/${l.charId}/portrait?size=32`}
                      alt=""
                      loading="lazy"
                    />
                  )}
                  {l.quien && <span className="pb-l-quien">{l.quien}</span>}
                  {l.verbo && <span> {l.verbo} </span>}
                  {l.sysId != null && (
                    <span
                      className="ver-mapa pb-l-sys"
                      title={tr("Ver en el mapa")}
                      onClick={() => focusSystem(l.sysId!)}
                    >
                      {geo?.idx.get(l.sysId)?.n ?? `#${l.sysId}`}
                    </span>
                  )}
                  {l.shipId != null && (
                    <>
                      {l.sysId != null && <span className="muted"> · </span>}
                      <img className="type-ico pb-l-nave" src={typeIcon(l.shipId)} alt="" loading="lazy" />
                      <span> {fltShipNames.get(l.shipId) ?? `#${l.shipId}`}</span>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* En las capas normales la ficha flota arriba a la izquierda, como siempre. En Intel no se
            pinta aquí: se pinta como pestaña de la tarjeta derecha (más abajo). */}
        {overlay !== "intel" && !playback && fichaSistema}

        {/* Panel de Intel: configuración + feed en vivo (izquierda) */}
        {overlay === "intel" && !playback && intel && (
          <div className="intel-panel">
            <div className="intel-head">
              <strong>🚨 {tr("Intel en vivo")}</strong>
              <button
                className={`intel-live-toggle${intel.live ? " on" : ""}`}
                onClick={() => intel.onToggleLive?.()}
                title={tr("Mantener el intel activo aunque mires otras secciones")}
              >
                {intel.live ? `● ${tr("Activo")}` : `○ ${tr("Apagado")}`}
              </button>
              <span className="muted small">
                {(intel.onlyRange
                  ? [...(intelReports?.rep.keys() ?? [])].filter((sid) => {
                      const d = jumpsFrom?.get(sid);
                      return d != null && d <= intel.alertJumps;
                    }).length
                  : intelReports?.rep.size ?? 0)}{" "}
                {tr("sistema(s)")}
              </span>
              <button
                className={`intel-gear${habitualOpen ? " active" : ""}`}
                onClick={() => {
                  const nv = !habitualOpen;
                  setHabitualOpen(nv);
                  if (nv) {
                    setIntelDetail(null);
                    setSelected(null);
                    void loadHabitual();
                  }
                }}
                title={tr("Hostiles habituales")}
              >
                🎯
              </button>
              <button
                className={`intel-gear${cfgOpen ? " active" : ""}`}
                onClick={() => setCfgOpen((v) => !v)}
                title={tr("Configuración")}
              >
                ⚙
              </button>
            </div>
            {/* La VERDAD del vigilante, en su propia línea: la dice el hilo de Rust, no el
                interruptor de arriba. Sin esto, un intel MUERTO y uno en CALMA se ven igual —
                nos costó dos sesiones de diagnóstico. (Va fuera de .intel-head a propósito:
                dentro apretaba el flex y partía el título en tres líneas.) */}
            {intel.live &&
              intel.status &&
              (() => {
                const s = intel.status;
                const stale = Date.now() - s.last_tick_ms > 15000;
                const [cls, txt, tip] = stale
                  ? ["bad", `⚠ ${tr("vigilante sin responder")}`, tr("El hilo del intel no responde")]
                  : s.last_error
                    ? ["bad", `⚠ ${tr("error leyendo logs")}`, s.last_error]
                    : !s.collecting
                      ? ["bad", `⚠ ${tr("parado")}: ${s.idle_reason ?? "?"}`, s.idle_reason ?? ""]
                      : s.files === 0
                        ? [
                            "warn",
                            `⚠ ${tr("sin logs de ese canal")}`,
                            tr("No hay ningún log de ese canal en la carpeta. ¿Canal correcto? ¿Has entrado al canal en esta sesión?"),
                          ]
                        : [
                            "ok",
                            `${tr("leyendo")} ${s.files} ${tr("log(s)")} · ${s.lines} ${tr("líneas")}`,
                            tr("El vigilante está leyendo de verdad"),
                          ];
                return (
                  <div className={`intel-health-row ${cls}`} title={tip}>
                    {txt}
                  </div>
                );
              })()}
            {cfgOpen && (
              <div className="intel-cfg">
                {/* Lo que queda aquí es SOLO lo que se toca volando. La config estable (carpeta,
                    canales, recencia, rastro, sonido) se mudó a Ajustes → Intel: en un panel de
                    280 px competía por sitio con esto, que es lo que de verdad cambia según lo que
                    estés haciendo. Un umbral de 3 saltos rateando en un rincón no es el mismo que
                    10 en roam. */}
                <div className="intel-nums">
                  <label>
                    <span className="muted small">{tr("Alerta ≤ saltos")}</span>
                    <input
                      type="number"
                      min={0}
                      max={20}
                      value={intel.alertJumps}
                      onChange={(e) => intel.onConfig({ alertJumps: Math.max(0, Number(e.target.value)) })}
                    />
                  </label>
                </div>
                <label className="intel-chk">
                  <input
                    type="checkbox"
                    checked={intel.onlyRange}
                    onChange={(e) => intel.onConfig({ onlyRange: e.target.checked })}
                  />
                  {tr("Mostrar solo intel en rango")} (≤ {intel.alertJumps} {tr("saltos")})
                </label>
                {/* Qué pilotos cuentan para la proximidad. Apagar uno lo saca de TODO: de los saltos,
                    del aviso flotante y del mapa. El caso que lo motiva: un alt aparcado en Jita
                    haría que medio New Eden quedara «cerca» y el intel cantaría sin parar.
                    Los desconectados se marcan y no cuentan, porque ESI devuelve su última posición
                    conocida como si siguieran ahí. */}
                {(charLocations?.length ?? 0) > 0 && (
                  <div className="intel-pilots">
                    <span className="muted small">
                      {tr("Pilotos que cuentan para la proximidad")}
                      {/* Con 20 personajes la lista completa no cabe en un panel de 280 px. Y no
                          hace falta: un piloto DESCONECTADO no cuenta para nada aquí, así que
                          enseñarlo solo es ruido. Se ven los conectados, y quien quiera revisar los
                          apagados de un alt que ahora no juega, despliega. */}
                      {(charLocations ?? []).some((c) => c.online === false) && (
                        <button className="intel-pilot-todos" onClick={() => setVerTodosPilotos((v) => !v)}>
                          {verTodosPilotos ? tr("solo conectados") : tr("ver todos")}
                        </button>
                      )}
                    </span>
                    <div className="intel-pilot-list">
                      {(charLocations ?? [])
                        // `online === null` = no se pudo saber (sin scope): se enseña, porque
                        // esconderlo dejaría al jugador sin forma de tocarlo.
                        .filter((c) => verTodosPilotos || c.online !== false)
                        .map((c) => {
                        const off = pilotsOff.has(c.id);
                        const desconectado = c.online === false;
                        return (
                          <button
                            key={c.id}
                            className={`intel-pilot${off ? " off" : ""}${desconectado ? " away" : ""}`}
                            onClick={() => togglePilot(c.id)}
                            title={
                              desconectado
                                ? tr("Desconectado: no cuenta aunque esté encendido (ESI devuelve su última posición conocida).")
                                : off
                                ? tr("Apagado: no cuenta para los saltos ni sale en los avisos.")
                                : tr("Cuenta para los saltos. Pulsa para apagarlo.")
                            }
                          >
                            <i className="ip-dot" />
                            {c.name}
                            {desconectado && <em className="ip-away">{tr("fuera")}</em>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="intel-anchors">
                  <span className="muted small">{tr("Puntos de ancla (proximidad)")}</span>
                  <div className="intel-anchor-add">
                    <input
                      type="text"
                      placeholder={tr("Sistema… (p. ej. 9PX2-F)")}
                      value={anchorInput}
                      onChange={(e) => setAnchorInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        const s = geo?.nameIdx.get(anchorInput.trim().toLowerCase());
                        if (s && !intel.anchors.includes(s.id)) {
                          intel.onConfig({ anchors: [...intel.anchors, s.id] });
                          setAnchorInput("");
                        }
                      }}
                    />
                    <button
                      onClick={() => {
                        const s = geo?.nameIdx.get(anchorInput.trim().toLowerCase());
                        if (s && !intel.anchors.includes(s.id)) {
                          intel.onConfig({ anchors: [...intel.anchors, s.id] });
                          setAnchorInput("");
                        }
                      }}
                    >
                      +
                    </button>
                  </div>
                  <div className="intel-anchor-chips">
                    {intel.anchors.length === 0 && (
                      <span className="muted small">
                        {tr("Sin anclas. También puedes pinchar un sistema → “⚓ Anclar aquí”.")}
                      </span>
                    )}
                    {intel.anchors.map((sid) => (
                      <span key={sid} className="intel-anchor-chip">
                        ⚓ {geo?.idx.get(sid)?.n ?? sid}
                        <button
                          title={tr("Quitar")}
                          onClick={() => intel.onConfig({ anchors: intel.anchors.filter((x) => x !== sid) })}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                  <p className="muted small intel-anchor-hint">
                    {tr("La alerta usa el sistema más cercano entre tu personaje y tus anclas.")}
                  </p>
                </div>
                {/* Puerta a lo que ya no está aquí. Sin este enlace, mudar la carpeta y los canales
                    a Ajustes los haría invisibles: quien abre la ⚙ del mapa buscando «dónde se
                    elige el canal» no tiene por qué adivinar que ahora está en otro sitio. */}
                {onOpenIntelSettings && (
                  <button className="intel-mas-ajustes" onClick={onOpenIntelSettings}>
                    ⚙ {tr("Carpeta, canales y sonido…")}
                  </button>
                )}
              </div>
            )}
            <div className="intel-feed">
              {intel.channels.length === 0 && (
                <div className="muted small intel-feed-vacio">
                  {!intel.folder
                    ? tr("Falta decirle a Koru dónde guarda EVE los chats.")
                    : tr("Elige al menos un canal para empezar.")}
                  {onOpenIntelSettings && (
                    <button className="intel-mas-ajustes" onClick={onOpenIntelSettings}>
                      ⚙ {tr("Configurar el intel")}
                    </button>
                  )}
                </div>
              )}
              {intel.channels.length > 0 && (intelReports?.feed.length ?? 0) === 0 && (
                <div className="muted small">{tr("Sin actividad reciente.")}</div>
              )}
              {intelReports?.feed
                .filter((f) => {
                  if (!intel.onlyRange) return true;
                  if (f.sysId == null) return false;
                  const d = jumpsFrom?.get(f.sysId);
                  return d != null && d <= intel.alertJumps;
                })
                .slice(0, 60)
                .map((f, i) => {
                const j = f.sysId != null ? jumpsFrom?.get(f.sysId) : undefined;
                const near = j != null && j <= intel.alertJumps;
                // Tu llegada por puentes. Solo se enseña si ACORTA de verdad: repetir la misma
                // cifra al lado no informa de nada y ensucia una lista que se lee de un vistazo.
                const h = f.sysId != null ? huntFrom?.get(f.sysId) : undefined;
                const shortcut = h != null && j != null && h < j;
                return (
                  <div
                    key={`${f.ts}-${i}`}
                    className={`intel-row clickable${near ? " near" : ""}`}
                    onClick={() =>
                      openIntelDetail({
                        sysId: f.sysId,
                        sysName: f.sysName,
                        ts: f.ts,
                        author: f.author,
                        message: f.message,
                      })
                    }
                  >
                    <div className="intel-row-top">
                      <span className="intel-time">{fmtAgo(Date.now() - f.ts)}</span>
                      {(() => {
                        const n = f.count ?? (f.pilots.length || null);
                        if (n == null) return null;
                        return (
                          <span
                            className={`intel-count ${n > 1 ? "fleet" : "solo"}`}
                            title={n > 1 ? tr("Posible flota") : tr("Cazador individual")}
                          >
                            {n > 1 ? `▲ ${n}` : "• 1"}
                          </span>
                        );
                      })()}
                      {f.sysName && (
                        <span className="intel-sys">
                          {f.sysName}
                          {j != null && <em className="intel-j"> · {j} {tr("saltos")}</em>}
                          {shortcut && (
                            <em
                              className="intel-hunt"
                              title={tr("Saltos que tardas TÚ en llegar usando tus Ansiblex. La alarma sigue contando solo puertas: el hostil no puede cruzar tus puentes.")}
                            >
                              {" · "}
                              <AnsiBadge /> {h}
                            </em>
                          )}
                        </span>
                      )}
                    </div>
                    <div className="intel-msg">
                      <span className="intel-author">{f.author}:</span> {f.message}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="intel-rstack">
        {/* UNA sola tarjeta con pestañas: antes eran cuatro apiladas y se comían el mapa. Solo se
            ve el panel de la pestaña activa; la cabecera dice qué hay disponible. */}
        {rightTabs.length > 0 && (
        <div className="intel-detail right-card">
          <div className="right-tabs">
            {rightTabs.map((t) => (
              <button
                key={t.id}
                className={`right-tab${rightTab === t.id ? " active" : ""}`}
                onClick={() => setRightTab(t.id)}
              >
                {t.typeId != null && (
                  <img className="rt-ico" src={typeIcon(t.typeId, 32)} alt="" width={14} height={14} loading="lazy" />
                )}
                {t.label}
              </button>
            ))}
            <button
              className="chip-fold"
              title={cardOpen ? tr("Plegar") : tr("Desplegar")}
              onClick={() => setCardOpen((v) => !v)}
            >
              {cardOpen ? "▾" : "▸"}
            </button>
          </div>
          {cardOpen && (<>
        {/* Tarjeta de RUTA compacta (derecha): lo que se toca sobre la marcha mientras miras el
            mapa — a dónde vas, el interruptor de Ansiblex para probar rápido con/sin puentes, y
            mandar a EVE. El editor completo (paradas, evitar, turn-by-turn) vive abajo. */}
        {rightTab === "ruta" && routeActive && (
          <>
            <span className="chip-head">
              <img className="rt-ico" src={typeIcon(439, 32)} alt="" width={16} height={16} loading="lazy" />
              {tr("Ruta")}
              {routePath && (
                <span className="muted small">
                  {" · "}
                  {routePath.length - 1} {tr("saltos")}
                  {ansiLegs.size > 0 && <> · {ansiLegs.size} <AnsiBadge /></>}
                  {whLegs.size > 0 && <span style={{ color: "#3ad6e0" }}> · {whLegs.size} ◆</span>}
                </span>
              )}
            </span>
            <span className="route-mini">
              {routeWaypoints.length >= 2
                ? `${nameOf(routeWaypoints[0])} → ${nameOf(routeWaypoints[routeWaypoints.length - 1])}`
                : tr("Haz click en sistemas del mapa para poner origen y destino.")}
            </span>
            {/* LO PRIMERO que se lee de una ruta trazada: si tiene avisos encima. Va antes que los
                interruptores de Ansiblex y wormholes porque cambia la decisión, no el cálculo. */}
            {intelEnRuta.length > 0 && routePath && (
              <div className="route-intel">
                <div className="route-intel-head">
                  ⚠ {intelEnRuta.length}{" "}
                  {intelEnRuta.length === 1 ? tr("salto con aviso") : tr("saltos con avisos")}{" "}
                  <span className="muted">/ {routePath.length - 1}</span>
                </div>
                {intelEnRuta.map((h) => (
                  <button
                    key={h.sid}
                    className="route-intel-row"
                    title={h.message}
                    onClick={() =>
                      openIntelDetail({
                        sysId: h.sid,
                        sysName: h.name,
                        ts: h.ts,
                        author: h.author,
                        message: h.message,
                      })
                    }
                  >
                    <span className="ri-salto">{h.salto === 0 ? tr("Aquí") : `+${h.salto}`}</span>
                    <span className="ri-sys">{h.name}</span>
                    {h.count != null && h.count > 1 && <span className="ri-n">▲{h.count}</span>}
                    <span className="muted small">{fmtAgo(Date.now() - h.ts)}</span>
                  </button>
                ))}
              </div>
            )}
            {ansi && (
              <button
                className={`intel-hab-track${useAnsiblex ? " active" : ""}`}
                title={tr("Usar los Ansiblex de tu alianza al calcular la ruta")}
                onClick={() => setUseAnsiblex(!useAnsiblex)}
              >
                <AnsiBadge /> {tr("Ansiblex")} <span className="muted">({ansi.drawn})</span>
              </button>
            )}
            <button
              className={`intel-hab-track${useWormholes ? " active" : ""}`}
              title={tr("Usar los wormholes de Thera/Turnur (eve-scout) al calcular la ruta")}
              onClick={() => setUseWormholes(!useWormholes)}
            >
              ◆ {tr("Wormholes")}{" "}
              <span className="muted">
                {wh ? `(${wh.drawn})` : useWormholes ? tr("cargando…") : ""}
              </span>
            </button>
            {sigWh && sigWh.edges.length > 0 && (
              <button
                className={`intel-hab-track${useSigWormholes ? " active" : ""}`}
                title={tr("Usar TUS wormholes escaneados con destino anotado al calcular la ruta")}
                onClick={() => setUseSigWormholes(!useSigWormholes)}
                style={{ color: useSigWormholes ? "#b06bff" : undefined }}
              >
                📡 {tr("Mis WH")} <span className="muted">({sigWh.edges.length})</span>
              </button>
            )}
            {routeWaypoints.length > 0 && hereCharId != null && (
              <button
                className="route-send-eve"
                disabled={!canWaypoint || sendingEve}
                title={
                  canWaypoint
                    ? tr("Pone la ruta en el piloto automático de EVE (el juego la calcula con tus preferencias, Ansiblex incluidos si los tienes activados).")
                    : tr("Falta el permiso: vuelve a iniciar sesión con «Ubicación» para conceder «poner destino en EVE».")
                }
                onClick={() => sendToEve(routeWaypoints)}
              >
                {sendingEve ? "⏳" : "🚀"}{" "}
                {routeWaypoints.length > 1 ? tr("Enviar ruta a EVE") : tr("Enviar destino a EVE")}
              </button>
            )}
            {/* El botón deshabilitado ya llevaba el motivo en su `title`, pero un control DESHABILITADO
                no recibe eventos de ratón en WebView2 → ese tooltip NO se llega a ver nunca. Quedaba
                un botón gris sin explicación, y justo tras esta actualización lo van a ver TODOS: el
                scope `write_waypoint` es nuevo y los tokens ya emitidos no lo traen. Así que el
                motivo va visible, no escondido. */}
            {routeWaypoints.length > 0 && hereCharId != null && !canWaypoint && (
              <div className="small route-scope-warn">
                ⚠ {tr("Falta el permiso: vuelve a iniciar sesión con «Ubicación» para conceder «poner destino en EVE».")}
              </div>
            )}
            {eveMsg && <div className="small muted">{eveMsg}</div>}
            <button
              className="route-detail-btn"
              onClick={() => navRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              {tr("Detalle de navegación")} ↓
            </button>
          </>
        )}
        {/* Modo cazador: lista de TODOS los seguidos. Sus avistamientos salen en morado en el mapa;
            el que estés interceptando lleva además el rastro a plena opacidad. */}
        {rightTab === "rastro" && overlay === "intel" && huntPilots.length > 0 && (
          <>
            <span className="chip-head">
              🎯 {tr("Siguiendo")} <span className="muted small">({huntPilots.length})</span>
              <button
                className="sys-close"
                title={tr("Dejar de seguir a todos")}
                style={{ marginLeft: "auto" }}
                onClick={() => {
                  setIntercepting(false);
                  setInterceptPilot(null);
                  setRouteActive(false);
                  clearHuntTrack();
                }}
              >
                ✕
              </button>
            </span>
            {hereSystemId == null && (
              <span className="muted small">
                {tr("Selecciona el personaje cazador para trazar desde su ubicación.")}
              </span>
            )}
            <ul className="hunt-list">
              {huntPilots.map((name) => {
                const track = huntTracks.get(name);
                const isTarget = interceptPilot === name;
                const last = track && track.length > 0 ? track[track.length - 1].system_id : null;
                return (
                  <li key={name} className={isTarget ? "hunt-row target" : "hunt-row"}>
                    <div className="hunt-row-top">
                      <span className="intel-pilot-name">{name}</span>
                      <button
                        className="sys-close"
                        title={tr("Dejar de seguir")}
                        onClick={() => {
                          if (interceptPilot === name) {
                            setIntercepting(false);
                            setInterceptPilot(null);
                          }
                          dropHuntPilot(name);
                        }}
                      >
                        ✕
                      </button>
                    </div>
                    <span className="muted small">
                      {track == null
                        ? tr("Cargando…")
                        : track.length === 0
                          ? tr("Sin avistamientos guardados todavía (se acumulan según aparezca en intel).")
                          : `${track.length} ${tr("avistamientos")}${last != null ? ` · ${nameOf(last)}` : ""}`}
                    </span>
                    {last != null && (
                      <button
                        className={`intercept-btn ${isTarget && intercepting ? "on" : ""}`}
                        disabled={hereSystemId == null}
                        title={
                          hereSystemId == null
                            ? tr("Selecciona el personaje cazador: su sistema es el punto de partida de la ruta.")
                            : tr("Traza y mantiene la ruta desde tu cazador hasta el último sistema donde lo vieron. Se re-traza si se mueve.")
                        }
                        onClick={() => {
                          if (isTarget && intercepting) {
                            setIntercepting(false);
                            setInterceptPilot(null);
                            return;
                          }
                          setInterceptPilot(name);
                          setJumpActive(false);
                          setUseAnsiblex(true);
                          setRouteActive(true);
                          setIntercepting(true);
                        }}
                      >
                        🎯 {isTarget && intercepting ? tr("Interceptando ✓") : tr("Interceptar")}
                        {isTarget && intercepting && routePath && routePath.length > 1 && (
                          <span className="muted"> · {routePath.length - 1} {tr("saltos")}</span>
                        )}
                        {isTarget && intercepting && manualTarget != null && manualTarget !== huntTarget && (
                          <span className="muted"> · {tr("apuntado a mano")}</span>
                        )}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {rightTab === "sistema" && fichaSistema}

        {/* VIAJES: la lista de lo que hiciste de verdad, con lo que pasó por el camino. */}
        {/* E4 — LOS MANDOS DEL REPRODUCTOR: play/pausa, velocidad, y la barra con las marcas de
            lo que pasó (☠ kills · ✝ pérdidas · ⚠ intel). La cinta fina como scrubber, para v2. */}
        {rightTab === "op" && playback && (
          <div className="pb-card">
            <div className="pb-head">
              <strong>{playback.name}</strong>
              <button
                className="chip-fold"
                title={tr("Cerrar")}
                onClick={() => onPlaybackClose?.()}
              >
                ✕
              </button>
            </div>
            {/* La composición EN EL INSTANTE T: quién iba con qué, y si cambió se ve cambiar
                mientras la película corre. El que salió queda apagado, no borrado. */}
            {pbState && pbState.personas.length > 0 && (
              <div className="pb-comp">
                {pbState.personas.map((p) => (
                  <div key={p.charId} className={`pb-comp-fila${p.present ? "" : " fuera"}`}>
                    <img
                      className="pb-cara"
                      src={`https://images.evetech.net/characters/${p.charId}/portrait?size=32`}
                      alt=""
                      loading="lazy"
                    />
                    <span className="pb-comp-quien">{p.quien}</span>
                    {p.ship != null && (
                      <span className="pb-comp-nave small">
                        <img className="type-ico pb-l-nave" src={typeIcon(p.ship)} alt="" loading="lazy" />
                        {fltShipNames.get(p.ship) ?? `#${p.ship}`}
                      </span>
                    )}
                    {p.present && p.system != null && (
                      <span
                        className="ver-mapa pb-l-sys small"
                        title={tr("Ver en el mapa")}
                        onClick={() => focusSystem(p.system!)}
                      >
                        {geo?.idx.get(p.system)?.n ?? `#${p.system}`}
                      </span>
                    )}
                    {!p.present && <span className="muted small">{tr("salió")}</span>}
                  </div>
                ))}
              </div>
            )}
            <div className="pb-reloj">{new Date(pbT).toISOString().slice(11, 19)}</div>
            <div className="pb-controles">
              <button
                className="ida-btn"
                onClick={() => {
                  if (!pbPlaying && pbT >= playback.t1) setPbT(playback.t0); // rebobinar al final
                  setPbPlaying((p) => !p);
                }}
              >
                {pbPlaying ? "⏸" : "▶"}
              </button>
              <button
                className="ida-btn"
                title={tr("Velocidad")}
                onClick={() =>
                  setPbSpeed((s) => (s === 10 ? 30 : s === 30 ? 60 : s === 60 ? 120 : 10))
                }
              >
                ×{pbSpeed}
              </button>
            </div>
            <div className="pb-barra-zona">
              <input
                type="range"
                className="pb-barra"
                min={playback.t0}
                max={playback.t1}
                step={1000}
                value={pbT}
                onChange={(e) => setPbT(Number(e.target.value))}
              />
              <div className="pb-marcas">
                {playback.kills.map((k, i) => (
                  <span
                    key={`mk-${i}`}
                    className={`pb-marca ${k.loss ? "perdida" : "kill"}`}
                    style={{
                      left: `${(((Date.parse(k.at) - playback.t0) / Math.max(1, playback.t1 - playback.t0)) * 100).toFixed(1)}%`,
                    }}
                    title={k.loss ? "✝" : "☠"}
                  />
                ))}
                {playback.intel.map((r, i) => (
                  <span
                    key={`mi-${i}`}
                    className="pb-marca intel"
                    style={{
                      left: `${(((r.ts_ms - playback.t0) / Math.max(1, playback.t1 - playback.t0)) * 100).toFixed(1)}%`,
                    }}
                    title={`⚠ ${r.name}`}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* FLOTA EN VIVO: el roster del FC junto al feed — quién, con qué y dónde, agrupado por
            SISTEMA (que es la pregunta táctica: «¿qué tengo AHÍ?»), frente a lo que canta el
            intel alrededor. El nombre del sistema centra el mapa: misma focusSystem de siempre. */}
        {rightTab === "flota" && fleetRoster && (
          <div className="flota-card">
            {(() => {
              const porSys = new Map<number, typeof fleetRoster.members>();
              for (const m of fleetRoster.members) {
                if (!m.present) continue;
                const k = m.system_id ?? -1;
                if (!porSys.has(k)) porSys.set(k, []);
                porSys.get(k)!.push(m);
              }
              return [...porSys.entries()].map(([sid, ms]) => (
                <div key={`flc-${sid}`} className="flota-card-sys">
                  <button
                    className="flota-card-sysname"
                    onClick={() => sid >= 0 && focusSystem(sid)}
                    title={tr("Ver en el mapa")}
                  >
                    {sid >= 0 ? (geo?.idx.get(sid)?.n ?? `#${sid}`) : tr("sistema desconocido")}
                    <span className="muted small"> · {ms.length}</span>
                  </button>
                  {ms.map((m) => (
                    <div key={m.character_id} className="flt-miembro flota-card-fila">
                      <img
                        className="flt-cara"
                        src={`https://images.evetech.net/characters/${m.character_id}/portrait?size=32`}
                        alt=""
                        loading="lazy"
                      />
                      <span className="flota-card-nombre">
                        {galon(m.role)}
                        {m.name ?? `#${m.character_id}`}
                      </span>
                      {m.ship_type_id != null && (
                        <span className="flt-nave small">
                          <img
                            className="type-ico"
                            src={typeIcon(m.ship_type_id)}
                            alt=""
                            loading="lazy"
                          />
                          {fltShipNames.get(m.ship_type_id) ?? `#${m.ship_type_id}`}
                        </span>
                      )}
                      {m.station_id != null && (
                        <span className="muted small">{tr("atracado")}</span>
                      )}
                    </div>
                  ))}
                </div>
              ));
            })()}
          </div>
        )}
        {rightTab === "viajes" && overlay === "recorrido" && (
          <>
            <span className="chip-head">
              <img className="rt-ico" src={typeIcon(439, 32)} alt="" width={16} height={16} loading="lazy" />
              {tr("Viajes")} <span className="muted small">({trips.length})</span>
            </span>
            {trips.length > 0 && (
              <span className="muted small">{tr("Pincha uno para verlo en el mapa.")}</span>
            )}
            {trips.length === 0 && (
              <span className="muted small">
                {tr("Ningún viaje en esta ventana. Un viaje son 3 saltos o más sin pararte 20 minutos.")}
              </span>
            )}
            {viajesAgrupados.map((g) => {
              const v = g.base;
              const abierto = tripOpen === v.started_ms;
              const avisos = g.events.filter((e) => e.kind === "intel").length;
              const perdidas = g.events.filter((e) => e.kind === "loss").length;
              const kills = g.events.filter((e) => e.kind === "kill").length;
              const rot = rotuloViaje(v);
              return (
                <div key={g.key} className="trip">
                  <button
                    className="trip-head"
                    onClick={() => setTripOpen(abierto ? null : v.started_ms)}
                  >
                    <span className="trip-ruta" title={rot.vuelta ? tr("Ida y vuelta: se enseña hasta dónde llegaste, no que volviste a casa.") : undefined}>
                      {rot.txt}
                    </span>
                    <span className="muted small trip-when">{fmtAgo(Date.now() - v.ended_ms)}</span>
                  </button>
                  {/* La fila de datos, en su propia línea. Antes iba pegada al nombre y con dos
                      sistemas largos se partía por donde caía: «10 saltos · 45 min» acababa encima
                      del destino. Iconografía de EVE, no emojis (regla de la casa), y los typeID
                      verificados contra `market_types.json` — no de memoria. */}
                  <div className="trip-meta">
                    <span className="tb" title={tr("Saltos")}>
                      {/* 21096 Cynosural Field Generator I: es el icono que la app ya usa para
                          «Jumps 1h» y para la capa Recorrido. Mismo concepto, mismo icono. */}
                      <img src={typeIcon(21096, 32)} alt="" width={13} height={13} loading="lazy" />
                      {v.jumps}
                    </span>
                    <span className="tb">{fmtMin((v.ended_ms - v.started_ms) / 60000)}</span>
                    {avisos > 0 && (
                      <span className="tb intel" title={tr("Avisos de intel por el camino")}>
                        {/* 3242 Warp Disruptor I: lo que te para en una puerta. Es la amenaza. */}
                        <img src={typeIcon(3242, 32)} alt="" width={13} height={13} loading="lazy" />
                        {avisos}
                      </span>
                    )}
                    {perdidas > 0 && (
                      <span className="tb loss" title={tr("Naves que perdiste en el viaje")}>
                        {/* 670 Capsule: en EVE, lo que queda de ti cuando te revientan. */}
                        <img src={typeIcon(670, 32)} alt="" width={13} height={13} loading="lazy" />
                        {perdidas}
                      </span>
                    )}
                    {kills > 0 && (
                      <span className="tb kill" title={tr("Kills durante el viaje")}>
                        <img src={typeIcon(484, 32)} alt="" width={13} height={13} loading="lazy" />
                        {kills}
                      </span>
                    )}
                    {/* La ceguera se DECLARA. Un viaje con agujeros no es un viaje limpio, y
                        callarlo sería justo la mentira que evita el resto del diseño.
                        11370 Prototype Cloaking Device I: «no te vimos» no tiene mejor icono. */}
                    {v.blind_ms > 0 && (
                      <span
                        className="tb blind"
                        title={tr("Parte del recorrido no la vimos: Koru cerrado o el piloto desconectado.")}
                      >
                        <img src={typeIcon(11370, 32)} alt="" width={13} height={13} loading="lazy" />
                        {fmtMin(v.blind_ms / 60000)}
                      </span>
                    )}
                    {/* Con varios, el número manda y los nombres van en el tooltip: «3 pilotos» se
                        lee de un vistazo y tres nombres largos rompen la fila. */}
                    <span className="muted small trip-quien" title={g.pilotos.join(" · ")}>
                      {g.pilotos.length > 1 ? `${g.pilotos.length} ${tr("pilotos")}` : g.pilotos[0]}
                    </span>
                  </div>
                  {abierto && (
                    <div className="trip-body">
                      {g.events.length === 0 && (
                        <div className="muted small">{tr("Sin incidentes: ni un aviso ni un disparo.")}</div>
                      )}
                      {g.events.map((e, i) => (
                        <div key={i} className={`trip-ev ${e.kind}`}>
                          <span className="ri-salto">{nameOf(e.system_id)}</span>
                          {e.kind === "intel" ? (
                            <span>
                              {e.during
                                ? tr("cantado MIENTRAS estabas dentro")
                                : `${tr("cantado")} ${fmtMin(e.lead_ms / 60000)} ${tr("antes de entrar")}`}
                              {e.who && <span className="muted"> · {e.who}</span>}
                            </span>
                          ) : (
                            <span>
                              {e.kind === "loss" ? tr("Perdiste una nave") : tr("Kill")}
                              {e.isk != null && e.isk > 0 && <span className="muted"> · {fmtIsk(e.isk)}</span>}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}

        {/* Tarjeta de detalle de un reporte de intel (piloto/nave/ruta/zKill) */}
        {rightTab === "aviso" && overlay === "intel" && intelDetail && (
          <>
            <div className="intel-detail-head">
              <strong>{intelDetail.sysName ?? tr("Reporte")}</strong>
              {/* zKill del sistema PEGADO AL NOMBRE y como enlace, no como botón (idea de RoGiz7).
                  Es información SOBRE ese sistema —lo natural es leerlo donde lees su nombre— y al
                  pie, con forma de botón, pesaba lo mismo que «Silenciar aquí», que sí cambia algo
                  en Koru. Un enlace dice «esto te saca fuera» sin escribirlo. */}
              {intelDetail.sysId != null && (
                <button
                  className="intel-head-link"
                  title={tr("Abrir el sistema en zKillboard")}
                  onClick={() => openExternal(`https://zkillboard.com/system/${intelDetail.sysId}/`)}
                >
                  zKill
                </button>
              )}
              <button className="sys-close" onClick={() => setIntelDetail(null)}>✕</button>
            </div>
            <div className="muted small">
              {fmtAgo(Date.now() - intelDetail.ts)} · {tr("reportó")} {intelDetail.author}
            </div>
            {intelDetailCount != null && (
              <div className={`intel-count-line ${intelDetailCount > 1 ? "fleet" : "solo"}`}>
                {intelDetailCount > 1
                  ? `▲ ${intelDetailCount} ${tr("hostiles (posible flota)")}`
                  : tr("• 1 hostil (cazador individual)")}
              </div>
            )}
            <div className="intel-detail-msg">{intelDetail.message}</div>

            <div className="intel-detail-sec">
              <span className="muted small">{tr("Pilotos")}</span>
              {intelEntLoading && <div className="muted small">{tr("Resolviendo…")}</div>}
              {!intelEntLoading && intelEntities && intelEntities.characters.length === 0 && (
                <div className="muted small">{tr("Ningún piloto reconocido en el reporte.")}</div>
              )}
              {intelEntities?.characters.map((c) => {
                const track = pilotTrack(c.name, intelReports?.feed ?? []);
                const active = intelTrackPilot === c.name;
                return (
                  <div key={c.id} className={`intel-pilot${active ? " active" : ""}`}>
                    <div className="intel-pilot-row">
                      <img
                        src={`https://images.evetech.net/characters/${c.id}/portrait?size=32`}
                        alt=""
                        width={24}
                        height={24}
                      />
                      <span className="intel-pilot-name">{c.name}</span>
                      {/* Los botones, en su PROPIA fila. Colgando detrás del nombre se partían por
                          donde cayera —«Interceptar» solo en la línea de abajo, «Ficha» en una
                          tercera— y cada piloto se rompía de una forma distinta. Ahora todos los
                          bloques se leen igual: retrato y nombre arriba, acciones debajo. */}
                      <div className="intel-pilot-btns">
                      <button title="zKillboard" onClick={() => openExternal(`https://zkillboard.com/character/${c.id}/`)}>
                        zKill
                      </button>
                      {track.length > 1 && (
                        <button
                          title={tr("Trazar ruta según reportes")}
                          onClick={() => setIntelTrackPilot(active ? null : c.name)}
                        >
                          {active ? tr("Ocultar ruta") : `${tr("Ruta")} (${track.length})`}
                        </button>
                      )}
                      <button
                        className={`intel-hab-track${huntPilots.includes(c.name) ? " active" : ""}`}
                        title={tr("Ver su rastro histórico en el mapa")}
                        onClick={() => loadHuntTrack(c.name)}
                      >
                        🎯 {huntPilots.includes(c.name) ? tr("Seguir ✓") : tr("Seguir")}
                      </button>
                      {/* Interceptar DESDE la ficha del piloto: sigue y traza en un solo clic, sin
                          tener que ir a otra tarjeta. Si ya lo estabas interceptando, lo apaga. */}
                      <button
                        className={`intel-hab-track${
                          intercepting && interceptPilot === c.name ? " active" : ""
                        }`}
                        disabled={hereSystemId == null}
                        title={
                          hereSystemId == null
                            ? tr("Selecciona el personaje cazador: su sistema es el punto de partida de la ruta.")
                            : tr("Traza y mantiene la ruta desde tu cazador hasta el último sistema donde lo vieron. Se re-traza si se mueve.")
                        }
                        onClick={() => {
                          if (intercepting && interceptPilot === c.name) {
                            setIntercepting(false);
                            setInterceptPilot(null);
                            return;
                          }
                          if (!huntPilots.includes(c.name)) loadHuntTrack(c.name);
                          setInterceptPilot(c.name);
                          setJumpActive(false);
                          setUseAnsiblex(true);
                          setRouteActive(true);
                          setIntercepting(true);
                        }}
                      >
                        🎯{" "}
                        {intercepting && interceptPilot === c.name
                          ? tr("Interceptando ✓")
                          : tr("Interceptar")}
                      </button>
                      {onOpenCazador && (
                        <button
                          className="intel-hab-track"
                          title={tr("Abrir ficha del hostil en Cazador")}
                          onClick={() => onOpenCazador(c.name)}
                        >
                          📇 {tr("Ficha")}
                        </button>
                      )}
                      </div>
                    </div>
                    {active && track.length > 0 && (
                      <ol className="intel-track">
                        {track.map((t, ti) => (
                          <li key={ti}>
                            <span className="intel-time">{fmtAgo(Date.now() - t.ts)}</span> {t.sysName}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                );
              })}
            </div>

            {intelEntities && intelEntities.ships.length > 0 && (
              <div className="intel-detail-sec">
                <span className="muted small">{tr("Naves citadas")}</span>
                <div className="intel-ships">
                  {intelEntities.ships.map((s) => (
                    <button
                      key={s.id}
                      className="intel-ship"
                      title={tr("zKillboard del tipo")}
                      onClick={() => openExternal(`https://zkillboard.com/ship/${s.id}/`)}
                    >
                      <img src={typeIcon(s.id, 32)} alt="" width={22} height={22} />
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {intelDetail.sysId != null && (
              /* ACCIONES en una FILA compacta, no tres botones a ancho completo. Ocupaban un tercio
                 de la tarjeta y gritaban más que los pilotos, que es lo que de verdad se mira. Van
                 tras un separador, igual que «Naves citadas», para que se lea como otro bloque.
                 «Mis assets» sube aquí: también es algo que HACES sobre este sistema, y así el pie
                 de la tarjeta desaparece del todo. */
              <div className="intel-detail-acts">
                {/* Rutar hasta el sistema del aviso. Sustituye al viejo «click en el punto rojo pone
                    parada»: allí el gesto cambiaba de significado según el modo; aquí es explícito. */}
                <button
                  className="ida-btn ida-primary"
                  title={tr("Poner este sistema como destino de la ruta")}
                  onClick={() => {
                    const id = intelDetail.sysId!;
                    setJumpActive(false);
                    setRouteActive(true);
                    setRouteStops((prev) => {
                      const stops = prev.filter((s) => s != null) as number[];
                      const from = hereSystemId ?? stops[0] ?? null;
                      return from != null && from !== id ? [from, id] : [null, id];
                    });
                    setRightTab("ruta");
                  }}
                >
                  <img className="rt-ico" src={typeIcon(439, 32)} alt="" width={14} height={14} loading="lazy" />{" "}
                  {tr("Destino")}
                </button>
                {/* Primera fila: las dos que MIRAN («¿por dónde voy?» y «¿tengo algo ahí?»).
                    Debajo van las dos que CONFIGURAN el intel. Orden pedido por RoGiz7. */}
                {onSystemAssets && intelDetail.sysName && (
                  <button className="ida-btn" onClick={() => onSystemAssets(intelDetail.sysName!)}>
                    📦 {tr("Mis assets")}
                  </button>
                )}
                {intel && (
                  <button
                    className="ida-btn"
                    onClick={() => {
                      const id = intelDetail.sysId!;
                      const has = intel.anchors.includes(id);
                      intel.onConfig({
                        anchors: has ? intel.anchors.filter((x) => x !== id) : [...intel.anchors, id],
                      });
                    }}
                  >
                    {intel.anchors.includes(intelDetail.sysId) ? `⚓ ${tr("Quitar ancla")}` : `⚓ ${tr("Anclar aquí")}`}
                  </button>
                )}
                {intel && (
                  <button
                    className="ida-btn"
                    title={tr("Calla la alarma de este sistema. El aviso SIGUE saliendo en el feed y en el mapa.")}
                    onClick={(e) => alternarSilencio(intelDetail.sysId!, e.altKey ? 1 : undefined)}
                  >
                    {estaSilenciado(intelDetail.sysId!) ? `🔔 ${tr("Volver a avisar")}` : `🔇 ${tr("Silenciar aquí")}`}
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {/* Tarjeta de "Hostiles habituales" (aprendidos del intel por nº de menciones) */}
        {rightTab === "habituales" && overlay === "intel" && habitualOpen && (
          <>
            <div className="intel-detail-head">
              <strong>🎯 {tr("Hostiles habituales")}</strong>
              <button className="sys-close" onClick={() => setHabitualOpen(false)}>✕</button>
            </div>
            <div className="muted small">
              {tr("Los más reportados en intel; se aprenden aunque no estén en Rivales.")}
            </div>
            {habitual == null && <div className="muted small">{tr("Cargando…")}</div>}
            {habitual != null && habitual.length === 0 && (
              <div className="muted small">{tr("Aún no hay datos. Deja correr el intel un rato.")}</div>
            )}
            <div className="intel-hab-list">
              {habitual?.map((h) => {
                const sysName = h.last_system_id != null ? geo?.idx.get(h.last_system_id)?.n : null;
                return (
                  <div key={h.name_lower} className="intel-hab-row">
                    {h.character_id != null && h.character_id > 0 ? (
                      <img
                        src={`https://images.evetech.net/characters/${h.character_id}/portrait?size=32`}
                        alt=""
                        width={26}
                        height={26}
                      />
                    ) : (
                      <span className="intel-hab-noimg">?</span>
                    )}
                    <div className="intel-hab-main">
                      <span className="intel-hab-name">{h.name}</span>
                      {sysName && (
                        <span className="muted small">
                          {tr("visto en")} {sysName}
                          {h.last_seen && ` · ${fmtAgo(Date.now() - Date.parse(h.last_seen))}`}
                        </span>
                      )}
                    </div>
                    <span className="intel-count fleet" title={tr("menciones")}>
                      ×{h.seen_count}
                    </span>
                    <button
                      className={`intel-hab-track${huntPilots.includes(h.name) ? " active" : ""}`}
                      title={tr("Ver su rastro histórico en el mapa")}
                      onClick={() => loadHuntTrack(h.name)}
                    >
                      🎯 {huntPilots.includes(h.name) ? tr("Rastro ✓") : tr("Rastro")}
                    </button>
                    {onOpenCazador && (
                      <button
                        className="intel-hab-track"
                        title={tr("Abrir ficha del hostil en Cazador")}
                        onClick={() => onOpenCazador(h.name)}
                      >
                        📇 {tr("Ficha")}
                      </button>
                    )}
                    {h.character_id != null && h.character_id > 0 && (
                      <button
                        title="zKillboard"
                        onClick={() => openExternal(`https://zkillboard.com/character/${h.character_id}/`)}
                      >
                        zKill
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

          </>)}
        </div>
        )}
        </div>


        {/* Panel de contexto de la capa activa (derecha): KPIs propios de la capa, plegable.
            Se oculta en Intel (lo sustituyen sus paneles) y cuando hay Ruta/Salto (tarjeta a la derecha). */}
        {overlay !== "intel" && !routeActive && !jumpActive && (
          <div className={`map-context ${ctxCollapsed ? "collapsed" : ""}`}>
            <div className="mc-title">
              <span className="mc-icon">
                <OverlayIcon o={activeOverlay} />
              </span>
              <span className="mc-title-tx">{tr(activeOverlay.label)}</span>
              <button
                className="mc-toggle"
                onClick={() => setCtxCollapsed((v) => !v)}
                title={ctxCollapsed ? tr("Expandir") : tr("Plegar")}
              >
                {ctxCollapsed ? "▸" : "▾"}
              </button>
            </div>
            {!ctxCollapsed && (
              <>
                <p className="mc-desc">{tr(legend)}</p>
                {ctxKpis.length > 0 && (
                  <div className="mc-kpis">
                    {ctxKpis.map((k, i) => (
                      <div className="mc-kpi" key={i}>
                        <span>{k.value}</span>
                        <label>{tr(k.label)}</label>
                      </div>
                    ))}
                  </div>
                )}
                {/* Salida de la capa hacia su sección: del mapa al sitio donde se trabaja el dato. */}
                {ctxLink && onOpenTab && (
                  <button className="mc-link" onClick={() => onOpenTab(ctxLink.tab)}>
                    {ctxLink.label} →
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* Barra inferior: sub-filtro ENCIMA de las categorías, apilados en una columna.
            Antes cada uno se posicionaba solo (`bottom: 66px` y `bottom: 12px`) y se pisaban: la
            barra de categorías mide más de 66px, así que le comía el borde al sub-filtro. Con la
            columna se apilan con hueco y aguanta aunque la barra envuelva a dos filas. */}
        <div className="map-bottombar">
        {/* Disposición: sistemas o regiones. Arriba del todo porque cambia QUÉ se está mirando,
            no cómo se filtra. Se oculta con un desplegable abierto, igual que el sub-filtro. */}
        {!openCat && (
          <div className="map-layout-sw">
            <button
              className={layout === "systems" ? "active" : ""}
              onClick={() => changeLayout("systems")}
              title={tr("Ver los sistemas de New Eden")}
            >
              {tr("Sistemas")}
            </button>
            <button
              className={layout === "regions" ? "active" : ""}
              onClick={() => changeLayout("regions")}
              title={tr("Colapsar el mapa en regiones y agregar la capa activa por región")}
            >
              {tr("Regiones")}
            </button>
          </div>
        )}
        {/* Sub-filtro de la capa activa. Se oculta mientras hay un desplegable de categoría abierto:
            el menú se abre justo encima y lo taparía, y además ahí estás eligiendo capa, no filtrando. */}
        {SUBFILTERS[overlay] && !openCat && (
          <div className="map-subfilter">
            {SUBFILTERS[overlay]!.map((o) => (
              <button
                key={o.v}
                className={`msf-btn ${subFilter === o.v ? "active" : ""}`}
                onClick={() => setSubFilter(o.v)}
              >
                {tr(o.l)}
              </button>
            ))}
          </div>
        )}

        {/* Barra de capas por categorías (abajo-centro): cada categoría es un desplegable */}
        <div className="map-filterbar">
          {OVERLAY_CATS.map((c) => {
            const layers = OVERLAYS.filter((o) => o.cat === c.key);
            const activeHere = layers.find((o) => o.key === overlay);
            return (
              <div className="mfb-cat" key={c.key}>
                <button
                  className={`mfb-btn ${activeHere ? "active" : ""} ${openCat === c.key ? "open" : ""}`}
                  onClick={() => setOpenCat(openCat === c.key ? null : c.key)}
                  title={tr(c.label)}
                >
                  <span className="mfb-icon">
                    {activeHere ? (
                      <OverlayIcon o={activeHere} />
                    ) : c.key === "tu" && hereCharId != null ? (
                      // «Tú» con TU CARA. Ningún icono de EVE dice «tú» mejor que tu propio retrato,
                      // y además cambia al cambiar de personaje, así que la barra te dice de quién
                      // estás mirando los datos sin leer una palabra. Si falla la imagen, el emoji.
                      <img
                        src={`https://images.evetech.net/characters/${hereCharId}/portrait?size=32`}
                        alt=""
                        width={16}
                        height={16}
                        loading="lazy"
                        onError={(e) => (e.currentTarget.style.display = "none")}
                      />
                    ) : c.key === "universo" ? (
                      <img
                        src="/koru-icon.svg"
                        alt=""
                        width={16}
                        height={16}
                        loading="lazy"
                        onError={(e) => (e.currentTarget.style.display = "none")}
                      />
                    ) : (
                      <OverlayIcon o={{ icon: c.icon, typeId: c.typeId }} />
                    )}
                  </span>
                  <span className="mfb-label">{activeHere ? tr(activeHere.short) : tr(c.label)}</span>
                  <span className="mfb-caret">▾</span>
                </button>
                {openCat === c.key && (
                  <div className="mfb-menu">
                    {layers.map((o) => (
                      <button
                        key={o.key}
                        className={`mfb-item ${overlay === o.key ? "active" : ""}`}
                        onClick={() => {
                          onOverlayChange(o.key);
                          setOpenCat(null);
                        }}
                      >
                        <span className="mfb-icon">
                          <OverlayIcon o={o} />
                        </span>
                        <span>{tr(o.label)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Categoría Navegación: herramientas de ruta y salto (no son capas, son modos). */}
          <div className="mfb-cat" key="navegacion">
            <button
              className={`mfb-btn ${routeActive || jumpActive ? "active" : ""} ${openCat === "navegacion" ? "open" : ""}`}
              onClick={() => setOpenCat(openCat === "navegacion" ? null : "navegacion")}
              title={tr("Navegación")}
            >
              {/* El icono SIGUE AL MODO, igual que el rótulo de al lado: con Ruta puesta enseña el
                  afterburner, con Salto el cyno, y sin nada los registros de navegación (56708).
                  Todos verificados en market_types.json. */}
              <span className="mfb-icon">
                <OverlayIcon
                  o={{ icon: "🧭", typeId: routeActive ? 439 : jumpActive ? 21096 : 56708 }}
                />
              </span>
              <span className="mfb-label">
                {routeActive ? tr("Ruta") : jumpActive ? tr("Salto") : tr("Navegación")}
              </span>
              <span className="mfb-caret">▾</span>
            </button>
            {openCat === "navegacion" && (
              <div className="mfb-menu">
                <button
                  className={`mfb-item ${routeActive ? "active" : ""}`}
                  onClick={() => {
                    setRouteActive((v) => !v);
                    setJumpActive(false);
                    setRouteStops([null]);
                    setOpenCat(null);
                  }}
                >
                  <span className="mfb-icon">
                    <OverlayIcon o={{ icon: "🗺️", typeId: 439 }} />
                  </span>
                  <span>{tr("Ruta")} {routeActive ? "(ON)" : ""}</span>
                </button>
                <button
                  className={`mfb-item ${jumpActive ? "active" : ""}`}
                  onClick={() => {
                    setJumpActive((v) => !v);
                    setRouteActive(false);
                    setJumpOrigin(null);
                    setJumpDest(null);
                    setOpenCat(null);
                  }}
                >
                  <span className="mfb-icon">
                    <OverlayIcon o={{ icon: "⚡", typeId: 21096 }} />
                  </span>
                  <span>{tr("Salto")} {jumpActive ? "(ON)" : ""}</span>
                </button>
              </div>
            )}
          </div>
        </div>
        </div>
      </div>

      {/* ================= NAVEGACIÓN (detalle) =================
          El mapa arriba se quedó con lo que se toca sobre la marcha (los dos interruptores y un
          resumen). Todo lo que necesita SITIO —paradas reordenables, sistemas a evitar, la ruta
          turn-by-turn legible y el envío a EVE— vive aquí abajo, con espacio de verdad. El mapa
          seguía creciendo en capas y el planificador competía con ellas por la misma esquina. */}
      {routeActive && (
        <div className="nav-section" ref={navRef}>
          <h3 className="nav-title">
            <img className="rt-ico" src={typeIcon(439, 32)} alt="" width={18} height={18} loading="lazy" />{" "}
            {tr("Navegación")}
            {routePath && (
              <span className="muted small">
                {" · "}
                {routePath.length - 1} {tr("saltos")}
                {ansiLegs.size > 0 && ` · ${ansiLegs.size} Ansiblex`}
                {whLegs.size > 0 && ` · ${whLegs.size} WH`}
              </span>
            )}
          </h3>

          <div className="nav-grid">
            {/* ---- Columna 1: paradas + opciones ---- */}
            <div className="nav-col">
              <div className="nav-head">{tr("Paradas")}</div>
              {routeStops.map((stop, i) => (
                <div className="route-stop" key={i}>
                  <span className="route-stop-label">
                    {i === 0 ? tr("Origen") : `${tr("Destino")} ${i}`}
                  </span>
                  <SystemSearch
                    systems={ne.systems}
                    value={stop}
                    placeholder={tr("Escribe un sistema…")}
                    onPick={(id) => {
                      setRouteStops((prev) => {
                        const copy = [...prev];
                        copy[i] = id;
                        return copy;
                      });
                      focusSystem(id); // buscar un sistema ES querer verlo
                    }}
                  />
                  {/* Reordenar con flechas en vez de arrastrar: es fiable, accesible y no depende
                      de una librería de drag&drop para mover 3 paradas. */}
                  {i > 0 && (
                    <>
                      <button
                        className="route-stop-del"
                        title={tr("Subir")}
                        disabled={i <= 1}
                        onClick={() =>
                          setRouteStops((prev) => {
                            const c = [...prev];
                            [c[i - 1], c[i]] = [c[i], c[i - 1]];
                            return c;
                          })
                        }
                      >
                        ↑
                      </button>
                      <button
                        className="route-stop-del"
                        title={tr("Bajar")}
                        disabled={i >= routeStops.length - 1}
                        onClick={() =>
                          setRouteStops((prev) => {
                            const c = [...prev];
                            [c[i], c[i + 1]] = [c[i + 1], c[i]];
                            return c;
                          })
                        }
                      >
                        ↓
                      </button>
                      <button
                        className="route-stop-del"
                        title={tr("Quitar")}
                        onClick={() => setRouteStops((prev) => prev.filter((_, j) => j !== i))}
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>
              ))}
              <button
                className="route-add"
                onClick={() => setRouteStops((prev) => [...prev, null])}
              >
                + {tr("Añadir destino")}
              </button>
              <button className="route-add" onClick={() => setRouteStops([null])}>
                {tr("Limpiar")}
              </button>

              <div className="nav-head">{tr("Cómo rutar")}</div>
              <select
                value={routeMode}
                onChange={(e) => setRouteMode(e.target.value as RouteMode)}
              >
                <option value="shortest">{tr("Más corta")}</option>
                <option value="safer">{tr("Más segura")}</option>
                <option value="insecure">{tr("Menos segura")}</option>
              </select>
              {ansi && (
                <button
                  className={`intel-hab-track${useAnsiblex ? " active" : ""}`}
                  title={tr("Usar los Ansiblex de tu alianza al calcular la ruta")}
                  onClick={() => setUseAnsiblex(!useAnsiblex)}
                >
                  <AnsiBadge /> {tr("Ansiblex")} <span className="muted">({ansi.drawn})</span>
                </button>
              )}
              <button
                className={`intel-hab-track${useWormholes ? " active" : ""}`}
                title={tr("Usar los wormholes de Thera/Turnur (eve-scout) al calcular la ruta")}
                onClick={() => setUseWormholes(!useWormholes)}
              >
                ◆ {tr("Wormholes")}{" "}
                <span className="muted">
                  {wh ? `(${wh.drawn})` : useWormholes ? tr("cargando…") : ""}
                </span>
              </button>
              {sigWh && sigWh.edges.length > 0 && (
                <button
                  className={`intel-hab-track${useSigWormholes ? " active" : ""}`}
                  title={tr("Usar TUS wormholes escaneados con destino anotado al calcular la ruta")}
                  onClick={() => setUseSigWormholes(!useSigWormholes)}
                  style={{ color: useSigWormholes ? "#b06bff" : undefined }}
                >
                  📡 {tr("Mis WH")} <span className="muted">({sigWh.edges.length})</span>
                </button>
              )}
              {useWormholes && (
                <button
                  className="route-evescout"
                  title={tr("Abrir eve-scout (mapa de conexiones Thera/Turnur en vivo)")}
                  onClick={() => openExternal("https://www.eve-scout.com/")}
                >
                  eve-scout ↗
                </button>
              )}
            </div>

            {/* ---- Columna 2: evitar ---- */}
            <div className="nav-col">
              <div className="nav-head">
                🚫 {tr("Evitar")}{" "}
                <span className="muted small">({avoid.size})</span>
              </div>
              <p className="muted small">
                {tr("Los sistemas vetados se saltan al calcular. Se recuerdan entre sesiones. Un destino nunca se evita a sí mismo.")}
              </p>
              <SystemSearch
                systems={ne.systems}
                value={null}
                placeholder={tr("Añadir sistema a evitar…")}
                onPick={(id) => toggleAvoid(id)}
              />
              {avoid.size > 0 && (
                <>
                  <ul className="nav-avoid-list">
                    {[...avoid].map((sid) => (
                      <li key={sid}>
                        <span
                          className="route-sec"
                          style={{ color: secColor(geo.idx.get(sid)?.s ?? 0) }}
                        >
                          {(geo.idx.get(sid)?.s ?? 0).toFixed(1)}
                        </span>
                        <span className="route-sysname">{nameOf(sid)}</span>
                        <button
                          className="route-stop-del"
                          title={tr("Quitar")}
                          onClick={() => toggleAvoid(sid)}
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button className="route-add" onClick={clearAvoid}>
                    {tr("Vaciar lista")}
                  </button>
                </>
              )}
              {routeStops.filter((s) => s != null).length >= 2 && !routePath && (
                <div className="fits-err small">
                  {tr("No hay ruta posible con los filtros actuales (¿demasiados sistemas evitados?).")}
                </div>
              )}
            </div>

            {/* ---- Columna 3: la ruta + enviar a EVE ---- */}
            <div className="nav-col nav-col-wide">
              <div className="nav-head">{tr("La ruta")}</div>
              {routeWaypoints.length > 0 && hereCharId != null && (
                <button
                  className="route-send-eve"
                  disabled={!canWaypoint || sendingEve}
                  title={
                    canWaypoint
                      ? tr("Pone la ruta en el piloto automático de EVE (el juego la calcula con tus preferencias, Ansiblex incluidos si los tienes activados).")
                      : tr("Falta el permiso: vuelve a iniciar sesión con «Ubicación» para conceder «poner destino en EVE».")
                  }
                  onClick={() => sendToEve(routeWaypoints)}
                >
                  {sendingEve ? "⏳" : "🚀"}{" "}
                  {routeWaypoints.length > 1 ? tr("Enviar ruta a EVE") : tr("Enviar destino a EVE")}
                </button>
              )}
              {/* El botón deshabilitado ya llevaba el motivo en su `title`, pero un control DESHABILITADO
                no recibe eventos de ratón en WebView2 → ese tooltip NO se llega a ver nunca. Quedaba
                un botón gris sin explicación, y justo tras esta actualización lo van a ver TODOS: el
                scope `write_waypoint` es nuevo y los tokens ya emitidos no lo traen. Así que el
                motivo va visible, no escondido. */}
            {routeWaypoints.length > 0 && hereCharId != null && !canWaypoint && (
              <div className="small route-scope-warn">
                ⚠ {tr("Falta el permiso: vuelve a iniciar sesión con «Ubicación» para conceder «poner destino en EVE».")}
              </div>
            )}
            {eveMsg && <div className="small muted">{eveMsg}</div>}
              {whLegs.size > 0 && (
                <div className="small" style={{ color: "#3ad6e0" }}>
                  ◆ {tr("La ruta usa wormholes: EVE no los rutea, «Enviar a EVE» pondrá solo el destino final.")}
                </div>
              )}
              {sigWhLegs.size > 0 && (
                <div className="small" style={{ color: "#b06bff" }}>
                  📡 {tr("La ruta usa wormholes tuyos: EVE tampoco los rutea, tendrás que dar el salto a mano.")}
                </div>
              )}
              {routePath && routePath.length > 1 ? (
                <ol className="nav-route-list">
                  {/* Sin el origen: ya lo tienes en su casilla, y repetirlo aquí confunde — así cada
                      fila ES un salto y la lista cuadra con el contador de saltos de la cabecera.
                      `i` se recalcula al índice real de routePath: los marcadores de tramo
                      (ansiLegs/whLegs) van indexados por el salto i-1 → i y se desalinearían. */}
                  {routePath.slice(1).map((sid, k) => {
                    const i = k + 1;
                    const s = geo.idx.get(sid);
                    const isHub = !s && wh?.hubName.has(sid);
                    const kills = liveKills?.get(sid) ?? 0;
                    return (
                      <li key={i} className={isHub ? "route-hub" : undefined}>
                        <span
                          className="route-sec"
                          style={{ color: isHub ? "#3ad6e0" : secColor(s?.s ?? 0) }}
                        >
                          {isHub ? "◆" : (s?.s ?? 0).toFixed(1)}
                        </span>
                        <span className="route-sysname">
                          {ansiLegs.has(i) && (
                            <span className="route-ansi-leg" title={tr("Se llega por Ansiblex")}>
                              <AnsiBadge />{" "}
                            </span>
                          )}
                          {whLegs.has(i) && (
                            <span className="route-wh-leg" title={tr("Se llega por wormhole")}>
                              ◆{" "}
                            </span>
                          )}
                          {nameOf(sid)}
                        </span>
                        {!isHub && (
                          <>
                            <span
                              className={`route-kills ${kills > 0 ? "hot" : ""}`}
                              title={tr("Kills última hora")}
                            >
                              {kills} ⚔
                            </span>
                            <button
                              className="route-stop-del"
                              title={tr("Evitar este sistema y recalcular")}
                              onClick={() => toggleAvoid(sid)}
                            >
                              🚫
                            </button>
                            <button
                              className="route-dotlan"
                              title={tr("Abrir en Dotlan")}
                              onClick={() =>
                                openExternal(
                                  `https://evemaps.dotlan.net/system/${(s?.n ?? "").replace(/ /g, "_")}`
                                )
                              }
                            >
                              Dotlan
                            </button>
                            {/* zKill del SISTEMA: las muertes registradas ahí. En una ruta es el
                                dato que dice si un salto es una ratonera. */}
                            <button
                              className="route-dotlan"
                              title={tr("Ver muertes registradas en zKillboard")}
                              onClick={() => openExternal(`https://zkillboard.com/system/${sid}/`)}
                            >
                              zKill
                            </button>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="muted small">{tr("Elige origen y destino")}</p>
              )}
            </div>
          </div>
        </div>
      )}

    </>
  );
}
