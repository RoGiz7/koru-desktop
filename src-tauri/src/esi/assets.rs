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
    pub item_id: i64, // id único del stack (para subir por contenedores/naves)
    #[serde(default)]
    pub quantity: i64,
    #[serde(default)]
    pub location_id: i64,
    #[serde(default)]
    pub location_flag: Option<String>, // "AssetSafety" = en recuperación tras destruir la estructura
}

/// Descarga TODOS los items de assets paginando de forma RESILIENTE: reintenta cada página
/// ante errores transitorios (rate limit, 5xx) y solo para en el fin real (404/empty/página
/// corta). Antes, un único error en una página intermedia cortaba el bucle y se perdían las
/// páginas siguientes → faltaban assets (p. ej. naves en hangares de estación).
pub async fn fetch_all_assets(
    esi: &EsiClient,
    db: &Db,
    character_id: i64,
    token: &str,
) -> Vec<AssetItem> {
    let mut all: Vec<AssetItem> = Vec::new();
    let mut pages = 0u32;
    let mut errored = false;
    for page in 1..=250u32 {
        let path = format!("/characters/{character_id}/assets/?page={page}");
        let mut got: Option<Vec<AssetItem>> = None;
        for attempt in 1..=3u32 {
            match esi
                .get_cached::<Vec<AssetItem>>(db, character_id, &path, Some(token))
                .await
            {
                Ok(v) => {
                    got = Some(v);
                    break;
                }
                Err(AppError::NotFound) => {
                    got = Some(Vec::new()); // 404 = no hay más páginas
                    break;
                }
                Err(e) => {
                    eprintln!("assets pág {page} intento {attempt}/3: {e}");
                    errored = true;
                    tokio::time::sleep(std::time::Duration::from_millis(400 * attempt as u64)).await;
                }
            }
        }
        let items = match got {
            Some(v) => v,
            None => break, // 3 fallos seguidos: paramos para no colgarnos
        };
        if items.is_empty() {
            break; // página vacía = no hay más
        }
        pages += 1;
        all.extend(items);
        // NO paramos por "página corta": el endpoint de assets puede devolver páginas no llenas
        // en medio. Seguimos hasta una página vacía o 404 (parada real).
    }
    let _ = (pages, errored);
    all
}

/// Sube desde una ubicación anidada (un contenedor o nave que posees, cuyo id aparece como
/// `item_id` de otro asset) hasta la ubicación EXTERNA raíz (estación/estructura/espacio).
/// Así los assets dentro de contenedores/naves dejan de salir con sistema "—".
fn root_location(item_loc: &HashMap<i64, i64>, mut loc: i64) -> i64 {
    let mut hops = 0;
    while hops < 32 {
        match item_loc.get(&loc) {
            Some(&parent) if parent != loc => {
                loc = parent;
                hops += 1;
            }
            _ => break,
        }
    }
    loc
}

#[derive(Debug, Clone, Deserialize)]
struct StationGeo {
    #[serde(default)]
    system_id: i64,
    #[serde(default)]
    name: Option<String>,
}
#[derive(Debug, Clone, Deserialize)]
struct StructureGeo {
    #[serde(default)]
    solar_system_id: i64,
    #[serde(default)]
    name: Option<String>,
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

