//! ★ MEDIR EL ARRANQUE — paso 0 del brief «Al abrir, la ventana se queda en "No responde"» (28-11).
//!
//! APAGADO POR DEFECTO. Solo se enciende con la variable de entorno `KORU_MEDIR_ARRANQUE=1` al lanzar
//! Koru: ninguna release la lleva puesta, y sin ella cada gancho de aquí es una comprobación de un
//! booleano y nada más. No arregla nada: mide, escribe un informe y se calla.
//!
//! Qué mide (y por qué así):
//!  · `setup()` NO se toca (decidido: es la raíz pendiente de la carrera de arranque). Se mide DESDE
//!    FUERA: de la entrada en `run()` al evento `Ready` (incluye la inicialización de Tauri y
//!    `setup()` entero), y la carga de la página. `Db::open` sí se mide por dentro: vive fuera de
//!    `setup()`.
//!  · Cada comando, en el manejador de comandos: en Tauri v2 los síncronos corren ahí, en el hilo
//!    principal, y mientras corren la ventana no atiende. Los `async` vuelven al instante (solo se
//!    lanzan), así que lo que sale largo es hilo principal de verdad.
//!  · Cuánto de eso fue ESPERAR el candado de la BD: `CandadoBd` envuelve el `Mutex` con el mismo
//!    `lock()`, así que las 300 llamadas `db.conn.lock()` no cambian.
//!  · Quién lo tenía: el paso de la sincronización automática que estaba en marcha (`paso`).
//!
//! 🔒 El informe SOLO lleva nombres de comando, nombres de tramo/paso (literales del código) y
//!    milisegundos: ni personajes, ni sistemas, ni rutas. Va a la consola y a `koru-arranque.txt` en
//!    la carpeta temporal del sistema, a los 65 s de arrancar.

use rusqlite::Connection;
use std::cell::{Cell, RefCell};
use std::sync::{LockResult, Mutex, MutexGuard, OnceLock, TryLockError};
use std::time::{Duration, Instant};

/// Un comando de más de esto entra en la lista (la cuenta de seguidos los mira todos).
const UMBRAL_MS: f64 = 50.0;
/// Solo el primer minuto: el brief pide el arranque, no la vida entera de la app.
const VENTANA_MS: f64 = 60_000.0;
/// Dos tramos bloqueados separados por menos de esto cuentan como SEGUIDOS: en menos de un fotograma
/// (~16 ms) la ventana no llega a atender nada que se note.
const PEGADOS_MS: f64 = 16.0;

static ACTIVA: OnceLock<bool> = OnceLock::new();
static INICIO: OnceLock<Instant> = OnceLock::new();
static HILO_PRINCIPAL: OnceLock<std::thread::ThreadId> = OnceLock::new();
static ESTADO: Mutex<Estado> = Mutex::new(Estado::nuevo());
static PASO_SYNC: Mutex<&'static str> = Mutex::new("ninguno");
/// Quién cogió el candado de la BD la última vez: mientras está cogido, es quien lo TIENE. Lo pone
/// cada `lock()` nada más conseguirlo; lo lee quien se encuentra el candado ocupado.
static TITULAR: Mutex<String> = Mutex::new(String::new());
/// Cuándo lo cogió el titular. Quien esperaba lo consigue justo al soltarse, así que «ahora − esto» al
/// conseguirlo es cuánto lo TUVO el titular (si nadie más se coló entre medias).
static TITULAR_DESDE: Mutex<Option<Instant>> = Mutex::new(None);
/// CADA vez que alguien coge el candado en el primer minuto: (ms desde el inicio, quién · sitio). Un
/// `Mutex` no es justo, y mientras el hilo principal espera pueden pasar varios por delante; el
/// titular del momento en que empezó a esperar no lo cuenta todo. Esto sí.
static ADQUISICIONES: Mutex<Vec<(f64, String)>> = Mutex::new(Vec::new());

