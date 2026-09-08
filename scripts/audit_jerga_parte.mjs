// ★★ ¿QUÉ PALABRAS DE LA JERGA ESTÁN PARTIENDO NOMBRES REALES? (2026-09-08)
//
// # Por qué existe
//
// La lista `INTEL_JARGON` cierra el nombre que se estuviera montando. Es lo correcto casi siempre
// («Fulano on the gate» → el piloto es Fulano), pero cuando la palabra de jerga **es la segunda
// mitad de un nombre propio**, corta a la persona por el medio y ficha solo su primera palabra:
//
//     «Iam Neutral»  →  piloto «Iam»          (`neutral` está en la jerga)
//     «CCTV Eyes»    →  piloto «CCTV»         (`eyes` está en la jerga)
//
// Es exactamente el patrón de «Dee Yona», donde el que cortaba era un SISTEMA. Allí no se adivinó:
// se proponen las dos lecturas (`pilotAlts`) y decide `name_cache`. Aquí hará falta lo mismo — pero
// **primero hay que saber cuántas palabras hacen esto y a cuánta gente**, porque el error del día
// anterior fue justo el contrario: generalizar desde un solo caso (`vni`) y dejar `eni` —487
// avistamientos falsos— dos columnas más abajo sin mirar.
//
// # La regla que lo hace fiable
//
// ⚠️ ESTO **NO TIENE TROCEADOR PROPIO**, igual que `audit_intel.mjs`. Los pilotos los saca
//    `classifyIntel` de `src/intel.ts` —el troceador de la app— y aquí solo se mira **qué token va
//    justo detrás (o justo delante) del nombre que Koru ha extraído de verdad**. Si esto
//    reclasificara por su cuenta, mediría al auditor y no a Koru.
//
// ⚠️ Solo LEE. No decide nada, no toca `intel.ts` y no gasta una sola petición a ESI (eso lo hace
//    el Python, y solo si se le pide con `--esi`).
//
// Lo alimenta `audit_jerga_parte.py`, que es quien sabe leer SQLite.
import { readFileSync, writeFileSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [, , RAIZ, JSONL, CACHE, SALIDA] = process.argv;
const ruta = (...p) => join(RAIZ, ...p);
// `import()` exige una URL: en Windows `C:\...` no lo es. Misma trampa que ya pisamos en audit_intel.
const ts = (await import(pathToFileURL(ruta("node_modules", "typescript", "lib", "typescript.js")).href)).default;
const tp = (src) =>
  ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const M = await import(
  "data:text/javascript;base64," +
    Buffer.from(tp(readFileSync(ruta("src", "intel.ts"), "utf8"))).toString("base64")
);

// --- Los mismos catálogos que usa la app: el veredicto tiene que ser el suyo ---
const ne = JSON.parse(readFileSync(ruta("public", "neweden.json"), "utf8"));
const nameIdx = new Map(ne.systems.map((s) => [s.n.toLowerCase(), s]));
const zonaIdx = M.zonasDe(ne);
const shipNames = new Map([
  ...Object.entries(JSON.parse(readFileSync(ruta("public", "ship_names_i18n.json"), "utf8"))),
  ...Object.entries(JSON.parse(readFileSync(ruta("public", "ship_names.json"), "utf8"))),
]);
/** ★ EL CATÁLOGO DE OBJETOS, para separar dos problemas que parecían uno (2026-09-08).
 *
 *  «Sisters Combat Scanner Probe» ficha DOS pilotos falsos (`Sisters`, `Scanner`) y encima una nave
 *  falsa (la fragata Probe). Comprobado ejecutando el troceador, no razonado. Pero eso **no lo
 *  arregla `name_cache`**: no hay ninguna persona que confirmar, hay un OBJETO que el troceador no
 *  conoce porque `ship_names` solo trae naves. Si no se separan, el informe pide preguntarle a ESI
 *  por cosas que ya están en un fichero del disco — justo lo contrario de «catálogo primero».
 *
 *  Se indexan los prefijos de palabra de los 19.369 tipos del mercado, igual que `prefijosDe` hace
 *  con las naves: así «Combat Scanner» casa con «Combat Scanner Probe I». Es una PISTA para el
 *  informe, no un veredicto. */
const prefijosObjeto = new Set();
try {
  for (const t of JSON.parse(readFileSync(ruta("public", "market_types.json"), "utf8"))) {
    const partes = (t.n || "").toLowerCase().split(" ");
    for (let k = 1; k <= partes.length; k++) prefijosObjeto.add(partes.slice(0, k).join(" "));
  }
} catch { /* sin catálogo de objetos el informe sigue valiendo, solo pierde una columna */ }

const cache = JSON.parse(readFileSync(CACHE, "utf8"));
const noExisten = new Set(Object.entries(cache).filter(([, v]) => v === -1).map(([k]) => k));
const existen = new Set(Object.entries(cache).filter(([, v]) => v === 1).map(([k]) => k));

// ★ La jerga se lee del PROPIO `intel.ts`, no de una copia. Si mañana se añade una palabra, este
//   informe la mide sin tocarlo. Si cambiara el formato del fichero, se planta en vez de mentir.
const fuente = readFileSync(ruta("src", "intel.ts"), "utf8");
const conjunto = (nombre) => {
  const m = fuente.match(new RegExp(`const ${nombre} = new Set\\(\\[([\\s\\S]*?)\\]\\)`));
  if (!m) throw new Error(`No encuentro ${nombre} en intel.ts — ¿cambió el formato?`);
  return new Set([...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1].toLowerCase()));
};
const JERGA = conjunto("INTEL_JARGON");
// Las partículas («the», «van», «de») ya tienen su propio mecanismo dentro del troceador, así que
// aquí se excluyen: contarlas sería medir dos veces un problema que ya está resuelto.
const PARTICULAS = conjunto("PARTICULAS_NOMBRE");
console.log(`  jerga leída de intel.ts: ${JERGA.size} palabras`);

