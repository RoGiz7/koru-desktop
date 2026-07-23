// Parser del LOOT pegado desde el inventario/carguero de EVE (para el modal de "marcar hecha").
//
// Formato del "Copiar" de EVE (separado por TABuladores, columnas según las que tengas visibles):
//   Nombre \t Cantidad \t Grupo \t [Tamaño] \t [Slot] \t Volumen \t [Meta] \t PrecioEst. ISK
// Sorpresa útil: si tienes la columna "Precio estimado", cada línea trae ya su VALOR total
// ("373.074,21 ISK"). Sumamos esa columna → total exacto, tal y como lo ves en el juego, SIN tener
// que resolver cada item ni su precio. Si el pegado NO trae precios, valoramos por nombre→typeID
// (índice ES/EN, ver `buildLootIndex`) contra los precios locales — esa es la RED, no el camino normal.
//
// OJO cliente ES (misma trampa que las firmas): los números vienen "1.234.567,89" → el PUNTO es
// separador de MILES y la COMA el decimal. Validado contra DOS pegados reales (RoGiz7, 2026-07-23):
// con tabs y con los tabs convertidos en espacios (peor caso) el total y los items salen idénticos.

/** Índice nombre-en-minúsculas → typeID (EN de market_types + ES de type_names_es). */
export type LootIndex = Map<string, number>;

export type LootItem = {
  name: string;
  qty: number;
  /** Valor total de la línea según la columna de precio de EVE (null si el pegado no la trae). */
  iskFromPaste: number | null;
  /** typeID resuelto contra el índice (null si no se reconoció el nombre). */
  typeId: number | null;
};

export type LootParse = {
  items: LootItem[];
  /** Suma de la columna de precio de EVE (0 si no hay ninguna). */
  totalFromPaste: number;
  /** Cuántas líneas traían precio de EVE. */
  pricedLines: number;
  /** Líneas de item detectadas (con nombre). */
  itemLines: number;
};

/** Carga market_types.json (EN) + type_names_es.json (ES) y construye el índice nombre→typeID.
 *  Una sola vez; el llamante lo cachea. Si falla, devuelve un mapa vacío (el parser sigue dando el
 *  total por la columna de EVE, solo pierde la resolución de typeID). */
export async function buildLootIndex(): Promise<LootIndex> {
  const idx: LootIndex = new Map();
  try {
    const [mt, esRaw] = await Promise.all([
      fetch("/market_types.json").then((r) => r.json()),
      fetch("/type_names_es.json").then((r) => r.json()),
    ]);
    for (const t of mt as { i: number; n: string }[]) idx.set(t.n.trim().toLowerCase(), t.i);
    for (const [name, id] of Object.entries(esRaw as Record<string, number>)) idx.set(name, id);
  } catch {
    /* red: sin índice, el total sigue saliendo de la columna de EVE */
  }
  return idx;
}

/** Interpreta un valor de ISK cómodo tecleado a mano: "45m" = 45.000.000, "1,2b" =
 *  1.200.000.000, "500k" = 500.000, o un número plano. Acepta coma o punto decimal. null si vacío. */
export function parseIskShorthand(s: string): number | null {
  const t = s.trim().toLowerCase().replace(/\s/g, "");
  if (!t) return null;
  const m = t.match(/^([0-9]*[.,]?[0-9]+)\s*([kmb])?$/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  if (!isFinite(n)) return null;
  const mult = m[2] === "b" ? 1e9 : m[2] === "m" ? 1e6 : m[2] === "k" ? 1e3 : 1;
  return Math.round(n * mult);
}

/** "1.234.567,89" (ES) → 1234567.89. Quita los puntos de millar y usa la coma como decimal. */
export function parseEsNumber(s: string): number {
  const t = s.trim().replace(/\./g, "").replace(",", ".");
  const n = parseFloat(t);
  return isFinite(n) ? n : 0;
}

/** Nombre más largo, empezando por la izquierda, que exista en el índice. Blinda el caso en que el
 *  pegado perdió los tabuladores (todo en una línea con espacios simples): probamos prefijos
 *  crecientes y nos quedamos con el más largo reconocido. Devuelve [nombre, typeId] o null. */
function longestNamePrefix(line: string, index: LootIndex): [string, number] | null {
  const toks = line.split(" ");
  let best: [string, number] | null = null;
  const cur: string[] = [];
  for (const t of toks) {
    cur.push(t);
    const cand = cur.join(" ").trim();
    const id = index.get(cand.toLowerCase());
    if (id != null) best = [cand, id];
  }
  return best;
}

/** Parsea un pegado de inventario de EVE. Robusto a que las columnas cambien y a que se pierdan los
 *  tabuladores. El NOMBRE es el primer campo (o, sin tabs, el prefijo reconocido más largo); el
 *  PRECIO se saca por regex de la línea (independiente de columna); la cantidad es el primer campo
 *  numérico tras el nombre. Pásale el índice (de `buildLootIndex`) para resolver typeID. */
export function parseLootPaste(text: string, index?: LootIndex): LootParse {
  const items: LootItem[] = [];
  let totalFromPaste = 0;
  let pricedLines = 0;
  let itemLines = 0;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    const parts = line.split(/\t| {2,}/).map((p) => p.trim());
    let name = parts[0]?.trim() ?? "";
    let typeId: number | null = null;

    // Sin delimitadores (una sola columna) → coincidencia por prefijo con el índice.
    if (parts.length <= 1 && index && index.size > 0) {
      const lp = longestNamePrefix(line, index);
      if (lp) {
        name = lp[0];
        typeId = lp[1];
      }
    }
    if (!name) continue;
    if (/^(name|nombre)$/i.test(name)) continue; // cabecera pegada sin querer
    if (typeId == null && index) typeId = index.get(name.toLowerCase()) ?? null;
    itemLines += 1;

    // Cantidad: primer campo numérico entre los 2 siguientes al nombre (puede venir vacío = 1).
    let qty = 1;
    for (const p of parts.slice(1, 3)) {
      const q = p.replace(/\./g, "");
      if (/^\d+$/.test(q)) {
        qty = parseInt(q, 10);
        break;
      }
    }

    // Precio: última cifra "… ISK" de la línea (independiente de columnas).
    const m = line.match(/([\d.]+,\d+)\s*ISK\s*$/);
    const iskFromPaste = m ? parseEsNumber(m[1]) : null;
    if (iskFromPaste != null) {
      totalFromPaste += iskFromPaste;
      pricedLines += 1;
    }

    items.push({ name, qty, iskFromPaste, typeId });
  }

  return { items, totalFromPaste, pricedLines, itemLines };
}
