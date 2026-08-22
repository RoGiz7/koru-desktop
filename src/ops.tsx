// Flotas → «Tus ops»: el VISOR de grabaciones — la película de cada op terminada.
//
// ★ POR QUÉ ES UNA PELÍCULA Y NO UNA TABLA: el grabador guarda CAMBIOS, no sondeos (quién entró,
//   quién cambió de nave, quién saltó, quién atracó, quién se fue). Releídos por orden son la
//   narración de la op — «a las 14:07 kukumiku pasó a Capsule» cuenta una muerte mejor que
//   cualquier agregado. Los agregados ya viven en «Con quién vuelas»; aquí se cuenta UNA op.
//
// ★ LA REGLA DE LA CASA, otra vez: el hueco es CEGUERA, no quietud. Si entre dos eventos pasó
//   media hora sin sondeos (Koru cerrado, reinicio…), la película lo declara con un separador en
//   vez de fingir que no pasó nada. `ticks` y `last_tick` existen exactamente para esto.
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { fmtSp, typeIcon } from "./format";
import { Kpi } from "./charts";
import { loadNewEden } from "./neweden";
import { galon, loadShipNames, type Roster } from "./flotas";
import type { Character } from "./types";

type OpSummary = {
  op_id: number;
  fleet_id: number;
  boss_id: number;
  name: string | null;
  started_at: string;
  ended_at: string | null;
  last_tick: string | null;
  ticks: number;
  members: number;
  systems: number;
  events: number;
};
type EventRow = {
  at: string;
  character_id: number;
  kind: string;
  ship_type_id: number | null;
  system_id: number | null;
  station_id: number | null;
  wing_id: number | null;
  squad_id: number | null;
};
type OpEvents = { events: EventRow[]; names: Record<string, string> };

function fmtDur(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}
function fmtFechaHora(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}
function fmtHoraEv(iso: string): string {
  return iso.slice(11, 19);
}

/** Un hueco entre eventos lo bastante grande para no ser un sondeo perdido: se DECLARA. Dos
 *  sondeos y pico — por debajo de eso sería ruido, por encima es Koru sin mirar. */
const HUECO_MS = 150 * 1000;

