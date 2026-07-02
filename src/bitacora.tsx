// Bitácora — Logros propios + Retos del mes. La piedra angular: como FC no expone
// logros/oportunidades por ESI, los generamos NOSOTROS desde el histórico local.
// Inmersión inspirada en la UI de "Logros" de EVE (arte propio, cero assets ajenos):
// medallas con marco geométrico SVG teñido por tier + pips de nivel, puntuación agregada,
// home de "progresando / completados recientemente" (desde las fechas retroactivas) y
// medallero agrupado por dominio con color y emblema. Todo se deriva en el front de lo que
// devuelve el motor Rust (id/level/value/thresholds/unlocked_at); no hace falta ESI ni Rust.
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { fmtIsk, fmtSp, typeIcon } from "./format";
import type { Bitacora, AchievementState, Medal } from "./types";

// Catálogo visual: emoji de reserva + typeID REAL de EVE (image server, vía typeIcon) para dar
// inmersión — el mismo image server que ya usa toda la app (retratos, naves, logos). `tid` es un
// tipo temático (nave/módulo/mineral) representativo del logro. El motor y umbrales viven en Rust.
const CH_UI: Record<string, { icon: string; label: string; tid?: number }> = {
  rateo: { icon: "🐀", label: "Rateo del mes", tid: 33138 }, // Clone Soldier Trainer Tag (bounty)
  mineria: { icon: "⛏️", label: "Minería del mes", tid: 22 }, // Arkonor
  kills: { icon: "⚔️", label: "Kills del mes", tid: 587 }, // Rifter
  isk_destruido: { icon: "💥", label: "ISK destruido del mes", tid: 2961 }, // 1400mm Howitzer II
};

export const ACH_UI: Record<string, { icon: string; label: string; desc: string; tid?: number }> = {
  kills_totales: { icon: "⚔️", label: "Señor de la guerra", desc: "Kills totales acumuladas", tid: 641 }, // Megathron
  isk_destruido_total: { icon: "💥", label: "Destructor", desc: "ISK total destruido", tid: 2961 }, // 1400mm Howitzer II
  killmail_caro: { icon: "💎", label: "Caza mayor", desc: "Tu killmail más caro", tid: 11567 }, // Avatar (titán)
  solo_kills: { icon: "🗡️", label: "Lobo solitario", desc: "Kills en solitario", tid: 11371 }, // Wolf
  final_blows: { icon: "🎯", label: "Golpe de gracia", desc: "Final blows asestados", tid: 2913 }, // 425mm AutoCannon II
  sistemas_pvp: { icon: "🗺️", label: "Nómada de guerra", desc: "Sistemas distintos con kills", tid: 30488 }, // Sisters Core Scanner Probe
  racha_semanas: { icon: "🔥", label: "Sin descanso", desc: "Semanas seguidas con actividad PvP", tid: 3699 }, // Quafe
  rateo_total: { icon: "🐀", label: "Azote de piratas", desc: "ISK total rateado (bounties + ESS)", tid: 33138 }, // Clone Soldier Trainer Tag
  mineria_total: { icon: "⛏️", label: "Corazón de roca", desc: "Valor total minado (estimado)", tid: 22 }, // Arkonor
  patrimonio: { icon: "💰", label: "Magnate", desc: "Mejor marca de patrimonio", tid: 44992 }, // PLEX
  meses_positivos: { icon: "📈", label: "Buen gestor", desc: "Meses cerrados en positivo", tid: 16622 }, // Accounting (skillbook)
  meses_eficaces: { icon: "🏆", label: "Impecable", desc: "Meses con eficacia ≥90% (mín. 10 kills)", tid: 2048 }, // Damage Control II
};

// Dominios (como las facciones de EVE, pero propios): color + emblema (typeID real) + qué agrupan.
type Cat = { key: string; label: string; color: string; tid: number; ids: string[] };
const CATS: Cat[] = [
  {
    key: "guerra",
    label: "Guerra",
    color: "#d1495b",
    tid: 587, // Rifter
    ids: ["kills_totales", "isk_destruido_total", "killmail_caro", "solo_kills", "final_blows", "meses_eficaces"],
  },
  {
    key: "travesia",
    label: "Travesía",
    color: "#4a90d9",
    tid: 33468, // Astero (exploración)
    ids: ["sistemas_pvp", "racha_semanas"],
  },
  {
    key: "fortuna",
    label: "Fortuna",
    color: "#e0a83a",
    tid: 44992, // PLEX
    ids: ["rateo_total", "patrimonio", "meses_positivos"],
  },
  {
    key: "industria",
    label: "Industria",
    color: "#3fa66a",
    tid: 34, // Tritanium
    ids: ["mineria_total"],
  },
];

