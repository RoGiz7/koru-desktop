// RUNS cronometradas (sesión + cronómetro + loot valorado + resultado), la capa DETALLADA que
// el asset-diff no puede dar: ISK/hora por tier/clima, tasa de muerte y P&L honesto (loot − naves
// perdidas). Mismo patrón que la exploración. Backend: activity_runs / run_* commands (filtrados por
// `activity`). Sirve a DOS actividades con la prop `activity`: "abyssal" (filamentos 6×5, cuenta atrás
// de 20 min) y "crab" (beacon CONCORD Rogue Analysis 60244 / variante Carrier 92183; sin clima ni tope).
// Diseño: documentacion/koru-desktop-ABYSSAL_CRAB_RUNS_diseno.md. RoGiz7, 2026-07-24 (CRAB 2026-07-28).
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { fmtIsk, typeIcon } from "./format";
import { fmtDuration } from "./signaturesControl";
import { LootPasteModal } from "./lootPasteModal";
import { buildLootIndex, parseIskShorthand, type LootIndex } from "./lootPaste";
import type { ActivityRun, RunChar } from "./types";

/** Filamentos abisales: 6 tiers × 5 climas → typeID real (icono + identidad). Verificados contra el
 *  catálogo de mercado. El tope del abismo son 20 min. */
const TIERS: { t: string; n: string }[] = [
  { t: "Calm", n: "T1" },
  { t: "Agitated", n: "T2" },
  { t: "Fierce", n: "T3" },
  { t: "Raging", n: "T4" },
  { t: "Chaotic", n: "T5" },
  { t: "Cataclysmic", n: "T6" },
];
const WEATHERS = ["Dark", "Electrical", "Exotic", "Firestorm", "Gamma"];
// Colores canónicos de los climas abisales del juego (para teñir la caja de sesión y las pestañas).
const WEATHER_COLORS: Record<string, string> = {
  Dark: "#8b5cf6", // violeta
  Electrical: "#38bdf8", // azul
  Exotic: "#34d399", // verde
  Firestorm: "#fb7185", // rojo/coral
  Gamma: "#fbbf24", // dorado
};
const weatherColor = (w?: string | null): string => (w && WEATHER_COLORS[w]) || "#4f9cff";
// Color por resultado de la run (verde/rojo/gris), para virar la caja al terminar y lavar las filas.
const outcomeColor = (o?: string | null): string =>
  o === "done" ? "#34d399" : o === "died" ? "#ff6b6b" : "#8b949e";
const FILAMENTS: Record<string, Record<string, number>> = {
  Calm: { Dark: 47762, Electrical: 47765, Exotic: 47761, Firestorm: 47763, Gamma: 47764 },
  Agitated: { Dark: 47892, Electrical: 47904, Exotic: 47888, Firestorm: 47896, Gamma: 47900 },
  Fierce: { Dark: 47893, Electrical: 47905, Exotic: 47889, Firestorm: 47897, Gamma: 47901 },
  Raging: { Dark: 47894, Electrical: 47906, Exotic: 47890, Firestorm: 47898, Gamma: 47902 },
  Chaotic: { Dark: 47895, Electrical: 47907, Exotic: 47891, Firestorm: 47899, Gamma: 47903 },
  Cataclysmic: { Dark: 56140, Electrical: 56139, Exotic: 56141, Firestorm: 56142, Gamma: 56143 },
};
const ABYSS_LIMIT_MS = 20 * 60 * 1000;

/** Beacons CRAB (CONCORD Rogue Analysis Beacon): estándar + variante Carrier. Sin tier/clima.
 *  Nombres verificados contra public/market_types.json. */
const CRAB_BEACONS: { id: number; name: string }[] = [
  { id: 60244, name: "CONCORD Rogue Analysis Beacon" },
  { id: 92183, name: "CONCORD-Carrier Rogue Analysis Beacon" },
];

/** Catálogo de naves (public/ships.json) para la nave OPCIONAL de la run (P&L por nave). */
type ShipEntry = { i: number; n: string; g: string };

// Filtro de tiempo del histórico (ventana rodante), igual que en Exploración.
const PERIODS: { key: string; label: string; ms: number }[] = [
  { key: "day", label: "Día", ms: 24 * 3600e3 },
  { key: "week", label: "Semana", ms: 7 * 24 * 3600e3 },
  { key: "month", label: "Mes", ms: 30 * 24 * 3600e3 },
  { key: "year", label: "Año", ms: 365 * 24 * 3600e3 },
  { key: "all", label: "Todo", ms: 0 },
];

/** Participantes EFECTIVOS de una run. Es el espejo exacto de la CTE `part` del SQL: si la run
 *  tiene `chars` manda esa lista; si no, se sintetiza un participante con los datos de la propia
 *  run. Así el histórico de siempre sigue contando igual sin haber migrado ni una fila, y los
 *  desenlaces viejos se traducen solos (`died`→`dead`, `aborted`→`bail`). */
function partsOf(r: ActivityRun): RunChar[] {
  if (r.chars?.length) return r.chars;
  return [
    {
      character_id: r.character_id ?? 0,
      outcome: r.outcome === "died" ? "dead" : r.outcome === "aborted" ? "bail" : "ok",
      ship_type_id: r.ship_type_id,
      lost_value: r.ship_loss_isk ?? 0,
    },
  ];
}

/** Iconografía EVE primero (regla de la casa): nada de emoji donde hay un ítem que lo diga mejor.
 *  · 670 Capsule — en EVE la cápsula ES el piloto, así que representa «quién vuela» mejor que 👥.
 *  · 12237 Ship Maintenance Array — el hangar donde viven tus naves, para «las que más usas».
 *  Los dos verificados como publicados en el SDE 3448696. */
const TID_CAPSULE = 670;
const TID_SHIP_BAY = 12237;

