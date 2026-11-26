/**
 * Comprueba el comprobador de skills del visor de fits (`src/skillCheck.ts`): «no lo conozco» no
 * es «no pide nada».
 *
 * Solo lee. Carga `src/skillCheck.ts` TAL CUAL — no tiene una copia de la regla.
 *
 *   node scripts/verificar_skillcheck.mjs
 *
 * Los nombres de nave y módulo son inventados; los ids de skill son de mentira. La trampa que vigila
 * por encima de todo: un tipo que falta del catálogo NO puede contar como «no pide nada».
 */
import { comprobarSkills } from "../src/skillCheck.ts";

let fallos = 0;
let cuenta = 0;
const ok = (c, m) => {
  cuenta++;
  if (!c) {
    fallos++;
    console.log("  ✗", m);
  } else console.log("  ✓", m);
};

// Catálogo de mentira: 1 = nave, 2 = módulo, 3 = módulo que no pide nada ([]), 4 = carga sin
// requisitos ([]). Skills: 900 «Pilotaje de Prueba», 901 «Armas de Prueba».
const CAT = { 1: [[900, 3]], 2: [[901, 2], [900, 1]], 3: [], 4: [] };
const NOMBRES = { 900: "Pilotaje de Prueba", 901: "Armas de Prueba" };
const nombre = (s) => NOMBRES[s] ?? `#${s}`;
const nave = { type_id: 1, name: "Fragata Inventada", montado: true };
const mod = { type_id: 2, name: "Cañón Inventado", montado: true };
const libre = { type_id: 3, name: "Placa Inventada", montado: true };
const raro = { type_id: 77, name: "Módulo Que Koru No Conoce", montado: true };
const bodega = { type_id: 88, name: "Mineral Inventado", montado: false };
const todas = { 900: 5, 901: 5 };

{
  const r = comprobarSkills([nave, mod], CAT, todas, nombre);
  ok(r.veredicto === "puede" && r.faltan.length === 0 && r.desconocidos.length === 0, "todo conocido, tiene todas las skills: puede");
}
{
  const r = comprobarSkills([nave, mod], CAT, { 900: 5, 901: 1 }, nombre);
  ok(r.veredicto === "faltan" && r.faltan.length === 1 && r.faltan[0].name === "Armas de Prueba" && r.faltan[0].need === 2 && r.faltan[0].have === 1,
    "todo conocido, le falta una: le faltan skills, y dice cuál y a qué nivel");
}
{
  const r = comprobarSkills([libre], CAT, {}, nombre);
  ok(r.veredicto === "puede" && r.desconocidos.length === 0, "un tipo con [] y nada más: puede");
}
{
  const r = comprobarSkills([nave, raro], CAT, todas, nombre);
  ok(r.veredicto === "no_se_sabe" && r.desconocidos.length === 1 && r.desconocidos[0].name === "Módulo Que Koru No Conoce",
    "un tipo que no está en el catálogo: no se sabe, y dice cuál");
}
{
  const r = comprobarSkills([nave, mod, raro], CAT, { 900: 5, 901: 0 }, nombre);
  ok(r.veredicto === "no_se_sabe" && r.desconocidos.length === 1 && r.faltan.length === 1 && r.faltan[0].name === "Armas de Prueba",
    "uno desconocido Y una skill que falta: no se sabe, y además la skill que falta");
}
{
  ok(comprobarSkills([nave, raro], null, todas, nombre) === null, "el catálogo sin cargar todavía: no hay informe (no «no se sabe» de todo)");
  ok(comprobarSkills([nave], CAT, null, nombre) === null, "las skills del personaje sin cargar: no hay informe");
}
// ---- lo montado decide; la bodega no ----
{
  const r = comprobarSkills([nave, mod, bodega], CAT, todas, nombre);
  ok(r.veredicto === "puede" && r.sinComprobar.length === 1 && r.sinComprobar[0].name === "Mineral Inventado",
    "nave y módulos conocidos, con mineral en la bodega: «puede», más la línea discreta de lo no mirado");
  const r2 = comprobarSkills([nave, { ...mod, montado: false }], CAT, { 900: 5, 901: 0 }, nombre);
  ok(r2.veredicto === "faltan", "un dron o carga CONOCIDO que pide skills sigue contando, como antes");
  const r3 = comprobarSkills([raro, { ...raro, montado: false }, raro], CAT, todas, nombre);
  ok(r3.desconocidos.length === 1 && r3.sinComprobar.length === 0, "montado y en la bodega a la vez: uno, y como desconocido montado");
}

console.log(`\n${cuenta - fallos}/${cuenta} bien`);
process.exit(fallos ? 1 : 0);
