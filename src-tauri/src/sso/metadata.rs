//! Descarga y caché de la metadata OAuth de CCP (.well-known).
//! CCP recomienda no hardcodear authorize/token/jwks, sino leerlos de aquí y cachearlos.

use crate::config;
use crate::error::AppResult;
use serde::Deserialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Deserialize)]
pub struct SsoMetadata {
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub jwks_uri: String,
    #[serde(default)]
    pub issuer: String,
}

struct Cached {
    data: SsoMetadata,
    fetched_at: Instant,
}

static CACHE: Mutex<Option<Cached>> = Mutex::new(None);
const TTL: Duration = Duration::from_secs(3600); // 1h

/// Devuelve la metadata, usando caché si sigue vigente.
pub async fn get(client: &reqwest::Client) -> AppResult<SsoMetadata> {
    {
        let guard = CACHE.lock().unwrap();
        if let Some(c) = guard.as_ref() {
            if c.fetched_at.elapsed() < TTL {
                return Ok(c.data.clone());
            }
        }
    }

    let data: SsoMetadata = client
        .get(config::SSO_METADATA_URL)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let mut guard = CACHE.lock().unwrap();
    *guard = Some(Cached {
        data: data.clone(),
        fetched_at: Instant::now(),
    });
    Ok(data)
}
