// Diario — la "historia jugada": un timeline cronológico que mezcla los HITOS de la Bitácora
// (desbloqueos de logros con su fecha retroactiva, que Koru ya calcula del histórico local) con
// tu TRAYECTORIA de corporaciones (endpoint público corporationhistory, sin scope). Es la
// continuación natural de la home "Progresando/Completados": aquí se despliega toda tu biografía.
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { typeIcon, fmtIsk, fmtSp } from "./format";
import { ACH_UI } from "./bitacora";
import type { Bitacora, DiaryCorp, Medal } from "./types";

type Ev = {
  date: string; // YYYY-MM-DD
  kind: "ach" | "corp" | "medal";
  title: string;
  tid?: number; // icono real de EVE (logro)
  corpId?: number; // logo de corp
  level?: number; // tier del logro (1-3)
  sub?: string; // línea secundaria (descripción del logro / etiqueta de corp)
  meta?: string; // dato a la derecha (umbral cruzado / tiempo en la corp)
};

const TIER_NAME = ["", "Bronce", "Plata", "Oro"];
const TIER_COLOR = ["", "#cd7f32", "#c9d1d9", "#e8be3f"];

function fmtVal(v: number, unit: string): string {
  return unit === "isk" ? fmtIsk(v) : fmtSp(Math.round(v));
}

/** Duración compacta entre dos fechas ISO (para el tiempo en cada corporación). */
function durationStr(startISO: string, endISO: string): string {
  const s = Date.parse(`${startISO}T00:00:00Z`);
  const e = Date.parse(`${endISO}T00:00:00Z`);
  if (!isFinite(s) || !isFinite(e) || e < s) return "";
  const days = Math.floor((e - s) / 86400000);
  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);
  if (years > 0) return months > 0 ? `${years}a ${months}m` : `${years}a`;
  if (months > 0) return `${months}m`;
  return `${days}d`;
}

function DiaryRow({ e }: { e: Ev }) {
  const md = e.date.length >= 10 ? e.date.slice(5, 10) : e.date; // MM-DD
  const dotColor =
    e.kind === "ach" ? TIER_COLOR[e.level ?? 1] : e.kind === "medal" ? "#8b7fd4" : "var(--accent-border)";
  return (
    <div className="dia-row">
      <span className="dia-date">{md}</span>
      <span className="dia-dot" style={{ borderColor: dotColor }} />
      <span className="dia-icon">
        {e.kind === "ach" ? (
          e.tid ? (
            <img src={typeIcon(e.tid, 32)} alt="" loading="lazy" />
          ) : (
            "🏅"
          )
        ) : e.kind === "corp" ? (
          <img src={`https://images.evetech.net/corporations/${e.corpId}/logo?size=32`} alt="" loading="lazy" />
        ) : (
          "🎖️"
        )}
      </span>
      <div className="dia-text">
        <div className="dia-title">
          {e.kind === "ach" ? (
            <>
              <span className="muted small">{tr("Logro")}:</span> <strong>{e.title}</strong>{" "}
              <span className="dia-badge" style={{ color: TIER_COLOR[e.level ?? 1] }}>
                {tr(TIER_NAME[e.level ?? 1])}
              </span>
            </>
          ) : e.kind === "corp" ? (
            <>
              <span className="muted small">{tr("Se unió a")}</span> <strong>{e.title}</strong>
            </>
          ) : (
            <>
              <span className="muted small">{tr("Condecoración")}:</span> <strong>{e.title}</strong>
            </>
          )}
        </div>
        {e.sub && <div className="dia-sub muted small">{e.sub}</div>}
      </div>
      {e.meta && (
        <span className="dia-meta" style={e.kind === "ach" ? { color: TIER_COLOR[e.level ?? 1] } : undefined}>
          {e.meta}
        </span>
      )}
    </div>
  );
}

