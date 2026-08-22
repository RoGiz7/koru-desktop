// Sección FLOTAS — grabar una op mientras la mandas.
//
// ★ POR QUÉ ESTA SECCIÓN EXISTE, y no es una pestaña de PvP: idea de RoGiz7 (2026-08-19). Se quiso
//   saber «con quién vuelas y en qué papel», y la vía obvia —deducirlo de los killmails— tiene un
//   agujero que la invalida: **los logi no salen en los killmails**. Un piloto que solo repara nunca
//   aparece como atacante, así que el tío que lleva dos años aprendiendo a llevar Guardian parecería
//   alguien que dejó de volar. Grabando el roster mientras mandas, los logi y los ojos están ahí por
//   construcción y no hay nada que deducir.
//
// ★ SOLO SE PUEDE GRABAR LO QUE MANDAS TÚ. La sonda del 2026-08-19 lo dejó medido: a quien no es el
//   FC, `/fleets/{id}/members/` le devuelve 404 — ni siquiera 403; le oculta que la flota exista.
//   Esto se dice en pantalla, no en un comentario: una sección que no explica su límite se lee como
//   una sección rota.
//
// ★ SE GRABA CON UN BOTÓN, A PROPÓSITO. Decisión suya: «mejor ser explícitos que quedarnos cortos».
//   Aquí se registran las posiciones de otras personas a lo largo del tiempo, y eso debe ser un acto
//   deliberado, no algo que ocurra porque la app estaba abierta.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { fmtSp, typeIcon } from "./format";
import { Kpi } from "./charts";
import { loadNewEden } from "./neweden";
import type { Character } from "./types";

export type OpEstado = {
  op_id: number;
  fleet_id: number;
  boss_id: number;
  grabando: boolean;
  miembros: number;
  cambios: number;
  sistemas: number;
  ticks: number;
  aviso: string | null;
};

export const SCOPE_FLOTA = "esi-fleets.read_fleet.v1";

type RosterMember = {
  character_id: number;
  name: string | null;
  ship_type_id: number | null;
  system_id: number | null;
  station_id: number | null;
  wing_id: number | null;
  squad_id: number | null;
  role: string | null;
  present: boolean;
};
type Roster = { members: RosterMember[]; wings: [number, number, string][] };

/** La estrella del mando: FC > ala > escuadra. Del `role` que da ESI. */
function galon(role: string | null): string {
  if (role === "fleet_commander") return "★ ";
  if (role === "wing_commander") return "☆ ";
  if (role === "squad_commander") return "▸ ";
  return "";
}

/** COMPOSICIÓN EN VIVO (idea de RoGiz7, 2026-08-22, nada más ver grabar la primera op): el FC ve
 *  aquí mismo quién va con quién y dónde está cada uno, sin abrir la ventana de flota del juego.
 *  Lee lo que el grabador YA guarda — cero llamadas extra a ESI por pintarla — y se refresca con
 *  cada sondeo (la prop `ticks` es la señal). La capa «flota en el mapa» queda para después. */
