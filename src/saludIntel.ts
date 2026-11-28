// Salud del vigilante de intel: la línea de salud y la PALABRA de la pastilla de «Intel en vivo».
// Vive aparte de map.tsx para poder probarla sin montar el mapa.
import { getLang, tr } from "./i18n.ts";
import type { IntelStatus } from "./types";
import type { SinConfirmar } from "./posiciones.ts";

/** Lo que el vigilante no sabe de las posiciones de tus pilotos (ver `src/posiciones.ts`).
 *  `sinReferencias`: por este fallo no le queda NINGÚN sitio desde el que medir (los orígenes del
 *  intel están vacíos y alguno de tus pilotos no tiene posición): el aviso de siempre no puede sonar. */
export type FalloPosiciones = { sin: SinConfirmar[]; sinReferencias: boolean };

/** «45 s», «12 min», «1 h 5 min»: desde hace cuánto. */
function hace(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** El motivo que trae el sondeo, en frase. Sin motivo y sin confirmar: el sondeo entero no responde. */
function textoMotivo(m: string | null): string {
  const en = getLang() === "en";
  if (m === "sin_token") return en ? "no session with EVE" : "sin sesión con EVE";
  if (m === "sin_respuesta_posicion") return en ? "ESI didn't answer its position" : "ESI no ha dado su posición";
  return en ? "the position poll isn't answering" : "el sondeo de posiciones no responde";
}

/** Una línea por piloto para el tooltip: quién, qué clase y desde cuándo, y por qué. */
function lineasPilotos(f: FalloPosiciones, ahora: number): string {
  const en = getLang() === "en";
  return f.sin
    .map((p) =>
      en
        ? `${p.name}: ${p.clase === "vieja" ? "last known position" : "no position"} for ${hace(ahora - p.desdeMs)} (${textoMotivo(p.motivo)})`
        : `${p.name}: ${p.clase === "vieja" ? "última posición conocida" : "sin posición"} desde hace ${hace(ahora - p.desdeMs)} (${textoMotivo(p.motivo)})`,
    )
    .join("\n");
}

/** Salud REAL del vigilante de intel: [clase, texto, tooltip, palabra de la pastilla]. La leen el
 *  badge de salud Y la pastilla «Activo» del interruptor, a propósito desde aquí.
 *
 *  ⚠️ Estuvo dentro del badge y la pastilla se pintaba verde solo con mirar `intel.live`: con el
 *  grafo vacío el panel decía a la vez «● Activo» en VERDE y «⚠ sin mapa de sistemas» en rojo, y
 *  la verde es la que se ve de reojo. Es el mismo «Activo verde que mentía» de antes, por otra
 *  puerta. Un solo cálculo para los dos y no pueden volver a contradecirse. */
export type Salud = ["ok" | "warn" | "bad", string, string, string];

/** `camino`: por qué el vigilante NO tiene al día el camino del plan (fase 2), o `null` si lo tiene.
 *  Lo sabe el mapa, que es quien se lo manda (`plan_intel_set`) — el hilo de Rust no puede saber
 *  que algo no le llegó.
 *
 *  ★ Antes ese fallo solo lo veía la consola con el panel cerrado: un fallo en silencio, y la
 *    vigilancia del camino es justo la que trabaja con el panel cerrado. Va DESPUÉS de todo lo
 *    demás a propósito: si el vigilante no avisa o no tiene logs, el camino tampoco, y la palabra
 *    de antes sigue siendo verdad ella sola. Ámbar y no rojo: la alerta de tus pilotos sí suena, así
 *    que «No avisa» sería mentira. */
export function saludVigilante(s: IntelStatus, camino: string | null = null, posiciones: FalloPosiciones | null = null): Salud {
  const stale = Date.now() - s.last_tick_ms > 15000;
  const base: [Salud[0], string, string] = stale
    ? ["bad", `⚠ ${tr("vigilante sin responder")}`, tr("El hilo del intel no responde")]
    : s.last_error
      ? ["bad", `⚠ ${tr("error leyendo logs")}`, s.last_error]
      : !s.collecting
        ? ["bad", `⚠ ${tr("parado")}: ${s.idle_reason ?? "?"}`, s.idle_reason ?? ""]
        : // ★ SIN GRAFO va antes que «sin logs» y en rojo: es el único estado en que el
          //   feed entra y el mapa se ve perfecto mientras el aviso flotante y el
          //   minimapa no pueden saltar NUNCA. Aquí salía «leyendo» en verde.
          //   `!s.graph_systems` y no `=== 0`: un backend sin el campo también es
          //   un backend que no sabemos si tiene grafo.
          !s.graph_systems
          ? [
              "bad",
              `⚠ ${tr("sin mapa de sistemas: no puede avisar")}`,
              tr("El vigilante lee el canal, pero no tiene el mapa de sistemas: no reconoce ninguno y ni el aviso flotante ni el minimapa pueden saltar. Si no se arregla solo, reinicia Koru."),
            ]
          : s.files === 0
          ? [
              "warn",
              `⚠ ${tr("sin logs de ese canal")}`,
              tr("No hay ningún log de ese canal en la carpeta. ¿Canal correcto? ¿Has entrado al canal en esta sesión?"),
            ]
          : [
              "ok",
              `${tr("leyendo")} ${s.files} ${tr("log(s)")} · ${s.lines} ${tr("líneas")}`,
              tr("El vigilante está leyendo de verdad"),
            ];
  const ahora = Date.now();
  const en = getLang() === "en";
  // ★ POSICIONES. Después de los rojos de siempre (si el vigilante no responde o no tiene mapa, eso
  //   es lo cierto y lo incluye todo). Rojo si por este fallo no queda NINGÚN sitio desde el que medir:
  //   el aviso de siempre no puede sonar, y «No avisa» es la verdad. Si no, ámbar, DESPUÉS de «sin
  //   logs» y antes del camino: la alerta suena, pero midiendo desde donde ya no se sabe si están.
  if (base[0] !== "bad" && posiciones?.sinReferencias) {
    return [
      "bad",
      en ? "⚠ no pilot has a position: can't alert" : "⚠ ningún piloto tiene posición: no puede avisar",
      (en
        ? "None of your pilots has a known position and there are no anchors: the usual alert has nowhere to measure from and can't sound.\n"
        : "Ninguno de tus pilotos tiene posición conocida y no hay anclas: el aviso de siempre no tiene desde dónde medir y no puede sonar.\n") +
        lineasPilotos(posiciones, ahora),
      palabraPastilla("bad"),
    ];
  }
  if (base[0] === "ok" && posiciones && posiciones.sin.length > 0) {
    const n = posiciones.sin.length;
    const desde = hace(ahora - Math.min(...posiciones.sin.map((p) => p.desdeMs)));
    const sinPos = posiciones.sin.some((p) => p.clase === "sin_posicion");
    const pie = en
      ? `The intel's jumps are measured from their last known position.${sinPos ? " A pilot with no position doesn't count for the intel's jumps until it's known where they are." : ""}`
      : `Los saltos del intel se miden desde su última posición conocida.${sinPos ? " Quien no tiene posición no cuenta para medir los saltos del intel hasta que se sepa dónde está." : ""}`;
    return [
      "warn",
      en
        ? `⚠ position not confirmed: ${n} ${n === 1 ? "pilot" : "pilots"}, for ${desde}`
        : `⚠ posición sin confirmar: ${n} ${n === 1 ? "piloto" : "pilotos"}, desde hace ${desde}`,
      `${lineasPilotos(posiciones, ahora)}\n${pie}`,
      tr("Posición: fallo"),
    ];
  }
  // Solo sobre un vigilante sano: cualquier otro estado ya dice algo cierto que incluye al camino.
  if (base[0] === "ok" && camino) {
    return ["warn", `⚠ ${tr("el camino del plan no está al día")}`, camino, tr("Camino: fallo")];
  }
  return [...base, palabraPastilla(base[0])];
}

/** La PALABRA de la pastilla del interruptor encendido. Tiene que ser verdad ELLA SOLA, sin la
 *  línea de salud al lado: si alguien tapa el badge con el dedo y solo lee esto, no puede quedarse
 *  tranquilo con un vigilante que no puede avisar.
 *
 *  ⚠️ La primera versión solo pintaba de rojo la pastilla y dejaba «⚠ Activo»: una contradicción
 *  en dos palabras, la mentira pintada de rojo en vez de cambiada. Por eso sale de la MISMA salud
 *  que el color, y no de `intel.live`.
 *   · bad (sin grafo, parado, error, hilo mudo) → «No avisa»: lee o no, avisar no puede.
 *   · warn (sin logs del canal) → «Sin logs»: avisaría, pero ahora no tiene nada que leer.
 *   · warn (el camino del plan no le llegó) → «Camino: fallo»: lo pone `saludVigilante`, no esto,
 *     porque «Sin logs» sería falso ahí.
 *   · warn (posiciones sin confirmar) → «Posición: fallo»: también lo pone `saludVigilante`. Vale para
 *     las dos clases, la posición vieja y la que no hay.
 *   · ok → «Activo», que entonces sí es verdad. */
export function palabraPastilla(cls: "ok" | "warn" | "bad"): string {
  return cls === "bad" ? tr("No avisa") : cls === "warn" ? tr("Sin logs") : tr("Activo");
}
