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
