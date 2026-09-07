import type { NeSystem, IntelLine } from "./types";

// --- Parser de intel: clasifica cada token de una línea de chat ---
// Sin marcas en el log → clasificamos por contraste contra datos locales (sistemas + naves SDE
// + jerga). Convención de la comunidad: tokens separados por DOBLE espacio (sistema/piloto/nave,
// cualquier orden); con fallback a espacio simple. Devuelve sistemas, pilotos, naves, +N y clear.
const INTEL_CLEAR = new Set(["clr", "clear", "cleared"]);
// La segunda mitad son verbos y muletillas del chat de intel real. Se añadieron tras ver un aviso
// anunciar «he jump» como si fuera un hostil (la línea era «he jump to 9-MNOP»).
// ⚠️ Espejo de INTEL_JARGON en commands.rs: si cambia uno, cambia el otro.
const INTEL_JARGON = new Set([
  "nv", "neut", "neuts", "neutral", "neutrals", "red", "reds", "hostile", "hostiles",
  "status", "gate", "gates", "stargate", "dock", "docked", "docking", "station", "pos",
  "cyno", "near", "on", "the", "in", "at", "and", "is", "to", "a",
  "jump", "jumps", "jumped", "jumping", "warp", "warped", "warping", "camp", "camped", "camping",
  "move", "moves", "moved", "moving", "coming", "came", "going", "gone", "left", "back", "out",
  "up", "down", "here", "there", "still", "safe", "clr2", "afk", "logged", "off", "away",
  "spotted", "seen", "sitting", "sits", "roam", "roaming", "local", "he", "she", "they", "his",
  "her", "their", "with", "from", "for", "of", "seem", "seems", "like", "just", "was", "were",
  "have", "has", "had", "not", "no", "yes", "now", "watch", "look", "looking", "check", "x", "o",
  // Estructuras y tácticas: NUNCA son personas, y se colaban como hostiles. `ansi` es como se
  // escribe «Ansiblex» en el intel — Koru llegó a fichar un piloto llamado «ansi» de la línea
  // «... Sabre and Gnosis on ANSI» (en mayúsculas pasa `pareceNombre` con todo el derecho).
  // `jb` es el jump bridge y `bubble` la burbuja de interdicción. Esto SÍ es una lista a mano, y
  // se justifica porque son términos del JUEGO, no jerga de un idioma: no crecen con las personas.
  "ansi", "ansis", "ansiblex", "jb", "jbs", "bridge", "gatecamp",
  "bubble", "bubbles", "bubbled", "bubbling", "insta", "instas",
]);

/** ★★ EL MARCADO DE ENLACES DE EVE, FUERA — pero quedándonos con lo que dice.
 *
 *  Cuando alguien **enlaza** algo en el chat (arrastrar un sistema, un personaje, una nave), el log
 *  no guarda el nombre: guarda el marcado del juego.
 *
 *      <url=showinfo:5//30000785>SIS-TE</url>  <url=showinfo:1383//2123737549>Lucy Lee 1</url>
 *
 *  Reporte suyo (2026-09-08): esa línea seguía apuntando al personaje sin el `1`. Y el arreglo del
 *  «1 pegado al nombre» ya estaba puesto y probado — **lo que pasaba es que nunca llegaba a
 *  ejecutarse**. El troceador ve `<url=showinfo:1383//2123737549>Lucy`, que empieza por `<`, no
 *  pasa por nombre y se tira. Medido: esa línea daba el piloto **«Lee»** y CERO sistemas, así que
 *  además no generaba reporte. Un fallo de parser se disfrazó de fallo de nombres.
 *
 *  El texto enlazado se devuelve entre DOS espacios a propósito: un enlace es una unidad y el
 *  juego ya ha dicho dónde empieza y dónde acaba, así que se convierte en su propio campo — que es
 *  justo lo que la convención del intel expresa con el doble espacio.
 *
 *  ⚠️ Se quitan solo las etiquetas CONOCIDAS, no todo lo que vaya entre `<` y `>`: en un chat se
 *  escribe `a < b > c` y borrarlo sería inventarse un silencio.
 *
 *  ⚠️ El marcado NO se limpia al guardar: la línea cruda se conserva en la base de datos porque
 *  dentro viene el **id del personaje dicho por el juego**, y eso vale más que el nombre. */
