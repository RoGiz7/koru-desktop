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
import { saltoFatiga, destinoSaltable } from "../src/jumpCalc.ts";
import { llega, formaPuertas, formaSalto, fatigaInicial, separarImposibles } from "../src/plan.ts";
import { buscarIntermedio, buscarIntermedioYa, contextoIntermedio, probarIntermedio, LOTE_INTERMEDIO } from "../src/plan.ts";
import { cacheSalto, resumenMarcas, ordenarMarcas, avisoComun } from "../src/plan.ts";
import { dondeEsta, sistemaDe, skillsDeSalto, SCOPE_UBICACION, resumenTiempo, puertasCyno } from "../src/plan.ts";
import { PREFIJO_FALTA_PERMISO } from "../src/errores.ts";
import { duracionCyno, tipoCynoPorDefecto, proponerNave, avisoNave, candidatosPapeles } from "../src/plan.ts";
import { readFileSync } from "node:fs";

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

console.log("Salto — cooldown y fatiga de UN salto (saltoFatiga)");
{
  // 🚨 Las filas «publicada» están calculadas A MANO con la fórmula publicada, no medidas en el
  //    juego. Cuando llegue un salto real (años luz y los dos timers), entra como una fila más con
  //    `fuente: "salto real"`, y si no cuadra, la que está mal es la fórmula.
  const FILAS = [
    // nave, fatMult, al, fatiga antes, cooldown, fatiga después
    { nave: "Carrier", fatMult: 1, ly: 7, antes: 0, cd: 8, despues: 80, fuente: "publicada" },
    { nave: "Carrier", fatMult: 1, ly: 7, antes: 80, cd: 8, despues: 300, fuente: "publicada" },
    { nave: "Black Ops", fatMult: 0.25, ly: 8, antes: 0, cd: 3, despues: 30, fuente: "publicada" },
    { nave: "Black Ops", fatMult: 0.25, ly: 8, antes: 30, cd: 3, despues: 90, fuente: "publicada" },
    { nave: "Black Ops", fatMult: 0.25, ly: 8, antes: 90, cd: 9, despues: 270, fuente: "publicada" },
    { nave: "Black Ops", fatMult: 0.25, ly: 8, antes: 270, cd: 27, despues: 300, fuente: "publicada" },
    { nave: "Black Ops", fatMult: 0.25, ly: 8, antes: 300, cd: 30, despues: 300, fuente: "publicada" },
    { nave: "Jump Freighter", fatMult: 0.1, ly: 10, antes: 0, cd: 2, despues: 20, fuente: "publicada" },
  ];
  const cerca = (a, b) => Math.abs(a - b) < 1e-9;
  for (const f of FILAS) {
    const r = saltoFatiga(f.ly, f.fatMult, f.antes);
    ok(cerca(r.cooldown, f.cd) && cerca(r.fatiga, f.despues),
      `${f.nave}, ${f.ly} al con ${f.antes} de fatiga → cooldown ${f.cd}, fatiga ${f.despues} (${f.fuente}; sale ${r.cooldown}/${r.fatiga})`);
  }
}
const salto = cuenta - fase1 - fase2;

