// Red de seguridad de la UI.
//
// POR QUÉ EXISTE: sin esto, un solo error en cualquier vista desmonta el árbol de React entero y
// deja la ventana EN NEGRO, sin una palabra. En dev se ve el error en la consola; en la build de
// producción los DevTools están desactivados, así que el usuario (y nosotros) nos quedamos con una
// pantalla negra y cero información. Pasó con el filtro de fechas de Minería: en dev funcionaba, en
// release se iba a negro, y no había forma de saber por qué.
//
// Es el mismo remedio que aplicamos al intel en la 0.27.1: no arregla la causa, arregla la CEGUERA.
// Un fallo que no se puede ver no se puede corregir — ni por nosotros ni por quien nos lo reporte.
import React from "react";

type Props = { children: React.ReactNode };
type State = { error: Error | null; info: string | null };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // A la consola también, por si hay DevTools abiertos (dev) o alguien mira el log.
    console.error("[Koru] error de render:", error, info.componentStack);
    this.setState({ info: info.componentStack ?? null });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    // Ojo: este bloque NO usa tr() ni nada de la app a propósito. Si lo que ha reventado es la
    // propia i18n, la pantalla de error no puede reventar con ella.
    const dump = `${error.name}: ${error.message}\n\n${error.stack ?? ""}\n\nComponentes:${info ?? " (sin traza)"}`;
    return (
      <div className="err-boundary">
        <h1>Koru ha tropezado</h1>
        <p>
          Algo ha fallado al pintar esta pantalla. El resto de la app y tus datos están intactos:
          esto es un error de la interfaz, no de tu base de datos.
        </p>
        <p>
          Si nos lo cuentas con el detalle de abajo, lo podemos arreglar. Es exactamente lo que
          necesitamos ver.
        </p>
        <div className="err-actions">
          <button onClick={() => navigator.clipboard?.writeText(dump)}>
            Copiar el detalle
          </button>
          <button onClick={() => this.setState({ error: null, info: null })}>
            Reintentar
          </button>
          <button onClick={() => location.reload()}>Recargar Koru</button>
        </div>
        <pre className="err-dump">{dump}</pre>
      </div>
    );
  }
}
