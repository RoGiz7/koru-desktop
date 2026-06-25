//! Configuración estática de Koru Desktop.
//!
//! IMPORTANTE: rellena `CLIENT_ID` con el client_id que te dé CCP al registrar
//! la app en https://developers.eveonline.com/applications (ver docs/REGISTRO_APP.md).
//! En PKCE NO hay client secret, así que es seguro que el client_id viva aquí.

/// Client ID de la aplicación registrada en CCP. <-- RELLENAR.
pub const CLIENT_ID: &str = "eba809049cd142bf88a0eab5c7081a38";

/// Puerto del listener loopback para el callback de OAuth.
/// Debe coincidir EXACTAMENTE con el redirect URL registrado en CCP.
pub const CALLBACK_PORT: u16 = 8765;

/// Redirect URI registrado en CCP (debe coincidir carácter a carácter).
pub const REDIRECT_URI: &str = "http://localhost:8765/callback";

/// Metadata OAuth de CCP (de aquí salen authorize/token/jwks; no hardcodear esas URLs).
pub const SSO_METADATA_URL: &str =
    "https://login.eveonline.com/.well-known/oauth-authorization-server";

/// Emisores aceptados del JWT (CCP usa ambas formas).
pub const ACCEPTED_ISSUERS: [&str; 2] = ["login.eveonline.com", "https://login.eveonline.com"];

/// Valor estático que CCP incluye en el claim `aud` además del client_id.
pub const EXPECTED_AUDIENCE: &str = "EVE Online";

/// Base de la API ESI.
pub const ESI_BASE_URL: &str = "https://esi.evetech.net";

/// Fecha de compatibilidad de ESI (header `X-Compatibility-Date`).
/// Si no se envía, ESI sirve la versión MÁS ANTIGUA. Subir conscientemente al revisar cambios.
pub const ESI_COMPATIBILITY_DATE: &str = "2026-06-01";

/// User-Agent identificativo (CCP lo exige para buen comportamiento y soporte).
pub const USER_AGENT: &str = "Koru-Desktop/0.1 (Rekium; +https://github.com/RoGiz7/koru-desktop)";

/// Servicio del keyring donde guardamos los refresh tokens (clave = character_id).
pub const KEYRING_SERVICE: &str = "koru-desktop";

/// Scopes por feature. El primer login puede pedir `[]` (solo identidad) y luego
/// se solicitan de forma granular cuando el usuario abre cada sección.
pub mod scopes {
    pub const PVP: &[&str] = &["esi-killmails.read_killmails.v1"];

    pub const WALLET: &[&str] = &[
        "esi-wallet.read_character_wallet.v1",
        "esi-markets.read_character_orders.v1", // Comercio (órdenes de mercado), grupo Patrimonio
    ];

    pub const SKILLS: &[&str] = &["esi-skills.read_skills.v1", "esi-skills.read_skillqueue.v1"];

    pub const ASSETS: &[&str] = &[
        "esi-assets.read_assets.v1",
        "esi-industry.read_character_jobs.v1",
        "esi-industry.read_character_mining.v1",
    ];

    /// Estado en vivo (opcional, baja sensibilidad).
    pub const LOCATION: &[&str] = &[
        "esi-location.read_location.v1",
        "esi-location.read_ship_type.v1",
        "esi-location.read_online.v1",
    ];

    /// Conjunto v1 (las 4 features + ubicación).
    pub fn core_v1() -> Vec<&'static str> {
        let mut v = Vec::new();
        v.extend_from_slice(PVP);
        v.extend_from_slice(WALLET);
        v.extend_from_slice(SKILLS);
        v.extend_from_slice(ASSETS);
        v.extend_from_slice(LOCATION);
        v
    }
}
