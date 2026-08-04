// Sección CAMPAÑAS — Military Campaigns (Cradle of War), fase 1 PÚBLICA (sin scope).
// ESI da el estado VIVO ({id UUID, state, progress} + objetivos paginados con participación en 3
// sabores); public/military_campaigns.json (SDE, mismas UUIDs) pone los textos ES/EN, recompensas
// por intervalo, método de contribución, carrera y requisito de milicia. Una campaña puede existir
// en ESI SIN definición aún (el SDE se exporta 1 vez/día): eso es NORMAL y se dice, no se esconde.
// Shapes verificados contra pegados reales de las rutas (2026-08-04). Fase 2 (tu contribución,
// scope esi.activity.char:read) pendiente de login solo-scope. RoGiz7, 2026-08-04.
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr, getLang } from "./i18n";
import { fmtSp, typeIcon } from "./format";
import { cleanEveText } from "./freelance";
import type { MilitaryCampaign, CampaignObjective } from "./types";

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

export function CampanasView() {
  const [defs, setDefs] = useState<CampDefs | null>(null);
  const [camps, setCamps] = useState<MilitaryCampaign[] | null>(null);
  const [objs, setObjs] = useState<Map<string, CampaignObjective[]>>(new Map());
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const es = getLang() === "es";
  const txt = (d?: { es: string; en: string }) => (d ? (es ? d.es : d.en) : "");

  useEffect(() => {
    fetch("/military_campaigns.json").then((r) => r.json()).then(setDefs).catch(() => setDefs(null));
    invoke<MilitaryCampaign[]>("get_military_campaigns")
      .then(setCamps)
      .catch((e) => {
        setCamps([]);
        setMsg(`${tr("Error")}: ${String(e).slice(0, 160)}`);
      });
  }, []);

  async function toggle(id: string) {
    if (open === id) {
      setOpen(null);
      return;
    }
    setOpen(id);
    if (!objs.has(id)) {
      try {
        const list = await invoke<CampaignObjective[]>("get_military_campaign_objectives", {
          campaignId: id,
        });
        setObjs((prev) => new Map(prev).set(id, list));
      } catch (e) {
        setMsg(`${tr("Error")}: ${String(e).slice(0, 160)}`);
      }
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
                                <img
                                  className="camp-militia"
                                  src={factionLogo(od.militia)}
                                  alt=""
                                  title={tr("Solo milicianos de esta facción")}
                                />
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
        {tr("Datos en vivo de ESI (rutas públicas, sin permisos) + definiciones del SDE. La participación enseña los comprometidos AHORA; el tooltip trae el total histórico y los que han contribuido. Tu contribución personal llegará en una fase próxima (requiere un permiso nuevo del juego).")}
      </p>
      {msg && <div className="small muted">{msg}</div>}
    </div>
  );
}
