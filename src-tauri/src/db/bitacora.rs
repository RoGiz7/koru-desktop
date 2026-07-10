//! Motor de la Bitácora: LOGROS propios y RETOS adaptativos, generados 100% desde el
//! histórico local (SQLite). Cero ESI: la idea clave es que nadie tiene mejores datos
//! sobre tu forma de jugar que tu propia base de datos.
//!
//! - RETOS ("oportunidades personales"): baseline = tu mes anterior por métrica;
//!   objetivo = siguiente escalón "redondo" (escala 1-2-5) por encima. Compites contra ti.
//! - LOGROS (medallero): hitos con 3 niveles (bronce/plata/oro) y fecha de desbloqueo
//!   RETROACTIVA — recorremos el histórico en orden y anotamos cuándo cruzaste cada umbral.
//!   Los desbloqueos se persisten en `achievements_unlocked` para poder señalar los nuevos.

use super::Db;
use crate::error::AppResult;
use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize)]
pub struct Challenge {
    pub id: String,
    pub unit: String, // "isk" | "count"
    pub baseline: f64,
    pub current: f64,
    pub target: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AchievementState {
    pub id: String,
    pub unit: String, // "isk" | "count"
    pub value: f64,
    pub level: u8,                        // 0 = bloqueado, 1..3 = bronce/plata/oro
    pub thresholds: [f64; 3],
    pub unlocked_at: [Option<String>; 3], // fecha retroactiva por nivel
    pub fresh: bool,                      // registrado en ESTA evaluación (✨ en la UI)
}

#[derive(Debug, Serialize)]
pub struct Bitacora {
    pub challenges: Vec<Challenge>,
    pub achievements: Vec<AchievementState>,
    /// ¿El sujeto YA tenía desbloqueos persistidos ANTES de esta evaluación? En la primera
    /// evaluación (BD virgen), todo el histórico se "desbloquea" de golpe: no es motivo de
    /// notificación (sería un muro). El auto_sync usa esto para sembrar en silencio la 1ª vez
    /// y solo celebrar los cruces genuinamente nuevos a partir de entonces.
    pub was_seeded: bool,
}

/// Siguiente escalón "redondo" (1-2-5 × 10^n) estrictamente por encima de `x*1.1`.
/// Ej.: 500M → 1B (como el ejemplo canónico del reto de rateo).
fn next_125(x: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    let goal = x * 1.1;
    let mut base = 10f64.powf(goal.log10().floor());
    loop {
        for m in [1.0, 2.0, 5.0] {
            let v = m * base;
            if v > goal {
                return v;
            }
        }
        base *= 10.0;
    }
}

/// Acumulador que anota la fecha en la que se cruzó cada umbral (retroactivo).
struct Cross {
    thresholds: [f64; 3],
    dates: [Option<String>; 3],
    value: f64,
}

impl Cross {
    fn new(thresholds: [f64; 3]) -> Self {
        Self {
            thresholds,
            dates: [None, None, None],
            value: 0.0,
        }
    }
    /// Suma `add` en la fecha `date` (YYYY-MM-DD) y anota cruces de umbral.
    fn add(&mut self, date: &str, add: f64) {
        self.value += add;
        for i in 0..3 {
            if self.dates[i].is_none() && self.value >= self.thresholds[i] {
                self.dates[i] = Some(date.to_string());
            }
        }
    }
    /// Fija el valor a `max(actual, v)` (para métricas de "mejor marca", p. ej. killmail más caro).
    fn peak(&mut self, date: &str, v: f64) {
        if v > self.value {
            self.value = v;
        }
        for i in 0..3 {
            if self.dates[i].is_none() && self.value >= self.thresholds[i] {
                self.dates[i] = Some(date.to_string());
            }
        }
    }
    fn state(self, id: &str, unit: &str) -> AchievementState {
        let level = self.dates.iter().filter(|d| d.is_some()).count() as u8;
        AchievementState {
            id: id.to_string(),
            unit: unit.to_string(),
            value: self.value,
            level,
            thresholds: self.thresholds,
            unlocked_at: self.dates,
            fresh: false,
        }
    }
}

/// Índice de semana monótono (lunes como ancla) para calcular rachas.
fn week_idx(date: &str) -> Option<i64> {
    let d = NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()?;
    let monday = d - chrono::Duration::days(d.weekday().num_days_from_monday() as i64);
    Some(monday.num_days_from_ce() as i64 / 7)
}

impl Db {
    /// Evalúa retos + logros del sujeto (None = global) y persiste desbloqueos nuevos.
    pub fn bitacora(&self, character_id: Option<i64>) -> AppResult<Bitacora> {
        let subject_id = character_id.unwrap_or(0);
        let who = character_id
            .map(|c| format!("AND character_id = {c}"))
            .unwrap_or_default();
        let conn = self.conn.lock().unwrap();

        // ¿Había ya desbloqueos de este sujeto ANTES de persistir? (para silenciar el 1er sembrado)
        let was_seeded: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM achievements_unlocked WHERE subject_id = ?1",
                [subject_id],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0)
            > 0;

        let fsum = |sql: &str| -> f64 {
            conn.query_row(sql, [], |r| r.get::<_, Option<f64>>(0))
                .ok()
                .flatten()
                .unwrap_or(0.0)
        };

        // ---------- RETOS DEL MES (baseline = mes anterior) ----------
        let month_pair = |cur_sql: &str, prev_sql: &str| (fsum(cur_sql), fsum(prev_sql));
        let cur_m = "strftime('%Y-%m','now')";
        let prev_m = "strftime('%Y-%m', date('now','start of month','-1 day'))";

        let mut challenges = Vec::new();
        let mut push_challenge = |id: &str, unit: &str, current: f64, baseline: f64| {
            if baseline > 0.0 {
                challenges.push(Challenge {
                    id: id.to_string(),
                    unit: unit.to_string(),
                    baseline,
                    current,
                    target: next_125(baseline),
                });
            }
        };

        // Rateo (bounties + ESS) por mes.
        let (rate_c, rate_p) = month_pair(
            &format!(
                "SELECT SUM(amount) FROM wallet_journal
                 WHERE ref_type IN ('bounty_prizes','ess_escrow_transfer')
                   AND amount > 0 AND substr(date,1,7) = {cur_m} {who}"
            ),
            &format!(
                "SELECT SUM(amount) FROM wallet_journal
                 WHERE ref_type IN ('bounty_prizes','ess_escrow_transfer')
                   AND amount > 0 AND substr(date,1,7) = {prev_m} {who}"
            ),
        );
        push_challenge("rateo", "isk", rate_c, rate_p);

        // Minería (valor estimado a precio medio actual) por mes.
        let (min_c, min_p) = month_pair(
            &format!(
                "SELECT SUM(ml.quantity * COALESCE(mp.average_price, 0))
                 FROM mining_ledger ml LEFT JOIN market_prices mp ON mp.type_id = ml.type_id
                 WHERE substr(ml.date,1,7) = {cur_m} {who}"
            ),
            &format!(
                "SELECT SUM(ml.quantity * COALESCE(mp.average_price, 0))
                 FROM mining_ledger ml LEFT JOIN market_prices mp ON mp.type_id = ml.type_id
                 WHERE substr(ml.date,1,7) = {prev_m} {who}"
            ),
        );
        push_challenge("mineria", "isk", min_c, min_p);

        // Kills por mes.
        let (k_c, k_p) = month_pair(
            &format!(
                "SELECT COUNT(*) FROM killmails
                 WHERE is_loss = 0 AND substr(killed_at,1,7) = {cur_m} {who}"
            ),
            &format!(
                "SELECT COUNT(*) FROM killmails
                 WHERE is_loss = 0 AND substr(killed_at,1,7) = {prev_m} {who}"
            ),
        );
        push_challenge("kills", "count", k_c, k_p);

        // ISK destruido por mes.
        let (d_c, d_p) = month_pair(
            &format!(
                "SELECT SUM(isk_value) FROM killmails
                 WHERE is_loss = 0 AND substr(killed_at,1,7) = {cur_m} {who}"
            ),
            &format!(
                "SELECT SUM(isk_value) FROM killmails
                 WHERE is_loss = 0 AND substr(killed_at,1,7) = {prev_m} {who}"
            ),
        );
        push_challenge("isk_destruido", "isk", d_c, d_p);

        // ---------- LOGROS (con fecha retroactiva) ----------
        let mut ach: Vec<AchievementState> = Vec::new();

