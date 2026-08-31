// Changelog in-app para el modal "Novedades". Bilingüe (ES/EN). Mantener en cada release:
// añade una entrada nueva ARRIBA con la versión, fecha y viñetas (reutiliza las notas de release).
import { getLang } from "./i18n";

export type ChangelogEntry = { version: string; date: string; es: string[]; en: string[] };

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.47.0",
    date: "2026-08-26",
    es: [
      "📘 PLAN DE ESTUDIOS: ¿a cuál de tus personajes le pongo esto? El juego te dice cuánto tarda un plan en el piloto que tienes delante. Si llevas varios, la pregunta de verdad es otra. Pega un plan de habilidades —tal cual lo copia EVE— y Koru te enseña a TODOS tus personajes ordenados por quién lo termina antes, con lo que ya tiene cada uno y los puntos que le faltan. Y puedes desplegar cualquiera para ver exactamente qué skills le quedan, a qué nivel y con cuántos puntos cada una: el total no es un número que haya que creerse, es uno que puedes comprobar contra el juego línea a línea.",
      "⏱ El ritmo de estudio, MEDIDO y no estimado. Calcular cuánto tarda una habilidad tiene una trampa: los implantes y los aceleradores cambian la velocidad, y del acelerador no hay forma de enterarse desde fuera. Así que Koru no lo estima: lee la cuenta que ya ha hecho el servidor para lo que estás entrenando ahora mismo y de ahí saca tu velocidad real, con todo dentro. Cada habilidad se calcula además con su propio par de atributos, que es por lo que dos skills con los mismos puntos pueden tardar distinto. Y si un personaje no está entrenando nada, no hay velocidad que medir: se dice, en vez de inventarla.",
      "👤 LA FICHA DE PILOTO: quién es esa persona para ti. Pincha el nombre de cualquiera —en una op grabada, en un chat, en el mapa, en tus kills— y se abre una tarjeta con todo lo que tu histórico sabe de él: cuántas veces habéis volado juntos y desde qué año, cuántas ops tuyas ha acompañado y con qué naves, cuántos mensajes os habéis cruzado, si se te ha cruzado en el intel y dónde suele aparecer, y las notas que le tengas puestas. Seis rincones distintos de Koru contestando por fin a la misma pregunta, en un sitio. Y los nombres son clicables en toda la aplicación, con el mismo subrayado en todas partes para que se vea que lo son.",
      "⚡ Koru va notablemente más rápido. Volver a una sección ya no es esperar: se pinta al instante lo último conocido mientras se relee por detrás, con la misma fidelidad de siempre. Y por el camino apareció un despilfarro de los gordos: los catálogos del juego —los nombres de objetos, el mapa de New Eden, los planos— se descargaban ENTEROS cada vez que entrabas en una sección. Ahora se leen una vez por sesión y se comparten. En Industria eran tres megas y medio en cada visita.",
      "🏅 Medallas de mando y el podio de cada op. La Bitácora estrena un dominio nuevo para quien manda: tu primera silla como comandante, las horas acumuladas al mando, el pico de gente que has llevado a la vez y las rachas de la flota. Y cada op grabada corona a los suyos por facetas —el que más daño metió dentro de los kills de la flota, el de los golpes finales, el que aguantó de principio a fin, el que se comió la presión— contando solo lo que se puede medir para todos por igual.",
      "🧊 El balance de una op ya no se puede perder. Cuando una operación termina, sus números quedan congelados en tu base de datos la primera vez que los miras. A partir de ahí sobreviven a limpiezas y copias de seguridad, y no cambian aunque los registros del juego se borren con el tiempo. Solo se congela si de verdad hubo algo que leer: guardar un balance vacío sería convertir la ceguera en un dato.",
      "🕓 Si EVE está caído, Koru lo dice. Abrir la aplicación durante un mantenimiento y ver «Cargando…» eternamente era mentira: no estaba cargando, esperaba a un servidor caído que Koru ya sabía que estaba caído. Ahora lo declara en cualquier sección, y aclara que tu histórico local se sigue viendo entero.",
      "🔍 Detalles que faltaban: un buscador de sistemas en el propio mapa, flotando sobre cualquier capa; en Assets, el nombre de la nave que contiene algo ya es lo que se pulsa para ver su fiteo (antes había que acertarle a un iconito); desde la ficha de un piloto se salta directo a vuestra conversación; y una copia de plano en el botín pegado ya no se confunde con la nave que fabrica.",
    ],
    en: [
      "📘 SKILL PLAN: which of your characters should get this? The game tells you how long a plan takes on the pilot in front of you. If you fly several, the real question is a different one. Paste a skill plan —exactly as EVE copies it— and Koru shows ALL your characters sorted by who finishes it soonest, with what each already has and the points they're missing. You can expand any of them to see exactly which skills they still need, to what level and with how many points each: the total isn't a number you have to trust, it's one you can check against the game line by line.",
      "⏱ Training speed, MEASURED rather than estimated. Working out how long a skill takes has a catch: implants and boosters change the speed, and there's no way to find out about a booster from outside. So Koru doesn't estimate it: it reads the maths the server has already done for whatever you're training right now and derives your real speed from that, with everything included. Each skill is also calculated with its own attribute pair, which is why two skills with the same points can take different times. And if a character isn't training anything, there's no speed to measure: it says so instead of making one up.",
      "👤 THE PILOT CARD: who is this person to you? Click anyone's name —in a recorded op, in a chat, on the map, in your kills— and a card opens with everything your history knows about them: how many times you've flown together and since what year, how many of your ops they've joined and in what ships, how many messages you've exchanged, whether they've crossed your intel and where they usually turn up, and any notes you've written about them. Six different corners of Koru finally answering the same question, in one place. And names are clickable across the whole app, with the same underline everywhere so you can tell.",
      "⚡ Koru is noticeably faster. Returning to a section is no longer a wait: the last known data is painted instantly while it's re-read behind, with the same fidelity as always. And along the way a big waste turned up: the game's catalogues —item names, the New Eden map, blueprints— were being downloaded IN FULL every time you entered a section. Now they're read once per session and shared. In Industry that was three and a half megabytes on every visit.",
      "🏅 Command medals and each op's podium. The Log gains a new domain for whoever commands: your first seat as FC, the hours accumulated in command, the peak headcount you've led at once and the fleet's streaks. And every recorded op crowns its own by facets —who dealt the most damage inside the fleet's kills, who landed the final blows, who stayed from start to finish, who soaked up the pressure— counting only what can be measured for everyone alike.",
      "🧊 An op's balance can no longer be lost. When an operation ends, its numbers are frozen into your database the first time you look at them. From then on they survive cleanups and backups, and they don't change even if the game's logs are deleted over time. It only freezes if there really was something to read: saving an empty balance would turn blindness into a fact.",
      "🕓 If EVE is down, Koru says so. Opening the app during maintenance and seeing “Loading…” forever was a lie: it wasn't loading, it was waiting for a server that Koru already knew was down. Now it says so in any section, and makes clear that your local history is still fully visible.",
      "🔍 Missing details: a system search box on the map itself, floating over any layer; in Assets, the name of the ship holding something is now what you click to see its fit (before you had to hit a tiny icon); from a pilot's card you jump straight to your conversation; and a blueprint copy in pasted loot is no longer mistaken for the ship it builds.",
    ],
  },
  {
    version: "0.46.0",
    date: "2026-08-22",
    es: [
      "▶️ REPRODUCE tu op sobre el mapa. El botón «Reproducir en el mapa» de cualquier grabación convierte New Eden en la sala de proyección: los anillos verdes de tu flota se mueven por el mapa como se movieron aquella noche, los cantos de intel pulsan en rojo en su sistema y a su hora, y los mandos —play, pausa, velocidad, la barra con cada kill y cada aviso marcados— te dejan rebobinar el momento exacto. Nadie ha podido volver a ver su flota moverse. Ahora sí.",
      "🛰 FLOTAS: graba la op que mandas. Nueva sección con un botón y una idea: los killmails no cuentan una flota — un logi que se pasa la noche reparando jamás aparece en ellos. Grabando el roster mientras la mandas (un sondeo cada 30 segundos), los logi, los ojos y los que se quedan atrás un salto quedan registrados por construcción. Solo puede grabar el comandante: a quien no manda, EVE no le deja leer los miembros — y la sección te lo dice de frente en vez de fallar en silencio. Mientras grabas, la composición en vivo: quién va con quién por alas y escuadras, en qué nave y dónde, sin abrir la ventana de flota del juego.",
      "🎞 Tus ops: la película de cada grabación. Cada op queda guardada y se puede releer como lo que fue: una historia. La cinta de presencia —cada piloto una banda de color por nave; los reships y las salidas se ven como cortes, sin leer nada— preside la vista, y debajo, por pestañas: la película (quién entró y desde dónde, quién saltó a dónde, quién cambió de nave, quién atracó… y los kills y pérdidas intercalados a su hora), el combate (daño por piloto golpe a golpe desde tus registros del juego, y el cara a cara con cada rival), el logi, el PvE en sumatorio y la composición final. Dos honestidades cosidas: los huecos sin mirar se declaran («no es cero actividad, es que no se vio»), y cada métrica dice su alcance en vez de fingir que lo ve todo.",
      "🗺 Tu flota, en verde sobre el mapa. Mientras hay una grabación en marcha, los sistemas con los tuyos llevan un anillo verde con el recuento — sobre CUALQUIER capa, intel incluido, porque los tuyos no visten de hostil en un mapa donde el naranja significa pelea. Y en la tarjeta derecha, una pestaña «Flota» con el roster agrupado por sistema, al lado del feed: lo tuyo y lo que se canta alrededor, en la misma mirada.",
      "📡 El intel, tejido en la película. Los cantos del chat de inteligencia en sistemas donde estaba la flota aparecen DENTRO de la cronología de la op, en rojo y a su hora exacta, entre los saltos y los kills. Es la pregunta que hasta ahora no se podía responder: ¿el aviso estaba ahí y no lo vimos, o no había forma de saberlo? Lo cantado lejos no sale: para esta película es ruido. Y en la pestaña de logi, el «con quién»: quién te reparó y a quién reparaste, con nombre — el crédito que los killmails jamás dan.",
      "💬 SOCIAL: tus conversaciones privadas, por fin legibles. EVE ya las escribe en disco, pero partidas en cientos de ficheros de sesión que el cliente no vuelve a enseñarte. Koru los cose: la nueva sección en Personaje reconstruye tu historial de conversaciones —puede que años— agrupado por interlocutor, con estilo de chat: lo suyo a la izquierda, lo tuyo a la derecha, cada persona con su color estable y su retrato, la hora de cada línea como la escribe el juego. Solo lectura, a propósito. Y privado de verdad: todo se queda en tu ordenador, no sale de ahí.",
      "🎯 Centrar el mapa donde miras. Pincha un aviso del feed de intel, un salto caliente de tu ruta o busca un sistema, y el mapa se desliza hasta él con un doble anillo marcando la llegada — sin cambiarte el zoom, y sin moverse jamás por su cuenta. Y desde Assets, Tus naves y Qué tienes y dónde, el nombre de cualquier sistema es ahora un enlace: «ver en el mapa» a un clic desde media aplicación.",
      "⚡ Cambiar de sección ya no parpadea. Volver a una pestaña ya visitada enseñaba la pantalla de carga aunque los datos estuvieran ahí, y ese parpadeo repintaba la aplicación entera. Ahora la primera visita carga, y las siguientes entran al instante con lo último conocido delante mientras se refresca detrás — misma fidelidad, cero espera. Las secciones con más datos (inventario, naves, logis) recuerdan además su última respuesta entre visitas.",
      "🪖 Campañas al día: las definiciones de los nuevos objetivos de las campañas militares (minería, misiones de milicia, reparación en zona de guerra) ya están dentro, del último volcado de datos estáticos del juego.",
    ],
    en: [
      "▶️ REPLAY your op on the map. The “Play on the map” button on any recording turns New Eden into the screening room: your fleet's green rings move across the map the way they did that night, intel calls pulse red in their system at their exact time, and the controls —play, pause, speed, a bar with every kill and every warning marked— let you rewind to the exact moment. Nobody has ever been able to watch their fleet move again. Now you can.",
      "🛰 FLEETS: record the op you command. A new section with one button and one idea: killmails don't tell a fleet's story — a logi who spends the night repairing never shows up on them. By recording the roster while you command (one poll every 30 seconds), the logi, the eyes and whoever falls a jump behind are captured by construction. Only the commander can record: EVE won't let anyone else read the members — and the section says so upfront instead of failing silently. While recording, the live composition: who flies with whom by wings and squads, in what ship and where, without opening the game's fleet window.",
      "🎞 Your ops: the movie of every recording. Each op is kept and can be reread as what it was: a story. The presence ribbon —each pilot a colour band per ship; reships and departures show as cuts, no reading required— presides over the view, and below it, in tabs: the movie (who joined and from where, who jumped where, who switched ships, who docked… with kills and losses slotted in at their time), combat (damage per pilot, hit by hit, from your game logs, plus the face-to-face with every rival), logi, PvE as totals, and the final composition. Two honesties sewn in: unwatched gaps are declared (“not zero activity — just not seen”), and every metric states its scope instead of pretending to see everything.",
      "🗺 Your fleet, in green on the map. While a recording is running, systems holding your people wear a green ring with a count — over ANY layer, intel included, because your own never dress as hostiles on a map where orange means a fight. And on the right-hand card, a “Fleet” tab with the roster grouped by system, right next to the feed: yours and what's being called around, in the same glance.",
      "📡 Intel, woven into the movie. Calls from the intel channel in systems where the fleet was appear INSIDE the op's chronology, in red and at their exact time, between the jumps and the kills. It's the question that couldn't be answered until now: was the warning there and we missed it, or was there no way to know? Calls far away don't show: for this movie they're noise. And on the logi tab, the “with whom”: who repaired you and whom you repaired, by name — the credit killmails never give.",
      "💬 SOCIAL: your private conversations, finally readable. EVE already writes them to disk, but split across hundreds of session files the client never shows you again. Koru stitches them back: the new section under Character rebuilds your conversation history —possibly years of it— grouped by person, chat-style: theirs on the left, yours on the right, each person with a stable colour and portrait, every line timestamped as the game wrote it. Read-only, on purpose. And genuinely private: everything stays on your computer.",
      "🎯 Centre the map where you're looking. Click an intel report in the feed, a hot jump on your route, or search for a system, and the map glides to it with a double ring marking the arrival — without touching your zoom, and never moving on its own. And from Assets, Your ships and What you have and where, any system name is now a link: “view on the map” one click away from half the app.",
      "⚡ Switching sections no longer flickers. Returning to a tab you'd already visited showed the loading screen even though the data was right there, and that flicker repainted the whole app. Now the first visit loads, and later ones enter instantly with the last known data in front while refreshing behind — same fidelity, zero wait. The heaviest sections (inventory, ships, logi) also remember their last answer between visits.",
      "🪖 Campaigns up to date: the definitions for the new military campaign objectives (mining, militia missions, warzone repair) are now included, from the game's latest static data export.",
    ],
  },
  {
    version: "0.45.1",
    date: "2026-08-18",
    es: [
      "🐧 Koru arranca en Linux aunque tu tarjeta gráfica no se lleve bien con el motor de dibujado. En algunos equipos —sobre todo con gráficas recientes y Wayland— la ventana no llegaba a aparecer, o salía completamente en blanco. Ahora Koru se da cuenta solo: si un arranque no llegó a pintar nada, el siguiente entra en un modo compatible que sí funciona, y te lo dice en pantalla en vez de dejarte con una ventana vacía y ninguna pista. Quien no lo necesita no nota nada. Y si alguna vez se equivoca, se puede desactivar.",
      "🔎 Buscar la carpeta de chats sola. Para leer el intel, Koru necesita saber dónde escribe EVE los chats — y esa carpeta puede estar enterrada en sitios que nadie debería tener que conocer, sobre todo en Linux. Ahora hay un botón «Buscar» que la encuentra: mira las bibliotecas de Steam que el propio Steam declara (incluidas las que tengas en otro disco), Wine, Lutris y Documentos. Solo te ofrece carpetas que de verdad tengan chats dentro, y si encuentra varias te deja elegir por lo que se reconoce, no por la ruta.",
      "💬 «No se encontraron canales» cuando sí los había. Este es el arreglo con más historia: la lista de canales solo se leía si tenías puesta la capa de Intel en el mapa. Si entrabas a Ajustes desde cualquier otra pantalla, el cartel decía que no había canales cuando en realidad no se había mirado. Se reprodujo en dos ordenadores distintos con la carpeta perfectamente bien. Y de paso, ahora cuando algo falla se explica: si no puede abrir la carpeta dice por qué, y si la abre y no encuentra nada te cuenta cuántos ficheros vio y te enseña un ejemplo.",
      "🖥️ El aviso flotante respeta el monitor que elijas. Si tenías dos pantallas y ponías el aviso en la secundaria, seguía saliendo en la principal — y al reiniciar volvía a la principal aunque el ajuste estuviera guardado. Parecían tres fallos distintos y era uno: la posición se pedía sobre una ventana escondida, y eso no sobrevive. Ahora se coloca justo antes de aparecer, que es el único momento en que está de verdad en pantalla.",
      "🌀 Los planos del botín ya no inflan las cifras. Una copia de plano (BPC) no se puede vender en el mercado, solo por contrato — y comparte identificador con el original, así que al valorarla se le ponía el precio del original. Ahora las copias no cuentan: ni en el patrimonio, ni en el inventario, ni en el botín de una run, donde además salen tachadas para que veas que Koru las ha leído y ha decidido no contarlas. Si las vendes por contrato, añade tú el valor.",
    ],
    en: [
      "🐧 Koru now starts on Linux even when your graphics card doesn't get along with the rendering engine. On some machines — especially recent GPUs on Wayland — the window never appeared, or came up completely blank. Koru now works it out by itself: if a start never managed to draw anything, the next one switches to a compatible mode that does work, and says so on screen instead of leaving you with an empty window and no clue. If you don't need it, you'll never notice it. And if it ever gets it wrong, it can be switched off.",
      "🔎 Find the chat log folder by itself. To read intel, Koru needs to know where EVE writes its chat logs — and that folder can be buried in places nobody should have to know about, especially on Linux. There's now a “Find” button that locates it: it looks in the Steam libraries Steam itself declares (including ones on another drive), Wine, Lutris and Documents. It only offers folders that actually contain chat logs, and if it finds several it lets you choose by something recognisable rather than by the path.",
      "💬 “No channels found” when there were. This is the fix with the longest story: the channel list was only read if you had the Intel layer active on the map. Open Settings from any other screen and the notice claimed there were no channels — when in truth nothing had been checked. It reproduced on two different computers with a perfectly good folder. And now, when something does fail, it explains itself: if it can't open the folder it says why, and if it opens it and finds nothing it tells you how many files it saw and shows you an example.",
      "🖥️ The floating alert respects the monitor you pick. With two screens, putting the alert on the secondary one still showed it on the primary — and restarting sent it back to the primary even though the setting was saved. It looked like three separate bugs and it was one: the position was being set on a hidden window, and that doesn't survive. It's now placed right before it appears, which is the only moment it's genuinely on screen.",
      "🌀 Blueprints in loot no longer inflate the numbers. A blueprint copy (BPC) can't be sold on the market, only by contract — and it shares its identifier with the original, so valuing it applied the original's price. Copies now don't count: not in net worth, not in inventory, and not in a run's loot, where they also appear struck through so you can see Koru read them and chose not to count them. If you sell them by contract, add the value yourself.",
    ],
  },
  {
    version: "0.45.0",
    date: "2026-08-13",
    es: [
      "🎨 Koru se viste de tu facción. Doce temas con el escudo de verdad: las cuatro armadas, EDENCOM, el Colectivo Triglaviano y las cinco piratas. Los colores no son los tópicos de siempre — salen de los mismos tonos con los que se pintan los cascos en el juego, que son más apagados y terrosos de lo que uno recuerda. Y la nave de fondo de cada sección sigue a tu facción: con el tema Amarr, PvP deja de enseñarte un acorazado gallente. Las secciones de minería, industria y exploración NO cambian, y es a propósito: un exhumer es de ORE para todo el mundo, y pintarlo «de tu raza» sería inventarse un dato que el juego no tiene.",
      "👁️ Un fallo de contraste que llevaba meses escondido. La pestaña de la sección en la que estabas se veía MENOS que las que no habías elegido. Nadie lo había mirado nunca porque el menú se lee igual de todos modos, pero la diferencia era grande: la activa daba 2,1 de contraste contra 9,0 de las demás. Arreglado en todos los temas.",
      "⚠️ ¿Hay avisos de intel en la ruta que acabas de trazar? Hasta ahora el intel pintaba los sistemas calientes y el planificador trazaba su línea, pero eran dos cosas que no se hablaban: mirabas si se cruzaban tú, a ojo. Ahora la ruta te dice «2 saltos con avisos de 14», con a cuántos saltos te queda cada uno y hace cuánto se cantó, y los marca con un anillo rojo sobre la propia línea. Ese anillo se ve en CUALQUIER capa del mapa, que es justo cuando más falta hace: sin la capa de Intel puesta no hay puntos rojos y la ruta parecería limpia.",
      "🧳 Tus viajes, y lo que pasó por el camino. Koru ya sabía por dónde habías ido; ahora lo cuenta como viajes: de dónde a dónde, cuántos saltos, cuánto tardaste. Y le cruza lo que se cantó en el chat de intel mientras pasabas por allí. La diferencia entre «lo cantaron 3 minutos ANTES de que entraras» y «lo cantaron estando tú dentro» son dos historias distintas de la misma tarde, y es la clase de cosa que solo se puede reconstruir si alguien guardaba las dos cosas a la vez. Si parte del recorrido no se pudo ver —Koru cerrado, o el piloto desconectado— el viaje lo dice en vez de disimularlo.",
      "🚀 Iconos del juego en el mapa, en vez de emojis. «Tú» lleva tu propio retrato y cambia al cambiar de personaje. Las incursiones llevan el escudo de la nación que las manda. El intel lleva un filamento triglaviano, que es rojo incandescente y no se confunde con nada. Y todo lo que habla de moverse —trazar ruta, el modo salto, tus viajes— comparte icono, para que se entienda de un vistazo que hablan de lo mismo. Las tarjetas del mapa también se han rehecho: enlaces a webs externas arriba junto al nombre, acciones agrupadas a dos por fila, y una sola tarjeta a la derecha con pestañas en vez de tarjetas que se tapaban entre ellas.",
      "🌀 Un filamento por nave, no uno por run. Koru daba por hecho que entrar al abismo gastaba un filamento siempre, también en cooperativo. Es falso, y lo avisó un jugador que corre el contenido: un crucero entra solo, pero hasta dos destructores o tres fragatas gastan uno cada uno. En T6 eso es la diferencia entre 60 millones y 180. Ahora eliges la clase de nave —y si escribes la nave, la clase se rellena sola— y la entrada se calcula con las unidades que de verdad se gastan.",
      "💱 El precio de entrada, el que pagas de verdad. Se estimaba con la media de precio de todo New Eden, que para cosas de nicho como los filamentos se queda muy por debajo. Ahora se coge la mejor orden de venta del hub, que es lo que te cuesta comprarlo. Y las estadísticas de las runs dejan de mentir por otro lado: el P&L cuenta TODO, abortadas incluidas —si abriste el filamento, se gastó—, pero el ISK/hora solo cuenta runs que se jugaron de verdad. Una run de quince segundos no es una tarde mala, y una sola bastaba para que la media horaria no significara nada.",
    ],
    en: [
      "🎨 Koru dresses in your faction's colours. Twelve themes with the real insignia: the four navies, EDENCOM, the Triglavian Collective and the five pirate factions. The colours aren't the usual clichés — they come from the same tones the ships' hulls are painted with in game, which are duller and earthier than you'd remember. And each section's background ship follows your faction: with the Amarr theme, PvP stops showing you a Gallente battleship. Mining, industry and exploration do NOT change, and that's deliberate: an exhumer is ORE's for everyone, and painting it “in your race's colours” would be inventing a fact the game doesn't have.",
      "👁️ A contrast bug that had been hiding for months. The tab for the section you were actually in showed up LESS than the ones you hadn't picked. Nobody had ever looked, because you can read the menu either way, but the gap was large: the active tab scored 2.1 contrast against 9.0 for the rest. Fixed across every theme.",
      "⚠️ Are there intel reports on the route you just plotted? Until now intel painted the hot systems and the planner drew its line, but the two never spoke: you checked whether they crossed by eye. Now the route tells you “2 jumps with reports out of 14”, how many jumps away each one is and how long ago it was called, and marks them with a red ring on the line itself. That ring shows on ANY map layer, which is exactly when it matters most: without the Intel layer on there are no red dots, and the route would look clean.",
      "🧳 Your trips, and what happened along the way. Koru already knew where you'd been; now it tells it as trips: from where to where, how many jumps, how long. And it cross-references what was called in intel chat while you were passing through. The difference between “it was called 3 minutes BEFORE you entered” and “it was called while you were inside” is two different stories about the same evening, and it's the kind of thing you can only reconstruct if something was recording both at once. If part of the route couldn't be seen — Koru closed, or the pilot logged off — the trip says so instead of papering over it.",
      "🚀 Real in-game icons on the map, instead of emoji. “You” carries your own portrait, and changes when you switch character. Incursions carry the insignia of the nation behind them. Intel carries a Triglavian filament, which glows red and can't be mistaken for anything else. And everything about moving — plotting a route, jump mode, your trips — shares one icon, so it reads at a glance as the same subject. The map cards were rebuilt too: external web links up beside the name, actions grouped two per row, and a single card on the right with tabs instead of cards covering each other.",
      "🌀 One filament per ship, not one per run. Koru assumed entering the abyss always burned a single filament, co-op included. That's false, and a player who runs the content flagged it: a cruiser goes in alone, but up to two destroyers or three frigates each burn one. At T6 that's the difference between 60 million and 180. Now you pick the ship class — and if you type the ship, the class fills itself in — and the entry cost uses the units actually spent.",
      "💱 The entry price you actually pay. It was estimated from the average price across all of New Eden, which for niche items like filaments falls well short. Now it takes the best sell order at the hub, which is what buying it costs you. And run statistics stop misleading in another way: P&L counts EVERYTHING, aborted runs included — if you opened the filament, it was spent — but ISK/hour only counts runs that were actually played. A fifteen-second run isn't a bad evening, and a single one was enough to make the hourly average meaningless.",
    ],
  },
  {
    version: "0.44.0",
    date: "2026-08-11",
    es: [
      "📌 Notas ancladas a lo que estás mirando, y que aparecen solas cuando toca. Pincha un sistema en el mapa y déjate un apunte; pincha un hangar en «Qué tienes y dónde» y anota qué guardas ahí. Hasta ahí es un post-it. Lo que no puede hacer un post-it es avisarte en el momento correcto: marca «avisarme al llegar aquí» y la nota salta cuando llegas de verdad, con el personaje al que se la asignaste. Puedes elegir si avisa una vez —y entonces se archiva sola— o en cada visita, para lo que no se acaba nunca («ojo, que aquí campean»).",
      "📦 Avisar cuando llegue algo a un sitio. En las notas de un hangar puedes decir qué esperas: «avísame cuando lleguen los proyectiles a Jita». Sirve justo para lo que llega SIN TI —un contrato de transporte, o un piloto que te hace el favor de palabra—, porque tu propia carga ya sabes cuándo llega. Y una nota se puede pegar a un piloto: apuntas a quién le prestaste algo, con su retrato, y cuando vuelve te avisa. Ojo: los assets tardan hasta una hora en refrescar en el juego, así que el aviso no es instantáneo.",
      "⏱️ El reloj del abismo, encima del juego. Dentro de un filamento no puedes mirar Koru, y pasarse del tope de 20 minutos no cuesta puntos: cuesta la nave. Ahora el aviso flotante te avisa a los 5 minutos, y en los últimos 3 enseña la cuenta atrás corriendo en rojo. Con sonido, porque el reloj vive en una esquina y tú estás mirando al centro de la pantalla — y con un sonido distinto del intel a propósito: confundir «se acaba el tiempo» con «hostil en local» te haría hacer justo lo contrario de lo que toca.",
      "💰 Los movimientos del wallet, con su nombre de verdad. La columna «Tipo» decía cosas como bounty_prizes o planetary_import_tax, tal cual las manda el juego. Ahora dice «Pagos de recompensa» e «Impuesto de importación planetaria» — y en inglés si tienes la app en inglés. Son los 177 nombres oficiales, sacados del propio juego, así que no hay ni una traducción inventada.",
      "🏭 La ficha de instalación pregunta por los módulos que ves en el juego. Antes marcabas casillas abstractas («tiene laboratorio»); ahora eliges los módulos Standup instalados y los servicios se marcan solos. Solo se ofrecen los que de verdad caben en ese tipo de estructura, y eso lo dice el propio módulo. De paso: el aviso de «elige una estructura para calcular el coste» salía incluso teniendo una elegida — ahora explica la causa real, que es que esa instalación no tiene marcada la actividad.",
      "🗂️ Koru empieza a guardar tu inventario. No verás nada nuevo todavía, y es a propósito: a partir de esta versión anota qué tienes, dónde, y cada cambio que ocurre. El juego solo te enseña una foto de ahora; esto es la película, y la película solo se puede grabar hacia delante. Dentro de unos meses podrá contestar en qué se convirtió lo que minaste o de dónde salió lo que tienes en un hangar — pero solo si empieza a mirar hoy.",
    ],
    en: [
      "📌 Notes pinned to whatever you're looking at, that show up on their own when they should. Click a system on the map and leave yourself a note; click a hangar in “What you own and where” and jot down what you keep there. So far, a sticky note. What a sticky note can't do is remind you at the right moment: tick “remind me when I arrive here” and the note fires when you actually arrive, with the character you assigned it to. You choose whether it fires once — filing itself away afterwards — or on every visit, for the things that never end (“careful, people camp here”).",
      "📦 Get told when something arrives somewhere. In a hangar's notes you can say what you're waiting for: “tell me when the ammo reaches Jita”. It's for what arrives WITHOUT you — a courier contract, or a pilot doing you a favour on a handshake — because you already know when your own cargo lands. And a note can be pinned to a pilot: record who you lent something to, portrait included, and get told when it comes back. Note that assets take up to an hour to refresh in game, so the alert isn't instant.",
      "⏱️ The abyss clock, over the game. Inside a filament you can't look at Koru, and going over the 20-minute limit doesn't cost points: it costs the ship. The floating alert now warns you at 5 minutes, and for the last 3 it shows the countdown running in red. With sound, because the clock lives in a corner and you're looking at the middle of your screen — and deliberately a different sound from intel: mistaking “time's up” for “hostile in local” would have you do the exact opposite of what you should.",
      "💰 Wallet entries, with their real names. The “Type” column used to say things like bounty_prizes or planetary_import_tax, exactly as the game sends them. Now it says “Bounty Prizes” and “Planetary Import Tax” — in Spanish if you run the app in Spanish. These are the 177 official names, taken from the game itself, so not a single translation is made up.",
      "🏭 The installation sheet now asks for the modules you see in game. You used to tick abstract boxes (“has a laboratory”); now you pick the Standup service modules it has and the services tick themselves. Only the ones that actually fit that structure type are offered, and that comes from the module itself. Also: the “pick a structure to work out the cost” notice showed up even with one already picked — it now explains the real cause, which is that the installation doesn't have that activity enabled.",
      "🗂️ Koru starts keeping your inventory. You won't see anything new yet, and that's on purpose: from this version on it records what you own, where, and every change as it happens. The game only shows you a snapshot of right now; this is the film, and a film can only be recorded forwards. In a few months it will be able to tell you what your mined ore turned into, or where the stuff in a hangar came from — but only if it starts watching today.",
    ],
  },
  {
    version: "0.43.0",
    date: "2026-08-10",
    es: [
      "📦 «Qué tienes y dónde», dentro de Transporte. Todo tu material agrupado por ubicación, con los m³ y las pilas de cada una, y un buscador para encontrar un objeto sin saber dónde lo dejaste. Lo importante es que separa dos cosas que el juego mezcla: lo que es CARGA y lo que es FLOTA MONTADA. Una nave montada no se transporta, se vuela o se reempaqueta, así que sumarla a los m³ de un viaje te haría creer que cabe cuando no cabe. Cada línea dice en qué estado está, y cuando el SDE no publica el volumen de un tipo, Koru lo dice en vez de contarlo como cero.",
      "🌍 Koru ya habla inglés hasta el final. Con la app en inglés seguían saliendo cosas en castellano, y algunas en el peor sitio posible: el aviso flotante sobre el juego se quedaba en el idioma que tuviera al abrirse, así que si cambiabas a inglés con Koru abierto seguías leyendo «4 SALTOS» encima de la partida hasta reiniciar. También la barra de estado y el feed de intel decían «hace 8 min» en vez de «8 min ago», el aviso de prueba salía con nombres en castellano, y quedaban seis botones sueltos sin traducir. Cuatro fallos distintos, todos con el mismo síntoma.",
    ],
    en: [
      "📦 “What you own and where”, inside Hauling. Everything you have grouped by location, with the m³ and stack count of each one, and a search box for finding an item when you can't remember where you left it. The point is that it separates two things the game lumps together: what is CARGO and what is ASSEMBLED FLEET. An assembled ship isn't hauled, it's flown or repackaged, so adding it to a trip's m³ would tell you it fits when it doesn't. Every line states which it is, and when the SDE doesn't publish a type's volume, Koru says so instead of counting it as zero.",
      "🌍 Koru now speaks English all the way through. With the app in English, some things stayed in Spanish — and one of them in the worst possible place: the floating alert over the game kept whatever language it had when it opened, so switching to English with Koru running left you reading “4 SALTOS” over your session until you restarted. The status bar and intel feed also said “hace 8 min” instead of “8 min ago”, the test alert came through with Spanish names, and six stray buttons were never translated. Four separate bugs, one symptom.",
    ],
  },
  {
    version: "0.42.0",
    date: "2026-08-10",
    es: [
      "🚚 Transporte, sección nueva. Empieza por «Tus naves»: cuáles tienes, dónde está cada una y — lo que no dice ninguna otra parte — cuánto mueve DE VERDAD con tus skills. Un Bestower son 4.800 m³ en el papel y 6.000 con Amarr Industrial a V; una Epithal tiene 550 de bodega y 67.500 de planetaria, así que Koru te enseña la que importa. Filtros por categoría del juego, por sistema y por si están montadas o empaquetadas, y al pinchar una nave se abre su ficha con lo que lleva dentro repartido por compartimentos y el espacio usado de cada bodega.",
      "🐧 Koru ya funciona en Linux. AppImage, .deb y .rpm. Probado en vivo por un jugador: inicia sesión, encuentra los logs de EVE solos (Wine, Steam/Proton y Lutris) y el aviso flotante se coloca bien incluso con dos monitores. Ojo: solo verificado en X11 — en Wayland el sistema no deja colocar ventanas donde se le pide, así que el aviso flotante puede no aparecer donde elijas. El .AppImage es el único que se actualiza solo; el .deb y el .rpm se actualizan a mano.",
      "🔑 Arreglado un inicio de sesión que podía quedarse colgado para siempre. Si tu sistema no tiene navegador por defecto, Koru ahora prueba los demás que encuentre; y si aun así no puede abrir ninguno, te ofrece el enlace copiado al portapapeles para que lo abras tú. Koru sigue esperando, así que el login termina igual. Lo encontró el jugador que probó la versión de Linux.",
      "🌍 18 etiquetas del menú que seguían en español con la app en inglés. Cazador, Fiteos, Misiones, los nombres de los permisos… El mismo jugador las vio a la primera.",
      "☕ El botón de apoyo se ve. Antes era gris y transparente como el resto de la barra de estado, así que parecía un dato más y no un botón.",
    ],
    en: [
      "🚚 Hauling, a new section. It starts with “Your ships”: which ones you own, where each one is and — something nowhere else tells you — how much it REALLY hauls with your skills. A Bestower is 4,800 m³ on paper and 6,000 with Amarr Industrial V; an Epithal has 550 of cargo and 67,500 of planetary hold, so Koru shows you the one that matters. Filters by the game's own category, by system and by assembled vs packaged, and clicking a ship opens its sheet with everything inside split by compartment and the used space of each hold.",
      "🐧 Koru now runs on Linux. AppImage, .deb and .rpm. Tested live by a player: it signs in, finds your EVE logs on its own (Wine, Steam/Proton and Lutris) and the floating alert places itself correctly even with two monitors. Note: only verified on X11 — on Wayland the system doesn't let apps place windows where they ask, so the floating alert may not show up where you pick. The .AppImage is the only one that updates itself; .deb and .rpm update by hand.",
      "🔑 Fixed a sign-in that could hang forever. If your system has no default browser, Koru now tries the others it can find; and if it still can't open one, it hands you the link copied to your clipboard so you can open it yourself. Koru keeps waiting, so the login finishes all the same. Found by the player who tested the Linux build.",
      "🌍 18 menu labels that stayed in Spanish while the app was in English. Hunter, Fittings, Missions, the permission names… The same player spotted them straight away.",
      "☕ The support button is actually visible now. It used to be grey and transparent like the rest of the status bar, so it looked like one more readout rather than a button.",
    ],
  },
  {
    version: "0.41.0",
    date: "2026-08-07",
    es: [
      "📍 El aviso ya dice DE QUIÉN son esos saltos. Antes, cuando el más cercano no era un piloto tuyo sino uno de tus puntos de ancla, salía el número a secas: «4 saltos». ¿De qué? De nada. Ahora siempre hay un «de»: de tu piloto, o de tu ancla con su nombre. Y si hay varios a esa misma distancia, se agrupan («de SieteHierros +2»); si además están JUNTOS en el mismo sistema, aparece el sistema. Ver un nombre de sistema significa que pueden apoyarse entre sí; desperdigados, no se pinta.",
      "🔇 Ya puedes callar un sistema. El vecino de tu staging por el que pasa medio New Eden, o el sistema donde estás rateando esta noche: pínchalo en el mapa → «Silenciar aquí». Con Alt, solo una hora, y se despierta solo. Se calla la ALARMA, nunca el dato: el reporte sigue saliendo en el feed y en el mapa, y el sistema silenciado lleva un 🔇 encima. Un silencio invisible sería una trampa que te pones tú y se te olvida.",
      "🏭 Koru empieza a guardar tu industria y tu planetaria. Todavía no se ve en ninguna pantalla, y es a propósito: primero hay que grabar. El juego solo deja consultar los trabajos de los últimos 90 días, y la planetaria ni siquiera tiene historial — solo sabe decir cómo está la colonia ahora. A partir de aquí Koru va guardando en segundo plano cada trabajo con su coste real, y de cada colonia sus programas de extracción y las existencias día a día. Dentro de unos meses tendrás un histórico de producción que el juego no te puede dar.",
      "✨ Barra de desplazamiento propia en toda la app: fina, oscura y sin fondo, en vez de la blanca del sistema. De paso, los desplegables, los calendarios y el autocompletado dejan de salir en claro sobre el tema oscuro.",
      "🐛 Arreglado: el aviso flotante ya se abre al pulsarlo. En la v0.40.0 pinchabas y no pasaba nada.",
      "🐛 Arreglado: los nombres de sistema salen bien escritos en el aviso flotante y en la notificación de Windows. Llevaban en minúsculas desde siempre, escondidos detrás de un estilo que los ponía en mayúsculas.",
    ],
    en: [
      "📍 The alert now tells you WHO those jumps are from. Before, when the nearest thing wasn't one of your pilots but one of your anchor points, you got a bare number: “4 jumps”. From what? From nothing. Now there's always a “from”: your pilot, or your anchor by name. If several are at that same distance they group up (“from SieteHierros +2”), and if they're TOGETHER in one system, the system shows too. Seeing a system name means they can back each other up; scattered, it isn't drawn.",
      "🔇 You can now mute a system. The neighbour of your staging that half of New Eden flies through, or the system you're ratting in tonight: click it on the map → “Mute here”. Hold Alt for one hour only, and it wakes up on its own. It mutes the ALARM, never the data: the report still shows in the feed and on the map, and a muted system carries a 🔇. An invisible silence would be a trap you set for yourself and forget.",
      "🏭 Koru starts saving your industry and planetary history. Nothing shows on screen yet, and that's deliberate: first you record. The game only lets you query the last 90 days of jobs, and planetary interaction has no history at all — it can only tell you how the colony looks right now. From here on Koru quietly stores every job with its real cost, and for every colony its extraction programmes and daily stock. In a few months you'll have a production history the game cannot give you.",
      "✨ A proper scrollbar across the app: thin, dark and backgroundless, instead of the system's white one. Dropdowns, date pickers and autocomplete highlights stop showing up light on the dark theme too.",
      "🐛 Fixed: the floating alert opens when you click it. In v0.40.0 clicking did nothing.",
      "🐛 Fixed: system names are properly cased in the floating alert and the Windows notification. They'd been lowercase all along, hidden behind a style that uppercased them.",
    ],
  },
  {
    version: "0.40.0",
    date: "2026-08-06",
    es: [
      "🔔 Los avisos de intel, encima del juego. Una ventanita sin bordes en la esquina que elijas, en el monitor que elijas, con el aviso completo: quién viene, en qué nave, a cuántos saltos y de cuál de tus pilotos. Púlsala y Koru se pone delante con el mapa abierto en ese sistema y la ficha del aviso lista para trazar ruta. Viene apagada de fábrica y se enciende en Ajustes: un aviso que aparece sin que nadie lo haya pedido es motivo de desinstalación. Idea de un jugador que se instaló la app y contó que la notificación de Windows no le servía volando.",
      "📍 Tus pilotos ya no se quedan congelados. Hasta ahora Koru preguntaba dónde estaban tus personajes al arrancar y nunca más: si llevabas dos horas volando, los saltos del intel se medían desde donde estabas al abrir la app. No daba error — daba un número creíble, que es peor. Ahora se refresca cada 30 segundos, y solo de los que están conectados.",
      "🧭 Y de paso, tu recorrido. Capa nueva en el mapa con por dónde has pasado de verdad: cada parada con el tiempo que estuviste allí, en ventanas de 1 hora a 7 días. Los tramos que Koru no llegó a ver se dibujan distintos y con leyenda, porque un rastro pintado como continuo afirmaría rutas que nadie presenció.",
      "👁️ Nombres en la capa de intel. Tus pilotos ya no son circulitos mudos: llevan su nombre al lado, apagado para no competir con los avisos. Con varios repartidos, tener que pasar el ratón uno por uno era justo lo que no se puede hacer con prisa.",
      "⚙️ El panel de intel del mapa, a dieta. Lo que se configura una vez —carpeta de logs, canales, recencia, rastro y sonido— se muda a Ajustes → Intel, donde hay sitio y los canales se ven todos a la vez. En el mapa se queda solo lo que se toca volando: el umbral de saltos, qué pilotos cuentan y tus anclas.",
      "🔌 La lista de pilotos del intel enseña solo los conectados, con un enlace para ver todos. Un personaje desconectado no cuenta para nada, así que ocupaba sitio sin decir nada.",
      "🐛 Arreglado: cerrar la app ahora la cierra de verdad. La ventana de avisos mantenía el proceso vivo por detrás.",
    ],
    en: [
      "🔔 Intel alerts, on top of the game. A small borderless window in the corner you pick, on the monitor you pick, with the whole alert: who's coming, in what ship, how many jumps out and from which of your pilots. Click it and Koru comes to the front with the map open on that system and the alert card ready to plot a route. It ships switched off and you turn it on in Settings: an alert that shows up unasked is a reason to uninstall. Suggested by a player who installed the app and said the Windows notification was no use to him while flying.",
      "📍 Your pilots don't freeze in place any more. Until now Koru asked where your characters were at startup and never again: two hours into a session, intel jumps were measured from wherever you were when you opened the app. It didn't throw an error — it gave a believable number, which is worse. Now it refreshes every 30 seconds, and only for those who are online.",
      "🧭 And with it, your route. New map layer showing where you've actually been: every stop with how long you were there, in windows from 1 hour to 7 days. Stretches Koru never saw are drawn differently and labelled, because a trail painted as continuous would claim routes nobody witnessed.",
      "👁️ Names on the intel layer. Your pilots are no longer mute little circles: their name sits beside them, dimmed so it doesn't compete with the alerts. With several spread out, having to hover them one by one was exactly what you can't do in a hurry.",
      "⚙️ The map's intel panel goes on a diet. Everything you set once — log folder, channels, recency, trail and sound — moves to Settings → Intel, where there's room and every channel is visible at once. The map keeps only what you touch while flying: the jump threshold, which pilots count, and your anchors.",
      "🔌 The intel pilot list now shows only those online, with a link to see everyone. An offline character counts for nothing, so it was taking up space without saying anything.",
      "🐛 Fixed: closing the app now actually closes it. The alert window was keeping the process alive in the background.",
    ],
  },
  {
    version: "0.39.0",
    date: "2026-08-05",
    es: [
      "🎖️ Cada medalla estrena ficha propia. Púlsala y se abre una ventana con su historia entera: barras de lo que hiciste cada mes, la línea de tu acumulado, y marcado con su fecha el momento exacto en que cruzaste bronce, plata y oro. Con filtros de 6 meses a todo el histórico, tabla mes a mes y un resumen en cristiano: tu mejor mes, cuántos llevas seguidos y cuándo llegarías al siguiente nivel a tu ritmo actual. Antes solo se veía una curva acumulada, y una curva que solo sube no cuenta ninguna historia: el ritmo está en el mes, no en el total.",
      "📈 Y ahora la tienen LAS 36 medallas. Antes solo 11 tenían evolución; las otras 25 se abrían para decirte «sin datos». Exploración, abismo, logística, mando de flota, minería, viaje… todas con su historia mes a mes.",
      "🏅 13 medallas nuevas. Nueve de exploración (reliquias, datos, gas, agujeros de gusano, sitios totales, botín, tu mejor sitio, sistemas distintos y maratón de sondeo) y cuatro de abismo y CRAB (runs completadas, tu récord de ISK/hora, racha sin perder una nave y la dificultad más alta superada con vida). Se calculan desde que usas Koru, no antes: preferimos un número corto y verdadero.",
      "👥 Runs a varias cuentas, por fin bien contadas. Apunta quién entró en cada run: el botín se reparte a partes iguales, cada piloto lleva su desenlace y su nave, y el coste de entrada se le cobra solo a quien lanzó. Tabla nueva «Por piloto» y dos métricas de bajas que no son la misma (runs con bajas ≠ bajas por piloto). Clave: con varias cuentas el ISK/hora usa la MISMA duración para todos — repartir el tiempo entre pilotos lo inflaría.",
      "📔 La Bitácora, ordenada. Todo por pestañas —retos, progresando, completados y cada dominio— con una franja de estado arriba que reúne puntuación, medallas de oro, empezadas y la última conseguida, más una barra donde cada segmento es una medalla teñida por su nivel: de un vistazo ves cuánto llevas.",
      "📅 El Diario, por años. Una pestaña por año, del más reciente al más antiguo. Y las condecoraciones de corporación se mudan aquí, que es su sitio: tienen fecha y son parte de tu historia, no de tu progreso.",
      "🎨 Iconografía del juego por todas partes. El menú, las pestañas y la franja de actividad cambian los emoji por iconos reales de objetos de EVE. La franja además se amplía: ahora también cuenta lo que exploras, lo que minas y tus runs.",
      "🐛 Arreglado: las ventanas emergentes se quedaban por debajo de los controles del mapa con la app maximizada.",
    ],
    en: [
      "🎖️ Every medal gets its own detail window. Click one and you'll see its whole history: bars for what you did each month, the line of your running total, and the exact moment you crossed bronze, silver and gold, each marked with its date. With filters from 6 months to your full history, a month-by-month table and a plain-language summary: your best month, how many months you're on, and when you'd reach the next tier at your current pace. Before there was only a cumulative curve, and a curve that only goes up tells no story: the rhythm lives in the month, not in the total.",
      "📈 And now ALL 36 medals have one. Only 11 used to have a history; the other 25 opened just to say “no data”. Exploration, abyss, logistics, fleet command, mining, travel — every one of them, month by month.",
      "🏅 13 new medals. Nine for exploration (relics, data, gas, wormholes, total sites, loot, your best single site, distinct systems and a scanning marathon) and four for abyss and CRAB (runs completed, your ISK/hour record, streak without losing a ship, and the highest difficulty you've come out of alive). They count from when you started using Koru, not before: we'd rather show a short true number.",
      "👥 Multi-account runs, finally counted right. Log who came along on each run: loot splits evenly, each pilot carries their own outcome and ship, and the entry cost is charged only to whoever launched it. New “Per pilot” table and two loss metrics that aren't the same thing (runs with losses ≠ losses per pilot). Key point: with several accounts, ISK/hour uses the SAME duration for everyone — splitting the time between pilots would inflate it.",
      "📔 The Logbook, tidied up. Everything in tabs — challenges, in progress, completed and each domain — with a status band up top gathering score, gold medals, medals started and your latest one, plus a bar where each segment is a medal tinted by its tier: one glance tells you how far you've come.",
      "📅 The Diary, by year. One tab per year, most recent first. And corporation decorations move here, where they belong: they have a date and they're part of your story, not your progress.",
      "🎨 Game iconography everywhere. The menu, the tabs and the activity ticker swap emoji for real EVE item icons. The ticker also grows: it now covers what you explore, what you mine and your runs.",
      "🐛 Fixed: pop-up windows sat underneath the map controls when the app was maximised.",
    ],
  },
  {
    version: "0.38.0",
    date: "2026-08-05",
    es: [
      "🧪 Las reacciones, cuadradas al ISK y al segundo. Las fórmulas estrenan pestaña «Reaccionar»: materiales exactos con el descuento de los rigs de tu refinería, tasa del job desglosada, duración con tu skill Reactions, lista de la compra y m³ a transportar. Verificado contra la ventana de industria del juego, coste al ISK y tiempo al segundo. Y encadena: si un material sale a su vez de otra reacción, lo despliegas y baja de nivel — lo desplegado se reacciona, lo demás se compra.",
      "🏭 Tus fichas de instalación aprenden el reactor. Márcalo y aparecen los rigs de reacción de las tres familias. Un aviso honesto que nos costó descubrir: reaccionar NO tiene ninguna bonificación de coste — ni de estructura ni de rigs. La única que existe es el −25% de tiempo de la Tatara. Así que la tasa es índice del sistema + impuestos, y nada más.",
      "📋 Copiar, con las cuentas claras. Cualquier plano con actividad de copia estrena su pestaña: dices cuántas copias y de cuántas runs, y Koru te da coste y duración. Comparte fórmula con la invención, y el tiempo está verificado al segundo contra dos trabajos reales.",
      "🔗 «¿Cuántas copias necesito?» — la pregunta que faltaba. En el panel de invención escribes cuántas unidades T2 quieres y Koru te devuelve la cadena entera hacia atrás: BPCs necesarios, intentos esperados con TUS skills, y las runs de BPC T1 que hay que copiar antes. Un plan T2 completo, de la copia al producto.",
      "💰 El impuesto, por actividad. Las estructuras cobran distinto según lo que hagas —una puede pedirte 1% inventando y 0% copiando, y una refinería cobra las tres reacciones por separado—. Ahora puedes declararlo así en la ficha; lo que dejes en blanco usa el impuesto general de siempre.",
      "🧭 «No lo compres, tráelo». Cuando falta un material para una reacción, Koru mira si ya lo tienes en otro sitio y te dice dónde y a cuántos saltos, ordenado por cercanía.",
      "🙋 Tu contribución en las Campañas Militares. Con el permiso nuevo de campañas, cada objetivo enseña cuáles de tus personajes están apuntados ahora mismo y cuánto lleva aportado cada uno. Es opcional y solo de lectura: los personajes que no lo concedan siguen funcionando igual.",
      "🐛 Y un arreglo silencioso que importa: había planos en nuestro catálogo que no existen en el juego, y uno de ellos daba números falsos del mismo producto que la fórmula buena. Ya no pueden colarse en el árbol.",
    ],
    en: [
      "🧪 Reactions, matched to the ISK and to the second. Formulas get a “React” tab: exact materials with your refinery rigs' discount, a broken-down job fee, duration from your Reactions skill, shopping list and m³ to haul. Verified against the game's industry window — cost to the ISK, time to the second. And it chains: if a material comes from another reaction, expand it and the tree goes deeper — what you expand gets reacted, the rest gets bought.",
      "🏭 Facility cards learn the reactor. Tick it and the reaction rigs for all three families show up. One honest warning that took some digging: reactions get NO cost bonus at all — not from structures, not from rigs. The only one that exists is the Tatara's −25% time. So the fee is system index + taxes, and nothing else.",
      "📋 Copying, with honest numbers. Any blueprint with a copy activity gets its tab: you say how many copies and how many runs each, and Koru gives you cost and duration. It shares the invention formula, and the time is verified to the second against two real jobs.",
      "🔗 “How many copies do I need?” — the missing question. In the invention panel you type how many T2 units you want and Koru gives you the whole chain backwards: BPCs needed, expected attempts with YOUR skills, and the T1 BPC runs you must copy first. A complete T2 plan, from the copy to the product.",
      "💰 Tax, per activity. Structures charge differently depending on what you do — one may ask 1% to invent and 0% to copy, and a refinery bills the three reaction types separately. Now you can declare it that way on the card; anything left blank uses the general tax as before.",
      "🧭 “Don't buy it, haul it.” When a reaction is missing a material, Koru checks whether you already have it elsewhere and tells you where and how many jumps away, closest first.",
      "🙋 Your contribution in Military Campaigns. With the new campaigns permission, each objective shows which of your characters are signed up right now and how much each has contributed. It's optional and read-only: characters without it keep working the same.",
      "🐛 And a quiet fix that matters: our catalogue held blueprints that don't exist in the game, and one of them gave fake numbers for the same product as the real formula. They can't slip into the tree any more.",
    ],
  },
  {
    version: "0.37.0",
    date: "2026-08-04",
    es: [
      "⚔️ Las Campañas Militares de Nueva Eden, en Koru el mismo día que salieron a ESI. Sección nueva en Bitácora: las campañas de los cuatro imperios con su escudo, su historia y su progreso EN VIVO contra el objetivo. Despliega una y verás sus objetivos: qué pide cada uno (minar, fabricar, hackear, misiones, matar…), cuánta gente está comprometida ahora mismo (con el total histórico y los que de verdad contribuyen en el tooltip), y las recompensas por intervalo — ISK, LP y standing. Los objetivos solo de milicia llevan el escudo de su facción.",
      "🧭 Todo con rutas públicas: no pide ningún permiso nuevo. La siguiente entrega traerá TU contribución personal por personaje (esa sí pedirá un permiso nuevo del juego, y te avisaremos).",
      "🔩 Por debajo: Koru se actualiza a la fecha de compatibilidad más reciente de ESI (2026-08-04). Si notas algo raro en cualquier sección tras sincronizar, cuéntanoslo.",
    ],
    en: [
      "⚔️ New Eden's Military Campaigns, in Koru the same day they hit ESI. New section under Logbook: the four empires' campaigns with their crest, their story and their LIVE progress against the target. Expand one to see its objectives: what each asks for (mining, building, hacking, missions, killing…), how many people are committed right now (with the historical total and actual contributors in the tooltip), and the rewards per interval — ISK, LP and standing. Militia-only objectives carry their faction's crest.",
      "🧭 All public routes: no new permission required. The next installment brings YOUR personal contribution per character (that one will need a new game permission, and we'll let you know).",
      "🔩 Under the hood: Koru moves to ESI's latest compatibility date (2026-08-04). If anything looks off in any section after syncing, tell us.",
    ],
  },
  {
    version: "0.36.0",
    date: "2026-07-30",
    es: [
      "🔬 La invención, con las cuentas claras. Los planos T1 estrenan pestaña «Inventar»: los datacores que pide, y la tabla completa de decryptors con la probabilidad REAL (con tus skills leídas del juego), el BPC que sale (carreras y ME/TE), y los tres números que importan — coste por intento, por ÉXITO y por run del BPC — con estrella en el más rentable. Verificado al dato contra la ventana de industria del juego: probabilidad al decimal, coste del job al ISK y tiempo al segundo.",
      "🏗️ Tus fichas de instalación aprenden un servicio nuevo: el laboratorio. Márcalo y los rigs de investigación e invención (antes invisibles en el desplegable, mea culpa) aparecen para declararlos. La tasa del job de invención sale de TU laboratorio: índice del sistema, rigs, bonos de estructura y su impuesto.",
      "👥 ¿Quién lo hace mejor? Dos leyendas nuevas con los retratos de tus personajes: en Inventar, la probabilidad de cada uno con SUS skills (clic = simular con sus niveles); en Fabricar, quién construye más rápido y quién ni siquiera puede lanzar el job por skills que le faltan (y cuáles son).",
      "🧰 Pestañas Fabricar/Inventar para que cada tarea tenga su espacio, selector de instalación con el icono real de cada estructura y sus servicios, y la tasa del job con desglose completo al pasar el ratón — el espejo del tooltip del juego, para que ningún número se esconda.",
      "🔎 Y un detalle honesto: si una pestaña de la biblioteca sale vacía pero tienes texto en el buscador, Koru te lo dice — que un filtro fantasma no te robe diez minutos.",
      "🔕 Los avisos de Planetología, con interruptor. Si no haces PI (o la tienes aparcada), apágalos en la propia sección y Koru deja de avisarte de extractores parados — la vista sigue enseñando el estado igual, solo se calla el ruido. Como el interruptor del intel. (Gracias al piloto que lo sufrió.)",
    ],
    en: [
      "🔬 Invention, with honest numbers. T1 blueprints get an “Invent” tab: the datacores it needs, and the full decryptor table with the REAL probability (using your skills read from the game), the resulting BPC (runs and ME/TE), and the three numbers that matter — cost per attempt, per SUCCESS and per BPC run — with a star on the most profitable. Verified against the game's industry window: probability to the decimal, job fee to the ISK and time to the second.",
      "🏗️ Your facility cards learn a new service: the laboratory. Tick it and the research/invention rigs (previously invisible in the dropdown, mea culpa) show up to declare. The invention job fee comes from YOUR lab: system index, rigs, structure bonuses and its tax.",
      "👥 Who does it best? Two new legends with your characters' portraits: in Invent, each one's probability with THEIR skills (click = simulate with their levels); in Build, who builds fastest and who can't even start the job for missing skills (and which ones).",
      "🧰 Build/Invent tabs so each task gets its own space, a facility picker with each structure's real icon and services, and the job fee with a full breakdown on hover — the mirror of the game's tooltip, so no number can hide.",
      "🔎 One honest touch: if a library tab comes up empty while there's text in the search box, Koru tells you — no more ghost filters stealing ten minutes.",
      "🔕 Planetology alerts now have a switch. If you don't do PI (or parked it), turn them off right in the section and Koru stops warning about stopped extractors — the view still shows the state, only the noise goes quiet. Just like the intel switch. (Thanks to the pilot who suffered it.)",
    ],
  },
  {
    version: "0.35.0",
    date: "2026-07-30",
    es: [
      "🏭 Fabricar o comprar, por fin con respuesta. Cada material fabricable del árbol lleva su veredicto 🔧 fabricar / 🛒 comprar con el ahorro en %: compara el precio de mercado con fabricarlo en TU instalación (materiales + tasa del job). Y el árbol ahora aplica los rigs correctos a cada nivel — el de componentes a los componentes, el de naves a las naves — con el mapeo real del cliente del juego. Si tu ficha está completa, el sello «✓ ficha completa» ya no dudará.",
      "🧾 La lista de la compra se hace sola. Lo que despliegas se fabrica; lo que queda como hoja se compra: total en ISK y —con el volumen REAL reempaquetado, que el que trae el SDE está mal— los m³ exactos que tendrá que mover tu carguero.",
      "🏗️ Y sabe qué hay en tu fábrica. Si tu ficha viene de ESI, la columna «Tienes» pasa a «En instalación»: cuenta solo lo que ya está dentro de esa estructura (contenedores y naves incluidos), así que «te falta» es literalmente lo que hay que llevar.",
      "🕳️ Los agujeros de gusano, con apellido. En Exploración, el nombre de una firma WH autocompleta con los 102 códigos del juego (K162, B274…) y al elegirlo sale su ficha: a qué clase lleva, cuánto vive y cuánta masa aguanta por salto. El K162 dice «salida», que es la verdad.",
      "🛠️ Arreglado: en secciones con nave de fondo, los desplegables (como el buscador del Watchlist) quedaban tapados por las tablas. Ahora pintan encima, como debe ser.",
      "📦 Datos del juego al día (SDE del 28 de julio, alineado con el resto de fuentes).",
    ],
    en: [
      "🏭 Build or buy, finally answered. Every buildable material in the tree carries its 🔧 build / 🛒 buy verdict with the % saved: it compares the market price against building it at YOUR facility (materials + job fee). And the tree now applies the right rigs at every level — the component rig to components, the ship rig to ships — using the game client's real mapping. If your facility card is complete, the “✓ complete” seal no longer hesitates.",
      "🧾 The shopping list writes itself. What you expand gets built; what remains as a leaf gets bought: total ISK and — using the REAL repackaged volume, since the SDE's is wrong — the exact m³ your hauler will move.",
      "🏗️ And it knows what's at your factory. If your facility card comes from ESI, the “You have” column becomes “At facility”: it counts only what's already inside that structure (containers and ships included), so “missing” is literally what you need to haul.",
      "🕳️ Wormholes, with a surname. In Exploration, a WH signature's name autocompletes with the game's 102 codes (K162, B274…) and picking one shows its card: what class it leads to, how long it lives and how much mass per jump. K162 says “exit”, which is the truth.",
      "🛠️ Fixed: in sections with a ship backdrop, dropdowns (like the Watchlist search) were hidden under tables. They now paint on top, as they should.",
      "📦 Game data refreshed (July 28 SDE, aligned with every other source).",
    ],
  },
  {
    version: "0.34.0",
    date: "2026-07-29",
    es: [
      "🦀 CRAB estrena sección propia en PvE. El CONCORD Rogue Analysis Beacon ya tiene su tracker de runs cronometradas, como las abisales: eliges el beacon (estándar o el de Carrier), inicias, y al terminar registras botín, muerte o abandono. ISK por hora real, tasa de muerte y P&L honesto — sin cuenta atrás, que en el CRAB el reloj lo pones tú. Y no pide ningún permiso nuevo de ESI: todo es tuyo y local.",
      "🚀 Apunta la nave de cada run (opcional) y Koru te saca la tabla «Por nave»: con cuál ganas más por hora y con cuál mueres menos. Vale para abisales y CRAB.",
      "💰 El Histórico de Exploración aprende a repartir. ¿Corriste varias anomalías seguidas y subiste el loot después, todo junto? Selecciona las entradas ya hechas, pega el total y Koru lo reparte a partes iguales entre ellas.",
      "🏷️ La versión de Koru ahora se ve en la barra superior. Cuando algo falle y preguntemos «¿qué versión tienes?», por fin habrá respuesta.",
      "✨ Pulido: los proyectos personales lucen los mismos iconos reales de EVE que la Bitácora, y el detalle por sistema de Ingresos PvE gana la columna «Mejor día» — tu pico de ISK en cada sistema.",
    ],
    en: [
      "🦀 CRAB gets its own section in PvE. The CONCORD Rogue Analysis Beacon now has its timed-runs tracker, just like abyssals: pick the beacon (standard or the Carrier one), start, and when you finish log the loot, a death or a bail-out. Real ISK per hour, death rate and honest P&L — no countdown, in the CRAB you set the pace. And it asks for no new ESI permission: it's all yours and local.",
      "🚀 Note the ship of each run (optional) and Koru builds the “By ship” table: which one earns you more per hour and which one gets you killed less. Works for abyssals and CRAB.",
      "💰 The Exploration History learns to split. Ran several anomalies in a row and pasted the loot later, all in one pile? Select the entries you already closed, paste the total and Koru splits it equally among them.",
      "🏷️ Koru's version now shows in the top bar. When something breaks and we ask “which version are you on?”, there's finally an answer.",
      "✨ Polish: personal projects wear the same real EVE icons as the Logbook, and the per-system detail in PvE Income gains a “Best day” column — your ISK peak in each system.",
    ],
  },
  {
    version: "0.33.0",
    date: "2026-07-24",
    es: [
      "🌀 Runs abisales, cronometradas. Elige tu filamento (tier y clima), pulsa Iniciar y Koru cuenta el tiempo con la cuenta atrás de los 20 minutos del abismo. Al terminar dices si saliste vivo, moriste o abortaste, pegas el botín y —si te reventaron— apuntas la nave perdida. Por fin ves tu ISK por hora REAL por tier y clima, cada cuántos filamentos mueres, y un P&L honesto (loot menos naves), no una estimación por compras.",
      "📊 Con su histórico y sus filtros. Filtra por día, semana, mes o año y por filamento; si se te olvidó el botín de una run ya cerrada, lo editas; y las estadísticas (runs, P&L neto, ISK/hora, tasa de muerte) se recalculan solas.",
      "🎨 Koru se viste de EVE. Cada sección estrena de fondo la nave insignia que le pega —el acorazado en PvP, la Orca en Industria, la Gila en el abismo, el carguero en Patrimonio…— fundida con el fondo sin estorbar la lectura. Y las runs abisales se tiñen con el color de cada clima (Firestorm rojo, Gamma dorado, Dark violeta, Electrical azul, Exotic verde) y en verde/rojo según cómo acabaron.",
    ],
    en: [
      "🌀 Abyssal runs, on the clock. Pick your filament (tier and weather), hit Start and Koru times the run with the abyss's 20-minute countdown. When you finish you say whether you got out alive, died or bailed, paste the loot and —if you got blown up— note the ship you lost. You finally see your REAL ISK per hour by tier and weather, how many filaments between deaths, and an honest P&L (loot minus ships), not an estimate from purchases.",
      "📊 With its own history and filters. Filter by day, week, month or year and by filament; if you forgot the loot on a closed run, just edit it; and the stats (runs, net P&L, ISK/hour, death rate) recalculate on their own.",
      "🎨 Koru dresses up as EVE. Every section now carries its signature ship as a backdrop —the battleship in PvP, the Orca in Industry, the Gila in the abyss, the freighter in Net worth…— blended into the background without getting in the way. And abyssal runs are tinted with each weather's colour (Firestorm red, Gamma gold, Dark violet, Electrical blue, Exotic green) and green/red by how they ended.",
    ],
  },
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
