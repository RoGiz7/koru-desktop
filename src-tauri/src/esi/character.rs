//! Detalle de personaje: info pública, atributos, implantes y jump clones (header rico).

use super::EsiClient;
use crate::db::Db;
use crate::error::AppResult;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct PublicInfo {
    #[serde(default)]
    pub birthday: Option<String>,
    #[serde(default)]
    pub gender: Option<String>,
    #[serde(default)]
    pub security_status: Option<f64>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub race_id: Option<i64>,
    #[serde(default)]
    pub bloodline_id: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Attributes {
    #[serde(default)]
    pub charisma: i64,
    #[serde(default)]
    pub intelligence: i64,
    #[serde(default)]
    pub memory: i64,
    #[serde(default)]
    pub perception: i64,
    #[serde(default)]
    pub willpower: i64,
    #[serde(default)]
    pub bonus_remaps: Option<i64>,
    #[serde(default)]
    pub last_remap_date: Option<String>,
    #[serde(default)]
    pub accrued_remap_cooldown_date: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HomeLocation {
    #[serde(default)]
    pub location_id: Option<i64>,
    #[serde(default)]
    pub location_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JumpClone {
    #[serde(default)]
    pub location_id: i64,
    #[serde(default)]
    pub implants: Vec<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ClonesResponse {
    #[serde(default)]
    pub home_location: Option<HomeLocation>,
    #[serde(default)]
    pub jump_clones: Vec<JumpClone>,
}

/// Info pública del personaje (sin token).
pub async fn public_info(esi: &EsiClient, db: &Db, character_id: i64) -> AppResult<PublicInfo> {
    esi.get_cached::<PublicInfo>(db, character_id, &format!("/characters/{character_id}/"), None)
        .await
}

/// Atributos (scope esi-skills.read_skills.v1).
pub async fn attributes(
    esi: &EsiClient,
    db: &Db,
    character_id: i64,
    token: &str,
) -> AppResult<Attributes> {
    esi.get_cached::<Attributes>(
        db,
        character_id,
        &format!("/characters/{character_id}/attributes/"),
        Some(token),
    )
    .await
}

/// Implantes activos = lista de type_id (scope esi-clones.read_implants.v1).
pub async fn implants(
    esi: &EsiClient,
    db: &Db,
    character_id: i64,
    token: &str,
) -> AppResult<Vec<i64>> {
    esi.get_cached::<Vec<i64>>(
        db,
        character_id,
        &format!("/characters/{character_id}/implants/"),
        Some(token),
    )
    .await
}

/// Jump clones + ubicación de origen (scope esi-clones.read_clones.v1).
pub async fn clones(
    esi: &EsiClient,
    db: &Db,
    character_id: i64,
    token: &str,
) -> AppResult<ClonesResponse> {
    esi.get_cached::<ClonesResponse>(
        db,
        character_id,
        &format!("/characters/{character_id}/clones/"),
        Some(token),
    )
    .await
}
