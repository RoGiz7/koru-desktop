// ★ WORMHOLES → EL FABRICADOR — el planificador de RAMPANCY (2026-09-19).
//
// La sección se llama «Wormholes» (la categoría) y no «Fabricador» (el sitio): él no sabía qué era
// al verlo en el menú, y a la mayoría le pasará igual. El fichero conserva el nombre del sitio
// porque es lo que hay dentro hoy; si llega más contenido de agujero, esto pasa a ser una pieza.
//
// El Rampant Drone Fabricator (C1-C6, permanente desde la 24.01 del 2026-07-23) escala por un
// sistema de puntos, la «Rampancy», que es LA SUMA de las naves que hay cerca del Fabricator:
// tres umbrales, 12 (Moderada) · 36 (Severa) · 72 (Crítica). El juego enseña el valor en el Info
// Panel ENTRE OLEADAS, o sea, cuando ya estás dentro. Lo que decide una tarde es la composición
// que se elige ANTES de saltar el agujero: un Marauder de más te sube de nivel, un crucero de más
// no. Eso es lo que hace esta pantalla, con lo que Koru ya sabe sin preguntar nada: la nave que
// lleva puesta cada piloto conectado (`poll_positions`, cada 30 s) y el grupo de cada nave
// (`ships.json`). Ningún tercero lo tiene.
//
// ★ LA TABLA ES LA DE LAS PATCH NOTES 24.01 (leídas en la fuente el 2026-09-19), y es una suma
//   ESTÁTICA por nave presente — la wiki de EVE Uni dice «with each wave» y es redacción floja.
//   Lo que no está en la tabla (fragatas, destructores, industriales…) suma 0.
//
// ⚠️ LO QUE ESTO NO ES: no lee el valor del sitio ni sabe quién está a 50 km del Fabricator. Es la
//   composición que TÚ declaras —tus pilotos con su nave real, más los compañeros que añadas— y lo
//   que sumaría si todos están cerca. Y sitios solo en C1-C6.
import { useEffect, useMemo, useState } from "react";
import { tr } from "./i18n";
import { fmtSp, typeIcon } from "./format";
import { Kpi } from "./charts";
import { loadJson } from "./staticJson";
import { openExternal } from "./openExternal";
import type { CharacterCard } from "./types";
import { AbyssalRunsView } from "./abyssalRuns";

type Nave = { i: number; n: string; g: string };

/** Puntos de Rampancy por GRUPO de `ships.json`. Fuente: patch notes 24.01 (2026-07-23.1). */
const RAMPANCY_POR_GRUPO: Record<string, number> = {
  // «Capital (other)» — todo capital que no sea FAX.
  Dreadnought: 72,
  "Lancer Dreadnought": 72,
  Carrier: 72,
  "Command Carrier": 72,
  Supercarrier: 72,
  Titan: 72,
  "Capital Industrial Ship": 72,
  Freighter: 72,
  "Jump Freighter": 72,
  "Force Auxiliary": 36,
  Marauder: 12,
  "Black Ops": 8,
  Battleship: 6,
  "Strategic Cruiser": 4,
  "Command Ship": 3,
  "Combat Battlecruiser": 2,
  "Attack Battlecruiser": 2,
  "Heavy Assault Cruiser": 2,
  Logistics: 2,
  // «Cruiser (other)».
  Cruiser: 1,
  "Force Recon Ship": 1,
  "Combat Recon Ship": 1,
  "Heavy Interdiction Cruiser": 1,
  "Flag Cruiser": 1,
};
/** La tabla tal y como la publica el juego, para enseñarla entera y con sus nombres. */
const TABLA_OFICIAL: [string, number][] = [
  ["Capital (otros)", 72],
  ["Force Auxiliary", 36],
  ["Marauder", 12],
  ["Black Ops", 8],
  ["Battleship (otros)", 6],
  ["Strategic Cruiser", 4],
  ["Command Ship", 3],
  ["Battlecruiser (otros)", 2],
  ["Heavy Assault Cruiser", 2],
  ["Logistics Cruiser", 2],
  ["Cruiser (otros)", 1],
];
const UMBRALES = [
  { valor: 12, nombre: "Moderada", color: "#e3b341" },
  { valor: 36, nombre: "Severa", color: "#f0883e" },
  { valor: 72, nombre: "Crítica", color: "#f85149" },
] as const;
const CAPITALES = new Set(
  Object.entries(RAMPANCY_POR_GRUPO).filter(([, p]) => p >= 36).map(([g]) => g),
);

export const rampancyDe = (grupo: string | undefined): number => (grupo ? RAMPANCY_POR_GRUPO[grupo] ?? 0 : 0);
export function nivelDe(total: number): { nombre: string; color: string; indice: number } {
  let idx = -1;
  for (let i = 0; i < UMBRALES.length; i++) if (total >= UMBRALES[i].valor) idx = i;
  return idx < 0 ? { nombre: tr("Sin escalación"), color: "#3fb950", indice: -1 } : { ...UMBRALES[idx], indice: idx };
}

