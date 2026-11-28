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
import type { CharLoc, Character, IntelStatus, JumpShip, NeSystem } from "./types";
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
  type ResultadoParada,
  type Tramo,
} from "./plan";


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
  charLocations: CharLoc[];
  /** Pinta las paradas en el planificador del mapa: [origen, parada1, parada2…]. Saltando,
   *  [donde está el cyno, parada1, parada2…]: la línea amarilla es la ruta del cyno. */
  onPintar: (stops: number[]) => void;
  /** Fase 3a: los saltos (pares desde → hasta) para pintarlos aparte; `null` si el plan no salta. */
  onSaltos: (s: [number, number][] | null) => void;
  /** Las paradas que tiene AHORA el planificador, para saber si la línea sigue siendo la del plan. */
  rutaActual: (number | null)[];
  /** Mientras se intercepta a un piloto la ruta es suya: el plan no la pisa, y se dice. */
  intercepting: boolean;
  focusSystem: (sid: number) => void;
  onCerrar: () => void;
}) {
  const { planId, nonce, systems, hereSystemId, nameOf, calcTramo, routeMode, kills, killsAt, killsErr, onTramosIntel, intelError, characters, charLocations, onPintar, onSaltos, rutaActual, intercepting, focusSystem, onCerrar } = props;
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
  const cynoLoc = cyno != null ? charLocations.find((c) => c.id === cyno)?.system_id ?? null : null;
  const saltaLoc = salta != null ? charLocations.find((c) => c.id === salta)?.system_id ?? null : null;
  // Del que salta: sus niveles y su fatiga. Cada fallo dice cuál fue (sin permiso ≠ ESI caído).
  const [perfil, setPerfil] = useState<{ jdc: number; jfc: number } | null>(null);
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
    invoke<{ jdc: number; jfc: number }>("get_jump_profile", { characterId: salta })
      .then((p) => vivo && setPerfil({ jdc: p.jdc, jfc: p.jfc }))
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
  const jdc = perfil?.jdc ?? 5;
  const jfc = perfil?.jfc ?? 5;
  const alcance = casco ? casco.range * (1 + 0.2 * jdc) : 0;
  const formaDe = (modo?: RouteMode): FormaCalc<EstadoSalto> | undefined => {
    if (!saltando || !casco || origen == null) return undefined;
    return formaSalto({
      puntos: [origen, ...paradas.map((p) => p.systemId)],
      ly: (a, b) => {
        const A = sysIdx.get(a);
        const B = sysIdx.get(b);
        return A && B ? Math.hypot(B.gx - A.gx, B.gy - A.gy, B.gz - A.gz) : Infinity;
      },
      saltable: (s) => {
        const x = sysIdx.get(s);
        return !!x && destinoSaltable(x.s, x.r);
      },
      rutaCyno: (a, b) => calcTramo(a, b, modo),
      // Sin saber dónde está el cyno, se supone que sale de donde el que salta: se dice.
      cynoDesde: cynoLoc ?? origen,
      alcanceLy: alcance,
      casco: { fatMult: casco.fatMult, fuelPerLy: casco.fuelPerLy, isotope: casco.isotope },
      jfc,
      cicloCynoMin: forma!.ciclo_cyno_min,
      cynoMinPorSalto: forma!.min_por_salto,
      fatigaMin: ini.fatigaMin,
      cooldownHastaMs: ini.cooldownHastaMs,
      ahoraMs: ahora,
    });
  };
  const formaKey = JSON.stringify([forma, casco?.id, cynoLoc, jdc, jfc, fatiga, ahora, puntosKey]);
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
        const desdeAqui = calcTramo(desde, p.c.systemId);
        if (desdeAqui) sistemas = desdeAqui.path;
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
          ...actual.resultados.filter((r) => llega(r.estado)).map((r) => paradas.find((p) => p.stopId === r.stopId)!.systemId),
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
    const saltos = `${d > 0 ? "+" : ""}${d} ${tr("saltos")}`;
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
    if (viejo != null) {
      const d = duracion(viejo);
      const de = getLang() === "en" ? `data from ${d} ago` : `dato de hace ${d}`;
      const fallo = killsErr ? `, ${tr("no se pudo refrescar")}` : "";
      return mk.peor
        ? `☠ ${de}${fallo}: ${mk.sistemas} ${tr("sistemas con muertes en esa hora; el peor,")} ${nameOf(mk.peor.systemId)} (${mk.peor.kills})`
        : `☠ ${de}${fallo}: ${tr("ningún sistema con muertes en esa hora")}`;
    }
    if (!mk.peor) return `☠ ${tr("ningún sistema con muertes en la última hora")}`;
    return `☠ ${mk.sistemas} ${tr("sistemas con muertes en la última hora; el peor,")} ${nameOf(mk.peor.systemId)} (${mk.peor.kills})`;
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
  function lineaSalto(s: SaltoHecho): string {
    const espera = s.espera;
    const e = !espera
      ? tr("sales nada más acabar")
      : espera.quien === "cyno"
        ? `${tr("esperas")} ${minutos(espera.min)} ${tr("al cyno")}`
        : `${tr("esperas")} ${minutos(espera.min)} ${tr("de cooldown")}`;
    return `⤴ ${unDecimal(s.ly)} ${tr("al")} · ⛽ ${s.isotopos.toLocaleString(getLang())} ${s.isotopo} · ${e} · ${tr("quedas con")} ~${minutos(s.cooldownMin)} ${tr("de cooldown y")} ~${minutos(s.fatigaMin)} ${tr("de fatiga")}`;
  }
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
    if (catalogo && !casco) supuestos.push(tr("El casco de la ficha no está en el catálogo de naves de salto: se cuenta A PUERTAS con los minutos de la ficha."));
    if (salta == null) {
      supuestos.push(tr("Sin «quién salta»: se suponen Jump Drive Calibration y Jump Fuel Conservation a V, y sin fatiga."));
    } else {
      if (perfilErr) supuestos.push(`${tr("No se pudieron leer las skills de salto de")} ${nombrePj(salta)} (${perfilErr}): ${tr("se suponen a V.")}`);
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
    if (cyno == null) supuestos.push(tr("Sin «quién pone el cyno»: se supone que sale de donde el que salta (el origen)."));
    else if (cynoLoc == null) supuestos.push(`${tr("No se sabe dónde está")} ${nombrePj(cyno)}: ${tr("se supone que el cyno sale de donde el que salta (el origen).")}`);
  }
  // ---- editor de la forma de viajar ----
  const [editando, setEditando] = useState<FormaViaje | null>(null);
  const nuevaForma = (): FormaViaje => ({
    id: 0,
    nombre: "",
    modo: "salto",
    casco_type_id: null,
    ciclo_cyno_min: 1,
    min_por_salto: 1,
    planes: [],
  });
  async function guardarForma() {
    if (!editando || !plan) return;
    try {
      const id = await invoke<number>("forma_guardar", { forma: editando });
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
              <span className="route-stop-label">{tr("Forma de viajar")}</span>
              <select value={plan?.forma_id ?? ""} onChange={(e) => void fijarForma(e.target.value ? Number(e.target.value) : null)}>
                <option value="">{tr("A puertas (sin ficha)")}</option>
                {formas.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nombre}
                  </option>
                ))}
              </select>
              <button className="route-add" onClick={() => setEditando(forma ? { ...forma } : nuevaForma())}>
                {forma ? tr("Editar") : tr("Nueva")}
              </button>
              {forma && (
                <button className="route-add" onClick={() => setEditando(nuevaForma())}>
                  {tr("Nueva")}
                </button>
              )}
            </div>
            {editando && (
              <div className="plan-forma-editor small">
                <label>
                  {tr("Nombre")}:&nbsp;
                  <input value={editando.nombre} placeholder={tr("p. ej. blops con cyno covert")} onChange={(e) => setEditando({ ...editando, nombre: e.target.value })} />
                </label>
                <label>
                  {tr("Modo")}:&nbsp;
                  <select
                    value={editando.modo}
                    onChange={(e) => setEditando({ ...editando, modo: e.target.value as FormaViaje["modo"], casco_type_id: e.target.value === "puertas" ? null : editando.casco_type_id })}
                  >
                    <option value="salto">{tr("saltando, con cyno")}</option>
                    <option value="puertas">{tr("a puertas")}</option>
                  </select>
                </label>
                {editando.modo === "salto" && (
                  <>
                    <label>
                      {tr("Casco que salta")}:&nbsp;
                      <select
                        value={editando.casco_type_id ?? ""}
                        onChange={(e) => setEditando({ ...editando, casco_type_id: e.target.value ? Number(e.target.value) : null })}
                      >
                        <option value="">—</option>
                        {(catalogo?.ships ?? []).map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.group} · {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {tr("Ciclo del cyno (min)")}:&nbsp;
                      <input
                        type="number"
                        min={0.1}
                        step={0.5}
                        value={editando.ciclo_cyno_min}
                        style={{ width: "4.5rem" }}
                        onChange={(e) => setEditando({ ...editando, ciclo_cyno_min: parseFloat(e.target.value) || 0 })}
                      />
                      {(catalogo?.cynos ?? []).map((c) => (
                        <button key={c.id} className="route-add" title={c.name} onClick={() => setEditando({ ...editando, ciclo_cyno_min: c.cycleMin })}>
                          {c.name.replace(" Cynosural Field Generator", "").replace("Cynosural Field Generator", "") || c.name}: {c.cycleMin}
                        </button>
                      ))}
                    </label>
                  </>
                )}
                <label>
                  {editando.modo === "salto" ? tr("Minutos por salto del cyno") : tr("Minutos por salto")}:&nbsp;
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={editando.min_por_salto}
                    style={{ width: "4.5rem" }}
                    onChange={(e) => setEditando({ ...editando, min_por_salto: parseFloat(e.target.value) || 0 })}
                  />
                </label>
                <div>
                  <button className="route-add" onClick={() => void guardarForma()}>
                    {tr("Guardar")}
                  </button>
                  {editando.id > 0 && (
                    <button
                      className="route-add"
                      title={editando.planes.length ? `${tr("La usan")}: ${editando.planes.join(", ")}` : ""}
                      onClick={() => void borrarForma(editando.id)}
                    >
                      {tr("Borrar")}
                    </button>
                  )}
                  <button className="route-add" onClick={() => setEditando(null)}>
                    {tr("Cancelar")}
                  </button>
                </div>
              </div>
            )}
            {saltando && (
              <div className="route-stop">
                <span className="route-stop-label">{tr("Quién salta")}</span>
                <select value={salta ?? ""} onChange={(e) => void fijarPapeles(e.target.value ? Number(e.target.value) : null, cyno)}>
                  <option value="">—</option>
                  {characters.map((c) => (
                    <option key={c.character_id} value={c.character_id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <span className="route-stop-label">{tr("Quién pone el cyno")}</span>
                <select value={cyno ?? ""} onChange={(e) => void fijarPapeles(salta, e.target.value ? Number(e.target.value) : null)}>
                  <option value="">—</option>
                  {characters.map((c) => (
                    <option key={c.character_id} value={c.character_id}>
                      {c.name}
                    </option>
                  ))}
                </select>
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
                {forma.modo === "salto" ? tr("Minutos por salto del cyno") : tr("Minutos por salto")}: <b>{forma.min_por_salto}</b>{" "}
                ({tr("lo pone la ficha")} «{forma.nombre}»)
              </span>
            ) : (
              <label className="muted small">
                {tr("Minutos por salto")}:&nbsp;
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
                {tr("Salvas")} <b>{actual.salvadas}</b> {tr("de")} {paradas.length} ·{" "}
                {tr("recorrido")} {duracion(actual.recorridoMin)}
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
                    {marcasPlan.length > 0
                      ? `${marcasPlan.length} ${tr("avisos en el camino")}`
                      : tr("nada cantado en el camino")}
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
                                {r.saltos} {r.salto ? tr("saltos del cyno") : tr("saltos")} ·{" "}
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
                            {lineaSalto(s)}
                          </div>
                        ))}
                        {llega(r.estado) && <div className="small muted">{lineaMuertes(r)}</div>}
                        {lineaOtra(r) && <div className="small muted">🛡 {lineaOtra(r)}</div>}
                        {(() => {
                          const ms = marcasPlan.filter((m) => m.stop_id === r.stopId);
                          if (ms.length === 0) return null;
                          const idx = paradas.findIndex((x) => x.stopId === r.stopId);
                          const pos = tramos ? posponer(actual.orden, idx, paradas, tramos, ahora, minSaltoEf, minSitio, formaCalc) : null;
                          return (
                            <div className={`plan-intel ${ms.some((m) => m.aviso === "avisa") ? "suena" : "calla"}`}>
                              <div>⚠ {saltando ? tr("Intel en el camino del cyno") : tr("Intel en este tramo")}</div>
                              {ms.map((m) => (
                                <div key={`${m.sys_id}-${m.ts_ms}`} className="plan-intel-linea" title={m.message}>
                                  <b>{m.system}</b>{" "}
                                  {m.jumps === 0
                                    ? tr("en el camino")
                                    : `${m.jumps} ${tr("salto(s) del camino, junto a")} ${m.cerca_de_name}`}{" "}
                                  · {haceMin(m.ts_ms, Date.now())} — {m.author}: {m.message}
                                  <div className="plan-intel-aviso">{textoAviso(m.aviso)}</div>
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
                                {im.saltos} {tr("saltos")} ·{" "}
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