export function DiarioView({ subject }: { subject: number | "global" }) {
  const isGlobal = subject === "global";
  const [bit, setBit] = useState<Bitacora | null>(null);
  const [corps, setCorps] = useState<DiaryCorp[]>([]);
  const [medals, setMedals] = useState<Medal[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    (async () => {
      try {
        const b = await invoke<Bitacora>("get_bitacora", { characterId: isGlobal ? null : subject });
        if (alive) setBit(b);
      } catch {
        if (alive) setBit(null);
      }
      // corporationhistory es por personaje (público). En Global no aplica.
      if (!isGlobal) {
        try {
          const c = await invoke<DiaryCorp[]>("get_corp_history", { characterId: subject });
          if (alive) setCorps(c);
        } catch {
          if (alive) setCorps([]);
        }
        try {
          const md = await invoke<Medal[]>("get_medals", { characterId: subject });
          if (alive) setMedals(md);
        } catch {
          if (alive) setMedals([]);
        }
      } else if (alive) {
        setCorps([]);
        setMedals([]);
      }
      if (alive) setBusy(false);
    })();
    return () => {
      alive = false;
    };
  }, [subject]);

  if (busy && !bit) return <p className="muted">{tr("Cargando…")}</p>;

  // Construir eventos: hitos de logros (una entrada por tier con fecha) + etapas de corp.
  const evs: Ev[] = [];
  for (const a of bit?.achievements ?? []) {
    for (let lvl = 1; lvl <= 3; lvl++) {
      const d = a.unlocked_at[lvl - 1];
      if (!d) continue;
      const ui = ACH_UI[a.id];
      evs.push({
        date: d,
        kind: "ach",
        title: ui ? tr(ui.label) : a.id,
        tid: ui?.tid,
        level: lvl,
        sub: ui ? tr(ui.desc) : undefined,
        meta: fmtVal(a.thresholds[lvl - 1], a.unit), // el umbral que cruzaste ese día
      });
    }
  }
  // Corps: el "final" de cada etapa es el inicio de la siguiente (o hoy para la actual).
  const todayISO = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < corps.length; i++) {
    const c = corps[i];
    const start = (c.start_date || "").slice(0, 10);
    const end = i === 0 ? todayISO : (corps[i - 1].start_date || "").slice(0, 10);
    evs.push({
      date: start,
      kind: "corp",
      title: c.corporation_name ?? `Corp ${c.corporation_id}`,
      corpId: c.corporation_id,
      sub: i === 0 ? tr("Corporación actual") : undefined,
      meta: durationStr(start, end), // cuánto tiempo estuviste
    });
  }
  // Condecoraciones in-game (tienen fecha → encajan en el timeline).
  for (const m of medals) {
    evs.push({
      date: (m.date || "").slice(0, 10),
      kind: "medal",
      title: m.title,
      sub: m.corporation_name ? `${tr("Condecorado por")} ${m.corporation_name}` : m.description || undefined,
    });
  }
  evs.sort((x, y) => y.date.localeCompare(x.date)); // reciente → antiguo

  if (evs.length === 0)
    return (
      <p className="muted small">
        {tr("Aún no hay hitos que contar. Juega, sincroniza y tu historia se irá escribiendo sola aquí.")}
      </p>
    );

  // Agrupar por año (evs ya viene ordenado descendente).
  const years: { year: string; items: Ev[] }[] = [];
  for (const e of evs) {
    const y = e.date.slice(0, 4);
    let g = years.find((gr) => gr.year === y);
    if (!g) {
      g = { year: y, items: [] };
      years.push(g);
    }
    g.items.push(e);
  }

  return (
    <>
      {isGlobal && (
        <p className="muted small" style={{ marginBottom: "0.6rem" }}>
          {tr("Vista global: hitos de todos tus personajes. Elige un personaje para ver también su trayectoria de corporaciones.")}
        </p>
      )}
      <div className="diary">
        {years.map((g) => (
          <div key={g.year} className="dia-year">
            <div className="dia-year-head">{g.year}</div>
            <div className="dia-list">
              {g.items.map((e, i) => (
                <DiaryRow key={`${e.date}-${e.kind}-${i}`} e={e} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="muted small bit-foot">
        {tr("Tu biografía en New Eden, tejida por Koru desde tu histórico local y tu corporationhistory pública.")}
      </p>
    </>
  );
}
