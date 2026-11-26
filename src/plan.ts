// ★★ EL PLAN — el cálculo del orden y de los márgenes. Puro: sin React y sin `invoke`.
//
// Lo que se almacena (plan, paradas, orden manual) vive en Rust, `db/plan.rs`. Aquí se decide en
// qué orden ir y con cuánto margen llegas, y se hace en el frontend por UNA razón: los saltos
// entre dos sistemas salen del MISMO grafo que pinta la línea amarilla del mapa (`routeAdj` con
// sus Ansiblex y wormholes, el mismo modo, los mismos sistemas a evitar). Si los márgenes contaran
// otra ruta, el panel mentiría respecto a lo que está dibujado al lado.
//
// ⚠️ FASE 1 ES A PUERTAS: aquí no hay saltos de capital, fatiga, cynos ni isótopos. Los Ansiblex y
//    los wormholes SÍ entran si el usuario tiene sus interruptores encendidos, porque entonces su
//    ruta real los usa; la pata que cruza un wormhole se marca, porque puede haberse cerrado.

/** Tipos que devuelve `plan_cargar` (ver `db/plan.rs`). */
export type ParadaResuelta = {
  titulo: string;
  system_id: number | null;
  system_name: string;
  caduca_at: string;
  estado: string;
  por_hacer: boolean;
};
export type ParadaCargada = {
  id: number;
  orden: number;
  kind: string;
  ref_id: number;
  resuelta: ParadaResuelta | null;
  /** Por qué NO resuelve, como código (el texto lo pone la pantalla). Se pinta, nunca se filtra:
   *  ver `Db::plan_cargar`. */
  fallo: "kind_desconocido" | "no_existe" | null;
};
export type Plan = {
  id: number;
  nombre: string;
  creado_at: string;
  origen_system_id: number | null;
  orden_manual: boolean;
  salta_character_id: number | null;
  cyno_character_id: number | null;
  ojos_character_id: number | null;
};
export type PlanCargado = { plan: Plan; paradas: ParadaCargada[] };
export type PlanResumen = { id: number; nombre: string; creado_at: string; paradas: number };

/** Hasta aquí se prueban TODAS las permutaciones: 8! = 40.320, nada para un ordenador, y da el
 *  óptimo de verdad sin heurística que explicar. Por encima se ordena por caducidad y se dice en
 *  pantalla. No hay algoritmo listo a propósito: la honestidad sobre el método vale más aquí. */
export const MAX_PERMUTAR = 8;

/** Una parada que entra en el cálculo: resuelta, por hacer y con sistema. */
export type ParadaCalc = { stopId: number; systemId: number; caducaMs: number };

/** Un tramo entre dos puntos del plan. `null` = no hay ruta con los filtros actuales. */
export type Tramo = { saltos: number; path: number[]; wormhole: boolean } | null;

/** Los tramos se piden por índice: 0 = el origen, 1..n = las paradas en el orden de `paradas`. */
export type Tramos = (desde: number, hasta: number) => Tramo;

export type EstadoParada = "salvada" | "perdida" | "sin_ruta";

export type ResultadoParada = {
  stopId: number;
  estado: EstadoParada;
  /** Saltos del tramo que llega aquí (0 si `sin_ruta`). */
  saltos: number;
  /** El tramo que llega aquí cruza un wormhole: puede haberse cerrado. */
  wormhole: boolean;
  llegadaMs: number;
  /** caduca − llegada, en minutos. Positivo = sobra; negativo = llegas tarde. */
  margenMin: number;
};

/** Una parada que no se salva ni yendo directo desde el origen. */
export type Imposible = {
  stopId: number;
  /** Saltos del tramo DIRECTO desde el origen. */
  saltos: number;
  /** caduca − llegada yendo directo, en minutos: siempre negativo. */
  margenMin: number;
};

