import type { NeSystem, IntelLine } from "./types";

// --- Parser de intel: clasifica cada token de una línea de chat ---
// Sin marcas en el log → clasificamos por contraste contra datos locales (sistemas + naves SDE
// + jerga). Convención de la comunidad: tokens separados por DOBLE espacio (sistema/piloto/nave,
// cualquier orden); con fallback a espacio simple. Devuelve sistemas, pilotos, naves, +N y clear.
const INTEL_CLEAR = new Set(["clr", "clear", "cleared"]);
// La segunda mitad son verbos y muletillas del chat de intel real. Se añadieron tras ver un aviso
// anunciar «he jump» como si fuera un hostil (la línea era «he jump to 8-WYQZ»).
// ⚠️ Espejo de INTEL_JARGON en commands.rs: si cambia uno, cambia el otro.
const INTEL_JARGON = new Set([
  "nv", "neut", "neuts", "neutral", "neutrals", "red", "reds", "hostile", "hostiles",
  "status", "gate", "gates", "stargate", "dock", "docked", "docking", "station", "pos",
  "cyno", "near", "on", "the", "in", "at", "and", "is", "to", "a",
  "jump", "jumps", "jumped", "jumping", "warp", "warped", "warping", "camp", "camped", "camping",
  "move", "moves", "moved", "moving", "coming", "came", "going", "gone", "left", "back", "out",
  "up", "down", "here", "there", "still", "safe", "clr2", "afk", "logged", "off", "away",
  "spotted", "seen", "sitting", "sits", "roam", "roaming", "local", "he", "she", "they", "his",
  "her", "their", "with", "from", "for", "of", "seem", "seems", "like", "just", "was", "were",
  "have", "has", "had", "not", "no", "yes", "now", "watch", "look", "looking", "check", "x", "o",
]);

/** ¿Puede esta palabra formar parte de un nombre de piloto?
 *
 *  **Todo nombre de personaje de EVE empieza por mayúscula.** Ese único criterio quita las frases
 *  en inglés que se colaban como pilotos sin mantener una lista infinita. Los nombres compuestos
 *  («Bedwin Al Ishira») pasan porque todas sus partes van en mayúscula. Un falso negativo es mucho
 *  mejor que un falso positivo: inventarle nombre a un hostil es peor que admitir que no se sabe. */
