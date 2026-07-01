// Estado del planificador de rutas del mapa: modo (más corto / seguro / inseguro) y paradas.
// Hook por-feature (mismo patrón que useJumpPlanner): sin `geo`, solo estado. El cálculo del
// camino (routePath, que usa findRoute sobre el grafo) se queda en MapView porque necesita geo.
import { useState } from "react";
import type { RouteMode } from "./mapRoute";

export function useRoutePlanner() {
  const [routeActive, setRouteActive] = useState(false);
  const [routeMode, setRouteMode] = useState<RouteMode>("shortest");
  // Paradas de la ruta: [origen, destino1, destino2, ...]. null = casilla vacía.
  const [routeStops, setRouteStops] = useState<(number | null)[]>([null]);
  return {
    routeActive,
    setRouteActive,
    routeMode,
    setRouteMode,
    routeStops,
    setRouteStops,
  };
}