export type Evaluacion = {
  /** Índices de `paradas` EN EL RECORRIDO, en el orden evaluado. Las imposibles no están. */
  orden: number[];
  resultados: ResultadoParada[];
  /** Fuera del recorrido: perdidas hagas lo que hagas. Ver `separarImposibles`. */
  imposibles: Imposible[];
  salvadas: number;
  /** Minutos de recorrido (saltos × minutos por salto), sin el tiempo en los sitios. */
  recorridoMin: number;
};

/** ★ DOS «PERDIDAS» QUE NO SON LA MISMA COSA (decisión de RoGiz7, 2026-11-26).
 *
 *  · «No llegas ni yendo directo» es un hecho sobre LA ESCALACIÓN: perdida hagas lo que hagas.
 *    SALE del recorrido, a una lista aparte, y no gasta ni un minuto de viaje. Dentro, el óptimo
 *    la metía en mitad del camino porque «quedaba de paso» hacia otra, y eso no lo haría nadie.
 *  · «Se pierde con este orden» es un hecho sobre TU ORDEN. Se queda en el recorrido (ver
 *    `evaluar`), porque su «llegas 25 m tarde» es lo que hace útil decir que el propuesto
 *    salvaría más.
 *
 *  Una parada SIN RUTA desde el origen no es imposible: es un problema de los filtros (evitados,
 *  wormholes), y se queda en el recorrido como `sin_ruta` para que se vea dónde está. */
export function separarImposibles(
  paradas: ParadaCalc[],
  tramos: Tramos,
  ahoraMs: number,
  minPorSalto: number,
): Map<number, Imposible> {
  const fuera = new Map<number, Imposible>();
  paradas.forEach((p, i) => {
    const directo = tramos(0, i + 1);
    if (!directo) return;
    const margenMin = (p.caducaMs - (ahoraMs + directo.saltos * minPorSalto * 60000)) / 60000;
    if (margenMin < 0) fuera.set(i, { stopId: p.stopId, saltos: directo.saltos, margenMin });
  });
  return fuera;
}

/** ★ EL MODELO DE TIEMPO. Llegada a la parada i = ahora + los recorridos hasta ella + el tiempo
 *  en los sitios anteriores.
 *
 *  Las imposibles (`separarImposibles`) se apartan antes y no cuentan para nada. De las demás:
 *   · Una parada PERDIDA CON ESTE ORDEN no suma tiempo en el sitio —llegas, ya no está, y
 *     sigues—, pero su viaje sí cuenta: el orden la incluye y la línea del mapa pasa por ella.
 *   · Una parada SIN RUTA no mueve el punto de partida: no se puede llegar, así que el siguiente
 *     tramo sale de donde estabas. */
export function evaluar(
  orden: number[],
  paradas: ParadaCalc[],
  tramos: Tramos,
  ahoraMs: number,
  minPorSalto: number,
  minEnSitio: number,
): Evaluacion {
  const fuera = separarImposibles(paradas, tramos, ahoraMs, minPorSalto);
  let pos = 0; // índice de tramos: 0 = origen
  let t = ahoraMs;
  let salvadas = 0;
  let recorridoMin = 0;
  const enRuta = orden.filter((i) => !fuera.has(i));
  const resultados: ResultadoParada[] = [];
  for (const i of enRuta) {
    const p = paradas[i];
    const tramo = tramos(pos, i + 1);
    if (!tramo) {
      resultados.push({ stopId: p.stopId, estado: "sin_ruta", saltos: 0, wormhole: false, llegadaMs: NaN, margenMin: NaN });
      continue;
    }
    const viaje = tramo.saltos * minPorSalto;
    recorridoMin += viaje;
    t += viaje * 60000;
    const margenMin = (p.caducaMs - t) / 60000;
    const salvada = margenMin >= 0;
    resultados.push({
      stopId: p.stopId,
      estado: salvada ? "salvada" : "perdida",
      saltos: tramo.saltos,
      wormhole: tramo.wormhole,
      llegadaMs: t,
      margenMin,
    });
    if (salvada) {
      salvadas++;
      t += minEnSitio * 60000;
    }
    pos = i + 1;
  }
  const imposibles = orden.filter((i) => fuera.has(i)).map((i) => fuera.get(i)!);
  return { orden: enRuta, resultados, imposibles, salvadas, recorridoMin };
}

