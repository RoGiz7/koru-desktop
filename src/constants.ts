// Constantes y tipos pequeños compartidos por la app (datos estáticos, sin lógica).

export type Tab =
  | "resumen"
  | "pvp"
  | "actividad"
  | "rivales"
  | "batallas"
  | "mapa"
  | "patrimonio"
  | "wallet"
  | "skills"
  | "assets"
  | "industria"
  | "comercio"
  | "rateo"
  | "abyssals"
  | "factional"
  | "mineria"
  | "contactos"
  | "planetologia"
  | "fiteos";

// Navegación en grupos → subsecciones. `soon` = placeholder "Próximamente".
// `scopes` = habilitada si el personaje tiene ALGUNO de esos scopes (en global siempre habilitada).
export type NavSub = { key: Tab; label: string; scopes?: string[]; soon?: boolean };
// `typeId` opcional = icono real de EVE (images.evetech.net) para el grupo; si no, se usa `icon` (emoji).
export const NAV: { group: string; icon: string; typeId?: number; subs: NavSub[] }[] = [
  {
    group: "Resumen",
    icon: "📊",
    subs: [
      { key: "resumen", label: "Resumen", scopes: ["esi-wallet.read_character_wallet.v1"] },
    ],
  },
  {
    group: "Patrimonio",
    icon: "💰",
    typeId: 44992, // PLEX
    subs: [
      { key: "patrimonio", label: "Resumen", scopes: ["esi-wallet.read_character_wallet.v1", "esi-assets.read_assets.v1"] },
      { key: "wallet", label: "Wallet", scopes: ["esi-wallet.read_character_wallet.v1"] },
      { key: "assets", label: "Assets", scopes: ["esi-assets.read_assets.v1"] },
      { key: "comercio", label: "Comercio", scopes: ["esi-markets.read_character_orders.v1"] },
    ],
  },
  {
    group: "PvP",
    icon: "⚔️",
    typeId: 587, // Rifter
    subs: [
      { key: "pvp", label: "PvP", scopes: ["esi-killmails.read_killmails.v1"] },
      { key: "actividad", label: "Actividad", scopes: ["esi-killmails.read_killmails.v1"] },
      { key: "rivales", label: "Rivales", scopes: ["esi-killmails.read_killmails.v1"] },
      { key: "batallas", label: "Batallas", scopes: ["esi-killmails.read_killmails.v1"] },
    ],
  },
  {
    group: "PvE",
    icon: "🛡️",
    subs: [
      { key: "rateo", label: "Rateo", scopes: ["esi-wallet.read_character_wallet.v1"] },
      { key: "abyssals", label: "Abyssals", scopes: ["esi-wallet.read_character_wallet.v1"] },
      { key: "factional", label: "Factional", scopes: ["esi-characters.read_fw_stats.v1"] },
    ],
  },
  {
    group: "Industria",
    icon: "🏭",
    typeId: 34, // Tritanium (minerales)
    subs: [
      { key: "industria", label: "Industria", scopes: ["esi-industry.read_character_jobs.v1", "esi-industry.read_character_mining.v1"] },
      { key: "mineria", label: "Minería", scopes: ["esi-industry.read_character_mining.v1"] },
      { key: "planetologia", label: "Planetología", scopes: ["esi-planets.manage_planets.v1"] },
    ],
  },
  {
    group: "Personaje",
    icon: "👤",
    subs: [
      { key: "skills", label: "Skills", scopes: ["esi-skills.read_skills.v1"] },
      { key: "contactos", label: "Contactos", scopes: ["esi-characters.read_contacts.v1"] },
      { key: "fiteos", label: "Fiteos" },
    ],
  },
];

export type MapOverlay =
  | "ubicacion"
  | "poi"
  | "pvp"
  | "security"
  | "soberania"
  | "fw"
  | "incursion"
  | "kills"
  | "jumps"
  | "assets"
  | "mineria"
  | "standings"
  | "wormholes"
  | "intel";

export type Poi = { name: string; kind: "hub" | "historico" | "pvp"; note: string };

export const FEATURES = [
  { key: "identity", label: "Solo identidad (0 scopes)" },
  { key: "pvp", label: "PvP / killmails" },
  { key: "wallet", label: "Wallet" },
  { key: "skills", label: "Skills" },
  { key: "assets", label: "Assets / industria" },
  { key: "location", label: "Ubicación (sistema actual)" },
  { key: "core", label: "Set completo v1" },
];

export const SCOPE = {
  pvp: "esi-killmails.read_killmails.v1",
  wallet: "esi-wallet.read_character_wallet.v1",
  skills: "esi-skills.read_skills.v1",
  assets: "esi-assets.read_assets.v1",
  jobs: "esi-industry.read_character_jobs.v1",
  mining: "esi-industry.read_character_mining.v1",
};

