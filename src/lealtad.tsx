// Lealtad (LP) — puntos de lealtad por corporación NPC, la recompensa de misiones. ESI solo
// expone el SALDO actual (no el historial de misiones ni los briefings de agente), así que
// mostramos cuánto LP tienes en cada corp, con su logo, una barra relativa y el total. Por
// personaje (el LP es de cada personaje). Scope: esi-characters.read_loyalty.v1 (best-effort).
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { fmtSp } from "./format";
import type { LoyaltyCorp } from "./types";

export function LealtadView({ subject }: { subject: number | "global" }) {
  const isGlobal = subject === "global";
  const [lp, setLp] = useState<LoyaltyCorp[] | null>(null);

  useEffect(() => {
    if (isGlobal) {
      setLp([]);
      return;
    }
    let alive = true;
    setLp(null);
    invoke<LoyaltyCorp[]>("get_loyalty", { characterId: subject })
      .then((d) => alive && setLp(d))
      .catch(() => alive && setLp([]));
    return () => {
      alive = false;
    };
  }, [subject]);

  if (isGlobal)
    return <p className="muted small">{tr("Selecciona un personaje para ver sus puntos de lealtad.")}</p>;
  if (lp === null) return <p className="muted">{tr("Cargando…")}</p>;
  if (lp.length === 0)
    return (
      <p className="muted small">
        {tr("Sin LP todavía. Haz misiones para una corporación NPC (y concede el acceso de lealtad al reloguear).")}
      </p>
    );

  const total = lp.reduce((n, c) => n + c.loyalty_points, 0);
  const max = Math.max(...lp.map((c) => c.loyalty_points), 1);

  return (
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
      <p className="muted small bit-foot">
        {tr("ESI expone el saldo de LP, no el historial de misiones. Gasta tu LP en las tiendas de lealtad de cada corp.")}
      </p>
    </>
  );
}
