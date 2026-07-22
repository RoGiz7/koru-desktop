// Control de Ajustes para la red de Ansiblex de la alianza: PEGAR → REVISAR → CONFIRMAR.
//
// Nada se guarda al pegar. El pegado se analiza, se enseña la tabla resultante, y el piloto
// confirma (o desmarca lo que no quiera). Es el mismo trato que las fichas de instalación:
// la app propone, quien sabe declara. Aquí importa más que en otros sitios porque el dato viene
// de fuera de EVE — de un wiki que puede estar desactualizado o mal copiado— y un puente fantasma
// en el planificador es PEOR que no tener red: te manda por una ruta que no existe.
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { loadNewEden } from "./neweden";
import {
  parseAnsiblexPaste,
  lightYears,
  type AnsiblexBridge,
  type AnsiblexRow,
} from "./ansiblex";
import type { NeSystem } from "./types";

// Umbral de aviso al contrastar los años luz declarados por la fuente contra los del SDE.
// MEDIDO, no inventado: en la red real (97 puentes) la desviación máxima es 0,0052 ly — puro
// redondeo a 2 decimales del wiki. 0,05 deja un margen de 10× y sigue cazando cualquier error de
// verdad: un par mal emparejado se desvía años luz enteros, no centésimas.
const LY_TOLERANCE = 0.05;

type PreviewRow = {
  bridge: AnsiblexBridge;
  regionA: string;
  regionB: string;
  /** Años luz reales, del SDE. Es el bueno. */
  ly: number;
  /** El declarado se aleja del real más de la cuenta → probable errata al copiar. */
  suspect: boolean;
  include: boolean;
};

