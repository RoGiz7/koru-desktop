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
  /** Fase 3b: el salto intermedio que aceptó el piloto (`null` = ninguno). Una declaración suya:
   *  el cálculo la revalida en cada pata, ver `formaSalto`. */
  via_system_id: number | null;
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
  /** Quién mandó en ESTE salto, si hubo que esperar, y DÓNDE (`en`: el sistema del que sale):
   *  «esperas 16 m al cyno», «esperas 21 m en X al cyno». `null` = saliste en cuanto pudiste.
   *  ⚠️ Es POR SALTO y obligatoria a propósito. Vivía en `InfoPata`, una por pata, y la pantalla
   *     la pintaba solo en el salto 0: con un intermedio, la espera del segundo habría salido
   *     «sales nada más acabar» sin que nada avisara. Aquí, quien construye un salto no puede
   *     olvidarla y quien la lee no puede leer la de otro. */
  espera: { quien: "cyno" | "cooldown"; min: number; en: number } | null;
  /** Con qué quedas: cooldown (rojo) y fatiga (azul), en minutos. Según lo publicado: «~». */
  cooldownMin: number;
  fatigaMin: number;
};

/** Lo que pasó en una pata con una forma `salto`. */
export type InfoPata = {
  /** 🔧 Una LISTA aunque en la fase 3a tenga un solo elemento: el salto intermedio (3b) será un
   *  segundo elemento que pase por el mismo bucle. */
  saltos: SaltoHecho[];
  /** Saltos a puertas que hizo el cyno para estar allí (con intermedio, los dos tramos). */
  cynoSaltos: number;
  /** Fase 3b: el intermedio por el que se pasó (el que aceptó el piloto). */
  via?: number;
  /** Fase 3b: había un intermedio GUARDADO y se ignoró porque el destino está al alcance directo.
   *  Se dice en la fila: tirarlo en silencio sería tirar algo que el piloto puso. */
  viaIgnorada?: number;
};

/** Fase 3b: por qué un sistema NO sirve de intermedio. Un motivo con su número, nunca un genérico. */
export type FalloIntermedio =
  | { motivo: "mismo" }
  | { motivo: "alta_sec" }
  /** Desde donde está el que salta, el intermedio queda más lejos que el alcance. */
  | { motivo: "lejos_ida"; ly: number; alcance: number }
  /** Desde el intermedio, el destino queda más lejos que el alcance. */
  | { motivo: "lejos_vuelta"; ly: number; alcance: number }
  /** El cyno no tiene ruta a puertas hasta el intermedio, o de ahí al destino. */
  | { motivo: "cyno_sin_ruta" };

/** Fase 3b: lo que vale un intermedio que SÍ sirve: los dos saltos y las dos rutas del cyno. */
export type IntermedioValido = {
  via: number;
  lyIda: number;
  lyVuelta: number;
  rutaIda: NonNullable<Tramo>;
  rutaVuelta: NonNullable<Tramo>;
};

/** Los números de por qué no llega («11,2 al, y llegas a 8»), y desde dónde: la propuesta de
 *  intermedio se busca desde AQUÍ (dónde está el que salta y dónde el cyno), no desde el origen. */
export type NoLlega = {
  ly: number;
  alcance: number;
  desde: number;
  cyno: number;
  /** Fase 3b: había un intermedio guardado y NO sirve desde aquí. Se dice con el número. */
  viaNoSirve?: { via: number; fallo: FalloIntermedio };
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
  noLlega?: NoLlega;
};

/** ★ LA FORMA DE VIAJAR, PARA EL CÁLCULO: sabe calcular UNA pata desde un estado y dar el siguiente.
 *  `evaluar` tiene UN solo bucle y las reglas del recorrido (imposibles fuera, la perdida no suma
 *  sitio, la que no llega no mueve la partida) viven en él una vez. La forma solo dice cuánto cuesta
 *  cada pata. «A puertas» es una forma más: `formaPuertas`. */
