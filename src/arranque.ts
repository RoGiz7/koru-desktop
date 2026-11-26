// La carrera de arranque, en UN solo sitio. El `setup()` de Rust registra el AppState DESPUÉS del
// trabajo pesado (mudanza, BD, cliente HTTP) y la webview ya está llamando mientras tanto: una
// llamada que llega antes contesta «state not managed». Ver `refresh()` en App.tsx para la historia.
//
// ⚠️ Vive aquí y no copiado en cada sitio que reintenta: estuvo duplicado en App.tsx y useIntel.ts
//    con un comentario pidiendo que se cambiaran a la vez, y dos verdades acaban siempre igual.

/** Intentos ante la carrera de arranque. Con 250 ms doblando entre ellos (250, 500, 1000, 2000,
 *  4000) son ~7,75 s: corto al principio para que un arranque normal no se note, largo al final
 *  para no rendirse en una máquina lenta. */
export const REINTENTOS_ARRANQUE = 6;
