//! Listener loopback que captura el `code` y el `state` del redirect de OAuth.
//! Levanta un servidor HTTP efímero en localhost:CALLBACK_PORT, espera UNA petición
//! a /callback, responde una página de "puedes cerrar esta pestaña" y devuelve los params.

use crate::config;
use crate::error::{AppError, AppResult};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

pub struct CallbackResult {
    pub code: String,
    pub state: String,
}

/// Bandera para cancelar un login en curso (p. ej. el usuario cerró la pestaña del navegador).
static LOGIN_CANCEL: AtomicBool = AtomicBool::new(false);
/// El frontend la activa vía el comando `cancel_login`.
pub fn request_cancel() {
    LOGIN_CANCEL.store(true, Ordering::SeqCst);
}
/// Se limpia al arrancar cada login.
pub fn reset_cancel() {
    LOGIN_CANCEL.store(false, Ordering::SeqCst);
}

/// Bloquea hasta recibir el callback, agotar el timeout o que el usuario cancele.
/// Pensado para correr en un hilo bloqueante (tokio::task::spawn_blocking).
pub fn wait_for_callback(timeout: Duration) -> AppResult<CallbackResult> {
    let addr = format!("127.0.0.1:{}", config::CALLBACK_PORT);
    let server = tiny_http::Server::http(&addr)
        .map_err(|e| AppError::Other(format!("no se pudo abrir el listener {addr}: {e}")))?;

    // Sondeo en cortos para poder reaccionar a la cancelación sin esperar al timeout completo.
    let deadline = Instant::now() + timeout;
    let request = loop {
        if LOGIN_CANCEL.load(Ordering::SeqCst) {
            return Err(AppError::Other("login cancelado".to_string()));
        }
        if Instant::now() >= deadline {
            return Err(AppError::CallbackTimeout);
        }
        match server.recv_timeout(Duration::from_millis(400)) {
            Ok(Some(req)) => break req,
            Ok(None) => continue,
            Err(e) => {
                return Err(AppError::Other(format!("error recibiendo callback: {e}")))
            }
        }
    };

    // Parseamos la query string del request URL (p. ej. /callback?code=..&state=..)
    let url = request.url().to_string();
    let query = url.splitn(2, '?').nth(1).unwrap_or("");
    let mut code: Option<String> = None;
    let mut state: Option<String> = None;
    let mut err: Option<String> = None;

    for pair in query.split('&') {
        let mut it = pair.splitn(2, '=');
        let k = it.next().unwrap_or("");
        let v = it.next().unwrap_or("");
        let v = urldecode(v);
        match k {
            "code" => code = Some(v),
            "state" => state = Some(v),
            "error" => err = Some(v),
            _ => {}
        }
    }

    let body = "<html><body style=\"font-family:sans-serif;background:#1c1c1c;color:#eee;text-align:center;padding-top:80px\">\
        <h2>Koru Desktop</h2><p>Autenticacion completada. Puedes cerrar esta pestana y volver a la app.</p></body></html>";
    let response = tiny_http::Response::from_string(body).with_header(
        tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..])
            .unwrap(),
    );
    let _ = request.respond(response);

    if let Some(e) = err {
        return Err(AppError::OAuth(format!("el SSO devolvió error: {e}")));
    }
    match (code, state) {
        (Some(code), Some(state)) => Ok(CallbackResult { code, state }),
        _ => Err(AppError::OAuth("callback sin code/state".to_string())),
    }
}

/// Decodificador URL mínimo (suficiente para code/state de OAuth).
fn urldecode(s: &str) -> String {
    let s = s.replace('+', " ");
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
