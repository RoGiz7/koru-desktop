import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { tr } from "./i18n";
import { fmtAgo, fmtIsk, fmtSp, fmtMin, secColor, ownerColor, heatColor, typeIcon } from "./format";
import { OverlayIcon } from "./charts";
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
import { OVERLAYS, OVERLAY_CATS, SUBFILTERS, FW_FACTIONS, POIS } from "./constants";
import type { MapOverlay } from "./constants";
import type {
  IntelConfig,
  SysActivity,
  SovSystem,
  FwSystem,
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
  factionStandings?: Map<number, number> | null;
  agentSystems?: Map<number, number> | null;
  corpSystems?: Map<number, number> | null;
  incursions?: Incursion[] | null;
  theraConns?: WhConn[] | null;
  intel?: IntelConfig;
  hereSystemId?: number | null;
  charLocations?: CharLoc[];
  characters?: Character[];
  onSystemAssets?: (systemName: string) => void;
  onOpenCazador?: (name?: string) => void;
  openTrack?: { name: string; nonce: number } | null;
}) {
  const {
    data,
    overlay,
    onOverlayChange,
    intel,
    onSystemAssets,
    onOpenCazador,
    openTrack,
    assetsBySystem,
    miningBySystem,
    sovBySystem,
    fwBySystem,
    factionStandings,
    agentSystems,
    corpSystems,
    incursions,
    theraConns,
    hereSystemId,
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
  const { routeActive, setRouteActive, routeMode, setRouteMode, routeStops, setRouteStops } =
    useRoutePlanner();
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
  const jumpsFrom = useMemo(
    () => (!geo || intelOrigins.length === 0 ? null : proximityBFS(geo.adj, intelOrigins)),
    [geo, intelOrigins],
  );

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
      const near = j != null && j <= (intel?.alertJumps ?? 0);
      // Filtro "solo en rango": oculta lo que esté fuera del umbral de saltos.
      if (intel?.onlyRange && !near) return null;
      return (
        <g
          key={`intel-${sid}`}
          style={{ cursor: "pointer" }}
          onClick={(e) => {
            e.stopPropagation();
            if (movedRef.current) return; // fue un paneo
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
                stroke="#ff3b3b"
                strokeWidth={0.7}
                style={{ ["--intel-op"]: op * 0.85 } as React.CSSProperties}
              />
            </g>
          ) : (
            <circle cx={p.px} cy={p.py} r={2.1} fill="none" stroke="#ff3b3b" strokeOpacity={op * 0.3} strokeWidth={0.4} pointerEvents="none" />
          )}
          {/* zona de click ampliada (invisible) para acertar fácil el punto + tooltip */}
          <circle cx={p.px} cy={p.py} r={2.6} fill="transparent">
            <title>{`${s.n}${j != null ? ` · ${j} ${tr("saltos")}` : ""}\n${r.author}: ${r.message}\n${tr("(clic para ver detalle)")}`}</title>
          </circle>
          <circle cx={p.px} cy={p.py} r={1.3} fill="#ff3b3b" fillOpacity={op} stroke="#0a0d12" strokeWidth={0.3} pointerEvents="none" />
        </g>
      );
    });
  }, [geo, overlay, intelReports, jumpsFrom, intel?.recency, intel?.alertJumps, intel?.onlyRange]);

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
  // --- Modo cazador: rastro HISTÓRICO persistente de un objetivo (tabla intel_sightings) ---
  const { huntPilot, huntTrack, loadHuntTrack, clearHuntTrack } = useHuntTrack(openTrack);
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
    if (!geo || overlay !== "intel" || !huntTrack || huntTrack.length === 0) return null;
    const seq: number[] = [];
    for (const p of huntTrack) {
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
    return (
      <g>
        {pts.length >= 2 && (
          <>
            <defs>
              <marker
                id="hunt-arrow"
                markerWidth="4"
                markerHeight="4"
                refX="2.4"
                refY="2"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M0,0 L4,2 L0,4 Z" fill="#ff6ad5" />
              </marker>
            </defs>
            <polyline points={poly} fill="none" stroke="#ff6ad5" strokeOpacity={0.25} strokeWidth={0.6} />
            <polyline
              points={poly}
              fill="none"
              stroke="#ff6ad5"
              strokeWidth={0.7}
              strokeLinecap="round"
              strokeDasharray="2 2.5"
              markerEnd="url(#hunt-arrow)"
            >
              <animate attributeName="stroke-dashoffset" from="0" to="-4.5" dur="0.7s" repeatCount="indefinite" />
            </polyline>
          </>
        )}
        {pts.slice(1, -1).map((p, i) => (
          <circle key={`hunt-${i}`} cx={p.px} cy={p.py} r={0.9} fill="#ff6ad5" />
        ))}
        <circle cx={first.px} cy={first.py} r={1.1} fill="#0a0d12" stroke="#ff6ad5" strokeWidth={0.5}>
          <title>{tr("Primer avistamiento")}</title>
        </circle>
        {pts.length >= 2 && (
          <circle cx={last.px} cy={last.py} r={1.6} fill="#ff6ad5" stroke="#0a0d12" strokeWidth={0.3}>
            <title>{tr("Último avistamiento")}</title>
          </circle>
        )}
      </g>
    );
  }, [geo, overlay, huntTrack]);

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

  const routePath = useMemo(() => {
    if (!geo) return null;
    const stops = routeStops.filter((s): s is number => s != null);
    if (stops.length < 2) return null;
    const full: number[] = [];
    for (let i = 0; i < stops.length - 1; i++) {
      const seg = findRoute(geo.adj, geo.idx, stops[i], stops[i + 1], routeMode);
      if (!seg) return null;
      if (i === 0) full.push(...seg);
      else full.push(...seg.slice(1));
    }
    return full;
  }, [geo, routeStops, routeMode]);

  if (!ne || !geo) return <p className="muted">{tr("Cargando mapa…")}</p>;

  const pvp = data ?? [];
  const maxAct = Math.max(...pvp.map((d) => d.kills + d.losses), 1);
  const totalKills = pvp.reduce((s, d) => s + d.kills, 0);
  const totalLosses = pvp.reduce((s, d) => s + d.losses, 0);
  const labeled = new Set(
    [...pvp]
      .sort((a, b) => b.kills + b.losses - (a.kills + a.losses))
      .slice(0, 12)
      .map((d) => d.system_id)
  );

  const liveMap =
    overlay === "kills"
      ? liveKills
      : overlay === "jumps"
      ? liveJumps
      : overlay === "assets"
      ? assetsBySystem ?? null
      : overlay === "mineria"
      ? miningBySystem ?? null
      : null;
  const liveMax = liveMap ? Math.max(...liveMap.values(), 1) : 1;
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
        {routeActive && (
        <div className="route-panel map-navcard">
          <div className="route-panel-head">
            <select value={routeMode} onChange={(e) => setRouteMode(e.target.value as RouteMode)}>
              <option value="shortest">{tr("Más corta")}</option>
              <option value="safer">{tr("Más segura")}</option>
              <option value="insecure">{tr("Menos segura")}</option>
            </select>
            <span className="muted small">
              {routePath
                ? `${routePath.length - 1} ${tr("saltos")}`
                : routeStops.filter((s) => s != null).length >= 2
                ? tr("Sin ruta por stargates")
                : tr("Elige origen y destino")}
            </span>
            <button
              onClick={() => setRouteStops([null])}
              title={tr("Limpiar")}
            >
              {tr("Limpiar")}
            </button>
          </div>
          {routeStops.map((stop, i) => (
            <div className="route-stop" key={i}>
              <span className="route-stop-label">{i === 0 ? tr("Origen") : `${tr("Destino")} ${i}`}</span>
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
              {i > 0 && (
                <button
                  className="route-stop-del"
                  title={tr("Quitar")}
                  onClick={() => setRouteStops((prev) => prev.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <button className="route-add" onClick={() => setRouteStops((prev) => [...prev, null])}>
            + {tr("Añadir destino")}
          </button>
          <p className="muted small">
            {tr("También puedes hacer click en sistemas del mapa para añadirlos · doble-click en el mapa = zoom.")}
          </p>

          {routePath && routePath.length > 1 && (
            <div className="route-list">
              <div className="muted small">{tr("Sistemas de la ruta")} ({routePath.length}):</div>
              <ol>
                {routePath.map((sid, i) => {
                  const s = geo.idx.get(sid);
                  const kills = liveKills?.get(sid) ?? 0;
                  return (
                    <li key={i}>
                      <span className="route-sec" style={{ color: secColor(s?.s ?? 0) }}>
                        {(s?.s ?? 0).toFixed(1)}
                      </span>
                      <span className="route-sysname">{s?.n ?? `#${sid}`}</span>
                      <span className={`route-kills ${kills > 0 ? "hot" : ""}`} title={tr("Kills última hora")}>
                        {kills} ⚔
                      </span>
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
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </div>
      )}

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
                return (
                  <circle
                    key={`live-${sid}`}
                    cx={p.px}
                    cy={p.py}
                    r={r}
                    fill={liveColor ?? heatColor(v / liveMax)}
                    fillOpacity={0.55}
                    className="clickable-sys"
                    onClick={(e) => {
                      e.stopPropagation();
                      clickSystem(sid);
                    }}
                  >
                    <title>{`${s.n}\n${
                      overlay === "kills"
                        ? "Kills"
                        : overlay === "jumps"
                        ? "Jumps"
                        : overlay === "mineria"
                        ? "Minado"
                        : "Assets (stacks)"
                    }: ${fmtSp(v)}`}</title>
                  </circle>
                );
              })}
            {/* ruta planificada */}
            {routePath && routePath.length > 1 && (
              <path
                d={routePath
                  .map((sid, i) => {
                    const s = geo.idx.get(sid);
                    if (!s) return "";
                    const p = geo.proj(s);
                    return `${i === 0 ? "M" : "L"}${p.px.toFixed(1)} ${p.py.toFixed(1)}`;
                  })
                  .join("")}
                fill="none"
                stroke="#ffd54a"
                strokeWidth={1.6 / view.z}
                strokeLinejoin="round"
                opacity={0.95}
              />
            )}
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
                <div className="sys-stats">
                  <div>{tr("Tus kills")}: <strong>{act?.kills ?? 0}</strong></div>
                  <div>{tr("Tus losses")}: <strong>{act?.losses ?? 0}</strong></div>
                  <div>{tr("Tu ISK")}: <strong>{act ? fmtIsk(act.isk) : "0"}</strong></div>
                  {kv != null && <div>{tr("Kills 1h")}: <strong>{kv}</strong></div>}
                  {jv != null && <div>{tr("Jumps 1h")}: <strong>{jv}</strong></div>}
                  {av != null && <div>{tr("Assets (stacks)")}: <strong>{av}</strong></div>}
                </div>
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

        {/* Tarjetas flotantes de intel (derecha): columna apilable auto-ajustable.
            El chip "Rastro" arriba; debajo, la tarjeta abierta (detalle/habituales/ficha). */}
        <div className="intel-rstack">
        {/* Modo cazador: chip flotante con el objetivo cuyo rastro se está mostrando. */}
        {overlay === "intel" && huntPilot && (
          <div className="intel-detail hunt-chip">
            <span>
              🎯 {tr("Rastro")}: <strong>{huntPilot}</strong>
            </span>
            <span className="muted small">
              {huntTrack == null
                ? tr("Cargando…")
                : huntTrack.length === 0
                  ? tr("Sin avistamientos guardados todavía (se acumulan según aparezca en intel).")
                  : `${huntTrack.length} ${tr("avistamientos")}`}
            </span>
            <button
              className="sys-close"
              title={tr("Quitar rastro")}
              onClick={clearHuntTrack}
            >
              ✕
            </button>
          </div>
        )}

        {/* Tarjeta de detalle de un reporte de intel (piloto/nave/ruta/zKill) */}
        {overlay === "intel" && intelDetail && (
          <div className="intel-detail">
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
                        className={`intel-hab-track${huntPilot === c.name ? " active" : ""}`}
                        title={tr("Ver su rastro histórico en el mapa")}
                        onClick={() => loadHuntTrack(c.name)}
                      >
                        🎯 {huntPilot === c.name ? tr("Seguir ✓") : tr("Seguir")}
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
          </div>
        )}

        {/* Tarjeta de "Hostiles habituales" (aprendidos del intel por nº de menciones) */}
        {overlay === "intel" && habitualOpen && (
          <div className="intel-detail intel-habitual">
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
                      className={`intel-hab-track${huntPilot === h.name ? " active" : ""}`}
                      title={tr("Ver su rastro histórico en el mapa")}
                      onClick={() => loadHuntTrack(h.name)}
                    >
                      🎯 {huntPilot === h.name ? tr("Rastro ✓") : tr("Rastro")}
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
    </>
  );
}
