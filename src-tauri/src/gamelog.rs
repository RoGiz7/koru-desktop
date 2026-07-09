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
/// Un golpe de combate (LOG-ONLY, ESI no da nada de esto). done = hecho por ti (`a`) / recibido (`de`);
/// wreck = calidad "Destruye" (wrecking hit, ~crítico de combate).
pub struct CombatEvent {
    pub date: String,
    pub dmg: i64,
    pub done: bool,
    pub wreck: bool,
    pub target: String, // objetivo de tu daño (rata), solo en golpes HECHOS; "" en recibidos
    pub sec: i64,       // segundo del día del golpe → DPS (segundos activos y pico por segundo)
    // Par (ES, EN) del objetivo cuando la línea trae `<localized>`. Alimenta el diccionario que
    // canoniza los nombres de logs viejos escritos en español. ("", "") si la línea no lo trae.
    pub alias_es: String,
    pub alias_en: String,
}

/// Todo lo que un fichero de gamelog aporta en UNA pasada (se lee una sola vez).
#[derive(Default)]
pub struct ScanBatch {
    pub logi: Vec<LogiEvent>,
    pub mining: Vec<MiningEvent>,
    pub bounty: Vec<BountyEvent>,
    pub jumps: Vec<JumpEvent>,
    pub waste: Vec<WasteEvent>,
    pub combat: Vec<CombatEvent>,
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

/// Segundo del día (0..86399) de `[ AAAA.MM.DD HH:MM:SS ]`. Base del DPS: agrupando los golpes por
/// segundo sabemos cuántos segundos hubo combate real y cuánto daño cayó en el peor de ellos.
fn line_secs(line: &str) -> Option<i64> {
    let start = line.find("[ ")? + 2;
    let rest = line.get(start..)?;
    let t = rest.get(11..19)?; // "HH:MM:SS" justo tras "AAAA.MM.DD "
    let b = t.as_bytes();
    if b.get(2) != Some(&b':') || b.get(5) != Some(&b':') {
        return None;
    }
    let h: i64 = t.get(..2)?.parse().ok()?;
    let m: i64 = t.get(3..5)?.parse().ok()?;
    let s: i64 = t.get(6..8)?.parse().ok()?;
    Some(h * 3600 + m * 60 + s)
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

/// Normaliza el nombre de una rata/objetivo: quita espacios y sufijos sueltos (`*`, `.`) que el
/// cliente añade a algunos nombres. Así "Corpus Patriarch*" y "Corpus Patriarch" son la misma rata.
fn clean_rat(s: &str) -> String {
    s.trim()
        .trim_end_matches(|c: char| c == '*' || c == '.' || c.is_whitespace())
        .trim()
        .to_string()
}

/// Del primer `<localized hint="NombreES">NombreEN` que aparezca en `seg`, devuelve (ES, EN).
/// El gamelog escribe el nombre ES en el hint y el EN como texto visible. Con logs de años en los
/// que el cliente estuvo en español (sin tag), esto nos da el diccionario para canonizar al EN.
fn localized_pair(seg: &str) -> Option<(String, String)> {
    const P: &str = "<localized hint=\"";
    let i = seg.find(P)?;
    let after = &seg[i + P.len()..];
    let q = after.find('"')?;
    let es = clean_rat(&after[..q]);
    let rest = &after[q..];
    let gt = rest.find('>')?;
    let vis = &rest[gt + 1..];
    let end = vis.find('<').unwrap_or(vis.len());
    let en = clean_rat(&vis[..end]);
    if es.is_empty() || en.is_empty() || es == en {
        None
    } else {
        Some((es, en))
    }
}

/// Normaliza el nombre de mena: el formato Equinox añade `" con un residuo perdido de X unidades."`
/// al final de la línea de extracción → hay que cortarlo para no fragmentar la misma mena en varias
/// filas. También quita un punto final suelto. Así "Pyroxeres con un residuo…" → "Pyroxeres".
fn clean_ore(s: &str) -> String {
    let mut o = s.trim();
    // El sufijo del residuo (Equinox) va en el idioma del cliente; cortamos ambos.
    for m in [" con un residuo", " with a lost residue"] {
        if let Some(p) = o.find(m) {
            o = o[..p].trim_end();
        }
    }
    o.trim_end_matches('.').trim().to_string()
}

/// Minería: `(mining) ... Has extraído N unidades de <hint="ES">NombreEN`. None si no lo es.
/// El número puede llevar puntos de millar y va separado por espacio normal o NBSP.
fn parse_mining_line(line: &str) -> Option<MiningEvent> {
    if !line.contains("(mining)") {
        return None;
    }
    let date = line_date(line)?;
    let plain = strip_tags(line);
    // Bilingüe: "Has extraído N unidades de X" / "You mined N units of X".
    let (i, mlen) = match plain.find("unidades de ") {
        Some(i) => (i, "unidades de ".len()),
        None => (plain.find("units of ")?, "units of ".len()),
    };
    let ore = clean_ore(&plain[i + mlen..]);
    if ore.is_empty() {
        return None;
    }
    // Número inmediatamente antes del marcador: último run de dígitos/puntos/espacios.
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
    if !line.contains("crítica") && !line.contains("critica") && !line.contains("Critical") {
        return None;
    }
    let date = line_date(line)?;
    let plain = strip_tags(line);
    // Bilingüe: "N unidades adicionales de X" / "N additional units of X".
    let (oi, mlen) = match plain.find("adicionales de ") {
        Some(i) => (i, "adicionales de ".len()),
        None => (plain.find("additional units of ")?, "additional units of ".len()),
    };
    let ore = clean_ore(&plain[oi + mlen..]);
    if ore.is_empty() {
        return None;
    }
    // Número antes de "unidades"/"units".
    let ui = plain.find("unidades").or_else(|| plain.find("units"))?;
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
    if !line.contains("desperdiciad") && !line.contains("wasted") {
        return None;
    }
    let date = line_date(line)?;
    let plain = strip_tags(line);
    let i = plain.find("unidades").or_else(|| plain.find("units"))?;
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

/// Bounty: `(bounty) Se ha añadido N ISK…` / `(bounty) N ISK added to next bounty payout…`.
/// Independiente del idioma: anclamos en "(bounty)" (para no comernos los dígitos de la fecha) y
/// cogemos los dígitos que haya hasta "ISK". OJO: el separador antes de "ISK" es un NBSP.
fn parse_bounty_line(line: &str) -> Option<BountyEvent> {
    let b = line.find("(bounty)")?;
    let date = line_date(line)?;
    let plain = strip_tags(&line[b..]);
    let j = plain.find("ISK")?;
    let digits: String = plain[..j].chars().filter(|c| c.is_ascii_digit()).collect();
    let isk: i64 = digits.parse().ok()?;
    if isk <= 0 {
        return None;
    }
    Some(BountyEvent { date, isk })
}

/// Salto: `(None) Saltando de <hint="A">A a <hint="B">B`. Coge los DOS hint = origen y destino.
fn parse_jump_line(line: &str) -> Option<JumpEvent> {
    let date = line_date(line)?;
    // ES: `(None) Saltando de <hint="A">A a <hint="B">B` → los dos hint son origen y destino.
    if line.contains("Saltando de ") {
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
        return Some(JumpEvent { date, from, to });
    }
    // EN: `(None) Jumping from Azer to Harerget` — texto plano, sin tags.
    let i = line.find("Jumping from ")?;
    let rest = strip_tags(&line[i + "Jumping from ".len()..]);
    let j = rest.find(" to ")?;
    let from = rest[..j].trim().to_string();
    let to = rest[j + 4..].trim().to_string();
    if from.is_empty() || to.is_empty() {
        return None;
    }
    Some(JumpEvent { date, from, to })
}

/// Golpe de combate: `(combat) <b>N</b> ... <font size=10>(a|de)</font> ... - <calidad>`. None si no.
/// done = `a` (hecho por ti) / `de` (recibido). wreck = la calidad final es "Destruye" (wrecking).
fn parse_combat_line(line: &str) -> Option<CombatEvent> {
    // Marcador de dirección, bilingüe. `mark` = el tag exacto (para anclar el alias);
    // `sep` = cómo se ve ese marcador ya sin tags, para recortar el objetivo del texto plano.
    let (done, mark, sep) = if line.contains("size=10>a</font>") {
        (true, "size=10>a</font>", " a ")
    } else if line.contains("size=10>to</font>") {
        (true, "size=10>to</font>", " to ")
    } else if line.contains("size=10>de</font>") {
        (false, "size=10>de</font>", " de ")
    } else if line.contains("size=10>from</font>") {
        (false, "size=10>from</font>", " from ")
    } else {
        return None;
    };
    let dmg = first_bold_number(line)? as i64;
    let date = line_date(line)?;
    let sec = line_secs(line).unwrap_or(-1);
    let plain = strip_tags(line);
    // Wrecking hit (≈ crítico de combate): "Destruye" en ES, "Wrecks" en EN.
    let wreck = plain
        .trim_end()
        .rsplit(" - ")
        .next()
        .map(|q| {
            let q = q.trim();
            q == "Destruye" || q == "Wrecks"
        })
        .unwrap_or(false);
    // Objetivo (solo en HECHOS): entre el marcador de dirección y el primer " - ".
    let target = if done {
        plain
            .find(sep)
            .and_then(|i| {
                let after = &plain[i + sep.len()..];
                after.find(" - ").map(|j| clean_rat(&after[..j]))
            })
            .unwrap_or_default()
    } else {
        String::new()
    };
    // Diccionario ES→EN del objetivo: el primer `<localized>` que hay TRAS el marcador de dirección
    // y ANTES del primer " - " (después de ese guion viene el arma, que no queremos meter aquí).
    let mut alias_es = String::new();
    let mut alias_en = String::new();
    if done && !target.is_empty() {
        if let Some(i) = line.find(mark) {
            let rest = &line[i..];
            let end = rest.find(" - ").unwrap_or(rest.len());
            if let Some((es, en)) = localized_pair(&rest[..end]) {
                alias_es = es;
                alias_en = en;
            }
        }
    }
    Some(CombatEvent { date, dmg, done, wreck, target, sec, alias_es, alias_en })
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
            } else if let Some(ev) = parse_combat_line(&line) {
                batch.combat.push(ev);
            }
        } else if line.contains("(mining)") {
            // Despacho bilingüe. OJO al orden: la línea de crítico EN contiene "units of", que también
            // casa con la de extracción base, así que el crítico debe comprobarse ANTES.
            if line.contains("desperdiciad") || line.contains("wasted") {
                if let Some(w) = parse_waste_line(&line) {
                    batch.waste.push(w);
                }
            } else if line.contains("crítica") || line.contains("critica") || line.contains("Critical") {
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
        } else if line.contains("Saltando de ") || line.contains("Jumping from ") {
            if let Some(ev) = parse_jump_line(&line) {
                batch.jumps.push(ev);
            }
        }
    }
    Ok((len, batch))
}