// Capacidades comprobables por personaje (scope representativo de cada sección).
// Sirve para avisar en la tarjeta si a un personaje le falta acceso a algo.
export const CAPS: { label: string; scope: string }[] = [
  { label: "PvP", scope: "esi-killmails.read_killmails.v1" },
  { label: "Wallet", scope: "esi-wallet.read_character_wallet.v1" },
  { label: "Skills", scope: "esi-skills.read_skills.v1" },
  { label: "Assets", scope: "esi-assets.read_assets.v1" },
  { label: "Comercio", scope: "esi-markets.read_character_orders.v1" },
  { label: "Planetología", scope: "esi-planets.manage_planets.v1" },
  { label: "Industria", scope: "esi-industry.read_character_jobs.v1" },
  { label: "Ubicación", scope: "esi-location.read_location.v1" },
  { label: "Estructuras (assets en citadels)", scope: "esi-universe.read_structures.v1" },
  { label: "Fatiga de salto", scope: "esi-characters.read_fatigue.v1" },
  { label: "Fittings (fiteos del juego)", scope: "esi-fittings.read_fittings.v1" },
];

export const KM_LIMIT = 50;
export const AUTO_SYNC_MS = 30 * 60 * 1000; // auto-sync cada 30 min

export const TABS: { key: Tab; label: string; enabled: (s: string[]) => boolean }[] = [
  { key: "pvp", label: "PvP", enabled: (s) => s.includes(SCOPE.pvp) },
  { key: "rivales", label: "Rivales", enabled: (s) => s.includes(SCOPE.pvp) },
  { key: "batallas", label: "Batallas", enabled: (s) => s.includes(SCOPE.pvp) },
  { key: "patrimonio", label: "Patrimonio", enabled: (s) => s.includes(SCOPE.wallet) || s.includes(SCOPE.assets) },
  { key: "wallet", label: "Wallet", enabled: (s) => s.includes(SCOPE.wallet) },
  { key: "skills", label: "Skills", enabled: (s) => s.includes(SCOPE.skills) },
  { key: "assets", label: "Assets", enabled: (s) => s.includes(SCOPE.assets) },
  {
    key: "industria",
    label: "Industria",
    enabled: (s) => s.includes(SCOPE.jobs) || s.includes(SCOPE.mining),
  },
];

// Título + subtítulo por sección (header consistente del stage)
export const TAB_HEAD: Record<Tab, { title: string; subtitle: string }> = {
  resumen: { title: "Resumen", subtitle: "Balance del mes, ingresos y gastos por categoría" },
  mapa: { title: "Mapa", subtitle: "New Eden con overlays de actividad, assets y soberanía" },
  pvp: { title: "PvP", subtitle: "Killmails, eficacia ISK y actividad de combate" },
  actividad: { title: "Actividad", subtitle: "Actividad diaria y horas calientes (UTC EVE)" },
  rivales: { title: "Rivales", subtitle: "A quién matas y quién te mata (por personaje y corp)" },
  batallas: { title: "Batallas", subtitle: "Concentraciones de killmails por sistema y momento" },
  patrimonio: { title: "Patrimonio", subtitle: "Líquido + valor de assets y su evolución en el tiempo" },
  wallet: { title: "Wallet", subtitle: "Balance, ingresos, gastos y movimientos recientes" },
  skills: { title: "Skills", subtitle: "SP totales y cola de entrenamiento" },
  assets: { title: "Assets", subtitle: "Inventario, tipos y valor estimado de mercado" },
  industria: { title: "Industria", subtitle: "Trabajos activos y registro de minería" },
  mineria: { title: "Minería", subtitle: "Mineral extraído, valor estimado y por sistema" },
  comercio: { title: "Comercio", subtitle: "Tus órdenes de compra/venta en el mercado" },
  rateo: { title: "Rateo", subtitle: "Ingresos por bounties (PvE)" },
  abyssals: { title: "Abyssals", subtitle: "Runs abisales (estimado por loot y journal)" },
  factional: { title: "Factional", subtitle: "Tu participación en la Guerra de Facciones" },
  planetologia: { title: "Planetología", subtitle: "Tus colonias y extractores (PI)" },
  contactos: { title: "Contactos", subtitle: "Tus contactos y standings con NPC" },
  fiteos: { title: "Fiteos", subtitle: "Tus fits guardados (importados por EFT)" },
};

// Facciones de la Guerra de Facciones (los 4 imperios). Color + nombre por faction_id.
export const FW_FACTIONS: Record<number, { name: string; color: string }> = {
  500001: { name: "Estado Caldari", color: "#4a90d9" },
  500002: { name: "República Minmatar", color: "#c0392b" },
  500003: { name: "Imperio Amarr", color: "#d4af37" },
  500004: { name: "Federación Gallente", color: "#2ecc71" },
};

