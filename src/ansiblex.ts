// Importación de la red de Ansiblex (jump bridges) de la alianza por PEGADO de texto.
//
// POR QUÉ PEGADO Y NO UN FICHERO: la topología de la red NO la da ESI. No existe endpoint ni scope
// de Ansiblex; lo único que los enseña es `/corporations/{id}/structures` (rol Director, solo tu
// corp, y encima SIN el destino: habría que deducirlo del nombre). Así que el dato llega de fuera:
// de la tabla que publica la alianza en su wiki. Y lo que el usuario hace de verdad con esa tabla
// es seleccionarla y copiarla — no guardarla en un .txt para luego buscarla en un diálogo. El
// pegado se traga lo que sale del portapapeles tal cual (título, cabecera, columnas de más).
//
// REGLA DE PARSEO: no nos fiamos del ORDEN de las columnas, nos anclamos al CONTENIDO. Una línea
// vale si contiene EXACTAMENTE DOS campos que resuelven a sistemas REALES de New Eden
// (neweden.json). Esos dos campos parten la línea en tres: lo de delante (la región, que
// ignoramos porque el SDE ya nos la da) y lo de detrás (estado, dueño, ly, ruta), de donde
// sacamos los extras POR FORMA. Lo que no entendemos NO se traga en silencio: se cuenta y se
// enseña (misma regla que la franja del intel — un fallo mudo nos costó dos diagnósticos falsos).
//
// TRAMPA YA PISADA: no vale con "coger la primera palabra corta como dueño". Las regiones de una
// sola palabra (Cache, Catch, Detorid, Immensea, Omist, Tenerifis…) van las primeras y pasan
// cualquier filtro de forma; se colaban como dueño. De ahí el anclaje a los dos sistemas.
import type { NeSystem } from "./types";

/** Un puente ya resuelto contra el SDE. Par CANÓNICO: aId < bId siempre, para que el puente sea
 *  UNA fila y no dos. El wiki lista cada puente dos veces (una por extremo) porque cada punta es
 *  una estructura distinta —con su propio dueño—, pero para el grafo es una sola arista. */
export type AnsiblexBridge = {
  aId: number;
  aName: string;
  bId: number;
  bName: string;
  /** Años luz DECLARADOS por la fuente. Informativo: el bueno lo calculamos de gx/gy/gz.
   *  OJO: con el cambio de septiembre-2026 esta distancia NO determina el coste de condensador
   *  (el coste depende de la ZONA del Ansiblex destino respecto al capital de la alianza). */
  ly: number | null;
  ownerA: string | null;
  ownerB: string | null;
  route: string | null;
  status: string | null;
};

/** Un puente tal y como lo guarda y lo devuelve Rust (`ansiblex_list` / `ansiblex_replace`).
 *  Compartido por el control de Ajustes y por el mapa. */
export type AnsiblexRow = {
  a_id: number;
  b_id: number;
  a_name: string;
  b_name: string;
  ly_declared: number | null;
  owner_a: string | null;
  owner_b: string | null;
  route: string | null;
  status: string | null;
  source: string;
};

/** Clave canónica de una arista, para poder preguntar «¿este tramo fue por puente?» sin
 *  preocuparse del sentido. */
export function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/** type_id del Standup Ansiblex Jump Bridge en el SDE. El servidor de imágenes de EVE tiene su
 *  icono real (verificado: `/types/35841` responde ["render","icon"]) → typeIcon(ANSIBLEX_TYPE_ID)
 *  da el mismo dibujo que ves in-game, en vez del emoji 🌉 que desentonaba. */
export const ANSIBLEX_TYPE_ID = 35841;

export type AnsiblexParseReport = {
  bridges: AnsiblexBridge[];
  /** Filas dirigidas reconocidas (el wiki trae 2 por puente). */
  recognized: number;
  /** Líneas que no supimos leer, con una muestra para enseñarla. */
  ignored: number;
  ignoredSample: string[];
  /** Nombres que PARECÍAN sistema pero no están en el SDE. Casi siempre = errata al copiar. */
  unknownNames: string[];
  /** Puentes declarados en un solo sentido. No rompe el grafo (es no dirigido), pero suele
   *  significar que el pegado se cortó a medias, así que se avisa. */
  oneWay: { a: string; b: string }[];
};

/** Un nombre de sistema de New Eden: "1DQ1-A", "T6GY-Y", "Jita", "PS-94K". Admite el sufijo de
 *  ubicación que trae el wiki ("C-6YHJ @ 1-1") y lo descarta. */
const SYSTEM_FIELD = /^([A-Za-z0-9][A-Za-z0-9-]{1,14})(?:\s*@.*)?$/;
/** Un número decimal suelto (la columna de años luz). */
const DECIMAL = /^\d+(?:\.\d+)?$/;
const STATUS = /^(online|offline|unanchoring|anchoring)$/i;
const YESNO = /^(yes|no|s[ií])$/i;
/** Forma de nombre de sistema de nullsec ("C-6YHJ", "1DQ1-A"). Sirve para no llenar el aviso de
 *  "sistemas desconocidos" con ruido: sin esto, una fila con una errata chivaba TODAS sus celdas
 *  (Cache, FNT, Grey, Online, Yes…) como si fueran sistemas que no encontramos. */
const NULLSEC_SHAPED = /^[A-Za-z0-9]{1,6}-[A-Za-z0-9]{1,6}$/;

/** Parte una línea en campos. El portapapeles da tabuladores casi siempre, pero si alguien pega
 *  desde una vista renderizada llegan espacios: aceptamos 2+ espacios como separador. UN espacio
 *  NO vale — partiría "Paragon Soul" o "Wicked Creek" en dos. */
