/** Geometria del MINIMAPA. Modulo PURO: ni React, ni Tauri, ni canvas — solo entran datos y salen
 *  coordenadas. Asi se valida en node antes de dibujar nada (patron de pedidosPlan).
 *
 * ★★ LA HISTORIA, QUE EXPLICA EL MODELO Y CAMBIO DOS VECES EN UN SOLO DIA (2026-11-04).
 *    Merece leerse entera antes de tocar nada de aqui:
 *
 *   1. Se pidio «una zona del mapa». Un prototipo con los datos de verdad la tumbo: cinco saltos
 *      alrededor son 133 sistemas a 5,1 px de separacion en una caja de 300. Ilegible.
 *
 *   2. Se dibujo entonces solo LA AMENAZA —lo caliente y el camino hasta ti— encuadrando lo
 *      justo. Se leia bien, pero el marco cambiaba de forma con cada aviso que entraba o
 *      caducaba: nunca era «tu zona», era «el problema de ahora», y no daba sensacion de sitio.
 *
 *   3. RoGiz7 insistio: un piloto esta acostumbrado a ver el mapa. Y tenia razon, porque el
 *      prototipo del punto 1 media OTRA COSA — meter N saltos dentro de la caja, que no es hacer
 *      zoom. Un marco GEOGRAFICO FIJO es un problema distinto: su region son 110 sistemas a
 *      13,2 px, que se lee comodo. Medido despues sobre las 70 regiones del juego: mediana de
 *      14,2 px en una ventana de 250, y solo Domain (189 sistemas) baja de 8.
 *
 *   De ahi el modelo de hoy: EL MARCO ES TU REGION MAS UN MARGEN, Y ES FIJO. Encima se pintan tus
 *   referencias y los frentes. Se midio tambien la alternativa de un marco que CRECIERA para
 *   meter los avisos lejanos, y se descarto con numeros: entre 9,6 y 15,9 anos luz la escala
 *   cambia casi el doble, o sea que el mapa daria un respingo justo cuando entra la accion — que
 *   es exactamente el re-encuadre que este modelo viene a quitar. Con el margen del 50% fijo, de
 *   26 avisos reales suyos de una tarde entraban 24.
 *
 * ★★ Y LO QUE EL MARCO FIJO ARREGLA DE PASO, que es lo que de verdad lo justifica: YA NO HAY QUE
 *    ELEGIR UN CENTRO. Con varias anclas o varios personajes se dibujan todos, y cada frente
 *    apunta a SU propia referencia con el numero de saltos que dijo Rust. La discrepancia entre
 *    el minimapa y el panel de intel —que costo dos arreglos esta misma manana— deja de ser
 *    posible, en vez de quedar parcheada.
 */

/** Tope de frentes dibujados. Decision de RoGiz7: con mas vuelve el amasijo, «y ademas siempre se
 *  tiene el grande a mano». Los que sobran se CUENTAN, no se esconden. */
export const TOPE_AVISOS = 5;

/** Un sistema del catalogo. `r` es la region, y de ella sale el marco. */
export type SistemaMini = { x: number; y: number; n: string; s: number; r: number };

/** Una referencia tuya. Un ANCLA es un sitio que defiendes; un PILOTO es alguien que se mueve.
 *  Se dibujan distinto a proposito: mezclarlos seria perder la mitad de lo que cuentan. */
export type RefMini = { sys: number; nombre: string; tipo: "ancla" | "piloto" };

/** Un aviso tal y como lo manda Rust. `edad` normalizada 0..1 la calcula la ventana; `saltos` y
 *  `desde` vienen del evento: su numero y la referencia desde la que lo midio. No se recalculan
 *  aqui NUNCA — recalcular es lo que hacia que el minimapa dijera 21 donde el panel decia 9. */
export type AvisoMini = {
  sys: number;
  edad: number;
  saltos?: number | null;
  desde?: number | null;
};

/** La proyeccion del marco. Se devuelve para que el dibujante coloque CUALQUIER sistema con la
 *  misma regla (el mapa de fondo, sin ir mas lejos) y no puedan desalinearse nunca. */
