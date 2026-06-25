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
  "Período": "Period",
  "Hora EVE": "EVE time",
  "Cargando…": "Loading…",
  "Sin datos.": "No data.",
};

export function t(s: string, lang: Lang): string {
  return lang === "en" ? EN[s] ?? s : s;
}
