// Sección EXPLORACIÓN → HISTÓRICO. Lo que YA exploraste: las firmas que marcaste como «hechas», con
// su botín y su fecha. A diferencia de Pendientes (firmas vivas que caducan en el downtime), esto es
// PERMANENTE y de aquí salen las estadísticas de exploración. Cada entrada se puede editar (botín/
// nota) o deshacer (vuelve a Pendientes si la firma sigue viva). Espejo de db::exploration_log.
// Diseño: documentacion/koru-desktop-EXPLORACION_HISTORICO_diseno.md. RoGiz7, 2026-07-23.
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { fmtIsk } from "./format";
import { KIND_META, parseIskShorthand, fmtDuration } from "./signaturesControl";
import type { SigKind } from "./signatures";
import type { ExplorationLogRow } from "./types";

type Props = {
  /** Personaje activo, o null en Global. En Global se ve TODO el histórico (todos los personajes). */
  charId?: number | null;
};

/** Cubos de estadística, en el orden de caza (igual que Pendientes). `unknown` cae en "otros". */
const STAT_KINDS: SigKind[] = ["wormhole", "combat", "relic", "data", "gas", "ore", "unknown"];

function kindMeta(kind: string): { icon: string; label: string } {
  return KIND_META[kind as SigKind] ?? { icon: "❔", label: kind };
}

