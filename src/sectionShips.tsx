// Qué nave se pinta de fondo en cada sección, y cómo la SIGUE tu facción.
//
// EL PORQUÉ (idea de RoGiz7, 2026-08-12, al hilo de los temas por facción): la nave de fondo se
// elegía por ROL —el acorazado para PvP, el carguero para Patrimonio, el exhumer para minería— y la
// facción salía por casualidad. Con el tema Amarr puesto, PvP seguía enseñando un Megathron
// gallente. Ahora el rol manda igual, pero **la nave del rol es la de TU facción**.
//
// ⚠️ SOLO DOS ROLES CAMBIAN, y es a propósito:
//   · `guerra`  → el acorazado. Las DOCE facciones tienen uno propio (verificado en el SDE).
//   · `carga`   → el carguero. Solo lo tienen las cuatro imperiales y EDENCOM.
// Minería (Hulk), industria (Orca), exploración (Astero) y CRAB **NO se tocan**: son naves de ORE,
// SoE y CONCORD, y lo son PARA TODO EL MUNDO — un minero amarr también vuela un Hulk. Cambiarlas
// por «algo amarr» sería inventarse un dato que el juego no tiene.
//
// Las piratas no fabrican cargueros, así que para el rol `carga` caen a su RAZA MADRE (Guristas son
// caldari, los Angel minmatar, Blood y Sansha amarr, Serpentis gallente). El Triglaviano no tiene
// raza madre ni carguero: se queda con el neutro.
import type { Tab } from "./constants";

/** Rol visual de la sección. `null` = nave fija, no depende de la facción. */
type Rol = "guerra" | "carga" | "logi";

/** typeIDs sacados de `types.jsonl` del SDE (grupos 27 Battleship y 513 Freighter), no de memoria. */
const GUERRA: Record<string, number> = {
  amarr: 642, // Apocalypse
  caldari: 638, // Raven
  gallente: 641, // Megathron
  minmatar: 639, // Tempest
  nebula: 54733, // Thunderchild (EDENCOM)
  abismo: 47271, // Leshak (Triglavian)
  guristas: 17918, // Rattlesnake
  angel: 17738, // Machariel
  blood: 17920, // Bhaalgorn
  sansha: 17736, // Nightmare
  serpentis: 17740, // Vindicator
};

const CARGA: Record<string, number> = {
  amarr: 20183, // Providence
  caldari: 20185, // Charon
  gallente: 20187, // Obelisk
  minmatar: 20189, // Fenrir
  nebula: 81040, // Avalanche (EDENCOM)
  // Piratas → el carguero de su raza madre. No tienen uno propio y no vamos a inventarlo.
  guristas: 20185,
  angel: 20189,
  blood: 20183,
  sansha: 20183,
  serpentis: 20187,
};

/** El crucero de LOGÍSTICA de cada facción (decisión suya, 2026-09-16: «en logis que sea según la
 *  facción»). typeIDs verificados uno a uno contra `market_types.json` **y** contra el grupo de
 *  `ships.json`: los cinco son grupo `Logistics`, no vale con que el nombre suene.
 *
 *  ⚠️ Misma regla que `CARGA`, y por el mismo motivo: **no todas las facciones tienen uno**. Los
 *  cuatro imperios sí, y el Triglaviano también (Zarmazd). Los piratas NO fabrican logística, así
 *  que caen a su raza madre. **EDENCOM tampoco tiene**, y ahí no se inventa nada: cae a la nave
 *  fija de la sección. Inventarle un logi a una facción que no lo tiene sería el mismo error que
 *  cambiar el Hulk por «algo amarr». */
const LOGI: Record<string, number> = {
  amarr: 11987, // Guardian
  caldari: 11985, // Basilisk
  gallente: 11989, // Oneiros
  minmatar: 11978, // Scimitar
  abismo: 49713, // Zarmazd (Triglavian)
  // Piratas → el logi de su raza madre, igual que en CARGA.
  guristas: 11985,
  angel: 11978,
  blood: 11987,
  sansha: 11987,
  serpentis: 11989,
  // `nebula` (EDENCOM) NO está: no tienen crucero de logística. Cae a BASE a propósito.
};

/** ★★ LAS SECCIONES QUE VAN SIN NAVE, DECLARADAS UNA A UNA. No es documentación: junto con el tipo
 *  de `BASE` es lo que hace que **olvidarse de una sección nueva NO COMPILE**.
 *
 *  El problema que esto arregla: entre la v0.33.0 y el 2026-09-16 nacieron NUEVE secciones que se
 *  quedaron sin fondo sin que nadie se enterara. Olvidarse de `BASE` no daba ningún error — la
 *  sección salía sin arte, que es **indistinguible de «se decidió que no lleve»**. Otro fallo
 *  silencioso de la familia de siempre. Ahora hay que elegir, y el compilador lo exige. */
