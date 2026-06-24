//! Almacenamiento seguro del refresh_token en el keychain del SO (vía `keyring`).
//! Clave por personaje: service="koru-desktop", username=character_id.

use crate::config;
use crate::error::AppResult;
use keyring::Entry;

fn entry(character_id: i64) -> AppResult<Entry> {
    Ok(Entry::new(config::KEYRING_SERVICE, &character_id.to_string())?)
}

pub fn save_refresh_token(character_id: i64, refresh_token: &str) -> AppResult<()> {
    entry(character_id)?.set_password(refresh_token)?;
    Ok(())
}

pub fn load_refresh_token(character_id: i64) -> AppResult<Option<String>> {
    match entry(character_id)?.get_password() {
        Ok(t) => Ok(Some(t)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn delete_refresh_token(character_id: i64) -> AppResult<()> {
    match entry(character_id)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}