const TAGS_EVE = /<\/?(?:url|font|color|b|i|u|br|localized|a)\b[^>]*>/gi;
export function limpiarMarcadoEve(s: string): string {
  return s
    .replace(/<url=[^>]*>([\s\S]*?)<\/url>/gi, "  $1  ")
    .replace(TAGS_EVE, " ")
    .replace(/[ \t]+$/gm, "");
}

/** ★ ÍNDICE DE PREFIJOS DE NAVE, construido UNA vez por catálogo.
 *
 *  «Brutix Navy» tiene que reconocerse aunque el catálogo diga «Brutix Navy Issue», y solo si ese
 *  prefijo es inequívoco — si diera dos candidatas, adivinar la nave del hostil es peor que no
 *  nombrarla. Eso ya funcionaba; lo que estaba mal era CÓMO: se recorrían las 512 naves en cada
 *  intento, y un intento es cada palabra × cada longitud × cada línea.
 *
 *  Medido sobre 110.632 líneas reales: **11.848 ms con catálogo frente a 874 ms sin él**. El 93 %
 *  del troceador se iba aquí, y el intel en vivo lo repite cada 3 segundos.
 *
 *  El valor es `null` cuando el prefijo lo reclaman DOS naves: así «no vale» se distingue de «no
 *  está», y `get()` devuelve `undefined` en un caso y `null` en el otro.
 *
 *  ⚠️ Cacheado en un `WeakMap` con el propio catálogo de clave: si algún día se recarga el
 *  catálogo (otro idioma, otro SDE), el índice viejo se va con él en vez de quedarse mintiendo. */
const prefijosCache = new WeakMap<Map<string, number>, Map<string, number | null>>();
function prefijosDe(shipNames: Map<string, number>): Map<string, number | null> {
  const ya = prefijosCache.get(shipNames);
  if (ya) return ya;
  const idx = new Map<string, number | null>();
  for (const [nombre, tid] of shipNames) {
    const partes = nombre.split(" ");
    for (let k = 1; k < partes.length; k++) {
      const pre = partes.slice(0, k).join(" ");
      // Ojo: el mismo typeID llega con varios nombres (un idioma cada uno), así que dos entradas
      // que compartan prefijo se descartan aunque sean la MISMA nave. Es lo que hacía el bucle
      // viejo contando candidatas, y se mantiene igual para no cambiar el comportamiento.
      idx.set(pre, idx.has(pre) ? null : tid);
    }
  }
  prefijosCache.set(shipNames, idx);
  return idx;
}

/** ¿Va esta palabra seguida de «gate»? Entonces es un DESTINO, no una persona.
 *
 *  Reporte suyo (2026-09-08) con una línea real: `SIS-TE on AB-C gate Gnosis and Sabre now` sacaba
 *  un piloto llamado **«AB-C»**. Lo que dice la línea es que están en SIS-TE campeando la puerta
 *  que lleva a AB-CDE. Es la abreviatura de un sistema, y pasa todos los filtros: tres
 *  caracteres, empieza por mayúscula y no está en el índice porque el índice tiene el nombre
 *  entero, no cómo lo abrevia la gente.
 *
 *  El arreglo no es apuntar «G-Q» en una lista —mañana es «M-O» y pasado «1DQ»—: **es que la
 *  palabra `gate` ya estaba ahí diciéndolo**. Lo que va justo antes de «gate» es a dónde lleva esa
 *  puerta. Misma familia que «Yona» y que el `1` de «Lucy Lee 1»: lo decide el contexto.
 *
 *  Se descarta SOLO el token pegado a «gate», no el nombre entero: en `Yaris Motsu AB-C gate` el
 *  piloto sigue saliendo. Y un falso negativo es mejor que un falso positivo — perder a alguien que
 *  se llamara así de verdad es menos grave que inventarse un hostil. */
