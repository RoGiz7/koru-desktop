//! MODO GRÁFICO COMPATIBLE (Linux) — arrancar aunque WebKitGTK no sepa pintar.
//!
//! ## El problema, tal y como se vio (2026-08-13)
//! Un tester estrenó Koru en Linux con una **AMD RDNA4 sobre Wayland** y Mesa muy reciente. La app
//! abortaba con `Could not create default EGL display: EGL_BAD_PARAMETER`, y forzando el
//! renderizado por software abría **una ventana en blanco**. La combinación que lo arregló fue:
//!
//! ```text
//! GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1
//! ```
//!
//! Otro tester, con otra máquina, no necesita ninguna. Por eso **no se le ponen a todo el mundo**:
//! le quitarían el camino rápido de renderizado a quien lo tiene bien, y la documentación de Tauri
//! avisa expresamente de ello (`develop/debug/linux-graphics`).
//!
//! ## Por qué se detecta en vez de documentarse
//! Una ventana en blanco **no da error, no escribe nada y parece que la app está rota**. Quien la
//! ve por primera vez no tiene ni el vocabulario para buscar el problema. Documentarlo solo ayuda
//! a quien ya sabe que existe una solución.
//!
//! ## Cómo funciona, y por qué esta detección SÍ es fiable
//! La regla de la casa es que **detectar el fracaso suele ser frágil** (ver la historia del login
//! sin navegador). Aquí no se detecta el fracaso: se detecta **la ausencia de éxito**, que es una
//! señal mucho más honesta.
//!
//!   1. Al arrancar se escribe una marca (`arranque-en-curso`).
//!   2. Cuando la interfaz llega a pintarse de verdad, el frontend llama a `ui_lista` y la borra.
//!   3. Si al arrancar la marca **sigue ahí**, el arranque anterior nunca llegó a pintar → se
//!      encienden las variables de compatibilidad.
//!   4. Y si se pinta ESTANDO en compatible, se recuerda para siempre (`modo-grafico-compatible`).
//!
//! **El paso 4 no estaba y el arreglo ALTERNABA** — se vio en el pegado de un tester el 2026-08-18:
//! compatible pintaba → se borraba la marca → el arranque siguiente probaba el modo normal → fallaba
//! → el siguiente volvía a compatible. Una sí y una no, para siempre. Eran dos hechos distintos
//! metidos en un mismo fichero: «el arranque anterior falló» (efímero) y «aquí hace falta el modo
//! compatible» (permanente).
//!
//! Un cierre normal deja la marca borrada, así que cerrar Koru no dispara nada. Matar el proceso
//! *antes* de que pinte sí lo dispara — y es correcto, porque desde fuera no se distingue de una
//! ventana que nunca llegó.
//!
//! ## Escape manual
//! `KORU_GRAPHICS=safe` fuerza el modo compatible · `KORU_GRAPHICS=normal` lo desactiva **y olvida
//! lo aprendido** (si no, un `normal` puntual no serviría: al arranque siguiente volvería solo).
//! Está para el caso en que la detección se equivoque, que es cuestión de tiempo que pase.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

/// ¿Se arrancó en modo compatible? Lo lee el frontend para poder decirlo en pantalla: un modo
/// degradado que no se anuncia es un misterio para el que lo sufre y para quien da soporte.
static MODO_SEGURO: AtomicBool = AtomicBool::new(false);

/// Carpeta de datos de la app. Se calcula A MANO porque esto corre **antes** de que exista el
/// `App` de Tauri —las variables de entorno del renderizado hay que ponerlas antes de que se cree
/// la webview, o no sirven de nada—, así que `app_data_dir()` todavía no está disponible.
#[cfg(target_os = "linux")]
fn dir_datos() -> Option<PathBuf> {
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))?;
    Some(base.join("com.rekium.korudesktop"))
}

#[cfg(not(target_os = "linux"))]
fn dir_datos() -> Option<PathBuf> {
    None
}

/// Marca de «hay un arranque en curso que aún no ha pintado». Se borra en cuanto pinta.
fn ruta_marca() -> Option<PathBuf> {
    dir_datos().map(|d| d.join("arranque-en-curso"))
}

