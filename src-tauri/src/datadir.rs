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

/// Nombre del destino MIENTRAS se está copiando. Nunca se copia directamente a `CARPETA`: si el
/// proceso muere a mitad, ahí quedaría media instalación con la BD a medio copiar, y el resolutor
/// la daría por buena en el arranque siguiente. Con un nombre aparte, lo peor que puede quedar es
/// una carpeta basura que nadie lee.
const CARPETA_TEMPORAL: &str = "koru-desktop.migrando";

/// El rastro que se deja en la carpeta vieja. No es documentación: es lo que contesta «¿por qué mi
/// Koru está vacío?» cuando alguien instale a mano una versión anterior a la 0.49, que no tiene
/// resolutor y vendrá a leer aquí.
const NOTA_MUDANZA: &str = "MUDADO-A-koru-desktop.txt";

/// ★★ FASE 2 — LA MUDANZA. Devuelve `Some(destino)` solo si de verdad movió algo.
///
/// # La regla de oro: nada se borra, y el destino no existe hasta estar completo
///
/// Se copia a `koru-desktop.migrando` y **solo al terminar** se renombra a `koru-desktop`. En el
/// mismo volumen un renombrado de carpeta es atómico, así que el destino **o aparece entero o no
/// aparece**. La carpeta vieja no se toca (salvo para dejar la nota), o sea que **el peor caso
/// posible es «hoy no migró»** y el usuario ni se entera. Ningún camino acaba en datos perdidos.
///
/// # Por qué el checkpoint del WAL va primero
///
/// SQLite reparte la verdad entre el `.sqlite3` y su `-wal`. Si la sesión anterior no cerró limpia,
/// parte de los datos vive en el WAL — copiar los ficheros sin consolidar podría dar una BD válida
/// pero VIEJA, que es peor que un error: no se nota. Con `wal_checkpoint(TRUNCATE)` todo queda en
/// el fichero principal antes de tocar nada. Si el checkpoint falla (BD bloqueada por otra
/// instancia, disco lleno, corrupción) **se aborta la mudanza y se sigue en la carpeta vieja**.
///
/// # Lo que NO hace
///
/// No borra la carpeta vieja. Eso es la fase 3, con un botón y un aviso, porque a partir de ahí una
/// versión anterior a la 0.49 ya no encuentra los datos y la gente reinstala versiones viejas
/// cuando algo falla.
pub fn mudar_si_toca(base: &Path) -> Option<PathBuf> {
    let nueva = base.join(CARPETA);
    let heredada = base.join(CARPETA_HEREDADA);

    // Solo hay algo que hacer si la vieja tiene BD y la nueva no. Cualquier otro estado ya está
    // resuelto: usuario nuevo, usuario ya migrado, o instalación que no existe.
    if nueva.join(FICHERO_BD).is_file() || !heredada.join(FICHERO_BD).is_file() {
        return None;
    }

    // 1) Consolidar el WAL. Si esto no sale bien, no seguimos: ver arriba.
    if let Err(e) = consolidar_wal(&heredada.join(FICHERO_BD)) {
        eprintln!("[koru] mudanza abortada, no pude consolidar el WAL: {e}");
        return None;
    }

    // 2) Destino provisional limpio. Si quedó uno de un intento anterior, se tira: es basura por
    //    definición, porque un `.migrando` que sobrevive es un intento que NO llegó al renombrado.
    let temporal = base.join(CARPETA_TEMPORAL);
    if temporal.exists() {
        if let Err(e) = std::fs::remove_dir_all(&temporal) {
            eprintln!("[koru] mudanza abortada, no pude limpiar {temporal:?}: {e}");
            return None;
        }
    }
    if let Err(e) = copiar_arbol(&heredada, &temporal) {
        eprintln!("[koru] mudanza abortada al copiar: {e}");
        let _ = std::fs::remove_dir_all(&temporal);
        return None;
    }

    // 3) Antes del renombrado, quitar de en medio una `koru-desktop` SIN BD. Puede existir por un
    //    intento anterior, y en Windows un `rename` sobre una carpeta que ya existe falla. Solo se
    //    borra si NO tiene base de datos — si la tuviera no habríamos llegado hasta aquí.
    if nueva.exists() {
        if let Err(e) = std::fs::remove_dir_all(&nueva) {
            eprintln!("[koru] mudanza abortada, {nueva:?} está y no se deja quitar: {e}");
            let _ = std::fs::remove_dir_all(&temporal);
            return None;
        }
    }

    // 4) El instante atómico.
    if let Err(e) = std::fs::rename(&temporal, &nueva) {
        eprintln!("[koru] mudanza abortada al renombrar: {e}");
        let _ = std::fs::remove_dir_all(&temporal);
        return None;
    }

    // 5) Comprobar que lo copiado se abre de verdad. Un fichero del tamaño correcto puede estar
    //    truncado o corrupto, y darse cuenta AHORA cuesta deshacerlo; darse cuenta después es un
    //    Koru vacío con los datos escondidos en una carpeta que ya nadie mira.
    if let Err(e) = abre_bien(&nueva.join(FICHERO_BD)) {
        eprintln!("[koru] la BD copiada no abre ({e}); vuelvo a la carpeta heredada");
        let _ = std::fs::remove_dir_all(&nueva);
        return None;
    }

    // 6) El rastro en la vieja. Se escribe LO ÚLTIMO y su fallo no revierte nada: sin él la
    //    mudanza es igual de correcta, solo peor de explicar.
    let _ = std::fs::write(
        heredada.join(NOTA_MUDANZA),
        format!(
            "Koru movio sus datos a:\r\n\r\n    {}\r\n\r\n\
             Esta carpeta se queda como copia de seguridad y ya no se usa. Puedes borrarla cuando\r\n\
             quieras, pero ten en cuenta que una version de Koru anterior a la 0.49 no sabe buscar\r\n\
             en la carpeta nueva y volveria a leer aqui.\r\n",
            nueva.display()
        ),
    );

    eprintln!("[koru] datos mudados a {nueva:?} (la carpeta vieja se queda intacta)");
    Some(nueva)
}