        // Paseo único por los killmails en orden cronológico.
        {
            let mut kills = Cross::new([100.0, 1_000.0, 10_000.0]);
            let mut destruido = Cross::new([50e9, 500e9, 5e12]);
            let mut caro = Cross::new([1e9, 50e9, 500e9]);
            let mut solos = Cross::new([1.0, 25.0, 100.0]);
            let mut fbs = Cross::new([50.0, 500.0, 5_000.0]);
            let mut sistemas = Cross::new([25.0, 100.0, 500.0]);
            let mut racha = Cross::new([4.0, 12.0, 52.0]);
            let mut seen_systems: std::collections::HashSet<i64> = Default::default();
            let mut last_week: Option<i64> = None;
            let mut streak: f64 = 0.0;

            let sql = format!(
                "SELECT substr(killed_at,1,10), is_loss, isk_value, solo, final_blow, system_id
                 FROM killmails WHERE killed_at IS NOT NULL {who} ORDER BY killed_at ASC"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)? != 0,
                    r.get::<_, Option<f64>>(2)?,
                    r.get::<_, i64>(3)? != 0,
                    r.get::<_, i64>(4)? != 0,
                    r.get::<_, Option<i64>>(5)?,
                ))
            })?;
            for row in rows.flatten() {
                let (date, is_loss, isk, solo, fb, system) = row;
                if is_loss {
                    continue;
                }
                kills.add(&date, 1.0);
                destruido.add(&date, isk.unwrap_or(0.0));
                caro.peak(&date, isk.unwrap_or(0.0));
                if solo {
                    solos.add(&date, 1.0);
                }
                if fb {
                    fbs.add(&date, 1.0);
                }
                if let Some(sid) = system {
                    if seen_systems.insert(sid) {
                        sistemas.add(&date, 1.0);
                    }
                }
                // Racha de semanas consecutivas con al menos un kill.
                if let Some(w) = week_idx(&date) {
                    match last_week {
                        Some(lw) if w == lw => {}
                        Some(lw) if w == lw + 1 => {
                            streak += 1.0;
                            racha.peak(&date, streak);
                            last_week = Some(w);
                        }
                        _ => {
                            streak = 1.0;
                            racha.peak(&date, streak);
                            last_week = Some(w);
                        }
                    }
                }
            }
            ach.push(kills.state("kills_totales", "count"));
            ach.push(destruido.state("isk_destruido_total", "isk"));
            ach.push(caro.state("killmail_caro", "isk"));
            ach.push(solos.state("solo_kills", "count"));
            ach.push(fbs.state("final_blows", "count"));
            ach.push(sistemas.state("sistemas_pvp", "count"));
            ach.push(racha.state("racha_semanas", "count"));
        }

        // Rateo acumulado (paseo por journal).
        {
            let mut rateo = Cross::new([10e9, 100e9, 1e12]);
            let sql = format!(
                "SELECT substr(date,1,10), amount FROM wallet_journal
                 WHERE ref_type IN ('bounty_prizes','ess_escrow_transfer') AND amount > 0
                   AND date IS NOT NULL {who} ORDER BY date ASC"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, Option<f64>>(1)?))
            })?;
            for (date, amount) in rows.flatten() {
                rateo.add(&date, amount.unwrap_or(0.0));
            }
            ach.push(rateo.state("rateo_total", "isk"));
        }

        // Minería acumulada (valor a precio medio ACTUAL — estimación honesta).
        {
            let mut mineria = Cross::new([1e9, 10e9, 100e9]);
            let sql = format!(
                "SELECT ml.date, ml.quantity * COALESCE(mp.average_price, 0)
                 FROM mining_ledger ml LEFT JOIN market_prices mp ON mp.type_id = ml.type_id
                 WHERE 1=1 {who} ORDER BY ml.date ASC"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, Option<f64>>(1)?))
            })?;
            for (date, v) in rows.flatten() {
                mineria.add(&date, v.unwrap_or(0.0));
            }
            ach.push(mineria.state("mineria_total", "isk"));
        }

        // Logi: curación remota DADA por tipo (paseo por logi_ledger, del gamelog). Con logis
        // la vida dura más 😎. Solo aparece si has escaneado gamelogs y has dado reps.
        {
            let mut sh = Cross::new([1e6, 25e6, 250e6]);
            let mut ar = Cross::new([1e6, 25e6, 250e6]);
            let mut hu = Cross::new([100e3, 2e6, 20e6]);
            let sql = format!(
                "SELECT date, kind, hp FROM logi_ledger WHERE direction='given' {who} ORDER BY date ASC"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, f64>(2)?))
            })?;
            for (date, kind, hp) in rows.flatten() {
                match kind.as_str() {
                    "shield" => sh.add(&date, hp),
                    "armor" => ar.add(&date, hp),
                    "hull" => hu.add(&date, hp),
                    _ => {}
                }
            }
            ach.push(sh.state("logi_shield", "count"));
            ach.push(ar.state("logi_armor", "count"));
            ach.push(hu.state("logi_hull", "count"));
        }

        // Patrimonio (mejor marca de snapshots; global = suma por día).
        {
            let mut patri = Cross::new([50e9, 200e9, 1e12]);
            let sql = format!(
                "SELECT date, SUM(total) FROM networth_snapshots WHERE 1=1 {who}
                 GROUP BY date ORDER BY date ASC"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, Option<f64>>(1)?))
            })?;
            for (date, v) in rows.flatten() {
                patri.peak(&date, v.unwrap_or(0.0));
            }
            ach.push(patri.state("patrimonio", "isk"));
        }

        // Meses con balance positivo (journal completo, meses cerrados).
        {
            let mut meses = Cross::new([1.0, 6.0, 24.0]);
            let sql = format!(
                "SELECT substr(date,1,7) AS m, SUM(amount) FROM wallet_journal
                 WHERE date IS NOT NULL {who}
                 GROUP BY m HAVING m < strftime('%Y-%m','now') ORDER BY m ASC"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, Option<f64>>(1)?))
            })?;
            for (month, net) in rows.flatten() {
                if net.unwrap_or(0.0) > 0.0 {
                    meses.add(&format!("{month}-01"), 1.0);
                }
            }
            ach.push(meses.state("meses_positivos", "count"));
        }

        // Meses de eficacia (≥90% y ≥10 kills, meses cerrados).
        {
            let mut ef = Cross::new([6.0, 24.0, 48.0]);
            let sql = format!(
                "SELECT substr(killed_at,1,7) AS m,
                        SUM(CASE WHEN is_loss=0 THEN 1 ELSE 0 END),
                        SUM(CASE WHEN is_loss=0 THEN COALESCE(isk_value,0) ELSE 0 END),
                        SUM(CASE WHEN is_loss=1 THEN COALESCE(isk_value,0) ELSE 0 END)
                 FROM killmails WHERE killed_at IS NOT NULL {who}
                 GROUP BY m HAVING m < strftime('%Y-%m','now') ORDER BY m ASC"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, f64>(2)?,
                    r.get::<_, f64>(3)?,
                ))
            })?;
            for (month, kills, isk_d, isk_l) in rows.flatten() {
                let total = isk_d + isk_l;
                if kills >= 10 && total > 0.0 && isk_d / total >= 0.9 {
                    ef.add(&format!("{month}-01"), 1.0);
                }
            }
            ach.push(ef.state("meses_eficaces", "count"));
        }

        // ---------- Persistir desbloqueos y marcar los nuevos (✨) ----------
        let now = chrono::Utc::now().to_rfc3339();
        for a in ach.iter_mut() {
            for lvl in 1..=a.level {
                let inserted = conn.execute(
                    "INSERT OR IGNORE INTO achievements_unlocked
                     (subject_id, ach_id, level, unlocked_at, seen_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    rusqlite::params![
                        subject_id,
                        a.id,
                        lvl as i64,
                        a.unlocked_at[(lvl - 1) as usize],
                        now
                    ],
                )?;
                if inserted > 0 {
                    a.fresh = true;
                }
            }
        }

        Ok(Bitacora {
            challenges,
            achievements: ach,
            was_seeded,
        })
    }
}

/// Un punto de la evolución de un logro: mes (YYYY-MM) + valor acumulado hasta ese mes.
#[derive(Debug, Clone, Serialize)]
pub struct SeriesPoint {
    pub month: String,
    pub value: f64,
}

/// Serie acumulada (suma corrida) a partir de deltas mensuales.
fn cumulative(rows: Vec<(String, f64)>) -> Vec<SeriesPoint> {
    let mut acc = 0.0;
    rows.into_iter()
        .map(|(m, d)| {
            acc += d;
            SeriesPoint { month: m, value: acc }
        })
        .collect()
}
/// Serie de "mejor marca" (máximo corrido) a partir de valores mensuales (para métricas peak).
fn running_max(rows: Vec<(String, f64)>) -> Vec<SeriesPoint> {
    let mut mx = 0.0;
    rows.into_iter()
        .map(|(m, v)| {
            if v > mx {
                mx = v;
            }
            SeriesPoint { month: m, value: mx }
        })
        .collect()
}