/// Bandera de «en esta máquina el que funciona es el modo compatible». **Persiste.**
///
/// ⚠️ SIN ESTO EL ARREGLO ALTERNABA, y no lo vi hasta ver el pegado de un tester (2026-08-18):
/// el modo compatible pintaba → el frontend borraba la marca → el arranque siguiente volvía a modo
/// normal → fallaba → el siguiente volvía a compatible… una sí y una no, para siempre.
/// Son dos hechos distintos y estaban mezclados en un solo fichero: **«el arranque anterior falló»**
/// (efímero) y **«aquí hace falta el modo compatible»** (permanente).
fn ruta_flag() -> Option<PathBuf> {
    dir_datos().map(|d| d.join("modo-grafico-compatible"))
}

/// Llamar lo PRIMERO de todo en `run()`, antes de construir Tauri.
pub fn preparar() {
    // Fuera de Linux no hay nada que hacer: el problema es de WebKitGTK.
    if !cfg!(target_os = "linux") {
        return;
    }

    let forzado = std::env::var("KORU_GRAPHICS").unwrap_or_default();
    if forzado.eq_ignore_ascii_case("normal") {
        // El usuario manda, y manda DE VERDAD: además de no aplicar nada, se olvida lo aprendido.
        // Si no, un `normal` puntual no serviría de nada — al arranque siguiente volvería solo.
        if let Some(f) = ruta_flag() {
            let _ = std::fs::remove_file(f);
        }
        return;
    }

    let marca = ruta_marca();
    let pendiente = marca.as_ref().map(|p| p.exists()).unwrap_or(false);
    // Lo aprendido manda sobre la detección: si ya sabemos que aquí hace falta, no hay que fallar
    // una vez más para recordarlo.
    let aprendido = ruta_flag().map(|p| p.exists()).unwrap_or(false);

    if forzado.eq_ignore_ascii_case("safe") || pendiente || aprendido {
        aplicar_compatibilidad();
        MODO_SEGURO.store(true, Ordering::Relaxed);
        if pendiente && !aprendido {
            eprintln!(
                "[koru] El arranque anterior no llegó a pintar la ventana. \
                 Arrancando en modo gráfico compatible (X11, sin DMA-BUF ni compositing). \
                 Para desactivarlo: KORU_GRAPHICS=normal"
            );
        }
    }

    // Dejar la marca para ESTE arranque. Si la interfaz pinta, `ui_lista` la borra.
    if let Some(p) = marca {
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(&p, b"1");
    }
}

/// Las tres variables, en el orden en que las recomienda Tauri: primero la que menos renuncia.
/// Se ponen las tres juntas a propósito — es la combinación que se verificó que funciona, y probar
/// escalones intermedios en el arranque significaría fallar varias veces delante del usuario.
fn aplicar_compatibilidad() {
    // `set_var` no es `unsafe` en la edición 2021. Esto corre antes de crear ningún hilo propio,
    // que es la condición para que sea seguro.
    std::env::set_var("GDK_BACKEND", "x11");
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
}

/// El frontend avisa de que la interfaz ya se ha pintado. Borra la marca del arranque.
///
/// Es el único punto donde se declara el éxito, y por eso lo llama el FRONTEND y no el Rust: que el
/// backend arranque no demuestra nada — el fallo que perseguimos es justo que el proceso vive y la
/// ventana está en blanco.
#[tauri::command]
pub fn ui_lista() {
    if let Some(p) = ruta_marca() {
        let _ = std::fs::remove_file(p);
    }
    // Si hemos pintado ESTANDO en modo compatible, es que aquí el compatible es el que funciona.
    // Se recuerda, porque si no el arranque siguiente volvería a probar el normal y fallaría.
    if MODO_SEGURO.load(Ordering::Relaxed) {
        if let Some(f) = ruta_flag() {
            if let Some(dir) = f.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let _ = std::fs::write(&f, b"1");
        }
    }
}

/// ¿Estamos en modo compatible? Para poder decirlo en la interfaz.
#[tauri::command]
pub fn grafico_modo_seguro() -> bool {
    MODO_SEGURO.load(Ordering::Relaxed)
}
