// Errores del backend que la pantalla tiene que DISTINGUIR, no solo enseñar.
//
// `AppError` llega al frontend como texto plano (`to_string()`), sin código. Distinguir un error de
// otro es mirar el texto, y eso solo es seguro si el texto lo fija UNA constante por lenguaje y
// nadie más lo compara. Este fichero es esa constante del lado TypeScript.

/** ⚠️ Tiene un GEMELO en Rust: `PREFIJO_FALTA_PERMISO` en `src-tauri/src/error.rs`. No se pueden
 *  separar en silencio: un test de Rust lee ESTE fichero con `include_str!` y exige esta misma línea,
 *  carácter a carácter. Si cambias uno, `cargo test` falla hasta que cambies el otro. */
export const PREFIJO_FALTA_PERMISO = "Falta permiso: ";

/** ¿Este error es «al personaje le falta el permiso (scope)»? Lo devuelve `token_with_scope` cuando
 *  el token no lleva el scope. Todo lo demás —un 502 de ESI, la red, la sesión caducada— NO lo es:
 *  decir «falta el acceso» ante un 502 manda a alguien a reloguear para nada. */
export function esFaltaPermiso(e: unknown): boolean {
  return String(e).startsWith(PREFIJO_FALTA_PERMISO);
}
