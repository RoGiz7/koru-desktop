//! Mercado: precios medios globales desde el endpoint PÚBLICO de ESI (/markets/prices/).
//!
//! Una sola llamada devuelve el precio medio (average_price) y ajustado (adjusted_price)
//! de todos los tipos del juego. No requiere token ni scopes, así que respeta el principio
//! de la app (solo datos públicos o los del propio usuario). Sirve para valorar assets y
//! calcular el patrimonio sin depender de agregadores de terceros.

use super::EsiClient;
use crate::db::Db;
use crate::error::AppResult;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct PriceEntry {
    pub type_id: i64,
    #[serde(default)]
    pub average_price: Option<f64>,
    #[serde(default)]
    pub adjusted_price: Option<f64>,
}

/// Descarga los precios medios globales y los persiste en `market_prices`.
/// Devuelve cuántos tipos se guardaron. Cacheado por el cliente ESI (≈1h).
pub async fn sync_prices(esi: &EsiClient, db: &Db) -> AppResult<usize> {
    // character_id = 0 → caché compartida (endpoint público).
    let prices: Vec<PriceEntry> = esi.get_cached(db, 0, "/markets/prices/", None).await?;
    let rows: Vec<(i64, Option<f64>, Option<f64>)> = prices
        .iter()
        .map(|p| (p.type_id, p.average_price, p.adjusted_price))
        .collect();
    if !rows.is_empty() {
        db.upsert_prices(&rows)?;
    }
    Ok(rows.len())
}

/// Una orden del LIBRO PÚBLICO de una región (endpoint /markets/{region}/orders/, sin token).
#[derive(Debug, Clone, Deserialize)]
pub struct BookOrder {
    #[serde(default)]
    pub order_id: i64,
    #[serde(default)]
    pub type_id: i64,
    #[serde(default)]
    pub is_buy_order: bool,
    #[serde(default)]
    pub price: f64,
    #[serde(default)]
    pub location_id: i64,
    #[serde(default)]
    pub volume_remain: i64,
}

/// Libro público de una región para UN tipo y lado ("buy"/"sell"). Público y cacheado (~5 min);
/// una sola llamada por (región, tipo, lado) — barato porque solo hay tus pocas docenas de tipos.
/// Para cruzar tus órdenes con la competencia (¿te han pisado el precio?).
pub async fn region_orders(
    esi: &EsiClient,
    db: &Db,
    region_id: i64,
    type_id: i64,
    order_type: &str,
) -> Vec<BookOrder> {
    let mut all: Vec<BookOrder> = Vec::new();
    for page in 1..=10u32 {
        let path = format!(
            "/markets/{region_id}/orders/?order_type={order_type}&type_id={type_id}&page={page}"
        );
        match esi.get_cached::<Vec<BookOrder>>(db, 0, &path, None).await {
            Ok(v) => {
                let n = v.len();
                all.extend(v);
                if n < 1000 {
                    break; // página incompleta = última (ESI pagina de 1000 en 1000)
                }
            }
            Err(_) => break,
        }
    }
    all
}

/// Un día del histórico de mercado de una región para un tipo (/markets/{region}/history/).
/// Público, sin token; ESI lo cachea ~1 día (una entrada por día, hasta ~13 meses).
#[derive(Debug, Clone, Deserialize)]
pub struct HistoryEntry {
    #[serde(default)]
    pub date: String,
    #[serde(default)]
    pub average: f64,
    #[serde(default)]
    pub highest: f64,
    #[serde(default)]
    pub lowest: f64,
    #[serde(default)]
    pub volume: i64,
    #[serde(default)]
    pub order_count: i64,
}

/// Histórico diario de precio/volumen de una región para UN tipo. Público y cacheado (~1 día).
/// Devuelve la serie completa que da ESI (orden cronológico ascendente).
pub async fn region_history(
    esi: &EsiClient,
    db: &Db,
    region_id: i64,
    type_id: i64,
) -> Vec<HistoryEntry> {
    let path = format!("/markets/{region_id}/history/?type_id={type_id}");
    esi.get_cached::<Vec<HistoryEntry>>(db, 0, &path, None)
        .await
        .unwrap_or_default()
}
