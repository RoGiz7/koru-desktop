// Estado del planificador de rutas del mapa: modo (más corto / seguro / inseguro) y paradas.
// Hook por-feature (mismo patrón que useJumpPlanner): sin `geo`, solo estado. El cálculo del
// camino (routePath, que usa findRoute sobre el grafo) se queda en MapView porque necesita geo.
import { useState } from "react";
import type { RouteMode } from "./mapRoute";

const ANSI_KEY = "koru-route-ansiblex";
const WH_KEY = "koru-route-wormholes";
const SIGWH_KEY = "koru-route-sig-wormholes";
const AVOID_KEY = "koru-route-avoid";

export function useRoutePlanner() {
  const [routeActive, setRouteActive] = useState(false);
  const [routeMode, setRouteMode] = useState<RouteMode>("shortest");
  // Paradas de la ruta: [origen, destino1, destino2, ...]. null = casilla vacía.
  const [routeStops, setRouteStops] = useState<(number | null)[]>([null]);
  // ¿Rutar a través de los Ansiblex de la alianza? Es un INTERRUPTOR y no un automatismo porque
  // tener el puente en la lista no significa poder usarlo: la ACL puede dejarte fuera, y desde
  // sept-2026 los capitales no pasan y el condensador puede estar seco. Una ruta que cuenta con un
  // puente que no puedes cruzar es peor que no tener puentes. Se recuerda entre sesiones.
  const [useAnsiblex, setUseAnsiblex] = useState<boolean>(
    () => localStorage.getItem(ANSI_KEY) !== "0"
  );
  const toggleAnsiblex = (v: boolean) => {
    setUseAnsiblex(v);
    localStorage.setItem(ANSI_KEY, v ? "1" : "0");
  };
  // Rutar por wormholes (Thera/Turnur, datos de eve-scout). OFF por defecto: los WH son volátiles
  // (caducan, tienen límite de masa/tamaño de nave) y no siempre quieres depender de ellos.
  const [useWormholes, setUseWormholes] = useState<boolean>(
    () => localStorage.getItem(WH_KEY) === "1"
  );
  const toggleWormholes = (v: boolean) => {
    setUseWormholes(v);
    localStorage.setItem(WH_KEY, v ? "1" : "0");
  };
  // Rutar por TUS wormholes escaneados (los que anotaste con destino). OFF por defecto por lo mismo
  // que los de eve-scout: caducan en el downtime y tienen límite de masa. La diferencia es que estos
  // los has visto tú con tus ojos, así que valen mientras el agujero siga abierto.
  const [useSigWormholes, setUseSigWormholes] = useState<boolean>(
    () => localStorage.getItem(SIGWH_KEY) === "1"
  );
  const toggleSigWormholes = (v: boolean) => {
    setUseSigWormholes(v);
    localStorage.setItem(SIGWH_KEY, v ? "1" : "0");
  };
  // Sistemas a EVITAR al calcular la ruta (camperos conocidos, chokepoints, sistemas hostiles).
  // Se recuerdan entre sesiones: los sitios por los que no quieres pasar no cambian cada día.
  const [avoid, setAvoid] = useState<Set<number>>(() => {
    try {
      const raw = localStorage.getItem(AVOID_KEY);
      return new Set<number>(raw ? (JSON.parse(raw) as number[]) : []);
    } catch {
      return new Set<number>();
    }
  });
  const persistAvoid = (s: Set<number>) => {
    setAvoid(s);
    localStorage.setItem(AVOID_KEY, JSON.stringify([...s]));
  };
  const toggleAvoid = (sid: number) => {
    const next = new Set(avoid);
    if (next.has(sid)) next.delete(sid);
    else next.add(sid);
    persistAvoid(next);
  };
  const clearAvoid = () => persistAvoid(new Set());

  return {
    routeActive,
    setRouteActive,
    routeMode,
    setRouteMode,
    routeStops,
    setRouteStops,
    useAnsiblex,
    setUseAnsiblex: toggleAnsiblex,
    useWormholes,
    setUseWormholes: toggleWormholes,
    useSigWormholes,
    setUseSigWormholes: toggleSigWormholes,
    avoid,
    toggleAvoid,
    clearAvoid,
  };
}
