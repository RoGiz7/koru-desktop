// ★★ ESCALACIONES — el cliente en español las llama «intensificaciones».
//
// Pedida por la comunidad. Rateando una anomalía puede escalar a un complejo: el juego te da un
// SISTEMA y **24 horas**. Si se te pasa, se pierde entera.
//
// ★ LO QUE HACE QUE ESTO NO SEA UN CUADERNO: el reloj. El registro es la excusa; **el aviso antes
//   de que caduque es el producto**. Por eso lo primero de la pantalla es cuánto queda, y por eso
//   apuntar una tiene que costar dos campos y no diez.
//
// ★ Y TIENE DOS MODALIDADES, porque así se juega (RoGiz7, 2026-09-08):
//   · la haces tú → el reloj es tuyo;
//   · la vendes   → la guardas en un safe, das acceso con una lista y cobras. A partir de ahí el
//     reloj deja de ser tuyo… pero sirve para otra cosa: cuando caduca, ya no hay ningún motivo
//     para que el comprador siga en tu lista de acceso.
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { fmtSp, typeIcon } from "./format";
import { Kpi } from "./charts";
import { SystemSearch } from "./map";
import { loadNewEden } from "./neweden";
import { loadJson } from "./staticJson";
import { PilotoNombre } from "./fichaPiloto";
import type { NeSystem } from "./types";

type Escalacion = {
  id: number;
  character_id: number | null;
  titulo: string;
  ded: number | null;
  faccion_id: number | null;
  system_id: number | null;
  system_name: string;
  cadena_id: number | null;
  parte: number;
  modo: string;
  estado: string;
  abierta_at: string;
  caduca_at: string;
  cerrada_at: string | null;
  run_id: number | null;
  nota: string | null;
  comprador: string | null;
  precio: number | null;
  lista_acceso: string | null;
  cobrada_at: string | null;
  entregada_at: string | null;
  acceso_retirado_at: string | null;
  quedan_min: number;
};
type Ranura = { lista: string; comprador: string; system_name: string };

// La facción NO se pide: sale del catálogo a partir del título. Tenía aquí una lista de las seis
// (Angel 500011 · Blood 500012 · Guristas 500010 · Sansha 500019 · Serpentis 500020 · Drones
// 500025, todas verificadas contra `factions.jsonl`) para un selector, y `tsc` la marcó sin usar —
// que es la señal de que sobraba. Si un sitio no está en el catálogo se queda sin facción y la
// fila cae al icono de sonda, que es la verdad. El selector son cinco líneas el día que haga falta.
const facLogo = (id: number) => `https://images.evetech.net/corporations/${id}/logo?size=32`;
const TID_ESCALACION = 30488; // Sisters Core Scanner Probe — lo que ya significa «sitio» en la app

/** Catálogo de sitios con valoración DED, sacado del SDE (ver `scripts/extract_ded_sites.py`).
 *  nombre en minúsculas → { r: rating, f: facción }. En 8 idiomas: se copia el título tal como lo
 *  enseña TU cliente. */
type DedSite = { r: number; f: number | null; n: string };
let dedPromise: Promise<Record<string, DedSite>> | null = null;
function loadDed(): Promise<Record<string, DedSite>> {
  if (!dedPromise) dedPromise = loadJson<Record<string, DedSite>>("/ded_sites.json", {});
  return dedPromise;
}

/** ★★ «¿CUÁNTO LE QUEDA?» → minutos. Acepta lo que el juego escribe, LITERALMENTE.
 *
 *  Nació de una pregunta suya: *«si tardo más en apuntarla, ¿no debería poder poner yo el
 *  tiempo?»*. Podía — el campo era eso desde el principio, con 24 h como valor por defecto — pero
 *  **que lo preguntara quien lo había diseñado media hora antes significa que la pantalla no lo
 *  estaba diciendo.** Si él no lo veía, un usuario menos.
 *
 *  Y el arreglo bueno no era cambiar la etiqueta. La ventana del juego pone `17 h 20 m 15 s`;
 *  pedir «horas» obliga a traducir eso a `17,33` de cabeza, que es una cuenta que nadie debería
 *  hacer y en la que se puede uno equivocar. **Así que se copia y se pega tal cual.**
 *
 *  Un número suelto se lee como HORAS, que es lo que espera quien teclea «24». Probado con doce
 *  casos antes de escribirlo, incluidos los que deben devolver `null`. */
