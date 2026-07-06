// Trabajos y proyectos — tres cosas: (1) PROYECTOS PERSONALES (metas propias del usuario medidas
// del histórico local, cero ESI); (2) TRABAJOS POR LIBRE (Freelance Jobs, scope de personaje); y
// (3) PROYECTOS DE CORPORACIÓN (scope de corp del propio miembro). Los dos últimos, por personaje.
import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { tr } from "./i18n";
import { fmtIsk, typeIcon } from "./format";
import { playUnlock, ensureNotifPerm } from "./sound";
import type { FreelanceJob, CorpProject, PersonalProject } from "./types";

const CAREER_ICON: Record<string, string> = {
  Explorer: "🧭",
  Industrialist: "🏭",
  Enforcer: "🛡️",
  "Soldier of Fortune": "⚔️",
};
// Icono EVE representativo por carrera (typeID del SDE) para las tarjetas de freelance.
const CAREER_TID: Record<string, number> = {
  Explorer: 30013, // Core Scanner Probe I
  Industrialist: 32880, // Venture
  Enforcer: 3244, // Warp Disruptor II (tackle)
  "Soldier of Fortune": 587, // Rifter
};
const STATE: Record<string, { es: string; cls: string }> = {
  Active: { es: "Activo", cls: "fl-active" },
  Completed: { es: "Completado", cls: "fl-done" },
  Expired: { es: "Expirado", cls: "fl-old" },
  Closed: { es: "Cerrado", cls: "fl-old" },
  Deleted: { es: "Borrado", cls: "fl-old" },
  Unspecified: { es: "—", cls: "" },
};
const METHOD: Record<string, { es: string; icon: string }> = {
  mine_material: { es: "Minar", icon: "⛏️" },
  deliver_item: { es: "Entregar objeto", icon: "📦" },
  destroy_ships: { es: "Destruir naves", icon: "💥" },
  deal_damage: { es: "Daño infligido", icon: "⚔️" },
  complete_jumps: { es: "Saltos", icon: "➿" },
  scan_signatures: { es: "Escanear señales", icon: "📡" },
  manufacture: { es: "Fabricar", icon: "🏭" },
};

// Métricas disponibles para proyectos personales (todas del SQLite local; la clave la conoce Rust).
const METRICS: { key: string; label: string; icon: string; unit: "isk" | "count" }[] = [
  { key: "kills", label: "Kills", icon: "⚔️", unit: "count" },
  { key: "damage", label: "Daño infligido", icon: "💥", unit: "count" },
  { key: "isk_destruido", label: "ISK destruido", icon: "💥", unit: "isk" },
  { key: "final_blows", label: "Golpes finales", icon: "🎯", unit: "count" },
  { key: "solo_kills", label: "Kills en solitario", icon: "🗡️", unit: "count" },
  { key: "sistemas", label: "Sistemas con kill", icon: "🗺️", unit: "count" },
  { key: "rateo", label: "Rateo (bounties+ESS)", icon: "🐀", unit: "isk" },
  { key: "mineria", label: "Minería", icon: "⛏️", unit: "isk" },
  { key: "patrimonio", label: "Patrimonio (pico)", icon: "💰", unit: "isk" },
];
const METRIC_BY_KEY: Record<string, { label: string; icon: string; unit: "isk" | "count" }> = Object.fromEntries(
  METRICS.map((m) => [m.key, { label: m.label, icon: m.icon, unit: m.unit }]),
);
function fmtMetric(v: number, unit: "isk" | "count"): string {
  return unit === "isk" ? fmtIsk(v) : Math.round(v).toLocaleString();
}
// Modos de la métrica de minería (cómo se mide lo minado).
const MINERIA_MODES = [
  { key: "value", label: "Valor de mercado" },
  { key: "units", label: "Unidades" },
  { key: "volume", label: "Volumen (m³)" },
  { key: "reproceso", label: "ISK reproceso 85%" },
];
// Formatea el valor de un proyecto de minería según su modo.
function fmtMineria(v: number, mode: string): string {
  if (mode === "units") return Math.round(v).toLocaleString();
  if (mode === "volume") return `${Math.round(v).toLocaleString()} m³`;
  return fmtIsk(v); // value | reproceso | ""
}

