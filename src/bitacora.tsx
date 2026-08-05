// Bitácora — Logros propios + Retos del mes. La piedra angular: como FC no expone
// logros/oportunidades por ESI, los generamos NOSOTROS desde el histórico local.
// Inmersión inspirada en la UI de "Logros" de EVE (arte propio, cero assets ajenos):
// medallas con marco geométrico SVG teñido por tier + pips de nivel, puntuación agregada,
// home de "progresando / completados recientemente" (desde las fechas retroactivas) y
// medallero agrupado por dominio con color y emblema. Todo se deriva en el front de lo que
// devuelve el motor Rust (id/level/value/thresholds/unlocked_at); no hace falta ESI ni Rust.
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr, getLang } from "./i18n";
import { fmtIsk, fmtSp, typeIcon } from "./format";
import { MedalArt } from "./medalArt";
import type { Bitacora, AchievementState, Medal, AchSeries, CharacterDetail } from "./types";
import { MedalDetail } from "./medalDetail";

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
  logi_shield: { icon: "🛡️", label: "Escudero", desc: "Escudo remoto reparado (dado)", tid: 11985 }, // Basilisk
  logi_armor: { icon: "🩹", label: "Chapista", desc: "Blindaje remoto reparado (dado)", tid: 11987 }, // Guardian
  logi_hull: { icon: "🔧", label: "Soldador", desc: "Casco remoto reparado (dado)", tid: 11989 }, // Oneiros
  boost_capataz: { icon: "⛏️", label: "Capataz", desc: "Pulsos de Mining Foreman lanzados a la flota", tid: 43551 }, // Mining Foreman Burst II
  boost_miembros: { icon: "📣", label: "Voz de mando", desc: "Miembros de flota bonificados por tus módulos de mando (suma de pulsos)", tid: 43555 }, // Shield Command Burst II
  mineria_crit: { icon: "✨", label: "Filón", desc: "Unidades extraídas en ciclos críticos", tid: 17912 }, // Modulated Strip Miner II
  salvage_total: { icon: "🧲", label: "Chatarrero", desc: "Restos de naves recuperados", tid: 30836 }, // Salvager II
  saltos_total: { icon: "🚪", label: "Trotamundos", desc: "Saltos entre sistemas", tid: 672 }, // Caldari Shuttle
  wrecks_dados: { icon: "💢", label: "Demoledor", desc: "Golpes wrecking asestados (Destruye)", tid: 2478 }, // Berserker II
  dano_total: { icon: "💣", label: "Artillero", desc: "Daño total infligido (del gamelog, con o sin muerte detrás)", tid: 645 }, // Dominix
  sistemas_mineria: { icon: "🧭", label: "Prospector", desc: "Sistemas distintos donde has minado (del gamelog + chatlog)", tid: 32880 }, // Venture
  // --- Exploración (del Histórico de exploración propio; el gamelog NO registra hackeos) ---
  relic_hechos: { icon: "🏺", label: "Arqueólogo", desc: "Yacimientos de reliquias completados", tid: 22177 }, // Relic Analyzer I
  data_hechos: { icon: "💾", label: "Descifrador", desc: "Sitios de datos completados", tid: 22175 }, // Data Analyzer I
  gas_hechos: { icon: "☁️", label: "Nube y beneficio", desc: "Nubes de gas trabajadas", tid: 60313 }, // Gas Cloud Harvester I
  wh_anotados: { icon: "🕳️", label: "Umbral tras umbral", desc: "Agujeros de gusano anotados en tu histórico", tid: 30488 }, // Sisters Core Scanner Probe
  sitios_totales: { icon: "📡", label: "Sondas fuera", desc: "Sitios de exploración completados", tid: 30488 },
  sistemas_explorados: { icon: "🗺️", label: "Cartógrafo", desc: "Sistemas distintos donde has explorado", tid: 33468 }, // Astero
  botin_explorado: { icon: "💎", label: "Fiebre del tesoro", desc: "Botín total sacado explorando", tid: 44992 }, // PLEX
  mejor_sitio: { icon: "🎁", label: "El premio gordo", desc: "El sitio más rentable de tu histórico", tid: 44992 },
  maraton_sondeo: { icon: "🌙", label: "Maratón de sondeo", desc: "Más sitios completados en un solo día", tid: 30488 },
  // --- Abismo y CRAB (de tus runs cronometradas) ---
  runs_hechas: { icon: "🌀", label: "Buceador", desc: "Runs abisales y CRAB completadas", tid: 47894 }, // Raging Dark Filament
  iskh_record: { icon: "⚡", label: "Racha dorada", desc: "Tu mejor ISK/hora en una run", tid: 17715 }, // Gila
  racha_sin_morir: { icon: "🍀", label: "Piel dura", desc: "Runs seguidas sin perder una nave", tid: 2048 }, // Damage Control II
  abismo_dificultad: { icon: "☠️", label: "Sin retorno", desc: "Dificultad más alta superada con vida (Furioso / Caótico / Cataclísmico)", tid: 56140 }, // Cataclysmic Dark Filament
};

