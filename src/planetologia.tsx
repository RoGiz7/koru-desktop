// Planetología R1a (SPEC_PLANETOLOGIA.md): de tabla plana a dashboard de colonias.
// Tarjeta por colonia (multi-personaje) con la salud de sus extractores (countdown del PEOR),
// producción/hora real por producto y CAPACIDAD/día valorada. Click → detalle de pins.
//
// Honestidad de los números (spec §4):
// - Extractores: ritmo REAL del pin (qty_per_cycle/cycle_time). Caducado → su línea es 0.
// - Fábricas: lo suyo es CAPACIDAD (output del esquema × fábricas), no producción garantizada:
//   no verificamos aún el flujo de insumos (routes → R1c). La cabecera lo llama "capacidad".
// - Valor/día: SOLO fábricas si las hay (su output es lo que exportas); si no, extracción.
//   Sumar ambos contaría el P0 dos veces (la fábrica se lo come).
// La clasificación de pins es FUNCIONAL (tiene extractor / tiene esquema / tiene contenido),
// sin listas mágicas de typeIDs.
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr, getLang } from "./i18n";
import { fmtSp, fmtIsk, typeIcon } from "./format";
import { Kpi } from "./charts";
import type { Planet, PlanetDetail, PlanetPin, PiSchematic } from "./types";

/** Horas hasta una fecha ISO (negativo = pasado). null si no hay fecha. */
function hoursUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - Date.now();
  return Number.isNaN(ms) ? null : ms / 3_600_000;
}

/** Clase de salud según horas restantes del peor extractor. */
function healthClass(h: number | null): string {
  if (h == null) return "";
  if (h <= 0) return "pi-dead";
  if (h <= 6) return "pi-crit";
  if (h <= 24) return "pi-warn";
  return "pi-ok";
}

function fmtHours(h: number): string {
  if (h <= 0) return tr("parado");
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  if (h < 48) return `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m`;
  return `${Math.floor(h / 24)}d ${Math.floor(h % 24)}h`;
}

// --- R1b: planificador inverso (¿qué necesito para fabricar T?) ---
// Datos: pi_schematics.json (árbol de insumos) + pi_p0_planets.json (P0 → tipos de planeta,
// verificado contra EVE University). El árbol resuelve SIEMPRE a P0 (grafo comprobado sin huecos).

/** public/pi_p0_planets.json: P0 (materia prima) ↔ tipos de planeta que la producen. */
type P0Planets = {
  p0: Record<string, { en: string; planets: string[] }>;
  planets: Record<string, { en: string; p0: number[] }>;
};

type SchemRec = Record<string, PiSchematic>;

/** Índice output typeID → id de esquema (cada producto lo fabrica un único esquema). */
function buildOutIndex(s: SchemRec): Map<number, string> {
  const m = new Map<number, string>();
  for (const [sid, v] of Object.entries(s)) m.set(v.out[0], sid);
  return m;
}

/** Tier de un producto: P0 = 0; esquema = 1 + max(tier de sus insumos). Memoizado. */
function tierOf(
  tid: number,
  s: SchemRec,
  out: Map<number, string>,
  p0: Set<number>,
  memo: Map<number, number>,
): number {
  if (p0.has(tid)) return 0;
  const c = memo.get(tid);
  if (c != null) return c;
  const sid = out.get(tid);
  if (sid == null) return 0;
  let t = 0;
  for (const [itid] of s[sid].in) t = Math.max(t, tierOf(itid, s, out, p0, memo));
  const r = t + 1;
  memo.set(tid, r);
  return r;
}

