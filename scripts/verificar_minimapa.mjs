/**
 * Verifica la geometria del minimapa del overlay con el mapa DE VERDAD (public/neweden.json).
 * Solo lee. Carga `src/minimapa.ts` TAL CUAL — sin copia de la cuenta, o mediria al auditor.
 *
 *   node scripts/verificar_minimapa.mjs
 *
 * Lo que comprueba, y por que cada uno:
 *   · sin avisos queda TU punto (decision de RoGiz7: el minimapa no se esconde)
 *   · un aviso a N saltos da N+1 nodos y N aristas (el camino, ni mas ni menos)
 *   · el hostil en TU sistema es un solo nodo, y es «yo» Y «caliente» a la vez
 *   · el tope de 5 recorta los VIEJOS y cuenta los que quedan fuera
 *   · nada se sale del margen y NADA es NaN — un minimapa con NaN sale en blanco y parece apagado
 *   · un sistema inalcanzable por puertas (Pochven) no revienta: se cuenta aparte
 */
import { readFileSync } from "node:fs";
import { planoAmenaza, caminoMasCorto, TOPE_AVISOS } from "../src/minimapa.ts";

const ne = JSON.parse(readFileSync(new URL("../public/neweden.json", import.meta.url), "utf-8"));
const sistemas = new Map(ne.systems.map((s) => [s.id, { x: s.x, y: s.y, n: s.n, s: s.s }]));
const ady = new Map();
for (const [a, b] of ne.jumps) {
  if (!ady.has(a)) ady.set(a, []);
  if (!ady.has(b)) ady.set(b, []);
  ady.get(a).push(b); ady.get(b).push(a);
}

let bien = 0, mal = 0;
const ok = (t, c, extra = "") => { c ? bien++ : mal++; console.log(`  ${c ? "✓" : "✗"} ${t}${extra ? "  — " + extra : ""}`); };
const finito = (n) => Number.isFinite(n);

const JITA = 30000142;
const PX = 300, M = 26;
const aNSaltos = (o, n) => {
  const dist = new Map([[o, 0]]); const q = [o]; const out = [];
  for (let i = 0; i < q.length; i++) {
    const u = q[i];
    if (dist.get(u) === n) { out.push(u); continue; }
    for (const v of ady.get(u) ?? []) if (!dist.has(v)) { dist.set(v, dist.get(u) + 1); q.push(v); }
  }
  return out;
};

console.log("\n1) SIN AVISOS — se queda tu punto, no se esconde");
{
  const p = planoAmenaza({ sistemas, ady, yo: JITA, avisos: [], px: PX });
  ok("un solo nodo", p.nodos.length === 1, `${p.nodos.length}`);
  ok("y es TU", p.nodos[0]?.yo === true && p.nodos[0]?.caliente === false);
  ok("centrado", Math.abs(p.nodos[0].px - PX / 2) < 0.01 && Math.abs(p.nodos[0].py - PX / 2) < 0.01);
  ok("sin aristas", p.aristas.length === 0);
}

console.log("\n2) UN AVISO A 4 SALTOS — el camino, ni mas ni menos");
{
  const d = aNSaltos(JITA, 4)[0];
  const p = planoAmenaza({ sistemas, ady, yo: JITA, avisos: [{ sys: d, edad: 0 }], px: PX });
  ok("5 nodos (4 saltos + 1)", p.nodos.length === 5, `${p.nodos.length}`);
  ok("4 aristas", p.aristas.length === 4, `${p.aristas.length}`);
  ok("solo UNO caliente", p.nodos.filter((n) => n.caliente).length === 1);
  ok("el caliente esta a 4 saltos", p.nodos.find((n) => n.caliente)?.saltos === 4);
  ok("los calientes se dibujan los ULTIMOS", p.nodos[p.nodos.length - 1].caliente === true);
}

console.log("\n3) HOSTIL EN TU PROPIO SISTEMA");
{
  const p = planoAmenaza({ sistemas, ady, yo: JITA, avisos: [{ sys: JITA, edad: 0 }], px: PX });
  ok("un solo nodo", p.nodos.length === 1);
  ok("es TU y CALIENTE a la vez", p.nodos[0].yo === true && p.nodos[0].caliente === true);
  ok("sin aristas ni NaN", p.aristas.length === 0 && finito(p.nodos[0].px) && finito(p.nodos[0].py));
}

