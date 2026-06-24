//! Tipo de error unificado de la app, serializable hacia el frontend.

use serde::Serialize;

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
