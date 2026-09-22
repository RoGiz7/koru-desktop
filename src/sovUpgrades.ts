// ★ MEJORAS DE SOBERANÍA (Equinox) declaradas por la alianza — el parser del pegado (2026-09-22).
//
// ESI no dice qué mejora tiene instalada cada sistema (ni ruta ni scope), así que las alianzas
// lo reparten en hojas de cálculo. La que vimos tiene una pestaña por región y cuatro columnas:
// `solarSystemName · regionName · constellationName · upgrades`, una fila por sistema y en
// `upgrades` los nombres TAL CUAL LOS ESCRIBE EL JUEGO separados por coma sin espacio
// («Major Threat Detection Array 1,Pyerite Prospecting Array 3»), vacía si no hay nada.
//
// Mismo trato que la red de Ansiblex (`ansiblex.ts`): aquí no se guarda nada; se lee, se resuelve
// contra el SDE y se devuelve una lista para que el piloto la revise y confirme. Tolerante con la
// forma: da igual el título, la cabecera, el número de fila o columnas de más — de cada línea se
// busca el PRIMER token que sea un sistema real y lo que venga después se lee como mejoras.
// Una mejora que no está en el catálogo NO se inventa: sale en `unknownUpgrades` y en grande.
import { loadJson } from "./staticJson";
import type { NeSystem } from "./types";

/** Una entrada del catálogo (`public/sov_upgrades.json`, de `extract_sov_upgrades.py`). */
export type SovUpgradeDef = {
  i: number;
  n: string;
  ne: string;
  k: "amenaza-menor" | "amenaza-mayor" | "mineral" | "exploracion" | "efecto" | "servicio" | "colonia";
  lvl: number | null;
  m: string | null;
  d: string;
  de: string;
};

/** Lo que guarda Rust (una fila por sistema × mejora). Espejo de `SovUpgradeRow`. */
export type SovUpgradeRow = {
  system_id: number;
  type_id: number;
  system_name: string;
  type_name: string;
  source?: string | null;
  updated_at?: string | null;
};

let catalogPromise: Promise<SovUpgradeDef[]> | null = null;
export function loadSovUpgrades(): Promise<SovUpgradeDef[]> {
  if (!catalogPromise) catalogPromise = loadJson<SovUpgradeDef[]>("/sov_upgrades.json", []);
  return catalogPromise;
}

/** Sistema con sus mejoras, ya resuelto. `upgrades` puede ir vacío (la hoja lo dice así). */
export type SovSystemParsed = {
  systemId: number;
  systemName: string;
  regionId: number;
  upgrades: SovUpgradeDef[];
  /** Nombres de mejora de ESA fila que no cuadran con el catálogo (errata o cosa nueva). */
  unknown: string[];
};

export type SovParseReport = {
  systems: SovSystemParsed[];
  /** Líneas con contenido que no traían ningún sistema reconocible. */
  ignored: number;
  ignoredSample: string[];
  /** Mejoras no reconocidas, únicas, para enseñarlas juntas. */
  unknownUpgrades: string[];
  /** Cuántas filas venían sin mejora alguna (se leen, pero no hay nada que guardar). */
  emptyRows: number;
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Lee el pegado. `byName` = sistemas del SDE por nombre en minúsculas (como en Ansiblex);
 * `regionNames` / `constNames` = para saltar esas columnas sin tomarlas por mejoras.
 */
export function parseSovUpgradesPaste(
  text: string,
  byName: Map<string, NeSystem>,
  regionNames: Set<string>,
  constNames: Set<string>,
  catalog: SovUpgradeDef[],
): SovParseReport {
  const byUpgrade = new Map<string, SovUpgradeDef>();
  for (const u of catalog) {
    byUpgrade.set(norm(u.n), u);
    byUpgrade.set(norm(u.ne), u);
  }
  const porSistema = new Map<number, SovSystemParsed>();
  const unknownUpgrades = new Set<string>();
  let ignored = 0;
  let emptyRows = 0;
  const ignoredSample: string[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // Google Sheets copia con tabuladores; el volcado en texto de la alianza va como
    // «SISTEMA <- Mejora, Mejora» (visto el 2026-09-22: 498 líneas, hasta tres mejoras); un wiki
    // o un CSV a mano puede venir con «;», «:», «=» o dos espacios. La coma NO separa columnas
    // aquí: es el separador de las mejoras.
    let cells = line.includes("\t") ? line.split("\t") : line.split(/<-|->|=>|=|:|;|\s{2,}/);
    cells = cells.map((c) => c.trim());
    const sysIdx = cells.findIndex((c) => byName.has(norm(c)));
    if (sysIdx < 0) {
      ignored++;
      if (ignoredSample.length < 8) ignoredSample.push(line.slice(0, 80));
      continue;
    }
    const sys = byName.get(norm(cells[sysIdx]))!;
    const resto = cells
      .slice(sysIdx + 1)
      .filter((c) => c && !/^\d+$/.test(c) && !regionNames.has(norm(c)) && !constNames.has(norm(c)) && !byName.has(norm(c)));
    const entrada = porSistema.get(sys.id) ?? {
      systemId: sys.id,
      systemName: sys.n,
      regionId: sys.r,
      upgrades: [],
      unknown: [],
    };
    const nombres = resto
      .join(",")
      .split(/,|\||\n/)
      .map((s) => s.trim())
      .filter((s) => s && norm(s) !== "upgrades" && norm(s) !== "mejoras");
    if (nombres.length === 0) emptyRows++;
    for (const nombre of nombres) {
      const def = byUpgrade.get(norm(nombre));
      if (!def) {
        unknownUpgrades.add(nombre);
        if (!entrada.unknown.includes(nombre)) entrada.unknown.push(nombre);
        continue;
      }
      if (!entrada.upgrades.some((u) => u.i === def.i)) entrada.upgrades.push(def);
    }
    porSistema.set(sys.id, entrada);
  }
  const systems = [...porSistema.values()].sort((a, b) => a.systemName.localeCompare(b.systemName));
  return { systems, ignored, ignoredSample, unknownUpgrades: [...unknownUpgrades].sort(), emptyRows };
}

/** Icono por clase de mejora: para el mapa, la ficha y la tabla de revisión. */
export function sovKindIcon(k: SovUpgradeDef["k"]): string {
  switch (k) {
    case "amenaza-mayor":
      return "💀";
    case "amenaza-menor":
      return "☠️";
    case "mineral":
      return "⛏️";
    case "exploracion":
      return "🛰️";
    case "efecto":
      return "🌀";
    case "servicio":
      return "🔧";
    default:
      return "🏭";
  }
}

/** Etiqueta corta de una mejora: «Major 3», «Zydrine 3», «Exotic», «Cyno jammer»… */
export function sovShortLabel(u: SovUpgradeDef): string {
  switch (u.k) {
    case "amenaza-mayor":
      return `Major ${u.lvl ?? ""}`.trim();
    case "amenaza-menor":
      return `Minor ${u.lvl ?? ""}`.trim();
    case "mineral":
      return `${u.m ?? ""} ${u.lvl ?? ""}`.trim();
    case "exploracion":
      return `Explo ${u.lvl ?? ""}`.trim();
    case "efecto":
      return u.n.replace(" Stability Generator", "");
    default:
      return u.n;
  }
}
