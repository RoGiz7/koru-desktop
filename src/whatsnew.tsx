// Modal "Novedades": al actualizar, muestra los cambios entre la versión vista y la actual.
// 100% frontend: guarda la última versión vista en localStorage (persiste en el webview de Tauri).
// Primer arranque con la feature: muestra la versión actual una vez y sella; luego, solo al actualizar.
import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { tr } from "./i18n";
import { entriesSince, entryFor, bullets, type ChangelogEntry } from "./changelog";

const KEY = "koru_last_seen_version";

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
            <li key={i}>{b}</li>
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
