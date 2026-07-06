// Misiones — dos caras de la misma moneda, ambas por personaje y sin scope de más allá de los ya
// concedidos: (1) LEALTAD (LP) por corporación NPC = la recompensa de misiones (read_loyalty); y
// (2) AGENTES con los que progresas = tus standings de tipo "agent" (read_loyalty ya trae standings
// en la app vía Contactos), que SUBEN a medida que haces sus misiones → proxy de progreso. El nivel
// del agente lo cruza con public/agents.json (extraído del SDE). Su ubicación se verá en el mapa.
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { fmtSp, standingColor } from "./format";
import type { LoyaltyCorp, StandingRow } from "./types";

type AgentMeta = Record<string, { s: number; l: number; c: number; t: number }>;

export function LealtadView({ subject }: { subject: number | "global" }) {
  const isGlobal = subject === "global";
  const [lp, setLp] = useState<LoyaltyCorp[] | null>(null);
  const [agents, setAgents] = useState<StandingRow[]>([]);
  const [agentMeta, setAgentMeta] = useState<AgentMeta | null>(null);

  useEffect(() => {
    if (isGlobal) {
      setLp([]);
      setAgents([]);
      return;
    }
    let alive = true;
    setLp(null);
    setAgents([]);
    invoke<LoyaltyCorp[]>("get_loyalty", { characterId: subject })
      .then((d) => alive && setLp(d))
      .catch(() => alive && setLp([]));
    invoke<StandingRow[]>("get_standings", { characterId: subject })
      .then((rows) => alive && setAgents(rows.filter((r) => r.kind === "agent")))
      .catch(() => alive && setAgents([]));
    return () => {
      alive = false;
    };
  }, [subject]);

  // Metadatos de agentes (nivel/ubicación/corp) del SDE, una sola vez.
  useEffect(() => {
    let alive = true;
    fetch("/agents.json")
      .then((r) => r.json())
      .then((j: AgentMeta) => alive && setAgentMeta(j))
      .catch(() => alive && setAgentMeta({}));
    return () => {
      alive = false;
    };
  }, []);

  if (isGlobal)
    return <p className="muted small">{tr("Selecciona un personaje para ver sus misiones (LP y agentes).")}</p>;
  if (lp === null) return <p className="muted">{tr("Cargando…")}</p>;

  const total = lp.reduce((n, c) => n + c.loyalty_points, 0);
  const max = Math.max(...lp.map((c) => c.loyalty_points), 1);
  const agentRows = [...agents].sort((a, b) => b.standing - a.standing);

  if (lp.length === 0 && agentRows.length === 0)
    return (
      <p className="muted small">
        {tr("Sin LP ni agentes todavía. Haz misiones para una corporación NPC (y concede lealtad/standings al reloguear).")}
      </p>
    );

  return (
    <>
      {/* ---- Lealtad (LP) ---- */}
      {lp.length > 0 && (
        <>
          <div className="lp-total">
            <span className="lp-total-num">{fmtSp(total)}</span>
            <span className="muted small">
              {tr("LP total en")} {lp.length} {tr("corporaciones")}
            </span>
          </div>
          <div className="lp-list">
            {lp.map((c) => (
              <div key={c.corporation_id} className="lp-row">
                <img
                  className="lp-logo"
                  src={`https://images.evetech.net/corporations/${c.corporation_id}/logo?size=32`}
                  alt=""
                  loading="lazy"
                />
                <div className="lp-info">
                  <strong>{c.corporation_name ?? `Corp ${c.corporation_id}`}</strong>
                  <div className="lp-bar">
                    <div className="lp-bar-fill" style={{ width: `${(c.loyalty_points / max) * 100}%` }} />
                  </div>
                </div>
                <span className="lp-val">{fmtSp(c.loyalty_points)} LP</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ---- Agentes (progreso por standing) ---- */}
      {agentRows.length > 0 && (
        <>
          <div className="bit-head">
            <h4>🧑‍✈️ {tr("Agentes")}</h4>
            <span className="muted small">
              {agentRows.length} {tr("agentes · el standing sube con sus misiones")}
            </span>
          </div>
          <div className="lp-list">
            {agentRows.map((a) => {
              const lvl = agentMeta?.[String(a.id)]?.l;
              return (
                <div key={a.id} className="lp-row">
                  <span className="ag-lvl">{lvl ? `L${lvl}` : "·"}</span>
                  <div className="lp-info">
                    <strong>{a.name ?? `${tr("Agente")} ${a.id}`}</strong>
                  </div>
                  <span className="lp-val" style={{ color: standingColor(a.standing) }}>
                    {a.standing.toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      <p className="muted small bit-foot">
        {tr("Los agentes salen de tus standings: cada uno sube al progresar sus misiones. Su ubicación se verá en el mapa.")}
      </p>
    </>
  );
}
