// Renderers puros de las capas del mapa: reciben la proyección (geo) + los datos de la capa
// y devuelven los <circle> del SVG. Sin estado ni handlers → extraídos de map.tsx para adelgazarlo.
// Las capas con interacción (intel, ruta, salto, hover) se quedan en map.tsx.
import { secColor, ownerColor, standingColor, fmtSp } from "./format";
import { tr } from "./i18n";
import { FW_FACTIONS } from "./constants";
import type { MapOverlay } from "./constants";
import type { NeSystem, NewEden, SovSystem, FwSystem, Incursion, WhConn } from "./types";

// ===== Leyenda de escala =====
// El mapa del juego pone SIEMPRE una leyenda abajo a la izquierda diciendo qué significa el color o
// el tamaño de cada capa. Koru pintaba heatmaps sin explicarlos: el color no significaba nada para
// quien mira. Tres formas, porque las capas no son todas iguales y fingir que sí sería mentir:
//   · "bands"  → color por tramos (heatColor tiene 3 escalones REALES, no un degradado continuo;
//                dibujar un degradado suave daría a entender una precisión que no existe).
//   · "size"   → el color es fijo y lo que varía es el radio (assets, minería).
//   · "cats"   → categorías discretas con su significado (PI, soberanía…).
export type MapScale =
  | { kind: "bands"; label: string; bands: { color: string; upTo: number }[] }
  | { kind: "size"; label: string; color: string; max: number }
  | { kind: "cats"; label: string; items: { color: string; label: string }[] };

export function MapScaleLegend({ scale }: { scale: MapScale | null }) {
  if (!scale) return null;
  return (
    <div className="map-scale">
      {scale.kind === "bands" && (
        <div className="map-scale-bands">
          {/* De mayor a menor, como el juego: el máximo arriba. */}
          {[...scale.bands].reverse().map((b, i) => (
            <div key={i} className="map-scale-band">
              <span className="map-scale-sw" style={{ background: b.color }} />
              <span className="map-scale-val">≤ {fmtSp(b.upTo)}</span>
            </div>
          ))}
        </div>
      )}
      {scale.kind === "size" && (
        <div className="map-scale-sizes">
          {[1, 0.45, 0.12].map((f, i) => (
            <div key={i} className="map-scale-band">
              <span
                className="map-scale-dot"
                style={{
                  background: scale.color,
                  width: `${6 + Math.sqrt(f) * 10}px`,
                  height: `${6 + Math.sqrt(f) * 10}px`,
                }}
              />
              <span className="map-scale-val">{fmtSp(Math.max(1, Math.round(scale.max * f)))}</span>
            </div>
          ))}
        </div>
      )}
      {scale.kind === "cats" && (
        <div className="map-scale-bands">
          {scale.items.map((it, i) => (
            <div key={i} className="map-scale-band">
              <span className="map-scale-sw" style={{ background: it.color }} />
              <span className="map-scale-val">{it.label}</span>
            </div>
          ))}
        </div>
      )}
      <div className="map-scale-title">{scale.label}</div>
    </div>
  );
}

/** Clave de colores de los TRAZOS (rastros, ruta, puentes). Va aparte de `MapScaleLegend` porque no
 *  es una escala de valores sino de significados, y sobre todo porque solo lista **lo que hay ahora
 *  mismo en pantalla**: una leyenda fija que explicara cinco colores de los que se ven dos enseña
 *  menos que ninguna. Las entradas las decide quien la invoca. */
export function MapTrailLegend({ items }: { items: { color: string; label: string; dash?: boolean }[] }) {
  if (items.length === 0) return null;
  return (
    <div className="map-scale map-trail-legend">
      <div className="map-scale-bands">
        {items.map((it, i) => (
          <div key={i} className="map-scale-band">
            <span
              className="map-scale-line"
              style={
                it.dash
                  ? { background: `repeating-linear-gradient(90deg, ${it.color} 0 5px, transparent 5px 9px)` }
                  : { background: it.color }
              }
            />
            <span className="map-scale-val">{it.label}</span>
          </div>
        ))}
      </div>
      <div className="map-scale-title">{tr("Leyenda")}</div>
    </div>
  );
}