console.log("Fase 3a — la forma de viajar y los dos relojes");
{
  const H = 3600e3, M = 60e3, ahora = 0;
  const key = (a, b) => `${Math.min(a, b)}-${Math.max(a, b)}`;
  const casi = (a, b) => Math.abs(a - b) < 1e-6;

  // ---- el predicado único, estado por estado ----
  const LLEGA = { salvada: true, perdida: true, sin_ruta: false, fuera_alcance: false, alta_sec: false, cyno_sin_ruta: false };
  for (const [e, v] of Object.entries(LLEGA)) ok(llega(e) === v, `llega("${e}") = ${v}`);

  // ---- regresión: «a puertas» explícita = sin forma, número a número ----
  const D = { "1-2": 10, "1-3": 30, "1-4": 5, "2-3": 25, "2-4": 12, "3-4": 28 };
  const calc = (a, b) => (a === b ? { saltos: 0, path: [a], wormhole: false } : { saltos: D[key(a, b)], path: [a, b], wormhole: false });
  const P = [
    { stopId: 11, systemId: 2, caducaMs: 2 * H },
    { stopId: 12, systemId: 3, caducaMs: 1 * H },
    { stopId: 13, systemId: 4, caducaMs: 10 * H },
  ];
  const t = cacheTramos([1, 2, 3, 4], calc);
  const sin = proponer(P, t, ahora, 1, 45);
  const con = proponer(P, t, ahora, 1, 45, formaPuertas(t, 1));
  ok(JSON.stringify(sin) === JSON.stringify(con), "ficha «a puertas» con los mismos minutos: idéntico a sin ficha");

  // ---- la receta de la fase 1, saltando: Jita; Amarr, Dodixie y Rens; una Black Ops ----
  // Los cuatro son alta seguridad (sec públicas): ahí no se salta.
  const JITA = 30000142, AMARR = 30002187, DODIXIE = 30002659, RENS = 30002510;
  const sec = { [JITA]: 0.95, [AMARR]: 1.0, [DODIXIE]: 0.87, [RENS]: 0.9 };
  const blops = { fatMult: 0.25, fuelPerLy: 700, isotope: "Helium Isotopes" };
  const params = (puntos, extra) => ({
    puntos, ly: () => 3, saltable: (s) => destinoSaltable(sec[s] ?? -1, 0), rutaCyno: (a, b) => ({ saltos: 5, path: [a, b], wormhole: false }),
    cynoDesde: puntos[0], alcanceLy: 8, casco: blops, jfc: 5, cicloCynoMin: 1, cynoMinPorSalto: 1,
    fatigaMin: 0, cooldownHastaMs: ahora, ahoraMs: ahora, ...extra,
  });
  const receta = [
    { stopId: 1, systemId: AMARR, caducaMs: 3 * H },
    { stopId: 2, systemId: DODIXIE, caducaMs: 1 * H },
    { stopId: 3, systemId: RENS, caducaMs: 9 * 60e3 },
  ];
  const fr = formaSalto(params([JITA, AMARR, DODIXIE, RENS]));
  const er = proponer(receta, cacheTramos([JITA, AMARR, DODIXIE, RENS], calc), ahora, 1, 45, fr).mejor;
  ok(er.resultados.length === 3 && er.resultados.every((r) => r.estado === "alta_sec") && er.imposibles.length === 0,
    "receta en alta seguridad: las tres «a alta seguridad no se salta», ninguna perdida ni imposible");

  // ---- los dos relojes, con distancias inyectadas ----
  // Black Ops alcance 8, fatMult 0,25. Cyno: ciclo 1 min, 1 min por salto. 45 min en cada sitio.
  // O = 1, A = 2, B = 3. A a 6 al y 10 saltos de O; B a 8 al y 60 saltos de A.
  const LY = { "1-2": 6, "2-3": 8, "1-3": 7 };
  const SALTOS = { "1-2": 10, "2-3": 60, "1-3": 70 };
  const p2 = (extra) => params([1, 2, 3], {
    ly: (a, b) => LY[key(a, b)], saltable: () => true,
    rutaCyno: (a, b) => ({ saltos: SALTOS[key(a, b)], path: [a, ...Array(SALTOS[key(a, b)] - 1).fill(99), b], wormhole: false }),
    ...extra,
  });
  const AB = [
    { stopId: 21, systemId: 2, caducaMs: 10 * H },
    { stopId: 22, systemId: 3, caducaMs: 10 * H },
  ];
  const tr2 = cacheTramos([1, 2, 3], calc);
  const ev = evaluar([0, 1], AB, tr2, ahora, 1, 45, formaSalto(p2({})));
  const [rA, rB] = ev.resultados;
  const sA = rA.salto?.saltos[0], sB = rB.salto?.saltos[0];
  console.log("  O→A:", rA.llegadaMs / M, rA.salto?.saltos[0]?.espera, sA?.cooldownMin, sA?.fatigaMin, "· A→B:", rB.llegadaMs / M, rB.salto?.saltos[0]?.espera, sB?.cooldownMin, sB?.fatigaMin);
  ok(casi(rA.llegadaMs, 10 * M) && rA.salto.saltos[0].espera?.quien === "cyno" && casi(rA.salto.saltos[0].espera.min, 10),
    "O → A sale en t = 10: manda el cyno (10 saltos, sin ciclo pendiente)");
  ok(casi(sA.cooldownMin, 2.5) && casi(sA.fatigaMin, 25), "O → A: cooldown 2,5 y fatiga 25");
  ok(casi(rB.llegadaMs, 71 * M) && rB.salto.saltos[0].espera?.quien === "cyno" && casi(rB.salto.saltos[0].espera.min, 16),
    "A → B sale en t = 71: el cyno, libre en 11, más 60 saltos; el sitio acabó en 55 → esperas 16 m");
  ok(casi(sB.cooldownMin, 3) && casi(sB.fatigaMin, 30), "A → B: cooldown 3 y fatiga 30");
  ok(rA.path.length === 11 && rB.path[0] === 2 && rB.path.at(-1) === 3, "el camino de una pata de salto es la ruta a puertas del CYNO");
  ok(casi(ev.recorridoMin, 10 + 16), "el recorrido es el reloj entre paradas, esperas incluidas, sin los sitios");

  // El caso en que manda el cooldown: A sin tiempo en el sitio, B a 1 salto de A. Se prueba en la
  // PATA, desde el estado tras A: por `evaluar`, una A ya caducada al llegar yendo directo es una
  // IMPOSIBLE y sale del recorrido (lo comprueba la siguiente), así que no puede ser la del medio.
  const f3 = formaSalto(p2({ rutaCyno: (a, b) => ({ saltos: key(a, b) === "2-3" ? 1 : SALTOS[key(a, b)], path: [a, b], wormhole: false }) }));
  const tras = f3.pata(f3.inicial, 0, 1, 0);
  const pb = f3.pata(tras.despues, 1, 2, 10 * M);
  console.log("  cooldown:", pb.llega && pb.viajeMin, pb.llega && pb.salto.saltos[0].espera, pb.llega && pb.salto.saltos[0].cooldownMin, pb.llega && pb.salto.saltos[0].fatigaMin);
  ok(pb.llega && pb.salto.saltos[0].espera?.quien === "cooldown" && casi(pb.salto.saltos[0].espera.min, 2.5) && casi(pb.salto.saltos[0].salidaMs, 12.5 * M),
    "cyno en B en t = 12, cooldown hasta 12,5: saltas en 12,5, esperas 2,5 m de cooldown");
  ok(pb.llega && casi(pb.salto.saltos[0].cooldownMin, 3) && casi(pb.salto.saltos[0].fatigaMin, 67.5),
    "llegas con 22,5 de fatiga: cooldown 3, fatiga 67,5");
  const caducada = [{ stopId: 21, systemId: 2, caducaMs: 5 * M }, AB[1]];
  ok(separarImposibles(caducada, tr2, ahora, 1, f3).has(0), "A caducada antes de t = 10 yendo directo: imposible, fuera del recorrido");

  // ---- los motivos nuevos: no llega, no se pierde, no mueve la partida ----
  const lejos = formaSalto(p2({ ly: (a, b) => (key(a, b) === "1-2" ? 11.2 : LY[key(a, b)]) }));
  const el = evaluar([0, 1], AB, tr2, ahora, 1, 45, lejos);
  ok(el.resultados[0].estado === "fuera_alcance" && casi(el.resultados[0].noLlega.ly, 11.2) && el.resultados[0].noLlega.alcance === 8,
    "fuera de alcance, con los dos números: 11,2 al y llegas a 8");
  ok(el.imposibles.length === 0 && el.resultados[1].salto.saltos[0].desde === 1,
    "fuera de alcance no es imposible, y la siguiente sale del origen (no mueve la partida)");
  const sinCyno = formaSalto(p2({ rutaCyno: () => null }));
  ok(evaluar([0], AB, tr2, ahora, 1, 45, sinCyno).resultados[0].estado === "cyno_sin_ruta", "el cyno sin ruta a puertas: se dice que es él");

  // ---- el estado inicial: el timer rojo es una COTA ----
  const iso = (ms) => new Date(ms).toISOString();
  const fi0 = fatigaInicial(null, null, ahora);
  ok(fi0.fatigaMin === 0 && fi0.cooldownHastaMs === ahora && !fi0.cotaRoja, "sin datos de fatiga: cero (la pantalla dice por qué)");
  const fi1 = fatigaInicial(iso(60 * M), iso(-2 * M), ahora);
  ok(casi(fi1.fatigaMin, 60) && casi(fi1.cooldownHastaMs, 4.2 * M) && fi1.cotaRoja,
    "saltó hace 2 min con 62 de azul: puede saltar como muy tarde en 6,2 min tras el salto (cota)");
  const fi2 = fatigaInicial(iso(60 * M), iso(-10 * M), ahora);
  ok(fi2.cooldownHastaMs === ahora && !fi2.cotaRoja, "si la cota ya pasó, nada que esperar");

  // ---- la costura con la fase 2: saltando, el camino vigilado es el del CYNO ----
  const empSalto = [{ stop_id: 41, system_id: 3, system_name: "Amarr", caduca_at: new Date(10 * H).toISOString(), salto: true, cyno_character_id: 8 }];
  const nom3 = (s) => ({ 1: "Jita", 2: "Dodixie", 3: "Amarr" })[s] ?? "";
  const viaCalc = (a, b) => ({ saltos: 1, path: [a, b], wormhole: false });
  const conCyno = tramosEmpezados(empSalto, 1, viaCalc, nom3, ahora, () => ({ desde: 2, quien: "Cyno Alt" }));
  ok(conCyno[0].sistemas[0] === 2 && conCyno[0].quien === "Cyno Alt", "saltando: el tramo empezado sale de donde está el cyno, y dice de quién es");
  const sinSaber = tramosEmpezados(empSalto, 1, viaCalc, nom3, ahora, () => ({ desde: null, quien: "Cyno Alt" }));
  ok(sinSaber[0].sistemas[0] === 1, "sin saber dónde está el cyno: se supone que sale de donde estás tú");
  ok(tramosEmpezados(empSalto, 1, viaCalc, nom3, ahora)[0].quien === undefined, "sin el sexto argumento, como en la fase 2: tu camino");

  // ---- lo que tarda la fuerza bruta con 8 paradas, saltando ----
  const pts = [1, ...Array.from({ length: 8 }, (_, i) => 100 + i)];
  const ocho = pts.slice(1).map((s, i) => ({ stopId: 300 + i, systemId: s, caducaMs: (3 + i) * H }));
  const f8 = formaSalto(params(pts, { ly: (a, b) => 1 + ((a * 7 + b * 13) % 6), saltable: () => true,
    rutaCyno: (a, b) => ({ saltos: 1 + ((a + b) % 9), path: [a, b], wormhole: false }) }));
  const t0 = performance.now();
  const e8 = proponer(ocho, cacheTramos(pts, calc), ahora, 1, 45, f8);
  console.log(`  8 paradas saltando: ${Math.round(performance.now() - t0)} ms, método ${e8.metodo}`);
  ok(e8.metodo === "optimo", "con 8 paradas saltando, todavía óptimo");
}
const fase3 = cuenta - fase1 - fase2 - salto;

