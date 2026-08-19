// Sección PvP · Batallas (clusters de killmails por sistema/momento) y Rivales (a quién matas /
// quién te mata, por personaje y corp). Extraído de App.tsx. RivalList (lista rankeada) es interno.
import { tr } from "./i18n";
import { fmtIsk, fmtSp, typeIcon } from "./format";
import { Bars, Kpi } from "./charts";
import type { Battle, Rivals, RivalEntry, Wingmates } from "./types";
import { openExternal } from "./openExternal";

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
          <li key={e.id} className="rival-row" onClick={() => openExternal(url(e.id))} title={tr("Abrir en zKillboard")}>
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
              onClick={() => openExternal(`https://zkillboard.com/related/${b.system_id}/${b.slug}/`)}
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

/**
 * **Con quién vuelas** — la gente que aparece como atacante en TUS kills.
 *
 * No sale de `/fleets/`: la sonda demostró que el roster **solo lo lee el FC**, así que ESI no puede
 * decir con quién volabas, y menos aún en 2019. Esto sí puede, porque el JSON completo de cada
 * killmail lleva años guardado.
 *
 * **La columna que hace honesta a la tabla es «en banda»**: estar en el mismo killmail que doscientas
 * personas no es volar con ellas. Por eso el orden es por banda pequeña primero y no por total — si
 * no, la gente con la que de verdad haces gang quedaría enterrada bajo los blobs.
 */
export function WingmatesView(props: {
  data: Wingmates | null;
  busy: boolean;
  /** Ventana activa en días (0 = todo) y cómo cambiarla. El filtrado es del backend: los totales
   *  por compañero se agregan allí, así que recortar en el frontend daría columnas que no suman. */
  dias: number;
  onDias: (d: number) => void;
}) {
  const { data, busy, dias, onDias } = props;
  const ventanas: { d: number; label: string }[] = [
    { d: 0, label: tr("Todo") },
    { d: 730, label: tr("2 años") },
    { d: 365, label: tr("1 año") },
    { d: 90, label: tr("90 días") },
  ];
  const selector = (
    <div className="rateo-controls">
      <div className="seg seg-sm">
        {ventanas.map((v) => (
          <button key={v.d} className={dias === v.d ? "active" : ""} onClick={() => onDias(v.d)}>
            {v.label}
          </button>
        ))}
      </div>
    </div>
  );
  if (!data && busy)
    return (
      <>
        {selector}
        <p className="muted">{tr("Cargando…")}</p>
      </>
    );
  if (!data) return <p className="muted small">{tr("Sin datos. Sincroniza killmails y pulsa \"Reprocesar daño\".")}</p>;
  const fecha = (s: string | null) => (s ? s.slice(0, 10) : "—");
  if (data.kills_mirados === 0)
    return (
      <>
        {selector}
        <p className="muted small">
          {data.kills_fuera > 0
            ? tr("En esta ventana no hay ningún kill tuyo. Fuera de ella hay FUERA.").replace(
                "FUERA",
                fmtSp(data.kills_fuera),
              )
            : tr(
                "No hay kills con el JSON completo. Pulsa «Reprocesar daño» en PvP: sin el detalle no se sabe quién más estaba.",
              )}
        </p>
      </>
    );

  return (
    <>
      <p className="muted small">
        {tr(
          "Quien aparece contigo en un killmail estaba contigo. Sale de tus kills guardados, no de la API de flotas: esa solo la puede leer quien manda la flota.",
        )}
      </p>
      {selector}

      <div className="kpis">
        <Kpi label={tr("Kills mirados")} value={fmtSp(data.kills_mirados)} />
        <Kpi label={tr("Compañeros distintos")} value={fmtSp(data.total_mates)} />
        <Kpi label={tr("Kills en solitario")} value={fmtSp(data.kills_solo)} />
      </div>

      {/* La ceguera y el umbral, juntos y arriba: los dos corrigen una lectura que ya se ha hecho
          al mirar los KPI. Y el umbral de banda es ARBITRARIO — esconderlo lo disfrazaría de
          verdad. */}
      <p className="muted small prod-ceguera">
        {dias > 0 && data.kills_fuera > 0 && (
          <>
            {tr("Ventana activa: quedan FUERA kills tuyos anteriores.").replace(
              "FUERA",
              fmtSp(data.kills_fuera),
            )}{" "}
          </>
        )}
        {data.desde && (
          <>
            {dias > 0
              ? tr("El kill más antiguo de esta ventana es del")
              : tr("El killmail más antiguo guardado es del")}{" "}
            <strong>{fecha(data.desde)}</strong>.{" "}
            {dias === 0 && tr("Antes de eso no es que volaras solo: es que no hay datos.")}{" "}
          </>
        )}
        {tr("«En banda» = kills con SIGNO atacantes o menos.").replace(
          "SIGNO",
          String(data.banda_pequena),
        )}{" "}
        {tr("Tus propios personajes no salen en la lista: con multibox coparían el podio.")}
        {data.total_mates > data.mates.length && (
          <>
            {" "}
            {tr("Se enseñan los TOP de LARGO compañeros.")
              .replace("TOP", String(data.mates.length))
              .replace("LARGO", fmtSp(data.total_mates))}
          </>
        )}
      </p>

      {data.mates.length === 0 ? (
        <p className="muted small">
          {tr("Todos tus kills fueron en solitario (o sin nadie más identificable).")}
        </p>
      ) : (
        <table className="km-table">
          <thead>
            <tr>
              <th>{tr("Piloto")}</th>
              <th>{tr("En banda")}</th>
              {/* «Días» va ANTES que «kills juntos» a propósito: es la columna que distingue a un
                  compañero de vuelo de alguien que estuvo en la misma op enorme una noche. */}
              <th>{tr("Días juntos")}</th>
              <th>{tr("Kills juntos")}</th>
              <th>{tr("Su nave habitual")}</th>
              <th>{tr("Desde")}</th>
              <th>{tr("Última vez")}</th>
            </tr>
          </thead>
          <tbody>
            {data.mates.map((m) => (
              <tr
                key={m.character_id}
                className="clickable"
                title={tr("Abrir en zKillboard")}
                onClick={() => openExternal(`https://zkillboard.com/character/${m.character_id}/`)}
              >
                <td className="wm-pilot">
                  <img
                    className="rival-img"
                    src={`https://images.evetech.net/characters/${m.character_id}/portrait?size=32`}
                    alt=""
                    loading="lazy"
                  />
                  {m.name ?? `#${m.character_id}`}
                </td>
                <td>
                  <strong>{m.kills_banda}</strong>
                </td>
                <td>{m.dias}</td>
                <td
                  className="muted"
                  title={
                    m.dias === 1
                      ? tr("Todo en un solo día: coincidisteis en una operación, no es que voléis juntos.")
                      : undefined
                  }
                >
                  {m.kills}
                  {m.dias === 1 && m.kills > 10 && <span className="prod-falta"> ·1d</span>}
                </td>
                <td>
                  {m.ship_type_id && (
                    <img
                      className="wm-ship"
                      src={typeIcon(m.ship_type_id, 32) ?? undefined}
                      alt=""
                      width={20}
                      height={20}
                      loading="lazy"
                    />
                  )}
                  {m.ship_name ?? "—"}
                </td>
                <td className="muted">{fecha(m.first_seen)}</td>
                <td className="muted">{fecha(m.last_seen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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