function RosterPanel({ opId, ticks }: { opId: number; ticks: number }) {
  const [roster, setRoster] = useState<Roster | null>(null);
  const [sysNames, setSysNames] = useState<Map<number, string>>(new Map());
  const [shipNames, setShipNames] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    loadNewEden()
      .then((ne) => setSysNames(new Map(ne.systems.map((s) => [s.id, s.n]))))
      .catch(() => {});
    fetch("/ships.json")
      .then((r) => r.json())
      .then((rows: { i: number; n: string }[]) =>
        setShipNames(new Map(rows.map((r) => [r.i, r.n]))),
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    invoke<Roster>("fleet_op_roster", { opId })
      .then(setRoster)
      .catch(() => {});
  }, [opId, ticks]);

  if (!roster || roster.members.length === 0) return null;

  // Nombres de ala/escuadra: la última versión vista gana (el orden ya viene por seen_at).
  const wingName = new Map<number, string>();
  const squadName = new Map<string, string>();
  for (const [w, s, n] of roster.wings) {
    if (s === 0) wingName.set(w, n);
    else squadName.set(`${w}:${s}`, n);
  }
  // Agrupar: ala → escuadra → miembros (el roster ya viene ordenado así del backend).
  const grupos = new Map<string, { titulo: string; filas: RosterMember[] }>();
  for (const m of roster.members) {
    const w = m.wing_id ?? -1;
    const s = m.squad_id ?? -1;
    const clave = `${w}:${s}`;
    if (!grupos.has(clave)) {
      const tw = wingName.get(w) ?? (w >= 0 ? `${tr("Ala")} ${w}` : "");
      const ts = squadName.get(clave) ?? (s > 0 ? `${tr("Escuadra")} ${s}` : "");
      grupos.set(clave, { titulo: [tw, ts].filter(Boolean).join(" · ") || tr("Sin encuadrar"), filas: [] });
    }
    grupos.get(clave)!.filas.push(m);
  }

  return (
    <div className="flt-roster">
      <div className="flt-roster-head">
        <strong>{tr("Composición")}</strong>
        <span className="muted small">
          {fmtSp(roster.members.filter((m) => m.present).length)} {tr("a bordo")}
        </span>
      </div>
      {[...grupos.values()].map((g) => (
        <div key={g.titulo} className="flt-grupo">
          <div className="flt-grupo-tit small muted">{g.titulo}</div>
          {g.filas.map((m) => (
            <div key={m.character_id} className={`flt-miembro${m.present ? "" : " fuera"}`}>
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
                  <img className="type-ico" src={typeIcon(m.ship_type_id)} alt="" loading="lazy" />
                  {shipNames.get(m.ship_type_id) ?? `#${m.ship_type_id}`}
                </span>
              )}
              <span className="flt-sys small muted">
                {m.system_id != null ? (sysNames.get(m.system_id) ?? `#${m.system_id}`) : ""}
                {m.station_id != null ? ` · ${tr("atracado")}` : ""}
                {!m.present ? ` · ${tr("salió")}` : ""}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Cada cuánto se sondea, en segundos.
 *
 *  ESI cachea los miembros 5 s, así que podría irse mucho más rápido; 30 s es a propósito. Una
 *  composición no cambia cada cinco segundos, y lo que de verdad se quiere capturar —quién cambia de
 *  nave, quién se queda atrás un salto— se ve igual de bien. A cambio, una op de tres horas son 360
 *  peticiones en vez de 2.160. */
export const TICK_SEG = 30;

export function FlotasView({
  characters,
  subject,
  estado,
  onStart,
  onStop,
  busy,
  error,
}: {
  characters: Character[];
  subject: number | "global";
  estado: OpEstado | null;
  onStart: (characterId: number, name: string) => void;
  onStop: () => void;
  busy: boolean;
  error: string | null;
}) {
  const conScope = characters.filter((c) => c.scopes?.includes(SCOPE_FLOTA));
  const [quien, setQuien] = useState<number | null>(
    typeof subject === "number" ? subject : (conScope[0]?.character_id ?? null),
  );
  const [nombre, setNombre] = useState("");

  if (conScope.length === 0) {
    return (
      <div className="flt-vacio">
        <p className="muted">
          {tr(
            "Ningún personaje tiene el permiso de flotas todavía. Se concede con «＋ Conceder acceso» → Set completo.",
          )}
        </p>
      </div>
    );
  }

  const grabando = !!estado?.grabando;

  return (
    <>
      <p className="muted small">
        {tr(
          "Graba la composición y el movimiento de una flota MIENTRAS LA MANDAS. Con los killmails no basta: un piloto que solo repara nunca aparece en ellos, así que los logi y los ojos solo se ven grabando el roster.",
        )}
      </p>

      {/* El límite, dicho de frente y arriba. Descubrirlo al pulsar el botón y recibir un error
          haría parecer que la app falla, cuando es el juego el que no lo permite. */}
      <p className="small muted flt-limite">
        {tr(
          "Solo se puede grabar la flota que mandas tú: a quien no es el comandante, EVE no le deja leer los miembros.",
        )}
      </p>

      {grabando ? (
        <div className="flt-grabando">
          <div className="flt-cabecera">
            <span className="flt-punto" />
            <strong>{tr("Grabando")}</strong>
            <span className="muted small">
              {tr("un sondeo cada SEG segundos").replace("SEG", String(TICK_SEG))}
            </span>
          </div>
          <div className="kpis">
            <Kpi label={tr("En la flota")} value={fmtSp(estado!.miembros)} />
            <Kpi label={tr("Sistemas ocupados")} value={fmtSp(estado!.sistemas)} />
            <Kpi label={tr("Sondeos")} value={fmtSp(estado!.ticks)} />
          </div>
          <p className="small muted">
            {/* «0 cambios» es lo normal la mayor parte del tiempo y hay que decirlo, o se lee como
                que la grabación no está haciendo nada. */}
            {estado!.cambios > 0
              ? tr("CAMBIOS cambios en el último sondeo.").replace(
                  "CAMBIOS",
                  String(estado!.cambios),
                )
              : tr("Sin cambios en el último sondeo — es lo normal: solo se guarda lo que cambia.")}
          </p>
          <button className="ida-btn danger" onClick={onStop} disabled={busy}>
            {tr("Terminar la grabación")}
          </button>
          {/* La composición, debajo de los KPI: el «quién va con quién y dónde» que en el juego
              obliga a tener la ventana de flota abierta. Se refresca con cada sondeo. */}
          <RosterPanel opId={estado!.op_id} ticks={estado!.ticks} />
        </div>
      ) : (
        <div className="flt-arranque">
          <label className="small">
            {tr("Quién la manda")}:&nbsp;
            <select
              value={quien ?? ""}
              onChange={(e) => setQuien(Number(e.target.value) || null)}
            >
              {conScope.map((c) => (
                <option key={c.character_id} value={c.character_id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="small">
            {tr("Nombre de la op")}:&nbsp;
            <input
              type="text"
              value={nombre}
              placeholder={tr("opcional — para reconocerla luego")}
              onChange={(e) => setNombre(e.target.value)}
            />
          </label>
          <button
            className="ida-btn ida-primary flt-rec"
            disabled={busy || !quien}
            onClick={() => quien && onStart(quien, nombre.trim())}
          >
            ⏺ {tr("Esto es una op, grábala")}
          </button>
        </div>
      )}

      {estado?.aviso && <p className="small flt-aviso">{estado.aviso}</p>}
      {error && <p className="small fits-err">{error}</p>}

      {/* La advertencia de privacidad va DENTRO de la sección, no en unos ajustes que nadie abre.
          Es lo más sensible que guarda Koru y quien pulsa el botón debería saberlo antes. */}
      <p className="small muted flt-privacidad">
        {tr(
          "Lo grabado incluye a tus compañeros: su nave y su sistema a lo largo del tiempo. Se queda en tu ordenador y no se envía a ningún sitio, pero es lo más sensible que guarda Koru — cuidado con las capturas.",
        )}
      </p>
    </>
  );
}
