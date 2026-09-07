//! ★★ DÓNDE VIVEN LOS DATOS DEL USUARIO. La única verdad, y hay que pasar por aquí SIEMPRE.
//!
//! # Por qué existe (2026-09-07)
//!
//! La carpeta de datos la elegía Tauri a partir del `identifier`, que es
//! `com.rekium.korudesktop` — el nombre de su corporación, de cuando Koru iba a ser solo para
//! ellos. Hoy lo instala gente de otras alianzas, y **para una herramienta que lee canales de
//! intel, que sus datos vivan en una carpeta con el nombre de una corp de nullsec se lee mal**. No
//! es estética: es fricción de adopción justo donde la gente es más desconfiada.
//!
//! # La decisión, y lo que la hace segura
//!
//! **La carpeta y el `identifier` dejan de ser la misma cosa.** Son dos renombrados con costes
//! muy distintos, y confundirlos era el error:
//!
//! - **La carpeta** es lo que ve el usuario. La creamos y la leemos nosotros → riesgo acotado.
//! - **El `identifier`** es lo que ve Windows: instalador, registro, notificaciones. Ahí no
//!   mandamos nosotros.
//!
//! Comprobado en su máquina (2026-09-07): la carpeta de instalación y **la clave de desinstalación
//! del registro salen del `productName` (`koru-desktop`), NO del identifier**; y el login SSO va
//! por `http://localhost:8765/callback`, no por un enlace propio registrado en el sistema. O sea
//! que **el identifier solo controla el nombre de la carpeta de datos**.
//!
//! ➡️ Así que el identifier **NO se toca**. Se cambia solo la carpeta, y el instalador se queda
//! completamente fuera de la ecuación.
//!
//! # La regla
//!
//! Se ancla en **el fichero de la base de datos, no en que exista la carpeta**: una carpeta puede
//! existir vacía o a medio crear (medallas extraídas, una migración interrumpida), y el `.sqlite3`
//! es la única señal de «aquí vive una instalación de verdad».
//!
//! 1. ¿Está la BD en la carpeta nueva? → la nueva.
//! 2. ¿Está en la heredada? → **la heredada, donde está.** Nada se mueve.
//! 3. ¿En ninguna? → la nueva (usuario nuevo).
//!
//! Hoy TODOS los usuarios existentes caen en el paso 2 y abren exactamente el mismo fichero que
//! ayer. Los nuevos nacen en `koru-desktop`. **Esta versión no mueve ni un byte** — la mudanza es
//! la fase siguiente, y esta fase existe para que su rama se ejecute durante una versión entera en
//! todas las máquinas antes de que haya nada que mover.
//!
//! # 🚨 LA TRAMPA, y es permanente
//!
//! **`app.path().app_data_dir()` YA NO ES LA CARPETA DE KORU.** Devuelve
//! `%APPDATA%/com.rekium.korudesktop` porque el identifier no cambia. Quien lo llame a pelo
//! escribirá en el sitio equivocado **sin dar ningún error**, que es el peor modo de fallo que
//! tenemos. Ya pasaba antes de esto: `medals.rs` lo hacía en dos sitios.
//!
//! ➡️ **Todo lo que necesite la carpeta de datos pasa por `resolver()` o `resolver_desde_base()`.**

use std::path::{Path, PathBuf};

/// La carpeta a la que vamos. Legible, sin nombre de corp, y es lo que el usuario ve.
pub const CARPETA: &str = "koru-desktop";

/// De dónde venimos. **No se borra nunca de aquí**: mientras exista un solo usuario que no haya
/// migrado, esta constante es lo único que sabe encontrar sus datos.
pub const CARPETA_HEREDADA: &str = "com.rekium.korudesktop";

/// El fichero que decide. Ver la regla arriba: la señal es la BD, no la carpeta.
pub const FICHERO_BD: &str = "koru-desktop.sqlite3";

