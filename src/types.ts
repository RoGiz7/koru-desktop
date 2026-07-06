// Tipos de datos compartidos (formas que devuelve el backend / SDE). Solo tipos, sin lógica.

export type Character = {
  character_id: number;
  name: string;
  scopes: string[];
  last_sync: string | null;
};
export type LoginOutcome = { character_id: number; character_name: string; scopes: string[] };
export type CharacterCard = {
  character_id: number;
  name: string;
  corporation_id: number | null;
  corporation_name: string | null;
  alliance_id: number | null;
  alliance_name: string | null;
  system_id: number | null;
  system_name: string | null;
  ship_type_id: number | null;
  ship_type_name: string | null;
  ship_name: string | null;
  scopes: string[];
};

export type NameCount = { id: number; count: number; name: string | null; region: string | null };
/// Punto de serie semanal por entidad (nave/sistema) para las líneas de "tops" de PvP.
export type TopSeriesPoint = {
  week: string;
  date: string;
  id: number;
  count: number;
  name: string | null;
};
export type TopKill = {
  killmail_id: number;
  isk_value: number | null;
  system_id: number | null;
  system_name: string | null;
  victim_ship_id: number | null;
  victim_ship_name: string | null;
  killed_at: string | null;
};
export type KillmailRow = {
  killmail_id: number;
  is_loss: boolean;
  ship_type_id: number | null;
  victim_ship_id: number | null;
  system_id: number | null;
  isk_value: number | null;
  killed_at: string | null;
  solo: boolean;
  char_damage: number | null;
  final_blow: boolean;
  top_damage: boolean;
  ship_name: string | null;
  victim_ship_name: string | null;
  system_name: string | null;
};
export type PvpStats = {
  kills: number;
  losses: number;
  isk_destroyed: number;
  isk_lost: number;
  solo_kills: number;
  final_blows: number;
  top_damage_kills: number;
  efficiency: number;
  top_ships: NameCount[];
  top_systems: NameCount[];
  top_expensive: TopKill[];
  recent: KillmailRow[];
};

export type RefTypeSum = { ref_type: string; total: number };
export type JournalRow = {
  id: number;
  date: string | null;
  ref_type: string | null;
  amount: number | null;
  balance: number | null;
  description: string | null;
};
export type WalletStats = {
  income: number;
  expense: number;
  net: number;
  entries: number;
  top_income: RefTypeSum[];
  top_expense: RefTypeSum[];
  recent: JournalRow[];
};
export type WalletView = { balance: number; stats: WalletStats };
export type WalletTrendPoint = { month: string; income: number; expense: number };
export type WalletDay = { date: string; income: number; expense: number };
export type WalletCatDay = { cat: string; date: string; net: number };
export type WalletCharDay = { character_id: number; date: string; net: number };
export type WalletSeries = {
  daily: WalletDay[];
  by_cat: WalletCatDay[];
  by_char: WalletCharDay[];
};

export type NetworthPoint = { date: string; liquid: number; asset_value: number; total: number };
export type NetworthView = {
  liquid: number;
  asset_value: number;
  total: number;
  series: NetworthPoint[];
  prices_loaded: number;
};

export type QueueItem = {
  skill_id: number;
  finished_level: number;
  finish_date: string | null;
  queue_position: number;
  skill_name: string | null;
};
export type SkillsSummary = {
  total_sp: number;
  unallocated_sp: number;
  skill_count: number;
  queue: QueueItem[];
};
// Línea de intel parseada de un log de chat del juego.
export type IntelLine = {
  ts_ms: number;
  channel: string;
  author: string;
  message: string;
};

// Conexión de wormhole pública de eve-scout (Thera/Turnur ↔ k-space).
export type WhConn = {
  system_id: number;
  system_name: string;
  hub: string;
  wh_type: string;
  max_ship_size: string;
  remaining_hours: number;
};

// Fiteo local guardado (importado por EFT).
export type FitModule = { type_id: number; name: string; qty: number; fitted: boolean };
export type Fit = {
  id: number;
  name: string;
  ship_type_id: number;
  ship_name: string;
  modules: FitModule[];
  created_at: string;
};

