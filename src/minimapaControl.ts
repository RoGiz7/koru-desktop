/** EL INTERRUPTOR DEL MINIMAPA, en un solo sitio.
 *
 *  Vive en DOS pantallas a proposito: en el panel de intel del mapa —que es donde estas cuando
 *  piensas en intel, y por tanto donde lo vas a buscar— y en Ajustes, junto a sus mandos. Idea de
 *  RoGiz7 (2026-11-04), y el motivo es de peso: la funcion viene APAGADA de fabrica, asi que un
 *  interruptor escondido equivale a una funcion que nadie enciende.
 *
 * ⚠️ DOS CASILLAS, UNA SOLA VERDAD. Por eso encender y apagar pasa SIEMPRE por aqui y nunca
 *    escribiendo el localStorage a mano desde cada pantalla:
 *
 *    1. `localStorage` NO avisa a nadie dentro de la MISMA ventana —el evento `storage` solo salta
 *       entre pestanas—, asi que la otra casilla se quedaria con el valor viejo hasta que algo la
 *       re-renderizara. Una casilla que ensena lo contrario de la verdad es peor que no tenerla.
 *       De ahi el evento propio, que es el mismo patron que ya usa el overlay.
 *    2. La ventana hay que ENCENDERLA o APAGARLA de verdad, no solo apuntar el ajuste.
 */
import { invoke } from "@tauri-apps/api/core";

/** Lo dispara `aplicarMinimapa`. Cada casilla lo escucha y vuelve a leer el ajuste. */
export const EVENTO_MINIMAPA = "koru-minimapa-changed";

export function minimapaEncendido(): boolean {
  return localStorage.getItem("koru-minimapa") === "1";
}

function posGuardada(): { x: number; y: number } | null {
  try {
    return JSON.parse(localStorage.getItem("koru-minimapa-pos") || "null");
  } catch {
    return null;
  }
}

/** Enciende o apaga el minimapa: guarda el ajuste, mueve la ventana de verdad y avisa a la otra
 *  casilla. `lado` solo hace falta cuando se cambia el tamano desde Ajustes.
 *
 *  ⚠️ SIN `.catch(() => {})`: un catch vacio aqui es exactamente lo que escondio durante dias que
 *     al overlay le faltaba una capacidad. Si falla, que se vea en consola. */
export function aplicarMinimapa(encendido: boolean, lado?: number): void {
  localStorage.setItem("koru-minimapa", encendido ? "1" : "0");
  const pos = posGuardada();
  void invoke("minimapa_enable", {
    enabled: encendido,
    lado: lado ?? Number(localStorage.getItem("koru-minimapa-lado") ?? 250),
    x: pos?.x ?? null,
    y: pos?.y ?? null,
  }).catch((err) => console.error("[minimapa] minimapa_enable fallo:", err));
  window.dispatchEvent(new Event(EVENTO_MINIMAPA));
}
