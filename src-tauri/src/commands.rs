//! Comandos Tauri expuestos al frontend.

use crate::config;
use crate::db::{
    AnsiblexRow, CharacterRow, Db, FacilityRow, FinancialSummary, NetworthPoint, PvpActivity,
    PvpStats, PvpTrendPoint, RattingDetail, WalletStats, WalletTrendPoint,
};
use crate::db::{NameCount, SystemActivity, TopKill};
use crate::error::{AppError, AppResult};
use crate::esi::assets::AssetsSummary;
use crate::esi::industry::{JobRaw, MiningRow, MiningSummary};
use crate::esi::killmails::KillmailDetail;
use crate::esi::skills::SkillsSummary;
use crate::esi::{assets, contracts, industry, killmails, market, skills, wallet, EsiClient};
use crate::sso::{self, LoginOutcome, TokenManager};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
// `Manager` entra con el overlay: es el trait que trae `get_webview_window`.
use tauri::{Emitter, Manager, State, Window};

/// Estado global de la app, gestionado por Tauri.
pub struct AppState {
    pub db: Db,
    /// Ruta del archivo SQLite en disco (para backup/restauración).
    pub db_path: std::path::PathBuf,
    pub tokens: TokenManager,
    pub esi: EsiClient,
    /// Bandera para cancelar una sincronización en curso.
    pub cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
    /// Vigilancia de intel en segundo plano (hilo nativo, sin throttle del SO).
    pub intel: std::sync::Arc<IntelWatch>,
}

// --- Copia de seguridad / restauración del histórico local ---
// Todo el histórico (journal, transacciones, minería, snapshots de patrimonio, killmails,
// cachés) vive SOLO en este SQLite. Si el usuario cambia de PC o reinstala, lo pierde todo.
// Estos comandos permiten exportarlo y restaurarlo (clave para el modelo local-first).
// Los refresh tokens NO están aquí: viven en el keychain del SO → en un PC nuevo basta
// con volver a iniciar sesión.

/// Ruta del archivo de "staging" donde dejamos una restauración pendiente. Se aplica en el
/// próximo arranque (ver `lib.rs`), porque no se puede reemplazar la BD mientras está abierta.
pub fn restore_staging_path(db_path: &std::path::Path) -> std::path::PathBuf {
    let mut p = db_path.as_os_str().to_owned();
    p.push(".restore");
    std::path::PathBuf::from(p)
}

/// Información de la BD local (ruta y tamaño) para mostrarla en el menú de Ajustes.
#[derive(Debug, Serialize)]
pub struct DbInfo {
    pub path: String,
    pub size: u64,
}

/// Devuelve la ruta y el tamaño (bytes) del archivo SQLite. El tamaño incluye, si existe,
/// el sidecar `-wal` (datos aún no consolidados) para reflejar el total real en disco.
#[tauri::command]
pub fn db_info(state: State<'_, AppState>) -> AppResult<DbInfo> {
    let path = &state.db_path;
    let mut size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let wal = path.with_extension("sqlite3-wal");
    if let Ok(m) = std::fs::metadata(&wal) {
        size += m.len();
    }
    Ok(DbInfo {
        path: path.to_string_lossy().to_string(),
        size,
    })
}

/// Crea una copia de seguridad consistente de la BD en `dest` (un único archivo .sqlite3).
/// Usa `VACUUM INTO`, que consolida también el WAL pendiente → copia íntegra y compacta
/// aunque la app esté en uso. Devuelve la ruta escrita.
#[tauri::command]
pub fn backup_db(state: State<'_, AppState>, dest: String) -> AppResult<String> {
    // VACUUM INTO falla si el destino ya existe; lo quitamos primero (el usuario ya
    // confirmó sobrescribir en el diálogo "Guardar como").
    if std::path::Path::new(&dest).exists() {
        std::fs::remove_file(&dest)
            .map_err(|e| AppError::Other(format!("no se pudo sobrescribir el destino: {e}")))?;
    }
    let conn = state
        .db
        .conn
        .lock()
        .map_err(|_| AppError::Other("la base de datos está ocupada".into()))?;
    conn.execute("VACUUM INTO ?1", [&dest])?;
    Ok(dest)
}

/// Borra las copias automáticas más antiguas dejando solo las `keep` más recientes.
/// `keep == 0` = conservar todas (no borra nada). El timestamp del nombre ordena por fecha.
fn prune_autobackups(dir: &str, keep: usize) -> std::io::Result<()> {
    if keep == 0 {
        return Ok(());
    }
    let mut files: Vec<std::path::PathBuf> = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("koru-autobackup-") && n.ends_with(".sqlite3"))
                .unwrap_or(false)
        })
        .collect();
    files.sort(); // orden ascendente por nombre = cronológico
    if files.len() > keep {
        for p in &files[..files.len() - keep] {
            let _ = std::fs::remove_file(p);
        }
    }
    Ok(())
}

/// Crea una copia automática en `dir` con nombre `koru-autobackup-FECHA.sqlite3` y rota las
/// antiguas (deja `keep`). Mismo motor que el backup manual (`VACUUM INTO`). La llama el
/// frontend cuando toca según la frecuencia configurada. Devuelve la ruta escrita.
#[tauri::command]
pub fn auto_backup(state: State<'_, AppState>, dir: String, keep: usize) -> AppResult<String> {
    let stamp = chrono::Local::now().format("%Y-%m-%d_%H%M%S").to_string();
    let dest = std::path::Path::new(&dir).join(format!("koru-autobackup-{stamp}.sqlite3"));
    let dest_str = dest.to_string_lossy().to_string();
    {
        let conn = state
            .db
            .conn
            .lock()
            .map_err(|_| AppError::Other("la base de datos está ocupada".into()))?;
        if dest.exists() {
            std::fs::remove_file(&dest)
                .map_err(|e| AppError::Other(format!("no se pudo escribir la copia: {e}")))?;
        }
        conn.execute("VACUUM INTO ?1", [&dest_str])?;
    }
    prune_autobackups(&dir, keep)
        .map_err(|e| AppError::Other(format!("no se pudieron rotar las copias antiguas: {e}")))?;
    Ok(dest_str)
}

/// Restaura un backup previamente exportado. No se puede reemplazar la BD mientras la
/// conexión está abierta, así que dejamos el archivo en "staging" junto a la BD y reiniciamos:
/// en el próximo arranque se aplica el reemplazo con la BD ya cerrada (ver `lib.rs`).
#[tauri::command]
pub fn restore_db(app: tauri::AppHandle, state: State<'_, AppState>, src: String) -> AppResult<()> {
    // 1) Validar que es una BD SQLite de Koru (abrir solo-lectura y comprobar el esquema).
    {
        let test = rusqlite::Connection::open_with_flags(
            &src,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .map_err(|e| AppError::Other(format!("no es una base de datos válida: {e}")))?;
        let n: i64 = test
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='characters'",
                [],
                |r| r.get(0),
            )
            .map_err(|e| AppError::Other(format!("no se pudo leer la copia: {e}")))?;
        if n == 0 {
            return Err(AppError::Other(
                "el archivo no parece una copia de Koru (falta la tabla characters)".into(),
            ));
        }
    }
    // 2) Copiar a <bd>.restore (staging). Se aplica en el próximo arranque.
    let staging = restore_staging_path(&state.db_path);
    std::fs::copy(&src, &staging)
        .map_err(|e| AppError::Other(format!("no se pudo preparar la restauración: {e}")))?;
    // 3) Reiniciar para aplicar el reemplazo con la BD cerrada. `restart()` normalmente no
    // retorna (-> !); el `Ok(())` queda por si la versión de Tauri lo tipa como `()`.
    app.restart();
    #[allow(unreachable_code)]
    Ok(())
}

/// Cancela la sincronización en curso (la marca; el bucle la detecta y para limpio).
#[tauri::command]
pub fn cancel_sync(state: State<'_, AppState>) {
    state
        .cancel
        .store(true, std::sync::atomic::Ordering::Relaxed);
}

/// Resultado de una auto-sincronización.
#[derive(Debug, Serialize)]
pub struct AutoSyncResult {
    pub killmails: usize,
    pub wallet: usize,
    pub mining: usize,
    pub prices: usize,
    pub snapshots: usize,
    /// Trabajos de industria vistos y guardados en esta pasada (activos + completados).
    pub jobs: i64,
    /// Contratos vistos y guardados en esta pasada (todos los tipos, no solo courier).
    pub contracts: i64,
    /// Programas de extracción de PI registrados por PRIMERA vez en esta pasada. No es
    /// «extractores que tienes», es «programas nuevos»: si no reprogramaste nada, es 0.
    pub pi_programs: i64,
    /// I1 · Cambios de inventario grabados en esta pasada (apariciones + desapariciones). Lo
    /// normal es 0: solo sube cuando de verdad entra o sale algo de un sitio. La primera pasada
    /// de un personaje también da 0 a propósito — se siembra el estado en silencio.
    pub asset_events: i64,
    /// N2b · Notas que han saltado porque llegó lo que esperaban.
    pub fired_notes: Vec<crate::db::NoteRow>,
    /// Errores por personaje/paso. Antes se tragaban en silencio y un fallo persistente
    /// (token caducado, scope revocado, 4xx de ESI) podía dejar una sección congelada
    /// días sin que nadie lo viera (p. ej. killmails parados desde el 26-06).
    pub errors: Vec<String>,
}

/// Un logro recién desbloqueado (para notificar en vivo desde auto_sync).
#[derive(Debug, Clone, Serialize)]
pub struct BitacoraUnlock {
    pub id: String,
    pub level: u8,
}

/// Evento "bitacora-unlock": logros nuevos detectados en un auto_sync. El front reproduce
/// el sonido celebratorio y muestra un toast con los nombres (el catálogo vive en TS).
#[derive(Debug, Clone, Serialize)]
pub struct BitacoraUnlockEvent {
    pub unlocks: Vec<BitacoraUnlock>,
}

/// Sincroniza incrementalmente lo ligero de todos los personajes (killmails recientes,
/// wallet, minería). Respeta la caché ESI (no re-descarga antes del Expires), así que es
/// seguro llamarla al abrir y periódicamente. Para histórico completo de PvP, usar el botón.
/// Recibe `app` (inyectado por Tauri) para poder avisar de logros nuevos de la Bitácora.
#[tauri::command]
pub async fn auto_sync(app: tauri::AppHandle, state: State<'_, AppState>) -> AppResult<AutoSyncResult> {
    let mut res = AutoSyncResult {
        killmails: 0,
        wallet: 0,
        mining: 0,
        prices: 0,
        snapshots: 0,
        jobs: 0,
        contracts: 0,
        pi_programs: 0,
        asset_events: 0,
        fired_notes: Vec::new(),
        errors: Vec::new(),
    };
    // Notas que han saltado porque llegó lo que esperaban. Se acumulan en el bucle de personajes
    // y viajan en el resultado del sync, igual que las de llegada viajan con la posición.
    let mut notas_assets: Vec<crate::db::NoteRow> = Vec::new();

    // Precios de mercado primero (público, cacheado ≈1h) para valorar assets en los snapshots.
    if let Ok(n) = market::sync_prices(&state.esi, &state.db).await {
        res.prices = n;
    }

    let prices = state.db.prices_map().unwrap_or_default();
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    // R1a Planetología: alarmas de extractores recolectadas durante el bucle de personajes
    // (personaje, sistema_id, horas restantes; horas<=0 = caducado). Se notifican al final.
    let mut pi_alerts: Vec<(String, i64, String, i64)> = Vec::new(); // (char, sistema, tipo_planeta, horas)
    let mut pi_alert_keys: Vec<(String, String)> = Vec::new(); // (clave dedup, expiry completo)
    // Umbrales de alarma de PI configurables (horas), doble/triple aviso a gusto del usuario.
    // meta "pi_alert_hours" = JSON [8, 1]. Por defecto 8h y 1h (24h fijo freía con reprogramado diario).
    let mut pi_thresholds: Vec<f64> = state
        .db
        .meta_get("pi_alert_hours")
        .and_then(|v| serde_json::from_str::<Vec<f64>>(&v).ok())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| vec![8.0, 1.0]);
    pi_thresholds.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    // Interruptor MAESTRO de los avisos de PI (petición de un jugador vía RoGiz7: a quien no hace
    // planetología le saltaba «extractores PARADOS» igualmente). meta "pi_alerts_on", default ON.
    // Con OFF se vacían los umbrales (no se recolecta nada) — la SECCIÓN Planetología sigue
    // enseñando el estado igual: esto solo silencia notificaciones y toasts, como el intel en OFF.
    let pi_alerts_on = state
        .db
        .meta_get("pi_alerts_on")
        .map(|v| v != "0")
        .unwrap_or(true);
    if !pi_alerts_on {
        pi_thresholds.clear();
    }
    for c in state.db.list_characters()? {
        let valid = match state
            .tokens
            .access_token(state.esi.http(), c.character_id)
            .await
        {
            Ok(v) => v,
            Err(e) => {
                let msg = format!("{}: token: {e}", c.name);
                eprintln!("auto_sync {msg}");
                res.errors.push(msg);
                continue;
            }
        };
        let has = |scope: &str| c.scopes.iter().any(|s| s == scope);
        if has("esi-killmails.read_killmails.v1") {
            match killmails::sync(&state.esi, &state.db, c.character_id, &valid.access_token).await
            {
                Ok(n) => res.killmails += n,
                Err(e) => {
                    let msg = format!("{}: killmails: {e}", c.name);
                    eprintln!("auto_sync {msg}");
                    res.errors.push(msg);
                }
            }
            // Kills de PARTICIPACIÓN: un killmail solo "pertenece" a la víctima y al que da
            // el golpe final, y ESI /killmails/recent/ solo devuelve esos. Las kills donde
            // participas sin final blow SOLO están en zKillboard (las agrega de los logs de
            // todos los implicados) → 1 página ligera por personaje y sync (respetuoso).
            let cancel = std::sync::atomic::AtomicBool::new(false);
            match killmails::sync_full(&state.esi, &state.db, c.character_id, 1, &cancel, |_, _| {})
                .await
            {
                Ok(n) => res.killmails += n,
                Err(e) => {
                    let msg = format!("{}: killmails zKill: {e}", c.name);
                    eprintln!("auto_sync {msg}");
                    res.errors.push(msg);
                }
            }
        }
        if has("esi-wallet.read_character_wallet.v1") {
            if let Ok(n) = wallet::sync_journal(
                &state.esi,
                &state.db,
                c.character_id,
                &valid.access_token,
                50,
            )
            .await
            {
                res.wallet += n;
            }
            let _ = wallet::sync_transactions(
                &state.esi,
                &state.db,
                c.character_id,
                &valid.access_token,
            )
            .await;
        }
        if has("esi-industry.read_character_mining.v1") {
            if let Ok(n) =
                industry::sync_mining(&state.esi, &state.db, c.character_id, &valid.access_token)
                    .await
            {
                res.mining += n;
            }
        }
        // Contratos: el libro de viajes del pilar de transporte (T1). Se graba desde ya aunque
        // todavía no haya ninguna pantalla que lo enseñe — la ventana de ESI aquí es MÁS corta que
        // la de industria (~30 días), así que esperar a construir el panel de estadísticas sería
        // construirlo sobre nada. Ver documentacion/SPEC_TRANSPORTE.md §3bis.
        if has("esi-contracts.read_character_contracts.v1") {
            match contracts::sync_contracts(&state.esi, &state.db, c.character_id, &valid.access_token)
                .await
            {
                Ok(n) => res.contracts += n as i64,
                Err(e) => {
                    let msg = format!("{}: contratos: {e}", c.name);
                    eprintln!("auto_sync {msg}");
                    res.errors.push(msg);
                }
            }
        }
        // Trabajos de industria: se guardan AQUÍ y no solo al abrir la sección, porque la ventana
        // de ESI son 90 días. Quien no entre a Industria en tres meses perdería el trimestre
        // entero, y justo el que más fabrica es el que menos mira la lista.
        if has("esi-industry.read_character_jobs.v1") {
            match industry::sync_jobs(&state.esi, &state.db, c.character_id, &valid.access_token)
                .await
            {
                Ok(v) => res.jobs += v.len() as i64,
                Err(e) => {
                    let msg = format!("{}: jobs: {e}", c.name);
                    eprintln!("auto_sync {msg}");
                    res.errors.push(msg);
                }
            }
        }

        // ---- R1a Planetología: vigilancia de extractores (SPEC_PLANETOLOGIA.md §3) ----
        // El dolor nº1 de PI es "se me paró el extractor y no me enteré". Con el ciclo normal
        // de sync (get_cached + ETag: los 304 son gratis) revisamos la caducidad de cada
        // extractor: <24h = aviso, <=0 = caducado. La clave incluye expiry: reinstalar el
        // extractor cambia la fecha → clave nueva → volverá a avisar cuando toque.
        if has("esi-planets.manage_planets.v1") {
            let cid = c.character_id;
            if let Ok(planets) = state
                .esi
                .get_cached::<Vec<PlanetRaw>>(
                    &state.db,
                    cid,
                    &format!("/characters/{cid}/planets/"),
                    Some(&valid.access_token),
                )
                .await
            {
                for p in &planets {
                    if p.planet_id == 0 {
                        continue;
                    }
                    let pid = p.planet_id;
                    let Ok(detail) = state
                        .esi
                        .get_cached::<PlanetDetail>(
                            &state.db,
                            cid,
                            &format!("/characters/{cid}/planets/{pid}/"),
                            Some(&valid.access_token),
                        )
                        .await
                    else {
                        continue;
                    };
                    // Existencias de ESTA colonia, sumadas entre todos sus pins (ver abajo).
                    let mut pi_storage: HashMap<i64, i64> = HashMap::new();
                    for pin in &detail.pins {
                        // ---- Persistencia: la PI no tiene log de eventos, la película la
                        // construye Koru. Va ANTES del interruptor de avisos a propósito: a quien
                        // tiene las alarmas en OFF también hay que guardarle el histórico, si no
                        // silenciar los toasts le borraría los datos sin que nadie se lo dijera.
                        //
                        // Un programa de extracción se identifica por (planeta, pin, install_time):
                        // la BD ignora el duplicado, así que sondear no escribe. Sin `install_time`
                        // no hay evento que registrar (fábricas, almacenes, centro de mando).
                        if let (Some(ex), Some(install)) = (&pin.extractor, &pin.install_time) {
                            match state.db.insert_pi_program(
                                cid,
                                pid,
                                pin.pin_id,
                                p.solar_system_id,
                                Some(p.planet_type.as_str()),
                                ex.product_type_id,
                                ex.qty_per_cycle,
                                ex.cycle_time,
                                install,
                                pin.expiry_time.as_deref(),
                            ) {
                                Ok(true) => res.pi_programs += 1,
                                Ok(false) => {}
                                Err(e) => eprintln!("auto_sync pi_program {pid}: {e}"),
                            }
                        }
                        // Existencias: se ACUMULAN por colonia aquí y se escriben al salir del
                        // bucle. Escribirlas pin a pin sería un bug silencioso: dos launchpads con
                        // el mismo producto comparten clave (colonia, día, tipo) y el segundo
                        // upsert PISA al primero, así que la colonia declararía la mitad.
                        for c_item in &pin.contents {
                            *pi_storage.entry(c_item.type_id).or_insert(0) += c_item.amount;
                        }

                        // Interruptor maestro en OFF: ni siquiera los «PARADOS» (dead se empuja
                        // fuera de los umbrales, así que vaciar pi_thresholds NO bastaba).
                        if !pi_alerts_on {
                            continue;
                        }
                        let (Some(_ex), Some(expiry)) = (&pin.extractor, &pin.expiry_time) else {
                            continue;
                        };
                        let Ok(exp) = chrono::DateTime::parse_from_rfc3339(expiry) else {
                            continue;
                        };
                        let hours = (exp.with_timezone(&chrono::Utc) - chrono::Utc::now())
                            .num_minutes() as f64
                            / 60.0;
                        // Banda más ajustada que cruza: dead (<=0) o el menor umbral T con horas<=T.
                        // Por encima del mayor umbral no avisa. Cada banda dispara una sola vez (dedup).
                        let stage: String = if hours <= 0.0 {
                            "dead".to_string()
                        } else if let Some(t) = pi_thresholds.iter().find(|&&t| hours <= t) {
                            format!("h{}", *t as i64)
                        } else {
                            continue;
                        };
                        pi_alerts.push((
                            c.name.clone(),
                            p.solar_system_id,
                            p.planet_type.clone(),
                            hours.ceil() as i64,
                        ));
                        pi_alert_keys.push((
                            format!("{pid}:{}:{expiry}:{stage}", pin.pin_id),
                            expiry.clone(),
                        ));
                    }
                    // Foto del día ya sumada entre todos los pins de la colonia. Se escribe una
                    // vez por colonia y pasada; el upsert pisa la lectura anterior del mismo día,
                    // así que el tamaño está acotado por colonias × tipos × días.
                    for (type_id, qty) in pi_storage {
                        if let Err(e) = state.db.upsert_pi_storage(cid, pid, &today, type_id, qty) {
                            eprintln!("auto_sync pi_storage {pid}: {e}");
                        }
                    }
                }
            }
        }

        // Snapshot de patrimonio del día: liquid (wallet) + valor estimado de assets.
        let mut liquid = 0.0;
        let mut asset_value = 0.0;
        let mut have_data = false;
        let mut skip_networth = false;
        if has("esi-wallet.read_character_wallet.v1") {
            if let Ok(b) =
                wallet::balance(&state.esi, &state.db, c.character_id, &valid.access_token).await
            {
                liquid = b;
                have_data = true;
            }
        }
        if has("esi-assets.read_assets.v1") {
            // ⚠️ El inventario puede quedarse quieto por DOS motivos opuestos —«no se movió
            // nada» y «ni siquiera he mirado»— y desde fuera son idénticos. `get_cached` respeta
            // el `Expires` y ni llama a ESI mientras siga vigente (los assets duran ~1 h), así
            // que mover algo en el juego y sincronizar no garantiza verlo. Decir hasta cuándo
            // vale la foto convierte ese silencio ambiguo en un dato. Misma enfermedad que el
            // intel mudo y el gamelog viejo: lo que calla, engaña.
            if let Ok(Some(c0)) = state.db.get_cache(
                c.character_id,
                &format!("/characters/{}/assets/?page=1", c.character_id),
            ) {
                if let Some(t) = c0.expires.as_deref().and_then(crate::esi::parse_http_or_rfc3339) {
                    let quedan = (t - chrono::Utc::now()).num_minutes();
                    if quedan > 0 {
                        eprintln!(
                            "auto_sync {}: la foto de assets vale {quedan} min más; hasta entonces el inventario no puede cambiar",
                            c.name
                        );
                    }
                }
            }

            // UNA sola descarga para dos cosas. El snapshot de patrimonio ya bajaba los assets
            // enteros y los tiraba; el inventario (I1) se cuelga de esa misma foto, así que
            // guardar la película NO añade ni una llamada a ESI. Ver SPEC_INVENTARIO.md.
            let (items, complete) = assets::fetch_all_assets_checked(
                &state.esi,
                &state.db,
                c.character_id,
                &valid.access_token,
            )
            .await;

            // I1 · INVENTARIO: estado + los cambios respecto a la última foto. Sin una sola
            // pantalla, igual que industria, PI y contratos en su día. `complete` es lo que
            // impide escribir desapariciones falsas cuando ESI pierde una página.
            match assets::sync_inventory(&state.db, c.character_id, &items, complete, &prices) {
                Ok(r) => {
                    res.asset_events += r.events;
                    // Solo se habla cuando pasa algo. El caso normal —nada se movió— es silencio;
                    // si esto imprimiera en cada pasada, en un mes nadie leería la línea que sí
                    // importa. La siembra se anuncia porque es el día en que empieza el histórico
                    // de ese personaje, y esa fecha explica luego por qué la película no llega
                    // más atrás.
                    if r.seeded {
                        eprintln!(
                            "auto_sync {}: inventario sembrado ({} pilas). El histórico empieza aquí.",
                            c.name, r.stacks
                        );
                    } else if r.events > 0 {
                        // Las UBICACIONES son lo que da sentido al número de cambios: un viaje
                        // toca DOS sitios por muchos tipos que lleve la nave dentro (el casco,
                        // cada módulo montado, los drones y la munición cargada viajan con ella
                        // y cada uno cuenta doble, al salir y al llegar). Cincuenta cambios en
                        // dos ubicaciones es un viaje; cincuenta en treinta sería un fallo.
                        let mut sitios: Vec<i64> = r.locations.iter().copied().collect();
                        sitios.sort_unstable();
                        eprintln!(
                            "auto_sync {}: inventario, {} cambios en {} ubicaciones {:?} ({} pilas)",
                            c.name,
                            r.events,
                            sitios.len(),
                            sitios,
                            r.stacks
                        );
                    }
                    // ★ N2b: ¿alguien esperaba algo de esto? «Avisarme cuando lleguen Quake M a
                    // TTP-2B.» Sirve para lo que llega SIN TI —un courier, un deliver que te hace
                    // otro piloto de palabra— porque tu propia carga ya sabes cuándo llega.
                    for (loc, tid) in &r.arrivals {
                        match state.db.notes_fire_on_asset(c.character_id, *loc, *tid) {
                            Ok(v) => {
                                for n in v {
                                    eprintln!(
                                        "notas: llegó el tipo {tid} a {loc} ({}) → «{}»",
                                        c.name, n.body
                                    );
                                    notas_assets.push(n);
                                }
                            }
                            Err(e) => eprintln!("notes_fire_on_asset: {e}"),
                        }
                    }
                    if let Some(motivo) = r.skipped {
                        // No es un error de red: es Koru negándose a firmar un dato del que no se
                        // fía. Tiene que verse, o el histórico se quedaría quieto en silencio.
                        let msg = format!("{}: inventario omitido ({motivo})", c.name);
                        eprintln!("auto_sync {msg}");
                        res.errors.push(msg);
                    }
                }
                Err(e) => {
                    let msg = format!("{}: inventario: {e}", c.name);
                    eprintln!("auto_sync {msg}");
                    res.errors.push(msg);
                }
            }

            // ⚠️ El mismo `complete` protege el PATRIMONIO, y esto arregla un fallo que llevaba
            // aquí desde siempre: con una página perdida, `summary` devolvía Ok con la suma de lo
            // poco que llegó, y el snapshot del día se guardaba con un patrimonio falsamente bajo
            // — un escalón hacia abajo en la gráfica que nadie escribió nunca. Se prefiere un
            // hueco (que la vista ya sabe declarar como ceguera) a un número inventado.
            if complete {
                if let Ok(s) = assets::summary_from_items(&state.esi, &state.db, &items).await {
                    asset_value = s.est_value_clean; // patrimonio sin blueprints inflados
                    have_data = true;
                    // Papeles redimibles: snapshot del stock del día desde el mismo summary (sin ESI extra).
                    for (&tid, &qty) in &s.watched {
                        let value = qty as f64 * prices.get(&tid).copied().unwrap_or(0.0);
                        let _ = state
                            .db
                            .insert_paper_snapshot(c.character_id, &today, tid, qty, value);
                    }
                }
            } else {
                // Sin assets fiables no hay patrimonio que apuntar hoy: mejor no tocar la fila
                // del día que pisarla con un valor que sabemos incompleto.
                skip_networth = true;
            }
        }
        if have_data
            && !skip_networth
            && state
                .db
                .insert_networth_snapshot(c.character_id, &today, liquid, asset_value)
                .is_ok()
        {
            res.snapshots += 1;
        }
    }

    // ---- R1a Planetología: notificar extractores caducados/por caducar (con dedup persistente) ----
    // meta "pi_alerted" = JSON {clave: expiry}. Solo se notifican claves NUEVAS; las claves cuya
    // expiry quedó >7 días atrás se podan (el pin se reinstaló o la colonia murió hace tiempo).
    if !pi_alert_keys.is_empty() {
        let mut seen: std::collections::HashMap<String, String> = state
            .db
            .meta_get("pi_alerted")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or_default();
        let cutoff = chrono::Utc::now() - chrono::Duration::days(7);
        // Poda por el VALOR (expiry completo). Antes se troceaba la clave por ':' pero el expiry
        // RFC3339 lleva ':' → nth(2) devolvía un trozo que no parseaba y la poda vaciaba el mapa.
        seen.retain(|_k, v| {
            chrono::DateTime::parse_from_rfc3339(v)
                .ok()
                .map(|e| e.with_timezone(&chrono::Utc) > cutoff)
                .unwrap_or(false)
        });
        let mut fresh: Vec<(String, i64, String, i64)> = Vec::new();
        for (alert, (key, expiry)) in pi_alerts.into_iter().zip(pi_alert_keys.iter()) {
            if !seen.contains_key(key) {
                seen.insert(key.clone(), expiry.clone());
                fresh.push(alert);
            }
        }
        if !fresh.is_empty() {
            // Nombres de sistema para el mensaje (resolve_names cachea; ids repetidos, gratis).
            let sys_ids: Vec<i64> = fresh.iter().map(|(_, s, _, _)| *s).collect();
            let names = state.esi.resolve_names(&sys_ids).await.unwrap_or_default();
            let dead = fresh.iter().filter(|(_, _, _, h)| *h <= 0).count();
            // Capitaliza el tipo de planeta ("barren" → "Barren") para distinguir colonias del
            // mismo sistema (antes salían idénticas: "C-J6MT · C-J6MT · C-J6MT").
            let cap = |s: &str| -> String {
                let mut ch = s.chars();
                match ch.next() {
                    Some(f) => f.to_uppercase().collect::<String>() + ch.as_str(),
                    None => String::new(),
                }
            };
            let head = fresh
                .iter()
                .map(|(who, sys, ptype, h)| {
                    let s = names.get(sys).cloned().unwrap_or_else(|| format!("#{sys}"));
                    let planeta = if ptype.is_empty() { s } else { format!("{s} {}", cap(ptype)) };
                    if *h <= 0 {
                        format!("{planeta} ({who}): parado")
                    } else {
                        format!("{planeta} ({who}): {h}h")
                    }
                })
                .take(3)
                .collect::<Vec<_>>()
                .join(" · ");
            let extra = fresh.len().saturating_sub(3);
            let cuerpo = format!(
                "{head}{}",
                if extra > 0 { format!(" · +{extra} más") } else { String::new() }
            );
            use tauri_plugin_notification::NotificationExt;
            let titulo = if dead > 0 {
                "⛏️ PI: extractores PARADOS"
            } else {
                "⛏️ PI: extractores a punto de caducar"
            };
            let _ = app.notification().builder().title(titulo).body(&cuerpo).show();
            let _ = app.emit("pi-alert", &cuerpo);
        }
        let _ = state
            .db
            .meta_set("pi_alerted", &serde_json::to_string(&seen).unwrap_or_default());
    }

    // ---- Bitácora: avisar de logros NUEVOS del medallero global ----
    // Evaluamos el sujeto global (0) tras sincronizar. bitacora() persiste los desbloqueos y
    // marca `fresh` los que se insertan en ESTA llamada. Solo celebramos si el sujeto YA estaba
    // sembrado (was_seeded): en la 1ª evaluación de una BD virgen, todo el histórico entra de
    // golpe y sería un muro de avisos → se siembra en silencio. Notif nativa (aunque esté
    // minimizado) + evento para sonido/toast en el front.
    if let Ok(bit) = state.db.bitacora(None) {
        if bit.was_seeded {
            let nuevos: Vec<BitacoraUnlock> = bit
                .achievements
                .iter()
                .filter(|a| a.fresh && a.level > 0)
                .map(|a| BitacoraUnlock {
                    id: a.id.clone(),
                    level: a.level,
                })
                .collect();
            if !nuevos.is_empty() {
                use tauri_plugin_notification::NotificationExt;
                let cuerpo = if nuevos.len() == 1 {
                    "Has desbloqueado un logro nuevo. Ábrelo en la Bitácora 📖".to_string()
                } else {
                    format!(
                        "Has desbloqueado {} logros nuevos. Ábrelos en la Bitácora 📖",
                        nuevos.len()
                    )
                };
                let _ = app
                    .notification()
                    .builder()
                    .title("🏅 ¡Nuevo logro en Koru!")
                    .body(cuerpo)
                    .show();
                let _ = app.emit("bitacora-unlock", BitacoraUnlockEvent { unlocks: nuevos });
            }
        }
    }

    res.fired_notes = notas_assets;
    Ok(res)
}

/// Sincroniza precios de mercado (público) bajo demanda. Devuelve nº de tipos guardados.
#[tauri::command]
pub async fn sync_market(state: State<'_, AppState>) -> AppResult<usize> {
    market::sync_prices(&state.esi, &state.db).await
}

/// Precios medios de mercado para una lista de typeIDs (del prices_map local, sin red).
/// Lo usa Planetología para valorar producción; sirve para cualquier vista que necesite precios.
#[tauri::command]
pub fn get_type_prices(
    ids: Vec<i64>,
    state: State<'_, AppState>,
) -> AppResult<std::collections::HashMap<i64, f64>> {
    let prices = state.db.prices_map().unwrap_or_default();
    Ok(ids
        .into_iter()
        .filter_map(|id| prices.get(&id).map(|p| (id, *p)))
        .collect())
}

/// F1c — Una estructura tuya, para su ficha de instalación.
#[derive(Debug, Clone, Serialize)]
pub struct StructureView {
    pub id: i64,
    pub name: Option<String>,
    pub system_id: i64,
    /// Tipo (Sotiyo, Azbel…): con él salen sus bonos de industria del SDE, sin preguntar nada.
    pub type_id: Option<i64>,
}

/// Estructura tal y como la sirve `/universe/structures/{id}/` (nombre + sistema + tipo).
#[derive(Debug, Clone, serde::Deserialize)]
struct StructureInfo {
    #[serde(default)]
    solar_system_id: i64,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    type_id: Option<i64>,
}

/// F1c — Tus estructuras conocidas (las que la resolución de Assets ya cacheó en `location_system`).
/// El nombre y el TIPO se piden a `/universe/structures/{id}/` con cualquier token que tenga acceso;
/// va cacheado por Expires, así que repetir es barato. Las que nadie puede ver quedan fuera.
#[tauri::command]
pub async fn get_structures(state: State<'_, AppState>) -> AppResult<Vec<StructureView>> {
    let known = state.db.structures_known()?;
    if known.is_empty() {
        return Ok(Vec::new());
    }
    let tokens = structure_tokens(&state).await;
    let mut out = Vec::new();
    for (id, system_id) in known {
        let path = format!("/universe/structures/{id}/");
        let mut view = StructureView {
            id,
            name: None,
            system_id,
            type_id: None,
        };
        for tok in &tokens {
            if let Ok(info) = state
                .esi
                .get_cached::<StructureInfo>(&state.db, 0, &path, Some(tok.as_str()))
                .await
            {
                view.name = info.name;
                view.type_id = info.type_id;
                if info.solar_system_id != 0 {
                    view.system_id = info.solar_system_id;
                }
                break;
            }
        }
        out.push(view);
    }
    Ok(out)
}

// ---- F1c: fichas de instalación ----
//
// El registro de estructuras del fabricante. Nace de una idea de RoGiz7: en vez de que Koru adivine
// qué tiene instalado cada estructura (no puede: ESI solo se lo cuenta a un Director, e in-game no
// se ve sin roles), lo declara quien lo sabe. Aquí solo movemos datos: los BONOS se derivan del SDE
// en el frontend a partir de `type_id` y `rigs`, nunca se guardan.

#[tauri::command]
pub fn facility_list(state: State<'_, AppState>) -> AppResult<Vec<FacilityRow>> {
    state.db.facility_list()
}

/// Pone un destino en el piloto automático DEL JUEGO desde Koru (planificador de rutas / caza).
/// `destination_id` = system_id (o station/structure). `clear` = reemplazar la ruta actual.
/// Es la ÚNICA acción de escritura de Koru y solo toca el waypoint del cliente. El juego calcula la
/// ruta con las preferencias del jugador (si tiene Ansiblex activado, los usa igual que Koru).
#[tauri::command]
pub async fn set_ingame_waypoint(
    character_id: i64,
    destination_id: i64,
    clear: bool,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let valid = state
        .tokens
        .access_token(state.esi.http(), character_id)
        .await
        .map_err(|_| AppError::Other("no hay sesión válida para ese personaje".into()))?;
    state
        .esi
        .set_waypoint(&valid.access_token, destination_id, clear)
        .await
}

/// Manda una RUTA COMPLETA (varias paradas en orden) al piloto automático del juego. El primer
/// punto limpia la ruta anterior; el resto se añaden al final, respetando el orden. Así se puede
/// forzar un camino concreto (cazar pasando por X, o un viaje con escalas) en vez de dejar que el
/// juego elija solo el destino final. Un solo token para toda la ráfaga.
#[tauri::command]
pub async fn set_ingame_route(
    character_id: i64,
    destination_ids: Vec<i64>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    if destination_ids.is_empty() {
        return Ok(());
    }
    let valid = state
        .tokens
        .access_token(state.esi.http(), character_id)
        .await
        .map_err(|_| AppError::Other("no hay sesión válida para ese personaje".into()))?;
    for (i, dest) in destination_ids.iter().enumerate() {
        // i == 0 → clear_other_waypoints (destino nuevo); el resto se encadenan al final.
        state
            .esi
            .set_waypoint(&valid.access_token, *dest, i == 0)
            .await?;
    }
    Ok(())
}

// ---- Red de Ansiblex de la alianza ----
//
// Aquí NO se parsea nada: el pegado lo lee el frontend (`src/ansiblex.ts`), porque el índice
// nombre→ID de sistema vive en el SDE que carga el front (`neweden.json`) y Rust no tiene nombres
// de sistema a mano. Rust solo persiste lo que el piloto ya ha revisado y confirmado en la tabla.

#[tauri::command]
pub fn ansiblex_list(state: State<'_, AppState>) -> AppResult<Vec<AnsiblexRow>> {
    state.db.ansiblex_list()
}

/// Guarda la red confirmada por el piloto, sustituyendo la anterior por completo.
/// Devuelve cuántos puentes quedaron guardados.
#[tauri::command]
pub fn ansiblex_replace(
    state: State<'_, AppState>,
    bridges: Vec<AnsiblexRow>,
) -> AppResult<usize> {
    state.db.ansiblex_replace(&bridges)
}

#[tauri::command]
pub fn ansiblex_clear(state: State<'_, AppState>) -> AppResult<()> {
    state.db.ansiblex_clear()
}

// ---- Firmas y anomalías del escáner de sondas (mismo espíritu: la app propone, el piloto declara).
// El pegado no trae el sistema → lo pasa el frontend. Rust solo persiste lo confirmado.

#[tauri::command]
pub fn signatures_list(
    state: State<'_, AppState>,
    system_id: i64,
) -> AppResult<Vec<crate::db::SignatureRow>> {
    state.db.signatures_list(system_id)
}

/// Vuelca el escaneo de un sistema (upsert por firma, conservando notas y `first_seen`).
/// Devuelve cuántas firmas quedaron en el pegado.
#[tauri::command]
pub fn signatures_replace_system(
    state: State<'_, AppState>,
    system_id: i64,
    signatures: Vec<crate::db::SignatureRow>,
) -> AppResult<usize> {
    state.db.signatures_replace_system(system_id, &signatures)
}

#[tauri::command]
pub fn signature_set_note(
    state: State<'_, AppState>,
    system_id: i64,
    sig_id: String,
    note: Option<String>,
) -> AppResult<()> {
    state.db.signature_set_note(system_id, &sig_id, note.as_deref())
}

#[tauri::command]
pub fn signatures_clear_system(state: State<'_, AppState>, system_id: i64) -> AppResult<()> {
    state.db.signatures_clear_system(system_id)
}

/// Descarta una firma viva (desapareció / caducó / la hizo otro). NO va al histórico.
#[tauri::command]
pub fn signature_delete(state: State<'_, AppState>, system_id: i64, sig_id: String) -> AppResult<()> {
    state.db.signature_delete(system_id, &sig_id)
}

#[tauri::command]
pub fn signature_set_kind(
    state: State<'_, AppState>,
    system_id: i64,
    sig_id: String,
    kind: String,
) -> AppResult<()> {
    state.db.signature_set_kind(system_id, &sig_id, &kind)
}

#[tauri::command]
pub fn signature_set_name(
    state: State<'_, AppState>,
    system_id: i64,
    sig_id: String,
    name: String,
) -> AppResult<()> {
    state.db.signature_set_name(system_id, &sig_id, &name)
}

/// Marca/desmarca que estás DENTRO del sitio (sella o borra `entered_at`).
#[tauri::command]
pub fn signature_set_entered(
    state: State<'_, AppState>,
    system_id: i64,
    sig_id: String,
    entered: bool,
) -> AppResult<()> {
    state.db.signature_set_entered(system_id, &sig_id, entered)
}

#[tauri::command]
pub fn signatures_summary(
    state: State<'_, AppState>,
) -> AppResult<Vec<crate::db::SignatureSummary>> {
    state.db.signatures_summary()
}

#[tauri::command]
pub fn signatures_wormhole_notes(
    state: State<'_, AppState>,
) -> AppResult<Vec<crate::db::SignatureRow>> {
    state.db.signatures_wormhole_notes()
}

/// Sistemas con firmas pendientes (+ recuento), para el selector rápido de la pestaña Pendientes.
#[tauri::command]
pub fn signatures_systems(
    state: State<'_, AppState>,
) -> AppResult<Vec<crate::db::SignatureSystem>> {
    state.db.signatures_systems()
}

// ---- Histórico de exploración: firmas "hechas" → exploration_log (permanente, no caduca) ----

/// Marca una firma como hecha (inserta en el histórico + la oculta de Pendientes con opción de
/// deshacer). Devuelve el id de la entrada del log. `system_name` lo aporta el frontend (SDE).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn signature_mark_done(
    state: State<'_, AppState>,
    system_id: i64,
    system_name: String,
    sig_id: String,
    loot_isk: Option<f64>,
    loot_note: Option<String>,
    note: Option<String>,
    character_id: Option<i64>,
) -> AppResult<i64> {
    state.db.signature_mark_done(
        system_id,
        &system_name,
        &sig_id,
        loot_isk,
        loot_note.as_deref(),
        note.as_deref(),
        character_id,
    )
}

/// Deshace un "hecha": borra la entrada del log y devuelve la firma a Pendientes si sigue viva.
#[tauri::command]
pub fn signature_mark_done_undo(state: State<'_, AppState>, log_id: i64) -> AppResult<()> {
    state.db.signature_mark_done_undo(log_id)
}

/// El histórico completo de exploración (reciente→antiguo). El frontend filtra y saca estadísticas.
#[tauri::command]
pub fn exploration_log_list(
    state: State<'_, AppState>,
) -> AppResult<Vec<crate::db::ExplorationLogRow>> {
    state.db.exploration_log_list()
}

/// Edita loot/notas de una entrada del histórico ya cerrada.
#[tauri::command]
pub fn exploration_log_set(
    state: State<'_, AppState>,
    id: i64,
    loot_isk: Option<f64>,
    loot_note: Option<String>,
    note: Option<String>,
) -> AppResult<()> {
    state
        .db
        .exploration_log_set(id, loot_isk, loot_note.as_deref(), note.as_deref())
}

// ---- Runs de actividad cronometradas (abisal por filamento / CRAB) → activity_runs ----

/// Arranca una run (queda abierta con cronómetro). Devuelve su id.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn run_start(
    state: State<'_, AppState>,
    activity: String,
    variant_id: Option<i64>,
    variant_name: String,
    tier: Option<String>,
    weather: Option<String>,
    system_id: Option<i64>,
    system_name: String,
    ship_type_id: Option<i64>,
    character_id: Option<i64>,
    // Coste de entrada estimado a mercado al iniciar, siempre a cuenta de quien lanza.
    // ⚠️ NO es «una unidad»: en el abismo cooperativo se gasta UN FILAMENTO POR NAVE (1 crucero /
    // 2 destructores / 3 fragatas). Corregido el 2026-08-13 tras el aviso de un tester.
    entry_cost: Option<f64>,
    // Cuántas unidades componen ese coste. Sin esto el histórico no distingue un filamento caro de
    // tres normales.
    entry_units: Option<i64>,
) -> AppResult<i64> {
    state.db.run_start(
        &activity,
        variant_id,
        &variant_name,
        tier.as_deref(),
        weather.as_deref(),
        system_id,
        &system_name,
        ship_type_id,
        character_id,
        entry_cost,
        entry_units,
    )
}

/// Termina una run (done/died/aborted) con su botín y, si muerte, el valor de la nave perdida.
#[tauri::command]
pub fn run_end(
    state: State<'_, AppState>,
    id: i64,
    outcome: String,
    loot_isk: Option<f64>,
    loot_note: Option<String>,
    ship_loss_isk: Option<f64>,
    note: Option<String>,
) -> AppResult<()> {
    state
        .db
        .run_end(id, &outcome, loot_isk, loot_note.as_deref(), ship_loss_isk, note.as_deref())
}

/// La run abierta (en curso) de un personaje PARA UNA ACTIVIDAD (abyssal/crab), para restaurar el
/// cronómetro. El filtro por actividad evita que una run CRAB abierta aparezca en abisales (y viceversa).
#[tauri::command]
pub fn run_active(
    state: State<'_, AppState>,
    activity: String,
    character_id: Option<i64>,
) -> AppResult<Option<crate::db::ActivityRun>> {
    state.db.run_active(&activity, character_id)
}

/// El histórico de runs finalizadas DE UNA ACTIVIDAD (para estadísticas de abyssals/CRAB por separado).
#[tauri::command]
pub fn run_list(state: State<'_, AppState>, activity: String) -> AppResult<Vec<crate::db::ActivityRun>> {
    state.db.run_list(&activity)
}

/// Declara QUIÉNES corrieron una run (multibox). Sustituye la lista entera: se edita de una vez,
/// no fila a fila, así no quedan estados a medias si algo falla por el camino.
///
/// Lista vacía = run de un solo piloto, que es como se ha comportado Koru siempre.
#[tauri::command]
pub fn run_chars_set(
    state: State<'_, AppState>,
    run_id: i64,
    chars: Vec<crate::db::RunCharRow>,
) -> AppResult<()> {
    state.db.run_chars_set(run_id, &chars)
}

/// Edita una run finalizada (botín / pérdida de nave / nota).
#[tauri::command]
pub fn run_set(
    state: State<'_, AppState>,
    id: i64,
    loot_isk: Option<f64>,
    loot_note: Option<String>,
    ship_loss_isk: Option<f64>,
    note: Option<String>,
    // Editable: el estimado de mercado es solo un punto de partida. Si lo compraste más barato,
    // o te lo regalaron, o lo sacaste explorando, aquí pones lo que fue de verdad.
    entry_cost: Option<f64>,
) -> AppResult<()> {
    state.db.run_set(
        id,
        loot_isk,
        loot_note.as_deref(),
        ship_loss_isk,
        note.as_deref(),
        entry_cost,
    )
}

/// Borra una run.
#[tauri::command]
pub fn run_delete(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    state.db.run_delete(id)
}

#[tauri::command]
pub fn facility_upsert(state: State<'_, AppState>, facility: FacilityRow) -> AppResult<i64> {
    state.db.facility_upsert(&facility)
}

#[tauri::command]
pub fn facility_delete(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    state.db.facility_delete(id)
}

/// Siembra el registro con las estructuras que ESI ya conoce, para no empezar con la lista vacía.
/// Solo rellena lo que ESI SÍ sabe (id, nombre, sistema, tipo) y deja lo demás en blanco: los rigs
/// y los servicios los pone el usuario en el asistente. `eligible = false` a propósito — una ficha
/// sin declarar no debe colarse en el desplegable del BOM como si supiéramos algo de ella.
/// Devuelve cuántas ha añadido (las que ya tenían ficha no se tocan: no pisamos tu trabajo).
#[tauri::command]
pub async fn facility_seed_from_esi(state: State<'_, AppState>) -> AppResult<usize> {
    let known: std::collections::HashSet<i64> =
        state.db.facility_ids_known()?.into_iter().collect();
    let found = get_structures(state.clone()).await?;
    let mut n = 0;
    for s in found {
        if known.contains(&s.id) {
            continue;
        }
        state.db.facility_upsert(&FacilityRow {
            id: 0,
            structure_id: Some(s.id),
            name: s.name.clone().unwrap_or_else(|| format!("#{}", s.id)),
            system_id: s.system_id,
            type_id: s.type_id,
            has_mfg: false,
            has_lab: false, // como has_mfg: ESI no ve los servicios, lo declara el usuario
            has_reactor: false, // ídem: ESI no ve si tiene reactor montado
            rigs: Vec::new(),
            tax: None, // ESI no sabe el impuesto: sin declarar, no un 0 que parecería un dato
            tax_by_activity: String::new(), // vacío = usa `tax` para todo (comportamiento de siempre)
            services: String::new(), // ESI tampoco ve los módulos montados: los declara el usuario
            eligible: false,
            source: "esi".into(),
            notes: None,
        })?;
        n += 1;
    }
    Ok(n)
}

/// F1b — Índices de coste de industria de UN sistema (actividad → índice). Público, sin scope.
/// El coste BRUTO de un job es `VEO × índice(actividad)`. Verificado contra el juego:
/// C-J6MT manufacturing ≈ 0,0998 → 279.893 × 0,0998 = 27.938 ISK.
#[tauri::command]
pub async fn get_industry_index(
    system_id: i64,
    state: State<'_, AppState>,
) -> AppResult<std::collections::HashMap<String, f64>> {
    let all = industry::fetch_industry_indices(&state.esi, &state.db).await?;
    Ok(all
        .into_iter()
        .find(|s| s.solar_system_id == system_id)
        .map(|s| {
            s.cost_indices
                .into_iter()
                .map(|c| (c.activity, c.cost_index))
                .collect()
        })
        .unwrap_or_default())
}

/// F1b — `adjusted_price` por typeID. **El VEO se calcula con ESTE precio, no con el medio de
/// mercado**: cuadrarlos fue lo que destapó que el "Est. Unit price" de la lista de materiales del
/// juego NO es el adjusted (Σ(base × ese precio) = 354.892 ≠ VEO 279.893). Sin red: sale de la BD.
#[tauri::command]
pub fn get_type_adjusted_prices(
    ids: Vec<i64>,
    state: State<'_, AppState>,
) -> AppResult<std::collections::HashMap<i64, f64>> {
    let prices = state.db.adjusted_prices_map().unwrap_or_default();
    Ok(ids
        .into_iter()
        .filter_map(|id| prices.get(&id).map(|p| (id, *p)))
        .collect())
}

/// R2 (memoria de precios): histórico diario de un tipo (por defecto en The Forge / Jita).
/// Trae la serie fresca de ESI (~400 días, cacheada por ETag), la PERSISTE en price_history
/// (para acumular más allá de la ventana de ESI) y devuelve lo almacenado (unión de todo lo visto).
#[tauri::command]
pub async fn get_market_history(
    type_id: i64,
    region_id: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<Vec<crate::db::PriceHistoryRow>> {
    let region = region_id.unwrap_or(10000002); // The Forge (Jita)
    let hist = crate::esi::market::region_history(&state.esi, &state.db, region, type_id).await;
    if !hist.is_empty() {
        let rows: Vec<(String, f64, f64, f64, i64, i64)> = hist
            .iter()
            .map(|h| (h.date.clone(), h.average, h.highest, h.lowest, h.volume, h.order_count))
            .collect();
        let _ = state.db.price_history_upsert(region, type_id, &rows);
    }
    state.db.price_history_get(region, type_id)
}

/// Vista de patrimonio: valor actual (último snapshot) + serie histórica.
#[derive(Debug, Serialize)]
pub struct NetworthView {
    pub liquid: f64,
    pub asset_value: f64,
    pub total: f64,
    pub series: Vec<NetworthPoint>,
    /// Nº de precios de mercado en la BD (0 = aún sin sincronizar; assets sin valorar).
    pub prices_loaded: i64,
}

fn networth_view(series: Vec<NetworthPoint>, prices_loaded: i64) -> NetworthView {
    let last = series.last();
    NetworthView {
        liquid: last.map(|p| p.liquid).unwrap_or(0.0),
        asset_value: last.map(|p| p.asset_value).unwrap_or(0.0),
        total: last.map(|p| p.total).unwrap_or(0.0),
        series,
        prices_loaded,
    }
}

/// Patrimonio de un personaje (último valor + evolución).
#[tauri::command]
pub fn get_networth(character_id: i64, state: State<'_, AppState>) -> AppResult<NetworthView> {
    let series = state.db.networth_history(character_id)?;
    let prices = state.db.prices_count().unwrap_or(0);
    Ok(networth_view(series, prices))
}

/// Patrimonio GLOBAL (suma de todos los personajes por día).
#[tauri::command]
pub fn get_networth_global(state: State<'_, AppState>) -> AppResult<NetworthView> {
    let series = state.db.networth_history_global()?;
    let prices = state.db.prices_count().unwrap_or(0);
    Ok(networth_view(series, prices))
}

/// Devuelve los scopes que corresponden a un nombre de feature.
fn scopes_for_feature(feature: &str) -> Vec<String> {
    let list: &[&str] = match feature {
        "pvp" => config::scopes::PVP,
        "wallet" => config::scopes::WALLET,
        "skills" => config::scopes::SKILLS,
        "assets" => config::scopes::ASSETS,
        "industria" => config::scopes::INDUSTRIA,
        "location" => config::scopes::LOCATION,
        // Campañas Militares fase 2 (contribución personal). Suelto para no exigir el set entero.
        "actividad" => config::scopes::ACTIVIDAD,
        "core" => {
            return config::scopes::core_v1()
                .iter()
                .map(|s| s.to_string())
                .collect()
        }
        _ => &[],
    };
    list.iter().map(|s| s.to_string()).collect()
}

/// Inicia el flujo de login para una feature (o "identity" para 0 scopes, o "core" para el set v1).
#[tauri::command]
pub async fn login(
    app: tauri::AppHandle,
    feature: String,
    state: State<'_, AppState>,
) -> AppResult<LoginOutcome> {
    let scopes = if feature == "identity" {
        Vec::new()
    } else {
        scopes_for_feature(&feature)
    };

    // El enlace de autorización se emite SIEMPRE, se abra el navegador o no: la UI ofrece copiarlo
    // mientras espera. Detectar si el navegador abrió de verdad es frágil (ver `abrir_navegador`);
    // tener siempre la salida a mano, no.
    let app2 = app.clone();
    let outcome = sso::login(scopes, move |url| {
        let _ = app2.emit("sso-login-url", url.to_string());
    })
    .await?;
    state.db.upsert_character(
        outcome.character_id,
        &outcome.character_name,
        &outcome.scopes,
    )?;
    Ok(outcome)
}

/// Cancela un login en curso (p. ej. el usuario cerró la pestaña del navegador sin completar).
/// Libera el listener loopback para que `login` deje de esperar y la UI se desbloquee.
#[tauri::command]
pub fn cancel_login() {
    sso::callback::request_cancel();
}

/// Lista los personajes guardados.
#[tauri::command]
pub fn list_characters(state: State<'_, AppState>) -> AppResult<Vec<CharacterRow>> {
    state.db.list_characters()
}

/// Tarjeta enriquecida de un personaje para la vista de rejilla.
#[derive(Debug, Serialize)]
pub struct CharacterCard {
    pub character_id: i64,
    pub name: String,
    pub corporation_id: Option<i64>,
    pub corporation_name: Option<String>,
    pub alliance_id: Option<i64>,
    pub alliance_name: Option<String>,
    pub system_id: Option<i64>,
    pub system_name: Option<String>,
    /// Nave actual (scope esi-location.read_ship_type.v1). Best-effort.
    pub ship_type_id: Option<i64>,
    pub ship_type_name: Option<String>,
    /// Nombre propio que el jugador le puso a la nave (puede ser None).
    pub ship_name: Option<String>,
    /// ¿Está conectado AHORA? (scope esi-location.read_online.v1). `None` = no se pudo saber.
    ///
    /// Importa para el intel: `/location/` devuelve la ÚLTIMA posición conocida aunque el piloto
    /// esté desconectado, así que sin esto Koru mediría distancias a un fantasma y diría «hostil a
    /// 2 saltos de tu alt» de un personaje que lleva horas fuera.
    pub online: Option<bool>,
    pub scopes: Vec<String>,
}

#[derive(serde::Deserialize)]
struct PublicChar {
    #[serde(default)]
    corporation_id: Option<i64>,
    #[serde(default)]
    alliance_id: Option<i64>,
}

#[derive(serde::Deserialize)]
struct LocationInfo {
    #[serde(default)]
    solar_system_id: Option<i64>,
}

#[derive(serde::Deserialize)]
struct OnlineInfo {
    #[serde(default)]
    online: Option<bool>,
}

#[derive(serde::Deserialize)]
struct ShipInfo {
    #[serde(default)]
    ship_type_id: Option<i64>,
    #[serde(default)]
    ship_name: Option<String>,
}

/// ESI devuelve a veces el nombre de la nave como repr de Python (quirk conocido del
/// endpoint /ship/ con caracteres no-ASCII): `u'C\xe1psula: SieteHierros'`.
/// Detectamos el envoltorio u'...'/u"..." y decodificamos los escapes \xNN / \uNNNN.
fn clean_ship_name(s: &str) -> String {
    let t = s.trim();
    let inner = t
        .strip_prefix("u'")
        .and_then(|x| x.strip_suffix('\''))
        .or_else(|| t.strip_prefix("u\"").and_then(|x| x.strip_suffix('"')));
    let Some(inner) = inner else {
        return s.to_string();
    };
    let mut out = String::with_capacity(inner.len());
    let mut it = inner.chars().peekable();
    while let Some(c) = it.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match it.next() {
            Some('x') => {
                let h: String = it.by_ref().take(2).collect();
                if let Ok(v) = u8::from_str_radix(&h, 16) {
                    out.push(v as char); // \xNN = punto de código latin-1
                }
            }
            Some('u') => {
                let h: String = it.by_ref().take(4).collect();
                if let Some(ch) = u32::from_str_radix(&h, 16).ok().and_then(char::from_u32) {
                    out.push(ch);
                }
            }
            Some('\'') => out.push('\''),
            Some('"') => out.push('"'),
            Some('\\') => out.push('\\'),
            Some(other) => {
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
}

/// Tarjetas de todos los personajes con corp/alianza y sistema actual (si hay scope).
#[tauri::command]
pub async fn get_character_cards(state: State<'_, AppState>) -> AppResult<Vec<CharacterCard>> {
    let chars = state.db.list_characters()?;
    let mut cards: Vec<CharacterCard> = Vec::new();
    let mut ids: HashSet<i64> = HashSet::new();

    for c in &chars {
        // Info pública del personaje (corp/alianza). Sin token.
        let info = state
            .esi
            .get_cached::<PublicChar>(
                &state.db,
                c.character_id,
                &format!("/characters/{}/", c.character_id),
                None,
            )
            .await
            .ok();
        let corporation_id = info.as_ref().and_then(|i| i.corporation_id);
        let alliance_id = info.as_ref().and_then(|i| i.alliance_id);

        // Sistema actual + nave actual (requieren scopes de localización). Best-effort.
        let mut system_id = None;
        let mut ship_type_id = None;
        let mut ship_name = None;
        let has_loc = c
            .scopes
            .iter()
            .any(|s| s == "esi-location.read_location.v1");
        let has_ship = c
            .scopes
            .iter()
            .any(|s| s == "esi-location.read_ship_type.v1");
        let has_online = c
            .scopes
            .iter()
            .any(|s| s == "esi-location.read_online.v1");
        let mut online = None;
        if has_loc || has_ship || has_online {
            if let Ok(valid) = state
                .tokens
                .access_token(state.esi.http(), c.character_id)
                .await
            {
                if has_loc {
                    if let Ok(loc) = state
                        .esi
                        .get_cached::<LocationInfo>(
                            &state.db,
                            c.character_id,
                            &format!("/characters/{}/location/", c.character_id),
                            Some(&valid.access_token),
                        )
                        .await
                    {
                        system_id = loc.solar_system_id;
                    }
                }
                if has_online {
                    if let Ok(o) = state
                        .esi
                        .get_cached::<OnlineInfo>(
                            &state.db,
                            c.character_id,
                            &format!("/characters/{}/online/", c.character_id),
                            Some(&valid.access_token),
                        )
                        .await
                    {
                        online = o.online;
                    }
                }
                if has_ship {
                    if let Ok(ship) = state
                        .esi
                        .get_cached::<ShipInfo>(
                            &state.db,
                            c.character_id,
                            &format!("/characters/{}/ship/", c.character_id),
                            Some(&valid.access_token),
                        )
                        .await
                    {
                        ship_type_id = ship.ship_type_id;
                        // Nombre custom: decodificamos el posible repr de Python y ocultamos
                        // el nombre por defecto del juego ("Tipo: NombrePersonaje"), que es ruido.
                        ship_name = ship
                            .ship_name
                            .as_deref()
                            .map(clean_ship_name)
                            .filter(|n| !n.is_empty())
                            .filter(|n| !n.ends_with(&format!(": {}", c.name)));
                    }
                }
            }
        }

        for x in [corporation_id, alliance_id, system_id, ship_type_id]
            .into_iter()
            .flatten()
        {
            ids.insert(x);
        }

        cards.push(CharacterCard {
            character_id: c.character_id,
            name: c.name.clone(),
            corporation_id,
            corporation_name: None,
            alliance_id,
            alliance_name: None,
            system_id,
            system_name: None,
            ship_type_id,
            ship_type_name: None,
            ship_name,
            online,
            scopes: c.scopes.clone(),
        });
    }

    if let Ok(names) = state
        .esi
        .resolve_names(&ids.into_iter().collect::<Vec<_>>())
        .await
    {
        for card in cards.iter_mut() {
            card.corporation_name = card.corporation_id.and_then(|x| names.get(&x).cloned());
            card.alliance_name = card.alliance_id.and_then(|x| names.get(&x).cloned());
            card.system_name = card.system_id.and_then(|x| names.get(&x).cloned());
            card.ship_type_name = card.ship_type_id.and_then(|x| names.get(&x).cloned());
            // Si el nombre custom es igual al del tipo, no lo repetimos.
            if card.ship_name.as_deref() == card.ship_type_name.as_deref() {
                card.ship_name = None;
            }
        }
    }

    Ok(cards)
}

/// Una posición fresca. Es el hermano LIGERO de `CharacterCard`: solo lo que se mueve.
#[derive(Debug, Clone, Serialize)]
pub struct PositionUpdate {
    pub character_id: i64,
    pub system_id: Option<i64>,
    pub system_name: Option<String>,
    pub ship_type_id: Option<i64>,
    pub ship_type_name: Option<String>,
    pub online: Option<bool>,
    /// `true` si este sondeo abrió visita nueva (se movió). El front lo usa para saber que hay
    /// novedad sin comparar estados, y evita repintar el mapa cuando no ha pasado nada.
    pub moved: bool,
    /// ★ N2: notas que han saltado por llegar aquí. Viaja con la posición en vez de por un evento
    /// de Tauri a propósito: el disparo **solo puede ocurrir en este sondeo** (es el que detecta la
    /// llegada), así que meterlo en la respuesta ahorra un canal entero y hace imposible que el
    /// aviso llegue desincronizado de la posición que lo causó.
    pub fired_notes: Vec<crate::db::NoteRow>,
}

/// Sondeo de posición: dónde están AHORA tus personajes conectados, y anotarlo en el recorrido.
///
/// POR QUÉ EXISTE: `get_character_cards` es caro (info pública, corp, alianza, resolución de
/// nombres) y solo se llamaba al arrancar, al hacer login y al hacer logout. O sea que la posición
/// de tus pilotos era **una foto del momento de abrir la app**, y de ella colgaba todo: los puntos
/// del mapa, los SALTOS del feed de intel y el contexto del aviso flotante. Un jugador que llevara
/// dos horas volando veía saltos medidos desde donde estaba al arrancar: no un error, **un número
/// creíble**, que es la peor clase de fallo.
///
/// TRES DECISIONES DE COSTE, en orden de importancia:
///  1. **Solo los conectados.** `/location/` devuelve la última posición conocida aunque el piloto
///     lleve horas fuera, así que sondear a un desconectado gasta una llamada para reafirmar un
///     fantasma. Se mira `/online/` primero (su caché es de 60 s: preguntarlo cada 30 s sale de la
///     caché sin tocar la red) y solo si está dentro se piden posición y nave.
///  2. **Nombres solo cuando alguien se mueve.** `resolve_names` es una llamada a ESI; el 99% de los
///     sondeos no cambian nada, y `track_note` ya nos dice quién abrió visita nueva. En reposo esto
///     son cero llamadas.
///  3. **La nave sale de `ships.json`**, que va embebido: nunca se pregunta a ESI por su nombre.
#[tauri::command]
pub async fn poll_positions(state: State<'_, AppState>) -> AppResult<Vec<PositionUpdate>> {
    // Cuánto silencio deja de significar «sigue ahí». Tres sondeos: aguanta un tirón de red o que
    // el portátil se duerma un momento sin partir la visita en dos.
    const CORTE_MS: i64 = 90_000;

    let chars = state.db.list_characters()?;
    let ahora = chrono::Utc::now().timestamp_millis();
    let mut out: Vec<PositionUpdate> = Vec::new();
    let mut por_nombrar: HashSet<i64> = HashSet::new();

    for c in &chars {
        let tiene = |s: &str| c.scopes.iter().any(|x| x == s);
        let has_loc = tiene("esi-location.read_location.v1");
        let has_ship = tiene("esi-location.read_ship_type.v1");
        let has_online = tiene("esi-location.read_online.v1");
        if !has_loc && !has_ship && !has_online {
            continue;
        }
        let Ok(valid) = state
            .tokens
            .access_token(state.esi.http(), c.character_id)
            .await
        else {
            continue;
        };

        let mut online = None;
        if has_online {
            if let Ok(o) = state
                .esi
                .get_cached::<OnlineInfo>(
                    &state.db,
                    c.character_id,
                    &format!("/characters/{}/online/", c.character_id),
                    Some(&valid.access_token),
                )
                .await
            {
                online = o.online;
            }
        }
        // Desconectado y lo sabemos con certeza → ni posición ni nave ni anotación en el recorrido.
        // Anotarlo dibujaría a un piloto dormido "estando" en un sistema toda la noche.
        if online == Some(false) {
            out.push(PositionUpdate {
                character_id: c.character_id,
                system_id: None,
                system_name: None,
                ship_type_id: None,
                ship_type_name: None,
                online,
                moved: false,
                fired_notes: Vec::new(),
            });
            continue;
        }

        let mut system_id = None;
        if has_loc {
            if let Ok(loc) = state
                .esi
                .get_cached::<LocationInfo>(
                    &state.db,
                    c.character_id,
                    &format!("/characters/{}/location/", c.character_id),
                    Some(&valid.access_token),
                )
                .await
            {
                system_id = loc.solar_system_id;
            }
        }
        let mut ship_type_id = None;
        if has_ship {
            if let Ok(ship) = state
                .esi
                .get_cached::<ShipInfo>(
                    &state.db,
                    c.character_id,
                    &format!("/characters/{}/ship/", c.character_id),
                    Some(&valid.access_token),
                )
                .await
            {
                ship_type_id = ship.ship_type_id;
            }
        }

        let moved = match system_id {
            Some(sid) => state
                .db
                .track_note(c.character_id, sid, ship_type_id, ahora, CORTE_MS),
            None => false,
        };
        // ★ N2 del motor humano: el disparo va AQUÍ, colgado de `moved`, porque `moved` es
        // exactamente «acaba de llegar». Engancharlo al sondeo entero repetiría el aviso cada
        // 30 segundos mientras siguieras en el sistema — el ruido que mata cualquier alarma.
        let mut fired_notes = Vec::new();
        if moved {
            if let Some(sid) = system_id {
                por_nombrar.insert(sid);
                // La llegada en RFC3339, no en ms: `fired_at` es texto y compararlo con un entero
                // daba un orden lexicográfico falso que enmudecía la nota para siempre.
                let entrada = chrono::Utc::now().to_rfc3339();
                match state
                    .db
                    .notes_fire_on_arrival(c.character_id, sid, &entrada)
                {
                    Ok(v) => {
                        if !v.is_empty() {
                            eprintln!(
                                "notas: {} aviso(s) al llegar {} a {sid}",
                                v.len(),
                                c.name
                            );
                        }
                        fired_notes = v;
                    }
                    Err(e) => eprintln!("notes_fire_on_arrival: {e}"),
                }
            }
        }
        out.push(PositionUpdate {
            character_id: c.character_id,
            system_id,
            system_name: None,
            ship_type_id,
            ship_type_name: ship_type_id.and_then(|t| ship_name_by_id().get(&t).cloned()),
            online,
            moved,
            fired_notes,
        });
    }

    // Solo se pregunta por los sistemas ESTRENADOS en este sondeo. Con todo el mundo quieto,
    // `por_nombrar` está vacío y `resolve_names` corta antes de tocar la red.
    if !por_nombrar.is_empty() {
        if let Ok(names) = state
            .esi
            .resolve_names(&por_nombrar.into_iter().collect::<Vec<_>>())
            .await
        {
            for p in out.iter_mut() {
                p.system_name = p.system_id.and_then(|x| names.get(&x).cloned());
            }
        }
    }

    Ok(out)
}

/// Una parada del recorrido: «vi a este piloto en este sistema entre estos dos instantes».
///
/// OJO, NO confundir con `TrackPoint` (más abajo), que es el rastro del CAZADOR: avistamientos de
/// un HOSTIL sacados del chat de intel. Esto es tu propia ruta, sacada de sondear ESI.
#[derive(Debug, Clone, Serialize)]
pub struct RouteStop {
    pub character_id: i64,
    pub name: String,
    pub system_id: i64,
    pub ship_type_id: Option<i64>,
    pub entered_ms: i64,
    pub seen_ms: i64,
}

/// Recorrido propio en una ventana de tiempo. `character_id = None` → todos.
///
/// Devuelve lo OBSERVADO y nada más. Quien pinta debe respetar dos cosas, o mentirá:
///  · El tiempo en un sistema es `seen_ms - entered_ms`, jamás `ahora - entered_ms`. Con Koru
///    cerrado toda la noche, lo segundo daría «10 h en Jita» de un piloto que se fue a los cinco
///    minutos.
///  · Entre el `seen_ms` de un tramo y el `entered_ms` del siguiente puede haber CEGUERA (la app
///    cerrada, o el piloto desconectado). Ese hueco no es un salto: es lo que no vimos.
#[tauri::command]
pub fn get_track(
    character_id: Option<i64>,
    desde_ms: i64,
    hasta_ms: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<RouteStop>> {
    let nombres: std::collections::HashMap<i64, String> = state
        .db
        .list_characters()?
        .into_iter()
        .map(|c| (c.character_id, c.name))
        .collect();
    Ok(state
        .db
        .track_range(character_id, desde_ms, hasta_ms)
        .into_iter()
        .map(|(cid, system_id, ship_type_id, entered_ms, seen_ms)| RouteStop {
            character_id: cid,
            name: nombres.get(&cid).cloned().unwrap_or_default(),
            system_id,
            ship_type_id,
            entered_ms,
            seen_ms,
        })
        .collect())
}

/// ---- VIAJES: lo que PASÓ, no lo que planeaste ----
///
/// Un viaje se DEDUCE de `location_track`; **no se guarda en ninguna tabla**, y es a propósito.
/// Un viaje no es un dato: es una interpretación de los datos crudos (depende de dónde pongas el
/// corte). Si lo congelamos en una tabla, el día que cambien los umbrales el histórico viejo
/// seguirá con el criterio antiguo y los dos convivirán mintiendo. Lo crudo ya se guarda; esto se
/// recalcula entero cada vez que se pide, así que mover un umbral reescribe también el pasado.
///
/// LAS REGLAS (validadas en `outputs/viajes.py`, 17 casos, antes de escribir este fichero):
///  · Rompe el viaje una PARADA larga: seguías en el mismo sistema más de `parada_min`.
///  · Rompe el viaje una CEGUERA larga: hueco entre el `seen_ms` de un tramo y el `entered_ms` del
///    siguiente mayor que `ceguera_min`. Una ceguera CORTA no rompe: se declara dentro (`blind_before_ms`).
///    Regla de la casa: el hueco es lo que NO vimos, jamás un salto.
///  · Un viaje necesita `min_saltos` saltos. Estar quieto no es viajar.
///
/// ⚠️ CONSECUENCIA QUE HAY QUE ENSEÑAR, NO ESCONDER: un viaje real partido por la mitad por una
/// ceguera puede quedar en dos trozos demasiado cortos y **desaparecer entero**. Es honesto (no
/// sabemos por dónde fuiste), pero el que mira la lista tiene que saber que puede faltar algo.
#[derive(Debug, Clone, Serialize)]
pub struct TripLeg {
    pub system_id: i64,
    pub ship_type_id: Option<i64>,
    pub entered_ms: i64,
    pub seen_ms: i64,
    /// Ceguera ARRASTRADA desde el tramo anterior (ms). 0 = continuidad observada.
    pub blind_before_ms: i64,
}

/// Algo que pasó en el viaje. `kind`: "intel" | "kill" | "loss".
#[derive(Debug, Clone, Serialize)]
pub struct TripEvent {
    pub kind: String,
    pub system_id: i64,
    pub ts_ms: i64,
    /// Para "intel": el piloto cantado. Para kills/losses: None.
    pub who: Option<String>,
    pub isk: Option<f64>,
    /// Cuánto ANTES de que entraras se cantó (ms). 0 si fue estando tú dentro.
    pub lead_ms: i64,
    /// true = ocurrió mientras estabas en el sistema.
    pub during: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Trip {
    pub character_id: i64,
    pub name: String,
    pub from_system: i64,
    pub to_system: i64,
    pub started_ms: i64,
    pub ended_ms: i64,
    /// Saltos = tramos - 1. Lo que se cuenta en EVE.
    pub jumps: i64,
    /// Ceguera total acumulada dentro del viaje (ms). Si es > 0, el recorrido tiene agujeros.
    pub blind_ms: i64,
    pub legs: Vec<TripLeg>,
    pub events: Vec<TripEvent>,
}

/// Viajes deducidos en una ventana de tiempo, del más reciente al más antiguo.
///
/// `parada_min` (20 por defecto) y `min_saltos` (3) los eligió RoGiz7: 20 min aguanta un atraque
/// para reorganizar carga sin partir el viaje, y por debajo de 3 saltos casi todo es ruido.
/// `previo_min` (15) es cuánto antes de que entraras cuenta un aviso de intel: ese es el dato que
/// duele —«lo cantaron 3 min antes de que pasaras»—, no solo lo que se cantó estando tú dentro.
#[tauri::command]
pub fn get_trips(
    character_id: Option<i64>,
    desde_ms: i64,
    hasta_ms: i64,
    parada_min: Option<i64>,
    ceguera_min: Option<i64>,
    min_saltos: Option<i64>,
    previo_min: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<Vec<Trip>> {
    const MIN_MS: i64 = 60_000;
    let parada = parada_min.unwrap_or(20) * MIN_MS;
    let ceguera = ceguera_min.unwrap_or(20) * MIN_MS;
    let min_j = min_saltos.unwrap_or(3);
    let previo = previo_min.unwrap_or(15) * MIN_MS;

    let nombres: std::collections::HashMap<i64, String> = state
        .db
        .list_characters()?
        .into_iter()
        .map(|c| (c.character_id, c.name))
        .collect();

    // El track viene ordenado por `entered_ms`, pero MEZCLA personajes cuando se piden todos: hay
    // que trocear POR PILOTO o se inventarían viajes saltando de un alt a otro.
    let mut por_piloto: std::collections::HashMap<i64, Vec<(i64, Option<i64>, i64, i64)>> =
        std::collections::HashMap::new();
    for (cid, sid, ship, ent, seen) in state.db.track_range(character_id, desde_ms, hasta_ms) {
        por_piloto.entry(cid).or_default().push((sid, ship, ent, seen));
    }

    // El intel y los killmails se piden UNA vez para toda la ventana y se cruzan en memoria: pedir
    // por tramo serían cientos de consultas para el mismo dato.
    let sightings = state.db.sightings_range(desde_ms - previo, hasta_ms);
    let dia = |ms: i64| -> String {
        chrono::DateTime::from_timestamp_millis(ms)
            .map(|d| d.format("%Y-%m-%d").to_string())
            .unwrap_or_default()
    };
    // Un día de margen a cada lado: el recorte fino se hace abajo, ya parseado a ms.
    let kms: Vec<(i64, i64, f64, bool)> = state
        .db
        .killmails_range_days(character_id, &dia(desde_ms - 86_400_000), &dia(hasta_ms + 86_400_000))
        .into_iter()
        .filter_map(|(sid, killed_at, isk, is_loss)| {
            chrono::DateTime::parse_from_rfc3339(&killed_at)
                .ok()
                .map(|d| (sid, d.timestamp_millis(), isk, is_loss))
        })
        .collect();

    let mut viajes: Vec<Trip> = Vec::new();
    for (cid, tramos) in por_piloto {
        let mut actual: Vec<TripLeg> = Vec::new();
        // `cerrar` empuja el viaje si cumple el mínimo. Se llama en cada corte y al final.
        let cerrar = |actual: &mut Vec<TripLeg>, viajes: &mut Vec<Trip>| {
            if actual.len() as i64 - 1 < min_j {
                actual.clear();
                return;
            }
            let legs = std::mem::take(actual);
            let blind_ms = legs.iter().map(|l| l.blind_before_ms).sum();
            let mut events: Vec<TripEvent> = Vec::new();
            for l in &legs {
                let ini = l.entered_ms - previo;
                for (who, sid, ts) in &sightings {
                    if *sid == l.system_id && *ts >= ini && *ts <= l.seen_ms {
                        let lead = l.entered_ms - *ts;
                        events.push(TripEvent {
                            kind: "intel".into(),
                            system_id: *sid,
                            ts_ms: *ts,
                            who: Some(who.clone()),
                            isk: None,
                            lead_ms: lead.max(0),
                            during: lead <= 0,
                        });
                    }
                }
                for (sid, ts, isk, is_loss) in &kms {
                    if *sid == l.system_id && *ts >= l.entered_ms && *ts <= l.seen_ms {
                        events.push(TripEvent {
                            kind: if *is_loss { "loss".into() } else { "kill".into() },
                            system_id: *sid,
                            ts_ms: *ts,
                            who: None,
                            isk: Some(*isk),
                            lead_ms: 0,
                            during: true,
                        });
                    }
                }
            }
            events.sort_by_key(|e| e.ts_ms);
            viajes.push(Trip {
                character_id: cid,
                name: nombres.get(&cid).cloned().unwrap_or_default(),
                from_system: legs[0].system_id,
                to_system: legs[legs.len() - 1].system_id,
                started_ms: legs[0].entered_ms,
                ended_ms: legs[legs.len() - 1].seen_ms,
                jumps: legs.len() as i64 - 1,
                blind_ms,
                legs,
                events,
            });
        };

        for (sid, ship, ent, seen) in tramos {
            if let Some(prev) = actual.last() {
                let parado = prev.seen_ms - prev.entered_ms;
                let ciego = ent - prev.seen_ms;
                if parado > parada || ciego > ceguera {
                    cerrar(&mut actual, &mut viajes);
                    actual.push(TripLeg {
                        system_id: sid,
                        ship_type_id: ship,
                        entered_ms: ent,
                        seen_ms: seen,
                        blind_before_ms: 0,
                    });
                    continue;
                }
                actual.push(TripLeg {
                    system_id: sid,
                    ship_type_id: ship,
                    entered_ms: ent,
                    seen_ms: seen,
                    blind_before_ms: ciego.max(0),
                });
            } else {
                actual.push(TripLeg {
                    system_id: sid,
                    ship_type_id: ship,
                    entered_ms: ent,
                    seen_ms: seen,
                    blind_before_ms: 0,
                });
            }
        }
        cerrar(&mut actual, &mut viajes);
    }
    // El más reciente arriba: es el que quieres mirar.
    viajes.sort_by(|a, b| b.started_ms.cmp(&a.started_ms));
    Ok(viajes)
}

/// Cierra sesión de un personaje: borra su refresh token del keyring y su fila de la BD.
#[tauri::command]
pub fn logout(character_id: i64, state: State<'_, AppState>) -> AppResult<()> {
    sso::store::delete_refresh_token(character_id)?;
    state.db.delete_character(character_id)?;
    Ok(())
}

/// Prueba de extremo a extremo: refresca el token de un personaje y devuelve su nombre.
#[tauri::command]
pub async fn whoami(character_id: i64, state: State<'_, AppState>) -> AppResult<String> {
    let valid = state
        .tokens
        .access_token(state.esi.http(), character_id)
        .await?;
    Ok(valid.claims.name)
}

/// Sincroniza los killmails recientes del personaje desde ESI/zKillboard.
/// Requiere el scope esi-killmails.read_killmails.v1. Devuelve cuántos nuevos se guardaron.
#[tauri::command]
pub async fn sync_killmails(character_id: i64, state: State<'_, AppState>) -> AppResult<usize> {
    let valid = state
        .tokens
        .access_token(state.esi.http(), character_id)
        .await?;

    // Comprobamos que el token tenga el scope necesario antes de llamar.
    if !valid
        .claims
        .scp
        .iter()
        .any(|s| s == "esi-killmails.read_killmails.v1")
    {
        return Err(AppError::OAuth(
            "este personaje no concedió el scope de killmails. Inicia sesión con la feature 'PvP'."
                .into(),
        ));
    }

    // Sync MANUAL = el usuario quiere el dato AHORA: borramos las entradas de caché de la
    // lista (todas las páginas) para forzar GETs frescos (sin If-None-Match). Descarta que
    // un ETag/Expires "pegado" deje la lista congelada aunque zKill ya muestre kills nuevas.
    let _ = state
        .db
        .delete_cache(character_id, &format!("/characters/{character_id}/killmails/recent/"));
    for page in 1..=20 {
        let _ = state.db.delete_cache(
            character_id,
            &format!("/characters/{character_id}/killmails/recent/?page={page}"),
        );
    }

    killmails::sync(&state.esi, &state.db, character_id, &valid.access_token).await
}

/// Sincroniza el HISTORIAL COMPLETO desde zKillboard (no requiere scope). Emite eventos
/// `km_progress` con el número de killmails procesados para mostrar progreso en la UI.
#[tauri::command]
pub async fn sync_killmails_full(
    character_id: i64,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<usize> {
    state
        .cancel
        .store(false, std::sync::atomic::Ordering::Relaxed);
    let win = window.clone();
    killmails::sync_full(
        &state.esi,
        &state.db,
        character_id,
        100,
        &state.cancel,
        move |n, page| {
            let _ = win.emit("km_progress", (n, page));
        },
    )
    .await
}

/// Assets agregados por sistema, para el overlay "Tus assets" del mapa.
#[derive(Debug, Serialize)]
pub struct AssetSystem {
    pub system_id: i64,
    pub count: i64,
}

#[tauri::command]
pub async fn get_assets_map(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<AssetSystem>> {
    let token = token_with_scope(
        &state,
        character_id,
        "esi-assets.read_assets.v1",
        "Assets / industria",
    )
    .await?;
    let m = assets::by_system(&state.esi, &state.db, character_id, &token).await?;
    Ok(m.into_iter()
        .map(|(system_id, count)| AssetSystem { system_id, count })
        .collect())
}

#[tauri::command]
pub async fn get_assets_map_global(state: State<'_, AppState>) -> AppResult<Vec<AssetSystem>> {
    use std::collections::HashMap;
    let mut acc: HashMap<i64, i64> = HashMap::new();
    for c in state.db.list_characters()? {
        if !c.scopes.iter().any(|s| s == "esi-assets.read_assets.v1") {
            continue;
        }
        let valid = match state
            .tokens
            .access_token(state.esi.http(), c.character_id)
            .await
        {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Ok(m) =
            assets::by_system(&state.esi, &state.db, c.character_id, &valid.access_token).await
        {
            for (sid, n) in m {
                *acc.entry(sid).or_insert(0) += n;
            }
        }
    }
    Ok(acc
        .into_iter()
        .map(|(system_id, count)| AssetSystem { system_id, count })
        .collect())
}

/// Sincroniza el mining ledger del personaje a la BD local (acumula histórico).
#[tauri::command]
pub async fn sync_mining(character_id: i64, state: State<'_, AppState>) -> AppResult<usize> {
    let token = token_with_scope(
        &state,
        character_id,
        "esi-industry.read_character_mining.v1",
        "Assets / industria",
    )
    .await?;
    industry::sync_mining(&state.esi, &state.db, character_id, &token).await
}

/// Minería por sistema (desde la BD acumulada), para el overlay "Tu minería".
#[tauri::command]
pub fn get_mining_map(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<AssetSystem>> {
    Ok(state
        .db
        .mining_by_system(Some(character_id))?
        .into_iter()
        .map(|(system_id, count)| AssetSystem { system_id, count })
        .collect())
}

#[tauri::command]
pub fn get_mining_map_global(state: State<'_, AppState>) -> AppResult<Vec<AssetSystem>> {
    Ok(state
        .db
        .mining_by_system(None)?
        .into_iter()
        .map(|(system_id, count)| AssetSystem { system_id, count })
        .collect())
}

/// Kills por sistema en la última hora (overlay "en vivo"). ESI público, 1 llamada.
#[derive(Debug, Serialize, serde::Deserialize)]
pub struct SystemKills {
    pub system_id: i64,
    #[serde(default)]
    pub ship_kills: i64,
    #[serde(default)]
    pub pod_kills: i64,
    #[serde(default)]
    pub npc_kills: i64,
}

#[tauri::command]
pub async fn get_system_kills(state: State<'_, AppState>) -> AppResult<Vec<SystemKills>> {
    state
        .esi
        .get_cached::<Vec<SystemKills>>(&state.db, 0, "/universe/system_kills/", None)
        .await
}

/// Jumps por sistema en la última hora (overlay "en vivo"). ESI público, 1 llamada.
#[derive(Debug, Serialize, serde::Deserialize)]
pub struct SystemJumps {
    pub system_id: i64,
    #[serde(default)]
    pub ship_jumps: i64,
}

#[tauri::command]
pub async fn get_system_jumps(state: State<'_, AppState>) -> AppResult<Vec<SystemJumps>> {
    state
        .esi
        .get_cached::<Vec<SystemJumps>>(&state.db, 0, "/universe/system_jumps/", None)
        .await
}

/// --- Soberanía (ocupación por sistema) ---
#[derive(serde::Deserialize)]
struct SovResp {
    #[serde(default)]
    solar_systems: Vec<SovSys>,
}
#[derive(serde::Deserialize)]
struct SovSys {
    solar_system_id: i64,
    #[serde(default)]
    claim: Option<SovClaim>,
}
#[derive(serde::Deserialize)]
struct SovClaim {
    #[serde(default)]
    alliance: Option<AllianceObj>,
    #[serde(default)]
    corporation: Option<CorpObj>,
    #[serde(default)]
    faction: Option<FacObj>,
}
#[derive(serde::Deserialize)]
struct AllianceObj {
    #[serde(default)]
    alliance_id: i64,
}
#[derive(serde::Deserialize)]
struct CorpObj {
    #[serde(default)]
    corporation_id: i64,
}
#[derive(serde::Deserialize)]
struct FacObj {
    #[serde(default)]
    faction_id: i64,
}
#[derive(serde::Deserialize)]
struct Faction {
    faction_id: i64,
    name: String,
}

#[derive(Debug, Serialize)]
pub struct SovSystem {
    pub system_id: i64,
    pub owner_id: Option<i64>,
    pub kind: String, // "alliance" | "corporation" | "faction" | "none"
    pub owner_name: Option<String>,
}

/// Soberanía por sistema (ocupación). Ruta pública `/sovereignty/systems`.
#[tauri::command]
pub async fn get_sov_systems(state: State<'_, AppState>) -> AppResult<Vec<SovSystem>> {
    let resp: SovResp = state
        .esi
        .get_cached(&state.db, 0, "/sovereignty/systems", None)
        .await?;

    let mut out: Vec<SovSystem> = Vec::new();
    let mut name_ids: HashSet<i64> = HashSet::new(); // alianzas + corps
    let mut faction_ids: HashSet<i64> = HashSet::new();

    for s in resp.solar_systems {
        let (owner_id, kind) = match &s.claim {
            Some(c) => {
                if let Some(a) = &c.alliance {
                    if a.alliance_id != 0 {
                        name_ids.insert(a.alliance_id);
                        (Some(a.alliance_id), "alliance")
                    } else {
                        (None, "none")
                    }
                } else if let Some(co) = &c.corporation {
                    if co.corporation_id != 0 {
                        name_ids.insert(co.corporation_id);
                        (Some(co.corporation_id), "corporation")
                    } else {
                        (None, "none")
                    }
                } else if let Some(f) = &c.faction {
                    if f.faction_id != 0 {
                        faction_ids.insert(f.faction_id);
                        (Some(f.faction_id), "faction")
                    } else {
                        (None, "none")
                    }
                } else {
                    (None, "none")
                }
            }
            None => (None, "none"),
        };
        out.push(SovSystem {
            system_id: s.solar_system_id,
            owner_id,
            kind: kind.to_string(),
            owner_name: None,
        });
    }

    // Nombres: alianzas/corps por /universe/names; facciones por /universe/factions.
    let names = state
        .esi
        .resolve_names(&name_ids.into_iter().collect::<Vec<_>>())
        .await
        .unwrap_or_default();
    let mut fac_names: std::collections::HashMap<i64, String> = std::collections::HashMap::new();
    if !faction_ids.is_empty() {
        if let Ok(facs) = state
            .esi
            .get_cached::<Vec<Faction>>(&state.db, 0, "/universe/factions", None)
            .await
        {
            for f in facs {
                fac_names.insert(f.faction_id, f.name);
            }
        }
    }
    for s in out.iter_mut() {
        if let Some(id) = s.owner_id {
            s.owner_name = if s.kind == "faction" {
                fac_names.get(&id).cloned()
            } else {
                names.get(&id).cloned()
            };
        }
    }
    Ok(out)
}

/// Un sistema de Guerra de Facciones. Campos tal cual los devuelve ESI (snake_case),
/// que el frontend lee directamente. `owner_faction_id` es uno de los 4 imperios.
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct FwSystem {
    pub solar_system_id: i64,
    #[serde(default)]
    pub owner_faction_id: i64,
    #[serde(default)]
    pub occupier_faction_id: i64,
    #[serde(default)]
    pub contested: Option<String>,
    #[serde(default)]
    pub victory_points: i64,
    #[serde(default)]
    pub victory_points_threshold: i64,
}

/// Sistemas de Guerra de Facciones. Ruta PÚBLICA `/fw/systems/` (sin token ni scopes).
/// El frontend mapea `owner_faction_id` a color/nombre y usa `contested` para la intensidad.
#[tauri::command]
pub async fn get_fw_systems(state: State<'_, AppState>) -> AppResult<Vec<FwSystem>> {
    let systems: Vec<FwSystem> = state
        .esi
        .get_cached(&state.db, 0, "/fw/systems/", None)
        .await?;
    Ok(systems)
}

/// Una incursión activa (de Sansha). Campos tal cual los devuelve ESI; el frontend usa
/// `infested_solar_systems` (sistemas a resaltar), `staging_solar_system_id` y `state`/`influence`.
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct Incursion {
    #[serde(default)]
    pub constellation_id: i64,
    #[serde(default)]
    pub faction_id: i64,
    #[serde(default)]
    pub has_boss: bool,
    #[serde(default)]
    pub infested_solar_systems: Vec<i64>,
    #[serde(default)]
    pub influence: f64,
    #[serde(default)]
    pub staging_solar_system_id: i64,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(rename = "type", default)]
    pub kind: Option<String>,
}

/// Incursiones activas. Ruta PÚBLICA `/incursions` (sin token ni scopes).
#[tauri::command]
pub async fn get_incursions(state: State<'_, AppState>) -> AppResult<Vec<Incursion>> {
    let inc: Vec<Incursion> = state
        .esi
        .get_cached(&state.db, 0, "/incursions", None)
        .await?;
    Ok(inc)
}

/// Estado del servidor Tranquility (público `/status/`): nº de jugadores online, versión, VIP.
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct ServerStatus {
    #[serde(default)]
    pub players: i64,
    #[serde(default)]
    pub server_version: String,
    #[serde(default)]
    pub start_time: Option<String>,
    #[serde(default)]
    pub vip: bool,
}

/// Estado de TQ. Si el servidor está caído, `/status/` falla → el frontend lo trata como offline.
#[tauri::command]
pub async fn get_server_status(state: State<'_, AppState>) -> AppResult<ServerStatus> {
    let s: ServerStatus = state.esi.get_cached(&state.db, 0, "/status/", None).await?;
    Ok(s)
}

/// Mapa PvP de un personaje: actividad por sistema (k-space). Las coordenadas/seguridad/nombre
/// los resuelve el frontend desde el SDE local (neweden.json) — sin llamadas a ESI.
#[tauri::command]
pub async fn get_pvp_map(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<SystemActivity>> {
    let activity = state.db.systems_activity(character_id)?;
    Ok(activity
        .into_iter()
        .filter(|a| (30_000_000..=30_999_999).contains(&a.system_id))
        .collect())
}

/// Mapa PvP global (todos los personajes).
#[tauri::command]
pub async fn get_pvp_map_global(state: State<'_, AppState>) -> AppResult<Vec<SystemActivity>> {
    let activity = state.db.systems_activity_global()?;
    Ok(activity
        .into_iter()
        .filter(|a| (30_000_000..=30_999_999).contains(&a.system_id))
        .collect())
}

/// Reprocesa los killmails ya guardados para rellenar daño/final blow/top damage/nave víctima
/// desde el detalle cacheado (sin red). Emite `reprocess_progress`.
#[tauri::command]
pub async fn reprocess_killmails(window: Window, state: State<'_, AppState>) -> AppResult<usize> {
    let win = window.clone();
    killmails::reprocess(&state.db, move |d| {
        let _ = win.emit("reprocess_progress", d);
    })
}

/// Detalle de rateo (bounties + ESS) de un personaje (PvE): sistema, ratas, buckets.
#[tauri::command]
pub async fn get_ratting(character_id: i64, state: State<'_, AppState>) -> AppResult<RattingDetail> {
    state.db.ratting_detail(Some(character_id))
}

/// Detalle de rateo global (todos los personajes).
#[tauri::command]
pub async fn get_ratting_global(state: State<'_, AppState>) -> AppResult<RattingDetail> {
    state.db.ratting_detail(None)
}

// ---- Ratas especiales (oficiales / capitales NPC / bonus de faction) ----
#[derive(Debug, serde::Deserialize)]
struct NpcTypeInfo {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    group_id: i64,
}
#[derive(Debug, serde::Deserialize)]
struct NpcGroupInfo {
    #[serde(default)]
    name: Option<String>,
}

/// Prefijos de nombre de las variantes elite de faction pirata (las "bonus" del rateo).
const FACTION_PREFIXES: &[&str] = &["Domination", "Dread Guristas", "True Sansha", "Dark Blood", "Shadow"];

/// Desglose "typeID: n,typeID: n…" → [(type_id, count)].
fn parse_rat_breakdown(reason: &str) -> Vec<(i64, i64)> {
    reason
        .split(',')
        .filter_map(|p| {
            let mut it = p.split(':');
            let tid = it.next()?.trim().parse::<i64>().ok()?;
            let cnt = it.next()?.trim().parse::<i64>().ok()?;
            Some((tid, cnt))
        })
        .collect()
}

/// Clasifica un NPC por su tipo (tipo→grupo, vía ESI cacheado): 'officer' | 'capital' | 'faction' |
/// 'normal'. Cachea SOLO si se resolvió (un fallo de red no se persiste como 'normal').
async fn classify_npc(esi: &EsiClient, db: &Db, type_id: i64) -> (Option<String>, String) {
    if let Some(c) = db.npc_class_get(type_id) {
        return c;
    }
    let resolved: Option<(Option<String>, String)> = async {
        let t: NpcTypeInfo = esi
            .get_cached(db, 0, &format!("/universe/types/{type_id}/"), None)
            .await
            .ok()?;
        let g: NpcGroupInfo = esi
            .get_cached(db, 0, &format!("/universe/groups/{}/", t.group_id), None)
            .await
            .ok()?;
        let gl = g.name.unwrap_or_default().to_lowercase();
        let name = t.name.clone().unwrap_or_default();
        let klass = if gl.contains("officer") {
            "officer"
        } else if gl.contains("titan") || gl.contains("dreadnought") || gl.contains("supercarrier") {
            "capital"
        } else if FACTION_PREFIXES.iter().any(|p| name.starts_with(p)) {
            "faction"
        } else {
            "normal"
        };
        Some((t.name, klass.to_string()))
    }
    .await;
    match resolved {
        Some((name, klass)) => {
            db.npc_class_put(type_id, name.as_deref(), &klass);
            (name, klass)
        }
        None => (None, "normal".to_string()), // sin cachear → se reintenta otra vez
    }
}

#[derive(Debug, Serialize)]
pub struct SpecialRat {
    pub type_id: i64,
    pub name: Option<String>,
    pub class: String, // 'officer' | 'capital' | 'faction'
    pub count: i64,
}
#[derive(Debug, Serialize)]
pub struct SpecialRatSystem {
    pub system_id: i64,
    pub total: i64,
    pub by_type: Vec<SpecialRat>,
}
/// Ratas especiales caídas un día concreto, separadas por clase. Solo existe donde ESI trajo `reason`.
#[derive(Debug, Serialize)]
pub struct SpecialRatDay {
    pub date: String,
    pub officers: i64,
    pub capitals: i64,
    pub faction: i64,
}
#[derive(Debug, Serialize)]
pub struct SpecialRatsResult {
    pub total: i64,
    pub officers: i64,
    pub capitals: i64,
    pub faction: i64,
    pub by_type: Vec<SpecialRat>,
    pub by_system: Vec<SpecialRatSystem>,
    pub daily: Vec<SpecialRatDay>,
}

/// Cuenta las "ratas especiales" (oficiales/capitales/faction bonus) a partir del desglose por tipo
/// guardado en los bounty_prizes del journal. Clasifica cada tipo vía ESI (cacheado por tipo).
/// Devuelve total global + desglose por tipo + desglose POR SISTEMA (con qué especiales caen dónde).
#[tauri::command]
pub async fn get_special_rats(
    character_id: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<SpecialRatsResult> {
    use std::collections::HashMap;
    let reasons = state.db.rat_bounty_reasons(character_id)?;
    let mut counts: HashMap<i64, i64> = HashMap::new(); // typeID -> count (global)
    let mut sys_counts: HashMap<i64, HashMap<i64, i64>> = HashMap::new(); // system -> typeID -> count
    let mut day_counts: HashMap<String, HashMap<i64, i64>> = HashMap::new(); // día -> typeID -> count
    for (date, sys, reason) in &reasons {
        for (tid, cnt) in parse_rat_breakdown(reason) {
            *counts.entry(tid).or_insert(0) += cnt;
            *day_counts.entry(date.clone()).or_default().entry(tid).or_insert(0) += cnt;
            if let Some(s) = sys {
                *sys_counts.entry(*s).or_default().entry(tid).or_insert(0) += cnt;
            }
        }
    }
    // Clasifica cada typeID distinto una sola vez (cacheado por tipo).
    let mut cls: HashMap<i64, (Option<String>, String)> = HashMap::new();
    for tid in counts.keys() {
        let c = classify_npc(&state.esi, &state.db, *tid).await;
        cls.insert(*tid, c);
    }
    let is_special = |k: &str| matches!(k, "officer" | "capital" | "faction");

    let mut by_type: Vec<SpecialRat> = Vec::new();
    let (mut officers, mut capitals, mut faction) = (0i64, 0i64, 0i64);
    for (tid, cnt) in &counts {
        let (name, klass) = cls.get(tid).cloned().unwrap_or((None, "normal".into()));
        match klass.as_str() {
            "officer" => officers += cnt,
            "capital" => capitals += cnt,
            "faction" => faction += cnt,
            _ => continue,
        }
        by_type.push(SpecialRat { type_id: *tid, name, class: klass, count: *cnt });
    }
    by_type.sort_by(|a, b| b.count.cmp(&a.count));

    let mut by_system: Vec<SpecialRatSystem> = Vec::new();
    for (sys, tmap) in sys_counts {
        let mut types: Vec<SpecialRat> = tmap
            .iter()
            .filter_map(|(tid, cnt)| {
                let (name, klass) = cls.get(tid)?;
                if is_special(klass) {
                    Some(SpecialRat {
                        type_id: *tid,
                        name: name.clone(),
                        class: klass.clone(),
                        count: *cnt,
                    })
                } else {
                    None
                }
            })
            .collect();
        if types.is_empty() {
            continue;
        }
        types.sort_by(|a, b| b.count.cmp(&a.count));
        let total = types.iter().map(|t| t.count).sum();
        by_system.push(SpecialRatSystem { system_id: sys, total, by_type: types });
    }
    by_system.sort_by(|a, b| b.total.cmp(&a.total));

    // Serie diaria por clase. Los días sin ninguna especial NO se emiten: el frontend los pinta a cero
    // dentro de la ventana donde el `reason` existe, que es la única donde el cero significa "ninguna".
    let mut daily: Vec<SpecialRatDay> = day_counts
        .into_iter()
        .map(|(date, tmap)| {
            let (mut o, mut c, mut f) = (0i64, 0i64, 0i64);
            for (tid, cnt) in tmap {
                match cls.get(&tid).map(|(_, k)| k.as_str()) {
                    Some("officer") => o += cnt,
                    Some("capital") => c += cnt,
                    Some("faction") => f += cnt,
                    _ => {}
                }
            }
            SpecialRatDay { date, officers: o, capitals: c, faction: f }
        })
        .filter(|d| d.officers + d.capitals + d.faction > 0)
        .collect();
    daily.sort_by(|a, b| a.date.cmp(&b.date));

    Ok(SpecialRatsResult {
        total: officers + capitals + faction,
        officers,
        capitals,
        faction,
        by_type,
        by_system,
        daily,
    })
}

/// Daño, disparos y fallos por arma/dron y día, del gamelog.
///
/// OJO con lo que esto NO es: el gamelog registra DAÑO, no muertes. La línea de `(bounty)` ni siquiera
/// nombra a la rata, y en el mismo segundo hay golpes a varios objetivos. Así que aquí nunca se dirá
/// "con qué arma mataste": se dice cuánto pegaste con cada una, y cuántas veces fallaste.
#[derive(serde::Serialize)]
pub struct WeaponDay {
    pub date: String,
    pub weapon: String,
    pub dmg: i64,
    pub shots: i64,
    pub misses: i64,
}
#[tauri::command]
pub async fn get_gamelog_weapons(
    subject_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<WeaponDay>> {
    Ok(state
        .db
        .gamelog_weapon_rows(subject_id)?
        .into_iter()
        .map(|(date, weapon, dmg, shots, misses)| WeaponDay { date, weapon, dmg, shots, misses })
        .collect())
}

/// PvP del gamelog (#45): cara a cara contra entidades de JUGADOR — naves, drones y estructuras —
/// incluyendo las peleas sin killmail que zKill no tiene. La misma honestidad que las armas: esto
/// es DAÑO y fallos, no muertes; y tu propia nave el gamelog no la dice.
#[derive(serde::Serialize)]
pub struct GamelogPvpRow {
    pub done: bool,   // true = tú a ellos · false = ellos a ti
    pub kind: i64,    // 1 nave · 2 dron/fighter · 3 estructura
    pub pilot: String,
    pub ticker: String,
    pub ship: String, // '' si al piloto solo se le vio fallar
    pub dmg: i64,
    pub shots: i64,
    pub wrecks: i64,
    pub misses: i64,
    pub first: String,
    pub last: String,
}
#[tauri::command]
pub async fn get_gamelog_pvp(
    subject_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<GamelogPvpRow>> {
    Ok(state
        .db
        .gamelog_pvp_rows(subject_id)?
        .into_iter()
        .map(|(done, kind, pilot, ticker, ship, dmg, shots, wrecks, misses, first, last)| {
            GamelogPvpRow { done, kind, pilot, ticker, ship, dmg, shots, wrecks, misses, first, last }
        })
        .collect())
}

/// Punto diario de la serie PvP del gamelog (solo naves/drones) para la gráfica unificada:
/// daño por día, dirección y piloto. El frontend agrupa por semana y rankea rivales en el rango.
#[derive(serde::Serialize)]
pub struct GamelogPvpDay {
    pub date: String,
    pub done: bool,
    pub pilot: String,
    /// Tipo de nave/dron: el frontend descarta deployables (CRAB, POS…) con la misma regla
    /// por tipo que usa la tabla cara a cara.
    pub ship: String,
    pub dmg: i64,
}
#[tauri::command]
pub async fn get_gamelog_pvp_series(
    subject_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<GamelogPvpDay>> {
    Ok(state
        .db
        .gamelog_pvp_series_rows(subject_id)?
        .into_iter()
        .map(|(date, done, pilot, ship, dmg)| GamelogPvpDay { date, done, pilot, ship, dmg })
        .collect())
}

/// DPS por día, del gamelog: daño hecho, segundos ACTIVOS (segundos distintos con daño — tiempo
/// de combate real, muy por debajo del de sesión) y mejor segundo del día. El DPS medio de un
/// período = SUM(dmg)/SUM(secs), calculado en el frontend.
#[derive(serde::Serialize)]
pub struct DpsDay {
    pub date: String,
    pub dmg: i64,
    pub secs: i64,
    pub peak: i64,
}
#[tauri::command]
pub async fn get_gamelog_dps(
    subject_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<DpsDay>> {
    Ok(state
        .db
        .gamelog_dps_rows(subject_id)?
        .into_iter()
        .map(|(date, dmg, secs, peak)| DpsDay { date, dmg, secs, peak })
        .collect())
}

/// Reparto de la CALIDAD del golpe (1..6, de Roza/Grazes a Destruye/Wrecks) por día y dirección.
/// La escala unificó ES y EN por daño medio relativo al arma, no por traducción. Del gamelog.
#[derive(serde::Serialize)]
pub struct QualityDay {
    pub date: String,
    pub quality: i64, // 1 Roza · 2 Alcanza · 3 Impacta · 4 Perfora · 5 Destroza · 6 Destruye
    pub done: i64,
    pub taken: i64,
}
#[tauri::command]
pub async fn get_gamelog_quality(
    subject_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<QualityDay>> {
    Ok(state
        .db
        .gamelog_quality_rows(subject_id)?
        .into_iter()
        .map(|(date, quality, done, taken)| QualityDay { date, quality, done, taken })
        .collect())
}

/// Salvage por día: restos recuperados e intentos fallidos. Del gamelog (`(notify)`), LOG-ONLY.
#[derive(serde::Serialize)]
pub struct SalvageDay {
    pub date: String,
    pub salvaged: i64,
    pub failed: i64,
}
#[tauri::command]
pub async fn get_gamelog_salvage(
    subject_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<SalvageDay>> {
    Ok(state
        .db
        .gamelog_salvage_rows(subject_id)?
        .into_iter()
        .map(|(date, salvaged, failed)| SalvageDay { date, salvaged, failed })
        .collect())
}

/// Pulsos de módulos de mando por módulo y día: nº de pulsos y suma de miembros bonificados.
#[derive(serde::Serialize)]
pub struct BoostDay {
    pub date: String,
    pub module: String,
    pub pulses: i64,
    pub members: i64,
}
#[tauri::command]
pub async fn get_gamelog_boosts(
    subject_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<BoostDay>> {
    Ok(state
        .db
        .gamelog_boost_rows(subject_id)?
        .into_iter()
        .map(|(date, module, pulses, members)| BoostDay { date, module, pulses, members })
        .collect())
}

/// Devuelve "YYYY-MM" del mes anterior a un "YYYY-MM" dado.
fn prev_month(ym: &str) -> String {
    let y: i32 = ym.get(0..4).and_then(|s| s.parse().ok()).unwrap_or(2026);
    let m: u32 = ym.get(5..7).and_then(|s| s.parse().ok()).unwrap_or(1);
    if m <= 1 {
        format!("{:04}-12", y - 1)
    } else {
        format!("{:04}-{:02}", y, m - 1)
    }
}

/// Periodos (YYYY-MM) con movimientos, de un personaje.
#[tauri::command]
pub async fn get_summary_periods(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<String>> {
    state.db.summary_periods(Some(character_id))
}

/// Periodos (YYYY-MM) con movimientos, global.
#[tauri::command]
pub async fn get_summary_periods_global(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    state.db.summary_periods(None)
}

/// Resumen financiero (ingresos/gastos por categoría + vs anterior) de un personaje.
#[tauri::command]
pub async fn get_summary(
    character_id: i64,
    period: String,
    state: State<'_, AppState>,
) -> AppResult<FinancialSummary> {
    let prev = prev_month(&period);
    state
        .db
        .financial_summary(Some(character_id), &period, &prev)
}

/// Resumen financiero global (todos los personajes).
#[tauri::command]
pub async fn get_summary_global(
    period: String,
    state: State<'_, AppState>,
) -> AppResult<FinancialSummary> {
    let prev = prev_month(&period);
    state.db.financial_summary(None, &period, &prev)
}

/// Entrada de journal con TODOS los campos relevantes (para inspeccionar qué expone ESI).
#[derive(Debug, Clone, serde::Deserialize)]
struct JournalFull {
    #[serde(default)]
    ref_type: Option<String>,
    #[serde(default)]
    amount: Option<f64>,
    #[serde(default)]
    date: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    context_id: Option<i64>,
    #[serde(default)]
    context_id_type: Option<String>,
    #[serde(default)]
    first_party_id: Option<i64>,
    #[serde(default)]
    second_party_id: Option<i64>,
    // ESI expone el impuesto retenido y quién lo cobra. Es el árbitro para saber si el pago del ESS
    // lleva impuesto de corp (entonces el Reserve no toca tu Main) o no (entonces ese 15% ES el
    // Reserve). Los ratios no pueden distinguirlo: los dos modelos predicen los mismos números.
    #[serde(default)]
    tax: Option<f64>,
    #[serde(default)]
    tax_receiver_id: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct JournalSample {
    pub ref_type: String,
    pub amount: f64,
    pub date: Option<String>,
    pub description: Option<String>,
    pub reason: Option<String>,
    pub context_id: Option<i64>,
    pub context_id_type: Option<String>,
    pub first_party_id: Option<i64>,
    pub second_party_id: Option<i64>,
    pub tax: Option<f64>,
    pub tax_receiver_id: Option<i64>,
}

/// DEBUG: devuelve unas entradas reales de bounty_prizes / ess_escrow_transfer con todos los campos,
/// para ver qué expone ESI (sistema en context_id, nº de ratas en description/reason, etc.).
#[tauri::command]
pub async fn inspect_ratting_journal(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<JournalSample>> {
    let token = token_with_scope(
        &state,
        character_id,
        "esi-wallet.read_character_wallet.v1",
        "Wallet",
    )
    .await?;
    let mut out: Vec<JournalSample> = Vec::new();
    for page in 1..=10u32 {
        let entries: Vec<JournalFull> = match state
            .esi
            .get_cached(
                &state.db,
                character_id,
                &format!("/characters/{character_id}/wallet/journal/?page={page}"),
                Some(&token),
            )
            .await
        {
            Ok(e) => e,
            Err(_) => break,
        };
        if entries.is_empty() {
            break;
        }
        for e in entries {
            let rt = e.ref_type.clone().unwrap_or_default();
            if (rt == "bounty_prizes" || rt == "ess_escrow_transfer") && out.len() < 16 {
                out.push(JournalSample {
                    ref_type: rt,
                    amount: e.amount.unwrap_or(0.0),
                    date: e.date,
                    description: e.description,
                    reason: e.reason,
                    context_id: e.context_id,
                    context_id_type: e.context_id_type,
                    first_party_id: e.first_party_id,
                    second_party_id: e.second_party_id,
                    tax: e.tax,
                    tax_receiver_id: e.tax_receiver_id,
                });
            }
        }
        if out.len() >= 16 {
            break;
        }
    }
    Ok(out)
}

/// Tendencia temporal PvP (por semana) de un personaje, para el gráfico de líneas.
#[tauri::command]
pub async fn get_pvp_trend(character_id: i64, state: State<'_, AppState>) -> AppResult<Vec<PvpTrendPoint>> {
    state.db.pvp_trend(character_id)
}

/// Bitácora: logros propios + retos adaptativos del sujeto (None = global).
/// 100% BD local (motor en db/bitacora.rs); persiste desbloqueos y marca los nuevos.
#[tauri::command]
pub async fn get_bitacora(
    character_id: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<crate::db::bitacora::Bitacora> {
    state.db.bitacora(character_id)
}

/// Evolución mensual de cada logro (derivada del histórico local; cero storage nuevo). Alimenta la
/// ficha de medalla: barras del mes, línea de acumulado y los hitos de bronce/plata/oro.
#[tauri::command]
pub async fn get_achievement_series(
    character_id: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<std::collections::HashMap<String, crate::db::bitacora::AchSeries>> {
    state.db.bitacora_series(character_id)
}

/// Proyectos personales (metas propias) del sujeto (0 = global), con su valor actual del histórico.
#[tauri::command]
pub async fn get_personal_projects(
    subject_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<crate::db::bitacora::PersonalProject>> {
    state.db.personal_projects(subject_id)
}

/// Crea un proyecto personal (nombre + métrica + objetivo). Devuelve su id.
#[tauri::command]
pub async fn create_personal_project(
    subject_id: i64,
    name: String,
    metric: String,
    target: f64,
    param_kind: String,
    param_ids: String,
    param_name: String,
    mode: String,
    state: State<'_, AppState>,
) -> AppResult<i64> {
    state.db.create_personal_project(
        subject_id,
        &name,
        &metric,
        target,
        &param_kind,
        &param_ids,
        &param_name,
        &mode,
    )
}

/// Borra un proyecto personal por id.
#[tauri::command]
pub async fn delete_personal_project(id: i64, state: State<'_, AppState>) -> AppResult<()> {
    state.db.delete_personal_project(id)
}

/* ---------- El motor humano (N1): notas ancladas ---------- */
// Ver documentacion/SPEC_MOTOR_HUMANO.md. A diferencia de todo lo demás que guarda Koru, esto lo
// escribe el jugador — así que, también a diferencia de I1, no puede estar semanas sin pantalla:
// una nota que no se puede escribir no existe.

/// Notas visibles para el sujeto. `subject_id = 0` es Global (se ven todas).
/// `include_done` trae también las cerradas, que van al final.
#[tauri::command]
pub async fn get_notes(
    subject_id: i64,
    include_done: bool,
    state: State<'_, AppState>,
) -> AppResult<Vec<crate::db::NoteRow>> {
    let subj = (subject_id != 0).then_some(subject_id);
    state.db.note_list(subj, include_done)
}

/// «¿Qué tengo apuntado sobre esto?» — notas abiertas pegadas a un sistema, tipo, ubicación o
/// personaje. Es lo que permite enseñarlas en la ficha de un sistema sin que la vista sepa nada
/// del modelo. `subject_id = 0` = Global.
#[tauri::command]
pub async fn get_notes_for(
    kind: String,
    anchor_id: i64,
    subject_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<crate::db::NoteRow>> {
    let subj = (subject_id != 0).then_some(subject_id);
    state.db.notes_for_anchor(&kind, anchor_id, subj)
}

/// Crea una nota. `subject_id = 0` la hace del JUGADOR: visible desde cualquier personaje, que es
/// lo que se quiere para «reservado para el proyecto X». Devuelve el id.
#[tauri::command]
pub async fn create_note(
    subject_id: i64,
    body: String,
    pinned: bool,
    anchors: Vec<crate::db::NoteAnchor>,
    state: State<'_, AppState>,
) -> AppResult<i64> {
    state.db.note_create(subject_id, &body, pinned, &anchors)
}

/// Reescribe una nota. Si `anchors` viene vacío se dejan las que tenía; para quitarlas todas hay
/// que pedirlo con `clear_anchors`, porque «no me mandes anclas» y «quítame las anclas» son cosas
/// distintas y confundirlas borraría datos sin que nadie lo pidiera.
#[tauri::command]
pub async fn update_note(
    id: i64,
    body: String,
    pinned: bool,
    anchors: Vec<crate::db::NoteAnchor>,
    clear_anchors: bool,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let a: Option<&[crate::db::NoteAnchor]> = if clear_anchors || !anchors.is_empty() {
        Some(&anchors)
    } else {
        None
    };
    state.db.note_update(id, &body, pinned, a)
}

/// Reasigna una nota a otro personaje. `subject_id = 0` = cualquiera.
///
/// `subject_id` es **a quién le toca**, no quién la escribió (idea de RoGiz7): con varios
/// personajes, «que Vera compre los cristales» es una tarea distinta de «comprar cristales».
#[tauri::command]
pub async fn set_note_subject(
    id: i64,
    subject_id: i64,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.db.note_set_subject(id, subject_id)
}

/// Pone o quita el disparador de llegada. `systemId = 0` lo quita.
///
/// `once = true` avisa una vez y **cierra la nota sola** (una tarea que se archiva al avisarte);
/// `once = false` avisa en cada visita nueva y la nota no se cierra nunca (un aviso permanente
/// sobre el sitio).
/// `kind` decide qué es `systemId`: con `arrive` es el sistema al que llegar; con `asset`, el TIPO
/// que esperas (el sitio sale del ancla `location` de la nota). Por defecto `arrive`, que es como
/// nació el disparador.
#[tauri::command]
pub async fn set_note_trigger(
    id: i64,
    system_id: i64,
    once: bool,
    kind: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state
        .db
        .note_set_trigger(id, system_id, once, kind.as_deref().unwrap_or("arrive"))
}

/// Un piloto identificado por su nombre exacto.
#[derive(Debug, Clone, Serialize)]
pub struct PilotoRef {
    pub character_id: i64,
    pub name: String,
}

/// Resuelve el nombre EXACTO de un piloto a su identidad real (endpoint público, sin permisos
/// nuevos). Para anclar una nota a alguien que no es tuyo: «este carbono se lo dejé a Reclutador».
///
/// Se guarda el ID y no el texto porque un nombre escrito de dos maneras serían dos pilotos
/// distintos, y entonces «¿qué le he prestado a este tío?» nunca podría contestarse. Con el ID
/// llega gratis el retrato, y queda la puerta abierta a cruzarlo con killmails y contratos.
///
/// ⚠️ Es nombre EXACTO: `/universe/ids` no busca por aproximación. Si el piloto no existe (o hay
/// una errata), devuelve `None` — y eso es información, no un fallo: significa que ese nombre no
/// es de nadie.
#[tauri::command]
pub async fn resolve_pilot(
    name: String,
    state: State<'_, AppState>,
) -> AppResult<Option<PilotoRef>> {
    let n = name.trim().to_string();
    if n.is_empty() {
        return Ok(None);
    }
    let (chars, _) = state.esi.resolve_entities(&[n.clone()]).await?;
    Ok(chars
        .into_iter()
        .find(|(_, nm)| nm.eq_ignore_ascii_case(&n))
        .map(|(id, nm)| PilotoRef {
            character_id: id,
            name: nm,
        }))
}

/// IDs → nombres (personajes, corps, sistemas… lo que sepa resolver ESI). Público y cacheado.
/// Lo usan las notas para enseñar a quién está anclada una nota, ya que se guarda el ID.
#[tauri::command]
pub async fn resolve_ids(
    ids: Vec<i64>,
    state: State<'_, AppState>,
) -> AppResult<HashMap<i64, String>> {
    state.esi.resolve_names(&ids).await
}

/// Añade un ancla a una nota SIN tocar las que ya tiene.
#[tauri::command]
pub async fn add_note_anchor(
    note_id: i64,
    kind: String,
    anchor_id: i64,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.db.note_add_anchor(note_id, &kind, anchor_id)
}

/// Quita un ancla concreta.
#[tauri::command]
pub async fn remove_note_anchor(
    note_id: i64,
    kind: String,
    anchor_id: i64,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.db.note_remove_anchor(note_id, &kind, anchor_id)
}

/// Cierra o reabre una nota. Cerrar NO borra.
#[tauri::command]
pub async fn set_note_done(id: i64, done: bool, state: State<'_, AppState>) -> AppResult<()> {
    state.db.note_set_done(id, done)
}

/// Borra una nota y sus anclas.
#[tauri::command]
pub async fn delete_note(id: i64, state: State<'_, AppState>) -> AppResult<()> {
    state.db.note_delete(id)
}

/// Resumen logi all-time (dado y recibido, por tipo) para el panel de Logros. subject_id 0 = global.
#[tauri::command]
pub async fn get_logi_summary(
    subject_id: i64,
    state: State<'_, AppState>,
) -> AppResult<crate::db::bitacora::LogiSummary> {
    state.db.logi_summary(subject_id)
}

/// Serie mensual de logi (dado/recibido por tipo) para la gráfica del apartado Logis.
#[tauri::command]
pub async fn get_logi_series(
    subject_id: i64,
    state: State<'_, AppState>,
) -> AppResult<crate::db::bitacora::LogiSeries> {
    state.db.logi_series(subject_id)
}

/// Nº de gamelogs ya parseados (estado del escaneo para Ajustes: 0 = pendiente).
#[tauri::command]
pub async fn get_gamelog_status(state: State<'_, AppState>) -> AppResult<i64> {
    Ok(state.db.gamelog_status())
}

/// ¿Hay un reprocesado de logi pendiente por una migración de datos? (para avisar de reescanear).
#[tauri::command]
pub async fn get_logi_reparse_pending(state: State<'_, AppState>) -> AppResult<bool> {
    Ok(state.db.logi_reparse_pending())
}

/// Fase C — reconstrucción (minería/rateo/viaje) del histórico de gamelog. subject_id 0 = global.
#[tauri::command]
pub async fn get_gamelog_recon(
    subject_id: i64,
    state: State<'_, AppState>,
) -> AppResult<crate::db::bitacora::GamelogRecon> {
    let mut r = state.db.gamelog_recon(subject_id)?;
    // La BD guarda el nombre CRUDO del log, así que la misma mena aparece con su nombre antiguo
    // ("Solid Pyroxeres") y con el actual ("Pyroxeres II-Grade"). Las fundimos por typeID y las
    // mostramos con el nombre canónico. Lo que el catálogo no reconozca se deja tal cual.
    {
        use std::collections::HashMap;
        let mut agg: HashMap<String, (i64, i64)> = HashMap::new();
        for o in &r.top_ores {
            let canon = ore_name_index()
                .get(&o.ore.to_lowercase())
                .and_then(|id| ore_data().get(id))
                .map(|i| i.n.clone())
                .unwrap_or_else(|| o.ore.clone());
            let e = agg.entry(canon).or_insert((0, 0));
            e.0 += o.units;
            e.1 += o.cycles;
        }
        let mut merged: Vec<crate::db::bitacora::MiningOre> = agg
            .into_iter()
            .map(|(ore, (units, cycles))| crate::db::bitacora::MiningOre { ore, units, cycles })
            .collect();
        merged.sort_by(|a, b| b.units.cmp(&a.units));
        merged.truncate(20);
        r.top_ores = merged;
    }
    Ok(r)
}

/// Minería del gamelog VALORADA por modo (units/m3/bruto/comp/reproc), reusando `ore_per_unit`.
/// Resuelve la mena (nombre) → type_id vía ESI (cache). Devuelve series diarias de Extraído
/// (base+crítico, cuadra con ESI en ese modo) y Crítico. El desperdicio no se valora (no lleva mena).
#[derive(serde::Serialize)]
pub struct GlOreDay {
    pub id: i64, // type_id de la mena (para empalmar con daily_by_ore de ESI)
    pub date: String,
    pub value: f64,
}
/// Extraído por SISTEMA y día, valorado (Fase D). El sistema va por nombre: es lo que da el chatlog.
#[derive(serde::Serialize)]
pub struct GlSysDay {
    pub system: String,
    pub date: String,
    pub value: f64,
}
/// Residuo (mena destruida) atribuido a su mena, por día: unidades y su valor en el modo actual.
/// Solo la época en que el log escribe el residuo junto a la extracción; el anterior va sin mena.
#[derive(serde::Serialize)]
pub struct GlOreWasteDay {
    pub id: i64,
    pub date: String,
    pub units: i64,
    pub value: f64,
}
#[derive(serde::Serialize)]
pub struct GamelogMiningValued {
    pub extracted: Vec<crate::db::bitacora::DayVal>,
    pub crit: Vec<crate::db::bitacora::DayVal>,
    pub by_ore: Vec<GlOreDay>, // extraído (base+crit) valorado por mena/día, para el empalme por mineral
    pub ore_names: Vec<(i64, String)>, // type_id → nombre EN de las menas vistas en el gamelog
    /// Extraído por sistema/día. Solo los ciclos con sistema atribuido (Fase D): `sys_covered` dice
    /// cuánto del extraído total representan, para no enseñar un desglose parcial como si fuera todo.
    pub by_sys: Vec<GlSysDay>,
    pub sys_covered: f64,
    /// Residuo POR MENA (v18). Mismo `ore_per_unit` y modo que `by_ore`: el % perdido por valor
    /// coincide con el % por unidades dentro de una misma mena, así que no maquilla nada.
    pub waste_by_ore: Vec<GlOreWasteDay>,
}
#[tauri::command]
pub async fn get_gamelog_mining_valued(
    subject_id: i64,
    mode: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<GamelogMiningValued> {
    use std::collections::{HashMap, HashSet};
    let mode = mode.as_deref().unwrap_or("bruto");
    let rows = state.db.gamelog_mining_rows(subject_id)?;

    // Menas distintas → type_id (cache primero; ESI solo para las que falten).
    let distinct: Vec<String> = {
        let mut s = HashSet::new();
        for (_, ore, _, _) in &rows {
            s.insert(ore.clone());
        }
        s.into_iter().collect()
    };
    let mut name_to_id: HashMap<String, i64> = HashMap::new();
    let mut to_resolve: Vec<String> = Vec::new();
    for ore in &distinct {
        // 1) Catálogo local del SDE: cubre las 240 menas del juego, sin red y sin poder fallar.
        if let Some(id) = ore_name_index().get(&ore.to_lowercase()) {
            name_to_id.insert(ore.clone(), *id);
            continue;
        }
        // 2) Caché de nombres. 3) ESI (solo para lo que el catálogo no conozca).
        match state.db.name_cache_get(&ore.to_lowercase()) {
            Some((Some(id), _, _)) => {
                name_to_id.insert(ore.clone(), id);
            }
            Some((None, _, _)) => {} // negativo (no resoluble): se queda sin precio
            None => to_resolve.push(ore.clone()),
        }
    }
    if !to_resolve.is_empty() {
        if let Ok((_chars, types)) = state.esi.resolve_entities(&to_resolve).await {
            let mut resolved = HashSet::new();
            for (id, name) in &types {
                state.db.name_cache_put(&name.to_lowercase(), *id, name);
                resolved.insert(name.to_lowercase());
            }
            for n in &to_resolve {
                if !resolved.contains(&n.to_lowercase()) {
                    state.db.name_cache_put_negative(&n.to_lowercase());
                }
            }
        }
        for ore in &to_resolve {
            if let Some((Some(id), _, _)) = state.db.name_cache_get(&ore.to_lowercase()) {
                name_to_id.insert(ore.clone(), id);
            }
        }
    }

    let prices = state.db.prices_map().unwrap_or_default();
    let mut ext: HashMap<String, f64> = HashMap::new();
    let mut crt: HashMap<String, f64> = HashMap::new();
    let mut by_ore: HashMap<(i64, String), f64> = HashMap::new();
    for (date, ore, units, crit) in rows {
        let tid = name_to_id.get(&ore).copied().unwrap_or(0);
        let per = ore_per_unit(tid, mode, &prices);
        let val = (units + crit) as f64 * per;
        *ext.entry(date.clone()).or_insert(0.0) += val;
        *crt.entry(date.clone()).or_insert(0.0) += crit as f64 * per;
        if tid != 0 {
            *by_ore.entry((tid, date)).or_insert(0.0) += val;
        }
    }
    // Fase D — el mismo extraído, repartido por sistema. Se valora igual (por mena y modo), así que
    // la suma de los sistemas es comparable con el Extraído total… salvo por lo no atribuido, que es
    // justo lo que informa `sys_covered`. Las menas ya están resueltas arriba: son las mismas.
    let ext_total: f64 = ext.values().sum();
    let mut by_sys_m: HashMap<(String, String), f64> = HashMap::new();
    let mut sys_total = 0.0f64;
    for (date, system, ore, units, crit) in state.db.gamelog_mining_sys_rows(subject_id)? {
        let tid = name_to_id.get(&ore).copied().unwrap_or(0);
        let val = (units + crit) as f64 * ore_per_unit(tid, mode, &prices);
        sys_total += val;
        *by_sys_m.entry((system, date)).or_insert(0.0) += val;
    }
    let mut by_sys: Vec<GlSysDay> = by_sys_m
        .into_iter()
        .map(|((system, date), value)| GlSysDay { system, date, value })
        .collect();
    by_sys.sort_by(|a, b| a.date.cmp(&b.date));
    let sys_covered = if ext_total > 0.0 { sys_total / ext_total } else { 0.0 };

    let to_series = |m: HashMap<String, f64>| {
        let mut v: Vec<crate::db::bitacora::DayVal> = m
            .into_iter()
            .map(|(date, value)| crate::db::bitacora::DayVal { date, value })
            .collect();
        v.sort_by(|a, b| a.date.cmp(&b.date));
        v
    };
    let mut ore_v: Vec<GlOreDay> = by_ore
        .into_iter()
        .map(|((id, date), value)| GlOreDay { id, date, value })
        .collect();
    ore_v.sort_by(|a, b| a.date.cmp(&b.date));
    // Residuo por mena (v18): mismas menas que arriba (misma tabla), así que `name_to_id` ya las
    // conoce. tid=0 (mena irresoluble) se salta, igual que en `by_ore`: sin tipo no hay valor.
    let mut waste_m: HashMap<(i64, String), (i64, f64)> = HashMap::new();
    for (date, ore, waste) in state.db.gamelog_waste_by_ore_rows(subject_id)? {
        let tid = name_to_id.get(&ore).copied().unwrap_or(0);
        if tid == 0 {
            continue;
        }
        let e = waste_m.entry((tid, date)).or_insert((0, 0.0));
        e.0 += waste;
        e.1 += waste as f64 * ore_per_unit(tid, mode, &prices);
    }
    let mut waste_v: Vec<GlOreWasteDay> = waste_m
        .into_iter()
        .map(|((id, date), (units, value))| GlOreWasteDay { id, date, units, value })
        .collect();
    waste_v.sort_by(|a, b| a.date.cmp(&b.date));
    // Nombres de las menas del gamelog: sin esto el frontend pinta "#45494" para las menas que solo
    // existen en el histórico del log (ESI solo nombra las que hay en su ventana de mining_ledger).
    // Devolvemos el nombre CANÓNICO ACTUAL del catálogo, no el que escribió el log: así el histórico
    // de "Solid Pyroxeres" y el reciente de "Pyroxeres II-Grade" son la MISMA línea (mismo typeID).
    let mut seen: HashSet<i64> = HashSet::new();
    let ore_names: Vec<(i64, String)> = name_to_id
        .values()
        .filter(|id| seen.insert(**id))
        .filter_map(|id| ore_data().get(id).map(|info| (*id, info.n.clone())))
        .collect();
    Ok(GamelogMiningValued {
        extracted: to_series(ext),
        crit: to_series(crt),
        by_ore: ore_v,
        ore_names,
        by_sys,
        sys_covered,
        waste_by_ore: waste_v,
    })
}

/// Desglose de la gráfica de logi por dimensión (pilot|ship|module) × día, dirección given|received.
#[tauri::command]
pub async fn get_logi_breakdown(
    subject_id: i64,
    direction: String,
    dimension: String,
    state: State<'_, AppState>,
) -> AppResult<crate::db::bitacora::LogiBreakdown> {
    state.db.logi_breakdown(subject_id, &direction, &dimension)
}

/// Top de pilotos por dirección (given/received) para el histórico del apartado Logis.
#[tauri::command]
pub async fn get_logi_pilots(
    subject_id: i64,
    direction: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<crate::db::bitacora::LogiPilot>> {
    let mut pilots = state.db.logi_pilots_top(subject_id, &direction)?;
    // Retrato: resolver nombre→character_id (cache local; ESI /universe/ids solo para los que falten).
    let to_resolve: Vec<String> = pilots
        .iter()
        .filter(|p| state.db.name_cache_get(&p.pilot.to_lowercase()).is_none())
        .map(|p| p.pilot.clone())
        .collect();
    if !to_resolve.is_empty() {
        if let Ok((chars, _ships)) = state.esi.resolve_entities(&to_resolve).await {
            let mut resolved = std::collections::HashSet::new();
            for (id, name) in &chars {
                state.db.name_cache_put(&name.to_lowercase(), *id, name);
                resolved.insert(name.to_lowercase());
            }
            // Los que pedimos y no eran personajes (drones/estructuras/borrados) → negativo (no reintentar).
            for n in &to_resolve {
                let nl = n.to_lowercase();
                if !resolved.contains(&nl) {
                    state.db.name_cache_put_negative(&nl);
                }
            }
        }
    }
    for p in &mut pilots {
        if let Some((Some(id), _, _)) = state.db.name_cache_get(&p.pilot.to_lowercase()) {
            if id > 0 {
                p.char_id = id;
            }
        }
    }
    Ok(pilots)
}

/// Opción del buscador de caza: una víctima (personaje o corp) de tus kills, con nombre y recuento.
#[derive(serde::Serialize)]
pub struct VictimOpt {
    pub id: i64,
    pub name: String,
    pub count: i64,
}

/// Víctimas (personaje o corp) de tus kills para el buscador de caza selectiva, con nombre resuelto.
#[tauri::command]
pub async fn get_kill_victims(
    subject_id: i64,
    kind: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<VictimOpt>> {
    let rows = state.db.kill_victims(subject_id, &kind)?;
    let ids: Vec<i64> = rows.iter().map(|(id, _)| *id).collect();
    let names = state.esi.resolve_names(&ids).await.unwrap_or_default();
    Ok(rows
        .into_iter()
        .map(|(id, count)| VictimOpt {
            id,
            count,
            name: names.get(&id).cloned().unwrap_or_else(|| format!("#{id}")),
        })
        .collect())
}

/// Un tramo del corporationhistory (endpoint PÚBLICO de ESI, sin scope).
#[derive(serde::Deserialize)]
struct CorpHistItem {
    corporation_id: i64,
    start_date: String,
}

/// Etapa del Diario: en qué corporación entró el personaje y cuándo (nombre resuelto).
#[derive(Debug, Serialize)]
pub struct DiaryCorp {
    pub corporation_id: i64,
    pub corporation_name: Option<String>,
    pub start_date: String,
}

/// Historia de corporación del personaje = espina biográfica del Diario. Endpoint PÚBLICO
// ---- Military Campaigns (Cradle of War) — rutas PÚBLICAS, devblog 2026-08-04 ----
// Shapes verificados contra pegados REALES de las rutas (curl de RoGiz7, 2026-08-04):
//   /military-campaigns            → {"campaigns":[{id: UUID, state, progress}]}
//   /military-campaigns/{id}       → {id, state, progress} (los tiempos NO aparecen en activas)
//   /.../objectives                → {"cursor":{before,after}, "objectives":[{id, state, progress,
//                                     participants:{total,committed,contributors}, last_modified,
//                                     started}]} — PAGINADO por cursor (10/página).
// ⚠️ IDs = UUID (String, no i64). Scheduled/canceladas = 404 y ausentes del listing (no es error).
// Los textos/recompensas viven en public/military_campaigns.json (SDE, mismas UUIDs).

#[derive(Debug, Clone, serde::Deserialize, Serialize)]
pub struct MilitaryCampaign {
    pub id: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub progress: i64,
}

#[derive(Debug, Clone, serde::Deserialize, Serialize, Default)]
pub struct CampaignParticipants {
    #[serde(default)]
    pub total: i64,
    #[serde(default)]
    pub committed: i64,
    #[serde(default)]
    pub contributors: i64,
}

#[derive(Debug, Clone, serde::Deserialize, Serialize)]
pub struct CampaignObjective {
    pub id: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub progress: i64,
    #[serde(default)]
    pub participants: CampaignParticipants,
    #[serde(default)]
    pub started: Option<String>,
    #[serde(default)]
    pub last_modified: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct CampaignsWrap {
    #[serde(default)]
    campaigns: Vec<MilitaryCampaign>,
}

#[derive(Debug, serde::Deserialize, Default)]
struct CampaignCursor {
    #[serde(default)]
    after: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct ObjectivesWrap {
    #[serde(default)]
    cursor: Option<CampaignCursor>,
    #[serde(default)]
    objectives: Vec<CampaignObjective>,
}

/// Listado público de campañas militares (activas/completadas/expiradas). Cache namespace 0.
#[tauri::command]
pub async fn get_military_campaigns(
    state: State<'_, AppState>,
) -> AppResult<Vec<MilitaryCampaign>> {
    let w: CampaignsWrap = state
        .esi
        .get_cached(&state.db, 0, "/military-campaigns", None)
        .await?;
    Ok(w.campaigns)
}

/// Objetivos de UNA campaña, siguiendo el cursor hasta agotarlo (10/página en los pegados reales).
/// Tope de páginas por si el cursor no terminara nunca: preferimos quedarnos cortos y decirlo.
#[tauri::command]
pub async fn get_military_campaign_objectives(
    campaign_id: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<CampaignObjective>> {
    let mut out: Vec<CampaignObjective> = Vec::new();
    let mut after: Option<String> = None;
    let mut seen_cursors: std::collections::HashSet<String> = std::collections::HashSet::new();
    for _page in 0..30 {
        // Los cursores reales son URL-safe ("1.GMim_3gHkTBF": alfanumérico + punto + guion bajo)
        // → sin dependencia de urlencoding. Si algún día trajeran caracteres raros, filtramos.
        let path = match &after {
            Some(a) if a.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)) => {
                format!("/military-campaigns/{campaign_id}/objectives?after={a}")
            }
            Some(_) => break, // cursor con pinta rara: cortamos antes que mandar basura a ESI
            None => format!("/military-campaigns/{campaign_id}/objectives"),
        };
        let w: ObjectivesWrap = state.esi.get_cached(&state.db, 0, &path, None).await?;
        if w.objectives.is_empty() {
            break;
        }
        out.extend(w.objectives);
        match w.cursor.and_then(|c| c.after) {
            // Cursor repetido = fin (defensa ante un `after` que no avanza).
            Some(a) if seen_cursors.insert(a.clone()) => after = Some(a),
            _ => break,
        }
    }
    Ok(out)
}

// ---- Military Campaigns FASE 2: TU contribución (AUTENTICADO) ----
// Scope `esi.activity.char:read` (familia NUEVA, no `esi-xxx.v1`). Verificado concedible en vivo.
//
// ✅ LLAMADA REAL (API Explorer, 2026-08-04, personaje sin participación):
//    GET /characters/{id}/military-campaigns/objectives → 200 `{"objectives": []}`
//    Con lista vacía NO viene `cursor` → cursor OPCIONAL, paginamos solo si aparece.
//
// ✅ NOMBRES DE CAMPO tomados del Response Example del OpenAPI (el devblog dice que la spec y el
//    API Explorer son la fuente de verdad para nombres, scopes y cachés):
//      { "cursor": {"after","before"},
//        "objectives": [ { "id": UUID, "campaign_id": UUID, "contributed": 10,
//                          "is_committed": true, "last_modified": "2025-11-01T00:00:00Z" } ] }
//    ⚠️ Ojo a los nombres, que no son los que uno diría: `contributed` (no "contribution") e
//    `is_committed` (no "committed"). La ruta PÚBLICA usa otra nomenclatura (`participants`).
//
// ✅ ESQUEMA DOCUMENTADO (Responses/200 → Body del API Explorer, leído campo a campo):
//      objectives   array[object]        REQUIRED  "List of military campaign objectives"
//      ├─ campaign_id   string<uuid>     REQUIRED  "Campaign's ID"
//      ├─ id            string<uuid>     REQUIRED  "Objective's ID"
//      ├─ contributed   integer<int64>   REQUIRED  "The character's cumulative contribution"
//      ├─ is_committed  boolean          REQUIRED  "Whether the character is currently committed"
//      └─ last_modified string<date-time>REQUIRED  "Moment this information was last modified"
//      cursor       object (NO required) → confirma que sin resultados puede no venir.
//    👉 `contributed` es un ENTERO acumulado, no un porcentaje. Se pinta CRUDO: no lo dividimos
//    por el `target` del SDE para sacar un «llevas el X%», porque que ambos sean enteros no prueba
//    que estén en la misma unidad. Cuando haya un pegado real se comprueba (la suma de las
//    contribuciones debería acercarse al `progress` de la ruta pública) y entonces sí se deriva.
//    Todo va con #[serde(default)] aunque la spec los marque requeridos: si Fenris cambia algo,
//    preferimos degradar a 0/false antes que dejar la sección en blanco.
//
// Query params: `after`/`before` (excluyentes), `limit` 10..=100 (por defecto 10) → pedimos 100
// para gastar el menor número de llamadas posible.
// Rate limit (del API Explorer): grupo `char-military-campaign`, 150 tokens / 15 min, caché de
// cliente 60 s. Es un límite POR GRUPO y Koru es multicuenta → UNA llamada al LISTADO por
// personaje, nunca el detalle objetivo por objetivo en bucle.

/// Una entrada del listado, tal y como la sirve ESI (nombres de la spec).
#[derive(Debug, Clone, serde::Deserialize, Serialize)]
pub struct MyObjectiveEntry {
    /// UUID del OBJETIVO (no de la campaña). Es la clave del join con el SDE.
    pub id: String,
    #[serde(default)]
    pub campaign_id: String,
    /// "The character's cumulative contribution" (spec). Entero acumulado, NO un porcentaje.
    #[serde(default)]
    pub contributed: i64,
    /// ¿Está apuntado AHORA MISMO? (se puede renunciar y seguir contando como contributor)
    #[serde(default)]
    pub is_committed: bool,
    #[serde(default)]
    pub last_modified: Option<String>,
}

/// Lo mismo, pero con el personaje pegado: la vista es multicuenta y necesita saber de quién es
/// cada línea para pintar el retrato.
#[derive(Debug, Clone, Serialize)]
pub struct MyCampaignParticipation {
    pub character_id: i64,
    pub objective_id: String,
    pub campaign_id: String,
    pub contributed: i64,
    pub is_committed: bool,
    pub last_modified: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct MyObjectivesWrap {
    #[serde(default)]
    cursor: Option<CampaignCursor>,
    #[serde(default)]
    objectives: Vec<MyObjectiveEntry>,
}

/// Mi participación en objetivos de campañas, para VARIOS personajes.
///
/// Best-effort por personaje: si a uno le falta el scope (403) o falla el token, se le salta y los
/// demás siguen. Nunca rompe la vista — la sección de Campañas tiene que seguir pintando sus datos
/// públicos aunque nadie haya concedido nada.
#[tauri::command]
pub async fn get_my_campaign_participation(
    character_ids: Vec<i64>,
    state: State<'_, AppState>,
) -> AppResult<Vec<MyCampaignParticipation>> {
    let mut out: Vec<MyCampaignParticipation> = Vec::new();

    for character_id in character_ids {
        let Ok(valid) = state
            .tokens
            .access_token(state.esi.http(), character_id)
            .await
        else {
            continue; // sin token utilizable: ese personaje no participa en la vista
        };

        let mut after: Option<String> = None;
        let mut seen_cursors: std::collections::HashSet<String> = std::collections::HashSet::new();
        // Tope de páginas: un personaje no va a estar en cientos de objetivos, y así el cursor
        // no puede hacernos un bucle infinito contra un endpoint con rate limit.
        for _page in 0..10 {
            let base = format!("/characters/{character_id}/military-campaigns/objectives?limit=100");
            let path = match &after {
                Some(a) if a.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)) => {
                    format!("{base}&after={a}")
                }
                Some(_) => break, // cursor con pinta rara: cortamos (mismo criterio que la fase 1)
                None => base,
            };
            let Ok(page) = state
                .esi
                .get_cached::<MyObjectivesWrap>(
                    &state.db,
                    character_id,
                    &path,
                    Some(&valid.access_token),
                )
                .await
            else {
                break; // 403 sin scope, token caducado, ESI de mal humor: ese pj no aporta y ya
            };
            if page.objectives.is_empty() {
                break;
            }

            for it in page.objectives {
                if it.id.is_empty() {
                    continue; // sin UUID de objetivo no hay join posible con el SDE: se descarta
                }
                out.push(MyCampaignParticipation {
                    character_id,
                    objective_id: it.id,
                    campaign_id: it.campaign_id,
                    contributed: it.contributed,
                    is_committed: it.is_committed,
                    last_modified: it.last_modified,
                });
            }

            // El cursor puede no venir (con lista vacía no viene). Sin cursor = una sola página.
            match page.cursor.and_then(|c| c.after) {
                Some(a) if seen_cursors.insert(a.clone()) => after = Some(a),
                _ => break,
            }
        }
    }

    Ok(out)
}

/// `/characters/{id}/corporationhistory/` (sin token, cacheado por ESI). Ordena reciente→antiguo.
#[tauri::command]
pub async fn get_corp_history(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<DiaryCorp>> {
    let items = state
        .esi
        .get_cached::<Vec<CorpHistItem>>(
            &state.db,
            character_id,
            &format!("/characters/{character_id}/corporationhistory/"),
            None,
        )
        .await
        .unwrap_or_default();
    let ids: Vec<i64> = items.iter().map(|i| i.corporation_id).collect();
    let names = state.esi.resolve_names(&ids).await.unwrap_or_default();
    let mut out: Vec<DiaryCorp> = items
        .into_iter()
        .map(|i| DiaryCorp {
            corporation_id: i.corporation_id,
            corporation_name: names.get(&i.corporation_id).cloned(),
            start_date: i.start_date,
        })
        .collect();
    out.sort_by(|a, b| b.start_date.cmp(&a.start_date)); // más reciente primero
    Ok(out)
}

/// Capa gráfica de una medalla in-game: la medalla se COMPONE apilando estas capas por `part`
/// (1 cinta, 2 medallón) y `layer`. `graphic` apunta a las texturas del cliente
/// (SharedCache → res:/ui/texture/medals/…, hojas de sprites de 256×256) y `color` es un ARGB
/// entero. El mapeo graphic→textura/celda se fija mirando datos reales (ver
/// scripts/find_medal_textures.py y documentacion/medals/).
#[derive(Debug, serde::Deserialize, Serialize)]
pub struct MedalGraphic {
    #[serde(default)]
    pub part: i64,
    #[serde(default)]
    pub layer: i64,
    #[serde(default)]
    pub graphic: String,
    #[serde(default)]
    pub color: Option<i64>,
}

/// Una medalla in-game tal cual la da ESI (`/characters/{id}/medals/`).
#[derive(serde::Deserialize)]
struct MedalRaw {
    medal_id: i64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    corporation_id: i64,
    #[serde(default)]
    date: String,
    #[serde(default)]
    reason: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    graphics: Vec<MedalGraphic>,
}

/// Condecoración oficial de corporación para el medallero mixto de la Bitácora.
#[derive(Debug, Serialize)]
pub struct Medal {
    pub medal_id: i64,
    pub title: String,
    pub description: String,
    pub corporation_id: i64,
    pub corporation_name: Option<String>,
    pub date: String,
    pub reason: String,
    pub status: String,
    /// Capas para el dibujo real de la medalla. Vacío si ESI no las trae.
    pub graphics: Vec<MedalGraphic>,
}

/// Medallas in-game del personaje (condecoraciones de corp). Requiere scope
/// `esi-characters.read_medals.v1`; si falta, ESI da 403 → devolvemos lista vacía (best-effort).
#[tauri::command]
pub async fn get_medals(character_id: i64, state: State<'_, AppState>) -> AppResult<Vec<Medal>> {
    let Ok(valid) = state
        .tokens
        .access_token(state.esi.http(), character_id)
        .await
    else {
        return Ok(Vec::new());
    };
    let raw = state
        .esi
        .get_cached::<Vec<MedalRaw>>(
            &state.db,
            character_id,
            &format!("/characters/{character_id}/medals/"),
            Some(&valid.access_token),
        )
        .await
        .unwrap_or_default();
    let ids: Vec<i64> = raw.iter().map(|m| m.corporation_id).collect();
    let names = state.esi.resolve_names(&ids).await.unwrap_or_default();
    let mut out: Vec<Medal> = raw
        .into_iter()
        .map(|m| Medal {
            medal_id: m.medal_id,
            title: m.title,
            description: m.description,
            corporation_name: names.get(&m.corporation_id).cloned(),
            corporation_id: m.corporation_id,
            date: m.date,
            reason: m.reason,
            status: m.status,
            graphics: m.graphics,
        })
        .collect();
    out.sort_by(|a, b| b.date.cmp(&a.date)); // más reciente primero
    Ok(out)
}

/// LP por corporación NPC tal cual lo da ESI (`/characters/{id}/loyalty/points/`).
#[derive(serde::Deserialize)]
struct LoyaltyRaw {
    corporation_id: i64,
    loyalty_points: i64,
}

/// Saldo de LP en una corporación NPC (recompensa de misiones), con nombre resuelto.
#[derive(Debug, Serialize)]
pub struct LoyaltyCorp {
    pub corporation_id: i64,
    pub corporation_name: Option<String>,
    pub loyalty_points: i64,
}

/// Puntos de lealtad (LP) del personaje por corporación NPC. Requiere scope
/// `esi-characters.read_loyalty.v1`; si falta, ESI da 403 → lista vacía (best-effort).
#[tauri::command]
pub async fn get_loyalty(character_id: i64, state: State<'_, AppState>) -> AppResult<Vec<LoyaltyCorp>> {
    let Ok(valid) = state
        .tokens
        .access_token(state.esi.http(), character_id)
        .await
    else {
        return Ok(Vec::new());
    };
    let raw = state
        .esi
        .get_cached::<Vec<LoyaltyRaw>>(
            &state.db,
            character_id,
            &format!("/characters/{character_id}/loyalty/points/"),
            Some(&valid.access_token),
        )
        .await
        .unwrap_or_default();
    let ids: Vec<i64> = raw.iter().map(|l| l.corporation_id).collect();
    let names = state.esi.resolve_names(&ids).await.unwrap_or_default();
    let mut out: Vec<LoyaltyCorp> = raw
        .into_iter()
        .map(|l| LoyaltyCorp {
            corporation_name: names.get(&l.corporation_id).cloned(),
            corporation_id: l.corporation_id,
            loyalty_points: l.loyalty_points,
        })
        .collect();
    out.sort_by(|a, b| b.loyalty_points.cmp(&a.loyalty_points)); // más LP primero
    Ok(out)
}

/// Un "trabajo por libre" (Freelance Job) del personaje. Freelance = el sucesor de Opportunities;
/// a nivel de personaje son los trabajos en los que participas. Campos según la spec (los mismos
/// que mapea aa-freelance-tracker). Extracción defensiva (serde_json::Value) por si ESI anida
/// progress/reward u otro nombre → nunca rompe, a lo sumo sale a 0.
#[derive(Debug, Serialize)]
pub struct FreelanceJob {
    pub id: String,
    pub name: String,
    pub state: String,       // Active / Closed / Completed / Expired / ...
    pub career: String,      // Explorer / Industrialist / Enforcer / Soldier of Fortune
    pub description: String,
    pub expires: String,
    pub progress_current: i64,
    pub progress_desired: i64,
    pub reward_remaining: f64,
}

/// Mis trabajos por libre (en los que participo). DOS pasos (confirmado con el código de
/// aa-freelance-tracker): (1) el LISTADO del personaje `/characters/{id}/freelance-jobs`
/// (AUTENTICADO, scope read_freelance_jobs) viene ENVUELTO `{ freelance_jobs:[{id,..}], cursor }`
/// (paginado; con la 1ª página basta, un pj tiene pocos) y solo trae IDs; (2) por cada id, el
/// DETALLE PÚBLICO `/freelance-jobs/{id}` con la info completa — ojo: `career`/`description`/
/// `expires` van bajo `details`, y `progress`/`reward` anidados. 403 sin scope → vacío.
#[tauri::command]
pub async fn get_freelance_jobs(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<FreelanceJob>> {
    let Ok(valid) = state
        .tokens
        .access_token(state.esi.http(), character_id)
        .await
    else {
        return Ok(Vec::new());
    };
    let listing = state
        .esi
        .get_cached::<serde_json::Value>(
            &state.db,
            character_id,
            &format!("/characters/{character_id}/freelance-jobs"),
            Some(&valid.access_token),
        )
        .await
        .unwrap_or(serde_json::Value::Null);
    // Respuesta envuelta en `freelance_jobs`; si algún día fuera un array plano, también vale.
    let items = listing
        .get("freelance_jobs")
        .and_then(|x| x.as_array())
        .cloned()
        .or_else(|| listing.as_array().cloned())
        .unwrap_or_default();

    let mut jobs: Vec<FreelanceJob> = Vec::new();
    for it in items.iter().take(100) {
        let Some(id) = it.get("id").and_then(|x| x.as_str()) else {
            continue;
        };
        // Detalle público (sin token, cacheado en namespace 0). Si falla, caemos al item del listado.
        let detail = state
            .esi
            .get_cached::<serde_json::Value>(&state.db, 0, &format!("/freelance-jobs/{id}"), None)
            .await
            .unwrap_or(serde_json::Value::Null);
        let v = if detail.is_object() { &detail } else { it };
        let top = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
        let nst = |a: &str, b: &str| {
            v.get(a).and_then(|o| o.get(b)).and_then(|x| x.as_str()).unwrap_or("").to_string()
        };
        let nin =
            |a: &str, b: &str| v.get(a).and_then(|o| o.get(b)).and_then(|x| x.as_i64()).unwrap_or(0);
        let nfl = |a: &str, b: &str| {
            v.get(a).and_then(|o| o.get(b)).and_then(|x| x.as_f64()).unwrap_or(0.0)
        };
        jobs.push(FreelanceJob {
            id: id.to_string(),
            name: top("name"),
            state: top("state"),
            career: nst("details", "career"),
            description: nst("details", "description"),
            expires: nst("details", "expires"),
            progress_current: nin("progress", "current"),
            progress_desired: nin("progress", "desired"),
            reward_remaining: nfl("reward", "remaining"),
        });
    }
    Ok(jobs)
}

/// Un proyecto de corporación (Corporation Projects). Parse best-effort (shape aún por confirmar en
/// vivo); el comando LOGuea la respuesta cruda para afinar campos y ver el acceso (miembro vs rol).
#[derive(Debug, Serialize)]
pub struct CorpProject {
    pub id: String,
    pub name: String,
    pub state: String,
    pub description: String,
    pub career: String,       // Explorer / Industrialist / Enforcer / Soldier of Fortune
    pub method: String,       // clave de configuration: mine_material / deliver_item / ...
    pub groups: Vec<String>,  // objetivo resuelto por ESI: grupo (mine) o tipo de objeto (deliver)
    pub location: String,     // dónde entregar (deliver_item.office_id → estructura), si aplica
    pub icon_type_id: Option<i64>, // tipo del ítem a entregar (deliver_item) → icono EVE
    pub progress_current: i64,
    pub progress_desired: i64,
    pub contributed: i64,     // tu contribución personal (de /contribution/{char})
    pub reward_remaining: f64, // algunos proyectos pagan ISK (viene en el listado)
}

/// Proyectos de la corporación del personaje. `/corporations/{corp}/projects`
/// (scope esi-corporations.read_projects.v1). El corp_id se resuelve del info PÚBLICO del personaje.
/// DIAGNÓSTICO: registra la respuesta cruda / error → sabremos si un miembro sin rol puede leer.
#[tauri::command]
pub async fn get_corp_projects(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<CorpProject>> {
    let Ok(valid) = state
        .tokens
        .access_token(state.esi.http(), character_id)
        .await
    else {
        return Ok(Vec::new());
    };
    let info = state
        .esi
        .get_cached::<serde_json::Value>(
            &state.db,
            character_id,
            &format!("/characters/{character_id}/"),
            None,
        )
        .await
        .unwrap_or(serde_json::Value::Null);
    let Some(corp_id) = info.get("corporation_id").and_then(|x| x.as_i64()) else {
        return Ok(Vec::new());
    };
    let listing = state
        .esi
        .get_cached::<serde_json::Value>(
            &state.db,
            character_id,
            &format!("/corporations/{corp_id}/projects"),
            Some(&valid.access_token),
        )
        .await
        .unwrap_or(serde_json::Value::Null);
    let items = listing
        .get("projects")
        .and_then(|x| x.as_array())
        .cloned()
        .or_else(|| listing.as_array().cloned())
        .unwrap_or_default();
    let mut out: Vec<CorpProject> = Vec::new();
    for v in items.iter() {
        let gs = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
        let gi = |a: &str, b: &str| {
            v.get(a).and_then(|o| o.get(b)).and_then(|x| x.as_i64()).unwrap_or(0)
        };
        let id = gs("id");
        if id.is_empty() {
            continue;
        }
        let name = gs("name");
        let st = gs("state");
        let pc = gi("progress", "current");
        let pd = gi("progress", "desired");

        // El listado NO trae descripción: pedimos el DETALLE, que además lleva la `configuration`
        // (el "qué" del proyecto: minería, kills, daño...). Log del 1º para ver esa config.
        let detail = state
            .esi
            .get_cached::<serde_json::Value>(
                &state.db,
                character_id,
                &format!("/corporations/{corp_id}/projects/{id}"),
                Some(&valid.access_token),
            )
            .await
            .unwrap_or(serde_json::Value::Null);
        let mut description = detail
            .get("description")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        if description.is_empty() {
            description = detail
                .get("details")
                .and_then(|o| o.get("description"))
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
        }
        let career = detail
            .get("details")
            .and_then(|o| o.get("career"))
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();

        // El "qué" del proyecto: `configuration` = { <método>: { ...params } }. El método es la
        // clave (mine_material, destroy_ships, deal_damage...). Sacamos los group_id del objetivo.
        let cfg = detail.get("configuration");
        let method = cfg
            .and_then(|o| o.as_object())
            .and_then(|m| m.keys().next().cloned())
            .unwrap_or_default();
        let mut group_ids: Vec<i64> = Vec::new();
        let mut type_ids: Vec<i64> = Vec::new();
        if let Some(inner) = cfg.and_then(|o| o.get(method.as_str())) {
            // mine_material → materials[].group_id
            if let Some(mats) = inner.get("materials").and_then(|x| x.as_array()) {
                for m in mats {
                    if let Some(g) = m.get("group_id").and_then(|x| x.as_i64()) {
                        group_ids.push(g);
                    }
                }
            }
            // deliver_item → items[].type_id
            if let Some(items2) = inner.get("items").and_then(|x| x.as_array()) {
                for it2 in items2 {
                    if let Some(t) = it2.get("type_id").and_then(|x| x.as_i64()) {
                        type_ids.push(t);
                    }
                }
            }
            if let Some(g) = inner.get("group_id").and_then(|x| x.as_i64()) {
                group_ids.push(g);
            }
        }
        // Resolver nombres (público, cacheado): grupo 465 -> "Ice", tipo 2876 -> "Robotics".
        let mut groups: Vec<String> = Vec::new();
        for g in &group_ids {
            let gv = state
                .esi
                .get_cached::<serde_json::Value>(&state.db, 0, &format!("/universe/groups/{g}/"), None)
                .await
                .unwrap_or(serde_json::Value::Null);
            if let Some(n) = gv.get("name").and_then(|x| x.as_str()) {
                groups.push(n.to_string());
            }
        }
        for t in &type_ids {
            let tv = state
                .esi
                .get_cached::<serde_json::Value>(&state.db, 0, &format!("/universe/types/{t}/"), None)
                .await
                .unwrap_or(serde_json::Value::Null);
            if let Some(n) = tv.get("name").and_then(|x| x.as_str()) {
                groups.push(n.to_string());
            }
        }
        // Reward (algunos proyectos pagan ISK; viene en el item del listado).
        let reward_remaining = v
            .get("reward")
            .and_then(|o| o.get("remaining"))
            .and_then(|x| x.as_f64())
            .unwrap_or(0.0);

        // Dónde entregar: deliver_item.office_id → estructura de jugador (needs read_structures).
        // Log temporal para confirmar que resuelve (o si es estación/otro id).
        let office_id = cfg
            .and_then(|o| o.get(method.as_str()))
            .and_then(|inner| inner.get("office_id"))
            .and_then(|x| x.as_i64());
        let mut location = String::new();
        if let Some(oid) = office_id {
            // Un solo intento con el PJ activo. ESI solo revela la estructura si ese PJ puede atracar
            // (403 si no). No insistimos con otros tokens: cada 403 gasta el error-budget de ESI.
            if let Ok(sv) = state
                .esi
                .get_cached::<serde_json::Value>(
                    &state.db,
                    character_id,
                    &format!("/universe/structures/{oid}/"),
                    Some(&valid.access_token),
                )
                .await
            {
                if let Some(n) = sv.get("name").and_then(|x| x.as_str()) {
                    location = n.to_string();
                }
            }
        }

        // Contribución personal (confirmado: `{ "contributed": N }`).
        let c = state
            .esi
            .get_cached::<serde_json::Value>(
                &state.db,
                character_id,
                &format!("/corporations/{corp_id}/projects/{id}/contribution/{character_id}"),
                Some(&valid.access_token),
            )
            .await
            .unwrap_or(serde_json::Value::Null);
        let contributed = c
            .get("contributed")
            .and_then(|x| x.as_i64())
            .or_else(|| c.as_i64())
            .unwrap_or(0);

        out.push(CorpProject {
            id,
            name,
            state: st,
            description,
            career,
            method,
            groups,
            location,
            icon_type_id: type_ids.first().copied(),
            progress_current: pc,
            progress_desired: pd,
            contributed,
            reward_remaining,
        });
    }
    Ok(out)
}

/// Datos vivos del ticker del dock. Solo BD local, cero ESI: seguro llamarlo a menudo.
#[tauri::command]
pub async fn get_ticker(
    character_id: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<crate::db::TickerData> {
    state.db.ticker(character_id)
}

/// Serie semanal de los tops (naves usadas, naves destruidas o sistemas) para las líneas
/// de PvP. `character_id` None = global. `dim` = "ship" | "victim" | "system".
/// Resuelve los nombres aquí (cacheado) para no depender del top-10 de stats.
#[tauri::command]
pub async fn get_pvp_top_series(
    character_id: Option<i64>,
    dim: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<crate::db::TopSeriesPoint>> {
    let mut rows = state.db.pvp_top_series(character_id, &dim)?;
    let ids: Vec<i64> = rows.iter().map(|r| r.id).collect();
    if let Ok(names) = state.esi.resolve_names(&ids).await {
        for r in rows.iter_mut() {
            r.name = names.get(&r.id).cloned();
        }
    }
    Ok(rows)
}

/// Tendencia temporal PvP global (todos los personajes).
#[tauri::command]
pub async fn get_pvp_trend_global(state: State<'_, AppState>) -> AppResult<Vec<PvpTrendPoint>> {
    state.db.pvp_trend_global()
}

/// Periodos (YYYY-MM) con killmails de un personaje.
#[tauri::command]
pub async fn get_pvp_periods(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<String>> {
    state.db.pvp_periods(Some(character_id))
}

/// Periodos (YYYY-MM) con killmails, global.
#[tauri::command]
pub async fn get_pvp_periods_global(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    state.db.pvp_periods(None)
}

/// Actividad PvP de un mes (totales, por día y horas calientes UTC) de un personaje.
#[tauri::command]
pub async fn get_pvp_activity(
    character_id: i64,
    period: String,
    state: State<'_, AppState>,
) -> AppResult<PvpActivity> {
    state.db.pvp_activity(Some(character_id), &period)
}

/// Actividad PvP de un mes, global.
#[tauri::command]
pub async fn get_pvp_activity_global(
    period: String,
    state: State<'_, AppState>,
) -> AppResult<PvpActivity> {
    state.db.pvp_activity(None, &period)
}

/// Devuelve las stats PvP del personaje, con nombres de naves/sistemas resueltos.
#[tauri::command]
pub async fn get_pvp_stats(character_id: i64, state: State<'_, AppState>) -> AppResult<PvpStats> {
    let mut stats = state.db.pvp_stats(character_id)?;

    // Reunimos todos los ids a resolver: top naves, top sistemas y las filas recientes.
    let mut ids: HashSet<i64> = HashSet::new();
    for nc in stats.top_ships.iter().chain(stats.top_systems.iter()) {
        ids.insert(nc.id);
    }
    for r in &stats.recent {
        if let Some(s) = r.ship_type_id {
            ids.insert(s);
        }
        if let Some(s) = r.victim_ship_id {
            ids.insert(s);
        }
        if let Some(s) = r.system_id {
            ids.insert(s);
        }
    }

    let id_vec: Vec<i64> = ids.into_iter().collect();
    if let Ok(names) = state.esi.resolve_names(&id_vec).await {
        for nc in stats
            .top_ships
            .iter_mut()
            .chain(stats.top_systems.iter_mut())
        {
            nc.name = names.get(&nc.id).cloned();
        }
        for r in stats.recent.iter_mut() {
            r.ship_name = r.ship_type_id.and_then(|s| names.get(&s).cloned());
            r.victim_ship_name = r.victim_ship_id.and_then(|s| names.get(&s).cloned());
            r.system_name = r.system_id.and_then(|s| names.get(&s).cloned());
        }
    }

    let top = state.db.top_kills(character_id, 5)?;
    enrich_pvp(&state, &mut stats, top).await;
    Ok(stats)
}

/// Rellena región de top sistemas y la nave víctima de los top kills (desde caché).
async fn enrich_pvp(state: &AppState, stats: &mut PvpStats, mut top: Vec<TopKill>) {
    // Región de cada top sistema.
    let sys_ids: Vec<i64> = stats.top_systems.iter().map(|n| n.id).collect();
    let regions = state.esi.resolve_region_names(&state.db, &sys_ids).await;
    for n in stats.top_systems.iter_mut() {
        n.region = regions.get(&n.id).cloned();
    }

    // Nave de la víctima de cada top kill (desde el detalle cacheado, sin red).
    let mut ids: HashSet<i64> = HashSet::new();
    for tk in top.iter_mut() {
        let path = format!("/killmails/{}/{}/", tk.killmail_id, tk.hash);
        if let Ok(Some(c)) = state.db.get_cache(0, &path) {
            if let Ok(detail) = serde_json::from_str::<KillmailDetail>(&c.payload) {
                tk.victim_ship_id = detail.victim.ship_type_id;
            }
        }
        if let Some(s) = tk.victim_ship_id {
            ids.insert(s);
        }
        if let Some(s) = tk.system_id {
            ids.insert(s);
        }
    }
    if let Ok(names) = state
        .esi
        .resolve_names(&ids.into_iter().collect::<Vec<_>>())
        .await
    {
        for tk in top.iter_mut() {
            tk.victim_ship_name = tk.victim_ship_id.and_then(|s| names.get(&s).cloned());
            tk.system_name = tk.system_id.and_then(|s| names.get(&s).cloned());
        }
    }
    stats.top_expensive = top;
}

/// --- Batallas detectadas ---
#[derive(Debug, Serialize)]
pub struct Battle {
    pub system_id: i64,
    pub system_name: Option<String>,
    pub start: String, // RFC3339 del primer kill
    pub slug: String,  // YYYYMMDDHH00 para enlazar a zKillboard related
    pub kills: i64,
    pub losses: i64,
    pub isk: f64,
    pub total: i64,
}

/// Detecta batallas agrupando killmails por sistema + ventana temporal (gap < 60 min,
/// mínimo 8 killmails). Devuelve las mayores. character_id None = global.
#[tauri::command]
pub async fn get_battles(
    character_id: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<Vec<Battle>> {
    use std::collections::HashMap;
    const GAP_MIN: i64 = 60;
    const MIN_KM: usize = 8;

    let rows = state.db.killmails_for_battles(character_id)?;
    // Agrupar por sistema, parseando fechas.
    let mut by_sys: HashMap<i64, Vec<(chrono::DateTime<chrono::Utc>, f64, bool)>> = HashMap::new();
    for (sid, killed_at, isk, is_loss) in rows {
        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&killed_at) {
            by_sys
                .entry(sid)
                .or_default()
                .push((dt.with_timezone(&chrono::Utc), isk, is_loss));
        }
    }

    let mut battles: Vec<Battle> = Vec::new();
    for (sid, mut list) in by_sys {
        list.sort_by_key(|x| x.0);
        let mut cluster: Vec<(chrono::DateTime<chrono::Utc>, f64, bool)> = Vec::new();
        let mut last: Option<chrono::DateTime<chrono::Utc>> = None;
        let flush = |cluster: &Vec<(chrono::DateTime<chrono::Utc>, f64, bool)>,
                     out: &mut Vec<Battle>| {
            if cluster.len() >= MIN_KM {
                let start = cluster[0].0;
                out.push(Battle {
                    system_id: sid,
                    system_name: None,
                    start: start.to_rfc3339(),
                    slug: start.format("%Y%m%d%H00").to_string(),
                    kills: cluster.iter().filter(|c| !c.2).count() as i64,
                    losses: cluster.iter().filter(|c| c.2).count() as i64,
                    isk: cluster.iter().map(|c| c.1).sum(),
                    total: cluster.len() as i64,
                });
            }
        };
        for item in list {
            if let Some(prev) = last {
                if (item.0 - prev).num_minutes() > GAP_MIN {
                    flush(&cluster, &mut battles);
                    cluster.clear();
                }
            }
            last = Some(item.0);
            cluster.push(item);
        }
        flush(&cluster, &mut battles);
    }

    battles.sort_by(|a, b| b.total.cmp(&a.total));
    battles.truncate(40);

    // Resolver nombres de sistema.
    let ids: Vec<i64> = battles.iter().map(|b| b.system_id).collect();
    if let Ok(names) = state.esi.resolve_names(&ids).await {
        for b in battles.iter_mut() {
            b.system_name = names.get(&b.system_id).cloned();
        }
    }
    Ok(battles)
}

/// --- Rivales / Némesis ---
#[derive(serde::Deserialize)]
struct KmFull {
    victim: KmParty,
    #[serde(default)]
    attackers: Vec<KmParty>,
}
#[derive(serde::Deserialize)]
struct KmParty {
    #[serde(default)]
    character_id: Option<i64>,
    #[serde(default)]
    corporation_id: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct RivalEntry {
    pub id: i64,
    pub name: Option<String>,
    pub count: i64,
}

#[derive(Debug, Serialize, Default)]
pub struct Rivals {
    pub you_kill_chars: Vec<RivalEntry>,
    pub you_kill_corps: Vec<RivalEntry>,
    pub kills_you_chars: Vec<RivalEntry>,
    pub kills_you_corps: Vec<RivalEntry>,
}

fn top_entries(map: &std::collections::HashMap<i64, i64>, n: usize) -> Vec<RivalEntry> {
    let mut v: Vec<(i64, i64)> = map.iter().map(|(&k, &c)| (k, c)).collect();
    v.sort_by(|a, b| b.1.cmp(&a.1));
    v.truncate(n);
    v.into_iter()
        .map(|(id, count)| RivalEntry {
            id,
            name: None,
            count,
        })
        .collect()
}

/// Ranking de rivales del sujeto: a quién matas y quién te mata (por personaje y corp).
#[tauri::command]
pub async fn get_rivals(
    character_id: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<Rivals> {
    use std::collections::{HashMap, HashSet};

    let own: HashSet<i64> = state
        .db
        .list_characters()?
        .into_iter()
        .map(|c| c.character_id)
        .collect();

    let mut kill_char: HashMap<i64, i64> = HashMap::new();
    let mut kill_corp: HashMap<i64, i64> = HashMap::new();
    let mut loss_char: HashMap<i64, i64> = HashMap::new();
    let mut loss_corp: HashMap<i64, i64> = HashMap::new();

    for (is_loss, raw) in state.db.killmails_raw(character_id)? {
        let km: KmFull = match serde_json::from_str(&raw) {
            Ok(k) => k,
            Err(_) => continue,
        };
        if !is_loss {
            // Es un kill tuyo → la víctima es el rival.
            if let Some(c) = km.victim.character_id {
                if !own.contains(&c) {
                    *kill_char.entry(c).or_insert(0) += 1;
                }
            }
            if let Some(co) = km.victim.corporation_id {
                *kill_corp.entry(co).or_insert(0) += 1;
            }
        } else {
            // Es una pérdida tuya → los atacantes son los rivales (deduplicados por killmail).
            let mut seen_c: HashSet<i64> = HashSet::new();
            let mut seen_co: HashSet<i64> = HashSet::new();
            for a in &km.attackers {
                if let Some(c) = a.character_id {
                    if !own.contains(&c) && seen_c.insert(c) {
                        *loss_char.entry(c).or_insert(0) += 1;
                    }
                }
                if let Some(co) = a.corporation_id {
                    if seen_co.insert(co) {
                        *loss_corp.entry(co).or_insert(0) += 1;
                    }
                }
            }
        }
    }

    let mut rivals = Rivals {
        you_kill_chars: top_entries(&kill_char, 15),
        you_kill_corps: top_entries(&kill_corp, 15),
        kills_you_chars: top_entries(&loss_char, 15),
        kills_you_corps: top_entries(&loss_corp, 15),
    };

    // Resolver nombres de los ids del top (personajes + corps).
    let mut ids: HashSet<i64> = HashSet::new();
    for e in rivals
        .you_kill_chars
        .iter()
        .chain(rivals.you_kill_corps.iter())
        .chain(rivals.kills_you_chars.iter())
        .chain(rivals.kills_you_corps.iter())
    {
        ids.insert(e.id);
    }
    if let Ok(names) = state
        .esi
        .resolve_names(&ids.into_iter().collect::<Vec<_>>())
        .await
    {
        for e in rivals
            .you_kill_chars
            .iter_mut()
            .chain(rivals.you_kill_corps.iter_mut())
            .chain(rivals.kills_you_chars.iter_mut())
            .chain(rivals.kills_you_corps.iter_mut())
        {
            e.name = names.get(&e.id).cloned();
        }
    }

    // Sembrar el índice local de nombres con los rivales-PERSONAJE (tus enemigos recurrentes =
    // justo los que más salen en intel) → resolver pilotos del intel sin pegar a ESI.
    let seed: Vec<(i64, String)> = rivals
        .you_kill_chars
        .iter()
        .chain(rivals.kills_you_chars.iter())
        .filter_map(|e| e.name.clone().map(|n| (e.id, n)))
        .collect();
    state.db.name_cache_seed(&seed);

    Ok(rivals)
}

/// Página de killmails (con filtro y paginación), nombres resueltos.
#[derive(Debug, Serialize)]
pub struct KillmailPage {
    pub rows: Vec<crate::db::KillmailRow>,
    pub total: i64,
}

#[tauri::command]
pub async fn get_killmails(
    character_id: Option<i64>,
    kind: String,
    offset: i64,
    limit: i64,
    state: State<'_, AppState>,
) -> AppResult<KillmailPage> {
    let (mut rows, total) = state
        .db
        .killmails_page(character_id, &kind, offset, limit)?;

    let mut ids: HashSet<i64> = HashSet::new();
    for r in &rows {
        if let Some(s) = r.ship_type_id {
            ids.insert(s);
        }
        if let Some(s) = r.victim_ship_id {
            ids.insert(s);
        }
        if let Some(s) = r.system_id {
            ids.insert(s);
        }
    }
    if let Ok(names) = state
        .esi
        .resolve_names(&ids.into_iter().collect::<Vec<_>>())
        .await
    {
        for r in rows.iter_mut() {
            r.ship_name = r.ship_type_id.and_then(|s| names.get(&s).cloned());
            r.victim_ship_name = r.victim_ship_id.and_then(|s| names.get(&s).cloned());
            r.system_name = r.system_id.and_then(|s| names.get(&s).cloned());
        }
    }
    Ok(KillmailPage { rows, total })
}

/// Exporta los killmails del personaje a un CSV y devuelve el contenido (el front lo guarda).
#[tauri::command]
pub fn export_pvp_csv(character_id: i64, state: State<'_, AppState>) -> AppResult<String> {
    let rows = state.db.all_killmails(character_id)?;
    let mut out =
        String::from("killmail_id,tipo,ship_type_id,system_id,isk_value,killed_at,solo\n");
    for r in rows {
        out.push_str(&format!(
            "{},{},{},{},{},{},{}\n",
            r.killmail_id,
            if r.is_loss { "loss" } else { "kill" },
            r.ship_type_id.map(|v| v.to_string()).unwrap_or_default(),
            r.system_id.map(|v| v.to_string()).unwrap_or_default(),
            r.isk_value.map(|v| v.to_string()).unwrap_or_default(),
            r.killed_at.unwrap_or_default(),
            if r.solo { "1" } else { "0" },
        ));
    }
    Ok(out)
}

/// Obtiene un access token válido y comprueba que tenga el scope requerido.
async fn token_with_scope(
    state: &AppState,
    character_id: i64,
    scope: &str,
    feature_hint: &str,
) -> AppResult<String> {
    let valid = state
        .tokens
        .access_token(state.esi.http(), character_id)
        .await?;
    if !valid.claims.scp.iter().any(|s| s == scope) {
        return Err(AppError::OAuth(format!(
            "este personaje no concedió el scope necesario. Inicia sesión con la feature '{feature_hint}'."
        )));
    }
    Ok(valid.access_token)
}

#[derive(Debug, Serialize)]
pub struct WalletView {
    pub balance: f64,
    pub stats: WalletStats,
}

/// Sincroniza el journal de cartera del personaje (scope wallet).
#[tauri::command]
pub async fn sync_wallet(character_id: i64, state: State<'_, AppState>) -> AppResult<usize> {
    let token = token_with_scope(
        &state,
        character_id,
        "esi-wallet.read_character_wallet.v1",
        "Wallet",
    )
    .await?;
    let n = wallet::sync_journal(&state.esi, &state.db, character_id, &token, 50).await?;
    // Acumula también las transacciones (para Abyssals/Comercio fiables a largo plazo).
    let _ = wallet::sync_transactions(&state.esi, &state.db, character_id, &token).await;
    Ok(n)
}

/// Devuelve balance + estadísticas de cartera (income/expense/net/top ref_types/recientes).
#[tauri::command]
pub async fn get_wallet(character_id: i64, state: State<'_, AppState>) -> AppResult<WalletView> {
    let token = token_with_scope(
        &state,
        character_id,
        "esi-wallet.read_character_wallet.v1",
        "Wallet",
    )
    .await?;
    let balance = wallet::balance(&state.esi, &state.db, character_id, &token).await?;
    let stats = state.db.wallet_stats(character_id)?;
    Ok(WalletView { balance, stats })
}

/// Serie mensual de ingresos/gastos (para el scrub de Wallet) de un personaje.
#[tauri::command]
pub async fn get_wallet_trend(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<WalletTrendPoint>> {
    state.db.wallet_trend(Some(character_id))
}

/// Serie mensual de ingresos/gastos, global.
#[tauri::command]
pub async fn get_wallet_trend_global(
    state: State<'_, AppState>,
) -> AppResult<Vec<WalletTrendPoint>> {
    state.db.wallet_trend(None)
}

// ---- Serie temporal de wallet (histórico) para gráfica unificada estilo Ingresos PvE ----
#[derive(Debug, Serialize)]
pub struct WalletDay {
    pub date: String,
    pub income: f64,  // suma de amount > 0
    pub expense: f64, // suma de amount < 0 (negativo)
}
#[derive(Debug, Serialize)]
pub struct WalletCatDay {
    pub cat: String,
    pub date: String,
    pub net: f64,
}
#[derive(Debug, Serialize)]
pub struct WalletCharDay {
    pub character_id: i64,
    pub date: String,
    pub net: f64,
}
#[derive(Debug, Serialize)]
pub struct WalletSeries {
    pub daily: Vec<WalletDay>,
    pub by_cat: Vec<WalletCatDay>,
    pub by_char: Vec<WalletCharDay>,
}

fn build_wallet_series(state: &AppState, filter: Option<i64>) -> AppResult<WalletSeries> {
    use std::collections::HashMap;
    let rows = state.db.wallet_rows_full(filter)?;
    let mut daily: HashMap<String, (f64, f64)> = HashMap::new(); // date -> (income, expense)
    let mut cat_day: HashMap<(String, String), f64> = HashMap::new(); // (cat, date) -> net
    let mut char_day: HashMap<(i64, String), f64> = HashMap::new(); // (char, date) -> net
    for (date, ref_type, amount, cid) in rows {
        let day = date.get(0..10).unwrap_or(&date).to_string();
        let e = daily.entry(day.clone()).or_insert((0.0, 0.0));
        if amount >= 0.0 {
            e.0 += amount;
        } else {
            e.1 += amount;
        }
        let cat = crate::db::category_of(ref_type.as_deref().unwrap_or(""), amount).to_string();
        *cat_day.entry((cat, day.clone())).or_insert(0.0) += amount;
        *char_day.entry((cid, day)).or_insert(0.0) += amount;
    }
    let mut dvec: Vec<WalletDay> = daily
        .into_iter()
        .map(|(date, (income, expense))| WalletDay { date, income, expense })
        .collect();
    dvec.sort_by(|a, b| a.date.cmp(&b.date));
    let mut cvec: Vec<WalletCatDay> = cat_day
        .into_iter()
        .map(|((cat, date), net)| WalletCatDay { cat, date, net })
        .collect();
    cvec.sort_by(|a, b| a.date.cmp(&b.date));
    let mut hvec: Vec<WalletCharDay> = char_day
        .into_iter()
        .map(|((character_id, date), net)| WalletCharDay { character_id, date, net })
        .collect();
    hvec.sort_by(|a, b| a.date.cmp(&b.date));
    Ok(WalletSeries { daily: dvec, by_cat: cvec, by_char: hvec })
}

/// Serie temporal de wallet (histórico) de un personaje.
#[tauri::command]
pub async fn get_wallet_series(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<WalletSeries> {
    build_wallet_series(&state, Some(character_id))
}

/// Serie temporal de wallet (histórico), global.
#[tauri::command]
pub async fn get_wallet_series_global(state: State<'_, AppState>) -> AppResult<WalletSeries> {
    build_wallet_series(&state, None)
}

/// Devuelve resumen de skills: SP total, sin asignar, nº de skills y cola (con nombres).
/// Perfil de salto del personaje: niveles de las skills relevantes + naves de salto que posee.
/// JDC = Jump Drive Calibration (21611, rango), JFC = Jump Fuel Conservation (21610, fuel).
/// `owned` = type_ids distintos en sus assets (el frontend cruza con el catálogo de naves).
#[derive(Debug, Serialize)]
pub struct JumpProfile {
    pub jdc: i64,
    pub jfc: i64,
    pub owned: Vec<i64>,
}

#[tauri::command]
pub async fn get_jump_profile(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<JumpProfile> {
    // Skills (best-effort: si falta el scope, quedan en 0 y el usuario los ajusta a mano).
    let (mut jdc, mut jfc) = (0i64, 0i64);
    if let Ok(token) =
        token_with_scope(&state, character_id, "esi-skills.read_skills.v1", "Skills").await
    {
        if let Ok(s) = skills::skills(&state.esi, &state.db, character_id, &token).await {
            for sk in &s.skills {
                match sk.skill_id {
                    21611 => jdc = sk.active_skill_level,
                    21610 => jfc = sk.active_skill_level,
                    _ => {}
                }
            }
        }
    }
    // Naves que posee (best-effort: requiere scope de assets).
    let mut owned = Vec::new();
    if let Ok(token) =
        token_with_scope(&state, character_id, "esi-assets.read_assets.v1", "Assets").await
    {
        owned = assets::owned_type_ids(&state.esi, &state.db, character_id, &token)
            .await
            .unwrap_or_default();
    }
    Ok(JumpProfile { jdc, jfc, owned })
}

/// Fatiga de salto del personaje (timer azul). `jump_fatigue_expire_date` es cuándo expira
/// la fatiga actual; el frontend calcula los minutos restantes y estima el próximo salto.
#[derive(Debug, Serialize)]
pub struct FatigueInfo {
    pub jump_fatigue_expire_date: Option<String>,
    pub last_jump_date: Option<String>,
}

#[tauri::command]
pub async fn get_fatigue(character_id: i64, state: State<'_, AppState>) -> AppResult<FatigueInfo> {
    let token = token_with_scope(
        &state,
        character_id,
        "esi-characters.read_fatigue.v1",
        "Fatiga de salto",
    )
    .await?;
    #[derive(serde::Deserialize)]
    struct Raw {
        #[serde(default)]
        jump_fatigue_expire_date: Option<String>,
        #[serde(default)]
        last_jump_date: Option<String>,
    }
    let path = format!("/characters/{character_id}/fatigue/");
    match state
        .esi
        .get_cached::<Raw>(&state.db, character_id, &path, Some(&token))
        .await
    {
        Ok(r) => Ok(FatigueInfo {
            jump_fatigue_expire_date: r.jump_fatigue_expire_date,
            last_jump_date: r.last_jump_date,
        }),
        // Sin registro de fatiga (nunca ha saltado) = sin fatiga.
        Err(AppError::NotFound) => Ok(FatigueInfo {
            jump_fatigue_expire_date: None,
            last_jump_date: None,
        }),
        Err(e) => Err(e),
    }
}

/// F2 (invención) — niveles ENTRENADOS de una lista de skills del personaje (0 si no la tiene).
/// Lee la respuesta cacheada de /skills/ (mismo scope que la sección Skills). Usa el nivel
/// `active_skill_level` (el que aplica el juego: un alfa con la skill capada inventa con el activo).
#[tauri::command]
pub async fn get_skill_levels(
    character_id: i64,
    ids: Vec<i64>,
    state: State<'_, AppState>,
) -> AppResult<std::collections::HashMap<i64, i64>> {
    let token =
        token_with_scope(&state, character_id, "esi-skills.read_skills.v1", "Skills").await?;
    let resp = crate::esi::skills::skills(&state.esi, &state.db, character_id, &token).await?;
    let have: std::collections::HashMap<i64, i64> = resp
        .skills
        .iter()
        .map(|s| (s.skill_id, s.active_skill_level))
        .collect();
    Ok(ids
        .into_iter()
        .map(|id| (id, have.get(&id).copied().unwrap_or(0)))
        .collect())
}

/// F2 — niveles ACTIVOS de una lista de skills para TODOS los personajes con el scope de skills.
/// Para la leyenda «¿quién es tu mejor inventor?»: compara alts sin cambiar de sujeto.
#[derive(Debug, Clone, Serialize)]
pub struct CharSkillLevels {
    pub character_id: i64,
    pub name: String,
    pub levels: std::collections::HashMap<i64, i64>,
}

#[tauri::command]
pub async fn get_skill_levels_all(
    ids: Vec<i64>,
    state: State<'_, AppState>,
) -> AppResult<Vec<CharSkillLevels>> {
    let mut out = Vec::new();
    for c in state.db.list_characters()? {
        if !c.scopes.iter().any(|s| s == "esi-skills.read_skills.v1") {
            continue;
        }
        let token = match state.tokens.access_token(state.esi.http(), c.character_id).await {
            Ok(v) => v.access_token,
            Err(_) => continue, // sin token vivo no hay lectura: se omite, no se inventa un 0
        };
        let resp =
            match crate::esi::skills::skills(&state.esi, &state.db, c.character_id, &token).await {
                Ok(r) => r,
                Err(_) => continue,
            };
        let have: std::collections::HashMap<i64, i64> = resp
            .skills
            .iter()
            .map(|s| (s.skill_id, s.active_skill_level))
            .collect();
        out.push(CharSkillLevels {
            character_id: c.character_id,
            name: c.name.clone(),
            levels: ids
                .iter()
                .map(|id| (*id, have.get(id).copied().unwrap_or(0)))
                .collect(),
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn get_skills(character_id: i64, state: State<'_, AppState>) -> AppResult<SkillsSummary> {
    let token =
        token_with_scope(&state, character_id, "esi-skills.read_skills.v1", "Skills").await?;

    let s = skills::skills(&state.esi, &state.db, character_id, &token).await?;
    let mut queue = skills::skillqueue(&state.esi, &state.db, character_id, &token)
        .await
        .unwrap_or_default();

    // Resolvemos nombres de las skills de la cola.
    let ids: Vec<i64> = queue.iter().map(|q| q.skill_id).collect();
    if let Ok(names) = state.esi.resolve_names(&ids).await {
        for q in queue.iter_mut() {
            q.skill_name = names.get(&q.skill_id).cloned();
        }
    }

    Ok(SkillsSummary {
        total_sp: s.total_sp,
        unallocated_sp: s.unallocated_sp,
        skill_count: s.skills.len() as i64,
        queue,
    })
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct AttrView {
    pub charisma: i64,
    pub intelligence: i64,
    pub memory: i64,
    pub perception: i64,
    pub willpower: i64,
    pub bonus_remaps: Option<i64>,
    pub last_remap_date: Option<String>,
}
#[derive(Debug, Clone, serde::Serialize)]
pub struct ImplantView {
    pub type_id: i64,
    pub name: Option<String>,
}
#[derive(Debug, Clone, serde::Serialize)]
pub struct CharacterDetail {
    pub birthday: Option<String>,
    pub gender: Option<String>,
    pub security_status: Option<f64>,
    pub bio: Option<String>,
    pub attributes: Option<AttrView>,
    pub implants: Vec<ImplantView>,
    pub jump_clones: i64,
    pub clone_implants: i64,
    pub home_location_id: Option<i64>,
    // Logros oficiales (Cradle of War, público): puntuación + título equipado (UUID → nombre vía
    // character_titles.json en el front).
    pub achievement_score: Option<i64>,
    pub title_id: Option<String>,
}

/// Header rico del personaje: info pública + atributos + implantes + jump clones.
/// Best-effort: cada parte se omite si falta el scope o falla.
#[tauri::command]
pub async fn get_character_detail(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<CharacterDetail> {
    use crate::esi::character as ch;

    let public = ch::public_info(&state.esi, &state.db, character_id).await.ok();

    let valid = state
        .tokens
        .access_token(state.esi.http(), character_id)
        .await
        .ok();
    let has = |scope: &str| {
        valid
            .as_ref()
            .is_some_and(|v| v.claims.scp.iter().any(|s| s == scope))
    };
    let token = valid.as_ref().map(|v| v.access_token.clone()).unwrap_or_default();

    let attributes = if has("esi-skills.read_skills.v1") {
        ch::attributes(&state.esi, &state.db, character_id, &token)
            .await
            .ok()
            .map(|a| AttrView {
                charisma: a.charisma,
                intelligence: a.intelligence,
                memory: a.memory,
                perception: a.perception,
                willpower: a.willpower,
                bonus_remaps: a.bonus_remaps,
                last_remap_date: a.last_remap_date,
            })
    } else {
        None
    };

    let mut implant_ids: Vec<i64> = Vec::new();
    if has("esi-clones.read_implants.v1") {
        if let Ok(v) = ch::implants(&state.esi, &state.db, character_id, &token).await {
            implant_ids = v;
        }
    }

    let mut jump_clones = 0i64;
    let mut clone_implants = 0i64;
    let mut home_location_id = None;
    if has("esi-clones.read_clones.v1") {
        if let Ok(c) = ch::clones(&state.esi, &state.db, character_id, &token).await {
            jump_clones = c.jump_clones.len() as i64;
            clone_implants = c.jump_clones.iter().map(|j| j.implants.len() as i64).sum();
            home_location_id = c.home_location.and_then(|h| h.location_id);
        }
    }

    let mut implants: Vec<ImplantView> = implant_ids
        .iter()
        .map(|&type_id| ImplantView { type_id, name: None })
        .collect();
    if !implant_ids.is_empty() {
        if let Ok(names) = state.esi.resolve_names(&implant_ids).await {
            for im in implants.iter_mut() {
                im.name = names.get(&im.type_id).cloned();
            }
        }
    }

    Ok(CharacterDetail {
        birthday: public.as_ref().and_then(|p| p.birthday.clone()),
        gender: public.as_ref().and_then(|p| p.gender.clone()),
        security_status: public.as_ref().and_then(|p| p.security_status),
        bio: public.as_ref().and_then(|p| p.description.clone()),
        attributes,
        implants,
        jump_clones,
        clone_implants,
        home_location_id,
        achievement_score: public.as_ref().and_then(|p| p.achievement_score),
        title_id: public.as_ref().and_then(|p| p.character_title_id.clone()),
    })
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct FwCountsView {
    pub yesterday: i64,
    pub last_week: i64,
    pub total: i64,
}
#[derive(Debug, Clone, serde::Serialize)]
pub struct FactionalView {
    pub enlisted: bool,
    pub enlisted_on: Option<String>,
    pub faction_id: Option<i64>,
    pub current_rank: Option<i64>,
    pub highest_rank: Option<i64>,
    pub kills: FwCountsView,
    pub victory_points: FwCountsView,
}

/// Stats de Guerra de Facciones (PvE → Factional).
#[tauri::command]
pub async fn get_factional(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<FactionalView> {
    let token = token_with_scope(
        &state,
        character_id,
        "esi-characters.read_fw_stats.v1",
        "Factional",
    )
    .await?;
    let s = crate::esi::character::fw_stats(&state.esi, &state.db, character_id, &token).await?;
    let conv = |c: Option<crate::esi::character::FwCounts>| {
        let c = c.unwrap_or(crate::esi::character::FwCounts {
            yesterday: 0,
            last_week: 0,
            total: 0,
        });
        FwCountsView {
            yesterday: c.yesterday,
            last_week: c.last_week,
            total: c.total,
        }
    };
    Ok(FactionalView {
        enlisted: s.enlisted_on.is_some() || s.faction_id.is_some(),
        enlisted_on: s.enlisted_on,
        faction_id: s.faction_id,
        current_rank: s.current_rank,
        highest_rank: s.highest_rank,
        kills: conv(s.kills),
        victory_points: conv(s.victory_points),
    })
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct FilamentRow {
    pub name: String,
    pub count: i64,
    pub isk: f64,
}
#[derive(Debug, Clone, serde::Serialize)]
pub struct PaperLoc {
    pub location_name: String,
    pub system_id: i64,
    pub quantity: i64,
}
/// Inventario de un tipo de "papel" (loot redimible) por fuente: cantidad, valor y dónde.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PaperGroup {
    pub source: String, // "abyssal" | "crab"
    pub type_id: i64,
    pub name: String,
    pub qty: i64,
    pub value: f64,
    pub by_loc: Vec<PaperLoc>,
}
#[derive(Debug, Clone, serde::Serialize)]
pub struct AbyssalsView {
    pub runs_est: i64,
    pub isk_spent: f64,
    pub by_filament: Vec<FilamentRow>,
    // Inventario de "papeles" en assets: totales + desglose por fuente (abyssal/CRAB).
    pub papers_qty: i64,
    pub papers_value: f64,
    pub papers_by_loc: Vec<PaperLoc>,
    pub papers: Vec<PaperGroup>,
}

/// typeIDs de los items-loot redimibles ("papeles") que se venden en el mercado, por fuente.
/// (type_id, source, nombre de fallback).
const PAPER_TYPES: &[(i64, &str, &str)] = &[
    (48121, "abyssal", "Triglavian Survey Database"),
    (60459, "crab", "Rogue Drone Infestation Data"),
];

/// Abyssals ESTIMADO por compras de filamentos en las transacciones de wallet.
/// ESI no expone runs abisales; esto es una aproximación (1 filamento ≈ 1 run).
#[tauri::command]
pub async fn get_abyssals(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<AbyssalsView> {
    use std::collections::HashMap;
    let token = token_with_scope(
        &state,
        character_id,
        "esi-wallet.read_character_wallet.v1",
        "Wallet",
    )
    .await?;
    // Acumula las transacciones recientes y luego lee del histórico GUARDADO (crece con el tiempo).
    let _ = crate::esi::wallet::sync_transactions(&state.esi, &state.db, character_id, &token).await;
    let buys = state
        .db
        .transaction_buys_by_type(Some(character_id))
        .unwrap_or_default();

    let ids: Vec<i64> = buys.iter().map(|(tid, _, _)| *tid).collect();
    let names = state.esi.resolve_names(&ids).await.unwrap_or_default();

    // Agrega solo los items cuyo nombre contiene "Filament" (ESI devuelve nombres en inglés).
    let mut by: HashMap<String, (i64, f64)> = HashMap::new();
    for (tid, qty, isk) in &buys {
        let name = match names.get(tid) {
            Some(n) if n.to_lowercase().contains("filament") => n.clone(),
            _ => continue,
        };
        let e = by.entry(name).or_insert((0, 0.0));
        e.0 += *qty;
        e.1 += *isk;
    }

    let mut by_filament: Vec<FilamentRow> = by
        .into_iter()
        .map(|(name, (count, isk))| FilamentRow { name, count, isk })
        .collect();
    by_filament.sort_by(|a, b| b.count.cmp(&a.count));
    let runs_est = by_filament.iter().map(|f| f.count).sum();
    let isk_spent = by_filament.iter().map(|f| f.isk).sum();

    // Inventario de "papeles" (loot redimible) por fuente, leyendo los assets del personaje.
    let prices = state.db.prices_map().unwrap_or_default();
    let mut papers: Vec<PaperGroup> = Vec::new();
    let mut papers_qty = 0i64;
    let mut papers_value = 0f64;
    let mut papers_by_loc: Vec<PaperLoc> = Vec::new();
    if let Ok(atok) =
        token_with_scope(&state, character_id, "esi-assets.read_assets.v1", "Assets").await
    {
        let all_tokens = structure_tokens(&state).await;
        if let Ok(rows) =
            assets::detail(&state.esi, &state.db, character_id, &atok, &all_tokens).await
        {
            for &(tid, source, name) in PAPER_TYPES {
                let mut qty = 0i64;
                let mut by: HashMap<(String, i64), i64> = HashMap::new();
                for r in &rows {
                    if r.type_id == tid {
                        qty += r.quantity;
                        *by.entry((r.location_name.clone(), r.system_id)).or_insert(0) += r.quantity;
                    }
                }
                let mut by_loc: Vec<PaperLoc> = by
                    .into_iter()
                    .map(|((location_name, system_id), quantity)| PaperLoc {
                        location_name,
                        system_id,
                        quantity,
                    })
                    .collect();
                by_loc.sort_by(|a, b| b.quantity.cmp(&a.quantity));
                let value = qty as f64 * prices.get(&tid).copied().unwrap_or(0.0);
                papers_qty += qty;
                papers_value += value;
                papers_by_loc.extend(by_loc.iter().cloned());
                papers.push(PaperGroup {
                    source: source.to_string(),
                    type_id: tid,
                    name: name.to_string(),
                    qty,
                    value,
                    by_loc,
                });
            }
            papers_by_loc.sort_by(|a, b| b.quantity.cmp(&a.quantity));
        }
    }
    // Snapshot diario por typeID (acumula histórico: los assets no tienen fecha → foto del stock).
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    for g in &papers {
        let _ = state
            .db
            .insert_paper_snapshot(character_id, &today, g.type_id, g.qty, g.value);
    }

    Ok(AbyssalsView {
        runs_est,
        isk_spent,
        by_filament,
        papers_qty,
        papers_value,
        papers_by_loc,
        papers,
    })
}

/// Un punto de la serie de valor de papeles (por día y fuente) para la gráfica.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PaperDay {
    pub date: String,
    pub source: String,
    pub value: f64,
}
#[derive(Debug, Clone, serde::Serialize)]
pub struct PaperSeries {
    pub daily: Vec<PaperDay>,
}

fn source_of(type_id: i64) -> String {
    PAPER_TYPES
        .iter()
        .find(|t| t.0 == type_id)
        .map(|t| t.1.to_string())
        .unwrap_or_else(|| type_id.to_string())
}
/// Convierte los snapshots de stock en una serie ACUMULADA de "papeles ganados" (estilo wallet):
/// por cada typeID, recorre las fechas y suma SOLO los incrementos de unidades respecto a la lectura
/// anterior (las ventas no restan; bajadas de stock se ignoran). El valor de cada punto = unidades
/// acumuladas × precio de ese día (último precio conocido si ese día no había stock).
fn paper_days(pts: Vec<crate::db::PaperPoint>) -> Vec<PaperDay> {
    use std::collections::HashMap;
    let mut by_type: HashMap<i64, Vec<crate::db::PaperPoint>> = HashMap::new();
    for p in pts {
        by_type.entry(p.type_id).or_default().push(p);
    }
    let mut out: Vec<PaperDay> = Vec::new();
    for (tid, mut points) in by_type {
        points.sort_by(|a, b| a.date.cmp(&b.date));
        let source = source_of(tid);
        let mut prev_qty = 0i64;
        let mut cum_units = 0i64;
        let mut last_price = 0f64;
        for p in points {
            let price = if p.qty > 0 {
                p.value / p.qty as f64
            } else {
                last_price
            };
            if p.qty > 0 {
                last_price = price;
            }
            cum_units += (p.qty - prev_qty).max(0);
            prev_qty = p.qty;
            out.push(PaperDay {
                date: p.date,
                source: source.clone(),
                value: cum_units as f64 * price,
            });
        }
    }
    out.sort_by(|a, b| a.date.cmp(&b.date));
    out
}

/// Serie histórica del VALOR ESTIMADO de papeles (snapshot diario del inventario), por fuente.
#[tauri::command]
pub async fn get_paper_series(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<PaperSeries> {
    let pts = state.db.paper_history(character_id).unwrap_or_default();
    Ok(PaperSeries {
        daily: paper_days(pts),
    })
}
#[tauri::command]
pub async fn get_paper_series_global(state: State<'_, AppState>) -> AppResult<PaperSeries> {
    let pts = state.db.paper_history_global().unwrap_or_default();
    Ok(PaperSeries {
        daily: paper_days(pts),
    })
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ContactView {
    pub id: i64,
    pub name: Option<String>,
    pub kind: String, // character / corporation / alliance / faction
    pub standing: f64,
    pub blocked: bool,
    pub watched: bool,
}

/// Contactos personales con standing + nombre resuelto (grupo Personaje).
#[tauri::command]
pub async fn get_contacts(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<ContactView>> {
    use std::collections::HashSet;
    let token = token_with_scope(
        &state,
        character_id,
        "esi-characters.read_contacts.v1",
        "Contactos",
    )
    .await?;
    let cs = crate::esi::character::contacts(&state.esi, &state.db, character_id, &token)
        .await
        .unwrap_or_default();
    let ids: Vec<i64> = cs
        .iter()
        .map(|c| c.contact_id)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let names = state.esi.resolve_names(&ids).await.unwrap_or_default();
    let mut out: Vec<ContactView> = cs
        .iter()
        .map(|c| ContactView {
            id: c.contact_id,
            name: names.get(&c.contact_id).cloned(),
            kind: c.contact_type.clone().unwrap_or_default(),
            standing: c.standing,
            blocked: c.is_blocked.unwrap_or(false),
            watched: c.is_watched.unwrap_or(false),
        })
        .collect();
    out.sort_by(|a, b| b.standing.partial_cmp(&a.standing).unwrap_or(std::cmp::Ordering::Equal));
    Ok(out)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct StandingView {
    pub id: i64,
    pub name: Option<String>,
    pub kind: String, // agent / npc_corp / faction
    pub standing: f64,
}

/// Standings con NPC (facciones/corps/agentes) con nombre resuelto.
#[tauri::command]
pub async fn get_standings(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<StandingView>> {
    use std::collections::HashSet;
    let token = token_with_scope(
        &state,
        character_id,
        "esi-characters.read_standings.v1",
        "Standings",
    )
    .await?;
    let ss = crate::esi::character::standings(&state.esi, &state.db, character_id, &token)
        .await
        .unwrap_or_default();
    let ids: Vec<i64> = ss
        .iter()
        .map(|s| s.from_id)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let names = state.esi.resolve_names(&ids).await.unwrap_or_default();
    let mut out: Vec<StandingView> = ss
        .iter()
        .map(|s| StandingView {
            id: s.from_id,
            name: names.get(&s.from_id).cloned(),
            kind: s.from_type.clone().unwrap_or_default(),
            standing: s.standing,
        })
        .collect();
    out.sort_by(|a, b| b.standing.partial_cmp(&a.standing).unwrap_or(std::cmp::Ordering::Equal));
    Ok(out)
}

/// PvP GLOBAL: agregado de todos los personajes (deduplicado por killmail).
#[tauri::command]
pub async fn get_pvp_stats_global(state: State<'_, AppState>) -> AppResult<PvpStats> {
    let mut stats = state.db.pvp_stats_global()?;
    let mut ids: HashSet<i64> = HashSet::new();
    for nc in stats.top_ships.iter().chain(stats.top_systems.iter()) {
        ids.insert(nc.id);
    }
    for r in &stats.recent {
        if let Some(s) = r.ship_type_id {
            ids.insert(s);
        }
        if let Some(s) = r.victim_ship_id {
            ids.insert(s);
        }
        if let Some(s) = r.system_id {
            ids.insert(s);
        }
    }
    if let Ok(names) = state
        .esi
        .resolve_names(&ids.into_iter().collect::<Vec<_>>())
        .await
    {
        for nc in stats
            .top_ships
            .iter_mut()
            .chain(stats.top_systems.iter_mut())
        {
            nc.name = names.get(&nc.id).cloned();
        }
        for r in stats.recent.iter_mut() {
            r.ship_name = r.ship_type_id.and_then(|s| names.get(&s).cloned());
            r.victim_ship_name = r.victim_ship_id.and_then(|s| names.get(&s).cloned());
            r.system_name = r.system_id.and_then(|s| names.get(&s).cloned());
        }
    }

    let top = state.db.top_kills_global(5)?;
    enrich_pvp(&state, &mut stats, top).await;
    Ok(stats)
}

/// Wallet GLOBAL: stats agregadas (DB) + balance sumado en vivo de todos los personajes.
#[tauri::command]
pub async fn get_wallet_global(state: State<'_, AppState>) -> AppResult<WalletView> {
    let stats = state.db.wallet_stats_global()?;
    let mut balance = 0.0;
    for c in state.db.list_characters()? {
        if !c
            .scopes
            .iter()
            .any(|s| s == "esi-wallet.read_character_wallet.v1")
        {
            continue;
        }
        if let Ok(valid) = state
            .tokens
            .access_token(state.esi.http(), c.character_id)
            .await
        {
            if let Ok(b) =
                wallet::balance(&state.esi, &state.db, c.character_id, &valid.access_token).await
            {
                balance += b;
            }
        }
    }
    Ok(WalletView { balance, stats })
}

/// Qué entrena cada personaje ahora mismo.
#[derive(Debug, Serialize)]
pub struct CharTraining {
    pub character_id: i64,
    pub character_name: String,
    pub skill_id: Option<i64>,
    pub skill_name: Option<String>,
    pub finished_level: i64,
    pub finish_date: Option<String>,
}

/// Skills GLOBAL: totales sumados + qué entrena cada personaje (en vez de cola fusionada).
#[derive(Debug, Serialize)]
pub struct GlobalSkills {
    pub total_sp: i64,
    pub unallocated_sp: i64,
    pub skill_count: i64,
    pub character_count: i64,
    pub training: Vec<CharTraining>,
}

#[tauri::command]
pub async fn get_skills_global(state: State<'_, AppState>) -> AppResult<GlobalSkills> {
    let mut total_sp = 0i64;
    let mut unallocated_sp = 0i64;
    let mut skill_count = 0i64;
    let mut character_count = 0i64;
    let mut training: Vec<CharTraining> = Vec::new();

    for c in state.db.list_characters()? {
        if !c.scopes.iter().any(|s| s == "esi-skills.read_skills.v1") {
            continue;
        }
        let valid = match state
            .tokens
            .access_token(state.esi.http(), c.character_id)
            .await
        {
            Ok(v) => v,
            Err(_) => continue,
        };
        character_count += 1;

        if let Ok(s) =
            skills::skills(&state.esi, &state.db, c.character_id, &valid.access_token).await
        {
            total_sp += s.total_sp;
            unallocated_sp += s.unallocated_sp;
            skill_count += s.skills.len() as i64;
        }

        // Skill que entrena ahora = la de menor fecha de fin (la próxima en terminar).
        let current =
            skills::skillqueue(&state.esi, &state.db, c.character_id, &valid.access_token)
                .await
                .ok()
                .and_then(|q| {
                    q.into_iter()
                        .filter(|i| i.finish_date.is_some())
                        .min_by(|a, b| a.finish_date.cmp(&b.finish_date))
                });

        training.push(CharTraining {
            character_id: c.character_id,
            character_name: c.name.clone(),
            skill_id: current.as_ref().map(|i| i.skill_id),
            skill_name: None,
            finished_level: current.as_ref().map(|i| i.finished_level).unwrap_or(0),
            finish_date: current.as_ref().and_then(|i| i.finish_date.clone()),
        });
    }

    // Resolver nombres de las skills que se entrenan.
    let ids: Vec<i64> = training.iter().filter_map(|t| t.skill_id).collect();
    if let Ok(names) = state.esi.resolve_names(&ids).await {
        for t in training.iter_mut() {
            t.skill_name = t.skill_id.and_then(|s| names.get(&s).cloned());
        }
    }

    Ok(GlobalSkills {
        total_sp,
        unallocated_sp,
        skill_count,
        character_count,
        training,
    })
}

/// Resumen de assets con nombres de tipo resueltos en el top.
#[tauri::command]
pub async fn get_assets(character_id: i64, state: State<'_, AppState>) -> AppResult<AssetsSummary> {
    let token = token_with_scope(
        &state,
        character_id,
        "esi-assets.read_assets.v1",
        "Assets / industria",
    )
    .await?;
    let mut summary = assets::summary(&state.esi, &state.db, character_id, &token).await?;
    let ids: Vec<i64> = summary
        .top_types
        .iter()
        .map(|n| n.id)
        .chain(summary.top_value.iter().map(|t| t.type_id))
        .collect();
    if let Ok(names) = state.esi.resolve_names(&ids).await {
        for n in summary.top_types.iter_mut() {
            n.name = names.get(&n.id).cloned();
        }
        for t in summary.top_value.iter_mut() {
            t.name = names.get(&t.type_id).cloned();
        }
    }
    Ok(summary)
}

/// Vista de detalle de un asset (un tipo en un sistema) con nombres resueltos.
#[derive(Debug, Serialize)]
pub struct AssetDetailView {
    pub type_id: i64,
    pub type_name: Option<String>,
    pub quantity: i64,
    pub system_id: i64,
    pub system_name: Option<String>,
    /// Ubicación RAÍZ del stack (id de estación/estructura/sistema). Casa con
    /// `facility.structure_id` → el BOM puede decir qué stock ya está EN tu instalación.
    pub location_id: i64,
    pub location_name: String,
    pub container: Option<String>,
    pub container_id: i64,
    pub container_type_id: i64,
    pub slot: String,
    pub category: String,
    /// `true` = montado; `false` = empaquetado. Decide QUÉ VOLUMEN ocupa: sin esto, el inventario
    /// disperso sumaría el reempaquetado de cosas que están montadas y diría que caben.
    pub assembled: bool,
}

/// Resuelve nombres de tipo/sistema y categoría (cacheada) para una lista de filas de detalle.
async fn resolve_asset_detail(
    esi: &EsiClient,
    db: &Db,
    rows: Vec<crate::esi::assets::AssetDetailRow>,
) -> AppResult<Vec<AssetDetailView>> {
    let mut ids: HashSet<i64> = HashSet::new();
    let mut type_ids: HashSet<i64> = HashSet::new();
    for r in &rows {
        ids.insert(r.type_id);
        type_ids.insert(r.type_id);
        if r.system_id != 0 {
            ids.insert(r.system_id);
        }
    }
    let names = esi
        .resolve_names(&ids.into_iter().collect::<Vec<_>>())
        .await
        .unwrap_or_default();
    let mut cats: std::collections::HashMap<i64, String> = std::collections::HashMap::new();
    for tid in type_ids {
        cats.insert(tid, crate::esi::assets::resolve_category(esi, db, tid).await);
    }
    Ok(rows
        .into_iter()
        .map(|r| AssetDetailView {
            type_id: r.type_id,
            type_name: names.get(&r.type_id).cloned(),
            quantity: r.quantity,
            system_id: r.system_id,
            system_name: if r.system_id != 0 {
                names.get(&r.system_id).cloned()
            } else {
                None
            },
            location_id: r.location_id,
            location_name: r.location_name,
            container: r.container,
            container_id: r.container_id,
            container_type_id: r.container_type_id,
            slot: r.slot,
            category: cats.get(&r.type_id).cloned().unwrap_or_else(|| "Otros".to_string()),
            assembled: r.assembled,
        })
        .collect())
}

/// Lista detallada de assets de un personaje (para el buscador).
#[tauri::command]
pub async fn get_assets_detail(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<AssetDetailView>> {
    let token = token_with_scope(
        &state,
        character_id,
        "esi-assets.read_assets.v1",
        "Assets / industria",
    )
    .await?;
    let all_tokens = structure_tokens(&state).await;
    let rows = assets::detail(&state.esi, &state.db, character_id, &token, &all_tokens).await?;
    resolve_asset_detail(&state.esi, &state.db, rows).await
}

/// Access tokens de todos los pjs con scope de estructuras. Para resolver estructuras de jugador
/// "entre personajes": si el dueño de unos assets no tiene acceso a la citadel, otro alt puede.
async fn structure_tokens(state: &AppState) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(chars) = state.db.list_characters() {
        for c in chars {
            if c
                .scopes
                .iter()
                .any(|s| s == "esi-universe.read_structures.v1")
            {
                if let Ok(v) = state
                    .tokens
                    .access_token(state.esi.http(), c.character_id)
                    .await
                {
                    out.push(v.access_token);
                }
            }
        }
    }
    out
}

// ---- Gestor de fiteos local (importación EFT) ----

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct FitModule {
    pub type_id: i64,
    pub name: String,
    pub qty: i64,
    pub fitted: bool, // true = módulo en slot; false = drone/carga (línea con xN)
}

#[derive(Debug, serde::Serialize)]
pub struct FitView {
    pub id: i64,
    pub name: String,
    pub ship_type_id: i64,
    pub ship_name: String,
    pub modules: Vec<FitModule>,
    pub created_at: String,
}

/// Parsea un bloque EFT: devuelve (nave, nombre_fit, [(módulo, cantidad, fiteado)]).
/// EFT: 1ª línea `[Nave, Nombre]`; luego módulos (líneas `xN` = drones/carga; `Mod, Carga` = con carga).
fn parse_eft(eft: &str) -> Option<(String, String, Vec<(String, i64, bool)>)> {
    let mut lines = eft.lines();
    let header = lines.by_ref().map(|l| l.trim()).find(|l| !l.is_empty())?;
    let inner = header.strip_prefix('[')?.strip_suffix(']')?;
    let mut it = inner.splitn(2, ',');
    let ship = it.next()?.trim().to_string();
    let fit_name = it.next().unwrap_or("Fit").trim().to_string();
    if ship.is_empty() {
        return None;
    }
    let mut mods: Vec<(String, i64, bool)> = Vec::new();
    for l in lines {
        let l = l.trim();
        if l.is_empty() || l.starts_with('[') {
            continue; // separadores o "[Empty ... slot]"
        }
        // ¿cantidad al final " xN"? (drones/carga)
        let (namepart, qty, fitted) = match l.rfind(" x") {
            Some(idx) => {
                let num = l[idx + 2..].trim();
                match num.parse::<i64>() {
                    Ok(n) => (l[..idx].trim().to_string(), n, false),
                    Err(_) => (l.to_string(), 1, true),
                }
            }
            None => (l.to_string(), 1, true),
        };
        // módulo con carga: "Gun, Ammo" → nos quedamos con el módulo
        let name = namepart
            .split(',')
            .next()
            .unwrap_or(&namepart)
            .trim()
            .to_string();
        if !name.is_empty() {
            mods.push((name, qty, fitted));
        }
    }
    Some((ship, fit_name, mods))
}

/// Guarda un fiteo a partir de un bloque EFT pegado (resuelve type_ids vía ESI público).
#[tauri::command]
pub async fn save_fit(eft: String, state: State<'_, AppState>) -> AppResult<FitView> {
    let (ship, fit_name, mods) = parse_eft(&eft)
        .ok_or_else(|| AppError::Other("EFT no válido (falta la cabecera [Nave, Nombre]).".into()))?;
    // Resolver nombres → type_id (nave + módulos).
    let mut names: Vec<String> = vec![ship.clone()];
    names.extend(mods.iter().map(|(n, _, _)| n.clone()));
    let idmap = state.esi.type_ids(&names).await.unwrap_or_default();
    let ship_type_id = idmap.get(&ship).copied().unwrap_or(0);
    // Agregar módulos iguales (mismo nombre + tipo de slot).
    let mut agg: std::collections::HashMap<(String, bool), i64> = std::collections::HashMap::new();
    for (n, q, f) in &mods {
        *agg.entry((n.clone(), *f)).or_insert(0) += *q;
    }
    let modules: Vec<FitModule> = agg
        .into_iter()
        .map(|((name, fitted), qty)| FitModule {
            type_id: idmap.get(&name).copied().unwrap_or(0),
            name,
            qty,
            fitted,
        })
        .collect();
    let modules_json = serde_json::to_string(&modules)?;
    let id = state
        .db
        .fit_insert(&fit_name, ship_type_id, &ship, &eft, &modules_json)?;
    Ok(FitView {
        id,
        name: fit_name,
        ship_type_id,
        ship_name: ship,
        modules,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

/// Lista los fiteos guardados (más recientes primero).
#[tauri::command]
pub fn list_fits(state: State<'_, AppState>) -> AppResult<Vec<FitView>> {
    let rows = state.db.fit_list()?;
    Ok(rows
        .into_iter()
        .map(|r| FitView {
            id: r.id,
            name: r.name,
            ship_type_id: r.ship_type_id,
            ship_name: r.ship_name,
            modules: serde_json::from_str(&r.modules).unwrap_or_default(),
            created_at: r.created_at,
        })
        .collect())
}

/// Borra un fiteo guardado por id.
#[tauri::command]
pub fn delete_fit(id: i64, state: State<'_, AppState>) -> AppResult<()> {
    state.db.fit_delete(id)
}

/// Importa los fittings guardados en el juego del personaje (ESI). Evita duplicados por
/// (nombre, nave). Devuelve los recién importados.
#[tauri::command]
pub async fn import_fittings(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<FitView>> {
    let token = token_with_scope(
        &state,
        character_id,
        "esi-fittings.read_fittings.v1",
        "Fittings",
    )
    .await?;
    #[derive(serde::Deserialize)]
    struct EsiItem {
        type_id: i64,
        #[serde(default)]
        flag: String,
        #[serde(default)]
        quantity: i64,
    }
    #[derive(serde::Deserialize)]
    struct EsiFit {
        name: String,
        ship_type_id: i64,
        #[serde(default)]
        items: Vec<EsiItem>,
    }
    let path = format!("/characters/{character_id}/fittings/");
    let fittings: Vec<EsiFit> = state
        .esi
        .get_cached(&state.db, character_id, &path, Some(&token))
        .await?;
    // Resolver nombres (naves + módulos).
    let mut ids: HashSet<i64> = HashSet::new();
    for f in &fittings {
        ids.insert(f.ship_type_id);
        for it in &f.items {
            ids.insert(it.type_id);
        }
    }
    let names = state
        .esi
        .resolve_names(&ids.into_iter().collect::<Vec<_>>())
        .await
        .unwrap_or_default();
    // Evitar duplicados con lo ya guardado.
    let existing: HashSet<(String, i64)> = state
        .db
        .fit_list()?
        .into_iter()
        .map(|r| (r.name, r.ship_type_id))
        .collect();
    let is_slot = |fl: &str| {
        fl.starts_with("HiSlot")
            || fl.starts_with("MedSlot")
            || fl.starts_with("LoSlot")
            || fl.starts_with("RigSlot")
            || fl.starts_with("SubSystem")
    };
    let mut out = Vec::new();
    for f in fittings {
        if existing.contains(&(f.name.clone(), f.ship_type_id)) {
            continue;
        }
        let modules: Vec<FitModule> = f
            .items
            .iter()
            .map(|it| FitModule {
                type_id: it.type_id,
                name: names.get(&it.type_id).cloned().unwrap_or_default(),
                qty: it.quantity.max(1),
                fitted: is_slot(&it.flag),
            })
            .collect();
        let modules_json = serde_json::to_string(&modules)?;
        let ship_name = names.get(&f.ship_type_id).cloned().unwrap_or_default();
        let id = state
            .db
            .fit_insert(&f.name, f.ship_type_id, &ship_name, "", &modules_json)?;
        out.push(FitView {
            id,
            name: f.name,
            ship_type_id: f.ship_type_id,
            ship_name,
            modules,
            created_at: chrono::Utc::now().to_rfc3339(),
        });
    }
    Ok(out)
}

/// Conexión de wormhole pública de eve-scout (Thera/Turnur ↔ k-space). Para la capa del mapa.
#[derive(Debug, serde::Serialize)]
pub struct WhConn {
    pub system_id: i64, // sistema k-space conectado (lado "in")
    pub system_name: String,
    pub hub: String, // "Thera" o "Turnur" (lado "out")
    pub wh_type: String,
    pub max_ship_size: String,
    pub remaining_hours: i64,
}

/// Trae las conexiones públicas de Thera/Turnur de eve-scout (api.eve-scout.com). Público, sin token.
#[tauri::command]
pub async fn get_thera_connections(state: State<'_, AppState>) -> AppResult<Vec<WhConn>> {
    #[derive(serde::Deserialize)]
    struct Sig {
        #[serde(default)]
        in_system_id: i64,
        #[serde(default)]
        in_system_name: String,
        #[serde(default)]
        out_system_name: String,
        #[serde(default)]
        wh_type: Option<String>,
        #[serde(default)]
        max_ship_size: Option<String>,
        #[serde(default)]
        remaining_hours: Option<f64>,
    }
    let resp = state
        .esi
        .http()
        .get("https://api.eve-scout.com/v2/public/signatures")
        .header("Accept", "application/json")
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(AppError::Other(format!("eve-scout HTTP {}", resp.status())));
    }
    let body = resp.text().await?;
    let sigs: Vec<Sig> = serde_json::from_str(&body)?;
    let out: Vec<WhConn> = sigs
        .into_iter()
        .filter(|s| s.in_system_id != 0)
        .map(|s| WhConn {
            system_id: s.in_system_id,
            system_name: s.in_system_name,
            hub: s.out_system_name,
            wh_type: s.wh_type.unwrap_or_default(),
            max_ship_size: s.max_ship_size.unwrap_or_default(),
            remaining_hours: s.remaining_hours.unwrap_or(0.0).round() as i64,
        })
        .collect();
    Ok(out)
}

// ---- Intel en vivo (lectura de los logs de chat del juego) ----
// Read-only sobre los .txt de Documents\EVE\logs\Chatlogs\ (UTF-16LE). El matching de sistema,
// proximidad y alertas se hacen en el frontend (tiene neweden.json + Dijkstra).

/// Decodifica bytes UTF-16LE (salta el BOM si está) a String (lossy ante bytes sueltos).
fn decode_utf16le(bytes: &[u8]) -> String {
    let start = if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE {
        2
    } else {
        0
    };
    let u16s: Vec<u16> = bytes[start..]
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
    String::from_utf16_lossy(&u16s)
}

/// Lee un archivo de audio del disco (para el sonido de alerta personalizado). Best-effort.
#[tauri::command]
pub fn read_audio_file(path: String) -> AppResult<Vec<u8>> {
    std::fs::read(&path).map_err(|e| AppError::Other(format!("no se pudo leer el audio: {e}")))
}

/// Dónde guarda EVE sus logs, por plataforma. Devuelve **la primera carpeta que EXISTE de verdad**;
/// si ninguna, la canónica de la plataforma para que el campo no salga vacío en una instalación
/// nueva donde EVE aún no ha arrancado.
///
/// Comprobar la existencia y no limitarse a construir la ruta es lo que hace esto útil: quien haya
/// movido su carpeta Documents recibía antes una ruta inventada con toda la seguridad del mundo.
///
/// **Windows**: `%USERPROFILE%\Documents\EVE\logs\<sub>`.
/// **macOS**: el cliente nativo escribe en `~/Documents/EVE/logs/<sub>`.
/// **Linux**: EVE va por Wine/Proton, así que los logs viven DENTRO del prefijo y no hay una sola
/// ruta buena — se prueban las de Wine, Steam Proton (appid 8500) y Lutris. Si no acierta ninguna,
/// el usuario elige la carpeta a mano, que es algo que la app ya sabe hacer.
/// Raíces de instalación de Steam conocidas (la carpeta que contiene `steamapps`).
#[cfg(not(target_os = "windows"))]
fn steam_roots() -> Vec<std::path::PathBuf> {
    let mut v = Vec::new();
    if let Ok(home) = std::env::var("HOME") {
        let home = std::path::Path::new(&home);
        for base in [
            ".steam/steam",
            ".local/share/Steam",
            ".var/app/com.valvesoftware.Steam/.local/share/Steam", // Flatpak
        ] {
            v.push(home.join(base));
        }
    }
    v
}

#[cfg(target_os = "windows")]
fn steam_roots() -> Vec<std::path::PathBuf> {
    vec![
        std::path::PathBuf::from("C:\\Program Files (x86)\\Steam"),
        std::path::PathBuf::from("C:\\Steam"),
    ]
}

/// ★ BIBLIOTECAS DE STEAM DECLARADAS, incluidas las de OTROS DISCOS.
///
/// Esta es la pieza que faltaba y por la que a un tester no se le encontraba EVE (2026-08-18): su
/// juego vivía en `/mnt/<disco>/SteamLibrary/…`, una biblioteca secundaria. Koru solo miraba las
/// rutas por defecto, así que por muy bien que estuviera todo, no había forma de dar con ella.
///
/// **No se rastrea el disco ni se adivina**: Steam lleva la lista escrita en
/// `steamapps/libraryfolders.vdf`. Se leen las líneas `"path"  "/lo/que/sea"` con un parseo
/// deliberadamente tonto — un VDF completo sería una dependencia nueva para sacar un campo, y este
/// fichero lo escribe Steam siempre igual.
fn steam_libraries() -> Vec<std::path::PathBuf> {
    let mut libs: Vec<std::path::PathBuf> = Vec::new();
    for root in steam_roots() {
        if root.is_dir() && !libs.contains(&root) {
            libs.push(root.clone());
        }
        let vdf = root.join("steamapps").join("libraryfolders.vdf");
        let Ok(txt) = std::fs::read_to_string(&vdf) else {
            continue;
        };
        for linea in txt.lines() {
            let l = linea.trim();
            if !l.starts_with("\"path\"") {
                continue;
            }
            // `"path"		"/mnt/disco/SteamLibrary"` → nos quedamos con lo de las SEGUNDAS comillas.
            let trozos: Vec<&str> = l.split('"').collect();
            if trozos.len() >= 4 {
                let p = std::path::PathBuf::from(trozos[3].replace("\\\\", "\\"));
                if p.is_dir() && !libs.contains(&p) {
                    libs.push(p);
                }
            }
        }
    }
    libs
}

/// Una carpeta de logs candidata, con lo que la hace creíble.
#[derive(Debug, Serialize)]
pub struct LogDirCandidate {
    pub path: String,
    /// Cuántos `.txt` tiene dentro. **Es lo que decide**: una carpeta que existe pero está vacía no
    /// sirve de nada y ofrecerla sería mandar al usuario a un callejón.
    pub files: usize,
    /// De dónde salió: "Steam", "Wine", "Lutris", "Documentos"… para que se pueda reconocer la suya.
    pub source: String,
}

/// Busca la carpeta de logs de EVE (`Chatlogs` o `Gamelogs`) por todos los sitios conocidos.
///
/// Devuelve SOLO las que tienen ficheros dentro, ordenadas por cuántos: la que más tiene es casi
/// siempre la instalación que de verdad usa. Vacío = no se encontró nada, y quien llama debe decir
/// dónde se ha mirado en vez de dejarlo en blanco.
#[tauri::command]
pub fn find_eve_log_dirs(sub: String) -> AppResult<Vec<LogDirCandidate>> {
    let mut cands: Vec<(std::path::PathBuf, &'static str)> = Vec::new();

    // 1. Las bibliotecas de Steam (appid 8500 = EVE). Aquí entran los discos secundarios.
    for lib in steam_libraries() {
        cands.push((
            lib.join("steamapps/compatdata/8500/pfx/drive_c/users/steamuser/Documents/EVE/logs")
                .join(&sub),
            "Steam",
        ));
    }

    // 2. Lo de siempre: cliente nativo, Wine y Lutris.
    #[cfg(target_os = "windows")]
    {
        if let Ok(up) = std::env::var("USERPROFILE") {
            cands.push((
                std::path::Path::new(&up).join("Documents").join("EVE").join("logs").join(&sub),
                "Documentos",
            ));
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(home) = std::env::var("HOME") {
            let home = std::path::Path::new(&home);
            let user = std::env::var("USER").unwrap_or_else(|_| "user".into());
            cands.push((home.join("Documents/EVE/logs").join(&sub), "Documentos"));
            cands.push((
                home.join(".wine/drive_c/users").join(&user).join("Documents/EVE/logs").join(&sub),
                "Wine",
            ));
            cands.push((
                home.join("Games/eve-online/drive_c/users")
                    .join(&user)
                    .join("Documents/EVE/logs")
                    .join(&sub),
                "Lutris",
            ));
        }
    }

    let mut out: Vec<LogDirCandidate> = Vec::new();
    for (p, source) in cands {
        if !p.is_dir() {
            continue;
        }
        let files = std::fs::read_dir(&p)
            .map(|rd| {
                rd.flatten()
                    .filter(|e| e.file_name().to_string_lossy().ends_with(".txt"))
                    .count()
            })
            .unwrap_or(0);
        if files == 0 {
            continue; // existe pero no sirve
        }
        let path = p.to_string_lossy().into_owned();
        if out.iter().any(|c| c.path == path) {
            continue; // dos raíces de Steam pueden apuntar a la misma biblioteca
        }
        out.push(LogDirCandidate { path, files, source: source.to_string() });
    }
    // La que más ficheros tiene primero: es casi siempre la instalación viva.
    out.sort_by(|a, b| b.files.cmp(&a.files));
    Ok(out)
}

fn eve_log_dir(sub: &str) -> String {
    let mut cands: Vec<std::path::PathBuf> = Vec::new();

    // Los `#[cfg]` van sobre un BLOQUE y no sobre el `if let`: sobre bloque es inequívoco y no
    // depende de cómo trate rustc los atributos en expresiones. Aquí no se puede compilar Rust, así
    // que en lo que toca a las dos plataformas se elige siempre la forma aburrida.
    #[cfg(target_os = "windows")]
    {
        if let Ok(up) = std::env::var("USERPROFILE") {
            cands.push(
                std::path::Path::new(&up).join("Documents").join("EVE").join("logs").join(sub),
            );
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
    if let Ok(home) = std::env::var("HOME") {
        let home = std::path::Path::new(&home);
        let user = std::env::var("USER").unwrap_or_else(|_| "user".into());
        // macOS (cliente nativo) y, de paso, cualquier enlace que alguien haya puesto ahí.
        cands.push(home.join("Documents/EVE/logs").join(sub));
        // Wine por defecto.
        cands.push(home.join(".wine/drive_c/users").join(&user).join("Documents/EVE/logs").join(sub));
        // Steam Proton: el usuario del prefijo SIEMPRE es `steamuser`, no el tuyo.
        for base in [".steam/steam", ".local/share/Steam", ".var/app/com.valvesoftware.Steam/.local/share/Steam"] {
            cands.push(
                home.join(base)
                    .join("steamapps/compatdata/8500/pfx/drive_c/users/steamuser/Documents/EVE/logs")
                    .join(sub),
            );
        }
        // Lutris, disposición habitual.
        cands.push(home.join("Games/eve-online/drive_c/users").join(&user).join("Documents/EVE/logs").join(sub));
    }
    }

    for c in &cands {
        if c.is_dir() {
            return c.to_string_lossy().into_owned();
        }
    }
    cands
        .first()
        .map(|c| c.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Ruta por defecto de la carpeta de Chatlogs.
#[tauri::command]
pub fn default_chatlogs_dir() -> String {
    eve_log_dir("Chatlogs")
}

/// Ruta por defecto de la carpeta de Gamelogs.
#[tauri::command]
pub fn default_gamelogs_dir() -> String {
    eve_log_dir("Gamelogs")
}

/// Resultado del escaneo de gamelogs.
#[derive(serde::Serialize)]
pub struct GamelogScanResult {
    pub files_total: usize,
    pub files_scanned: usize,
    pub healed_hp: f64,
}

/// Escanea la carpeta de Gamelogs de forma INCREMENTAL (parse-once + tail por offset) y agrega la
/// reparación remota (logi) en logi_ledger. Emite `gamelog_scan_progress` (hechos, total).
#[tauri::command]
pub async fn scan_gamelogs(
    window: Window,
    folder: String,
    state: State<'_, AppState>,
) -> AppResult<GamelogScanResult> {
    let dir = if folder.trim().is_empty() {
        default_gamelogs_dir()
    } else {
        folder
    };
    // Valida la carpeta base y recoge los .txt de ella Y de la subcarpeta `old` (EVE archiva ahí
    // los gamelogs antiguos → así reconstruimos años de histórico, no solo lo reciente).
    std::fs::read_dir(&dir).map_err(|e| AppError::Other(format!("No pude abrir {dir}: {e}")))?;
    let base = std::path::Path::new(&dir);
    let mut files: Vec<std::path::PathBuf> = Vec::new();
    for d in [base.to_path_buf(), base.join("old")] {
        if let Ok(rd) = std::fs::read_dir(&d) {
            for p in rd.filter_map(|e| e.ok().map(|x| x.path())) {
                if p.extension().and_then(|s| s.to_str()) == Some("txt") {
                    files.push(p);
                }
            }
        }
    }
    files.sort();
    let total = files.len();
    // Reprocesado perezoso y NO destructivo: si una migración de datos dejó un reparse pendiente Y
    // aquí hay logs que releer, hacemos una limpieza + parse completo de una vez. Si NO hay logs
    // (carpeta borrada/movida), no tocamos nada: el histórico ya volcado en la BD se conserva y la
    // marca queda pendiente para el próximo escaneo con logs disponibles.
    let do_reparse = state.db.logi_reparse_pending() && !files.is_empty();
    if do_reparse {
        if state.db.logi_reparse_reset_done() {
            // REANUDACIÓN: el borrado de ESTA migración ya se hizo en un escaneo que se quedó a
            // medias (cierre de la app, corte…). `gamelog_parsed` conserva los ficheros ya
            // completados → seguimos incremental desde donde se quedó, sin tirar horas de I/O.
        } else {
            state
                .db
                .logi_reset_for_reparse()
                .map_err(|e| AppError::Other(format!("Preparando reprocesado: {e}")))?;
            // La marca va ANTES de escanear: si este escaneo también se interrumpe, el próximo
            // ya no vuelve a borrar. El banner de "reescaneo pendiente" sigue visible hasta
            // completar de verdad (logi_mark_reparsed limpia ambas claves al final).
            state
                .db
                .logi_mark_reparse_reset()
                .map_err(|e| AppError::Other(format!("Marcando borrado inicial: {e}")))?;
        }
    }
    // El progreso por NÚMERO de fichero miente: un gamelog de 4 KB y otro de 300 MB cuentan igual, y
    // la estimación de tiempo se dispara al topar con los grandes. Emitimos también BYTES, que es
    // proporcional al trabajo real. `prefix[i]` = bytes de los i primeros ficheros, así el contador
    // es exacto aunque el bucle se salte ficheros con `continue`.
    let sizes: Vec<u64> = files
        .iter()
        .map(|p| std::fs::metadata(p).map(|m| m.len()).unwrap_or(0))
        .collect();
    let mut prefix: Vec<u64> = Vec::with_capacity(total + 1);
    let mut acc = 0u64;
    prefix.push(0);
    for s in &sizes {
        acc += *s;
        prefix.push(acc);
    }
    let bytes_total = acc;
    // Fase D — el gamelog solo nombra un sistema cuando SALTAS, así que un ratero puede pasar ocho
    // horas sin decir dónde está. El canal Local sí escribe una línea en cada cambio de sistema.
    // `Chatlogs` es hermana de `Gamelogs`. Si no está, `locals` queda vacío y no se atribuye nada:
    // nunca inventamos un sistema.
    let locals = base
        .parent()
        .map(|p| crate::chatlog::LocalIndex::build(&p.join("Chatlogs")))
        .filter(|idx| !idx.is_empty());
    // Los Local anteriores a 2021-02 no llevan charID en el nombre, pero sí nombran al piloto en la
    // cabecera (`Listener:`). Traducimos ese nombre al character_id que ya conocemos.
    let by_name: std::collections::HashMap<String, i64> = state
        .db
        .list_characters()
        .unwrap_or_default()
        .into_iter()
        .map(|c| (c.name, c.character_id))
        .collect();
    // Emite el total ya de entrada: distingue "carpeta vacía" (0/0) de "escaneando" (0/N).
    let _ = window.emit("gamelog_scan_progress", (0usize, total, 0u64, bytes_total));
    let mut scanned = 0usize;
    let mut healed = 0.0f64;
    for (i, path) in files.iter().enumerate() {
        // OJO: el progreso va ANTES de los `continue` (fichero sin cambios / ilegible). Si no, los
        // ficheros saltados congelan el contador justo cuando el escaneo va más rápido.
        if i % 20 == 0 {
            let _ = window.emit("gamelog_scan_progress", (i, total, prefix[i], bytes_total));
        }
        let fname = match path.file_name().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        // Emparejamiento con la sesión de Local del mismo arranque (ventana -10s..+30s: el Local se
        // crea unos segundos después). Sin gemelo no hay presencia y el fichero se procesa igual que
        // antes, solo que sin sistema. Jamás se arrastra la presencia de otra sesión: un clon de salto
        // teletransporta sin escribir línea de salto y contaminaría todo lo siguiente.
        let stem = fname.strip_suffix(".txt").unwrap_or(&fname);
        let session = crate::chatlog::session_secs(stem);
        let mut char_id = crate::gamelog::char_id_from_name(&fname);
        let mut twin: Option<std::path::PathBuf> = None;
        if let (Some(idx), Some(sess)) = (locals.as_ref(), session) {
            match char_id {
                Some(c) => twin = idx.twin(&c.to_string(), sess).cloned(),
                // Gamelog huérfano (los de antes de 2021-02 no llevan charID). Su dueño está en el
                // Local gemelo. Solo lo aceptamos si el candidato es ÚNICO: con multiboxing hay
                // varios a la vez y adivinar el más cercano acertaría el 71,7%, que no es aceptable.
                None => {
                    if let Some((ident, p)) = idx.twin_any(sess) {
                        // El Local de esa época solo trae el NOMBRE del piloto. Lo traducimos con los
                        // Local modernos (que traen nombre y charID) y, si eso falla, con los
                        // personajes dados de alta en Koru.
                        let resolved = idx
                            .resolve_char(ident, sess)
                            .or_else(|| by_name.get(ident).copied());
                        if let Some(c) = resolved {
                            char_id = Some(c);
                            twin = Some(p.clone());
                        }
                    }
                }
            }
        }
        let char_id = match char_id {
            Some(c) => c,
            None => continue, // sin dueño: no sabemos de quién es, no lo contamos
        };
        let meta = match std::fs::metadata(path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let size = meta.len() as i64;
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let from = match state.db.gamelog_offset(&fname) {
            Some((psize, pmtime, _)) if psize == size && pmtime == mtime => continue, // sin cambios
            Some((_, _, poff)) => poff as u64,
            None => 0,
        };
        let (new_off, batch) = match crate::gamelog::scan_file(path, from) {
            Ok(x) => x,
            Err(_) => continue, // fichero ilegible/bloqueado (p. ej. la sesión activa): lo saltamos
        };
        healed += batch.logi.iter().map(|e| e.hp).sum::<f64>();
        let presence = twin
            .as_deref()
            .map(crate::chatlog::presence)
            .unwrap_or_default();
        state
            .db
            .commit_gamelog(&fname, size, mtime, new_off as i64, char_id, &batch, &presence)
            .map_err(|e| AppError::Other(format!("Guardando {fname}: {e}")))?;
        scanned += 1;
    }
    let _ = window.emit("gamelog_scan_progress", (total, total, bytes_total, bytes_total));
    // Reprocesado completado con éxito: fija la versión de datos y limpia la marca pendiente.
    if do_reparse {
        let _ = state.db.logi_mark_reparsed();
    }
    Ok(GamelogScanResult {
        files_total: total,
        files_scanned: scanned,
        healed_hp: healed,
    })
}

/// Lo que se encontró al mirar la carpeta de chatlogs. **No solo los canales: también lo que se
/// descartó y por qué.**
///
/// Un `Vec<String>` vacío no distingue «la carpeta está vacía» de «hay 300 ficheros pero ninguno me
/// encaja» ni de «esta no es la carpeta». Son tres problemas distintos con tres arreglos distintos,
/// y el usuario los veía todos como el mismo cartel.
#[derive(Debug, Serialize)]
pub struct IntelFolderScan {
    pub channels: Vec<String>,
    /// Entradas totales de la carpeta (ficheros y subcarpetas).
    pub entries: usize,
    /// Cuántas acaban en `.txt`.
    pub txt: usize,
    /// Un nombre de ejemplo de los `.txt` que NO encajaron con el formato esperado. Con esto se ve
    /// de un vistazo si el problema es el formato o es que esa no es la carpeta.
    pub sample: Option<String>,
}

/// Lista los canales presentes en la carpeta (prefijo antes de `_AAAAMMDD_HHMMSS_charID.txt`).
#[tauri::command]
pub fn intel_channels(folder: String) -> AppResult<IntelFolderScan> {
    // ⚠️ ESTO ANTES SE TRAGABA EL ERROR (`if let Ok(rd)`), y por eso un tester de Linux se pasó un
    // rato mirando una carpeta CORRECTA que decía «no se encontraron canales». No es lo mismo «he
    // mirado y no hay» que «no he podido mirar», y sin distinguirlo no hay forma de diagnosticar.
    let rd = std::fs::read_dir(&folder)
        .map_err(|e| AppError::Other(format!("No se pudo leer la carpeta «{folder}»: {e}")))?;
    let mut set = std::collections::BTreeSet::new();
    let mut entries = 0usize;
    let mut txt = 0usize;
    let mut sample: Option<String> = None;
    for e in rd.flatten() {
        entries += 1;
        let name = e.file_name().to_string_lossy().to_string();
        let Some(stem) = name.strip_suffix(".txt") else {
            continue;
        };
        txt += 1;
        // Quitar los 3 últimos campos separados por '_' (fecha, hora, charID).
        let parts: Vec<&str> = stem.split('_').collect();
        if parts.len() >= 4 {
            let ch = parts[..parts.len() - 3].join("_");
            if !ch.is_empty() {
                set.insert(ch);
                continue;
            }
        }
        // Se guarda UN ejemplo de lo descartado. Uno basta: si el formato no encaja, no encaja en
        // todos igual, y una lista larga no diría más que el primero.
        if sample.is_none() {
            sample = Some(name);
        }
    }
    Ok(IntelFolderScan {
        channels: set.into_iter().collect(),
        entries,
        txt,
        sample,
    })
}

/// Una línea de intel parseada de un log de chat.
#[derive(Debug, Serialize, Clone)]
pub struct IntelLine {
    pub ts_ms: i64,
    pub channel: String,
    pub author: String,
    pub message: String,
}

/// Parsea TODAS las líneas de un fichero ya decodificado (sin filtrar por recencia ni deduplicar).
/// Se cachea por fichero, así que parsear todo y filtrar luego permite reutilizar la caché.
fn parse_intel_text(text: &str, channel: &str) -> Vec<IntelLine> {
    let mut out = Vec::new();
    for raw in text.lines() {
        let line = raw
            .trim_start_matches(|c: char| c.is_control() || c == '\u{feff}')
            .trim();
        if !line.starts_with('[') {
            continue;
        }
        let close = match line.find(']') {
            Some(i) => i,
            None => continue,
        };
        let ts_str = line[1..close].trim();
        let rest = line[close + 1..].trim();
        let (author, message) = match rest.split_once(" > ") {
            Some((a, m)) => (a.trim().to_string(), m.trim().to_string()),
            None => continue,
        };
        if author == "EVE System" || author == "Sistema EVE" || message.is_empty() {
            continue;
        }
        let ndt = match chrono::NaiveDateTime::parse_from_str(ts_str, "%Y.%m.%d %H:%M:%S") {
            Ok(d) => d,
            Err(_) => continue,
        };
        let dt = chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(ndt, chrono::Utc);
        out.push(IntelLine {
            ts_ms: dt.timestamp_millis(),
            channel: channel.to_string(),
            author,
            message,
        });
    }
    out
}

/// Estado del intel por fichero: ruta → (byte hasta donde ya leímos, líneas vivas ya parseadas).
type IntelCache = std::collections::HashMap<std::path::PathBuf, (u64, Vec<IntelLine>)>;
fn intel_cache() -> &'static std::sync::Mutex<IntelCache> {
    static C: std::sync::OnceLock<std::sync::Mutex<IntelCache>> = std::sync::OnceLock::new();
    C.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

/// Lee SOLO lo que el log ha crecido desde el tick anterior y devuelve las líneas vivas del canal.
///
/// Antes se releía y reparseaba el fichero ENTERO cada 3 segundos. Un canal de intel movido pasa de
/// los 250 KB en una sesión larga, así que el coste crecía sin parar mientras jugabas — justo cuando
/// más importa que la alarma llegue rápido. Ahora el trabajo por tick es proporcional a lo que se ha
/// escrito, no a lo que hay escrito.
///
/// Detalles que hacen que esto sea correcto y no una fuente de líneas perdidas o partidas:
/// - El tamaño se pide al HANDLE abierto, no a la entrada de directorio: en Windows el directorio no
///   se actualiza mientras EVE mantiene el fichero abierto (por eso el código viejo releía siempre).
/// - Solo se consume hasta el ÚLTIMO salto de línea. Si EVE está a medio escribir una línea, esa se
///   queda fuera y el offset no avanza: entrará entera en el siguiente tick.
/// - UTF-16LE: se avanza en unidades de 16 bits (× 2 bytes), nunca por bytes sueltos.
/// - Si el fichero encoge, es que EVE lo rotó: se relee desde cero.
fn intel_tail(path: &std::path::Path, channel: &str, keep_after_ms: i64) -> Vec<IntelLine> {
    use std::io::{Read, Seek, SeekFrom};
    let mut cache = match intel_cache().lock() {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let entry = cache.entry(path.to_path_buf()).or_insert((0, Vec::new()));
    let mut f = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return entry.1.clone(), // bloqueado un instante: servimos lo que ya teníamos
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    if len < entry.0 {
        *entry = (0, Vec::new());
    }
    if len > entry.0 && f.seek(SeekFrom::Start(entry.0)).is_ok() {
        let mut buf = Vec::with_capacity((len - entry.0) as usize);
        if f.read_to_end(&mut buf).is_ok() {
            let bom = usize::from(entry.0 == 0 && buf.len() >= 2 && buf[0] == 0xFF && buf[1] == 0xFE) * 2;
            let units: Vec<u16> = buf[bom..]
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            if let Some(nl) = units.iter().rposition(|&u| u == 0x000A) {
                let text = String::from_utf16_lossy(&units[..=nl]);
                entry.0 += bom as u64 + (nl as u64 + 1) * 2;
                entry.1.append(&mut parse_intel_text(&text, channel));
            }
        }
    }
    // El intel es efímero: no acumulamos la sesión entera en RAM. Pero la caché la comparten el hilo
    // vigilante (ventana de minutos) y el comando `read_intel` (ventana mayor), así que podamos con el
    // horizonte MÁS ANTIGUO de los dos: si podáramos con el del vigilante, la vista perdería historia
    // que ya no podemos recuperar, porque el offset del fichero ya ha avanzado.
    const HORIZONTE_MS: i64 = 6 * 60 * 60 * 1000;
    let floor = keep_after_ms.min(chrono::Utc::now().timestamp_millis() - HORIZONTE_MS);
    entry.1.retain(|l| l.ts_ms >= floor);
    entry.1.clone()
}

/// Lee los logs de los `channels` indicados en `folder`, parsea las líneas de los últimos
/// `since_minutes`, deduplica entre personajes (mismo ts+autor+mensaje) y las devuelve por orden.
#[tauri::command]
pub fn read_intel(
    folder: String,
    channels: Vec<String>,
    since_minutes: i64,
) -> AppResult<Vec<IntelLine>> {
    collect_intel_lines(&folder, &channels, since_minutes)
}

/// Fecha de sesión sacada del NOMBRE de un log de chat (`Canal_YYYYMMDD_HHMMSS_charid.txt`).
///
/// Es el respaldo del mtime, y hace falta por un mal de Windows CONFIRMADO EN VIVO (2026-07-10):
/// el mtime que enseña el DIRECTORIO se congela mientras EVE mantiene el fichero abierto. Como la
/// poda decide qué ficheros se abren siquiera, un fichero "viejo" a ojos del directorio no vuelve
/// a abrirse jamás → el intel enmudecía a los `recencia+10` minutos de sesión. (El código antiguo
/// no lo sufría de rebote: abría TODOS los ficheros en cada tick y ese acceso refrescaba los
/// metadatos.) La fecha del nombre = inicio de sesión: una sesión abierta sigue siendo candidata
/// aunque el directorio no refresque; el tamaño real ya se pide al HANDLE en `intel_tail`.
fn intel_fname_session(name: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    let stem = name.strip_suffix(".txt")?;
    let parts: Vec<&str> = stem.split('_').collect();
    // Moderno: ..._YYYYMMDD_HHMMSS_charid · viejo: ..._YYYYMMDD_HHMMSS. Probar ambas posiciones.
    for (d, t) in [
        (parts.len().checked_sub(3)?, parts.len() - 2),
        (parts.len() - 2, parts.len() - 1),
    ] {
        let (ds, ts) = (parts.get(d)?, parts.get(t)?);
        if ds.len() == 8 && ts.len() == 6 && ds.bytes().all(|b| b.is_ascii_digit()) && ts.bytes().all(|b| b.is_ascii_digit()) {
            let ndt = chrono::NaiveDateTime::parse_from_str(&format!("{ds}{ts}"), "%Y%m%d%H%M%S").ok()?;
            return Some(chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(ndt, chrono::Utc));
        }
    }
    None
}

/// Núcleo de lectura/parseo/dedup de intel (lo usan el comando `read_intel` y el hilo vigilante).
fn collect_intel_lines(
    folder: &str,
    channels: &[String],
    since_minutes: i64,
) -> AppResult<Vec<IntelLine>> {
    collect_intel_ext(folder, channels, since_minutes).map(|(l, _)| l)
}

/// Igual que `collect_intel_lines` pero además dice cuántos logs vivos siguió. El vigilante lo
/// publica en su estado: "0 ficheros" NO es lo mismo que "0 líneas" (uno es que no encontramos el
/// log del canal; el otro es que no hay hostiles). Confundirlos nos costó dos diagnósticos falsos.
fn collect_intel_ext(
    folder: &str,
    channels: &[String],
    since_minutes: i64,
) -> AppResult<(Vec<IntelLine>, usize)> {
    let cutoff = chrono::Utc::now() - chrono::Duration::minutes(since_minutes.max(1));
    let cutoff_ms = cutoff.timestamp_millis();
    let rd = std::fs::read_dir(folder)
        .map_err(|e| AppError::Other(format!("no se pudo leer la carpeta de logs: {e}")))?;
    let mut out: Vec<IntelLine> = Vec::new();
    let mut seen: HashSet<(i64, String, String)> = HashSet::new();
    let skip_before = cutoff - chrono::Duration::minutes(10);

    // 1ª pasada: un canal de intel es el MISMO feed para todos los alts → sus logs son idénticos.
    // Con MULTIBOX hay UN fichero por cliente abierto en ese canal, todos vivos a la vez.
    // ⚠️ BUG CAZADO (2026-07-23, RoGiz7 con 3 clientes): antes nos quedábamos SOLO con el de eff más
    // alto y leíamos ese. Al CERRAR el cliente cuyo fichero era el más nuevo, su log quedaba MUERTO
    // pero conservaba la fecha de sesión más reciente → seguíamos leyendo el muerto (0 líneas nuevas)
    // y el intel enmudecía, aunque otro cliente siguiera recibiendo. Relogar lo curaba (fichero nuevo
    // = otra vez el más reciente). Fix: guardar VARIOS candidatos por canal y leer los K más recientes
    // (ver LIVE_FILES_PER_CHANNEL abajo). candidatos[channel] = lista de (eff_ns, path).
    let mut cands: std::collections::HashMap<String, Vec<(u128, std::path::PathBuf)>> =
        std::collections::HashMap::new();
    // Los prefijos, una vez. Antes se construía un `format!("{c}_")` por cada fichero y cada canal, en
    // cada tick: con 5.100 ficheros en la carpeta son decenas de miles de asignaciones cada 3 s.
    let prefixes: Vec<(String, String)> =
        channels.iter().map(|c| (format!("{c}_"), c.clone())).collect();
    for e in rd.flatten() {
        let fname = e.file_name();
        let name = fname.to_string_lossy();
        if !name.ends_with(".txt") {
            continue;
        }
        let ch = match prefixes.iter().find(|(p, _)| name.starts_with(p.as_str())) {
            Some((_, c)) => c.clone(),
            None => continue,
        };
        let md = match e.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let modt = md.modified().ok();
        // Fecha "efectiva" del fichero = lo más reciente entre el mtime visible y la fecha de
        // sesión del NOMBRE. Solo sirve para ELEGIR el log vivo del canal, NO para descartar.
        let mdt: Option<chrono::DateTime<chrono::Utc>> = modt.map(Into::into);
        let fdt = intel_fname_session(&name);
        let eff = match (mdt, fdt) {
            (Some(a), Some(b)) => Some(a.max(b)),
            (a, b) => a.or(b),
        };
        // ⚠️ NO se poda por fecha. Aquí vivía el bug del "intel mudo" (dos intentos ya):
        // en una sesión larga las DOS señales son viejas —el mtime se congela mientras EVE tiene el
        // log abierto (mal de Windows, ver `intel_fname_session`) y la fecha del nombre es la de
        // INICIO de sesión—, así que el log VIVO se descartaba a los `recencia+10` minutos y el
        // intel enmudecía hasta relogear. El respaldo por nombre (2026-07-10) solo tapaba los
        // primeros minutos. La poda además SOBRABA: la recencia es un filtro de MENSAJES (lo hace
        // la 2ª pasada con `cutoff_ms`), no de ficheros; y como abajo nos quedamos con los K ficheros
        // más recientes de cada canal, no podar aquí no abre ficheros de más.
        // `eff` ordena los candidatos (sesión más reciente primero). Con los mtime congelados en el
        // arranque de cada sesión, el nombre ordena mejor; el tamaño real lo pide intel_tail al handle.
        let eff_ns = eff
            .map(|d| d.timestamp_millis().max(0) as u128 * 1_000_000)
            .unwrap_or(0);
        cands.entry(ch).or_default().push((eff_ns, e.path()));
    }

    // Por canal nos quedamos con los K ficheros de sesión MÁS RECIENTE (por eff) y los leemos TODOS:
    // así los clientes que siguen abiertos entran aunque un fichero MUERTO tenga la fecha más nueva.
    // Las líneas se deduplican por (hora+autor+mensaje), así que solaparse entre alts es inocuo, y
    // `intel_tail` solo relee lo que cada log ha CRECIDO (los muertos no crecen → coste ~0 por tick).
    // K acota el coste: un multibox no tiene decenas de clientes del mismo canal a la vez.
    const LIVE_FILES_PER_CHANNEL: usize = 12;
    let mut live_paths: Vec<(String, std::path::PathBuf)> = Vec::new();
    for (ch, mut v) in cands {
        v.sort_by(|a, b| b.0.cmp(&a.0)); // eff descendente: sesión más reciente primero
        v.truncate(LIVE_FILES_PER_CHANNEL);
        for (_eff, p) in v {
            live_paths.push((ch.clone(), p));
        }
    }
    let files = live_paths.len();

    // 2ª pasada: leer SOLO la cola nueva de cada log vivo del canal (ver `intel_tail`).
    for (ch, path) in live_paths {
        for l in intel_tail(&path, &ch, skip_before.timestamp_millis()) {
            if l.ts_ms < cutoff_ms {
                continue;
            }
            let key = (l.ts_ms / 1000, l.author.clone(), l.message.clone());
            if !seen.insert(key) {
                continue; // duplicado entre personajes/clientes
            }
            out.push(l);
        }
    }
    out.sort_by_key(|l| l.ts_ms);
    Ok((out, files))
}

// ---- Vigilancia de intel en segundo plano (hilo nativo, sin throttle del SO) ----
// La detección (matching de sistema + proximidad BFS + decisión de alerta) corre aquí, así que
// la alarma salta aunque la ventana esté minimizada. Emite eventos al frontend:
//   "intel-lines" (Vec<IntelLine> recientes, para pintar) y "intel-alert" (alerta de proximidad).

#[derive(Clone)]
pub struct IntelWatchCfg {
    pub folder: String,
    pub channels: Vec<String>,
    pub recency_min: i64,
    /// Orígenes de proximidad: sistema del personaje + puntos de ancla elegidos.
    pub origins: Vec<i64>,
    /// Sistemas SILENCIADOS: no disparan alarma (ni notificación, ni sonido, ni overlay).
    ///
    /// Es el ancla al revés. El caso real: un vecino de tu staging por el que pasa medio New Eden
    /// —o el sistema donde estás rateando y el intel canta cada dos minutos— acaba enseñándote a
    /// ignorar TODAS las alarmas, incluida la que importaba. Callar una es lo que mantiene vivas
    /// las demás.
    ///
    /// ⚠️ Silencia la ALARMA, nunca el dato. El feed y la capa del mapa siguen enseñando el
    /// reporte, y eso no es un extra: un sistema callado por silencio es idéntico a un sistema sin
    /// intel, así que si además lo escondiéramos, el silencio sería una trampa que te pones tú y
    /// se te olvida. Que se vea es lo que lo hace seguro.
    ///
    /// `until_ms` = hasta cuándo (epoch ms). `None` = para siempre, hasta que lo quites.
    pub muted: Vec<MutedSystem>,
    /// SOLO las anclas, aparte de `origins` (que las lleva mezcladas con los pilotos).
    ///
    /// Hacen falta sueltas para poder DECIR de qué ancla se está midiendo. Hasta ahora, cuando no
    /// había ningún piloto cerca, el aviso enseñaba un número sin dueño: «4 saltos» de nada. El
    /// número desnudo es peor que no decirlo, porque parece que sabes de qué habla.
    pub anchors: Vec<i64>,
    /// Tus pilotos conectados y dónde están, para el CONTEXTO del aviso. Lo pone el frontend con
    /// lo que ya tiene de `get_character_cards`; aquí solo se usa para medir saltos.
    ///
    /// Es lo que separa a Koru de una app de intel: «hostil a 3 saltos» lo dice cualquiera, «a 3
    /// saltos de Vera, que va en Venture» hace falta cruzar el chatlog con tu ubicación y tu nave.
    /// Vacío = el aviso sale igual, solo que sin esa línea.
    pub pilots: Vec<PilotLoc>,
    /// ¿Sacar además el aviso FLOTANTE sobre el juego? Apagado de fábrica. Independiente de
    /// `alerts_enabled`: puedes querer sonido y notificación sin ventanita encima, o al revés.
    pub overlay_enabled: bool,
    pub alert_jumps: i64,
    /// ¿Sacar ALERTAS (notificación nativa + evento intel-alert → sonido/banner)? El vigilante SIGUE
    /// leyendo y emitiendo el feed (intel-lines) para los puntos del mapa aunque esto sea false: así,
    /// con el interruptor «Intel en vivo» APAGADO puedes seguir viendo el intel en la capa, pero NO
    /// suena ni notifica. Lo pone el frontend = estado del interruptor maestro (`intel.live`).
    pub alerts_enabled: bool,
}

#[derive(Default)]
pub struct IntelGraph {
    pub name_to_id: std::collections::HashMap<String, i64>,
    pub id_to_name: std::collections::HashMap<i64, String>,
    pub adj: std::collections::HashMap<i64, Vec<i64>>,
}

/// Lo que el vigilante está haciendo DE VERDAD. Nace de un fallo de diseño que nos costó dos
/// sesiones a ciegas (2026-07-10 y 2026-07-14): el badge "Activo" salía del interruptor del
/// frontend, no del hilo, y los errores de lectura se tragaban con `unwrap_or_default()`. Con eso,
/// un intel MUERTO y un intel EN CALMA se veían exactamente igual ("Activo · 0 sistemas") y
/// diagnosticamos dos veces con teorías falsas. Si el intel se cae, tiene que GRITAR.
#[derive(Debug, Clone, Serialize, Default)]
pub struct IntelStatus {
    /// El hilo está recolectando de verdad (hay cfg, con carpeta y canales).
    pub collecting: bool,
    /// Por qué NO recolecta, si es el caso (sin config, sin canales…).
    pub idle_reason: Option<String>,
    /// Último error REAL de lectura. Antes moría en un `unwrap_or_default()` sin que nadie lo viera.
    pub last_error: Option<String>,
    /// Líneas dentro de la recencia en la última pasada.
    pub lines: i64,
    /// Ficheros de log seguidos (uno por canal vivo). 0 = no encontramos ningún log del canal.
    pub files: i64,
    /// Última pasada (ms epoch). Si esto no avanza, el hilo está muerto.
    pub last_tick_ms: i64,
}

#[derive(Default)]
pub struct IntelWatch {
    pub cfg: std::sync::Mutex<Option<IntelWatchCfg>>,
    pub graph: std::sync::Mutex<IntelGraph>,
    pub alerted: std::sync::Mutex<HashSet<String>>,
    pub started: std::sync::atomic::AtomicBool,
    pub status: std::sync::Mutex<IntelStatus>,
}

/// Estado real del vigilante de intel, para que la UI no pueda mentir diciendo "Activo".
#[tauri::command]
pub fn get_intel_status(state: State<'_, AppState>) -> AppResult<IntelStatus> {
    Ok(state
        .intel
        .status
        .lock()
        .map(|s| s.clone())
        .unwrap_or_default())
}

#[derive(Clone, Serialize)]
pub struct IntelAlertEvent {
    pub sys_id: i64,
    pub system: String,
    pub jumps: i64,
    pub author: String,
    pub message: String,
    pub ts_ms: i64,
    /// Tus pilotos ordenados por cercanía AL SISTEMA DEL AVISO (no a los orígenes). El overlay
    /// enseña el primero. Vacío si el frontend no mandó pilotos o ninguno está en el mapa.
    pub pilots: Vec<PilotProximity>,
    /// El ancla más cercana, con nombre. `None` = no hay anclas puestas.
    pub anchor: Option<AnchorProximity>,
    /// QUIÉN viene y en qué. Es el protagonista del aviso: lo que decide si huyes o peleas.
    pub parse: IntelParse,
}

/// Un sistema silenciado. `until_ms` nulo = indefinido; con valor, caduca solo.
///
/// El silencio temporal existe porque el motivo casi siempre es temporal («esta noche rateo
/// aquí»). Uno indefinido que se te olvida quitar es justo el que te mata tres semanas después.
#[derive(Clone, Debug, serde::Deserialize)]
pub struct MutedSystem {
    pub system_id: i64,
    #[serde(default)]
    pub until_ms: Option<i64>,
}

/// Dónde está uno de tus pilotos y en qué vuela. Lo manda el frontend en la config del vigilante.
#[derive(Clone, Debug, serde::Deserialize)]
pub struct PilotLoc {
    pub name: String,
    pub system_id: i64,
    pub ship: Option<String>,
    pub ship_type_id: Option<i64>,
}

// ---------------------------------------------------------------------------------------------
// ANÁLISIS DEL HOSTIL. Antes el aviso flotante enseñaba MI nave grande y con icono, y a quien venía
// a matarme lo dejaba en letra pequeña dentro del texto crudo del chat. La jerarquía estaba al
// revés, lo cazó RoGiz7: «parece más importante en qué nave estoy yo que en qué nave vienen por mí».
//
// El análisis se hace AQUÍ y no en el overlay porque esa ventana no puede permitirse cargar
// `neweden.json` (5.485 sistemas) solo para descartar nombres de sistema. Rust ya tiene el grafo
// cargado para el BFS, así que le sale gratis. `ships.json` son 19 KB y va embebido.
// Espejo de `classifyIntel` en `src/intel.ts`: si cambia uno, cambia el otro.
// ---------------------------------------------------------------------------------------------

#[derive(serde::Deserialize)]
struct ShipRow {
    i: i64,
    n: String,
}

/// Nombre de nave en minúsculas → typeID. Embebido: no depende de que el front esté vivo.
fn ship_names() -> &'static std::collections::HashMap<String, (i64, String)> {
    // Rutas completas a propósito: este fichero solo importa `HashSet`, y el resto del código
    // cualifica. Mantener el estilo evita un `use` que luego nadie sabe de dónde salió.
    static S: std::sync::OnceLock<std::collections::HashMap<String, (i64, String)>> =
        std::sync::OnceLock::new();
    S.get_or_init(|| {
        let rows: Vec<ShipRow> = serde_json::from_str(include_str!("ships.json")).unwrap_or_default();
        rows.into_iter()
            .map(|r| (r.n.to_lowercase(), (r.i, r.n)))
            .collect()
    })
}

/// typeID → nombre de nave. El inverso de `ship_names()`, para el sondeo de posición: sin esto
/// habría que preguntar a ESI el nombre de una nave que ya tenemos embebida en disco.
fn ship_name_by_id() -> &'static std::collections::HashMap<i64, String> {
    static S: std::sync::OnceLock<std::collections::HashMap<i64, String>> =
        std::sync::OnceLock::new();
    S.get_or_init(|| {
        let rows: Vec<ShipRow> = serde_json::from_str(include_str!("ships.json")).unwrap_or_default();
        rows.into_iter().map(|r| (r.i, r.n)).collect()
    })
}

/// Palabras que NO son ni piloto ni nave. Espejo de `INTEL_JARGON` en `intel.ts`.
///
/// La segunda fila son verbos y muletillas del chat de intel real. Se añadieron tras ver el aviso
/// anunciar «he jump» como si fuera un hostil (la línea era «he jump to 8-WYQZ»).
const INTEL_JARGON: &[&str] = &[
    "nv", "neut", "neuts", "neutral", "neutrals", "red", "reds", "hostile", "hostiles", "status",
    "gate", "gates", "stargate", "dock", "docked", "docking", "station", "pos", "cyno", "near",
    "on", "the", "in", "at", "and", "is", "to", "a",
    // Cómo habla la gente en un canal de intel:
    "jump", "jumps", "jumped", "jumping", "warp", "warped", "warping", "camp", "camped", "camping",
    "move", "moves", "moved", "moving", "coming", "came", "going", "gone", "left", "back", "out",
    "up", "down", "here", "there", "still", "safe", "clr2", "afk", "logged", "off", "away",
    "spotted", "seen", "sitting", "sits", "roam", "roaming", "local", "he", "she", "they", "his",
    "her", "their", "with", "from", "for", "of", "seem", "seems", "like", "just", "was", "were",
    "have", "has", "had", "not", "no", "yes", "now", "watch", "look", "looking", "check", "x", "o",
];

/// ¿Puede esta palabra formar parte de un nombre de piloto?
///
/// **Todo nombre de personaje de EVE empieza por mayúscula.** Ese único criterio quita de golpe
/// las frases en inglés que se colaban como hostiles («he jump», «seem like hes moving») sin tener
/// que mantener una lista infinita de palabras. Los nombres de varias palabras («Bedwin Al Ishira»,
/// «New Clone WhoDis») pasan porque TODAS sus partes van en mayúscula.
///
/// Se rechazan también los que empiezan por dígito: existen, pero son rarísimos, y aquí un falso
/// negativo («hostil sin identificar») es mucho mejor que un falso positivo — inventarle un nombre
/// a quien viene a matarte es peor que admitir que no lo sabes.
fn parece_nombre(palabra: &str) -> bool {
    palabra.chars().next().is_some_and(|c| c.is_uppercase())
}

/// Un hostil citado en la línea de intel. `character_id` solo si YA lo conocíamos de avistamientos
/// anteriores (tabla `intel_sightings`): así se puede pintar su retrato sin llamar a ESI.
#[derive(Clone, Debug, Serialize)]
pub struct Hostil {
    pub name: String,
    pub character_id: Option<i64>,
}

/// Una nave citada en la línea de intel.
#[derive(Clone, Debug, Serialize)]
pub struct NaveCitada {
    pub type_id: i64,
    pub name: String,
}

/// Lo que se ha podido sacar en limpio de la línea del chat.
#[derive(Clone, Debug, Default, Serialize)]
pub struct IntelParse {
    pub hostiles: Vec<Hostil>,
    pub ships: Vec<NaveCitada>,
    /// Contador explícito del tipo «+4» o «14+». `None` = no lo dijeron.
    pub count: Option<i64>,
}

/// Quita puntuación de los extremos, igual que el `clean` del frontend.
fn limpia_token(s: &str) -> String {
    s.trim_matches(|c: char| "*.,;:!?()[]{}".contains(c)).trim().to_string()
}

/// Analiza una línea de intel: separa pilotos, naves y el contador.
///
/// Los campos se parten por DOS espacios o más (así los escribe el juego al pegar), y dentro de
/// cada campo se clasifica palabra a palabra. Lo que no es sistema, ni nave, ni jerga, ni contador,
/// es un nombre de piloto — que es justo lo que interesa enseñar.
fn analizar_intel(mensaje: &str, sistemas: &std::collections::HashMap<String, i64>) -> IntelParse {
    let naves = ship_names();
    let mut out = IntelParse::default();
    let mut buf: Vec<String> = Vec::new();

    let cerrar = |buf: &mut Vec<String>, out: &mut IntelParse| {
        if !buf.is_empty() {
            let nombre = buf.join(" ");
            if !out.hostiles.iter().any(|h| h.name == nombre) {
                out.hostiles.push(Hostil { name: nombre, character_id: None });
            }
            buf.clear();
        }
    };

    for campo in mensaje.split("  ").map(str::trim).filter(|f| !f.is_empty()) {
        for palabra in campo.split_whitespace() {
            // Ticker de corp/alianza entre paréntesis: no es piloto ni nave, y CIERRA el nombre
            // que venía antes (suele ir pegado detrás del piloto).
            let bruto = palabra.trim();
            if bruto.len() > 1
                && (bruto.starts_with('(') || bruto.starts_with('[') || bruto.starts_with('{'))
                && (bruto.ends_with(')') || bruto.ends_with(']') || bruto.ends_with('}'))
            {
                cerrar(&mut buf, &mut out);
                continue;
            }
            let c = limpia_token(bruto);
            if c.is_empty() {
                continue;
            }
            let lc = c.to_lowercase();
            if lc == "clr" || lc == "clear" || lc == "cleared" {
                cerrar(&mut buf, &mut out);
                continue;
            }
            // Contador: «+4» o «14+».
            let n = lc.strip_prefix('+').or_else(|| lc.strip_suffix('+'));
            if let Some(d) = n.and_then(|d| d.parse::<i64>().ok()) {
                cerrar(&mut buf, &mut out);
                out.count = Some(d);
                continue;
            }
            if INTEL_JARGON.contains(&lc.as_str()) {
                cerrar(&mut buf, &mut out);
                continue;
            }
            if sistemas.contains_key(&lc) {
                cerrar(&mut buf, &mut out);
                continue;
            }
            if let Some((tid, nombre)) = naves.get(&lc) {
                cerrar(&mut buf, &mut out);
                if !out.ships.iter().any(|s| s.type_id == *tid) {
                    out.ships.push(NaveCitada { type_id: *tid, name: nombre.clone() });
                }
                continue;
            }
            // Lo que no empieza por mayúscula no es un nombre: corta lo que hubiera y se descarta.
            if !parece_nombre(&c) {
                cerrar(&mut buf, &mut out);
                continue;
            }
            buf.push(c);
        }
        cerrar(&mut buf, &mut out);
    }
    cerrar(&mut buf, &mut out);
    out
}

/// Un piloto tuyo con su distancia REAL en saltos al sistema del aviso.
///
/// `system_id`/`system` entran para poder AGRUPAR en el overlay: tres pilotos a la misma distancia
/// pueden estar juntos en un sistema (una flota) o desperdigados en tres (nadie apoya a nadie), y
/// son dos situaciones muy distintas. El overlay no puede deducirlo solo, porque no tiene el mapa:
/// cargar `neweden.json` (5.485 sistemas) en esa ventanita para resolver un nombre sería absurdo.
#[derive(Clone, Debug, Serialize)]
pub struct PilotProximity {
    pub name: String,
    pub jumps: i64,
    pub ship: Option<String>,
    pub ship_type_id: Option<i64>,
    pub system_id: i64,
    pub system: Option<String>,
}

/// El ancla más cercana al sistema del aviso, CON NOMBRE.
///
/// Es la pieza que faltaba para que el número nunca salga huérfano. Si no hay ningún piloto tuyo
/// en el grafo (todos atracados en otra región, desconectados, o en un agujero), la referencia
/// pasa a ser el ancla — y entonces hay que poder decir «a 4 saltos de 88a-ra» en vez de «4».
#[derive(Clone, Debug, Serialize)]
pub struct AnchorProximity {
    pub name: String,
    pub system_id: i64,
    pub jumps: i64,
}

/// Distancia de cada piloto AL SISTEMA DEL AVISO, ordenados de más cerca a más lejos.
///
/// Ojo al matiz: el `jumps` del evento es la distancia a los ORÍGENES (que incluyen tus anclas del
/// mapa), y eso puede ser un sitio donde no hay nadie. Lo que decide si te afecta es dónde están
/// TUS pilotos, así que aquí se hace un BFS nuevo desde el sistema hostil. Es un BFS sobre ~5.500
/// nodos y solo corre cuando salta una alerta (raro), así que el coste es irrelevante.
/// Un solo BFS desde el sistema hostil para las DOS referencias: tus pilotos y tus anclas.
/// Van juntas porque comparten el recorrido; separarlas costaría un segundo BFS para nada.
fn contexto_cerca(
    adj: &std::collections::HashMap<i64, Vec<i64>>,
    id_to_name: &std::collections::HashMap<i64, String>,
    pilots: &[PilotLoc],
    anchors: &[i64],
    sistema: i64,
) -> (Vec<PilotProximity>, Option<AnchorProximity>) {
    if pilots.is_empty() && anchors.is_empty() {
        return (Vec::new(), None);
    }
    let dist = intel_bfs(adj, &[sistema]);
    let mut out: Vec<PilotProximity> = pilots
        .iter()
        // Sin distancia = el piloto no está en el mismo grafo alcanzable (wormhole, o sistema que
        // el mapa no conecta). Se omite en vez de inventar un número: mentir aquí es peor que callar.
        .filter_map(|p| {
            dist.get(&p.system_id).map(|&d| PilotProximity {
                name: p.name.clone(),
                jumps: d,
                ship: p.ship.clone(),
                ship_type_id: p.ship_type_id,
                system_id: p.system_id,
                system: id_to_name.get(&p.system_id).cloned(),
            })
        })
        .collect();
    out.sort_by_key(|p| p.jumps);

    // El ancla MÁS CERCANA. Misma regla que arriba: la que no esté en el grafo no existe.
    let ancla = anchors
        .iter()
        .filter_map(|a| dist.get(a).map(|&d| (*a, d)))
        .min_by_key(|(_, d)| *d)
        .map(|(sid, d)| AnchorProximity {
            name: id_to_name
                .get(&sid)
                .cloned()
                .unwrap_or_else(|| sid.to_string()),
            system_id: sid,
            jumps: d,
        });
    (out, ancla)
}

/// Analiza la línea y, además, intenta poner CARA a los hostiles.
///
/// El `character_id` sale de `intel_sightings`, la tabla que Koru ya llena sola con los pilotos
/// vistos en el intel (y que resuelve por ESI a los habituales). O sea: **cero llamadas de red en
/// el camino de la alerta** — o ya lo conocemos, o el aviso sale sin retrato y no pasa nada. Meter
/// una petición HTTP aquí retrasaría justo el aviso que más corre prisa.
fn hostiles_de(
    app: &tauri::AppHandle,
    sistemas: &std::collections::HashMap<String, i64>,
    mensaje: &str,
) -> IntelParse {
    let mut p = analizar_intel(mensaje, sistemas);
    // La BD se saca del estado de la app (el vigilante no la lleva encima). Si algo falla, el aviso
    // sale igual pero sin retratos: nunca se rompe la alerta por un adorno.
    let st = app.state::<AppState>();
    for h in p.hostiles.iter_mut() {
        h.character_id = st.db.intel_char_id(&h.name.to_lowercase()).ok().flatten();
    }
    p
}

/// Enseña la ventana del overlay SIN robarle el foco al juego.
///
/// ⚠️ Aquí NO se llama a `set_focus()`, y es a propósito: robar el foco mientras alguien está en
/// medio de un combate es peor que no avisar. `show()` sobre una ventana `alwaysOnTop` la pinta
/// encima sin activarla. El foco solo se pide cuando el jugador HACE CLIC (ver `overlay_open_main`).
fn mostrar_overlay(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("overlay") {
        // ⚠️ COLOCAR ANTES DE ENSEÑAR, SIEMPRE (2026-08-18). Antes solo se colocaba cuando tocabas
        // los ajustes, y de ahí salían los tres síntomas que reportó RoGiz7 y que parecían tres
        // bugs distintos:
        //   · elegías el monitor secundario y el aviso salía en el principal,
        //   · al reiniciar volvía al principal aunque el ajuste siguiera guardado,
        //   · el botón de prueba también salía en el principal.
        // Son el mismo: la posición se pedía sobre una ventana OCULTA y no sobrevivía, y al arrancar
        // no la pedía nadie. Colocar justo antes del `show()` arregla los tres de una vez, porque
        // es el único instante en que la ventana va a existir de verdad en pantalla.
        // El ORDEN importa: primero el tamaño y luego la esquina, porque colocar usa el tamaño
        // para calcular el punto de anclaje. Al revés, una ventana anclada abajo o a la derecha
        // aparecería descolocada justo el pico que haya cambiado de alto.
        if let Some(h) = OVERLAY_ALTO.lock().ok().and_then(|g| *g) {
            let _ = w.set_size(tauri::LogicalSize::new(430.0, h));
        }
        // La posición LIBRE manda sobre la esquina: si el usuario lo movió a mano, respetarlo es lo
        // único razonable — ha dicho dónde lo quiere con el dedo.
        if let Some((x, y)) = OVERLAY_LIBRE.lock().ok().and_then(|g| *g) {
            let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
        } else if let Some((monitor, corner, margin)) = colocacion_guardada() {
            aplicar_colocacion(&w, monitor, &corner, margin);
        }
        let _ = w.show();
        let _ = w.set_always_on_top(true);
    }
}

/// Limpia un token igual que el frontend (quita puntuación final y `[*(` iniciales) y lo pasa a minúsculas.
fn clean_intel_token(t: &str) -> String {
    let t = t.trim_end_matches(|c: char| "*.,;:!?()".contains(c));
    let t = t.trim_start_matches(|c: char| "*([".contains(c));
    t.trim().to_lowercase()
}

/// BFS multi-origen: distancia (en saltos) al más cercano de varios orígenes.
fn intel_bfs(adj: &std::collections::HashMap<i64, Vec<i64>>, origins: &[i64]) -> std::collections::HashMap<i64, i64> {
    let mut dist = std::collections::HashMap::new();
    let mut q = std::collections::VecDeque::new();
    for &o in origins {
        if dist.insert(o, 0i64).is_none() {
            q.push_back(o);
        }
    }
    while let Some(cur) = q.pop_front() {
        let d = dist[&cur];
        if let Some(ns) = adj.get(&cur) {
            for &nb in ns {
                if !dist.contains_key(&nb) {
                    dist.insert(nb, d + 1);
                    q.push_back(nb);
                }
            }
        }
    }
    dist
}

/// Carga el grafo (nombres↔id + adyacencia) una vez. El frontend lo envía desde neweden.json.
#[tauri::command]
pub fn set_intel_graph(
    state: State<'_, AppState>,
    names: Vec<(String, i64)>,
    edges: Vec<(i64, i64)>,
) -> AppResult<()> {
    let mut g = IntelGraph::default();
    for (n, id) in names {
        g.name_to_id.insert(n.to_lowercase(), id);
        g.id_to_name.entry(id).or_insert(n);
    }
    for (a, b) in edges {
        g.adj.entry(a).or_default().push(b);
        g.adj.entry(b).or_default().push(a);
    }
    if let Ok(mut slot) = state.intel.graph.lock() {
        *slot = g;
    }
    Ok(())
}

/// Arranca (o reconfigura) la vigilancia de intel en segundo plano.
#[tauri::command]
pub fn start_intel_watch(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    folder: String,
    channels: Vec<String>,
    recency_minutes: i64,
    origins: Vec<i64>,
    alert_jumps: i64,
    alerts_enabled: bool,
    // Opcionales para no romper a quien llame sin ellos (y para que el frontend pueda ir por fases).
    pilots: Option<Vec<PilotLoc>>,
    overlay_enabled: Option<bool>,
    anchors: Option<Vec<i64>>,
    muted: Option<Vec<MutedSystem>>,
) -> AppResult<()> {
    if let Ok(mut c) = state.intel.cfg.lock() {
        *c = Some(IntelWatchCfg {
            folder,
            channels,
            recency_min: recency_minutes,
            origins,
            anchors: anchors.unwrap_or_default(),
            muted: muted.unwrap_or_default(),
            pilots: pilots.unwrap_or_default(),
            overlay_enabled: overlay_enabled.unwrap_or(false),
            alert_jumps,
            alerts_enabled,
        });
    }
    // Arrancar el hilo una sola vez; en sucesivas llamadas solo cambia la cfg.
    if !state.intel.started.swap(true, std::sync::atomic::Ordering::SeqCst) {
        spawn_intel_thread(app, state.intel.clone());
    }
    Ok(())
}

/// Detiene la vigilancia (el hilo sigue vivo pero ocioso).
/// NO limpia el set de alertas ya emitidas: así, al reconfigurar (cambiar anclas/recencia/etc.,
/// que hace stop+start) no se re-disparan las alertas que ya viste. Las claves (sid-ts) caducan
/// solas porque los reportes viejos dejan de aparecer por el filtro de recencia.
#[tauri::command]
pub fn stop_intel_watch(state: State<'_, AppState>) -> AppResult<()> {
    if let Ok(mut c) = state.intel.cfg.lock() {
        *c = None;
    }
    Ok(())
}

fn spawn_intel_thread(app: tauri::AppHandle, watch: std::sync::Arc<IntelWatch>) {
    use std::hash::{Hash, Hasher};
    std::thread::spawn(move || {
        // Firma del último conjunto de líneas emitido: si no cambia, no re-emitimos
        // (evita re-render del frontend) ni re-evaluamos matching salvo que cambie la config.
        let mut last_sig: u64 = 0;
        let mut last_cfg_sig: u64 = 0;
        loop {
            // Publicar el estado REAL en cada vuelta: si el hilo está ocioso o petando, la UI tiene
            // que poder decirlo. Antes esto era invisible y el badge mentía con un "Activo" verde.
            let set_status = |s: IntelStatus| {
                if let Ok(mut st) = watch.status.lock() {
                    *st = s;
                }
            };
            let now_ms = chrono::Utc::now().timestamp_millis();

            let cfg = watch.cfg.lock().ok().and_then(|c| c.clone());
            let cfg = match cfg {
                Some(c) => c,
                None => {
                    set_status(IntelStatus {
                        collecting: false,
                        idle_reason: Some("vigilante detenido (sin configuración)".into()),
                        last_tick_ms: now_ms,
                        ..Default::default()
                    });
                    std::thread::sleep(std::time::Duration::from_millis(1000));
                    continue;
                }
            };
            if cfg.channels.is_empty() || cfg.folder.is_empty() {
                set_status(IntelStatus {
                    collecting: false,
                    idle_reason: Some("sin canales o sin carpeta de logs".into()),
                    last_tick_ms: now_ms,
                    ..Default::default()
                });
                std::thread::sleep(std::time::Duration::from_millis(1500));
                continue;
            }
            // NADA de `unwrap_or_default()`: un error de lectura tiene que verse, no convertirse
            // en "0 líneas" con cara de calma. Aquí murieron dos diagnósticos.
            let (lines, files) = match collect_intel_ext(&cfg.folder, &cfg.channels, cfg.recency_min)
            {
                Ok(v) => v,
                Err(e) => {
                    let msg = e.to_string();
                    eprintln!("intel: fallo leyendo logs: {msg}");
                    set_status(IntelStatus {
                        collecting: true,
                        last_error: Some(msg),
                        last_tick_ms: now_ms,
                        ..Default::default()
                    });
                    std::thread::sleep(std::time::Duration::from_millis(3000));
                    continue;
                }
            };
            set_status(IntelStatus {
                collecting: true,
                idle_reason: None,
                last_error: None,
                lines: lines.len() as i64,
                files: files as i64,
                last_tick_ms: now_ms,
            });

            // Firma barata de las líneas y de la config relevante para alertas.
            let mut h = std::collections::hash_map::DefaultHasher::new();
            for l in &lines {
                l.ts_ms.hash(&mut h);
                l.author.hash(&mut h);
                l.message.hash(&mut h);
            }
            let sig = h.finish();
            let mut hc = std::collections::hash_map::DefaultHasher::new();
            cfg.origins.hash(&mut hc);
            cfg.alert_jumps.hash(&mut hc);
            cfg.alerts_enabled.hash(&mut hc); // alternar el maestro reevalúa al momento
            let cfg_sig = hc.finish();

            let lines_changed = sig != last_sig;
            let cfg_changed = cfg_sig != last_cfg_sig;
            // Si nada cambió (ni logs ni config), no hacemos trabajo ni despertamos al frontend.
            if !lines_changed && !cfg_changed {
                std::thread::sleep(std::time::Duration::from_millis(3000));
                continue;
            }
            last_sig = sig;
            last_cfg_sig = cfg_sig;

            // Solo re-emitimos (y re-renderiza el frontend) cuando cambian las líneas.
            if lines_changed {
                let _ = app.emit("intel-lines", &lines);
            }

            // Matching de sistemas + proximidad + alertas, con el grafo cargado.
            if let Ok(g) = watch.graph.lock() {
                if !g.name_to_id.is_empty() {
                    // rep: sistema -> (ts_ms, autor, mensaje), aplicando clears.
                    let mut rep: std::collections::HashMap<i64, (i64, String, String)> =
                        std::collections::HashMap::new();
                    for l in &lines {
                        let mut is_clear = false;
                        let mut matched: Vec<i64> = Vec::new();
                        for tok in l.message.split_whitespace() {
                            let c = clean_intel_token(tok);
                            if c.is_empty() {
                                continue;
                            }
                            if c == "clr" || c == "clear" || c == "cleared" {
                                is_clear = true;
                                continue;
                            }
                            if let Some(&sid) = g.name_to_id.get(&c) {
                                matched.push(sid);
                            }
                        }
                        for sid in matched {
                            if is_clear {
                                rep.remove(&sid);
                            } else {
                                rep.insert(sid, (l.ts_ms, l.author.clone(), l.message.clone()));
                            }
                        }
                    }
                    // Proximidad desde los orígenes (pj + anclas).
                    if !cfg.origins.is_empty() {
                        let dist = intel_bfs(&g.adj, &cfg.origins);
                        for (sid, (ts, author, message)) in &rep {
                            if let Some(&d) = dist.get(sid) {
                                if d <= cfg.alert_jumps {
                                    let key = format!("{sid}-{ts}");
                                    let is_new = watch
                                        .alerted
                                        .lock()
                                        .map(|mut a| a.insert(key))
                                        .unwrap_or(false);
                                    // `is_new` se registra SIEMPRE (aunque no alertemos): así, al
                                    // reactivar las alertas no se dispara de golpe todo lo que pasó
                                    // mientras estaban apagadas. La ALERTA en sí (notificación +
                                    // evento) solo sale si el interruptor maestro está ON.
                                    //
                                    // SILENCIO POR SISTEMA. Va aquí dentro y no antes justamente
                                    // para que se beneficie de lo de arriba: el reporte queda
                                    // marcado como visto aunque no suene, así que quitar el
                                    // silencio no te vacía encima toda la noche de golpe.
                                    // El silencio caducado no silencia: se compara con el reloj,
                                    // no hace falta que nadie lo limpie.
                                    let ahora_ms = chrono::Utc::now().timestamp_millis();
                                    let silenciado = cfg.muted.iter().any(|m| {
                                        m.system_id == *sid
                                            && m.until_ms.map(|u| u > ahora_ms).unwrap_or(true)
                                    });
                                    if is_new && cfg.alerts_enabled && !silenciado {
                                        let system = g
                                            .id_to_name
                                            .get(sid)
                                            .cloned()
                                            .unwrap_or_else(|| sid.to_string());
                                        // Notificación nativa del SO (visible/audible minimizado).
                                        use tauri_plugin_notification::NotificationExt;
                                        let _ = app
                                            .notification()
                                            .builder()
                                            .title(format!("⚠ Intel a {d} salto(s): {system}"))
                                            .body(format!("{author}: {message}"))
                                            .show();
                                        // Sin anclas puestas se cae a los ORÍGENES (tu propio
                                        // sistema). Parece un detalle y es el último agujero por
                                        // el que el número salía sin dueño: quien no usa anclas y
                                        // tiene los pilotos fuera del grafo veía «4 saltos» a
                                        // secas. Nombrar el origen cuesta un `get` en el mapa.
                                        let refs: &[i64] = if cfg.anchors.is_empty() {
                                            &cfg.origins
                                        } else {
                                            &cfg.anchors
                                        };
                                        let (pilots, anchor) =
                                            contexto_cerca(&g.adj, &g.id_to_name, &cfg.pilots, refs, *sid);
                                        let _ = app.emit(
                                            "intel-alert",
                                            IntelAlertEvent {
                                                sys_id: *sid,
                                                system,
                                                jumps: d,
                                                author: author.clone(),
                                                message: message.clone(),
                                                ts_ms: *ts,
                                                pilots,
                                                anchor,
                                                parse: hostiles_de(&app, &g.name_to_id, message),
                                            },
                                        );
                                        // El overlay se despierta SOLO si el jugador lo encendió.
                                        // Apagado de fábrica: un aviso flotante que aparece sin
                                        // que nadie lo pida es motivo de desinstalación.
                                        if cfg.overlay_enabled {
                                            mostrar_overlay(&app);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(3000));
        }
    });
}

#[derive(Debug, Serialize)]
pub struct IntelEntity {
    pub id: i64,
    pub name: String,
}
#[derive(Debug, Serialize)]
pub struct IntelEntities {
    pub characters: Vec<IntelEntity>,
    pub ships: Vec<IntelEntity>,
}

/// Resuelve una lista de nombres candidatos (de una línea de intel) a personajes y naves.
/// El frontend lo usa al abrir la tarjeta de detalle para enlazar a zKill y distinguir piloto/nave.
#[tauri::command]
pub async fn resolve_intel_entities(
    state: State<'_, AppState>,
    names: Vec<String>,
) -> AppResult<IntelEntities> {
    // Caché negativa: re-preguntar a ESI pasados N días por si el nombre se creó/renombró.
    const NEG_TTL_DAYS: i64 = 7;
    let now = chrono::Utc::now();
    let mut chars: Vec<IntelEntity> = Vec::new();
    let mut seen_ids: HashSet<i64> = HashSet::new();
    let mut unknown: Vec<String> = Vec::new();

    // 1) Resolver primero desde el índice local (0 red).
    for name in &names {
        let nl = name.trim().to_lowercase();
        if nl.is_empty() {
            continue;
        }
        match state.db.name_cache_get(&nl) {
            Some((Some(id), disp, _)) if id > 0 => {
                if seen_ids.insert(id) {
                    chars.push(IntelEntity {
                        id,
                        name: disp.unwrap_or_else(|| name.trim().to_string()),
                    });
                }
            }
            Some((Some(id), _, updated)) if id == -1 => {
                // negativa: válida solo si es reciente; si caducó, reintentar
                let fresh = updated
                    .and_then(|u| chrono::DateTime::parse_from_rfc3339(&u).ok())
                    .map(|t| now.signed_duration_since(t.with_timezone(&chrono::Utc)).num_days() < NEG_TTL_DAYS)
                    .unwrap_or(false);
                if !fresh {
                    unknown.push(name.trim().to_string());
                }
            }
            _ => unknown.push(name.trim().to_string()),
        }
    }

    // 2) Los desconocidos → ESI (una sola llamada en lote) y se cachean.
    if !unknown.is_empty() {
        let (esi_chars, _ships) = state.esi.resolve_entities(&unknown).await?;
        let mut resolved_lc: HashSet<String> = HashSet::new();
        for (id, nm) in esi_chars {
            state.db.name_cache_put(&nm.to_lowercase(), id, &nm);
            resolved_lc.insert(nm.to_lowercase());
            if seen_ids.insert(id) {
                chars.push(IntelEntity { id, name: nm });
            }
        }
        // Lo que mandamos y ESI NO devolvió como personaje → caché negativa.
        for n in &unknown {
            let nl = n.to_lowercase();
            if !resolved_lc.contains(&nl) {
                state.db.name_cache_put_negative(&nl);
            }
        }
    }

    Ok(IntelEntities {
        characters: chars,
        ships: Vec::new(),
    })
}

#[derive(Debug, serde::Deserialize)]
pub struct IntelSighting {
    pub name: String,
    #[serde(default)]
    pub system_id: Option<i64>,
    #[serde(default)]
    pub ts_ms: Option<i64>,
    #[serde(default)]
    pub ship_type_id: Option<i64>,
}

/// Registra avistamientos de pilotos del intel (cuenta menciones y último sistema). El frontend
/// envía SOLO las líneas nuevas (ya clasificadas: nombres que son piloto, no nave/jerga/sistema).
/// Cuando un nombre cruza `threshold` menciones y sigue sin resolver, se resuelve 1 vez por ESI
/// (en lote, acotado) → así un cazador habitual que NO está en Rivales/killmails acaba en el índice.
#[tauri::command]
pub async fn intel_record_sightings(
    state: State<'_, AppState>,
    sightings: Vec<IntelSighting>,
    threshold: Option<i64>,
) -> AppResult<usize> {
    for s in &sightings {
        let nl = s.name.trim().to_lowercase();
        if nl.is_empty() {
            continue;
        }
        state
            .db
            .name_cache_record_sighting(&nl, s.name.trim(), s.system_id);
        // Avistamiento persistente (modo cazador): requiere sistema y hora de la línea.
        if let (Some(system_id), Some(ts_ms)) = (s.system_id, s.ts_ms) {
            let cid = state
                .db
                .name_cache_get(&nl)
                .and_then(|(id, _, _)| id)
                .filter(|&x| x > 0);
            state
                .db
                .insert_sighting(&nl, cid, system_id, ts_ms, s.ship_type_id);
        }
    }
    // Auto-resolución diferida de los que ya son "habituales" y siguen sin id.
    let thr = threshold.unwrap_or(5).max(2);
    let due = state.db.name_cache_due_for_resolve(thr, 20);
    let mut resolved = 0usize;
    if !due.is_empty() {
        if let Ok((esi_chars, _ships)) = state.esi.resolve_entities(&due).await {
            let mut ok_lc: HashSet<String> = HashSet::new();
            for (id, nm) in esi_chars {
                state.db.name_cache_put(&nm.to_lowercase(), id, &nm);
                ok_lc.insert(nm.to_lowercase());
                resolved += 1;
            }
            // Los que ESI no devolvió como personaje → caché negativa (no reintentar en bucle).
            for n in &due {
                let nl = n.to_lowercase();
                if !ok_lc.contains(&nl) {
                    state.db.name_cache_put_negative(&nl);
                }
            }
        }
    }
    Ok(resolved)
}

/// Ranking de "hostiles habituales": pilotos más mencionados en intel (aprendidos del propio chat).
/// `last_system_id` lo mapea el frontend a nombre con su índice de sistemas.
#[tauri::command]
pub fn get_habitual_hostiles(
    state: State<'_, AppState>,
    min_count: Option<i64>,
    limit: Option<i64>,
) -> AppResult<Vec<crate::db::HabitualHostile>> {
    Ok(state
        .db
        .name_cache_habitual(min_count.unwrap_or(3).max(1), limit.unwrap_or(100)))
}

#[derive(Debug, serde::Serialize)]
pub struct TrackPoint {
    pub system_id: i64,
    pub ts_ms: i64,
}

/// Rastro histórico de un piloto (modo cazador): sus avistamientos persistentes (sistema + hora)
/// en orden cronológico, para pintar la polilínea del objetivo en el mapa entre sesiones.
#[tauri::command]
pub fn get_pilot_track(
    state: State<'_, AppState>,
    name: String,
    limit: Option<i64>,
) -> AppResult<Vec<TrackPoint>> {
    let nl = name.trim().to_lowercase();
    let pts = state.db.pilot_track(&nl, limit.unwrap_or(200).clamp(1, 1000));
    Ok(pts
        .into_iter()
        .map(|(system_id, ts_ms)| TrackPoint { system_id, ts_ms })
        .collect())
}

#[derive(Debug, serde::Serialize)]
pub struct CountItem {
    pub id: i64,
    pub count: i64,
}
#[derive(Debug, serde::Serialize)]
pub struct PilotProfile {
    pub name: String,
    pub character_id: Option<i64>,
    pub total: i64,
    pub first_ms: Option<i64>,
    pub last_ms: Option<i64>,
    pub by_system: Vec<CountItem>, // id = system_id
    pub by_ship: Vec<CountItem>,   // id = ship_type_id
    pub by_hour: Vec<i64>,         // 24 buckets (hora UTC 0-23)
}

/// Ficha del hostil (modo cazador): perfil agregado de un objetivo a partir de sus avistamientos
/// persistentes — total, primer/último visto, sistemas favoritos, naves y horas activas UTC.
#[tauri::command]
pub fn get_pilot_profile(state: State<'_, AppState>, name: String) -> AppResult<PilotProfile> {
    let nl = name.trim().to_lowercase();
    let (total, first_ms, last_ms, mut character_id) = state.db.pilot_stats(&nl);
    // Fichados por nombre (Fase 3.5) o aprendidos aún sin avistamientos: el id vive en
    // name_cache aunque intel_sightings no tenga filas. Sin este respaldo, la ficha del
    // recién fichado saldría sin retrato ni botón de zKill.
    if character_id.is_none() {
        character_id = state
            .db
            .name_cache_get(&nl)
            .and_then(|(id, _, _)| id)
            .filter(|&x| x > 0);
    }
    let by_system = state
        .db
        .pilot_by_system(&nl, 12)
        .into_iter()
        .map(|(id, count)| CountItem { id, count })
        .collect();
    let by_ship = state
        .db
        .pilot_by_ship(&nl, 10)
        .into_iter()
        .map(|(id, count)| CountItem { id, count })
        .collect();
    let by_hour = state.db.pilot_by_hour(&nl).to_vec();
    Ok(PilotProfile {
        name: name.trim().to_string(),
        character_id,
        total,
        first_ms,
        last_ms,
        by_system,
        by_ship,
        by_hour,
    })
}

/// Resultado de importar el CSV de wallet de corptools.
#[derive(Debug, serde::Serialize)]
pub struct ImportResult {
    pub total_rows: usize,        // filas leídas del CSV
    pub imported: usize,          // filas NUEVAS insertadas
    pub skipped_dup: usize,       // ya existían (dedup por id sintético)
    pub skipped_unknown: usize,   // Character no está entre tus personajes de Koru
    pub date_min: Option<String>, // rango del histórico importable
    pub date_max: Option<String>,
    pub by_char: Vec<(String, usize)>, // filas por personaje (de las reconocidas)
}

/// Fila del CSV de corptools. First/Second Party (nombres, no ids) se ignoran a propósito.
/// `Reason` SÍ se guarda: no es el formato de ESI (`typeID: n`) sino texto legible con el desglose
/// de ratas ("3x Gist Seraphim @ 1,300,000 ISK"), del que salen las ratas muertas y el bounty bruto.
#[derive(serde::Deserialize)]
struct CorptoolsRow {
    #[serde(rename = "Character")]
    character: String,
    #[serde(rename = "Date")]
    date: String,
    #[serde(rename = "Type")]
    ref_type: String,
    #[serde(rename = "amount", default)]
    amount: Option<f64>,
    #[serde(rename = "balance", default)]
    balance: Option<f64>,
    #[serde(rename = "Description", default)]
    description: String,
    #[serde(rename = "Reason", default)]
    reason: String,
}

/// Importa el histórico de wallet exportado por corptools (Alliance Auth) a `wallet_journal`,
/// backfilleando años más allá de la ventana de ESI. Mapea Character(nombre)→character_id de TUS
/// personajes; genera un id SINTÉTICO NEGATIVO determinista (hash de char+fecha+tipo+amount+balance)
/// para dedup y para no colisionar con los ids reales de ESI (positivos). No trae reason/context_id
/// (el desglose por sistema y las ratas especiales del histórico no se pueden reconstruir del CSV).
#[tauri::command]
pub async fn import_wallet_csv(path: String, state: State<'_, AppState>) -> AppResult<ImportResult> {
    use std::collections::HashMap;
    use std::hash::{Hash, Hasher};

    // Mapa nombre(minúsculas) → character_id de tus personajes.
    let name_to_id: HashMap<String, i64> = state
        .db
        .list_characters()?
        .into_iter()
        .map(|c| (c.name.trim().to_lowercase(), c.character_id))
        .collect();

    let bytes = std::fs::read(&path)
        .map_err(|e| AppError::Other(format!("no se pudo leer el CSV: {e}")))?;
    let mut rdr = csv::ReaderBuilder::new()
        .flexible(true)
        .from_reader(bytes.as_slice());

    let mut rows: Vec<crate::db::JournalImportRow> = Vec::new();
    let mut total = 0usize;
    let mut skipped_unknown = 0usize;
    let mut by_char: HashMap<String, usize> = HashMap::new();
    let mut date_min: Option<String> = None;
    let mut date_max: Option<String> = None;

    for rec in rdr.deserialize::<CorptoolsRow>() {
        let r = match rec {
            Ok(r) => r,
            Err(_) => continue, // fila malformada → saltar
        };
        total += 1;
        let cid = match name_to_id.get(r.character.trim().to_lowercase().as_str()) {
            Some(&id) => id,
            None => {
                skipped_unknown += 1;
                continue;
            }
        };
        // id sintético negativo determinista.
        let mut h = std::collections::hash_map::DefaultHasher::new();
        cid.hash(&mut h);
        r.date.hash(&mut h);
        r.ref_type.hash(&mut h);
        r.amount.unwrap_or(0.0).to_bits().hash(&mut h);
        r.balance.unwrap_or(0.0).to_bits().hash(&mut h);
        let id: i64 = -((h.finish() >> 1) as i64) - 1;

        if date_min.as_deref().map_or(true, |d| r.date.as_str() < d) {
            date_min = Some(r.date.clone());
        }
        if date_max.as_deref().map_or(true, |d| r.date.as_str() > d) {
            date_max = Some(r.date.clone());
        }
        *by_char.entry(r.character.clone()).or_insert(0) += 1;

        let desc = r.description.trim();
        rows.push(crate::db::JournalImportRow {
            id,
            character_id: cid,
            date: r.date,
            ref_type: r.ref_type,
            amount: r.amount,
            balance: r.balance,
            description: if desc.is_empty() {
                None
            } else {
                Some(desc.to_string())
            },
            reason: {
                let rs = r.reason.trim();
                if rs.is_empty() { None } else { Some(rs.to_string()) }
            },
        });
    }

    let imported = state.db.import_journal_rows(&rows).unwrap_or(0);
    // El CSV suele solapar con la ventana de ~30 días de ESI. Sin esto, esas transacciones quedaban
    // por duplicado (id sintético + id real) e inflaban wallet, rateo y patrimonio al DOBLE.
    let deduped = state.db.journal_drop_synthetic_dupes().unwrap_or(0);
    let skipped_dup = rows.len().saturating_sub(imported) + deduped;
    let mut by_char_v: Vec<(String, usize)> = by_char.into_iter().collect();
    by_char_v.sort_by(|a, b| b.1.cmp(&a.1));

    Ok(ImportResult {
        total_rows: total,
        imported,
        skipped_dup,
        skipped_unknown,
        date_min,
        date_max,
        by_char: by_char_v,
    })
}

/// Niveles de skill entrenados del personaje (skill_id → nivel activo). Para el skill-check de fits.
#[tauri::command]
pub async fn get_char_skill_levels(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<std::collections::HashMap<i64, i64>> {
    let token =
        token_with_scope(&state, character_id, "esi-skills.read_skills.v1", "Skills").await?;
    let s = skills::skills(&state.esi, &state.db, character_id, &token).await?;
    let mut m = std::collections::HashMap::new();
    for sk in &s.skills {
        m.insert(sk.skill_id, sk.active_skill_level);
    }
    Ok(m)
}

/// Lista detallada de assets global (todos los personajes con el scope).
#[tauri::command]
pub async fn get_assets_detail_global(state: State<'_, AppState>) -> AppResult<Vec<AssetDetailView>> {
    use std::collections::HashMap;
    let all_tokens = structure_tokens(&state).await;
    // Clave: (type, system, UBICACIÓN RAÍZ, nombre ubicación, contenedor, container_id,
    // container_type, slot). El location_id va en la clave para que dos personajes con el mismo
    // material en estructuras DISTINTAS no se fusionen (lo necesita «En instalación» en Global).
    // `assembled` al final de la clave: montado y empaquetado no se funden, porque no ocupan lo
    // mismo (un Bestower son 20.000 m³ empaquetado y 260.000 montado).
    let mut agg: HashMap<(i64, i64, i64, String, Option<String>, i64, i64, String, bool), i64> =
        HashMap::new();
    for c in state.db.list_characters()? {
        if !c.scopes.iter().any(|s| s == "esi-assets.read_assets.v1") {
            continue;
        }
        let valid = match state
            .tokens
            .access_token(state.esi.http(), c.character_id)
            .await
        {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Ok(rows) =
            assets::detail(&state.esi, &state.db, c.character_id, &valid.access_token, &all_tokens)
                .await
        {
            for r in rows {
                *agg
                    .entry((
                        r.type_id,
                        r.system_id,
                        r.location_id,
                        r.location_name,
                        r.container,
                        r.container_id,
                        r.container_type_id,
                        r.slot,
                        r.assembled,
                    ))
                    .or_insert(0) += r.quantity;
            }
        }
    }
    let mut rows: Vec<crate::esi::assets::AssetDetailRow> = agg
        .into_iter()
        .map(
            |(
                (
                    type_id,
                    system_id,
                    location_id,
                    location_name,
                    container,
                    container_id,
                    container_type_id,
                    slot,
                    assembled,
                ),
                quantity,
            )| {
                crate::esi::assets::AssetDetailRow {
                    type_id,
                    quantity,
                    system_id,
                    location_id,
                    location_name,
                    container,
                    container_id,
                    container_type_id,
                    slot,
                    assembled,
                }
            },
        )
        .collect();
    rows.sort_by(|a, b| b.quantity.cmp(&a.quantity));
    resolve_asset_detail(&state.esi, &state.db, rows).await
}

/// Una orden de mercado tal cual la devuelve ESI (campos que usamos).
#[derive(Debug, Clone, serde::Deserialize)]
struct OrderRaw {
    type_id: i64,
    #[serde(default)]
    order_id: i64,
    #[serde(default)]
    region_id: i64,
    #[serde(default)]
    is_buy_order: bool,
    #[serde(default)]
    price: f64,
    #[serde(default)]
    volume_remain: i64,
    #[serde(default)]
    volume_total: i64,
    #[serde(default)]
    location_id: i64,
    #[serde(default)]
    duration: i64,
    #[serde(default)]
    issued: Option<String>,
}

/// Vista de una orden de mercado con nombres resueltos.
#[derive(Debug, Serialize)]
pub struct MarketOrderView {
    pub type_id: i64,
    pub type_name: Option<String>,
    pub is_buy: bool,
    pub price: f64,
    pub volume_remain: i64,
    pub volume_total: i64,
    pub system_id: i64,
    pub system_name: Option<String>,
    pub issued: Option<String>,
    pub duration: i64, // días de la orden (para calcular el vencimiento)
    // Competencia en TU misma estación (mismo tipo/lado, excluyendo tus órdenes):
    pub best_competitor: Option<f64>, // mejor precio rival (menor sell / mayor buy); None si no hay
    pub is_best: bool,                // ¿eres el mejor (no te han pisado)?
    pub competitors: i64,             // nº de órdenes rivales en tu estación
}

/// Resuelve sistema (caché) y nombres para una lista de órdenes.
async fn resolve_orders(
    esi: &EsiClient,
    db: &Db,
    token: &str,
    orders: Vec<OrderRaw>,
) -> AppResult<Vec<MarketOrderView>> {
    use std::collections::HashMap;
    // --- Competencia: libro público por (región, tipo, lado), una vez por combinación. ---
    let own_ids: HashSet<i64> = orders.iter().map(|o| o.order_id).collect();
    let mut books: HashMap<(i64, i64, bool), Vec<crate::esi::market::BookOrder>> = HashMap::new();
    for o in &orders {
        let key = (o.region_id, o.type_id, o.is_buy_order);
        if o.region_id != 0 && !books.contains_key(&key) {
            let ot = if o.is_buy_order { "buy" } else { "sell" };
            let book = crate::esi::market::region_orders(esi, db, o.region_id, o.type_id, ot).await;
            books.insert(key, book);
        }
    }

    // --- Sistemas (caché) + nombres. ---
    let mut sys_of: HashMap<i64, i64> = HashMap::new();
    for o in &orders {
        if !sys_of.contains_key(&o.location_id) {
            let s = crate::esi::assets::resolve_location_system_cached(esi, db, o.location_id, token)
                .await
                .unwrap_or(0);
            sys_of.insert(o.location_id, s);
        }
    }
    let mut ids: HashSet<i64> = HashSet::new();
    for o in &orders {
        ids.insert(o.type_id);
    }
    for s in sys_of.values() {
        if *s != 0 {
            ids.insert(*s);
        }
    }
    let names = esi
        .resolve_names(&ids.into_iter().collect::<Vec<_>>())
        .await
        .unwrap_or_default();

    Ok(orders
        .into_iter()
        .map(|o| {
            let sid = *sys_of.get(&o.location_id).unwrap_or(&0);
            // Competencia en TU MISMA estación, mismo lado, excluyendo tus propias órdenes.
            let empty: Vec<crate::esi::market::BookOrder> = Vec::new();
            let book = books
                .get(&(o.region_id, o.type_id, o.is_buy_order))
                .unwrap_or(&empty);
            let comp: Vec<f64> = book
                .iter()
                .filter(|b| b.location_id == o.location_id && !own_ids.contains(&b.order_id))
                .map(|b| b.price)
                .collect();
            let competitors = comp.len() as i64;
            let best_competitor = if comp.is_empty() {
                None
            } else if o.is_buy_order {
                Some(comp.iter().cloned().fold(f64::NEG_INFINITY, f64::max))
            } else {
                Some(comp.iter().cloned().fold(f64::INFINITY, f64::min))
            };
            let is_best = match best_competitor {
                None => true,
                Some(bc) => {
                    if o.is_buy_order {
                        o.price >= bc
                    } else {
                        o.price <= bc
                    }
                }
            };
            MarketOrderView {
                type_id: o.type_id,
                type_name: names.get(&o.type_id).cloned(),
                is_buy: o.is_buy_order,
                price: o.price,
                volume_remain: o.volume_remain,
                volume_total: o.volume_total,
                system_id: sid,
                system_name: if sid != 0 { names.get(&sid).cloned() } else { None },
                issued: o.issued,
                duration: o.duration,
                best_competitor,
                is_best,
                competitors,
            }
        })
        .collect())
}

/// Órdenes de mercado abiertas de un personaje (Comercio).
#[tauri::command]
pub async fn get_market_orders(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<MarketOrderView>> {
    let token = token_with_scope(
        &state,
        character_id,
        "esi-markets.read_character_orders.v1",
        "Wallet",
    )
    .await?;
    let orders: Vec<OrderRaw> = state
        .esi
        .get_cached(
            &state.db,
            character_id,
            &format!("/characters/{character_id}/orders/"),
            Some(&token),
        )
        .await?;
    resolve_orders(&state.esi, &state.db, &token, orders).await
}

/// Órdenes de mercado global (todos los personajes con el scope).
#[tauri::command]
pub async fn get_market_orders_global(
    state: State<'_, AppState>,
) -> AppResult<Vec<MarketOrderView>> {
    let mut all: Vec<MarketOrderView> = Vec::new();
    for c in state.db.list_characters()? {
        if !c
            .scopes
            .iter()
            .any(|s| s == "esi-markets.read_character_orders.v1")
        {
            continue;
        }
        let valid = match state
            .tokens
            .access_token(state.esi.http(), c.character_id)
            .await
        {
            Ok(v) => v,
            Err(_) => continue,
        };
        let cid = c.character_id;
        if let Ok(orders) = state
            .esi
            .get_cached::<Vec<OrderRaw>>(
                &state.db,
                cid,
                &format!("/characters/{cid}/orders/"),
                Some(&valid.access_token),
            )
            .await
        {
            if let Ok(mut v) = resolve_orders(&state.esi, &state.db, &valid.access_token, orders).await {
                all.append(&mut v);
            }
        }
    }
    Ok(all)
}

/// Beneficio de trading REALIZADO por item (coste medio ponderado) desde las wallet_transactions.
#[derive(Debug, serde::Serialize)]
pub struct TradePnlItem {
    pub type_id: i64,
    pub name: Option<String>,
    pub bought_qty: i64,
    pub sold_qty: i64,
    pub avg_buy: f64,
    pub avg_sell: f64,
    pub revenue: f64, // total vendido
    pub cost: f64,    // coste (medio ponderado) de lo vendido
    pub profit: f64,  // revenue - cost (realizado, antes de impuestos)
    pub margin: f64,  // profit / revenue * 100
}
#[derive(Debug, serde::Serialize)]
pub struct PnlDay {
    pub date: String,
    pub profit: f64,
}
#[derive(Debug, serde::Serialize)]
pub struct TradePnl {
    pub total_profit: f64,
    pub total_revenue: f64,
    pub total_cost: f64,
    pub total_tax: f64, // transaction_tax + brokers_fee del journal
    pub items: Vec<TradePnlItem>,
    pub daily: Vec<PnlDay>, // beneficio realizado por día (fecha de venta)
}

#[derive(Default)]
struct PnlAcc {
    qty: i64,
    cost: f64,
    bought_qty: i64,
    bought_cost: f64,
    sold_qty: i64,
    revenue: f64,
    cogs: f64,
}

/// Coste medio ponderado: cada compra aumenta inventario+coste; cada venta realiza beneficio
/// (ingreso − coste medio de lo vendido). Si se vende más de lo comprado (histórico incompleto),
/// el inventario no baja de 0 (ese beneficio queda sobreestimado por falta de base de coste).
/// Devuelve (por-tipo, beneficio diario) — el diario atribuye el beneficio a la fecha de VENTA.
fn compute_pnl(
    txs: Vec<(String, i64, i64, f64, bool)>,
) -> (
    std::collections::HashMap<i64, PnlAcc>,
    std::collections::BTreeMap<String, f64>,
) {
    use std::collections::{BTreeMap, HashMap};
    let mut m: HashMap<i64, PnlAcc> = HashMap::new();
    let mut daily: BTreeMap<String, f64> = BTreeMap::new();
    for (date, type_id, quantity, price, is_buy) in txs {
        let a = m.entry(type_id).or_default();
        if is_buy {
            a.qty += quantity;
            a.cost += quantity as f64 * price;
            a.bought_qty += quantity;
            a.bought_cost += quantity as f64 * price;
        } else {
            let avg = if a.qty > 0 { a.cost / a.qty as f64 } else { 0.0 };
            let cogs = avg * quantity as f64;
            let profit_sale = quantity as f64 * price - cogs;
            a.sold_qty += quantity;
            a.revenue += quantity as f64 * price;
            a.cogs += cogs;
            a.qty -= quantity;
            a.cost -= cogs;
            if a.qty < 0 {
                a.qty = 0;
                a.cost = 0.0;
            }
            if date.len() >= 10 {
                *daily.entry(date[..10].to_string()).or_insert(0.0) += profit_sale;
            }
        }
    }
    (m, daily)
}

async fn build_pnl(
    esi: &EsiClient,
    db: &Db,
    character_id: Option<i64>,
) -> AppResult<TradePnl> {
    let txs = db.wallet_transactions_full(character_id)?;
    let (accs, daily_map) = compute_pnl(txs);
    let daily: Vec<PnlDay> = daily_map
        .into_iter()
        .map(|(date, profit)| PnlDay { date, profit })
        .collect();
    let mut items: Vec<TradePnlItem> = accs
        .into_iter()
        .filter(|(_, a)| a.sold_qty > 0) // solo lo realizado (vendido)
        .map(|(type_id, a)| {
            let profit = a.revenue - a.cogs;
            TradePnlItem {
                type_id,
                name: None,
                bought_qty: a.bought_qty,
                sold_qty: a.sold_qty,
                avg_buy: if a.bought_qty > 0 {
                    a.bought_cost / a.bought_qty as f64
                } else {
                    0.0
                },
                avg_sell: if a.sold_qty > 0 {
                    a.revenue / a.sold_qty as f64
                } else {
                    0.0
                },
                revenue: a.revenue,
                cost: a.cogs,
                profit,
                margin: if a.revenue > 0.0 {
                    profit / a.revenue * 100.0
                } else {
                    0.0
                },
            }
        })
        .collect();
    items.sort_by(|x, y| y.profit.partial_cmp(&x.profit).unwrap_or(std::cmp::Ordering::Equal));
    let total_profit: f64 = items.iter().map(|i| i.profit).sum();
    let total_revenue: f64 = items.iter().map(|i| i.revenue).sum();
    let total_cost: f64 = items.iter().map(|i| i.cost).sum();
    let total_tax = db.trading_tax(character_id);
    items.truncate(100); // el desglose muestra el top; los totales son de todo
    let ids: Vec<i64> = items.iter().map(|i| i.type_id).collect();
    if let Ok(names) = esi.resolve_names(&ids).await {
        for it in items.iter_mut() {
            it.name = names.get(&it.type_id).cloned();
        }
    }
    Ok(TradePnl {
        total_profit,
        total_revenue,
        total_cost,
        total_tax,
        items,
        daily,
    })
}

/// P&L de trading de un personaje (realizado por item, desde sus transacciones).
#[tauri::command]
pub async fn get_trading_pnl(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<TradePnl> {
    build_pnl(&state.esi, &state.db, Some(character_id)).await
}
/// P&L de trading GLOBAL (todas las transacciones de todos los personajes).
#[tauri::command]
pub async fn get_trading_pnl_global(state: State<'_, AppState>) -> AppResult<TradePnl> {
    build_pnl(&state.esi, &state.db, None).await
}

// ===================== Watchlist de mercado (Comercio Nivel 3) =====================

/// Estación principal (hub) de cada región comercial. Para dar precios de hub reales
/// (p.ej. Jita 4-4) en vez del mejor de toda la región (que mezcla estaciones lejanas).
fn hub_station_for_region(region_id: i64) -> i64 {
    match region_id {
        10000002 => 60003760, // The Forge  → Jita IV-4 CNAP
        10000043 => 60008494, // Domain     → Amarr VIII (Oris)
        10000032 => 60011866, // Sinq Laison→ Dodixie IX-20
        10000030 => 60004588, // Heimatar   → Rens VI-8
        10000042 => 60005686, // Metropolis → Hek VIII-12
        _ => 0,
    }
}

/// Precio REAL de comprar algo ahora mismo: la mejor orden de VENTA en el hub.
///
/// ⚠️ POR QUÉ EXISTE ESTO (2026-08-13). Koru estimaba el coste de entrada de una run con
/// `average_price`, que viene de `/markets/prices/` y es **una media global de todo New Eden**.
/// Para cosas de nicho como los filamentos abisales esa media se queda MUY por debajo de lo que de
/// verdad pagas en Jita — lo notó un jugador que corre el contenido: «lo toma muy bajo al precio
/// del filamento». Y tiene sentido: tú no compras a la media del universo, compras la orden de
/// venta más barata del sitio donde estás.
///
/// Cae a `average_price` si el hub no tiene órdenes de ese tipo: un 0 sería peor que una media
/// imperfecta, porque un coste de entrada de cero convierte cualquier run en rentable.
#[tauri::command]
pub async fn get_hub_sell_prices(
    ids: Vec<i64>,
    region_id: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<std::collections::HashMap<i64, f64>> {
    let region = region_id.unwrap_or(10000002); // The Forge (Jita) por defecto
    let hub = hub_station_for_region(region);
    let medias = state.db.prices_map().unwrap_or_default();
    let mut out = std::collections::HashMap::new();
    for id in ids {
        let sells = crate::esi::market::region_orders(&state.esi, &state.db, region, id, "sell").await;
        // Del hub si las hay; si no, de toda la región. Mismo criterio que el watchlist.
        let en_hub: Vec<f64> = sells
            .iter()
            .filter(|o| hub == 0 || o.location_id == hub)
            .map(|o| o.price)
            .collect();
        let lista = if en_hub.is_empty() {
            sells.iter().map(|o| o.price).collect::<Vec<f64>>()
        } else {
            en_hub
        };
        let mejor = lista.into_iter().fold(f64::INFINITY, f64::min);
        if mejor.is_finite() && mejor > 0.0 {
            out.insert(id, mejor);
        } else if let Some(m) = medias.get(&id) {
            out.insert(id, *m);
        }
    }
    Ok(out)
}

/// Un punto del histórico de precio/volumen (para la gráfica de tendencia).
#[derive(Debug, Serialize)]
pub struct HistPoint {
    pub date: String,
    pub average: f64,
    pub volume: i64,
}

/// Un nivel de precio del libro (órdenes agregadas al mismo precio), con volumen acumulado.
#[derive(Debug, Serialize)]
pub struct BookLevel {
    pub price: f64,
    pub volume: i64, // unidades a ese precio
    pub orders: i64, // nº de órdenes apiladas a ese precio
    pub cum: i64,    // volumen acumulado desde el mejor precio (para la barra de profundidad)
}

/// Un ítem vigilado con su foto de mercado (spread en el hub + tendencia histórica + libro).
#[derive(Debug, Serialize)]
pub struct WatchItem {
    pub type_id: i64,
    pub name: Option<String>,
    pub best_buy: f64,     // mejor compra en el hub (0 si no hay órdenes)
    pub best_sell: f64,    // mejor venta en el hub (0 si no hay órdenes)
    pub spread: f64,       // best_sell - best_buy
    pub margin: f64,       // (sell - buy) / sell  (fracción; UI la muestra en %)
    pub day_volume: i64,   // volumen del último día del histórico (región)
    pub avg_volume: i64,   // volumen medio de los últimos ~30 días (región)
    pub history: Vec<HistPoint>, // últimos ~120 días
    pub buy_levels: Vec<BookLevel>,  // paredes de compra (mayor precio primero), top niveles
    pub sell_levels: Vec<BookLevel>, // paredes de venta (menor precio primero), top niveles
}

/// Agrega órdenes por precio en niveles y calcula el volumen acumulado.
/// `is_buy` ordena mayor→menor (bids); si no, menor→mayor (asks). Devuelve los `top` mejores.
fn aggregate_levels(
    orders: &[crate::esi::market::BookOrder],
    is_buy: bool,
    top: usize,
) -> Vec<BookLevel> {
    use std::collections::HashMap;
    let mut by_price: HashMap<u64, (f64, i64, i64)> = HashMap::new();
    for o in orders {
        let e = by_price.entry(o.price.to_bits()).or_insert((o.price, 0, 0));
        e.1 += o.volume_remain;
        e.2 += 1;
    }
    let mut levels: Vec<(f64, i64, i64)> = by_price.into_values().collect();
    levels.sort_by(|a, b| {
        if is_buy {
            b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal)
        } else {
            a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal)
        }
    });
    levels.truncate(top);
    let mut cum = 0i64;
    levels
        .into_iter()
        .map(|(price, volume, orders)| {
            cum += volume;
            BookLevel {
                price,
                volume,
                orders,
                cum,
            }
        })
        .collect()
}

async fn build_watch_item(
    esi: &EsiClient,
    db: &Db,
    region_id: i64,
    type_id: i64,
    hub: i64,
    name: Option<String>,
) -> WatchItem {
    // Libro público del hub: mejor compra (máx) y mejor venta (mín) en la estación principal.
    let buys = crate::esi::market::region_orders(esi, db, region_id, type_id, "buy").await;
    let sells = crate::esi::market::region_orders(esi, db, region_id, type_id, "sell").await;
    // Filtra al hub; si el hub no tiene órdenes, cae a toda la región para no dar 0 engañoso.
    let hub_buy_orders: Vec<crate::esi::market::BookOrder> = {
        let f: Vec<_> = buys
            .iter()
            .filter(|b| b.location_id == hub)
            .cloned()
            .collect();
        if hub != 0 && !f.is_empty() { f } else { buys.clone() }
    };
    let hub_sell_orders: Vec<crate::esi::market::BookOrder> = {
        let f: Vec<_> = sells
            .iter()
            .filter(|s| s.location_id == hub)
            .cloned()
            .collect();
        if hub != 0 && !f.is_empty() { f } else { sells.clone() }
    };
    let best_buy = hub_buy_orders
        .iter()
        .map(|b| b.price)
        .fold(f64::NEG_INFINITY, f64::max);
    let best_sell = hub_sell_orders
        .iter()
        .map(|s| s.price)
        .fold(f64::INFINITY, f64::min);
    let best_buy = if best_buy.is_finite() { best_buy } else { 0.0 };
    let best_sell = if best_sell.is_finite() { best_sell } else { 0.0 };
    // Paredes del libro (top 12 niveles a cada lado) para el visor de profundidad.
    let buy_levels = aggregate_levels(&hub_buy_orders, true, 12);
    let sell_levels = aggregate_levels(&hub_sell_orders, false, 12);
    let spread = if best_sell > 0.0 && best_buy > 0.0 {
        best_sell - best_buy
    } else {
        0.0
    };
    let margin = if best_sell > 0.0 && best_buy > 0.0 {
        (best_sell - best_buy) / best_sell
    } else {
        0.0
    };

    // Histórico (región): tendencia de precio y volumen.
    let hist = crate::esi::market::region_history(esi, db, region_id, type_id).await;
    // R2 (memoria de precios): persistir cada vez que se mira el watchlist → la historia se
    // ACUMULA más allá de la ventana de ESI, sin trabajo extra para el usuario.
    if !hist.is_empty() {
        let rows: Vec<(String, f64, f64, f64, i64, i64)> = hist
            .iter()
            .map(|h| (h.date.clone(), h.average, h.highest, h.lowest, h.volume, h.order_count))
            .collect();
        let _ = db.price_history_upsert(region_id, type_id, &rows);
    }
    let day_volume = hist.last().map(|h| h.volume).unwrap_or(0);
    let tail: Vec<&crate::esi::market::HistoryEntry> = hist.iter().rev().take(30).collect();
    let avg_volume = if tail.is_empty() {
        0
    } else {
        (tail.iter().map(|h| h.volume).sum::<i64>()) / (tail.len() as i64)
    };
    let history: Vec<HistPoint> = hist
        .iter()
        .rev()
        .take(120)
        .rev()
        .map(|h| HistPoint {
            date: h.date.clone(),
            average: h.average,
            volume: h.volume,
        })
        .collect();

    WatchItem {
        type_id,
        name,
        best_buy,
        best_sell,
        spread,
        margin,
        day_volume,
        avg_volume,
        history,
        buy_levels,
        sell_levels,
    }
}

/// Watchlist de mercado: para cada tipo vigilado, spread en el hub de la región elegida
/// + tendencia histórica. Todo ESI público (libro + /history/), cacheado.
#[tauri::command]
pub async fn get_watchlist(
    region_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<WatchItem>> {
    let ids = state.db.watch_list()?;
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let names = state.esi.resolve_names(&ids).await.unwrap_or_default();
    let hub = hub_station_for_region(region_id);
    let mut out: Vec<WatchItem> = Vec::with_capacity(ids.len());
    for tid in ids {
        let item = build_watch_item(
            &state.esi,
            &state.db,
            region_id,
            tid,
            hub,
            names.get(&tid).cloned(),
        )
        .await;
        out.push(item);
    }
    Ok(out)
}

/// Añade un tipo a la watchlist de mercado.
#[tauri::command]
pub async fn watch_add(type_id: i64, state: State<'_, AppState>) -> AppResult<()> {
    state.db.watch_add(type_id)
}

/// Quita un tipo de la watchlist de mercado.
#[tauri::command]
pub async fn watch_remove(type_id: i64, state: State<'_, AppState>) -> AppResult<()> {
    state.db.watch_remove(type_id)
}

// ===================== Arbitraje entre hubs (Comercio Nivel 3d) =====================

/// Los 5 hubs comerciales (región, etiqueta). La estación se saca de hub_station_for_region.
const ARB_REGIONS: [(i64, &str); 5] = [
    (10000002, "Jita"),
    (10000043, "Amarr"),
    (10000032, "Dodixie"),
    (10000030, "Rens"),
    (10000042, "Hek"),
];

/// Mejor ruta de arbitraje/hauling de un ítem entre hubs: comprar al ask más barato,
/// vender al bid más caro (en hubs distintos).
#[derive(Debug, Serialize)]
pub struct ArbItem {
    pub type_id: i64,
    pub name: Option<String>,
    pub buy_hub: String,  // dónde compras (mejor venta = ask más bajo)
    pub buy_price: f64,
    pub sell_hub: String, // dónde vendes (mejor compra = bid más alto)
    pub sell_price: f64,
    pub profit: f64,      // por unidad (bid_destino - ask_origen)
    pub margin: f64,      // profit / buy_price (fracción; UI en %)
    pub dest_volume: i64, // volumen diario del ítem en la región destino (¿podrás colocarlo?)
}

/// Arbitraje entre hubs para los ítems vigilados. Para cada uno mira el mejor ask y bid
/// en cada hub y devuelve la mejor ruta cruzada (comprar en A, vender en B, A≠B).
/// PESADO: 5 regiones × 2 lados por ítem (todo ESI público y cacheado). Se pide bajo demanda.
#[tauri::command]
pub async fn get_arbitrage(state: State<'_, AppState>) -> AppResult<Vec<ArbItem>> {
    let ids = state.db.watch_list()?;
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let names = state.esi.resolve_names(&ids).await.unwrap_or_default();
    let n = ARB_REGIONS.len();
    let mut out: Vec<ArbItem> = Vec::new();
    for tid in ids {
        let mut asks = vec![0f64; n]; // mejor venta (ask) por hub
        let mut bids = vec![0f64; n]; // mejor compra (bid) por hub
        for (i, (region, _)) in ARB_REGIONS.iter().enumerate() {
            let station = hub_station_for_region(*region);
            let buys =
                crate::esi::market::region_orders(&state.esi, &state.db, *region, tid, "buy").await;
            let sells =
                crate::esi::market::region_orders(&state.esi, &state.db, *region, tid, "sell").await;
            let bid = buys
                .iter()
                .filter(|b| b.location_id == station)
                .map(|b| b.price)
                .fold(f64::NEG_INFINITY, f64::max);
            let ask = sells
                .iter()
                .filter(|s| s.location_id == station)
                .map(|s| s.price)
                .fold(f64::INFINITY, f64::min);
            bids[i] = if bid.is_finite() { bid } else { 0.0 };
            asks[i] = if ask.is_finite() { ask } else { 0.0 };
        }
        // Mejor ruta cruzada: comprar al ask en b, vender al bid en s, con b≠s.
        let mut best: Option<(usize, usize, f64)> = None;
        for b in 0..n {
            for s in 0..n {
                if b == s {
                    continue;
                }
                let ask = asks[b];
                let bid = bids[s];
                if ask > 0.0 && bid > 0.0 {
                    let profit = bid - ask;
                    if profit > 0.0 && best.map_or(true, |(_, _, p)| profit > p) {
                        best = Some((b, s, profit));
                    }
                }
            }
        }
        if let Some((b, s, profit)) = best {
            let dest_region = ARB_REGIONS[s].0;
            let hist =
                crate::esi::market::region_history(&state.esi, &state.db, dest_region, tid).await;
            let dest_volume = hist.last().map(|h| h.volume).unwrap_or(0);
            out.push(ArbItem {
                type_id: tid,
                name: names.get(&tid).cloned(),
                buy_hub: ARB_REGIONS[b].1.to_string(),
                buy_price: asks[b],
                sell_hub: ARB_REGIONS[s].1.to_string(),
                sell_price: bids[s],
                profit,
                margin: if asks[b] > 0.0 { profit / asks[b] } else { 0.0 },
                dest_volume,
            });
        }
    }
    out.sort_by(|a, b| {
        b.margin
            .partial_cmp(&a.margin)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(out)
}

// ===================== Buscador de oportunidades (Comercio Nivel 4) =====================

/// Una oportunidad de trading detectada al escanear un grupo de mercado en un hub.
/// Combina liquidez (histórico) con el spread real del libro del hub.
#[derive(Debug, Serialize)]
pub struct OppItem {
    pub type_id: i64,
    pub name: Option<String>,
    pub avg_volume: i64,       // volumen diario medio (30d, histórico de la región)
    pub avg_price: f64,        // precio medio reciente (30d)
    pub isk_volume: f64,       // liquidez diaria en ISK = avg_volume * avg_price
    pub best_buy: f64,         // mejor compra en el hub (bid más alto)
    pub best_sell: f64,        // mejor venta en el hub (ask más bajo)
    pub spread: f64,           // best_sell - best_buy
    pub margin: f64,           // spread / best_sell (fracción; UI en %)
    pub daily_potential: f64,  // spread * avg_volume → ISK/día teórico si capturas el spread
}

/// Escanea un grupo de mercado buscando oportunidades de station-trading en un hub.
/// Dos pasadas para respetar ESI:
///   1) Histórico por tipo (1 llamada/tipo, cache ~1 día) → filtra por liquidez (avg_volume).
///   2) Libro real del hub SOLO para los `top_books` más líquidos (2 llamadas/tipo, cache ~5min).
/// Devuelve los ítems con libro real, ordenados por potencial diario (spread × volumen).
/// El frontend pasa los type_ids del grupo (acotado); aquí se limita por seguridad.
#[tauri::command]
pub async fn scan_opportunities(
    region_id: i64,
    type_ids: Vec<i64>,
    min_volume: i64,
    top_books: usize,
    state: State<'_, AppState>,
) -> AppResult<Vec<OppItem>> {
    if type_ids.is_empty() {
        return Ok(Vec::new());
    }
    // Tope de seguridad: no escanear grupos enormes de un tirón (protege el rate limit de ESI).
    const MAX_TYPES: usize = 400;
    const MAX_BOOKS: usize = 40;
    let scan: Vec<i64> = type_ids.into_iter().take(MAX_TYPES).collect();
    let top_books = top_books.clamp(1, MAX_BOOKS);
    let min_volume = min_volume.max(0);
    let hub = hub_station_for_region(region_id);

    // ---- Pasada 1: liquidez desde el histórico (barata, cache ~1 día) ----
    struct Liq {
        type_id: i64,
        avg_volume: i64,
        avg_price: f64,
        isk_volume: f64,
    }
    let mut liq: Vec<Liq> = Vec::new();
    for tid in scan {
        let hist = crate::esi::market::region_history(&state.esi, &state.db, region_id, tid).await;
        if hist.is_empty() {
            continue;
        }
        let tail: Vec<&crate::esi::market::HistoryEntry> = hist.iter().rev().take(30).collect();
        let days = tail.len() as i64;
        if days == 0 {
            continue;
        }
        let avg_volume = tail.iter().map(|h| h.volume).sum::<i64>() / days;
        if avg_volume < min_volume {
            continue;
        }
        let avg_price = tail.iter().map(|h| h.average).sum::<f64>() / days as f64;
        liq.push(Liq {
            type_id: tid,
            avg_volume,
            avg_price,
            isk_volume: avg_volume as f64 * avg_price,
        });
    }
    // Los más líquidos primero: solo a estos les pedimos el libro real.
    liq.sort_by(|a, b| {
        b.isk_volume
            .partial_cmp(&a.isk_volume)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    liq.truncate(top_books);
    if liq.is_empty() {
        return Ok(Vec::new());
    }

    // ---- Pasada 2: spread real del libro del hub para los supervivientes ----
    let ids: Vec<i64> = liq.iter().map(|l| l.type_id).collect();
    let names = state.esi.resolve_names(&ids).await.unwrap_or_default();
    let mut out: Vec<OppItem> = Vec::with_capacity(liq.len());
    for l in liq {
        let buys =
            crate::esi::market::region_orders(&state.esi, &state.db, region_id, l.type_id, "buy")
                .await;
        let sells =
            crate::esi::market::region_orders(&state.esi, &state.db, region_id, l.type_id, "sell")
                .await;
        let best_buy = buys
            .iter()
            .filter(|b| hub == 0 || b.location_id == hub)
            .map(|b| b.price)
            .fold(f64::NEG_INFINITY, f64::max);
        let best_sell = sells
            .iter()
            .filter(|s| hub == 0 || s.location_id == hub)
            .map(|s| s.price)
            .fold(f64::INFINITY, f64::min);
        let best_buy = if best_buy.is_finite() { best_buy } else { 0.0 };
        let best_sell = if best_sell.is_finite() { best_sell } else { 0.0 };
        let (spread, margin) = if best_sell > 0.0 && best_buy > 0.0 && best_sell >= best_buy {
            (best_sell - best_buy, (best_sell - best_buy) / best_sell)
        } else {
            (0.0, 0.0)
        };
        // Potencial diario: spread capturable sobre el volumen diario.
        let daily_potential = spread * l.avg_volume as f64;
        out.push(OppItem {
            type_id: l.type_id,
            name: names.get(&l.type_id).cloned(),
            avg_volume: l.avg_volume,
            avg_price: l.avg_price,
            isk_volume: l.isk_volume,
            best_buy,
            best_sell,
            spread,
            margin,
            daily_potential,
        });
    }
    // Ordena por potencial diario (spread × volumen): las que más ISK/día pueden dar.
    out.sort_by(|a, b| {
        b.daily_potential
            .partial_cmp(&a.daily_potential)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(out)
}

/// Una colonia de Planetary Interaction tal cual la devuelve ESI.
#[derive(Debug, Clone, serde::Deserialize)]
struct PlanetRaw {
    #[serde(default)]
    solar_system_id: i64,
    /// Id del planeta: la llave del DETALLE (/planets/{planet_id}/). Hasta R1a se tiraba.
    #[serde(default)]
    planet_id: i64,
    #[serde(default)]
    planet_type: String,
    #[serde(default)]
    upgrade_level: i64,
    #[serde(default)]
    num_pins: i64,
    #[serde(default)]
    last_update: Option<String>,
}

/// Vista de una colonia con el nombre del sistema resuelto.
#[derive(Debug, Serialize)]
pub struct PlanetView {
    pub system_id: i64,
    pub system_name: Option<String>,
    pub planet_id: i64,
    /// Personaje dueño de la colonia (el dashboard es multi-personaje).
    pub character_id: i64,
    pub planet_type: String,
    pub upgrade_level: i64,
    pub num_pins: i64,
    pub last_update: Option<String>,
}

async fn resolve_planets(
    esi: &EsiClient,
    rows: Vec<PlanetRaw>,
    character_id: i64,
) -> AppResult<Vec<PlanetView>> {
    let mut ids: HashSet<i64> = HashSet::new();
    for p in &rows {
        if p.solar_system_id != 0 {
            ids.insert(p.solar_system_id);
        }
    }
    let names = esi
        .resolve_names(&ids.into_iter().collect::<Vec<_>>())
        .await
        .unwrap_or_default();
    Ok(rows
        .into_iter()
        .map(|p| PlanetView {
            system_id: p.solar_system_id,
            system_name: names.get(&p.solar_system_id).cloned(),
            planet_id: p.planet_id,
            character_id,
            planet_type: p.planet_type,
            upgrade_level: p.upgrade_level,
            num_pins: p.num_pins,
            last_update: p.last_update,
        })
        .collect())
}

/// Colonias de Planetary Interaction de un personaje (Planetología).
#[tauri::command]
pub async fn get_planets(character_id: i64, state: State<'_, AppState>) -> AppResult<Vec<PlanetView>> {
    let token = token_with_scope(
        &state,
        character_id,
        "esi-planets.manage_planets.v1",
        "Assets / industria",
    )
    .await?;
    let rows: Vec<PlanetRaw> = state
        .esi
        .get_cached(
            &state.db,
            character_id,
            &format!("/characters/{character_id}/planets/"),
            Some(&token),
        )
        .await?;
    resolve_planets(&state.esi, rows, character_id).await
}

/// Colonias PI global (todos los personajes con el scope).
#[tauri::command]
pub async fn get_planets_global(state: State<'_, AppState>) -> AppResult<Vec<PlanetView>> {
    let mut all: Vec<PlanetView> = Vec::new();
    for c in state.db.list_characters()? {
        if !c.scopes.iter().any(|s| s == "esi-planets.manage_planets.v1") {
            continue;
        }
        let valid = match state
            .tokens
            .access_token(state.esi.http(), c.character_id)
            .await
        {
            Ok(v) => v,
            Err(_) => continue,
        };
        let cid = c.character_id;
        if let Ok(rows) = state
            .esi
            .get_cached::<Vec<PlanetRaw>>(
                &state.db,
                cid,
                &format!("/characters/{cid}/planets/"),
                Some(&valid.access_token),
            )
            .await
        {
            if let Ok(mut v) = resolve_planets(&state.esi, rows, cid).await {
                all.append(&mut v);
            }
        }
    }
    Ok(all)
}

// ---- R1a Planetología (SPEC_PLANETOLOGIA.md): detalle de colonia ----
// Passthrough TIPADO de /characters/{id}/planets/{planet_id}/ — mismo scope que la lista
// (manage_planets, ya concedido: sin relogin). Los pins traen la caducidad del extractor (la
// alarma), el esquema de cada fábrica y el CONTENIDO de los almacenes; las rutas son el
// cableado del flujo (para detectar fábricas hambrientas y pintar el diagrama, R1c).

/// Detalle del extractor de un pin (heads fuera: no aportan a los cálculos y abultan).
#[derive(Debug, Clone, serde::Deserialize, Serialize)]
pub struct PlanetPinExtractor {
    #[serde(default)]
    pub product_type_id: Option<i64>,
    #[serde(default)]
    pub qty_per_cycle: Option<i64>,
    #[serde(default)]
    pub cycle_time: Option<i64>,
}

/// Un ítem almacenado dentro de un pin (launchpad/almacén/fábrica).
#[derive(Debug, Clone, serde::Deserialize, Serialize)]
pub struct PlanetPinContent {
    pub type_id: i64,
    #[serde(default)]
    pub amount: i64,
}

/// Un pin de la colonia: extractor, fábrica, almacén, launchpad o centro de mando.
/// La CLASE se decide en el frontend por el grupo del type_id (SDE), no por listas mágicas.
#[derive(Debug, Clone, serde::Deserialize, Serialize)]
pub struct PlanetPin {
    pub pin_id: i64,
    pub type_id: i64,
    #[serde(default)]
    pub schematic_id: Option<i64>,
    /// Caducidad del programa del extractor: LA alarma de Planetología.
    #[serde(default)]
    pub expiry_time: Option<String>,
    #[serde(default)]
    pub install_time: Option<String>,
    #[serde(default)]
    pub last_cycle_start: Option<String>,
    // OJO: rename SOLO de lectura. Con `rename = "..."` a secas, serde también reemite
    // `extractor_details` al serializar al frontend, que lee `.extractor` → el extractor no se
    // pintaba (las fábricas sí, porque schematic_id no lleva rename). deserialize-only lo arregla:
    // lee `extractor_details` de ESI y emite `extractor` para el TS.
    #[serde(default, rename(deserialize = "extractor_details"))]
    pub extractor: Option<PlanetPinExtractor>,
    #[serde(default)]
    pub contents: Vec<PlanetPinContent>,
}

/// Una ruta de material entre pins (cantidad por ciclo, float en ESI).
#[derive(Debug, Clone, serde::Deserialize, Serialize)]
pub struct PlanetRoute {
    pub source_pin_id: i64,
    pub destination_pin_id: i64,
    pub content_type_id: i64,
    #[serde(default)]
    pub quantity: f64,
}

/// Detalle completo de una colonia.
#[derive(Debug, Clone, serde::Deserialize, Serialize)]
pub struct PlanetDetail {
    #[serde(default)]
    pub pins: Vec<PlanetPin>,
    #[serde(default)]
    pub routes: Vec<PlanetRoute>,
}

/// Detalle de una colonia PI (pins + rutas). Cacheado como el resto de ESI (ETag): ≤6 planetas
/// por personaje, el ciclo normal de refresco no martillea nada.
#[tauri::command]
pub async fn get_planet_detail(
    character_id: i64,
    planet_id: i64,
    state: State<'_, AppState>,
) -> AppResult<PlanetDetail> {
    let token = token_with_scope(
        &state,
        character_id,
        "esi-planets.manage_planets.v1",
        "Planetología",
    )
    .await?;
    state
        .esi
        .get_cached(
            &state.db,
            character_id,
            &format!("/characters/{character_id}/planets/{planet_id}/"),
            Some(&token),
        )
        .await
}

/// Una colonia para el panel del mapa: personaje, tipo de planeta, peor extractor, productos y nº
/// de fábricas. Es el "status resumido" que sale al clicar un sistema en la capa de PI.
#[derive(Debug, Clone, Serialize)]
pub struct PiColony {
    pub character: String,
    pub planet_type: String,
    /// Horas del peor extractor (None = sin extractor programado).
    pub worst_hours: Option<f64>,
    pub products: Vec<i64>, // typeIDs de lo que extrae (para iconos)
    pub factories: i64,
}

/// Salud de PI por sistema para el overlay del mapa (idea de RoGiz7): peor extractor + detalle por
/// colonia. Reusa /planets/ + /planets/{id}/ (cacheados por ETag).
#[derive(Debug, Clone, Serialize)]
pub struct PiSystem {
    pub system_id: i64,
    pub colonies: i64,
    /// Horas del peor extractor del sistema (None = ninguna colonia con extractor programado).
    pub worst_hours: Option<f64>,
    pub dead: i64, // colonias con extractor parado (<=0h)
    pub soon: i64, // colonias con extractor <24h
    pub detail: Vec<PiColony>,
}

/// Colonias de un personaje como (system_id, PiColony). Silencioso ante errores (mapa best-effort).
async fn pi_colonies_for_char(
    esi: &EsiClient,
    db: &Db,
    cid: i64,
    char_name: &str,
    token: &str,
) -> Vec<(i64, PiColony)> {
    let mut out: Vec<(i64, PiColony)> = Vec::new();
    let planets = match esi
        .get_cached::<Vec<PlanetRaw>>(db, cid, &format!("/characters/{cid}/planets/"), Some(token))
        .await
    {
        Ok(p) => p,
        Err(_) => return out,
    };
    for p in &planets {
        if p.planet_id == 0 {
            continue;
        }
        let pid = p.planet_id;
        let Ok(detail) = esi
            .get_cached::<PlanetDetail>(
                db,
                cid,
                &format!("/characters/{cid}/planets/{pid}/"),
                Some(token),
            )
            .await
        else {
            continue;
        };
        let mut worst: Option<f64> = None;
        let mut products: Vec<i64> = Vec::new();
        let mut factories = 0i64;
        for pin in &detail.pins {
            if let Some(ex) = &pin.extractor {
                let programmed = ex.product_type_id.is_some()
                    && ex.qty_per_cycle.is_some()
                    && ex.cycle_time.is_some();
                if let Some(pt) = ex.product_type_id {
                    if !products.contains(&pt) {
                        products.push(pt);
                    }
                }
                let h = pin
                    .expiry_time
                    .as_deref()
                    .and_then(|e| chrono::DateTime::parse_from_rfc3339(e).ok())
                    .map(|e| {
                        (e.with_timezone(&chrono::Utc) - chrono::Utc::now()).num_minutes() as f64
                            / 60.0
                    });
                let eff = h.or(if programmed { None } else { Some(0.0) });
                if let Some(v) = eff {
                    worst = Some(worst.map_or(v, |w| w.min(v)));
                }
            } else if pin.schematic_id.is_some() {
                factories += 1;
            }
        }
        out.push((
            p.solar_system_id,
            PiColony {
                character: char_name.to_string(),
                planet_type: p.planet_type.clone(),
                worst_hours: worst,
                products,
                factories,
            },
        ));
    }
    out
}

/// Agrupa colonias por sistema en PiSystem (conteos + peor extractor + detalle).
fn pi_systems_from(colonies: Vec<(i64, PiColony)>) -> Vec<PiSystem> {
    use std::collections::HashMap;
    let mut by: HashMap<i64, Vec<PiColony>> = HashMap::new();
    for (sid, col) in colonies {
        by.entry(sid).or_default().push(col);
    }
    by.into_iter()
        .map(|(system_id, detail)| {
            let colonies = detail.len() as i64;
            let mut worst: Option<f64> = None;
            let mut dead = 0i64;
            let mut soon = 0i64;
            for c in &detail {
                if let Some(w) = c.worst_hours {
                    worst = Some(worst.map_or(w, |cur| cur.min(w)));
                    if w <= 0.0 {
                        dead += 1;
                    } else if w <= 24.0 {
                        soon += 1;
                    }
                }
            }
            PiSystem {
                system_id,
                colonies,
                worst_hours: worst,
                dead,
                soon,
                detail,
            }
        })
        .collect()
}

/// Salud de PI por sistema de UN personaje (overlay del mapa).
#[tauri::command]
pub async fn get_pi_map(character_id: i64, state: State<'_, AppState>) -> AppResult<Vec<PiSystem>> {
    let token = token_with_scope(
        &state,
        character_id,
        "esi-planets.manage_planets.v1",
        "Planetología",
    )
    .await?;
    let name = state
        .db
        .list_characters()
        .ok()
        .and_then(|cs| cs.into_iter().find(|c| c.character_id == character_id).map(|c| c.name))
        .unwrap_or_default();
    Ok(pi_systems_from(
        pi_colonies_for_char(&state.esi, &state.db, character_id, &name, &token).await,
    ))
}

/// Salud de PI por sistema de TODOS los personajes (overlay del mapa, vista global).
#[tauri::command]
pub async fn get_pi_map_global(state: State<'_, AppState>) -> AppResult<Vec<PiSystem>> {
    let mut all: Vec<(i64, PiColony)> = Vec::new();
    for c in state.db.list_characters()? {
        if !c.scopes.iter().any(|s| s == "esi-planets.manage_planets.v1") {
            continue;
        }
        let valid = match state
            .tokens
            .access_token(state.esi.http(), c.character_id)
            .await
        {
            Ok(v) => v,
            Err(_) => continue,
        };
        let mut cols =
            pi_colonies_for_char(&state.esi, &state.db, c.character_id, &c.name, &valid.access_token)
                .await;
        all.append(&mut cols);
    }
    Ok(pi_systems_from(all))
}

/// Interruptor maestro de los avisos de PI (notificación + toast). Default ON. Con OFF la
/// sección Planetología sigue enseñando el estado; solo se silencia el ruido (como el intel).
#[tauri::command]
pub fn get_pi_alerts_on(state: State<'_, AppState>) -> AppResult<bool> {
    Ok(state.db.meta_get("pi_alerts_on").map(|v| v != "0").unwrap_or(true))
}

#[tauri::command]
pub fn set_pi_alerts_on(on: bool, state: State<'_, AppState>) -> AppResult<bool> {
    state.db.meta_set("pi_alerts_on", if on { "1" } else { "0" })?;
    Ok(on)
}

/// Umbrales (horas) de la alarma de PI, configurables por el usuario. Por defecto [8, 1].
#[tauri::command]
pub fn get_pi_alert_hours(state: State<'_, AppState>) -> AppResult<Vec<f64>> {
    Ok(state
        .db
        .meta_get("pi_alert_hours")
        .and_then(|v| serde_json::from_str::<Vec<f64>>(&v).ok())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| vec![8.0, 1.0]))
}

/// Guarda los umbrales de la alarma de PI (horas): positivos, <=720h, únicos, orden desc, máx 4.
/// Devuelve la lista saneada para que la UI la refleje.
#[tauri::command]
pub fn set_pi_alert_hours(hours: Vec<f64>, state: State<'_, AppState>) -> AppResult<Vec<f64>> {
    let mut clean: Vec<f64> = hours.into_iter().filter(|h| *h > 0.0 && *h <= 720.0).collect();
    clean.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));
    clean.dedup();
    clean.truncate(4);
    if clean.is_empty() {
        clean = vec![8.0, 1.0];
    }
    state
        .db
        .meta_set("pi_alert_hours", &serde_json::to_string(&clean).unwrap_or_default())?;
    Ok(clean)
}

/// Vista de un job de industria con nombres legibles.
#[derive(Debug, Serialize)]
pub struct JobView {
    pub job_id: i64,
    pub activity: String,
    pub runs: i64,
    pub status: Option<String>,
    pub blueprint_name: Option<String>,
    pub product_name: Option<String>,
    pub end_date: Option<String>,
    /// Nombre del personaje (solo se rellena en la vista global).
    pub character: Option<String>,
}

/// Jobs de industria activos del personaje, con nombres resueltos.
#[tauri::command]
pub async fn get_industry(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<JobView>> {
    let token = token_with_scope(
        &state,
        character_id,
        "esi-industry.read_character_jobs.v1",
        "Assets / industria",
    )
    .await?;
    // `sync_jobs` pide TAMBIÉN los completados y los guarda (ESI solo mira 90 días atrás: lo que
    // no se guarde hoy no vuelve). La sección sigue enseñando lo mismo que siempre, así que aquí
    // se filtra lo terminado; el histórico se consulta con `get_industry_history`.
    let jobs: Vec<JobRaw> = industry::sync_jobs(&state.esi, &state.db, character_id, &token)
        .await?
        .into_iter()
        .filter(|j| !industry::job_is_finished(j.status.as_deref()))
        .collect();

    // IDs a resolver: blueprints y productos.
    let mut ids: HashSet<i64> = HashSet::new();
    for j in &jobs {
        ids.insert(j.blueprint_type_id);
        if let Some(p) = j.product_type_id {
            ids.insert(p);
        }
    }
    let names = state
        .esi
        .resolve_names(&ids.into_iter().collect::<Vec<_>>())
        .await
        .unwrap_or_default();

    let views = jobs
        .into_iter()
        .map(|j| JobView {
            job_id: j.job_id,
            activity: industry::activity_name(j.activity_id).to_string(),
            runs: j.runs,
            status: j.status,
            blueprint_name: names.get(&j.blueprint_type_id).cloned(),
            product_name: j.product_type_id.and_then(|p| names.get(&p).cloned()),
            end_date: j.end_date,
            character: None,
        })
        .collect();
    Ok(views)
}

/// Resumen de minería desde la BD acumulada (no solo los 90 días de ESI).
async fn build_mining(state: &AppState, filter: Option<i64>) -> AppResult<MiningSummary> {
    let (total_units, entries) = state.db.mining_totals(filter)?;
    let mut top_ores: Vec<NameCount> = state
        .db
        .mining_by_type(filter, 15)?
        .into_iter()
        .map(|(id, count)| NameCount {
            id,
            count,
            name: None,
            region: None,
        })
        .collect();
    let mut recent: Vec<MiningRow> = state
        .db
        .mining_recent(filter, 50)?
        .into_iter()
        .map(|(date, system_id, type_id, quantity)| MiningRow {
            date: Some(date),
            system_id: Some(system_id),
            type_id,
            type_name: None,
            quantity,
        })
        .collect();

    let mut ids: HashSet<i64> = HashSet::new();
    for o in &top_ores {
        ids.insert(o.id);
    }
    for r in &recent {
        ids.insert(r.type_id);
        if let Some(s) = r.system_id {
            ids.insert(s);
        }
    }
    if let Ok(names) = state
        .esi
        .resolve_names(&ids.into_iter().collect::<Vec<_>>())
        .await
    {
        for o in top_ores.iter_mut() {
            o.name = names.get(&o.id).cloned();
        }
        for r in recent.iter_mut() {
            r.type_name = names.get(&r.type_id).cloned();
        }
    }
    Ok(MiningSummary {
        total_units,
        entries,
        top_ores,
        recent,
    })
}

#[tauri::command]
pub async fn get_mining(character_id: i64, state: State<'_, AppState>) -> AppResult<MiningSummary> {
    build_mining(&state, Some(character_id)).await
}

/// Assets GLOBAL: agrega los assets de todos los personajes (suma por tipo).
#[tauri::command]
pub async fn get_assets_global(state: State<'_, AppState>) -> AppResult<AssetsSummary> {
    use std::collections::HashMap;
    let mut by_type: HashMap<i64, i64> = HashMap::new();
    let mut watched_agg: HashMap<i64, i64> = HashMap::new();
    let mut stacks = 0i64;
    let mut total_units = 0i64;
    let mut est_value = 0.0f64;
    let mut est_value_clean = 0.0f64;
    let mut tv_agg: HashMap<i64, (i64, f64, String)> = HashMap::new();

    for c in state.db.list_characters()? {
        if !c.scopes.iter().any(|s| s == "esi-assets.read_assets.v1") {
            continue;
        }
        let valid = match state
            .tokens
            .access_token(state.esi.http(), c.character_id)
            .await
        {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Ok(s) =
            assets::summary(&state.esi, &state.db, c.character_id, &valid.access_token).await
        {
            stacks += s.stacks;
            total_units += s.total_units;
            est_value += s.est_value;
            est_value_clean += s.est_value_clean;
            for tv in s.top_value {
                let e = tv_agg.entry(tv.type_id).or_insert((0, 0.0, tv.category));
                e.0 += tv.qty;
                e.1 += tv.value;
            }
            for (tid, qty) in s.watched {
                *watched_agg.entry(tid).or_insert(0) += qty;
            }
            for nc in s.top_types {
                *by_type.entry(nc.id).or_insert(0) += nc.count;
            }
        }
    }

    let mut top: Vec<crate::db::NameCount> = by_type
        .into_iter()
        .map(|(id, count)| crate::db::NameCount {
            id,
            count,
            name: None,
            region: None,
        })
        .collect();
    top.sort_by(|a, b| b.count.cmp(&a.count));
    let distinct_types = top.len() as i64;
    top.truncate(20);

    let ids: Vec<i64> = top.iter().map(|n| n.id).collect();
    if let Ok(names) = state.esi.resolve_names(&ids).await {
        for n in top.iter_mut() {
            n.name = names.get(&n.id).cloned();
        }
    }

    // Top por VALOR agregado entre personajes (para el desglose del patrimonio).
    let mut top_value: Vec<crate::esi::assets::TypeValue> = tv_agg
        .into_iter()
        .map(|(type_id, (qty, value, category))| crate::esi::assets::TypeValue {
            type_id,
            qty,
            value,
            category,
            name: None,
        })
        .collect();
    top_value.sort_by(|a, b| b.value.partial_cmp(&a.value).unwrap_or(std::cmp::Ordering::Equal));
    top_value.truncate(30);
    let tv_ids: Vec<i64> = top_value.iter().map(|t| t.type_id).collect();
    if let Ok(names) = state.esi.resolve_names(&tv_ids).await {
        for t in top_value.iter_mut() {
            t.name = names.get(&t.type_id).cloned();
        }
    }

    Ok(AssetsSummary {
        stacks,
        distinct_types,
        total_units,
        est_value,
        est_value_clean,
        top_value,
        top_types: top,
        watched: watched_agg,
    })
}

/// Industria GLOBAL: jobs de todos los personajes, con el nombre de cada personaje.
#[tauri::command]
pub async fn get_industry_global(state: State<'_, AppState>) -> AppResult<Vec<JobView>> {
    let mut raw: Vec<(String, JobRaw)> = Vec::new();
    let mut ids: HashSet<i64> = HashSet::new();

    for c in state.db.list_characters()? {
        if !c
            .scopes
            .iter()
            .any(|s| s == "esi-industry.read_character_jobs.v1")
        {
            continue;
        }
        let valid = match state
            .tokens
            .access_token(state.esi.http(), c.character_id)
            .await
        {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Ok(jobs) =
            industry::sync_jobs(&state.esi, &state.db, c.character_id, &valid.access_token).await
        {
            for j in jobs {
                if industry::job_is_finished(j.status.as_deref()) {
                    continue; // la vista global es «qué tengo en el horno», como siempre
                }
                ids.insert(j.blueprint_type_id);
                if let Some(p) = j.product_type_id {
                    ids.insert(p);
                }
                raw.push((c.name.clone(), j));
            }
        }
    }

    let names = state
        .esi
        .resolve_names(&ids.into_iter().collect::<Vec<_>>())
        .await
        .unwrap_or_default();
    let views = raw
        .into_iter()
        .map(|(cname, j)| JobView {
            job_id: j.job_id,
            activity: industry::activity_name(j.activity_id).to_string(),
            runs: j.runs,
            status: j.status,
            blueprint_name: names.get(&j.blueprint_type_id).cloned(),
            product_name: j.product_type_id.and_then(|p| names.get(&p).cloned()),
            end_date: j.end_date,
            character: Some(cname),
        })
        .collect();
    Ok(views)
}

/* ---- Histórico de industria y de planetaria (lo que ESI ya no te devuelve) ---- */

/// Un trabajo del histórico, con nombres resueltos y la economía que ESI solo enseña una vez.
#[derive(Debug, Serialize)]
pub struct JobHistoryRow {
    pub job_id: i64,
    pub character_id: i64,
    pub activity: String,
    pub runs: i64,
    pub successful_runs: Option<i64>,
    pub probability: Option<f64>,
    pub cost: Option<f64>,
    pub status: Option<String>,
    pub blueprint_name: Option<String>,
    pub product_name: Option<String>,
    pub product_type_id: Option<i64>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub completed_date: Option<String>,
}

/// Histórico de industria + DESDE CUÁNDO lo tenemos.
///
/// `since` no es decorativo: antes de esa fecha no es que no fabricaras nada, es que Koru no
/// miraba. Cualquier gráfica que arranque en cero antes de `since` está mintiendo, así que el
/// dato viaja con los datos y no en un comentario del frontend.
#[derive(Debug, Serialize)]
pub struct JobHistory {
    pub jobs: Vec<JobHistoryRow>,
    pub total: i64,
    pub since: Option<String>,
}

/// Trabajos de industria guardados (activos y terminados). Lee de la BD, NO de ESI: el histórico
/// existe precisamente porque ESI ya no lo tiene.
#[tauri::command]
pub async fn get_industry_history(
    character_id: Option<i64>,
    limit: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<JobHistory> {
    let rows = state
        .db
        .industry_jobs(character_id, false, limit.unwrap_or(2000))?;
    let (total, since) = state.db.industry_history_span(character_id)?;

    let mut ids: HashSet<i64> = HashSet::new();
    for r in &rows {
        ids.insert(r.blueprint_type_id);
        if let Some(p) = r.product_type_id {
            ids.insert(p);
        }
    }
    let names = state
        .esi
        .resolve_names(&ids.into_iter().collect::<Vec<_>>())
        .await
        .unwrap_or_default();

    let jobs = rows
        .into_iter()
        .map(|r| JobHistoryRow {
            job_id: r.job_id,
            character_id: r.character_id,
            activity: industry::activity_name(r.activity_id).to_string(),
            runs: r.runs,
            successful_runs: r.successful_runs,
            probability: r.probability,
            cost: r.cost,
            status: r.status,
            blueprint_name: names.get(&r.blueprint_type_id).cloned(),
            product_name: r.product_type_id.and_then(|p| names.get(&p).cloned()),
            product_type_id: r.product_type_id,
            start_date: r.start_date,
            end_date: r.end_date,
            completed_date: r.completed_date,
        })
        .collect();
    Ok(JobHistory { jobs, total, since })
}

/// Histórico de planetaria: programas de extracción (eventos) + existencias por día (niveles).
/// Las dos series tienen granularidades distintas a propósito; ver el porqué en `db::open`.
#[derive(Debug, Serialize)]
pub struct PiHistory {
    pub programs: Vec<crate::db::PiProgramRow>,
    /// (día, type_id, unidades) — la curva de lo que había en las colonias.
    pub storage: Vec<(String, i64, i64)>,
    pub total_programs: i64,
    /// Igual que en industria: desde cuándo hay datos. Antes de esto es CEGUERA, no un cero.
    pub since: Option<String>,
}

#[tauri::command]
pub async fn get_pi_history(
    character_id: Option<i64>,
    limit: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<PiHistory> {
    let programs = state.db.pi_programs(character_id, limit.unwrap_or(1000))?;
    let storage = state.db.pi_storage_series(character_id)?;
    let (total_programs, since) = state.db.pi_history_span(character_id)?;
    Ok(PiHistory {
        programs,
        storage,
        total_programs,
        since,
    })
}

/// Abre un enlace externo (zKillboard, Dotlan, Ko-fi, la web de EVE) por el MISMO camino que el
/// login, que es el único que sabe insistir cuando `xdg-open` falla.
///
/// Existe porque `openUrl` del plugin no comparte esa lógica: en la máquina del tester de Linux
/// —sin navegador por defecto— el login ya funcionaba y estos diecinueve enlaces seguían muertos.
/// Un arreglo que solo cubre el camino que se probó no es un arreglo, es una casualidad.
///
/// Devuelve el error para que la UI pueda ofrecer el enlace a mano en vez de no hacer nada.
#[tauri::command]
pub fn open_external(url: String) -> AppResult<()> {
    // Solo http/https: este comando lo llama el frontend, y no tiene por qué poder lanzar
    // `file://` ni nada que ejecute algo del disco.
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(AppError::Other("enlace no permitido".into()));
    }
    crate::sso::abrir_navegador(&url).map_err(AppError::Other)
}

/* ---- Tus naves: cuáles, dónde y cuánto mueven (T2 del pilar de transporte) ---- */

/// Conjunto de typeIDs que son NAVES, de `ships.json` embebido. Sin esto habría que preguntarle a
/// ESI por la categoría de cada asset, que son miles de ítems y una llamada por tipo.
fn ship_type_ids() -> &'static std::collections::HashSet<i64> {
    static S: std::sync::OnceLock<std::collections::HashSet<i64>> = std::sync::OnceLock::new();
    S.get_or_init(|| {
        let rows: Vec<ShipRow> = serde_json::from_str(include_str!("ships.json")).unwrap_or_default();
        rows.into_iter().map(|r| r.i).collect()
    })
}

/// Una nave tuya con el nombre resuelto, lista para la vista.
#[derive(Debug, Serialize)]
pub struct MyShipView {
    pub item_id: i64,
    pub type_id: i64,
    pub type_name: Option<String>,
    pub character_id: i64,
    pub character: String,
    pub system_id: i64,
    pub system_name: Option<String>,
    pub location_name: String,
    /// `false` = empaquetada: no puede llevar nada hasta que la montes.
    pub assembled: bool,
    pub modules: Vec<crate::esi::assets::ShipModuleRow>,
}

/// Tus naves de TODOS los personajes: cuáles tienes, dónde están y qué llevan montado.
///
/// La capacidad efectiva NO se calcula aquí: el frontend la resuelve con `ship_cargo.json` (base +
/// bonus por skill) y `get_skill_levels_all`. Así el número tiene una sola fuente y el día que
/// entren los expansores y los rigs se toca un sitio, no dos. Ver documentacion/SPEC_TRANSPORTE.md.
#[tauri::command]
pub async fn get_my_ships(state: State<'_, AppState>) -> AppResult<Vec<MyShipView>> {
    let all_tokens = structure_tokens(&state).await;
    let ships = ship_type_ids();
    let mut raw: Vec<(String, crate::esi::assets::MyShipRow)> = Vec::new();

    for c in state.db.list_characters()? {
        if !c.scopes.iter().any(|s| s == "esi-assets.read_assets.v1") {
            continue;
        }
        let valid = match state
            .tokens
            .access_token(state.esi.http(), c.character_id)
            .await
        {
            Ok(v) => v,
            Err(_) => continue,
        };
        // Un personaje que falle no puede dejar sin naves a los otros ocho.
        match crate::esi::assets::ships(
            &state.esi,
            &state.db,
            c.character_id,
            &valid.access_token,
            &all_tokens,
            ships,
        )
        .await
        {
            Ok(v) => raw.extend(v.into_iter().map(|s| (c.name.clone(), s))),
            Err(e) => eprintln!("get_my_ships {}: {e}", c.name),
        }
    }

    // Nombres de nave y de sistema en una sola resolución.
    let mut ids: HashSet<i64> = HashSet::new();
    for (_, s) in &raw {
        ids.insert(s.type_id);
        if s.system_id != 0 {
            ids.insert(s.system_id);
        }
    }
    let names = state
        .esi
        .resolve_names(&ids.into_iter().collect::<Vec<_>>())
        .await
        .unwrap_or_default();

    let mut out: Vec<MyShipView> = raw
        .into_iter()
        .map(|(cname, s)| MyShipView {
            item_id: s.item_id,
            type_id: s.type_id,
            type_name: names.get(&s.type_id).cloned(),
            character_id: s.character_id,
            character: cname,
            system_id: s.system_id,
            system_name: names.get(&s.system_id).cloned(),
            location_name: s.location_name,
            assembled: s.assembled,
            modules: s.modules,
        })
        .collect();
    // Montadas primero: son las que puedes usar hoy.
    out.sort_by(|a, b| {
        b.assembled
            .cmp(&a.assembled)
            .then_with(|| a.character.cmp(&b.character))
            .then_with(|| a.type_name.cmp(&b.type_name))
    });
    Ok(out)
}

/* ---- Libro de viajes: contratos guardados (T1 del pilar de transporte) ---- */

/// Un contrato del libro, con los nombres ya resueltos.
#[derive(Debug, Serialize)]
pub struct HaulRow {
    pub contract_id: i64,
    pub character_id: i64,
    pub kind: Option<String>,
    pub status: Option<String>,
    pub title: Option<String>,
    /// Quién lo emitió y quién lo aceptó, con nombre: de aquí sale «a quién transportas más».
    pub issuer: Option<String>,
    pub acceptor: Option<String>,
    pub start_location_id: Option<i64>,
    pub end_location_id: Option<i64>,
    pub volume: Option<f64>,
    pub reward: Option<f64>,
    pub collateral: Option<f64>,
    /// ISK por m³. Es la métrica honesta más simple; la buena (por m³ y salto, con riesgo) llega
    /// en T4, cuando se pueda medir la ruta.
    pub isk_por_m3: Option<f64>,
    /// Horas entre aceptar y completar. **Solo se rellena si están las DOS fechas**: es la única
    /// velocidad de entrega medida de verdad. La de los viajes propios habrá que deducirla de
    /// `location_track` y arrastra ceguera, así que no se mezclan.
    pub horas_entrega: Option<f64>,
    pub date_issued: Option<String>,
    pub date_completed: Option<String>,
}

/// El libro de viajes + DESDE CUÁNDO lo tenemos.
#[derive(Debug, Serialize)]
pub struct HaulLedger {
    pub rows: Vec<HaulRow>,
    pub total: i64,
    /// Antes de esta fecha no es que no movieras nada: es que Koru no miraba. La ventana de ESI
    /// para contratos son ~30 días, así que este dato viaja CON los datos y no en un comentario.
    pub since: Option<String>,
}

/// Contratos guardados. Lee de la BD, NO de ESI — el libro existe justamente porque ESI olvida.
#[tauri::command]
pub async fn get_haul_ledger(
    character_id: Option<i64>,
    only_courier: Option<bool>,
    limit: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<HaulLedger> {
    let rows = state.db.contracts(
        character_id,
        only_courier.unwrap_or(false),
        limit.unwrap_or(2000),
    )?;
    let (total, since) = state.db.contracts_span(character_id)?;

    // Nombres de emisor y aceptor en un solo /universe/names (cacheado).
    let mut ids: HashSet<i64> = HashSet::new();
    for r in &rows {
        if let Some(i) = r.issuer_id {
            ids.insert(i);
        }
        if let Some(a) = r.acceptor_id {
            ids.insert(a);
        }
    }
    ids.remove(&0);
    let names = state
        .esi
        .resolve_names(&ids.into_iter().collect::<Vec<_>>())
        .await
        .unwrap_or_default();

    let out = rows
        .into_iter()
        .map(|r| {
            // Solo se divide si el volumen es > 0: un item_exchange puede traer 0 y una división
            // por cero pintaría «infinito ISK/m³», que es la clase de número que parece un hallazgo.
            let isk_por_m3 = match (r.reward, r.volume) {
                (Some(rw), Some(v)) if v > 0.0 => Some(rw / v),
                _ => None,
            };
            let horas_entrega = match (&r.date_accepted, &r.date_completed) {
                (Some(a), Some(c)) => {
                    match (
                        chrono::DateTime::parse_from_rfc3339(a),
                        chrono::DateTime::parse_from_rfc3339(c),
                    ) {
                        (Ok(a), Ok(c)) => Some((c - a).num_minutes() as f64 / 60.0),
                        _ => None,
                    }
                }
                _ => None,
            };
            HaulRow {
                contract_id: r.contract_id,
                character_id: r.character_id,
                kind: r.kind,
                status: r.status,
                title: r.title,
                issuer: r.issuer_id.and_then(|i| names.get(&i).cloned()),
                acceptor: r.acceptor_id.and_then(|a| names.get(&a).cloned()),
                start_location_id: r.start_location_id,
                end_location_id: r.end_location_id,
                volume: r.volume,
                reward: r.reward,
                collateral: r.collateral,
                isk_por_m3,
                horas_entrega,
                date_issued: r.date_issued,
                date_completed: r.date_completed,
            }
        })
        .collect();
    Ok(HaulLedger {
        rows: out,
        total,
        since,
    })
}

/// Un blueprint tuyo con su nombre resuelto y sus ME/TE REALES (F1a).
/// El PRODUCTO no se resuelve aquí: sale de `public/bp_industry.json` (SDE) en el frontend,
/// que ya carga el resto del SDE. Aquí solo va lo que ESI sabe y el SDE no: tus ME/TE.
#[derive(Debug, Serialize)]
pub struct BlueprintView {
    /// typeID del BLUEPRINT (no del producto).
    pub type_id: i64,
    pub name: Option<String>,
    pub me: i64,
    pub te: i64,
    /// -1 = BPO (infinitas). En un BPC, las carreras restantes.
    pub runs: i64,
    /// -1 = BPO · -2 = BPC · >0 = pila de BPCs.
    pub quantity: i64,
    pub location_id: i64,
    /// Solo se rellena en la vista global (dónde vive el blueprint).
    pub character: Option<String>,
}

/// Convierte los blueprints crudos en vistas con nombre resuelto.
async fn blueprint_views(
    state: &State<'_, AppState>,
    raw: Vec<(Option<String>, crate::esi::industry::BlueprintRaw)>,
) -> Vec<BlueprintView> {
    let ids: HashSet<i64> = raw.iter().map(|(_, b)| b.type_id).collect();
    let names = state
        .esi
        .resolve_names(&ids.into_iter().collect::<Vec<_>>())
        .await
        .unwrap_or_default();
    raw.into_iter()
        .map(|(who, b)| BlueprintView {
            type_id: b.type_id,
            name: names.get(&b.type_id).cloned(),
            me: b.material_efficiency,
            te: b.time_efficiency,
            runs: b.runs,
            quantity: b.quantity,
            location_id: b.location_id,
            character: who,
        })
        .collect()
}

/// Tu biblioteca de blueprints (BPO/BPC con ME/TE reales) de UN personaje.
#[tauri::command]
pub async fn get_blueprints(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<BlueprintView>> {
    let token = token_with_scope(
        &state,
        character_id,
        "esi-characters.read_blueprints.v1",
        "Industria",
    )
    .await?;
    let raw = industry::fetch_blueprints(&state.esi, &state.db, character_id, &token).await?;
    Ok(blueprint_views(&state, raw.into_iter().map(|b| (None, b)).collect()).await)
}

/// Tu biblioteca de blueprints de TODOS los personajes (cada uno con su dueño).
#[tauri::command]
pub async fn get_blueprints_global(state: State<'_, AppState>) -> AppResult<Vec<BlueprintView>> {
    let mut raw: Vec<(Option<String>, crate::esi::industry::BlueprintRaw)> = Vec::new();
    for c in state.db.list_characters()? {
        if !c
            .scopes
            .iter()
            .any(|s| s == "esi-characters.read_blueprints.v1")
        {
            continue;
        }
        let valid = match state
            .tokens
            .access_token(state.esi.http(), c.character_id)
            .await
        {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Ok(bps) =
            industry::fetch_blueprints(&state.esi, &state.db, c.character_id, &valid.access_token)
                .await
        {
            for b in bps {
                raw.push((Some(c.name.clone()), b));
            }
        }
    }
    Ok(blueprint_views(&state, raw).await)
}

/// Minería GLOBAL desde la BD acumulada (todos los personajes).
#[tauri::command]
pub async fn get_mining_global(state: State<'_, AppState>) -> AppResult<MiningSummary> {
    build_mining(&state, None).await
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct MiningOre {
    pub type_id: i64,
    pub type_name: Option<String>,
    pub units: i64,
    pub isk: f64,
}
#[derive(Debug, Clone, serde::Serialize)]
pub struct MiningSys {
    pub system_id: i64,
    pub units: i64,
}
#[derive(Debug, Clone, serde::Serialize)]
pub struct MiningMonth {
    pub month: String,
    pub units: i64,
    pub isk: f64,
}
#[derive(Debug, Clone, serde::Serialize)]
pub struct MiningDetail {
    pub units: i64,
    pub est_value: f64,
    pub ore_types: i64,
    pub by_ore: Vec<MiningOre>,
    pub by_system: Vec<MiningSys>,
    pub monthly: Vec<MiningMonth>,
}

/// Periodos (YYYY-MM) con minería de un personaje.
#[tauri::command]
pub async fn get_mining_periods(
    character_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<String>> {
    state.db.mining_periods(Some(character_id))
}

/// Periodos (YYYY-MM) con minería, global.
#[tauri::command]
pub async fn get_mining_periods_global(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    state.db.mining_periods(None)
}

async fn build_mining_detail(
    state: &AppState,
    filter: Option<i64>,
    period: &str,
) -> AppResult<MiningDetail> {
    use std::collections::HashMap;
    let prices = state.db.prices_map().unwrap_or_default();
    let price_of = |tid: i64| prices.get(&tid).copied().unwrap_or(0.0);

    let by_type = state.db.mining_by_type_period(filter, period)?;
    let units: i64 = by_type.iter().map(|(_, q)| *q).sum();
    let est_value: f64 = by_type
        .iter()
        .map(|(tid, q)| *q as f64 * price_of(*tid))
        .sum();
    let ore_types = by_type.len() as i64;

    let mut by_ore: Vec<MiningOre> = by_type
        .into_iter()
        .map(|(type_id, q)| MiningOre {
            type_id,
            type_name: None,
            units: q,
            isk: q as f64 * price_of(type_id),
        })
        .collect();
    by_ore.truncate(20);

    // Nombres de los minerales (best-effort).
    let ids: Vec<i64> = by_ore.iter().map(|o| o.type_id).collect();
    if let Ok(names) = state.esi.resolve_names(&ids).await {
        for o in by_ore.iter_mut() {
            o.type_name = names.get(&o.type_id).cloned();
        }
    }

    let by_system: Vec<MiningSys> = state
        .db
        .mining_by_system_period(filter, period)?
        .into_iter()
        .map(|(system_id, units)| MiningSys { system_id, units })
        .collect();

    // Tendencia mensual (histórica): agrega unidades e ISK por mes.
    let mut months: HashMap<String, (i64, f64)> = HashMap::new();
    for (ym, tid, q) in state.db.mining_monthly_by_type(filter)? {
        let e = months.entry(ym).or_insert((0, 0.0));
        e.0 += q;
        e.1 += q as f64 * price_of(tid);
    }
    let mut monthly: Vec<MiningMonth> = months
        .into_iter()
        .map(|(month, (units, isk))| MiningMonth { month, units, isk })
        .collect();
    monthly.sort_by(|a, b| a.month.cmp(&b.month));

    Ok(MiningDetail {
        units,
        est_value,
        ore_types,
        by_ore,
        by_system,
        monthly,
    })
}

/// Detalle de minería de un mes (KPIs, ore breakdown, por sistema, tendencia) de un personaje.
#[tauri::command]
pub async fn get_mining_detail(
    character_id: i64,
    period: String,
    state: State<'_, AppState>,
) -> AppResult<MiningDetail> {
    build_mining_detail(&state, Some(character_id), &period).await
}

/// Detalle de minería de un mes, global.
#[tauri::command]
pub async fn get_mining_detail_global(
    period: String,
    state: State<'_, AppState>,
) -> AppResult<MiningDetail> {
    build_mining_detail(&state, None, &period).await
}

// ---- Serie temporal de minería (histórico completo) para gráfica unificada estilo Ingresos PvE ----
#[derive(Debug, Serialize)]
pub struct MineDay {
    pub date: String,
    pub value: f64,
    pub units: i64,
}
#[derive(Debug, Serialize)]
pub struct MineDimDay {
    pub id: i64, // system_id | character_id | type_id según el vector
    pub date: String,
    pub value: f64,
    pub units: i64,
}
#[derive(Debug, Serialize)]
pub struct MiningSeries {
    pub total_value: f64,
    pub total_units: i64,
    pub daily: Vec<MineDay>,
    pub daily_by_system: Vec<MineDimDay>,
    pub daily_by_char: Vec<MineDimDay>,
    pub daily_by_ore: Vec<MineDimDay>,
    pub ore_names: Vec<(i64, String)>,
}

// Datos de ore del SDE (volumen, portionSize, comprimido, materiales de reprocesado) embebidos.
#[derive(Debug, serde::Deserialize)]
struct OreInfo {
    #[allow(dead_code)]
    n: String,
    v: f64,        // volumen por unidad (m³)
    p: i64,        // portionSize (lote de reprocesado)
    c: i64,        // typeID comprimido (0 si no)
    r: Vec<(i64, i64)>, // materiales de reprocesado [(materialTypeID, cantidad por lote)]
}
fn ore_data() -> &'static std::collections::HashMap<i64, OreInfo> {
    static D: std::sync::OnceLock<std::collections::HashMap<i64, OreInfo>> =
        std::sync::OnceLock::new();
    D.get_or_init(|| serde_json::from_str(include_str!("../ore_data.json")).unwrap_or_default())
}

/// Índice `nombre EN en minúsculas → type_id` del catálogo de menas del SDE (embebido, sin red).
/// El gamelog escribe el NOMBRE de la mena, no su id: esta es la tabla que los confronta. Antes esto
/// se resolvía contra ESI, y toda mena que no respondiera se quedaba sin id (y sin nombre en la
/// gráfica). Con el catálogo local la resolución es determinista y completa.
fn ore_name_index() -> &'static std::collections::HashMap<String, i64> {
    static I: std::sync::OnceLock<std::collections::HashMap<String, i64>> =
        std::sync::OnceLock::new();
    I.get_or_init(|| {
        let mut m: std::collections::HashMap<String, i64> = ore_data()
            .iter()
            .filter(|(_, info)| !info.n.is_empty())
            .map(|(id, info)| (info.n.to_lowercase(), *id))
            .collect();
        // Nombres ANTIGUOS de las variantes (CCP las renombró a "X II/III-Grade" conservando el
        // typeID). Los gamelogs de años atrás los usan y el SDE actual ya no los conoce, así que sin
        // esto toda esa minería se queda sin id → sin valorar y sin nombre en la gráfica.
        let legacy: std::collections::HashMap<String, i64> =
            serde_json::from_str(include_str!("../ore_aliases.json")).unwrap_or_default();
        for (name, id) in legacy {
            m.entry(name.to_lowercase()).or_insert(id);
        }
        m
    })
}
/// Valor por UNIDAD de un ore según el modo de valoración elegido.
/// modos: "units" | "m3" | "bruto" | "comp" | "reproc" (reprocesado al 85%).
fn ore_per_unit(raw_id: i64, mode: &str, prices: &std::collections::HashMap<i64, f64>) -> f64 {
    let price = |t: i64| prices.get(&t).copied().unwrap_or(0.0);
    let info = ore_data().get(&raw_id);
    match mode {
        "units" => 1.0,
        "m3" => info.map(|i| i.v).unwrap_or(0.0),
        "comp" => match info {
            Some(i) if i.c > 0 && i.p > 0 => price(i.c) / i.p as f64,
            _ => price(raw_id),
        },
        "reproc" => match info {
            Some(i) if i.p > 0 && !i.r.is_empty() => i
                .r
                .iter()
                .map(|(m, q)| (*q as f64 / i.p as f64) * 0.85 * price(*m))
                .sum(),
            _ => price(raw_id),
        },
        _ => price(raw_id), // "bruto"
    }
}

async fn build_mining_series(
    state: &AppState,
    filter: Option<i64>,
    mode: &str,
) -> AppResult<MiningSeries> {
    use std::collections::{HashMap, HashSet};
    let prices = state.db.prices_map().unwrap_or_default();
    let rows = state.db.mining_rows_full(filter)?;

    let mut daily: HashMap<String, (f64, i64)> = HashMap::new();
    let mut sys_day: HashMap<(i64, String), (f64, i64)> = HashMap::new();
    let mut char_day: HashMap<(i64, String), (f64, i64)> = HashMap::new();
    let mut ore_day: HashMap<(i64, String), (f64, i64)> = HashMap::new();
    let mut ore_ids: HashSet<i64> = HashSet::new();
    let mut total_value = 0.0f64;
    let mut total_units = 0i64;

    for (date, sys, tid, qty, cid) in rows {
        let d = match date.as_deref() {
            Some(d) => d.get(0..10).unwrap_or(d).to_string(),
            None => continue,
        };
        let val = qty as f64 * ore_per_unit(tid, mode, &prices);
        total_value += val;
        total_units += qty;
        ore_ids.insert(tid);
        let e = daily.entry(d.clone()).or_insert((0.0, 0));
        e.0 += val;
        e.1 += qty;
        let es = sys_day.entry((sys, d.clone())).or_insert((0.0, 0));
        es.0 += val;
        es.1 += qty;
        let ec = char_day.entry((cid, d.clone())).or_insert((0.0, 0));
        ec.0 += val;
        ec.1 += qty;
        let eo = ore_day.entry((tid, d)).or_insert((0.0, 0));
        eo.0 += val;
        eo.1 += qty;
    }

    let ids: Vec<i64> = ore_ids.into_iter().collect();
    let names = state.esi.resolve_names(&ids).await.unwrap_or_default();
    let ore_names: Vec<(i64, String)> = ids
        .iter()
        .map(|id| (*id, names.get(id).cloned().unwrap_or_else(|| format!("#{id}"))))
        .collect();

    let mut dvec: Vec<MineDay> = daily
        .into_iter()
        .map(|(date, (value, units))| MineDay { date, value, units })
        .collect();
    dvec.sort_by(|a, b| a.date.cmp(&b.date));
    let to_dim = |m: HashMap<(i64, String), (f64, i64)>| {
        let mut v: Vec<MineDimDay> = m
            .into_iter()
            .map(|((id, date), (value, units))| MineDimDay { id, date, value, units })
            .collect();
        v.sort_by(|a, b| a.date.cmp(&b.date));
        v
    };

    Ok(MiningSeries {
        total_value,
        total_units,
        daily: dvec,
        daily_by_system: to_dim(sys_day),
        daily_by_char: to_dim(char_day),
        daily_by_ore: to_dim(ore_day),
        ore_names,
    })
}

/// Serie temporal de minería (histórico) de un personaje.
#[tauri::command]
pub async fn get_mining_series(
    character_id: i64,
    mode: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<MiningSeries> {
    build_mining_series(&state, Some(character_id), mode.as_deref().unwrap_or("bruto")).await
}

/// Serie temporal de minería (histórico), global.
#[tauri::command]
pub async fn get_mining_series_global(
    mode: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<MiningSeries> {
    build_mining_series(&state, None, mode.as_deref().unwrap_or("bruto")).await
}

// ============================ OVERLAY DE AVISOS (ventana flotante) ============================
// Ver `src/overlay.tsx` para el porqué y las reglas anti-ruido. Aquí solo va la fontanería:
// listar monitores, colocar la ventana y traer Koru al frente cuando el jugador hace clic.

/// Un monitor tal y como lo ve el sistema, para que el jugador elija DÓNDE quiere el aviso.
///
/// Esto es lo que evita tener que rastrear la ventana de EVE. Con multibox hay varios clientes y
/// perseguirlos es frágil (cambian de tamaño, se minimizan, cambian de monitor). Que el jugador
/// señale un hueco libre resuelve el 90% del problema y no se rompe nunca.
#[derive(Debug, Clone, Serialize)]
pub struct MonitorInfo {
    pub index: usize,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub is_primary: bool,
}

/// Dónde va el overlay: `(monitor, esquina, margen)`. Vive aquí porque el aviso lo enseña el HILO
/// DE INTEL, en Rust, que no tiene forma de leer el `localStorage` del navegador. El frontend lo
/// empuja al arrancar y cada vez que se cambia en Ajustes.
///
/// No se persiste en la BD a propósito, de momento: el frontend ya lo guarda en `localStorage` y lo
/// manda al arrancar, así que duplicarlo sería tener dos fuentes de verdad para el mismo ajuste —
/// justo lo que suele acabar en «cambié la opción y no cambió nada».
static OVERLAY_POS: std::sync::Mutex<Option<(usize, String, i32)>> = std::sync::Mutex::new(None);

/// Último alto pedido por `overlay_fit`, en píxeles LÓGICOS.
///
/// ⚠️ Existe por el mismo motivo que `OVERLAY_POS`, y la pista la dio el tester de Linux: en su
/// máquina la ventana se quedaba en 200 px con una tarjeta de 80 —hueco transparente de sobra—
/// mientras que en Windows se ciñe perfecta. Misma medida del DOM, distinto resultado.
/// La sospecha, con precedente en esta misma semana: **pedir geometría sobre una ventana OCULTA no
/// sobrevive**. El primer aviso mide y pide tamaño antes de que la ventana esté en pantalla, y ahí
/// se pierde; después el observador de tamaño solo vuelve a actuar si el contenido CAMBIA de alto,
/// así que nadie lo reintenta nunca.
static OVERLAY_ALTO: std::sync::Mutex<Option<f64>> = std::sync::Mutex::new(None);

/// Posición LIBRE: dónde lo dejó el usuario arrastrándolo, en píxeles físicos. `None` = manda la
/// esquina elegida en Ajustes.
///
/// Existe porque elegir «monitor + esquina» es pedirle al usuario que traduzca a coordenadas lo que
/// en realidad quiere señalar con el dedo. Idea de RoGiz7: **pincharlo y soltarlo donde te apetezca**.
/// Y en Wayland es además lo ÚNICO que funciona: allí una ventana no puede colocarse a sí misma
/// (`set_position` no hace nada), pero arrastrar usa el mecanismo del propio compositor.
static OVERLAY_LIBRE: std::sync::Mutex<Option<(i32, i32)>> = std::sync::Mutex::new(None);

/// Guarda dónde ha quedado el overlay tras arrastrarlo. Lo llama la propia ventana del aviso al
/// detectar que se ha movido. `None` = volver a la esquina.
#[tauri::command]
pub fn overlay_pos_libre(x: Option<i32>, y: Option<i32>) {
    if let Ok(mut g) = OVERLAY_LIBRE.lock() {
        *g = match (x, y) {
            (Some(x), Some(y)) => Some((x, y)),
            _ => None,
        };
    }
}

fn colocacion_guardada() -> Option<(usize, String, i32)> {
    OVERLAY_POS.lock().ok().and_then(|g| g.clone())
}

/// El cálculo de la esquina, extraído para que lo usen `overlay_place` y `mostrar_overlay`.
///
/// Las coordenadas van en píxeles FÍSICOS porque `available_monitors()` los da así; mezclarlos con
/// lógicos en un monitor con escalado deja la ventana a media pantalla de donde debería.
fn aplicar_colocacion(w: &tauri::WebviewWindow, monitor: usize, corner: &str, margin: i32) {
    let monitors = w.available_monitors().unwrap_or_default();
    let Some(m) = monitors.get(monitor).or_else(|| monitors.first()) else {
        return;
    };
    let (mw, mh) = (m.size().width as i32, m.size().height as i32);
    let (mx, my) = (m.position().x, m.position().y);
    let size = w.outer_size().map(|s| (s.width as i32, s.height as i32)).unwrap_or((460, 132));
    let x = match corner {
        "tl" | "bl" => mx + margin,
        "tc" | "bc" => mx + (mw - size.0) / 2,
        _ => mx + mw - size.0 - margin,
    };
    let y = match corner {
        "tl" | "tr" | "tc" => my + margin,
        _ => my + mh - size.1 - margin,
    };
    let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
}

/// Enciende o apaga el overlay: al encender lo coloca, al apagar lo esconde.
///
/// ⚠️⚠️ AQUÍ NO SE CREAN VENTANAS, Y ESO NO ES PEREZA. La ventana se declara en `tauri.conf.json`
/// y se crea con la app.
///
/// Lo intenté al revés —crearla bajo demanda con `WebviewWindowBuilder` dentro de
/// `run_on_main_thread`, para no pagar un WebView2 a quien no use la función— y **dejó Koru
/// inservible** (2026-08-05): el hilo principal de Tauri ES el bucle de eventos, el mismo que
/// responde a las llamadas IPC, y construir la ventana ahí durante el arranque lo bloqueaba. El
/// síntoma era desconcertante: la interfaz pintaba bien, pero NINGÚN comando volvía nunca — sin
/// error, porque una promesa que no se resuelve no imprime nada. La app salía con 0 personajes,
/// «Sincronizando datos…» eterno y la consola LIMPIA. Costó una hora encontrarlo.
///
/// Ahorrar esa webview sigue siendo deseable, pero hay que hacerlo bien (crearla en `setup()`,
/// que sí es el momento del hilo principal, leyendo el ajuste de la BD y no de localStorage).
/// Está anotado en el backlog. Mientras tanto: correcto antes que óptimo.
#[tauri::command]
pub fn overlay_enable(
    app: tauri::AppHandle,
    enabled: bool,
    monitor: usize,
    corner: String,
    margin: i32,
) -> AppResult<()> {
    if !enabled {
        if let Some(w) = app.get_webview_window("overlay") {
            let _ = w.hide();
        }
        return Ok(());
    }
    overlay_place(app, monitor, corner, margin)
}

#[tauri::command]
pub fn overlay_monitors(app: tauri::AppHandle) -> AppResult<Vec<MonitorInfo>> {
    let Some(w) = app.get_webview_window("overlay") else {
        return Ok(Vec::new());
    };
    let primary = w.primary_monitor().ok().flatten();
    let pname = primary.as_ref().and_then(|m| m.name().cloned());
    let list = w.available_monitors().unwrap_or_default();
    Ok(list
        .into_iter()
        .enumerate()
        .map(|(i, m)| {
            let size = m.size();
            let pos = m.position();
            let name = m.name().cloned().unwrap_or_else(|| format!("Monitor {}", i + 1));
            MonitorInfo {
                index: i,
                is_primary: Some(&name) == pname.as_ref(),
                name,
                width: size.width,
                height: size.height,
                x: pos.x,
                y: pos.y,
            }
        })
        .collect())
}

/// Coloca el overlay en una esquina del monitor elegido.
///
/// `corner`: "tl" | "tc" | "tr" | "bl" | "bc" | "br" — (arriba/abajo) × (izquierda/centro/derecha).
/// En las centradas el margen NO se aplica en horizontal: centrado es centrado.
/// Las coordenadas van en píxeles FÍSICOS porque `available_monitors()` los da así; mezclarlos con
/// lógicos en un monitor con escalado deja la ventana a media pantalla de donde debería.
#[tauri::command]
pub fn overlay_place(
    app: tauri::AppHandle,
    monitor: usize,
    corner: String,
    margin: i32,
) -> AppResult<()> {
    let Some(w) = app.get_webview_window("overlay") else {
        return Ok(());
    };
    // Se RECUERDA aunque la ventana esté oculta: es lo que permite recolocarla justo antes de
    // enseñarla, que es el único momento en que la posición se queda de verdad.
    if let Ok(mut g) = OVERLAY_POS.lock() {
        *g = Some((monitor, corner.clone(), margin));
    }
    aplicar_colocacion(&w, monitor, &corner, margin);
    Ok(())
}

/// Ajusta el ALTO de la ventana al contenido y la vuelve a colocar.
///
/// Hace falta porque el overlay es una PILA de avisos que crece y mengua. Y no es cosmética: una
/// ventana transparente sigue capturando los clics del ratón a nivel de sistema operativo, así que
/// un hueco vacío pero sólido encima del juego se comería pulsaciones destinadas a EVE. La ventana
/// tiene que medir exactamente lo que ocupa.
///
/// El `height` llega en píxeles LÓGICOS (lo que mide el DOM); `LogicalSize` se encarga del escalado.
/// Después se recoloca: si está anclada abajo, crecer sin recolocar movería el borde inferior.
#[tauri::command]
pub fn overlay_fit(
    app: tauri::AppHandle,
    height: f64,
    monitor: usize,
    corner: String,
    margin: i32,
) -> AppResult<()> {
    let Some(w) = app.get_webview_window("overlay") else {
        return Ok(());
    };
    // Suelo y techo por seguridad: un alto de 0 (o absurdo) por un fallo de medición dejaría la
    // ventana invisible o tapando la pantalla, y el jugador no tendría forma de arreglarlo.
    let h = height.clamp(60.0, 900.0);
    let ancho = 430.0;
    // Se RECUERDA aunque la ventana esté oculta: es lo que permite volver a aplicarlo justo antes
    // de enseñarla, que es el único momento en que el tamaño se queda de verdad.
    if let Ok(mut g) = OVERLAY_ALTO.lock() {
        *g = Some(h);
    }
    let _ = w.set_size(tauri::LogicalSize::new(ancho, h));

    // Si el usuario lo colocó a mano, NO se recoloca al crecer o menguar la pila: moverle el aviso
    // de donde lo puso sería desobedecerle cada vez que llega un hostil más.
    if OVERLAY_LIBRE.lock().ok().and_then(|g| *g).is_some() {
        return Ok(());
    }

    // ⚠️ La posición se calcula con el tamaño que ACABAMOS de pedir, NO releyendo `outer_size()`.
    // `set_size` no es instantáneo en Windows: releer justo después devuelve a menudo el tamaño
    // VIEJO, y con la ventana anclada abajo o a la derecha eso la deja descolocada un pico cada vez
    // que crece o mengua la pila. Por eso esto no llama a `overlay_place`.
    let escala = w.scale_factor().unwrap_or(1.0);
    let (pw, ph) = ((ancho * escala) as i32, (h * escala) as i32);
    let monitors = w.available_monitors().unwrap_or_default();
    if let Some(m) = monitors.get(monitor).or_else(|| monitors.first()) {
        let (mw, mh) = (m.size().width as i32, m.size().height as i32);
        let (mx, my) = (m.position().x, m.position().y);
        let x = match corner.as_str() {
            "tl" | "bl" => mx + margin,
            "tc" | "bc" => mx + (mw - pw) / 2,
            _ => mx + mw - pw - margin,
        };
        let y = match corner.as_str() {
            "tl" | "tr" | "tc" => my + margin,
            _ => my + mh - ph - margin,
        };
        let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
    }
    Ok(())
}

/// El reloj del abismo, tal como lo recibe el overlay.
#[derive(Debug, Clone, Serialize)]
pub struct AbyssTimer {
    /// Cuándo se acaba el tiempo, en ms epoch. **Se manda el FINAL, no lo que queda**: así el
    /// overlay cuenta solo con su propio reloj y bastan tres avisos por run en vez de uno por
    /// segundo. Además, si un mensaje se pierde, la cuenta atrás sigue siendo correcta.
    pub ends_at_ms: i64,
    /// `warn` = aviso puntual (quedan 5 min) · `count` = cuenta atrás visible (últimos 3) ·
    /// `off` = se acabó la run, quitar.
    pub mode: String,
}

/// ★ N3: empuja el reloj de la run abisal al overlay.
///
/// POR QUÉ MERECE EL OVERLAY cuando la PI y los logros no: **estás DENTRO y no puedes alt-tabear**.
/// El tope del abismo son 20 minutos y pasarse no es perder puntos, es perder la nave. Cumple la
/// regla al pie de la letra — ¿harías algo distinto en los próximos 30 segundos? Sí: salir.
///
/// Los umbrales los eligió RoGiz7: **aviso a los 5 minutos** (ahí decides si entras a otra oleada)
/// y **cuenta atrás visible en los últimos 3** (ahí ya no es un aviso, es información continua).
#[tauri::command]
pub fn overlay_abyss(app: tauri::AppHandle, ends_at_ms: i64, mode: String) -> AppResult<()> {
    if mode != "off" {
        mostrar_overlay(&app);
    }
    let _ = app.emit("abyss-timer", AbyssTimer { ends_at_ms, mode });
    Ok(())
}

/// Esconde el overlay. Lo llama el propio overlay cuando se le acaba la cola.
#[tauri::command]
pub fn overlay_hide(app: tauri::AppHandle) -> AppResult<()> {
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.hide();
    }
    Ok(())
}

/// Radiografía de la ventana del overlay. Existe porque depurar una ventana **transparente y sin
/// bordes** a ojo es imposible: si no se ve, puede ser que no exista, que esté fuera de la pantalla,
/// que esté detrás, o que exista y sencillamente no pinte. Los cuatro casos se ven igual — nada.
/// Esto los distingue.
#[derive(Debug, Clone, Serialize)]
pub struct OverlayDebug {
    pub exists: bool,
    pub visible: bool,
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
    pub scale: f64,
    /// ¿Cae dentro de algún monitor? Si es `false`, la ventana está viva pero fuera de la vista.
    pub on_screen: bool,
    pub monitors: Vec<MonitorInfo>,
}

#[tauri::command]
pub fn overlay_debug(app: tauri::AppHandle) -> AppResult<OverlayDebug> {
    let monitors = overlay_monitors(app.clone())?;
    let Some(w) = app.get_webview_window("overlay") else {
        return Ok(OverlayDebug {
            exists: false,
            visible: false,
            x: 0,
            y: 0,
            w: 0,
            h: 0,
            scale: 1.0,
            on_screen: false,
            monitors,
        });
    };
    let pos = w.outer_position().ok();
    let size = w.outer_size().ok();
    let (x, y) = pos.map(|p| (p.x, p.y)).unwrap_or((0, 0));
    let (ww, hh) = size.map(|s| (s.width, s.height)).unwrap_or((0, 0));
    let on_screen = monitors.iter().any(|m| {
        x + (ww as i32) > m.x && x < m.x + m.width as i32 && y + (hh as i32) > m.y && y < m.y + m.height as i32
    });
    Ok(OverlayDebug {
        exists: true,
        visible: w.is_visible().unwrap_or(false),
        x,
        y,
        w: ww,
        h: hh,
        scale: w.scale_factor().unwrap_or(1.0),
        on_screen,
        monitors,
    })
}

/// Aviso de PRUEBA: para colocar la ventana sin tener que esperar a que aparezca un hostil.
/// Sin esto, ajustar la posición sería imposible salvo con suerte.
///
/// ⚠️ Se emite con `emit` GLOBAL, igual que un aviso de intel de verdad, y no con `emit_to` a la
/// ventana del overlay. Un test que recorre un camino distinto al de producción puede pasar con el
/// camino real roto —o fallar con el real bien—, que es lo peor de los dos mundos.
///
/// Efecto secundario asumido: la ventana principal también lo recibe y saca su banner un instante,
/// que se autocancela porque el sistema de prueba no está en los reportes de intel vivos. Ese
/// parpadeo dentro de Koru es esperado y NO es el overlay.
///
/// ⚠️ Los TEXTOS los manda el frontend ya traducidos, no se escriben aquí. Rust no tiene i18n
/// —`tr()` y el diccionario viven en `src/i18n.ts`—, así que cualquier literal castellano metido en
/// este fichero sale en castellano por mucho que la app esté en inglés. Pasó exactamente eso: con la
/// interfaz en EN, el aviso de prueba enseñaba «Piloto de prueba». Lo demás que se ve en la tarjeta
/// (Jita, Perimeter, Ishtar, Gila) son nombres de EVE y no se traducen.
#[tauri::command]
pub fn overlay_test(
    app: tauri::AppHandle,
    mensaje: String,
    alt: String,
    hostil: String,
) -> AppResult<()> {
    mostrar_overlay(&app);
    let _ = app.emit(
        "intel-alert",
        IntelAlertEvent {
            sys_id: 30000142,
            system: "Jita".into(),
            jumps: 1,
            author: "Koru".into(),
            message: mensaje,
            ts_ms: chrono::Utc::now().timestamp_millis(),
            // DOS pilotos en el MISMO sistema, y ese sistema es además el ancla. Es el caso que
            // ejerce de una vez las tres cosas nuevas del renglón: agrupar («+1»), nombrar el
            // sistema cuando están juntos, y cruzar piloto con ancla. Un tercero más lejos
            // comprueba lo contrario — que a los de atrás no se les da sitio.
            pilots: vec![
                PilotProximity {
                    name: "RoGiz7".into(),
                    jumps: 1,
                    ship: Some("Ishtar".into()),
                    ship_type_id: Some(12005),
                    system_id: 30000144,
                    system: Some("Perimeter".into()),
                },
                PilotProximity {
                    // Nombre distinto del de arriba A PROPÓSITO: el test existe para enseñar la
                    // AGRUPACIÓN («+1») de dos pilotos en el mismo sistema. Con el mismo nombre
                    // dos veces, el caso que se quiere demostrar deja de verse.
                    name: alt,
                    jumps: 1,
                    ship: Some("Loki".into()),
                    ship_type_id: Some(29990),
                    system_id: 30000144,
                    system: Some("Perimeter".into()),
                },
                PilotProximity {
                    name: "Dana-FeSe".into(),
                    jumps: 6,
                    ship: Some("Venture".into()),
                    ship_type_id: Some(32880),
                    system_id: 30000180,
                    system: Some("Sobaseki".into()),
                },
            ],
            anchor: Some(AnchorProximity {
                name: "Perimeter".into(),
                system_id: 30000144,
                jumps: 1,
            }),
            // Con hostil y nave: un test que no ejerza la parte NUEVA de la tarjeta no prueba nada.
            // Sin `character_id`, así que además se ve el caso «no le conocemos» (círculo con «?»).
            parse: IntelParse {
                hostiles: vec![Hostil { name: hostil, character_id: None }],
                ships: vec![NaveCitada { type_id: 17715, name: "Gila".into() }],
                count: Some(2),
            },
        },
    );
    Ok(())
}

/// Lo que necesita la ficha de aviso del mapa para abrirse tal cual. Se manda el aviso ENTERO y no
/// solo el `sys_id`: si el frontend tuviera que reconstruirlo buscando en el feed, un aviso ya
/// caducado o desplazado no se encontraría y el clic no haría nada.
#[derive(Clone, Debug, Serialize)]
pub struct OverlayGoto {
    pub sys_id: i64,
    pub system: String,
    pub ts_ms: i64,
    pub author: String,
    pub message: String,
}

/// Clic en el aviso → traer Koru al frente y ABRIR LA FICHA de ese aviso en el mapa.
///
/// Las tres llamadas de ventana son las mismas que ya usa el manejador de instancia única, que es
/// código probado en producción. Y aquí `set_focus()` SÍ es legítimo: Windows bloquea que una app
/// en segundo plano se ponga delante sola, pero cuando el usuario hace clic le concede el foco.
#[tauri::command]
pub fn overlay_open_main(
    app: tauri::AppHandle,
    sys_id: i64,
    system: String,
    ts_ms: i64,
    author: String,
    message: String,
) -> AppResult<()> {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    let _ = app.emit(
        "overlay-goto-system",
        OverlayGoto { sys_id, system, ts_ms, author, message },
    );
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.hide();
    }
    Ok(())
}
