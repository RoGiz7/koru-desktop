import type { NeSystem } from "./types";

// --- Parser de intel: clasifica cada token de una línea de chat ---
// Sin marcas en el log → clasificamos por contraste contra datos locales (sistemas + naves SDE
// + jerga). Convención de la comunidad: tokens separados por DOBLE espacio (sistema/piloto/nave,
// cualquier orden); con fallback a espacio simple. Devuelve sistemas, pilotos, naves, +N y clear.
const INTEL_CLEAR = new Set(["clr", "clear", "cleared"]);
const INTEL_JARGON = new Set([
  "nv", "neut", "neuts", "neutral", "neutrals", "red", "reds", "hostile", "hostiles",
  "status", "gate", "gates", "stargate", "dock", "docked", "docking", "station", "pos",
  "cyno", "near", "on", "the", "in", "at", "and", "is", "to", "a",
]);
export type IntelParsed = {
  systems: { id: number; name: string }[];
  pilots: string[];
  ships: { id: number; name: string }[];
  count: number | null;
  isClear: boolean;
};
export function classifyIntel(
  message: string,
  nameIdx: Map<string, NeSystem>,
  shipNames: Map<string, number>
): IntelParsed {
  const systems: { id: number; name: string }[] = [];
  const ships: { id: number; name: string }[] = [];
  const pilots: string[] = [];
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
      pilots.push(whole.text!);
      continue;
    }
    let buf: string[] = [];
    const flush = () => {
      if (buf.length) {
        pilots.push(buf.join(" "));
        buf = [];
      }
    };
    for (const w of words) {
      const k = classifyWord(w);
      if (k.kind === "sys") {
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
      } else {
        buf.push(k.text!);
      }
    }
    flush();
  }
  return { systems, ships, pilots, count, isClear };
}