// El MISMO recorte de puntuación que hace `classifyIntel` (`clean`). Está copiado a propósito y es
// lo único que se copia: sin él, «Neutral,» no casaría con `neutral` y el informe diría que no pasa
// nada. Si algún día `clean` cambia en intel.ts, hay que cambiarlo aquí.
const clean = (s) => s.replace(/[*.,;:!?()]+$/g, "").replace(/^[*([]+/g, "").trim();

/** corto + jerga → { veces, mayus, corto, jerga, orig } */
const detras = new Map();
const delante = new Map();
/** ★ EL CASO QUE MI PRIMERA VERSIÓN NO VEÍA, y lo enseñó EJECUTARLA con «CCTV Eyes» de prueba.
 *
 *  Este informe empezó mirando solo a los pilotos que Koru SÍ saca, para medir a Koru y no al
 *  auditor. Pero cuando la mitad corta **no llega a piloto** —porque ESI ya dijo que «CCTV» no es
 *  nadie, o porque se queda corta— no hay piloto que mirar y el corte se vuelve INVISIBLE: la línea
 *  no ficha a nadie equivocado, simplemente **pierde a la persona entera y en silencio**. Es el caso
 *  peor, y era justo el que se me escapaba.
 *
 *  ⚠️ Aquí no hay veredicto del troceador, así que esto es un TECHO, no un hecho: se exige que
 *  ningún catálogo reclame esa palabra, pero no se comprueban abreviaturas ni apodos. Se imprime
 *  aparte y etiquetado — mezclarlo con lo medido de verdad sería inflar la cifra que justifica el
 *  trabajo. */
const perdidos = new Map();
let lineas = 0;
let lineasConPiloto = 0;
let lineasCortadas = 0;

const anota = (mapa, corto, jerga, jergaOriginal) => {
  const k = `${corto.toLowerCase()}|${jerga}`;
  let e = mapa.get(k);
  if (!e) mapa.set(k, (e = { veces: 0, mayus: 0, corto, jerga, orig: jerga }));
  e.veces++;
  // ¿Se escribió la palabra de jerga con mayúscula inicial? **No decide nada** —ESI demostró que hay
  // nombres canónicos en minúscula— pero dice si quien escribía la trataba como parte de un nombre,
  // y es lo que separa «Iam Neutral» de «Fulano on the gate». Se CUENTA, no se filtra: filtrar aquí
  // sería volver a meter en el medidor el axioma que este mismo día resultó falso.
  if (/^\p{Lu}/u.test(jergaOriginal)) {
    e.mayus++;
    e.orig = jergaOriginal;
  }
};
/** ¿Reclama algún catálogo esta palabra? Cuatro consultas, no una clasificación. */
const loReclamaElCatalogo = (lc) =>
  JERGA.has(lc) || PARTICULAS.has(lc) || nameIdx.has(lc) || shipNames.has(lc) || zonaIdx.has(lc);
/** Forma mínima de algo que pueda ser un trozo de nombre: letras y al menos dos. */
const FORMA_TROZO = /^[\p{L}][\p{L}'-]+$/u;

const rl = createInterface({ input: createReadStream(JSONL, "utf8"), crlfDelay: Infinity });
for await (const linea of rl) {
  if (!linea.trim()) continue;
  const { texto } = JSON.parse(linea);
  lineas++;
  const p = M.classifyIntel(texto, nameIdx, shipNames, noExisten, zonaIdx, existen);
  if (p.pilots.length) lineasConPiloto++;
  // Los campos, con la MISMA limpieza y el MISMO corte que el troceador.
  const campos = M.limpiarMarcadoEve(texto).split(/\s{2,}/).map((f) => f.trim()).filter(Boolean);
  let cortada = false;
  for (const campo of campos) {
    const tokens = campo.split(/\s+/).map(clean).filter(Boolean);
    const bajos = tokens.map((t) => t.toLowerCase());
    /** Posiciones ya explicadas por un piloto de verdad: lo demás es el bloque «techo». */
    const cubierto = new Set();
    for (const piloto of p.pilots) {
      const partes = piloto.split(/\s+/).map((t) => t.toLowerCase());
      for (let i = 0; i + partes.length <= tokens.length; i++) {
        let casa = true;
        for (let j = 0; j < partes.length; j++)
          if (bajos[i + j] !== partes[j]) { casa = false; break; }
        if (!casa) continue;
        for (let j = 0; j < partes.length; j++) cubierto.add(i + j);
        // ★ DETRÁS: «Iam» seguido de «Neutral». La lectura larga sería «Iam Neutral».
        const sig = i + partes.length;
        if (sig < tokens.length && JERGA.has(bajos[sig]) && !PARTICULAS.has(bajos[sig])) {
          anota(detras, piloto, bajos[sig], tokens[sig]);
          cortada = true;
        }
        // ★ DELANTE: jerga justo antes del nombre («Red» + «Fox»). El mismo mecanismo, al revés.
        if (i > 0 && JERGA.has(bajos[i - 1]) && !PARTICULAS.has(bajos[i - 1])) {
          anota(delante, piloto, bajos[i - 1], tokens[i - 1]);
          cortada = true;
        }
      }
    }
    // ★ EL TECHO: jerga precedida de algo con forma de nombre que HOY no sale como piloto.
    for (let i = 1; i < tokens.length; i++) {
      if (!JERGA.has(bajos[i]) || PARTICULAS.has(bajos[i])) continue;
      if (cubierto.has(i - 1)) continue;
      const prev = bajos[i - 1];
      if (!FORMA_TROZO.test(prev) || loReclamaElCatalogo(prev)) continue;
      // ⚠️ FALSO POSITIVO MÍO, cazado ejecutando el troceador y no leyéndolo: «Caldari Shuttle» SÍ
      //    está en `ship_names` y Koru la reconoce perfectamente. Mi bucle miraba la palabra suelta
      //    (`caldari` no es una nave) y contaba 609 cortes que no existen. La comprobación tiene
      //    que ir sobre el PAR, que es lo que el troceador mira de verdad (`naveDesde` prueba de
      //    más largo a más corto). Se miran también tres palabras: «Council Diplomatic Shuttle».
      if (shipNames.has(`${prev} ${bajos[i]}`)) continue;
      if (i >= 2 && shipNames.has(`${bajos[i - 2]} ${prev} ${bajos[i]}`)) continue;
      anota(perdidos, tokens[i - 1], bajos[i], tokens[i]);
    }
  }
  if (cortada) lineasCortadas++;
}

/** El veredicto que ya tenemos apuntado, sin preguntar nada. */
const veredicto = (nombre) => {
  const v = cache[nombre.toLowerCase()];
  return v === 1 ? "si" : v === -1 ? "no" : "?";
};

const filas = (mapa, alReves) =>
  [...mapa.values()]
    .map((e) => {
      const largo = alReves ? `${e.orig} ${e.corto}` : `${e.corto} ${e.orig}`;
      return {
        corto: e.corto,
        jerga: e.jerga,
        largo,
        veces: e.veces,
        mayus: e.mayus,
        esiCorto: veredicto(e.corto),
        esiLargo: veredicto(largo),
        // ¿La lectura larga es el principio del nombre de un OBJETO del mercado? Entonces esto no
        // es una persona que preguntar, es un catálogo que no estamos mirando.
        obj: prefijosObjeto.has(largo.toLowerCase()),
      };
    })
    .sort((a, b) => b.veces - a.veces);

const fd = filas(detras, false);
const fl = filas(delante, true);
const fp = filas(perdidos, false);

/** ★★ LA PUERTA: VECES ÷ GENTE. Salió de mirar por qué `nv` encabezaba la lista y no debía.
 *
 *  `nv` corta 38.440 veces… repartidas entre **17.618 personas distintas**. Eso no es un apellido:
 *  es que en su intel `nv` significa «NUEVO» —que los hostiles han vuelto a aparecer, aunque el
 *  aviso sea idéntico al de hace un minuto— y por eso lo lleva detrás medio universo. Palabras suyas
 *  (2026-09-08), y ningún catálogo podía contestarlo.
 *
 *  La señal es la CONCENTRACIÓN: un apellido lo lleva poca gente y se repite mucho.
 *
 *      nv        38.440 / 17.618 =   2,2      in    2.814 / 2.057 = 1,4   ← jerga
 *      eyes       3.208 /     88 =  36,5      neutral 1.248 /  13 =  96   ← trozo de nombre
 *      meme       1.440 /     10 = 144
 *
 *  ⚠️ Y tiene GRUPO DE CONTROL gratis, que es lo que le faltó a la dispersión de ayer: las ~198
 *  palabras de `INTEL_JARGON` son todas jerga confirmada, así que si la señal sirve, casi todas
 *  tienen que caer en la banda baja. Por eso el informe imprime la lista ENTERA ordenada por este
 *  número: el umbral se ve, no se cree. */
const RATIO = Number(process.env.KORU_RATIO ?? 10);
/** Resumen por palabra de jerga: a cuánta gente distinta corta y con qué veredicto. */
const resumenJerga = (fs) => {
  const m = new Map();
  for (const f of fs) {
    let e = m.get(f.jerga);
    if (!e) m.set(f.jerga, (e = { jerga: f.jerga, veces: 0, mayus: 0, distintos: 0, si: 0, no: 0, duda: 0, obj: 0 }));
    e.veces += f.veces;
    e.mayus += f.mayus;
    e.distintos++;
    if (f.obj) e.obj += f.veces;
    if (f.esiLargo === "si") e.si += f.veces;
    else if (f.esiLargo === "no") e.no += f.veces;
    else e.duda += f.veces;
  }
  return [...m.values()]
    .map((e) => ({ ...e, ratio: +(e.veces / e.distintos).toFixed(1) }))
    .sort((a, b) => b.ratio - a.ratio);
};
const rd = resumenJerga(fd);
const rl2 = resumenJerga(fl);
const rp = resumenJerga(fp);
/** Las palabras que pasan la puerta, por dirección. */
const pasan = (res) => new Set(res.filter((x) => x.ratio >= RATIO).map((x) => x.jerga));
const pasaD = pasan(rd), pasaL = pasan(rl2), pasaP = pasan(rp);
const conPuerta = [
  ...fd.filter((f) => pasaD.has(f.jerga)),
  ...fl.filter((f) => pasaL.has(f.jerga)),
  ...fp.filter((f) => pasaP.has(f.jerga)),
];

// Las preguntas que costaría cerrarlo. Se dan las tres cifras porque son tres decisiones distintas:
// preguntar por todo, por lo que venía con mayúscula, o solo por lo que pasa la puerta.
const todas = [...fd, ...fl, ...fp];
const dudas = [...new Set(todas.filter((f) => f.esiLargo === "?").map((f) => f.largo))];
const dudasMayus = [
  ...new Set(todas.filter((f) => f.esiLargo === "?" && f.mayus > 0).map((f) => f.largo)),
];
// ⚠️ Los que ya son un objeto del mercado NO se preguntan: eso es catálogo, no ESI.
const dudasPuerta = [
  ...new Set(conPuerta.filter((f) => f.esiLargo === "?" && !f.obj).map((f) => f.largo)),
];

writeFileSync(
  SALIDA,
  JSON.stringify(
    {
      lineas,
      lineasConPiloto,
      lineasCortadas,
      ratio: RATIO,
      jergaDetras: rd,
      jergaDelante: rl2,
      jergaPerdidos: rp,
      candidatosDetras: fd.slice(0, 200),
      candidatosDelante: fl.slice(0, 120),
      candidatosPerdidos: fp.slice(0, 200),
      // Todo lo que pasa la puerta, sin recortar: es la lista que hay que juzgar.
      candidatosPuerta: conPuerta.sort((a, b) => b.veces - a.veces),
      cortesPuerta: conPuerta.reduce((a, b) => a + b.veces, 0),
      cortesPuertaObjeto: conPuerta.filter((f) => f.obj).reduce((a, b) => a + b.veces, 0),
      dudasPuerta,
      totalDetras: fd.reduce((a, b) => a + b.veces, 0),
      totalDelante: fl.reduce((a, b) => a + b.veces, 0),
      totalPerdidos: fp.reduce((a, b) => a + b.veces, 0),
      confirmadosYa: todas.filter((f) => f.esiLargo === "si").reduce((a, b) => a + b.veces, 0),
      dudas,
      dudasMayus,
    },
    null,
    1
  ),
  "utf8"
);
console.log(
  `  ${lineas.toLocaleString("es-ES")} líneas · ${lineasCortadas.toLocaleString("es-ES")} con un piloto cortado por jerga`
);
