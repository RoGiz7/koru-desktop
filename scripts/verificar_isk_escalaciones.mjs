/**
 * Comprueba la gráfica de ISK por días de ESCALACIONES (`agregarIsk`).
 *
 * Solo lee. Carga `src/escalacionesIsk.ts` TAL CUAL — no tiene una copia del cálculo, o mediría al
 * auditor. Ése es el motivo de que la función viva fuera del componente.
 *
 *   node scripts/verificar_isk_escalaciones.mjs
 *
 * LO QUE VIGILA, y por qué cada cosa:
 *  1. Una escalación COBRADA sigue viva (en_venta → cobrada → entregada → cerrada). Leer solo el
 *     histórico dejaría fuera ISK que ya entró, y la gráfica lo callaría.
 *  2. La misma escalación en las dos listas no puede contarse dos veces.
 *  3. La venta va el día que se COBRÓ, no el día que se apuntó ni el que se cerró.
 *  4. El botín va el día que se cerró la RUN.
 *  5. Los totales tienen que cuadrar con lo que se dibuja, también con un rango puesto.
 *  6. Un `ship_loss_isk` NO se resta del botín: va en su serie.
 *  7. `null` de botín no es 0: no inventa un punto.
 */
import { agregarIsk } from "../src/escalacionesIsk.ts";
import { parseIskShorthand, iskCorto } from "../src/isk.ts";

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

const esc = (id, extra) => ({
  id,
  precio: null,
  cobrada_at: null,
  cerrada_at: null,
  run_id: null,
  ...extra,
});

console.log("\n1) UNA VENTA COBRADA QUE SIGUE VIVA — la trampa del ciclo de venta");
{
  // Apuntada el 1, vendida el 2, COBRADA el 5. Estado `cobrada`: aún NO está en el histórico.
  const viva = esc(1, { precio: 300e6, cobrada_at: "2026-09-05T18:00:00Z" });
  const r = agregarIsk([viva], new Map(), "day");
  comp("la cuenta el día que se cobró", r.labels, ["2026-09-05"]);
  comp("con su importe", r.venta, [300e6]);
  comp("total de ventas", r.tVenta, 300e6);

  // Y la prueba que de verdad importa: si solo se mirara el histórico, esto saldría VACÍO.
  const soloHist = agregarIsk([], new Map(), "day");
  comp("mirar solo el histórico la perdería (por eso se pasan las dos listas)", soloHist.tVenta, 0);
}

console.log("\n2) LA MISMA ESCALACIÓN EN LAS DOS LISTAS — una vez, no dos");
{
  const e = esc(7, { precio: 500e6, cobrada_at: "2026-09-05T10:00:00Z" });
  // Tal cual llega del componente: [...vivas, ...hist] con la misma fila en las dos.
  const r = agregarIsk([e, { ...e }], new Map(), "day");
  comp("un solo punto", r.labels.length, 1);
  comp("y el importe SIN duplicar", r.tVenta, 500e6);
}

console.log("\n3) LA FECHA ES LA DEL COBRO, NO LA DEL CIERRE");
{
  const e = esc(2, {
    precio: 100e6,
    cobrada_at: "2026-09-05T12:00:00Z",
    cerrada_at: "2026-09-30T12:00:00Z", // el acceso se retiró tres semanas después
  });
  const r = agregarIsk([e], new Map(), "day");
  comp("gana `cobrada_at`", r.labels, ["2026-09-05"]);
}
{
  // Sin cobro anotado, `cerrada_at` es el respaldo: mejor el día aproximado que ningún punto.
  const e = esc(3, { precio: 50e6, cerrada_at: "2026-09-08T12:00:00Z" });
  const r = agregarIsk([e], new Map(), "day");
  comp("sin cobro, respalda con el cierre", r.labels, ["2026-09-08"]);
}

console.log("\n4) EL BOTÍN VA EL DÍA QUE SE CERRÓ LA RUN");
{
  const e = esc(4, { run_id: 90, cerrada_at: "2026-09-20T00:00:00Z" });
  const runs = new Map([
    [90, { loot_isk: 250e6, ship_loss_isk: null, ended_at: "2026-09-04T23:30:00Z" }],
  ]);
  const r = agregarIsk([e], runs, "day");
  comp("manda `ended_at` de la run", r.labels, ["2026-09-04"]);
  comp("el botín en su serie", r.botin, [250e6]);
  comp("y ventas a cero", r.tVenta, 0);
}

console.log("\n5) LA NAVE PERDIDA NO SE RESTA DEL BOTÍN");
{
  const e = esc(5, { run_id: 91 });
  const runs = new Map([
    [91, { loot_isk: 200e6, ship_loss_isk: 800e6, ended_at: "2026-09-04T20:00:00Z" }],
  ]);
  const r = agregarIsk([e], runs, "day");
  comp("botín entero, sin netear", r.botin, [200e6]);
  comp("pérdida en su propia serie", r.perdido, [800e6]);
  // Lo que se lee en pantalla: la noche fue de botín normal y nave carísima, no de «−600 M».
  comp("el neto lo hace el KPI, no la serie", r.tBotin - r.tPerdido, -600e6);
}

