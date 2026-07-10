//! Lectura de los chatlogs de EVE (`Chatlogs/`, UTF-16LE) para saber EN QUÉ SISTEMA estabas en cada
//! instante. Es la pieza que el gamelog no tiene: el gamelog solo nombra un sistema cuando SALTAS, y
//! el ratero típico se planta ocho horas sin saltar (validado: 379 bounties, 0 saltos en un día).
//!
//! El canal Local escribe una línea en CADA cambio de sistema, incluidos el login y el clon de salto:
//!   `[ 2026.06.29 08:40:52 ] Sistema EVE > El canal ha cambiado a Local: TTP-2B.`
//!   `[ 2020.06.06 13:49:22 ] EVE System > Channel changed to Local : 1DQ1-A.`
//!
//! REGLA DE ORO: **no se arrastra el sistema entre sesiones.** Cada fichero de gamelog es una sesión y
//! se empareja con SU fichero `Local_*` (mismo personaje, mismo arranque). Sin gemelo no se atribuye
//! nada. Así un clon de salto —que teletransporta sin escribir línea de salto— jamás puede contaminar
//! la sesión siguiente.
//!
//! Cobertura medida sobre los logs reales: los gamelogs CON charID encuentran gemelo único el 100% de
//! las veces (1.200/1.200); los huérfanos, el 96,6% (596/617), 20 ambiguos y 1 sin Local.
//! Validado contra verdad conocida: el bruto atribuido a TTP-2B un día coincide al ISK con el sistema
//! que dice el `Description` de la wallet.

use chrono::{NaiveDate, NaiveDateTime};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Un cambio de sistema: instante (segundos epoch) y nombre del sistema.
pub struct Presence {
    pub secs: i64,
    pub system: String,
}

/// Decodifica solo el principio del fichero. La cabecera (con el `Listener:`) cabe de sobra en 4 KB y
/// así no leemos enteros los 34 MB de Local antiguos solo para averiguar de quién son.
fn decode_head(path: &Path) -> Option<String> {
    use std::io::Read;
    let mut f = std::fs::File::open(path).ok()?;
    let mut b = vec![0u8; 4096];
    let n = f.read(&mut b).ok()?;
    b.truncate(n);
    Some(decode_bytes(b))
}

/// Decodifica un chatlog. EVE los escribe en UTF-16LE con BOM; los muy antiguos pueden ser UTF-8.
fn decode(path: &Path) -> Option<String> {
    Some(decode_bytes(std::fs::read(path).ok()?))
}

fn decode_bytes(b: Vec<u8>) -> String {
    if b.len() >= 2 && b[0] == 0xFF && b[1] == 0xFE {
        let u16s: Vec<u16> = b[2..]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        return String::from_utf16_lossy(&u16s);
    }
    // Sin BOM: si hay muchos ceros intercalados sigue siendo UTF-16LE.
    let zeros = b.iter().take(400).filter(|&&x| x == 0).count();
    if zeros > 40 {
        let u16s: Vec<u16> = b
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        return String::from_utf16_lossy(&u16s);
    }
    String::from_utf8_lossy(&b).into_owned()
}

/// `AAAAMMDD_HHMMSS` → segundos epoch. Es el arranque de sesión, que va en el nombre del fichero.
pub fn session_secs(stem: &str) -> Option<i64> {
    if stem.len() < 15 {
        return None;
    }
    let y: i32 = stem.get(0..4)?.parse().ok()?;
    let mo: u32 = stem.get(4..6)?.parse().ok()?;
    let d: u32 = stem.get(6..8)?.parse().ok()?;
    let h: u32 = stem.get(9..11)?.parse().ok()?;
    let mi: u32 = stem.get(11..13)?.parse().ok()?;
    let s: u32 = stem.get(13..15)?.parse().ok()?;
    Some(NaiveDate::from_ymd_opt(y, mo, d)?.and_hms_opt(h, mi, s)?.and_utc().timestamp())
}

/// `AAAA-MM-DD` + segundos del día → segundos epoch. Para situar un evento del gamelog.
pub fn event_secs(date: &str, sec_of_day: i64) -> Option<i64> {
    if sec_of_day < 0 {
        return None;
    }
    let y: i32 = date.get(0..4)?.parse().ok()?;
    let mo: u32 = date.get(5..7)?.parse().ok()?;
    let d: u32 = date.get(8..10)?.parse().ok()?;
    Some(NaiveDate::from_ymd_opt(y, mo, d)?.and_hms_opt(0, 0, 0)?.and_utc().timestamp() + sec_of_day)
}

