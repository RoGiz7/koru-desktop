//! Cliente ESI con caché (ETag/If-None-Match/304 + Expires), `X-Compatibility-Date`,
//! User-Agent, autenticación Bearer, error budget y límite de concurrencia global.
//!
//! Esto es lo que nos protege de un ban de CCP: no re-pedir antes de `Expires`,
//! cobrar `304` con el `ETag`, y respetar el error budget en vivo.

pub mod assets;
pub mod character;
pub mod contracts;
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

/// ★★ EL CONTADOR DE GASTO A ESI (2026-09-02, lo pidió RoGiz7).
///
/// Nació de una pregunta suya: *«las peticiones de 30 minutos son muy exigentes, ¿movemos assets a
/// una al día?»*. La respuesta razonada era que no hacía falta —la caché de 1 h ya se come una de
/// cada dos pasadas—, pero **razonar no es medir**, y esa cuenta la hice con un número inventado.
///
/// Lo que cuenta es LO QUE SALE DE VERDAD, no lo que se pide: `get_cached` se corta solo cuando la
/// caché local sigue vigente, y esas llamadas no cuestan nada. Confundir las dos cosas es
/// exactamente lo que llevaba a creer que gastábamos el doble.
///
/// Las fichas salen del sistema nuevo de CCP: **2XX=2 · 3XX=1 · 4XX=5 · 5XX=0**, devueltas a los
/// 15 minutos. Ver [[koru-esi-limites-peticiones]].
#[derive(Default)]
pub struct EsiGasto {
    /// Servidas desde NUESTRA caché: ni salieron. Son las que no cuestan nada.
    pub cache: std::sync::atomic::AtomicU64,
    pub ok2xx: std::sync::atomic::AtomicU64,
    /// 304 «no ha cambiado»: el ahorro del ETag, y solo cuesta 1 ficha.
    pub nm304: std::sync::atomic::AtomicU64,
    pub err4xx: std::sync::atomic::AtomicU64,
    pub err5xx: std::sync::atomic::AtomicU64,
    /// Desde cuándo se cuenta (epoch ms), para poder decir «en los últimos N minutos».
    pub desde_ms: std::sync::atomic::AtomicU64,
    /// ★ QUÉ está fallando, no solo cuántas veces. Sin esto el contador es un número que no se
    /// puede accionar: la primera medición dijo «8 errores = 28% del gasto» y no había forma de
    /// saber de dónde salían — porque varios sitios (p. ej. `resolve_location_named`) se tragan el
    /// error a propósito y no imprimen nada. Se guardan las últimas rutas, con su código.
    pub err_rutas: std::sync::Mutex<Vec<String>>,
}

pub struct EsiClient {
    http: reqwest::Client,
    /// Limita cuántas peticiones ESI hay en vuelo a la vez (cortesía + evita ráfagas).
    sem: Semaphore,
    /// Marca de la última petición, para espaciar el ritmo global.
    last_req: Mutex<Instant>,
    /// Cuánto le estamos pidiendo a ESI de verdad. Ver `EsiGasto`.
    pub gasto: EsiGasto,
}

impl EsiClient {
    pub fn new(http: reqwest::Client) -> Self {
        let g = EsiGasto::default();
        g.desde_ms.store(
            chrono::Utc::now().timestamp_millis() as u64,
            std::sync::atomic::Ordering::Relaxed,
        );
        Self {
            http,
            sem: Semaphore::new(4),
            last_req: Mutex::new(Instant::now() - MIN_INTERVAL),
            gasto: g,
        }
    }

    fn apuntar(&self, c: &std::sync::atomic::AtomicU64) {
        c.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
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
        self.get_cached_pages::<T>(db, character_id, path, access_token, false)
            .await
            .map(|(v, _)| v)
    }