console.log("Fase 3b — el salto intermedio");
{
  const M = 60e3, H = 3600e3, ahora = 0;
  const key = (a, b) => `${Math.min(a, b)}-${Math.max(a, b)}`;
  const casi = (a, b) => Math.abs(a - b) < 1e-6;
  // La tabla del brief. O = 1, B = 3; M1..M4 = 11..14; C = 5. 99 = un saltable SIN NINGUNA puerta,
  // a tiro de los dos lados: no tiene que llegar nunca al buscador de rutas.
  // Black Ops: alcance 8, fatMult 0,25. Cyno: ciclo 1 min, 1 min por salto. Sin fatiga, los dos en O.
  const LYB = { "1-3": 12, "1-11": 6, "3-11": 7, "1-12": 7.5, "3-12": 5, "1-13": 9, "3-13": 4, "1-14": 6, "3-14": 6, "1-99": 5, "3-99": 7 };
  const PUERTAS = { "1-11": 5, "3-11": 20, "1-12": 30, "3-12": 3, "1-13": 2, "3-13": 2, "1-14": 1, "3-14": 1, "1-3": 40 };
  const ALTA = new Set([14]);
  const SISTEMAS = [1, 3, 11, 12, 13, 14, 99];
  const blops = { fatMult: 0.25, fuelPerLy: 700, isotope: "Helium Isotopes" };
  const mk = ({ ly = {}, puertas = {}, vias, puntos = [1, 3], preguntas } = {}) => {
    const L = { ...LYB, ...ly }, P = { ...PUERTAS, ...puertas };
    return {
      puntos,
      ly: (a, b) => (a === b ? 0 : L[key(a, b)] ?? 50),
      saltable: (s) => !ALTA.has(s),
      rutaCyno: (a, b) => {
        preguntas?.push(a, b);
        const n = P[key(a, b)];
        return n == null ? null : { saltos: n, path: [a, ...Array(n - 1).fill(98), b], wormhole: false };
      },
      cynoDesde: 1, alcanceLy: 8, casco: blops, jfc: 5, cicloCynoMin: 1, cynoMinPorSalto: 1,
      fatigaMin: 0, cooldownHastaMs: ahora, ahoraMs: ahora, ...(vias ? { vias } : {}),
    };
  };
  const conectado = (s) => s !== 99;
  const busca = (p, desde = 1, cyno = 1, dst = 3) => buscarIntermedioYa(contextoIntermedio(p), SISTEMAS, conectado, desde, cyno, dst);
  const calc = (a, b) => ({ saltos: 1, path: [a, b], wormhole: false });
  const soloB = [{ stopId: 31, systemId: 3, caducaMs: 10 * H }];
  const trB = cacheTramos([1, 3], calc);

  // ---- la propuesta ----
  const preguntas = [];
  const b1 = busca(mk({ preguntas }));
  console.log("  propuesta:", b1.tipo, b1.via, b1.candidatos, b1.validos);
  ok(b1.tipo === "propuesta" && b1.via === 11, "se propone M1: 25 puertas contra las 33 de M2");
  ok(b1.candidatos === 2 && b1.validos === 2, "candidatos M1 y M2: M3 queda a 9 al de O y M4 es alta seguridad");
  ok(!preguntas.includes(99) && !preguntas.includes(13) && !preguntas.includes(14),
    "al buscador de rutas no llegan ni el sistema sin puertas, ni el fuera de alcance, ni el de alta");
  ok(JSON.stringify(busca(mk())) === JSON.stringify(b1), "con los mismos datos, la misma propuesta");
  // Desempates: mismas puertas → menos años luz; mismos años luz → id más bajo.
  const eq = busca(mk({ puertas: { "1-12": 5, "3-12": 20 } }));
  ok(eq.tipo === "propuesta" && eq.via === 12, "a igualdad de puertas (25 y 25), gana el de menos años luz: M2, 12,5 contra 13");
  const eq2 = busca(mk({ puertas: { "1-12": 5, "3-12": 20 }, ly: { "1-12": 6, "3-12": 7 } }));
  ok(eq2.tipo === "propuesta" && eq2.via === 11, "a igualdad de puertas y de años luz, el de id más bajo: M1");

  // ---- «Otro…»: la misma función, con el motivo y su número ----
  const cx = contextoIntermedio(mk());
  const o13 = probarIntermedio(cx, 1, 1, 13, 3);
  ok(!o13.ok && o13.fallo.motivo === "lejos_ida" && casi(o13.fallo.ly, 9) && o13.fallo.alcance === 8, "«Otro…» M3: 9 al desde O, y llegas a 8");
  const o14 = probarIntermedio(cx, 1, 1, 14, 3);
  ok(!o14.ok && o14.fallo.motivo === "alta_sec", "«Otro…» M4: a alta seguridad no se salta");
  const o12 = probarIntermedio(cx, 1, 1, 12, 3);
  ok(o12.ok && o12.via === 12, "«Otro…» M2: sirve, aunque no sea el propuesto");

  // ---- con M1 aceptado: los dos saltos, cada uno con su espera ----
  const e1 = evaluar([0], soloB, trB, ahora, 1, 45, formaSalto(mk({ vias: [null, 11] })));
  const r1 = e1.resultados[0];
  const [j1, j2] = r1.salto?.saltos ?? [];
  console.log("  O→M1:", j1?.salidaMs / M, j1?.espera, j1?.cooldownMin, j1?.fatigaMin, "· M1→B:", j2?.salidaMs / M, j2?.espera, j2?.cooldownMin, j2?.fatigaMin);
  ok(r1.estado === "salvada" && r1.salto.saltos.length === 2 && r1.salto.via === 11, "con M1 aceptado, B se alcanza en dos saltos");
  ok(j1.desde === 1 && j1.hasta === 11 && casi(j1.salidaMs, 5 * M) && j1.espera?.quien === "cyno" && casi(j1.espera.min, 5) && j1.espera.en === 1,
    "O → M1 sale en t = 5: 5 m en O, el cyno");
  ok(casi(j1.cooldownMin, 2.5) && casi(j1.fatigaMin, 25), "O → M1: cooldown 2,5 y fatiga 25");
  ok(j2.desde === 11 && j2.hasta === 3 && casi(j2.salidaMs, 26 * M) && j2.espera?.quien === "cyno" && casi(j2.espera.min, 21) && j2.espera.en === 11,
    "M1 → B sale en t = 26: esperas 21 m EN M1 al cyno (libre en 6, más 20 puertas)");
  ok(casi(j2.cooldownMin, 2.75) && casi(j2.fatigaMin, 27.5), "M1 → B: cooldown 2,75 y fatiga 27,5");
  ok(casi(r1.llegadaMs, 26 * M) && casi(e1.recorridoMin, 26), "llegas a B en t = 26: en el intermedio no hay sitio");
  ok(r1.path.length === 26 && r1.path[0] === 1 && r1.path[5] === 11 && r1.path.at(-1) === 3 && r1.saltos === 25 && r1.salto.cynoSaltos === 25,
    "el camino es la ruta del cyno ENTERA: O → M1 → B, 25 puertas");
  // Manda el cooldown en el intermedio: de M1 a B hay 1 puerta.
  const ec = evaluar([0], soloB, trB, ahora, 1, 45, formaSalto(mk({ vias: [null, 11], puertas: { "3-11": 1 } })));
  const k2 = ec.resultados[0].salto.saltos[1];
  console.log("  cooldown en M1:", k2.salidaMs / M, k2.espera, k2.cooldownMin, k2.fatigaMin);
  ok(casi(k2.salidaMs, 7.5 * M) && k2.espera?.quien === "cooldown" && casi(k2.espera.min, 2.5) && k2.espera.en === 11,
    "cyno en B en t = 7, cooldown hasta 7,5: saltas en 7,5 y esperas 2,5 m de cooldown en M1");
  ok(casi(k2.cooldownMin, 2.75) && casi(k2.fatigaMin, 61.875), "llegas con 22,5 de fatiga: cooldown 2,75, fatiga 61,875");

  // ---- sin aceptar ----
  const e0 = evaluar([0], soloB, trB, ahora, 1, 45, formaSalto(mk()));
  ok(e0.resultados[0].estado === "fuera_alcance" && !llega(e0.resultados[0].estado) && e0.salvadas === 0,
    "sin aceptar: «fuera de alcance», no cuenta como alcanzada y llega() da falso");
  ok(e0.resultados[0].noLlega.desde === 1 && e0.resultados[0].noLlega.cyno === 1 && !e0.resultados[0].noLlega.viaNoSirve,
    "y dice desde dónde se buscaría la propuesta (el que salta y el cyno en O)");
  const directo = evaluar([0], [{ stopId: 32, systemId: 11, caducaMs: 10 * H }], cacheTramos([1, 11], calc), ahora, 1, 45, formaSalto(mk({ puntos: [1, 11] })));
  ok(JSON.stringify(Object.keys(directo.resultados[0].salto).sort()) === JSON.stringify(["cynoSaltos", "saltos"]),
    "una pata directa sin intermedio no lleva ni `via` ni `viaIgnorada`: lo de la 3a");

  // ---- el orden cambia: M1 guardado para B, y ahora se llega a B desde C ----
  const CB = [{ stopId: 41, systemId: 5, caducaMs: 10 * H }, { stopId: 42, systemId: 3, caducaMs: 10 * H }];
  const trCB = cacheTramos([1, 5, 3], calc);
  const cerca = { ly: { "1-5": 5, "3-5": 6 }, puertas: { "1-5": 2, "3-5": 4 }, puntos: [1, 5, 3], vias: [null, null, 11] };
  const ed = evaluar([0, 1], CB, trCB, ahora, 1, 45, formaSalto(mk(cerca)));
  const rd = ed.resultados[1];
  ok(rd.estado === "salvada" && rd.salto.saltos.length === 1 && rd.salto.saltos[0].desde === 5 && rd.salto.viaIgnorada === 11 && rd.salto.via === undefined,
    "C a 6 al de B: directo, M1 se ignora Y SE DICE");
  const lejos = { ly: { "1-5": 5, "3-5": 12, "5-11": 9, "5-12": 7 }, puertas: { "1-5": 2, "5-12": 4 }, puntos: [1, 5, 3], vias: [null, null, 11] };
  const el = evaluar([0, 1], CB, trCB, ahora, 1, 45, formaSalto(mk(lejos)));
  const rl = el.resultados[1];
  console.log("  desde C:", rl.estado, rl.noLlega);
  ok(rl.estado === "fuera_alcance" && !llega(rl.estado), "C a 12 al de B: «fuera de alcance» otra vez (M1 NO se usa)");
  ok(rl.noLlega?.viaNoSirve?.via === 11 && rl.noLlega.viaNoSirve.fallo.motivo === "lejos_ida" && casi(rl.noLlega.viaNoSirve.fallo.ly, 9) && rl.noLlega.desde === 5,
    "y dice que M1 ya no sirve desde C: 9 al");
  // Con `?.`: si una guarda rota hace que M1 se use, esto tiene que dar ✗, no reventar el guion.
  const nueva = rl.noLlega ? busca(mk(lejos), rl.noLlega.desde, rl.noLlega.cyno, 3) : null;
  ok(nueva?.tipo === "propuesta" && nueva.via === 12, "propuesta nueva desde C: M2");
  // La fuerza bruta evalúa cada orden con la MISMA pata: en el orden B primero, M1 sí sirve desde O.
  const eb = evaluar([1, 0], CB, trCB, ahora, 1, 45, formaSalto(mk(lejos)));
  ok(eb.resultados[0].stopId === 42 && eb.resultados[0].estado === "salvada" && eb.resultados[0].salto.via === 11,
    "en el otro orden (B primero, desde O) el MISMO M1 guardado sí sirve, y se usa");

  // ---- no hay propuesta: el motivo exacto ----
  const n17 = busca(mk({ ly: { "1-3": 17 } }));
  ok(n17.tipo === "ni_con_dos" && casi(n17.ly, 17) && n17.alcanceDos === 16, "B a 17 al: ni con un salto intermedio, 17 al y con dos saltos llegas a 16");
  const nada = busca(mk({ ly: { "3-11": 9, "3-12": 9, "1-99": 9 } }));
  ok(nada.tipo === "sin_sistema", "ningún sistema saltable al alcance de los dos lados");
  const sinR = busca(mk({ puertas: { "1-11": null, "1-12": null } }));
  ok(sinR.tipo === "cyno_sin_ruta" && sinR.candidatos === 3,
    "el cyno no tiene ruta a ninguno de los 3 posibles (M1, M2 y el que no tiene puertas)");
  const soloSinPuertas = busca(mk({ ly: { "3-11": 9, "3-12": 9 } }));
  ok(soloSinPuertas.tipo === "cyno_sin_ruta", "si el único posible no tiene puertas: es el cyno el que no llega, no «no hay sistema»");

  // ---- la búsqueda cede el paso: un generador por lotes ----
  const muchos = Array.from({ length: 23 }, (_, i) => 200 + i);
  const pm = mk({ ly: Object.fromEntries(muchos.flatMap((s) => [[`1-${s}`, 6], [`3-${s}`, 7]])), puertas: Object.fromEntries(muchos.flatMap((s) => [[`1-${s}`, 3], [`3-${s}`, 3]])) });
  const g = buscarIntermedio(contextoIntermedio(pm), [...SISTEMAS, ...muchos], conectado, 1, 1, 3);
  let cesiones = 0, fin;
  for (;;) { const x = g.next(); if (x.done) { fin = x.value; break; } cesiones++; }
  ok(cesiones === Math.ceil(25 / LOTE_INTERMEDIO) - 1 && fin.tipo === "propuesta" && fin.via === 200,
    `25 candidatos: cede ${Math.ceil(25 / LOTE_INTERMEDIO) - 1} veces y acaba en el de id más bajo con menos puertas`);
}
const fase3b = cuenta - fase1 - fase2 - salto - fase3;

