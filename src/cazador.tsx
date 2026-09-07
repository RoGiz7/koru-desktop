import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { fmtAgo, fmtSp, typeIcon } from "./format";
import { Kpi, Bars, RangePresets } from "./charts";
import { createPortal } from "react-dom";
import { loadNewEden } from "./neweden";
import { openExternal } from "./openExternal";
import { loadJson } from "./staticJson";
import { PilotoNombre } from "./fichaPiloto";

/** ★ ICONOGRAFÍA EVE (regla suya, 2026-07-29): antes de poner un emoji, buscar el objeto de EVE
 *  que representa la cosa — y **reutilizar el typeID que la app ya usa para ese concepto**, para
 *  reforzar un vocabulario en vez de inventar otro. Los tres verificados contra
 *  `public/market_types.json`.
 *
 *  Los que se quedan en emoji, y por qué: 🚀 (la lista de debajo YA son iconos de nave reales,
 *  repetirlo arriba es ruido) y 🔥 «horas activas» (el tiempo es abstracto, EVE no tiene un objeto
 *  para eso). El límite ya decidido dice que el chrome abstracto se queda en emoji. */
const TID_KILLS = 587; // Rifter — el mismo que la Bitácora usa para «Kills del mes»
const TID_GENTE = 3355; // Social (skillbook) — el que ya significa «tratar con gente» en la app
const TID_SISTEMAS = 30488; // Sisters Core Scanner Probe — el de «sistemas distintos con kills»
// Pod, elegido por él: «creo que quedará mejor y es fino al ser pequeño». Y además es el
// `TID_CAPSULE` que Abyssals ya usa, así que refuerza el vocabulario en vez de inventar otro.
const TID_NAVES = 670; // Capsule