const ESJERGA_GATE = new Set(["gate", "gates", "stargate"]);

/** ★★ PARTÍCULAS QUE VIVEN DENTRO DE UN NOMBRE: «Lurm **the** Slurm», «Jan **van** Dijk».
 *
 *  Reporte suyo (2026-09-08) con una línea real: `384-IN  Lurm the Slurm svipul` sacaba **DOS
 *  hostiles**, «Lurm» y «Slurm», y el aviso cantaba «2 hostiles (posible flota)» cuando era uno.
 *  El motivo: `the` está en la lista de jerga —y con razón, porque en «on the gate» no es nadie— así
 *  que cerraba el nombre por la mitad. «Bedwin Al Ishira» se salvaba solo porque su partícula va en
 *  mayúscula.
 *
 *  ⚠️ NO vale con dejar pasar cualquier jerga entre dos nombres: «Piloto Uno **and** Piloto Dos» son
 *  dos personas, y absorber el `and` las fundiría en una. Por eso la lista es CORTA y solo tiene
 *  palabras que aparecen DENTRO de nombres propios, nunca conectores entre dos personas.
 *
 *  Y aun así hacen falta las dos condiciones: que ya se esté escribiendo un nombre, y que lo que
 *  venga detrás **también** parezca parte de él — ni nave, ni sistema, ni más jerga. En
 *  `Juan Perez in SIS-TE` el `in` no se absorbe porque detrás hay un sistema. */
const PARTICULAS_NOMBRE = new Set([
  "the", "of", "de", "del", "la", "el", "von", "van", "der", "den", "da", "di", "du", "le", "bin",
]);

/** ¿Puede esta palabra formar parte de un nombre de piloto?
 *
 *  **Todo nombre de personaje de EVE empieza por mayúscula.** Ese único criterio quita las frases
 *  en inglés que se colaban como pilotos sin mantener una lista infinita. Los nombres compuestos
 *  («Bedwin Al Ishira») pasan porque todas sus partes van en mayúscula. Un falso negativo es mucho
 *  mejor que un falso positivo: inventarle nombre a un hostil es peor que admitir que no se sabe. */
const pareceNombre = (s: string) => /^\p{Lu}/u.test(s);

/** ¿Es este token la COLA de un nombre que ya se está escribiendo?
 *
 *  Solo los dígitos, y **solo si hay algo en el buffer**. Un «1» detrás de «Lucy Lee» es su
 *  apellido; un «1» suelto no es nadie. La condición del buffer es lo que impide que
 *  `Y0-1AB  3 hostiles` invente un piloto llamado «3».
 *
 *  ⚠️ Se comprueba DESPUÉS de la jerga, de las naves y del contador `+N`, así que un «x4» o un
 *  «+3» ya se han ido por su rama y no llegan aquí. */
