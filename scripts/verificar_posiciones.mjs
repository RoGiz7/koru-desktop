/**
 * Comprueba la regla de las POSICIONES SIN CONFIRMAR (`src/posiciones.ts`): quién lleva más de
 * 90 s sin que se sepa nada cierto de él, desde cuándo y por qué; cómo fusiona `refresh()` y cómo
 * aplica el sondeo. Carga el fichero TAL CUAL: no tiene una copia de la regla.
 *
 *   node scripts/verificar_posiciones.mjs
 *
 * Se lanza siempre que se toque `src/posiciones.ts`. Personajes y sistemas de mentira (Jita).
 */
import { fusionarRefresh, aplicarSondeo, sinConfirmar, CORTE_POSICION_MS, SCOPE_UBICACION } from "../src/posiciones.ts";

let fallos = 0;
let cuenta = 0;
const ok = (c, m) => {
  cuenta++;
  if (!c) {
    fallos++;
    console.log("  ✗", m);
  } else console.log("  ✓", m);
};

const JITA = 30000142;
const PERIMETER = 30000144;
const S = 1000;
const tarjeta = (id, system_id, extra = {}) => ({
  character_id: id,
  name: `Piloto ${id}`,
  corporation_id: null,
  corporation_name: null,
  alliance_id: null,
  alliance_name: null,
  system_id,
  system_name: system_id ? "Jita" : null,
  ship_type_id: null,
  ship_type_name: null,
  ship_name: null,
  online: true,
  scopes: [SCOPE_UBICACION],
  ...extra,
});
const sondeo = (id, extra = {}) => ({
  character_id: id,
  system_id: null,
  system_name: null,
  ship_type_id: null,
  ship_type_name: null,
  online: true,
  moved: false,
  fired_notes: [],
  confirmado: false,
  motivo: null,
  ...extra,
});
const ids = (l) => l.map((x) => x.id).join(",");

