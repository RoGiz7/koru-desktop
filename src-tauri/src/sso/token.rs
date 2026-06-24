//! Intercambio y refresco de tokens contra el token_endpoint de CCP (flujo PKCE, sin secret).

use crate::config;
use crate::error::{AppError, AppResult};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: String,
    #[serde(default)]
    pub expires_in: i64,
    #[serde(default)]
    pub token_type: String,
}

/// Paso 4 del flujo: intercambia el authorization code por tokens.
pub async fn exchange_code(
    client: &reqwest::Client,
    token_endpoint: &str,
    code: &str,
    code_verifier: &str,
) -> AppResult<TokenResponse> {
    let params = [
        ("grant_type", "authorization_code"),
        ("code", code),
        ("client_id", config::CLIENT_ID),
        ("code_verifier", code_verifier),
    ];
    post_token(client, token_endpoint, &params).await
}

/// Refresca el access token usando el refresh token (rotación: guardar siempre el último).
pub async fn refresh(
    client: &reqwest::Client,
    token_endpoint: &str,
    refresh_token: &str,
) -> AppResult<TokenResponse> {
    let params = [
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("client_id", config::CLIENT_ID),
    ];
    post_token(client, token_endpoint, &params).await
}

async fn post_token(
    client: &reqwest::Client,
    token_endpoint: &str,
    params: &[(&str, &str)],
) -> AppResult<TokenResponse> {
    let resp = client
        .post(token_endpoint)
        .header("Content-Type", "application/x-www-form-urlencoded")
        // CCP recomienda enviar el host del login como Host explícito; reqwest lo hace solo.
        .form(params)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::OAuth(format!(
            "token_endpoint respondió {status}: {body}"
        )));
    }
    Ok(resp.json::<TokenResponse>().await?)
}