console.log("Fase 3b, después — lo vigilado con intermedio y la caché de rutas");
{
  const H = 3600e3, ahora = 0;
  // Cyno en 1 (Jita), intermedio 11, destino 3. Rutas de mentira: un sistema 90+x entre medias.
  const ruta = (a, b) => ({ saltos: 2, path: [a, 90 + a, b], wormhole: false });
  const emp = (via) => [{ stop_id: 51, system_id: 3, system_name: "Amarr", caduca_at: new Date(10 * H).toISOString(),
    salto: true, cyno_character_id: 8, salta_character_id: 7, via_system_id: via }];
  const nom = () => "";
  const vig = (via, saltaEn, calc = ruta) => tramosEmpezados(emp(via), 1, calc, nom, ahora, () => ({ desde: 1, quien: "Cyno Alt", saltaEn }))[0].sistemas;
  const largo = [1, 91, 11, 101, 3];
  ok(JSON.stringify(vig(11, 1)) === JSON.stringify(largo), "panel cerrado, el que salta aún no está en el intermedio: cyno → intermedio → destino");
  ok(JSON.stringify(vig(11, 11)) === JSON.stringify([1, 91, 3]), "el que salta ya está en el intermedio: cyno → destino, como en la 3a");
  ok(JSON.stringify(vig(11, null)) === JSON.stringify(largo), "sin saber dónde está el que salta: el camino LARGO (vigilar de más)");
  // Sin ruta en un trozo, se queda el otro y el destino.
  const sinIda = (a, b) => (b === 11 ? null : ruta(a, b));
  ok(JSON.stringify(vig(11, 1, sinIda)) === JSON.stringify([11, 101, 3]), "sin ruta hasta el intermedio: queda el trozo intermedio → destino");
  const sinVuelta = (a, b) => (a === 11 ? null : ruta(a, b));
  ok(JSON.stringify(vig(11, 1, sinVuelta)) === JSON.stringify([1, 91, 11, 3]), "sin ruta del intermedio al destino: queda cyno → intermedio, y el destino");
  ok(JSON.stringify(vig(null, 1)) === JSON.stringify([1, 91, 3]), "sin intermedio: lo de siempre");

  // La caché compartida: las rutas no se rehacen con el reloj, y el resultado es el mismo.
  let n = 0;
  const contar = (a, b) => (n++, { saltos: 3, path: [a, b], wormhole: false });
  const pts = [1, 2, 3];
  const base = { puntos: pts, ly: () => 5, saltable: () => true, rutaCyno: contar, cynoDesde: 1, alcanceLy: 8,
    casco: { fatMult: 0.25, fuelPerLy: 700, isotope: "Helium Isotopes" }, jfc: 5, cicloCynoMin: 1, cynoMinPorSalto: 1, fatigaMin: 0 };
  const P = [{ stopId: 61, systemId: 2, caducaMs: 5 * H }, { stopId: 62, systemId: 3, caducaMs: 6 * H }];
  const tr3 = cacheTramos(pts, (a, b) => ({ saltos: 1, path: [a, b], wormhole: false }));
  const cache = cacheSalto(base.ly, contar);
  const conCache = (t) => proponer(P, tr3, t, 1, 45, formaSalto({ ...base, cooldownHastaMs: t, ahoraMs: t, cache }));
  const sinCache = (t) => proponer(P, tr3, t, 1, 45, formaSalto({ ...base, cooldownHastaMs: t, ahoraMs: t }));
  const a = conCache(0); const tras1 = n; const b = conCache(60e3); const tras2 = n;
  ok(tras1 > 0 && tras2 === tras1, `con la caché compartida, el minuto siguiente no busca ninguna ruta (${tras1} y luego 0)`);
  ok(JSON.stringify(b) === JSON.stringify(sinCache(60e3)), "y da exactamente lo mismo que con una caché nueva");
  ok(JSON.stringify(a.mejor.orden) === JSON.stringify(b.mejor.orden), "el mismo orden un minuto después");
}
const fase3bTras = cuenta - fase1 - fase2 - salto - fase3 - fase3b;

