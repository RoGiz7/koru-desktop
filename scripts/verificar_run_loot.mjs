/**
 * Comprueba el BOTÍN OBJETO A OBJETO de una run (`run_loot`).
 *
 * Solo lee. Carga `src/runLoot.ts` TAL CUAL — no tiene una copia de la cuenta, o mediría al auditor.
 *
 *   node scripts/verificar_run_loot.mjs
 *
 * ★ DESDE EL 2026-10-24 el total del modal ES `sumaDeLineas(lineasDeBotin(...))` — una sola cuenta,
 *   así que el invariante «líneas = total» ya no puede romperse. Lo que se prueba ahora es el
 *   CRITERIO: todo a precio de Jita (por unidad × qty); el precio del pegado (media del juego) solo
 *   si Jita no dio nada; los blueprints nunca; lo no reconocido se guarda sin valor. Y `revalorarLineas`.
 */
import { lineasDeBotin, sumaDeLineas, revalorarLineas, hayLineasSinPrecio, ISK_SRC } from "../src/runLoot.ts";

let ok = 0;
let mal = 0;
const comp = (nombre, real, esperado) => {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  if (a === b) {
    ok++;
    console.log(`  ✓ ${nombre}`);
  } else {
    mal++;
    console.log(`  ✗ ${nombre}\n      esperado: ${b}\n      real:     ${a}`);
  }
};

const it = (name, qty, iskFromPaste, typeId) => ({ name, qty, iskFromPaste, typeId });

console.log("\n1) ★ JITA MANDA aunque el pegado traiga precio (mismo botín, mismo total)");
{
  const items = [it("Tritanium", 12000, 500000, 34)];
  const l = lineasDeBotin(items, new Set(), { 34: 5 });
  comp("isk = precio Jita × cantidad", l[0].isk, 60000);
  comp("procedencia: koru (Jita)", l[0].isk_src, ISK_SRC.koru);
  const sinCol = lineasDeBotin([it("Tritanium", 12000, null, 34)], new Set(), { 34: 5 });
  comp("vista de iconos (sin columna) da LO MISMO", sumaDeLineas(sinCol), sumaDeLineas(l));
}

console.log("\n2) SIN PRECIO EN JITA → queda el del pegado (valor de la LÍNEA)");
{
  const l = lineasDeBotin([it("Cosa de nicho", 2, 700000, 999)], new Set(), {});
  comp("isk del pegado tal cual", l[0].isk, 700000);
  comp("procedencia: pegado", l[0].isk_src, ISK_SRC.pegado);
}

console.log("\n3) BLUEPRINT — NO se valora, ni con Jita ni con el pegado");
{
  const l = lineasDeBotin([it("Leshak Blueprint", 1, 300000000, 77777)], new Set([77777]), { 77777: 1e9 });
  comp("sin valor", l[0].isk, null);
  comp("y dice por qué", l[0].isk_src, ISK_SRC.bpc);
}

console.log("\n4) LO QUE KORU NO RECONOCIÓ — la línea se guarda igual");
{
  const l = lineasDeBotin([it("Cosa Rara XYZ", 3, null, null)], new Set(), {});
  comp("no se descarta", l.length, 1);
  comp("sin valor ni procedencia", [l[0].isk, l[0].isk_src], [null, ISK_SRC.ninguno]);
}

console.log("\n5) ★ EL CASO DEL TESTER: la consulta falló → todo «—»; revalorar lo arregla");
{
  const items = [
    it("23rd Tier Overseer's Personal Effects", 1, null, 19421),
    it("Domination Stasis Webifier", 1, null, 14264),
    it("Leshak Blueprint", 1, null, 77777),
  ];
  const guardadas = lineasDeBotin(items, new Set([77777]), {}); // precios vacíos: falló
  comp("se guardó sin precio", guardadas.map((x) => x.isk), [null, null, null]);
  comp("y eso activa «Revalorar»", hayLineasSinPrecio(guardadas), true);
  const nuevas = revalorarLineas(guardadas, { 19421: 124.4e6, 14264: 145.2e6, 77777: 1e9 });
  comp("revaloradas a Jita", nuevas.map((x) => x.isk), [124.4e6, 145.2e6, null]);
  comp("el BPC sigue sin valor", nuevas[2].isk_src, ISK_SRC.bpc);
  comp("ya no hay líneas sin precio", hayLineasSinPrecio(nuevas), false);
  comp("total nuevo", sumaDeLineas(nuevas), 269.6e6);
}

console.log("\n6) REVALORAR no pisa lo que Jita sigue sin saber valorar");
{
  const g = [{ type_id: 999, name: "x", qty: 2, isk: 700000, isk_src: ISK_SRC.pegado }];
  comp("se queda el del juego", revalorarLineas(g, {}), g);
}

console.log("\n7) VACÍO");
{
  comp("sin items, sin líneas", lineasDeBotin([], new Set(), {}), []);
  comp("y suma cero", sumaDeLineas([]), 0);
}

console.log(`\n${"─".repeat(60)}\n${ok} bien · ${mal} mal`);
process.exit(mal === 0 ? 0 : 1);
