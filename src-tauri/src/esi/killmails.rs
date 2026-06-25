//! Sincronización de killmails: lista desde ESI (autenticada) + detalle público,
//! valor ISK best-effort desde zKillboard.

use super::EsiClient;
use crate::db::Db;
use crate::error::AppResult;
use serde::Deserialize;
use std::time::Duration;

#[derive(Debug, Clone, Deserialize)]
pub struct KillmailRef {
    pub killmail_id: i64,
    pub killmail_hash: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct KillmailDetail {
    pub killmail_id: i64,
    pub killmail_time: String,
    #[serde(default)]
    pub solar_system_id: Option<i64>,
    pub victim: Victim,
    #[serde(default)]
    pub attackers: Vec<Attacker>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Victim {
    #[serde(default)]
    pub character_id: Option<i64>,
    #[serde(default)]
    pub ship_type_id: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Attacker {
    #[serde(default)]
    pub character_id: Option<i64>,
    #[serde(default)]
    pub ship_type_id: Option<i64>,
    #[serde(default)]
    pub damage_done: i64,
    #[serde(default)]
    pub final_blow: bool,
}

/// Campos derivados del detalle relativos a un personaje (kill/loss, daño, etc.).
pub struct Derived {
    pub is_loss: bool,
    pub ship_type_id: Option<i64>,
    pub victim_ship_type_id: Option<i64>,
    pub solo: bool,
    pub char_damage: Option<i64>,
    pub final_blow: bool,
    pub top_damage: bool,
}

/// Calcula los campos derivados de un killmail para un personaje dado.
pub fn derive(detail: &KillmailDetail, character_id: i64) -> Derived {
    let is_loss = detail.victim.character_id == Some(character_id);
    let solo = detail.attackers.len() == 1;
    let victim_ship_type_id = detail.victim.ship_type_id;

    if is_loss {
        return Derived {
            is_loss,
            ship_type_id: detail.victim.ship_type_id,
            victim_ship_type_id,
            solo,
            char_damage: None,
            final_blow: false,
            top_damage: false,
        };
    }

    // Kill: buscamos la entrada del personaje entre los atacantes.
    let mine = detail
        .attackers
        .iter()
        .find(|a| a.character_id == Some(character_id));
    let char_damage = mine.map(|a| a.damage_done);
    let final_blow = mine.map(|a| a.final_blow).unwrap_or(false);
    let max_damage = detail
        .attackers
        .iter()
        .map(|a| a.damage_done)
        .max()
        .unwrap_or(0);
    let top_damage = char_damage
        .map(|d| d > 0 && d >= max_damage)
        .unwrap_or(false);

    Derived {
        is_loss,
        ship_type_id: mine.and_then(|a| a.ship_type_id),
        victim_ship_type_id,
        solo,
        char_damage,
        final_blow,
        top_damage,
    }
}

#[derive(Debug, Deserialize)]
struct ZkbWrapper {
    zkb: Zkb,
}
#[derive(Debug, Deserialize)]
struct Zkb {
    #[serde(rename = "totalValue", default)]
    total_value: f64,
}

/// Sincroniza los killmails recientes del personaje. Devuelve cuántos nuevos se guardaron.
pub async fn sync(
    esi: &EsiClient,
    db: &Db,
    character_id: i64,
    access_token: &str,
) -> AppResult<usize> {
    // 1) Lista de killmails recientes (autenticada, scope esi-killmails.read_killmails.v1).
    let list_path = format!("/characters/{character_id}/killmails/recent/");
    let refs: Vec<KillmailRef> = esi
        .get_cached(db, character_id, &list_path, Some(access_token))
        .await?;

    let existing = db.existing_killmail_ids(character_id)?;
    let mut new_count = 0usize;

    for km in refs.iter().filter(|k| !existing.contains(&k.killmail_id)) {
        // 2) Detalle público (id+hash). Inmutable -> caché bajo namespace 0, sin token.
        let detail_path = format!("/killmails/{}/{}/", km.killmail_id, km.killmail_hash);
        let detail: KillmailDetail = match esi.get_cached(db, 0, &detail_path, None).await {
            Ok(d) => d,
            Err(e) => {
                eprintln!("killmail {} detalle falló: {e}", km.killmail_id);
                continue;
            }
        };

        let d = derive(&detail, character_id);

        // 3) Valor ISK best-effort desde zKillboard (si falla, queda en None).
        let isk_value = fetch_zkb_value(esi, km.killmail_id).await;

        // Raw completo del killmail (ya cacheado por get_cached) para análisis futuros.
        let raw = db
            .get_cache(0, &detail_path)?
            .map(|c| c.payload)
            .unwrap_or_default();

        db.insert_killmail(&crate::db::KmInsert {
            killmail_id: km.killmail_id,
            hash: &km.killmail_hash,
            character_id,
            is_loss: d.is_loss,
            ship_type_id: d.ship_type_id,
            victim_ship_type_id: d.victim_ship_type_id,
            system_id: detail.solar_system_id,
            isk_value,
            killed_at: Some(&detail.killmail_time),
            solo: d.solo,
            char_damage: d.char_damage,
            final_blow: d.final_blow,
            top_damage: d.top_damage,
            raw: &raw,
        })?;
        new_count += 1;
    }

    db.touch_last_sync(character_id)?;
    Ok(new_count)
}

/// Reprocesa TODOS los killmails ya guardados recalculando los campos derivados
/// (nave víctima, daño, final blow, top damage) a partir del detalle ya CACHEADO.
/// No usa red. `progress(procesados)` para feedback.
pub fn reprocess<F: Fn(usize)>(db: &Db, progress: F) -> AppResult<usize> {
    let refs = db.all_killmail_refs()?;
    let mut done = 0usize;
    for (id, hash, character_id) in refs {
        let path = format!("/killmails/{id}/{hash}/");
        if let Ok(Some(c)) = db.get_cache(0, &path) {
            if let Ok(detail) = serde_json::from_str::<KillmailDetail>(&c.payload) {
                let d = derive(&detail, character_id);
                db.update_killmail_derived(
                    id,
                    d.victim_ship_type_id,
                    d.char_damage,
                    d.final_blow,
                    d.top_damage,
                    Some(&c.payload),
                )?;
            }
        }
        done += 1;
        if done % 50 == 0 {
            progress(done);
        }
    }
    progress(done);
    Ok(done)
}

/// Consulta el valor total del killmail en zKillboard. Best-effort: None si falla.
async fn fetch_zkb_value(esi: &EsiClient, killmail_id: i64) -> Option<f64> {
    let url = format!("https://zkillboard.com/api/killID/{killmail_id}/");
    let resp = esi.http().get(&url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let arr: Vec<ZkbWrapper> = resp.json().await.ok()?;
    arr.first().map(|w| w.zkb.total_value)
}

// --- Histórico completo vía zKillboard ---

/// Un kill tal como lo lista zKillboard: trae el hash, el valor y el flag solo.
#[derive(Debug, Clone, Deserialize)]
struct ZkbKill {
    killmail_id: i64,
    zkb: ZkbInfo,
}

#[derive(Debug, Clone, Deserialize)]
struct ZkbInfo {
    hash: String,
    #[serde(rename = "totalValue", default)]
    total_value: f64,
    #[serde(default)]
    solo: bool,
}

/// Descarga una página del historial de un personaje en zKillboard.
/// Devuelve vacío si no hay más páginas o si falla (best-effort).
async fn fetch_zkb_page(esi: &EsiClient, character_id: i64, page: u32) -> AppResult<Vec<ZkbKill>> {
    let url = format!("https://zkillboard.com/api/characterID/{character_id}/page/{page}/");
    for attempt in 1..=5u32 {
        let resp = esi.http().get(&url).send().await?;
        let status = resp.status().as_u16();
        // 429 = zKill rate limit: esperamos (Retry-After o backoff) y reintentamos,
        // para no cortar el histórico a medias.
        if status == 429 {
            let wait = resp
                .headers()
                .get("Retry-After")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(2u64.saturating_pow(attempt))
                .clamp(1, 60);
            eprintln!("zKill 429 en página {page}; back-off {wait}s (intento {attempt})");
            tokio::time::sleep(Duration::from_secs(wait)).await;
            continue;
        }
        if !resp.status().is_success() {
            return Ok(Vec::new());
        }
        return Ok(resp.json::<Vec<ZkbKill>>().await.unwrap_or_default());
    }
    // Si tras varios reintentos sigue limitado, devolvemos vacío (paramos limpio).
    Ok(Vec::new())
}

/// Sincroniza el historial COMPLETO desde zKillboard (no requiere token: usa el detalle
/// público de ESI). Pagina con throttle de 1s/página para respetar a zKill.
/// `progress(procesados_nuevos)` se invoca para feedback en la UI.
/// Devuelve cuántos killmails nuevos se guardaron.
pub async fn sync_full<F: Fn(usize, u32)>(
    esi: &EsiClient,
    db: &Db,
    character_id: i64,
    max_pages: u32,
    cancel: &std::sync::atomic::AtomicBool,
    progress: F,
) -> AppResult<usize> {
    use std::sync::atomic::Ordering;
    let mut existing = db.existing_killmail_ids(character_id)?;
    let mut new_count = 0usize;

    for page in 1..=max_pages {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let kills = fetch_zkb_page(esi, character_id, page).await?;
        if kills.is_empty() {
            break; // no hay más páginas
        }

        for k in &kills {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            if existing.contains(&k.killmail_id) {
                continue;
            }
            // Detalle público de ESI (inmutable -> cache namespace 0, sin token).
            let detail_path = format!("/killmails/{}/{}/", k.killmail_id, k.zkb.hash);
            let detail: KillmailDetail = match esi.get_cached(db, 0, &detail_path, None).await {
                Ok(d) => d,
                Err(e) => {
                    eprintln!("killmail {} detalle falló: {e}", k.killmail_id);
                    continue;
                }
            };

            let d = derive(&detail, character_id);
            let raw = db
                .get_cache(0, &detail_path)?
                .map(|c| c.payload)
                .unwrap_or_default();

            db.insert_killmail(&crate::db::KmInsert {
                killmail_id: k.killmail_id,
                hash: &k.zkb.hash,
                character_id,
                is_loss: d.is_loss,
                ship_type_id: d.ship_type_id,
                victim_ship_type_id: d.victim_ship_type_id,
                system_id: detail.solar_system_id,
                isk_value: Some(k.zkb.total_value),
                killed_at: Some(&detail.killmail_time),
                solo: k.zkb.solo,
                char_damage: d.char_damage,
                final_blow: d.final_blow,
                top_damage: d.top_damage,
                raw: &raw,
            })?;
            existing.insert(k.killmail_id);
            new_count += 1;
            if new_count % 10 == 0 {
                progress(new_count, page);
            }
        }

        progress(new_count, page);
        // Cortesía con zKillboard: máx ~1 petición de listado por segundo.
        tokio::time::sleep(Duration::from_secs(1)).await;
    }

    db.touch_last_sync(character_id)?;
    Ok(new_count)
}
