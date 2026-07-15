import { useEffect, useRef, useState } from "react";
import { loadNewEden } from "./neweden";
import { Ticker } from "./ticker";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { save, open as openDialog, message, confirm as dialogConfirm } from "@tauri-apps/plugin-dialog";
import { tr, setLang as setI18nLang, type Lang } from "./i18n";
import "./App.css";
import { fmtAgo, fmtMMSS, fmtSp, fmtBytes, typeIcon } from "./format";
import { FitsView } from "./fit";
import { MapView } from "./map";
import { CazadorView } from "./cazador";
import { PvpView } from "./pvp";
import { NetworthViewC, WalletViewC } from "./wallet";
import { RateoView } from "./rateo";
import { MineriaView, FactionalSection, AbyssalsSection } from "./pve";
import { ContactosView } from "./contactos";
import { ResumenView } from "./resumen";
import { ActividadView } from "./actividad";
import { IndustryView } from "./industry";
import { BattlesView, RivalsView } from "./rivals";
import { CharHeader, SkillsView, GlobalSkillsView } from "./personaje";
import { PlanetologiaView } from "./planetologia";
import { BitacoraView, ACH_UI } from "./bitacora";
import { DiarioView } from "./diario";
import { FreelanceView } from "./freelance";
import { LogisView } from "./logis";
import { ReconView } from "./recon";
import { GamelogControl, gamelogScan } from "./gamelogControl";
import { MedalTexturesControl } from "./medalsControl";
import { WhatsNew } from "./whatsnew";
import { LealtadView } from "./lealtad";
import { playUnlock, ensureNotifPerm } from "./sound";
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
  Rivals,
  AssetSystem,
  IntelStatus,
  PiSystem,
  SovSystem,
  FwSystem,
  Incursion,
  ServerStatus,
  Bitacora,
  BitacoraUnlockEvent,
  MarketOrder,
  Planet,
  RattingDetail,
  SpecialRatsResult,
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
/** Cuenta atrás para el downtime diario de Tranquility (11:00 UTC). */
function DowntimeBadge() {
  const now = useNow(30_000);
  const d = new Date(now);
  const utcMins = d.getUTCHours() * 60 + d.getUTCMinutes();
  const dtStart = 11 * 60; // 11:00 UTC
  // Durante la ventana típica de DT (~15 min) lo señalamos en vivo.
  if (utcMins >= dtStart && utcMins < dtStart + 15) {
    return (
      <span className="sb-badge" title={tr("Downtime diario de Tranquility (11:00 UTC)")}>
        ⏻ {tr("Downtime en curso")}
      </span>
    );
  }
  const minsTo = (dtStart - utcMins + 1440) % 1440;
  const h = Math.floor(minsTo / 60);
  const m = minsTo % 60;
  return (
    <span className="sb-badge" title={tr("Cuenta atrás para el downtime diario (11:00 UTC)")}>
      ⏻ DT {h > 0 ? `${h}h ${m}m` : `${m}m`}
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
  // "ambiente" (N1-d) = dinámico: tiñe según la seguridad del sistema del personaje activo.
  const [theme, setTheme] = useState<string>(
    () => localStorage.getItem("koru-theme") || "nebula"
  );
  // Índice sistema→seguridad del SDE local; solo se carga si el tema ambiental está activo.
  const [neSec, setNeSec] = useState<Map<number, number> | null>(null);
  useEffect(() => {
    if (theme !== "ambiente" || neSec) return;
    loadNewEden()
      .then((ne) => {
        const m = new Map<number, number>();
        for (const s of ne.systems) m.set(s.id, s.s);
        setNeSec(m);
      })
      .catch(() => {});
  }, [theme, neSec]);
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
  const [tab, setTab] = useState<Tab>("bitacora");

  // Aplica el tema al <html>. Con "ambiente" (N1-d) el data-theme se calcula según la
  // seguridad del sistema donde está el sujeto activo (en Global, el 1º con ubicación).
  useEffect(() => {
    let t = theme;
    if (theme === "ambiente") {
      const cid =
        subject !== "global"
          ? subject
          : characters.find((c) => cards[c.character_id]?.system_id != null)?.character_id;
      const sysId = cid != null ? cards[cid]?.system_id : null;
      const sec = sysId != null && neSec ? neSec.get(sysId) : undefined;
      t =
        sysId == null || !neSec
          ? "nebula" // sin ubicación (o SDE aún cargando): neutro
          : sec === undefined
          ? "ambient-wh" // no está en k-space → wormhole/Pochven
          : sec >= 0.45
          ? "ambient-high"
          : sec > 0.0
          ? "ambient-low"
          : "ambient-null";
    }
    if (t === "nebula") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem("koru-theme", theme);
  }, [theme, subject, cards, characters, neSec]);
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
  const [bitacoraData, setBitacoraData] = useState<Bitacora | null>(null);
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
  const [piMap, setPiMap] = useState<Map<number, PiSystem> | null>(null);
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
  const [globalAlert, setGlobalAlert] = useState<{ text: string; kind: "intel" | "pi" } | null>(
    null,
  );
  const globalAlertTimer = useRef<number | null>(null);
  // kind decide el destino del clic y el estilo: "intel" → mapa/intel (rojo), "pi" → Planetología (ámbar).
  function showGlobalAlert(text: string, kind: "intel" | "pi" = "intel") {
    setGlobalAlert({ text, kind });
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
  // Estado REAL del vigilante (lo publica el hilo de Rust en cada vuelta). El panel lo enseña para
  // que un intel muerto NO se vea igual que un intel en calma: ese fue el fallo de fondo.
  const [intelStatus, setIntelStatus] = useState<IntelStatus | null>(null);
  useEffect(() => {
    const tick = () => {
      invoke<IntelStatus>("get_intel_status").then(setIntelStatus).catch(() => {});
    };
    tick();
    const t = window.setInterval(tick, 3000);
    return () => window.clearInterval(t);
  }, []);
  // Planetología: alarma de extractores (auto_sync ya lanzó la notificación nativa; aquí el toast).
  useEffect(() => {
    const un = listen<string>("pi-alert", (e) => showGlobalAlert(`⛏️ PI: ${e.payload}`, "pi"));
    return () => {
      un.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Bitácora: logros nuevos detectados en auto_sync (Rust ya lanzó la notificación nativa).
  // Aquí sonamos la fanfarria y mostramos un toast con los nombres (el catálogo vive en TS).
  useEffect(() => {
    void ensureNotifPerm(); // que la notif nativa del SO (la dispara Rust) tenga permiso
    const LEVELS = ["", "Bronce", "Plata", "Oro"];
    const un = listen<BitacoraUnlockEvent>("bitacora-unlock", (e) => {
      const list = e.payload?.unlocks ?? [];
      if (list.length === 0) return;
      const parts = list.slice(0, 3).map((u) => {
        const ui = ACH_UI[u.id];
        const name = ui ? tr(ui.label) : u.id;
        const icon = ui?.icon ?? "🏅";
        const lvl = tr(LEVELS[u.level] ?? "");
        return `${icon} ${name}${lvl ? ` (${lvl})` : ""}`;
      });
      const extra = list.length > 3 ? ` +${list.length - 3}` : "";
      const text = `🏅 ${tr("¡Logro desbloqueado!")} ${parts.join(" · ")}${extra}`;
      playUnlock();
      showGlobalAlert(text);
    });
    return () => {
      un.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const [agentSystems, setAgentSystems] = useState<Map<number, number> | null>(null); // sys_id -> nivel del mejor agente
  const [myCorpSystems, setMyCorpSystems] = useState<Map<number, number> | null>(null); // sys_id -> nº de tus corps NPC (LP) con estación
  const [agentDetails, setAgentDetails] = useState<Map<number, { id: number; name: string; level: number }[]> | null>(null); // sys_id -> tus agentes ahí
  const [corpDetails, setCorpDetails] = useState<Map<number, { id: number; name: string; lp: number }[]> | null>(null); // sys_id -> tus corps (LP) ahí
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
    setBitacoraData(null);
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
    setPiMap(null);
    setFactionStd(null);
    setAgentSystems(null);
    setMyCorpSystems(null);
    setAgentDetails(null);
    setCorpDetails(null);
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

  async function loadPiMap(subj: number | "global") {
    try {
      const rows =
        subj === "global"
          ? await invoke<PiSystem[]>("get_pi_map_global")
          : await invoke<PiSystem[]>("get_pi_map", { characterId: subj });
      const m = new Map<number, PiSystem>();
      for (const r of rows) m.set(r.system_id, r);
      setPiMap(m);
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

  // Sistemas donde tienes agentes (de tus standings tipo "agent") → color por nivel (agents.json del SDE).
  async function loadMyAgents(subj: number | "global") {
    if (subj === "global") {
      setAgentSystems(new Map());
      setAgentDetails(new Map());
      return;
    }
    try {
      const rows = await invoke<StandingRow[]>("get_standings", { characterId: subj });
      const meta = (await fetch("/agents.json").then((r) => r.json())) as Record<
        string,
        { s: number; l: number }
      >;
      const m = new Map<number, number>();
      const det = new Map<number, { id: number; name: string; level: number }[]>();
      for (const r of rows) {
        if (r.kind !== "agent") continue;
        const a = meta[String(r.id)];
        if (!a || a.s == null) continue;
        m.set(a.s, Math.max(m.get(a.s) ?? 0, a.l ?? 0));
        const list = det.get(a.s) ?? [];
        list.push({ id: r.id, name: r.name ?? `Agente ${r.id}`, level: a.l ?? 0 });
        det.set(a.s, list);
      }
      setAgentSystems(m);
      setAgentDetails(det);
    } catch {
      setAgentSystems(new Map());
      setAgentDetails(new Map());
    }
  }

  // Sistemas donde tus corps NPC con LP tienen estaciones (dónde gastar LP / operan tus agentes).
  async function loadMyCorps(subj: number | "global") {
    if (subj === "global") {
      setMyCorpSystems(new Map());
      setCorpDetails(new Map());
      return;
    }
    try {
      const lp = await invoke<{ corporation_id: number; corporation_name: string | null; loyalty_points: number }[]>(
        "get_loyalty",
        { characterId: subj },
      );
      const data = (await fetch("/npc_corp_systems.json").then((r) => r.json())) as Record<
        string,
        { s: number[]; f: number | null }
      >;
      const m = new Map<number, number>();
      const det = new Map<number, { id: number; name: string; lp: number }[]>();
      for (const c of lp) {
        const info = data[String(c.corporation_id)];
        if (!info) continue;
        const nm = c.corporation_name ?? `Corp ${c.corporation_id}`;
        for (const sid of info.s) {
          m.set(sid, (m.get(sid) ?? 0) + 1);
          const list = det.get(sid) ?? [];
          list.push({ id: c.corporation_id, name: nm, lp: c.loyalty_points });
          det.set(sid, list);
        }
      }
      setMyCorpSystems(m);
      setCorpDetails(det);
    } catch {
      setMyCorpSystems(new Map());
      setCorpDetails(new Map());
    }
  }

  function handleOverlayChange(o: MapOverlay) {
    setMapOverlay(o);
    if (o === "assets" && !assetsMap) loadAssetsMap(subject);
    if (o === "mineria" && !miningMap) loadMiningMap(subject);
    if (o === "pi" && !piMap) loadPiMap(subject);
    if (o === "soberania" && !sovMap) loadSov();
    if (o === "fw" && !fwMap) loadFw();
    if (o === "incursion" && !incursions) loadIncursions();
    if (o === "wormholes" && !theraConns) loadThera();
    if (o === "standings" && !factionStd) loadFactionStd(subject);
    if (o === "agentes" && !agentSystems) loadMyAgents(subject);
    if (o === "corps_npc" && !myCorpSystems) loadMyCorps(subject);
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
        if (t === "bitacora")
          setBitacoraData(await invoke<Bitacora>("get_bitacora", { characterId: null }));
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
        if (t === "bitacora")
          setBitacoraData(await invoke<Bitacora>("get_bitacora", { characterId }));
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
    if (mapOverlay === "agentes") loadMyAgents(subj);
    if (mapOverlay === "corps_npc") loadMyCorps(subj);
  }

  function changeTab(t: Tab) {
    setTab(t);
    if (t === "pvp") loadKillmails(subject, kmKind, 0);
    loadTab(subject, t);
  }

  // Latidos de datos: las vistas piden parte de sus datos con `invoke` propio, y esos efectos
  // solo se relanzaban al cambiar de sujeto/sección — la gráfica abierta se quedaba congelada
  // aunque el auto-sync o un escaneo trajeran datos nuevos. Estos contadores van en las deps de
  // esos efectos: sube el contador → la vista abierta se refresca sola. Dos fuentes, dos ticks.
  const [syncTick, setSyncTick] = useState(0); // tras cada auto-sync (datos ESI)
  const [glTick, setGlTick] = useState(0); // tras cada escaneo de gamelogs completado

  async function runAutoSync() {
    if (autoBusy) return;
    setAutoBusy(true);
    try {
      const r = await invoke<{
        killmails: number;
        wallet: number;
        mining: number;
        prices: number;
        snapshots: number;
        errors?: string[];
      }>("auto_sync");
      // Errores parciales (antes se tragaban): visibles en consola para diagnóstico.
      if (r.errors?.length) console.warn("auto_sync con errores:", r.errors);
      setLastSync(Date.now());
      // refrescar la vista actual con lo nuevo, en segundo plano (sin skeleton ni resetear scroll)
      loadHeadline(subject);
      loadMap(subject);
      loadTab(subject, tab, true);
      setSyncTick((t) => t + 1); // y las peticiones internas de la vista abierta (minería, tops…)
      void tailGamelog(); // el gamelog también late (ver abajo); en segundo plano, no bloquea el sync
    } catch (e) {
      setError(String(e));
    } finally {
      setAutoBusy(false);
    }
  }

  /** Cola del gamelog tras cada auto-sync.
   *
   *  POR QUÉ: ESI se sincroniza solo cada 30 min, pero el gamelog SOLO se leía al pulsar «Escanear»
   *  en Ajustes. Resultado: las vistas mezclaban un Total de ESI fresco con líneas de gamelog
   *  viejas, y eso no daba error — daba un **0 creíble**. RoGiz7 lo cazó minando: 1,98M m³ de ESI
   *  ese día y «Crítico (gamelog): 0», leído como «no tuviste críticos» cuando era «no lo he
   *  mirado». Misma enfermedad que el intel mudo, otra vista.
   *
   *  Es barato porque `scan_gamelogs` ya es INCREMENTAL (parse-once + tail por offset): los ficheros
   *  sin bytes nuevos se saltan por mtime+size, así que la pasada normal no lee los 6,6 GB.
   *
   *  TRES PUERTAS, y ninguna es cosmética:
   *   1. Sin carpeta configurada → nada. No adivinamos dónde están sus logs.
   *   2. Sin escaneo previo (`get_gamelog_status` = 0) → nada. El PRIMERO sí lee todo el histórico
   *      (40 min) y eso lo pide él, no se lo lanzamos por sorpresa.
   *   3. Con reparse pendiente → nada. Una migración de datos deja marcado un parse limpio que se
   *      hace «en el próximo escaneo»: si el próximo escaneo lo dispara el sync, una release nueva
   *      te tira 40 min de reescaneo en mitad de una partida. El incremental es automático;
   *      **el reparse entero lo pides tú**, desde Ajustes.
   *
   *  La carpeta se lee de `localStorage` a propósito: es donde vive (`koru-gamelog-folder`), y por
   *  eso esto va aquí y no en `auto_sync` — Rust no puede leerla. */
  async function tailGamelog() {
    if (gamelogScan.running) return; // el de Ajustes está en marcha: escriben los mismos offsets
    const folder = localStorage.getItem("koru-gamelog-folder");
    if (!folder) return; // puerta 1
    gamelogScan.running = true;
    try {
      if (!(await invoke<number>("get_gamelog_status"))) return; // puerta 2
      if (await invoke<boolean>("get_logi_reparse_pending")) return; // puerta 3
      const r = await invoke<{ files_scanned: number }>("scan_gamelogs", { folder });
      // Solo refrescamos si de verdad entraron bytes nuevos: `files_scanned` cuenta los ficheros que
      // traían algo (los que no cambian salen por mtime+size antes de contarse).
      if (r.files_scanned > 0) {
        setGlTick((t) => t + 1);
        loadTab(subject, tab, true);
      }
    } catch (e) {
      // No molestamos con un modal por esto, pero tampoco se traga: un fallo mudo aquí es
      // exactamente el bug que veníamos a matar.
      console.warn("cola del gamelog tras el sync:", e);
    } finally {
      gamelogScan.running = false;
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
    loadTab("global", "bitacora"); // Bitácora es ahora la landing por defecto
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
                {/* nave actual (N1-b): mini-render en la esquina del chip */}
                {card?.ship_type_id != null && (
                  <img
                    className="pj-ship"
                    src={`https://images.evetech.net/types/${card.ship_type_id}/render?size=32`}
                    alt=""
                    title={card.ship_type_name ?? ""}
                    loading="lazy"
                  />
                )}
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
                    {card?.ship_type_id != null && (
                      <div className="pj-pop-ship muted">
                        <img
                          src={`https://images.evetech.net/types/${card.ship_type_id}/render?size=64`}
                          alt=""
                          loading="lazy"
                        />
                        <span>
                          {card.ship_type_name ?? tr("Nave actual")}
                          {card.ship_name ? ` · “${card.ship_name}”` : ""}
                        </span>
                      </div>
                    )}
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
          <option value="ambiente">📍 {tr("Ambiente (donde estás)")}</option>
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

              {/* Logs de EVE: carpeta + escaneo de gamelogs (logi / reconstrucción Fase C).
                  Al completar un escaneo, las gráficas del gamelog abiertas se refrescan solas. */}
              <GamelogControl onScanned={() => setGlTick((t) => t + 1)} />

              {/* Medallas de corp pintadas: extraer texturas de la SharedCache del usuario. */}
              <MedalTexturesControl />

              {/* Copias automáticas: van DESPUÉS de Logs; la fila es carpeta + frecuencia + retención
                  en una sola línea (la ruta completa vive en el tooltip del botón, que si no ocupa
                  un renglón entero para algo que no se lee). */}
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
                    <button
                      className="tb-auto-pick"
                      onClick={chooseAutoBkDir}
                      title={autoBkDir || tr("Sin carpeta seleccionada")}
                    >
                      📁 {autoBkDir ? autoBkDir.split(/[\\/]/).filter(Boolean).pop() : tr("Elegir carpeta…")}
                    </button>
                    <select
                      className="tb-auto-sel"
                      title={tr("Frecuencia")}
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
                    <select
                      className="tb-auto-sel"
                      title={tr("Copias a conservar")}
                      value={autoBkKeep}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setAutoBkKeep(v);
                        setAutoBk("keep", String(v));
                      }}
                    >
                      <option value={7}>7 {tr("copias")}</option>
                      <option value={14}>14 {tr("copias")}</option>
                      <option value={30}>30 {tr("copias")}</option>
                      <option value={0}>{tr("Todas")}</option>
                    </select>
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
                {/* Aviso legal: Koru usa material del juego (texturas de medallas extraídas
                    de la instalación del propio usuario). La marca va literal; la coletilla, tr(). */}
                <div className="small muted">
                  EVE Online © Fenris Creations (FC) — {tr("FC no respalda esta app ni es responsable de ella.")}
                </div>
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

      {/* Aviso flotante global: visible en cualquier sección. Intel → mapa/intel (rojo);
          alarma de PI → Planetología (ámbar). El destino del clic depende del tipo. */}
      {globalAlert && (
        <div
          className={`intel-global-alert${globalAlert.kind === "pi" ? " intel-global-alert--pi" : ""}`}
          onClick={() => {
            setGlobalAlert(null);
            if (globalAlert.kind === "pi") {
              changeTab("planetologia");
              window.setTimeout(
                () =>
                  document
                    .querySelector(".section-header")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                60,
              );
            } else {
              handleOverlayChange("intel");
              window.setTimeout(
                () =>
                  document
                    .querySelector(".map-wrap")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                50,
              );
            }
          }}
          title={globalAlert.kind === "pi" ? tr("Ir a Planetología") : tr("Ir al intel")}
        >
          {globalAlert.text}
          <span className="intel-alert-cta">
            {globalAlert.kind === "pi" ? tr("Ir a Planetología") : tr("Ir al intel")} ▸
          </span>
        </div>
      )}

      {/* Modal "Novedades": cambios desde la última versión vista (se auto-oculta si no hay). */}
      <WhatsNew />

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
          piBySystem={piMap}
          factionStandings={factionStd}
          agentSystems={agentSystems}
          corpSystems={myCorpSystems}
          agentDetails={agentDetails}
          corpDetails={corpDetails}
          onOpenMisiones={() => {
            changeTab("lealtad");
            // Dejar que la pestaña renderice y bajar hasta la sección (la Bitácora/mapa quedan arriba).
            window.setTimeout(
              () =>
                document
                  .querySelector(".section-header")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" }),
              60,
            );
          }}
          onOpenPi={() => {
            changeTab("planetologia");
            window.setTimeout(
              () =>
                document
                  .querySelector(".section-header")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" }),
              60,
            );
          }}
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
            status: intelStatus,
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

        {/* Dock del sujeto: ticker de datos vivos (histórico local, deltas estilo bolsa) */}
        {stats && (
          <Ticker
            subject={subject}
            stats={stats}
            server={serverStatus}
            refreshKey={lastSync ?? 0}
          />
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
                  {g.imgSrc ? (
                    <img className="navg-img navg-bw" src={g.imgSrc} alt="" loading="lazy" />
                  ) : g.typeId ? (
                    <img className="navg-img" src={typeIcon(g.typeId)} alt="" loading="lazy" />
                  ) : (
                    <span className="navg-ico">{g.icon}</span>
                  )}{" "}
                  {tr(g.group)}
                </button>
              );
            })}
          </div>
          {(() => {
            const grp = NAV.find((g) => g.subs.some((s) => s.key === tab)) ?? NAV[0];
            // Grupo de un solo sub (p.ej. Logis): no mostramos fila de subtabs redundante.
            if (grp.subs.length <= 1) return null;
            return (
          <div className="tabs">
            {grp.subs.map((s) => {
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
            );
          })()}

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
              subjectChar={isGlobal ? null : subjectId}
              syncTick={syncTick}
              glTick={glTick}
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
            <IndustryView jobs={jobsData} busy={sectionBusy} global={isGlobal} subject={subject} />
          )}
          {(tab === "comercio" || tab === "comercio_pnl" || tab === "comercio_watch") && (
            <ComercioView
              orders={marketOrders}
              busy={sectionBusy}
              subject={subject}
              view={tab === "comercio_pnl" ? "pnl" : tab === "comercio_watch" ? "watch" : "orders"}
            />
          )}
          {tab === "planetologia" && (
            <PlanetologiaView planets={planets} busy={sectionBusy} syncTick={syncTick} />
          )}
          {tab === "bitacora" && (
            <BitacoraView data={bitacoraData} busy={sectionBusy} subject={subject} syncTick={syncTick} />
          )}
          {tab === "diario" && <DiarioView subject={subject} />}
          {tab === "freelance" && <FreelanceView subject={subject} />}
          {tab === "logis" && <LogisView subject={subject} />}
          {tab === "recon" && <ReconView subject={subject} />}
          {tab === "lealtad" && <LealtadView subject={subject} />}
          {tab === "fiteos" && <FitsView charId={isGlobal ? null : subjectId} charName={isGlobal ? null : subjectName} />}
          {tab === "rateo" && (
            <RateoView
              data={ratting}
              special={specialRats}
              charNames={new Map(Object.values(cards).map((c) => [c.character_id, c.name]))}
              paperSeries={paperSeries}
              abyssals={abyssalsData}
              busy={sectionBusy}
              subject={subject}
              glTick={glTick}
            />
          )}
          {tab === "resumen" && <ResumenView subject={subject} />}
          {tab === "actividad" && <ActividadView subject={subject} />}
          {tab === "mineria" && (
            <MineriaView
              subject={subject}
              charNames={new Map(Object.values(cards).map((c) => [c.character_id, c.name]))}
              onSyncMining={handleSyncMining}
              syncTick={syncTick}
              glTick={glTick}
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
          <DowntimeBadge />
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





export default App;