thread_local! {
    /// Lo que lleva esperado el candado de la BD el comando que corre en ESTE hilo.
    static ESPERA_BD_MS: Cell<f64> = const { Cell::new(0.0) };
    /// El paso de la sincronización durante la espera más larga de ese comando.
    static PASO_EN_ESPERA: Cell<&'static str> = const { Cell::new("") };
    static ESPERA_MAX_MS: Cell<f64> = const { Cell::new(0.0) };
    /// El comando que corre en ESTE hilo dentro del manejador, si corre uno.
    static CMD_ACTUAL: RefCell<Option<String>> = const { RefCell::new(None) };
    /// Quién tenía el candado durante la espera más larga de ese comando.
    static TITULAR_EN_ESPERA: RefCell<String> = const { RefCell::new(String::new()) };
}

struct Comando {
    nombre: String,
    ini_ms: f64,
    dur_ms: f64,
    espera_bd_ms: f64,
    paso: &'static str,
    /// Quién tenía el candado en su espera más larga: un comando, o «fondo · <paso del sync>».
    quien: String,
}

struct Estado {
    tramos: Vec<(&'static str, f64)>,
    marcas: Vec<(&'static str, f64)>,
    comandos: Vec<Comando>,
}
impl Estado {
    const fn nuevo() -> Self {
        Estado { tramos: Vec::new(), marcas: Vec::new(), comandos: Vec::new() }
    }
}

pub fn activa() -> bool {
    *ACTIVA.get_or_init(|| std::env::var("KORU_MEDIR_ARRANQUE").as_deref() == Ok("1"))
}

fn ms_desde_inicio(t: Instant) -> f64 {
    INICIO.get().map_or(0.0, |i| t.saturating_duration_since(*i).as_secs_f64() * 1000.0)
}

fn estado() -> std::sync::MutexGuard<'static, Estado> {
    // Envenenado = un pánico midiendo; se sigue con lo que haya: la medición no puede tumbar la app.
    ESTADO.lock().unwrap_or_else(|e| e.into_inner())
}

/// Lo primero de `run()`. Si está encendida, arranca el reloj y programa el informe a los 65 s.
pub fn inicio() {
    if !activa() {
        return;
    }
    let _ = INICIO.set(Instant::now());
    let _ = HILO_PRINCIPAL.set(std::thread::current().id());
    eprintln!("[medir_arranque] ENCENDIDA (KORU_MEDIR_ARRANQUE=1): informe a los 65 s");
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_secs(65));
        let texto = informe();
        eprintln!("{texto}");
        let ruta = std::env::temp_dir().join("koru-arranque.txt");
        match std::fs::write(&ruta, &texto) {
            Ok(()) => eprintln!("[medir_arranque] informe escrito en la carpeta temporal: koru-arranque.txt"),
            // Lo que falla en silencio falla dos veces: si no se puede escribir, se dice.
            Err(e) => eprintln!("[medir_arranque] NO se pudo escribir koru-arranque.txt: {e}"),
        }
    });
}

/// Un tramo medido: su nombre (literal del código) y lo que tardó desde `desde`.
pub fn tramo(nombre: &'static str, desde: Instant) {
    if !activa() {
        return;
    }
    let ms = desde.elapsed().as_secs_f64() * 1000.0;
    estado().tramos.push((nombre, ms));
}

/// Un instante (p. ej. «Ready»), en ms desde la entrada en `run()`.
pub fn marca(nombre: &'static str) {
    if !activa() {
        return;
    }
    let ms = ms_desde_inicio(Instant::now());
    estado().marcas.push((nombre, ms));
}

/// El paso en que está la sincronización automática. Literal del código, nunca un nombre de personaje.
pub fn paso(p: &'static str) {
    if activa() {
        *PASO_SYNC.lock().unwrap_or_else(|e| e.into_inner()) = p;
    }
}

