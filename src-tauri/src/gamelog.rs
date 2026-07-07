//! Parser incremental de los Gamelogs de EVE (log de combate local, UTF-8).
//! Cero dependencias externas (sin `regex`): matching por métodos de string.
//! Formato de línea: `[ AAAA.MM.DD HH:MM:SS ] (combat) <tags html>texto ES`.
//! Ver documentacion/research/GAMELOG_RESEARCH.md para los patrones validados.

use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::Path;

/// Un evento de reparación remota (logi) parseado de una línea.
pub struct LogiEvent {
    pub date: String,      // "AAAA-MM-DD"
    pub kind: String,      // shield | armor | hull
    pub direction: String, // given | received
    pub hp: f64,
    pub pilot: String,     // nombre: piloto (formato [Nave] Piloto) o nombre-de-nave ("Nave = X")
    pub ship: String,      // tipo de nave; "" para drones/estructuras
    pub module: String,    // módulo con el que repara (tras " - ")
    pub is_char: bool,     // true = es un PERSONAJE real (formato con corchetes); false = nave/drone
}

/// Quita los tags HTML (<...>) de un fragmento del gamelog.
fn strip_tags(s: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}

/// De "…[Nave] Piloto - Módulo" (con tags) saca el nombre del piloto (o el nombre propio de la nave).
fn parse_pilot(after: &str) -> String {
    let seg = after.split(" - ").next().unwrap_or(after);
    let mut p = strip_tags(seg).trim().to_string();
    // Tras "[Nave] " nos quedamos con lo de después (rfind por si hay brackets anidados).
    if let Some(i) = p.rfind("] ") {
        p = p[i + 2..].trim().to_string();
    }
    // Naves con nombre propio se muestran como "Nave = Nombre" → tomamos el nombre.
    if let Some(i) = p.rfind("= ") {
        p = p[i + 2..].trim().to_string();
    }
    // Limpiar símbolos/espacios sueltos en los bordes (evita nombres basura tipo "=").
    p.trim_matches(|c: char| c == '=' || c.is_whitespace()).to_string()
}

/// Tipo de nave (texto EN visible), de "[Nave] Piloto" o "Nave = NombrePropio". "" para
/// drones/estructuras (sin nave enlazada). Va SIEMPRE antes del separador ("]" o "=").
fn parse_ship(after: &str) -> String {
    let seg = after.split(" - ").next().unwrap_or(after);
    let plain = strip_tags(seg);
    let plain = plain.trim();
    let before = if let Some(i) = plain.find("] ") {
        &plain[..i]
    } else if let Some(i) = plain.find("= ") {
        &plain[..i]
    } else {
        return String::new();
    };
    before
        .trim_matches(|c: char| c == '[' || c == ']' || c == '=' || c.is_whitespace())
        .to_string()
}

/// charID del nombre del gamelog `AAAAMMDD_HHMMSS_<charID>.txt`. None si no encaja.
pub fn char_id_from_name(fname: &str) -> Option<i64> {
    let stem = fname.strip_suffix(".txt").unwrap_or(fname);
    stem.rsplit('_').next()?.parse::<i64>().ok()
}

/// Extrae la fecha "AAAA-MM-DD" de la marca `[ AAAA.MM.DD HH:MM:SS ]`.
fn line_date(line: &str) -> Option<String> {
    let start = line.find("[ ")? + 2;
    let rest = line.get(start..)?;
    let d = rest.get(..10)?; // "AAAA.MM.DD" (siempre ASCII)
    if d.as_bytes().get(4) != Some(&b'.') {
        return None;
    }
    Some(d.replace('.', "-"))
}

/// Primer número dentro de `<b>...</b>` (la cifra de HP/daño).
fn first_bold_number(line: &str) -> Option<f64> {
    let i = line.find("<b>")? + 3;
    let j = line.get(i..)?.find("</b>")? + i;
    let inner = line.get(i..j)?;
    let digits: String = inner.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return None;
    }
    digits.parse::<f64>().ok()
}

/// Parsea una línea de reparación remota. None si no lo es.
/// Ej: `... <b>464</b> ... de escudo remoto potenciado por [Scimitar] Viss Guffin ...`
pub fn parse_logi_line(line: &str) -> Option<LogiEvent> {
    if !line.contains("(combat)") {
        return None;
    }
    // Tipo de rep.
    let kind = if line.contains("escudo remoto") {
        "shield"
    } else if line.contains("blindaje remoto") {
        "armor"
    } else if line.contains("casco remoto") {
        "hull"
    } else {
        return None;
    };
    // Dirección: "... potenciado/reparado por <fuente>" (recibido) | "... a <objetivo>" (dado).
    let direction = if line.contains("potenciado por ") || line.contains("reparado por ") {
        "received"
    } else if line.contains("potenciado a ") || line.contains("reparado a ") {
        "given"
    } else {
        return None;
    };
    let hp = first_bold_number(line)?;
    let date = line_date(line)?;
    // Piloto + nave + módulo: lo que va tras "potenciado/reparado por|a ".
    let after = ["potenciado por ", "reparado por ", "potenciado a ", "reparado a "]
        .iter()
        .find_map(|p| line.find(p).map(|i| &line[i + p.len()..]))
        .unwrap_or("");
    // is_char: formato con corchetes "[Nave] Piloto" = personaje real. Pero drones, NPC y estructuras
    // TAMBIÉN usan corchetes ("[Nave] Nave"), así que el corchete no basta. La diferencia real: el
    // nombre del JUGADOR va en texto plano tras "]", mientras que el de un dron/NPC/estructura va
    // envuelto en <localized hint=...> (el juego lo localiza; los nombres de jugador nunca lo están).
    let pilot_seg = after.split(" - ").next().unwrap_or(after);
    let is_char = match pilot_seg.find(']') {
        Some(i) => !pilot_seg[i + 1..].contains("<localized"),
        None => false,
    };
    // Módulo: lo que va tras " - ".
    let module = after
        .splitn(2, " - ")
        .nth(1)
        .map(|m| strip_tags(m).trim().to_string())
        .unwrap_or_default();
    Some(LogiEvent {
        date,
        kind: kind.to_string(),
        direction: direction.to_string(),
        hp,
        pilot: parse_pilot(after),
        ship: parse_ship(after),
        module,
        is_char,
    })
}

/// Lee el fichero desde `from` hasta el final y devuelve (nuevo_offset, eventos logi).
/// Incremental: `from` = byte hasta donde se leyó antes (0 = backfill completo). No carga el
/// fichero entero en RAM (BufReader línea a línea).
pub fn scan_file(path: &Path, from: u64) -> std::io::Result<(u64, Vec<LogiEvent>)> {
    let mut f = File::open(path)?;
    let len = f.metadata()?.len();
    if from >= len {
        return Ok((len, Vec::new())); // sin datos nuevos
    }
    f.seek(SeekFrom::Start(from))?;
    let reader = BufReader::new(f);
    let mut out = Vec::new();
    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue, // línea con bytes inválidos: la saltamos
        };
        if let Some(ev) = parse_logi_line(&line) {
            out.push(ev);
        }
    }
    Ok((len, out))
}
