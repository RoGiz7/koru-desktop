// Control de FIRMAS y ANOMALÍAS por sistema: PEGAR → REVISAR → CONFIRMAR, más anotar.
//
// Mismo trato que Ansiblex: nada se guarda al pegar; se analiza, se enseña la tabla y el piloto
// confirma. La diferencia es que aquí el pegado pertenece a UN sistema (el escáner no lo dice), y no
// se reemplaza todo: se hace upsert por firma conservando las anotaciones del piloto (el destino de
// un wormhole, sobre todo). Ver `signatures.ts` (parser) y `db/mod.rs::signatures_replace_system`.
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { confirm as dialogConfirm } from "@tauri-apps/plugin-dialog";
import { tr } from "./i18n";
import { loadNewEden } from "./neweden";
import { parseSignaturePaste, type ParsedSignature, type SignatureRow, type SigKind } from "./signatures";
import type { NeSystem } from "./types";
import { buildLootIndex, type LootIndex } from "./lootPaste";
import { LootPasteModal } from "./lootPasteModal";
import { buildDungeonIndex, siteNameEn, siteWikiUrl, type DungeonIndex } from "./siteNames";

/** Etiqueta e icono por tipo de sitio. El wormhole va primero y marcado: es el que engancha con las
 *  rutas. `unknown` = firma aún sin identificar (poca señal). */
export const KIND_META: Record<SigKind, { icon: string; label: string }> = {
  wormhole: { icon: "🕳️", label: "Wormhole" },
  combat: { icon: "⚔️", label: "Combate" },
  relic: { icon: "🏺", label: "Reliquias" },
  data: { icon: "💾", label: "Datos" },
  gas: { icon: "☁️", label: "Gas" },
  ore: { icon: "⛏️", label: "Menas" },
  unknown: { icon: "❔", label: "Sin identificar" },
};

/** Cubos de la vista de Exploración (lo que pidió RoGiz7): combate · minado · exploración (data +
 *  relic + gas, el contenido «de explorar» clásico) · wormholes · sin identificar. El orden es el de
 *  interés de un cazador/explorador: primero los agujeros (rutas + por dónde entra el enemigo). */
const BUCKETS: { key: string; icon: string; label: string; kinds: SigKind[] }[] = [
  { key: "wh", icon: "🕳️", label: "Wormholes", kinds: ["wormhole"] },
  { key: "combate", icon: "⚔️", label: "Combate", kinds: ["combat"] },
  { key: "expl", icon: "🏺", label: "Exploración", kinds: ["relic", "data", "gas"] },
  { key: "minado", icon: "⛏️", label: "Minado", kinds: ["ore"] },
  { key: "nd", icon: "❔", label: "Sin identificar", kinds: ["unknown"] },
];

export function fmtDist(au: number | null): string {
  if (au == null) return "—";
  if (au < 0.01) return `${Math.round(au * 149_597_870.7)} km`;
  return `${au.toFixed(2)} AU`;
}