// ---- Filtro opcional del proyecto (nave / mineral / sistema) ----
// Tipos de filtro permitidos según la métrica: kills → nave/sistema; mineria → mineral/sistema.
const KILL_METRICS = ["kills", "damage", "isk_destruido", "final_blows", "solo_kills", "sistemas"];
function kindsFor(metric: string): { key: string; label: string }[] {
  if (KILL_METRICS.includes(metric)) return [
    { key: "ship", label: tr("Nave") },
    { key: "victim_char", label: tr("Personaje") },
    { key: "victim_corp", label: tr("Corp") },
    { key: "system", label: tr("Sistema") },
  ];
  if (metric === "mineria") return [
    { key: "ore", label: tr("Mineral") },
    { key: "system", label: tr("Sistema") },
  ];
  return [];
}
// Carga perezosa y cacheada de los catálogos locales (naves / menas del SDE, sistemas de New Eden).
// ship → solo naves (categoría 6); ore → solo menas (categoría 25); nada de módulos/planos sueltos.
const CATALOG_FILE: Record<string, string> = { ship: "/ships.json", ore: "/ores.json" };
const CATALOG_CACHE: Record<string, { i: number; n: string; g: string }[]> = {};
let SYSTEMS_CACHE: { id: number; n: string }[] | null = null;
type PickItem = { id: number; name: string };
type PickFamily = { name: string; ids: number[] };
type PickResults = { items: PickItem[]; families: PickFamily[] };
async function loadCatalog(kind: string): Promise<{ i: number; n: string; g: string }[]> {
  const file = CATALOG_FILE[kind];
  if (!file) return [];
  if (!CATALOG_CACHE[kind]) {
    CATALOG_CACHE[kind] = await fetch(file).then((r) => r.json()).catch(() => []);
  }
  return CATALOG_CACHE[kind] ?? [];
}
async function searchCatalog(kind: string, q: string): Promise<PickResults> {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return { items: [], families: [] };
  if (kind === "system") {
    if (!SYSTEMS_CACHE) {
      const d = await fetch("/neweden.json").then((r) => r.json()).catch(() => ({ systems: [] }));
      SYSTEMS_CACHE = (d.systems ?? []).map((s: { id: number; n: string }) => ({ id: s.id, n: s.n }));
    }
    const items = SYSTEMS_CACHE!
      .filter((s) => s.n.toLowerCase().includes(needle))
      .slice(0, 10)
      .map((s) => ({ id: s.id, name: s.n }));
    return { items, families: [] };
  }
  const cat = await loadCatalog(kind);
  const matched = cat.filter((t) => t.n.toLowerCase().includes(needle) || t.g.toLowerCase().includes(needle));
  const items = matched.slice(0, 10).map((t) => ({ id: t.i, name: t.n }));
  // Familias (grupos) entre los coincidentes, con TODOS sus miembros para "toda la familia".
  const groups = [...new Set(matched.map((t) => t.g))].filter(Boolean).slice(0, 4);
  const families = groups.map((g) => ({ name: g, ids: cat.filter((t) => t.g === g).map((t) => t.i) }));
  return { items, families };
}

// Icono EVE representativo por métrica cuando el proyecto no filtra un tipo concreto.
// ISK → bono de recompensa (ítem de ISK del juego); minería → Veldspar (mineral genérico).
const METRIC_ICON_TID: Record<string, number> = {
  rateo: 55932, // 10M Bounty SCC Encrypted Bond (ISK)
  isk_destruido: 55932,
  patrimonio: 55932,
  mineria: 1230, // Veldspar
};
// Icono para un id según el tipo de filtro: icono de tipo (nave/mineral) o retrato/logo (víctima).
function entityIcon(kind: string, id: number): string | null {
  if (kind === "ship" || kind === "ore") return typeIcon(id, 32);
  if (kind === "victim_char") return `https://images.evetech.net/characters/${id}/portrait?size=32`;
  if (kind === "victim_corp") return `https://images.evetech.net/corporations/${id}/logo?size=32`;
  return null;
}

