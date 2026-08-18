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
    /// `true` = el ítem está MONTADO/desapilado; `false` = empaquetado.
    ///
    /// Venía en la respuesta de ESI desde siempre y se tiraba. Importa para el pilar de transporte
    /// por dos motivos: una nave EMPAQUETADA no puede llevar nada hasta que la montes, y el volumen
    /// de lo montado no es el reempaquetado que usa `type_volumes.json` — si Koru suma el
    /// empaquetado de algo montado, dirá que cabe cuando no cabe.
    /// No entra en la clave de agregación a propósito: es un campo más, sin efecto en las vistas
    /// que ya existen.
    #[serde(default)]
    pub is_singleton: bool,
    /// `true` = es una COPIA de blueprint (BPC). ESI lo manda desde siempre y se descartaba.
    ///
    /// ⚠️ IMPORTA PARA EL DINERO, y por eso se rescató (2026-08-13, aviso de un jugador): un BPC y
    /// su BPO **comparten typeID**, así que valorar por typeID le pone a la copia el precio del
    /// original. Y no son lo mismo ni de lejos: **un BPC no se puede vender en el mercado**, solo
    /// por contrato. Poner precio de mercado a algo que no se vende en el mercado es valorar una
    /// cosa con el precio de otra.
    #[serde(default)]
    pub is_blueprint_copy: bool,
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
    fetch_all_assets_checked(esi, db, character_id, token).await.0
}

/// Igual que [`fetch_all_assets`], pero además dice si la foto está **COMPLETA**.
///
/// ⚠️ Esto es la diferencia entre un histórico fiable y uno que miente. Las vistas pueden vivir
/// con una foto a la que le falta una página (enseñan de menos y se nota); **el diff del
/// inventario NO**: lo que falta lo leería como «desapareció», y escribiría cientos de bajas
/// falsas por un 502 pasajero, sin un solo error a la vista. Un histórico que inventa
/// desapariciones es peor que no tener histórico, porque te fías de él.
///
/// `true` en el segundo campo = las páginas se bajaron todas sin un solo reintento fallido.
/// Cualquier otra cosa → quien diffee debe ABSTENERSE esta pasada y volver en la siguiente.
pub async fn fetch_all_assets_checked(
    esi: &EsiClient,
    db: &Db,
    character_id: i64,
    token: &str,
) -> (Vec<AssetItem>, bool) {
    let mut all: Vec<AssetItem> = Vec::new();
    let mut pages = 0u32;
    let mut errored = false;
    // Una página se dio por PERDIDA (3 intentos fallidos seguidos). No es lo mismo que `errored`:
    // un reintento que acaba bien deja la foto completa, y tratar los dos casos igual
    // significaría no diffear nunca en una tarde con ESI inestable.
    let mut lost = false;
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
            None => {
                // 3 fallos seguidos: paramos para no colgarnos. Esta página y TODAS las que
                // vinieran detrás se quedan fuera → la foto ya no vale para diffear.
                eprintln!("assets: página {page} perdida; foto INCOMPLETA, no se diffeará");
                lost = true;
                break;
            }
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
    (all, !lost)
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
    /// Tipo de la estructura (Sotiyo, Azbel, Raitaru…). ESI lo devuelve y hasta F1c se tiraba:
    /// con él sacamos del SDE sus bonos de industria sin preguntarle nada al usuario.
    #[serde(default)]
    type_id: Option<i64>,
}

/// typeIDs "vigilados" cuyas cantidades expone `summary` sin coste extra (ya están en `by_type`).
/// Papeles redimibles: 48121 Triglavian Survey Database (abyssal), 60459 Rogue Drone Infestation
/// Data (CRAB). Mantener sincronizado con PAPER_TYPES en commands.rs.
pub const WATCHED_TYPE_IDS: &[i64] = &[48121, 60459];

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
    /// Valor de assets EXCLUYENDO blueprints (categoría 9). El average_price de ESI para BPO/BPC es
    /// su valor BASE (a menudo decenas/cientos de B) → inflaba el patrimonio. Este es el "limpio".
    pub est_value_clean: f64,
    /// Top tipos por VALOR estimado (con categoría) — diagnóstico de dónde sale el valor de assets.
    pub top_value: Vec<TypeValue>,
    /// Top tipos por cantidad (sin nombre; lo resuelve el comando).
    pub top_types: Vec<NameCount>,
    /// Cantidad de los typeIDs vigilados (WATCHED_TYPE_IDS) — para acumular papeles sin coste extra.
    pub watched: std::collections::HashMap<i64, i64>,
}

