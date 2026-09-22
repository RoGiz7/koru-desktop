// Control de Ajustes para las MEJORAS DE SOBERANÍA de la alianza: PEGAR → REVISAR → CONFIRMAR.
// Calcado del control de Ansiblex (`ansiblexControl.tsx`): nada se guarda al pegar, el piloto
// ve lo que Koru entendió —y lo que NO— y confirma. Ver `sovUpgrades.ts` para el formato.
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr, getLang } from "./i18n";
import { loadNewEden } from "./neweden";
import {
  loadSovUpgrades,
  parseSovUpgradesPaste,
  sovKindIcon,
  type SovParseReport,
  type SovSystemParsed,
  type SovUpgradeRow,
} from "./sovUpgrades";
import type { NeSystem } from "./types";

type PreviewRow = SovSystemParsed & { region: string; include: boolean };

export function SovUpgradesControl() {
  const [saved, setSaved] = useState<SovUpgradeRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [report, setReport] = useState<SovParseReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const es = getLang() === "es";

  useEffect(() => {
    invoke<SovUpgradeRow[]>("sov_upgrades_list").then(setSaved).catch(() => setSaved([]));
  }, []);

  async function analyse() {
    setBusy(true);
    setMsg("");
    try {
      const [ne, catalog] = await Promise.all([loadNewEden(), loadSovUpgrades()]);
      const byName = new Map<string, NeSystem>(ne.systems.map((s) => [s.n.toLowerCase(), s]));
      const regions = new Map<number, string>(ne.regions.map((r) => [r.id, r.n]));
      const rep = parseSovUpgradesPaste(
        text,
        byName,
        new Set(ne.regions.map((r) => r.n.toLowerCase())),
        new Set(ne.constellations.map((c) => c.n.toLowerCase())),
        catalog,
      );
      setRows(rep.systems.map((s) => ({ ...s, region: regions.get(s.regionId) ?? "", include: s.upgrades.length > 0 })));
      setReport(rep);
    } catch (e) {
      setMsg(`${tr("Error")}: ${String(e).slice(0, 160)}`);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!rows) return;
    setBusy(true);
    setMsg("");
    try {
      const out: SovUpgradeRow[] = rows
        .filter((r) => r.include)
        .flatMap((r) =>
          r.upgrades.map((u) => ({ system_id: r.systemId, type_id: u.i, system_name: r.systemName, type_name: u.n, source: "paste" })),
        );
      const n = await invoke<number>("sov_upgrades_replace", { rows: out });
      setSaved(await invoke<SovUpgradeRow[]>("sov_upgrades_list"));
      setMsg(`✓ ${n} ${tr("mejoras guardadas")}`);
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
      await invoke("sov_upgrades_clear");
      setSaved([]);
      setMsg(tr("Lista vaciada."));
    } catch (e) {
      setMsg(`${tr("Error")}: ${String(e).slice(0, 160)}`);
    } finally {
      setBusy(false);
    }
  }

  const chosen = rows?.filter((r) => r.include).length ?? 0;
  const savedSystems = useMemo(() => new Set((saved ?? []).map((r) => r.system_id)).size, [saved]);

  return (
    <div className="tb-settings-logs">
      <div className="small" style={{ fontWeight: 600 }}>
        🏗️ {tr("Mejoras de soberanía de la alianza")}
      </div>
      <div className="small muted">
        {saved && saved.length > 0
          ? `${saved.length} ${tr("mejoras")} · ${savedSystems} ${tr("sistemas")}`
          : tr("Sin mejoras importadas.")}
      </div>
      <div className="small muted">
        {tr(
          "ESI no dice qué mejora tiene instalada cada sistema (detectores de amenazas, prospección de mineral, generadores de efecto…): las alianzas lo reparten en una hoja de cálculo. Pide la tuya y pégala aquí; Koru la pinta en el mapa y en la ficha de cada sistema.",
        )}
      </div>

      <div className="tb-logs-row">
        <button className="pp-add" onClick={() => setOpen((o) => !o)}>
          📋 {open ? tr("Cerrar") : saved && saved.length ? tr("Actualizar mejoras") : tr("Pegar mejoras")}
        </button>
        {saved && saved.length > 0 && (
          <button className="pp-add" onClick={clearAll} disabled={busy}>
            {tr("Vaciar lista")}
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
              "Pega aquí la lista de tu alianza: una línea por sistema con sus mejoras tal cual las escribe el juego, separadas por coma. Vale el volcado en texto («J-XXXX <- Major Threat Detection Array 2, Zydrine Prospecting Array 3») y también las filas copiadas de una hoja de cálculo, con o sin cabecera, región o constelación.",
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

      {rows && report && (
        <div className="tb-ansiblex-review">
          <div className="small" style={{ fontWeight: 600, marginTop: 8 }}>
            {rows.length} {tr("sistemas")} · {rows.reduce((s, r) => s + r.upgrades.length, 0)} {tr("mejoras")}
            {report.emptyRows > 0 && ` · ${report.emptyRows} ${tr("sistemas sin mejora")}`}
            {report.ignored > 0 && ` · ${report.ignored} ${tr("líneas ignoradas")}`}
          </div>
          {report.unknownUpgrades.length > 0 && (
            <div className="fits-err small">
              ⚠ {tr("Mejoras que no están en el catálogo del juego (¿errata, o un SDE más viejo que la mejora?)")}:{" "}
              {report.unknownUpgrades.join(" · ")}
            </div>
          )}
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
                  <th />
                  <th>{tr("Sistema")}</th>
                  <th>{tr("Mejoras")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.systemId} style={{ opacity: r.include ? 1 : 0.4 }}>
                    <td>
                      <input
                        type="checkbox"
                        checked={r.include}
                        disabled={r.upgrades.length === 0}
                        onChange={(e) => {
                          const next = [...rows];
                          next[i] = { ...r, include: e.target.checked };
                          setRows(next);
                        }}
                      />
                    </td>
                    <td>
                      {r.systemName} <span className="muted">· {r.region}</span>
                    </td>
                    <td>
                      {r.upgrades.length === 0 && r.unknown.length === 0 && <span className="muted">—</span>}
                      {r.upgrades.map((u) => (
                        <span key={u.i} className="pp-tag" title={es ? u.de : u.d} style={{ marginRight: 4 }}>
                          {sovKindIcon(u.k)} {es ? u.ne : u.n}
                        </span>
                      ))}
                      {r.unknown.map((n) => (
                        <span key={n} className="pp-tag fits-err" style={{ marginRight: 4 }}>
                          ? {n}
                        </span>
                      ))}
                    </td>
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
            {tr("Al confirmar se sustituye la lista anterior por completo: la hoja es la foto entera y las mejoras se cambian y se retiran.")}
          </div>
        </div>
      )}

      {msg && <div className="small muted">{msg}</div>}
    </div>
  );
}
