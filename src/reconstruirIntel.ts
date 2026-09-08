// ★★ RECONSTRUIR LOS AVISTAMIENTOS DESDE `intel_line`.
//
// # Por qué existe
//
// `intel_sightings` es DERIVADO: sale de trocear las líneas del chat. Pero solo se escribía con
// `INSERT OR IGNORE` y no tenía un solo `DELETE`, así que **cada equivocación del troceador se
// quedaba dentro para siempre**: «Lucy Lee» sin su 1, el piloto «Navy» que era media Brutix, el
// «Dee» de partir un nombre por el sistema Yona, el «G-Q» que era una puerta, el «ansi» que es un
// Ansiblex. Eran conclusiones sin premisas: no había forma de rehacerlas.
//
// Ahora que la línea cruda vive en `intel_line` (idea de RoGiz7), esto se puede tirar y rehacer con
// el troceador de hoy — y con el de mañana.
//
// # Las tres decisiones que lo hacen seguro
//
// 1. **Se trocea en el frontend, con el ÚNICO troceador que existe** (`classifyIntel`). Escribir
//    una segunda copia en Rust sería garantizar que un día divergen y nadie se entera.
// 2. **Sin ESI** (`resolve: false`). Se reprocesan cientos de miles de líneas de golpe y los ids ya
//    resueltos NO se borran al purgar, así que preguntar otra vez sería repreguntar lo que sabemos.
// 3. **Por páginas y cediendo el hilo entre ellas.** Con 826.637 líneas, hacerlo de una tacada
//    congelaría la ventana casi un minuto. Así se puede enseñar el progreso y la app respira.
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { classifyIntel, zonasDe } from "./intel";
import { loadJson } from "./staticJson";
import type { IntelLine, NeSystem } from "./types";

/** Cuántas líneas se piden a la vez. Ni tan pocas que sean mil viajes, ni tantas que el troceo de
 *  una página se note como un tirón: 20.000 tarda ~200 ms con el troceador actual. */
const PAGINA = 20_000;

export type ProgresoReconstruccion = {
  /** Líneas ya troceadas. */
  lineas: number;
  /** Total a trocear, para poder pintar un porcentaje honesto. */
  total: number;
  /** Avistamientos escritos hasta ahora. */
  avistamientos: number;
};

/** Los índices con los que el troceador contrasta cada palabra. Se cargan UNA vez por
 *  reconstrucción; son los mismos ficheros que usa el mapa. */
async function indices() {
  const [ne, i18n, en, inexistentes, existentes] = await Promise.all([
    loadJson<{
      systems: NeSystem[];
      regions?: { id: number; n: string }[];
      constellations?: { id: number; n: string }[];
    }>("/neweden.json", { systems: [] }),
    loadJson<Record<string, number>>("/ship_names_i18n.json", {}),
    loadJson<Record<string, number>>("/ship_names.json", {}),
    invoke<string[]>("intel_inexistentes").catch(() => [] as string[]),
    invoke<string[]>("intel_existentes").catch(() => [] as string[]),
  ]);
  return {
    nameIdx: new Map<string, NeSystem>(ne.systems.map((s) => [s.n.toLowerCase(), s])),
    // El inglés se carga DESPUÉS y pisa, igual que en el mapa: manda el catálogo probado.
    shipNames: new Map<string, number>([...Object.entries(i18n), ...Object.entries(en)]),
    noExisten: new Set(inexistentes),
    // Del MISMO fichero que los sistemas: si la reconstrucción no conociera las regiones, dejaría
    // en la base de datos avistamientos que el mapa en vivo ya no produce. Ese desacuerdo es
    // exactamente lo que esta tabla existe para no tener.
    zonaIdx: zonasDe(ne),
    existen: new Set(existentes),
  };
}

/** Deja respirar a la interfaz entre páginas. Sin esto el navegador no repinta y el progreso, que
 *  existe justo para que se vea que avanza, no se vería nunca. */
const respirar = () => new Promise((r) => setTimeout(r, 0));