/// `wal_checkpoint(TRUNCATE)` y cerrar. Abre en modo lectura-escritura porque un checkpoint
/// escribe; si la BD está en uso por otra instancia, esto falla y la mudanza se aborta sola.
fn consolidar_wal(bd: &Path) -> Result<(), String> {
    let conn = rusqlite::Connection::open(bd).map_err(|e| e.to_string())?;
    conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))
        .map_err(|e| e.to_string())?;
    conn.close().map_err(|(_, e)| e.to_string())
}

/// ¿La BD del destino abre y contesta? `PRAGMA quick_check` en vez de `integrity_check`: recorre lo
/// suficiente para cazar una copia truncada sin tardar un minuto en una base de 241 MB.
fn abre_bien(bd: &Path) -> Result<(), String> {
    let conn = rusqlite::Connection::open(bd).map_err(|e| e.to_string())?;
    let r: String = conn
        .query_row("PRAGMA quick_check(1)", [], |f| f.get(0))
        .map_err(|e| e.to_string())?;
    if r != "ok" {
        return Err(format!("quick_check dijo «{r}»"));
    }
    Ok(())
}

/// Copia recursiva. **Todo el contenido, no solo la BD**: dentro viven también las medallas
/// extraídas (`medals/`) y las banderas de arranque de Linux, y perder cualquiera de las dos se
/// nota. Un error en cualquier fichero aborta la copia entera — media mudanza no es una mudanza.
fn copiar_arbol(de: &Path, a: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(a)?;
    for entrada in std::fs::read_dir(de)? {
        let entrada = entrada?;
        let origen = entrada.path();
        let destino = a.join(entrada.file_name());
        if entrada.file_type()?.is_dir() {
            copiar_arbol(&origen, &destino)?;
        } else {
            std::fs::copy(&origen, &destino)?;
        }
    }
    Ok(())
}