    /// Como `get_cached`, pero además devuelve **cuántas páginas** tiene ese endpoint (`X-Pages`).
    ///
    /// ★★ POR QUÉ EXISTE (2026-09-02, salió de una medición suya): los bucles de paginación pedían
    /// páginas hasta que ESI contestaba **404**, y usaban ese 404 como señal de parada. Era gratis
    /// cuando ESI solo limitaba errores; con el sistema nuevo **un 4xx cuesta 5 fichas, el precio
    /// más caro que hay**. En su primera medición, 30 de esos 404 deliberados se llevaron 150 de
    /// las 291 fichas gastadas: **el 52% del gasto, sin aportar un solo dato**.
    /// Con `X-Pages` se sabe cuántas hay desde la primera y no se sondea a ciegas.
    /// `aprender_paginas`: ponlo a `true` SOLO en la página 1 de un bucle paginado.
    ///
    /// ⚠️ HACE FALTA POR ALGO QUE NO SE VE: **un 304 no trae `X-Pages`**. Y assets y el diario
    /// casi nunca cambian, así que su página 1 responde «no ha cambiado» una y otra vez y el
    /// número de páginas **no se aprendería jamás** — que es exactamente lo que se midió: el
    /// arreglo puesto y los 404 intactos. Con esta bandera, si no sabemos las páginas se pide una
    /// vez SIN `If-None-Match` para forzar un 200 que sí traiga la cabecera. Cuesta 2 fichas una
    /// sola vez y ahorra un 404 (5 fichas) en cada pasada, para siempre.
    ///
    /// Y no se queda obsoleto: `X-Pages` viene con cada 200, y un 200 solo ocurre cuando el dato
    /// cambió — que es justo cuando el número de páginas puede haber cambiado. Con un 304 se
    /// conserva el anterior, y es correcto porque nada cambió.
    pub async fn get_cached_pages<T: DeserializeOwned>(
        &self,
        db: &Db,
        character_id: i64,
        path: &str,
        access_token: Option<&str>,
        aprender_paginas: bool,
    ) -> AppResult<(T, Option<i64>)> {
        // 1) ¿Tenemos cache vigente? Si Expires está en el futuro, no llamamos siquiera.
        //    DEFENSA: para endpoints por personaje (character_id != 0) no confiamos en un
        //    Expires a más de 1h vista — una cabecera anómala (o un desfase de reloj) podría
        //    congelar el dato indefinidamente (p. ej. killmails que dejan de refrescarse).
        //    Pasada la hora revalidamos con ETag: si no cambió, ESI responde 304 (baratísimo).
        //    El namespace 0 (públicos inmutables, p. ej. detalle de killmail) sí confía siempre.
        let cached = db.get_cache(character_id, path)?;
        if let Some(ref c) = cached {
            if let Some(exp) = c.expires.as_deref().and_then(parse_http_or_rfc3339) {
                let now = Utc::now();
                let trustworthy =
                    character_id == 0 || exp <= now + chrono::Duration::hours(1);
                let falta_aprender = aprender_paginas && c.pages.is_none();
                if exp > now && trustworthy && !falta_aprender {
                    // Ni sale de casa: esta es la que hace que sincronizar cada 30 min no cueste
                    // el doble que cada hora.
                    self.apuntar(&self.gasto.cache);
                    return Ok((serde_json::from_str::<T>(&c.payload)?, c.pages));
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
                // Sin ETag cuando hay que aprender las páginas: con él responderían 304 y el 304
                // no trae `X-Pages`, así que nunca saldríamos del sondeo a ciegas.
                let forzar_200 = aprender_paginas && c.pages.is_none();
                if let (Some(etag), false) = (c.etag.as_ref(), forzar_200) {
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
        // Se apunta AQUÍ, con la respuesta ya en la mano: es el único sitio donde se sabe qué
        // salió de verdad y con qué código, que es lo que decide las fichas que costó.
        {
            let c = status.as_u16();
            if c == 304 {
                self.apuntar(&self.gasto.nm304);
            } else if status.is_success() {
                self.apuntar(&self.gasto.ok2xx);
            } else if (400..500).contains(&c) {
                self.apuntar(&self.gasto.err4xx);
                // ⚠️ CON el `?page=`, y me costó una ronda entera aprenderlo: al principio lo
                // quitaba «porque interesa el patrón, no cada caso», y resultó ser justo el dato
                // que hacía falta para saber si el arreglo de X-Pages funcionaba. Un 404 en la
                // página 2 y uno en la 7 cuentan historias distintas.
                let ruta = path;
                if let Ok(mut v) = self.gasto.err_rutas.lock() {
                    let linea = format!("{c} {ruta}");
                    if !v.contains(&linea) {
                        v.push(linea);
                        if v.len() > 40 {
                            v.remove(0);
                        }
                    }
                }
            } else if c >= 500 {
                self.apuntar(&self.gasto.err5xx);
            }
        }
        let etag = header_string(&resp, "etag");
        let expires = header_string(&resp, "expires");
        // X-Pages: cuántas páginas tiene el recurso. Es lo que sustituye al sondeo hasta el 404.
        let pages = header_string(&resp, "x-pages").and_then(|v| v.trim().parse::<i64>().ok());

        // 5) 304: el contenido no cambió; refrescamos solo el Expires y devolvemos la cache.
        if status == reqwest::StatusCode::NOT_MODIFIED {
            if let Some(ref c) = cached {
                db.put_cache(
                    character_id,
                    path,
                    etag.as_deref().or(c.etag.as_deref()),
                    expires.as_deref(),
                    &c.payload,
                    pages,
                )?;
                return Ok((serde_json::from_str::<T>(&c.payload)?, pages.or(c.pages)));
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
            pages,
        )?;
        Ok((serde_json::from_str::<T>(&body)?, pages))
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

    /// Pone un waypoint en el piloto automático DEL JUEGO (POST /ui/autopilot/waypoint).
    /// Requiere el scope `esi-ui.write_waypoint.v1`. `destination_id` puede ser system_id,
    /// station_id o structure_id. `clear` = true limpia los waypoints previos (destino nuevo);
    /// false lo añade al final de la ruta actual. La ruta la calcula el JUEGO con las preferencias
    /// del jugador (seguridad, usar Ansiblex, etc.), así que si tiene los puentes activados, EVE
    /// rutea por ellos igual que Koru. Devuelve 204 sin cuerpo al acertar.
    pub async fn set_waypoint(&self, token: &str, destination_id: i64, clear: bool) -> AppResult<()> {
        let _permit = self
            .sem
            .acquire()
            .await
            .map_err(|e| AppError::Other(format!("semaphore: {e}")))?;
        self.pace().await;
        let url = format!(
            "{}/ui/autopilot/waypoint/?add_to_beginning=false&clear_other_waypoints={}&destination_id={}",
            config::ESI_BASE_URL, clear, destination_id
        );
        let resp = self
            .http
            .post(&url)
            .header("X-Compatibility-Date", config::ESI_COMPATIBILITY_DATE)
            .bearer_auth(token)
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            // 403 = falta el scope write_waypoint (el usuario no ha reautenticado con Ubicación).
            if status.as_u16() == 403 {
                return Err(AppError::Other(
                    "falta el permiso de navegación: vuelve a iniciar sesión con «Ubicación» para conceder «poner destino en EVE»".into(),
                ));
            }
            return Err(AppError::Other(format!("ESI {status} al poner el waypoint: {body}")));
        }
        Ok(())
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
pub(crate) fn parse_http_or_rfc3339(s: &str) -> Option<DateTime<Utc>> {
    if let Ok(d) = DateTime::parse_from_rfc2822(s) {
        return Some(d.with_timezone(&Utc));
    }
    if let Ok(d) = DateTime::parse_from_rfc3339(s) {
        return Some(d.with_timezone(&Utc));
    }
    None
}
