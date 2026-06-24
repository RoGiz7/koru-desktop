//! Validación del access_token (JWT) contra el JWKS de CCP y extracción de claims.

use crate::config;
use crate::error::{AppError, AppResult};
use crate::sso::metadata::SsoMetadata;
use jsonwebtoken::{decode, decode_header, DecodingKey, Validation};
use serde::Deserialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Claims que nos interesan del token de CCP.
#[derive(Debug, Clone, Deserialize)]
pub struct EveClaims {
    /// "EVE:CHARACTER:<id>"
    pub sub: String,
    /// Nombre del personaje.
    pub name: String,
    /// Scopes concedidos. CCP lo manda como array, o como string si es uno solo.
    #[serde(default, deserialize_with = "scp_de")]
    pub scp: Vec<String>,
    /// Audiencia (debe contener client_id + "EVE Online").
    #[serde(default)]
    pub aud: Vec<String>,
    pub exp: usize,
}

impl EveClaims {
    /// Extrae el character_id numérico de `sub` ("EVE:CHARACTER:123" -> 123).
    pub fn character_id(&self) -> AppResult<i64> {
        self.sub
            .rsplit(':')
            .next()
            .and_then(|s| s.parse::<i64>().ok())
            .ok_or_else(|| AppError::Other(format!("sub con formato inesperado: {}", self.sub)))
    }
}

/// `scp` puede venir como string único o como array; normalizamos a Vec<String>.
fn scp_de<'de, D>(de: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum OneOrMany {
        One(String),
        Many(Vec<String>),
    }
    Ok(match OneOrMany::deserialize(de)? {
        OneOrMany::One(s) => vec![s],
        OneOrMany::Many(v) => v,
    })
}

// --- Caché del JWKS ---
#[derive(Debug, Clone, Deserialize)]
struct Jwk {
    kid: String,
    #[serde(default)]
    n: String,
    #[serde(default)]
    e: String,
    #[serde(default)]
    alg: String,
}

#[derive(Debug, Clone, Deserialize)]
struct Jwks {
    keys: Vec<Jwk>,
}

struct CachedJwks {
    jwks: Jwks,
    fetched_at: Instant,
}

static JWKS_CACHE: Mutex<Option<CachedJwks>> = Mutex::new(None);
const JWKS_TTL: Duration = Duration::from_secs(3600);

async fn fetch_jwks(client: &reqwest::Client, jwks_uri: &str) -> AppResult<Jwks> {
    {
        let g = JWKS_CACHE.lock().unwrap();
        if let Some(c) = g.as_ref() {
            if c.fetched_at.elapsed() < JWKS_TTL {
                return Ok(c.jwks.clone());
            }
        }
    }
    let jwks: Jwks = client
        .get(jwks_uri)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let mut g = JWKS_CACHE.lock().unwrap();
    *g = Some(CachedJwks {
        jwks: jwks.clone(),
        fetched_at: Instant::now(),
    });
    Ok(jwks)
}

/// Valida firma + iss + aud + exp y devuelve los claims.
pub async fn validate(
    client: &reqwest::Client,
    meta: &SsoMetadata,
    access_token: &str,
) -> AppResult<EveClaims> {
    let header = decode_header(access_token)?;
    let kid = header
        .kid
        .ok_or_else(|| AppError::Other("JWT sin kid".into()))?;

    let jwks = fetch_jwks(client, &meta.jwks_uri).await?;
    let jwk = jwks
        .keys
        .into_iter()
        .find(|k| k.kid == kid)
        .ok_or_else(|| AppError::Other("no se encontró la clave (kid) en el JWKS".into()))?;

    let key = DecodingKey::from_rsa_components(&jwk.n, &jwk.e)?;

    let mut validation = Validation::new(header.alg);
    // Emisores aceptados (CCP usa ambas formas).
    validation.set_issuer(&config::ACCEPTED_ISSUERS);
    // Audiencia: exigimos que contenga nuestro client_id.
    validation.set_audience(&[config::CLIENT_ID]);
    validation.validate_exp = true;

    let data = decode::<EveClaims>(access_token, &key, &validation)?;
    let _ = jwk.alg; // alg viene del header; lo de la jwk es informativo.

    // Comprobación extra: el aud debe contener también el valor estático de CCP.
    if !data
        .claims
        .aud
        .iter()
        .any(|a| a == config::EXPECTED_AUDIENCE)
    {
        return Err(AppError::OAuth(
            "el claim aud no contiene 'EVE Online'".into(),
        ));
    }
    Ok(data.claims)
}