/// Mientras vive, la sincronización está en marcha; al soltarlo (también si acaba antes de tiempo
/// con `?`), vuelve a «ninguno».
pub struct EnSync;
impl EnSync {
    pub fn empieza() -> Self {
        paso("auto_sync: arranque");
        EnSync
    }
}
impl Drop for EnSync {
    fn drop(&mut self) {
        paso("ninguno");
    }
}

/// Alrededor de CADA comando, en el manejador. Devuelve lo que devuelve el manejador.
pub fn comando<F: FnOnce() -> bool>(nombre: &str, f: F) -> bool {
    if !activa() {
        return f();
    }
    ESPERA_BD_MS.with(|c| c.set(0.0));
    ESPERA_MAX_MS.with(|c| c.set(0.0));
    PASO_EN_ESPERA.with(|c| c.set(""));
    TITULAR_EN_ESPERA.with(|c| c.borrow_mut().clear());
    CMD_ACTUAL.with(|c| *c.borrow_mut() = Some(nombre.to_string()));
    let t = Instant::now();
    let r = f();
    CMD_ACTUAL.with(|c| *c.borrow_mut() = None);
    let dur_ms = t.elapsed().as_secs_f64() * 1000.0;
    let ini_ms = ms_desde_inicio(t);
    if ini_ms <= VENTANA_MS {
        estado().comandos.push(Comando {
            nombre: nombre.to_string(),
            ini_ms,
            dur_ms,
            espera_bd_ms: ESPERA_BD_MS.with(|c| c.get()),
            paso: PASO_EN_ESPERA.with(|c| c.get()),
            quien: TITULAR_EN_ESPERA.with(|c| c.borrow().clone()),
        });
    }
    r
}

/// ★ EL CANDADO DE LA BD, con el MISMO `lock()` que el `Mutex` que sustituye: las llamadas no
/// cambian. Apagada la medición, es exactamente `Mutex::lock`.
pub struct CandadoBd(Mutex<Connection>);
impl CandadoBd {
    pub fn new(c: Connection) -> Self {
        CandadoBd(Mutex::new(c))
    }
    /// `#[track_caller]`: con la medición encendida, apunta DESDE DÓNDE (fichero y línea) se cogió el
    /// candado, sin tocar ninguna de las 300 llamadas. Apagada, no cuesta nada: no se lee.
    #[track_caller]
    pub fn lock(&self) -> LockResult<MutexGuard<'_, Connection>> {
        if !activa() {
            return self.0.lock();
        }
        let sitio = std::panic::Location::caller();
        // Libre: se coge y se apunta quién lo tiene. Ocupado: se lee quién lo tiene ANTES de esperar.
        let quien = match self.0.try_lock() {
            Ok(g) => {
                apuntar_titular(sitio);
                return Ok(g);
            }
            Err(TryLockError::Poisoned(p)) => {
                apuntar_titular(sitio);
                return Err(p);
            }
            Err(TryLockError::WouldBlock) => (
                TITULAR.lock().unwrap_or_else(|e| e.into_inner()).clone(),
                *TITULAR_DESDE.lock().unwrap_or_else(|e| e.into_inner()),
            ),
        };
        let t = Instant::now();
        let r = self.0.lock();
        // Lo que lo tuvo el titular: de cuando lo cogió hasta ahora, que es cuando se ha soltado.
        let tuvo_ms = quien.1.map(|d| d.elapsed().as_secs_f64() * 1000.0);
        apuntar_titular(sitio);
        let ms = t.elapsed().as_secs_f64() * 1000.0;
        if ms > 0.5 {
            ESPERA_BD_MS.with(|c| c.set(c.get() + ms));
            if ESPERA_MAX_MS.with(|c| c.get()) < ms {
                ESPERA_MAX_MS.with(|c| c.set(ms));
                let p = *PASO_SYNC.lock().unwrap_or_else(|e| e.into_inner());
                PASO_EN_ESPERA.with(|c| c.set(p));
                let texto = match tuvo_ms {
                    Some(m) => format!("{} · lo tuvo {m:.0} ms", quien.0),
                    None => quien.0,
                };
                TITULAR_EN_ESPERA.with(|c| *c.borrow_mut() = texto);
            }
        }
        r
    }
}

