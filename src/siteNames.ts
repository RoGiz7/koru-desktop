// Traducción de nombres de SITIO (anomalías/firmas) del español al inglés, para los enlaces a wikis.
//
// El escáner de sondas da el nombre en el idioma del CLIENTE (p. ej. «Santuario de los Ángeles»), pero
// las wikis (EVE University, etc.) usan el título en INGLÉS («Angel Sanctum») → buscar con el nombre
// español no encontraba nada. Los nombres de sitio son nombres de DUNGEON, y —al contrario de lo que
// creíamos— el export del SDE (jun-2026) SÍ los trae localizados en 8 idiomas (`dungeons.jsonl`). De
// ahí sale `public/dungeon_names.json` = { nombre_es_en_minúsculas: "Nombre EN" } (1.000 entradas).
//
// Estrategia: coincidencia EXACTA por nombre ES; si no hay match (cliente ya en inglés, variante que el
// SDE no tenga, etc.) se usa el nombre tal cual → mejora estricta, nunca empeora. Ver el bloque §3 de
// koru-nombres-localizados-trampa.

/** Índice nombre-de-sitio-ES (minúsculas) → nombre EN. */
export type DungeonIndex = Map<string, string>;

/** Carga `public/dungeon_names.json` una vez (cachéalo en el llamante). Mapa vacío si falla. */
export async function buildDungeonIndex(): Promise<DungeonIndex> {
  try {
    const raw = (await fetch("/dungeon_names.json").then((r) => r.json())) as Record<string, string>;
    return new Map(Object.entries(raw));
  } catch {
    return new Map();
  }
}

/** Nombre del sitio en inglés si lo conocemos; si no, el mismo nombre (que ya puede estar en inglés). */
export function siteNameEn(name: string, index: DungeonIndex): string {
  if (!name) return name;
  return index.get(name.trim().toLowerCase()) ?? name;
}

/** URL de búsqueda en la wiki de EVE University con el nombre en INGLÉS (traducido si hace falta). */
export function siteWikiUrl(name: string, index: DungeonIndex): string {
  return `https://wiki.eveuniversity.org/index.php?search=${encodeURIComponent(siteNameEn(name, index))}`;
}
