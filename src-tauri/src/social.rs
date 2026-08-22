//! SOCIAL — ingesta del historial de conversaciones privadas desde los chatlogs locales.
//!
//! Idea de RoGiz7 (2026-08-22): EVE genera un log por cada chat privado y luego no deja releerlos;
//! Koru los convierte en un historial visual por interlocutor. Es el mismo principio de la casa
//! —el juego da una foto, Koru guarda la película— aplicado a otro histórico de tu vida en EVE.
//! Solo LECTURA por construcción: escribir en un chat desde fuera del juego es imposible.
//!
//! ★ TODO EL DISEÑO SE MIDIÓ ANTES DE ESCRIBIRSE (contra 49.372 chatlogs reales, 2020→2026):
//!   · Un privado se reconoce por `Channel ID: private_...` en la cabecera. NADA MÁS es fiable:
//!     ni el nombre de fichero (localizado: «Private Chat (2)» / «Chat privado (2)») ni el prefijo
//!     `player_` (canales públicos lo llevan también; su forma refleja cuándo se creó el canal).
//!   · El UUID es EL MISMO en los dos lados de la conversación → los logs espejo del multibox se
//!     deduplican por clave exacta (PK de social_message), no por heurística temporal.
//!   · El interlocutor solo sale del CUERPO (el autor que no eres tú). Si nunca contestó, es
//!     «sin identificar» y se dice así — no se adivina.
//!
//! El escaneo es un botón en la sección, no un vigilante: leer conversaciones privadas debe ser un
//! acto deliberado, el mismo criterio que el grabador de flotas.

use crate::chatlog;
use crate::db::{Db, SocialMsgRow};
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

/// Resultado del escaneo, para pintarlo en la sección.
#[derive(Debug, Default, Serialize)]
pub struct SocialScanStats {
    /// Ficheros .txt vistos en la carpeta (todos, privados o no).
    pub files_seen: usize,
    /// Ficheros examinados en esta pasada (nuevos o con mtime cambiado).
    pub files_read: usize,
    /// De ellos, cuántos eran chats privados.
    pub privates: usize,
    /// Mensajes NUEVOS que entraron en la BD (los espejo del multibox no cuentan: choca la PK).
    pub new_messages: usize,
}

/// `[ 2020.06.06 13:49:22 ] Autor > texto` → (epoch, autor, texto). Mismo formato que el intel.
/// Los mensajes de sistema (MOTD, «canal cambiado») no son conversación y se filtran aquí,
/// por NOMBRE de autor localizado — la lista corta de los idiomas que EVE escribe en los logs.
fn parse_line(line: &str) -> Option<(i64, String, String)> {
    let line = line.trim_start_matches(|c: char| c.is_control() || c == '\u{feff}').trim_start();
    if !line.starts_with('[') {
        return None;
    }
    let close = line.find(']')?;
    let ts_txt = line[1..close].trim(); // «2020.06.06 13:49:22»
    let ts = chrono::NaiveDateTime::parse_from_str(ts_txt, "%Y.%m.%d %H:%M:%S")
        .ok()?
        .and_utc()
        .timestamp();
    let resto = line[close + 1..].trim_start();
    let sep = resto.find(" > ")?;
    let autor = resto[..sep].trim();
    if autor.is_empty() {
        return None;
    }
    // Autor «sistema» según el idioma del cliente EN EL MOMENTO del log (el corpus real tiene
    // épocas en inglés y en castellano; se añaden el resto de idiomas de EVE por si acaso).
    const SISTEMA: [&str; 6] = [
        "EVE System",
        "Sistema EVE",
        "EVE-System",
        "Système EVE",
        "Система EVE",
        "EVEシステム",
    ];
    if SISTEMA.contains(&autor) {
        return None;
    }
    Some((ts, autor.to_string(), resto[sep + 3..].to_string()))
}

/// `Campo:   valor` de la cabecera (Channel ID, Listener…).
fn header_field<'a>(head: &'a str, field: &str) -> Option<&'a str> {
    let i = head.find(field)? + field.len();
    let v = head[i..].lines().next()?.trim();
    if v.is_empty() { None } else { Some(v) }
}

/// Arranque de sesión y charID del listener, desde el nombre del fichero:
/// `{Canal}_{AAAAMMDD}_{HHMMSS}[_{charID}].txt`. Los de 2020 no llevan charID.
fn stem_partes(fname: &str) -> (Option<i64>, Option<i64>) {
    let Some(stem) = fname.strip_suffix(".txt") else {
        return (None, None);
    };
    let partes: Vec<&str> = stem.split('_').collect();
    // charID = último campo si es numérico largo
    let (charid, fin) = match partes.last() {
        Some(t) if t.len() > 6 && t.bytes().all(|b| b.is_ascii_digit()) => {
            (t.parse::<i64>().ok(), partes.len() - 1)
        }
        _ => (None, partes.len()),
    };
    // fecha_hora = los dos campos anteriores
    let started = if fin >= 2 {
        chatlog::session_secs(&format!("{}_{}", partes[fin - 2], partes[fin - 1]))
    } else {
        None
    };
    (started, charid)
}