/// Apunta quién acaba de coger el candado: el comando de este hilo si corre uno en el manejador; si
/// no, «fondo» y el paso de la sincronización. ⚠️ Los comandos `async` corren FUERA del manejador
/// (Tauri los lanza en su runtime), así que salen como «fondo»: nombrarlos pediría tocar cada uno.
/// Y DESDE DÓNDE: fichero y línea del `lock()` (relativos al crate: ni rutas del usuario ni datos).
fn apuntar_titular(sitio: &'static std::panic::Location<'static>) {
    let q = CMD_ACTUAL.with(|c| c.borrow().clone()).unwrap_or_else(|| {
        let p = *PASO_SYNC.lock().unwrap_or_else(|e| e.into_inner());
        format!("fondo · {p}")
    });
    let quien = format!("{q} · {}:{}", sitio.file(), sitio.line());
    let ahora = Instant::now();
    let ms = ms_desde_inicio(ahora);
    if ms <= VENTANA_MS {
        ADQUISICIONES.lock().unwrap_or_else(|e| e.into_inner()).push((ms, quien.clone()));
    }
    *TITULAR.lock().unwrap_or_else(|e| e.into_inner()) = quien;
    *TITULAR_DESDE.lock().unwrap_or_else(|e| e.into_inner()) = Some(ahora);
}

/// El informe: lo que se pega. Solo nombres del código y milisegundos.
pub fn informe() -> String {
    let adq = ADQUISICIONES.lock().unwrap_or_else(|e| e.into_inner()).clone();
    componer(&estado(), HILO_PRINCIPAL.get().is_some()) + &componer_cola(&estado(), &adq)
}

/// Debajo de cada comando que esperó la BD más de `UMBRAL_MS`: quién cogió el candado mientras
/// esperaba, en orden y con su hora. Entre una y la siguiente, lo que lo tuvo cada uno (como mucho).
fn componer_cola(e: &Estado, adq: &[(f64, String)]) -> String {
    let mut o = String::from("\n-- Quién cogió la BD mientras esperaba cada comando (ms desde run(); «tuvo ≤» hasta la siguiente)\n");
    let mut alguno = false;
    for c in e.comandos.iter().filter(|c| c.espera_bd_ms > UMBRAL_MS) {
        alguno = true;
        o += &format!("   {} (de {:.0} a {:.0}, {:.0} ms esperando):\n", c.nombre, c.ini_ms, c.ini_ms + c.dur_ms, c.espera_bd_ms);
        // La que lo tenía al empezar a esperar es la última adquisición ANTES de `ini_ms`.
        let desde = adq.iter().rposition(|(t, _)| *t <= c.ini_ms).unwrap_or(0);
        let hasta = adq.iter().position(|(t, _)| *t > c.ini_ms + c.dur_ms).unwrap_or(adq.len());
        let tramo = &adq[desde..hasta];
        for (k, (t, q)) in tramo.iter().enumerate().take(25) {
            let sig = tramo.get(k + 1).map(|x| x.0).unwrap_or(c.ini_ms + c.dur_ms);
            o += &format!("      {t:>9.0}  tuvo ≤ {:>6.0} ms  {q}\n", sig - t);
        }
        if tramo.len() > 25 {
            o += &format!("      … y {} más\n", tramo.len() - 25);
        }
    }
    if !alguno {
        o += "   (ninguno)\n";
    }
    o
}

