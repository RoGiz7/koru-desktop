// Estado y efectos propios de la capa de Intel en vivo, encapsulados en un hook. NO gestiona la
// selección compartida del mapa (`selected`/`intelDetail`) ni `openIntelDetail`, que se quedan en
// MapView; este hook los RECIBE. Cubre: ficha de detalle (entidades), panel de config, alertas
// (banner + sonido, escuchando el evento "intel-alert" del hilo de Rust), arranque/parada del
// watcher, envío del grafo a Rust y registro de avistamientos (hostiles habituales).
// Los efectos se movieron VERBATIM desde map.tsx con sus mismas dependencias → comportamiento igual.
import { useState, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { tr } from "./i18n";
import { ensureNotifPerm, playAlertChoice, loadCustomSound } from "./sound";
import { classifyIntel } from "./intel";
import type { IntelRep, IntelFeedRow } from "./intel";
import type { Geo } from "./mapOverlays";
import type { MapOverlay } from "./constants";
import type { IntelConfig, NewEden } from "./types";

export type IntelDetail = {
  sysId: number | null;
  sysName: string | null;
  ts: number;
  author: string;
  message: string;
} | null;

type IntelReports = { rep: Map<number, IntelRep>; feed: IntelFeedRow[] } | null;

export function useIntel({
  geo,
  ne,
  intel,
  overlay,
  intelDetail,
  shipNames,
  intelReports,
  intelOrigins,
}: {
  geo: Geo | null;
  ne: NewEden | null;
  intel?: IntelConfig;
  overlay: MapOverlay;
  intelDetail: IntelDetail;
  shipNames: Map<string, number>;
  intelReports: IntelReports;
  intelOrigins: number[];
}) {
  const [intelEntities, setIntelEntities] = useState<{
    characters: { id: number; name: string }[];
    ships: { id: number; name: string }[];
  } | null>(null);
  const [intelEntLoading, setIntelEntLoading] = useState(false);
  const [intelTrackPilot, setIntelTrackPilot] = useState<string | null>(null);
  const [chanOpen, setChanOpen] = useState(false);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [anchorInput, setAnchorInput] = useState("");
  const [intelAlert, setIntelAlert] = useState<{
    text: string;
    report: { sysId: number; sysName: string; ts: number; author: string; message: string };
  } | null>(null);

  // Nº de hostiles del reporte abierto (del +N o, si no, de los pilotos listados) → flota vs solo.
  const intelDetailCount = useMemo(() => {
    if (!intelDetail || !geo) return null;
    const p = classifyIntel(intelDetail.message, geo.nameIdx, shipNames);
    return p.count ?? (p.pilots.length || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intelDetail, shipNames]);

  // Abrir la config automáticamente si la capa intel está activa y aún no hay canales elegidos.
  // Y pedir permiso de notificación al entrar (para que el SO pregunte en buen momento).
  useEffect(() => {
    if (overlay === "intel" && intel) {
      if (intel.channels.length === 0) setCfgOpen(true);
      void ensureNotifPerm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay]);

  // Resuelve entidades al abrir la tarjeta. Naves = clasificación LOCAL (SDE), pilotos = ESI
  // solo sobre los candidatos limpios (sin naves ni jerga) → ya no salen Eris/ansi/near como pilotos.
  useEffect(() => {
    if (!intelDetail || !geo) return;
    const p = classifyIntel(intelDetail.message, geo.nameIdx, shipNames);
    // naves locales, deduplicadas por type_id
    const shipMap = new Map<number, string>();
    for (const s of p.ships) shipMap.set(s.id, s.name);
    const ships = [...shipMap].map(([id, name]) => ({ id, name }));
    const pilots = [...new Set(p.pilots)];
    if (pilots.length === 0) {
      setIntelEntities({ characters: [], ships });
      return;
    }
    setIntelEntLoading(true);
    invoke<{ characters: { id: number; name: string }[] }>("resolve_intel_entities", {
      names: pilots,
    })
      .then((e) => setIntelEntities({ characters: e.characters, ships }))
      .catch(() => setIntelEntities({ characters: [], ships }))
      .finally(() => setIntelEntLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intelDetail, shipNames]);

  // --- Intel: aprender "hostiles habituales" ---
  // Cada línea NUEVA aporta sus pilotos al índice (seen_count++ en backend). Dedup por clave de
  // línea (ts+autor+msg) para no recontar la misma línea en cada poll. El backend auto-resuelve por
  // ESI a quien cruce el umbral (cazador habitual que no está en Rivales/killmails).
  const intelSightedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!intelReports) return;
    const fresh: {
      name: string;
      system_id: number | null;
      ts_ms: number;
      ship_type_id: number | null;
    }[] = [];
    for (const f of intelReports.feed) {
      if (!f.pilots || f.pilots.length === 0) continue;
      const key = `${f.ts}|${f.author}|${f.message}`;
      if (intelSightedRef.current.has(key)) continue;
      intelSightedRef.current.add(key);
      // Solo atribuimos nave si la línea tiene UN único piloto (si no, no se sabe de quién es).
      const shipId = f.pilots.length === 1 && f.ships.length >= 1 ? f.ships[0].id : null;
      for (const name of f.pilots)
        fresh.push({ name, system_id: f.sysId, ts_ms: f.ts, ship_type_id: shipId });
    }
    if (fresh.length === 0) return;
    // Acotar el set para no crecer sin fin (las claves viejas caen fuera de recencia igualmente).
    if (intelSightedRef.current.size > 4000) {
      intelSightedRef.current = new Set(
        [...intelSightedRef.current].slice(-2000),
      );
    }
    invoke("intel_record_sightings", { sightings: fresh, threshold: 5 }).catch(
      () => {},
    );
  }, [intelReports]);

  // `clr/clear` = "olvídate de la alerta": si el sistema del banner deja de estar en los reportes
  // (alguien lo limpió), descartamos el aviso, no solo el círculo del mapa.
  useEffect(() => {
    if (!intelAlert || !intelReports) return;
    const sid = intelAlert.report.sysId;
    if (sid != null && !intelReports.rep.has(sid)) {
      setIntelAlert(null);
      intel?.onClearAlert?.();
    }
  }, [intelReports, intelAlert]);

  // Enviar el grafo (nombres↔id + aristas) a Rust una vez, en cuanto haya datos del mapa.
  useEffect(() => {
    if (!geo || !ne) return;
    const names: [string, number][] = [...geo.nameIdx.entries()].map(([n, s]) => [n, s.id]);
    const edges: [number, number][] = ne.jumps as [number, number][];
    invoke("set_intel_graph", { names, edges }).catch(() => {});
  }, [geo, ne]);

  // Arrancar / reconfigurar / detener el vigilante de Rust según la capa y la config.
  useEffect(() => {
    // Corre si el interruptor "Intel en vivo" está ON, o si estás viendo la capa intel (back-compat).
    const shouldRun = !!intel && (intel.live || overlay === "intel");
    if (!shouldRun || !intel.folder || intel.channels.length === 0) {
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
      // Solo paramos al desmontar/recambiar si NO está el modo en vivo (si está ON, sigue corriendo).
      if (!intel?.live) invoke("stop_intel_watch").catch(() => {});
    };
  }, [overlay, intel?.live, intel?.folder, intel?.channels, intel?.recency, intel?.alertJumps, intelOrigins]);

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
      const text = `⚠ ${tr("Intel a")} ${a.jumps} ${tr("salto(s)")}: ${a.system} — ${a.author}`;
      setIntelAlert({
        text,
        report: { sysId: a.sys_id, sysName: a.system, ts: a.ts_ms, author: a.author, message: a.message },
      });
      intel?.onIntelAlert?.(text); // toast global (visible en cualquier sección)
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

  return {
    intelEntities,
    setIntelEntities,
    intelEntLoading,
    intelTrackPilot,
    setIntelTrackPilot,
    chanOpen,
    setChanOpen,
    cfgOpen,
    setCfgOpen,
    anchorInput,
    setAnchorInput,
    intelDetailCount,
    intelAlert,
    setIntelAlert,
  };
}