export function minutosDe(txt: string): number | null {
  const t = txt.trim().toLowerCase().replace(",", ".");
  if (!t) return null;
  const reloj = t.match(/^(\d{1,2})\s*:\s*(\d{1,2})$/); // "17:20"
  if (reloj) return +reloj[1] * 60 + +reloj[2];
  const partes = t.match(/(\d+(?:\.\d+)?)\s*([hms])/g); // "17 h 20 m 15 s", "90m", "2h"
  if (partes) {
    let min = 0;
    for (const p of partes) {
      const n = parseFloat(p);
      if (p.includes("h")) min += n * 60;
      else if (p.includes("m")) min += n;
      else min += n / 60;
    }
    return Math.round(min);
  }
  const n = parseFloat(t);
  return Number.isFinite(n) ? Math.round(n * 60) : null;
}

/** «17 h 20 m», como lo escribe el juego. En negativo dice que se pasó, no un número raro. */
function restante(min: number): string {
  if (min <= 0) return tr("caducada");
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h} h ${m} m` : `${m} m`;
}
/** El color sale del tiempo, no del estado: es lo que se lee sin leer. */
function urgencia(min: number): string {
  if (min <= 0) return "esc-muerta";
  if (min <= 180) return "esc-urge";
  if (min <= 6 * 60) return "esc-pronto";
  return "";
}

export function EscalacionesView() {
  const [vivas, setVivas] = useState<Escalacion[] | null>(null);
  const [hist, setHist] = useState<Escalacion[]>([]);
  const [ranuras, setRanuras] = useState<Ranura[]>([]);
  const [systems, setSystems] = useState<NeSystem[]>([]);
  const [ded, setDed] = useState<Record<string, DedSite>>({});
  const [error, setError] = useState("");
  // Un tic por minuto para que el reloj corra solo. No hace falta más: el dato es a minutos.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(t);
  }, []);

  async function recargar() {
    try {
      const [v, h, r] = await Promise.all([
        invoke<Escalacion[]>("escalaciones_vivas"),
        invoke<Escalacion[]>("escalaciones_historico", { limit: 100 }),
        invoke<Ranura[]>("escalaciones_ranuras"),
      ]);
      setVivas(v);
      setHist(h);
      setRanuras(r);
    } catch (e) {
      setError(String(e));
      setVivas([]);
    }
  }
  useEffect(() => {
    void recargar();
    loadNewEden().then((ne) => setSystems(ne.systems)).catch(() => {});
    loadDed().then(setDed).catch(() => {});
  }, []);

  // ---- el formulario ----
  const [titulo, setTitulo] = useState("");
  const [sysId, setSysId] = useState<number | null>(null);
  // El texto tal cual lo escribe el usuario; `minutosDe` lo interpreta. Guardar el texto y no el
  // número deja que escriba «17h20» sin que el campo le pelee mientras teclea.
  const [queda, setQueda] = useState("24 h");
  const [modo, setModo] = useState<"propia" | "venta">("propia");
  const [guardando, setGuardando] = useState(false);

  /** ★ El título RESUELVE el rating y la facción, así que no se preguntan.
   *
   *  Lo tumbó él: su captura del cliente enseña «DIFICULTAD: Nivel 5» y yo iba a poner ese campo
   *  en el formulario… pero **ese sitio es una 10/10**. Las dos escalas no son el mismo número y
   *  habría hecho que la gente copiara el valor equivocado. Lo que sí identifica el rating es el
   *  título, y eso está en los datos del juego. */
  const reconocido = useMemo(() => ded[titulo.trim().toLowerCase()] ?? null, [ded, titulo]);
  const sugerencias = useMemo(() => {
    const q = titulo.trim().toLowerCase();
    if (q.length < 3 || reconocido) return [];
    return Object.keys(ded).filter((k) => k.includes(q)).slice(0, 6);
  }, [ded, titulo, reconocido]);

  async function abrir() {
    const sys = systems.find((s) => s.id === sysId);
    if (!sys) {
      setError(tr("Falta el sistema."));
      return;
    }
    setGuardando(true);
    setError("");
    try {
      await invoke("escalacion_abrir", {
        titulo: titulo.trim(),
        ded: reconocido?.r ?? null,
        faccionId: reconocido?.f ?? null,
        systemId: sys.id,
        systemName: sys.n,
        minutos: minutosDe(queda) ?? 24 * 60,
        modo,
      });
      setTitulo("");
      setQueda("24 h");
      await recargar();
    } catch (e) {
      setError(String(e));
    } finally {
      setGuardando(false);
    }
  }

  async function estado(id: number, e: string) {
    try {
      await invoke("escalacion_estado", { id, estado: e });
      await recargar();
    } catch (err) {
      setError(String(err));
    }
  }

  const urgentes = (vivas ?? []).filter((e) => e.modo === "propia" && e.quedan_min > 0 && e.quedan_min <= 180);

  return (
    <div className="esc-view">
      {error && <p className="err small">{error}</p>}

      <div className="kpis">
        <Kpi label={tr("Vivas")} value={fmtSp((vivas ?? []).length)} />
        <Kpi label={tr("Urgen (menos de 3 h)")} value={fmtSp(urgentes.length)} tone={urgentes.length ? "neg" : undefined} />
        {ranuras.length > 0 && <Kpi label={tr("Ranuras ocupadas")} value={fmtSp(ranuras.length)} />}
      </div>

      {/* ---- apuntar una ---- */}
      <div className="esc-nueva">
        <div className="esc-campos">
          <div className="esc-campo esc-titulo">
            <label className="small muted">{tr("Título, tal como lo pone el juego")}</label>
            <input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder={tr("p. ej. Astillero naval del Cártel de los Ángeles")}
            />
            {/* El catálogo dice el rating y la facción; el usuario no los teclea. */}
            {reconocido && (
              <span className="small esc-reconocida">
                {reconocido.f != null && <img src={facLogo(reconocido.f)} alt="" width={16} height={16} />}
                {" "}
                {tr("Reconocida")}: <strong>{reconocido.r}/10</strong>
              </span>
            )}
            {sugerencias.length > 0 && (
              <div className="esc-sug">
                {sugerencias.map((s) => (
                  <button key={s} onClick={() => setTitulo(ded[s].n)}>
                    {ded[s].n} <span className="muted">{ded[s].r}/10</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="esc-campo">
            <label className="small muted">{tr("Sistema")}</label>
            <SystemSearch systems={systems} value={sysId} onPick={setSysId} placeholder={tr("Buscar sistema…")} />
          </div>
          <div className="esc-campo esc-horas">
            {/* La etiqueta pregunta lo que hay que TECLEAR, no lo que significa el campo. Y debajo
                se confirma cómo se ha entendido: sin eso, escribir «17h20» es un acto de fe. */}
            <label className="small muted">{tr("¿Cuánto le queda?")}</label>
            <input
              value={queda}
              onChange={(e) => setQueda(e.target.value)}
              placeholder="17 h 20 m"
            />
            <span className={`small ${minutosDe(queda) == null ? "err" : "muted"}`}>
              {minutosDe(queda) == null
                ? tr("no lo entiendo")
                : `= ${restante(minutosDe(queda) as number)}`}
            </span>
          </div>
          <div className="esc-campo">
            <label className="small muted">{tr("Qué vas a hacer con ella")}</label>
            <div className="seg seg-sm">
              <button className={modo === "propia" ? "active" : ""} onClick={() => setModo("propia")}>
                {tr("La hago yo")}
              </button>
              <button className={modo === "venta" ? "active" : ""} onClick={() => setModo("venta")}>
                {tr("La vendo")}
              </button>
            </div>
          </div>
          <button className="esc-guardar" onClick={abrir} disabled={guardando || !sysId}>
            {tr("Apuntar")}
          </button>
        </div>
        <p className="muted small">
          {tr("Copia el «CADUCA EN» del juego tal cual —«17 h 20 m»— o escribe las horas a secas. Si la apuntas nada más sacarla, son 24 h y no tienes que tocar nada.")}
        </p>
      </div>

      {/* ---- las vivas ---- */}
      {vivas == null ? (
        <p className="muted small">{tr("Cargando…")}</p>
      ) : vivas.length === 0 ? (
        <p className="muted small">
          {tr("Ninguna apuntada. Cuando te salte una, apúntala aquí y Koru te avisa antes de que caduque.")}
        </p>
      ) : (
        <div className="esc-lista">
          {vivas.map((e) => (
            <div key={e.id} className={`esc-fila ${urgencia(e.quedan_min)}`}>
              <img
                className="esc-ico"
                src={e.faccion_id ? facLogo(e.faccion_id) : typeIcon(TID_ESCALACION, 32)}
                alt=""
                width={26}
                height={26}
              />
              <div className="esc-main">
                <div className="esc-linea1">
                  <strong>{e.system_name}</strong>
                  {e.ded != null && <span className="intel-count fleet">{e.ded}/10</span>}
                  {e.parte > 1 && <span className="muted small">{tr("parte")} {e.parte}</span>}
                  {e.modo === "venta" && <span className="esc-tag-venta">{tr("en venta")}</span>}
                </div>
                <span className="muted small">{e.titulo || tr("sin título")}</span>
                {e.modo === "venta" && e.comprador && (
                  <span className="muted small">
                    {tr("vendida a")} <PilotoNombre nombre={e.comprador} />
                    {e.lista_acceso && ` · ${e.lista_acceso}`}
                  </span>
                )}
              </div>
              <div className="esc-reloj">
                <span className="esc-quedan">{restante(e.quedan_min)}</span>
                <span className="muted small">{tr("caduca en")}</span>
              </div>
              <div className="esc-acciones">
                {e.modo === "propia" ? (
                  <>
                    <button onClick={() => estado(e.id, "hecha")}>{tr("Hecha")}</button>
                    <button onClick={() => estado(e.id, "abandonada")}>{tr("Paso")}</button>
                  </>
                ) : (
                  <>
                    {e.estado === "en_venta" && (
                      <button onClick={() => estado(e.id, "cobrada")}>{tr("Cobrada")}</button>
                    )}
                    {e.estado !== "entregada" && (
                      <button onClick={() => estado(e.id, "entregada")}>{tr("Acceso dado")}</button>
                    )}
                    {e.estado === "entregada" && (
                      <button onClick={() => estado(e.id, "cerrada")}>{tr("Acceso retirado")}</button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---- las ranuras ocupadas ----
           Que no te queden libres es información ANTES de aceptar otra venta, no después. */}
      {ranuras.length > 0 && (
        <div className="esc-sec">
          <h4>🔑 {tr("Listas de acceso ocupadas")}</h4>
          <table className="km-table cat-table">
            <tbody>
              {ranuras.map((r, i) => (
                <tr key={i}>
                  <td>{r.lista}</td>
                  <td><PilotoNombre nombre={r.comprador} /></td>
                  <td className="muted">{r.system_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- histórico ---- */}
      {hist.length > 0 && (
        <div className="esc-sec">
          <h4>📜 {tr("Histórico")}</h4>
          <table className="km-table cat-table">
            <tbody>
              {hist.slice(0, 40).map((e) => (
                <tr key={e.id}>
                  <td>{e.system_name}</td>
                  <td>{e.ded != null ? `${e.ded}/10` : "—"}</td>
                  <td className="muted">{e.titulo}</td>
                  <td className={e.estado === "caducada" ? "kpi-neg" : ""}>{tr(e.estado)}</td>
                  <td style={{ textAlign: "right" }}>
                    {e.precio != null ? `${fmtSp(Math.round(e.precio / 1e6))} M` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
