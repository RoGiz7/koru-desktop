// Changelog in-app para el modal "Novedades". Bilingüe (ES/EN). Mantener en cada release:
// añade una entrada nueva ARRIBA con la versión, fecha y viñetas (reutiliza las notas de release).
import { getLang } from "./i18n";

export type ChangelogEntry = { version: string; date: string; es: string[]; en: string[] };

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.32.0",
    date: "2026-07-24",
    es: [
      "💰 Tu botín, valorado solo. Al cerrar un sitio de exploración pega el saque del carguero o de la estación: Koru suma su valor (usa el precio estimado que ya trae EVE al copiar el inventario) y lo guarda en el Histórico. ¿Corriste varias anomalías seguidas y el loot va todo junto? Marca varias a la vez y el total se reparte entre ellas. El explorador por fin ve cuánto saca, no solo qué hace.",
      "🗑️ Y lo que no hiciste, fuera. A veces una firma desaparece porque la corrió otro o caducó en el mantenimiento. Ahora la descartas de un botón, sin que ensucie tu histórico — solo cuenta lo que exploras tú.",
      "🔗 Enlaces a la wiki que ahora sí funcionan. Si juegas con el cliente en español, el nombre del sitio salía en español y la wiki (en inglés) no lo encontraba. Koru lo traduce por detrás: pulsas ↗ y abre la página correcta.",
      "🔊 «Intel en vivo» apagado ahora calla de verdad. Con el interruptor en OFF el intel sigue leyéndose si tienes la capa abierta (ves el feed y los avisos en el mapa), pero ya no suena ni te salta la alerta. Con ON, alerta estés en la sección que estés.",
    ],
    en: [
      "💰 Your loot, valued on its own. When you close an exploration site, paste the haul from your cargo or station: Koru adds up its value (using the estimated price EVE already includes when you copy the inventory) and saves it to your History. Ran several anomalies in a row and the loot is all mixed together? Mark several at once and the total is split between them. Explorers finally see how much they make, not just what they do.",
      "🗑️ And what you didn't run, gone. Sometimes a signature disappears because someone else ran it or it expired at downtime. Now you can discard it with one button, without cluttering your history — only what YOU explore counts.",
      "🔗 Wiki links that actually work now. If you play with the client in Spanish (or any language), the site name came out localized and the (English) wiki couldn't find it. Koru translates it behind the scenes: press ↗ and it opens the right page.",
      "🔊 Turning off “Live intel” now truly goes quiet. With the switch OFF, intel still reads if you have the layer open (you see the feed and warnings on the map), but it no longer beeps or pops the alert. With ON, it alerts wherever you are.",
    ],
  },
  {
    version: "0.31.0",
    date: "2026-07-23",
    es: [
      "📡 Importante: el intel en vivo vuelve a leer aunque cierres clientes. Si juegas con varias cuentas a la vez, cada una escribe su propio registro del canal de intel. Koru se quedaba con uno solo y, al cerrar justo ese cliente, enmudecía —sin dar error, con el indicador en verde «Activo»— aunque otra cuenta siguiera oyendo el canal. Ahora lee a la vez todos los registros vivos del canal. Si alguna vez el intel se te quedó mudo al cerrar una ventana y pensaste que Koru había dejado de funcionar, era esto. Ya está.",
      "🧭 Exploración estrena Histórico. Pega el escaneo de sondas, clasifícalo y, cuando corras un sitio, márcalo como hecho: pasa a tu registro permanente con su botín y su fecha. Las firmas vivas caducan en el mantenimiento diario, pero lo que exploraste queda para siempre — con estadísticas de sitios hechos, botín total y desglose por tipo. El que explora por fin tiene su historial, igual que el que hace PvP.",
      "⏱️ Y con cronómetro: marca cuándo entras en un sitio y cuándo lo terminas, y Koru mide el tiempo dentro y te saca el ISK por hora real de tu exploración.",
      "🗂️ Los sistemas donde tienes firmas pendientes salen como pestañas: saltas de uno a otro sin teclear el nombre, y cierras con una ✕ el que ya no necesites.",
    ],
    en: [
      "📡 Important: live intel reads again even when you close clients. If you play with several accounts at once, each one writes its own log of the intel channel. Koru kept only one and, if you closed that exact client, it went silent — no error, the indicator still green “Active” — even while another account was still hearing the channel. Now it reads all the channel's live logs at once. If intel ever went quiet on you after closing a window and you thought Koru had stopped working, this was it. Fixed.",
      "🧭 Exploration gets a History. Paste your probe scan, classify it and, when you run a site, mark it done: it moves to your permanent record with its loot and date. Live signatures expire at daily downtime, but what you explored stays forever — with stats for sites done, total loot and a breakdown by type. Explorers finally get their log, just like PvP does.",
      "⏱️ With a stopwatch too: mark when you enter a site and when you finish it, and Koru measures the time inside and works out your real ISK per hour of exploration.",
      "🗂️ The systems where you have pending signatures show up as tabs: hop between them without typing the name, and close the ones you're done with using an ✕.",
    ],
  },
  {
    version: "0.30.0",
    date: "2026-07-22",
    es: [
      "🔑 Antes de nada: vuelve a iniciar sesión con «Ubicación». Koru estrena su primer permiso de ESCRITURA en EVE —poner destino en tu piloto automático— y los accesos que ya tenías concedidos no lo incluyen. Es un minuto y solo hay que hacerlo una vez. Si se te olvida no pasa nada: el botón «Enviar a EVE» aparecerá deshabilitado y te dirá exactamente esto.",
      "🚀 Koru ya pone rumbo en tu cliente. Traza la ruta aquí y mándala al juego: un destino, o la ruta entera con todas sus escalas. Se acabó copiar nombres de sistema a mano mirando dos pantallas.",
      "🌉 Tus Ansiblex, por copia y pega. No existe ningún permiso de ESI que los liste —lo comprobamos antes de escribir una línea—, así que la red la declaras tú: pegas la tabla de puentes de tu alianza tal cual, la revisas en una hoja donde se ve qué ha entendido de cada fila, y confirmas. Nada se guarda sin que tú lo veas primero. A partir de ahí tus rutas cuentan con los puentes, y se pintan en verde curvo como en el mapa del juego.",
      "🕳️ Y los wormholes de Thera y Turnur, en vivo. Koru consulta las firmas públicas y las usa para rutar: si cruzar un agujero te ahorra media galaxia, la ruta lo dice, en cian discontinuo. EVE no sabe rutear wormholes, así que al mandarla al juego se pone el destino final y tú das el salto.",
      "🎯 Caza en vivo. Sigue a varios pilotos a la vez —sus avisos se pintan en morado, aparte del rojo genérico— e intercepta a uno: su rastro pasa a rojo y la ruta se re-traza sola cada vez que lo cantan en el chat. El rastro lleva flechas de dirección y la edad del último avistamiento, porque «hace 40 segundos» y «hace 20 minutos» son decisiones opuestas. Y el dato que faltaba para decidir: en cuántos saltos llegas TÚ, contando tus puentes.",
      "🗺️ El mapa, reordenado. Navegación en detalle abajo, una tarjeta con pestañas a la derecha y el intel donde estaba. Las regiones se pliegan y se abren de una en una. Los sistemas que hayas vetado se ven en todas las capas, no solo en la lista — antes tu ruta daba un rodeo y no sabías por qué. Y cada capa lleva su leyenda: un color de un mapa de calor no significa nada sin ella.",
      "👁️ Y que se lea. Los puntos y las líneas ya no engordan al acercar el zoom, los nombres de sistema no se pisan unos a otros, y los tres niveles de detalle (región, constelación, sistema) se encadenan atenuándose en vez de saltar de golpe.",
    ],
    en: [
      "🔑 First things first: sign in again with “Location”. Koru gets its first WRITE permission in EVE — setting a destination in your autopilot — and the access you already granted doesn't include it. It takes a minute and you only do it once. If you forget, nothing breaks: the “Send to EVE” button stays disabled and tells you exactly this.",
      "🚀 Koru can now set course in your client. Plan the route here and send it to the game: a single destination, or the whole route with every stop. No more copying system names by hand across two screens.",
      "🌉 Your Ansiblex network, by copy and paste. There is no ESI permission that lists them — we checked before writing a single line — so you declare the network yourself: paste your alliance's bridge table as it is, review it in a sheet that shows what was understood from every row, and confirm. Nothing is saved before you've seen it. From then on your routes take the bridges into account, and they're drawn as green curves like the in-game map.",
      "🕳️ Plus the Thera and Turnur wormholes, live. Koru reads the public signatures and routes through them: if a hole saves you half the galaxy, the route says so, in dashed cyan. EVE can't route wormholes, so when you send the route it sets the final destination and you make the jump yourself.",
      "🎯 Live hunting. Follow several pilots at once — their reports show in purple, apart from the generic red — and intercept one: his trail turns red and the route re-plots itself every time he's called out in chat. The trail carries direction arrows and the age of the last sighting, because “40 seconds ago” and “20 minutes ago” are opposite decisions. And the number that was missing: how many jumps YOU are away, counting your bridges.",
      "🗺️ The map, rearranged. Navigation detail below, a tabbed card on the right and intel where it was. Regions fold and open one at a time. Systems you've excluded now show on every layer, not just in the list — before, your route took a detour and you couldn't see why. And every layer has its legend: a heatmap colour means nothing without one.",
      "👁️ And made readable. Dots and lines no longer swell as you zoom in, system names don't overlap each other, and the three levels of detail (region, constellation, system) now cross-fade into one another instead of popping.",
    ],
  },
  {
    version: "0.29.0",
    date: "2026-07-15",
    es: [
      "🏭 Mis instalaciones: el registro de tus estructuras. EVE no te enseña los rigs ni los servicios de una estación si no tienes roles, y ESI tampoco los da — por eso las alianzas se pasan hojas de cálculo. Así que lo declaras tú una vez: eliges la estructura y sus rigs, y Koru saca los números del SDE. Nunca te pide un porcentaje: el % que enseña EVE viene redondeado y miente (−5,0 % cuando es −5,04 %). Y para el impuesto, que es el único número que solo está en tus ojos, el asistente te enseña dónde leerlo — porque ese tooltip del juego tiene cuatro porcentajes y tres son trampas.",
      "💰 El coste real del trabajo, al ISK: VEO, índice del sistema en vivo, la bonificación de tu estructura, el impuesto del centro y el recargo de la CCS, línea por línea. Cuadra con el tooltip del juego, y lo comprobamos contra dos jobs reales de distinto tamaño.",
      "✅ Cada cuenta dice hasta dónde llega: ficha completa en verde («cuadra al ítem»), y en ámbar exactamente qué le falta. Lo que no sabemos se calcula como si no existiera, así que la cuenta se queda CORTA, nunca larga. Un rig cuyo alcance no sepamos situar no se aplica, y se dice.",
      "⛏️ El gamelog ya late con cada sincronización. Hasta ahora solo se leía al pulsar «Escanear», así que tus vistas mezclaban datos de ESI recién traídos con líneas del log de hace días. Eso no daba error: daba un CERO creíble — un «Crítico: 0» se lee como «no tuviste ninguno», no como «no lo he mirado». Ahora se pone al día solo, leyendo únicamente lo nuevo. (El reescaneo completo sigue siendo tuyo, en Ajustes: nadie te va a lanzar 40 minutos de trabajo en mitad de una partida.)",
      "🖤 Se acabó la pantalla negra: cualquier error de pintado ya no te deja la ventana muerta y muda — sale el error, su traza y un botón para copiarla.",
      "🐛 Y el que la causaba: tocar el filtro de fechas en Minería mataba la app si tenías años de histórico. Iba perfecto en desarrollo y solo petaba en la versión publicada, así que solo lo sufríais vosotros.",
    ],
    en: [
      "🏭 My facilities: the register of your structures. EVE won't show you a station's rigs or services without roles, and ESI doesn't give them either — that's why alliances pass spreadsheets around. So you declare it once: pick the structure and its rigs, and Koru pulls the numbers from the SDE. It never asks you for a percentage: the % EVE displays is rounded and lies (−5.0% when it's really −5.04%). And for the facility tax — the one number that lives only in your eyes — the wizard shows you where to read it, because that in-game tooltip has four percentages and three of them are traps.",
      "💰 The real job cost, to the ISK: EIV, live system index, your structure's bonus, the facility tax and the CCS surcharge, line by line. It matches the game's tooltip, checked against two real jobs of very different size.",
      "✅ Every figure says how far it reaches: a complete facility in green (“matches to the item”), and in amber exactly what's missing. What we don't know is computed as if it didn't exist, so the figure falls SHORT, never long. A rig whose scope we can't place isn't applied — and we say so.",
      "⛏️ Your gamelog now keeps pace with every sync. Until today it was only read when you hit “Scan”, so your views mixed freshly-pulled ESI data with log lines from days ago. That never threw an error: it produced a believable ZERO — a “Critical: 0” reads as “you had none”, not as “I haven't looked”. Now it catches up on its own, reading only what's new. (The full rescan is still yours, in Settings: nobody's going to drop 40 minutes of work on you mid-fight.)",
      "🖤 No more black screen: a render error no longer leaves the window dead and mute — you get the error, its stack trace and a button to copy it.",
      "🐛 And the bug behind it: touching the date filter in Mining killed the app if you had years of history. It ran perfectly in development and only broke in the published build, so only you ever suffered it.",
    ],
  },
  {
    version: "0.27.1",
    date: "2026-07-14",
    es: [
      "🚨 El intel ya no puede fallar en silencio. Hasta ahora, un intel MUERTO y un intel EN CALMA se veían exactamente igual: «Activo» en verde y cero sistemas. Ahora el panel dice lo que el vigilante está haciendo DE VERDAD: «leyendo 1 log · 27 líneas» en verde, o en rojo/ámbar por qué no lee — sin logs de ese canal, parado, o el error exacto.",
      "🔇 Los errores de lectura dejan de tragarse: antes cualquier fallo se convertía en «0 líneas» sin decir ni pío. Esa mudez es la que nos tuvo dos diagnósticos persiguiendo fantasmas.",
      "🐛 La recencia ya no descarta ficheros: filtra MENSAJES, que es lo suyo. Antes podía tirar el log VIVO en sesiones largas y dejarte sordo hasta relogear.",
      "📘 De regalo, tu biblioteca de blueprints en Industria: tus BPO/BPC con los ME/TE REALES, por categoría y grupo (Fragata, Crucero, Superportanaves…), con buscador. Y al clicar uno, el árbol de materiales con las cantidades exactas que pide EVE — con tu ME y los bonos de tu estructura — cruzado con lo que ya tienes en los hangares.",
    ],
    en: [
      "🚨 Intel can no longer fail in silence. Until now a DEAD intel and a QUIET intel looked identical: green “Active” and zero systems. The panel now shows what the watcher is REALLY doing: “reading 1 log · 27 lines” in green, or in red/amber why it isn't — no logs for that channel, stopped, or the exact error.",
      "🔇 Read errors are no longer swallowed: any failure used to silently become “0 lines”. That muteness is what had two diagnoses chasing ghosts.",
      "🐛 Recency no longer discards files: it filters MESSAGES, which is its job. It could drop the LIVE log in long sessions and leave you deaf until you relogged.",
      "📘 As a bonus, your blueprint library in Industry: your BPOs/BPCs with their REAL ME/TE, by category and group (Frigate, Cruiser, Supercarrier…), with a search box. Click one and get the material tree with the exact amounts EVE asks for — with your ME and your structure's bonuses — cross-checked against what's already in your hangars.",
    ],
  },
  {
    version: "0.27.0",
    date: "2026-07-14",
    es: [
      "🪐 Planetología de verdad: de una tabla plana a tus colonias vivas — la salud de cada extractor con su cuenta atrás, la producción por hora REAL de cada pin y la capacidad/día valorada. Las colonias enfermas suben arriba solas.",
      "⏰ La alarma que faltaba: avisos de extractor configurables a tu gusto (por defecto 8h y 1h, más el aviso de parada), con doble o triple toque. Con su banner ámbar propio que te lleva a Planetología. Se acabó el «se me paró y no me enteré».",
      "🗺️ Tus colonias en el mapa: capa nueva «Tu PI», donde cada sistema se pinta con la salud de su peor extractor. Clic en el sistema y ves el estado de cada colonia, planeta a planeta.",
      "🔗 Las cadenas P0→P4, de un vistazo: los 68 esquemas coloreados por lo que ya produces (verde), lo que podrías hacer con tus insumos (ámbar) y lo que te falta (gris). Clic en cualquiera y salta al planificador.",
      "🎯 Planificador inverso: elige qué quieres fabricar y Koru te dice qué materias primas hacen falta, de qué tipos de planeta salen y qué te falta según TUS colonias. La tabla P0→planetas está verificada contra EVE University, no escrita de memoria.",
      "📈 Memoria de precios: Koru empieza a guardar el histórico de mercado de tu watchlist y lo acumula más allá de lo que ESI recuerda. En cada ítem verás cuánto se aleja su precio actual de su media — el dato desnudo, sin recomendarte nada.",
      "🐛 Dos venenos fuera: los extractores no llegaban a pintarse (una etiqueta que renombraba el campo en el viaje de vuelta), y el registro de avisos ya enviados se vaciaba solo por trocear mal una fecha.",
    ],
    en: [
      "🪐 Planetary Industry, for real: from a flat table to your colonies alive — each extractor's health with its countdown, every pin's REAL hourly output, and daily capacity valued at market price. Sick colonies float to the top on their own.",
      "⏰ The alarm that was missing: extractor alerts you configure yourself (8h and 1h by default, plus the stopped warning), with a double or triple tap. It has its own amber banner that takes you to Planetary. No more “it stopped and I never noticed”.",
      "🗺️ Your colonies on the map: a new “Your PI” layer where each system is painted with the health of its worst extractor. Click a system to see every colony's status, planet by planet.",
      "🔗 The P0→P4 chains at a glance: all 68 schematics coloured by what you already produce (green), what you could make from your inputs (amber), and what you're missing (grey). Click any of them and it loads into the planner.",
      "🎯 Reverse planner: pick what you want to build and Koru tells you which raw materials it needs, which planet types yield them, and what YOUR colonies are missing. The P0→planet table is verified against EVE University, not written from memory.",
      "📈 Price memory: Koru starts keeping your watchlist's market history and accumulates it beyond what ESI remembers. On each item you'll see how far its current price sits from its own average — the bare fact, no advice.",
      "🐛 Two poisons gone: extractors never made it to the screen (a tag renaming the field on the way back), and the record of already-sent alerts emptied itself by slicing a date wrong.",
    ],
  },
  {
    version: "0.26.0",
    date: "2026-07-11",
    es: [
      "💓 Las gráficas laten: cada sincronización y cada escaneo refrescan la vista abierta en sitio, sin parpadeos ni cambiar de sección. Lo que pasa, se ve pasar.",
      "🏢 Retos de corporación en la Bitácora: los proyectos activos de tu corp como cartas de reto, con la barra de todos y TU aportación.",
      "🎯 Cazador: ficha a un objetivo NUEVO por nombre (resolución ESI exacta) — retrato y zKill al momento, y su rastro nace solo cuando aparezca en tu intel.",
      "🚨 El banner de intel ya no se pisa: el reporte más cercano manda y los demás suman «+N más». Y cada aviso renueva el tiempo en pantalla.",
      "📈 Rateo gana la magnitud DPS (medio en combate y pico del mejor segundo, desde 2019) y sus magnitudes de Daño/Fallos ahora son PvE puro: lo PvP vive en su sección.",
      "👑 Tu título oficial equipado, junto a la puntuación de logros de EVE en la Bitácora.",
      "🐛 Limpieza: fuera las filas fósiles de mena irresoluble («#-1») del ledger de minería.",
    ],
    en: [
      "💓 Charts now have a pulse: every sync and every scan refresh the open view in place — no flicker, no section-hopping. What happens, you watch happen.",
      "🏢 Corporation challenges in the Logbook: your corp's active projects as challenge cards, with everyone's bar and YOUR contribution.",
      "🎯 Hunter: file a NEW target by name (exact ESI resolution) — portrait and zKill instantly, and their trail is born the moment they show up in your intel.",
      "🚨 The intel banner no longer overwrites itself: the closest report leads and the rest add up as “+N more”. Each new alert renews its time on screen.",
      "📈 Ratting gains a DPS magnitude (in-combat average and best-second peak, since 2019) and its Damage/Misses magnitudes are now pure PvE: PvP lives in its own section.",
      "👑 Your equipped official title, next to EVE's achievement score in the Logbook.",
      "🐛 Cleanup: fossil rows of unresolvable ore (“#-1”) removed from the mining ledger.",
    ],
  },
  {
    version: "0.25.0",
    date: "2026-07-11",
    es: [
      "⚔️ Cara a cara: tu PvP del log de combate, desde 2019 — daño real dado y recibido contra cada piloto, dron y estructura, incluidas las peleas SIN killmail que zKill no tiene. Con quién, cuánto y cuándo.",
      "📈 La gráfica de Actividad PvP gana la magnitud «Daño PvP (gamelog)»: daño semanal dado/recibido y tus 5 mayores rivales del rango, con su propio eje.",
      "🚨 Intel en vivo: arreglado el silencio a los pocos minutos de sesión — Windows congela la fecha del log mientras EVE escribe y Koru lo daba por viejo. Ya puedes usar la recencia corta que quieras.",
      "♻️ El reescaneo de gamelogs es reanudable: si se cierra la app a mitad, el siguiente escaneo continúa donde iba en vez de empezar de cero.",
      "🐛 Tres venenos históricos fuera: golpes a estructuras registrados como ratas fantasma (el sistema posando de NPC, como si «Jita» fuera una rata), fallos enemigos contados como tuyos, y la fila duplicada con asterisco en Bonificaciones de mando.",
    ],
    en: [
      "⚔️ Face to face: your PvP from the combat log, since 2019 — real damage dealt and taken against every pilot, drone and structure, including fights WITHOUT a killmail that zKill never saw. Who, how much, and when.",
      "📈 The PvP Activity chart gains a “PvP damage (gamelog)” magnitude: weekly damage dealt/taken plus your top-5 rivals in range, on its own axis.",
      "🚨 Live intel: fixed going silent minutes into a session — Windows freezes the log's timestamp while EVE writes and Koru deemed it stale. Use whatever short recency you like.",
      "♻️ Gamelog rescans are resumable: if the app closes mid-scan, the next scan continues where it left off instead of starting over.",
      "🐛 Three historical poisons removed: structure hits recorded as ghost rats (the system posing as an NPC, as if “Jita” were a rat), enemy misses counted as yours, and the starred duplicate row in Command bursts.",
    ],
  },
  {
    version: "0.24.1",
    date: "2026-07-10",
    es: [
      "🎚️ Filón recalibrada con datos reales: los umbrales estimados dejaban el oro a 200× de un minero veterano. Ahora 100k / 1M / 10M — tu nivel y su fecha se recolocan solos, retroactivos.",
    ],
    en: [
      "🎚️ Motherlode recalibrated with real data: the estimated thresholds left gold 200× away from a veteran miner. Now 100k / 1M / 10M — your tier and its date reposition themselves, retroactively.",
    ],
  },
  {
    version: "0.24.0",
    date: "2026-07-10",
    es: [
      "🎖️ Tus condecoraciones de corp, dibujadas de verdad: Koru compone cinta y medallón capa a capa (forma, tinte y orden exactos del juego) a partir de los datos de ESI.",
      "📁 Las texturas salen de TU instalación de EVE: en Ajustes → «Medallas de corp», Koru localiza la SharedCache solo (o eliges la carpeta) y pulsas «Preparar medallas» una vez. Nada del juego viaja con Koru.",
      "🥇 La misma medalla otorgada varias veces se agrupa en una tarjeta con «×N» y cada entrega con su fecha y su motivo.",
      "⚖️ Aviso legal en Ajustes: EVE Online © Fenris Creations (FC).",
    ],
    en: [
      "🎖️ Your corp decorations, actually drawn: Koru composes ribbon and medallion layer by layer (the game's exact shapes, tint and stacking) from ESI data.",
      "📁 Textures come from YOUR EVE install: in Settings → “Corp medals”, Koru finds the SharedCache on its own (or you pick the folder) and you press “Prepare medals” once. Nothing from the game ships with Koru.",
      "🥇 The same medal awarded multiple times now groups into one card with “×N”, each award with its date and reason.",
      "⚖️ Legal notice in Settings: EVE Online © Fenris Creations (FC).",
    ],
  },
  {
    version: "0.23.0",
    date: "2026-07-10",
    es: [
      "🎖️ Ocho medallas nuevas del gamelog, con desbloqueo retroactivo: Capataz y Voz de mando (módulos de mando), Filón (crítico minero), Chatarrero (salvage), Prospector (sistemas distintos minados), Trotamundos (saltos), Demoledor (golpes wrecking) y Artillero (daño total).",
      "🎯 Rateo gana dos magnitudes: Calidad del golpe (seis escalones de Roza a Destruye, dados o recibidos) y Salvage (restos recuperados e intentos fallidos), de todo tu histórico.",
      "⛏️ Minería: tabla «Residuo por mena» (la mena que tu módulo destruyó, con su % perdido calculado solo contra la época en que el log lo detalla) y «Bonificaciones de mando» (pulsos de foreman y a cuántos llegaron).",
      "✨ El aviso de logros nuevos usa los mismos iconos de EVE que el medallero.",
      "📝 Este modal de Novedades recupera las entradas de la 0.21.0 y la 0.22.0 que faltaban.",
      "🐛 Arreglado: la misma condecoración otorgada dos veces rompía el medallero de corp; y retirado un resto de «Escanear» huérfano en Trabajos y proyectos (el escaneo vive en Configuración).",
    ],
    en: [
      "🎖️ Eight new gamelog medals, retroactively unlocked: Foreman and Voice of Command (command bursts), Motherlode (mining crits), Scrapper (salvage), Prospector (distinct systems mined), Globetrotter (jumps), Wrecker (wrecking hits) and Gunner (total damage).",
      "🎯 Ratting gains two magnitudes: Hit quality (six steps from Grazes to Wrecks, given or taken) and Salvage (wrecks recovered and failed attempts), across your whole history.",
      "⛏️ Mining: “Residue by ore” table (the ore your module destroyed, with its % lost computed only against the era the log details it) and “Command bursts” (foreman pulses and how many they reached).",
      "✨ The new-achievements banner now uses the same EVE icons as the medal case.",
      "📝 This What's-new dialog recovers the missing 0.21.0 and 0.22.0 entries.",
      "🐛 Fixed: the same decoration awarded twice broke the corp medal case; and removed an orphaned “Scan” leftover in Jobs & projects (scanning lives in Settings).",
    ],
  },
  {
    version: "0.22.0",
    date: "2026-07-10",
    es: [
      "⛏️ Minería «Por sistema» desde 2019: el desglose se empalma con el gamelog más allá de la ventana de ESI, valorado en el modo que tengas puesto (m³, bruto, comprimido, 85%), con el % del extraído que pudo situarse.",
      "💰 Rateo: columna «Bruto (gamelog)» en el detalle por sistema + sistemas anteriores a tu histórico de wallet. Donde el dato no existe va un guion, nunca un cero — y la vista advierte que cobrado y bruto no son comparables.",
      "🎯 Daño y Fallos por arma, de todo tu histórico: cuánto pegaste con cada arma o dron y cuántas veces fallaste, desde 2019. (Con qué arma mataste no se inventa: el gamelog registra daño, no muertes.)",
      "👑 Ratas especiales (oficiales, capitales, faction) con magnitud y eje propios — junto a miles de ratas normales eran una línea plana en el cero.",
      "🐛 Fin de seis años de ceros falsos en Ratas e ISK/rata: el eje se recorta a donde el dato existe. Un cero afirma «no ocurrió»; el hueco dice «no se sabe».",
      "📈 Las cuentas van rectas de punto a punto (la curva dibujaba 8,2 ratas donde hubo 8); los ISK, continuos, siguen suavizados.",
      "⚡ El intel lee solo lo que el log ha crecido, en vez de releer el fichero entero cada tres segundos.",
    ],
    en: [
      "⛏️ Mining “By system” since 2019: the breakdown splices with the gamelog beyond ESI's window, valued in your current mode (m³, raw, compressed, 85%), showing the % of extraction that could be placed.",
      "💰 Ratting: “Gross (gamelog)” column in the per-system detail + systems older than your wallet history. Missing data shows a dash, never a zero — and the view warns that earned and gross aren't comparable.",
      "🎯 Damage and Misses per weapon, across your whole history: how hard you hit with each weapon or drone and how often you missed, since 2019. (Which weapon got the kill isn't invented: the gamelog records damage, not deaths.)",
      "👑 Special rats (officers, capitals, faction) get their own magnitude and axis — next to thousands of normal rats they were a flat line at zero.",
      "🐛 End of six years of false zeros in Rats and ISK/rat: the axis now trims to where data exists. A zero claims “it didn't happen”; a gap says “unknown”.",
      "📈 Counts now go straight from point to point (the curve drew 8.2 rats where there were 8); ISK, being continuous, stays smoothed.",
      "⚡ Intel reads only what the log has grown, instead of re-reading the whole file every three seconds.",
    ],
  },
  {
    version: "0.21.0",
    date: "2026-07-10",
    es: [
      "📍 Nuevo bloque «Dónde» en Reconstrucción: dónde rateaste, minaste y peleaste, por sistema y desde 2019, cruzando cada evento del gamelog con el canal Local. Cada ranking muestra su % de cobertura real.",
      "🗂️ 596 gamelogs huérfanos rescatados (2019–2021, 294 MB): los anteriores a feb-2021 no llevan el ID del personaje y se descartaban; su dueño estaba en el chatlog de la misma sesión. Si hay duda, no se adivina.",
      "🐛 Ratas que salían en español (una sola línea invertida en 6,6 GB envenenaba el diccionario; ahora manda el catálogo oficial: 6.192 NPC), «Veldspar*» como mena fantasma y «PS-94K*» partiendo su sistema en dos — los tres se corrigen solos, sin reescanear.",
      "📈 Eje Y con números redondos (adiós a etiquetas como 438.300,75) y el desperdicio de minería pintado bajo cero: es mena destruida, se lee como la pérdida que es.",
    ],
    en: [
      "📍 New “Where” block in Reconstruction: where you ratted, mined and fought, per system since 2019, by crossing each gamelog event with the Local channel. Each ranking shows its real coverage %.",
      "🗂️ 596 orphan gamelogs rescued (2019–2021, 294 MB): files before Feb 2021 lack the character ID and were discarded; their owner was in the same session's chatlog. When in doubt, no guessing.",
      "🐛 Rat names showing in Spanish (a single reversed line in 6.6 GB poisoned the dictionary; the official catalogue now rules: 6,192 NPCs), “Veldspar*” as a ghost ore, and “PS-94K*” splitting its system in two — all three self-heal, no re-scan needed.",
      "📈 Round numbers on the Y axis (goodbye to labels like 438,300.75) and mining waste drawn below zero: it's destroyed ore, read as the loss it is.",
    ],
  },
  {
    version: "0.20.1",
    date: "2026-07-07",
    es: [
      "📊 Apartado Logis: tabla con columnas Personaje · Nave · Módulo y HP por escudo/blindaje/casco (con iconos reales de los módulos de rep), mostrando solo jugadores reales.",
      "📈 Gráfica con desglose por Personaje / Nave / Módulo (top 8) cruzando fecha y HP, con selector Dado/Recibido — ve quién te repó, con qué nave y qué módulo, a lo largo del tiempo.",
      "🎨 Navegación rediseñada como pestañas con iconos de EVE (Comercio, PvE, Industria, Personaje) y Logis con su propio espacio.",
      "🤝 Curación fiel a jugadores: los reps de drones/NPC/estructuras ya no inflan los totales.",
      "🛡️ Datos a prueba de borrados: tu histórico ya escaneado sobrevive aunque borres o muevas la carpeta de logs (o cambies de PC); el reprocesado solo ocurre al reescanear.",
      "🗑️ Panel de Logi retirado de Bitácora: su sitio es el apartado Logis.",
    ],
    en: [
      "📊 Logis section: table with Character · Ship · Module columns and HP by shield/armor/hull (with the actual rep-module icons), showing real players only.",
      "📈 Breakdown chart by Character / Ship / Module (top 8) across date and HP, with a Given/Received toggle — see who repaired you, with which ship and module, over time.",
      "🎨 Redesigned navigation as tabs with EVE icons (Trade, PvE, Industry, Character) and Logis with its own space.",
      "🤝 Player-faithful healing: drone/NPC/structure reps no longer inflate the totals.",
      "🛡️ Deletion-proof data: your already-scanned history survives even if you delete or move the logs folder (or switch PCs); reprocessing only happens on re-scan.",
      "🗑️ Logi panel removed from the Logbook: its home is the Logis section.",
    ],
  },
  {
    version: "0.20.0",
    date: "2026-07-06",
    es: [
      "🏥 Logi (Fase B): lee tu reparación remota (escudo/blindaje/casco) del log de combate del juego — dato que ESI no expone.",
      "Nuevo dominio de medallas «Apoyo»: Escudero / Chapista / Soldador — medallas para quien da reps (escudo/blindaje/casco).",
      "Apartado «Logis»: gráfica con filtros día/semana/mes/año + líneas Total dado/recibido y por tipo (activables) + histórico de a quién curaste y de quién recibiste, con retrato del piloto e icono de su nave.",
      "El escaneo lee también la subcarpeta «old» de Gamelogs → años de histórico, no solo lo reciente.",
      "⚙️ Pasa por Configuración: confirma la carpeta de logs de EVE (un clic la deja lista para Intel y gamelogs) y pulsa Escanear. Te dice si ya está escaneado o pendiente.",
      "Nuevas métricas de proyecto: curación dada y reps recibidas (escudo/blindaje/casco). Elige la carpeta de gamelogs y pulsa Escanear.",
      "Lector incremental: los gamelogs se leen una sola vez; después solo lo nuevo (rendimiento).",
    ],
    en: [
      "🏥 Logi (Phase B): reads your remote repairs (shield/armor/hull) from the game combat log — data ESI doesn't expose.",
      "New “Support” medal domain: Shield Warden / Field Mender / Welder — medals for those who give reps (shield/armor/hull).",
      "“Logi” section: chart with day/week/month/year filters + Total given/received and per-type lines (toggleable) + who-you-healed / who-healed-you history with each pilot's portrait and ship icon.",
      "New project metrics: healing given and reps received (shield/armor/hull). Pick your gamelogs folder and hit Scan.",
      "Incremental reader: gamelogs are read once, then only new content (performance).",
      "⚙️ Head to Settings: confirm your EVE logs folder (one click sets it up for Intel and gamelogs) and hit Scan. It shows whether it's already scanned or pending.",
    ],
  },
  {
    version: "0.19.0",
    date: "2026-07-06",
    es: [
      "✨ Novedades: este mismo aviso — al actualizar verás de un vistazo los cambios de cada versión.",
      "🖼️ Iconos EVE por carrera en los trabajos por libre (Explorer, Industrialist, Enforcer, Soldier of Fortune).",
    ],
    en: [
      "✨ What's new: this very dialog — see each version's changes at a glance on update.",
      "🖼️ EVE icons per career in freelance jobs (Explorer, Industrialist, Enforcer, Soldier of Fortune).",
    ],
  },
  {
    version: "0.18.4",
    date: "2026-07-06",
    es: [
      "🎯 Proyectos personales con filtros: nave, mineral, sistema, personaje o corporación.",
      "Multi-selección y familias (p. ej. todo el Mercoxit); objetivo con unidad (Miles/Millones/B).",
      "Cuentan desde su creación; modos de minería: valor, unidades, volumen (m³) o ISK reproceso 85%.",
      "🏆 Al completar: fanfarria, notificación y archivo en «Completados» con fecha.",
      "🎯 Caza selectiva: proyectos para cazar a un personaje o corporación de tu historial.",
      "🖼️ Iconografía EVE en proyectos personales, de corporación y trabajos por libre.",
    ],
    en: [
      "🎯 Personal projects with filters: ship, ore, system, character or corporation.",
      "Multi-select and families (e.g. all Mercoxit); target with unit (Thousands/Millions/B).",
      "Count from creation; mining modes: value, units, volume (m³) or reprocess ISK 85%.",
      "🏆 On completion: fanfare, notification and archive in “Completed” with date.",
      "🎯 Selective hunt: projects to hunt a character or corp from your history.",
      "🖼️ EVE iconography in personal, corporation and freelance projects.",
    ],
  },
];

// Compara "0.18.4" vs "0.18.3" numéricamente por segmentos. >0 si a>b.
export function cmpVer(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

// Entradas con lastSeen < versión <= current, de más nueva a más vieja.
export function entriesSince(current: string, lastSeen: string): ChangelogEntry[] {
  return CHANGELOG.filter((e) => cmpVer(e.version, lastSeen) > 0 && cmpVer(e.version, current) <= 0).sort(
    (a, b) => cmpVer(b.version, a.version),
  );
}

// La entrada exacta de una versión (para mostrar en el primer arranque con la feature).
export function entryFor(version: string): ChangelogEntry[] {
  return CHANGELOG.filter((e) => cmpVer(e.version, version) === 0);
}

// Viñetas en el idioma actual de la app.
export function bullets(e: ChangelogEntry): string[] {
  return getLang() === "en" ? e.en : e.es;
}
