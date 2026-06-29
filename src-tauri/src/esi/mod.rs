//! Cliente ESI con caché (ETag/If-None-Match/304 + Expires), `X-Compatibility-Date`,
//! User-Agent, autenticación Bearer, error budget y límite de concurrencia global.
//!
//! Esto es lo que nos protege de un ban de CCP: no re-pedir antes de `Expires`,
//! cobrar `304` con el `ETag`, y respetar el error budget en vivo.

pub mod assets;
pub mod character;
pub mod industry;
pub mod killmails;
pub mod market;
pub mod skills;
pub mod wallet;

use crate::config;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use chrono::{DateTime, Utc};
use serde::de::DeserializeOwned;
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, Semaphore};

/// Espaciado mínimo entre peticiones a ESI (evita disparar el rate limit de CCP).
const MIN_INTERVAL: Duration = Duration::from_millis(120);
/// Reintentos máximos ante 420/429.
const MAX_RETRIES: u32 = 5;

pub struct EsiClient {
    http: reqwest::Client,
    /// Limita cuántas peticiones ESI hay en vuelo a la vez (cortesía + evita ráfagas).
    sem: Semaphore,
    /// Marca de la última petición, para espaciar el ritmo global.
    last_req: Mutex<Instant>,
}

impl EsiClient {
    pub fn new(http: reqwest::Client) -> Self {
        Self {
            http,
            sem: Semaphore::new(4),
            last_req: Mutex::new(Instant::now() - MIN_INTERVAL),
        }
    }

    /// Garantiza al menos MIN_INTERVAL entre el arranque de dos peticiones.
    async fn pace(&self) {
        let mut last = self.last_req.lock().await;
        let elapsed = last.elapsed();
        if elapsed < MIN_INTERVAL {
            tokio::time::sleep(MIN_INTERVAL - elapsed).await;
        }
        *last = Instant::now();
    }

