//! Orquestación del flujo OAuth2 Authorization Code + PKCE de EVE SSO.

pub mod callback;
pub mod jwt;
pub mod metadata;
pub mod pkce;
pub mod store;
pub mod token;

use crate::config;
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tokio::sync::Mutex as AsyncMutex;
use url::Url;

/// Resultado de un login correcto, devuelto al frontend.
#[derive(Debug, Clone, Serialize)]
pub struct LoginOutcome {
    pub character_id: i64,
    pub character_name: String,
    pub scopes: Vec<String>,
}

/// Construye un cliente HTTP con el User-Agent de la app.
pub fn http_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(config::USER_AGENT)
        .build()
        .map_err(Into::into)
}

/// Construye la URL de autorización con todos los parámetros PKCE.
fn build_authorize_url(
    authorize_endpoint: &str,
    scopes: &[String],
    state: &str,
    challenge: &str,
) -> AppResult<String> {
    let mut url = Url::parse(authorize_endpoint)
        .map_err(|e| AppError::Other(format!("authorize endpoint inválido: {e}")))?;
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", config::CLIENT_ID)
        .append_pair("redirect_uri", config::REDIRECT_URI)
        .append_pair("scope", &scopes.join(" "))
        .append_pair("state", state)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256");
    Ok(url.to_string())
}

/// Ejecuta el flujo completo de login para los `scopes` pedidos.
/// Si `scopes` está vacío, hace login de solo identidad.
pub async fn login(scopes: Vec<String>) -> AppResult<LoginOutcome> {
    let client = http_client()?;
    let meta = metadata::get(&client).await?;

    let pkce = pkce::Pkce::generate();
    let state = pkce::random_state();
    let authorize_url =
        build_authorize_url(&meta.authorization_endpoint, &scopes, &state, &pkce.challenge)?;

    // 1) Arrancamos el listener loopback ANTES de abrir el navegador.
    let callback_handle = tokio::task::spawn_blocking(|| {
        callback::wait_for_callback(Duration::from_secs(300))
    });

    // 2) Abrimos el navegador del sistema en la URL de autorización.
    open::that(&authorize_url).map_err(|e| {
        AppError::Other(format!("no se pudo abrir el navegador: {e}"))
    })?;

    // 3) Esperamos el callback.
    let cb = callback_handle
        .await
        .map_err(|e| AppError::Other(format!("join error: {e}")))??;

    // 4) Verificamos el state (anti-CSRF).
    if cb.state != state {
        return Err(AppError::StateMismatch);
    }

    // 5) Intercambiamos el code por tokens.
    let tokens =
        token::exchange_code(&client, &meta.token_endpoint, &cb.code, &pkce.verifier).await?;

    // 6) Validamos el JWT y extraemos claims.
    let claims = jwt::validate(&client, &meta, &tokens.access_token).await?;
    let character_id = claims.character_id()?;

    // 7) Guardamos el refresh token en el keyring (NO en la BD).
    if !tokens.refresh_token.is_empty() {
        store::save_refresh_token(character_id, &tokens.refresh_token)?;
    }

    Ok(LoginOutcome {
        character_id,
        character_name: claims.name,
        scopes: claims.scp,
    })
}

/// Un access token válido + sus claims, listo para llamar a ESI.
pub struct ValidToken {
    pub access_token: String,
    pub claims: jwt::EveClaims,
}

/// Gestor de refresco con un mutex POR PERSONAJE para evitar refrescos concurrentes
/// (la race condition que ya nos mordió en corptools). Guarda siempre el último
/// refresh_token devuelto (rotación de CCP).
#[derive(Default)]
pub struct TokenManager {
    locks: Mutex<HashMap<i64, std::sync::Arc<AsyncMutex<()>>>>,
}

impl TokenManager {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock_for(&self, character_id: i64) -> std::sync::Arc<AsyncMutex<()>> {
        let mut map = self.locks.lock().unwrap();
        map.entry(character_id)
            .or_insert_with(|| std::sync::Arc::new(AsyncMutex::new(())))
            .clone()
    }

    /// Obtiene un access token fresco para el personaje, refrescando si hace falta.
    /// Un solo refresco en vuelo por personaje.
    pub async fn access_token(
        &self,
        client: &reqwest::Client,
        character_id: i64,
    ) -> AppResult<ValidToken> {
        let lock = self.lock_for(character_id);
        let _guard = lock.lock().await;

        let refresh_token = store::load_refresh_token(character_id)?
            .ok_or_else(|| AppError::OAuth(format!("sin refresh token para {character_id}")))?;

        let meta = metadata::get(client).await?;
        let tokens = token::refresh(client, &meta.token_endpoint, &refresh_token).await?;

        // Rotación: si CCP devuelve un refresh token nuevo, lo persistimos.
        if !tokens.refresh_token.is_empty() && tokens.refresh_token != refresh_token {
            store::save_refresh_token(character_id, &tokens.refresh_token)?;
        }

        let claims = jwt::validate(client, &meta, &tokens.access_token).await?;
        Ok(ValidToken {
            access_token: tokens.access_token,
            claims,
        })
    }
}
