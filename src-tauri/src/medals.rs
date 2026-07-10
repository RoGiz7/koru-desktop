//! Medallas de corp PINTADAS: extracción en runtime de las texturas desde la SharedCache
//! del cliente de EVE del propio usuario.
//!
//! Por qué así (decisión EULA): las piezas (cintas/medallones) NO tienen typeID, así que ni el
//! image server ni el Image Export Collection las sirven. Viven en la caché del juego
//! (`SharedCache/tq/resfileindex.txt` → `ResFiles/`). NO se redistribuyen con Koru: se extraen
//! de la instalación del usuario a app-data la primera vez. Sin SharedCache → el frontend cae
//! al marco genérico de siempre.
//!
//! Formato verificado (spike 2026-07-10, documentacion/medals/): las hojas de `medals/` y
//! `ribbons/` son DDS SIN comprimir, 32bpp BGRA (máscaras R=0xff0000 G=0xff00 B=0xff
//! A=0xff000000), 256×256, cuadrícula 2×2 de celdas de 128 (celdas 1-4 por filas). El decode
//! manual se validó píxel a píxel contra Pillow. La composición (tinte multiplicativo, capa 0
//! encima, bbox, apilado) la hace el frontend en canvas; aquí solo servimos las hojas en PNG.

use std::io::Write as _;
use std::path::{Path, PathBuf};

use base64::Engine as _;
use tauri::Manager;

use crate::error::{AppError, AppResult};

/// Subcarpeta de app-data donde dejamos las hojas ya convertidas a PNG.
const OUT_SUBDIR: &str = "medals";

/// Solo estas ramas del árbol res:/ hacen falta para componer condecoraciones
/// (part 1 = cinta → ribbons/, part 2 = medallón → medals/). Las insignias de rango
/// (`ranks/`) no aparecen en los `graphics` de ESI.
const RES_PREFIXES: [&str; 2] = [
    "res:/ui/texture/medals/medals/",
    "res:/ui/texture/medals/ribbons/",
];

// ---------------------------------------------------------------------------
// Localizar la SharedCache
// ---------------------------------------------------------------------------

/// ¿Es `dir` una SharedCache válida? (contiene `tq/resfileindex.txt`).
fn is_shared_cache(dir: &Path) -> bool {
    dir.join("tq").join("resfileindex.txt").is_file()
}

/// Autodetección de la SharedCache probando las rutas habituales de Windows
/// (instalación por defecto del launcher, variantes antiguas y Steam). Cada uno instala
/// donde quiere, así que esto es best-effort: el picker manual de Ajustes es la garantía.
#[tauri::command]
pub fn default_sharedcache_dir() -> String {
    let mut candidates: Vec<PathBuf> = vec![
        PathBuf::from("C:\\EVE"),
        PathBuf::from("C:\\EVE\\SharedCache"),
        PathBuf::from("C:\\CCP\\EVE\\SharedCache"),
        PathBuf::from("C:\\ProgramData\\CCP\\EVE\\SharedCache"),
    ];
    for var in ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"] {
        if let Ok(base) = std::env::var(var) {
            candidates.push(PathBuf::from(&base).join("CCP").join("EVE").join("SharedCache"));
        }
    }
    // Steam (ruta por defecto; si está en otra biblioteca, queda el picker).
    if let Ok(pf86) = std::env::var("PROGRAMFILES(X86)") {
        candidates.push(
            PathBuf::from(pf86)
                .join("Steam")
                .join("steamapps")
                .join("common")
                .join("Eve Online")
                .join("SharedCache"),
        );
    }
    for c in candidates {
        if is_shared_cache(&c) {
            return c.to_string_lossy().into_owned();
        }
    }
    String::new()
}

// ---------------------------------------------------------------------------
// DDS sin comprimir → RGBA
// ---------------------------------------------------------------------------

/// Decodifica un DDS sin comprimir 32bpp BGRA (el único formato de las hojas de medallas).
/// Devuelve (ancho, alto, RGBA). Cualquier otro formato → Err (se cuenta como "saltado").
fn decode_dds_bgra32(data: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    if data.len() < 128 || &data[0..4] != b"DDS " {
        return Err("no es un DDS".into());
    }
    let rd32 = |off: usize| u32::from_le_bytes([data[off], data[off + 1], data[off + 2], data[off + 3]]);
    let height = rd32(12);
    let width = rd32(16);
    let pf_flags = rd32(80); // DDS_PIXELFORMAT.dwFlags
    let bits = rd32(88);
    let (rm, gm, bm, am) = (rd32(92), rd32(96), rd32(100), rd32(104));
    if pf_flags & 0x4 != 0 {
        return Err("DDS comprimido (fourcc), no soportado".into());
    }
    if bits != 32 || rm != 0x00ff_0000 || gm != 0x0000_ff00 || bm != 0x0000_00ff || am != 0xff00_0000 {
        return Err(format!("formato inesperado: {bits}bpp masks {rm:x}/{gm:x}/{bm:x}/{am:x}"));
    }
    let n = (width as usize) * (height as usize);
    let px = &data[128..];
    if px.len() < n * 4 {
        return Err("DDS truncado".into());
    }
    let mut rgba = vec![0u8; n * 4];
    for i in 0..n {
        let s = i * 4;
        rgba[s] = px[s + 2]; // R ← byte 2 (BGRA en little-endian)
        rgba[s + 1] = px[s + 1];
        rgba[s + 2] = px[s];
        rgba[s + 3] = px[s + 3];
    }
    Ok((width, height, rgba))
}

