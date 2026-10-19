// Pedidos — fase P2a (SPEC_PEDIDOS.md §4): DE DÓNDE SALE cada material que falta.
//
// Para cada tipo que falta entre todos los pedidos, Koru enseña las vías que tienen números HOY:
//   · 🛒 Comprar — la mejor orden de VENTA de Jita × cantidad (lo que pagarías ahora mismo; la
//     media de New Eden se queda corta en lo de nicho, ver get_hub_sell_prices).
//   · 🎖️ LP — si alguna corporación en la que TÚ tienes LP vende ese tipo en su tienda.
//   · ⚗️ Reaccionar · ⛏️ Minar · 🪐 Planetología — se ofrecen cuando el tipo sale de ahí (por su
//     grupo de mercado o porque hay fórmula), con enlace a la sección; sus números llegan en P2b.
// La decisión es del piloto y se guarda POR TIPO (si el Megacyte lo minas, lo minas para todos los
// pedidos). Koru propone; nunca decide en silencio.

import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { fmtIsk, fmtSp, typeIcon } from "./format";
import type { Tab } from "./constants";
import type { LoyaltyCorp, MiningSeries, Planet, PlanetDetail, PiSchematic } from "./types";
import { loadJson } from "./staticJson";

export type Via = "comprar" | "lp" | "reaccionar" | "minar" | "pi" | "traer";

const VIA: Record<Via, { icon: string; label: string; tab: Tab }> = {
  comprar: { icon: "🛒", label: "Comprar", tab: "comercio_watch" },
  lp: { icon: "🎖️", label: "LP", tab: "lealtad" },
  reaccionar: { icon: "⚗️", label: "Reaccionar", tab: "industria" },
  minar: { icon: "⛏️", label: "Minar", tab: "mineria" },
  pi: { icon: "🪐", label: "Planetología", tab: "planetologia" },
  traer: { icon: "📦", label: "Traer", tab: "inventario" },
};

/** Grupos de MERCADO que salen de minar o cosechar: minerales, materias lunares, productos de
 *  hielo y gases (nubes, fullerenos, booster). Del catálogo del SDE (market_groups.json). */
const GRUPOS_MINAR = new Set([1857, 501, 1033, 1032, 1859, 983]);
/** Los cinco niveles de materiales planetarios (P0…P4). */
const GRUPOS_PI = new Set([1333, 1334, 1335, 1336, 1337]);

/** Mena del catálogo embebido (`get_ore_data`): volumen por unidad, lote de reprocesado y lo que
 *  da cada lote. Los mismos datos que usa la sección de Minería. */
type Mena = { n: string; v: number; p: number; c: number; r: [number, number][] };

/** Rendimiento de reprocesado por defecto: el mismo 85 % que usa Minería para «valor
 *  reprocesado». Depende de tus skills, implantes y la estructura: se puede cambiar. */
const EFF_KEY = "koru_ped_reproc";

/** Estimación de minarlo tú: con qué mena, cuántos m³, y cuántos días a TU ritmo con esa mena. */
type EstMinar = { ore: number; oreName: string; m3: number; dias: number | null; ritmo: number | null };
/** Estimación de sacarlo de tus colonias: ritmo por hora y días. */
type EstPi = { porHora: number; tipo: "extraccion" | "fabrica"; dias: number };

type OfertaLp = {
  offer_id: number;
  type_id: number;
  quantity: number;
  lp_cost: number;
  isk_cost: number;
  required_items: { type_id: number; quantity: number }[];
};
/** La mejor oferta de LP que PUEDES pagar para un tipo (en una corp donde tienes LP). */
type MejorLp = {
  corp: number;
  corpName: string;
  /** LP e ISK para cubrir la cantidad que falta (redondeando a ofertas enteras). */
  lp: number;
  isk: number;
  veces: number;
  tienesLp: number;
  conObjetos: boolean;
};

