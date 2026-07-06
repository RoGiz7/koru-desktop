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
use serde::Serialize;

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

/// Un proyecto personal (meta propia del usuario) con su valor ACTUAL calculado del histórico local.
#[derive(Debug, Clone, Serialize)]
pub struct PersonalProject {
    pub id: i64,
    pub name: String,
    pub metric: String,
    pub target: f64,
    pub current: f64,
}

impl Db {
    /// Crea un proyecto personal (subject_id = character_id, o 0 = global). Devuelve su id.
    pub fn create_personal_project(
        &self,
        subject_id: i64,
        name: &str,
        metric: &str,
        target: f64,
    ) -> AppResult<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO personal_projects (subject_id, name, metric, target, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![subject_id, name, metric, target, chrono::Utc::now().to_rfc3339()],
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
        // Leemos las filas (y soltamos el statement) antes de calcular cada valor.
        let rows: Vec<(i64, String, String, f64)> = {
            let mut stmt = conn.prepare(
                "SELECT id, name, metric, target FROM personal_projects WHERE subject_id = ?1 ORDER BY id",
            )?;
            let it = stmt.query_map([subject_id], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, f64>(3)?,
                ))
            })?;
            it.flatten().collect()
        };
        let mut out = Vec::new();
        for (id, name, metric, target) in rows {
            let sql: Option<String> = match metric.as_str() {
                "kills" => Some(format!("SELECT COUNT(*) FROM killmails WHERE is_loss=0 {who}")),
                "damage" => Some(format!("SELECT COALESCE(SUM(char_damage),0) FROM killmails WHERE is_loss=0 {who}")),
                "isk_destruido" => Some(format!("SELECT COALESCE(SUM(isk_value),0) FROM killmails WHERE is_loss=0 {who}")),
                "final_blows" => Some(format!("SELECT COUNT(*) FROM killmails WHERE is_loss=0 AND final_blow=1 {who}")),
                "solo_kills" => Some(format!("SELECT COUNT(*) FROM killmails WHERE is_loss=0 AND solo=1 {who}")),
                "sistemas" => Some(format!("SELECT COUNT(DISTINCT system_id) FROM killmails WHERE is_loss=0 AND system_id IS NOT NULL {who}")),
                "rateo" => Some(format!("SELECT COALESCE(SUM(amount),0) FROM wallet_journal WHERE ref_type IN ('bounty_prizes','ess_escrow_transfer') AND amount>0 {who}")),
                "mineria" => Some(format!("SELECT COALESCE(SUM(ml.quantity*COALESCE(mp.average_price,0)),0) FROM mining_ledger ml LEFT JOIN market_prices mp ON mp.type_id=ml.type_id WHERE 1=1 {who}")),
                "patrimonio" => Some(format!("SELECT COALESCE(MAX(day_total),0) FROM (SELECT date, SUM(total) day_total FROM networth_snapshots WHERE 1=1 {who} GROUP BY date)")),
                _ => None,
            };
            let current = sql
                .map(|s| conn.query_row(&s, [], |r| r.get::<_, f64>(0)).unwrap_or(0.0))
                .unwrap_or(0.0);
            out.push(PersonalProject { id, name, metric, target, current });
        }
        Ok(out)
    }
}