/** Duración legible entre dos instantes ISO: "45s", "12m", "1h 05m". Null si falta alguno. */
export function fmtDuration(fromIso?: string | null, toIso?: string | null): string | null {
  if (!fromIso || !toIso) return null;
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (!isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

/** Hora local corta "HH:MM" de un instante ISO. */
export function fmtClock(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

type Props = {
  /** Sistema al que asignar el pegado. Si no viene, el piloto lo busca por nombre. */
  initialSystemId?: number | null;
  initialSystemName?: string | null;
  /** Personaje activo, si lo hay: se sella en el histórico al marcar «hecha» (Global = null). */
  charId?: number | null;
};

/** Un sistema con firmas pendientes (para el selector rápido). Espejo de db::SignatureSystem. */
type SigSystem = { system_id: number; pending: number };

export function SignaturesControl({ initialSystemId, initialSystemName, charId }: Props) {
  const [byName, setByName] = useState<Map<string, NeSystem> | null>(null);
  // Índice inverso id→nombre, para poner nombre a los sistemas del selector de "ya trabajados".
  const [byId, setById] = useState<Map<number, string>>(new Map());
  // Sistemas donde ya tienes firmas pendientes: se eligen del desplegable sin teclear el nombre.
  const [systems, setSystems] = useState<SigSystem[]>([]);
  const [sysId, setSysId] = useState<number | null>(initialSystemId ?? null);
  const [sysName, setSysName] = useState<string>(initialSystemName ?? "");
  const [search, setSearch] = useState("");
  const [saved, setSaved] = useState<SignatureRow[]>([]);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  // Orden de las filas dentro de cada cubo. Como el escáner del juego: clic en la columna reordena,
  // y volver a clicar invierte. Por defecto por señal descendente (lo más "cazado" arriba).
  const [sortBy, setSortBy] = useState<"id" | "name" | "signal" | "dist">("signal");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [preview, setPreview] = useState<ParsedSignature[] | null>(null);
  const [report, setReport] = useState<{ ignored: number; ignoredSample: string[]; wormholes: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  // Cierre de sitios: firmas seleccionadas (checkbox) + modal de botín. Un solo flujo cubre cerrar un
  // sitio (desde la nave) o varios a la vez (loot acumulado en estación → reparto a partes iguales).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lootOpen, setLootOpen] = useState(false);
  const [lootIndex, setLootIndex] = useState<LootIndex>(new Map());
  // Traductor de nombres de sitio ES→EN, para los enlaces a wikis. Ver siteNames.ts.
  const [dungeonIdx, setDungeonIdx] = useState<DungeonIndex>(new Map());

  // Índices cargados una vez y cacheados: loot (nombre→typeID) y sitios (ES→EN para las wikis).
  useEffect(() => {
    buildLootIndex().then(setLootIndex);
    buildDungeonIndex().then(setDungeonIdx);
  }, []);

  // Índice de nombres del SDE, para resolver el sistema tecleado y para nombrar los del selector
  // (una sola carga, cacheada). Se construyen los dos sentidos: nombre→sistema e id→nombre.
  useEffect(() => {
    loadNewEden()
      .then((ne) => {
        setByName(new Map(ne.systems.map((s) => [s.n.toLowerCase(), s])));
        setById(new Map(ne.systems.map((s) => [s.id, s.n])));
      })
      .catch(() => {
        setByName(new Map());
        setById(new Map());
      });
  }, []);

  // Lista de sistemas con firmas pendientes (para el desplegable de "saltar a un sistema ya
  // trabajado"). Se refresca al montar y tras cada cambio que altere los recuentos.
  function reloadSystems() {
    invoke<SigSystem[]>("signatures_systems").then(setSystems).catch(() => setSystems([]));
  }
  useEffect(reloadSystems, []);

  // Firmas guardadas del sistema activo.
  useEffect(() => {
    if (sysId == null) {
      setSaved([]);
      return;
    }
    invoke<SignatureRow[]>("signatures_list", { systemId: sysId })
      .then(setSaved)
      .catch(() => setSaved([]));
  }, [sysId]);

  function pickSystem() {
    if (!byName) return;
    const hit = byName.get(search.trim().toLowerCase());
    if (!hit) {
      setMsg(`${tr("No encuentro el sistema")}: ${search}`);
      return;
    }
    setSysId(hit.id);
    setSysName(hit.n);
    setSearch("");
    setMsg("");
  }

  // Saltar a un sistema de las pestañas de "ya trabajados" (sin teclear el nombre).
  function pickSystemById(id: number) {
    setSysId(id);
    setSysName(byId.get(id) ?? `#${id}`);
    setSearch("");
    setMsg("");
  }

  // Cerrar la pestaña de un sistema = borrar sus firmas VIVAS (con confirmación, porque se pierden
  // también las notas de wormhole). NO toca el histórico. Si es el sistema activo, vacía la lista.
  async function closeSystem(id: number, name: string) {
    const ok = await dialogConfirm(
      `${tr("¿Cerrar")} ${name}? ${tr("Se borran sus firmas vivas (el histórico no se toca).")}`,
      { title: tr("Cerrar sistema"), kind: "warning" },
    );
    if (!ok) return;
    try {
      await invoke("signatures_clear_system", { systemId: id });
      if (id === sysId) setSaved([]);
      reloadSystems();
    } catch (e) {
      setMsg(`${tr("Error")}: ${String(e).slice(0, 160)}`);
    }
  }

  function analyse() {
    const rep = parseSignaturePaste(text);
    setPreview(rep.sigs);
    setReport({ ignored: rep.ignored, ignoredSample: rep.ignoredSample, wormholes: rep.wormholes });
  }

  async function confirm() {
    if (!preview || sysId == null) return;
    setBusy(true);
    setMsg("");
    try {
      const signatures: SignatureRow[] = preview.map((s) => ({
        system_id: sysId,
        sig_id: s.id,
        sig_group: s.group,
        kind: s.kind,
        name: s.name,
        signal_pct: s.signalPct,
        distance_au: s.distanceAu,
        note: null, // la nota vive en la fila guardada; el backend la conserva en el upsert
        first_seen: "",
        last_seen: "",
      }));
      const n = await invoke<number>("signatures_replace_system", { systemId: sysId, signatures });
      setSaved(await invoke<SignatureRow[]>("signatures_list", { systemId: sysId }));
      reloadSystems();
      setMsg(`✓ ${n} ${tr("firmas guardadas")}`);
      setPreview(null);
      setReport(null);
      setText("");
      setOpen(false);
    } catch (e) {
      setMsg(`${tr("Error")}: ${String(e).slice(0, 160)}`);
    } finally {
      setBusy(false);
    }
  }

  // Reclasificar a mano. El caso principal: una firma «Sin identificar» (0%, sin nombre) a la que ya
  // has puesto ojo y sabes qué es. Al cambiar la categoría, la fila salta a su cubo.
  async function setKind(sigId: string, kind: SigKind) {
    if (sysId == null) return;
    try {
      await invoke("signature_set_kind", { systemId: sysId, sigId, kind });
      setSaved((prev) =>
        prev.map((r) =>
          r.sig_id === sigId ? { ...r, kind, note: kind === "wormhole" ? r.note : null } : r,
        ),
      );
    } catch (e) {
      setMsg(`${tr("Error")}: ${String(e).slice(0, 160)}`);
    }
  }

  async function saveName(sigId: string, name: string) {
    if (sysId == null) return;
    try {
      await invoke("signature_set_name", { systemId: sysId, sigId, name: name.trim() });
      setSaved((prev) => prev.map((r) => (r.sig_id === sigId ? { ...r, name: name.trim() } : r)));
    } catch (e) {
      setMsg(`${tr("Error")}: ${String(e).slice(0, 160)}`);
    }
  }

  async function saveNote(sigId: string, note: string) {
    if (sysId == null) return;
    try {
      await invoke("signature_set_note", { systemId: sysId, sigId, note: note.trim() || null });
      setSaved((prev) => prev.map((r) => (r.sig_id === sigId ? { ...r, note: note.trim() || null } : r)));
    } catch (e) {
      setMsg(`${tr("Error")}: ${String(e).slice(0, 160)}`);
    }
  }

  // Entrar/salir del sitio: sella (o borra) la hora de entrada. Con la salida (marcar hecha) da el
  // tiempo dentro. Actualiza la fila local para ver el estado "en curso" al momento.
  async function setEntered(row: SignatureRow, entered: boolean) {
    if (sysId == null) return;
    try {
      await invoke("signature_set_entered", { systemId: sysId, sigId: row.sig_id, entered });
      const stamp = entered ? new Date().toISOString() : null;
      setSaved((prev) => prev.map((r) => (r.sig_id === row.sig_id ? { ...r, entered_at: stamp } : r)));
    } catch (e) {
      setMsg(`${tr("Error")}: ${String(e).slice(0, 160)}`);
    }
  }

  function toggleSelect(sigId: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(sigId)) n.delete(sigId);
      else n.add(sigId);
      return n;
    });
  }

  // Descartar las firmas seleccionadas: desaparecieron (las hizo otro, caducaron) o te equivocaste.
  // NO van al histórico —no las hiciste tú—: solo se borran de Pendientes. Con confirmación porque es
  // irreversible (aunque, si la firma sigue viva, reaparece al re-pegar el escaneo).
  async function deleteSelected() {
    if (sysId == null || selected.size === 0) return;
    const n = selected.size;
    const ok = await dialogConfirm(
      `${tr("¿Descartar")} ${n} ${n === 1 ? tr("firma") : tr("firmas")}? ${tr("No van al histórico (no las hiciste tú).")}`,
      { title: tr("Descartar firmas"), kind: "warning" },
    );
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      for (const sigId of selected) {
        await invoke("signature_delete", { systemId: sysId, sigId });
      }
      setSaved((prev) => prev.filter((r) => !selected.has(r.sig_id)));
      reloadSystems();
      setSelected(new Set());
      setMsg(`🗑 ${n} ${n === 1 ? tr("firma descartada") : tr("firmas descartadas")}`);
    } catch (e) {
      setMsg(`${tr("Error")}: ${String(e).slice(0, 160)}`);
    } finally {
      setBusy(false);
    }
  }

  // Marcar como HECHOS los sitios SELECCIONADOS: cada uno entra al histórico (permanente) con su
  // parte del botín y desaparece de Pendientes (el backend lo oculta; se deshace desde el Histórico).
  // El botín total del modal se REPARTE a partes iguales entre los N (aproximado a propósito cuando
  // acumulas loot de varias anomalías). La nota del sitio (destino WH, etc.) se conserva por sitio.
  async function markSelectedDone(totalIsk: number | null, lootNote: string) {
    if (sysId == null || selected.size === 0) return;
    const rows = saved.filter((r) => selected.has(r.sig_id));
    const n = rows.length;
    const share = totalIsk != null ? totalIsk / n : null;
    const noteBase = n > 1 ? `${tr("Lote de")} ${n}${lootNote ? ` · ${lootNote}` : ""}` : lootNote || null;
    setBusy(true);
    setMsg("");
    try {
      for (const row of rows) {
        await invoke<number>("signature_mark_done", {
          systemId: sysId,
          systemName: sysName,
          sigId: row.sig_id,
          lootIsk: share,
          lootNote: noteBase,
          note: row.note?.trim() || null,
          characterId: charId ?? null,
        });
      }
      setSaved((prev) => prev.filter((r) => !selected.has(r.sig_id)));
      reloadSystems();
      setSelected(new Set());
      setLootOpen(false);
      setMsg(`✓ ${n} ${n === 1 ? tr("sitio") : tr("sitios")} ${tr("al histórico")}`);
    } catch (e) {
      setMsg(`${tr("Error")}: ${String(e).slice(0, 160)}`);
    } finally {
      setBusy(false);
    }
  }

  async function clearSystem() {
    if (sysId == null) return;
    setBusy(true);
    try {
      await invoke("signatures_clear_system", { systemId: sysId });
      setSaved([]);
      reloadSystems();
      setMsg(tr("Firmas del sistema borradas."));
    } catch (e) {
      setMsg(`${tr("Error")}: ${String(e).slice(0, 160)}`);
    } finally {
      setBusy(false);
    }
  }

  const wormholesSaved = useMemo(() => saved.filter((r) => r.kind === "wormhole").length, [saved]);

  // Clic en una cabecera: si ya ordenaba por esa columna, invierte; si no, ordena por ella (con la
  // dirección natural de cada campo: señal de mayor a menor, distancia de menor a mayor).
  function clickSort(col: "id" | "name" | "signal" | "dist") {
    if (sortBy === col) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortBy(col);
      setSortDir(col === "signal" ? -1 : 1);
    }
  }
  function sortRows(rows: SignatureRow[]): SignatureRow[] {
    const val = (r: SignatureRow) =>
      sortBy === "id"
        ? r.sig_id
        : sortBy === "name"
          ? r.name || "~" // sin nombre al final
          : sortBy === "signal"
            ? (r.signal_pct ?? -1)
            : (r.distance_au ?? Number.POSITIVE_INFINITY);
    return [...rows].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va < vb) return -sortDir;
      if (va > vb) return sortDir;
      return 0;
    });
  }
  const arrow = (col: string) => (sortBy === col ? (sortDir === 1 ? " ▲" : " ▼") : "");

  return (
    <div className="tb-settings-logs">
      <div className="small" style={{ fontWeight: 600 }}>
        📡 {tr("Firmas del escáner de sondas")}
      </div>
      <div className="small muted">
        {tr(
          "El escáner es una ventana del cliente, no un dato de ESI. Selecciona las firmas en el escáner (Ctrl+A), copia (Ctrl+C) y pega aquí. El sistema lo pones tú: el pegado no lo trae."
        )}
      </div>

      {/* Sistema activo. Si viene dado (estás en él en el mapa), no hace falta buscarlo. */}
      <div className="tb-logs-row" style={{ alignItems: "center", gap: 6 }}>
        <span className="small">
          {tr("Sistema")}: <strong>{sysName || tr("(ninguno)")}</strong>
        </span>
        <input
          className="small"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && pickSystem()}
          placeholder={tr("buscar sistema…")}
          style={{ width: 140 }}
        />
        <button className="pp-add" onClick={pickSystem} disabled={!byName || !search.trim()}>
          {tr("Elegir")}
        </button>
      </div>

      {/* Pestañas de los sistemas donde ya tienes firmas pendientes: clic en el nombre para saltar
          ahí sin teclear; la ✕ cierra el sistema (borra sus firmas vivas, con confirmación). */}
      {systems.length > 0 && (
        <div className="sig-sys-tabs">
          {systems.map((s) => {
            const name = byId.get(s.system_id) ?? `#${s.system_id}`;
            const active = s.system_id === sysId;
            return (
              <div key={s.system_id} className={`sig-sys-tab${active ? " active" : ""}`}>
                <button
                  className="sig-sys-tab-name"
                  onClick={() => pickSystemById(s.system_id)}
                  title={tr("Ver este sistema")}
                >
                  {name} <span className="muted">({s.pending})</span>
                </button>
                <button
                  className="sig-sys-tab-x"
                  title={tr("Cerrar este sistema (borra sus firmas vivas)")}
                  onClick={() => closeSystem(s.system_id, name)}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      {sysId != null && (
        <>
          <div className="small muted">
            {saved.length > 0
              ? `${saved.length} ${tr("firmas")}${wormholesSaved ? ` · ${wormholesSaved} 🕳️` : ""}`
              : tr("Sin firmas guardadas en este sistema.")}
          </div>

          <div className="tb-logs-row">
            <button className="pp-add" onClick={() => setOpen((o) => !o)}>
              📋 {open ? tr("Cerrar") : tr("Pegar escaneo")}
            </button>
            {saved.length > 0 && (
              <button className="pp-add" onClick={clearSystem} disabled={busy}>
                {tr("Borrar firmas")}
              </button>
            )}
          </div>
        </>
      )}

      {open && sysId != null && (
        <>
          <textarea
            className="tb-ansiblex-paste"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder={tr("Pega aquí el escaneo. Da igual que traiga la cabecera o el «0 filtrado(s)».")}
            style={{ width: "100%", fontFamily: "monospace", fontSize: 11 }}
          />
          <div className="tb-logs-row">
            <button className="pp-add" onClick={analyse} disabled={busy || !text.trim()}>
              {tr("Analizar")}
            </button>
          </div>
        </>
      )}

      {/* ---- Tabla de revisión. Nada guardado todavía. ---- */}
      {preview && report && (
        <div className="tb-ansiblex-review">
          <div className="small" style={{ fontWeight: 600, marginTop: 8 }}>
            {preview.length} {tr("firmas")}
            {report.wormholes > 0 && ` · ${report.wormholes} 🕳️ ${tr("wormholes")}`}
            {report.ignored > 0 && ` · ${report.ignored} ${tr("líneas ignoradas")}`}
          </div>
          {report.ignoredSample.length > 0 && (
            <details className="small muted">
              <summary>{tr("Ver líneas ignoradas")}</summary>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 10 }}>{report.ignoredSample.join("\n")}</pre>
            </details>
          )}
          <div style={{ maxHeight: 320, overflowY: "auto", marginTop: 6 }}>
            <table className="small" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  <th>{tr("Tipo")}</th>
                  <th>{tr("ID")}</th>
                  <th>{tr("Nombre")}</th>
                  <th style={{ textAlign: "right" }}>{tr("Señal")}</th>
                  <th style={{ textAlign: "right" }}>{tr("Distancia")}</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((s) => (
                  <tr key={s.id}>
                    <td title={KIND_META[s.kind].label}>
                      {KIND_META[s.kind].icon} {tr(KIND_META[s.kind].label)}
                    </td>
                    <td style={{ fontFamily: "monospace" }}>{s.id}</td>
                    <td>{s.name || <span className="muted">—</span>}</td>
                    <td style={{ textAlign: "right" }}>{s.signalPct != null ? `${s.signalPct}%` : "—"}</td>
                    <td style={{ textAlign: "right" }}>{fmtDist(s.distanceAu)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="tb-logs-row" style={{ marginTop: 6 }}>
            <button className="pp-add" onClick={confirm} disabled={busy || preview.length === 0}>
              ✓ {tr("Confirmar")} ({preview.length})
            </button>
            <button className="pp-add" onClick={() => { setPreview(null); setReport(null); }} disabled={busy}>
              {tr("Cancelar")}
            </button>
          </div>
          <div className="small muted">
            {tr("Se vuelca el escaneo de este sistema conservando tus notas. Pegar solo anomalías no borra las firmas sondeadas (ni al revés).")}
          </div>
        </div>
      )}

      {/* ---- Firmas guardadas del sistema, AGRUPADAS por cubo (combate/minado/exploración/WH). Cada
              bloque solo aparece si tiene firmas — de un vistazo ves qué hay en el sistema. Anotable
              (el destino de un wormhole se convierte en arista de ruta en el mapa). ---- */}
      {!preview && saved.length > 0 && (
        <div className="sig-buckets">
          {BUCKETS.map((b) => {
            const rows = saved.filter((r) => b.kinds.includes(r.kind as SigKind));
            if (rows.length === 0) return null;
            return (
              <div key={b.key} className="sig-bucket">
                <div className="sig-bucket-head small">
                  <span className="sig-bucket-ic">{b.icon}</span>
                  <strong>{tr(b.label)}</strong>
                  <span className="muted">({rows.length})</span>
                </div>
                <table className="small sig-table">
                  <thead>
                    <tr className="sig-th">
                      <th style={{ width: 22 }}></th>
                      <th onClick={() => clickSort("id")}>{tr("ID")}{arrow("id")}</th>
                      <th>{tr("Tipo")}</th>
                      <th onClick={() => clickSort("name")}>{tr("Nombre")}{arrow("name")}</th>
                      <th style={{ textAlign: "right" }} onClick={() => clickSort("signal")}>
                        {tr("Señal")}{arrow("signal")}
                      </th>
                      <th style={{ textAlign: "right" }} onClick={() => clickSort("dist")}>
                        {tr("Distancia")}{arrow("dist")}
                      </th>
                      <th>{tr("Nota")}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortRows(rows).map((r) => (
                      <tr key={r.sig_id} className={selected.has(r.sig_id) ? "sig-row-sel" : ""}>
                        <td style={{ textAlign: "center" }}>
                          <input
                            type="checkbox"
                            checked={selected.has(r.sig_id)}
                            onChange={() => toggleSelect(r.sig_id)}
                            title={tr("Seleccionar para marcar hecha")}
                          />
                        </td>
                        <td style={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>{r.sig_id}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {/* Desplegable de categoría: la firma nueva llega sin tipo; lo pones al
                              descubrir qué es, y la fila salta a su cubo. */}
                          <select
                            className="small sig-kind-sel"
                            value={r.kind}
                            onChange={(e) => setKind(r.sig_id, e.target.value as SigKind)}
                            title={tr("Cambiar categoría")}
                          >
                            {(["unknown", "combat", "data", "relic", "gas", "ore", "wormhole"] as SigKind[]).map(
                              (k) => (
                                <option key={k} value={k}>
                                  {KIND_META[k].icon} {tr(KIND_META[k].label)}
                                </option>
                              ),
                            )}
                          </select>
                        </td>
                        <td>
                          <div className="sig-name-cell">
                            {/* Editable: el escáner lo rellena al sondear, pero puedes escribirlo o
                                corregirlo antes. El enlace ↗ abre la wiki de EVE University con ese
                                nombre para saber si puedes hacer el sitio y cómo. */}
                            <input
                              className="small sig-name-inp"
                              defaultValue={r.name ?? ""}
                              placeholder={tr("nombre…")}
                              onBlur={(e) => e.target.value !== (r.name ?? "") && saveName(r.sig_id, e.target.value)}
                            />
                            {r.name && (
                              <button
                                className="sig-wiki-link"
                                title={`${tr("Buscar en la wiki de EVE University")}: ${siteNameEn(r.name, dungeonIdx)}`}
                                onClick={() => openUrl(siteWikiUrl(r.name, dungeonIdx))}
                              >
                                ↗
                              </button>
                            )}
                          </div>
                        </td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }} className="muted">
                          {r.signal_pct != null ? `${r.signal_pct}%` : ""}
                        </td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }} className="muted">
                          {r.distance_au != null ? fmtDist(r.distance_au) : ""}
                        </td>
                        <td style={{ width: "30%" }}>
                          <input
                            className="small"
                            defaultValue={r.note ?? ""}
                            placeholder={r.kind === "wormhole" ? tr("destino…") : tr("nota…")}
                            onBlur={(e) => e.target.value !== (r.note ?? "") && saveNote(r.sig_id, e.target.value)}
                            style={{ width: "100%" }}
                          />
                        </td>
                        <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                          {/* Entrar / En curso: sella la hora de entrada. Al marcar hecha (salida) se
                              guarda el tiempo dentro. */}
                          {r.entered_at ? (
                            <button
                              className="sig-done-btn sig-in"
                              title={`${tr("En curso desde")} ${fmtClock(r.entered_at)} · ${tr("clic para cancelar la entrada")}`}
                              onClick={() => setEntered(r, false)}
                            >
                              ● {tr("En curso")}
                            </button>
                          ) : (
                            <button
                              className="sig-done-btn"
                              title={tr("Marcar que has entrado en el sitio")}
                              onClick={() => setEntered(r, true)}
                            >
                              ▶ {tr("Entrar")}
                            </button>
                          )}
                          {/* Para marcar HECHA: selecciona la fila (checkbox) y usa la barra de abajo
                              «✓ Hechas (N)», que abre el modal de botín (una o varias a la vez). */}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      {/* Barra de cierre en lote: aparece al seleccionar ≥1 firma. «✓ Hechas (N)» abre el modal de
          botín; con varias, el total se reparte a partes iguales entre ellas. */}
      {!preview && selected.size > 0 && (
        <div className="sig-batch-bar">
          <span className="small">
            {selected.size} {selected.size === 1 ? tr("seleccionada") : tr("seleccionadas")}
          </span>
          <button className="pp-add" onClick={() => setLootOpen(true)} disabled={busy}>
            ✓ {tr("Hechas")} ({selected.size})
          </button>
          <button className="pp-add sig-del-btn" onClick={deleteSelected} disabled={busy}>
            🗑 {tr("Eliminar")} ({selected.size})
          </button>
          <button className="pp-add" onClick={() => setSelected(new Set())} disabled={busy}>
            {tr("Quitar selección")}
          </button>
        </div>
      )}

      <LootPasteModal
        open={lootOpen}
        siteCount={selected.size}
        index={lootIndex}
        busy={busy}
        onCancel={() => setLootOpen(false)}
        onConfirm={(isk, note) => markSelectedDone(isk, note)}
      />

      {msg && <div className="small muted">{msg}</div>}
    </div>
  );
}
