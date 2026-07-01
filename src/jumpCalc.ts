// Cálculos puros del planificador de saltos de capital (jump drive): combustible, fatiga y
// sistemas alcanzables. Sin React ni estado; extraídos de map.tsx. Distancias en años-luz (LY)
// a partir de las coords galácticas 3D (gx/gy/gz) del SDE.
import type { Geo } from "./mapOverlays";
import type { JumpShip } from "./types";

export type JumpFuel = { dist: number; fuel: number; isotope: string; inRange: boolean };
export type JumpFatEst = { cooldown: number; newFat: number; reduced: boolean };

// Combustible (isótopos) y distancia al destino elegido.
// fuel = dist(LY) × fuelPerLy × (1 − 10%·Jump Fuel Conservation).
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
  const fuel = Math.ceil(dist * selShip.fuelPerLy * (1 - 0.1 * jfcLevel));
  return { dist, fuel, isotope: selShip.isotope, inRange: dist <= jumpRange + 1e-6 };
}

// Estimación del salto: cooldown de activación y fatiga resultante (fórmula EVE Uni).
// cooldown = max(1+LY, fatigaPre/10) [máx 30 min]; fatiga nueva = max(10·(1+LY), fatigaPre·(1+LY))
// [máx 5 h]. Las JF/Rorqual reducen mucho la fatiga (bono de rol −90% sobre la distancia efectiva).
export function computeJumpFatEst(
  selShip: JumpShip | null,
  jumpFuel: JumpFuel | null,
  curFatMin: number,
): JumpFatEst | null {
  if (!selShip || !jumpFuel) return null;
  const ly = jumpFuel.dist;
  const reduced =
    selShip.group === "Jump Freighter" || selShip.group === "Capital Industrial Ship";
  const effLy = reduced ? ly * 0.1 : ly;
  const cooldown = Math.min(30, Math.max(1 + ly, curFatMin / 10));
  const newFat = Math.min(300, Math.max(10 * (1 + effLy), curFatMin * (1 + effLy)));
  return { cooldown, newFat, reduced };
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
    if (s.s >= 0.45) continue; // no se puede saltar a high-sec
    if (s.r === 10000070) continue; // Pochven
    const d = Math.hypot(s.gx - o.gx, s.gy - o.gy, s.gz - o.gz);
    if (d <= jumpRange) out.set(s.id, d);
  }
  return out;
}
