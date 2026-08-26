// Sección CAMPAÑAS — Military Campaigns (Cradle of War), fase 1 PÚBLICA (sin scope).
// ESI da el estado VIVO ({id UUID, state, progress} + objetivos paginados con participación en 3
// sabores); public/military_campaigns.json (SDE, mismas UUIDs) pone los textos ES/EN, recompensas
// por intervalo, método de contribución, carrera y requisito de milicia. Una campaña puede existir
// en ESI SIN definición aún (el SDE se exporta 1 vez/día): eso es NORMAL y se dice, no se esconde.
// Shapes verificados contra pegados reales de las rutas (2026-08-04).
// FASE 2 (columna «Tú»): contribución personal multi-personaje, scope esi.activity.char:read
// (verificado concedible con login solo-scope, 2026-08-04). Nombres de campo de la spec OpenAPI:
// `contributed` (entero acumulado, NO un %) e `is_committed`. Se pinta crudo a propósito: no lo
// dividimos por el target del SDE hasta comprobar con datos reales que van en la misma unidad.
import { loadJson } from "./staticJson";
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr, getLang } from "./i18n";
import { fmtSp, typeIcon } from "./format";
import { cleanEveText } from "./freelance";
import type {
  MilitaryCampaign,
  CampaignObjective,
  MyCampaignParticipation,
  Character,
} from "./types";

/** Scope de la fase 2. Familia NUEVA de Fenris: `esi.activity.char:read`, no `esi-xxx.v1`. */
const SCOPE_ACTIVIDAD = "esi.activity.char:read";

/** Definiciones del SDE (extract_military_campaigns.py). Claves = UUIDs de ESI. */
type CampDefs = {
  camps: Record<
    string,
    { t: { es: string; en: string }; s: { es: string; en: string }; target: number | null; faction: number | null }
  >;
  objs: Record<
    string,
    {
      camp: string | null;
      career: string | null;
      method: string | null;
      t: { es: string; en: string };
      s: { es: string; en: string };
      target: number | null;
      max_per: number | null;
      isk: number | null;
      lp: number | null;
      standing: number | null;
      interval: number | null;
      militia: number | null;
    }
  >;
};

/** Iconos por carrera (mismos typeIDs que usa Trabajos/freelance; claves = careerPath del SDE). */
const CAREER_ICON: Record<string, number> = {
  exploration: 30013, // Core Scanner Probe
  industrialist: 32880, // Venture
  enforcer: 3244, // Warp Disruptor II
  "soldier-of-fortune": 587, // Rifter
};

/** Métodos de contribución → etiqueta corta (los 9 presentes en el SDE actual). */
const METHOD_LABEL: Record<string, string> = {
  MineOre: "Minar",
  KillNPC: "Matar NPC",
  Manufacture: "Fabricar",
  CompleteAgentMission: "Misiones de agente",
  HackSomething: "Hackear",
  CaptureDefendFWComplex: "Complejos de FW",
  KillCapsuleer: "Matar capsuleers",
  DamageShip: "Hacer daño",
  RemoteRepairArmorOrShield: "Reparación remota",
};

const factionLogo = (id: number) => `https://images.evetech.net/corporations/${id}/logo?size=64`;

// ---- Caché de MÓDULO (vive lo que la app, muere al cerrarla) ----
// Mismo trato que en inventario.tsx y Trabajos: se pinta lo último conocido al instante y se
// re-pide DETRÁS. Aquí las campañas son ESI EN VIVO y los objetivos se piden campaña a campaña,
// así que sin esto cada visita empezaba por «Cargando campañas…» y perdía lo que tuvieras abierto.
// ⚠️ Cada caché con la clave de SU consulta: las campañas no llevan argumentos (una sola), los
// objetivos van por UUID de campaña, y la participación por QUIÉN se pregunta — si esa última
// compartiera clave, cambiar de personajes pintaría el aporte de otro sin dar ningún error.
// Las DEFINICIONES son un JSON del SDE: estáticas por sesión, promesa cacheada como loadNewEden.
let campsCache: MilitaryCampaign[] | null = null;
const objsCache = new Map<string, CampaignObjective[]>();
const mineCache = new Map<string, MyCampaignParticipation[]>();
let defsPromise: Promise<CampDefs | null> | null = null;
function loadDefs(): Promise<CampDefs | null> {
  if (!defsPromise)
    defsPromise = loadJson<CampDefs | null>("/military_campaigns.json", null);
  return defsPromise;
}

