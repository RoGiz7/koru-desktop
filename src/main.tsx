import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Overlay } from "./overlay";

// La ventana de OVERLAY (avisos flotantes sobre el juego) carga este MISMO bundle, así que hay que
// decidir aquí qué se monta. La bifurcación va arriba del todo a propósito: si montara App, la
// ventanita del aviso arrancaría el auto-sync, abriría la BD y pediría a ESI — un segundo Koru
// entero corriendo detrás de una caja de 460×132. Ver `overlay.tsx`.
//
// Se mira la ETIQUETA de la ventana, y la ventana `overlay` de tauri.conf.json va SIN `url`.
//
// ⚠️ NO devolver el `"url": "index.html#overlay"`: Tauri trata ese valor como una RUTA DE FICHERO
// (PathBuf), así que busca un archivo llamado literalmente `index.html#overlay`. No existe → la
// ventana carga EN BLANCO, y al ser transparente y sin bordes eso se ve exactamente igual que si no
// existiera: el aviso «sonaba pero no aparecía en ninguna parte». Cazado en vivo el 2026-08-05.
// Sin `url` carga el index normal y aquí se decide quién es quién.
let esOverlay = false;
try {
  esOverlay = getCurrentWindow().label === "overlay";
} catch {
  // Fuera de Tauri (p. ej. `vite dev` en el navegador) no hay ventana: se monta la app normal.
  esOverlay = window.location.hash === "#overlay";
}

// Marca la ventana del overlay para que `overlay.css` pueda acotar sus reglas globales (fondo
// transparente, sin scroll, cursor en mano). Sin esta clase, ese CSS —que viaja en el mismo bundle
// porque el import es estático— se le aplicaba también a la ventana principal y la rompía entera.
if (esOverlay) document.documentElement.classList.add("koru-overlay");

// El ErrorBoundary va POR FUERA de StrictMode: si lo que falla es App al montar, queremos verlo
// igual. Sin esto, cualquier error deja la ventana en negro y sin explicación (ver ErrorBoundary).
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  esOverlay ? (
    <ErrorBoundary>
      <Overlay />
    </ErrorBoundary>
  ) : (
    <ErrorBoundary>
      <React.StrictMode>
        <App />
      </React.StrictMode>
    </ErrorBoundary>
  ),
);
