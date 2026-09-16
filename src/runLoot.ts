// ★★ EL BOTÍN DE UNA RUN, OBJETO A OBJETO — de lo pegado a lo que se guarda.
//
// Idea de RoGiz7 (2026-09-16). Hasta ahora el pegado del inventario se valoraba y se TIRABA: de una
// run quedaba el total y una nota. Ver el comentario de `run_loot` en `schema.sql` para por qué es
// una tabla hija y no una nota del sistema de notas.
//
// ★ POR QUÉ ESTE FICHERO EXISTE, y no es una función más dentro del modal: el valor de cada línea
//   tiene que sumar EXACTAMENTE el total que el modal enseña en pantalla. Si no, la ficha de
//   detalle diría un número y el histórico otro sobre el mismo botín — dos verdades. Eso hay que
//   PROBARLO, y para probarlo la cuenta tiene que salir del componente.
//   Módulo HOJA (solo `import type`, que Node borra) para que el script pueda cargarlo tal cual.
//   Ver `scripts/verificar_run_loot.mjs`.
import type { LootItem } from "./lootPaste";

/** Una línea tal y como la guarda Rust (`RunLootRow`). `snake_case` a propósito: viaja a `invoke`
 *  y volver a nombrarla en el camino sería una traducción más que mantener. */
export type RunLootLine = {
  type_id: number | null;
  name: string;
  qty: number;
  isk: number | null;
  isk_src: string;
};

/** De dónde sale el valor de una línea. Se guarda porque el modal YA distingue las dos primeras en
 *  pantalla, y guardar la cifra sin la procedencia convertiría una estimación de Koru en un dato
 *  del juego. */
export const ISK_SRC = {
  /** La columna «Precio estimado» del pegado del juego. */
  pegado: "pegado",
  /** Búsqueda local de Koru (`get_type_prices`), cuando el pegado no trae precios. */
  koru: "koru",
  /** Copia de plano: NO se valora, y por eso lleva marca propia en vez de quedarse en blanco.
   *  Un BPC y su BPO comparten typeID y un BPC no se vende en mercado, así que cualquier precio de
   *  mercado aplicado a una copia es el precio de OTRA cosa. El modal ya lo descuenta del total;
   *  esta marca deja escrito POR QUÉ esa línea no vale nada, que si no se lee como un fallo. */
  bpc: "bpc",
  /** Sin valor: ni el pegado lo traía ni Koru supo resolverlo. */
  ninguno: "",
} as const;

/** Convierte lo parseado en las líneas que se guardan.
 *
 *  ⚠️ EL ORDEN DE LAS REGLAS NO ES CASUAL, y reproduce EXACTAMENTE lo que hace el modal al calcular
 *  su total (`computed = totalFromPaste − bpIskDelPegado + fallbackIsk`):
 *   1. **Blueprint primero**, aunque el pegado le pusiera precio: el modal se lo descuenta del
 *      total, así que valorarlo aquí haría que la suma de las líneas fuera MAYOR que el total que
 *      vio el usuario. Este caso va antes que el del pegado justo por eso.
 *   2. Precio del pegado → tal cual (es el valor de la LÍNEA, no unitario).
 *   3. Precio local de Koru → **por unidad**, así que se multiplica por `qty`. Confundir esto sería
 *      contar una pila de 12.000 tritanios como si fuera uno.
 *   4. Lo que no cae en ninguna: se guarda sin valor. La línea NO se descarta — perder lo que Koru
 *      no supo leer es tirar la única pista para arreglar el troceador.
 *
 *  `precios` son unitarios, tal y como los devuelve `get_type_prices`. `bpSet` puede ser null (aún
 *  cargando `bp_tree.json`): entonces nada se considera blueprint, igual que en el modal. */
export function lineasDeBotin(
  items: LootItem[],
  bpSet: Set<number> | null,
  precios: Record<number, number>,
): RunLootLine[] {
  const esBp = (tid: number | null) => tid != null && (bpSet?.has(tid) ?? false);
  return items.map((it) => {
    let isk: number | null = null;
    let src: string = ISK_SRC.ninguno;
    if (esBp(it.typeId)) {
      src = ISK_SRC.bpc;
    } else if (it.iskFromPaste != null) {
      isk = it.iskFromPaste;
      src = ISK_SRC.pegado;
    } else if (it.typeId != null && precios[it.typeId]) {
      isk = precios[it.typeId] * it.qty;
      src = ISK_SRC.koru;
    }
    return { type_id: it.typeId, name: it.name, qty: it.qty, isk, isk_src: src };
  });
}

/** La suma de las líneas guardadas. Existe para poder comprobar que cuadra con el total del modal:
 *  el invariante es que guardar el detalle no cambie la cifra que el usuario aceptó. */
export function sumaDeLineas(lineas: RunLootLine[]): number {
  return lineas.reduce((a, l) => a + (l.isk ?? 0), 0);
}