// Lugares notables (POI). Se buscan por NOMBRE en neweden.json (sin hardcodear IDs);
// si un nombre no existe en el SDE, simplemente no se dibuja (sin romper nada).
export const POIS: Poi[] = [
  { name: "Jita", kind: "hub", note: "Mayor hub comercial (Caldari)" },
  { name: "Amarr", kind: "hub", note: "Hub comercial del Imperio Amarr" },
  { name: "Dodixie", kind: "hub", note: "Hub comercial Gallente" },
  { name: "Rens", kind: "hub", note: "Hub comercial Minmatar" },
  { name: "Hek", kind: "hub", note: "Hub comercial Minmatar" },
  { name: "Yulai", kind: "historico", note: "Antiguo hub universal; corazón histórico" },
  { name: "New Caldari", kind: "historico", note: "Sistema natal Caldari (Caldari Prime)" },
  { name: "Tama", kind: "pvp", note: "Lowsec célebre de PvP (frontera Caldari/Gallente)" },
  { name: "Rancer", kind: "pvp", note: "Famoso por las emboscadas en su ruta" },
  { name: "Old Man Star", kind: "pvp", note: "Icono de la Guerra de Facciones (lowsec)" },
];

// Sub-filtros desplegables por capa (estilo mapa oficial). Solo las capas que aquí aparecen
// muestran desplegable; el valor "all" = sin filtrar.
export const SUBFILTERS: Partial<Record<MapOverlay, { v: string; l: string }[]>> = {
  soberania: [
    { v: "all", l: "Todos" },
    { v: "alliance", l: "Alianzas" },
    { v: "faction", l: "Facciones" },
  ],
  fw: [
    { v: "all", l: "Todos" },
    { v: "500003", l: "Amarr" },
    { v: "500001", l: "Caldari" },
    { v: "500004", l: "Gallente" },
    { v: "500002", l: "Minmatar" },
  ],
  poi: [
    { v: "all", l: "Todos" },
    { v: "hub", l: "Hubs" },
    { v: "historico", l: "Históricos" },
    { v: "pvp", l: "PvP" },
  ],
};

// Categorías para agrupar las capas del mapa en desplegables (evita la fila enorme de iconos).
export type OverlayCat = "tu" | "universo" | "vivo";
export const OVERLAY_CATS: { key: OverlayCat; label: string; icon: string }[] = [
  { key: "tu", label: "Tú", icon: "👤" },
  { key: "universo", label: "Universo", icon: "🌌" },
  { key: "vivo", label: "En vivo", icon: "📡" },
];

// `typeId` opcional = icono real de EVE (images.evetech.net) para la capa; si no, se usa el emoji `icon`.
export const OVERLAYS: { key: MapOverlay; label: string; short: string; icon: string; typeId?: number; cat: OverlayCat }[] = [
  { key: "ubicacion", label: "Ubicación", short: "Ubicación", icon: "📍", typeId: 670, cat: "tu" }, // Capsule
  { key: "pvp", label: "Tu PvP", short: "Tu PvP", icon: "⚔️", typeId: 587, cat: "tu" }, // Rifter
  { key: "assets", label: "Tus assets", short: "Assets", icon: "📦", typeId: 17366, cat: "tu" }, // Station Container
  { key: "mineria", label: "Tu minería", short: "Minería", icon: "⛏️", typeId: 1230, cat: "tu" }, // Veldspar
  { key: "standings", label: "Standings NPC", short: "Standings", icon: "🤝", cat: "tu" },
  { key: "poi", label: "Lugares notables", short: "Lugares", icon: "🏛️", typeId: 35832, cat: "universo" }, // Astrahus
  { key: "security", label: "Seguridad", short: "Seguridad", icon: "🛡️", typeId: 2046, cat: "universo" }, // Damage Control I
  { key: "soberania", label: "Soberanía", short: "Soberanía", icon: "👑", typeId: 32458, cat: "universo" }, // Sovereignty Hub
  { key: "fw", label: "Guerra de facciones", short: "Facciones", icon: "◎", typeId: 17841, cat: "universo" }, // Federation Navy Comet
  { key: "kills", label: "Kills última hora", short: "Kills 1h", icon: "💥", typeId: 484, cat: "vivo" }, // 125mm Gatling AutoCannon I
  { key: "jumps", label: "Jumps última hora", short: "Jumps 1h", icon: "➿", typeId: 21096, cat: "vivo" }, // Cynosural Field Generator I
  { key: "intel", label: "Intel en vivo (chat)", short: "Intel", icon: "🚨", cat: "vivo" },
  { key: "incursion", label: "Incursiones (Sansha)", short: "Incursiones", icon: "🌀", cat: "vivo" },
  { key: "wormholes", label: "Wormholes Thera/Turnur", short: "Wormholes", icon: "🕳️", cat: "vivo" },
];
