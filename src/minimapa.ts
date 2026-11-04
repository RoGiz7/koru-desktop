/** Geometria del MINIMAPA del overlay. Modulo PURO: ni React, ni Tauri, ni canvas — solo entra
 *  datos y salen coordenadas. Asi se valida en node antes de dibujar nada (patron de pedidosPlan).
 *
 * ★★ POR QUE DIBUJA ESTO Y NO «UNA ZONA DEL MAPA», que es lo que se pidio.
 *    Se prototipo a 300x300, el tamano real del overlay, con los datos de verdad: una zona de
 *    5 saltos son **133 sistemas con 5,1 px de separacion minima** y puntos de 4 px. Se solapan.
 *    Y dos sistemas lejanos estiran la caja y apelmazan el resto en una esquina. En anillos los
 *    nodos se leen pero las aristas se cruzan por todas partes.
 *    A 300 px no caben 133 sistemas: caben diez. Asi que se dibuja **la AMENAZA** — lo que esta
 *    caliente y el camino mas corto hasta ti. Con tres frentes son 6 nodos y se lee de un vistazo
 *    por donde vienen, que es la pregunta que el texto del aviso no sabe contestar.
 *    Ver koru-minimapa-overlay.
 */

/** Tope de avisos en el minimapa. Decision de RoGiz7: con mas vuelve el amasijo, «y ademas
 *  siempre se tiene el grande a mano». Los que sobran se cuentan, no se esconden. */
export const TOPE_AVISOS = 5;

export type SistemaMini = { x: number; y: number; n: string; s: number };
/** `edad` normalizada 0..1 — 0 recien cantado, 1 a punto de caducar. La ventana la pone el
 *  INTEL (decision: no tiene la suya, una cosa menos que explicar).
 *
 *  `saltos` es la distancia que ya calculo Rust para ese aviso (desde el ancla, o desde el piloto
 *  mas cercano si no hay anclas). Solo se usa para DECIDIR QUIEN ENTRA cuando hay mas avisos que
 *  sitio. Sin el, el corte cae en la edad. */
export type AvisoMini = { sys: number; edad: number; saltos?: number | null };
export type NodoMini = {
  id: number; px: number; py: number; nombre: string; sec: number;
  yo: boolean; caliente: boolean; edad: number; saltos: number;
};
export type AristaMini = { ax: number; ay: number; bx: number; by: number };
export type PlanoMini = {
  nodos: NodoMini[];
  aristas: AristaMini[];
  /** Avisos que no caben en el tope. Se ENSENAN como «+N», no se callan. */
  recortados: number;
  /** Avisos cuyo sistema no conecta por puertas con el tuyo (Pochven, p.ej.). Tampoco se callan. */
  inalcanzables: number;
};

/** Camino mas corto por stargates. Devuelve [] si no hay (no todo k-space conecta con todo). */
export function caminoMasCorto(ady: Map<number, number[]>, desde: number, hasta: number): number[] {
  if (desde === hasta) return [desde];
  const prev = new Map<number, number>([[desde, -1]]);
  const cola = [desde];
  for (let i = 0; i < cola.length; i++) {
    const u = cola[i];
    for (const v of ady.get(u) ?? []) {
      if (prev.has(v)) continue;
      prev.set(v, u);
      if (v === hasta) {
        const c = [v];
        for (let p = prev.get(v)!; p !== -1; p = prev.get(p)!) c.push(p);
        return c.reverse();
      }
      cola.push(v);
    }
  }
  return [];
}

