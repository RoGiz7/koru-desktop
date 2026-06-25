//! Industria: jobs del personaje + mining ledger. Lectura en vivo (cacheada).

use super::EsiClient;
use crate::db::{Db, NameCount};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/* ---------- Industry jobs ---------- */

#[derive(Debug, Clone, Deserialize)]
pub struct JobRaw {
    pub job_id: i64,
    #[serde(default)]
    pub activity_id: i64,
    #[serde(default)]
    pub blueprint_type_id: i64,
    #[serde(default)]
    pub product_type_id: Option<i64>,
    #[serde(default)]
    pub runs: i64,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub end_date: Option<String>,
}

/// Nombre legible de la actividad de industria.
pub fn activity_name(id: i64) -> &'static str {
    match id {
        1 => "Manufacturing",
        3 => "Research TE",
        4 => "Research ME",
        5 => "Copying",
        7 => "Reverse Engineering",
        8 => "Invention",
        9 => "Reactions",
        _ => "Otra",
    }
}

pub async fn fetch_jobs(
    esi: &EsiClient,
    db: &Db,
    character_id: i64,
    token: &str,
) -> AppResult<Vec<JobRaw>> {
    let path = format!("/characters/{character_id}/industry/jobs/?include_completed=false");
    match esi
        .get_cached::<Vec<JobRaw>>(db, character_id, &path, Some(token))
        .await
    {
        Ok(v) => Ok(v),
        Err(AppError::NotFound) => Ok(Vec::new()),
        Err(e) => Err(e),
    }
}

/* ---------- Mining ledger ---------- */

#[derive(Debug, Clone, Deserialize)]
pub struct MiningEntry {
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub solar_system_id: Option<i64>,
    pub type_id: i64,
    #[serde(default)]
    pub quantity: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MiningRow {
    pub date: Option<String>,
    pub system_id: Option<i64>,
    pub type_id: i64,
    pub type_name: Option<String>,
    pub quantity: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MiningSummary {
    pub total_units: i64,
    pub entries: i64,
    pub top_ores: Vec<NameCount>,
    pub recent: Vec<MiningRow>,
}

/// Sincroniza el mining ledger de ESI (90 días) a la BD local, acumulando histórico.
/// Devuelve cuántas entradas se guardaron/actualizaron.
pub async fn sync_mining(
    esi: &EsiClient,
    db: &Db,
    character_id: i64,
    token: &str,
) -> AppResult<usize> {
    let mut count = 0usize;
    for page in 1..=100u32 {
        let path = format!("/characters/{character_id}/mining/?page={page}");
        let items: Vec<MiningEntry> =
            match esi.get_cached(db, character_id, &path, Some(token)).await {
                Ok(v) => v,
                Err(AppError::NotFound) => break,
                Err(_) => break,
            };
        if items.is_empty() {
            break;
        }
        let n = items.len();
        for e in &items {
            if let (Some(date), Some(sid)) = (e.date.as_deref(), e.solar_system_id) {
                db.upsert_mining(character_id, date, sid, e.type_id, e.quantity)?;
                count += 1;
            }
        }
        if n < 1000 {
            break;
        }
    }
    db.touch_last_sync(character_id)?;
    Ok(count)
}

/// Agrega el mining ledger por SISTEMA (cantidad total minada por sistema), para el mapa.
pub async fn mining_by_system(
    esi: &EsiClient,
    db: &Db,
    character_id: i64,
    token: &str,
) -> AppResult<HashMap<i64, i64>> {
    let mut by_sys: HashMap<i64, i64> = HashMap::new();
    for page in 1..=100u32 {
        let path = format!("/characters/{character_id}/mining/?page={page}");
        let items: Vec<MiningEntry> =
            match esi.get_cached(db, character_id, &path, Some(token)).await {
                Ok(v) => v,
                Err(AppError::NotFound) => break,
                Err(_) => break,
            };
        if items.is_empty() {
            break;
        }
        let n = items.len();
        for e in &items {
            if let Some(sid) = e.solar_system_id {
                *by_sys.entry(sid).or_insert(0) += e.quantity;
            }
        }
        if n < 1000 {
            break;
        }
    }
    Ok(by_sys)
}

/// Descarga el mining ledger (paginado) y agrega por tipo de mineral.
pub async fn mining_summary(
    esi: &EsiClient,
    db: &Db,
    character_id: i64,
    token: &str,
) -> AppResult<MiningSummary> {
    let mut all: Vec<MiningEntry> = Vec::new();
    for page in 1..=100u32 {
        let path = format!("/characters/{character_id}/mining/?page={page}");
        let items: Vec<MiningEntry> =
            match esi.get_cached(db, character_id, &path, Some(token)).await {
                Ok(v) => v,
                Err(AppError::NotFound) => break,
                Err(e) => {
                    eprintln!("mining página {page} falló: {e}");
                    break;
                }
            };
        if items.is_empty() {
            break;
        }
        let n = items.len();
        all.extend(items);
        if n < 1000 {
            break;
        }
    }

    let mut by_type: HashMap<i64, i64> = HashMap::new();
    let mut total_units = 0i64;
    for e in &all {
        *by_type.entry(e.type_id).or_insert(0) += e.quantity;
        total_units += e.quantity;
    }

    let mut top: Vec<NameCount> = by_type
        .into_iter()
        .map(|(id, count)| NameCount {
            id,
            count,
            name: None,
            region: None,
        })
        .collect();
    top.sort_by(|a, b| b.count.cmp(&a.count));
    top.truncate(15);

    // Ordenar entradas por fecha desc y quedarnos con las 50 recientes.
    all.sort_by(|a, b| b.date.cmp(&a.date));
    let recent: Vec<MiningRow> = all
        .iter()
        .take(50)
        .map(|e| MiningRow {
            date: e.date.clone(),
            system_id: e.solar_system_id,
            type_id: e.type_id,
            type_name: None,
            quantity: e.quantity,
        })
        .collect();

    Ok(MiningSummary {
        total_units,
        entries: all.len() as i64,
        top_ores: top,
        recent,
    })
}