function splitFields(line: string): string[] {
  return line
    .split(/\t|\s{2,}/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

/** Resuelve un campo a sistema del SDE, o null. */
function toSystem(field: string, byName: Map<string, NeSystem>): NeSystem | null {
  const m = SYSTEM_FIELD.exec(field);
  if (!m) return null;
  return byName.get(m[1].toLowerCase()) ?? null;
}

/**
 * Parsea el pegado de la tabla de Ansiblex de la alianza.
 *
 * @param text   Lo que haya en el portapapeles, tal cual.
 * @param byName Índice nombre(minúsculas)→sistema del SDE. El mapa ya lo tiene (`geo.nameIdx`);
 *               fuera del mapa se construye con loadNewEden().
 */
export function parseAnsiblexPaste(
  text: string,
  byName: Map<string, NeSystem>
): AnsiblexParseReport {
  const ignoredSample: string[] = [];
  const unknown = new Set<string>();
  let recognized = 0;
  let ignored = 0;

  // Clave canónica "menorId-mayorId" → puente. Fusiona las dos direcciones en una sola arista.
  const merged = new Map<string, AnsiblexBridge>();
  const seenDirected = new Set<string>();

  const skip = (line: string) => {
    ignored++;
    if (ignoredSample.length < 8) ignoredSample.push(line.slice(0, 80));
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const fields = splitFields(line);

    // Anclaje: ¿qué campos son sistemas de verdad, y en qué posición?
    const anchors: { i: number; sys: NeSystem }[] = [];
    const misses: string[] = [];
    fields.forEach((f, i) => {
      const sys = toSystem(f, byName);
      if (sys) anchors.push({ i, sys });
      else {
        const m = SYSTEM_FIELD.exec(f);
        // Solo lo damos por "sistema que no encontramos" si la celda de verdad lo parecía: o traía
        // el sufijo de ubicación del wiki ("X @ 1-1"), o tiene forma de sistema de nullsec. Si no,
        // el aviso se llenaría de basura (dueños, colores de ruta, "Online", "Yes"…).
        if (m && (f.includes("@") || NULLSEC_SHAPED.test(m[1]))) misses.push(m[1]);
      }
    });

    if (anchors.length !== 2 || anchors[0].sys.id === anchors[1].sys.id) {
      skip(line);
      // Una línea con menos de dos anclas pero con celdas CON PINTA de sistema = errata al copiar.
      // Merece la pena decirlo: es la causa nº1 de que falte un puente.
      if (anchors.length < 2) for (const m of misses) unknown.add(m);
      continue;
    }

    const from = anchors[0].sys;
    const to = anchors[1].sys;
    recognized++;
    seenDirected.add(`${from.id}>${to.id}`);

    // Todo lo que va DETRÁS del segundo sistema: estado, dueño, contraseña, ly, ruta, friendly.
    // Lo de delante es la región, y esa ya nos la da el SDE (comprobado: coincide en las 194).
    const trailing = fields.slice(anchors[1].i + 1);
    const ly = trailing.map((f) => (DECIMAL.test(f) ? parseFloat(f) : null)).find((v) => v != null) ?? null;
    const status = trailing.find((f) => STATUS.test(f)) ?? null;
    // Lo que queda tras quitar forma conocida: primero el dueño, último la ruta.
    const rest = trailing.filter((f) => !DECIMAL.test(f) && !STATUS.test(f) && !YESNO.test(f) && f !== "-");
    const owner = rest.length > 0 ? rest[0] : null;
    const route = rest.length > 1 ? rest[rest.length - 1] : null;

    const [aSys, bSys] = from.id < to.id ? [from, to] : [to, from];
    const key = `${aSys.id}-${bSys.id}`;
    const bridge: AnsiblexBridge = merged.get(key) ?? {
      aId: aSys.id,
      aName: aSys.n,
      bId: bSys.id,
      bName: bSys.n,
      ly: null,
      ownerA: null,
      ownerB: null,
      route: null,
      status: null,
    };
    if (bridge.ly == null && ly != null) bridge.ly = ly;
    if (bridge.status == null && status) bridge.status = status;
    if (bridge.route == null && route) bridge.route = route;
    // El dueño va en la fila de CADA extremo: cada punta del puente es una estructura distinta y
    // puede ser de otra corp (7 de los 97 puentes de la Webway lo son). El dueño de esta fila es
    // el del sistema ORIGEN de esta dirección.
    if (owner) {
      if (from.id === aSys.id) bridge.ownerA = bridge.ownerA ?? owner;
      else bridge.ownerB = bridge.ownerB ?? owner;
    }
    merged.set(key, bridge);
  }

  const oneWay: { a: string; b: string }[] = [];
  for (const d of seenDirected) {
    const [x, y] = d.split(">");
    if (!seenDirected.has(`${y}>${x}`)) {
      const b = merged.get(Number(x) < Number(y) ? `${x}-${y}` : `${y}-${x}`);
      if (b) oneWay.push({ a: b.aName, b: b.bName });
    }
  }

  return {
    bridges: [...merged.values()].sort((p, q) => p.aName.localeCompare(q.aName)),
    recognized,
    ignored,
    ignoredSample,
    unknownNames: [...unknown].sort(),
    oneWay,
  };
}

/** Distancia real en años luz entre dos sistemas. Los campos gx/gy/gz de neweden.json YA están en
 *  años luz: verificado contra las 97 distancias publicadas en el wiki de la alianza (ratio 1.000,
 *  desviación máxima 0,005 ly = el redondeo del propio wiki). De aquí saldrá el cálculo de ZONAS
 *  del modelo de coste de septiembre-2026 sin necesitar ningún dato nuevo. */
export function lightYears(a: NeSystem, b: NeSystem): number {
  const dx = a.gx - b.gx;
  const dy = a.gy - b.gy;
  const dz = a.gz - b.gz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
