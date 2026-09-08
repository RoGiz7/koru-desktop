// ★★ AUDITORÍA DEL TROCEADOR DE INTEL sobre las líneas REALES guardadas en `intel_line`.
//
// # Por qué existe (2026-09-08). Idea de RoGiz7.
//
// Llevábamos el día entero afinando el troceador a base de capturas suyas: «este salió partido»,
// «este no es un piloto». Funciona, pero es lento y **sesgado** — solo aparecen los fallos que le
// tocan a él mirando en ese momento. Su propuesta: *«¿podemos auditar toda esa información para
// que aprendas cómo se mencionan los nombres, naves y eventos?»*.
//
// Ahora se puede, porque esta mañana no existía: `intel_line` guarda 826.781 líneas de seis años.
//
// ⚠️ ESTO **NO TIENE SU PROPIO TROCEADOR**, y es la regla que lo hace útil. Koru ya tiene TRES
//    (`classifyIntel` en TS, el del vigilante y `analizar_intel`, los dos en Rust) y no pienso
//    escribir el cuarto: si el auditor y la app clasificaran distinto, el informe mediría al
//    auditor. Aquí se carga `src/intel.ts` tal cual, transpilado al vuelo.
//
// Lo alimenta `audit_intel.py`, que es quien sabe leer SQLite. Aquí solo se cuenta.
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [, , RAIZ, JSONL, CACHE, SALIDA] = process.argv;
// ⚠️ `import()` EXIGE UNA URL. En Windows una ruta como `C:\...` no lo es —el cargador la lee como
// el protocolo «c:»— y el script reventaba con ERR_UNSUPPORTED_ESM_URL_SCHEME. En Linux, donde lo
// probé, `/ruta` cuela por casualidad. `pathToFileURL` lo hace bien en los dos sitios.
const ruta = (...p) => join(RAIZ, ...p);
const ts = (await import(pathToFileURL(ruta("node_modules", "typescript", "lib", "typescript.js")).href)).default;
const tp = (src) =>
  ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const M = await import(
  "data:text/javascript;base64," +
    Buffer.from(tp(readFileSync(ruta("src", "intel.ts"), "utf8"))).toString("base64")
);

// --- Los mismos catálogos que usa la app, para que el veredicto sea el suyo ---
const ne = JSON.parse(readFileSync(ruta("public", "neweden.json"), "utf8"));
const nameIdx = new Map(ne.systems.map((s) => [s.n.toLowerCase(), s]));
// Regiones y constelaciones, del mismo fichero. Se pasan SIEMPRE: el auditor mide la app, y si aquí
// se troceara sin ellas el informe mediría a un troceador que no existe.
const zonaIdx = M.zonasDe(ne);
const shipNames = new Map([
  ...Object.entries(JSON.parse(readFileSync(ruta("public", "ship_names_i18n.json"), "utf8"))),
  ...Object.entries(JSON.parse(readFileSync(ruta("public", "ship_names.json"), "utf8"))),
]);
/** `name_cache` volcado por Python: nombre → 1 (existe, ESI lo resolvió) | -1 (ESI dice que no) */
const cache = JSON.parse(readFileSync(CACHE, "utf8"));

// ★ La jerga y los «clear» que el troceador YA conoce, leídos del propio `intel.ts`. Sin esto,
//   «clear», «on» o «to» salían en la lista de lo descartado — y esa lista solo vale si contiene lo
//   que NO conocemos. No están exportados, así que se sacan del texto del fichero: es feo, pero lee
//   la fuente de verdad y no una copia. Si el formato cambiara, esto se planta en vez de mentir.
const fuente = readFileSync(ruta("src", "intel.ts"), "utf8");
const conjunto = (nombre) => {
  const m = fuente.match(new RegExp(`const ${nombre} = new Set\\(\\[([\\s\\S]*?)\\]\\)`));
  if (!m) throw new Error(`No encuentro ${nombre} en intel.ts — ¿cambió el formato?`);
  return new Set([...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1].toLowerCase()));
};
const CONOCIDAS = new Set([...conjunto("INTEL_JARGON"), ...conjunto("INTEL_CLEAR")]);
console.log(`  jerga conocida: ${CONOCIDAS.size} palabras`);
const noExisten = new Set(Object.entries(cache).filter(([, v]) => v === -1).map(([k]) => k));

