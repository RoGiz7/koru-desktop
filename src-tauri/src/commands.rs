//! Comandos Tauri expuestos al frontend.

use crate::config;
use crate::db::{
    CharacterRow, Db, FinancialSummary, NetworthPoint, PvpActivity, PvpStats, PvpTrendPoint,
    RattingDetail, WalletStats, WalletTrendPoint,
};
use crate::db::{NameCount, SystemActivity, TopKill};
use crate::error::{AppError, AppResult};
use crate::esi::assets::AssetsSummary;
use crate::esi::industry::{JobRaw, MiningRow, MiningSummary};
use crate::esi::killmails::KillmailDetail;
use crate::esi::skills::SkillsSummary;
use crate::esi::{assets, industry, killmails, market, skills, wallet, EsiClient};
use crate::sso::{self, LoginOutcome, TokenManager};
use serde::Serialize;
use std::collections::HashSet;
use tauri::{Emitter, State, Window};

/// Estado global de la app, gestionado por Tauri.
pub struct AppState {
    pub db: Db,
    pub tokens: TokenManager,
    pub esi: EsiClient,
    /// Bandera para cancelar una sincronización en curso.
    pub cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

/// Cancela la sincronización en curso (la marca; el bucle la detecta y para limpio).
#[tauri::command]
pub fn cancel_sync(state: State<'_, AppState>) {
    state
        .cancel
        .store(true, std::sync::atomic::Ordering::Relaxed);
}

/// Resultado de una auto-sincronización.
#[derive(Debug, Serialize)]
pub struct AutoSyncResult {
    pub killmails: usize,
    pub wallet: usize,
    pub mining: usize,
    pub prices: usize,
    pub snapshots: usize,
}

/// Sincroniza incrementalmente lo ligero de todos los personajes (killmails recientes,
/// wallet, minería). Respeta la caché ESI (no re-descarga antes del Expires), así que es
/// seguro llamarla al abrir y periódicamente. Para histórico completo de PvP, usar el botón.
#[tauri::command]
pub async fn auto_sync(state: State<'_, AppState>) -> AppResult<AutoSyncResult> {
    let mut res = AutoSyncResult {
        killmails: 0,
        wallet: 0,
        mining: 0,
        prices: 0,
        snapshots: 0,
    };

    // Precios de mercado primero (público, cacheado ≈1h) para valorar assets en los snapshots.
    if let Ok(n) = market::sync_prices(&state.esi, &state.db).await {
        res.prices = n;
    }

    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    for c in state.db.list_characters()? {
        let valid = match state
            .tokens
            .access_token(state.esi.http(), c.character_id)
            .await
        {
            Ok(v) => v,
            Err(_) => continue,
        };
        let has = |scope: &str| c.scopes.iter().any(|s| s == scope);
        if has("esi-killmails.read_killmails.v1") {
            if let Ok(n) =
                killmails::sync(&state.esi, &state.db, c.character_id, &valid.access_token).await
            {
                res.killmails += n;
            }
        }
        if has("esi-wallet.read_character_wallet.v1") {
            if let Ok(n) = wallet::sync_journal(
                &state.esi,
                &state.db,
                c.character_id,
                &valid.access_token,
                50,
            )
            .await
            {
                res.wallet += n;
            }
            let _ = wallet::sync_transactions(
                &state.esi,
                &state.db,
                c.character_id,
                &valid.access_token,
            )
            .await;
        }
        if has("esi-industry.read_character_mining.v1") {
            if let Ok(n) =
                industry::sync_mining(&state.esi, &state.db, c.character_id, &valid.access_token)
                    .await
            {
                res.mining += n;
            }
        }

        // Snapshot de patrimonio del día: liquid (wallet) + valor estimado de assets.
        let mut liquid = 0.0;
        let mut asset_value = 0.0;
        let mut have_data = false;
        if has("esi-wallet.read_character_wallet.v1") {
            if let Ok(b) =
                wallet::balance(&state.esi, &state.db, c.character_id, &valid.access_token).await
            {
                liquid = b;
                have_data = true;
            }
        }
        if has("esi-assets.read_assets.v1") {
            if let Ok(s) =
                assets::summary(&state.esi, &state.db, c.character_id, &valid.access_token).await
            {
                asset_value = s.est_value;
                have_data = true;
            }
        }
        if have_data
            && state
                .db
                .insert_networth_snapshot(c.character_id, &today, liquid, asset_value)
                .is_ok()
        {
            res.snapshots += 1;
        }
    }
    Ok(res)
}

/// Sincroniza precios de mercado (público) bajo demanda. Devuelve nº de tipos guardados.
#[tauri::command]
pub async fn sync_market(state: State<'_, AppState>) -> AppResult<usize> {
    market::sync_prices(&state.esi, &state.db).await
}

/// Vista de patrimonio: valor actual (último snapshot) + serie histórica.
#[derive(Debug, Serialize)]
pub struct NetworthView {
    pub liquid: f64,
    pub asset_value: f64,
    pub total: f64,
    pub series: Vec<NetworthPoint>,
    /// Nº de precios de mercado en la BD (0 = aún sin sincronizar; assets sin valorar).
    pub prices_loaded: i64,
}

fn networth_view(series: Vec<NetworthPoint>, prices_loaded: i64) -> NetworthView {
    let last = series.last();
    NetworthView {
        liquid: last.map(|p| p.liquid).unwrap_or(0.0),
        asset_value: last.map(|p| p.asset_value).unwrap_or(0.0),
        total: last.map(|p| p.total).unwrap_or(0.0),
        series,
        prices_loaded,
    }
}

/// Patrimonio de un personaje (último valor + evolución).
#[tauri::command]
pub fn get_networth(character_id: i64, state: State<'_, AppState>) -> AppResult<NetworthView> {
    let series = state.db.networth_history(character_id)?;
    let prices = state.db.prices_count().unwrap_or(0);
    Ok(networth_view(series, prices))
}

/// Patrimonio GLOBAL (suma de todos los personajes por día).
#[tauri::command]
pub fn get_networth_global(state: State<'_, AppState>) -> AppResult<NetworthView> {
    let series = state.db.networth_history_global()?;
    let prices = state.db.prices_count().unwrap_or(0);
    Ok(networth_view(series, prices))
}

/// Devuelve los scopes que corresponden a un nombre de feature.
fn scopes_for_feature(feature: &str) -> Vec<String> {
    let list: &[&str] = match feature {
        "pvp" => config::scopes::PVP,
        "wallet" => config::scopes::WALLET,
        "skills" => config::scopes::SKILLS,
        "assets" => config::scopes::ASSETS,
        "location" => config::scopes::LOCATION,
        "core" => {
            return config::scopes::core_v1()
                .iter()
                .map(|s| s.to_string())
                .collect()
        }
        _ => &[],
    };
    list.iter().map(|s| s.to_string()).collect()
}

/// Inicia el flujo de login para una feature (o "identity" para 0 scopes, o "core" para el set v1).
#[tauri::command]
pub async fn login(feature: String, state: State<'_, AppState>) -> AppResult<LoginOutcome> {
    let scopes = if feature == "identity" {
        Vec::new()
    } else {
        scopes_for_feature(&feature)
    };

    let outcome = sso::login(scopes).await?;
    state.db.upsert_character(
        outcome.character_id,
        &outcome.character_name,
        &outcome.scopes,
    )?;
    Ok(outcome)
}

/// Lista los personajes guardados.
#[tauri::command]
pub fn list_characters(state: State<'_, AppState>) -> AppResult<Vec<CharacterRow>> {
    state.db.list_characters()
}

/// Tarjeta enriquecida de un personaje para la vista de rejilla.
#[derive(Debug, Serialize)]
pub struct CharacterCard {
    pub character_id: i64,
    pub name: String,
    pub corporation_id: Option<i64>,
    pub corporation_name: Option<String>,
    pub alliance_id: Option<i64>,
    pub alliance_name: Option<String>,
    pub system_id: Option<i64>,
    pub system_name: Option<String>,
    pub scopes: Vec<String>,
}

#[derive(serde::Deserialize)]
struct PublicChar {
    #[serde(default)]
    corporation_id: Option<i64>,
    #[serde(default)]
    alliance_id: Option<i64>,
}

#[derive(serde::Deserialize)]
struct LocationInfo {
    #[serde(default)]
    solar_system_id: Option<i64>,
}

/// Tarjetas de todos los personajes con corp/alianza y sistema actual (si hay scope).
#[tauri::command]
pub async fn get_character_cards(state: State<'_, AppState>) -> AppResult<Vec<CharacterCard>> {
    let chars = state.db.list_characters()?;
    let mut cards: Vec<CharacterCard> = Vec::new();
    let mut ids: HashSet<i64> = HashSet::new();

    for c in &chars {
        // Info pública del personaje (corp/alianza). Sin token.
        let info = state
            .esi
            .get_cached::<PublicChar>(
                &state.db,
                c.character_id,
                &format!("/characters/{}/", c.character_id),
                None,
            )
            .await
            .ok();
        let corporation_id = info.as_ref().and_then(|i| i.corporation_id);
        let alliance_id = info.as_ref().and_then(|i| i.alliance_id);

        // Sistema actual (requiere scope de localización). Best-effort.
        let mut system_id = None;
        if c.scopes
            .iter()
            .any(|s| s == "esi-location.read_location.v1")
        {
            if let Ok(valid) = state
                .tokens
                .access_token(state.esi.http(), c.character_id)
                .await
            {
                if let Ok(loc) = state
                    .esi
                    .get_cached::<LocationInfo>(
                        &state.db,
                        c.character_id,
                        &format!("/characters/{}/location/", c.character_id),
                        Some(&valid.access_token),
                    )
                    .await
                {
                    system_id = loc.solar_system_id;
                }
            }
        }

        for x in [corporation_id, alliance_id, system_id]
            .into_iter()
            .flatten()
        {
            ids.insert(x);
        }

        cards.push(CharacterCard {
            character_id: c.character_id,
            name: c.name.clone(),
            corporation_id,
            corporation_name: None,
            alliance_id,
            alliance_name: None,
            system_id,
            system_name: None,
            scopes: c.scopes.clone(),
        });
    }

    if let Ok(names) = state
        .esi
        .resolve_names(&ids.into_iter().collect::<Vec<_>>())
        .await
    {
        for card in cards.iter_mut() {
            card.corporation_name = card.corporation_id.and_then(|x| names.get(&x).cloned());
            card.alliance_name = card.alliance_id.and_then(|x| names.get(&x).cloned());
            card.system_name = card.system_id.and_then(|x| names.get(&x).cloned());
        }
    }

    Ok(cards)
}

/// Cierra sesión de un personaje: borra su refresh token del keyring y su fila de la BD.
#[tauri::command]
pub fn logout(character_id: i64, state: State<'_, AppState>) -> AppResult<()> {
    sso::store::delete_refresh_token(character_id)?;
    state.db.delete_character(character_id)?;
    Ok(())
}

/// Prueba de extremo a extremo: refresca el token de un personaje y devuelve su nombre.
#[tauri::command]
pub async fn whoami(character_id: i64, state: State<'_, AppState>) -> AppResult<String> {
    let valid = state
        .tokens
        .access_token(state.esi.http(), character_id)
        .await?;
    Ok(valid.claims.name)
}

/// Sincroniza los killmails recientes del personaje desde ESI/zKillboard.
/// Requiere el scope esi-killmails.read_killmails.v1. Devuelve cuántos nuevos se guardaron.
#[tauri::command]
pub async fn sync_killmails(character_id: i64, state: State<'_, AppState>) -> AppResult<usize> {
    let valid = state
        .tokens
        .access_token(state.esi.http(), character_id)
        .await?;

    // Comprobamos que el token tenga el scope necesario antes de llamar.
    if !valid
        .claims
        .scp
        .iter()
        .any(|s| s == "esi-killmails.read_killmails.v1")
    {
        return Err(AppError::OAuth(
            "este personaje no concedió el scope de killmails. Inicia sesión con la feature 'PvP'."
                .into(),
        ));
    }

    killmails::sync(&state.esi, &state.db, character_id, &valid.access_token).await
}

/// Sincroniza el HISTORIAL COMPLETO desde zKillboard (no requiere scope). Emite eventos
/// `km_progress` con el número de killmails procesados para mostrar progreso en la UI.
#[tauri::command]
pub async fn sync_killmails_full(
    character_id: i64,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<usize> {
    state
        .cancel
        .store(false, std::sync::atomic::Ordering::Relaxed);
    let win = window.clone();
    killmails::sync_full(
        &state.esi,
        &state.db,
        character_id,
        100,
        &state.cancel,
        move |n, page| {
            let _ = win.emit("km_progress", (n, page));
        },
    )
    .await
}

/// Assets agregados por sistema, para el overlay "Tus assets" del mapa.
#[derive(Debug, Serialize)]
pub struct AssetSystem {
    pub system_id: i64,
    pub count: i64,
}

#[tauri::command]
pub async fn get_assets_map(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<AssetSystem>> {
    let token = token_with_scope(
        &state,
        character_id,
        "esi-assets.read_assets.v1",
        "Assets / industria",
    )
    .await?;
    let m = assets::by_system(&state.esi, &state.db, character_id, &token).await?;
    Ok(m.into_iter()
        .map(|(system_id, count)| AssetSystem { system_id, count })
        .collect())
}

#[tauri::command]
pub async fn get_assets_map_global(state: State<'_, AppState>) -> AppResult<Vec<AssetSystem>> {
    use std::collections::HashMap;
    let mut acc: HashMap<i64, i64> = HashMap::new();
    for c in state.db.list_characters()? {
        if !c.scopes.iter().any(|s| s == "esi-assets.read_assets.v1") {
            continue;
        }
        let valid = match state
            .tokens
            .access_token(state.esi.http(), c.character_id)
            .await
        {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Ok(m) =
            assets::by_system(&state.esi, &state.db, c.character_id, &valid.access_token).await
        {
            for (sid, n) in m {
                *acc.entry(sid).or_insert(0) += n;
            }
        }
    }
    Ok(acc
        .into_iter()
        .map(|(system_id, count)| AssetSystem { system_id, count })
        .collect())
}

/// Sincroniza el mining ledger del personaje a la BD local (acumula histórico).
#[tauri::command]
pub async fn sync_mining(character_id: i64, state: State<'_, AppState>) -> AppResult<usize> {
    let token = token_with_scope(
        &state,
        character_id,
        "esi-industry.read_character_mining.v1",
        "Assets / industria",
    )
    .await?;
    industry::sync_mining(&state.esi, &state.db, character_id, &token).await
}

/// Minería por sistema (desde la BD acumulada), para el overlay "Tu minería".
#[tauri::command]
pub fn get_mining_map(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<AssetSystem>> {
    Ok(state
        .db
        .mining_by_system(Some(character_id))?
        .into_iter()
        .map(|(system_id, count)| AssetSystem { system_id, count })
        .collect())
}

#[tauri::command]
pub fn get_mining_map_global(state: State<'_, AppState>) -> AppResult<Vec<AssetSystem>> {
    Ok(state
        .db
        .mining_by_system(None)?
        .into_iter()
        .map(|(system_id, count)| AssetSystem { system_id, count })
        .collect())
}

/// Kills por sistema en la última hora (overlay "en vivo"). ESI público, 1 llamada.
#[derive(Debug, Serialize, serde::Deserialize)]
pub struct SystemKills {
    pub system_id: i64,
    #[serde(default)]
    pub ship_kills: i64,
    #[serde(default)]
    pub pod_kills: i64,
    #[serde(default)]
    pub npc_kills: i64,
}

#[tauri::command]
pub async fn get_system_kills(state: State<'_, AppState>) -> AppResult<Vec<SystemKills>> {
    state
        .esi
        .get_cached::<Vec<SystemKills>>(&state.db, 0, "/universe/system_kills/", None)
        .await
}

/// Jumps por sistema en la última hora (overlay "en vivo"). ESI público, 1 llamada.
#[derive(Debug, Serialize, serde::Deserialize)]
pub struct SystemJumps {
    pub system_id: i64,
    #[serde(default)]
    pub ship_jumps: i64,
}

#[tauri::command]
pub async fn get_system_jumps(state: State<'_, AppState>) -> AppResult<Vec<SystemJumps>> {
    state
        .esi
        .get_cached::<Vec<SystemJumps>>(&state.db, 0, "/universe/system_jumps/", None)
        .await
}

/// --- Soberanía (ocupación por sistema) ---
#[derive(serde::Deserialize)]
struct SovResp {
    #[serde(default)]
    solar_systems: Vec<SovSys>,
}
#[derive(serde::Deserialize)]
struct SovSys {
    solar_system_id: i64,
    #[serde(default)]
    claim: Option<SovClaim>,
}
#[derive(serde::Deserialize)]
struct SovClaim {
    #[serde(default)]
    alliance: Option<AllianceObj>,
    #[serde(default)]
    corporation: Option<CorpObj>,
    #[serde(default)]
    faction: Option<FacObj>,
}
#[derive(serde::Deserialize)]
struct AllianceObj {
    #[serde(default)]
    alliance_id: i64,
}
#[derive(serde::Deserialize)]
struct CorpObj {
    #[serde(default)]
    corporation_id: i64,
}
#[derive(serde::Deserialize)]
struct FacObj {
    #[serde(default)]
    faction_id: i64,
}
#[derive(serde::Deserialize)]
struct Faction {
    faction_id: i64,
    name: String,
}

#[derive(Debug, Serialize)]
pub struct SovSystem {
    pub system_id: i64,
    pub owner_id: Option<i64>,
    pub kind: String, // "alliance" | "corporation" | "faction" | "none"
    pub owner_name: Option<String>,
}

/// Soberanía por sistema (ocupación). Ruta pública `/sovereignty/systems`.
#[tauri::command]
pub async fn get_sov_systems(state: State<'_, AppState>) -> AppResult<Vec<SovSystem>> {
    let resp: SovResp = state
        .esi
        .get_cached(&state.db, 0, "/sovereignty/systems", None)
        .await?;

    let mut out: Vec<SovSystem> = Vec::new();
    let mut name_ids: HashSet<i64> = HashSet::new(); // alianzas + corps
    let mut faction_ids: HashSet<i64> = HashSet::new();

    for s in resp.solar_systems {
        let (owner_id, kind) = match &s.claim {
            Some(c) => {
                if let Some(a) = &c.alliance {
                    if a.alliance_id != 0 {
                        name_ids.insert(a.alliance_id);
                        (Some(a.alliance_id), "alliance")
                    } else {
                        (None, "none")
                    }
                } else if let Some(co) = &c.corporation {
                    if co.corporation_id != 0 {
                        name_ids.insert(co.corporation_id);
                        (Some(co.corporation_id), "corporation")
                    } else {
                        (None, "none")
                    }
                } else if let Some(f) = &c.faction {
                    if f.faction_id != 0 {
                        faction_ids.insert(f.faction_id);
                        (Some(f.faction_id), "faction")
                    } else {
                        (None, "none")
                    }
                } else {
                    (None, "none")
                }
            }
            None => (None, "none"),
        };
        out.push(SovSystem {
            system_id: s.solar_system_id,
            owner_id,
            kind: kind.to_string(),
            owner_name: None,
        });
    }

    // Nombres: alianzas/corps por /universe/names; facciones por /universe/factions.
    let names = state
        .esi
        .resolve_names(&name_ids.into_iter().collect::<Vec<_>>())
        .await
        .unwrap_or_default();
    let mut fac_names: std::collections::HashMap<i64, String> = std::collections::HashMap::new();
    if !faction_ids.is_empty() {
        if let Ok(facs) = state
            .esi
            .get_cached::<Vec<Faction>>(&state.db, 0, "/universe/factions", None)
            .await
        {
            for f in facs {
                fac_names.insert(f.faction_id, f.name);
            }
        }
    }
    for s in out.iter_mut() {
        if let Some(id) = s.owner_id {
            s.owner_name = if s.kind == "faction" {
                fac_names.get(&id).cloned()
            } else {
                names.get(&id).cloned()
            };
        }
    }
    Ok(out)
}

/// Un sistema de Guerra de Facciones. Campos tal cual los devuelve ESI (snake_case),
/// que el frontend lee directamente. `owner_faction_id` es uno de los 4 imperios.
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct FwSystem {
    pub solar_system_id: i64,
    #[serde(default)]
    pub owner_faction_id: i64,
    #[serde(default)]
    pub occupier_faction_id: i64,
    #[serde(default)]
    pub contested: Option<String>,
    #[serde(default)]
    pub victory_points: i64,
    #[serde(default)]
    pub victory_points_threshold: i64,
}

/// Sistemas de Guerra de Facciones. Ruta PÚBLICA `/fw/systems/` (sin token ni scopes).
/// El frontend mapea `owner_faction_id` a color/nombre y usa `contested` para la intensidad.
#[tauri::command]
pub async fn get_fw_systems(state: State<'_, AppState>) -> AppResult<Vec<FwSystem>> {
    let systems: Vec<FwSystem> = state
        .esi
        .get_cached(&state.db, 0, "/fw/systems/", None)
        .await?;
    Ok(systems)
}

/// Una incursión activa (de Sansha). Campos tal cual los devuelve ESI; el frontend usa
/// `infested_solar_systems` (sistemas a resaltar), `staging_solar_system_id` y `state`/`influence`.
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct Incursion {
    #[serde(default)]
    pub constellation_id: i64,
    #[serde(default)]
    pub faction_id: i64,
    #[serde(default)]
    pub has_boss: bool,
    #[serde(default)]
    pub infested_solar_systems: Vec<i64>,
    #[serde(default)]
    pub influence: f64,
    #[serde(default)]
    pub staging_solar_system_id: i64,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(rename = "type", default)]
    pub kind: Option<String>,
}

/// Incursiones activas. Ruta PÚBLICA `/incursions` (sin token ni scopes).
#[tauri::command]
pub async fn get_incursions(state: State<'_, AppState>) -> AppResult<Vec<Incursion>> {
    let inc: Vec<Incursion> = state
        .esi
        .get_cached(&state.db, 0, "/incursions", None)
        .await?;
    Ok(inc)
}

/// Estado del servidor Tranquility (público `/status/`): nº de jugadores online, versión, VIP.
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct ServerStatus {
    #[serde(default)]
    pub players: i64,
    #[serde(default)]
    pub server_version: String,
    #[serde(default)]
    pub start_time: Option<String>,
    #[serde(default)]
    pub vip: bool,
}

/// Estado de TQ. Si el servidor está caído, `/status/` falla → el frontend lo trata como offline.
#[tauri::command]
pub async fn get_server_status(state: State<'_, AppState>) -> AppResult<ServerStatus> {
    let s: ServerStatus = state.esi.get_cached(&state.db, 0, "/status/", None).await?;
    Ok(s)
}

/// Mapa PvP de un personaje: actividad por sistema (k-space). Las coordenadas/seguridad/nombre
/// los resuelve el frontend desde el SDE local (neweden.json) — sin llamadas a ESI.
#[tauri::command]
pub async fn get_pvp_map(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<SystemActivity>> {
    let activity = state.db.systems_activity(character_id)?;
    Ok(activity
        .into_iter()
        .filter(|a| (30_000_000..=30_999_999).contains(&a.system_id))
        .collect())
}

/// Mapa PvP global (todos los personajes).
#[tauri::command]
pub async fn get_pvp_map_global(state: State<'_, AppState>) -> AppResult<Vec<SystemActivity>> {
    let activity = state.db.systems_activity_global()?;
    Ok(activity
        .into_iter()
        .filter(|a| (30_000_000..=30_999_999).contains(&a.system_id))
        .collect())
}

/// Reprocesa los killmails ya guardados para rellenar daño/final blow/top damage/nave víctima
/// desde el detalle cacheado (sin red). Emite `reprocess_progress`.
#[tauri::command]
pub async fn reprocess_killmails(window: Window, state: State<'_, AppState>) -> AppResult<usize> {
    let win = window.clone();
    killmails::reprocess(&state.db, move |d| {
        let _ = win.emit("reprocess_progress", d);
    })
}

/// Detalle de rateo (bounties + ESS) de un personaje (PvE): sistema, ratas, buckets.
#[tauri::command]
pub async fn get_ratting(character_id: i64, state: State<'_, AppState>) -> AppResult<RattingDetail> {
    state.db.ratting_detail(Some(character_id))
}

/// Detalle de rateo global (todos los personajes).
#[tauri::command]
pub async fn get_ratting_global(state: State<'_, AppState>) -> AppResult<RattingDetail> {
    state.db.ratting_detail(None)
}

/// Devuelve "YYYY-MM" del mes anterior a un "YYYY-MM" dado.
fn prev_month(ym: &str) -> String {
    let y: i32 = ym.get(0..4).and_then(|s| s.parse().ok()).unwrap_or(2026);
    let m: u32 = ym.get(5..7).and_then(|s| s.parse().ok()).unwrap_or(1);
    if m <= 1 {
        format!("{:04}-12", y - 1)
    } else {
        format!("{:04}-{:02}", y, m - 1)
    }
}

/// Periodos (YYYY-MM) con movimientos, de un personaje.
#[tauri::command]
pub async fn get_summary_periods(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<String>> {
    state.db.summary_periods(Some(character_id))
}

/// Periodos (YYYY-MM) con movimientos, global.
#[tauri::command]
pub async fn get_summary_periods_global(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    state.db.summary_periods(None)
}

/// Resumen financiero (ingresos/gastos por categoría + vs anterior) de un personaje.
#[tauri::command]
pub async fn get_summary(
    character_id: i64,
    period: String,
    state: State<'_, AppState>,
) -> AppResult<FinancialSummary> {
    let prev = prev_month(&period);
    state
        .db
        .financial_summary(Some(character_id), &period, &prev)
}

/// Resumen financiero global (todos los personajes).
#[tauri::command]
pub async fn get_summary_global(
    period: String,
    state: State<'_, AppState>,
) -> AppResult<FinancialSummary> {
    let prev = prev_month(&period);
    state.db.financial_summary(None, &period, &prev)
}

/// Entrada de journal con TODOS los campos relevantes (para inspeccionar qué expone ESI).
#[derive(Debug, Clone, serde::Deserialize)]
struct JournalFull {
    #[serde(default)]
    ref_type: Option<String>,
    #[serde(default)]
    amount: Option<f64>,
    #[serde(default)]
    date: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    context_id: Option<i64>,
    #[serde(default)]
    context_id_type: Option<String>,
    #[serde(default)]
    first_party_id: Option<i64>,
    #[serde(default)]
    second_party_id: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct JournalSample {
    pub ref_type: String,
    pub amount: f64,
    pub date: Option<String>,
    pub description: Option<String>,
    pub reason: Option<String>,
    pub context_id: Option<i64>,
    pub context_id_type: Option<String>,
    pub first_party_id: Option<i64>,
    pub second_party_id: Option<i64>,
}

/// DEBUG: devuelve unas entradas reales de bounty_prizes / ess_escrow_transfer con todos los campos,
/// para ver qué expone ESI (sistema en context_id, nº de ratas en description/reason, etc.).
#[tauri::command]
pub async fn inspect_ratting_journal(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<JournalSample>> {
    let token = token_with_scope(
        &state,
        character_id,
        "esi-wallet.read_character_wallet.v1",
        "Wallet",
    )
    .await?;
    let mut out: Vec<JournalSample> = Vec::new();
    for page in 1..=10u32 {
        let entries: Vec<JournalFull> = match state
            .esi
            .get_cached(
                &state.db,
                character_id,
                &format!("/characters/{character_id}/wallet/journal/?page={page}"),
                Some(&token),
            )
            .await
        {
            Ok(e) => e,
            Err(_) => break,
        };
        if entries.is_empty() {
            break;
        }
        for e in entries {
            let rt = e.ref_type.clone().unwrap_or_default();
            if (rt == "bounty_prizes" || rt == "ess_escrow_transfer") && out.len() < 16 {
                out.push(JournalSample {
                    ref_type: rt,
                    amount: e.amount.unwrap_or(0.0),
                    date: e.date,
                    description: e.description,
                    reason: e.reason,
                    context_id: e.context_id,
                    context_id_type: e.context_id_type,
                    first_party_id: e.first_party_id,
                    second_party_id: e.second_party_id,
                });
            }
        }
        if out.len() >= 16 {
            break;
        }
    }
    Ok(out)
}

/// Tendencia temporal PvP (por semana) de un personaje, para el gráfico de líneas.
#[tauri::command]
pub async fn get_pvp_trend(character_id: i64, state: State<'_, AppState>) -> AppResult<Vec<PvpTrendPoint>> {
    state.db.pvp_trend(character_id)
}

/// Tendencia temporal PvP global (todos los personajes).
#[tauri::command]
pub async fn get_pvp_trend_global(state: State<'_, AppState>) -> AppResult<Vec<PvpTrendPoint>> {
    state.db.pvp_trend_global()
}

/// Periodos (YYYY-MM) con killmails de un personaje.
#[tauri::command]
pub async fn get_pvp_periods(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<String>> {
    state.db.pvp_periods(Some(character_id))
}

/// Periodos (YYYY-MM) con killmails, global.
#[tauri::command]
pub async fn get_pvp_periods_global(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    state.db.pvp_periods(None)
}

/// Actividad PvP de un mes (totales, por día y horas calientes UTC) de un personaje.
#[tauri::command]
pub async fn get_pvp_activity(
    character_id: i64,
    period: String,
    state: State<'_, AppState>,
) -> AppResult<PvpActivity> {
    state.db.pvp_activity(Some(character_id), &period)
}

/// Actividad PvP de un mes, global.
#[tauri::command]
pub async fn get_pvp_activity_global(
    period: String,
    state: State<'_, AppState>,
) -> AppResult<PvpActivity> {
    state.db.pvp_activity(None, &period)
}

/// Devuelve las stats PvP del personaje, con nombres de naves/sistemas resueltos.
#[tauri::command]
pub async fn get_pvp_stats(character_id: i64, state: State<'_, AppState>) -> AppResult<PvpStats> {
    let mut stats = state.db.pvp_stats(character_id)?;

    // Reunimos todos los ids a resolver: top naves, top sistemas y las filas recientes.
    let mut ids: HashSet<i64> = HashSet::new();
    for nc in stats.top_ships.iter().chain(stats.top_systems.iter()) {
        ids.insert(nc.id);
    }
    for r in &stats.recent {
        if let Some(s) = r.ship_type_id {
            ids.insert(s);
        }
        if let Some(s) = r.system_id {
            ids.insert(s);
        }
    }

    let id_vec: Vec<i64> = ids.into_iter().collect();
    if let Ok(names) = state.esi.resolve_names(&id_vec).await {
        for nc in stats
            .top_ships
            .iter_mut()
            .chain(stats.top_systems.iter_mut())
        {
            nc.name = names.get(&nc.id).cloned();
        }
        for r in stats.recent.iter_mut() {
            r.ship_name = r.ship_type_id.and_then(|s| names.get(&s).cloned());
            r.system_name = r.system_id.and_then(|s| names.get(&s).cloned());
        }
    }

    let top = state.db.top_kills(character_id, 5)?;
    enrich_pvp(&state, &mut stats, top).await;
    Ok(stats)
}

/// Rellena región de top sistemas y la nave víctima de los top kills (desde caché).
async fn enrich_pvp(state: &AppState, stats: &mut PvpStats, mut top: Vec<TopKill>) {
    // Región de cada top sistema.
    let sys_ids: Vec<i64> = stats.top_systems.iter().map(|n| n.id).collect();
    let regions = state.esi.resolve_region_names(&state.db, &sys_ids).await;
    for n in stats.top_systems.iter_mut() {
        n.region = regions.get(&n.id).cloned();
    }

    // Nave de la víctima de cada top kill (desde el detalle cacheado, sin red).
    let mut ids: HashSet<i64> = HashSet::new();
    for tk in top.iter_mut() {
        let path = format!("/killmails/{}/{}/", tk.killmail_id, tk.hash);
        if let Ok(Some(c)) = state.db.get_cache(0, &path) {
            if let Ok(detail) = serde_json::from_str::<KillmailDetail>(&c.payload) {
                tk.victim_ship_id = detail.victim.ship_type_id;
            }
        }
        if let Some(s) = tk.victim_ship_id {
            ids.insert(s);
        }
        if let Some(s) = tk.system_id {
            ids.insert(s);
        }
    }
    if let Ok(names) = state
        .esi
        .resolve_names(&ids.into_iter().collect::<Vec<_>>())
        .await
    {
        for tk in top.iter_mut() {
            tk.victim_ship_name = tk.victim_ship_id.and_then(|s| names.get(&s).cloned());
            tk.system_name = tk.system_id.and_then(|s| names.get(&s).cloned());
        }
    }
    stats.top_expensive = top;
}

/// --- Batallas detectadas ---
#[derive(Debug, Serialize)]
pub struct Battle {
    pub system_id: i64,
    pub system_name: Option<String>,
    pub start: String, // RFC3339 del primer kill
    pub slug: String,  // YYYYMMDDHH00 para enlazar a zKillboard related
    pub kills: i64,
    pub losses: i64,
    pub isk: f64,
    pub total: i64,
}

/// Detecta batallas agrupando killmails por sistema + ventana temporal (gap < 60 min,
/// mínimo 8 killmails). Devuelve las mayores. character_id None = global.
#[tauri::command]
pub async fn get_battles(
    character_id: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<Vec<Battle>> {
    use std::collections::HashMap;
    const GAP_MIN: i64 = 60;
    const MIN_KM: usize = 8;

    let rows = state.db.killmails_for_battles(character_id)?;
    // Agrupar por sistema, parseando fechas.
    let mut by_sys: HashMap<i64, Vec<(chrono::DateTime<chrono::Utc>, f64, bool)>> = HashMap::new();
    for (sid, killed_at, isk, is_loss) in rows {
        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&killed_at) {
            by_sys
                .entry(sid)
                .or_default()
                .push((dt.with_timezone(&chrono::Utc), isk, is_loss));
        }
    }

    let mut battles: Vec<Battle> = Vec::new();
    for (sid, mut list) in by_sys {
        list.sort_by_key(|x| x.0);
        let mut cluster: Vec<(chrono::DateTime<chrono::Utc>, f64, bool)> = Vec::new();
        let mut last: Option<chrono::DateTime<chrono::Utc>> = None;
        let flush = |cluster: &Vec<(chrono::DateTime<chrono::Utc>, f64, bool)>,
                     out: &mut Vec<Battle>| {
            if cluster.len() >= MIN_KM {
                let start = cluster[0].0;
                out.push(Battle {
                    system_id: sid,
                    system_name: None,
                    start: start.to_rfc3339(),
                    slug: start.format("%Y%m%d%H00").to_string(),
                    kills: cluster.iter().filter(|c| !c.2).count() as i64,
                    losses: cluster.iter().filter(|c| c.2).count() as i64,
                    isk: cluster.iter().map(|c| c.1).sum(),
                    total: cluster.len() as i64,
                });
            }
        };
        for item in list {
            if let Some(prev) = last {
                if (item.0 - prev).num_minutes() > GAP_MIN {
                    flush(&cluster, &mut battles);
                    cluster.clear();
                }
            }
            last = Some(item.0);
            cluster.push(item);
        }
        flush(&cluster, &mut battles);
    }

    battles.sort_by(|a, b| b.total.cmp(&a.total));
    battles.truncate(40);

    // Resolver nombres de sistema.
    let ids: Vec<i64> = battles.iter().map(|b| b.system_id).collect();
    if let Ok(names) = state.esi.resolve_names(&ids).await {
        for b in battles.iter_mut() {
            b.system_name = names.get(&b.system_id).cloned();
        }
    }
    Ok(battles)
}

/// --- Rivales / Némesis ---
#[derive(serde::Deserialize)]
struct KmFull {
    victim: KmParty,
    #[serde(default)]
    attackers: Vec<KmParty>,
}
#[derive(serde::Deserialize)]
struct KmParty {
    #[serde(default)]
    character_id: Option<i64>,
    #[serde(default)]
    corporation_id: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct RivalEntry {
    pub id: i64,
    pub name: Option<String>,
    pub count: i64,
}

#[derive(Debug, Serialize, Default)]
pub struct Rivals {
    pub you_kill_chars: Vec<RivalEntry>,
    pub you_kill_corps: Vec<RivalEntry>,
    pub kills_you_chars: Vec<RivalEntry>,
    pub kills_you_corps: Vec<RivalEntry>,
}

fn top_entries(map: &std::collections::HashMap<i64, i64>, n: usize) -> Vec<RivalEntry> {
    let mut v: Vec<(i64, i64)> = map.iter().map(|(&k, &c)| (k, c)).collect();
    v.sort_by(|a, b| b.1.cmp(&a.1));
    v.truncate(n);
    v.into_iter()
        .map(|(id, count)| RivalEntry {
            id,
            name: None,
            count,
        })
        .collect()
}

/// Ranking de rivales del sujeto: a quién matas y quién te mata (por personaje y corp).
#[tauri::command]
pub async fn get_rivals(
    character_id: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<Rivals> {
    use std::collections::{HashMap, HashSet};

    let own: HashSet<i64> = state
        .db
        .list_characters()?
        .into_iter()
        .map(|c| c.character_id)
        .collect();

    let mut kill_char: HashMap<i64, i64> = HashMap::new();
    let mut kill_corp: HashMap<i64, i64> = HashMap::new();
    let mut loss_char: HashMap<i64, i64> = HashMap::new();
    let mut loss_corp: HashMap<i64, i64> = HashMap::new();

    for (is_loss, raw) in state.db.killmails_raw(character_id)? {
        let km: KmFull = match serde_json::from_str(&raw) {
            Ok(k) => k,
            Err(_) => continue,
        };
        if !is_loss {
            // Es un kill tuyo → la víctima es el rival.
            if let Some(c) = km.victim.character_id {
                if !own.contains(&c) {
                    *kill_char.entry(c).or_insert(0) += 1;
                }
            }
            if let Some(co) = km.victim.corporation_id {
                *kill_corp.entry(co).or_insert(0) += 1;
            }
        } else {
            // Es una pérdida tuya → los atacantes son los rivales (deduplicados por killmail).
            let mut seen_c: HashSet<i64> = HashSet::new();
            let mut seen_co: HashSet<i64> = HashSet::new();
            for a in &km.attackers {
                if let Some(c) = a.character_id {
                    if !own.contains(&c) && seen_c.insert(c) {
                        *loss_char.entry(c).or_insert(0) += 1;
                    }
                }
                if let Some(co) = a.corporation_id {
                    if seen_co.insert(co) {
                        *loss_corp.entry(co).or_insert(0) += 1;
                    }
                }
            }
        }
    }

    let mut rivals = Rivals {
        you_kill_chars: top_entries(&kill_char, 15),
        you_kill_corps: top_entries(&kill_corp, 15),
        kills_you_chars: top_entries(&loss_char, 15),
        kills_you_corps: top_entries(&loss_corp, 15),
    };

    // Resolver nombres de los ids del top (personajes + corps).
    let mut ids: HashSet<i64> = HashSet::new();
    for e in rivals
        .you_kill_chars
        .iter()
        .chain(rivals.you_kill_corps.iter())
        .chain(rivals.kills_you_chars.iter())
        .chain(rivals.kills_you_corps.iter())
    {
        ids.insert(e.id);
    }
    if let Ok(names) = state
        .esi
        .resolve_names(&ids.into_iter().collect::<Vec<_>>())
        .await
    {
        for e in rivals
            .you_kill_chars
            .iter_mut()
            .chain(rivals.you_kill_corps.iter_mut())
            .chain(rivals.kills_you_chars.iter_mut())
            .chain(rivals.kills_you_corps.iter_mut())
        {
            e.name = names.get(&e.id).cloned();
        }
    }
    Ok(rivals)
}

/// Página de killmails (con filtro y paginación), nombres resueltos.
#[derive(Debug, Serialize)]
pub struct KillmailPage {
    pub rows: Vec<crate::db::KillmailRow>,
    pub total: i64,
}

#[tauri::command]
pub async fn get_killmails(
    character_id: Option<i64>,
    kind: String,
    offset: i64,
    limit: i64,
    state: State<'_, AppState>,
) -> AppResult<KillmailPage> {
    let (mut rows, total) = state
        .db
        .killmails_page(character_id, &kind, offset, limit)?;

    let mut ids: HashSet<i64> = HashSet::new();
    for r in &rows {
        if let Some(s) = r.ship_type_id {
            ids.insert(s);
        }
        if let Some(s) = r.system_id {
            ids.insert(s);
        }
    }
    if let Ok(names) = state
        .esi
        .resolve_names(&ids.into_iter().collect::<Vec<_>>())
        .await
    {
        for r in rows.iter_mut() {
            r.ship_name = r.ship_type_id.and_then(|s| names.get(&s).cloned());
            r.system_name = r.system_id.and_then(|s| names.get(&s).cloned());
        }
    }
    Ok(KillmailPage { rows, total })
}

/// Exporta los killmails del personaje a un CSV y devuelve el contenido (el front lo guarda).
#[tauri::command]
pub fn export_pvp_csv(character_id: i64, state: State<'_, AppState>) -> AppResult<String> {
    let rows = state.db.all_killmails(character_id)?;
    let mut out =
        String::from("killmail_id,tipo,ship_type_id,system_id,isk_value,killed_at,solo\n");
    for r in rows {
        out.push_str(&format!(
            "{},{},{},{},{},{},{}\n",
            r.killmail_id,
            if r.is_loss { "loss" } else { "kill" },
            r.ship_type_id.map(|v| v.to_string()).unwrap_or_default(),
            r.system_id.map(|v| v.to_string()).unwrap_or_default(),
            r.isk_value.map(|v| v.to_string()).unwrap_or_default(),
            r.killed_at.unwrap_or_default(),
            if r.solo { "1" } else { "0" },
        ));
    }
    Ok(out)
}

/// Obtiene un access token válido y comprueba que tenga el scope requerido.
async fn token_with_scope(
    state: &AppState,
    character_id: i64,
    scope: &str,
    feature_hint: &str,
) -> AppResult<String> {
    let valid = state
        .tokens
        .access_token(state.esi.http(), character_id)
        .await?;
    if !valid.claims.scp.iter().any(|s| s == scope) {
        return Err(AppError::OAuth(format!(
            "este personaje no concedió el scope necesario. Inicia sesión con la feature '{feature_hint}'."
        )));
    }
    Ok(valid.access_token)
}

#[derive(Debug, Serialize)]
pub struct WalletView {
    pub balance: f64,
    pub stats: WalletStats,
}

/// Sincroniza el journal de cartera del personaje (scope wallet).
#[tauri::command]
pub async fn sync_wallet(character_id: i64, state: State<'_, AppState>) -> AppResult<usize> {
    let token = token_with_scope(
        &state,
        character_id,
        "esi-wallet.read_character_wallet.v1",
        "Wallet",
    )
    .await?;
    let n = wallet::sync_journal(&state.esi, &state.db, character_id, &token, 50).await?;
    // Acumula también las transacciones (para Abyssals/Comercio fiables a largo plazo).
    let _ = wallet::sync_transactions(&state.esi, &state.db, character_id, &token).await;
    Ok(n)
}

/// Devuelve balance + estadísticas de cartera (income/expense/net/top ref_types/recientes).
#[tauri::command]
pub async fn get_wallet(character_id: i64, state: State<'_, AppState>) -> AppResult<WalletView> {
    let token = token_with_scope(
        &state,
        character_id,
        "esi-wallet.read_character_wallet.v1",
        "Wallet",
    )
    .await?;
    let balance = wallet::balance(&state.esi, &state.db, character_id, &token).await?;
    let stats = state.db.wallet_stats(character_id)?;
    Ok(WalletView { balance, stats })
}

/// Serie mensual de ingresos/gastos (para el scrub de Wallet) de un personaje.
#[tauri::command]
pub async fn get_wallet_trend(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<WalletTrendPoint>> {
    state.db.wallet_trend(Some(character_id))
}

/// Serie mensual de ingresos/gastos, global.
#[tauri::command]
pub async fn get_wallet_trend_global(
    state: State<'_, AppState>,
) -> AppResult<Vec<WalletTrendPoint>> {
    state.db.wallet_trend(None)
}

/// Devuelve resumen de skills: SP total, sin asignar, nº de skills y cola (con nombres).
#[tauri::command]
pub async fn get_skills(character_id: i64, state: State<'_, AppState>) -> AppResult<SkillsSummary> {
    let token =
        token_with_scope(&state, character_id, "esi-skills.read_skills.v1", "Skills").await?;

    let s = skills::skills(&state.esi, &state.db, character_id, &token).await?;
    let mut queue = skills::skillqueue(&state.esi, &state.db, character_id, &token)
        .await
        .unwrap_or_default();

    // Resolvemos nombres de las skills de la cola.
    let ids: Vec<i64> = queue.iter().map(|q| q.skill_id).collect();
    if let Ok(names) = state.esi.resolve_names(&ids).await {
        for q in queue.iter_mut() {
            q.skill_name = names.get(&q.skill_id).cloned();
        }
    }

    Ok(SkillsSummary {
        total_sp: s.total_sp,
        unallocated_sp: s.unallocated_sp,
        skill_count: s.skills.len() as i64,
        queue,
    })
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct AttrView {
    pub charisma: i64,
    pub intelligence: i64,
    pub memory: i64,
    pub perception: i64,
    pub willpower: i64,
    pub bonus_remaps: Option<i64>,
    pub last_remap_date: Option<String>,
}
#[derive(Debug, Clone, serde::Serialize)]
pub struct ImplantView {
    pub type_id: i64,
    pub name: Option<String>,
}
#[derive(Debug, Clone, serde::Serialize)]
pub struct CharacterDetail {
    pub birthday: Option<String>,
    pub gender: Option<String>,
    pub security_status: Option<f64>,
    pub bio: Option<String>,
    pub attributes: Option<AttrView>,
    pub implants: Vec<ImplantView>,
    pub jump_clones: i64,
    pub clone_implants: i64,
    pub home_location_id: Option<i64>,
}

/// Header rico del personaje: info pública + atributos + implantes + jump clones.
/// Best-effort: cada parte se omite si falta el scope o falla.
#[tauri::command]
pub async fn get_character_detail(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<CharacterDetail> {
    use crate::esi::character as ch;

    let public = ch::public_info(&state.esi, &state.db, character_id).await.ok();

    let valid = state
        .tokens
        .access_token(state.esi.http(), character_id)
        .await
        .ok();
    let has = |scope: &str| {
        valid
            .as_ref()
            .is_some_and(|v| v.claims.scp.iter().any(|s| s == scope))
    };
    let token = valid.as_ref().map(|v| v.access_token.clone()).unwrap_or_default();

    let attributes = if has("esi-skills.read_skills.v1") {
        ch::attributes(&state.esi, &state.db, character_id, &token)
            .await
            .ok()
            .map(|a| AttrView {
                charisma: a.charisma,
                intelligence: a.intelligence,
                memory: a.memory,
                perception: a.perception,
                willpower: a.willpower,
                bonus_remaps: a.bonus_remaps,
                last_remap_date: a.last_remap_date,
            })
    } else {
        None
    };

    let mut implant_ids: Vec<i64> = Vec::new();
    if has("esi-clones.read_implants.v1") {
        if let Ok(v) = ch::implants(&state.esi, &state.db, character_id, &token).await {
            implant_ids = v;
        }
    }

    let mut jump_clones = 0i64;
    let mut clone_implants = 0i64;
    let mut home_location_id = None;
    if has("esi-clones.read_clones.v1") {
        if let Ok(c) = ch::clones(&state.esi, &state.db, character_id, &token).await {
            jump_clones = c.jump_clones.len() as i64;
            clone_implants = c.jump_clones.iter().map(|j| j.implants.len() as i64).sum();
            home_location_id = c.home_location.and_then(|h| h.location_id);
        }
    }

    let mut implants: Vec<ImplantView> = implant_ids
        .iter()
        .map(|&type_id| ImplantView { type_id, name: None })
        .collect();
    if !implant_ids.is_empty() {
        if let Ok(names) = state.esi.resolve_names(&implant_ids).await {
            for im in implants.iter_mut() {
                im.name = names.get(&im.type_id).cloned();
            }
        }
    }

    Ok(CharacterDetail {
        birthday: public.as_ref().and_then(|p| p.birthday.clone()),
        gender: public.as_ref().and_then(|p| p.gender.clone()),
        security_status: public.as_ref().and_then(|p| p.security_status),
        bio: public.as_ref().and_then(|p| p.description.clone()),
        attributes,
        implants,
        jump_clones,
        clone_implants,
        home_location_id,
    })
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct FwCountsView {
    pub yesterday: i64,
    pub last_week: i64,
    pub total: i64,
}
#[derive(Debug, Clone, serde::Serialize)]
pub struct FactionalView {
    pub enlisted: bool,
    pub enlisted_on: Option<String>,
    pub faction_id: Option<i64>,
    pub current_rank: Option<i64>,
    pub highest_rank: Option<i64>,
    pub kills: FwCountsView,
    pub victory_points: FwCountsView,
}

/// Stats de Guerra de Facciones (PvE → Factional).
#[tauri::command]
pub async fn get_factional(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<FactionalView> {
    let token = token_with_scope(
        &state,
        character_id,
        "esi-characters.read_fw_stats.v1",
        "Factional",
    )
    .await?;
    let s = crate::esi::character::fw_stats(&state.esi, &state.db, character_id, &token).await?;
    let conv = |c: Option<crate::esi::character::FwCounts>| {
        let c = c.unwrap_or(crate::esi::character::FwCounts {
            yesterday: 0,
            last_week: 0,
            total: 0,
        });
        FwCountsView {
            yesterday: c.yesterday,
            last_week: c.last_week,
            total: c.total,
        }
    };
    Ok(FactionalView {
        enlisted: s.enlisted_on.is_some() || s.faction_id.is_some(),
        enlisted_on: s.enlisted_on,
        faction_id: s.faction_id,
        current_rank: s.current_rank,
        highest_rank: s.highest_rank,
        kills: conv(s.kills),
        victory_points: conv(s.victory_points),
    })
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct FilamentRow {
    pub name: String,
    pub count: i64,
    pub isk: f64,
}
#[derive(Debug, Clone, serde::Serialize)]
pub struct AbyssalsView {
    pub runs_est: i64,
    pub isk_spent: f64,
    pub by_filament: Vec<FilamentRow>,
}

/// Abyssals ESTIMADO por compras de filamentos en las transacciones de wallet.
/// ESI no expone runs abisales; esto es una aproximación (1 filamento ≈ 1 run).
#[tauri::command]
pub async fn get_abyssals(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<AbyssalsView> {
    use std::collections::HashMap;
    let token = token_with_scope(
        &state,
        character_id,
        "esi-wallet.read_character_wallet.v1",
        "Wallet",
    )
    .await?;
    // Acumula las transacciones recientes y luego lee del histórico GUARDADO (crece con el tiempo).
    let _ = crate::esi::wallet::sync_transactions(&state.esi, &state.db, character_id, &token).await;
    let buys = state
        .db
        .transaction_buys_by_type(Some(character_id))
        .unwrap_or_default();

    let ids: Vec<i64> = buys.iter().map(|(tid, _, _)| *tid).collect();
    let names = state.esi.resolve_names(&ids).await.unwrap_or_default();

    // Agrega solo los items cuyo nombre contiene "Filament" (ESI devuelve nombres en inglés).
    let mut by: HashMap<String, (i64, f64)> = HashMap::new();
    for (tid, qty, isk) in &buys {
        let name = match names.get(tid) {
            Some(n) if n.to_lowercase().contains("filament") => n.clone(),
            _ => continue,
        };
        let e = by.entry(name).or_insert((0, 0.0));
        e.0 += *qty;
        e.1 += *isk;
    }

    let mut by_filament: Vec<FilamentRow> = by
        .into_iter()
        .map(|(name, (count, isk))| FilamentRow { name, count, isk })
        .collect();
    by_filament.sort_by(|a, b| b.count.cmp(&a.count));
    let runs_est = by_filament.iter().map(|f| f.count).sum();
    let isk_spent = by_filament.iter().map(|f| f.isk).sum();

    Ok(AbyssalsView {
        runs_est,
        isk_spent,
        by_filament,
    })
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ContactView {
    pub id: i64,
    pub name: Option<String>,
    pub kind: String, // character / corporation / alliance / faction
    pub standing: f64,
    pub blocked: bool,
    pub watched: bool,
}

/// Contactos personales con standing + nombre resuelto (grupo Personaje).
#[tauri::command]
pub async fn get_contacts(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<ContactView>> {
    use std::collections::HashSet;
    let token = token_with_scope(
        &state,
        character_id,
        "esi-characters.read_contacts.v1",
        "Contactos",
    )
    .await?;
    let cs = crate::esi::character::contacts(&state.esi, &state.db, character_id, &token)
        .await
        .unwrap_or_default();
    let ids: Vec<i64> = cs
        .iter()
        .map(|c| c.contact_id)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let names = state.esi.resolve_names(&ids).await.unwrap_or_default();
    let mut out: Vec<ContactView> = cs
        .iter()
        .map(|c| ContactView {
            id: c.contact_id,
            name: names.get(&c.contact_id).cloned(),
            kind: c.contact_type.clone().unwrap_or_default(),
            standing: c.standing,
            blocked: c.is_blocked.unwrap_or(false),
            watched: c.is_watched.unwrap_or(false),
        })
        .collect();
    out.sort_by(|a, b| b.standing.partial_cmp(&a.standing).unwrap_or(std::cmp::Ordering::Equal));
    Ok(out)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct StandingView {
    pub id: i64,
    pub name: Option<String>,
    pub kind: String, // agent / npc_corp / faction
    pub standing: f64,
}

/// Standings con NPC (facciones/corps/agentes) con nombre resuelto.
#[tauri::command]
pub async fn get_standings(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<StandingView>> {
    use std::collections::HashSet;
    let token = token_with_scope(
        &state,
        character_id,
        "esi-characters.read_standings.v1",
        "Standings",
    )
    .await?;
    let ss = crate::esi::character::standings(&state.esi, &state.db, character_id, &token)
        .await
        .unwrap_or_default();
    let ids: Vec<i64> = ss
        .iter()
        .map(|s| s.from_id)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let names = state.esi.resolve_names(&ids).await.unwrap_or_default();
    let mut out: Vec<StandingView> = ss
        .iter()
        .map(|s| StandingView {
            id: s.from_id,
            name: names.get(&s.from_id).cloned(),
            kind: s.from_type.clone().unwrap_or_default(),
            standing: s.standing,
        })
        .collect();
    out.sort_by(|a, b| b.standing.partial_cmp(&a.standing).unwrap_or(std::cmp::Ordering::Equal));
    Ok(out)
}

/// PvP GLOBAL: agregado de todos los personajes (deduplicado por killmail).
#[tauri::command]
pub async fn get_pvp_stats_global(state: State<'_, AppState>) -> AppResult<PvpStats> {
    let mut stats = state.db.pvp_stats_global()?;
    let mut ids: HashSet<i64> = HashSet::new();
    for nc in stats.top_ships.iter().chain(stats.top_systems.iter()) {
        ids.insert(nc.id);
    }
    for r in &stats.recent {
        if let Some(s) = r.ship_type_id {
            ids.insert(s);
        }
        if let Some(s) = r.system_id {
            ids.insert(s);
        }
    }
    if let Ok(names) = state
        .esi
        .resolve_names(&ids.into_iter().collect::<Vec<_>>())
        .await
    {
        for nc in stats
            .top_ships
            .iter_mut()
            .chain(stats.top_systems.iter_mut())
        {
            nc.name = names.get(&nc.id).cloned();
        }
        for r in stats.recent.iter_mut() {
            r.ship_name = r.ship_type_id.and_then(|s| names.get(&s).cloned());
            r.system_name = r.system_id.and_then(|s| names.get(&s).cloned());
        }
    }

    let top = state.db.top_kills_global(5)?;
    enrich_pvp(&state, &mut stats, top).await;
    Ok(stats)
}

/// Wallet GLOBAL: stats agregadas (DB) + balance sumado en vivo de todos los personajes.
#[tauri::command]
pub async fn get_wallet_global(state: State<'_, AppState>) -> AppResult<WalletView> {
    let stats = state.db.wallet_stats_global()?;
    let mut balance = 0.0;
    for c in state.db.list_characters()? {
        if !c
            .scopes
            .iter()
            .any(|s| s == "esi-wallet.read_character_wallet.v1")
        {
            continue;
        }
        if let Ok(valid) = state
            .tokens
            .access_token(state.esi.http(), c.character_id)
            .await
        {
            if let Ok(b) =
                wallet::balance(&state.esi, &state.db, c.character_id, &valid.access_token).await
            {
                balance += b;
            }
        }
    }
    Ok(WalletView { balance, stats })
}

/// Qué entrena cada personaje ahora mismo.
#[derive(Debug, Serialize)]
pub struct CharTraining {
    pub character_id: i64,
    pub character_name: String,
    pub skill_id: Option<i64>,
    pub skill_name: Option<String>,
    pub finished_level: i64,
    pub finish_date: Option<String>,
}

/// Skills GLOBAL: totales sumados + qué entrena cada personaje (en vez de cola fusionada).
#[derive(Debug, Serialize)]
pub struct GlobalSkills {
    pub total_sp: i64,
    pub unallocated_sp: i64,
    pub skill_count: i64,
    pub character_count: i64,
    pub training: Vec<CharTraining>,
}

#[tauri::command]
pub async fn get_skills_global(state: State<'_, AppState>) -> AppResult<GlobalSkills> {
    let mut total_sp = 0i64;
    let mut unallocated_sp = 0i64;
    let mut skill_count = 0i64;
    let mut character_count = 0i64;
    let mut training: Vec<CharTraining> = Vec::new();

    for c in state.db.list_characters()? {
        if !c.scopes.iter().any(|s| s == "esi-skills.read_skills.v1") {
            continue;
        }
        let valid = match state
            .tokens
            .access_token(state.esi.http(), c.character_id)
            .await
        {
            Ok(v) => v,
            Err(_) => continue,
        };
        character_count += 1;

        if let Ok(s) =
            skills::skills(&state.esi, &state.db, c.character_id, &valid.access_token).await
        {
            total_sp += s.total_sp;
            unallocated_sp += s.unallocated_sp;
            skill_count += s.skills.len() as i64;
        }

        // Skill que entrena ahora = la de menor fecha de fin (la próxima en terminar).
        let current =
            skills::skillqueue(&state.esi, &state.db, c.character_id, &valid.access_token)
                .await
                .ok()
                .and_then(|q| {
                    q.into_iter()
                        .filter(|i| i.finish_date.is_some())
                        .min_by(|a, b| a.finish_date.cmp(&b.finish_date))
                });

        training.push(CharTraining {
            character_id: c.character_id,
            character_name: c.name.clone(),
            skill_id: current.as_ref().map(|i| i.skill_id),
            skill_name: None,
            finished_level: current.as_ref().map(|i| i.finished_level).unwrap_or(0),
            finish_date: current.as_ref().and_then(|i| i.finish_date.clone()),
        });
    }

    // Resolver nombres de las skills que se entrenan.
    let ids: Vec<i64> = training.iter().filter_map(|t| t.skill_id).collect();
    if let Ok(names) = state.esi.resolve_names(&ids).await {
        for t in training.iter_mut() {
            t.skill_name = t.skill_id.and_then(|s| names.get(&s).cloned());
        }
    }

    Ok(GlobalSkills {
        total_sp,
        unallocated_sp,
        skill_count,
        character_count,
        training,
    })
}

/// Resumen de assets con nombres de tipo resueltos en el top.
#[tauri::command]
pub async fn get_assets(character_id: i64, state: State<'_, AppState>) -> AppResult<AssetsSummary> {
    let token = token_with_scope(
        &state,
        character_id,
        "esi-assets.read_assets.v1",
        "Assets / industria",
    )
    .await?;
    let mut summary = assets::summary(&state.esi, &state.db, character_id, &token).await?;
    let ids: Vec<i64> = summary.top_types.iter().map(|n| n.id).collect();
    if let Ok(names) = state.esi.resolve_names(&ids).await {
        for n in summary.top_types.iter_mut() {
            n.name = names.get(&n.id).cloned();
        }
    }
    Ok(summary)
}

/// Vista de detalle de un asset (un tipo en un sistema) con nombres resueltos.
#[derive(Debug, Serialize)]
pub struct AssetDetailView {
    pub type_id: i64,
    pub type_name: Option<String>,
    pub quantity: i64,
    pub system_id: i64,
    pub system_name: Option<String>,
    pub category: String,
}

/// Resuelve nombres de tipo/sistema y categoría (cacheada) para una lista de filas de detalle.
async fn resolve_asset_detail(
    esi: &EsiClient,
    db: &Db,
    rows: Vec<crate::esi::assets::AssetDetailRow>,
) -> AppResult<Vec<AssetDetailView>> {
    let mut ids: HashSet<i64> = HashSet::new();
    let mut type_ids: HashSet<i64> = HashSet::new();
    for r in &rows {
        ids.insert(r.type_id);
        type_ids.insert(r.type_id);
        if r.system_id != 0 {
            ids.insert(r.system_id);
        }
    }
    let names = esi
        .resolve_names(&ids.into_iter().collect::<Vec<_>>())
        .await
        .unwrap_or_default();
    let mut cats: std::collections::HashMap<i64, String> = std::collections::HashMap::new();
    for tid in type_ids {
        cats.insert(tid, crate::esi::assets::resolve_category(esi, db, tid).await);
    }
    Ok(rows
        .into_iter()
        .map(|r| AssetDetailView {
            type_id: r.type_id,
            type_name: names.get(&r.type_id).cloned(),
            quantity: r.quantity,
            system_id: r.system_id,
            system_name: if r.system_id != 0 {
                names.get(&r.system_id).cloned()
            } else {
                None
            },
            category: cats.get(&r.type_id).cloned().unwrap_or_else(|| "Otros".to_string()),
        })
        .collect())
}

/// Lista detallada de assets de un personaje (para el buscador).
#[tauri::command]
pub async fn get_assets_detail(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<AssetDetailView>> {
    let token = token_with_scope(
        &state,
        character_id,
        "esi-assets.read_assets.v1",
        "Assets / industria",
    )
    .await?;
    let rows = assets::detail(&state.esi, &state.db, character_id, &token).await?;
    resolve_asset_detail(&state.esi, &state.db, rows).await
}

/// Lista detallada de assets global (todos los personajes con el scope).
#[tauri::command]
pub async fn get_assets_detail_global(state: State<'_, AppState>) -> AppResult<Vec<AssetDetailView>> {
    use std::collections::HashMap;
    let mut agg: HashMap<(i64, i64), i64> = HashMap::new();
    for c in state.db.list_characters()? {
        if !c.scopes.iter().any(|s| s == "esi-assets.read_assets.v1") {
            continue;
        }
        let valid = match state
            .tokens
            .access_token(state.esi.http(), c.character_id)
            .await
        {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Ok(rows) =
            assets::detail(&state.esi, &state.db, c.character_id, &valid.access_token).await
        {
            for r in rows {
                *agg.entry((r.type_id, r.system_id)).or_insert(0) += r.quantity;
            }
        }
    }
    let mut rows: Vec<crate::esi::assets::AssetDetailRow> = agg
        .into_iter()
        .map(|((type_id, system_id), quantity)| crate::esi::assets::AssetDetailRow {
            type_id,
            quantity,
            system_id,
        })
        .collect();
    rows.sort_by(|a, b| b.quantity.cmp(&a.quantity));
    resolve_asset_detail(&state.esi, &state.db, rows).await
}

/// Una orden de mercado tal cual la devuelve ESI (campos que usamos).
#[derive(Debug, Clone, serde::Deserialize)]
struct OrderRaw {
    type_id: i64,
    #[serde(default)]
    is_buy_order: bool,
    #[serde(default)]
    price: f64,
    #[serde(default)]
    volume_remain: i64,
    #[serde(default)]
    volume_total: i64,
    #[serde(default)]
    location_id: i64,
    #[serde(default)]
    issued: Option<String>,
}

/// Vista de una orden de mercado con nombres resueltos.
#[derive(Debug, Serialize)]
pub struct MarketOrderView {
    pub type_id: i64,
    pub type_name: Option<String>,
    pub is_buy: bool,
    pub price: f64,
    pub volume_remain: i64,
    pub volume_total: i64,
    pub system_id: i64,
    pub system_name: Option<String>,
    pub issued: Option<String>,
}

/// Resuelve sistema (caché) y nombres para una lista de órdenes.
async fn resolve_orders(
    esi: &EsiClient,
    db: &Db,
    token: &str,
    orders: Vec<OrderRaw>,
) -> AppResult<Vec<MarketOrderView>> {
    let mut sys_of: std::collections::HashMap<i64, i64> = std::collections::HashMap::new();
    for o in &orders {
        if !sys_of.contains_key(&o.location_id) {
            let s = crate::esi::assets::resolve_location_system_cached(esi, db, o.location_id, token)
                .await
                .unwrap_or(0);
            sys_of.insert(o.location_id, s);
        }
    }
    let mut ids: HashSet<i64> = HashSet::new();
    for o in &orders {
        ids.insert(o.type_id);
    }
    for s in sys_of.values() {
        if *s != 0 {
            ids.insert(*s);
        }
    }
    let names = esi
        .resolve_names(&ids.into_iter().collect::<Vec<_>>())
        .await
        .unwrap_or_default();
    Ok(orders
        .into_iter()
        .map(|o| {
            let sid = *sys_of.get(&o.location_id).unwrap_or(&0);
            MarketOrderView {
                type_id: o.type_id,
                type_name: names.get(&o.type_id).cloned(),
                is_buy: o.is_buy_order,
                price: o.price,
                volume_remain: o.volume_remain,
                volume_total: o.volume_total,
                system_id: sid,
                system_name: if sid != 0 { names.get(&sid).cloned() } else { None },
                issued: o.issued,
            }
        })
        .collect())
}

/// Órdenes de mercado abiertas de un personaje (Comercio).
#[tauri::command]
pub async fn get_market_orders(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<MarketOrderView>> {
    let token = token_with_scope(
        &state,
        character_id,
        "esi-markets.read_character_orders.v1",
        "Wallet",
    )
    .await?;
    let orders: Vec<OrderRaw> = state
        .esi
        .get_cached(
            &state.db,
            character_id,
            &format!("/characters/{character_id}/orders/"),
            Some(&token),
        )
        .await?;
    resolve_orders(&state.esi, &state.db, &token, orders).await
}

/// Órdenes de mercado global (todos los personajes con el scope).
#[tauri::command]
pub async fn get_market_orders_global(
    state: State<'_, AppState>,
) -> AppResult<Vec<MarketOrderView>> {
    let mut all: Vec<MarketOrderView> = Vec::new();
    for c in state.db.list_characters()? {
        if !c
            .scopes
            .iter()
            .any(|s| s == "esi-markets.read_character_orders.v1")
        {
            continue;
        }
        let valid = match state
            .tokens
            .access_token(state.esi.http(), c.character_id)
            .await
        {
            Ok(v) => v,
            Err(_) => continue,
        };
        let cid = c.character_id;
        if let Ok(orders) = state
            .esi
            .get_cached::<Vec<OrderRaw>>(
                &state.db,
                cid,
                &format!("/characters/{cid}/orders/"),
                Some(&valid.access_token),
            )
            .await
        {
            if let Ok(mut v) = resolve_orders(&state.esi, &state.db, &valid.access_token, orders).await {
                all.append(&mut v);
            }
        }
    }
    Ok(all)
}

/// Una colonia de Planetary Interaction tal cual la devuelve ESI.
#[derive(Debug, Clone, serde::Deserialize)]
struct PlanetRaw {
    #[serde(default)]
    solar_system_id: i64,
    #[serde(default)]
    planet_type: String,
    #[serde(default)]
    upgrade_level: i64,
    #[serde(default)]
    num_pins: i64,
    #[serde(default)]
    last_update: Option<String>,
}

/// Vista de una colonia con el nombre del sistema resuelto.
#[derive(Debug, Serialize)]
pub struct PlanetView {
    pub system_id: i64,
    pub system_name: Option<String>,
    pub planet_type: String,
    pub upgrade_level: i64,
    pub num_pins: i64,
    pub last_update: Option<String>,
}

async fn resolve_planets(esi: &EsiClient, rows: Vec<PlanetRaw>) -> AppResult<Vec<PlanetView>> {
    let mut ids: HashSet<i64> = HashSet::new();
    for p in &rows {
        if p.solar_system_id != 0 {
            ids.insert(p.solar_system_id);
        }
    }
    let names = esi
        .resolve_names(&ids.into_iter().collect::<Vec<_>>())
        .await
        .unwrap_or_default();
    Ok(rows
        .into_iter()
        .map(|p| PlanetView {
            system_id: p.solar_system_id,
            system_name: names.get(&p.solar_system_id).cloned(),
            planet_type: p.planet_type,
            upgrade_level: p.upgrade_level,
            num_pins: p.num_pins,
            last_update: p.last_update,
        })
        .collect())
}

/// Colonias de Planetary Interaction de un personaje (Planetología).
#[tauri::command]
pub async fn get_planets(character_id: i64, state: State<'_, AppState>) -> AppResult<Vec<PlanetView>> {
    let token = token_with_scope(
        &state,
        character_id,
        "esi-planets.manage_planets.v1",
        "Assets / industria",
    )
    .await?;
    let rows: Vec<PlanetRaw> = state
        .esi
        .get_cached(
            &state.db,
            character_id,
            &format!("/characters/{character_id}/planets/"),
            Some(&token),
        )
        .await?;
    resolve_planets(&state.esi, rows).await
}

/// Colonias PI global (todos los personajes con el scope).
#[tauri::command]
pub async fn get_planets_global(state: State<'_, AppState>) -> AppResult<Vec<PlanetView>> {
    let mut all: Vec<PlanetView> = Vec::new();
    for c in state.db.list_characters()? {
        if !c.scopes.iter().any(|s| s == "esi-planets.manage_planets.v1") {
            continue;
        }
        let valid = match state
            .tokens
            .access_token(state.esi.http(), c.character_id)
            .await
        {
            Ok(v) => v,
            Err(_) => continue,
        };
        let cid = c.character_id;
        if let Ok(rows) = state
            .esi
            .get_cached::<Vec<PlanetRaw>>(
                &state.db,
                cid,
                &format!("/characters/{cid}/planets/"),
                Some(&valid.access_token),
            )
            .await
        {
            if let Ok(mut v) = resolve_planets(&state.esi, rows).await {
                all.append(&mut v);
            }
        }
    }
    Ok(all)
}

/// Vista de un job de industria con nombres legibles.
#[derive(Debug, Serialize)]
pub struct JobView {
    pub job_id: i64,
    pub activity: String,
    pub runs: i64,
    pub status: Option<String>,
    pub blueprint_name: Option<String>,
    pub product_name: Option<String>,
    pub end_date: Option<String>,
    /// Nombre del personaje (solo se rellena en la vista global).
    pub character: Option<String>,
}

/// Jobs de industria activos del personaje, con nombres resueltos.
#[tauri::command]
pub async fn get_industry(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<JobView>> {
    let token = token_with_scope(
        &state,
        character_id,
        "esi-industry.read_character_jobs.v1",
        "Assets / industria",
    )
    .await?;
    let jobs: Vec<JobRaw> =
        industry::fetch_jobs(&state.esi, &state.db, character_id, &token).await?;

    // IDs a resolver: blueprints y productos.
    let mut ids: HashSet<i64> = HashSet::new();
    for j in &jobs {
        ids.insert(j.blueprint_type_id);
        if let Some(p) = j.product_type_id {
            ids.insert(p);
        }
    }
    let names = state
        .esi
        .resolve_names(&ids.into_iter().collect::<Vec<_>>())
        .await
        .unwrap_or_default();

    let views = jobs
        .into_iter()
        .map(|j| JobView {
            job_id: j.job_id,
            activity: industry::activity_name(j.activity_id).to_string(),
            runs: j.runs,
            status: j.status,
            blueprint_name: names.get(&j.blueprint_type_id).cloned(),
            product_name: j.product_type_id.and_then(|p| names.get(&p).cloned()),
            end_date: j.end_date,
            character: None,
        })
        .collect();
    Ok(views)
}

/// Resumen de minería desde la BD acumulada (no solo los 90 días de ESI).
async fn build_mining(state: &AppState, filter: Option<i64>) -> AppResult<MiningSummary> {
    let (total_units, entries) = state.db.mining_totals(filter)?;
    let mut top_ores: Vec<NameCount> = state
        .db
        .mining_by_type(filter, 15)?
        .into_iter()
        .map(|(id, count)| NameCount {
            id,
            count,
            name: None,
            region: None,
        })
        .collect();
    let mut recent: Vec<MiningRow> = state
        .db
        .mining_recent(filter, 50)?
        .into_iter()
        .map(|(date, system_id, type_id, quantity)| MiningRow {
            date: Some(date),
            system_id: Some(system_id),
            type_id,
            type_name: None,
            quantity,
        })
        .collect();

    let mut ids: HashSet<i64> = HashSet::new();
    for o in &top_ores {
        ids.insert(o.id);
    }
    for r in &recent {
        ids.insert(r.type_id);
        if let Some(s) = r.system_id {
            ids.insert(s);
        }
    }
    if let Ok(names) = state
        .esi
        .resolve_names(&ids.into_iter().collect::<Vec<_>>())
        .await
    {
        for o in top_ores.iter_mut() {
            o.name = names.get(&o.id).cloned();
        }
        for r in recent.iter_mut() {
            r.type_name = names.get(&r.type_id).cloned();
        }
    }
    Ok(MiningSummary {
        total_units,
        entries,
        top_ores,
        recent,
    })
}

#[tauri::command]
pub async fn get_mining(character_id: i64, state: State<'_, AppState>) -> AppResult<MiningSummary> {
    build_mining(&state, Some(character_id)).await
}

/// Assets GLOBAL: agrega los assets de todos los personajes (suma por tipo).
#[tauri::command]
pub async fn get_assets_global(state: State<'_, AppState>) -> AppResult<AssetsSummary> {
    use std::collections::HashMap;
    let mut by_type: HashMap<i64, i64> = HashMap::new();
    let mut stacks = 0i64;
    let mut total_units = 0i64;
    let mut est_value = 0.0f64;

    for c in state.db.list_characters()? {
        if !c.scopes.iter().any(|s| s == "esi-assets.read_assets.v1") {
            continue;
        }
        let valid = match state
            .tokens
            .access_token(state.esi.http(), c.character_id)
            .await
        {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Ok(s) =
            assets::summary(&state.esi, &state.db, c.character_id, &valid.access_token).await
        {
            stacks += s.stacks;
            total_units += s.total_units;
            est_value += s.est_value;
            for nc in s.top_types {
                *by_type.entry(nc.id).or_insert(0) += nc.count;
            }
        }
    }

    let mut top: Vec<crate::db::NameCount> = by_type
        .into_iter()
        .map(|(id, count)| crate::db::NameCount {
            id,
            count,
            name: None,
            region: None,
        })
        .collect();
    top.sort_by(|a, b| b.count.cmp(&a.count));
    let distinct_types = top.len() as i64;
    top.truncate(20);

    let ids: Vec<i64> = top.iter().map(|n| n.id).collect();
    if let Ok(names) = state.esi.resolve_names(&ids).await {
        for n in top.iter_mut() {
            n.name = names.get(&n.id).cloned();
        }
    }

    Ok(AssetsSummary {
        stacks,
        distinct_types,
        total_units,
        est_value,
        top_types: top,
    })
}

/// Industria GLOBAL: jobs de todos los personajes, con el nombre de cada personaje.
#[tauri::command]
pub async fn get_industry_global(state: State<'_, AppState>) -> AppResult<Vec<JobView>> {
    let mut raw: Vec<(String, JobRaw)> = Vec::new();
    let mut ids: HashSet<i64> = HashSet::new();

    for c in state.db.list_characters()? {
        if !c
            .scopes
            .iter()
            .any(|s| s == "esi-industry.read_character_jobs.v1")
        {
            continue;
        }
        let valid = match state
            .tokens
            .access_token(state.esi.http(), c.character_id)
            .await
        {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Ok(jobs) =
            industry::fetch_jobs(&state.esi, &state.db, c.character_id, &valid.access_token).await
        {
            for j in jobs {
                ids.insert(j.blueprint_type_id);
                if let Some(p) = j.product_type_id {
                    ids.insert(p);
                }
                raw.push((c.name.clone(), j));
            }
        }
    }

    let names = state
        .esi
        .resolve_names(&ids.into_iter().collect::<Vec<_>>())
        .await
        .unwrap_or_default();
    let views = raw
        .into_iter()
        .map(|(cname, j)| JobView {
            job_id: j.job_id,
            activity: industry::activity_name(j.activity_id).to_string(),
            runs: j.runs,
            status: j.status,
            blueprint_name: names.get(&j.blueprint_type_id).cloned(),
            product_name: j.product_type_id.and_then(|p| names.get(&p).cloned()),
            end_date: j.end_date,
            character: Some(cname),
        })
        .collect();
    Ok(views)
}

/// Minería GLOBAL desde la BD acumulada (todos los personajes).
#[tauri::command]
pub async fn get_mining_global(state: State<'_, AppState>) -> AppResult<MiningSummary> {
    build_mining(&state, None).await
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct MiningOre {
    pub type_id: i64,
    pub type_name: Option<String>,
    pub units: i64,
    pub isk: f64,
}
#[derive(Debug, Clone, serde::Serialize)]
pub struct MiningSys {
    pub system_id: i64,
    pub units: i64,
}
#[derive(Debug, Clone, serde::Serialize)]
pub struct MiningMonth {
    pub month: String,
    pub units: i64,
    pub isk: f64,
}
#[derive(Debug, Clone, serde::Serialize)]
pub struct MiningDetail {
    pub units: i64,
    pub est_value: f64,
    pub ore_types: i64,
    pub by_ore: Vec<MiningOre>,
    pub by_system: Vec<MiningSys>,
    pub monthly: Vec<MiningMonth>,
}

/// Periodos (YYYY-MM) con minería de un personaje.
#[tauri::command]
pub async fn get_mining_periods(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<String>> {
    state.db.mining_periods(Some(character_id))
}

/// Periodos (YYYY-MM) con minería, global.
#[tauri::command]
pub async fn get_mining_periods_global(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    state.db.mining_periods(None)
}

async fn build_mining_detail(
    state: &AppState,
    filter: Option<i64>,
    period: &str,
) -> AppResult<MiningDetail> {
    use std::collections::HashMap;
    let prices = state.db.prices_map().unwrap_or_default();
    let price_of = |tid: i64| prices.get(&tid).copied().unwrap_or(0.0);

    let by_type = state.db.mining_by_type_period(filter, period)?;
    let units: i64 = by_type.iter().map(|(_, q)| *q).sum();
    let est_value: f64 = by_type
        .iter()
        .map(|(tid, q)| *q as f64 * price_of(*tid))
        .sum();
    let ore_types = by_type.len() as i64;

    let mut by_ore: Vec<MiningOre> = by_type
        .into_iter()
        .map(|(type_id, q)| MiningOre {
            type_id,
            type_name: None,
            units: q,
            isk: q as f64 * price_of(type_id),
        })
        .collect();
    by_ore.truncate(20);

    // Nombres de los minerales (best-effort).
    let ids: Vec<i64> = by_ore.iter().map(|o| o.type_id).collect();
    if let Ok(names) = state.esi.resolve_names(&ids).await {
        for o in by_ore.iter_mut() {
            o.type_name = names.get(&o.type_id).cloned();
        }
    }

    let by_system: Vec<MiningSys> = state
        .db
        .mining_by_system_period(filter, period)?
        .into_iter()
        .map(|(system_id, units)| MiningSys { system_id, units })
        .collect();

    // Tendencia mensual (histórica): agrega unidades e ISK por mes.
    let mut months: HashMap<String, (i64, f64)> = HashMap::new();
    for (ym, tid, q) in state.db.mining_monthly_by_type(filter)? {
        let e = months.entry(ym).or_insert((0, 0.0));
        e.0 += q;
        e.1 += q as f64 * price_of(tid);
    }
    let mut monthly: Vec<MiningMonth> = months
        .into_iter()
        .map(|(month, (units, isk))| MiningMonth { month, units, isk })
        .collect();
    monthly.sort_by(|a, b| a.month.cmp(&b.month));

    Ok(MiningDetail {
        units,
        est_value,
        ore_types,
        by_ore,
        by_system,
        monthly,
    })
}

/// Detalle de minería de un mes (KPIs, ore breakdown, por sistema, tendencia) de un personaje.
#[tauri::command]
pub async fn get_mining_detail(
    character_id: i64,
    period: String,
    state: State<'_, AppState>,
) -> AppResult<MiningDetail> {
    build_mining_detail(&state, Some(character_id), &period).await
}

/// Detalle de minería de un mes, global.
#[tauri::command]
pub async fn get_mining_detail_global(
    period: String,
    state: State<'_, AppState>,
) -> AppResult<MiningDetail> {
    build_mining_detail(&state, None, &period).await
}