console.log("Panel — las marcas del intel en el plan");
{
  // Un reporte de Jita que toca tres tramos (tres marcas), y otro de Amarr en un tramo.
  const m = (stop_id, sys_id, jumps, ts_ms, aviso, author = "Piloto A", message = "Jita +3") =>
    ({ stop_id, sys_id, system: String(sys_id), jumps, cerca_de: 0, cerca_de_name: "", ts_ms, author, message, aviso });
  const tres = [m(1, 30000142, 0, 100, "avisa"), m(2, 30000142, 2, 100, "no_empezado"), m(3, 30000142, 5, 100, "no_empezado"),
    m(2, 30002187, 0, 200, "no_empezado", "Piloto B", "Amarr red")];
  const res = resumenMarcas(tres);
  ok(res.reportes === 2 && res.tramos === 3, "cabecera: 2 reportes distintos en 3 tramos, no 4 marcas");
  ok(resumenMarcas([tres[0], tres[1], tres[2]]).reportes === 1, "el mismo reporte repetido en tres tramos es UNO");
  const desordenadas = [m(9, 5, 5, 300, "avisa"), m(9, 6, 0, 100, "avisa"), m(9, 7, 2, 400, "avisa"), m(9, 8, 0, 200, "avisa")];
  ok(JSON.stringify(ordenarMarcas(desordenadas).map((x) => x.sys_id)) === JSON.stringify([8, 6, 7, 5]),
    "en el tramo: primero las del camino (la más reciente arriba), luego por saltos");
  ok(desordenadas[0].sys_id === 5, "ordenar no toca la lista original");
  ok(avisoComun([m(9, 1, 0, 1, "silenciado"), m(9, 2, 3, 2, "silenciado")]) === "silenciado", "todas con el mismo motivo: se dice una vez");
  ok(avisoComun([m(9, 1, 0, 1, "silenciado"), m(9, 2, 3, 2, "no_empezado")]) === null, "motivos distintos: cada una el suyo");
  ok(avisoComun([]) === null, "sin marcas, ningún motivo común");
  ok(avisoComun([m(9, 1, 0, 1, "ya_sono"), m(9, 2, 3, 2, "ya_sono")]) === "ya_sono",
    "«ya sonó por tus pilotos» entra en la regla: si todas lo comparten, se dice una vez");
  ok(avisoComun([m(9, 1, 0, 1, "ya_sono"), m(9, 2, 3, 2, "avisa")]) === null, "y mezclado con otro motivo, cada una el suyo");
}
const panel = cuenta - fase1 - fase2 - salto - fase3 - fase3b - fase3bTras;