// Limpia el rich-text de EVE (<font>, <br>, <a href="showinfo:...">) a texto plano legible.
function cleanEveText(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?font[^>]*>/gi, "")
    .replace(/<a\b[^>]*>(.*?)<\/a>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function FreelanceView({ subject }: { subject: number | "global" }) {
  const isGlobal = subject === "global";
  const subjectId = typeof subject === "number" ? subject : 0;
  const [jobs, setJobs] = useState<FreelanceJob[] | null>(null);
  const [projects, setProjects] = useState<CorpProject[]>([]);
  const [personal, setPersonal] = useState<PersonalProject[]>([]);
  const [pName, setPName] = useState("");
  const [pMetric, setPMetric] = useState("kills");
  const [pTarget, setPTarget] = useState("");
  const [pUnit, setPUnit] = useState(1); // multiplicador del objetivo: 1 / mil / millón / mil millones
  const [pMode, setPMode] = useState("value"); // solo mineria: value|units|volume|reproceso
  const [formOpen, setFormOpen] = useState(false);
  // Filtro opcional del proyecto (nave/mineral/sistema), multi-selección con chips.
  const [pKind, setPKind] = useState("");
  const [pSel, setPSel] = useState<{ label: string; ids: number[] }[]>([]);
  const [pQuery, setPQuery] = useState("");
  const [pResults, setPResults] = useState<PickResults>({ items: [], families: [] });
  const [victims, setVictims] = useState<{ id: number; name: string }[]>([]); // víctimas del historial (Fase 3)

  function resetFilter() {
    setPKind("");
    setPSel([]);
    setPQuery("");
    setPResults({ items: [], families: [] });
  }
  function addSel(chip: { label: string; ids: number[] }) {
    setPSel((prev) => (prev.some((c) => c.label === chip.label) ? prev : [...prev, chip]));
    setPQuery("");
    setPResults({ items: [], families: [] });
  }
  function removeSel(label: string) {
    setPSel((prev) => prev.filter((c) => c.label !== label));
  }

  useEffect(() => {
    let alive = true;
    setJobs(isGlobal ? [] : null);
    setProjects([]);
    if (!isGlobal) {
      invoke<FreelanceJob[]>("get_freelance_jobs", { characterId: subject })
        .then((d) => alive && setJobs(d))
        .catch(() => alive && setJobs([]));
      invoke<CorpProject[]>("get_corp_projects", { characterId: subject })
        .then((d) => alive && setProjects(d))
        .catch(() => alive && setProjects([]));
    }
    return () => {
      alive = false;
    };
  }, [subject]);

  // Para detectar proyectos recién completados entre cargas y celebrarlos una sola vez.
  const prevDone = useRef<Set<number>>(new Set());
  const firstLoad = useRef(true);
  async function celebrate(list: PersonalProject[]) {
    playUnlock();
    const names = list.slice(0, 3).map((p) => p.name).join(", ");
    const extra = list.length > 3 ? ` +${list.length - 3}` : "";
    if (await ensureNotifPerm()) {
      try {
        sendNotification({ title: `🏆 ${tr("¡Proyecto completado!")}`, body: `${names}${extra}` });
      } catch {
        /* sin permiso o plugin no disponible */
      }
    }
  }
  function loadPersonal() {
    invoke<PersonalProject[]>("get_personal_projects", { subjectId })
      .then((list) => {
        setPersonal(list);
        const doneNow = new Set(list.filter((p) => p.target > 0 && p.current >= p.target).map((p) => p.id));
        if (!firstLoad.current) {
          const fresh = list.filter((p) => doneNow.has(p.id) && !prevDone.current.has(p.id));
          if (fresh.length > 0) void celebrate(fresh);
        }
        prevDone.current = doneNow;
        firstLoad.current = false;
      })
      .catch(() => setPersonal([]));
  }
  useEffect(() => {
    firstLoad.current = true;
    prevDone.current = new Set();
    loadPersonal();
    // Refresco ligero mientras la pestaña está abierta, para cazar completados en vivo.
    const iv = setInterval(loadPersonal, 60000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectId]);

  async function createProject() {
    const t = parseFloat(pTarget.replace(/[^0-9.]/g, "")) * pUnit;
    if (!pName.trim() || !(t > 0)) return;
    const allIds = [...new Set(pSel.flatMap((c) => c.ids))];
    await invoke("create_personal_project", {
      subjectId,
      name: pName.trim(),
      metric: pMetric,
      target: t,
      paramKind: allIds.length ? pKind : "",
      paramIds: allIds.length ? allIds.join(",") : "",
      paramName: allIds.length ? pSel.map((c) => c.label).join(", ").slice(0, 80) : "",
      mode: pMetric === "mineria" ? pMode : "",
    }).catch(() => {});
    setPName("");
    setPTarget("");
    setPUnit(1);
    setPMode("value");
    resetFilter();
    setFormOpen(false);
    loadPersonal();
  }
  async function removeProject(id: number) {
    await invoke("delete_personal_project", { id }).catch(() => {});
    loadPersonal();
  }

  // Tarjeta de un proyecto personal (activo o completado). Icono real del SDE si filtra un tipo.
  function renderCard(p: PersonalProject) {
    const m = METRIC_BY_KEY[p.metric] ?? { label: p.metric, icon: "🎯", unit: "count" as const };
    const isMineria = p.metric === "mineria";
    const fmt = (v: number) => (isMineria ? fmtMineria(v, p.mode) : fmtMetric(v, m.unit));
    const modeLabel = isMineria ? MINERIA_MODES.find((x) => x.key === (p.mode || "value"))?.label : null;
    const pct = p.target > 0 ? Math.min(100, (p.current / p.target) * 100) : 0;
    const done = !!p.completed_at || p.current >= p.target;
    // Icono EVE: si filtra tipos/víctima → el PRIMER id (para familia = el mineral base = la categoría);
    // si no, un icono representativo de la métrica (ISK / mineral). Sistema no tiene icono → emoji.
    const firstId = p.param_ids ? Number(p.param_ids.split(",")[0]) : 0;
    const filterIcon = firstId > 0 ? entityIcon(p.param_kind, firstId) : null;
    const metricTid = METRIC_ICON_TID[p.metric];
    const cardIcon = filterIcon ?? (metricTid ? typeIcon(metricTid, 32) : null);
    return (
      <div key={p.id} className={`fl-card ${done ? "fl-done" : "fl-active"}`}>
        <div className="fl-head">
          <span className="fl-career">
            {cardIcon ? <img className="type-ico" src={cardIcon} alt="" loading="lazy" /> : m.icon}
          </span>
          <strong>{p.name}</strong>
          <button className="pp-del" title={tr("Borrar")} onClick={() => removeProject(p.id)}>
            ✕
          </button>
        </div>
        <div className="fl-goal">
          {m.label}
          {modeLabel && <span className="pp-tag">{tr(modeLabel)}</span>}
          {p.param_name && <span className="pp-tag">🔎 {p.param_name}</span>}
        </div>
        <div className="fl-bar">
          <div className="fl-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="fl-meta muted small">
          <span>
            {fmt(p.current)} / {fmt(p.target)} · {pct.toFixed(0)}%
          </span>
          {p.completed_at ? (
            <span className="tk-up">🏆 {p.completed_at.slice(0, 10)}</span>
          ) : (
            done && <span className="tk-up">✔ {tr("¡Conseguido!")}</span>
          )}
        </div>
      </div>
    );
  }
  const activos = personal.filter((p) => !p.completed_at);
  const completados = personal.filter((p) => p.completed_at);

  const rows = [...(jobs ?? [])].sort((a, b) => (a.state === "Active" ? -1 : 0) - (b.state === "Active" ? -1 : 0));

  return (
    <>
      {/* ---- Proyectos personales (metas propias, del histórico local) ---- */}
      <div className="bit-head">
        <h4>🎯 {tr("Proyectos personales")}</h4>
        <button className="pp-add" onClick={() => setFormOpen((o) => !o)}>
          {formOpen ? "✕" : `＋ ${tr("Nuevo")}`}
        </button>
      </div>
      {formOpen && (
        <div className="pp-form">
          <input
            placeholder={tr("Nombre (ej. Cazador del mes)")}
            value={pName}
            onChange={(e) => setPName(e.target.value)}
          />
          <select
            value={pMetric}
            onChange={(e) => {
              setPMetric(e.target.value);
              setPMode("value");
              resetFilter();
            }}
          >
            {METRICS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
          {/* Modo de medida de la minería */}
          {pMetric === "mineria" && (
            <select value={pMode} onChange={(e) => setPMode(e.target.value)}>
              {MINERIA_MODES.map((m) => (
                <option key={m.key} value={m.key}>
                  {tr(m.label)}
                </option>
              ))}
            </select>
          )}
          {/* Filtro opcional: tipo (nave/mineral/sistema) según la métrica */}
          {kindsFor(pMetric).length > 0 && (
            <select
              value={pKind}
              onChange={(e) => {
                const k = e.target.value;
                setPKind(k);
                setPSel([]);
                setPQuery("");
                setPResults({ items: [], families: [] });
                setVictims([]);
                if (k === "victim_char" || k === "victim_corp") {
                  // Carga las víctimas de tu historial y muestra el top al abrir.
                  invoke<{ id: number; name: string }[]>("get_kill_victims", { subjectId, kind: k })
                    .then((v) => {
                      setVictims(v);
                      setPResults({ items: v.slice(0, 10), families: [] });
                    })
                    .catch(() => setVictims([]));
                }
              }}
            >
              <option value="">{tr("Sin filtro")}</option>
              {kindsFor(pMetric).map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}
                </option>
              ))}
            </select>
          )}
          {pKind && (
            <div className="pp-search">
              {pSel.map((c) => {
                const ic = c.ids.length >= 1 ? entityIcon(pKind, c.ids[0]) : null;
                return (
                  <span key={c.label} className="pp-chip">
                    {ic ? <img className="type-ico" src={ic} alt="" loading="lazy" /> : "🔎"}{" "}
                    {c.label}
                    <button className="pp-chip-x" onClick={() => removeSel(c.label)}>
                      ✕
                    </button>
                  </span>
                );
              })}
              <input
                placeholder={
                  pKind === "system"
                    ? tr("Buscar sistema…")
                    : pKind === "victim_char" || pKind === "victim_corp"
                    ? tr("Buscar víctima…")
                    : tr("Buscar tipo…")
                }
                value={pQuery}
                onChange={async (e) => {
                  const q = e.target.value;
                  setPQuery(q);
                  if (pKind === "victim_char" || pKind === "victim_corp") {
                    const needle = q.trim().toLowerCase();
                    const items = (needle ? victims.filter((v) => v.name.toLowerCase().includes(needle)) : victims).slice(0, 10);
                    setPResults({ items, families: [] });
                  } else {
                    setPResults(await searchCatalog(pKind, q));
                  }
                }}
              />
              {(pResults.families.length > 0 || pResults.items.length > 0) && (
                <div className="pp-results">
                  {pResults.families.map((f) => (
                    <button
                      key={`fam-${f.name}`}
                      className="pp-result pp-fam"
                      onClick={() => addSel({ label: `${f.name} (${tr("familia")})`, ids: f.ids })}
                    >
                      ★ {tr("Toda la familia")}: {f.name} ({f.ids.length})
                    </button>
                  ))}
                  {pResults.items.map((r) => {
                    const ic = entityIcon(pKind, r.id);
                    return (
                      <button key={r.id} className="pp-result" onClick={() => addSel({ label: r.name, ids: [r.id] })}>
                        {ic && <img className="type-ico" src={ic} alt="" loading="lazy" />} {r.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <input
            type="number"
            placeholder={tr("Objetivo")}
            value={pTarget}
            onChange={(e) => setPTarget(e.target.value)}
          />
          <select value={pUnit} onChange={(e) => setPUnit(Number(e.target.value))}>
            <option value={1}>{tr("Unidades")}</option>
            <option value={1000}>{tr("Miles")}</option>
            <option value={1000000}>{tr("Millones")}</option>
            <option value={1000000000}>B</option>
          </select>
          <button onClick={createProject}>{tr("Crear")}</button>
        </div>
      )}
      {personal.length === 0 ? (
        <p className="muted small">
          {tr("Aún no tienes proyectos personales. Crea uno: ponle nombre, elige una métrica y un objetivo.")}
        </p>
      ) : (
        <>
          {activos.length > 0 && <div className="fl-list">{activos.map(renderCard)}</div>}
          {completados.length > 0 && (
            <>
              <div className="bit-head">
                <h4>🏆 {tr("Completados")}</h4>
              </div>
              <div className="fl-list">{completados.map(renderCard)}</div>
            </>
          )}
        </>
      )}

      {/* ---- Trabajos por libre + Proyectos de corp (por personaje) ---- */}
      {isGlobal ? (
        <p className="muted small" style={{ marginTop: "0.8rem" }}>
          {tr("Los trabajos por libre y proyectos de corp son por personaje: elige uno para verlos.")}
        </p>
      ) : jobs === null ? (
        <p className="muted" style={{ marginTop: "0.8rem" }}>
          {tr("Cargando…")}
        </p>
      ) : (
        <>
          {rows.length > 0 && (
            <>
              <div className="bit-head">
                <h4>🛠️ {tr("Trabajos por libre")}</h4>
              </div>
              <div className="fl-list">
                {rows.map((j) => {
                  const pct = j.progress_desired > 0 ? Math.min(100, (j.progress_current / j.progress_desired) * 100) : 0;
                  const st = STATE[j.state] ?? { es: j.state, cls: "" };
                  return (
                    <div key={j.id} className={`fl-card ${st.cls}`}>
                      <div className="fl-head">
                        <span className="fl-career" title={j.career}>
                          {CAREER_TID[j.career] ? (
                            <img className="type-ico" src={typeIcon(CAREER_TID[j.career], 32)} alt="" loading="lazy" />
                          ) : (
                            CAREER_ICON[j.career] ?? "📋"
                          )}
                        </span>
                        <strong>{j.name || tr("Trabajo por libre")}</strong>
                        <span className="fl-state">{st.es}</span>
                      </div>
                      {j.description && <div className="muted small fl-desc">{cleanEveText(j.description)}</div>}
                      {j.progress_desired > 0 && (
                        <div className="fl-bar">
                          <div className="fl-bar-fill" style={{ width: `${pct}%` }} />
                        </div>
                      )}
                      <div className="fl-meta muted small">
                        {j.progress_desired > 0 && (
                          <span>
                            {j.progress_current.toLocaleString()} / {j.progress_desired.toLocaleString()} · {pct.toFixed(0)}%
                          </span>
                        )}
                        {j.reward_remaining > 0 && <span>💰 {fmtIsk(j.reward_remaining)}</span>}
                        {j.expires && <span>⏳ {j.expires.slice(0, 10)}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {projects.length > 0 && (
            <>
              <div className="bit-head">
                <h4>🏢 {tr("Proyectos de corporación")}</h4>
                <span className="muted small">{projects.length}</span>
              </div>
              <div className="fl-list">
                {projects.map((p) => {
                  const pct = p.progress_desired > 0 ? Math.min(100, (p.progress_current / p.progress_desired) * 100) : 0;
                  const st = STATE[p.state] ?? { es: p.state, cls: "" };
                  return (
                    <div key={p.id} className={`fl-card ${st.cls}`}>
                      <div className="fl-head">
                        <span className="fl-career">
                          {p.icon_type_id ? (
                            <img className="type-ico" src={typeIcon(p.icon_type_id, 32)} alt="" loading="lazy" />
                          ) : p.method === "mine_material" ? (
                            <img className="type-ico" src={typeIcon(1230, 32)} alt="" loading="lazy" />
                          ) : (
                            "🏢"
                          )}
                        </span>
                        <strong>{p.name || tr("Proyecto")}</strong>
                        <span className="fl-state">{st.es}</span>
                      </div>
                      {p.description && <div className="muted small fl-desc">{cleanEveText(p.description)}</div>}
                      {p.method && (
                        <div className="fl-goal">
                          <span title={p.method}>{METHOD[p.method]?.icon ?? "🎯"}</span>{" "}
                          {METHOD[p.method]?.es ?? p.method}
                          {p.groups.length > 0 ? `: ${p.groups.join(", ")}` : ""}
                        </div>
                      )}
                      {p.location && (
                        <div className="muted small fl-loc">
                          📍 {tr("Entregar en")}: {p.location}
                        </div>
                      )}
                      {p.progress_desired > 0 && (
                        <div className="fl-bar">
                          <div className="fl-bar-fill" style={{ width: `${pct}%` }} />
                        </div>
                      )}
                      <div className="fl-meta muted small">
                        {p.progress_desired > 0 && (
                          <span>
                            {p.progress_current.toLocaleString()} / {p.progress_desired.toLocaleString()} · {pct.toFixed(0)}%
                          </span>
                        )}
                        {p.contributed > 0 && (
                          <span>
                            🙋 {tr("tu aporte")}: {p.contributed.toLocaleString()}
                          </span>
                        )}
                        {p.reward_remaining > 0 && <span>💰 {fmtIsk(p.reward_remaining)}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {rows.length === 0 && projects.length === 0 && (
            <p className="muted small" style={{ marginTop: "0.8rem" }}>
              {tr("Sin trabajos por libre ni proyectos de corp todavía (o falta conceder el acceso al reloguear).")}
            </p>
          )}
        </>
      )}

      <p className="muted small bit-foot">
        {tr("Tus metas propias + los objetivos del juego (Freelance + Proyectos de corp), en un mismo sitio.")}
      </p>
    </>
  );
}