impl Db {
    /// Evolución mensual de cada logro, derivada del histórico local (mismo cálculo que las fechas
    /// retroactivas). No guarda nada nuevo: se reconstruye de killmails/wallet/minería/snapshots.
    pub fn bitacora_series(
        &self,
        character_id: Option<i64>,
    ) -> AppResult<std::collections::HashMap<String, Vec<SeriesPoint>>> {
        let who = character_id
            .map(|c| format!("AND character_id = {c}"))
            .unwrap_or_default();
        let conn = self.conn.lock().unwrap();
        // Ejecuta un SQL que devuelve (mes, valor) por fila; nunca panica (vacío si falla).
        let q = |sql: &str| -> Vec<(String, f64)> {
            let mut out = Vec::new();
            if let Ok(mut st) = conn.prepare(sql) {
                if let Ok(rows) = st.query_map([], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, Option<f64>>(1)?.unwrap_or(0.0)))
                }) {
                    for row in rows.flatten() {
                        out.push(row);
                    }
                }
            }
            out
        };
        let mut m: std::collections::HashMap<String, Vec<SeriesPoint>> =
            std::collections::HashMap::new();

        m.insert("kills_totales".into(), cumulative(q(&format!(
            "SELECT substr(killed_at,1,7), COUNT(*) FROM killmails WHERE is_loss=0 AND killed_at IS NOT NULL {who} GROUP BY 1 ORDER BY 1"))));
        m.insert("isk_destruido_total".into(), cumulative(q(&format!(
            "SELECT substr(killed_at,1,7), SUM(isk_value) FROM killmails WHERE is_loss=0 AND killed_at IS NOT NULL {who} GROUP BY 1 ORDER BY 1"))));
        m.insert("solo_kills".into(), cumulative(q(&format!(
            "SELECT substr(killed_at,1,7), COUNT(*) FROM killmails WHERE is_loss=0 AND solo=1 AND killed_at IS NOT NULL {who} GROUP BY 1 ORDER BY 1"))));
        m.insert("final_blows".into(), cumulative(q(&format!(
            "SELECT substr(killed_at,1,7), COUNT(*) FROM killmails WHERE is_loss=0 AND final_blow=1 AND killed_at IS NOT NULL {who} GROUP BY 1 ORDER BY 1"))));
        m.insert("killmail_caro".into(), running_max(q(&format!(
            "SELECT substr(killed_at,1,7), MAX(isk_value) FROM killmails WHERE is_loss=0 AND killed_at IS NOT NULL {who} GROUP BY 1 ORDER BY 1"))));
        m.insert("sistemas_pvp".into(), cumulative(q(&format!(
            "SELECT fm, COUNT(*) FROM (SELECT system_id, MIN(substr(killed_at,1,7)) fm FROM killmails WHERE is_loss=0 AND system_id IS NOT NULL AND killed_at IS NOT NULL {who} GROUP BY system_id) GROUP BY fm ORDER BY fm"))));
        m.insert("rateo_total".into(), cumulative(q(&format!(
            "SELECT substr(date,1,7), SUM(amount) FROM wallet_journal WHERE ref_type IN ('bounty_prizes','ess_escrow_transfer') AND amount>0 AND date IS NOT NULL {who} GROUP BY 1 ORDER BY 1"))));
        m.insert("mineria_total".into(), cumulative(q(&format!(
            "SELECT substr(ml.date,1,7), SUM(ml.quantity*COALESCE(mp.average_price,0)) FROM mining_ledger ml LEFT JOIN market_prices mp ON mp.type_id=ml.type_id WHERE 1=1 {who} GROUP BY 1 ORDER BY 1"))));
        m.insert("patrimonio".into(), running_max(q(&format!(
            "SELECT substr(date,1,7), MAX(day_total) FROM (SELECT date, SUM(total) day_total FROM networth_snapshots WHERE 1=1 {who} GROUP BY date) GROUP BY 1 ORDER BY 1"))));
        m.insert("meses_positivos".into(), cumulative(q(&format!(
            "SELECT m2, CASE WHEN net>0 THEN 1.0 ELSE 0.0 END FROM (SELECT substr(date,1,7) m2, SUM(amount) net FROM wallet_journal WHERE date IS NOT NULL {who} GROUP BY m2 HAVING m2 < strftime('%Y-%m','now')) ORDER BY m2"))));
        m.insert("meses_eficaces".into(), cumulative(q(&format!(
            "SELECT m2, CASE WHEN kills>=10 AND (d+l)>0 AND d/(d+l)>=0.9 THEN 1.0 ELSE 0.0 END FROM (SELECT substr(killed_at,1,7) m2, SUM(CASE WHEN is_loss=0 THEN 1 ELSE 0 END) kills, SUM(CASE WHEN is_loss=0 THEN COALESCE(isk_value,0) ELSE 0 END) d, SUM(CASE WHEN is_loss=1 THEN COALESCE(isk_value,0) ELSE 0 END) l FROM killmails WHERE killed_at IS NOT NULL {who} GROUP BY m2 HAVING m2 < strftime('%Y-%m','now')) ORDER BY m2"))));

        Ok(m)
    }
}

/// Datos de reprocesado de una mena (embebidos del SDE): v=volumen unitario m³,
/// p=portionSize (lote de reprocesado), m=materiales [[typeID, cantidad_por_lote], ...].
#[derive(Debug, Deserialize)]
struct OreInfo {
    #[allow(dead_code)]
    n: String,
    v: f64,
    p: f64,
    m: Vec<(i64, f64)>,
}
static REPROCESS: OnceLock<HashMap<i64, OreInfo>> = OnceLock::new();
fn reprocess() -> &'static HashMap<i64, OreInfo> {
    REPROCESS.get_or_init(|| serde_json::from_str(include_str!("reprocess.json")).unwrap_or_default())
}

/// Un proyecto personal (meta propia del usuario) con su valor ACTUAL calculado del histórico local.
#[derive(Debug, Clone, Serialize)]
pub struct PersonalProject {
    pub id: i64,
    pub name: String,
    pub metric: String,
    pub target: f64,
    pub current: f64,
    pub param_kind: String,
    pub param_ids: String, // CSV de type/system IDs (multi-selección); vacío = sin filtro
    pub param_name: String,
    pub mode: String, // solo mineria: ''|value|units|volume|reproceso
    pub completed_at: String, // RFC3339 al alcanzar el objetivo; '' = activo
}

