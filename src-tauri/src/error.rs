//! Tipo de error unificado de la app, serializable hacia el frontend.

use serde::Serialize;

/// El principio del texto de `AppError::FaltaScope`. La pantalla lo reconoce por aquí: es la única
/// forma de distinguir «falta el permiso» de «ESI ha fallado», porque el error viaja como texto.
///
/// ⚠️ Tiene un GEMELO en TypeScript (`src/errores.ts`). El test `prefijo_igual_en_los_dos_lados`
/// lee aquel fichero y exige la misma cadena: separarlos rompe `cargo test`, no la pantalla.
pub const PREFIJO_FALTA_PERMISO: &str = "Falta permiso: ";

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("HTTP: {0}")]
    Http(#[from] reqwest::Error),

    #[error("JSON: {0}")]
    Json(#[from] serde_json::Error),

    #[error("DB: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("Keyring: {0}")]
    Keyring(#[from] keyring::Error),

    #[error("JWT: {0}")]
    Jwt(#[from] jsonwebtoken::errors::Error),

    #[error("OAuth: {0}")]
    OAuth(String),

    /// Al personaje le falta el SCOPE que pide esta función. Va aparte de `OAuth` porque la
    /// pantalla tiene que poder decir «falta el acceso» SOLO cuando es eso: antes el panel de
    /// fatiga lo decía con cualquier error, también con un 502 de ESI, y mandaba a reloguear para
    /// nada. Mismo motivo que `OAuthCaducado`: lo que se trata distinto se nombra distinto.
    #[error("{p}{0}", p = PREFIJO_FALTA_PERMISO)]
    FaltaScope(String),

    /// El refresh token esta MUERTO (invalid_grant): no hay vuelta atras, toca reconceder acceso.
    /// Va aparte para no reintentarlo NUNCA. Insistir en lo que siempre va a fallar es justo lo que
    /// dispara el rate-limiter del SSO, y CCP avisa de que por ahi puede bloquear la aplicacion
    /// ENTERA -- o sea a todos los usuarios, no solo al del token roto.
    #[error("OAuth: la sesión de este personaje ha caducado; hay que volver a concederle acceso ({0})")]
    OAuthCaducado(String),

    #[error("No encontrado (404)")]
    NotFound,

    #[error("State mismatch (posible CSRF): el parámetro state no coincide")]
    StateMismatch,

    #[error("Timeout esperando el callback de OAuth")]
    CallbackTimeout,

    #[error("{0}")]
    Other(String),
}

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        AppError::Other(e.to_string())
    }
}

/// Serializamos el error como string para que llegue limpio al frontend.
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    /// El texto que llega a la pantalla empieza por la constante, y tal cual por el serializador.
    #[test]
    fn falta_scope_empieza_por_el_prefijo() {
        let e = AppError::FaltaScope("este personaje no concedió el scope necesario.".into());
        assert_eq!(e.to_string(), format!("{PREFIJO_FALTA_PERMISO}este personaje no concedió el scope necesario."));
        let json = serde_json::to_string(&e).unwrap();
        assert!(json.starts_with(&format!("\"{PREFIJO_FALTA_PERMISO}")), "{json}");
        // Y ningún otro error se le parece: si no, la pantalla diría «falta el acceso» ante un 502.
        for otro in [AppError::OAuth("x".into()), AppError::Other("ESI 502 Bad Gateway".into()), AppError::NotFound] {
            assert!(!otro.to_string().starts_with(PREFIJO_FALTA_PERMISO), "{otro}");
        }
    }

    /// Los dos literales, el de Rust y el de TypeScript, no pueden separarse en silencio.
    #[test]
    fn prefijo_igual_en_los_dos_lados() {
        let ts = include_str!("../../src/errores.ts");
        let linea = format!("export const PREFIJO_FALTA_PERMISO = \"{PREFIJO_FALTA_PERMISO}\";");
        assert!(ts.lines().any(|l| l == linea), "src/errores.ts no tiene `{linea}`");
    }
}