console.log("Fallos de la 3a — dónde está cada uno y las skills que no se leen");
{
  // Personajes de mentira: ninguno es real.
  const pj = (id, system_id, scopes) => ({ id, name: `Piloto ${id}`, system_id, ship_type_id: null, online: true, scopes });
  const todos = [pj(1, 30000142, [SCOPE_UBICACION]), pj(2, null, []), pj(3, null, [SCOPE_UBICACION])];
  ok(sistemaDe(dondeEsta(todos, 1)) === 30000142, "con permiso y dato: su sistema");
  ok(dondeEsta(todos, 2).noSeSabe === "sin_permiso", "sin permiso de ubicación: no se sabe, POR el permiso (y no desaparece)");
  ok(dondeEsta(todos, 3).noSeSabe === "sin_dato", "con permiso y sin dato: ESI no lo ha dado");
  ok(dondeEsta(todos, 9).noSeSabe === "no_esta" && dondeEsta(todos, null).noSeSabe === "no_elegido", "ni está ni elegido: cada uno su motivo");
  // Las skills: V y el motivo cuando no se leen; nunca un 0 callado.
  const falta = `${PREFIJO_FALTA_PERMISO}este personaje no concedió el scope necesario.`;
  const sinPermiso = skillsDeSalto({ jdc: null, jfc: null, skills_error: falta, owned: [], assets_error: null }, "");
  ok(sinPermiso.jdc === 5 && sinPermiso.jfc === 5 && sinPermiso.motivo === falta, "sin permiso de skills: se suponen a V, y se dice cuál falta");
  const leidas = skillsDeSalto({ jdc: 0, jfc: 3, skills_error: null, owned: null, assets_error: falta }, "");
  ok(leidas.jdc === 0 && leidas.jfc === 3 && leidas.motivo === null, "leídas: un 0 de verdad se respeta, y sin assets las skills siguen valiendo");
  const caida = skillsDeSalto(null, "ESI 502");
  ok(caida.jdc === 5 && caida.motivo === "ESI 502", "si la llamada entera falla: V y el error");
  ok(skillsDeSalto(null, "").motivo === null, "mientras carga, sin motivo (aún no ha fallado nada)");
}
const fallos3a = cuenta - fase1 - fase2 - salto - fase3 - fase3b - fase3bTras - panel;