/// Escanea `Chatlogs/` y `Chatlogs/old/` e ingiere los chats privados nuevos o cambiados.
/// Idempotente: repetirlo no duplica nada (PKs), y con `social_file`+mtime solo decodifica lo
/// que cambió — la primera pasada mira todas las cabeceras, las siguientes casi ninguna.
pub fn scan(db: &Db, folder: &str) -> AppResult<SocialScanStats> {
    // Misma queja explícita que `intel_channels`: «no he podido mirar» ≠ «no hay nada».
    std::fs::read_dir(folder)
        .map_err(|e| AppError::Other(format!("No se pudo leer la carpeta «{folder}»: {e}")))?;

    let base = Path::new(folder);
    let mut stats = SocialScanStats::default();
    for dir in [base.to_path_buf(), base.join("old")] {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        let mut files: Vec<(String, PathBuf, i64)> = Vec::new();
        for e in rd.flatten() {
            let fname = e.file_name().to_string_lossy().into_owned();
            if !fname.ends_with(".txt") {
                continue;
            }
            let mtime = e
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            files.push((fname, e.path(), mtime));
        }
        files.sort();
        stats.files_seen += files.len();
        for (fname, path, mtime) in files {
            if db.social_file_fresh(&fname, mtime)? {
                continue;
            }
            stats.files_read += 1;
            // Cabecera primero (4 KB): la inmensa mayoría no es privada y se descarta barato.
            let Some(head) = chatlog::decode_head(&path) else {
                db.social_mark_file(&fname, mtime, false)?;
                continue;
            };
            let es_privado = header_field(&head, "Channel ID:")
                .map(|v| v.starts_with("private_"))
                .unwrap_or(false);
            if !es_privado {
                db.social_mark_file(&fname, mtime, false)?;
                continue;
            }
            stats.privates += 1;
            let Some(texto) = chatlog::decode(&path) else {
                db.social_mark_file(&fname, mtime, false)?;
                continue;
            };
            let uuid = header_field(&texto, "Channel ID:").unwrap_or_default().to_string();
            let listener = header_field(&texto, "Listener:").unwrap_or_default().to_string();
            if uuid.is_empty() || listener.is_empty() {
                // Cabecera rota: se marca visto para no reintentarlo cada escaneo, y no se inventa.
                db.social_mark_file(&fname, mtime, false)?;
                continue;
            }
            let (started, charid) = stem_partes(&fname);
            let msgs: Vec<(i64, String, String)> =
                texto.lines().filter_map(parse_line).collect();
            stats.new_messages += db.social_ingest_session(
                &uuid,
                &fname,
                &listener,
                charid,
                started.unwrap_or(0),
                &msgs,
            )?;
            db.social_mark_file(&fname, mtime, true)?;
        }
    }
    Ok(stats)
}

/// Una entrada del resumen: un interlocutor, un grupo, o el cubo `quienes=[]` (solo tus
/// personajes hablando entre sí, o mensajes que nadie contestó).
#[derive(Debug, Serialize)]
pub struct SocialConvo {
    /// Interlocutores EXTERNOS, ordenados alfabéticamente. Vacío = el cubo de los tuyos.
    pub quienes: Vec<String>,
    /// Nº de conversaciones (uuids) con exactamente esta gente.
    pub convos: i64,
    pub msgs: i64,
    pub first_ts: i64,
    pub last_ts: i64,
}

/// Firma de una conversación = el conjunto ORDENADO de sus autores externos. Se calcula en Rust y
/// no con GROUP_CONCAT a propósito: SQLite no garantiza el orden dentro del agregado, y una firma
/// que a veces saliera «A,B» y a veces «B,A» partiría la misma conversación en dos entradas.
fn firmas_por_uuid(
    db: &Db,
) -> AppResult<(BTreeMap<String, (Vec<String>, i64, i64, i64)>, BTreeSet<String>)> {
    let mios: BTreeSet<String> = db.social_listeners()?.into_iter().collect();
    // uuid → (externos ordenados, msgs, first, last)
    let mut por_uuid: BTreeMap<String, (Vec<String>, i64, i64, i64)> = BTreeMap::new();
    for (uuid, author, msgs, first, last) in db.social_authors()? {
        let e = por_uuid.entry(uuid).or_insert((Vec::new(), 0, i64::MAX, 0));
        if !mios.contains(&author) {
            e.0.push(author);
        }
        e.1 += msgs;
        e.2 = e.2.min(first);
        e.3 = e.3.max(last);
    }
    for e in por_uuid.values_mut() {
        e.0.sort();
    }
    Ok((por_uuid, mios))
}

/// El resumen por interlocutor/grupo, ordenado por actividad reciente.
pub fn overview(db: &Db) -> AppResult<Vec<SocialConvo>> {
    let (por_uuid, _) = firmas_por_uuid(db)?;
    let mut agg: BTreeMap<Vec<String>, (i64, i64, i64, i64)> = BTreeMap::new();
    for (_, (firma, msgs, first, last)) in por_uuid {
        let e = agg.entry(firma).or_insert((0, 0, i64::MAX, 0));
        e.0 += 1;
        e.1 += msgs;
        e.2 = e.2.min(first);
        e.3 = e.3.max(last);
    }
    let mut out: Vec<SocialConvo> = agg
        .into_iter()
        .map(|(quienes, (convos, msgs, first_ts, last_ts))| SocialConvo {
            quienes,
            convos,
            msgs,
            first_ts,
            last_ts,
        })
        .collect();
    out.sort_by_key(|c| -c.last_ts);
    Ok(out)
}

/// El hilo de UNA entrada del resumen: exactamente las conversaciones cuya firma coincide.
/// Un grupo no se mezcla con el 1:1 de uno de sus miembros: son firmas distintas.
pub fn thread(db: &Db, quienes: &[String]) -> AppResult<Vec<SocialMsgRow>> {
    let mut buscada: Vec<String> = quienes.to_vec();
    buscada.sort();
    let (por_uuid, _) = firmas_por_uuid(db)?;
    let uuids: Vec<String> = por_uuid
        .into_iter()
        .filter(|(_, (firma, ..))| *firma == buscada)
        .map(|(u, _)| u)
        .collect();
    db.social_msgs_for_uuids(&uuids)
}
