// Trabajos y proyectos — tres cosas: (1) PROYECTOS PERSONALES (metas propias del usuario medidas
// del histórico local, cero ESI); (2) TRABAJOS POR LIBRE (Freelance Jobs, scope de personaje); y
// (3) PROYECTOS DE CORPORACIÓN (scope de corp del propio miembro). Los dos últimos, por personaje.
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { fmtIsk } from "./format";
import type { FreelanceJob, CorpProject, PersonalProject } from "./types";

const CAREER_ICON: Record<string, string> = {
  Explorer: "🧭",
  Industrialist: "🏭",
  Enforcer: "🛡️",
  "Soldier of Fortune": "⚔️",
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
  { key: "mineria", label: "Minería (valor)", icon: "⛏️", unit: "isk" },
  { key: "patrimonio", label: "Patrimonio (pico)", icon: "💰", unit: "isk" },
];
const METRIC_BY_KEY: Record<string, { label: string; icon: string; unit: "isk" | "count" }> = Object.fromEntries(
  METRICS.map((m) => [m.key, { label: m.label, icon: m.icon, unit: m.unit }]),
);
function fmtMetric(v: number, unit: "isk" | "count"): string {
  return unit === "isk" ? fmtIsk(v) : Math.round(v).toLocaleString();
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
  const [formOpen, setFormOpen] = useState(false);

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

  function loadPersonal() {
    invoke<PersonalProject[]>("get_personal_projects", { subjectId })
      .then(setPersonal)
      .catch(() => setPersonal([]));
  }
  useEffect(() => {
    loadPersonal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectId]);

  async function createProject() {
    const t = parseFloat(pTarget.replace(/[^0-9.]/g, ""));
    if (!pName.trim() || !(t > 0)) return;
    await invoke("create_personal_project", { subjectId, name: pName.trim(), metric: pMetric, target: t }).catch(() => {});
    setPName("");
    setPTarget("");
    setFormOpen(false);
    loadPersonal();
  }
  async function removeProject(id: number) {
    await invoke("delete_personal_project", { id }).catch(() => {});
    loadPersonal();
  }

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
          <select value={pMetric} onChange={(e) => setPMetric(e.target.value)}>
            {METRICS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
          <input
            type="number"
            placeholder={tr("Objetivo")}
            value={pTarget}
            onChange={(e) => setPTarget(e.target.value)}
          />
          <button onClick={createProject}>{tr("Crear")}</button>
        </div>
      )}
      {personal.length === 0 ? (
        <p className="muted small">
          {tr("Aún no tienes proyectos personales. Crea uno: ponle nombre, elige una métrica y un objetivo.")}
        </p>
      ) : (
        <div className="fl-list">
          {personal.map((p) => {
            const m = METRIC_BY_KEY[p.metric] ?? { label: p.metric, icon: "🎯", unit: "count" as const };
            const pct = p.target > 0 ? Math.min(100, (p.current / p.target) * 100) : 0;
            const done = p.current >= p.target;
            return (
              <div key={p.id} className={`fl-card ${done ? "fl-done" : "fl-active"}`}>
                <div className="fl-head">
                  <span className="fl-career">{m.icon}</span>
                  <strong>{p.name}</strong>
                  <button className="pp-del" title={tr("Borrar")} onClick={() => removeProject(p.id)}>
                    ✕
                  </button>
                </div>
                <div className="fl-goal">{m.label}</div>
                <div className="fl-bar">
                  <div className="fl-bar-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="fl-meta muted small">
                  <span>
                    {fmtMetric(p.current, m.unit)} / {fmtMetric(p.target, m.unit)} · {pct.toFixed(0)}%
                  </span>
                  {done && <span className="tk-up">✔ {tr("¡Conseguido!")}</span>}
                </div>
              </div>
            );
          })}
        </div>
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
                          {CAREER_ICON[j.career] ?? "📋"}
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
                        <span className="fl-career">🏢</span>
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