// Nave capaz de saltar (datos del SDE en public/jumpships.json).
export type JumpShip = {
  id: number; // type_id (para cruzar con assets propios)
  name: string;
  group: string; // clase: Dreadnought, Carrier, Jump Freighter…
  range: number; // rango base en LY (skill 0)
  fuelPerLy: number; // isótopos por LY
  isotope: string; // nombre del isótopo (combustible)
};
export type AttrView = {
  charisma: number;
  intelligence: number;
  memory: number;
  perception: number;
  willpower: number;
  bonus_remaps: number | null;
  last_remap_date: string | null;
};
export type ImplantView = { type_id: number; name: string | null };
export type CharacterDetail = {
  birthday: string | null;
  gender: string | null;
  security_status: number | null;
  bio: string | null;
  attributes: AttrView | null;
  implants: ImplantView[];
  jump_clones: number;
  clone_implants: number;
  home_location_id: number | null;
};
export type CharTraining = {
  character_id: number;
  character_name: string;
  skill_id: number | null;
  skill_name: string | null;
  finished_level: number;
  finish_date: string | null;
};
export type GlobalSkills = {
  total_sp: number;
  unallocated_sp: number;
  skill_count: number;
  character_count: number;
  training: CharTraining[];
};

export type TypeValue = {
  type_id: number;
  qty: number;
  value: number;
  category: string;
  name: string | null;
};
export type AssetsSummary = {
  stacks: number;
  distinct_types: number;
  total_units: number;
  est_value: number;
  est_value_clean: number;
  top_value: TypeValue[];
  top_types: NameCount[];
};
export type AssetDetail = {
  type_id: number;
  type_name: string | null;
  quantity: number;
  system_id: number;
  system_name: string | null;
  location_name: string;
  container: string | null;
  container_id: number;
  container_type_id: number;
  slot: string;
  category: string;
};
export type JobView = {
  job_id: number;
  activity: string;
  runs: number;
  status: string | null;
  blueprint_name: string | null;
  product_name: string | null;
  end_date: string | null;
  character: string | null;
};
export type MiningRow = {
  date: string | null;
  system_id: number | null;
  type_id: number;
  type_name: string | null;
  quantity: number;
};
export type MiningSummary = {
  total_units: number;
  entries: number;
  top_ores: NameCount[];
  recent: MiningRow[];
};
export type MineDay = { date: string; value: number; units: number };
export type MineDimDay = { id: number; date: string; value: number; units: number };
export type MiningSeries = {
  total_value: number;
  total_units: number;
  daily: MineDay[];
  daily_by_system: MineDimDay[];
  daily_by_char: MineDimDay[];
  daily_by_ore: MineDimDay[];
  ore_names: [number, string][];
};
export type SysActivity = {
  system_id: number;
  kills: number;
  losses: number;
  isk: number;
};
export type Battle = {
  system_id: number;
  system_name: string | null;
  start: string;
  slug: string;
  kills: number;
  losses: number;
  isk: number;
  total: number;
};
export type PvpTrendPoint = {
  date: string;
  kills: number;
  losses: number;
  isk_destroyed: number;
  isk_lost: number;
};
export type RivalEntry = { id: number; name: string | null; count: number };
export type Rivals = {
  you_kill_chars: RivalEntry[];
  you_kill_corps: RivalEntry[];
  kills_you_chars: RivalEntry[];
  kills_you_corps: RivalEntry[];
};
// New Eden desde el SDE local (public/neweden.json)
export type NeSystem = {
  id: number;
  n: string;
  x: number;
  y: number;
  s: number;
  r: number;
  c: number;
  gx: number;
  gy: number;
  gz: number;
};
export type NewEden = {
  systems: NeSystem[];
  jumps: [number, number][];
  regions: { id: number; n: string }[];
  constellations: { id: number; n: string }[];
};
export type SystemKills = { system_id: number; ship_kills: number; pod_kills: number; npc_kills: number };
export type SystemJumps = { system_id: number; ship_jumps: number };
export type AssetSystem = { system_id: number; count: number };
export type SovSystem = { system_id: number; owner_id: number | null; kind: string; owner_name: string | null };
export type FwSystem = {
  solar_system_id: number;
  owner_faction_id: number;
  occupier_faction_id: number;
  contested: string | null;
  victory_points: number;
  victory_points_threshold: number;
};
export type CharLoc = { id: number; name: string; system_id: number };
export type RattingPoint = { date: string; isk: number };
export type JournalSample = {
  ref_type: string;
  amount: number;
  date: string | null;
  description: string | null;
  reason: string | null;
  context_id: number | null;
  context_id_type: string | null;
  first_party_id: number | null;
  second_party_id: number | null;
};
export type RattingSummary = { total: number; entries: number; trend: RattingPoint[] };
export type RattingSystem = {
  system_id: number;
  isk: number;
  bounty: number;
  ess: number;
  rats: number;
  active_hours: number;
};
export type RattingDay = { date: string; bounty: number; ess: number; rats: number };
export type RatSysDay = { system_id: number; date: string; isk: number };
export type RatCharDay = { character_id: number; date: string; isk: number };
export type RattingDetail = {
  total_bounty: number;
  total_ess: number;
  rats_killed: number;
  entries: number;
  active_hours: number;
  by_system: RattingSystem[];
  daily: RattingDay[];
  daily_by_system: RatSysDay[];
  daily_by_char: RatCharDay[];
};
export type SpecialRat = {
  type_id: number;
  name: string | null;
  class: "officer" | "capital" | "faction";
  count: number;
};
export type SpecialRatSystem = {
  system_id: number;
  total: number;
  by_type: SpecialRat[];
};
export type SpecialRatsResult = {
  total: number;
  officers: number;
  capitals: number;
  faction: number;
  by_type: SpecialRat[];
  by_system: SpecialRatSystem[];
};
export type DayKL = { date: string; kills: number; losses: number };
export type HourKL = { hour: number; kills: number; losses: number };
export type PvpActivity = {
  kills: number;
  losses: number;
  isk_destroyed: number;
  isk_lost: number;
  efficiency: number;
  daily: DayKL[];
  hourly: HourKL[];
};
export type MiningOre = { type_id: number; type_name: string | null; units: number; isk: number };
export type MiningSys = { system_id: number; units: number };
export type MiningMonth = { month: string; units: number; isk: number };
export type MiningDetail = {
  units: number;
  est_value: number;
  ore_types: number;
  by_ore: MiningOre[];
  by_system: MiningSys[];
  monthly: MiningMonth[];
};
export type ContactRow = {
  id: number;
  name: string | null;
  kind: string;
  standing: number;
  blocked: boolean;
  watched: boolean;
};
export type StandingRow = { id: number; name: string | null; kind: string; standing: number };
export type FwCountsView = { yesterday: number; last_week: number; total: number };
export type FactionalView = {
  enlisted: boolean;
  enlisted_on: string | null;
  faction_id: number | null;
  current_rank: number | null;
  highest_rank: number | null;
  kills: FwCountsView;
  victory_points: FwCountsView;
};
export type FilamentRow = { name: string; count: number; isk: number };
export type PaperLoc = { location_name: string; system_id: number; quantity: number };
export type PaperGroup = {
  source: string; // "abyssal" | "crab"
  type_id: number;
  name: string;
  qty: number;
  value: number;
  by_loc: PaperLoc[];
};
export type AbyssalsData = {
  runs_est: number;
  isk_spent: number;
  by_filament: FilamentRow[];
  papers_qty: number;
  papers_value: number;
  papers_by_loc: PaperLoc[];
  papers: PaperGroup[];
};
export type PaperDay = { date: string; source: string; value: number };
export type PaperSeries = { daily: PaperDay[] };
export type ImportResult = {
  total_rows: number;
  imported: number;
  skipped_dup: number;
  skipped_unknown: number;
  date_min: string | null;
  date_max: string | null;
  by_char: [string, number][];
};
export type CategorySum = { category: string; isk: number; prev_isk: number };
export type FinancialSummary = {
  income_total: number;
  expense_total: number;
  net: number;
  prev_income_total: number;
  prev_expense_total: number;
  prev_net: number;
  income_by_category: CategorySum[];
  expense_by_category: CategorySum[];
};
export type Planet = {
  system_id: number;
  system_name: string | null;
  planet_type: string;
  upgrade_level: number;
  num_pins: number;
  last_update: string | null;
};
export type MarketOrder = {
  type_id: number;
  type_name: string | null;
  is_buy: boolean;
  price: number;
  volume_remain: number;
  volume_total: number;
  system_id: number;
  system_name: string | null;
  issued: string | null;
  duration: number;
  best_competitor: number | null;
  is_best: boolean;
  competitors: number;
};
export type TradePnlItem = {
  type_id: number;
  name: string | null;
  bought_qty: number;
  sold_qty: number;
  avg_buy: number;
  avg_sell: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
};
export type PnlDay = { date: string; profit: number };
export type HistPoint = { date: string; average: number; volume: number };
export type BookLevel = { price: number; volume: number; orders: number; cum: number };
export type WatchItem = {
  type_id: number;
  name: string | null;
  best_buy: number;
  best_sell: number;
  spread: number;
  margin: number;
  day_volume: number;
  avg_volume: number;
  history: HistPoint[];
  buy_levels: BookLevel[];
  sell_levels: BookLevel[];
};
export type ArbItem = {
  type_id: number;
  name: string | null;
  buy_hub: string;
  buy_price: number;
  sell_hub: string;
  sell_price: number;
  profit: number;
  margin: number;
  dest_volume: number;
};
// Buscador de oportunidades (Comercio Nivel 4): oportunidad de station-trading detectada en un hub.
export type OppItem = {
  type_id: number;
  name: string | null;
  avg_volume: number;
  avg_price: number;
  isk_volume: number;
  best_buy: number;
  best_sell: number;
  spread: number;
  margin: number;
  daily_potential: number;
};
// Un grupo de mercado del SDE (market_groups.json). p = grupo padre, h = tiene tipos directos.
export type MGroup = { i: number; n: string; ne: string; p: number | null; h: boolean };
export type TradePnl = {
  total_profit: number;
  total_revenue: number;
  total_cost: number;
  total_tax: number;
  items: TradePnlItem[];
  daily: PnlDay[];
};
/// Bitácora: retos adaptativos + medallero propio (comando get_bitacora, solo BD local).
export type Challenge = {
  id: string;
  unit: string;
  baseline: number;
  current: number;
  target: number;
};
export type AchievementState = {
  id: string;
  unit: string;
  value: number;
  level: number;
  thresholds: [number, number, number];
  unlocked_at: [string | null, string | null, string | null];
  fresh: boolean;
};
export type Bitacora = {
  challenges: Challenge[];
  achievements: AchievementState[];
  // ¿El sujeto ya estaba sembrado antes de esta evaluación? (el 1er sembrado no se celebra)
  was_seeded: boolean;
};
// Evolución de un logro: valor acumulado por mes (para el mini-gráfico con líneas de tier).
export type SeriesPoint = { month: string; value: number };
// Evento "bitacora-unlock": logros nuevos detectados en auto_sync (nombres los pone el front).
export type BitacoraUnlock = { id: string; level: number };
export type BitacoraUnlockEvent = { unlocks: BitacoraUnlock[] };
// Diario: etapa de corporationhistory (endpoint público) = espina biográfica del timeline.
export type DiaryCorp = { corporation_id: number; corporation_name: string | null; start_date: string };
// Proyecto personal: meta propia del usuario medida del histórico local (kills/ISK/minería/…).
export type PersonalProject = {
  id: number;
  name: string;
  metric: string;
  target: number;
  current: number;
  param_kind: string; // ""|ship|ore|system
  param_ids: string; // CSV de type/system IDs (multi-selección)
  param_name: string;
  mode: string; // solo mineria: ""|value|units|volume|reproceso
  completed_at: string; // RFC3339 al completar; "" = activo
};
// Trabajos por libre (Freelance Jobs, sucesor de Opportunities) en los que participa el personaje.
export type FreelanceJob = {
  id: string;
  name: string;
  state: string;
  career: string;
  description: string;
  expires: string;
  progress_current: number;
  progress_desired: number;
  reward_remaining: number;
};
// Proyecto de corporación (Corporation Projects; scope de corp read_projects). Parse best-effort.
export type CorpProject = {
  id: string;
  name: string;
  state: string;
  description: string;
  career: string;
  method: string;
  groups: string[];
  location: string;
  icon_type_id: number | null; // tipo del ítem a entregar → icono EVE
  progress_current: number;
  progress_desired: number;
  contributed: number;
  reward_remaining: number;
};
// Lealtad: LP por corporación NPC (recompensa de misiones, scope read_loyalty).
export type LoyaltyCorp = { corporation_id: number; corporation_name: string | null; loyalty_points: number };
// Medalla in-game (condecoración de corp) para el medallero mixto de la Bitácora (scope read_medals).
export type Medal = {
  medal_id: number;
  title: string;
  description: string;
  corporation_id: number;
  corporation_name: string | null;
  date: string;
  reason: string;
  status: string;
};