/// `[ 2026.06.29 08:40:52 ]` → segundos epoch.
fn line_secs(line: &str) -> Option<i64> {
    let i = line.find("[ ")? + 2;
    let s = line.get(i..i + 19)?;
    NaiveDateTime::parse_from_str(s, "%Y.%m.%d %H:%M:%S")
        .ok()
        .map(|t| t.and_utc().timestamp())
}

/// El piloto que escribió el chatlog, según la cabecera. Está en TODOS los Local, de cualquier época.
fn listener_of(path: &Path) -> Option<String> {
    let head = decode_head(path)?;
    let i = head.find("Listener:")? + "Listener:".len();
    let name = head[i..].lines().next()?.trim();
    if name.is_empty() { None } else { Some(name.to_string()) }
}

/// Identidad de la sesión (el charID del nombre del fichero, o el nombre del piloto si no lo lleva) y,
/// cuando el fichero es moderno, el par nombre↔charID que nos permitirá traducir los antiguos.
fn ident_and_name(path: &Path, fname: &str) -> Option<(String, Option<String>)> {
    let stem = fname.strip_suffix(".txt")?;
    let listener = listener_of(path);
    if let Some(id) = stem.rsplit('_').next() {
        if id.len() > 6 && id.bytes().all(|b| b.is_ascii_digit()) {
            return Some((id.to_string(), listener));
        }
    }
    listener.map(|n| (n, None))
}

/// Índice de sesiones de Local: identidad → [(arranque, ruta)], ordenado por arranque.
pub struct LocalIndex {
    by_ident: HashMap<String, Vec<(i64, PathBuf)>>,
    /// nombre de piloto → (character_id → primera vez que lo vimos con ese nombre). Sale de los Local
    /// MODERNOS, que traen las dos cosas: el charID en el nombre del fichero y el piloto en la
    /// cabecera. Así no dependemos de qué personajes estén dados de alta en Koru.
    names: HashMap<String, HashMap<i64, i64>>,
}

impl LocalIndex {
    /// Recorre `Chatlogs/` y `Chatlogs/old/`. Solo mira los ficheros `Local_*`.
    pub fn build(dir: &Path) -> LocalIndex {
        let mut by_ident: HashMap<String, Vec<(i64, PathBuf)>> = HashMap::new();
        let mut names: HashMap<String, HashMap<i64, i64>> = HashMap::new();
        for sub in [dir.to_path_buf(), dir.join("old")] {
            let rd = match std::fs::read_dir(&sub) {
                Ok(r) => r,
                Err(_) => continue,
            };
            for e in rd.flatten() {
                let fname = e.file_name().to_string_lossy().into_owned();
                if !fname.starts_with("Local_") || !fname.ends_with(".txt") {
                    continue;
                }
                let stem = &fname["Local_".len()..];
                let secs = match session_secs(stem) {
                    Some(s) => s,
                    None => continue,
                };
                if let Some((id, listener)) = ident_and_name(&e.path(), &fname) {
                    if let (Some(name), Ok(cid)) = (listener, id.parse::<i64>()) {
                        let first = names.entry(name).or_default().entry(cid).or_insert(secs);
                        *first = (*first).min(secs);
                    }
                    by_ident.entry(id).or_default().push((secs, e.path()));
                }
            }
        }
        for v in by_ident.values_mut() {
            v.sort_by_key(|(s, _)| *s);
        }
        LocalIndex { by_ident, names }
    }

    pub fn is_empty(&self) -> bool {
        self.by_ident.is_empty()
    }

    /// Traduce la identidad de una sesión a un `character_id`. Si ya es un charID, listo. Si es un
    /// nombre de piloto, lo buscamos en los Local modernos… y ahí hay trampa: un nombre puede apuntar
    /// a DOS personajes (renombrados, o un alt que hereda el nombre). Se elige el charID cuya primera
    /// aparición con ese nombre está más cerca en el tiempo de la sesión que estamos resolviendo.
    /// Caso real: `SieteHierros` = 152730148 (visto desde 2021-02, 3.499 ficheros) y 2112004119 (dos
    /// ficheros de mayo de 2024). Los huérfanos son todos de 2019-2021 → el primero, correcto.
    pub fn resolve_char(&self, ident: &str, session: i64) -> Option<i64> {
        if let Ok(id) = ident.parse::<i64>() {
            return Some(id);
        }
        self.names
            .get(ident)?
            .iter()
            .min_by_key(|(_, first)| (*first - session).abs())
            .map(|(id, _)| *id)
    }

