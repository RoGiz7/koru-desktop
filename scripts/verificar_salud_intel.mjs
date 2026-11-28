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
import { esFaltaPermiso } from "../src/errores.ts";
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
const pastilla = cuenta;

// Posiciones sin confirmar (src/posiciones.ts). Pilotos de mentira.
console.log("Posiciones — la palabra y su sitio en el orden");
const hace3 = Date.now() - 3 * 60000;
const vieja = { sin: [{ id: 1, name: "Piloto 1", clase: "vieja", desdeMs: hace3, motivo: "sin_respuesta_posicion" }], sinReferencias: false };
const sinPos = { sin: [{ id: 2, name: "Piloto 2", clase: "sin_posicion", desdeMs: hace3, motivo: null }], sinReferencias: false };
const pv = saludVigilante(sano, null, vieja);
ok(pv[0] === "warn" && pv[3] === "Posición: fallo", "posición vieja: ámbar y «Posición: fallo» (el aviso sí suena)");
ok(pv[1].includes("1 piloto,") && pv[1].includes("3 min"), "la línea dice cuántos pilotos y desde hace cuánto");
ok(pv[2].includes("Piloto 1") && pv[2].includes("última posición conocida") && pv[2].includes("se miden desde su última posición conocida"),
  "el tooltip dice quién, por qué y que los saltos se miden desde la última posición conocida");
const ps = saludVigilante(sano, null, sinPos);
ok(ps[3] === "Posición: fallo" && ps[2].includes("sin posición") && ps[2].includes("no cuenta para medir"),
  "sin posición: la misma palabra, y el tooltip dice que no cuenta para medir hasta que se sepa");
ok(saludVigilante({ ...sano, files: 0 }, null, vieja)[3] === "Sin logs", "«sin logs» gana a la posición (va antes en el orden)");
ok(saludVigilante(sano, err, vieja)[3] === "Posición: fallo", "la posición gana al camino del plan");
ok(saludVigilante({ ...sano, graph_systems: 0 }, null, vieja)[3] === "No avisa", "los rojos de hoy ganan a la posición");
const sr = saludVigilante(sano, null, { ...sinPos, sinReferencias: true });
ok(sr[0] === "bad" && sr[3] === "No avisa" && sr[2].includes("no tiene desde dónde medir"),
  "sin NINGUNA referencia por este fallo: rojo y «No avisa», con el motivo");
ok(saludVigilante({ ...sano, files: 0 }, null, { ...sinPos, sinReferencias: true })[3] === "No avisa", "y eso gana también a «sin logs»: no puede avisar");
ok(saludVigilante(sano, null, null)[3] === "Activo" && saludVigilante(sano, null, { sin: [], sinReferencias: false })[3] === "Activo",
  "vuelta a la normalidad: sin nadie sin confirmar, «Activo» otra vez");
const posiciones = cuenta - pastilla;

// «Falta el acceso» SOLO cuando falta el acceso (AppError::FaltaScope). Los textos son los que
// devuelve el backend hoy: el de token_with_scope, un 502 de ESI y el OAuth que sigue existiendo.
console.log("Errores — ¿falta el permiso, o ha fallado otra cosa?");
ok(esFaltaPermiso("Falta permiso: este personaje no concedió el scope necesario. Inicia sesión con la feature 'Fatiga de salto'."),
  "el error del scope que falta: sí");
ok(!esFaltaPermiso("ESI 502 Bad Gateway en /characters/1/fatigue/: "), "un 502 de ESI: no");
ok(!esFaltaPermiso("OAuth: sin refresh token para 1"), "otro error de OAuth: no");
ok(!esFaltaPermiso("HTTP: error sending request"), "la red: no");

console.log(`\n${cuenta - fallos}/${cuenta} bien (pastilla: ${pastilla}, posiciones: ${posiciones}, errores: ${cuenta - pastilla - posiciones})`);
process.exit(fallos ? 1 : 0);