/** ★★ APRENDER LOS NOMBRES QUE SE ESCRIBEN EN MINÚSCULA (2026-09-08).
 *
 *  # El problema, en una frase
 *
 *  El troceador ya sabe aceptar un piloto en minúscula, pero solo si `name_cache` lo confirma… y
 *  `name_cache` solo tiene lo que Koru preguntó alguna vez, y Koru nunca preguntó por una minúscula
 *  porque nunca la propuso. Una pescadilla que se muerde la cola: `stefanita` se recupera de pura
 *  suerte (se coló capitalizada 18 veces), pero `dokin-chan` 923, `foxesbreak` 363 o `kjeezy` 282 no
 *  existirían para Koru jamás.
 *
 *  # Cómo se corta
 *
 *  Se recorre el histórico UNA vez, se recogen las dudas que propone el propio troceador
 *  (`pilotDudas`: token en minúscula, en su campo, en línea con sistema, sin veredicto) y se
 *  preguntan en lote. La respuesta —sí **o no**— se guarda para siempre en `name_cache`.
 *
 *  ⚠️ El umbral de 3 apariciones no es un número redondo: sale de la auditoría. Sin él son 5.640
 *  tokens; con él, 1.462 que cubren 32.451 apariciones. Lo que se cae son palabras vistas una o dos
 *  veces en seis años, que no valen una petición.
 *
 *  ⚠️ Se pregunta por TANDAS de 200 con `resolve_intel_entities`, que ya mira primero la caché local
 *  y solo va a ESI con lo que de verdad no sabe. No se repregunta nada. */
const TANDA_ESI = 200;
const MIN_VECES = 3;

/** ⚠️ LA FASE, NO SOLO EL PORCENTAJE. Sin esto la barra llegaba al 100 % al acabar de LEER y se
 *  quedaba ahí clavada mientras seguía preguntando a ESI — o sea, el botón decía «Aprendiendo…
 *  100 %» durante toda la parte que de verdad tarda. Él lo vio en pantalla y tenía toda la razón en
 *  desconfiar: un 100 % que no ha terminado es un cartel que miente. */
export type ProgresoAprender = {
  fase: "leyendo" | "preguntando";
  lineas: number;
  total: number;
  /** En la fase de preguntar: cuántos nombres van pedidos y cuántos hay en total. */
  hechos: number;
  candidatos: number;
};

export async function aprenderNombresMinuscula(
  onProgreso?: (p: ProgresoAprender) => void,
): Promise<{ lineas: number; candidatos: number; preguntados: number; personas: number }> {
  const { nameIdx, shipNames, noExisten, zonaIdx, existen } = await indices();
  const [total] = await invoke<[number, number | null, number | null]>("intel_lines_stats");
  const veces = new Map<string, number>();
  let cursor = 0;
  let lineas = 0;
  for (;;) {
    const pagina = await invoke<IntelLine[]>("intel_lines_read", {
      canal: null,
      desdeMs: cursor,
      limite: PAGINA,
    });
    if (pagina.length === 0) break;
    for (const l of pagina) {
      const p = classifyIntel(l.message, nameIdx, shipNames, noExisten, zonaIdx, existen);
      for (const d of p.pilotDudas) {
        const k = d.toLowerCase();
        veces.set(k, (veces.get(k) ?? 0) + 1);
      }
    }
    lineas += pagina.length;
    cursor = pagina[pagina.length - 1].ts_ms;
    onProgreso?.({ fase: "leyendo", lineas, total, hechos: 0, candidatos: veces.size });
    await respirar();
  }

  const candidatos = [...veces].filter(([, n]) => n >= MIN_VECES).map(([k]) => k);
  let personas = 0;
  // ⚠️ EL AVISO VA ANTES DE PREGUNTAR, NO DESPUÉS. Lo emitía al volver cada tanda, así que entre
  // acabar de leer y recibir la primera respuesta el botón seguía diciendo «Leyendo… 100 %» — otra
  // vez un cartel clavado en el 100 % sin haber terminado, dos líneas debajo de donde acababa de
  // arreglar el mismo fallo. Él lo vio en pantalla. **El progreso se anuncia al EMPEZAR un paso.**
  onProgreso?.({ fase: "preguntando", lineas, total, hechos: 0, candidatos: candidatos.length });
  for (let i = 0; i < candidatos.length; i += TANDA_ESI) {
    const tanda = candidatos.slice(i, i + TANDA_ESI);
    // Si una tanda falla (red, ESI caído), se sigue con las demás: lo aprendido se queda guardado y
    // volver a lanzarlo mañana solo preguntará lo que falte. Ninguna respuesta se pierde a medias.
    try {
      const e = await invoke<{ characters: { id: number; name: string }[] }>(
        "resolve_intel_entities",
        { names: tanda },
      );
      personas += e.characters.length;
    } catch {
      /* se reintenta en la próxima pasada */
    }
    onProgreso?.({
      fase: "preguntando",
      lineas,
      total,
      hechos: Math.min(i + TANDA_ESI, candidatos.length),
      candidatos: candidatos.length,
    });
    await respirar();
  }
  return { lineas, candidatos: veces.size, preguntados: candidatos.length, personas };
}