/// Resuelve la carpeta a partir de la carpeta PADRE de datos del sistema
/// (`%APPDATA%` · `~/.local/share` · `~/Library/Application Support`).
///
/// Sin `AppHandle` a propósito: `graphics.rs` corre **antes** de que exista el `App` de Tauri —las
/// variables de entorno del renderizado hay que ponerlas antes de crear la webview— y necesita la
/// misma respuesta. Que las dos puertas compartan esta función es lo que evita volver a tener dos
/// verdades sobre la misma ruta, que es justo lo que había (`graphics.rs` la escribía a mano).
pub fn resolver_desde_base(base: &Path) -> PathBuf {
    let nueva = base.join(CARPETA);
    if nueva.join(FICHERO_BD).is_file() {
        return nueva;
    }
    let heredada = base.join(CARPETA_HEREDADA);
    if heredada.join(FICHERO_BD).is_file() {
        return heredada;
    }
    nueva
}

/// La carpeta de datos de Koru. **Esta es la puerta buena**; ver la trampa en la cabecera.
///
/// Si por lo que sea `app_data_dir()` no tuviera padre (no debería pasar nunca: Tauri la construye
/// como `<base>/<identifier>`), se devuelve tal cual. Es la respuesta de hoy, así que el peor caso
/// de esa rama es «todo sigue como estaba» y no una carpeta inventada.
pub fn resolver(app: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;
    let dir_identifier = match app.path().app_data_dir() {
        Ok(d) => d,
        // Sin carpeta de datos no hay nada que hacer y no es recuperable aquí: quien llama ya
        // trata el fallo (la BD revienta con un mensaje claro en `lib.rs`).
        Err(_) => return PathBuf::from(CARPETA),
    };
    match dir_identifier.parent() {
        Some(base) => resolver_desde_base(base),
        None => dir_identifier,
    }
}

// (Aquí había un `ruta_bd()` de conveniencia. Lo quité: `lib.rs` ya necesita la CARPETA para
// crearla antes de abrir nada, así que un segundo camino para calcular la misma ruta sería otra
// verdad duplicada — exactamente lo que este módulo viene a eliminar.)

/// ¿Estamos leyendo todavía de la carpeta heredada? Lo enseña Ajustes.
///
/// Existe para que el fallo que tememos deje de ser invisible: si algún día alguien abre un Koru
/// vacío, lo primero que hay que poder contestar es **de qué carpeta está leyendo**, y hasta ahora
/// eso no se podía saber desde dentro del programa.
pub fn es_heredada(dir: &Path) -> bool {
    dir.file_name()
        .is_some_and(|n| n.to_string_lossy() == CARPETA_HEREDADA)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Las tres ramas de la regla, con ficheros de verdad. Lo que se prueba no es que el código
    /// compile —eso ya lo dice cargo— sino que **el usuario existente sigue abriendo su fichero**,
    /// que es lo único que no puede fallar.
    #[test]
    fn la_regla_elige_bien() {
        let tmp = std::env::temp_dir().join(format!("koru-datadir-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        // 1) Nada instalado → la nueva.
        assert_eq!(resolver_desde_base(&tmp), tmp.join(CARPETA));

        // 2) Solo la heredada tiene BD → la heredada. ESTE es el caso de todos hoy.
        let vieja = tmp.join(CARPETA_HEREDADA);
        std::fs::create_dir_all(&vieja).unwrap();
        std::fs::write(vieja.join(FICHERO_BD), b"x").unwrap();
        assert_eq!(resolver_desde_base(&tmp), vieja);

        // 3) Una carpeta nueva VACÍA no gana: la señal es la BD, no la carpeta.
        std::fs::create_dir_all(tmp.join(CARPETA)).unwrap();
        assert_eq!(resolver_desde_base(&tmp), vieja);

        // 4) Con BD en la nueva, gana la nueva (situación después de la fase 2).
        std::fs::write(tmp.join(CARPETA).join(FICHERO_BD), b"x").unwrap();
        assert_eq!(resolver_desde_base(&tmp), tmp.join(CARPETA));

        // 5) Un DIRECTORIO llamado como la BD no cuenta como BD (`is_file`, no `exists`).
        let otro = tmp.join("otra-base");
        std::fs::create_dir_all(otro.join(CARPETA).join(FICHERO_BD)).unwrap();
        assert_eq!(resolver_desde_base(&otro), otro.join(CARPETA));

        assert!(es_heredada(&vieja));
        assert!(!es_heredada(&tmp.join(CARPETA)));
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