impl Db {
    /// Crea un proyecto personal (subject_id = character_id, o 0 = global). Devuelve su id.
    pub fn create_personal_project(
        &self,
        subject_id: i64,
        name: &str,
        metric: &str,
        target: f64,
        param_kind: &str,
        param_ids: &str,
        param_name: &str,
        mode: &str,
    ) -> AppResult<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO personal_projects (subject_id, name, metric, target, created_at, param_kind, param_ids, param_name, mode) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![subject_id, name, metric, target, chrono::Utc::now().to_rfc3339(), param_kind, param_ids, param_name, mode],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Borra un proyecto personal por id.
    pub fn delete_personal_project(&self, id: i64) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM personal_projects WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Proyectos personales del sujeto (0 = global) con su valor actual medido del histórico.
    pub fn personal_projects(&self, subject_id: i64) -> AppResult<Vec<PersonalProject>> {
        let conn = self.conn.lock().unwrap();
        let who = if subject_id == 0 {
            String::new()
        } else {
            format!("AND character_id = {subject_id}")
        };
        // Para mineria el filtro por sistema/character usa el alias ml.
        let who_ml = if subject_id == 0 {
            String::new()
        } else {
            format!("AND ml.character_id = {subject_id}")
        };
        // Mapa de precios (para modos de mineria por volumen/reproceso) leído una vez.
        let prices: HashMap<i64, f64> = {
            let mut stmt = conn.prepare("SELECT type_id, COALESCE(average_price,0) FROM market_prices")?;
            let it = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?)))?;
            it.flatten().collect()
        };
        // Leemos las filas (y soltamos el statement) antes de calcular cada valor.
        let rows: Vec<(i64, String, String, f64, String, String, String, String, String, String)> = {
            let mut stmt = conn.prepare(
                "SELECT id, name, metric, target, param_kind, param_ids, param_name, created_at, mode, completed_at FROM personal_projects WHERE subject_id = ?1 ORDER BY id",
            )?;
            let it = stmt.query_map([subject_id], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, f64>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, String>(6)?,
                    r.get::<_, String>(7)?,
                    r.get::<_, String>(8)?,
                    r.get::<_, String>(9)?,
                ))
            })?;
            it.flatten().collect()
        };
        let mut out = Vec::new();
        for (id, name, metric, target, param_kind, param_ids, param_name, created_at, mode, mut completed_at) in rows {
            // IDs saneados (solo numéricos) para el IN(...); vacío = sin filtro.
            let ids: Vec<i64> = param_ids
                .split(',')
                .filter_map(|s| s.trim().parse::<i64>().ok())
                .collect();
            let id_list = ids.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",");
            let has_ids = !ids.is_empty();
            // Filtro opcional para métricas de killmails (nave víctima o sistema).
            let km_filter = if has_ids {
                match param_kind.as_str() {
                    "ship" => format!(" AND victim_ship_type_id IN ({id_list})"),
                    "system" => format!(" AND system_id IN ({id_list})"),
                    "victim_char" => format!(" AND victim_character_id IN ({id_list})"),
                    "victim_corp" => format!(" AND victim_corporation_id IN ({id_list})"),
                    _ => String::new(),
                }
            } else {
                String::new()
            };
            // Filtro opcional para mineria (mineral concreto o sistema).
            let ml_filter = if has_ids {
                match param_kind.as_str() {
                    "ore" => format!(" AND ml.type_id IN ({id_list})"),
                    "system" => format!(" AND ml.system_id IN ({id_list})"),
                    _ => String::new(),
                }
            } else {
                String::new()
            };
            // Cuenta SOLO desde la creación del proyecto (sin importar el pasado).
            // date() normaliza tanto "YYYY-MM-DD" como timestamps RFC3339.
            let ca = created_at.replace('\'', "");
            let km_since = format!(" AND date(killed_at) >= date('{ca}')");
            let wj_since = format!(" AND date(date) >= date('{ca}')");
            let ml_since = format!(" AND date(ml.date) >= date('{ca}')");
            let sql: Option<String> = match metric.as_str() {
                "kills" => Some(format!("SELECT COUNT(*) FROM killmails WHERE is_loss=0 {who}{km_filter}{km_since}")),
                "damage" => Some(format!("SELECT COALESCE(SUM(char_damage),0) FROM killmails WHERE is_loss=0 {who}{km_filter}{km_since}")),
                "isk_destruido" => Some(format!("SELECT COALESCE(SUM(isk_value),0) FROM killmails WHERE is_loss=0 {who}{km_filter}{km_since}")),
                "final_blows" => Some(format!("SELECT COUNT(*) FROM killmails WHERE is_loss=0 AND final_blow=1 {who}{km_filter}{km_since}")),
                "solo_kills" => Some(format!("SELECT COUNT(*) FROM killmails WHERE is_loss=0 AND solo=1 {who}{km_filter}{km_since}")),
                "sistemas" => Some(format!("SELECT COUNT(DISTINCT system_id) FROM killmails WHERE is_loss=0 AND system_id IS NOT NULL {who}{km_filter}{km_since}")),
                "rateo" => Some(format!("SELECT COALESCE(SUM(amount),0) FROM wallet_journal WHERE ref_type IN ('bounty_prizes','ess_escrow_transfer') AND amount>0 {who}{wj_since}")),
                "mineria" => Some(format!("SELECT COALESCE(SUM(ml.quantity*COALESCE(mp.average_price,0)),0) FROM mining_ledger ml LEFT JOIN market_prices mp ON mp.type_id=ml.type_id WHERE 1=1 {who_ml}{ml_filter}{ml_since}")),
                // Patrimonio = nivel absoluto (alcanzar X), no acumulación: sin filtro de fecha.
                "patrimonio" => Some(format!("SELECT COALESCE(MAX(day_total),0) FROM (SELECT date, SUM(total) day_total FROM networth_snapshots WHERE 1=1 {who} GROUP BY date)")),
                // Logi (Fase B): curación remota DADA por tipo, agregada del gamelog. wj_since sirve
                // (misma columna `date`). Si nunca se escaneó el gamelog, logi_ledger está vacío → 0.
                "heal_shield" => Some(format!("SELECT COALESCE(SUM(hp),0) FROM logi_ledger WHERE kind='shield' AND direction='given' {who}{wj_since}")),
                "heal_armor" => Some(format!("SELECT COALESCE(SUM(hp),0) FROM logi_ledger WHERE kind='armor' AND direction='given' {who}{wj_since}")),
                "heal_hull" => Some(format!("SELECT COALESCE(SUM(hp),0) FROM logi_ledger WHERE kind='hull' AND direction='given' {who}{wj_since}")),
                // Reps RECIBIDAS (lo que te curan): útil para quien recibe logi (no la da).
                "recv_shield" => Some(format!("SELECT COALESCE(SUM(hp),0) FROM logi_ledger WHERE kind='shield' AND direction='received' {who}{wj_since}")),
                "recv_armor" => Some(format!("SELECT COALESCE(SUM(hp),0) FROM logi_ledger WHERE kind='armor' AND direction='received' {who}{wj_since}")),
                "recv_hull" => Some(format!("SELECT COALESCE(SUM(hp),0) FROM logi_ledger WHERE kind='hull' AND direction='received' {who}{wj_since}")),
                _ => None,
            };
            // Mineria con modo especial (unidades / volumen m³ / ISK-reproceso 85%): se computa
            // en Rust agrupando por tipo minado y cruzando con el reprocesado embebido + precios.
            let current = if metric == "mineria" && matches!(mode.as_str(), "units" | "volume" | "reproceso") {
                let q = format!(
                    "SELECT ml.type_id, SUM(ml.quantity) FROM mining_ledger ml WHERE 1=1 {who_ml}{ml_filter}{ml_since} GROUP BY ml.type_id"
                );
                let mut val = 0.0;
                if let Ok(mut stmt) = conn.prepare(&q) {
                    if let Ok(it) = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?))) {
                        for (tid, qty) in it.flatten() {
                            match mode.as_str() {
                                "units" => val += qty,
                                "volume" => {
                                    if let Some(o) = reprocess().get(&tid) {
                                        val += qty * o.v;
                                    }
                                }
                                "reproceso" => {
                                    if let Some(o) = reprocess().get(&tid) {
                                        if o.p > 0.0 {
                                            let batches = qty / o.p;
                                            for &(mat, mq) in &o.m {
                                                let price = prices.get(&mat).copied().unwrap_or(0.0);
                                                val += batches * mq * 0.85 * price;
                                            }
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
                val
            } else {
                sql.map(|s| conn.query_row(&s, [], |r| r.get::<_, f64>(0)).unwrap_or(0.0))
                    .unwrap_or(0.0)
            };
            // Sella la fecha de completado la primera vez que se alcanza el objetivo (archivo).
            if completed_at.is_empty() && target > 0.0 && current >= target {
                completed_at = chrono::Utc::now().to_rfc3339();
                let _ = conn.execute(
                    "UPDATE personal_projects SET completed_at = ?1 WHERE id = ?2",
                    rusqlite::params![completed_at, id],
                );
            }
            out.push(PersonalProject { id, name, metric, target, current, param_kind, param_ids, param_name, mode, completed_at });
        }
        Ok(out)
    }

    /// Víctimas (personaje o corp) de tus kills, con recuento, para el buscador de caza selectiva.
    /// kind = "victim_corp" → corps; cualquier otro → personajes. subject_id 0 = global.
    pub fn kill_victims(&self, subject_id: i64, kind: &str) -> AppResult<Vec<(i64, i64)>> {
        let conn = self.conn.lock().unwrap();
        let col = if kind == "victim_corp" {
            "victim_corporation_id"
        } else {
            "victim_character_id"
        };
        let who = if subject_id == 0 {
            String::new()
        } else {
            format!("AND character_id = {subject_id}")
        };
        let q = format!(
            "SELECT {col}, COUNT(*) c FROM killmails WHERE is_loss=0 AND {col} IS NOT NULL {who} GROUP BY {col} ORDER BY c DESC LIMIT 300"
        );
        let mut stmt = conn.prepare(&q)?;
        let it = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))?;
        Ok(it.flatten().collect())
    }

    // ===== Gamelogs (Fase B) =====

    /// Marca previa de un gamelog ya parseado (size, mtime, offset). None si nunca se parseó.
    pub fn gamelog_offset(&self, filename: &str) -> Option<(i64, i64, i64)> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT size, mtime, read_offset FROM gamelog_parsed WHERE filename = ?1",
            [filename],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .ok()
    }

    /// Vuelca los eventos logi de un fichero y actualiza su marca de parseo (transacción).
    pub fn commit_gamelog(
        &self,
        filename: &str,
        size: i64,
        mtime: i64,
        offset: i64,
        character_id: i64,
        batch: &crate::gamelog::ScanBatch,
    ) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        for e in &batch.logi {
            // Solo PERSONAJES reales (formato [Nave] Piloto). Naves con nombre propio, drones, NPC y
            // estructuras se descartan por completo: el logi es curación entre jugadores, así que ni
            // cuentan en los totales (logi_ledger) ni en la tabla/gráfica de pilotos.
            if e.is_char && !e.pilot.is_empty() {
                conn.execute(
                    "INSERT INTO logi_ledger (character_id, date, kind, direction, hp) VALUES (?1,?2,?3,?4,?5) \
                     ON CONFLICT(character_id,date,kind,direction) DO UPDATE SET hp = hp + excluded.hp",
                    rusqlite::params![character_id, e.date, e.kind, e.direction, e.hp],
                )?;
                let (hs, ha, hh) = match e.kind.as_str() {
                    "shield" => (e.hp, 0.0, 0.0),
                    "armor" => (0.0, e.hp, 0.0),
                    "hull" => (0.0, 0.0, e.hp),
                    _ => (0.0, 0.0, 0.0),
                };
                conn.execute(
                    "INSERT INTO logi_pilots (character_id, direction, pilot, hp, reps, ship, module, hp_shield, hp_armor, hp_hull) \
                     VALUES (?1,?2,?3,?4,1,?5,?6,?7,?8,?9) \
                     ON CONFLICT(character_id,direction,pilot) DO UPDATE SET \
                       hp = hp + excluded.hp, reps = reps + 1, \
                       ship = CASE WHEN excluded.ship <> '' THEN excluded.ship ELSE logi_pilots.ship END, \
                       module = CASE WHEN excluded.module <> '' THEN excluded.module ELSE logi_pilots.module END, \
                       hp_shield = hp_shield + excluded.hp_shield, hp_armor = hp_armor + excluded.hp_armor, hp_hull = hp_hull + excluded.hp_hull",
                    rusqlite::params![character_id, e.direction, e.pilot, e.hp, e.ship, e.module, hs, ha, hh],
                )?;
                // Granular por día: permite desglosar la gráfica por personaje/nave/módulo × fecha.
                conn.execute(
                    "INSERT INTO logi_daily (character_id, direction, date, pilot, ship, module, hp, reps) \
                     VALUES (?1,?2,?3,?4,?5,?6,?7,1) \
                     ON CONFLICT(character_id,direction,date,pilot,ship,module) DO UPDATE SET \
                       hp = hp + excluded.hp, reps = reps + 1",
                    rusqlite::params![character_id, e.direction, e.date, e.pilot, e.ship, e.module, e.hp],
                )?;
            }
        }
        // Fase C — minería por personaje/día/mena. base va a `units`, el crítico Equinox a `crit`
        // (base+crit = total ESI). Los ciclos solo cuentan la extracción base.
        for m in &batch.mining {
            let (u, c, cyc) = if m.crit { (0, m.units, 0) } else { (m.units, 0, 1) };
            conn.execute(
                "INSERT INTO gamelog_mining (character_id, date, ore, units, crit, cycles, waste) VALUES (?1,?2,?3,?4,?5,?6,?7) \
                 ON CONFLICT(character_id,date,ore) DO UPDATE SET units = units + excluded.units, crit = crit + excluded.crit, \
                   cycles = cycles + excluded.cycles, waste = waste + excluded.waste",
                rusqlite::params![character_id, m.date, m.ore, u, c, cyc, m.residue],
            )?;
        }
        // Fase C — desperdicio de minería (LOG-ONLY): unidades residuales por personaje/día.
        for w in &batch.waste {
            conn.execute(
                "INSERT INTO gamelog_mining_waste (character_id, date, units, cycles) VALUES (?1,?2,?3,1) \
                 ON CONFLICT(character_id,date) DO UPDATE SET units = units + excluded.units, cycles = cycles + 1",
                rusqlite::params![character_id, w.date, w.units],
            )?;
        }
        // Fase C — bounty (rateo): ISK + nº de pagos por personaje/día.
        for b in &batch.bounty {
            conn.execute(
                "INSERT INTO gamelog_bounty (character_id, date, isk, pays) VALUES (?1,?2,?3,1) \
                 ON CONFLICT(character_id,date) DO UPDATE SET isk = isk + excluded.isk, pays = pays + 1",
                rusqlite::params![character_id, b.date, b.isk],
            )?;
        }
        // Rescate y boosts (categoría `notify`). Volumen bajo → upsert directo, sin agregar antes.
        {
            let mut sagg: std::collections::HashMap<String, [i64; 2]> = std::collections::HashMap::new();
            for s in &batch.salvage {
                let e = sagg.entry(s.date.clone()).or_insert([0; 2]);
                if s.ok { e[0] += 1 } else { e[1] += 1 }
            }
            for (date, v) in &sagg {
                conn.execute(
                    "INSERT INTO gamelog_salvage (character_id, date, salvaged, failed) VALUES (?1,?2,?3,?4) \
                     ON CONFLICT(character_id,date) DO UPDATE SET \
                       salvaged = salvaged + excluded.salvaged, failed = failed + excluded.failed",
                    rusqlite::params![character_id, date, v[0], v[1]],
                )?;
            }
            let mut bagg: std::collections::HashMap<(String, String), [i64; 2]> = std::collections::HashMap::new();
            for b in &batch.boosts {
                let e = bagg.entry((b.date.clone(), b.module.clone())).or_insert([0; 2]);
                e[0] += 1;
                e[1] += b.members;
            }
            for ((date, module), v) in &bagg {
                conn.execute(
                    "INSERT INTO gamelog_boosts (character_id, date, module, pulses, members) VALUES (?1,?2,?3,?4,?5) \
                     ON CONFLICT(character_id,date,module) DO UPDATE SET \
                       pulses = pulses + excluded.pulses, members = members + excluded.members",
                    rusqlite::params![character_id, date, module, v[0], v[1]],
                )?;
            }
        }
        // Fase C — saltos: nº por arista (origen→destino) y día.
        for j in &batch.jumps {
            conn.execute(
                "INSERT INTO gamelog_jumps (character_id, date, from_sys, to_sys, jumps) VALUES (?1,?2,?3,?4,1) \
                 ON CONFLICT(character_id,date,from_sys,to_sys) DO UPDATE SET jumps = jumps + 1",
                rusqlite::params![character_id, j.date, j.from, j.to],
            )?;
        }
        // Fase C — combate (LOG-ONLY). El combate es LA categoría más numerosa (~millones de líneas):
        // una escritura por golpe fundiría la BD. Agregamos EN MEMORIA por día (y por rata) y hacemos
        // solo unos pocos upserts por fichero.
        {
            let mut cagg: std::collections::HashMap<String, [i64; 6]> = std::collections::HashMap::new();
            let mut ragg: std::collections::HashMap<(String, String), [i64; 2]> = std::collections::HashMap::new();
            // Diccionario ES→EN visto en este fichero (dedup en memoria: son poquísimos distintos).
            let mut alias: std::collections::HashMap<String, String> = std::collections::HashMap::new();
            // DPS: daño HECHO por (día, segundo). Los segundos con daño = tiempo de combate real;
            // el máximo de un segundo = pico de DPS. Se resuelve al cerrar el fichero.
            let mut persec: std::collections::HashMap<(String, i64), i64> = std::collections::HashMap::new();
            // Arma → (daño, disparos, fallos) y calidad 1..6 → (dados, recibidos). Agregado en memoria
            // por el mismo motivo que el combate: son millones de líneas.
            let mut wagg: std::collections::HashMap<(String, String), [i64; 3]> = std::collections::HashMap::new();
            let mut qagg: std::collections::HashMap<(String, u8), [i64; 2]> = std::collections::HashMap::new();
            let mut magg: std::collections::HashMap<String, [i64; 2]> = std::collections::HashMap::new(); // día → (fallos dados, recibidos)
            for c in &batch.combat {
                let e = cagg.entry(c.date.clone()).or_insert([0; 6]);
                let w = i64::from(c.wreck);
                if c.quality > 0 {
                    let q = qagg.entry((c.date.clone(), c.quality)).or_insert([0; 2]);
                    if c.done { q[0] += 1 } else { q[1] += 1 }
                }
                if c.done && !c.weapon.is_empty() {
                    let a = wagg.entry((c.date.clone(), c.weapon.clone())).or_insert([0; 3]);
                    a[0] += c.dmg;
                    a[1] += 1;
                }
                if c.done {
                    e[0] += c.dmg;
                    e[2] += 1;
                    e[4] += w;
                    if c.sec >= 0 {
                        *persec.entry((c.date.clone(), c.sec)).or_insert(0) += c.dmg;
                    }
                    if !c.target.is_empty() {
                        let r = ragg.entry((c.date.clone(), c.target.clone())).or_insert([0; 2]);
                        r[0] += c.dmg;
                        r[1] += 1;
                    }
                    if !c.alias_es.is_empty() && !c.alias_en.is_empty() {
                        alias.insert(c.alias_es.clone(), c.alias_en.clone());
                    }
                } else {
                    e[1] += c.dmg;
                    e[3] += 1;
                    e[5] += w;
                }
            }
            // Fallos: los dados alimentan el ratio de acierto (y el de su arma); los recibidos, la
            // evasión. El gamelog registra ambos, con verbos distintos según idioma y dirección.
            for m in &batch.misses {
                let e = magg.entry(m.date.clone()).or_insert([0; 2]);
                if m.done {
                    e[0] += 1;
                    if !m.weapon.is_empty() {
                        wagg.entry((m.date.clone(), m.weapon.clone())).or_insert([0; 3])[2] += 1;
                    }
                } else {
                    e[1] += 1;
                }
            }
            for ((date, weapon), v) in &wagg {
                conn.execute(
                    "INSERT INTO gamelog_weapons (character_id, date, weapon, dmg, shots, misses) VALUES (?1,?2,?3,?4,?5,?6) \
                     ON CONFLICT(character_id,date,weapon) DO UPDATE SET \
                       dmg = dmg + excluded.dmg, shots = shots + excluded.shots, misses = misses + excluded.misses",
                    rusqlite::params![character_id, date, weapon, v[0], v[1], v[2]],
                )?;
            }
            for ((date, q), v) in &qagg {
                conn.execute(
                    "INSERT INTO gamelog_quality (character_id, date, quality, done, taken) VALUES (?1,?2,?3,?4,?5) \
                     ON CONFLICT(character_id,date,quality) DO UPDATE SET \
                       done = done + excluded.done, taken = taken + excluded.taken",
                    rusqlite::params![character_id, date, *q as i64, v[0], v[1]],
                )?;
            }
            // Un día puede tener fallos sin un solo golpe (te tirotean y no aciertas): esa fila de
            // gamelog_combat no existiría, así que la creamos aquí con el resto a cero.
            for (date, v) in &magg {
                conn.execute(
                    "INSERT INTO gamelog_combat (character_id, date, misses_done, misses_taken) VALUES (?1,?2,?3,?4) \
                     ON CONFLICT(character_id,date) DO UPDATE SET \
                       misses_done = misses_done + excluded.misses_done, misses_taken = misses_taken + excluded.misses_taken",
                    rusqlite::params![character_id, date, v[0], v[1]],
                )?;
            }
            // Por día: nº de segundos con daño y el mayor daño concentrado en uno solo.
            let mut dps: std::collections::HashMap<String, (i64, i64)> = std::collections::HashMap::new();
            for ((date, _sec), d) in &persec {
                if *d <= 0 {
                    continue;
                }
                let e = dps.entry(date.clone()).or_insert((0, 0));
                e.0 += 1;
                if *d > e.1 {
                    e.1 = *d;
                }
            }
            for (es, en) in &alias {
                conn.execute(
                    "INSERT INTO gamelog_rat_alias (es, en) VALUES (?1,?2) ON CONFLICT(es) DO NOTHING",
                    rusqlite::params![es, en],
                )?;
            }
            for (date, v) in &cagg {
                let (secs, peak) = dps.get(date).copied().unwrap_or((0, 0));
                conn.execute(
                    "INSERT INTO gamelog_combat (character_id, date, dmg_done, dmg_taken, shots_done, shots_taken, wrecks_done, wrecks_taken, active_secs, peak_dps) \
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) \
                     ON CONFLICT(character_id,date) DO UPDATE SET \
                       dmg_done=dmg_done+excluded.dmg_done, dmg_taken=dmg_taken+excluded.dmg_taken, \
                       shots_done=shots_done+excluded.shots_done, shots_taken=shots_taken+excluded.shots_taken, \
                       wrecks_done=wrecks_done+excluded.wrecks_done, wrecks_taken=wrecks_taken+excluded.wrecks_taken, \
                       active_secs=active_secs+excluded.active_secs, peak_dps=MAX(peak_dps, excluded.peak_dps)",
                    rusqlite::params![character_id, date, v[0], v[1], v[2], v[3], v[4], v[5], secs, peak],
                )?;
            }
            for ((date, rat), v) in &ragg {
                conn.execute(
                    "INSERT INTO gamelog_rats (character_id, date, rat, dmg, shots) VALUES (?1,?2,?3,?4,?5) \
                     ON CONFLICT(character_id,date,rat) DO UPDATE SET dmg = dmg + excluded.dmg, shots = shots + excluded.shots",
                    rusqlite::params![character_id, date, rat, v[0], v[1]],
                )?;
            }
        }
        conn.execute(
            "INSERT INTO gamelog_parsed (filename, size, mtime, read_offset) VALUES (?1,?2,?3,?4) \
             ON CONFLICT(filename) DO UPDATE SET size=excluded.size, mtime=excluded.mtime, read_offset=excluded.read_offset",
            rusqlite::params![filename, size, mtime, offset],
        )?;
        Ok(())
    }

    /// Resumen logi all-time (del histórico ya parseado): HP por dirección y tipo. subject_id 0 = global.
    pub fn logi_summary(&self, subject_id: i64) -> AppResult<LogiSummary> {
        let conn = self.conn.lock().unwrap();
        let who = if subject_id == 0 {
            String::new()
        } else {
            format!("AND character_id = {subject_id}")
        };
        let q = format!(
            "SELECT direction, kind, COALESCE(SUM(hp),0) FROM logi_ledger WHERE 1=1 {who} GROUP BY direction, kind"
        );
        let mut stmt = conn.prepare(&q)?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, f64>(2)?))
        })?;
        let mut s = LogiSummary::default();
        for (dir, kind, hp) in rows.flatten() {
            let slot = match (dir.as_str(), kind.as_str()) {
                ("given", "shield") => &mut s.given_shield,
                ("given", "armor") => &mut s.given_armor,
                ("given", "hull") => &mut s.given_hull,
                ("received", "shield") => &mut s.recv_shield,
                ("received", "armor") => &mut s.recv_armor,
                ("received", "hull") => &mut s.recv_hull,
                _ => continue,
            };
            *slot = hp;
        }
        Ok(s)
    }

    /// Serie mensual de logi (dado y recibido, por tipo) para la gráfica del apartado Logis.
    pub fn logi_series(&self, subject_id: i64) -> AppResult<LogiSeries> {
        let conn = self.conn.lock().unwrap();
        let who = if subject_id == 0 {
            String::new()
        } else {
            format!("AND character_id = {subject_id}")
        };
        // Por DÍA (el frontend agrega a día/semana/mes/año, como las otras gráficas).
        let q = format!(
            "SELECT date, direction, kind, SUM(hp) FROM logi_ledger WHERE 1=1 {who} GROUP BY date, direction, kind ORDER BY date"
        );
        let mut map: std::collections::BTreeMap<String, [f64; 6]> = std::collections::BTreeMap::new();
        let mut stmt = conn.prepare(&q)?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, f64>(3)?,
            ))
        })?;
        for (m, dir, kind, hp) in rows.flatten() {
            let idx = match (dir.as_str(), kind.as_str()) {
                ("given", "shield") => 0,
                ("given", "armor") => 1,
                ("given", "hull") => 2,
                ("received", "shield") => 3,
                ("received", "armor") => 4,
                ("received", "hull") => 5,
                _ => continue,
            };
            map.entry(m).or_insert([0.0; 6])[idx] += hp;
        }
        let mut s = LogiSeries::default();
        for (m, a) in map {
            s.labels.push(m);
            s.given_shield.push(a[0]);
            s.given_armor.push(a[1]);
            s.given_hull.push(a[2]);
            s.recv_shield.push(a[3]);
            s.recv_armor.push(a[4]);
            s.recv_hull.push(a[5]);
        }
        Ok(s)
    }

    /// Top de pilotos por dirección (given = a quién curaste; received = de quién recibiste).
    pub fn logi_pilots_top(&self, subject_id: i64, direction: &str) -> AppResult<Vec<LogiPilot>> {
        let conn = self.conn.lock().unwrap();
        let who = if subject_id == 0 {
            String::new()
        } else {
            format!("AND character_id = {subject_id}")
        };
        let q = format!(
            "SELECT pilot, SUM(hp), SUM(reps), MAX(ship), MAX(module), SUM(hp_shield), SUM(hp_armor), SUM(hp_hull) \
             FROM logi_pilots WHERE direction = ?1 {who} GROUP BY pilot ORDER BY SUM(hp) DESC LIMIT 100"
        );
        let mut stmt = conn.prepare(&q)?;
        let rows = stmt.query_map([direction], |r| {
            Ok(LogiPilot {
                pilot: r.get::<_, String>(0)?,
                hp: r.get::<_, f64>(1)?,
                reps: r.get::<_, i64>(2)?,
                ship: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                module: r.get::<_, Option<String>>(4)?.unwrap_or_default(),
                hp_shield: r.get::<_, f64>(5)?,
                hp_armor: r.get::<_, f64>(6)?,
                hp_hull: r.get::<_, f64>(7)?,
                char_id: 0,
            })
        })?;
        Ok(rows.flatten().collect())
    }

    /// Desglose de logi por dimensión (pilot|ship|module) × día para la gráfica. Devuelve las top-8
    /// entidades por HP total en esa dirección, con su valor por día (el frontend agrupa por
    /// granularidad). subject_id 0 = global. direction = given|received.
    pub fn logi_breakdown(&self, subject_id: i64, direction: &str, dimension: &str) -> AppResult<LogiBreakdown> {
        let conn = self.conn.lock().unwrap();
        let col = match dimension {
            "ship" => "ship",
            "module" => "module",
            _ => "pilot",
        };
        let who = if subject_id == 0 {
            String::new()
        } else {
            format!("AND character_id = {subject_id}")
        };
        let q = format!(
            "SELECT date, {col} AS ent, SUM(hp) FROM logi_daily \
             WHERE direction = ?1 {who} AND {col} <> '' GROUP BY date, ent ORDER BY date ASC"
        );
        let mut stmt = conn.prepare(&q)?;
        let rows = stmt
            .query_map([direction], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, f64>(2)?))
            })?
            .flatten()
            .collect::<Vec<_>>();

        // Totales por entidad → top 8.
        let mut totals: std::collections::HashMap<String, f64> = std::collections::HashMap::new();
        let mut dates: Vec<String> = Vec::new();
        for (d, ent, hp) in &rows {
            *totals.entry(ent.clone()).or_insert(0.0) += *hp;
            if dates.last().map(|x| x != d).unwrap_or(true) {
                dates.push(d.clone());
            }
        }
        let mut top: Vec<(String, f64)> = totals.into_iter().collect();
        top.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        top.truncate(8);
        let names: Vec<String> = top.into_iter().map(|(n, _)| n).collect();

        // Índice fecha→posición y pivot (claves propias para poder mover `dates` en el return).
        let didx: std::collections::HashMap<String, usize> =
            dates.iter().enumerate().map(|(i, d)| (d.clone(), i)).collect();
        let mut series: Vec<LogiBreakSeries> = names
            .iter()
            .map(|n| LogiBreakSeries { name: n.clone(), values: vec![0.0; dates.len()] })
            .collect();
        let nidx: std::collections::HashMap<String, usize> =
            names.iter().enumerate().map(|(i, n)| (n.clone(), i)).collect();
        for (d, ent, hp) in &rows {
            if let (Some(&si), Some(&di)) = (nidx.get(ent.as_str()), didx.get(d.as_str())) {
                series[si].values[di] += *hp;
            }
        }
        Ok(LogiBreakdown { dates, series })
    }

    /// Fase C — reconstrucción (minería/rateo/viaje) del histórico de gamelog. subject_id 0 = global.
    pub fn gamelog_recon(&self, subject_id: i64) -> AppResult<GamelogRecon> {
        let conn = self.conn.lock().unwrap();
        let who = if subject_id == 0 {
            String::new()
        } else {
            format!("AND character_id = {subject_id}")
        };
        let mut r = GamelogRecon::default();

        // --- Minería --- (extraído = base + crítico = total ESI; el crítico también se expone aparte)
        let (mu, mcr, mc): (i64, i64, i64) = conn
            .query_row(
                &format!("SELECT COALESCE(SUM(units+crit),0), COALESCE(SUM(crit),0), COALESCE(SUM(cycles),0) FROM gamelog_mining WHERE 1=1 {who}"),
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap_or((0, 0, 0));
        r.mining_units = mu;
        r.mining_crit = mcr;
        r.mining_cycles = mc;
        {
            let q = format!(
                // Límite alto a propósito: el nombre es el CRUDO del log, así que la misma mena puede
                // venir partida en su nombre antiguo y el actual. `get_gamelog_recon` las funde
                // después por typeID y recorta; si aquí cortásemos a 20, perderíamos filas al sumar.
                "SELECT ore, SUM(units+crit), SUM(cycles) FROM gamelog_mining WHERE 1=1 {who} GROUP BY ore ORDER BY SUM(units+crit) DESC LIMIT 80"
            );
            let mut st = conn.prepare(&q)?;
            r.top_ores = st
                .query_map([], |row| {
                    Ok(MiningOre { ore: row.get(0)?, units: row.get(1)?, cycles: row.get(2)? })
                })?
                .flatten()
                .collect();
        }
        {
            let q = format!(
                "SELECT date, SUM(units+crit) FROM gamelog_mining WHERE 1=1 {who} GROUP BY date ORDER BY date ASC"
            );
            let mut st = conn.prepare(&q)?;
            r.mining_series = st
                .query_map([], |row| Ok(DayVal { date: row.get(0)?, value: row.get::<_, i64>(1)? as f64 }))?
                .flatten()
                .collect();
        }
        {
            let q = format!(
                "SELECT date, SUM(crit) FROM gamelog_mining WHERE 1=1 {who} AND crit > 0 GROUP BY date ORDER BY date ASC"
            );
            let mut st = conn.prepare(&q)?;
            r.mining_crit_series = st
                .query_map([], |row| Ok(DayVal { date: row.get(0)?, value: row.get::<_, i64>(1)? as f64 }))?
                .flatten()
                .collect();
        }
        // Desperdicio (LOG-ONLY): total + serie diaria.
        r.mining_wasted = conn
            .query_row(
                &format!("SELECT COALESCE(SUM(units),0) FROM gamelog_mining_waste WHERE 1=1 {who}"),
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        {
            let q = format!(
                "SELECT date, SUM(units) FROM gamelog_mining_waste WHERE 1=1 {who} GROUP BY date ORDER BY date ASC"
            );
            let mut st = conn.prepare(&q)?;
            r.mining_waste_series = st
                .query_map([], |row| Ok(DayVal { date: row.get(0)?, value: row.get::<_, i64>(1)? as f64 }))?
                .flatten()
                .collect();
        }

        // --- Bounty (rateo) ---
        let (bi, bp): (i64, i64) = conn
            .query_row(
                &format!("SELECT COALESCE(SUM(isk),0), COALESCE(SUM(pays),0) FROM gamelog_bounty WHERE 1=1 {who}"),
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap_or((0, 0));
        r.bounty_isk = bi;
        r.bounty_pays = bp;
        {
            let q = format!(
                "SELECT date, SUM(isk) FROM gamelog_bounty WHERE 1=1 {who} GROUP BY date ORDER BY date ASC"
            );
            let mut st = conn.prepare(&q)?;
            r.bounty_series = st
                .query_map([], |row| Ok(DayVal { date: row.get(0)?, value: row.get::<_, i64>(1)? as f64 }))?
                .flatten()
                .collect();
        }

        // --- Viaje ---
        r.total_jumps = conn
            .query_row(
                &format!("SELECT COALESCE(SUM(jumps),0) FROM gamelog_jumps WHERE 1=1 {who}"),
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        r.distinct_systems = conn
            .query_row(
                &format!(
                    "SELECT COUNT(*) FROM (SELECT from_sys s FROM gamelog_jumps WHERE 1=1 {who} \
                     UNION SELECT to_sys FROM gamelog_jumps WHERE 1=1 {who})"
                ),
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        {
            // "Visitas" = llegadas (saltos hacia ese sistema).
            let q = format!(
                "SELECT to_sys, SUM(jumps) FROM gamelog_jumps WHERE 1=1 {who} GROUP BY to_sys ORDER BY SUM(jumps) DESC LIMIT 20"
            );
            let mut st = conn.prepare(&q)?;
            r.top_systems = st
                .query_map([], |row| Ok(SysVisit { system: row.get(0)?, visits: row.get(1)? }))?
                .flatten()
                .collect();
        }

        // --- Combate (LOG-ONLY) ---
        let (cdd, cdt, csd, cst, cwd, cwt): (i64, i64, i64, i64, i64, i64) = conn
            .query_row(
                &format!(
                    "SELECT COALESCE(SUM(dmg_done),0), COALESCE(SUM(dmg_taken),0), COALESCE(SUM(shots_done),0), \
                     COALESCE(SUM(shots_taken),0), COALESCE(SUM(wrecks_done),0), COALESCE(SUM(wrecks_taken),0) \
                     FROM gamelog_combat WHERE 1=1 {who}"
                ),
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
            )
            .unwrap_or((0, 0, 0, 0, 0, 0));
        r.combat_dmg_done = cdd;
        r.combat_dmg_taken = cdt;
        r.combat_shots_done = csd;
        r.combat_shots_taken = cst;
        r.combat_wrecks_done = cwd;
        r.combat_wrecks_taken = cwt;
        // DPS (LOG-ONLY): segundos con daño = tiempo de combate REAL; el pico es el mejor segundo
        // de todo el histórico. El DPS medio se calcula en el frontend (dmg_done / active_secs).
        let (asecs, peak): (i64, i64) = conn
            .query_row(
                &format!(
                    "SELECT COALESCE(SUM(active_secs),0), COALESCE(MAX(peak_dps),0) \
                     FROM gamelog_combat WHERE 1=1 {who}"
                ),
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap_or((0, 0));
        r.combat_active_secs = asecs;
        r.combat_peak_dps = peak;
        {
            let q = format!(
                "SELECT date, SUM(dmg_done) FROM gamelog_combat WHERE 1=1 {who} GROUP BY date ORDER BY date ASC"
            );
            let mut st = conn.prepare(&q)?;
            r.combat_done_series = st
                .query_map([], |row| Ok(DayVal { date: row.get(0)?, value: row.get::<_, i64>(1)? as f64 }))?
                .flatten()
                .collect();
        }
        {
            let q = format!(
                "SELECT date, SUM(dmg_taken) FROM gamelog_combat WHERE 1=1 {who} GROUP BY date ORDER BY date ASC"
            );
            let mut st = conn.prepare(&q)?;
            r.combat_taken_series = st
                .query_map([], |row| Ok(DayVal { date: row.get(0)?, value: row.get::<_, i64>(1)? as f64 }))?
                .flatten()
                .collect();
        }
        {
            // Segundos con daño por día. Exponemos el DENOMINADOR (no un DPS ya promediado) para que
            // el frontend pueda agregar por mes/año ponderando bien: DPS = Σdaño / Σsegundos.
            let q = format!(
                "SELECT date, SUM(active_secs) FROM gamelog_combat WHERE 1=1 {who} GROUP BY date ORDER BY date ASC"
            );
            let mut st = conn.prepare(&q)?;
            r.combat_secs_series = st
                .query_map([], |row| Ok(DayVal { date: row.get(0)?, value: row.get::<_, i64>(1)? as f64 }))?
                .flatten()
                .collect();
        }
        {
            // Canonizamos al nombre EN vía el diccionario sacado del propio log: así "Patriarca
            // corpus" (log viejo con el cliente en español) y "Corpus Patriarch" son la misma rata.
            let q = format!(
                "SELECT COALESCE(a.en, r.rat) AS nombre, SUM(r.dmg) FROM gamelog_rats r \
                 LEFT JOIN gamelog_rat_alias a ON a.es = r.rat \
                 WHERE 1=1 {who} GROUP BY nombre ORDER BY SUM(r.dmg) DESC LIMIT 15"
            );
            let mut st = conn.prepare(&q)?;
            r.top_rats = st
                .query_map([], |row| Ok(RatDmg { rat: row.get(0)?, dmg: row.get(1)? }))?
                .flatten()
                .collect();
        }
        Ok(r)
    }

    /// Filas crudas de minería del gamelog (date, ore, units, crit) para valorarlas por modo en el
    /// comando (reusa ore_per_unit). subject_id 0 = global.
    pub fn gamelog_mining_rows(&self, subject_id: i64) -> AppResult<Vec<(String, String, i64, i64)>> {
        let conn = self.conn.lock().unwrap();
        let who = if subject_id == 0 {
            String::new()
        } else {
            format!("AND character_id = {subject_id}")
        };
        let q = format!("SELECT date, ore, units, crit FROM gamelog_mining WHERE 1=1 {who}");
        let mut st = conn.prepare(&q)?;
        let rows = st
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })?
            .flatten()
            .collect();
        Ok(rows)
    }

    /// Nº de gamelogs ya parseados (para el estado del escaneo en Ajustes).
    pub fn gamelog_status(&self) -> i64 {
        let conn = self.conn.lock().unwrap();
        conn.query_row("SELECT COUNT(*) FROM gamelog_parsed", [], |r| r.get(0))
            .unwrap_or(0)
    }

    /// Lee un valor de la tabla clave/valor `meta` (None si no existe).
    pub fn meta_get(&self, key: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get::<_, String>(0))
            .ok()
    }

    /// ¿Hay un reprocesado de logi pendiente? (una migración de datos marcó que hay que releer el
    /// gamelog). El reprocesado real se hace en el próximo escaneo y solo si hay logs.
    pub fn logi_reparse_pending(&self) -> bool {
        self.meta_get("logi_reparse_pending")
            .map(|v| !v.is_empty() && v != "0")
            .unwrap_or(false)
    }

    /// Limpia los agregados de logi y el tracking para un reparse completo. SOLO debe llamarse
    /// cuando hay logs que releer (si no, se perdería el histórico ya volcado). En una transacción.
    pub fn logi_reset_for_reparse(&self) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "BEGIN; \
             DELETE FROM gamelog_parsed; \
             DELETE FROM logi_ledger; \
             DELETE FROM logi_pilots; \
             DELETE FROM logi_daily; \
             DELETE FROM gamelog_mining; \
             DELETE FROM gamelog_bounty; \
             DELETE FROM gamelog_jumps; \
             DELETE FROM gamelog_mining_waste; \
             DELETE FROM gamelog_combat; \
             DELETE FROM gamelog_rats; \
             DELETE FROM gamelog_rat_alias; \
             DELETE FROM gamelog_weapons; \
             DELETE FROM gamelog_quality; \
             DELETE FROM gamelog_salvage; \
             DELETE FROM gamelog_boosts; \
             COMMIT;",
        )?;
        Ok(())
    }

    /// Marca el reprocesado como completado: fija logi_data_version al target pendiente y limpia la
    /// bandera. Idempotente.
    pub fn logi_mark_reparsed(&self) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        let target = conn
            .query_row("SELECT value FROM meta WHERE key='logi_reparse_pending'", [], |r| r.get::<_, String>(0))
            .unwrap_or_else(|_| "0".to_string());
        if target != "0" && !target.is_empty() {
            conn.execute(
                "INSERT INTO meta (key, value) VALUES ('logi_data_version', ?1) \
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                rusqlite::params![target],
            )?;
        }
        conn.execute(
            "INSERT INTO meta (key, value) VALUES ('logi_reparse_pending', '0') \
             ON CONFLICT(key) DO UPDATE SET value = '0'",
            [],
        )?;
        Ok(())
    }
}

