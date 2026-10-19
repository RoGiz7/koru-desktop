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
import type { LoyaltyCorp } from "./types";

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
        {tr("Minar, planetología y reacciones ya se pueden elegir y te llevan a su sección; cuánto tardarías con tu ritmo real y tus colonias llega en la siguiente fase. «⚠» en LP = la oferta pide además objetos.")}
      </p>
    </>
  );
}