export function AnsiblexControl() {
  const [saved, setSaved] = useState<AnsiblexRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [report, setReport] = useState<{
    recognized: number;
    ignored: number;
    ignoredSample: string[];
    unknownNames: string[];
    oneWay: { a: string; b: string }[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    invoke<AnsiblexRow[]>("ansiblex_list").then(setSaved).catch(() => setSaved([]));
  }, []);

  /** Analiza el pegado. NO guarda: solo prepara la tabla de revisión. */
  async function analyse() {
    setBusy(true);
    setMsg("");
    try {
      const ne = await loadNewEden();
      const byName = new Map<string, NeSystem>(ne.systems.map((s) => [s.n.toLowerCase(), s]));
      const byId = new Map<number, NeSystem>(ne.systems.map((s) => [s.id, s]));
      const regions = new Map<number, string>(ne.regions.map((r) => [r.id, r.n]));
      const rep = parseAnsiblexPaste(text, byName);
      const prepared: PreviewRow[] = rep.bridges.map((b) => {
        const sa = byId.get(b.aId)!;
        const sb = byId.get(b.bId)!;
        const ly = lightYears(sa, sb);
        return {
          bridge: b,
          regionA: regions.get(sa.r) ?? "",
          regionB: regions.get(sb.r) ?? "",
          ly,
          suspect: b.ly != null && Math.abs(b.ly - ly) > LY_TOLERANCE,
          include: true,
        };
      });
      setRows(prepared);
      setReport({
        recognized: rep.recognized,
        ignored: rep.ignored,
        ignoredSample: rep.ignoredSample,
        unknownNames: rep.unknownNames,
        oneWay: rep.oneWay,
      });
    } catch (e) {
      setMsg(`${tr("Error")}: ${String(e).slice(0, 160)}`);
    } finally {
      setBusy(false);
    }
  }

  /** Guarda lo confirmado. Sustituye la red entera (el wiki es la foto completa). */
  async function confirm() {
    if (!rows) return;
    setBusy(true);
    setMsg("");
    try {
      const bridges: AnsiblexRow[] = rows
        .filter((r) => r.include)
        .map((r) => ({
          a_id: r.bridge.aId,
          b_id: r.bridge.bId,
          a_name: r.bridge.aName,
          b_name: r.bridge.bName,
          ly_declared: r.bridge.ly,
          owner_a: r.bridge.ownerA,
          owner_b: r.bridge.ownerB,
          route: r.bridge.route,
          status: r.bridge.status,
          source: "paste",
        }));
      const n = await invoke<number>("ansiblex_replace", { bridges });
      setSaved(await invoke<AnsiblexRow[]>("ansiblex_list"));
      setMsg(`✓ ${n} ${tr("puentes guardados")}`);
      setRows(null);
      setReport(null);
      setText("");
      setOpen(false);
    } catch (e) {
      setMsg(`${tr("Error")}: ${String(e).slice(0, 160)}`);
    } finally {
      setBusy(false);
    }
  }

  async function clearAll() {
    setBusy(true);
    try {
      await invoke("ansiblex_clear");
      setSaved([]);
      setMsg(tr("Red vaciada."));
    } catch (e) {
      setMsg(`${tr("Error")}: ${String(e).slice(0, 160)}`);
    } finally {
      setBusy(false);
    }
  }

  const chosen = rows?.filter((r) => r.include).length ?? 0;
  const suspects = rows?.filter((r) => r.suspect).length ?? 0;
  const savedSystems = useMemo(
    () => new Set((saved ?? []).flatMap((b) => [b.a_id, b.b_id])).size,
    [saved]
  );

  return (
    <div className="tb-settings-logs">
      <div className="small" style={{ fontWeight: 600 }}>
        🌉 {tr("Red de Ansiblex de la alianza")}
      </div>
      <div className="small muted">
        {saved && saved.length > 0
          ? `${saved.length} ${tr("puentes")} · ${savedSystems} ${tr("sistemas")}`
          : tr("Sin red importada.")}
      </div>

      {/* Por qué esto se pega en vez de sincronizarse. Si no se dice, la primera pregunta de
          cualquiera es «¿y por qué no lo saca de ESI?». */}
      <div className="small muted">
        {tr(
          "ESI no publica los Ansiblex: no hay endpoint ni scope, y el de estructuras de corp exige rol Director, solo ve los de tu corp y ni siquiera trae el destino. Por eso la red se pega desde la tabla que publica tu alianza."
        )}
      </div>

      <div className="tb-logs-row">
        <button className="pp-add" onClick={() => setOpen((o) => !o)}>
          📋 {open ? tr("Cerrar") : saved && saved.length ? tr("Actualizar red") : tr("Pegar red")}
        </button>
        {saved && saved.length > 0 && (
          <button className="pp-add" onClick={clearAll} disabled={busy}>
            {tr("Vaciar red")}
          </button>
        )}
      </div>

      {open && (
        <>
          <textarea
            className="tb-ansiblex-paste"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder={tr(
              "Selecciona la tabla de jump bridges en el wiki de tu alianza, cópiala y pégala aquí tal cual. Da igual que traiga el título, la cabecera o columnas de más."
            )}
            style={{ width: "100%", fontFamily: "monospace", fontSize: 11 }}
          />
          <div className="tb-logs-row">
            <button className="pp-add" onClick={analyse} disabled={busy || !text.trim()}>
              {busy ? "⏳" : tr("Analizar")}
            </button>
          </div>
        </>
      )}

      {/* ---- Tabla de revisión. Nada de esto está guardado todavía. ---- */}
      {rows && report && (
        <div className="tb-ansiblex-review">
          <div className="small" style={{ fontWeight: 600, marginTop: 8 }}>
            {rows.length} {tr("puentes")} · {new Set(rows.flatMap((r) => [r.bridge.aId, r.bridge.bId])).size}{" "}
            {tr("sistemas")} · {report.recognized} {tr("filas leídas")}
            {report.ignored > 0 && ` · ${report.ignored} ${tr("líneas ignoradas")}`}
          </div>

          {/* Lo que NO entendimos va aparte y en grande: es la causa nº1 de que falte un puente,
              y un fallo mudo aquí es lo que hace que la ruta salga mal sin que nadie sepa por qué. */}
          {report.unknownNames.length > 0 && (
            <div className="fits-err small">
              ⚠ {tr("Sistemas que no existen en el SDE (¿errata al copiar?)")}:{" "}
              {report.unknownNames.join(", ")}
            </div>
          )}
          {report.oneWay.length > 0 && (
            <div className="small muted">
              ⚠ {report.oneWay.length} {tr("puentes declarados en un solo sentido (¿pegado a medias?)")}:{" "}
              {report.oneWay.slice(0, 5).map((o) => `${o.a}↔${o.b}`).join(", ")}
            </div>
          )}
          {suspects > 0 && (
            <div className="fits-err small">
              ⚠ {suspects}{" "}
              {tr("puentes cuya distancia declarada no cuadra con la del SDE. Revísalos antes de guardar.")}
            </div>
          )}
          {report.ignoredSample.length > 0 && (
            <details className="small muted">
              <summary>{tr("Ver líneas ignoradas")}</summary>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 10 }}>
                {report.ignoredSample.join("\n")}
              </pre>
            </details>
          )}

          <div style={{ maxHeight: 320, overflowY: "auto", marginTop: 6 }}>
            <table className="small" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  <th />
                  <th>{tr("Sistema A")}</th>
                  <th>{tr("Sistema B")}</th>
                  <th style={{ textAlign: "right" }}>{tr("ly")}</th>
                  <th>{tr("Dueños")}</th>
                  <th>{tr("Ruta")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={`${r.bridge.aId}-${r.bridge.bId}`}
                    style={{ opacity: r.include ? 1 : 0.4 }}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={r.include}
                        onChange={(e) => {
                          const next = [...rows];
                          next[i] = { ...r, include: e.target.checked };
                          setRows(next);
                        }}
                      />
                    </td>
                    <td>
                      {r.bridge.aName} <span className="muted">· {r.regionA}</span>
                    </td>
                    <td>
                      {r.bridge.bName} <span className="muted">· {r.regionB}</span>
                    </td>
                    <td style={{ textAlign: "right" }} className={r.suspect ? "fits-err" : ""}>
                      {r.ly.toFixed(2)}
                      {r.suspect && r.bridge.ly != null && (
                        <span title={tr("distancia declarada por la fuente")}>
                          {" "}
                          (≠ {r.bridge.ly.toFixed(2)})
                        </span>
                      )}
                    </td>
                    <td className="muted">
                      {r.bridge.ownerA ?? "—"}
                      {r.bridge.ownerB && r.bridge.ownerB !== r.bridge.ownerA
                        ? ` / ${r.bridge.ownerB}`
                        : ""}
                    </td>
                    <td className="muted">{r.bridge.route ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="tb-logs-row" style={{ marginTop: 6 }}>
            <button className="pp-add" onClick={confirm} disabled={busy || chosen === 0}>
              ✓ {tr("Confirmar e importar")} ({chosen})
            </button>
            <button
              className="pp-add"
              onClick={() => {
                setRows(null);
                setReport(null);
              }}
              disabled={busy}
            >
              {tr("Cancelar")}
            </button>
          </div>
          <div className="small muted">
            {tr("Al confirmar se sustituye la red anterior por completo: el wiki es la foto entera y los puentes se caen y se mueven.")}
          </div>
        </div>
      )}

      {msg && <div className="small muted">{msg}</div>}
    </div>
  );
}