/** Iconos EVE de la propia sección (regla de la casa: nada de emoji donde hay un ítem que lo diga).
 *  Los tres primeros son del MISMO set —la Prueba de Leyendas— y eso es a propósito: Intermediate
 *  y Legends son dos grados de la misma medalla, igual que «progresando» y «completado» son dos
 *  grados de lo mismo. El Target Painter para los retos, porque un reto es un objetivo marcado. */
const TID_TARGET = 21540; // 'Inception' Target Painter
const TID_MEDAL_MID = 16713; // Intermediate Medal
const TID_MEDAL_TOP = 16714; // Legends Medal

// Dominios (como las facciones de EVE, pero propios): color + emblema (typeID real) + qué agrupan.
type Cat = { key: string; label: string; color: string; tid: number; ids: string[] };
const CATS: Cat[] = [
  {
    key: "guerra",
    label: "Guerra",
    color: "#d1495b",
    tid: 587, // Rifter
    ids: ["kills_totales", "isk_destruido_total", "killmail_caro", "solo_kills", "final_blows", "meses_eficaces", "wrecks_dados", "dano_total"],
  },
  {
    key: "travesia",
    label: "Travesía",
    color: "#4a90d9",
    tid: 33468, // Astero (exploración)
    ids: ["sistemas_pvp", "racha_semanas", "saltos_total"],
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
    ids: ["mineria_total", "boost_capataz", "mineria_crit", "salvage_total", "sistemas_mineria"],
  },
  {
    key: "exploracion",
    label: "Exploración",
    color: "#7f5af0", // violeta de sonda
    tid: 30488, // Sisters Core Scanner Probe
    ids: ["relic_hechos", "data_hechos", "gas_hechos", "wh_anotados", "sitios_totales", "sistemas_explorados", "botin_explorado", "mejor_sitio", "maraton_sondeo"],
  },
  {
    key: "abismo",
    label: "Abismo",
    color: "#c94f7c", // el rosa-rojo de los filamentos
    tid: 47894, // Raging Dark Filament
    ids: ["runs_hechas", "iskh_record", "racha_sin_morir", "abismo_dificultad"],
  },
  {
    key: "apoyo",
    label: "Apoyo",
    color: "#2eb8b8", // cian sanador
    tid: 11978, // Scimitar (logi)
    ids: ["logi_shield", "logi_armor", "logi_hull", "boost_miembros"],
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

// ---- Tarjeta de medalla (usada en la home y en las rejillas por dominio). Clicable → evolución. ----
function MedalCard({
  a,
  open,
  onToggle,
}: {
  a: AchievementState;
  /** Abre la ficha de medalla (medalDetail.tsx). La gráfica ya no vive dentro de la tarjeta:
   *  no cabía y, sobre todo, el acumulado solo sabía subir. Ver el porqué en ese fichero. */
  open?: boolean;
  onToggle?: () => void;
}) {
  const ui = ACH_UI[a.id] ?? { icon: "🏅", label: a.id, desc: "" };
  const { nextTh, pct } = progressTo(a);
  const date = lastTierDate(a);
  return (
    <div
      className={`medal l${a.level}${a.fresh ? " fresh" : ""}${onToggle ? " clickable" : ""}${open ? " open" : ""}`}
      title={`${tr(ui.desc)} — ${fmtVal(a.value, a.unit)}`}
      onClick={onToggle}
    >
      <div className="medal-row">
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
    </div>
  );
}

// ---- Condecoración oficial (medalla in-game de corp) para el medallero mixto. ----
// Si hay texturas extraídas de la SharedCache (Ajustes → Medallas de corp), se pinta el
// dibujo REAL componiendo las capas de ESI; si no, el marco genérico de siempre.
// `grants` = TODAS las entregas de la misma medalla (la corp puede otorgarla varias veces,
// p.ej. reenviarla con el motivo corregido): una tarjeta, badge ×N y cada fecha con su motivo.
export function OfficialMedal({ grants }: { grants: Medal[] }) {
  const m = grants[0]; // título/corp/descripción/dibujo son de la medalla; lo que varía es la entrega
  return (
    <div className="medal official">
      <MedalArt graphics={m.graphics} fallback={<MedalFrame official icon="🎖️" />} />
      <div className="medal-info">
        <div className="medal-top">
          <strong>{m.title}</strong>
          {grants.length > 1 && <span className="dia-badge">×{grants.length}</span>}
          {m.status === "public" && (
            <span className="dia-badge" style={{ color: "#8b7fd4", marginLeft: "auto" }}>
              {tr("Pública")}
            </span>
          )}
        </div>
        {grants.length === 1 ? (
          <span className="muted small">
            {[m.corporation_name, (m.date || "").slice(0, 10)].filter(Boolean).join(" · ")}
          </span>
        ) : (
          <span className="muted small">
            {m.corporation_name} · {grants.length} {tr("entregas")}
          </span>
        )}
        {m.description && <span className="muted small">{m.description}</span>}
        {grants.length === 1
          ? m.reason && <span className="muted small medal-reason">“{m.reason}”</span>
          : grants.map((g) => (
              <span key={g.date} className="muted small medal-reason">
                {(g.date || "").slice(0, 10)}
                {g.reason ? <> — “{g.reason}”</> : null}
              </span>
            ))}
      </div>
    </div>
  );
}

export function BitacoraView({
  data,
  busy,
  subject,
  syncTick,
}: {
  data: Bitacora | null;
  busy: boolean;
  subject?: number | "global";
  /// Latido de App: sube tras cada auto-sync → medallas, puntuación oficial y series se
  /// refrescan solas (un logro desbloqueado en el sync aparece sin cambiar de vista).
  syncTick?: number;
}) {
  // (Las condecoraciones in-game se cargan ahora en el Diario, que es donde se pintan.)

  // Puntuación de logros OFICIAL de EVE (Cradle of War) + título oficial equipado (novedad ESI
  // 2026): por personaje, best-effort. El catálogo de títulos es SDE local (character_titles.json).
  const [officialScore, setOfficialScore] = useState<number | null>(null);
  const [officialTitleId, setOfficialTitleId] = useState<string | null>(null);
  const [titleNames, setTitleNames] = useState<Record<string, { es: string; en: string }>>({});
  useEffect(() => {
    fetch("/character_titles.json").then((r) => r.json()).then(setTitleNames).catch(() => setTitleNames({}));
  }, []);
  useEffect(() => {
    if (typeof subject !== "number") {
      setOfficialScore(null);
      setOfficialTitleId(null);
      return;
    }
    let alive = true;
    invoke<CharacterDetail>("get_character_detail", { characterId: subject })
      .then((d) => {
        if (!alive) return;
        setOfficialScore(d.achievement_score);
        setOfficialTitleId(d.title_id);
      })
      .catch(() => {
        if (!alive) return;
        setOfficialScore(null);
        setOfficialTitleId(null);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, syncTick]);
  const officialTitle = officialTitleId ? titleNames[officialTitleId] : undefined;
  const officialTitleLabel = officialTitle
    ? getLang() === "es"
      ? officialTitle.es
      : officialTitle.en
    : "";

  // Evolución mensual de cada logro (derivada del histórico; sirve global y por personaje).
  const [series, setSeries] = useState<Record<string, AchSeries>>({});
  const [openMedal, setOpenMedal] = useState<string | null>(null);
  /** Pestaña de la Bitácora. `retos` · `progreso` · `oro` · o la clave de un dominio.
   *  Todo en pestañas (decisión de Zigor): la sección había crecido tanto que lo importante
   *  quedaba enterrado bajo scroll. Preferencia de UI, no dato: no se persiste. */
  const [tab, setTab] = useState<string>("retos");
  useEffect(() => {
    let alive = true;
    invoke<Record<string, AchSeries>>("get_achievement_series", {
      characterId: typeof subject === "number" ? subject : null,
    })
      .then((s) => alive && setSeries(s))
      .catch(() => alive && setSeries({}));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, syncTick]);
  const toggle = (id: string) => setOpenMedal((o) => (o === id ? null : id));

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
  /** Resumen fino de arriba: cuántas de oro llevas y cuál fue la última. Se calcula sobre TODAS
   *  las medallas, no sobre las 6 que se enseñan en la pestaña. */
  const oroCount = data.achievements.filter((a) => a.level >= 3).length;
  const ultimoOro = [...data.achievements]
    .filter((a) => a.level >= 3 && a.unlocked_at[2])
    .sort((x, y) => (y.unlocked_at[2] ?? "").localeCompare(x.unlocked_at[2] ?? ""))[0];
  const completados = data.achievements
    .filter((a) => a.level >= 3)
    .sort((x, y) => (y.unlocked_at[2] ?? "").localeCompare(x.unlocked_at[2] ?? ""))
    .slice(0, 6);
  /** Barra del medallero: un segmento por medalla, ORDENADOS de más a menos avanzada. Ordenar por
   *  tier (y dentro del tier, por lo cerca que estás del siguiente) hace que la barra se lea sola
   *  como «cuánto llevas»: se llena por la izquierda. En orden de dominio sería un código de barras
   *  bonito pero mudo. */
  const barra = [...data.achievements].sort(
    (x, y) => y.level - x.level || progressTo(y).pct - progressTo(x).pct,
  );

  return (
    <>
      {/* Cabecera: solo la puntuación agregada (como "Puntuación del logro" de EVE). El título de la
          sección ya lo pone la cabecera común de arriba —repetirlo aquí era decir dos veces lo mismo. */}
      {/* ---- Franja de estado del medallero ----
          Antes esto era una cifra sola arriba a la derecha con un «Puntuación · 22/36» minúsculo
          debajo, y una segunda línea suelta con «2 de oro · 22/36 empezadas · la última…» que
          REPETÍA el mismo 22/36. Quedaba pobre y decía dos veces lo mismo en dos sitios.
          Ahora es una sola franja a todo el ancho: cada dato en su celda, con su número grande y su
          etiqueta debajo, y de remate la barra del medallero entero. Idea de Zigor. */}
      <div className="bit-hero">
        <div className="bit-hero-stats">
          <div className="bhs" title={tr("Suma de puntos por medalla (bronce 1 · plata 3 · oro 8)")}>
            <span className="bhs-num">{score}</span>
            <span className="bhs-lbl">{tr("Puntuación")}</span>
            <span className="bhs-sub muted">{tr("bronce 1 · plata 3 · oro 8")}</span>
          </div>
          <div className="bhs" title={tr("Medallas llevadas hasta el nivel máximo")}>
            <span className="bhs-num gold">{oroCount}</span>
            <span className="bhs-lbl">{tr("De oro")}</span>
            <span className="bhs-sub muted">
              {tr("de")} {total}
            </span>
          </div>
          <div className="bhs" title={tr("Medallas con al menos el bronce conseguido")}>
            <span className="bhs-num">
              {unlockedCount}
              <small>/{total}</small>
            </span>
            <span className="bhs-lbl">{tr("Empezadas")}</span>
            <span className="bhs-sub muted">
              {Math.round((unlockedCount / Math.max(1, total)) * 100)}% {tr("del medallero")}
            </span>
          </div>
          {ultimoOro && (
            <div className="bhs bhs-wide">
              <span className="bhs-num-txt">{tr(ACH_UI[ultimoOro.id]?.label ?? ultimoOro.id)}</span>
              <span className="bhs-lbl">{tr("Último oro")}</span>
              <span className="bhs-sub muted">{ultimoOro.unlocked_at[2]?.slice(0, 10)}</span>
            </div>
          )}
          {officialScore != null && officialScore > 0 && (
            <div className="bhs" title={tr("Puntuación de logros oficial de EVE (Cradle of War)")}>
              <span className="bhs-num">{officialScore.toLocaleString()}</span>
              <span className="bhs-lbl">{tr("Logros EVE")}</span>
              <span className="bhs-sub muted">{officialTitleLabel || tr("del juego")}</span>
            </div>
          )}
        </div>

        {/* Un segmento por medalla. Es la lectura de un vistazo que antes no existía: cuánto del
            medallero está hecho y con qué reparto de metales. */}
        <div className="bit-hero-bar" title={tr("Cada segmento es una medalla, teñida por su nivel")}>
          {barra.map((a) => (
            <i
              key={a.id}
              className={`bhb l${a.level}`}
              title={`${tr(ACH_UI[a.id]?.label ?? a.id)} — ${a.level > 0 ? tr(LEVEL_NAME[a.level]) : tr("sin empezar")}`}
            />
          ))}
        </div>
      </div>

      {/* Cascada de medallas nuevas (incl. retroactivas del histórico). El icono es el MISMO del
          medallero (typeIcon del image server), con el emoji solo de reserva: los emoji del banner
          se veían distintos a las medallas de abajo y parecían otra cosa. */}
      {fresh.length > 0 && (
        <div className="bit-fresh">
          ✨ {tr("Logros nuevos desbloqueados")}:{" "}
          {fresh.map((a, i) => {
            const ui = ACH_UI[a.id];
            return (
              <span key={a.id} className="bit-fresh-item">
                {i > 0 && " · "}
                {ui?.tid ? (
                  <img className="bit-icon-img" src={typeIcon(ui.tid, 32)} alt="" loading="lazy" />
                ) : (
                  <span>{ui?.icon ?? "🏅"}</span>
                )}{" "}
                {tr(ui?.label ?? a.id)}
              </span>
            );
          })}
        </div>
      )}

      {/* El resumen fino de «2 de oro · 22/36 empezadas · la última…» que vivía aquí se ha fundido
          con la franja de arriba: eran los MISMOS datos escritos dos veces con distinto formato. */}

      {/* ---- TODO en pestañas (decisión de Zigor): retos primero, luego lo que está en marcha,
              después el oro, y al final los dominios. Antes era un scroll larguísimo donde lo
              accionable —los retos, que caducan a fin de mes— quedaba arriba pero enterrado en
              cuanto crecía el medallero. ---- */}
      <div className="bit-cat-tabs">
        <button className={tab === "retos" ? "active" : ""} onClick={() => setTab("retos")}>
          <img className="bit-cat-img" src={typeIcon(TID_TARGET, 32)} alt="" loading="lazy" />{" "}
          {tr("Retos del mes")}
        </button>
        <button className={tab === "progreso" ? "active" : ""} onClick={() => setTab("progreso")}>
          <img className="bit-cat-img" src={typeIcon(TID_MEDAL_MID, 32)} alt="" loading="lazy" />{" "}
          {tr("Progresando")} <span className="muted">({progresando.length})</span>
        </button>
        <button className={tab === "oro" ? "active" : ""} onClick={() => setTab("oro")}>
          <img className="bit-cat-img" src={typeIcon(TID_MEDAL_TOP, 32)} alt="" loading="lazy" />{" "}
          {tr("Completados")} <span className="muted">({oroCount})</span>
        </button>
        {CATS.map((cat) => {
          const ms = cat.ids.map((id) => byId.get(id)).filter((a): a is AchievementState => !!a);
          if (ms.length === 0) return null;
          const got = ms.filter((a) => a.level > 0).length;
          const on = tab === cat.key;
          return (
            <button
              key={cat.key}
              className={on ? "active" : ""}
              onClick={() => setTab(cat.key)}
              style={on ? { borderColor: cat.color, color: cat.color } : undefined}
              title={`${tr(cat.label)} · ${got}/${ms.length}`}
            >
              <img className="bit-cat-img" src={typeIcon(cat.tid, 32)} alt="" loading="lazy" />{" "}
              {tr(cat.label)} <span className="muted">({got}/{ms.length})</span>
            </button>
          );
        })}
      </div>

      {/* ---- Retos del mes: tú contra tu yo del mes pasado ---- */}
      {tab === "retos" && (<>
      <div className="bit-head">
        <h4>
          <img className="bit-cat-img" src={typeIcon(TID_TARGET, 32)} alt="" loading="lazy" />{" "}
          {tr("Retos del mes")}
        </h4>
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

      {/* Los RETOS DE CORPORACIÓN ya no están aquí: los proyectos de corp se pintan en «Trabajos
          y proyectos» (freelance.tsx), que es su sitio. Tenerlos en dos secciones era duplicar la
          misma información y obligaba a mantenerla dos veces. */}

      </>)}

      {/* ---- Progresando: lo que está en marcha ---- */}
      {tab === "progreso" && progresando.length > 0 && (
        <>
          <div className="bit-head">
            <h4>
              <img className="bit-cat-img" src={typeIcon(TID_MEDAL_MID, 32)} alt="" loading="lazy" />{" "}
              {tr("Progresando")}
            </h4>
            <span className="muted small">{tr("logros en marcha, lo más reciente primero")}</span>
          </div>
          <div className="medal-grid">
            {progresando.map((a) => (
              <MedalCard key={a.id} a={a} open={openMedal === a.id} onToggle={() => toggle(a.id)} />
            ))}
          </div>
        </>
      )}
      {tab === "oro" && completados.length > 0 && (
        <>
          <div className="bit-head">
            <h4>
              <img className="bit-cat-img" src={typeIcon(TID_MEDAL_TOP, 32)} alt="" loading="lazy" />{" "}
              {tr("Completados")}
            </h4>
            <span className="muted small">{tr("medallas de oro conseguidas")}</span>
          </div>
          <div className="medal-grid">
            {completados.map((a) => (
              <MedalCard key={a.id} a={a} open={openMedal === a.id} onToggle={() => toggle(a.id)} />
            ))}
          </div>
        </>
      )}

      {/* ---- Dominio elegido: solo su rejilla (la barra de pestañas vive arriba) ---- */}
      {CATS.filter((c) => c.key === tab).map((cat) => {
        const medals = cat.ids.map((id) => byId.get(id)).filter((a): a is AchievementState => !!a);
        if (medals.length === 0) return null;
        return (
          <div key={cat.key} className="bit-cat" style={{ borderLeftColor: cat.color }}>
            <div className="medal-grid">
              {medals.map((a) => (
                <MedalCard key={a.id} a={a} open={openMedal === a.id} onToggle={() => toggle(a.id)} />
              ))}
            </div>
          </div>
        );
      })}

      {/* Las CONDECORACIONES (medallas in-game de corp) ya no viven aquí: se fueron al Diario,
          que es donde encajan —tienen fecha y son parte de tu historia, no de tu progreso—. Allí
          van replegadas y se despliegan si te interesan. Decisión de Zigor, 2026-08-05. */}

      {/* Ficha de la medalla abierta. Se monta UNA sola vez fuera de las rejillas, no una por
          tarjeta: es un modal, y tenerlo dentro del grid lo dejaría atrapado en su overflow. */}
      {openMedal &&
        (() => {
          const a = byId.get(openMedal);
          if (!a) return null;
          const ui = ACH_UI[a.id] ?? { icon: "🏅", label: a.id, desc: "" };
          return <MedalDetail a={a} ui={ui} series={series[a.id]} onClose={() => setOpenMedal(null)} />;
        })()}

      <p className="muted small bit-foot">
        {tr("Logros y retos generados por Koru desde tu histórico local — FC no expone esto por ESI: es tuyo y de nadie más.")}
      </p>
    </>
  );
}
