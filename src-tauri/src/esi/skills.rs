//! Skills: skills entrenadas, SP total y cola de entrenamiento. Lectura en vivo (cacheada).

use super::EsiClient;
use crate::db::Db;
use crate::error::AppResult;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub struct SkillsResponse {
    #[serde(default)]
    pub total_sp: i64,
    #[serde(default)]
    pub unallocated_sp: i64,
    #[serde(default)]
    pub skills: Vec<SkillItem>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SkillItem {
    pub skill_id: i64,
    #[serde(default)]
    pub trained_skill_level: i64,
    #[serde(default)]
    pub active_skill_level: i64,
    #[serde(default)]
    pub skillpoints_in_skill: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct QueueItem {
    pub skill_id: i64,
    #[serde(default)]
    pub finished_level: i64,
    #[serde(default)]
    pub finish_date: Option<String>,
    #[serde(default)]
    pub queue_position: i64,
    /// Rellenado por el comando (resolución de nombres). No viene de ESI.
    #[serde(default)]
    pub skill_name: Option<String>,

    // ---- Lo que permite MEDIR el ritmo real en vez de estimarlo (2026-08-26) ----
    // El servidor ya ha hecho la cuenta: cuántos SP faltan para acabar esta entrada y en cuánto
    // tiempo. De ahí sale SP/min REAL, **con los implantes y los boosters ya dentro** — que es
    // justo lo que no podemos modelar (los boosters ESI ni los expone).
    // ⚠️ TODOS opcionales A PROPÓSITO: no doy por hecho que ESI los mande. Si vienen, se mide;
    // si no, `None` y se cae a la fórmula por atributos diciendo que es una estimación.
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub level_start_sp: Option<i64>,
    #[serde(default)]
    pub level_end_sp: Option<i64>,
    #[serde(default)]
    pub training_start_sp: Option<i64>,
}

/// Resumen de skills que devolvemos al frontend.
#[derive(Debug, Clone, Serialize)]
pub struct SkillsSummary {
    pub total_sp: i64,
    pub unallocated_sp: i64,
    pub skill_count: i64,
    pub queue: Vec<QueueItem>,
}

pub async fn skills(
    esi: &EsiClient,
    db: &Db,
    character_id: i64,
    token: &str,
) -> AppResult<SkillsResponse> {
    let path = format!("/characters/{character_id}/skills/");
    esi.get_cached::<SkillsResponse>(db, character_id, &path, Some(token))
        .await
}

pub async fn skillqueue(
    esi: &EsiClient,
    db: &Db,
    character_id: i64,
    token: &str,
) -> AppResult<Vec<QueueItem>> {
    let path = format!("/characters/{character_id}/skillqueue/");
    esi.get_cached::<Vec<QueueItem>>(db, character_id, &path, Some(token))
        .await
}
