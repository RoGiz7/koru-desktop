// Sección Planetología: colonias y extractores de Planetary Interaction del personaje.
// Extraído de App.tsx.
import { tr } from "./i18n";
import { fmtSp } from "./format";
import { Kpi } from "./charts";
import type { Planet } from "./types";

export function PlanetologiaView({ planets, busy }: { planets: Planet[] | null; busy: boolean }) {
  if (!planets) return <p className="muted">{busy ? tr("Cargando colonias…") : tr("Sin datos.")}</p>;
  if (planets.length === 0)
    return <p className="muted small">{tr("No tienes colonias de Planetary Interaction.")}</p>;
  const totalPins = planets.reduce((s, p) => s + p.num_pins, 0);
  return (
    <>
      <div className="kpis">
        <Kpi label={tr("Colonias")} value={fmtSp(planets.length)} />
        <Kpi label={tr("Estructuras (pins)")} value={fmtSp(totalPins)} />
      </div>
      <table className="km-table">
        <thead>
          <tr>
            <th>{tr("Sistema")}</th>
            <th>{tr("Tipo de planeta")}</th>
            <th>{tr("Nivel")}</th>
            <th>{tr("Estructuras")}</th>
            <th>{tr("Última actualización")}</th>
          </tr>
        </thead>
        <tbody>
          {planets.map((p, i) => (
            <tr key={i}>
              <td>{p.system_name ?? (p.system_id ? `#${p.system_id}` : "—")}</td>
              <td style={{ textTransform: "capitalize" }}>{p.planet_type}</td>
              <td>{p.upgrade_level}</td>
              <td>{p.num_pins}</td>
              <td>{p.last_update?.replace("T", " ").slice(0, 16) ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
