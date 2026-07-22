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

// Minutos → "X min" o "Xh Ym" (para timers de fatiga de salto).
export function fmtMin(m: number): string {
  const t = Math.round(m);
  if (t <= 0) return "0 min";
  if (t < 60) return `${t} min`;
  return `${Math.floor(t / 60)}h ${t % 60}m`;
}

// Tamaño de archivo legible (B / KB / MB / GB).
export function fmtBytes(n: number): string {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
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

/** Icono de BLUEPRINT. El servidor de EVE tiene variantes propias para planos —`bp` (original) y
 *  `bpc` (copia)— y NO responde a `icon` para ellos: con typeIcon() salen rotos. */
export function bpIcon(typeId: number, isOriginal: boolean, size = 32): string {
  return `https://images.evetech.net/types/${typeId}/${isOriginal ? "bp" : "bpc"}?size=${size}`;
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

/** Número CORTO para meterlo dentro de un nodo del mapa: 940 · 1,2k · 15k · 2,3M.
 *  `fmtSp` no vale ahí — "1.234" no cabe en un círculo de 8 px. */
export function fmtCompact(n: number): string {
  const a = Math.abs(n);
  if (a < 1000) return String(Math.round(n));
  if (a < 10000) return `${(n / 1000).toFixed(1).replace(".", ",")}k`;
  if (a < 1e6) return `${Math.round(n / 1000)}k`;
  if (a < 1e7) return `${(n / 1e6).toFixed(1).replace(".", ",")}M`;
  return `${Math.round(n / 1e6)}M`;
}

// Color de "calor" (t en 0..1 → amarillo → rojo) para overlays de actividad.
export function heatColor(t: number): string {
  if (t > 0.66) return "#ff5a3c";
  if (t > 0.33) return "#ff9f40";
  return "#ffd86b";
}

// Color de standing (-10..10) para contactos y la capa de standings del mapa.
export function standingColor(s: number): string {
  if (s >= 5) return "#3fb950";
  if (s > 0) return "#56b870";
  if (s === 0) return "#8b949e";
  if (s > -5) return "#e3a13a";
  return "#e5534b";
}

// Clave de semana ISO (año-Sxx) para bucketizar series temporales por semana.
export function weekKey(date: string): string {
  const dt = new Date(date + "T00:00:00Z");
  const dayNr = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dayNr + 3); // jueves de esa semana
  const firstThursday = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      (dt.getTime() - firstThursday.getTime()) / 86400000 / 7 -
        ((firstThursday.getUTCDay() + 6) % 7) / 7,
    );
  return `${dt.getUTCFullYear()}-S${String(week).padStart(2, "0")}`;
}

// Fecha ISO (YYYY-MM-DD) de hace n días. Para los presets de rango de las gráficas.
export function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

// Nombres de mes (texto-fuente ES; se traducen con tr() en cada vista). Compartido por las
// vistas con selector mensual (PvP, Rateo, Actividad).
export const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