/** ★ QUÉ OPTIMIZA, EN ESTE ORDEN EXACTO:
 *   1. maximizar cuántas paradas se salvan,
 *   2. y a igualdad, minimizar el tiempo total de recorrido.
 *  Sin la segunda regla hay empates y el orden saldría arbitrario. Si aún así empatan, gana el
 *  primero que se encuentra: se recorre en orden lexicográfico empezando por el de caducidad, así
 *  que el desempate final es «lo que caduca antes, primero», y es siempre el mismo. */
export function mejor(a: Evaluacion, b: Evaluacion): boolean {
  if (a.salvadas !== b.salvadas) return a.salvadas > b.salvadas;
  return a.recorridoMin < b.recorridoMin;
}

/** Orden por caducidad: lo que caduca antes, primero. Es el método con más de `MAX_PERMUTAR`
 *  paradas, y el punto de partida de la búsqueda exhaustiva. */
export function ordenCaducidad(paradas: ParadaCalc[]): number[] {
  return paradas
    .map((_, i) => i)
    .sort((a, b) => paradas[a].caducaMs - paradas[b].caducaMs || paradas[a].stopId - paradas[b].stopId);
}

export type Propuesta = { mejor: Evaluacion; metodo: "optimo" | "caducidad" };

/** El orden que Koru propone. FUERZA BRUTA de verdad: con `MAX_PERMUTAR` paradas o menos en el
 *  recorrido se evalúan TODAS las permutaciones, sin poda ni heurística, y gana la mejor según
 *  `mejor`. Con más, por caducidad (y la pantalla lo dice). Las imposibles no se permutan: están
 *  fuera del recorrido y no cambian nada, solo multiplicarían el trabajo. */
export function proponer(
  paradas: ParadaCalc[],
  tramos: Tramos,
  ahoraMs: number,
  minPorSalto: number,
  minEnSitio: number,
): Propuesta {
  const fuera = separarImposibles(paradas, tramos, ahoraMs, minPorSalto);
  const todas = ordenCaducidad(paradas);
  const base = todas.filter((i) => !fuera.has(i));
  // Las imposibles van al final del orden que se evalúa, para que `imposibles` salga completa.
  const conFuera = (o: number[]) => [...o, ...todas.filter((i) => fuera.has(i))];
  const ev = (o: number[]) => evaluar(conFuera(o), paradas, tramos, ahoraMs, minPorSalto, minEnSitio);
  if (base.length > MAX_PERMUTAR) return { mejor: ev(base), metodo: "caducidad" };
  let best = ev(base);
  const usado = new Array(base.length).fill(false);
  const actual: number[] = [];
  const recorrer = () => {
    if (actual.length === base.length) {
      const e = ev([...actual]);
      if (mejor(e, best)) best = e;
      return;
    }
    for (let k = 0; k < base.length; k++) {
      if (usado[k]) continue;
      usado[k] = true;
      actual.push(base[k]);
      recorrer();
      actual.pop();
      usado[k] = false;
    }
  };
  recorrer();
  return { mejor: best, metodo: "optimo" };
}

/** Caché de tramos: cada par se calcula UNA vez con `calc` (el buscador de rutas del mapa).
 *  Con 8 paradas son como mucho 72 búsquedas, y arrastrar no repite ninguna. */
export function cacheTramos(
  puntos: number[],
  calc: (desde: number, hasta: number) => Tramo,
): Tramos {
  const memo = new Map<number, Tramo>();
  return (a, b) => {
    const k = a * 1000 + b;
    if (memo.has(k)) return memo.get(k)!;
    const v = calc(puntos[a], puntos[b]);
    memo.set(k, v);
    return v;
  };
}

/** «6 h 10 m» a partir de minutos (valor absoluto). */
export function duracion(min: number): string {
  const t = Math.round(Math.abs(min));
  const h = Math.floor(t / 60);
  const m = t % 60;
  return h > 0 ? `${h} h ${m} m` : `${m} m`;
}
