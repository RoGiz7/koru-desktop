// Constantes y tipos pequeños compartidos por la app (datos estáticos, sin lógica).

export type Tab =
  | "pvp"
  | "rivales"
  | "batallas"
  | "mapa"
  | "patrimonio"
  | "wallet"
  | "skills"
  | "assets"
  | "industria";

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
  | "mineria";

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
  mapa: { title: "Mapa", subtitle: "New Eden con overlays de actividad, assets y soberanía" },
  pvp: { title: "PvP", subtitle: "Killmails, eficacia ISK y actividad de combate" },
  rivales: { title: "Rivales", subtitle: "A quién matas y quién te mata (por personaje y corp)" },
  batallas: { title: "Batallas", subtitle: "Concentraciones de killmails por sistema y momento" },
  patrimonio: { title: "Patrimonio", subtitle: "Líquido + valor de assets y su evolución en el tiempo" },
  wallet: { title: "Wallet", subtitle: "Balance, ingresos, gastos y movimientos recientes" },
  skills: { title: "Skills", subtitle: "SP totales y cola de entrenamiento" },
  assets: { title: "Assets", subtitle: "Inventario, tipos y valor estimado de mercado" },
  industria: { title: "Industria", subtitle: "Trabajos activos y registro de minería" },
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

export const OVERLAYS: { key: MapOverlay; label: string; short: string; icon: string; group: "publico" | "tuyo" }[] = [
  { key: "ubicacion", label: "Ubicación", short: "Ubicación", icon: "📍", group: "tuyo" },
  { key: "poi", label: "Lugares notables", short: "Lugares", icon: "🏛️", group: "publico" },
  { key: "security", label: "Seguridad", short: "Seguridad", icon: "🛡️", group: "publico" },
  { key: "soberania", label: "Soberanía", short: "Soberanía", icon: "👑", group: "publico" },
  { key: "fw", label: "Guerra de facciones", short: "Facciones", icon: "◎", group: "publico" },
  { key: "incursion", label: "Incursiones (Sansha)", short: "Incursiones", icon: "🌀", group: "publico" },
  { key: "kills", label: "Kills última hora", short: "Kills 1h", icon: "💥", group: "publico" },
  { key: "jumps", label: "Jumps última hora", short: "Jumps 1h", icon: "➿", group: "publico" },
  { key: "pvp", label: "Tu PvP", short: "Tu PvP", icon: "⚔️", group: "tuyo" },
  { key: "assets", label: "Tus assets", short: "Assets", icon: "📦", group: "tuyo" },
  { key: "mineria", label: "Tu minería", short: "Minería", icon: "⛏️", group: "tuyo" },
];
