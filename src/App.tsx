import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import "./App.css";
import { fmtAgo, fmtMMSS, fmtIsk, fmtSp, shipIcon, zkillUrl, secColor, ownerColor, heatColor, typeIcon, typeRender } from "./format";
import {
  FEATURES,
  SCOPE,
  CAPS,
  KM_LIMIT,
  AUTO_SYNC_MS,
  NAV,
  TAB_HEAD,
  OVERLAYS,
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
} from "./types";

/* ---------- app ---------- */
function App() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [cards, setCards] = useState<Record<number, CharacterCard>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feature, setFeature] = useState("identity");
  const [loginOpen, setLoginOpen] = useState(false); // panel "conceder acceso" colapsable
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
    // Al arrancar, comprobar si hay una versión más nueva publicada en Releases.
    check()
      .then((update) => {
        if (update) {
          pendingUpdate.current = update;
          setUpdateVersion(update.version);
        }
      })
      .catch(() => {}); // sin conexión / sin endpoint: ignorar silenciosamente
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

  // Sujeto activo: "global" (por defecto) o el id de un personaje. Filtro central.
  const [subject, setSubject] = useState<number | "global">("global");
  const [tab, setTab] = useState<Tab>("pvp");
  const [sectionBusy, setSectionBusy] = useState(false);
  const [progress, setProgress] = useState<{ processed: number; page: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [mapOverlay, setMapOverlay] = useState<MapOverlay>("ubicacion");

  // Datos del sujeto activo (unificados).
  const [stats, setStats] = useState<PvpStats | null>(null);
  const [pvpTrend, setPvpTrend] = useState<PvpTrendPoint[] | null>(null);
  const [assetsDetail, setAssetsDetail] = useState<AssetDetail[] | null>(null);
  const [walletData, setWalletData] = useState<WalletView | null>(null);
  const [networthData, setNetworthData] = useState<NetworthView | null>(null);
  const [skillsData, setSkillsData] = useState<SkillsSummary | null>(null); // por personaje
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
    setWalletData(null);
    setSkillsData(null);
    setGSkills(null);
    setAssetsData(null);
    setJobsData(null);
    setMiningData(null);
    setMapData(null);
    setAssetsMap(null);
    setMiningMap(null);
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

  function handleOverlayChange(o: MapOverlay) {
    setMapOverlay(o);
    if (o === "assets" && !assetsMap) loadAssetsMap(subject);
    if (o === "mineria" && !miningMap) loadMiningMap(subject);
    if (o === "soberania" && !sovMap) loadSov();
    if (o === "fw" && !fwMap) loadFw();
    if (o === "incursion" && !incursions) loadIncursions();
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

  async function loadTab(subj: number | "global", t: Tab) {
    setError(null);
    setSectionBusy(true);
    try {
      if (subj === "global") {
        if (t === "pvp") {
          setStats(await invoke<PvpStats>("get_pvp_stats_global"));
          setPvpTrend(await invoke<PvpTrendPoint[]>("get_pvp_trend_global"));
        }
        if (t === "rivales") setRivalsData(await invoke<Rivals>("get_rivals", { characterId: null }));
        if (t === "batallas") setBattlesData(await invoke<Battle[]>("get_battles", { characterId: null }));
        if (t === "patrimonio") setNetworthData(await invoke<NetworthView>("get_networth_global"));
        if (t === "wallet") setWalletData(await invoke<WalletView>("get_wallet_global"));
        if (t === "skills") setGSkills(await invoke<GlobalSkills>("get_skills_global"));
        if (t === "assets") {
          setAssetsData(await invoke<AssetsSummary>("get_assets_global"));
          setAssetsDetail(await invoke<AssetDetail[]>("get_assets_detail_global"));
        }
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
        if (t === "wallet") setWalletData(await invoke<WalletView>("get_wallet", { characterId }));
        if (t === "skills") setSkillsData(await invoke<SkillsSummary>("get_skills", { characterId }));
        if (t === "assets") {
          setAssetsData(await invoke<AssetsSummary>("get_assets", { characterId }));
          setAssetsDetail(await invoke<AssetDetail[]>("get_assets_detail", { characterId }));
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
      setError(String(e));
    } finally {
      setSectionBusy(false);
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
      // refrescar la vista actual con lo nuevo
      loadHeadline(subject);
      loadMap(subject);
      loadTab(subject, tab);
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
                          {busy ? "Esperando login…" : "Añadir acceso"}
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
          title="Sincronizar ahora"
        >
          ⟳
        </button>

        <div className="tb-login">
          <button
            className={`tb-login-toggle ${loginOpen ? "active" : ""}`}
            onClick={() => setLoginOpen((v) => !v)}
            disabled={busy}
          >
            ＋ Conceder acceso
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
          incursions={incursions}
          hereSystemId={isGlobal ? null : cards[subjectId]?.system_id ?? null}
          charLocations={(isGlobal
            ? Object.values(cards)
            : cards[subjectId]
            ? [cards[subjectId]]
            : []
          )
            .filter((c) => c.system_id != null)
            .map((c) => ({ id: c.character_id, name: c.name, system_id: c.system_id as number }))}
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
                  {g.group}
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
                  {s.label}
                </button>
              );
            })}
          </div>

          <div className="section-header">
            <h2 className="sh-title">{TAB_HEAD[tab].title}</h2>
            <span className="sh-subtitle">· {TAB_HEAD[tab].subtitle}</span>
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
              busy={sectionBusy}
              global={isGlobal}
              onSync={() => handleSyncWallet(subjectId)}
            />
          )}
          {tab === "skills" &&
            (isGlobal ? (
              <GlobalSkillsView data={gSkills} busy={sectionBusy} />
            ) : (
              <SkillsView data={skillsData} busy={sectionBusy} />
            ))}
          {tab === "assets" && <AssetsView data={assetsData} detail={assetsDetail} busy={sectionBusy} />}
          {tab === "industria" && (
            <IndustryView
              jobs={jobsData}
              mining={miningData}
              busy={sectionBusy}
              global={isGlobal}
              onSyncMining={() => handleSyncMining(subjectId)}
            />
          )}
          {(tab === "comercio" ||
            tab === "rateo" ||
            tab === "abyssals" ||
            tab === "factional" ||
            tab === "planetologia") && (
            <div className="soon-box">
              <div className="soon-emoji">🚧</div>
              <p className="muted">
                <strong>{TAB_HEAD[tab].title}</strong> — próximamente. Esta sección está planificada en
                el ROADMAP y la iremos rellenando.
              </p>
            </div>
          )}
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
            {icon && (
              <img
                className="type-ico"
                src={icon === "render" ? typeRender(it.id) : typeIcon(it.id)}
                alt=""
                loading="lazy"
              />
            )}
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
  return (
    <div className="bars">
      {items.map((it, i) => (
        <div className="bar-row" key={i}>
          <span className="bar-label" title={it.label}>
            {it.label}
          </span>
          <span className="bar-track">
            <span
              className="bar-fill"
              style={{ width: `${Math.max((it.value / max) * 100, 1.5)}%`, background: color }}
            />
          </span>
          <span className="bar-val">{fmt(it.value)}</span>
        </div>
      ))}
    </div>
  );
}

