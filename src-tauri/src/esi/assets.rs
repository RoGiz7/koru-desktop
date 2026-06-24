//! Assets: descarga paginada y agregación por tipo. Lectura en vivo (cacheada por página).

use super::EsiClient;
use crate::db::{Db, NameCount};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Deserialize)]
pub struct AssetItem {
    pub type_id: i64,
    #[serde(default)]
    pub quantity: i64,
    #[serde(default)]
    pub location_id: i64,
}

#[derive(Debug, Clone, Deserialize)]
struct StationGeo {
    #[serde(default)]
    system_id: i64,
}
#[derive(Debug, Clone, Deserialize)]
struct StructureGeo {
    #[serde(default)]
    solar_system_id: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AssetsSummary {
    /// Número de stacks/entradas de assets.
    pub stacks: i64,
    /// Tipos distintos.
    pub distinct_types: i64,
    /// Cantidad total de unidades sumadas.
    pub total_units: i64,
    /// Valor estimado total (precio medio de mercado × cantidad). 0 si no hay precios aún.
    pub est_value: f64,
    /// Top tipos por cantidad (sin nombre; lo resuelve el comando).
    pub top_types: Vec<NameCount>,
}

/// Descarga todas las páginas de assets (1000/página) y agrega por tipo.
pub async fn summary(
    esi: &EsiClient,
    db: &Db,
    character_id: i64,
    token: &str,
) -> AppResult<AssetsSummary> {
    let mut by_type: HashMap<i64, i64> = HashMap::new();
    let mut stacks: i64 = 0;
    let mut total_units: i64 = 0;

    for page in 1..=250u32 {
        let path = format!("/characters/{character_id}/assets/?page={page}");
        let items: Vec<AssetItem> = match esi.get_cached(db, character_id, &path, Some(token)).await
        {
            Ok(v) => v,
            Err(AppError::NotFound) => break, // no hay más páginas
            Err(e) => {
                eprintln!("assets página {page} falló: {e}");
                break;
            }
        };
        if items.is_empty() {
            break;
        }
        let n = items.len();
        for it in &items {
            let q = it.quantity.max(1);
            *by_type.entry(it.type_id).or_insert(0) += q;
            stacks += 1;
            total_units += q;
        }
        if n < 1000 {
            break; // última página
        }
    }

    // Valoración con precios medios de mercado (si ya se sincronizaron).
    let prices = db.prices_map().unwrap_or_default();
    let est_value: f64 = by_type
        .iter()
        .map(|(tid, qty)| prices.get(tid).copied().unwrap_or(0.0) * (*qty as f64))
        .sum();

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
    let distinct_types = top.len() as i64;
    top.truncate(20);

    Ok(AssetsSummary {
        stacks,
        distinct_types,
        total_units,
        est_value,
        top_types: top,
    })
}

/// Agrega los assets por SISTEMA (nº de stacks). Resuelve la ubicación de cada asset:
/// estaciones NPC (público), estructuras Upwell (con token, best-effort) y assets en el espacio.
/// Los assets anidados en contenedores/naves se omiten (no se pueden resolver a sistema barato).
pub async fn by_system(
    esi: &EsiClient,
    db: &Db,
    character_id: i64,
    token: &str,
) -> AppResult<HashMap<i64, i64>> {
    // 1) Contar stacks por location_id.
    let mut by_loc: HashMap<i64, i64> = HashMap::new();
    for page in 1..=250u32 {
        let path = format!("/characters/{character_id}/assets/?page={page}");
        let items: Vec<AssetItem> = match esi.get_cached(db, character_id, &path, Some(token)).await
        {
            Ok(v) => v,
            Err(AppError::NotFound) => break,
            Err(e) => {
                eprintln!("assets(map) página {page} falló: {e}");
                break;
            }
        };
        if items.is_empty() {
            break;
        }
        let n = items.len();
        for it in &items {
            *by_loc.entry(it.location_id).or_insert(0) += 1;
        }
        if n < 1000 {
            break;
        }
    }

    // 2) Resolver location_id -> system_id (con caché en memoria).
    let mut by_sys: HashMap<i64, i64> = HashMap::new();
    let mut resolved: HashMap<i64, Option<i64>> = HashMap::new();
    for (loc_id, count) in by_loc {
        let sid = match resolved.get(&loc_id) {
            Some(c) => *c,
            None => {
                let r = resolve_location_system(esi, db, loc_id, token).await;
                resolved.insert(loc_id, r);
                r
            }
        };
        if let Some(s) = sid {
            *by_sys.entry(s).or_insert(0) += count;
        }
    }
    Ok(by_sys)
}

/// Resuelve un location_id a un solarSystemID de New Eden, o None si no aplica.
async fn resolve_location_system(
    esi: &EsiClient,
    db: &Db,
    loc_id: i64,
    token: &str,
) -> Option<i64> {
    // Asset directamente en el espacio (location_id = sistema).
    if (30_000_000..=30_999_999).contains(&loc_id) {
        return Some(loc_id);
    }
    // Estación NPC.
    if (60_000_000..=64_000_000).contains(&loc_id) {
        let geo: StationGeo = esi
            .get_cached(db, 0, &format!("/universe/stations/{loc_id}/"), None)
            .await
            .ok()?;
        return (geo.system_id != 0).then_some(geo.system_id);
    }
    // Estructura Upwell (requiere token y acceso; best-effort).
    if loc_id >= 1_000_000_000_000 {
        let geo: StructureGeo = esi
            .get_cached(db, 0, &format!("/universe/structures/{loc_id}/"), Some(token))
            .await
            .ok()?;
        return (geo.solar_system_id != 0).then_some(geo.solar_system_id);
    }
    None
}