function fmtMMSS(ms: number): string {
  const neg = ms < 0;
  const s = Math.floor(Math.abs(ms) / 1000);
  return `${neg ? "-" : ""}${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function AbyssalRunsView({
  charId,
  activity = "abyssal",
}: {
  charId?: number | null;
  activity?: "abyssal" | "crab";
}) {
  const isCrab = activity === "crab";
  const [active, setActive] = useState<ActivityRun | null>(null);
  const [runs, setRuns] = useState<ActivityRun[]>([]);
  const [tier, setTier] = useState("Raging");
  const [weather, setWeather] = useState("Gamma");
  const [beacon, setBeacon] = useState(CRAB_BEACONS[0].id); // beacon elegido (solo CRAB)
  // Nave OPCIONAL con la que corres (datalist de ships.json → typeID). Recomendación 8.3: no bloquea.
  const [ships, setShips] = useState<ShipEntry[]>([]);
  const [shipName, setShipName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  // Fin de run: resultado elegido + botín + nave perdida (si muerte).
  const [finishing, setFinishing] = useState<null | "done" | "died" | "aborted">(null);
  const [finLoot, setFinLoot] = useState("");
  const [finShipLoss, setFinShipLoss] = useState("");
  const [lootOpen, setLootOpen] = useState(false);
  // A dónde va el botín pegado: "finish" (panel de terminar) o el id de una fila en edición.
  const [lootTarget, setLootTarget] = useState<"finish" | number>("finish");
  const [lootIndex, setLootIndex] = useState<LootIndex>(new Map());
  // Edición en línea de una run ya cerrada (corregir botín / nave olvidados) vía run_set.
  const [editId, setEditId] = useState<number | null>(null);
  const [editLoot, setEditLoot] = useState("");
  const [editShip, setEditShip] = useState("");
  /** Coste de entrada en edición: en blanco en las runs viejas, para que lo rellenes si quieres. */
  const [editEntry, setEditEntry] = useState("");
  const [now, setNow] = useState(Date.now());
  const [period, setPeriod] = useState<string>("all"); // filtro de tiempo del histórico
  const [filTab, setFilTab] = useState<string>("all"); // pestaña por filamento ("all" = todos)
  // MULTIBOX: tus personajes, y los que van a correr ESTA run. Vacío = run de un solo piloto.
  const [chars, setChars] = useState<{ character_id: number; name: string }[]>([]);
  const [crew, setCrew] = useState<number[]>([]);
  /** Quién LANZA la run. No es un detalle estético: en CRAB es quien enlaza la baliza y el único
   *  que puede tocar la bodega del botín durante los dos primeros minutos. Se ancla a la run
   *  (`character_id`) y los demás van como participantes. */
  const [launcher, setLauncher] = useState<number | null>(null);
  const launcherId = launcher ?? charId ?? null;
  /** Precio de mercado del filamento/baliza elegido, para estimar el coste de entrada. */
  const [variantPrice, setVariantPrice] = useState<number | null>(null);
  // Desenlace por participante al cerrar: character_id → { outcome, lost }.
  const [crewEnd, setCrewEnd] = useState<Map<number, { outcome: string; lost: string }>>(new Map());
  const charName = (id: number) => chars.find((c) => c.character_id === id)?.name ?? `#${id}`;

  // Reloj para el cronómetro en vivo (1 s).
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    buildLootIndex().then(setLootIndex);
    fetch("/ships.json")
      .then((r) => r.json())
      .then(setShips)
      .catch(() => {});
    invoke<{ character_id: number; name: string }[]>("list_characters")
      .then(setChars)
      .catch(() => setChars([]));
  }, []);

  async function reload() {
    try {
      const [a, list] = await Promise.all([
        invoke<ActivityRun | null>("run_active", { activity, characterId: charId ?? null }),
        invoke<ActivityRun[]>("run_list", { activity }),
      ]);
      setActive(a ?? null);
      // Filtro por personaje: cuenta también a los PARTICIPANTES, no solo a quien registró la run.
      // Con multibox son cosas distintas — si SieteHierros registra una run que voló kukumiku, a
      // kukumiku tiene que aparecerle: su P&L y sus bajas están ahí dentro.
      setRuns(
        charId == null
          ? list
          : list.filter(
              (r) =>
                r.character_id === charId ||
                r.character_id == null ||
                r.chars?.some((c) => c.character_id === charId),
            ),
      );
    } catch (e) {
      setMsg(`${tr("Error")}: ${String(e).slice(0, 160)}`);
    }
  }
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charId, activity]);

  // Variante a iniciar: filamento (tier+clima) en abisales; beacon en CRAB.
  const crabBeacon = CRAB_BEACONS.find((b) => b.id === beacon) ?? CRAB_BEACONS[0];
  const filamentId = isCrab ? crabBeacon.id : FILAMENTS[tier]?.[weather];
  // Nave elegida (match exacto, sin distinguir mayúsculas). Vacío o sin match = null (opcional).
  const shipMatch = useMemo(() => {
    const q = shipName.trim().toLowerCase();
    return q ? (ships.find((s) => s.n.toLowerCase() === q) ?? null) : null;
  }, [ships, shipName]);

  // Precio del filamento/baliza elegido (mercado local, sin red).
  useEffect(() => {
    if (!filamentId) return;
    invoke<Record<number, number>>("get_type_prices", { ids: [filamentId] })
      .then((r) => setVariantPrice(r[filamentId] ?? null))
      .catch(() => setVariantPrice(null));
  }, [filamentId]);

  /** UNA entrada por run en las dos actividades: una baliza en CRAB, un filamento en abisales —
   *  también en el cooperativo, donde entran hasta 3 fragatas o 2 destructores con un solo
   *  filamento del que activa (confirmado por RoGiz7, que corre el contenido).
   *
   *  Ojo si alguien lo revisa: el artículo de soporte dice «es necesario que haya FILAMENTOS del
   *  mismo tipo y nivel en la bodega del capsulista que activa», en plural, y eso me hizo pensar
   *  que se gastaba uno por piloto. No es así. Como el coste es editable, si algún día se
   *  demuestra lo contrario se corrige en la propia run sin tocar código. */
  const entryCost = variantPrice;

  async function startRun() {
    if (!filamentId) return;
    setBusy(true);
    setMsg("");
    try {
      const id = await invoke<number>("run_start", {
        activity,
        variantId: filamentId,
        variantName: isCrab ? crabBeacon.name : `${tier} ${weather} Filament`,
        tier: isCrab ? null : tier,
        weather: isCrab ? null : weather,
        systemId: null,
        systemName: "",
        shipTypeId: shipMatch?.i ?? null,
        // La run se ANCLA a quien la lanza: en CRAB es quien enlaza la baliza y el único que puede
        // tocar la bodega del botín al principio, así que no es un participante más.
        characterId: launcherId,
        // Coste de entrada estimado a mercado y CONGELADO aquí: una baliza o un filamento, a
        // cuenta de quien lanza. Congelarlo evita que el P&L del pasado cambie con el mercado.
        entryCost: entryCost,
      });
      // Solo se escriben participantes si de verdad hay varios: con uno, la run se queda
      // exactamente como siempre y no se crea una fila hija que no aporta nada.
      const todos = [...new Set([...(launcherId != null ? [launcherId] : []), ...crew])];
      if (todos.length > 1) {
        await invoke("run_chars_set", {
          runId: id,
          chars: todos.map((cid) => ({
            character_id: cid,
            outcome: "ok",
            ship_type_id: cid === launcherId ? (shipMatch?.i ?? null) : null,
            lost_value: 0,
          })),
        });
      }
      await reload();
    } catch (e) {
      setMsg(`${tr("Error")}: ${String(e).slice(0, 160)}`);
    } finally {
      setBusy(false);
    }
  }

  async function endRun() {
    if (!active || !finishing) return;
    setBusy(true);
    setMsg("");
    try {
      // Multibox: primero el desenlace de cada piloto. El de la run sigue existiendo y resume el
      // conjunto («murió alguien» = died), para que las vistas de siempre no cambien de sentido.
      if (active.chars?.length) {
        await invoke("run_chars_set", {
          runId: active.id,
          chars: active.chars.map((c) => {
            const e = crewEnd.get(c.character_id);
            return {
              character_id: c.character_id,
              outcome: e?.outcome ?? "ok",
              ship_type_id: c.ship_type_id,
              lost_value: e?.outcome === "dead" ? (parseIskShorthand(e.lost ?? "") ?? 0) : 0,
            };
          }),
        });
      }
      await invoke("run_end", {
        id: active.id,
        outcome: finishing,
        lootIsk: finishing === "aborted" ? null : parseIskShorthand(finLoot),
        lootNote: null,
        shipLossIsk: finishing === "died" ? parseIskShorthand(finShipLoss) : null,
        note: null,
      });
      setFinishing(null);
      setFinLoot("");
      setFinShipLoss("");
      setCrewEnd(new Map());
      await reload();
    } catch (e) {
      setMsg(`${tr("Error")}: ${String(e).slice(0, 160)}`);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(r: ActivityRun) {
    setEditId(r.id);
    setEditLoot(r.loot_isk != null ? String(r.loot_isk) : "");
    setEditShip(r.ship_loss_isk != null ? String(r.ship_loss_isk) : "");
    setEditEntry(r.entry_cost != null ? String(r.entry_cost) : "");
  }
  async function saveEdit(r: ActivityRun) {
    setBusy(true);
    setMsg("");
    try {
      await invoke("run_set", {
        id: r.id,
        lootIsk: parseIskShorthand(editLoot),
        lootNote: null,
        shipLossIsk: r.outcome === "died" ? parseIskShorthand(editShip) : (r.ship_loss_isk ?? null),
        note: null,
        entryCost: parseIskShorthand(editEntry),
      });
      setEditId(null);
      await reload();
    } catch (e) {
      setMsg(`${tr("Error")}: ${String(e).slice(0, 160)}`);
    } finally {
      setBusy(false);
    }
  }

  // Ventana de tiempo elegida (día/semana/mes/año/todo), sobre la fecha de fin (o inicio si sigue abierta).
  const periodMs = PERIODS.find((p) => p.key === period)?.ms ?? 0;
  const periodRows = useMemo(
    () => (periodMs === 0 ? runs : runs.filter((r) => now - new Date(r.ended_at ?? r.started_at).getTime() <= periodMs)),
    [runs, periodMs, now],
  );
  // Pestañas por variante presentes en la ventana: tier+clima (abisales) o nombre del beacon (CRAB).
  const filTabs = useMemo(() => {
    const m = new Map<string, { label: string; variantId: number | null; weather: string | null; n: number }>();
    for (const r of periodRows) {
      const key = r.tier || r.weather ? `${r.tier ?? "?"} ${r.weather ?? ""}`.trim() : r.variant_name || "?";
      const e = m.get(key) ?? { label: r.variant_name || key, variantId: r.variant_id, weather: r.weather, n: 0 };
      e.n += 1;
      m.set(key, e);
    }
    return [...m.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.n - a.n);
  }, [periodRows]);
  const filKey = (r: ActivityRun) =>
    r.tier || r.weather ? `${r.tier ?? "?"} ${r.weather ?? ""}`.trim() : r.variant_name || "?";
  const viewRows = useMemo(
    () => (filTab === "all" ? periodRows : periodRows.filter((r) => filKey(r) === filTab)),
    [periodRows, filTab],
  );

  // Estadísticas de las runs finalizadas (no abortadas): P&L honesto y tasa de muerte.
  const stats = useMemo(() => {
    let n = 0,
      deaths = 0,
      loot = 0,
      shipLoss = 0,
      ms = 0;
    for (const r of viewRows) {
      if (r.outcome === "aborted") continue;
      n += 1;
      if (r.outcome === "died") deaths += 1;
      loot += r.loot_isk ?? 0;
      // Naves perdidas de TODOS los participantes + lo que costó entrar (filamento/baliza).
      shipLoss += (r.chars?.length ? r.chars.reduce((a, c) => a + c.lost_value, 0) : (r.ship_loss_isk ?? 0)) + (r.entry_cost ?? 0);
      const d = r.ended_at ? new Date(r.ended_at).getTime() - new Date(r.started_at).getTime() : 0;
      if (d > 0) ms += d;
    }
    const net = loot - shipLoss;
    const hours = ms / 3_600_000;
    return { n, deaths, loot, shipLoss, net, hours, iskPerHour: hours > 0 ? net / hours : 0 };
  }, [viewRows]);

  /** P&L POR PILOTO (multibox). Botín a partes iguales entre los participantes; la nave perdida
   *  es de quien la perdió. El ISK/hora usa la MISMA duración de la run para todos: los 20 minutos
   *  los vivieron los tres, así que repartir el tiempo inflaría el individual por N — justo el
   *  error que esta tabla viene a arreglar. */
  const byPilot = useMemo(() => {
    const m = new Map<
      number,
      { runs: number; deaths: number; loot: number; lost: number; hours: number }
    >();
    for (const r of viewRows) {
      if (r.outcome === "aborted") continue;
      const ps = partsOf(r);
      const dur = r.ended_at
        ? (new Date(r.ended_at).getTime() - new Date(r.started_at).getTime()) / 3_600_000
        : 0;
      const share = (r.loot_isk ?? 0) / ps.length;
      for (const p of ps) {
        const e = m.get(p.character_id) ?? { runs: 0, deaths: 0, loot: 0, lost: 0, hours: 0 };
        e.runs += 1;
        if (p.outcome === "dead") e.deaths += 1;
        e.loot += share;
        // Su nave perdida, y el coste de entrada SOLO a quien lanzó: los filamentos y la baliza
        // salen de su bodega, así que es su gasto, no del grupo.
        e.lost += p.lost_value + (p.character_id === r.character_id ? (r.entry_cost ?? 0) : 0);
        e.hours += Math.max(0, dur);
        m.set(p.character_id, e);
      }
    }
    return [...m.entries()]
      .map(([id, e]) => ({ id, ...e, net: e.loot - e.lost, iskH: e.hours > 0 ? (e.loot - e.lost) / e.hours : 0 }))
      .sort((a, b) => b.net - a.net);
  }, [viewRows]);

  /** Las DOS métricas de bajas, que responden preguntas distintas y por eso no se promedian:
   *  «runs con bajas» = riesgo de la ACTIVIDAD · «bajas por piloto» = quién es el más débil.
   *  Con un solo participante las dos coinciden y la vista se queda como siempre. */
  const runsConBajas = useMemo(() => {
    let n = 0;
    let con = 0;
    for (const r of viewRows) {
      if (r.outcome === "aborted") continue;
      n += 1;
      if (partsOf(r).some((p) => p.outcome === "dead")) con += 1;
    }
    return { n, con, pct: n > 0 ? (100 * con) / n : 0 };
  }, [viewRows]);

  /** ¿Hay alguna run con más de un piloto en la vista? Si no, la complejidad no se enseña. */
  const hayMultibox = useMemo(() => viewRows.some((r) => (r.chars?.length ?? 0) > 1), [viewRows]);

  /** Tus naves MÁS USADAS, deducidas de tu propio histórico. No hay que configurar favoritas:
   *  las favoritas son las que ya usas, y eso Koru lo sabe sin preguntar. */
  const topShips = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of runs) {
      for (const p of partsOf(r)) if (p.ship_type_id) m.set(p.ship_type_id, (m.get(p.ship_type_id) ?? 0) + 1);
      if (r.ship_type_id && !r.chars?.length) m.set(r.ship_type_id, (m.get(r.ship_type_id) ?? 0) + 0); // ya contado por partsOf
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [runs]);

  /** Las naves que TIENES de verdad, cruzando tus assets con el catálogo de naves. Sirve para no
   *  ofrecerte a ciegas un casco que no está en ningún hangar tuyo. */
  const [ownedShips, setOwnedShips] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (ships.length === 0) return;
    const p =
      charId == null
        ? invoke<{ type_id: number }[]>("get_assets_detail_global")
        : invoke<{ type_id: number }[]>("get_assets_detail", { characterId: charId });
    p.then((rows) => {
      const shipIds = new Set(ships.map((s) => s.i));
      setOwnedShips(new Set(rows.map((r) => r.type_id).filter((t) => shipIds.has(t))));
    }).catch(() => setOwnedShips(new Set()));
  }, [charId, ships]);

  // P&L POR NAVE (sobre la vista filtrada): ahora que la nave se registra, responde «¿con qué nave
  // gano más por hora y muero menos?». Solo runs con nave anotada (las sin nave no entran aquí).
  const shipStats = useMemo(() => {
    const m = new Map<number, { n: number; deaths: number; loot: number; shipLoss: number; ms: number }>();
    for (const r of viewRows) {
      if (r.outcome === "aborted" || r.ship_type_id == null) continue;
      const e = m.get(r.ship_type_id) ?? { n: 0, deaths: 0, loot: 0, shipLoss: 0, ms: 0 };
      e.n += 1;
      if (r.outcome === "died") e.deaths += 1;
      e.loot += r.loot_isk ?? 0;
      // Mismos costes que los KPIs y que «Por piloto»: naves perdidas de TODOS los participantes
      // + el coste de entrada. Sin esto, esta tabla decía 0 donde las otras dos decían −68M, y una
      // cifra que se contradice con la de al lado es peor que no darla.
      e.shipLoss +=
        (r.chars?.length ? r.chars.reduce((a, c) => a + c.lost_value, 0) : (r.ship_loss_isk ?? 0)) +
        (r.entry_cost ?? 0);
      const d = r.ended_at ? new Date(r.ended_at).getTime() - new Date(r.started_at).getTime() : 0;
      if (d > 0) e.ms += d;
      m.set(r.ship_type_id, e);
    }
    return [...m.entries()]
      .map(([tid, v]) => ({
        tid,
        ...v,
        net: v.loot - v.shipLoss,
        iskH: v.ms > 0 ? (v.loot - v.shipLoss) / (v.ms / 3_600_000) : 0,
      }))
      .sort((a, b) => b.net - a.net);
  }, [viewRows]);
  const shipNameOf = (tid: number) => ships.find((s) => s.i === tid)?.n ?? `#${tid}`;

  const elapsed = active ? now - new Date(active.started_at).getTime() : 0;
  const remaining = ABYSS_LIMIT_MS - elapsed; // solo abisales (tope duro de 20 min; CRAB no tiene)
  // La caja en curso se tiñe por el clima del filamento (CRAB: azul CONCORD por defecto);
  // al elegir resultado vira a verde/rojo/gris.
  const activeCol = finishing ? outcomeColor(finishing) : weatherColor(active?.weather);
  const startCol = isCrab ? weatherColor(null) : weatherColor(weather);

  return (
    <div className="abyss-runs">
      <h4 style={{ marginBottom: 4 }}>⏱️ {tr("Runs cronometradas")}</h4>

      {/* ---- Sesión: iniciar o en curso ---- */}
      {active ? (
        <div
          className="abyss-active"
          style={{ background: `linear-gradient(90deg, ${activeCol}26, transparent 70%)`, borderColor: `${activeCol}88` }}
        >
          {active.variant_id && (
            <img className="kind-glyph" src={typeIcon(active.variant_id, 32)} alt="" style={{ width: 22, height: 22 }} />
          )}
          <strong>{active.variant_name}</strong>
          {active.ship_type_id && (
            <img className="kind-glyph" src={typeIcon(active.ship_type_id, 32)} alt="" title={tr("Nave de la run")} style={{ width: 20, height: 20, borderRadius: 3 }} />
          )}
          <span className="abyss-timer">{fmtMMSS(elapsed)}</span>
          {!isCrab && (
            <span className={`abyss-count small${remaining < 2 * 60 * 1000 ? " danger" : ""}`}>
              {remaining >= 0 ? `${tr("quedan")} ${fmtMMSS(remaining)}` : `${tr("pasado")} ${fmtMMSS(remaining)}`}
            </span>
          )}
          {finishing == null ? (
            <span className="abyss-end-btns">
              <button className="pp-add" onClick={() => setFinishing("done")}>✓ {tr("Completada")}</button>
              <button className="pp-add sig-del-btn" onClick={() => setFinishing("died")}>💀 {tr("Muerto")}</button>
              <button className="pp-add" onClick={() => setFinishing("aborted")} disabled={busy}>✕ {tr("Abortada")}</button>
            </span>
          ) : finishing === "aborted" ? (
            <span className="abyss-end-btns">
              <button className="pp-add" onClick={endRun} disabled={busy}>{tr("Confirmar abortar")}</button>
              <button className="pp-add" onClick={() => setFinishing(null)} disabled={busy}>{tr("Cancelar")}</button>
            </span>
          ) : (
            <span className="abyss-finish">
              <span className="small muted">{tr("Botín")}:</span>
              <input className="small" value={finLoot} onChange={(e) => setFinLoot(e.target.value)} placeholder={tr("ISK (p.ej. 45m)")} style={{ width: 100 }} />
              <button className="pp-add" onClick={() => { setLootTarget("finish"); setLootOpen(true); }}>📋 {tr("Pegar loot")}</button>
              {finishing === "died" && (
                <>
                  <span className="small muted">{tr("Nave perdida")}:</span>
                  <input className="small" value={finShipLoss} onChange={(e) => setFinShipLoss(e.target.value)} placeholder={tr("ISK")} style={{ width: 100 }} />
                </>
              )}
              <button className="pp-add" onClick={endRun} disabled={busy}>{tr("Guardar run")}</button>
              <button className="pp-add" onClick={() => setFinishing(null)} disabled={busy}>{tr("Cancelar")}</button>
            </span>
          )}
          {/* Desenlace POR PILOTO. Con multibox no todos corren la misma suerte, y guardarlo al
              grano fino es lo que permite después decir cuál es el más débil. Por defecto todos
              salen vivos, que es el caso normal: solo tocas al que le pasó algo. */}
          {finishing != null && finishing !== "aborted" && (active.chars?.length ?? 0) > 1 && (
            <div className="small" style={{ marginTop: "0.4rem" }}>
              {active.chars.map((c) => {
                const e = crewEnd.get(c.character_id) ?? { outcome: "ok", lost: "" };
                const set = (patch: Partial<{ outcome: string; lost: string }>) =>
                  setCrewEnd((prev) => new Map(prev).set(c.character_id, { ...e, ...patch }));
                return (
                  <div key={c.character_id} className="pp-row" style={{ gap: "0.4rem" }}>
                    <img
                      className="kind-glyph"
                      src={`https://images.evetech.net/characters/${c.character_id}/portrait?size=32`}
                      alt=""
                      style={{ borderRadius: "50%", width: 18, height: 18, verticalAlign: -4 }}
                    />
                    <span style={{ minWidth: "9rem" }}>{charName(c.character_id)}</span>
                    <select className="small" value={e.outcome} onChange={(ev) => set({ outcome: ev.target.value })}>
                      <option value="ok">✓ {tr("Salió vivo")}</option>
                      <option value="dead">💀 {tr("Murió")}</option>
                      <option value="bail">✕ {tr("Abortó")}</option>
                    </select>
                    {e.outcome === "dead" && (
                      <input
                        className="small"
                        value={e.lost}
                        onChange={(ev) => set({ lost: ev.target.value })}
                        placeholder={tr("Su nave (ISK)")}
                        style={{ width: 110 }}
                      />
                    )}
                  </div>
                );
              })}
              <p className="muted small" style={{ margin: "0.2rem 0 0" }}>
                {tr("La nave perdida se apunta a quien la perdió; el botín se reparte a partes iguales.")}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div
          className="abyss-active abyss-start"
          style={{ background: `linear-gradient(90deg, ${startCol}1c, transparent 70%)`, borderColor: `${startCol}66` }}
        >
          {isCrab ? (
            <select className="small" value={beacon} onChange={(e) => setBeacon(Number(e.target.value))}>
              {CRAB_BEACONS.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          ) : (
            <>
              <select className="small" value={tier} onChange={(e) => setTier(e.target.value)}>
                {TIERS.map((t) => (
                  <option key={t.t} value={t.t}>{t.n} · {t.t}</option>
                ))}
              </select>
              <select className="small" value={weather} onChange={(e) => setWeather(e.target.value)}>
                {WEATHERS.map((w) => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
            </>
          )}
          {filamentId && <img className="kind-glyph" src={typeIcon(filamentId, 32)} alt="" style={{ width: 22, height: 22 }} />}
          <input
            className="small"
            list="run-ships"
            value={shipName}
            onChange={(e) => setShipName(e.target.value)}
            placeholder={tr("Nave (opcional)")}
            style={{ width: 130 }}
          />
          <datalist id="run-ships">
            {/* Las que TIENES primero: si un casco está en tus hangares es muchísimo más probable
                que sea el que vas a volar. El resto sigue estando, solo que después. */}
            {[...ships]
              .sort((a, b) => Number(ownedShips.has(b.i)) - Number(ownedShips.has(a.i)))
              .map((s) => (
                <option key={s.i} value={s.n}>
                  {ownedShips.has(s.i) ? `✔ ${tr("la tienes")} · ${s.g}` : s.g}
                </option>
              ))}
          </datalist>
          {shipMatch && (
            <img className="kind-glyph" src={typeIcon(shipMatch.i, 32)} alt="" title={shipMatch.n} style={{ width: 22, height: 22 }} />
          )}
          {entryCost != null && (
            <span
              className="muted small"
              title={tr("Estimado a precio de mercado y congelado al iniciar. Editable después.")}
            >
              {tr("Entrada")}: {fmtIsk(entryCost)}
            </span>
          )}
          <button className="pp-add" onClick={startRun} disabled={busy || !filamentId}>▶ {tr("Iniciar run")}</button>
        </div>
      )}

      {/* Naves de acceso rápido: las que MÁS USAS, sacadas de tu propio histórico. No hay que
          marcar favoritas a mano — las favoritas son las que ya vuelas, y eso ya lo sabemos. */}
      {!active && topShips.length > 0 && (
        <div className="run-pickrow small">
          <span className="muted run-pickrow-label">
            <img className="run-ship" src={typeIcon(TID_SHIP_BAY, 32)} alt="" style={{ marginLeft: 0, marginRight: "0.3rem" }} />
            {tr("Las que más usas")}:
          </span>
          <span className="run-pickrow-items">
          {topShips.map(([tid, n]) => (
            <button
              key={tid}
              className={`pp-tag${shipMatch?.i === tid ? " on" : ""}`}
              title={`${shipNameOf(tid)} · ${n} ${tr("runs")}${ownedShips.has(tid) ? ` · ✔ ${tr("la tienes")}` : ""}`}
              onClick={() => setShipName(shipNameOf(tid))}
            >
              <img className="run-ship" src={typeIcon(tid, 32)} alt="" style={{ marginLeft: 0, marginRight: "0.25rem" }} />
              {shipNameOf(tid)}
              {!ownedShips.has(tid) && <span className="muted"> ·⚠</span>}
            </button>
          ))}
          </span>
        </div>
      )}

      {/* MULTIBOX — quién corre esta run. Solo se ofrece si tienes más de un personaje, y por
          defecto va solo el activo: quien no juegue con alts no ve nada nuevo.
          El tiempo NO se multiplica por participante: tres alts en una run de 20 minutos son 20
          minutos de reloj, y de ahí sale el ISK/hora honesto. */}
      {!active && chars.length > 1 && (
        <div className="run-pickrow small">
          <span className="muted run-pickrow-label">
            <img className="run-ship" src={typeIcon(TID_CAPSULE, 32)} alt="" style={{ marginLeft: 0, marginRight: "0.3rem" }} />
            {tr("¿Quién corre esta run?")}
          </span>
          <span className="run-pickrow-items">
          {chars.map((c) => {
            const isLauncher = c.character_id === launcherId;
            const on = isLauncher || crew.includes(c.character_id);
            return (
              <button
                key={c.character_id}
                className={`pp-tag${isLauncher ? " launcher" : on ? " on" : ""}`}
                title={
                  isLauncher
                    ? `${c.name} · ${tr("lanza la run")}`
                    : on
                      ? `${c.name} · ${tr("participa. Pulsa para que sea quien lanza")}`
                      : c.name
                }
                onClick={() => {
                  // Un clic hace lo que toca según el estado, sin menús: si no está, entra como
                  // participante; si ya participa, asciende a lanzador; si ya lanza, se sale.
                  if (isLauncher) {
                    setLauncher(null);
                    setCrew((p) => p.filter((x) => x !== c.character_id));
                  } else if (crew.includes(c.character_id)) {
                    setCrew((p) => [...p.filter((x) => x !== c.character_id), ...(launcherId != null ? [launcherId] : [])]);
                    setLauncher(c.character_id);
                  } else {
                    setCrew((p) => [...p, c.character_id]);
                    if (launcherId == null) setLauncher(c.character_id);
                  }
                }}
              >
                <img
                  className="kind-glyph"
                  src={`https://images.evetech.net/characters/${c.character_id}/portrait?size=32`}
                  alt=""
                  style={{ borderRadius: "50%", width: 16, height: 16, verticalAlign: -3, opacity: on ? 1 : 0.35 }}
                />{" "}
                {c.name}
              </button>
            );
          })}
          {crew.length > 1 ? (
            <span className="muted" style={{ lineHeight: "1.5rem" }}>
              · {crew.length} {tr("pilotos: el botín se repartirá a partes iguales")}
            </span>
          ) : (
            <span className="muted" style={{ lineHeight: "1.5rem" }}>
              · {tr("verde = lanza la run · azul = participa · pulsa uno azul para ascenderlo")}
            </span>
          )}
          </span>
        </div>
      )}

      {/* ---- Estadísticas + histórico de runs ---- */}
      {runs.length > 0 && (
        <>
          {/* Filtro de tiempo (ventana rodante). */}
          <div className="explog-periods">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                className={`explog-period${period === p.key ? " on" : ""}`}
                onClick={() => setPeriod(p.key)}
              >
                {tr(p.label)}
              </button>
            ))}
          </div>

          {/* Pestañas por filamento (tier+clima). */}
          <div className="sig-btabs">
            <button className={`sig-btab${filTab === "all" ? " on" : ""}`} onClick={() => setFilTab("all")}>
              {tr("Todos")} <span className="muted">({periodRows.length})</span>
            </button>
            {filTabs.map((f) => (
              <button
                key={f.key}
                className={`sig-btab${filTab === f.key ? " on" : ""}`}
                onClick={() => setFilTab(f.key)}
                style={{ borderLeft: `3px solid ${weatherColor(f.weather)}` }}
              >
                {f.variantId && <img className="kind-glyph" src={typeIcon(f.variantId, 32)} alt="" />} {f.label}{" "}
                <span className="muted">({f.n})</span>
              </button>
            ))}
          </div>

          <div className="explog-stats" style={{ marginTop: "0.6rem" }}>
            <div className="explog-stat">
              <div className="explog-stat-n">{stats.n}</div>
              <div className="explog-stat-l small muted">{tr("runs")}</div>
            </div>
            <div className="explog-stat">
              <div className="explog-stat-n">{fmtIsk(stats.net)}</div>
              <div className="explog-stat-l small muted">{tr("P&L neto (ISK)")}</div>
            </div>
            <div className="explog-stat">
              <div className="explog-stat-n">{fmtIsk(stats.iskPerHour)}</div>
              <div className="explog-stat-l small muted">{tr("ISK/hora neto")}</div>
            </div>
            <div className="explog-stat">
              <div className="explog-stat-n">{stats.n > 0 ? Math.round((stats.deaths / stats.n) * 100) : 0}%</div>
              <div className="explog-stat-l small muted">{tr("tasa de muerte")}</div>
            </div>
          </div>

          {/* P&L por nave (solo si hay runs con nave anotada en la vista actual). */}
          {shipStats.length > 0 && (
            <>
              <h4 style={{ margin: "0.6rem 0 0.2rem" }}>
                <img className="run-ship" src={typeIcon(TID_SHIP_BAY, 32)} alt="" style={{ marginLeft: 0, marginRight: "0.3rem" }} />
                {tr("Por nave")}
              </h4>
              <table className="small sig-table">
                <thead>
                  <tr className="sig-th">
                    <th>{tr("Nave")}</th>
                    <th style={{ textAlign: "right" }}>{tr("runs")}</th>
                    <th style={{ textAlign: "right" }}>{tr("tasa de muerte")}</th>
                    <th style={{ textAlign: "right" }}>{tr("P&L neto (ISK)")}</th>
                    <th style={{ textAlign: "right" }}>{tr("ISK/hora neto")}</th>
                  </tr>
                </thead>
                <tbody>
                  {shipStats.map((s) => (
                    <tr key={s.tid}>
                      <td className="cell-icon">
                        <img className="kind-glyph" src={typeIcon(s.tid, 32)} alt="" style={{ borderRadius: 3 }} />
                        {shipNameOf(s.tid)}
                      </td>
                      <td style={{ textAlign: "right" }}>{s.n}</td>
                      <td style={{ textAlign: "right" }} className={s.deaths > 0 ? "abyss-died" : ""}>
                        {Math.round((s.deaths / s.n) * 100)}%
                      </td>
                      <td style={{ textAlign: "right" }}>{fmtIsk(s.net)}</td>
                      <td style={{ textAlign: "right" }}>{fmtIsk(s.iskH)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {/* POR PILOTO — solo aparece si de verdad has corrido en multibox. Con un solo piloto
              esta tabla sería una copia de los KPIs de arriba, así que no se enseña. */}
          {hayMultibox && byPilot.length > 0 && (
            <>
              <h4 style={{ margin: "0.6rem 0 0.2rem" }}>
                <img className="run-ship" src={typeIcon(TID_CAPSULE, 32)} alt="" style={{ marginLeft: 0, marginRight: "0.3rem" }} />
                {tr("Por piloto")}
              </h4>
              <table className="small sig-table">
                <thead>
                  <tr className="sig-th">
                    <th>{tr("Piloto")}</th>
                    <th style={{ textAlign: "right" }}>{tr("runs")}</th>
                    <th style={{ textAlign: "right" }} title={tr("Sus muertes entre las runs en que participó. Distinto de «runs con bajas», que mide el riesgo de la actividad.")}>
                      {tr("bajas")}
                    </th>
                    <th style={{ textAlign: "right" }} title={tr("Su parte del botín (a partes iguales) menos las naves que perdió él.")}>
                      {tr("P&L neto (ISK)")}
                    </th>
                    <th style={{ textAlign: "right" }} title={tr("Su P&L entre la duración REAL de las runs: el tiempo no se reparte, los 20 minutos los vivisteis todos.")}>
                      {tr("ISK/hora neto")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {byPilot.map((p) => (
                    <tr key={p.id}>
                      <td className="cell-icon">
                        <img
                          className="kind-glyph"
                          src={`https://images.evetech.net/characters/${p.id}/portrait?size=32`}
                          alt=""
                          style={{ borderRadius: "50%", width: 18, height: 18 }}
                        />
                        {charName(p.id)}
                      </td>
                      <td style={{ textAlign: "right" }}>{p.runs}</td>
                      <td style={{ textAlign: "right" }} className={p.deaths > 0 ? "abyss-died" : ""}>
                        {p.deaths} <span className="muted">({Math.round((p.deaths / p.runs) * 100)}%)</span>
                      </td>
                      <td style={{ textAlign: "right" }} className={p.net < 0 ? "abyss-died" : ""}>
                        {fmtIsk(p.net)}
                      </td>
                      <td style={{ textAlign: "right" }}>{fmtIsk(p.iskH)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small">
                {tr("Botín a partes iguales; la nave perdida es de quien la perdió. Por eso un piloto puede salir en rojo aunque el conjunto gane: ahí es donde toca mirar el fiteo.")}{" "}
                {runsConBajas.n > 0 && (
                  <>
                    {tr("Runs con bajas")}: <strong>{runsConBajas.con}</strong>/{runsConBajas.n} (
                    {Math.round(runsConBajas.pct)}%).
                  </>
                )}
              </p>
            </>
          )}

          <table className="small sig-table" style={{ marginTop: "0.4rem" }}>
            <thead>
              <tr className="sig-th">
                <th>{tr("Fecha")}</th>
                <th>{isCrab ? tr("Beacon") : tr("Filamento")}</th>
                <th>{tr("Pilotos")}</th>
                <th>{tr("Duración")}</th>
                <th>{tr("Resultado")}</th>
                <th style={{ textAlign: "right" }}>{tr("Botín")}</th>
                <th style={{ textAlign: "right" }} title={tr("Filamento(s) o baliza. Lo paga quien lanza; en blanco en las runs de antes de que Koru lo guardara.")}>{tr("Entrada")}</th>
                <th style={{ textAlign: "right" }}>{tr("Nave perdida")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {viewRows.map((r) => (
                <tr
                  key={r.id}
                  style={{
                    background: `linear-gradient(90deg, ${outcomeColor(r.outcome)}14, transparent 60%)`,
                    borderLeft: `3px solid ${outcomeColor(r.outcome)}`,
                  }}
                >
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{(r.ended_at ?? r.started_at).slice(0, 10)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {r.variant_id && (
                      <img className="run-ship" src={typeIcon(r.variant_id, 32)} alt="" style={{ marginLeft: 0, marginRight: "0.35rem" }} />
                    )}
                    {r.variant_name}
                    {r.ship_type_id && (
                      <img
                        className="run-ship"
                        src={typeIcon(r.ship_type_id, 32)}
                        alt=""
                        title={`${tr("Nave de la run")}: ${shipNameOf(r.ship_type_id)}`}
                      />
                    )}
                  </td>
                  {/* Quién voló. En Global esto contesta «¿de quién era esta run?», que antes no se
                      veía, y con multibox enseña la tripulación entera. El que murió va en rojo. */}
                  <td style={{ whiteSpace: "nowrap" }}>
                    <span className="run-crew">
                      {partsOf(r)
                        .filter((p) => p.character_id > 0)
                        // El que LANZÓ va primero y con anillo verde: es quien enlazó la baliza.
                        .sort(
                          (a, b) =>
                            Number(b.character_id === r.character_id) -
                            Number(a.character_id === r.character_id),
                        )
                        .slice(0, 5)
                        .map((p) => (
                          <img
                            key={p.character_id}
                            className={`${p.outcome === "dead" ? "dead" : ""}${p.character_id === r.character_id ? " launcher" : ""}`}
                            src={`https://images.evetech.net/characters/${p.character_id}/portrait?size=32`}
                            alt=""
                            title={`${charName(p.character_id)}${p.character_id === r.character_id ? ` · ${tr("lanzó la run")}` : ""}${p.outcome === "dead" ? ` · 💀 ${tr("Murió")}` : ""}`}
                          />
                        ))}
                      {partsOf(r).length > 5 && (
                        <span className="muted small">+{partsOf(r).length - 5}</span>
                      )}
                    </span>
                  </td>
                  <td className="muted">{fmtDuration(r.started_at, r.ended_at) ?? "—"}</td>
                  <td>
                    <span className="run-chip" style={{ borderColor: outcomeColor(r.outcome), color: outcomeColor(r.outcome) }}>
                      {r.outcome === "died" ? `💀 ${tr("Muerto")}` : r.outcome === "aborted" ? `✕ ${tr("Abortada")}` : `✓ ${tr("Completada")}`}
                    </span>
                  </td>
                  {editId === r.id ? (
                    <>
                      <td style={{ textAlign: "right" }}>
                        <input className="small" value={editLoot} onChange={(e) => setEditLoot(e.target.value)} placeholder={tr("ISK (p.ej. 45m)")} style={{ width: 90 }} />
                        <button className="sig-done-btn" title={tr("Pegar loot")} onClick={() => { setLootTarget(r.id); setLootOpen(true); }}>📋</button>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <input className="small" value={editEntry} onChange={(e) => setEditEntry(e.target.value)} placeholder={tr("ISK")} style={{ width: 80 }} />
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {r.outcome === "died" ? (
                          <input className="small" value={editShip} onChange={(e) => setEditShip(e.target.value)} placeholder={tr("ISK")} style={{ width: 80 }} />
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button className="sig-done-btn" title={tr("Guardar")} onClick={() => saveEdit(r)} disabled={busy}>✓</button>
                        <button className="sig-done-btn" title={tr("Cancelar")} onClick={() => setEditId(null)} disabled={busy}>✕</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={{ textAlign: "right" }}>{r.loot_isk != null ? fmtIsk(r.loot_isk) : <span className="muted">—</span>}</td>
                      <td style={{ textAlign: "right" }} className="muted">
                        {r.entry_cost != null ? `-${fmtIsk(r.entry_cost)}` : "—"}
                      </td>
                      <td style={{ textAlign: "right" }} className="abyss-died">
                        {r.ship_loss_isk != null ? `-${fmtIsk(r.ship_loss_isk)}` : <span className="muted">—</span>}
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {/* Un botón DESHABILITADO no recibe eventos de ratón en WebView2, así que
                            su `title` no se ve nunca: pulsarlo no hacía nada y no explicaba por
                            qué (le pasó a Zigor con sus runs abortadas). Si no se puede editar, no
                            se pinta el botón y el motivo va en el hueco. */}
                        {r.outcome === "aborted" ? (
                          <span className="muted small" title={tr("Una run abortada no tiene botín que corregir. Si te equivocaste al cerrarla, bórrala y vuelve a registrarla.")}>
                            —
                          </span>
                        ) : (
                          <button className="sig-done-btn" title={tr("Editar")} onClick={() => startEdit(r)} disabled={busy}>✏️</button>
                        )}
                        <button className="sig-done-btn" title={tr("Eliminar")} onClick={() => invoke("run_delete", { id: r.id }).then(reload)} disabled={busy}>🗑</button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <LootPasteModal
        open={lootOpen}
        siteCount={1}
        index={lootIndex}
        busy={busy}
        title={tr("Botín de la run")}
        confirmLabel={tr("Usar botín")}
        onCancel={() => setLootOpen(false)}
        onConfirm={(isk) => {
          if (isk != null) {
            if (lootTarget === "finish") setFinLoot(String(isk));
            else setEditLoot(String(isk));
          }
          setLootOpen(false);
        }}
      />

      {msg && <div className="small muted">{msg}</div>}
    </div>
  );
}