/** Escala que corresponde a la capa activa. `max` es el valor máximo real de la capa (liveMax). */
export function scaleFor(overlay: MapOverlay, max: number): MapScale | null {
  switch (overlay) {
    case "kills":
    case "jumps":
      // Los tres escalones REALES de heatColor(t): >0.66 · >0.33 · resto.
      return {
        kind: "bands",
        label: overlay === "kills" ? tr("Kills (1 h)") : tr("Saltos (1 h)"),
        bands: [
          { color: "#ffd86b", upTo: Math.max(1, Math.round(max * 0.33)) },
          { color: "#ff9f40", upTo: Math.max(2, Math.round(max * 0.66)) },
          { color: "#ff5a3c", upTo: Math.max(3, max) },
        ],
      };
    case "assets":
      return { kind: "size", label: tr("Assets (stacks)"), color: "#5fd0c0", max };
    case "mineria":
      return { kind: "size", label: tr("Minado (90 días)"), color: "#d8b24a", max };
    case "pi":
      return {
        kind: "cats",
        label: tr("Salud de tus colonias"),
        items: [
          { color: "#3fb950", label: tr("Sano (>24 h)") },
          { color: "#d29922", label: tr("Menos de 24 h") },
          { color: "#f0883e", label: tr("Menos de 6 h") },
          { color: "#e5534b", label: tr("Parado") },
          { color: "#8a8a8a", label: tr("Sin extractor") },
        ],
      };
    case "security":
      return {
        kind: "cats",
        label: tr("Seguridad"),
        items: [
          { color: "#3fb950", label: "high (≥0.5)" },
          { color: "#e3a13a", label: "low (0.1–0.4)" },
          { color: "#e5534b", label: "null (≤0.0)" },
        ],
      };
    case "wormholes":
      return {
        kind: "cats",
        label: tr("Conexiones de wormhole"),
        items: [
          { color: "#3ad6e0", label: "Thera" },
          { color: "#e0863a", label: "Turnur" },
        ],
      };
    case "incursion":
      return {
        kind: "cats",
        label: tr("Incursiones"),
        items: [
          { color: "#e5534b", label: tr("Establecida") },
          { color: "#f0883e", label: tr("Movilizando") },
          { color: "#d29922", label: tr("Retirándose") },
        ],
      };
    default:
      // Soberanía y FW usan un color por dueño/facción: una leyenda de 200 alianzas no ayuda.
      return null;
  }
}

// Proyección y grafo memorizados que construye MapView (useMemo `geo`).
export type Geo = {
  proj: (s: NeSystem) => { px: number; py: number };
  idx: Map<number, NeSystem>;
  nameIdx: Map<string, NeSystem>;
  adj: Map<number, number[]>;
  jumpsPath: string;
  regionLabels: { name: string; px: number; py: number }[];
  constLabels: { name: string; px: number; py: number }[];
};

// Fondo de estrellas (todos los sistemas). En la capa de seguridad, coloreado y algo mayor.
export function renderBackdrop(
  geo: Geo | null,
  ne: NewEden | null,
  overlay: MapOverlay,
  stride = 1,
  zoom = 1,
) {
  if (!geo || !ne) return null;
  const isSec = overlay === "security";
  // LOD: muy alejado (vista galaxia) los sistemas se solapan en pocos píxeles → pintar 1 de cada
  // `stride` se ve casi igual y baja mucho el nº de nodos a pintar. stride=1 = todos (zoom normal).
  const sys = stride > 1 ? ne.systems.filter((_, i) => i % stride === 0) : ne.systems;
  // El radio va en unidades de MUNDO (crece con el zoom) pero CON TOPE: sin él, al acercarte los
  // sistemas se volvían discos enormes y el mapa se leía como una masa. En el juego el nodo se
  // queda en un tamaño cómodo por mucho que amplíes. `r_pantalla = r_mundo × zoom`, así que topar
  // `r_mundo` en `K/zoom` deja el nodo clavado en K unidades de pantalla a partir de cierto zoom.
  const rBase = isSec ? 1.4 : 0.7;
  const rCap = (isSec ? 6 : 5) / Math.max(zoom, 0.001);
  const r = Math.min(rBase, rCap);
  return sys.map((s) => {
    const p = geo.proj(s);
    return (
      <circle
        key={s.id}
        cx={p.px}
        cy={p.py}
        r={r}
        // Gris CLARO, no azul oscuro: sobre el fondo casi negro el `#3a4654` de antes apenas
        // destacaba y los nodos se confundían con las líneas.
        fill={isSec ? secColor(s.s) : "#8b97a8"}
        fillOpacity={isSec ? 0.9 : 0.95}
      />
    );
  });
}