    /// GET con caché. `character_id` se usa como espacio de nombres de la caché
    /// (usa 0 para endpoints públicos inmutables, p. ej. detalle de killmail).
    /// `access_token` None = petición pública.
    pub async fn get_cached<T: DeserializeOwned>(
        &self,
        db: &Db,
        character_id: i64,
        path: &str,
        access_token: Option<&str>,
    ) -> AppResult<T> {
        // 1) ¿Tenemos cache vigente? Si Expires está en el futuro, no llamamos siquiera.
        let cached = db.get_cache(character_id, path)?;
        if let Some(ref c) = cached {
            if let Some(exp) = c.expires.as_deref().and_then(parse_http_or_rfc3339) {
                if exp > Utc::now() {
                    return Ok(serde_json::from_str::<T>(&c.payload)?);
                }
            }
        }

        // 2) Permiso de concurrencia.
        let _permit = self
            .sem
            .acquire()
            .await
            .map_err(|e| AppError::Other(format!("semaphore: {e}")))?;

        // 3) Petición con espaciado + backoff ante 420 (error limited) / 429 (rate limit).
        let url = format!("{}{}", config::ESI_BASE_URL, path);
        let mut attempt = 0u32;
        let resp = loop {
            attempt += 1;
            self.pace().await;

            let mut req = self
                .http
                .get(&url)
                .header("X-Compatibility-Date", config::ESI_COMPATIBILITY_DATE)
                .header("Accept", "application/json");
            if let Some(tok) = access_token {
                req = req.bearer_auth(tok);
            }
            if let Some(ref c) = cached {
                if let Some(ref etag) = c.etag {
                    req = req.header("If-None-Match", etag.clone());
                }
            }

            let resp = req.send().await?;
            let s = resp.status().as_u16();

            // 420 = ESI error limited, 429 = rate limit. Esperamos y reintentamos.
            if (s == 420 || s == 429) && attempt <= MAX_RETRIES {
                let wait = backoff_secs(&resp, attempt);
                eprintln!("ESI {s} en {path}; back-off {wait}s (intento {attempt})");
                tokio::time::sleep(Duration::from_secs(wait)).await;
                continue;
            }
            break resp;
        };

        // 4) Si el error budget está casi agotado, frenamos un poco antes de seguir.
        if let Some(remain) = resp
            .headers()
            .get("X-ESI-Error-Limit-Remain")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<i64>().ok())
        {
            if remain <= 5 {
                let reset = resp
                    .headers()
                    .get("X-ESI-Error-Limit-Reset")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse::<u64>().ok())
                    .unwrap_or(10)
                    .min(60);
                eprintln!("ESI error budget bajo (remain={remain}); pausa {reset}s");
                tokio::time::sleep(Duration::from_secs(reset)).await;
            }
        }

        let status = resp.status();
        let etag = header_string(&resp, "etag");
        let expires = header_string(&resp, "expires");

        // 5) 304: el contenido no cambió; refrescamos solo el Expires y devolvemos la cache.
        if status == reqwest::StatusCode::NOT_MODIFIED {
            if let Some(ref c) = cached {
                db.put_cache(
                    character_id,
                    path,
                    etag.as_deref().or(c.etag.as_deref()),
                    expires.as_deref(),
                    &c.payload,
                )?;
                return Ok(serde_json::from_str::<T>(&c.payload)?);
            }
            // 304 sin cache previa no debería pasar; tratamos como error.
            return Err(AppError::Other("304 sin cache previa".into()));
        }

        // 404 en paginación = "no hay más páginas": señal de parada, no un fallo.
        if status == reqwest::StatusCode::NOT_FOUND {
            return Err(AppError::NotFound);
        }

        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Other(format!("ESI {status} en {path}: {body}")));
        }

        // 6) Éxito: guardamos payload + etag + expires y parseamos.
        let body = resp.text().await?;
        let expires_rfc3339 = expires
            .as_deref()
            .and_then(parse_http_or_rfc3339)
            .map(|d| d.to_rfc3339());
        db.put_cache(
            character_id,
            path,
            etag.as_deref(),
            expires_rfc3339.as_deref(),
            &body,
        )?;
        Ok(serde_json::from_str::<T>(&body)?)
    }

    /// Igual que get_cached pero devuelve también las cabeceras de paginación (X-Pages).
    pub async fn get_cached_paged<T: DeserializeOwned>(
        &self,
        db: &Db,
        character_id: i64,
        path: &str,
        access_token: Option<&str>,
    ) -> AppResult<(T, u32)> {
        // Para simplificar, la primera página decide el total de páginas.
        // (Implementación: reusamos get_cached y, por ahora, ESI killmails/recent rara vez
        //  excede 1 página para un personaje normal; si hace falta, se amplía.)
        let value = self
            .get_cached::<T>(db, character_id, path, access_token)
            .await?;
        Ok((value, 1))
    }

    pub fn http(&self) -> &reqwest::Client {
        &self.http
    }

    /// Resuelve IDs (tipos, sistemas, personajes…) a nombres vía POST /universe/names/.
    /// Público, best-effort: devuelve un mapa id->nombre; ids no resueltos se omiten.
    pub async fn resolve_names(
        &self,
        ids: &[i64],
    ) -> AppResult<std::collections::HashMap<i64, String>> {
        use std::collections::HashMap;
        let mut out = HashMap::new();
        if ids.is_empty() {
            return Ok(out);
        }
        // /universe/names/ RECHAZA la petición si hay IDs duplicados (o un 0),
        // así que deduplicamos y filtramos antes de pedir.
        let mut unique: Vec<i64> = ids.iter().copied().filter(|&v| v > 0).collect();
        unique.sort_unstable();
        unique.dedup();
        if unique.is_empty() {
            return Ok(out);
        }
        // /universe/names/ acepta hasta 1000 ids por llamada.
        for chunk in unique.chunks(1000) {
            let _permit = self
                .sem
                .acquire()
                .await
                .map_err(|e| AppError::Other(format!("semaphore: {e}")))?;
            let url = format!("{}/universe/names/", config::ESI_BASE_URL);
            let resp = self
                .http
                .post(&url)
                .header("X-Compatibility-Date", config::ESI_COMPATIBILITY_DATE)
                .json(&chunk)
                .send()
                .await?;
            if !resp.status().is_success() {
                continue; // best-effort
            }
            #[derive(serde::Deserialize)]
            struct NameEntry {
                id: i64,
                name: String,
            }
            if let Ok(entries) = resp.json::<Vec<NameEntry>>().await {
                for e in entries {
                    out.insert(e.id, e.name);
                }
            }
        }
        Ok(out)
    }

    /// Nombres propios (custom) de contenedores/naves del personaje vía
    /// POST /characters/{id}/assets/names. Best-effort: ids no resueltos se omiten.
    /// El endpoint acepta hasta 1000 ids por llamada y requiere token.
    pub async fn asset_names(
        &self,
        character_id: i64,
        token: &str,
        item_ids: &[i64],
    ) -> AppResult<std::collections::HashMap<i64, String>> {
        use std::collections::HashMap;
        let mut out = HashMap::new();
        let mut unique: Vec<i64> = item_ids.iter().copied().filter(|&v| v > 0).collect();
        unique.sort_unstable();
        unique.dedup();
        if unique.is_empty() {
            return Ok(out);
        }
        for chunk in unique.chunks(1000) {
            let _permit = self
                .sem
                .acquire()
                .await
                .map_err(|e| AppError::Other(format!("semaphore: {e}")))?;
            let url = format!(
                "{}/characters/{character_id}/assets/names/",
                config::ESI_BASE_URL
            );
            let resp = self
                .http
                .post(&url)
                .header("X-Compatibility-Date", config::ESI_COMPATIBILITY_DATE)
                .bearer_auth(token)
                .json(&chunk)
                .send()
                .await?;
            if !resp.status().is_success() {
                continue; // best-effort
            }
            #[derive(serde::Deserialize)]
            struct NameEntry {
                item_id: i64,
                name: String,
            }
            if let Ok(entries) = resp.json::<Vec<NameEntry>>().await {
                for e in entries {
                    // ESI devuelve "None" para los no nombrados; lo omitimos.
                    if !e.name.is_empty() && e.name != "None" {
                        out.insert(e.item_id, e.name);
                    }
                }
            }
        }
        Ok(out)
    }

    /// Resuelve NOMBRES de tipos → type_id vía POST /universe/ids (público). Para importar fits EFT.
    /// Devuelve un mapa nombre→id (solo inventory_types). Best-effort.
    pub async fn type_ids(
        &self,
        names: &[String],
    ) -> AppResult<std::collections::HashMap<String, i64>> {
        use std::collections::HashMap;
        let mut out = HashMap::new();
        let mut unique: Vec<String> = names
            .iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        unique.sort();
        unique.dedup();
        if unique.is_empty() {
            return Ok(out);
        }
        #[derive(serde::Deserialize)]
        struct IdName {
            id: i64,
            name: String,
        }
        #[derive(serde::Deserialize)]
        struct IdsResp {
            #[serde(default)]
            inventory_types: Vec<IdName>,
        }
        // /universe/ids acepta hasta 500 nombres por llamada.
        for chunk in unique.chunks(500) {
            let _permit = self
                .sem
                .acquire()
                .await
                .map_err(|e| AppError::Other(format!("semaphore: {e}")))?;
            let url = format!("{}/universe/ids/", config::ESI_BASE_URL);
            let resp = self
                .http
                .post(&url)
                .header("X-Compatibility-Date", config::ESI_COMPATIBILITY_DATE)
                .json(&chunk)
                .send()
                .await?;
            if !resp.status().is_success() {
                continue;
            }
            if let Ok(r) = resp.json::<IdsResp>().await {
                for t in r.inventory_types {
                    out.insert(t.name, t.id);
                }
            }
        }
        Ok(out)
    }

    /// Resuelve NOMBRES → entidades (personajes y tipos/naves) vía POST /universe/ids (público).
    /// Para el intel: distinguir piloto (character) de nave (inventory_type). Best-effort.
    pub async fn resolve_entities(
        &self,
        names: &[String],
    ) -> AppResult<(Vec<(i64, String)>, Vec<(i64, String)>)> {
        let mut chars: Vec<(i64, String)> = Vec::new();
        let mut ships: Vec<(i64, String)> = Vec::new();
        let mut unique: Vec<String> = names
            .iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        unique.sort();
        unique.dedup();
        if unique.is_empty() {
            return Ok((chars, ships));
        }
        #[derive(serde::Deserialize)]
        struct IdName {
            id: i64,
            name: String,
        }
        #[derive(serde::Deserialize)]
        struct IdsResp {
            #[serde(default)]
            characters: Vec<IdName>,
            #[serde(default)]
            inventory_types: Vec<IdName>,
        }
        for chunk in unique.chunks(500) {
            let _permit = self
                .sem
                .acquire()
                .await
                .map_err(|e| AppError::Other(format!("semaphore: {e}")))?;
            let url = format!("{}/universe/ids/", config::ESI_BASE_URL);
            let resp = self
                .http
                .post(&url)
                .header("X-Compatibility-Date", config::ESI_COMPATIBILITY_DATE)
                .json(&chunk)
                .send()
                .await?;
            if !resp.status().is_success() {
                continue;
            }
            if let Ok(r) = resp.json::<IdsResp>().await {
                for c in r.characters {
                    chars.push((c.id, c.name));
                }
                for t in r.inventory_types {
                    ships.push((t.id, t.name));
                }
            }
        }
        Ok((chars, ships))
    }

    /// Resuelve system_id -> nombre de región (system -> constellation -> region).
    /// Todo cacheado (namespace 0). Best-effort.
    pub async fn resolve_region_names(
        &self,
        db: &Db,
        system_ids: &[i64],
    ) -> std::collections::HashMap<i64, String> {
        use std::collections::HashMap;
        #[derive(serde::Deserialize)]
        struct SystemInfo {
            constellation_id: i64,
        }
        #[derive(serde::Deserialize)]
        struct ConstInfo {
            region_id: i64,
        }
        #[derive(serde::Deserialize)]
        struct RegionInfo {
            name: String,
        }

        let mut out: HashMap<i64, String> = HashMap::new();
        let mut region_cache: HashMap<i64, String> = HashMap::new();
        let mut unique: Vec<i64> = system_ids.iter().copied().filter(|&v| v > 0).collect();
        unique.sort_unstable();
        unique.dedup();

        for sid in unique {
            // Caché persistente: si ya resolvimos esta región alguna vez, no llamamos a ESI
            // (a prueba de downtime).
            if let Some(r) = db.system_region_get(sid) {
                out.insert(sid, r);
                continue;
            }
            let sys: SystemInfo = match self
                .get_cached(db, 0, &format!("/universe/systems/{sid}/"), None)
                .await
            {
                Ok(v) => v,
                Err(e) => {
                    eprintln!("region: /universe/systems/{sid}/ falló: {e}");
                    continue;
                }
            };
            let cons: ConstInfo = match self
                .get_cached(
                    db,
                    0,
                    &format!("/universe/constellations/{}/", sys.constellation_id),
                    None,
                )
                .await
            {
                Ok(v) => v,
                Err(_) => continue,
            };
            if let Some(name) = region_cache.get(&cons.region_id) {
                db.system_region_put(sid, name);
                out.insert(sid, name.clone());
                continue;
            }
            if let Ok(region) = self
                .get_cached::<RegionInfo>(
                    db,
                    0,
                    &format!("/universe/regions/{}/", cons.region_id),
                    None,
                )
                .await
            {
                region_cache.insert(cons.region_id, region.name.clone());
                db.system_region_put(sid, &region.name);
                out.insert(sid, region.name);
            }
        }
        out
    }
}