/// El texto, sobre un `Estado` dado: puro, para poder probarlo sin la app.
fn componer(e: &Estado, principal: bool) -> String {
    let mut o = String::from("===== Koru · medición del arranque (KORU_MEDIR_ARRANQUE) =====\n");
    o += "Tiempos en ms desde la entrada en run().\n\n-- Hitos\n";
    for (n, ms) in &e.marcas {
        o += &format!("  {ms:>9.0}  {n}\n");
    }
    o += "\n-- Tramos medidos (Db::open se ejecuta dentro de setup)\n";
    for (n, ms) in &e.tramos {
        o += &format!("  {ms:>9.1} ms  {n}\n");
    }
    o += &format!(
        "\n-- Comandos de más de {UMBRAL_MS:.0} ms en el primer minuto (en el manejador = hilo principal{})\n",
        if principal { "" } else { "; sin hilo principal registrado" }
    );
    o += "   empieza(ms)   duró(ms)  esperando BD(ms)  paso del sync al esperar  comando  ← quién tenía la BD\n";
    let mut largos: Vec<&Comando> = e.comandos.iter().filter(|c| c.dur_ms > UMBRAL_MS).collect();
    largos.sort_by(|a, b| a.ini_ms.total_cmp(&b.ini_ms));
    for c in &largos {
        o += &format!(
            "   {:>10.0} {:>10.1} {:>17.1}  {:<24}  {}{}\n",
            c.ini_ms,
            c.dur_ms,
            c.espera_bd_ms,
            if c.paso.is_empty() { "-" } else { c.paso },
            c.nombre,
            if c.quien.is_empty() { String::new() } else { format!("  ← {}", c.quien) }
        );
    }
    if largos.is_empty() {
        o += "   (ninguno)\n";
    }
    // La cuenta final: el hilo principal sin atender. El arranque hasta Ready es un tramo bloqueado
    // (setup corre ahí), y luego cada comando. Se juntan los que van pegados.
    let ready = e.marcas.iter().find(|(n, _)| n.starts_with("Ready")).map(|(_, ms)| *ms);
    let mut tramos: Vec<(f64, f64)> = e.comandos.iter().map(|c| (c.ini_ms, c.ini_ms + c.dur_ms)).collect();
    if let Some(r) = ready {
        tramos.push((0.0, r));
    }
    tramos.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut juntos: Vec<(f64, f64)> = Vec::new();
    for (a, b) in tramos {
        match juntos.last_mut() {
            Some(u) if a <= u.1 + PEGADOS_MS => u.1 = u.1.max(b),
            _ => juntos.push((a, b)),
        }
    }
    let total: f64 = juntos.iter().map(|(a, b)| b - a).sum();
    let peor = juntos.iter().copied().max_by(|x, y| (x.1 - x.0).total_cmp(&(y.1 - y.0)));
    o += &format!(
        "\n-- Hilo principal sin atender (arranque hasta Ready + comandos; pegados si hay menos de {PEGADOS_MS:.0} ms entre ellos)\n"
    );
    o += &format!("   total en el primer minuto: {total:.0} ms · {} tramos\n", juntos.len());
    if let Some((a, b)) = peor {
        o += &format!("   el tramo seguido más largo: {:.0} ms (de {a:.0} a {b:.0})\n", b - a);
    }
    o += &format!("   comandos medidos en total: {}\n", e.comandos.len());
    o
}

#[cfg(test)]
mod tests {
    use super::*;

    /// El informe con datos de mentira: el arranque hasta Ready y un comando pegado a él cuentan como
    /// UN tramo seguido; uno corto no entra en la lista; uno separado es otro tramo.
    #[test]
    fn informe_junta_lo_pegado_y_lista_lo_largo() {
        let c = |nombre: &str, ini_ms, dur_ms, espera_bd_ms, paso| Comando {
            nombre: nombre.into(),
            ini_ms,
            dur_ms,
            espera_bd_ms,
            paso,
            quien: if espera_bd_ms > 0.0 { "fondo · auto_sync: assets e inventario".into() } else { String::new() },
        };
        let e = Estado {
            tramos: vec![("Db::open · esquema (schema.sql)", 120.0)],
            marcas: vec![("Ready (setup terminado, el bucle de eventos arranca)", 900.0)],
            comandos: vec![
                c("get_character_cards", 905.0, 400.0, 350.0, "auto_sync: assets e inventario"),
                c("ui_lista", 2000.0, 3.0, 0.0, ""),
                c("plan_cargar", 5000.0, 80.0, 0.0, ""),
            ],
        };
        let t = componer(&e, true);
        assert!(t.contains("get_character_cards") && t.contains("auto_sync: assets e inventario"), "{t}");
        assert!(t.contains("get_character_cards  ← fondo · auto_sync: assets e inventario"), "dice quién tenía la BD: {t}");
        assert!(t.contains("plan_cargar") && !t.contains("ui_lista"), "solo los de más de 50 ms: {t}");
        assert!(t.contains("el tramo seguido más largo: 1305 ms (de 0 a 1305)"), "Ready + el comando pegado: {t}");
        assert!(t.contains("total en el primer minuto: 1388 ms · 3 tramos"), "{t}");
    }