/** Huella de P0 para un ciclo del objetivo: suma por ratios el árbol hasta las materias primas. */
function p0Footprint(
  targetTid: number,
  s: SchemRec,
  out: Map<number, string>,
  p0: Set<number>,
): Map<number, number> {
  const acc = new Map<number, number>();
  const need = (tid: number, qty: number) => {
    if (p0.has(tid)) {
      acc.set(tid, (acc.get(tid) ?? 0) + qty);
      return;
    }
    const sid = out.get(tid);
    if (sid == null) return; // no debería: el grafo resuelve todo a P0
    const sch = s[sid];
    const cycles = qty / sch.out[1];
    for (const [itid, iq] of sch.in) need(itid, iq * cycles);
  };
  const sid = out.get(targetTid);
  if (sid == null) return acc;
  need(targetTid, s[sid].out[1]);
  return acc;
}

type ColonyCalc = {
  key: string;
  planet: Planet;
  detail: PlanetDetail | null;
  worst: number | null; // horas del peor extractor (null = sin extractores o sin detalle)
  extraction: { tid: number; perHour: number; dead: boolean }[];
  factories: { tid: number; perHour: number; name: string }[];
  valuePerDay: number; // capacidad/día valorada (fábricas si hay; si no, extracción)
  priced: boolean;
};

