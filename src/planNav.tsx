// ★★ EL PLAN EN NAVEGACIÓN — el orden, los márgenes y el arrastre. El cálculo vive en `plan.ts`;
// esto es la pantalla y el puente con el planificador del mapa.
//
// Se planifica en Escalaciones (qué entra en el plan) y se mira AQUÍ, al lado de la línea
// amarilla, porque los márgenes salen del mismo grafo que la dibuja.
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getLang, tr } from "./i18n";
import { SystemSearch } from "./map";
import type { RouteMode } from "./mapRoute";
import type { Character, IntelStatus, JumpShip, NeSystem } from "./types";
import { destinoSaltable } from "./jumpCalc";
import { esFaltaPermiso } from "./errores";
import { loadJson } from "./staticJson";
import {
  MAX_PERMUTAR,
  PLAN_CAMBIADO,
  bajaNula,
  cacheTramos,
  cuestaIrSeguro,
  duracion,
  evaluar,
  muertesTramo,
  muertesViejas,
  llega,
  formaSalto,
  cacheSalto,
  caminoVigilado,
  resumenMarcas,
  ordenarMarcas,
  avisoComun,
  fatigaInicial,
  type FormaViaje,
  type FormaCalc,
  type EstadoSalto,
  type SaltoHecho,
  posponer,
  proponer,
  type Evaluacion,
  type ParadaCalc,
  type ParadaCargada,
  type PlanCargado,
  type PlanMarca,
  type PlanTramoIntel,
  type PilotoPlan,
  type PerfilSalto,
  dondeEsta,
  sistemaDe,
  skillsDeSalto,
  resumenTiempo,
  puertasCyno,
  duracionCyno,
  tipoCynoPorDefecto,
  proponerNave,
  avisoNave,
  candidatosPapeles,
  type CynoFit,
  type DatosSaltoPiloto,
  type MotivoPapel,
  type CandidatosPapel,
  type TipoCyno,
  type Donde,
  type ResultadoParada,
  type Tramo,
  buscarIntermedio,
  contextoIntermedio,
  probarIntermedio,
  type BusquedaIntermedio,
  type FalloIntermedio,
} from "./plan";

/** Un número por función, para meter en una clave «el buscador de rutas cambió». `calcTramo` cambia
 *  de identidad cuando cambian el grafo, el modo o los evitados, que es justo lo que invalida una
 *  propuesta de intermedio. */
const idsFn = new WeakMap<object, number>();
let ultimoIdFn = 0;
function idDe(f: object): number {
  const v = idsFn.get(f);
  if (v !== undefined) return v;
  idsFn.set(f, ++ultimoIdFn);
  return ultimoIdFn;
}

/** Fase 3b: una búsqueda de intermedio de UNA parada, atada a la clave con la que se lanzó. Si la
 *  clave de la fila deja de coincidir (grafo, modo, evitados, orden, ficha…), no se enseña: unas
 *  puertas del cyno contadas con el modo de antes son mentir con un número bien puesto. */
type BuscaIntermedio = {
  clave: string;
  /** Hay un recorrido en curso (por lotes). */
  buscando: boolean;
  /** Candidatos probados hasta ahora (mientras busca). */
  hechos: number;
  res: BusquedaIntermedio | null;
  /** El «Otro…» del piloto: su sistema y, si no sirve, por qué. Va aparte de la búsqueda. */
  otro: { via: number; fallo: FalloIntermedio | null } | null;
};


/** Por qué una marca del intel suena o no. El silencio se DICE: un tramo marcado que no suena tiene
 *  que verse marcado, no limpio. */
function textoAviso(a: PlanMarca["aviso"]): string {
  switch (a) {
    case "avisa":
      return `🔊 ${tr("suena: has salido hacia aquí")}`;
    case "no_empezado":
      return `🔕 ${tr("marcado, no suena: no has pulsado «Voy» en esta")}`;
    case "silenciado":
      return `🔕 ${tr("marcado, no suena: el sistema está silenciado")}`;
    case "alertas_apagadas":
      return `🔕 ${tr("marcado, no suena: Intel en vivo está apagado")}`;
  }
}

/** El nombre de un tipo de cyno, por idioma: lo único que dice su desplegable. */
function nombreTipo(t: TipoCyno | null): string {
  const en = getLang() === "en";
  return t === "covert" ? "Covert" : t === "industrial" ? "Industrial" : en ? "Standard" : "Normal";
}

/** Por qué no se sabe dónde está el cyno, y qué se supone. Frase entera por idioma. */
function textoDondeNoSeSabe(pj: string, d: Donde): string {
  const en = getLang() === "en";
  const motivo = "noSeSabe" in d ? d.noSeSabe : "sin_dato";
  const porque =
    motivo === "sin_permiso"
      ? en ? `${pj} hasn't granted the location permission (esi-location.read_location.v1)` : `${pj} no ha concedido el permiso de ubicación (esi-location.read_location.v1)`
      : motivo === "no_esta"
        ? en ? `${pj} isn't among your characters in Koru` : `${pj} no está entre tus personajes de Koru`
        : en ? `ESI hasn't said where ${pj} is yet` : `ESI aún no ha dicho dónde está ${pj}`;
  return en ? `${porque}: the cyno is assumed to start where the jumper does (the origin).` : `${porque}: se supone que el cyno sale de donde el que salta (el origen).`;
}

/** «hace 3 min» / «3 min ago». Sin `tr()` porque el ORDEN cambia de un idioma a otro: mismo
 *  motivo que `edad()` en overlay.tsx. */
/** El catálogo de naves de salto y generadores de cyno (`extract_jumpships.py`). */
type Catalogo = { ships: JumpShip[]; cynos: { id: number; name: string; cycleMin: number }[] };

