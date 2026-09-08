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
  // ★★ SALIDA DE LA AUDITORÍA de 827.112 líneas suyas (2026-09-08), no de mi imaginación. Estas
  // son las palabras que MÁS se descartaban, con sus cuentas reales. Es la diferencia entre una
  // lista de jerga inventada y una medida: `ess` 7.187 · `fleet` 6.406 · `gang` 6.135 · `loc` 3.450
  // · `shuttle` 3.149 · `spike` 2.370 · `dscan` 2.282 · `cloaked` 2.020 · `bombers` 1.669.
  //
  // ⚠️ `ess` es el caso que más daño hacía: es la estructura de vigilancia del null, PERO existe un
  // personaje llamado ESS — así que ESI decía «sí existe» y Koru le colgó 4.218 avistamientos a una
  // persona que no había estado en ninguno.
  "ess", "fleet", "fleets", "gang", "gangs", "loc", "location", "dscan", "spike", "spiked",
  "cloak", "cloaked", "cloaky", "bomber", "bombers", "probe", "probes", "pod", "pods",
  "scan", "scanned", "tackle", "tackled", "eyes", "eye", "dropper", "droppers", "wormhole",
  "shuttle", "shuttles", "ship", "ships", "combat", "dead", "blue", "blues", "possible",
  // Cortesía y charla: no son intel, y ensucian tanto como la jerga táctica.
  "gj", "ty", "thx", "thanks", "thank", "pls", "please", "lol", "sorry", "sry", "help",
  // ★★ SEGUNDA TANDA DE LA AUDITORÍA (2026-09-08), con sus cuentas reales. Clases de nave que NO
  // son un nombre del catálogo (no tienen typeID, así que `naveApodada` no las alcanza) y más
  // charla: `fight` 780 · `drop` 734 · `blops` 666 · `atm` 666 · `plz` 656 · `heading` 654 ·
  // `confirmed` 643 · `grid` 625 · `reported` 599 · `etc` 388 · `shooting` 375 · `bait` 328 ·
  // `ceptors` 317 · `undock` 241 · `spiking` 216 · `nvm` 213 · `dps` 153 · `intel` 1.082.
  //
  // ⚠️ LA REGLA PARA AÑADIR AQUÍ, que la auditoría hizo comprobable: **mirar antes si el corpus
  // trata esa palabra como PERSONA**. Por eso NO están `kill` (2.258 avistamientos, ESI confirma un
  // personaje llamado Kill) ni `small` ni `navy`, por mucho que parezcan jerga: borrarlas sería
  // repetir lo de `ess`, que le colgó 4.218 avistamientos falsos a alguien de carne y hueso.
  "blops", "ceptors", "ceptor", "dictor", "dictors", "hic", "hics", "logi", "dps", "t3c",
  "grid", "bait", "undock", "undocked", "drop", "dropped", "spiking", "fight", "fighting",
  "attack", "attacking", "shooting", "stealing", "heading", "confirmed", "reported", "intel",
  "meme", "atm", "etc", "nvm", "plz",
  // ★★★ TERCERA TANDA — LA PRIMERA DECIDIDA CON PRUEBAS, NO CON INTUICIÓN (2026-09-08).
  //
  // Idea suya: *«small dudo que sea una persona, tiene más pinta de ser small bubble o small gang»*.
  // Tenía razón, y de ahí salió el diagnóstico que faltaba: **mirar qué palabra va DETRÁS**. ESI no
  // puede decidir esto —confirma que existe alguien llamado «Small», igual que existe «ESS»— pero
  // el corpus sí. Cada una de estas entra con su prueba medida sobre 827.232 líneas:
  //
  //   small  → warp 483 · gang 190 · bubble 75 · stuff 76   (ni un apellido detrás; suya la pista)
  //   kill   → «kill the/him» y «hecate/capsule/hound kill» — verbo. Fichaba 2.287 AVISTAMIENTOS.
  //   good   → «good to» 748 · job 45 · games 31            (fichaba 785)
  //   system → «in system» 1.059 · «left system» 134        (fichaba 157)
  //   all    → «all clear/night/in/on», «they all»          (fichaba 69)
  //   went   → «went to» 395 · «they/he went»               · again → «clr again» 119
  //   maybe / probably → seguidos de «a», «in», «docked», «cloaked»
  //
  // ⚠️ Y lo que NO entra, aunque lo parezca: `navy` es un TROZO DE NAVE («Osprey Navy Issue» 1.498),
  // `lord` es un nombre de pila («Lord Road» 5.525), `moon`, `jack`, `dark`, `max`, `alex` y `love`
  // llevan apellido detrás. Meterlas rompería hostiles reales.
  //
  // ⚠️ Precio asumido: «Good Spirit» sale 78 veces y podría ser alguien. Se pierde para quitar 785
  // falsos. Falso negativo antes que falso positivo, como siempre.
  "small", "kill", "good", "system", "all", "went", "again", "maybe", "probably",
]);

/** ★★ LOS DESPLEGABLES: «Mobile Small Warp Disruptor», «Mobile Depot», «Mobile Tractor Unit».
 *
 *  ⚠️ ESTO NACE DE UNA REGRESIÓN MÍA, medida en su propio intel el mismo día (2026-09-08). Metí
 *  `mobile` en la lista de jerga y partí «Mobile Small Warp Disruptor» por la mitad: `Mobile` se
 *  fue como jerga y quedó un **`Small` suelto**… que es un personaje REAL. Los avistamientos de
 *  «Small» pasaron de 59 a 551: **492 falsos, a una persona de carne y hueso**. Exactamente el
 *  fallo de `ess`, cometido por mí mientras arreglaba el de `ess`.
 *
 *  La lección: una palabra en la lista de jerga no solo se descarta a sí misma — **cambia dónde
 *  empiezan y acaban los nombres que tiene al lado**. Añadir jerga nunca es una operación local.
 *
 *  El arreglo correcto no es quitar la palabra, es reconocer la COSA. En EVE nada se llama «Mobile
 *  algo» salvo los desplegables (comprobado: ninguna nave del catálogo empieza por «mobile »), así
 *  que un campo entero que empieza así es un objeto, no una persona. Es una regla de FORMATO, como
 *  el rótulo «Solar System» — no una lista de nombres que haya que mantener.
 *
 *  Se aplica solo al CAMPO COMPLETO, no palabra a palabra: en «there is a mobile depot here» no
 *  hay campos, y ahí `mobile` y `depot` se caen solos por ir en minúscula. */
