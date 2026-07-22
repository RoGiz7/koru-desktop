// Enrutado del mapa: Dijkstra sobre el grafo de stargates de New Eden.
// Puro (sin React), extraído de map.tsx para poder testear y reutilizar.
import type { NeSystem } from "./types";

export type RouteMode = "shortest" | "safer" | "insecure";

/**
 * Dijkstra sobre el grafo de rutas. `mode` pondera seguridad.
 *
 * @param avoid Sistemas a EVITAR: se tratan como si no existieran. El origen y el destino NUNCA se
 *   evitan aunque estén en la lista — si no, la ruta sería imposible y el usuario no entendería por
 *   qué (pedir «llévame a X» y «evita X» a la vez es contradictorio; mandamos la petición explícita).
 */
export function findRoute(
  adj: Map<number, number[]>,
  idx: Map<number, NeSystem>,
  from: number,
  to: number,
  mode: RouteMode,
  avoid?: Set<number>
): number[] | null {
  if (from === to) return [from];
  const weight = (n: number) => {
    const sec = idx.get(n)?.s ?? 0;
    const hi = sec >= 0.45;
    if (mode === "safer") return 1 + (hi ? 0 : 60);
    if (mode === "insecure") return 1 + (hi ? 60 : 0);
    return 1;
  };
  const dist = new Map<number, number>([[from, 0]]);
  const prev = new Map<number, number>();
  const visited = new Set<number>();
  const frontier = new Map<number, number>([[from, 0]]);
  while (frontier.size) {
    let u = -1;
    let best = Infinity;
    for (const [k, d] of frontier) if (d < best) ((best = d), (u = k));
    frontier.delete(u);
    if (u === to) break;
    if (visited.has(u)) continue;
    visited.add(u);
    for (const v of adj.get(u) ?? []) {
      if (visited.has(v)) continue;
      // Sistema vetado: se salta como si no estuviera en el grafo. Salvo que sea el destino.
      if (avoid?.has(v) && v !== to) continue;
      const nd = best + weight(v);
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd);
        prev.set(v, u);
        frontier.set(v, nd);
      }
    }
  }
  if (!prev.has(to)) return null;
  const path = [to];
  let c = to;
  while (c !== from) {
    const p = prev.get(c);
    if (p === undefined) return null;
    path.push(p);
    c = p;
  }
  path.reverse();
  return path;
}


// BFS multi-origen sobre el grafo de stargates: distancia en saltos de cada sistema al MÁS
// cercano de los orígenes. Para la proximidad de intel (alertas por nº de saltos).
export function proximityBFS(adj: Map<number, number[]>, origins: number[]): Map<number, number> {
  const dist = new Map<number, number>();
  const q: number[] = [];
  for (const o of origins) {
    if (!dist.has(o)) {
      dist.set(o, 0);
      q.push(o);
    }
  }
  let head = 0;
  while (head < q.length) {
    const cur = q[head++];
    const d = dist.get(cur)!;
    for (const nb of adj.get(cur) ?? []) {
      if (!dist.has(nb)) {
        dist.set(nb, d + 1);
        q.push(nb);
      }
    }
  }
  return dist;
}
