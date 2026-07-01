// Sección Personaje · Contactos y standings: listas de contactos y standings con su color.
// Extraído de App.tsx. contactLogo/KIND_ES son internos.
import { tr } from "./i18n";
import { fmtSp, standingColor } from "./format";
import { Kpi } from "./charts";
import type { ContactRow, StandingRow } from "./types";

function contactLogo(kind: string, id: number): string | null {
  if (kind === "character") return `https://images.evetech.net/characters/${id}/portrait?size=32`;
  if (kind === "corporation") return `https://images.evetech.net/corporations/${id}/logo?size=32`;
  if (kind === "alliance") return `https://images.evetech.net/alliances/${id}/logo?size=32`;
  return null;
}
const KIND_ES: Record<string, string> = {
  character: "Personaje",
  corporation: "Corporación",
  alliance: "Alianza",
  faction: "Facción",
  agent: "Agente",
  npc_corp: "Corp NPC",
};

export function ContactosView({
  contacts,
  standings,
  busy,
}: {
  contacts: ContactRow[] | null;
  standings: StandingRow[] | null;
  busy: boolean;
}) {
  if (!contacts) return <p className="muted">{busy ? tr("Cargando…") : tr("Sin datos.")}</p>;
  const goodC = contacts.filter((c) => c.standing > 0).length;
  const badC = contacts.filter((c) => c.standing < 0).length;
  return (
    <>
      <div className="kpis">
        <Kpi label={tr("Contactos")} value={fmtSp(contacts.length)} />
        <Kpi label={tr("Positivos")} value={fmtSp(goodC)} tone="pos" />
        <Kpi label={tr("Negativos")} value={fmtSp(badC)} tone="neg" />
        {standings && <Kpi label={tr("Standings NPC")} value={fmtSp(standings.length)} />}
      </div>

      <div className="top-list">
        <h4>{tr("Tus contactos")}</h4>
        {contacts.length === 0 ? (
          <p className="muted small">{tr("No tienes contactos.")}</p>
        ) : (
          <table className="km-table cat-table">
            <thead>
              <tr>
                <th>{tr("Contacto")}</th>
                <th>{tr("Tipo")}</th>
                <th style={{ textAlign: "right" }}>Standing</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => {
                const logo = contactLogo(c.kind, c.id);
                return (
                  <tr key={c.id}>
                    <td>
                      {logo && (
                        <img
                          className="type-ico"
                          src={logo}
                          alt=""
                          loading="lazy"
                          style={{ borderRadius: c.kind === "character" ? "50%" : "3px" }}
                        />
                      )}
                      {c.name ?? `#${c.id}`}
                      {c.watched && <span title={tr("En seguimiento")}> 👁️</span>}
                      {c.blocked && <span title={tr("Bloqueado")}> 🚫</span>}
                    </td>
                    <td>{tr(KIND_ES[c.kind] ?? c.kind)}</td>
                    <td style={{ textAlign: "right", color: standingColor(c.standing), fontWeight: 600 }}>
                      {c.standing.toFixed(1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="top-list">
        <h4>{tr("Standings con NPC")}</h4>
        {!standings || standings.length === 0 ? (
          <p className="muted small">{tr("Sin standings (o falta el scope de standings; reloguea con acceso).")}</p>
        ) : (
          <table className="km-table cat-table">
            <thead>
              <tr>
                <th>{tr("Entidad")}</th>
                <th>{tr("Tipo")}</th>
                <th style={{ textAlign: "right" }}>Standing</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((s) => (
                <tr key={`${s.kind}-${s.id}`}>
                  <td>{s.name ?? `#${s.id}`}</td>
                  <td>{tr(KIND_ES[s.kind] ?? s.kind)}</td>
                  <td style={{ textAlign: "right", color: standingColor(s.standing), fontWeight: 600 }}>
                    {s.standing.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