// Soberanía: círculos coloreados por dueño. Sub-filtro Alianzas vs Facciones.
export function renderSov(
  geo: Geo | null,
  overlay: MapOverlay,
  sovBySystem: Map<number, SovSystem> | null | undefined,
  subFilter: string,
) {
  if (!geo || overlay !== "soberania" || !sovBySystem) return null;
  return [...sovBySystem.values()].map((sv) => {
    if (sv.owner_id == null) return null;
    if (subFilter === "alliance" && !(sv.kind === "alliance" || sv.kind === "corporation")) return null;
    if (subFilter === "faction" && sv.kind !== "faction") return null;
    const s = geo.idx.get(sv.system_id);
    if (!s) return null;
    const p = geo.proj(s);
    return <circle key={`sov-${sv.system_id}`} cx={p.px} cy={p.py} r={1.6} fill={ownerColor(sv.owner_id)} fillOpacity={0.85} />;
  });
}

// Guerra de facciones: color = imperio que controla; radio/intensidad = cuán disputado.
export function renderFw(
  geo: Geo | null,
  overlay: MapOverlay,
  fwBySystem: Map<number, FwSystem> | null | undefined,
  subFilter: string,
) {
  if (!geo || overlay !== "fw" || !fwBySystem) return null;
  return [...fwBySystem.values()].map((f) => {
    if (subFilter !== "all" && f.owner_faction_id !== Number(subFilter)) return null;
    const s = geo.idx.get(f.solar_system_id);
    if (!s) return null;
    const p = geo.proj(s);
    const col = FW_FACTIONS[f.owner_faction_id]?.color ?? "#888";
    const pct =
      f.victory_points_threshold > 0 ? f.victory_points / f.victory_points_threshold : 0;
    const r = 1.6 + Math.min(Math.max(pct, 0), 1) * 1.6;
    const op = f.contested === "vulnerable" ? 1 : f.contested === "contested" ? 0.85 : 0.55;
    return <circle key={`fw-${f.solar_system_id}`} cx={p.px} cy={p.py} r={r} fill={col} fillOpacity={op} />;
  });
}

// Standings: color = tu standing con la facción NPC que controla el sistema.
export function renderStandings(
  geo: Geo | null,
  overlay: MapOverlay,
  factionMap: Record<string, number> | null,
  factionStandings: Map<number, number> | null | undefined,
) {
  if (!geo || overlay !== "standings" || !factionMap || !factionStandings) return null;
  return Object.entries(factionMap).map(([sidStr, fac]) => {
    if (!factionStandings.has(fac)) return null;
    const s = geo.idx.get(Number(sidStr));
    if (!s) return null;
    const std = factionStandings.get(fac) as number;
    const p = geo.proj(s);
    return (
      <circle
        key={`std-${sidStr}`}
        cx={p.px}
        cy={p.py}
        r={1.8}
        fill={standingColor(std)}
        fillOpacity={0.85}
      />
    );
  });
}

