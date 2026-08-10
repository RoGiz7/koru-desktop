// Abrir enlaces externos (zKillboard, Dotlan, Ko-fi, la web de EVE) de forma que funcione en
// TODAS las plataformas.
//
// POR QUÉ NO SE USA `openUrl` DEL PLUGIN. En Linux acaba en `xdg-open`, y en un sistema sin
// navegador registrado como manejador de `https` eso devuelve un error y el clic no hace nada —
// sin aviso, sin pista, nada. Le pasó al tester con el login, y el arreglo de entonces vivía en
// Rust, en el flujo de SSO: estos diecinueve enlaces seguían muertos.
//
// Ahora todos pasan por `open_external`, que reutiliza la MISMA cadena de lanzadores del login. Y
// si aun así no se puede abrir ninguno, se aplica la regla que ya nos enseñó este bug:
// **detectar el fracaso es frágil; ofrecer siempre la salida no lo es.** Se copia el enlace al
// portapapeles y se avisa, en vez de dejar al usuario pulsando un botón que no responde.
import { invoke } from "@tauri-apps/api/core";

/** Qué hacer cuando no hay forma de abrir el navegador. Lo pone `App.tsx` para poder enseñar un
 *  toast; si nadie lo pone, al menos el enlace queda copiado. */
let avisar: ((url: string) => void) | null = null;
export function setOpenExternalFallback(f: (url: string) => void) {
  avisar = f;
}

export async function openExternal(url: string): Promise<void> {
  try {
    await invoke("open_external", { url });
  } catch {
    await navigator.clipboard?.writeText(url).catch(() => {});
    avisar?.(url);
  }
}