/// Codifica RGBA como PNG (RGBA8, sin paleta: las hojas son pequeñas, 256×256).
fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, width, height);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(rgba).map_err(|e| e.to_string())?;
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Extracción
// ---------------------------------------------------------------------------

/// Resultado de la extracción, para pintarlo en Ajustes.
#[derive(serde::Serialize)]
pub struct MedalExtractResult {
    /// Hojas convertidas a PNG (nuevas o reescritas).
    pub sheets: usize,
    /// Entradas saltadas (formato raro o blob ausente).
    pub skipped: usize,
}

/// Carpeta de salida `app-data/medals`, creada si no existe.
fn out_dir(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(format!("app_data_dir: {e}")))?
        .join(OUT_SUBDIR);
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Other(format!("crear {dir:?}: {e}")))?;
    Ok(dir)
}

/// Extrae las hojas de medallas de la SharedCache a `app-data/medals/*.png`.
/// Idempotente: reescribe siempre (son ~30 ficheros pequeños; así un parche del juego
/// que cambie texturas se recoge con solo repetir la extracción).
#[tauri::command]
pub async fn extract_medal_textures(
    app: tauri::AppHandle,
    shared_cache: String,
) -> AppResult<MedalExtractResult> {
    let shared = PathBuf::from(shared_cache.trim());
    if !is_shared_cache(&shared) {
        return Err(AppError::Other(
            "Esa carpeta no parece una SharedCache de EVE (falta tq/resfileindex.txt)".into(),
        ));
    }
    let index = shared.join("tq").join("resfileindex.txt");
    let text = std::fs::read_to_string(&index)
        .map_err(|e| AppError::Other(format!("No pude leer {index:?}: {e}")))?;
    let dir = out_dir(&app)?;

    let mut sheets = 0usize;
    let mut skipped = 0usize;
    for line in text.lines() {
        // Formato: res:/ruta,hashdir/hashfile,md5,size,compressed
        let mut parts = line.split(',');
        let (Some(res), Some(blob)) = (parts.next(), parts.next()) else {
            continue;
        };
        let low = res.to_ascii_lowercase();
        let Some(prefix) = RES_PREFIXES.iter().find(|p| low.starts_with(*p)) else {
            continue;
        };
        if !low.ends_with(".dds") {
            continue;
        }
        // Nombre de salida = subcarpeta + fichero: "medals_star01.png" / "ribbons_caldari01.png".
        // Es la clave que usa el frontend al resolver un `graphic` de ESI.
        let sub = if prefix.contains("/ribbons/") { "ribbons" } else { "medals" };
        let base = low.rsplit('/').next().unwrap_or("").trim_end_matches(".dds");
        let src = shared.join("ResFiles").join(blob.trim());
        let Ok(data) = std::fs::read(&src) else {
            skipped += 1; // blob no descargado por el launcher: raro en tq, pero posible
            continue;
        };
        match decode_dds_bgra32(&data).and_then(|(w, h, rgba)| encode_png(w, h, &rgba)) {
            Ok(png_bytes) => {
                let dst = dir.join(format!("{sub}_{base}.png"));
                let ok = std::fs::File::create(&dst)
                    .and_then(|mut f| f.write_all(&png_bytes))
                    .is_ok();
                if ok {
                    sheets += 1;
                } else {
                    skipped += 1;
                }
            }
            Err(_) => skipped += 1, // p. ej. el glow DXT1: no lo necesitamos
        }
    }
    if sheets == 0 {
        return Err(AppError::Other(
            "La SharedCache no tenía ninguna textura de medallas legible".into(),
        ));
    }
    Ok(MedalExtractResult { sheets, skipped })
}

// ---------------------------------------------------------------------------
// Servir hojas al frontend
// ---------------------------------------------------------------------------

/// ¿Hay texturas extraídas? El frontend lo consulta UNA vez para decidir si compone
/// medallas reales o cae al marco genérico (evita disparar N invokes que fallarían).
#[tauri::command]
pub fn medal_textures_ready(app: tauri::AppHandle) -> bool {
    app.path()
        .app_data_dir()
        .map(|d| {
            let dir = d.join(OUT_SUBDIR);
            std::fs::read_dir(&dir)
                .map(|mut rd| rd.any(|e| e.is_ok()))
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

/// Devuelve una hoja como data-URL PNG (el CSP ya permite `img-src data:`).
/// `sheet` es la clave normalizada, p. ej. "ribbons_caldari01" o "medals_star02".
#[tauri::command]
pub fn get_medal_texture(app: tauri::AppHandle, sheet: String) -> AppResult<String> {
    // Solo [a-z0-9_]: la clave viene derivada de un `graphic` de ESI; esto corta cualquier
    // intento de path traversal por el mismo precio.
    if sheet.is_empty() || !sheet.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_') {
        return Err(AppError::Other(format!("nombre de hoja inválido: {sheet}")));
    }
    let path = out_dir(&app)?.join(format!("{sheet}.png"));
    let bytes = std::fs::read(&path).map_err(|_| AppError::NotFound)?;
    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}