export function OpsView({ characters }: { characters: Character[] }) {
  const [ops, setOps] = useState<OpSummary[] | null>(null);
  const [abierta, setAbierta] = useState<number | null>(null);
  const [eventos, setEventos] = useState<OpEvents | null>(null);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [sysNames, setSysNames] = useState<Map<number, string>>(new Map());
  const [shipNames, setShipNames] = useState<Map<number, string>>(new Map());
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    invoke<OpSummary[]>("fleet_ops_list").then(setOps).catch((e) => setErr(String(e)));
    loadNewEden()
      .then((ne) => setSysNames(new Map(ne.systems.map((s) => [s.id, s.n]))))
      .catch(() => {});
    loadShipNames().then(setShipNames).catch(() => {});
  }, []);

  const abrir = async (op: OpSummary) => {
    setAbierta(op.op_id);
    setEventos(null);
    setRoster(null);
    try {
      const [ev, ro] = await Promise.all([
        invoke<OpEvents>("fleet_op_events", { opId: op.op_id }),
        invoke<Roster>("fleet_op_roster", { opId: op.op_id }),
      ]);
      setEventos(ev);
      setRoster(ro);
    } catch (e) {
      setErr(String(e));
    }
  };

  const bossName = (id: number) =>
    characters.find((c) => c.character_id === id)?.name ?? `#${id}`;

  const op = useMemo(() => ops?.find((o) => o.op_id === abierta) ?? null, [ops, abierta]);

  /** La frase de un evento. El VERBO importa: «cambió algo» no cuenta ninguna película. */
  const frase = (e: EventRow): string => {
    switch (e.kind) {
      case "join":
        return tr("entra en la flota");
      case "leave":
        return tr("sale de la flota");
      case "ship":
        return `${tr("cambia a")} ${e.ship_type_id != null ? (shipNames.get(e.ship_type_id) ?? `#${e.ship_type_id}`) : "?"}`;
      case "move":
        return `${tr("salta a")} ${e.system_id != null ? (sysNames.get(e.system_id) ?? `#${e.system_id}`) : "?"}`;
      case "dock":
        return tr("atraca");
      case "undock":
        return tr("desatraca");
      case "squad":
        return tr("cambia de puesto");
      default:
        return e.kind;
    }
  };

  if (err) return <div className="error">{err}</div>;
  if (!ops) return <div className="muted">{tr("Cargando…")}</div>;
  if (ops.length === 0)
    return (
      <p className="muted">
        {tr(
          "Todavía no hay ninguna op grabada. Se graban desde «Grabar una op», mientras mandas una flota.",
        )}
      </p>
    );

  return (
    <div className="ops-cols">
      <div className="ops-lista">
        {ops.map((o) => (
          <button
            key={o.op_id}
            className={`ops-item${abierta === o.op_id ? " on" : ""}`}
            onClick={() => abrir(o)}
          >
            <span className="ops-item-nom">
              {o.name || `${tr("Op del")} ${fmtFechaHora(o.started_at).slice(0, 10)}`}
              {o.ended_at == null && <em className="ops-viva"> · {tr("grabando ahora")}</em>}
            </span>
            <span className="muted small">
              {fmtFechaHora(o.started_at)} · {bossName(o.boss_id)}
            </span>
            <span className="muted small">
              {fmtSp(o.members)} {tr("pilotos")} · {fmtSp(o.systems)} {tr("sistemas")} ·{" "}
              {fmtSp(o.events)} {tr("eventos")}
            </span>
          </button>
        ))}
      </div>

      <div className="ops-detalle">
        {op == null && <p className="muted small">{tr("Elige una op de la lista.")}</p>}
        {op != null && (
          <>
            <div className="kpis">
              <Kpi
                label={tr("Duración")}
                value={
                  op.ended_at
                    ? fmtDur(Date.parse(op.ended_at) - Date.parse(op.started_at))
                    : tr("en curso")
                }
              />
              <Kpi label={tr("Pilotos")} value={fmtSp(op.members)} />
              <Kpi label={tr("Sistemas")} value={fmtSp(op.systems)} />
              <Kpi label={tr("Sondeos")} value={fmtSp(op.ticks)} />
            </div>

            {/* Roster FINAL de la op, agrupado por ala/escuadra — la foto de quién fue. */}
            {roster && (
              <div className="ops-roster">
                {(() => {
                  const wingName = new Map<number, string>();
                  const squadName = new Map<string, string>();
                  for (const [w, s, n] of roster.wings) {
                    if (s === 0) wingName.set(w, n);
                    else squadName.set(`${w}:${s}`, n);
                  }
                  const grupos = new Map<string, { titulo: string; filas: typeof roster.members }>();
                  for (const m of roster.members) {
                    const w = m.wing_id ?? -1;
                    const s = m.squad_id ?? -1;
                    const clave = `${w}:${s}`;
                    if (!grupos.has(clave)) {
                      const twn = wingName.get(w) ?? (w >= 0 ? `${tr("Ala")} ${w}` : "");
                      const tsn = squadName.get(clave) ?? (s > 0 ? `${tr("Escuadra")} ${s}` : "");
                      grupos.set(clave, {
                        titulo: [twn, tsn].filter(Boolean).join(" · ") || tr("Sin encuadrar"),
                        filas: [],
                      });
                    }
                    grupos.get(clave)!.filas.push(m);
                  }
                  return [...grupos.values()].map((g) => (
                    <div key={g.titulo} className="flt-grupo">
                      <div className="flt-grupo-tit small muted">{g.titulo}</div>
                      {g.filas.map((m) => (
                        <div key={m.character_id} className="flt-miembro">
                          <img
                            className="flt-cara"
                            src={`https://images.evetech.net/characters/${m.character_id}/portrait?size=32`}
                            alt=""
                            loading="lazy"
                          />
                          <span className="flt-nombre">
                            {galon(m.role)}
                            {m.name ?? `#${m.character_id}`}
                          </span>
                          {m.ship_type_id != null && (
                            <span className="flt-nave small">
                              <img
                                className="type-ico"
                                src={typeIcon(m.ship_type_id)}
                                alt=""
                                loading="lazy"
                              />
                              {shipNames.get(m.ship_type_id) ?? `#${m.ship_type_id}`}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ));
                })()}
              </div>
            )}

            {/* LA PELÍCULA: los eventos por orden, con los huecos DECLARADOS. */}
            <div className="ops-peli">
              <div className="flt-roster-head">
                <strong>{tr("La película")}</strong>
                <span className="muted small">
                  {eventos ? fmtSp(eventos.events.length) : "…"} {tr("eventos")}
                </span>
              </div>
              {eventos == null && <p className="muted small">{tr("Cargando…")}</p>}
              {eventos &&
                eventos.events.map((e, i) => {
                  const prev = i > 0 ? eventos.events[i - 1] : null;
                  const hueco =
                    prev != null && Date.parse(e.at) - Date.parse(prev.at) > HUECO_MS
                      ? Date.parse(e.at) - Date.parse(prev.at)
                      : null;
                  const nombre = eventos.names[String(e.character_id)] ?? `#${e.character_id}`;
                  return (
                    <div key={`${e.at}-${e.character_id}-${i}`}>
                      {hueco != null && (
                        <div className="ops-hueco small muted">
                          {/* Ceguera declarada: media hora sin eventos NO es media hora quieta. */}
                          ⋯ {fmtDur(hueco)} {tr("sin cambios (o sin mirar: los huecos largos son Koru cerrado)")}
                        </div>
                      )}
                      <div className={`ops-ev ops-ev-${e.kind}`}>
                        <span className="ops-ev-hora small muted">[{fmtHoraEv(e.at)}]</span>
                        <img
                          className="flt-cara ops-ev-cara"
                          src={`https://images.evetech.net/characters/${e.character_id}/portrait?size=32`}
                          alt=""
                          loading="lazy"
                        />
                        <span className="ops-ev-quien">{nombre}</span>
                        <span className="ops-ev-que">{frase(e)}</span>
                        {e.kind === "ship" && e.ship_type_id != null && (
                          <img
                            className="type-ico"
                            src={typeIcon(e.ship_type_id)}
                            alt=""
                            loading="lazy"
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
