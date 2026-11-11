// Modal "Novedades": al actualizar, muestra los cambios entre la versión vista y la actual.
// 100% frontend: guarda la última versión vista en localStorage (persiste en el webview de Tauri).
// Primer arranque con la feature: muestra la versión actual una vez y sella; luego, solo al actualizar.
import { useEffect, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { tr } from "./i18n";
import { entriesSince, entryFor, bullets, type ChangelogEntry } from "./changelog";

const KEY = "koru_last_seen_version";

/** Convierte `**negrita**` en <strong>, que es lo único que usa el changelog.
 *
 *  POR QUÉ EXISTE (2026-11-11): el modal pintaba cada viñeta como texto plano, así que los `**`
 *  salían LITERALES en pantalla. Llevaba así desde que se escribió —la 0.55.0 y la 0.55.1 también
 *  los usan—, y nadie lo dijo nunca: es lo primero que ve un piloto al actualizar, y lo veía con
 *  asteriscos. Lo cazó RoGiz7 mirando una captura del modal de la 0.57.0.
 *
 *  Sin dependencias y SIN dangerouslySetInnerHTML a propósito: hoy el changelog es texto nuestro,
 *  pero pasarlo por innerHTML dejaría la puerta abierta a que mañana no lo sea.
 *
 *  Un `**` sin cerrar (número par de trozos) devuelve el texto tal cual en vez de inventarse dónde
 *  acaba la negrita: ante una marca a medias, lo menos sorprendente es no tocar nada. */
function conNegritas(texto: string): ReactNode[] {
  const trozos = texto.split("**");
  if (trozos.length % 2 === 0) return [texto];
  return trozos.map((x, i) => (i % 2 === 1 ? <strong key={i}>{x}</strong> : x));
}

/** Versión de la app visible en la topbar (p.ej. «v0.34.0»). Autocontenido: lee getVersion() una vez.
 *  Motivo: cuando alguien reporta un problema, saber QUÉ versión corre sin pedirle nada raro. */
export function AppVersionTag() {
  const [v, setV] = useState("");
  useEffect(() => {
    getVersion().then(setV).catch(() => {});
  }, []);
  if (!v) return null;
  return (
    <span className="muted small" title={tr("Versión de Koru")}>
      v{v}
    </span>
  );
}

export function WhatsNew() {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    let alive = true;
    getVersion()
      .then((current) => {
        if (!alive) return;
        const seen = localStorage.getItem(KEY);
        // Primer arranque: enseña la versión actual (si tiene entrada) una sola vez.
        const list = seen ? entriesSince(current, seen) : entryFor(current);
        if (list.length > 0) setEntries(list);
        localStorage.setItem(KEY, current); // ya se ha "visto"
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (entries.length === 0) return null;
  const e = entries[idx];
  const last = idx >= entries.length - 1;
  const close = () => setEntries([]);

  return (
    <div className="wn-overlay" onClick={close}>
      <div className="wn-modal" onClick={(ev) => ev.stopPropagation()}>
        <div className="wn-head">
          <h3>✨ {tr("Novedades")}</h3>
          <span className="wn-ver">
            v{e.version} · {e.date}
          </span>
        </div>
        <ul className="wn-list">
          {bullets(e).map((b, i) => (
            <li key={i}>{conNegritas(b)}</li>
          ))}
        </ul>
        <div className="wn-foot">
          {entries.length > 1 && (
            <span className="muted small">
              {idx + 1} / {entries.length}
            </span>
          )}
          {last ? (
            <button className="wn-btn" onClick={close}>
              {tr("Cerrar")}
            </button>
          ) : (
            <button className="wn-btn" onClick={() => setIdx((i) => i + 1)}>
              {tr("Siguiente")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
