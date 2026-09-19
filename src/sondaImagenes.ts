// ★ LA SONDA DEL SERVIDOR DE IMÁGENES DE EVE (2026-09-19).
//
// Reporte real: un piloto instaló la 0.52.0 con el `.exe` (NSIS) y NO le salía NINGÚN icono
// dentro de Koru; con el `.msi`, todo bien a la primera. No era culpa del instalador: los dos
// instalan el mismo binario. Lo que pasaba es que **ESI va por Rust (reqwest) y las imágenes por
// el WEBVIEW** — dos caminos de red distintos —, y algo (antivirus o cortafuegos, con un ejecutable
// sin firmar en `%LOCALAPPDATA%`, que es donde instala NSIS) le cortaba el segundo. Por eso le
// funcionaba TODO menos las imágenes. Y Koru no decía nada: se quedaba con los huecos vacíos y
// parecía roto. Lo que falla en silencio, falla dos veces.
//
// 🚨 LA SONDA ES UN `<img>`, NUNCA UN `fetch`. El CSP de `tauri.conf.json` permite
//    `images.evetech.net` en `img-src` pero NO en `connect-src`: un `fetch` fallaría SIEMPRE, también
//    en una máquina sana, y el aviso saltaría para todo el mundo — una alarma que se equivoca es la
//    que deja de leerse. El `<img>` va por el mismo camino que los iconos de verdad, así que mide
//    exactamente lo que queremos saber.
//
// Acotado: el updater usa el MSI, así que quien se actualiza solo acaba en `Program Files`. Esto
// solo le puede pasar a quien instala A MANO eligiendo el `.exe` — normalmente alguien nuevo, en su
// primer minuto con Koru. Por eso el aviso ofrece el `.msi` y las excepciones del antivirus, y no
// solo «prueba el MSI»: a quien ya lo instaló así no le serviría.
import { useEffect, useRef, useState } from "react";

/** Un icono pequeño que existe seguro: el Rifter (587), el mismo que la Bitácora usa para kills. */
const URL_SONDA = "https://images.evetech.net/types/587/icon?size=32";
/** Cuánto se espera antes de dar la carga por fallida. Un antivirus que corta no siempre devuelve
 *  error: a veces simplemente no contesta. */
const TIMEOUT_MS = 15_000;
/** Mientras falla, se reintenta cada minuto: si el piloto añade la excepción, el aviso se va solo. */
const REINTENTO_MS = 60_000;

export type EstadoImagenes = "probando" | "ok" | "sin-acceso";

/** Comprueba UNA vez si el WebView alcanza el servidor de imágenes. Resuelve siempre; nunca lanza. */
export function sondearImagenes(): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    let hecho = false;
    const fin = (ok: boolean) => {
      if (hecho) return;
      hecho = true;
      clearTimeout(t);
      img.onload = null;
      img.onerror = null;
      resolve(ok);
    };
    const t = setTimeout(() => fin(false), TIMEOUT_MS);
    img.onload = () => fin(true);
    img.onerror = () => fin(false);
    // Cache-buster: una copia cacheada de otra sesión diría «ok» aunque hoy no haya red hasta ahí.
    img.src = `${URL_SONDA}&koru=${Date.now()}`;
  });
}

/** El estado del servidor de imágenes para la interfaz, con reintento automático mientras falla
 *  y `reintentar()` para el botón. Se sondea una vez al arrancar; si va bien no se vuelve a tocar
 *  (una imagen cada minuto para nada sería ruido en la red de quien no tiene el problema). */
export function useSondaImagenes(): { estado: EstadoImagenes; reintentar: () => void } {
  const [estado, setEstado] = useState<EstadoImagenes>("probando");
  const vivo = useRef(true);
  const sondear = async () => {
    setEstado("probando");
    const ok = await sondearImagenes();
    if (vivo.current) setEstado(ok ? "ok" : "sin-acceso");
  };
  useEffect(() => {
    vivo.current = true;
    void sondear();
    return () => {
      vivo.current = false;
    };
  }, []);
  useEffect(() => {
    if (estado !== "sin-acceso") return;
    const t = setTimeout(() => void sondear(), REINTENTO_MS);
    return () => clearTimeout(t);
  }, [estado]);
  return { estado, reintentar: () => void sondear() };
}
