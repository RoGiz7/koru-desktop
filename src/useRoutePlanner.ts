// Estado del planificador de rutas del mapa: modo (más corto / seguro / inseguro) y paradas.
// Hook por-feature (mismo patrón que useJumpPlanner): sin `geo`, solo estado. El cálculo del
// camino (routePath, que usa findRoute sobre el grafo) se queda en MapView porque necesita geo.
import { useState } from "react";
import type { RouteMode } from "./mapRoute";

const ANSI_KEY = "koru-route-ansiblex";

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
  return {
    routeActive,
    setRouteActive,
    routeMode,
    setRouteMode,
    routeStops,
    setRouteStops,
    useAnsiblex,
    setUseAnsiblex: toggleAnsiblex,
  };
}