    // Paginación resiliente compartida (no se corta ante un error transitorio de una página).
    for it in fetch_all_assets(esi, db, character_id, token).await {
        let q = it.quantity.max(1);
        *by_type.entry(it.type_id).or_insert(0) += q;
        stacks += 1;
        total_units += q;
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

/// Conjunto de type_ids distintos que el personaje posee (para marcar naves propias, etc.).
/// Pagina igual que `summary` pero solo recolecta tipos.
pub async fn owned_type_ids(
    esi: &EsiClient,
    db: &Db,
    character_id: i64,
    token: &str,
) -> AppResult<Vec<i64>> {
    let items = fetch_all_assets(esi, db, character_id, token).await;
    let set: std::collections::HashSet<i64> = items.iter().map(|i| i.type_id).collect();
    Ok(set.into_iter().collect())
}

/// Fila de detalle de assets: un tipo en un sitio, con cantidad total.
#[derive(Debug, Clone, Serialize)]
pub struct AssetDetailRow {
    pub type_id: i64,
    pub quantity: i64,
    pub system_id: i64, // 0 = ubicación desconocida (estructura sin acceso)
    /// Nombre de la estación/estructura (o "espacio" si está en el espacio). Vacío si desconocido.
    pub location_name: String,
    /// Nombre del contenedor/nave que lo contiene (propio si lo tiene), o None si está suelto.
    pub container: Option<String>,
    /// item_id del contenedor/nave (0 si está suelto). Permite "abrir" el contenedor en la UI.
    pub container_id: i64,
    /// type_id del contenedor/nave (0 si suelto). Para renderizar la nave en el fit.
    pub container_type_id: i64,
    /// Slot/ubicación dentro del contenedor (location_flag: HiSlot0, MedSlot1, DroneBay, Cargo…).
    /// Vacío si está suelto en el hangar. Permite dibujar el fit de una nave.
    pub slot: String,
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

/// Resuelve una ubicación raíz a (system_id, nombre de estación/estructura).
/// Para estructuras de jugador prueba TODOS los tokens disponibles (resolución entre personajes):
/// si el dueño de los assets no tiene acceso pero un alt sí, se resuelve igual. Cachea el
/// resultado (positivo o negativo) en `location_system`; el negativo se limpia al arrancar.
async fn resolve_location_named(
    esi: &EsiClient,
    db: &Db,
    loc_id: i64,
    tokens: &[String],
) -> (i64, Option<String>) {
    // Asset directamente en el espacio (location_id = sistema).
    if (30_000_000..=30_999_999).contains(&loc_id) {
        return (loc_id, None);
    }
    // Estación NPC (endpoint público, sin token).
    if (60_000_000..=64_000_000).contains(&loc_id) {
        if let Ok(g) = esi
            .get_cached::<StationGeo>(db, 0, &format!("/universe/stations/{loc_id}/"), None)
            .await
        {
            return (g.system_id, g.name);
        }
        return (0, None);
    }
    // Estructura de jugador (Upwell): requiere token con acceso a esa estructura.
    if loc_id >= 1_000_000_000_000 {
        // Si ya sabemos que nadie tiene acceso, no reintentar.
        if db.location_system_get(loc_id) == Some(0) {
            return (0, Some("⚠ Estructura sin acceso".to_string()));
        }
        let path = format!("/universe/structures/{loc_id}/");
        // Probar todos los tokens (dueño + alts) hasta obtener sistema Y nombre. El endpoint está
        // cacheado por Expires, así que repetir es barato; así no se pierde el nombre entre pasadas.
        for tok in tokens {
            if let Ok(g) = esi
                .get_cached::<StructureGeo>(db, 0, &path, Some(tok.as_str()))
                .await
            {
                if g.solar_system_id != 0 {
                    db.location_system_put(loc_id, g.solar_system_id);
                    return (g.solar_system_id, g.name);
                }
            }
        }
        db.location_system_put(loc_id, 0); // ninguno tiene acceso
        return (0, Some("⚠ Estructura sin acceso".to_string()));
    }
    (0, None)
}

/// Lista de detalle agregada por (tipo, ubicación, contenedor), para el buscador de assets.
/// Resuelve nombre de estación/estructura y del contenedor/nave (nombre propio si lo tiene).
pub async fn detail(
    esi: &EsiClient,
    db: &Db,
    character_id: i64,
    token: &str,
    all_tokens: &[String],
) -> AppResult<Vec<AssetDetailRow>> {
    use std::collections::{HashMap as Map, HashSet};
    let items = fetch_all_assets(esi, db, character_id, token).await;
    let item_loc: Map<i64, i64> = items.iter().map(|i| (i.item_id, i.location_id)).collect();
    let item_type: Map<i64, i64> = items.iter().map(|i| (i.item_id, i.type_id)).collect();

    // 1) Agregar por (type_id, ubicación raíz, contenedor inmediato). El contenedor es el
    //    location_id cuando es a su vez un item propio (un contenedor/nave nuestro).
    let mut agg: Map<(i64, i64, i64, bool, String), i64> = Map::new();
    for it in &items {
        let container_id = if item_loc.contains_key(&it.location_id) {
            it.location_id
        } else {
            0
        };
        let safety = it.location_flag.as_deref() == Some("AssetSafety");
        // El slot solo importa dentro de un contenedor/nave (para dibujar el fit). Suelto = "".
        let slot = if container_id != 0 {
            it.location_flag.clone().unwrap_or_default()
        } else {
            String::new()
        };
        let root = root_location(&item_loc, it.location_id);
        *agg
            .entry((it.type_id, root, container_id, safety, slot))
            .or_insert(0) += it.quantity.max(1);
    }

    // 2) Resolver cada ubicación raíz -> (sistema, nombre estación/estructura).
    let roots: HashSet<i64> = agg.keys().map(|k| k.1).collect();
    let mut root_info: Map<i64, (i64, Option<String>)> = Map::new();
    for root in roots {
        let r = resolve_location_named(esi, db, root, all_tokens).await;
        root_info.insert(root, r);
    }

    // 3) Nombres propios de contenedores/naves (best-effort).
    let container_ids: Vec<i64> = agg
        .keys()
        .map(|k| k.2)
        .filter(|&c| c != 0)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let custom_names = esi
        .asset_names(character_id, token, &container_ids)
        .await
        .unwrap_or_default();

    // 4) resolve_names para sistemas (espacio) y tipos de contenedor sin nombre propio.
    let mut name_ids: HashSet<i64> = HashSet::new();
    for (sys, _) in root_info.values() {
        if *sys != 0 {
            name_ids.insert(*sys);
        }
    }
    for &cid in &container_ids {
        if !custom_names.contains_key(&cid) {
            if let Some(&t) = item_type.get(&cid) {
                name_ids.insert(t);
            }
        }
    }
    let names = esi
        .resolve_names(&name_ids.into_iter().collect::<Vec<_>>())
        .await
        .unwrap_or_default();

    // 5) Construir filas.
    let mut rows: Vec<AssetDetailRow> = agg
        .into_iter()
        .map(|((type_id, root, container_id, safety, slot), quantity)| {
            let (sys, locname) = root_info.get(&root).cloned().unwrap_or((0, None));
            let container_type_id = item_type.get(&container_id).copied().unwrap_or(0);
            let sysname = if sys != 0 { names.get(&sys).cloned() } else { None };
            // Nombre de ubicación: estación/estructura resuelta; si no, distinguir espacio real
            // (location_id en rango de sistema) de estructura sin nombre (no marcar "espacio").
            let mut location_name = if let Some(n) = locname {
                n
            } else if (30_000_000..=30_999_999).contains(&root) {
                sysname
                    .as_ref()
                    .map(|n| format!("espacio · {n}"))
                    .unwrap_or_default()
            } else if root >= 1_000_000_000_000 {
                sysname
                    .as_ref()
                    .map(|n| format!("estructura · {n}"))
                    .unwrap_or_else(|| "⚠ Estructura sin acceso".to_string())
            } else {
                sysname.clone().unwrap_or_default()
            };
            let mut container = if container_id != 0 {
                custom_names
                    .get(&container_id)
                    .cloned()
                    .or_else(|| item_type.get(&container_id).and_then(|t| names.get(t).cloned()))
            } else {
                None
            };
            // Asset Safety: la estructura origen suele estar destruida (no resuelve). Lo marcamos
            // claramente: hay que recuperarlos (pagando) en la estación de entrega.
            if safety {
                container = Some("📦 Asset Safety".to_string());
                if sys == 0 {
                    location_name = "⚠ Asset Safety (a recuperar)".to_string();
                }
            }
            AssetDetailRow {
                type_id,
                quantity,
                system_id: sys,
                location_name,
                container,
                container_id,
                container_type_id,
                slot,
            }
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
    // 1) Contar stacks por ubicación RAÍZ (subiendo por contenedores/naves).
    let items = fetch_all_assets(esi, db, character_id, token).await;
    let item_loc: HashMap<i64, i64> = items.iter().map(|i| (i.item_id, i.location_id)).collect();
    let mut by_loc: HashMap<i64, i64> = HashMap::new();
    for it in &items {
        let root = root_location(&item_loc, it.location_id);
        *by_loc.entry(root).or_insert(0) += 1;
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
