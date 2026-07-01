import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { save, open as openDialog, message, confirm as dialogConfirm } from "@tauri-apps/plugin-dialog";
import { tr, setLang as setI18nLang, type Lang } from "./i18n";
import "./App.css";
import { fmtAgo, fmtMMSS, fmtIsk, fmtSp, fmtBytes, shipIcon, zkillUrl, secColor, standingColor, typeIcon } from "./format";
import { Kpi, Bars, MultiLineProgress, Donut, Th, DONUT_COLORS, TypeIcon, TopList } from "./charts";
import { FitsView, ShipFit, FIT_SLOTS_RE } from "./fit";
import { MapView } from "./map";
import { CazadorView } from "./cazador";
import { loadNewEden } from "./neweden";
import {
  FEATURES,
  SCOPE,
  CAPS,
  KM_LIMIT,
  AUTO_SYNC_MS,
  NAV,
  TAB_HEAD,
  FW_FACTIONS,
} from "./constants";
import type { Tab, MapOverlay } from "./constants";
import type {
  Character,
  LoginOutcome,
  CharacterCard,
  KillmailRow,
  PvpStats,
  PvpTrendPoint,
  WalletView,
  WalletSeries,
  WalletCatDay,
  WalletCharDay,
  NetworthPoint,
  NetworthView,
  SkillsSummary,
  GlobalSkills,
  AssetsSummary,
  AssetDetail,
  JobView,
  SysActivity,
  Battle,
  RivalEntry,
  Rivals,
  AssetSystem,
  SovSystem,
  FwSystem,
  Incursion,
  ServerStatus,
  MarketOrder,
  TradePnl,
  WatchItem,
  ArbItem,
  Planet,
  RattingDetail,
  SpecialRatsResult,
  FinancialSummary,
  CategorySum,
  PvpActivity,
  MiningSeries,
  MineDimDay,
  CharacterDetail,
  FactionalView as FactionalData,
  AbyssalsData,
  PaperSeries,
  ImportResult,
  ContactRow,
  StandingRow,
  WhConn,
  IntelLine,
} from "./types";

/* ---------- relojes/contadores aislados (tic propio para NO re-renderizar toda la app) ---------- */
// Hook de "ahora" con su propio intervalo, encapsulado en componentes pequeños de la barra de estado.
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
function EveClock() {
  const now = useNow(1000);
  return (
    <span className="sb-badge" title={tr("Hora EVE (UTC)")}>
      🕓 {new Date(now).toISOString().substring(11, 16)} EVE
    </span>
  );
}
function SyncBadge({ lastSync, autoBusy }: { lastSync: number | null; autoBusy: boolean }) {
  const now = useNow(1000);
  return (
    <span className="sb-badge" title={tr("Estado de la sincronización automática")}>
      <span className={`sb-dot ${autoBusy ? "busy" : ""}`} />
      {autoBusy
        ? tr("Sincronizando…")
        : lastSync
          ? `${tr("Sync")} ${fmtAgo(now - lastSync)} · ${tr("próxima")} ${fmtMMSS(lastSync + AUTO_SYNC_MS - now)}`
          : tr("Sin sincronizar")}
    </span>
  );
}
function LastSyncText({ lastSync }: { lastSync: number }) {
  const now = useNow(15000); // resolución de minutos: 15s sobra
  return <>{`${tr("Listo · última sincronización")} ${fmtAgo(now - lastSync)}`}</>;
}

