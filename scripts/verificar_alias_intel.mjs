/**
 * Comprueba la CORRECCIÓN A MANO de un reporte de intel (`intel_alias`).
 *
 * Solo lee. Carga `src/intel.ts` tal cual — no tiene troceador propio, o mediría al auditor.
 *
 * El caso real que lo motivó (2026-09-09, cazado por él en vivo): alguien llamado
 * «Stykes Stormbringer» hacía que Koru leyera un piloto «Stykes» —que no existe— y una nave
 * «Stormbringer» que nadie volaba. 194 apariciones en su canal, reportadas por 66 personas.
 *
 *   node scripts/verificar_alias_intel.mjs
 */
import { classifyIntel } from "../src/intel.ts";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ne = JSON.parse(fs.readFileSync(path.join(raiz, "public/neweden.json"), "utf8"));
const nameIdx = new Map(ne.systems.map((s) => [s.n.toLowerCase(), s]));
const shipNames = new Map(
  Object.entries(JSON.parse(fs.readFileSync(path.join(raiz, "public/ship_names.json"), "utf8"))),
);

const MSG = "I-1QKL Stykes Stormbringer stabber in ESS";
const ALIAS = new Map([[MSG.toLowerCase(), "Stykes Stormbringer"]]);
const parse = (m, a) => classifyIntel(m, nameIdx, shipNames, undefined, undefined, undefined, a);

let fallos = 0;
const comprueba = (titulo, cond, detalle) => {
  console.log(`${cond ? "  ok  " : "  ✗   "}${titulo}${cond ? "" : `   → ${detalle}`}`);
  if (!cond) fallos++;
};

const sin = parse(MSG, undefined);
comprueba("sin corrección, el fallo sigue ahí (piloto «Stykes»)",
  sin.pilots.includes("Stykes"), sin.pilots.join(","));
comprueba("sin corrección, la nave fantasma sigue ahí",
  sin.ships.some((s) => s.name.toLowerCase() === "stormbringer"), sin.ships.map((s) => s.name).join(","));

const con = parse(MSG, ALIAS);
comprueba("con corrección, sale la persona entera",
  con.pilots.includes("Stykes Stormbringer"), con.pilots.join(","));
comprueba("con corrección, el piloto fantasma DESAPARECE",
  !con.pilots.includes("Stykes"), con.pilots.join(","));
comprueba("con corrección, la nave fantasma DESAPARECE",
  !con.ships.some((s) => s.name.toLowerCase() === "stormbringer"), con.ships.map((s) => s.name).join(","));
// ★ El que se me escapó al escribirlo: quitar de más es tan malo como no quitar.
comprueba("con corrección, la nave DE VERDAD se conserva (stabber)",
  con.ships.some((s) => s.name.toLowerCase() === "stabber"), con.ships.map((s) => s.name).join(","));

const otra = parse("I-1QKL Lord Road loki", ALIAS);
comprueba("otra línea NO se ve afectada por la corrección",
  otra.pilots.includes("Lord Road") && otra.ships.some((s) => s.name.toLowerCase() === "loki"),
  `${otra.pilots.join(",")} | ${otra.ships.map((s) => s.name).join(",")}`);

console.log(fallos === 0 ? "\n7 de 7." : `\n🚨 ${fallos} fallo(s).`);
process.exit(fallos === 0 ? 0 : 1);
