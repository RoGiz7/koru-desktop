//! Inicialización y acceso a SQLite. Una conexión protegida por Mutex (suficiente para
//! una app de escritorio de un solo usuario; si crece, pasar a un pool).

use crate::error::AppResult;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Db {
    pub conn: Mutex<Connection>,
}

impl Db {
    /// Abre (o crea) la BD en `path` y aplica el esquema.
    pub fn open(path: PathBuf) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.execute_batch(include_str!("schema.sql"))?;
        // Micro-migración defensiva: si la BD se creó antes de añadir `solo`, la añadimos.
        // Ignoramos el error "duplicate column name" si ya existe.
        let _ = conn.execute(
            "ALTER TABLE killmails ADD COLUMN solo INTEGER NOT NULL DEFAULT 0",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE killmails ADD COLUMN victim_ship_type_id INTEGER",
            [],
        );
        let _ = conn.execute("ALTER TABLE killmails ADD COLUMN char_damage INTEGER", []);
        let _ = conn.execute(
            "ALTER TABLE killmails ADD COLUMN final_blow INTEGER NOT NULL DEFAULT 0",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE killmails ADD COLUMN top_damage INTEGER NOT NULL DEFAULT 0",
            [],
        );
        // Journal: campos de detalle para histórico de rateo (sistema vía ESS, etc.).
        let _ = conn.execute("ALTER TABLE wallet_journal ADD COLUMN reason TEXT", []);
        let _ = conn.execute("ALTER TABLE wallet_journal ADD COLUMN context_id INTEGER", []);
        let _ = conn.execute("ALTER TABLE wallet_journal ADD COLUMN context_id_type TEXT", []);
        let _ = conn.execute("ALTER TABLE wallet_journal ADD COLUMN first_party_id INTEGER", []);
        let _ = conn.execute("ALTER TABLE wallet_journal ADD COLUMN second_party_id INTEGER", []);
        Ok(Db {
            conn: Mutex::new(conn),
        })
    }
}

/// Registro de personaje para la UI.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CharacterRow {
    pub character_id: i64,
    pub name: String,
    pub scopes: Vec<String>,
    pub last_sync: Option<String>,
}

impl Db {
    /// Inserta o actualiza un personaje tras un login.
    pub fn upsert_character(
        &self,
        character_id: i64,
        name: &str,
        scopes: &[String],
    ) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        let scopes_str = scopes.join(" ");
        conn.execute(
            "INSERT INTO characters (character_id, name, scopes, added_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(character_id) DO UPDATE SET
                name = excluded.name,
                scopes = excluded.scopes",
            rusqlite::params![character_id, name, scopes_str, now],
        )?;
        Ok(())
    }

    pub fn list_characters(&self) -> AppResult<Vec<CharacterRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT character_id, name, scopes, last_sync FROM characters ORDER BY name",
        )?;
        let rows = stmt
            .query_map([], |r| {
                let scopes: String = r.get::<_, Option<String>>(2)?.unwrap_or_default();
                Ok(CharacterRow {
                    character_id: r.get(0)?,
                    name: r.get(1)?,
                    scopes: scopes.split_whitespace().map(|s| s.to_string()).collect(),
                    last_sync: r.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn delete_character(&self, character_id: i64) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM characters WHERE character_id = ?1",
            rusqlite::params![character_id],
        )?;
        conn.execute(
            "DELETE FROM killmails WHERE character_id = ?1",
            rusqlite::params![character_id],
        )?;
        conn.execute(
            "DELETE FROM esi_cache WHERE character_id = ?1",
            rusqlite::params![character_id],
        )?;
        conn.execute(
            "DELETE FROM wallet_journal WHERE character_id = ?1",
            rusqlite::params![character_id],
        )?;
        conn.execute(
            "DELETE FROM mining_ledger WHERE character_id = ?1",
            rusqlite::params![character_id],
        )?;
        Ok(())
    }

    pub fn touch_last_sync(&self, character_id: i64) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE characters SET last_sync = ?2 WHERE character_id = ?1",
            rusqlite::params![character_id, now],
        )?;
        Ok(())
    }
}

// --- Caché de respuestas ESI (ETag / Expires) ---

#[derive(Debug, Clone)]
pub struct CacheEntry {
    pub etag: Option<String>,
    pub expires: Option<String>, // RFC3339
    pub payload: String,         // JSON crudo
}

