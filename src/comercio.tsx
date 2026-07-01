// Sección Comercio (trading): órdenes con competencia, P&L realizado, watchlist de mercado
// (spread/libro/histórico), arbitraje entre hubs y buscador de oportunidades (Nivel 4).
// Extraído de App.tsx para adelgazar el monolito; todo ESI público o datos propios.
import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr, getLang } from "./i18n";
import { fmtIsk, fmtSp, daysAgo, weekKey } from "./format";
import { TypeIcon, Kpi, MultiLineProgress, RangePresets, Th } from "./charts";
import type { MarketOrder, WatchItem, ArbItem, OppItem, MGroup, TradePnl } from "./types";

// Botón reutilizable "➕ a watchlist": añade un typeID a la watchlist de mercado (optimista).
export function WatchAddBtn({ typeId }: { typeId: number }) {
  const [added, setAdded] = useState(false);
  return (
    <button
      className="watch-add-btn"
      title={added ? tr("Añadido a la watchlist") : tr("Añadir a la watchlist")}
      disabled={added}
      onClick={(e) => {
        e.stopPropagation();
        invoke("watch_add", { typeId })
          .then(() => setAdded(true))
          .catch(() => {});
      }}
    >
      {added ? "✓" : "➕"}
    </button>
  );
}

// Regiones comerciales principales (hub entre paréntesis). El backend mapea región→estación hub.
const TRADE_REGIONS: { id: number; label: string }[] = [
  { id: 10000002, label: "Jita (The Forge)" },
  { id: 10000043, label: "Amarr (Domain)" },
  { id: 10000032, label: "Dodixie (Sinq Laison)" },
  { id: 10000030, label: "Rens (Heimatar)" },
  { id: 10000042, label: "Hek (Metropolis)" },
];
type MType = { i: number; n: string; g: number };