const LEVEL_NAME = ["", "Bronce", "Plata", "Oro"];
// Puntos por tier alcanzado (acumulados): bronce 1, plata +2 (=3), oro +5 (=8). Un medallero
// completo (12×oro) ≈ 96 puntos, en la línea del "Puntuación del logro" de EVE.
const TIER_POINTS = [0, 1, 3, 8];

function fmtVal(v: number, unit: string): string {
  return unit === "isk" ? fmtIsk(v) : fmtSp(Math.round(v));
}

/** Días que quedan de mes (para meter presión sana en los retos). */
function daysLeft(): number {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return Math.max(0, end.getUTCDate() - now.getUTCDate());
}

/** Umbral del siguiente nivel + % de progreso hacia él (oro = 100). */
function progressTo(a: AchievementState): { nextTh: number; pct: number; nextIdx: number } {
  const nextIdx = a.level < 3 ? a.level : 2;
  const nextTh = a.thresholds[nextIdx];
  const pct = a.level >= 3 ? 100 : Math.min(100, (a.value / nextTh) * 100);
  return { nextTh, pct, nextIdx };
}

/** Fecha del tier más alto ya conseguido (para ordenar por "reciente"). */
function lastTierDate(a: AchievementState): string | null {
  return a.level > 0 ? a.unlocked_at[a.level - 1] : null;
}

