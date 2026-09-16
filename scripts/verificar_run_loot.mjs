/**
 * Comprueba el BOTÍN OBJETO A OBJETO de una run (`run_loot`).
 *
 * Solo lee. Carga `src/runLoot.ts` TAL CUAL — no tiene una copia de la cuenta, o mediría al auditor.
 *
 *   node scripts/verificar_run_loot.mjs
 *
 * ★ EL INVARIANTE QUE JUSTIFICA LA PRUEBA: la suma de las líneas guardadas tiene que dar
 *   EXACTAMENTE el total que el modal enseñó y el usuario aceptó. Si no cuadra, la ficha de detalle
 *   diría un número y el histórico otro **sobre el mismo botín** — dos verdades del mismo dato, que
 *   es el fallo del que llevo registro.
 *
 *   El total del modal es `computed = totalFromPaste − bpIskDelPegado + fallbackIsk`
 *   (`lootPasteModal.tsx`). Aquí se reproduce esa fórmula desde los datos de entrada y se compara
 *   con `sumaDeLineas`. Que las dos cuentas se parezcan no vale: tienen que dar lo mismo.
 */
import { lineasDeBotin, sumaDeLineas, ISK_SRC } from "../src/runLoot.ts";

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

/** La MISMA fórmula del total que usa el modal, desde los mismos datos de entrada. */
const totalDelModal = (items, bpSet, precios) => {
  const esBp = (t) => t != null && (bpSet?.has(t) ?? false);
  const totalFromPaste = items.reduce((a, i) => a + (i.iskFromPaste ?? 0), 0);
  const bpIskDelPegado = items.filter((i) => esBp(i.typeId)).reduce((a, i) => a + (i.iskFromPaste ?? 0), 0);
  const fallback = items
    .filter((i) => i.iskFromPaste == null && i.typeId != null && !esBp(i.typeId))
    .reduce((a, i) => a + (precios[i.typeId] ? precios[i.typeId] * i.qty : 0), 0);
  return totalFromPaste - bpIskDelPegado + fallback;
};

const it = (name, qty, iskFromPaste, typeId) => ({ name, qty, iskFromPaste, typeId });

console.log("\n1) PRECIO DEL PEGADO — el valor de la LÍNEA, tal cual");
{
  const items = [it("Tritanium", 12000, 500000, 34)];
  const l = lineasDeBotin(items, new Set(), {});
  comp("isk como venía", l[0].isk, 500000);
  comp("procedencia: pegado", l[0].isk_src, ISK_SRC.pegado);
}

console.log("\n2) PRECIO LOCAL DE KORU — es UNITARIO, hay que multiplicar por qty");
{
  // La trampa: 12.000 tritanios a 5 ISK son 60.000, no 5.
  const items = [it("Tritanium", 12000, null, 34)];
  const l = lineasDeBotin(items, new Set(), { 34: 5 });
  comp("isk = precio × cantidad", l[0].isk, 60000);
  comp("procedencia: koru", l[0].isk_src, ISK_SRC.koru);
}

console.log("\n3) BLUEPRINT — NO se valora, aunque el pegado le pusiera precio");
{
  // Un BPC y su BPO comparten typeID y un BPC no se vende en mercado: el precio es de OTRA cosa.
  const items = [it("Leshak Blueprint", 1, 300000000, 77777)];
  const l = lineasDeBotin(items, new Set([77777]), {});
  comp("sin valor", l[0].isk, null);
  comp("y dice por qué", l[0].isk_src, ISK_SRC.bpc);
  // ★ Esto es lo que rompería el invariante si la regla del blueprint no fuera la PRIMERA: el modal
  //   se lo descuenta del total, así que valorarlo aquí sumaría 300 M que el usuario no vio.
  comp("el total del modal también lo descuenta", totalDelModal(items, new Set([77777]), {}), 0);
  comp("y la suma de líneas cuadra", sumaDeLineas(l), 0);
}

console.log("\n4) LO QUE KORU NO RECONOCIÓ — la línea se guarda igual");
{
  const items = [it("Cosa Rara XYZ", 3, null, null)];
  const l = lineasDeBotin(items, new Set(), {});
  comp("no se descarta", l.length, 1);
  comp("con su nombre pegado", l[0].name, "Cosa Rara XYZ");
  comp("type_id nulo", l[0].type_id, null);
  comp("sin valor ni procedencia", [l[0].isk, l[0].isk_src], [null, ISK_SRC.ninguno]);
}

console.log("\n5) `bpSet` AÚN CARGANDO (null) — nada es blueprint, igual que en el modal");
{
  const items = [it("Leshak Blueprint", 1, 300000000, 77777)];
  const l = lineasDeBotin(items, null, {});
  comp("se valora con lo que dice el pegado", l[0].isk, 300000000);
  comp("y el modal opina lo mismo", totalDelModal(items, null, {}), 300000000);
  comp("invariante en pie", sumaDeLineas(l), totalDelModal(items, null, {}));
}

console.log("\n6) ★ EL INVARIANTE, sobre un pegado MEZCLADO de los cuatro casos");
{
  const bpSet = new Set([77777]);
  const precios = { 34: 5, 11399: 850000 };
  const items = [
    it("Tritanium", 12000, 500000, 34), // precio del pegado
    it("Tritanium", 3000, null, 34), // otra pila, sin precio → local × qty
    it("Morphite", 210, null, 11399), // local × qty
    it("Leshak Blueprint", 1, 300000000, 77777), // blueprint con precio → no vale
    it("Cosa Rara XYZ", 1, null, null), // sin resolver
    it("Nanite Repair Paste", 50, 1250000, 28668), // precio del pegado
  ];
  const l = lineasDeBotin(items, bpSet, precios);
  const esperadoModal = totalDelModal(items, bpSet, precios);
  comp("seis líneas, ninguna perdida", l.length, 6);
  comp("la suma de líneas ES el total del modal", sumaDeLineas(l), esperadoModal);
  console.log(`      (total: ${esperadoModal.toLocaleString("es-ES")} ISK)`);
  comp(
    "procedencias",
    l.map((x) => x.isk_src),
    [ISK_SRC.pegado, ISK_SRC.koru, ISK_SRC.koru, ISK_SRC.bpc, ISK_SRC.ninguno, ISK_SRC.pegado],
  );
  // Las dos pilas del mismo tipo siguen siendo DOS líneas: fundirlas cambiaría lo que pegaste.
  comp("el mismo tipo en dos pilas son dos líneas", l.filter((x) => x.type_id === 34).length, 2);
}

console.log("\n7) VACÍO");
{
  comp("sin items, sin líneas", lineasDeBotin([], new Set(), {}), []);
  comp("y suma cero", sumaDeLineas([]), 0);
}

console.log(`\n${"─".repeat(60)}\n${ok} bien · ${mal} mal`);
process.exit(mal === 0 ? 0 : 1);
