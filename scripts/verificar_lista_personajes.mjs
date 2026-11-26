/**
 * Comprueba la lista de personajes de la barra de arriba (`src/listaPersonajes.ts`): qué va en la
 * fila, qué se recoge tras el «+N», el aviso de accesos y el buscador.
 *
 * Solo lee. Carga `src/listaPersonajes.ts` TAL CUAL — no tiene una copia de la regla.
 *
 *   node scripts/verificar_lista_personajes.mjs
 *
 * Los nombres son inventados. Las dos trampas que vigila, por encima de todo:
 *  1. `online: null` es «no se sabe»: ni punto verde ni fila de conectados.
 *  2. El «!» de un recogido no puede esconderse: lo lleva el botón.
 */
import { repartir, filtrar, agrupar, conectado, ordenar, UMBRAL_RECOGER } from "../src/listaPersonajes.ts";

let fallos = 0;
let cuenta = 0;
const ok = (c, m) => {
  cuenta++;
  if (!c) {
    fallos++;
    console.log("  ✗", m);
  } else console.log("  ✓", m);
};

const NOMBRES = ["Alba Prima", "Bruno Kestrel", "Carla Vexor", "Dario Tristan", "Elena Ibis", "Fabio Rifter",
  "Gema Merlin", "Hugo Atron", "Irene Slasher", "Jorge Venture", "Karla Heron", "Luis Probe",
  "Marta Navitas", "Nico Tormentor", "Olga Executioner", "Pablo Condor", "Quim Burst", "Rosa Bantam",
  "Sergio Magnate", "Tania Imicus", "Ulises Breacher", "Vera Inquisitor", "Walter Punisher", "Ximena Kestrel"];
const pjs = (n) => NOMBRES.slice(0, n).map((name, i) => ({ character_id: 1000 + i, name }));
const vivoDe = (online) => (id) => ({ online: online(id), corporation_name: id % 2 ? "Ficticia Mining Corp" : "Otra Corp", system_name: id === 1003 ? "Jita" : "Amarr", ship_type_name: id === 1004 ? "Procurer" : "Heron" });
const sinAviso = () => false;

console.log(`Umbral: ${UMBRAL_RECOGER}`);
{
  const r = repartir(pjs(8), vivoDe((id) => id < 1003), 1001, sinAviso);
  ok(r.fila.length === 8 && r.recogidos.length === 0, "8 personajes, 3 conectados: los 8 en la fila, sin botón");
}
{
  const r = repartir(pjs(24), vivoDe((id) => id < 1005), 1002, sinAviso);
  ok(r.fila.length === 5 && r.recogidos.length === 19, "24, 5 conectados, el elegido entre ellos: esos 5 en la fila, 19 recogidos");
}
{
  const r = repartir(pjs(24), vivoDe((id) => id < 1005), 1020, sinAviso);
  ok(r.fila.length === 6 && r.recogidos.length === 18 && r.fila.includes(1020), "24, 5 conectados, el elegido NO conectado: 6 en la fila, 18 recogidos");
  ok(r.fila.join() === [1000, 1001, 1002, 1003, 1004, 1020].join(), "y la fila sigue en orden alfabético, con el elegido en su sitio");
}
{
  const r = repartir(pjs(24), vivoDe(() => false), 1007, sinAviso);
  ok(r.fila.length === 1 && r.fila[0] === 1007 && r.recogidos.length === 23, "24, ninguno conectado, uno elegido: el elegido y 23 recogidos");
}
{
  const r = repartir(pjs(24), vivoDe(() => false), null, sinAviso);
  ok(r.fila.length === 0 && r.recogidos.length === 24, "24, ninguno conectado, vista Global: fila vacía, los 24 recogidos");
}
{
  const r = repartir(pjs(24), vivoDe(() => null), 1007, sinAviso);
  ok(r.fila.length === 1 && r.recogidos.length === 23, "24, todos con online: null, uno elegido: el elegido y 23 recogidos (null no es conectado)");
  ok(!conectado({ online: null }) && !conectado(undefined) && conectado({ online: true }), "punto verde solo con online === true");
}
{
  const r = repartir(pjs(24), vivoDe((id) => id < 1005), 1002, (id) => id === 1015);
  ok(r.recogidos.includes(1015) && r.avisoRecogidos, "24, uno recogido con accesos sin conceder: el botón lleva el aviso");
  const r2 = repartir(pjs(24), vivoDe((id) => id < 1005), 1002, (id) => id === 1001);
  ok(!r2.avisoRecogidos, "si el que no tiene accesos está en la fila, el botón no lo marca (su retrato ya lo dice)");
}
{
  const r = repartir(pjs(11), vivoDe(() => false), 1000, sinAviso);
  ok(r.recogidos.length === 10, "con 11 ya se recoge (el umbral es «más de 10»)");
  ok(repartir(pjs(10), vivoDe(() => false), 1000, sinAviso).recogidos.length === 0, "con 10 justos, como siempre");
}
// ---- el buscador y los grupos ----
{
  const todos = pjs(24);
  const v = vivoDe((id) => id < 1005);
  ok(filtrar(todos, v, "  KESTREL ").map((p) => p.name).join() === "Bruno Kestrel,Ximena Kestrel", "busca por nombre sin distinguir mayúsculas");
  ok(filtrar(todos, v, "ficticia").length === 12, "busca por corporación");
  ok(filtrar(todos, v, "jita").map((p) => p.character_id).join() === "1003", "busca por sistema");
  ok(filtrar(todos, v, "procurer").map((p) => p.character_id).join() === "1004", "busca por nave");
  ok(filtrar(todos, v, "").length === 24, "vacío: todos");
  const g = agrupar(todos, v);
  ok(g.conectados.length === 5 && g.resto.length === 19 && g.resto[0].character_id === 1005, "grupos «Conectados · 5» y «Resto · 19», en orden alfabético");
  const gNull = agrupar(todos, vivoDe(() => null));
  ok(gNull.conectados.length === 0 && gNull.resto.length === 24, "con todo null, nadie en «Conectados»");
}

// ---- el orden, sin distinguir mayúsculas ----
{
  // Llegan como del ORDER BY de SQLite (byte a byte): las minúsculas, detrás de la Z.
  const llegan = [
    { character_id: 1, name: "Bruno Kestrel" },
    { character_id: 2, name: "Zoe Atron" },
    { character_id: 3, name: "ana Minúscula" },
    { character_id: 4, name: "carla vexor" },
  ];
  ok(ordenar(llegan).map((p) => p.name).join() === "ana Minúscula,Bruno Kestrel,carla vexor,Zoe Atron",
    "un nombre que empieza por minúscula va en su sitio, no detrás de la Z");
  ok(repartir(llegan, () => ({ online: false }), 2, () => false).fila.join() === "3,1,4,2", "la fila (10 o menos), en ese orden");
  const muchos = [...pjs(12), { character_id: 2000, name: "aaron minúscula" }];
  const rm = repartir(muchos, (id) => ({ online: id === 2000 || id === 1005 }), null, () => false);
  ok(rm.fila.join() === "2000,1005", "la fila recogida, también: la minúscula delante");
  const gm = agrupar(muchos, () => ({ online: false }));
  ok(gm.resto[0].character_id === 2000, "y la lista desplegable, también");
  ok(ordenar([{ character_id: 9, name: "Alba" }, { character_id: 5, name: "alba" }]).map((p) => p.character_id).join() === "5,9",
    "a igualdad sin mayúsculas, por id: siempre el mismo orden");
}

console.log(`\n${cuenta - fallos}/${cuenta} bien`);
process.exit(fallos ? 1 : 0);