export function ObtencionBlock({
  missing,
  reacciones,
  nameOf,
  groupOf,
  vols,
  subject,
  onIr,
}: {
  missing: Map<number, number>;
  /** Tipos que salen de una fórmula de reacción (del plan). */
  reacciones: Set<number>;
  nameOf: (t: number) => string;
  groupOf: (t: number) => number | null;
  vols: Map<number, number>;
  subject: number | "global";
  onIr: (t: Tab) => void;
}) {
  const [decis, setDecis] = useState<Map<number, Via>>(new Map());
  const [jita, setJita] = useState<Map<number, number> | null>(null);
  const [lpCorps, setLpCorps] = useState<Map<number, { name: string; lp: number }> | null>(null);
  const [ofertas, setOfertas] = useState<Map<number, OfertaLp[]>>(new Map());
  const [menas, setMenas] = useState<Map<number, Mena> | null>(null);
  const [serie, setSerie] = useState<MiningSeries | null>(null);
  const [pi, setPi] = useState<{ extraccion: Map<number, number>; fabrica: Map<number, number> } | null>(null);
  const [eff, setEff] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(EFF_KEY));
      return v > 0 && v <= 100 ? v : 85;
    } catch {
      return 85;
    }
  });

  // ¿Hay algo que se pueda minar o sacar de PI? Si no, no se carga nada de esto.
  const hayMinar = useMemo(
    () => [...missing.keys()].some((t) => GRUPOS_MINAR.has(groupOf(t) ?? -1)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [missing],
  );
  const hayPi = useMemo(
    () => [...missing.keys()].some((t) => GRUPOS_PI.has(groupOf(t) ?? -1)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [missing],
  );

  useEffect(() => {
    if (!hayMinar || menas) return;
    invoke<Record<string, Mena> | null>("get_ore_data")
      .then((d) => setMenas(new Map(Object.entries(d ?? {}).map(([k, v]) => [Number(k), v]))))
      .catch(() => setMenas(new Map()));
  }, [hayMinar, menas]);

  // Tu minería en m³ por mena y día (el histórico local del mining ledger).
  useEffect(() => {
    if (!hayMinar) return;
    let vivo = true;
    const p =
      subject === "global"
        ? invoke<MiningSeries>("get_mining_series_global", { mode: "m3" })
        : invoke<MiningSeries>("get_mining_series", { characterId: subject, mode: "m3" });
    p.then((s) => vivo && setSerie(s)).catch(() => vivo && setSerie(null));
    return () => {
      vivo = false;
    };
  }, [hayMinar, subject]);

  // Tus colonias: ritmo REAL de los extractores (caducado = 0) y CAPACIDAD de las fábricas — el
  // mismo criterio que Planetología, que distingue producción de capacidad.
  useEffect(() => {
    if (!hayPi) return;
    let vivo = true;
    (async () => {
      const esquemas = await loadJson<Record<string, PiSchematic>>("/pi_schematics.json", {});
      let planetas: Planet[] = [];
      try {
        planetas =
          subject === "global"
            ? await invoke<Planet[]>("get_planets_global")
            : await invoke<Planet[]>("get_planets", { characterId: subject });
      } catch {
        planetas = [];
      }
      const extraccion = new Map<number, number>();
      const fabrica = new Map<number, number>();
      const ahora = Date.now();
      await Promise.all(
        planetas
          .filter((p) => p.planet_id > 0)
          .map(async (p) => {
            try {
              const d = await invoke<PlanetDetail>("get_planet_detail", {
                characterId: p.character_id,
                planetId: p.planet_id,
              });
              for (const pin of d.pins) {
                const ex = pin.extractor;
                if (ex && ex.product_type_id && ex.qty_per_cycle && ex.cycle_time) {
                  const muerto = pin.expiry_time != null && Date.parse(pin.expiry_time) < ahora;
                  if (!muerto) {
                    const h = (ex.qty_per_cycle * 3600) / ex.cycle_time;
                    extraccion.set(ex.product_type_id, (extraccion.get(ex.product_type_id) ?? 0) + h);
                  }
                } else if (pin.schematic_id != null) {
                  const sch = esquemas[String(pin.schematic_id)];
                  if (sch && sch.t > 0) {
                    const [tid, q] = sch.out;
                    fabrica.set(tid, (fabrica.get(tid) ?? 0) + (q * 3600) / sch.t);
                  }
                }
              }
            } catch {
              /* sin permiso o sin red: esa colonia no aporta, y se dice abajo */
            }
          }),
      );
      if (vivo) setPi({ extraccion, fabrica });
    })();
    return () => {
      vivo = false;
    };
  }, [hayPi, subject]);

  /** Tu ritmo con cada mena: m³ por DÍA DE MINERÍA (media de los días en que la minaste). */
  const ritmoMena = useMemo(() => {
    const out = new Map<number, number>();
    if (!serie) return out;
    const suma = new Map<number, number>();
    const dias = new Map<number, Set<string>>();
    for (const d of serie.daily_by_ore) {
      if (d.value <= 0) continue;
      suma.set(d.id, (suma.get(d.id) ?? 0) + d.value);
      if (!dias.has(d.id)) dias.set(d.id, new Set());
      dias.get(d.id)!.add(d.date);
    }
    for (const [id, s] of suma) out.set(id, s / (dias.get(id)?.size || 1));
    return out;
  }, [serie]);

  const estMinar = (tid: number, qty: number): EstMinar | null => {
    if (!menas) return null;
    let mejor: EstMinar | null = null;
    let mejorSinRitmo: EstMinar | null = null;
    for (const [ore, m] of menas) {
      if (!m.p || !m.v) continue;
      const q = m.r.find(([mat]) => mat === tid)?.[1];
      if (!q) continue;
      // unidades de mena para sacar `qty` del material, con el rendimiento elegido
      const porUnidad = (q / m.p) * (eff / 100);
      const m3 = (qty / porUnidad) * m.v;
      const ritmo = ritmoMena.get(ore) ?? null;
      const cand: EstMinar = { ore, oreName: m.n, m3, dias: ritmo ? m3 / ritmo : null, ritmo };
      if (cand.dias != null) {
        if (!mejor || cand.dias < (mejor.dias ?? Infinity)) mejor = cand;
      } else if (!mejorSinRitmo || cand.m3 < mejorSinRitmo.m3) mejorSinRitmo = cand;
    }
    return mejor ?? mejorSinRitmo;
  };

  const estPi = (tid: number, qty: number): EstPi | null => {
    if (!pi) return null;
    const e = pi.extraccion.get(tid);
    if (e && e > 0) return { porHora: e, tipo: "extraccion", dias: qty / e / 24 };
    const f = pi.fabrica.get(tid);
    if (f && f > 0) return { porHora: f, tipo: "fabrica", dias: qty / f / 24 };
    return null;
  };

  useEffect(() => {
    invoke<[number, string][]>("sourcing_list")
      .then((r) => setDecis(new Map(r.map(([t, v]) => [t, v as Via]))))
      .catch(() => setDecis(new Map()));
  }, []);

  // Precios de Jita SOLO de lo que falta. Clave estable: si el plan se recalcula sin cambiar los
  // tipos (un cambio de prioridad), no se vuelve a preguntar.
  const clave = useMemo(() => [...missing.keys()].sort((a, b) => a - b).join(","), [missing]);
  useEffect(() => {
    if (!clave) return;
    let vivo = true;
    setJita(null);
    invoke<Record<number, number>>("get_hub_sell_prices", { ids: clave.split(",").map(Number), regionId: null })
      .then((r) => vivo && setJita(new Map(Object.entries(r).map(([k, v]) => [Number(k), v]))))
      .catch(() => vivo && setJita(new Map()));
    return () => {
      vivo = false;
    };
  }, [clave]);

  // Tus LP por corporación (el máximo de un mismo personaje: los LP no se suman entre personajes,
  // cada uno gasta los suyos). En Global, todos tus personajes.
  useEffect(() => {
    let vivo = true;
    setLpCorps(null);
    (async () => {
      let ids: number[] = [];
      if (subject === "global") {
        try {
          const cs = await invoke<{ character_id: number }[]>("list_characters");
          ids = cs.map((c) => c.character_id);
        } catch {
          ids = [];
        }
      } else ids = [subject];
      const porCorp = new Map<number, { name: string; lp: number }>();
      for (const id of ids) {
        try {
          const lp = await invoke<LoyaltyCorp[]>("get_loyalty", { characterId: id });
          for (const c of lp) {
            if (c.loyalty_points <= 0) continue;
            const cur = porCorp.get(c.corporation_id);
            if (!cur || c.loyalty_points > cur.lp)
              porCorp.set(c.corporation_id, { name: c.corporation_name ?? `#${c.corporation_id}`, lp: c.loyalty_points });
          }
        } catch {
          /* personaje sin el permiso de lealtad: simplemente no aporta tiendas */
        }
      }
      if (!vivo) return;
      setLpCorps(porCorp);
      const tiendas = new Map<number, OfertaLp[]>();
      await Promise.all(
        [...porCorp.keys()].map((corp) =>
          invoke<OfertaLp[]>("get_loyalty_offers", { corporationId: corp })
            .then((o) => tiendas.set(corp, o))
            .catch(() => undefined),
        ),
      );
      if (vivo) setOfertas(tiendas);
    })();
    return () => {
      vivo = false;
    };
  }, [subject]);

  const mejorLp = useMemo(() => {
    const out = new Map<number, MejorLp>();
    if (!lpCorps) return out;
    for (const [tid, falta] of missing) {
      let mejor: MejorLp | null = null;
      for (const [corp, lista] of ofertas) {
        for (const o of lista) {
          if (o.type_id !== tid || o.quantity <= 0) continue;
          const veces = Math.ceil(falta / o.quantity);
          const cand: MejorLp = {
            corp,
            corpName: lpCorps.get(corp)?.name ?? `#${corp}`,
            lp: o.lp_cost * veces,
            isk: o.isk_cost * veces,
            veces,
            tienesLp: lpCorps.get(corp)?.lp ?? 0,
            conObjetos: o.required_items.length > 0,
          };
          if (!mejor || cand.lp < mejor.lp) mejor = cand;
        }
      }
      if (mejor) out.set(tid, mejor);
    }
    return out;
  }, [missing, ofertas, lpCorps]);

  /** Las vías que tienen sentido para un tipo. Comprar, siempre. */
  const viasDe = (tid: number): Via[] => {
    const v: Via[] = ["comprar"];
    if (mejorLp.has(tid)) v.push("lp");
    if (reacciones.has(tid)) v.push("reaccionar");
    const g = groupOf(tid);
    if (g != null && GRUPOS_MINAR.has(g)) v.push("minar");
    if (g != null && GRUPOS_PI.has(g)) v.push("pi");
    return v;
  };

  async function decidir(tid: number, via: Via | "") {
    const n = new Map(decis);
    if (via) n.set(tid, via);
    else n.delete(tid);
    setDecis(n);
    try {
      await invoke("sourcing_set", { typeId: tid, via });
    } catch (e) {
      console.error("sourcing_set", e);
    }
  }

  const filas = [...missing].sort(
    (a, b) => (jita?.get(b[0]) ?? 0) * b[1] - (jita?.get(a[0]) ?? 0) * a[1],
  );

  // Resumen por vía. Lo que no tiene decisión cuenta como «sin decidir», no como comprar: el
  // total de compra tiene que ser lo que TÚ has decidido comprar.
  const resumen = useMemo(() => {
    const r = { comprarIsk: 0, comprarM3: 0, comprarN: 0, sinPrecio: 0, lp: new Map<string, { lp: number; isk: number }>(), cuenta: new Map<Via | "", number>(), todoIsk: 0 };
    for (const [tid, q] of missing) {
      const v = decis.get(tid) ?? "";
      r.cuenta.set(v, (r.cuenta.get(v) ?? 0) + 1);
      const p = jita?.get(tid);
      if (p != null) r.todoIsk += p * q;
      if (v === "comprar") {
        r.comprarN++;
        if (p == null) r.sinPrecio++;
        else r.comprarIsk += p * q;
        r.comprarM3 += (vols.get(tid) ?? 0) * q;
      } else if (v === "lp") {
        const m = mejorLp.get(tid);
        if (m) {
          const cur = r.lp.get(m.corpName) ?? { lp: 0, isk: 0 };
          cur.lp += m.lp;
          cur.isk += m.isk;
          r.lp.set(m.corpName, cur);
        }
      }
    }
    return r;
  }, [missing, decis, jita, vols, mejorLp]);

  if (missing.size === 0) return null;
  const sinDecidir = resumen.cuenta.get("") ?? 0;

  return (
    <>
      <h4>🧭 {tr("Lo que falta, entre todos los pedidos — y de dónde sacarlo")}</h4>
      <p className="muted small">
        {tr("Koru propone las vías con sus números y tú decides. La decisión vale para ese material en todos los pedidos y se recuerda.")}{" "}
        {jita == null && tr("Consultando precios de Jita…")}
      </p>
      {hayMinar && (
        <p className="small muted">
          ⛏️ {tr("Rendimiento de reprocesado")}{" "}
          <input
            type="number"
            min={50}
            max={100}
            value={eff}
            style={{ width: "4rem" }}
            onChange={(e) => {
              const v = Math.min(100, Math.max(1, Number(e.target.value) || 85));
              setEff(v);
              try {
                localStorage.setItem(EFF_KEY, String(v));
              } catch {
                /* preferencia: si no se puede guardar, no pasa nada */
              }
            }}
          />{" "}
          % · {tr("depende de tus skills, implantes y la estructura donde reprocesas")}
        </p>
      )}
      <div className="ped-resumen small">
        <span>
          {tr("Si lo compras todo en Jita")}: <strong>{fmtIsk(resumen.todoIsk)}</strong>
        </span>
        {resumen.comprarN > 0 && (
          <span>
            🛒 {tr("Decidido comprar")}: <strong>{fmtIsk(resumen.comprarIsk)}</strong> · {fmtSp(resumen.comprarN)} {tr("tipos")} · {fmtSp(Math.round(resumen.comprarM3))} m³
            {resumen.sinPrecio > 0 && ` · ${resumen.sinPrecio} ${tr("sin precio")}`}
          </span>
        )}
        {[...resumen.lp].map(([corp, v]) => (
          <span key={corp}>
            🎖️ {corp}: <strong>{fmtSp(v.lp)} LP</strong> + {fmtIsk(v.isk)}
          </span>
        ))}
        {(["minar", "pi", "reaccionar"] as Via[]).map((v) =>
          resumen.cuenta.get(v) ? (
            <span key={v}>
              {VIA[v].icon} {tr(VIA[v].label)}: {resumen.cuenta.get(v)} {tr("tipos")}
            </span>
          ) : null,
        )}
        {sinDecidir > 0 && (
          <span className="ped-aviso">
            ❓ {tr("Sin decidir")}: {sinDecidir} {tr("tipos")}
          </span>
        )}
      </div>
      <table className="km-table cat-table">
        <thead>
          <tr>
            <th>{tr("Material")}</th>
            <th className="num">{tr("Cantidad")}</th>
            <th className="num">m³</th>
            <th className="num">🛒 {tr("Jita (venta)")}</th>
            <th>🎖️ {tr("Por LP")}</th>
            <th>{tr("Producirlo tú")}</th>
            <th>{tr("De dónde")}</th>
          </tr>
        </thead>
        <tbody>
          {filas.map(([tid, q]) => {
            const p = jita?.get(tid);
            const lp = mejorLp.get(tid);
            const vias = viasDe(tid);
            const dec = decis.get(tid) ?? "";
            return (
              <tr key={tid}>
                <td>
                  <img className="kind-glyph" src={typeIcon(tid, 32)} alt="" /> {nameOf(tid)}
                </td>
                <td className="num">{fmtSp(q)}</td>
                <td className="num">{vols.has(tid) ? fmtSp(Math.round((vols.get(tid) ?? 0) * q)) : "—"}</td>
                <td className="num">{jita == null ? "…" : p != null ? fmtIsk(p * q) : "—"}</td>
                <td className="small">
                  {lp ? (
                    <span title={`${lp.veces} × ${tr("oferta")}${lp.conObjetos ? ` · ${tr("pide además objetos")}` : ""}`}>
                      {fmtSp(lp.lp)} LP + {fmtIsk(lp.isk)} · {lp.corpName}{" "}
                      <span className={lp.tienesLp >= lp.lp ? "ped-si" : "ped-aviso"}>
                        ({tr("tienes")} {fmtSp(lp.tienesLp)})
                      </span>
                      {lp.conObjetos && " ⚠"}
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="small">
                  <Producirlo
                    tid={tid}
                    q={q}
                    minar={GRUPOS_MINAR.has(groupOf(tid) ?? -1)}
                    piOk={GRUPOS_PI.has(groupOf(tid) ?? -1)}
                    estMinar={estMinar}
                    estPi={estPi}
                    cargandoMinar={menas == null || serie == null}
                    cargandoPi={pi == null}
                  />
                </td>
                <td className="ped-via">
                  <select
                    className={`small${dec ? "" : " ped-sin"}`}
                    value={dec}
                    onChange={(e) => decidir(tid, e.target.value as Via | "")}
                  >
                    <option value="">{tr("— sin decidir —")}</option>
                    {vias.map((v) => (
                      <option key={v} value={v}>
                        {VIA[v].icon} {tr(VIA[v].label)}
                      </option>
                    ))}
                  </select>
                  {dec && (
                    <button
                      className="linklike small"
                      title={tr("Abrir la sección que lo resuelve")}
                      onClick={() => onIr(VIA[dec].tab)}
                    >
                      ↗
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">
        {tr("«Producirlo tú»: ⛏️ la mena que antes te lo da A TU RITMO (la media de m³ de los días que minaste esa mena, del registro de minería) y cuántos días de minería serían; una mena da varios minerales a la vez y aquí cada uno se cuenta por separado. 🪐 lo que producen hoy tus colonias: extractores activos (ritmo real) o fábricas (capacidad, que solo se cumple si les llega el material). «⚠» en LP = la oferta pide además objetos.")}
      </p>
    </>
  );
}

/** La celda «Producirlo tú»: minería y PI con números, o un guion si no aplica. */
function Producirlo({
  tid,
  q,
  minar,
  piOk,
  estMinar,
  estPi,
  cargandoMinar,
  cargandoPi,
}: {
  tid: number;
  q: number;
  minar: boolean;
  piOk: boolean;
  estMinar: (t: number, q: number) => EstMinar | null;
  estPi: (t: number, q: number) => EstPi | null;
  cargandoMinar: boolean;
  cargandoPi: boolean;
}) {
  if (minar) {
    if (cargandoMinar) return <span className="muted">⛏️ …</span>;
    const e = estMinar(tid, q);
    if (!e) return <span className="muted">⛏️ {tr("ninguna mena lo da")}</span>;
    return (
      <span
        title={
          e.ritmo != null
            ? `${tr("Tu ritmo con")} ${e.oreName}: ${fmtSp(Math.round(e.ritmo))} m³ ${tr("por día de minería")}`
            : tr("No hay minería tuya de esa mena: no se puede estimar el tiempo")
        }
      >
        ⛏️ ~{fmtSp(Math.round(e.m3))} m³ {e.oreName}
        {e.dias != null ? (
          <> · <strong>~{e.dias < 1 ? "<1" : fmtSp(Math.ceil(e.dias))} {tr("d")}</strong></>
        ) : (
          <span className="muted"> · {tr("sin ritmo tuyo")}</span>
        )}
      </span>
    );
  }
  if (piOk) {
    if (cargandoPi) return <span className="muted">🪐 …</span>;
    const e = estPi(tid, q);
    if (!e) return <span className="muted">🪐 {tr("ninguna colonia tuya lo produce")}</span>;
    return (
      <span title={e.tipo === "fabrica" ? tr("Capacidad de tus fábricas: solo se cumple si les llega el material") : tr("Ritmo real de tus extractores activos")}>
        🪐 {fmtSp(Math.round(e.porHora))}/h{e.tipo === "fabrica" ? "*" : ""} · <strong>~{e.dias < 1 ? "<1" : fmtSp(Math.ceil(e.dias))} {tr("d")}</strong>
      </span>
    );
  }
  return <span className="muted">—</span>;
}
