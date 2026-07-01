// Sección Assets: inventario, tipos, valor estimado de mercado (blueprints excluidos),
// top por valor, distribución por categoría y detalle con visor de fiteos. Extraído de App.tsx.
import { useState, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { fmtIsk, fmtSp, typeIcon } from "./format";
import { TypeIcon, Kpi, Bars, Th } from "./charts";
import { WatchAddBtn } from "./comercio";
import { ShipFit, FIT_SLOTS_RE } from "./fit";
import type { AssetsSummary, AssetDetail } from "./types";

export function AssetsView(props: {
  data: AssetsSummary | null;
  detail: AssetDetail[] | null;
  busy: boolean;
  charId: number | null;
  presetQuery?: string;
}) {
  const { data, detail, busy, charId, presetQuery } = props;
  const [q, setQ] = useState("");
  const [cat, setCat] = useState(""); // "" = Todos
  // Datos para el skill-check del fit al abrir una nave.
  const [reqs, setReqs] = useState<Record<string, [number, number][]>>({});
  const [skillNames, setSkillNames] = useState<Record<string, string>>({});
  const [charSkills, setCharSkills] = useState<Record<number, number> | null>(null);
  useEffect(() => {
    fetch("/skill_reqs.json").then((r) => r.json()).then(setReqs).catch(() => {});
    fetch("/skill_names.json").then((r) => r.json()).then(setSkillNames).catch(() => {});
  }, []);
  useEffect(() => {
    if (charId == null) {
      setCharSkills(null);
      return;
    }
    invoke<Record<number, number>>("get_char_skill_levels", { characterId: charId })
      .then(setCharSkills)
      .catch(() => setCharSkills(null));
  }, [charId]);
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 }>({ col: "qty", dir: -1 });
  // Contenedor/nave "abierto" (drill-down): muestra solo su contenido.
  const [openContainer, setOpenContainer] = useState<{ id: number; name: string } | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const lastPreset = useRef<string | null>(null);
  const pendingScroll = useRef(false);
  // Búsqueda prefijada desde fuera (p. ej. "Mis assets aquí" del mapa): filtra por el sistema.
  useEffect(() => {
    if (presetQuery && presetQuery !== lastPreset.current) {
      lastPreset.current = presetQuery;
      setQ(presetQuery);
      setOpenContainer(null);
      pendingScroll.current = true; // bajar a la lista en cuanto exista (aunque los assets aún carguen)
    }
  }, [presetQuery]);
  // Baja hasta el buscador/tabla una sola vez cuando ya está renderizado.
  useEffect(() => {
    if (pendingScroll.current && searchRef.current) {
      pendingScroll.current = false;
      requestAnimationFrame(() =>
        searchRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      );
    }
  });
  const onSort = (col: string) =>
    setSort((s) => (s.col === col ? { col, dir: s.dir === 1 ? -1 : 1 } : { col, dir: 1 }));
  const ql = q.trim().toLowerCase();
  const catList = Array.from(new Set((detail ?? []).map((r) => r.category))).sort();
  const filtered = (detail ?? []).filter(
    (r) =>
      (openContainer === null || r.container_id === openContainer.id) &&
      (cat === "" || r.category === cat) &&
      (ql === "" ||
        (r.type_name ?? "").toLowerCase().includes(ql) ||
        (r.system_name ?? "").toLowerCase().includes(ql) ||
        (r.location_name ?? "").toLowerCase().includes(ql) ||
        (r.container ?? "").toLowerCase().includes(ql))
  );
  const sorted = [...filtered].sort((a, b) => {
    const d = sort.dir;
    if (sort.col === "qty") return (a.quantity - b.quantity) * d;
    const av = sort.col === "name" ? a.type_name ?? "" : a.system_name ?? "";
    const bv = sort.col === "name" ? b.type_name ?? "" : b.system_name ?? "";
    return av.localeCompare(bv) * d;
  });
  const shown = sorted.slice(0, 300);
  // Si el contenedor abierto es una nave (tiene slots), mostramos su fit.
  const containerRows = openContainer
    ? (detail ?? []).filter((r) => r.container_id === openContainer.id)
    : [];
  const isShipFit = openContainer !== null && containerRows.some((r) => FIT_SLOTS_RE.test(r.slot));
  const shipTypeId = containerRows[0]?.container_type_id ?? 0;
  // Contenedores que son naves fiteadas (tienen módulos en slots): para mostrar otro icono.
  const shipContainers = useMemo(() => {
    const s = new Set<number>();
    for (const r of detail ?? []) {
      if (r.container_id && FIT_SLOTS_RE.test(r.slot)) s.add(r.container_id);
    }
    return s;
  }, [detail]);
  return (
    <>
      {!data && busy && <p className="muted">{tr("Cargando… (puede tardar con muchos assets)")}</p>}
      {data && (
        <>
          <div className="kpis">
            <Kpi label={tr("Stacks")} value={fmtSp(data.stacks)} />
            <Kpi label={tr("Tipos distintos")} value={fmtSp(data.distinct_types)} />
            <Kpi label={tr("Unidades totales")} value={fmtSp(data.total_units)} />
            {data.est_value_clean > 0 && (
              <Kpi label={tr("Valor estimado")} value={fmtIsk(data.est_value_clean)} />
            )}
            {data.est_value - data.est_value_clean > 0 && (
              <Kpi
                label={tr("Blueprints (excluidos)")}
                value={fmtIsk(data.est_value - data.est_value_clean)}
                tone="neg"
              />
            )}
          </div>
          {data.top_value && data.top_value.length > 0 && (
            <div className="panel resumen-panel" style={{ maxWidth: 580, marginBottom: "0.8rem" }}>
              <h4>💰 {tr("Top assets por valor estimado")}</h4>
              <p className="muted small">
                {tr("Los blueprints NO cuentan para el patrimonio: el average_price de ESI para un BPO/BPC es su valor base, no lo que sacarías vendiéndolo.")}
              </p>
              <table className="km-table cat-table">
                <thead>
                  <tr>
                    <th>{tr("Item")}</th>
                    <th>{tr("Categoría")}</th>
                    <th style={{ textAlign: "right" }}>{tr("Cantidad")}</th>
                    <th style={{ textAlign: "right" }}>{tr("Valor")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_value.map((t) => (
                    <tr key={t.type_id} className={t.category === "Blueprints" ? "asset-bp" : ""}>
                      <td>
                        <TypeIcon typeId={t.type_id} />{" "}
                        {t.name ?? `#${t.type_id}`}
                      </td>
                      <td>
                        {tr(t.category)}
                        {t.category === "Blueprints" && ` · ${tr("excluido")}`}
                      </td>
                      <td style={{ textAlign: "right" }}>{fmtSp(t.qty)}</td>
                      <td style={{ textAlign: "right" }}>{fmtIsk(t.value)}</td>
                      <td style={{ textAlign: "right" }}>
                        <WatchAddBtn typeId={t.type_id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {detail && detail.length > 0 && catList.length > 1 && (
            <div className="panel resumen-panel" style={{ maxWidth: 540, marginBottom: "0.8rem" }}>
              <h4>{tr("Distribución por categoría")}</h4>
              <Bars
                items={Object.entries(
                  detail.reduce<Record<string, number>>((acc, r) => {
                    acc[r.category] = (acc[r.category] ?? 0) + r.quantity;
                    return acc;
                  }, {})
                )
                  .map(([label, value]) => ({ label: tr(label), value }))
                  .sort((a, b) => b.value - a.value)}
                fmt={fmtSp}
              />
            </div>
          )}
          {detail && catList.length > 1 && (
            <div className="tabs" style={{ marginTop: "0.5rem" }}>
              <button className={`tab ${cat === "" ? "active" : ""}`} onClick={() => setCat("")}>
                {tr("Todos")}
              </button>
              {catList.map((c) => (
                <button
                  key={c}
                  className={`tab ${cat === c ? "active" : ""}`}
                  onClick={() => setCat(c)}
                >
                  {tr(c)}
                </button>
              ))}
            </div>
          )}
          {openContainer && (
            <div className="asset-open-bar">
              <span>📦 {tr("Dentro de")}: <b>{openContainer.name}</b></span>
              <button className="asset-open-close" onClick={() => setOpenContainer(null)}>
                ✕ {tr("cerrar")}
              </button>
            </div>
          )}
          <div className="asset-search" ref={searchRef}>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={tr("Buscar por item, sistema, ubicación o contenedor…")}
            />
            {detail && (
              <span className="muted small">
                {filtered.length === detail.length
                  ? `${detail.length} ${tr("entradas")}`
                  : `${filtered.length} ${tr("de")} ${detail.length}`}
              </span>
            )}
          </div>
          {isShipFit ? (
            <ShipFit
              rows={containerRows}
              typeId={shipTypeId}
              name={openContainer!.name}
              charSkills={charSkills}
              reqs={reqs}
              skillNames={skillNames}
            />
          ) : !detail ? (
            <p className="muted small">{tr("Cargando inventario…")}</p>
          ) : detail.length === 0 ? (
            <p className="muted small">{tr("Sin assets.")}</p>
          ) : (
            <table className="km-table">
              <thead>
                <tr>
                  <Th label={tr("Item")} col="name" sort={sort} onSort={onSort} />
                  <Th label={tr("Cantidad")} col="qty" sort={sort} onSort={onSort} />
                  <Th label={tr("Sistema")} col="sys" sort={sort} onSort={onSort} />
                  <th>{tr("Ubicación")}</th>
                  <th>{tr("Contenedor")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={i}>
                    <td className="ship-cell">
                      <img className="type-ico" src={typeIcon(r.type_id)} alt="" loading="lazy" />
                      <span>{r.type_name ?? `#${r.type_id}`}</span>
                    </td>
                    <td>{fmtSp(r.quantity)}</td>
                    <td>{r.system_name ?? (r.system_id ? `#${r.system_id}` : "—")}</td>
                    <td className="muted small">{r.location_name || "—"}</td>
                    <td className="muted small">
                      {r.container ?? ""}
                      {r.container_id !== 0 && (
                        <button
                          className="asset-open"
                          title={
                            shipContainers.has(r.container_id)
                              ? `${tr("Ver fit de")} ${r.container ?? tr("la nave")}`
                              : `${tr("Abrir")} ${r.container ?? tr("contenedor")}`
                          }
                          onClick={() =>
                            setOpenContainer({ id: r.container_id, name: r.container ?? tr("contenedor") })
                          }
                        >
                          {r.container_type_id ? (
                            <img
                              className="asset-open-ico"
                              src={typeIcon(r.container_type_id, 32)}
                              alt=""
                              loading="lazy"
                            />
                          ) : shipContainers.has(r.container_id) ? (
                            "🚀"
                          ) : (
                            "🔍"
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {filtered.length > shown.length && (
            <p className="muted small">
              {tr("Mostrando")} {shown.length} {tr("de")} {filtered.length}. {tr("Afina la búsqueda para ver más.")}
            </p>
          )}
        </>
      )}
    </>
  );
}

// Formatea el tiempo restante hasta `end` (futuro). Pasado/igual = "✅ listo".
