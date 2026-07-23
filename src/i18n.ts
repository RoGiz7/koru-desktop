// i18n ligero: traducción por "string fuente" (la clave es el texto en español).
// t(s, lang) devuelve la traducción al idioma activo, o el propio texto si no hay entrada.
// Esto permite traducir la "chrome" (navegación, cabeceras, pie, botones) sin reescribir
// todas las vistas: lo no traducido se queda en español hasta que se vaya completando.

export type Lang = "es" | "en";

const EN: Record<string, string> = {
  // --- Grupos de navegación / sub-pestañas ---
  Resumen: "Summary",
  Patrimonio: "Wealth",
  PvP: "PvP",
  PvE: "PvE",
  Industria: "Industry",
  Personaje: "Character",
  Mapa: "Map",
  Wallet: "Wallet",
  Assets: "Assets",
  Comercio: "Market",
  Rentabilidad: "P&L",
  "Watchlist de mercado": "Market watchlist",
  "Tus órdenes abiertas: competencia, % vendido y vencimiento":
    "Your open orders: competition, % filled and expiry",
  "Beneficio realizado de tu trading (coste medio ponderado)":
    "Realized profit from your trading (weighted average cost)",
  "Precios, spread y libro por hub · arbitraje entre hubs · buscador de oportunidades":
    "Prices, spread and order book by hub · hub arbitrage · opportunity finder",
  Actividad: "Activity",
  Rivales: "Rivals",
  Batallas: "Battles",
  Rateo: "Ratting",
  "Ingresos PvE": "PvE Income",
  Abyssals: "Abyssals",
  Factional: "Factional",
  Minería: "Mining",
  Planetología: "Planetary",
  Skills: "Skills",

  // --- Subtítulos de cabecera de sección (TAB_HEAD) ---
  "Balance del mes, ingresos y gastos por categoría":
    "Monthly balance, income and expenses by category",
  "New Eden con overlays de actividad, assets y soberanía":
    "New Eden with activity, assets and sovereignty overlays",
  "Killmails, eficacia ISK y actividad de combate": "Killmails, ISK efficiency and combat activity",
  "Actividad diaria y horas calientes (UTC EVE)": "Daily activity and hot hours (EVE UTC)",
  "A quién matas y quién te mata (por personaje y corp)":
    "Who you kill and who kills you (by character and corp)",
  "Concentraciones de killmails por sistema y momento": "Killmail clusters by system and time",
  "Líquido + valor de assets y su evolución en el tiempo":
    "Liquid + asset value and its evolution over time",
  "Balance, ingresos, gastos y movimientos recientes":
    "Balance, income, expenses and recent transactions",
  "SP totales y cola de entrenamiento": "Total SP and training queue",
  "Inventario, tipos y valor estimado de mercado": "Inventory, types and estimated market value",
  "Trabajos activos y registro de minería": "Active jobs and mining ledger",
  "Mineral extraído, valor estimado y por sistema": "Ore mined, estimated value and by system",
  "Tus órdenes de compra/venta en el mercado": "Your buy/sell market orders",
  "Tus órdenes: competencia (¿te han pisado?), % vendido y vencimiento":
    "Your orders: competition (undercut?), % filled and expiry",
  "Ingresos por bounties (PvE)": "Bounty income (PvE)",
  "Runs abisales (estimado por loot y journal)": "Abyssal runs (estimated from loot and journal)",
  "Tu participación en la Guerra de Facciones": "Your Faction Warfare participation",
  "Tus colonias y extractores (PI)": "Your colonies and extractors (PI)",

  // --- Chrome común (barra superior, pie, botones) ---
  Global: "Global",
  "Sincronizar ahora": "Sync now",
  "Cerrar sesión": "Log out",
  "Añadir acceso": "Add access",
  "Conceder acceso": "Grant access",
  "Tema visual": "Visual theme",
  Idioma: "Language",
  "Vista global (todos los personajes)": "Global view (all characters)",
  "Falta acceso a alguna sección": "Missing access to some section",
  "Falta acceso": "Missing access",
  "Volver a iniciar sesión con el set completo para conceder los scopes que faltan":
    "Log in again with the full set to grant the missing scopes",
  "Esperando login…": "Waiting for login…",
  "Descargar e instalar la actualización y reiniciar":
    "Download and install the update and restart",
  "Actualizando…": "Updating…",
  "Actualizar a": "Update to",
  "Acceso a": "Access to",
  "Iniciar sesión con EVE": "Log in with EVE",
  "Cancelar login": "Cancel login",
  "Cancelar el inicio de sesión": "Cancel the login",
  "Sincronizando histórico…": "Syncing history…",
  "no cierres la app": "don't close the app",
  "Sincronizando datos…": "Syncing data…",
  "Esperando inicio de sesión con EVE…": "Waiting for EVE login…",
  "Cargando sección…": "Loading section…",
  "Listo · última sincronización": "Ready · last sync",
  Listo: "Ready",
  "Set completo (recomendado)": "Full set (recommended)",
  "PvP / killmails": "PvP / killmails",
  "Assets / industria": "Assets / industry",
  "Ubicación (sistema actual)": "Location (current system)",
  "Solo identidad (0 scopes)": "Identity only (0 scopes)",
  "Cancelar sincronización": "Cancel sync",
  "Hora EVE (UTC)": "EVE time (UTC)",
  "Tranquility caído o en VIP": "Tranquility down or in VIP",
  "Comprobando estado del servidor…": "Checking server status…",
  "Mapa y datos servidos desde la base de datos local (SDE), sin llamada a ESI":
    "Map and data served from the local database (SDE), no ESI call",
  "SDE local": "SDE local",
  "Estado de la sincronización automática": "Automatic sync status",
  "Sincronizando…": "Syncing…",
  Sync: "Sync",
  "próxima": "next",
  "Sin sincronizar": "Not synced",
  "Apoyar el proyecto en Ko-fi (totalmente voluntario)":
    "Support the project on Ko-fi (entirely voluntary)",
  Apoyar: "Support",
  "Período": "Period",
  "Hora EVE": "EVE time",
  "Cargando…": "Loading…",
  "Sin datos.": "No data.",
  // --- Bitácora: aviso de desbloqueo + inmersión (Bronce/Plata/Oro/Bitácora ya existen más abajo) ---
  "¡Logro desbloqueado!": "Achievement unlocked!",
  "Sin datos de evolución todavía.": "No evolution data yet.",
  "generada de tu propia historia": "generated from your own history",
  "Suma de puntos por medalla (bronce 1 · plata 3 · oro 8)":
    "Sum of points per medal (bronze 1 · silver 3 · gold 8)",
  "Puntuación": "Score",
  medallas: "medals",
  Progresando: "In progress",
  "logros en marcha, lo más reciente primero": "achievements underway, most recent first",
  Completados: "Completed",
  "medallas de oro conseguidas": "gold medals earned",
  "por dominio · generado de tu propia historia": "by domain · generated from your own history",
  Guerra: "War",
  "Travesía": "Voyage",
  Fortuna: "Fortune",
  "Balance mensual": "Monthly balance",
  // --- Diario (timeline biográfico) ---
  Diario: "Journal",
  Logro: "Achievement",
  "Se unió a": "Joined",
  "Corporación actual": "Current corporation",
  // --- Bitácora: medallas in-game (condecoraciones) ---
  Condecoraciones: "Decorations",
  "Condecoración": "Decoration",
  "Condecorado por": "Decorated by",
  "medallas in-game de corporación": "in-game corporation medals",
  "Pública": "Public",
  // --- Lealtad (LP / misiones) ---
  "Selecciona un personaje para ver sus puntos de lealtad.":
    "Pick a character to see their loyalty points.",
  "Sin LP todavía. Haz misiones para una corporación NPC (y concede el acceso de lealtad al reloguear).":
    "No LP yet. Run missions for an NPC corporation (and grant loyalty access when you re-login).",
  "LP total en": "Total LP across",
  corporaciones: "corporations",
  "ESI expone el saldo de LP, no el historial de misiones. Gasta tu LP en las tiendas de lealtad de cada corp.":
    "ESI exposes your LP balance, not mission history. Spend LP in each corp's loyalty store.",
  // --- Misiones: agentes (standings como progreso) ---
  Agentes: "Agents",
  "Selecciona un personaje para ver sus misiones (LP y agentes).":
    "Pick a character to see their missions (LP and agents).",
  "Sin LP ni agentes todavía. Haz misiones para una corporación NPC (y concede lealtad/standings al reloguear).":
    "No LP or agents yet. Run missions for an NPC corporation (and grant loyalty/standings when you re-login).",
  "agentes · el standing sube con sus misiones": "agents · standing rises with their missions",
  "Los agentes salen de tus standings: cada uno sube al progresar sus misiones. Su ubicación se verá en el mapa.":
    "Agents come from your standings: each rises as you progress their missions. Their location will show on the map.",
  // --- Mapa: agentes/corps en la tarjeta de sistema ---
  "Tus agentes aquí": "Your agents here",
  "Tus corps NPC aquí": "Your NPC corps here",
  "Ver todo en Misiones": "See all in Missions",
  // --- Trabajos por libre (Freelance Jobs) ---
  "Trabajos por libre": "Freelance jobs",
  "Trabajo por libre": "Freelance job",
  "trabajos activos": "active jobs",
  pendientes: "pending",
  "Selecciona un personaje para ver sus trabajos y proyectos.":
    "Pick a character to see their jobs and projects.",
  "Sin trabajos por libre ni proyectos de corp todavía (o falta conceder el acceso al reloguear).":
    "No freelance jobs or corp projects yet (or you haven't granted access on re-login).",
  "Proyectos de corporación": "Corporation projects",
  Proyecto: "Project",
  "tu aporte": "your contribution",
  "Entregar en": "Deliver at",
  // --- Proyectos personales (metas propias) ---
  "Proyectos personales": "Personal projects",
  Nuevo: "New",
  "Nombre (ej. Cazador del mes)": "Name (e.g. Hunter of the month)",
  Objetivo: "Target",
  Crear: "Create",
  Borrar: "Delete",
  "Sin filtro": "No filter",
  "Buscar sistema…": "Search system…",
  "Buscar tipo…": "Search type…",
  Miles: "Thousands",
  Millones: "Millions",
  "Toda la familia": "Whole family",
  familia: "family",
  "Valor de mercado": "Market value",
  "Volumen (m³)": "Volume (m³)",
  "ISK reproceso 85%": "Reprocess ISK 85%",
  "¡Proyecto completado!": "Project completed!",
  Corp: "Corp",
  "Buscar víctima…": "Search victim…",
  Novedades: "What's new",
  Cerrar: "Close",
  "Logi (gamelogs)": "Logi (gamelogs)",
  "Carpeta de logs EVE": "EVE logs folder",
  "Elige la carpeta 'logs' de EVE (contiene Chatlogs y Gamelogs)":
    "Pick EVE's 'logs' folder (it contains Chatlogs and Gamelogs)",
  "Logs de EVE": "EVE logs",
  "Sin carpeta": "No folder",
  // --- Medallas de corp pintadas (SharedCache, v0.24.0) ---
  Error: "Error",
  entregas: "awards",
  "Medallas de corp (dibujo real)": "Corp medals (real artwork)",
  "SharedCache de EVE no detectada": "EVE SharedCache not detected",
  "Carpeta SharedCache": "SharedCache folder",
  "Preparar medallas": "Prepare medals",
  "Actualizar texturas": "Refresh textures",
  "texturas listas": "textures ready",
  "Texturas extraídas: la Bitácora pinta tus condecoraciones reales.":
    "Textures extracted: the Logbook draws your real decorations.",
  "Extrae las texturas de tu instalación de EVE para ver tus condecoraciones dibujadas.":
    "Extract the textures from your EVE install to see your decorations drawn.",
  "FC no respalda esta app ni es responsable de ella.":
    "FC has not endorsed and is not responsible for this app.",
  // --- PvP del gamelog (#45, v0.25.0) ---
  "Cara a cara (gamelog)": "Face to face (gamelog)",
  "Naves y drones": "Ships & drones",
  // "Estructuras", "Tipo", "Fallos" y "Daño recibido" ya existen arriba: no duplicar (TS1117).
  "Daño real contra jugadores, con y sin killmail — del log de combate, desde 2019. Daño y fallos, no muertes.":
    "Real damage against players, with and without a killmail — from the combat log, since 2019. Damage and misses, not kills.",
  "Sin datos todavía: reescanea tus gamelogs en ⚙️ Ajustes → Logs de EVE para poblar esta tabla.":
    "No data yet: rescan your gamelogs in ⚙️ Settings → EVE logs to fill this table.",
  Piloto: "Pilot",
  Estructura: "Structure",
  "Daño dado": "Damage dealt",
  Golpes: "Hits",
  "Te falló": "Missed you",
  "Última vez": "Last seen",
  "Daño que le hiciste": "Damage you dealt them",
  "Golpes · de ellos wrecking": "Hits · of them wrecking",
  "Tus disparos que no acertaron": "Your shots that missed",
  "Daño que te hizo": "Damage they dealt you",
  "Sus disparos que no te acertaron": "Their shots that missed you",
  y: "and",
  "rivales más (ordenado por daño cruzado)": "more rivals (sorted by crossed damage)",
  "Daño PvP (gamelog)": "PvP damage (gamelog)",
  "Título oficial equipado (Cradle of War)": "Equipped official title (Cradle of War)",
  // --- Planetología R1a (dashboard de colonias) ---
  parado: "stopped",
  "sin programa": "no program",
  nivel: "level",
  pins: "pins",
  rutas: "routes",
  Capacidad: "Capacity",
  "Peor extractor": "Worst extractor",
  Extractores: "Extractors",
  Fábricas: "Factories",
  "Almacenes y launchpads": "Storage & launchpads",
  "Extractores parados": "Stopped extractors",
  "Caducan en <24h": "Expiring in <24h",
  "Sin detalle (aún cargando o sin acceso).": "No detail yet (loading or no access).",
  "Capacidad = lo que tus esquemas pueden producir a ciclo lleno, valorado a precio medio de mercado. La producción real depende de que los insumos lleguen (eso llega en la siguiente fase).":
    "Capacity = what your schematics can produce at full cycle, valued at average market price. Real output depends on inputs actually arriving (that lands in the next phase).",
  "* Algún producto sin precio de mercado aún: sincroniza y vuelve.":
    "* Some product has no market price yet: sync and come back.",
  // --- Planetología R1b (planificador inverso) ---
  "Planificador inverso": "Reverse planner",
  "Elige qué quieres fabricar: te digo qué P0 hacen falta, de qué tipos de planeta salen, y qué te falta según tus colonias.":
    "Pick what you want to make: I'll tell you which P0 it needs, which planet types produce them, and what you're missing based on your colonies.",
  "— Elige un producto PI —": "— Pick a PI product —",
  Receta: "Recipe",
  "P0 necesario": "P0 needed",
  "por ciclo": "per cycle",
  "Tipos de planeta": "Planet types",
  // "Tú" ya existe más abajo con la misma traducción ("You"): no duplicar la clave.
  "✓ ya lo extraes · ◐ tienes el planeta pero no ese extractor · ✗ te falta el tipo de planeta":
    "✓ you already extract it · ◐ you have the planet but not that extractor · ✗ you're missing the planet type",
  "Cantidades por un ciclo del objetivo (ratios teóricos del árbol, no de tu producción real).":
    "Amounts for one cycle of the target (theoretical tree ratios, not your real output).",
  "Ya extraes todos los P0 que necesita.": "You already extract every P0 it needs.",
  "Te faltan P0 por extraer:": "P0 you still need to extract:",
  "Avisos de extractor (horas, separadas por coma):":
    "Extractor alerts (hours, comma-separated):",
  "Guardar avisos": "Save alerts",
  "Avisará a": "Will alert at",
  "y al pararse.": "and when stopped.",
  "Colonias de PI aquí": "PI colonies here",
  "sin extractor": "no extractor",
  "Ver en Planetología": "View in Planetary",
  // --- Salud del vigilante de intel (que el badge no pueda mentir) ---
  leyendo: "reading",
  líneas: "lines",
  "log(s)": "log(s)",
  "error leyendo logs": "error reading logs",
  "vigilante sin responder": "watcher not responding",
  "sin logs de ese canal": "no logs for that channel",
  "El hilo del intel no responde": "The intel thread is not responding",
  "El vigilante está leyendo de verdad": "The watcher really is reading",
  "No hay ningún log de ese canal en la carpeta. ¿Canal correcto? ¿Has entrado al canal en esta sesión?":
    "There's no log for that channel in the folder. Right channel? Have you joined it this session?",
  // --- F1b: coste del trabajo ---
  sec: "sec",
  índice: "index",
  "Impuesto centro": "Facility tax",
  "Valor estimado del objeto (VEO)": "Estimated item value (EIV)",
  "Índice de coste en sistema": "System cost index",
  "Bonificación de estructura": "Structure bonus",
  "Impuesto de centro": "Facility tax",
  "Recargo de CCS": "SCC surcharge",
  "Coste total del trabajo": "Total job cost",
  "Sin índice de coste: elige una estructura para calcular el coste del trabajo.":
    "No cost index: pick a structure to compute the job cost.",
  "material(es) sin adjusted_price: el VEO se queda corto. Sincroniza precios.":
    "material(s) without adjusted_price: the EIV falls short. Sync prices.",
  // --- F1c: registro de instalaciones + asistente ---
  // OJO: Origen/Tipo/Sistema/Cancelar YA existen más abajo — no repetirlas (TS1117 rompe el build).
  Nombre: "Name",
  Editar: "Edit",
  Rigs: "Rigs",
  Impuesto: "Tax",
  impuesto: "tax",
  Usar: "Use",
  Fabrica: "Builds",
  material: "material",
  coste: "cost",
  tiempo: "time",
  en: "in",
  falta: "missing",
  estimación: "estimate",
  "a mano": "manual",
  "no puede": "can't",
  "sin declarar": "not declared",
  "ficha completa": "complete",
  // Registro de instalaciones: cabecera y plegado.
  ficha: "facility",
  fichas: "facilities",
  "en uso": "in use",
  "ninguna en uso": "none in use",
  "Plegar la lista": "Collapse the list",
  "Desplegar la lista": "Expand the list",
  "Están plegadas y ninguna está declarada todavía: el árbol BOM no usará ninguna hasta que completes al menos una.":
    "They're collapsed and none is declared yet: the BOM tree won't use any until you complete at least one.",
  "Están plegadas. Despliega para editarlas.": "They're collapsed. Expand to edit them.",
  "Mis instalaciones": "My facilities",
  "Nueva ficha": "New facility",
  "Editar ficha": "Edit facility",
  "Nueva ficha de instalación": "New facility record",
  "Guardar ficha": "Save facility",
  "Traer de ESI": "Fetch from ESI",
  "Buscando…": "Fetching…",
  "escribe 2 letras…": "type 2 letters…",
  "— no lo sé —": "— I don't know —",
  "p. ej. Sotiyo de C-J6MT (naves T2)": "e.g. Sotiyo in C-J6MT (T2 ships)",
  "para ti: el que te ayude a reconocerla": "for you: whatever helps you recognise it",
  "bonos del SDE": "SDE bonuses",
  "tiene planta de fabricación instalada": "has a manufacturing plant installed",
  "has llenado los": "you've filled the",
  "slots de esta estructura": "slots of this structure",
  "hacen falta el nombre y el sistema": "name and system are required",
  "¿Borrar esta ficha?": "Delete this facility?",
  "sus bonos base se multiplican por": "its base bonuses are multiplied by",
  "elige el sistema para saber cuánto rinden": "pick the system to see how much they give",
  "de aquí salen el índice de coste (ESI, en vivo) y el multiplicador de los rigs":
    "this gives the cost index (live from ESI) and the rigs' multiplier",
  "obligatorio: sin sistema no hay índice de coste ni banda de seguridad":
    "required: no system means no cost index and no security band",
  "EVE no enseña los rigs ni los servicios de una estructura si no tienes roles, y ESI tampoco. Así que lo pones tú: Koru saca los números del SDE a partir de lo que declares.":
    "EVE won't show a structure's rigs or services unless you have roles, and neither does ESI. So you declare them: Koru gets the numbers from the SDE out of what you tell it.",
  "Aún no tienes fichas. Crea una a mano, o trae de ESI las que ya conocemos y complétalas.":
    "No facilities yet. Create one by hand, or fetch the ones we already know from ESI and fill them in.",
  "Solo las marcadas salen en el desplegable del árbol BOM.":
    "Only the ticked ones show up in the BOM tree's dropdown.",
  "¿Tiene la planta de fabricación instalada? Sin ella no se puede fabricar ahí.":
    "Is the manufacturing plant installed? Without it you can't build there.",
  "Trae de ESI las estructuras que ya conocemos por tus assets, con su nombre, sistema y tipo. Los rigs y los servicios los tendrás que declarar tú: eso ESI no lo da.":
    "Fetches the structures we already know from your assets, with their name, system and type. Rigs and services are up to you: ESI doesn't give those.",
  "No hay estructuras nuevas que traer: ya están todas en tu registro.":
    "No new structures to fetch: they're all in your registry already.",
  "No se pudo traer de ESI": "Couldn't fetch from ESI",
  "No se pudo guardar la ficha": "Couldn't save the facility",
  "No se pudo borrar la ficha": "Couldn't delete the facility",
  "Este tipo de estructura no admite la planta de fabricación: lo dice el propio módulo en el SDE (solo encaja en Citadel, Engineering Complex y Refinery).":
    "This structure type can't take the manufacturing plant: the module itself says so in the SDE (it only fits Citadels, Engineering Complexes and Refineries).",
  "este tipo NO admite la planta: lo dice el propio módulo en el SDE":
    "this type can NOT take the plant: the module itself says so in the SDE",
  "si no la tiene, no podrás fabricar ahí y no saldrá en el desplegable":
    "without it you can't build there, and it won't show in the dropdown",
  "Rellena lo que sepas. Lo que dejes en blanco no se inventa: se calcula como si no existiera, así que la cuenta se queda corta y Koru te lo dice. Cuanto más completa, más se acerca — con la ficha entera cuadra al ítem con el juego.":
    "Fill in what you know. What you leave blank isn't made up: it's computed as if it didn't exist, so the figure falls short and Koru says so. The more complete, the closer — with the whole record it matches the game to the item.",
  "si lo dejas en blanco calculamos SIN los bonos de estructura: te quedarás corto":
    "leave it blank and we compute WITHOUT the structure bonuses: you'll fall short",
  "este tipo no tiene bonos de industria (una Citadel normal, p. ej.): se calcula sin ellos":
    "this type has no industry bonuses (a plain Citadel, say): we compute without them",
  "¿no los sabes? Déjalo vacío: calcularemos sin ellos y te lo diremos. Mejor quedarse corto que inventar un bono.":
    "don't know them? Leave it empty: we'll compute without them and tell you. Better to fall short than invent a bonus.",
  "el que cobra el dueño de la estructura. Nadie más lo sabe: ni ESI ni el SDE.":
    "the one the structure's owner charges. Nobody else knows it: not ESI, not the SDE.",
  // Ayuda visual del impuesto: el tooltip del juego tiene cuatro porcentajes y tres son trampas.
  "¿Dónde lo veo? En el juego, al abrir el plano: «Coste total del trabajo» → pasa el ratón por encima.":
    "Where do I find it? In-game, open the blueprint: “Total job cost” → hover over it.",
  "Bonificación por función de estructura": "Structure role bonus",
  "no — lo saca Koru de ESI, en vivo": "no — Koru pulls this from ESI, live",
  "no — sale del SDE por el tipo de estructura": "no — this comes from the SDE, from the structure type",
  "👈 ESTE. Aquí escribirías 1": "👈 THIS ONE. Here you'd type 1",
  "no — es global del juego, Koru ya lo aplica": "no — it's game-wide, Koru already applies it",
  "Escribe solo el número, sin el %. Si tu estructura no cobra nada, deja 0 — es un dato válido, no un hueco.":
    "Type just the number, no % sign. If your structure charges nothing, leave 0 — that's a real answer, not a gap.",
  "Ojo: esto es una foto de lo que TÚ sabes hoy. Si la estación cambia sus rigs o su impuesto, Koru no se entera — vuelve aquí y edítala.":
    "Careful: this is a snapshot of what YOU know today. If the station changes its rigs or its tax, Koru won't find out — come back and edit it.",
  "Ficha completa: tipo, rigs e impuesto declarados. Con estos datos la cuenta cuadra al ítem con el juego — lo verificamos contra un job real. El único margen que queda es que la estación haya cambiado desde que la rellenaste: eso ESI no lo dice y Koru no puede saberlo.":
    "Complete record: type, rigs and tax declared. With this, the figure matches the game to the item — we verified it against a real job. The only margin left is the station having changed since you filled it in: ESI doesn't say, and Koru can't know.",
  "Estimación: te falta declarar": "Estimate: you still have to declare",
  "Lo que falta se calcula como si no existiera, así que la cuenta se queda CORTA, nunca larga.":
    "What's missing is computed as if it didn't exist, so the figure falls SHORT, never long.",
  "rig(s) con alcance sin mapear: no los aplicamos.":
    "rig(s) with an unmapped scope: we don't apply them.",
  "el tipo de estructura (sus 3 bonos)": "the structure type (its 3 bonuses)",
  "los rigs": "the rigs",
  "el impuesto del centro": "the facility tax",
  "— Elige tu instalación —": "— Pick your facility —",
  "elige una instalación para el coste y los bonos": "pick a facility for the cost and the bonuses",
  "aún no tienes fichas elegibles: créala arriba, en «Mis instalaciones»":
    "no eligible facilities yet: create one above, under “My facilities”",
  "Tus fichas de instalación marcadas como elegibles. De la ficha salen el sistema (→ índice de coste y banda de seguridad), el tipo (→ los 3 bonos del SDE) y los rigs. Se editan en «Mis instalaciones», arriba.":
    "Your facility records marked as eligible. The record gives the system (→ cost index and security band), the type (→ the 3 SDE bonuses) and the rigs. Edit them under “My facilities”, above.",
  Instalación: "Facility",
  rigs: "rigs",
  "— Elige tu estructura —": "— Pick your structure —",
  "+ añadir rig…": "+ add rig…",
  "ver rigs de todos los tamaños": "show rigs of every size",
  "no fabrican": "can't manufacture",
  "La Standup Manufacturing Plant I solo encaja en Citadel, Engineering Complex y Refinery: lo dice el propio módulo en el SDE. Un Ansiblex, un Metenox o un cyno no fabrican, así que no te los ofrecemos. Ojo: que una estructura salga aquí NO significa que tenga la planta instalada — eso ESI solo se lo cuenta a un Director de la corp dueña.":
    "The Standup Manufacturing Plant I only fits Citadels, Engineering Complexes and Refineries: the module itself says so in the SDE. An Ansiblex, a Metenox or a cyno can't manufacture, so we don't offer them. Careful: a structure showing up here does NOT mean the plant is installed — ESI only tells that to a Director of the owning corp.",
  "no conocemos ninguna estructura tuya: sincroniza tus assets y concede «read_structures»":
    "we don't know any structure of yours: sync your assets and grant “read_structures”",
  "elige una estructura para el coste y los bonos": "pick a structure for the cost and the bonuses",
  "Tu estructura. De ella salen su sistema (→ índice de coste y multiplicador de los rigs) y sus bonos de industria, todo del dato: no hay que ponerlos a mano.":
    "Your structure. It gives its system (→ cost index and rig multiplier) and its industry bonuses, all from the data: no need to type them in.",
  "Impuesto del centro: lo pone el dueño de la estructura, así que ni ESI ni el SDE lo saben. Es lo ÚNICO que hay que escribir.":
    "The facility tax: it's set by the structure's owner, so neither ESI nor the SDE know it. It's the ONLY thing you have to type.",
  "Rigs de esta estructura (ESI no los expone: elígelos una vez). Koru saca su bono, el multiplicador de seguridad y a qué aplica.":
    "This structure's rigs (ESI doesn't expose them: pick them once). Koru works out their bonus, the security multiplier and what they apply to.",
  "Aplica a este producto": "Applies to this product",
  "No aplica: es de otra cosa": "Doesn't apply: it's for something else",
  "Alcance aún no mapeado: NO se aplica (preferimos quedarnos cortos a inventar un bono)":
    "Scope not mapped yet: NOT applied (we'd rather fall short than invent a bonus)",
  // --- F1a: árbol BOM (qué hace falta para fabricar) ---
  Material: "Material",
  Necesitas: "You need",
  Tienes: "You have",
  "Te falta": "Missing",
  Carreras: "Runs",
  produce: "produces",
  estimado: "estimated",
  Highsec: "Highsec",
  Lowsec: "Lowsec",
  "Nullsec / WH": "Nullsec / WH",
  "Ver qué hace falta para fabricarlo": "See what it takes to build it",
  "Desplegar sus materiales": "Expand its materials",
  "Este plano no fabrica nada (o el SDE no lo tiene).":
    "This blueprint doesn't build anything (or the SDE doesn't have it).",
  "«Tienes» suma tus assets (los del personaje activo, o de todos en Global). Un material desplegado usa el ME de TU plano; si no lo tienes, se calcula con ME 0 y se marca «estimado» — nunca se disfraza de real.":
    "“You have” adds up your assets (the active character's, or everyone's in Global). An expanded material uses YOUR blueprint's ME; if you don't own it, it's computed with ME 0 and flagged “estimated” — never disguised as real.",
  // --- F1a: biblioteca de blueprints (Industria) ---
  "Tu biblioteca de blueprints": "Your blueprint library",
  "Cargando biblioteca de blueprints…": "Loading blueprint library…",
  "Sin acceso a tus blueprints: concede el grupo «Industria» en «Conceder acceso».":
    "No access to your blueprints: grant the “Industry” group in “Grant access”.",
  "No tienes blueprints.": "You have no blueprints.",
  Blueprints: "Blueprints",
  Blueprint: "Blueprint",
  "Buscar blueprint…": "Search blueprint…",
  "Mostrando los primeros": "Showing the first",
  "afina con las pestañas o el buscador.": "narrow it down with the tabs or the search box.",
  "Cadenas P0→P4": "P0→P4 chains",
  "Lo que produces (verde), lo que podrías hacer con tus insumos (ámbar) y lo que te falta (gris).":
    "What you produce (green), what you could make from your inputs (amber), and what you're missing (gray).",
  // Tipos de planeta (ESI planet_type, en minúsculas)
  barren: "barren",
  gas: "gas",
  ice: "ice",
  lava: "lava",
  oceanic: "oceanic",
  plasma: "plasma",
  storm: "storm",
  temperate: "temperate",
  // --- Cazador: fichar por nombre (Fase 3.5, 0.26.0) ---
  "Nadie con ese nombre entre tus aprendidos.": "Nobody by that name among your learned hostiles.",
  "Fichar por nombre (ESI)": "File by name (ESI)",
  "ESI no conoce ese nombre. Tiene que ser exacto (las mayúsculas dan igual).":
    "ESI doesn't know that name. It must be exact (case doesn't matter).",
  "No se pudo consultar ESI. Inténtalo en un momento.": "Couldn't reach ESI. Try again in a moment.",
  "Fichado. Aún sin avistamientos: en cuanto aparezca en tu intel, su rastro, sus horas y sus naves nacen aquí.":
    "Filed. No sightings yet: as soon as they show up in your intel, their trail, hours and ships are born here.",
  // --- Retos de corporación (Bitácora, 0.26.0) ---
  "Retos de corporación": "Corporation challenges",
  "El objetivo lo pone tu corp; la aportación es tuya": "Your corp sets the goal; the contribution is yours",
  "tu aportación": "your contribution",
  // "Daño" ya existe más abajo (con comillas — el grep anti-duplicados debe ignorarlas).
  Escaneado: "Scanned",
  ficheros: "files",
  "Pendiente de escanear": "Not scanned yet",
  Logi: "Logi",
  "del histórico de combate": "from your combat history",
  "Curación dada": "Healing given",
  "Reps recibidas": "Reps received",
  Logis: "Logi",
  "Reparación remota, del histórico de combate": "Remote repairs, from your combat history",
  "Aún no hay datos de logi. Abre ⚙️ Ajustes → Logs de EVE y pulsa Escanear para leer tus gamelogs.":
    "No logi data yet. Open ⚙️ Settings → EVE logs and press Scan to read your gamelogs.",
  "Escudo dado": "Shield given",
  "Blindaje dado": "Armor given",
  "Casco dado": "Hull given",
  "Escudo recibido": "Shield received",
  "Blindaje recibido": "Armor received",
  "Casco recibido": "Hull received",
  "A quién curaste": "Who you healed",
  "De quién recibiste": "Who healed you",
  "Módulo": "Module",
  Escudo: "Shield",
  Blindaje: "Armor",
  Casco: "Hull",
  Desglose: "Breakdown",
  Dado: "Given",
  Recibido: "Received",
  "top 8": "top 8",
  "Sin datos para este desglose.": "No data for this breakdown.",
  "Actualización de datos: reescanea para reprocesar tu histórico de logi.":
    "Data update: re-scan to reprocess your logi history.",
  "Título equipado": "Equipped title",
  "logros EVE": "EVE achievements",
  "Reconstrucción": "Reconstruction",
  "Minería, rateo y viaje del histórico local — años que ESI no guarda":
    "Mining, ratting and travel from your local history — years ESI doesn't keep",
  "Minería, rateo y viaje reconstruidos de tu histórico de gamelog local (años que ESI no guarda)":
    "Mining, ratting and travel reconstructed from your local gamelog history (years ESI doesn't keep)",
  Ciclos: "Cycles",
  "Menas distintas": "Distinct ores",
  "Unidades / mes": "Units / month",
  "Top menas (por unidades)": "Top ores (by units)",
  "Rateo (bounties)": "Ratting (bounties)",
  "ISK en recompensas": "ISK in bounties",
  Pagos: "Payouts",
  "ISK / mes": "ISK / month",
  Viaje: "Travel",
  Saltos: "Jumps",
  "Sistemas más visitados": "Most visited systems",
  Dónde: "Where",
  "Del extraído del gamelog, se pudo situar en un sistema el": "Of the gamelog's extracted ore, we could place in a system",
  "Bruto (gamelog)": "Gross (gamelog)",
  "Precio bounty de ratas (gamelog)": "Rat bounty value (gamelog)",
  Fallos: "Misses",
  Especiales: "Special",
  "Daño por arma": "Damage per weapon",
  "Fallos por arma": "Misses per weapon",
  Oficiales: "Officers",
  Capitales: "Capitals",
  "Del gamelog, por arma o dron, y de todo tu histórico. Es daño y fallos, NO muertes: el log no dice qué arma remató a cada rata, y en un mismo segundo golpeas a varios objetivos.":
    "From the gamelog, per weapon or drone, across your whole history. It is damage and misses, NOT kills: the log never says which weapon finished a rat, and in a single second you hit several targets.",
  "Fuera de": "Outside",
  "La ventana crece con cada sincronización.": "The window grows with every sync.",
  "Prueba «Día» o «Semana»: en «Mes» hay muy pocos puntos.":
    "Try “Day” or “Week”: “Month” has too few points here.",
  "no hay desglose (las filas importadas del CSV no lo traen), así que el eje se recorta ahí: no es que mataras cero ratas, es que no se sabe.":
    "there is no breakdown (rows imported from the CSV don't carry it), so the axis is clipped there: it's not that you killed zero rats, it's that we don't know.",
  "Se pudo situar en un sistema el": "We could place in a system",
  "del bruto.": "of the gross.",
  "El bruto sale del gamelog y llega a 2019: es lo que valían las ratas, no lo que cobraste. No dividas una columna por la otra.":
    "The gross comes from the gamelog and reaches back to 2019: it is what the rats were worth, not what you were paid. Don't divide one column by the other.",
  "Del ISK cobrado, solo lleva sistema el": "Of the ISK you were paid, a system is known for only",
  "el wallet solo sabe dónde ocurrió cada pago cuando ESI lo etiquetó, y las filas importadas del CSV no lo traen.":
    "the wallet only knows where a payment happened when ESI tagged it, and rows imported from the CSV don't carry that tag.",
  "el resto cuenta en el Total, pero no en ninguna línea de sistema.":
    "the rest counts toward the Total, but not toward any system line.",
  "Dónde rateaste": "Where you ratted",
  "Dónde minaste": "Where you mined",
  "Dónde peleaste": "Where you fought",
  atribuido: "attributed",
  "Sacado del canal Local, que anuncia cada cambio de sistema. Solo se atribuyen las sesiones cuyo chatlog se conserva; el resto cuenta en los totales de arriba, pero no aquí.":
    "Taken from the Local channel, which announces every system change. Only sessions whose chatlog still exists are attributed; the rest count in the totals above, but not here.",
  "Aún no hay datos reconstruidos. Abre ⚙️ Ajustes → Logs de EVE y pulsa Escanear.":
    "No reconstructed data yet. Open ⚙️ Settings → EVE logs and press Scan.",
  gamelog: "gamelog",
  "Rateo (gamelog)": "Ratting (gamelog)",
  "Minería (gamelog)": "Mining (gamelog)",
  "Extraído (gamelog)": "Extracted (gamelog)",
  "Desperdiciado (gamelog)": "Wasted (gamelog)",
  Desperdiciado: "Wasted",
  "% desperdicio": "Waste %",
  "Extraído / mes": "Extracted / month",
  "Desperdiciado / mes": "Wasted / month",
  "Crítico (gamelog)": "Critical (gamelog)",
  "Crítico": "Critical",
  "% crítico": "Critical %",
  "Extraído (base+crít)": "Extracted (base+crit)",
  "Crítico / mes": "Critical / month",
  "Superpone Extraído (cuadra con ESI) + Crítico + Desperdiciado del gamelog (líneas discontinuas)":
    "Overlays Extracted (matches ESI) + Critical + Wasted from the gamelog (dashed lines)",
  "El desperdiciado solo se muestra en modo «Unidades» (el log no indica la mena del residuo).":
    "Wasted only shows in “Units” mode (the log doesn't state the residue's ore).",
  // ---- v18 en las vistas: calidad del golpe, salvage, residuo por mena y bonificaciones de mando.
  // La escala de calidad es la del juego; el par ES↔EN se fijó por daño medio, no por traducción.
  Roza: "Grazes",
  Alcanza: "Glances Off",
  Impacta: "Hits",
  Perfora: "Penetrates",
  Destroza: "Smashes",
  Destruye: "Wrecks",
  Calidad: "Quality",
  "Calidad del golpe": "Hit quality",
  Dados: "Given",
  Recibidos: "Taken",
  "Del gamelog, todo tu histórico. Seis escalones de calidad, de Roza (el peor) a Destruye (wrecking): la misma escala en español y en inglés, emparejada por el daño medio de cada verbo, no por traducción.":
    "From the gamelog, your whole history. Six quality steps, from Grazes (worst) to Wrecks: the same scale in Spanish and English, paired by each verb's average damage, not by translation.",
  "Restos recuperados": "Wrecks salvaged",
  "Intentos fallidos": "Failed attempts",
  "Del gamelog, todo tu histórico: restos de naves recuperados con éxito e intentos que fallaron. El log no dice qué salió de cada resto; eso solo lo sabe tu bodega.":
    "From the gamelog, your whole history: ship wrecks successfully salvaged and attempts that failed. The log doesn't say what came out of each wreck; only your cargo hold knows that.",
  "Residuo por mena": "Residue by ore",
  "Mena destruida por el módulo, atribuida a su mena. El log solo lo detalla desde":
    "Ore destroyed by the module, attributed to its ore. The log only details it since",
  "el % se calcula contra lo extraído desde esa fecha, no contra todo el histórico.":
    "the % is computed against what was extracted since that date, not the whole history.",
  "% perdido": "% lost",
  "Bonificaciones de mando": "Command bursts",
  "Pulsos de tus módulos de mando y a cuántos miembros de flota llegó cada uno (suma de todos los pulsos, no gente distinta: el log no dice a quién).":
    "Pulses of your command burst modules and how many fleet members each one reached (sum across pulses, not distinct people: the log doesn't say who).",
  Pulsos: "Pulses",
  "Miembros bonificados": "Members boosted",
  Combate: "Combat",
  "Daño hecho": "Damage done",
  "Daño recibido": "Damage taken",
  "% wrecking hecho": "Wrecking % done",
  "% wrecking recibido": "Wrecking % taken",
  "Daño hecho / mes": "Damage done / month",
  "Daño recibido / mes": "Damage taken / month",
  "Ratas más batidas (por daño)": "Most-hit rats (by damage)",
  "Superpone el bounty reconstruido del gamelog (fuente separada, línea discontinua)":
    "Overlays the bounty reconstructed from the gamelog (separate source, dashed line)",
  "Superpone la minería reconstruida del gamelog (solo en modo Unidades, línea discontinua)":
    "Overlays the mining reconstructed from the gamelog (Units mode only, dashed line)",
  "La línea del gamelog solo se muestra en modo «Unidades» (no tiene m³ ni ISK).":
    "The gamelog line only shows in “Units” mode (it has no m³ or ISK).",
  "Puntuación de logros oficial de EVE (Cradle of War)":
    "Official EVE achievement score (Cradle of War)",
  "Total dado": "Total given",
  "Total recibido": "Total received",
  "HP curados por": "HP healed per",
  Apoyo: "Support",
  Escudero: "Shield Warden",
  Chapista: "Field Mender",
  Soldador: "Welder",
  Capataz: "Foreman",
  "Voz de mando": "Voice of Command",
  "Pulsos de Mining Foreman lanzados a la flota": "Mining Foreman bursts pulsed to your fleet",
  "Miembros de flota bonificados por tus módulos de mando (suma de pulsos)":
    "Fleet members boosted by your command bursts (sum across pulses)",
  "Filón": "Motherlode",
  "Unidades extraídas en ciclos críticos": "Ore units mined in critical cycles",
  Chatarrero: "Scrapper",
  "Restos de naves recuperados": "Ship wrecks salvaged",
  Trotamundos: "Globetrotter",
  "Saltos entre sistemas": "Jumps between systems",
  Demoledor: "Wrecker",
  "Golpes wrecking asestados (Destruye)": "Wrecking hits landed (Wrecks)",
  Artillero: "Gunner",
  "Daño total infligido (del gamelog, con o sin muerte detrás)":
    "Total damage dealt (from the gamelog, kill or no kill behind it)",
  "Sistemas distintos donde has minado (del gamelog + chatlog)":
    "Distinct systems you've mined in (from the gamelog + chatlog)",
  "Escudo remoto reparado (dado)": "Remote shield repaired (given)",
  "Blindaje remoto reparado (dado)": "Remote armor repaired (given)",
  "Casco remoto reparado (dado)": "Remote hull repaired (given)",
  Carpeta: "Folder",
  nuevos: "new",
  "Error al escanear": "Scan error",
  "Aún no tienes proyectos personales. Crea uno: ponle nombre, elige una métrica y un objetivo.":
    "No personal projects yet. Create one: give it a name, pick a metric and a target.",
  "Los trabajos por libre y proyectos de corp son por personaje: elige uno para verlos.":
    "Freelance jobs and corp projects are per character: pick one to see them.",
  "Tus metas propias + los objetivos del juego (Freelance + Proyectos de corp), en un mismo sitio.":
    "Your own goals + the game's objectives (Freelance + Corp Projects), all in one place.",
  "Objetivos del EVE actual (Freelance Jobs + Proyectos de corp), en vivo desde ESI — el sucesor de las Opportunities.":
    "Current EVE objectives (Freelance Jobs + Corp Projects), live from ESI — the successor to Opportunities.",
  "Selecciona un personaje para ver sus trabajos por libre.":
    "Pick a character to see their freelance jobs.",
  "Sin trabajos por libre. Únete a alguno en la ventana de Oportunidades del juego (y concede el acceso al reloguear).":
    "No freelance jobs. Join one from the game's Opportunities window (and grant access when you re-login).",
  "Trabajos por libre en los que participas (Freelance Jobs de EVE), en vivo desde ESI — el sucesor de las Opportunities.":
    "Freelance jobs you take part in (EVE Freelance Jobs), live from ESI — the successor to Opportunities.",
  "Aún no hay hitos que contar. Juega, sincroniza y tu historia se irá escribiendo sola aquí.":
    "No milestones to tell yet. Play, sync, and your story will write itself here.",
  "Vista global: hitos de todos tus personajes. Elige un personaje para ver también su trayectoria de corporaciones.":
    "Global view: milestones from all your characters. Pick a character to also see their corporation history.",
  "Tu biografía en New Eden, tejida por Koru desde tu histórico local y tu corporationhistory pública.":
    "Your New Eden biography, woven by Koru from your local history and your public corporation history.",

  // --- Ajustes / copia de seguridad ---
  Ajustes: "Settings",
  "Datos y copia de seguridad": "Data & backup",
  "Crear copia de seguridad": "Create backup",
  "Restaurar copia de seguridad": "Restore backup",
  "Guarda todo tu histórico local (PvP, wallet, minería, patrimonio) en un archivo.":
    "Save all your local history (PvP, wallet, mining, wealth) to a file.",
  "Reemplaza tus datos actuales por los de una copia y reinicia la app.":
    "Replace your current data with a backup and restart the app.",
  "Copia de seguridad creada": "Backup created",
  "Se reiniciará la app para aplicar la restauración. ¿Continuar?":
    "The app will restart to apply the restore. Continue?",
  "Esto reemplazará TODOS tus datos actuales. ¿Seguro?":
    "This will replace ALL your current data. Are you sure?",
  "Abrir carpeta de datos": "Open data folder",
  "Última copia": "Last backup",
  nunca: "never",
  "Copias automáticas": "Automatic backups",
  "Elegir carpeta de copias automáticas": "Choose automatic backup folder",
  "Sin carpeta seleccionada": "No folder selected",
  "Elegir carpeta…": "Choose folder…",
  Frecuencia: "Frequency",
  Conservar: "Keep",
  Diaria: "Daily",
  Semanal: "Weekly",
  "Al abrir": "On launch",
  Todas: "All",

  // --- Navegación (mapa) ---
  "Navegación": "Navigation",
  Ruta: "Route",
  Salto: "Jump",

  // --- Capas del mapa (OVERLAYS label/short) + categorías + sub-filtros ---
  "Ubicación": "Location",
  "Tu PvP": "Your PvP",
  "Tus assets": "Your assets",
  "Tu minería": "Your mining",
  "Standings NPC": "NPC standings",
  Standings: "Standings",
  "Lugares notables": "Notable places",
  Lugares: "Places",
  Seguridad: "Security",
  "Soberanía": "Sovereignty",
  "Guerra de facciones": "Faction Warfare",
  Facciones: "Factions",
  "Kills última hora": "Kills last hour",
  "Jumps última hora": "Jumps last hour",
  "Intel en vivo (chat)": "Live Intel (chat)",
  Intel: "Intel",
  "Incursiones (Sansha)": "Incursions (Sansha)",
  Incursiones: "Incursions",
  "Tú": "You",
  Universo: "Universe",
  "En vivo": "Live",
  Todos: "All",
  Alianzas: "Alliances",
  "Históricos": "Historic",

  // leyendas del context card (por capa)
  "Cargando mapa…": "Loading map…",
  Expandir: "Expand",
  Plegar: "Collapse",
  "Dónde están tus personajes ahora mismo.": "Where your characters are right now.",
  "Ningún personaje con ubicación. Inicia sesión con la feature “Ubicación (sistema actual)” para verlos en el mapa.":
    "No character with location. Log in with the “Location (current system)” feature to see them on the map.",
  "Lugares notables de New Eden: hubs comerciales, sistemas históricos y puntos calientes de PvP.":
    "Notable places of New Eden: trade hubs, historic systems and PvP hotspots.",
  "Tu actividad PvP: tamaño = volumen, color = seguridad.":
    "Your PvP activity: size = volume, color = security.",
  "Cluster coloreado por seguridad (verde high · naranja low · rojo null).":
    "Cluster colored by security (green high · orange low · red null).",
  "Soberanía: cada color es una alianza/facción que controla el sistema.":
    "Sovereignty: each color is an alliance/faction that controls the system.",
  "Guerra de facciones: color = imperio que controla; tamaño/intensidad = cuán disputado está el sistema.":
    "Faction Warfare: color = controlling empire; size/intensity = how contested the system is.",
  "Incursiones de Sansha: sistemas infestados (el más grande = staging). Color = estado (rojo establecida · naranja movilizando · amarillo retirándose).":
    "Sansha incursions: infested systems (the largest = staging). Color = state (red established · orange mobilizing · yellow withdrawing).",
  "Conexiones de wormhole a Thera/Turnur (datos de eve-scout): sistemas k-space con salida (cian = Thera, naranja = Turnur). El tooltip muestra tipo, tamaño máx y horas restantes.":
    "Wormhole connections to Thera/Turnur (eve-scout data): k-space systems with an exit (cyan = Thera, orange = Turnur). The tooltip shows type, max size and hours left.",
  "Kills de jugadores en la última hora (datos en vivo de ESI).":
    "Player kills in the last hour (live ESI data).",
  "Saltos por sistema en la última hora (datos en vivo de ESI).":
    "Jumps per system in the last hour (live ESI data).",
  "Dónde has minado (mining ledger, últimos 90 días).":
    "Where you've mined (mining ledger, last 90 days).",
  "Dónde tienes assets (estaciones, estructuras y en el espacio).":
    "Where you have assets (stations, structures and in space).",

  // KPIs contextuales del mapa
  "Dueños distintos": "Distinct owners",
  "Sistemas disputados": "Contested systems",
  "Sistemas con standing +": "Systems with + standing",
  "Incursiones activas": "Active incursions",
  "Conexiones Thera/Turnur": "Thera/Turnur connections",
  "Personajes situados": "Characters located",
  "Lugares en el mapa": "Places on the map",
  "Sistemas con datos": "Systems with data",
  "Sistemas (tu PvP)": "Systems (your PvP)",
  Kills: "Kills",
  Losses: "Losses",

  // panel de sistema seleccionado
  "Tus kills": "Your kills",
  "Tus losses": "Your losses",
  "Tu ISK": "Your ISK",
  "Kills 1h": "Kills 1h",
  "Jumps 1h": "Jumps 1h",
  "Assets (stacks)": "Assets (stacks)",
  "Ruta desde": "Route from",
  "Saltar desde": "Jump from",

  // paneles de Ruta y Salto
  "New Eden completo (líneas = stargates).": "Full New Eden (lines = stargates).",
  "cargando datos en vivo…": "loading live data…",
  "Posa el ratón un instante para activar el zoom con rueda":
    "Hover for a moment to enable wheel zoom",
  "Más corta": "Shortest",
  "Más segura": "Safer",
  "Menos segura": "Less safe",
  "Sin ruta por stargates": "No stargate route",
  "Elige origen y destino": "Choose origin and destination",
  Limpiar: "Clear",
  Destino: "Destination",
  "Escribe un sistema…": "Type a system…",
  "Añadir destino": "Add destination",
  "También puedes hacer click en sistemas del mapa para añadirlos · doble-click en el mapa = zoom.":
    "You can also click systems on the map to add them · double-click the map = zoom.",
  "Sistemas de la ruta": "Route systems",
  "Abrir en Dotlan": "Open in Dotlan",
  "Cargar de": "Load from",
  "— manual —": "— manual —",
  "★ = la tienes": "★ = you own it",
  Nave: "Ship",
  "Calculado por nave y Jump Drive Calibration":
    "Computed from ship and Jump Drive Calibration",
  Rango: "Range",
  "Rango (LY)": "Range (LY)",
  "Jump Drive Calibration: +20% de rango por nivel (a V se dobla)":
    "Jump Drive Calibration: +20% range per level (doubles at V)",
  "Jump Fuel Conservation: −10% de consumo por nivel":
    "Jump Fuel Conservation: −10% consumption per level",
  "sistemas al alcance": "systems in range",
  "elige el origen": "choose the origin",
  "Sistema de salto…": "Jump system…",
  "Aquí": "Here",
  "Destino (para el fuel)…": "Destination (for fuel)…",
  "fuera de rango": "out of range",
  "Fatiga: falta el acceso. Pulsa «Conceder acceso» y vuelve a iniciar sesión con este personaje para verla.":
    "Fatigue: access missing. Click “Grant access” and log in again with this character to see it.",
  "Fatiga actual": "Current fatigue",
  ninguna: "none",
  "tras saltar → cooldown": "after jump → cooldown",
  fatiga: "fatigue",
  "(máx; tu nave reduce fatiga)": "(max; your ship reduces fatigue)",
  "Elige tu nave (rango y fuel salen del SDE) y tus skills; el rango se calcula solo. Click en el mapa: 1º fija el origen, 2º el destino. Resalta en morado los low/null alcanzables.":
    "Choose your ship (range and fuel come from the SDE) and your skills; range is computed automatically. Click on the map: 1st sets the origin, 2nd the destination. Reachable low/null highlighted in purple.",

  // --- Intel en vivo ---
  "Intel en vivo": "Live Intel",
  "Mantener el intel activo aunque mires otras secciones":
    "Keep intel running even while viewing other sections",
  Activo: "Active",
  Apagado: "Off",
  "Ir al intel": "Go to intel",
  "Ir a Planetología": "Go to Planetary",
  actual: "current",
  "vs su media": "vs its average",
  "sistema(s)": "system(s)",
  "Configuración": "Settings",
  "Carpeta de logs": "Logs folder",
  "(sin definir)": "(not set)",
  Canales: "Channels",
  "Seleccionar canales…": "Select channels…",
  "canal(es)": "channel(s)",
  "No se encontraron canales en la carpeta.": "No channels found in the folder.",
  "Recencia (min)": "Recency (min)",
  "Alerta ≤ saltos": "Alert ≤ jumps",
  "Rastro (min)": "Trail (min)",
  "Antigüedad máxima de un avistamiento en el rastro. 0 = sin límite.":
    "Maximum age of a sighting kept in the trail. 0 = no limit.",
  Interceptando: "Intercepting",
  Seguido: "Followed",
  Leyenda: "Legend",
  Sonido: "Sound",
  Probar: "Test",
  "Mostrar solo intel en rango": "Show only intel in range",
  saltos: "jumps",
  "Puntos de ancla (proximidad)": "Anchor points (proximity)",
  "Sistema… (p. ej. 9PX2-F)": "System… (e.g. 9PX2-F)",
  "Sin anclas. También puedes pinchar un sistema → “⚓ Anclar aquí”.":
    "No anchors. You can also click a system → “⚓ Anchor here”.",
  "La alerta usa el sistema más cercano entre tu personaje y tus anclas.":
    "The alert uses the nearest system between your character and your anchors.",
  "Abre la ⚙ y elige carpeta y al menos un canal para empezar.":
    "Open ⚙ and choose a folder and at least one channel to start.",
  "Sin actividad reciente.": "No recent activity.",
  "Posible flota": "Possible fleet",
  "Cazador individual": "Lone hunter",
  "hostiles (posible flota)": "hostiles (possible fleet)",
  "• 1 hostil (cazador individual)": "• 1 hostile (lone hunter)",
  "Hostiles habituales": "Frequent hostiles",
  "Los más reportados en intel; se aprenden aunque no estén en Rivales.":
    "Most reported in intel; learned even if not in Rivals.",
  "Aún no hay datos. Deja correr el intel un rato.":
    "No data yet. Let intel run for a while.",
  "visto en": "seen in",
  Rastro: "Trail",
  "Rastro ✓": "Trail ✓",
  Seguir: "Track",
  "Seguir ✓": "Tracking ✓",
  Ficha: "Profile",
  "Abrir ficha del hostil": "Open hostile profile",
  "Abrir ficha completa en Cazador (PvP)": "Open full profile in Hunter (PvP)",
  "último visto": "last seen",
  "primer visto": "first seen",
  "Horas activas (UTC)": "Active hours (UTC)",
  "Sistemas favoritos": "Favorite systems",
  "Naves que vuela": "Ships flown",
  "Buscar hostil…": "Search hostile…",
  Menciones: "Mentions",
  Reciente: "Recent",
  "Sin hostiles conocidos aún. Deja correr el intel un rato.":
    "No known hostiles yet. Let intel run for a while.",
  "Selecciona un hostil de la lista para ver su ficha.":
    "Select a hostile from the list to see their profile.",
  "Ver rastro en el mapa": "Show trail on the map",
  Avistamientos: "Sightings",
  "Último visto": "Last seen",
  "Primer visto": "First seen",
  "Sistemas distintos": "Distinct systems",
  "Aún sin datos (solo se atribuye en reportes de un único piloto).":
    "No data yet (only attributed in single-pilot reports).",
  "Ver su rastro histórico en el mapa": "Show their historical trail on the map",
  "Quitar rastro": "Clear trail",
  "Primer avistamiento": "First sighting",
  "Último avistamiento": "Last sighting",
  avistamientos: "sightings",
  "Sin avistamientos guardados todavía (se acumulan según aparezca en intel).":
    "No sightings saved yet (they accumulate as it appears in intel).",
  menciones: "mentions",
  Reporte: "Report",
  "reportó": "reported by",
  Pilotos: "Pilots",
  "Resolviendo…": "Resolving…",
  "Ningún piloto reconocido en el reporte.": "No pilot recognized in the report.",
  "Ocultar ruta": "Hide route",
  "Trazar ruta según reportes": "Trace route from reports",
  "zKillboard del tipo": "zKillboard for the type",
  Quitar: "Remove",
  "Naves citadas": "Ships mentioned",
  "Anclar aquí": "Anchor here",
  "Quitar ancla": "Remove anchor",
  "zKill sistema": "zKill system",
  "Mis assets": "My assets",
  "Mis assets aquí": "My assets here",
  Origen: "Origin",
  "Último reporte": "Last report",
  "(clic para ver detalle)": "(click for details)",
  "ver detalle": "view details",
  "Intel a": "Intel at",
  "salto(s)": "jump(s)",
  "Elegir…": "Choose…",
  "(ningún archivo)": "(no file)",

  // --- Vistas de datos: Resumen + meses + tabla de categorías ---
  "Sin movimientos en el journal. Sincroniza la wallet de tus personajes (sección Wallet) para ver tu resumen.":
    "No journal entries. Sync your characters' wallet (Wallet section) to see your summary.",
  Mostrando: "Showing",
  "actualizando…": "updating…",
  "Balance del mes": "Month balance",
  Ingresos: "Income",
  Gastos: "Expenses",
  "Distribución de ingresos": "Income breakdown",
  "Ingresos por categoría": "Income by category",
  "Distribución de gastos": "Expense breakdown",
  "Gastos por categoría": "Expenses by category",
  nuevo: "new",
  "Sin movimientos.": "No movements.",
  "Categoría": "Category",
  Valor: "Value",
  excluido: "excluded",
  "Blueprints (excluidos)": "Blueprints (excluded)",
  "Top assets por valor estimado": "Top assets by estimated value",
  "Los blueprints NO cuentan para el patrimonio: el average_price de ESI para un BPO/BPC es su valor base, no lo que sacarías vendiéndolo.":
    "Blueprints don't count toward net worth: ESI's average_price for a BPO/BPC is its base value, not what you'd get selling it.",
  "Valor de assets estimado con el precio medio de mercado (average price de ESI), no con órdenes reales de Jita, y EXCLUYENDO blueprints (su precio base infla el total). Útil como tendencia, no como liquidación exacta. Los snapshots anteriores a esta versión aún incluyen blueprints (verás un escalón).":
    "Asset value estimated with the market average price (ESI average price), not real Jita orders, and EXCLUDING blueprints (their base price inflates the total). Useful as a trend, not an exact liquidation. Snapshots from before this version still include blueprints (you'll see a step).",
  "vs anterior": "vs previous",
  Enero: "January",
  Febrero: "February",
  Marzo: "March",
  Abril: "April",
  Mayo: "May",
  Junio: "June",
  Julio: "July",
  Agosto: "August",
  Septiembre: "September",
  Octubre: "October",
  Noviembre: "November",
  Diciembre: "December",

  // --- Patrimonio ---
  "Patrimonio total": "Total wealth",
  "Líquido (wallet)": "Liquid (wallet)",
  "Valor de assets": "Asset value",
  "Composición del patrimonio": "Wealth composition",
  "Aún no hay precios de mercado en la BD, así que los assets no están valorados. Se descargan solos en la próxima sincronización (endpoint público de ESI).":
    "No market prices in the DB yet, so assets aren't valued. They download automatically on the next sync (public ESI endpoint).",
  "Todavía no hay histórico. Cada sincronización guarda un snapshot diario de tu patrimonio; la curva de evolución aparecerá a partir del segundo día.":
    "No history yet. Each sync saves a daily snapshot of your wealth; the evolution curve appears from the second day.",
  "Primer snapshot guardado": "First snapshot saved",
  "La gráfica de evolución necesita al menos dos días de datos.":
    "The evolution chart needs at least two days of data.",
  "Valor de assets estimado con el precio medio de mercado (average price de ESI), no con órdenes reales de Jita. Útil como tendencia, no como liquidación exacta.":
    "Asset value estimated with the average market price (ESI average price), not real Jita orders. Useful as a trend, not an exact sell-off.",
  Total: "Total",
  "Líquido": "Liquid",
  "máx": "max",

  // --- Wallet ---
  "Trabajando…": "Working…",
  "Sincronizar wallet": "Sync wallet",
  "Importar CSV de wallet (corptools)": "Import wallet CSV (corptools)",
  "Importar el histórico de wallet exportado por corptools/Alliance Auth (backfill de años más allá de la ventana de ESI)":
    "Import the wallet history exported by corptools/Alliance Auth (backfill years beyond the ESI window)",
  "Importando…": "Importing…",
  "Importar histórico (CSV corptools)": "Import history (corptools CSV)",
  "Importación completada": "Import complete",
  "Backfillea años de wallet desde un export de corptools/Alliance Auth. No duplica al reimportar.":
    "Backfill years of wallet from a corptools/Alliance Auth export. No duplicates on re-import.",
  "movimientos nuevos": "new entries",
  "ya existían": "already existed",
  "de personajes no reconocidos": "from unrecognized characters",
  "Los no reconocidos son personajes del export que no tienes añadidos en Koru.":
    "Unrecognized ones are characters in the export that you haven't added to Koru.",
  Balance: "Balance",
  Neto: "Net",
  Movimientos: "Transactions",
  "Tendencia (ingresos/gastos por mes) · arrastra para enfocar una ventana":
    "Trend (income/expense per month) · drag to focus a window",
  "Top ingresos": "Top income",
  "Top gastos": "Top expenses",
  "Movimientos recientes": "Recent transactions",
  Fecha: "Date",
  Tipo: "Type",
  Cantidad: "Amount",

  // --- ViewToggle ---
  Tabla: "Table",
  "Gráfica": "Chart",

  // --- Rateo ---
  "Sin ingresos de rateo en el journal. Sincroniza la wallet del personaje (sección Wallet) para empezar a acumular el histórico en tu PC.":
    "No ratting income in the journal. Sync the character's wallet (Wallet section) to start building history on your PC.",
  "día": "day",
  semana: "week",
  mes: "month",
  "año": "year",
  "ISK total (bounty + ESS)": "Total ISK (bounty + ESS)",
  "Ratas eliminadas": "Rats killed",
  "ISK / hora (estim.)": "ISK / hour (est.)",
  "Día": "Day",
  Semana: "Week",
  Mes: "Month",
  "Año": "Year",
  Acumulado: "Cumulative",
  "90 días": "90 days",
  "Este año": "This year",
  Todo: "All",
  "Año…": "Year…",
  Desde: "From",
  Hasta: "To",
  "ISK acumulado": "Cumulative ISK",
  acumulado: "cumulative",
  por: "per",
  Ratas: "Rats",
  "Ratas especiales": "Special rats",
  oficiales: "officers",
  capitales: "capitals",
  faction: "faction",
  Oficial: "Officer",
  Capital: "Capital",
  Faction: "Faction",
  "Calculando ratas especiales… (puede tardar la 1ª vez)":
    "Calculating special rats… (may take a while the first time)",
  "Distribución por sistema": "Distribution by system",
  "ISK por sistema (histórico)": "ISK by system (historic)",
  "Detalle por sistema": "Detail by system",
  Sistema: "System",

  // --- Minería ---
  "Sin registro de minería. Sincroniza la minería de tus personajes (sección Industria) para ver tu histórico.":
    "No mining ledger. Sync your characters' mining (Industry section) to see your history.",
  "ISK estimado": "Estimated ISK",
  "Unidades minadas": "Units mined",
  "Tipos de mineral": "Ore types",
  "Sin identificar": "Unidentified",
  "Total cobrado (wallet)": "Total received (wallet)",
  "No ingresado (impuestos, ESS y robos)": "Never received (taxes, ESS and theft)",
  "Precio bounty de ratas": "Rat bounty value",
  "Precio bounty de ratas (ESI)": "Rat bounty value (ESI)",
  "Ratas muertas": "Rats killed",
  "ISK por rata (bruto)": "ISK per rat (gross)",
  "ISK por rata (cobrado)": "ISK per rat (received)",
  "ISK por rata": "ISK per rat",
  "ISK/rata": "ISK/rat",
  "Precio de las ratas": "Rat bounty value",
  "Te llegó": "You received",
  "Qué magnitud dibuja la gráfica": "Which magnitude the chart plots",
  "Las ratas salen del desglose de cada pago de ESI. El gamelog no las cuenta: registra daño, no muertes.":
    "Rat counts come from the breakdown of each ESI payout. The gamelog does not count them: it records damage, not kills.",
  "Bounty en wallet": "Bounty in wallet",
  "Pagos del ESS": "ESS payouts",
  "Desglosa lo cobrado en bounty y pagos del ESS, y superpone el bounty que registró tu gamelog. Tres fuentes separadas: no se fusionan ni se restan.":
    "Breaks down what you received into bounty and ESS payouts, and overlays the bounty your gamelog recorded. Three separate sources: they are neither merged nor subtracted.",
  "Copias a conservar": "Backups to keep",
  "copias": "backups",
  "calculando…": "calculating…",
  "restantes": "remaining",
  "ver menos": "show less",
  "más": "more",
  "DPS medio": "Average DPS",
  "DPS pico": "Peak DPS",
  "Tiempo en combate": "Time in combat",
  "DPS medio / mes": "Average DPS / month",
  "DPS medio (en combate)": "Average DPS (in combat)",
  "Pico (mejor segundo)": "Peak (best second)",
  "Del gamelog. El DPS medio divide el daño entre los segundos EN COMBATE (segundos con al menos un golpe tuyo), no entre el tiempo de sesión — es tu ritmo real mientras disparas. El pico es el mejor segundo del período.":
    "From the gamelog. Average DPS divides damage by seconds IN COMBAT (seconds with at least one hit of yours), not session time — your real pace while shooting. The peak is the best second of the period.",
  "Solo contra NPC: tu daño a jugadores vive en la sección PvP, en Cara a cara.":
    "NPC only: your damage against players lives in the PvP section, under Face to face.",
  "Suma PvE y PvP: separarlos exige reprocesar el histórico (pendiente del próximo lote).":
    "Adds PvE and PvP together: splitting them requires reprocessing the history (pending for the next batch).",
  "El DPS se mide sobre los segundos en los que hubo daño, no sobre el tiempo de sesión. El pico es el mayor daño concentrado en un solo segundo.":
    "DPS is measured over the seconds in which damage occurred, not over session time. The peak is the highest damage concentrated in a single second.",
  "Por mineral": "By ore",
  Bruto: "Raw",
  "Comp.": "Comp.",
  "Valor bruto": "Raw value",
  "Valor comprimido": "Compressed value",
  "Valor reprocesado 85%": "Reprocessed value 85%",
  "Cómo valorar lo minado": "How to value what you mined",
  "Sin minería en el rango.": "No mining in range.",
  "Distribución de mineral (por ISK)": "Ore breakdown (by ISK)",
  "Mineral extraído": "Ore mined",
  "Sin minería este mes.": "No mining this month.",
  Mineral: "Ore",
  Unidades: "Units",
  "Por sistema": "By system",
  "Por personaje": "By character",
  Flujo: "Flow",
  "Tendencia mensual (ISK estimado)": "Monthly trend (estimated ISK)",

  // --- PvP ---
  "Sincronizar recientes": "Sync recent",
  "Sincronizar histórico (zKill)": "Sync history (zKill)",
  "Recalcula daño, final blow y nave víctima desde la caché":
    "Recompute damage, final blow and victim ship from cache",
  "Reprocesar daño": "Reprocess damage",
  "Exportar CSV": "Export CSV",
  "página": "page",
  "No cierres la app.": "Don't close the app.",
  Cancelar: "Cancel",
  "Solo kills": "Solo kills",
  "Final blows": "Final blows",
  "Top damage": "Top damage",
  "Eficacia ISK": "ISK efficiency",
  "ISK destruido": "ISK destroyed",
  "ISK perdido": "ISK lost",
  "Tendencia (kills/losses por semana) · arrastra para enfocar una ventana":
    "Trend (kills/losses per week) · drag to focus a window",
  "Top naves": "Top ships",
  "Top sistemas": "Top systems",
  "Kills vs Losses": "Kills vs Losses",
  "ISK destruido vs perdido": "ISK destroyed vs lost",
  Destruido: "Destroyed",
  Perdido: "Lost",
  Ver: "View",
  "en Dotlan": "in Dotlan",
  "Kills más caros": "Most expensive kills",
  "Nave destruida": "Destroyed ship",
  "Abrir en zKillboard": "Open in zKillboard",
  "Daño": "Damage",
  Anterior: "Previous",
  "Sin killmails": "No killmails",
  de: "of",
  Siguiente: "Next",
  Ordenar: "Sort",

  // --- Actividad PvP ---
  "Sin killmails registrados. Sincroniza el PvP de tus personajes para ver tu actividad.":
    "No killmails recorded. Sync your characters' PvP to see your activity.",
  "Actividad diaria": "Daily activity",
  "Horas calientes (UTC EVE)": "Hot hours (EVE UTC)",

  // --- Batallas ---
  "Sin batallas detectadas. Sincroniza el histórico (y pulsa \"Reprocesar daño\") para tener los datos.":
    "No battles detected. Sync the history (and press \"Reprocess damage\") to get the data.",
  "Peleas detectadas (≥8 killmails en un sistema en menos de 1h). Click en una fila → battle report en zKillboard.":
    "Fights detected (≥8 killmails in a system within 1h). Click a row → battle report on zKillboard.",
  "Abrir battle report en zKillboard": "Open battle report on zKillboard",

  // --- Rivales ---
  "Sin datos. Sincroniza killmails y pulsa \"Reprocesar daño\".":
    "No data. Sync killmails and press \"Reprocess damage\".",
  "Basado en tus killmails (necesita el JSON completo: si está vacío, pulsa \"Reprocesar daño\" en PvP).":
    "Based on your killmails (needs the full JSON: if empty, press \"Reprocess damage\" in PvP).",
  "A quién más matas (top)": "Who you kill most (top)",
  "Quién más te mata (top)": "Who kills you most (top)",
  "A quién más matas": "Who you kill most",
  "Corps que más matas": "Corps you kill most",
  "Quién más te mata": "Who kills you most",
  "Corps que más te matan": "Corps that kill you most",

  // --- PvE: Factional + Abyssals ---
  "Este personaje no está enlistado en la Guerra de Facciones.":
    "This character is not enlisted in Faction Warfare.",
  Ayer: "Yesterday",
  "Última semana": "Last week",
  "Facción": "Faction",
  "Rango actual": "Current rank",
  "Rango máximo": "Highest rank",
  Enlistado: "Enlisted",
  "ESI no expone las runs abisales. Esto es una estimación a partir de tus compras de filamentos, ahora acumuladas en tu PC (cada sync guarda las nuevas; 1 filamento ≈ 1 run). Sincroniza la wallet con frecuencia para no perder transacciones fuera de la ventana de ESI.":
    "ESI doesn't expose abyssal runs. This is an estimate from your filament purchases, now accumulated on your PC (each sync saves new ones; 1 filament ≈ 1 run). Sync your wallet often so you don't miss transactions outside the ESI window.",
  "No se han detectado compras de filamentos en la ventana de transacciones.":
    "No filament purchases detected in the transaction window.",
  "Runs estimadas": "Estimated runs",
  "ISK en filamentos": "ISK on filaments",
  "Tipos de filamento": "Filament types",
  "Por filamento": "By filament",
  Filamento: "Filament",

  // --- Contactos / Standings ---
  Contactos: "Contacts",
  Positivos: "Positive",
  Negativos: "Negative",
  "Tus contactos": "Your contacts",
  "No tienes contactos.": "You have no contacts.",
  Contacto: "Contact",
  "En seguimiento": "Watched",
  Bloqueado: "Blocked",
  "Standings con NPC": "NPC standings list",
  "Sin standings (o falta el scope de standings; reloguea con acceso).":
    "No standings (or the standings scope is missing; log in again with access).",
  Entidad: "Entity",
  "Corporación": "Corporation",
  Alianza: "Alliance",
  Agente: "Agent",
  "Corp NPC": "NPC Corp",

  // --- Personaje (header) ---
  "Inteligencia": "Intelligence",
  Memoria: "Memory",
  "Percepción": "Perception",
  Carisma: "Charisma",
  Voluntad: "Willpower",
  Sec: "Sec",
  Nacimiento: "Born",
  "Jump clones": "Jump clones",
  "Remaps libres": "Free remaps",
  Implantes: "Implants",
  "Biografía": "Biography",

  // --- Skills ---
  "SP total": "Total SP",
  "SP sin asignar": "Unallocated SP",
  "En cola": "In queue",
  "Cola de entrenamiento": "Training queue",
  "Cola vacía.": "Empty queue.",
  Nivel: "Level",
  Termina: "Ends",
  Personajes: "Characters",
  "Entrenando ahora": "Training now",
  "— sin entrenar —": "— not training —",

  // --- Comercio ---
  "Cargando órdenes…": "Loading orders…",
  "No tienes órdenes de mercado abiertas.": "You have no open market orders.",
  "Órdenes": "Orders",
  "De compra": "Buy",
  "De venta": "Sell",
  "Valor compra": "Buy value",
  "Valor venta": "Sell value",
  Item: "Item",
  Precio: "Price",
  Emitida: "Issued",
  Compra: "Buy",
  Venta: "Sell",

  // --- Planetología ---
  "Cargando colonias…": "Loading colonies…",
  "No tienes colonias de Planetary Interaction.": "You have no Planetary Interaction colonies.",
  Colonias: "Colonies",
  "Estructuras (pins)": "Structures (pins)",
  "Tipo de planeta": "Planet type",
  Estructuras: "Structures",
  "Última actualización": "Last update",

  // --- Industria ---
  "Jobs de industria activos": "Active industry jobs",
  "Jobs de industria": "Industry jobs",
  "Jobs activos": "Active jobs",
  "Listos para recoger": "Ready to collect",
  "Próximo en terminar": "Next to finish",
  Restante: "Remaining",
  listo: "ready",
  "Sin jobs activos.": "No active jobs.",
  "Producto / Blueprint": "Product / Blueprint",
  Runs: "Runs",
  Estado: "Status",
  "Pisadas (a repricear)": "Undercut (to reprice)",
  Vendido: "Filled",
  Caduca: "Expires",
  Mejor: "Best",
  "Mejor rival": "Best rival",
  Pisada: "Undercut",
  "riv.": "comp.",
  caducada: "expired",
  d: "d",
  "Órdenes abiertas": "Open orders",
  "Rentabilidad (P&L)": "Profitability (P&L)",
  "Sin transacciones de mercado para calcular el P&L. Se van acumulando al sincronizar la wallet.":
    "No market transactions to compute P&L. They accumulate as you sync the wallet.",
  "Beneficio realizado": "Realized profit",
  "Facturación (ventas)": "Revenue (sales)",
  "Coste de lo vendido": "Cost of goods sold",
  "Impuestos y comisiones": "Taxes & fees",
  "Neto tras impuestos": "Net after taxes",
  "Beneficio realizado por item (coste medio ponderado): ingreso de ventas − coste de lo vendido. Los impuestos/comisiones son del wallet (globales, no por item).":
    "Realized profit per item (weighted-average cost): sales revenue − cost of goods sold. Taxes/fees are wallet-wide (global, not per item).",
  Comprado: "Bought",
  "Compra media": "Avg buy",
  "Venta media": "Avg sell",
  Beneficio: "Profit",
  Margen: "Margin",
  "Beneficio realizado por": "Realized profit by",
  // --- Watchlist de mercado (Comercio Nivel 3) ---
  Watchlist: "Watchlist",
  Región: "Region",
  "Buscar ítem para añadir…": "Search item to add…",
  "Cargando catálogo…": "Loading catalog…",
  "Sin coincidencias": "No matches",
  "ya vigilado": "already watched",
  "Cargando mercado…": "Loading market…",
  "Tu watchlist está vacía. Busca ítems arriba para vigilar su precio, spread y volumen.":
    "Your watchlist is empty. Search items above to watch their price, spread and volume.",
  "Vol/día": "Vol/day",
  "Vol medio": "Avg vol",
  "Quitar de la watchlist": "Remove from watchlist",
  "Precio medio": "Avg price",
  últimos: "last",
  días: "days",
  "Libro (hub)": "Order book (hub)",
  "Sin órdenes en el hub para este ítem.": "No orders at the hub for this item.",
  Compradores: "Buyers",
  Vendedores: "Sellers",
  órdenes: "orders",
  "acum.": "cum.",
  "Sin histórico para este ítem en esta región.": "No history for this item in this region.",
  "Compra/venta = mejor precio en el hub de la región. Spread = venta − compra. Margen = spread ÷ venta (antes de impuestos). Volumen del histórico de mercado de la región.":
    "Buy/sell = best price at the region hub. Spread = sell − buy. Margin = spread ÷ sell (before taxes). Volume from the region's market history.",
  "Arbitraje entre hubs": "Hub arbitrage",
  "Añadir a la watchlist": "Add to watchlist",
  "Añadido a la watchlist": "Added to watchlist",
  "Mejor ruta de compra→venta entre Jita, Amarr, Dodixie, Rens y Hek para cada ítem vigilado.":
    "Best buy→sell route across Jita, Amarr, Dodixie, Rens and Hek for each watched item.",
  "Calculando…": "Computing…",
  Recalcular: "Recompute",
  "Analizando los 5 hubs… (puede tardar)": "Scanning the 5 hubs… (may take a while)",
  "Tu watchlist está vacía. Añade ítems en la pestaña Mercado.":
    "Your watchlist is empty. Add items in the Market tab.",
  "No hay rutas rentables entre hubs para tus ítems vigilados ahora mismo.":
    "No profitable hub routes for your watched items right now.",
  "Comprar en": "Buy at",
  "Precio compra": "Buy price",
  "Vender en": "Sell at",
  "Precio venta": "Sell price",
  "Beneficio/ud": "Profit/unit",
  "Vol/día dest.": "Dest. vol/day",
  "Comprar al mejor precio de venta en el hub origen, llevar y vender al mejor precio de compra en el destino. Beneficio antes de impuestos, comisiones y transporte. El volumen del destino indica si podrás colocarlo.":
    "Buy at the best sell price in the origin hub, haul it, and sell at the best buy price in the destination. Profit before taxes, fees and transport. Destination volume tells you if you can offload it.",

  // --- Buscador de oportunidades (Comercio Nivel 4) ---
  Oportunidades: "Opportunities",
  "Buscar grupo de mercado… (p. ej. Frigates)": "Search a market group… (e.g. Frigates)",
  "ítems": "items",
  "Vol/día mín.": "Min vol/day",
  "ítems en el grupo": "items in the group",
  "Elige un grupo de mercado y escanea las mejores oportunidades del hub.":
    "Pick a market group and scan the hub's best opportunities.",
  "Escaneando…": "Scanning…",
  Escanear: "Scan",
  "Analizando liquidez y libros del hub… (puede tardar)":
    "Analyzing liquidity and hub order books… (may take a while)",
  "Sin datos. Elige un grupo y pulsa Escanear.": "No data. Pick a group and hit Scan.",
  "Ninguna oportunidad con esa liquidez mínima. Baja el volumen mínimo o prueba otro grupo.":
    "No opportunities at that minimum liquidity. Lower the minimum volume or try another group.",
  "Potencial/día": "Potential/day",
  "Escaneo en dos fases: liquidez del histórico (vol/día) y luego spread real del libro del hub para los más líquidos. Potencial/día = spread × volumen diario (bruto, antes de impuestos y comisiones). Añade con ➕ a la watchlist para ver su libro completo.":
    "Two-phase scan: history liquidity (vol/day), then the real hub order-book spread for the most liquid ones. Potential/day = spread × daily volume (gross, before taxes and fees). Add with ➕ to the watchlist to see its full order book.",

  "Minería (histórico acumulado)": "Mining (accumulated history)",
  "Sincronizar minería": "Sync mining",
  Entradas: "Entries",
  "Top minerales": "Top ores",
  "Sin datos de minería (¿falta el scope?).": "No mining data (missing scope?).",

  // --- Assets ---
  "Cargando… (puede tardar con muchos assets)": "Loading… (may take a while with many assets)",
  Stacks: "Stacks",
  "Tipos distintos": "Distinct types",
  "Unidades totales": "Total units",
  "Valor estimado": "Estimated value",
  Inventario: "Inventory",
  "Papeles (Triglavian Survey Database)": "Papers (Triglavian Survey Database)",
  "Papeles (loot redimible — estimado)": "Papers (redeemable loot — estimated)",
  "Valor ESTIMADO a precio de mercado del loot redimible (Abyssals + CRAB). La gráfica ACUMULA los papeles que vas ganando (detecta las subidas de cantidad en tus assets en cada sync y las suma, como el ISK del wallet); vender no resta. No es ISK realizado: es una estimación a mercado.":
    "ESTIMATED market value of the redeemable loot (Abyssals + CRAB). The chart ACCUMULATES the papers you earn (it detects increases in your asset quantities on each sync and adds them up, like wallet ISK); selling doesn't subtract. It's not realized ISK: it's a market estimate.",
  "Papeles acumulados (ganados) · valor estimado a mercado":
    "Accumulated papers (earned) · estimated market value",
  "La gráfica acumulada se construye con el tiempo: cada sync (y cada vez que abres esta vista) guarda una foto del inventario y suma lo nuevo. Necesita al menos dos lecturas en días distintos.":
    "The accumulated chart builds up over time: each sync (and each time you open this view) saves a snapshot of your inventory and adds what's new. It needs at least two readings on different days.",
  "Papeles en inventario": "Papers in inventory",
  "Valor estimado (mercado)": "Estimated value (market)",
  "No tienes papeles en assets (o falta el scope de assets). Es el loot redimible que vendes en el mercado.":
    "No papers in assets (or the assets scope is missing). It's the redeemable loot you sell on the market.",
  "Por ubicación": "By location",
  "Bounties y ESS": "Bounties & ESS",
  Recompensas: "Rewards",
  "Movimientos de Wallet": "Wallet movements",
  Mercado: "Market",
  Seguros: "Insurance",
  Contratos: "Contracts",
  Otros: "Other",
  Donaciones: "Donations",
  Servicios: "Services",
  Impuestos: "Taxes",
  "Distribución por categoría": "Distribution by category",
  "Dentro de": "Inside",
  cerrar: "close",
  "Buscar por item, sistema, ubicación o contenedor…":
    "Search by item, system, location or container…",
  entradas: "entries",
  "Cargando inventario…": "Loading inventory…",
  "Sin assets.": "No assets.",
  Contenedor: "Container",
  "Ver fit de": "View fit of",
  "la nave": "the ship",
  Abrir: "Open",
  contenedor: "container",
  "Afina la búsqueda para ver más.": "Refine the search to see more.",

  // --- Fiteos ---
  Importados: "Imported",
  "fits de": "fits from",
  "tu personaje": "your character",
  "No hay fits nuevos que importar.": "No new fits to import.",
  "Pega aquí un fit en formato EFT:": "Paste a fit in EFT format here:",
  "Importar fit (EFT)": "Import fit (EFT)",
  "Aún no hay personajes.": "No characters yet.",
  "Selecciona un personaje para ver sus contactos y standings.":
    "Select a character to see their contacts and standings.",
  "Selecciona un personaje para ver sus stats de Guerra de Facciones.":
    "Select a character to see their Faction Warfare stats.",
  "Selecciona un personaje para ver la estimación de Abyssals.":
    "Select a character to see the Abyssals estimate.",
  "Sin actividad.": "No activity.",
  "Ver detalle": "View detail",
  "Selecciona un personaje arriba para importar sus fits del juego":
    "Select a character above to import their in-game fits",
  "Trae tus fits guardados en EVE": "Bring your fits saved in EVE",
  "Importar fits del juego": "Import fits from game",
  "Borrar fit": "Delete fit",
  "Aún no hay fiteos. Pega un EFT (en EVE: clic derecho en el fitting → Copiar al portapapeles) y pulsa Importar.":
    "No fits yet. Paste an EFT (in EVE: right-click the fitting → Copy to clipboard) and press Import.",
  "Pasa el ratón por un módulo para ver su info.": "Hover over a module to see its info.",
  "Puedes pilotar este fit con tus skills.": "You can fly this fit with your skills.",
  "Te faltan": "You're missing",
  "Drones / Carga": "Drones / Cargo",
  "Slot alto": "High slot",
  "Slot medio": "Mid slot",
  "Slot bajo": "Low slot",
  Subsistema: "Subsystem",

  // sonidos de alerta
  "Ping cristalino": "Crystal ping",
  "Chime (dos notas)": "Chime (two notes)",
  "Alarma (urgente)": "Alarm (urgent)",
  Campana: "Bell",
  Sonar: "Sonar",
  Sirena: "Siren",
  "Personalizado (archivo)": "Custom (file)",

  "Tu nave": "Your ship",
  Ventana: "Window",
  semanas: "weeks",
  Eficacia: "Efficiency",
  "Tendencia (kills/losses por semana)": "Trend (kills/losses per week)",
  "Hace falta historial de varias semanas para ver la tendencia.":
    "You need several weeks of history to see the trend.",
  "Sin datos en el rango elegido.": "No data in the selected range.",
  "evolución semanal": "weekly evolution",
  "Con las que vuelas": "Ships you fly",
  Destruidas: "Destroyed",
  "Actividad PvP": "PvP activity",
  "semanal · combina series en la leyenda": "weekly · combine series in the legend",
  "Naves: con las que vuelas": "Ships: the ones you fly",
  "Naves: destruidas": "Ships: destroyed",
  Tendencia: "Trend",
  Naves: "Ships",
  Sistemas: "Systems",
  "Elige al menos una serie en la leyenda.": "Pick at least one series in the legend.",
  "Esta semana": "This week",
  pilotos: "pilots",
  "Datos de tu histórico local · pasa el ratón para pausar":
    "Data from your local history · hover to pause",

  // Bitácora (logros propios + retos adaptativos)
  Bitácora: "Logbook",
  Logros: "Achievements",
  "Tus logros y retos personales, generados de tu propia historia":
    "Your personal achievements and challenges, generated from your own history",
  "Logros nuevos desbloqueados": "New achievements unlocked",
  "Retos del mes": "Challenges of the month",
  "Tu mes anterior marca el listón · quedan": "Your previous month sets the bar · time left:",
  "Sin actividad el mes pasado con la que fijar retos. Juega un mes y vuelve: el listón se pone solo.":
    "No activity last month to set challenges from. Play a month and come back: the bar sets itself.",
  "¡Conseguido!": "Done!",
  objetivo: "target",
  "mes pasado": "last month",
  "Tu mes anterior": "Your previous month",
  Medallero: "Medal case",
  "medallas · generadas de tu propia historia": "medals · generated from your own history",
  Bronce: "Bronze",
  Plata: "Silver",
  Oro: "Gold",
  "Logros y retos generados por Koru desde tu histórico local — FC no expone esto por ESI: es tuyo y de nadie más.":
    "Achievements and challenges generated by Koru from your local history — FC doesn't expose this via ESI: it's yours and no one else's.",
  "Rateo del mes": "Ratting this month",
  "Minería del mes": "Mining this month",
  "Kills del mes": "Kills this month",
  "ISK destruido del mes": "ISK destroyed this month",
  "Señor de la guerra": "Warlord",
  "Kills totales acumuladas": "Total accumulated kills",
  Destructor: "Destroyer",
  "ISK total destruido": "Total ISK destroyed",
  "Caza mayor": "Big game hunter",
  "Tu killmail más caro": "Your most expensive killmail",
  "Lobo solitario": "Lone wolf",
  "Kills en solitario": "Solo kills",
  "Golpe de gracia": "Coup de grâce",
  "Final blows asestados": "Final blows landed",
  "Nómada de guerra": "War nomad",
  "Sistemas distintos con kills": "Distinct systems with kills",
  "Sin descanso": "Relentless",
  "Semanas seguidas con actividad PvP": "Consecutive weeks with PvP activity",
  "Azote de piratas": "Scourge of pirates",
  "ISK total rateado (bounties + ESS)": "Total ISK ratted (bounties + ESS)",
  "Corazón de roca": "Heart of stone",
  "Valor total minado (estimado)": "Total mined value (estimated)",
  Magnate: "Tycoon",
  "Mejor marca de patrimonio": "Best net-worth mark",
  "Buen gestor": "Good steward",
  "Meses cerrados en positivo": "Months closed in the green",
  Impecable: "Flawless",
  "Meses con eficacia ≥90% (mín. 10 kills)": "Months with ≥90% efficiency (min. 10 kills)",
  // inmersión (tema ambiental, nave actual, downtime)
  "Ambiente (donde estás)": "Ambient (where you are)",
  "Nave actual": "Current ship",
  "Downtime en curso": "Downtime in progress",
  "Downtime diario de Tranquility (11:00 UTC)": "Tranquility daily downtime (11:00 UTC)",
  "Cuenta atrás para el downtime diario (11:00 UTC)":
    "Countdown to daily downtime (11:00 UTC)",
  // --- Red de Ansiblex (pegar → revisar → confirmar) ---
  "Red de Ansiblex de la alianza": "Alliance Ansiblex network",
  puentes: "bridges",
  sistemas: "systems",
  "Sin red importada.": "No network imported.",
  "ESI no publica los Ansiblex: no hay endpoint ni scope, y el de estructuras de corp exige rol Director, solo ve los de tu corp y ni siquiera trae el destino. Por eso la red se pega desde la tabla que publica tu alianza.":
    "ESI does not publish Ansiblexes: there is no endpoint or scope, and the corp structures one needs a Director role, only sees your own corp's, and doesn't even include the destination. That's why the network is pasted from the table your alliance publishes.",
  "Pegar red": "Paste network",
  "Actualizar red": "Update network",
  "Vaciar red": "Clear network",
  "Red vaciada.": "Network cleared.",
  "Selecciona la tabla de jump bridges en el wiki de tu alianza, cópiala y pégala aquí tal cual. Da igual que traiga el título, la cabecera o columnas de más.":
    "Select the jump bridge table on your alliance wiki, copy it and paste it here as-is. It doesn't matter if it brings the title, the header row or extra columns.",
  Analizar: "Analyse",
  "filas leídas": "rows read",
  "líneas ignoradas": "ignored lines",
  "Ver líneas ignoradas": "Show ignored lines",
  "Sistemas que no existen en el SDE (¿errata al copiar?)":
    "Systems not found in the SDE (copy typo?)",
  "puentes declarados en un solo sentido (¿pegado a medias?)":
    "bridges declared in one direction only (half-pasted?)",
  "puentes cuya distancia declarada no cuadra con la del SDE. Revísalos antes de guardar.":
    "bridges whose declared distance doesn't match the SDE. Check them before saving.",
  "Sistema A": "System A",
  "Sistema B": "System B",
  Dueños: "Owners",
  "distancia declarada por la fuente": "distance declared by the source",
  "Confirmar e importar": "Confirm and import",
  "puentes guardados": "bridges saved",
  "Al confirmar se sustituye la red anterior por completo: el wiki es la foto entera y los puentes se caen y se mueven.":
    "Confirming replaces the previous network entirely: the wiki is the full picture and bridges go down and move.",
  "Rutar por Ansiblex": "Route through Ansiblex",
  "Rutar por wormholes": "Route through wormholes",
  Ansiblex: "Ansiblex",
  Wormholes: "Wormholes",
  "Usar los Ansiblex de tu alianza al calcular la ruta":
    "Use your alliance's Ansiblexes when plotting the route",
  "Usar los wormholes de Thera/Turnur (eve-scout) al calcular la ruta":
    "Use Thera/Turnur wormholes (eve-scout) when plotting the route",
  Paradas: "Stops",
  "Cómo rutar": "Routing options",
  "La ruta": "The route",
  Evitar: "Avoid",
  "Vetado ✓": "Avoided ✓",
  "Los sistemas vetados se saltan al calcular cualquier ruta.":
    "Blocked systems are skipped when plotting any route.",
  Subir: "Move up",
  Bajar: "Move down",
  "Vaciar lista": "Clear list",
  "Detalle de navegación": "Navigation detail",
  Desplegar: "Expand",
  Aviso: "Report",
  Regiones: "Regions",
  "Ver los sistemas de New Eden": "Show New Eden's systems",
  "Colapsar el mapa en regiones y agregar la capa activa por región":
    "Collapse the map into regions and aggregate the active layer per region",
  // --- Enlaces capa → sección desde el panel de contexto del mapa ---
  "Abrir tu minería": "Open your mining",
  "Abrir tus assets": "Open your assets",
  "Abrir tu PvP": "Open your PvP",
  "Abrir Cazador": "Open Hunter",
  "Abrir Planetología": "Open Planetary",
  "Abrir Misiones": "Open Missions",
  "Abrir Lealtad": "Open Loyalty",
  "Abrir Contactos": "Open Contacts",
  // --- Leyendas de escala del mapa ---
  "Kills (1 h)": "Kills (1 h)",
  "Saltos (1 h)": "Jumps (1 h)",
  "Minado (90 días)": "Mined (90 days)",
  "Salud de tus colonias": "Your colonies' health",
  "Sano (>24 h)": "Healthy (>24 h)",
  "Menos de 24 h": "Under 24 h",
  "Menos de 6 h": "Under 6 h",
  Parado: "Stopped",
  "Sin extractor": "No extractor",
  "Conexiones de wormhole": "Wormhole connections",
  Establecida: "Established",
  Movilizando: "Mobilizing",
  "Retirándose": "Withdrawing",
  Siguiendo: "Following",
  "Dejar de seguir": "Stop following",
  "Dejar de seguir a todos": "Stop following everyone",
  "Poner este sistema como destino de la ruta": "Set this system as the route destination",
  Habituales: "Regulars",
  "Ver muertes registradas en zKillboard": "See kills recorded on zKillboard",
  "sistemas evitados": "systems avoided",
  "Añadir sistema a evitar…": "Add a system to avoid…",
  "Evitar este sistema y recalcular": "Avoid this system and re-plot",
  "Haz click en sistemas del mapa para poner origen y destino.":
    "Click systems on the map to set origin and destination.",
  "Los sistemas vetados se saltan al calcular. Se recuerdan entre sesiones. Un destino nunca se evita a sí mismo.":
    "Blocked systems are skipped when plotting. They persist across sessions. A destination never avoids itself.",
  "No hay ruta posible con los filtros actuales (¿demasiados sistemas evitados?).":
    "No route possible with the current filters (too many avoided systems?).",
  "Se llega por wormhole": "Reached via wormhole",
  "La ruta usa wormholes: EVE no los rutea, «Enviar a EVE» pondrá solo el destino final.":
    "The route uses wormholes: EVE can't route them, 'Send to EVE' will set only the final destination.",
  "cargando…": "loading…",
  "Abrir eve-scout (mapa de conexiones Thera/Turnur en vivo)":
    "Open eve-scout (live Thera/Turnur connections map)",
  "Se llega por Ansiblex": "Reached via Ansiblex",
  Interceptar: "Intercept",
  "Interceptando ✓": "Intercepting ✓",
  "apuntado a mano": "manually aimed",
  "Enviar destino a EVE": "Send destination to EVE",
  "Enviar ruta a EVE": "Send route to EVE",
  "Destino en EVE": "Destination set in EVE",
  "Ruta en EVE": "Route set in EVE",
  paradas: "stops",
  "Pone el destino en el piloto automático de EVE (el juego calcula la ruta con tus preferencias).":
    "Sets the destination in EVE's autopilot (the game plots the route with your own preferences).",
  "Pone la ruta en el piloto automático de EVE (el juego la calcula con tus preferencias, Ansiblex incluidos si los tienes activados).":
    "Sets the route in EVE's autopilot (the game plots it with your own preferences, Ansiblex included if you have them enabled).",
  "Falta el permiso: vuelve a iniciar sesión con «Ubicación» para conceder «poner destino en EVE».":
    "Missing permission: log in again with 'Location' to grant 'set destination in EVE'.",
  "Traza y mantiene la ruta desde tu cazador hasta el último sistema donde lo vieron. Se re-traza si se mueve.":
    "Plots and keeps the route from your hunter to the last system it was seen in. Re-plots if it moves.",
  "Selecciona el personaje cazador: su sistema es el punto de partida de la ruta.":
    "Select the hunter character: their system is the route's starting point.",
  "Selecciona el personaje cazador para trazar desde su ubicación.":
    "Select the hunter character to plot from their location.",
  "llegas en": "you arrive in",
  "Saltos que tardas TÚ en llegar usando tus Ansiblex. La alarma sigue contando solo puertas: el hostil no puede cruzar tus puentes.":
    "Jumps it takes YOU to get there using your Ansiblexes. The alarm still counts gates only: the hostile cannot cross your bridges.",
  // --- Rastreador de firmas del escáner de sondas (v0.31, en curso) ---
  "Firmas del escáner de sondas": "Probe scanner signatures",
  "El escáner es una ventana del cliente, no un dato de ESI. Selecciona las firmas en el escáner (Ctrl+A), copia (Ctrl+C) y pega aquí. El sistema lo pones tú: el pegado no lo trae.":
    "The scanner is a client window, not ESI data. Select the signatures in the scanner (Ctrl+A), copy (Ctrl+C) and paste here. You set the system: the paste doesn't carry it.",
  "(ninguno)": "(none)",
  "buscar sistema…": "find system…",
  Elegir: "Pick",
  "No encuentro el sistema": "Can't find the system",
  firmas: "signatures",
  "Sin firmas guardadas en este sistema.": "No signatures saved in this system.",
  "Pegar escaneo": "Paste scan",
  "Borrar firmas": "Delete signatures",
  "Pega aquí el escaneo. Da igual que traiga la cabecera o el «0 filtrado(s)».":
    "Paste the scan here. It's fine if it brings the header or the '0 filtered'.",
  wormholes: "wormholes",
  ID: "ID",
  "Señal": "Signal",
  Distancia: "Distance",
  Confirmar: "Confirm",
  "Se vuelca el escaneo de este sistema conservando tus notas. Pegar solo anomalías no borra las firmas sondeadas (ni al revés).":
    "This system's scan is written keeping your notes. Pasting only anomalies won't delete the probed signatures (or vice versa).",
  Nota: "Note",
  "destino…": "destination…",
  "nota…": "note…",
  "firmas guardadas": "signatures saved",
  "Firmas del sistema borradas.": "System signatures deleted.",
  Wormhole: "Wormhole",
  Reliquias: "Relic",
  Datos: "Data",
  Gas: "Gas",
  Menas: "Ore",
  // --- Capa de firmas en el mapa ---
  "Firmas escaneadas (tuyas)": "Scanned signatures (yours)",
  Firmas: "Signatures",
  "con destino": "with destination",
  "sin identificar": "unidentified",
  "WH con destino": "WH with destination",
  "WH sin destino": "WH without destination",
  Identificadas: "Identified",
  "Sistemas con firmas": "Systems with signatures",
  "con destino anotado": "with a set destination",
  "Tus firmas del escáner de sondas, por sistema (violeta = wormhole con destino anotado · cian = wormhole sin destino · ámbar = firmas sin identificar · gris = todo identificado). Se pegan y guardan en Ajustes → Firmas.":
    "Your probe-scanner signatures, by system (violet = wormhole with a set destination · cyan = wormhole without destination · amber = unidentified signatures · grey = all identified). Paste and save them in Settings → Signatures.",
  Copias: "Backups",
  Medallas: "Medals",
  "Exploración": "Exploration",
  Minado: "Mining",
  "Cambiar categoría": "Change category",
  "nombre…": "name…",
  "Buscar este sitio en la wiki de EVE University": "Search this site on the EVE University wiki",
  "Selecciona las firmas en el escáner de sondas del juego (Ctrl+A), cópialas y pégalas aquí. El sistema lo pones tú: el pegado no lo trae. Anota el destino de un wormhole y se convierte en atajo de ruta en el mapa.":
    "Select the signatures in the game's probe scanner (Ctrl+A), copy them and paste them here. You set the system: the paste doesn't carry it. Annotate a wormhole's destination and it becomes a route shortcut on the map.",
  "Mis WH": "My WHs",
  "Usar TUS wormholes escaneados con destino anotado al calcular la ruta":
    "Use YOUR scanned wormholes with a set destination when plotting the route",
  "La ruta usa wormholes tuyos: EVE tampoco los rutea, tendrás que dar el salto a mano.":
    "The route uses your wormholes: EVE won't route those either, you'll have to make the jump yourself.",
};

export function t(s: string, lang: Lang): string {
  return lang === "en" ? EN[s] ?? s : s;
}

// --- tr() global: idioma activo a nivel de módulo, para que CUALQUIER componente traduzca
// sin pasar props. App llama setLang(lang) en cada render; los componentes llaman tr("texto"). ---
let _lang: Lang = "es";
export function setLang(l: Lang) {
  _lang = l;
}
export function getLang(): Lang {
  return _lang;
}
export function tr(s: string): string {
  return t(s, _lang);
}
