import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { save, open as openDialog, message, confirm as dialogConfirm } from "@tauri-apps/plugin-dialog";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { t, type Lang } from "./i18n";
import "./App.css";
import { fmtAgo, fmtMMSS, fmtIsk, fmtSp, fmtBytes, fmtMin, shipIcon, zkillUrl, secColor, ownerColor, heatColor, typeIcon, typeRender } from "./format";
import {
  FEATURES,
  SCOPE,
  CAPS,
  KM_LIMIT,
  AUTO_SYNC_MS,
  NAV,
  TAB_HEAD,
  OVERLAYS,
  OVERLAY_CATS,
  SUBFILTERS,
  FW_FACTIONS,
  POIS,
} from "./constants";
import type { Tab, MapOverlay } from "./constants";
import type {
  Character,
  LoginOutcome,
  CharacterCard,
  NameCount,
  KillmailRow,
  PvpStats,
  PvpTrendPoint,
  WalletView,
  WalletTrendPoint,
  NetworthPoint,
  NetworthView,
  SkillsSummary,
  GlobalSkills,
  AssetsSummary,
  AssetDetail,
  JobView,
  MiningSummary,
  SysActivity,
  Battle,
  RivalEntry,
  Rivals,
  NeSystem,
  NewEden,
  SystemKills,
  SystemJumps,
  AssetSystem,
  SovSystem,
  FwSystem,
  CharLoc,
  Incursion,
  ServerStatus,
  MarketOrder,
  Planet,
  RattingDetail,
  FinancialSummary,
  CategorySum,
  PvpActivity,
  MiningDetail,
  CharacterDetail,
  FactionalView as FactionalData,
  AbyssalsData,
  ContactRow,
  StandingRow,
  JumpShip,
  Fit,
  WhConn,
  IntelLine,
} from "./types";

/* ---------- app ---------- */
function App() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [cards, setCards] = useState<Record<number, CharacterCard>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feature, setFeature] = useState("identity");
  const [loginOpen, setLoginOpen] = useState(false); // panel "conceder acceso" colapsable
  const [settingsOpen, setSettingsOpen] = useState(false); // desplegable ⚙️ Ajustes (datos/backup)
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
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
  const tr = (s: string) => t(s, lang);

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
  const [walletData, setWalletData] = useState<WalletView | null>(null);
  const [walletTrend, setWalletTrend] = useState<WalletTrendPoint[] | null>(null);
  const [networthData, setNetworthData] = useState<NetworthView | null>(null);
  const [skillsData, setSkillsData] = useState<SkillsSummary | null>(null); // por personaje
  const [charDetail, setCharDetail] = useState<CharacterDetail | null>(null); // header rico
  const [factionalData, setFactionalData] = useState<FactionalData | null>(null);
  const [abyssalsData, setAbyssalsData] = useState<AbyssalsData | null>(null);
  const [contactsData, setContactsData] = useState<ContactRow[] | null>(null);
  const [standingsData, setStandingsData] = useState<StandingRow[] | null>(null);
  const [gSkills, setGSkills] = useState<GlobalSkills | null>(null); // global (otra forma)
  const [assetsData, setAssetsData] = useState<AssetsSummary | null>(null);
  const [jobsData, setJobsData] = useState<JobView[] | null>(null);
  const [miningData, setMiningData] = useState<MiningSummary | null>(null);
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
  const [now, setNow] = useState(Date.now());

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
    setWalletTrend(null);
    setSkillsData(null);
    setCharDetail(null);
    setFactionalData(null);
    setAbyssalsData(null);
    setContactsData(null);
    setStandingsData(null);
    setGSkills(null);
    setAssetsData(null);
    setJobsData(null);
    setMiningData(null);
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
          invoke<WalletTrendPoint[]>("get_wallet_trend_global").then(setWalletTrend).catch(() => {});
        }
        if (t === "skills") setGSkills(await invoke<GlobalSkills>("get_skills_global"));
        if (t === "assets") {
          setAssetsData(await invoke<AssetsSummary>("get_assets_global"));
          setAssetsDetail(await invoke<AssetDetail[]>("get_assets_detail_global"));
        }
        if (t === "comercio") setMarketOrders(await invoke<MarketOrder[]>("get_market_orders_global"));
        if (t === "planetologia") setPlanets(await invoke<Planet[]>("get_planets_global"));
        if (t === "rateo") setRatting(await invoke<RattingDetail>("get_ratting_global"));
        if (t === "industria") {
          setJobsData(await invoke<JobView[]>("get_industry_global"));
          setMiningData(await invoke<MiningSummary>("get_mining_global"));
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
          invoke<WalletTrendPoint[]>("get_wallet_trend", { characterId })
            .then(setWalletTrend)
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
        if (t === "rateo") setRatting(await invoke<RattingDetail>("get_ratting", { characterId }));
        if (t === "factional")
          setFactionalData(await invoke<FactionalData>("get_factional", { characterId }));
        if (t === "abyssals")
          setAbyssalsData(await invoke<AbyssalsData>("get_abyssals", { characterId }));
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
          if (c?.scopes.includes(SCOPE.mining))
            setMiningData(await invoke<MiningSummary>("get_mining", { characterId }));
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
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(sync);
      window.clearInterval(tick);
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
      await loadTab(id, "industria");
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
  if (isSyncingHistory) {
    statusText = `Sincronizando histórico… ${fmtSp(progress!.processed)} killmails${
      progress!.page > 0 ? ` (página ${progress!.page})` : ""
    } · ${elapsed}s — no cierres la app`;
  } else if (autoBusy) {
    statusText = "Sincronizando datos…";
  } else if (busy) {
    statusText = "Esperando inicio de sesión con EVE…";
  } else if (sectionBusy) {
    statusText = "Cargando sección…";
  } else if (error) {
    statusText = error;
  } else if (lastSync) {
    statusText = `Listo · última sincronización ${fmtAgo(now - lastSync)}`;
  } else {
    statusText = "Listo";
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
          title="Vista global (todos los personajes)"
        >
          🌌 Global <span className="muted">· {characters.length}</span>
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
                {missing.length > 0 && <span className="pj-warn" title="Falta acceso a alguna sección">!</span>}
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
                        <span className="small">⚠️ Falta acceso: {missing.map((m) => m.label).join(", ")}</span>
                        <button
                          className="pj-addscope"
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleLogin("core");
                          }}
                          title="Volver a iniciar sesión con el set completo para conceder los scopes que faltan"
                        >
                          {busy ? "Esperando login…" : tr("Añadir acceso")}
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
            title="Descargar e instalar la actualización y reiniciar"
          >
            {updating ? "Actualizando…" : `⬇️ Actualizar a v${updateVersion}`}
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
                Acceso a:&nbsp;
                <select value={feature} onChange={(e) => setFeature(e.target.value)}>
                  {FEATURES.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
              <button onClick={() => handleLogin()} disabled={busy}>
                {busy ? "Esperando login…" : "Iniciar sesión con EVE"}
              </button>
            </div>
          )}
        </div>

        {error && <p className="error tb-error">{error}</p>}
      </header>

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
            onConfig: setIntelCfg,
            onPickFolder: pickIntelFolder,
            onPickSound: pickIntelSound,
          }}
          onSystemAssets={(name) => {
            setAssetQuery(name);
            changeTab("assets");
          }}
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
          {tab === "patrimonio" && <NetworthViewC data={networthData} busy={sectionBusy} />}
          {tab === "wallet" && (
            <WalletViewC
              data={walletData}
              trend={walletTrend}
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
            <IndustryView
              jobs={jobsData}
              mining={miningData}
              busy={sectionBusy}
              global={isGlobal}
              onSyncMining={() => handleSyncMining(subjectId)}
            />
          )}
          {tab === "comercio" && <ComercioView orders={marketOrders} busy={sectionBusy} />}
          {tab === "planetologia" && <PlanetologiaView planets={planets} busy={sectionBusy} />}
          {tab === "fiteos" && <FitsView charId={isGlobal ? null : subjectId} charName={isGlobal ? null : subjectName} />}
          {tab === "rateo" && <RateoView data={ratting} busy={sectionBusy} />}
          {tab === "resumen" && <ResumenView subject={subject} />}
          {tab === "actividad" && <ActividadView subject={subject} />}
          {tab === "mineria" && <MineriaView subject={subject} />}
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
            {statusText}
          </span>
          {isSyncingHistory && (
            <button className="sb-cancel" onClick={handleCancelSync} title="Cancelar sincronización">
              Cancelar
            </button>
          )}
        </div>
        <div className="statusbar-meta">
          <span className="sb-badge" title="Hora EVE (UTC)">
            🕓 {new Date(now).toISOString().substring(11, 16)} EVE
          </span>
          <span className="sb-sep" />
          <span
            className="sb-badge"
            title={
              serverOffline
                ? "Tranquility caído o en VIP"
                : serverStatus
                ? `Tranquility online${serverStatus.vip ? " (VIP)" : ""}`
                : "Comprobando estado del servidor…"
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
          <span className="sb-badge" title="Mapa y datos servidos desde la base de datos local (SDE), sin llamada a ESI">
            <span className="sb-dot" />
            SDE local
          </span>
          <span className="sb-sep" />
          <span className="sb-badge" title="Estado de la sincronización automática">
            <span className={`sb-dot ${autoBusy ? "busy" : ""}`} />
            {autoBusy
              ? "Sincronizando…"
              : lastSync
              ? `Sync ${fmtAgo(now - lastSync)} · próxima ${fmtMMSS(lastSync + AUTO_SYNC_MS - now)}`
              : "Sin sincronizar"}
          </span>
          <span className="sb-sep" />
          <button
            className="sb-kofi"
            onClick={() => openUrl("https://ko-fi.com/rogiz7")}
            title="Apoyar el proyecto en Ko-fi (totalmente voluntario)"
          >
            ☕ Apoyar
          </button>
        </div>
      </footer>
    </main>
  );
}

