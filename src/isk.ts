// ISK tecleado a mano: leerlo y volver a escribirlo. Módulo HOJA, sin dependencias.
//
// ★★ POR QUÉ LAS DOS JUNTAS, y es el motivo de que exista el fichero: **son funciones inversas**.
//    `parseIskShorthand` lee «250m» y da 250.000.000; `iskCorto` hace el camino de vuelta. Tenerlas
//    en ficheros distintos es pedir que un día se separen — y cuando se separan, el dato que sale
//    a un campo de texto no es el que vuelve.
//
//    No es hipotético: pasó el 2026-09-16 en el panel de venta de escalaciones. Precargaba
//    `precio / 1e6` («250» para 250 M), y un número sin sufijo son ISK ENTEROS, así que abrir el
//    panel y guardar sin tocar nada dejaba el precio en **250 ISK**. Un millón de veces menos, sin
//    ningún error por medio. El ida y vuelta se prueba en
//    `scripts/verificar_isk_escalaciones.mjs`, valores pequeños incluidos.
//
// ★ Y HOJA A PROPÓSITO: `parseIskShorthand` vivía en `lootPaste.ts`, que importa `./staticJson` y
//   con él media aplicación. Eso hacía imposible probar el ida y vuelta desde un script sin montar
//   la app. `lootPaste.ts` la re-exporta, así que los cinco sitios que la importaban de allí siguen
//   funcionando sin tocarlos.

/** Interpreta un valor de ISK cómodo tecleado a mano: «45m» = 45.000.000, «1,2b» = 1.200.000.000,
 *  «500k» = 500.000, o un número plano. Acepta coma o punto decimal. `null` si está vacío o no se
 *  entiende — que NO es lo mismo que cero, y por eso no devuelve 0. */
export function parseIskShorthand(s: string): number | null {
  const t = s.trim().toLowerCase().replace(/\s/g, "");
  if (!t) return null;
  const m = t.match(/^([0-9]*[.,]?[0-9]+)\s*([kmb])?$/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  if (!isFinite(n)) return null;
  const mult = m[2] === "b" ? 1e9 : m[2] === "m" ? 1e6 : m[2] === "k" ? 1e3 : 1;
  return Math.round(n * mult);
}

/** ISK → el texto corto que `parseIskShorthand` vuelve a leer como ESE MISMO número.
 *
 *  Para precargar un campo editable con un valor ya guardado. La regla: **un valor que se enseña
 *  para editar tiene que volver por la misma puerta por la que salió**, y aquí eso significa emitir
 *  el sufijo, no solo dividir.
 *
 *  `null` → cadena vacía, no «0»: un cero que el usuario no escribió es un dato inventado. */
export function iskCorto(isk: number | null | undefined): string {
  if (isk == null) return "";
  if (isk === 0) return "0";
  if (Math.abs(isk) >= 1e9) return `${isk / 1e9}b`;
  // Desde mil se emite en millones (`0.0015m` para 1.500) en vez de en «k»: el sufijo `k` existe al
  // leer, pero emitirlo obligaría a una tercera rama que también hay que probar, y `m` cubre el
  // rango entero sin perder exactitud — `parseIskShorthand` redondea al ISK.
  if (Math.abs(isk) >= 1e3) return `${isk / 1e6}m`;
  return String(isk);
}