fn header_string(resp: &reqwest::Response, name: &str) -> Option<String> {
    resp.headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

/// Segundos de espera ante un 420/429. Prioriza `Retry-After`, luego el reset del
/// error budget, y si no hay cabeceras usa un backoff exponencial suave.
fn backoff_secs(resp: &reqwest::Response, attempt: u32) -> u64 {
    if let Some(v) = header_string(resp, "Retry-After").and_then(|s| s.parse::<u64>().ok()) {
        return v.clamp(1, 60);
    }
    if let Some(v) =
        header_string(resp, "X-ESI-Error-Limit-Reset").and_then(|s| s.parse::<u64>().ok())
    {
        return v.clamp(1, 60);
    }
    // Backoff exponencial: 2, 4, 8, 16, 32 (máx 60).
    (2u64.saturating_pow(attempt)).min(60)
}

/// ESI manda `Expires` en formato HTTP (RFC 7231). Aceptamos también RFC3339 por si lo
/// guardamos normalizado nosotros.
fn parse_http_or_rfc3339(s: &str) -> Option<DateTime<Utc>> {
    if let Ok(d) = DateTime::parse_from_rfc2822(s) {
        return Some(d.with_timezone(&Utc));
    }
    if let Ok(d) = DateTime::parse_from_rfc3339(s) {
        return Some(d.with_timezone(&Utc));
    }
    None
}