console.log("Retoques — el resumen saltando y el cyno que ya está");
{
  const H = 3600e3;
  const pts = [1, 2, 3];
  const base = { puntos: pts, ly: () => 5, saltable: () => true, cynoDesde: 1, alcanceLy: 8,
    casco: { fatMult: 0.25, fuelPerLy: 700, isotope: "Helium Isotopes" }, jfc: 5, cicloCynoMin: 1, cynoMinPorSalto: 1,
    fatigaMin: 0, cooldownHastaMs: 0, ahoraMs: 0 };
  const P = [{ stopId: 71, systemId: 2, caducaMs: 9 * H }, { stopId: 72, systemId: 3, caducaMs: 9 * H }];
  const tr3 = cacheTramos(pts, (a, b) => ({ saltos: 4, path: [a, b], wormhole: false }));
  // El cyno ya está en 2 (sale de ahí) y 2→3 son 0 puertas: ninguna espera… salvo el cooldown.
  const cero = (a, b) => ({ saltos: 0, path: [a, b], wormhole: false });
  const sinEsperas = evaluar([0], P, tr3, 0, 1, 45, formaSalto({ ...base, cynoDesde: 2, rutaCyno: cero }));
  ok(resumenTiempo(sinEsperas, true).tipo === "sin_esperas", "saltando sin esperar nada: «sin esperas», no «recorrido 0 m»");
  const conEsperas = evaluar([0], P, tr3, 0, 1, 45, formaSalto({ ...base, rutaCyno: (a, b) => ({ saltos: 7, path: [a, b], wormhole: false }) }));
  const rt = resumenTiempo(conEsperas, true);
  ok(rt.tipo === "esperas" && Math.abs(rt.min - 7) < 1e-9, "saltando con esperas: «esperas 7 m»");
  const aPuertas = evaluar([0, 1], P, tr3, 0, 1, 45);
  ok(resumenTiempo(aPuertas, false).tipo === "recorrido" && resumenTiempo(aPuertas, false).min === aPuertas.recorridoMin, "a puertas: «recorrido», como siempre");
  ok(resumenTiempo(sinEsperas, false).tipo === "recorrido", "lo decide la forma de viajar, no los minutos");
  // El punto 4: el cyno que ya está en la parada.
  const r0 = sinEsperas.resultados[0];
  ok(puertasCyno(r0)?.tipo === "ya_ahi", "salta y el cyno no cruzó ninguna puerta: «el cyno ya está ahí»");
  const r7 = conEsperas.resultados[0];
  const p7 = puertasCyno(r7);
  ok(p7?.tipo === "puertas" && p7.n === 7, "con puertas, las cuenta");
  ok(puertasCyno(aPuertas.resultados[0]) === null, "a puertas no hay cyno: lo de siempre");
  const mismo = evaluar([0, 1], [P[0], { stopId: 73, systemId: 2, caducaMs: 9 * H }], cacheTramos([1, 2, 2], cero), 0, 1, 45,
    formaSalto({ ...base, puntos: [1, 2, 2], rutaCyno: (a, b) => ({ saltos: 3, path: [a, b], wormhole: false }) }));
  ok(puertasCyno(mismo.resultados[1])?.tipo === "mismo_sitio", "dos paradas en el mismo sistema: no es «el cyno ya está ahí»");
}
const retoques = cuenta - fase1 - fase2 - salto - fase3 - fase3b - fase3bTras - panel - fallos3a;