/// ¿Estamos leyendo todavía de la carpeta heredada? Lo sirve `db_info` y lo pinta Ajustes.
///
/// ⚠️ Este comentario decía «Lo enseña Ajustes» desde la fase 1 y **no lo enseñaba nadie**: la
/// función no se llamaba desde ningún sitio. Se arregló al escribir la fase 2, que es cuando el
/// dato empezó a significar algo: antes todo el mundo estaba en la heredada y decirlo no informaba
/// de nada; **ahora significa que la mudanza NO se hizo**, o sea que algo falló.
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

    /// Siembra una carpeta heredada con una BD de verdad, medallas y la bandera de Linux.
    fn sembrar(base: &Path, filas: i64) -> PathBuf {
        let h = base.join(CARPETA_HEREDADA);
        std::fs::create_dir_all(h.join("medals")).unwrap();
        std::fs::write(h.join("medals").join("x.png"), b"PNG").unwrap();
        std::fs::write(h.join("modo-grafico-compatible"), b"1").unwrap();
        let c = rusqlite::Connection::open(h.join(FICHERO_BD)).unwrap();
        c.execute_batch("CREATE TABLE t(x);").unwrap();
        for i in 0..filas {
            c.execute("INSERT INTO t VALUES (?1)", [i]).unwrap();
        }
        c.close().unwrap();
        h
    }

    fn cuenta(dir: &Path) -> i64 {
        let c = rusqlite::Connection::open(dir.join(FICHERO_BD)).unwrap();
        let n = c.query_row("SELECT COUNT(*) FROM t", [], |r| r.get(0)).unwrap();
        c.close().unwrap();
        n
    }

    fn nuevo_tmp(sufijo: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("koru-mud-{}-{sufijo}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    /// El camino feliz: se copia TODO, la vieja queda intacta y el resolutor ya apunta a la nueva.
    #[test]
    fn la_mudanza_mueve_todo_y_no_borra_nada() {
        let base = nuevo_tmp("ok");
        let vieja = sembrar(&base, 7);
        let destino = mudar_si_toca(&base).expect("debería haber migrado");
        assert_eq!(destino, base.join(CARPETA));
        assert_eq!(cuenta(&destino), 7, "los datos tienen que llegar enteros");
        assert!(destino.join("medals").join("x.png").is_file(), "las medallas también se mudan");
        assert!(destino.join("modo-grafico-compatible").is_file());
        // La vieja NO se toca: es la copia de seguridad gratis.
        assert!(vieja.join(FICHERO_BD).is_file());
        assert!(vieja.join(NOTA_MUDANZA).is_file(), "y queda dicho adónde se fue");
        // Sin restos del provisional, y el resolutor ya elige la nueva.
        assert!(!base.join(CARPETA_TEMPORAL).exists());
        assert_eq!(resolver_desde_base(&base), destino);
        // Y es idempotente: al arranque siguiente no hay nada que hacer.
        assert!(mudar_si_toca(&base).is_none());
        let _ = std::fs::remove_dir_all(&base);
    }

    /// Los estados en los que NO debe tocar un byte, y los restos de intentos anteriores.
    #[test]
    fn la_mudanza_sabe_cuando_no_tocar_nada() {
        // Usuario nuevo: no hay heredada.
        let a = nuevo_tmp("nuevo");
        assert!(mudar_si_toca(&a).is_none());

        // Ya migrado: la nueva tiene BD → no se vuelve a copiar encima.
        let b = nuevo_tmp("hecho");
        sembrar(&b, 3);
        mudar_si_toca(&b).unwrap();
        std::fs::write(b.join(CARPETA).join("marca-de-hoy"), b"x").unwrap();
        assert!(mudar_si_toca(&b).is_none());
        assert!(b.join(CARPETA).join("marca-de-hoy").is_file(), "no se pisa lo que ya hay");

        // Restos de un intento anterior: un `.migrando` a medias y una `koru-desktop` sin BD.
        let c = nuevo_tmp("restos");
        sembrar(&c, 5);
        std::fs::create_dir_all(c.join(CARPETA_TEMPORAL)).unwrap();
        std::fs::write(c.join(CARPETA_TEMPORAL).join("basura"), b"x").unwrap();
        std::fs::create_dir_all(c.join(CARPETA)).unwrap();
        std::fs::write(c.join(CARPETA).join("suelto"), b"x").unwrap();
        let d = mudar_si_toca(&c).expect("los restos no deben bloquear la mudanza");
        assert_eq!(cuenta(&d), 5);
        assert!(!d.join("basura").exists(), "la basura del intento previo no viaja");

        for p in [a, b, c] {
            let _ = std::fs::remove_dir_all(p);
        }
    }

    /// Una BD que no abre NO se muda: más vale «hoy no migró» que un Koru vacío con los datos
    /// escondidos en una carpeta que ya nadie mira.
    #[test]
    fn una_bd_rota_aborta_la_mudanza() {
        let base = nuevo_tmp("rota");
        let vieja = base.join(CARPETA_HEREDADA);
        std::fs::create_dir_all(&vieja).unwrap();
        std::fs::write(vieja.join(FICHERO_BD), b"esto no es una base de datos").unwrap();

        assert!(mudar_si_toca(&base).is_none());
        assert!(!base.join(CARPETA).exists(), "no puede quedar una carpeta nueva a medias");
        assert!(!base.join(CARPETA_TEMPORAL).exists());
        assert!(vieja.join(FICHERO_BD).is_file(), "y la vieja sigue donde estaba");
        let _ = std::fs::remove_dir_all(&base);
    }
}
