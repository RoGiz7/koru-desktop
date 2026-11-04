import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Overlay } from "./overlay";
import { MinimapaVentana } from "./minimapaVentana";

// Las ventanas SECUNDARIAS —el overlay de avisos y el minimapa, las dos flotando sobre el juego—
// cargan este MISMO bundle, así que hay que decidir aquí qué se monta. La bifurcación va arriba del
// todo a propósito: si montara App, la ventanita arrancaría el auto-sync, abriría la BD y pediría a
// ESI — un segundo Koru entero corriendo detrás de una caja de 250 px.
// Ver `overlay.tsx` y `minimapaVentana.tsx`.
//
// Se mira la ETIQUETA de la ventana, y las dos secundarias van en tauri.conf.json SIN `url`.
//
// ⚠️ NO devolver el `"url": "index.html#overlay"`: Tauri trata ese valor como una RUTA DE FICHERO
// (PathBuf), así que busca un archivo llamado literalmente `index.html#overlay`. No existe → la
// ventana carga EN BLANCO, y al ser transparente y sin bordes eso se ve exactamente igual que si no
// existiera: el aviso «sonaba pero no aparecía en ninguna parte». Cazado en vivo el 2026-08-05.
// Sin `url` carga el index normal y aquí se decide quién es quién.
type Quien = "main" | "overlay" | "minimapa";

let quien: Quien = "main";
try {
  const etiqueta = getCurrentWindow().label;
  quien = etiqueta === "overlay" ? "overlay" : etiqueta === "minimapa" ? "minimapa" : "main";
} catch {
  // Fuera de Tauri (p. ej. `vite dev` en el navegador) no hay ventana: vale el hash, y si tampoco
  // lo hay, se monta la app normal.
  quien =
    window.location.hash === "#overlay"
      ? "overlay"
      : window.location.hash === "#minimapa"
        ? "minimapa"
        : "main";
}

// Marca la ventana para que su hoja de estilo pueda acotar sus reglas globales (fondo transparente,
// sin scroll, cursor propio). Sin esta clase, ese CSS —que viaja en el mismo bundle porque el
// import es estático— se le aplicaba también a la ventana principal y la rompía entera.
if (quien === "overlay") document.documentElement.classList.add("koru-overlay");
if (quien === "minimapa") document.documentElement.classList.add("koru-minimapa");

// El ErrorBoundary va POR FUERA de StrictMode: si lo que falla es App al montar, queremos verlo
// igual. Sin esto, cualquier error deja la ventana en negro y sin explicación (ver ErrorBoundary).
// En las secundarias importa el doble: una ventana transparente que no pinta no se distingue de una
// ventana que no existe, así que un error mudo ahí te manda a depurar el sitio equivocado.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  quien === "overlay" ? (
    <ErrorBoundary>
      <Overlay />
    </ErrorBoundary>
  ) : quien === "minimapa" ? (
    <ErrorBoundary>
      <MinimapaVentana />
    </ErrorBoundary>
  ) : (
    <ErrorBoundary>
      <React.StrictMode>
        <App />
      </React.StrictMode>
    </ErrorBoundary>
  ),
);