console.log("Parte B — lo que Koru ya sabe, propuesto");
{
  // Catálogos de mentira: 501 y 502 naves de salto; 601 una Force Recon (monta normal y covert, con
  // bono), 602 un Covert Ops (solo covert), 603 un hauler (solo industrial), 604 una lanzadera.
  const bases = [{ id: 1, name: "N", cycleMin: 10 }, { id: 2, name: "C", cycleMin: 1 }, { id: 3, name: "I", cycleMin: 10 }];
  const fit = { cynos: [{ id: 1, tipo: "normal", fitTypes: [601] }, { id: 2, tipo: "covert", fitTypes: [601, 602] }, { id: 3, tipo: "industrial", fitTypes: [603] }],
    durationMult: { "601": 0.5 } };
  const nivel = { normal: 1, covert: 5, industrial: 1 };
  const cat = [501, 502];
  // D1
  ok(duracionCyno({ tipo_cyno: "normal", ciclo_cyno_min: 99 }, 601, bases, fit).min === 5, "D1: normal desde una Force Recon, 5 min (la mitad)");
  ok(duracionCyno({ tipo_cyno: "covert", ciclo_cyno_min: 99 }, 601, bases, fit).min === 0.5, "D1: covert desde una Force Recon, 30 s");
  const sinCasco = duracionCyno({ tipo_cyno: "normal", ciclo_cyno_min: 99 }, null, bases, fit);
  ok(sinCasco.min === 10 && sinCasco.motivo === "sin_casco", "D1: sin saber el casco, la base SIN bono, y se dice");
  ok(duracionCyno({ tipo_cyno: null, ciclo_cyno_min: 7 }, 601, bases, fit).motivo === "a_mano" && duracionCyno({ tipo_cyno: null, ciclo_cyno_min: 7 }, 601, bases, fit).min === 7,
    "D1: sin tipo (una fila de antes), a mano con su número");
  ok(duracionCyno({ tipo_cyno: "industrial", ciclo_cyno_min: 10 }, 601, bases, fit).puedeMontar === false, "D1: una Force Recon no monta el industrial: se dice, no se bloquea");
  ok(tipoCynoPorDefecto(602, fit) === "covert" && tipoCynoPorDefecto(601, fit) === null && tipoCynoPorDefecto(null, fit) === null,
    "por defecto: el único que cabe; si caben varios, no se adivina");
  // D1 con los catálogos REALES de public/ (datos del SDE, no de nadie): una Falcon enciende un normal en 5 min.
  const real = JSON.parse(readFileSync(new URL("../public/cyno_fit.json", import.meta.url), "utf8"));
  const basesReales = JSON.parse(readFileSync(new URL("../public/jumpships.json", import.meta.url), "utf8")).cynos;
  ok(duracionCyno({ tipo_cyno: "normal", ciclo_cyno_min: 0 }, 11957, basesReales, real).min === 5 &&
     duracionCyno({ tipo_cyno: "normal", ciclo_cyno_min: 0 }, 12011, basesReales, real).min === 10,
    "D1 con el SDE: una Falcon deja el normal en 5 min; una Eagle (sin bono) no lo toca");
  // B1
  const datos = (id, naves, cft = 3) => ({ character_id: id, naves, naves_motivo: naves ? null : "sin_permiso", foto_at: null, cft, cft_motivo: cft == null ? "sin_permiso" : null });
  const b1 = proponerNave(502, datos(1, [501]), cat);
  ok(b1.propuesta === 502 && JSON.stringify(b1.poseidas) === "[501]" && b1.resto.length === 0, "B1: en una de salto ahora: esa, y la que tiene aparte");
  const b1b = proponerNave(604, datos(1, [502]), cat);
  ok(b1b.propuesta === null && JSON.stringify(b1b.poseidas) === "[502]" && JSON.stringify(b1b.resto) === "[501]", "B1: en una lanzadera: primero las que tiene, luego el resto");
  ok(proponerNave(null, datos(1, null), cat).posesion === "no_se_sabe", "B1: sin la foto de assets, no se sabe (no «no tiene»)");
  // B2
  ok(avisoNave(501, 502, cat)?.ahora === 502, "B2: guardada 501 y lleva 502: se avisa");
  ok(avisoNave(501, 501, cat) === null && avisoNave(501, 604, cat) === null && avisoNave(501, null, cat) === null,
    "B2: la misma, una que no es de salto, o no se sabe: no se avisa");
  // B3
  const pj = (id, ship) => ({ id, name: `Piloto ${id}`, system_id: 30000142, ship_type_id: ship, ship: null, online: true, scopes: [] });
  const uno = candidatosPapeles([pj(1, 501), pj(2, 604)], [datos(1, []), datos(2, [])], cat, fit, nivel);
  ok(uno.salta.unico === 1 && uno.salta.candidatos[0].motivo.tipo === "lleva", "B3: un solo candidato a saltar: se preselecciona");
  const varios = candidatosPapeles([pj(1, 501), pj(2, 604)], [datos(1, []), datos(2, [502])], cat, fit, nivel);
  ok(varios.salta.unico === null && varios.salta.candidatos.length === 2 && varios.salta.candidatos[1].motivo.tipo === "posee", "B3: varios: ninguno preseleccionado, los dos primero con su motivo");
  const ninguno = candidatosPapeles([pj(1, 604)], [datos(1, [])], cat, fit, nivel);
  ok(ninguno.salta.candidatos.length === 0 && ninguno.salta.resto[0].motivo.tipo === "no" && ninguno.salta.unico === null, "B3: ninguno: nadie preseleccionado");
  const noSabe = candidatosPapeles([pj(1, null)], [datos(1, null, null)], cat, fit, nivel);
  ok(noSabe.salta.resto[0].motivo.tipo === "no_se_sabe" && noSabe.cyno.resto[0].motivo.tipo === "no_se_sabe", "B3: sin nave ni foto ni skills: «no se sabe», no «no»");
  // Cyno: skill Y casco.
  const cy = candidatosPapeles([pj(1, 601), pj(2, 602), pj(3, 601), pj(4, 604)], [datos(1, [], 5), datos(2, [], 3), datos(3, [], 1), datos(4, [], 5)], cat, fit, nivel);
  const de = (id) => [...cy.cyno.candidatos, ...cy.cyno.resto].find((x) => x.id === id).motivo;
  ok(JSON.stringify(de(1).tipos) === '["normal","covert"]', "cyno: Force Recon y CFT V: normal y covert");
  ok(de(2).tipo === "no", "cyno: Covert Ops con CFT III: el casco sí, la skill no (el covert pide V)");
  ok(JSON.stringify(de(3).tipos) === '["normal"]', "cyno: Force Recon con CFT I: solo el normal");
  ok(de(4).tipo === "no", "cyno: CFT V en una lanzadera: la skill sí, el casco no");
  ok(cy.cyno.unico === null && cy.cyno.candidatos.length === 2, "cyno: dos candidatos, ninguno preseleccionado");
}
const parteB = cuenta - fase1 - fase2 - salto - fase3 - fase3b - fase3bTras - panel - fallos3a - retoques;

console.log(`\n${cuenta - fallos}/${cuenta} bien (fase 1: ${fase1}, fase 2: ${fase2}, salto: ${salto}, fase 3a: ${fase3}, fase 3b: ${fase3b}, 3b después: ${fase3bTras}, panel: ${panel}, fallos 3a: ${fallos3a}, retoques: ${retoques}, parte B: ${parteB})`);
process.exit(fallos ? 1 : 0);
