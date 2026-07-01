import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { tr } from "./i18n";
import { fmtAgo, fmtSp, typeIcon } from "./format";
import { Kpi } from "./charts";
import { loadNewEden } from "./neweden";

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
type PilotProfile = {
  name: string;
  character_id: number | null;
  total: number;
  first_ms: number | null;
  last_ms: number | null;
  by_system: CountItem[];
  by_ship: CountItem[];
  by_hour: number[];
};

// Sección PvP → "Cazador": análisis de hostiles aprendidos del intel local. Lista buscable/ordenable
// de todos los pilotos conocidos + ficha amplia del seleccionado (horas UTC, sistemas, naves,
// frecuencia). El rastro se sigue pintando en el mapa; `onTrackOnMap` (si se pasa) hace el puente.
export function CazadorView({
  onTrackOnMap,
  initialPilot,
}: {
  onTrackOnMap?: (name: string) => void;
  initialPilot?: string | null;
}) {
  const [list, setList] = useState<Habitual[] | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"count" | "recent">("count");
  const [sel, setSel] = useState<string | null>(null);
  const [profile, setProfile] = useState<PilotProfile | null>(null);
  const [sysNames, setSysNames] = useState<Map<number, string>>(new Map());
  const [shipNames, setShipNames] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    invoke<Habitual[]>("get_habitual_hostiles", { minCount: 1, limit: 500 })
      .then(setList)
      .catch(() => setList([]));
    loadNewEden()
      .then((ne) => setSysNames(new Map(ne.systems.map((s) => [s.id, s.n]))))
      .catch(() => {});
    fetch("/ship_names.json")
      .then((r) => r.json())
      .then((d: Record<string, number>) => {
        const m = new Map<number, string>();
        for (const [n, id] of Object.entries(d)) if (!m.has(id)) m.set(id, n);
        setShipNames(m);
      })
      .catch(() => {});
  }, []);

  async function select(name: string) {
    setSel(name);
    setProfile(null);
    try {
      setProfile(await invoke<PilotProfile>("get_pilot_profile", { name }));
    } catch {
      setProfile(null);
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
          <p className="muted small">{tr("Sin hostiles conocidos aún. Deja correr el intel un rato.")}</p>
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
                  <span className="intel-count fleet">×{h.seen_count}</span>
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
          <p className="muted small">{tr("Sin avistamientos guardados todavía (se acumulan según aparezca en intel).")}</p>
        ) : (
          <>
            <div className="cazador-ficha-head">
              <h3>📇 {profile.name}</h3>
              <div className="cazador-ficha-btns">
                {onTrackOnMap && (
                  <button className="cazador-track-btn" onClick={() => onTrackOnMap(profile.name)}>
                    🎯 {tr("Ver rastro en el mapa")}
                  </button>
                )}
                {profile.character_id != null && profile.character_id > 0 && (
                  <button onClick={() => openUrl(`https://zkillboard.com/character/${profile.character_id}/`)}>
                    zKill
                  </button>
                )}
              </div>
            </div>
            <div className="kpis">
              <Kpi label={tr("Avistamientos")} value={fmtSp(profile.total)} />
              {profile.last_ms != null && (
                <Kpi label={tr("Último visto")} value={fmtAgo(Date.now() - profile.last_ms)} />
              )}
              {profile.first_ms != null && (
                <Kpi label={tr("Primer visto")} value={fmtAgo(Date.now() - profile.first_ms)} />
              )}
              <Kpi label={tr("Sistemas distintos")} value={fmtSp(profile.by_system.length)} />
            </div>

            <div className="cazador-sec">
              <h4>🔥 {tr("Horas activas (UTC)")}</h4>
              <div className="hourbars big">
                {(() => {
                  const max = Math.max(...profile.by_hour, 1);
                  const nowH = new Date().getUTCHours();
                  return profile.by_hour.map((c, h) => (
                    <div className="hourbar" key={h} title={`${String(h).padStart(2, "0")}:00 UTC · ${c}`}>
                      <div className="hourbar-fill" style={{ height: `${(c / max) * 100}%` }} />
                      <span className={`hourbar-lbl${h === nowH ? " now" : ""}`}>{h % 3 === 0 ? h : ""}</span>
                    </div>
                  ));
                })()}
              </div>
            </div>

            <div className="cazador-grid">
              <div className="cazador-sec">
                <h4>📍 {tr("Sistemas favoritos")}</h4>
                <table className="km-table cat-table">
                  <tbody>
                    {profile.by_system.map((s) => (
                      <tr key={s.id}>
                        <td>{sysNames.get(s.id) ?? `#${s.id}`}</td>
                        <td style={{ textAlign: "right" }}>×{s.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="cazador-sec">
                <h4>🚀 {tr("Naves que vuela")}</h4>
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
          </>
        )}
      </div>
    </div>
  );
}