/// Resumen logi all-time (HP por dirección/tipo) para el panel de Logros.
#[derive(Debug, Clone, Default, Serialize)]
pub struct LogiSummary {
    pub given_shield: f64,
    pub given_armor: f64,
    pub given_hull: f64,
    pub recv_shield: f64,
    pub recv_armor: f64,
    pub recv_hull: f64,
}

/// Serie mensual de logi para la gráfica del apartado Logis.
#[derive(Debug, Clone, Default, Serialize)]
pub struct LogiSeries {
    pub labels: Vec<String>,
    pub given_shield: Vec<f64>,
    pub given_armor: Vec<f64>,
    pub given_hull: Vec<f64>,
    pub recv_shield: Vec<f64>,
    pub recv_armor: Vec<f64>,
    pub recv_hull: Vec<f64>,
}

/// Fase C — reconstrucción (minería/rateo/viaje) del histórico de gamelog para la vista dedicada.
#[derive(Debug, Clone, Default, Serialize)]
pub struct GamelogRecon {
    pub mining_units: i64, // extraído total = base + crítico (= total ESI)
    pub mining_crit: i64,  // bonus de extracción crítica (Equinox), LOG-ONLY
    pub mining_cycles: i64,
    pub mining_wasted: i64,
    pub top_ores: Vec<MiningOre>,
    pub mining_series: Vec<DayVal>,       // extraído (base+crit) por día
    pub mining_crit_series: Vec<DayVal>,  // crítico por día
    pub mining_waste_series: Vec<DayVal>,
    pub bounty_isk: i64,
    pub bounty_pays: i64,
    pub bounty_series: Vec<DayVal>,
    pub total_jumps: i64,
    pub distinct_systems: i64,
    pub top_systems: Vec<SysVisit>,
    // Combate (LOG-ONLY): daño hecho/recibido, golpes y wrecking ("Destruye") en cada dirección.
    pub combat_dmg_done: i64,
    pub combat_dmg_taken: i64,
    pub combat_shots_done: i64,
    pub combat_shots_taken: i64,
    pub combat_wrecks_done: i64,
    pub combat_wrecks_taken: i64,
    /// DPS: `combat_active_secs` = segundos distintos con daño hecho (tiempo de combate real, muy
    /// por debajo del tiempo de sesión); `combat_peak_dps` = mejor segundo del histórico.
    pub combat_active_secs: i64,
    pub combat_peak_dps: i64,
    pub combat_done_series: Vec<DayVal>,
    pub combat_taken_series: Vec<DayVal>,
    /// Segundos con daño por día (denominador del DPS; el frontend agrega Σdaño/Σsegundos).
    pub combat_secs_series: Vec<DayVal>,
    pub top_rats: Vec<RatDmg>,
}
#[derive(Debug, Clone, Serialize)]
pub struct RatDmg {
    pub rat: String,
    pub dmg: i64,
}
#[derive(Debug, Clone, Serialize)]
pub struct MiningOre {
    pub ore: String,
    pub units: i64,
    pub cycles: i64,
}
#[derive(Debug, Clone, Serialize)]
pub struct DayVal {
    pub date: String,
    pub value: f64,
}
#[derive(Debug, Clone, Serialize)]
pub struct SysVisit {
    pub system: String,
    pub visits: i64,
}

/// Desglose de logi por dimensión (personaje/nave/módulo): fechas + series top-8 por día.
#[derive(Debug, Clone, Default, Serialize)]
pub struct LogiBreakdown {
    pub dates: Vec<String>,
    pub series: Vec<LogiBreakSeries>,
}
#[derive(Debug, Clone, Serialize)]
pub struct LogiBreakSeries {
    pub name: String,
    pub values: Vec<f64>,
}

/// Un piloto del histórico de logi (a quién curaste / de quién recibiste).
#[derive(Debug, Clone, Serialize)]
pub struct LogiPilot {
    pub pilot: String,
    pub hp: f64,
    pub reps: i64,
    pub ship: String,
    pub module: String,
    pub hp_shield: f64,
    pub hp_armor: f64,
    pub hp_hull: f64,
    pub char_id: i64, // resuelto por ESI (nombre→id) para el retrato; 0 = sin resolver/no es PJ
}
