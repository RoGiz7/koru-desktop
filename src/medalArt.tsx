// Dibujo REAL de una condecoración de corp a partir de sus capas de ESI (`graphics`),
// con las texturas que extract_medal_textures dejó en app-data (ver medals.rs).
//
// Receta v3 (calibrada contra capturas in-game, 2026-07-10):
//   - `graphic` = "hoja.fichero_celda" → hoja PNG `{ribbons|medals}_{hoja}{fichero:02}`,
//     cuadrícula 2×2 de celdas de 128px numeradas 1-4 POR FILAS (1 = arriba-izda).
//     Normalizar: lowercase + tolerar ceros a la izquierda ("Caldari.01_01" ≡ "caldari.1_1").
//   - `color` = ARGB con signo, tinte MULTIPLICATIVO por píxel (RGB×tinte, alpha×alpha);
//     -1/null = sin tinte. (CSS filter no puede hacer esto → canvas y píxeles.)
//   - ORDEN DE DIBUJO INVERSO: layer 0 es la capa MÁS ALTA → se pinta de la última a la 0.
//   - part 1 = cinta, part 2 = medallón. Cada bloque se compone aparte, se recorta a su
//     bbox real (las celdas traen mucho aire) y se apilan centrados con hueco mínimo.
//   - Reescalado final con smoothing "high" (equivalente al Lanczos del spike).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { MedalGraphic } from "./types";

const CELL = 128;
const GAP = 3; // hueco cinta↔medallón a escala 128 (el juego casi los pega)

// ---- Cachés de módulo: una consulta de "ready" y una carga por hoja para toda la sesión. ----
let readyPromise: Promise<boolean> | null = null;
function texturesReady(): Promise<boolean> {
  if (!readyPromise) {
    readyPromise = invoke<boolean>("medal_textures_ready").catch(() => false);
  }
  return readyPromise;
}
/** Tras extraer texturas desde Ajustes, olvida el "no hay" cacheado. */
export function resetMedalTextureCache() {
  readyPromise = null;
  sheetCache.clear();
}

const sheetCache = new Map<string, Promise<HTMLImageElement | null>>();
function loadSheet(sheet: string): Promise<HTMLImageElement | null> {
  let p = sheetCache.get(sheet);
  if (!p) {
    p = invoke<string>("get_medal_texture", { sheet })
      .then(
        (dataUrl) =>
          new Promise<HTMLImageElement | null>((res) => {
            const img = new Image();
            img.onload = () => res(img);
            img.onerror = () => res(null);
            img.src = dataUrl;
          })
      )
      .catch(() => null);
    sheetCache.set(sheet, p);
  }
  return p;
}

/** "Caldari.01_01" (part 1) → { sheet: "ribbons_caldari01", cell: 1 }. null si no se entiende. */
function parseGraphic(graphic: string, part: number): { sheet: string; cell: number } | null {
  const low = graphic.trim().toLowerCase();
  const dot = low.indexOf(".");
  if (dot <= 0) return null;
  const hoja = low.slice(0, dot);
  const [fStr, cStr] = low.slice(dot + 1).split("_");
  const fichero = parseInt(fStr, 10);
  const cell = cStr === undefined ? 1 : parseInt(cStr, 10);
  if (!Number.isFinite(fichero) || !Number.isFinite(cell)) return null;
  const dir = part === 1 ? "ribbons" : "medals";
  return { sheet: `${dir}_${hoja}${String(fichero).padStart(2, "0")}`, cell: Math.min(4, Math.max(1, cell)) };
}

