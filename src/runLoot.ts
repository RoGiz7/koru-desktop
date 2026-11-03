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

/** De dónde sale el valor de una línea. Se guarda para que la ficha diga de dónde salió cada cifra
 *  y no se lea una estimación como un dato del juego. */
export const ISK_SRC = {
  /** La columna «Precio estimado» del pegado del juego (media de New Eden). Desde el 2026-10-24
   *  solo se usa para lo que NO tiene precio en Jita: ver `lineasDeBotin`. */
  pegado: "pegado",
  /** Precio que busca Koru: lo que te pagarían ahora en Jita (mejor orden de compra,
   *  `get_hub_buy_prices`; si no hay órdenes, Rust cae a la media de mercado). */
  koru: "koru",
  /** Copia de plano: NO se valora, y por eso lleva marca propia en vez de quedarse en blanco.
   *  Un BPC y su BPO comparten typeID y un BPC no se vende en mercado, así que cualquier precio de
   *  mercado aplicado a una copia es el precio de OTRA cosa. */
  bpc: "bpc",
  /** Sin valor: ni Jita ni el pegado le dieron precio. */
  ninguno: "",
} as const;

/** Convierte lo parseado en las líneas que se guardan. **El total del modal ES la suma de estas
 *  líneas** (`sumaDeLineas`): una sola cuenta, así la ficha y el histórico no pueden discrepar.
 *
 *  ★ CRITERIO ÚNICO (decisión de RoGiz7, 2026-10-24): **todo se valora a lo que te pagarían ahora
 *  en Jita.** Antes, si el pegado traía «Precio estimado» se usaba ese (la media de New Eden) y si no,
 *  Jita: el MISMO botín valía 142 M o 86 M según copiaras en vista de lista o de iconos. Ahora el
 *  total no depende de cómo copies.
 *
 *  ⚠️ El orden de las reglas:
 *   1. **Blueprint primero**, aunque tenga precio: un BPC no se vende en mercado.
 *   2. **Precio de Jita** → por UNIDAD, así que se multiplica por `qty`.
 *   3. **Precio del pegado** → solo si Jita no dio nada (objetos sin órdenes ni media). Es el valor
 *      de la LÍNEA, no unitario.
 *   4. Nada: la línea se guarda sin valor. NO se descarta — es la pista para arreglar el troceador.
 *
 *  `precios` son unitarios. `bpSet` puede ser null (aún cargando `bp_tree.json`): entonces nada se
 *  considera blueprint. */
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
    } else if (it.typeId != null && precios[it.typeId]) {
      isk = precios[it.typeId] * it.qty;
      src = ISK_SRC.koru;
    } else if (it.iskFromPaste != null) {
      isk = it.iskFromPaste;
      src = ISK_SRC.pegado;
    }
    return { type_id: it.typeId, name: it.name, qty: it.qty, isk, isk_src: src };
  });
}

/** Revalora líneas YA GUARDADAS con precios nuevos de Jita («Revalorar», 2026-10-24). Mismo criterio
 *  que `lineasDeBotin`: los BPC no se tocan; lo que tenga precio de Jita pasa a valer eso; lo que no,
 *  se queda como estaba (mejor el precio del juego que tenía que dejarlo en blanco). */
export function revalorarLineas(lineas: RunLootLine[], precios: Record<number, number>): RunLootLine[] {
  return lineas.map((l) => {
    if (l.isk_src === ISK_SRC.bpc || l.type_id == null) return l;
    const p = precios[l.type_id];
    return p ? { ...l, isk: p * l.qty, isk_src: ISK_SRC.koru } : l;
  });
}

/** ¿Hay líneas que Koru reconoce y se quedaron sin precio? Es lo que activa «Revalorar». */
export function hayLineasSinPrecio(lineas: RunLootLine[]): boolean {
  return lineas.some((l) => l.type_id != null && l.isk == null && l.isk_src !== ISK_SRC.bpc);
}

/** La suma de las líneas guardadas. Existe para poder comprobar que cuadra con el total del modal:
 *  el invariante es que guardar el detalle no cambie la cifra que el usuario aceptó. */
export function sumaDeLineas(lineas: RunLootLine[]): number {
  return lineas.reduce((a, l) => a + (l.isk ?? 0), 0);
}
