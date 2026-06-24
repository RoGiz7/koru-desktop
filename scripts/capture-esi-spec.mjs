#!/usr/bin/env node
/**
 * Captura el inventario completo de endpoints de ESI desde la spec OpenAPI oficial
 * y detecta cambios respecto a la última captura.
 *
 * Uso:
 *   node scripts/capture-esi-spec.mjs                 (usa la fecha por defecto)
 *   node scripts/capture-esi-spec.mjs 2026-06-01      (fecha de compatibilidad concreta)
 *   npm run esi:capture
 *
 * Genera en docs/esi/:
 *   - esi-endpoints.md            inventario legible, agrupado por categoría
 *   - esi-endpoints.snapshot.json snapshot mínimo y ordenado (para hacer diff)
 *
 * Si ya existe un snapshot previo, imprime los cambios (nuevos / retirados /
 * con scopes distintos). Ideal para enterarse cuando CCP añade o cambia rutas.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DATE = process.argv[2] || process.env.ESI_COMPAT_DATE || "2026-06-01";
const SPEC_URL = `https://esi.evetech.net/meta/openapi.json?compatibility_date=${DATE}`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "docs", "esi");
const SNAP = join(OUT_DIR, "esi-endpoints.snapshot.json");
const MD = join(OUT_DIR, "esi-endpoints.md");

const METHODS = ["get", "post", "put", "delete", "patch"];
const keyOf = (e) => `${e.method} ${e.path}`;

function extractEndpoints(spec) {
  const out = [];
  for (const [path, item] of Object.entries(spec.paths || {})) {
    for (const [method, op] of Object.entries(item)) {
      if (!METHODS.includes(method) || typeof op !== "object") continue;
      const scopes = [];
      for (const sec of op.security || []) {
        for (const v of Object.values(sec)) {
          if (Array.isArray(v)) scopes.push(...v);
        }
      }
      out.push({
        method: method.toUpperCase(),
        path,
        operationId: op.operationId || "",
        summary: (op.summary || op.description || "").split("\n")[0].trim(),
        tags: op.tags || [],
        scopes: [...new Set(scopes)].sort(),
      });
    }
  }
  out.sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
  return out;
}

function diff(prev, cur) {
  const prevByKey = new Map(prev.map((e) => [keyOf(e), e]));
  const curKeys = new Set(cur.map(keyOf));
  const added = cur.filter((e) => !prevByKey.has(keyOf(e)));
  const removed = prev.filter((e) => !curKeys.has(keyOf(e)));
  const scopeChanges = cur.filter(
    (e) =>
      prevByKey.has(keyOf(e)) &&
      JSON.stringify(prevByKey.get(keyOf(e)).scopes) !== JSON.stringify(e.scopes)
  );
  return { added, removed, scopeChanges, prevByKey };
}

function buildMarkdown(snapshot) {
  const byTag = {};
  for (const e of snapshot.endpoints) {
    const t = e.tags[0] || "(sin categoría)";
    (byTag[t] ||= []).push(e);
  }
  let md = `# Inventario de endpoints ESI\n\n`;
  md += `- **Capturado:** ${snapshot.captured_at}\n`;
  md += `- **compatibility_date:** ${snapshot.compatibility_date}\n`;
  md += `- **Versión spec:** ${snapshot.spec_version ?? "?"}\n`;
  md += `- **Total endpoints:** ${snapshot.count}\n`;
  md += `- **Categorías:** ${Object.keys(byTag).length}\n\n`;
  md += `> Generado por \`scripts/capture-esi-spec.mjs\`. Ejecútalo de nuevo (\`npm run esi:capture\`) para detectar cambios.\n\n`;
  md += `## Resumen por categoría\n\n| Categoría | Endpoints |\n|---|---:|\n`;
  for (const tag of Object.keys(byTag).sort()) {
    md += `| ${tag} | ${byTag[tag].length} |\n`;
  }
  md += `\n`;
  for (const tag of Object.keys(byTag).sort()) {
    md += `## ${tag} (${byTag[tag].length})\n\n`;
    md += `| Método | Ruta | Scope | Descripción |\n|---|---|---|---|\n`;
    for (const e of byTag[tag]) {
      const scope = e.scopes.length ? e.scopes.join("<br>") : "— (público)";
      md += `| ${e.method} | \`${e.path}\` | ${scope} | ${e.summary.replace(/\|/g, "\\|")} |\n`;
    }
    md += `\n`;
  }
  return md;
}

async function main() {
  console.log(`Descargando spec OpenAPI de ESI (compatibility_date=${DATE})…`);
  const res = await fetch(SPEC_URL, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Koru-Desktop spec-capture (sietehierros@gmail.com)",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} al pedir ${SPEC_URL}`);
  const spec = await res.json();

  const endpoints = extractEndpoints(spec);
  if (endpoints.length === 0) throw new Error("La spec no contenía rutas (paths). ¿URL o fecha incorrecta?");

  mkdirSync(OUT_DIR, { recursive: true });

  // Diff contra la captura anterior, si existe.
  if (existsSync(SNAP)) {
    let prev = null;
    try {
      prev = JSON.parse(readFileSync(SNAP, "utf8"));
    } catch {
      console.warn("(snapshot previo ilegible; se omite el diff)");
    }
    if (prev?.endpoints) {
      const { added, removed, scopeChanges, prevByKey } = diff(prev.endpoints, endpoints);
      console.log(`\n=== CAMBIOS desde ${prev.captured_at} (${prev.count} endpoints) ===`);
      console.log(`  + ${added.length} nuevos   - ${removed.length} retirados   ~ ${scopeChanges.length} con scopes cambiados`);
      for (const e of added) console.log(`  +  ${keyOf(e)}  [${e.scopes.join(", ") || "público"}]`);
      for (const e of removed) console.log(`  -  ${keyOf(e)}`);
      for (const e of scopeChanges)
        console.log(`  ~  ${keyOf(e)}: [${prevByKey.get(keyOf(e)).scopes.join(", ")}] -> [${e.scopes.join(", ")}]`);
      if (!added.length && !removed.length && !scopeChanges.length) console.log("  (sin cambios)");
    }
  } else {
    console.log("Primera captura (no hay snapshot previo con el que comparar).");
  }

  const snapshot = {
    captured_at: new Date().toISOString(),
    compatibility_date: DATE,
    spec_version: spec.info?.version ?? null,
    count: endpoints.length,
    endpoints,
  };
  writeFileSync(SNAP, JSON.stringify(snapshot, null, 2) + "\n");
  writeFileSync(MD, buildMarkdown(snapshot));

  console.log(`\nGuardado:\n  ${MD}\n  ${SNAP}\n  → ${endpoints.length} endpoints en ${new Set(endpoints.map((e) => e.tags[0])).size} categorías`);
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
