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

/// Fila de detalle de assets: un tipo en un sistema, con cantidad total.
#[derive(Debug, Clone, Serialize)]
pub struct AssetDetailRow {
    pub type_id: i64,
    pub quantity: i64,
    pub system_id: i64, // 0 = ubicación desconocida (contenedor/nave/estructura sin acceso)
}

#[derive(Debug, Clone, Deserialize)]
struct TypeInfo {
    #[serde(default)]
    group_id: i64,
}
#[derive(Debug, Clone, Deserialize)]
struct GroupInfo {
    #[serde(default)]
    category_id: i64,
}

/// Nombre de categoría legible a partir del categoryID de EVE (estables; fallback "Otros").
fn category_name(cat: i64) -> &'static str {
    match cat {
        6 => "Naves",
        7 => "Módulos",
        8 => "Cargas",
        9 => "Blueprints",
        18 => "Drones",
        87 => "Cazas",
        4 => "Materiales",
        25 => "Ore / Asteroides",
        17 => "Comercio",
        65 => "Estructuras",
        22 => "Desplegables",
        23 => "Starbase",
        32 => "Subsistemas",
        20 => "Implantes",
        _ => "Otros",
    }
}

/// Resuelve la categoría de un tipo (tipo→grupo→categoría) con caché persistente en DB.
/// Solo hace llamadas a ESI la primera vez por tipo; públicas y cacheadas (sin agotar error budget).
pub async fn resolve_category(esi: &EsiClient, db: &Db, type_id: i64) -> String {
    if let Some(c) = db.type_category_get(type_id) {
        return c;
    }
    let cat = async {
        let t: TypeInfo = esi
            .get_cached(db, 0, &format!("/universe/types/{type_id}/"), None)
            .await
            .ok()?;
        let g: GroupInfo = esi
            .get_cached(db, 0, &format!("/universe/groups/{}/", t.group_id), None)
            .await
            .ok()?;
        Some(category_name(g.category_id).to_string())
    }
    .await
    .unwrap_or_else(|| "Otros".to_string());
    db.type_category_put(type_id, &cat);
    cat
}

/// Lista de detalle agregada por (tipo, sistema), para el buscador de assets.
pub async fn detail(
    esi: &EsiClient,
    db: &Db,
    character_id: i64,
    token: &str,
) -> AppResult<Vec<AssetDetailRow>> {
    use std::collections::HashMap as Map;
    // 1) Agregar cantidad por (type_id, location_id).
    let mut agg: Map<(i64, i64), i64> = Map::new();
    for page in 1..=250u32 {
        let path = format!("/characters/{character_id}/assets/?page={page}");
        let items: Vec<AssetItem> = match esi.get_cached(db, character_id, &path, Some(token)).await {
            Ok(v) => v,
            Err(AppError::NotFound) => break,
            Err(e) => {
                eprintln!("assets(detail) página {page} falló: {e}");
                break;
            }
        };
        if items.is_empty() {
            break;
        }
        let n = items.len();
        for it in &items {
            *agg.entry((it.type_id, it.location_id)).or_insert(0) += it.quantity.max(1);
        }
        if n < 1000 {
            break;
        }
    }
    // 2) Resolver location_id -> system_id (cacheado) y reagrupar por (type_id, system_id).
    let mut sys_cache: Map<i64, Option<i64>> = Map::new();
    let mut by_type_sys: Map<(i64, i64), i64> = Map::new();
    for ((type_id, location_id), qty) in agg {
        // Resolución con caché persistente (incluye estructuras, una sola vez por ubicación).
        let sid = match sys_cache.get(&location_id) {
            Some(s) => *s,
            None => {
                let r = resolve_location_system_cached(esi, db, location_id, token).await;
                sys_cache.insert(location_id, r);
                r
            }
        }
        .unwrap_or(0);
        *by_type_sys.entry((type_id, sid)).or_insert(0) += qty;
    }
    let mut rows: Vec<AssetDetailRow> = by_type_sys
        .into_iter()
        .map(|((type_id, system_id), quantity)| AssetDetailRow {
            type_id,
            quantity,
            system_id,
        })
        .collect();
    rows.sort_by(|a, b| b.quantity.cmp(&a.quantity));
    Ok(rows)
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
                let r = resolve_location_system_cached(esi, db, loc_id, token).await;
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
            .get_cached(
                db,
                0,
                &format!("/universe/structures/{loc_id}/"),
                Some(token),
            )
            .await
            .ok()?;
        return (geo.solar_system_id != 0).then_some(geo.solar_system_id);
    }
    None
}

/// Resolución con CACHÉ PERSISTENTE. Resuelve espacio, estaciones NPC (público) y estructuras de
/// jugador (con el token del dueño), y guarda el resultado —incluido el fallo (system_id=0)— para
/// no reintentar y no agotar el error budget de ESI. Cada ubicación se resuelve como mucho una vez.
pub async fn resolve_location_system_cached(
    esi: &EsiClient,
    db: &Db,
    loc_id: i64,
    token: &str,
) -> Option<i64> {
    if let Some(s) = db.location_system_get(loc_id) {
        return if s != 0 { Some(s) } else { None };
    }
    let sid = resolve_location_system(esi, db, loc_id, token).await;
    db.location_system_put(loc_id, sid.unwrap_or(0));
    sid
}

/// Resolución LIGERA de location_id -> system_id: solo espacio y estaciones NPC (públicas).
/// NO consulta estructuras (evita los 403 que agotan el error budget de ESI). None si no aplica.
async fn resolve_location_system_light(esi: &EsiClient, db: &Db, loc_id: i64) -> Option<i64> {
    if (30_000_000..=30_999_999).contains(&loc_id) {
        return Some(loc_id);
    }
    if (60_000_000..=64_000_000).contains(&loc_id) {
        let geo: StationGeo = esi
            .get_cached(db, 0, &format!("/universe/stations/{loc_id}/"), None)
            .await
            .ok()?;
        return (geo.system_id != 0).then_some(geo.system_id);
    }
    None
}