const inc = (m, k, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n);

const R = {
  lineas: 0,
  porCanal: new Map(),
  conSistema: 0,
  conPiloto: 0,
  conNave: 0,
  conContador: 0,
  clears: 0,
  mudas: 0,
  dobleEspacio: 0,
  // Lo que se TIRA: ni sistema, ni nave, ni jerga, ni nombre. Aquí está la jerga que no conocemos.
  descartados: new Map(),
  // Candidatos a piloto, con el veredicto de ESI cuando lo hay.
  pilotos: new Map(),
  // Las dos lecturas que hoy propone `pilotAlts` (el caso «Dee Yona»).
  alts: new Map(),
  // Un nombre de nave DENTRO de algo que parece un nombre propio (el caso «Escal Zephyr»).
  naveEnNombre: new Map(),
  ejemplosMudas: [],
  // ★★ LA PREGUNTA NUEVA (2026-09-08): ¿cuánta gente se pierde por escribirse en minúscula?
  //
  //  `pareceNombre` exige mayúscula inicial. Es un criterio honesto —quita las frases en inglés sin
  //  mantener una lista infinita— pero es un SUSTITUTO de «esto parece una persona», elegido cuando
  //  no había a quien preguntar. En la lista de descartados aparecen `stefanita` 5.358 veces,
  //  `michelle` 1.640, `kiki` 1.554… que no son jerga: son personas tecleadas con prisa.
  //
  //  Para no cambiar un sustituto por otro, aquí NO se decide nada: se cuentan las tres pruebas que
  //  ya existen y se dejan a la vista. Una sola no basta —`dead` y `blue` también son personajes de
  //  EVE reales, y de ahí salieron avistamientos falsos—; juntas sí dicen algo.
  /** Nombre completo extraído como piloto, en minúsculas → veces. Si el corpus escribe «Stefanita»
   *  con mayúscula en otras líneas, es la prueba más fuerte de que ahí hay una persona. */
  pilotoEnteros: new Map(),
  /** Cada palabra de cada nombre extraído. Cubre a quien solo aparece dentro de un nombre largo. */
  pilotoTokens: new Map(),
  /** Los tokens tirados, línea a línea, SOLO de las líneas mudas: es lo único que hace falta para
   *  contestar «¿cuántas de las que hoy no producen nada se recuperarían?». */
  mudasTokens: [],
  /** El token era TODO su campo (doble espacio). Formato de reporte, no de frase. */
  soloEnCampo: new Map(),
  /** …y además la línea resolvió un sistema. La versión estricta de su idea. */
  soloYSistema: new Map(),
  rotuloSistema: 0,
  rotuloSinGuion: 0,
  ejemplosRotulo: [],
  /** «23 redeemers»: número suelto pegado a una nave. Ver el porqué en el bucle. */
  numAntesNave: new Map(),
  numNaveLineas: 0,
  numNaveSinContador: 0,
};

