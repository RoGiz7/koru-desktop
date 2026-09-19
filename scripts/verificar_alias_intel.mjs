/**
 * Comprueba la CORRECCIÓN A MANO de un reporte de intel (`intel_alias_linea` + `intel_alias_item`).
 *
 * Solo lee. Carga `src/intel.ts` tal cual — no tiene troceador propio, o mediría al auditor.
 *
 * El caso real que lo motivó (2026-09-09, cazado por él en vivo): alguien llamado
 * «Stykes Stormbringer» hacía que Koru leyera un piloto «Stykes» —que no existe— y una nave
 * «Stormbringer» que nadie volaba. 194 apariciones en su canal, reportadas por 66 personas.
 *
 * ★ AMPLIADO (2026-09-19): la declaración es la LÍNEA ENTERA —lista de pilotos + lista de naves—
 * con semántica de SUSTITUCIÓN: lo que salió del texto declarado se tira y entra lo declarado. Por
 * eso la nave «de verdad» (Stabber) ahora tiene que ir EN la declaración para conservarse: la
 * pantalla la prerrellena con la lectura de Koru, así que el piloto solo quita lo que sobra.
 *
 *   node scripts/verificar_alias_intel.mjs
 */
import { classifyIntel, claveAlias, mapaAlias } from "../src/intel.ts";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ne = JSON.parse(fs.readFileSync(path.join(raiz, "public/neweden.json"), "utf8"));
const nameIdx = new Map(ne.systems.map((s) => [s.n.toLowerCase(), s]));
const shipNames = new Map(
  Object.entries(JSON.parse(fs.readFileSync(path.join(raiz, "public/ship_names.json"), "utf8"))),
);
const nave = (nombre) => {
  const id = shipNames.get(nombre.toLowerCase());
  if (!id) throw new Error(`no está en el catálogo: ${nombre}`);
  return { id, name: nombre };
};
/** Monta el mapa por la MISMA puerta que el mapa y la reconstrucción (`mapaAlias`). */
const decl = (msg, pilots, ships) =>
  mapaAlias([{ texto: claveAlias(msg), pilots: pilots.map((n, i) => ({ id: i + 1, name: n })), ships }]);
const parse = (m, a) => classifyIntel(m, nameIdx, shipNames, undefined, undefined, undefined, a);
const naves = (p) => p.ships.map((s) => s.name.toLowerCase());

let fallos = 0;
const comprueba = (titulo, cond, detalle) => {
  console.log(`${cond ? "  ok  " : "  ✗   "}${titulo}${cond ? "" : `   → ${detalle}`}`);
  if (!cond) fallos++;
};

// ── 1. Stykes Stormbringer (el caso original) ─────────────────────────────────────────────
const MSG = "I-1QKL Stykes Stormbringer stabber in ESS";
const ALIAS = decl(MSG, ["Stykes Stormbringer"], [nave("Stabber")]);

const sin = parse(MSG, undefined);
comprueba("sin corrección, el fallo sigue ahí (piloto «Stykes»)",
  sin.pilots.includes("Stykes"), sin.pilots.join(","));
comprueba("sin corrección, la nave fantasma sigue ahí",
  naves(sin).includes("stormbringer"), naves(sin).join(","));

const con = parse(MSG, ALIAS);
comprueba("con corrección, sale la persona entera",
  con.pilots.includes("Stykes Stormbringer"), con.pilots.join(","));
comprueba("con corrección, el piloto fantasma DESAPARECE",
  !con.pilots.includes("Stykes"), con.pilots.join(","));
comprueba("con corrección, la nave fantasma DESAPARECE",
  !naves(con).includes("stormbringer"), naves(con).join(","));
comprueba("con corrección, la nave declarada se conserva (stabber) y solo una vez",
  naves(con).filter((n) => n === "stabber").length === 1, naves(con).join(","));
comprueba("el sistema no se toca",
  con.systems.length === 1 && con.systems[0].name === "I-1QKL", con.systems.map((s) => s.name).join(","));

// ── 2. Espaciado ──────────────────────────────────────────────────────────────────────────
const ESPACIADO = "EFM-C4   Christine  Stormbringer\tBuzzard";
const esp = parse(ESPACIADO, decl(ESPACIADO, ["Christine Stormbringer"], [nave("Buzzard")]));
comprueba("espacios dobles y tabuladores NO rompen la corrección",
  esp.pilots.includes("Christine Stormbringer"), esp.pilots.join(","));
comprueba("y la nave declarada se conserva (Buzzard)",
  naves(esp).includes("buzzard"), naves(esp).join(","));
