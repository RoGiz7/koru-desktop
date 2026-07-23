// Importación de FIRMAS y ANOMALÍAS del escáner de sondas por PEGADO de texto.
//
// POR QUÉ PEGADO (igual que Ansiblex): el escáner de sondas es una ventana del cliente, no un dato
// de ESI. Lo que el piloto hace con esa ventana es Ctrl+A / Ctrl+C. El pegado se traga lo que salga
// del portapapeles tal cual: seis columnas separadas por tabulador — ID, grupo, categoría, nombre,
// señal, distancia.
//
// LO QUE EL PEGADO NO TRAE = EL SISTEMA. Igual que la tabla de Ansiblex no traía la región, el
// escáner no dice a qué sistema pertenecen las firmas: eso lo pone el piloto (por defecto, el
// sistema donde está su personaje). «Lo que el dato no tiene, lo aporta quien lo mira.»
//
// TRAMPA DE LA DISTANCIA (cazada con un pegado real, cliente en ES): la distancia viene localizada.
// "2,36 AU" usa la coma como decimal, pero "4.132 m" usa el PUNTO como separador de MILES (= 4132
// metros, no 4,132 AU). Si se tratara el punto como decimal a la inglesa, ese sitio saldría 150
// millones de veces más lejos. Solución: olfatear el separador decimal de la columna de SEÑAL
// (siempre trae exactamente un decimal: "100,0 %" → coma; "100.0%" → punto) y aplicarlo a la
// distancia. El ID de firma ("QLO-590") es igual en todos los idiomas y es nuestro ancla.
//
// LOCALIZACIÓN: grupo y categoría vienen en el idioma del cliente. Se normalizan por una tabla
// ES+EN (misma familia de trampa que el gamelog: parsear el VISIBLE, no asumir un idioma).

/** Familia de la firma. Las ANOMALÍAS salen al 100 % sin sondear; las FIRMAS hay que escanearlas
 *  (y entre ellas están los wormholes, que es lo que engancha con las rutas). */
export type SigGroup = "anomaly" | "signature";

/** Tipo de sitio, normalizado y agnóstico de idioma. `unknown` = firma aún sin identificar (la
 *  columna de categoría viene vacía hasta que la señal sube lo bastante). */
export type SigKind = "combat" | "ore" | "gas" | "data" | "relic" | "wormhole" | "unknown";

/** Una firma ya parseada del pegado. La distancia se guarda en AU (unidad canónica), pero se
 *  conserva la cadena original para poder enseñarla tal cual la vio el piloto. */
export type ParsedSignature = {
  /** ID del escáner: 3 letras, guion, 3 dígitos ("QLO-590"). Estable dentro del sistema hasta el
   *  siguiente downtime. Es la CLAVE de deduplicado. */
  id: string;
  group: SigGroup;
  kind: SigKind;
  /** Nombre del sitio ("Madriguera de los Ángeles"), o "" si aún no está identificado. */
  name: string;
  /** 0–100. null si la columna no venía (raro). */
  signalPct: number | null;
  /** Distancia en AU. null si no había columna de distancia. */
  distanceAu: number | null;
  /** La distancia tal cual la copió el cliente ("2,36 AU", "4.132 m"). */
  distanceRaw: string | null;
};

/** Una firma tal y como la guarda y la devuelve Rust (`signatures_list` / `signatures_replace_system`).
 *  `note` es la anotación del piloto (p. ej. el destino de un wormhole) y NO se pierde al re-pegar. */
export type SignatureRow = {
  system_id: number;
  sig_id: string;
  sig_group: SigGroup;
  kind: SigKind;
  name: string;
  signal_pct: number | null;
  distance_au: number | null;
  note: string | null;
  first_seen: string;
  last_seen: string;
  /** Cuándo entraste al sitio ("estoy en ella"); null si no. Con la salida da el tiempo dentro. */
  entered_at?: string | null;
};

/** Resumen por sistema para la capa del mapa (viene de `signatures_summary`). */
export type SignatureSummary = {
  system_id: number;
  total: number;
  wormholes: number;
  /** Wormholes con destino anotado = aristas de ruta en potencia. */
  wh_noted: number;
  unknown: number;
};

export type SignatureParseReport = {
  sigs: ParsedSignature[];
  /** Líneas que no supimos leer (sin ID de firma reconocible). */
  ignored: number;
  ignoredSample: string[];
  /** El separador decimal detectado (para poder explicarlo en la UI si hiciera falta). */
  decimal: "," | ".";
  /** Cuántos wormholes hay en el pegado (los que dan sinergia con las rutas). */
  wormholes: number;
};

/** ID del escáner: 3 letras mayúsculas, guion, 3 dígitos. Idéntico en cualquier idioma → nuestro
 *  ancla. Cualquier línea cuyo primer campo no case con esto no es una fila de firma. */
const SIG_ID = /^[A-Z]{3}-[0-9]{3}$/;

/** AU por unidad de distancia del cliente. El cliente muestra AU para casi todo y km/m para lo muy
 *  cercano (misma warp). `ua` es la abreviatura AU en español antiguo; se acepta por si acaso. */
const DIST_TO_AU: Record<string, number> = {
  au: 1,
  ua: 1,
  km: 1 / 149_597_870.7,
  m: 1 / 149_597_870_700,
};