export type Pata<E> =
  | { llega: false; estado: "sin_ruta" | "fuera_alcance" | "alta_sec" | "cyno_sin_ruta"; noLlega?: NoLlega }
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
  /** Fase 3b: el intermedio ACEPTADO para llegar a cada punto, por índice de `tramos` (el 0, el
   *  origen, no tiene). `null`/ausente = ninguno. Se revalida en cada pata: ver `formaSalto`. */
  vias?: (number | null)[];
  /** La caché de distancias y rutas del cyno, si quien llama la quiere COMPARTIR entre formas y
   *  entre minutos (ver `cacheSalto`). Sin ella, cada `formaSalto` estrena la suya. */
  cache?: CacheSalto;
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
  const cx = contextoIntermedio(p);

  /** ★ UN SALTO, el único código que hay. Con intermedio se llama DOS veces, y la segunda sale del
   *  estado que dejó la primera: no hay un segundo cálculo que pueda discrepar del primero. */
  const saltar = (e: EstadoSalto, dst: number, d: number, rc: NonNullable<Tramo>, t: number) => {
    const cynoEn = e.cynoLibreMs + rc.saltos * p.cynoMinPorSalto * 60000;
    const salida = Math.max(t, e.cdHastaMs, cynoEn);
    const espera =
      salida > t
        ? { quien: cynoEn >= e.cdHastaMs ? ("cyno" as const) : ("cooldown" as const), min: (salida - t) / 60000, en: e.salta }
        : null;
    const fatAntes = Math.max(0, e.fatMin - (salida - e.fatMs) / 60000);
    const f = saltoFatiga(d, p.casco.fatMult, fatAntes);
    const hecho: SaltoHecho = {
      desde: e.salta,
      hasta: dst,
      ly: d,
      isotopos: isotoposSalto(d, p.casco.fuelPerLy, p.jfc),
      isotopo: p.casco.isotope,
      salidaMs: salida,
      espera,
      cooldownMin: f.cooldown,
      fatigaMin: f.fatiga,
    };
    const despues: EstadoSalto = {
      salta: dst,
      fatMin: f.fatiga,
      fatMs: salida,
      cdHastaMs: salida + f.cooldown * 60000,
      cyno: dst,
      cynoLibreMs: salida + p.cicloCynoMin * 60000,
    };
    return { hecho, despues, salida };
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
        return { llega: true, saltos: 0, path: [dst], wormhole: false, viajeMin: 0, salto: { saltos: [], cynoSaltos: 0 }, despues: e };
      }
      if (!p.saltable(dst)) return { llega: false, estado: "alta_sec" };
      const guardada = p.vias?.[hasta] ?? null;
      const d = cx.ly(e.salta, dst);
      // ★ LA REGLA DEL INTERMEDIO GUARDADO, la misma para el orden en uso y para cada orden que prueba
      //   la fuerza bruta. Se aceptó para llegar desde UN sitio, y el orden puede cambiar:
      //   · destino al alcance directo → directo, y el guardado se IGNORA diciéndolo (`viaIgnorada`);
      //   · si no, el guardado se usa solo si SIRVE DESDE AQUÍ: `probarIntermedio`, la misma función
      //     que valida los candidatos y el «Otro…»;
      //   · si no sirve, «fuera de alcance» con el motivo y su número (`viaNoSirve`).
      //   Nunca se usa en silencio uno que no vale, ni se tira en silencio uno que el piloto puso.
      if (d > p.alcanceLy + 1e-6) {
        const noLlega: NoLlega = { ly: d, alcance: p.alcanceLy, desde: e.salta, cyno: e.cyno };
        if (guardada == null) return { llega: false, estado: "fuera_alcance", noLlega };
        const v = probarIntermedio(cx, e.salta, e.cyno, guardada, dst);
        if (!v.ok) {
          return { llega: false, estado: "fuera_alcance", noLlega: { ...noLlega, viaNoSirve: { via: guardada, fallo: v.fallo } } };
        }
        // En el intermedio NO hay sitio: el segundo salto sale en cuanto puede después del primero
        // (su cooldown y el cyno en el destino), no después de un `minEnSitio`.
        const s1 = saltar(e, v.via, v.lyIda, v.rutaIda, t);
        const s2 = saltar(s1.despues, dst, v.lyVuelta, v.rutaVuelta, s1.salida);
        return {
          llega: true,
          saltos: v.rutaIda.saltos + v.rutaVuelta.saltos,
          // La ruta del cyno ENTERA: hasta el intermedio y de ahí al destino. De aquí comen las
          // muertes del tramo y el intel (fase 2).
          path: [...v.rutaIda.path, ...v.rutaVuelta.path.slice(1)],
          wormhole: v.rutaIda.wormhole || v.rutaVuelta.wormhole,
          viajeMin: (s2.salida - t) / 60000,
          salto: { saltos: [s1.hecho, s2.hecho], cynoSaltos: v.rutaIda.saltos + v.rutaVuelta.saltos, via: v.via },
          despues: s2.despues,
        };
      }
      const rc = cx.ruta(e.cyno, dst);
      if (!rc) return { llega: false, estado: "cyno_sin_ruta" };
      const s1 = saltar(e, dst, d, rc, t);
      return {
        llega: true,
        saltos: rc.saltos,
        path: rc.path,
        wormhole: rc.wormhole,
        viajeMin: (s1.salida - t) / 60000,
        salto: { saltos: [s1.hecho], cynoSaltos: rc.saltos, ...(guardada != null ? { viaIgnorada: guardada } : {}) },
        despues: s1.despues,
      };
    },
  };
}