console.log("\n6) `null` NO ES CERO");
{
  const e = esc(6, { run_id: 92 });
  const runs = new Map([[92, { loot_isk: null, ship_loss_isk: null, ended_at: "2026-09-04T20:00:00Z" }]]);
  const r = agregarIsk([e], runs, "day");
  comp("una run sin botín anotado no dibuja un punto en cero", r.labels, []);
}

console.log("\n7) SEMANAS Y MESES");
{
  // 2026-09-07 es lunes; el 13, domingo. Los dos caen en la misma semana ISO.
  const runs = new Map([
    [1, { loot_isk: 100e6, ship_loss_isk: null, ended_at: "2026-09-07T10:00:00Z" }],
    [2, { loot_isk: 50e6, ship_loss_isk: null, ended_at: "2026-09-13T10:00:00Z" }],
    [3, { loot_isk: 70e6, ship_loss_isk: null, ended_at: "2026-09-14T10:00:00Z" }],
  ]);
  const es = [esc(11, { run_id: 1 }), esc(12, { run_id: 2 }), esc(13, { run_id: 3 })];
  const sem = agregarIsk(es, runs, "week");
  comp("dos semanas, no tres días", sem.labels.length, 2);
  comp("lunes y domingo suman en la misma", sem.botin[0], 150e6);
  const mes = agregarIsk(es, runs, "month");
  comp("un solo mes", mes.labels, ["2026-09"]);
  comp("con todo dentro", mes.tBotin, 220e6);
}

console.log("\n8) EL RANGO — y que los totales sigan cuadrando con lo dibujado");
{
  const runs = new Map([
    [1, { loot_isk: 100e6, ship_loss_isk: null, ended_at: "2026-08-15T10:00:00Z" }],
    [2, { loot_isk: 200e6, ship_loss_isk: null, ended_at: "2026-09-10T10:00:00Z" }],
  ]);
  const es = [esc(21, { run_id: 1 }), esc(22, { run_id: 2 })];

  const todo = agregarIsk(es, runs, "day");
  comp("sin rango entran las dos", todo.tBotin, 300e6);

  const sep = agregarIsk(es, runs, "day", "2026-09-01");
  comp("desde el 1 de septiembre, solo una", sep.labels, ["2026-09-10"]);
  comp("y el TOTAL respeta el rango (si no, el KPI y la gráfica discreparían)", sep.tBotin, 200e6);
  comp("el total es la suma de lo dibujado", sep.tBotin, sep.botin.reduce((a, b) => a + b, 0));

  const hasta = agregarIsk(es, runs, "day", "", "2026-08-31");
  comp("hasta el 31 de agosto, la otra", hasta.tBotin, 100e6);

  // El selector de año tiene que ofrecer los DOS años aunque el rango deje uno fuera: si no, al
  // elegir un año ese año desaparecería de la lista y no se podría volver.
  const runs2 = new Map([
    [3, { loot_isk: 10e6, ship_loss_isk: null, ended_at: "2025-05-05T10:00:00Z" }],
  ]);
  const r2 = agregarIsk([esc(31, { run_id: 3 }), ...es], new Map([...runs, ...runs2]), "day", "2026-01-01");
  comp("los años se apuntan antes de filtrar", r2.anios, [2026, 2025]);
  comp("pero los datos de 2025 no entran", r2.tBotin, 300e6);
}

console.log("\n9) VACÍO");
{
  const r = agregarIsk([], new Map(), "week");
  comp("sin escalaciones, sin series", r.labels, []);
  comp("y los totales a cero", [r.tBotin, r.tVenta, r.tPerdido], [0, 0, 0]);
}

console.log("\n10) ★ EL IDA Y VUELTA DEL PRECIO — el fallo que casi se escapa");
{
  // El panel de venta precarga el precio guardado para poder corregirlo. Si lo emite en un formato
  // que `parseIskShorthand` lee distinto, abrir el panel y guardar SIN TOCAR NADA cambia el dato.
  // Pasó: precargaba `precio / 1e6` («250» para 250 M) y un número sin sufijo son ISK enteros, o
  // sea 250 ISK. Un millón de veces menos, sin ningún error por medio.
  const casos = [250e6, 1e9, 2.5e9, 1500, 1e6, 45_500_000, 0, 7];
  let todos = true;
  for (const isk of casos) {
    const texto = iskCorto(isk);
    const vuelta = parseIskShorthand(texto);
    const bien = vuelta === isk;
    if (!bien) todos = false;
    console.log(`      ${bien ? "·" : "✗"} ${isk.toLocaleString("es-ES")} → "${texto}" → ${vuelta?.toLocaleString("es-ES")}`);
  }
  comp("todos los precios vuelven siendo el mismo número", todos, true);
  comp("null se precarga vacío (y no como un cero que no dijiste)", iskCorto(null), "");
  // Y la regla al revés: lo que precargamos NUNCA debe leerse como ISK sueltos cuando son millones.
  comp("250 M no vuelve como 250 ISK", parseIskShorthand(iskCorto(250e6)), 250e6);
}

console.log(`\n${"─".repeat(60)}\n${ok} bien · ${mal} mal`);
process.exit(mal === 0 ? 0 : 1);
