// Control de logs de EVE para Ajustes (rueda de config): elegir la carpeta madre `logs` (deriva
// Chatlogs para Intel + Gamelogs para todo lo demás), escanear con progreso y ver el estado.
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { tr } from "./i18n";

export function GamelogControl({ onScanned }: { onScanned?: () => void }) {
  const [folder, setFolder] = useState<string>(() => localStorage.getItem("koru-gamelog-folder") || "");
  const [parsed, setParsed] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [scan, setScan] = useState<{ running: boolean; done: number; total: number; result: string }>({
    running: false,
    done: 0,
    total: 0,
    result: "",
  });

  function refreshStatus() {
    invoke<number>("get_gamelog_status").then(setParsed).catch(() => setParsed(null));
    invoke<boolean>("get_logi_reparse_pending").then(setPending).catch(() => setPending(false));
  }
  useEffect(() => {
    if (!folder) {
      invoke<string>("default_gamelogs_dir")
        .then((d) => {
          if (d) {
            setFolder(d);
            localStorage.setItem("koru-gamelog-folder", d);
          }
        })
        .catch(() => {});
    }
    refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickFolder() {
    const dir = await openDialog({ directory: true }).catch(() => null);
    if (!dir || typeof dir !== "string") return;
    // El usuario elige la carpeta "logs" (madre). Derivamos Gamelogs + Chatlogs en un clic.
    const sep = dir.includes("\\") ? "\\" : "/";
    const parts = dir.split(sep).filter(Boolean);
    const base = parts[parts.length - 1] || "";
    const root = base === "Gamelogs" || base === "Chatlogs" ? dir.slice(0, dir.length - base.length - 1) : dir;
    const gl = `${root}${sep}Gamelogs`;
    const cl = `${root}${sep}Chatlogs`;
    setFolder(gl);
    localStorage.setItem("koru-gamelog-folder", gl);
    localStorage.setItem("koru-intel-folder", cl);
  }

  async function runScan() {
    setScan({ running: true, done: 0, total: 0, result: "" });
    const un = await listen<[number, number]>("gamelog_scan_progress", (e) => {
      setScan((s) => ({ ...s, done: e.payload[0], total: e.payload[1] }));
    });
    try {
      const r = await invoke<{ files_total: number; files_scanned: number; healed_hp: number }>("scan_gamelogs", {
        folder,
      });
      setScan({
        running: false,
        done: r.files_total,
        total: r.files_total,
        result: `${r.files_scanned} ${tr("nuevos")} · ${Math.round(r.healed_hp).toLocaleString()} HP`,
      });
      refreshStatus();
      onScanned?.();
    } catch (e) {
      setScan({ running: false, done: 0, total: 0, result: `${tr("Error al escanear")}: ${String(e).slice(0, 120)}` });
    } finally {
      un();
    }
  }

  return (
    <div className="tb-settings-logs">
      <div className="small" style={{ fontWeight: 600 }}>
        🗒️ {tr("Logs de EVE")}
      </div>
      <div className="small muted tb-settings-db" title={folder}>
        {folder || tr("Sin carpeta")}
      </div>
      <div className="tb-logs-row">
        <button className="pp-add" onClick={pickFolder}>
          📁 {tr("Carpeta de logs EVE")}
        </button>
        <button className="pp-add" onClick={runScan} disabled={scan.running || !folder}>
          {scan.running ? `⏳ ${scan.done}/${scan.total}` : tr("Escanear")}
        </button>
      </div>
      <div className="small muted">
        {scan.result
          ? scan.result
          : parsed === null
          ? ""
          : parsed > 0
          ? `✓ ${tr("Escaneado")} · ${parsed.toLocaleString()} ${tr("ficheros")}`
          : tr("Pendiente de escanear")}
      </div>
      {pending && (parsed ?? 0) > 0 && !scan.running && (
        <div className="small tb-logs-reparse">
          ♻️ {tr("Actualización de datos: reescanea para reprocesar tu histórico de logi.")}
        </div>
      )}
    </div>
  );
}