comprueba("la misma frase con espaciado distinto da la MISMA clave",
  claveAlias(ESPACIADO) === claveAlias("EFM-C4 Christine Stormbringer Buzzard"),
  claveAlias(ESPACIADO));

// ── 3. Otra línea no se ve afectada ───────────────────────────────────────────────────────
const otra = parse("I-1QKL Lord Road loki", ALIAS);
comprueba("otra línea NO se ve afectada por la corrección",
  otra.pilots.includes("Lord Road") && naves(otra).includes("loki"),
  `${otra.pilots.join(",")} | ${naves(otra).join(",")}`);

// ── 4. ★ NUEVO: «Navy Brutix +4» → cero pilotos y la nave ─────────────────────────────────
//   El modo de fallo documentado: «Navy» suelto pasa por piloto. La corrección es declarar que
//   NO hay pilotos y que la nave es Brutix Navy Issue. Cero pilotos es una declaración válida.
const BRUTIX = "5E-CMA Navy Brutix +4";
const sinB = parse(BRUTIX, undefined);
comprueba("Brutix: sin corrección, Koru lee algo (piloto o nave) — el caso existe",
  sinB.pilots.length + sinB.ships.length > 0, "nada");
const conB = parse(BRUTIX, decl(BRUTIX, [], [nave("Brutix Navy Issue")]));
comprueba("Brutix: con corrección, CERO pilotos",
  conB.pilots.length === 0, conB.pilots.join(","));
comprueba("Brutix: con corrección, la nave es Brutix Navy Issue",
  naves(conB).length === 1 && naves(conB)[0] === "brutix navy issue", naves(conB).join(","));
comprueba("Brutix: el contador +4 se conserva",
  conB.count === 4, String(conB.count));

// ── 5. ★ NUEVO: separar DOS nombres que Koru leyó como uno ────────────────────────────────
const DOS = "X0-6LH Hoto Kokoa Miyohashi Koori";
const sinD = parse(DOS, undefined);
comprueba("Dos nombres: sin corrección salen pegados en UN nombre (espacios simples)",
  sinD.pilots.length === 1, sinD.pilots.join(","));
const conD = parse(DOS, decl(DOS, ["Hoto Kokoa", "Miyohashi Koori"], []));
comprueba("Dos nombres: con corrección salen los DOS y el pegado desaparece",
  conD.pilots.length === 2 && conD.pilots.includes("Hoto Kokoa") && conD.pilots.includes("Miyohashi Koori"),
  conD.pilots.join(","));

// ── 6. ★ NUEVO: «aquí no hay nadie» (jerga sin tocar ninguna lista global) ────────────────
const NADIE = "1DQ1-A Wardec Party";
const sinN = parse(NADIE, undefined);
comprueba("Nadie: sin corrección Koru inventa a alguien (es el caso que se corrige)",
  sinN.pilots.length > 0, "nadie");
const conN = parse(NADIE, decl(NADIE, [], []));
comprueba("Nadie: con declaración vacía, cero pilotos y cero naves, el sistema sigue",
  conN.pilots.length === 0 && conN.ships.length === 0 && conN.systems.length === 1,
  `${conN.pilots.join(",")} | ${naves(conN).join(",")}`);
comprueba("Nadie: y la MISMA jerga en OTRO sistema NO se ve afectada (la corrección es por línea)",
  parse("J-CIJV Wardec Party", decl(NADIE, [], [])).pilots.length > 0, "se aplicó fuera de su línea");

// ── 7. Una línea corta declarada, contenida en una más larga: solo se retira lo suyo ──────
const CORTA = "I-1QKL Stykes Stormbringer";
const LARGA = "I-1QKL Stykes Stormbringer   Lord Road loki";
const conL = parse(LARGA, decl(CORTA, ["Stykes Stormbringer"], []));
comprueba("Contenida: la persona declarada entra y el fantasma sale",
  conL.pilots.includes("Stykes Stormbringer") && !conL.pilots.includes("Stykes"), conL.pilots.join(","));
comprueba("Contenida: lo que está FUERA del texto declarado se conserva (Lord Road, loki)",
  conL.pilots.includes("Lord Road") && naves(conL).includes("loki"),
  `${conL.pilots.join(",")} | ${naves(conL).join(",")}`);

const total = 22;
console.log(fallos === 0 ? `\n${total} de ${total}.` : `\n🚨 ${fallos} fallo(s) de ${total}.`);
process.exit(fallos === 0 ? 0 : 1);