const SIN_ARTE = [
  "mapa", // es un mapa: un fondo sería ruido sobre el propio contenido
  "notas", // sección de texto; el fondo competiría con lo que se lee
  "bitacora", // ⏳ las tres esperan un interior de estación, que el Image Server no sirve (es arte
  "diario", //    de cliente). `SectionArt` acepta `src`, como resolvió Social con su captura.
  "recon",
  "social", // tiene arte PROPIO: public/social-hangar.jpg, vía <SectionArt src> en App.tsx
] as const;

/** Nave por defecto de cada sección: la que se ha usado hasta hoy. Es también la reserva cuando el
 *  tema no tiene nave para ese rol (el Triglaviano no tiene carguero) o cuando el tema es el
 *  dinámico de Koru, que no es de ninguna facción.
 *
 *  ⚠️ El tipo NO es `Partial`: **toda pestaña que no esté en `SIN_ARTE` tiene que estar aquí**. Si
 *  añades una sección y no decides, `tsc` te lo dice con su nombre. */
const BASE: Record<Exclude<Tab, (typeof SIN_ARTE)[number]>, number> = {
  pvp: 641,
  rivales: 641,
  batallas: 641,
  cazador: 641,
  resumen: 641,
  actividad: 641,
  patrimonio: 20185,
  wallet: 20185,
  skills: 47466,
  assets: 20185,
  contactos: 47466,
  lealtad: 47466,
  fiteos: 47466,
  comercio: 20183,
  comercio_pnl: 20183,
  comercio_watch: 20183,
  comercio_contratos: 20183,
  planetologia: 20183,
  rateo: 645,
  mineria: 22544,
  factional: 638,
  abyssals: 17715,
  crab: 19726,
  campanas: 44996,
  industria: 28606,
  exploracion: 33468,
  exploracion_log: 33468,
  // ★ LAS NUEVE QUE SE HABÍAN QUEDADO SIN FONDO (2026-09-16). El rollout de la «carta de la
  //   Agencia» se hizo en la v0.33.0 y desde entonces han nacido secciones enteras que nunca
  //   entraron aquí: se ve al cruzar el union `Tab` con este mapa. **No fue un olvido puntual: es
  //   que esto hay que tocarlo a mano cada vez que nace una sección** — dicho aquí para que quien
  //   añada la siguiente se acuerde.
  escalaciones: 641, // rol `guerra` → acorazado de tu facción, como PvP y Rateo. Es combate tuyo.
  // Flotas, ops y «con quién vuelas» comparten el MONITOR (grupo Flag Cruiser, verificado): el
  // crucero insignia de observación, que es literalmente lo que hace un grabador de flotas.
  flotas: 45534,
  ops: 45534,
  vuelas: 45534,
  inventario: 20185, // rol `carga` → hermanas de Assets y Patrimonio
  naves: 20185, // rol `carga`
  logis: 11987, // rol `logi` → el crucero de logística de tu facción
  freelance: 3756, // Gnosis: la nave de proyectos y experimentos, sin facción
};
// Social NO está en BASE a propósito: lleva CAPTURA PROPIA de un hangar (public/social-hangar.jpg,
// suya del 2026-08-22, sin UI) vía <SectionArt src> en App.tsx — el interior de estación que el
// Image Server no puede dar (arte de cliente, misma conclusión que el interior de Jita para la
// Bitácora). Primera sección con arte real de dentro de una estación.

/** Qué secciones siguen a la facción, y con qué rol. Las que no están aquí mantienen su nave fija. */
const ROL: Partial<Record<Tab, Rol>> = {
  pvp: "guerra",
  rivales: "guerra",
  batallas: "guerra",
  cazador: "guerra",
  resumen: "guerra",
  actividad: "guerra",
  rateo: "guerra",
  factional: "guerra",
  patrimonio: "carga",
  wallet: "carga",
  assets: "carga",
  comercio: "carga",
  comercio_pnl: "carga",
  comercio_watch: "carga",
  comercio_contratos: "carga",
  planetologia: "carga",
  escalaciones: "guerra",
  inventario: "carga",
  naves: "carga",
  logis: "logi",
};

/** La nave de fondo de una sección con el tema puesto. Si el tema no aporta nada (el de Koru, o un
 *  rol que esa facción no cubre), devuelve la de siempre — nunca se queda sin fondo. */
export function shipForSection(tab: Tab, theme: string): number | undefined {
  const rol = ROL[tab];
  if (rol) {
    const tabla = rol === "guerra" ? GUERRA : rol === "carga" ? CARGA : LOGI;
    const n = tabla[theme];
    if (n) return n;
  }
  // El `as Partial` es de LECTURA y no afloja nada: aquí `tab` puede ser una de `SIN_ARTE`, que a
  // propósito no está en el mapa y debe devolver `undefined`. La exhaustividad se exige donde se
  // DECLARA `BASE`, que es donde se decide — comprobado quitando una sección: `tsc` la nombra.
  return (BASE as Partial<Record<Tab, number>>)[tab];
}