/** Lo que necesitan `probarIntermedio` y la búsqueda: distancias y rutas del cyno, con caché.
 *  ⚠️ La caché es POR SISTEMA (a, b), no por índice de parada: el intermedio no es una parada, y
 *     con índices la ruta hasta él no tendría dónde guardarse. */
export type ContextoIntermedio = {
  ly: (a: number, b: number) => number;
  ruta: (a: number, b: number) => Tramo;
  saltable: (sys: number) => boolean;
  alcanceLy: number;
};
export function contextoIntermedio(
  p: Pick<ParamsSalto, "ly" | "rutaCyno" | "saltable" | "alcanceLy" | "cache">,
): ContextoIntermedio {
  const c = p.cache ?? cacheSalto(p.ly, p.rutaCyno);
  return { ly: c.ly, ruta: c.ruta, saltable: p.saltable, alcanceLy: p.alcanceLy };
}

/** Distancias y rutas del cyno, con memoria, por par de SISTEMAS. */
export type CacheSalto = {
  ly: (a: number, b: number) => number;
  ruta: (a: number, b: number) => Tramo;
};
/** ★ Una caché que solo sabe de sistemas, NO de la hora. Las rutas dependen del grafo, del modo y de
 *  los evitados (todo eso cambia la identidad del buscador que se le pasa) y las distancias, del
 *  mapa; ninguna del reloj. Por eso quien la crea la ata a ESO y no a la forma de viajar: la forma
 *  se rehace cada minuto porque lleva «ahora» (fatiga, cooldown, salida), y con la caché dentro las
 *  rutas se tiraban y se volvían a buscar enteras cada minuto. */
export function cacheSalto(ly: (a: number, b: number) => number, rutaCyno: (a: number, b: number) => Tramo): CacheSalto {
  const memoLy = new Map<number, number>();
  const memoRuta = new Map<number, Tramo>();
  const clave = (a: number, b: number) => a * 100_000_000 + b;
  return {
    ly: (a, b) => {
      const k = clave(a, b);
      let v = memoLy.get(k);
      if (v === undefined) memoLy.set(k, (v = ly(a, b)));
      return v;
    },
    ruta: (a, b) => {
      if (a === b) return { saltos: 0, path: [a], wormhole: false };
      const k = clave(a, b);
      if (!memoRuta.has(k)) memoRuta.set(k, rutaCyno(a, b));
      return memoRuta.get(k)!;
    },
  };
}

