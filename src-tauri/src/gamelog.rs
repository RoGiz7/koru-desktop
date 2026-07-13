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
    pub sec: i64, // segundo del día; necesario para atribuir el sistema (Fase D)
    pub ore: String,
    pub units: i64,
    pub crit: bool, // true = "¡Extracción crítica!" (bonus Equinox); va a la columna crit, no a units.
    /// Residuo destruido EN ESTE ciclo, cuando la línea lo trae como sufijo ("… con un residuo
    /// perdido de N unidades"). Así el desperdicio queda atribuido a SU mena. En la otra era el
    /// residuo va en línea aparte y sin mena (ver `WasteEvent`); nunca coexisten, no hay doble conteo.
    pub residue: i64,
}
/// Un pago de recompensa (bounty). ISK en entero.
pub struct BountyEvent {
    pub date: String,
    pub sec: i64,
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
    pub sec: i64,
    pub units: i64,
}

/// Un disparo que NO hizo daño. El gamelog registra los dos sentidos, con verbos distintos:
///   dado     ES `Tu Berserker II no acierta en Gist Cherubim por mucho. - Berserker II`
///            EN `Your Hobgoblin II misses Guristas Saboteur completely - Hobgoblin II`
///   recibido ES `Gist Cherubim falla por mucho.`
///            EN `Corpus Pope misses you completely`
/// El discriminador fiable NO es el verbo (hay cuatro) sino el `" - <arma>"` final: solo lo llevan
/// los fallos DADOS, igual que los golpes. Con esto sale el ratio de acierto, y por arma.
pub struct MissEvent {
    pub date: String,
    pub sec: i64,
    pub done: bool, // true = fallaste tú; false = te fallaron
    /// Dado: tu arma (siempre presente). Recibido: el arma del ATACANTE si la firma — solo los
    /// jugadores lo hacen (`kurosen1 misses you completely - 125mm…`), las ratas no. Con arma en
    /// un recibido, el commit lo trata como fallo PvP.
    pub weapon: String,
    pub other: String, // objetivo si done, atacante si no (rata o jugador)
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
    /// Arma o módulo con el que golpeas. Presente en TODOS los golpes dados; en los recibidos falta
    /// a menudo (la rata no siempre nombra su arma). "" si la línea no lo trae.
    pub weapon: String,
    /// Calidad del golpe, 1..6 de peor a mejor. La escala ES/EN se unificó por DAÑO MEDIO, no por
    /// traducción: `Roza`=Grazes(1), `Alcanza`=Glances Off(2), `Impacta`=Hits(3), `Perfora`=
    /// Penetrates(4), `Destroza`=Smashes(5), `Destruye`=Wrecks(6). 0 = desconocida.
    pub quality: u8,
    // Par (ES, EN) del objetivo cuando la línea trae `<localized>`. Alimenta el diccionario que
    // canoniza los nombres de logs viejos escritos en español. ("", "") si la línea no lo trae.
    pub alias_es: String,
    pub alias_en: String,
    /// PvP (#45): clase del otro lado del golpe. 0 = NPC (todo lo de siempre) · 1 = nave de
    /// jugador · 2 = dron/fighter de jugador (nombre == tipo) · 3 = estructura de jugador (el
    /// nombre lleva "SISTEMA - " delante; Ansiblex/citadelas/Athanor…). Se detecta por la firma
    /// `Nombre[TICKER](Nave)`, que las ratas jamás llevan. En ambos sentidos (dado Y recibido).
    pub kind: u8,
    /// Piloto (o "SISTEMA - nombre" si estructura). "" si kind == 0.
    pub pilot: String,
    /// Ticker de la corp del otro. "" si kind == 0.
    pub ticker: String,
    /// Nave/tipo del otro (canónico EN vía hint). "" si kind == 0.
    pub pship: String,
}

/// Rescate de restos (categoría `notify`). `ok=false` = el ciclo del salvager falló.
/// OJO: el texto de FALLO solo se ha visto en inglés ("Your salvaging attempt failed this time.");
/// no hay muestra del equivalente español, así que en logs ES la tasa de éxito saldrá al 100%.
pub struct SalvageEvent {
    pub date: String,
    pub sec: i64,
    pub ok: bool,
}

