// Formateadores y helpers de presentación (puros, sin dependencias de React).

export function fmtAgo(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `hace ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  return `hace ${Math.floor(m / 60)}h`;
}

export function fmtMMSS(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function fmtIsk(n: number): string {
  if (!n) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + " B";
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + " M";
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + " K";
  return n.toFixed(0);
}

export function fmtSp(n: number): string {
  return n.toLocaleString("es-ES");
}

export function shipIcon(typeId: number | null): string | null {
  if (!typeId) return null;
  return `https://images.evetech.net/types/${typeId}/render?size=32`;
}

export function zkillUrl(killmailId: number): string {
  return `https://zkillboard.com/kill/${killmailId}/`;
}

// Icono de inventario de cualquier tipo (item, ore, módulo…) desde el servidor oficial de EVE.
export function typeIcon(typeId: number, size = 32): string {
  return `https://images.evetech.net/types/${typeId}/icon?size=${size}`;
}

// Render 3D de un tipo (naves, estructuras) desde el servidor oficial de EVE.
export function typeRender(typeId: number, size = 32): string {
  return `https://images.evetech.net/types/${typeId}/render?size=${size}`;
}

// Color por seguridad del sistema (high verde · low naranja · null rojo).
export function secColor(sec: number): string {
  if (sec >= 0.45) return "#3fb950"; // high-sec verde
  if (sec >= 0.05) return "#e3a13a"; // low-sec naranja
  return "#e5534b"; // null/neg rojo
}

// Color estable por id de dueño (alianza/corp/facción) para la capa de soberanía.
export function ownerColor(id: number): string {
  return `hsl(${(id * 47) % 360} 65% 55%)`;
}

// Color de "calor" (t en 0..1 → amarillo → rojo) para overlays de actividad.
export function heatColor(t: number): string {
  if (t > 0.66) return "#ff5a3c";
  if (t > 0.33) return "#ff9f40";
  return "#ffd86b";
}
