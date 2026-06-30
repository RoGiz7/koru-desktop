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
export function tr(s: string): string {
  return t(s, _lang);
}