/* ---------- app ---------- */
function App() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [cards, setCards] = useState<Record<number, CharacterCard>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feature, setFeature] = useState("core");
  const [loginOpen, setLoginOpen] = useState(false); // panel "conceder acceso" colapsable
  const [settingsOpen, setSettingsOpen] = useState(false); // desplegable ⚙️ Ajustes (datos/backup)
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  // Importador de histórico CSV (corptools) — vive en ⚙️ Ajustes para no tenerlo siempre a mano.
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);
  // Posición calculada del popup (fixed) para que nunca se salga del viewport, caiga donde
  // caiga el botón ⚙️ (la topbar se reordena en ventanas estrechas).
  const [settingsPos, setSettingsPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [dbInfo, setDbInfo] = useState<{ path: string; size: number } | null>(null);
  const [lastBackup, setLastBackup] = useState<number | null>(() => {
    const v = localStorage.getItem("koru-last-backup");
    return v ? Number(v) : null;
  });
  // Copias automáticas (config persistida en localStorage).
  const [autoBkEnabled, setAutoBkEnabled] = useState<boolean>(
    () => localStorage.getItem("koru-autobackup-enabled") === "1"
  );
  const [autoBkDir, setAutoBkDir] = useState<string | null>(
    () => localStorage.getItem("koru-autobackup-dir")
  );
  const [autoBkFreq, setAutoBkFreq] = useState<string>(
    () => localStorage.getItem("koru-autobackup-freq") || "daily"
  );
  const [autoBkKeep, setAutoBkKeep] = useState<number>(
    () => Number(localStorage.getItem("koru-autobackup-keep") ?? 7)
  );
  const [autoBkLast, setAutoBkLast] = useState<number | null>(() => {
    const v = localStorage.getItem("koru-autobackup-last");
    return v ? Number(v) : null;
  });
  const ranStartupBackup = useRef(false);
  // Estado del servidor EVE (Tranquility)
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [serverOffline, setServerOffline] = useState(false);
  useEffect(() => {
    const load = () =>
      invoke<ServerStatus>("get_server_status")
        .then((s) => {
          setServerStatus(s);
          setServerOffline(false);
        })
        .catch(() => {
          setServerStatus(null);
          setServerOffline(true);
        });
    load();
    const id = window.setInterval(load, 120_000); // refresco cada 2 min
    return () => window.clearInterval(id);
  }, []);
  // Auto-actualización
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const pendingUpdate = useRef<Update | null>(null);
  useEffect(() => {
    // Comprueba si hay una versión más nueva publicada en Releases.
    // Defensa en capas: al arrancar + cada 6h + al recuperar el foco de la ventana.
    // En cuanto encuentra una, deja de comprobar (pendingUpdate ya seteado).
    let cancelled = false;
    const run = async () => {
      if (pendingUpdate.current) return; // ya hay una actualización pendiente
      try {
        const update = await check();
        if (!cancelled && update) {
          pendingUpdate.current = update;
          setUpdateVersion(update.version);
        }
      } catch {
        // sin conexión / sin endpoint: ignorar silenciosamente
      }
    };
    run(); // al arrancar
    const id = setInterval(run, 6 * 60 * 60 * 1000); // cada 6 horas
    const onFocus = () => run(); // al volver el foco a la ventana
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  async function handleUpdate() {
    const update = pendingUpdate.current;
    if (!update) return;
    setUpdating(true);
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch (e) {
      setError(String(e));
      setUpdating(false);
    }
  }

  // Calcula la posición del popup de Ajustes anclándolo al botón pero recortándolo al
  // viewport (así no se corta por ningún borde, esté el ⚙️ a la derecha o haya bajado de fila).
  function computeSettingsPos() {
    const btn = settingsBtnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 16);
    let left = r.right - width; // alinear borde derecho del popup con el del botón
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    setSettingsPos({ top: r.bottom + 4, left, width });
  }
  function openSettings() {
    computeSettingsPos();
    setSettingsOpen(true);
    // Cargar ruta/tamaño de la BD para mostrarlos en el menú.
    invoke<{ path: string; size: number }>("db_info")
      .then(setDbInfo)
      .catch(() => setDbInfo(null));
  }
  async function handleOpenDataFolder() {
    try {
      if (dbInfo?.path) await revealItemInDir(dbInfo.path);
    } catch (e) {
      setError(String(e));
    }
  }

  // --- Copias automáticas ---
  function setAutoBk(key: string, value: string) {
    localStorage.setItem(`koru-autobackup-${key}`, value);
  }
  async function chooseAutoBkDir() {
    try {
      const dir = await openDialog({
        title: tr("Elegir carpeta de copias automáticas"),
        directory: true,
        multiple: false,
      });
      if (dir && typeof dir === "string") {
        setAutoBkDir(dir);
        setAutoBk("dir", dir);
      }
    } catch (e) {
      setError(String(e));
    }
  }
  // Dispara una copia automática si está activada, hay carpeta y toca según la frecuencia.
  // Se evalúa al arrancar y cada hora. Errores (carpeta no disponible) se ignoran en silencio.
  useEffect(() => {
    if (!autoBkEnabled || !autoBkDir) return;
    const isDue = (now: number) => {
      if (autoBkFreq === "startup") return !ranStartupBackup.current;
      const interval = autoBkFreq === "weekly" ? 7 * 864e5 : 864e5; // semanal o diario
      return !autoBkLast || now - autoBkLast >= interval;
    };
    const run = async () => {
      const now = Date.now();
      if (!isDue(now)) return;
      try {
        await invoke<string>("auto_backup", { dir: autoBkDir, keep: autoBkKeep });
        ranStartupBackup.current = true;
        setAutoBk("last", String(now));
        setAutoBkLast(now);
        // refleja también en "Última copia" del menú
        localStorage.setItem("koru-last-backup", String(now));
        setLastBackup(now);
      } catch {
        // carpeta inaccesible (nube sin montar, USB fuera…): reintentará en la próxima vuelta
      }
    };
    run();
    const id = window.setInterval(run, 60 * 60 * 1000); // re-evaluar cada hora
    return () => window.clearInterval(id);
  }, [autoBkEnabled, autoBkDir, autoBkFreq, autoBkKeep, autoBkLast]);
  // Recalcular si cambia el tamaño de la ventana con el menú abierto.
  useEffect(() => {
    if (!settingsOpen) return;
    const on = () => computeSettingsPos();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [settingsOpen]);

  // --- Copia de seguridad / restauración del histórico local ---
  // Exporta la BD (un único .sqlite3) o la restaura desde un backup. Todo el histórico vive
  // solo en local, así que esto es el "seguro" del modelo local-first.
  async function handleBackup() {
    setSettingsOpen(false);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const dest = await save({
        title: tr("Crear copia de seguridad"),
        defaultPath: `koru-backup-${today}.sqlite3`,
        filters: [{ name: "Koru backup", extensions: ["sqlite3"] }],
      });
      if (!dest) return; // cancelado
      const written = await invoke<string>("backup_db", { dest });
      const now = Date.now();
      localStorage.setItem("koru-last-backup", String(now));
      setLastBackup(now);
      await message(`${tr("Copia de seguridad creada")}:\n${written}`, { title: "Koru", kind: "info" });
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleRestore() {
    setSettingsOpen(false);
    try {
      const src = await openDialog({
        title: tr("Restaurar copia de seguridad"),
        multiple: false,
        directory: false,
        filters: [{ name: "Koru backup", extensions: ["sqlite3"] }],
      });
      if (!src || typeof src !== "string") return; // cancelado
      const ok = await dialogConfirm(tr("Esto reemplazará TODOS tus datos actuales. ¿Seguro?"), {
        title: tr("Restaurar copia de seguridad"),
        kind: "warning",
      });
      if (!ok) return;
      // restore_db deja la copia en staging y reinicia la app para aplicarla (la BD no se
      // puede reemplazar en caliente). El proceso se reinicia, así que no esperamos respuesta.
      await invoke("restore_db", { src });
    } catch (e) {
      setError(String(e));
    }
  }

  async function doImportCsv() {
    const sel = await openDialog({
      title: tr("Importar CSV de wallet (corptools)"),
      filters: [{ name: "CSV", extensions: ["csv"] }],
      multiple: false,
      directory: false,
    });
    if (!sel || typeof sel !== "string") return;
    setImporting(true);
    setImportErr(null);
    setImportResult(null);
    try {
      const res = await invoke<ImportResult>("import_wallet_csv", { path: sel });
      setImportResult(res);
      loadTab(subject, tab, true); // refresca la vista actual (wallet/patrimonio) en segundo plano
    } catch (e) {
      setImportErr(String(e));
    } finally {
      setImporting(false);
    }
  }

  // Tema visual seleccionable (persistido en local). "nebula" = por defecto.
  const [theme, setTheme] = useState<string>(
    () => localStorage.getItem("koru-theme") || "nebula"
  );
  useEffect(() => {
    if (theme === "nebula") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("koru-theme", theme);
  }, [theme]);

  // Idioma (ES por defecto), persistido en local. tr() traduce textos de "chrome".
  const [lang, setLang] = useState<Lang>(
    () => (localStorage.getItem("koru-lang") as Lang) || "es"
  );
  useEffect(() => {
    localStorage.setItem("koru-lang", lang);
    document.documentElement.lang = lang;
  }, [lang]);
  setI18nLang(lang); // fija el idioma activo a nivel de módulo → todas las vistas usan tr()

  // Sujeto activo: "global" (por defecto) o el id de un personaje. Filtro central.
  const [subject, setSubject] = useState<number | "global">("global");
  const [tab, setTab] = useState<Tab>("resumen");
  const [sectionBusy, setSectionBusy] = useState(false);
  const [progress, setProgress] = useState<{ processed: number; page: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [mapOverlay, setMapOverlay] = useState<MapOverlay>("ubicacion");

  // Datos del sujeto activo (unificados).
  const [stats, setStats] = useState<PvpStats | null>(null);
  const [pvpTrend, setPvpTrend] = useState<PvpTrendPoint[] | null>(null);
  const [assetsDetail, setAssetsDetail] = useState<AssetDetail[] | null>(null);
  const [marketOrders, setMarketOrders] = useState<MarketOrder[] | null>(null);
  const [planets, setPlanets] = useState<Planet[] | null>(null);
  const [ratting, setRatting] = useState<RattingDetail | null>(null);
  const [specialRats, setSpecialRats] = useState<SpecialRatsResult | null>(null);
  const [walletData, setWalletData] = useState<WalletView | null>(null);
  const [walletSeries, setWalletSeries] = useState<WalletSeries | null>(null);
  const [networthData, setNetworthData] = useState<NetworthView | null>(null);
  const [skillsData, setSkillsData] = useState<SkillsSummary | null>(null); // por personaje
  const [charDetail, setCharDetail] = useState<CharacterDetail | null>(null); // header rico
  const [factionalData, setFactionalData] = useState<FactionalData | null>(null);
  const [abyssalsData, setAbyssalsData] = useState<AbyssalsData | null>(null);
  const [paperSeries, setPaperSeries] = useState<PaperSeries | null>(null);
  // Piloto a preseleccionar en la sección Cazador (puente desde la ficha del mapa).
  const [cazadorPilot, setCazadorPilot] = useState<string | null>(null);
  // Petición de "pintar rastro en el mapa" desde la sección Cazador (nonce fuerza re-disparo).
  const [mapTrackReq, setMapTrackReq] = useState<{ name: string; nonce: number } | null>(null);
  const [contactsData, setContactsData] = useState<ContactRow[] | null>(null);
  const [standingsData, setStandingsData] = useState<StandingRow[] | null>(null);
  const [gSkills, setGSkills] = useState<GlobalSkills | null>(null); // global (otra forma)
  const [assetsData, setAssetsData] = useState<AssetsSummary | null>(null);
  const [jobsData, setJobsData] = useState<JobView[] | null>(null);
  const [mapData, setMapData] = useState<SysActivity[] | null>(null);
  const [assetsMap, setAssetsMap] = useState<Map<number, number> | null>(null);
  const [miningMap, setMiningMap] = useState<Map<number, number> | null>(null);
  const [sovMap, setSovMap] = useState<Map<number, SovSystem> | null>(null);
  const [fwMap, setFwMap] = useState<Map<number, FwSystem> | null>(null);
  const [incursions, setIncursions] = useState<Incursion[] | null>(null);
  const [theraConns, setTheraConns] = useState<WhConn[] | null>(null);
  const [assetQuery, setAssetQuery] = useState(""); // búsqueda prefijada de Assets (p. ej. desde el mapa)
  // --- Intel en vivo (logs de chat) ---
  const [intelLines, setIntelLines] = useState<IntelLine[]>([]);
  const [intelAvailChannels, setIntelAvailChannels] = useState<string[]>([]);
  const [intelFolder, setIntelFolder] = useState<string>(() => localStorage.getItem("koru-intel-folder") || "");
  const [intelChannels, setIntelChannels] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("koru-intel-channels") || "[]");
    } catch {
      return [];
    }
  });
  const [intelRecency, setIntelRecency] = useState<number>(() => Number(localStorage.getItem("koru-intel-recency") ?? 30));
  const [intelAlertJumps, setIntelAlertJumps] = useState<number>(() => Number(localStorage.getItem("koru-intel-alert") ?? 5));
  const [intelSound, setIntelSound] = useState<boolean>(() => localStorage.getItem("koru-intel-sound") !== "0");
  const [intelSoundChoice, setIntelSoundChoice] = useState<string>(() => localStorage.getItem("koru-intel-sound-choice") || "double");
  const [intelSoundFile, setIntelSoundFile] = useState<string>(() => localStorage.getItem("koru-intel-sound-file") || "");
  const [intelAnchors, setIntelAnchors] = useState<number[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("koru-intel-anchors") || "[]");
    } catch {
      return [];
    }
  });
  const [intelOnlyRange, setIntelOnlyRange] = useState<boolean>(() => localStorage.getItem("koru-intel-onlyrange") === "1");
  // Interruptor maestro "Intel en vivo": si está ON, el vigilante sigue corriendo aunque mires otras
  // secciones de Koru (no depende de tener abierta la capa intel del mapa). Persistido.
  const [intelLive, setIntelLive] = useState<boolean>(() => {
    const v = localStorage.getItem("koru-intel-live");
    if (v != null) return v === "1";
    // Migración: quien ya tenía canales configurados → activado por defecto.
    try {
      return (JSON.parse(localStorage.getItem("koru-intel-channels") || "[]") as string[]).length > 0;
    } catch {
      return false;
    }
  });
  function toggleIntelLive(v?: boolean) {
    setIntelLive((prev) => {
      const nv = v ?? !prev;
      localStorage.setItem("koru-intel-live", nv ? "1" : "0");
      return nv;
    });
  }
  // Aviso flotante global (toast): visible en cualquier sección cuando salta intel. El sonido y la
  // notificación nativa los dispara MapView/Rust; aquí solo mostramos el toast.
  const [globalAlert, setGlobalAlert] = useState<string | null>(null);
  const globalAlertTimer = useRef<number | null>(null);
  function showGlobalAlert(text: string) {
    setGlobalAlert(text);
    if (globalAlertTimer.current) window.clearTimeout(globalAlertTimer.current);
    globalAlertTimer.current = window.setTimeout(() => setGlobalAlert(null), 12000);
  }
  // Sembrar carpeta por defecto la primera vez.
  useEffect(() => {
    if (!intelFolder) {
      invoke<string>("default_chatlogs_dir")
        .then((d) => {
          if (d) {
            setIntelFolder(d);
            localStorage.setItem("koru-intel-folder", d);
          }
        })
        .catch(() => {});
    }
  }, []);
  // Canales disponibles (para el selector) cuando hay carpeta + capa intel activa.
  useEffect(() => {
    if (mapOverlay !== "intel" || !intelFolder) return;
    invoke<string[]>("intel_channels", { folder: intelFolder })
      .then(setIntelAvailChannels)
      .catch(() => setIntelAvailChannels([]));
  }, [mapOverlay, intelFolder]);
  // El intel lo vigila ahora un hilo en Rust (start_intel_watch en MapView): emite el evento
  // "intel-lines" que escuchamos aquí para pintar mapa/feed, sin polling JS (no se ralentiza
  // minimizado). Las alertas + notificación nativa las dispara el propio hilo de Rust.
  useEffect(() => {
    const un = listen<IntelLine[]>("intel-lines", (e) => setIntelLines(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, []);
  function setIntelCfg(patch: {
    channels?: string[];
    recency?: number;
    alertJumps?: number;
    sound?: boolean;
    folder?: string;
    anchors?: number[];
    onlyRange?: boolean;
    soundChoice?: string;
    soundFile?: string;
  }) {
    if (patch.channels !== undefined) {
      setIntelChannels(patch.channels);
      localStorage.setItem("koru-intel-channels", JSON.stringify(patch.channels));
    }
    if (patch.recency !== undefined) {
      setIntelRecency(patch.recency);
      localStorage.setItem("koru-intel-recency", String(patch.recency));
    }
    if (patch.alertJumps !== undefined) {
      setIntelAlertJumps(patch.alertJumps);
      localStorage.setItem("koru-intel-alert", String(patch.alertJumps));
    }
    if (patch.sound !== undefined) {
      setIntelSound(patch.sound);
      localStorage.setItem("koru-intel-sound", patch.sound ? "1" : "0");
    }
    if (patch.folder !== undefined) {
      setIntelFolder(patch.folder);
      localStorage.setItem("koru-intel-folder", patch.folder);
    }
    if (patch.anchors !== undefined) {
      setIntelAnchors(patch.anchors);
      localStorage.setItem("koru-intel-anchors", JSON.stringify(patch.anchors));
    }
    if (patch.onlyRange !== undefined) {
      setIntelOnlyRange(patch.onlyRange);
      localStorage.setItem("koru-intel-onlyrange", patch.onlyRange ? "1" : "0");
    }
    if (patch.soundChoice !== undefined) {
      setIntelSoundChoice(patch.soundChoice);
      localStorage.setItem("koru-intel-sound-choice", patch.soundChoice);
    }
    if (patch.soundFile !== undefined) {
      setIntelSoundFile(patch.soundFile);
      localStorage.setItem("koru-intel-sound-file", patch.soundFile);
    }
  }
  async function pickIntelSound() {
    try {
      const f = await openDialog({
        title: "Sonido de alerta",
        multiple: false,
        filters: [{ name: "Audio", extensions: ["wav", "mp3", "ogg", "flac", "m4a", "aac"] }],
      });
      if (f && typeof f === "string") setIntelCfg({ soundFile: f, soundChoice: "custom" });
    } catch (e) {
      setError(String(e));
    }
  }
  async function pickIntelFolder() {
    try {
      const dir = await openDialog({ title: "Carpeta de Chatlogs", directory: true, multiple: false });
      if (dir && typeof dir === "string") setIntelCfg({ folder: dir });
    } catch (e) {
      setError(String(e));
    }
  }
  const [factionStd, setFactionStd] = useState<Map<number, number> | null>(null); // faction_id -> standing
  const [rivalsData, setRivalsData] = useState<Rivals | null>(null);
  const [battlesData, setBattlesData] = useState<Battle[] | null>(null);

  // Tabla de killmails paginada/filtrada
  const [kmRows, setKmRows] = useState<KillmailRow[]>([]);
  const [kmTotal, setKmTotal] = useState(0);
  const [kmKind, setKmKind] = useState<"all" | "kill" | "loss">("all");
  const [kmOffset, setKmOffset] = useState(0);

  // Auto-sincronización
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);

  const isGlobal = subject === "global";

  async function loadKillmails(subj: number | "global", kind: "all" | "kill" | "loss", offset: number) {
    try {
      const characterId = subj === "global" ? null : subj;
      const page = await invoke<{ rows: KillmailRow[]; total: number }>("get_killmails", {
        characterId,
        kind,
        offset,
        limit: KM_LIMIT,
      });
      setKmRows(page.rows);
      setKmTotal(page.total);
      setKmOffset(offset);
      setKmKind(kind);
    } catch (e) {
      setError(String(e));
    }
  }

  async function refresh() {
    try {
      const list = await invoke<Character[]>("list_characters");
      setCharacters(list);
      invoke<CharacterCard[]>("get_character_cards")
        .then((cs) => {
          const m: Record<number, CharacterCard> = {};
          for (const c of cs) m[c.character_id] = c;
          setCards(m);
        })
        .catch(() => {});
    } catch (e) {
      setError(String(e));
    }
  }

  function resetData() {
    setStats(null);
    setPvpTrend(null);
    setAssetsDetail(null);
    setMarketOrders(null);
    setPlanets(null);
    setRatting(null);
    setWalletData(null);
    setWalletSeries(null);
    setSkillsData(null);
    setCharDetail(null);
    setFactionalData(null);
    setAbyssalsData(null);
    setPaperSeries(null);
    setContactsData(null);
    setStandingsData(null);
    setGSkills(null);
    setAssetsData(null);
    setJobsData(null);
    setMapData(null);
    setAssetsMap(null);
    setMiningMap(null);
    setFactionStd(null);
    setRivalsData(null);
    setBattlesData(null);
  }

  async function loadAssetsMap(subj: number | "global") {
    try {
      const rows =
        subj === "global"
          ? await invoke<AssetSystem[]>("get_assets_map_global")
          : await invoke<AssetSystem[]>("get_assets_map", { characterId: subj });
      const m = new Map<number, number>();
      for (const r of rows) m.set(r.system_id, r.count);
      setAssetsMap(m);
    } catch (e) {
      setError(String(e));
    }
  }

  async function loadMiningMap(subj: number | "global") {
    try {
      const rows =
        subj === "global"
          ? await invoke<AssetSystem[]>("get_mining_map_global")
          : await invoke<AssetSystem[]>("get_mining_map", { characterId: subj });
      const m = new Map<number, number>();
      for (const r of rows) m.set(r.system_id, r.count);
      setMiningMap(m);
    } catch (e) {
      setError(String(e));
    }
  }

  async function loadSov() {
    try {
      const rows = await invoke<SovSystem[]>("get_sov_systems");
      const m = new Map<number, SovSystem>();
      for (const r of rows) m.set(r.system_id, r);
      setSovMap(m);
    } catch (e) {
      setError(String(e));
    }
  }

  async function loadFw() {
    try {
      const rows = await invoke<FwSystem[]>("get_fw_systems");
      const m = new Map<number, FwSystem>();
      for (const r of rows) m.set(r.solar_system_id, r);
      setFwMap(m);
    } catch (e) {
      setError(String(e));
    }
  }

  async function loadIncursions() {
    try {
      setIncursions(await invoke<Incursion[]>("get_incursions"));
    } catch (e) {
      setError(String(e));
    }
  }

  async function loadThera() {
    try {
      setTheraConns(await invoke<WhConn[]>("get_thera_connections"));
    } catch (e) {
      setError(String(e));
    }
  }

  // Standings con facciones NPC del personaje activo (para la capa de standings del mapa).
  async function loadFactionStd(subj: number | "global") {
    if (subj === "global") {
      setFactionStd(new Map());
      return;
    }
    try {
      const rows = await invoke<StandingRow[]>("get_standings", { characterId: subj });
      const m = new Map<number, number>();
      for (const r of rows) if (r.kind === "faction") m.set(r.id, r.standing);
      setFactionStd(m);
    } catch {
      setFactionStd(new Map());
    }
  }

  function handleOverlayChange(o: MapOverlay) {
    setMapOverlay(o);
    if (o === "assets" && !assetsMap) loadAssetsMap(subject);
    if (o === "mineria" && !miningMap) loadMiningMap(subject);
    if (o === "soberania" && !sovMap) loadSov();
    if (o === "fw" && !fwMap) loadFw();
    if (o === "incursion" && !incursions) loadIncursions();
    if (o === "wormholes" && !theraConns) loadThera();
    if (o === "standings" && !factionStd) loadFactionStd(subject);
  }

  async function loadMap(subj: number | "global") {
    try {
      const d =
        subj === "global"
          ? await invoke<SysActivity[]>("get_pvp_map_global")
          : await invoke<SysActivity[]>("get_pvp_map", { characterId: subj });
      setMapData(d);
    } catch (e) {
      setError(String(e));
    }
  }

  // `silent` = refresco en segundo plano (tras un sync): NO muestra el skeleton de carga ni
  // borra/lanza errores, para no resetear scroll/selección ni interrumpir al usuario.
  async function loadTab(subj: number | "global", t: Tab, silent = false) {
    if (!silent) {
      setError(null);
      setSectionBusy(true);
    }
    try {
      if (subj === "global") {
        if (t === "pvp") {
          setStats(await invoke<PvpStats>("get_pvp_stats_global"));
          setPvpTrend(await invoke<PvpTrendPoint[]>("get_pvp_trend_global"));
        }
        if (t === "rivales") setRivalsData(await invoke<Rivals>("get_rivals", { characterId: null }));
        if (t === "batallas") setBattlesData(await invoke<Battle[]>("get_battles", { characterId: null }));
        if (t === "patrimonio") setNetworthData(await invoke<NetworthView>("get_networth_global"));
        if (t === "wallet") {
          setWalletData(await invoke<WalletView>("get_wallet_global"));
          invoke<WalletSeries>("get_wallet_series_global").then(setWalletSeries).catch(() => {});
        }
        if (t === "skills") setGSkills(await invoke<GlobalSkills>("get_skills_global"));
        if (t === "assets") {
          setAssetsData(await invoke<AssetsSummary>("get_assets_global"));
          setAssetsDetail(await invoke<AssetDetail[]>("get_assets_detail_global"));
        }
        if (t === "comercio") setMarketOrders(await invoke<MarketOrder[]>("get_market_orders_global"));
        if (t === "planetologia") setPlanets(await invoke<Planet[]>("get_planets_global"));
        if (t === "rateo") {
          setRatting(await invoke<RattingDetail>("get_ratting_global"));
          setSpecialRats(null);
          invoke<SpecialRatsResult>("get_special_rats", { characterId: null })
            .then(setSpecialRats)
            .catch(() => setSpecialRats(null));
          // Papeles (estimado): serie global; el inventario por ubicación es por personaje (null en global).
          setAbyssalsData(null);
          invoke<PaperSeries>("get_paper_series_global")
            .then(setPaperSeries)
            .catch(() => setPaperSeries(null));
        }
        if (t === "industria") {
          setJobsData(await invoke<JobView[]>("get_industry_global"));
        }
      } else {
        const characterId = subj;
        if (t === "pvp") {
          setStats(await invoke<PvpStats>("get_pvp_stats", { characterId }));
          setPvpTrend(await invoke<PvpTrendPoint[]>("get_pvp_trend", { characterId }));
        }
        if (t === "rivales") setRivalsData(await invoke<Rivals>("get_rivals", { characterId }));
        if (t === "batallas") setBattlesData(await invoke<Battle[]>("get_battles", { characterId }));
        if (t === "patrimonio") setNetworthData(await invoke<NetworthView>("get_networth", { characterId }));
        if (t === "wallet") {
          setWalletData(await invoke<WalletView>("get_wallet", { characterId }));
          invoke<WalletSeries>("get_wallet_series", { characterId })
            .then(setWalletSeries)
            .catch(() => {});
        }
        if (t === "skills") {
          setSkillsData(await invoke<SkillsSummary>("get_skills", { characterId }));
          invoke<CharacterDetail>("get_character_detail", { characterId })
            .then(setCharDetail)
            .catch(() => setCharDetail(null));
        }
        if (t === "assets") {
          setAssetsData(await invoke<AssetsSummary>("get_assets", { characterId }));
          setAssetsDetail(await invoke<AssetDetail[]>("get_assets_detail", { characterId }));
        }
        if (t === "comercio") setMarketOrders(await invoke<MarketOrder[]>("get_market_orders", { characterId }));
        if (t === "planetologia") setPlanets(await invoke<Planet[]>("get_planets", { characterId }));
        if (t === "rateo") {
          setRatting(await invoke<RattingDetail>("get_ratting", { characterId }));
          setSpecialRats(null);
          invoke<SpecialRatsResult>("get_special_rats", { characterId })
            .then(setSpecialRats)
            .catch(() => setSpecialRats(null));
          // Papeles (estimado): serie + inventario por ubicación (get_abyssals acumula el snapshot diario).
          invoke<PaperSeries>("get_paper_series", { characterId })
            .then(setPaperSeries)
            .catch(() => setPaperSeries(null));
          invoke<AbyssalsData>("get_abyssals", { characterId })
            .then(setAbyssalsData)
            .catch(() => setAbyssalsData(null));
        }
        if (t === "factional")
          setFactionalData(await invoke<FactionalData>("get_factional", { characterId }));
        if (t === "abyssals") {
          setAbyssalsData(await invoke<AbyssalsData>("get_abyssals", { characterId }));
          invoke<PaperSeries>("get_paper_series", { characterId })
            .then(setPaperSeries)
            .catch(() => setPaperSeries(null));
        }
        if (t === "contactos") {
          setContactsData(await invoke<ContactRow[]>("get_contacts", { characterId }));
          invoke<StandingRow[]>("get_standings", { characterId })
            .then(setStandingsData)
            .catch(() => setStandingsData([]));
        }
        if (t === "industria") {
          const c = characters.find((x) => x.character_id === subj);
          if (c?.scopes.includes(SCOPE.jobs))
            setJobsData(await invoke<JobView[]>("get_industry", { characterId }));
        }
      }
    } catch (e) {
      if (!silent) setError(String(e));
    } finally {
      if (!silent) setSectionBusy(false);
    }
  }

  // Titular PvP (para el dock), se carga siempre al cambiar de sujeto aunque la pestaña no sea PvP.
  async function loadHeadline(subj: number | "global") {
    try {
      const s =
        subj === "global"
          ? await invoke<PvpStats>("get_pvp_stats_global")
          : await invoke<PvpStats>("get_pvp_stats", { characterId: subj });
      setStats(s);
    } catch {
      /* silencioso */
    }
  }

  function changeSubject(subj: number | "global") {
    setSubject(subj);
    resetData();
    loadMap(subj);
    loadHeadline(subj);
    loadTab(subj, tab);
    if (tab === "pvp") loadKillmails(subj, kmKind, 0);
    if (mapOverlay === "standings") loadFactionStd(subj);
  }

  function changeTab(t: Tab) {
    setTab(t);
    if (t === "pvp") loadKillmails(subject, kmKind, 0);
    loadTab(subject, t);
  }

  async function runAutoSync() {
    if (autoBusy) return;
    setAutoBusy(true);
    try {
      await invoke<{ killmails: number; wallet: number; mining: number; prices: number; snapshots: number }>(
        "auto_sync"
      );
      setLastSync(Date.now());
      // refrescar la vista actual con lo nuevo, en segundo plano (sin skeleton ni resetear scroll)
      loadHeadline(subject);
      loadMap(subject);
      loadTab(subject, tab, true);
    } catch (e) {
      setError(String(e));
    } finally {
      setAutoBusy(false);
    }
  }

  // Ref siempre apuntando al runAutoSync actual (para que el timer use el sujeto/pestaña vigentes).
  const autoSyncRef = useRef(runAutoSync);
  autoSyncRef.current = runAutoSync;

  // Carga inicial: global por defecto + auto-sync.
  useEffect(() => {
    refresh();
    loadMap("global");
    loadHeadline("global");
    loadTab("global", "pvp");
    loadKillmails("global", "all", 0);
    runAutoSync();
    const sync = window.setInterval(() => autoSyncRef.current(), AUTO_SYNC_MS);
    return () => {
      window.clearInterval(sync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogin(feat?: string) {
    const useFeat = typeof feat === "string" ? feat : feature;
    setBusy(true);
    setError(null);
    try {
      await invoke<LoginOutcome>("login", { feature: useFeat });
      await refresh();
      loadMap(subject);
      loadTab(subject, tab);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelLogin() {
    // El backend deja de esperar el callback (~0.4s) → el login() rechaza y se desbloquea la UI.
    try {
      await invoke("cancel_login");
    } catch {
      /* noop */
    }
  }

  async function handleLogout(id: number) {
    setError(null);
    try {
      await invoke("logout", { characterId: id });
      if (subject === id) {
        changeSubject("global");
      }
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  /* Acciones PvP/Wallet sobre el personaje activo (id = subject cuando no es global) */
  async function handleSync(id: number) {
    setSectionBusy(true);
    setError(null);
    try {
      const n = await invoke<number>("sync_killmails", { characterId: id });
      await loadTab(id, "pvp");
      await loadMap(id);
      await loadKillmails(id, kmKind, 0);
      alert(`Sincronización completada. ${n} killmails nuevos.`);
    } catch (e) {
      setError(String(e));
    } finally {
      setSectionBusy(false);
    }
  }
  async function handleSyncFull(id: number) {
    setSectionBusy(true);
    setProgress({ processed: 0, page: 0 });
    setError(null);
    const start = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    const unlisten = await listen<[number, number]>("km_progress", (e) =>
      setProgress({ processed: e.payload[0], page: e.payload[1] })
    );
    try {
      const n = await invoke<number>("sync_killmails_full", { characterId: id });
      await loadTab(id, "pvp");
      await loadMap(id);
      await loadKillmails(id, kmKind, 0);
      alert(`Histórico sincronizado. ${n} killmails nuevos.`);
    } catch (e) {
      setError(String(e));
    } finally {
      unlisten();
      window.clearInterval(timer);
      setProgress(null);
      setSectionBusy(false);
    }
  }

  async function handleCancelSync() {
    try {
      await invoke("cancel_sync");
    } catch (e) {
      setError(String(e));
    }
  }
  async function handleReprocess(id: number) {
    setSectionBusy(true);
    setProgress({ processed: 0, page: 0 });
    setError(null);
    const unlisten = await listen<number>("reprocess_progress", (e) =>
      setProgress({ processed: e.payload, page: 0 })
    );
    try {
      const n = await invoke<number>("reprocess_killmails");
      await loadTab(id, "pvp");
      await loadMap(id);
      await loadKillmails(id, kmKind, 0);
      alert(`Reprocesados ${n} killmails (daño, final blow, nave víctima).`);
    } catch (e) {
      setError(String(e));
    } finally {
      unlisten();
      setProgress(null);
      setSectionBusy(false);
    }
  }

  async function handleExport(id: number, name: string) {
    setError(null);
    try {
      const csv = await invoke<string>("export_pvp_csv", { characterId: id });
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `pvp_${name}_${id}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleSyncMining(id: number) {
    setSectionBusy(true);
    setError(null);
    try {
      const n = await invoke<number>("sync_mining", { characterId: id });
      setMiningMap(null); // se recargará si el overlay de minería está activo
      if (mapOverlay === "mineria") loadMiningMap(id);
      alert(`Minería sincronizada. ${n} entradas guardadas/actualizadas.`);
    } catch (e) {
      setError(String(e));
    } finally {
      setSectionBusy(false);
    }
  }

  async function handleSyncWallet(id: number) {
    setSectionBusy(true);
    setError(null);
    try {
      const n = await invoke<number>("sync_wallet", { characterId: id });
      await loadTab(id, "wallet");
      alert(`Wallet sincronizada. ${n} movimientos nuevos.`);
    } catch (e) {
      setError(String(e));
    } finally {
      setSectionBusy(false);
    }
  }

  const activeCharObj = isGlobal ? null : characters.find((x) => x.character_id === subject) ?? null;
  const subjectScopes = activeCharObj?.scopes ?? [];
  const subjectId = typeof subject === "number" ? subject : 0;
  const subjectName = isGlobal ? "Global" : activeCharObj?.name ?? `#${subject}`;

  // ----- Barra de estado: actividad en curso (log inferior) -----
  const isSyncingHistory = progress !== null;
  const working = isSyncingHistory || autoBusy || busy || sectionBusy;
  let statusText: string;
  let liveSync = false;
  if (isSyncingHistory) {
    statusText = `${tr("Sincronizando histórico…")} ${fmtSp(progress!.processed)} killmails${
      progress!.page > 0 ? ` (${tr("página")} ${progress!.page})` : ""
    } · ${elapsed}s — ${tr("no cierres la app")}`;
  } else if (autoBusy) {
    statusText = tr("Sincronizando datos…");
  } else if (busy) {
    statusText = tr("Esperando inicio de sesión con EVE…");
  } else if (sectionBusy) {
    statusText = tr("Cargando sección…");
  } else if (error) {
    statusText = error;
  } else if (lastSync) {
    statusText = tr("Listo");
    liveSync = true;
  } else {
    statusText = tr("Listo");
  }

  return (
    <main className="shell">
      {/* ----- BARRA SUPERIOR (antes rail) ----- */}
      <header className="topbar">
        <div className="tb-brand">
          <h1>Koru</h1>
          <span className="muted small">EVE · stats</span>
        </div>

        <button
          className={`subject-global tb-global ${isGlobal ? "active" : ""}`}
          onClick={() => changeSubject("global")}
          title={tr("Vista global (todos los personajes)")}
        >
          🌌 {tr("Global")} <span className="muted">· {characters.length}</span>
        </button>

        <div className="tb-chars">
          {characters.length === 0 && <span className="muted small">Aún no hay personajes.</span>}
          {characters.map((c) => {
            const card = cards[c.character_id];
            const sel = subject === c.character_id;
            const missing = CAPS.filter((cap) => !c.scopes.includes(cap.scope));
            return (
              <div
                key={c.character_id}
                className={`pj-chip ${sel ? "selected" : ""}`}
                onClick={() => changeSubject(c.character_id)}
                title={missing.length ? `${c.name} · falta acceso: ${missing.map((m) => m.label).join(", ")}` : c.name}
              >
                <img
                  className="pj-portrait"
                  src={`https://images.evetech.net/characters/${c.character_id}/portrait?size=64`}
                  alt={c.name}
                />
                {missing.length > 0 && <span className="pj-warn" title={tr("Falta acceso a alguna sección")}>!</span>}
                {/* tarjeta expandida en hover */}
                <div className="pj-pop">
                  <img
                    className="pj-pop-portrait"
                    src={`https://images.evetech.net/characters/${c.character_id}/portrait?size=128`}
                    alt=""
                  />
                  <div className="pj-pop-info">
                    <strong className="mini-name">{c.name}</strong>
                    <div className="mini-line">
                      {card?.corporation_id && (
                        <img
                          className="corp-logo"
                          src={`https://images.evetech.net/corporations/${card.corporation_id}/logo?size=32`}
                          alt=""
                          title={card.corporation_name ?? ""}
                        />
                      )}
                      {card?.alliance_id && (
                        <img
                          className="corp-logo"
                          src={`https://images.evetech.net/alliances/${card.alliance_id}/logo?size=32`}
                          alt=""
                          title={card.alliance_name ?? ""}
                        />
                      )}
                      <span className="muted">{card?.corporation_name ?? "…"}</span>
                    </div>
                    <div className="mini-sys muted">
                      {card?.system_name ? `📍 ${card.system_name}` : ""}
                    </div>
                    {missing.length > 0 && (
                      <div className="pj-missing">
                        <span className="small">⚠️ {tr("Falta acceso")}: {missing.map((m) => m.label).join(", ")}</span>
                        <button
                          className="pj-addscope"
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleLogin("core");
                          }}
                          title={tr("Volver a iniciar sesión con el set completo para conceder los scopes que faltan")}
                        >
                          {busy ? tr("Esperando login…") : tr("Añadir acceso")}
                        </button>
                      </div>
                    )}
                    <button
                      className="danger pj-logout"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleLogout(c.character_id);
                      }}
                    >
                      Cerrar sesión
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="tb-spacer" />

        <select
          className="tb-theme"
          value={lang}
          onChange={(e) => setLang(e.target.value as Lang)}
          title={tr("Idioma")}
        >
          <option value="es">🇪🇸 ES</option>
          <option value="en">🇬🇧 EN</option>
        </select>

        <select
          className="tb-theme"
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          title={tr("Tema visual")}
        >
          <option value="nebula">🌌 Nebulosa</option>
          <option value="amarr">👑 Amarr</option>
          <option value="caldari">❄️ Caldari</option>
          <option value="gallente">🌿 Gallente</option>
          <option value="minmatar">🔥 Minmatar</option>
          <option value="abismo">🌀 Abismo</option>
        </select>

        {updateVersion && (
          <button
            className="tb-update"
            onClick={handleUpdate}
            disabled={updating}
            title={tr("Descargar e instalar la actualización y reiniciar")}
          >
            {updating ? tr("Actualizando…") : `⬇️ ${tr("Actualizar a")} v${updateVersion}`}
          </button>
        )}

        <button
          className="sync-now tb-sync"
          onClick={runAutoSync}
          disabled={autoBusy}
          title={tr("Sincronizar ahora")}
        >
          ⟳
        </button>

        <div className="tb-settings">
          <button
            ref={settingsBtnRef}
            className={`tb-settings-toggle ${settingsOpen ? "active" : ""}`}
            onClick={() => (settingsOpen ? setSettingsOpen(false) : openSettings())}
            title={tr("Ajustes")}
          >
            ⚙️
          </button>
          {settingsOpen && (
            <div
              className="tb-settings-pop"
              style={
                settingsPos
                  ? {
                      position: "fixed",
                      top: settingsPos.top,
                      left: settingsPos.left,
                      right: "auto",
                      width: settingsPos.width,
                    }
                  : undefined
              }
            >
              <div className="tb-settings-title small muted">{tr("Datos y copia de seguridad")}</div>
              <button className="tb-settings-item" onClick={handleBackup}>
                <span className="tb-si-ic">💾</span>
                <span className="tb-si-tx">
                  <strong>{tr("Crear copia de seguridad")}</strong>
                  <span className="small muted">
                    {tr("Guarda todo tu histórico local (PvP, wallet, minería, patrimonio) en un archivo.")}
                  </span>
                </span>
              </button>
              <button className="tb-settings-item" onClick={handleRestore}>
                <span className="tb-si-ic">↺</span>
                <span className="tb-si-tx">
                  <strong>{tr("Restaurar copia de seguridad")}</strong>
                  <span className="small muted">
                    {tr("Reemplaza tus datos actuales por los de una copia y reinicia la app.")}
                  </span>
                </span>
              </button>
              <button className="tb-settings-item" onClick={doImportCsv} disabled={importing}>
                <span className="tb-si-ic">📥</span>
                <span className="tb-si-tx">
                  <strong>
                    {importing ? tr("Importando…") : tr("Importar histórico (CSV corptools)")}
                  </strong>
                  <span className="small muted">
                    {tr("Backfillea años de wallet desde un export de corptools/Alliance Auth. No duplica al reimportar.")}
                  </span>
                </span>
              </button>
              {importErr && <div className="tb-settings-item-msg fits-err small">{importErr}</div>}
              {importResult && (
                <div className="tb-settings-item-msg small muted">
                  ✅ {fmtSp(importResult.imported)} {tr("movimientos nuevos")}
                  {importResult.skipped_dup > 0 &&
                    ` · ${fmtSp(importResult.skipped_dup)} ${tr("ya existían")}`}
                  {importResult.date_min &&
                    ` · ${importResult.date_min.slice(0, 10)} → ${importResult.date_max?.slice(0, 10)}`}
                </div>
              )}

              <div className="tb-settings-auto">
                <label className="tb-auto-toggle">
                  <input
                    type="checkbox"
                    checked={autoBkEnabled}
                    onChange={(e) => {
                      setAutoBkEnabled(e.target.checked);
                      setAutoBk("enabled", e.target.checked ? "1" : "0");
                    }}
                  />
                  <strong>{tr("Copias automáticas")}</strong>
                </label>
                {autoBkEnabled && (
                  <div className="tb-auto-body">
                    <div className="tb-auto-dir small muted" title={autoBkDir ?? ""}>
                      {autoBkDir || tr("Sin carpeta seleccionada")}
                    </div>
                    <button className="tb-auto-pick" onClick={chooseAutoBkDir}>
                      📁 {tr("Elegir carpeta…")}
                    </button>
                    <div className="tb-auto-opts">
                      <label className="small">
                        {tr("Frecuencia")}:&nbsp;
                        <select
                          value={autoBkFreq}
                          onChange={(e) => {
                            setAutoBkFreq(e.target.value);
                            setAutoBk("freq", e.target.value);
                          }}
                        >
                          <option value="daily">{tr("Diaria")}</option>
                          <option value="weekly">{tr("Semanal")}</option>
                          <option value="startup">{tr("Al abrir")}</option>
                        </select>
                      </label>
                      <label className="small">
                        {tr("Conservar")}:&nbsp;
                        <select
                          value={autoBkKeep}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            setAutoBkKeep(v);
                            setAutoBk("keep", String(v));
                          }}
                        >
                          <option value={7}>7</option>
                          <option value={14}>14</option>
                          <option value={30}>30</option>
                          <option value={0}>{tr("Todas")}</option>
                        </select>
                      </label>
                    </div>
                  </div>
                )}
              </div>

              <div className="tb-settings-foot">
                <div className="small muted">
                  {tr("Última copia")}:{" "}
                  {lastBackup ? fmtAgo(Date.now() - lastBackup) : tr("nunca")}
                </div>
                {dbInfo && (
                  <div className="small muted tb-settings-db" title={dbInfo.path}>
                    {dbInfo.path} · {fmtBytes(dbInfo.size)}
                  </div>
                )}
                <button
                  className="tb-settings-folder"
                  onClick={handleOpenDataFolder}
                  disabled={!dbInfo}
                >
                  📂 {tr("Abrir carpeta de datos")}
                </button>
              </div>
            </div>
          )}
        </div>

        <button
          className={`tb-intel-toggle${intelLive ? " on" : ""}`}
          onClick={() => toggleIntelLive()}
          title={tr("Mantener el intel activo aunque mires otras secciones")}
        >
          🚨 {tr("Intel en vivo")}: {intelLive ? tr("ON") : tr("OFF")}
        </button>

        <div className="tb-login">
          <button
            className={`tb-login-toggle ${loginOpen ? "active" : ""}`}
            onClick={() => setLoginOpen((v) => !v)}
            disabled={busy}
          >
            ＋ {tr("Conceder acceso")}
          </button>
          {loginOpen && (
            <div className="tb-login-pop">
              <label className="small">
                {tr("Acceso a")}:&nbsp;
                <select value={feature} onChange={(e) => setFeature(e.target.value)}>
                  {FEATURES.map((f) => (
                    <option key={f.key} value={f.key}>
                      {tr(f.label)}
                    </option>
                  ))}
                </select>
              </label>
              <button onClick={() => handleLogin()} disabled={busy}>
                {busy ? tr("Esperando login…") : tr("Iniciar sesión con EVE")}
              </button>
              {busy && (
                <button className="danger" onClick={handleCancelLogin}>
                  {tr("Cancelar login")}
                </button>
              )}
            </div>
          )}
        </div>

        {error && <p className="error tb-error">{error}</p>}
      </header>

      {/* Aviso flotante global de intel: visible en cualquier sección (no solo en el mapa). */}
      {globalAlert && (
        <div
          className="intel-global-alert"
          onClick={() => {
            handleOverlayChange("intel");
            setGlobalAlert(null);
            window.setTimeout(
              () =>
                document
                  .querySelector(".map-wrap")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" }),
              50,
            );
          }}
          title={tr("Ir al intel")}
        >
          {globalAlert}
          <span className="intel-alert-cta">{tr("Ir al intel")} ▸</span>
        </div>
      )}

      {/* ----- STAGE: mapa central + secciones que orbitan ----- */}
      <div className="stage">
        <MapView
          data={mapData}
          busy={sectionBusy}
          overlay={mapOverlay}
          onOverlayChange={handleOverlayChange}
          assetsBySystem={assetsMap}
          miningBySystem={miningMap}
          sovBySystem={sovMap}
          fwBySystem={fwMap}
          factionStandings={factionStd}
          incursions={incursions}
          theraConns={theraConns}
          intel={{
            lines: intelLines,
            availChannels: intelAvailChannels,
            channels: intelChannels,
            folder: intelFolder,
            recency: intelRecency,
            alertJumps: intelAlertJumps,
            sound: intelSound,
            anchors: intelAnchors,
            onlyRange: intelOnlyRange,
            soundChoice: intelSoundChoice,
            soundFile: intelSoundFile,
            live: intelLive,
            onToggleLive: () => toggleIntelLive(),
            onIntelAlert: showGlobalAlert,
            onClearAlert: () => setGlobalAlert(null),
            onConfig: setIntelCfg,
            onPickFolder: pickIntelFolder,
            onPickSound: pickIntelSound,
          }}
          onSystemAssets={(name) => {
            setAssetQuery(name);
            changeTab("assets");
          }}
          onOpenCazador={(name) => {
            setCazadorPilot(name ?? null);
            changeTab("cazador");
            // El mapa está arriba y las secciones abajo → hacer scroll a la sección tras cambiar.
            window.setTimeout(
              () =>
                document
                  .querySelector(".panel")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" }),
              50,
            );
          }}
          openTrack={mapTrackReq}
          hereSystemId={isGlobal ? null : cards[subjectId]?.system_id ?? null}
          charLocations={(isGlobal
            ? Object.values(cards)
            : cards[subjectId]
            ? [cards[subjectId]]
            : []
          )
            .filter((c) => c.system_id != null)
            .map((c) => ({ id: c.character_id, name: c.name, system_id: c.system_id as number }))}
          characters={characters}
        />

        {/* Dock de titulares del sujeto (siempre visible) */}
        {stats && (
          <div className="dock">
            <Kpi label="Kills" value={fmtSp(stats.kills)} />
            <Kpi label="Losses" value={fmtSp(stats.losses)} />
            <Kpi label="Eficacia" value={`${stats.efficiency.toFixed(0)}%`} tone={stats.efficiency >= 50 ? "pos" : "neg"} />
            <Kpi label="ISK destruido" value={fmtIsk(stats.isk_destroyed)} tone="pos" />
            <Kpi label="ISK perdido" value={fmtIsk(stats.isk_lost)} tone="neg" />
            {walletData && <Kpi label="Balance" value={fmtIsk(walletData.balance)} tone={walletData.balance >= 0 ? "pos" : "neg"} />}
            {!isGlobal && skillsData && <Kpi label="SP" value={fmtSp(skillsData.total_sp)} />}
          </div>
        )}

        <div className="panel">
          <div className="char-head">
            <div>
              <strong>{subjectName}</strong>{" "}
              {!isGlobal && <span className="muted">#{subjectId}</span>}
            </div>
          </div>
          <div className="nav-groups">
            {NAV.map((g) => {
              const active = g.subs.some((s) => s.key === tab);
              return (
                <button
                  key={g.group}
                  className={`navg ${active ? "active" : ""}`}
                  onClick={() => changeTab(g.subs[0].key)}
                >
                  {g.typeId ? (
                    <img className="navg-img" src={typeIcon(g.typeId)} alt="" loading="lazy" />
                  ) : (
                    <span className="navg-ico">{g.icon}</span>
                  )}{" "}
                  {tr(g.group)}
                </button>
              );
            })}
          </div>
          <div className="tabs">
            {(NAV.find((g) => g.subs.some((s) => s.key === tab)) ?? NAV[0]).subs.map((s) => {
              const enabled =
                isGlobal || s.soon || !s.scopes || s.scopes.some((sc) => subjectScopes.includes(sc));
              return (
                <button
                  key={s.key}
                  className={`tab ${tab === s.key ? "active" : ""} ${s.soon ? "soon" : ""}`}
                  disabled={!enabled}
                  title={
                    s.soon
                      ? "Próximamente"
                      : enabled
                      ? ""
                      : "Falta el scope; inicia sesión con esa feature"
                  }
                  onClick={() => changeTab(s.key)}
                >
                  {tr(s.label)}
                </button>
              );
            })}
          </div>

          <div className="section-header">
            <h2 className="sh-title">{tr(TAB_HEAD[tab].title)}</h2>
            <span className="sh-subtitle">· {tr(TAB_HEAD[tab].subtitle)}</span>
          </div>

          {tab === "pvp" && (
            <PvpView
              stats={stats}
              trend={pvpTrend}
              busy={sectionBusy}
              progress={progress}
              elapsed={elapsed}
              global={isGlobal}
              onSync={() => handleSync(subjectId)}
              onSyncFull={() => handleSyncFull(subjectId)}
              onReprocess={() => handleReprocess(subjectId)}
              onCancel={handleCancelSync}
              onExport={() => handleExport(subjectId, subjectName)}
              kmRows={kmRows}
              kmTotal={kmTotal}
              kmKind={kmKind}
              kmOffset={kmOffset}
              kmLimit={KM_LIMIT}
              onKmKind={(k) => loadKillmails(subject, k, 0)}
              onKmPage={(off) => loadKillmails(subject, kmKind, off)}
            />
          )}
          {tab === "rivales" && <RivalsView data={rivalsData} busy={sectionBusy} />}
          {tab === "batallas" && <BattlesView data={battlesData} busy={sectionBusy} />}
          {tab === "cazador" && (
            <CazadorView
              initialPilot={cazadorPilot}
              onTrackOnMap={(name) => {
                handleOverlayChange("intel");
                setMapTrackReq({ name, nonce: Date.now() });
                // El mapa está arriba; subir hasta él para ver el rastro.
                window.setTimeout(
                  () =>
                    document
                      .querySelector(".map-wrap")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                  50,
                );
              }}
            />
          )}
          {tab === "patrimonio" && <NetworthViewC data={networthData} busy={sectionBusy} />}
          {tab === "wallet" && (
            <WalletViewC
              data={walletData}
              series={walletSeries}
              charNames={new Map(Object.values(cards).map((c) => [c.character_id, c.name]))}
              busy={sectionBusy}
              global={isGlobal}
              onSync={() => handleSyncWallet(subjectId)}
            />
          )}
          {tab === "skills" &&
            (isGlobal ? (
              <GlobalSkillsView data={gSkills} busy={sectionBusy} />
            ) : (
              <>
                <CharHeader detail={charDetail} card={cards[subjectId]} />
                <SkillsView data={skillsData} busy={sectionBusy} />
              </>
            ))}
          {tab === "assets" && (
            <AssetsView
              data={assetsData}
              detail={assetsDetail}
              busy={sectionBusy}
              charId={isGlobal ? null : subjectId}
              presetQuery={assetQuery}
            />
          )}
          {tab === "industria" && (
            <IndustryView jobs={jobsData} busy={sectionBusy} global={isGlobal} />
          )}
          {tab === "comercio" && (
            <ComercioView orders={marketOrders} busy={sectionBusy} subject={subject} />
          )}
          {tab === "planetologia" && <PlanetologiaView planets={planets} busy={sectionBusy} />}
          {tab === "fiteos" && <FitsView charId={isGlobal ? null : subjectId} charName={isGlobal ? null : subjectName} />}
          {tab === "rateo" && (
            <RateoView
              data={ratting}
              special={specialRats}
              charNames={new Map(Object.values(cards).map((c) => [c.character_id, c.name]))}
              paperSeries={paperSeries}
              abyssals={abyssalsData}
              busy={sectionBusy}
            />
          )}
          {tab === "resumen" && <ResumenView subject={subject} />}
          {tab === "actividad" && <ActividadView subject={subject} />}
          {tab === "mineria" && (
            <MineriaView
              subject={subject}
              charNames={new Map(Object.values(cards).map((c) => [c.character_id, c.name]))}
              onSyncMining={handleSyncMining}
            />
          )}
          {tab === "contactos" &&
            (isGlobal ? (
              <p className="muted small">Selecciona un personaje para ver sus contactos y standings.</p>
            ) : (
              <ContactosView contacts={contactsData} standings={standingsData} busy={sectionBusy} />
            ))}
          {tab === "factional" &&
            (isGlobal ? (
              <p className="muted small">Selecciona un personaje para ver sus stats de Guerra de Facciones.</p>
            ) : (
              <FactionalSection data={factionalData} busy={sectionBusy} />
            ))}
          {tab === "abyssals" &&
            (isGlobal ? (
              <p className="muted small">Selecciona un personaje para ver la estimación de Abyssals.</p>
            ) : (
              <AbyssalsSection data={abyssalsData} busy={sectionBusy} />
            ))}
        </div>
      </div>

      {/* ----- BARRA DE ESTADO / LOG INFERIOR ----- */}
      <footer
        className={`statusbar ${working ? "is-working" : ""} ${
          !working && error ? "is-error" : ""
        }`}
      >
        <div className="statusbar-activity">
          {working && <span className="spinner" />}
          <span className="sb-text" title={statusText}>
            {liveSync && lastSync ? <LastSyncText lastSync={lastSync} /> : statusText}
          </span>
          {isSyncingHistory && (
            <button className="sb-cancel" onClick={handleCancelSync} title={tr("Cancelar sincronización")}>
              {tr("Cancelar")}
            </button>
          )}
          {busy && (
            <button className="sb-cancel" onClick={handleCancelLogin} title={tr("Cancelar el inicio de sesión")}>
              {tr("Cancelar login")}
            </button>
          )}
        </div>
        <div className="statusbar-meta">
          <EveClock />
          <span className="sb-sep" />
          <span
            className="sb-badge"
            title={
              serverOffline
                ? tr("Tranquility caído o en VIP")
                : serverStatus
                ? `Tranquility online${serverStatus.vip ? " (VIP)" : ""}`
                : tr("Comprobando estado del servidor…")
            }
          >
            <span
              className="sb-dot"
              style={{
                background: serverOffline
                  ? "var(--danger)"
                  : !serverStatus
                  ? "var(--fg-muted)"
                  : serverStatus.vip
                  ? "#e3a13a"
                  : "var(--ok)",
              }}
            />
            TQ {serverOffline ? "offline" : serverStatus ? `· ${fmtSp(serverStatus.players)}` : "…"}
          </span>
          <span className="sb-sep" />
          <span className="sb-badge" title={tr("Mapa y datos servidos desde la base de datos local (SDE), sin llamada a ESI")}>
            <span className="sb-dot" />
            {tr("SDE local")}
          </span>
          <span className="sb-sep" />
          <SyncBadge lastSync={lastSync} autoBusy={autoBusy} />
          <span className="sb-sep" />
          <button
            className="sb-kofi"
            onClick={() => openUrl("https://ko-fi.com/rogiz7")}
            title={tr("Apoyar el proyecto en Ko-fi (totalmente voluntario)")}
          >
            ☕ {tr("Apoyar")}
          </button>
        </div>
      </footer>
    </main>
  );
}

/* ---------- vistas ---------- */
// Tendencia PvP con "scrub": selector Año/Mes + dos sliders que definen una ventana,
// la gráfica sombrea el tramo elegido y los KPIs se recalculan para esa ventana.
function TrendScrub({ points }: { points: PvpTrendPoint[] }) {
  const n = points.length;
  const [range, setRange] = useState<[number, number]>([0, Math.max(0, n - 1)]);
  useEffect(() => {
    setRange([0, Math.max(0, n - 1)]);
  }, [n]);

  if (n < 2)
    return <p className="muted small">Hace falta historial de varias semanas para ver la tendencia.</p>;

  const lo = Math.min(range[0], range[1]);
  const hi = Math.max(range[0], range[1]);
  const sel = points.slice(lo, hi + 1);
  const sum = (k: "kills" | "losses" | "isk_destroyed" | "isk_lost") =>
    sel.reduce((a, p) => a + p[k], 0);
  const kills = sum("kills");
  const losses = sum("losses");
  const iskD = sum("isk_destroyed");
  const iskL = sum("isk_lost");
  const eff = iskD + iskL > 0 ? (iskD / (iskD + iskL)) * 100 : 0;

  const years = [...new Set(points.map((p) => p.date.slice(0, 4)))];
  const curYear = points[lo].date.slice(0, 4);
  const curMonth = points[lo].date.slice(0, 7);
  const monthsOfYear = [
    ...new Set(points.filter((p) => p.date.startsWith(curYear)).map((p) => p.date.slice(0, 7))),
  ];
  const setToYear = (y: string) => {
    const idxs = points.map((p, i) => [p.date.slice(0, 4), i] as const).filter(([yy]) => yy === y);
    if (idxs.length) setRange([idxs[0][1], idxs[idxs.length - 1][1]]);
  };
  const setToMonth = (ym: string) => {
    const idxs = points.map((p, i) => [p.date.slice(0, 7), i] as const).filter(([mm]) => mm === ym);
    if (idxs.length) setRange([idxs[0][1], idxs[idxs.length - 1][1]]);
  };

  const W = 600;
  const H = 190;
  const PAD = 30;
  const maxY = Math.max(...points.flatMap((p) => [p.kills, p.losses]), 1);
  const x = (i: number) => PAD + (i / (n - 1)) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - (v / maxY) * (H - 2 * PAD);
  const path = (key: "kills" | "losses") =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(" ");
  const labels = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];

  return (
    <div className="trend-chart">
      <div className="resumen-period" style={{ marginBottom: "0.5rem" }}>
        <span className="rp-label">📅 Ventana</span>
        <select value={curYear} onChange={(e) => setToYear(e.target.value)}>
          {years.map((yy) => (
            <option key={yy} value={yy}>
              {yy}
            </option>
          ))}
        </select>
        <select value={curMonth} onChange={(e) => setToMonth(e.target.value)}>
          {monthsOfYear.map((m) => (
            <option key={m} value={m}>
              {MONTH_NAMES[parseInt(m.slice(5, 7), 10) - 1]}
            </option>
          ))}
        </select>
        <button className="rateo-clear" onClick={() => setRange([0, n - 1])}>
          Todo
        </button>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="trend-svg" preserveAspectRatio="none">
        <rect
          x={x(lo)}
          y={PAD - 6}
          width={Math.max(x(hi) - x(lo), 1)}
          height={H - PAD - (PAD - 6)}
          fill="#4f9cff"
          fillOpacity={0.12}
        />
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#2a3340" strokeWidth={1} />
        <path d={path("losses")} fill="none" stroke="#e5534b" strokeWidth={2} />
        <path d={path("kills")} fill="none" stroke="#3fb950" strokeWidth={2} />
        {labels.map((i) => (
          <text key={i} x={x(i)} y={H - PAD + 16} textAnchor="middle" className="trend-x">
            {points[i].date}
          </text>
        ))}
      </svg>

      <div className="scrub-sliders">
        <input
          type="range"
          min={0}
          max={n - 1}
          value={lo}
          onChange={(e) => setRange([Math.min(+e.target.value, hi), hi])}
        />
        <input
          type="range"
          min={0}
          max={n - 1}
          value={hi}
          onChange={(e) => setRange([lo, Math.max(+e.target.value, lo)])}
        />
      </div>
      <div className="muted small">
        {points[lo].date} → {points[hi].date} · {sel.length} semanas
      </div>

      <div className="kpis" style={{ marginTop: "0.6rem" }}>
        <Kpi label="Kills" value={fmtSp(kills)} tone="pos" />
        <Kpi label="Losses" value={fmtSp(losses)} tone="neg" />
        <Kpi label="ISK destruido" value={fmtIsk(iskD)} tone="pos" />
        <Kpi label="ISK perdido" value={fmtIsk(iskL)} tone="neg" />
        <Kpi label="Eficacia" value={`${eff.toFixed(0)}%`} tone={eff >= 50 ? "pos" : "neg"} />
      </div>

      <div className="trend-legend">
        <span>
          <span className="ldot" style={{ background: "#3fb950" }} /> Kills
        </span>
        <span>
          <span className="ldot" style={{ background: "#e5534b" }} /> Losses
        </span>
      </div>
    </div>
  );
}

// Tendencia de Wallet con scrub: ingresos/gastos por mes, ventana deslizante y KPIs del tramo.
// Conmutador Tabla / Gráfica reutilizable.
function ViewToggle({ chart, onChange }: { chart: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="view-toggle">
      <div className="seg">
        <button className={!chart ? "active" : ""} onClick={() => onChange(false)}>
          {tr("Tabla")}
        </button>
        <button className={chart ? "active" : ""} onClick={() => onChange(true)}>
          {tr("Gráfica")}
        </button>
      </div>
    </div>
  );
}

function PvpView(props: {
  stats: PvpStats | null;
  trend?: PvpTrendPoint[] | null;
  busy: boolean;
  progress: { processed: number; page: number } | null;
  elapsed: number;
  global?: boolean;
  onSync?: () => void;
  onSyncFull?: () => void;
  onReprocess?: () => void;
  onCancel?: () => void;
  onExport?: () => void;
  kmRows: KillmailRow[];
  kmTotal: number;
  kmKind: "all" | "kill" | "loss";
  kmOffset: number;
  kmLimit: number;
  onKmKind: (k: "all" | "kill" | "loss") => void;
  onKmPage: (offset: number) => void;
}) {
  const {
    stats,
    trend,
    busy,
    progress,
    elapsed,
    global,
    onSync,
    onSyncFull,
    onReprocess,
    onCancel,
    onExport,
    kmRows,
    kmTotal,
    kmKind,
    kmOffset,
    kmLimit,
    onKmKind,
    onKmPage,
  } = props;
  const [chart, setChart] = useState(true); // PvP por defecto en Gráfica
  const [kmSort, setKmSort] = useState<{ col: string; dir: 1 | -1 }>({ col: "date", dir: -1 });
  const onKmSort = (col: string) =>
    setKmSort((s) => (s.col === col ? { col, dir: s.dir === 1 ? -1 : 1 } : { col, dir: 1 }));
  const kmSorted = [...kmRows].sort((a, b) => {
    const d = kmSort.dir;
    switch (kmSort.col) {
      case "type":
        return ((a.is_loss ? 1 : 0) - (b.is_loss ? 1 : 0)) * d;
      case "ship":
        return (a.ship_name ?? "").localeCompare(b.ship_name ?? "") * d;
      case "sys":
        return (a.system_name ?? "").localeCompare(b.system_name ?? "") * d;
      case "dmg":
        return ((a.char_damage ?? 0) - (b.char_damage ?? 0)) * d;
      case "isk":
        return ((a.isk_value ?? 0) - (b.isk_value ?? 0)) * d;
      default:
        return (a.killed_at ?? "").localeCompare(b.killed_at ?? "") * d;
    }
  });
  return (
    <>
      {!global && (
        <div className="pvp-toolbar">
          <button onClick={onSync} disabled={busy}>
            {busy ? tr("Trabajando…") : tr("Sincronizar recientes")}
          </button>
          <button onClick={onSyncFull} disabled={busy}>
            {tr("Sincronizar histórico (zKill)")}
          </button>
          <button onClick={onReprocess} disabled={busy} title={tr("Recalcula daño, final blow y nave víctima desde la caché")}>
            {tr("Reprocesar daño")}
          </button>
          <button onClick={onExport}>{tr("Exportar CSV")}</button>
        </div>
      )}
      {progress !== null && (
        <div className="sync-progress">
          <span className="spinner" />
          <span>
            {tr("Trabajando…")} <strong>{fmtSp(progress.processed)}</strong> killmails
            {progress.page > 0 ? ` (${tr("página")} ${progress.page})` : ""} · {elapsed}s
          </span>
          <span className="muted small">{tr("No cierres la app.")}</span>
          <button className="danger" onClick={onCancel}>
            {tr("Cancelar")}
          </button>
        </div>
      )}
      {!stats && busy && <p className="muted">{tr("Cargando…")}</p>}
      {stats && (
        <>
          <div className="kpis">
            <Kpi label={tr("Kills")} value={stats.kills} />
            <Kpi label={tr("Losses")} value={stats.losses} />
            <Kpi label={tr("Solo kills")} value={stats.solo_kills} />
            <Kpi label={tr("Final blows")} value={stats.final_blows} />
            <Kpi label={tr("Top damage")} value={stats.top_damage_kills} />
            <Kpi label={tr("Eficacia ISK")} value={`${stats.efficiency.toFixed(1)}%`} tone={stats.efficiency >= 50 ? "pos" : "neg"} />
            <Kpi label={tr("ISK destruido")} value={fmtIsk(stats.isk_destroyed)} tone="pos" />
            <Kpi label={tr("ISK perdido")} value={fmtIsk(stats.isk_lost)} tone="neg" />
          </div>
          <ViewToggle chart={chart} onChange={setChart} />
          {chart ? (
            <>
              <div className="top-list">
                <h4>{tr("Tendencia (kills/losses por semana) · arrastra para enfocar una ventana")}</h4>
                {trend ? <TrendScrub points={trend} /> : <p className="muted small">{tr("Cargando…")}</p>}
              </div>
              <div className="tops">
                <div className="top-list">
                  <h4>{tr("Top naves")}</h4>
                  <Bars items={stats.top_ships.map((s) => ({ label: s.name ?? `#${s.id}`, value: s.count }))} />
                </div>
                <div className="top-list">
                  <h4>{tr("Top sistemas")}</h4>
                  <Bars
                    items={stats.top_systems.map((s) => ({ label: s.name ?? `#${s.id}`, value: s.count }))}
                    color="#e3a13a"
                  />
                </div>
              </div>
              <div className="tops">
                <div className="top-list">
                  <h4>{tr("Kills vs Losses")}</h4>
                  <Bars
                    items={[
                      { label: tr("Kills"), value: stats.kills },
                      { label: tr("Losses"), value: stats.losses },
                    ]}
                    color="#3fb950"
                  />
                </div>
                <div className="top-list">
                  <h4>{tr("ISK destruido vs perdido")}</h4>
                  <Bars
                    items={[
                      { label: tr("Destruido"), value: stats.isk_destroyed },
                      { label: tr("Perdido"), value: stats.isk_lost },
                    ]}
                    color="#e5534b"
                    fmt={fmtIsk}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="tops">
              <TopList title={tr("Top naves")} items={stats.top_ships} icon="render" />
              <div className="top-list">
                <h4>{tr("Top sistemas")}</h4>
                {stats.top_systems.length === 0 && <p className="muted small">{tr("Sin datos.")}</p>}
                <ol>
                  {stats.top_systems.map((it) => (
                    <li key={it.id}>
                      {it.name ?? `#${it.id}`} <span className="muted">({it.count})</span>
                      {it.region && <span className="region"> · {it.region}</span>}
                      {it.name && (
                        <button
                          className="dotlan-link"
                          title={`${tr("Ver")} ${it.name} ${tr("en Dotlan")}`}
                          onClick={() =>
                            openUrl(`https://evemaps.dotlan.net/system/${it.name!.replace(/ /g, "_")}`)
                          }
                        >
                          🗺
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}

          {stats.top_expensive.length > 0 && (
            <>
              <h4>{tr("Kills más caros")}</h4>
              <table className="km-table">
                <thead>
                  <tr>
                    <th>{tr("Nave destruida")}</th>
                    <th>{tr("Sistema")}</th>
                    <th>ISK</th>
                    <th>{tr("Fecha")}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.top_expensive.map((k) => (
                    <tr
                      key={k.killmail_id}
                      className="clickable kill"
                      onClick={() => openUrl(zkillUrl(k.killmail_id))}
                      title={tr("Abrir en zKillboard")}
                    >
                      <td className="ship-cell">
                        {shipIcon(k.victim_ship_id) && (
                          <img className="ship-img" src={shipIcon(k.victim_ship_id)!} alt="" loading="lazy" />
                        )}
                        <span>{k.victim_ship_name ?? (k.victim_ship_id ?? "-")}</span>
                      </td>
                      <td>{k.system_name ?? (k.system_id ?? "-")}</td>
                      <td>{k.isk_value ? fmtIsk(k.isk_value) : "-"}</td>
                      <td>{k.killed_at?.replace("T", " ").slice(0, 16) ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}

      <div className="km-header">
        <h4>Killmails</h4>
        <div className="km-filters">
          {(["all", "kill", "loss"] as const).map((k) => (
            <button
              key={k}
              className={`tab ${kmKind === k ? "active" : ""}`}
              onClick={() => onKmKind(k)}
            >
              {k === "all" ? tr("Todos") : k === "kill" ? tr("Kills") : tr("Losses")}
            </button>
          ))}
        </div>
      </div>
      <table className="km-table">
        <thead>
          <tr>
            <Th label={tr("Tipo")} col="type" sort={kmSort} onSort={onKmSort} />
            <Th label={tr("Nave")} col="ship" sort={kmSort} onSort={onKmSort} />
            <Th label={tr("Sistema")} col="sys" sort={kmSort} onSort={onKmSort} />
            <Th label={tr("Daño")} col="dmg" sort={kmSort} onSort={onKmSort} />
            <Th label="ISK" col="isk" sort={kmSort} onSort={onKmSort} />
            <Th label={tr("Fecha")} col="date" sort={kmSort} onSort={onKmSort} />
          </tr>
        </thead>
        <tbody>
          {kmSorted.map((k) => (
            <tr
              key={k.killmail_id}
              className={`clickable ${k.is_loss ? "loss" : "kill"}`}
              onClick={() => openUrl(zkillUrl(k.killmail_id))}
              title={tr("Abrir en zKillboard")}
            >
              <td>
                {k.is_loss ? "loss" : "kill"}
                {!k.is_loss && k.solo ? " · solo" : ""}
                {k.final_blow && <span className="badge fb">FB</span>}
                {k.top_damage && <span className="badge td">TD</span>}
              </td>
              <td className="ship-cell">
                {shipIcon(k.ship_type_id) && (
                  <img className="ship-img" src={shipIcon(k.ship_type_id)!} alt="" loading="lazy" />
                )}
                <span>{k.ship_name ?? (k.ship_type_id ?? "-")}</span>
              </td>
              <td>{k.system_name ?? (k.system_id ?? "-")}</td>
              <td>{k.char_damage != null ? fmtSp(k.char_damage) : "-"}</td>
              <td>{k.isk_value ? fmtIsk(k.isk_value) : "-"}</td>
              <td>{k.killed_at?.replace("T", " ").slice(0, 16) ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="km-pager">
        <button disabled={kmOffset <= 0} onClick={() => onKmPage(Math.max(0, kmOffset - kmLimit))}>
          ← {tr("Anterior")}
        </button>
        <span className="muted">
          {kmTotal === 0
            ? tr("Sin killmails")
            : `${kmOffset + 1}–${Math.min(kmOffset + kmLimit, kmTotal)} ${tr("de")} ${fmtSp(kmTotal)}`}
        </span>
        <button
          disabled={kmOffset + kmLimit >= kmTotal}
          onClick={() => onKmPage(kmOffset + kmLimit)}
        >
          {tr("Siguiente")} →
        </button>
      </div>
    </>
  );
}

function NetworthViewC(props: { data: NetworthView | null; busy: boolean }) {
  const { data, busy } = props;
  if (!data && busy) return <p className="muted">{tr("Cargando…")}</p>;
  if (!data) return null;
  const s = data.series;

  return (
    <>
      <div className="kpis">
        <Kpi label={tr("Patrimonio total")} value={fmtIsk(data.total)} />
        <Kpi label={tr("Líquido (wallet)")} value={fmtIsk(data.liquid)} />
        <Kpi label={tr("Valor de assets")} value={fmtIsk(data.asset_value)} />
        <Kpi label={tr("Snapshots")} value={s.length} />
      </div>

      {data.total > 0 && (
        <div className="panel resumen-panel" style={{ maxWidth: 540, marginBottom: "0.8rem" }}>
          <h4>{tr("Composición del patrimonio")}</h4>
          <Donut
            items={[
              { label: tr("Líquido (wallet)"), value: data.liquid },
              { label: tr("Valor de assets"), value: data.asset_value },
            ]}
            fmt={fmtIsk}
          />
        </div>
      )}

      {data.prices_loaded === 0 && (
        <p className="muted" style={{ marginTop: 8 }}>
          {tr("Aún no hay precios de mercado en la BD, así que los assets no están valorados. Se descargan solos en la próxima sincronización (endpoint público de ESI).")}
        </p>
      )}

      {s.length === 0 && (
        <p className="muted" style={{ marginTop: 12 }}>
          {tr("Todavía no hay histórico. Cada sincronización guarda un snapshot diario de tu patrimonio; la curva de evolución aparecerá a partir del segundo día.")}
        </p>
      )}

      {s.length === 1 && (
        <p className="muted" style={{ marginTop: 12 }}>
          {tr("Primer snapshot guardado")} ({s[0].date}). {tr("La gráfica de evolución necesita al menos dos días de datos.")}
        </p>
      )}

      {s.length >= 2 && <NetworthChart series={s} />}

      {s.length >= 2 && (
        <p className="muted" style={{ marginTop: 8, fontSize: "0.78rem" }}>
          {tr("Valor de assets estimado con el precio medio de mercado (average price de ESI), no con órdenes reales de Jita, y EXCLUYENDO blueprints (su precio base infla el total). Útil como tendencia, no como liquidación exacta. Los snapshots anteriores a esta versión aún incluyen blueprints (verás un escalón).")}
        </p>
      )}
    </>
  );
}

/// Mini gráfico de líneas (SVG propio) para la evolución del patrimonio.
function NetworthChart(props: { series: NetworthPoint[] }) {
  const { series } = props;
  const W = 760;
  const H = 260;
  const padL = 8;
  const padR = 8;
  const padT = 14;
  const padB = 22;
  const n = series.length;
  const maxV = Math.max(1, ...series.map((p) => p.total));
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v / maxV) * (H - padT - padB);
  const line = (key: "total" | "liquid" | "asset_value") =>
    series.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");

  // Área bajo la curva del total.
  const area =
    `M${x(0).toFixed(1)},${y(series[0].total).toFixed(1)} ` +
    series.map((p, i) => `L${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join(" ") +
    ` L${x(n - 1).toFixed(1)},${(H - padB).toFixed(1)} L${x(0).toFixed(1)},${(H - padB).toFixed(1)} Z`;

  const first = series[0];
  const last = series[n - 1];
  const delta = last.total - first.total;
  const pct = first.total > 0 ? (delta / first.total) * 100 : 0;

  return (
    <div className="nw-chart">
      <div className="nw-chart-head">
        <span className="nw-legend">
          <i className="dot total" /> {tr("Total")}
          <i className="dot liquid" /> {tr("Líquido")}
          <i className="dot asset" /> {tr("Assets")}
        </span>
        <span className={`nw-delta ${delta >= 0 ? "up" : "down"}`}>
          {delta >= 0 ? "▲" : "▼"} {fmtIsk(Math.abs(delta))} ({pct >= 0 ? "+" : ""}
          {pct.toFixed(1)}%)
        </span>
      </div>
      <svg className="nw-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <path className="nw-area" d={area} />
        <path className="nw-line asset" d={line("asset_value")} />
        <path className="nw-line liquid" d={line("liquid")} />
        <path className="nw-line total" d={line("total")} />
      </svg>
      <div className="nw-axis">
        <span>{first.date}</span>
        <span className="muted">{tr("máx")} {fmtIsk(maxV)}</span>
        <span>{last.date}</span>
      </div>
    </div>
  );
}

function WalletViewC(props: {
  data: WalletView | null;
  series?: WalletSeries | null;
  charNames?: Map<number, string>;
  busy: boolean;
  global?: boolean;
  onSync?: () => void;
}) {
  const { data, series, charNames, busy, global, onSync } = props;
  const [gran, setGran] = useState<"day" | "week" | "month" | "year">(
    () => (localStorage.getItem("koru-wallet-gran") as "day" | "week" | "month" | "year") || "month",
  );
  const cumulative: boolean = false; // "Acumulado" retirado; los presets de rango lo sustituyen.
  const [from, setFrom] = useState(daysAgo(90));
  const [to, setTo] = useState("");
  const [dim, setDim] = useState<"flux" | "cat" | "char">(
    () => (localStorage.getItem("koru-wallet-dim") as "flux" | "cat" | "char") || "flux",
  );
  useEffect(() => {
    localStorage.setItem("koru-wallet-gran", gran);
  }, [gran]);
  useEffect(() => {
    localStorage.setItem("koru-wallet-dim", dim);
  }, [dim]);
  const [wSort, setWSort] = useState<{ col: string; dir: 1 | -1 }>({ col: "date", dir: -1 });
  const onWSort = (col: string) =>
    setWSort((s) => (s.col === col ? { col, dir: s.dir === 1 ? -1 : 1 } : { col, dir: 1 }));
  const wRows = [...(data?.stats.recent ?? [])].sort((a, b) => {
    const d = wSort.dir;
    switch (wSort.col) {
      case "type":
        return (a.ref_type ?? "").localeCompare(b.ref_type ?? "") * d;
      case "amount":
        return ((a.amount ?? 0) - (b.amount ?? 0)) * d;
      case "balance":
        return ((a.balance ?? 0) - (b.balance ?? 0)) * d;
      default:
        return (a.date ?? "").localeCompare(b.date ?? "") * d;
    }
  });

  // --- Gráfica unificada (multilínea) ---
  const granLabel =
    gran === "day" ? tr("día") : gran === "week" ? tr("semana") : gran === "month" ? tr("mes") : tr("año");
  const inRange = (date: string) => (!from || date >= from) && (!to || date <= to);
  const bucketKey = (date: string) =>
    gran === "year"
      ? date.slice(0, 4)
      : gran === "month"
        ? date.slice(0, 7)
        : gran === "week"
          ? weekKey(date)
          : date;
  const dayMap = new Map<string, { inc: number; exp: number }>();
  for (const d of series?.daily ?? []) {
    if (!inRange(d.date)) continue;
    const k = bucketKey(d.date);
    const e = dayMap.get(k) ?? { inc: 0, exp: 0 };
    e.inc += d.income;
    e.exp += d.expense;
    dayMap.set(k, e);
  }
  // KPIs del RANGO seleccionado (Ingresos/Gastos/Neto) en vez del histórico completo.
  const rangeInc = (series?.daily ?? [])
    .filter((d) => inRange(d.date))
    .reduce((a, d) => a + d.income, 0);
  const rangeExp = (series?.daily ?? [])
    .filter((d) => inRange(d.date))
    .reduce((a, d) => a + d.expense, 0);
  const walletYears = [...new Set((series?.daily ?? []).map((d) => +d.date.slice(0, 4)))]
    .filter((y) => y > 0)
    .sort((a, b) => b - a);
  const labels = [...dayMap.keys()];
  const cum = (arr: number[]) => {
    if (!cumulative) return arr;
    let a = 0;
    return arr.map((v) => (a += v));
  };
  const fluxSeries = [
    { name: tr("Ingresos"), color: "#3fb950", values: cum(labels.map((l) => dayMap.get(l)!.inc)) },
    { name: tr("Gastos"), color: "#e5534b", values: cum(labels.map((l) => dayMap.get(l)!.exp)) },
    {
      name: tr("Neto"),
      color: "#c8d3df",
      values: cum(labels.map((l) => dayMap.get(l)!.inc + dayMap.get(l)!.exp)),
    },
  ];
  const buildSigned = (
    rows: { id: string | number; date: string; net: number }[],
    nameFn: (id: string | number) => string,
  ) => {
    const m = new Map<string | number, Map<string, number>>();
    for (const r of rows) {
      if (!inRange(r.date)) continue;
      const k = bucketKey(r.date);
      let mm = m.get(r.id);
      if (!mm) {
        mm = new Map();
        m.set(r.id, mm);
      }
      mm.set(k, (mm.get(k) ?? 0) + r.net);
    }
    const totals = [...m.entries()]
      .map(([id, mm]) => ({ id, total: Math.abs([...mm.values()].reduce((a, b) => a + b, 0)) }))
      .sort((a, b) => b.total - a.total);
    return totals.slice(0, 8).map((t, i) => ({
      name: nameFn(t.id),
      color: DONUT_COLORS[i % DONUT_COLORS.length],
      values: cum(labels.map((l) => m.get(t.id)?.get(l) ?? 0)),
    }));
  };
  const catSeries = buildSigned(
    (series?.by_cat ?? []).map((r: WalletCatDay) => ({ id: r.cat, date: r.date, net: r.net })),
    (id) => tr(String(id)),
  );
  const charSeries = buildSigned(
    (series?.by_char ?? []).map((r: WalletCharDay) => ({ id: r.character_id, date: r.date, net: r.net })),
    (id) => charNames?.get(Number(id)) ?? `#${id}`,
  );
  const multiChar = new Set((series?.by_char ?? []).map((r) => r.character_id)).size > 1;
  const lineSeries = dim === "cat" ? catSeries : dim === "char" && multiChar ? charSeries : fluxSeries;

  return (
    <>
      {!global && (
        <div className="pvp-toolbar">
          <button onClick={onSync} disabled={busy}>
            {busy ? tr("Trabajando…") : tr("Sincronizar wallet")}
          </button>
        </div>
      )}
      {!data && busy && <p className="muted">{tr("Cargando…")}</p>}
      {data && (
        <>
          <div className="kpis">
            <Kpi label={tr("Balance")} value={fmtIsk(data.balance)} />
            <Kpi label={tr("Ingresos")} value={fmtIsk(rangeInc)} tone="pos" />
            <Kpi label={tr("Gastos")} value={fmtIsk(rangeExp)} tone="neg" />
            <Kpi
              label={tr("Neto")}
              value={fmtIsk(rangeInc - rangeExp)}
              tone={rangeInc - rangeExp >= 0 ? "pos" : "neg"}
            />
            <Kpi label={tr("Movimientos")} value={data.stats.entries} />
          </div>
          <div className="rateo-controls">
            <div className="seg">
              {(["day", "week", "month"] as const).map((g) => (
                <button key={g} className={gran === g ? "active" : ""} onClick={() => setGran(g)}>
                  {g === "day" ? tr("Día") : g === "week" ? tr("Semana") : g === "month" ? tr("Mes") : tr("Año")}
                </button>
              ))}
            </div>
            <RangePresets from={from} to={to} setFrom={setFrom} setTo={setTo} years={walletYears} />
            <label className="rateo-date">
              {tr("Desde")} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="rateo-date">
              {tr("Hasta")} <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            {(from || to) && (
              <button
                className="rateo-clear"
                onClick={() => {
                  setFrom("");
                  setTo("");
                }}
              >
                Limpiar
              </button>
            )}
          </div>

          <div className="top-list">
            <div className="rateo-charthead">
              <h4>
                {cumulative ? `ISK (${tr("acumulado")})` : "ISK"} {tr("por")} {granLabel}
              </h4>
              <div className="seg seg-sm">
                <button className={dim === "flux" ? "active" : ""} onClick={() => setDim("flux")}>
                  {tr("Flujo")}
                </button>
                <button className={dim === "cat" ? "active" : ""} onClick={() => setDim("cat")}>
                  {tr("Por categoría")}
                </button>
                {multiChar && (
                  <button className={dim === "char" ? "active" : ""} onClick={() => setDim("char")}>
                    {tr("Por personaje")}
                  </button>
                )}
              </div>
            </div>
            {!series ? (
              <p className="muted small">{tr("Cargando…")}</p>
            ) : labels.length === 0 ? (
              <p className="muted small">{tr("Sin datos.")}</p>
            ) : (
              <MultiLineProgress labels={labels} series={lineSeries} fmt={fmtIsk} />
            )}
          </div>

          <h4>{tr("Movimientos recientes")}</h4>
          <table className="km-table">
            <thead>
              <tr>
                <Th label={tr("Fecha")} col="date" sort={wSort} onSort={onWSort} />
                <Th label={tr("Tipo")} col="type" sort={wSort} onSort={onWSort} />
                <Th label={tr("Cantidad")} col="amount" sort={wSort} onSort={onWSort} />
                <Th label={tr("Balance")} col="balance" sort={wSort} onSort={onWSort} />
              </tr>
            </thead>
            <tbody>
              {wRows.map((j) => (
                <tr key={j.id} className={(j.amount ?? 0) >= 0 ? "kill" : "loss"}>
                  <td>{j.date?.replace("T", " ").slice(0, 16) ?? "-"}</td>
                  <td>{j.ref_type ?? "-"}</td>
                  <td>{j.amount != null ? fmtIsk(j.amount) : "-"}</td>
                  <td>{j.balance != null ? fmtIsk(j.balance) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

function CharHeader({ detail, card }: { detail: CharacterDetail | null; card?: CharacterCard }) {
  if (!detail) return null;
  const a = detail.attributes;
  const sec = detail.security_status;
  const portrait = card
    ? `https://images.evetech.net/characters/${card.character_id}/portrait?size=128`
    : null;
  const bio = detail.bio ? detail.bio.replace(/<[^>]*>/g, "").trim() : "";
  const attrs = a
    ? [
        { label: tr("Inteligencia"), v: a.intelligence },
        { label: tr("Memoria"), v: a.memory },
        { label: tr("Percepción"), v: a.perception },
        { label: tr("Carisma"), v: a.charisma },
        { label: tr("Voluntad"), v: a.willpower },
      ]
    : [];
  return (
    <div className="char-header">
      <div className="ch-top">
        {portrait && <img className="ch-portrait" src={portrait} alt="" />}
        <div className="ch-id">
          <h3>{card?.name ?? tr("Personaje")}</h3>
          <div className="ch-sub muted small">
            {card?.corporation_name ?? ""}
            {card?.alliance_name ? ` · ${card.alliance_name}` : ""}
          </div>
          <div className="ch-meta">
            {sec != null && (
              <span>
                {tr("Sec")}:{" "}
                <b style={{ color: secColor(sec) }}>{sec.toFixed(2)}</b>
              </span>
            )}
            {detail.birthday && <span>{tr("Nacimiento")}: {detail.birthday.slice(0, 10)}</span>}
            <span>
              {tr("Jump clones")}: <b>{detail.jump_clones}</b>
            </span>
          </div>
        </div>
      </div>

      {attrs.length > 0 && (
        <div className="ch-attrs">
          {attrs.map((at) => (
            <div className="ch-attr" key={at.label}>
              <span className="ch-attr-v">{at.v}</span>
              <span className="ch-attr-l">{at.label}</span>
            </div>
          ))}
          {a?.bonus_remaps != null && (
            <div className="ch-attr">
              <span className="ch-attr-v">{a.bonus_remaps}</span>
              <span className="ch-attr-l">{tr("Remaps libres")}</span>
            </div>
          )}
        </div>
      )}

      {detail.implants.length > 0 && (
        <div className="top-list">
          <h4>{tr("Implantes")} ({detail.implants.length})</h4>
          <div className="ch-implant-list">
            {detail.implants.map((im) => (
              <span className="ch-implant" key={im.type_id} title={im.name ?? `#${im.type_id}`}>
                <img src={typeIcon(im.type_id, 32)} alt="" loading="lazy" />
                <span>{im.name ?? `#${im.type_id}`}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {bio && (
        <details className="ch-bio">
          <summary>{tr("Biografía")}</summary>
          <p>{bio}</p>
        </details>
      )}
    </div>
  );
}

function SkillsView(props: { data: SkillsSummary | null; busy: boolean }) {
  const { data, busy } = props;
  return (
    <>
      {!data && busy && <p className="muted">{tr("Cargando…")}</p>}
      {data && (
        <>
          <div className="kpis">
            <Kpi label={tr("SP total")} value={fmtSp(data.total_sp)} />
            <Kpi label={tr("SP sin asignar")} value={fmtSp(data.unallocated_sp)} />
            <Kpi label={tr("Skills")} value={data.skill_count} />
            <Kpi label={tr("En cola")} value={data.queue.length} />
          </div>
          <h4>{tr("Cola de entrenamiento")}</h4>
          {data.queue.length === 0 && <p className="muted small">{tr("Cola vacía.")}</p>}
          {data.queue.length > 0 && (
            <table className="km-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Skill</th>
                  <th>{tr("Nivel")}</th>
                  <th>{tr("Termina")}</th>
                </tr>
              </thead>
              <tbody>
                {data.queue.map((q) => (
                  <tr key={q.queue_position}>
                    <td>{q.queue_position + 1}</td>
                    <td>{q.skill_name ?? `#${q.skill_id}`}</td>
                    <td>{q.finished_level}</td>
                    <td>{q.finish_date?.replace("T", " ").slice(0, 16) ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </>
  );
}


/** Etiqueta de semana ISO (YYYY-Sww) a partir de una fecha YYYY-MM-DD. */
function weekKey(date: string): string {
  const dt = new Date(date + "T00:00:00Z");
  const dayNr = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dayNr + 3); // jueves de esa semana
  const firstThursday = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      (dt.getTime() - firstThursday.getTime()) / 86400000 / 7 -
        ((firstThursday.getUTCDay() + 6) % 7) / 7,
    );
  return `${dt.getUTCFullYear()}-S${String(week).padStart(2, "0")}`;
}


function RivalList(props: { title: string; items: RivalEntry[]; kind: "char" | "corp" }) {
  const { title, items, kind } = props;
  const img = (id: number) =>
    kind === "char"
      ? `https://images.evetech.net/characters/${id}/portrait?size=32`
      : `https://images.evetech.net/corporations/${id}/logo?size=32`;
  const url = (id: number) =>
    kind === "char"
      ? `https://zkillboard.com/character/${id}/`
      : `https://zkillboard.com/corporation/${id}/`;
  return (
    <div className="rival-list">
      <h4>{title}</h4>
      {items.length === 0 && <p className="muted small">{tr("Sin datos.")}</p>}
      <ol>
        {items.map((e) => (
          <li key={e.id} className="rival-row" onClick={() => openUrl(url(e.id))} title={tr("Abrir en zKillboard")}>
            <img className="rival-img" src={img(e.id)} alt="" loading="lazy" />
            <span className="rival-name">{e.name ?? `#${e.id}`}</span>
            <span className="muted">{e.count}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function BattlesView(props: { data: Battle[] | null; busy: boolean }) {
  const { data, busy } = props;
  if (!data && busy) return <p className="muted">{tr("Cargando…")}</p>;
  if (!data || data.length === 0)
    return (
      <p className="muted small">
        {tr("Sin batallas detectadas. Sincroniza el histórico (y pulsa \"Reprocesar daño\") para tener los datos.")}
      </p>
    );
  return (
    <>
      <p className="muted small">
        {tr("Peleas detectadas (≥8 killmails en un sistema en menos de 1h). Click en una fila → battle report en zKillboard.")}
      </p>
      <table className="km-table">
        <thead>
          <tr>
            <th>{tr("Sistema")}</th>
            <th>{tr("Fecha")}</th>
            <th>{tr("Kills")}</th>
            <th>{tr("Losses")}</th>
            <th>ISK</th>
            <th>{tr("Total")}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((b) => (
            <tr
              key={`${b.system_id}-${b.slug}`}
              className="clickable"
              title={tr("Abrir battle report en zKillboard")}
              onClick={() => openUrl(`https://zkillboard.com/related/${b.system_id}/${b.slug}/`)}
            >
              <td>{b.system_name ?? `#${b.system_id}`}</td>
              <td>{b.start.replace("T", " ").slice(0, 16)}</td>
              <td>{b.kills}</td>
              <td>{b.losses}</td>
              <td>{fmtIsk(b.isk)}</td>
              <td>
                <strong>{b.total}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function RivalsView(props: { data: Rivals | null; busy: boolean }) {
  const { data, busy } = props;
  if (!data && busy) return <p className="muted">{tr("Cargando…")}</p>;
  if (!data) return <p className="muted small">{tr("Sin datos. Sincroniza killmails y pulsa \"Reprocesar daño\".")}</p>;
  return (
    <>
      <p className="muted small">
        {tr("Basado en tus killmails (necesita el JSON completo: si está vacío, pulsa \"Reprocesar daño\" en PvP).")}
      </p>
      {(data.you_kill_chars.length > 0 || data.kills_you_chars.length > 0) && (
        <div className="rivals-charts">
          <div className="panel resumen-panel">
            <h4>{tr("A quién más matas (top)")}</h4>
            <Bars
              items={data.you_kill_chars
                .slice(0, 8)
                .map((r) => ({ label: r.name ?? `#${r.id}`, value: r.count }))}
              color="#3fb950"
            />
          </div>
          <div className="panel resumen-panel">
            <h4>{tr("Quién más te mata (top)")}</h4>
            <Bars
              items={data.kills_you_chars
                .slice(0, 8)
                .map((r) => ({ label: r.name ?? `#${r.id}`, value: r.count }))}
              color="#e5534b"
            />
          </div>
        </div>
      )}
      <div className="rivals-grid">
        <RivalList title={tr("A quién más matas")} items={data.you_kill_chars} kind="char" />
        <RivalList title={tr("Corps que más matas")} items={data.you_kill_corps} kind="corp" />
        <RivalList title={tr("Quién más te mata")} items={data.kills_you_chars} kind="char" />
        <RivalList title={tr("Corps que más te matan")} items={data.kills_you_corps} kind="corp" />
      </div>
    </>
  );
}

function GlobalSkillsView(props: { data: GlobalSkills | null; busy: boolean }) {
  const { data, busy } = props;
  return (
    <>
      {!data && busy && <p className="muted">Cargando…</p>}
      {data && (
        <>
          <div className="kpis">
            <Kpi label={tr("SP total")} value={fmtSp(data.total_sp)} />
            <Kpi label={tr("SP sin asignar")} value={fmtSp(data.unallocated_sp)} />
            <Kpi label={tr("Skills")} value={fmtSp(data.skill_count)} />
            <Kpi label={tr("Personajes")} value={data.character_count} />
          </div>
          <h4>{tr("Entrenando ahora")}</h4>
          {data.training.length === 0 && <p className="muted small">{tr("Sin datos.")}</p>}
          {data.training.length > 0 && (
            <table className="km-table">
              <thead>
                <tr>
                  <th>{tr("Personaje")}</th>
                  <th>Skill</th>
                  <th>{tr("Nivel")}</th>
                  <th>{tr("Termina")}</th>
                </tr>
              </thead>
              <tbody>
                {data.training.map((t) => (
                  <tr key={t.character_id}>
                    <td>{t.character_name}</td>
                    <td>{t.skill_name ?? (t.skill_id ? `#${t.skill_id}` : tr("— sin entrenar —"))}</td>
                    <td>{t.skill_id ? t.finished_level : "-"}</td>
                    <td>{t.finish_date?.replace("T", " ").slice(0, 16) ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </>
  );
}

// Fecha (YYYY-MM-DD) de hace N días, para acotar las gráficas a una ventana reciente por defecto.
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}
// Presets de rango reutilizables para todas las gráficas temporales: 90 días (defecto) · Este año ·
// selector de año concreto · Todo. Evita mostrar de golpe el acumulado histórico (poco fiel a "ahora").
function RangePresets({
  from,
  to,
  setFrom,
  setTo,
  years,
}: {
  from: string;
  to: string;
  setFrom: (s: string) => void;
  setTo: (s: string) => void;
  years?: number[];
}) {
  const year = new Date().getUTCFullYear();
  const isAll = !from && !to;
  const pickedYear = from.endsWith("-01-01") && to.endsWith("-12-31") && from.slice(0, 4) === to.slice(0, 4) ? from.slice(0, 4) : "";
  return (
    <div className="range-presets">
      <div className="seg seg-sm">
        <button
          className={from === daysAgo(90) && !to ? "active" : ""}
          onClick={() => {
            setFrom(daysAgo(90));
            setTo("");
          }}
        >
          {tr("90 días")}
        </button>
        <button
          className={from === `${year}-01-01` && !to ? "active" : ""}
          onClick={() => {
            setFrom(`${year}-01-01`);
            setTo("");
          }}
        >
          {tr("Este año")}
        </button>
        <button className={isAll ? "active" : ""} onClick={() => { setFrom(""); setTo(""); }}>
          {tr("Todo")}
        </button>
      </div>
      {years && years.length > 0 && (
        <select
          className="range-year"
          value={pickedYear}
          onChange={(e) => {
            const y = e.target.value;
            if (y) {
              setFrom(`${y}-01-01`);
              setTo(`${y}-12-31`);
            }
          }}
        >
          <option value="">{tr("Año…")}</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// Cabecera de tabla ordenable reutilizable. Click → ordena por esa columna; reclick → invierte.
function RateoView({
  data,
  special,
  charNames,
  paperSeries,
  abyssals,
  busy,
}: {
  data: RattingDetail | null;
  special: SpecialRatsResult | null;
  charNames: Map<number, string>;
  paperSeries: PaperSeries | null;
  abyssals: AbyssalsData | null;
  busy: boolean;
}) {
  const [gran, setGran] = useState<"day" | "week" | "month" | "year">(
    () => (localStorage.getItem("koru-rateo-gran") as "day" | "week" | "month" | "year") || "day",
  );
  const cumulative: boolean = false; // "Acumulado" retirado; los presets de rango lo sustituyen.
  const [from, setFrom] = useState(daysAgo(90));
  const [to, setTo] = useState("");
  const [dim, setDim] = useState<"sys" | "char">(
    () => (localStorage.getItem("koru-rateo-dim") as "sys" | "char") || "sys",
  );
  const [names, setNames] = useState<Map<number, string>>(new Map());
  useEffect(() => {
    localStorage.setItem("koru-rateo-gran", gran);
  }, [gran]);
  useEffect(() => {
    localStorage.setItem("koru-rateo-dim", dim);
  }, [dim]);

  useEffect(() => {
    loadNewEden()
      .then((ne) => setNames(new Map(ne.systems.map((s) => [s.id, s.n]))))
      .catch(() => {});
  }, []);

  if (!data)
    return (
      <>
        <p className="muted">{busy ? tr("Cargando…") : tr("Sin datos.")}</p>
        <PapersBlock series={paperSeries} data={abyssals} />
      </>
    );
  if (data.entries === 0)
    return (
      <>
        <p className="muted small">
          {tr("Sin ingresos de rateo en el journal. Sincroniza la wallet del personaje (sección Wallet) para empezar a acumular el histórico en tu PC.")}
        </p>
        <PapersBlock series={paperSeries} data={abyssals} />
      </>
    );

  const sysName = (id: number) => names.get(id) ?? `#${id}`;
  const granLabel =
    gran === "day" ? tr("día") : gran === "week" ? tr("semana") : gran === "month" ? tr("mes") : tr("año");

  // Filtra por rango de fechas (YYYY-MM-DD) y agrupa por granularidad.
  const daily = data.daily.filter((d) => (!from || d.date >= from) && (!to || d.date <= to));
  const bucketKey = (date: string) =>
    gran === "year"
      ? date.slice(0, 4)
      : gran === "month"
        ? date.slice(0, 7)
        : gran === "week"
          ? weekKey(date)
          : date;
  const buckets = new Map<string, { isk: number; rats: number }>();
  for (const d of daily) {
    const k = bucketKey(d.date);
    const e = buckets.get(k) ?? { isk: 0, rats: 0 };
    e.isk += d.bounty + d.ess;
    e.rats += d.rats;
    buckets.set(k, e);
  }
  let series = [...buckets.entries()].map(([label, v]) => ({ label, isk: v.isk, rats: v.rats }));
  if (cumulative) {
    let accI = 0;
    let accR = 0;
    series = series.map((s) => ({ ...s, isk: (accI += s.isk), rats: (accR += s.rats) }));
  }

  // KPIs del RANGO seleccionado (no del histórico entero) → más fiel a "lo de ahora".
  const rangeBounty = daily.reduce((a, d) => a + d.bounty, 0);
  const rangeEss = daily.reduce((a, d) => a + d.ess, 0);
  const rangeRats = daily.reduce((a, d) => a + d.rats, 0);
  const totalIsk = rangeBounty + rangeEss;
  // Total histórico (para el % del "Detalle por sistema", que sigue siendo all-time por datos).
  const allTimeIsk = data.total_bounty + data.total_ess;
  // ISK/hora estimado: escala las horas activas totales por la fracción de días activos en el rango.
  const totalActiveDays = data.daily.filter((d) => d.bounty + d.ess > 0).length;
  const rangeActiveDays = daily.filter((d) => d.bounty + d.ess > 0).length;
  const rangeHours =
    totalActiveDays > 0 ? (data.active_hours * rangeActiveDays) / totalActiveDays : 0;
  const iskPerHour = rangeHours > 0 ? totalIsk / rangeHours : 0;
  const rateoYears = [...new Set(data.daily.map((d) => +d.date.slice(0, 4)))].sort((a, b) => b - a);
  const topSystems = data.by_system.slice(0, 12);

  // Series por sistema (top 6) alineadas con los mismos buckets que la línea total.
  const labels = series.map((s) => s.label);
  const sysBuckets = new Map<number, Map<string, number>>();
  for (const r of data.daily_by_system) {
    if ((from && r.date < from) || (to && r.date > to)) continue;
    const k = bucketKey(r.date);
    let m = sysBuckets.get(r.system_id);
    if (!m) {
      m = new Map();
      sysBuckets.set(r.system_id, m);
    }
    m.set(k, (m.get(k) ?? 0) + r.isk);
  }
  const sysVals = (sysId: number) => {
    const m = sysBuckets.get(sysId);
    let acc = 0;
    return labels.map((lab) => {
      const v = m?.get(lab) ?? 0;
      return cumulative ? (acc += v) : v;
    });
  };
  const sysLineSeries = [
    { name: tr("Total"), color: "#c8d3df", values: series.map((s) => s.isk) },
    ...data.by_system.slice(0, 6).map((s, i) => ({
      name: sysName(s.system_id),
      color: DONUT_COLORS[i % DONUT_COLORS.length],
      values: sysVals(s.system_id),
    })),
  ];

  // Series por PERSONAJE (quién aporta más ISK). Solo útil en global (varios pj).
  const charBuckets = new Map<number, Map<string, number>>();
  for (const r of data.daily_by_char) {
    if ((from && r.date < from) || (to && r.date > to)) continue;
    const k = bucketKey(r.date);
    let m = charBuckets.get(r.character_id);
    if (!m) {
      m = new Map();
      charBuckets.set(r.character_id, m);
    }
    m.set(k, (m.get(k) ?? 0) + r.isk);
  }
  const charTotals = [...charBuckets.entries()]
    .map(([id, m]) => ({ id, total: [...m.values()].reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total);
  const charVals = (id: number) => {
    const m = charBuckets.get(id);
    let acc = 0;
    return labels.map((lab) => {
      const v = m?.get(lab) ?? 0;
      return cumulative ? (acc += v) : v;
    });
  };
  const charLineSeries = [
    { name: tr("Total"), color: "#c8d3df", values: series.map((s) => s.isk) },
    ...charTotals.slice(0, 8).map((c, i) => ({
      name: charNames.get(c.id) ?? `#${c.id}`,
      color: DONUT_COLORS[i % DONUT_COLORS.length],
      values: charVals(c.id),
    })),
  ];
  const multiChar = charTotals.length > 1; // solo ofrecer "por personaje" si hay varios
  const lineSeries = dim === "char" && multiChar ? charLineSeries : sysLineSeries;

  return (
    <>
      <div className="kpis">
        <Kpi label={tr("ISK total (bounty + ESS)")} value={fmtIsk(totalIsk)} tone="pos" />
        <Kpi label={tr("Bounties")} value={fmtIsk(rangeBounty)} tone="pos" />
        <Kpi label={tr("ESS")} value={fmtIsk(rangeEss)} tone="pos" />
        <Kpi label={tr("Ratas eliminadas")} value={fmtSp(rangeRats)} />
        <Kpi
          label={tr("Ratas especiales")}
          value={special ? fmtSp(special.total) : "…"}
          tone={special && special.total > 0 ? "pos" : undefined}
        />
        <Kpi label={tr("ISK / hora (estim.)")} value={fmtIsk(iskPerHour)} />
      </div>

      <div className="rateo-controls">
        <div className="seg">
          {(["day", "week", "month"] as const).map((g) => (
            <button key={g} className={gran === g ? "active" : ""} onClick={() => setGran(g)}>
              {g === "day" ? tr("Día") : g === "week" ? tr("Semana") : g === "month" ? tr("Mes") : tr("Año")}
            </button>
          ))}
        </div>
        <RangePresets from={from} to={to} setFrom={setFrom} setTo={setTo} years={rateoYears} />
        <label className="rateo-date">
          {tr("Desde")} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="rateo-date">
          {tr("Hasta")} <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {(from || to) && (
          <button
            className="rateo-clear"
            onClick={() => {
              setFrom("");
              setTo("");
            }}
          >
            Limpiar
          </button>
        )}
      </div>

      <div className="top-list">
        <div className="rateo-charthead">
          <h4>
            {cumulative ? `ISK (${tr("acumulado")})` : "ISK"} {tr("por")} {granLabel}
          </h4>
          {multiChar && (
            <div className="seg seg-sm">
              <button className={dim === "sys" ? "active" : ""} onClick={() => setDim("sys")}>
                {tr("Por sistema")}
              </button>
              <button className={dim === "char" ? "active" : ""} onClick={() => setDim("char")}>
                {tr("Por personaje")}
              </button>
            </div>
          )}
        </div>
        <MultiLineProgress labels={labels} series={lineSeries} fmt={fmtIsk} />
      </div>

      {special && special.by_type.length > 0 && (
        <div className="top-list">
          <h4>
            {tr("Ratas especiales")} ·{" "}
            <span className="muted small">
              {special.officers} {tr("oficiales")} · {special.capitals} {tr("capitales")} ·{" "}
              {special.faction} {tr("faction")}
            </span>
          </h4>
          <div className="special-rats">
            {special.by_type.map((r) => (
              <div className="special-rat" key={r.type_id} title={r.name ?? `#${r.type_id}`}>
                <img src={typeIcon(r.type_id, 32)} alt="" width={26} height={26} />
                <span className="special-rat-name">{r.name ?? `#${r.type_id}`}</span>
                <span className={`special-rat-tag ${r.class}`}>
                  {r.class === "officer"
                    ? tr("Oficial")
                    : r.class === "capital"
                      ? tr("Capital")
                      : tr("Faction")}
                </span>
                <span className="special-rat-count">×{fmtSp(r.count)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {special == null && (
        <div className="top-list">
          <p className="muted small">{tr("Calculando ratas especiales… (puede tardar la 1ª vez)")}</p>
        </div>
      )}

      <div className="top-list">
        <h4>{tr("Detalle por sistema")}</h4>
        <table className="km-table">
          <thead>
            <tr>
              <th>{tr("Sistema")}</th>
              <th>ISK</th>
              <th>%</th>
              <th>ISK/h</th>
              <th>Bounty</th>
              <th>ESS</th>
              <th>{tr("Ratas")}</th>
              <th>{tr("Ratas especiales")}</th>
            </tr>
          </thead>
          <tbody>
            {topSystems.map((s) => {
              const sp = special?.by_system.find((b) => b.system_id === s.system_id);
              const pct = allTimeIsk > 0 ? (s.isk / allTimeIsk) * 100 : 0;
              const iskH = s.active_hours > 0 ? s.isk / s.active_hours : 0;
              return (
                <tr key={s.system_id}>
                  <td>{sysName(s.system_id)}</td>
                  <td>{fmtIsk(s.isk)}</td>
                  <td className="muted">{pct.toFixed(1)}%</td>
                  <td>{s.active_hours > 0 ? fmtIsk(iskH) : "—"}</td>
                  <td>{fmtIsk(s.bounty)}</td>
                  <td>{fmtIsk(s.ess)}</td>
                  <td>{fmtSp(s.rats)}</td>
                  <td>
                    {sp ? (
                      <div className="sys-special">
                        {sp.by_type.map((r) => (
                          <span
                            key={r.type_id}
                            className={`special-rat-tag ${r.class}`}
                            title={`${r.name ?? `#${r.type_id}`} ×${r.count} (${
                              r.class === "officer"
                                ? tr("Oficial")
                                : r.class === "capital"
                                  ? tr("Capital")
                                  : tr("Faction")
                            })`}
                          >
                            {r.name ?? `#${r.type_id}`} ×{r.count}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <PapersBlock series={paperSeries} data={abyssals} />
    </>
  );
}

/* ---------- Resumen (dashboard financiero) ---------- */
const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
function DeltaBadge({ cur, prev, invert = false }: { cur: number; prev: number; invert?: boolean }) {
  let txt: string;
  let dir: number; // 1 sube, -1 baja, 0 igual
  if (prev === 0) {
    if (cur === 0) {
      txt = "—";
      dir = 0;
    } else {
      txt = tr("nuevo");
      dir = 1;
    }
  } else {
    const p = ((cur - prev) / Math.abs(prev)) * 100;
    const arrow = p > 0 ? "↑" : p < 0 ? "↓" : "→";
    txt = `${arrow} ${Math.abs(p).toFixed(1)}%`;
    dir = p > 0.05 ? 1 : p < -0.05 ? -1 : 0;
  }
  const good = invert ? dir < 0 : dir > 0;
  const bad = invert ? dir > 0 : dir < 0;
  const cls = good ? "delta-pos" : bad ? "delta-neg" : "delta-flat";
  return <span className={`delta ${cls}`}>{txt}</span>;
}

function CatTable({ rows, invert }: { rows: CategorySum[]; invert: boolean }) {
  if (rows.length === 0) return <p className="muted small">{tr("Sin movimientos.")}</p>;
  return (
    <table className="km-table cat-table">
      <thead>
        <tr>
          <th>{tr("Categoría")}</th>
          <th style={{ textAlign: "right" }}>ISK</th>
          <th style={{ textAlign: "right" }}>{tr("vs anterior")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>
              <span className="cat-dot" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
              {tr(r.category)}
            </td>
            <td style={{ textAlign: "right" }}>{fmtIsk(r.isk)}</td>
            <td style={{ textAlign: "right" }}>
              <DeltaBadge cur={r.isk} prev={r.prev_isk} invert={invert} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ResumenView({ subject }: { subject: number | "global" }) {
  const isGlobal = subject === "global";
  const [periods, setPeriods] = useState<string[] | null>(null);
  const [period, setPeriod] = useState<string>("");
  const [data, setData] = useState<FinancialSummary | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const ps = isGlobal
          ? await invoke<string[]>("get_summary_periods_global")
          : await invoke<string[]>("get_summary_periods", { characterId: subject });
        if (!alive) return;
        setPeriods(ps);
        setPeriod((p) => (p && ps.includes(p) ? p : ps[0] ?? ""));
      } catch {
        if (alive) setPeriods([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [subject]);

  useEffect(() => {
    if (!period) return;
    let alive = true;
    setBusy(true);
    (async () => {
      try {
        const d = isGlobal
          ? await invoke<FinancialSummary>("get_summary_global", { period })
          : await invoke<FinancialSummary>("get_summary", { characterId: subject, period });
        if (alive) setData(d);
      } catch {
        if (alive) setData(null);
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [subject, period]);

  if (periods === null) return <p className="muted">{tr("Cargando…")}</p>;
  if (periods.length === 0)
    return (
      <p className="muted small">
        {tr("Sin movimientos en el journal. Sincroniza la wallet de tus personajes (sección Wallet) para ver tu resumen.")}
      </p>
    );

  const years = [...new Set(periods.map((p) => p.slice(0, 4)))];
  const curYear = period.slice(0, 4);
  const curMonth = period.slice(5, 7);
  const monthsOfYear = periods.filter((p) => p.startsWith(curYear));

  return (
    <>
      <div className="resumen-period">
        <span className="rp-label">📅 {tr("Período")}</span>
        <select
          value={curYear}
          onChange={(e) => {
            const y = e.target.value;
            const first = periods.find((p) => p.startsWith(y));
            if (first) setPeriod(first);
          }}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <select value={period} onChange={(e) => setPeriod(e.target.value)}>
          {monthsOfYear.map((p) => (
            <option key={p} value={p}>
              {tr(MONTH_NAMES[parseInt(p.slice(5, 7), 10) - 1])}
            </option>
          ))}
        </select>
        <span className="rp-show">
          {tr("Mostrando")} {tr(MONTH_NAMES[parseInt(curMonth, 10) - 1])} {curYear}
          {busy ? ` · ${tr("actualizando…")}` : ""}
        </span>
      </div>

      {data && (
        <>
          <div className="resumen-kpis">
            <div className="rk-card rk-net">
              <span className="rk-label">{tr("Balance del mes")}</span>
              <span className={`rk-value ${data.net >= 0 ? "pos" : "neg"}`}>{fmtIsk(data.net)} ISK</span>
              <DeltaBadge cur={data.net} prev={data.prev_net} />
            </div>
            <div className="rk-card rk-in">
              <span className="rk-label">↑ {tr("Ingresos")}</span>
              <span className="rk-value pos">{fmtIsk(data.income_total)}</span>
              <DeltaBadge cur={data.income_total} prev={data.prev_income_total} />
            </div>
            <div className="rk-card rk-out">
              <span className="rk-label">↓ {tr("Gastos")}</span>
              <span className="rk-value neg">{fmtIsk(data.expense_total)}</span>
              <DeltaBadge cur={data.expense_total} prev={data.prev_expense_total} invert />
            </div>
          </div>

          <div className="resumen-grid">
            <div className="panel resumen-panel">
              <h4>{tr("Distribución de ingresos")}</h4>
              <Donut items={data.income_by_category.map((c) => ({ label: c.category, value: c.isk }))} fmt={fmtIsk} />
            </div>
            <div className="panel resumen-panel">
              <h4>{tr("Ingresos por categoría")}</h4>
              <CatTable rows={data.income_by_category} invert={false} />
            </div>
            <div className="panel resumen-panel">
              <h4>{tr("Distribución de gastos")}</h4>
              <Donut items={data.expense_by_category.map((c) => ({ label: c.category, value: c.isk }))} fmt={fmtIsk} />
            </div>
            <div className="panel resumen-panel">
              <h4>{tr("Gastos por categoría")}</h4>
              <CatTable rows={data.expense_by_category} invert={true} />
            </div>
          </div>
        </>
      )}
    </>
  );
}

/* ---------- Actividad PvP (diaria + horas calientes) ---------- */
function KLColumns({
  items,
  labelEvery = 1,
}: {
  items: { label: string; kills: number; losses: number }[];
  labelEvery?: number;
}) {
  if (items.length === 0) return <p className="muted small">Sin actividad.</p>;
  const max = Math.max(...items.map((i) => i.kills + i.losses), 1);
  return (
    <div className="klcols">
      {items.map((it, i) => (
        <div
          className="klcol"
          key={i}
          title={`${it.label} · ${it.kills} kills / ${it.losses} losses`}
        >
          <div className="klcol-bars">
            <div className="klcol-loss" style={{ height: `${(it.losses / max) * 100}%` }} />
            <div className="klcol-kill" style={{ height: `${(it.kills / max) * 100}%` }} />
          </div>
          <span className="klcol-label">{i % labelEvery === 0 ? it.label : ""}</span>
        </div>
      ))}
    </div>
  );
}

function ActividadView({ subject }: { subject: number | "global" }) {
  const isGlobal = subject === "global";
  const [periods, setPeriods] = useState<string[] | null>(null);
  const [period, setPeriod] = useState<string>("");
  const [data, setData] = useState<PvpActivity | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const ps = isGlobal
          ? await invoke<string[]>("get_pvp_periods_global")
          : await invoke<string[]>("get_pvp_periods", { characterId: subject });
        if (!alive) return;
        setPeriods(ps);
        setPeriod((p) => (p && ps.includes(p) ? p : ps[0] ?? ""));
      } catch {
        if (alive) setPeriods([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [subject]);

  useEffect(() => {
    if (!period) return;
    let alive = true;
    setBusy(true);
    (async () => {
      try {
        const d = isGlobal
          ? await invoke<PvpActivity>("get_pvp_activity_global", { period })
          : await invoke<PvpActivity>("get_pvp_activity", { characterId: subject, period });
        if (alive) setData(d);
      } catch {
        if (alive) setData(null);
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [subject, period]);

  if (periods === null) return <p className="muted">{tr("Cargando…")}</p>;
  if (periods.length === 0)
    return (
      <p className="muted small">
        {tr("Sin killmails registrados. Sincroniza el PvP de tus personajes para ver tu actividad.")}
      </p>
    );

  const years = [...new Set(periods.map((p) => p.slice(0, 4)))];
  const curYear = period.slice(0, 4);
  const curMonth = period.slice(5, 7);
  const monthsOfYear = periods.filter((p) => p.startsWith(curYear));

  return (
    <>
      <div className="resumen-period">
        <span className="rp-label">📅 {tr("Período")}</span>
        <select
          value={curYear}
          onChange={(e) => {
            const first = periods.find((p) => p.startsWith(e.target.value));
            if (first) setPeriod(first);
          }}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <select value={period} onChange={(e) => setPeriod(e.target.value)}>
          {monthsOfYear.map((p) => (
            <option key={p} value={p}>
              {tr(MONTH_NAMES[parseInt(p.slice(5, 7), 10) - 1])}
            </option>
          ))}
        </select>
        <span className="rp-show">
          {tr("Mostrando")} {tr(MONTH_NAMES[parseInt(curMonth, 10) - 1])} {curYear}
          {busy ? ` · ${tr("actualizando…")}` : ""}
        </span>
      </div>

      {data && (
        <>
          <div className="resumen-kpis act-kpis">
            <div className="rk-card rk-in">
              <span className="rk-label">{tr("Kills")}</span>
              <span className="rk-value pos">{fmtSp(data.kills)}</span>
              <span className="muted small">{fmtIsk(data.isk_destroyed)} ISK</span>
            </div>
            <div className="rk-card rk-out">
              <span className="rk-label">{tr("Losses")}</span>
              <span className="rk-value neg">{fmtSp(data.losses)}</span>
              <span className="muted small">{fmtIsk(data.isk_lost)} ISK</span>
            </div>
            <div className="rk-card rk-net">
              <span className="rk-label">{tr("Eficacia ISK")}</span>
              <span className="rk-value">{data.efficiency.toFixed(1)}%</span>
            </div>
          </div>

          <div className="top-list">
            <h4>{tr("Actividad diaria")} · {tr(MONTH_NAMES[parseInt(curMonth, 10) - 1])} {curYear}</h4>
            <KLColumns
              items={data.daily.map((d) => ({
                label: d.date.slice(8, 10),
                kills: d.kills,
                losses: d.losses,
              }))}
            />
            <KLLegend />
          </div>

          <div className="top-list">
            <h4>🔥 {tr("Horas calientes (UTC EVE)")}</h4>
            <KLColumns
              items={data.hourly.map((h) => ({
                label: String(h.hour).padStart(2, "0"),
                kills: h.kills,
                losses: h.losses,
              }))}
            />
            <KLLegend />
          </div>
        </>
      )}
    </>
  );
}

function KLLegend() {
  return (
    <div className="kl-legend">
      <span>
        <span className="kl-dot kl-dot-kill" /> {tr("Kills")}
      </span>
      <span>
        <span className="kl-dot kl-dot-loss" /> {tr("Losses")}
      </span>
    </div>
  );
}

/* ---------- Minería pro ---------- */
function MineriaView({
  subject,
  charNames,
  onSyncMining,
}: {
  subject: number | "global";
  charNames: Map<number, string>;
  onSyncMining?: (id: number) => Promise<void>;
}) {
  const isGlobal = subject === "global";
  const [series, setSeries] = useState<MiningSeries | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [names, setNames] = useState<Map<number, string>>(new Map());
  const [gran, setGran] = useState<"day" | "week" | "month" | "year">(
    () => (localStorage.getItem("koru-mineria-gran") as "day" | "week" | "month" | "year") || "month",
  );
  const cumulative: boolean = false; // "Acumulado" retirado; los presets de rango lo sustituyen.
  const [from, setFrom] = useState(daysAgo(90));
  const [to, setTo] = useState("");
  const [dim, setDim] = useState<"sys" | "char" | "ore">(
    () => (localStorage.getItem("koru-mineria-dim") as "sys" | "char" | "ore") || "ore",
  );
  const [mode, setMode] = useState<"units" | "m3" | "bruto" | "comp" | "reproc">(
    () => (localStorage.getItem("koru-mineria-mode") as "units" | "m3" | "bruto" | "comp" | "reproc") || "bruto",
  );
  useEffect(() => {
    localStorage.setItem("koru-mineria-gran", gran);
  }, [gran]);
  useEffect(() => {
    localStorage.setItem("koru-mineria-dim", dim);
  }, [dim]);
  useEffect(() => {
    localStorage.setItem("koru-mineria-mode", mode);
  }, [mode]);

  useEffect(() => {
    loadNewEden()
      .then((ne) => setNames(new Map(ne.systems.map((s) => [s.id, s.n]))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    (async () => {
      try {
        const d = isGlobal
          ? await invoke<MiningSeries>("get_mining_series_global", { mode })
          : await invoke<MiningSeries>("get_mining_series", { characterId: subject, mode });
        if (alive) setSeries(d);
      } catch {
        if (alive) setSeries(null);
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [subject, reload, mode]);

  async function doSync() {
    if (typeof subject !== "number" || !onSyncMining) return;
    await onSyncMining(subject);
    setReload((r) => r + 1);
  }

  if (!series) return <p className="muted">{busy ? tr("Cargando…") : tr("Sin datos.")}</p>;
  if (series.daily.length === 0)
    return (
      <p className="muted small">
        {tr("Sin registro de minería. Sincroniza la minería de tus personajes (sección Industria) para ver tu histórico.")}
      </p>
    );

  const sysName = (id: number) => names.get(id) ?? `#${id}`;
  const oreNames = new Map(series.ore_names);
  const oreName = (id: number) => oreNames.get(id) ?? `#${id}`;
  const granLabel =
    gran === "day" ? tr("día") : gran === "week" ? tr("semana") : gran === "month" ? tr("mes") : tr("año");
  // Formato y etiqueta según el modo de valoración.
  const valFmt =
    mode === "units"
      ? (n: number) => fmtSp(Math.round(n))
      : mode === "m3"
        ? (n: number) => `${fmtSp(Math.round(n))} m³`
        : fmtIsk;
  const modeLabel =
    mode === "units"
      ? tr("Unidades")
      : mode === "m3"
        ? "m³"
        : mode === "comp"
          ? tr("Valor comprimido")
          : mode === "reproc"
            ? tr("Valor reprocesado 85%")
            : tr("Valor bruto");

  const inRange = (date: string) => (!from || date >= from) && (!to || date <= to);
  const bucketKey = (date: string) =>
    gran === "year"
      ? date.slice(0, 4)
      : gran === "month"
        ? date.slice(0, 7)
        : gran === "week"
          ? weekKey(date)
          : date;

  // Serie Total (valor ISK por bucket).
  const tot = new Map<string, number>();
  for (const d of series.daily) {
    if (!inRange(d.date)) continue;
    const k = bucketKey(d.date);
    tot.set(k, (tot.get(k) ?? 0) + d.value);
  }
  const totalSeries = [...tot.entries()].map(([label, value]) => ({ label, value }));
  const labels = totalSeries.map((s) => s.label);
  const totVals = () => {
    let acc = 0;
    return totalSeries.map((s) => (cumulative ? (acc += s.value) : s.value));
  };

  const dimBuckets = (rows: MineDimDay[]) => {
    const m = new Map<number, Map<string, number>>();
    for (const r of rows) {
      if (!inRange(r.date)) continue;
      const k = bucketKey(r.date);
      let mm = m.get(r.id);
      if (!mm) {
        mm = new Map();
        m.set(r.id, mm);
      }
      mm.set(k, (mm.get(k) ?? 0) + r.value);
    }
    return m;
  };
  const mkVals = (m: Map<string, number> | undefined) => {
    let acc = 0;
    return labels.map((l) => {
      const v = m?.get(l) ?? 0;
      return cumulative ? (acc += v) : v;
    });
  };
  const buildDim = (rows: MineDimDay[], nameFn: (id: number) => string) => {
    const m = dimBuckets(rows);
    const totals = [...m.entries()]
      .map(([id, mm]) => ({ id, total: [...mm.values()].reduce((a, b) => a + b, 0) }))
      .sort((a, b) => b.total - a.total);
    return totals.slice(0, 8).map((t, i) => ({
      name: nameFn(t.id),
      color: DONUT_COLORS[i % DONUT_COLORS.length],
      values: mkVals(m.get(t.id)),
    }));
  };
  const totalLine = { name: tr("Total"), color: "#c8d3df", values: totVals() };
  const sysSeries = [totalLine, ...buildDim(series.daily_by_system, sysName)];
  const charSeries = [totalLine, ...buildDim(series.daily_by_char, (id) => charNames.get(id) ?? `#${id}`)];
  const oreSeries = [totalLine, ...buildDim(series.daily_by_ore, oreName)];
  const multiChar = new Set(series.daily_by_char.map((r) => r.id)).size > 1;
  const lineSeries = dim === "char" && multiChar ? charSeries : dim === "ore" ? oreSeries : sysSeries;

  // "Mineral extraído" (agregado al rango filtrado) desde daily_by_ore.
  const oreAgg = new Map<number, { units: number; value: number }>();
  for (const r of series.daily_by_ore) {
    if (!inRange(r.date)) continue;
    const e = oreAgg.get(r.id) ?? { units: 0, value: 0 };
    e.units += r.units;
    e.value += r.value;
    oreAgg.set(r.id, e);
  }
  const oreRows = [...oreAgg.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.value - a.value);
  const rangeValue = oreRows.reduce((a, o) => a + o.value, 0);
  const rangeUnits = oreRows.reduce((a, o) => a + o.units, 0);
  const mineriaYears = [...new Set(series.daily_by_ore.map((r) => +r.date.slice(0, 4)))]
    .filter((y) => y > 0)
    .sort((a, b) => b - a);

  return (
    <>
      <div className="km-header">
        <div className="kpis" style={{ flex: 1 }}>
          <Kpi label={modeLabel} value={valFmt(rangeValue)} tone={mode === "units" || mode === "m3" ? undefined : "pos"} />
          <Kpi label={tr("Unidades minadas")} value={fmtSp(rangeUnits)} />
          <Kpi label={tr("Tipos de mineral")} value={fmtSp(oreRows.length)} />
        </div>
        {!isGlobal && (
          <button onClick={doSync} disabled={busy}>
            {busy ? tr("Trabajando…") : tr("Sincronizar minería")}
          </button>
        )}
      </div>

      <div className="rateo-controls">
        <div className="seg">
          {(["day", "week", "month"] as const).map((g) => (
            <button key={g} className={gran === g ? "active" : ""} onClick={() => setGran(g)}>
              {g === "day" ? tr("Día") : g === "week" ? tr("Semana") : g === "month" ? tr("Mes") : tr("Año")}
            </button>
          ))}
        </div>
        <RangePresets from={from} to={to} setFrom={setFrom} setTo={setTo} years={mineriaYears} />
        <label className="rateo-date">
          {tr("Desde")} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="rateo-date">
          {tr("Hasta")} <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {(from || to) && (
          <button
            className="rateo-clear"
            onClick={() => {
              setFrom("");
              setTo("");
            }}
          >
            Limpiar
          </button>
        )}
        <div className="seg seg-sm" title={tr("Cómo valorar lo minado")}>
          {(
            [
              ["units", "U"],
              ["m3", "m³"],
              ["bruto", tr("Bruto")],
              ["comp", tr("Comp.")],
              ["reproc", "85%"],
            ] as const
          ).map(([m, lbl]) => (
            <button key={m} className={mode === m ? "active" : ""} onClick={() => setMode(m)}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      <div className="top-list">
        <div className="rateo-charthead">
          <h4>
            {modeLabel}
            {cumulative ? ` (${tr("acumulado")})` : ""} {tr("por")} {granLabel}
          </h4>
          <div className="seg seg-sm">
            <button className={dim === "ore" ? "active" : ""} onClick={() => setDim("ore")}>
              {tr("Por mineral")}
            </button>
            <button className={dim === "sys" ? "active" : ""} onClick={() => setDim("sys")}>
              {tr("Por sistema")}
            </button>
            {multiChar && (
              <button className={dim === "char" ? "active" : ""} onClick={() => setDim("char")}>
                {tr("Por personaje")}
              </button>
            )}
          </div>
        </div>
        <MultiLineProgress labels={labels} series={lineSeries} fmt={valFmt} />
      </div>

      <div className="top-list">
        <h4>{tr("Mineral extraído")}</h4>
        {oreRows.length === 0 ? (
          <p className="muted small">{tr("Sin minería en el rango.")}</p>
        ) : (
          <table className="km-table cat-table">
            <thead>
              <tr>
                <th>{tr("Mineral")}</th>
                <th style={{ textAlign: "right" }}>{tr("Unidades")}</th>
                <th style={{ textAlign: "right" }}>{modeLabel}</th>
              </tr>
            </thead>
            <tbody>
              {oreRows.map((o) => (
                <tr key={o.id}>
                  <td>
                    <TypeIcon typeId={o.id} />
                    {oreName(o.id)}
                  </td>
                  <td style={{ textAlign: "right" }}>{fmtSp(o.units)}</td>
                  <td style={{ textAlign: "right" }}>{valFmt(o.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

/* ---------- PvE: Factional + Abyssals ---------- */
function FactionalSection({ data, busy }: { data: FactionalData | null; busy: boolean }) {
  if (!data) return <p className="muted">{busy ? tr("Cargando…") : tr("Sin datos.")}</p>;
  if (!data.enlisted)
    return (
      <p className="muted small">
        {tr("Este personaje no está enlistado en la Guerra de Facciones.")}
      </p>
    );
  const fac = data.faction_id ? FW_FACTIONS[data.faction_id] : null;
  const counts = (c: FactionalData["kills"]) => (
    <table className="km-table cat-table">
      <tbody>
        <tr>
          <td>{tr("Ayer")}</td>
          <td style={{ textAlign: "right" }}>{fmtSp(c.yesterday)}</td>
        </tr>
        <tr>
          <td>{tr("Última semana")}</td>
          <td style={{ textAlign: "right" }}>{fmtSp(c.last_week)}</td>
        </tr>
        <tr>
          <td>{tr("Total")}</td>
          <td style={{ textAlign: "right" }}>{fmtSp(c.total)}</td>
        </tr>
      </tbody>
    </table>
  );
  return (
    <>
      <div className="kpis">
        <div className="kpi" style={fac ? { borderTopColor: fac.color } : undefined}>
          <div className="kpi-value">
            {fac?.name ?? (data.faction_id ? `#${data.faction_id}` : "—")}
          </div>
          <div className="kpi-label">{tr("Facción")}</div>
        </div>
        {data.current_rank != null && <Kpi label={tr("Rango actual")} value={data.current_rank} />}
        {data.highest_rank != null && <Kpi label={tr("Rango máximo")} value={data.highest_rank} />}
        {data.enlisted_on && <Kpi label={tr("Enlistado")} value={data.enlisted_on.slice(0, 10)} />}
      </div>
      <div className="resumen-grid">
        <div className="panel resumen-panel">
          <h4>{tr("Kills")}</h4>
          {counts(data.kills)}
        </div>
        <div className="panel resumen-panel">
          <h4>Victory Points</h4>
          {counts(data.victory_points)}
        </div>
      </div>
    </>
  );
}

function PapersBlock({
  series,
  data,
}: {
  series: PaperSeries | null;
  data: AbyssalsData | null;
}) {
  const srcLabel: Record<string, string> = { abyssal: tr("Abyssals"), crab: tr("CRAB") };
  const srcColor: Record<string, string> = { abyssal: DONUT_COLORS[0], crab: DONUT_COLORS[1] };
  const days = series?.daily ?? [];
  const dates = [...new Set(days.map((d) => d.date))].sort();
  const sources = [...new Set(days.map((d) => d.source))];
  const valAt = (date: string, src: string) =>
    days.find((d) => d.date === date && d.source === src)?.value ?? 0;
  const chartSeries = sources.map((src) => ({
    name: srcLabel[src] ?? src,
    color: srcColor[src] ?? DONUT_COLORS[0],
    values: dates.map((d) => valAt(d, src)),
  }));
  const groups = (data?.papers ?? []).filter((g) => g.qty > 0);
  return (
    <div className="papers-block">
      <h4>💠 {tr("Papeles (loot redimible — estimado)")}</h4>
      <p className="muted small">
        {tr("Valor ESTIMADO a precio de mercado del loot redimible (Abyssals + CRAB). La gráfica ACUMULA los papeles que vas ganando (detecta las subidas de cantidad en tus assets en cada sync y las suma, como el ISK del wallet); vender no resta. No es ISK realizado: es una estimación a mercado.")}
      </p>
      {dates.length >= 2 ? (
        <>
          <div className="rateo-charthead">
            <span className="muted small">{tr("Papeles acumulados (ganados) · valor estimado a mercado")}</span>
          </div>
          <MultiLineProgress labels={dates} series={chartSeries} fmt={fmtIsk} />
        </>
      ) : (
        <p className="muted small">
          {tr("La gráfica acumulada se construye con el tiempo: cada sync (y cada vez que abres esta vista) guarda una foto del inventario y suma lo nuevo. Necesita al menos dos lecturas en días distintos.")}
        </p>
      )}
      {data && (
        <>
          <div className="kpis">
            <Kpi label={tr("Papeles en inventario")} value={fmtSp(data.papers_qty)} />
            <Kpi label={tr("Valor estimado (mercado)")} value={fmtIsk(data.papers_value)} tone="pos" />
          </div>
          {groups.length === 0 ? (
            <p className="muted small">
              {tr("No tienes papeles en assets (o falta el scope de assets). Es el loot redimible que vendes en el mercado.")}
            </p>
          ) : (
            <div className="resumen-grid">
              {groups.map((g) => (
                <div className="top-list" key={g.type_id}>
                  <h4 style={{ color: srcColor[g.source] }}>
                    {tr("Inventario")} {srcLabel[g.source] ?? g.name}
                  </h4>
                  <div className="kpis">
                    <Kpi label={tr("Cantidad")} value={fmtSp(g.qty)} />
                    <Kpi label={tr("Valor estimado")} value={fmtIsk(g.value)} tone="pos" />
                  </div>
                  <table className="km-table cat-table">
                    <thead>
                      <tr>
                        <th>{tr("Ubicación")}</th>
                        <th style={{ textAlign: "right" }}>{tr("Cantidad")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.by_loc.map((p, i) => (
                        <tr key={i}>
                          <td>{p.location_name || `#${p.system_id}`}</td>
                          <td style={{ textAlign: "right" }}>{fmtSp(p.quantity)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AbyssalsSection({ data, busy }: { data: AbyssalsData | null; busy: boolean }) {
  if (!data) return <p className="muted">{busy ? tr("Cargando…") : tr("Sin datos.")}</p>;
  return (
    <>
      <p className="muted small" style={{ marginTop: "1rem" }}>
        ⚠️ {tr("ESI no expone las runs abisales. Esto es una estimación a partir de tus compras de filamentos, ahora acumuladas en tu PC (cada sync guarda las nuevas; 1 filamento ≈ 1 run). Sincroniza la wallet con frecuencia para no perder transacciones fuera de la ventana de ESI.")}
      </p>
      {data.by_filament.length === 0 ? (
        <p className="muted small">
          {tr("No se han detectado compras de filamentos en la ventana de transacciones.")}
        </p>
      ) : (
        <>
          <div className="kpis">
            <Kpi label={tr("Runs estimadas")} value={fmtSp(data.runs_est)} />
            <Kpi label={tr("ISK en filamentos")} value={fmtIsk(data.isk_spent)} tone="neg" />
            <Kpi label={tr("Tipos de filamento")} value={fmtSp(data.by_filament.length)} />
          </div>
          <div className="top-list">
            <h4>{tr("Por filamento")}</h4>
            <table className="km-table cat-table">
              <thead>
                <tr>
                  <th>{tr("Filamento")}</th>
                  <th style={{ textAlign: "right" }}>{tr("Cantidad")}</th>
                  <th style={{ textAlign: "right" }}>ISK</th>
                </tr>
              </thead>
              <tbody>
                {data.by_filament.map((f, i) => (
                  <tr key={i}>
                    <td>{f.name}</td>
                    <td style={{ textAlign: "right" }}>{fmtSp(f.count)}</td>
                    <td style={{ textAlign: "right" }}>{fmtIsk(f.isk)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

/* ---------- Contactos + Standings (Personaje) ---------- */
function contactLogo(kind: string, id: number): string | null {
  if (kind === "character") return `https://images.evetech.net/characters/${id}/portrait?size=32`;
  if (kind === "corporation") return `https://images.evetech.net/corporations/${id}/logo?size=32`;
  if (kind === "alliance") return `https://images.evetech.net/alliances/${id}/logo?size=32`;
  return null;
}
const KIND_ES: Record<string, string> = {
  character: "Personaje",
  corporation: "Corporación",
  alliance: "Alianza",
  faction: "Facción",
  agent: "Agente",
  npc_corp: "Corp NPC",
};

function ContactosView({
  contacts,
  standings,
  busy,
}: {
  contacts: ContactRow[] | null;
  standings: StandingRow[] | null;
  busy: boolean;
}) {
  if (!contacts) return <p className="muted">{busy ? tr("Cargando…") : tr("Sin datos.")}</p>;
  const goodC = contacts.filter((c) => c.standing > 0).length;
  const badC = contacts.filter((c) => c.standing < 0).length;
  return (
    <>
      <div className="kpis">
        <Kpi label={tr("Contactos")} value={fmtSp(contacts.length)} />
        <Kpi label={tr("Positivos")} value={fmtSp(goodC)} tone="pos" />
        <Kpi label={tr("Negativos")} value={fmtSp(badC)} tone="neg" />
        {standings && <Kpi label={tr("Standings NPC")} value={fmtSp(standings.length)} />}
      </div>

      <div className="top-list">
        <h4>{tr("Tus contactos")}</h4>
        {contacts.length === 0 ? (
          <p className="muted small">{tr("No tienes contactos.")}</p>
        ) : (
          <table className="km-table cat-table">
            <thead>
              <tr>
                <th>{tr("Contacto")}</th>
                <th>{tr("Tipo")}</th>
                <th style={{ textAlign: "right" }}>Standing</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => {
                const logo = contactLogo(c.kind, c.id);
                return (
                  <tr key={c.id}>
                    <td>
                      {logo && (
                        <img
                          className="type-ico"
                          src={logo}
                          alt=""
                          loading="lazy"
                          style={{ borderRadius: c.kind === "character" ? "50%" : "3px" }}
                        />
                      )}
                      {c.name ?? `#${c.id}`}
                      {c.watched && <span title={tr("En seguimiento")}> 👁️</span>}
                      {c.blocked && <span title={tr("Bloqueado")}> 🚫</span>}
                    </td>
                    <td>{tr(KIND_ES[c.kind] ?? c.kind)}</td>
                    <td style={{ textAlign: "right", color: standingColor(c.standing), fontWeight: 600 }}>
                      {c.standing.toFixed(1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="top-list">
        <h4>{tr("Standings con NPC")}</h4>
        {!standings || standings.length === 0 ? (
          <p className="muted small">{tr("Sin standings (o falta el scope de standings; reloguea con acceso).")}</p>
        ) : (
          <table className="km-table cat-table">
            <thead>
              <tr>
                <th>{tr("Entidad")}</th>
                <th>{tr("Tipo")}</th>
                <th style={{ textAlign: "right" }}>Standing</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((s) => (
                <tr key={`${s.kind}-${s.id}`}>
                  <td>{s.name ?? `#${s.id}`}</td>
                  <td>{tr(KIND_ES[s.kind] ?? s.kind)}</td>
                  <td style={{ textAlign: "right", color: standingColor(s.standing), fontWeight: 600 }}>
                    {s.standing.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function PlanetologiaView({ planets, busy }: { planets: Planet[] | null; busy: boolean }) {
  if (!planets) return <p className="muted">{busy ? tr("Cargando colonias…") : tr("Sin datos.")}</p>;
  if (planets.length === 0)
    return <p className="muted small">{tr("No tienes colonias de Planetary Interaction.")}</p>;
  const totalPins = planets.reduce((s, p) => s + p.num_pins, 0);
  return (
    <>
      <div className="kpis">
        <Kpi label={tr("Colonias")} value={fmtSp(planets.length)} />
        <Kpi label={tr("Estructuras (pins)")} value={fmtSp(totalPins)} />
      </div>
      <table className="km-table">
        <thead>
          <tr>
            <th>{tr("Sistema")}</th>
            <th>{tr("Tipo de planeta")}</th>
            <th>{tr("Nivel")}</th>
            <th>{tr("Estructuras")}</th>
            <th>{tr("Última actualización")}</th>
          </tr>
        </thead>
        <tbody>
          {planets.map((p, i) => (
            <tr key={i}>
              <td>{p.system_name ?? (p.system_id ? `#${p.system_id}` : "—")}</td>
              <td style={{ textTransform: "capitalize" }}>{p.planet_type}</td>
              <td>{p.upgrade_level}</td>
              <td>{p.num_pins}</td>
              <td>{p.last_update?.replace("T", " ").slice(0, 16) ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// Botón reutilizable "➕ a watchlist": añade un typeID a la watchlist de mercado (optimista).
function WatchAddBtn({ typeId }: { typeId: number }) {
  const [added, setAdded] = useState(false);
  return (
    <button
      className="watch-add-btn"
      title={added ? tr("Añadido a la watchlist") : tr("Añadir a la watchlist")}
      disabled={added}
      onClick={(e) => {
        e.stopPropagation();
        invoke("watch_add", { typeId })
          .then(() => setAdded(true))
          .catch(() => {});
      }}
    >
      {added ? "✓" : "➕"}
    </button>
  );
}

// Regiones comerciales principales (hub entre paréntesis). El backend mapea región→estación hub.
const TRADE_REGIONS: { id: number; label: string }[] = [
  { id: 10000002, label: "Jita (The Forge)" },
  { id: 10000043, label: "Amarr (Domain)" },
  { id: 10000032, label: "Dodixie (Sinq Laison)" },
  { id: 10000030, label: "Rens (Heimatar)" },
  { id: 10000042, label: "Hek (Metropolis)" },
];
type MType = { i: number; n: string; g: number };

// Watchlist de mercado: vigila ítems y ve su spread en el hub + tendencia de precio.
function WatchlistPanel() {
  const [region, setRegion] = useState<number>(() => {
    const v = Number(localStorage.getItem("koru-trade-region"));
    return TRADE_REGIONS.some((r) => r.id === v) ? v : 10000002;
  });
  const [items, setItems] = useState<WatchItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [mtypes, setMtypes] = useState<MType[] | null>(null);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState<"market" | "arb">("market");
  const [arb, setArb] = useState<ArbItem[] | null>(null);
  const [arbBusy, setArbBusy] = useState(false);

  const loadArb = () => {
    setArbBusy(true);
    invoke<ArbItem[]>("get_arbitrage")
      .then(setArb)
      .catch(() => setArb([]))
      .finally(() => setArbBusy(false));
  };
  useEffect(() => {
    if (mode === "arb" && arb === null && !arbBusy) loadArb();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const load = () => {
    setBusy(true);
    invoke<WatchItem[]>("get_watchlist", { regionId: region })
      .then((v) => setItems(v))
      .catch(() => setItems([]))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    load();
    localStorage.setItem("koru-trade-region", String(region));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region]);

  // El catálogo de tipos (1 MB) se carga perezosamente al empezar a buscar.
  const ensureTypes = () => {
    if (mtypes) return;
    fetch("/market_types.json")
      .then((r) => r.json())
      .then(setMtypes)
      .catch(() => setMtypes([]));
  };
  const ql = q.trim().toLowerCase();
  const watched = new Set((items ?? []).map((i) => i.type_id));
  const matches =
    ql.length >= 2 && mtypes
      ? mtypes.filter((t) => t.n.toLowerCase().includes(ql)).slice(0, 25)
      : [];

  const add = (tid: number) => {
    setAdding(true);
    setQ("");
    invoke("watch_add", { typeId: tid })
      .then(() => load())
      .finally(() => setAdding(false));
  };
  const remove = (tid: number) => {
    invoke("watch_remove", { typeId: tid }).then(() => {
      if (sel === tid) setSel(null);
      load();
    });
  };

  const selItem = items?.find((i) => i.type_id === sel) ?? null;
  const hLabels = (selItem?.history ?? []).map((h) => h.date.slice(5));
  const hSeries = selItem
    ? [{ name: tr("Precio medio"), color: "#58a6ff", values: selItem.history.map((h) => h.average) }]
    : [];

  const arbList = arb ?? [];

  return (
    <>
      <div className="seg seg-sm" style={{ marginBottom: "0.6rem" }}>
        <button className={mode === "market" ? "active" : ""} onClick={() => setMode("market")}>
          {tr("Mercado")}
        </button>
        <button className={mode === "arb" ? "active" : ""} onClick={() => setMode("arb")}>
          {tr("Arbitraje entre hubs")}
        </button>
      </div>

      {mode === "arb" ? (
        <>
          <div className="watch-controls">
            <span className="muted small" style={{ flex: 1 }}>
              {tr("Mejor ruta de compra→venta entre Jita, Amarr, Dodixie, Rens y Hek para cada ítem vigilado.")}
            </span>
            <button onClick={loadArb} disabled={arbBusy}>
              {arbBusy ? tr("Calculando…") : tr("Recalcular")}
            </button>
          </div>
          {!arb ? (
            <p className="muted">{arbBusy ? tr("Analizando los 5 hubs… (puede tardar)") : tr("Sin datos.")}</p>
          ) : arbList.length === 0 ? (
            <p className="muted small">
              {(items && items.length === 0)
                ? tr("Tu watchlist está vacía. Añade ítems en la pestaña Mercado.")
                : tr("No hay rutas rentables entre hubs para tus ítems vigilados ahora mismo.")}
            </p>
          ) : (
            <>
              <table className="km-table">
                <thead>
                  <tr>
                    <th>{tr("Item")}</th>
                    <th>{tr("Comprar en")}</th>
                    <th style={{ textAlign: "right" }}>{tr("Precio compra")}</th>
                    <th>{tr("Vender en")}</th>
                    <th style={{ textAlign: "right" }}>{tr("Precio venta")}</th>
                    <th style={{ textAlign: "right" }}>{tr("Beneficio/ud")}</th>
                    <th style={{ textAlign: "right" }}>{tr("Margen")}</th>
                    <th style={{ textAlign: "right" }}>{tr("Vol/día dest.")}</th>
                  </tr>
                </thead>
                <tbody>
                  {arbList.map((a) => (
                    <tr key={a.type_id}>
                      <td className="ship-cell">
                        <TypeIcon typeId={a.type_id} />
                        <span>{a.name ?? `#${a.type_id}`}</span>
                      </td>
                      <td>{a.buy_hub}</td>
                      <td style={{ textAlign: "right", color: "#3fb950" }}>{fmtIsk(a.buy_price)}</td>
                      <td>{a.sell_hub}</td>
                      <td style={{ textAlign: "right", color: "#e5534b" }}>{fmtIsk(a.sell_price)}</td>
                      <td style={{ textAlign: "right", color: "#3fb950" }}>{fmtIsk(a.profit)}</td>
                      <td
                        style={{
                          textAlign: "right",
                          color: a.margin >= 0.2 ? "#3fb950" : a.margin >= 0.05 ? "#d29922" : "inherit",
                        }}
                      >
                        {(a.margin * 100).toFixed(1)}%
                      </td>
                      <td style={{ textAlign: "right" }}>{fmtSp(a.dest_volume)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small">
                {tr("Comprar al mejor precio de venta en el hub origen, llevar y vender al mejor precio de compra en el destino. Beneficio antes de impuestos, comisiones y transporte. El volumen del destino indica si podrás colocarlo.")}
              </p>
            </>
          )}
        </>
      ) : (
      <>
      <div className="watch-controls">
        <label className="watch-region">
          <span className="muted small">{tr("Región")}</span>
          <select value={region} onChange={(e) => setRegion(Number(e.target.value))}>
            {TRADE_REGIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <div className="watch-search">
          <input
            value={q}
            onFocus={ensureTypes}
            onChange={(e) => {
              ensureTypes();
              setQ(e.target.value);
            }}
            placeholder={tr("Buscar ítem para añadir…")}
          />
          {ql.length >= 2 && (
            <div className="watch-ac">
              {!mtypes ? (
                <div className="muted small watch-ac-msg">{tr("Cargando catálogo…")}</div>
              ) : matches.length === 0 ? (
                <div className="muted small watch-ac-msg">{tr("Sin coincidencias")}</div>
              ) : (
                matches.map((m) => (
                  <button
                    key={m.i}
                    disabled={watched.has(m.i) || adding}
                    onClick={() => add(m.i)}
                  >
                    <TypeIcon typeId={m.i} />
                    <span>{m.n}</span>
                    {watched.has(m.i) && <span className="muted small"> · {tr("ya vigilado")}</span>}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {!items ? (
        <p className="muted">{busy ? tr("Cargando mercado…") : tr("Sin datos.")}</p>
      ) : items.length === 0 ? (
        <p className="muted small">
          {tr("Tu watchlist está vacía. Busca ítems arriba para vigilar su precio, spread y volumen.")}
        </p>
      ) : (
        <>
          <table className="km-table">
            <thead>
              <tr>
                <th>{tr("Item")}</th>
                <th style={{ textAlign: "right" }}>{tr("Compra")}</th>
                <th style={{ textAlign: "right" }}>{tr("Venta")}</th>
                <th style={{ textAlign: "right" }}>{tr("Spread")}</th>
                <th style={{ textAlign: "right" }}>{tr("Margen")}</th>
                <th style={{ textAlign: "right" }}>{tr("Vol/día")}</th>
                <th style={{ textAlign: "right" }}>{tr("Vol medio")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr
                  key={it.type_id}
                  className={sel === it.type_id ? "watch-row sel" : "watch-row"}
                  onClick={() => setSel(sel === it.type_id ? null : it.type_id)}
                >
                  <td className="ship-cell">
                    <TypeIcon typeId={it.type_id} />
                    <span>{it.name ?? `#${it.type_id}`}</span>
                  </td>
                  <td style={{ textAlign: "right", color: "#3fb950" }}>
                    {it.best_buy > 0 ? fmtIsk(it.best_buy) : "—"}
                  </td>
                  <td style={{ textAlign: "right", color: "#e5534b" }}>
                    {it.best_sell > 0 ? fmtIsk(it.best_sell) : "—"}
                  </td>
                  <td style={{ textAlign: "right" }}>{it.spread > 0 ? fmtIsk(it.spread) : "—"}</td>
                  <td
                    style={{
                      textAlign: "right",
                      color: it.margin >= 0.1 ? "#3fb950" : it.margin > 0 ? "#d29922" : "inherit",
                    }}
                  >
                    {it.margin > 0 ? `${(it.margin * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td style={{ textAlign: "right" }}>{fmtSp(it.day_volume)}</td>
                  <td style={{ textAlign: "right" }}>{fmtSp(it.avg_volume)}</td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="watch-rm"
                      title={tr("Quitar de la watchlist")}
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(it.type_id);
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {selItem && (
            <div className="watch-detail">
              <div className="rateo-charthead">
                <span className="muted small">
                  {tr("Libro (hub)")} · {selItem.name ?? `#${selItem.type_id}`}
                </span>
              </div>
              {selItem.buy_levels.length === 0 && selItem.sell_levels.length === 0 ? (
                <p className="muted small">{tr("Sin órdenes en el hub para este ítem.")}</p>
              ) : (
                (() => {
                  const maxCum = Math.max(
                    1,
                    ...selItem.buy_levels.map((l) => l.cum),
                    ...selItem.sell_levels.map((l) => l.cum),
                  );
                  const pct = (c: number) => `${(c / maxCum) * 100}%`;
                  return (
                    <div className="watch-book">
                      <div className="book-side book-buy">
                        <div className="book-caption muted small">{tr("Compradores")}</div>
                        {selItem.buy_levels.map((l) => (
                          <div className="book-row" key={`b${l.price}`} title={`${l.orders} ${tr("órdenes")} · ${tr("acum.")} ${fmtSp(l.cum)}`}>
                            <div className="book-bar" style={{ width: pct(l.cum) }} />
                            <span className="book-vol">{fmtSp(l.volume)}</span>
                            <span className="book-price">{fmtIsk(l.price)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="book-mid">
                        <span className="muted small">{tr("Spread")}</span>
                        <strong>{selItem.spread > 0 ? fmtIsk(selItem.spread) : "—"}</strong>
                        <span className="muted small">
                          {selItem.margin > 0 ? `${(selItem.margin * 100).toFixed(1)}%` : ""}
                        </span>
                      </div>
                      <div className="book-side book-sell">
                        <div className="book-caption muted small">{tr("Vendedores")}</div>
                        {selItem.sell_levels.map((l) => (
                          <div className="book-row" key={`s${l.price}`} title={`${l.orders} ${tr("órdenes")} · ${tr("acum.")} ${fmtSp(l.cum)}`}>
                            <div className="book-bar" style={{ width: pct(l.cum) }} />
                            <span className="book-price">{fmtIsk(l.price)}</span>
                            <span className="book-vol">{fmtSp(l.volume)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()
              )}
              <div className="rateo-charthead" style={{ marginTop: "0.6rem" }}>
                <span className="muted small">
                  {tr("Precio medio")} ·{" "}
                  {tr("últimos")} {selItem.history.length} {tr("días")}
                </span>
              </div>
              {selItem.history.length === 0 ? (
                <p className="muted small">{tr("Sin histórico para este ítem en esta región.")}</p>
              ) : (
                <MultiLineProgress labels={hLabels} series={hSeries} fmt={fmtIsk} />
              )}
            </div>
          )}
          <p className="muted small">
            {tr("Compra/venta = mejor precio en el hub de la región. Spread = venta − compra. Margen = spread ÷ venta (antes de impuestos). Volumen del histórico de mercado de la región.")}
          </p>
        </>
      )}
      </>
      )}
    </>
  );
}

function ComercioView({
  orders,
  busy,
  subject,
}: {
  orders: MarketOrder[] | null;
  busy: boolean;
  subject: number | "global";
}) {
  const [view, setView] = useState<"orders" | "pnl" | "watch">("orders");
  const [pnl, setPnl] = useState<TradePnl | null>(null);
  const [pnlBusy, setPnlBusy] = useState(false);
  const [pGran, setPGran] = useState<"day" | "week" | "month">("month");
  const [pFrom, setPFrom] = useState(daysAgo(90));
  const [pTo, setPTo] = useState("");
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 }>({ col: "issued", dir: -1 });
  const onSort = (col: string) =>
    setSort((s) => (s.col === col ? { col, dir: s.dir === 1 ? -1 : 1 } : { col, dir: 1 }));
  useEffect(() => {
    if (view !== "pnl") return;
    setPnlBusy(true);
    setPnl(null);
    const p =
      subject === "global"
        ? invoke<TradePnl>("get_trading_pnl_global")
        : invoke<TradePnl>("get_trading_pnl", { characterId: subject });
    p.then(setPnl)
      .catch(() => setPnl(null))
      .finally(() => setPnlBusy(false));
  }, [view, subject]);

  const daysLeft = (o: MarketOrder) =>
    o.issued
      ? Math.ceil((new Date(o.issued).getTime() + o.duration * 86400000 - Date.now()) / 86400000)
      : null;
  const list = orders ?? [];
  const sorted = [...list].sort((a, b) => {
    const d = sort.dir;
    switch (sort.col) {
      case "item":
        return (a.type_name ?? "").localeCompare(b.type_name ?? "") * d;
      case "type":
        return ((a.is_buy ? 1 : 0) - (b.is_buy ? 1 : 0)) * d;
      case "price":
        return (a.price - b.price) * d;
      case "qty":
        return (a.volume_remain - b.volume_remain) * d;
      case "sys":
        return (a.system_name ?? "").localeCompare(b.system_name ?? "") * d;
      default:
        return (a.issued ?? "").localeCompare(b.issued ?? "") * d;
    }
  });
  const buys = list.filter((o) => o.is_buy).length;
  const buyValue = list.filter((o) => o.is_buy).reduce((s, o) => s + o.price * o.volume_remain, 0);
  const sellValue = list.filter((o) => !o.is_buy).reduce((s, o) => s + o.price * o.volume_remain, 0);
  const undercut = list.filter((o) => !o.is_best).length; // órdenes que hay que repricear

  // Serie de beneficio realizado por día (fecha de venta), bucketizada por granularidad + rango.
  const pDaily = (pnl?.daily ?? []).filter((d) => (!pFrom || d.date >= pFrom) && (!pTo || d.date <= pTo));
  const pBucket = new Map<string, number>();
  for (const d of pDaily) {
    const k = pGran === "month" ? d.date.slice(0, 7) : pGran === "week" ? weekKey(d.date) : d.date;
    pBucket.set(k, (pBucket.get(k) ?? 0) + d.profit);
  }
  const pLabels = [...pBucket.keys()];
  const pSeries = [
    { name: tr("Beneficio"), color: "#3fb950", values: pLabels.map((l) => pBucket.get(l) ?? 0) },
  ];
  const pYears = [...new Set((pnl?.daily ?? []).map((d) => +d.date.slice(0, 4)))]
    .filter((y) => y > 0)
    .sort((a, b) => b - a);

  return (
    <>
      <div className="seg seg-sm" style={{ marginBottom: "0.7rem" }}>
        <button className={view === "orders" ? "active" : ""} onClick={() => setView("orders")}>
          {tr("Órdenes abiertas")}
        </button>
        <button className={view === "pnl" ? "active" : ""} onClick={() => setView("pnl")}>
          {tr("Rentabilidad (P&L)")}
        </button>
        <button className={view === "watch" ? "active" : ""} onClick={() => setView("watch")}>
          {tr("Watchlist")}
        </button>
      </div>

      {view === "watch" ? (
        <WatchlistPanel />
      ) : view === "orders" ? (
        !orders ? (
          <p className="muted">{busy ? tr("Cargando órdenes…") : tr("Sin datos.")}</p>
        ) : orders.length === 0 ? (
          <p className="muted small">{tr("No tienes órdenes de mercado abiertas.")}</p>
        ) : (
          <>
            <div className="kpis">
              <Kpi label={tr("Órdenes")} value={fmtSp(list.length)} />
              <Kpi label={tr("De compra")} value={fmtSp(buys)} tone="pos" />
              <Kpi label={tr("De venta")} value={fmtSp(list.length - buys)} tone="neg" />
              <Kpi
                label={tr("Pisadas (a repricear)")}
                value={fmtSp(undercut)}
                tone={undercut > 0 ? "neg" : "pos"}
              />
              <Kpi label={tr("Valor compra")} value={fmtIsk(buyValue)} tone="pos" />
              <Kpi label={tr("Valor venta")} value={fmtIsk(sellValue)} tone="neg" />
            </div>
            <table className="km-table">
              <thead>
                <tr>
                  <Th label={tr("Item")} col="item" sort={sort} onSort={onSort} />
                  <Th label={tr("Tipo")} col="type" sort={sort} onSort={onSort} />
                  <Th label={tr("Precio")} col="price" sort={sort} onSort={onSort} />
                  <th>{tr("Estado")}</th>
                  <Th label={tr("Cantidad")} col="qty" sort={sort} onSort={onSort} />
                  <th>{tr("Vendido")}</th>
                  <Th label={tr("Sistema")} col="sys" sort={sort} onSort={onSort} />
                  <th>{tr("Caduca")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((o, i) => {
                  const filled = o.volume_total > 0 ? 1 - o.volume_remain / o.volume_total : 0;
                  const left = daysLeft(o);
                  return (
                    <tr key={i}>
                      <td className="ship-cell">
                        <TypeIcon typeId={o.type_id} />
                        <span>{o.type_name ?? `#${o.type_id}`}</span>
                      </td>
                      <td style={{ color: o.is_buy ? "#3fb950" : "#e5534b" }}>
                        {o.is_buy ? tr("Compra") : tr("Venta")}
                      </td>
                      <td>{fmtIsk(o.price)}</td>
                      <td>
                        {o.is_best ? (
                          <span className="ord-best">✓ {tr("Mejor")}</span>
                        ) : (
                          <span
                            className="ord-cut"
                            title={
                              o.best_competitor != null
                                ? `${tr("Mejor rival")}: ${fmtIsk(o.best_competitor)}`
                                : ""
                            }
                          >
                            ⚠ {tr("Pisada")}
                            {o.best_competitor != null && (
                              <span className="muted small"> · {fmtIsk(o.best_competitor)}</span>
                            )}
                          </span>
                        )}
                        {o.competitors > 0 && (
                          <span className="muted small"> · {o.competitors} {tr("riv.")}</span>
                        )}
                      </td>
                      <td>
                        {fmtSp(o.volume_remain)} / {fmtSp(o.volume_total)}
                      </td>
                      <td>{(filled * 100).toFixed(0)}%</td>
                      <td>{o.system_name ?? (o.system_id ? `#${o.system_id}` : "—")}</td>
                      <td>{left == null ? "—" : left <= 0 ? tr("caducada") : `${left} ${tr("d")}`}</td>
                      <td style={{ textAlign: "right" }}>
                        <WatchAddBtn typeId={o.type_id} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )
      ) : pnlBusy && !pnl ? (
        <p className="muted">{tr("Cargando…")}</p>
      ) : !pnl || pnl.items.length === 0 ? (
        <p className="muted small">
          {tr("Sin transacciones de mercado para calcular el P&L. Se van acumulando al sincronizar la wallet.")}
        </p>
      ) : (
        <>
          <div className="kpis">
            <Kpi
              label={tr("Beneficio realizado")}
              value={fmtIsk(pnl.total_profit)}
              tone={pnl.total_profit >= 0 ? "pos" : "neg"}
            />
            <Kpi label={tr("Facturación (ventas)")} value={fmtIsk(pnl.total_revenue)} />
            <Kpi label={tr("Coste de lo vendido")} value={fmtIsk(pnl.total_cost)} tone="neg" />
            <Kpi label={tr("Impuestos y comisiones")} value={fmtIsk(pnl.total_tax)} tone="neg" />
            <Kpi
              label={tr("Neto tras impuestos")}
              value={fmtIsk(pnl.total_profit - pnl.total_tax)}
              tone={pnl.total_profit - pnl.total_tax >= 0 ? "pos" : "neg"}
            />
          </div>
          <div className="rateo-controls">
            <div className="seg">
              {(["day", "week", "month"] as const).map((g) => (
                <button key={g} className={pGran === g ? "active" : ""} onClick={() => setPGran(g)}>
                  {g === "day" ? tr("Día") : g === "week" ? tr("Semana") : tr("Mes")}
                </button>
              ))}
            </div>
            <RangePresets from={pFrom} to={pTo} setFrom={setPFrom} setTo={setPTo} years={pYears} />
          </div>
          <div className="rateo-charthead">
            <span className="muted small">
              {tr("Beneficio realizado por")}{" "}
              {pGran === "day" ? tr("día") : pGran === "week" ? tr("semana") : tr("mes")}
            </span>
          </div>
          <MultiLineProgress labels={pLabels} series={pSeries} fmt={fmtIsk} />
          <p className="muted small">
            {tr("Beneficio realizado por item (coste medio ponderado): ingreso de ventas − coste de lo vendido. Los impuestos/comisiones son del wallet (globales, no por item).")}
          </p>
          <table className="km-table">
            <thead>
              <tr>
                <th>{tr("Item")}</th>
                <th style={{ textAlign: "right" }}>{tr("Comprado")}</th>
                <th style={{ textAlign: "right" }}>{tr("Vendido")}</th>
                <th style={{ textAlign: "right" }}>{tr("Compra media")}</th>
                <th style={{ textAlign: "right" }}>{tr("Venta media")}</th>
                <th style={{ textAlign: "right" }}>{tr("Beneficio")}</th>
                <th style={{ textAlign: "right" }}>{tr("Margen")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pnl.items.map((it) => (
                <tr key={it.type_id}>
                  <td className="ship-cell">
                    <TypeIcon typeId={it.type_id} />
                    <span>{it.name ?? `#${it.type_id}`}</span>
                  </td>
                  <td style={{ textAlign: "right" }}>{fmtSp(it.bought_qty)}</td>
                  <td style={{ textAlign: "right" }}>{fmtSp(it.sold_qty)}</td>
                  <td style={{ textAlign: "right" }}>{fmtIsk(it.avg_buy)}</td>
                  <td style={{ textAlign: "right" }}>{fmtIsk(it.avg_sell)}</td>
                  <td style={{ textAlign: "right", color: it.profit >= 0 ? "#3fb950" : "#e5534b" }}>
                    {fmtIsk(it.profit)}
                  </td>
                  <td style={{ textAlign: "right" }}>{it.margin.toFixed(1)}%</td>
                  <td style={{ textAlign: "right" }}>
                    <WatchAddBtn typeId={it.type_id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

function AssetsView(props: {
  data: AssetsSummary | null;
  detail: AssetDetail[] | null;
  busy: boolean;
  charId: number | null;
  presetQuery?: string;
}) {
  const { data, detail, busy, charId, presetQuery } = props;
  const [q, setQ] = useState("");
  const [cat, setCat] = useState(""); // "" = Todos
  // Datos para el skill-check del fit al abrir una nave.
  const [reqs, setReqs] = useState<Record<string, [number, number][]>>({});
  const [skillNames, setSkillNames] = useState<Record<string, string>>({});
  const [charSkills, setCharSkills] = useState<Record<number, number> | null>(null);
  useEffect(() => {
    fetch("/skill_reqs.json").then((r) => r.json()).then(setReqs).catch(() => {});
    fetch("/skill_names.json").then((r) => r.json()).then(setSkillNames).catch(() => {});
  }, []);
  useEffect(() => {
    if (charId == null) {
      setCharSkills(null);
      return;
    }
    invoke<Record<number, number>>("get_char_skill_levels", { characterId: charId })
      .then(setCharSkills)
      .catch(() => setCharSkills(null));
  }, [charId]);
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 }>({ col: "qty", dir: -1 });
  // Contenedor/nave "abierto" (drill-down): muestra solo su contenido.
  const [openContainer, setOpenContainer] = useState<{ id: number; name: string } | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const lastPreset = useRef<string | null>(null);
  const pendingScroll = useRef(false);
  // Búsqueda prefijada desde fuera (p. ej. "Mis assets aquí" del mapa): filtra por el sistema.
  useEffect(() => {
    if (presetQuery && presetQuery !== lastPreset.current) {
      lastPreset.current = presetQuery;
      setQ(presetQuery);
      setOpenContainer(null);
      pendingScroll.current = true; // bajar a la lista en cuanto exista (aunque los assets aún carguen)
    }
  }, [presetQuery]);
  // Baja hasta el buscador/tabla una sola vez cuando ya está renderizado.
  useEffect(() => {
    if (pendingScroll.current && searchRef.current) {
      pendingScroll.current = false;
      requestAnimationFrame(() =>
        searchRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      );
    }
  });
  const onSort = (col: string) =>
    setSort((s) => (s.col === col ? { col, dir: s.dir === 1 ? -1 : 1 } : { col, dir: 1 }));
  const ql = q.trim().toLowerCase();
  const catList = Array.from(new Set((detail ?? []).map((r) => r.category))).sort();
  const filtered = (detail ?? []).filter(
    (r) =>
      (openContainer === null || r.container_id === openContainer.id) &&
      (cat === "" || r.category === cat) &&
      (ql === "" ||
        (r.type_name ?? "").toLowerCase().includes(ql) ||
        (r.system_name ?? "").toLowerCase().includes(ql) ||
        (r.location_name ?? "").toLowerCase().includes(ql) ||
        (r.container ?? "").toLowerCase().includes(ql))
  );
  const sorted = [...filtered].sort((a, b) => {
    const d = sort.dir;
    if (sort.col === "qty") return (a.quantity - b.quantity) * d;
    const av = sort.col === "name" ? a.type_name ?? "" : a.system_name ?? "";
    const bv = sort.col === "name" ? b.type_name ?? "" : b.system_name ?? "";
    return av.localeCompare(bv) * d;
  });
  const shown = sorted.slice(0, 300);
  // Si el contenedor abierto es una nave (tiene slots), mostramos su fit.
  const containerRows = openContainer
    ? (detail ?? []).filter((r) => r.container_id === openContainer.id)
    : [];
  const isShipFit = openContainer !== null && containerRows.some((r) => FIT_SLOTS_RE.test(r.slot));
  const shipTypeId = containerRows[0]?.container_type_id ?? 0;
  // Contenedores que son naves fiteadas (tienen módulos en slots): para mostrar otro icono.
  const shipContainers = useMemo(() => {
    const s = new Set<number>();
    for (const r of detail ?? []) {
      if (r.container_id && FIT_SLOTS_RE.test(r.slot)) s.add(r.container_id);
    }
    return s;
  }, [detail]);
  return (
    <>
      {!data && busy && <p className="muted">{tr("Cargando… (puede tardar con muchos assets)")}</p>}
      {data && (
        <>
          <div className="kpis">
            <Kpi label={tr("Stacks")} value={fmtSp(data.stacks)} />
            <Kpi label={tr("Tipos distintos")} value={fmtSp(data.distinct_types)} />
            <Kpi label={tr("Unidades totales")} value={fmtSp(data.total_units)} />
            {data.est_value_clean > 0 && (
              <Kpi label={tr("Valor estimado")} value={fmtIsk(data.est_value_clean)} />
            )}
            {data.est_value - data.est_value_clean > 0 && (
              <Kpi
                label={tr("Blueprints (excluidos)")}
                value={fmtIsk(data.est_value - data.est_value_clean)}
                tone="neg"
              />
            )}
          </div>
          {data.top_value && data.top_value.length > 0 && (
            <div className="panel resumen-panel" style={{ maxWidth: 580, marginBottom: "0.8rem" }}>
              <h4>💰 {tr("Top assets por valor estimado")}</h4>
              <p className="muted small">
                {tr("Los blueprints NO cuentan para el patrimonio: el average_price de ESI para un BPO/BPC es su valor base, no lo que sacarías vendiéndolo.")}
              </p>
              <table className="km-table cat-table">
                <thead>
                  <tr>
                    <th>{tr("Item")}</th>
                    <th>{tr("Categoría")}</th>
                    <th style={{ textAlign: "right" }}>{tr("Cantidad")}</th>
                    <th style={{ textAlign: "right" }}>{tr("Valor")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_value.map((t) => (
                    <tr key={t.type_id} className={t.category === "Blueprints" ? "asset-bp" : ""}>
                      <td>
                        <TypeIcon typeId={t.type_id} />{" "}
                        {t.name ?? `#${t.type_id}`}
                      </td>
                      <td>
                        {tr(t.category)}
                        {t.category === "Blueprints" && ` · ${tr("excluido")}`}
                      </td>
                      <td style={{ textAlign: "right" }}>{fmtSp(t.qty)}</td>
                      <td style={{ textAlign: "right" }}>{fmtIsk(t.value)}</td>
                      <td style={{ textAlign: "right" }}>
                        <WatchAddBtn typeId={t.type_id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {detail && detail.length > 0 && catList.length > 1 && (
            <div className="panel resumen-panel" style={{ maxWidth: 540, marginBottom: "0.8rem" }}>
              <h4>{tr("Distribución por categoría")}</h4>
              <Bars
                items={Object.entries(
                  detail.reduce<Record<string, number>>((acc, r) => {
                    acc[r.category] = (acc[r.category] ?? 0) + r.quantity;
                    return acc;
                  }, {})
                )
                  .map(([label, value]) => ({ label: tr(label), value }))
                  .sort((a, b) => b.value - a.value)}
                fmt={fmtSp}
              />
            </div>
          )}
          {detail && catList.length > 1 && (
            <div className="tabs" style={{ marginTop: "0.5rem" }}>
              <button className={`tab ${cat === "" ? "active" : ""}`} onClick={() => setCat("")}>
                {tr("Todos")}
              </button>
              {catList.map((c) => (
                <button
                  key={c}
                  className={`tab ${cat === c ? "active" : ""}`}
                  onClick={() => setCat(c)}
                >
                  {tr(c)}
                </button>
              ))}
            </div>
          )}
          {openContainer && (
            <div className="asset-open-bar">
              <span>📦 {tr("Dentro de")}: <b>{openContainer.name}</b></span>
              <button className="asset-open-close" onClick={() => setOpenContainer(null)}>
                ✕ {tr("cerrar")}
              </button>
            </div>
          )}
          <div className="asset-search" ref={searchRef}>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={tr("Buscar por item, sistema, ubicación o contenedor…")}
            />
            {detail && (
              <span className="muted small">
                {filtered.length === detail.length
                  ? `${detail.length} ${tr("entradas")}`
                  : `${filtered.length} ${tr("de")} ${detail.length}`}
              </span>
            )}
          </div>
          {isShipFit ? (
            <ShipFit
              rows={containerRows}
              typeId={shipTypeId}
              name={openContainer!.name}
              charSkills={charSkills}
              reqs={reqs}
              skillNames={skillNames}
            />
          ) : !detail ? (
            <p className="muted small">{tr("Cargando inventario…")}</p>
          ) : detail.length === 0 ? (
            <p className="muted small">{tr("Sin assets.")}</p>
          ) : (
            <table className="km-table">
              <thead>
                <tr>
                  <Th label={tr("Item")} col="name" sort={sort} onSort={onSort} />
                  <Th label={tr("Cantidad")} col="qty" sort={sort} onSort={onSort} />
                  <Th label={tr("Sistema")} col="sys" sort={sort} onSort={onSort} />
                  <th>{tr("Ubicación")}</th>
                  <th>{tr("Contenedor")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={i}>
                    <td className="ship-cell">
                      <img className="type-ico" src={typeIcon(r.type_id)} alt="" loading="lazy" />
                      <span>{r.type_name ?? `#${r.type_id}`}</span>
                    </td>
                    <td>{fmtSp(r.quantity)}</td>
                    <td>{r.system_name ?? (r.system_id ? `#${r.system_id}` : "—")}</td>
                    <td className="muted small">{r.location_name || "—"}</td>
                    <td className="muted small">
                      {r.container ?? ""}
                      {r.container_id !== 0 && (
                        <button
                          className="asset-open"
                          title={
                            shipContainers.has(r.container_id)
                              ? `${tr("Ver fit de")} ${r.container ?? tr("la nave")}`
                              : `${tr("Abrir")} ${r.container ?? tr("contenedor")}`
                          }
                          onClick={() =>
                            setOpenContainer({ id: r.container_id, name: r.container ?? tr("contenedor") })
                          }
                        >
                          {r.container_type_id ? (
                            <img
                              className="asset-open-ico"
                              src={typeIcon(r.container_type_id, 32)}
                              alt=""
                              loading="lazy"
                            />
                          ) : shipContainers.has(r.container_id) ? (
                            "🚀"
                          ) : (
                            "🔍"
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {filtered.length > shown.length && (
            <p className="muted small">
              {tr("Mostrando")} {shown.length} {tr("de")} {filtered.length}. {tr("Afina la búsqueda para ver más.")}
            </p>
          )}
        </>
      )}
    </>
  );
}

// Formatea el tiempo restante hasta `end` (futuro). Pasado/igual = "✅ listo".
function fmtRemain(end: string | null): { text: string; ready: boolean } {
  if (!end) return { text: "-", ready: false };
  const ms = Date.parse(end) - Date.now();
  if (Number.isNaN(ms)) return { text: "-", ready: false };
  if (ms <= 0) return { text: `✅ ${tr("listo")}`, ready: true };
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  const text = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${mm}m` : `${mm}m`;
  return { text, ready: false };
}

function IndustryView(props: { jobs: JobView[] | null; busy: boolean; global?: boolean }) {
  const { jobs, busy, global } = props;
  const [act, setAct] = useState<string>("all");
  if (!jobs && busy) return <p className="muted">{tr("Cargando…")}</p>;
  if (!jobs) return <p className="muted small">{tr("Sin datos.")}</p>;

  const isReady = (j: JobView) =>
    j.status === "ready" || j.status === "delivered" || fmtRemain(j.end_date).ready;
  const readyCount = jobs.filter(isReady).length;
  // Próximo en terminar (entre los que aún no están listos).
  const upcoming = jobs
    .filter((j) => j.end_date && !isReady(j))
    .sort((a, b) => Date.parse(a.end_date!) - Date.parse(b.end_date!));
  const nextEta = upcoming[0] ? fmtRemain(upcoming[0].end_date).text : "—";

  const activities = [...new Set(jobs.map((j) => j.activity))];
  const shown = act === "all" ? jobs : jobs.filter((j) => j.activity === act);
  // Listos primero, luego por fecha de fin.
  const ordered = [...shown].sort((a, b) => {
    const ra = isReady(a) ? 0 : 1;
    const rb = isReady(b) ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return Date.parse(a.end_date ?? "9999") - Date.parse(b.end_date ?? "9999");
  });

  return (
    <>
      <div className="kpis">
        <Kpi label={tr("Jobs activos")} value={fmtSp(jobs.length)} />
        <Kpi label={tr("Listos para recoger")} value={fmtSp(readyCount)} tone={readyCount > 0 ? "pos" : undefined} />
        <Kpi label={tr("Próximo en terminar")} value={nextEta} />
      </div>

      {activities.length > 1 && (
        <div className="rateo-controls">
          <div className="seg seg-sm">
            <button className={act === "all" ? "active" : ""} onClick={() => setAct("all")}>
              {tr("Todas")}
            </button>
            {activities.map((a) => (
              <button key={a} className={act === a ? "active" : ""} onClick={() => setAct(a)}>
                {a}
              </button>
            ))}
          </div>
        </div>
      )}

      <h4>{tr("Jobs de industria")}</h4>
      {ordered.length === 0 ? (
        <p className="muted small">{tr("Sin jobs activos.")}</p>
      ) : (
        <table className="km-table">
          <thead>
            <tr>
              {global && <th>{tr("Personaje")}</th>}
              <th>{tr("Actividad")}</th>
              <th>{tr("Producto / Blueprint")}</th>
              <th>{tr("Runs")}</th>
              <th>{tr("Estado")}</th>
              <th>{tr("Restante")}</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((j) => {
              const rem = fmtRemain(j.end_date);
              return (
                <tr key={j.job_id} className={rem.ready ? "job-ready" : ""}>
                  {global && <td>{j.character ?? "-"}</td>}
                  <td>{j.activity}</td>
                  <td>{j.product_name ?? j.blueprint_name ?? "-"}</td>
                  <td>{j.runs}</td>
                  <td>{j.status ?? "-"}</td>
                  <td>{rem.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

export default App;