/// Pulso de un módulo de mando (`Tu Mining Foreman Burst II ha aplicado bonificaciones a N miembros`).
pub struct BoostEvent {
    pub date: String,
    pub sec: i64,
    pub module: String,
    pub members: i64,
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
    pub misses: Vec<MissEvent>,
    pub salvage: Vec<SalvageEvent>,
    pub boosts: Vec<BoostEvent>,
}

/// Calidad del golpe → 1..6 (peor a mejor), unificando ES y EN. El emparejamiento NO viene de la
/// traducción sino del daño medio relativo al arma, medido sobre los logs reales:
/// Grazes 0,53× ↔ Roza 0,56× · Glances Off 0,69× ↔ Alcanza 0,68× · Hits 0,93× ↔ Impacta 0,90×
/// Penetrates 1,17× ↔ Perfora 1,14× · Smashes 1,33× ↔ Destroza 1,39× · Wrecks 2,81× ↔ Destruye 2,97×
/// (A ojo se habría emparejado mal: `Roza` es Grazes, no Glances Off.)
fn quality_rank(q: &str) -> u8 {
    match q.trim() {
        "Roza" | "Grazes" => 1,
        "Alcanza" | "Glances Off" => 2,
        "Impacta" | "Hits" => 3,
        "Perfora" | "Penetrates" => 4,
        "Destroza" | "Smashes" => 5,
        "Destruye" | "Wrecks" => 6,
        _ => 0,
    }
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
    // Tipo de rep, bilingüe. Incluye el CUARTO tipo (capacitor), que antes no seguíamos.
    // OJO: no basta con buscar "remote" — `N to Remote Cloaking Array - Templar I - Hits` es un
    // golpe normal contra una estructura llamada así. Por eso exigimos la frase completa.
    const KINDS: [(&str, &str); 9] = [
        ("escudo remoto", "shield"),
        ("blindaje remoto", "armor"),
        ("casco remoto", "hull"),
        ("capacitor remoto", "cap"),
        ("condensador remoto", "cap"),
        ("remote shield boosted", "shield"),
        ("remote armor repaired", "armor"),
        ("remote hull repaired", "hull"),
        ("remote capacitor transmitted", "cap"),
    ];
    let kind = KINDS.iter().find(|(m, _)| line.contains(m)).map(|(_, k)| *k)?;
    // Dirección. En español hay TRES preposiciones ("por", "de" y "a"); antes solo se leían dos, y
    // las líneas con "potenciado de" se descartaban en silencio.
    const DIRS: [(&str, bool); 15] = [
        (" potenciado a ", true),
        (" reparado a ", true),
        (" transmitido a ", true),
        (" potenciado por ", false),
        (" reparado por ", false),
        (" transmitido por ", false),
        (" potenciado de ", false),
        (" reparado de ", false),
        (" transmitido de ", false),
        (" boosted to ", true),
        (" repaired to ", true),
        (" transmitted to ", true),
        (" boosted by ", false),
        (" repaired by ", false),
        (" transmitted by ", false),
    ];
    // Se busca sobre el texto SIN tags: el marcador va dentro de `<font size=10>…</font>`.
    let plain_all = strip_tags(line);
    let (mark, given) = *DIRS.iter().find(|(m, _)| plain_all.contains(m))?;
    let direction = if given { "given" } else { "received" };
    let hp = first_bold_number(line)?;
    let date = line_date(line)?;
    // Piloto + nave + módulo: lo que va tras el marcador. Se toma de la línea CON tags porque
    // `is_char` distingue jugador de dron por la presencia de `<localized>`. El marcador puede tener
    // un `</font>` justo detrás, así que buscamos la frase sin el espacio final.
    let needle = mark.trim_end();
    let after = line.find(needle).map(|i| &line[i + needle.len()..]).unwrap_or("");
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

/// Como `strip_tags`, pero cada `<localized hint="X">Y*` se sustituye por X, DESCARTANDO el texto
/// visible hasta el siguiente `<`.
///
/// ⚠️ NO USAR en rutas de parseo: dos males confirmados en vivo (2026-07-10, PvP #45):
/// 1. El visible arrastra puntuación del FORMATO que no es parte del nombre — en
///    `(<localized hint="Scimitar">Scimitar)` el salto se come el `)` y rompe la firma
///    `Nombre[TICK](Nave)`: todos los golpes PvP de 2026 acabaron clasificados como ratas.
/// 2. El sentido del hint NO es estable entre eras: en logs viejos hint=EN/visible=ES, en los de
///    2026 hint=ES/visible=EN. "Preferir el hint" no canoniza nada: cambia el idioma según la era.
/// El texto VISIBLE plano (strip_tags) conserva la puntuación del formato y es lo único
/// estructuralmente fiable; la canonización de idioma va aparte (diccionario/SDE), como las ratas.
#[allow(dead_code)]
fn strip_tags_hint(s: &str) -> String {
    const P: &str = "<localized hint=\"";
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find(P) {
        out.push_str(&strip_tags(&rest[..i]));
        let after = &rest[i + P.len()..];
        let Some(q) = after.find('"') else {
            rest = after;
            break;
        };
        out.push_str(&after[..q]);
        // Saltar el cierre del tag y el texto VISIBLE duplicado (hasta el siguiente '<' o el final).
        let tail = &after[q..];
        match tail.find('>') {
            Some(gt) => {
                let vis = &tail[gt + 1..];
                rest = &vis[vis.find('<').unwrap_or(vis.len())..];
            }
            None => {
                rest = "";
                break;
            }
        }
    }
    out.push_str(&strip_tags(rest));
    out
}

/// Entidad de JUGADOR en un objetivo de combate: `Nombre[TICKER](Nave)`. Las ratas jamás llevan
/// esta firma; las estructuras/deployables de jugador sí (con el ticker de la corp dueña).
/// Validado en Python sobre 784k golpes reales: 14 sin parsear (0,002%).
/// Devuelve (nombre, ticker, nave/tipo). None = no es un jugador (camino NPC de siempre).
fn parse_entity(s: &str) -> Option<(String, String, String)> {
    if !s.ends_with(')') {
        return None;
    }
    let open = s.rfind("](")?;
    // clean_rat en nombre y nave: el visible localizado arrastra un `*` suelto
    // (`(Flycatcher*)`) que si no partiría la misma nave en dos filas.
    let ship = clean_rat(&s[open + 2..s.len() - 1]);
    let head = &s[..open + 1]; // "…[TICKER]"
    let ti = head.rfind('[')?;
    let ticker = head[ti + 1..head.len() - 1].trim();
    let name = clean_rat(&head[..ti]);
    // Tickers EVE: 1-5 caracteres. Más largo = otra cosa (p. ej. un NPC con corchetes raros).
    if name.is_empty() || ticker.is_empty() || ticker.chars().count() > 5 || ship.is_empty() {
        return None;
    }
    Some((name, ticker.to_string(), ship))
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
/// Devuelve (nombre limpio, residuo). El sufijo Equinox va en el idioma del cliente y trae, además,
/// cuántas unidades se destruyeron en ESE ciclo — o sea, el desperdicio ATRIBUIDO A SU MENA.
fn clean_ore(s: &str) -> (String, i64) {
    let mut o = s.trim();
    let mut residue = 0i64;
    for m in [" con un residuo", " with a lost residue"] {
        if let Some(p) = o.find(m) {
            // "…de N unidades." / "…of N units." → los dígitos del sufijo.
            let tail = &o[p..];
            let digits: String = tail.chars().filter(|c| c.is_ascii_digit()).collect();
            residue = digits.parse().unwrap_or(0);
            o = o[..p].trim_end();
        }
    }
    // El cliente añade a veces un '*' al nombre visible (`<localized hint="Veldspar">Veldspar*`). Es el
    // mismo asteroide: sin quitarlo, `Veldspar*` sale como una mena aparte, no resuelve a ningún typeID
    // y por tanto no se valora. `clean_rat` ya lo quitaba; aquí faltaba.
    (o.trim_end_matches(|c: char| c == '.' || c == '*').trim().to_string(), residue)
}

/// Minería: `(mining) ... Has extraído N unidades de <hint="ES">NombreEN`. None si no lo es.
/// El número puede llevar puntos de millar y va separado por espacio normal o NBSP.
fn parse_mining_line(line: &str) -> Option<MiningEvent> {
    if !line.contains("(mining)") {
        return None;
    }
    let date = line_date(line)?;
    let sec = line_secs(line).unwrap_or(-1);
    let plain = strip_tags(line);
    // Bilingüe: "Has extraído N unidades de X" / "You mined N units of X".
    let (i, mlen) = match plain.find("unidades de ") {
        Some(i) => (i, "unidades de ".len()),
        None => (plain.find("units of ")?, "units of ".len()),
    };
    let (ore, residue) = clean_ore(&plain[i + mlen..]);
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
    Some(MiningEvent { date, sec, ore, units, crit: false, residue })
}

/// Crítico de minería (Equinox): `(mining) ¡Extracción crítica completada! Has extraído N unidades
/// adicionales de <mena>`. Bonus de ore según skills/setup. LOG-ONLY: ESI lo suma al total pero no lo
/// distingue. base + crítico = total ESI (validado). La mena va tras "adicionales de".
fn parse_crit_line(line: &str) -> Option<MiningEvent> {
    if !line.contains("crítica") && !line.contains("critica") && !line.contains("Critical") {
        return None;
    }
    let date = line_date(line)?;
    let sec = line_secs(line).unwrap_or(-1);
    let plain = strip_tags(line);
    // Bilingüe: "N unidades adicionales de X" / "N additional units of X".
    let (oi, mlen) = match plain.find("adicionales de ") {
        Some(i) => (i, "adicionales de ".len()),
        None => (plain.find("additional units of ")?, "additional units of ".len()),
    };
    let (ore, _) = clean_ore(&plain[oi + mlen..]);
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
    Some(MiningEvent { date, sec, ore, units, crit: true, residue: 0 })
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
    Some(WasteEvent { date, sec: line_secs(line).unwrap_or(-1), units })
}

/// Bounty: `(bounty) Se ha añadido N ISK…` / `(bounty) N ISK added to next bounty payout…`.
/// Independiente del idioma: anclamos en "(bounty)" (para no comernos los dígitos de la fecha) y
/// cogemos los dígitos que haya hasta "ISK". OJO: el separador antes de "ISK" es un NBSP.
fn parse_bounty_line(line: &str) -> Option<BountyEvent> {
    let b = line.find("(bounty)")?;
    let date = line_date(line)?;
    let plain = strip_tags(&line[b..]);
    let j = plain.find("ISK")?;
    let mut num = &plain[..j];
    // Los logs viejos escriben DECIMALES: "1.104.375,00 ISK". El punto es separador de millares y la
    // coma decimal. Si filtrásemos todos los dígitos, ese importe se multiplicaría por 100 (bug real:
    // 2020-08 daba 286 B de bounty). Cortamos en la coma decimal, reconocida por sus 2 dígitos finales.
    if let Some(c) = num.rfind(',') {
        let dec = num[c + 1..].trim();
        if dec.len() == 2 && dec.bytes().all(|b| b.is_ascii_digit()) {
            num = &num[..c];
        }
    }
    let digits: String = num.chars().filter(|c| c.is_ascii_digit()).collect();
    let isk: i64 = digits.parse().ok()?;
    if isk <= 0 {
        return None;
    }
    Some(BountyEvent { date, sec: line_secs(line).unwrap_or(-1), isk })
}

/// Rescate, de la categoría `notify`. Éxito en ES y EN; el fallo, solo visto en EN.
fn parse_salvage_line(line: &str) -> Option<SalvageEvent> {
    let plain = strip_tags(line);
    let ok = plain.contains("recuperado satisfactoriamente los restos")
        || plain.contains("successfully salvage")
        || plain.contains("salvager successfully completes");
    let fail = plain.contains("salvaging attempt failed");
    if !ok && !fail {
        return None;
    }
    Some(SalvageEvent { date: line_date(line)?, sec: line_secs(line).unwrap_or(-1), ok })
}

/// Pulso de módulo de mando: `Tu <módulo> ha aplicado bonificaciones a N miembro(s) de la flota.`
/// / `Your <módulo> has applied bonuses to N fleet member(s).`
/// FIX (lote PvP, 2ª iteración): texto VISIBLE plano + quitar el `*` suelto del localized. La fila
/// fantasma ("Estallido de capataz minero II*") la creaba sobre todo el asterisco; preferir el
/// hint resultó peor remedio (su idioma cambia por era — en 2026 el hint es ES). Entre eras el
/// módulo puede salir ES o EN: el catálogo de medallas ya acepta ambos.
fn parse_boost_line(line: &str) -> Option<BoostEvent> {
    let plain = strip_tags(line);
    let (mark, es) = if let Some(i) = plain.find(" ha aplicado bonificaciones a ") {
        (i, true)
    } else {
        (plain.find(" has applied bonuses to ")?, false)
    };
    // Módulo: entre "Tu "/"Your " y el marcador.
    let head = &plain[..mark];
    let module = head
        .rfind(if es { "Tu " } else { "Your " })
        .map(|i| clean_rat(&head[i + if es { 3 } else { 5 }..]))
        .unwrap_or_default();
    // Nº de miembros: primer número tras el marcador.
    let tail = &plain[mark..];
    let digits: String = tail
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(|c| c.is_ascii_digit())
        .collect();
    let members: i64 = digits.parse().unwrap_or(0);
    if module.is_empty() || members <= 0 {
        return None;
    }
    Some(BoostEvent { date: line_date(line)?, sec: line_secs(line).unwrap_or(-1), module, members })
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

/// Disparo sin daño. Ver `MissEvent` para los cuatro verbos. Validado sobre los logs reales:
/// 88.701 fallos, 0 sin parsear.
///
/// DISCRIMINADOR CORREGIDO en el lote PvP (#45): la cola `" - <arma>"` NO distingue dado de
/// recibido — el fallo recibido de un JUGADOR también la lleva (`kurosen1 misses you completely
/// - 125mm Gatling AutoCannon II`), y el criterio viejo lo contaba como fallo TUYO con su arma.
/// El discriminador fiable es el arranque: los dados empiezan por `Tu `/`Your ` (validado: las
/// ratas nunca firman el arma al fallarte; los jugadores sí).
fn parse_miss_line(line: &str) -> Option<MissEvent> {
    let date = line_date(line)?;
    let sec = line_secs(line).unwrap_or(-1);
    let i = line.find("(combat)")? + "(combat)".len();
    // strip_tags PLANO (el de los 88.701 fallos validados): el hint se comía el texto visible
    // que sigue al nombre localizado — verbos incluidos — y su idioma baila por era.
    let plain = strip_tags(&line[i..]);
    let p = plain.trim();
    if p.starts_with("Tu ") || p.starts_with("Your ") {
        // DADO: `Tu <arma> no acierta en <objetivo> por mucho. - <arma>` /
        //       `Your <arma> misses <objetivo> completely - <arma>`.
        let (head, weapon) = p.rsplit_once(" - ")?;
        let weapon = clean_rat(weapon);
        for (a, b) in [(" no acierta en ", " por mucho"), (" misses ", " completely")] {
            if let Some(j) = head.find(a) {
                let rest = &head[j + a.len()..];
                let other = clean_rat(rest.split(b).next().unwrap_or(rest));
                if !other.is_empty() {
                    return Some(MissEvent { date, sec, done: true, weapon, other });
                }
            }
        }
        return None;
    }
    // RECIBIDO: "<rata> falla por mucho." / "<atacante> misses you completely[ - <arma>]".
    // Si tras el verbo viene " - <arma>", el atacante es un JUGADOR (las ratas no firman el arma):
    // esa arma se conserva y el commit lo usa como señal PvP.
    for b in [" falla por mucho", " misses you completely"] {
        if let Some(j) = p.find(b) {
            let other = clean_rat(&p[..j]);
            let weapon = p[j + b.len()..]
                .rsplit_once(" - ")
                .map(|(_, w)| clean_rat(w))
                .unwrap_or_default();
            if !other.is_empty() {
                return Some(MissEvent { date, sec, done: false, weapon, other });
            }
        }
    }
    None
}

/// Golpe de combate: `(combat) <b>N</b> ... <font size=10>(a|de)</font> ... - <calidad>`. None si no.
/// done = `a` (hecho por ti) / `de` (recibido). wreck = la calidad final es "Destruye" (wrecking).
fn parse_combat_line(line: &str) -> Option<CombatEvent> {
    // Marcador de dirección, bilingüe. `mark` = el tag exacto: ancla tanto el objetivo (el
    // <b>…</b> que le sigue) como el alias <localized>.
    let (done, mark) = if line.contains("size=10>a</font>") {
        (true, "size=10>a</font>")
    } else if line.contains("size=10>to</font>") {
        (true, "size=10>to</font>")
    } else if line.contains("size=10>de</font>") {
        (false, "size=10>de</font>")
    } else if line.contains("size=10>from</font>") {
        (false, "size=10>from</font>")
    } else {
        return None;
    };
    let dmg = first_bold_number(line)? as i64;
    let date = line_date(line)?;
    let sec = line_secs(line).unwrap_or(-1);
    let plain = strip_tags(line);
    // Segmentos de la cola: "… - <arma> - <calidad>". El arma va SIEMPRE en los golpes dados; en los
    // recibidos falta a menudo (la rata no siempre nombra su arma), y entonces solo hay calidad.
    let tail = plain.trim_end();
    let segs: Vec<&str> = tail.split(" - ").collect();
    let quality = segs.last().map(|q| quality_rank(q)).unwrap_or(0);
    let weapon = if segs.len() >= 3 && quality > 0 {
        clean_rat(segs[segs.len() - 2])
    } else {
        String::new()
    };
    // Wrecking hit (≈ crítico de combate): el escalón 6 de la calidad ("Destruye"/"Wrecks").
    let wreck = quality == 6;
    // Objetivo/origen: el contenido del `<b>…</b>` que sigue al marcador, en la línea CRUDA.
    // Anclarse al bold es lo único fiable — los nombres de estructura de jugador llevan " - "
    // dentro (`M2-XFE - Grandma shark…[THXFC](Astrahus)`) y el antiguo corte por " - " en texto
    // plano los partía: años registrando el SISTEMA como si fuera una rata. Validado en Python:
    // 784k golpes, 14 sin extraer (0,002%).
    let mut kind = 0u8;
    let mut pilot = String::new();
    let mut ticker = String::new();
    let mut pship = String::new();
    let mut target = String::new();
    if let Some(mi) = line.find(mark) {
        let rest = &line[mi + mark.len()..];
        if let Some(bi) = rest.find("<b>") {
            let inner_start = bi + 3;
            if let Some(bj) = rest[inner_start..].find("</b>") {
                let inner = &rest[inner_start..inner_start + bj];
                // Texto VISIBLE plano: conserva la puntuación del formato (el `)` del cierre de
                // la nave). El hint NO sirve aquí — se comía ese `)` y su idioma cambia por era
                // (ver strip_tags_hint). El idioma del nombre lo canoniza el diccionario, como
                // siempre; para la FIRMA de jugador la estructura es lo que importa.
                let norm = clean_rat(&strip_tags(inner));
                if let Some((n, t, s)) = parse_entity(&norm) {
                    // JUGADOR: nave, dron (nombre == tipo) o estructura ("SISTEMA - nombre").
                    kind = if n.contains(" - ") {
                        3
                    } else if n == s {
                        2
                    } else {
                        1
                    };
                    pilot = n;
                    ticker = t;
                    pship = s;
                    // target queda vacío A PROPÓSITO: los jugadores no van a la tabla de ratas.
                } else if done {
                    target = norm; // rata de siempre (solo dados, como antes)
                }
            }
        }
    }
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
    Some(CombatEvent {
        date,
        dmg,
        done,
        wreck,
        target,
        sec,
        weapon,
        quality,
        alias_es,
        alias_en,
        kind,
        pilot,
        ticker,
        pship,
    })
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
            // Orden: logi → golpe (lleva <b>) → fallo (no lo lleva). Un fallo nunca tiene <b>, así
            // que `parse_combat_line` lo rechaza solo y no hay riesgo de contarlo dos veces.
            if let Some(ev) = parse_logi_line(&line) {
                batch.logi.push(ev);
            } else if let Some(ev) = parse_combat_line(&line) {
                batch.combat.push(ev);
            } else if let Some(ev) = parse_miss_line(&line) {
                batch.misses.push(ev);
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
        } else if line.contains("(notify)") {
            if let Some(ev) = parse_salvage_line(&line) {
                batch.salvage.push(ev);
            } else if let Some(ev) = parse_boost_line(&line) {
                batch.boosts.push(ev);
            }
        } else if line.contains("Saltando de ") || line.contains("Jumping from ") {
            if let Some(ev) = parse_jump_line(&line) {
                batch.jumps.push(ev);
            }
        }
    }
    Ok((len, batch))
}
