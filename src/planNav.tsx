// ★★ EL PLAN EN NAVEGACIÓN — el orden, los márgenes y el arrastre. El cálculo vive en `plan.ts`;
// esto es la pantalla y el puente con el planificador del mapa.
//
// Se planifica en Escalaciones (qué entra en el plan) y se mira AQUÍ, al lado de la línea
// amarilla, porque los márgenes salen del mismo grafo que la dibuja.
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { SystemSearch } from "./map";
import type { NeSystem } from "./types";
import {
  MAX_PERMUTAR,
  cacheTramos,
  duracion,
  evaluar,
  proponer,
  type Evaluacion,
  type ParadaCalc,
  type ParadaCargada,
  type PlanCargado,
  type Tramo,
} from "./plan";

const MIN_SALTO_KEY = "koru-plan-min-salto";
const MIN_SITIO_KEY = "koru-plan-min-sitio";
/** ~1 min por salto a puertas: alinear, warp y gate de un crucero sin prisas. 45 min en el sitio:
 *  lo que tarda una escalación media. Los dos se ven y se cambian en el propio panel. */
const DEF_MIN_SALTO = 1;
const DEF_MIN_SITIO = 45;

function leerNum(key: string, def: number): number {
  const v = Number(localStorage.getItem(key) ?? "");
  return Number.isFinite(v) && v >= 0 && localStorage.getItem(key) != null ? v : def;
}

/** El texto del motivo por el que una parada no resuelve. Ver `Db::plan_cargar`. */
function textoFallo(p: ParadaCargada): string {
  return p.fallo === "kind_desconocido"
    ? `${tr("Tipo de parada desconocido")} «${p.kind}»: ${tr("este Koru no sabe leerla")}`
    : `«${p.kind}» #${p.ref_id} ${tr("ya no existe y su borrado no limpió el plan")}`;
}

/** Por qué una parada resuelta ya no entra en el cálculo. Las de venta no llevan su estado crudo
 *  («en_venta», «cobrada»…): lo que importa aquí es que la corre el comprador. */
function textoEstado(estado: string): string {
  if (["en_venta", "cobrada", "entregada"].includes(estado)) return tr("vendida: la corre el comprador");
  return tr(estado);
}

