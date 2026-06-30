import type { NewEden } from "./types";

// Carga (una sola vez, cacheada) los datos estáticos de New Eden (sistemas + saltos + regiones)
// desde /neweden.json. Compartido por el mapa y por las vistas que necesitan nombres de sistema.
let nePromise: Promise<NewEden> | null = null;
export function loadNewEden(): Promise<NewEden> {
  if (!nePromise) nePromise = fetch("/neweden.json").then((r) => r.json());
  return nePromise;
}
