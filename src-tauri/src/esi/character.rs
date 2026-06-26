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

#[derive(Debug, Clone, Deserialize)]
pub struct FwCounts {
    #[serde(default)]
    pub yesterday: i64,
    #[serde(default)]
    pub last_week: i64,
    #[serde(default)]
    pub total: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FwStats {
    #[serde(default)]
    pub faction_id: Option<i64>,
    #[serde(default)]
    pub enlisted_on: Option<String>,
    #[serde(default)]
    pub current_rank: Option<i64>,
    #[serde(default)]
    pub highest_rank: Option<i64>,
    #[serde(default)]
    pub kills: Option<FwCounts>,
    #[serde(default)]
    pub victory_points: Option<FwCounts>,
}

/// Stats de Guerra de Facciones del personaje (scope esi-characters.read_fw_stats.v1).
pub async fn fw_stats(
    esi: &EsiClient,
    db: &Db,
    character_id: i64,
    token: &str,
) -> AppResult<FwStats> {
    esi.get_cached::<FwStats>(
        db,
        character_id,
        &format!("/characters/{character_id}/fw/stats/"),
        Some(token),
    )
    .await
}

#[derive(Debug, Clone, Deserialize)]
pub struct Contact {
    pub contact_id: i64,
    #[serde(default)]
    pub contact_type: Option<String>,
    #[serde(default)]
    pub standing: f64,
    #[serde(default)]
    pub is_blocked: Option<bool>,
    #[serde(default)]
    pub is_watched: Option<bool>,
}

/// Contactos personales (scope esi-characters.read_contacts.v1). Página 1 (hasta 1000).
pub async fn contacts(
    esi: &EsiClient,
    db: &Db,
    character_id: i64,
    token: &str,
) -> AppResult<Vec<Contact>> {
    esi.get_cached::<Vec<Contact>>(
        db,
        character_id,
        &format!("/characters/{character_id}/contacts/"),
        Some(token),
    )
    .await
}

#[derive(Debug, Clone, Deserialize)]
pub struct Standing {
    #[serde(default)]
    pub from_id: i64,
    #[serde(default)]
    pub from_type: Option<String>,
    #[serde(default)]
    pub standing: f64,
}

/// Standings con NPC (facciones/corps/agentes) (scope esi-characters.read_standings.v1).
pub async fn standings(
    esi: &EsiClient,
    db: &Db,
    character_id: i64,
    token: &str,
) -> AppResult<Vec<Standing>> {
    esi.get_cached::<Vec<Standing>>(
        db,
        character_id,
        &format!("/characters/{character_id}/standings/"),
        Some(token),
    )
    .await
}