/** ★ FASE 3b · LA ÚNICA FUNCIÓN QUE DICE SI UN SISTEMA SIRVE DE INTERMEDIO. La usan los candidatos de
 *  la búsqueda, el «Otro…» del piloto y el intermedio GUARDADO en cada pata. Si fueran tres, el
 *  guardado podría pasar por una que el candidato no pasó.
 *  `desde` = dónde está el que salta; `cyno` = dónde está el cyno. El motivo es el PRIMERO que
 *  falla, en este orden: el mismo sitio, a dónde no se salta, los dos tramos al alcance, y las dos
 *  rutas del cyno a puertas (las caras, al final). */
export function probarIntermedio(
  cx: ContextoIntermedio,
  desde: number,
  cyno: number,
  via: number,
  dst: number,
): ({ ok: true } & IntermedioValido) | { ok: false; fallo: FalloIntermedio } {
  if (via === desde || via === dst) return { ok: false, fallo: { motivo: "mismo" } };
  if (!cx.saltable(via)) return { ok: false, fallo: { motivo: "alta_sec" } };
  const lyIda = cx.ly(desde, via);
  if (!(lyIda <= cx.alcanceLy + 1e-6)) return { ok: false, fallo: { motivo: "lejos_ida", ly: lyIda, alcance: cx.alcanceLy } };
  const lyVuelta = cx.ly(via, dst);
  if (!(lyVuelta <= cx.alcanceLy + 1e-6)) return { ok: false, fallo: { motivo: "lejos_vuelta", ly: lyVuelta, alcance: cx.alcanceLy } };
  const rutaIda = cx.ruta(cyno, via);
  if (!rutaIda) return { ok: false, fallo: { motivo: "cyno_sin_ruta" } };
  const rutaVuelta = cx.ruta(via, dst);
  if (!rutaVuelta) return { ok: false, fallo: { motivo: "cyno_sin_ruta" } };
  return { ok: true, via, lyIda, lyVuelta, rutaIda, rutaVuelta };
}

/** Lo que sale de buscar un intermedio: el elegido o, si no hay, EL MOTIVO EXACTO. */
export type BusquedaIntermedio =
  | ({ tipo: "propuesta"; candidatos: number; validos: number } & IntermedioValido)
  /** Más lejos que dos saltos enteros: «son N al y con dos saltos llegas a M». */
  | { tipo: "ni_con_dos"; ly: number; alcanceDos: number }
  /** Ningún sistema al alcance de los dos lados al que se pueda saltar. */
  | { tipo: "sin_sistema" }
  /** Los hay, pero el cyno no tiene ruta a puertas hasta ninguno (o de ninguno al destino). */
  | { tipo: "cyno_sin_ruta"; candidatos: number };

/** Cuántos candidatos se prueban entre cesión y cesión. Cada uno son hasta dos rutas del buscador
 *  del mapa (6–20 ms cada una, medido el 28-11): con 5, un lote no pasa de ~200 ms en el peor caso. */
export const LOTE_INTERMEDIO = 5;

/** ★ FASE 3b · LA BÚSQUEDA DEL INTERMEDIO. Solo a demanda («Buscar intermedio»), nunca sola.
 *
 *  Medido el 28-11 con el mapa real: hasta 58 candidatos en baja densa y ~1,1 s en modo seguro,
 *  casi todo en las rutas. Por eso es un GENERADOR: cada `yield` cede el paso tras
 *  `LOTE_INTERMEDIO` candidatos; la pantalla la reparte en varios ticks y la cancela si cambia algo.
 *  El guion la corre de un tirón (`buscarIntermedioYa`).
 *
 *  Candidatos: saltables, al alcance desde donde está el que salta y con el destino al alcance
 *  desde ellos, y con ruta del cyno a puertas hasta ellos y de ellos al destino.
 *  ⚠️ Fuera ANTES de buscar los que no tienen ninguna conexión en el grafo de rutas (`conectado`):
 *     en el mapa hay 217 saltables sin una sola puerta, nunca sirven, y preguntarle al buscador por
 *     cada uno cuesta ~25 ms en recorrer el grafo entero para decir que no. SIN tope de
 *     candidatos: el elegido es el mejor de TODOS, no de los más cercanos.
 *  El elegido: menos saltos a puertas del cyno en total (ida + vuelta); a igualdad, menos años luz
 *  sumados; a igualdad, el id más bajo. Con los mismos datos, siempre el mismo. */