export function CampanasView({ characters = [] }: { characters?: Character[] }) {
  const [defs, setDefs] = useState<CampDefs | null>(null);
  const [camps, setCamps] = useState<MilitaryCampaign[] | null>(campsCache);
  const [objs, setObjs] = useState<Map<string, CampaignObjective[]>>(new Map(objsCache));
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  // Fase 2: mi participación, agrupada por UUID de objetivo.
  const [mine, setMine] = useState<Map<string, MyCampaignParticipation[]>>(new Map());
  const es = getLang() === "es";
  const txt = (d?: { es: string; en: string }) => (d ? (es ? d.es : d.en) : "");

  // Personajes que han concedido el permiso nuevo. Si no hay ninguno, ni preguntamos a ESI.
  const withScope = useMemo(
    () => characters.filter((c) => c.scopes?.includes(SCOPE_ACTIVIDAD)),
    [characters],
  );
  const nameOf = (id: number) =>
    characters.find((c) => c.character_id === id)?.name ?? String(id);

  useEffect(() => {
    loadDefs().then(setDefs);
    invoke<MilitaryCampaign[]>("get_military_campaigns")
      .then((d) => {
        campsCache = d;
        setCamps(d);
      })
      .catch((e) => {
        setCamps([]);
        setMsg(`${tr("Error")}: ${String(e).slice(0, 160)}`);
      });
  }, []);

  // Contribución personal multi-personaje. Best-effort: si falla, la vista pública sigue entera.
  useEffect(() => {
    const ids = withScope.map((c) => c.character_id);
    if (ids.length === 0) {
      setMine(new Map());
      return;
    }
    // La clave es QUIÉN se pregunta, ordenado: si mañana concedes el permiso con otro personaje,
    // la consulta cambia y tiene que cambiar la clave con ella.
    const clave = [...ids].sort((a, b) => a - b).join(",");
    const porObjetivo = (rows: MyCampaignParticipation[]) => {
      const m = new Map<string, MyCampaignParticipation[]>();
      for (const r of rows) {
        const arr = m.get(r.objective_id) ?? [];
        arr.push(r);
        m.set(r.objective_id, arr);
      }
      return m;
    };
    const previo = mineCache.get(clave);
    if (previo) setMine(porObjetivo(previo));
    invoke<MyCampaignParticipation[]>("get_my_campaign_participation", { characterIds: ids })
      .then((rows) => {
        mineCache.set(clave, rows);
        setMine(porObjetivo(rows));
      })
      .catch(() => setMine(new Map()));
  }, [withScope]);

  async function toggle(id: string) {
    if (open === id) {
      setOpen(null);
      return;
    }
    setOpen(id);
    // ⚠️ ANTES esto era `if (!objs.has(id))`: se pedía UNA vez y ya. Con la caché de módulo eso
    // habría convertido «pedido una vez» en «pedido una vez EN TODA LA SESIÓN», y el progreso de
    // un objetivo es dato VIVO — habrías visto el de hace dos horas creyéndolo de ahora. Así que
    // se re-pide SIEMPRE al abrir: lo cacheado se pinta al instante (ya está en `objs`) y la
    // respuesta lo sustituye cuando llega. Es el trato del patrón, no una excepción a él.
    try {
      const list = await invoke<CampaignObjective[]>("get_military_campaign_objectives", {
        campaignId: id,
      });
      objsCache.set(id, list);
      setObjs((prev) => new Map(prev).set(id, list));
    } catch (e) {
      setMsg(`${tr("Error")}: ${String(e).slice(0, 160)}`);
    }
  }

  // Activas primero; dentro, por % de progreso descendente (las que están a punto, arriba).
  const ordered = useMemo(() => {
    const pct = (c: MilitaryCampaign) => {
      const t = defs?.camps[c.id]?.target;
      return t && t > 0 ? c.progress / t : 0;
    };
    return [...(camps ?? [])].sort((a, b) => {
      const sa = a.state === "Active" ? 0 : 1;
      const sb = b.state === "Active" ? 0 : 1;
      return sa - sb || pct(b) - pct(a);
    });
  }, [camps, defs]);

  if (camps == null) return <p className="muted">{tr("Cargando campañas…")}</p>;
  if (camps.length === 0)
    return (
      <p className="muted small">
        {tr("Ahora mismo no hay campañas visibles en ESI.")} {msg}
      </p>
    );

  return (
    <div className="camp-view">
      {ordered.map((c) => {
        const d = defs?.camps[c.id];
        const pct = d?.target && d.target > 0 ? Math.min(100, (c.progress / d.target) * 100) : null;
        const isOpen = open === c.id;
        const list = objs.get(c.id);
        return (
          <div key={c.id} className="camp-card">
            <div className="camp-head" onClick={() => toggle(c.id)}>
              {d?.faction != null && <img className="camp-flag" src={factionLogo(d.faction)} alt="" />}
              <div className="camp-title">
                <strong>{d ? txt(d.t) : `${tr("Campaña")} ${c.id.slice(0, 8)}…`}</strong>
                {!d && (
                  <span className="muted small"> · {tr("definición pendiente del próximo SDE")}</span>
                )}
                <div className="muted small">{d ? cleanEveText(txt(d.s)) : ""}</div>
              </div>
              <div className="camp-state">
                <span className={`camp-chip ${c.state === "Active" ? "on" : ""}`}>{c.state === "Active" ? tr("Activa") : c.state}</span>
                <div className="small">
                  {fmtSp(c.progress)}
                  {d?.target ? ` / ${fmtSp(d.target)}` : ""}
                </div>
                {pct != null && (
                  <div className="fl-bar">
                    <div className="fl-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
              <span className="bom-exp">{isOpen ? "▾" : "▸"}</span>
            </div>

            {isOpen && (
              <div className="camp-objs">
                {!list ? (
                  <p className="muted small">{tr("Cargando objetivos…")}</p>
                ) : (
                  <table className="km-table small">
                    <thead>
                      <tr>
                        <th>{tr("Objetivos")}</th>
                        <th>{tr("Método")}</th>
                        <th style={{ textAlign: "right" }}>{tr("Progreso")}</th>
                        <th style={{ textAlign: "right" }} title={tr("Comprometidos ahora (tooltip: total apuntados · contribuyentes)")}>
                          {tr("Participan")}
                        </th>
                        <th style={{ textAlign: "right" }} title={tr("Recompensas por intervalo de progreso")}>{tr("Recompensa")}</th>
                        {withScope.length > 0 && (
                          <th style={{ textAlign: "right" }} title={tr("Tus personajes apuntados y lo que llevan aportado")}>
                            {tr("Tú")}
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((o) => {
                        const od = defs?.objs[o.id];
                        const opct =
                          od?.target && od.target > 0
                            ? Math.min(100, (o.progress / od.target) * 100)
                            : null;
                        return (
                          <tr key={o.id}>
                            <td>
                              {od?.career && CAREER_ICON[od.career] && (
                                <img className="kind-glyph" src={typeIcon(CAREER_ICON[od.career], 32)} alt="" title={od.career} />
                              )}{" "}
                              {od ? txt(od.t) : `${o.id.slice(0, 8)}… (${tr("definición pendiente del próximo SDE")})`}
                              {od?.militia != null && (
                                // Chapa, no escudo suelto: a 14px el logo no se reconocía y se
                                // quedaba huérfano en una segunda línea (parecía un icono roto).
                                <span
                                  className="camp-militia"
                                  title={tr("Solo milicianos de esta facción")}
                                >
                                  <img src={factionLogo(od.militia)} alt="" />
                                  {tr("Solo milicia")}
                                </span>
                              )}
                            </td>
                            <td className="muted">
                              {od?.method ? tr(METHOD_LABEL[od.method] ?? od.method) : "—"}
                            </td>
                            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                              {fmtSp(o.progress)}
                              {od?.target ? ` / ${fmtSp(od.target)}` : ""}
                              {opct != null && <span className="muted small"> · {opct.toFixed(0)}%</span>}
                            </td>
                            <td
                              style={{ textAlign: "right" }}
                              title={`${tr("Total apuntados")}: ${fmtSp(o.participants.total)} · ${tr("contribuyentes")}: ${fmtSp(o.participants.contributors)}`}
                            >
                              {fmtSp(o.participants.committed)}
                            </td>
                            <td style={{ textAlign: "right", whiteSpace: "nowrap" }} className="muted">
                              {od?.isk ? `${fmtSp(od.isk)} ISK` : ""}
                              {od?.lp ? ` · ${fmtSp(od.lp)} LP` : ""}
                              {od?.standing ? ` · +${od.standing}%` : ""}
                            </td>
                            {withScope.length > 0 && (
                              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                                {(mine.get(o.id) ?? []).length === 0 ? (
                                  <span className="muted">—</span>
                                ) : (
                                  (mine.get(o.id) ?? []).map((p) => (
                                    <img
                                      key={p.character_id}
                                      className={`camp-mine${p.is_committed ? " on" : ""}`}
                                      src={`https://images.evetech.net/characters/${p.character_id}/portrait?size=64`}
                                      alt={nameOf(p.character_id)}
                                      title={`${nameOf(p.character_id)} · ${
                                        p.is_committed ? tr("apuntado ahora") : tr("ya no apuntado")
                                      } · ${tr("aportado")}: ${fmtSp(p.contributed)}`}
                                    />
                                  ))
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        );
      })}
      <p className="muted small">
        {tr("Datos en vivo de ESI (rutas públicas, sin permisos) + definiciones del SDE. La participación enseña los comprometidos AHORA; el tooltip trae el total histórico y los que han contribuido.")}
      </p>
      <p className="muted small">
        {withScope.length > 0
          ? tr("La columna «Tú» sale de tus personajes que han concedido el permiso de campañas: retrato encendido = apuntado ahora mismo, apagado = ya no lo está pero su aportación cuenta. Pasa el ratón para ver cuánto lleva cada uno.")
          : tr("¿Quieres ver TU aportación en cada objetivo? Vuelve a iniciar sesión eligiendo «Campañas militares» en el diálogo de permisos. Es un permiso solo de lectura y no hace falta concederlo en todos los personajes: los que no lo tengan seguirán funcionando igual.")}
      </p>
      {msg && <div className="small muted">{msg}</div>}
    </div>
  );
}
