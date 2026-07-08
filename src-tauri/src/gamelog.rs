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

/// Fase C — reconstrucción desde el gamelog (datos que ESI no da con años de histórico).
/// Un ciclo de minería: unidades extraídas de una mena (nombre EN, encaja con ores.json → type_id).
pub struct MiningEvent {
    pub date: String,
    pub ore: String,
    pub units: i64,
    pub crit: bool, // true = "¡Extracción crítica!" (bonus Equinox); va a la columna crit, no a units.
}
/// Un pago de recompensa (bounty). ISK en entero.
pub struct BountyEvent {
    pub date: String,
    pub isk: i64,
}
/// Un salto entre sistemas (origen → destino, nombres visibles).
pub struct JumpEvent {
    pub date: String,
    pub from: String,
    pub to: String,
}
/// Unidades de mena DESPERDICIADAS en un ciclo (residuo destruido; ESI no lo expone). Sin mena asociada.
pub struct WasteEvent {
    pub date: String,
    pub units: i64,
}

/// Todo lo que un fichero de gamelog aporta en UNA pasada (se lee una sola vez).
#[derive(Default)]
pub struct ScanBatch {
    pub logi: Vec<LogiEvent>,
    pub mining: Vec<MiningEvent>,
    pub bounty: Vec<BountyEvent>,
    pub jumps: Vec<JumpEvent>,
    pub waste: Vec<WasteEvent>,
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

/// Minería: `(mining) ... Has extraído N unidades de <hint="ES">NombreEN`. None si no lo es.
/// El número puede llevar puntos de millar y va separado por espacio normal o NBSP.
fn parse_mining_line(line: &str) -> Option<MiningEvent> {
    if !line.contains("(mining)") {
        return None;
    }
    let date = line_date(line)?;
    let plain = strip_tags(line);
    let i = plain.find("unidades de ")?;
    let ore = plain[i + "unidades de ".len()..].trim().to_string();
    if ore.is_empty() {
        return None;
    }
    // Número inmediatamente antes de "unidades de": último run de dígitos/puntos/espacios.
    let pre = plain[..i].trim_end();
    let mut run: Vec<char> = Vec::new();
    for c in pre.chars().rev() {
        if c.is_ascii_digit() || c == '.' || c == ' ' || c == '\u{a0}' {
            run.push(c);
        } else {
            break;
        }
    }
    let digits: String = run.iter().rev().filter(|c| c.is_ascii_digit()).collect();
    let units: i64 = digits.parse().ok()?;
    if units <= 0 {
        return None;
    }
    Some(MiningEvent { date, ore, units, crit: false })
}

/// Crítico de minería (Equinox): `(mining) ¡Extracción crítica completada! Has extraído N unidades
/// adicionales de <mena>`. Bonus de ore según skills/setup. LOG-ONLY: ESI lo suma al total pero no lo
/// distingue. base + crítico = total ESI (validado). La mena va tras "adicionales de".
fn parse_crit_line(line: &str) -> Option<MiningEvent> {
    if !line.contains("crítica") && !line.contains("critica") {
        return None;
    }
    let date = line_date(line)?;
    let plain = strip_tags(line);
    let oi = plain.find("adicionales de ")?;
    let ore = plain[oi + "adicionales de ".len()..].trim().to_string();
    if ore.is_empty() {
        return None;
    }
    // Número tras "extraído " (antes de "unidades").
    let ui = plain.find("unidades")?;
    let pre = plain[..ui].trim_end();
    let mut run: Vec<char> = Vec::new();
    for c in pre.chars().rev() {
        if c.is_ascii_digit() || c == '.' || c == ' ' || c == '\u{a0}' {
            run.push(c);
        } else {
            break;
        }
    }
    let digits: String = run.iter().rev().filter(|c| c.is_ascii_digit()).collect();
    let units: i64 = digits.parse().ok()?;
    if units <= 0 {
        return None;
    }
    Some(MiningEvent { date, ore, units, crit: true })
}

/// Desperdicio de minería: `(mining) N unidades adicionales del asteroide desperdiciadas`. Sin mena.
/// Dato LOG-ONLY (ESI no lo da): residuo destruido al minar con cristales agresivos.
fn parse_waste_line(line: &str) -> Option<WasteEvent> {
    if !line.contains("desperdiciad") {
        return None;
    }
    let date = line_date(line)?;
    let plain = strip_tags(line);
    let i = plain.find("unidades")?;
    let pre = plain[..i].trim_end();
    let mut run: Vec<char> = Vec::new();
    for c in pre.chars().rev() {
        if c.is_ascii_digit() || c == '.' || c == ' ' || c == '\u{a0}' {
            run.push(c);
        } else {
            break;
        }
    }
    let digits: String = run.iter().rev().filter(|c| c.is_ascii_digit()).collect();
    let units: i64 = digits.parse().ok()?;
    if units <= 0 {
        return None;
    }
    Some(WasteEvent { date, units })
}

/// Bounty: `(bounty) Se ha añadido <tags>N ISK<tags> ...`. None si no lo es.
/// OJO: el separador antes de "ISK" es un NBSP → buscamos "ISK" y filtramos dígitos.
fn parse_bounty_line(line: &str) -> Option<BountyEvent> {
    if !line.contains("(bounty)") {
        return None;
    }
    let date = line_date(line)?;
    let plain = strip_tags(line);
    // "añadido"/"anadido" → ambos contienen "adido ".
    let a = plain.find("adido ")?;
    let after = &plain[a + "adido ".len()..];
    let j = after.find("ISK")?;
    let digits: String = after[..j].chars().filter(|c| c.is_ascii_digit()).collect();
    let isk: i64 = digits.parse().ok()?;
    if isk <= 0 {
        return None;
    }
    Some(BountyEvent { date, isk })
}

/// Salto: `(None) Saltando de <hint="A">A a <hint="B">B`. Coge los DOS hint = origen y destino.
fn parse_jump_line(line: &str) -> Option<JumpEvent> {
    if !line.contains("Saltando de ") {
        return None;
    }
    let date = line_date(line)?;
    let mut hints = line.match_indices("hint=\"").filter_map(|(i, _)| {
        let start = i + 6;
        let rest = line.get(start..)?;
        let end = rest.find('"')?;
        Some(rest[..end].to_string())
    });
    let from = hints.next()?;
    let to = hints.next()?;
    if from.is_empty() || to.is_empty() {
        return None;
    }
    Some(JumpEvent { date, from, to })
}

/// Lee el fichero desde `from` hasta el final y devuelve (nuevo_offset, lote de eventos).
/// UNA sola pasada emite logi + minería + bounty + saltos (cada línea es de UNA categoría).
/// Incremental: `from` = byte hasta donde se leyó antes (0 = backfill completo). No carga el
/// fichero entero en RAM (BufReader línea a línea).
pub fn scan_file(path: &Path, from: u64) -> std::io::Result<(u64, ScanBatch)> {
    let mut f = File::open(path)?;
    let len = f.metadata()?.len();
    if from >= len {
        return Ok((len, ScanBatch::default())); // sin datos nuevos
    }
    f.seek(SeekFrom::Start(from))?;
    let reader = BufReader::new(f);
    let mut batch = ScanBatch::default();
    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue, // línea con bytes inválidos: la saltamos
        };
        // Dispatch por categoría (mutuamente excluyentes) para no llamar strip_tags de más.
        if line.contains("(combat)") {
            if let Some(ev) = parse_logi_line(&line) {
                batch.logi.push(ev);
            }
        } else if line.contains("(mining)") {
            if line.contains("desperdiciad") {
                if let Some(w) = parse_waste_line(&line) {
                    batch.waste.push(w);
                }
            } else if line.contains("crítica") || line.contains("critica") {
                if let Some(ev) = parse_crit_line(&line) {
                    batch.mining.push(ev); // crit=true → columna crit en commit
                }
            } else if let Some(ev) = parse_mining_line(&line) {
                batch.mining.push(ev);
            }
        } else if line.contains("(bounty)") {
            if let Some(ev) = parse_bounty_line(&line) {
                batch.bounty.push(ev);
            }
        } else if line.contains("Saltando de ") {
            if let Some(ev) = parse_jump_line(&line) {
                batch.jumps.push(ev);
            }
        }
    }
    Ok((len, batch))
}