export type Proyeccion = {
  /** Centro del marco, en unidades de mapa. */
  cx: number;
  cy: number;
  /** Pixeles por unidad de mapa, con el zoom ya dentro. */
  k: number;
  /** Lado del lienzo, en pixeles. */
  px: number;
  /** Lado del marco a zoom 1, en unidades de mapa. */
  lado: number;
  /** Desplazamiento aplicado, en pixeles. Siempre (0,0) a zoom 1. */
  panX: number;
  panY: number;
};

/** La UNICA forma de pasar de mapa a pantalla. Exportada para que el fondo use exactamente esta. */
export function proyectar(p: Proyeccion, x: number, y: number): [number, number] {
  return [
    p.px / 2 + (x - p.cx) * p.k + p.panX,
    // La y del mapa crece hacia arriba y la del canvas hacia abajo.
    p.px / 2 - (y - p.cy) * p.k + p.panY,
  ];
}

export type PuntoMini = { id: number; nombre: string; x: number; y: number; fuera: boolean };
/** Un frente caliente. `saltos` y `desde` son los de Rust, tal cual llegaron. */
export type FrenteMini = PuntoMini & { edad: number; saltos: number | null; desde: number | null };
export type RefDibujada = PuntoMini & { tipo: "ancla" | "piloto" };
export type AristaMini = { ax: number; ay: number; bx: number; by: number };

