// Verificacion de la geometria del minimapa, contra el catalogo DE VERDAD (public/neweden.json).
//
// ★ POR QUE EXISTE: `minimapa.ts` es un modulo puro justamente para poder comprobarlo aqui, en
//   node, sin compilar Rust ni abrir una ventana. Una ventana transparente que no pinta no se
//   distingue de una que no existe, asi que todo lo que se pueda cazar antes, se caza antes.
//
// ★ LOS NOMBRES DE SISTEMA QUE SALEN AQUI son los que elige el propio script del catalogo (Jita y
//   su region), nunca de los logs de nadie. Ver scripts/check_privacidad.py.
//
// Uso:  node scripts/verificar_minimapa.mjs
import { readFileSync } from "node:fs";
import { planoRegion, proyectar, caminoMasCorto, TOPE_AVISOS } from "../src/minimapa.ts";

const ne = JSON.parse(readFileSync(new URL("../public/neweden.json", import.meta.url), "utf-8"));
const sistemas = new Map();
for (const s of ne.systems) sistemas.set(s.id, { x: s.x, y: s.y, n: s.n, s: s.s, r: s.r });
const ady = new Map();
for (const [a, b] of ne.jumps) {
  if (!ady.has(a)) ady.set(a, []);
  if (!ady.has(b)) ady.set(b, []);
  ady.get(a).push(b);
  ady.get(b).push(a);
}
const porNombre = new Map([...sistemas].map(([id, s]) => [s.n, id]));
const JITA = porNombre.get("Jita");
const REGION = sistemas.get(JITA).r;
const PX = 250;

let bien = 0, mal = 0;
const ok = (titulo, cond, detalle) => {
  console.log(`  ${cond ? "✓" : "✗"} ${titulo}${detalle !== undefined && !cond ? `  — ${detalle}` : ""}`);
  cond ? bien++ : mal++;
};
/** Sistemas a exactamente n saltos de `desde`. */
function aNSaltos(desde, n) {
  let frente = [desde];
  const visto = new Set([desde]);
  for (let i = 0; i < n; i++) {
    const sig = [];
    for (const u of frente) for (const v of ady.get(u) ?? []) if (!visto.has(v)) { visto.add(v); sig.push(v); }
    frente = sig;
  }
  return frente;
}
const base = { sistemas, ady, region: REGION, px: PX };
const refJita = [{ sys: JITA, nombre: "Jita", tipo: "ancla" }];
const sanos = (p) =>
  [...p.refs, ...p.frentes].every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)) &&
  p.rutas.every((a) => [a.ax, a.ay, a.bx, a.by].every(Number.isFinite)) &&
  Number.isFinite(p.proy.k);

console.log(`\n1) EL MARCO ES LA REGION (${ne.regions.find((r) => r.id === REGION).n}) MAS SU MARGEN`);
{
  const p = planoRegion({ ...base, referencias: refJita, avisos: [] });
  const dela = [...sistemas.values()].filter((s) => s.r === REGION);
  const caja = Math.max(
    Math.max(...dela.map((s) => s.x)) - Math.min(...dela.map((s) => s.x)),
    Math.max(...dela.map((s) => s.y)) - Math.min(...dela.map((s) => s.y)),
  );
  ok("el lado del marco es 1,5x la caja de la region", Math.abs(p.proy.lado - caja * 1.5) < 1,
    `lado=${p.proy.lado} caja=${caja}`);
  const fuera = dela.filter((s) => {
    const [x, y] = proyectar(p.proy, s.x, s.y);
    return x < 0 || x > PX || y < 0 || y > PX;
  });
  ok("a zoom 1 NINGUN sistema de la region se sale del lienzo", fuera.length === 0, `${fuera.length} fuera`);
  ok("y el fondo los trae todos", dela.every((s) => p.fondo.includes([...sistemas].find(([, v]) => v === s)?.[0] ?? -1)) || p.fondo.length >= dela.length,
    `fondo=${p.fondo.length} region=${dela.length}`);
  ok("sin NaN", sanos(p));
}

console.log("\n2) CASOS RAROS DEL MARCO — region de UN sistema y region inexistente");
{
  const unico = ne.regions.map((r) => ({ r, n: [...sistemas.values()].filter((s) => s.r === r.id).length }))
    .filter((x) => x.n === 1)[0];
  ok("existe una region de un solo sistema (si no, el caso no se puede probar)", !!unico,
    "ninguna");
  if (unico) {
    const sid = [...sistemas].find(([, s]) => s.r === unico.r.id)[0];
    const p = planoRegion({ ...base, region: unico.r.id, referencias: [{ sys: sid, nombre: "x", tipo: "ancla" }], avisos: [] });
    ok("no divide por cero: k finito y mayor que cero", Number.isFinite(p.proy.k) && p.proy.k > 0, `k=${p.proy.k}`);
    ok("y coloca su unico sistema sin NaN", sanos(p) && p.refs.length === 1);
  }
  const p2 = planoRegion({ ...base, region: -999, referencias: refJita, avisos: [] });
  ok("region desconocida: se cae a tus referencias en vez de reventar", sanos(p2) && p2.refs.length === 1);
}

