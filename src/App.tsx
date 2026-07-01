import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { save, open as openDialog, message, confirm as dialogConfirm } from "@tauri-apps/plugin-dialog";
import { tr, setLang as setI18nLang, type Lang } from "./i18n";
import "./App.css";
import { fmtAgo, fmtMMSS, fmtIsk, fmtSp, fmtBytes, secColor, typeIcon, MONTH_NAMES } from "./format";
import { Kpi, Bars, Donut, DONUT_COLORS } from "./charts";
import { FitsView } from "./fit";
import { MapView } from "./map";
import { CazadorView } from "./cazador";
import { PvpView } from "./pvp";
import { NetworthViewC, WalletViewC } from "./wallet";
import { RateoView } from "./rateo";
import { MineriaView, FactionalSection, AbyssalsSection } from "./pve";
import { ContactosView } from "./contactos";
import { ComercioView } from "./comercio";
import { AssetsView } from "./assets";
import {
  FEATURES,
  SCOPE,
  CAPS,
  KM_LIMIT,
  AUTO_SYNC_MS,
  NAV,
  TAB_HEAD,
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
  Planet,
  RattingDetail,
  SpecialRatsResult,
  FinancialSummary,
  CategorySum,
  PvpActivity,
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
          {characters.length === 0 && <span className="muted small">{tr("Aún no hay personajes.")}</span>}
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
              <p className="muted small">{tr("Selecciona un personaje para ver sus contactos y standings.")}</p>
            ) : (
              <ContactosView contacts={contactsData} standings={standingsData} busy={sectionBusy} />
            ))}
          {tab === "factional" &&
            (isGlobal ? (
              <p className="muted small">{tr("Selecciona un personaje para ver sus stats de Guerra de Facciones.")}</p>
            ) : (
              <FactionalSection data={factionalData} busy={sectionBusy} />
            ))}
          {tab === "abyssals" &&
            (isGlobal ? (
              <p className="muted small">{tr("Selecciona un personaje para ver la estimación de Abyssals.")}</p>
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
      {!data && busy && <p className="muted">{tr("Cargando…")}</p>}
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
  if (items.length === 0) return <p className="muted small">{tr("Sin actividad.")}</p>;
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
