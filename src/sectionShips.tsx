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
type Rol = "guerra" | "carga";

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

/** Nave por defecto de cada sección: la que se ha usado hasta hoy. Es también la reserva cuando el
 *  tema no tiene nave para ese rol (el Triglaviano no tiene carguero) o cuando el tema es el
 *  dinámico de Koru, que no es de ninguna facción. */
const BASE: Partial<Record<Tab, number>> = {
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
};

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
  planetologia: "carga",
};

/** La nave de fondo de una sección con el tema puesto. Si el tema no aporta nada (el de Koru, o un
 *  rol que esa facción no cubre), devuelve la de siempre — nunca se queda sin fondo. */
export function shipForSection(tab: Tab, theme: string): number | undefined {
  const rol = ROL[tab];
  if (rol) {
    const tabla = rol === "guerra" ? GUERRA : CARGA;
    const n = tabla[theme];
    if (n) return n;
  }
  return BASE[tab];
}
