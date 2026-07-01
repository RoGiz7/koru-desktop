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
    /// Ruta del archivo SQLite en disco (para backup/restauración).
    pub db_path: std::path::PathBuf,
    pub tokens: TokenManager,
    pub esi: EsiClient,
    /// Bandera para cancelar una sincronización en curso.
    pub cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
    /// Vigilancia de intel en segundo plano (hilo nativo, sin throttle del SO).
    pub intel: std::sync::Arc<IntelWatch>,
}

// --- Copia de seguridad / restauración del histórico local ---
// Todo el histórico (journal, transacciones, minería, snapshots de patrimonio, killmails,
// cachés) vive SOLO en este SQLite. Si el usuario cambia de PC o reinstala, lo pierde todo.
// Estos comandos permiten exportarlo y restaurarlo (clave para el modelo local-first).
// Los refresh tokens NO están aquí: viven en el keychain del SO → en un PC nuevo basta
// con volver a iniciar sesión.

/// Ruta del archivo de "staging" donde dejamos una restauración pendiente. Se aplica en el
/// próximo arranque (ver `lib.rs`), porque no se puede reemplazar la BD mientras está abierta.
pub fn restore_staging_path(db_path: &std::path::Path) -> std::path::PathBuf {
    let mut p = db_path.as_os_str().to_owned();
    p.push(".restore");
    std::path::PathBuf::from(p)
}

/// Información de la BD local (ruta y tamaño) para mostrarla en el menú de Ajustes.
#[derive(Debug, Serialize)]
pub struct DbInfo {
    pub path: String,
    pub size: u64,
}

/// Devuelve la ruta y el tamaño (bytes) del archivo SQLite. El tamaño incluye, si existe,
/// el sidecar `-wal` (datos aún no consolidados) para reflejar el total real en disco.
#[tauri::command]
pub fn db_info(state: State<'_, AppState>) -> AppResult<DbInfo> {
    let path = &state.db_path;
    let mut size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let wal = path.with_extension("sqlite3-wal");
    if let Ok(m) = std::fs::metadata(&wal) {
        size += m.len();
    }
    Ok(DbInfo {
        path: path.to_string_lossy().to_string(),
        size,
    })
}

/// Crea una copia de seguridad consistente de la BD en `dest` (un único archivo .sqlite3).
/// Usa `VACUUM INTO`, que consolida también el WAL pendiente → copia íntegra y compacta
/// aunque la app esté en uso. Devuelve la ruta escrita.
#[tauri::command]
pub fn backup_db(state: State<'_, AppState>, dest: String) -> AppResult<String> {
    // VACUUM INTO falla si el destino ya existe; lo quitamos primero (el usuario ya
    // confirmó sobrescribir en el diálogo "Guardar como").
    if std::path::Path::new(&dest).exists() {
        std::fs::remove_file(&dest)
            .map_err(|e| AppError::Other(format!("no se pudo sobrescribir el destino: {e}")))?;
    }
    let conn = state
        .db
        .conn
        .lock()
        .map_err(|_| AppError::Other("la base de datos está ocupada".into()))?;
    conn.execute("VACUUM INTO ?1", [&dest])?;
    Ok(dest)
}

/// Borra las copias automáticas más antiguas dejando solo las `keep` más recientes.
/// `keep == 0` = conservar todas (no borra nada). El timestamp del nombre ordena por fecha.
fn prune_autobackups(dir: &str, keep: usize) -> std::io::Result<()> {
    if keep == 0 {
        return Ok(());
    }
    let mut files: Vec<std::path::PathBuf> = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("koru-autobackup-") && n.ends_with(".sqlite3"))
                .unwrap_or(false)
        })
        .collect();
    files.sort(); // orden ascendente por nombre = cronológico
    if files.len() > keep {
        for p in &files[..files.len() - keep] {
            let _ = std::fs::remove_file(p);
        }
    }
    Ok(())
}

/// Crea una copia automática en `dir` con nombre `koru-autobackup-FECHA.sqlite3` y rota las
/// antiguas (deja `keep`). Mismo motor que el backup manual (`VACUUM INTO`). La llama el
/// frontend cuando toca según la frecuencia configurada. Devuelve la ruta escrita.
#[tauri::command]
pub fn auto_backup(state: State<'_, AppState>, dir: String, keep: usize) -> AppResult<String> {
    let stamp = chrono::Local::now().format("%Y-%m-%d_%H%M%S").to_string();
    let dest = std::path::Path::new(&dir).join(format!("koru-autobackup-{stamp}.sqlite3"));
    let dest_str = dest.to_string_lossy().to_string();
    {
        let conn = state
            .db
            .conn
            .lock()
            .map_err(|_| AppError::Other("la base de datos está ocupada".into()))?;
        if dest.exists() {
            std::fs::remove_file(&dest)
                .map_err(|e| AppError::Other(format!("no se pudo escribir la copia: {e}")))?;
        }
        conn.execute("VACUUM INTO ?1", [&dest_str])?;
    }
    prune_autobackups(&dir, keep)
        .map_err(|e| AppError::Other(format!("no se pudieron rotar las copias antiguas: {e}")))?;
    Ok(dest_str)
}