// ★★ EL ESTADO VIVE AQUÍ, NO EN EL COMPONENTE — y esto lo destapó él, en vivo y al 46 %.
//
// Salió de Ajustes sin querer y el panel volvió como si no pasara nada: React desmonta el
// componente, se lleva su `useState`, y el bucle —que es una promesa, no un trozo de React— sigue
// corriendo a solas. **La reconstrucción no se paró; se quedó sin testigo.**
//
// Y eso no era solo feo: con el botón otra vez habilitado, una segunda pasada habría PURGADO lo que
// la primera llevaba escrito. Un proceso largo que no sobrevive a cambiar de pestaña no es un
// proceso largo, es una trampa.
//
// Con el estado en el módulo: al volver a la pestaña el progreso sigue ahí, y `enMarcha` impide
// arrancar una segunda aunque se pulse.
type EstadoRecon = { activo: boolean; progreso: number; resultado: string | null };
const estado: EstadoRecon = { activo: false, progreso: 0, resultado: null };
const oyentes = new Set<(e: EstadoRecon) => void>();
const avisar = () => oyentes.forEach((f) => f({ ...estado }));

/** El estado de AHORA. Lo lee el componente al montarse, que es justo el caso que fallaba. */
export const estadoReconstruccion = (): EstadoRecon => ({ ...estado });