export function* buscarIntermedio(
  cx: ContextoIntermedio,
  sistemas: Iterable<number>,
  conectado: (sys: number) => boolean,
  desde: number,
  cyno: number,
  dst: number,
): Generator<number, BusquedaIntermedio, void> {
  const total = cx.ly(desde, dst);
  if (total > 2 * cx.alcanceLy + 1e-6) return { tipo: "ni_con_dos", ly: total, alcanceDos: 2 * cx.alcanceLy };
  // La geometría primero: es barata (~1 ms para todo el mapa) y no toca el buscador de rutas.
  const geo: number[] = [];
  let sinConexion = 0;
  for (const m of sistemas) {
    if (m === desde || m === dst || !cx.saltable(m)) continue;
    if (!(cx.ly(desde, m) <= cx.alcanceLy + 1e-6) || !(cx.ly(m, dst) <= cx.alcanceLy + 1e-6)) continue;
    if (!conectado(m)) {
      sinConexion++;
      continue;
    }
    geo.push(m);
  }
  // Solo hay sistemas sin conexión: existen, pero el cyno no llega a ninguno. Eso es lo que se dice.
  if (geo.length === 0) return sinConexion > 0 ? { tipo: "cyno_sin_ruta", candidatos: sinConexion } : { tipo: "sin_sistema" };
  geo.sort((a, b) => a - b);
  let mejor: IntermedioValido | null = null;
  let validos = 0;
  for (let i = 0; i < geo.length; i++) {
    if (i > 0 && i % LOTE_INTERMEDIO === 0) yield i;
    const v = probarIntermedio(cx, desde, cyno, geo[i], dst);
    if (!v.ok) continue;
    validos++;
    if (!mejor) {
      mejor = v;
      continue;
    }
    const pv = v.rutaIda.saltos + v.rutaVuelta.saltos;
    const pm = mejor.rutaIda.saltos + mejor.rutaVuelta.saltos;
    const lv = v.lyIda + v.lyVuelta;
    const lm = mejor.lyIda + mejor.lyVuelta;
    // `geo` va por id creciente: el último desempate (id más bajo) es quedarse con el que ya estaba.
    if (pv < pm || (pv === pm && lv < lm - 1e-9)) mejor = v;
  }
  if (!mejor) return { tipo: "cyno_sin_ruta", candidatos: geo.length + sinConexion };
  return { tipo: "propuesta", candidatos: geo.length, validos, ...mejor };
}