    /// Apagada (lo normal), el candado es el de siempre y no se mide nada. Este test corre sin la
    /// variable: si alguien la dejara encendida por defecto, lo de abajo fallaría.
    #[test]
    fn apagada_por_defecto() {
        if std::env::var("KORU_MEDIR_ARRANQUE").is_ok() {
            return; // quien la puso a propósito al lanzar los tests sabe lo que hace
        }
        assert!(!activa(), "la medición del arranque NO puede estar encendida sin la variable");
        let c = CandadoBd::new(Connection::open_in_memory().unwrap());
        assert!(c.lock().is_ok());
        assert!(comando("x", || true));
        assert!(estado().comandos.is_empty(), "apagada no apunta nada");
    }

    /// La cola: mientras un comando espera, salen en orden los que cogieron el candado, empezando por
    /// el que lo tenía al empezar a esperar; y no los de antes ni los de después.
    #[test]
    fn la_cola_de_quien_cogio_la_bd() {
        let e = Estado {
            tramos: vec![],
            marcas: vec![],
            comandos: vec![Comando {
                nombre: "fleet_op_activa".into(),
                ini_ms: 700.0,
                dur_ms: 860.0,
                espera_bd_ms: 860.0,
                paso: "ninguno",
                quien: String::new(),
            }],
        };
        let adq = vec![
            (100.0, "antes · zz_antes.rs:9".to_string()),
            (650.0, "fondo · ninguno · bitacora.rs:1514".to_string()),
            (900.0, "fondo · ninguno · mod.rs:4371".to_string()),
            (1559.0, "fleet_op_activa · mod.rs:3624".to_string()),
            (2000.0, "despues · zz_despues.rs:9".to_string()),
        ];
        let t = componer_cola(&e, &adq);
        assert!(t.contains("bitacora.rs:1514") && t.contains("mod.rs:4371") && t.contains("mod.rs:3624"), "{t}");
        assert!(!t.contains("zz_antes.rs") && !t.contains("zz_despues.rs"), "ni los de antes ni los de después: {t}");
        assert!(t.contains("tuvo ≤    250 ms  fondo · ninguno · bitacora.rs:1514"), "{t}");
    }

    /// Encendida a mano en el test: un comando que coge el candado queda como su titular, y alguien
    /// que no es un comando queda como «fondo» con el paso del sync.
    #[test]
    fn titular_comando_o_fondo() {
        CMD_ACTUAL.with(|c| *c.borrow_mut() = Some("fleet_op_activa".into()));
        apuntar_titular(std::panic::Location::caller());
        let t = TITULAR.lock().unwrap().clone();
        assert!(t.starts_with("fleet_op_activa · ") && t.contains("medir_arranque.rs:"), "con su sitio: {t}");
        CMD_ACTUAL.with(|c| *c.borrow_mut() = None);
        apuntar_titular(std::panic::Location::caller());
        assert!(TITULAR.lock().unwrap().starts_with("fondo · "), "{}", TITULAR.lock().unwrap());
        TITULAR.lock().unwrap().clear();
    }
}