const DESPLEGABLE = /^mobile\s+\S/i;

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
/** ★ «Solar System - AB1-CD» es cómo EVE escribe un sistema al pegarlo, y el guion lo separa del
 *  nombre. Sin quitarlo, el troceador saca un piloto llamado **«Solar System»** — sale con
 *  mayúsculas, no es jerga, y no está en el índice porque el índice tiene los nombres a secas.
 *
 *  Se ve poco porque ESI ya contestó que ese nombre no es de nadie y el filtro lo tapa, o sea que
 *  el sistema se afinó solo. Pero eso cuesta una petición por cada persona que instale Koru, y esto
 *  no hay que aprenderlo: es un formato del juego, como el marcado de los enlaces. Se quita el
 *  rótulo y **se conserva el nombre**, que así sí casa como sistema.
 *
 *  ⚠️ AMPLIADO TRAS MEDIRLO (2026-09-08). La regla original exigía el guion, y la auditoría de
 *  827.172 líneas enseñó que **de las 2.977 líneas con el rótulo, 2.810 NO lo llevan** — porque en
 *  el intel real el rótulo va DETRÁS del nombre, no delante:
 *
 *      Sakht Solar System  https://…          Jena Turay  AB1-CD Solar System loky
 *
 *  Consecuencia medida: `System` se fichaba como piloto **152 veces**. Ahora se quita la frase esté
 *  donde esté, con guion o sin él, y **se deja DOBLE espacio en su sitio**: el rótulo separa dos
 *  campos, y sustituirlo por un espacio simple los habría fundido en uno — rompiendo justo la
 *  convención que usa el troceador. `solar` a solas no se toca: solo la frase de dos palabras. */
