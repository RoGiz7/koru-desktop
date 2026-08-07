//! Contratos del personaje: el libro de cuentas del transportista (T1 del pilar de transporte).
//!
//! ⚠️ ESTO SE SINCRONIZA AUNQUE NO HAYA NINGUNA PANTALLA QUE LO ENSEÑE, y es a propósito.
//! `/characters/{id}/contracts/` solo devuelve los contratos de los **últimos ~30 días** (más los
//! que sigan en curso): una ventana todavía más corta que los 90 días de los trabajos de industria.
//! Lo que no se guarde hoy no vuelve, así que el registro empieza en T1 y el panel de estadísticas
//! (T7) se construirá encima de meses de historia en vez de nacer vacío.
//!
//! El scope `esi-contracts.read_character_contracts.v1` llevaba declarado en `config.rs` desde hace
//! tiempo **sin usarse en ninguna llamada**: si el personaje ya inició sesión con él, esto funciona
//! sin relogin.

use super::EsiClient;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use serde::Deserialize;

/// Un contrato tal como lo da ESI. Los campos que importan para transporte son `volume`,
/// `reward`, `collateral` y las tres fechas: de ahí salen el ISK por m³, lo que te juegas y la
/// velocidad de entrega REAL (aceptado → completado), que es la única que no hay que deducir.
#[derive(Debug, Clone, Deserialize)]
pub struct ContractRaw {
    pub contract_id: i64,
    #[serde(default)]
    pub issuer_id: Option<i64>,
    #[serde(default)]
    pub issuer_corporation_id: Option<i64>,
    #[serde(default)]
    pub assignee_id: Option<i64>,
    #[serde(default)]
    pub acceptor_id: Option<i64>,
    #[serde(default)]
    pub start_location_id: Option<i64>,
    #[serde(default)]
    pub end_location_id: Option<i64>,
    #[serde(rename = "type", default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub for_corporation: bool,
    #[serde(default)]
    pub availability: Option<String>,
    #[serde(default)]
    pub volume: Option<f64>,
    #[serde(default)]
    pub reward: Option<f64>,
    #[serde(default)]
    pub collateral: Option<f64>,
    #[serde(default)]
    pub price: Option<f64>,
    #[serde(default)]
    pub buyout: Option<f64>,
    #[serde(default)]
    pub days_to_complete: Option<i64>,
    #[serde(default)]
    pub date_issued: Option<String>,
    #[serde(default)]
    pub date_expired: Option<String>,
    #[serde(default)]
    pub date_accepted: Option<String>,
    #[serde(default)]
    pub date_completed: Option<String>,
}

/// Página de ESI para contratos.
const PAGE: usize = 1000;

/// Descarga los contratos del personaje y los GUARDA. Devuelve cuántos se vieron.
///
/// Recorre páginas como los blueprints: `get_cached` no mira `x-pages`, y sin el bucle un
/// personaje con muchos contratos vería solo los primeros y Koru le mentiría en silencio.
pub async fn sync_contracts(
    esi: &EsiClient,
    db: &Db,
    character_id: i64,
    token: &str,
) -> AppResult<usize> {
    let mut total = 0usize;
    for page in 1..=30u32 {
        let path = format!("/characters/{character_id}/contracts/?page={page}");
        let batch = match esi
            .get_cached::<Vec<ContractRaw>>(db, character_id, &path, Some(token))
            .await
        {
            Ok(v) => v,
            Err(AppError::NotFound) => break,
            // Si falla la PRIMERA página es un error de verdad (sin scope, red…); en las
            // siguientes nos quedamos con lo que ya tenemos en vez de perderlo todo.
            Err(e) => {
                if page == 1 {
                    return Err(e);
                }
                break;
            }
        };
        if batch.is_empty() {
            break;
        }
        let n = batch.len();
        for c in &batch {
            db.upsert_contract(character_id, c)?;
        }
        total += n;
        if n < PAGE {
            break;
        }
    }
    Ok(total)
}