export function PlanNav(props: {
  planId: number;
  /** Sube cada vez que alguien pide abrir el plan: fuerza recargar aunque el id sea el mismo. */
  nonce: number;
  systems: NeSystem[];
  hereSystemId: number | null;
  nameOf: (sid: number) => string;
  /** El buscador de rutas del mapa: MISMO grafo, modo y evitados que la línea amarilla. */
  calcTramo: (desde: number, hasta: number) => Tramo;
  /** Pinta las paradas en el planificador del mapa: [origen, parada1, parada2…]. */
  onPintar: (stops: number[]) => void;
  /** Las paradas que tiene AHORA el planificador, para saber si la línea sigue siendo la del plan. */
  rutaActual: (number | null)[];
  /** Mientras se intercepta a un piloto la ruta es suya: el plan no la pisa, y se dice. */
  intercepting: boolean;
  focusSystem: (sid: number) => void;
  onCerrar: () => void;
}) {
  const { planId, nonce, systems, hereSystemId, nameOf, calcTramo, onPintar, rutaActual, intercepting, focusSystem, onCerrar } = props;
  const [cargado, setCargado] = useState<PlanCargado | null>(null);
  const [error, setError] = useState("");
  const [minSalto, setMinSalto] = useState(() => leerNum(MIN_SALTO_KEY, DEF_MIN_SALTO));
  const [minSitio, setMinSitio] = useState(() => leerNum(MIN_SITIO_KEY, DEF_MIN_SITIO));
  // Un latido por minuto: los márgenes dependen de «ahora» y tienen que bajar solos.
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setAhora(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  async function recargar() {
    try {
      setCargado(await invoke<PlanCargado>("plan_cargar", { planId }));
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    void recargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId, nonce]);

  // ⚠️ Las que no resuelven se CANTAN también en consola, además de en pantalla: es un fallo de
  //    otro sitio (un borrado que no limpió) y quien desarrolla tiene que poder verlo sin abrir esto.
  useEffect(() => {
    for (const p of cargado?.paradas ?? []) if (p.fallo) console.error(`[plan ${planId}] ${textoFallo(p)}`);
  }, [cargado, planId]);

  const plan = cargado?.plan ?? null;
  const origen = plan?.origen_system_id ?? hereSystemId;

  // Las que entran en el cálculo, en el orden guardado; el resto se enseña aparte con su motivo.
  const { calc, fuera } = useMemo(() => {
    const calc: { p: ParadaCargada; c: ParadaCalc }[] = [];
    const fuera: ParadaCargada[] = [];
    for (const p of cargado?.paradas ?? []) {
      const r = p.resuelta;
      if (r && r.por_hacer && r.system_id != null) {
        calc.push({ p, c: { stopId: p.id, systemId: r.system_id, caducaMs: Date.parse(r.caduca_at) } });
      } else fuera.push(p);
    }
    return { calc, fuera };
  }, [cargado]);
  const paradas = useMemo(() => calc.map((x) => x.c), [calc]);

  const puntosKey = origen == null ? "" : [origen, ...paradas.map((p) => p.systemId)].join(",");
  const tramos = useMemo(
    () => (origen == null ? null : cacheTramos([origen, ...paradas.map((p) => p.systemId)], calcTramo)),
    // `puntosKey` resume origen + sistemas; `calcTramo` cambia cuando cambia el grafo, el modo o
    // los evitados, y entonces hay que volver a buscar todos los tramos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [puntosKey, calcTramo],
  );

  const propuesta = useMemo(
    () => (tramos ? proponer(paradas, tramos, ahora, minSalto, minSitio) : null),
    [tramos, paradas, ahora, minSalto, minSitio],
  );
  const manual = useMemo(
    () => (tramos ? evaluar(paradas.map((_, i) => i), paradas, tramos, ahora, minSalto, minSitio) : null),
    [tramos, paradas, ahora, minSalto, minSitio],
  );
  // ★ El orden manual MANDA cuando existe. El propuesto se sigue calculando para decir si salvaría
  //   más: se calla la imposición, nunca el dato (misma regla que silenciar un sistema en el intel).
  const actual: Evaluacion | null = plan?.orden_manual ? manual : propuesta?.mejor ?? null;

  // ---- pintar en el mapa ----
  // Sin ninguna parada en el recorrido (todas imposibles) no hay línea del plan: "" y no se vigila.
  const pintarKey =
    actual && origen != null && !intercepting && actual.resultados.some((r) => r.estado !== "sin_ruta")
      ? [
          origen,
          ...actual.resultados.filter((r) => r.estado !== "sin_ruta").map((r) => paradas.find((p) => p.stopId === r.stopId)!.systemId),
        ].join(",")
      : "";
  useEffect(() => {
    if (!pintarKey) return;
    const stops = pintarKey.split(",").map(Number);
    if (stops.length >= 2) onPintar(stops);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pintarKey]);

  // ⚠️ La columna «Paradas» sigue siendo editable con el plan abierto. Si alguien toca la ruta a
  //    mano, la línea amarilla deja de ser la del plan y los márgenes de aquí contarían otra cosa
  //    que lo dibujado al lado. No se le bloquea —puede querer mirar un desvío—, pero se dice.
  const lineaEsDelPlan = !pintarKey || rutaActual.filter((s) => s != null).join(",") === pintarKey;

  // ---- reordenar (arrastre y flechas) ----
  /** Guarda un orden nuevo de las paradas del cálculo. Se aplica YA en pantalla (los márgenes se
   *  recalculan al instante) y luego se guarda; si guardar falla, se recarga lo que hay y se dice. */
  async function reordenar(ordenIdx: number[]) {
    if (!cargado) return;
    // Las imposibles no están en `ordenIdx` (no están en el recorrido), pero son del plan: van
    // detrás, o `plan_reordenar` rechazaría el orden por incompleto.
    const nuevas = ordenIdx.map((i) => calc[i].p);
    const imposibles = calc.filter((_, i) => !ordenIdx.includes(i)).map((x) => x.p);
    const todas = [...nuevas, ...imposibles, ...fuera];
    setCargado({ plan: { ...cargado.plan, orden_manual: true }, paradas: todas.map((p, i) => ({ ...p, orden: i })) });
    try {
      await invoke("plan_reordenar", { planId, stopIds: todas.map((p) => p.id) });
    } catch (e) {
      setError(String(e));
      await recargar();
    }
  }
  function mover(desde: number, hasta: number) {
    if (!actual || desde === hasta) return;
    const o = [...actual.orden];
    const [x] = o.splice(desde, 1);
    o.splice(hasta, 0, x);
    void reordenar(o);
  }
  async function usarPropuesto() {
    if (!propuesta) return;
    try {
      // Se guarda el propuesto como orden de la tabla Y se devuelve el mando a Koru: así, si
      // luego vuelves a arrastrar, partes de lo que estabas viendo.
      await invoke("plan_reordenar", {
        planId,
        stopIds: [
          ...propuesta.mejor.orden.map((i) => calc[i].p.id),
          ...calc.filter((_, i) => !propuesta.mejor.orden.includes(i)).map((x) => x.p.id),
          ...fuera.map((p) => p.id),
        ],
      });
      await invoke("plan_orden_propuesto", { planId });
    } catch (e) {
      setError(String(e));
    }
    await recargar();
  }
  async function quitar(stopId: number) {
    try {
      await invoke("plan_quitar", { stopId });
    } catch (e) {
      setError(String(e));
    }
    await recargar();
  }
  async function fijarOrigen(sid: number | null) {
    try {
      await invoke("plan_origen", { planId, systemId: sid });
    } catch (e) {
      setError(String(e));
    }
    await recargar();
  }

  // ★ ARRASTRE CON EVENTOS DE PUNTERO, no con el drag&drop de HTML5: en Windows, Tauri intercepta
  //   el arrastre nativo de la ventana (`dragDropEnabled`, activo por defecto) y `onDrop` no llega
  //   nunca. Cambiar esa opción tocaría toda la ventana principal por una lista de 8 filas.
  const filas = useRef<(HTMLLIElement | null)[]>([]);
  const [arrastre, setArrastre] = useState<{ desde: number; sobre: number } | null>(null);
  function sobreQue(y: number): number {
    let idx = 0;
    filas.current.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (y > r.top + r.height / 2) idx = i + 1;
    });
    return idx;
  }

  const nombrePlan = plan ? plan.nombre || `${tr("Plan")} #${plan.id}` : "";
  const comparacion = (() => {
    if (!plan?.orden_manual || !propuesta || !manual) return null;
    const p = propuesta.mejor;
    if (p.salvadas > manual.salvadas)
      return {
        aviso: true,
        texto: `${tr("El orden propuesto salvaría")} ${p.salvadas} ${tr("de")} ${paradas.length}; ${tr("el tuyo salva")} ${manual.salvadas}.`,
      };
    if (p.salvadas === manual.salvadas && p.recorridoMin < manual.recorridoMin)
      return {
        aviso: false,
        texto: `${tr("El orden propuesto salva las mismas con")} ${duracion(manual.recorridoMin - p.recorridoMin)} ${tr("menos de recorrido.")}`,
      };
    return { aviso: false, texto: tr("Tu orden salva lo mismo que el propuesto.") };
  })();

  return (
    <div className="plan-nav">
      <div className="nav-head plan-nav-head">
        🗂 {tr("Plan")}: <b>{nombrePlan}</b>
        <button className="route-stop-del" title={tr("Cerrar el plan (no lo borra)")} onClick={onCerrar}>
          ✕
        </button>
      </div>
      {error && <div className="fits-err small">{error}</div>}
      {!cargado ? (
        !error && <div className="muted small">{tr("cargando…")}</div>
      ) : (
        <>
          <div className="plan-nav-ajustes">
            <div className="route-stop">
              <span className="route-stop-label">{tr("Origen")}</span>
              <SystemSearch
                systems={systems}
                value={origen}
                placeholder={tr("Sistema de salida…")}
                onPick={(id) => void fijarOrigen(id)}
              />
              {plan?.origen_system_id != null && (
                <button
                  className="route-add"
                  title={tr("Volver a contar desde donde está el personaje activo")}
                  onClick={() => void fijarOrigen(null)}
                >
                  {tr("Personaje activo")}
                </button>
              )}
            </div>
            {/* ⚠️ A LA VISTA y no en Ajustes: el veredicto depende de estos dos números, y un número
                que decide si llegas no puede ser invisible. */}
            <label className="muted small">
              {tr("Minutos por salto")}:&nbsp;
              <input
                type="number"
                min={0.1}
                step={0.1}
                value={minSalto}
                style={{ width: "4.5rem" }}
                onChange={(e) => {
                  const v = Math.max(0.1, parseFloat(e.target.value) || DEF_MIN_SALTO);
                  setMinSalto(v);
                  localStorage.setItem(MIN_SALTO_KEY, String(v));
                }}
              />
            </label>
            <label className="muted small">
              {tr("Minutos en cada sitio")}:&nbsp;
              <input
                type="number"
                min={0}
                step={5}
                value={minSitio}
                style={{ width: "4.5rem" }}
                onChange={(e) => {
                  const v = Math.max(0, parseFloat(e.target.value) || 0);
                  setMinSitio(v);
                  localStorage.setItem(MIN_SITIO_KEY, String(v));
                }}
              />
            </label>
          </div>

          {origen == null && (
            <div className="fits-err small">
              {tr("Falta el origen: Koru no sabe dónde está el personaje activo. Elige el sistema de salida.")}
            </div>
          )}
          {intercepting && (
            <div className="small route-scope-warn">
              ⚠ {tr("Estás interceptando a un piloto: la línea del mapa es la suya y el plan no la pisa.")}
            </div>
          )}

          {!lineaEsDelPlan && (
            <div className="small route-scope-warn">
              ⚠ {tr("La ruta del mapa ya no es la del plan: los márgenes de aquí no cuentan lo dibujado.")}{" "}
              <button className="route-add" onClick={() => onPintar(pintarKey.split(",").map(Number))}>
                {tr("Volver a pintar el plan")}
              </button>
            </div>
          )}
          {actual && paradas.length > 0 && (
            <>
              <div className="plan-nav-resumen">
                {tr("Salvas")} <b>{actual.salvadas}</b> {tr("de")} {paradas.length} ·{" "}
                {tr("recorrido")} {duracion(actual.recorridoMin)}
                {" · "}
                <span className="muted">
                  {plan?.orden_manual ? tr("orden tuyo") : tr("orden propuesto por Koru")}
                </span>
              </div>
              {propuesta?.metodo === "caducidad" && (
                <div className="small route-scope-warn">
                  ⚠ {tr("Con más de")} {MAX_PERMUTAR} {tr("paradas el orden es por caducidad, no el óptimo.")}
                </div>
              )}
              {comparacion && (
                <div className={`small ${comparacion.aviso ? "route-scope-warn" : "muted"}`}>
                  {comparacion.aviso ? "⚠ " : ""}
                  {comparacion.texto}{" "}
                  {comparacion.aviso || propuesta!.mejor.recorridoMin < manual!.recorridoMin ? (
                    <button className="route-add" onClick={() => void usarPropuesto()}>
                      {tr("Usar el orden propuesto")}
                    </button>
                  ) : null}
                </div>
              )}

              <ol
                className={`plan-nav-lista${arrastre ? " arrastrando" : ""}`}
                onPointerMove={(e) => arrastre && setArrastre({ ...arrastre, sobre: sobreQue(e.clientY) })}
                onPointerUp={() => {
                  if (!arrastre) return;
                  const { desde, sobre } = arrastre;
                  setArrastre(null);
                  // `sobre` es un hueco entre filas (0..n); al sacar la fila de arriba, se corre uno.
                  mover(desde, sobre > desde ? sobre - 1 : sobre);
                }}
                onPointerCancel={() => setArrastre(null)}
              >
                {actual.resultados.map((r, pos) => {
                  const p = calc.find((x) => x.p.id === r.stopId)!;
                  const res = p.p.resuelta!;
                  const cls =
                    r.estado === "salvada" ? "plan-ok" : r.estado === "perdida" ? "plan-perdida" : "plan-sinruta";
                  return (
                    <li
                      key={r.stopId}
                      ref={(el) => {
                        filas.current[pos] = el;
                      }}
                      className={`plan-parada ${cls}${arrastre?.desde === pos ? " cogida" : ""}${
                        arrastre && arrastre.sobre === pos && arrastre.desde !== pos ? " hueco-arriba" : ""
                      }${
                        arrastre && pos === actual.resultados.length - 1 && arrastre.sobre === pos + 1 ? " hueco-abajo" : ""
                      }`}
                    >
                      <span
                        className="plan-asa"
                        title={tr("Arrastra para cambiar el orden")}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          (e.currentTarget.closest("ol") as HTMLElement | null)?.setPointerCapture(e.pointerId);
                          setArrastre({ desde: pos, sobre: pos });
                        }}
                      >
                        ⠿
                      </span>
                      <span className="plan-num">{pos + 1}</span>
                      <div className="plan-cuerpo">
                        <div>
                          <b>{res.titulo || tr("(sin título)")}</b>{" "}
                          <a className="plan-sys" onClick={() => focusSystem(res.system_id!)}>
                            {nameOf(res.system_id!) || res.system_name}
                          </a>
                        </div>
                        <div className="small">
                          {r.estado === "sin_ruta" ? (
                            <span>{tr("Sin ruta con los filtros actuales: no se puede contar.")}</span>
                          ) : (
                            <>
                              <span className="muted">
                                {r.saltos} {tr("saltos")} ·{" "}
                              </span>
                              {r.estado === "salvada" ? (
                                <span>
                                  {tr("llegas con")} <b>{duracion(r.margenMin)}</b> {tr("de sobra")}
                                </span>
                              ) : (
                                <span>
                                  ✖ {tr("llegas")} <b>{duracion(r.margenMin)}</b> {tr("tarde: se pierde con este orden")}
                                </span>
                              )}
                            </>
                          )}
                          {r.wormhole && (
                            <span className="plan-wh">
                              {" · "}◆ {tr("este tramo cruza un wormhole: puede haberse cerrado")}
                            </span>
                          )}
                        </div>
                      </div>
                      <button className="route-stop-del" title={tr("Subir")} disabled={pos === 0} onClick={() => mover(pos, pos - 1)}>
                        ↑
                      </button>
                      <button
                        className="route-stop-del"
                        title={tr("Bajar")}
                        disabled={pos === actual.resultados.length - 1}
                        onClick={() => mover(pos, pos + 1)}
                      >
                        ↓
                      </button>
                      <button
                        className="route-stop-del"
                        title={tr("Sacar del plan (la escalación no se toca)")}
                        onClick={() => void quitar(r.stopId)}
                      >
                        ✕
                      </button>
                    </li>
                  );
                })}
              </ol>
              {/* ★ APARTE Y NO EN EL RECORRIDO: estas se pierden hagas lo que hagas, así que no
                  gastan viaje ni se arrastran. Ver `separarImposibles` en plan.ts. */}
              {actual.imposibles.length > 0 && (
                <>
                  <div className="nav-head">✖ {tr("No llegas ni yendo directo")}</div>
                  <ul className="plan-nav-fuera">
                    {actual.imposibles.map((im) => {
                      const res = calc.find((x) => x.p.id === im.stopId)!.p.resuelta!;
                      return (
                        <li key={im.stopId} className="plan-parada plan-perdida">
                          <div className="plan-cuerpo">
                            <div>
                              <b>{res.titulo || tr("(sin título)")}</b>{" "}
                              <a className="plan-sys" onClick={() => focusSystem(res.system_id!)}>
                                {nameOf(res.system_id!) || res.system_name}
                              </a>
                            </div>
                            <div className="small">
                              <span className="muted">
                                {im.saltos} {tr("saltos")} ·{" "}
                              </span>
                              ✖ {tr("yendo directo llegas")} <b>{duracion(im.margenMin)}</b>{" "}
                              {tr("tarde: perdida hagas lo que hagas")}
                            </div>
                          </div>
                          <button
                            className="route-stop-del"
                            title={tr("Sacar del plan (la escalación no se toca)")}
                            onClick={() => void quitar(im.stopId)}
                          >
                            ✕
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </>
          )}
          {cargado.paradas.length === 0 && (
            <div className="muted small">{tr("El plan está vacío: añade escalaciones desde la sección Escalaciones.")}</div>
          )}

          {fuera.length > 0 && (
            <>
              <div className="nav-head">{tr("Fuera del cálculo")}</div>
              <ul className="plan-nav-fuera">
                {fuera.map((p) => (
                  <li key={p.id} className={p.fallo ? "fits-err small" : "small muted"}>
                    {p.fallo ? (
                      <>⚠ {textoFallo(p)}</>
                    ) : p.resuelta!.system_id == null ? (
                      <>
                        {p.resuelta!.titulo} — {tr("no sabe en qué sistema está")}
                      </>
                    ) : (
                      <>
                        {p.resuelta!.titulo} · {p.resuelta!.system_name} — {tr("ya no está por hacer")} ({textoEstado(p.resuelta!.estado)})
                      </>
                    )}{" "}
                    <button className="route-stop-del" title={tr("Sacar del plan")} onClick={() => void quitar(p.id)}>
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