/** Se suscribe a los cambios. Devuelve la función para darse de baja. */
export function escucharReconstruccion(f: (e: EstadoRecon) => void): () => void {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

/** ★★ EL MARCADOR, para poder REANUDAR. Idea suya, y nació de perderlo: la primera pasada se cortó
 *  al 70 % —edité `src/intel.ts` con Vite vigilando y la recarga se llevó el bucle— y esos veinte
 *  minutos se fueron enteros.
 *
 *  `version` es lo que impide el desastre callado: si entre el corte y la reanudación cambió el
 *  troceador, media tabla quedaría hecha con un lector y media con otro **y nada lo diría**. Es el
 *  mismo razonamiento del sello de la base de datos, que también es suyo. */
export type MarcaRecon = {
  version: string;
  purgado: boolean;
  cursor: number;
  lineas: number;
  avistamientos: number;
  borrados: number;
  total: number;
  empezada: string;
};

const leerMarca = async (): Promise<MarcaRecon | null> => {
  try {
    const s = await invoke<string | null>("intel_recon_estado");
    return s ? (JSON.parse(s) as MarcaRecon) : null;
  } catch {
    return null;
  }
};
const guardarMarca = (m: MarcaRecon | null) =>
  invoke("intel_recon_marcar", { estado: m ? JSON.stringify(m) : null }).catch(() => {});

/** Lo que hay que enseñar en el botón: si se puede continuar y por dónde iba.
 *
 *  ⚠️ Con la versión CAMBIADA devuelve `continuable: false` **y lo dice**: reanudar mezclando dos
 *  lectores sería peor que empezar de cero, pero decidirlo en silencio también. */
export async function reconPendiente(): Promise<
  { hay: false } | { hay: true; continuable: boolean; pct: number; marca: MarcaRecon }
> {
  const m = await leerMarca();
  if (!m) return { hay: false };
  const v = await getVersion().catch(() => "");
  const pct = m.total > 0 ? Math.min(100, Math.round((m.lineas / m.total) * 100)) : 0;
  return { hay: true, continuable: m.version === v, pct, marca: m };
}

/**
 * Vacía los avistamientos y los rehace desde las líneas guardadas.
 *
 * Devuelve lo que hay que poder contar después: cuántos se borraron, cuántas líneas se releyeron y
 * cuántos avistamientos salieron. Que la cifra final sea DISTINTA de la inicial es lo esperado —
 * es justo la basura que se va y los nombres que antes se partían y ahora no.
 */
export async function reconstruirAvistamientos(
  onProgreso?: (p: ProgresoReconstruccion) => void,
  continuar = false,
): Promise<{ borrados: number; contadores: number; lineas: number; avistamientos: number }> {
  // ⚠️ UNA SOLA A LA VEZ. Dos en paralelo se purgarían la una a la otra.
  if (estado.activo) throw new Error("Ya hay una reconstrucción en marcha.");
  estado.activo = true;
  estado.progreso = 0;
  estado.resultado = null;
  avisar();
  try {
  const { nameIdx, shipNames, noExisten, zonaIdx, existen } = await indices();
  const [total] = await invoke<[number, number | null, number | null]>("intel_lines_stats");
  const version = await getVersion().catch(() => "");

  // ★ ¿Se continúa o se empieza? `continuar` solo llega en `true` desde el botón «Continuar», que
  //   ya ha comprobado la versión con `reconPendiente`. Aquí se vuelve a comprobar igualmente: una
  //   condición de seguridad que solo se verifica en la interfaz no es una condición de seguridad.
  const previa = await leerMarca();
  const sigue = continuar && previa != null && previa.version === version && previa.purgado;

  let cursor = sigue ? previa!.cursor : 0;
  let lineas = sigue ? previa!.lineas : 0;
  let avistamientos = sigue ? previa!.avistamientos : 0;
  let borrados = sigue ? previa!.borrados : 0;
  let contadores = 0;

  if (!sigue) {
    // ⚠️ La purga va DESPUÉS de cargar los índices y ANTES del primer troceo. Si algo fallara al
    // cargar un catálogo, mejor fallar con los avistamientos viejos intactos que dejarlos borrados.
    [borrados, contadores] = await invoke<[number, number]>("intel_sightings_purgar");
  }
  const marca = (): MarcaRecon => ({
    version, purgado: true, cursor, lineas, avistamientos, borrados, total,
    empezada: sigue ? previa!.empezada : new Date().toISOString(),
  });
  // Se marca YA, antes de la primera página: si el corte llega en el minuto uno, lo que no puede
  // pasar es que al reanudar se vuelva a purgar lo que la purga acaba de dejar vacío.
  await guardarMarca(marca());
  // Las líneas del mismo milisegundo pueden repetirse al cambiar de página (el corte es `>=`), y
  // eso es inofensivo: la clave de `intel_sightings` deduplica. Lo que NO sería inofensivo es
  // saltarse una.
  for (;;) {
    const pagina = await invoke<IntelLine[]>("intel_lines_read", {
      canal: null,
      desdeMs: cursor,
      limite: PAGINA,
    });
    if (pagina.length === 0) break;

    const lote: {
      name: string;
      system_id: number | null;
      ts_ms: number;
      ship_type_id: number | null;
    }[] = [];
    for (const l of pagina) {
      const p = classifyIntel(l.message, nameIdx, shipNames, noExisten, zonaIdx, existen);
      const sys = p.systems[0];
      // Un avistamiento necesita SISTEMA y HORA: sin sistema no dice dónde estaba nadie, y eso es
      // lo único que aporta la tabla. Es el mismo criterio que usa la captura en vivo.
      if (!sys || p.pilots.length === 0) continue;
      // La nave solo se atribuye si hay UN piloto: con dos, no se sabe de quién es.
      const nave = p.pilots.length === 1 && p.ships.length >= 1 ? p.ships[0].id : null;
      for (const name of p.pilots) {
        lote.push({ name, system_id: sys.id, ts_ms: l.ts_ms, ship_type_id: nave });
      }
    }
    if (lote.length > 0) {
      await invoke("intel_record_sightings", { sightings: lote, resolve: false });
      avistamientos += lote.length;
    }

    lineas += pagina.length;
    estado.progreso = total > 0 ? Math.min(100, Math.round((lineas / total) * 100)) : 0;
    avisar();
    onProgreso?.({ lineas, total, avistamientos });
    const ultima = pagina[pagina.length - 1].ts_ms;
    // Si una página entera cae en el mismo milisegundo, avanzar el cursor a `ultima` daría un
    // bucle infinito. Es imposible con páginas de 20.000, pero un bucle infinito no es el tipo de
    // cosa que se deja a la suerte.
    cursor = ultima > cursor ? ultima : cursor + 1;
    // Una escritura de una fila por página (41 en toda la pasada): lo que cuesta es despreciable
    // frente a volver a empezar veinte minutos.
    await guardarMarca(marca());
    if (pagina.length < PAGINA) break;
    await respirar();
  }
  // Terminó bien: fuera el marcador, o el próximo arranque ofrecería continuar algo ya hecho.
  await guardarMarca(null);
  return { borrados, contadores, lineas, avistamientos };
  } finally {
    // Pase lo que pase —incluido un error a mitad— el candado se suelta. Si no, un fallo dejaría
    // el botón inutilizable hasta reiniciar Koru, y sin forma de saber por qué.
    estado.activo = false;
    avisar();
  }
}

/** Guarda el texto del resultado en el módulo, para que sobreviva a cambiar de pestaña igual que
 *  el progreso. Lo llama el componente cuando termina. */
export function anotarResultado(texto: string | null) {
  estado.resultado = texto;
  avisar();
}
