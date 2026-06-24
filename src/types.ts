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
