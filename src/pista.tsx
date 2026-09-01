// PISTAS DE SECCIÓN — la otra mitad de la guía de inicio.
//
// ★ LA DIFERENCIA CON LA GUÍA. La guía te orienta ANTES de entrar; la pista te ayuda **cuando ya
//   estás dentro y no encuentras la puerta**. Por eso una pista NO lleva a otro sitio: ya estás
//   ahí. Su disciplina es otra:
//
//   ★★ UNA PISTA TIENE QUE ESTAR PEGADA A LA COSA DE LA QUE HABLA. La proximidad sustituye al
//      botón que en la guía era obligatorio. Una pista al principio de la sección hablando de algo
//      que está abajo del todo no es una pista: es un párrafo.
//
// ★ Y UNA POR SECCIÓN, NI DOS. Con quince secciones son quince líneas. Permitir tres por sección
//   convierte cada pantalla en un tutorial y deja de leerlas justo quien las necesita. La
//   restricción obliga a la decisión útil: *¿cuál es la ÚNICA cosa que aquí no se encuentra?*
//
// ★ DÓNDE VIVE CADA UNA: en el fichero de SU sección, nunca en una lista central. Una pista
//   caducada es PEOR que ninguna —manda a un botón que ya no existe y quema la confianza en todas
//   las demás—, y viviendo al lado del código que describe, quien cambie la sección la ve.
import { useEffect, useState } from "react";
import { tr } from "./i18n";

const CLAVE_GLOBAL = "koru-pistas"; // "off" = todas calladas
const EVENTO = "koru-pistas-cambio";
const clave = (id: string) => `koru-pista-${id}`;

/** Todo lo que toca el almacenamiento va con red: en una ventana privada o con el sitio
 *  bloqueado, `localStorage` no falla devolviendo null — LANZA. Y una pista no puede tumbar la
 *  sección que decora. */
function leer(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function escribir(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* sin almacenamiento, la pista simplemente vuelve a salir. Nadie pierde nada. */
  }
}

export function pistasActivas(): boolean {
  return leer(CLAVE_GLOBAL) !== "off";
}

/** Enciende o apaga TODAS las pistas.
 *
 *  ⚠️ Al ENCENDER se borran también las que se callaron una a una. Sin esto habría una trampa
 *  silenciosa: apagas las pistas, meses después las vuelves a encender, no aparece ninguna —
 *  porque cada una seguía callada por su cuenta— y el interruptor parece roto. */
export function setPistasActivas(v: boolean) {
  escribir(CLAVE_GLOBAL, v ? null : "off");
  if (v) {
    try {
      const fuera: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("koru-pista-")) fuera.push(k);
      }
      for (const k of fuera) localStorage.removeItem(k);
    } catch {
      /* nada que limpiar si no hay almacenamiento */
    }
  }
  // Las secciones abiertas se enteran sin recargar: si no, apagarlas desde Ajustes no tendría
  // efecto visible hasta cambiar de pestaña, y parecería que el interruptor no hace nada.
  try {
    window.dispatchEvent(new Event(EVENTO));
  } catch {
    /* entorno sin window: nada que avisar */
  }
}

/** Una pista. `id` es su nombre estable: si cambia, la pista vuelve a salirle a quien ya la calló. */
export function Pista({ id, children }: { id: string; children: React.ReactNode }) {
  const [visible, setVisible] = useState(() => pistasActivas() && leer(clave(id)) !== "1");

  useEffect(() => {
    const on = () => setVisible(pistasActivas() && leer(clave(id)) !== "1");
    window.addEventListener(EVENTO, on);
    return () => window.removeEventListener(EVENTO, on);
  }, [id]);

  if (!visible) return null;
  return (
    <div className="pista">
      <span className="pista-ic">💡</span>
      <span className="pista-tx">{children}</span>
      <button
        className="pista-x"
        onClick={() => {
          escribir(clave(id), "1");
          setVisible(false);
        }}
        title={tr("No volver a mostrar esta pista")}
      >
        ×
      </button>
    </div>
  );
}