// Gráfica de líneas de tendencia temporal (kills/losses por semana).
function TrendChart({ points }: { points: PvpTrendPoint[] }) {
  if (points.length < 2)
    return <p className="muted small">Hace falta historial de varias semanas para ver la tendencia.</p>;
  const W = 600;
  const H = 190;
  const PAD = 30;
  const maxY = Math.max(...points.flatMap((p) => [p.kills, p.losses]), 1);
  const n = points.length;
  const x = (i: number) => PAD + (i / (n - 1)) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - (v / maxY) * (H - 2 * PAD);
  const path = (key: "kills" | "losses") =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(" ");
  const labels = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
  return (
    <div className="trend-chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="trend-svg" preserveAspectRatio="none">
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#2a3340" strokeWidth={1} />
        <path d={path("losses")} fill="none" stroke="#e5534b" strokeWidth={2} />
        <path d={path("kills")} fill="none" stroke="#3fb950" strokeWidth={2} />
        {labels.map((i) => (
          <text key={i} x={x(i)} y={H - PAD + 16} textAnchor="middle" className="trend-x">
            {points[i].date}
          </text>
        ))}
        <text x={PAD} y={PAD - 10} className="trend-x">{`máx ${maxY}/sem`}</text>
      </svg>
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
  const [chart, setChart] = useState(false);
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
                <h4>Tendencia (kills/losses por semana)</h4>
                {trend ? <TrendChart points={trend} /> : <p className="muted small">Cargando…</p>}
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
  busy: boolean;
  global?: boolean;
  onSync?: () => void;
}) {
  const { data, busy, global, onSync } = props;
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

function MapView(props: {
  data: SysActivity[] | null;
  busy: boolean;
  overlay: MapOverlay;
  onOverlayChange: (o: MapOverlay) => void;
  assetsBySystem?: Map<number, number> | null;
  miningBySystem?: Map<number, number> | null;
  sovBySystem?: Map<number, SovSystem> | null;
  fwBySystem?: Map<number, FwSystem> | null;
  incursions?: Incursion[] | null;
  hereSystemId?: number | null;
  charLocations?: CharLoc[];
}) {
  const {
    data,
    overlay,
    onOverlayChange,
    assetsBySystem,
    miningBySystem,
    sovBySystem,
    fwBySystem,
    incursions,
    hereSystemId,
    charLocations,
  } = props;
  const [ne, setNe] = useState<NewEden | null>(null);
  const [liveKills, setLiveKills] = useState<Map<number, number> | null>(null);
  const [liveJumps, setLiveJumps] = useState<Map<number, number> | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const [view, setView] = useState({ z: 1, x: 0, y: 0 });
  const [selected, setSelected] = useState<number | null>(null);
  const [hover, setHover] = useState<{ sid: number; sx: number; sy: number } | null>(null);
  const [subFilter, setSubFilter] = useState<string>("all"); // sub-filtro de la capa activa
  useEffect(() => setSubFilter("all"), [overlay]); // reset al cambiar de capa
  // Planificador de rutas
  const [routeActive, setRouteActive] = useState(false);
  const [routeMode, setRouteMode] = useState<RouteMode>("shortest");
  // Paradas de la ruta: [origen, destino1, destino2, ...]. null = casilla vacía.
  const [routeStops, setRouteStops] = useState<(number | null)[]>([null]);
  // Planificador de saltos de capital (jump drive)
  const [jumpActive, setJumpActive] = useState(false);
  const [jumpOrigin, setJumpOrigin] = useState<number | null>(null);
  const [jumpRange, setJumpRange] = useState(5);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const clickTimer = useRef<number | null>(null);
  const movedRef = useRef(false);

  useEffect(() => {
    loadNewEden().then(setNe).catch(() => {});
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
  }, []);
  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
    movedRef.current = false;
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
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
      setJumpOrigin(sid);
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
      : overlay === "incursion" && incursions
      ? { value: fmtSp(incursions.length), label: "Incursiones activas" }
      : overlay === "ubicacion"
      ? { value: fmtSp(charLocations?.length ?? 0), label: "Personajes situados" }
      : overlay === "poi"
      ? { value: fmtSp(POIS.filter((p) => geo?.nameIdx.get(p.name.toLowerCase())).length), label: "Lugares en el mapa" }
      : liveMap
      ? { value: fmtSp(liveMap.size), label: "Sistemas con datos" }
      : null;

  return (
    <>
      <div className="map-toolbar">
        <div className="route-controls">
          <button
            className={routeActive ? "active" : ""}
            onClick={() => {
              setRouteActive((v) => !v);
              setJumpActive(false);
              setRouteStops([null]);
            }}
          >
            {routeActive ? "Ruta: ON" : "Ruta"}
          </button>
          <button
            className={jumpActive ? "active" : ""}
            onClick={() => {
              setJumpActive((v) => !v);
              setRouteActive(false);
              setJumpOrigin(null);
            }}
          >
            {jumpActive ? "Salto: ON" : "Salto"}
          </button>
        </div>
      </div>

      {routeActive && (
        <div className="route-panel">
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
        <div className="route-panel">
          <div className="route-panel-head">
            <label className="muted small">
              Rango (LY):&nbsp;
              <input
                type="number"
                min={1}
                max={12}
                step={0.1}
                value={jumpRange}
                onChange={(e) => setJumpRange(Math.max(0, parseFloat(e.target.value) || 0))}
                style={{ width: "5rem" }}
              />
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
          <p className="muted small">
            Pon el rango de tu nave con tus skills (en LY). Resalta los low/null alcanzables en
            morado. También puedes hacer click en el mapa para fijar el origen.
          </p>
        </div>
      )}
      <p className="muted small">
        New Eden completo (líneas = stargates).
        {liveBusy && " · cargando datos en vivo…"}
      </p>
      <div className="map-wrap">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${MAP_W} ${MAP_H}`}
          className={`eve-map ${hover ? "over-sys" : ""}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => {
            onPointerUp();
            setHover(null);
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
            {/* overlay Incursiones (memorizado) */}
            {incursionCircles}
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
              <div className="sys-panel">
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
              </div>
            );
          })()}

        {/* Panel de contexto de la capa activa (derecha, estilo mapa oficial) */}
        <div className="map-context">
          <div className="mc-title">
            <span className="mc-icon">{activeOverlay.icon}</span>
            {activeOverlay.label}
          </div>
          <p className="mc-desc">{legend}</p>
          <div className="mc-kpis">
            <div className="mc-kpi">
              <span>{fmtSp(pvp.length)}</span>
              <label>Sistemas (tu PvP)</label>
            </div>
            <div className="mc-kpi">
              <span>{fmtSp(totalKills)}</span>
              <label>Kills</label>
            </div>
            <div className="mc-kpi">
              <span>{fmtSp(totalLosses)}</span>
              <label>Losses</label>
            </div>
            {ctxKpi && (
              <div className="mc-kpi">
                <span>{ctxKpi.value}</span>
                <label>{ctxKpi.label}</label>
              </div>
            )}
          </div>
        </div>

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

        {/* Barra de filtros de capas (abajo-centro) */}
        <div className="map-filterbar">
          {OVERLAYS.map((o) => (
            <button
              key={o.key}
              className={`mfb-btn ${overlay === o.key ? "active" : ""} ${o.group === "tuyo" ? "mine" : ""}`}
              onClick={() => onOverlayChange(o.key)}
              title={o.label}
            >
              <span className="mfb-icon">{o.icon}</span>
              <span className="mfb-label">{o.short}</span>
            </button>
          ))}
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