/** La búsqueda de un tirón: para el guion. La pantalla la reparte en lotes. */
export function buscarIntermedioYa(...args: Parameters<typeof buscarIntermedio>): BusquedaIntermedio {
  const g = buscarIntermedio(...args);
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
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

/** Un REPORTE es una línea del chat: quién, cuándo y qué. El vigilante saca una marca por cada tramo
 *  al que toca (y por cada sistema que nombra), así que el mismo reporte sale repetido. */
const claveReporte = (m: PlanMarca) => `${m.ts_ms}|${m.author}|${m.message}`;

/** La cabecera: cuántos reportes DISTINTOS hay en el camino y en cuántos tramos. Antes contaba las
 *  marcas, y un reporte que tocaba tres tramos salía como «3 avisos». */
export function resumenMarcas(marcas: PlanMarca[]): { reportes: number; tramos: number } {
  return { reportes: new Set(marcas.map(claveReporte)).size, tramos: new Set(marcas.map((m) => m.stop_id)).size };
}

/** Dentro de un tramo: primero lo que está EN el camino (0 saltos), luego por saltos. A igualdad, lo
 *  más reciente arriba, y luego por sistema: el orden no puede bailar entre dos refrescos. */
export function ordenarMarcas(ms: PlanMarca[]): PlanMarca[] {
  return [...ms].sort((a, b) => a.jumps - b.jumps || b.ts_ms - a.ts_ms || a.sys_id - b.sys_id);
}

/** Si TODAS las marcas de un tramo tienen el mismo motivo para sonar o no, ese motivo (se dice una
 *  vez en el tramo); si difieren, `null` (cada una lleva el suyo). */
export function avisoComun(ms: PlanMarca[]): PlanMarca["aviso"] | null {
  if (ms.length === 0) return null;
  return ms.every((m) => m.aviso === ms[0].aviso) ? ms[0].aviso : null;
}

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
  /** Quien salta en su plan (solo saltando): dónde está decide si el camino aún pasa por el intermedio. */
  salta_character_id: number | null;
  /** Fase 3b: el intermedio aceptado (solo saltando). Con el panel cerrado se usa TAL CUAL: ver
   *  `caminoVigilado`. */
  via_system_id: number | null;
};

/** ★ FASE 3b · EL CAMINO QUE SE VIGILA HASTA UNA PARADA EMPEZADA. Una sola regla para el panel
 *  abierto y el cerrado (antes cada uno hacía `calc(desde, destino)` y los dos se saltaban el
 *  intermedio: el intel miraba un camino por el que el cyno no iba a pasar).
 *  · Sin intermedio, o con el que salta YA en el intermedio: `desde → destino`, como en la 3a.
 *  · Con intermedio y el que salta aún no está en él: `desde → intermedio → destino`.
 *  · Sin saber dónde está el que salta: el camino LARGO, por el intermedio. Vigilar de más es el
 *    lado seguro; de menos, un hostil en el camino que no suena.
 *  ⚠️ Sin ruta en un trozo, se queda el OTRO trozo y el destino: nunca se tira nada en silencio. Sin
 *     ninguna ruta, el intermedio y el destino. Y sin intermedio ni ruta, el destino solo (fase 2). */
export function caminoVigilado(
  desde: number | null,
  dst: number,
  via: number | null,
  saltaEn: number | null,
  calc: (desde: number, hasta: number) => Tramo,
): number[] {
  if (via == null || via === dst || saltaEn === via) {
    const t = desde != null ? calc(desde, dst) : null;
    return t ? t.path : [dst];
  }
  const ida = desde != null ? calc(desde, via) : null;
  const vuelta = calc(via, dst);
  if (ida && vuelta) return [...ida.path, ...vuelta.path.slice(1)];
  if (vuelta) return vuelta.path; // ya empieza en el intermedio y acaba en el destino
  if (ida) return [...ida.path, dst];
  return [via, dst];
}

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
  camino?: (e: ParadaEmpezada) => { desde: number | null; quien: string; saltaEn?: number | null } | undefined,
): PlanTramoIntel[] {
  const out: PlanTramoIntel[] = [];
  for (const e of empezadas) {
    const caduca = Date.parse(e.caduca_at);
    if (!(caduca > ahoraMs)) continue;
    const c = camino?.(e);
    // Sin saber dónde está el cyno se SUPONE que sale de donde tú: se dice en el panel.
    const desde = c ? c.desde ?? aqui : aqui;
    // Fase 3b: el intermedio solo cuenta saltando (a puertas, Rust ya lo manda vacío).
    const via = c ? e.via_system_id ?? null : null;
    out.push({
      stop_id: e.stop_id,
      destino: nameOf(e.system_id) || e.system_name,
      sistemas: caminoVigilado(desde, e.system_id, via, c?.saltaEn ?? null, calc),
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
