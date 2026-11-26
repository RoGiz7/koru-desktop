// La lista de personajes de la barra de arriba: qué va en la fila y qué se recoge tras el «+N».
//
// Por qué existe: con veinte personajes la barra era un muro de caras sin nombre que además crecía
// hacia abajo (`flex-wrap`), y no se sabía cuál estaba elegido. Lo pidió un usuario.
//
// Vive fuera de App.tsx para poder probarlo sin montar la app: `scripts/verificar_lista_personajes.mjs`.

/** Con MÁS de estos, la fila solo lleva los conectados y el elegido; el resto va tras el «+N».
 *  Con estos o menos, la barra es como siempre: todos a la vista. Un solo sitio para el número. */
export const UMBRAL_RECOGER = 10;

export type PjBarra = { character_id: number; name: string };
/** Lo que se sabe de un personaje en vivo. `online: null` = NO SE SABE (sin permiso de ubicación, o
 *  aún sin sondear): no es «conectado» ni «desconectado». */
export type PjVivo = {
  online: boolean | null;
  corporation_name?: string | null;
  system_name?: string | null;
  ship_type_name?: string | null;
};

/** ★ Orden alfabético SIN DISTINGUIR MAYÚSCULAS, para la fila y para la lista.
 *  Los personajes llegan con el `ORDER BY name` de SQLite, que compara byte a byte: un nombre que
 *  empieza por minúscula salía detrás de la Z. Se ordena aquí y no en la consulta porque esa es de
 *  la carga de personajes, que no se toca. A igualdad («alba» / «Alba»), por id: siempre el mismo. */
export function ordenar<T extends PjBarra>(personajes: T[]): T[] {
  return [...personajes].sort(
    (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "accent" }) || a.character_id - b.character_id,
  );
}

export type Reparto = {
  /** Ids en la fila, en orden alfabético sin distinguir mayúsculas (`ordenar`). */
  fila: number[];
  /** Ids recogidos tras el botón, en el mismo orden. Vacío = no hay botón. */
  recogidos: number[];
  /** ¿Alguno de los recogidos tiene accesos sin conceder? Entonces el BOTÓN lleva la marca: recoger
   *  no puede tapar un aviso que antes se veía porque todos los retratos estaban a la vista. */
  avisoRecogidos: boolean;
};

/** ★ QUÉ VA EN LA FILA.
 *  · Con `umbral` o menos: todos, sin botón (como siempre).
 *  · Con más: los conectados (`online === true`, y SOLO true) más el elegido, conectado o no. El
 *    resto, recogido. `null` va al resto: no se sabe, y no se pinta como conectado.
 *  · `elegido = null` es la vista Global: no hay elegido que sacar a la fila. */
export function repartir(
  personajes: PjBarra[],
  vivo: (id: number) => PjVivo | undefined,
  elegido: number | null,
  faltaAcceso: (id: number) => boolean,
  umbral: number = UMBRAL_RECOGER,
): Reparto {
  const orden = ordenar(personajes);
  if (orden.length <= umbral) {
    return { fila: orden.map((p) => p.character_id), recogidos: [], avisoRecogidos: false };
  }
  const fila: number[] = [];
  const recogidos: number[] = [];
  for (const p of orden) {
    const id = p.character_id;
    if (id === elegido || vivo(id)?.online === true) fila.push(id);
    else recogidos.push(id);
  }
  return { fila, recogidos, avisoRecogidos: recogidos.some(faltaAcceso) };
}

/** ¿Lleva punto verde? Solo con `online === true`. `null` (no se sabe) no lleva punto ni texto. */
export function conectado(v: PjVivo | undefined): boolean {
  return v?.online === true;
}

/** El buscador del desplegable: nombre, corporación, sistema y nave, sin distinguir mayúsculas.
 *  Vacío = todos. Mantiene el orden de entrada. */
export function filtrar<T extends PjBarra>(personajes: T[], vivo: (id: number) => PjVivo | undefined, q: string): T[] {
  const aguja = q.trim().toLocaleLowerCase();
  if (!aguja) return personajes;
  return personajes.filter((p) => {
    const v = vivo(p.character_id);
    return [p.name, v?.corporation_name, v?.system_name, v?.ship_type_name].some(
      (campo) => !!campo && campo.toLocaleLowerCase().includes(aguja),
    );
  });
}

/** Los dos grupos del desplegable, «Conectados» y «Resto» (o «Todos», si no hay conectados), cada
 *  uno en orden alfabético sin distinguir mayúsculas. Enter elige el PRIMERO de
 *  `[...conectados, ...resto]`, que es el que se ve arriba. */
export function agrupar<T extends PjBarra>(personajes: T[], vivo: (id: number) => PjVivo | undefined): { conectados: T[]; resto: T[] } {
  const conectados: T[] = [];
  const resto: T[] = [];
  for (const p of ordenar(personajes)) (conectado(vivo(p.character_id)) ? conectados : resto).push(p);
  return { conectados, resto };
}