impl Db {
    pub fn get_cache(&self, character_id: i64, endpoint: &str) -> AppResult<Option<CacheEntry>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT etag, expires, payload FROM esi_cache WHERE character_id = ?1 AND endpoint = ?2",
        )?;
        let mut rows = stmt.query(rusqlite::params![character_id, endpoint])?;
        if let Some(r) = rows.next()? {
            Ok(Some(CacheEntry {
                etag: r.get(0)?,
                expires: r.get(1)?,
                payload: r.get(2)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn put_cache(
        &self,
        character_id: i64,
        endpoint: &str,
        etag: Option<&str>,
        expires: Option<&str>,
        payload: &str,
    ) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO esi_cache (character_id, endpoint, etag, expires, payload)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(character_id, endpoint) DO UPDATE SET
                etag = excluded.etag,
                expires = excluded.expires,
                payload = excluded.payload",
            rusqlite::params![character_id, endpoint, etag, expires, payload],
        )?;
        Ok(())
    }
}

// --- Mining ledger acumulado ---

impl Db {
    pub fn upsert_mining(
        &self,
        character_id: i64,
        date: &str,
        system_id: i64,
        type_id: i64,
        quantity: i64,
    ) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO mining_ledger (character_id, date, system_id, type_id, quantity)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(character_id, date, system_id, type_id)
             DO UPDATE SET quantity = excluded.quantity",
            rusqlite::params![character_id, date, system_id, type_id, quantity],
        )?;
        Ok(())
    }

    fn mining_where(character_id: Option<i64>) -> String {
        match character_id {
            Some(cid) => format!("WHERE character_id = {cid}"),
            None => String::new(),
        }
    }

    /// (total_units, entries) del ledger acumulado.
    pub fn mining_totals(&self, character_id: Option<i64>) -> AppResult<(i64, i64)> {
        let conn = self.conn.lock().unwrap();
        let w = Self::mining_where(character_id);
        let r = conn.query_row(
            &format!("SELECT COALESCE(SUM(quantity),0), COUNT(*) FROM mining_ledger {w}"),
            [],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
        )?;
        Ok(r)
    }

    /// Top minerales por cantidad (type_id, sum).
    pub fn mining_by_type(
        &self,
        character_id: Option<i64>,
        limit: i64,
    ) -> AppResult<Vec<(i64, i64)>> {
        let conn = self.conn.lock().unwrap();
        let w = Self::mining_where(character_id);
        let mut stmt = conn.prepare(&format!(
            "SELECT type_id, SUM(quantity) q FROM mining_ledger {w} GROUP BY type_id ORDER BY q DESC LIMIT ?1"
        ))?;
        let rows = stmt
            .query_map(rusqlite::params![limit], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Cantidad minada por sistema (para el mapa).
    pub fn mining_by_system(&self, character_id: Option<i64>) -> AppResult<Vec<(i64, i64)>> {
        let conn = self.conn.lock().unwrap();
        let w = Self::mining_where(character_id);
        let mut stmt = conn.prepare(&format!(
            "SELECT system_id, SUM(quantity) q FROM mining_ledger {w} GROUP BY system_id"
        ))?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Entradas recientes (date, system_id, type_id, quantity).
    pub fn mining_recent(
        &self,
        character_id: Option<i64>,
        limit: i64,
    ) -> AppResult<Vec<(String, i64, i64, i64)>> {
        let conn = self.conn.lock().unwrap();
        let w = Self::mining_where(character_id);
        let mut stmt = conn.prepare(&format!(
            "SELECT date, system_id, type_id, quantity FROM mining_ledger {w}
             ORDER BY date DESC LIMIT ?1"
        ))?;
        let rows = stmt
            .query_map(rusqlite::params![limit], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }
}

// --- Killmails ---

#[derive(Debug, Clone, serde::Serialize)]
pub struct RattingPoint {
    pub date: String,
    pub isk: f64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RattingSummary {
    pub total: f64,
    pub entries: i64,
    pub trend: Vec<RattingPoint>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RattingSystem {
    pub system_id: i64,
    pub isk: f64,
    pub rats: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RattingDay {
    pub date: String, // YYYY-MM-DD
    pub bounty: f64,
    pub ess: f64,
    pub rats: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RattingDetail {
    pub total_bounty: f64,
    pub total_ess: f64,
    pub rats_killed: i64,
    pub entries: i64,
    pub active_hours: i64,
    pub by_system: Vec<RattingSystem>,
    pub daily: Vec<RattingDay>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CategorySum {
    pub category: String,
    pub isk: f64,
    pub prev_isk: f64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct FinancialSummary {
    pub income_total: f64,
    pub expense_total: f64, // magnitud positiva
    pub net: f64,
    pub prev_income_total: f64,
    pub prev_expense_total: f64,
    pub prev_net: f64,
    pub income_by_category: Vec<CategorySum>,
    pub expense_by_category: Vec<CategorySum>,
}

/// Categoría amistosa para un ingreso (amount > 0) según su ref_type ESI.
fn categorize_income(rt: &str) -> &'static str {
    match rt {
        "bounty_prizes" | "ess_escrow_transfer" => "Bounties y ESS",
        "agent_mission_reward" | "agent_mission_time_bonus_reward" | "agent_mission_collateral_refunded"
        | "project_discovery_reward" | "daily_goal_payouts" | "milestone_reward_payment" => "Recompensas",
        "player_donation" | "corporation_account_withdrawal" | "corporation_dividend_payment"
        | "player_trading" => "Movimientos de Wallet",
        "market_transaction" | "market_escrow" => "Mercado",
        "insurance" => "Seguros",
        "contract_price" | "contract_reward" | "contract_collateral_refund" | "contract_deposit_refund" => "Contratos",
        "industry_job_tax" => "Industria",
        _ => "Otros",
    }
}

/// Categoría amistosa para un gasto (amount < 0) según su ref_type ESI.
fn categorize_expense(rt: &str) -> &'static str {
    match rt {
        "player_donation" => "Donaciones",
        "contract_price" | "contract_brokers_fee" | "contract_deposit" | "contract_reward"
        | "contract_sales_tax" => "Contratos",
        "market_transaction" | "brokers_fee" | "transaction_tax" | "market_provider_tax" => "Mercado",
        "skill_purchase" => "Skills",
        "insurance" => "Seguros",
        "asset_safety" => "Asset Safety",
        "manufacturing" | "reprocessing_tax" | "researching_technology"
        | "researching_time_productivity" | "researching_material_productivity" | "reaction" => "Industria",
        "office_rental_fee" | "structure_gate_jump" | "jump_clone_installation_fee"
        | "jump_clone_activation_fee" | "clone_activation" | "clone_transfer" | "docking_fee" => "Servicios",
        "bounty_prize_corporation_tax" | "corporation_account_withdrawal" => "Impuestos",
        _ => "Otros",
    }
}

/// Suma las cantidades del campo `reason` de un bounty_prizes.
/// Formato: "24129: 1,24130: 6,16895: 2" => typeID_rata: cantidad.
fn parse_rat_count(reason: &str) -> i64 {
    reason
        .split(',')
        .filter_map(|p| p.rsplit(':').next()?.trim().parse::<i64>().ok())
        .sum()
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PvpTrendPoint {
    pub date: String, // primer día de la semana del bucket (YYYY-MM-DD)
    pub kills: i64,
    pub losses: i64,
    pub isk_destroyed: f64,
    pub isk_lost: f64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PvpStats {
    pub kills: i64,
    pub losses: i64,
    pub isk_destroyed: f64,
    pub isk_lost: f64,
    pub solo_kills: i64,
    pub final_blows: i64,
    pub top_damage_kills: i64,
    /// Eficacia ISK = isk_destroyed / (isk_destroyed + isk_lost) * 100.
    pub efficiency: f64,
    pub top_ships: Vec<NameCount>,
    pub top_systems: Vec<NameCount>,
    /// Top kills más caros (la nave/víctima la rellena el comando desde la caché).
    pub top_expensive: Vec<TopKill>,
    pub recent: Vec<KillmailRow>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct NameCount {
    pub id: i64,
    pub count: i64,
    #[serde(default)]
    pub name: Option<String>,
    /// Solo para sistemas: la región a la que pertenece (lo rellena el comando).
    #[serde(default)]
    pub region: Option<String>,
}

/// Un kill caro para el ranking "naves más caras destruidas".
#[derive(Debug, Clone, serde::Serialize)]
pub struct TopKill {
    pub killmail_id: i64,
    #[serde(skip)]
    pub hash: String,
    pub isk_value: Option<f64>,
    pub system_id: Option<i64>,
    pub system_name: Option<String>,
    pub victim_ship_id: Option<i64>,
    pub victim_ship_name: Option<String>,
    pub killed_at: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct KillmailRow {
    pub killmail_id: i64,
    pub is_loss: bool,
    pub ship_type_id: Option<i64>,
    pub system_id: Option<i64>,
    pub isk_value: Option<f64>,
    pub killed_at: Option<String>,
    pub solo: bool,
    pub char_damage: Option<i64>,
    pub final_blow: bool,
    pub top_damage: bool,
    #[serde(default)]
    pub ship_name: Option<String>,
    #[serde(default)]
    pub system_name: Option<String>,
}

/// Actividad PvP agregada por sistema (para el mapa).
#[derive(Debug, Clone, serde::Serialize)]
pub struct SystemActivity {
    pub system_id: i64,
    pub kills: i64,
    pub losses: i64,
    pub isk: f64,
}

/// Datos para insertar un killmail.
pub struct KmInsert<'a> {
    pub killmail_id: i64,
    pub hash: &'a str,
    pub character_id: i64,
    pub is_loss: bool,
    pub ship_type_id: Option<i64>,
    pub victim_ship_type_id: Option<i64>,
    pub system_id: Option<i64>,
    pub isk_value: Option<f64>,
    pub killed_at: Option<&'a str>,
    pub solo: bool,
    pub char_damage: Option<i64>,
    pub final_blow: bool,
    pub top_damage: bool,
    pub raw: &'a str,
}

impl Db {
    /// Devuelve los killmail_id ya almacenados para un personaje (para no re-bajar detalle).
    pub fn existing_killmail_ids(
        &self,
        character_id: i64,
    ) -> AppResult<std::collections::HashSet<i64>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT killmail_id FROM killmails WHERE character_id = ?1")?;
        let ids = stmt
            .query_map(rusqlite::params![character_id], |r| r.get::<_, i64>(0))?
            .collect::<Result<std::collections::HashSet<_>, _>>()?;
        Ok(ids)
    }

    pub fn insert_killmail(&self, k: &KmInsert) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO killmails
                (killmail_id, hash, character_id, is_loss, ship_type_id, victim_ship_type_id,
                 system_id, isk_value, killed_at, solo, char_damage, final_blow, top_damage, raw)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
             ON CONFLICT(killmail_id) DO UPDATE SET
                isk_value = COALESCE(excluded.isk_value, killmails.isk_value)",
            rusqlite::params![
                k.killmail_id,
                k.hash,
                k.character_id,
                k.is_loss as i64,
                k.ship_type_id,
                k.victim_ship_type_id,
                k.system_id,
                k.isk_value,
                k.killed_at,
                k.solo as i64,
                k.char_damage,
                k.final_blow as i64,
                k.top_damage as i64,
                k.raw
            ],
        )?;
        Ok(())
    }

    /// Lista (killmail_id, hash, character_id) de todos los killmails, para reproceso.
    pub fn all_killmail_refs(&self) -> AppResult<Vec<(i64, String, i64)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT killmail_id, hash, character_id FROM killmails")?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    r.get::<_, i64>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Actualiza los campos derivados de un killmail (reproceso). También rellena `raw`
    /// (JSON completo del killmail) si se pasa, para habilitar análisis de rivales/batallas.
    pub fn update_killmail_derived(
        &self,
        killmail_id: i64,
        victim_ship_type_id: Option<i64>,
        char_damage: Option<i64>,
        final_blow: bool,
        top_damage: bool,
        raw: Option<&str>,
    ) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE killmails SET victim_ship_type_id = ?2, char_damage = ?3,
                final_blow = ?4, top_damage = ?5,
                raw = COALESCE(?6, raw)
             WHERE killmail_id = ?1",
            rusqlite::params![
                killmail_id,
                victim_ship_type_id,
                char_damage,
                final_blow as i64,
                top_damage as i64,
                raw
            ],
        )?;
        Ok(())
    }

    pub fn pvp_stats(&self, character_id: i64) -> AppResult<PvpStats> {
        let conn = self.conn.lock().unwrap();

        let (kills, losses, isk_destroyed, isk_lost, solo_kills, final_blows, top_damage_kills): (
            i64,
            i64,
            f64,
            f64,
            i64,
            i64,
            i64,
        ) = conn.query_row(
            "SELECT
                    COALESCE(SUM(CASE WHEN is_loss = 0 THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN is_loss = 1 THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN is_loss = 0 THEN isk_value ELSE 0.0 END), 0.0),
                    COALESCE(SUM(CASE WHEN is_loss = 1 THEN isk_value ELSE 0.0 END), 0.0),
                    COALESCE(SUM(CASE WHEN is_loss = 0 AND solo = 1 THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN is_loss = 0 AND final_blow = 1 THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN is_loss = 0 AND top_damage = 1 THEN 1 ELSE 0 END), 0)
                 FROM killmails WHERE character_id = ?1",
            rusqlite::params![character_id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                ))
            },
        )?;

        let top_ships = Self::top_counts(
            &conn,
            "SELECT ship_type_id, COUNT(*) c FROM killmails
             WHERE character_id = ?1 AND is_loss = 0 AND ship_type_id IS NOT NULL
             GROUP BY ship_type_id ORDER BY c DESC LIMIT 10",
            character_id,
        )?;
        let top_systems = Self::top_counts(
            &conn,
            "SELECT system_id, COUNT(*) c FROM killmails
             WHERE character_id = ?1 AND system_id IS NOT NULL
             GROUP BY system_id ORDER BY c DESC LIMIT 10",
            character_id,
        )?;

        let mut stmt = conn.prepare(
            "SELECT killmail_id, is_loss, ship_type_id, system_id, isk_value, killed_at, solo,
                    char_damage, final_blow, top_damage
             FROM killmails WHERE character_id = ?1
             ORDER BY killed_at DESC LIMIT 50",
        )?;
        let recent = stmt
            .query_map(rusqlite::params![character_id], |r| {
                Ok(KillmailRow {
                    killmail_id: r.get(0)?,
                    is_loss: r.get::<_, i64>(1)? != 0,
                    ship_type_id: r.get(2)?,
                    system_id: r.get(3)?,
                    isk_value: r.get(4)?,
                    killed_at: r.get(5)?,
                    solo: r.get::<_, i64>(6)? != 0,
                    char_damage: r.get(7)?,
                    final_blow: r.get::<_, i64>(8)? != 0,
                    top_damage: r.get::<_, i64>(9)? != 0,
                    ship_name: None,
                    system_name: None,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(PvpStats {
            kills,
            losses,
            isk_destroyed,
            isk_lost,
            solo_kills,
            final_blows,
            top_damage_kills,
            efficiency: if isk_destroyed + isk_lost > 0.0 {
                isk_destroyed / (isk_destroyed + isk_lost) * 100.0
            } else {
                0.0
            },
            top_ships,
            top_systems,
            top_expensive: Vec::new(),
            recent,
        })
    }

    fn top_counts(conn: &Connection, sql: &str, character_id: i64) -> AppResult<Vec<NameCount>> {
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt
            .query_map(rusqlite::params![character_id], |r| {
                Ok(NameCount {
                    id: r.get(0)?,
                    count: r.get(1)?,
                    name: None,
                    region: None,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Top kills más caros (is_loss=0), con hash para resolver la nave víctima desde caché.
    pub fn top_kills(&self, character_id: i64, limit: i64) -> AppResult<Vec<TopKill>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT killmail_id, hash, isk_value, system_id, killed_at
             FROM killmails
             WHERE character_id = ?1 AND is_loss = 0 AND isk_value IS NOT NULL
             ORDER BY isk_value DESC LIMIT ?2",
        )?;
        Self::map_top_kills(&mut stmt, rusqlite::params![character_id, limit])
    }

    pub fn top_kills_global(&self, limit: i64) -> AppResult<Vec<TopKill>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT killmail_id, hash, isk_value, system_id, killed_at
             FROM killmails
             WHERE is_loss = 0 AND isk_value IS NOT NULL
             ORDER BY isk_value DESC LIMIT ?1",
        )?;
        Self::map_top_kills(&mut stmt, rusqlite::params![limit])
    }

    fn map_top_kills(
        stmt: &mut rusqlite::Statement,
        params: impl rusqlite::Params,
    ) -> AppResult<Vec<TopKill>> {
        let rows = stmt
            .query_map(params, |r| {
                Ok(TopKill {
                    killmail_id: r.get(0)?,
                    hash: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    isk_value: r.get(2)?,
                    system_id: r.get(3)?,
                    system_name: None,
                    victim_ship_id: None,
                    victim_ship_name: None,
                    killed_at: r.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Resumen de rateo (bounties + ESS) desde el wallet journal. None = global (todos los pj).
    pub fn ratting_summary(&self, character_id: Option<i64>) -> AppResult<RattingSummary> {
        let conn = self.conn.lock().unwrap();
        let (total, entries): (f64, i64) = conn.query_row(
            "SELECT COALESCE(SUM(amount), 0.0), COUNT(*) FROM wallet_journal
             WHERE (?1 IS NULL OR character_id = ?1)
               AND ref_type IN ('bounty_prizes', 'ess_escrow_transfer') AND amount > 0",
            rusqlite::params![character_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let mut stmt = conn.prepare(
            "SELECT MIN(substr(date, 1, 10)) AS d, COALESCE(SUM(amount), 0.0)
             FROM wallet_journal
             WHERE (?1 IS NULL OR character_id = ?1)
               AND ref_type IN ('bounty_prizes', 'ess_escrow_transfer') AND amount > 0 AND date IS NOT NULL
             GROUP BY strftime('%Y-%W', date)
             ORDER BY d ASC",
        )?;
        let trend = stmt
            .query_map(rusqlite::params![character_id], |r| {
                Ok(RattingPoint {
                    date: r.get(0)?,
                    isk: r.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(RattingSummary {
            total,
            entries,
            trend,
        })
    }

    /// Detalle de rateo: ISK por sistema (context_id), ratas (reason) y buckets diarios.
    pub fn ratting_detail(&self, character_id: Option<i64>) -> AppResult<RattingDetail> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT date, ref_type, amount, context_id, reason
             FROM wallet_journal
             WHERE (?1 IS NULL OR character_id = ?1)
               AND ref_type IN ('bounty_prizes', 'ess_escrow_transfer')
               AND amount > 0",
        )?;
        let rows = stmt
            .query_map(rusqlite::params![character_id], |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?, // date
                    r.get::<_, Option<String>>(1)?, // ref_type
                    r.get::<_, f64>(2)?,             // amount
                    r.get::<_, Option<i64>>(3)?,     // context_id (system)
                    r.get::<_, Option<String>>(4)?,  // reason
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        use std::collections::{HashMap, HashSet};
        let mut total_bounty = 0.0f64;
        let mut total_ess = 0.0f64;
        let mut rats_killed = 0i64;
        let mut entries = 0i64;
        let mut sys: HashMap<i64, (f64, i64)> = HashMap::new(); // system -> (isk, rats)
        let mut days: HashMap<String, (f64, f64, i64)> = HashMap::new(); // day -> (bounty, ess, rats)
        let mut active: HashSet<String> = HashSet::new(); // horas distintas con bounty

        for (date, ref_type, amount, context_id, reason) in rows {
            entries += 1;
            let is_bounty = ref_type.as_deref() == Some("bounty_prizes");
            let rats = if is_bounty {
                reason.as_deref().map(parse_rat_count).unwrap_or(0)
            } else {
                0
            };
            if is_bounty {
                total_bounty += amount;
                rats_killed += rats;
            } else {
                total_ess += amount;
            }
            if let Some(sid) = context_id {
                let e = sys.entry(sid).or_insert((0.0, 0));
                e.0 += amount;
                e.1 += rats;
            }
            if let Some(d) = date.as_deref() {
                let day = d.get(0..10).unwrap_or(d).to_string();
                let e = days.entry(day).or_insert((0.0, 0.0, 0));
                if is_bounty {
                    e.0 += amount;
                    e.2 += rats;
                } else {
                    e.1 += amount;
                }
                if is_bounty {
                    if let Some(h) = d.get(0..13) {
                        active.insert(h.to_string());
                    }
                }
            }
        }

        let mut by_system: Vec<RattingSystem> = sys
            .into_iter()
            .map(|(system_id, (isk, rats))| RattingSystem {
                system_id,
                isk,
                rats,
            })
            .collect();
        by_system.sort_by(|a, b| b.isk.partial_cmp(&a.isk).unwrap_or(std::cmp::Ordering::Equal));

        let mut daily: Vec<RattingDay> = days
            .into_iter()
            .map(|(date, (bounty, ess, rats))| RattingDay {
                date,
                bounty,
                ess,
                rats,
            })
            .collect();
        daily.sort_by(|a, b| a.date.cmp(&b.date));

        Ok(RattingDetail {
            total_bounty,
            total_ess,
            rats_killed,
            entries,
            active_hours: active.len() as i64,
            by_system,
            daily,
        })
    }

    /// Lista de periodos "YYYY-MM" con movimientos en el journal (desc).
    pub fn summary_periods(&self, character_id: Option<i64>) -> AppResult<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT DISTINCT substr(date, 1, 7) AS ym
             FROM wallet_journal
             WHERE (?1 IS NULL OR character_id = ?1) AND date IS NOT NULL
             ORDER BY ym DESC",
        )?;
        let out = stmt
            .query_map(rusqlite::params![character_id], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(out)
    }

    /// Resumen financiero del mes `cur` (YYYY-MM) con comparativa contra `prev`.
    pub fn financial_summary(
        &self,
        character_id: Option<i64>,
        cur: &str,
        prev: &str,
    ) -> AppResult<FinancialSummary> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT substr(date, 1, 7) AS ym, ref_type, amount
             FROM wallet_journal
             WHERE (?1 IS NULL OR character_id = ?1)
               AND date IS NOT NULL
               AND substr(date, 1, 7) IN (?2, ?3)",
        )?;
        let rows = stmt
            .query_map(rusqlite::params![character_id, cur, prev], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, f64>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        use std::collections::HashMap;
        // (periodo) -> categoría -> isk
        let mut income: HashMap<String, HashMap<&'static str, f64>> = HashMap::new();
        let mut expense: HashMap<String, HashMap<&'static str, f64>> = HashMap::new();
        let mut inc_total: HashMap<String, f64> = HashMap::new();
        let mut exp_total: HashMap<String, f64> = HashMap::new();

        for (ym, ref_type, amount) in rows {
            let rt = ref_type.unwrap_or_default();
            if amount >= 0.0 {
                let cat = categorize_income(&rt);
                *income.entry(ym.clone()).or_default().entry(cat).or_insert(0.0) += amount;
                *inc_total.entry(ym).or_insert(0.0) += amount;
            } else {
                let mag = -amount;
                let cat = categorize_expense(&rt);
                *expense.entry(ym.clone()).or_default().entry(cat).or_insert(0.0) += mag;
                *exp_total.entry(ym).or_insert(0.0) += mag;
            }
        }

        // Construye la lista de categorías del mes actual con su valor del mes anterior.
        let build = |cur_map: Option<&HashMap<&'static str, f64>>,
                     prev_map: Option<&HashMap<&'static str, f64>>|
         -> Vec<CategorySum> {
            let mut v: Vec<CategorySum> = cur_map
                .map(|m| {
                    m.iter()
                        .map(|(cat, isk)| CategorySum {
                            category: cat.to_string(),
                            isk: *isk,
                            prev_isk: prev_map.and_then(|p| p.get(*cat).copied()).unwrap_or(0.0),
                        })
                        .collect()
                })
                .unwrap_or_default();
            v.sort_by(|a, b| b.isk.partial_cmp(&a.isk).unwrap_or(std::cmp::Ordering::Equal));
            v
        };

        let income_by_category = build(income.get(cur), income.get(prev));
        let expense_by_category = build(expense.get(cur), expense.get(prev));
        let income_total = *inc_total.get(cur).unwrap_or(&0.0);
        let expense_total = *exp_total.get(cur).unwrap_or(&0.0);
        let prev_income_total = *inc_total.get(prev).unwrap_or(&0.0);
        let prev_expense_total = *exp_total.get(prev).unwrap_or(&0.0);

        Ok(FinancialSummary {
            income_total,
            expense_total,
            net: income_total - expense_total,
            prev_income_total,
            prev_expense_total,
            prev_net: prev_income_total - prev_expense_total,
            income_by_category,
            expense_by_category,
        })
    }

    /// Tendencia temporal: kills/losses/ISK agrupados por semana. Para el gráfico de líneas.
    pub fn pvp_trend(&self, character_id: i64) -> AppResult<Vec<PvpTrendPoint>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT MIN(substr(killed_at,1,10)) AS d,
                    COALESCE(SUM(CASE WHEN is_loss = 0 THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN is_loss = 1 THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN is_loss = 0 THEN isk_value ELSE 0.0 END), 0.0),
                    COALESCE(SUM(CASE WHEN is_loss = 1 THEN isk_value ELSE 0.0 END), 0.0)
             FROM killmails
             WHERE character_id = ?1 AND killed_at IS NOT NULL
             GROUP BY strftime('%Y-%W', killed_at)
             ORDER BY d ASC",
        )?;
        let rows = stmt
            .query_map(rusqlite::params![character_id], |r| {
                Ok(PvpTrendPoint {
                    date: r.get(0)?,
                    kills: r.get(1)?,
                    losses: r.get(2)?,
                    isk_destroyed: r.get(3)?,
                    isk_lost: r.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Tendencia temporal global (todos los personajes), consistente con `pvp_stats_global`.
    pub fn pvp_trend_global(&self) -> AppResult<Vec<PvpTrendPoint>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT MIN(substr(killed_at,1,10)) AS d,
                    COALESCE(SUM(CASE WHEN is_loss = 0 THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN is_loss = 1 THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN is_loss = 0 THEN isk_value ELSE 0.0 END), 0.0),
                    COALESCE(SUM(CASE WHEN is_loss = 1 THEN isk_value ELSE 0.0 END), 0.0)
             FROM killmails
             WHERE killed_at IS NOT NULL
             GROUP BY strftime('%Y-%W', killed_at)
             ORDER BY d ASC",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(PvpTrendPoint {
                    date: r.get(0)?,
                    kills: r.get(1)?,
                    losses: r.get(2)?,
                    isk_destroyed: r.get(3)?,
                    isk_lost: r.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// (system_id, killed_at, isk, is_loss) para detectar batallas. None = global.
    pub fn killmails_for_battles(
        &self,
        character_id: Option<i64>,
    ) -> AppResult<Vec<(i64, String, f64, bool)>> {
        let conn = self.conn.lock().unwrap();
        let where_sql = match character_id {
            Some(cid) => format!(
                "WHERE character_id = {cid} AND system_id IS NOT NULL AND killed_at IS NOT NULL"
            ),
            None => "WHERE system_id IS NOT NULL AND killed_at IS NOT NULL".to_string(),
        };
        let mut stmt = conn.prepare(&format!(
            "SELECT system_id, killed_at, COALESCE(isk_value, 0.0), is_loss FROM killmails {where_sql}"
        ))?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, f64>(2)?,
                    r.get::<_, i64>(3)? != 0,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Devuelve (is_loss, raw) de los killmails con raw disponible, para análisis de rivales.
    /// `character_id` None = global.
    pub fn killmails_raw(&self, character_id: Option<i64>) -> AppResult<Vec<(bool, String)>> {
        let conn = self.conn.lock().unwrap();
        let where_sql = match character_id {
            Some(cid) => format!("WHERE character_id = {cid} AND raw IS NOT NULL AND raw != ''"),
            None => "WHERE raw IS NOT NULL AND raw != ''".to_string(),
        };
        let mut stmt = conn.prepare(&format!("SELECT is_loss, raw FROM killmails {where_sql}"))?;
        let rows = stmt
            .query_map([], |r| {
                Ok((r.get::<_, i64>(0)? != 0, r.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Página de killmails con filtro (kind: "all" | "kill" | "loss") y paginación.
    /// `character_id` None = global (todos los personajes). Devuelve (filas, total).
    pub fn killmails_page(
        &self,
        character_id: Option<i64>,
        kind: &str,
        offset: i64,
        limit: i64,
    ) -> AppResult<(Vec<KillmailRow>, i64)> {
        let conn = self.conn.lock().unwrap();
        // Condiciones (character_id es i64 controlado por nosotros; kind se mapea a literales).
        let mut conds: Vec<String> = Vec::new();
        if let Some(cid) = character_id {
            conds.push(format!("character_id = {cid}"));
        }
        match kind {
            "kill" => conds.push("is_loss = 0".into()),
            "loss" => conds.push("is_loss = 1".into()),
            _ => {}
        }
        let where_sql = if conds.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conds.join(" AND "))
        };

        let total: i64 = conn.query_row(
            &format!("SELECT COUNT(*) FROM killmails {where_sql}"),
            [],
            |r| r.get(0),
        )?;

        let sql = format!(
            "SELECT killmail_id, is_loss, ship_type_id, system_id, isk_value, killed_at, solo,
                    char_damage, final_blow, top_damage
             FROM killmails {where_sql}
             ORDER BY killed_at DESC LIMIT ?1 OFFSET ?2"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(rusqlite::params![limit, offset], |r| {
                Ok(KillmailRow {
                    killmail_id: r.get(0)?,
                    is_loss: r.get::<_, i64>(1)? != 0,
                    ship_type_id: r.get(2)?,
                    system_id: r.get(3)?,
                    isk_value: r.get(4)?,
                    killed_at: r.get(5)?,
                    solo: r.get::<_, i64>(6)? != 0,
                    char_damage: r.get(7)?,
                    final_blow: r.get::<_, i64>(8)? != 0,
                    top_damage: r.get::<_, i64>(9)? != 0,
                    ship_name: None,
                    system_name: None,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok((rows, total))
    }

    /// Todas las filas de killmails para export CSV.
    pub fn all_killmails(&self, character_id: i64) -> AppResult<Vec<KillmailRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT killmail_id, is_loss, ship_type_id, system_id, isk_value, killed_at, solo,
                    char_damage, final_blow, top_damage
             FROM killmails WHERE character_id = ?1 ORDER BY killed_at DESC",
        )?;
        let rows = stmt
            .query_map(rusqlite::params![character_id], |r| {
                Ok(KillmailRow {
                    killmail_id: r.get(0)?,
                    is_loss: r.get::<_, i64>(1)? != 0,
                    ship_type_id: r.get(2)?,
                    system_id: r.get(3)?,
                    isk_value: r.get(4)?,
                    killed_at: r.get(5)?,
                    solo: r.get::<_, i64>(6)? != 0,
                    char_damage: r.get(7)?,
                    final_blow: r.get::<_, i64>(8)? != 0,
                    top_damage: r.get::<_, i64>(9)? != 0,
                    ship_name: None,
                    system_name: None,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }
}

// --- Wallet ---

#[derive(Debug, Clone, serde::Serialize)]
pub struct JournalRow {
    pub id: i64,
    pub date: Option<String>,
    pub ref_type: Option<String>,
    pub amount: Option<f64>,
    pub balance: Option<f64>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct WalletStats {
    pub income: f64,
    pub expense: f64,
    pub net: f64,
    pub entries: i64,
    pub top_income: Vec<RefTypeSum>,
    pub top_expense: Vec<RefTypeSum>,
    pub recent: Vec<JournalRow>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RefTypeSum {
    pub ref_type: String,
    pub total: f64,
}

impl Db {
    pub fn existing_journal_ids(
        &self,
        character_id: i64,
    ) -> AppResult<std::collections::HashSet<i64>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id FROM wallet_journal WHERE character_id = ?1")?;
        let ids = stmt
            .query_map(rusqlite::params![character_id], |r| r.get::<_, i64>(0))?
            .collect::<Result<std::collections::HashSet<_>, _>>()?;
        Ok(ids)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn insert_journal(
        &self,
        id: i64,
        character_id: i64,
        date: Option<&str>,
        ref_type: Option<&str>,
        amount: Option<f64>,
        balance: Option<f64>,
        description: Option<&str>,
        reason: Option<&str>,
        context_id: Option<i64>,
        context_id_type: Option<&str>,
        first_party_id: Option<i64>,
        second_party_id: Option<i64>,
    ) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO wallet_journal
                (id, character_id, date, ref_type, amount, balance, description,
                 reason, context_id, context_id_type, first_party_id, second_party_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(id) DO NOTHING",
            rusqlite::params![
                id, character_id, date, ref_type, amount, balance, description,
                reason, context_id, context_id_type, first_party_id, second_party_id
            ],
        )?;
        Ok(())
    }

    pub fn wallet_stats(&self, character_id: i64) -> AppResult<WalletStats> {
        let conn = self.conn.lock().unwrap();

        let (income, expense, entries): (f64, f64, i64) = conn.query_row(
            "SELECT
                COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0.0 END), 0.0),
                COALESCE(SUM(CASE WHEN amount < 0 THEN amount ELSE 0.0 END), 0.0),
                COUNT(*)
             FROM wallet_journal WHERE character_id = ?1",
            rusqlite::params![character_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;

        let top_income = Self::ref_type_sums(
            &conn,
            "SELECT ref_type, SUM(amount) s FROM wallet_journal
             WHERE character_id = ?1 AND amount > 0 AND ref_type IS NOT NULL
             GROUP BY ref_type ORDER BY s DESC LIMIT 8",
            character_id,
        )?;
        let top_expense = Self::ref_type_sums(
            &conn,
            "SELECT ref_type, SUM(amount) s FROM wallet_journal
             WHERE character_id = ?1 AND amount < 0 AND ref_type IS NOT NULL
             GROUP BY ref_type ORDER BY s ASC LIMIT 8",
            character_id,
        )?;

        let mut stmt = conn.prepare(
            "SELECT id, date, ref_type, amount, balance, description
             FROM wallet_journal WHERE character_id = ?1
             ORDER BY date DESC LIMIT 50",
        )?;
        let recent = stmt
            .query_map(rusqlite::params![character_id], |r| {
                Ok(JournalRow {
                    id: r.get(0)?,
                    date: r.get(1)?,
                    ref_type: r.get(2)?,
                    amount: r.get(3)?,
                    balance: r.get(4)?,
                    description: r.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(WalletStats {
            income,
            expense,
            net: income + expense,
            entries,
            top_income,
            top_expense,
            recent,
        })
    }

    fn ref_type_sums(
        conn: &Connection,
        sql: &str,
        character_id: i64,
    ) -> AppResult<Vec<RefTypeSum>> {
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt
            .query_map(rusqlite::params![character_id], |r| {
                Ok(RefTypeSum {
                    ref_type: r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                    total: r.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }
}

// --- Agregados GLOBALES (todos los personajes) ---
// PvP se deduplica solo: killmail_id es PRIMARY KEY, así que un kill compartido por
// dos personajes existe una sola vez. Wallet: cada entrada (id PK) pertenece a un
// personaje, sumar todas da el agregado correcto.

impl Db {
    pub fn pvp_stats_global(&self) -> AppResult<PvpStats> {
        let conn = self.conn.lock().unwrap();

        let (kills, losses, isk_destroyed, isk_lost, solo_kills, final_blows, top_damage_kills): (
            i64,
            i64,
            f64,
            f64,
            i64,
            i64,
            i64,
        ) = conn.query_row(
            "SELECT
                    COALESCE(SUM(CASE WHEN is_loss = 0 THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN is_loss = 1 THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN is_loss = 0 THEN isk_value ELSE 0.0 END), 0.0),
                    COALESCE(SUM(CASE WHEN is_loss = 1 THEN isk_value ELSE 0.0 END), 0.0),
                    COALESCE(SUM(CASE WHEN is_loss = 0 AND solo = 1 THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN is_loss = 0 AND final_blow = 1 THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN is_loss = 0 AND top_damage = 1 THEN 1 ELSE 0 END), 0)
                 FROM killmails",
            [],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                ))
            },
        )?;

        let top_ships = Self::top_counts_global(
            &conn,
            "SELECT ship_type_id, COUNT(*) c FROM killmails
             WHERE is_loss = 0 AND ship_type_id IS NOT NULL
             GROUP BY ship_type_id ORDER BY c DESC LIMIT 10",
        )?;
        let top_systems = Self::top_counts_global(
            &conn,
            "SELECT system_id, COUNT(*) c FROM killmails
             WHERE system_id IS NOT NULL
             GROUP BY system_id ORDER BY c DESC LIMIT 10",
        )?;

        let mut stmt = conn.prepare(
            "SELECT killmail_id, is_loss, ship_type_id, system_id, isk_value, killed_at, solo,
                    char_damage, final_blow, top_damage
             FROM killmails ORDER BY killed_at DESC LIMIT 50",
        )?;
        let recent = stmt
            .query_map([], |r| {
                Ok(KillmailRow {
                    killmail_id: r.get(0)?,
                    is_loss: r.get::<_, i64>(1)? != 0,
                    ship_type_id: r.get(2)?,
                    system_id: r.get(3)?,
                    isk_value: r.get(4)?,
                    killed_at: r.get(5)?,
                    solo: r.get::<_, i64>(6)? != 0,
                    char_damage: r.get(7)?,
                    final_blow: r.get::<_, i64>(8)? != 0,
                    top_damage: r.get::<_, i64>(9)? != 0,
                    ship_name: None,
                    system_name: None,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(PvpStats {
            kills,
            losses,
            isk_destroyed,
            isk_lost,
            solo_kills,
            final_blows,
            top_damage_kills,
            efficiency: if isk_destroyed + isk_lost > 0.0 {
                isk_destroyed / (isk_destroyed + isk_lost) * 100.0
            } else {
                0.0
            },
            top_ships,
            top_systems,
            top_expensive: Vec::new(),
            recent,
        })
    }

    fn top_counts_global(conn: &Connection, sql: &str) -> AppResult<Vec<NameCount>> {
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(NameCount {
                    id: r.get(0)?,
                    count: r.get(1)?,
                    name: None,
                    region: None,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn wallet_stats_global(&self) -> AppResult<WalletStats> {
        let conn = self.conn.lock().unwrap();

        let (income, expense, entries): (f64, f64, i64) = conn.query_row(
            "SELECT
                COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0.0 END), 0.0),
                COALESCE(SUM(CASE WHEN amount < 0 THEN amount ELSE 0.0 END), 0.0),
                COUNT(*)
             FROM wallet_journal",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;

        let top_income = Self::ref_type_sums_global(
            &conn,
            "SELECT ref_type, SUM(amount) s FROM wallet_journal
             WHERE amount > 0 AND ref_type IS NOT NULL
             GROUP BY ref_type ORDER BY s DESC LIMIT 8",
        )?;
        let top_expense = Self::ref_type_sums_global(
            &conn,
            "SELECT ref_type, SUM(amount) s FROM wallet_journal
             WHERE amount < 0 AND ref_type IS NOT NULL
             GROUP BY ref_type ORDER BY s ASC LIMIT 8",
        )?;

        let mut stmt = conn.prepare(
            "SELECT id, date, ref_type, amount, balance, description
             FROM wallet_journal ORDER BY date DESC LIMIT 50",
        )?;
        let recent = stmt
            .query_map([], |r| {
                Ok(JournalRow {
                    id: r.get(0)?,
                    date: r.get(1)?,
                    ref_type: r.get(2)?,
                    amount: r.get(3)?,
                    balance: r.get(4)?,
                    description: r.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(WalletStats {
            income,
            expense,
            net: income + expense,
            entries,
            top_income,
            top_expense,
            recent,
        })
    }

    pub fn systems_activity(&self, character_id: i64) -> AppResult<Vec<SystemActivity>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT system_id,
                    COALESCE(SUM(CASE WHEN is_loss = 0 THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN is_loss = 1 THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(isk_value), 0.0)
             FROM killmails
             WHERE character_id = ?1 AND system_id IS NOT NULL
             GROUP BY system_id",
        )?;
        let rows = stmt
            .query_map(rusqlite::params![character_id], Self::map_system_activity)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn systems_activity_global(&self) -> AppResult<Vec<SystemActivity>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT system_id,
                    COALESCE(SUM(CASE WHEN is_loss = 0 THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN is_loss = 1 THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(isk_value), 0.0)
             FROM killmails
             WHERE system_id IS NOT NULL
             GROUP BY system_id",
        )?;
        let rows = stmt
            .query_map([], Self::map_system_activity)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    fn map_system_activity(r: &rusqlite::Row) -> rusqlite::Result<SystemActivity> {
        Ok(SystemActivity {
            system_id: r.get(0)?,
            kills: r.get(1)?,
            losses: r.get(2)?,
            isk: r.get(3)?,
        })
    }

    fn ref_type_sums_global(conn: &Connection, sql: &str) -> AppResult<Vec<RefTypeSum>> {
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(RefTypeSum {
                    ref_type: r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                    total: r.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }
}

// --- Mercado y patrimonio (Fase 1) ---

/// Un punto de la serie histórica de patrimonio.
#[derive(Debug, Clone, serde::Serialize)]
pub struct NetworthPoint {
    pub date: String,
    pub liquid: f64,
    pub asset_value: f64,
    pub total: f64,
}

impl Db {
    /// Inserta/actualiza precios de mercado en bloque (type_id, average, adjusted).
    pub fn upsert_prices(&self, rows: &[(i64, Option<f64>, Option<f64>)]) -> AppResult<()> {
        let mut conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO market_prices (type_id, average_price, adjusted_price, updated_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(type_id) DO UPDATE SET
                    average_price = excluded.average_price,
                    adjusted_price = excluded.adjusted_price,
                    updated_at = excluded.updated_at",
            )?;
            for (type_id, avg, adj) in rows {
                stmt.execute(rusqlite::params![type_id, avg, adj, now])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// Mapa type_id -> precio medio (average_price). Para valorar assets.
    /// Caché ubicación→sistema. Devuelve Some(system_id) si está cacheada (0 = no resuelta),
    /// None si nunca se ha resuelto.
    pub fn location_system_get(&self, location_id: i64) -> Option<i64> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT system_id FROM location_system WHERE location_id = ?1",
            rusqlite::params![location_id],
            |r| r.get::<_, i64>(0),
        )
        .ok()
    }

    /// Guarda en caché la resolución de una ubicación (system_id = 0 → no resuelta / negative cache).
    pub fn location_system_put(&self, location_id: i64, system_id: i64) {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        let _ = conn.execute(
            "INSERT INTO location_system (location_id, system_id, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(location_id) DO UPDATE SET system_id = excluded.system_id, updated_at = excluded.updated_at",
            rusqlite::params![location_id, system_id, now],
        );
    }

    /// Caché tipo→categoría. None si no está cacheada.
    /// Caché sistema→región (nombre). None si no está cacheada.
    pub fn system_region_get(&self, system_id: i64) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT region FROM system_region WHERE system_id = ?1",
            rusqlite::params![system_id],
            |r| r.get::<_, String>(0),
        )
        .ok()
    }

    pub fn system_region_put(&self, system_id: i64, region: &str) {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        let _ = conn.execute(
            "INSERT INTO system_region (system_id, region, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(system_id) DO UPDATE SET region = excluded.region, updated_at = excluded.updated_at",
            rusqlite::params![system_id, region, now],
        );
    }

    pub fn type_category_get(&self, type_id: i64) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT category FROM type_category WHERE type_id = ?1",
            rusqlite::params![type_id],
            |r| r.get::<_, String>(0),
        )
        .ok()
    }

    pub fn type_category_put(&self, type_id: i64, category: &str) {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        let _ = conn.execute(
            "INSERT INTO type_category (type_id, category, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(type_id) DO UPDATE SET category = excluded.category, updated_at = excluded.updated_at",
            rusqlite::params![type_id, category, now],
        );
    }

    pub fn prices_map(&self) -> AppResult<std::collections::HashMap<i64, f64>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT type_id, average_price FROM market_prices WHERE average_price IS NOT NULL",
        )?;
        let map = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?)))?
            .collect::<Result<std::collections::HashMap<_, _>, _>>()?;
        Ok(map)
    }

    /// Nº de precios almacenados (para indicadores en la UI).
    pub fn prices_count(&self) -> AppResult<i64> {
        let conn = self.conn.lock().unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM market_prices", [], |r| r.get(0))?;
        Ok(n)
    }

    /// Guarda (o reemplaza) el snapshot de patrimonio de un personaje para un día.
    pub fn insert_networth_snapshot(
        &self,
        character_id: i64,
        date: &str,
        liquid: f64,
        asset_value: f64,
    ) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO networth_snapshots (character_id, date, liquid, asset_value, total, taken_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(character_id, date) DO UPDATE SET
                liquid = excluded.liquid,
                asset_value = excluded.asset_value,
                total = excluded.total,
                taken_at = excluded.taken_at",
            rusqlite::params![character_id, date, liquid, asset_value, liquid + asset_value, now],
        )?;
        Ok(())
    }

    /// Serie histórica de patrimonio de un personaje (orden cronológico).
    pub fn networth_history(&self, character_id: i64) -> AppResult<Vec<NetworthPoint>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT date, liquid, asset_value, total
             FROM networth_snapshots WHERE character_id = ?1 ORDER BY date ASC",
        )?;
        let rows = stmt
            .query_map(rusqlite::params![character_id], Self::map_networth_point)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Serie histórica GLOBAL: suma de todos los personajes por día.
    pub fn networth_history_global(&self) -> AppResult<Vec<NetworthPoint>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT date,
                    COALESCE(SUM(liquid), 0.0),
                    COALESCE(SUM(asset_value), 0.0),
                    COALESCE(SUM(total), 0.0)
             FROM networth_snapshots GROUP BY date ORDER BY date ASC",
        )?;
        let rows = stmt
            .query_map([], Self::map_networth_point)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    fn map_networth_point(r: &rusqlite::Row) -> rusqlite::Result<NetworthPoint> {
        Ok(NetworthPoint {
            date: r.get(0)?,
            liquid: r.get(1)?,
            asset_value: r.get(2)?,
            total: r.get(3)?,
        })
    }
}
