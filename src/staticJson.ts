// Los JSON ESTÁTICOS de la app (SDE volcado a `public/`), pedidos UNA vez por sesión.
//
// ★ POR QUÉ EXISTE. Estos ficheros viajan dentro de la app y no cambian mientras corre, pero se
//   pedían con un `fetch` a pelo desde dentro de un `useEffect`. Un efecto se vuelve a ejecutar
//   cada vez que su vista se monta, así que **volver a una sección volvía a descargar sus JSON
//   enteros**. No es un caso raro: Industria se traía ~3,5 MB en cada visita (bp_industry 850 KB,
//   market_types 1,1 MB, neweden 1 MB, type_volumes 323 KB…) y Comercio o Notas ~1 MB.
//
// ★ EL ARREGLO VA AQUÍ, NO EN CADA SECCIÓN. La lección de `buildLootIndex` (2026-08-26): cuando
//   lo que se repite vive en una función compartida, se arregla en el origen y se arregla para
//   todos los llamantes a la vez. Aquí es lo mismo, pero para el fichero en bruto.
//
// ★ QUÉ NO ES. No es una caché de datos vivos: aquí SOLO entra lo que viene con la app. Nada que
//   dependa de ESI, de la BD o de lo que el usuario tenga guardado — eso se re-pide siempre,
//   que es el trato del patrón de carga de secciones.
const cache = new Map<string, Promise<unknown>>();

/** El JSON de `url` (ruta de `public/`), memoizado para toda la sesión.
 *  Si la lectura falla, devuelve `fallback` y **no** guarda el fallo: un error de una vez no
 *  puede dejar a la sección sin su catálogo para el resto de la sesión. */
export function loadJson<T>(url: string, fallback: T): Promise<T> {
  const previo = cache.get(url);
  if (previo) return previo as Promise<T>;
  const p = fetch(url)
    .then((r) => r.json() as Promise<T>)
    .catch(() => {
      cache.delete(url); // que el próximo llamante lo vuelva a intentar
      return fallback;
    });
  cache.set(url, p);
  return p;
}