/** Un decimal con la coma o el punto del idioma: «11,2 al». */
function unDecimal(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString(getLang(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "∞";
}
/** Minutos cortos con su decimal cuando importa: un cooldown de 2,5 m no puede salir «3 m». */
function minutos(m: number): string {
  return m < 10 ? `${unDecimal(m)} m` : duracion(m);
}

function haceMin(ts: number, ahora: number): string {
  const m = Math.max(0, Math.round((ahora - ts) / 60000));
  return getLang() === "en" ? `${m} min ago` : `hace ${m} min`;
}

const MIN_SALTO_KEY = "koru-plan-min-salto";
const MIN_SITIO_KEY = "koru-plan-min-sitio";
/** ~1 min por salto a puertas: alinear, warp y gate de un crucero sin prisas. 45 min en el sitio:
 *  lo que tarda una escalación media. Los dos se ven y se cambian en el propio panel. */
const DEF_MIN_SALTO = 1;
const DEF_MIN_SITIO = 45;

function leerNum(key: string, def: number): number {
  const v = Number(localStorage.getItem(key) ?? "");
  return Number.isFinite(v) && v >= 0 && localStorage.getItem(key) != null ? v : def;
}

/** El texto del motivo por el que una parada no resuelve. Ver `Db::plan_cargar`. */
function textoFallo(p: ParadaCargada): string {
  return p.fallo === "kind_desconocido"
    ? `${tr("Tipo de parada desconocido")} «${p.kind}»: ${tr("este Koru no sabe leerla")}`
    : `«${p.kind}» #${p.ref_id} ${tr("ya no existe y su borrado no limpió el plan")}`;
}

/** Por qué una parada resuelta ya no entra en el cálculo. Las de venta no llevan su estado crudo
 *  («en_venta», «cobrada»…): lo que importa aquí es que la corre el comprador. */
function textoEstado(estado: string): string {
  if (["en_venta", "cobrada", "entregada"].includes(estado)) return tr("vendida: la corre el comprador");
  return tr(estado);
}

export function PlanNav(props: {
  planId: number;
  /** Sube cada vez que alguien pide abrir el plan: fuerza recargar aunque el id sea el mismo. */
  nonce: number;
  systems: NeSystem[];
  hereSystemId: number | null;
  nameOf: (sid: number) => string;
  /** El buscador de rutas del mapa: MISMO grafo, modo y evitados que la línea amarilla. Con
   *  `modo` se pide otro modo sobre ese mismo grafo (fase 2: la comparación corta / segura). */
  calcTramo: (desde: number, hasta: number, modo?: RouteMode) => Tramo;
  /** El modo con el que se pinta la línea («Cómo rutar»). */
  routeMode: RouteMode;
  /** Muertes de la última hora por sistema (`get_system_kills`, ship + pod). `null` = sin datos. */
  kills: Map<number, number> | null;
  /** Cuándo llegó `kills` (ms) y el error del último refresco, si falló. */
  killsAt: number | null;
  killsErr: string;
  /** Los tramos que tiene que mirar el vigilante mientras este panel está abierto; `null` al cerrarlo
   *  (el mapa pasa entonces a vigilar solo las paradas empezadas). Quien llama a `plan_intel_set` es
   *  el mapa, que está siempre montado: ver «QUÉ CAMINO MIRA EL VIGILANTE» en map.tsx. */
  onTramosIntel: (t: PlanTramoIntel[] | null) => void;
  /** Si el vigilante no recibió los tramos o no se pudieron leer las empezadas. */
  intelError: string;
  /** Tus personajes, para los papeles (quién salta, quién pone el cyno). */
  characters: Character[];
  /** Dónde están: de aquí sale dónde está el cyno. */
  /** TODOS los personajes con sus permisos (ver `PilotoPlan`), no solo el elegido arriba. */
  pilotos: PilotoPlan[];
  /** Pinta las paradas en el planificador del mapa: [origen, parada1, parada2…]. Saltando,
   *  [donde está el cyno, parada1, parada2…]: la línea amarilla es la ruta del cyno. */
  onPintar: (stops: number[]) => void;
  /** Fase 3a: los saltos (pares desde → hasta) para pintarlos aparte; `null` si el plan no salta. */
  onSaltos: (s: [number, number][] | null) => void;
  /** Fase 3b: ¿tiene el sistema alguna salida en el grafo de rutas? Los que no, fuera de la búsqueda
   *  de intermedio antes de preguntar al buscador (ver `buscarIntermedio`). */
  conectado: (sid: number) => boolean;
  /** Las paradas que tiene AHORA el planificador, para saber si la línea sigue siendo la del plan. */
  rutaActual: (number | null)[];
  /** Mientras se intercepta a un piloto la ruta es suya: el plan no la pisa, y se dice. */
  intercepting: boolean;
  focusSystem: (sid: number) => void;
  onCerrar: () => void;
}) {
  const { planId, nonce, systems, hereSystemId, nameOf, calcTramo, routeMode, kills, killsAt, killsErr, onTramosIntel, intelError, characters, pilotos, onPintar, onSaltos, conectado, rutaActual, intercepting, focusSystem, onCerrar } = props;
  const [cargado, setCargado] = useState<PlanCargado | null>(null);
  const [error, setError] = useState("");
  const [minSalto, setMinSalto] = useState(() => leerNum(MIN_SALTO_KEY, DEF_MIN_SALTO));
  const [minSitio, setMinSitio] = useState(() => leerNum(MIN_SITIO_KEY, DEF_MIN_SITIO));
  // Un latido por minuto: los márgenes dependen de «ahora» y tienen que bajar solos.
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setAhora(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  async function recargar() {
    try {
      setCargado(await invoke<PlanCargado>("plan_cargar", { planId }));
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    void recargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId, nonce]);
  // «▶ Voy», «Hecha» o «Paso» en Escalaciones: el mapa sigue montado y este panel abierto, así que
  // sin esto el tramo empezado no se enteraría hasta reabrir el plan — y no sonaría.
  useEffect(() => {
    const h = () => void recargar();
    window.addEventListener(PLAN_CAMBIADO, h);
    return () => window.removeEventListener(PLAN_CAMBIADO, h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  // ⚠️ Las que no resuelven se CANTAN también en consola, además de en pantalla: es un fallo de
  //    otro sitio (un borrado que no limpió) y quien desarrolla tiene que poder verlo sin abrir esto.
  useEffect(() => {
    for (const p of cargado?.paradas ?? []) if (p.fallo) console.error(`[plan ${planId}] ${textoFallo(p)}`);
  }, [cargado, planId]);

  const plan = cargado?.plan ?? null;
  const origen = plan?.origen_system_id ?? hereSystemId;

  // ==== FASE 3a · LA FORMA DE VIAJAR Y LOS PAPELES ====
  const [formas, setFormas] = useState<FormaViaje[]>([]);
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  async function recargarFormas() {
    try {
      setFormas(await invoke<FormaViaje[]>("forma_listar"));
    } catch (e) {
      setError(`${tr("No se pudieron leer las formas de viajar")}: ${String(e)}`);
    }
  }
  useEffect(() => {
    void recargarFormas();
    void loadJson<Catalogo>("/jumpships.json", { ships: [], cynos: [] }).then(setCatalogo);
  }, []);
  // ★ Parte B (28-11): de quién puede hacer qué y cuánto dura el cyno. Todo del SDE o de la BD; nada de ESI.
  const [cynoFit, setCynoFit] = useState<CynoFit | null>(null);
  const [nivelPide, setNivelPide] = useState<Partial<Record<TipoCyno, number>>>({});
  useEffect(() => {
    // Un catálogo que no carga NO es «ningún casco monta nada»: `loadJson` devuelve el vacío y
    // `duracionCyno` lo dice (`sin_catalogo`); aquí se deja rastro.
    void loadJson<CynoFit>("/cyno_fit.json", { cynos: [], durationMult: {} }).then((f) => {
      if (f.cynos.length === 0) console.error("[plan] cyno_fit.json vacío o sin cargar: la duración del cyno no se puede calcular");
      setCynoFit(f);
      // El nivel de Cynosural Field Theory que pide cada tipo, de `skill_reqs.json`, no de memoria.
      void loadJson<Record<string, [number, number][]>>("/skill_reqs.json", {}).then((r) => {
        const n: Partial<Record<TipoCyno, number>> = {};
        for (const c of f.cynos) {
          const req = (r[String(c.id)] ?? []).find(([sk]) => sk === 21603);
          if (req) n[c.tipo] = req[1];
        }
        setNivelPide(n);
      });
    });
  }, []);
  const forma = plan?.forma_id != null ? formas.find((f) => f.id === plan.forma_id) ?? null : null;
  const saltando = forma?.modo === "salto";
  // Sin casco en el catálogo no hay alcance ni consumo: se cuenta a puertas Y SE DICE (abajo).
  const casco = saltando && catalogo ? catalogo.ships.find((s) => s.id === forma!.casco_type_id) ?? null : null;
  // ⚠️ LOS MINUTOS POR SALTO TIENEN UN SOLO DUEÑO. Sin ficha, el número del panel, como siempre. Con
  //    ficha, el de la ficha, y el panel enseña ESE (no deja editar el suyo): un número que decide si
  //    llegas no puede estar duplicado ni escondido.
  const minSaltoEf = forma ? forma.min_por_salto : minSalto;
  const salta = plan?.salta_character_id ?? null;
  const cyno = plan?.cyno_character_id ?? null;
  const nombrePj = (id: number) => characters.find((c) => c.character_id === id)?.name ?? `#${id}`;
  // Lo que Koru tiene guardado de cada personaje (naves de salto que posee, nivel de CFT), sin ESI.
  const [datosSalto, setDatosSalto] = useState<DatosSaltoPiloto[] | null>(null);
  const catalogoIds = useMemo(() => (catalogo?.ships ?? []).map((x) => x.id), [catalogo]);
  useEffect(() => {
    if (catalogoIds.length === 0) return;
    invoke<DatosSaltoPiloto[]>("plan_datos_salto", { tipos: catalogoIds })
      .then(setDatosSalto)
      .catch((e) => setError(`${getLang() === "en" ? "Couldn't read what Koru has stored about your characters" : "No se pudo leer lo que Koru tiene guardado de tus personajes"}: ${String(e)}`));
  }, [catalogoIds, planId, nonce]);
  const naveDe = (id: number | null) => (id == null ? null : pilotos.find((x) => x.id === id) ?? null);
  const cynoDonde = dondeEsta(pilotos, cyno);
  const saltaDonde = dondeEsta(pilotos, salta);
  const cynoLoc = sistemaDe(cynoDonde);
  const saltaLoc = sistemaDe(saltaDonde);
  // Del que salta: sus niveles y su fatiga. Cada fallo dice cuál fue (sin permiso ≠ ESI caído).
  const [perfil, setPerfil] = useState<PerfilSalto | null>(null);
  const [perfilErr, setPerfilErr] = useState("");
  const [fatiga, setFatiga] = useState<{ expire: string | null; last: string | null } | null>(null);
  const [fatigaErr, setFatigaErr] = useState<{ permiso: boolean; msg: string } | null>(null);
  useEffect(() => {
    setPerfil(null);
    setPerfilErr("");
    setFatiga(null);
    setFatigaErr(null);
    if (!saltando || salta == null) return;
    let vivo = true;
    invoke<PerfilSalto>("get_jump_profile", { characterId: salta })
      .then((p) => vivo && setPerfil(p))
      .catch((e) => vivo && setPerfilErr(String(e)));
    invoke<{ jump_fatigue_expire_date: string | null; last_jump_date: string | null }>("get_fatigue", { characterId: salta })
      .then((f) => vivo && setFatiga({ expire: f.jump_fatigue_expire_date, last: f.last_jump_date }))
      .catch((e) => vivo && setFatigaErr({ permiso: esFaltaPermiso(e), msg: String(e) }));
    return () => {
      vivo = false;
    };
  }, [saltando, salta]);

  // Las que entran en el cálculo, en el orden guardado; el resto se enseña aparte con su motivo.
  const { calc, fuera } = useMemo(() => {
    const calc: { p: ParadaCargada; c: ParadaCalc }[] = [];
    const fuera: ParadaCargada[] = [];
    for (const p of cargado?.paradas ?? []) {
      const r = p.resuelta;
      if (r && r.por_hacer && r.system_id != null) {
        calc.push({ p, c: { stopId: p.id, systemId: r.system_id, caducaMs: Date.parse(r.caduca_at) } });
      } else fuera.push(p);
    }
    return { calc, fuera };
  }, [cargado]);
  const paradas = useMemo(() => calc.map((x) => x.c), [calc]);

  const puntosKey = origen == null ? "" : [origen, ...paradas.map((p) => p.systemId)].join(",");
  const tramos = useMemo(
    () => (origen == null ? null : cacheTramos([origen, ...paradas.map((p) => p.systemId)], calcTramo)),
    // `puntosKey` resume origen + sistemas; `calcTramo` cambia cuando cambia el grafo, el modo o
    // los evitados, y entonces hay que volver a buscar todos los tramos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [puntosKey, calcTramo],
  );

  // La forma `salto` para el cálculo. Sin ficha `salto` (o sin casco en el catálogo): `undefined`, y
  // `evaluar` cuenta a puertas con `minSaltoEf`, que es exactamente lo de las fases 1 y 2.
  const sysIdx = useMemo(() => new Map(systems.map((x) => [x.id, x] as const)), [systems]);
  const ini = fatigaInicial(fatiga?.expire ?? null, fatiga?.last ?? null, ahora);
  // Sin «quién salta», o sin poder leer sus skills, se suponen a V: se dice en `supuestos`.
  // Sin leerlas, V, y `skillsSalto.motivo` lo dice (en `supuestos`). Nunca un 0 que parezca un dato.
  const skillsSalto = skillsDeSalto(perfil, perfilErr);
  const jdc = skillsSalto.jdc;
  const jfc = skillsSalto.jfc;
  const alcance = casco ? casco.range * (1 + 0.2 * jdc) : 0;
  // ★ D1 · cuánto dura el cyno de ESTE plan: el tipo guardado y la nave en la que está ahora quien lo enciende.
  const cascoCyno = naveDe(cyno)?.ship_type_id ?? null;
  const durCyno = forma ? duracionCyno(forma, cascoCyno, catalogo?.cynos ?? [], cynoFit) : null;
  const lyEntre = (a: number, b: number) => {
    const A = sysIdx.get(a);
    const B = sysIdx.get(b);
    return A && B ? Math.hypot(B.gx - A.gx, B.gy - A.gy, B.gz - A.gz) : Infinity;
  };
  const saltableSys = (s: number) => {
    const x = sysIdx.get(s);
    return !!x && destinoSaltable(x.s, x.r);
  };
  // ★ LAS RUTAS DEL CYNO, CON MEMORIA QUE NO CADUCA CON EL RELOJ. Dependen del grafo, del modo y de
  //   los evitados, que es exactamente lo que cambia la identidad de `calcTramo`; nunca de la hora.
  //   Antes vivían dentro de `formaSalto`, que se rehace cada minuto por «ahora», y se volvían a
  //   buscar enteras cada minuto. Una por modo: la del panel (`base`, el de la línea amarilla) y las
  //   dos de la comparación corta / segura.
  const caches = useMemo(
    () => ({
      base: cacheSalto(lyEntre, (a, b) => calcTramo(a, b)),
      shortest: cacheSalto(lyEntre, (a, b) => calcTramo(a, b, "shortest")),
      safer: cacheSalto(lyEntre, (a, b) => calcTramo(a, b, "safer")),
    }),
    // `lyEntre` solo lee `sysIdx`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [calcTramo, sysIdx],
  );
  const cacheDe = (modo?: RouteMode) =>
    modo === "shortest" ? caches.shortest : modo === "safer" ? caches.safer : modo ? undefined : caches.base;
  // Fase 3b: los intermedios ACEPTADOS, por índice de `tramos` (el 0 es el origen).
  const viasGuardadas = useMemo(() => [null, ...calc.map((x) => x.p.via_system_id ?? null)], [calc]);
  /** `prueba`: el cálculo con UN intermedio de más, sin guardarlo, para enseñar lo que costaría
   *  aceptarlo. Es la misma forma y el mismo `evaluar`: el precio que se enseña es el que saldría. */
  const formaDe = (modo?: RouteMode, prueba?: { stopId: number; via: number }): FormaCalc<EstadoSalto> | undefined => {
    if (!saltando || !casco || origen == null) return undefined;
    const vias = prueba
      ? viasGuardadas.map((v, i) => (i > 0 && paradas[i - 1].stopId === prueba.stopId ? prueba.via : v))
      : viasGuardadas;
    return formaSalto({
      puntos: [origen, ...paradas.map((p) => p.systemId)],
      ly: lyEntre,
      saltable: saltableSys,
      vias,
      rutaCyno: (a, b) => calcTramo(a, b, modo),
      cache: cacheDe(modo),
      // Sin saber dónde está el cyno, se supone que sale de donde el que salta: se dice.
      cynoDesde: cynoLoc ?? origen,
      alcanceLy: alcance,
      casco: { fatMult: casco.fatMult, fuelPerLy: casco.fuelPerLy, isotope: casco.isotope },
      jfc,
      // D1: CALCULADA (tipo × el casco de quien lo enciende), o el número a mano.
      cicloCynoMin: durCyno!.min,
      cynoMinPorSalto: forma!.min_por_salto,
      fatigaMin: ini.fatigaMin,
      cooldownHastaMs: ini.cooldownHastaMs,
      ahoraMs: ahora,
    });
  };
  const formaKey = JSON.stringify([forma, casco?.id, cynoLoc, jdc, jfc, fatiga, ahora, puntosKey, viasGuardadas, durCyno?.min]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const formaCalc = useMemo(() => formaDe(), [formaKey, calcTramo, sysIdx]);
  const propuesta = useMemo(
    () => (tramos ? proponer(paradas, tramos, ahora, minSaltoEf, minSitio, formaCalc) : null),
    [tramos, paradas, ahora, minSaltoEf, minSitio, formaCalc],
  );
  const manual = useMemo(
    () => (tramos ? evaluar(paradas.map((_, i) => i), paradas, tramos, ahora, minSaltoEf, minSitio, formaCalc) : null),
    [tramos, paradas, ahora, minSaltoEf, minSitio, formaCalc],
  );
  // ★ El orden manual MANDA cuando existe. El propuesto se sigue calculando para decir si salvaría
  //   más: se calla la imposición, nunca el dato (misma regla que silenciar un sistema en el intel).
  const actual: Evaluacion | null = plan?.orden_manual ? manual : propuesta?.mejor ?? null;

  // ==== FASE 2 · MITAD A: lo que cuesta ir seguro ====
  // El orden EN USO con TODAS las paradas (las imposibles detrás): lo que es imposible por una ruta
  // puede no serlo por otra, así que la comparación no puede partir de `actual.orden`, que ya las quitó.
  const ordenEnUso = useMemo(() => {
    if (!actual) return null;
    if (plan?.orden_manual) return paradas.map((_, i) => i);
    return [...actual.orden, ...paradas.map((_, i) => i).filter((i) => !actual.orden.includes(i))];
  }, [actual, plan?.orden_manual, paradas]);
  const tramosModo = (modo: RouteMode) =>
    origen == null ? null : cacheTramos([origen, ...paradas.map((p) => p.systemId)], (a, b) => calcTramo(a, b, modo));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tramosCorta = useMemo(() => tramosModo("shortest"), [puntosKey, calcTramo]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tramosSegura = useMemo(() => tramosModo("safer"), [puntosKey, calcTramo]);
  // Saltando, «corta / segura» es la ruta del CYNO: es él quien cruza los sistemas.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const formaCorta = useMemo(() => formaDe("shortest"), [formaKey, calcTramo, sysIdx]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const formaSegura = useMemo(() => formaDe("safer"), [formaKey, calcTramo, sysIdx]);
  const seguro = useMemo(() => {
    if (!ordenEnUso || !tramosCorta || !tramosSegura || paradas.length === 0) return null;
    const corta = evaluar(ordenEnUso, paradas, tramosCorta, ahora, minSaltoEf, minSitio, formaCorta);
    const segura = evaluar(ordenEnUso, paradas, tramosSegura, ahora, minSaltoEf, minSitio, formaSegura);
    // Por si con la segura OTRO orden salvara más que el tuyo: entonces parte de lo que «cuesta» es
    // el orden y no la ruta, y hay que decirlo.
    const mejorSegura = proponer(paradas, tramosSegura, ahora, minSaltoEf, minSitio, formaSegura).mejor;
    return { corta, segura, mejorSegura };
  }, [ordenEnUso, tramosCorta, tramosSegura, paradas, ahora, minSaltoEf, minSitio, formaCorta, formaSegura]);
  const secDe = useMemo(() => {
    const m = new Map(systems.map((x) => [x.id, x.s] as const));
    return (sid: number) => m.get(sid);
  }, [systems]);

  // ==== FASE 2 · MITAD B: el intel mira hacia delante ====
  // Los tramos del recorrido que aún no has hecho (las hechas ya no están en `calc`). El EMPEZADO
  // (el del «▶ Voy») se cuenta desde donde estás AHORA: lo que ya pasaste no entra.
  const tramosIntel: PlanTramoIntel[] = useMemo(() => {
    if (!actual) return [];
    const out: PlanTramoIntel[] = [];
    for (const r of actual.resultados) {
      if (!llega(r.estado)) continue;
      const p = calc.find((x) => x.p.id === r.stopId)!;
      // Caducada mientras el panel estaba abierto (aún no se ha recargado): ya no es camino.
      if (p.c.caducaMs <= ahora) continue;
      const res = p.p.resuelta!;
      let sistemas = r.path;
      // El empezado se cuenta desde donde está quien CRUZA el camino: tú a puertas; saltando, el
      // cyno (y si no se sabe dónde está, se supone que donde el que salta).
      const desde = saltando ? cynoLoc ?? saltaLoc ?? hereSystemId : hereSystemId;
      if (res.empezada && desde != null) {
        // Fase 3b: la MISMA regla que con el panel cerrado. Aquí el intermedio ya viene validado
        // por el cálculo (`r.salto.via` solo existe si se usó); el guardado que no sirve no entra.
        sistemas = caminoVigilado(desde, p.c.systemId, saltando ? r.salto?.via ?? null : null, saltaLoc, calcTramo);
      }
      out.push({
        stop_id: r.stopId,
        destino: nameOf(p.c.systemId) || res.system_name,
        sistemas,
        empezado: res.empezada,
        ...(saltando ? { quien: cyno != null ? nombrePj(cyno) : tr("el cyno") } : {}),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actual, calc, hereSystemId, calcTramo, nameOf, ahora, saltando, cynoLoc, saltaLoc, cyno]);
  const tramosIntelKey = JSON.stringify(tramosIntel);
  useEffect(() => {
    onTramosIntel(tramosIntel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tramosIntelKey]);
  // Al cerrar el panel NO se deja de vigilar: el mapa vuelve a las paradas con la run abierta.
  useEffect(
    () => () => onTramosIntel(null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [marcas, setMarcas] = useState<PlanMarca[]>([]);
  useEffect(() => {
    invoke<PlanMarca[]>("plan_intel_marcas")
      .then(setMarcas)
      .catch((e) => setError(`${tr("No se pudieron leer las marcas del intel")}: ${String(e)}`));
    const un = listen<PlanMarca[]>("plan-intel", (e) => setMarcas(e.payload));
    return () => {
      void un.then((f) => f());
    };
  }, []);
  // ¿Está mirando alguien? Sin vigilante no hay marcas, y «sin marcas» NO puede parecer «camino limpio».
  const [vigilante, setVigilante] = useState<IntelStatus | null>(null);
  useEffect(() => {
    const leer = () =>
      invoke<IntelStatus>("get_intel_status")
        .then(setVigilante)
        .catch((e) => setError(`${tr("No se pudo leer el estado del intel")}: ${String(e)}`));
    void leer();
    const t = window.setInterval(leer, 10_000);
    return () => window.clearInterval(t);
  }, []);
  const vigila =
    !!vigilante && vigilante.collecting && !vigilante.idle_reason && !vigilante.last_error && vigilante.graph_systems > 0;
  const idsPlan = new Set(tramosIntel.map((t) => t.stop_id));
  // Sin vigilante, las marcas que queden son de antes: no se pintan como si fueran de ahora.
  const marcasPlan = vigila ? marcas.filter((m) => idsPlan.has(m.stop_id)) : [];

  // ---- pintar en el mapa ----
  // Sin ninguna parada en el recorrido (todas imposibles) no hay línea del plan: "" y no se vigila.
  // Saltando, la línea amarilla es la del CYNO: sale de donde está él (o del origen, si no se sabe,
  // que es lo que supone el cálculo).
  const salidaLinea = formaCalc ? cynoLoc ?? origen : origen;
  const pintarKey =
    actual && salidaLinea != null && !intercepting && actual.resultados.some((r) => llega(r.estado))
      ? [
          salidaLinea,
          // Fase 3b: con intermedio, la línea del cyno pasa por él (es por donde va de verdad).
          ...actual.resultados
            .filter((r) => llega(r.estado))
            .flatMap((r) => {
              const sys = paradas.find((p) => p.stopId === r.stopId)!.systemId;
              return r.salto?.via != null ? [r.salto.via, sys] : [sys];
            }),
        ].join(",")
      : "";
  useEffect(() => {
    if (!pintarKey) return;
    const stops = pintarKey.split(",").map(Number);
    if (stops.length >= 2) onPintar(stops);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pintarKey]);
  const saltosKey =
    formaCalc && actual && !intercepting
      ? JSON.stringify(actual.resultados.flatMap((r) => (r.salto?.saltos ?? []).map((s) => [s.desde, s.hasta])))
      : "";
  useEffect(() => {
    onSaltos(saltosKey ? (JSON.parse(saltosKey) as [number, number][]) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saltosKey]);
  useEffect(
    () => () => onSaltos(null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ⚠️ La columna «Paradas» sigue siendo editable con el plan abierto. Si alguien toca la ruta a
  //    mano, la línea amarilla deja de ser la del plan y los márgenes de aquí contarían otra cosa
  //    que lo dibujado al lado. No se le bloquea —puede querer mirar un desvío—, pero se dice.
  const lineaEsDelPlan = !pintarKey || rutaActual.filter((s) => s != null).join(",") === pintarKey;

  // ==== ★ FASE 3b · EL SALTO INTERMEDIO ====
  // La propuesta NO se calcula sola: cuesta hasta ~1 s en baja densa con la ruta segura (medido el
  // 28-11) y la paga quien pulsa «Buscar intermedio». Se reparte en lotes con `setTimeout(0)` para
  // no congelar el mapa, y se ATA a una clave: si cambia el grafo, el modo, los evitados, el orden,
  // la ficha o los intermedios guardados, la propuesta deja de enseñarse y vuelve el botón; si cambia
  // a mitad de búsqueda, se cancela en el siguiente lote.
  const claveCalc = JSON.stringify([
    routeMode,
    idDe(calcTramo),
    idDe(conectado),
    forma?.id,
    forma?.ciclo_cyno_min,
    forma?.min_por_salto,
    casco?.id,
    alcance,
    cynoLoc,
    puntosKey,
    ordenEnUso,
    viasGuardadas,
  ]);
  const clavesFila = useMemo(() => {
    const m = new Map<number, string>();
    if (!formaCalc) return m;
    for (const r of actual?.resultados ?? []) {
      if (r.estado === "fuera_alcance" && r.noLlega) m.set(r.stopId, `${claveCalc}|${r.stopId}|${r.noLlega.desde}|${r.noLlega.cyno}`);
    }
    return m;
  }, [actual, claveCalc, formaCalc]);
  const [busca, setBusca] = useState<Record<number, BuscaIntermedio>>({});
  // La búsqueda en curso mira AQUÍ en cada lote si su clave sigue siendo la de la fila.
  const clavesVivas = useRef(new Map<number, string>());
  useEffect(() => {
    clavesVivas.current = clavesFila;
    // Lo que ya no casa se tira del estado, no solo de la pantalla: que no reaparezca si la clave
    // volviera a coincidir por casualidad con números de otro momento.
    setBusca((b) => {
      const vivas = Object.entries(b).filter(([id, x]) => clavesFila.get(Number(id)) === x.clave);
      return vivas.length === Object.keys(b).length ? b : Object.fromEntries(vivas);
    });
  }, [clavesFila]);
  useEffect(
    () => () => {
      clavesVivas.current = new Map(); // al cerrar el panel, la búsqueda en curso se para sola
    },
    [],
  );
  const busquedaDe = (stopId: number): BuscaIntermedio | null => {
    const b = busca[stopId];
    return b && b.clave === clavesFila.get(stopId) ? b : null;
  };
  // La búsqueda comparte la caché del panel: las rutas que ya buscó el cálculo no se repiten, y las
  // de la búsqueda le sirven al precio que se enseña después.
  const cxIntermedio = () =>
    contextoIntermedio({ ly: lyEntre, saltable: saltableSys, rutaCyno: (a, b) => calcTramo(a, b), alcanceLy: alcance, cache: caches.base });
  function buscarVia(r: ResultadoParada) {
    const clave = clavesFila.get(r.stopId);
    const nl = r.noLlega;
    const dst = paradas.find((p) => p.stopId === r.stopId)?.systemId;
    if (!clave || !nl || dst == null) return;
    const g = buscarIntermedio(cxIntermedio(), systems.map((x) => x.id), conectado, nl.desde, nl.cyno, dst);
    setBusca((b) => ({ ...b, [r.stopId]: { clave, buscando: true, hechos: 0, res: null, otro: b[r.stopId]?.clave === clave ? b[r.stopId].otro : null } }));
    const paso = () => {
      if (clavesVivas.current.get(r.stopId) !== clave) return; // cambió algo: cancelada
      const x = g.next();
      if (x.done) {
        setBusca((b) =>
          b[r.stopId]?.clave === clave ? { ...b, [r.stopId]: { ...b[r.stopId], buscando: false, hechos: 0, res: x.value } } : b,
        );
        return;
      }
      setBusca((b) => (b[r.stopId]?.clave === clave ? { ...b, [r.stopId]: { ...b[r.stopId], hechos: x.value } } : b));
      window.setTimeout(paso, 0);
    };
    window.setTimeout(paso, 0);
  }
  /** «Otro…»: el sistema del piloto, validado con la MISMA función que los candidatos. Dos rutas. */
  function probarOtro(r: ResultadoParada, via: number) {
    const clave = clavesFila.get(r.stopId);
    const nl = r.noLlega;
    const dst = paradas.find((p) => p.stopId === r.stopId)?.systemId;
    if (!clave || !nl || dst == null) return;
    const v = probarIntermedio(cxIntermedio(), nl.desde, nl.cyno, via, dst);
    setBusca((b) => {
      const prev = b[r.stopId]?.clave === clave ? b[r.stopId] : null;
      return {
        ...b,
        [r.stopId]: { clave, buscando: prev?.buscando ?? false, hechos: prev?.hechos ?? 0, res: prev?.res ?? null, otro: { via, fallo: v.ok ? null : v.fallo } },
      };
    });
  }
  const [otroAbierto, setOtroAbierto] = useState<number | null>(null);
  async function fijarVia(stopId: number, via: number | null) {
    try {
      await invoke("plan_via", { stopId, systemId: via });
    } catch (e) {
      setError(String(e));
    }
    await recargar();
  }
  /** Lo que costaría aceptar `via` para esa parada: el MISMO cálculo con el intermedio puesto, sin
   *  guardarlo. Así el precio que se enseña es exactamente el que saldría al pulsar «Usar». */
  //  ⚠️ En un `useMemo`: cada vista rehace las rutas del cyno de todo el orden, y sin memo se
  //     repetiría en cada render (el arrastre de filas renderiza a cada movimiento del ratón).
  const vistas = useMemo(() => {
    const m = new Map<number, { via: number; delPiloto: boolean; r: ResultadoParada | null }>();
    if (!tramos || !ordenEnUso) return m;
    for (const [id, b] of Object.entries(busca)) {
      const stopId = Number(id);
      if (b.clave !== clavesFila.get(stopId)) continue;
      // Si el piloto puso uno que sirve, se enseña el suyo; si no, el propuesto.
      const delPiloto = !!b.otro && !b.otro.fallo;
      const via = delPiloto ? b.otro!.via : b.res?.tipo === "propuesta" ? b.res.via : null;
      if (via == null) continue;
      const f = formaDe(undefined, { stopId, via });
      const r = f ? evaluar(ordenEnUso, paradas, tramos, ahora, minSaltoEf, minSitio, f).resultados.find((x) => x.stopId === stopId) ?? null : null;
      m.set(stopId, { via, delPiloto, r });
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca, clavesFila, formaKey, tramos, ordenEnUso, minSaltoEf, minSitio, calcTramo]);

  // ---- reordenar (arrastre y flechas) ----
  /** Guarda un orden nuevo de las paradas del cálculo. Se aplica YA en pantalla (los márgenes se
   *  recalculan al instante) y luego se guarda; si guardar falla, se recarga lo que hay y se dice. */
  async function reordenar(ordenIdx: number[]) {
    if (!cargado) return;
    // Las imposibles no están en `ordenIdx` (no están en el recorrido), pero son del plan: van
    // detrás, o `plan_reordenar` rechazaría el orden por incompleto.
    const nuevas = ordenIdx.map((i) => calc[i].p);
    const imposibles = calc.filter((_, i) => !ordenIdx.includes(i)).map((x) => x.p);
    const todas = [...nuevas, ...imposibles, ...fuera];
    setCargado({ plan: { ...cargado.plan, orden_manual: true }, paradas: todas.map((p, i) => ({ ...p, orden: i })) });
    try {
      await invoke("plan_reordenar", { planId, stopIds: todas.map((p) => p.id) });
    } catch (e) {
      setError(String(e));
      await recargar();
    }
  }
  function mover(desde: number, hasta: number) {
    if (!actual || desde === hasta) return;
    const o = [...actual.orden];
    const [x] = o.splice(desde, 1);
    o.splice(hasta, 0, x);
    void reordenar(o);
  }
  async function usarPropuesto() {
    if (!propuesta) return;
    try {
      // Se guarda el propuesto como orden de la tabla Y se devuelve el mando a Koru: así, si
      // luego vuelves a arrastrar, partes de lo que estabas viendo.
      await invoke("plan_reordenar", {
        planId,
        stopIds: [
          ...propuesta.mejor.orden.map((i) => calc[i].p.id),
          ...calc.filter((_, i) => !propuesta.mejor.orden.includes(i)).map((x) => x.p.id),
          ...fuera.map((p) => p.id),
        ],
      });
      await invoke("plan_orden_propuesto", { planId });
    } catch (e) {
      setError(String(e));
    }
    await recargar();
  }
  async function quitar(stopId: number) {
    try {
      await invoke("plan_quitar", { stopId });
    } catch (e) {
      setError(String(e));
    }
    await recargar();
  }
  async function fijarOrigen(sid: number | null) {
    try {
      await invoke("plan_origen", { planId, systemId: sid });
    } catch (e) {
      setError(String(e));
    }
    await recargar();
  }

  // ★ ARRASTRE CON EVENTOS DE PUNTERO, no con el drag&drop de HTML5: en Windows, Tauri intercepta
  //   el arrastre nativo de la ventana (`dragDropEnabled`, activo por defecto) y `onDrop` no llega
  //   nunca. Cambiar esa opción tocaría toda la ventana principal por una lista de 8 filas.
  const filas = useRef<(HTMLLIElement | null)[]>([]);
  const [arrastre, setArrastre] = useState<{ desde: number; sobre: number } | null>(null);
  function sobreQue(y: number): number {
    let idx = 0;
    filas.current.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (y > r.top + r.height / 2) idx = i + 1;
    });
    return idx;
  }

  const nombrePlan = plan ? plan.nombre || `${tr("Plan")} #${plan.id}` : "";
  const comparacion = (() => {
    if (!plan?.orden_manual || !propuesta || !manual) return null;
    const p = propuesta.mejor;
    if (p.salvadas > manual.salvadas)
      return {
        aviso: true,
        texto: `${tr("El orden propuesto salvaría")} ${p.salvadas} ${tr("de")} ${paradas.length}; ${tr("el tuyo salva")} ${manual.salvadas}.`,
      };
    if (p.salvadas === manual.salvadas && p.recorridoMin < manual.recorridoMin)
      return {
        aviso: false,
        texto: `${tr("El orden propuesto salva las mismas con")} ${duracion(manual.recorridoMin - p.recorridoMin)} ${tr("menos de recorrido.")}`,
      };
    return { aviso: false, texto: tr("Tu orden salva lo mismo que el propuesto.") };
  })();

  // ---- fase 2: textos de pantalla ----
  const nombreParada = (stopId: number) => {
    const x = calc.find((c) => c.p.id === stopId)!;
    return nameOf(x.c.systemId) || x.p.resuelta!.system_name;
  };
  const bajaNulaEv = (ev: Evaluacion) => ev.resultados.reduce((n, r) => n + bajaNula(r.path, secDe), 0);
  // ¿La segura sale IGUAL que la corta? Entonces no hay alternativa y no se pinta una comparación vacía.
  const mismaRuta =
    !!seguro &&
    JSON.stringify(seguro.corta.resultados.map((r) => [r.stopId, r.path])) ===
      JSON.stringify(seguro.segura.resultados.map((r) => [r.stopId, r.path])) &&
    seguro.corta.imposibles.length === seguro.segura.imposibles.length;
  /** La misma parada por la OTRA ruta: la segura si pintas la corta (o la menos segura), la corta si
   *  pintas la segura. Es lo que se lee debajo de cada parada. */
  const otra = seguro ? (routeMode === "safer" ? seguro.corta : seguro.segura) : null;
  const etiquetaOtra = routeMode === "safer" ? tr("por la corta") : tr("por la segura");
  function lineaOtra(r: ResultadoParada) {
    if (!otra || mismaRuta) return null;
    const o = otra.resultados.find((x) => x.stopId === r.stopId);
    if (!o) {
      return otra.imposibles.some((i) => i.stopId === r.stopId) ? `${etiquetaOtra}: ${tr("no llegas ni yendo directo")}` : null;
    }
    if (o.path.join(",") === r.path.join(",")) return null;
    if (!llega(o.estado)) return `${etiquetaOtra}: ${textoNoLlega(o)}`;
    const d = o.saltos - r.saltos;
    const saltos = `${d > 0 ? "+" : ""}${d} ${tr("puertas")}`;
    return o.estado === "salvada"
      ? `${etiquetaOtra}: ${saltos}, ${tr("llegas con")} ${duracion(o.margenMin)} ${tr("de sobra")}`
      : `${etiquetaOtra}: ${saltos}, ${tr("llegas")} ${duracion(o.margenMin)} ${tr("tarde")}`;
  }
  function lineaMuertes(r: ResultadoParada) {
    const mk = muertesTramo(r.path, kills);
    // «Sin datos» no es «limpio»: se dice cuál de las dos es.
    if (!mk) return `☠ ${tr("sin datos de muertes")}${killsErr ? ` (${killsErr})` : ""}`;
    // Un dato viejo NO puede decir «en la última hora»: la frase cambia, no se le pega una nota.
    const viejo = muertesViejas(killsAt, ahora);
    const en = getLang() === "en";
    let pre = "☠ ";
    if (viejo != null) {
      const d = duracion(viejo);
      const fallo = killsErr ? (en ? ", couldn't refresh" : ", no se pudo refrescar") : "";
      pre = `☠ ${en ? `data from ${d} ago` : `dato de hace ${d}`}${fallo}: `;
      if (!mk.peor) return pre + tr("ningún sistema con muertes en esa hora");
    } else if (!mk.peor) return `☠ ${tr("ningún sistema con muertes en la última hora")}`;
    // Frase entera por idioma y en SINGULAR cuando es uno («1 sistemas con muertes» se veía así).
    // Con uno solo, «el peor» sobra: es ese.
    const n = mk.sistemas;
    const peor = `${nameOf(mk.peor.systemId)} (${mk.peor.kills})`;
    const hora = viejo != null ? (en ? "in that hour" : "en esa hora") : en ? "in the last hour" : "en la última hora";
    if (n === 1) return pre + (en ? `1 system with kills ${hora}: ${peor}` : `1 sistema con muertes ${hora}: ${peor}`);
    return pre + (en ? `${n} systems with kills ${hora}; the worst, ${peor}` : `${n} sistemas con muertes ${hora}; el peor, ${peor}`);
  }
  /** «recorrido 2 h 10 m» a puertas; saltando, «esperas 21 m» o «sin esperas». */
  function textoResumenTiempo(t: ReturnType<typeof resumenTiempo>): string {
    const en = getLang() === "en";
    if (t.tipo === "recorrido") return en ? `travel ${duracion(t.min)}` : `recorrido ${duracion(t.min)}`;
    if (t.tipo === "esperas") return en ? `waiting ${duracion(t.min)}` : `esperas ${duracion(t.min)}`;
    return en ? "no waiting" : "sin esperas";
  }
  /** Las puertas que cruza quien va por puertas hasta esta parada: tú, o el cyno si saltas. */
  function textoPuertas(r: ResultadoParada): string {
    const en = getLang() === "en";
    const c = puertasCyno(r);
    if (!c) return en ? `${r.saltos} ${r.saltos === 1 ? "gate" : "gates"}` : `${r.saltos} ${r.saltos === 1 ? "puerta" : "puertas"}`;
    if (c.tipo === "ya_ahi") return en ? "the cyno is already there" : "el cyno ya está ahí";
    if (c.tipo === "mismo_sitio") return en ? "same system as the previous stop" : "el mismo sistema que la parada anterior";
    return en ? `${c.n} cyno ${c.n === 1 ? "gate" : "gates"}` : `${c.n} ${c.n === 1 ? "puerta" : "puertas"} del cyno`;
  }
  /** «5 avisos en 3 tramos»: reportes DISTINTOS (el mismo en tres tramos es uno), en singular si toca. */
  function textoResumenMarcas(): string {
    const { reportes: a, tramos: t } = resumenMarcas(marcasPlan);
    return getLang() === "en"
      ? `${a} ${a === 1 ? "report" : "reports"} on ${t} ${t === 1 ? "leg" : "legs"}`
      : `${a} ${a === 1 ? "aviso" : "avisos"} en ${t} ${t === 1 ? "tramo" : "tramos"}`;
  }
  const empezados = tramosIntel.filter((t) => t.empezado);

  // ---- fase 3a: textos del salto ----
  /** Por qué tu forma no llega, con los números. Un `switch` exhaustivo como `llega`: un motivo nuevo
   *  no compila hasta que tenga su frase. */
  function textoNoLlega(r: ResultadoParada): string {
    switch (r.estado) {
      case "sin_ruta":
        return tr("Sin ruta con los filtros actuales: no se puede contar.");
      case "fuera_alcance":
        return `${tr("Fuera de alcance")}: ${unDecimal(r.noLlega?.ly ?? NaN)} ${tr("al, y llegas a")} ${unDecimal(r.noLlega?.alcance ?? NaN)}.`;
      case "alta_sec":
        return tr("A alta seguridad no se salta.");
      case "cyno_sin_ruta":
        return tr("El cyno no tiene ruta a puertas hasta aquí con los filtros actuales.");
      case "salvada":
      case "perdida":
        return "";
      default: {
        const nunca: never = r.estado;
        return nunca;
      }
    }
  }
  /** `enIntermedio`: el salto sale de un intermedio, donde NO hay sitio. La espera dice DÓNDE se
   *  espera parado, que es la frase entera de la fase 3b. Frase entera por idioma: el orden cambia. */
  function lineaSalto(s: SaltoHecho, enIntermedio = false): string {
    // Frase ENTERA por idioma, nunca trozos de `tr()` pegados. Antes era «esperas» + «al cyno» y
    // «quedas con» + «de cooldown y»: que en inglés encajara era suerte, y un trozo como «al cyno»
    // reutilizado en otra frase arrastra una traducción que allí no vale.
    const espera = s.espera;
    const en = getLang() === "en";
    const sitio = espera ? nameOf(espera.en) || `#${espera.en}` : "";
    const m = espera ? minutos(espera.min) : "";
    const e = !espera
      ? enIntermedio
        ? en ? "you jump on as soon as you land" : "sigues en cuanto llegas"
        : en ? "you leave as soon as you finish" : "sales nada más acabar"
      : enIntermedio
        ? espera.quien === "cyno"
          ? en ? `you wait ${m} in ${sitio} for the cyno` : `esperas ${m} en ${sitio} al cyno`
          : en ? `you wait ${m} in ${sitio} for your cooldown` : `esperas ${m} en ${sitio} de cooldown`
        : espera.quien === "cyno"
          ? en ? `you wait ${m} for the cyno` : `esperas ${m} al cyno`
          : en ? `you wait ${m} for your cooldown` : `esperas ${m} de cooldown`;
    const iso = `${s.isotopos.toLocaleString(getLang())} ${s.isotopo}`;
    const cd = minutos(s.cooldownMin);
    const fat = minutos(s.fatigaMin);
    return en
      ? `⤴ ${unDecimal(s.ly)} ly · ⛽ ${iso} · ${e} · you're left with ~${cd} of cooldown and ~${fat} of fatigue`
      : `⤴ ${unDecimal(s.ly)} al · ⛽ ${iso} · ${e} · quedas con ~${cd} de cooldown y ~${fat} de fatiga`;
  }
  // ---- fase 3b: textos del intermedio. Frases enteras por idioma: el orden de las piezas cambia. ----
  const nom = (sid: number) => nameOf(sid) || `#${sid}`;
  /** Por qué un sistema no sirve de intermedio, con su número. `desde` = donde está el que salta. */
  function textoFalloVia(via: number, desde: number, f: FalloIntermedio): string {
    const en = getLang() === "en";
    const X = nom(via);
    switch (f.motivo) {
      case "mismo":
        return en ? `${X} is where you jump from, or the destination itself.` : `${X} es el sitio de salida o el propio destino.`;
      case "alta_sec":
        return en ? `You can't jump to ${X}: high-sec or Pochven.` : `A ${X} no se puede saltar: es alta seguridad o Pochven.`;
      case "lejos_ida":
        return en
          ? `${X} is ${unDecimal(f.ly)} ly from ${nom(desde)}, and your range is ${unDecimal(f.alcance)}.`
          : `${X} queda a ${unDecimal(f.ly)} al desde ${nom(desde)}, y llegas a ${unDecimal(f.alcance)}.`;
      case "lejos_vuelta":
        return en
          ? `From ${X} the destination is ${unDecimal(f.ly)} ly away, and your range is ${unDecimal(f.alcance)}.`
          : `Desde ${X} el destino queda a ${unDecimal(f.ly)} al, y llegas a ${unDecimal(f.alcance)}.`;
      case "cyno_sin_ruta":
        return en
          ? `The cyno has no gate route to ${X}, or from ${X} to the destination.`
          : `El cyno no tiene ruta a puertas hasta ${X}, o de ${X} al destino.`;
      default: {
        const nunca: never = f;
        return nunca;
      }
    }
  }
  /** Cuando no hay propuesta: EL MOTIVO EXACTO, nunca un genérico. */
  function textoSinVia(b: BusquedaIntermedio): string {
    const en = getLang() === "en";
    switch (b.tipo) {
      case "ni_con_dos":
        return en
          ? `Not even with an intermediate jump: it's ${unDecimal(b.ly)} ly, and two jumps reach ${unDecimal(b.alcanceDos)}.`
          : `Ni con un salto intermedio: son ${unDecimal(b.ly)} al y con dos saltos llegas a ${unDecimal(b.alcanceDos)}.`;
      case "sin_sistema":
        return en
          ? "There's no system within range of both ends that you can jump to."
          : "No hay ningún sistema al alcance de los dos lados al que se pueda saltar.";
      case "cyno_sin_ruta":
        return en
          ? "The cyno has no gate route to any of the possible intermediates."
          : "El cyno no tiene ruta a puertas hasta ninguno de los intermedios posibles.";
      case "propuesta":
        return "";
      default: {
        const nunca: never = b;
        return nunca;
      }
    }
  }
  /** El precio de un intermedio, con el MISMO cálculo que saldría al aceptarlo (`vistas`). */
  function textoPrecio(via: number, r: ResultadoParada | null): string {
    const en = getLang() === "en";
    const X = nom(via);
    const ss = r?.salto?.saltos ?? [];
    if (!r || !llega(r.estado) || ss.length !== 2) return r ? textoNoLlega(r) : "";
    const [a, b] = ss;
    const iso = `${(a.isotopos + b.isotopos).toLocaleString(getLang())} ${a.isotopo}`;
    const espera = !b.espera
      ? en
        ? `no wait in ${X}`
        : `sin esperar en ${X}`
      : b.espera.quien === "cyno"
        ? en
          ? `you wait ${minutos(b.espera.min)} in ${X} for the cyno`
          : `esperas ${minutos(b.espera.min)} en ${X} al cyno`
        : en
          ? `you wait ${minutos(b.espera.min)} in ${X} for your cooldown`
          : `esperas ${minutos(b.espera.min)} en ${X} de cooldown`;
    const margen =
      r.estado === "salvada"
        ? en
          ? `you'd arrive with ${duracion(r.margenMin)} to spare`
          : `llegarías con ${duracion(r.margenMin)} de sobra`
        : en
          ? `you'd arrive ${duracion(r.margenMin)} late`
          : `llegarías ${duracion(r.margenMin)} tarde`;
    return en
      ? `With an intermediate jump in ${X}: ${unDecimal(a.ly)} + ${unDecimal(b.ly)} ly · ${espera} · ⛽ ${iso} · you land with ~${minutos(b.fatigaMin)} of fatigue · ${margen}`
      : `Con un salto intermedio en ${X}: ${unDecimal(a.ly)} + ${unDecimal(b.ly)} al · ${espera} · ⛽ ${iso} · llegas con ~${minutos(b.fatigaMin)} de fatiga · ${margen}`;
  }
  function textoAviso3b(via: number, delPiloto: boolean): string {
    const en = getLang() === "en";
    const X = nom(via);
    if (delPiloto) {
      return en ? `You chose ${X}. Koru doesn't know whether you can wait there safely.` : `${X} lo has elegido tú. Koru no sabe si ahí puedes esperar seguro.`;
    }
    return en
      ? `Koru picks ${X} by distance and by the cyno's gates. It doesn't know whether you can wait there safely.`
      : `Koru elige ${X} por distancia y por las puertas del cyno. No sabe si ahí puedes esperar seguro.`;
  }
  const textoUsar = (via: number) => (getLang() === "en" ? `Use ${nom(via)}` : `Usar ${nom(via)}`);
  const textoBuscando = (n: number) =>
    getLang() === "en" ? `looking for an intermediate… (${n} tried)` : `buscando un intermedio… (${n} probados)`;
  const textoViaIgnorada = (via: number) =>
    getLang() === "en"
      ? `Saved intermediate ${nom(via)}: not needed now, you jump straight there.`
      : `Intermedio ${nom(via)} guardado: ahora no hace falta, saltas directo.`;
  const textoViaNoSirve = (via: number, desde: number) =>
    getLang() === "en"
      ? `The saved intermediate ${nom(via)} no longer works from ${nom(desde)}:`
      : `El intermedio ${nom(via)} guardado ya no sirve desde ${nom(desde)}:`;
  const textoViaEnUso = (via: number) =>
    getLang() === "en" ? `Via ${nom(via)}, the intermediate you accepted.` : `Por ${nom(via)}, el intermedio que aceptaste.`;

  // Al final del recorrido: isótopos por tipo y con qué fatiga acabas.
  const totalSalto = (() => {
    if (!actual) return null;
    const iso = new Map<string, number>();
    let ultimo: SaltoHecho | null = null;
    for (const r of actual.resultados) {
      for (const s of r.salto?.saltos ?? []) {
        iso.set(s.isotopo, (iso.get(s.isotopo) ?? 0) + s.isotopos);
        ultimo = s;
      }
    }
    return ultimo ? { iso, ultimo } : null;
  })();
  /** Lo que el cálculo SUPONE porque no lo sabe. Nunca un cero callado. */
  const supuestos: string[] = [];
  if (saltando) {
    if (catalogo && !casco && forma) {
      supuestos.push(
        getLang() === "en"
          ? `The ship of “${forma.nombre}” isn't in the jump ship catalogue: counting BY GATES with the minutes of “${forma.nombre}”.`
          : `La nave de «${forma.nombre}» no está en el catálogo de naves de salto: se cuenta POR PUERTAS con los minutos de «${forma.nombre}».`,
      );
    }
    if (salta == null) {
      supuestos.push(tr("Sin «quién salta»: se suponen Jump Drive Calibration y Jump Fuel Conservation a V, y sin fatiga."));
    } else {
      if (skillsSalto.motivo != null) {
        const pj = nombrePj(salta);
        supuestos.push(
          esFaltaPermiso(skillsSalto.motivo)
            ? getLang() === "en"
              ? `${pj} hasn't granted the skills permission (esi-skills.read_skills.v1): Jump Drive Calibration and Jump Fuel Conservation are assumed at V.`
              : `${pj} no ha concedido el permiso de skills (esi-skills.read_skills.v1): se suponen Jump Drive Calibration y Jump Fuel Conservation a V.`
            : `${tr("No se pudieron leer las skills de salto de")} ${pj} (${skillsSalto.motivo}): ${tr("se suponen a V.")}`,
        );
      }
      if (fatigaErr) {
        supuestos.push(
          fatigaErr.permiso
            ? `${tr("Fatiga de")} ${nombrePj(salta)}: ${tr("falta el permiso de lectura; se calcula con cero.")}`
            : `${tr("Fatiga de")} ${nombrePj(salta)}: ${tr("ESI no la dio")} (${fatigaErr.msg}); ${tr("se calcula con cero.")}`,
        );
      }
    }
    if (ini.cotaRoja) {
      supuestos.push(
        `${tr("Cooldown: ESI no lo da. Por su último salto, puede saltar como muy tarde a las")} ${new Date(ini.cooldownHastaMs).toLocaleTimeString(getLang(), { hour: "2-digit", minute: "2-digit" })}. ${tr("Es una cota, no una lectura.")}`,
      );
    }
    if (durCyno && forma) {
      const en = getLang() === "en";
      if (durCyno.motivo === "sin_casco") {
        supuestos.push(
          cyno == null
            ? en
              ? `The cyno is counted at its base duration (${minutos(durCyno.min)}), with no hull bonus: nobody lights it yet. Longer is the safe side.`
              : `El cyno se cuenta con su duración base (${minutos(durCyno.min)}), sin bono de casco: aún no hay quién lo encienda. De más es el lado seguro.`
            : en
              ? `It's not known which ship ${nombrePj(cyno)} is in: the cyno is counted at its base duration (${minutos(durCyno.min)}), with no hull bonus. Longer is the safe side.`
              : `No se sabe en qué nave está ${nombrePj(cyno)}: el cyno se cuenta con su duración base (${minutos(durCyno.min)}), sin bono de casco. De más es el lado seguro.`,
        );
      } else if (durCyno.motivo === "sin_catalogo") {
        supuestos.push(
          en
            ? `The cyno catalogue didn't load: counting the cyno with the minutes saved in “${forma.nombre}” (${minutos(durCyno.min)}).`
            : `El catálogo de cynos no cargó: el cyno se cuenta con los minutos guardados en «${forma.nombre}» (${minutos(durCyno.min)}).`,
        );
      }
      if (durCyno.puedeMontar === false && cyno != null) {
        const nave = naveDe(cyno)?.ship ?? "?";
        supuestos.push(
          en
            ? `${nombrePj(cyno)} is in a ${nave}, which can't fit a ${nombreTipo(forma.tipo_cyno)} cyno.`
            : `${nombrePj(cyno)} está en una ${nave}, que no puede montar un cyno ${nombreTipo(forma.tipo_cyno).toLowerCase()}.`,
        );
      }
    }
    if (cyno == null) supuestos.push(tr("Sin «quién pone el cyno»: se supone que sale de donde el que salta (el origen)."));
    else if (cynoLoc == null) supuestos.push(textoDondeNoSeSabe(nombrePj(cyno), cynoDonde));
  }
  // ---- editor de la forma de viajar ----
  const [editando, setEditando] = useState<FormaViaje | null>(null);
  /** El tipo elegido en el formulario: un tipo, «a mano», o nada todavía ("" = no se ha elegido:
   *  si el casco de quien enciende puede montar varios, no se adivina). */
  const [tipoSel, setTipoSel] = useState<TipoCyno | "mano" | "">("");
  function abrirEditor(f: FormaViaje) {
    if (f.id === 0) {
      // B1: la nave propuesta, si la que lleva ahora quien salta es de salto. Solo al CREAR: un
      // salto guardado no se cambia sin que el piloto pulse (ver el aviso de B2).
      const p = proponerNave(naveDe(salta)?.ship_type_id ?? null, datosSalto?.find((d) => d.character_id === salta), catalogoIds);
      f = { ...f, casco_type_id: p.propuesta };
    }
    setEditando(f);
    // Una fila de antes, sin tipo, se lee «a mano» con su número. Una nueva, el tipo si solo cabe uno.
    setTipoSel(f.id > 0 ? f.tipo_cyno ?? "mano" : tipoCynoPorDefecto(cascoCyno, cynoFit) ?? "");
  }
  /** «5 min: lo enciende una Falcon, que lo deja en la mitad». La duración que RESULTA y por qué. */
  function textoDuracion(d: ReturnType<typeof duracionCyno>): string {
    const en = getLang() === "en";
    const nave = naveDe(cyno)?.ship;
    switch (d.motivo) {
      case "bono":
        return en ? `${minutos(d.min)}: lit from a ${nave}, which halves it` : `${minutos(d.min)}: lo enciende una ${nave}, que lo deja en la mitad`;
      case "base":
        return en ? `${minutos(d.min)}: lit from a ${nave}, with no bonus` : `${minutos(d.min)}: lo enciende una ${nave}, sin bono`;
      case "sin_casco":
        return en ? `${minutos(d.min)}: base, without a hull bonus (the cyno's ship isn't known)` : `${minutos(d.min)}: la base, sin bono (no se sabe la nave del cyno)`;
      case "a_mano":
        return en ? "by hand" : "a mano";
      case "sin_catalogo":
        return en ? `${minutos(d.min)}: the cyno catalogue didn't load` : `${minutos(d.min)}: el catálogo de cynos no cargó`;
    }
  }
  const nuevaForma = (): FormaViaje => ({
    id: 0,
    nombre: "",
    modo: "salto",
    casco_type_id: null,
    ciclo_cyno_min: 10,
    min_por_salto: 1,
    tipo_cyno: null,
    planes: [],
  });
  // ★ B3 · quién puede hacer cada papel.
  const papeles = useMemo(
    () => candidatosPapeles(pilotos, datosSalto ?? [], catalogoIds, cynoFit, nivelPide),
    [pilotos, datosSalto, catalogoIds, cynoFit, nivelPide],
  );
  /** Por qué alguien es candidato (o no se sabe). Frase corta por idioma. */
  function textoMotivo(m: MotivoPapel): string {
    const en = getLang() === "en";
    const nombreNave = (t: number) => catalogo?.ships.find((x) => x.id === t)?.name ?? `#${t}`;
    switch (m.tipo) {
      case "lleva":
        return en ? `in a ${nombreNave(m.nave)} now` : `está en una ${nombreNave(m.nave)}`;
      case "posee":
        return en ? `owns ${m.naves} jump ${m.naves === 1 ? "ship" : "ships"}` : `tiene ${m.naves} ${m.naves === 1 ? "nave" : "naves"} de salto`;
      case "puede_cyno":
        return en ? `can light: ${m.tipos.map(nombreTipo).join(", ")}` : `puede encender: ${m.tipos.map((t) => nombreTipo(t).toLowerCase()).join(", ")}`;
      case "no_se_sabe":
        return en ? "not known" : "no se sabe";
      case "no":
        return "";
    }
  }
  /** Las opciones de un papel: primero los candidatos con su motivo, debajo el resto. Uno que está
   *  elegido y no sale en ninguna lista (no cargado aún) se enseña igual: no se esconde lo guardado. */
  function opcionesPapel(c: CandidatosPapel, elegido: number | null) {
    const en = getLang() === "en";
    const op = (x: { id: number; motivo: MotivoPapel }) => {
      const m = textoMotivo(x.motivo);
      return (
        <option key={x.id} value={x.id}>
          {nombrePj(x.id)}
          {m ? ` — ${m}` : ""}
        </option>
      );
    };
    const conocidos = new Set([...c.candidatos, ...c.resto].map((x) => x.id));
    return (
      <>
        {c.candidatos.map(op)}
        {c.resto.length > 0 && <optgroup label={c.candidatos.length > 0 ? (en ? "The rest" : "El resto") : en ? "Nobody fits for sure" : "Nadie seguro"}>{c.resto.map(op)}</optgroup>}
        {elegido != null && !conocidos.has(elegido) && <option value={elegido}>{nombrePj(elegido)}</option>}
      </>
    );
  }
  // Se preselecciona SOLO un papel VACÍO y SOLO con un único candidato, UNA vez por plan y papel: si
  // el piloto lo vuelve a dejar en «—», no se le pisa. Se guarda (si no, el desplegable diría un
  // nombre y el cálculo contaría sin nadie) y se dice en la línea de debajo.
  const yaPropuesto = useRef(new Set<string>());
  const [preseleccion, setPreseleccion] = useState<string[]>([]);
  useEffect(() => {
    if (!saltando || !plan || datosSalto == null || !cynoFit) return;
    let s = salta;
    let c = cyno;
    const dichos: string[] = [];
    const k = (papel: string) => `${plan.id}-${papel}`;
    if (s == null && papeles.salta.unico != null && !yaPropuesto.current.has(k("salta"))) {
      yaPropuesto.current.add(k("salta"));
      s = papeles.salta.unico;
      dichos.push("salta");
    }
    if (c == null && papeles.cyno.unico != null && !yaPropuesto.current.has(k("cyno"))) {
      yaPropuesto.current.add(k("cyno"));
      c = papeles.cyno.unico;
      dichos.push("cyno");
    }
    if (dichos.length > 0) {
      setPreseleccion(dichos);
      void fijarPapeles(s, c);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saltando, plan?.id, salta, cyno, papeles, datosSalto, cynoFit]);
  async function usarNave(nave: number) {
    if (!forma) return;
    try {
      await invoke<number>("forma_guardar", { forma: { ...forma, casco_type_id: nave } });
      await recargarFormas();
    } catch (e) {
      setError(String(e));
    }
  }
  async function guardarForma() {
    if (!editando || !plan) return;
    if (editando.modo === "salto" && tipoSel === "") {
      setError(getLang() === "en" ? "Choose the cyno type (or “by hand”)." : "Elige el tipo de cyno (o «a mano»).");
      return;
    }
    try {
      const tipo_cyno = tipoSel === "mano" || tipoSel === "" ? null : tipoSel;
      const id = await invoke<number>("forma_guardar", { forma: { ...editando, tipo_cyno } });
      if (editando.id === 0) await invoke("plan_forma", { planId: plan.id, formaId: id });
      setEditando(null);
      await recargarFormas();
      await recargar();
    } catch (e) {
      setError(String(e));
    }
  }
  async function borrarForma(id: number) {
    try {
      await invoke("forma_borrar", { id });
      setEditando(null);
      await recargarFormas();
    } catch (e) {
      // Si algún plan la usa, el error dice cuáles: se enseña tal cual.
      setError(String(e));
    }
  }
  async function fijarForma(formaId: number | null) {
    if (!plan) return;
    try {
      await invoke("plan_forma", { planId: plan.id, formaId });
      await recargar();
    } catch (e) {
      setError(String(e));
    }
  }
  async function fijarPapeles(s: number | null, c: number | null) {
    if (!plan) return;
    try {
      await invoke("plan_papeles", { planId: plan.id, salta: s, cyno: c });
      await recargar();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="plan-nav">
      <div className="nav-head plan-nav-head">
        🗂 {tr("Plan")}: <b>{nombrePlan}</b>
        <button className="route-stop-del" title={tr("Cerrar el plan (no lo borra)")} onClick={onCerrar}>
          ✕
        </button>
      </div>
      {error && <div className="fits-err small">{error}</div>}
      {!cargado ? (
        !error && <div className="muted small">{tr("cargando…")}</div>
      ) : (
        <>
          <div className="plan-nav-ajustes">
            <div className="route-stop">
              <span className="route-stop-label">{tr("Origen")}</span>
              <SystemSearch
                systems={systems}
                value={origen}
                placeholder={tr("Sistema de salida…")}
                onPick={(id) => void fijarOrigen(id)}
              />
              {plan?.origen_system_id != null && (
                <button
                  className="route-add"
                  title={tr("Volver a contar desde donde está el personaje activo")}
                  onClick={() => void fijarOrigen(null)}
                >
                  {tr("Personaje activo")}
                </button>
              )}
            </div>
            {/* ★ FASE 3a · LA FORMA DE VIAJAR, a la vista: decide los márgenes igual que los minutos. */}
            <div className="route-stop">
              <span className="route-stop-label">{tr("Cómo viajas")}</span>
              <select value={plan?.forma_id ?? ""} onChange={(e) => void fijarForma(e.target.value ? Number(e.target.value) : null)}>
                <option value="">{tr("Por puertas")}</option>
                {formas.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nombre}
                  </option>
                ))}
              </select>
              {forma && (
                <button className="route-add" onClick={() => abrirEditor({ ...forma })}>
                  {tr("Editar")}
                </button>
              )}
              {/* Lo que se crea desde aquí es SIEMPRE un salto: «por puertas» es no elegir nada. */}
              <button className="route-add" onClick={() => abrirEditor(nuevaForma())}>
                {tr("+ Salto con cyno")}
              </button>
            </div>
            {/* ★ PARTE B · primero QUIÉN salta y QUIÉN pone el cyno, después la nave: la nave se
                propone según el piloto, y pedirla antes es pedirla a ciegas. */}
            {(saltando || editando?.modo === "salto") && (
              <div className="route-stop">
                <span className="route-stop-label">{tr("Quién salta")}</span>
                <select value={salta ?? ""} onChange={(e) => void fijarPapeles(e.target.value ? Number(e.target.value) : null, cyno)}>
                  <option value="">—</option>
                  {opcionesPapel(papeles.salta, salta)}
                </select>
                <span className="route-stop-label">{tr("Quién pone el cyno")}</span>
                <select value={cyno ?? ""} onChange={(e) => void fijarPapeles(salta, e.target.value ? Number(e.target.value) : null)}>
                  <option value="">—</option>
                  {opcionesPapel(papeles.cyno, cyno)}
                </select>
              </div>
            )}
            {preseleccion.length > 0 && (
              <div className="small muted">
                {preseleccion
                  .map((p) => {
                    const id = p === "salta" ? salta : cyno;
                    const en = getLang() === "en";
                    if (id == null) return "";
                    return p === "salta"
                      ? en
                        ? `${nombrePj(id)} picked to jump: the only candidate.`
                        : `${nombrePj(id)} elegido para saltar: el único que puede.`
                      : en
                        ? `${nombrePj(id)} picked for the cyno: the only one who can light it.`
                        : `${nombrePj(id)} elegido para el cyno: el único que puede encenderlo.`;
                  })
                  .join(" ")}
              </div>
            )}
            {/* ★ B2 · la nave guardada no es la que lleva quien salta ahora. Sin pulsar, se calcula con la guardada. */}
            {saltando &&
              forma &&
              (() => {
                const a = avisoNave(forma.casco_type_id, naveDe(salta)?.ship_type_id ?? null, catalogoIds);
                if (!a) return null;
                const nom = (t: number | null) => catalogo?.ships.find((x) => x.id === t)?.name ?? (t == null ? "—" : `#${t}`);
                return (
                  <div className="small route-scope-warn">
                    {getLang() === "en"
                      ? `“${forma.nombre}” says ${nom(a.guardada)}; ${nombrePj(salta!)} is in a ${nom(a.ahora)}.`
                      : `«${forma.nombre}» dice ${nom(a.guardada)}; ${nombrePj(salta!)} está en una ${nom(a.ahora)}.`}{" "}
                    <button
                      className="route-add"
                      title={forma.planes.length > 1 ? `${tr("La usan")}: ${forma.planes.join(", ")}` : ""}
                      onClick={() => void usarNave(a.ahora)}
                    >
                      {getLang() === "en" ? `Use ${nom(a.ahora)}` : `Usar ${nom(a.ahora)}`}
                    </button>
                  </div>
                );
              })()}
            {editando && (
              <div className="plan-forma-editor small">
                <label>
                  {tr("Nombre")}:&nbsp;
                  <input className="campo-texto" value={editando.nombre} placeholder={tr("p. ej. blops con cyno covert")} onChange={(e) => setEditando({ ...editando, nombre: e.target.value })} />
                </label>
                {/* ⚠️ Sin «Modo»: el formulario solo crea saltos. Una fila vieja con modo `puertas`
                    (las hubo hasta el 28-11, sin release) se sigue leyendo y editando: solo deja de
                    poder crearse aquí. */}
                {editando.modo === "salto" &&
                  (() => {
                    // B1: la propuesta, lo que tiene y el resto, por separado.
                    const p = proponerNave(naveDe(salta)?.ship_type_id ?? null, datosSalto?.find((d) => d.character_id === salta), catalogoIds);
                    const ship = (t: number) => catalogo?.ships.find((x) => x.id === t);
                    const opt = (t: number, extra = "") => {
                      const x = ship(t);
                      return (
                        <option key={t} value={t}>
                          {x ? `${x.group} · ${x.name}` : `#${t}`}
                          {extra}
                        </option>
                      );
                    };
                    const en = getLang() === "en";
                    const d = duracionCyno({ tipo_cyno: tipoSel === "mano" || tipoSel === "" ? null : tipoSel, ciclo_cyno_min: editando.ciclo_cyno_min }, cascoCyno, catalogo?.cynos ?? [], cynoFit);
                    return (
                      <>
                        <label>
                          {tr("Nave que salta")}:&nbsp;
                          <select
                            value={editando.casco_type_id ?? ""}
                            onChange={(e) => setEditando({ ...editando, casco_type_id: e.target.value ? Number(e.target.value) : null })}
                          >
                            <option value="">—</option>
                            {p.propuesta != null && opt(p.propuesta, en ? " (the one they're in now)" : " (en la que está ahora)")}
                            {p.poseidas.length > 0 && <optgroup label={en ? "The ones they own" : "Las que tiene"}>{p.poseidas.map((t) => opt(t))}</optgroup>}
                            <optgroup
                              label={
                                p.posesion === "no_se_sabe"
                                  ? en
                                    ? "The catalogue (which ones they own isn't known)"
                                    : "El catálogo (no se sabe cuáles tiene)"
                                  : en
                                    ? "The rest of the catalogue"
                                    : "El resto del catálogo"
                              }
                            >
                              {p.resto.map((t) => opt(t))}
                            </optgroup>
                          </select>
                        </label>
                        {salta == null && (
                          <div className="muted">
                            {en ? "Choose who jumps first: the ship is proposed from them." : "Elige primero quién salta: la nave se propone según él."}
                          </div>
                        )}
                        <label>
                          {tr("Tipo de cyno")}:&nbsp;
                          {/* D1: el desplegable dice solo el tipo; al lado, lo que dura y POR QUÉ. Los
                              minutos salen de `jumpships.json` y el bono de `cyno_fit.json`. */}
                          <select value={tipoSel} onChange={(e) => setTipoSel(e.target.value as TipoCyno | "mano" | "")}>
                            {tipoSel === "" && <option value="">—</option>}
                            {(cynoFit?.cynos ?? []).map((c) => (
                              <option key={c.tipo} value={c.tipo}>
                                {nombreTipo(c.tipo)}
                              </option>
                            ))}
                            <option value="mano">{tr("a mano")}</option>
                          </select>{" "}
                          {tipoSel === "mano" ? (
                            <>
                              <input
                                type="number"
                                min={0.1}
                                step={0.5}
                                value={editando.ciclo_cyno_min}
                                style={{ width: "4.5rem" }}
                                onChange={(e) => setEditando({ ...editando, ciclo_cyno_min: parseFloat(e.target.value) || 0 })}
                              />{" "}
                              {en ? "min, by hand: this number rules" : "min, a mano: manda este número"}
                            </>
                          ) : tipoSel === "" ? (
                            <span className="muted">
                              {en ? "the cyno's ship can fit more than one: choose" : "la nave del cyno puede montar más de uno: elige"}
                            </span>
                          ) : (
                            <span className="muted">{textoDuracion(d)}</span>
                          )}
                        </label>
                        {d.puedeMontar === false && cyno != null && (
                          <div className="route-scope-warn">
                            ⚠{" "}
                            {en
                              ? `A ${naveDe(cyno)?.ship ?? "?"} can't fit a ${nombreTipo(tipoSel as TipoCyno)} cyno.`
                              : `Una ${naveDe(cyno)?.ship ?? "?"} no puede montar un cyno ${nombreTipo(tipoSel as TipoCyno).toLowerCase()}.`}
                          </div>
                        )}
                      </>
                    );
                  })()}
                <label>
                  {editando.modo === "salto" ? tr("Minutos por puerta del cyno") : tr("Minutos por puerta")}:&nbsp;
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={editando.min_por_salto}
                    style={{ width: "4.5rem" }}
                    onChange={(e) => setEditando({ ...editando, min_por_salto: parseFloat(e.target.value) || 0 })}
                  />
                </label>
                {/* «Borrar» APARTE, a la derecha: estaba entre «Guardar» y «Cancelar», a un clic
                    de uno y de otro. No pide confirmación; un salto que usa algún plan no se borra
                    (lo rechaza `forma_borrar` y dice qué planes lo usan). */}
                <div className="plan-forma-botones">
                  <button className="route-add" onClick={() => void guardarForma()}>
                    {tr("Guardar")}
                  </button>
                  <button className="route-add" onClick={() => setEditando(null)}>
                    {tr("Cancelar")}
                  </button>
                  {editando.id > 0 && (
                    <button
                      className="route-add plan-forma-borrar"
                      title={editando.planes.length ? `${tr("La usan")}: ${editando.planes.join(", ")}` : ""}
                      onClick={() => void borrarForma(editando.id)}
                    >
                      {tr("Borrar")}
                    </button>
                  )}
                </div>
              </div>
            )}
            {saltando && forma && durCyno && durCyno.motivo !== "a_mano" && (
              <div className="small muted">
                {getLang() === "en" ? `Cyno (${nombreTipo(forma.tipo_cyno)}): ` : `Cyno (${nombreTipo(forma.tipo_cyno).toLowerCase()}): `}
                {textoDuracion(durCyno)}
              </div>
            )}
            {saltando && casco && (
              <div className="small muted">
                ⤴ {casco.name}: {tr("alcance")} ~{unDecimal(alcance)} {tr("al")} (JDC {jdc}) · {tr("fatiga al empezar")} ~{minutos(ini.fatigaMin)}
              </div>
            )}
            {supuestos.map((s) => (
              <div key={s} className="small route-scope-warn">
                ⚠ {s}
              </div>
            ))}
            {/* ⚠️ A LA VISTA y no en Ajustes: el veredicto depende de estos dos números, y un número
                que decide si llegas no puede ser invisible. Con ficha, el de la ficha (y no se edita
                aquí): UN solo dueño. */}
            {forma ? (
              <span className="muted small">
                {forma.modo === "salto" ? tr("Minutos por puerta del cyno") : tr("Minutos por puerta")}: <b>{forma.min_por_salto}</b> (
                {getLang() === "en" ? `set by “${forma.nombre}”` : `lo pone «${forma.nombre}»`})
              </span>
            ) : (
              <label className="muted small">
                {tr("Minutos por puerta")}:&nbsp;
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={minSalto}
                  style={{ width: "4.5rem" }}
                  onChange={(e) => {
                    const v = Math.max(0.1, parseFloat(e.target.value) || DEF_MIN_SALTO);
                    setMinSalto(v);
                    localStorage.setItem(MIN_SALTO_KEY, String(v));
                  }}
                />
              </label>
            )}
            <label className="muted small">
              {tr("Minutos en cada sitio")}:&nbsp;
              <input
                type="number"
                min={0}
                step={5}
                value={minSitio}
                style={{ width: "4.5rem" }}
                onChange={(e) => {
                  const v = Math.max(0, parseFloat(e.target.value) || 0);
                  setMinSitio(v);
                  localStorage.setItem(MIN_SITIO_KEY, String(v));
                }}
              />
            </label>
          </div>

          {origen == null && (
            <div className="fits-err small">
              {tr("Falta el origen: Koru no sabe dónde está el personaje activo. Elige el sistema de salida.")}
            </div>
          )}
          {intercepting && (
            <div className="small route-scope-warn">
              ⚠ {tr("Estás interceptando a un piloto: la línea del mapa es la suya y el plan no la pisa.")}
            </div>
          )}

          {!lineaEsDelPlan && (
            <div className="small route-scope-warn">
              ⚠ {tr("La ruta del mapa ya no es la del plan: los márgenes de aquí no cuentan lo dibujado.")}{" "}
              <button className="route-add" onClick={() => onPintar(pintarKey.split(",").map(Number))}>
                {tr("Volver a pintar el plan")}
              </button>
            </div>
          )}
          {actual && paradas.length > 0 && (
            <>
              <div className="plan-nav-resumen">
                {tr("Salvas")} <b>{actual.salvadas}</b> {tr("de")} {paradas.length} · {textoResumenTiempo(resumenTiempo(actual, !!formaCalc))}
                {" · "}
                <span className="muted">
                  {plan?.orden_manual ? tr("orden tuyo") : tr("orden propuesto por Koru")}
                </span>
              </div>
              {propuesta?.metodo === "caducidad" && (
                <div className="small route-scope-warn">
                  ⚠ {tr("Con más de")} {MAX_PERMUTAR} {tr("paradas el orden es por caducidad, no el óptimo.")}
                </div>
              )}
              {comparacion && (
                <div className={`small ${comparacion.aviso ? "route-scope-warn" : "muted"}`}>
                  {comparacion.aviso ? "⚠ " : ""}
                  {comparacion.texto}{" "}
                  {comparacion.aviso || propuesta!.mejor.recorridoMin < manual!.recorridoMin ? (
                    <button className="route-add" onClick={() => void usarPropuesto()}>
                      {tr("Usar el orden propuesto")}
                    </button>
                  ) : null}
                </div>
              )}

              {/* ★ FASE 2 · LO QUE CUESTA IR SEGURO. Mismo orden, mismo grafo, otro modo. Lo que
                  justifica la fase es la línea «ir seguro te cuesta X»: ninguna otra herramienta
                  puede decirla, porque ninguna tiene el reloj. */}
              {seguro &&
                (mismaRuta ? (
                  <div className="small muted">
                    🛡{" "}
                    {bajaNulaEv(seguro.corta) > 0
                      ? tr("No hay ruta por alta seguridad: la más segura sale igual que la corta.")
                      : tr("La corta ya va entera por alta seguridad.")}
                  </div>
                ) : (
                  <div className="plan-seguro small">
                    <div>
                      🛡 {bajaNulaEv(seguro.segura) === 0 ? tr("Por alta seguridad") : tr("Por la más segura")}:{" "}
                      {tr("salvas")} <b>{seguro.segura.salvadas}</b> {tr("de")} {paradas.length} · {tr("recorrido")}{" "}
                      {duracion(seguro.segura.recorridoMin)} (
                      {seguro.segura.recorridoMin >= seguro.corta.recorridoMin ? "+" : "−"}
                      {duracion(seguro.segura.recorridoMin - seguro.corta.recorridoMin)} {tr("que la corta")})
                    </div>
                    {bajaNulaEv(seguro.segura) > 0 && (
                      <div className="muted">
                        {tr("No hay ruta por alta seguridad")}: {tr("la más segura aún cruza")} {bajaNulaEv(seguro.segura)}{" "}
                        {tr("sistemas de baja o nula")} ({tr("la corta")}, {bajaNulaEv(seguro.corta)}).
                      </div>
                    )}
                    {(() => {
                      const cuesta = cuestaIrSeguro(seguro.corta, seguro.segura).map(nombreParada);
                      return cuesta.length > 0 ? (
                        <div className="route-scope-warn">
                          ⚠ {tr("Ir seguro te cuesta")} <b>{cuesta.join(", ")}</b>.
                        </div>
                      ) : (
                        <div className="muted">{tr("Ir seguro no te cuesta ninguna escalación.")}</div>
                      );
                    })()}
                    {seguro.mejorSegura.salvadas > seguro.segura.salvadas && (
                      <div className="muted">
                        {tr("Por la segura, otro orden salvaría")} {seguro.mejorSegura.salvadas} {tr("de")} {paradas.length}.
                      </div>
                    )}
                  </div>
                ))}

              {/* ★ FASE 2 · QUIÉN MIRA EL CAMINO. Sin vigilante no hay marcas, y un panel sin marcas
                  no puede parecer un camino limpio. */}
              {tramosIntel.length > 0 &&
                (!vigila ? (
                  <div className="small route-scope-warn">
                    ⚠ {tr("El intel no está vigilando: el camino del plan no se mira.")}
                  </div>
                ) : (
                  <div className="small muted">
                    👁 {tr("El intel mira")} {tramosIntel.length} {tr("tramos")} ·{" "}
                    {empezados.length > 0
                      ? `${tr("suena el de")} ${empezados.map((t) => t.destino).join(", ")} (${tr("también con el plan cerrado")})`
                      : tr("ninguno empezado: marca sin sonar")}{" "}
                    ·{" "}
                    {marcasPlan.length > 0 ? textoResumenMarcas() : tr("nada cantado en el camino")}
                  </div>
                ))}
              {intelError && <div className="small route-scope-warn">⚠ {intelError}</div>}

              <ol
                className={`plan-nav-lista${arrastre ? " arrastrando" : ""}`}
                onPointerMove={(e) => arrastre && setArrastre({ ...arrastre, sobre: sobreQue(e.clientY) })}
                onPointerUp={() => {
                  if (!arrastre) return;
                  const { desde, sobre } = arrastre;
                  setArrastre(null);
                  // `sobre` es un hueco entre filas (0..n); al sacar la fila de arriba, se corre uno.
                  mover(desde, sobre > desde ? sobre - 1 : sobre);
                }}
                onPointerCancel={() => setArrastre(null)}
              >
                {actual.resultados.map((r, pos) => {
                  const p = calc.find((x) => x.p.id === r.stopId)!;
                  const res = p.p.resuelta!;
                  const cls =
                    r.estado === "salvada" ? "plan-ok" : r.estado === "perdida" ? "plan-perdida" : "plan-sinruta";
                  return (
                    <li
                      key={r.stopId}
                      ref={(el) => {
                        filas.current[pos] = el;
                      }}
                      className={`plan-parada ${cls}${arrastre?.desde === pos ? " cogida" : ""}${
                        arrastre && arrastre.sobre === pos && arrastre.desde !== pos ? " hueco-arriba" : ""
                      }${
                        arrastre && pos === actual.resultados.length - 1 && arrastre.sobre === pos + 1 ? " hueco-abajo" : ""
                      }`}
                    >
                      <span
                        className="plan-asa"
                        title={tr("Arrastra para cambiar el orden")}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          (e.currentTarget.closest("ol") as HTMLElement | null)?.setPointerCapture(e.pointerId);
                          setArrastre({ desde: pos, sobre: pos });
                        }}
                      >
                        ⠿
                      </span>
                      <span className="plan-num">{pos + 1}</span>
                      <div className="plan-cuerpo">
                        <div>
                          <b>{res.titulo || tr("(sin título)")}</b>{" "}
                          <a className="plan-sys" onClick={() => focusSystem(res.system_id!)}>
                            {nameOf(res.system_id!) || res.system_name}
                          </a>
                          {res.empezada && <span className="plan-empezada"> ▶ {tr("en camino")}</span>}
                        </div>
                        <div className="small">
                          {!llega(r.estado) ? (
                            <span>{textoNoLlega(r)}</span>
                          ) : (
                            <>
                              <span className="muted">
                                {textoPuertas(r)} ·{" "}
                              </span>
                              {r.estado === "salvada" ? (
                                <span>
                                  {tr("llegas con")} <b>{duracion(r.margenMin)}</b> {tr("de sobra")}
                                </span>
                              ) : (
                                <span>
                                  ✖ {tr("llegas")} <b>{duracion(r.margenMin)}</b> {tr("tarde: se pierde con este orden")}
                                </span>
                              )}
                            </>
                          )}
                          {r.wormhole && (
                            <span className="plan-wh">
                              {" · "}◆ {tr("este tramo cruza un wormhole: puede haberse cerrado")}
                            </span>
                          )}
                        </div>
                        {r.salto?.saltos.map((s, k) => (
                          <div key={k} className="small plan-salto">
                            {lineaSalto(s, k > 0 && r.salto?.via != null)}
                          </div>
                        ))}
                        {/* ★ FASE 3b · el intermedio: en uso, guardado e ignorado, o guardado y que ya no sirve. */}
                        {r.salto?.via != null && (
                          <div className="small plan-salto">
                            ⤴ {textoViaEnUso(r.salto.via)}{" "}
                            <button className="route-add" onClick={() => void fijarVia(r.stopId, null)}>
                              {tr("Quitar intermedio")}
                            </button>
                          </div>
                        )}
                        {r.salto?.viaIgnorada != null && (
                          <div className="small muted">
                            {textoViaIgnorada(r.salto.viaIgnorada)}{" "}
                            <button className="route-add" onClick={() => void fijarVia(r.stopId, null)}>
                              {tr("Quitar intermedio")}
                            </button>
                          </div>
                        )}
                        {r.estado === "fuera_alcance" && r.noLlega && formaCalc && (() => {
                          const nl = r.noLlega;
                          const b = busquedaDe(r.stopId);
                          const v = vistas.get(r.stopId);
                          return (
                            <div className="small plan-salto">
                              {nl.viaNoSirve && (
                                <div className="route-scope-warn">
                                  ⚠ {textoViaNoSirve(nl.viaNoSirve.via, nl.desde)} {textoFalloVia(nl.viaNoSirve.via, nl.desde, nl.viaNoSirve.fallo)}{" "}
                                  <button className="route-add" onClick={() => void fijarVia(r.stopId, null)}>
                                    {tr("Quitar intermedio")}
                                  </button>
                                </div>
                              )}
                              {v && (
                                <div>
                                  {textoPrecio(v.via, v.r)}{" "}
                                  {v.r && llega(v.r.estado) && (
                                    <button className="route-add" onClick={() => void fijarVia(r.stopId, v.via)}>
                                      {textoUsar(v.via)}
                                    </button>
                                  )}
                                  <div className="muted">
                                    <i>{textoAviso3b(v.via, v.delPiloto)}</i>
                                  </div>
                                </div>
                              )}
                              {b?.res && b.res.tipo !== "propuesta" && <div>{textoSinVia(b.res)}</div>}
                              {b?.otro?.fallo && <div>{textoFalloVia(b.otro.via, nl.desde, b.otro.fallo)}</div>}
                              {b?.buscando && <div className="muted">{textoBuscando(b.hechos)}</div>}
                              <div>
                                {!b?.buscando && !b?.res && (
                                  <button className="route-add" onClick={() => buscarVia(r)}>
                                    {tr("Buscar intermedio")}
                                  </button>
                                )}{" "}
                                {otroAbierto === r.stopId ? (
                                  <SystemSearch
                                    systems={systems}
                                    value={b?.otro?.via ?? null}
                                    placeholder={tr("Sistema intermedio…")}
                                    onPick={(id) => {
                                      setOtroAbierto(null);
                                      probarOtro(r, id);
                                    }}
                                  />
                                ) : (
                                  <button className="route-add" onClick={() => setOtroAbierto(r.stopId)}>
                                    {tr("Otro…")}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })()}
                        {llega(r.estado) && <div className="small muted">{lineaMuertes(r)}</div>}
                        {lineaOtra(r) && <div className="small muted">🛡 {lineaOtra(r)}</div>}
                        {(() => {
                          // Lo que está EN el camino, arriba y destacado; lo lejano, abajo y atenuado.
                          const ms = ordenarMarcas(marcasPlan.filter((m) => m.stop_id === r.stopId));
                          if (ms.length === 0) return null;
                          // El mismo motivo para todas se dice UNA vez; si difieren, cada una el suyo.
                          const comun = avisoComun(ms);
                          const idx = paradas.findIndex((x) => x.stopId === r.stopId);
                          const pos = tramos ? posponer(actual.orden, idx, paradas, tramos, ahora, minSaltoEf, minSitio, formaCalc) : null;
                          return (
                            <div className={`plan-intel ${ms.some((m) => m.aviso === "avisa") ? "suena" : "calla"}`}>
                              <div>⚠ {saltando ? tr("Intel en el camino del cyno") : tr("Intel en este tramo")}</div>
                              {comun && <div className="plan-intel-aviso">{textoAviso(comun)}</div>}
                              {ms.map((m) => (
                                <div
                                  key={`${m.sys_id}-${m.ts_ms}`}
                                  className={`plan-intel-linea ${m.jumps === 0 ? "en-camino" : "lejos"}`}
                                  title={m.message}
                                >
                                  <b>{m.system}</b>{" "}
                                  {m.jumps === 0
                                    ? tr("en el camino")
                                    : getLang() === "en"
                                      ? `${m.jumps} ${m.jumps === 1 ? "gate" : "gates"} off the route, near ${m.cerca_de_name}`
                                      : `a ${m.jumps} ${m.jumps === 1 ? "puerta" : "puertas"} del camino, junto a ${m.cerca_de_name}`}{" "}
                                  · {haceMin(m.ts_ms, Date.now())} — {m.author}: {m.message}
                                  {!comun && <div className="plan-intel-aviso">{textoAviso(m.aviso)}</div>}
                                </div>
                              ))}
                              {pos && (
                                <button className="route-add" onClick={() => void reordenar(pos.orden)}>
                                  {tr("Hacer antes otra parada")} (
                                  {pos.salvadas < actual.salvadas
                                    ? `${tr("pierdes")} ${actual.salvadas - pos.salvadas}`
                                    : tr("salvas las mismas")}
                                  )
                                </button>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                      <button className="route-stop-del" title={tr("Subir")} disabled={pos === 0} onClick={() => mover(pos, pos - 1)}>
                        ↑
                      </button>
                      <button
                        className="route-stop-del"
                        title={tr("Bajar")}
                        disabled={pos === actual.resultados.length - 1}
                        onClick={() => mover(pos, pos + 1)}
                      >
                        ↓
                      </button>
                      <button
                        className="route-stop-del"
                        title={tr("Sacar del plan (la escalación no se toca)")}
                        onClick={() => void quitar(r.stopId)}
                      >
                        ✕
                      </button>
                    </li>
                  );
                })}
              </ol>
              {totalSalto && (
                <div className="small plan-salto">
                  ⛽ {tr("Total")}:{" "}
                  {[...totalSalto.iso].map(([t, n]) => `${n.toLocaleString(getLang())} ${t}`).join(" · ")} · {tr("acabas con")} ~
                  {minutos(totalSalto.ultimo.fatigaMin)} {tr("de fatiga")} (~{minutos(totalSalto.ultimo.cooldownMin)} {tr("de cooldown")})
                </div>
              )}
              {/* ★ APARTE Y NO EN EL RECORRIDO: estas se pierden hagas lo que hagas, así que no
                  gastan viaje ni se arrastran. Ver `separarImposibles` en plan.ts. */}
              {actual.imposibles.length > 0 && (
                <>
                  <div className="nav-head">✖ {tr("No llegas ni yendo directo")}</div>
                  <ul className="plan-nav-fuera">
                    {actual.imposibles.map((im) => {
                      const res = calc.find((x) => x.p.id === im.stopId)!.p.resuelta!;
                      return (
                        <li key={im.stopId} className="plan-parada plan-perdida">
                          <div className="plan-cuerpo">
                            <div>
                              <b>{res.titulo || tr("(sin título)")}</b>{" "}
                              <a className="plan-sys" onClick={() => focusSystem(res.system_id!)}>
                                {nameOf(res.system_id!) || res.system_name}
                              </a>
                            </div>
                            <div className="small">
                              <span className="muted">
                                {im.saltos} {tr("puertas")} ·{" "}
                              </span>
                              ✖ {tr("yendo directo llegas")} <b>{duracion(im.margenMin)}</b>{" "}
                              {tr("tarde: perdida hagas lo que hagas")}
                            </div>
                          </div>
                          <button
                            className="route-stop-del"
                            title={tr("Sacar del plan (la escalación no se toca)")}
                            onClick={() => void quitar(im.stopId)}
                          >
                            ✕
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </>
          )}
          {cargado.paradas.length === 0 && (
            <div className="muted small">{tr("El plan está vacío: añade escalaciones desde la sección Escalaciones.")}</div>
          )}

          {fuera.length > 0 && (
            <>
              <div className="nav-head">{tr("Fuera del cálculo")}</div>
              <ul className="plan-nav-fuera">
                {fuera.map((p) => (
                  <li key={p.id} className={p.fallo ? "fits-err small" : "small muted"}>
                    {p.fallo ? (
                      <>⚠ {textoFallo(p)}</>
                    ) : p.resuelta!.system_id == null ? (
                      <>
                        {p.resuelta!.titulo} — {tr("no sabe en qué sistema está")}
                      </>
                    ) : (
                      <>
                        {p.resuelta!.titulo} · {p.resuelta!.system_name} — {tr("ya no está por hacer")} ({textoEstado(p.resuelta!.estado)})
                      </>
                    )}{" "}
                    <button className="route-stop-del" title={tr("Sacar del plan")} onClick={() => void quitar(p.id)}>
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