const pareceNombre = (s: string) => /^\p{Lu}/u.test(s);
export type IntelParsed = {
  systems: { id: number; name: string }[];
  pilots: string[];
  ships: { id: number; name: string }[];
  count: number | null;
  isClear: boolean;
  /** ★★ NOMBRES QUE UN SISTEMA PARTIÓ POR LA MITAD — las dos lecturas, sin elegir.
   *
   *  Caso real (2026-09-07): la línea `G-QTSD Dee Yona vector-Z` sacaba un piloto llamado «Dee»…
   *  porque **«Yona» ES un sistema de New Eden** (Essence, highsec 0.8) y cortaba el nombre ahí.
   *  Y «Dee» resuelve a un personaje real, así que el aviso enlazaba al killboard de otra persona.
   *
   *  ⚠️ LAS DOS LECTURAS SON VÁLIDAS y ningún criterio local las separa: «Dee Yona» puede ser un
   *  piloto, o puede ser «el piloto Dee, en el sistema Yona». Así que **no se adivina**: se
   *  proponen las dos y decide quien puede saberlo — el índice local de nombres, y si no, ESI.
   *  Si la larga se confirma, gana y `sysId` deja de contar como sistema en esa línea: no puede
   *  ser las dos cosas. Si no se confirma, no cambia absolutamente nada. */
  pilotAlts: { corto: string; largo: string; sysId: number }[];
};
export function classifyIntel(
  message: string,
  nameIdx: Map<string, NeSystem>,
  shipNames: Map<string, number>
): IntelParsed {
  const systems: { id: number; name: string }[] = [];
  const ships: { id: number; name: string }[] = [];
  const pilots: string[] = [];
  const pilotAlts: { corto: string; largo: string; sysId: number }[] = [];
  let count: number | null = null;
  let isClear = false;
  const seenSys = new Set<number>();
  const clean = (s: string) =>
    s.replace(/[*.,;:!?()]+$/g, "").replace(/^[*([]+/g, "").trim();
  type Word = { kind: string; id?: number; name?: string; typeId?: number; n?: number; text?: string };
  const classifyWord = (w: string): Word => {
    const raw = w.trim();
    if (!raw) return { kind: "empty" };
    // Ticker de corp/alianza entre paréntesis o corchetes (p. ej. "(海神级)", "[ABC]") → ignorar:
    // no es piloto ni nave; suele ir pegado tras el nombre del piloto.
    if (/^[([{].*[)\]}]$/.test(raw)) return { kind: "ticker" };
    const c = clean(raw);
    if (!c) return { kind: "empty" };
    const lc = c.toLowerCase();
    if (INTEL_CLEAR.has(lc)) return { kind: "clear" };
    // Contador de hostiles: acepta "+N" y "N+" (p. ej. "+4" o "14+").
    const mc = lc.match(/^(?:\+(\d+)|(\d+)\+)$/);
    if (mc) return { kind: "count", n: +(mc[1] ?? mc[2]) };
    if (INTEL_JARGON.has(lc)) return { kind: "jargon" };
    const s = nameIdx.get(lc);
    if (s) return { kind: "sys", id: s.id, name: s.n };
    const tid = shipNames.get(lc);
    if (tid != null) return { kind: "ship", typeId: tid, name: c };
    return { kind: "other", text: c };
  };
  /** ★★ LA NAVE MÁS LARGA QUE EMPIECE AQUÍ. Devuelve cuántas palabras consume.
   *
   *  Nació de un reporte suyo: la línea `5E-CMA Brutix Navy x4 Celestis…` sacaba **un piloto
   *  llamado «Navy»**. El motivo: se clasificaba PALABRA A PALABRA, así que «Brutix» casaba como
   *  nave, cortaba, y «Navy» se quedaba suelto — y como empieza por mayúscula, pasaba por nombre.
   *
   *  Se prueba de más largo a más corto (gana la coincidencia más larga, la misma lección que el
   *  BPC de la Leshak). Y se acepta un **prefijo inequívoco**: en el intel se escribe «Brutix
   *  Navy», no «Brutix Navy Issue», y ese prefijo solo puede ser una nave — comprobado contra las
   *  512 del catálogo. Si el prefijo diera dos candidatas, no se acepta: adivinar la nave del
   *  hostil es peor que no nombrarla. */
  const naveDesde = (
    words: string[],
    i: number
  ): { consume: number; typeId: number; name: string } | null => {
    const max = Math.min(4, words.length - i);
    for (let len = max; len >= 1; len--) {
      const trozo = words.slice(i, i + len).map(clean).filter(Boolean);
      if (trozo.length !== len) continue;
      const frag = trozo.join(" ").toLowerCase();
      const exacta = shipNames.get(frag);
      if (exacta != null) return { consume: len, typeId: exacta, name: trozo.join(" ") };
      // Prefijo: solo vale si hay UNA candidata. Con dos, no se nombra.
      let unica: number | null = null;
      let cuantas = 0;
      for (const [n, tid] of shipNames) {
        if (n.startsWith(frag + " ")) {
          cuantas++;
          if (cuantas > 1) break;
          unica = tid;
        }
      }
      if (cuantas === 1 && unica != null && len > 1) {
        return { consume: len, typeId: unica, name: trozo.join(" ") };
      }
    }
    return null;
  };

  const addSys = (id: number, name: string) => {
    if (!seenSys.has(id)) {
      seenSys.add(id);
      systems.push({ id, name });
    }
  };
  for (const field of message.split(/\s{2,}/).map((f) => f.trim()).filter(Boolean)) {
    const whole = classifyWord(field);
    if (whole.kind === "sys") {
      addSys(whole.id!, whole.name!);
      continue;
    }
    if (whole.kind === "ship") {
      ships.push({ id: whole.typeId!, name: whole.name! });
      continue;
    }
    if (whole.kind === "clear") {
      isClear = true;
      continue;
    }
    if (whole.kind === "count") {
      count = whole.n!;
      continue;
    }
    if (whole.kind === "jargon" || whole.kind === "empty" || whole.kind === "ticker") continue;
    // 'other': si es 1 palabra → piloto; si son varias (espacio simple) → separar reconocidos.
    const words = field.split(/\s+/);
    if (words.length === 1) {
      if (pareceNombre(whole.text!)) pilots.push(whole.text!);
      continue;
    }
    let buf: string[] = [];
    const flush = () => {
      if (buf.length) {
        pilots.push(buf.join(" "));
        buf = [];
      }
    };
    for (let wi = 0; wi < words.length; wi++) {
      const w = words[wi];
      // 1º LAS NAVES, y de la más larga a la más corta: si no, «Brutix» se lleva la nave y «Navy»
      // se queda suelto haciéndose pasar por piloto.
      const nave = naveDesde(words, wi);
      if (nave) {
        flush();
        ships.push({ id: nave.typeId, name: nave.name });
        wi += nave.consume - 1;
        continue;
      }
      const k = classifyWord(w);
      if (k.kind === "sys") {
        // ★ ¿ESTE SISTEMA ESTÁ PARTIENDO UN NOMBRE? Si veníamos escribiendo un nombre y detrás
        // NO sigue otra palabra de nombre, la lectura larga («Dee Yona») es tan válida como la
        // corta. Se guardan LAS DOS y decide quien pueda comprobarlo; aquí no se elige.
        if (buf.length > 0) {
          const siguiente = words[wi + 1];
          const sigueNombre = siguiente ? pareceNombre(clean(siguiente)) : false;
          if (!sigueNombre) {
            pilotAlts.push({
              corto: buf.join(" "),
              largo: `${buf.join(" ")} ${k.name!}`,
              sysId: k.id!,
            });
          }
        }
        flush();
        addSys(k.id!, k.name!);
      } else if (k.kind === "ship") {
        flush();
        ships.push({ id: k.typeId!, name: k.name! });
      } else if (k.kind === "clear") {
        flush();
        isClear = true;
      } else if (k.kind === "count") {
        flush();
        count = k.n!;
      } else if (k.kind === "jargon" || k.kind === "empty" || k.kind === "ticker") {
        // ticker de corp/alianza cierra el nombre del piloto que lo precede
        flush();
      } else if (!pareceNombre(k.text!)) {
        // No empieza por mayúscula → no es nombre: cierra lo que hubiera y se descarta.
        flush();
      } else {
        buf.push(k.text!);
      }
    }
    flush();
  }
  return { systems, ships, pilots, count, isClear, pilotAlts };
}


// --- Reportes de intel por sistema + feed cronológico (a partir de las líneas de chat) ---
export type IntelFeedRow = {
  ts: number;
  author: string;
  message: string;
  sysId: number | null;
  sysName: string | null;
  pilots: string[];
  ships: { id: number; name: string }[];
  count: number | null;
};
export type IntelRep = {
  ts: number;
  author: string;
  message: string;
  name: string;
  pilots: string[];
  ships: { id: number; name: string }[];
  count: number | null;
};

// Parsea las líneas del log en: `rep` = último reporte vigente por sistema (una línea "clear"
// borra el sistema) y `feed` = todas las líneas en orden cronológico inverso (más reciente primero).
export function buildIntelReports(
  lines: IntelLine[],
  nameIdx: Map<string, NeSystem>,
  shipNames: Map<string, number>,
): { rep: Map<number, IntelRep>; feed: IntelFeedRow[] } {
  const rep = new Map<number, IntelRep>();
  const feed: IntelFeedRow[] = [];
  for (const l of lines) {
    const p = classifyIntel(l.message, nameIdx, shipNames);
    const primary = p.systems[0];
    feed.push({
      ts: l.ts_ms,
      author: l.author,
      message: l.message,
      sysId: primary?.id ?? null,
      sysName: primary?.name ?? null,
      pilots: p.pilots,
      ships: p.ships,
      count: p.count,
    });
    for (const m of p.systems) {
      if (p.isClear) rep.delete(m.id);
      else
        rep.set(m.id, {
          ts: l.ts_ms,
          author: l.author,
          message: l.message,
          name: m.name,
          pilots: p.pilots,
          ships: p.ships,
          count: p.count,
        });
    }
  }
  feed.reverse(); // más reciente primero
  return { rep, feed };
}


// Trayectoria de un piloto: sistemas (orden cronológico) donde su nombre aparece en el feed de
// reportes. `feed` viene newest-first (como lo devuelve buildIntelReports) → se invierte.
export function pilotTrack(
  name: string,
  feed: IntelFeedRow[],
): { ts: number; sysId: number; sysName: string }[] {
  const lower = name.toLowerCase();
  const asc = [...feed].reverse();
  const track: { ts: number; sysId: number; sysName: string }[] = [];
  for (const f of asc) {
    if (f.sysId != null && f.message.toLowerCase().includes(lower)) {
      track.push({ ts: f.ts, sysId: f.sysId, sysName: f.sysName! });
    }
  }
  return track;
}