/** Retrato de un piloto por su id, con hueco reservado para que la fila no salte al cargar. */
function Retrato({ id, size = 22 }: { id: number | null | undefined; size?: number }) {
  if (id == null || id <= 0) return <span className="intel-hab-noimg cz-sinretrato">?</span>;
  return (
    <img
      className="cz-retrato"
      src={`https://images.evetech.net/characters/${id}/portrait?size=64`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
    />
  );
}

/** Icono de EVE para una cabecera de sección. `alt` vacío: el texto de al lado ya lo dice. */
function IconoEve({ tid, size = 18 }: { tid: number; size?: number }) {
  return <img className="cz-ico" src={typeIcon(tid, 32)} alt="" width={size} height={size} />;
}

type Habitual = {
  name_lower: string;
  character_id: number | null;
  name: string;
  seen_count: number;
  last_seen: string | null;
  last_system_id: number | null;
};
// Los nombres de nave de ship_names.json vienen en minúsculas (para el matching del parser);
// los capitalizamos para mostrarlos ("dark blood exequror" → "Dark Blood Exequror").
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

type CountItem = { id: number; count: number };
type VsPersona = { character_id: number; name: string | null; count: number };
type PilotVs = {
  te_mato: number;
  le_mataste: number;
  peleas: number;
  dano_recibido: number;
  mediana_atacantes: number | null;
  max_atacantes: number | null;
  naves: CountItem[];
  acompanantes: VsPersona[];
  ultima: string | null;
};
type PilotProfile = {
  name: string;
  character_id: number | null;
  total: number;
  first_ms: number | null;
  last_ms: number | null;
  by_system: CountItem[];
  by_ship: CountItem[];
  by_hour: number[];
  vs: PilotVs | null;
};

// ---- Caché de MÓDULO (vive lo que la app, muere al cerrarla) ----
// El trato de siempre (ver inventario.tsx): pintar lo conocido al instante, re-pedir detrás.
// La lista de habituales no lleva argumentos → una sola caché, sin clave. Las fichas van por
// NOMBRE, que es su único argumento.
// ⚠️ `ship_names.json` NO es `ships.json`: éste va de nombre (en minúsculas, con los alias en
// castellano del parser) a typeID, y aquí se invierte para enseñar. Son ficheros distintos con
// semánticas distintas — no se unifican con `loadShipNames()` de flotas.tsx por parecerse.
let cacheHabituales: Habitual[] | null = null;
const cachePerfil = new Map<string, PilotProfile>();
let shipByIdPromise: Promise<Map<number, string>> | null = null;
function loadShipNamesPorId(): Promise<Map<number, string>> {
  if (!shipByIdPromise)
    shipByIdPromise = loadJson<Record<string, number>>("/ship_names.json", {})
      .then((d) => {
        const m = new Map<number, string>();
        for (const [n, id] of Object.entries(d)) if (!m.has(id)) m.set(id, n);
        return m;
      })
      .catch(() => new Map<number, string>());
  return shipByIdPromise;
}

// ---- ★★ EL CARA A CARA ----
// Esta ficha se lee con el hostil A UN SALTO, así que arriba va un VEREDICTO de una línea y el
// detalle debajo. Las dos reglas que no se negocian:
//   1. **El alcance se dice en cada línea.** Todo esto sale de killmails en los que estabas TÚ.
//      No son «sus naves», son las que le has visto usar. Sin la etiqueta, el número miente.
//   2. **Vacío ≠ inofensivo.** «0 encuentros» tiene que decirse CON PALABRAS —«nunca te has
//      cruzado con él»—, nunca como un marcador a cero, que se lee como «no es peligroso».
function CaraACara({
  vs,
  shipNames,
  onAbrir,
  onFicha,
}: {
  vs: PilotVs | null;
  shipNames: Map<number, string>;
  onAbrir: (id: number) => void;
  onFicha?: (name: string, id?: number | null) => void;
}) {
  // `null` = ni siquiera se ha podido mirar (Koru no conoce su ID). Distinto de mirarlo y no
  // encontrar nada, y por eso no comparten mensaje.
  if (!vs) {
    return (
      <div className="cazador-vs vacia">
        <p className="muted small">
          {tr("Sin cara a cara: Koru todavía no conoce su ID, así que no ha podido mirar en tus killmails.")}
        </p>
      </div>
    );
  }
  const cruces = vs.te_mato + vs.le_mataste + vs.peleas;
  if (cruces === 0) {
    return (
      <div className="cazador-vs vacia">
        <p className="small">
          <strong>{tr("Nunca te has cruzado con él en un killmail.")}</strong>{" "}
          {tr("Eso no dice que sea inofensivo: dice que no os habéis visto. Lo que haga fuera de tus peleas no está aquí.")}
        </p>
      </div>
    );
  }
  // ⚠️ Los umbrales van sobre la MEDIANA, nunca sobre la media. Con la media, un piloto de null
  // que suele salir en banda de diez salía como «suele ir en flota (153,9 por pelea)» porque dos
  // batallas de bloque tiraban del promedio — un número que no describía ninguna de sus peleas.
  const mediana = vs.mediana_atacantes;
  const compania =
    mediana == null
      ? null
      : mediana <= 1
        ? tr("suele ir solo")
        : mediana <= 5
          ? tr("suele ir en banda pequeña")
          : mediana <= 20
            ? tr("suele ir en banda")
            : tr("suele ir en flota");
  // La mayor solo se enseña si de verdad se sale de lo normal: si su pelea más grande es como
  // las demás, repetir la cifra es ruido.
  const picoRelevante =
    mediana != null && vs.max_atacantes != null && vs.max_atacantes >= mediana * 3 && vs.max_atacantes > 5;
  return (
    <div className="cazador-vs">
      <p className="cazador-veredicto">
        <IconoEve tid={TID_KILLS} /> <strong>{tr("Te ha matado")} {fmtSp(vs.te_mato)}</strong> · {tr("tú a él")}{" "}
        <strong>{fmtSp(vs.le_mataste)}</strong>
        {compania && (
          <>
            {" — "}
            {compania}
            <span className="muted">
              {" ("}
              {fmtSp(mediana as number)} {tr("de mediana")}
              {picoRelevante && (
                <>
                  {" · "}
                  {tr("su mayor")}: {fmtSp(vs.max_atacantes as number)}
                </>
              )}
              {")"}
            </span>
          </>
        )}
      </p>
      <p className="muted small cazador-vs-alcance">
        {tr("Todo esto sale de killmails en los que estabas tú. Lo que haya hecho sin ti delante no aparece.")}
      </p>
      <div className="kpis">
        <Kpi label={tr("Peleas compartidas")} value={fmtSp(vs.peleas)} />
        <Kpi label={tr("Daño que te ha hecho")} value={fmtSp(vs.dano_recibido)} />
        {vs.ultima && (
          <Kpi
            label={tr("Último encuentro")}
            value={fmtAgo(Date.now() - new Date(vs.ultima).getTime())}
          />
        )}
      </div>
      <div className="cazador-grid">
        <div className="cazador-sec">
          <h4><IconoEve tid={TID_NAVES} /> {tr("Naves que le has visto usar")}</h4>
          {vs.naves.length === 0 ? (
            <p className="muted small">{tr("Ninguna registrada en esos killmails.")}</p>
          ) : (
            <div className="cazador-ships">
              {vs.naves.map((s) => (
                <div
                  className="cazador-ship"
                  key={s.id}
                  title={shipNames.has(s.id) ? titleCase(shipNames.get(s.id)!) : `#${s.id}`}
                >
                  <img src={typeIcon(s.id, 32)} alt="" width={30} height={30} />
                  <span className="cazador-ship-name">
                    {shipNames.has(s.id) ? titleCase(shipNames.get(s.id)!) : `#${s.id}`}
                  </span>
                  <span className="intel-count fleet">×{s.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="cazador-sec">
          <h4><IconoEve tid={TID_GENTE} /> {tr("Con quién le has visto")}</h4>
          {vs.acompanantes.length === 0 ? (
            <p className="muted small">{tr("En esas peleas no había nadie más con nombre.")}</p>
          ) : (
            <table className="km-table cat-table">
              <tbody>
                {vs.acompanantes.map((a) => (
                  <tr key={a.character_id}>
                    <td className="cz-acomp">
                      <Retrato id={a.character_id} />
                      {/* ★ CON NOMBRE → LA FICHA DE PILOTO, no zKillboard. Idea suya: de alguien que
                          vuela con el hostil, lo primero que interesa es «¿tengo algo interno de
                          éste?» —si habéis coincidido, hablado, o volado juntos—, y eso solo lo
                          sabe Koru. El killboard sigue a un clic desde la propia ficha.
                          SIN nombre no se puede: la ficha se abre por nombre y Koru no lo conoce,
                          así que ahí queda el id y su killboard, que es lo único cierto. */}
                      {a.name ? (
                        <PilotoNombre nombre={a.name} id={a.character_id} onFicha={onFicha} />
                      ) : (
                        <button
                          className="linklike"
                          onClick={() => onAbrir(a.character_id)}
                          title={tr("Ver su killboard")}
                        >
                          #{a.character_id}
                        </button>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>×{a.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}


/** ★★ EL HISTORIAL DE AVISTAMIENTOS — la ventana que se abre al pulsar los KPI.
 *
 *  Idea suya: «como en las medallas, que al pinchar se abra una ventana con la gráfica y sus
 *  filtros». El patrón es el de `medalDetail.tsx`, portal incluido y por la misma razón (ver
 *  abajo).
 *
 *  ⚠️ **«MENCIONES» NO ABRE NADA, Y NO ES UN OLVIDO.** `name_cache.seen_count` es un contador
 *  suelto: se suma uno y ya. No hay una fila por mención en ningún sitio, así que **de las
 *  menciones no existe historia que dibujar** — solo el número. Los avistamientos sí la tienen
 *  (`intel_sightings` guarda sistema y hora de cada uno) y por eso son los únicos que se pueden
 *  desplegar. Inventar una gráfica de menciones repartiendo el total sería dibujar un dato que
 *  nadie ha medido.
 *
 *  ⚠️ Y el TECHO: `get_pilot_track` devuelve como mucho 1.000 avistamientos, los más recientes.
 *  Se dice en pantalla cuando se alcanza, porque si no la gráfica parecería empezar el día que
 *  empieza el corte y eso es ceguera disfrazada de dato. */
function HistorialAvistamientos({
  nombre,
  sysNames,
  onClose,
  onVerEnMapa,
}: {
  nombre: string;
  sysNames: Map<number, string>;
  onClose: () => void;
  onVerEnMapa?: (sysId: number) => void;
}) {
  const TOPE = 1000;
  const [pts, setPts] = useState<{ system_id: number; ts_ms: number }[] | null>(null);
  const [sys, setSys] = useState<number | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    invoke<{ system_id: number; ts_ms: number }[]>("get_pilot_track", { name: nombre, limit: TOPE })
      .then(setPts)
      .catch(() => setPts([]));
  }, [nombre]);

  const filtrados = useMemo(() => {
    if (!pts) return [];
    const desde = from ? Date.parse(from + "T00:00:00Z") : -Infinity;
    const hasta = to ? Date.parse(to + "T23:59:59Z") : Infinity;
    return pts.filter(
      (p) => (sys === "" || p.system_id === sys) && p.ts_ms >= desde && p.ts_ms <= hasta,
    );
  }, [pts, sys, from, to]);

  /** Por DÍA o por MES según lo que abarque: 14 meses en barras diarias son 420 barras que no se
   *  leen, y una semana en barras mensuales es una sola barra que no dice nada. */
  const serie = useMemo(() => {
    if (filtrados.length === 0) return [];
    const t0 = Math.min(...filtrados.map((p) => p.ts_ms));
    const t1 = Math.max(...filtrados.map((p) => p.ts_ms));
    const porMes = t1 - t0 > 120 * 86400000;
    const cubos = new Map<string, number>();
    for (const p of filtrados) {
      const d = new Date(p.ts_ms).toISOString();
      const k = porMes ? d.slice(0, 7) : d.slice(0, 10);
      cubos.set(k, (cubos.get(k) ?? 0) + 1);
    }
    return [...cubos.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([label, value]) => ({ label, value }));
  }, [filtrados]);

  const porSistema = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of filtrados) m.set(p.system_id, (m.get(p.system_id) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [filtrados]);

  // Portal al body por lo mismo que el modal de medallas: las secciones van dentro de
  // `.panel-art-wrap` con `isolation: isolate`, y ahí dentro el z-index no puede ganar a los
  // controles del mapa por muy alto que sea. Lo reportó él con la app maximizada.
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      {/* `md-modal` es la base del modal de medallas: fondo, borde, sombra y scroll. No existe una
          clase `.modal` genérica —cada modal trae la suya— y la mía se quedó SIN FONDO: se veían
          los KPI y las barras de horas por debajo. Se reutiliza la probada en vez de rehacerla. */}
      <div className="md-modal cz-modal" onClick={(e) => e.stopPropagation()}>
        <div className="md-head">
          <div className="md-title">
            <strong>{tr("Avistamientos de")} {nombre}</strong>
            <span className="muted small">
              {tr("Cada vez que se le ha reportado con sistema y hora.")}
            </span>
          </div>
          <button className="loot-modal-x" onClick={onClose} title={tr("Cerrar")}>
            ✕
          </button>
        </div>

        {pts == null ? (
          <p className="muted small">{tr("Cargando…")}</p>
        ) : pts.length === 0 ? (
          <p className="muted small">{tr("Sin avistamientos con sistema y hora.")}</p>
        ) : (
          <>
            <div className="cz-modal-filtros">
              <select
                value={sys}
                onChange={(e) => setSys(e.target.value === "" ? "" : Number(e.target.value))}
              >
                <option value="">{tr("Todos los sistemas")}</option>
                {porSistema.map(([id]) => (
                  <option key={id} value={id}>
                    {sysNames.get(id) ?? `#${id}`}
                  </option>
                ))}
              </select>
              <RangePresets from={from} to={to} setFrom={setFrom} setTo={setTo} />
            </div>

            <p className="muted small">
              <strong>{fmtSp(filtrados.length)}</strong> {tr("avistamientos")}
              {filtrados.length !== pts.length && ` ${tr("de")} ${fmtSp(pts.length)}`}
              {pts.length >= TOPE &&
                ` · ${tr("solo se guardan los 1.000 más recientes: antes de esa fecha no es que no apareciera, es que no se está mirando.")}`}
            </p>

            <div className="cz-modal-graf">
              <Bars items={serie} color="#ff6ad5" />
            </div>

            {sys === "" && porSistema.length > 1 && (
              <div className="cazador-sec">
                <h4>
                  <IconoEve tid={TID_SISTEMAS} /> {tr("Dónde, en este periodo")}
                </h4>
                <table className="km-table cat-table">
                  <tbody>
                    {porSistema.map(([id, n]) => (
                      <tr key={id}>
                        <td>
                          {onVerEnMapa ? (
                            <button
                              className="linklike"
                              onClick={() => onVerEnMapa(id)}
                              title={tr("Centrar este sistema en el mapa")}
                            >
                              {sysNames.get(id) ?? `#${id}`}
                            </button>
                          ) : (
                            (sysNames.get(id) ?? `#${id}`)
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>×{n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

// Sección PvP → "Cazador": análisis de hostiles aprendidos del intel local. Lista buscable/ordenable
// de todos los pilotos conocidos + ficha amplia del seleccionado (horas UTC, sistemas, naves,
// frecuencia). El rastro se sigue pintando en el mapa; `onTrackOnMap` (si se pasa) hace el puente.
export function CazadorView({
  onTrackOnMap,
  initialPilot,
  onFicha,
  onVerEnMapa,
}: {
  onTrackOnMap?: (name: string) => void;
  initialPilot?: string | null;
  /** Abre LA ficha de piloto de la app — la misma de Contratos, Flotas y Social. Idea suya: de un
   *  acompañante del hostil interesa antes «¿tengo algo interno de éste?» que su killboard. */
  onFicha?: (name: string, id?: number | null) => void;
  /** Salta al Mapa y CENTRA ese sistema (con su animación y su pulso). Ya existía como `verEnMapa`
   *  para el resto de secciones; aquí solo se enchufa. */
  onVerEnMapa?: (sysId: number) => void;
}) {
  const [list, setList] = useState<Habitual[] | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"count" | "recent">("count");
  const [sel, setSel] = useState<string | null>(null);
  const [profile, setProfile] = useState<PilotProfile | null>(null);
  /** Menciones del hostil seleccionado. Sale de la lista que ya está en memoria, no de una llamada
   *  nueva: `get_pilot_profile` cuenta avistamientos y este número es el otro, el de `name_cache`. */
  const [menciones, setMenciones] = useState<number | null>(null);
  /** Historial abierto. Solo los avistamientos tienen historia; ver `HistorialAvistamientos`. */
  const [histOpen, setHistOpen] = useState(false);
  const [sysNames, setSysNames] = useState<Map<number, string>>(new Map());
  const [shipNames, setShipNames] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    // Lo último conocido, al instante; se re-pide detrás. La consulta no lleva argumentos
    // (siempre minCount 1 / limit 500), así que hay UNA sola caché y no hace falta clave.
    setList(cacheHabituales ?? null);
    invoke<Habitual[]>("get_habitual_hostiles", { minCount: 1, limit: 500 })
      .then((d) => {
        cacheHabituales = d; // se guarda aunque la vista ya no esté montada
        setList(d);
      })
      .catch(() => setList([]));
    loadNewEden()
      .then((ne) => setSysNames(new Map(ne.systems.map((s) => [s.id, s.n]))))
      .catch(() => {});
    loadShipNamesPorId().then(setShipNames);
  }, []);

  async function select(name: string) {
    setSel(name);
    setMenciones(
      (cacheHabituales ?? []).find((h) => h.name === name)?.seen_count ?? null,
    );
    // La ficha cacheada se pinta YA y se re-pide siempre: los avistamientos son dato vivo y el
    // rastro de un piloto crece mientras miras. Pintar lo viejo sin releer sería petrificarlo.
    setProfile(cachePerfil.get(name) ?? null);
    try {
      const p = await invoke<PilotProfile>("get_pilot_profile", { name });
      cachePerfil.set(name, p);
      setProfile(p);
    } catch {
      setProfile(null);
    }
  }

  // Fase 3.5 — fichar un objetivo NUEVO por nombre: si no está entre los aprendidos, se resuelve
  // contra ESI (nombre EXACTO) y se abre su ficha. `resolve_intel_entities` ya cachea el id en
  // name_cache, así que cuando el piloto aparezca en tu intel llegará resuelto (retrato incluido)
  // y su rastro empezará a acumularse desde el primer avistamiento.
  const [esiBusy, setEsiBusy] = useState(false);
  const [esiMsg, setEsiMsg] = useState("");
  async function ficharPorNombre() {
    const name = q.trim();
    if (!name) return;
    setEsiBusy(true);
    setEsiMsg("");
    try {
      const r = await invoke<{ characters: { id: number; name: string }[] }>(
        "resolve_intel_entities",
        { names: [name] },
      );
      const c = r.characters[0];
      if (c) {
        setQ("");
        void select(c.name);
      } else {
        setEsiMsg(tr("ESI no conoce ese nombre. Tiene que ser exacto (las mayúsculas dan igual)."));
      }
    } catch {
      setEsiMsg(tr("No se pudo consultar ESI. Inténtalo en un momento."));
    } finally {
      setEsiBusy(false);
    }
  }

  // Puente desde la ficha del mapa: si llega un piloto preseleccionado, abrir su ficha directamente.
  useEffect(() => {
    if (initialPilot) select(initialPilot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPilot]);

  const filtered = useMemo(() => {
    let l = list ?? [];
    const ql = q.trim().toLowerCase();
    if (ql) l = l.filter((h) => h.name.toLowerCase().includes(ql));
    l = [...l].sort((a, b) =>
      sort === "count"
        ? b.seen_count - a.seen_count
        : Date.parse(b.last_seen ?? "0") - Date.parse(a.last_seen ?? "0"),
    );
    return l;
  }, [list, q, sort]);

  return (
    <div className="cazador">
      <div className="cazador-list">
        <div className="cazador-tools">
          <input
            className="cazador-search"
            placeholder={tr("Buscar hostil…")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="seg seg-sm">
            <button className={sort === "count" ? "active" : ""} onClick={() => setSort("count")}>
              {tr("Menciones")}
            </button>
            <button className={sort === "recent" ? "active" : ""} onClick={() => setSort("recent")}>
              {tr("Reciente")}
            </button>
          </div>
        </div>
        {list == null ? (
          <p className="muted small">{tr("Cargando…")}</p>
        ) : filtered.length === 0 ? (
          <div className="cazador-esi">
            <p className="muted small">
              {q.trim()
                ? tr("Nadie con ese nombre entre tus aprendidos.")
                : tr("Sin hostiles conocidos aún. Deja correr el intel un rato.")}
            </p>
            {q.trim().length >= 3 && (
              <>
                <button className="pp-add" onClick={ficharPorNombre} disabled={esiBusy}>
                  {esiBusy ? "⏳" : <>🔎 {tr("Fichar por nombre (ESI)")}: «{q.trim()}»</>}
                </button>
                {esiMsg && <p className="muted small">{esiMsg}</p>}
              </>
            )}
          </div>
        ) : (
          <div className="cazador-rows">
            {filtered.map((h) => {
              const sysName = h.last_system_id != null ? sysNames.get(h.last_system_id) : null;
              return (
                <div
                  key={h.name_lower}
                  className={`cazador-row${sel === h.name ? " active" : ""}`}
                  onClick={() => select(h.name)}
                >
                  {h.character_id != null && h.character_id > 0 ? (
                    <img
                      src={`https://images.evetech.net/characters/${h.character_id}/portrait?size=32`}
                      alt=""
                      width={28}
                      height={28}
                    />
                  ) : (
                    <span className="intel-hab-noimg">?</span>
                  )}
                  <div className="cazador-row-main">
                    <span className="cazador-row-name">{h.name}</span>
                    {sysName && (
                      <span className="muted small">
                        {tr("visto en")} {sysName}
                        {h.last_seen && ` · ${fmtAgo(Date.now() - Date.parse(h.last_seen))}`}
                      </span>
                    )}
                  </div>
                  {/* ★ Es `seen_count`: MENCIONES, no avistamientos. Los dos números conviven a
                      propósito y significan cosas distintas — ver la ficha, donde salen juntos. El
                      botón de ordenar de arriba ya se llamaba «Menciones»; esto lo termina. */}
                  <span
                    className="intel-count fleet"
                    title={`${fmtSp(h.seen_count)} ${tr("menciones en el intel")}`}
                  >
                    ×{h.seen_count}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="cazador-ficha">
        {sel == null ? (
          <p className="muted">{tr("Selecciona un hostil de la lista para ver su ficha.")}</p>
        ) : profile == null ? (
          <p className="muted small">{tr("Cargando…")}</p>
        ) : profile.total === 0 ? (
          // Fichado por nombre (Fase 3.5) o aprendido sin avistamientos aún: dossier mínimo con
          // retrato + zKill; el rastro y las horas nacerán con su primer reporte en tu intel.
          <>
            <div className="cazador-ficha-head">
              {/* Su cara ANTES que su nombre: es lo que se reconoce de un vistazo en el local. */}
              <h3>
                <Retrato id={profile.character_id} size={28} /> {profile.name}
              </h3>
              <div className="cazador-ficha-btns">
                {profile.character_id != null && profile.character_id > 0 && (
                  <button onClick={() => openExternal(`https://zkillboard.com/character/${profile.character_id}/`)}>
                    zKill
                  </button>
                )}
              </div>
            </div>
            <p className="muted small">
              {tr("Fichado. Aún sin avistamientos: en cuanto aparezca en tu intel, su rastro, sus horas y sus naves nacen aquí.")}
            </p>
            {/* ★ El cara a cara TAMBIÉN aquí, y aquí es donde más vale: «nunca lo has visto en el
                intel, pero te ha matado dos veces» es exactamente el aviso que salva la ficha de
                un recién fichado. Sale de los killmails, que no dependen de los avistamientos. */}
            <CaraACara
              vs={profile.vs}
              shipNames={shipNames}
              onAbrir={(id) => openExternal(`https://zkillboard.com/character/${id}/`)}
              onFicha={onFicha}
            />
          </>
        ) : (
          <>
            <div className="cazador-ficha-head">
              <h3>
                <Retrato id={profile.character_id} size={28} /> {profile.name}
              </h3>
              <div className="cazador-ficha-btns">
                {onTrackOnMap && (
                  <button className="cazador-track-btn" onClick={() => onTrackOnMap(profile.name)}>
                    🎯 {tr("Ver rastro en el mapa")}
                  </button>
                )}
                {profile.character_id != null && profile.character_id > 0 && (
                  <button onClick={() => openExternal(`https://zkillboard.com/character/${profile.character_id}/`)}>
                    zKill
                  </button>
                )}
              </div>
            </div>
            {/* ★ ARRIBA DEL TODO, antes que ningún avistamiento: con el hostil a un salto lo que
                se necesita es el veredicto, no el dossier. Lo demás se lee si da tiempo. */}
            <CaraACara
              vs={profile.vs}
              shipNames={shipNames}
              onAbrir={(id) => openExternal(`https://zkillboard.com/character/${id}/`)}
              onFicha={onFicha}
            />
            <div className="kpis">
              {/* ★★ LOS DOS NÚMEROS, JUNTOS Y ETIQUETADOS (2026-09-07).
                  La lista decía «×186» y este KPI «156» y las dos cosas se leían igual: «cuántas
                  veces le he visto». Son preguntas distintas y las dos son ciertas —
                  · MENCIONES = veces que ha pasado por delante (`name_cache.seen_count`);
                  · AVISTAMIENTOS = veces distintas con SITIO y HORA (`intel_sightings`, cuya clave
                    primaria es nombre+sistema+hora, así que una línea repetida no cuenta dos veces).
                  Medido en su BD: el hueco es del 38 %, y son sobre todo líneas de intel en las que
                  el troceador sacó el piloto pero no el sistema. Esconder uno de los dos habría
                  sido perder información; dejarlos sin etiqueta es lo que confundía. */}
              {/* Clicable: despliega su historia. «Menciones» NO — no la tiene, ver el modal. */}
              <button
                className="kpi-boton"
                onClick={() => setHistOpen(true)}
                title={tr("Ver el historial con sus filtros")}
              >
                <Kpi label={tr("Avistamientos")} value={fmtSp(profile.total)} />
              </button>
              {menciones != null && menciones !== profile.total && (
                <Kpi label={tr("Menciones")} value={fmtSp(menciones)} />
              )}
              {profile.last_ms != null && (
                <Kpi label={tr("Último visto")} value={fmtAgo(Date.now() - profile.last_ms)} />
              )}
              {profile.first_ms != null && (
                <Kpi label={tr("Primer visto")} value={fmtAgo(Date.now() - profile.first_ms)} />
              )}
              <Kpi label={tr("Sistemas distintos")} value={fmtSp(profile.by_system.length)} />
            </div>
            {/* Solo cuando difieren: si coinciden, explicar una diferencia que no se ve es ruido. */}
            {menciones != null && menciones !== profile.total && (
              <p className="muted small cazador-dosnum">
                {tr("Se le ha nombrado")} <strong>{fmtSp(menciones)}</strong> {tr("veces, y de ahí salen")}{" "}
                <strong>{fmtSp(profile.total)}</strong>{" "}
                {tr("avistamientos distintos: los que traían sistema y hora, sin contar dos veces una línea repetida. Son los que alimentan su rastro, sus horas y sus sistemas.")}
              </p>
            )}

            <div className="cazador-sec">
              <h4>🔥 {tr("Horas activas (UTC)")}</h4>
              <div className="hourbars big">
                {(() => {
                  const max = Math.max(...profile.by_hour, 1);
                  const nowH = new Date().getUTCHours();
                  return profile.by_hour.map((c, h) => (
                    // ★ `data-v` lleva el valor al CSS (`content: attr(data-v)`), que es lo que
                    // permite enseñarlo AL INSTANTE al pasar por encima. El `title` nativo se
                    // queda como reserva, pero tarda casi un segundo en salir y para leer una
                    // franja horaria de un vistazo eso es una eternidad.
                    // `vacia` marca las horas sin actividad: se pintan como un suelo tenue en vez
                    // de como nada, para que la franja del día se lea entera y no a trozos.
                    <div
                      className={`hourbar${c === 0 ? " vacia" : ""}${h === nowH ? " ahora" : ""}`}
                      key={h}
                      data-v={`${String(h).padStart(2, "0")}:00 UTC · ${c}`}
                      title={`${String(h).padStart(2, "0")}:00 UTC · ${c}`}
                    >
                      <div className="hourbar-fill" style={{ height: `${(c / max) * 100}%` }} />
                      <span className={`hourbar-lbl${h === nowH ? " now" : ""}`}>{h % 3 === 0 ? h : ""}</span>
                    </div>
                  ));
                })()}
              </div>
            </div>

            <div className="cazador-grid">
              <div className="cazador-sec">
                <h4><IconoEve tid={TID_SISTEMAS} /> {tr("Sistemas favoritos")}</h4>
                <table className="km-table cat-table">
                  <tbody>
                    {profile.by_system.map((s) => (
                      <tr key={s.id}>
                        <td>
                          {/* Idea suya: desde aquí al mapa. Un sistema en una tabla es un dato; en
                              el mapa es una decisión — cuántos saltos, por dónde, qué hay al lado. */}
                          {onVerEnMapa ? (
                            <button
                              className="linklike"
                              onClick={() => onVerEnMapa(s.id)}
                              title={tr("Centrar este sistema en el mapa")}
                            >
                              {sysNames.get(s.id) ?? `#${s.id}`}
                            </button>
                          ) : (
                            (sysNames.get(s.id) ?? `#${s.id}`)
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>×{s.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="cazador-sec">
                {/* Etiqueta CAMBIADA a propósito: ahora hay DOS listas de naves en la misma ficha
                    —ésta del intel, la otra de tus killmails— y «naves que vuela» a secas ya no
                    dice de cuál de las dos ventanas viene. */}
                <h4><IconoEve tid={TID_NAVES} /> {tr("Naves reportadas en el intel")}</h4>
                {profile.by_ship.length === 0 ? (
                  <p className="muted small">
                    {tr("Aún sin datos (solo se atribuye en reportes de un único piloto).")}
                  </p>
                ) : (
                  <div className="cazador-ships">
                    {profile.by_ship.map((s) => (
                      <div
                        className="cazador-ship"
                        key={s.id}
                        title={shipNames.has(s.id) ? titleCase(shipNames.get(s.id)!) : `#${s.id}`}
                      >
                        <img src={typeIcon(s.id, 32)} alt="" width={30} height={30} />
                        <span className="cazador-ship-name">
                          {shipNames.has(s.id) ? titleCase(shipNames.get(s.id)!) : `#${s.id}`}
                        </span>
                        <span className="intel-count fleet">×{s.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {histOpen && (
              <HistorialAvistamientos
                nombre={profile.name}
                sysNames={sysNames}
                onClose={() => setHistOpen(false)}
                onVerEnMapa={onVerEnMapa}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
