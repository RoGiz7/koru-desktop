//! Wallet: balance + journal (paginado) hacia SQLite.

use super::EsiClient;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct JournalEntry {
    pub id: i64,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub ref_type: Option<String>,
    #[serde(default)]
    pub amount: Option<f64>,
    #[serde(default)]
    pub balance: Option<f64>,
    #[serde(default)]
    pub description: Option<String>,
}

/// Balance actual de la cartera (ESI devuelve un número suelto). Cacheado por el cliente.
pub async fn balance(
    esi: &EsiClient,
    db: &Db,
    character_id: i64,
    token: &str,
) -> AppResult<f64> {
    let path = format!("/characters/{character_id}/wallet/");
    esi.get_cached::<f64>(db, character_id, &path, Some(token)).await
}

/// Sincroniza el journal de cartera, paginando hasta agotar o `max_pages`.
/// Devuelve cuántas entradas nuevas se guardaron.
pub async fn sync_journal(
    esi: &EsiClient,
    db: &Db,
    character_id: i64,
    token: &str,
    max_pages: u32,
) -> AppResult<usize> {
    let existing = db.existing_journal_ids(character_id)?;
    let mut new_count = 0usize;

    for page in 1..=max_pages {
        let path = format!("/characters/{character_id}/wallet/journal/?page={page}");
        let entries: Vec<JournalEntry> =
            match esi.get_cached(db, character_id, &path, Some(token)).await {
                Ok(e) => e,
                Err(AppError::NotFound) => break, // no hay más páginas
                Err(e) => {
                    eprintln!("wallet journal página {page} falló: {e}");
                    break;
                }
            };
        if entries.is_empty() {
            break;
        }
        for e in &entries {
            if existing.contains(&e.id) {
                continue;
            }
            db.insert_journal(
                e.id,
                character_id,
                e.date.as_deref(),
                e.ref_type.as_deref(),
                e.amount,
                e.balance,
                e.description.as_deref(),
            )?;
            new_count += 1;
        }
    }

    db.touch_last_sync(character_id)?;
    Ok(new_count)
}
