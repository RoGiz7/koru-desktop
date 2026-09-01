// Sección Assets: inventario, tipos, valor estimado de mercado (blueprints excluidos),
// top por valor y detalle con visor de fiteos. Extraído de App.tsx.
//
// La gráfica «Distribución por categoría» se retiró el 2026-09-01: medía UNIDADES, y con 145
// millones de minerales doce de sus catorce barras eran un muñón. Su información vive ahora en
// las propias pestañas del filtro, que es donde se decide.
import { useState, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { fmtIsk, fmtSp, typeIcon } from "./format";
import { TypeIcon, Kpi, Th } from "./charts";
import { WatchAddBtn } from "./comercio";
import { ShipFit, FIT_SLOTS_RE } from "./fit";
import type { AssetsSummary, AssetDetail } from "./types";
import { loadJson } from "./staticJson";

import { Pista } from "./pista";

/** Icono de cada categoría de assets.
 *
 *  ★ typeIDs VERIFICADOS uno a uno contra `public/market_types.json` **y** contra el servidor de
 *  imágenes —que no todos los tipos sirven la variante `icon`—, nunca de memoria. Es la regla de
 *  la casa y hoy ya ha evitado tres iconos rotos.
 *
 *  «Otros» y «Starbase» se quedan sin icono a propósito: un icono que no representa nada dice
 *  menos que ninguno, y «Otros» es literalmente «lo que no encaja». */
const CAT_TID: Record<string, number> = {
  Naves: 587, // Rifter
  Módulos: 2048, // Damage Control II
  Cargas: 12767, // Quake M
  Blueprints: 691, // Rifter Blueprint — ⚠️ solo sirve la variante `bp`
  Drones: 2454, // Hobgoblin I
  Cazas: 23061, // Einherji I
  Materiales: 34, // Tritanium
  "Ore / Asteroides": 1230, // Veldspar
  Comercio: 3699, // Quafe
  Estructuras: 35832, // Astrahus
  Desplegables: 33474, // Mobile Depot
  Subsistemas: 45588, // Legion Defensive - Nanobot Injector
  Implantes: 9899, // Ocular Filter - Basic
};
export function AssetsView(props: {
  data: AssetsSummary | null;
  detail: AssetDetail[] | null;
  busy: boolean;
  charId: number | null;
  presetQuery?: string;
  /** «Ver en el mapa»: centra el sistema en la pestaña Mapa (fase 2 del centrado). */
  onVerEnMapa?: (sysId: number) => void;
}) {
  const { data, detail, busy, charId, presetQuery, onVerEnMapa } = props;
  const [q, setQ] = useState("");
  const [cat, setCat] = useState(""); // "" = Todos
  // Datos para el skill-check del fit al abrir una nave.
  const [reqs, setReqs] = useState<Record<string, [number, number][]>>({});
  const [skillNames, setSkillNames] = useState<Record<string, string>>({});
  const [charSkills, setCharSkills] = useState<Record<number, number> | null>(null);
  useEffect(() => {
    // Los mismos dos ficheros que usa Fiteos para su skill-check: por staticJson, una descarga
    // por sesión y compartida entre las dos secciones (`skill_reqs.json` son 203 KB).
    loadJson<Record<string, [number, number][]>>("/skill_reqs.json", {}).then(setReqs);
    loadJson<Record<string, string>>("/skill_names.json", {}).then(setSkillNames);
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
  /** Cuántas ENTRADAS hay en cada categoría — el número que se enseña en su pestaña de filtro.
   *  Entradas y no unidades: es exactamente lo que aparecerá al pulsarla. */
  const porCat = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of detail ?? []) m[r.category] = (m[r.category] ?? 0) + 1;
    return m;
  }, [detail]);
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
            <div className="panel resumen-panel" style={{ marginBottom: "0.8rem" }}>
              <h4>💰 {tr("Top assets por valor estimado")}</h4>
              <p className="muted small">
                {tr("Los blueprints se quedan fuera: un BPC no se puede vender en el mercado —solo por contrato—, y el average_price de un BPO es su valor base, no lo que sacarías por él. Su total sigue arriba, en su propio dato.")}
              </p>
              {/* ★ TRES COLUMNAS A ANCHO COMPLETO (idea de RoGiz7). Un top único mezclaba una nave
                  con un montón de mineral y no dejaba comparar nada; separado por familias, cada
                  columna contesta una pregunta distinta y las tres caben de un vistazo.
                  ⚠️ El top de CADA familia lo calcula el RUST — repartir aquí un top global daría
                  «lo que le tocó a cada cesta» y una columna podría quedarse vacía bajo un título
                  que promete cinco. Y por eso `family` viaja en el dato: definirla en los dos lados
                  sería la vía segura para que algún día divergieran. */}
              <div className="top-fams">
                {(["Naves", "Materiales", "Items"] as const).map((fam) => {
                  const filas = data.top_value.filter((t) => t.family === fam);
                  return (
                    <div key={fam} className="top-fam">
                      <div className="top-fam-tit">{tr(fam)}</div>
                      {filas.length === 0 ? (
                        // Vacío DECLARADO: sin esto, una familia sin nada se leería como un fallo
                        // de carga en vez de como «no tienes de esto».
                        <div className="muted small">{tr("Nada de esta familia.")}</div>
                      ) : (
                        filas.map((t) => (
                          <div key={t.type_id} className="top-fila">
                            <TypeIcon typeId={t.type_id} className="cat-ico" />
                            <span className="top-nom" title={t.name ?? undefined}>
                              {t.name ?? `#${t.type_id}`}
                            </span>
                            {/* ×cantidad pegado al nombre: es del objeto, no una columna aparte. */}
                            <span className="top-qty">×{fmtSp(t.qty)}</span>
                            <span className="top-isk">{fmtIsk(t.value)}</span>
                            <WatchAddBtn typeId={t.type_id} />
                          </div>
                        ))
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {/* ★ LA CUENTA VA EN LA PROPIA PESTAÑA (idea de RoGiz7). Antes había aquí una gráfica
              «Distribución por categoría» que ocupaba media pantalla y medía UNIDADES: con 145
              millones de minerales, doce de las catorce barras eran un muñón. Poner el número en
              el filtro lo arregla tres veces —desaparece el panel, muere el problema de escala
              (números sueltos no comparten eje) y el dato aparece justo DONDE SE DECIDE, que es
              al elegir por dónde filtrar—. Misma regla de proximidad que las pistas.
              El número son ENTRADAS, no unidades: es exactamente lo que verás al pulsar. */}
          {detail && catList.length > 1 && (
            <div className="tabs cat-tabs" style={{ marginTop: "0.5rem" }}>
              <button className={`tab ${cat === "" ? "active" : ""}`} onClick={() => setCat("")}>
                {tr("Todos")} <span className="cat-n">{fmtSp(detail.length)}</span>
              </button>
              {catList.map((c) => (
                <button
                  key={c}
                  className={`tab ${cat === c ? "active" : ""}`}
                  onClick={() => setCat(c)}
                >
                  {CAT_TID[c] != null && (
                    <TypeIcon
                      typeId={CAT_TID[c]}
                      className="cat-ico"
                      blueprint={c === "Blueprints"}
                    />
                  )}
                  {tr(c)} <span className="cat-n">{fmtSp(porCat[c] ?? 0)}</span>
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
            <>
            {/* ★ LA PISTA DE ASSETS. Pegada a la tabla, que es donde está el icono del que habla.
                No es un caso imaginado: RoGiz7 buscó el fit pinchando la NAVE —que es lo natural—
                y no pasó nada, porque la entrada está en la columna «Contenedor». La función
                existía; lo que faltaba era que se viera. */}
            <Pista id="assets-fit">
              {tr(
                "El fit de una nave se abre desde el icono de la columna «Contenedor», no pinchando la nave.",
              )}
            </Pista>
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
                      {/* `TypeIcon` y no un <img> crudo: los BLUEPRINTS no responden a `/icon` y
                          salían rotos, con un 400 por cada uno en cada carga de la sección. La
                          fila ya sabe su categoría, así que se pide la variante buena a la primera
                          en vez de fallar y reintentar. Es el mismo tropiezo que en las notas. */}
                      <TypeIcon typeId={r.type_id} blueprint={r.category === "Blueprints"} />
                      <span>{r.type_name ?? `#${r.type_id}`}</span>
                    </td>
                    <td>{fmtSp(r.quantity)}</td>
                    <td>
                      {r.system_id && onVerEnMapa ? (
                        <span
                          className="ver-mapa"
                          title={tr("Ver en el mapa")}
                          onClick={() => onVerEnMapa(r.system_id!)}
                        >
                          {r.system_name ?? `#${r.system_id}`}
                        </span>
                      ) : (
                        (r.system_name ?? (r.system_id ? `#${r.system_id}` : "—"))
                      )}
                    </td>
                    <td className="muted small">{r.location_name || "—"}</td>
                    {/* EL NOMBRE VA DENTRO DEL BOTÓN (2026-08-26). Antes el nombre del contenedor
                        era texto plano y lo clicable era SOLO un iconito al 60 % de opacidad y sin
                        borde: RoGiz7 fue a abrir el fit pinchando la nave —que es lo natural— y no
                        pasó nada. La función estaba, la entrada no se anunciaba. Ahora el nombre
                        lleva el subrayado punteado de la casa (el mismo lenguaje que
                        `.piloto-link` y `.ver-mapa`) y clicar en él abre lo que hay dentro. */}
                    <td className="muted small">
                      {r.container_id !== 0 ? (
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
                          <span className="asset-open-name">
                            {r.container ?? tr("contenedor")}
                          </span>
                        </button>
                      ) : (
                        (r.container ?? "")
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </>
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