console.log(`\n4) TOPE DE ${TOPE_AVISOS} — entran los mas CERCANOS y se cuenta lo que sobra`);
{
  // 4a) A IGUALDAD DE SALTOS manda el mas fresco.
  const ocho = aNSaltos(JITA, 3).slice(0, 8);
  const avisos = ocho.map((s, i) => ({ sys: s, edad: i / 10, saltos: 3 })); // 0.0 fresco … 0.7 viejo
  const p = planoAmenaza({ sistemas, ady, yo: JITA, avisos, px: PX });
  ok(`solo ${TOPE_AVISOS} calientes`, p.nodos.filter((n) => n.caliente).length === TOPE_AVISOS);
  ok("y dice cuantos quedaron fuera", p.recortados === 3, `recortados=${p.recortados}`);
  const edades = p.nodos.filter((n) => n.caliente).map((n) => n.edad).sort((a, b) => a - b);
  ok("a igualdad de saltos entran los FRESCOS", Math.max(...edades) <= 0.4 + 1e-9, `max edad ${Math.max(...edades)}`);
}
{
  // 4b) EL CASO DE SU CAPTURA: el mas cercano es tambien el mas VIEJO. No puede caerse.
  const cerca = aNSaltos(JITA, 1)[0];
  const lejos = aNSaltos(JITA, 5).slice(0, 6);
  ok("el escenario se pudo montar", cerca !== undefined && lejos.length === 6);
  const avisos = [
    { sys: cerca, edad: 0.95, saltos: 1 },
    ...lejos.map((s) => ({ sys: s, edad: 0.05, saltos: 5 })),
  ];
  const p = planoAmenaza({ sistemas, ady, yo: JITA, avisos, px: PX });
  const calientes = p.nodos.filter((n) => n.caliente);
  ok(`siguen siendo ${TOPE_AVISOS}`, calientes.length === TOPE_AVISOS, `calientes=${calientes.length}`);
  ok("el CERCANO y viejo entra", calientes.some((n) => n.id === cerca));
  ok("y lo que sobra se cuenta", p.recortados === 2, `recortados=${p.recortados}`);
}

console.log("\n5) TODO DENTRO DEL CUADRO Y SIN NaN (3 frentes)");
{
  const a = [aNSaltos(JITA, 2)[0], aNSaltos(JITA, 4)[0], aNSaltos(JITA, 5)[0]];
  const p = planoAmenaza({ sistemas, ady, yo: JITA, avisos: a.map((s, i) => ({ sys: s, edad: i * 0.4 })), px: PX, margen: M });
  ok("ningun NaN", p.nodos.every((n) => finito(n.px) && finito(n.py)));
  const fuera = p.nodos.filter((n) => n.px < M - 0.5 || n.px > PX - M + 0.5 || n.py < M - 0.5 || n.py > PX - M + 0.5);
  ok("nada fuera del margen", fuera.length === 0, fuera.map((n) => n.nombre).join(",") || "ok");
  ok("aristas sin NaN", p.aristas.every((e) => finito(e.ax) && finito(e.ay) && finito(e.bx) && finito(e.by)));
  console.log(`     (${p.nodos.length} nodos, ${p.aristas.length} aristas — legible: el prototipo dio 6)`);
}

console.log("\n6) SISTEMA QUE NO CONECTA POR PUERTAS — no revienta, se cuenta");
{
  // Pochven: sus sistemas no tienen puertas normales hacia k-space.
  const poch = ne.systems.find((s) => s.r === 10000070);
  const p = planoAmenaza({ sistemas, ady, yo: JITA, avisos: [{ sys: poch ? poch.id : 999999, edad: 0 }], px: PX });
  ok("no revienta", Array.isArray(p.nodos));
  ok("lo cuenta como inalcanzable", p.inalcanzables === 1, `inalcanzables=${p.inalcanzables}`);
  ok("y deja tu punto", p.nodos.length === 1 && p.nodos[0].yo);
}

console.log("\n7) CAMINO sin ruta posible devuelve vacio, no cuelga");
ok("[] cuando no hay camino", caminoMasCorto(ady, JITA, 999999).length === 0);

console.log("\n" + "─".repeat(58));
console.log(`${bien} bien · ${mal} mal`);
process.exit(mal ? 1 : 0);