const esColaDeNombre = (s: string, buf: string[]) => buf.length > 0 && /^\d{1,4}$/.test(s);
export type IntelParsed = {
  systems: { id: number; name: string }[];
  pilots: string[];
  ships: { id: number; name: string }[];
  count: number | null;
  isClear: boolean;
  /** ★★ NOMBRES QUE UN SISTEMA PARTIÓ POR LA MITAD — las dos lecturas, sin elegir.
   *
   *  Caso real (2026-09-07): la línea `X-ABCD Dee Yona vector-Z` sacaba un piloto llamado «Dee»…
   *  porque **«Yona» ES un sistema de New Eden** (Essence, highsec 0.8) y cortaba el nombre ahí.
   *  Y «Dee» resuelve a un personaje real, así que el aviso enlazaba al killboard de otra persona.
   *
   *  ⚠️ LAS DOS LECTURAS SON VÁLIDAS y ningún criterio local las separa: «Dee Yona» puede ser un
   *  piloto, o puede ser «el piloto Dee, en el sistema Yona». Así que **no se adivina**: se
   *  proponen las dos y decide quien puede saberlo — el índice local de nombres, y si no, ESI.
   *  Si la larga se confirma, gana y `sysId` deja de contar como sistema en esa línea: no puede
   *  ser las dos cosas. Si no se confirma, no cambia absolutamente nada. */
  pilotAlts: { corto: string; largo: string; sysId: number }[];
};
export function classifyIntel(
  message: string,
  nameIdx: Map<string, NeSystem>,
  shipNames: Map<string, number>,
  /** ★★ NOMBRES QUE ESI YA DIJO QUE NO SON DE NADIE (en minúsculas).
   *
   *  Medido en la base de datos real el 2026-09-07: seguían entrando como pilotos `WH`, `YPW`,
   *  `MC`, `NI`, `I`… — abreviaturas y jerga que la gente escribe EN MAYÚSCULAS, así que pasan
   *  `pareceNombre` con todo el derecho y ninguna lista de jerga a mano las cubre: `YPW` es la
   *  abreviatura de un sistema de TU región, y mañana es otra distinta.
   *
   *  Koru ya tenía la respuesta apuntada. Cada nombre falso se pregunta a ESI UNA vez, se guarda
   *  el «no existe», y desde entonces el troceador deja de proponerlo. Se aprende solo.
   *
   *  Opcional a propósito: si no se pasa, el comportamiento es exactamente el de antes. */
  noExisten?: Set<string>
): IntelParsed {
  const esNadie = (s: string) => !!noExisten && noExisten.has(s.trim().toLowerCase());
  /** ¿Este candidato es demasiado corto para ser un personaje?
   *
   *  EVE no deja nombres de personaje de una o dos letras, así que `I`, `V`, `D` o `+` no pueden
   *  ser nadie — y estaban entrando como hostiles. **Verificado sobre datos reales antes de
   *  escribirlo**: de los 1.706 nombres que ESI resolvió como personas en su base de datos, ni uno
   *  tiene menos de tres caracteres; y la regla descarta 37 de los inexistentes.
   *
   *  ⚠️ VA SOBRE EL CANDIDATO ENTERO, NUNCA PALABRA A PALABRA. Metida en `pareceNombre` habría
   *  roto los nombres compuestos con partículas cortas —«Bedwin **Al** Ishira»— y lo habría hecho
   *  en silencio, partiendo nombres reales por la mitad. El sitio importa más que la regla.
   *
   *  Se cuentan puntos de código, no unidades UTF-16, para no juzgar mal un nombre con caracteres
   *  fuera del plano básico. */
  const demasiadoCorto = (s: string) => [...s.trim()].length < 3;
  const systems: { id: number; name: string }[] = [];
  const ships: { id: number; name: string }[] = [];
  const pilots: string[] = [];
  const pilotAlts: { corto: string; largo: string; sysId: number }[] = [];
  let count: number | null = null;
  let isClear = false;
  const seenSys = new Set<number>();
  const clean = (s: string) =>
    s.replace(/[*.,;:!?()]+$/g, "").replace(/^[*([]+/g, "").trim();
  type Word = { kind: string; id?: number; name?: string; typeId?: number; n?: number; text?: string };
  const classifyWord = (w: string): Word => {
    const raw = w.trim();
    if (!raw) return { kind: "empty" };
    // Ticker de corp/alianza entre paréntesis o corchetes (p. ej. "(海神级)", "[ABC]") → ignorar:
    // no es piloto ni nave; suele ir pegado tras el nombre del piloto.
    if (/^[([{].*[)\]}]$/.test(raw)) return { kind: "ticker" };
    const c = clean(raw);
    if (!c) return { kind: "empty" };
    const lc = c.toLowerCase();
    if (INTEL_CLEAR.has(lc)) return { kind: "clear" };
    // Contador de hostiles: acepta "+N" y "N+" (p. ej. "+4" o "14+").
    const mc = lc.match(/^(?:\+(\d+)|(\d+)\+)$/);
    if (mc) return { kind: "count", n: +(mc[1] ?? mc[2]) };
    if (INTEL_JARGON.has(lc)) return { kind: "jargon" };
    const s = nameIdx.get(lc);
    if (s) return { kind: "sys", id: s.id, name: s.n };
    const tid = shipNames.get(lc);
    if (tid != null) return { kind: "ship", typeId: tid, name: c };
    return { kind: "other", text: c };
  };
  /** ★★ LA NAVE MÁS LARGA QUE EMPIECE AQUÍ. Devuelve cuántas palabras consume.
   *
   *  Nació de un reporte suyo: la línea `3F-GHI Brutix Navy x4 Celestis…` sacaba **un piloto
   *  llamado «Navy»**. El motivo: se clasificaba PALABRA A PALABRA, así que «Brutix» casaba como
   *  nave, cortaba, y «Navy» se quedaba suelto — y como empieza por mayúscula, pasaba por nombre.
   *
   *  Se prueba de más largo a más corto (gana la coincidencia más larga, la misma lección que el
   *  BPC de la Leshak). Y se acepta un **prefijo inequívoco**: en el intel se escribe «Brutix
   *  Navy», no «Brutix Navy Issue», y ese prefijo solo puede ser una nave — comprobado contra las
   *  512 del catálogo. Si el prefijo diera dos candidatas, no se acepta: adivinar la nave del
   *  hostil es peor que no nombrarla. */
  const naveDesde = (
    words: string[],
    i: number
  ): { consume: number; typeId: number; name: string } | null => {
    const max = Math.min(4, words.length - i);
    for (let len = max; len >= 1; len--) {
      const trozo = words.slice(i, i + len).map(clean).filter(Boolean);
      if (trozo.length !== len) continue;
      const frag = trozo.join(" ").toLowerCase();
      const exacta = shipNames.get(frag);
      if (exacta != null) return { consume: len, typeId: exacta, name: trozo.join(" ") };
      // Prefijo: solo vale si hay UNA candidata. Con dos, no se nombra.
      //
      // ★ ANTES ESTO RECORRÍA LAS 512 NAVES EN CADA INTENTO, y un intento es cada palabra × cada
      //   longitud × cada línea. Medido sobre 110.632 líneas reales: **11.848 ms con catálogo
      //   frente a 874 ms sin él** — el 93 % del trabajo del troceador se iba aquí. Y no es un
      //   coste de una vez: el intel en vivo trocea su ventana cada 3 segundos.
      //   El índice de prefijos se construye UNA vez por catálogo (`prefijosDe`) y la búsqueda pasa
      //   a ser una consulta. El resultado es idéntico: se comprobó línea a línea contra la versión
      //   vieja antes de cambiarlo.
      const unica = len > 1 ? prefijosDe(shipNames).get(frag) : undefined;
      if (unica != null) {
        return { consume: len, typeId: unica, name: trozo.join(" ") };
      }
    }
    return null;
  };

  const addSys = (id: number, name: string) => {
    if (!seenSys.has(id)) {
      seenSys.add(id);
      systems.push({ id, name });
    }
  };
  // Es idempotente, así que da igual si la línea venía ya limpia: limpiar dos veces no hace nada.
  // Y va AQUÍ, no al guardar, para que arregle también las miles de líneas ya almacenadas.
  for (const field of limpiarMarcadoEve(message).split(/\s{2,}/).map((f) => f.trim()).filter(Boolean)) {
    const whole = classifyWord(field);
    if (whole.kind === "sys") {
      addSys(whole.id!, whole.name!);
      continue;
    }
    if (whole.kind === "ship") {
      ships.push({ id: whole.typeId!, name: whole.name! });
      continue;
    }
    if (whole.kind === "clear") {
      isClear = true;
      continue;
    }
    if (whole.kind === "count") {
      count = whole.n!;
      continue;
    }
    if (whole.kind === "jargon" || whole.kind === "empty" || whole.kind === "ticker") continue;
    // 'other': si es 1 palabra → piloto; si son varias (espacio simple) → separar reconocidos.
    const words = field.split(/\s+/);
    if (words.length === 1) {
      if (pareceNombre(whole.text!) && !esNadie(whole.text!) && !demasiadoCorto(whole.text!))
        pilots.push(whole.text!);
      continue;
    }
    let buf: string[] = [];
    const flush = () => {
      if (buf.length) {
        // El filtro va también AQUÍ, sobre el nombre ya montado, no solo palabra a palabra: los
        // falsos de varias palabras («Navy issue», «Drifter WH») solo existen una vez unidos.
        const candidato = buf.join(" ");
        if (!esNadie(candidato) && !demasiadoCorto(candidato)) pilots.push(candidato);
        buf = [];
      }
    };
    for (let wi = 0; wi < words.length; wi++) {
      const w = words[wi];
      // 1º LAS NAVES, y de la más larga a la más corta: si no, «Brutix» se lleva la nave y «Navy»
      // se queda suelto haciéndose pasar por piloto.
      const nave = naveDesde(words, wi);
      if (nave) {
        flush();
        ships.push({ id: nave.typeId, name: nave.name });
        wi += nave.consume - 1;
        continue;
      }
      const k = classifyWord(w);
      if (k.kind === "sys") {
        // ★ ¿ESTE SISTEMA ESTÁ PARTIENDO UN NOMBRE? Si veníamos escribiendo un nombre y detrás
        // NO sigue otra palabra de nombre, la lectura larga («Dee Yona») es tan válida como la
        // corta. Se guardan LAS DOS y decide quien pueda comprobarlo; aquí no se elige.
        if (buf.length > 0) {
          const siguiente = words[wi + 1];
          const sigueNombre = siguiente ? pareceNombre(clean(siguiente)) : false;
          if (!sigueNombre) {
            pilotAlts.push({
              corto: buf.join(" "),
              largo: `${buf.join(" ")} ${k.name!}`,
              sysId: k.id!,
            });
          }
        }
        flush();
        addSys(k.id!, k.name!);
      } else if (k.kind === "ship") {
        flush();
        ships.push({ id: k.typeId!, name: k.name! });
      } else if (k.kind === "clear") {
        flush();
        isClear = true;
      } else if (k.kind === "count") {
        flush();
        count = k.n!;
        // ★ «Lurm the Slurm», «Jan van Dijk»: una partícula ENTRE dos partes de un nombre es parte
        //   del nombre. Va ANTES de las ramas de jerga y de minúscula porque el fallo llega por las
        //   dos: `the` es jerga (y con razón: «on the gate»), pero `van` no lo es y se caía igual
        //   por no empezar en mayúscula. Una sola regla, en el único sitio por el que pasan ambas.
      } else if (
        buf.length > 0 &&
        PARTICULAS_NOMBRE.has(clean(w).toLowerCase()) &&
        (() => {
          // Y lo de DETRÁS tiene que seguir pareciendo el mismo nombre: ni nave, ni sistema, ni
          // más jerga. Sin esto, «Juan Perez in SIS-TE» se tragaría el sistema.
          const sig = words[wi + 1];
          if (!sig) return false;
          const limpio = clean(sig);
          return (
            !!limpio &&
            classifyWord(sig).kind === "other" &&
            pareceNombre(limpio) &&
            naveDesde(words, wi + 1) == null
          );
        })()
      ) {
        buf.push(clean(w));
      } else if (k.kind === "jargon" || k.kind === "empty" || k.kind === "ticker") {
        // ★ «... G-Q gate ...»: lo pegado a «gate» es a DÓNDE lleva la puerta, no quién está en
        //   ella. Se quita ese token del nombre que se estaba montando antes de cerrarlo.
        if (k.kind === "jargon" && ESJERGA_GATE.has(clean(w).toLowerCase()) && buf.length > 0) {
          buf.pop();
        }
        // ticker de corp/alianza cierra el nombre del piloto que lo precede
        flush();
      } else if (esColaDeNombre(k.text!, buf)) {
        // ★ UN NÚMERO PEGADO A UN NOMBRE ES PARTE DEL NOMBRE (2026-09-08).
        //
        // Reporte suyo con una línea real: `82-JKL  Lucy Lee 1` sacaba el piloto **«Lucy Lee»** —
        // el `1` se caía porque no empieza por mayúscula y cerraba el nombre. Pero el personaje se
        // llama «Lucy Lee 1». Y no es raro: en su propia lista de hostiles están «Riley1» y
        // «MSZ 006». Los nombres de EVE llevan dígitos con toda normalidad.
        //
        // Es la misma familia que el arreglo de «Yona»: **lo decide el CONTEXTO**. Un token de
        // dígitos solo se traga si YA se está construyendo un nombre; suelto no significa nada.
        // Por eso «Y0-1AB  3 hostiles» sigue sin inventar un piloto llamado «3»: ahí el buffer
        // está vacío porque el sistema acaba de cerrarlo.
        buf.push(k.text!);
      } else if (!pareceNombre(k.text!)) {
        // No empieza por mayúscula → no es nombre: cierra lo que hubiera y se descarta.
        flush();
      } else {
        buf.push(k.text!);
      }
    }
    flush();
  }
  return { systems, ships, pilots, count, isClear, pilotAlts };
}


// --- Reportes de intel por sistema + feed cronológico (a partir de las líneas de chat) ---
export type IntelFeedRow = {
  ts: number;
  author: string;
  message: string;
  sysId: number | null;
  sysName: string | null;
  pilots: string[];
  ships: { id: number; name: string }[];
  count: number | null;
};
export type IntelRep = {
  ts: number;
  author: string;
  message: string;
  name: string;
  pilots: string[];
  ships: { id: number; name: string }[];
  count: number | null;
};

// Parsea las líneas del log en: `rep` = último reporte vigente por sistema (una línea "clear"
// borra el sistema) y `feed` = todas las líneas en orden cronológico inverso (más reciente primero).
export function buildIntelReports(
  lines: IntelLine[],
  nameIdx: Map<string, NeSystem>,
  shipNames: Map<string, number>,
  /** Los nombres que ESI dijo que no existen — ver `classifyIntel`. Se pasa tal cual. */
  noExisten?: Set<string>,
): { rep: Map<number, IntelRep>; feed: IntelFeedRow[] } {
  const rep = new Map<number, IntelRep>();
  const feed: IntelFeedRow[] = [];
  for (const l of lines) {
    const p = classifyIntel(l.message, nameIdx, shipNames, noExisten);
    const primary = p.systems[0];
    feed.push({
      ts: l.ts_ms,
      author: l.author,
      message: l.message,
      sysId: primary?.id ?? null,
      sysName: primary?.name ?? null,
      pilots: p.pilots,
      ships: p.ships,
      count: p.count,
    });
    for (const m of p.systems) {
      if (p.isClear) rep.delete(m.id);
      else
        rep.set(m.id, {
          ts: l.ts_ms,
          author: l.author,
          message: l.message,
          name: m.name,
          pilots: p.pilots,
          ships: p.ships,
          count: p.count,
        });
    }
  }
  feed.reverse(); // más reciente primero
  return { rep, feed };
}


// Trayectoria de un piloto: sistemas (orden cronológico) donde su nombre aparece en el feed de
// reportes. `feed` viene newest-first (como lo devuelve buildIntelReports) → se invierte.
export function pilotTrack(
  name: string,
  feed: IntelFeedRow[],
): { ts: number; sysId: number; sysName: string }[] {
  const lower = name.toLowerCase();
  const asc = [...feed].reverse();
  const track: { ts: number; sysId: number; sysName: string }[] = [];
  for (const f of asc) {
    if (f.sysId != null && f.message.toLowerCase().includes(lower)) {
      track.push({ ts: f.ts, sysId: f.sysId, sysName: f.sysName! });
    }
  }
  return track;
}
