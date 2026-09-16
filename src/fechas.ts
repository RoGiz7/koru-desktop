// Ayudas de FECHA puras, sin ninguna dependencia. Módulo HOJA a propósito.
//
// ★ POR QUÉ EXISTE ESTE FICHERO: `weekKey` vivía en `format.ts`, que importa `./i18n`. Eso hace que
//   cualquier script de pruebas que necesite agrupar por semana se traiga detrás el idioma y, con
//   él, media aplicación — y Node, que sabe quitar los tipos de un `.ts` pero no resuelve imports
//   sin extensión como Vite, se planta con `ERR_MODULE_NOT_FOUND` en mitad de la cadena.
//
//   La alternativa era copiar la cuenta de la semana ISO en el módulo que la necesita: DOS VERDADES
//   de la misma semana, que es el fallo del que llevo registro. Así hay una sola definición y se
//   puede probar sin montar la app.
//
//   `format.ts` la re-exporta, así que los siete sitios que ya la usaban siguen igual.

/** Semana ISO-8601 como `2026-S38`. El año es el de la semana, no el del día: el 2026-01-01 puede
 *  caer en la S53 de 2025, y agrupar por el año del día partiría esa semana en dos. */
export function weekKey(date: string): string {
  const dt = new Date(date + "T00:00:00Z");
  const dayNr = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dayNr + 3); // jueves de esa semana
  const firstThursday = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      (dt.getTime() - firstThursday.getTime()) / 86400000 / 7 -
        ((firstThursday.getUTCDay() + 6) % 7) / 7,
    );
  return `${dt.getUTCFullYear()}-S${String(week).padStart(2, "0")}`;
}
