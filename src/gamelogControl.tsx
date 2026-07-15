// Control de logs de EVE para Ajustes (rueda de config): elegir la carpeta madre `logs` (deriva
// Chatlogs para Intel + Gamelogs para todo lo demás), escanear con progreso y ver el estado.
import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { tr } from "./i18n";

/** "45 s" / "12 min" / "1 h 20 min". Redondea al alza: es una estimación, no una promesa. */
function fmtEta(secs: number): string {
  if (secs < 90) return `${Math.max(5, Math.ceil(secs / 5) * 5)} s`;
  const min = Math.ceil(secs / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

/** Candado compartido del escaneo de gamelogs.
 *
 *  Hay DOS escaneos: el de este panel (a mano) y el incremental que dispara el auto-sync (App.tsx).
 *  Los dos escriben los mismos offsets en `gamelog_parsed`; si corren a la vez se pisan. Vive en el
 *  módulo y no en el estado de React porque son dos componentes distintos que no se hablan. */
export const gamelogScan = { running: false };

export function GamelogControl({ onScanned }: { onScanned?: () => void }) {
  const [folder, setFolder] = useState<string>(() => localStorage.getItem("koru-gamelog-folder") || "");
  const [parsed, setParsed] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [scan, setScan] = useState<{
    running: boolean;
    done: number;
    total: number;
    bytes: number;
    bytesTotal: number;
    result: string;
  }>({ running: false, done: 0, total: 0, bytes: 0, bytesTotal: 0, result: "" });
  const [eta, setEta] = useState<number | null>(null); // segundos restantes estimados
  // Muestras (t, bytes) de los últimos ~60 s. El ritmo se mide en BYTES, no en ficheros: los de
  // `old/` son muchos y diminutos y los recientes pocos y enormes, así que contar ficheros daría
  // una estimación que salta de 4 min a 3 h. La ventana móvil además absorbe los altibajos de disco.
  const samples = useRef<{ t: number; bytes: number }[]>([]);

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
    if (gamelogScan.running) return; // ya hay uno (quizá el automático del sync): no se pisan
    gamelogScan.running = true;
    setScan({ running: true, done: 0, total: 0, bytes: 0, bytesTotal: 0, result: "" });
    setEta(null);
    samples.current = [{ t: Date.now(), bytes: 0 }];
    const un = await listen<[number, number, number, number]>("gamelog_scan_progress", (e) => {
      const [done, total, bytes, bytesTotal] = e.payload;
      setScan((s) => ({ ...s, done, total, bytes, bytesTotal }));
      const now = Date.now();
      const s = samples.current;
      s.push({ t: now, bytes });
      while (s.length > 2 && now - s[0].t > 60_000) s.shift(); // ventana de 60 s
      const first = s[0];
      const dt = (now - first.t) / 1000;
      const db = bytes - first.bytes;
      // Con menos de 10 s de historia, o sin bytes totales, el ritmo es ruido: no enseñamos nada.
      setEta(dt >= 10 && db > 0 && bytesTotal > 0 ? Math.round(((bytesTotal - bytes) * dt) / db) : null);
    });
    try {
      const r = await invoke<{ files_total: number; files_scanned: number; healed_hp: number }>("scan_gamelogs", {
        folder,
      });
      setScan((s) => ({
        ...s,
        running: false,
        done: r.files_total,
        total: r.files_total,
        result: `${r.files_scanned} ${tr("nuevos")} · ${Math.round(r.healed_hp).toLocaleString()} HP`,
      }));
      setEta(null);
      refreshStatus();
      onScanned?.();
    } catch (e) {
      setScan({
        running: false,
        done: 0,
        total: 0,
        bytes: 0,
        bytesTotal: 0,
        result: `${tr("Error al escanear")}: ${String(e).slice(0, 120)}`,
      });
    } finally {
      gamelogScan.running = false;
      un();
    }
  }

  // % por bytes (trabajo real). Si el backend aún no ha mandado el total, caemos a ficheros.
  const pct =
    scan.bytesTotal > 0
      ? (scan.bytes / scan.bytesTotal) * 100
      : scan.total > 0
      ? (scan.done / scan.total) * 100
      : 0;

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
      {scan.running && scan.total > 0 && (
        <div className="gl-scan-progress">
          <div className="gl-scan-bar">
            {/* El avance real es el de bytes leídos, no el de ficheros. */}
            <span style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <div className="small muted">
            {Math.round(pct)}% · {eta === null ? tr("calculando…") : `${fmtEta(eta)} ${tr("restantes")}`}
          </div>
        </div>
      )}
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