/** Una nave añadida a mano al plan (compañeros que no son personajes tuyos). Se recuerda. */
type Manual = { id: number; n: number };
const CLAVE_PLAN = "koru-fabricador-plan";
function leerPlan(): Manual[] {
  try {
    const raw = localStorage.getItem(CLAVE_PLAN);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x) => x && typeof x.id === "number" && typeof x.n === "number") : [];
  } catch {
    return [];
  }
}

export function FabricadorSection({ cards, charId }: { cards: CharacterCard[]; charId?: number | null }) {
  const [naves, setNaves] = useState<Map<number, Nave>>(new Map());
  useEffect(() => {
    loadJson<Nave[]>("/ships.json", []).then((d) => setNaves(new Map(d.map((s) => [s.i, s])))).catch(() => {});
  }, []);

  /** Tus pilotos: los conectados con nave conocida entran por defecto; el resto se pueden meter a
   *  mano (un alt que vas a conectar, p. ej.). La nave es la que lleva puesta AHORA según ESI —
   *  si va a cambiarla en el POS, quítalo de aquí y añade la buena abajo. */
  const [excluidos, setExcluidos] = useState<Set<number>>(new Set());
  const [incluidosOffline, setIncluidosOffline] = useState<Set<number>>(new Set());
  const pilotos = useMemo(
    () =>
      cards
        .filter((c) => c.ship_type_id != null)
        .map((c) => {
          const nave = naves.get(c.ship_type_id!);
          const dentro = c.online ? !excluidos.has(c.character_id) : incluidosOffline.has(c.character_id);
          return { c, nave, puntos: rampancyDe(nave?.g), dentro };
        })
        .sort((a, b) => b.puntos - a.puntos || a.c.name.localeCompare(b.c.name)),
    [cards, naves, excluidos, incluidosOffline],
  );

  const [manual, setManual] = useState<Manual[]>(() => leerPlan());
  useEffect(() => {
    try {
      localStorage.setItem(CLAVE_PLAN, JSON.stringify(manual));
    } catch {
      /* sin almacén: se queda en memoria */
    }
  }, [manual]);
  const [q, setQ] = useState("");
  const sugeridas = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [] as Nave[];
    const out: Nave[] = [];
    for (const pasada of [0, 1]) {
      for (const s of naves.values()) {
        if (out.includes(s)) continue;
        const nl = s.n.toLowerCase();
        if (pasada === 0 ? nl.startsWith(t) : nl.includes(t)) out.push(s);
        if (out.length >= 8) return out;
      }
    }
    return out;
  }, [q, naves]);
  const addManual = (id: number) => {
    setManual((prev) => {
      const i = prev.findIndex((m) => m.id === id);
      if (i >= 0) return prev.map((m, k) => (k === i ? { ...m, n: m.n + 1 } : m));
      return [...prev, { id, n: 1 }];
    });
    setQ("");
  };
  const restarManual = (id: number) =>
    setManual((prev) => prev.map((m) => (m.id === id ? { ...m, n: m.n - 1 } : m)).filter((m) => m.n > 0));

  const totalPilotos = pilotos.filter((p) => p.dentro).reduce((s, p) => s + p.puntos, 0);
  const totalManual = manual.reduce((s, m) => s + rampancyDe(naves.get(m.id)?.g) * m.n, 0);
  const total = totalPilotos + totalManual;
  const nivel = nivelDe(total);
  const siguiente = UMBRALES.find((u) => total < u.valor) ?? null;
  const actual = nivel.indice >= 0 ? UMBRALES[nivel.indice] : null;
  const hayCapital =
    pilotos.some((p) => p.dentro && p.nave && CAPITALES.has(p.nave.g)) ||
    manual.some((m) => CAPITALES.has(naves.get(m.id)?.g ?? ""));
  const cuantos = pilotos.filter((p) => p.dentro).length + manual.reduce((s, m) => s + m.n, 0);
  const ancho = Math.min(100, (total / 80) * 100);

  return (
    <div className="fab">
      {/* ★ QUÉ ES ESTO, antes que nada. Él mismo, viendo la sección por primera vez, no sabía qué
          era el Fabricator hasta que se lo conté — y a la mayoría le pasará igual: es contenido de
          agujero de dos meses. Una sección que hay que explicar aparte no está terminada. */}
      <details className="fab-que" open>
        <summary>❓ {tr("Qué es esto")}</summary>
        <p className="small">
          {tr("El Rampant Drone Fabricator es un sitio de combate que solo aparece en agujeros de gusano (C1–C6), permanente desde julio de 2026. En el centro hay una estructura de drones rebeldes, el Fabricator, que suelta oleadas de drones cada vez más duras, hasta 100. Los drones no dejan botín: se acumula dentro del Fabricator y lo recoges al destruirlo o cuando decides irte. Está pensado para grupos pequeños, y lo que decide lo duro que se pone es la Rampancy: cada nave que tengas cerca suma según su clase, y al pasar de 12, 36 y 72 el sitio sube de nivel de amenaza. Más nivel, más peligro y más recompensa.")}
        </p>
        <p className="small">
          <strong>{tr("Lo que hace Koru: sumar la Rampancy de tu plan ANTES de entrar —con la nave que lleva cada uno de tus pilotos, sin que escribas nada— y guardar después cómo fue cada run: oleadas, botín, quién fue y en qué.")}</strong>{" "}
          <button className="linklike small" onClick={() => openExternal("https://wiki.eveuniversity.org/Rampant_Drone_Fabricator")}>
            {tr("Ficha del sitio en la wiki de EVE University")}
          </button>
        </p>
      </details>
      <p className="muted small">
        {tr("La Rampancy es la suma de las naves que hay cerca del Fabricator y decide el nivel de amenaza: 12 Moderada · 36 Severa · 72 Crítica. El juego la enseña entre oleadas, cuando ya estás dentro; aquí se calcula ANTES, con la nave que lleva cada piloto y las que añadas a mano.")}
      </p>

      <div className="kpis">
        <Kpi label={tr("Rampancy prevista")} value={fmtSp(total)} />
        <Kpi label={tr("Nivel de amenaza")} value={nivel.nombre} />
        <Kpi label={tr("Naves en el plan")} value={fmtSp(cuantos)} />
        {siguiente ? (
          <Kpi label={`${tr("Para")} ${tr(siguiente.nombre)}`} value={`${tr("faltan")} ${fmtSp(siguiente.valor - total)}`} />
        ) : (
          <Kpi label={tr("Por encima de")} value={`${tr("Crítica")} +${fmtSp(total - 72)}`} />
        )}
        {actual && (
          <Kpi label={`${tr("Margen sobre")} ${tr(actual.nombre)}`} value={`+${fmtSp(total - actual.valor)}`} />
        )}
      </div>

      {/* La barra con las tres marcas: dónde estás y cuánto queda a cada lado. El color es el del
          nivel alcanzado, no una escala continua — el juego no tiene grados intermedios. */}
      <div className="fab-barra" title={`${fmtSp(total)} / 72`}>
        <div className="fab-barra-fill" style={{ width: `${ancho}%`, background: nivel.color }} />
        {UMBRALES.map((u) => (
          <div key={u.valor} className="fab-marca" style={{ left: `${(u.valor / 80) * 100}%` }} title={`${u.valor} · ${tr(u.nombre)}`}>
            <span>{u.valor}</span>
          </div>
        ))}
      </div>
      {actual && total - actual.valor <= 2 && (
        <p className="muted small">
          ⚠️ {tr("Estás justo sobre el umbral: un crucero menos y bajas de nivel. Si lo quieres, bien; si no, quita algo antes de entrar.")}
        </p>
      )}
      {hayCapital && (
        <p className="muted small">
          ⚠️ {tr("Los NPC del sitio hacen el doble de daño a las capitales (a los carriers, +40 %). Un capital te pone en Crítica él solo.")}
        </p>
      )}

      <div className="cazador-grid">
        <div className="cazador-sec">
          <h4>👥 {tr("Tus pilotos, con la nave que llevan ahora")}</h4>
          {pilotos.length === 0 ? (
            <p className="muted small">
              {tr("Ningún personaje con nave conocida. Hace falta el permiso de nave (read_ship_type) y que esté conectado: Koru no adivina.")}
            </p>
          ) : (
            <table className="km-table cat-table">
              <tbody>
                {pilotos.map((p) => (
                  <tr key={p.c.character_id} className={p.dentro ? "" : "fab-fuera"}>
                    <td>
                      <input
                        type="checkbox"
                        checked={p.dentro}
                        onChange={() => {
                          if (p.c.online) {
                            setExcluidos((prev) => {
                              const n = new Set(prev);
                              if (n.has(p.c.character_id)) n.delete(p.c.character_id);
                              else n.add(p.c.character_id);
                              return n;
                            });
                          } else {
                            setIncluidosOffline((prev) => {
                              const n = new Set(prev);
                              if (n.has(p.c.character_id)) n.delete(p.c.character_id);
                              else n.add(p.c.character_id);
                              return n;
                            });
                          }
                        }}
                        title={p.c.online ? tr("Conectado") : tr("Desconectado: la nave es la última conocida")}
                      />
                    </td>
                    <td>
                      <img src={`https://images.evetech.net/characters/${p.c.character_id}/portrait?size=32`} alt="" width={18} height={18} style={{ borderRadius: "50%", verticalAlign: -4 }} />{" "}
                      {p.c.name}
                      {!p.c.online && <span className="muted small"> · {tr("desconectado")}</span>}
                    </td>
                    <td>
                      {p.c.ship_type_id != null && <img src={typeIcon(p.c.ship_type_id, 32)} alt="" width={18} height={18} style={{ verticalAlign: -4 }} />}{" "}
                      {p.nave?.n ?? p.c.ship_type_name ?? `#${p.c.ship_type_id}`}
                      <span className="muted small"> · {p.nave?.g ?? "?"}</span>
                    </td>
                    <td style={{ textAlign: "right" }}>{p.puntos > 0 ? `+${p.puntos}` : "0"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted small">
            {tr("La nave es la que ESI dice que lleva puesta ahora (hasta 30 s de retraso). Si va a cambiarla antes de entrar, desmárcalo y añade la buena a mano.")}
          </p>
        </div>

        <div className="cazador-sec">
          <h4>🛠️ {tr("Compañeros y naves a mano")}</h4>
          <div className="intel-corregir-fila">
            <input
              className="small"
              value={q}
              placeholder={tr("Buscar nave en el catálogo")}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && sugeridas.length > 0) addManual(sugeridas[0].i);
              }}
            />
          </div>
          {sugeridas.length > 0 && (
            <div className="intel-corregir-sug">
              {sugeridas.map((s) => (
                <button key={s.i} className="pp-tag" onClick={() => addManual(s.i)} title={`${s.g} · +${rampancyDe(s.g)}`}>
                  <img src={typeIcon(s.i, 32)} alt="" width={16} height={16} style={{ verticalAlign: -3 }} /> {s.n}
                  <span className="muted"> +{rampancyDe(s.g)}</span>
                </button>
              ))}
            </div>
          )}
          {manual.length === 0 ? (
            <p className="muted small">{tr("Nadie más en el plan. Añade las naves de los compañeros que no son personajes tuyos.")}</p>
          ) : (
            <table className="km-table cat-table">
              <tbody>
                {manual.map((m) => {
                  const s = naves.get(m.id);
                  const pts = rampancyDe(s?.g);
                  return (
                    <tr key={m.id}>
                      <td>
                        <img src={typeIcon(m.id, 32)} alt="" width={18} height={18} style={{ verticalAlign: -4 }} /> {s?.n ?? `#${m.id}`}
                        <span className="muted small"> · {s?.g ?? "?"}</span>
                      </td>
                      <td>
                        <button className="intel-corregir-x" title={tr("Quitar una")} onClick={() => restarManual(m.id)}>−</button>
                        {" "}×{m.n}{" "}
                        <button className="intel-corregir-x" title={tr("Añadir otra")} onClick={() => addManual(m.id)}>+</button>
                      </td>
                      <td style={{ textAlign: "right" }}>{pts > 0 ? `+${pts * m.n}` : "0"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="muted small">{tr("Este plan se recuerda en este ordenador.")}</p>
        </div>
      </div>

      <div className="cazador-sec">
        <h4>📋 {tr("Cuánto suma cada clase")}</h4>
        <table className="km-table cat-table fab-tabla">
          <tbody>
            {TABLA_OFICIAL.map(([clase, pts]) => (
              <tr key={clase}>
                <td>{tr(clase)}</td>
                <td style={{ textAlign: "right" }}>+{pts}</td>
              </tr>
            ))}
            <tr>
              <td className="muted">{tr("Fragatas, destructores, industriales y lo demás")}</td>
              <td className="muted" style={{ textAlign: "right" }}>0</td>
            </tr>
          </tbody>
        </table>
        <p className="muted small">
          {tr("Fuente: notas de la versión 24.01 (2026-07-23). Solo en agujeros C1–C6. Koru no ve quién está a 50 km del Fabricator: esto es lo que sumaría tu plan si todos están cerca.")}
        </p>
      </div>

      {/* ★ LA PELÍCULA: las runs, con el mismo tracker que abismos y CRAB (sesión + cronómetro +
          botín + tripulación), más lo propio del Fabricador — la clase del agujero, la Rampancy
          con la que entraste (la del plan de arriba, congelada) y la OLEADA a la que llegaste.
          Necesita personaje: quien lanza la run. En Global se dice, no se esconde. */}
      {charId == null ? (
        <p className="muted small" style={{ marginTop: "1rem" }}>
          {tr("Selecciona un personaje para registrar runs del Fabricador. El planificador de arriba funciona igual en Global.")}
        </p>
      ) : (
        <AbyssalRunsView activity="fabricator" charId={charId} rampancyPrevista={total} />
      )}
    </div>
  );
}