/* ---------- vistas ---------- */
function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "pos" | "neg";
}) {
  return (
    <div className="kpi">
      <div className={`kpi-value ${tone === "pos" ? "kpi-pos" : tone === "neg" ? "kpi-neg" : ""}`}>
        {value}
      </div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}

function TopList({
  title,
  items,
  icon,
}: {
  title: string;
  items: NameCount[];
  icon?: "icon" | "render";
}) {
  return (
    <div className="top-list">
      <h4>{title}</h4>
      {items.length === 0 && <p className="muted small">Sin datos.</p>}
      <ol className={icon ? "with-ico" : ""}>
        {items.map((it) => (
          <li key={it.id}>
            {icon &&
              (icon === "render" ? (
                <img className="type-ico" src={typeRender(it.id)} alt="" loading="lazy" />
              ) : (
                <TypeIcon typeId={it.id} />
              ))}
            {it.name ?? `#${it.id}`} <span className="muted">({it.count})</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// Gráfica de barras horizontales reutilizable (SVG/CSS propio, sin dependencias).
function Bars({
  items,
  color = "#4f9cff",
  fmt = fmtSp,
}: {
  items: { label: string; value: number }[];
  color?: string;
  fmt?: (n: number) => string;
}) {
  if (items.length === 0) return <p className="muted small">Sin datos.</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  const total = items.reduce((s, i) => s + i.value, 0);
  return (
    <div className="bars">
      {items.map((it, i) => {
        const pct = total > 0 ? (it.value / total) * 100 : 0;
        return (
          <div
            className="bar-row"
            key={i}
            title={`${it.label}: ${fmt(it.value)} · ${pct.toFixed(1)}% del total`}
          >
            <span className="bar-label">{it.label}</span>
            <span className="bar-track">
              <span
                className="bar-fill"
                style={{ width: `${Math.max((it.value / max) * 100, 1.5)}%`, background: color }}
              />
            </span>
            <span className="bar-val">{fmt(it.value)}</span>
          </div>
        );
      })}
    </div>
  );
}

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
function WalletScrub({ points }: { points: WalletTrendPoint[] }) {
  const n = points.length;
  const [range, setRange] = useState<[number, number]>([0, Math.max(0, n - 1)]);
  useEffect(() => {
    setRange([0, Math.max(0, n - 1)]);
  }, [n]);
  if (n < 2)
    return <p className="muted small">Hace falta historial de varios meses para ver la tendencia.</p>;

  const lo = Math.min(range[0], range[1]);
  const hi = Math.max(range[0], range[1]);
  const sel = points.slice(lo, hi + 1);
  const income = sel.reduce((a, p) => a + p.income, 0);
  const expense = sel.reduce((a, p) => a + p.expense, 0);
  const net = income - expense;

  const years = [...new Set(points.map((p) => p.month.slice(0, 4)))];
  const curYear = points[lo].month.slice(0, 4);
  const setToYear = (y: string) => {
    const idxs = points.map((p, i) => [p.month.slice(0, 4), i] as const).filter(([yy]) => yy === y);
    if (idxs.length) setRange([idxs[0][1], idxs[idxs.length - 1][1]]);
  };

  const W = 600;
  const H = 190;
  const PAD = 30;
  const maxY = Math.max(...points.flatMap((p) => [p.income, p.expense]), 1);
  const x = (i: number) => PAD + (i / (n - 1)) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - (v / maxY) * (H - 2 * PAD);
  const path = (key: "income" | "expense") =>
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
        <path d={path("expense")} fill="none" stroke="#e5534b" strokeWidth={2} />
        <path d={path("income")} fill="none" stroke="#3fb950" strokeWidth={2} />
        {labels.map((i) => (
          <text key={i} x={x(i)} y={H - PAD + 16} textAnchor="middle" className="trend-x">
            {points[i].month}
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
        {points[lo].month} → {points[hi].month} · {sel.length} meses
      </div>

      <div className="kpis" style={{ marginTop: "0.6rem" }}>
        <Kpi label="Ingresos" value={fmtIsk(income)} tone="pos" />
        <Kpi label="Gastos" value={fmtIsk(expense)} tone="neg" />
        <Kpi label="Neto" value={fmtIsk(net)} tone={net >= 0 ? "pos" : "neg"} />
      </div>

      <div className="trend-legend">
        <span>
          <span className="ldot" style={{ background: "#3fb950" }} /> Ingresos
        </span>
        <span>
          <span className="ldot" style={{ background: "#e5534b" }} /> Gastos
        </span>
      </div>
    </div>
  );
}

// Conmutador Tabla / Gráfica reutilizable.
function ViewToggle({ chart, onChange }: { chart: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="view-toggle">
      <div className="seg">
        <button className={!chart ? "active" : ""} onClick={() => onChange(false)}>
          Tabla
        </button>
        <button className={chart ? "active" : ""} onClick={() => onChange(true)}>
          Gráfica
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
            {busy ? "Trabajando…" : "Sincronizar recientes"}
          </button>
          <button onClick={onSyncFull} disabled={busy}>
            Sincronizar histórico (zKill)
          </button>
          <button onClick={onReprocess} disabled={busy} title="Recalcula daño, final blow y nave víctima desde la caché">
            Reprocesar daño
          </button>
          <button onClick={onExport}>Exportar CSV</button>
        </div>
      )}
      {progress !== null && (
        <div className="sync-progress">
          <span className="spinner" />
          <span>
            Trabajando… <strong>{fmtSp(progress.processed)}</strong> killmails
            {progress.page > 0 ? ` (página ${progress.page})` : ""} · {elapsed}s
          </span>
          <span className="muted small">No cierres la app.</span>
          <button className="danger" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      )}
      {!stats && busy && <p className="muted">Cargando…</p>}
      {stats && (
        <>
          <div className="kpis">
            <Kpi label="Kills" value={stats.kills} />
            <Kpi label="Losses" value={stats.losses} />
            <Kpi label="Solo kills" value={stats.solo_kills} />
            <Kpi label="Final blows" value={stats.final_blows} />
            <Kpi label="Top damage" value={stats.top_damage_kills} />
            <Kpi label="Eficacia ISK" value={`${stats.efficiency.toFixed(1)}%`} tone={stats.efficiency >= 50 ? "pos" : "neg"} />
            <Kpi label="ISK destruido" value={fmtIsk(stats.isk_destroyed)} tone="pos" />
            <Kpi label="ISK perdido" value={fmtIsk(stats.isk_lost)} tone="neg" />
          </div>
          <ViewToggle chart={chart} onChange={setChart} />
          {chart ? (
            <>
              <div className="top-list">
                <h4>Tendencia (kills/losses por semana) · arrastra para enfocar una ventana</h4>
                {trend ? <TrendScrub points={trend} /> : <p className="muted small">Cargando…</p>}
              </div>
              <div className="tops">
                <div className="top-list">
                  <h4>Top naves</h4>
                  <Bars items={stats.top_ships.map((s) => ({ label: s.name ?? `#${s.id}`, value: s.count }))} />
                </div>
                <div className="top-list">
                  <h4>Top sistemas</h4>
                  <Bars
                    items={stats.top_systems.map((s) => ({ label: s.name ?? `#${s.id}`, value: s.count }))}
                    color="#e3a13a"
                  />
                </div>
              </div>
              <div className="tops">
                <div className="top-list">
                  <h4>Kills vs Losses</h4>
                  <Bars
                    items={[
                      { label: "Kills", value: stats.kills },
                      { label: "Losses", value: stats.losses },
                    ]}
                    color="#3fb950"
                  />
                </div>
                <div className="top-list">
                  <h4>ISK destruido vs perdido</h4>
                  <Bars
                    items={[
                      { label: "Destruido", value: stats.isk_destroyed },
                      { label: "Perdido", value: stats.isk_lost },
                    ]}
                    color="#e5534b"
                    fmt={fmtIsk}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="tops">
              <TopList title="Top naves" items={stats.top_ships} icon="render" />
              <div className="top-list">
                <h4>Top sistemas</h4>
                {stats.top_systems.length === 0 && <p className="muted small">Sin datos.</p>}
                <ol>
                  {stats.top_systems.map((it) => (
                    <li key={it.id}>
                      {it.name ?? `#${it.id}`} <span className="muted">({it.count})</span>
                      {it.region && <span className="region"> · {it.region}</span>}
                      {it.name && (
                        <button
                          className="dotlan-link"
                          title={`Ver ${it.name} en Dotlan`}
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
              <h4>Kills más caros</h4>
              <table className="km-table">
                <thead>
                  <tr>
                    <th>Nave destruida</th>
                    <th>Sistema</th>
                    <th>ISK</th>
                    <th>Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.top_expensive.map((k) => (
                    <tr
                      key={k.killmail_id}
                      className="clickable kill"
                      onClick={() => openUrl(zkillUrl(k.killmail_id))}
                      title="Abrir en zKillboard"
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
              {k === "all" ? "Todos" : k === "kill" ? "Kills" : "Losses"}
            </button>
          ))}
        </div>
      </div>
      <table className="km-table">
        <thead>
          <tr>
            <Th label="Tipo" col="type" sort={kmSort} onSort={onKmSort} />
            <Th label="Nave" col="ship" sort={kmSort} onSort={onKmSort} />
            <Th label="Sistema" col="sys" sort={kmSort} onSort={onKmSort} />
            <Th label="Daño" col="dmg" sort={kmSort} onSort={onKmSort} />
            <Th label="ISK" col="isk" sort={kmSort} onSort={onKmSort} />
            <Th label="Fecha" col="date" sort={kmSort} onSort={onKmSort} />
          </tr>
        </thead>
        <tbody>
          {kmSorted.map((k) => (
            <tr
              key={k.killmail_id}
              className={`clickable ${k.is_loss ? "loss" : "kill"}`}
              onClick={() => openUrl(zkillUrl(k.killmail_id))}
              title="Abrir en zKillboard"
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
          ← Anterior
        </button>
        <span className="muted">
          {kmTotal === 0
            ? "Sin killmails"
            : `${kmOffset + 1}–${Math.min(kmOffset + kmLimit, kmTotal)} de ${fmtSp(kmTotal)}`}
        </span>
        <button
          disabled={kmOffset + kmLimit >= kmTotal}
          onClick={() => onKmPage(kmOffset + kmLimit)}
        >
          Siguiente →
        </button>
      </div>
    </>
  );
}

function NetworthViewC(props: { data: NetworthView | null; busy: boolean }) {
  const { data, busy } = props;
  if (!data && busy) return <p className="muted">Cargando…</p>;
  if (!data) return null;
  const s = data.series;

  return (
    <>
      <div className="kpis">
        <Kpi label="Patrimonio total" value={fmtIsk(data.total)} />
        <Kpi label="Líquido (wallet)" value={fmtIsk(data.liquid)} />
        <Kpi label="Valor de assets" value={fmtIsk(data.asset_value)} />
        <Kpi label="Snapshots" value={s.length} />
      </div>

      {data.total > 0 && (
        <div className="panel resumen-panel" style={{ maxWidth: 540, marginBottom: "0.8rem" }}>
          <h4>Composición del patrimonio</h4>
          <Donut
            items={[
              { label: "Líquido (wallet)", value: data.liquid },
              { label: "Valor de assets", value: data.asset_value },
            ]}
            fmt={fmtIsk}
          />
        </div>
      )}

      {data.prices_loaded === 0 && (
        <p className="muted" style={{ marginTop: 8 }}>
          Aún no hay precios de mercado en la BD, así que los assets no están valorados.
          Se descargan solos en la próxima sincronización (endpoint público de ESI).
        </p>
      )}

      {s.length === 0 && (
        <p className="muted" style={{ marginTop: 12 }}>
          Todavía no hay histórico. Cada sincronización guarda un snapshot diario de tu
          patrimonio; la curva de evolución aparecerá a partir del segundo día.
        </p>
      )}

      {s.length === 1 && (
        <p className="muted" style={{ marginTop: 12 }}>
          Primer snapshot guardado ({s[0].date}). La gráfica de evolución necesita al menos
          dos días de datos.
        </p>
      )}

      {s.length >= 2 && <NetworthChart series={s} />}

      {s.length >= 2 && (
        <p className="muted" style={{ marginTop: 8, fontSize: "0.78rem" }}>
          Valor de assets estimado con el precio medio de mercado (average price de ESI),
          no con órdenes reales de Jita. Útil como tendencia, no como liquidación exacta.
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
          <i className="dot total" /> Total
          <i className="dot liquid" /> Líquido
          <i className="dot asset" /> Assets
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
        <span className="muted">máx {fmtIsk(maxV)}</span>
        <span>{last.date}</span>
      </div>
    </div>
  );
}

function WalletViewC(props: {
  data: WalletView | null;
  trend?: WalletTrendPoint[] | null;
  busy: boolean;
  global?: boolean;
  onSync?: () => void;
}) {
  const { data, trend, busy, global, onSync } = props;
  const [chart, setChart] = useState(false);
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
  return (
    <>
      {!global && (
        <div className="pvp-toolbar">
          <button onClick={onSync} disabled={busy}>
            {busy ? "Trabajando…" : "Sincronizar wallet"}
          </button>
        </div>
      )}
      {!data && busy && <p className="muted">Cargando…</p>}
      {data && (
        <>
          <div className="kpis">
            <Kpi label="Balance" value={fmtIsk(data.balance)} />
            <Kpi label="Ingresos" value={fmtIsk(data.stats.income)} tone="pos" />
            <Kpi label="Gastos" value={fmtIsk(data.stats.expense)} tone="neg" />
            <Kpi label="Neto" value={fmtIsk(data.stats.net)} tone={data.stats.net >= 0 ? "pos" : "neg"} />
            <Kpi label="Movimientos" value={data.stats.entries} />
          </div>
          <ViewToggle chart={chart} onChange={setChart} />
          {chart ? (
            <>
              {trend && trend.length >= 2 && (
                <div className="top-list">
                  <h4>Tendencia (ingresos/gastos por mes) · arrastra para enfocar una ventana</h4>
                  <WalletScrub points={trend} />
                </div>
              )}
              <div className="resumen-grid">
                <div className="panel resumen-panel">
                  <h4>Distribución de ingresos</h4>
                  <Donut
                    items={data.stats.top_income.map((r) => ({ label: r.ref_type, value: r.total }))}
                    fmt={fmtIsk}
                  />
                </div>
                <div className="panel resumen-panel">
                  <h4>Top ingresos</h4>
                  <Bars
                    items={data.stats.top_income.map((r) => ({ label: r.ref_type, value: r.total }))}
                    color="#3fb950"
                    fmt={fmtIsk}
                  />
                </div>
                <div className="panel resumen-panel">
                  <h4>Distribución de gastos</h4>
                  <Donut
                    items={data.stats.top_expense.map((r) => ({ label: r.ref_type, value: r.total }))}
                    fmt={fmtIsk}
                  />
                </div>
                <div className="panel resumen-panel">
                  <h4>Top gastos</h4>
                  <Bars
                    items={data.stats.top_expense.map((r) => ({ label: r.ref_type, value: r.total }))}
                    color="#e5534b"
                    fmt={fmtIsk}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="tops">
              <div className="top-list">
                <h4>Top ingresos</h4>
                {data.stats.top_income.length === 0 && <p className="muted small">Sin datos.</p>}
                <ol>
                  {data.stats.top_income.map((r, i) => (
                    <li key={i}>
                      {r.ref_type} <span className="muted">({fmtIsk(r.total)})</span>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="top-list">
                <h4>Top gastos</h4>
                {data.stats.top_expense.length === 0 && <p className="muted small">Sin datos.</p>}
                <ol>
                  {data.stats.top_expense.map((r, i) => (
                    <li key={i}>
                      {r.ref_type} <span className="muted">({fmtIsk(r.total)})</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
          <h4>Movimientos recientes</h4>
          <table className="km-table">
            <thead>
              <tr>
                <Th label="Fecha" col="date" sort={wSort} onSort={onWSort} />
                <Th label="Tipo" col="type" sort={wSort} onSort={onWSort} />
                <Th label="Cantidad" col="amount" sort={wSort} onSort={onWSort} />
                <Th label="Balance" col="balance" sort={wSort} onSort={onWSort} />
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
        { label: "Inteligencia", v: a.intelligence },
        { label: "Memoria", v: a.memory },
        { label: "Percepción", v: a.perception },
        { label: "Carisma", v: a.charisma },
        { label: "Voluntad", v: a.willpower },
      ]
    : [];
  return (
    <div className="char-header">
      <div className="ch-top">
        {portrait && <img className="ch-portrait" src={portrait} alt="" />}
        <div className="ch-id">
          <h3>{card?.name ?? "Personaje"}</h3>
          <div className="ch-sub muted small">
            {card?.corporation_name ?? ""}
            {card?.alliance_name ? ` · ${card.alliance_name}` : ""}
          </div>
          <div className="ch-meta">
            {sec != null && (
              <span>
                Sec:{" "}
                <b style={{ color: secColor(sec) }}>{sec.toFixed(2)}</b>
              </span>
            )}
            {detail.birthday && <span>Nacimiento: {detail.birthday.slice(0, 10)}</span>}
            <span>
              Jump clones: <b>{detail.jump_clones}</b>
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
              <span className="ch-attr-l">Remaps libres</span>
            </div>
          )}
        </div>
      )}

      {detail.implants.length > 0 && (
        <div className="top-list">
          <h4>Implantes ({detail.implants.length})</h4>
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
          <summary>Biografía</summary>
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
      {!data && busy && <p className="muted">Cargando…</p>}
      {data && (
        <>
          <div className="kpis">
            <Kpi label="SP total" value={fmtSp(data.total_sp)} />
            <Kpi label="SP sin asignar" value={fmtSp(data.unallocated_sp)} />
            <Kpi label="Skills" value={data.skill_count} />
            <Kpi label="En cola" value={data.queue.length} />
          </div>
          <h4>Cola de entrenamiento</h4>
          {data.queue.length === 0 && <p className="muted small">Cola vacía.</p>}
          {data.queue.length > 0 && (
            <table className="km-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Skill</th>
                  <th>Nivel</th>
                  <th>Termina</th>
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

let nePromise: Promise<NewEden> | null = null;
function loadNewEden(): Promise<NewEden> {
  if (!nePromise) nePromise = fetch("/neweden.json").then((r) => r.json());
  return nePromise;
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

const MAP_W = 1000;
const MAP_H = 760;
const MAP_PAD = 16;

type RouteMode = "shortest" | "safer" | "insecure";

/** Dijkstra sobre el grafo de stargates. mode pondera seguridad. */
function findRoute(
  adj: Map<number, number[]>,
  idx: Map<number, NeSystem>,
  from: number,
  to: number,
  mode: RouteMode
): number[] | null {
  if (from === to) return [from];
  const weight = (n: number) => {
    const sec = idx.get(n)?.s ?? 0;
    const hi = sec >= 0.45;
    if (mode === "safer") return 1 + (hi ? 0 : 60);
    if (mode === "insecure") return 1 + (hi ? 60 : 0);
    return 1;
  };
  const dist = new Map<number, number>([[from, 0]]);
  const prev = new Map<number, number>();
  const visited = new Set<number>();
  const frontier = new Map<number, number>([[from, 0]]);
  while (frontier.size) {
    let u = -1;
    let best = Infinity;
    for (const [k, d] of frontier) if (d < best) ((best = d), (u = k));
    frontier.delete(u);
    if (u === to) break;
    if (visited.has(u)) continue;
    visited.add(u);
    for (const v of adj.get(u) ?? []) {
      if (visited.has(v)) continue;
      const nd = best + weight(v);
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd);
        prev.set(v, u);
        frontier.set(v, nd);
      }
    }
  }
  if (!prev.has(to)) return null;
  const path = [to];
  let c = to;
  while (c !== from) {
    const p = prev.get(c);
    if (p === undefined) return null;
    path.push(p);
    c = p;
  }
  path.reverse();
  return path;
}

// Facciones de la Guerra de Facciones (los 4 imperios). Color + nombre por faction_id.
function SystemSearch(props: {
  systems: NeSystem[];
  value: number | null;
  placeholder?: string;
  onPick: (id: number) => void;
}) {
  const { systems, value, placeholder, onPick } = props;
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const chosen = value != null ? systems.find((s) => s.id === value) : undefined;
  const text = focused ? q : chosen?.n ?? q;
  const ql = q.trim().toLowerCase();
  const matches =
    focused && ql.length >= 2
      ? systems.filter((s) => s.n.toLowerCase().includes(ql)).slice(0, 8)
      : [];
  return (
    <div className="sys-search">
      <input
        value={text}
        placeholder={placeholder}
        onFocus={() => {
          setFocused(true);
          setQ("");
        }}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onChange={(e) => setQ(e.target.value)}
      />
      {matches.length > 0 && (
        <ul className="sys-search-list">
          {matches.map((m) => (
            <li
              key={m.id}
              onMouseDown={() => {
                onPick(m.id);
                setFocused(false);
              }}
            >
              {m.n} <span className="muted">{m.s.toFixed(1)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Audio de alerta (Web Audio, sin assets ni plugins). Un único AudioContext compartido:
// el webview lo arranca "suspended" hasta que hay un gesto del usuario, así que lo reanudamos.
let _actx: AudioContext | null = null;
function audioCtx(): AudioContext | null {
  try {
    if (!_actx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      _actx = new Ctx();
    }
    if (_actx.state === "suspended") void _actx.resume();
    return _actx;
  } catch {
    return null;
  }
}
// Un tono con envolvente attack/decay. Llamar desde un gesto del usuario "desbloquea" el audio.
function tone(
  freq: number,
  startAt: number,
  dur: number,
  type: OscillatorType = "square",
  peak = 0.14
) {
  const ctx = audioCtx();
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.connect(g);
  g.connect(ctx.destination);
  o.type = type;
  o.frequency.value = freq;
  const t = ctx.currentTime + startAt;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t);
  o.stop(t + dur + 0.02);
}
// Un barrido de frecuencia (para sirena/sonar): lista de [tiempoRel, frec].
function sweep(points: [number, number][], dur: number, type: OscillatorType, peak: number) {
  const ctx = audioCtx();
  if (!ctx || points.length === 0) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.connect(g);
  g.connect(ctx.destination);
  o.type = type;
  const t0 = ctx.currentTime;
  o.frequency.setValueAtTime(points[0][1], t0);
  for (const [dt, f] of points) o.frequency.linearRampToValueAtTime(f, t0 + dt);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.04);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}
// Catálogo de sonidos de alerta integrados (clave → etiqueta). Basado en los tipos de alerta
// mejor valorados: ping cristalino (alta prioridad), chime de 2 notas, alarma corta, campana, sonar.
const ALERT_SOUNDS: { key: string; label: string }[] = [
  { key: "ping", label: "Ping cristalino" },
  { key: "double", label: "Chime (dos notas)" },
  { key: "triple", label: "Alarma (urgente)" },
  { key: "bell", label: "Campana" },
  { key: "sonar", label: "Sonar" },
  { key: "siren", label: "Sirena" },
  { key: "custom", label: "Personalizado (archivo)" },
];
function playPreset(key: string) {
  if (!audioCtx()) return;
  if (key === "ping") {
    // Ping brillante tipo cristal: fundamental + octava de brillo, decaimiento corto.
    tone(1568, 0, 0.38, "sine", 0.24);
    tone(3136, 0, 0.22, "sine", 0.05);
  } else if (key === "triple") {
    // Alarma urgente: tres pulsos cortos y brillantes.
    tone(1047, 0, 0.09, "square", 0.16);
    tone(1047, 0.14, 0.09, "square", 0.16);
    tone(1047, 0.28, 0.11, "square", 0.16);
  } else if (key === "siren") {
    sweep([[0, 600], [0.3, 1100], [0.6, 600]], 0.62, "sawtooth", 0.12);
  } else if (key === "bell") {
    // Campana: fundamental + parcial inarmónico (~2.76×), cola larga.
    tone(880, 0, 0.95, "sine", 0.22);
    tone(2429, 0, 0.6, "sine", 0.07);
  } else if (key === "sonar") {
    // Ping de sonar: descenso de tono con cola + eco suave.
    sweep([[0, 900], [0.5, 480]], 0.55, "sine", 0.2);
    tone(700, 0.55, 0.3, "sine", 0.07);
  } else {
    // "double" (por defecto): chime ascendente de dos notas, suave.
    tone(784, 0, 0.18, "triangle", 0.17);
    tone(1175, 0.16, 0.5, "triangle", 0.17);
  }
}
// Sonido personalizado desde un archivo (cargado vía Rust → Blob, reproducible aun minimizado).
let _customAudio: HTMLAudioElement | null = null;
let _customUrl: string | null = null;
async function loadCustomSound(path: string) {
  try {
    const bytes = await invoke<number[]>("read_audio_file", { path });
    const blob = new Blob([new Uint8Array(bytes)]);
    if (_customUrl) URL.revokeObjectURL(_customUrl);
    _customUrl = URL.createObjectURL(blob);
    _customAudio = new Audio(_customUrl);
  } catch {
    _customAudio = null;
  }
}
function playCustom() {
  if (_customAudio) {
    _customAudio.currentTime = 0;
    void _customAudio.play().catch(() => {});
  } else {
    playPreset("double"); // fallback si el archivo no cargó
  }
}
// Pitido simple (para desbloquear audio con un gesto).
function beep() {
  tone(880, 0, 0.18);
}
// Reproduce la alerta según la elección del usuario.
function playAlertChoice(choice: string) {
  if (choice === "custom") playCustom();
  else playPreset(choice);
}

// Notificación nativa del SO (alarma de intel aunque la app esté minimizada).
let _notifPerm: boolean | null = null;
async function ensureNotifPerm(): Promise<boolean> {
  if (_notifPerm !== null) return _notifPerm;
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    _notifPerm = granted;
  } catch {
    _notifPerm = false;
  }
  return _notifPerm ?? false;
}

function MapView(props: {
  data: SysActivity[] | null;
  busy: boolean;
  overlay: MapOverlay;
  onOverlayChange: (o: MapOverlay) => void;
  assetsBySystem?: Map<number, number> | null;
  miningBySystem?: Map<number, number> | null;
  sovBySystem?: Map<number, SovSystem> | null;
  fwBySystem?: Map<number, FwSystem> | null;
  factionStandings?: Map<number, number> | null;
  incursions?: Incursion[] | null;
  theraConns?: WhConn[] | null;
  intel?: {
    lines: IntelLine[];
    availChannels: string[];
    channels: string[];
    folder: string;
    recency: number;
    alertJumps: number;
    sound: boolean;
    anchors: number[];
    onlyRange: boolean;
    soundChoice: string;
    soundFile: string;
    onConfig: (patch: {
      channels?: string[];
      recency?: number;
      alertJumps?: number;
      sound?: boolean;
      folder?: string;
      anchors?: number[];
      onlyRange?: boolean;
      soundChoice?: string;
      soundFile?: string;
    }) => void;
    onPickFolder: () => void;
    onPickSound: () => void;
  };
  hereSystemId?: number | null;
  charLocations?: CharLoc[];
  characters?: Character[];
  onSystemAssets?: (systemName: string) => void;
}) {
  const {
    data,
    overlay,
    onOverlayChange,
    intel,
    onSystemAssets,
    assetsBySystem,
    miningBySystem,
    sovBySystem,
    fwBySystem,
    factionStandings,
    incursions,
    theraConns,
    hereSystemId,
    charLocations,
    characters = [],
  } = props;
  const [ne, setNe] = useState<NewEden | null>(null);
  const [factionMap, setFactionMap] = useState<Record<string, number> | null>(null);
  const [liveKills, setLiveKills] = useState<Map<number, number> | null>(null);
  const [liveJumps, setLiveJumps] = useState<Map<number, number> | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const [view, setView] = useState({ z: 1, x: 0, y: 0 });
  const [selected, setSelected] = useState<number | null>(null);
  const [hover, setHover] = useState<{ sid: number; sx: number; sy: number } | null>(null);
  const [subFilter, setSubFilter] = useState<string>("all"); // sub-filtro de la capa activa
  useEffect(() => setSubFilter("all"), [overlay]); // reset al cambiar de capa
  const [openCat, setOpenCat] = useState<string | null>(null); // desplegable de categoría de capas abierto
  const [ctxCollapsed, setCtxCollapsed] = useState(false); // panel de contexto plegado
  // Planificador de rutas
  const [routeActive, setRouteActive] = useState(false);
  const [routeMode, setRouteMode] = useState<RouteMode>("shortest");
  // Paradas de la ruta: [origen, destino1, destino2, ...]. null = casilla vacía.
  const [routeStops, setRouteStops] = useState<(number | null)[]>([null]);
  // Planificador de saltos de capital (jump drive)
  const [jumpActive, setJumpActive] = useState(false);
  const [jumpOrigin, setJumpOrigin] = useState<number | null>(null);
  const [jumpDest, setJumpDest] = useState<number | null>(null);
  const [jumpRange, setJumpRange] = useState(5);
  // Naves de salto (del SDE: rango base, fuel/LY, isótopo) + skills del piloto.
  const [jumpShips, setJumpShips] = useState<JumpShip[]>([]);
  const [jumpShip, setJumpShip] = useState<string>(""); // nombre de la nave elegida
  const [jdcLevel, setJdcLevel] = useState(5); // Jump Drive Calibration → +20% rango/nivel (×2 a V)
  const [jfcLevel, setJfcLevel] = useState(5); // Jump Fuel Conservation → −10% fuel/nivel
  const [jumpChar, setJumpChar] = useState<number | null>(null); // pj del que cargar skills/naves
  const [jumpOwned, setJumpOwned] = useState<Set<number>>(new Set()); // type_ids de naves propias
  const [jumpFatigue, setJumpFatigue] = useState<{ expire: string | null } | null>(null);
  const [jumpFatMissing, setJumpFatMissing] = useState(false); // falta el scope de fatiga
  const [fatNow, setFatNow] = useState(Date.now()); // tick para el contador de fatiga
  // Al elegir personaje: cargar sus niveles JDC/JFC, naves que posee y la fatiga actual.
  useEffect(() => {
    if (jumpChar == null) {
      setJumpOwned(new Set());
      setJumpFatigue(null);
      setJumpFatMissing(false);
      return;
    }
    invoke<{ jdc: number; jfc: number; owned: number[] }>("get_jump_profile", {
      characterId: jumpChar,
    })
      .then((p) => {
        setJdcLevel(p.jdc);
        setJfcLevel(p.jfc);
        setJumpOwned(new Set(p.owned));
      })
      .catch(() => setJumpOwned(new Set()));
    invoke<{ jump_fatigue_expire_date: string | null }>("get_fatigue", { characterId: jumpChar })
      .then((f) => {
        setJumpFatigue({ expire: f.jump_fatigue_expire_date });
        setJumpFatMissing(false);
      })
      .catch(() => {
        setJumpFatigue(null);
        setJumpFatMissing(true);
      });
  }, [jumpChar]);
  // Contador de fatiga: refresca cada 30 s mientras el modo salto está activo.
  useEffect(() => {
    if (!jumpActive) return;
    const id = window.setInterval(() => setFatNow(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, [jumpActive]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const clickTimer = useRef<number | null>(null);
  const movedRef = useRef(false);
  // Zoom con rueda: el mapa se "arma" cuando el cursor lleva un instante dentro (~140 ms)
  // o al hacer clic. Una pasada rápida mientras scrolleas la página NO llega a armarlo, así
  // que no roba el scroll. La comprobación se hace en el momento de la rueda (más fiable que
  // depender de un setTimeout). `insideSince` = timestamp de entrada (0 = fuera).
  const DWELL_MS = 140;
  const [mapActive, setMapActive] = useState(false); // solo para el borde visual
  const insideSince = useRef(0);
  const borderTimer = useRef<number | null>(null);
  const enterMap = () => {
    if (insideSince.current === 0) insideSince.current = performance.now();
    if (borderTimer.current == null) {
      borderTimer.current = window.setTimeout(() => {
        borderTimer.current = null;
        if (insideSince.current > 0) setMapActive(true);
      }, DWELL_MS);
    }
  };
  const leaveMap = () => {
    insideSince.current = 0;
    if (borderTimer.current != null) {
      window.clearTimeout(borderTimer.current);
      borderTimer.current = null;
    }
    setMapActive(false);
  };
  const forceActive = () => {
    insideSince.current = performance.now() - 10000; // armado inmediato (clic)
    setMapActive(true);
  };
  useEffect(
    () => () => {
      if (borderTimer.current != null) window.clearTimeout(borderTimer.current);
    },
    []
  );

  useEffect(() => {
    loadNewEden().then(setNe).catch(() => {});
    // Facción NPC por sistema (del SDE) para la capa de standings.
    fetch("/system-factions.json")
      .then((r) => r.json())
      .then(setFactionMap)
      .catch(() => {});
    // Naves de salto (rango/fuel/isótopo) extraídas del SDE.
    fetch("/jumpships.json")
      .then((r) => r.json())
      .then((d) => setJumpShips(d.ships || []))
      .catch(() => {});
    // Actividad en vivo (1h) para tooltips, siempre disponible.
    invoke<SystemKills[]>("get_system_kills")
      .then((rows) => {
        const m = new Map<number, number>();
        for (const r of rows) m.set(r.system_id, r.ship_kills + r.pod_kills);
        setLiveKills(m);
      })
      .catch(() => {});
    invoke<SystemJumps[]>("get_system_jumps")
      .then((rows) => {
        const m = new Map<number, number>();
        for (const r of rows) m.set(r.system_id, r.ship_jumps);
        setLiveJumps(m);
      })
      .catch(() => {});
  }, []);

  // Convierte coords de pantalla a coords del viewBox usando la matriz real del SVG
  // (correcto aunque haya letterbox por max-height / aspect ratio distinto).
  function clientToVB(clientX: number, clientY: number): { x: number; y: number } | null {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }
  // Listener de rueda NO pasivo: así podemos preventDefault y el zoom no scrollea la página.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      // Solo capturamos la rueda si el cursor lleva ya un instante dentro del mapa
      // (evita robar el scroll en una pasada rápida). Si no, dejamos pasar → scroll de página.
      const armed = insideSince.current > 0 && performance.now() - insideSince.current >= DWELL_MS;
      if (!armed) return;
      e.preventDefault();
      const vb = clientToVB(e.clientX, e.clientY);
      if (!vb) return;
      setView((v) => {
        const nz = Math.min(Math.max(v.z * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 1), 24);
        const wx = (vb.x - v.x) / v.z;
        const wy = (vb.y - v.y) / v.z;
        return { z: nz, x: vb.x - wx * nz, y: vb.y - wy * nz };
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
    // Depende de `ne`: el SVG no existe hasta que carga el SDE; al aparecer, re-engancha.
  }, [ne]);
  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
    movedRef.current = false;
    forceActive(); // interactuar (clic/arrastre) arma el zoom de inmediato
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (insideSince.current === 0) enterMap(); // fallback si onPointerEnter no llegó
    if (drag.current) {
      const dx = e.clientX - drag.current.x;
      const dy = e.clientY - drag.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) {
        drag.current.moved = true;
        movedRef.current = true;
      }
      drag.current.x = e.clientX;
      drag.current.y = e.clientY;
      // Convierte el desplazamiento de pantalla a unidades del viewBox con la escala real.
      const ctm = svgRef.current?.getScreenCTM();
      const sx = ctm && ctm.a ? 1 / ctm.a : 1;
      const sy = ctm && ctm.d ? 1 / ctm.d : 1;
      setView((v) => ({ ...v, x: v.x + dx * sx, y: v.y + dy * sy }));
      return;
    }
    // Detección de sistema bajo el cursor (para el tooltip), eficiente.
    const rect = svgRef.current?.getBoundingClientRect();
    const vb = clientToVB(e.clientX, e.clientY);
    if (!rect || !vb || !geo) return;
    const wx = (vb.x - view.x) / view.z;
    const wy = (vb.y - view.y) / view.z;
    const thr = 14 / view.z;
    let bestId = -1;
    let bestD = thr;
    for (const s of geo.idx.values()) {
      const p = geo.proj(s);
      const dd = Math.abs(p.px - wx) + Math.abs(p.py - wy);
      if (dd < bestD) {
        bestD = dd;
        bestId = s.id;
      }
    }
    const nid = bestId >= 0 ? bestId : null;
    setHover((prev) => {
      if ((prev?.sid ?? null) === nid) return prev; // sin cambio → sin re-render
      return nid == null ? null : { sid: nid, sx: e.clientX - rect.left, sy: e.clientY - rect.top };
    });
  }
  function onPointerUp() {
    drag.current = null;
  }
  // Zoom con botones manteniendo fijo el centro del viewport actual.
  function zoomBy(factor: number) {
    setView((v) => {
      const nz = Math.min(Math.max(v.z * factor, 1), 24);
      const cx = MAP_W / 2;
      const cy = MAP_H / 2;
      const wx = (cx - v.x) / v.z;
      const wy = (cy - v.y) / v.z;
      return { z: nz, x: cx - wx * nz, y: cy - wy * nz };
    });
  }
  function onDoubleClick(e: React.MouseEvent<SVGSVGElement>) {
    if (clickTimer.current) {
      window.clearTimeout(clickTimer.current); // cancela la selección pendiente
      clickTimer.current = null;
    }
    const vb = clientToVB(e.clientX, e.clientY);
    if (!vb) return;
    setView((v) => {
      const nz = Math.min(v.z * 1.8, 24);
      const wx = (vb.x - v.x) / v.z;
      const wy = (vb.y - v.y) / v.z;
      return { z: nz, x: vb.x - wx * nz, y: vb.y - wy * nz };
    });
  }
  // Click "diferido": si llega un doble-click antes de 200ms, se cancela (solo zoom, sin seleccionar).
  function clickSystem(sid: number) {
    if (movedRef.current) return; // fue un paneo
    if (clickTimer.current) window.clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(() => {
      selectSystem(sid);
      clickTimer.current = null;
    }, 200);
  }
  function selectSystem(sid: number) {
    if (drag.current?.moved) return; // fue un paneo, no un click
    if (jumpActive) {
      // Primer click fija el origen; los siguientes fijan el destino (para fuel/distancia).
      if (jumpOrigin == null) setJumpOrigin(sid);
      else setJumpDest(sid);
      return;
    }
    if (routeActive) {
      setRouteStops((prev) => {
        const i = prev.indexOf(null);
        if (i >= 0) {
          const copy = [...prev];
          copy[i] = sid;
          return copy;
        }
        return [...prev, sid];
      });
      return;
    }
    setIntelDetail(null); // panel de sistema y tarjeta de detalle comparten sitio
    setSelected(sid);
  }

  useEffect(() => {
    if ((overlay === "kills" || routeActive) && !liveKills) {
      setLiveBusy(true);
      invoke<SystemKills[]>("get_system_kills")
        .then((rows) => {
          const m = new Map<number, number>();
          for (const r of rows) m.set(r.system_id, r.ship_kills + r.pod_kills);
          setLiveKills(m);
        })
        .catch(() => {})
        .finally(() => setLiveBusy(false));
    }
    if (overlay === "jumps" && !liveJumps) {
      setLiveBusy(true);
      invoke<SystemJumps[]>("get_system_jumps")
        .then((rows) => {
          const m = new Map<number, number>();
          for (const r of rows) m.set(r.system_id, r.ship_jumps);
          setLiveJumps(m);
        })
        .catch(() => {})
        .finally(() => setLiveBusy(false));
    }
  }, [overlay, routeActive, liveKills, liveJumps]);

  // Proyección + backdrop (líneas) + centroides de región, memorizado por el dataset.
  const geo = useMemo(() => {
    if (!ne) return null;
    let xMin = Infinity,
      xMax = -Infinity,
      yMin = Infinity,
      yMax = -Infinity;
    for (const s of ne.systems) {
      const py = -s.y;
      if (s.x < xMin) xMin = s.x;
      if (s.x > xMax) xMax = s.x;
      if (py < yMin) yMin = py;
      if (py > yMax) yMax = py;
    }
    const xr = xMax - xMin || 1;
    const yr = yMax - yMin || 1;
    const scale = Math.min((MAP_W - 2 * MAP_PAD) / xr, (MAP_H - 2 * MAP_PAD) / yr);
    const offX = (MAP_W - xr * scale) / 2;
    const offY = (MAP_H - yr * scale) / 2;
    const proj = (s: NeSystem) => ({
      px: offX + (s.x - xMin) * scale,
      py: offY + (-s.y - yMin) * scale,
    });
    const idx = new Map<number, NeSystem>(ne.systems.map((s) => [s.id, s]));
    const nameIdx = new Map<string, NeSystem>(ne.systems.map((s) => [s.n.toLowerCase(), s]));
    const adj = new Map<number, number[]>();
    let jumpsPath = "";
    for (const [a, b] of ne.jumps) {
      const sa = idx.get(a);
      const sb = idx.get(b);
      if (!sa || !sb) continue;
      (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
      (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
      const pa = proj(sa);
      const pb = proj(sb);
      jumpsPath += `M${pa.px.toFixed(1)} ${pa.py.toFixed(1)}L${pb.px.toFixed(1)} ${pb.py.toFixed(1)}`;
    }
    // Centroides de región y constelación (para etiquetas LOD).
    const centroids = (key: (s: NeSystem) => number, names: Map<number, string>) => {
      const acc = new Map<number, { sx: number; sy: number; n: number }>();
      for (const s of ne.systems) {
        const p = proj(s);
        const a = acc.get(key(s)) ?? { sx: 0, sy: 0, n: 0 };
        a.sx += p.px;
        a.sy += p.py;
        a.n += 1;
        acc.set(key(s), a);
      }
      return [...acc.entries()].map(([id, a]) => ({
        name: names.get(id) ?? "",
        px: a.sx / a.n,
        py: a.sy / a.n,
      }));
    };
    const regionLabels = centroids(
      (s) => s.r,
      new Map(ne.regions.map((r) => [r.id, r.n]))
    );
    const constLabels = centroids(
      (s) => s.c,
      new Map(ne.constellations.map((c) => [c.id, c.n]))
    );
    return { proj, idx, nameIdx, adj, jumpsPath, regionLabels, constLabels };
  }, [ne]);

  // Fondo de estrellas memorizado (no se reconstruye al mover el ratón / hover).
  const backdropCircles = useMemo(() => {
    if (!geo || !ne) return null;
    const isSec = overlay === "security";
    return ne.systems.map((s) => {
      const p = geo.proj(s);
      return (
        <circle
          key={s.id}
          cx={p.px}
          cy={p.py}
          r={isSec ? 1.4 : 0.7}
          fill={isSec ? secColor(s.s) : "#3a4654"}
          fillOpacity={isSec ? 0.9 : 1}
        />
      );
    });
  }, [geo, ne, overlay]);

  // Soberanía memorizada (círculos coloreados por dueño).
  const sovCircles = useMemo(() => {
    if (!geo || overlay !== "soberania" || !sovBySystem) return null;
    return [...sovBySystem.values()].map((sv) => {
      if (sv.owner_id == null) return null;
      // sub-filtro: Alianzas (alliance/corp) vs Facciones (faction)
      if (subFilter === "alliance" && !(sv.kind === "alliance" || sv.kind === "corporation")) return null;
      if (subFilter === "faction" && sv.kind !== "faction") return null;
      const s = geo.idx.get(sv.system_id);
      if (!s) return null;
      const p = geo.proj(s);
      return <circle key={`sov-${sv.system_id}`} cx={p.px} cy={p.py} r={1.6} fill={ownerColor(sv.owner_id)} fillOpacity={0.85} />;
    });
  }, [geo, overlay, sovBySystem, subFilter]);

  // Guerra de facciones: color = imperio que controla; radio/intensidad = cuán disputado.
  const fwCircles = useMemo(() => {
    if (!geo || overlay !== "fw" || !fwBySystem) return null;
    return [...fwBySystem.values()].map((f) => {
      if (subFilter !== "all" && f.owner_faction_id !== Number(subFilter)) return null;
      const s = geo.idx.get(f.solar_system_id);
      if (!s) return null;
      const p = geo.proj(s);
      const col = FW_FACTIONS[f.owner_faction_id]?.color ?? "#888";
      const pct =
        f.victory_points_threshold > 0 ? f.victory_points / f.victory_points_threshold : 0;
      const r = 1.6 + Math.min(Math.max(pct, 0), 1) * 1.6;
      const op = f.contested === "vulnerable" ? 1 : f.contested === "contested" ? 0.85 : 0.55;
      return <circle key={`fw-${f.solar_system_id}`} cx={p.px} cy={p.py} r={r} fill={col} fillOpacity={op} />;
    });
  }, [geo, overlay, fwBySystem, subFilter]);

  // Standings por sistema: color = tu standing con la facción NPC que controla el sistema.
  const standingCircles = useMemo(() => {
    if (!geo || overlay !== "standings" || !factionMap || !factionStandings) return null;
    return Object.entries(factionMap).map(([sidStr, fac]) => {
      if (!factionStandings.has(fac)) return null;
      const s = geo.idx.get(Number(sidStr));
      if (!s) return null;
      const std = factionStandings.get(fac) as number;
      const p = geo.proj(s);
      return (
        <circle
          key={`std-${sidStr}`}
          cx={p.px}
          cy={p.py}
          r={1.8}
          fill={standingColor(std)}
          fillOpacity={0.85}
        />
      );
    });
  }, [geo, overlay, factionMap, factionStandings]);

  // Incursiones de Sansha: sistemas infestados; el de staging más grande. Color = estado.
  const incursionCircles = useMemo(() => {
    if (!geo || overlay !== "incursion" || !incursions) return null;
    const stateColor = (st: string | null) =>
      st === "withdrawing" ? "#e0c84a" : st === "mobilizing" ? "#e08a3a" : "#e05a5a";
    return incursions.flatMap((inc) => {
      const col = stateColor(inc.state);
      return inc.infested_solar_systems.map((sid) => {
        const s = geo.idx.get(sid);
        if (!s) return null;
        const p = geo.proj(s);
        const staging = sid === inc.staging_solar_system_id;
        return (
          <circle
            key={`inc-${sid}`}
            cx={p.px}
            cy={p.py}
            r={staging ? 2.6 : 1.6}
            fill={col}
            fillOpacity={staging ? 1 : 0.7}
            stroke={staging ? "#0a0d12" : undefined}
            strokeWidth={staging ? 0.6 : undefined}
          >
            <title>{`${s.n}${staging ? " (staging)" : ""} — incursión ${inc.state ?? ""}`}</title>
          </circle>
        );
      });
    });
  }, [geo, overlay, incursions]);

  // Capa de wormholes (eve-scout): marca los sistemas con conexión Thera/Turnur.
  const theraCircles = useMemo(() => {
    if (!geo || overlay !== "wormholes" || !theraConns) return null;
    return theraConns.map((c, i) => {
      const s = geo.idx.get(c.system_id);
      if (!s) return null;
      const p = geo.proj(s);
      const col = c.hub === "Turnur" ? "#e0863a" : "#3ad6e0"; // Turnur naranja · Thera cian
      return (
        <circle
          key={`wh-${c.system_id}-${i}`}
          cx={p.px}
          cy={p.py}
          r={2.4}
          fill={col}
          fillOpacity={0.85}
          stroke="#0a0d12"
          strokeWidth={0.5}
        >
          <title>{`${s.n} — ${c.hub} (${c.wh_type || "WH"}) · ${c.max_ship_size || "?"} · ~${c.remaining_hours}h`}</title>
        </circle>
      );
    });
  }, [geo, overlay, theraConns]);

  // Orígenes de proximidad: sistema del pj + puntos de ancla elegidos (sin duplicados).
  const intelOrigins = useMemo(() => {
    const set = new Set<number>();
    if (hereSystemId != null) set.add(hereSystemId);
    for (const a of intel?.anchors ?? []) set.add(a);
    return [...set];
  }, [hereSystemId, intel?.anchors]);

  // --- Intel: proximidad (BFS multi-origen: distancia al más cercano de los orígenes) ---
  const jumpsFrom = useMemo(() => {
    if (!geo || intelOrigins.length === 0) return null;
    const dist = new Map<number, number>();
    const q: number[] = [];
    for (const o of intelOrigins) {
      if (!dist.has(o)) {
        dist.set(o, 0);
        q.push(o);
      }
    }
    let head = 0;
    while (head < q.length) {
      const cur = q[head++];
      const d = dist.get(cur)!;
      for (const nb of geo.adj.get(cur) ?? []) {
        if (!dist.has(nb)) {
          dist.set(nb, d + 1);
          q.push(nb);
        }
      }
    }
    return dist;
  }, [geo, intelOrigins]);

  // --- Intel: parsear líneas → reportes por sistema + feed cronológico ---
  const intelReports = useMemo(() => {
    if (!geo || !intel) return null;
    const rep = new Map<number, { ts: number; author: string; message: string; name: string }>();
    const feed: {
      ts: number;
      author: string;
      message: string;
      sysId: number | null;
      sysName: string | null;
    }[] = [];
    const CLEAR = new Set(["clr", "clear", "cleared"]);
    for (const l of intel.lines) {
      let isClear = false;
      const matched: { id: number; name: string }[] = [];
      for (const tok of l.message.split(/\s+/)) {
        const c = tok.replace(/[*.,;:!?()]+$/g, "").replace(/^[*([]+/g, "").trim();
        if (!c) continue;
        if (CLEAR.has(c.toLowerCase())) {
          isClear = true;
          continue;
        }
        const s = geo.nameIdx.get(c.toLowerCase());
        if (s) matched.push({ id: s.id, name: s.n });
      }
      const primary = matched[0];
      feed.push({
        ts: l.ts_ms,
        author: l.author,
        message: l.message,
        sysId: primary?.id ?? null,
        sysName: primary?.name ?? null,
      });
      for (const m of matched) {
        if (isClear) rep.delete(m.id);
        else rep.set(m.id, { ts: l.ts_ms, author: l.author, message: l.message, name: m.name });
      }
    }
    feed.reverse(); // más reciente primero
    return { rep, feed };
  }, [geo, intel?.lines]);

  // --- Intel: círculos en el mapa (rojo, opacidad por recencia) ---
  const intelCircles = useMemo(() => {
    if (!geo || overlay !== "intel" || !intelReports) return null;
    const now = Date.now();
    const recencyMs = (intel?.recency ?? 30) * 60000;
    return [...intelReports.rep.entries()].map(([sid, r]) => {
      const s = geo.idx.get(sid);
      if (!s) return null;
      const p = geo.proj(s);
      const op = Math.max(0.18, 1 - (now - r.ts) / recencyMs);
      const j = jumpsFrom?.get(sid);
      const near = j != null && j <= (intel?.alertJumps ?? 0);
      // Filtro "solo en rango": oculta lo que esté fuera del umbral de saltos.
      if (intel?.onlyRange && !near) return null;
      return (
        <g
          key={`intel-${sid}`}
          style={{ cursor: "pointer" }}
          onClick={(e) => {
            e.stopPropagation();
            if (movedRef.current) return; // fue un paneo
            openIntelDetail({ sysId: sid, sysName: s.n, ts: r.ts, author: r.author, message: r.message });
          }}
        >
          {/* Solo los sistemas cercanos pulsan (animación). Los lejanos = anillo estático
              → reduce drásticamente el nº de animaciones SMIL y el repintado del SVG. */}
          {near ? (
            <circle cx={p.px} cy={p.py} r={1.4} fill="none" stroke="#ff3b3b" strokeOpacity={op * 0.7} strokeWidth={0.5} pointerEvents="none">
              <animate attributeName="r" values="1.4;3.2;1.4" dur="1.1s" repeatCount="indefinite" />
              <animate attributeName="stroke-opacity" values={`${op * 0.7};0;${op * 0.7}`} dur="1.1s" repeatCount="indefinite" />
            </circle>
          ) : (
            <circle cx={p.px} cy={p.py} r={2.1} fill="none" stroke="#ff3b3b" strokeOpacity={op * 0.3} strokeWidth={0.4} pointerEvents="none" />
          )}
          {/* zona de click ampliada (invisible) para acertar fácil el punto + tooltip */}
          <circle cx={p.px} cy={p.py} r={2.6} fill="transparent">
            <title>{`${s.n}${j != null ? ` · ${j} saltos` : ""}\n${r.author}: ${r.message}\n(clic para ver detalle)`}</title>
          </circle>
          <circle cx={p.px} cy={p.py} r={1.3} fill="#ff3b3b" fillOpacity={op} stroke="#0a0d12" strokeWidth={0.3} pointerEvents="none" />
        </g>
      );
    });
  }, [geo, overlay, intelReports, jumpsFrom, intel?.recency, intel?.alertJumps, intel?.onlyRange]);

  // --- Intel: marcadores de los puntos de ancla (anclas de proximidad) ---
  const intelAnchorMarkers = useMemo(() => {
    if (!geo || overlay !== "intel") return null;
    const z = view.z;
    return (intel?.anchors ?? []).map((sid) => {
      const s = geo.idx.get(sid);
      if (!s) return null;
      const p = geo.proj(s);
      return (
        <g key={`anchor-${sid}`} pointerEvents="none">
          <circle
            cx={p.px}
            cy={p.py}
            r={2.4 / z}
            fill="none"
            stroke="#5ad6ff"
            strokeWidth={0.5 / z}
            strokeDasharray={`${1.1 / z} ${0.9 / z}`}
          />
          <text
            x={p.px}
            y={p.py + 0.9 / z}
            textAnchor="middle"
            style={{ fontSize: `${2.6 / z}px` }}
            fill="#5ad6ff"
          >
            ⚓
          </text>
        </g>
      );
    });
  }, [geo, overlay, intel?.anchors, view.z]);

  // --- Intel: banner de alerta. La DETECCIÓN ahora la hace un hilo en Rust (start_intel_watch),
  // que dispara la notificación nativa y emite "intel-alert"; aquí solo mostramos banner + sonido. ---
  const [intelAlert, setIntelAlert] = useState<{
    text: string;
    report: { sysId: number; sysName: string; ts: number; author: string; message: string };
  } | null>(null);

  // Enviar el grafo (nombres↔id + aristas) a Rust una vez, en cuanto haya datos del mapa.
  useEffect(() => {
    if (!geo || !ne) return;
    const names: [string, number][] = [...geo.nameIdx.entries()].map(([n, s]) => [n, s.id]);
    const edges: [number, number][] = ne.jumps as [number, number][];
    invoke("set_intel_graph", { names, edges }).catch(() => {});
  }, [geo, ne]);

  // Arrancar / reconfigurar / detener el vigilante de Rust según la capa y la config.
  useEffect(() => {
    if (overlay !== "intel" || !intel || !intel.folder || intel.channels.length === 0) {
      invoke("stop_intel_watch").catch(() => {});
      return;
    }
    invoke("start_intel_watch", {
      folder: intel.folder,
      channels: intel.channels,
      recencyMinutes: intel.recency,
      origins: intelOrigins,
      alertJumps: intel.alertJumps,
    }).catch(() => {});
    return () => {
      invoke("stop_intel_watch").catch(() => {});
    };
  }, [overlay, intel?.folder, intel?.channels, intel?.recency, intel?.alertJumps, intelOrigins]);

  // Escuchar las alertas que emite el hilo de Rust → banner + sonido (la notificación nativa
  // ya la lanza Rust, así que aquí NO la repetimos).
  useEffect(() => {
    const un = listen<{
      sys_id: number;
      system: string;
      jumps: number;
      author: string;
      message: string;
      ts_ms: number;
    }>("intel-alert", (e) => {
      const a = e.payload;
      setIntelAlert({
        text: `⚠ Intel a ${a.jumps} salto(s): ${a.system} — ${a.author}`,
        report: { sysId: a.sys_id, sysName: a.system, ts: a.ts_ms, author: a.author, message: a.message },
      });
      if (intel?.sound) playAlertChoice(intel.soundChoice);
      window.setTimeout(() => setIntelAlert(null), 12000);
    });
    return () => {
      un.then((f) => f());
    };
  }, [intel?.sound, intel?.soundChoice]);

  // Cargar el sonido personalizado cuando se elige/ cambia el archivo.
  useEffect(() => {
    if (intel?.soundChoice === "custom" && intel?.soundFile) {
      void loadCustomSound(intel.soundFile);
    }
  }, [intel?.soundChoice, intel?.soundFile]);

  // --- Intel: tarjeta de detalle (piloto/nave/ruta/zKill) ---
  const [intelDetail, setIntelDetail] = useState<{
    sysId: number | null;
    sysName: string | null;
    ts: number;
    author: string;
    message: string;
  } | null>(null);
  const [intelEntities, setIntelEntities] = useState<{
    characters: { id: number; name: string }[];
    ships: { id: number; name: string }[];
  } | null>(null);
  const [intelEntLoading, setIntelEntLoading] = useState(false);
  const [intelTrackPilot, setIntelTrackPilot] = useState<string | null>(null);
  const [chanOpen, setChanOpen] = useState(false);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [anchorInput, setAnchorInput] = useState("");
  // Abrir la config automáticamente si la capa intel está activa y aún no hay canales elegidos.
  // Y pedir permiso de notificación al entrar (para que el SO pregunte en buen momento).
  useEffect(() => {
    if (overlay === "intel" && intel) {
      if (intel.channels.length === 0) setCfgOpen(true);
      void ensureNotifPerm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay]);

  // Genera candidatos (1-3 palabras) de un mensaje, quitando sistemas y palabras de jerga.
  function intelCandidates(message: string): string[] {
    if (!geo) return [];
    const KW = new Set([
      "clr", "clear", "cleared", "nv", "neut", "neutral", "neutrals", "red", "reds",
      "hostile", "hostiles", "status", "gate", "station", "x", "and", "in", "is", "at",
    ]);
    const toks = message
      .split(/\s+/)
      .map((t) => t.replace(/[*.,;:!?()]+$/g, "").replace(/^[*([]+/g, "").trim())
      .filter(Boolean)
      .filter((t) => !KW.has(t.toLowerCase()))
      .filter((t) => !geo.nameIdx.get(t.toLowerCase()));
    const out = new Set<string>();
    for (let i = 0; i < toks.length; i++) {
      out.add(toks[i]);
      if (i + 1 < toks.length) out.add(`${toks[i]} ${toks[i + 1]}`);
      if (i + 2 < toks.length) out.add(`${toks[i]} ${toks[i + 1]} ${toks[i + 2]}`);
    }
    return [...out].slice(0, 80);
  }

  function openIntelDetail(r: {
    sysId: number | null;
    sysName: string | null;
    ts: number;
    author: string;
    message: string;
  }) {
    setSelected(null); // la tarjeta de detalle y el panel de sistema comparten sitio (derecha)
    setIntelDetail(r);
    setIntelEntities(null);
    setIntelTrackPilot(null);
  }

  // Resuelve entidades cuando se abre la tarjeta.
  useEffect(() => {
    if (!intelDetail) return;
    const cands = intelCandidates(intelDetail.message);
    if (cands.length === 0) {
      setIntelEntities({ characters: [], ships: [] });
      return;
    }
    setIntelEntLoading(true);
    invoke<{ characters: { id: number; name: string }[]; ships: { id: number; name: string }[] }>(
      "resolve_intel_entities",
      { names: cands }
    )
      .then((e) => {
        // Descartar personajes cuyo nombre es sub-frase (palabras contiguas) de otro más largo.
        // Evita que "Dexter" (otro pj vacío) tape a "Dexter Morgan 0690" → 404 en zKill.
        const isSubPhrase = (short: string, long: string) => {
          const a = short.toLowerCase().split(/\s+/);
          const b = long.toLowerCase().split(/\s+/);
          if (a.length >= b.length) return false;
          for (let i = 0; i + a.length <= b.length; i++) {
            if (a.every((w, k) => w === b[i + k])) return true;
          }
          return false;
        };
        const sorted = [...e.characters].sort((a, b) => b.name.length - a.name.length);
        const kept: { id: number; name: string }[] = [];
        for (const c of sorted) {
          if (kept.some((k) => isSubPhrase(c.name, k.name))) continue;
          kept.push(c);
        }
        setIntelEntities({ characters: kept, ships: e.ships });
      })
      .catch(() => setIntelEntities({ characters: [], ships: [] }))
      .finally(() => setIntelEntLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intelDetail]);

  // Trayectoria de un piloto: sistemas (cronológico) donde aparece su nombre en los reportes.
  function pilotTrack(name: string) {
    const lower = name.toLowerCase();
    const asc = [...(intelReports?.feed ?? [])].reverse(); // feed es newest-first
    const track: { ts: number; sysId: number; sysName: string }[] = [];
    for (const f of asc) {
      if (f.sysId != null && f.message.toLowerCase().includes(lower)) {
        track.push({ ts: f.ts, sysId: f.sysId, sysName: f.sysName! });
      }
    }
    return track;
  }

  // Polilínea de la ruta del piloto seleccionado (sobre el grafo del mapa).
  const intelTrackLine = useMemo(() => {
    if (!geo || overlay !== "intel" || !intelTrackPilot) return null;
    const track = pilotTrack(intelTrackPilot);
    const pts = track
      .map((t) => geo.idx.get(t.sysId))
      .filter((s): s is NeSystem => !!s)
      .map((s) => geo.proj(s));
    if (pts.length < 1) return null;
    const poly = pts.map((p) => `${p.px},${p.py}`).join(" ");
    const first = pts[0];
    const last = pts[pts.length - 1];
    return (
      <g>
        {pts.length >= 2 && (
          <>
            <defs>
              <marker
                id="intel-arrow"
                markerWidth="4"
                markerHeight="4"
                refX="2.4"
                refY="2"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M0,0 L4,2 L0,4 Z" fill="#ffd98a" />
              </marker>
            </defs>
            {/* trazo base tenue (toda la ruta) */}
            <polyline points={poly} fill="none" stroke="#ffb24a" strokeOpacity={0.25} strokeWidth={0.6} />
            {/* flujo direccional: las rayas viajan del origen al destino + flecha al final */}
            <polyline
              points={poly}
              fill="none"
              stroke="#ffd98a"
              strokeWidth={0.7}
              strokeLinecap="round"
              strokeDasharray="2 2.5"
              markerEnd="url(#intel-arrow)"
            >
              <animate attributeName="stroke-dashoffset" from="0" to="-4.5" dur="0.7s" repeatCount="indefinite" />
            </polyline>
          </>
        )}
        {/* sistemas intermedios */}
        {pts.slice(1, -1).map((p, i) => (
          <circle key={`tk-${i}`} cx={p.px} cy={p.py} r={0.9} fill="#ffb24a" />
        ))}
        {/* origen (hueco) */}
        <circle cx={first.px} cy={first.py} r={1.1} fill="#0a0d12" stroke="#ffb24a" strokeWidth={0.5}>
          <title>Origen</title>
        </circle>
        {/* destino / posición más reciente */}
        {pts.length >= 2 && (
          <circle cx={last.px} cy={last.py} r={1.5} fill="#ffd98a" stroke="#0a0d12" strokeWidth={0.3}>
            <title>Último reporte</title>
          </circle>
        )}
      </g>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, overlay, intelTrackPilot, intelReports]);

  // Nave seleccionada (del catálogo del SDE).
  const selShip = useMemo(
    () => jumpShips.find((s) => s.name === jumpShip) || null,
    [jumpShips, jumpShip]
  );
  // Rango efectivo = base × (1 + 20%·Jump Drive Calibration). A nivel V se dobla (SDE: attr 870
  // jumpDriveRangeBonus = 20/nivel). Autorrellena la burbuja LY.
  useEffect(() => {
    if (selShip) setJumpRange(+(selShip.range * (1 + 0.2 * jdcLevel)).toFixed(2));
  }, [selShip, jdcLevel]);

  // Combustible (isótopos) y distancia al destino elegido.
  // fuel = dist(LY) × fuelPerLy × (1 − 10%·Jump Fuel Conservation).
  const jumpFuel = useMemo(() => {
    if (!geo || !selShip || jumpOrigin == null || jumpDest == null) return null;
    const o = geo.idx.get(jumpOrigin);
    const d = geo.idx.get(jumpDest);
    if (!o || !d) return null;
    const dist = Math.hypot(d.gx - o.gx, d.gy - o.gy, d.gz - o.gz);
    const fuel = Math.ceil(dist * selShip.fuelPerLy * (1 - 0.1 * jfcLevel));
    return { dist, fuel, isotope: selShip.isotope, inRange: dist <= jumpRange + 1e-6 };
  }, [geo, selShip, jumpOrigin, jumpDest, jfcLevel, jumpRange]);

  // Fatiga actual del personaje (minutos restantes del timer azul).
  const curFatMin = useMemo(() => {
    if (!jumpFatigue?.expire) return 0;
    const ms = Date.parse(jumpFatigue.expire) - fatNow;
    return ms > 0 ? ms / 60000 : 0;
  }, [jumpFatigue, fatNow]);

  // Estimación del salto al destino: cooldown de activación y fatiga resultante.
  // Fórmula EVE (EVE Uni): cooldown = max(1+LY, fatigaPre/10) [máx 30 min];
  // fatiga nueva = max(10·(1+LY), fatigaPre·(1+LY)) [máx 5 h]. Las JF/Rorqual reducen
  // mucho la fatiga (bono de rol −90% sobre la distancia efectiva): mostramos el máximo.
  const jumpFatEst = useMemo(() => {
    if (!selShip || !jumpFuel) return null;
    const ly = jumpFuel.dist;
    const reduced =
      selShip.group === "Jump Freighter" || selShip.group === "Capital Industrial Ship";
    const effLy = reduced ? ly * 0.1 : ly;
    const cooldown = Math.min(30, Math.max(1 + ly, curFatMin / 10));
    const newFat = Math.min(300, Math.max(10 * (1 + effLy), curFatMin * (1 + effLy)));
    return { cooldown, newFat, reduced };
  }, [selShip, jumpFuel, curFatMin]);

  // Sistemas alcanzables por salto de capital (low/null dentro del rango LY).
  const jumpReach = useMemo(() => {
    if (!geo || jumpOrigin == null) return null;
    const o = geo.idx.get(jumpOrigin);
    if (!o) return null;
    const out = new Map<number, number>();
    for (const s of geo.idx.values()) {
      if (s.id === o.id) continue;
      if (s.s >= 0.45) continue; // no se puede saltar a high-sec
      if (s.r === 10000070) continue; // Pochven
      const d = Math.hypot(s.gx - o.gx, s.gy - o.gy, s.gz - o.gz);
      if (d <= jumpRange) out.set(s.id, d);
    }
    return out;
  }, [geo, jumpOrigin, jumpRange]);

  const routePath = useMemo(() => {
    if (!geo) return null;
    const stops = routeStops.filter((s): s is number => s != null);
    if (stops.length < 2) return null;
    const full: number[] = [];
    for (let i = 0; i < stops.length - 1; i++) {
      const seg = findRoute(geo.adj, geo.idx, stops[i], stops[i + 1], routeMode);
      if (!seg) return null;
      if (i === 0) full.push(...seg);
      else full.push(...seg.slice(1));
    }
    return full;
  }, [geo, routeStops, routeMode]);

  if (!ne || !geo) return <p className="muted">Cargando mapa…</p>;

  const pvp = data ?? [];
  const maxAct = Math.max(...pvp.map((d) => d.kills + d.losses), 1);
  const totalKills = pvp.reduce((s, d) => s + d.kills, 0);
  const totalLosses = pvp.reduce((s, d) => s + d.losses, 0);
  const labeled = new Set(
    [...pvp]
      .sort((a, b) => b.kills + b.losses - (a.kills + a.losses))
      .slice(0, 12)
      .map((d) => d.system_id)
  );

  const liveMap =
    overlay === "kills"
      ? liveKills
      : overlay === "jumps"
      ? liveJumps
      : overlay === "assets"
      ? assetsBySystem ?? null
      : overlay === "mineria"
      ? miningBySystem ?? null
      : null;
  const liveMax = liveMap ? Math.max(...liveMap.values(), 1) : 1;
  const liveColor = overlay === "assets" ? "#5fd0c0" : overlay === "mineria" ? "#d8b24a" : null;

  const legend =
    overlay === "ubicacion"
      ? (charLocations?.length ?? 0) > 0
        ? "Dónde están tus personajes ahora mismo."
        : "Ningún personaje con ubicación. Inicia sesión con la feature “Ubicación (sistema actual)” para verlos en el mapa."
      : overlay === "poi"
      ? "Lugares notables de New Eden: hubs comerciales, sistemas históricos y puntos calientes de PvP."
      : overlay === "pvp"
      ? "Tu actividad PvP: tamaño = volumen, color = seguridad."
      : overlay === "security"
      ? "Cluster coloreado por seguridad (verde high · naranja low · rojo null)."
      : overlay === "soberania"
      ? "Soberanía: cada color es una alianza/facción que controla el sistema."
      : overlay === "fw"
      ? "Guerra de facciones: color = imperio que controla; tamaño/intensidad = cuán disputado está el sistema."
      : overlay === "incursion"
      ? "Incursiones de Sansha: sistemas infestados (el más grande = staging). Color = estado (rojo establecida · naranja movilizando · amarillo retirándose)."
      : overlay === "wormholes"
      ? "Conexiones de wormhole a Thera/Turnur (datos de eve-scout): sistemas k-space con salida (cian = Thera, naranja = Turnur). El tooltip muestra tipo, tamaño máx y horas restantes."
      : overlay === "kills"
      ? "Kills de jugadores en la última hora (datos en vivo de ESI)."
      : overlay === "jumps"
      ? "Saltos por sistema en la última hora (datos en vivo de ESI)."
      : overlay === "mineria"
      ? "Dónde has minado (mining ledger, últimos 90 días)."
      : "Dónde tienes assets (estaciones, estructuras y en el espacio).";

  // Capa activa + KPI contextual para el panel de la derecha
  const activeOverlay = OVERLAYS.find((o) => o.key === overlay) ?? OVERLAYS[0];
  const ctxKpi: { value: string; label: string } | null =
    overlay === "soberania" && sovBySystem
      ? { value: fmtSp(new Set([...sovBySystem.values()].map((v) => v.owner_id ?? 0)).size), label: "Dueños distintos" }
      : overlay === "fw" && fwBySystem
      ? {
          value: fmtSp(
            [...fwBySystem.values()].filter(
              (f) => f.contested === "contested" || f.contested === "vulnerable"
            ).length
          ),
          label: "Sistemas disputados",
        }
      : overlay === "standings" && factionMap && factionStandings
      ? {
          value: fmtSp(
            Object.values(factionMap).filter((f) => (factionStandings.get(f) ?? 0) > 0).length
          ),
          label: "Sistemas con standing +",
        }
      : overlay === "incursion" && incursions
      ? { value: fmtSp(incursions.length), label: "Incursiones activas" }
      : overlay === "wormholes" && theraConns
      ? { value: fmtSp(theraConns.length), label: "Conexiones Thera/Turnur" }
      : overlay === "ubicacion"
      ? { value: fmtSp(charLocations?.length ?? 0), label: "Personajes situados" }
      : overlay === "poi"
      ? { value: fmtSp(POIS.filter((p) => geo?.nameIdx.get(p.name.toLowerCase())).length), label: "Lugares en el mapa" }
      : liveMap
      ? { value: fmtSp(liveMap.size), label: "Sistemas con datos" }
      : null;

  // KPIs contextuales a la capa activa (no genéricos): los de PvP solo en la capa PvP.
  const ctxKpis: { value: string; label: string }[] =
    overlay === "pvp"
      ? [
          { value: fmtSp(pvp.length), label: "Sistemas (tu PvP)" },
          { value: fmtSp(totalKills), label: "Kills" },
          { value: fmtSp(totalLosses), label: "Losses" },
        ]
      : ctxKpi
      ? [ctxKpi]
      : [];

  return (
    <>
      <p className="muted small">
        New Eden completo (líneas = stargates).
        {liveBusy && " · cargando datos en vivo…"}
      </p>
      <div className="map-wrap">
        {routeActive && (
        <div className="route-panel map-navcard">
          <div className="route-panel-head">
            <select value={routeMode} onChange={(e) => setRouteMode(e.target.value as RouteMode)}>
              <option value="shortest">Más corta</option>
              <option value="safer">Más segura</option>
              <option value="insecure">Menos segura</option>
            </select>
            <span className="muted small">
              {routePath
                ? `${routePath.length - 1} saltos`
                : routeStops.filter((s) => s != null).length >= 2
                ? "Sin ruta por stargates"
                : "Elige origen y destino"}
            </span>
            <button
              onClick={() => setRouteStops([null])}
              title="Limpiar"
            >
              Limpiar
            </button>
          </div>
          {routeStops.map((stop, i) => (
            <div className="route-stop" key={i}>
              <span className="route-stop-label">{i === 0 ? "Origen" : `Destino ${i}`}</span>
              <SystemSearch
                systems={ne.systems}
                value={stop}
                placeholder="Escribe un sistema…"
                onPick={(id) =>
                  setRouteStops((prev) => {
                    const copy = [...prev];
                    copy[i] = id;
                    return copy;
                  })
                }
              />
              {i > 0 && (
                <button
                  className="route-stop-del"
                  title="Quitar"
                  onClick={() => setRouteStops((prev) => prev.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <button className="route-add" onClick={() => setRouteStops((prev) => [...prev, null])}>
            + Añadir destino
          </button>
          <p className="muted small">
            También puedes hacer click en sistemas del mapa para añadirlos · doble-click en el mapa = zoom.
          </p>

          {routePath && routePath.length > 1 && (
            <div className="route-list">
              <div className="muted small">Sistemas de la ruta ({routePath.length}):</div>
              <ol>
                {routePath.map((sid, i) => {
                  const s = geo.idx.get(sid);
                  const kills = liveKills?.get(sid) ?? 0;
                  return (
                    <li key={i}>
                      <span className="route-sec" style={{ color: secColor(s?.s ?? 0) }}>
                        {(s?.s ?? 0).toFixed(1)}
                      </span>
                      <span className="route-sysname">{s?.n ?? `#${sid}`}</span>
                      <span className={`route-kills ${kills > 0 ? "hot" : ""}`} title="Kills última hora">
                        {kills} ⚔
                      </span>
                      <button
                        className="route-dotlan"
                        title="Abrir en Dotlan"
                        onClick={() =>
                          openUrl(
                            `https://evemaps.dotlan.net/system/${(s?.n ?? "").replace(/ /g, "_")}`
                          )
                        }
                      >
                        Dotlan
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </div>
      )}

        {jumpActive && (
        <div className="route-panel map-navcard">
          {characters.length > 0 && (
            <div className="route-panel-head">
              <label className="muted small">
                Cargar de:&nbsp;
                <select
                  value={jumpChar ?? ""}
                  onChange={(e) => setJumpChar(e.target.value ? +e.target.value : null)}
                >
                  <option value="">— manual —</option>
                  {characters.map((c) => (
                    <option key={c.character_id} value={c.character_id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              {jumpChar != null && <span className="muted small">★ = la tienes</span>}
            </div>
          )}
          <div className="route-panel-head">
            <label className="muted small">
              Nave:&nbsp;
              <select value={jumpShip} onChange={(e) => setJumpShip(e.target.value)}>
                <option value="">— manual —</option>
                {Object.entries(
                  jumpShips.reduce<Record<string, JumpShip[]>>((acc, s) => {
                    (acc[s.group] ||= []).push(s);
                    return acc;
                  }, {})
                ).map(([grp, list]) => (
                  <optgroup key={grp} label={grp}>
                    {[...list]
                      .sort(
                        (a, b) =>
                          (jumpOwned.has(b.id) ? 1 : 0) - (jumpOwned.has(a.id) ? 1 : 0)
                      )
                      .map((s) => (
                        <option key={s.name} value={s.name}>
                          {jumpOwned.has(s.id) ? "★ " : ""}
                          {s.name}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
          </div>
          <div className="route-panel-head">
            {selShip ? (
              <span className="muted small" title="Calculado por nave y Jump Drive Calibration">
                Rango: <b>{jumpRange}</b> LY
              </span>
            ) : (
              <label className="muted small">
                Rango (LY):&nbsp;
                <input
                  type="number"
                  min={1}
                  max={12}
                  step={0.1}
                  value={jumpRange}
                  onChange={(e) => setJumpRange(Math.max(0, parseFloat(e.target.value) || 0))}
                  style={{ width: "4.5rem" }}
                />
              </label>
            )}
            <label className="muted small" title="Jump Drive Calibration: +20% de rango por nivel (a V se dobla)">
              JDC:&nbsp;
              <select value={jdcLevel} onChange={(e) => setJdcLevel(+e.target.value)}>
                {[0, 1, 2, 3, 4, 5].map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="muted small" title="Jump Fuel Conservation: −10% de consumo por nivel">
              JFC:&nbsp;
              <select value={jfcLevel} onChange={(e) => setJfcLevel(+e.target.value)}>
                {[0, 1, 2, 3, 4, 5].map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <span className="muted small">
              {jumpReach ? `${jumpReach.size} sistemas al alcance` : "elige el origen"}
            </span>
          </div>
          <div className="route-stop">
            <span className="route-stop-label">Origen</span>
            <SystemSearch
              systems={ne.systems}
              value={jumpOrigin}
              placeholder="Sistema de salto…"
              onPick={(id) => setJumpOrigin(id)}
            />
          </div>
          <div className="route-stop">
            <span className="route-stop-label">Destino</span>
            <SystemSearch
              systems={ne.systems}
              value={jumpDest}
              placeholder="Destino (para el fuel)…"
              onPick={(id) => setJumpDest(id)}
            />
          </div>
          {jumpFuel && (
            <div className={`jump-fuel ${jumpFuel.inRange ? "" : "out"}`}>
              <span>
                <b>{jumpFuel.dist.toFixed(2)}</b> LY
              </span>
              <span>
                ⛽ <b>{fmtSp(jumpFuel.fuel)}</b> {jumpFuel.isotope}
              </span>
              {!jumpFuel.inRange && <span className="jump-oor">⚠️ fuera de rango</span>}
            </div>
          )}
          {jumpChar != null && (
            <div className="jump-fatigue">
              {jumpFatMissing ? (
                <span className="small muted">
                  ⏳ Fatiga: falta el acceso. Pulsa «Conceder acceso» y vuelve a iniciar sesión con
                  este personaje para verla.
                </span>
              ) : (
                <>
                  <span className="small">
                    ⏳ Fatiga actual: <b>{curFatMin >= 1 ? fmtMin(curFatMin) : "ninguna"}</b>
                  </span>
                  {jumpFatEst && jumpFuel && (
                    <span className="small muted">
                      tras saltar → cooldown ~{fmtMin(jumpFatEst.cooldown)} · fatiga ~
                      {fmtMin(jumpFatEst.newFat)}
                      {jumpFatEst.reduced ? " (máx; tu nave reduce fatiga)" : ""}
                    </span>
                  )}
                </>
              )}
            </div>
          )}
          <p className="muted small">
            Elige tu nave (rango y fuel salen del SDE) y tus skills; el rango se calcula solo.
            Click en el mapa: 1º fija el origen, 2º el destino. Resalta en morado los low/null
            alcanzables.
          </p>
        </div>
      )}
        {!mapActive && (
          <div className="map-zoom-hint">Posa el ratón un instante para activar el zoom con rueda</div>
        )}
        {intelAlert && (
          <div
            className="intel-alert"
            onClick={() => {
              openIntelDetail(intelAlert.report);
              setSelected(intelAlert.report.sysId);
              setIntelAlert(null);
            }}
            title="Ver detalle"
          >
            {intelAlert.text}
            <span className="intel-alert-cta">ver detalle ▸</span>
          </div>
        )}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${MAP_W} ${MAP_H}`}
          className={`eve-map ${hover ? "over-sys" : ""} ${mapActive ? "active" : ""}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerEnter={enterMap}
          onPointerLeave={() => {
            onPointerUp();
            setHover(null);
            leaveMap(); // al salir del mapa, la rueda vuelve a scrollear la página
          }}
          onClick={() => {
            if (hover) clickSystem(hover.sid);
          }}
          onDoubleClick={onDoubleClick}
        >
          <rect x="0" y="0" width={MAP_W} height={MAP_H} fill="#0a0d12" />
          <g transform={`translate(${view.x} ${view.y}) scale(${view.z})`}>
            {/* etiquetas con nivel de detalle (LOD) según el zoom */}
            {view.z < 2.5 &&
              geo.regionLabels.map((r, i) => (
                <text
                  key={`r-${i}`}
                  x={r.px}
                  y={r.py}
                  className="region-label"
                  textAnchor="middle"
                  style={{ fontSize: `${14 / view.z}px` }}
                >
                  {r.name}
                </text>
              ))}
            {view.z >= 2.5 && view.z < 6 &&
              geo.constLabels.map((c, i) => (
                <text
                  key={`c-${i}`}
                  x={c.px}
                  y={c.py}
                  className="region-label"
                  textAnchor="middle"
                  style={{ fontSize: `${11 / view.z}px` }}
                >
                  {c.name}
                </text>
              ))}
            {view.z >= 6 &&
              ne.systems.map((s) => {
                const p = geo.proj(s);
                const sx = view.x + p.px * view.z;
                const sy = view.y + p.py * view.z;
                if (sx < 0 || sx > MAP_W || sy < 0 || sy > MAP_H) return null;
                return (
                  <text
                    key={`sl-${s.id}`}
                    x={p.px + 1.5}
                    y={p.py + 1}
                    className="map-label"
                    style={{ fontSize: `${10 / view.z}px` }}
                  >
                    {s.n}
                  </text>
                );
              })}
            <path d={geo.jumpsPath} stroke="#243040" strokeWidth={0.5} fill="none" opacity={0.6} />
            {/* backdrop de sistemas (memorizado) */}
            {backdropCircles}
            {/* overlay de soberanía (memorizado) */}
            {sovCircles}
            {/* overlay Guerra de facciones (memorizado) */}
            {fwCircles}
            {/* overlay Standings por sistema (memorizado) */}
            {standingCircles}
            {/* overlay Incursiones (memorizado) */}
            {incursionCircles}
            {theraCircles}
            {/* overlay Intel en vivo (memorizado) */}
            {intelAnchorMarkers}
            {intelTrackLine}
            {intelCircles}
            {/* overlay PvP */}
            {overlay === "pvp" &&
              pvp.map((d) => {
                const s = geo.idx.get(d.system_id);
                if (!s) return null;
                const p = geo.proj(s);
                const r = (2 + Math.sqrt((d.kills + d.losses) / maxAct) * 18) / view.z;
                return (
                  <circle
                    key={d.system_id}
                    cx={p.px}
                    cy={p.py}
                    r={r}
                    fill={secColor(s.s)}
                    fillOpacity={0.5}
                    stroke={secColor(s.s)}
                    strokeOpacity={0.9}
                    className="clickable-sys"
                    onClick={(e) => {
                      e.stopPropagation();
                      clickSystem(d.system_id);
                    }}
                  >
                    <title>{`${s.n}  (sec ${s.s.toFixed(1)})\nKills: ${d.kills} · Losses: ${d.losses} · ISK: ${fmtIsk(d.isk)}`}</title>
                  </circle>
                );
              })}
            {/* overlays en vivo (kills / jumps) */}
            {liveMap &&
              [...liveMap.entries()].map(([sid, v]) => {
                const s = geo.idx.get(sid);
                if (!s || v <= 0) return null;
                const p = geo.proj(s);
                const r = (1.5 + Math.sqrt(v / liveMax) * 16) / view.z;
                return (
                  <circle
                    key={`live-${sid}`}
                    cx={p.px}
                    cy={p.py}
                    r={r}
                    fill={liveColor ?? heatColor(v / liveMax)}
                    fillOpacity={0.55}
                    className="clickable-sys"
                    onClick={(e) => {
                      e.stopPropagation();
                      clickSystem(sid);
                    }}
                  >
                    <title>{`${s.n}\n${
                      overlay === "kills"
                        ? "Kills"
                        : overlay === "jumps"
                        ? "Jumps"
                        : overlay === "mineria"
                        ? "Minado"
                        : "Assets (stacks)"
                    }: ${fmtSp(v)}`}</title>
                  </circle>
                );
              })}
            {/* ruta planificada */}
            {routePath && routePath.length > 1 && (
              <path
                d={routePath
                  .map((sid, i) => {
                    const s = geo.idx.get(sid);
                    if (!s) return "";
                    const p = geo.proj(s);
                    return `${i === 0 ? "M" : "L"}${p.px.toFixed(1)} ${p.py.toFixed(1)}`;
                  })
                  .join("")}
                fill="none"
                stroke="#ffd54a"
                strokeWidth={1.6 / view.z}
                strokeLinejoin="round"
                opacity={0.95}
              />
            )}
            {routeStops.map((sid, i) =>
              sid != null && geo.idx.get(sid) ? (
                <circle
                  key={`rep-${i}`}
                  cx={geo.proj(geo.idx.get(sid)!).px}
                  cy={geo.proj(geo.idx.get(sid)!).py}
                  r={4 / view.z}
                  fill={i === 0 ? "#7fdc8f" : "#ffd54a"}
                  stroke="#0a0d12"
                  strokeWidth={0.8 / view.z}
                />
              ) : null
            )}
            {/* alcance de salto de capital */}
            {jumpActive &&
              jumpReach &&
              [...jumpReach.keys()].map((sid) => {
                const s = geo.idx.get(sid);
                if (!s) return null;
                const p = geo.proj(s);
                return (
                  <circle key={`jr-${sid}`} cx={p.px} cy={p.py} r={2.6 / view.z} fill="#b07cff" fillOpacity={0.6}>
                    <title>{`${s.n} (sec ${s.s.toFixed(1)})\n${jumpReach.get(sid)!.toFixed(2)} LY`}</title>
                  </circle>
                );
              })}
            {jumpActive &&
              jumpOrigin != null &&
              geo.idx.get(jumpOrigin) &&
              (() => {
                const p = geo.proj(geo.idx.get(jumpOrigin)!);
                return <circle cx={p.px} cy={p.py} r={5 / view.z} fill="#7fd8ff" stroke="#0a0d12" strokeWidth={0.8 / view.z} />;
              })()}
            {/* overlay Ubicación: dónde están tus personajes (agrupados por sistema) */}
            {overlay === "ubicacion" &&
              (() => {
                const bySys = new Map<number, CharLoc[]>();
                for (const c of charLocations ?? []) {
                  const arr = bySys.get(c.system_id) ?? [];
                  arr.push(c);
                  bySys.set(c.system_id, arr);
                }
                return [...bySys.entries()].map(([sysId, list]) => {
                  const s = geo.idx.get(sysId);
                  if (!s) return null;
                  const p = geo.proj(s);
                  const r = 3.5 / view.z;
                  return (
                    <g key={`loc-${sysId}`}>
                      <circle cx={p.px} cy={p.py} r={r} fill="#7fd8ff" stroke="#0a0d12" strokeWidth={0.6 / view.z}>
                        <title>{`${s.n} (sec ${s.s.toFixed(1)})\n${list.map((c) => c.name).join("\n")}`}</title>
                      </circle>
                      {list.map((c, i) => (
                        <text
                          key={c.id}
                          x={p.px + 6 / view.z}
                          y={p.py + (4 + i * 13) / view.z}
                          className="map-label"
                          style={{ fontSize: `${13 / view.z}px` }}
                        >
                          {c.name}
                        </text>
                      ))}
                    </g>
                  );
                });
              })()}
            {/* capa Lugares notables (POI) */}
            {overlay === "poi" &&
              POIS.map((poi) => {
                if (subFilter !== "all" && poi.kind !== subFilter) return null;
                const s = geo.nameIdx.get(poi.name.toLowerCase());
                if (!s) return null;
                const p = geo.proj(s);
                const col =
                  poi.kind === "hub" ? "#d8b24a" : poi.kind === "pvp" ? "#ff6b6b" : "#7fd8ff";
                const r = 3 / view.z;
                return (
                  <g key={`poi-${poi.name}`} className="clickable-sys" onClick={() => clickSystem(s.id)}>
                    <circle cx={p.px} cy={p.py} r={r * 2.4} fill={col} opacity={0.18} />
                    <circle cx={p.px} cy={p.py} r={r} fill={col} stroke="#0a0d12" strokeWidth={0.6 / view.z}>
                      <title>{`${poi.name} — ${poi.note}`}</title>
                    </circle>
                    <text
                      x={p.px + 5 / view.z}
                      y={p.py + 3.5 / view.z}
                      className="map-label"
                      style={{ fontSize: `${12 / view.z}px`, fill: col }}
                    >
                      {poi.name}
                    </text>
                  </g>
                );
              })}
            {/* marcador "estás aquí" (sistema actual del personaje) */}
            {hereSystemId != null &&
              geo.idx.get(hereSystemId) &&
              (() => {
                const p = geo.proj(geo.idx.get(hereSystemId)!);
                const r = 4 / view.z;
                return (
                  <g>
                    <circle cx={p.px} cy={p.py} r={r} fill="#7fd8ff">
                      <title>{`Aquí: ${geo.idx.get(hereSystemId)!.n}`}</title>
                    </circle>
                    <circle cx={p.px} cy={p.py} r={r * 2} fill="none" stroke="#7fd8ff" strokeWidth={1 / view.z}>
                      <animate attributeName="r" from={`${r}`} to={`${r * 3}`} dur="1.6s" repeatCount="indefinite" />
                      <animate attributeName="opacity" from="0.9" to="0" dur="1.6s" repeatCount="indefinite" />
                    </circle>
                  </g>
                );
              })()}
            {/* anillo del sistema seleccionado */}
            {selected != null &&
              geo.idx.get(selected) &&
              (() => {
                const p = geo.proj(geo.idx.get(selected)!);
                return <circle cx={p.px} cy={p.py} r={6 / view.z} fill="none" stroke="#7fd8ff" strokeWidth={1.2 / view.z} />;
              })()}
            {/* etiquetas de tus sistemas más activos (solo en overlay PvP) */}
            {overlay === "pvp" &&
              pvp
                .filter((d) => labeled.has(d.system_id))
                .map((d) => {
                  const s = geo.idx.get(d.system_id);
                  if (!s) return null;
                  const p = geo.proj(s);
                  return (
                    <text
                      key={`l-${d.system_id}`}
                      x={p.px + 6 / view.z}
                      y={p.py + 4 / view.z}
                      className="map-label"
                      style={{ fontSize: `${13 / view.z}px` }}
                    >
                      {s.n}
                    </text>
                  );
                })}
          </g>
        </svg>

        {hover &&
          geo.idx.get(hover.sid) &&
          (() => {
            const s = geo.idx.get(hover.sid)!;
            const region = ne.regions.find((r) => r.id === s.r)?.n ?? "";
            const kv = liveKills?.get(hover.sid) ?? 0;
            const jv = liveJumps?.get(hover.sid) ?? 0;
            const sov = sovBySystem?.get(hover.sid);
            const fw = fwBySystem?.get(hover.sid);
            const fwFac = fw ? FW_FACTIONS[fw.owner_faction_id] : undefined;
            return (
              <div className="map-tip" style={{ left: hover.sx + 14, top: hover.sy + 14 }}>
                <div>
                  <strong>{s.n}</strong>{" "}
                  <span style={{ color: secColor(s.s) }}>{s.s.toFixed(1)}</span>
                </div>
                <div className="muted small">{region}</div>
                {sov?.owner_name && (
                  <div className="small" style={{ color: sov.owner_id ? ownerColor(sov.owner_id) : undefined }}>
                    {sov.owner_name}
                  </div>
                )}
                {fwFac && (
                  <div className="small" style={{ color: fwFac.color }}>
                    {fwFac.name}
                    {fw?.contested && fw.contested !== "uncontested" ? ` · ${fw.contested}` : ""}
                  </div>
                )}
                <div className="small">
                  Kills 1h: <strong className={kv > 0 ? "tip-hot" : ""}>{kv}</strong>
                </div>
                <div className="small">Jumps 1h: {jv}</div>
              </div>
            );
          })()}

        <div className="map-zoom">
          <button onClick={() => zoomBy(1.3)}>+</button>
          <button onClick={() => zoomBy(1 / 1.3)}>−</button>
          <button onClick={() => setView({ z: 1, x: 0, y: 0 })} title="Reset">⟲</button>
        </div>

        {selected != null &&
          geo.idx.get(selected) &&
          (() => {
            const s = geo.idx.get(selected)!;
            const act = pvp.find((d) => d.system_id === selected);
            const region = ne.regions.find((r) => r.id === s.r)?.n ?? "";
            const kv = liveKills?.get(selected);
            const jv = liveJumps?.get(selected);
            const av = assetsBySystem?.get(selected);
            return (
              <div className={`sys-panel${overlay === "intel" ? " intel" : ""}`}>
                <div className="sys-panel-head">
                  <strong>{s.n}</strong>
                  <button className="sys-close" onClick={() => setSelected(null)}>
                    ✕
                  </button>
                </div>
                <div className="muted small">
                  Seguridad <span style={{ color: secColor(s.s) }}>{s.s.toFixed(1)}</span> · {region}
                </div>
                <div className="sys-stats">
                  <div>Tus kills: <strong>{act?.kills ?? 0}</strong></div>
                  <div>Tus losses: <strong>{act?.losses ?? 0}</strong></div>
                  <div>Tu ISK: <strong>{act ? fmtIsk(act.isk) : "0"}</strong></div>
                  {kv != null && <div>Kills 1h: <strong>{kv}</strong></div>}
                  {jv != null && <div>Jumps 1h: <strong>{jv}</strong></div>}
                  {av != null && <div>Assets (stacks): <strong>{av}</strong></div>}
                </div>
                <div className="sys-links">
                  <button
                    onClick={() => {
                      setJumpActive(false);
                      setRouteActive(true);
                      setRouteStops([selected, null]);
                      setSelected(null);
                    }}
                  >
                    Ruta desde
                  </button>
                  <button
                    onClick={() => {
                      setRouteActive(false);
                      setJumpActive(true);
                      setJumpOrigin(selected);
                      setJumpDest(null);
                      setSelected(null);
                    }}
                  >
                    Saltar desde
                  </button>
                </div>
                <div className="sys-links">
                  <button onClick={() => openUrl(`https://zkillboard.com/system/${selected}/`)}>
                    zKillboard
                  </button>
                  <button
                    onClick={() =>
                      openUrl(`https://evemaps.dotlan.net/system/${s.n.replace(/ /g, "_")}`)
                    }
                  >
                    Dotlan
                  </button>
                </div>
                {onSystemAssets && (
                  <button
                    className="sys-assets-btn"
                    onClick={() => {
                      onSystemAssets(s.n);
                      setSelected(null);
                    }}
                  >
                    📦 Mis assets aquí
                  </button>
                )}
                {overlay === "intel" && intel && (
                  <button
                    className="sys-assets-btn"
                    onClick={() => {
                      const has = intel.anchors.includes(selected);
                      intel.onConfig({
                        anchors: has
                          ? intel.anchors.filter((x) => x !== selected)
                          : [...intel.anchors, selected],
                      });
                    }}
                  >
                    {intel.anchors.includes(selected) ? "⚓ Quitar ancla" : "⚓ Anclar aquí"}
                  </button>
                )}
              </div>
            );
          })()}

        {/* Panel de Intel: configuración + feed en vivo (izquierda) */}
        {overlay === "intel" && intel && (
          <div className="intel-panel">
            <div className="intel-head">
              <strong>🚨 Intel en vivo</strong>
              <span className="muted small">
                {(intel.onlyRange
                  ? [...(intelReports?.rep.keys() ?? [])].filter((sid) => {
                      const d = jumpsFrom?.get(sid);
                      return d != null && d <= intel.alertJumps;
                    }).length
                  : intelReports?.rep.size ?? 0)}{" "}
                sistema(s)
              </span>
              <button
                className={`intel-gear${cfgOpen ? " active" : ""}`}
                onClick={() => setCfgOpen((v) => !v)}
                title="Configuración"
              >
                ⚙
              </button>
            </div>
            {cfgOpen && (
              <div className="intel-cfg">
                <label className="intel-folder" title={intel.folder}>
                  <span className="muted small">Carpeta de logs</span>
                  <div className="intel-folder-row">
                    <span className="intel-folder-path">{intel.folder || "(sin definir)"}</span>
                    <button onClick={intel.onPickFolder}>📁</button>
                  </div>
                </label>
                <div className="intel-channels">
                  <span className="muted small">Canales</span>
                  <button
                    type="button"
                    className="intel-chan-btn"
                    onClick={() => setChanOpen((v) => !v)}
                  >
                    <span>
                      {intel.channels.length === 0
                        ? "Seleccionar canales…"
                        : `${intel.channels.length} canal(es)`}
                    </span>
                    <span>{chanOpen ? "▴" : "▾"}</span>
                  </button>
                  {chanOpen && (
                    <div className="intel-chan-menu">
                      {intel.availChannels.length === 0 && (
                        <div className="muted small">No se encontraron canales en la carpeta.</div>
                      )}
                      {intel.availChannels.map((c) => (
                        <label key={c} className="intel-chk">
                          <input
                            type="checkbox"
                            checked={intel.channels.includes(c)}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...intel.channels, c]
                                : intel.channels.filter((x) => x !== c);
                              intel.onConfig({ channels: next });
                            }}
                          />
                          {c}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <div className="intel-nums">
                  <label>
                    <span className="muted small">Recencia (min)</span>
                    <input
                      type="number"
                      min={1}
                      max={180}
                      value={intel.recency}
                      onChange={(e) => intel.onConfig({ recency: Math.max(1, Number(e.target.value)) })}
                    />
                  </label>
                  <label>
                    <span className="muted small">Alerta ≤ saltos</span>
                    <input
                      type="number"
                      min={0}
                      max={20}
                      value={intel.alertJumps}
                      onChange={(e) => intel.onConfig({ alertJumps: Math.max(0, Number(e.target.value)) })}
                    />
                  </label>
                </div>
                <div className="intel-sound-row">
                  <label className="intel-chk">
                    <input
                      type="checkbox"
                      checked={intel.sound}
                      onChange={(e) => {
                        if (e.target.checked) beep(); // gesto del usuario → desbloquea el audio
                        intel.onConfig({ sound: e.target.checked });
                      }}
                    />
                    🔊 Sonido
                  </label>
                  <select
                    className="intel-sound-sel"
                    value={intel.soundChoice}
                    disabled={!intel.sound}
                    onChange={(e) => {
                      if (e.target.value === "custom" && !intel.soundFile) {
                        intel.onPickSound();
                      } else {
                        intel.onConfig({ soundChoice: e.target.value });
                      }
                    }}
                  >
                    {ALERT_SOUNDS.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="intel-test-snd"
                    disabled={!intel.sound}
                    onClick={() => playAlertChoice(intel.soundChoice)}
                  >
                    Probar
                  </button>
                </div>
                {intel.soundChoice === "custom" && (
                  <div className="intel-sound-custom">
                    <span className="intel-sound-file" title={intel.soundFile}>
                      {intel.soundFile ? intel.soundFile.split(/[\\/]/).pop() : "(ningún archivo)"}
                    </span>
                    <button onClick={intel.onPickSound}>Elegir…</button>
                  </div>
                )}
                <label className="intel-chk">
                  <input
                    type="checkbox"
                    checked={intel.onlyRange}
                    onChange={(e) => intel.onConfig({ onlyRange: e.target.checked })}
                  />
                  Mostrar solo intel en rango (≤ {intel.alertJumps} saltos)
                </label>
                <div className="intel-anchors">
                  <span className="muted small">Puntos de ancla (proximidad)</span>
                  <div className="intel-anchor-add">
                    <input
                      type="text"
                      placeholder="Sistema… (p. ej. 9PX2-F)"
                      value={anchorInput}
                      onChange={(e) => setAnchorInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        const s = geo?.nameIdx.get(anchorInput.trim().toLowerCase());
                        if (s && !intel.anchors.includes(s.id)) {
                          intel.onConfig({ anchors: [...intel.anchors, s.id] });
                          setAnchorInput("");
                        }
                      }}
                    />
                    <button
                      onClick={() => {
                        const s = geo?.nameIdx.get(anchorInput.trim().toLowerCase());
                        if (s && !intel.anchors.includes(s.id)) {
                          intel.onConfig({ anchors: [...intel.anchors, s.id] });
                          setAnchorInput("");
                        }
                      }}
                    >
                      +
                    </button>
                  </div>
                  <div className="intel-anchor-chips">
                    {intel.anchors.length === 0 && (
                      <span className="muted small">
                        Sin anclas. También puedes pinchar un sistema → “⚓ Anclar aquí”.
                      </span>
                    )}
                    {intel.anchors.map((sid) => (
                      <span key={sid} className="intel-anchor-chip">
                        ⚓ {geo?.idx.get(sid)?.n ?? sid}
                        <button
                          title="Quitar"
                          onClick={() => intel.onConfig({ anchors: intel.anchors.filter((x) => x !== sid) })}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                  <p className="muted small intel-anchor-hint">
                    La alerta usa el sistema más cercano entre tu personaje y tus anclas.
                  </p>
                </div>
              </div>
            )}
            <div className="intel-feed">
              {intel.channels.length === 0 && (
                <div className="muted small">Abre la ⚙ y elige carpeta y al menos un canal para empezar.</div>
              )}
              {intel.channels.length > 0 && (intelReports?.feed.length ?? 0) === 0 && (
                <div className="muted small">Sin actividad reciente.</div>
              )}
              {intelReports?.feed
                .filter((f) => {
                  if (!intel.onlyRange) return true;
                  if (f.sysId == null) return false;
                  const d = jumpsFrom?.get(f.sysId);
                  return d != null && d <= intel.alertJumps;
                })
                .slice(0, 60)
                .map((f, i) => {
                const j = f.sysId != null ? jumpsFrom?.get(f.sysId) : undefined;
                const near = j != null && j <= intel.alertJumps;
                return (
                  <div
                    key={`${f.ts}-${i}`}
                    className={`intel-row clickable${near ? " near" : ""}`}
                    onClick={() =>
                      openIntelDetail({
                        sysId: f.sysId,
                        sysName: f.sysName,
                        ts: f.ts,
                        author: f.author,
                        message: f.message,
                      })
                    }
                  >
                    <div className="intel-row-top">
                      <span className="intel-time">{fmtAgo(Date.now() - f.ts)}</span>
                      {f.sysName && (
                        <span className="intel-sys">
                          {f.sysName}
                          {j != null && <em className="intel-j"> · {j} saltos</em>}
                        </span>
                      )}
                    </div>
                    <div className="intel-msg">
                      <span className="intel-author">{f.author}:</span> {f.message}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tarjeta de detalle de un reporte de intel (piloto/nave/ruta/zKill) */}
        {overlay === "intel" && intelDetail && (
          <div className="intel-detail">
            <div className="intel-detail-head">
              <strong>{intelDetail.sysName ?? "Reporte"}</strong>
              <button className="sys-close" onClick={() => setIntelDetail(null)}>✕</button>
            </div>
            <div className="muted small">
              {fmtAgo(Date.now() - intelDetail.ts)} · reportó {intelDetail.author}
            </div>
            <div className="intel-detail-msg">{intelDetail.message}</div>

            <div className="intel-detail-sec">
              <span className="muted small">Pilotos</span>
              {intelEntLoading && <div className="muted small">Resolviendo…</div>}
              {!intelEntLoading && intelEntities && intelEntities.characters.length === 0 && (
                <div className="muted small">Ningún piloto reconocido en el reporte.</div>
              )}
              {intelEntities?.characters.map((c) => {
                const track = pilotTrack(c.name);
                const active = intelTrackPilot === c.name;
                return (
                  <div key={c.id} className={`intel-pilot${active ? " active" : ""}`}>
                    <div className="intel-pilot-row">
                      <img
                        src={`https://images.evetech.net/characters/${c.id}/portrait?size=32`}
                        alt=""
                        width={24}
                        height={24}
                      />
                      <span className="intel-pilot-name">{c.name}</span>
                      <button title="zKillboard" onClick={() => openUrl(`https://zkillboard.com/character/${c.id}/`)}>
                        zKill
                      </button>
                      {track.length > 1 && (
                        <button
                          title="Trazar ruta según reportes"
                          onClick={() => setIntelTrackPilot(active ? null : c.name)}
                        >
                          {active ? "Ocultar ruta" : `Ruta (${track.length})`}
                        </button>
                      )}
                    </div>
                    {active && track.length > 0 && (
                      <ol className="intel-track">
                        {track.map((t, ti) => (
                          <li key={ti}>
                            <span className="intel-time">{fmtAgo(Date.now() - t.ts)}</span> {t.sysName}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                );
              })}
            </div>

            {intelEntities && intelEntities.ships.length > 0 && (
              <div className="intel-detail-sec">
                <span className="muted small">Naves citadas</span>
                <div className="intel-ships">
                  {intelEntities.ships.map((s) => (
                    <button
                      key={s.id}
                      className="intel-ship"
                      title="zKillboard del tipo"
                      onClick={() => openUrl(`https://zkillboard.com/ship/${s.id}/`)}
                    >
                      <img src={typeIcon(s.id, 32)} alt="" width={22} height={22} />
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {intelDetail.sysId != null && (
              <>
                {intel && (
                  <button
                    className="sys-assets-btn"
                    onClick={() => {
                      const id = intelDetail.sysId!;
                      const has = intel.anchors.includes(id);
                      intel.onConfig({
                        anchors: has ? intel.anchors.filter((x) => x !== id) : [...intel.anchors, id],
                      });
                    }}
                  >
                    {intel.anchors.includes(intelDetail.sysId) ? "⚓ Quitar ancla" : "⚓ Anclar aquí"}
                  </button>
                )}
                <div className="sys-links">
                  <button onClick={() => openUrl(`https://zkillboard.com/system/${intelDetail.sysId}/`)}>
                    zKill sistema
                  </button>
                  {onSystemAssets && intelDetail.sysName && (
                    <button onClick={() => onSystemAssets(intelDetail.sysName!)}>📦 Mis assets</button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Panel de contexto de la capa activa (derecha): KPIs propios de la capa, plegable.
            Se oculta en Intel (lo sustituyen sus paneles) y cuando hay Ruta/Salto (tarjeta a la derecha). */}
        {overlay !== "intel" && !routeActive && !jumpActive && (
          <div className={`map-context ${ctxCollapsed ? "collapsed" : ""}`}>
            <div className="mc-title">
              <span className="mc-icon">
                <OverlayIcon o={activeOverlay} />
              </span>
              <span className="mc-title-tx">{activeOverlay.label}</span>
              <button
                className="mc-toggle"
                onClick={() => setCtxCollapsed((v) => !v)}
                title={ctxCollapsed ? "Expandir" : "Plegar"}
              >
                {ctxCollapsed ? "▸" : "▾"}
              </button>
            </div>
            {!ctxCollapsed && (
              <>
                <p className="mc-desc">{legend}</p>
                {ctxKpis.length > 0 && (
                  <div className="mc-kpis">
                    {ctxKpis.map((k, i) => (
                      <div className="mc-kpi" key={i}>
                        <span>{k.value}</span>
                        <label>{k.label}</label>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Sub-filtro de la capa activa (desplegable, estilo mapa oficial) */}
        {SUBFILTERS[overlay] && (
          <div className="map-subfilter">
            {SUBFILTERS[overlay]!.map((o) => (
              <button
                key={o.v}
                className={`msf-btn ${subFilter === o.v ? "active" : ""}`}
                onClick={() => setSubFilter(o.v)}
              >
                {o.l}
              </button>
            ))}
          </div>
        )}

        {/* Barra de capas por categorías (abajo-centro): cada categoría es un desplegable */}
        <div className="map-filterbar">
          {OVERLAY_CATS.map((c) => {
            const layers = OVERLAYS.filter((o) => o.cat === c.key);
            const activeHere = layers.find((o) => o.key === overlay);
            return (
              <div className="mfb-cat" key={c.key}>
                <button
                  className={`mfb-btn ${activeHere ? "active" : ""} ${openCat === c.key ? "open" : ""}`}
                  onClick={() => setOpenCat(openCat === c.key ? null : c.key)}
                  title={c.label}
                >
                  <span className="mfb-icon">
                    {activeHere ? <OverlayIcon o={activeHere} /> : c.icon}
                  </span>
                  <span className="mfb-label">{activeHere ? activeHere.short : c.label}</span>
                  <span className="mfb-caret">▾</span>
                </button>
                {openCat === c.key && (
                  <div className="mfb-menu">
                    {layers.map((o) => (
                      <button
                        key={o.key}
                        className={`mfb-item ${overlay === o.key ? "active" : ""}`}
                        onClick={() => {
                          onOverlayChange(o.key);
                          setOpenCat(null);
                        }}
                      >
                        <span className="mfb-icon">
                          <OverlayIcon o={o} />
                        </span>
                        <span>{o.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Categoría Navegación: herramientas de ruta y salto (no son capas, son modos). */}
          <div className="mfb-cat" key="navegacion">
            <button
              className={`mfb-btn ${routeActive || jumpActive ? "active" : ""} ${openCat === "navegacion" ? "open" : ""}`}
              onClick={() => setOpenCat(openCat === "navegacion" ? null : "navegacion")}
              title="Navegación"
            >
              <span className="mfb-icon">🧭</span>
              <span className="mfb-label">
                {routeActive ? "Ruta" : jumpActive ? "Salto" : "Navegación"}
              </span>
              <span className="mfb-caret">▾</span>
            </button>
            {openCat === "navegacion" && (
              <div className="mfb-menu">
                <button
                  className={`mfb-item ${routeActive ? "active" : ""}`}
                  onClick={() => {
                    setRouteActive((v) => !v);
                    setJumpActive(false);
                    setRouteStops([null]);
                    setOpenCat(null);
                  }}
                >
                  <span className="mfb-icon">🗺️</span>
                  <span>Ruta {routeActive ? "(ON)" : ""}</span>
                </button>
                <button
                  className={`mfb-item ${jumpActive ? "active" : ""}`}
                  onClick={() => {
                    setJumpActive((v) => !v);
                    setRouteActive(false);
                    setJumpOrigin(null);
                    setJumpDest(null);
                    setOpenCat(null);
                  }}
                >
                  <span className="mfb-icon">⚡</span>
                  <span>Salto {jumpActive ? "(ON)" : ""}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
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
      {items.length === 0 && <p className="muted small">Sin datos.</p>}
      <ol>
        {items.map((e) => (
          <li key={e.id} className="rival-row" onClick={() => openUrl(url(e.id))} title="Abrir en zKillboard">
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
  if (!data && busy) return <p className="muted">Cargando…</p>;
  if (!data || data.length === 0)
    return (
      <p className="muted small">
        Sin batallas detectadas. Sincroniza el histórico (y pulsa "Reprocesar daño") para tener los
        datos.
      </p>
    );
  return (
    <>
      <p className="muted small">
        Peleas detectadas (≥8 killmails en un sistema en menos de 1h). Click en una fila → battle
        report en zKillboard.
      </p>
      <table className="km-table">
        <thead>
          <tr>
            <th>Sistema</th>
            <th>Fecha</th>
            <th>Kills</th>
            <th>Losses</th>
            <th>ISK</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {data.map((b) => (
            <tr
              key={`${b.system_id}-${b.slug}`}
              className="clickable"
              title="Abrir battle report en zKillboard"
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
  if (!data && busy) return <p className="muted">Cargando…</p>;
  if (!data) return <p className="muted small">Sin datos. Sincroniza killmails y pulsa "Reprocesar daño".</p>;
  return (
    <>
      <p className="muted small">
        Basado en tus killmails (necesita el JSON completo: si está vacío, pulsa "Reprocesar daño" en PvP).
      </p>
      {(data.you_kill_chars.length > 0 || data.kills_you_chars.length > 0) && (
        <div className="rivals-charts">
          <div className="panel resumen-panel">
            <h4>A quién más matas (top)</h4>
            <Bars
              items={data.you_kill_chars
                .slice(0, 8)
                .map((r) => ({ label: r.name ?? `#${r.id}`, value: r.count }))}
              color="#3fb950"
            />
          </div>
          <div className="panel resumen-panel">
            <h4>Quién más te mata (top)</h4>
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
        <RivalList title="A quién más matas" items={data.you_kill_chars} kind="char" />
        <RivalList title="Corps que más matas" items={data.you_kill_corps} kind="corp" />
        <RivalList title="Quién más te mata" items={data.kills_you_chars} kind="char" />
        <RivalList title="Corps que más te matan" items={data.kills_you_corps} kind="corp" />
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
            <Kpi label="SP total" value={fmtSp(data.total_sp)} />
            <Kpi label="SP sin asignar" value={fmtSp(data.unallocated_sp)} />
            <Kpi label="Skills" value={fmtSp(data.skill_count)} />
            <Kpi label="Personajes" value={data.character_count} />
          </div>
          <h4>Entrenando ahora</h4>
          {data.training.length === 0 && <p className="muted small">Sin datos.</p>}
          {data.training.length > 0 && (
            <table className="km-table">
              <thead>
                <tr>
                  <th>Personaje</th>
                  <th>Skill</th>
                  <th>Nivel</th>
                  <th>Termina</th>
                </tr>
              </thead>
              <tbody>
                {data.training.map((t) => (
                  <tr key={t.character_id}>
                    <td>{t.character_name}</td>
                    <td>{t.skill_name ?? (t.skill_id ? `#${t.skill_id}` : "— sin entrenar —")}</td>
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

// Cabecera de tabla ordenable reutilizable. Click → ordena por esa columna; reclick → invierte.
function Th({
  label,
  col,
  sort,
  onSort,
}: {
  label: string;
  col: string;
  sort: { col: string; dir: 1 | -1 };
  onSort: (col: string) => void;
}) {
  const active = sort.col === col;
  return (
    <th className="th-sort" onClick={() => onSort(col)} title="Ordenar">
      {label} <span className="th-arrow">{active ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span>
    </th>
  );
}

function RateoView({
  data,
  busy,
}: {
  data: RattingDetail | null;
  busy: boolean;
}) {
  const [gran, setGran] = useState<"day" | "week" | "month" | "year">("day");
  const [cumulative, setCumulative] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [names, setNames] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    loadNewEden()
      .then((ne) => setNames(new Map(ne.systems.map((s) => [s.id, s.n]))))
      .catch(() => {});
  }, []);

  if (!data) return <p className="muted">{busy ? "Cargando…" : "Sin datos."}</p>;
  if (data.entries === 0)
    return (
      <p className="muted small">
        Sin ingresos de rateo en el journal. Sincroniza la wallet del personaje (sección Wallet)
        para empezar a acumular el histórico en tu PC.
      </p>
    );

  const sysName = (id: number) => names.get(id) ?? `#${id}`;
  const granLabel =
    gran === "day" ? "día" : gran === "week" ? "semana" : gran === "month" ? "mes" : "año";

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
    let acc = 0;
    series = series.map((s) => ({ ...s, isk: (acc += s.isk) }));
  }

  const totalIsk = data.total_bounty + data.total_ess;
  const iskPerHour = data.active_hours > 0 ? totalIsk / data.active_hours : 0;
  const topSystems = data.by_system.slice(0, 12);

  return (
    <>
      <div className="kpis">
        <Kpi label="ISK total (bounty + ESS)" value={fmtIsk(totalIsk)} tone="pos" />
        <Kpi label="Bounties" value={fmtIsk(data.total_bounty)} tone="pos" />
        <Kpi label="ESS" value={fmtIsk(data.total_ess)} tone="pos" />
        <Kpi label="Ratas eliminadas" value={fmtSp(data.rats_killed)} />
        <Kpi label="ISK / hora (estim.)" value={fmtIsk(iskPerHour)} />
      </div>

      <div className="rateo-controls">
        <div className="seg">
          {(["day", "week", "month", "year"] as const).map((g) => (
            <button key={g} className={gran === g ? "active" : ""} onClick={() => setGran(g)}>
              {g === "day" ? "Día" : g === "week" ? "Semana" : g === "month" ? "Mes" : "Año"}
            </button>
          ))}
        </div>
        <label className="rateo-check">
          <input
            type="checkbox"
            checked={cumulative}
            onChange={(e) => setCumulative(e.target.checked)}
          />
          Acumulado
        </label>
        <label className="rateo-date">
          Desde <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="rateo-date">
          Hasta <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
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
        <h4>
          {cumulative ? "ISK acumulado" : "ISK"} por {granLabel}
        </h4>
        <Bars
          items={series.map((s) => ({ label: s.label, value: s.isk }))}
          color="#3fb950"
          fmt={fmtIsk}
        />
      </div>

      <div className="top-list">
        <h4>Ratas por {granLabel}</h4>
        <Bars
          items={series.map((s) => ({ label: s.label, value: s.rats }))}
          color="#d29922"
          fmt={fmtSp}
        />
      </div>

      <div className="resumen-grid">
        <div className="panel resumen-panel">
          <h4>Distribución por sistema</h4>
          <Donut
            items={topSystems.map((s) => ({ label: sysName(s.system_id), value: s.isk }))}
            fmt={fmtIsk}
          />
        </div>
        <div className="panel resumen-panel">
          <h4>ISK por sistema (histórico)</h4>
          <Bars
            items={topSystems.map((s) => ({ label: sysName(s.system_id), value: s.isk }))}
            color="#4f9cff"
            fmt={fmtIsk}
          />
        </div>
      </div>

      <div className="top-list">
        <h4>Detalle por sistema</h4>
        <table className="km-table">
          <thead>
            <tr>
              <th>Sistema</th>
              <th>ISK</th>
              <th>Ratas</th>
            </tr>
          </thead>
          <tbody>
            {topSystems.map((s) => (
              <tr key={s.system_id}>
                <td>{sysName(s.system_id)}</td>
                <td>{fmtIsk(s.isk)}</td>
                <td>{fmtSp(s.rats)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ---------- Resumen (dashboard financiero) ---------- */
const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const DONUT_COLORS = [
  "#4f9cff", "#a371f7", "#3fb950", "#d29922", "#db61a2",
  "#e5534b", "#2dd4bf", "#f0883e", "#8b949e", "#6e7681",
];

function Donut({
  items,
  fmt = (n: number) => n.toLocaleString("es-ES"),
}: {
  items: { label: string; value: number }[];
  fmt?: (n: number) => string;
}) {
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  // Conserva el índice original (color estable) y descarta valores <= 0.
  const all = items.map((it, i) => ({ ...it, i })).filter((it) => it.value > 0);
  if (all.length === 0) return <p className="muted small">Sin datos.</p>;
  const visible = all.filter((it) => !hidden.has(it.i));
  const total = visible.reduce((s, it) => s + it.value, 0);
  const R = 60;
  const C = 2 * Math.PI * R;
  let acc = 0;
  const hovered = hover != null ? items[hover] : null;
  const hoveredPct =
    hovered && total > 0 && !hidden.has(hover as number) ? (hovered.value / total) * 100 : null;

  const toggle = (i: number) =>
    setHidden((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  return (
    <div className="donut-wrap">
      <div className="donut-chart">
        <svg viewBox="0 0 160 160" className="donut-svg">
          <g transform="rotate(-90 80 80)">
            {visible.map((it) => {
              const frac = total > 0 ? it.value / total : 0;
              const dash = frac * C;
              const off = -acc;
              acc += dash;
              const dim = hover != null && hover !== it.i;
              return (
                <circle
                  key={it.i}
                  cx="80"
                  cy="80"
                  r={R}
                  fill="none"
                  stroke={DONUT_COLORS[it.i % DONUT_COLORS.length]}
                  strokeWidth={hover === it.i ? 26 : 22}
                  strokeDasharray={`${dash} ${C - dash}`}
                  strokeDashoffset={off}
                  opacity={dim ? 0.35 : 1}
                  style={{ cursor: "pointer", transition: "stroke-width .1s, opacity .1s" }}
                  onMouseEnter={() => setHover(it.i)}
                  onMouseLeave={() => setHover(null)}
                >
                  <title>{`${it.label}: ${fmt(it.value)} (${((it.value / total) * 100).toFixed(1)}%)`}</title>
                </circle>
              );
            })}
          </g>
        </svg>
        <div className="donut-center">
          {hovered && hoveredPct != null ? (
            <>
              <strong>{hoveredPct.toFixed(1)}%</strong>
              <span>{hovered.label}</span>
            </>
          ) : (
            <>
              <strong>{fmt(total)}</strong>
              <span>total</span>
            </>
          )}
        </div>
      </div>
      <ul className="donut-legend">
        {all.map((it) => {
          const off = hidden.has(it.i);
          const pct = total > 0 && !off ? (it.value / total) * 100 : 0;
          return (
            <li
              key={it.i}
              className={off ? "is-off" : ""}
              title="Clic para ocultar/mostrar"
              onClick={() => toggle(it.i)}
              onMouseEnter={() => !off && setHover(it.i)}
              onMouseLeave={() => setHover(null)}
            >
              <span
                className="donut-dot"
                style={{ background: DONUT_COLORS[it.i % DONUT_COLORS.length] }}
              />
              <span className="donut-leg-label">{it.label}</span>
              <span className="donut-leg-val">{off ? "oculto" : `${fmt(it.value)} · ${pct.toFixed(0)}%`}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DeltaBadge({ cur, prev, invert = false }: { cur: number; prev: number; invert?: boolean }) {
  let txt: string;
  let dir: number; // 1 sube, -1 baja, 0 igual
  if (prev === 0) {
    if (cur === 0) {
      txt = "—";
      dir = 0;
    } else {
      txt = "nuevo";
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
  if (rows.length === 0) return <p className="muted small">Sin movimientos.</p>;
  return (
    <table className="km-table cat-table">
      <thead>
        <tr>
          <th>Categoría</th>
          <th style={{ textAlign: "right" }}>ISK</th>
          <th style={{ textAlign: "right" }}>vs anterior</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>
              <span className="cat-dot" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
              {r.category}
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

  if (periods === null) return <p className="muted">Cargando…</p>;
  if (periods.length === 0)
    return (
      <p className="muted small">
        Sin movimientos en el journal. Sincroniza la wallet de tus personajes (sección Wallet) para
        ver tu resumen.
      </p>
    );

  const years = [...new Set(periods.map((p) => p.slice(0, 4)))];
  const curYear = period.slice(0, 4);
  const curMonth = period.slice(5, 7);
  const monthsOfYear = periods.filter((p) => p.startsWith(curYear));

  return (
    <>
      <div className="resumen-period">
        <span className="rp-label">📅 Período</span>
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
              {MONTH_NAMES[parseInt(p.slice(5, 7), 10) - 1]}
            </option>
          ))}
        </select>
        <span className="rp-show">
          Mostrando {MONTH_NAMES[parseInt(curMonth, 10) - 1]} {curYear}
          {busy ? " · actualizando…" : ""}
        </span>
      </div>

      {data && (
        <>
          <div className="resumen-kpis">
            <div className="rk-card rk-net">
              <span className="rk-label">Balance del mes</span>
              <span className={`rk-value ${data.net >= 0 ? "pos" : "neg"}`}>{fmtIsk(data.net)} ISK</span>
              <DeltaBadge cur={data.net} prev={data.prev_net} />
            </div>
            <div className="rk-card rk-in">
              <span className="rk-label">↑ Ingresos</span>
              <span className="rk-value pos">{fmtIsk(data.income_total)}</span>
              <DeltaBadge cur={data.income_total} prev={data.prev_income_total} />
            </div>
            <div className="rk-card rk-out">
              <span className="rk-label">↓ Gastos</span>
              <span className="rk-value neg">{fmtIsk(data.expense_total)}</span>
              <DeltaBadge cur={data.expense_total} prev={data.prev_expense_total} invert />
            </div>
          </div>

          <div className="resumen-grid">
            <div className="panel resumen-panel">
              <h4>Distribución de ingresos</h4>
              <Donut items={data.income_by_category.map((c) => ({ label: c.category, value: c.isk }))} fmt={fmtIsk} />
            </div>
            <div className="panel resumen-panel">
              <h4>Ingresos por categoría</h4>
              <CatTable rows={data.income_by_category} invert={false} />
            </div>
            <div className="panel resumen-panel">
              <h4>Distribución de gastos</h4>
              <Donut items={data.expense_by_category.map((c) => ({ label: c.category, value: c.isk }))} fmt={fmtIsk} />
            </div>
            <div className="panel resumen-panel">
              <h4>Gastos por categoría</h4>
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

  if (periods === null) return <p className="muted">Cargando…</p>;
  if (periods.length === 0)
    return (
      <p className="muted small">
        Sin killmails registrados. Sincroniza el PvP de tus personajes para ver tu actividad.
      </p>
    );

  const years = [...new Set(periods.map((p) => p.slice(0, 4)))];
  const curYear = period.slice(0, 4);
  const curMonth = period.slice(5, 7);
  const monthsOfYear = periods.filter((p) => p.startsWith(curYear));

  return (
    <>
      <div className="resumen-period">
        <span className="rp-label">📅 Período</span>
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
              {MONTH_NAMES[parseInt(p.slice(5, 7), 10) - 1]}
            </option>
          ))}
        </select>
        <span className="rp-show">
          Mostrando {MONTH_NAMES[parseInt(curMonth, 10) - 1]} {curYear}
          {busy ? " · actualizando…" : ""}
        </span>
      </div>

      {data && (
        <>
          <div className="resumen-kpis act-kpis">
            <div className="rk-card rk-in">
              <span className="rk-label">Kills</span>
              <span className="rk-value pos">{fmtSp(data.kills)}</span>
              <span className="muted small">{fmtIsk(data.isk_destroyed)} ISK</span>
            </div>
            <div className="rk-card rk-out">
              <span className="rk-label">Losses</span>
              <span className="rk-value neg">{fmtSp(data.losses)}</span>
              <span className="muted small">{fmtIsk(data.isk_lost)} ISK</span>
            </div>
            <div className="rk-card rk-net">
              <span className="rk-label">Eficacia ISK</span>
              <span className="rk-value">{data.efficiency.toFixed(1)}%</span>
            </div>
          </div>

          <div className="top-list">
            <h4>Actividad diaria · {MONTH_NAMES[parseInt(curMonth, 10) - 1]} {curYear}</h4>
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
            <h4>🔥 Horas calientes (UTC EVE)</h4>
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
        <span className="kl-dot kl-dot-kill" /> Kills
      </span>
      <span>
        <span className="kl-dot kl-dot-loss" /> Losses
      </span>
    </div>
  );
}

/* ---------- Minería pro ---------- */
function MineriaView({ subject }: { subject: number | "global" }) {
  const isGlobal = subject === "global";
  const [periods, setPeriods] = useState<string[] | null>(null);
  const [period, setPeriod] = useState<string>("");
  const [data, setData] = useState<MiningDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [names, setNames] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    loadNewEden()
      .then((ne) => setNames(new Map(ne.systems.map((s) => [s.id, s.n]))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const ps = isGlobal
          ? await invoke<string[]>("get_mining_periods_global")
          : await invoke<string[]>("get_mining_periods", { characterId: subject });
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
          ? await invoke<MiningDetail>("get_mining_detail_global", { period })
          : await invoke<MiningDetail>("get_mining_detail", { characterId: subject, period });
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

  if (periods === null) return <p className="muted">Cargando…</p>;
  if (periods.length === 0)
    return (
      <p className="muted small">
        Sin registro de minería. Sincroniza la minería de tus personajes (sección Industria) para
        ver tu histórico.
      </p>
    );

  const sysName = (id: number) => names.get(id) ?? `#${id}`;
  const years = [...new Set(periods.map((p) => p.slice(0, 4)))];
  const curYear = period.slice(0, 4);
  const curMonth = period.slice(5, 7);
  const monthsOfYear = periods.filter((p) => p.startsWith(curYear));

  return (
    <>
      <div className="resumen-period">
        <span className="rp-label">📅 Período</span>
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
              {MONTH_NAMES[parseInt(p.slice(5, 7), 10) - 1]}
            </option>
          ))}
        </select>
        <span className="rp-show">
          Mostrando {MONTH_NAMES[parseInt(curMonth, 10) - 1]} {curYear}
          {busy ? " · actualizando…" : ""}
        </span>
      </div>

      {data && (
        <>
          <div className="resumen-kpis act-kpis">
            <div className="rk-card rk-net">
              <span className="rk-label">ISK estimado</span>
              <span className="rk-value pos">{fmtIsk(data.est_value)}</span>
            </div>
            <div className="rk-card rk-in">
              <span className="rk-label">Unidades minadas</span>
              <span className="rk-value">{fmtSp(data.units)}</span>
            </div>
            <div className="rk-card">
              <span className="rk-label">Tipos de mineral</span>
              <span className="rk-value">{fmtSp(data.ore_types)}</span>
            </div>
          </div>

          <div className="resumen-grid">
            <div className="panel resumen-panel">
              <h4>Distribución de mineral (por ISK)</h4>
              <Donut
                items={data.by_ore.map((o) => ({
                  label: o.type_name ?? `#${o.type_id}`,
                  value: o.isk,
                }))}
                fmt={fmtIsk}
              />
            </div>
            <div className="panel resumen-panel">
              <h4>Mineral extraído</h4>
              {data.by_ore.length === 0 ? (
                <p className="muted small">Sin minería este mes.</p>
              ) : (
                <table className="km-table cat-table">
                  <thead>
                    <tr>
                      <th>Mineral</th>
                      <th style={{ textAlign: "right" }}>Unidades</th>
                      <th style={{ textAlign: "right" }}>ISK estimado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_ore.map((o, i) => (
                      <tr key={i}>
                        <td>
                          <TypeIcon typeId={o.type_id} />
                          {o.type_name ?? `#${o.type_id}`}
                        </td>
                        <td style={{ textAlign: "right" }}>{fmtSp(o.units)}</td>
                        <td style={{ textAlign: "right" }}>{fmtIsk(o.isk)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="top-list">
            <h4>Por sistema</h4>
            <Bars
              items={data.by_system.map((s) => ({ label: sysName(s.system_id), value: s.units }))}
              color="#4f9cff"
              fmt={fmtSp}
            />
          </div>

          <div className="top-list">
            <h4>Tendencia mensual (ISK estimado)</h4>
            <Bars
              items={data.monthly.map((m) => ({ label: m.month, value: m.isk }))}
              color="#3fb950"
              fmt={fmtIsk}
            />
          </div>
        </>
      )}
    </>
  );
}

/* ---------- PvE: Factional + Abyssals ---------- */
function FactionalSection({ data, busy }: { data: FactionalData | null; busy: boolean }) {
  if (!data) return <p className="muted">{busy ? "Cargando…" : "Sin datos."}</p>;
  if (!data.enlisted)
    return (
      <p className="muted small">
        Este personaje no está enlistado en la Guerra de Facciones.
      </p>
    );
  const fac = data.faction_id ? FW_FACTIONS[data.faction_id] : null;
  const counts = (c: FactionalData["kills"]) => (
    <table className="km-table cat-table">
      <tbody>
        <tr>
          <td>Ayer</td>
          <td style={{ textAlign: "right" }}>{fmtSp(c.yesterday)}</td>
        </tr>
        <tr>
          <td>Última semana</td>
          <td style={{ textAlign: "right" }}>{fmtSp(c.last_week)}</td>
        </tr>
        <tr>
          <td>Total</td>
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
          <div className="kpi-label">Facción</div>
        </div>
        {data.current_rank != null && <Kpi label="Rango actual" value={data.current_rank} />}
        {data.highest_rank != null && <Kpi label="Rango máximo" value={data.highest_rank} />}
        {data.enlisted_on && <Kpi label="Enlistado" value={data.enlisted_on.slice(0, 10)} />}
      </div>
      <div className="resumen-grid">
        <div className="panel resumen-panel">
          <h4>Kills</h4>
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

function AbyssalsSection({ data, busy }: { data: AbyssalsData | null; busy: boolean }) {
  if (!data) return <p className="muted">{busy ? "Cargando…" : "Sin datos."}</p>;
  return (
    <>
      <p className="muted small">
        ⚠️ ESI no expone las runs abisales. Esto es una <b>estimación</b> a partir de tus compras de
        filamentos, ahora <b>acumuladas en tu PC</b> (cada sync guarda las nuevas; 1 filamento ≈ 1 run).
        Sincroniza la wallet con frecuencia para no perder transacciones fuera de la ventana de ESI.
      </p>
      {data.by_filament.length === 0 ? (
        <p className="muted small">
          No se han detectado compras de filamentos en la ventana de transacciones.
        </p>
      ) : (
        <>
          <div className="kpis">
            <Kpi label="Runs estimadas" value={fmtSp(data.runs_est)} />
            <Kpi label="ISK en filamentos" value={fmtIsk(data.isk_spent)} tone="neg" />
            <Kpi label="Tipos de filamento" value={fmtSp(data.by_filament.length)} />
          </div>
          <div className="top-list">
            <h4>Por filamento</h4>
            <table className="km-table cat-table">
              <thead>
                <tr>
                  <th>Filamento</th>
                  <th style={{ textAlign: "right" }}>Cantidad</th>
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
function standingColor(s: number): string {
  if (s >= 5) return "#3fb950";
  if (s > 0) return "#56b870";
  if (s === 0) return "#8b949e";
  if (s > -5) return "#e3a13a";
  return "#e5534b";
}
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
  if (!contacts) return <p className="muted">{busy ? "Cargando…" : "Sin datos."}</p>;
  const goodC = contacts.filter((c) => c.standing > 0).length;
  const badC = contacts.filter((c) => c.standing < 0).length;
  return (
    <>
      <div className="kpis">
        <Kpi label="Contactos" value={fmtSp(contacts.length)} />
        <Kpi label="Positivos" value={fmtSp(goodC)} tone="pos" />
        <Kpi label="Negativos" value={fmtSp(badC)} tone="neg" />
        {standings && <Kpi label="Standings NPC" value={fmtSp(standings.length)} />}
      </div>

      <div className="top-list">
        <h4>Tus contactos</h4>
        {contacts.length === 0 ? (
          <p className="muted small">No tienes contactos.</p>
        ) : (
          <table className="km-table cat-table">
            <thead>
              <tr>
                <th>Contacto</th>
                <th>Tipo</th>
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
                      {c.watched && <span title="En seguimiento"> 👁️</span>}
                      {c.blocked && <span title="Bloqueado"> 🚫</span>}
                    </td>
                    <td>{KIND_ES[c.kind] ?? c.kind}</td>
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
        <h4>Standings con NPC</h4>
        {!standings || standings.length === 0 ? (
          <p className="muted small">Sin standings (o falta el scope de standings; reloguea con acceso).</p>
        ) : (
          <table className="km-table cat-table">
            <thead>
              <tr>
                <th>Entidad</th>
                <th>Tipo</th>
                <th style={{ textAlign: "right" }}>Standing</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((s) => (
                <tr key={`${s.kind}-${s.id}`}>
                  <td>{s.name ?? `#${s.id}`}</td>
                  <td>{KIND_ES[s.kind] ?? s.kind}</td>
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
  if (!planets) return <p className="muted">{busy ? "Cargando colonias…" : "Sin datos."}</p>;
  if (planets.length === 0)
    return <p className="muted small">No tienes colonias de Planetary Interaction.</p>;
  const totalPins = planets.reduce((s, p) => s + p.num_pins, 0);
  return (
    <>
      <div className="kpis">
        <Kpi label="Colonias" value={fmtSp(planets.length)} />
        <Kpi label="Estructuras (pins)" value={fmtSp(totalPins)} />
      </div>
      <table className="km-table">
        <thead>
          <tr>
            <th>Sistema</th>
            <th>Tipo de planeta</th>
            <th>Nivel</th>
            <th>Estructuras</th>
            <th>Última actualización</th>
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

function ComercioView({ orders, busy }: { orders: MarketOrder[] | null; busy: boolean }) {
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 }>({ col: "issued", dir: -1 });
  const onSort = (col: string) =>
    setSort((s) => (s.col === col ? { col, dir: s.dir === 1 ? -1 : 1 } : { col, dir: 1 }));
  if (!orders) return <p className="muted">{busy ? "Cargando órdenes…" : "Sin datos."}</p>;
  if (orders.length === 0)
    return <p className="muted small">No tienes órdenes de mercado abiertas.</p>;
  const sorted = [...orders].sort((a, b) => {
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
  const buys = orders.filter((o) => o.is_buy).length;
  const buyValue = orders
    .filter((o) => o.is_buy)
    .reduce((s, o) => s + o.price * o.volume_remain, 0);
  const sellValue = orders
    .filter((o) => !o.is_buy)
    .reduce((s, o) => s + o.price * o.volume_remain, 0);
  return (
    <>
      <div className="kpis">
        <Kpi label="Órdenes" value={fmtSp(orders.length)} />
        <Kpi label="De compra" value={fmtSp(buys)} tone="pos" />
        <Kpi label="De venta" value={fmtSp(orders.length - buys)} tone="neg" />
        <Kpi label="Valor compra" value={fmtIsk(buyValue)} tone="pos" />
        <Kpi label="Valor venta" value={fmtIsk(sellValue)} tone="neg" />
      </div>
      <table className="km-table">
        <thead>
          <tr>
            <Th label="Item" col="item" sort={sort} onSort={onSort} />
            <Th label="Tipo" col="type" sort={sort} onSort={onSort} />
            <Th label="Precio" col="price" sort={sort} onSort={onSort} />
            <Th label="Cantidad" col="qty" sort={sort} onSort={onSort} />
            <Th label="Sistema" col="sys" sort={sort} onSort={onSort} />
            <Th label="Emitida" col="issued" sort={sort} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((o, i) => (
            <tr key={i}>
              <td className="ship-cell">
                <TypeIcon typeId={o.type_id} />
                <span>{o.type_name ?? `#${o.type_id}`}</span>
              </td>
              <td style={{ color: o.is_buy ? "#3fb950" : "#e5534b" }}>
                {o.is_buy ? "Compra" : "Venta"}
              </td>
              <td>{fmtIsk(o.price)}</td>
              <td>
                {fmtSp(o.volume_remain)} / {fmtSp(o.volume_total)}
              </td>
              <td>{o.system_name ?? (o.system_id ? `#${o.system_id}` : "—")}</td>
              <td>{o.issued?.replace("T", " ").slice(0, 16) ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// Icono de tipo con fallback: el endpoint /icon no existe para blueprints (salen rotos);
// si falla, probamos la variante /bp (icono de plano). Se reinicia si cambia el type_id.
function TypeIcon({
  typeId,
  size = 32,
  className = "type-ico",
}: {
  typeId: number;
  size?: number;
  className?: string;
}) {
  const [src, setSrc] = useState(typeIcon(typeId, size));
  useEffect(() => setSrc(typeIcon(typeId, size)), [typeId, size]);
  return (
    <img
      className={className}
      src={src}
      alt=""
      loading="lazy"
      onError={() => {
        const bp = `https://images.evetech.net/types/${typeId}/bp?size=${size}`;
        if (src !== bp) setSrc(bp);
      }}
    />
  );
}

// Icono de una capa del mapa: arte real de EVE si tiene typeId, si no el emoji.
function OverlayIcon({ o }: { o: { icon: string; typeId?: number } }) {
  return o.typeId ? <img src={typeIcon(o.typeId, 32)} alt="" loading="lazy" /> : <>{o.icon}</>;
}

// ---- Visor de fit circular (estilo ventana de fitting del juego) ----
type WheelMod = { type_id: number; name: string; qty: number; fam: string };
const RING_FAMS = ["high", "mid", "low", "rig", "sub"];
const FAM_LABEL: Record<string, string> = {
  high: "Slot alto",
  mid: "Slot medio",
  low: "Slot bajo",
  rig: "Rig",
  sub: "Subsistema",
  extra: "Drones / Carga",
};

// La nave en el centro y los módulos en círculo alrededor (altos→medios→bajos→rigs→subs).
// Drones/carga van en un panel lateral. Al pasar el ratón por un módulo se ve su info.
function FitWheel({
  shipTypeId,
  shipName,
  mods,
  charSkills,
  reqs,
  skillNames,
}: {
  shipTypeId: number;
  shipName: string;
  mods: WheelMod[];
  charSkills?: Record<number, number> | null;
  reqs?: Record<string, [number, number][]>;
  skillNames?: Record<string, string>;
}) {
  const [hover, setHover] = useState<WheelMod | null>(null);
  // Skill-check: ¿puede el personaje activo pilotar este fit? ¿qué le falta?
  const skillReport = useMemo(() => {
    if (!charSkills || !reqs) return null;
    const need = new Map<number, number>(); // skill_id → nivel máximo requerido
    for (const t of [shipTypeId, ...mods.map((m) => m.type_id)]) {
      const rs = reqs[String(t)];
      if (!rs) continue;
      for (const [sid, lvl] of rs) need.set(sid, Math.max(need.get(sid) ?? 0, lvl));
    }
    const missing: { name: string; have: number; need: number }[] = [];
    for (const [sid, lvl] of need) {
      const have = charSkills[sid] ?? 0;
      if (have < lvl)
        missing.push({ name: skillNames?.[String(sid)] ?? `#${sid}`, have, need: lvl });
    }
    missing.sort((a, b) => a.name.localeCompare(b.name));
    return { canFly: missing.length === 0, missing };
  }, [charSkills, reqs, skillNames, shipTypeId, mods]);
  const ring = mods
    .filter((m) => RING_FAMS.includes(m.fam))
    .sort((a, b) => RING_FAMS.indexOf(a.fam) - RING_FAMS.indexOf(b.fam));
  const extra = mods.filter((m) => !RING_FAMS.includes(m.fam));
  const SIZE = 460;
  const C = SIZE / 2;
  const R = 190;
  // Como en el juego: los slots se agrupan por familia en arcos con HUECOS entre grupos
  // (altos arriba → medios → bajos → rigs → subs, en sentido horario desde arriba).
  const placed: { m: WheelMod; ang: number }[] = [];
  {
    const groups = RING_FAMS.map((f) => ring.filter((m) => m.fam === f)).filter((g) => g.length > 0);
    const total = ring.length;
    const GAP = total > 0 ? Math.min(22, 130 / total) : 0; // hueco angular entre grupos
    const step = total > 0 ? (360 - groups.length * GAP) / total : 0;
    let ang = -90 + GAP / 2; // arranca arriba
    for (const g of groups) {
      for (const m of g) {
        placed.push({ m, ang });
        ang += step;
      }
      ang += GAP;
    }
  }
  return (
    <div className="fitw">
      <div className="fitw-wheel" style={{ width: SIZE, height: SIZE }}>
        <div className="fitw-ring" />
        <img className="fitw-ship" src={typeRender(shipTypeId, 512)} alt={shipName} />
        <div className="fitw-name">{shipName}</div>
        {placed.map(({ m, ang: deg }, i) => {
          const ang = (deg * Math.PI) / 180;
          const x = C + R * Math.cos(ang);
          const y = C + R * Math.sin(ang);
          return (
            <div
              key={i}
              className={`fitw-slot fam-${m.fam} ${hover === m ? "hl" : ""}`}
              style={{ left: `${x}px`, top: `${y}px` }}
              onMouseEnter={() => setHover(m)}
              onMouseLeave={() => setHover(null)}
            >
              <img src={typeIcon(m.type_id, 32)} alt="" loading="lazy" />
              {m.qty > 1 && <span className="fitw-qty">{m.qty > 99 ? "99+" : m.qty}</span>}
            </div>
          );
        })}
      </div>
      <div className="fitw-side">
        <div className="fitw-info">
          {hover ? (
            <>
              <img src={typeIcon(hover.type_id, 64)} alt="" />
              <div>
                <strong>{hover.name}</strong>
                {hover.qty > 1 && <span className="muted"> ×{fmtSp(hover.qty)}</span>}
                <div className="small muted">{FAM_LABEL[hover.fam] ?? hover.fam}</div>
              </div>
            </>
          ) : (
            <span className="small muted">Pasa el ratón por un módulo para ver su info.</span>
          )}
        </div>
        {skillReport && (
          <div className={`fitw-skills ${skillReport.canFly ? "ok" : "no"}`}>
            {skillReport.canFly ? (
              <span>✅ Puedes pilotar este fit con tus skills.</span>
            ) : (
              <>
                <div className="fitw-skills-h">⚠ Te faltan {skillReport.missing.length} skills:</div>
                {skillReport.missing.map((s, i) => (
                  <div className="fitw-skill" key={i}>
                    <span>{s.name}</span>
                    <span className="muted small">
                      {s.have} → {s.need}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
        {extra.length > 0 && (
          <div className="fitw-extra">
            <div className="fit-group-h">Drones / Carga</div>
            {extra.map((m, i) => (
              <div className="fit-mod" key={i} title={m.name}>
                <img className="type-ico" src={typeIcon(m.type_id)} alt="" loading="lazy" />
                <span className="fit-mod-name">{m.name}</span>
                {m.qty > 1 && <span className="fit-mod-qty">×{fmtSp(m.qty)}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Visor de un fit guardado (Fiteos): slot de cada módulo vía module_slots.json.
function FitDisplay({
  fit,
  slots,
  charSkills,
  reqs,
  skillNames,
}: {
  fit: Fit;
  slots: Record<string, string>;
  charSkills?: Record<number, number> | null;
  reqs?: Record<string, [number, number][]>;
  skillNames?: Record<string, string>;
}) {
  const mods: WheelMod[] = fit.modules.map((m) => ({
    type_id: m.type_id,
    name: m.name,
    qty: m.qty,
    fam: m.fitted ? slots[String(m.type_id)] ?? "extra" : "extra",
  }));
  return (
    <FitWheel
      shipTypeId={fit.ship_type_id}
      shipName={fit.ship_name}
      mods={mods}
      charSkills={charSkills}
      reqs={reqs}
      skillNames={skillNames}
    />
  );
}

function FitsView({ charId, charName }: { charId: number | null; charName: string | null }) {
  const [fits, setFits] = useState<Fit[]>([]);
  const [slots, setSlots] = useState<Record<string, string>>({});
  const [reqs, setReqs] = useState<Record<string, [number, number][]>>({});
  const [skillNames, setSkillNames] = useState<Record<string, string>>({});
  const [charSkills, setCharSkills] = useState<Record<number, number> | null>(null);
  const [eft, setEft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<Fit | null>(null);
  useEffect(() => {
    invoke<Fit[]>("list_fits").then(setFits).catch(() => {});
    fetch("/module_slots.json").then((r) => r.json()).then(setSlots).catch(() => {});
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
  async function importGame() {
    if (charId == null) return;
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const imported = await invoke<Fit[]>("import_fittings", { characterId: charId });
      setFits((prev) => [...imported, ...prev]);
      setNotice(
        imported.length > 0
          ? `Importados ${imported.length} fits de ${charName ?? "tu personaje"}.`
          : "No hay fits nuevos que importar."
      );
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!eft.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const f = await invoke<Fit>("save_fit", { eft });
      setFits((prev) => [f, ...prev]);
      setEft("");
      setOpen(f);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function del(id: number) {
    try {
      await invoke("delete_fit", { id });
      setFits((prev) => prev.filter((f) => f.id !== id));
      if (open?.id === id) setOpen(null);
    } catch (e) {
      setErr(String(e));
    }
  }
  return (
    <div className="fits-view">
      <div className="fits-import">
        <textarea
          className="fits-eft"
          value={eft}
          onChange={(e) => setEft(e.target.value)}
          placeholder={"Pega aquí un fit en formato EFT:\n\n[Thanatos, Mi fit]\nDrone Damage Amplifier II\n..."}
          rows={5}
        />
        <div className="fits-actions">
          <button className="fits-save" onClick={save} disabled={busy || !eft.trim()}>
            {busy ? "…" : "Importar fit (EFT)"}
          </button>
          <button
            className="fits-import-game"
            onClick={importGame}
            disabled={busy || charId == null}
            title={
              charId == null
                ? "Selecciona un personaje arriba para importar sus fits del juego"
                : "Trae tus fits guardados en EVE"
            }
          >
            🚀 Importar fits del juego
          </button>
        </div>
        {err && <span className="fits-err small">{err}</span>}
        {notice && <span className="small muted">{notice}</span>}
      </div>
      {fits.length > 0 && (
        <div className="fits-list">
          {fits.map((f) => (
            <div
              key={f.id}
              className={`fits-card ${open?.id === f.id ? "active" : ""}`}
              onClick={() => setOpen(f)}
            >
              <img className="type-ico" src={typeIcon(f.ship_type_id)} alt="" loading="lazy" />
              <span className="fits-card-tx">
                <strong>{f.name}</strong>
                <span className="small muted">{f.ship_name}</span>
              </span>
              <button
                className="fits-del"
                title="Borrar fit"
                onClick={(e) => {
                  e.stopPropagation();
                  del(f.id);
                }}
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      )}
      {open ? (
        <FitDisplay
          fit={open}
          slots={slots}
          charSkills={charSkills}
          reqs={reqs}
          skillNames={skillNames}
        />
      ) : (
        fits.length === 0 && (
          <p className="muted small">
            Aún no hay fiteos. Pega un EFT (en EVE: clic derecho en el fitting → Copiar al portapapeles)
            y pulsa Importar.
          </p>
        )
      )}
    </div>
  );
}

// location_flag de EVE → familia de slot del visor circular.
function flagFamily(flag: string): string {
  if (flag.startsWith("HiSlot")) return "high";
  if (flag.startsWith("MedSlot")) return "mid";
  if (flag.startsWith("LoSlot")) return "low";
  if (flag.startsWith("RigSlot")) return "rig";
  if (flag.startsWith("SubSystem")) return "sub";
  return "extra"; // DroneBay, Cargo, Fighter, bodegas…
}
const FIT_SLOTS_RE = /^(HiSlot|MedSlot|LoSlot|RigSlot|SubSystem)/;

// Fit de una nave abierta en Assets: reusa el visor circular.
function ShipFit(props: {
  rows: AssetDetail[];
  typeId: number;
  name: string;
  charSkills?: Record<number, number> | null;
  reqs?: Record<string, [number, number][]>;
  skillNames?: Record<string, string>;
}) {
  const { rows, typeId, name, charSkills, reqs, skillNames } = props;
  const mods: WheelMod[] = rows.map((r) => ({
    type_id: r.type_id,
    name: r.type_name ?? `#${r.type_id}`,
    qty: r.quantity,
    fam: flagFamily(r.slot),
  }));
  return (
    <FitWheel
      shipTypeId={typeId}
      shipName={name}
      mods={mods}
      charSkills={charSkills}
      reqs={reqs}
      skillNames={skillNames}
    />
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
      {!data && busy && <p className="muted">Cargando… (puede tardar con muchos assets)</p>}
      {data && (
        <>
          <div className="kpis">
            <Kpi label="Stacks" value={fmtSp(data.stacks)} />
            <Kpi label="Tipos distintos" value={fmtSp(data.distinct_types)} />
            <Kpi label="Unidades totales" value={fmtSp(data.total_units)} />
            {data.est_value > 0 && <Kpi label="Valor estimado" value={fmtIsk(data.est_value)} />}
          </div>
          {detail && detail.length > 0 && catList.length > 1 && (
            <div className="panel resumen-panel" style={{ maxWidth: 540, marginBottom: "0.8rem" }}>
              <h4>Distribución por categoría</h4>
              <Bars
                items={Object.entries(
                  detail.reduce<Record<string, number>>((acc, r) => {
                    acc[r.category] = (acc[r.category] ?? 0) + r.quantity;
                    return acc;
                  }, {})
                )
                  .map(([label, value]) => ({ label, value }))
                  .sort((a, b) => b.value - a.value)}
                fmt={fmtSp}
              />
            </div>
          )}
          {detail && catList.length > 1 && (
            <div className="tabs" style={{ marginTop: "0.5rem" }}>
              <button className={`tab ${cat === "" ? "active" : ""}`} onClick={() => setCat("")}>
                Todos
              </button>
              {catList.map((c) => (
                <button
                  key={c}
                  className={`tab ${cat === c ? "active" : ""}`}
                  onClick={() => setCat(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
          {openContainer && (
            <div className="asset-open-bar">
              <span>📦 Dentro de: <b>{openContainer.name}</b></span>
              <button className="asset-open-close" onClick={() => setOpenContainer(null)}>
                ✕ cerrar
              </button>
            </div>
          )}
          <div className="asset-search" ref={searchRef}>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por item, sistema, ubicación o contenedor…"
            />
            {detail && (
              <span className="muted small">
                {filtered.length === detail.length
                  ? `${detail.length} entradas`
                  : `${filtered.length} de ${detail.length}`}
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
            <p className="muted small">Cargando inventario…</p>
          ) : detail.length === 0 ? (
            <p className="muted small">Sin assets.</p>
          ) : (
            <table className="km-table">
              <thead>
                <tr>
                  <Th label="Item" col="name" sort={sort} onSort={onSort} />
                  <Th label="Cantidad" col="qty" sort={sort} onSort={onSort} />
                  <Th label="Sistema" col="sys" sort={sort} onSort={onSort} />
                  <th>Ubicación</th>
                  <th>Contenedor</th>
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
                              ? `Ver fit de ${r.container ?? "la nave"}`
                              : `Abrir ${r.container ?? "contenedor"}`
                          }
                          onClick={() =>
                            setOpenContainer({ id: r.container_id, name: r.container ?? "contenedor" })
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
              Mostrando {shown.length} de {filtered.length}. Afina la búsqueda para ver más.
            </p>
          )}
        </>
      )}
    </>
  );
}

function IndustryView(props: {
  jobs: JobView[] | null;
  mining: MiningSummary | null;
  busy: boolean;
  global?: boolean;
  onSyncMining?: () => void;
}) {
  const { jobs, mining, busy, global, onSyncMining } = props;
  return (
    <>
      {!jobs && !mining && busy && <p className="muted">Cargando…</p>}

      <h4>Jobs de industria activos</h4>
      {jobs && jobs.length === 0 && <p className="muted small">Sin jobs activos.</p>}
      {jobs && jobs.length > 0 && (
        <table className="km-table">
          <thead>
            <tr>
              {global && <th>Personaje</th>}
              <th>Actividad</th>
              <th>Producto / Blueprint</th>
              <th>Runs</th>
              <th>Estado</th>
              <th>Termina</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.job_id}>
                {global && <td>{j.character ?? "-"}</td>}
                <td>{j.activity}</td>
                <td>{j.product_name ?? j.blueprint_name ?? "-"}</td>
                <td>{j.runs}</td>
                <td>{j.status ?? "-"}</td>
                <td>{j.end_date?.replace("T", " ").slice(0, 16) ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="km-header" style={{ marginTop: "1rem" }}>
        <h4>Minería (histórico acumulado)</h4>
        {!global && (
          <button onClick={onSyncMining} disabled={busy}>
            {busy ? "Trabajando…" : "Sincronizar minería"}
          </button>
        )}
      </div>
      {mining && (
        <>
          <div className="kpis">
            <Kpi label="Unidades minadas" value={fmtSp(mining.total_units)} />
            <Kpi label="Entradas" value={mining.entries} />
          </div>
          <div className="top-list">
            <h4>Top minerales</h4>
            {mining.top_ores.length === 0 && <p className="muted small">Sin datos.</p>}
            <ol className="with-ico">
              {mining.top_ores.map((o) => (
                <li key={o.id}>
                  <img className="type-ico" src={typeIcon(o.id)} alt="" loading="lazy" />
                  {o.name ?? `#${o.id}`} <span className="muted">({fmtSp(o.count)})</span>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
      {!mining && !busy && <p className="muted small">Sin datos de minería (¿falta el scope?).</p>}
    </>
  );
}

export default App;