const ROTULO_SISTEMA = /\s*\bsolar\s+system\b\s*[-–]?\s*/gi;
export function limpiarMarcadoEve(s: string): string {
  return s
    .replace(/<url=[^>]*>([\s\S]*?)<\/url>/gi, "  $1  ")
    .replace(TAGS_EVE, " ")
    .replace(ROTULO_SISTEMA, "  ")
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

/** ★★ APODOS Y ERRATAS DE NAVE — «stilleto», «staber», «manti» (2026-09-08).
 *
 *  La auditoría los sacó de su propio intel, con sus cuentas: `stilleto` 1.021 (¡y encima Koru lo
 *  fichaba como PILOTO 111 veces!), `stileto` 353, `manti` 451, `corms` 300, `staber` 217,
 *  `trasher` 187. Nadie escribe «Manticore» cuando le están saltando encima.
 *
 *  ⚠️ INTENTÉ HACERLO POR PREFIJOS Y ESTABA MAL. Un código de null tiene FORMA —`FORMA_SISTEMA`
 *  exige dígito o guion— y por eso `sistemaAbreviado` es seguro. Un apodo de nave son letras a
 *  secas, igual que una palabra corriente, así que la regla por prefijos convertía **`side` en
 *  Sidewinder** («on the other side») y **`more` en un autobús de evento**. No hay forma de
 *  distinguir una truncación de una palabra inglesa mirando el catálogo. Lo mismo con las siglas:
 *  `vni` funciona, pero **no aparece ni una vez en sus 827.172 líneas**, así que meter ese
 *  mecanismo habría sido añadir riesgo por suposición.
 *
 *  Queda una lista, y una lista se justifica cuando **cada entrada sale de una medición**. Estas
 *  salen. Si mañana la auditoría saca otra, se añade una línea.
 *
 *  ★ LO QUE LA HACE INCAPAZ DE HACER DAÑO: el destino se resuelve CONTRA EL CATÁLOGO. Si FC
 *  renombra una nave, el apodo deja de funcionar en vez de apuntar a un typeID inventado.
 *
 *  ⚠️ HUBO UNA PUERTA DE MAYÚSCULAS AQUÍ Y SE QUITÓ, a propósito. Existía para protegerse del
 *  MECANISMO por prefijos —que se tragaba «BuZZ», de «BuZZ Oelk», por «Buzzard»— y ese mecanismo ya
 *  no está. Con una lista de once entradas juzgadas una a una no hace falta, y estorbaba: `Stilleto`
 *  en mayúscula seguía dando **112 avistamientos falsos**, y él fue claro — *«lo más normal es que
 *  se diga que es la nave, aún no me he cruzado con ningún personaje así llamado»*.
 *  El precio: si alguien se llamara «Manti Loquesea», se perdería. Once entradas, todas revisadas.
 *
 *  ★ LAS DOS QUE RESOLVIÓ ÉL, y que ningún catálogo podía resolver (2026-09-08):
 *
 *  · `retri` (943) era ambigua entre Retribution y Retriever. Su respuesta no fue lingüística sino
 *    del juego: *«Retribution, una Retriever minera no es una amenaza XD»*. Claro — esto es un
 *    canal de intel: **se canta lo que te puede matar**. El catálogo no sabe eso.
 *  · `kiki` (1.822, y Koru fichaba 178 avistamientos con ese nombre) **no es una persona: es la
 *    Kikimora**, la destructora triglaviana. Yo llevaba dos informes buscándole apellido.
 *
 *  ❓ Sin resolver a propósito: `only` («Only Akiga» 102) y el trío `meme tea` / `lemon meme`. No lo
 *  sabe él y yo menos; se quedan como están hasta que alguien lo sepa. */
const APODOS_NAVE: Record<string, string> = {
  stilleto: "stiletto",
  stileto: "stiletto",
  staber: "stabber",
  trasher: "thrasher",
  manti: "manticore",
  corm: "cormorant",
  loky: "loki",
  proc: "procurer",
  maledicrion: "malediction",
  retri: "retribution",
  kiki: "kikimora",
  // `saber` sale 513 veces y NO existe en el catálogo: es «sabre» mal escrito, y una Sabre es la
  // nave que te pone la burbuja — perderla es perder el aviso que más importa.
  saber: "sabre",
};

/** ★★ LAS SIGLAS DE NAVE: `eni` es una Exequror Navy Issue (2026-09-08).
 *
 *  ⚠️ ESTO LO DESCARTÉ HACE UNAS HORAS Y ME EQUIVOQUÉ. Dije que las siglas no valían la pena porque
 *  `vni` **no aparece ni una vez** en sus 827.296 líneas. Era cierto… y generalicé desde un solo
 *  caso sin mirar los demás. Estaban delante, en el mismo informe:
 *
 *      eni  →  997 líneas · Koru la fichaba como PILOTO 487 veces
 *      oni  →  789 líneas · 379 avistamientos falsos
 *
 *  Los vecinos no dejaban lugar a dudas: delante `2`, `2x`, `3`, `+`; detrás `fleet` 57, `gang` 49.
 *  Eso es una nave contada, no una persona.
 *
 *  A diferencia de los apodos, esto NO es una lista a mano: la sigla se calcula del propio catálogo
 *  (iniciales de los nombres de tres palabras o más) y **se rechaza en cuanto dos naves distintas la
 *  reclaman**. Por eso `oni` se queda fuera —Osprey **y** Omen Navy Issue, y él confirmó que en sus
 *  canales «pueden ser ambas»—, igual que `cni` (seis candidatas), `ani` (cuatro) y `tfi` (cuatro).
 *  Adivinar la nave del hostil es peor que no nombrarla.
 *
 *  Comprobado contra las palabras que su intel escribe de verdad: de las 137 siglas sin ambigüedad,
 *  **la única que coincide con una palabra suya es `eni`** — y es la nave. */
const SIGLA_MIN_PARTES = 3;
const apodosCache = new WeakMap<Map<string, number>, Map<string, number>>();
function apodosDeNave(shipNames: Map<string, number>): Map<string, number> {
  const ya = apodosCache.get(shipNames);
  if (ya) return ya;
  // Primero las siglas, calculadas del catálogo; los apodos a mano se ponen DESPUÉS y mandan, que
  // son los que están revisados uno a uno.
  const siglas = new Map<string, number | null>();
  for (const [nombre, tid] of shipNames) {
    const partes = nombre.split(" ");
    if (partes.length < SIGLA_MIN_PARTES) continue;
    const s = partes.map((p) => p[0]).join("").toLowerCase();
    if (s.length < 3) continue;
    const v = siglas.get(s);
    // `null` = dos naves DISTINTAS la reclaman → no vale para nadie. El mismo typeID con dos
    // nombres (dos idiomas) no es ambigüedad: es la misma nave.
    if (v === undefined) siglas.set(s, tid);
    else if (v !== null && v !== tid) siglas.set(s, null);
  }
  const idx = new Map<string, number>();
  for (const [s, tid] of siglas) if (tid != null) idx.set(s, tid);
  for (const [apodo, canonica] of Object.entries(APODOS_NAVE)) {
    const tid = shipNames.get(canonica);
    // Si la nave no está en el catálogo cargado, el apodo simplemente no existe. Callar aquí es
    // correcto: es un idioma sin ese nombre o un SDE viejo, no un error que haya que gritar.
    if (tid != null) idx.set(apodo, tid);
  }
  apodosCache.set(shipNames, idx);
  return idx;
}
/** Solo letras: si trae dígito o guion es un sistema abreviado, no el apodo de una nave. */
const FORMA_APODO = /^[a-z]{3,}$/;
function naveApodada(
  tok: string,
  shipNames: Map<string, number>
): { typeId: number; name: string } | null {
  const lc = tok.toLowerCase();
  // Solo letras y al menos tres: lo demás no puede ser ninguno de los once apodos. La comparación
  // es en minúsculas a propósito — ver arriba por qué se quitó la puerta de mayúsculas.
  if (!FORMA_APODO.test(lc)) return null;
  const idx = apodosDeNave(shipNames);
  const t = idx.get(lc) ?? (lc.endsWith("s") ? idx.get(lc.slice(0, -1)) : undefined);
  return t != null ? { typeId: t, name: tok } : null;
}

/** ★★ LAS ABREVIATURAS DE SISTEMA: «ab1» es AB1C-D. Salió de auditar 827.112 líneas suyas.
 *
 *  En su intel se escriben cortos y constantemente: seis abreviaturas distintas suman más de 13.000
 *  apariciones, y la más usada sale 6.232 veces. Hasta ahora se tiraban enteras, y con ellas la línea:
 *  **«ab1 gate camped in cd2» no producía absolutamente nada** — un aviso perfecto de una puerta
 *  campeada, perdido.
 *
 *  Se acepta solo si **UN único sistema empieza por ese texto**. Es la misma regla que ya usan las
 *  naves con «Brutix Navy»: con dos candidatos no se nombra ninguno, porque mandar a alguien al
 *  sistema equivocado es peor que no decirle nada.
 *
 *  ⚠️ Y ADEMÁS tiene que TENER FORMA de sistema de null: llevar un dígito o un guion. Sin esa
 *  condición, palabras como `fleet` o `spike` podrían casar con el prefijo de algún sistema del
 *  mapa y convertir una frase en una coordenada. La forma es lo que separa una abreviatura de una
 *  palabra que resulta que empieza igual.
 *
 *  ⚠️ Mínimo TRES caracteres. Con dos, la mitad del mapa empieza igual y la unicidad dejaría de
 *  proteger: pasaría a decidir el azar de qué sistemas existen.
 *
 *  ⚠️⚠️ Y TIENE QUE LLEVAR UNA LETRA. Sin esta condición la regla se comía la cola de los nombres:
 *  en `MSZ 006  crow`, el `006` casaba con el prefijo de un sistema real y **partía al piloto en
 *  dos** — exactamente el fallo que él reportó por la mañana y que arreglamos hoy. Un token de solo
 *  dígitos es demasiadas cosas a la vez (una cantidad, el apellido de alguien, una hora) para
 *  dejarle además que sea un sistema. Lo cazó la prueba de regresión, no el razonamiento. */
const FORMA_SISTEMA = /^(?=.*[a-z])(?=.*[\d-])[a-z0-9][a-z0-9-]{2,}$/i;
/** `2x`, `x4`: son cantidades, no sistemas, aunque lleven dígito. */
const ES_CANTIDAD = /^(?:\d+x|x\d+)$/i;
const prefijosSisCache = new WeakMap<Map<string, NeSystem>, Map<string, NeSystem | null>>();
function prefijosSistema(nameIdx: Map<string, NeSystem>): Map<string, NeSystem | null> {
  const ya = prefijosSisCache.get(nameIdx);
  if (ya) return ya;
  const idx = new Map<string, NeSystem | null>();
  for (const [nombre, s] of nameIdx) {
    for (let k = 3; k < nombre.length; k++) {
      const pre = nombre.slice(0, k);
      idx.set(pre, idx.has(pre) ? null : s);
    }
  }
  prefijosSisCache.set(nameIdx, idx);
  return idx;
}
/** El sistema que se esconde detrás de una abreviatura, o `null` si no lo hay o es ambigua. */
function sistemaAbreviado(tok: string, nameIdx: Map<string, NeSystem>): NeSystem | null {
  if (!FORMA_SISTEMA.test(tok) || ES_CANTIDAD.test(tok)) return null;
  return prefijosSistema(nameIdx).get(tok.toLowerCase()) ?? null;
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

/** ★★ LA JERGA QUE ES LA SEGUNDA MITAD DE UN NOMBRE PROPIO (2026-09-08).
 *
 *  `INTEL_JARGON` cierra el nombre que se esté montando, y casi siempre acierta. Pero hay palabras
 *  que son las dos cosas, y entonces **parten a una persona por el medio**:
 *
 *      «Iam Neutral»  →  piloto «Iam»      ·  «CCTV Eyes»  →  piloto «CCTV»
 *
 *  Es el mismo patrón que «Dee Yona», solo que ahí el que cortaba era un sistema. Y se arregla
 *  igual: **no se adivina**, se proponen las dos lecturas en `pilotAlts` y decide `name_cache`.
 *
 *  ★ CÓMO SE ELIGIÓ ESTA LISTA, que es lo único que la justifica. Auditoría de sus 827.356 líneas
 *  (`scripts/audit_jerga_parte.py`): la jerga corta un nombre **94.987 veces**. Casi todo es
 *  correcto, y el decisor que lo separa es **VECES ÷ GENTE DISTINTA** — un apellido lo lleva poca
 *  gente y se repite mucho; una palabra de jerga la lleva detrás todo el mundo:
 *
 *      meme  144 (10 personas)   neutral  96 (13)   eyes 36,5 (88)   fight 24 (10)   she 19 (9)
 *      ────────────────────────── puerta ───────────────────────────────────────────────────────
 *      nv    2,2 (17.618)        in 1,4 (2.057)     loc 1,5 (1.735)  kill 1,7 (7.087)
 *
 *  ⚠️ Y esto tiene GRUPO DE CONTROL, que es lo que le faltó a la dispersión que probamos antes: las
 *  198 palabras de `INTEL_JARGON` son jerga confirmada, y **187 caen por debajo de 10**. Si la señal
 *  no separara lo que ya sabemos separar, no valdría.
 *
 *  ★ `nv` ES EL CASO QUE LO EXPLICA, y lo contestó él, no un catálogo: encabezaba la lista con
 *  38.440 cortes y **no parte nada**. En su intel `nv` significa **«nuevo»** —que los hostiles han
 *  vuelto a aparecer aunque el aviso sea idéntico al de hace un minuto—, por eso lo llevan detrás
 *  17.618 personas distintas. Ninguna lista de vocabulario podía saber eso.
 *
 *  ⚠️ ESTO NO QUITA NINGUNA PALABRA DE LA JERGA. Sigue cortando exactamente igual; lo único que
 *  añade es una PROPUESTA. Si `name_cache` no confirma la lectura larga, no cambia absolutamente
 *  nada — y por eso añadir una palabra aquí no puede repetir lo de `mobile`/`Small`.
 *
 *  ⚠️ La lista es de SU corpus, pero lo que generaliza es la palabra, no el par: que `eyes` pueda
 *  ser un apellido vale para cualquiera; quién se llama «CCTV Eyes» lo decide el `name_cache` de
 *  cada uno. */
const JERGA_PARTE_NOMBRE = new Set([
  // Pasan la puerta por DETRÁS del nombre:
  "meme", "neutral", "eyes", "fight", "she", "lol",
  // …y por DELANTE («Good Spirit», «Combat Scanner», «Eye Janne», «HE XAMU»):
  "combat", "good", "eye", "he", "watch",
]);

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

/** ★★ REGIONES Y CONSTELACIONES — el catálogo que faltaba (2026-09-08).
 *
 *  Salió de la auditoría, no de una idea: entre lo que el troceador tiraba estaban `delve` 662,
 *  `thera` 480, `catch` 357, `querious` 186 y `fountain` 168. Son sitios, y Koru ya los tiene
 *  descargados — `neweden.json` trae 70 regiones y 799 constelaciones y solo usábamos los sistemas.
 *
 *  Es la regla de siempre, dicha por él: **catálogo primero, ESI solo para lo que el catálogo no
 *  sabe, y lo aprendido se guarda.** Aquí no hay nada que aprender ni a quién preguntar: el dato
 *  está en disco desde el primer arranque.
 *
 *  ⚠️ LA NAVE GANA A LA ZONA, SIEMPRE. Nueve nombres son las dos cosas —`Curse`, `Providence`,
 *  `Wyvern`, `Manticore`, `Chimera`, `Phoenix`, `Griffin`, `Hydra`, `Basilisk`— y en un canal de
 *  intel `Basilisk` es el logi que hay que reventar, no la constelación. Por eso la búsqueda de
 *  zona va DESPUÉS de la de nave en `classifyWord`. Con los sistemas no hay ni un choque (medido).
 *
 *  ⚠️ Se reconocen para NO fichar a nadie llamado «Delve», y se devuelven en `zones` porque una
 *  región dicha en un reporte es un dato («van hacia Delve»), no ruido. Todavía no se pinta. */
export type Zona = { id: number; n: string; tipo: "region" | "constelacion" };
export function zonasDe(ne: {
  regions?: { id: number; n: string }[];
  constellations?: { id: number; n: string }[];
}): Map<string, Zona> {
  const m = new Map<string, Zona>();
  // Las constelaciones primero y las regiones después: si alguna vez compartieran nombre, que mande
  // la región, que es lo que la gente nombra en el intel.
  for (const c of ne.constellations ?? [])
    m.set(c.n.toLowerCase(), { id: c.id, n: c.n, tipo: "constelacion" });
  for (const r of ne.regions ?? [])
    m.set(r.n.toLowerCase(), { id: r.id, n: r.n, tipo: "region" });
  return m;
}

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
   *  Si la larga se confirma, gana. Si no se confirma, no cambia absolutamente nada.
   *
   *  ★ AMPLIADO (2026-09-08): el que corta ya no es solo un sistema. **Una palabra de jerga hace
   *  exactamente lo mismo** —«Iam Neutral» daba «Iam»— y el arreglo es el mismo mecanismo, no uno
   *  nuevo: una sola regla en los dos sitios. Por eso `sysId` pasa a ser opcional; vale `null`
   *  cuando quien cortó fue una palabra (ver `JERGA_PARTE_NOMBRE`).
   *
   *  ⚠️ `sysId` NO SE USA todavía en ningún sitio: se guardó para poder descontar el sistema si la
   *  lectura larga ganaba, y eso nunca se llegó a escribir. Se deja porque el dato es correcto y
   *  la decisión sigue abierta — ver la nota de traspaso. */
  pilotAlts: { corto: string; largo: string; sysId: number | null }[];
  /** Regiones y constelaciones nombradas en la línea. Se recogen para no fichar a un piloto
   *  llamado «Delve» y porque «van hacia Delve» es un dato; todavía no se pinta en ningún sitio. */
  zones: Zona[];
  /** Tokens en minúscula, en posición de reporte, de los que NADIE ha dicho nada todavía. No son
   *  pilotos: son PREGUNTAS para ESI. Ver `dudas` dentro de `classifyIntel`. */
  pilotDudas: string[];
};
/** Forma de una duda: letras (con guion o apóstrofo dentro) y al menos tres. Un token con dígitos
 *  es un sistema abreviado o un contador, y preguntarle a ESI por él es gastar una petición. */
const FORMA_DUDA = /^[\p{L}][\p{L}'-]{2,}$/u;
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
  noExisten?: Set<string>,
  /** Regiones y constelaciones (`zonasDe`). Opcional: sin él, el comportamiento es el de antes. */
  zonaIdx?: Map<string, Zona>,
  /** ★★ NOMBRES QUE ESI **SÍ** CONFIRMÓ (en minúsculas). El espejo de `noExisten`.
   *
   *  `pareceNombre` exige mayúscula inicial y su comentario afirmaba que todo nombre de EVE la
   *  lleva. **Es falso, y lo escribí yo**: ESI devolvió `dokin-chan`, `monv`, `foxesbreak`,
   *  `dontcry` con su forma canónica en minúscula. En 827.232 líneas suyas, 299 de 400 palabras
   *  descartadas eran personajes reales — `stefanita` sola sale 5.358 veces.
   *
   *  ⚠️ ESTA LISTA NO DECIDE SOLA, y ese es todo el diseño. Existe un personaje llamado `Know`,
   *  otro `AltS`, otro `Geek` y otro `ESS`. Aceptar cualquier minúscula que ESI confirme devolvería
   *  los 4.218 avistamientos falsos de `ess`. Hace falta además la POSICIÓN — ver `debiles`. */
  existen?: Set<string>
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
  const existeNombre = (s: string) => !!existen && existen.has(s.trim().toLowerCase());
  /** ★★ CANDIDATOS DÉBILES: un token que NO parece nombre (minúscula) pero que ESI confirma como
   *  personaje, y que además ocupaba **su propio campo** — el formato de reporte, no una frase.
   *
   *  Se guardan aparte y solo suben a `pilots` si al terminar la línea **hay un sistema resuelto**.
   *  Esas dos condiciones juntas son lo que separa a una persona de una palabra, medido sobre
   *  827.232 líneas (la columna `+SIS` de la auditoría):
   *
   *      stefanita  5.358 tiradas · 3.572 en campo propio con sistema   → persona
   *      dokin-chan   923 ·   585                                        → persona
   *      know         432 ·     0   (¡y ESI dice que existe!)            → palabra
   *      alts / geek  158 / 171 ·  0  (los dos existen como personaje)   → palabra
   *      are / solar / meme / this  ·  0-1                               → palabra
   *
   *  La idea del sistema resuelto es suya: *«¿y si creamos una condición que diga que si ya se
   *  resuelve el sistema, lo demás se considera como nombres?»*. Tal cual no se sostenía —solo el
   *  79,8 % de las líneas nombran un sistema, y esas van llenas de jerga—, pero **por campo, y con
   *  el catálogo confirmando el nombre, sí**. Es su idea con dos cerrojos.
   *
   *  Precio medido: `puli`, `sonson`, `dontcry`, `mcswaggins` son personas reales que solo aparecen
   *  en frases corridas. **Se pierden.** Falso negativo antes que falso positivo, como siempre. */
  const debiles: string[] = [];
  /** ★★ LA PESCADILLA QUE SE MUERDE LA COLA, Y CÓMO SE CORTA (2026-09-08).
   *
   *  `existen` sale de `name_cache`, y ahí solo hay lo que Koru **ya preguntó**. Koru nunca ha
   *  preguntado por un token en minúscula, porque nunca lo propuso… porque no estaba en la lista.
   *  Resultado: `stefanita` se recupera (se coló capitalizada 18 veces y por eso está en la caché)
   *  pero `dokin-chan` 923, `foxesbreak` 363 o `kjeezy` 282 seguirían perdidos para siempre.
   *
   *  Aquí se apunta la DUDA: un token en posición de reporte, con forma de nombre, del que **nadie
   *  ha dicho nada todavía** — ni que existe ni que no. No se ficha a nadie; solo se propone la
   *  pregunta, igual que `pilotAlts` propone las dos lecturas de «Dee Yona» y deja decidir a ESI.
   *
   *  El coste está medido y es finito: 3.490 tokens en seis años de intel, **una pregunta cada uno
   *  en toda la vida**, y la respuesta —sí o no— se guarda para siempre. */
  const dudas: string[] = [];
  const systems: { id: number; name: string }[] = [];
  const ships: { id: number; name: string }[] = [];
  const pilots: string[] = [];
  const pilotAlts: { corto: string; largo: string; sysId: number | null }[] = [];
  const zones: Zona[] = [];
  const seenZona = new Set<number>();
  const addZona = (w: Word) => {
    if (!seenZona.has(w.id!)) {
      seenZona.add(w.id!);
      zones.push({ id: w.id!, n: w.name!, tipo: w.tipo! });
    }
  };
  let count: number | null = null;
  let isClear = false;
  const seenSys = new Set<number>();
  const clean = (s: string) =>
    s.replace(/[*.,;:!?()]+$/g, "").replace(/^[*([]+/g, "").trim();
  type Word = {
    kind: string; id?: number; name?: string; typeId?: number; n?: number; text?: string;
    tipo?: "region" | "constelacion";
  };
  const classifyWord = (w: string): Word => {
    const raw = w.trim();
    if (!raw) return { kind: "empty" };
    // Ticker de corp/alianza entre paréntesis o corchetes (p. ej. "(海神级)", "[ABC]") → ignorar:
    // no es piloto ni nave; suele ir pegado tras el nombre del piloto.
    if (/^[([{].*[)\]}]$/.test(raw)) return { kind: "ticker" };
    const c = clean(raw);
    if (!c) return { kind: "empty" };
    const lc = c.toLowerCase();
    // Un desplegable ocupa el campo entero («Mobile Small Warp Disruptor»). Va lo primero para que
    // ninguna de las reglas de abajo pueda partirlo y dejar suelto un trozo con forma de nombre.
    if (DESPLEGABLE.test(c)) return { kind: "jargon" };
    if (INTEL_CLEAR.has(lc)) return { kind: "clear" };
    // Contador de hostiles: acepta "+N" y "N+" (p. ej. "+4" o "14+").
    const mc = lc.match(/^(?:\+(\d+)|(\d+)\+)$/);
    if (mc) return { kind: "count", n: +(mc[1] ?? mc[2]) };
    if (INTEL_JARGON.has(lc)) return { kind: "jargon" };
    const s = nameIdx.get(lc);
    if (s) return { kind: "sys", id: s.id, name: s.n };
    const tid = shipNames.get(lc);
    if (tid != null) return { kind: "ship", typeId: tid, name: c };
    // ★ PLURALES: «2x sabres on the other side» no daba nada. En el catálogo está «sabre», y una
    //   Sabre es la nave que te pone la burbuja — perderla es perder el aviso que importa. Solo se
    //   acepta si al quitar la «s» hay coincidencia EXACTA, así que «gnosis» no se rompe.
    if (lc.endsWith("s")) {
      const sing = shipNames.get(lc.slice(0, -1));
      if (sing != null) return { kind: "ship", typeId: sing, name: c };
    }
    // ★ REGIÓN O CONSTELACIÓN. Después de la nave a propósito: `Basilisk` es el logi, no la
    //   constelación (ver `zonasDe`). Y antes de la abreviatura, porque un nombre exacto siempre
    //   manda sobre una coincidencia por prefijo.
    const z = zonaIdx?.get(lc);
    if (z) return { kind: "zona", id: z.id, name: z.n, tipo: z.tipo };
    // ★ ABREVIATURAS DE SISTEMA («ab1» → AB1C-D). Va la ÚLTIMA de las coincidencias: un sistema o
    //   una nave con ese nombre exacto siempre mandan sobre una abreviatura.
    const abrev = sistemaAbreviado(c, nameIdx);
    if (abrev) return { kind: "sys", id: abrev.id, name: abrev.n };
    // ★ APODO DE NAVE («manti», «scimi», «cerbs», «vni»). El ÚLTIMO de todos, y solo sobre lo que
    //   no parece un nombre: ver `naveApodada`. Nunca puede quitar un piloto que hoy salga.
    const apodo = naveApodada(c, shipNames);
    if (apodo) return { kind: "ship", typeId: apodo.typeId, name: apodo.name };
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
    if (whole.kind === "zona") {
      addZona(whole);
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
      // ★★ UN NOMBRE EN MINÚSCULA, PERO SOLO EN POSICIÓN DE REPORTE. Ver `debiles`.
      else if (!demasiadoCorto(whole.text!) && !esNadie(whole.text!)) {
        if (existeNombre(whole.text!)) debiles.push(whole.text!);
        // ★ Y SI NADIE HA PREGUNTADO NUNCA, se apunta la duda. Ver `pilotDudas`.
        else if (FORMA_DUDA.test(whole.text!)) dudas.push(whole.text!);
      }
      continue;
    }
    let buf: string[] = [];
    /** ★ La palabra de jerga que venía JUSTO ANTES de empezar este nombre, si puede ser su primera
     *  mitad: «**Good** Spirit», «**Eye** Janne», «**Combat** Scanner». El caso simétrico del de
     *  arriba, y hace falta recordarla porque cuando el nombre se cierra ya ha pasado hace rato. */
    let prefijoJerga: string | null = null;
    /** La palabra de jerga de la vuelta anterior del bucle, o `null` si no lo era. */
    let jergaAntes: string | null = null;
    const flush = () => {
      if (buf.length) {
        // El filtro va también AQUÍ, sobre el nombre ya montado, no solo palabra a palabra: los
        // falsos de varias palabras («Navy issue», «Drifter WH») solo existen una vez unidos.
        const candidato = buf.join(" ");
        // La lectura larga se propone ANTES del filtro, por lo mismo que en el caso de detrás: si
        // el corto está en `noExisten`, hoy no sale nadie y es cuando más falta hace proponerla.
        if (prefijoJerga) {
          pilotAlts.push({ corto: candidato, largo: `${prefijoJerga} ${candidato}`, sysId: null });
        }
        if (!esNadie(candidato) && !demasiadoCorto(candidato)) pilots.push(candidato);
        buf = [];
      }
      prefijoJerga = null;
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
          // ★★ UN CÓDIGO DE NULL NO ES UN APELLIDO (2026-09-08).
          //
          //  La auditoría de los pares ya aplicados lo sacó: «Alpha» aparecía con OCHO códigos de
          //  sistema distintos detrás, y cada uno se había convertido en un apellido suyo. Eso no
          //  es un nombre partido, es el patrón «persona + dónde está», y ahí la lectura corta era
          //  la BUENA — o sea que el arreglo estaba empeorando esas líneas.
          //
          //  Lo separa la FORMA, sin necesidad de mirar el corpus entero: un sistema con nombre de
          //  lore («Chelien», «Rayl», «Yona») puede ser perfectamente un apellido y se sigue
          //  proponiendo; uno con DÍGITOS es un código, y nadie se apellida así. Es la misma clase
          //  de regla que `FORMA_SISTEMA` o el rótulo «Solar System»: formato, no lista.
          //
          //  ⚠️ Precio asumido: si existiera de verdad alguien con un dígito en el apellido, se
          //  pierde. Falso negativo antes que falso positivo, como siempre.
          if (!sigueNombre && !/\d/.test(k.name!)) {
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
      } else if (k.kind === "zona") {
        // Una región cierra el nombre que se estuviera montando, igual que un sistema. La diferencia
        // es que aquí NO se guardan las dos lecturas: «Fulano Delve» no es el nombre de nadie.
        flush();
        addZona(k);
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
        // ★★ ¿ESTA PALABRA DE JERGA ES LA SEGUNDA MITAD DE UN NOMBRE? Ver `JERGA_PARTE_NOMBRE`.
        //
        //   Va ANTES del `flush()` y antes de la regla de «gate», porque las dos cierran el nombre
        //   y aquí hace falta el buffer todavía lleno. Y se propone AUNQUE el corto no vaya a
        //   sobrevivir al `flush` —«CCTV» está en `noExisten` y se tira— porque ese es justamente
        //   el caso peor: hoy esa línea no ficha a nadie y la persona se pierde entera.
        if (k.kind === "jargon" && buf.length > 0) {
          const palabra = clean(w);
          if (JERGA_PARTE_NOMBRE.has(palabra.toLowerCase())) {
            const corto = buf.join(" ");
            pilotAlts.push({ corto, largo: `${corto} ${palabra}`, sysId: null });
          }
        }
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
        // Si el nombre EMPIEZA aquí y justo antes había una palabra de jerga que puede ser su
        // primera mitad, se guarda para proponer la lectura larga al cerrarlo.
        if (buf.length === 0) prefijoJerga = jergaAntes;
        buf.push(k.text!);
      }
      // Se anota al final de CADA vuelta, incluidas las que no son jerga: así `jergaAntes` significa
      // siempre «la palabra inmediatamente anterior», y no se cuela una jerga de tres tokens atrás.
      jergaAntes =
        k.kind === "jargon" && JERGA_PARTE_NOMBRE.has(clean(w).toLowerCase()) ? clean(w) : null;
    }
    flush();
  }
  // ★ EL SEGUNDO CERROJO. Un candidato débil solo sube a piloto si la línea resolvió un sistema:
  //   sin sistema no hay reporte, y sin reporte no hay a quién estar viendo. `know` tiene 432
  //   apariciones y CERO aquí, que es justo lo que queremos que pase.
  if (systems.length > 0) for (const d of debiles) pilots.push(d);
  // ★★ LA LECTURA LARGA GANA SI EL CATÁLOGO YA LA CONFIRMA — y AQUÍ, no solo en la tarjeta.
  //
  //   Hasta hoy esto vivía únicamente en `useIntel`, o sea que al abrir un aviso ponía «Dee Yona» y
  //   el avistamiento guardado seguía diciendo «Dee». **Dos verdades sobre lo mismo**, que es
  //   exactamente el fallo que ya nos mordió al reconectar un personaje. Resuelto donde trocea, lo
  //   ven los tres consumidores a la vez: la tarjeta, el feed y la reconstrucción del histórico.
  //
  //   No cuesta ninguna petición: solo mira lo que `name_cache` YA contestó. Lo que aún no se ha
  //   preguntado sale por `pilotAlts` y lo recoge el botón «Aprender nombres».
  for (const a of pilotAlts) {
    if (!existeNombre(a.largo)) continue;
    const i = pilots.indexOf(a.corto);
    // Si la corta estaba, la larga la SUSTITUYE: no son dos hostiles, son dos lecturas del mismo.
    if (i >= 0) pilots[i] = a.largo;
    // Y si no estaba —«CCTV» está en `noExisten` y se tiró—, la larga ENTRA: ese es el caso peor,
    // el de la persona que hoy se pierde entera y en silencio.
    else if (!pilots.includes(a.largo)) pilots.push(a.largo);
  }
  // Las dudas siguen el MISMO cerrojo: sin sistema no hay reporte, y sin reporte no hay a quién
  // preguntar. Así la factura de ESI no la paga una frase suelta de charla.
  return {
    systems, ships, pilots, count, isClear, pilotAlts, zones,
    pilotDudas: systems.length > 0 ? dudas : [],
  };
}


/** ★★ LA MISMA LÍNEA, FECHADA DOS VECES POR DOS CLIENTES (2026-09-08).
 *
 *  Reporte suyo con capturas: un aviso salía DOS veces en el feed, a «hace 38s» y «hace 39s». Con
 *  multibox hay un log por cliente y **cada uno fecha el mensaje cuando ÉL lo recibió**, así que
 *  basta con que cruce un segundo para que el dedup —que comparaba el segundo entero— no lo vea.
 *
 *  ★ MEDIDO SOBRE SUS 827.395 LÍNEAS (`scripts/diag_intel_duplicados.py`): **13.777 copias de más,
 *  el 1,67 %**, y el reparto dice dónde cortar sin adivinar:
 *
 *      1 s → 13.468 (11.479 con mensajes de 12+ caracteres) · 2 s → 211 · 3 s → 98 · resto ~17/s
 *
 *  El pico de 1 s es **799 veces** la cola de fondo. La columna de mensajes largos es el grupo de
 *  control: nadie reteclea «Fulano Mengano nv» idéntico en un segundo.
 *
 *  ⚠️ Y su intuición era otra —*«los nv lanza dos mensajes»*— pero el grupo de control la desmintió:
 *  **1,70 % con `nv` frente a 1,81 % sin él**. Se duplica todo por igual. Sin esa cuenta habríamos
 *  ido a buscar un mecanismo que no existe, que es exactamente lo que costó dos sesiones con los
 *  dos canales del overlay.
 *
 *  ⚠️ EL PRECIO: su regla es **un aviso por reporte aunque se repita** (para eso existe el `nv`), y
 *  esta ventana funde también las repeticiones humanas que caigan dentro del segundo. Por la cola de
 *  fondo son ~17 en SEIS AÑOS frente a 13.468 falsas. Por eso NO se ensancha a 2 o 3 segundos.
 *
 *  ⚠️ Va aparte del troceador y NO borra nada de la base: `intel_line` guarda el hecho crudo
 *  precisamente para que las conclusiones se puedan rehacer. Si mañana la regla resulta mala, se
 *  cambia la regla y se reconstruye — no hay filas que recuperar.
 *
 *  Solo vale para líneas EN ORDEN CRONOLÓGICO (que es como las sirve `intel_lines_read`): guarda
 *  dos segundos de claves, no el corpus entero. */
export function creaDedupIntel(): (ts_ms: number, autor: string, mensaje: string) => boolean {
  let secActual = Number.NEGATIVE_INFINITY;
  let actual = new Set<string>();
  let previo = new Set<string>();
  return (ts_ms, autor, mensaje) => {
    const sec = Math.floor(ts_ms / 1000);
    if (sec !== secActual) {
      // Un salto de un segundo conserva el anterior como ventana; uno mayor no puede solaparse.
      previo = sec === secActual + 1 ? actual : new Set<string>();
      actual = new Set<string>();
      secActual = sec;
    }
    const k = `${autor}\u0000${mensaje}`;
    const dup = actual.has(k) || previo.has(k);
    // Se marca AUNQUE sea duplicada: tres clientes repartidos en t, t+1 y t+2 tienen que colapsar
    // en uno, y si el segundo no dejara marca el tercero no vería a nadie.
    actual.add(k);
    return dup;
  };
}

/** ★★ ¿ESTE NOMBRE TIENE DOS LECTURAS? — para DECIRLO, no para preguntarlo (2026-09-08).
 *
 *  Idea suya: *«¿podríamos hacer que en la ficha del hostil el propio piloto determine una duda de
 *  ese tipo? … al menos seguimos siendo sinceros y transparentes»*. Evaluamos el mecanismo completo
 *  —guardar su veredicto— y lo aparcamos con motivo: la alarma no puede esperar a un humano, y una
 *  interfaz que pregunta mal recoge respuestas equivocadas con toda fiabilidad (**él mismo no
 *  reconoció ninguno de los doce casos dudosos que le puse delante**). Esto es la mitad barata: la
 *  transparencia sin la pregunta. Cero tablas, cero decisiones, y ya cumple lo que le importaba.
 *
 *  Un nombre tiene dos lecturas cuando su primera o su última palabra **es también otra cosa**:
 *
 *      «ACG Jita»    → el piloto ACG, en el sistema Jita          (o alguien llamado «ACG Jita»)
 *      «Iam Neutral» → el piloto Iam, y «neutral» como reporte    (o alguien llamado «Iam Neutral»)
 *
 *  Koru YA ha elegido —lo decide `name_cache`, ver `pilotAlts`— y casi siempre acierta. Esto solo
 *  hace visible que hubo una elección, que es lo que separa «acertar» de «fingir que no había duda».
 *
 *  ⚠️ Es una POSIBILIDAD, no una sospecha. Muchos apellidos de EVE son también nombres de sistema
 *  —salen del mismo saco de lore— así que esto va a aparecer en nombres perfectamente sólidos.
 *  Por eso el texto dice «también podría ser» y no «puede estar mal».
 *
 *  ⚠️ NO decide nada ni toca el troceador: es una función pura sobre un nombre ya elegido.
 *  `esSistema` se inyecta para no arrastrar el catálogo hasta aquí y para poder probarla sola. */
export type DudaLectura = {
  /** La lectura corta: el nombre sin la palabra que además es otra cosa. */
  corto: string;
  /** La palabra que tiene doble vida. */
  cola: string;
  /** Qué otra cosa es: un sistema de New Eden o una palabra del intel. */
  tipo: "sistema" | "jerga";
  /** Dónde estaba: al final («ACG Jita») o al principio («Good Spirit»). */
  donde: "detras" | "delante";
};
export function dudaDeLectura(
  nombre: string,
  esSistema: (s: string) => boolean,
): DudaLectura | null {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length < 2) return null;
  const clasifica = (p: string): "sistema" | "jerga" | null => {
    const lc = p.toLowerCase();
    if (esSistema(lc)) return "sistema";
    if (JERGA_PARTE_NOMBRE.has(lc)) return "jerga";
    return null;
  };
  for (const donde of ["detras", "delante"] as const) {
    const i = donde === "detras" ? partes.length - 1 : 0;
    const tipo = clasifica(partes[i]);
    if (!tipo) continue;
    const resto = partes.filter((_, k) => k !== i);
    const corto = resto.join(" ");
    // EVE no admite nombres de una o dos letras: si lo que queda no puede ser nadie, no hay dos
    // lecturas — hay una sola, la larga. Misma regla que `demasiadoCorto` en el troceador.
    if ([...corto].length < 3) continue;
    return { corto, cola: partes[i], tipo, donde };
  }
  return null;
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
  /** Regiones y constelaciones — ver `zonasDe`. Se pasa tal cual, igual que `noExisten`: si uno de
   *  los sitios que trocean no lo recibiera, clasificaría distinto que los demás. */
  zonaIdx?: Map<string, Zona>,
  /** Nombres que ESI sí confirmó — ver `classifyIntel`. Se pasa tal cual. */
  existen?: Set<string>,
): { rep: Map<number, IntelRep>; feed: IntelFeedRow[] } {
  const rep = new Map<number, IntelRep>();
  const feed: IntelFeedRow[] = [];
  for (const l of lines) {
    const p = classifyIntel(l.message, nameIdx, shipNames, noExisten, zonaIdx, existen);
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