// ---- Marco de medalla: hexágono SVG doble + emblema. Se tiñe por tier vía CSS (currentColor).
// Dentro va el icono REAL de EVE (image server) si hay `tid`; si no, el emoji de reserva. ----
function MedalFrame({
  level = 0,
  icon,
  tid,
  size = 58,
  official = false,
}: {
  level?: number;
  icon: string;
  tid?: number;
  size?: number;
  official?: boolean;
}) {
  return (
    <div className={official ? "medal-frame official" : `medal-frame l${level}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <polygon className="mf-outer" points="50,4 87,26 87,74 50,96 13,74 13,26" />
        <polygon className="mf-inner" points="50,15 78,32 78,68 50,85 22,68 22,32" />
        <line className="mf-tick" x1="50" y1="4" x2="50" y2="12" />
        <line className="mf-tick" x1="50" y1="88" x2="50" y2="96" />
        <line className="mf-tick" x1="13" y1="50" x2="21" y2="50" />
        <line className="mf-tick" x1="79" y1="50" x2="87" y2="50" />
      </svg>
      <span className="mf-icon">
        {tid ? <img className="mf-img" src={typeIcon(tid, 64)} alt="" loading="lazy" /> : icon}
      </span>
    </div>
  );
}

// ---- Pips de nivel: ● ● ● rellenos hasta el tier conseguido. ----
function Pips({ level }: { level: number }) {
  return (
    <div className="medal-pips">
      {[1, 2, 3].map((i) => (
        <span key={i} className={`pip${level >= i ? ` on l${i}` : ""}`} />
      ))}
    </div>
  );
}

// ---- Tarjeta de medalla (usada en la home y en las rejillas por dominio). ----
function MedalCard({ a }: { a: AchievementState }) {
  const ui = ACH_UI[a.id] ?? { icon: "🏅", label: a.id, desc: "" };
  const { nextTh, pct } = progressTo(a);
  const date = lastTierDate(a);
  return (
    <div className={`medal l${a.level}${a.fresh ? " fresh" : ""}`} title={`${tr(ui.desc)} — ${fmtVal(a.value, a.unit)}`}>
      <MedalFrame level={a.level} icon={ui.icon} tid={ui.tid} />
      <div className="medal-info">
        <div className="medal-top">
          <strong>{tr(ui.label)}</strong>
          <Pips level={a.level} />
        </div>
        <span className="muted small">{tr(ui.desc)}</span>
        <div className={`medal-bar${a.level >= 3 ? " done" : ""}`}>
          <div className="medal-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="medal-meta muted small">
          {a.level > 0 ? (
            <>
              {tr(LEVEL_NAME[a.level])}
              {date ? ` · ${date}` : ""}
              {a.level < 3 ? ` · ${fmtVal(a.value, a.unit)} / ${fmtVal(nextTh, a.unit)}` : " · ✔ máx."}
            </>
          ) : (
            <>
              {fmtVal(a.value, a.unit)} / {fmtVal(nextTh, a.unit)}
            </>
          )}
        </span>
      </div>
    </div>
  );
}

// ---- Condecoración oficial (medalla in-game de corp) para el medallero mixto. ----
function OfficialMedal({ m }: { m: Medal }) {
  const date = (m.date || "").slice(0, 10);
  return (
    <div className="medal official">
      <MedalFrame official icon="🎖️" />
      <div className="medal-info">
        <div className="medal-top">
          <strong>{m.title}</strong>
          {m.status === "public" && (
            <span className="dia-badge" style={{ color: "#8b7fd4", marginLeft: "auto" }}>
              {tr("Pública")}
            </span>
          )}
        </div>
        <span className="muted small">{[m.corporation_name, date].filter(Boolean).join(" · ")}</span>
        {m.description && <span className="muted small">{m.description}</span>}
        {m.reason && <span className="muted small medal-reason">“{m.reason}”</span>}
      </div>
    </div>
  );
}

export function BitacoraView({
  data,
  busy,
  subject,
}: {
  data: Bitacora | null;
  busy: boolean;
  subject?: number | "global";
}) {
  // Medallas in-game (condecoraciones de corp): por personaje, best-effort (scope read_medals).
  const [medals, setMedals] = useState<Medal[]>([]);
  useEffect(() => {
    if (typeof subject !== "number") {
      setMedals([]);
      return;
    }
    let alive = true;
    invoke<Medal[]>("get_medals", { characterId: subject })
      .then((m) => alive && setMedals(m))
      .catch(() => alive && setMedals([]));
    return () => {
      alive = false;
    };
  }, [subject]);

  if (!data) return <p className="muted">{busy ? tr("Cargando…") : tr("Sin datos.")}</p>;

  const fresh = data.achievements.filter((a) => a.fresh && a.level > 0);
  const score = data.achievements.reduce((n, a) => n + (TIER_POINTS[a.level] ?? 0), 0);
  const unlockedCount = data.achievements.filter((a) => a.level > 0).length;
  const total = data.achievements.length;
  const byId = new Map(data.achievements.map((a) => [a.id, a] as const));

  // Home: en progreso (aún sin oro) por reciente/cercanía; completados (oro) por fecha desc.
  const progresando = data.achievements
    .filter((a) => a.level < 3)
    .sort((x, y) => {
      const dx = lastTierDate(x) ?? "";
      const dy = lastTierDate(y) ?? "";
      if (dx !== dy) return dy.localeCompare(dx); // el que subió de tier más recientemente
      return progressTo(y).pct - progressTo(x).pct; // si empatan, el más cerca del siguiente
    })
    .slice(0, 6);
  const completados = data.achievements
    .filter((a) => a.level >= 3)
    .sort((x, y) => (y.unlocked_at[2] ?? "").localeCompare(x.unlocked_at[2] ?? ""))
    .slice(0, 6);

  return (
    <>
      {/* Cabecera: puntuación agregada (como "Puntuación del logro" de EVE) */}
      <div className="bit-topbar">
        <div className="bit-title">
          📖 <strong>{tr("Bitácora")}</strong>
          <span className="muted small">{tr("generada de tu propia historia")}</span>
        </div>
        <div className="bit-score" title={tr("Suma de puntos por medalla (bronce 1 · plata 3 · oro 8)")}>
          <span className="bit-score-num">{score}</span>
          <span className="muted small">
            {tr("Puntuación")} · {unlockedCount}/{total} {tr("medallas")}
          </span>
        </div>
      </div>

      {/* Cascada de medallas nuevas (incl. retroactivas del histórico) */}
      {fresh.length > 0 && (
        <div className="bit-fresh">
          ✨ {tr("Logros nuevos desbloqueados")}:{" "}
          {fresh.map((a) => `${ACH_UI[a.id]?.icon ?? "🏅"} ${tr(ACH_UI[a.id]?.label ?? a.id)}`).join(" · ")}
        </div>
      )}

      {/* ---- Retos del mes: tú contra tu yo del mes pasado ---- */}
      <div className="bit-head">
        <h4>🎯 {tr("Retos del mes")}</h4>
        <span className="muted small">
          {tr("Tu mes anterior marca el listón · quedan")} {daysLeft()} {tr("días")}
        </span>
      </div>
      {data.challenges.length === 0 ? (
        <p className="muted small">
          {tr("Sin actividad el mes pasado con la que fijar retos. Juega un mes y vuelve: el listón se pone solo.")}
        </p>
      ) : (
        <div className="bit-challenges">
          {data.challenges.map((c) => {
            const ui = CH_UI[c.id] ?? { icon: "🎯", label: c.id };
            const pct = c.target > 0 ? Math.min(100, (c.current / c.target) * 100) : 0;
            const basePct = c.target > 0 ? Math.min(100, (c.baseline / c.target) * 100) : 0;
            const done = c.current >= c.target;
            return (
              <div key={c.id} className={`bit-card ${done ? "done" : ""}`}>
                <div className="bit-card-head">
                  {ui.tid ? (
                    <img className="bit-icon-img" src={typeIcon(ui.tid, 32)} alt="" loading="lazy" />
                  ) : (
                    <span className="bit-icon">{ui.icon}</span>
                  )}
                  <strong>{tr(ui.label)}</strong>
                  {done && <span className="bit-done">✔ {tr("¡Conseguido!")}</span>}
                </div>
                <div className="bit-bar">
                  <div className="bit-bar-fill" style={{ width: `${pct}%` }} />
                  <div className="bit-bar-base" style={{ left: `${basePct}%` }} title={tr("Tu mes anterior")} />
                </div>
                <div className="bit-card-nums">
                  <span className="bit-cur">{fmtVal(c.current, c.unit)}</span>
                  <span className="muted small">
                    {tr("objetivo")} {fmtVal(c.target, c.unit)} · {tr("mes pasado")} {fmtVal(c.baseline, c.unit)}
                  </span>
                  <span className={`bit-pct ${done ? "tk-up" : ""}`}>{pct.toFixed(0)}%</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ---- Home: progresando + completados recientemente (inspirado en la home de Logros) ---- */}
      {progresando.length > 0 && (
        <>
          <div className="bit-head">
            <h4>📈 {tr("Progresando")}</h4>
            <span className="muted small">{tr("logros en marcha, lo más reciente primero")}</span>
          </div>
          <div className="medal-grid">
            {progresando.map((a) => (
              <MedalCard key={a.id} a={a} />
            ))}
          </div>
        </>
      )}
      {completados.length > 0 && (
        <>
          <div className="bit-head">
            <h4>🏆 {tr("Completados")}</h4>
            <span className="muted small">{tr("medallas de oro conseguidas")}</span>
          </div>
          <div className="medal-grid">
            {completados.map((a) => (
              <MedalCard key={a.id} a={a} />
            ))}
          </div>
        </>
      )}

      {/* ---- Medallero completo por dominio ---- */}
      <div className="bit-head">
        <h4>🏅 {tr("Medallero")}</h4>
        <span className="muted small">{tr("por dominio · generado de tu propia historia")}</span>
      </div>
      {CATS.map((cat) => {
        const medals = cat.ids.map((id) => byId.get(id)).filter((a): a is AchievementState => !!a);
        if (medals.length === 0) return null;
        const got = medals.filter((a) => a.level > 0).length;
        return (
          <div key={cat.key} className="bit-cat" style={{ borderLeftColor: cat.color }}>
            <div className="bit-cat-head">
              <span className="bit-cat-emblem" style={{ borderColor: cat.color, background: `${cat.color}2b` }}>
                <img className="bit-cat-img" src={typeIcon(cat.tid, 32)} alt="" loading="lazy" />
              </span>
              <strong style={{ color: cat.color }}>{tr(cat.label)}</strong>
              <span className="muted small">
                {got}/{medals.length}
              </span>
            </div>
            <div className="medal-grid">
              {medals.map((a) => (
                <MedalCard key={a.id} a={a} />
              ))}
            </div>
          </div>
        );
      })}

      {/* ---- Condecoraciones oficiales (medallas in-game de corp) → medallero MIXTO ---- */}
      {medals.length > 0 && (
        <>
          <div className="bit-head">
            <h4>🎖️ {tr("Condecoraciones")}</h4>
            <span className="muted small">
              {medals.length} {tr("medallas in-game de corporación")}
            </span>
          </div>
          <div className="medal-grid">
            {medals.map((m) => (
              <OfficialMedal key={m.medal_id} m={m} />
            ))}
          </div>
        </>
      )}

      <p className="muted small bit-foot">
        {tr("Logros y retos generados por Koru desde tu histórico local — FC no expone esto por ESI: es tuyo y de nadie más.")}
      </p>
    </>
  );
}