/// Un tipo valorado (para el desglose "top assets por valor" y para excluir blueprints).
#[derive(Debug, Clone, Serialize)]
pub struct TypeValue {
    pub type_id: i64,
    pub qty: i64,
    pub value: f64,
    pub category: String,
    #[serde(default)]
    pub name: Option<String>,
}

/// Descarga todas las páginas de assets (1000/página) y agrega por tipo.
pub async fn summary(
    esi: &EsiClient,
    db: &Db,
    character_id: i64,
    token: &str,
) -> AppResult<AssetsSummary> {
    // Paginación resiliente compartida (no se corta ante un error transitorio de una página).
    let items = fetch_all_assets(esi, db, character_id, token).await;
    summary_from_items(esi, db, &items).await
}

/// El resumen a partir de unos items YA descargados.
///
/// Existe para que el `auto_sync` pueda hacer **una sola** descarga y usarla para dos cosas —el
/// snapshot de patrimonio y el diff del inventario— en vez de deserializar dos veces el mismo
/// payload de varios miles de pilas. Sigue siendo `async` porque resolver la categoría de un tipo
/// (para descontar los blueprints) puede pedirle algo a ESI la primera vez.
pub async fn summary_from_items(
    esi: &EsiClient,
    db: &Db,
    items: &[AssetItem],
) -> AppResult<AssetsSummary> {
    let mut by_type: HashMap<i64, i64> = HashMap::new();
    let mut stacks: i64 = 0;
    let mut total_units: i64 = 0;

    for it in items {
        let q = it.quantity.max(1);
        *by_type.entry(it.type_id).or_insert(0) += q;
        stacks += 1;
        total_units += q;
    }

    // Valoración con precios medios de mercado (si ya se sincronizaron).
    let prices = db.prices_map().unwrap_or_default();

    // Cantidades de los typeIDs vigilados (papeles) — desde el mismo by_type, sin paginar de nuevo.
    let mut watched: std::collections::HashMap<i64, i64> = std::collections::HashMap::new();
    for &tid in WATCHED_TYPE_IDS {
        watched.insert(tid, by_type.get(&tid).copied().unwrap_or(0));
    }

    // ---- LOS BPC NO VALEN NADA, Y HAY QUE QUITARLOS ANTES DE AGREGAR ----
    // No se puede filtrar por typeID después: un BPC y su BPO comparten typeID, así que la única
    // oportunidad de distinguirlos es AQUÍ, sobre los items sueltos, con `is_blueprint_copy`.
    // Después de agregar por tipo la información ya se perdió.
    let copias: std::collections::HashMap<i64, i64> =
        items
            .iter()
            .filter(|i| i.is_blueprint_copy)
            .fold(std::collections::HashMap::new(), |mut m, i| {
                *m.entry(i.type_id).or_insert(0) += i.quantity.max(1);
                m
            });

    // Valor por tipo (qty × precio medio), ordenado desc. La categoría solo la resolvemos para los
    // tipos de MÁS valor (donde estarían los blueprints inflados); el resto es cola irrelevante.
    let mut valued: Vec<(i64, i64, f64)> = by_type
        .iter()
        .filter_map(|(&tid, &qty)| {
            // Se descuentan las copias: si de un tipo tienes 1 BPO y 3 BPC, solo cuenta el BPO.
            let qty = qty - copias.get(&tid).copied().unwrap_or(0);
            if qty <= 0 {
                return None;
            }
            let v = prices.get(&tid).copied().unwrap_or(0.0) * qty as f64;
            if v > 0.0 {
                Some((tid, qty, v))
            } else {
                None
            }
        })
        .collect();
    valued.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
    let est_value: f64 = valued.iter().map(|x| x.2).sum();

    let top_n = valued.len().min(50);
    let mut est_value_clean = est_value;
    let mut top_value: Vec<TypeValue> = Vec::new();
    for &(tid, qty, v) in valued.iter().take(top_n) {
        let category = resolve_category(esi, db, tid).await;
        if category == "Blueprints" {
            est_value_clean -= v; // los blueprints no cuentan para el patrimonio "real"
        }
        if top_value.len() < 30 {
            top_value.push(TypeValue {
                type_id: tid,
                qty,
                value: v,
                category,
                name: None,
            });
        }
    }

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
        est_value_clean,
        top_value,
        top_types: top,
        watched,
    })
}