function AssetsView(props: { data: AssetsSummary | null; detail: AssetDetail[] | null; busy: boolean }) {
  const { data, detail, busy } = props;
  const [q, setQ] = useState("");
  const [cat, setCat] = useState(""); // "" = Todos
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 }>({ col: "qty", dir: -1 });
  const onSort = (col: string) =>
    setSort((s) => (s.col === col ? { col, dir: s.dir === 1 ? -1 : 1 } : { col, dir: 1 }));
  const ql = q.trim().toLowerCase();
  const catList = Array.from(new Set((detail ?? []).map((r) => r.category))).sort();
  const filtered = (detail ?? []).filter(
    (r) =>
      (cat === "" || r.category === cat) &&
      (ql === "" ||
        (r.type_name ?? "").toLowerCase().includes(ql) ||
        (r.system_name ?? "").toLowerCase().includes(ql))
  );
  const sorted = [...filtered].sort((a, b) => {
    const d = sort.dir;
    if (sort.col === "qty") return (a.quantity - b.quantity) * d;
    const av = sort.col === "name" ? a.type_name ?? "" : a.system_name ?? "";
    const bv = sort.col === "name" ? b.type_name ?? "" : b.system_name ?? "";
    return av.localeCompare(bv) * d;
  });
  const shown = sorted.slice(0, 300);
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
          <div className="asset-search">
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por item o sistema…"
            />
            {detail && (
              <span className="muted small">
                {filtered.length === detail.length
                  ? `${detail.length} entradas`
                  : `${filtered.length} de ${detail.length}`}
              </span>
            )}
          </div>
          {!detail ? (
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