console.log("Posiciones sin confirmar");
{
  const t0 = 1_000_000;
  // Recién confirmado: el refresh del arranque trae su sistema.
  let cards = fusionarRefresh({}, [tarjeta(1, JITA)], t0);
  ok(cards[1].pos_confirmada_ms === t0 && sinConfirmar(Object.values(cards), t0 + 60 * S).length === 0,
    "recién confirmado por refresh(): no sale");
  ok(sinConfirmar(Object.values(cards), t0 + CORTE_POSICION_MS).length === 0 && sinConfirmar(Object.values(cards), t0 + CORTE_POSICION_MS + 1).length === 1,
    "el corte es de 90 s: a los 90 justos aún no, pasados sí");

  // Desconectado con certeza: el sondeo lo confirma aunque no traiga sistema.
  cards = fusionarRefresh({}, [tarjeta(2, JITA, { online: false })], t0);
  cards = aplicarSondeo(cards, [sondeo(2, { online: false, confirmado: true })], t0 + 100 * S);
  ok(sinConfirmar(Object.values(cards), t0 + 150 * S).length === 0, "desconectado con certeza: confirmado, no sale");

  // Desconectado con certeza en el refresh() del arranque, sin sistema: también es saber algo cierto.
  cards = fusionarRefresh({}, [tarjeta(11, null, { online: false })], t0);
  ok(cards[11].pos_confirmada_ms === t0 && sinConfirmar(Object.values(cards), t0 + 60 * S).length === 0,
    "desconectado con certeza en refresh(): confirmado ahí mismo");

  // Sin permiso de posición: no cuenta nunca.
  cards = fusionarRefresh({}, [tarjeta(3, null, { scopes: [] })], t0);
  ok(sinConfirmar(Object.values(cards), t0 + 3600 * S).length === 0, "sin permiso de posición: no cuenta (es «falta permiso»)");

  // Fallo de UN personaje: A se confirma en cada sondeo, B no.
  cards = fusionarRefresh({}, [tarjeta(4, JITA), tarjeta(5, JITA)], t0);
  for (let k = 1; k <= 4; k++) {
    cards = aplicarSondeo(cards, [sondeo(4, { system_id: JITA, confirmado: true }), sondeo(5, { motivo: "sin_respuesta_posicion" })], t0 + k * 30 * S);
  }
  const uno = sinConfirmar(Object.values(cards), t0 + 125 * S);
  ok(ids(uno) === "5" && uno[0].clase === "vieja" && uno[0].motivo === "sin_respuesta_posicion" && uno[0].desdeMs === t0,
    "fallo de un solo personaje: sale ese, «vieja», con su motivo y desde su última confirmación");
  ok(cards[5].system_id === JITA, "y su posición NO se quita: el intel sigue midiendo desde ahí");

  // Fallo de la llamada ENTERA: no se aplica ningún sondeo y, pasado el corte, salen los dos.
  cards = fusionarRefresh({}, [tarjeta(4, JITA), tarjeta(5, JITA)], t0);
  ok(ids(sinConfirmar(Object.values(cards), t0 + 100 * S)) === "4,5", "fallo de la llamada entera: nadie confirmado, salen todos");

  // Vuelta a la normalidad: un sondeo bueno y vuelven a estar al día, solos.
  cards = aplicarSondeo(cards, [sondeo(4, { system_id: JITA, confirmado: true }), sondeo(5, { system_id: PERIMETER, confirmado: true })], t0 + 110 * S);
  ok(sinConfirmar(Object.values(cards), t0 + 111 * S).length === 0 && cards[5].system_id === PERIMETER && cards[5].pos_motivo === null,
    "vuelta a la normalidad: al día sin reiniciar, y el motivo se va");

  // Sin posición y nunca confirmado: cuenta desde que Koru tiene su tarjeta.
  cards = fusionarRefresh({}, [tarjeta(6, null)], t0);
  ok(sinConfirmar(Object.values(cards), t0 + 60 * S).length === 0, "nunca confirmado: dentro de los 90 s desde su tarjeta, aún no");
  const sp = sinConfirmar(Object.values(cards), t0 + 100 * S);
  ok(ids(sp) === "6" && sp[0].clase === "sin_posicion" && sp[0].desdeMs === t0, "sin posición: sale como «sin posición», desde que llegó su tarjeta");
  // Un refresh posterior no le reinicia el plazo.
  cards = fusionarRefresh(cards, [tarjeta(6, null)], t0 + 80 * S);
  ok(cards[6].tarjeta_desde_ms === t0 && ids(sinConfirmar(Object.values(cards), t0 + 100 * S)) === "6", "un refresh() sin sistema no le reinicia el plazo");

  // refresh() trae null y la anterior tenía sistema: se conserva, sin reconfirmar.
  cards = fusionarRefresh({}, [tarjeta(7, JITA, { ship_type_id: 587, ship_type_name: "Rifter" })], t0);
  cards = fusionarRefresh(cards, [tarjeta(7, null)], t0 + 50 * S);
  ok(cards[7].system_id === JITA && cards[7].system_name === "Jita" && cards[7].ship_type_name === "Rifter" && cards[7].pos_confirmada_ms === t0,
    "refresh() trae null: se conserva la posición anterior (sistema, nombre, nave) y su hora");
  ok(sinConfirmar(Object.values(cards), t0 + 100 * S)[0]?.clase === "vieja", "y pasado el corte sale como «vieja», no se pierde");

  // Quitado de la lista: desaparece, como siempre.
  cards = fusionarRefresh(cards, [tarjeta(8, JITA)], t0 + 60 * S);
  ok(cards[7] === undefined && cards[8] !== undefined, "un personaje quitado o borrado desaparece en el refresh(), como hoy");

  // El sondeo no inventa tarjetas.
  cards = aplicarSondeo({}, [sondeo(9, { system_id: JITA, confirmado: true })], t0);
  ok(cards[9] === undefined, "el sondeo no inventa tarjetas de quien aún no tiene");

  // Sin token: sale con su motivo.
  cards = fusionarRefresh({}, [tarjeta(10, JITA)], t0);
  cards = aplicarSondeo(cards, [sondeo(10, { motivo: "sin_token" })], t0 + 100 * S);
  ok(sinConfirmar(Object.values(cards), t0 + 100 * S)[0]?.motivo === "sin_token", "sin token: sale con «sin_token»");
}

console.log(`\n${cuenta - fallos}/${cuenta} bien`);
process.exit(fallos ? 1 : 0);
