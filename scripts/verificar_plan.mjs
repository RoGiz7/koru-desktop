/**
 * Comprueba el CÁLCULO del plan de escalaciones (fases 1 y 2): orden, márgenes, imposibles, ir
 * seguro, posponer, lo que vigila el intel y las muertes viejas.
 *
 * Solo lee. Carga `src/plan.ts` TAL CUAL — no tiene una copia del cálculo, o mediría al auditor.
 *
 *   node scripts/verificar_plan.mjs
 *
 * Se lanza SIEMPRE que se toque `plan.ts` (ver las puertas de CLAUDE.md). Los sistemas son de
 * mentira con nombres públicos (Jita, Dodixie, Amarr): las distancias se inyectan, así que el
 * resultado no depende del mapa.
 *
 * ⚠️ Nació en un directorio temporal de sesión y los mensajes de commit de las fases 1 y 2 lo
 *    citaban como «un guion aparte». Entró al repo el 26-11 con las mismas comprobaciones que tenía
 *    (11 de la fase 1 y 18 de la fase 2): si un día salen otras cuentas sin que nadie haya añadido
 *    ni quitado ninguna, algo se perdió.
 */
import { proponer, evaluar, cacheTramos, posponer, muertesTramo, bajaNula, cuestaIrSeguro, mejor, tramosEmpezados, muertesViejas } from "../src/plan.ts";

let fallos = 0;
let cuenta = 0;
const ok = (c, m) => {
  cuenta++;
  if (!c) {
    fallos++;
    console.log("  ✗", m);
  } else console.log("  ✓", m);
};

console.log("Fase 1 — el orden y los márgenes");
{
  // Puntos: 0 = origen (1), A=2, B=3, C=4. Distancias en saltos (simétricas).
  const D = { "1-2": 10, "1-3": 30, "1-4": 5, "2-3": 25, "2-4": 12, "3-4": 28 };
  const d = (a, b) => (a === b ? 0 : D[`${Math.min(a, b)}-${Math.max(a, b)}`]);
  const calc = (a, b) => (d(a, b) == null ? null : { saltos: d(a, b), path: [a, b], wormhole: false });
  const ahora = 0, H = 3600e3;
  // minPorSalto=1, sitio=45. A caduca en 2 h, B en 1 h (B está a 30 saltos: llegas justo si vas directo),
  // C en 10 h.
  const paradas = [
    { stopId: 11, systemId: 2, caducaMs: 2 * H },
    { stopId: 12, systemId: 3, caducaMs: 1 * H },
    { stopId: 13, systemId: 4, caducaMs: 10 * H },
  ];
  const t = cacheTramos([1, 2, 3, 4], calc);
  const p = proponer(paradas, t, ahora, 1, 45);
  console.log("propuesto:", p.mejor.orden.map((i) => paradas[i].stopId), "salva", p.mejor.salvadas, "recorrido", p.mejor.recorridoMin,
    p.mejor.resultados.map((r) => `${r.stopId}:${r.estado}:${Math.round(r.margenMin)}`));
  ok(p.metodo === "optimo", "con 3 paradas, método óptimo");
  ok(p.mejor.salvadas === 3, "el propuesto salva las 3");
  // Fuerza bruta independiente para comprobar que es el óptimo de verdad.
  const perms = (a) => a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((r) => [x, ...r]));
  let best = null;
  for (const o of perms([0, 1, 2])) {
    const e = evaluar(o, paradas, t, ahora, 1, 45);
    if (!best || e.salvadas > best.salvadas || (e.salvadas === best.salvadas && e.recorridoMin < best.recorridoMin)) best = e;
  }
  ok(best.salvadas === p.mejor.salvadas && best.recorridoMin === p.mejor.recorridoMin, "coincide con la fuerza bruta");
  // Arrastrar C al primer puesto: márgenes recalculados.
  const m = evaluar([2, 0, 1], paradas, t, ahora, 1, 45);
  console.log("manual C,A,B:", m.resultados.map((r) => `${r.stopId}:${r.estado}:${Math.round(r.margenMin)}`), "salva", m.salvadas);
  ok(m.salvadas < p.mejor.salvadas, "el orden manual salva menos y el propuesto lo sigue diciendo");
  // Imposible: D caduca en 20 min y está a 30 saltos del origen.
  const p2 = [...paradas.slice(0, 2), { stopId: 14, systemId: 3, caducaMs: 20 * 60e3 }];
  const e2 = proponer(p2, cacheTramos([1, 2, 3, 3], calc), ahora, 1, 45);
  ok(e2.mejor.imposibles.some((r) => r.stopId === 14) && !e2.mejor.resultados.some((r) => r.stopId === 14),
    "la que no llega ni yendo directo sale del recorrido y va aparte");
  // Y no gasta viaje: el recorrido es el mismo que sin ella.
  const sin14 = proponer(p2.slice(0, 2), cacheTramos([1, 2, 3], calc), ahora, 1, 45);
  ok(e2.mejor.recorridoMin === sin14.mejor.recorridoMin, "la imposible no gasta minutos de viaje");
  // Sin ruta: no mueve el punto de partida.
  const calc2 = (a, b) => (a === 3 || b === 3 ? null : calc(a, b));
  const e3 = evaluar([1, 0], paradas, cacheTramos([1, 2, 3, 4], calc2), ahora, 1, 45);
  ok(e3.resultados[0].estado === "sin_ruta" && e3.resultados[1].saltos === 10, "sin ruta: el siguiente tramo sale del origen");
  // Perdida con este orden: se queda en el recorrido con su "llegas X tarde". B (1 h, 30 saltos) se
  // salva sola, pero yendo detrás de A no: ni es imposible ni desaparece.
  const e7 = evaluar([0, 1], paradas, t, ahora, 1, 45);
  const rB = e7.resultados.find((r) => r.stopId === 12);
  ok(rB && rB.estado === "perdida" && rB.margenMin < 0 && e7.imposibles.length === 0, "perdida con este orden: se queda, con su retraso");
  // Perdida con este orden no suma tiempo en el sitio: A (10 saltos, salvada, +45) → B (25, perdida,
  // SIN +45) → C (28). Llegada a C = 10 + 45 + 25 + 28 = 108 min. Con el +45 en B serían 153.
  const e4 = evaluar([0, 1, 2], paradas, t, ahora, 1, 45);
  ok(e4.resultados[1].estado === "perdida" && Math.round(e4.resultados[2].llegadaMs / 60e3) === 108, "una perdida con este orden no suma los 45 min del sitio");
  // Más de 8: por caducidad.
  const muchas = Array.from({ length: 9 }, (_, i) => ({ stopId: 100 + i, systemId: 2, caducaMs: (9 - i) * H }));
  const e5 = proponer(muchas, cacheTramos([1, ...muchas.map(() => 2)], calc), ahora, 1, 45);
  ok(e5.metodo === "caducidad" && muchas[e5.mejor.orden[0]].stopId === 108, "con 9, por caducidad y lo dice");
  // 8 paradas: el tiempo de la búsqueda exhaustiva.
  const ocho = Array.from({ length: 8 }, (_, i) => ({ stopId: 200 + i, systemId: 2 + (i % 3), caducaMs: (2 + i) * H }));
  const t0 = performance.now();
  const e6 = proponer(ocho, cacheTramos([1, ...ocho.map((p) => p.systemId)], calc), ahora, 1, 45);
  console.log("8 paradas:", Math.round(performance.now() - t0), "ms, método", e6.metodo);
  ok(e6.metodo === "optimo", "con 8, todavía óptimo");
}
const fase1 = cuenta;

