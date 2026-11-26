// Salud del vigilante de intel: la línea de salud y la PALABRA de la pastilla de «Intel en vivo».
// Vive aparte de map.tsx para poder probarla sin montar el mapa.
import { tr } from "./i18n";
import type { IntelStatus } from "./types";

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
export function saludVigilante(s: IntelStatus, camino: string | null = null): Salud {
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
 *   · ok → «Activo», que entonces sí es verdad. */
export function palabraPastilla(cls: "ok" | "warn" | "bad"): string {
  return cls === "bad" ? tr("No avisa") : cls === "warn" ? tr("Sin logs") : tr("Activo");
}
