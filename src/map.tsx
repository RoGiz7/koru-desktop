import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { tr } from "./i18n";
import { fmtAgo, fmtIsk, fmtSp, fmtMin, secColor, ownerColor, heatColor, typeIcon } from "./format";
import { OverlayIcon, maxOf } from "./charts";
import { findRoute, proximityBFS, type RouteMode } from "./mapRoute";
import { renderBackdrop, renderSov, renderFw, renderStandings, renderAgents, renderCorps, renderIncursions, renderThera } from "./mapOverlays";
import { computeJumpFuel, computeJumpFatEst, computeJumpReach } from "./jumpCalc";
import { useJumpPlanner } from "./useJumpPlanner";
import { useRoutePlanner } from "./useRoutePlanner";
import { useHuntTrack } from "./useHuntTrack";
import { useIntel } from "./useIntel";
import { ALERT_SOUNDS, playAlertChoice, beep } from "./sound";
import { buildIntelReports, pilotTrack } from "./intel";
import { loadNewEden } from "./neweden";
import { edgeKey, ANSIBLEX_TYPE_ID, type AnsiblexRow } from "./ansiblex";
import { OVERLAYS, OVERLAY_CATS, SUBFILTERS, FW_FACTIONS, POIS } from "./constants";
import type { MapOverlay } from "./constants";
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
  openTrack?: { name: string; nonce: number } | null;
}) {
  const {
    data,
    overlay,
    onOverlayChange,
    intel,
    onSystemAssets,
    onOpenCazador,
    onOpenMisiones,
    onOpenPi,
    openTrack,
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
  const [subFilter, setSubFilter] = useState<string>("all"); // sub-filtro de la capa activa
  useEffect(() => setSubFilter("all"), [overlay]); // reset al cambiar de capa
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
    avoid,
    toggleAvoid,
    clearAvoid,
  } = useRoutePlanner();
  // Ancla para el botón «Detalle de navegación» de la tarjeta de ruta: baja a la sección de abajo.
  const navRef = useRef<HTMLDivElement | null>(null);
  // La columna derecha es UNA tarjeta con pestañas (antes eran cuatro apiladas y tapaban el mapa).
  // `cardOpen` pliega la tarjeta entera dejando solo la barra de pestañas.
  type RightTab = "ruta" | "rastro" | "aviso" | "habituales";
  const [rightTab, setRightTab] = useState<RightTab>("ruta");
  const [cardOpen, setCardOpen] = useState(true);
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
        name: names.get(id) ?? "",
        px: a.sx / a.n,
        py: a.sy / a.n,
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
    return { proj, idx, nameIdx, adj, jumpsPath, regionLabels, constLabels };
  }, [ne]);

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
  const backdropCircles = useMemo(
    () => renderBackdrop(geo, ne, overlay, bgStride),
    [geo, ne, overlay, bgStride],
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

  // Orígenes de proximidad: sistema del pj + puntos de ancla elegidos (sin duplicados).
  const intelOrigins = useMemo(() => {
    const set = new Set<number>();
    if (hereSystemId != null) set.add(hereSystemId);
    for (const a of intel?.anchors ?? []) set.add(a);
    return [...set];
  }, [hereSystemId, intel?.anchors]);

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
                r={1.4}
                fill="none"
                stroke={col}
                strokeWidth={0.7}
                style={{ ["--intel-op"]: op * 0.85 } as React.CSSProperties}
              />
            </g>
          ) : (
            <circle cx={p.px} cy={p.py} r={2.1} fill="none" stroke={col} strokeOpacity={op * 0.3} strokeWidth={0.4} pointerEvents="none" />
          )}
          {/* Halo extra para los seguidos: destaca aunque el punto quede lejos y pequeño. */}
          {tracked && (
            <circle
              cx={p.px}
              cy={p.py}
              r={3.2}
              fill="none"
              stroke={col}
              strokeOpacity={op * 0.5}
              strokeWidth={0.5}
              pointerEvents="none"
            />
          )}
          {/* zona de click ampliada (invisible) para acertar fácil el punto + tooltip */}
          <circle cx={p.px} cy={p.py} r={2.6} fill="transparent">
            {/* Dos cifras y bien separadas: los saltos por PUERTA (lo que mide la amenaza) y, si
                hay red importada y acorta, en cuánto llegas TÚ usando además tus Ansiblex. */}
            <title>{`${s.n}${j != null ? ` · ${j} ${tr("saltos")}` : ""}${
              h != null && j != null && h < j ? ` · ${tr("llegas en")} ${h} (Ansiblex)` : ""
            }\n${r.author}: ${r.message}\n${tr("(clic para ver detalle)")}`}</title>
          </circle>
          <circle cx={p.px} cy={p.py} r={tracked ? 1.6 : 1.3} fill={col} fillOpacity={op} stroke="#0a0d12" strokeWidth={0.3} pointerEvents="none" />
        </g>
      );
    });
  }, [geo, overlay, intelReports, jumpsFrom, huntFrom, intel?.recency, intel?.alertJumps, intel?.onlyRange, huntSet]);

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
    chanOpen,
    setChanOpen,
    cfgOpen,
    setCfgOpen,
    anchorInput,
    setAnchorInput,
    intelDetailCount,
    intelAlert,
    setIntelAlert,
  } = useIntel({ geo, ne, intel, overlay, intelDetail, shipNames, intelReports, intelOrigins });
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

  // Genera candidatos (1-3 palabras) de un mensaje, quitando sistemas y palabras de jerga.
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
  }



  // Polilínea de la ruta del piloto seleccionado (sobre el grafo del mapa).
  const intelTrackLine = useMemo(() => {
    if (!geo || overlay !== "intel" || !intelTrackPilot) return null;
    const track = pilotTrack(intelTrackPilot, intelReports?.feed ?? []);
    const pts = track
      .map((t) => geo.idx.get(t.sysId))
      .filter((s): s is NeSystem => !!s)
      .map((s) => geo.proj(s));
    if (pts.length < 1) return null;
    const poly = pts.map((p) => `${p.px},${p.py}`).join(" ");
    const first = pts[0];
    const last = pts[pts.length - 1];
    return (
      <g>
        {pts.length >= 2 && (
          <>
            <defs>
              <marker
                id="intel-arrow"
                markerWidth="4"
                markerHeight="4"
                refX="2.4"
                refY="2"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M0,0 L4,2 L0,4 Z" fill="#ffd98a" />
              </marker>
            </defs>
            {/* trazo base tenue (toda la ruta) */}
            <polyline points={poly} fill="none" stroke="#ffb24a" strokeOpacity={0.25} strokeWidth={0.6} />
            {/* flujo direccional: las rayas viajan del origen al destino + flecha al final */}
            <polyline
              points={poly}
              fill="none"
              stroke="#ffd98a"
              strokeWidth={0.7}
              strokeLinecap="round"
              strokeDasharray="2 2.5"
              markerEnd="url(#intel-arrow)"
            >
              <animate attributeName="stroke-dashoffset" from="0" to="-4.5" dur="0.7s" repeatCount="indefinite" />
            </polyline>
          </>
        )}
        {/* sistemas intermedios */}
        {pts.slice(1, -1).map((p, i) => (
          <circle key={`tk-${i}`} cx={p.px} cy={p.py} r={0.9} fill="#ffb24a" />
        ))}
        {/* origen (hueco) */}
        <circle cx={first.px} cy={first.py} r={1.1} fill="#0a0d12" stroke="#ffb24a" strokeWidth={0.5}>
          <title>{tr("Origen")}</title>
        </circle>
        {/* destino / posición más reciente */}
        {pts.length >= 2 && (
          <circle cx={last.px} cy={last.py} r={1.5} fill="#ffd98a" stroke="#0a0d12" strokeWidth={0.3}>
            <title>{tr("Último reporte")}</title>
          </circle>
        )}
      </g>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, overlay, intelTrackPilot, intelReports]);

  // Modo cazador: polilínea del rastro HISTÓRICO del objetivo (de la tabla intel_sightings, persiste
  // entre sesiones). Color magenta para distinguirlo del rastro de sesión (naranja). Colapsa sistemas
  // consecutivos repetidos y dibuja flujo direccional + flecha al último avistamiento.
  const huntTrackLine = useMemo(() => {
    if (!geo || overlay !== "intel" || huntTracks.size === 0) return null;
    // Un rastro por piloto seguido. El que estás interceptando va más marcado; los demás, atenuados,
    // para que se vea a quién persigues sin perder de vista dónde andan los otros.
    const lines = [...huntTracks.entries()].map(([name, track]) => {
      if (!track || track.length === 0) return null;
      const seq: number[] = [];
      for (const p of track) {
        if (seq.length === 0 || seq[seq.length - 1] !== p.system_id) seq.push(p.system_id);
      }
      const pts = seq
        .map((sid) => geo.idx.get(sid))
        .filter((s): s is NeSystem => !!s)
        .map((s) => geo.proj(s));
      if (pts.length < 1) return null;
      const poly = pts.map((p) => `${p.px},${p.py}`).join(" ");
      const first = pts[0];
      const last = pts[pts.length - 1];
      const main = interceptPilot === name;
      const op = main ? 1 : 0.45;
      return (
        <g key={`hunt-${name}`} opacity={op}>
          {pts.length >= 2 && (
            <>
              <polyline points={poly} fill="none" stroke="#ff6ad5" strokeOpacity={0.25} strokeWidth={0.6} />
              <polyline
                points={poly}
                fill="none"
                stroke="#ff6ad5"
                strokeWidth={main ? 0.7 : 0.5}
                strokeLinecap="round"
                strokeDasharray="2 2.5"
                markerEnd="url(#hunt-arrow)"
              >
                <animate attributeName="stroke-dashoffset" from="0" to="-4.5" dur="0.7s" repeatCount="indefinite" />
              </polyline>
            </>
          )}
          {pts.slice(1, -1).map((p, i) => (
            <circle key={`h-${i}`} cx={p.px} cy={p.py} r={0.9} fill="#ff6ad5" />
          ))}
          <circle cx={first.px} cy={first.py} r={1.1} fill="#0a0d12" stroke="#ff6ad5" strokeWidth={0.5}>
            <title>{`${name} — ${tr("Primer avistamiento")}`}</title>
          </circle>
          {pts.length >= 2 && (
            <circle cx={last.px} cy={last.py} r={1.6} fill="#ff6ad5" stroke="#0a0d12" strokeWidth={0.3}>
              <title>{`${name} — ${tr("Último avistamiento")}`}</title>
            </circle>
          )}
        </g>
      );
    });
    if (lines.every((l) => l === null)) return null;
    return (
      <g>
        {/* La flecha se define UNA vez para todos los rastros (antes iba dentro de cada uno). */}
        <defs>
          <marker id="hunt-arrow" markerWidth="4" markerHeight="4" refX="2.4" refY="2" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L4,2 L0,4 Z" fill="#ff6ad5" />
          </marker>
        </defs>
        {lines}
      </g>
    );
  }, [geo, overlay, huntTracks, interceptPilot]);

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
    if (!addAnsi && !addWh) return geo.adj;
    const merged = new Map(geo.adj);
    const extra = (src: Map<number, number[]>) => {
      for (const [from, tos] of src) {
        merged.set(from, [...(merged.get(from) ?? []), ...tos]);
      }
    };
    if (addAnsi) extra(ansi!.adj);
    if (addWh) extra(wh!.adj);
    return merged;
  }, [geo, ansi, useAnsiblex, wh, useWormholes]);

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

  // Pestañas disponibles de la tarjeta derecha: solo las que tienen algo que enseñar. Una pestaña
  // vacía es ruido, y si no hay ninguna la tarjeta entera desaparece y el mapa queda limpio.
  const rightTabs = useMemo(() => {
    // Orden de lectura del cazador: primero lo que acaba de pasar (el aviso), luego a quién sigues,
    // y la ruta al final — que es la consecuencia, no el punto de partida.
    const t: { id: RightTab; label: string }[] = [];
    if (overlay === "intel" && intelDetail) t.push({ id: "aviso", label: `📡 ${tr("Aviso")}` });
    if (overlay === "intel" && huntPilots.length > 0)
      t.push({ id: "rastro", label: `🎯 ${tr("Rastro")}` });
    if (overlay === "intel" && habitualOpen)
      t.push({ id: "habituales", label: `👥 ${tr("Habituales")}` });
    if (routeActive) t.push({ id: "ruta", label: `🧭 ${tr("Ruta")}` });
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeActive, overlay, huntPilots, intelDetail, habitualOpen]);
  // Si la pestaña activa deja de existir (cerraste el aviso, soltaste el rastro…), cae a la primera
  // disponible en vez de dejar la tarjeta en blanco.
  useEffect(() => {
    if (rightTabs.length > 0 && !rightTabs.some((t) => t.id === rightTab)) {
      setRightTab(rightTabs[0].id);
    }
  }, [rightTabs, rightTab]);

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
              onPick={(id) => setJumpOrigin(id)}
            />
          </div>
          <div className="route-stop">
            <span className="route-stop-label">{tr("Destino")}</span>
            <SystemSearch
              systems={ne.systems}
              value={jumpDest}
              placeholder={tr("Destino (para el fuel)…")}
              onPick={(id) => setJumpDest(id)}
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
            {/* etiquetas con nivel de detalle (LOD) según el zoom */}
            {view.z < 2.5 &&
              geo.regionLabels.map((r, i) => (
                <text
                  key={`r-${i}`}
                  x={r.px}
                  y={r.py}
                  className="region-label"
                  textAnchor="middle"
                  style={{ fontSize: `${14 / view.z}px` }}
                >
                  {r.name}
                </text>
              ))}
            {view.z >= 2.5 && view.z < 6 &&
              geo.constLabels.map((c, i) => (
                <text
                  key={`c-${i}`}
                  x={c.px}
                  y={c.py}
                  className="region-label"
                  textAnchor="middle"
                  style={{ fontSize: `${11 / view.z}px` }}
                >
                  {c.name}
                </text>
              ))}
            {view.z >= 6 &&
              ne.systems.map((s) => {
                const p = geo.proj(s);
                const sx = view.x + p.px * view.z;
                const sy = view.y + p.py * view.z;
                if (sx < 0 || sx > MAP_W || sy < 0 || sy > MAP_H) return null;
                return (
                  <text
                    key={`sl-${s.id}`}
                    x={p.px + 1.5}
                    y={p.py + 1}
                    className="map-label"
                    style={{ fontSize: `${10 / view.z}px` }}
                  >
                    {s.n}
                  </text>
                );
              })}
            {/* LOD: en la vista galaxia (muy alejado) la maraña de saltos es ilegible y cara de
                pintar → se oculta; reaparece al acercar el zoom. */}
            {view.z >= 1.8 && (
              <path d={geo.jumpsPath} stroke="#243040" strokeWidth={0.5} fill="none" opacity={0.6} />
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
                <g className="map-ansi" fill="none" strokeLinecap="round">
                  <path d={d} stroke="#3fb950" strokeWidth={view.z >= 1.8 ? 1.1 : 1.8} opacity={0.14} />
                  <path d={d} stroke="#56d364" strokeWidth={view.z >= 1.8 ? 0.35 : 0.6} opacity={0.9} />
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
                <path d={wh.path} stroke="#3ad6e0" strokeWidth={view.z >= 1.8 ? 0.9 : 1.5} opacity={0.12} />
                <path d={wh.path} stroke="#3ad6e0" strokeWidth={view.z >= 1.8 ? 0.3 : 0.5} opacity={0.7} />
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
            {/* overlay Intel en vivo (memorizado) */}
            {intelAnchorMarkers}
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
                return (
                  <circle
                    key={`live-${sid}`}
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
                );
              })}
            {/* ruta planificada */}
            {routePath && routePath.length > 1 && (() => {
              // La línea AMARILLA solo cubre puertas y Ansiblex. Los saltos por wormhole se pintan
              // aparte, en CIAN DISCONTINUO, directos entre los dos sistemas reales que unen — así la
              // línea NO se desvía al centroide de Thera (el pico feo) y un WH se lee como lo que es:
              // «entras aquí, sales allá», sin recorrido intermedio.
              const isSynthHub = (sid: number) => !geo.idx.get(sid) && !!wh?.hubName.has(sid);
              let yellow = "";
              let pen = false; // ¿venimos dibujando una sub-línea?
              for (let i = 0; i < routePath.length; i++) {
                if (i > 0 && whLegs.has(i)) pen = false; // no unir por encima de un salto WH
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
              return (
                <>
                  {yellow && (
                    <path
                      d={yellow}
                      fill="none"
                      stroke="#ffd54a"
                      strokeWidth={1.6 / view.z}
                      strokeLinejoin="round"
                      opacity={0.95}
                    />
                  )}
                  {whD.length > 0 && (
                    <path
                      d={whD.join("")}
                      fill="none"
                      stroke="#3ad6e0"
                      strokeWidth={1.4 / view.z}
                      strokeDasharray={`${2 / view.z} ${1.5 / view.z}`}
                      strokeLinecap="round"
                      opacity={0.9}
                    />
                  )}
                </>
              );
            })()}
            {routeStops.map((sid, i) =>
              sid != null && geo.idx.get(sid) ? (
                <circle
                  key={`rep-${i}`}
                  cx={geo.proj(geo.idx.get(sid)!).px}
                  cy={geo.proj(geo.idx.get(sid)!).py}
                  r={4 / view.z}
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
                  <circle key={`jr-${sid}`} cx={p.px} cy={p.py} r={2.6 / view.z} fill="#b07cff" fillOpacity={0.6}>
                    <title>{`${s.n} (sec ${s.s.toFixed(1)})\n${jumpReach.get(sid)!.toFixed(2)} LY`}</title>
                  </circle>
                );
              })}
            {jumpActive &&
              jumpOrigin != null &&
              geo.idx.get(jumpOrigin) &&
              (() => {
                const p = geo.proj(geo.idx.get(jumpOrigin)!);
                return <circle cx={p.px} cy={p.py} r={5 / view.z} fill="#7fd8ff" stroke="#0a0d12" strokeWidth={0.8 / view.z} />;
              })()}
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
                  const r = 3.5 / view.z;
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
                const r = 3 / view.z;
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
                const r = 4 / view.z;
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

        <div className="map-zoom">
          <button onClick={() => zoomBy(1.3)}>+</button>
          <button onClick={() => zoomBy(1 / 1.3)}>−</button>
          <button onClick={() => setView({ z: 1, x: 0, y: 0 })} title="Reset">⟲</button>
        </div>

        {selected != null &&
          geo.idx.get(selected) &&
          (() => {
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
                  <button className="sys-close" onClick={() => setSelected(null)}>
                    ✕
                  </button>
                </div>
                <div className="muted small">
                  {tr("Seguridad")} <span style={{ color: secColor(s.s) }}>{s.s.toFixed(1)}</span> · {region}
                </div>
                {overlay !== "pi" && (
                  <div className="sys-stats">
                    <div>{tr("Tus kills")}: <strong>{act?.kills ?? 0}</strong></div>
                    <div>{tr("Tus losses")}: <strong>{act?.losses ?? 0}</strong></div>
                    <div>{tr("Tu ISK")}: <strong>{act ? fmtIsk(act.isk) : "0"}</strong></div>
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
                <div className="sys-links">
                  <button
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
                </div>
                <div className="sys-links">
                  <button onClick={() => openUrl(`https://zkillboard.com/system/${selected}/`)}>
                    zKillboard
                  </button>
                  <button
                    onClick={() =>
                      openUrl(`https://evemaps.dotlan.net/system/${s.n.replace(/ /g, "_")}`)
                    }
                  >
                    Dotlan
                  </button>
                </div>
                {onSystemAssets && (
                  <button
                    className="sys-assets-btn"
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
                    className="sys-assets-btn"
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
              </div>
            );
          })()}

        {/* Panel de Intel: configuración + feed en vivo (izquierda) */}
        {overlay === "intel" && intel && (
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
                <label className="intel-folder" title={intel.folder}>
                  <span className="muted small">{tr("Carpeta de logs")}</span>
                  <div className="intel-folder-row">
                    <span className="intel-folder-path">{intel.folder || tr("(sin definir)")}</span>
                    <button onClick={intel.onPickFolder}>📁</button>
                  </div>
                </label>
                <div className="intel-channels">
                  <span className="muted small">{tr("Canales")}</span>
                  <button
                    type="button"
                    className="intel-chan-btn"
                    onClick={() => setChanOpen((v) => !v)}
                  >
                    <span>
                      {intel.channels.length === 0
                        ? tr("Seleccionar canales…")
                        : `${intel.channels.length} ${tr("canal(es)")}`}
                    </span>
                    <span>{chanOpen ? "▴" : "▾"}</span>
                  </button>
                  {chanOpen && (
                    <div className="intel-chan-menu">
                      {intel.availChannels.length === 0 && (
                        <div className="muted small">{tr("No se encontraron canales en la carpeta.")}</div>
                      )}
                      {intel.availChannels.map((c) => (
                        <label key={c} className="intel-chk">
                          <input
                            type="checkbox"
                            checked={intel.channels.includes(c)}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...intel.channels, c]
                                : intel.channels.filter((x) => x !== c);
                              intel.onConfig({ channels: next });
                            }}
                          />
                          {c}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <div className="intel-nums">
                  <label>
                    <span className="muted small">{tr("Recencia (min)")}</span>
                    <input
                      type="number"
                      min={1}
                      max={180}
                      value={intel.recency}
                      onChange={(e) => intel.onConfig({ recency: Math.max(1, Number(e.target.value)) })}
                    />
                  </label>
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
                <div className="intel-sound-row">
                  <label className="intel-chk">
                    <input
                      type="checkbox"
                      checked={intel.sound}
                      onChange={(e) => {
                        if (e.target.checked) beep(); // gesto del usuario → desbloquea el audio
                        intel.onConfig({ sound: e.target.checked });
                      }}
                    />
                    🔊 {tr("Sonido")}
                  </label>
                  <select
                    className="intel-sound-sel"
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
                  <button
                    className="intel-test-snd"
                    disabled={!intel.sound}
                    onClick={() => playAlertChoice(intel.soundChoice)}
                  >
                    {tr("Probar")}
                  </button>
                </div>
                {intel.soundChoice === "custom" && (
                  <div className="intel-sound-custom">
                    <span className="intel-sound-file" title={intel.soundFile}>
                      {intel.soundFile ? intel.soundFile.split(/[\\/]/).pop() : tr("(ningún archivo)")}
                    </span>
                    <button onClick={intel.onPickSound}>{tr("Elegir…")}</button>
                  </div>
                )}
                <label className="intel-chk">
                  <input
                    type="checkbox"
                    checked={intel.onlyRange}
                    onChange={(e) => intel.onConfig({ onlyRange: e.target.checked })}
                  />
                  {tr("Mostrar solo intel en rango")} (≤ {intel.alertJumps} {tr("saltos")})
                </label>
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
              </div>
            )}
            <div className="intel-feed">
              {intel.channels.length === 0 && (
                <div className="muted small">{tr("Abre la ⚙ y elige carpeta y al menos un canal para empezar.")}</div>
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
              🧭 {tr("Ruta")}
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

        {/* Tarjeta de detalle de un reporte de intel (piloto/nave/ruta/zKill) */}
        {rightTab === "aviso" && overlay === "intel" && intelDetail && (
          <>
            <div className="intel-detail-head">
              <strong>{intelDetail.sysName ?? tr("Reporte")}</strong>
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
                      <button title="zKillboard" onClick={() => openUrl(`https://zkillboard.com/character/${c.id}/`)}>
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
                      onClick={() => openUrl(`https://zkillboard.com/ship/${s.id}/`)}
                    >
                      <img src={typeIcon(s.id, 32)} alt="" width={22} height={22} />
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {intelDetail.sysId != null && (
              <>
                {/* Rutar hasta el sistema del aviso. Sustituye al viejo «click en el punto rojo pone
                    parada»: allí el gesto cambiaba de significado según el modo; aquí es explícito. */}
                <button
                  className="sys-assets-btn"
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
                  🧭 {tr("Destino")}
                </button>
                {intel && (
                  <button
                    className="sys-assets-btn"
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
                <div className="sys-links">
                  <button onClick={() => openUrl(`https://zkillboard.com/system/${intelDetail.sysId}/`)}>
                    {tr("zKill sistema")}
                  </button>
                  {onSystemAssets && intelDetail.sysName && (
                    <button onClick={() => onSystemAssets(intelDetail.sysName!)}>📦 {tr("Mis assets")}</button>
                  )}
                </div>
              </>
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
                        onClick={() => openUrl(`https://zkillboard.com/character/${h.character_id}/`)}
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
              </>
            )}
          </div>
        )}

        {/* Sub-filtro de la capa activa (desplegable, estilo mapa oficial) */}
        {SUBFILTERS[overlay] && (
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
                    {activeHere ? <OverlayIcon o={activeHere} /> : c.icon}
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
              <span className="mfb-icon">🧭</span>
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
                  <span className="mfb-icon">🗺️</span>
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
                  <span className="mfb-icon">⚡</span>
                  <span>{tr("Salto")} {jumpActive ? "(ON)" : ""}</span>
                </button>
              </div>
            )}
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
            🧭 {tr("Navegación")}
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
                    onPick={(id) =>
                      setRouteStops((prev) => {
                        const copy = [...prev];
                        copy[i] = id;
                        return copy;
                      })
                    }
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
              {useWormholes && (
                <button
                  className="route-evescout"
                  title={tr("Abrir eve-scout (mapa de conexiones Thera/Turnur en vivo)")}
                  onClick={() => openUrl("https://www.eve-scout.com/")}
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
              {eveMsg && <div className="small muted">{eveMsg}</div>}
              {whLegs.size > 0 && (
                <div className="small" style={{ color: "#3ad6e0" }}>
                  ◆ {tr("La ruta usa wormholes: EVE no los rutea, «Enviar a EVE» pondrá solo el destino final.")}
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
                                openUrl(
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
                              onClick={() => openUrl(`https://zkillboard.com/system/${sid}/`)}
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
