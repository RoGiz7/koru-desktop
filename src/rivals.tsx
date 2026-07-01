// Sección PvP · Batallas (clusters de killmails por sistema/momento) y Rivales (a quién matas /
// quién te mata, por personaje y corp). Extraído de App.tsx. RivalList (lista rankeada) es interno.
import { openUrl } from "@tauri-apps/plugin-opener";
import { tr } from "./i18n";
import { fmtIsk } from "./format";
import { Bars } from "./charts";
import type { Battle, Rivals, RivalEntry } from "./types";

function RivalList(props: { title: string; items: RivalEntry[]; kind: "char" | "corp" }) {
  const { title, items, kind } = props;
  const img = (id: number) =>
    kind === "char"
      ? `https://images.evetech.net/characters/${id}/portrait?size=32`
      : `https://images.evetech.net/corporations/${id}/logo?size=32`;
  const url = (id: number) =>
    kind === "char"
      ? `https://zkillboard.com/character/${id}/`
      : `https://zkillboard.com/corporation/${id}/`;
  return (
    <div className="rival-list">
      <h4>{title}</h4>
      {items.length === 0 && <p className="muted small">{tr("Sin datos.")}</p>}
      <ol>
        {items.map((e) => (
          <li key={e.id} className="rival-row" onClick={() => openUrl(url(e.id))} title={tr("Abrir en zKillboard")}>
            <img className="rival-img" src={img(e.id)} alt="" loading="lazy" />
            <span className="rival-name">{e.name ?? `#${e.id}`}</span>
            <span className="muted">{e.count}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function BattlesView(props: { data: Battle[] | null; busy: boolean }) {
  const { data, busy } = props;
  if (!data && busy) return <p className="muted">{tr("Cargando…")}</p>;
  if (!data || data.length === 0)
    return (
      <p className="muted small">
        {tr("Sin batallas detectadas. Sincroniza el histórico (y pulsa \"Reprocesar daño\") para tener los datos.")}
      </p>
    );
  return (
    <>
      <p className="muted small">
        {tr("Peleas detectadas (≥8 killmails en un sistema en menos de 1h). Click en una fila → battle report en zKillboard.")}
      </p>
      <table className="km-table">
        <thead>
          <tr>
            <th>{tr("Sistema")}</th>
            <th>{tr("Fecha")}</th>
            <th>{tr("Kills")}</th>
            <th>{tr("Losses")}</th>
            <th>ISK</th>
            <th>{tr("Total")}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((b) => (
            <tr
              key={`${b.system_id}-${b.slug}`}
              className="clickable"
              title={tr("Abrir battle report en zKillboard")}
              onClick={() => openUrl(`https://zkillboard.com/related/${b.system_id}/${b.slug}/`)}
            >
              <td>{b.system_name ?? `#${b.system_id}`}</td>
              <td>{b.start.replace("T", " ").slice(0, 16)}</td>
              <td>{b.kills}</td>
              <td>{b.losses}</td>
              <td>{fmtIsk(b.isk)}</td>
              <td>
                <strong>{b.total}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function RivalsView(props: { data: Rivals | null; busy: boolean }) {
  const { data, busy } = props;
  if (!data && busy) return <p className="muted">{tr("Cargando…")}</p>;
  if (!data) return <p className="muted small">{tr("Sin datos. Sincroniza killmails y pulsa \"Reprocesar daño\".")}</p>;
  return (
    <>
      <p className="muted small">
        {tr("Basado en tus killmails (necesita el JSON completo: si está vacío, pulsa \"Reprocesar daño\" en PvP).")}
      </p>
      {(data.you_kill_chars.length > 0 || data.kills_you_chars.length > 0) && (
        <div className="rivals-charts">
          <div className="panel resumen-panel">
            <h4>{tr("A quién más matas (top)")}</h4>
            <Bars
              items={data.you_kill_chars
                .slice(0, 8)
                .map((r) => ({ label: r.name ?? `#${r.id}`, value: r.count }))}
              color="#3fb950"
            />
          </div>
          <div className="panel resumen-panel">
            <h4>{tr("Quién más te mata (top)")}</h4>
            <Bars
              items={data.kills_you_chars
                .slice(0, 8)
                .map((r) => ({ label: r.name ?? `#${r.id}`, value: r.count }))}
              color="#e5534b"
            />
          </div>
        </div>
      )}
      <div className="rivals-grid">
        <RivalList title={tr("A quién más matas")} items={data.you_kill_chars} kind="char" />
        <RivalList title={tr("Corps que más matas")} items={data.you_kill_corps} kind="corp" />
        <RivalList title={tr("Quién más te mata")} items={data.kills_you_chars} kind="char" />
        <RivalList title={tr("Corps que más te matan")} items={data.kills_you_corps} kind="corp" />
      </div>
    </>
  );
}
