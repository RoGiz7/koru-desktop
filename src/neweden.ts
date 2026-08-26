import type { NewEden } from "./types";
import { loadJson } from "./staticJson";

// Carga (una sola vez, cacheada) los datos estáticos de New Eden (sistemas + saltos + regiones)
// desde /neweden.json. Compartido por el mapa y por las vistas que necesitan nombres de sistema.
// Por staticJson.ts, que es el dueño de todos los JSON estáticos: así este 1 MB comparte caché
// con cualquier otro sitio que lo pida por su URL en vez de tener la suya aparte.
export function loadNewEden(): Promise<NewEden> {
  return loadJson<NewEden>("/neweden.json", { systems: [], jumps: [], regions: [], constellations: [] });
}
