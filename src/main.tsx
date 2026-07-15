import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";

// El ErrorBoundary va POR FUERA de StrictMode: si lo que falla es App al montar, queremos verlo
// igual. Sin esto, cualquier error deja la ventana en negro y sin explicación (ver ErrorBoundary).
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <ErrorBoundary>
    <React.StrictMode>
      <App />
    </React.StrictMode>
  </ErrorBoundary>,
);
