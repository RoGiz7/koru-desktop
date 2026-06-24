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