    /// Gemelo de una sesión conocida. El Local se crea unos segundos DESPUÉS del gamelog (mediana 23 s
    /// medida sobre los logs); la ventana (-10 s, +30 s] da gemelo único el 100% de las veces.
    pub fn twin(&self, ident: &str, session: i64) -> Option<&PathBuf> {
        let v = self.by_ident.get(ident)?;
        let mut hit = None;
        for (s, p) in v {
            let d = s - session;
            if (-10..=30).contains(&d) {
                if hit.is_some() {
                    return None; // dos candidatos para el mismo pj: no adivinamos
                }
                hit = Some(p);
            }
        }
        hit
    }

    /// Para los gamelogs huérfanos (sin charID en el nombre): busca en TODAS las identidades y solo
    /// devuelve algo si el candidato es ÚNICO — un segundo candidato, aunque sea del mismo piloto,
    /// aborta. Con multiboxing simultáneo hay 2-3 sesiones a la vez; emparejar por "el más cercano en
    /// el tiempo" acertaría solo el 71,7%, y una atribución falsa es peor que ninguna.
    /// Medido sobre los logs reales: de los 617 huérfanos con contenido, 596 tienen exactamente un
    /// candidato, 20 tienen dos (se descartan) y 1 no tiene Local. Endurecer no cuesta nada.
    pub fn twin_any(&self, session: i64) -> Option<(&str, &PathBuf)> {
        let mut hit: Option<(&str, &PathBuf)> = None;
        for (id, v) in &self.by_ident {
            for (s, p) in v {
                let d = s - session;
                if (-10..=30).contains(&d) {
                    if hit.is_some() {
                        return None;
                    }
                    hit = Some((id.as_str(), p));
                }
            }
        }
        hit
    }
}

/// Línea temporal de sistemas de UNA sesión, ordenada.
pub fn presence(path: &Path) -> Vec<Presence> {
    const MARKS: [&str; 2] = ["cambiado a Local", "changed to Local"];
    // El aviso lo emite el juego, no un jugador. Sin esta comprobación, cualquiera podría escribir
    // "El canal ha cambiado a Local: X" en el chat y falsear tu histórico.
    const SPEAKER: [&str; 2] = ["Sistema EVE >", "EVE System >"];
    let text = match decode(path) {
        Some(t) => t,
        None => return Vec::new(),
    };
    let mut out = Vec::new();
    for l in text.lines() {
        if !SPEAKER.iter().any(|m| l.contains(m)) || !MARKS.iter().any(|m| l.contains(m)) {
            continue;
        }
        // El sistema va tras el último ':' y puede acabar en punto. El cliente añade además un '*' a
        // veces (`PS-94K*` y `PS-94K` son el mismo sistema: 6 de los 9 casos aparecen de las dos
        // formas). Sin quitarlo, el ranking partiría un sistema en dos.
        let sys = match l.rsplit(':').next() {
            Some(s) => s.trim().trim_end_matches('.').trim_end_matches('*').trim(),
            None => continue,
        };
        if sys.is_empty() {
            continue;
        }
        if let Some(secs) = line_secs(l) {
            out.push(Presence { secs, system: sys.to_string() });
        }
    }
    out.sort_by_key(|p| p.secs);
    out
}

/// Sistema en el que estabas en ese instante: la última presencia ≤ `secs`.
/// Si el evento es ANTERIOR a la primera línea (el gamelog arranca 1-2 s antes que el Local), vale la
/// primera: es el sistema en el que hiciste login.
pub fn system_at(pres: &[Presence], secs: i64) -> Option<&str> {
    if pres.is_empty() {
        return None;
    }
    let i = pres.partition_point(|p| p.secs <= secs);
    let idx = if i == 0 { 0 } else { i - 1 };
    Some(pres[idx].system.as_str())
}
