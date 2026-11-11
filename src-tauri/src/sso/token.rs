//! Intercambio y refresco de tokens contra el token_endpoint de CCP (flujo PKCE, sin secret).

use crate::config;
use crate::error::{AppError, AppResult};
use serde::Deserialize;
use std::time::Duration;

/// Reintentos ante respuestas PASAJERAS del token endpoint (429 y 5xx). Los permanentes
/// (400 invalid_grant) no se reintentan ni una vez: ver AppError::OAuthCaducado.
const MAX_REINTENTOS: u32 = 4;

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

/// ★ EL TOKEN ENDPOINT ERA EL ÚNICO SITIO SIN RED (2026-11-11). Todas las llamadas de datos a ESI
/// llevaban backoff ante 420/429 desde hace meses (`esi/mod.rs`), y justo la del SSO no llevaba
/// nada: cualquier respuesta que no fuera 2xx se convertía en error y a otra cosa.
///
/// La documentación de CCP es explícita: hay un rate-limiter sobre peticiones FALLIDAS, y una
/// aplicación que lo dispara repetidamente sin respetar `Retry-After` puede acabar BLOQUEADA. El
/// bloqueo es por client_id, así que caería sobre todos los usuarios a la vez.
///
/// Por eso se separan dos mundos y se tratan al revés:
///   · PASAJERO (429, 5xx) → se espera lo que diga `Retry-After` y se reintenta.
///   · PERMANENTE (400 invalid_grant) → NO se reintenta jamás. Es el token muerto; reintentarlo
///     solo suma fallos al contador que acaba en el bloqueo.
async fn post_token(
    client: &reqwest::Client,
    token_endpoint: &str,
    params: &[(&str, &str)],
) -> AppResult<TokenResponse> {
    let mut intento = 0u32;
    loop {
        intento += 1;
        let resp = client
            .post(token_endpoint)
            .header("Content-Type", "application/x-www-form-urlencoded")
            // CCP recomienda enviar el host del login como Host explícito; reqwest lo hace solo.
            .form(params)
            .send()
            .await?;

        let status = resp.status();
        if status.is_success() {
            return Ok(resp.json::<TokenResponse>().await?);
        }

        let s = status.as_u16();
        if (s == 429 || (500..600).contains(&s)) && intento <= MAX_REINTENTOS {
            let espera = espera_segs(&resp, intento);
            eprintln!("[koru] SSO {s} en el token endpoint; back-off {espera}s (intento {intento})");
            tokio::time::sleep(Duration::from_secs(espera)).await;
            continue;
        }

        let body = resp.text().await.unwrap_or_default();
        // `invalid_grant` = el refresh token ya no vale. Es la respuesta que hay que distinguir:
        // sin distinguirla, la app reintenta eternamente algo que nunca va a salir bien.
        if s == 400 && body.contains("invalid_grant") {
            return Err(AppError::OAuthCaducado(body));
        }
        return Err(AppError::OAuth(format!(
            "token_endpoint respondió {status}: {body}"
        )));
    }
}

/// Segundos de espera ante un 429/5xx. `Retry-After` manda; si no viene, backoff exponencial
/// suave. Mismo criterio que `esi::backoff_secs`, para no tener dos políticas distintas.
fn espera_segs(resp: &reqwest::Response, intento: u32) -> u64 {
    if let Some(v) = resp
        .headers()
        .get("Retry-After")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
    {
        return v.clamp(1, 60);
    }
    (2u64.saturating_pow(intento)).min(60)
}