export function planoAmenaza(o: {
  sistemas: Map<number, SistemaMini>;
  ady: Map<number, number[]>;
  /** Tu sistema. Es el del piloto MAS CERCANO de verdad, no el activo — lo mismo que ya calcula
   *  el overlay de avisos, que con multibox es la diferencia que importa. */
  yo: number;
  avisos: AvisoMini[];
  px: number;
  margen?: number;
}): PlanoMini {
  const { sistemas, ady, yo, px } = o;
  const margen = o.margen ?? 26;
  if (!sistemas.has(yo)) return { nodos: [], aristas: [], recortados: 0, inalcanzables: 0 };

  // ★ EL CORTE VA POR CERCANIA, y a igualdad de saltos manda el mas fresco.
  //
  //   Antes iba por edad, y la primera prueba en vivo enseno por que esta mal (2026-11-04): con
  //   seis frentes, el que se quedo fuera fue el de 3 SALTOS —por viejo, de hace 6 minutos—
  //   mientras entraban dos de 7 y 8. En un minimapa de defensa, lo ultimo que puede esconderse es
  //   lo que tienes encima.
  //
  //   El argumento de fondo: LA EDAD YA LA CUENTA EL COLOR. Si entran los cinco mas cercanos, uno
  //   viejo se ve gris y el jugador decide si le importa. Si el corte va por edad, el cercano
  //   desaparece y no hay nada que decidir.
  const orden = [...o.avisos]
    .filter((a) => a.sys !== undefined)
    .sort((a, b) => {
      const sa = a.saltos ?? Number.POSITIVE_INFINITY;
      const sb = b.saltos ?? Number.POSITIVE_INFINITY;
      if (sa !== sb) return sa - sb;
      return a.edad - b.edad;
    });
  const dentro = orden.slice(0, TOPE_AVISOS);
  const recortados = orden.length - dentro.length;

  const usados = new Set<number>([yo]);
  const saltos = new Map<number, number>([[yo, 0]]);
  const calor = new Map<number, number>();
  const pares = new Set<string>();
  let inalcanzables = 0;

  for (const a of dentro) {
    if (!sistemas.has(a.sys)) { inalcanzables++; continue; }
    const c = caminoMasCorto(ady, yo, a.sys);
    if (!c.length) { inalcanzables++; continue; }
    // Si ya estaba caliente por otro aviso, manda el mas fresco.
    const prevE = calor.get(a.sys);
    calor.set(a.sys, prevE === undefined ? a.edad : Math.min(prevE, a.edad));
    c.forEach((id, i) => {
      usados.add(id);
      const s = saltos.get(id);
      if (s === undefined || i < s) saltos.set(id, i);
    });
    for (let i = 0; i + 1 < c.length; i++) {
      const a1 = Math.min(c[i], c[i + 1]), b1 = Math.max(c[i], c[i + 1]);
      pares.add(`${a1}:${b1}`);
    }
  }

  // Proyeccion: caja contenedora de lo que se va a pintar, MANTENIENDO la proporcion (deformar
  // el espacio para llenar el cuadro haria mentir a las direcciones, que es justo lo que se mira).
  const ids = [...usados].filter((i) => sistemas.has(i));
  const xs = ids.map((i) => sistemas.get(i)!.x);
  const ys = ids.map((i) => sistemas.get(i)!.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX, h = maxY - minY;
  const util = px - 2 * margen;
  // Un solo nodo, o todos en la misma vertical/horizontal: NO dividir por cero. Un minimapa que
  // escupe NaN se queda en blanco y parece apagado, que es el peor fallo posible aqui.
  const k = w <= 0 && h <= 0 ? 0 : util / Math.max(w, h, Number.MIN_VALUE);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;

  const nodos: NodoMini[] = ids.map((id) => {
    const s = sistemas.get(id)!;
    return {
      id,
      px: px / 2 + (s.x - cx) * k,
      py: px / 2 - (s.y - cy) * k, // y del mapa crece hacia arriba; el canvas al reves
      nombre: s.n,
      sec: s.s,
      yo: id === yo,
      caliente: calor.has(id),
      edad: calor.get(id) ?? 1,
      saltos: saltos.get(id) ?? 0,
    };
  });
  // Los calientes al final: se dibujan ENCIMA de los de paso.
  nodos.sort((a, b) => Number(a.caliente) - Number(b.caliente));

  const porId = new Map(nodos.map((n) => [n.id, n]));
  const aristas: AristaMini[] = [...pares].map((p) => {
    const [a1, b1] = p.split(":").map(Number);
    const A = porId.get(a1)!, B = porId.get(b1)!;
    return { ax: A.px, ay: A.py, bx: B.px, by: B.py };
  });

  return { nodos, aristas, recortados, inalcanzables };
}