/** Celda 1-4 de la hoja, ya tintada (multiplicativo por píxel). */
function tintedCell(img: HTMLImageElement, cell: number, argb: number | null): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = CELL;
  c.height = CELL;
  const ctx = c.getContext("2d")!;
  const sx = ((cell - 1) % 2) * CELL;
  const sy = Math.floor((cell - 1) / 2) * CELL;
  ctx.drawImage(img, sx, sy, CELL, CELL, 0, 0, CELL, CELL);
  if (argb !== null && argb !== undefined && argb !== -1) {
    const v = argb >>> 0; // i64 negativo de ESI → uint32
    const a = (v >>> 24) & 255, r = (v >>> 16) & 255, g = (v >>> 8) & 255, b = v & 255;
    const id = ctx.getImageData(0, 0, CELL, CELL);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = (d[i] * r) / 255;
      d[i + 1] = (d[i + 1] * g) / 255;
      d[i + 2] = (d[i + 2] * b) / 255;
      d[i + 3] = (d[i + 3] * a) / 255;
    }
    ctx.putImageData(id, 0, 0);
  }
  return c;
}

/** Recorta un canvas a su bbox de alpha real. null si está vacío. */
function cropToBBox(c: HTMLCanvasElement): HTMLCanvasElement | null {
  const ctx = c.getContext("2d")!;
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext("2d")!.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** Compone un bloque (cinta O medallón): capas de mayor a 0 (layer 0 queda ENCIMA) + bbox. */
async function composePart(layers: MedalGraphic[], part: number): Promise<HTMLCanvasElement | null> {
  const mine = layers.filter((g) => g.part === part).sort((a, b) => b.layer - a.layer);
  if (mine.length === 0) return null;
  const c = document.createElement("canvas");
  c.width = CELL;
  c.height = CELL;
  const ctx = c.getContext("2d")!;
  let drawn = 0;
  for (const g of mine) {
    const ref = parseGraphic(g.graphic, part);
    if (!ref) continue;
    const img = await loadSheet(ref.sheet);
    if (!img) continue;
    ctx.drawImage(tintedCell(img, ref.cell, g.color), 0, 0);
    drawn++;
  }
  return drawn > 0 ? cropToBBox(c) : null;
}

/** Medalla completa a resolución de trabajo (128): cinta arriba, medallón debajo, centrados. */
async function composeMedal(graphics: MedalGraphic[]): Promise<HTMLCanvasElement | null> {
  const [ribbon, medallion] = await Promise.all([composePart(graphics, 1), composePart(graphics, 2)]);
  if (!ribbon && !medallion) return null;
  if (!ribbon) return medallion;
  if (!medallion) return ribbon;
  const w = Math.max(ribbon.width, medallion.width);
  const out = document.createElement("canvas");
  out.width = w;
  out.height = ribbon.height + GAP + medallion.height;
  const ctx = out.getContext("2d")!;
  ctx.drawImage(ribbon, Math.round((w - ribbon.width) / 2), 0);
  ctx.drawImage(medallion, Math.round((w - medallion.width) / 2), ribbon.height + GAP);
  return out;
}

/**
 * Condecoración dibujada con sus texturas reales. Si no hay texturas extraídas (o las capas
 * no se pueden resolver), pinta `fallback` — el marco genérico de siempre.
 */
export function MedalArt({
  graphics,
  height = 74,
  fallback,
}: {
  graphics: MedalGraphic[];
  height?: number;
  fallback: ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // null = componiendo (aún no sabemos), true = dibujada, false = fallback.
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    setOk(null);
    (async () => {
      if (!graphics || graphics.length === 0) return false;
      if (!(await texturesReady())) return false;
      const full = await composeMedal(graphics);
      if (!full || !alive || !canvasRef.current) return false;
      const scale = height / full.height;
      const wCss = Math.max(1, Math.round(full.width * scale));
      const cv = canvasRef.current;
      cv.width = wCss * 2; // 2× para nitidez en pantallas densas
      cv.height = height * 2;
      cv.style.width = `${wCss}px`;
      cv.style.height = `${height}px`;
      const ctx = cv.getContext("2d")!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(full, 0, 0, cv.width, cv.height);
      return true;
    })()
      .then((r) => alive && setOk(r))
      .catch(() => alive && setOk(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(graphics), height]);

  if (ok === false) return <>{fallback}</>;
  // Mientras compone (ok === null) el canvas está vacío: no parpadea el fallback.
  return <canvas ref={canvasRef} className="medal-canvas" aria-hidden="true" />;
}
