//! DIAGNÓSTICO: lo que hace falta saber del entorno para ayudar a alguien, y NADA MÁS.
//!
//! ## Por qué existe
//! Cada incidencia empezaba con una entrevista por Discord: ¿qué sesión?, ¿qué gráfica?, ¿AppImage
//! o `.deb`?, ¿en qué modo arrancó? La noche del 2026-08-18 se fueron **horas** en eso, con un
//! intermediario en medio y preguntando de una en una. Esto lo convierte en un pegado.
//!
//! ## ⚠️ NO ENVÍA NADA, Y ESO NO ES PEREZA
//! Koru lee tus chats, tus assets y tus killmails; todo su argumento es que **esos datos no salen
//! de tu máquina**. Una app que hace eso y luego llama a casa —aunque sea con datos técnicos—
//! rompe su propia premisa. Además, enviar convertiría el proyecto en responsable de datos, con lo
//! que eso implica en la UE. Aquí solo se GENERA el texto; copiarlo y pegarlo lo decide el usuario,
//! y lo ve antes.
//!
//! ## ⚠️ QUÉ NO PUEDE ENTRAR AQUÍ, NUNCA
//! Ni nombres de personaje, ni corporación, ni sistemas, ni tokens. Y **las rutas se recortan**:
//! esa noche se vieron `/mnt/barracudon/…` y `[sudo] contraseña para javier` — **una ruta lleva el
//! nombre de la persona**. El hogar se sustituye por `~`. Es la misma regla de privacidad de los
//! textos públicos, aplicada hacia dentro.
//! Del estado de Koru solo salen **números y sí/no**, jamás contenido.

use serde::Serialize;

/// Bloque de diagnóstico ya montado. Se devuelve el texto hecho y no las piezas sueltas: así el
/// frontend no puede recomponerlo mal ni añadir por su cuenta algo que no debería salir.
#[derive(Debug, Serialize)]
pub struct Diagnostico {
    /// El texto listo para pegar, en Markdown, para que Discord lo pinte como bloque.
    pub texto: String,
}

/// Sustituye el directorio personal por `~`. Una ruta absoluta de Linux o de Windows lleva el
/// nombre de usuario, que muy a menudo ES el nombre real de la persona.
fn sin_hogar(s: &str) -> String {
    let hogar = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();
    if hogar.is_empty() {
        return s.to_string();
    }
    s.replace(&hogar, "~")
}

/// Nombre bonito de la distro, de `/etc/os-release`. Vacío fuera de Linux.
#[cfg(target_os = "linux")]
fn distro() -> String {
    let Ok(txt) = std::fs::read_to_string("/etc/os-release") else {
        return "Linux (sin /etc/os-release)".into();
    };
    for l in txt.lines() {
        if let Some(v) = l.strip_prefix("PRETTY_NAME=") {
            return v.trim_matches('"').to_string();
        }
    }
    "Linux".into()
}

#[cfg(not(target_os = "linux"))]
fn distro() -> String {
    String::new()
}

/// Modelo de gráfica. En Linux se lee de `/sys` sin lanzar procesos: `lspci` puede no estar
/// instalado, y pedirle al usuario que lo instale para poder ayudarle es empezar mal.
#[cfg(target_os = "linux")]
fn gpu() -> String {
    let mut out: Vec<String> = Vec::new();
    if let Ok(rd) = std::fs::read_dir("/sys/class/drm") {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            // `card0`, `card1`… ignorando los conectores (`card0-DP-1`).
            if !n.starts_with("card") || n.contains('-') {
                continue;
            }
            let dev = e.path().join("device");
            let leer = |f: &str| {
                std::fs::read_to_string(dev.join(f))
                    .unwrap_or_default()
                    .trim()
                    .to_string()
            };
            // El driver en uso es lo que más dice: `amdgpu`, `nvidia`, `i915`, `virtio_gpu`…
            let driver = std::fs::read_link(dev.join("driver"))
                .ok()
                .and_then(|p| p.file_name().map(|s| s.to_string_lossy().to_string()))
                .unwrap_or_default();
            let vendor = leer("vendor");
            let device = leer("device");
            if !driver.is_empty() || !vendor.is_empty() {
                out.push(format!("{n}: {driver} ({vendor}:{device})"));
            }
        }
    }
    if out.is_empty() {
        "(no se pudo leer /sys/class/drm)".into()
    } else {
        out.join(" · ")
    }
}

#[cfg(not(target_os = "linux"))]
fn gpu() -> String {
    String::new()
}

/// Cómo se instaló. El AppImage se delata por su variable de entorno; el resto se deduce de dónde
/// vive el ejecutable. Importa más de lo que parece: el AppImage empaqueta librerías viejas a
/// propósito (lo exige el formato) y eso choca en distros modernas.
fn formato() -> String {
    if std::env::var_os("APPIMAGE").is_some() {
        return "AppImage".into();
    }
    let exe = std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    if cfg!(target_os = "windows") {
        return "Windows (instalador)".into();
    }
    if exe.starts_with("/usr/") {
        return "paquete del sistema (.deb/.rpm)".into();
    }
    if exe.contains("/app/") {
        return "Flatpak".into();
    }
    "ejecutable suelto".into()
}

fn var(n: &str) -> String {
    std::env::var(n).unwrap_or_else(|_| "(sin definir)".into())
}

/// Monta el bloque. `estado` lo aporta el frontend porque es lo único que el Rust no sabe: son
/// CONTADORES del estado de Koru (cuántos personajes, cuántos canales…), nunca contenido.
#[tauri::command]
pub fn diagnostico(estado: Vec<(String, String)>) -> Diagnostico {
    let mut l: Vec<String> = Vec::new();
    l.push("```".into());
    l.push(format!("Koru {} · {}", env!("CARGO_PKG_VERSION"), formato()));
    l.push(format!(
        "Sistema: {} {}",
        std::env::consts::OS,
        std::env::consts::ARCH
    ));

    #[cfg(target_os = "linux")]
    {
        l.push(format!("Distro: {}", distro()));
        l.push(format!(
            "Sesión: {} · Escritorio: {}",
            var("XDG_SESSION_TYPE"),
            var("XDG_CURRENT_DESKTOP")
        ));
        l.push(format!("GPU: {}", gpu()));
        // Las tres del modo compatible + el interruptor manual. Se enseñan SIEMPRE, también cuando
        // están sin definir: saber que NO están puestas es tan informativo como lo contrario.
        l.push(format!(
            "Gráficos: KORU_GRAPHICS={} · GDK_BACKEND={} · DMABUF={} · COMPOSITING={}",
            var("KORU_GRAPHICS"),
            var("GDK_BACKEND"),
            var("WEBKIT_DISABLE_DMABUF_RENDERER"),
            var("WEBKIT_DISABLE_COMPOSITING_MODE")
        ));
        l.push(format!(
            "Modo compatible: {}",
            if crate::graphics::grafico_modo_seguro() { "SÍ" } else { "no" }
        ));
    }

    for (k, v) in estado {
        l.push(format!("{k}: {v}"));
    }
    l.push("```".into());

    Diagnostico {
        texto: sin_hogar(&l.join("\n")),
    }
}