const rl = createInterface({ input: createReadStream(JSONL, "utf8"), crlfDelay: Infinity });
for await (const linea of rl) {
  if (!linea.trim()) continue;
  const { canal, texto } = JSON.parse(linea);
  R.lineas++;
  inc(R.porCanal, canal);
  if (/ {2,}/.test(texto)) R.dobleEspacio++;

  const p = M.classifyIntel(texto, nameIdx, shipNames, noExisten, zonaIdx);
  if (p.systems.length) R.conSistema++;
  if (p.pilots.length) R.conPiloto++;
  if (p.ships.length) R.conNave++;
  if (p.count != null) R.conContador++;
  if (p.isClear) R.clears++;
  for (const a of p.pilotAlts) inc(R.alts, `${a.corto}  ⟂  ${a.largo}`);
  for (const n of p.pilots) {
    const lc = n.toLowerCase();
    inc(R.pilotos, `${n} ${cache[lc] === 1 ? "sí" : cache[lc] === -1 ? "NO" : "?"}`);
    // ¿Alguna palabra de este nombre es una nave? Entonces el troceador ya lo cortó por ahí, o
    // está a punto de hacerlo con otro parecido. Es el caso «Escal Zephyr».
    for (const w of n.split(" ")) if (shipNames.has(w.toLowerCase())) inc(R.naveEnNombre, n);
    // El mismo nombre, visto CON mayúscula: la prueba de que el corpus lo trata como persona.
    inc(R.pilotoEnteros, lc);
    for (const w of n.split(" ")) inc(R.pilotoTokens, w.toLowerCase());
  }

  // ★ LO QUE SE TIRA. Se rehace el troceo a mano SOLO para contar lo descartado — usando las
  //   mismas fuentes (`nameIdx`, `shipNames`) que acaba de usar `classifyIntel`, así que no es
  //   otro criterio: es mirar qué palabras no encajaron en ninguna de sus categorías.
  const limpio = M.limpiarMarcadoEve(texto);
  // ⚠️ LAS ZONAS TAMBIÉN CUENTAN COMO RECONOCIDAS. Sin esto, `delve` seguía saliendo en la lista de
  //    lo tirado —y encima SUBIÓ de 662 a 790, porque antes se colaba como piloto y entraba aquí
  //    por `nombrados`—. El troceador ya lo hacía bien; el que mentía era el informe.
  const nombrados = new Set(
    [
      ...p.pilots.flatMap((x) => x.split(" ")),
      ...p.ships.flatMap((x) => x.name.split(" ")),
      ...p.zones.flatMap((x) => x.n.split(" ")),
    ].map((x) => x.toLowerCase()),
  );
  let algo = p.systems.length || p.pilots.length || p.ships.length || p.count != null || p.isClear;
  const tirados = [];
  // ★★ DÓNDE cae cada palabra tirada, no solo cuántas veces. Es la pregunta que decide si se puede
  //    aceptar un nombre en minúscula: la convención del intel separa los campos con DOBLE espacio,
  //    así que un token SOLO en su campo es un reporte («SIS-TE  fulano  rifter») y el mismo token
  //    dentro de una frase corrida es charla («i can bring a proc»). Se trocea por campos igual que
  //    `classifyIntel` —`split(/\s{2,}/)`— para medir lo mismo que hace la app, no otra cosa.
  for (const campo of limpio.split(/\s{2,}/)) {
    const palabras = campo.trim().split(/\s+/).filter(Boolean);
    for (const w of palabras) {
      const c = w.replace(/^[*([]+|[*.,;:!?()]+$/g, "").toLowerCase();
      if (!c || c.length > 24) continue;
      if (nameIdx.has(c) || shipNames.has(c) || nombrados.has(c)) continue;
      if (CONOCIDAS.has(c)) continue;
      if (/^(?:\+\d+|\d+\+)$/.test(c)) continue; // el contador «+4» ya se reconoce
      inc(R.descartados, c);
      tirados.push(c);
      if (palabras.length === 1) {
        inc(R.soloEnCampo, c);
        // Y el filtro más fuerte de todos: campo propio EN UNA LÍNEA QUE YA NOMBRA UN SISTEMA. Eso
        // es exactamente su idea —«si ya se resuelve el sistema»— pero pedida por CAMPO, no por
        // línea entera, que es lo que la convertía en un invento de hostiles.
        if (p.systems.length) inc(R.soloYSistema, c);
      }
    }
  }
  // ★★ ¿CUÁNTAS VECES UN NÚMERO SUELTO VA JUSTO DELANTE DE UNA NAVE? (2026-09-08)
  //
  // Salió de una captura suya: `XKH-6O  23 redeemers stiletto`. Koru entiende `+4` y `x4`, pero un
  // número a secas lo tira — y en su lista de descartados están `2` 4.544 veces, `1` 4.057, `3`
  // 2.478, `10` 1.024. Si buena parte de eso es «N naves», estamos perdiendo **el tamaño de la
  // banda**, que es justo lo que decide si sales o te escondes.
  //
  // Se usa `p.ships`, o sea el veredicto del propio troceador sobre qué es una nave: así esto mide
  // a Koru y no a una idea mía de lo que es una nave.
  const nombresNave = new Set(p.ships.map((s) => s.name.toLowerCase()));
  if (nombresNave.size) {
    const ws = limpio.split(/\s+/).map((w) => w.replace(/^[*([]+|[*.,;:!?()]+$/g, "").toLowerCase());
    // ⚠️ EL DÍGITO PUEDE SER YA PARTE DE UN NOMBRE. Lo pilló la prueba, no el razonamiento:
    //    «Lucy Lee 1  Rifter» contaba como «1 rifter» y habría inflado la cifra con casos que ya
    //    funcionan bien. Si el número está dentro de un piloto extraído, no cuenta.
    const enPiloto = new Set(
      p.pilots.flatMap((x) => x.split(" ")).map((w) => w.toLowerCase()),
    );
    let hay = false;
    for (let i = 0; i < ws.length - 1; i++) {
      // 1 a 4 dígitos y nada más: `+4` y `4x` ya tienen su rama y no llegan aquí.
      if (!enPiloto.has(ws[i]) && /^\d{1,4}$/.test(ws[i]) && nombresNave.has(ws[i + 1])) {
        inc(R.numAntesNave, `${ws[i]} ${ws[i + 1]}`);
        hay = true;
      }
    }
    if (hay) {
      R.numNaveLineas++;
      // Las que MÁS valen: las que hoy no traen contador de ninguna otra forma.
      if (p.count == null) R.numNaveSinContador++;
    }
  }
  // Diagnóstico suelto: «Solar System» sale 2.749 veces en lo tirado y `System` se está fichando
  // como piloto. El rótulo se quita solo si trae guion; aquí se mira cuántas veces NO lo trae.
  if (/\bsolar\s+system\b/i.test(texto)) {
    R.rotuloSistema++;
    if (!/\bsolar system\s*[-–]\s*/i.test(texto)) {
      R.rotuloSinGuion++;
      if (R.ejemplosRotulo.length < 8) R.ejemplosRotulo.push(texto);
    }
  }
  if (!algo) {
    R.mudas++;
    // Solo de las mudas: son las únicas donde «recuperar un nombre» convierte una línea perdida en
    // un aviso. En las demás ya salía algo, así que el efecto sería otro y no se mezcla.
    if (tirados.length) R.mudasTokens.push(tirados);
    if (R.ejemplosMudas.length < 40) R.ejemplosMudas.push(texto);
  }
}

// ★★ ¿QUIÉN DE LO TIRADO ES UNA PERSONA? Tres pruebas independientes, ninguna decide sola:
//    · `esi`    — ESI resolvió ese nombre alguna vez. **No es prueba**: `dead` y `blue` existen.
//    · `entero` — el corpus escribe ESE MISMO nombre con mayúscula y Koru ya lo saca como piloto.
//    · `parte`  — aparece dentro de un nombre más largo ya reconocido.
//    Un `-1` de ESI (dice que no es de nadie) manda sobre todo lo demás y lo saca de la lista.
const candidato = (lc) =>
  cache[lc] !== -1 && (cache[lc] === 1 || R.pilotoEnteros.has(lc) || R.pilotoTokens.has(lc));
const posiblesNombres = [...R.descartados]
  .filter(([lc]) => candidato(lc))
  .sort((a, b) => b[1] - a[1])
  .map(([tok, veces]) => ({
    tok,
    veces,
    entero: R.pilotoEnteros.get(tok) ?? 0,
    parte: R.pilotoTokens.get(tok) ?? 0,
    solo: R.soloEnCampo.get(tok) ?? 0,
    solosis: R.soloYSistema.get(tok) ?? 0,
    esi: cache[tok] === 1 ? "sí" : "?",
  }));
const setCand = new Set(posiblesNombres.map((x) => x.tok));
// La cifra que de verdad importa: de las líneas que hoy no producen NADA, cuántas llevan dentro al
// menos uno de estos candidatos. Es el techo de lo que se recuperaría, no una promesa.
const mudasRescatables = R.mudasTokens.reduce(
  (n, toks) => n + (toks.some((t) => setCand.has(t)) ? 1 : 0),
  0,
);
// Lo que NADIE ha preguntado nunca: ni ESI ni el corpus dicen nada. Solo letras (un código de
// sistema abreviado lleva dígitos o guion y no es esto), y de 3 en adelante porque EVE no permite
// nombres más cortos. Esta lista es la que vale la pena mandar a ESI de una tacada.
const NOMBRABLE = /^[\p{L}'-]{3,}$/u;
const desconocidos = [...R.descartados]
  .filter(([lc]) => cache[lc] === undefined && !setCand.has(lc) && NOMBRABLE.test(lc))
  .sort((a, b) => b[1] - a[1])
  .slice(0, 400)
  .map(([tok, veces]) => [tok, veces, R.soloEnCampo.get(tok) ?? 0, R.soloYSistema.get(tok) ?? 0]);

// ★ EL PRESUPUESTO. Si el troceador acabara preguntando a ESI por los tokens en minúscula, ¿por
//   cuántos preguntaría? No es una estimación: es contar los que pasarían cada filtro. Cada nombre
//   se pregunta UNA vez en la vida y la respuesta se guarda, así que esto es el total histórico.
const presupuesto = {};
for (const [nombre, prueba] of [
  ["sin filtro (todo lo tirado)", () => true],
  ["+ forma de nombre (letras, 3+)", ([lc]) => NOMBRABLE.test(lc)],
  ["+ sin veredicto ya en name_cache", ([lc]) => NOMBRABLE.test(lc) && cache[lc] === undefined],
  ["+ SOLO en su campo (doble espacio)", ([lc]) =>
    NOMBRABLE.test(lc) && cache[lc] === undefined && (R.soloEnCampo.get(lc) ?? 0) > 0],
  ["+ y la línea resuelve un sistema", ([lc]) =>
    NOMBRABLE.test(lc) && cache[lc] === undefined && (R.soloYSistema.get(lc) ?? 0) > 0],
  ["+ visto así 3 veces o más", ([lc]) =>
    NOMBRABLE.test(lc) && cache[lc] === undefined && (R.soloYSistema.get(lc) ?? 0) >= 3],
]) {
  const pasan = [...R.descartados].filter(prueba);
  presupuesto[nombre] = [pasan.length, pasan.reduce((n, x) => n + x[1], 0)];
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★ SEGUNDA PASADA: LA DISPERSIÓN. ¿Se puede distinguir la jerga de una persona SIN preguntarle?
//
// # Por qué (2026-09-08). Idea suya: *«crear una especie de machine learning que aprenda y añada
//   jerga para descartarla en el intel o incluso reconocerla»*.
//
// La lista de jerga es la única de las cuatro categorías del troceador SIN fuente de datos: los
// sistemas los da New Eden, las naves el SDE, las personas ESI… y la jerga la escribo yo a mano, y
// además DUPLICADA en `intel.ts` y en `commands.rs`. Eso es la herida que él quiere cerrar.
//
// ⚠️ EL PROBLEMA DE FONDO: la jerga NO TIENE ORÁCULO. Nadie puede contestar «¿esto es jerga?» como
//    ESI contesta «¿esto es una persona?». Una máquina que se lo invente se envenena sola y en
//    silencio: `puli` sale 437 veces y jamás en posición de reporte, así que la declararía jerga —
//    y `puli` ES una persona. Quedaría ciega para siempre sin decirlo.
//
// Así que aquí NO se decide nada. Se mide UNA hipótesis concreta y falsable:
//
//    «una persona sale en pocos sistemas y la dice poca gente;
//     un concepto del juego sale en todas partes, siempre, y lo dice todo el mundo».
//
// Y se mide con GRUPO DE CONTROL, que es lo que la hace una prueba y no una ilustración: se calcula
// el mismo perfil para las 160 palabras que YA sabemos que son jerga y para las personas que ESI YA
// confirmó. Si la señal no separa lo que ya sabemos separar, no sirve para lo que no sabemos, y
// entonces la tabla la llena él a mano y la máquina solo ordena la cola.
//
// Va en una pasada aparte a propósito: hasta ahora no sabíamos qué tokens interesaban, y guardar la
// dispersión de los 48.885 descartados habría reventado la memoria para tirar el 99 %.
const TOPE = 400; // basta con distinguir «pocos» de «muchos»; no hace falta contarlos todos
const interes = new Map(); // token -> { grupo, v, s:Set, a:Set, t0, t1, sig:Map, ant:Map }
const marcar = (tok, grupo) => {
  if (!interes.has(tok))
    interes.set(tok, {
      grupo, v: 0, s: new Set(), a: new Set(), t0: 0, t1: 0,
      // ★★ QUÉ PALABRA VA DETRÁS, Y CUÁL DELANTE. Idea suya (2026-09-08), mirando el informe:
      //    *«small dudo que sea una persona, tiene más pinta de ser small bubble o small gang»*.
      //    Yo no puedo saberlo y ESI tampoco —confirma que existe alguien llamado «Small», que es
      //    justo la trampa de `ess`—, pero **el corpus sí lo sabe**: si detrás viene `gang` o
      //    `bubble` es jerga, y si viene un apellido es una persona. Esto es el decisor que faltaba
      //    para la tabla de jerga que él pidió, y sirve igual para `navy`, `kill`, `all` o `where`.
      sig: new Map(), ant: new Map(),
    });
};
// Control A: jerga confirmada (la lista que ya funciona).
for (const j of CONOCIDAS) marcar(j, "jerga");
// Control B: personas confirmadas por ESI, y de UNA sola palabra para que sean comparables con un
// token suelto. Un nombre de dos palabras no compite nunca con `ess`.
for (const [lc] of R.pilotoEnteros)
  if (cache[lc] === 1 && !lc.includes(" ") && !CONOCIDAS.has(lc)) marcar(lc, "persona");
// Y los que queremos clasificar: lo tirado que tiene forma de nombre y sale en posición de reporte.
for (const [lc] of R.descartados)
  if (NOMBRABLE.test(lc) && (R.soloYSistema.get(lc) ?? 0) >= 3 && !interes.has(lc))
    marcar(lc, "duda");
// ★ Y TODO LO QUE KORU YA FICHA COMO PILOTO de una sola palabra. Da igual lo que diga ESI: si le
//   está colgando 67 avistamientos a «Where», eso hay que decidirlo, y sin marcarlo aquí no se
//   recogen sus vecinos y no aparece en el bloque que él tiene que juzgar.
for (const [lc, n] of R.pilotoEnteros)
  if (n >= 20 && !lc.includes(" ") && !interes.has(lc)) marcar(lc, "duda");

const rl2 = createInterface({ input: createReadStream(JSONL, "utf8"), crlfDelay: Infinity });
for await (const linea of rl2) {
  if (!linea.trim()) continue;
  const { autor, ts, texto } = JSON.parse(linea);
  const p = M.classifyIntel(texto, nameIdx, shipNames, noExisten, zonaIdx);
  const sys = p.systems.map((s) => s.id);
  const vistos = new Set();
  const limpiar = (w) => (w ?? "").replace(/^[*([]+|[*.,;:!?()]+$/g, "").toLowerCase();
  const palabras = M.limpiarMarcadoEve(texto).split(/\s+/);
  for (let i = 0; i < palabras.length; i++) {
    const c = limpiar(palabras[i]);
    const o = c && interes.get(c);
    if (!o) continue;
    // El vecino se cuenta SIEMPRE, aunque el token se repita: «small gang» dos veces en una línea
    // son dos pruebas de cómo se usa. La dispersión sí se cuenta una vez (ver abajo).
    const sig = limpiar(palabras[i + 1]);
    const ant = limpiar(palabras[i - 1]);
    if (sig) inc(o.sig, sig);
    if (ant) inc(o.ant, ant);
    if (vistos.has(c)) continue; // una vez por línea: repetirla no la hace más dispersa
    vistos.add(c);
    o.v++;
    if (o.s.size < TOPE) for (const id of sys) o.s.add(id);
    if (o.a.size < TOPE) o.a.add(autor);
    if (ts) {
      o.t0 = o.t0 ? Math.min(o.t0, ts) : ts;
      o.t1 = Math.max(o.t1, ts);
    }
  }
}

const DIA = 86400000;
const perfil = (tok, o) => ({
  tok,
  grupo: o.grupo,
  v: o.v,
  sis: o.s.size,
  aut: o.a.size,
  dias: o.t0 ? Math.round((o.t1 - o.t0) / DIA) : 0,
  esi: cache[tok] === 1 ? "sí" : cache[tok] === -1 ? "NO" : "?",
});
const perfiles = [...interes].map(([t, o]) => perfil(t, o)).filter((x) => x.v > 0);
// El resumen se hace con MEDIANAS, no con medias: un solo término disparatado no debe mover la
// conclusión, y aquí la pregunta es «cómo es el típico», no «cuánto suman».
const mediana = (xs) => (xs.length ? xs.slice().sort((a, b) => a - b)[xs.length >> 1] : 0);
const resumenGrupo = (g) => {
  const gs = perfiles.filter((x) => x.grupo === g);
  return {
    n: gs.length,
    veces: mediana(gs.map((x) => x.v)),
    sistemas: mediana(gs.map((x) => x.sis)),
    autores: mediana(gs.map((x) => x.aut)),
    dias: mediana(gs.map((x) => x.dias)),
  };
};
const dispersion = {
  jerga: resumenGrupo("jerga"),
  persona: resumenGrupo("persona"),
  duda: resumenGrupo("duda"),
  // Las muestras que hacen falta para juzgar a ojo si la separación es real o un artefacto.
  muestraJerga: perfiles.filter((x) => x.grupo === "jerga").sort((a, b) => b.v - a.v).slice(0, 25),
  muestraPersona: perfiles.filter((x) => x.grupo === "persona").sort((a, b) => b.v - a.v).slice(0, 25),
  muestraDuda: perfiles.filter((x) => x.grupo === "duda").sort((a, b) => b.v - a.v).slice(0, 60),
};

// ★★ LOS SOSPECHOSOS: palabras que ESI confirma como persona Y que además son palabra corriente.
//    Son exactamente las que hacen daño en los dos sentidos —`ess` fichó a alguien inocente 4.218
//    veces; borrar `kill` borraría a un hostil real— y las únicas que no se pueden decidir desde
//    aquí. Se listan con sus vecinos para que **él** las juzgue: nadie más puede.
const vecinos = (m) => top(m, 6).map(([w, n]) => `${w} ${n}`).join(" · ");
const sospechosos = [...interes]
  // ⚠️ El corte NO es «ESI dice que existe» sino «Koru la está fichando como piloto». Con el filtro
  //    de ESI se quedaban fuera `where` (67 avistamientos), `what` (82) o `any` (89), que son
  //    exactamente las que hay que decidir: lo que importa no es si el nombre existe en alguna parte
  //    del universo, es si Koru le está colgando avistamientos a alguien por esa palabra.
  .filter(([tok, o]) => (R.pilotoEnteros.get(tok) ?? 0) >= 20 && !CONOCIDAS.has(tok))
  .sort((a, b) => (R.pilotoEnteros.get(b[0]) ?? 0) - (R.pilotoEnteros.get(a[0]) ?? 0))
  .slice(0, 40)
  .map(([tok, o]) => ({
    tok,
    v: o.v,
    entero: R.pilotoEnteros.get(tok) ?? 0,
    detras: vecinos(o.sig),
    delante: vecinos(o.ant),
  }));

writeFileSync(
  SALIDA,
  JSON.stringify(
    {
      lineas: R.lineas,
      dobleEspacio: R.dobleEspacio,
      conSistema: R.conSistema,
      conPiloto: R.conPiloto,
      conNave: R.conNave,
      conContador: R.conContador,
      clears: R.clears,
      mudas: R.mudas,
      porCanal: top(R.porCanal, 20),
      descartados: top(R.descartados, 250),
      pilotos: top(R.pilotos, 150),
      alts: top(R.alts, 40),
      naveEnNombre: top(R.naveEnNombre, 40),
      ejemplosMudas: R.ejemplosMudas,
      posiblesNombres: posiblesNombres.slice(0, 150),
      posiblesNombresTotal: posiblesNombres.length,
      posiblesNombresVeces: posiblesNombres.reduce((n, x) => n + x.veces, 0),
      mudasRescatables,
      desconocidos,
      presupuesto,
      rotuloSistema: R.rotuloSistema,
      rotuloSinGuion: R.rotuloSinGuion,
      ejemplosRotulo: R.ejemplosRotulo,
      dispersion,
      sospechosos,
      numNaveLineas: R.numNaveLineas,
      numNaveSinContador: R.numNaveSinContador,
      numAntesNave: top(R.numAntesNave, 40),
    },
    null,
    1,
  ),
);
console.log(`  troceadas ${R.lineas.toLocaleString()} líneas`);
