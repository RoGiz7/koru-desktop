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
import { classifyIntel } from "./intel";
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
  const [ne, i18n, en, inexistentes] = await Promise.all([
    loadJson<{ systems: NeSystem[] }>("/neweden.json", { systems: [] }),
    loadJson<Record<string, number>>("/ship_names_i18n.json", {}),
    loadJson<Record<string, number>>("/ship_names.json", {}),
    invoke<string[]>("intel_inexistentes").catch(() => [] as string[]),
  ]);
  return {
    nameIdx: new Map<string, NeSystem>(ne.systems.map((s) => [s.n.toLowerCase(), s])),
    // El inglés se carga DESPUÉS y pisa, igual que en el mapa: manda el catálogo probado.
    shipNames: new Map<string, number>([...Object.entries(i18n), ...Object.entries(en)]),
    noExisten: new Set(inexistentes),
  };
}

/** Deja respirar a la interfaz entre páginas. Sin esto el navegador no repinta y el progreso, que
 *  existe justo para que se vea que avanza, no se vería nunca. */
const respirar = () => new Promise((r) => setTimeout(r, 0));

/**
 * Vacía los avistamientos y los rehace desde las líneas guardadas.
 *
 * Devuelve lo que hay que poder contar después: cuántos se borraron, cuántas líneas se releyeron y
 * cuántos avistamientos salieron. Que la cifra final sea DISTINTA de la inicial es lo esperado —
 * es justo la basura que se va y los nombres que antes se partían y ahora no.
 */
export async function reconstruirAvistamientos(
  onProgreso?: (p: ProgresoReconstruccion) => void,
): Promise<{ borrados: number; contadores: number; lineas: number; avistamientos: number }> {
  const { nameIdx, shipNames, noExisten } = await indices();
  const [total] = await invoke<[number, number | null, number | null]>("intel_lines_stats");

  // ⚠️ La purga va DESPUÉS de cargar los índices y ANTES del primer troceo. Si algo fallara al
  // cargar un catálogo, mejor fallar con los avistamientos viejos intactos que dejarlos borrados.
  const [borrados, contadores] = await invoke<[number, number]>("intel_sightings_purgar");

  let cursor = 0;
  let lineas = 0;
  let avistamientos = 0;
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
      const p = classifyIntel(l.message, nameIdx, shipNames, noExisten);
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
    onProgreso?.({ lineas, total, avistamientos });
    const ultima = pagina[pagina.length - 1].ts_ms;
    // Si una página entera cae en el mismo milisegundo, avanzar el cursor a `ultima` daría un
    // bucle infinito. Es imposible con páginas de 20.000, pero un bucle infinito no es el tipo de
    // cosa que se deja a la suerte.
    cursor = ultima > cursor ? ultima : cursor + 1;
    if (pagina.length < PAGINA) break;
    await respirar();
  }
  return { borrados, contadores, lineas, avistamientos };
}
