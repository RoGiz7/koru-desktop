/**
 * Comprueba la PALABRA de la pastilla de «Intel en vivo» y su línea de salud (`saludVigilante`),
 * también cuando el camino del plan no le llega al vigilante.
 *
 * Solo lee. Carga `src/saludIntel.ts` TAL CUAL.
 *
 *   node scripts/verificar_salud_intel.mjs
 *
 * Se lanza SIEMPRE que se toque `saludIntel.ts`. La regla que vigila: la palabra tiene que ser
 * cierta ELLA SOLA, y lo que ya decía la pastilla antes del plan gana al camino.
 * Entró al repo el 26-11 con sus 8 comprobaciones (venía de un temporal de sesión).
 */
import { saludVigilante } from "../src/saludIntel.ts";
let fallos = 0;
let cuenta = 0;
const ok = (c, m) => {
  cuenta++;
  if (!c) {
    fallos++;
    console.log("  ✗", m);
  } else console.log("  ✓", m);
};
const sano = { collecting: true, idle_reason: null, last_error: null, lines: 40, files: 2, last_tick_ms: Date.now(), graph_systems: 5000 };
const err = "los tramos del plan están envenenados";

const a = saludVigilante(sano, null);
ok(a[0] === "ok" && a[3] === "Activo", "sano y camino al día: «Activo»");

const b = saludVigilante(sano, err);
ok(b[0] === "warn" && b[3] === "Camino: fallo", "camino sin llegar: la palabra lo dice, no «Activo»");
ok(b[2] === err, "el porqué va en el tooltip");
ok(b[3] !== "Sin logs" && b[3] !== "No avisa", "ni «Sin logs» ni «No avisa»: los dos serían falsos");

const c = saludVigilante({ ...sano, files: 0 }, err);
ok(c[3] === "Sin logs", "sin logs gana: es cierto y ya incluye al camino");
const d = saludVigilante({ ...sano, graph_systems: 0 }, err);
ok(d[0] === "bad" && d[3] === "No avisa", "sin grafo gana: no avisa nada, tampoco el camino");
const e = saludVigilante({ ...sano, last_tick_ms: Date.now() - 60000 }, err);
ok(e[3] === "No avisa", "hilo mudo gana");
ok(saludVigilante(sano)[3] === "Activo", "sin segundo argumento, como antes");
console.log(`\n${cuenta - fallos}/${cuenta} bien`);
process.exit(fallos ? 1 : 0);