/* ---------- I1 del pilar de INVENTARIO: grabar, y nada más ---------- */

/// Traduce una foto de assets de ESI al modelo de la BD y **graba el estado y sus cambios**.
///
/// Es todo lo que hace la fase I1 de `documentacion/SPEC_INVENTARIO.md`: ni una pantalla. Igual
/// que se hizo con industria, la PI y los contratos, y por el mismo motivo — el día que haga falta
/// la historia, o está o no está, y cada día que pasa sin grabarla es histórico irrecuperable.
///
/// Lo único que añade sobre lo que ya sabe la BD es **subir por el árbol de contenedores** hasta la
/// ubicación raíz: un módulo dentro de una nave dentro de un contenedor está, para todo lo que
/// importa, en la estación. Sin esto, el histórico diría que se movió algo cada vez que cambias de
/// nave.
///
/// No llama a ESI: recibe los items ya descargados y `complete` tal como lo devolvió
/// [`fetch_all_assets_checked`]. Sobre por qué ese `complete` decide si se escribe o no, ver
/// `Db::sync_assets`.
pub fn sync_inventory(
    db: &Db,
    character_id: i64,
    items: &[AssetItem],
    complete: bool,
    prices: &HashMap<i64, f64>,
) -> AppResult<crate::db::AssetSyncResult> {
    use crate::db::AssetStackIn;
    let item_loc: HashMap<i64, i64> = items.iter().map(|i| (i.item_id, i.location_id)).collect();

    let filas: Vec<AssetStackIn> = items
        .iter()
        .map(|it| {
            // El contenedor inmediato solo cuenta si es a su vez un ítem NUESTRO (una nave o un
            // contenedor propio). Si no, el ítem está suelto en un hangar.
            let container_id = if item_loc.contains_key(&it.location_id) {
                it.location_id
            } else {
                0
            };
            // El slot solo tiene sentido dentro de un contenedor/nave (es lo que dibuja el fit).
            let slot = if container_id != 0 {
                it.location_flag.clone().unwrap_or_default()
            } else {
                String::new()
            };
            AssetStackIn {
                location_id: root_location(&item_loc, it.location_id),
                container_id,
                type_id: it.type_id,
                assembled: it.is_singleton,
                slot,
                quantity: it.quantity.max(1),
                is_copy: it.is_blueprint_copy,
            }
        })
        .collect();

    db.sync_assets(character_id, &filas, complete, prices)
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
    /// Id de la UBICACIÓN RAÍZ del stack (estación/estructura/sistema), tras subir por el árbol de
    /// contenedores/naves con `root_location`. Es el que casa con `facility.structure_id` → permite
    /// saber qué stock ya está EN la instalación elegida (F1d+, idea de RoGiz7).
    pub location_id: i64,
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
    /// `true` = MONTADO (no apilable); `false` = empaquetado.
    ///
    /// Entra en la CLAVE de agregación, así que cinco Bestower empaquetados y uno montado en el
    /// mismo hangar salen en dos filas. Es lo correcto: no son lo mismo y **no ocupan lo mismo**
    /// (20.000 m³ contra 260.000). Fundirlos daría un total de transporte falso por trece veces.
    pub assembled: bool,
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
    // La clave lleva `assembled` al final: ver el porqué en `AssetDetailRow::assembled`.
    let mut agg: Map<(i64, i64, i64, bool, String, bool), i64> = Map::new();
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
            .entry((it.type_id, root, container_id, safety, slot, it.is_singleton))
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
        .map(|((type_id, root, container_id, safety, slot, assembled), quantity)| {
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
                location_id: root,
                location_name,
                container,
                container_id,
                container_type_id,
                slot,
                assembled,
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

/* ---------- Tus naves, tal como están (T2 del pilar de transporte) ---------- */

/// Un módulo montado en una nave: el slot viene del `location_flag` de ESI.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ShipModuleRow {
    pub type_id: i64,
    /// `HiSlot0`, `MedSlot2`, `RigSlot1`, `Cargo`, `DroneBay`… Tal cual lo da ESI.
    pub slot: String,
    pub quantity: i64,
    /// `true` = MONTADO. Decide qué volumen ocupa: el del SDE si está montado, el reempaquetado si
    /// no. En una nave dentro de otra la diferencia es de trece veces (Bestower: 260.000 montado
    /// contra 20.000 empaquetado), así que usar el que no toca no es un matiz.
    pub assembled: bool,
}

/// Una nave TUYA, encontrada en los assets.
#[derive(Debug, Clone, serde::Serialize)]
pub struct MyShipRow {
    /// `item_id` de la nave. Es lo que sus módulos llevan como `location_id`, y lo que permite
    /// distinguir dos Bestower iguales en la misma estación.
    pub item_id: i64,
    pub type_id: i64,
    pub character_id: i64,
    pub system_id: i64,
    pub location_id: i64,
    pub location_name: String,
    /// `false` = EMPAQUETADA. No puede llevar nada hasta que la montes, y su volumen es otro.
    /// Sale de `is_singleton`, que venía en la respuesta de ESI y se estaba tirando.
    pub assembled: bool,
    pub modules: Vec<ShipModuleRow>,
}

/// Las naves del personaje, con dónde están y qué llevan montado.
///
/// ⚠️ **No hace falta ningún fiteo guardado.** Los assets ya traen el `location_flag` de cada ítem
/// (`HiSlot0`, `RigSlot1`…) y su `location_id` apunta al `item_id` de la nave que lo contiene. O
/// sea: la nave REAL, tal como está ahora mismo. Un fiteo guardado es una intención; esto es un
/// hecho. (Idea de RoGiz7, 2026-08-07.)
///
/// Se listan TAMBIÉN las naves vacías y las empaquetadas: partir de los módulos y subir a su
/// contenedor habría dejado fuera justo la nave de carga vacía esperando en la estación, que es la
/// que querrías usar para transportar.
///
/// `ship_type_ids` lo pone quien llama (commands.rs tiene `ships.json` embebido): así este módulo
/// no necesita saber qué es una nave.
pub async fn ships(
    esi: &EsiClient,
    db: &Db,
    character_id: i64,
    token: &str,
    all_tokens: &[String],
    ship_type_ids: &std::collections::HashSet<i64>,
) -> AppResult<Vec<MyShipRow>> {
    use std::collections::HashMap as Map;
    let items = fetch_all_assets(esi, db, character_id, token).await;
    if items.is_empty() {
        return Ok(Vec::new());
    }
    let item_loc: Map<i64, i64> = items.iter().map(|i| (i.item_id, i.location_id)).collect();

    // Módulos agrupados por la nave que los contiene.
    let mut por_nave: Map<i64, Vec<ShipModuleRow>> = Map::new();
    for it in &items {
        // Solo cuenta si su contenedor es un ítem nuestro (si no, está suelto en un hangar).
        if !item_loc.contains_key(&it.location_id) {
            continue;
        }
        por_nave
            .entry(it.location_id)
            .or_default()
            .push(ShipModuleRow {
                type_id: it.type_id,
                slot: it.location_flag.clone().unwrap_or_default(),
                quantity: it.quantity.max(1),
                assembled: it.is_singleton,
            });
    }

    let naves: Vec<&AssetItem> = items
        .iter()
        .filter(|i| ship_type_ids.contains(&i.type_id))
        .collect();

    // Una sola resolución por ubicación raíz: son llamadas a ESI y se repiten mucho.
    let mut cache: Map<i64, (i64, Option<String>)> = Map::new();
    let mut out = Vec::with_capacity(naves.len());
    for n in naves {
        let root = root_location(&item_loc, n.location_id);
        if !cache.contains_key(&root) {
            cache.insert(root, resolve_location_named(esi, db, root, all_tokens).await);
        }
        let (system_id, name) = cache.get(&root).cloned().unwrap_or((0, None));
        let mut modules = por_nave.remove(&n.item_id).unwrap_or_default();
        modules.sort_by(|a, b| a.slot.cmp(&b.slot));
        out.push(MyShipRow {
            item_id: n.item_id,
            type_id: n.type_id,
            character_id,
            system_id,
            location_id: root,
            location_name: name.unwrap_or_default(),
            assembled: n.is_singleton,
            modules,
        });
    }
    Ok(out)
}