console.log("Fase 2 — el riesgo del camino");
{
  const H = 3600e3, ahora = 0;

  // ---- muertes de un tramo: dato, con «sin datos» distinto de «limpio» ----
  const k = new Map([[2, 5], [4, 18], [1, 99]]);
  const mk = muertesTramo([1, 2, 3, 4], k);
  ok(mk.sistemas === 2 && mk.peor.systemId === 4 && mk.peor.kills === 18, "2 sistemas con muertes, el peor el de 18");
  ok(muertesTramo([1, 3], k).sistemas === 0, "la salida no cuenta (el 99 es donde ya estás)");
  ok(muertesTramo([1, 2], null) === null, "sin datos de muertes = null, no «limpio»");

  // ---- baja/nula ----
  const sec = new Map([[1, 0.9], [2, 0.3], [3, -0.2], [4, 0.5]]);
  ok(bajaNula([1, 2, 3, 4], (s) => sec.get(s)) === 2, "cruza 2 de baja/nula, sin contar la salida");

  // ---- el path viaja en el resultado ----
  // La vara de medir con sistemas públicos: 1 = Jita (origen), 2 = Dodixie (1 h), 3 = Amarr (3 h).
  // Corta: J-D 12, J-A 11, D-A 14. Segura: cada tramo +4 saltos (la ruta «da la vuelta»).
  const corto = { "1-2": 12, "1-3": 11, "2-3": 14 };
  const key = (a, b) => `${Math.min(a, b)}-${Math.max(a, b)}`;
  const mkCalc = (extra) => (a, b) => (a === b ? { saltos: 0, path: [a], wormhole: false }
    : { saltos: corto[key(a, b)] + extra, path: [a, ...Array(corto[key(a, b)] + extra - 1).fill(9), b], wormhole: false });
  const paradas = [
    { stopId: 21, systemId: 2, caducaMs: 1 * H },
    { stopId: 22, systemId: 3, caducaMs: 3 * H },
  ];
  const pts = [1, 2, 3];
  const tc = cacheTramos(pts, mkCalc(0));
  // Minutos por salto 4: Dodixie por la corta = 48 min (12 m de sobra); por la segura = 64 (tarde).
  const corta = evaluar([0, 1], paradas, tc, ahora, 4, 45);
  ok(corta.resultados[0].path.length === 13, "el resultado lleva los sistemas de su tramo");
  ok(corta.salvadas === 2, "por la corta se salvan las dos");
  const ts = cacheTramos(pts, mkCalc(4));
  const segura = evaluar([0, 1], paradas, ts, ahora, 4, 45);
  console.log("corta:", corta.resultados.map((r) => `${r.stopId}:${r.estado}:${Math.round(r.margenMin)}`),
    "segura:", segura.resultados.map((r) => `${r.stopId}:${r.estado}:${Math.round(r.margenMin)}`), segura.imposibles);
  const cuesta = cuestaIrSeguro(corta, segura);
  ok(cuesta.length === 1 && cuesta[0] === 21, "ir seguro te cuesta Dodixie");
  ok(cuestaIrSeguro(corta, corta).length === 0, "misma ruta: no cuesta nada");

  // ---- posponer: el mejor orden con esa parada MÁS TARDE, contra una fuerza bruta aparte ----
  const P = [
    { stopId: 11, systemId: 2, caducaMs: 2 * H },
    { stopId: 12, systemId: 3, caducaMs: 1 * H },
    { stopId: 13, systemId: 4, caducaMs: 10 * H },
  ];
  const D = { "1-2": 10, "1-3": 30, "1-4": 5, "2-3": 25, "2-4": 12, "3-4": 28 };
  const calc = (a, b) => (a === b ? { saltos: 0, path: [a], wormhole: false } : { saltos: D[key(a, b)], path: [a, b], wormhole: false });
  const t = cacheTramos([1, 2, 3, 4], calc);
  const prop = proponer(P, t, ahora, 1, 45).mejor;
  const primero = prop.orden[0];
  const pos = posponer(prop.orden, primero, P, t, ahora, 1, 45);
  ok(pos && pos.orden.indexOf(primero) > 0, "posponer: la parada ya no va primera");
  const perms = (a) => a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((r) => [x, ...r]));
  let best = null;
  for (const o of perms(prop.orden)) {
    if (o.indexOf(primero) <= 0) continue;
    const e = evaluar(o, P, t, ahora, 1, 45);
    if (!best || mejor(e, best)) best = e;
  }
  ok(best.salvadas === pos.salvadas && best.recorridoMin === pos.recorridoMin, "posponer coincide con la fuerza bruta restringida");
  ok(posponer(prop.orden, prop.orden[prop.orden.length - 1], P, t, ahora, 1, 45) === null, "la última no se puede posponer");
  console.log("propuesto", prop.orden.map((i) => P[i].stopId), "salva", prop.salvadas, "· posponiendo", P[primero].stopId, "→",
    pos.orden.map((i) => P[i].stopId), "salva", pos.salvadas);

  // ---- con el plan CERRADO: se vigila el camino de las paradas empezadas ----
  const emp = [
    { stop_id: 31, system_id: 2, system_name: "Dodixie", caduca_at: new Date(10 * H).toISOString() },
    { stop_id: 32, system_id: 3, system_name: "Amarr", caduca_at: new Date(-1).toISOString() },
  ];
  const nom = (s) => ({ 1: "Jita", 2: "Dodixie", 3: "Amarr" })[s] ?? "";
  const te = tramosEmpezados(emp, 1, mkCalc(0), nom, ahora);
  ok(te.length === 1 && te[0].stop_id === 31, "la caducada sale del camino aunque la run siga abierta");
  ok(te[0].empezado && te[0].destino === "Dodixie" && te[0].sistemas[0] === 1 && te[0].sistemas.at(-1) === 2,
    "desde donde estás hasta la parada, y suena");
  const sinAqui = tramosEmpezados(emp, null, mkCalc(0), nom, ahora);
  ok(sinAqui.length === 1 && sinAqui[0].sistemas.join() === "2", "sin ubicación: se queda el destino, no se apaga");
  const sinRuta = tramosEmpezados(emp, 1, () => null, nom, ahora);
  ok(sinRuta.length === 1 && sinRuta[0].sistemas.join() === "2", "sin ruta: se queda el destino, no se apaga");

  // ---- muertes viejas: la frase no puede seguir diciendo «en la última hora» ----
  ok(muertesViejas(ahora - 10 * 60000, ahora) === null, "dato de hace 10 min: vale «en la última hora»");
  ok(muertesViejas(ahora - 6 * H, ahora) === 360, "dato de hace 6 h: viejo, y dice cuánto");
  ok(muertesViejas(null, ahora) === null, "sin dato: lo dice «sin datos», no esta");
}
const fase2 = cuenta - fase1;

console.log(`\n${cuenta - fallos}/${cuenta} bien (fase 1: ${fase1}, fase 2: ${fase2})`);
process.exit(fallos ? 1 : 0);