export function PlanetologiaView({
  planets,
  busy,
  syncTick,
}: {
  planets: Planet[] | null;
  busy: boolean;
  /// Latido de App: cada auto-sync refresca detalles (ETag: los 304 son gratis).
  syncTick?: number;
}) {
  const [details, setDetails] = useState<Map<string, PlanetDetail>>(new Map());
  const [schematics, setSchematics] = useState<Record<string, PiSchematic>>({});
  const [prices, setPrices] = useState<Map<number, number>>(new Map());
  const [open, setOpen] = useState<string | null>(null);

  const [p0table, setP0table] = useState<P0Planets | null>(null);

  useEffect(() => {
    fetch("/pi_schematics.json").then((r) => r.json()).then(setSchematics).catch(() => setSchematics({}));
    fetch("/pi_p0_planets.json").then((r) => r.json()).then(setP0table).catch(() => setP0table(null));
  }, []);

  // Detalle de cada colonia (≤6 por personaje; get_cached con ETag → refresco barato).
  useEffect(() => {
    if (!planets || planets.length === 0) {
      setDetails(new Map());
      return;
    }
    let alive = true;
    (async () => {
      const m = new Map<string, PlanetDetail>();
      await Promise.all(
        planets
          .filter((p) => p.planet_id > 0)
          .map(async (p) => {
            try {
              const d = await invoke<PlanetDetail>("get_planet_detail", {
                characterId: p.character_id,
                planetId: p.planet_id,
              });
              m.set(`${p.character_id}:${p.planet_id}`, d);
            } catch {
              /* sin scope/red: la tarjeta queda sin detalle, honesta */
            }
          }),
      );
      if (alive) setDetails(m);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planets, syncTick]);

  // Precios de los productos visibles (extraídos + fabricados), del prices_map local.
  useEffect(() => {
    const ids = new Set<number>();
    for (const d of details.values()) {
      for (const pin of d.pins) {
        if (pin.extractor?.product_type_id) ids.add(pin.extractor.product_type_id);
        const sch = pin.schematic_id != null ? schematics[String(pin.schematic_id)] : undefined;
        if (sch) ids.add(sch.out[0]);
      }
    }
    if (ids.size === 0) return;
    invoke<Record<number, number>>("get_type_prices", { ids: [...ids] })
      .then((r) => setPrices(new Map(Object.entries(r).map(([k, v]) => [Number(k), v]))))
      .catch(() => {});
  }, [details, schematics]);

  const colonies: ColonyCalc[] = useMemo(() => {
    if (!planets) return [];
    return planets.map((p) => {
      const key = `${p.character_id}:${p.planet_id}`;
      const detail = details.get(key) ?? null;
      const extraction = new Map<number, { perHour: number; dead: boolean }>();
      const factories = new Map<number, { perHour: number; name: string }>();
      let worst: number | null = null;
      if (detail) {
        for (const pin of detail.pins) {
          const ex = pin.extractor;
          // Un pin CON extractor_details es un extractor, tenga programa o no. ESI deja todos
          // sus campos opcionales: sin programa (o caducado hace tiempo) viene sin producto ni
          // ritmo — y eso ES un extractor parado, no algo que esconder (nos pasó en vivo:
          // colonia con extractor sin programa parecía "solo fábricas").
          if (ex) {
            const h = hoursUntil(pin.expiry_time);
            const programmed = !!(ex.product_type_id && ex.qty_per_cycle && ex.cycle_time);
            // Sin programa y sin fecha = parado a todos los efectos (peor caso: 0h).
            const eff = h ?? (programmed ? null : 0);
            if (eff != null && (worst == null || eff < worst)) worst = eff;
            if (programmed) {
              const dead = eff != null && eff <= 0;
              const rate = dead ? 0 : (ex.qty_per_cycle! * 3600) / ex.cycle_time!;
              const e = extraction.get(ex.product_type_id!) ?? { perHour: 0, dead: true };
              extraction.set(ex.product_type_id!, {
                perHour: e.perHour + rate,
                dead: e.dead && dead,
              });
            } else {
              // Chip "sin programa" con clave 0: visible, honesto, y cuenta como parado.
              const e = extraction.get(0) ?? { perHour: 0, dead: true };
              extraction.set(0, { perHour: e.perHour, dead: true });
            }
          }
          const sch = pin.schematic_id != null ? schematics[String(pin.schematic_id)] : undefined;
          if (sch && sch.t > 0) {
            const [tid, qty] = sch.out;
            const f = factories.get(tid) ?? { perHour: 0, name: "" };
            factories.set(tid, {
              perHour: f.perHour + (qty * 3600) / sch.t,
              name: getLang() === "es" ? sch.n.es : sch.n.en,
            });
          }
        }
      }
      const fList = [...factories.entries()].map(([tid, f]) => ({ tid, ...f }));
      const eList = [...extraction.entries()].map(([tid, e]) => ({ tid, ...e }));
      // Valor/día: fábricas si las hay (sumar extracción contaría el P0 dos veces).
      const base = fList.length > 0 ? fList : eList.map((e) => ({ tid: e.tid, perHour: e.perHour }));
      let priced = base.length > 0;
      let valuePerDay = 0;
      for (const b of base) {
        const pr = prices.get(b.tid);
        if (pr == null) priced = false;
        valuePerDay += b.perHour * 24 * (pr ?? 0);
      }
      return { key, planet: p, detail, worst, extraction: eList, factories: fList, valuePerDay, priced };
    });
  }, [planets, details, schematics, prices]);

  // Lo que TÚ tienes hoy: tipos de planeta, P0 que extraes, productos que fabricas.
  // Alimenta el diff del planificador inverso ("te falta X").
  const mine = useMemo(() => {
    const planetTypes = new Set<string>();
    const p0 = new Set<number>();
    const outputs = new Set<number>();
    for (const c of colonies) {
      if (c.planet.planet_type) planetTypes.add(c.planet.planet_type);
      for (const e of c.extraction) if (e.tid > 0) p0.add(e.tid);
      for (const f of c.factories) outputs.add(f.tid);
    }
    return { planetTypes, p0, outputs };
  }, [colonies]);

  if (!planets) return <p className="muted">{busy ? tr("Cargando colonias…") : tr("Sin datos.")}</p>;
  if (planets.length === 0)
    return <p className="muted small">{tr("No tienes colonias de Planetary Interaction.")}</p>;

  // Las enfermas primero: caducados, luego por horas restantes; las sanas al final.
  const ordered = [...colonies].sort((a, b) => (a.worst ?? 1e9) - (b.worst ?? 1e9));
  const dead = colonies.filter((c) => c.worst != null && c.worst <= 0).length;
  const soon = colonies.filter((c) => c.worst != null && c.worst > 0 && c.worst <= 24).length;
  const totalValue = colonies.reduce((s, c) => s + c.valuePerDay, 0);
  const allPriced = colonies.every((c) => c.priced || c.valuePerDay === 0);

  return (
    <>
      <div className="kpis">
        <Kpi label={tr("Colonias")} value={fmtSp(planets.length)} />
        <Kpi
          label={tr("Extractores parados")}
          value={fmtSp(dead)}
          tone={dead > 0 ? "neg" : "pos"}
        />
        <Kpi label={tr("Caducan en <24h")} value={fmtSp(soon)} tone={soon > 0 ? "neg" : undefined} />
        <Kpi
          label={`${tr("Capacidad")}/${tr("día")}${allPriced ? "" : " *"}`}
          value={fmtIsk(totalValue)}
        />
      </div>
      <p className="muted small">
        {tr("Capacidad = lo que tus esquemas pueden producir a ciclo lleno, valorado a precio medio de mercado. La producción real depende de que los insumos lleguen (eso llega en la siguiente fase).")}
        {!allPriced && ` ${tr("* Algún producto sin precio de mercado aún: sincroniza y vuelve.")}`}
      </p>

      <div className="medal-grid">
        {ordered.map((c) => {
          const p = c.planet;
          const cls = healthClass(c.worst);
          const isOpen = open === c.key;
          return (
            <div key={c.key} className={`pi-card ${cls}`} onClick={() => setOpen(isOpen ? null : c.key)}>
              <div className="pi-card-head">
                <img
                  src={`https://images.evetech.net/characters/${p.character_id}/portrait?size=32`}
                  alt=""
                  width={24}
                  height={24}
                  style={{ borderRadius: 4 }}
                />
                <strong>{p.system_name ?? `#${p.system_id}`}</strong>
                <span className="muted small" style={{ textTransform: "capitalize" }}>
                  {tr(p.planet_type)} · {tr("nivel")} {p.upgrade_level}
                </span>
                {c.worst != null && (
                  <span className={`pi-expiry ${cls}`} title={tr("Peor extractor")}>
                    ⏳ {fmtHours(c.worst)}
                  </span>
                )}
              </div>
              {c.detail == null ? (
                <p className="muted small">{tr("Sin detalle (aún cargando o sin acceso).")}</p>
              ) : (
                <>
                  {c.extraction.length > 0 && (
                    <div className="pi-row small">
                      ⛏️{" "}
                      {c.extraction.map((e) => (
                        <span key={e.tid} className={`pi-prod${e.dead ? " pi-dead-txt" : ""}`}>
                          {e.tid > 0 && (
                            <img src={typeIcon(e.tid, 32) ?? undefined} alt="" width={18} height={18} />
                          )}
                          {e.tid === 0
                            ? tr("sin programa")
                            : e.dead
                              ? tr("parado")
                              : `${fmtSp(Math.round(e.perHour))}/h`}
                        </span>
                      ))}
                    </div>
                  )}
                  {c.factories.length > 0 && (
                    <div className="pi-row small">
                      🏭{" "}
                      {c.factories.map((f) => (
                        <span key={f.tid} className="pi-prod" title={f.name}>
                          <img src={typeIcon(f.tid, 32) ?? undefined} alt="" width={18} height={18} />
                          {f.perHour >= 10 ? fmtSp(Math.round(f.perHour)) : f.perHour.toFixed(1)}/h
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="pi-row small muted">
                    {c.valuePerDay > 0 && (
                      <span>
                        💰 {fmtIsk(c.valuePerDay)}/{tr("día")}
                        {c.priced ? "" : " *"}
                      </span>
                    )}
                    <span>
                      {c.detail.pins.length} {tr("pins")} · {c.detail.routes.length} {tr("rutas")}
                    </span>
                  </div>
                  {isOpen && <ColonyPins pins={c.detail.pins} schematics={schematics} />}
                </>
              )}
            </div>
          );
        })}
      </div>

      <InversePlanner schematics={schematics} p0table={p0table} mine={mine} />
    </>
  );
}

/** Planificador inverso: elige un producto PI y te dice qué P0 hacen falta, de qué tipos de
 *  planeta salen, y qué te falta según tus colonias actuales. R1b (SPEC §1.4 / §2). */
function InversePlanner({
  schematics,
  p0table,
  mine,
}: {
  schematics: Record<string, PiSchematic>;
  p0table: P0Planets | null;
  mine: { planetTypes: Set<string>; p0: Set<number>; outputs: Set<number> };
}) {
  const [target, setTarget] = useState<string>("");
  const outIndex = useMemo(() => buildOutIndex(schematics), [schematics]);
  const p0set = useMemo(
    () => new Set<number>(p0table ? Object.keys(p0table.p0).map(Number) : []),
    [p0table],
  );

  // Opciones del selector: todos los productos P1–P4, ordenados por tier y nombre.
  const options = useMemo(() => {
    const memo = new Map<number, number>();
    const list = Object.entries(schematics).map(([sid, v]) => ({
      sid,
      name: getLang() === "es" ? v.n.es : v.n.en,
      tier: tierOf(v.out[0], schematics, outIndex, p0set, memo),
    }));
    list.sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
    return list;
  }, [schematics, outIndex, p0set]);

  const plan = useMemo(() => {
    if (!target || !p0table) return null;
    const sch = schematics[target];
    if (!sch) return null;
    const foot = p0Footprint(sch.out[0], schematics, outIndex, p0set);
    const rows = [...foot.entries()]
      .map(([tid, qty]) => {
        const info = p0table.p0[String(tid)];
        const planets = info ? info.planets : [];
        return {
          tid,
          qty,
          name: info?.en ?? `#${tid}`,
          planets,
          haveP0: mine.p0.has(tid),
          havePlanet: planets.some((pk) => mine.planetTypes.has(pk)),
        };
      })
      .sort((a, b) => b.qty - a.qty);
    const neededPlanets = new Set<string>();
    for (const r of rows) for (const pk of r.planets) neededPlanets.add(pk);
    const missing = rows.filter((r) => !r.haveP0).length;
    return { sch, rows, neededPlanets, missing };
  }, [target, schematics, outIndex, p0set, p0table, mine]);

  if (Object.keys(schematics).length === 0 || !p0table) return null;

  return (
    <div className="pi-planner">
      <h3>{tr("Planificador inverso")}</h3>
      <p className="muted small">
        {tr("Elige qué quieres fabricar: te digo qué P0 hacen falta, de qué tipos de planeta salen, y qué te falta según tus colonias.")}
      </p>
      <select
        className="pi-select"
        value={target}
        onChange={(e) => setTarget(e.target.value)}
      >
        <option value="">{tr("— Elige un producto PI —")}</option>
        {options.map((o) => (
          <option key={o.sid} value={o.sid}>
            {`P${o.tier} · ${o.name}`}
          </option>
        ))}
      </select>

      {plan && (
        <div className="pi-plan">
          <div className="pi-row small">
            <strong>{tr("Receta")}:</strong>
            {plan.sch.in.map(([itid, iq]) => (
              <span key={itid} className="pi-prod">
                <img src={typeIcon(itid, 32) ?? undefined} alt="" width={18} height={18} />
                {fmtSp(iq)}
              </span>
            ))}
            <span className="muted">
              → {fmtSp(plan.sch.out[1])}/{Math.round(plan.sch.t / 60)}min
            </span>
          </div>

          <table className="pi-p0-table small">
            <thead>
              <tr>
                <th>{tr("P0 necesario")}</th>
                <th>{tr("por ciclo")}</th>
                <th>{tr("Tipos de planeta")}</th>
                <th title={tr("✓ ya lo extraes · ◐ tienes el planeta pero no ese extractor · ✗ te falta el tipo de planeta")}>
                  {tr("Tú")}
                </th>
              </tr>
            </thead>
            <tbody>
              {plan.rows.map((r) => (
                <tr key={r.tid} className={r.haveP0 ? "pi-ok" : r.havePlanet ? "pi-warn" : "pi-dead"}>
                  <td>
                    <img src={typeIcon(r.tid, 32) ?? undefined} alt="" width={16} height={16} />{" "}
                    {tr(r.name)}
                  </td>
                  <td>{fmtSp(Math.round(r.qty))}</td>
                  <td className="muted">{r.planets.map((pk) => tr(pk)).join(", ")}</td>
                  <td>{r.haveP0 ? "✓" : r.havePlanet ? "◐" : "✗"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="muted small">
            {tr("Cantidades por un ciclo del objetivo (ratios teóricos del árbol, no de tu producción real).")}{" "}
            {plan.missing === 0
              ? tr("Ya extraes todos los P0 que necesita.")
              : `${tr("Te faltan P0 por extraer:")} ${plan.missing}.`}
          </p>
        </div>
      )}
    </div>
  );
}

/** Detalle de pins de una colonia, agrupado FUNCIONALMENTE (sin listas mágicas de typeIDs). */
function ColonyPins({
  pins,
  schematics,
}: {
  pins: PlanetPin[];
  schematics: Record<string, PiSchematic>;
}) {
  const extractors = pins.filter((p) => p.extractor != null);
  const factories = pins.filter((p) => p.extractor == null && p.schematic_id != null);
  const storages = pins.filter(
    (p) => p.extractor == null && p.schematic_id == null && p.contents.length > 0,
  );
  return (
    <div className="pi-pins" onClick={(e) => e.stopPropagation()}>
      {extractors.length > 0 && (
        <div className="pi-pin-group small">
          <strong>⛏️ {tr("Extractores")}</strong>
          {extractors.map((p) => {
            const h = hoursUntil(p.expiry_time);
            const ex = p.extractor!;
            const programmed = !!(ex.product_type_id && ex.qty_per_cycle && ex.cycle_time);
            const cls = healthClass(programmed ? h : 0);
            return (
              <div key={p.pin_id} className={`pi-pin ${cls}`}>
                {programmed ? (
                  <>
                    <img src={typeIcon(ex.product_type_id!, 32) ?? undefined} alt="" width={18} height={18} />
                    <span>{fmtSp(Math.round((ex.qty_per_cycle! * 3600) / ex.cycle_time!))}/h</span>
                    <span className={`pi-expiry ${cls}`}>{h != null ? fmtHours(h) : "—"}</span>
                  </>
                ) : (
                  <span className="pi-dead-txt">{tr("sin programa")}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {factories.length > 0 && (
        <div className="pi-pin-group small">
          <strong>🏭 {tr("Fábricas")}</strong>
          {factories.map((p) => {
            const sch = schematics[String(p.schematic_id)];
            return (
              <div key={p.pin_id} className="pi-pin">
                {sch ? (
                  <>
                    <img src={typeIcon(sch.out[0], 32) ?? undefined} alt="" width={18} height={18} />
                    <span>{getLang() === "es" ? sch.n.es : sch.n.en}</span>
                    <span className="muted">
                      {sch.out[1]}/{Math.round(sch.t / 60)}min
                    </span>
                  </>
                ) : (
                  <span className="muted">#{p.schematic_id}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {storages.length > 0 && (
        <div className="pi-pin-group small">
          <strong>📦 {tr("Almacenes y launchpads")}</strong>
          {storages.map((p) => (
            <div key={p.pin_id} className="pi-pin">
              {p.contents.slice(0, 6).map((c) => (
                <span key={c.type_id} className="pi-prod" title={`${c.amount}`}>
                  <img src={typeIcon(c.type_id, 32) ?? undefined} alt="" width={16} height={16} />
                  {fmtSp(c.amount)}
                </span>
              ))}
              {p.contents.length > 6 && <span className="muted">+{p.contents.length - 6}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
