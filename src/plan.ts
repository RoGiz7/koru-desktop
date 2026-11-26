// Las fórmulas del salto viven en jumpCalc.ts y se usan desde aquí: UNA fórmula, no dos.
import { isotoposSalto, saltoFatiga } from "./jumpCalc.ts";
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
  /** «▶ Voy» pulsado: hay una run abierta. El único tramo que AVISA del intel (fase 2). */
  empezada: boolean;
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
  /** La forma de viajar (`forma_viaje`). `null` = a puertas con el número del panel, como antes. */
  forma_id: number | null;
};

/** Una manera de moverse, con nombre (tabla `forma_viaje`). Solo lo DECLARADO: lo del casco se
 *  resuelve por `casco_type_id` en `jumpships.json` al calcular, nunca se copia. */
export type FormaViaje = {
  id: number;
  nombre: string;
  modo: "puertas" | "salto";
  casco_type_id: number | null;
  ciclo_cyno_min: number;
  /** De quien va POR PUERTAS: el propio casco en `puertas`, el CYNO en `salto`. */
  min_por_salto: number;
  /** Los planes que la usan (por nombre). Una ficha en uso no se borra. */
  planes: string[];
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

/** Lo que es una parada en el recorrido. Las tres de abajo son de la fase 3a, hermanas de
 *  `sin_ruta`: es TU FORMA DE VIAJAR la que no llega, no la escalación la que se pierde. Se quedan en
 *  el recorrido, marcadas, y no mueven el punto de partida. */
export type EstadoParada =
  | "salvada"
  | "perdida"
  | "sin_ruta"
  /** Más años luz de los que alcanza el casco (con Jump Drive Calibration). */
  | "fuera_alcance"
  /** El destino es alta seguridad o Pochven: ahí no se salta. */
  | "alta_sec"
  /** El CYNO no tiene ruta a puertas hasta ahí con los filtros puestos. */
  | "cyno_sin_ruta";

/** ★ EL PREDICADO ÚNICO: ¿la forma de viajar LLEGA a esta parada? (Salvada o perdida, llega: lo que
 *  se pierde es el plazo, no el camino.)
 *
 *  Todo lo que decide con eso —las muertes del tramo, lo que vigila el intel, la línea del mapa, la
 *  comparación con la otra ruta— pregunta AQUÍ y no compara `"sin_ruta"` a mano. Antes lo comparaba
 *  en siete sitios, y un estado nuevo habría pasado por cualquiera de ellos como una parada alcanzada
 *  con camino: el intel habría vigilado un tramo que no existe.
 *
 *  `switch` exhaustivo con `never`: un estado nuevo NO COMPILA hasta que alguien decide aquí si llega
 *  o no. El mismo truco que el contrato de `PlanKind` en Rust. */
export function llega(e: EstadoParada): boolean {
  switch (e) {
    case "salvada":
    case "perdida":
      return true;
    case "sin_ruta":
    case "fuera_alcance":
    case "alta_sec":
    case "cyno_sin_ruta":
      return false;
    default: {
      const nunca: never = e;
      return nunca;
    }
  }
}

/** Un salto de la pata. */
export type SaltoHecho = {
  desde: number;
  hasta: number;
  ly: number;
  isotopos: number;
  isotopo: string;
  /** Cuándo se salta (ms). El salto es instantáneo: se llega en este mismo momento. */
  salidaMs: number;
  /** Con qué quedas: cooldown (rojo) y fatiga (azul), en minutos. Según lo publicado: «~». */
  cooldownMin: number;
  fatigaMin: number;
};

/** Lo que pasó en una pata con una forma `salto`. */
export type InfoPata = {
  /** 🔧 Una LISTA aunque en la fase 3a tenga un solo elemento: el salto intermedio (3b) será un
   *  segundo elemento que pase por el mismo bucle. */
  saltos: SaltoHecho[];
  /** Quién mandó en la salida, si hubo que esperar: «esperas 16 m al cyno», «esperas 2 m de
   *  cooldown». `null` = saliste nada más acabar el sitio. Esa frase es la fase entera. */
  espera: { quien: "cyno" | "cooldown"; min: number } | null;
  /** Saltos a puertas que hizo el cyno para estar allí. */
  cynoSaltos: number;
};

export type ResultadoParada = {
  stopId: number;
  estado: EstadoParada;
  /** Saltos del tramo que llega aquí (0 si `sin_ruta`). */
  saltos: number;
  /** El tramo que llega aquí cruza un wormhole: puede haberse cerrado. */
  wormhole: boolean;
  /** Los sistemas del tramo que llega aquí, salida incluida ([] si `sin_ruta`). Fase 2: de aquí
   *  salen las muertes del tramo y lo que el intel mira hacia delante. */
  path: number[];
  llegadaMs: number;
  /** caduca − llegada, en minutos. Positivo = sobra; negativo = llegas tarde. */
  margenMin: number;
  /** Fase 3a, con una forma `salto`: los saltos, la espera y con qué quedas. */
  salto?: InfoPata;
  /** Fase 3a: los números de por qué no llega («11,2 al, y llegas a 8»). */
  noLlega?: { ly: number; alcance: number };
};

/** ★ LA FORMA DE VIAJAR, PARA EL CÁLCULO: sabe calcular UNA pata desde un estado y dar el siguiente.
 *  `evaluar` tiene UN solo bucle y las reglas del recorrido (imposibles fuera, la perdida no suma
 *  sitio, la que no llega no mueve la partida) viven en él una vez. La forma solo dice cuánto cuesta
 *  cada pata. «A puertas» es una forma más: `formaPuertas`. */
export type Pata<E> =
  | { llega: false; estado: "sin_ruta" | "fuera_alcance" | "alta_sec" | "cyno_sin_ruta"; noLlega?: { ly: number; alcance: number } }
  | {
      llega: true;
      saltos: number;
      path: number[];
      wormhole: boolean;
      /** Minutos de reloj desde que estás libre hasta que llegas (esperas incluidas). */
      viajeMin: number;
      salto?: InfoPata;
      despues: E;
    };
export type FormaCalc<E> = {
  inicial: E;
  /** `desde`/`hasta` son índices de `tramos` (0 = origen); `tMs`, cuándo estás libre para salir. */
  pata: (e: E, desde: number, hasta: number, tMs: number) => Pata<E>;
};

/** A puertas: saltos × minutos por salto, sin memoria. Es EXACTAMENTE el cálculo de las fases 1 y 2;
 *  `evaluar` la construye cuando no le dan otra, y por eso sus guiones pasan sin tocarlos. */
export function formaPuertas(tramos: Tramos, minPorSalto: number): FormaCalc<null> {
  return {
    inicial: null,
    pata: (_e, desde, hasta) => {
      const t = tramos(desde, hasta);
      if (!t) return { llega: false, estado: "sin_ruta" };
      return { llega: true, saltos: t.saltos, path: t.path, wormhole: t.wormhole, viajeMin: t.saltos * minPorSalto, despues: null };
    },
  };
}

/** Lo que necesita la forma `salto`. Todo inyectado: el cálculo es puro y se prueba con distancias
 *  de mentira. */
export type ParamsSalto = {
  /** Sistemas por índice de `tramos`: [origen, parada1, parada2…]. */
  puntos: number[];
  /** Años luz entre dos sistemas. */
  ly: (a: number, b: number) => number;
  /** ¿Se puede saltar a este sistema? (`destinoSaltable`: ni alta seguridad ni Pochven.) */
  saltable: (sys: number) => boolean;
  /** La ruta A PUERTAS del cyno: el MISMO buscador que la línea amarilla (`calcTramo`). */
  rutaCyno: (a: number, b: number) => Tramo;
  /** Dónde empieza el cyno. */
  cynoDesde: number;
  /** Alcance del casco con Jump Drive Calibration, en años luz. */
  alcanceLy: number;
  casco: { fatMult: number; fuelPerLy: number; isotope: string };
  /** Jump Fuel Conservation del que salta. */
  jfc: number;
  cicloCynoMin: number;
  cynoMinPorSalto: number;
  /** Fatiga (azul) del que salta al empezar, en minutos. */
  fatigaMin: number;
  /** Hasta cuándo dura su cooldown (rojo) al empezar. Es una COTA: ver `fatigaInicial`. */
  cooldownHastaMs: number;
  ahoraMs: number;
};

/** El estado que se arrastra de pata en pata. */
export type EstadoSalto = {
  /** Dónde está el que salta. */
  salta: number;
  /** Su fatiga en `fatMs`: baja un minuto por minuto. */
  fatMin: number;
  fatMs: number;
  cdHastaMs: number;
  /** Dónde está el cyno, y desde cuándo puede moverse (al llegar el que salta, queda clavado el ciclo). */
  cyno: number;
  cynoLibreMs: number;
};

/** ★ LOS DOS RELOJES. Cada pata sale cuando han pasado las TRES cosas: acabar el sitio anterior (`tMs`,
 *  lo pone `evaluar`), el cooldown del que salta, y que el cyno esté allí (su ciclo pendiente + sus
 *  saltos a puertas × sus minutos por salto). En la primera pata no hay ciclo pendiente.
 *
 *  Quien cruza los sistemas es el CYNO: el `path` de la pata es su ruta a puertas, y de ahí salen las
 *  muertes del tramo, «ir seguro te cuesta…» y lo que vigila el intel (fase 2). */
export function formaSalto(p: ParamsSalto): FormaCalc<EstadoSalto> {
  const memoLy = new Map<number, number>();
  const memoRuta = new Map<number, Tramo>();
  const clave = (a: number, b: number) => a * 100_000_000 + b;
  const ly = (a: number, b: number) => {
    const k = clave(a, b);
    let v = memoLy.get(k);
    if (v === undefined) memoLy.set(k, (v = p.ly(a, b)));
    return v;
  };
  const ruta = (a: number, b: number): Tramo => {
    if (a === b) return { saltos: 0, path: [a], wormhole: false };
    const k = clave(a, b);
    if (!memoRuta.has(k)) memoRuta.set(k, p.rutaCyno(a, b));
    return memoRuta.get(k)!;
  };
  return {
    inicial: {
      salta: p.puntos[0],
      fatMin: p.fatigaMin,
      fatMs: p.ahoraMs,
      cdHastaMs: p.cooldownHastaMs,
      cyno: p.cynoDesde,
      cynoLibreMs: p.ahoraMs,
    },
    pata: (e, _desde, hasta, t) => {
      const dst = p.puntos[hasta];
      // Ya estás ahí (dos paradas en el mismo sistema): no hay salto ni cyno que esperar.
      if (dst === e.salta) {
        return { llega: true, saltos: 0, path: [dst], wormhole: false, viajeMin: 0, salto: { saltos: [], espera: null, cynoSaltos: 0 }, despues: e };
      }
      if (!p.saltable(dst)) return { llega: false, estado: "alta_sec" };
      const d = ly(e.salta, dst);
      if (d > p.alcanceLy + 1e-6) return { llega: false, estado: "fuera_alcance", noLlega: { ly: d, alcance: p.alcanceLy } };
      const rc = ruta(e.cyno, dst);
      if (!rc) return { llega: false, estado: "cyno_sin_ruta" };
      const cynoEn = e.cynoLibreMs + rc.saltos * p.cynoMinPorSalto * 60000;
      const salida = Math.max(t, e.cdHastaMs, cynoEn);
      const espera =
        salida > t ? { quien: cynoEn >= e.cdHastaMs ? ("cyno" as const) : ("cooldown" as const), min: (salida - t) / 60000 } : null;
      const fatAntes = Math.max(0, e.fatMin - (salida - e.fatMs) / 60000);
      const f = saltoFatiga(d, p.casco.fatMult, fatAntes);
      return {
        llega: true,
        saltos: rc.saltos,
        path: rc.path,
        wormhole: rc.wormhole,
        viajeMin: (salida - t) / 60000,
        salto: {
          saltos: [
            {
              desde: e.salta,
              hasta: dst,
              ly: d,
              isotopos: isotoposSalto(d, p.casco.fuelPerLy, p.jfc),
              isotopo: p.casco.isotope,
              salidaMs: salida,
              cooldownMin: f.cooldown,
              fatigaMin: f.fatiga,
            },
          ],
          espera,
          cynoSaltos: rc.saltos,
        },
        despues: {
          salta: dst,
          fatMin: f.fatiga,
          fatMs: salida,
          cdHastaMs: salida + f.cooldown * 60000,
          cyno: dst,
          cynoLibreMs: salida + p.cicloCynoMin * 60000,
        },
      };
    },
  };
}

/** ★ EL ESTADO INICIAL DEL QUE SALTA, con lo que ESI da y lo que no.
 *  · Fatiga (azul): `jump_fatigue_expire_date − ahora`.
 *  · ⚠️ ESI NO DA EL TIMER ROJO. Solo el azul y `last_jump_date`. Pero el rojo nunca pasa de la
 *    décima parte del azul recién saltado (cooldown = max(1+e, F/10) y fatiga = max(10,F)·(1+e), así
 *    que cooldown ≤ fatiga/10), con tope de 30 min. De ahí una COTA honesta: puede saltar como muy
 *    tarde en `last_jump + min(30, (expire − last_jump) / 10)`. `cotaRoja` = esa cota aún no ha
 *    pasado, y la pantalla lo dice con esas palabras: es una cota, no una lectura. */
export function fatigaInicial(
  expire: string | null,
  lastJump: string | null,
  ahoraMs: number,
): { fatigaMin: number; cooldownHastaMs: number; cotaRoja: boolean } {
  const exp = expire ? Date.parse(expire) : NaN;
  const fatigaMin = Number.isFinite(exp) ? Math.max(0, (exp - ahoraMs) / 60000) : 0;
  const ult = lastJump ? Date.parse(lastJump) : NaN;
  if (!Number.isFinite(exp) || !Number.isFinite(ult)) return { fatigaMin, cooldownHastaMs: ahoraMs, cotaRoja: false };
  const cota = ult + Math.min(30, (exp - ult) / 60000 / 10) * 60000;
  return cota > ahoraMs ? { fatigaMin, cooldownHastaMs: cota, cotaRoja: true } : { fatigaMin, cooldownHastaMs: ahoraMs, cotaRoja: false };
}

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
  /** Minutos de reloj de recorrido, sin el tiempo en los sitios. A puertas, saltos × minutos por
   *  salto; saltando, lo que esperas al cyno o al cooldown (el salto es instantáneo). */
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
export function separarImposibles<E = null>(
  paradas: ParadaCalc[],
  tramos: Tramos,
  ahoraMs: number,
  minPorSalto: number,
  forma?: FormaCalc<E>,
): Map<number, Imposible> {
  // «Ni yendo directo» = con LA FORMA ELEGIDA, desde el estado inicial. Una que tu forma no alcanza
  // (fuera de alcance, alta seguridad…) NO es imposible: es de la forma, y se queda marcada.
  const f = (forma ?? formaPuertas(tramos, minPorSalto)) as FormaCalc<unknown>;
  const fuera = new Map<number, Imposible>();
  paradas.forEach((p, i) => {
    const directo = f.pata(f.inicial, 0, i + 1, ahoraMs);
    if (!directo.llega) return;
    const margenMin = (p.caducaMs - (ahoraMs + directo.viajeMin * 60000)) / 60000;
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
export function evaluar<E = null>(
  orden: number[],
  paradas: ParadaCalc[],
  tramos: Tramos,
  ahoraMs: number,
  minPorSalto: number,
  minEnSitio: number,
  forma?: FormaCalc<E>,
): Evaluacion {
  const f = (forma ?? formaPuertas(tramos, minPorSalto)) as FormaCalc<unknown>;
  const fuera = separarImposibles(paradas, tramos, ahoraMs, minPorSalto, f);
  let pos = 0; // índice de tramos: 0 = origen
  let estado = f.inicial;
  let t = ahoraMs;
  let salvadas = 0;
  let recorridoMin = 0;
  const enRuta = orden.filter((i) => !fuera.has(i));
  const resultados: ResultadoParada[] = [];
  for (const i of enRuta) {
    const p = paradas[i];
    const pata = f.pata(estado, pos, i + 1, t);
    if (!pata.llega) {
      // No mueve la partida NI el estado: no se llegó, así que la siguiente sale de donde estabas.
      resultados.push({
        stopId: p.stopId,
        estado: pata.estado,
        saltos: 0,
        wormhole: false,
        path: [],
        llegadaMs: NaN,
        margenMin: NaN,
        ...(pata.noLlega ? { noLlega: pata.noLlega } : {}),
      });
      continue;
    }
    const viaje = pata.viajeMin;
    recorridoMin += viaje;
    t += viaje * 60000;
    const margenMin = (p.caducaMs - t) / 60000;
    const salvada = margenMin >= 0;
    resultados.push({
      stopId: p.stopId,
      estado: salvada ? "salvada" : "perdida",
      saltos: pata.saltos,
      wormhole: pata.wormhole,
      path: pata.path,
      llegadaMs: t,
      margenMin,
      ...(pata.salto ? { salto: pata.salto } : {}),
    });
    if (salvada) {
      salvadas++;
      t += minEnSitio * 60000;
    }
    pos = i + 1;
    estado = pata.despues;
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
export function proponer<E = null>(
  paradas: ParadaCalc[],
  tramos: Tramos,
  ahoraMs: number,
  minPorSalto: number,
  minEnSitio: number,
  forma?: FormaCalc<E>,
): Propuesta {
  const fuera = separarImposibles(paradas, tramos, ahoraMs, minPorSalto, forma);
  const todas = ordenCaducidad(paradas);
  const base = todas.filter((i) => !fuera.has(i));
  // Las imposibles van al final del orden que se evalúa, para que `imposibles` salga completa.
  const conFuera = (o: number[]) => [...o, ...todas.filter((i) => fuera.has(i))];
  const ev = (o: number[]) => evaluar(conFuera(o), paradas, tramos, ahoraMs, minPorSalto, minEnSitio, forma);
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

/** ★ FASE 2 — «HACER ANTES OTRA»: el mejor orden en el que la parada `idx` va MÁS TARDE que ahora.
 *
 *  Para cuando cantan un hostil en el tramo que lleva a esa parada: la respuesta natural en el juego
 *  es hacer otra primero y volver luego. Lo que el panel necesita saber ANTES de proponerlo es qué
 *  cuesta, así que esto evalúa con el MISMO modelo y el MISMO criterio (`mejor`) que `proponer`.
 *
 *  ⚠️ El intel NO entra en el criterio de `proponer`: el óptimo sigue siendo «salvar más, luego
 *     menos recorrido». Un hostil es de este minuto y se mueve; meterlo en el optimizador haría que el
 *     orden propuesto bailara con cada línea del chat. Aquí solo se responde a la pregunta concreta.
 *
 *  Fuerza bruta como `proponer` (todas las permutaciones con la restricción) hasta `MAX_PERMUTAR`;
 *  por encima, cambiarla con la siguiente. `null` si ya es la última: no hay nada que hacer antes. */
export function posponer<E = null>(
  orden: number[],
  idx: number,
  paradas: ParadaCalc[],
  tramos: Tramos,
  ahoraMs: number,
  minPorSalto: number,
  minEnSitio: number,
  forma?: FormaCalc<E>,
): Evaluacion | null {
  const posActual = orden.indexOf(idx);
  if (posActual < 0 || posActual === orden.length - 1) return null;
  // Las que no están en el recorrido (las imposibles) van detrás, como en `proponer`, para que
  // `imposibles` salga completa. `evaluar` las aparta igual.
  const resto = paradas.map((_, i) => i).filter((i) => !orden.includes(i));
  const ev = (o: number[]) => evaluar([...o, ...resto], paradas, tramos, ahoraMs, minPorSalto, minEnSitio, forma);
  if (orden.length > MAX_PERMUTAR) {
    const o = [...orden];
    [o[posActual], o[posActual + 1]] = [o[posActual + 1], o[posActual]];
    return ev(o);
  }
  let best: Evaluacion | null = null;
  const usado = new Array(orden.length).fill(false);
  const actual: number[] = [];
  const recorrer = () => {
    if (actual.length === orden.length) {
      if (actual.indexOf(idx) <= posActual) return;
      const e = ev([...actual]);
      if (!best || mejor(e, best)) best = e;
      return;
    }
    for (let k = 0; k < orden.length; k++) {
      if (usado[k]) continue;
      usado[k] = true;
      actual.push(orden[k]);
      recorrer();
      actual.pop();
      usado[k] = false;
    }
  };
  recorrer();
  return best;
}

/** ★ FASE 2 — LAS MUERTES DE UN TRAMO. Un DATO, no un veredicto: cuántos sistemas del tramo tienen
 *  muertes en la última hora y cuál es el peor. La salida (`path[0]`) no cuenta: es donde ya estás,
 *  y en el tramo anterior ya contó como llegada.
 *  `null` si no hay datos de muertes: «sin datos» no es «limpio», y no se pinta como tal. */
export function muertesTramo(
  path: number[],
  kills: Map<number, number> | null,
): { sistemas: number; peor: { systemId: number; kills: number } | null } | null {
  if (!kills) return null;
  let sistemas = 0;
  let peor: { systemId: number; kills: number } | null = null;
  for (const s of path.slice(1)) {
    const k = kills.get(s) ?? 0;
    if (k <= 0) continue;
    sistemas++;
    if (!peor || k > peor.kills) peor = { systemId: s, kills: k };
  }
  return { sistemas, peor };
}

/** ★ FASE 2 — «IR SEGURO TE CUESTA X». Las paradas que el MISMO orden salva por la corta y NO por
 *  la segura: perdidas por llegar tarde, imposibles o sin ruta, da igual el motivo — la escalación
 *  se va. Es la línea que justifica la fase entera: ninguna otra herramienta puede decirla, porque
 *  ninguna tiene el reloj. */
export function cuestaIrSeguro(corta: Evaluacion, segura: Evaluacion): number[] {
  const salva = (ev: Evaluacion, id: number) => ev.resultados.some((r) => r.stopId === id && r.estado === "salvada");
  return corta.resultados.filter((r) => r.estado === "salvada" && !salva(segura, r.stopId)).map((r) => r.stopId);
}

/** Sistemas de baja o nula (sec < 0.45, el MISMO corte que `findRoute`) que cruza un tramo, sin la
 *  salida. Es lo que dice si «la segura» es segura de verdad o solo la menos mala. */
export function bajaNula(path: number[], sec: (sid: number) => number | undefined): number {
  return path.slice(1).filter((s) => (sec(s) ?? 0) < 0.45).length;
}

/** Lo avisa Escalaciones cuando cambia algo de sus filas («▶ Voy», «Hecha», «Paso»…): el plan
 *  abierto en el mapa tiene que enterarse, porque «Voy» decide qué tramo AVISA del intel. Vive aquí
 *  y no en planNav.tsx para que Escalaciones no tenga que importar la pantalla del mapa. */
export const PLAN_CAMBIADO = "koru-plan-cambiado";

/** Un hostil cantado cerca de un tramo del plan. Lo calcula el vigilante de Rust: ver
 *  `plan_intel.rs`. `aviso` dice por qué suena o no, para que el silencio se vea. */
export type PlanMarca = {
  stop_id: number;
  sys_id: number;
  system: string;
  jumps: number;
  cerca_de: number;
  cerca_de_name: string;
  ts_ms: number;
  author: string;
  message: string;
  aviso: "avisa" | "no_empezado" | "silenciado" | "alertas_apagadas";
};

/** Lo que se manda al vigilante: un tramo del plan, con los sistemas de su ruta. */
export type PlanTramoIntel = {
  stop_id: number;
  destino: string;
  sistemas: number[];
  empezado: boolean;
  /** Fase 3a: DE QUIÉN es el camino cuando no es el tuyo (saltando, el del cyno). Sin él, los
   *  avisos dicen «en tu camino», como en la fase 2. */
  quien?: string;
};

/** `plan_paradas_empezadas`: paradas con «▶ Voy» y la run abierta, de cualquier plan. */
export type ParadaEmpezada = {
  stop_id: number;
  system_id: number;
  system_name: string;
  caduca_at: string;
  /** ¿Su plan va saltando? Entonces el camino vigilado es el del cyno (fase 3a). */
  salto: boolean;
  cyno_character_id: number | null;
};

/** ★ FASE 2 · LO QUE SE VIGILA CON EL PLAN CERRADO. Cuando vuelas estás en EVE, no en el mapa de
 *  Koru: la vigilancia no puede depender de que el panel esté abierto. Con el panel cerrado no hay
 *  orden ni tramos sin empezar que enseñar, así que solo se mira lo que AVISA: el camino desde
 *  donde estás hasta cada parada empezada, con el mismo buscador que la línea amarilla.
 *
 *  ⚠️ Sin ubicación o sin ruta, el tramo se queda en el DESTINO solo y no se tira: un hostil en el
 *     sistema de la escalación sigue sonando. Tirarlo apagaría la vigilancia en silencio justo
 *     cuando ESI tarda en decir dónde estás. Una caducada sale (B2) aunque la run siga abierta. */
export function tramosEmpezados(
  empezadas: ParadaEmpezada[],
  aqui: number | null,
  calc: (desde: number, hasta: number) => Tramo,
  nameOf: (sid: number) => string,
  ahoraMs: number,
  /** Fase 3a: si el plan de esta parada va SALTANDO, quien cruza el camino es el CYNO: de dónde sale
   *  y cómo se llama. `undefined` = a puertas, el camino es el tuyo desde `aqui`, como en la fase 2. */
  camino?: (e: ParadaEmpezada) => { desde: number | null; quien: string } | undefined,
): PlanTramoIntel[] {
  const out: PlanTramoIntel[] = [];
  for (const e of empezadas) {
    const caduca = Date.parse(e.caduca_at);
    if (!(caduca > ahoraMs)) continue;
    const c = camino?.(e);
    // Sin saber dónde está el cyno se SUPONE que sale de donde tú: se dice en el panel.
    const desde = c ? c.desde ?? aqui : aqui;
    const t = desde != null ? calc(desde, e.system_id) : null;
    out.push({
      stop_id: e.stop_id,
      destino: nameOf(e.system_id) || e.system_name,
      sistemas: t ? t.path : [e.system_id],
      empezado: true,
      ...(c ? { quien: c.quien } : {}),
    });
  }
  return out;
}

/** ESI rehace `system_kills` cada hora; con el refresco del mapa (cada pocos minutos mientras el plan
 *  está abierto) un dato bueno nunca pasa de ~1 h. Si pasa de esto es que el refresco FALLA. */
export const MUERTES_VIEJAS_MIN = 75;

/** ¿Puede la frase seguir diciendo «en la última hora»? `null` = sí; si no, los minutos que tiene el
 *  dato. A las seis horas «en la última hora» es falso EN LA PROPIA FRASE: la pantalla tiene que
 *  cambiarla, no solo añadir una nota. */
export function muertesViejas(cargadoMs: number | null, ahoraMs: number): number | null {
  if (cargadoMs == null) return null;
  const min = Math.floor((ahoraMs - cargadoMs) / 60000);
  return min > MUERTES_VIEJAS_MIN ? min : null;
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