export function ExplorationLogView({ charId }: Props) {
  const [rows, setRows] = useState<ExplorationLogRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  // Edición en línea de una entrada (botín + nota).
  const [editId, setEditId] = useState<number | null>(null);
  const [editIsk, setEditIsk] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editLoot, setEditLoot] = useState("");

  async function load() {
    try {
      const all = await invoke<ExplorationLogRow[]>("exploration_log_list");
      // En Global (charId null) se ve todo; con personaje activo, solo lo suyo (y lo sin dueño).
      setRows(
        charId == null
          ? all
          : all.filter((r) => r.character_id === charId || r.character_id == null),
      );
    } catch (e) {
      setMsg(`${tr("Error")}: ${String(e).slice(0, 160)}`);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charId]);

  // Estadísticas: total de sitios, botín total, y desglose por tipo (nº + ISK).
  const stats = useMemo(() => {
    const byKind = new Map<string, { n: number; isk: number }>();
    let totalIsk = 0;
    let totalMs = 0; // tiempo total dentro de sitios (solo los que tienen entrada y salida)
    for (const r of rows) {
      const k = r.kind;
      const cur = byKind.get(k) ?? { n: 0, isk: 0 };
      cur.n += 1;
      cur.isk += r.loot_isk ?? 0;
      byKind.set(k, cur);
      totalIsk += r.loot_isk ?? 0;
      if (r.entered_at) {
        const ms = new Date(r.done_at).getTime() - new Date(r.entered_at).getTime();
        if (isFinite(ms) && ms > 0) totalMs += ms;
      }
    }
    // ISK/hora sobre el tiempo medido (solo si hay algo de tiempo cronometrado).
    const iskPerHour = totalMs > 0 ? totalIsk / (totalMs / 3_600_000) : 0;
    return { total: rows.length, totalIsk, byKind, totalMs, iskPerHour };
  }, [rows]);

  // "1h 05m" a partir de milisegundos (para el total; fmtDuration trabaja con ISO).
  function msToStr(ms: number): string {
    const m = Math.floor(ms / 60000);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
  }

  function startEdit(r: ExplorationLogRow) {
    setEditId(r.id);
    setEditIsk(r.loot_isk != null ? String(r.loot_isk) : "");
    setEditLoot(r.loot_note ?? "");
    setEditNote(r.note ?? "");
  }

  async function saveEdit(id: number) {
    setBusy(true);
    setMsg("");
    try {
      await invoke("exploration_log_set", {
        id,
        lootIsk: parseIskShorthand(editIsk),
        lootNote: editLoot.trim() || null,
        note: editNote.trim() || null,
      });
      setRows((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                loot_isk: parseIskShorthand(editIsk),
                loot_note: editLoot.trim() || null,
                note: editNote.trim() || null,
              }
            : r,
        ),
      );
      setEditId(null);
    } catch (e) {
      setMsg(`${tr("Error")}: ${String(e).slice(0, 160)}`);
    } finally {
      setBusy(false);
    }
  }

  // Deshacer: borra la entrada del histórico y devuelve la firma a Pendientes si sigue viva.
  async function undo(id: number) {
    setBusy(true);
    setMsg("");
    try {
      await invoke("signature_mark_done_undo", { logId: id });
      setRows((prev) => prev.filter((r) => r.id !== id));
      setMsg(tr("Devuelto a Pendientes (si la firma sigue viva)."));
    } catch (e) {
      setMsg(`${tr("Error")}: ${String(e).slice(0, 160)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="exploration-view">
      {rows.length === 0 ? (
        <p className="muted small">
          {tr(
            "Aún no has marcado ninguna firma como hecha. En «Pendientes», pulsa «✓ Hecha» en una firma que hayas corrido para registrarla aquí con su botín.",
          )}
        </p>
      ) : (
        <>
          {/* ---- Resumen de estadísticas ---- */}
          <div className="explog-stats">
            <div className="explog-stat">
              <div className="explog-stat-n">{stats.total}</div>
              <div className="explog-stat-l small muted">{tr("sitios hechos")}</div>
            </div>
            <div className="explog-stat">
              <div className="explog-stat-n">{fmtIsk(stats.totalIsk)}</div>
              <div className="explog-stat-l small muted">{tr("botín total (ISK)")}</div>
            </div>
            {stats.totalMs > 0 && (
              <>
                <div className="explog-stat">
                  <div className="explog-stat-n">{msToStr(stats.totalMs)}</div>
                  <div className="explog-stat-l small muted">{tr("tiempo dentro")}</div>
                </div>
                <div className="explog-stat">
                  <div className="explog-stat-n">{fmtIsk(stats.iskPerHour)}</div>
                  <div className="explog-stat-l small muted">{tr("ISK/hora (cronometrado)")}</div>
                </div>
              </>
            )}
            {STAT_KINDS.map((k) => {
              const s = stats.byKind.get(k);
              if (!s) return null;
              return (
                <div key={k} className="explog-stat" title={tr(kindMeta(k).label)}>
                  <div className="explog-stat-n">
                    {kindMeta(k).icon} {s.n}
                  </div>
                  <div className="explog-stat-l small muted">
                    {tr(kindMeta(k).label)}
                    {s.isk > 0 ? ` · ${fmtIsk(s.isk)}` : ""}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ---- Tabla del histórico ---- */}
          <table className="small sig-table explog-table">
            <thead>
              <tr className="sig-th">
                <th>{tr("Fecha")}</th>
                <th>{tr("Sistema")}</th>
                <th>{tr("Tipo")}</th>
                <th>{tr("Nombre")}</th>
                <th style={{ textAlign: "right" }}>{tr("Botín")}</th>
                <th>{tr("Nota")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap" }} className="muted">
                    {r.done_at.slice(0, 10)}
                    {fmtDuration(r.entered_at, r.done_at) && (
                      <div style={{ fontSize: 10 }} title={tr("tiempo dentro del sitio")}>
                        ⏱ {fmtDuration(r.entered_at, r.done_at)}
                      </div>
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{r.system_name || `#${r.system_id}`}</td>
                  <td style={{ whiteSpace: "nowrap" }} title={tr(kindMeta(r.kind).label)}>
                    {kindMeta(r.kind).icon} {tr(kindMeta(r.kind).label)}
                  </td>
                  <td>{r.name || <span className="muted">—</span>}</td>
                  {editId === r.id ? (
                    <>
                      <td style={{ textAlign: "right" }}>
                        <input
                          className="small"
                          value={editIsk}
                          onChange={(e) => setEditIsk(e.target.value)}
                          placeholder={tr("ISK (p.ej. 45m)")}
                          style={{ width: 90 }}
                        />
                      </td>
                      <td>
                        <input
                          className="small"
                          value={editLoot}
                          onChange={(e) => setEditLoot(e.target.value)}
                          placeholder={tr("qué cayó (opcional)")}
                          style={{ width: "100%" }}
                        />
                        <input
                          className="small"
                          value={editNote}
                          onChange={(e) => setEditNote(e.target.value)}
                          placeholder={tr("nota…")}
                          style={{ width: "100%", marginTop: 3 }}
                        />
                      </td>
                      <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                        <button className="pp-add" onClick={() => saveEdit(r.id)} disabled={busy}>
                          {tr("Guardar")}
                        </button>
                        <button className="pp-add" onClick={() => setEditId(null)} disabled={busy}>
                          {tr("Cancelar")}
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {r.loot_isk != null ? fmtIsk(r.loot_isk) : <span className="muted">—</span>}
                        {r.loot_note ? (
                          <div className="muted" style={{ fontSize: 10 }}>
                            {r.loot_note}
                          </div>
                        ) : null}
                      </td>
                      <td>{r.note || <span className="muted">—</span>}</td>
                      <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                        <button className="sig-done-btn" onClick={() => startEdit(r)} disabled={busy}>
                          {tr("Editar")}
                        </button>
                        <button
                          className="sig-done-btn"
                          title={tr("Deshacer: quita del histórico y devuelve a Pendientes")}
                          onClick={() => undo(r.id)}
                          disabled={busy}
                        >
                          ↩ {tr("Deshacer")}
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {msg && <div className="small muted">{msg}</div>}
    </div>
  );
}
