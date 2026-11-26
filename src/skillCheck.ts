// El comprobador de skills del visor de fits («¿puedes pilotar este fit?»). Lo usan Fiteos y la nave
// abierta en Assets: los dos pasan por `FitWheel` en fit.tsx, y FitWheel pasa por aquí.
//
// ★ «NO LO CONOZCO» NO ES «NO PIDE NADA» (26-11, tercer tiempo de los huérfanos de public/).
//   Antes, un tipo que no estaba en `skill_reqs.json` se saltaba (`if (!rs) continue`) y contaba como
//   «no pide nada»: con un SDE nuevo, el visor decía «puedes pilotarlo» de un módulo que Koru no
//   había visto nunca. Ahora el catálogo distingue los tres casos (ver `extract_skill_reqs.py`):
//     `[[skill, nivel]…]` pide eso · `[]` lo conoce y no pide nada · sin clave: NO LO CONOCE.
//
// ⚠️ Solo lo MONTADO (la nave y lo que va en una ranura) puede dejar el veredicto en «no se sabe».
//    Los drones y la bodega se miran igual si se conocen, pero uno desconocido va aparte, a
//    `sinComprobar`, sin tocar el veredicto: en la bodega cabe cualquier cosa —mineral, combustible
//    de salto, PLEX, planetarios— que no se fitea y no está en el catálogo, y si contara, casi
//    cualquier nave con carga saldría «no se sabe» (decidido con RoGiz7 el 26-11).
//
// Vive fuera del componente para poder probarlo sin montar la pantalla: verificar_skillcheck.mjs.

export type Catalogo = Record<string, [number, number][]>;

/** Un tipo del fit. `montado` = la nave o algo que va en una ranura (alta, media, baja, rig,
 *  subsistema). Lo demás —drones, cazas, carga— no puede dejar el veredicto en «no se sabe». */
export type ItemFit = { type_id: number; name: string; montado: boolean };

/** `puede` · `faltan` (le faltan skills de lo que sí conoce) · `no_se_sabe` (hay algo montado que
 *  Koru no conoce). Tres valores, no un booleano: quien lo pinta hace un `switch` exhaustivo. */
export type Veredicto = "puede" | "faltan" | "no_se_sabe";

export type SkillQueFalta = { skill: number; name: string; have: number; need: number };

export type Informe = {
  veredicto: Veredicto;
  /** Las skills que faltan, de lo que SÍ se conoce. Puede haberlas también con `no_se_sabe`. */
  faltan: SkillQueFalta[];
  /** Lo montado que no está en el catálogo: por esto no se puede afirmar nada. Sin repetir. */
  desconocidos: { type_id: number; name: string }[];
  /** Drones o carga que no están en el catálogo: no se han mirado, y no cambian el veredicto. */
  sinComprobar: { type_id: number; name: string }[];
};

/** ★ EL VEREDICTO. `null` si falta el catálogo o las skills del personaje: todavía no se puede
 *  decir nada, ni «puede» ni «no se sabe» de todo (un catálogo cargando no es un catálogo vacío). */
export function comprobarSkills(
  items: ItemFit[],
  catalogo: Catalogo | null | undefined,
  skills: Record<number, number> | null | undefined,
  nombreSkill: (skill: number) => string,
): Informe | null {
  if (!catalogo || !skills) return null;
  const need = new Map<number, number>(); // skill → nivel más alto que pide algo del fit
  const desconocidos = new Map<number, string>();
  const sinComprobar = new Map<number, string>();
  for (const it of items) {
    const rs = catalogo[String(it.type_id)];
    if (rs === undefined) {
      (it.montado ? desconocidos : sinComprobar).set(it.type_id, it.name);
      continue;
    }
    for (const [sid, lvl] of rs) need.set(sid, Math.max(need.get(sid) ?? 0, lvl));
  }
  // Un tipo puede estar montado y además en la bodega: si está montado, manda «desconocido».
  for (const id of desconocidos.keys()) sinComprobar.delete(id);
  const faltan: SkillQueFalta[] = [];
  for (const [sid, lvl] of need) {
    // ⚠️ El nivel 0 se queda como estaba: una skill que no tienes cuenta como nivel 0, así que un
    //    requisito de nivel 0 nunca sale. Ver el HANDOFF: está por decidir con el número delante.
    const have = skills[sid] ?? 0;
    if (have < lvl) faltan.push({ skill: sid, name: nombreSkill(sid), have, need: lvl });
  }
  faltan.sort((a, b) => a.name.localeCompare(b.name));
  const lista = (m: Map<number, string>) => [...m].map(([type_id, name]) => ({ type_id, name }));
  return {
    veredicto: desconocidos.size > 0 ? "no_se_sabe" : faltan.length > 0 ? "faltan" : "puede",
    faltan,
    desconocidos: lista(desconocidos),
    sinComprobar: lista(sinComprobar),
  };
}