// Watchlist de mercado: vigila ítems y ve su spread en el hub + tendencia de precio.
function WatchlistPanel() {
  const [region, setRegion] = useState<number>(() => {
    const v = Number(localStorage.getItem("koru-trade-region"));
    return TRADE_REGIONS.some((r) => r.id === v) ? v : 10000002;
  });
  const [items, setItems] = useState<WatchItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [mtypes, setMtypes] = useState<MType[] | null>(null);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState<"market" | "arb" | "opp">("market");
  const [arb, setArb] = useState<ArbItem[] | null>(null);
  const [arbBusy, setArbBusy] = useState(false);

  // --- Buscador de oportunidades (Nivel 4) ---
  const [mgroups, setMgroups] = useState<MGroup[] | null>(null);
  const [oppGroup, setOppGroup] = useState<number | null>(null);
  const [oppGroupQ, setOppGroupQ] = useState("");
  const [oppMinVol, setOppMinVol] = useState<number>(() => {
    const v = Number(localStorage.getItem("koru-opp-minvol"));
    return v > 0 ? v : 50;
  });
  const [opp, setOpp] = useState<OppItem[] | null>(null);
  const [oppBusy, setOppBusy] = useState(false);

  const loadArb = () => {
    setArbBusy(true);
    invoke<ArbItem[]>("get_arbitrage")
      .then(setArb)
      .catch(() => setArb([]))
      .finally(() => setArbBusy(false));
  };
  useEffect(() => {
    if (mode === "arb" && arb === null && !arbBusy) loadArb();
    if (mode === "opp") {
      ensureTypes();
      ensureMGroups();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Catálogo de grupos de mercado (SDE), perezoso al entrar en Oportunidades.
  const ensureMGroups = () => {
    if (mgroups) return;
    fetch("/market_groups.json")
      .then((r) => r.json())
      .then(setMgroups)
      .catch(() => setMgroups([]));
  };
  // Índice padre→hijos para resolver el subárbol de un grupo.
  const gChildren = useMemo(() => {
    const m = new Map<number, number[]>();
    for (const g of mgroups ?? []) {
      if (g.p != null) {
        const a = m.get(g.p) ?? [];
        a.push(g.i);
        m.set(g.p, a);
      }
    }
    return m;
  }, [mgroups]);
  // Todos los ids de grupo del subárbol (el grupo + descendientes).
  const collectGroupIds = (root: number): Set<number> => {
    const out = new Set<number>();
    const stack = [root];
    while (stack.length) {
      const g = stack.pop()!;
      if (out.has(g)) continue;
      out.add(g);
      for (const c of gChildren.get(g) ?? []) stack.push(c);
    }
    return out;
  };
  // typeIDs vigilables del subárbol de un grupo (usa el catálogo de tipos ya cargado).
  const typeIdsForGroup = (root: number): number[] => {
    if (!mtypes) return [];
    const gids = collectGroupIds(root);
    return mtypes.filter((t) => gids.has(t.g)).map((t) => t.i);
  };
  const gLang = getLang();
  const gName = (g: MGroup) => (gLang === "en" ? g.n : g.ne);
  const gql = oppGroupQ.trim().toLowerCase();
  const gMatches =
    gql.length >= 2 && mgroups
      ? mgroups
          .filter((g) => gName(g).toLowerCase().includes(gql))
          .slice(0, 40)
      : [];
  const oppGroupObj = mgroups?.find((g) => g.i === oppGroup) ?? null;
  const oppTypeCount = oppGroup != null ? typeIdsForGroup(oppGroup).length : 0;

  const runScan = () => {
    if (oppGroup == null || !mtypes) return;
    const tids = typeIdsForGroup(oppGroup);
    if (tids.length === 0) {
      setOpp([]);
      return;
    }
    setOppBusy(true);
    setOpp(null);
    localStorage.setItem("koru-opp-minvol", String(oppMinVol));
    invoke<OppItem[]>("scan_opportunities", {
      regionId: region,
      typeIds: tids,
      minVolume: oppMinVol,
      topBooks: 25,
    })
      .then(setOpp)
      .catch(() => setOpp([]))
      .finally(() => setOppBusy(false));
  };

  const load = () => {
    setBusy(true);
    invoke<WatchItem[]>("get_watchlist", { regionId: region })
      .then((v) => setItems(v))
      .catch(() => setItems([]))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    load();
    localStorage.setItem("koru-trade-region", String(region));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region]);

  // El catálogo de tipos (1 MB) se carga perezosamente al empezar a buscar.
  const ensureTypes = () => {
    if (mtypes) return;
    fetch("/market_types.json")
      .then((r) => r.json())
      .then(setMtypes)
      .catch(() => setMtypes([]));
  };
  const ql = q.trim().toLowerCase();
  const watched = new Set((items ?? []).map((i) => i.type_id));
  const matches =
    ql.length >= 2 && mtypes
      ? mtypes.filter((t) => t.n.toLowerCase().includes(ql)).slice(0, 25)
      : [];

  const add = (tid: number) => {
    setAdding(true);
    setQ("");
    invoke("watch_add", { typeId: tid })
      .then(() => load())
      .finally(() => setAdding(false));
  };
  const remove = (tid: number) => {
    invoke("watch_remove", { typeId: tid }).then(() => {
      if (sel === tid) setSel(null);
      load();
    });
  };

  const selItem = items?.find((i) => i.type_id === sel) ?? null;
  const hLabels = (selItem?.history ?? []).map((h) => h.date.slice(5));
  const hSeries = selItem
    ? [{ name: tr("Precio medio"), color: "#58a6ff", values: selItem.history.map((h) => h.average) }]
    : [];

  const arbList = arb ?? [];

  return (
    <>
      <div className="seg seg-sm" style={{ marginBottom: "0.6rem" }}>
        <button className={mode === "market" ? "active" : ""} onClick={() => setMode("market")}>
          {tr("Mercado")}
        </button>
        <button className={mode === "arb" ? "active" : ""} onClick={() => setMode("arb")}>
          {tr("Arbitraje entre hubs")}
        </button>
        <button className={mode === "opp" ? "active" : ""} onClick={() => setMode("opp")}>
          {tr("Oportunidades")}
        </button>
      </div>

      {mode === "opp" ? (
        <>
          <div className="watch-controls">
            <label className="watch-region">
              <span className="muted small">{tr("Región")}</span>
              <select value={region} onChange={(e) => setRegion(Number(e.target.value))}>
                {TRADE_REGIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="watch-search">
              <input
                value={oppGroupQ}
                onFocus={() => {
                  ensureTypes();
                  ensureMGroups();
                }}
                onChange={(e) => setOppGroupQ(e.target.value)}
                placeholder={tr("Buscar grupo de mercado… (p. ej. Frigates)")}
              />
              {gql.length >= 2 && (
                <div className="watch-ac">
                  {!mgroups ? (
                    <div className="muted small watch-ac-msg">{tr("Cargando catálogo…")}</div>
                  ) : gMatches.length === 0 ? (
                    <div className="muted small watch-ac-msg">{tr("Sin coincidencias")}</div>
                  ) : (
                    gMatches.map((g) => {
                      const cnt = typeIdsForGroup(g.i).length;
                      return (
                        <button
                          key={g.i}
                          disabled={cnt === 0}
                          onClick={() => {
                            setOppGroup(g.i);
                            setOppGroupQ("");
                            setOpp(null);
                          }}
                        >
                          <span>{gName(g)}</span>
                          <span className="muted small"> · {fmtSp(cnt)} {tr("ítems")}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
            <label className="watch-region">
              <span className="muted small">{tr("Vol/día mín.")}</span>
              <input
                type="number"
                min={0}
                value={oppMinVol}
                style={{ width: "5rem" }}
                onChange={(e) => setOppMinVol(Math.max(0, Number(e.target.value)))}
              />
            </label>
          </div>

          <div className="watch-controls" style={{ alignItems: "center" }}>
            <span className="muted small" style={{ flex: 1 }}>
              {oppGroupObj
                ? `${gName(oppGroupObj)} · ${fmtSp(oppTypeCount)} ${tr("ítems en el grupo")}`
                : tr("Elige un grupo de mercado y escanea las mejores oportunidades del hub.")}
            </span>
            <button onClick={runScan} disabled={oppBusy || oppGroup == null || oppTypeCount === 0}>
              {oppBusy ? tr("Escaneando…") : tr("Escanear")}
            </button>
          </div>

          {!opp ? (
            <p className="muted">
              {oppBusy
                ? tr("Analizando liquidez y libros del hub… (puede tardar)")
                : tr("Sin datos. Elige un grupo y pulsa Escanear.")}
            </p>
          ) : opp.length === 0 ? (
            <p className="muted small">
              {tr("Ninguna oportunidad con esa liquidez mínima. Baja el volumen mínimo o prueba otro grupo.")}
            </p>
          ) : (
            <>
              <table className="km-table">
                <thead>
                  <tr>
                    <th>{tr("Item")}</th>
                    <th style={{ textAlign: "right" }}>{tr("Compra")}</th>
                    <th style={{ textAlign: "right" }}>{tr("Venta")}</th>
                    <th style={{ textAlign: "right" }}>{tr("Spread")}</th>
                    <th style={{ textAlign: "right" }}>{tr("Margen")}</th>
                    <th style={{ textAlign: "right" }}>{tr("Vol/día")}</th>
                    <th style={{ textAlign: "right" }}>{tr("Potencial/día")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {opp.map((o) => (
                    <tr key={o.type_id}>
                      <td className="ship-cell">
                        <TypeIcon typeId={o.type_id} />
                        <span>{o.name ?? `#${o.type_id}`}</span>
                      </td>
                      <td style={{ textAlign: "right", color: "#3fb950" }}>
                        {o.best_buy > 0 ? fmtIsk(o.best_buy) : "—"}
                      </td>
                      <td style={{ textAlign: "right", color: "#e5534b" }}>
                        {o.best_sell > 0 ? fmtIsk(o.best_sell) : "—"}
                      </td>
                      <td style={{ textAlign: "right" }}>{o.spread > 0 ? fmtIsk(o.spread) : "—"}</td>
                      <td
                        style={{
                          textAlign: "right",
                          color: o.margin >= 0.2 ? "#3fb950" : o.margin >= 0.05 ? "#d29922" : "inherit",
                        }}
                      >
                        {o.margin > 0 ? `${(o.margin * 100).toFixed(1)}%` : "—"}
                      </td>
                      <td style={{ textAlign: "right" }}>{fmtSp(o.avg_volume)}</td>
                      <td style={{ textAlign: "right", color: "#3fb950" }}>
                        {o.daily_potential > 0 ? fmtIsk(o.daily_potential) : "—"}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <WatchAddBtn typeId={o.type_id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small">
                {tr("Escaneo en dos fases: liquidez del histórico (vol/día) y luego spread real del libro del hub para los más líquidos. Potencial/día = spread × volumen diario (bruto, antes de impuestos y comisiones). Añade con ➕ a la watchlist para ver su libro completo.")}
              </p>
            </>
          )}
        </>
      ) : mode === "arb" ? (
        <>
          <div className="watch-controls">
            <span className="muted small" style={{ flex: 1 }}>
              {tr("Mejor ruta de compra→venta entre Jita, Amarr, Dodixie, Rens y Hek para cada ítem vigilado.")}
            </span>
            <button onClick={loadArb} disabled={arbBusy}>
              {arbBusy ? tr("Calculando…") : tr("Recalcular")}
            </button>
          </div>
          {!arb ? (
            <p className="muted">{arbBusy ? tr("Analizando los 5 hubs… (puede tardar)") : tr("Sin datos.")}</p>
          ) : arbList.length === 0 ? (
            <p className="muted small">
              {(items && items.length === 0)
                ? tr("Tu watchlist está vacía. Añade ítems en la pestaña Mercado.")
                : tr("No hay rutas rentables entre hubs para tus ítems vigilados ahora mismo.")}
            </p>
          ) : (
            <>
              <table className="km-table">
                <thead>
                  <tr>
                    <th>{tr("Item")}</th>
                    <th>{tr("Comprar en")}</th>
                    <th style={{ textAlign: "right" }}>{tr("Precio compra")}</th>
                    <th>{tr("Vender en")}</th>
                    <th style={{ textAlign: "right" }}>{tr("Precio venta")}</th>
                    <th style={{ textAlign: "right" }}>{tr("Beneficio/ud")}</th>
                    <th style={{ textAlign: "right" }}>{tr("Margen")}</th>
                    <th style={{ textAlign: "right" }}>{tr("Vol/día dest.")}</th>
                  </tr>
                </thead>
                <tbody>
                  {arbList.map((a) => (
                    <tr key={a.type_id}>
                      <td className="ship-cell">
                        <TypeIcon typeId={a.type_id} />
                        <span>{a.name ?? `#${a.type_id}`}</span>
                      </td>
                      <td>{a.buy_hub}</td>
                      <td style={{ textAlign: "right", color: "#3fb950" }}>{fmtIsk(a.buy_price)}</td>
                      <td>{a.sell_hub}</td>
                      <td style={{ textAlign: "right", color: "#e5534b" }}>{fmtIsk(a.sell_price)}</td>
                      <td style={{ textAlign: "right", color: "#3fb950" }}>{fmtIsk(a.profit)}</td>
                      <td
                        style={{
                          textAlign: "right",
                          color: a.margin >= 0.2 ? "#3fb950" : a.margin >= 0.05 ? "#d29922" : "inherit",
                        }}
                      >
                        {(a.margin * 100).toFixed(1)}%
                      </td>
                      <td style={{ textAlign: "right" }}>{fmtSp(a.dest_volume)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small">
                {tr("Comprar al mejor precio de venta en el hub origen, llevar y vender al mejor precio de compra en el destino. Beneficio antes de impuestos, comisiones y transporte. El volumen del destino indica si podrás colocarlo.")}
              </p>
            </>
          )}
        </>
      ) : (
      <>
      <div className="watch-controls">
        <label className="watch-region">
          <span className="muted small">{tr("Región")}</span>
          <select value={region} onChange={(e) => setRegion(Number(e.target.value))}>
            {TRADE_REGIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <div className="watch-search">
          <input
            value={q}
            onFocus={ensureTypes}
            onChange={(e) => {
              ensureTypes();
              setQ(e.target.value);
            }}
            placeholder={tr("Buscar ítem para añadir…")}
          />
          {ql.length >= 2 && (
            <div className="watch-ac">
              {!mtypes ? (
                <div className="muted small watch-ac-msg">{tr("Cargando catálogo…")}</div>
              ) : matches.length === 0 ? (
                <div className="muted small watch-ac-msg">{tr("Sin coincidencias")}</div>
              ) : (
                matches.map((m) => (
                  <button
                    key={m.i}
                    disabled={watched.has(m.i) || adding}
                    onClick={() => add(m.i)}
                  >
                    <TypeIcon typeId={m.i} />
                    <span>{m.n}</span>
                    {watched.has(m.i) && <span className="muted small"> · {tr("ya vigilado")}</span>}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {!items ? (
        <p className="muted">{busy ? tr("Cargando mercado…") : tr("Sin datos.")}</p>
      ) : items.length === 0 ? (
        <p className="muted small">
          {tr("Tu watchlist está vacía. Busca ítems arriba para vigilar su precio, spread y volumen.")}
        </p>
      ) : (
        <>
          <table className="km-table">
            <thead>
              <tr>
                <th>{tr("Item")}</th>
                <th style={{ textAlign: "right" }}>{tr("Compra")}</th>
                <th style={{ textAlign: "right" }}>{tr("Venta")}</th>
                <th style={{ textAlign: "right" }}>{tr("Spread")}</th>
                <th style={{ textAlign: "right" }}>{tr("Margen")}</th>
                <th style={{ textAlign: "right" }}>{tr("Vol/día")}</th>
                <th style={{ textAlign: "right" }}>{tr("Vol medio")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr
                  key={it.type_id}
                  className={sel === it.type_id ? "watch-row sel" : "watch-row"}
                  onClick={() => setSel(sel === it.type_id ? null : it.type_id)}
                >
                  <td className="ship-cell">
                    <TypeIcon typeId={it.type_id} />
                    <span>{it.name ?? `#${it.type_id}`}</span>
                  </td>
                  <td style={{ textAlign: "right", color: "#3fb950" }}>
                    {it.best_buy > 0 ? fmtIsk(it.best_buy) : "—"}
                  </td>
                  <td style={{ textAlign: "right", color: "#e5534b" }}>
                    {it.best_sell > 0 ? fmtIsk(it.best_sell) : "—"}
                  </td>
                  <td style={{ textAlign: "right" }}>{it.spread > 0 ? fmtIsk(it.spread) : "—"}</td>
                  <td
                    style={{
                      textAlign: "right",
                      color: it.margin >= 0.1 ? "#3fb950" : it.margin > 0 ? "#d29922" : "inherit",
                    }}
                  >
                    {it.margin > 0 ? `${(it.margin * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td style={{ textAlign: "right" }}>{fmtSp(it.day_volume)}</td>
                  <td style={{ textAlign: "right" }}>{fmtSp(it.avg_volume)}</td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="watch-rm"
                      title={tr("Quitar de la watchlist")}
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(it.type_id);
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {selItem && (
            <div className="watch-detail">
              <div className="rateo-charthead">
                <span className="muted small">
                  {tr("Libro (hub)")} · {selItem.name ?? `#${selItem.type_id}`}
                </span>
              </div>
              {selItem.buy_levels.length === 0 && selItem.sell_levels.length === 0 ? (
                <p className="muted small">{tr("Sin órdenes en el hub para este ítem.")}</p>
              ) : (
                (() => {
                  const maxCum = Math.max(
                    1,
                    ...selItem.buy_levels.map((l) => l.cum),
                    ...selItem.sell_levels.map((l) => l.cum),
                  );
                  const pct = (c: number) => `${(c / maxCum) * 100}%`;
                  return (
                    <div className="watch-book">
                      <div className="book-side book-buy">
                        <div className="book-caption muted small">{tr("Compradores")}</div>
                        {selItem.buy_levels.map((l) => (
                          <div className="book-row" key={`b${l.price}`} title={`${l.orders} ${tr("órdenes")} · ${tr("acum.")} ${fmtSp(l.cum)}`}>
                            <div className="book-bar" style={{ width: pct(l.cum) }} />
                            <span className="book-vol">{fmtSp(l.volume)}</span>
                            <span className="book-price">{fmtIsk(l.price)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="book-mid">
                        <span className="muted small">{tr("Spread")}</span>
                        <strong>{selItem.spread > 0 ? fmtIsk(selItem.spread) : "—"}</strong>
                        <span className="muted small">
                          {selItem.margin > 0 ? `${(selItem.margin * 100).toFixed(1)}%` : ""}
                        </span>
                      </div>
                      <div className="book-side book-sell">
                        <div className="book-caption muted small">{tr("Vendedores")}</div>
                        {selItem.sell_levels.map((l) => (
                          <div className="book-row" key={`s${l.price}`} title={`${l.orders} ${tr("órdenes")} · ${tr("acum.")} ${fmtSp(l.cum)}`}>
                            <div className="book-bar" style={{ width: pct(l.cum) }} />
                            <span className="book-price">{fmtIsk(l.price)}</span>
                            <span className="book-vol">{fmtSp(l.volume)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()
              )}
              <div className="rateo-charthead" style={{ marginTop: "0.6rem" }}>
                <span className="muted small">
                  {tr("Precio medio")} ·{" "}
                  {tr("últimos")} {selItem.history.length} {tr("días")}
                </span>
              </div>
              {selItem.history.length === 0 ? (
                <p className="muted small">{tr("Sin histórico para este ítem en esta región.")}</p>
              ) : (
                <MultiLineProgress labels={hLabels} series={hSeries} fmt={fmtIsk} />
              )}
            </div>
          )}
          <p className="muted small">
            {tr("Compra/venta = mejor precio en el hub de la región. Spread = venta − compra. Margen = spread ÷ venta (antes de impuestos). Volumen del histórico de mercado de la región.")}
          </p>
        </>
      )}
      </>
      )}
    </>
  );
}

export function ComercioView({
  orders,
  busy,
  subject,
}: {
  orders: MarketOrder[] | null;
  busy: boolean;
  subject: number | "global";
}) {
  const [view, setView] = useState<"orders" | "pnl" | "watch">("orders");
  const [pnl, setPnl] = useState<TradePnl | null>(null);
  const [pnlBusy, setPnlBusy] = useState(false);
  const [pGran, setPGran] = useState<"day" | "week" | "month">("month");
  const [pFrom, setPFrom] = useState(daysAgo(90));
  const [pTo, setPTo] = useState("");
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 }>({ col: "issued", dir: -1 });
  const onSort = (col: string) =>
    setSort((s) => (s.col === col ? { col, dir: s.dir === 1 ? -1 : 1 } : { col, dir: 1 }));
  useEffect(() => {
    if (view !== "pnl") return;
    setPnlBusy(true);
    setPnl(null);
    const p =
      subject === "global"
        ? invoke<TradePnl>("get_trading_pnl_global")
        : invoke<TradePnl>("get_trading_pnl", { characterId: subject });
    p.then(setPnl)
      .catch(() => setPnl(null))
      .finally(() => setPnlBusy(false));
  }, [view, subject]);

  const daysLeft = (o: MarketOrder) =>
    o.issued
      ? Math.ceil((new Date(o.issued).getTime() + o.duration * 86400000 - Date.now()) / 86400000)
      : null;
  const list = orders ?? [];
  const sorted = [...list].sort((a, b) => {
    const d = sort.dir;
    switch (sort.col) {
      case "item":
        return (a.type_name ?? "").localeCompare(b.type_name ?? "") * d;
      case "type":
        return ((a.is_buy ? 1 : 0) - (b.is_buy ? 1 : 0)) * d;
      case "price":
        return (a.price - b.price) * d;
      case "qty":
        return (a.volume_remain - b.volume_remain) * d;
      case "sys":
        return (a.system_name ?? "").localeCompare(b.system_name ?? "") * d;
      default:
        return (a.issued ?? "").localeCompare(b.issued ?? "") * d;
    }
  });
  const buys = list.filter((o) => o.is_buy).length;
  const buyValue = list.filter((o) => o.is_buy).reduce((s, o) => s + o.price * o.volume_remain, 0);
  const sellValue = list.filter((o) => !o.is_buy).reduce((s, o) => s + o.price * o.volume_remain, 0);
  const undercut = list.filter((o) => !o.is_best).length; // órdenes que hay que repricear

  // Serie de beneficio realizado por día (fecha de venta), bucketizada por granularidad + rango.
  const pDaily = (pnl?.daily ?? []).filter((d) => (!pFrom || d.date >= pFrom) && (!pTo || d.date <= pTo));
  const pBucket = new Map<string, number>();
  for (const d of pDaily) {
    const k = pGran === "month" ? d.date.slice(0, 7) : pGran === "week" ? weekKey(d.date) : d.date;
    pBucket.set(k, (pBucket.get(k) ?? 0) + d.profit);
  }
  const pLabels = [...pBucket.keys()];
  const pSeries = [
    { name: tr("Beneficio"), color: "#3fb950", values: pLabels.map((l) => pBucket.get(l) ?? 0) },
  ];
  const pYears = [...new Set((pnl?.daily ?? []).map((d) => +d.date.slice(0, 4)))]
    .filter((y) => y > 0)
    .sort((a, b) => b - a);

  return (
    <>
      <div className="seg seg-sm" style={{ marginBottom: "0.7rem" }}>
        <button className={view === "orders" ? "active" : ""} onClick={() => setView("orders")}>
          {tr("Órdenes abiertas")}
        </button>
        <button className={view === "pnl" ? "active" : ""} onClick={() => setView("pnl")}>
          {tr("Rentabilidad (P&L)")}
        </button>
        <button className={view === "watch" ? "active" : ""} onClick={() => setView("watch")}>
          {tr("Watchlist")}
        </button>
      </div>

      {view === "watch" ? (
        <WatchlistPanel />
      ) : view === "orders" ? (
        !orders ? (
          <p className="muted">{busy ? tr("Cargando órdenes…") : tr("Sin datos.")}</p>
        ) : orders.length === 0 ? (
          <p className="muted small">{tr("No tienes órdenes de mercado abiertas.")}</p>
        ) : (
          <>
            <div className="kpis">
              <Kpi label={tr("Órdenes")} value={fmtSp(list.length)} />
              <Kpi label={tr("De compra")} value={fmtSp(buys)} tone="pos" />
              <Kpi label={tr("De venta")} value={fmtSp(list.length - buys)} tone="neg" />
              <Kpi
                label={tr("Pisadas (a repricear)")}
                value={fmtSp(undercut)}
                tone={undercut > 0 ? "neg" : "pos"}
              />
              <Kpi label={tr("Valor compra")} value={fmtIsk(buyValue)} tone="pos" />
              <Kpi label={tr("Valor venta")} value={fmtIsk(sellValue)} tone="neg" />
            </div>
            <table className="km-table">
              <thead>
                <tr>
                  <Th label={tr("Item")} col="item" sort={sort} onSort={onSort} />
                  <Th label={tr("Tipo")} col="type" sort={sort} onSort={onSort} />
                  <Th label={tr("Precio")} col="price" sort={sort} onSort={onSort} />
                  <th>{tr("Estado")}</th>
                  <Th label={tr("Cantidad")} col="qty" sort={sort} onSort={onSort} />
                  <th>{tr("Vendido")}</th>
                  <Th label={tr("Sistema")} col="sys" sort={sort} onSort={onSort} />
                  <th>{tr("Caduca")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((o, i) => {
                  const filled = o.volume_total > 0 ? 1 - o.volume_remain / o.volume_total : 0;
                  const left = daysLeft(o);
                  return (
                    <tr key={i}>
                      <td className="ship-cell">
                        <TypeIcon typeId={o.type_id} />
                        <span>{o.type_name ?? `#${o.type_id}`}</span>
                      </td>
                      <td style={{ color: o.is_buy ? "#3fb950" : "#e5534b" }}>
                        {o.is_buy ? tr("Compra") : tr("Venta")}
                      </td>
                      <td>{fmtIsk(o.price)}</td>
                      <td>
                        {o.is_best ? (
                          <span className="ord-best">✓ {tr("Mejor")}</span>
                        ) : (
                          <span
                            className="ord-cut"
                            title={
                              o.best_competitor != null
                                ? `${tr("Mejor rival")}: ${fmtIsk(o.best_competitor)}`
                                : ""
                            }
                          >
                            ⚠ {tr("Pisada")}
                            {o.best_competitor != null && (
                              <span className="muted small"> · {fmtIsk(o.best_competitor)}</span>
                            )}
                          </span>
                        )}
                        {o.competitors > 0 && (
                          <span className="muted small"> · {o.competitors} {tr("riv.")}</span>
                        )}
                      </td>
                      <td>
                        {fmtSp(o.volume_remain)} / {fmtSp(o.volume_total)}
                      </td>
                      <td>{(filled * 100).toFixed(0)}%</td>
                      <td>{o.system_name ?? (o.system_id ? `#${o.system_id}` : "—")}</td>
                      <td>{left == null ? "—" : left <= 0 ? tr("caducada") : `${left} ${tr("d")}`}</td>
                      <td style={{ textAlign: "right" }}>
                        <WatchAddBtn typeId={o.type_id} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )
      ) : pnlBusy && !pnl ? (
        <p className="muted">{tr("Cargando…")}</p>
      ) : !pnl || pnl.items.length === 0 ? (
        <p className="muted small">
          {tr("Sin transacciones de mercado para calcular el P&L. Se van acumulando al sincronizar la wallet.")}
        </p>
      ) : (
        <>
          <div className="kpis">
            <Kpi
              label={tr("Beneficio realizado")}
              value={fmtIsk(pnl.total_profit)}
              tone={pnl.total_profit >= 0 ? "pos" : "neg"}
            />
            <Kpi label={tr("Facturación (ventas)")} value={fmtIsk(pnl.total_revenue)} />
            <Kpi label={tr("Coste de lo vendido")} value={fmtIsk(pnl.total_cost)} tone="neg" />
            <Kpi label={tr("Impuestos y comisiones")} value={fmtIsk(pnl.total_tax)} tone="neg" />
            <Kpi
              label={tr("Neto tras impuestos")}
              value={fmtIsk(pnl.total_profit - pnl.total_tax)}
              tone={pnl.total_profit - pnl.total_tax >= 0 ? "pos" : "neg"}
            />
          </div>
          <div className="rateo-controls">
            <div className="seg">
              {(["day", "week", "month"] as const).map((g) => (
                <button key={g} className={pGran === g ? "active" : ""} onClick={() => setPGran(g)}>
                  {g === "day" ? tr("Día") : g === "week" ? tr("Semana") : tr("Mes")}
                </button>
              ))}
            </div>
            <RangePresets from={pFrom} to={pTo} setFrom={setPFrom} setTo={setPTo} years={pYears} />
          </div>
          <div className="rateo-charthead">
            <span className="muted small">
              {tr("Beneficio realizado por")}{" "}
              {pGran === "day" ? tr("día") : pGran === "week" ? tr("semana") : tr("mes")}
            </span>
          </div>
          <MultiLineProgress labels={pLabels} series={pSeries} fmt={fmtIsk} />
          <p className="muted small">
            {tr("Beneficio realizado por item (coste medio ponderado): ingreso de ventas − coste de lo vendido. Los impuestos/comisiones son del wallet (globales, no por item).")}
          </p>
          <table className="km-table">
            <thead>
              <tr>
                <th>{tr("Item")}</th>
                <th style={{ textAlign: "right" }}>{tr("Comprado")}</th>
                <th style={{ textAlign: "right" }}>{tr("Vendido")}</th>
                <th style={{ textAlign: "right" }}>{tr("Compra media")}</th>
                <th style={{ textAlign: "right" }}>{tr("Venta media")}</th>
                <th style={{ textAlign: "right" }}>{tr("Beneficio")}</th>
                <th style={{ textAlign: "right" }}>{tr("Margen")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pnl.items.map((it) => (
                <tr key={it.type_id}>
                  <td className="ship-cell">
                    <TypeIcon typeId={it.type_id} />
                    <span>{it.name ?? `#${it.type_id}`}</span>
                  </td>
                  <td style={{ textAlign: "right" }}>{fmtSp(it.bought_qty)}</td>
                  <td style={{ textAlign: "right" }}>{fmtSp(it.sold_qty)}</td>
                  <td style={{ textAlign: "right" }}>{fmtIsk(it.avg_buy)}</td>
                  <td style={{ textAlign: "right" }}>{fmtIsk(it.avg_sell)}</td>
                  <td style={{ textAlign: "right", color: it.profit >= 0 ? "#3fb950" : "#e5534b" }}>
                    {fmtIsk(it.profit)}
                  </td>
                  <td style={{ textAlign: "right" }}>{it.margin.toFixed(1)}%</td>
                  <td style={{ textAlign: "right" }}>
                    <WatchAddBtn typeId={it.type_id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