/// Datos vivos del ticker del dock (comando get_ticker, solo BD local).
export type TickerData = {
  kills_week: number;
  kills_prev_week: number;
  isk_destroyed_week: number;
  networth: number | null;
  networth_prev: number | null;
  month_net: number | null;
  prev_month_net: number | null;
  plex_price: number | null;
};

export type ServerStatus = {
  players: number;
  server_version: string;
  start_time: string | null;
  vip: boolean;
};
export type Incursion = {
  constellation_id: number;
  faction_id: number;
  has_boss: boolean;
  infested_solar_systems: number[];
  influence: number;
  staging_solar_system_id: number;
  state: string | null;
  kind: string | null;
};

// Config + callbacks de la capa de Intel en vivo (props de MapView, compartida con useIntel).
export type IntelConfig = {
  lines: IntelLine[];
  availChannels: string[];
  channels: string[];
  folder: string;
  recency: number;
  alertJumps: number;
  sound: boolean;
  anchors: number[];
  onlyRange: boolean;
  soundChoice: string;
  soundFile: string;
  live: boolean;
  onToggleLive?: () => void;
  onIntelAlert?: (text: string) => void;
  onClearAlert?: () => void;
  onConfig: (patch: {
    channels?: string[];
    recency?: number;
    alertJumps?: number;
    sound?: boolean;
    folder?: string;
    anchors?: number[];
    onlyRange?: boolean;
    soundChoice?: string;
    soundFile?: string;
  }) => void;
  onPickFolder: () => void;
  onPickSound: () => void;
};