/// Restaura un backup previamente exportado. No se puede reemplazar la BD mientras la
/// conexión está abierta, así que dejamos el archivo en "staging" junto a la BD y reiniciamos:
/// en el próximo arranque se aplica el reemplazo con la BD ya cerrada (ver `lib.rs`).
#[tauri::command]
pub fn restore_db(app: tauri::AppHandle, state: State<'_, AppState>, src: String) -> AppResult<()> {
    // 1) Validar que es una BD SQLite de Koru (abrir solo-lectura y comprobar el esquema).
    {
        let test = rusqlite::Connection::open_with_flags(
            &src,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .map_err(|e| AppError::Other(format!("no es una base de datos válida: {e}")))?;
        let n: i64 = test
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='characters'",
                [],
                |r| r.get(0),
            )
            .map_err(|e| AppError::Other(format!("no se pudo leer la copia: {e}")))?;
        if n == 0 {
            return Err(AppError::Other(
                "el archivo no parece una copia de Koru (falta la tabla characters)".into(),
            ));
        }
    }
    // 2) Copiar a <bd>.restore (staging). Se aplica en el próximo arranque.
    let staging = restore_staging_path(&state.db_path);
    std::fs::copy(&src, &staging)
        .map_err(|e| AppError::Other(format!("no se pudo preparar la restauración: {e}")))?;
    // 3) Reiniciar para aplicar el reemplazo con la BD cerrada. `restart()` normalmente no
    // retorna (-> !); el `Ok(())` queda por si la versión de Tauri lo tipa como `()`.
    app.restart();
    #[allow(unreachable_code)]
    Ok(())
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

    let prices = state.db.prices_map().unwrap_or_default();
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
                asset_value = s.est_value_clean; // patrimonio sin blueprints inflados
                have_data = true;
                // Papeles redimibles: snapshot del stock del día desde el mismo summary (sin ESI extra).
                for (&tid, &qty) in &s.watched {
                    let value = qty as f64 * prices.get(&tid).copied().unwrap_or(0.0);
                    let _ = state
                        .db
                        .insert_paper_snapshot(c.character_id, &today, tid, qty, value);
                }
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

/// Cancela un login en curso (p. ej. el usuario cerró la pestaña del navegador sin completar).
/// Libera el listener loopback para que `login` deje de esperar y la UI se desbloquee.
#[tauri::command]
pub fn cancel_login() {
    sso::callback::request_cancel();
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

// ---- Ratas especiales (oficiales / capitales NPC / bonus de faction) ----
#[derive(Debug, serde::Deserialize)]
struct NpcTypeInfo {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    group_id: i64,
}
#[derive(Debug, serde::Deserialize)]
struct NpcGroupInfo {
    #[serde(default)]
    name: Option<String>,
}

/// Prefijos de nombre de las variantes elite de faction pirata (las "bonus" del rateo).
const FACTION_PREFIXES: &[&str] = &["Domination", "Dread Guristas", "True Sansha", "Dark Blood", "Shadow"];

/// Desglose "typeID: n,typeID: n…" → [(type_id, count)].
fn parse_rat_breakdown(reason: &str) -> Vec<(i64, i64)> {
    reason
        .split(',')
        .filter_map(|p| {
            let mut it = p.split(':');
            let tid = it.next()?.trim().parse::<i64>().ok()?;
            let cnt = it.next()?.trim().parse::<i64>().ok()?;
            Some((tid, cnt))
        })
        .collect()
}

/// Clasifica un NPC por su tipo (tipo→grupo, vía ESI cacheado): 'officer' | 'capital' | 'faction' |
/// 'normal'. Cachea SOLO si se resolvió (un fallo de red no se persiste como 'normal').
async fn classify_npc(esi: &EsiClient, db: &Db, type_id: i64) -> (Option<String>, String) {
    if let Some(c) = db.npc_class_get(type_id) {
        return c;
    }
    let resolved: Option<(Option<String>, String)> = async {
        let t: NpcTypeInfo = esi
            .get_cached(db, 0, &format!("/universe/types/{type_id}/"), None)
            .await
            .ok()?;
        let g: NpcGroupInfo = esi
            .get_cached(db, 0, &format!("/universe/groups/{}/", t.group_id), None)
            .await
            .ok()?;
        let gl = g.name.unwrap_or_default().to_lowercase();
        let name = t.name.clone().unwrap_or_default();
        let klass = if gl.contains("officer") {
            "officer"
        } else if gl.contains("titan") || gl.contains("dreadnought") || gl.contains("supercarrier") {
            "capital"
        } else if FACTION_PREFIXES.iter().any(|p| name.starts_with(p)) {
            "faction"
        } else {
            "normal"
        };
        Some((t.name, klass.to_string()))
    }
    .await;
    match resolved {
        Some((name, klass)) => {
            db.npc_class_put(type_id, name.as_deref(), &klass);
            (name, klass)
        }
        None => (None, "normal".to_string()), // sin cachear → se reintenta otra vez
    }
}

#[derive(Debug, Serialize)]
pub struct SpecialRat {
    pub type_id: i64,
    pub name: Option<String>,
    pub class: String, // 'officer' | 'capital' | 'faction'
    pub count: i64,
}
#[derive(Debug, Serialize)]
pub struct SpecialRatSystem {
    pub system_id: i64,
    pub total: i64,
    pub by_type: Vec<SpecialRat>,
}
#[derive(Debug, Serialize)]
pub struct SpecialRatsResult {
    pub total: i64,
    pub officers: i64,
    pub capitals: i64,
    pub faction: i64,
    pub by_type: Vec<SpecialRat>,
    pub by_system: Vec<SpecialRatSystem>,
}

/// Cuenta las "ratas especiales" (oficiales/capitales/faction bonus) a partir del desglose por tipo
/// guardado en los bounty_prizes del journal. Clasifica cada tipo vía ESI (cacheado por tipo).
/// Devuelve total global + desglose por tipo + desglose POR SISTEMA (con qué especiales caen dónde).
#[tauri::command]
pub async fn get_special_rats(
    character_id: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<SpecialRatsResult> {
    use std::collections::HashMap;
    let reasons = state.db.rat_bounty_reasons(character_id)?;
    let mut counts: HashMap<i64, i64> = HashMap::new(); // typeID -> count (global)
    let mut sys_counts: HashMap<i64, HashMap<i64, i64>> = HashMap::new(); // system -> typeID -> count
    for (sys, reason) in &reasons {
        for (tid, cnt) in parse_rat_breakdown(reason) {
            *counts.entry(tid).or_insert(0) += cnt;
            if let Some(s) = sys {
                *sys_counts.entry(*s).or_default().entry(tid).or_insert(0) += cnt;
            }
        }
    }
    // Clasifica cada typeID distinto una sola vez (cacheado por tipo).
    let mut cls: HashMap<i64, (Option<String>, String)> = HashMap::new();
    for tid in counts.keys() {
        let c = classify_npc(&state.esi, &state.db, *tid).await;
        cls.insert(*tid, c);
    }
    let is_special = |k: &str| matches!(k, "officer" | "capital" | "faction");

    let mut by_type: Vec<SpecialRat> = Vec::new();
    let (mut officers, mut capitals, mut faction) = (0i64, 0i64, 0i64);
    for (tid, cnt) in &counts {
        let (name, klass) = cls.get(tid).cloned().unwrap_or((None, "normal".into()));
        match klass.as_str() {
            "officer" => officers += cnt,
            "capital" => capitals += cnt,
            "faction" => faction += cnt,
            _ => continue,
        }
        by_type.push(SpecialRat { type_id: *tid, name, class: klass, count: *cnt });
    }
    by_type.sort_by(|a, b| b.count.cmp(&a.count));

    let mut by_system: Vec<SpecialRatSystem> = Vec::new();
    for (sys, tmap) in sys_counts {
        let mut types: Vec<SpecialRat> = tmap
            .iter()
            .filter_map(|(tid, cnt)| {
                let (name, klass) = cls.get(tid)?;
                if is_special(klass) {
                    Some(SpecialRat {
                        type_id: *tid,
                        name: name.clone(),
                        class: klass.clone(),
                        count: *cnt,
                    })
                } else {
                    None
                }
            })
            .collect();
        if types.is_empty() {
            continue;
        }
        types.sort_by(|a, b| b.count.cmp(&a.count));
        let total = types.iter().map(|t| t.count).sum();
        by_system.push(SpecialRatSystem { system_id: sys, total, by_type: types });
    }
    by_system.sort_by(|a, b| b.total.cmp(&a.total));

    Ok(SpecialRatsResult {
        total: officers + capitals + faction,
        officers,
        capitals,
        faction,
        by_type,
        by_system,
    })
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

    // Sembrar el índice local de nombres con los rivales-PERSONAJE (tus enemigos recurrentes =
    // justo los que más salen en intel) → resolver pilotos del intel sin pegar a ESI.
    let seed: Vec<(i64, String)> = rivals
        .you_kill_chars
        .iter()
        .chain(rivals.kills_you_chars.iter())
        .filter_map(|e| e.name.clone().map(|n| (e.id, n)))
        .collect();
    state.db.name_cache_seed(&seed);

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

// ---- Serie temporal de wallet (histórico) para gráfica unificada estilo Ingresos PvE ----
#[derive(Debug, Serialize)]
pub struct WalletDay {
    pub date: String,
    pub income: f64,  // suma de amount > 0
    pub expense: f64, // suma de amount < 0 (negativo)
}
#[derive(Debug, Serialize)]
pub struct WalletCatDay {
    pub cat: String,
    pub date: String,
    pub net: f64,
}
#[derive(Debug, Serialize)]
pub struct WalletCharDay {
    pub character_id: i64,
    pub date: String,
    pub net: f64,
}
#[derive(Debug, Serialize)]
pub struct WalletSeries {
    pub daily: Vec<WalletDay>,
    pub by_cat: Vec<WalletCatDay>,
    pub by_char: Vec<WalletCharDay>,
}

fn build_wallet_series(state: &AppState, filter: Option<i64>) -> AppResult<WalletSeries> {
    use std::collections::HashMap;
    let rows = state.db.wallet_rows_full(filter)?;
    let mut daily: HashMap<String, (f64, f64)> = HashMap::new(); // date -> (income, expense)
    let mut cat_day: HashMap<(String, String), f64> = HashMap::new(); // (cat, date) -> net
    let mut char_day: HashMap<(i64, String), f64> = HashMap::new(); // (char, date) -> net
    for (date, ref_type, amount, cid) in rows {
        let day = date.get(0..10).unwrap_or(&date).to_string();
        let e = daily.entry(day.clone()).or_insert((0.0, 0.0));
        if amount >= 0.0 {
            e.0 += amount;
        } else {
            e.1 += amount;
        }
        let cat = crate::db::category_of(ref_type.as_deref().unwrap_or(""), amount).to_string();
        *cat_day.entry((cat, day.clone())).or_insert(0.0) += amount;
        *char_day.entry((cid, day)).or_insert(0.0) += amount;
    }
    let mut dvec: Vec<WalletDay> = daily
        .into_iter()
        .map(|(date, (income, expense))| WalletDay { date, income, expense })
        .collect();
    dvec.sort_by(|a, b| a.date.cmp(&b.date));
    let mut cvec: Vec<WalletCatDay> = cat_day
        .into_iter()
        .map(|((cat, date), net)| WalletCatDay { cat, date, net })
        .collect();
    cvec.sort_by(|a, b| a.date.cmp(&b.date));
    let mut hvec: Vec<WalletCharDay> = char_day
        .into_iter()
        .map(|((character_id, date), net)| WalletCharDay { character_id, date, net })
        .collect();
    hvec.sort_by(|a, b| a.date.cmp(&b.date));
    Ok(WalletSeries { daily: dvec, by_cat: cvec, by_char: hvec })
}

/// Serie temporal de wallet (histórico) de un personaje.
#[tauri::command]
pub async fn get_wallet_series(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<WalletSeries> {
    build_wallet_series(&state, Some(character_id))
}

/// Serie temporal de wallet (histórico), global.
#[tauri::command]
pub async fn get_wallet_series_global(state: State<'_, AppState>) -> AppResult<WalletSeries> {
    build_wallet_series(&state, None)
}

/// Devuelve resumen de skills: SP total, sin asignar, nº de skills y cola (con nombres).
/// Perfil de salto del personaje: niveles de las skills relevantes + naves de salto que posee.
/// JDC = Jump Drive Calibration (21611, rango), JFC = Jump Fuel Conservation (21610, fuel).
/// `owned` = type_ids distintos en sus assets (el frontend cruza con el catálogo de naves).
#[derive(Debug, Serialize)]
pub struct JumpProfile {
    pub jdc: i64,
    pub jfc: i64,
    pub owned: Vec<i64>,
}

#[tauri::command]
pub async fn get_jump_profile(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<JumpProfile> {
    // Skills (best-effort: si falta el scope, quedan en 0 y el usuario los ajusta a mano).
    let (mut jdc, mut jfc) = (0i64, 0i64);
    if let Ok(token) =
        token_with_scope(&state, character_id, "esi-skills.read_skills.v1", "Skills").await
    {
        if let Ok(s) = skills::skills(&state.esi, &state.db, character_id, &token).await {
            for sk in &s.skills {
                match sk.skill_id {
                    21611 => jdc = sk.active_skill_level,
                    21610 => jfc = sk.active_skill_level,
                    _ => {}
                }
            }
        }
    }
    // Naves que posee (best-effort: requiere scope de assets).
    let mut owned = Vec::new();
    if let Ok(token) =
        token_with_scope(&state, character_id, "esi-assets.read_assets.v1", "Assets").await
    {
        owned = assets::owned_type_ids(&state.esi, &state.db, character_id, &token)
            .await
            .unwrap_or_default();
    }
    Ok(JumpProfile { jdc, jfc, owned })
}

/// Fatiga de salto del personaje (timer azul). `jump_fatigue_expire_date` es cuándo expira
/// la fatiga actual; el frontend calcula los minutos restantes y estima el próximo salto.
#[derive(Debug, Serialize)]
pub struct FatigueInfo {
    pub jump_fatigue_expire_date: Option<String>,
    pub last_jump_date: Option<String>,
}

#[tauri::command]
pub async fn get_fatigue(character_id: i64, state: State<'_, AppState>) -> AppResult<FatigueInfo> {
    let token = token_with_scope(
        &state,
        character_id,
        "esi-characters.read_fatigue.v1",
        "Fatiga de salto",
    )
    .await?;
    #[derive(serde::Deserialize)]
    struct Raw {
        #[serde(default)]
        jump_fatigue_expire_date: Option<String>,
        #[serde(default)]
        last_jump_date: Option<String>,
    }
    let path = format!("/characters/{character_id}/fatigue/");
    match state
        .esi
        .get_cached::<Raw>(&state.db, character_id, &path, Some(&token))
        .await
    {
        Ok(r) => Ok(FatigueInfo {
            jump_fatigue_expire_date: r.jump_fatigue_expire_date,
            last_jump_date: r.last_jump_date,
        }),
        // Sin registro de fatiga (nunca ha saltado) = sin fatiga.
        Err(AppError::NotFound) => Ok(FatigueInfo {
            jump_fatigue_expire_date: None,
            last_jump_date: None,
        }),
        Err(e) => Err(e),
    }
}

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
pub struct PaperLoc {
    pub location_name: String,
    pub system_id: i64,
    pub quantity: i64,
}
/// Inventario de un tipo de "papel" (loot redimible) por fuente: cantidad, valor y dónde.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PaperGroup {
    pub source: String, // "abyssal" | "crab"
    pub type_id: i64,
    pub name: String,
    pub qty: i64,
    pub value: f64,
    pub by_loc: Vec<PaperLoc>,
}
#[derive(Debug, Clone, serde::Serialize)]
pub struct AbyssalsView {
    pub runs_est: i64,
    pub isk_spent: f64,
    pub by_filament: Vec<FilamentRow>,
    // Inventario de "papeles" en assets: totales + desglose por fuente (abyssal/CRAB).
    pub papers_qty: i64,
    pub papers_value: f64,
    pub papers_by_loc: Vec<PaperLoc>,
    pub papers: Vec<PaperGroup>,
}

/// typeIDs de los items-loot redimibles ("papeles") que se venden en el mercado, por fuente.
/// (type_id, source, nombre de fallback).
const PAPER_TYPES: &[(i64, &str, &str)] = &[
    (48121, "abyssal", "Triglavian Survey Database"),
    (60459, "crab", "Rogue Drone Infestation Data"),
];

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

    // Inventario de "papeles" (loot redimible) por fuente, leyendo los assets del personaje.
    let prices = state.db.prices_map().unwrap_or_default();
    let mut papers: Vec<PaperGroup> = Vec::new();
    let mut papers_qty = 0i64;
    let mut papers_value = 0f64;
    let mut papers_by_loc: Vec<PaperLoc> = Vec::new();
    if let Ok(atok) =
        token_with_scope(&state, character_id, "esi-assets.read_assets.v1", "Assets").await
    {
        let all_tokens = structure_tokens(&state).await;
        if let Ok(rows) =
            assets::detail(&state.esi, &state.db, character_id, &atok, &all_tokens).await
        {
            for &(tid, source, name) in PAPER_TYPES {
                let mut qty = 0i64;
                let mut by: HashMap<(String, i64), i64> = HashMap::new();
                for r in &rows {
                    if r.type_id == tid {
                        qty += r.quantity;
                        *by.entry((r.location_name.clone(), r.system_id)).or_insert(0) += r.quantity;
                    }
                }
                let mut by_loc: Vec<PaperLoc> = by
                    .into_iter()
                    .map(|((location_name, system_id), quantity)| PaperLoc {
                        location_name,
                        system_id,
                        quantity,
                    })
                    .collect();
                by_loc.sort_by(|a, b| b.quantity.cmp(&a.quantity));
                let value = qty as f64 * prices.get(&tid).copied().unwrap_or(0.0);
                papers_qty += qty;
                papers_value += value;
                papers_by_loc.extend(by_loc.iter().cloned());
                papers.push(PaperGroup {
                    source: source.to_string(),
                    type_id: tid,
                    name: name.to_string(),
                    qty,
                    value,
                    by_loc,
                });
            }
            papers_by_loc.sort_by(|a, b| b.quantity.cmp(&a.quantity));
        }
    }
    // Snapshot diario por typeID (acumula histórico: los assets no tienen fecha → foto del stock).
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    for g in &papers {
        let _ = state
            .db
            .insert_paper_snapshot(character_id, &today, g.type_id, g.qty, g.value);
    }

    Ok(AbyssalsView {
        runs_est,
        isk_spent,
        by_filament,
        papers_qty,
        papers_value,
        papers_by_loc,
        papers,
    })
}

/// Un punto de la serie de valor de papeles (por día y fuente) para la gráfica.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PaperDay {
    pub date: String,
    pub source: String,
    pub value: f64,
}
#[derive(Debug, Clone, serde::Serialize)]
pub struct PaperSeries {
    pub daily: Vec<PaperDay>,
}

fn source_of(type_id: i64) -> String {
    PAPER_TYPES
        .iter()
        .find(|t| t.0 == type_id)
        .map(|t| t.1.to_string())
        .unwrap_or_else(|| type_id.to_string())
}
/// Convierte los snapshots de stock en una serie ACUMULADA de "papeles ganados" (estilo wallet):
/// por cada typeID, recorre las fechas y suma SOLO los incrementos de unidades respecto a la lectura
/// anterior (las ventas no restan; bajadas de stock se ignoran). El valor de cada punto = unidades
/// acumuladas × precio de ese día (último precio conocido si ese día no había stock).
fn paper_days(pts: Vec<crate::db::PaperPoint>) -> Vec<PaperDay> {
    use std::collections::HashMap;
    let mut by_type: HashMap<i64, Vec<crate::db::PaperPoint>> = HashMap::new();
    for p in pts {
        by_type.entry(p.type_id).or_default().push(p);
    }
    let mut out: Vec<PaperDay> = Vec::new();
    for (tid, mut points) in by_type {
        points.sort_by(|a, b| a.date.cmp(&b.date));
        let source = source_of(tid);
        let mut prev_qty = 0i64;
        let mut cum_units = 0i64;
        let mut last_price = 0f64;
        for p in points {
            let price = if p.qty > 0 {
                p.value / p.qty as f64
            } else {
                last_price
            };
            if p.qty > 0 {
                last_price = price;
            }
            cum_units += (p.qty - prev_qty).max(0);
            prev_qty = p.qty;
            out.push(PaperDay {
                date: p.date,
                source: source.clone(),
                value: cum_units as f64 * price,
            });
        }
    }
    out.sort_by(|a, b| a.date.cmp(&b.date));
    out
}

/// Serie histórica del VALOR ESTIMADO de papeles (snapshot diario del inventario), por fuente.
#[tauri::command]
pub async fn get_paper_series(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<PaperSeries> {
    let pts = state.db.paper_history(character_id).unwrap_or_default();
    Ok(PaperSeries {
        daily: paper_days(pts),
    })
}
#[tauri::command]
pub async fn get_paper_series_global(state: State<'_, AppState>) -> AppResult<PaperSeries> {
    let pts = state.db.paper_history_global().unwrap_or_default();
    Ok(PaperSeries {
        daily: paper_days(pts),
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
    let ids: Vec<i64> = summary
        .top_types
        .iter()
        .map(|n| n.id)
        .chain(summary.top_value.iter().map(|t| t.type_id))
        .collect();
    if let Ok(names) = state.esi.resolve_names(&ids).await {
        for n in summary.top_types.iter_mut() {
            n.name = names.get(&n.id).cloned();
        }
        for t in summary.top_value.iter_mut() {
            t.name = names.get(&t.type_id).cloned();
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
    pub location_name: String,
    pub container: Option<String>,
    pub container_id: i64,
    pub container_type_id: i64,
    pub slot: String,
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
            location_name: r.location_name,
            container: r.container,
            container_id: r.container_id,
            container_type_id: r.container_type_id,
            slot: r.slot,
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
    let all_tokens = structure_tokens(&state).await;
    let rows = assets::detail(&state.esi, &state.db, character_id, &token, &all_tokens).await?;
    resolve_asset_detail(&state.esi, &state.db, rows).await
}

/// Access tokens de todos los pjs con scope de estructuras. Para resolver estructuras de jugador
/// "entre personajes": si el dueño de unos assets no tiene acceso a la citadel, otro alt puede.
async fn structure_tokens(state: &AppState) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(chars) = state.db.list_characters() {
        for c in chars {
            if c
                .scopes
                .iter()
                .any(|s| s == "esi-universe.read_structures.v1")
            {
                if let Ok(v) = state
                    .tokens
                    .access_token(state.esi.http(), c.character_id)
                    .await
                {
                    out.push(v.access_token);
                }
            }
        }
    }
    out
}

// ---- Gestor de fiteos local (importación EFT) ----

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct FitModule {
    pub type_id: i64,
    pub name: String,
    pub qty: i64,
    pub fitted: bool, // true = módulo en slot; false = drone/carga (línea con xN)
}

#[derive(Debug, serde::Serialize)]
pub struct FitView {
    pub id: i64,
    pub name: String,
    pub ship_type_id: i64,
    pub ship_name: String,
    pub modules: Vec<FitModule>,
    pub created_at: String,
}

/// Parsea un bloque EFT: devuelve (nave, nombre_fit, [(módulo, cantidad, fiteado)]).
/// EFT: 1ª línea `[Nave, Nombre]`; luego módulos (líneas `xN` = drones/carga; `Mod, Carga` = con carga).
fn parse_eft(eft: &str) -> Option<(String, String, Vec<(String, i64, bool)>)> {
    let mut lines = eft.lines();
    let header = lines.by_ref().map(|l| l.trim()).find(|l| !l.is_empty())?;
    let inner = header.strip_prefix('[')?.strip_suffix(']')?;
    let mut it = inner.splitn(2, ',');
    let ship = it.next()?.trim().to_string();
    let fit_name = it.next().unwrap_or("Fit").trim().to_string();
    if ship.is_empty() {
        return None;
    }
    let mut mods: Vec<(String, i64, bool)> = Vec::new();
    for l in lines {
        let l = l.trim();
        if l.is_empty() || l.starts_with('[') {
            continue; // separadores o "[Empty ... slot]"
        }
        // ¿cantidad al final " xN"? (drones/carga)
        let (namepart, qty, fitted) = match l.rfind(" x") {
            Some(idx) => {
                let num = l[idx + 2..].trim();
                match num.parse::<i64>() {
                    Ok(n) => (l[..idx].trim().to_string(), n, false),
                    Err(_) => (l.to_string(), 1, true),
                }
            }
            None => (l.to_string(), 1, true),
        };
        // módulo con carga: "Gun, Ammo" → nos quedamos con el módulo
        let name = namepart
            .split(',')
            .next()
            .unwrap_or(&namepart)
            .trim()
            .to_string();
        if !name.is_empty() {
            mods.push((name, qty, fitted));
        }
    }
    Some((ship, fit_name, mods))
}

/// Guarda un fiteo a partir de un bloque EFT pegado (resuelve type_ids vía ESI público).
#[tauri::command]
pub async fn save_fit(eft: String, state: State<'_, AppState>) -> AppResult<FitView> {
    let (ship, fit_name, mods) = parse_eft(&eft)
        .ok_or_else(|| AppError::Other("EFT no válido (falta la cabecera [Nave, Nombre]).".into()))?;
    // Resolver nombres → type_id (nave + módulos).
    let mut names: Vec<String> = vec![ship.clone()];
    names.extend(mods.iter().map(|(n, _, _)| n.clone()));
    let idmap = state.esi.type_ids(&names).await.unwrap_or_default();
    let ship_type_id = idmap.get(&ship).copied().unwrap_or(0);
    // Agregar módulos iguales (mismo nombre + tipo de slot).
    let mut agg: std::collections::HashMap<(String, bool), i64> = std::collections::HashMap::new();
    for (n, q, f) in &mods {
        *agg.entry((n.clone(), *f)).or_insert(0) += *q;
    }
    let modules: Vec<FitModule> = agg
        .into_iter()
        .map(|((name, fitted), qty)| FitModule {
            type_id: idmap.get(&name).copied().unwrap_or(0),
            name,
            qty,
            fitted,
        })
        .collect();
    let modules_json = serde_json::to_string(&modules)?;
    let id = state
        .db
        .fit_insert(&fit_name, ship_type_id, &ship, &eft, &modules_json)?;
    Ok(FitView {
        id,
        name: fit_name,
        ship_type_id,
        ship_name: ship,
        modules,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

/// Lista los fiteos guardados (más recientes primero).
#[tauri::command]
pub fn list_fits(state: State<'_, AppState>) -> AppResult<Vec<FitView>> {
    let rows = state.db.fit_list()?;
    Ok(rows
        .into_iter()
        .map(|r| FitView {
            id: r.id,
            name: r.name,
            ship_type_id: r.ship_type_id,
            ship_name: r.ship_name,
            modules: serde_json::from_str(&r.modules).unwrap_or_default(),
            created_at: r.created_at,
        })
        .collect())
}

/// Borra un fiteo guardado por id.
#[tauri::command]
pub fn delete_fit(id: i64, state: State<'_, AppState>) -> AppResult<()> {
    state.db.fit_delete(id)
}

/// Importa los fittings guardados en el juego del personaje (ESI). Evita duplicados por
/// (nombre, nave). Devuelve los recién importados.
#[tauri::command]
pub async fn import_fittings(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<FitView>> {
    let token = token_with_scope(
        &state,
        character_id,
        "esi-fittings.read_fittings.v1",
        "Fittings",
    )
    .await?;
    #[derive(serde::Deserialize)]
    struct EsiItem {
        type_id: i64,
        #[serde(default)]
        flag: String,
        #[serde(default)]
        quantity: i64,
    }
    #[derive(serde::Deserialize)]
    struct EsiFit {
        name: String,
        ship_type_id: i64,
        #[serde(default)]
        items: Vec<EsiItem>,
    }
    let path = format!("/characters/{character_id}/fittings/");
    let fittings: Vec<EsiFit> = state
        .esi
        .get_cached(&state.db, character_id, &path, Some(&token))
        .await?;
    // Resolver nombres (naves + módulos).
    let mut ids: HashSet<i64> = HashSet::new();
    for f in &fittings {
        ids.insert(f.ship_type_id);
        for it in &f.items {
            ids.insert(it.type_id);
        }
    }
    let names = state
        .esi
        .resolve_names(&ids.into_iter().collect::<Vec<_>>())
        .await
        .unwrap_or_default();
    // Evitar duplicados con lo ya guardado.
    let existing: HashSet<(String, i64)> = state
        .db
        .fit_list()?
        .into_iter()
        .map(|r| (r.name, r.ship_type_id))
        .collect();
    let is_slot = |fl: &str| {
        fl.starts_with("HiSlot")
            || fl.starts_with("MedSlot")
            || fl.starts_with("LoSlot")
            || fl.starts_with("RigSlot")
            || fl.starts_with("SubSystem")
    };
    let mut out = Vec::new();
    for f in fittings {
        if existing.contains(&(f.name.clone(), f.ship_type_id)) {
            continue;
        }
        let modules: Vec<FitModule> = f
            .items
            .iter()
            .map(|it| FitModule {
                type_id: it.type_id,
                name: names.get(&it.type_id).cloned().unwrap_or_default(),
                qty: it.quantity.max(1),
                fitted: is_slot(&it.flag),
            })
            .collect();
        let modules_json = serde_json::to_string(&modules)?;
        let ship_name = names.get(&f.ship_type_id).cloned().unwrap_or_default();
        let id = state
            .db
            .fit_insert(&f.name, f.ship_type_id, &ship_name, "", &modules_json)?;
        out.push(FitView {
            id,
            name: f.name,
            ship_type_id: f.ship_type_id,
            ship_name,
            modules,
            created_at: chrono::Utc::now().to_rfc3339(),
        });
    }
    Ok(out)
}

/// Conexión de wormhole pública de eve-scout (Thera/Turnur ↔ k-space). Para la capa del mapa.
#[derive(Debug, serde::Serialize)]
pub struct WhConn {
    pub system_id: i64, // sistema k-space conectado (lado "in")
    pub system_name: String,
    pub hub: String, // "Thera" o "Turnur" (lado "out")
    pub wh_type: String,
    pub max_ship_size: String,
    pub remaining_hours: i64,
}

/// Trae las conexiones públicas de Thera/Turnur de eve-scout (api.eve-scout.com). Público, sin token.
#[tauri::command]
pub async fn get_thera_connections(state: State<'_, AppState>) -> AppResult<Vec<WhConn>> {
    #[derive(serde::Deserialize)]
    struct Sig {
        #[serde(default)]
        in_system_id: i64,
        #[serde(default)]
        in_system_name: String,
        #[serde(default)]
        out_system_name: String,
        #[serde(default)]
        wh_type: Option<String>,
        #[serde(default)]
        max_ship_size: Option<String>,
        #[serde(default)]
        remaining_hours: Option<f64>,
    }
    let resp = state
        .esi
        .http()
        .get("https://api.eve-scout.com/v2/public/signatures")
        .header("Accept", "application/json")
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(AppError::Other(format!("eve-scout HTTP {}", resp.status())));
    }
    let body = resp.text().await?;
    let sigs: Vec<Sig> = serde_json::from_str(&body)?;
    let out: Vec<WhConn> = sigs
        .into_iter()
        .filter(|s| s.in_system_id != 0)
        .map(|s| WhConn {
            system_id: s.in_system_id,
            system_name: s.in_system_name,
            hub: s.out_system_name,
            wh_type: s.wh_type.unwrap_or_default(),
            max_ship_size: s.max_ship_size.unwrap_or_default(),
            remaining_hours: s.remaining_hours.unwrap_or(0.0).round() as i64,
        })
        .collect();
    Ok(out)
}

// ---- Intel en vivo (lectura de los logs de chat del juego) ----
// Read-only sobre los .txt de Documents\EVE\logs\Chatlogs\ (UTF-16LE). El matching de sistema,
// proximidad y alertas se hacen en el frontend (tiene neweden.json + Dijkstra).

/// Decodifica bytes UTF-16LE (salta el BOM si está) a String (lossy ante bytes sueltos).
fn decode_utf16le(bytes: &[u8]) -> String {
    let start = if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE {
        2
    } else {
        0
    };
    let u16s: Vec<u16> = bytes[start..]
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
    String::from_utf16_lossy(&u16s)
}

/// Lee un archivo de audio del disco (para el sonido de alerta personalizado). Best-effort.
#[tauri::command]
pub fn read_audio_file(path: String) -> AppResult<Vec<u8>> {
    std::fs::read(&path).map_err(|e| AppError::Other(format!("no se pudo leer el audio: {e}")))
}

/// Ruta por defecto de la carpeta de Chatlogs en Windows (Documents\EVE\logs\Chatlogs).
#[tauri::command]
pub fn default_chatlogs_dir() -> String {
    if let Ok(up) = std::env::var("USERPROFILE") {
        return format!("{up}\\Documents\\EVE\\logs\\Chatlogs");
    }
    String::new()
}

/// Lista los canales presentes en la carpeta (prefijo antes de `_AAAAMMDD_HHMMSS_charID.txt`).
#[tauri::command]
pub fn intel_channels(folder: String) -> AppResult<Vec<String>> {
    let mut set = std::collections::BTreeSet::new();
    if let Ok(rd) = std::fs::read_dir(&folder) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            let stem = match name.strip_suffix(".txt") {
                Some(s) => s,
                None => continue,
            };
            // Quitar los 3 últimos campos separados por '_' (fecha, hora, charID).
            let parts: Vec<&str> = stem.split('_').collect();
            if parts.len() >= 4 {
                let ch = parts[..parts.len() - 3].join("_");
                if !ch.is_empty() {
                    set.insert(ch);
                }
            }
        }
    }
    Ok(set.into_iter().collect())
}

/// Una línea de intel parseada de un log de chat.
#[derive(Debug, Serialize, Clone)]
pub struct IntelLine {
    pub ts_ms: i64,
    pub channel: String,
    pub author: String,
    pub message: String,
}

/// Parsea TODAS las líneas de un fichero ya decodificado (sin filtrar por recencia ni deduplicar).
/// Se cachea por fichero, así que parsear todo y filtrar luego permite reutilizar la caché.
fn parse_intel_text(text: &str, channel: &str) -> Vec<IntelLine> {
    let mut out = Vec::new();
    for raw in text.lines() {
        let line = raw
            .trim_start_matches(|c: char| c.is_control() || c == '\u{feff}')
            .trim();
        if !line.starts_with('[') {
            continue;
        }
        let close = match line.find(']') {
            Some(i) => i,
            None => continue,
        };
        let ts_str = line[1..close].trim();
        let rest = line[close + 1..].trim();
        let (author, message) = match rest.split_once(" > ") {
            Some((a, m)) => (a.trim().to_string(), m.trim().to_string()),
            None => continue,
        };
        if author == "EVE System" || author == "Sistema EVE" || message.is_empty() {
            continue;
        }
        let ndt = match chrono::NaiveDateTime::parse_from_str(ts_str, "%Y.%m.%d %H:%M:%S") {
            Ok(d) => d,
            Err(_) => continue,
        };
        let dt = chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(ndt, chrono::Utc);
        out.push(IntelLine {
            ts_ms: dt.timestamp_millis(),
            channel: channel.to_string(),
            author,
            message,
        });
    }
    out
}

/// Caché de parseo por fichero: ruta → (mtime_ns, tamaño, líneas). Evita re-decodificar/re-parsear
/// en cada poll los logs que no han cambiado (una carpeta de EVE acumula cientos de ficheros).
type IntelCache = std::collections::HashMap<std::path::PathBuf, (u64, Vec<IntelLine>)>;
fn intel_cache() -> &'static std::sync::Mutex<IntelCache> {
    static C: std::sync::OnceLock<std::sync::Mutex<IntelCache>> = std::sync::OnceLock::new();
    C.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

/// Lee los logs de los `channels` indicados en `folder`, parsea las líneas de los últimos
/// `since_minutes`, deduplica entre personajes (mismo ts+autor+mensaje) y las devuelve por orden.
#[tauri::command]
pub fn read_intel(
    folder: String,
    channels: Vec<String>,
    since_minutes: i64,
) -> AppResult<Vec<IntelLine>> {
    collect_intel_lines(&folder, &channels, since_minutes)
}

/// Núcleo de lectura/parseo/dedup de intel (lo usan el comando `read_intel` y el hilo vigilante).
fn collect_intel_lines(
    folder: &str,
    channels: &[String],
    since_minutes: i64,
) -> AppResult<Vec<IntelLine>> {
    let cutoff = chrono::Utc::now() - chrono::Duration::minutes(since_minutes.max(1));
    let cutoff_ms = cutoff.timestamp_millis();
    let rd = std::fs::read_dir(folder)
        .map_err(|e| AppError::Other(format!("no se pudo leer la carpeta de logs: {e}")))?;
    let mut out: Vec<IntelLine> = Vec::new();
    let mut seen: HashSet<(i64, String, String)> = HashSet::new();
    let skip_before = cutoff - chrono::Duration::minutes(10);
    let cache = intel_cache();

    // 1ª pasada: un canal de intel es el MISMO feed para todos los alts → sus logs son idénticos.
    // Así que por canal nos quedamos SOLO con el fichero VIVO (el de mtime más reciente = la sesión
    // abierta del pj que está en ese canal ahora). Evita leer cientos de logs de sesiones viejas.
    // live[channel] = (mtime_ns, len, path)
    let mut live: std::collections::HashMap<String, (u128, u64, std::path::PathBuf)> =
        std::collections::HashMap::new();
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if !name.ends_with(".txt") {
            continue;
        }
        let ch = match channels.iter().find(|c| name.starts_with(&format!("{c}_"))) {
            Some(c) => c.clone(),
            None => continue,
        };
        let md = match e.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let modt = md.modified().ok();
        // Saltar ficheros claramente viejos (mtime muy anterior al cutoff).
        if let Some(mt) = modt {
            let mdt: chrono::DateTime<chrono::Utc> = mt.into();
            if mdt < skip_before {
                continue;
            }
        }
        let mtime_ns = modt
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let entry = live.entry(ch).or_insert((0, 0, e.path()));
        if mtime_ns >= entry.0 {
            *entry = (mtime_ns, md.len(), e.path());
        }
    }

    // 2ª pasada: parsear SOLO el log vivo de cada canal.
    // IMPORTANTE: en Windows, mientras EVE tiene el log abierto y escribiendo, el tamaño/fecha del
    // *metadata* del directorio NO se actualiza al vuelo → si cacheáramos por mtime+len del metadata,
    // la caché creería que el fichero no cambió y devolvería líneas viejas (el feed se "congela" hasta
    // reabrir Koru). Por eso leemos SIEMPRE el contenido real y cacheamos el parseo por el tamaño en
    // bytes de lo leído: si el fichero creció, el len cambia y reparseamos; si no, reutilizamos.
    for (ch, (_mtime_ns, _len, path)) in live {
        let bytes = match std::fs::read(&path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let blen = bytes.len() as u64;
        let mut lines: Option<Vec<IntelLine>> = None;
        if let Ok(c) = cache.lock() {
            if let Some((cl, cv)) = c.get(&path) {
                if *cl == blen {
                    lines = Some(cv.clone());
                }
            }
        }
        let lines = match lines {
            Some(v) => v,
            None => {
                let parsed = parse_intel_text(&decode_utf16le(&bytes), &ch);
                if let Ok(mut c) = cache.lock() {
                    c.insert(path.clone(), (blen, parsed.clone()));
                }
                parsed
            }
        };

        for l in lines {
            if l.ts_ms < cutoff_ms {
                continue;
            }
            let key = (l.ts_ms / 1000, l.author.clone(), l.message.clone());
            if !seen.insert(key) {
                continue; // duplicado entre personajes
            }
            out.push(l);
        }
    }
    out.sort_by_key(|l| l.ts_ms);
    Ok(out)
}

// ---- Vigilancia de intel en segundo plano (hilo nativo, sin throttle del SO) ----
// La detección (matching de sistema + proximidad BFS + decisión de alerta) corre aquí, así que
// la alarma salta aunque la ventana esté minimizada. Emite eventos al frontend:
//   "intel-lines" (Vec<IntelLine> recientes, para pintar) y "intel-alert" (alerta de proximidad).

#[derive(Clone)]
pub struct IntelWatchCfg {
    pub folder: String,
    pub channels: Vec<String>,
    pub recency_min: i64,
    /// Orígenes de proximidad: sistema del personaje + puntos de ancla elegidos.
    pub origins: Vec<i64>,
    pub alert_jumps: i64,
}

#[derive(Default)]
pub struct IntelGraph {
    pub name_to_id: std::collections::HashMap<String, i64>,
    pub id_to_name: std::collections::HashMap<i64, String>,
    pub adj: std::collections::HashMap<i64, Vec<i64>>,
}

#[derive(Default)]
pub struct IntelWatch {
    pub cfg: std::sync::Mutex<Option<IntelWatchCfg>>,
    pub graph: std::sync::Mutex<IntelGraph>,
    pub alerted: std::sync::Mutex<HashSet<String>>,
    pub started: std::sync::atomic::AtomicBool,
}

#[derive(Clone, Serialize)]
pub struct IntelAlertEvent {
    pub sys_id: i64,
    pub system: String,
    pub jumps: i64,
    pub author: String,
    pub message: String,
    pub ts_ms: i64,
}

/// Limpia un token igual que el frontend (quita puntuación final y `[*(` iniciales) y lo pasa a minúsculas.
fn clean_intel_token(t: &str) -> String {
    let t = t.trim_end_matches(|c: char| "*.,;:!?()".contains(c));
    let t = t.trim_start_matches(|c: char| "*([".contains(c));
    t.trim().to_lowercase()
}

/// BFS multi-origen: distancia (en saltos) al más cercano de varios orígenes.
fn intel_bfs(adj: &std::collections::HashMap<i64, Vec<i64>>, origins: &[i64]) -> std::collections::HashMap<i64, i64> {
    let mut dist = std::collections::HashMap::new();
    let mut q = std::collections::VecDeque::new();
    for &o in origins {
        if dist.insert(o, 0i64).is_none() {
            q.push_back(o);
        }
    }
    while let Some(cur) = q.pop_front() {
        let d = dist[&cur];
        if let Some(ns) = adj.get(&cur) {
            for &nb in ns {
                if !dist.contains_key(&nb) {
                    dist.insert(nb, d + 1);
                    q.push_back(nb);
                }
            }
        }
    }
    dist
}

/// Carga el grafo (nombres↔id + adyacencia) una vez. El frontend lo envía desde neweden.json.
#[tauri::command]
pub fn set_intel_graph(
    state: State<'_, AppState>,
    names: Vec<(String, i64)>,
    edges: Vec<(i64, i64)>,
) -> AppResult<()> {
    let mut g = IntelGraph::default();
    for (n, id) in names {
        g.name_to_id.insert(n.to_lowercase(), id);
        g.id_to_name.entry(id).or_insert(n);
    }
    for (a, b) in edges {
        g.adj.entry(a).or_default().push(b);
        g.adj.entry(b).or_default().push(a);
    }
    if let Ok(mut slot) = state.intel.graph.lock() {
        *slot = g;
    }
    Ok(())
}

/// Arranca (o reconfigura) la vigilancia de intel en segundo plano.
#[tauri::command]
pub fn start_intel_watch(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    folder: String,
    channels: Vec<String>,
    recency_minutes: i64,
    origins: Vec<i64>,
    alert_jumps: i64,
) -> AppResult<()> {
    if let Ok(mut c) = state.intel.cfg.lock() {
        *c = Some(IntelWatchCfg {
            folder,
            channels,
            recency_min: recency_minutes,
            origins,
            alert_jumps,
        });
    }
    // Arrancar el hilo una sola vez; en sucesivas llamadas solo cambia la cfg.
    if !state.intel.started.swap(true, std::sync::atomic::Ordering::SeqCst) {
        spawn_intel_thread(app, state.intel.clone());
    }
    Ok(())
}

/// Detiene la vigilancia (el hilo sigue vivo pero ocioso).
/// NO limpia el set de alertas ya emitidas: así, al reconfigurar (cambiar anclas/recencia/etc.,
/// que hace stop+start) no se re-disparan las alertas que ya viste. Las claves (sid-ts) caducan
/// solas porque los reportes viejos dejan de aparecer por el filtro de recencia.
#[tauri::command]
pub fn stop_intel_watch(state: State<'_, AppState>) -> AppResult<()> {
    if let Ok(mut c) = state.intel.cfg.lock() {
        *c = None;
    }
    Ok(())
}

fn spawn_intel_thread(app: tauri::AppHandle, watch: std::sync::Arc<IntelWatch>) {
    use std::hash::{Hash, Hasher};
    std::thread::spawn(move || {
        // Firma del último conjunto de líneas emitido: si no cambia, no re-emitimos
        // (evita re-render del frontend) ni re-evaluamos matching salvo que cambie la config.
        let mut last_sig: u64 = 0;
        let mut last_cfg_sig: u64 = 0;
        loop {
            let cfg = watch.cfg.lock().ok().and_then(|c| c.clone());
            let cfg = match cfg {
                Some(c) => c,
                None => {
                    std::thread::sleep(std::time::Duration::from_millis(1000));
                    continue;
                }
            };
            if cfg.channels.is_empty() || cfg.folder.is_empty() {
                std::thread::sleep(std::time::Duration::from_millis(1500));
                continue;
            }
            let lines =
                collect_intel_lines(&cfg.folder, &cfg.channels, cfg.recency_min).unwrap_or_default();

            // Firma barata de las líneas y de la config relevante para alertas.
            let mut h = std::collections::hash_map::DefaultHasher::new();
            for l in &lines {
                l.ts_ms.hash(&mut h);
                l.author.hash(&mut h);
                l.message.hash(&mut h);
            }
            let sig = h.finish();
            let mut hc = std::collections::hash_map::DefaultHasher::new();
            cfg.origins.hash(&mut hc);
            cfg.alert_jumps.hash(&mut hc);
            let cfg_sig = hc.finish();

            let lines_changed = sig != last_sig;
            let cfg_changed = cfg_sig != last_cfg_sig;
            // Si nada cambió (ni logs ni config), no hacemos trabajo ni despertamos al frontend.
            if !lines_changed && !cfg_changed {
                std::thread::sleep(std::time::Duration::from_millis(3000));
                continue;
            }
            last_sig = sig;
            last_cfg_sig = cfg_sig;

            // Solo re-emitimos (y re-renderiza el frontend) cuando cambian las líneas.
            if lines_changed {
                let _ = app.emit("intel-lines", &lines);
            }

            // Matching de sistemas + proximidad + alertas, con el grafo cargado.
            if let Ok(g) = watch.graph.lock() {
                if !g.name_to_id.is_empty() {
                    // rep: sistema -> (ts_ms, autor, mensaje), aplicando clears.
                    let mut rep: std::collections::HashMap<i64, (i64, String, String)> =
                        std::collections::HashMap::new();
                    for l in &lines {
                        let mut is_clear = false;
                        let mut matched: Vec<i64> = Vec::new();
                        for tok in l.message.split_whitespace() {
                            let c = clean_intel_token(tok);
                            if c.is_empty() {
                                continue;
                            }
                            if c == "clr" || c == "clear" || c == "cleared" {
                                is_clear = true;
                                continue;
                            }
                            if let Some(&sid) = g.name_to_id.get(&c) {
                                matched.push(sid);
                            }
                        }
                        for sid in matched {
                            if is_clear {
                                rep.remove(&sid);
                            } else {
                                rep.insert(sid, (l.ts_ms, l.author.clone(), l.message.clone()));
                            }
                        }
                    }
                    // Proximidad desde los orígenes (pj + anclas).
                    if !cfg.origins.is_empty() {
                        let dist = intel_bfs(&g.adj, &cfg.origins);
                        for (sid, (ts, author, message)) in &rep {
                            if let Some(&d) = dist.get(sid) {
                                if d <= cfg.alert_jumps {
                                    let key = format!("{sid}-{ts}");
                                    let is_new = watch
                                        .alerted
                                        .lock()
                                        .map(|mut a| a.insert(key))
                                        .unwrap_or(false);
                                    if is_new {
                                        let system = g
                                            .id_to_name
                                            .get(sid)
                                            .cloned()
                                            .unwrap_or_else(|| sid.to_string());
                                        // Notificación nativa del SO (visible/audible minimizado).
                                        use tauri_plugin_notification::NotificationExt;
                                        let _ = app
                                            .notification()
                                            .builder()
                                            .title(format!("⚠ Intel a {d} salto(s): {system}"))
                                            .body(format!("{author}: {message}"))
                                            .show();
                                        let _ = app.emit(
                                            "intel-alert",
                                            IntelAlertEvent {
                                                sys_id: *sid,
                                                system,
                                                jumps: d,
                                                author: author.clone(),
                                                message: message.clone(),
                                                ts_ms: *ts,
                                            },
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(3000));
        }
    });
}

#[derive(Debug, Serialize)]
pub struct IntelEntity {
    pub id: i64,
    pub name: String,
}
#[derive(Debug, Serialize)]
pub struct IntelEntities {
    pub characters: Vec<IntelEntity>,
    pub ships: Vec<IntelEntity>,
}

/// Resuelve una lista de nombres candidatos (de una línea de intel) a personajes y naves.
/// El frontend lo usa al abrir la tarjeta de detalle para enlazar a zKill y distinguir piloto/nave.
#[tauri::command]
pub async fn resolve_intel_entities(
    state: State<'_, AppState>,
    names: Vec<String>,
) -> AppResult<IntelEntities> {
    // Caché negativa: re-preguntar a ESI pasados N días por si el nombre se creó/renombró.
    const NEG_TTL_DAYS: i64 = 7;
    let now = chrono::Utc::now();
    let mut chars: Vec<IntelEntity> = Vec::new();
    let mut seen_ids: HashSet<i64> = HashSet::new();
    let mut unknown: Vec<String> = Vec::new();

    // 1) Resolver primero desde el índice local (0 red).
    for name in &names {
        let nl = name.trim().to_lowercase();
        if nl.is_empty() {
            continue;
        }
        match state.db.name_cache_get(&nl) {
            Some((Some(id), disp, _)) if id > 0 => {
                if seen_ids.insert(id) {
                    chars.push(IntelEntity {
                        id,
                        name: disp.unwrap_or_else(|| name.trim().to_string()),
                    });
                }
            }
            Some((Some(id), _, updated)) if id == -1 => {
                // negativa: válida solo si es reciente; si caducó, reintentar
                let fresh = updated
                    .and_then(|u| chrono::DateTime::parse_from_rfc3339(&u).ok())
                    .map(|t| now.signed_duration_since(t.with_timezone(&chrono::Utc)).num_days() < NEG_TTL_DAYS)
                    .unwrap_or(false);
                if !fresh {
                    unknown.push(name.trim().to_string());
                }
            }
            _ => unknown.push(name.trim().to_string()),
        }
    }

    // 2) Los desconocidos → ESI (una sola llamada en lote) y se cachean.
    if !unknown.is_empty() {
        let (esi_chars, _ships) = state.esi.resolve_entities(&unknown).await?;
        let mut resolved_lc: HashSet<String> = HashSet::new();
        for (id, nm) in esi_chars {
            state.db.name_cache_put(&nm.to_lowercase(), id, &nm);
            resolved_lc.insert(nm.to_lowercase());
            if seen_ids.insert(id) {
                chars.push(IntelEntity { id, name: nm });
            }
        }
        // Lo que mandamos y ESI NO devolvió como personaje → caché negativa.
        for n in &unknown {
            let nl = n.to_lowercase();
            if !resolved_lc.contains(&nl) {
                state.db.name_cache_put_negative(&nl);
            }
        }
    }

    Ok(IntelEntities {
        characters: chars,
        ships: Vec::new(),
    })
}

#[derive(Debug, serde::Deserialize)]
pub struct IntelSighting {
    pub name: String,
    #[serde(default)]
    pub system_id: Option<i64>,
    #[serde(default)]
    pub ts_ms: Option<i64>,
    #[serde(default)]
    pub ship_type_id: Option<i64>,
}

/// Registra avistamientos de pilotos del intel (cuenta menciones y último sistema). El frontend
/// envía SOLO las líneas nuevas (ya clasificadas: nombres que son piloto, no nave/jerga/sistema).
/// Cuando un nombre cruza `threshold` menciones y sigue sin resolver, se resuelve 1 vez por ESI
/// (en lote, acotado) → así un cazador habitual que NO está en Rivales/killmails acaba en el índice.
#[tauri::command]
pub async fn intel_record_sightings(
    state: State<'_, AppState>,
    sightings: Vec<IntelSighting>,
    threshold: Option<i64>,
) -> AppResult<usize> {
    for s in &sightings {
        let nl = s.name.trim().to_lowercase();
        if nl.is_empty() {
            continue;
        }
        state
            .db
            .name_cache_record_sighting(&nl, s.name.trim(), s.system_id);
        // Avistamiento persistente (modo cazador): requiere sistema y hora de la línea.
        if let (Some(system_id), Some(ts_ms)) = (s.system_id, s.ts_ms) {
            let cid = state
                .db
                .name_cache_get(&nl)
                .and_then(|(id, _, _)| id)
                .filter(|&x| x > 0);
            state
                .db
                .insert_sighting(&nl, cid, system_id, ts_ms, s.ship_type_id);
        }
    }
    // Auto-resolución diferida de los que ya son "habituales" y siguen sin id.
    let thr = threshold.unwrap_or(5).max(2);
    let due = state.db.name_cache_due_for_resolve(thr, 20);
    let mut resolved = 0usize;
    if !due.is_empty() {
        if let Ok((esi_chars, _ships)) = state.esi.resolve_entities(&due).await {
            let mut ok_lc: HashSet<String> = HashSet::new();
            for (id, nm) in esi_chars {
                state.db.name_cache_put(&nm.to_lowercase(), id, &nm);
                ok_lc.insert(nm.to_lowercase());
                resolved += 1;
            }
            // Los que ESI no devolvió como personaje → caché negativa (no reintentar en bucle).
            for n in &due {
                let nl = n.to_lowercase();
                if !ok_lc.contains(&nl) {
                    state.db.name_cache_put_negative(&nl);
                }
            }
        }
    }
    Ok(resolved)
}

/// Ranking de "hostiles habituales": pilotos más mencionados en intel (aprendidos del propio chat).
/// `last_system_id` lo mapea el frontend a nombre con su índice de sistemas.
#[tauri::command]
pub fn get_habitual_hostiles(
    state: State<'_, AppState>,
    min_count: Option<i64>,
    limit: Option<i64>,
) -> AppResult<Vec<crate::db::HabitualHostile>> {
    Ok(state
        .db
        .name_cache_habitual(min_count.unwrap_or(3).max(1), limit.unwrap_or(100)))
}

#[derive(Debug, serde::Serialize)]
pub struct TrackPoint {
    pub system_id: i64,
    pub ts_ms: i64,
}

/// Rastro histórico de un piloto (modo cazador): sus avistamientos persistentes (sistema + hora)
/// en orden cronológico, para pintar la polilínea del objetivo en el mapa entre sesiones.
#[tauri::command]
pub fn get_pilot_track(
    state: State<'_, AppState>,
    name: String,
    limit: Option<i64>,
) -> AppResult<Vec<TrackPoint>> {
    let nl = name.trim().to_lowercase();
    let pts = state.db.pilot_track(&nl, limit.unwrap_or(200).clamp(1, 1000));
    Ok(pts
        .into_iter()
        .map(|(system_id, ts_ms)| TrackPoint { system_id, ts_ms })
        .collect())
}

#[derive(Debug, serde::Serialize)]
pub struct CountItem {
    pub id: i64,
    pub count: i64,
}
#[derive(Debug, serde::Serialize)]
pub struct PilotProfile {
    pub name: String,
    pub character_id: Option<i64>,
    pub total: i64,
    pub first_ms: Option<i64>,
    pub last_ms: Option<i64>,
    pub by_system: Vec<CountItem>, // id = system_id
    pub by_ship: Vec<CountItem>,   // id = ship_type_id
    pub by_hour: Vec<i64>,         // 24 buckets (hora UTC 0-23)
}

/// Ficha del hostil (modo cazador): perfil agregado de un objetivo a partir de sus avistamientos
/// persistentes — total, primer/último visto, sistemas favoritos, naves y horas activas UTC.
#[tauri::command]
pub fn get_pilot_profile(state: State<'_, AppState>, name: String) -> AppResult<PilotProfile> {
    let nl = name.trim().to_lowercase();
    let (total, first_ms, last_ms, character_id) = state.db.pilot_stats(&nl);
    let by_system = state
        .db
        .pilot_by_system(&nl, 12)
        .into_iter()
        .map(|(id, count)| CountItem { id, count })
        .collect();
    let by_ship = state
        .db
        .pilot_by_ship(&nl, 10)
        .into_iter()
        .map(|(id, count)| CountItem { id, count })
        .collect();
    let by_hour = state.db.pilot_by_hour(&nl).to_vec();
    Ok(PilotProfile {
        name: name.trim().to_string(),
        character_id,
        total,
        first_ms,
        last_ms,
        by_system,
        by_ship,
        by_hour,
    })
}

/// Resultado de importar el CSV de wallet de corptools.
#[derive(Debug, serde::Serialize)]
pub struct ImportResult {
    pub total_rows: usize,        // filas leídas del CSV
    pub imported: usize,          // filas NUEVAS insertadas
    pub skipped_dup: usize,       // ya existían (dedup por id sintético)
    pub skipped_unknown: usize,   // Character no está entre tus personajes de Koru
    pub date_min: Option<String>, // rango del histórico importable
    pub date_max: Option<String>,
    pub by_char: Vec<(String, usize)>, // filas por personaje (de las reconocidas)
}

/// Fila del CSV de corptools. Solo mapeamos lo que va a wallet_journal; First/Second Party (nombres,
/// no ids) y Reason (texto libre, no formato ESI typeID:count) se ignoran a propósito.
#[derive(serde::Deserialize)]
struct CorptoolsRow {
    #[serde(rename = "Character")]
    character: String,
    #[serde(rename = "Date")]
    date: String,
    #[serde(rename = "Type")]
    ref_type: String,
    #[serde(rename = "amount", default)]
    amount: Option<f64>,
    #[serde(rename = "balance", default)]
    balance: Option<f64>,
    #[serde(rename = "Description", default)]
    description: String,
}

/// Importa el histórico de wallet exportado por corptools (Alliance Auth) a `wallet_journal`,
/// backfilleando años más allá de la ventana de ESI. Mapea Character(nombre)→character_id de TUS
/// personajes; genera un id SINTÉTICO NEGATIVO determinista (hash de char+fecha+tipo+amount+balance)
/// para dedup y para no colisionar con los ids reales de ESI (positivos). No trae reason/context_id
/// (el desglose por sistema y las ratas especiales del histórico no se pueden reconstruir del CSV).
#[tauri::command]
pub async fn import_wallet_csv(path: String, state: State<'_, AppState>) -> AppResult<ImportResult> {
    use std::collections::HashMap;
    use std::hash::{Hash, Hasher};

    // Mapa nombre(minúsculas) → character_id de tus personajes.
    let name_to_id: HashMap<String, i64> = state
        .db
        .list_characters()?
        .into_iter()
        .map(|c| (c.name.trim().to_lowercase(), c.character_id))
        .collect();

    let bytes = std::fs::read(&path)
        .map_err(|e| AppError::Other(format!("no se pudo leer el CSV: {e}")))?;
    let mut rdr = csv::ReaderBuilder::new()
        .flexible(true)
        .from_reader(bytes.as_slice());

    let mut rows: Vec<crate::db::JournalImportRow> = Vec::new();
    let mut total = 0usize;
    let mut skipped_unknown = 0usize;
    let mut by_char: HashMap<String, usize> = HashMap::new();
    let mut date_min: Option<String> = None;
    let mut date_max: Option<String> = None;

    for rec in rdr.deserialize::<CorptoolsRow>() {
        let r = match rec {
            Ok(r) => r,
            Err(_) => continue, // fila malformada → saltar
        };
        total += 1;
        let cid = match name_to_id.get(r.character.trim().to_lowercase().as_str()) {
            Some(&id) => id,
            None => {
                skipped_unknown += 1;
                continue;
            }
        };
        // id sintético negativo determinista.
        let mut h = std::collections::hash_map::DefaultHasher::new();
        cid.hash(&mut h);
        r.date.hash(&mut h);
        r.ref_type.hash(&mut h);
        r.amount.unwrap_or(0.0).to_bits().hash(&mut h);
        r.balance.unwrap_or(0.0).to_bits().hash(&mut h);
        let id: i64 = -((h.finish() >> 1) as i64) - 1;

        if date_min.as_deref().map_or(true, |d| r.date.as_str() < d) {
            date_min = Some(r.date.clone());
        }
        if date_max.as_deref().map_or(true, |d| r.date.as_str() > d) {
            date_max = Some(r.date.clone());
        }
        *by_char.entry(r.character.clone()).or_insert(0) += 1;

        let desc = r.description.trim();
        rows.push(crate::db::JournalImportRow {
            id,
            character_id: cid,
            date: r.date,
            ref_type: r.ref_type,
            amount: r.amount,
            balance: r.balance,
            description: if desc.is_empty() {
                None
            } else {
                Some(desc.to_string())
            },
        });
    }

    let imported = state.db.import_journal_rows(&rows).unwrap_or(0);
    let skipped_dup = rows.len().saturating_sub(imported);
    let mut by_char_v: Vec<(String, usize)> = by_char.into_iter().collect();
    by_char_v.sort_by(|a, b| b.1.cmp(&a.1));

    Ok(ImportResult {
        total_rows: total,
        imported,
        skipped_dup,
        skipped_unknown,
        date_min,
        date_max,
        by_char: by_char_v,
    })
}

/// Niveles de skill entrenados del personaje (skill_id → nivel activo). Para el skill-check de fits.
#[tauri::command]
pub async fn get_char_skill_levels(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<std::collections::HashMap<i64, i64>> {
    let token =
        token_with_scope(&state, character_id, "esi-skills.read_skills.v1", "Skills").await?;
    let s = skills::skills(&state.esi, &state.db, character_id, &token).await?;
    let mut m = std::collections::HashMap::new();
    for sk in &s.skills {
        m.insert(sk.skill_id, sk.active_skill_level);
    }
    Ok(m)
}

/// Lista detallada de assets global (todos los personajes con el scope).
#[tauri::command]
pub async fn get_assets_detail_global(state: State<'_, AppState>) -> AppResult<Vec<AssetDetailView>> {
    use std::collections::HashMap;
    let all_tokens = structure_tokens(&state).await;
    let mut agg: HashMap<(i64, i64, String, Option<String>, i64, i64, String), i64> = HashMap::new();
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
            assets::detail(&state.esi, &state.db, c.character_id, &valid.access_token, &all_tokens)
                .await
        {
            for r in rows {
                *agg
                    .entry((
                        r.type_id,
                        r.system_id,
                        r.location_name,
                        r.container,
                        r.container_id,
                        r.container_type_id,
                        r.slot,
                    ))
                    .or_insert(0) += r.quantity;
            }
        }
    }
    let mut rows: Vec<crate::esi::assets::AssetDetailRow> = agg
        .into_iter()
        .map(
            |(
                (
                    type_id,
                    system_id,
                    location_name,
                    container,
                    container_id,
                    container_type_id,
                    slot,
                ),
                quantity,
            )| {
                crate::esi::assets::AssetDetailRow {
                    type_id,
                    quantity,
                    system_id,
                    location_name,
                    container,
                    container_id,
                    container_type_id,
                    slot,
                }
            },
        )
        .collect();
    rows.sort_by(|a, b| b.quantity.cmp(&a.quantity));
    resolve_asset_detail(&state.esi, &state.db, rows).await
}

/// Una orden de mercado tal cual la devuelve ESI (campos que usamos).
#[derive(Debug, Clone, serde::Deserialize)]
struct OrderRaw {
    type_id: i64,
    #[serde(default)]
    order_id: i64,
    #[serde(default)]
    region_id: i64,
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
    duration: i64,
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
    pub duration: i64, // días de la orden (para calcular el vencimiento)
    // Competencia en TU misma estación (mismo tipo/lado, excluyendo tus órdenes):
    pub best_competitor: Option<f64>, // mejor precio rival (menor sell / mayor buy); None si no hay
    pub is_best: bool,                // ¿eres el mejor (no te han pisado)?
    pub competitors: i64,             // nº de órdenes rivales en tu estación
}

/// Resuelve sistema (caché) y nombres para una lista de órdenes.
async fn resolve_orders(
    esi: &EsiClient,
    db: &Db,
    token: &str,
    orders: Vec<OrderRaw>,
) -> AppResult<Vec<MarketOrderView>> {
    use std::collections::HashMap;
    // --- Competencia: libro público por (región, tipo, lado), una vez por combinación. ---
    let own_ids: HashSet<i64> = orders.iter().map(|o| o.order_id).collect();
    let mut books: HashMap<(i64, i64, bool), Vec<crate::esi::market::BookOrder>> = HashMap::new();
    for o in &orders {
        let key = (o.region_id, o.type_id, o.is_buy_order);
        if o.region_id != 0 && !books.contains_key(&key) {
            let ot = if o.is_buy_order { "buy" } else { "sell" };
            let book = crate::esi::market::region_orders(esi, db, o.region_id, o.type_id, ot).await;
            books.insert(key, book);
        }
    }

    // --- Sistemas (caché) + nombres. ---
    let mut sys_of: HashMap<i64, i64> = HashMap::new();
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
            // Competencia en TU MISMA estación, mismo lado, excluyendo tus propias órdenes.
            let empty: Vec<crate::esi::market::BookOrder> = Vec::new();
            let book = books
                .get(&(o.region_id, o.type_id, o.is_buy_order))
                .unwrap_or(&empty);
            let comp: Vec<f64> = book
                .iter()
                .filter(|b| b.location_id == o.location_id && !own_ids.contains(&b.order_id))
                .map(|b| b.price)
                .collect();
            let competitors = comp.len() as i64;
            let best_competitor = if comp.is_empty() {
                None
            } else if o.is_buy_order {
                Some(comp.iter().cloned().fold(f64::NEG_INFINITY, f64::max))
            } else {
                Some(comp.iter().cloned().fold(f64::INFINITY, f64::min))
            };
            let is_best = match best_competitor {
                None => true,
                Some(bc) => {
                    if o.is_buy_order {
                        o.price >= bc
                    } else {
                        o.price <= bc
                    }
                }
            };
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
                duration: o.duration,
                best_competitor,
                is_best,
                competitors,
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

/// Beneficio de trading REALIZADO por item (coste medio ponderado) desde las wallet_transactions.
#[derive(Debug, serde::Serialize)]
pub struct TradePnlItem {
    pub type_id: i64,
    pub name: Option<String>,
    pub bought_qty: i64,
    pub sold_qty: i64,
    pub avg_buy: f64,
    pub avg_sell: f64,
    pub revenue: f64, // total vendido
    pub cost: f64,    // coste (medio ponderado) de lo vendido
    pub profit: f64,  // revenue - cost (realizado, antes de impuestos)
    pub margin: f64,  // profit / revenue * 100
}
#[derive(Debug, serde::Serialize)]
pub struct PnlDay {
    pub date: String,
    pub profit: f64,
}
#[derive(Debug, serde::Serialize)]
pub struct TradePnl {
    pub total_profit: f64,
    pub total_revenue: f64,
    pub total_cost: f64,
    pub total_tax: f64, // transaction_tax + brokers_fee del journal
    pub items: Vec<TradePnlItem>,
    pub daily: Vec<PnlDay>, // beneficio realizado por día (fecha de venta)
}

#[derive(Default)]
struct PnlAcc {
    qty: i64,
    cost: f64,
    bought_qty: i64,
    bought_cost: f64,
    sold_qty: i64,
    revenue: f64,
    cogs: f64,
}

/// Coste medio ponderado: cada compra aumenta inventario+coste; cada venta realiza beneficio
/// (ingreso − coste medio de lo vendido). Si se vende más de lo comprado (histórico incompleto),
/// el inventario no baja de 0 (ese beneficio queda sobreestimado por falta de base de coste).
/// Devuelve (por-tipo, beneficio diario) — el diario atribuye el beneficio a la fecha de VENTA.
fn compute_pnl(
    txs: Vec<(String, i64, i64, f64, bool)>,
) -> (
    std::collections::HashMap<i64, PnlAcc>,
    std::collections::BTreeMap<String, f64>,
) {
    use std::collections::{BTreeMap, HashMap};
    let mut m: HashMap<i64, PnlAcc> = HashMap::new();
    let mut daily: BTreeMap<String, f64> = BTreeMap::new();
    for (date, type_id, quantity, price, is_buy) in txs {
        let a = m.entry(type_id).or_default();
        if is_buy {
            a.qty += quantity;
            a.cost += quantity as f64 * price;
            a.bought_qty += quantity;
            a.bought_cost += quantity as f64 * price;
        } else {
            let avg = if a.qty > 0 { a.cost / a.qty as f64 } else { 0.0 };
            let cogs = avg * quantity as f64;
            let profit_sale = quantity as f64 * price - cogs;
            a.sold_qty += quantity;
            a.revenue += quantity as f64 * price;
            a.cogs += cogs;
            a.qty -= quantity;
            a.cost -= cogs;
            if a.qty < 0 {
                a.qty = 0;
                a.cost = 0.0;
            }
            if date.len() >= 10 {
                *daily.entry(date[..10].to_string()).or_insert(0.0) += profit_sale;
            }
        }
    }
    (m, daily)
}

async fn build_pnl(
    esi: &EsiClient,
    db: &Db,
    character_id: Option<i64>,
) -> AppResult<TradePnl> {
    let txs = db.wallet_transactions_full(character_id)?;
    let (accs, daily_map) = compute_pnl(txs);
    let daily: Vec<PnlDay> = daily_map
        .into_iter()
        .map(|(date, profit)| PnlDay { date, profit })
        .collect();
    let mut items: Vec<TradePnlItem> = accs
        .into_iter()
        .filter(|(_, a)| a.sold_qty > 0) // solo lo realizado (vendido)
        .map(|(type_id, a)| {
            let profit = a.revenue - a.cogs;
            TradePnlItem {
                type_id,
                name: None,
                bought_qty: a.bought_qty,
                sold_qty: a.sold_qty,
                avg_buy: if a.bought_qty > 0 {
                    a.bought_cost / a.bought_qty as f64
                } else {
                    0.0
                },
                avg_sell: if a.sold_qty > 0 {
                    a.revenue / a.sold_qty as f64
                } else {
                    0.0
                },
                revenue: a.revenue,
                cost: a.cogs,
                profit,
                margin: if a.revenue > 0.0 {
                    profit / a.revenue * 100.0
                } else {
                    0.0
                },
            }
        })
        .collect();
    items.sort_by(|x, y| y.profit.partial_cmp(&x.profit).unwrap_or(std::cmp::Ordering::Equal));
    let total_profit: f64 = items.iter().map(|i| i.profit).sum();
    let total_revenue: f64 = items.iter().map(|i| i.revenue).sum();
    let total_cost: f64 = items.iter().map(|i| i.cost).sum();
    let total_tax = db.trading_tax(character_id);
    items.truncate(100); // el desglose muestra el top; los totales son de todo
    let ids: Vec<i64> = items.iter().map(|i| i.type_id).collect();
    if let Ok(names) = esi.resolve_names(&ids).await {
        for it in items.iter_mut() {
            it.name = names.get(&it.type_id).cloned();
        }
    }
    Ok(TradePnl {
        total_profit,
        total_revenue,
        total_cost,
        total_tax,
        items,
        daily,
    })
}

/// P&L de trading de un personaje (realizado por item, desde sus transacciones).
#[tauri::command]
pub async fn get_trading_pnl(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<TradePnl> {
    build_pnl(&state.esi, &state.db, Some(character_id)).await
}
/// P&L de trading GLOBAL (todas las transacciones de todos los personajes).
#[tauri::command]
pub async fn get_trading_pnl_global(state: State<'_, AppState>) -> AppResult<TradePnl> {
    build_pnl(&state.esi, &state.db, None).await
}

// ===================== Watchlist de mercado (Comercio Nivel 3) =====================

/// Estación principal (hub) de cada región comercial. Para dar precios de hub reales
/// (p.ej. Jita 4-4) en vez del mejor de toda la región (que mezcla estaciones lejanas).
fn hub_station_for_region(region_id: i64) -> i64 {
    match region_id {
        10000002 => 60003760, // The Forge  → Jita IV-4 CNAP
        10000043 => 60008494, // Domain     → Amarr VIII (Oris)
        10000032 => 60011866, // Sinq Laison→ Dodixie IX-20
        10000030 => 60004588, // Heimatar   → Rens VI-8
        10000042 => 60005686, // Metropolis → Hek VIII-12
        _ => 0,
    }
}

/// Un punto del histórico de precio/volumen (para la gráfica de tendencia).
#[derive(Debug, Serialize)]
pub struct HistPoint {
    pub date: String,
    pub average: f64,
    pub volume: i64,
}

/// Un nivel de precio del libro (órdenes agregadas al mismo precio), con volumen acumulado.
#[derive(Debug, Serialize)]
pub struct BookLevel {
    pub price: f64,
    pub volume: i64, // unidades a ese precio
    pub orders: i64, // nº de órdenes apiladas a ese precio
    pub cum: i64,    // volumen acumulado desde el mejor precio (para la barra de profundidad)
}

/// Un ítem vigilado con su foto de mercado (spread en el hub + tendencia histórica + libro).
#[derive(Debug, Serialize)]
pub struct WatchItem {
    pub type_id: i64,
    pub name: Option<String>,
    pub best_buy: f64,     // mejor compra en el hub (0 si no hay órdenes)
    pub best_sell: f64,    // mejor venta en el hub (0 si no hay órdenes)
    pub spread: f64,       // best_sell - best_buy
    pub margin: f64,       // (sell - buy) / sell  (fracción; UI la muestra en %)
    pub day_volume: i64,   // volumen del último día del histórico (región)
    pub avg_volume: i64,   // volumen medio de los últimos ~30 días (región)
    pub history: Vec<HistPoint>, // últimos ~120 días
    pub buy_levels: Vec<BookLevel>,  // paredes de compra (mayor precio primero), top niveles
    pub sell_levels: Vec<BookLevel>, // paredes de venta (menor precio primero), top niveles
}

/// Agrega órdenes por precio en niveles y calcula el volumen acumulado.
/// `is_buy` ordena mayor→menor (bids); si no, menor→mayor (asks). Devuelve los `top` mejores.
fn aggregate_levels(
    orders: &[crate::esi::market::BookOrder],
    is_buy: bool,
    top: usize,
) -> Vec<BookLevel> {
    use std::collections::HashMap;
    let mut by_price: HashMap<u64, (f64, i64, i64)> = HashMap::new();
    for o in orders {
        let e = by_price.entry(o.price.to_bits()).or_insert((o.price, 0, 0));
        e.1 += o.volume_remain;
        e.2 += 1;
    }
    let mut levels: Vec<(f64, i64, i64)> = by_price.into_values().collect();
    levels.sort_by(|a, b| {
        if is_buy {
            b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal)
        } else {
            a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal)
        }
    });
    levels.truncate(top);
    let mut cum = 0i64;
    levels
        .into_iter()
        .map(|(price, volume, orders)| {
            cum += volume;
            BookLevel {
                price,
                volume,
                orders,
                cum,
            }
        })
        .collect()
}

async fn build_watch_item(
    esi: &EsiClient,
    db: &Db,
    region_id: i64,
    type_id: i64,
    hub: i64,
    name: Option<String>,
) -> WatchItem {
    // Libro público del hub: mejor compra (máx) y mejor venta (mín) en la estación principal.
    let buys = crate::esi::market::region_orders(esi, db, region_id, type_id, "buy").await;
    let sells = crate::esi::market::region_orders(esi, db, region_id, type_id, "sell").await;
    // Filtra al hub; si el hub no tiene órdenes, cae a toda la región para no dar 0 engañoso.
    let hub_buy_orders: Vec<crate::esi::market::BookOrder> = {
        let f: Vec<_> = buys
            .iter()
            .filter(|b| b.location_id == hub)
            .cloned()
            .collect();
        if hub != 0 && !f.is_empty() { f } else { buys.clone() }
    };
    let hub_sell_orders: Vec<crate::esi::market::BookOrder> = {
        let f: Vec<_> = sells
            .iter()
            .filter(|s| s.location_id == hub)
            .cloned()
            .collect();
        if hub != 0 && !f.is_empty() { f } else { sells.clone() }
    };
    let best_buy = hub_buy_orders
        .iter()
        .map(|b| b.price)
        .fold(f64::NEG_INFINITY, f64::max);
    let best_sell = hub_sell_orders
        .iter()
        .map(|s| s.price)
        .fold(f64::INFINITY, f64::min);
    let best_buy = if best_buy.is_finite() { best_buy } else { 0.0 };
    let best_sell = if best_sell.is_finite() { best_sell } else { 0.0 };
    // Paredes del libro (top 12 niveles a cada lado) para el visor de profundidad.
    let buy_levels = aggregate_levels(&hub_buy_orders, true, 12);
    let sell_levels = aggregate_levels(&hub_sell_orders, false, 12);
    let spread = if best_sell > 0.0 && best_buy > 0.0 {
        best_sell - best_buy
    } else {
        0.0
    };
    let margin = if best_sell > 0.0 && best_buy > 0.0 {
        (best_sell - best_buy) / best_sell
    } else {
        0.0
    };

    // Histórico (región): tendencia de precio y volumen.
    let hist = crate::esi::market::region_history(esi, db, region_id, type_id).await;
    let day_volume = hist.last().map(|h| h.volume).unwrap_or(0);
    let tail: Vec<&crate::esi::market::HistoryEntry> = hist.iter().rev().take(30).collect();
    let avg_volume = if tail.is_empty() {
        0
    } else {
        (tail.iter().map(|h| h.volume).sum::<i64>()) / (tail.len() as i64)
    };
    let history: Vec<HistPoint> = hist
        .iter()
        .rev()
        .take(120)
        .rev()
        .map(|h| HistPoint {
            date: h.date.clone(),
            average: h.average,
            volume: h.volume,
        })
        .collect();

    WatchItem {
        type_id,
        name,
        best_buy,
        best_sell,
        spread,
        margin,
        day_volume,
        avg_volume,
        history,
        buy_levels,
        sell_levels,
    }
}

/// Watchlist de mercado: para cada tipo vigilado, spread en el hub de la región elegida
/// + tendencia histórica. Todo ESI público (libro + /history/), cacheado.
#[tauri::command]
pub async fn get_watchlist(
    region_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<WatchItem>> {
    let ids = state.db.watch_list()?;
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let names = state.esi.resolve_names(&ids).await.unwrap_or_default();
    let hub = hub_station_for_region(region_id);
    let mut out: Vec<WatchItem> = Vec::with_capacity(ids.len());
    for tid in ids {
        let item = build_watch_item(
            &state.esi,
            &state.db,
            region_id,
            tid,
            hub,
            names.get(&tid).cloned(),
        )
        .await;
        out.push(item);
    }
    Ok(out)
}

/// Añade un tipo a la watchlist de mercado.
#[tauri::command]
pub async fn watch_add(type_id: i64, state: State<'_, AppState>) -> AppResult<()> {
    state.db.watch_add(type_id)
}

/// Quita un tipo de la watchlist de mercado.
#[tauri::command]
pub async fn watch_remove(type_id: i64, state: State<'_, AppState>) -> AppResult<()> {
    state.db.watch_remove(type_id)
}

// ===================== Arbitraje entre hubs (Comercio Nivel 3d) =====================

/// Los 5 hubs comerciales (región, etiqueta). La estación se saca de hub_station_for_region.
const ARB_REGIONS: [(i64, &str); 5] = [
    (10000002, "Jita"),
    (10000043, "Amarr"),
    (10000032, "Dodixie"),
    (10000030, "Rens"),
    (10000042, "Hek"),
];

/// Mejor ruta de arbitraje/hauling de un ítem entre hubs: comprar al ask más barato,
/// vender al bid más caro (en hubs distintos).
#[derive(Debug, Serialize)]
pub struct ArbItem {
    pub type_id: i64,
    pub name: Option<String>,
    pub buy_hub: String,  // dónde compras (mejor venta = ask más bajo)
    pub buy_price: f64,
    pub sell_hub: String, // dónde vendes (mejor compra = bid más alto)
    pub sell_price: f64,
    pub profit: f64,      // por unidad (bid_destino - ask_origen)
    pub margin: f64,      // profit / buy_price (fracción; UI en %)
    pub dest_volume: i64, // volumen diario del ítem en la región destino (¿podrás colocarlo?)
}

/// Arbitraje entre hubs para los ítems vigilados. Para cada uno mira el mejor ask y bid
/// en cada hub y devuelve la mejor ruta cruzada (comprar en A, vender en B, A≠B).
/// PESADO: 5 regiones × 2 lados por ítem (todo ESI público y cacheado). Se pide bajo demanda.
#[tauri::command]
pub async fn get_arbitrage(state: State<'_, AppState>) -> AppResult<Vec<ArbItem>> {
    let ids = state.db.watch_list()?;
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let names = state.esi.resolve_names(&ids).await.unwrap_or_default();
    let n = ARB_REGIONS.len();
    let mut out: Vec<ArbItem> = Vec::new();
    for tid in ids {
        let mut asks = vec![0f64; n]; // mejor venta (ask) por hub
        let mut bids = vec![0f64; n]; // mejor compra (bid) por hub
        for (i, (region, _)) in ARB_REGIONS.iter().enumerate() {
            let station = hub_station_for_region(*region);
            let buys =
                crate::esi::market::region_orders(&state.esi, &state.db, *region, tid, "buy").await;
            let sells =
                crate::esi::market::region_orders(&state.esi, &state.db, *region, tid, "sell").await;
            let bid = buys
                .iter()
                .filter(|b| b.location_id == station)
                .map(|b| b.price)
                .fold(f64::NEG_INFINITY, f64::max);
            let ask = sells
                .iter()
                .filter(|s| s.location_id == station)
                .map(|s| s.price)
                .fold(f64::INFINITY, f64::min);
            bids[i] = if bid.is_finite() { bid } else { 0.0 };
            asks[i] = if ask.is_finite() { ask } else { 0.0 };
        }
        // Mejor ruta cruzada: comprar al ask en b, vender al bid en s, con b≠s.
        let mut best: Option<(usize, usize, f64)> = None;
        for b in 0..n {
            for s in 0..n {
                if b == s {
                    continue;
                }
                let ask = asks[b];
                let bid = bids[s];
                if ask > 0.0 && bid > 0.0 {
                    let profit = bid - ask;
                    if profit > 0.0 && best.map_or(true, |(_, _, p)| profit > p) {
                        best = Some((b, s, profit));
                    }
                }
            }
        }
        if let Some((b, s, profit)) = best {
            let dest_region = ARB_REGIONS[s].0;
            let hist =
                crate::esi::market::region_history(&state.esi, &state.db, dest_region, tid).await;
            let dest_volume = hist.last().map(|h| h.volume).unwrap_or(0);
            out.push(ArbItem {
                type_id: tid,
                name: names.get(&tid).cloned(),
                buy_hub: ARB_REGIONS[b].1.to_string(),
                buy_price: asks[b],
                sell_hub: ARB_REGIONS[s].1.to_string(),
                sell_price: bids[s],
                profit,
                margin: if asks[b] > 0.0 { profit / asks[b] } else { 0.0 },
                dest_volume,
            });
        }
    }
    out.sort_by(|a, b| {
        b.margin
            .partial_cmp(&a.margin)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(out)
}

// ===================== Buscador de oportunidades (Comercio Nivel 4) =====================

/// Una oportunidad de trading detectada al escanear un grupo de mercado en un hub.
/// Combina liquidez (histórico) con el spread real del libro del hub.
#[derive(Debug, Serialize)]
pub struct OppItem {
    pub type_id: i64,
    pub name: Option<String>,
    pub avg_volume: i64,       // volumen diario medio (30d, histórico de la región)
    pub avg_price: f64,        // precio medio reciente (30d)
    pub isk_volume: f64,       // liquidez diaria en ISK = avg_volume * avg_price
    pub best_buy: f64,         // mejor compra en el hub (bid más alto)
    pub best_sell: f64,        // mejor venta en el hub (ask más bajo)
    pub spread: f64,           // best_sell - best_buy
    pub margin: f64,           // spread / best_sell (fracción; UI en %)
    pub daily_potential: f64,  // spread * avg_volume → ISK/día teórico si capturas el spread
}

/// Escanea un grupo de mercado buscando oportunidades de station-trading en un hub.
/// Dos pasadas para respetar ESI:
///   1) Histórico por tipo (1 llamada/tipo, cache ~1 día) → filtra por liquidez (avg_volume).
///   2) Libro real del hub SOLO para los `top_books` más líquidos (2 llamadas/tipo, cache ~5min).
/// Devuelve los ítems con libro real, ordenados por potencial diario (spread × volumen).
/// El frontend pasa los type_ids del grupo (acotado); aquí se limita por seguridad.
#[tauri::command]
pub async fn scan_opportunities(
    region_id: i64,
    type_ids: Vec<i64>,
    min_volume: i64,
    top_books: usize,
    state: State<'_, AppState>,
) -> AppResult<Vec<OppItem>> {
    if type_ids.is_empty() {
        return Ok(Vec::new());
    }
    // Tope de seguridad: no escanear grupos enormes de un tirón (protege el rate limit de ESI).
    const MAX_TYPES: usize = 400;
    const MAX_BOOKS: usize = 40;
    let scan: Vec<i64> = type_ids.into_iter().take(MAX_TYPES).collect();
    let top_books = top_books.clamp(1, MAX_BOOKS);
    let min_volume = min_volume.max(0);
    let hub = hub_station_for_region(region_id);

    // ---- Pasada 1: liquidez desde el histórico (barata, cache ~1 día) ----
    struct Liq {
        type_id: i64,
        avg_volume: i64,
        avg_price: f64,
        isk_volume: f64,
    }
    let mut liq: Vec<Liq> = Vec::new();
    for tid in scan {
        let hist = crate::esi::market::region_history(&state.esi, &state.db, region_id, tid).await;
        if hist.is_empty() {
            continue;
        }
        let tail: Vec<&crate::esi::market::HistoryEntry> = hist.iter().rev().take(30).collect();
        let days = tail.len() as i64;
        if days == 0 {
            continue;
        }
        let avg_volume = tail.iter().map(|h| h.volume).sum::<i64>() / days;
        if avg_volume < min_volume {
            continue;
        }
        let avg_price = tail.iter().map(|h| h.average).sum::<f64>() / days as f64;
        liq.push(Liq {
            type_id: tid,
            avg_volume,
            avg_price,
            isk_volume: avg_volume as f64 * avg_price,
        });
    }
    // Los más líquidos primero: solo a estos les pedimos el libro real.
    liq.sort_by(|a, b| {
        b.isk_volume
            .partial_cmp(&a.isk_volume)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    liq.truncate(top_books);
    if liq.is_empty() {
        return Ok(Vec::new());
    }

    // ---- Pasada 2: spread real del libro del hub para los supervivientes ----
    let ids: Vec<i64> = liq.iter().map(|l| l.type_id).collect();
    let names = state.esi.resolve_names(&ids).await.unwrap_or_default();
    let mut out: Vec<OppItem> = Vec::with_capacity(liq.len());
    for l in liq {
        let buys =
            crate::esi::market::region_orders(&state.esi, &state.db, region_id, l.type_id, "buy")
                .await;
        let sells =
            crate::esi::market::region_orders(&state.esi, &state.db, region_id, l.type_id, "sell")
                .await;
        let best_buy = buys
            .iter()
            .filter(|b| hub == 0 || b.location_id == hub)
            .map(|b| b.price)
            .fold(f64::NEG_INFINITY, f64::max);
        let best_sell = sells
            .iter()
            .filter(|s| hub == 0 || s.location_id == hub)
            .map(|s| s.price)
            .fold(f64::INFINITY, f64::min);
        let best_buy = if best_buy.is_finite() { best_buy } else { 0.0 };
        let best_sell = if best_sell.is_finite() { best_sell } else { 0.0 };
        let (spread, margin) = if best_sell > 0.0 && best_buy > 0.0 && best_sell >= best_buy {
            (best_sell - best_buy, (best_sell - best_buy) / best_sell)
        } else {
            (0.0, 0.0)
        };
        // Potencial diario: spread capturable sobre el volumen diario.
        let daily_potential = spread * l.avg_volume as f64;
        out.push(OppItem {
            type_id: l.type_id,
            name: names.get(&l.type_id).cloned(),
            avg_volume: l.avg_volume,
            avg_price: l.avg_price,
            isk_volume: l.isk_volume,
            best_buy,
            best_sell,
            spread,
            margin,
            daily_potential,
        });
    }
    // Ordena por potencial diario (spread × volumen): las que más ISK/día pueden dar.
    out.sort_by(|a, b| {
        b.daily_potential
            .partial_cmp(&a.daily_potential)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(out)
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
    let mut watched_agg: HashMap<i64, i64> = HashMap::new();
    let mut stacks = 0i64;
    let mut total_units = 0i64;
    let mut est_value = 0.0f64;
    let mut est_value_clean = 0.0f64;
    let mut tv_agg: HashMap<i64, (i64, f64, String)> = HashMap::new();

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
            est_value_clean += s.est_value_clean;
            for tv in s.top_value {
                let e = tv_agg.entry(tv.type_id).or_insert((0, 0.0, tv.category));
                e.0 += tv.qty;
                e.1 += tv.value;
            }
            for (tid, qty) in s.watched {
                *watched_agg.entry(tid).or_insert(0) += qty;
            }
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

    // Top por VALOR agregado entre personajes (para el desglose del patrimonio).
    let mut top_value: Vec<crate::esi::assets::TypeValue> = tv_agg
        .into_iter()
        .map(|(type_id, (qty, value, category))| crate::esi::assets::TypeValue {
            type_id,
            qty,
            value,
            category,
            name: None,
        })
        .collect();
    top_value.sort_by(|a, b| b.value.partial_cmp(&a.value).unwrap_or(std::cmp::Ordering::Equal));
    top_value.truncate(30);
    let tv_ids: Vec<i64> = top_value.iter().map(|t| t.type_id).collect();
    if let Ok(names) = state.esi.resolve_names(&tv_ids).await {
        for t in top_value.iter_mut() {
            t.name = names.get(&t.type_id).cloned();
        }
    }

    Ok(AssetsSummary {
        stacks,
        distinct_types,
        total_units,
        est_value,
        est_value_clean,
        top_value,
        top_types: top,
        watched: watched_agg,
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

// ---- Serie temporal de minería (histórico completo) para gráfica unificada estilo Ingresos PvE ----
#[derive(Debug, Serialize)]
pub struct MineDay {
    pub date: String,
    pub value: f64,
    pub units: i64,
}
#[derive(Debug, Serialize)]
pub struct MineDimDay {
    pub id: i64, // system_id | character_id | type_id según el vector
    pub date: String,
    pub value: f64,
    pub units: i64,
}
#[derive(Debug, Serialize)]
pub struct MiningSeries {
    pub total_value: f64,
    pub total_units: i64,
    pub daily: Vec<MineDay>,
    pub daily_by_system: Vec<MineDimDay>,
    pub daily_by_char: Vec<MineDimDay>,
    pub daily_by_ore: Vec<MineDimDay>,
    pub ore_names: Vec<(i64, String)>,
}

// Datos de ore del SDE (volumen, portionSize, comprimido, materiales de reprocesado) embebidos.
#[derive(Debug, serde::Deserialize)]
struct OreInfo {
    #[allow(dead_code)]
    n: String,
    v: f64,        // volumen por unidad (m³)
    p: i64,        // portionSize (lote de reprocesado)
    c: i64,        // typeID comprimido (0 si no)
    r: Vec<(i64, i64)>, // materiales de reprocesado [(materialTypeID, cantidad por lote)]
}
fn ore_data() -> &'static std::collections::HashMap<i64, OreInfo> {
    static D: std::sync::OnceLock<std::collections::HashMap<i64, OreInfo>> =
        std::sync::OnceLock::new();
    D.get_or_init(|| serde_json::from_str(include_str!("../ore_data.json")).unwrap_or_default())
}
/// Valor por UNIDAD de un ore según el modo de valoración elegido.
/// modos: "units" | "m3" | "bruto" | "comp" | "reproc" (reprocesado al 85%).
fn ore_per_unit(raw_id: i64, mode: &str, prices: &std::collections::HashMap<i64, f64>) -> f64 {
    let price = |t: i64| prices.get(&t).copied().unwrap_or(0.0);
    let info = ore_data().get(&raw_id);
    match mode {
        "units" => 1.0,
        "m3" => info.map(|i| i.v).unwrap_or(0.0),
        "comp" => match info {
            Some(i) if i.c > 0 && i.p > 0 => price(i.c) / i.p as f64,
            _ => price(raw_id),
        },
        "reproc" => match info {
            Some(i) if i.p > 0 && !i.r.is_empty() => i
                .r
                .iter()
                .map(|(m, q)| (*q as f64 / i.p as f64) * 0.85 * price(*m))
                .sum(),
            _ => price(raw_id),
        },
        _ => price(raw_id), // "bruto"
    }
}

async fn build_mining_series(
    state: &AppState,
    filter: Option<i64>,
    mode: &str,
) -> AppResult<MiningSeries> {
    use std::collections::{HashMap, HashSet};
    let prices = state.db.prices_map().unwrap_or_default();
    let rows = state.db.mining_rows_full(filter)?;

    let mut daily: HashMap<String, (f64, i64)> = HashMap::new();
    let mut sys_day: HashMap<(i64, String), (f64, i64)> = HashMap::new();
    let mut char_day: HashMap<(i64, String), (f64, i64)> = HashMap::new();
    let mut ore_day: HashMap<(i64, String), (f64, i64)> = HashMap::new();
    let mut ore_ids: HashSet<i64> = HashSet::new();
    let mut total_value = 0.0f64;
    let mut total_units = 0i64;

    for (date, sys, tid, qty, cid) in rows {
        let d = match date.as_deref() {
            Some(d) => d.get(0..10).unwrap_or(d).to_string(),
            None => continue,
        };
        let val = qty as f64 * ore_per_unit(tid, mode, &prices);
        total_value += val;
        total_units += qty;
        ore_ids.insert(tid);
        let e = daily.entry(d.clone()).or_insert((0.0, 0));
        e.0 += val;
        e.1 += qty;
        let es = sys_day.entry((sys, d.clone())).or_insert((0.0, 0));
        es.0 += val;
        es.1 += qty;
        let ec = char_day.entry((cid, d.clone())).or_insert((0.0, 0));
        ec.0 += val;
        ec.1 += qty;
        let eo = ore_day.entry((tid, d)).or_insert((0.0, 0));
        eo.0 += val;
        eo.1 += qty;
    }

    let ids: Vec<i64> = ore_ids.into_iter().collect();
    let names = state.esi.resolve_names(&ids).await.unwrap_or_default();
    let ore_names: Vec<(i64, String)> = ids
        .iter()
        .map(|id| (*id, names.get(id).cloned().unwrap_or_else(|| format!("#{id}"))))
        .collect();

    let mut dvec: Vec<MineDay> = daily
        .into_iter()
        .map(|(date, (value, units))| MineDay { date, value, units })
        .collect();
    dvec.sort_by(|a, b| a.date.cmp(&b.date));
    let to_dim = |m: HashMap<(i64, String), (f64, i64)>| {
        let mut v: Vec<MineDimDay> = m
            .into_iter()
            .map(|((id, date), (value, units))| MineDimDay { id, date, value, units })
            .collect();
        v.sort_by(|a, b| a.date.cmp(&b.date));
        v
    };

    Ok(MiningSeries {
        total_value,
        total_units,
        daily: dvec,
        daily_by_system: to_dim(sys_day),
        daily_by_char: to_dim(char_day),
        daily_by_ore: to_dim(ore_day),
        ore_names,
    })
}

/// Serie temporal de minería (histórico) de un personaje.
#[tauri::command]
pub async fn get_mining_series(
    character_id: i64,
    mode: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<MiningSeries> {
    build_mining_series(&state, Some(character_id), mode.as_deref().unwrap_or("bruto")).await
}

/// Serie temporal de minería (histórico), global.
#[tauri::command]
pub async fn get_mining_series_global(
    mode: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<MiningSeries> {
    build_mining_series(&state, None, mode.as_deref().unwrap_or("bruto")).await
}