export type PlanoMini = {
  proy: Proyeccion;
  /** Los sistemas que caen dentro del lienzo: el mapa de fondo. */
  fondo: number[];
  refs: RefDibujada[];
  frentes: FrenteMini[];
  /** Las puertas por las que pasa la ruta de cada frente hasta SU referencia. Se resaltan sobre
   *  las del fondo: el fondo dice que hay, esto dice por donde vendrian. */
  rutas: AristaMini[];
  /** Frentes que no caben en el tope. Se ensenan como «+N». */
  recortados: number;
  /** Frentes cuyo sistema no esta en el catalogo. Tampoco se callan. */
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

/** Lado minimo del marco, en unidades de mapa (~1 ano luz). Red para la region de UN solo
 *  sistema —Yasna Zakh existe— cuya caja mide cero: sin esto, k sale infinito y la ventana se
 *  queda en blanco, que aqui es el peor fallo porque parece apagada. */
const LADO_MINIMO = 9.4607e15;

export function planoRegion(o: {
  sistemas: Map<number, SistemaMini>;
  ady: Map<number, number[]>;
  /** La region que hace de marco. La elige el jugador en Ajustes. */
  region: number;
  referencias: RefMini[];
  avisos: AvisoMini[];
  px: number;
  /** Pixeles libres por cada lado del lienzo. */
  margen?: number;
  /** Cuanto se agranda la caja de la region. 0.5 = +50%, que es lo medido. */
  holgura?: number;
  /** 1 = el marco entero (el tope: no se puede alejar mas). Hasta 4 acercando. */
  zoom?: number;
  /** Desplazamiento en pixeles. Se recorta solo: a zoom 1 queda forzosamente en (0,0). */
  pan?: { x: number; y: number };
}): PlanoMini {
  const { sistemas, ady, region, px } = o;
  const margen = o.margen ?? 22;
  const holgura = o.holgura ?? 0.5;
  const zoom = Math.min(4, Math.max(1, o.zoom ?? 1));

  // EL MARCO: la caja de la region, agrandada. Si la region no tiene sistemas (id desconocido),
  // se cae a la caja de tus referencias, que es lo unico que se sabe seguro que te importa.
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  const meter = (s: SistemaMini) => {
    x1 = Math.min(x1, s.x); y1 = Math.min(y1, s.y);
    x2 = Math.max(x2, s.x); y2 = Math.max(y2, s.y);
  };
  for (const s of sistemas.values()) if (s.r === region) meter(s);
  if (!Number.isFinite(x1)) {
    for (const r of o.referencias) {
      const s = sistemas.get(r.sys);
      if (s) meter(s);
    }
  }
  const hayCaja = Number.isFinite(x1);
  const cx = hayCaja ? (x1 + x2) / 2 : 0;
  const cy = hayCaja ? (y1 + y2) / 2 : 0;
  const lado = hayCaja
    ? Math.max(Math.max(x2 - x1, y2 - y1) * (1 + holgura), LADO_MINIMO)
    : LADO_MINIMO;

  const util = px - 2 * margen;
  const k = (util / lado) * zoom;

  // EL DESPLAZAMIENTO SE RECORTA SOLO, y de ahi sale gratis la regla que pidio RoGiz7: a zoom 1
  // el marco cabe justo, el margen de arrastre es CERO y no hay forma de sacar nada de la vista
  // tirando del raton. En cuanto se acerca, aparece sitio para moverse.
  const sobra = Math.max(0, (lado * k - util) / 2);
  const panX = Math.min(sobra, Math.max(-sobra, o.pan?.x ?? 0));
  const panY = Math.min(sobra, Math.max(-sobra, o.pan?.y ?? 0));

  const proy: Proyeccion = { cx, cy, k, px, lado, panX, panY };
  const dentro = (x: number, y: number) => x >= 0 && x <= px && y >= 0 && y <= px;

  // EL FONDO: lo que de verdad cae en el lienzo. Se calcula aqui y no en el dibujante para que
  // las dos capas no puedan usar proyecciones distintas.
  const fondo: number[] = [];
  for (const [id, s] of sistemas) {
    const [x, y] = proyectar(proy, s.x, s.y);
    if (dentro(x, y)) fondo.push(id);
  }

  const refs: RefDibujada[] = [];
  for (const r of o.referencias) {
    const s = sistemas.get(r.sys);
    if (!s) continue;
    const [x, y] = proyectar(proy, s.x, s.y);
    refs.push({ id: r.sys, nombre: r.nombre || s.n, x, y, fuera: !dentro(x, y), tipo: r.tipo });
  }

  // ★ EL CORTE VA POR CERCANIA, no por edad. Se aprendio en vivo (2026-11-04): con seis frentes,
  //   el que se quedaba fuera era el de 3 SALTOS —por viejo— mientras entraban dos de 7 y 8. En
  //   un minimapa de defensa, lo ultimo que puede esconderse es lo que tienes encima. La edad ya
  //   la cuenta el color: un frente cercano y viejo se ve gris, y lo decides tu.
  const orden = [...o.avisos].sort((a, b) => {
    const sa = a.saltos ?? Number.POSITIVE_INFINITY;
    const sb = b.saltos ?? Number.POSITIVE_INFINITY;
    if (sa !== sb) return sa - sb;
    return a.edad - b.edad;
  });
  const elegidos = orden.slice(0, TOPE_AVISOS);
  const recortados = orden.length - elegidos.length;

  const frentes: FrenteMini[] = [];
  const pares = new Set<string>();
  let inalcanzables = 0;
  for (const a of elegidos) {
    const s = sistemas.get(a.sys);
    if (!s) {
      inalcanzables++;
      continue;
    }
    const [x, y] = proyectar(proy, s.x, s.y);
    frentes.push({
      id: a.sys, nombre: s.n, x, y, fuera: !dentro(x, y),
      edad: a.edad, saltos: a.saltos ?? null, desde: a.desde ?? null,
    });
    // LA RUTA, hasta SU referencia. Sin referencia no se inventa ninguna.
    if (a.desde != null && sistemas.has(a.desde)) {
      const c = caminoMasCorto(ady, a.desde, a.sys);
      for (let i = 0; i + 1 < c.length; i++) {
        const p = Math.min(c[i], c[i + 1]);
        const q = Math.max(c[i], c[i + 1]);
        pares.add(`${p}:${q}`);
      }
    }
  }

  const rutas: AristaMini[] = [];
  for (const par of pares) {
    const [a, b] = par.split(":").map(Number);
    const sa = sistemas.get(a), sb = sistemas.get(b);
    if (!sa || !sb) continue;
    const [ax, ay] = proyectar(proy, sa.x, sa.y);
    const [bx, by] = proyectar(proy, sb.x, sb.y);
    rutas.push({ ax, ay, bx, by });
  }

  return { proy, fondo, refs, frentes, rutas, recortados, inalcanzables };
}
