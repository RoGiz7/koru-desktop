// Sección Personaje: cabecera con datos del personaje (CharHeader) y vistas de Skills (por
// personaje y global). Extraído de App.tsx.
import { useState, useEffect } from "react";
import { tr, getLang } from "./i18n";
import { fmtSp, typeIcon, secColor } from "./format";
import { Kpi } from "./charts";
import type { CharacterDetail, CharacterCard, SkillsSummary, GlobalSkills } from "./types";

export function CharHeader({ detail, card }: { detail: CharacterDetail | null; card?: CharacterCard }) {
  // Títulos oficiales (SDE characterTitles → nombre): UUID equipado → etiqueta localizada.
  const [titles, setTitles] = useState<Record<string, { es: string; en: string }>>({});
  useEffect(() => {
    fetch("/character_titles.json").then((r) => r.json()).then(setTitles).catch(() => setTitles({}));
  }, []);
  if (!detail) return null;
  const a = detail.attributes;
  const sec = detail.security_status;
  const tt = detail.title_id ? titles[detail.title_id] : undefined;
  const titleLabel = tt ? (getLang() === "es" ? tt.es : tt.en) : "";
  const portrait = card
    ? `https://images.evetech.net/characters/${card.character_id}/portrait?size=128`
    : null;
  const bio = detail.bio ? detail.bio.replace(/<[^>]*>/g, "").trim() : "";
  const attrs = a
    ? [
        { label: tr("Inteligencia"), v: a.intelligence },
        { label: tr("Memoria"), v: a.memory },
        { label: tr("Percepción"), v: a.perception },
        { label: tr("Carisma"), v: a.charisma },
        { label: tr("Voluntad"), v: a.willpower },
      ]
    : [];
  return (
    <div className="char-header">
      <div className="ch-top">
        {portrait && <img className="ch-portrait" src={portrait} alt="" />}
        <div className="ch-id">
          <h3>{card?.name ?? tr("Personaje")}</h3>
          <div className="ch-sub muted small">
            {card?.corporation_name ?? ""}
            {card?.alliance_name ? ` · ${card.alliance_name}` : ""}
          </div>
          {titleLabel && (
            <div className="ch-title" title={tr("Título equipado")}>
              🎖️ {titleLabel}
            </div>
          )}
          <div className="ch-meta">
            {sec != null && (
              <span>
                {tr("Sec")}:{" "}
                <b style={{ color: secColor(sec) }}>{sec.toFixed(2)}</b>
              </span>
            )}
            {detail.birthday && <span>{tr("Nacimiento")}: {detail.birthday.slice(0, 10)}</span>}
            <span>
              {tr("Jump clones")}: <b>{detail.jump_clones}</b>
            </span>
          </div>
        </div>
      </div>

      {attrs.length > 0 && (
        <div className="ch-attrs">
          {attrs.map((at) => (
            <div className="ch-attr" key={at.label}>
              <span className="ch-attr-v">{at.v}</span>
              <span className="ch-attr-l">{at.label}</span>
            </div>
          ))}
          {a?.bonus_remaps != null && (
            <div className="ch-attr">
              <span className="ch-attr-v">{a.bonus_remaps}</span>
              <span className="ch-attr-l">{tr("Remaps libres")}</span>
            </div>
          )}
        </div>
      )}

      {detail.implants.length > 0 && (
        <div className="top-list">
          <h4>{tr("Implantes")} ({detail.implants.length})</h4>
          <div className="ch-implant-list">
            {detail.implants.map((im) => (
              <span className="ch-implant" key={im.type_id} title={im.name ?? `#${im.type_id}`}>
                <img src={typeIcon(im.type_id, 32)} alt="" loading="lazy" />
                <span>{im.name ?? `#${im.type_id}`}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {bio && (
        <details className="ch-bio">
          <summary>{tr("Biografía")}</summary>
          <p>{bio}</p>
        </details>
      )}
    </div>
  );
}

export function SkillsView(props: { data: SkillsSummary | null; busy: boolean }) {
  const { data, busy } = props;
  return (
    <>
      {!data && busy && <p className="muted">{tr("Cargando…")}</p>}
      {data && (
        <>
          <div className="kpis">
            <Kpi label={tr("SP total")} value={fmtSp(data.total_sp)} />
            <Kpi label={tr("SP sin asignar")} value={fmtSp(data.unallocated_sp)} />
            <Kpi label={tr("Skills")} value={data.skill_count} />
            <Kpi label={tr("En cola")} value={data.queue.length} />
          </div>
          <h4>{tr("Cola de entrenamiento")}</h4>
          {data.queue.length === 0 && <p className="muted small">{tr("Cola vacía.")}</p>}
          {data.queue.length > 0 && (
            <table className="km-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Skill</th>
                  <th>{tr("Nivel")}</th>
                  <th>{tr("Termina")}</th>
                </tr>
              </thead>
              <tbody>
                {data.queue.map((q) => (
                  <tr key={q.queue_position}>
                    <td>{q.queue_position + 1}</td>
                    <td>{q.skill_name ?? `#${q.skill_id}`}</td>
                    <td>{q.finished_level}</td>
                    <td>{q.finish_date?.replace("T", " ").slice(0, 16) ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </>
  );
}


/** Etiqueta de semana ISO (YYYY-Sww) a partir de una fecha YYYY-MM-DD. */


export function GlobalSkillsView(props: { data: GlobalSkills | null; busy: boolean }) {
  const { data, busy } = props;
  return (
    <>
      {!data && busy && <p className="muted">{tr("Cargando…")}</p>}
      {data && (
        <>
          <div className="kpis">
            <Kpi label={tr("SP total")} value={fmtSp(data.total_sp)} />
            <Kpi label={tr("SP sin asignar")} value={fmtSp(data.unallocated_sp)} />
            <Kpi label={tr("Skills")} value={fmtSp(data.skill_count)} />
            <Kpi label={tr("Personajes")} value={data.character_count} />
          </div>
          <h4>{tr("Entrenando ahora")}</h4>
          {data.training.length === 0 && <p className="muted small">{tr("Sin datos.")}</p>}
          {data.training.length > 0 && (
            <table className="km-table">
              <thead>
                <tr>
                  <th>{tr("Personaje")}</th>
                  <th>Skill</th>
                  <th>{tr("Nivel")}</th>
                  <th>{tr("Termina")}</th>
                </tr>
              </thead>
              <tbody>
                {data.training.map((t) => (
                  <tr key={t.character_id}>
                    <td>{t.character_name}</td>
                    <td>{t.skill_name ?? (t.skill_id ? `#${t.skill_id}` : tr("— sin entrenar —"))}</td>
                    <td>{t.skill_id ? t.finished_level : "-"}</td>
                    <td>{t.finish_date?.replace("T", " ").slice(0, 16) ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </>
  );
}
