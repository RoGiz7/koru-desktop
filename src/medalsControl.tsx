// Control de Ajustes para las medallas de corp PINTADAS: elegir la SharedCache del cliente
// de EVE y extraer las texturas de las condecoraciones a app-data (decisión EULA: no se
// redistribuyen con Koru; cada usuario las saca de SU instalación). Sin extraer, la Bitácora
// enseña el marco genérico de siempre — esto solo añade el dibujo real.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { tr } from "./i18n";
import { resetMedalTextureCache } from "./medalArt";

const KEY = "koru-sharedcache-folder";

export function MedalTexturesControl({ onExtracted }: { onExtracted?: () => void }) {
  const [folder, setFolder] = useState<string>(() => localStorage.getItem(KEY) || "");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  useEffect(() => {
    invoke<boolean>("medal_textures_ready").then(setReady).catch(() => setReady(false));
    if (!folder) {
      // Autodetección best-effort (C:\EVE, CCP, ProgramData, Steam…); el picker es la garantía.
      invoke<string>("default_sharedcache_dir")
        .then((d) => {
          if (d) {
            setFolder(d);
            localStorage.setItem(KEY, d);
          }
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickFolder() {
    const dir = await openDialog({ directory: true }).catch(() => null);
    if (!dir || typeof dir !== "string") return;
    setFolder(dir);
    localStorage.setItem(KEY, dir);
  }

  async function runExtract() {
    setBusy(true);
    setResult("");
    try {
      const r = await invoke<{ sheets: number; skipped: number }>("extract_medal_textures", {
        sharedCache: folder,
      });
      setResult(`✓ ${r.sheets} ${tr("texturas listas")}`);
      setReady(true);
      resetMedalTextureCache(); // la Bitácora pinta el dibujo real sin reiniciar
      onExtracted?.();
    } catch (e) {
      setResult(`${tr("Error")}: ${String(e).slice(0, 140)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tb-settings-logs">
      <div className="small" style={{ fontWeight: 600 }}>
        🎖️ {tr("Medallas de corp (dibujo real)")}
      </div>
      <div className="small muted tb-settings-db" title={folder}>
        {folder || tr("SharedCache de EVE no detectada")}
      </div>
      <div className="tb-logs-row">
        <button className="pp-add" onClick={pickFolder}>
          📁 {tr("Carpeta SharedCache")}
        </button>
        <button className="pp-add" onClick={runExtract} disabled={busy || !folder}>
          {busy ? "⏳" : ready ? tr("Actualizar texturas") : tr("Preparar medallas")}
        </button>
      </div>
      <div className="small muted">
        {result || (ready ? `✓ ${tr("Texturas extraídas: la Bitácora pinta tus condecoraciones reales.")}` : tr("Extrae las texturas de tu instalación de EVE para ver tus condecoraciones dibujadas."))}
      </div>
    </div>
  );
}
