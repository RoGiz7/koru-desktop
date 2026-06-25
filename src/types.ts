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
  scopes: string[];
};

export type NameCount = { id: number; count: number; name: string | null; region: string | null };
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
  system_id: number | null;
  isk_value: number | null;
  killed_at: string | null;
  solo: boolean;
  char_damage: number | null;
  final_blow: boolean;
  top_damage: boolean;
  ship_name: string | null;
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

export type AssetsSummary = {
  stacks: number;
  distinct_types: number;
  total_units: number;
  est_value: number;
  top_types: NameCount[];
};
export type AssetDetail = {
  type_id: number;
  type_name: string | null;
  quantity: number;
  system_id: number;
  system_name: string | null;
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
export type RattingSystem = { system_id: number; isk: number; rats: number };
export type RattingDay = { date: string; bounty: number; ess: number; rats: number };
export type RattingDetail = {
  total_bounty: number;
  total_ess: number;
  rats_killed: number;
  entries: number;
  active_hours: number;
  by_system: RattingSystem[];
  daily: RattingDay[];
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
