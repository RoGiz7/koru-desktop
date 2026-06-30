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
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub context_id: Option<i64>,
    #[serde(default)]
    pub context_id_type: Option<String>,
    #[serde(default)]
    pub first_party_id: Option<i64>,
    #[serde(default)]
    pub second_party_id: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Transaction {
    #[serde(default)]
    pub transaction_id: i64,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub type_id: i64,
    #[serde(default)]
    pub quantity: i64,
    #[serde(default)]
    pub unit_price: f64,
    #[serde(default)]
    pub is_buy: bool,
}

/// Transacciones de mercado recientes del personaje (ventana limitada de ESI).
/// Mismo scope que el journal (esi-wallet.read_character_wallet.v1).
pub async fn transactions(
    esi: &EsiClient,
    db: &Db,
    character_id: i64,
    token: &str,
) -> AppResult<Vec<Transaction>> {
    let path = format!("/characters/{character_id}/wallet/transactions/");
    esi.get_cached::<Vec<Transaction>>(db, character_id, &path, Some(token))
        .await
}

/// Sincroniza (acumula) las transacciones recientes en la BD. Devuelve cuántas nuevas se guardaron.
pub async fn sync_transactions(
    esi: &EsiClient,
    db: &Db,
    character_id: i64,
    token: &str,
) -> AppResult<usize> {
    let existing = db.existing_transaction_ids(character_id)?;
    let txs = transactions(esi, db, character_id, token)
        .await
        .unwrap_or_default();
    let mut n = 0usize;
    for t in &txs {
        if existing.contains(&t.transaction_id) {
            continue;
        }
        db.insert_transaction(
            t.transaction_id,
            character_id,
            t.date.as_deref(),
            t.type_id,
            t.quantity,
            t.unit_price,
            t.is_buy,
        )?;
        n += 1;
    }
    Ok(n)
}

/// Balance actual de la cartera (ESI devuelve un número suelto). Cacheado por el cliente.
pub async fn balance(esi: &EsiClient, db: &Db, character_id: i64, token: &str) -> AppResult<f64> {
    let path = format!("/characters/{character_id}/wallet/");
    esi.get_cached::<f64>(db, character_id, &path, Some(token))
        .await
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
            // No saltamos las existentes: insert_journal es un UPSERT que rellena (COALESCE) los
            // campos nuevos (context_id, reason…) en entradas viejas guardadas cuando aún no se
            // capturaban → backfill del histórico por sistema dentro de la ventana de ESI (~30 días).
            let is_new = !existing.contains(&e.id);
            db.insert_journal(
                e.id,
                character_id,
                e.date.as_deref(),
                e.ref_type.as_deref(),
                e.amount,
                e.balance,
                e.description.as_deref(),
                e.reason.as_deref(),
                e.context_id,
                e.context_id_type.as_deref(),
                e.first_party_id,
                e.second_party_id,
            )?;
            if is_new {
                new_count += 1;
            }
        }
    }

    db.touch_last_sync(character_id)?;
    Ok(new_count)
}