/** Normaliza grupo y categoría (ES + EN) a nuestras claves. La comparación es en minúsculas y sin
 *  acentos para que un tilde perdido en el copiado no rompa la clasificación. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

function classifyGroup(field: string): SigGroup {
  const n = norm(field);
  // "Anomalía cósmica" / "Cosmic Anomaly". Todo lo demás (incl. "Firma cósmica"/"Cosmic Signature")
  // cuenta como firma sondeada: es la familia que trae wormholes y sitios de exploración.
  if (n.includes("anomal")) return "anomaly";
  return "signature";
}

/** Tabla de categorías. Se busca por inclusión de una palabra ancla, no por igualdad exacta, para
 *  aguantar variantes ("Yacimiento de menas" vs "Ore Site"). El wormhole es el que importa: es la
 *  puerta a la sinergia con las rutas. */
function classifyKind(field: string): SigKind {
  const n = norm(field);
  if (!n) return "unknown";
  if (n.includes("agujero") || n.includes("wormhole")) return "wormhole";
  if (n.includes("combate") || n.includes("combat")) return "combat";
  if (n.includes("mena") || n.includes("ore")) return "ore";
  if (n.includes("gas")) return "gas";
  if (n.includes("dato") || n.includes("data")) return "data";
  if (n.includes("reliquia") || n.includes("relic")) return "relic";
  return "unknown";
}

/** El separador decimal lo canta la columna de señal, que SIEMPRE trae exactamente un decimal:
 *  "100,0 %" → coma; "100.0%" → punto. Es más fiable que adivinarlo de la distancia (donde el punto
 *  puede ser separador de miles). Por defecto punto si no hay ninguna señal legible. */
function sniffDecimal(text: string): "," | "." {
  const m = /\d+([.,])\d+\s*%/.exec(text);
  return m ? (m[1] as "," | ".") : ".";
}

/** Parsea un número localizado sabiendo cuál es el separador decimal. El OTRO carácter se trata como
 *  separador de miles y se elimina. "4.132" con decimal="," → 4132; "2,36" con decimal="," → 2.36. */
function parseNum(s: string, dec: "," | "."): number | null {
  const thousands = dec === "," ? "." : ",";
  const cleaned = s.replace(new RegExp("\\" + thousands, "g"), "").replace(dec, ".");
  const v = parseFloat(cleaned);
  return Number.isFinite(v) ? v : null;
}

/** Parte una línea en campos. El portapapeles da TABULADORES; si alguien pega desde una vista
 *  renderizada llegan 2+ espacios. Un espacio suelto NO vale — partiría "Zona de combate". */
function splitFields(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((c) => c.trim());
  return line
    .split(/\s{2,}/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

/**
 * Parsea el pegado del escáner de sondas.
 *
 * @param text Lo que haya en el portapapeles, tal cual (título, cabecera y columnas de más incluidos).
 */
export function parseSignaturePaste(text: string): SignatureParseReport {
  const dec = sniffDecimal(text);
  const sigs: ParsedSignature[] = [];
  const ignoredSample: string[] = [];
  const seen = new Set<string>();
  let ignored = 0;
  let wormholes = 0;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const f = splitFields(line);
    // Ancla: el primer campo TIENE que ser un ID de firma. Con eso descartamos cabeceras, el
    // "0 filtrado(s)", líneas sueltas de la UI, etc., sin listas negras.
    if (f.length < 2 || !SIG_ID.test(f[0])) {
      ignored++;
      if (ignoredSample.length < 6) ignoredSample.push(line.slice(0, 70));
      continue;
    }
    // Un pegado puede traer la misma firma dos veces si se seleccionó de más; la primera manda.
    if (seen.has(f[0])) continue;
    seen.add(f[0]);

    const group = classifyGroup(f[1] ?? "");
    const kind = classifyKind(f[2] ?? "");
    const name = (f[3] ?? "").trim();
    let signalPct: number | null = null;
    let distanceAu: number | null = null;
    let distanceRaw: string | null = null;
    // Señal y distancia se identifican POR FORMA, no por posición: una firma sin identificar tiene
    // huecos y las columnas se corren.
    for (const c of f.slice(4)) {
      if (c.includes("%")) {
        signalPct = parseNum(c.replace("%", "").trim(), dec);
      } else {
        const mm = /^([\d.,]+)\s*(AU|UA|km|m)$/i.exec(c);
        if (mm) {
          distanceRaw = c;
          const v = parseNum(mm[1], dec);
          if (v != null) distanceAu = v * (DIST_TO_AU[mm[2].toLowerCase()] ?? 1);
        }
      }
    }
    if (kind === "wormhole") wormholes++;
    sigs.push({ id: f[0], group, kind, name, signalPct, distanceAu, distanceRaw });
  }

  // Orden útil para revisar: wormholes primero (lo accionable), luego por señal descendente.
  const rank: Record<SigKind, number> = {
    wormhole: 0,
    combat: 1,
    relic: 2,
    data: 3,
    gas: 4,
    ore: 5,
    unknown: 6,
  };
  sigs.sort((a, b) => rank[a.kind] - rank[b.kind] || (b.signalPct ?? 0) - (a.signalPct ?? 0));

  return { sigs, ignored, ignoredSample, decimal: dec, wormholes };
}