console.log("\n3) ZOOM — el tope es el marco entero y de ahi solo se acerca");
{
  const z1 = planoRegion({ ...base, referencias: refJita, avisos: [] });
  const z3 = planoRegion({ ...base, referencias: refJita, avisos: [], zoom: 3 });
  ok("la escala crece igual que el zoom", Math.abs(z3.proy.k - z1.proy.k * 3) < 1e-9);
  const z0 = planoRegion({ ...base, referencias: refJita, avisos: [], zoom: 0.2 });
  ok("alejarse por debajo del marco NO hace nada", Math.abs(z0.proy.k - z1.proy.k) < 1e-9);
  const z9 = planoRegion({ ...base, referencias: refJita, avisos: [], zoom: 99 });
  const z4 = planoRegion({ ...base, referencias: refJita, avisos: [], zoom: 4 });
  ok("y acercar de mas se queda en 4x", Math.abs(z9.proy.k - z4.proy.k) < 1e-9);
  ok("al acercar, el fondo trae MENOS sistemas", z3.fondo.length < z1.fondo.length,
    `z1=${z1.fondo.length} z3=${z3.fondo.length}`);
}

console.log("\n4) DESPLAZAMIENTO — a zoom 1 no se puede, acercando si");
{
  const z1 = planoRegion({ ...base, referencias: refJita, avisos: [], pan: { x: 9999, y: -9999 } });
  ok("a zoom 1 el desplazamiento se queda en CERO pase lo que pase",
    z1.proy.panX === 0 && z1.proy.panY === 0, `pan=${z1.proy.panX},${z1.proy.panY}`);
  const z3 = planoRegion({ ...base, referencias: refJita, avisos: [], zoom: 3, pan: { x: 9999, y: 0 } });
  ok("acercando si hay sitio, y se recorta al borde del marco",
    z3.proy.panX > 0 && Number.isFinite(z3.proy.panX), `panX=${z3.proy.panX}`);
  const z3b = planoRegion({ ...base, referencias: refJita, avisos: [], zoom: 3, pan: { x: 5, y: 5 } });
  ok("un desplazamiento pequeno se respeta tal cual", z3b.proy.panX === 5 && z3b.proy.panY === 5);
}

console.log("\n5) REFERENCIAS — anclas y pilotos, todos, sin elegir uno");
{
  const lejos = [...sistemas].find(([, s]) => s.r !== REGION)[0];
  const refs = [
    { sys: JITA, nombre: "Ancla", tipo: "ancla" },
    { sys: aNSaltos(JITA, 1)[0], nombre: "Piloto", tipo: "piloto" },
    { sys: lejos, nombre: "Lejos", tipo: "piloto" },
  ];
  const p = planoRegion({ ...base, referencias: refs, avisos: [] });
  ok("se dibujan TODAS, no una", p.refs.length === 3, `${p.refs.length}`);
  ok("y conservan su tipo", p.refs.filter((r) => r.tipo === "ancla").length === 1);
  ok("la de otra region queda marcada como fuera", p.refs.find((r) => r.nombre === "Lejos").fuera);
  ok("y la de casa, dentro", !p.refs.find((r) => r.nombre === "Ancla").fuera);
}

console.log(`\n6) FRENTES — tope de ${TOPE_AVISOS}, corte por CERCANIA`);
{
  const cerca = aNSaltos(JITA, 1)[0];
  const lejos = aNSaltos(JITA, 4).slice(0, 6);
  const avisos = [
    { sys: cerca, edad: 0.95, saltos: 1, desde: JITA },          // el mas cercano y el mas VIEJO
    ...lejos.map((s) => ({ sys: s, edad: 0.05, saltos: 4, desde: JITA })),
  ];
  const p = planoRegion({ ...base, referencias: refJita, avisos });
  ok(`entran ${TOPE_AVISOS}`, p.frentes.length === TOPE_AVISOS, `${p.frentes.length}`);
  ok("el CERCANO y viejo entra", p.frentes.some((f) => f.id === cerca));
  ok("y lo que sobra se cuenta", p.recortados === avisos.length - TOPE_AVISOS, `${p.recortados}`);
  ok("los saltos son los de Rust, no recalculados", p.frentes.find((f) => f.id === cerca).saltos === 1);
  const malo = planoRegion({ ...base, referencias: refJita, avisos: [{ sys: 999999, edad: 0, saltos: 2, desde: JITA }] });
  ok("un sistema que no esta en el catalogo se cuenta, no revienta",
    malo.inalcanzables === 1 && malo.frentes.length === 0);
}

console.log("\n7) RUTAS — hasta SU referencia, y sin inventar ninguna");
{
  const destino = aNSaltos(JITA, 3)[0];
  const con = planoRegion({ ...base, referencias: refJita, avisos: [{ sys: destino, edad: 0, saltos: 3, desde: JITA }] });
  ok("con referencia, hay ruta", con.rutas.length === 3, `${con.rutas.length} aristas`);
  const sin = planoRegion({ ...base, referencias: refJita, avisos: [{ sys: destino, edad: 0, saltos: 3, desde: null }] });
  ok("sin referencia, NO se inventa una", sin.rutas.length === 0 && sin.frentes.length === 1);
  ok("sin NaN", sanos(con));
}

console.log("\n8) LA PROYECCION DEVUELTA ES LA MISMA QUE USA EL PLANO");
{
  const destino = aNSaltos(JITA, 2)[0];
  const p = planoRegion({ ...base, referencias: refJita, avisos: [{ sys: destino, edad: 0, saltos: 2, desde: JITA }], zoom: 2, pan: { x: 7, y: -3 } });
  const s = sistemas.get(destino);
  const [x, y] = proyectar(p.proy, s.x, s.y);
  const f = p.frentes[0];
  ok("el dibujante puede colocar cualquier sistema igual que el plano",
    Math.abs(f.x - x) < 1e-9 && Math.abs(f.y - y) < 1e-9);
}

console.log("\n9) CAMINO sin ruta posible devuelve vacio, no cuelga");
ok("[] cuando no hay camino", caminoMasCorto(ady, JITA, 999999).length === 0);

console.log("\n" + "─".repeat(58));
console.log(`${bien} bien · ${mal} mal`);
process.exit(mal ? 1 : 0);