// Tus agentes: sistemas donde tienes agentes (de tus standings NPC), color = nivel del mejor agente.
const AGENT_LEVEL_COLOR: Record<number, string> = {
  1: "#8a929b", // L1 gris
  2: "#5dcaa5", // L2 teal
  3: "#4a90d9", // L3 azul
  4: "#e0a83a", // L4 ámbar
  5: "#d1495b", // L5 rojo (los mejores)
};
export function renderAgents(
  geo: Geo | null,
  overlay: MapOverlay,
  agentSystems: Map<number, number> | null | undefined,
) {
  if (!geo || overlay !== "agentes" || !agentSystems) return null;
  return [...agentSystems.entries()].map(([sid, level]) => {
    const s = geo.idx.get(sid);
    if (!s) return null;
    const p = geo.proj(s);
    const col = AGENT_LEVEL_COLOR[level] ?? "#8a929b";
    return (
      <circle
        key={`ag-${sid}`}
        cx={p.px}
        cy={p.py}
        r={2}
        fill={col}
        fillOpacity={0.85}
        stroke="#0a0d12"
        strokeWidth={0.4}
      >
        <title>{`${s.n} — agente(s) nivel ${level}`}</title>
      </circle>
    );
  });
}

// Mis corps NPC: sistemas donde las corps con las que tienes LP tienen estaciones (agentes + tiendas
// de lealtad = dónde gastar tu LP). Color ámbar; opacidad sube si varias corps tuyas están ahí.
export function renderCorps(
  geo: Geo | null,
  overlay: MapOverlay,
  corpSystems: Map<number, number> | null | undefined,
) {
  if (!geo || overlay !== "corps_npc" || !corpSystems) return null;
  return [...corpSystems.entries()].map(([sid, count]) => {
    const s = geo.idx.get(sid);
    if (!s) return null;
    const p = geo.proj(s);
    return (
      <circle
        key={`corp-${sid}`}
        cx={p.px}
        cy={p.py}
        r={1.8}
        fill="#e0a83a"
        fillOpacity={Math.min(0.5 + count * 0.15, 0.95)}
        stroke="#0a0d12"
        strokeWidth={0.3}
      >
        <title>{`${s.n} — ${count} corp(s) tuya(s) con estación`}</title>
      </circle>
    );
  });
}

// Incursiones de Sansha: sistemas infestados; el de staging más grande. Color = estado.
export function renderIncursions(
  geo: Geo | null,
  overlay: MapOverlay,
  incursions: Incursion[] | null | undefined,
) {
  if (!geo || overlay !== "incursion" || !incursions) return null;
  const stateColor = (st: string | null) =>
    st === "withdrawing" ? "#e0c84a" : st === "mobilizing" ? "#e08a3a" : "#e05a5a";
  return incursions.flatMap((inc) => {
    const col = stateColor(inc.state);
    return inc.infested_solar_systems.map((sid) => {
      const s = geo.idx.get(sid);
      if (!s) return null;
      const p = geo.proj(s);
      const staging = sid === inc.staging_solar_system_id;
      return (
        <circle
          key={`inc-${sid}`}
          cx={p.px}
          cy={p.py}
          r={staging ? 2.6 : 1.6}
          fill={col}
          fillOpacity={staging ? 1 : 0.7}
          stroke={staging ? "#0a0d12" : undefined}
          strokeWidth={staging ? 0.6 : undefined}
        >
          <title>{`${s.n}${staging ? " (staging)" : ""} — incursión ${inc.state ?? ""}`}</title>
        </circle>
      );
    });
  });
}

// Wormholes (eve-scout): sistemas con conexión Thera/Turnur.
export function renderThera(
  geo: Geo | null,
  overlay: MapOverlay,
  theraConns: WhConn[] | null | undefined,
) {
  if (!geo || overlay !== "wormholes" || !theraConns) return null;
  return theraConns.map((c, i) => {
    const s = geo.idx.get(c.system_id);
    if (!s) return null;
    const p = geo.proj(s);
    const col = c.hub === "Turnur" ? "#e0863a" : "#3ad6e0"; // Turnur naranja · Thera cian
    return (
      <circle
        key={`wh-${c.system_id}-${i}`}
        cx={p.px}
        cy={p.py}
        r={2.4}
        fill={col}
        fillOpacity={0.85}
        stroke="#0a0d12"
        strokeWidth={0.5}
      >
        <title>{`${s.n} — ${c.hub} (${c.wh_type || "WH"}) · ${c.max_ship_size || "?"} · ~${c.remaining_hours}h`}</title>
      </circle>
    );
  });
}
