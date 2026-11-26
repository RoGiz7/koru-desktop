// Cálculos puros del planificador de saltos de capital (jump drive): combustible, fatiga y
// sistemas alcanzables. Sin React ni estado; extraídos de map.tsx. Distancias en años-luz (LY)
// a partir de las coords galácticas 3D (gx/gy/gz) del SDE.
import type { Geo } from "./mapOverlays";
import type { JumpShip } from "./types";

export type JumpFuel = { dist: number; fuel: number; isotope: string; inRange: boolean };
/** `fatMult` < 1 = el casco rebaja la distancia efectiva (Black Ops, Jump Freighter, Rorqual). */
export type JumpFatEst = { cooldown: number; newFat: number; fatMult: number };

/** Isótopos de UN salto: años luz × consumo por año luz × (1 − 10 %·Jump Fuel Conservation),
 *  redondeado hacia arriba. Lo usan el planificador de salto del mapa y el plan: UNA fórmula. */
export function isotoposSalto(ly: number, fuelPerLy: number, jfcLevel: number): number {
  return Math.ceil(ly * fuelPerLy * (1 - 0.1 * jfcLevel));
}

/** ¿Se puede saltar A este sistema? No a alta seguridad (sec ≥ 0,45) ni a Pochven. El MISMO corte
 *  para el planificador de salto del mapa y para el plan. */
export const POCHVEN = 10000070;
export function destinoSaltable(sec: number, regionId: number): boolean {
  return sec < 0.45 && regionId !== POCHVEN;
}

// Combustible (isótopos) y distancia al destino elegido. Ver `isotoposSalto`.
export function computeJumpFuel(
  geo: Geo | null,
  selShip: JumpShip | null,
  jumpOrigin: number | null,
  jumpDest: number | null,
  jfcLevel: number,
  jumpRange: number,
): JumpFuel | null {
  if (!geo || !selShip || jumpOrigin == null || jumpDest == null) return null;
  const o = geo.idx.get(jumpOrigin);
  const d = geo.idx.get(jumpDest);
  if (!o || !d) return null;
  const dist = Math.hypot(d.gx - o.gx, d.gy - o.gy, d.gz - o.gz);
  const fuel = isotoposSalto(dist, selShip.fuelPerLy, jfcLevel);
  return { dist, fuel, isotope: selShip.isotope, inRange: dist <= jumpRange + 1e-6 };
}

/** ★ UN SALTO: cooldown (timer rojo) y fatiga (timer azul) que deja, en minutos.
 *
 *  Según lo PUBLICADO (el devblog que introdujo la mecánica), con `e` = distancia EFECTIVA y `F` =
 *  fatiga antes del salto:  cooldown = min(30, max(1 + e, F/10)) ·
 *                           fatiga   = min(300, max(10, F) × (1 + e)).
 *  La distancia efectiva es `años luz × fatMult` del casco (atributo 1971 del SDE, en
 *  `jumpships.json`), y vale para LAS DOS fórmulas.
 *
 *  ⚠️ Esto estuvo mal dos veces a la vez hasta el 26-11: la rebaja se decidía por NOMBRE DE GRUPO
 *     (solo Jump Freighter y Capital Industrial Ship: a una Black Ops no le rebajaba nada, 8 al
 *     salían 9 min y 90 de fatiga en vez de 3 y 30), y el cooldown usaba la distancia CRUDA incluso
 *     para las que sí rebajaba.
 *  🚨 NO VALIDADO CONTRA UN SALTO REAL. El 0,25 sale del SDE; que rebaje también el cooldown, del
 *     devblog. Hasta que se compare con un salto de verdad, en pantalla todo esto lleva «~». */
export function saltoFatiga(ly: number, fatMult: number, fatigaAntesMin: number): { cooldown: number; fatiga: number } {
  const e = ly * fatMult;
  return {
    cooldown: Math.min(30, Math.max(1 + e, fatigaAntesMin / 10)),
    fatiga: Math.min(300, Math.max(10, fatigaAntesMin) * (1 + e)),
  };
}

// Estimación del salto al destino elegido en el planificador de salto del mapa. Ver `saltoFatiga`.
export function computeJumpFatEst(
  selShip: JumpShip | null,
  jumpFuel: JumpFuel | null,
  curFatMin: number,
): JumpFatEst | null {
  if (!selShip || !jumpFuel) return null;
  const s = saltoFatiga(jumpFuel.dist, selShip.fatMult, curFatMin);
  return { cooldown: s.cooldown, newFat: s.fatiga, fatMult: selShip.fatMult };
}

// Sistemas alcanzables por salto (low/null dentro del rango LY; sin high-sec ni Pochven).
export function computeJumpReach(
  geo: Geo | null,
  jumpOrigin: number | null,
  jumpRange: number,
): Map<number, number> | null {
  if (!geo || jumpOrigin == null) return null;
  const o = geo.idx.get(jumpOrigin);
  if (!o) return null;
  const out = new Map<number, number>();
  for (const s of geo.idx.values()) {
    if (s.id === o.id) continue;
    if (!destinoSaltable(s.s, s.r)) continue; // ni high-sec ni Pochven
    const d = Math.hypot(s.gx - o.gx, s.gy - o.gy, s.gz - o.gz);
    if (d <= jumpRange) out.set(s.id, d);
  }
  return out;
}
