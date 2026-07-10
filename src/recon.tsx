// Fase C — Reconstrucción: minería / rateo / viaje reconstruidos del histórico de gamelog local
// (años atrás, mucho más que ESI). Solo lectura de agregados ya volcados en la BD por el escaneo.
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { fmtSp } from "./format";
import { Kpi, Bars, MultiLineProgress } from "./charts";
import type { GamelogRecon, DayVal } from "./types";

const fmtInt = (n: number) => Math.round(n).toLocaleString();

// Agrega una serie diaria [{date,value}] a meses "AAAA-MM" para la gráfica.
function monthly(series: DayVal[]) {
  const map = new Map<string, number>();
  for (const p of series) {
    const k = p.date.slice(0, 7);
    map.set(k, (map.get(k) ?? 0) + p.value);
  }
  const labels = [...map.keys()].sort();
  return { labels, values: labels.map((k) => map.get(k)!) };
}

export function ReconView({ subject }: { subject?: number | "global" }) {
  const subjectId = typeof subject === "number" ? subject : 0;
  const [r, setR] = useState<GamelogRecon | null>(null);
  useEffect(() => {
    invoke<GamelogRecon>("get_gamelog_recon", { subjectId }).then(setR).catch(() => setR(null));
  }, [subjectId]);

  if (!r) return <p className="muted small">{tr("Cargando…")}</p>;
  const empty = r.mining_units === 0 && r.bounty_isk === 0 && r.total_jumps === 0;
  if (empty) {
    return (
      <p className="muted small">
        {tr("Aún no hay datos reconstruidos. Abre ⚙️ Ajustes → Logs de EVE y pulsa Escanear.")}
      </p>
    );
  }

  const mSeries = monthly(r.mining_series);
  const bSeries = monthly(r.bounty_series);
  // Desperdicio (log-only) alineado a los meses de la minería, para superponerlo como línea.
  const wByMonth = new Map<string, number>();
  for (const p of r.mining_waste_series) {
    const k = p.date.slice(0, 7);
    wByMonth.set(k, (wByMonth.get(k) ?? 0) + p.value);
  }
  const wasteVals = mSeries.labels.map((l) => wByMonth.get(l) ?? 0);
  const removed = r.mining_units + r.mining_wasted;
  const wastePct = removed > 0 ? (r.mining_wasted / removed) * 100 : 0;
  // Crítico (Equinox) alineado a los meses de la minería.
  const cByMonth = new Map<string, number>();
  for (const p of r.mining_crit_series) {
    const k = p.date.slice(0, 7);
    cByMonth.set(k, (cByMonth.get(k) ?? 0) + p.value);
  }
  const critVals = mSeries.labels.map((l) => cByMonth.get(l) ?? 0);
  const critPct = r.mining_units > 0 ? (r.mining_crit / r.mining_units) * 100 : 0;
  // Fase D — cobertura: qué parte del total pudimos situar en un sistema. Se enseña siempre que haya
  // algo atribuido, porque un ranking al 40% de cobertura no significa lo mismo que uno al 99%.
  const hasSys = r.sys_bounty.length > 0 || r.sys_mining.length > 0 || r.sys_combat.length > 0;
  const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
  const bountyCov = pct(r.sys_bounty_covered, r.bounty_isk);
  const miningCov = pct(r.sys_mining_covered, r.mining_units);
  const combatCov = pct(r.sys_combat_covered, r.combat_dmg_done);
  // Combate: daño hecho/recibido por mes + % wrecking (golpes de gracia).
  const cdSeries = monthly(r.combat_done_series);
  const ctByMonth = new Map<string, number>();
  for (const p of r.combat_taken_series) {
    const k = p.date.slice(0, 7);
    ctByMonth.set(k, (ctByMonth.get(k) ?? 0) + p.value);
  }
  const ctVals = cdSeries.labels.map((l) => ctByMonth.get(l) ?? 0);
  const wreckDonePct = r.combat_shots_done > 0 ? (r.combat_wrecks_done / r.combat_shots_done) * 100 : 0;
  const wreckTakenPct = r.combat_shots_taken > 0 ? (r.combat_wrecks_taken / r.combat_shots_taken) * 100 : 0;
  const hasCombat = r.combat_dmg_done > 0 || r.combat_dmg_taken > 0;
  // DPS sobre el tiempo de combate REAL (segundos en los que hubo daño), no sobre el de sesión.
  const hasDps = r.combat_active_secs > 0;
  const avgDps = hasDps ? r.combat_dmg_done / r.combat_active_secs : 0;
  const combatHours = r.combat_active_secs / 3600;
  // DPS por mes bien ponderado: Σdaño del mes / Σsegundos del mes (por eso pedimos el denominador).
  const secsByMonth = new Map<string, number>();
  for (const p of r.combat_secs_series) {
    const k = p.date.slice(0, 7);
    secsByMonth.set(k, (secsByMonth.get(k) ?? 0) + p.value);
  }
  const dpsVals = cdSeries.labels.map((l, i) => {
    const s = secsByMonth.get(l) ?? 0;
    return s > 0 ? cdSeries.values[i] / s : 0;
  });

  return (
    <div className="recon-view">
      <div className="bit-head">
        <h4>🛠️ {tr("Reconstrucción")}</h4>
        <span className="muted small">
          {tr("Minería, rateo y viaje del histórico local — años que ESI no guarda")}
        </span>
      </div>

      {/* Minería */}
      <div className="recon-block">
        <h5>⛏️ {tr("Minería")}</h5>
        <div className="kpi-row">
          <Kpi label={tr("Extraído (base+crít)")} value={fmtSp(r.mining_units)} />
          <Kpi label={tr("Ciclos")} value={fmtInt(r.mining_cycles)} />
          {r.mining_crit > 0 && <Kpi label={tr("Crítico")} value={fmtSp(r.mining_crit)} tone="pos" />}
          {r.mining_crit > 0 && <Kpi label={tr("% crítico")} value={`${critPct.toFixed(1)}%`} tone="pos" />}
          {r.mining_wasted > 0 && <Kpi label={tr("Desperdiciado")} value={fmtSp(r.mining_wasted)} tone="neg" />}
          {removed > 0 && <Kpi label={tr("% desperdicio")} value={`${wastePct.toFixed(1)}%`} tone="neg" />}
        </div>
        {mSeries.labels.length > 1 && (
          <MultiLineProgress
            labels={mSeries.labels}
            series={[
              { name: tr("Extraído / mes"), color: "#8a7bd8", values: mSeries.values },
              ...(r.mining_crit > 0
                ? [{ name: tr("Crítico / mes"), color: "#57c785", values: critVals, dash: true }]
                : []),
              // El desperdicio es mena DESTRUIDA: nunca entró en la bodega. Se pinta bajo cero, como
              // "No ingresado" en Rateo. El dato guardado sigue siendo positivo; solo se niega al pintar.
              ...(r.mining_wasted > 0
                ? [
                    {
                      name: tr("Desperdiciado / mes"),
                      color: "#d76a6a",
                      values: wasteVals.map((v) => -v),
                      dash: true,
                    },
                  ]
                : []),
            ]}
            fmt={fmtSp}
          />
        )}
        {r.top_ores.length > 0 && (
          <div className="recon-bars">
            <div className="muted small">{tr("Top menas (por unidades)")}</div>
            <Bars
              items={r.top_ores.slice(0, 12).map((o) => ({ label: o.ore, value: o.units }))}
              color="#8a7bd8"
              fmt={fmtSp}
            />
          </div>
        )}
      </div>

      {/* Rateo (bounty) */}
      <div className="recon-block">
        <h5>💰 {tr("Rateo (bounties)")}</h5>
        <div className="kpi-row">
          <Kpi label={tr("ISK en recompensas")} value={fmtSp(r.bounty_isk)} />
          <Kpi label={tr("Pagos")} value={fmtInt(r.bounty_pays)} />
        </div>
        {bSeries.labels.length > 1 && (
          <MultiLineProgress
            labels={bSeries.labels}
            series={[{ name: tr("ISK / mes"), color: "#57c785", values: bSeries.values }]}
            fmt={fmtSp}
          />
        )}
      </div>

      {/* Viaje */}
      <div className="recon-block">
        <h5>🚀 {tr("Viaje")}</h5>
        <div className="kpi-row">
          <Kpi label={tr("Saltos")} value={fmtInt(r.total_jumps)} />
          <Kpi label={tr("Sistemas distintos")} value={fmtInt(r.distinct_systems)} />
        </div>
        {r.top_systems.length > 0 && (
          <div className="recon-bars">
            <div className="muted small">{tr("Sistemas más visitados")}</div>
            <Bars
              items={r.top_systems.slice(0, 12).map((s) => ({ label: s.system, value: s.visits }))}
              color="#5b9bd1"
              fmt={fmtInt}
            />
          </div>
        )}
      </div>

      {/* Fase D — el gamelog no dice dónde estabas salvo cuando saltas; el canal Local sí. */}
      {hasSys && (
        <div className="recon-block">
          <h5>📍 {tr("Dónde")}</h5>
          <p className="muted small">
            {tr(
              "Sacado del canal Local, que anuncia cada cambio de sistema. Solo se atribuyen las sesiones cuyo chatlog se conserva; el resto cuenta en los totales de arriba, pero no aquí.",
            )}
          </p>
          {r.sys_bounty.length > 0 && (
            <div className="recon-bars">
              <div className="muted small">
                {tr("Dónde rateaste")} · {tr("atribuido")} {bountyCov.toFixed(0)}%
              </div>
              <Bars
                items={r.sys_bounty.slice(0, 12).map((s) => ({ label: s.system, value: s.isk }))}
                color="#e0b35c"
                fmt={fmtSp}
              />
            </div>
          )}
          {r.sys_mining.length > 0 && (
            <div className="recon-bars">
              <div className="muted small">
                {tr("Dónde minaste")} · {tr("atribuido")} {miningCov.toFixed(0)}%
              </div>
              <Bars
                items={r.sys_mining.slice(0, 12).map((s) => ({ label: s.system, value: s.units }))}
                color="#5b9bd1"
                fmt={fmtInt}
              />
            </div>
          )}
          {r.sys_combat.length > 0 && (
            <div className="recon-bars">
              <div className="muted small">
                {tr("Dónde peleaste")} · {tr("atribuido")} {combatCov.toFixed(0)}%
              </div>
              <Bars
                items={r.sys_combat.slice(0, 12).map((s) => ({ label: s.system, value: s.dmg_done }))}
                color="#57c785"
                fmt={fmtSp}
              />
            </div>
          )}
        </div>
      )}

      {/* Combate (LOG-ONLY: ESI no da nada de esto) */}
      {hasCombat && (
        <div className="recon-block">
          <h5>💥 {tr("Combate")}</h5>
          <div className="kpi-row">
            <Kpi label={tr("Daño hecho")} value={fmtSp(r.combat_dmg_done)} tone="pos" />
            <Kpi label={tr("Daño recibido")} value={fmtSp(r.combat_dmg_taken)} tone="neg" />
            {r.combat_shots_done > 0 && (
              <Kpi label={tr("% wrecking hecho")} value={`${wreckDonePct.toFixed(1)}%`} tone="pos" />
            )}
            {r.combat_shots_taken > 0 && (
              <Kpi label={tr("% wrecking recibido")} value={`${wreckTakenPct.toFixed(1)}%`} />
            )}
            {hasDps && <Kpi label={tr("DPS medio")} value={fmtInt(avgDps)} tone="pos" />}
            {hasDps && <Kpi label={tr("DPS pico")} value={fmtInt(r.combat_peak_dps)} tone="pos" />}
            {hasDps && (
              <Kpi
                label={tr("Tiempo en combate")}
                value={combatHours >= 1 ? `${fmtInt(combatHours)} h` : `${fmtInt(r.combat_active_secs)} s`}
              />
            )}
          </div>
          {hasDps && (
            <p className="muted small">
              {tr("El DPS se mide sobre los segundos en los que hubo daño, no sobre el tiempo de sesión. El pico es el mayor daño concentrado en un solo segundo.")}
            </p>
          )}
          {cdSeries.labels.length > 1 && (
            <MultiLineProgress
              labels={cdSeries.labels}
              series={[
                { name: tr("Daño hecho / mes"), color: "#57c785", values: cdSeries.values },
                { name: tr("Daño recibido / mes"), color: "#d76a6a", values: ctVals },
              ]}
              fmt={fmtSp}
            />
          )}
          {hasDps && cdSeries.labels.length > 1 && (
            <MultiLineProgress
              labels={cdSeries.labels}
              series={[{ name: tr("DPS medio / mes"), color: "#e0b35c", values: dpsVals }]}
              fmt={(n: number) => `${fmtInt(n)} DPS`}
            />
          )}
          {r.top_rats.length > 0 && (
            <div className="recon-bars">
              <div className="muted small">{tr("Ratas más batidas (por daño)")}</div>
              <Bars
                items={r.top_rats.slice(0, 12).map((x) => ({ label: x.rat, value: x.dmg }))}
                color="#57c785"
                fmt={fmtSp}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
