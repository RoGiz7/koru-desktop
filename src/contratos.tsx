// Comercio → Contratos: el libro de contratos, con ficha por contrato y por persona.
//
// ★ POR QUÉ FICHERO APARTE: la primera versión vivía dentro de comercio.tsx como una tabla suelta,
// y él lo dijo mejor que yo — «no es nada intuitivo saber cada contrato que tiene y qué es, está
// todo un poco a lo bruto». Una tabla ancha no es una sección: es un volcado.
//
// LAS TRES DECISIONES QUE MANDAN AQUÍ:
//  1. LO VIVO ARRIBA. Un contrato pendiente o en curso es algo que hay que HACER; uno terminado es
//     algo que consultas. Mezclarlos en una lista ordenada por fecha esconde lo único accionable.
//  2. LAS PERSONAS SON PERSONAS. El nombre abre su ficha y dice con cuántos contratos os habéis
//     cruzado. Es lo que convierte una lista de filas en tu historia con esa gente.
//  3. EL DETALLE, COMO EN EL JUEGO. Al abrir un contrato salen sus objetos — pedidos a ESI la
//     primera vez y GUARDADOS para siempre (idea suya): la ventana de ESI son 30 días, así que sin
//     guardarlos la ficha se quedaría vacía justo en los viejos, los que ya no puedes mirar dentro
//     del juego.
import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { fmtIsk } from "./format";
import { TypeIcon, Kpi } from "./charts";
import { PilotoNombre } from "./fichaPiloto";
import type { HaulLedger, HaulRow } from "./types";

type ContractItem = {
  type_id: number;
  quantity: number;
  is_included: boolean;
  is_singleton: boolean;
  raw_quantity: number | null;
};

/** Valores crudos de ESI dichos en cristiano. Se traducen a castellano y del castellano al inglés
 *  lo hace i18n como cualquier otro texto: una sola cadena por concepto. */
const TIPO: Record<string, string> = {
  courier: "Courier",
  item_exchange: "Intercambio",
  auction: "Subasta",
  loan: "Préstamo",
};
const ESTADO: Record<string, string> = {
  outstanding: "Pendiente",
  in_progress: "En curso",
  finished: "Completado",
  finished_issuer: "Completado",
  finished_contractor: "Completado",
  failed: "Fallido",
  rejected: "Rechazado",
  cancelled: "Cancelado",
  deleted: "Borrado",
  reversed: "Revertido",
};
/** Los títulos vienen ESCAPADOS de ESI: un «<3» llega como «&lt;3» y se leía literal. */
const desescapar = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&"); // el último, o desharía los de arriba dos veces

const nTipo = (k: string | null) => (k ? tr(TIPO[k] ?? k) : "—");
const nEstado = (s: string | null) => (s ? tr(ESTADO[s] ?? s) : "—");
const fecha = (s: string | null) => (s ? s.slice(0, 10) : "—");

/** ¿Sigue vivo? Pendiente sin caducar, o aceptado y en marcha. Lo demás es historia.
 *  La caducidad se compara con AHORA y no se confía en el estado: ESI deja «outstanding» los que
 *  caducaron sin que nadie los tocara, y pintarlos como vivos sería prometer algo que ya murió. */
function estaVivo(c: HaulRow): boolean {
  if (c.status === "in_progress") return true;
  if (c.status !== "outstanding") return false;
  if (!c.date_expired) return true;
  return new Date(c.date_expired).getTime() > Date.now();
}

/** Cuánto queda para que caduque, en días. Negativo = ya caducó. */
function diasPara(iso: string | null): number | null {
  if (!iso) return null;
  return (new Date(iso).getTime() - Date.now()) / 86400000;
}

export function ContratosPanel({
  subject,
  onFicha,
}: {
  subject: number | "global";
  onFicha?: (name: string, id?: number | null) => void;
}) {
  const [ledger, setLedger] = useState<HaulLedger | null>(null);
  const [busy, setBusy] = useState(false);
  const [abierto, setAbierto] = useState<HaulRow | null>(null);
  const [tipo, setTipo] = useState("todos");
  // La última visita se guarda al ENTRAR, no al salir: si Koru se cierra de golpe, lo peor que
  // pasa es que no se marque nada como nuevo — nunca que se marque de más.
  const [ultimaVisita] = useState<number>(() => {
    const v = Number(localStorage.getItem("koru-contratos-visto")) || 0;
    localStorage.setItem("koru-contratos-visto", String(Date.now()));
    return v;
  });

  useEffect(() => {
    setBusy(true);
    invoke<HaulLedger>("get_haul_ledger", {
      characterId: subject === "global" ? null : subject,
    })
      .then(setLedger)
      .catch(() => setLedger(null))
      .finally(() => setBusy(false));
  }, [subject]);

  const rows = useMemo(() => ledger?.rows ?? [], [ledger]);
  const vivos = useMemo(() => rows.filter(estaVivo), [rows]);
  const historico = useMemo(() => rows.filter((c) => !estaVivo(c)), [rows]);
  const esNuevo = (c: HaulRow) =>
    !!c.first_seen && ultimaVisita > 0 && new Date(c.first_seen).getTime() > ultimaVisita;

  /** Con cuánta gente y cuántas veces. La cuenta sale de las filas que YA están cargadas: no hace
   *  falta preguntarle nada a nadie para saber que con Fulano llevas seis contratos. */
  const porPersona = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of rows) {
      for (const n of [c.issuer, c.acceptor]) {
        if (n) m.set(n, (m.get(n) ?? 0) + 1);
      }
    }
    return m;
  }, [rows]);

  /** ⚠️ El «×4» de la primera versión no lo entendía nadie — y con razón: un ×4 pegado a un nombre
   *  se lee como «cuatro unidades de esa persona». Ahora la cuenta va SOLO en el tooltip y en la
   *  ficha, escrita con palabras. Un número sin sustantivo no es información. */
  const Persona = ({ nombre }: { nombre: string | null }) => {
    if (!nombre) return <span className="muted">—</span>;
    const n = porPersona.get(nombre) ?? 0;
    return (
      <span
        className="ct-persona"
        title={n > 1 ? `${n} ${tr("contratos con esta persona")}` : undefined}
      >
        <PilotoNombre nombre={nombre} onFicha={onFicha} />
      </span>
    );
  };

  /** Origen → destino. Solo se pinta la flecha cuando de verdad hay dos sitios distintos: en un
   *  intercambio origen y destino son el mismo, y un «A → A» es ruido que parece un viaje. */
  const Ruta = ({ c, corto = false }: { c: HaulRow; corto?: boolean }) => {
    const a = c.start_name;
    const b = c.end_name;
    if (!a && !b) return <span className="muted">—</span>;
    const mismo = !b || a === b;
    const acorta = (s: string) => (corto && s.length > 28 ? `${s.slice(0, 27)}…` : s);
    return (
      <span className="ct-ruta">
        {a ? acorta(a) : "—"}
        {!mismo && (
          <>
            <span className="ct-flecha"> → </span>
            {acorta(b!)}
          </>
        )}
      </span>
    );
  };

  /** Las cuentas de la sección. Todas salen de las filas cargadas — ni una consulta más.
   *
   *  ⚠️ «ISK recibidos» suma SOLO las recompensas de courier que TÚ aceptaste: es el único dinero
   *  del que se puede afirmar que entró en tu cartera. El precio de un intercambio no se suma
   *  aquí porque no se sabe de qué lado estabas sin mirar cada contrato, y un total que mezcla lo
   *  que cobras con lo que pagas no es un total: es un número bonito y falso. */
  const stats = useMemo(() => {
    let completados = 0;
    let fallidos = 0;
    let iskDentro = 0;
    let m3 = 0;
    for (const c of rows) {
      const s = c.status ?? "";
      if (s.startsWith("finished")) completados++;
      else if (["failed", "rejected", "cancelled", "reversed", "deleted"].includes(s)) fallidos++;
      if (c.volume) m3 += c.volume;
      if (c.kind === "courier" && c.reward && s.startsWith("finished")) iskDentro += c.reward;
    }
    return { completados, fallidos, iskDentro, m3 };
  }, [rows]);

  if (!ledger) {
    return <p className="muted">{busy ? tr("Cargando contratos…") : tr("Sin datos.")}</p>;
  }
  if (rows.length === 0) {
    return (
      <p className="muted small">
        {tr(
          "No hay contratos guardados. EVE solo deja consultar los de los últimos 30 días: Koru los va guardando en cada sincronización, así que esta lista crecerá aunque EVE los olvide.",
        )}
      </p>
    );
  }

  const filtrado = historico.filter((c) => tipo === "todos" || c.kind === tipo);
  const nuevos = rows.filter(esNuevo).length;

  return (
    <>
      <div className="kpis">
        <Kpi label={tr("EN EL LIBRO")} value={String(ledger.total)} />
        {vivos.length > 0 && <Kpi label={tr("ACTIVOS")} value={String(vivos.length)} tone="pos" />}
        {nuevos > 0 && <Kpi label={tr("NUEVOS")} value={String(nuevos)} tone="pos" />}
        <Kpi label={tr("COMPLETADOS")} value={String(stats.completados)} />
        {stats.fallidos > 0 && (
          <Kpi label={tr("SIN COMPLETAR")} value={String(stats.fallidos)} tone="neg" />
        )}
        <Kpi label={tr("PERSONAS")} value={String(porPersona.size)} />
        {stats.iskDentro > 0 && <Kpi label={tr("ISK RECIBIDOS")} value={fmtIsk(stats.iskDentro)} tone="pos" />}
        {stats.m3 > 0 && (
          <Kpi label={tr("m³ MOVIDOS")} value={Math.round(stats.m3).toLocaleString()} />
        )}
      </div>

      {/* DESDE CUÁNDO hay libro. No es un pie de página decorativo: sin él, un libro corto se lee
          como poca actividad, cuando lo que dice es que Koru empezó a mirar ese día. */}
      {ledger.since && (
        <p className="muted small">
          {tr("Koru guarda contratos desde")} <b>{fecha(ledger.since)}</b>.{" "}
          {tr("Lo anterior no es que no existiera: es que aún no lo miraba.")}
        </p>
      )}

      {/* ---------- LO VIVO ---------- */}
      <h4 className="ct-h">
        {tr("Activos")} <span className="muted small">· {tr("pendientes de aceptar o en curso")}</span>
      </h4>
      {vivos.length === 0 ? (
        <p className="muted small">{tr("Ninguno abierto ahora mismo.")}</p>
      ) : (
        <div className="ct-cards">
          {vivos.map((c) => {
            const dias = diasPara(c.date_expired);
            return (
              <button key={c.contract_id} className="ct-card" onClick={() => setAbierto(c)}>
                <div className="ct-card-top">
                  <span className="ct-kind">{nTipo(c.kind)}</span>
                  {esNuevo(c) && <span className="ct-nuevo">{tr("nuevo")}</span>}
                  <span className={`ct-estado ${c.status === "in_progress" ? "curso" : ""}`}>
                    {nEstado(c.status)}
                  </span>
                </div>
                <div className="ct-card-title">
                  {c.title ? desescapar(c.title) : <span className="muted">{tr("Sin título")}</span>}
                </div>
                <div className="ct-card-row">
                  <Persona nombre={c.issuer} />
                  {c.assignee && <span className="muted"> → </span>}
                  {c.assignee && <Persona nombre={c.assignee} />}
                </div>
                <div className="ct-card-row small ct-ruta-row">
                  <Ruta c={c} corto />
                </div>
                <div className="ct-card-row small">
                  {c.volume ? <span>{Math.round(c.volume).toLocaleString()} m³</span> : null}
                  {c.reward ? <span className="pos">{fmtIsk(c.reward)}</span> : null}
                  {c.price ? <span>{fmtIsk(c.price)}</span> : null}
                  {c.collateral ? (
                    <span className="muted" title={tr("Lo que te juegas")}>
                      ⚠ {fmtIsk(c.collateral)}
                    </span>
                  ) : null}
                </div>
                {/* La cuenta atrás, que es lo único urgente de esta pantalla. */}
                {dias != null && (
                  <div className={`ct-caduca${dias < 1 ? " urge" : ""}`}>
                    {dias < 0
                      ? tr("caducado")
                      : dias < 1
                        ? `${tr("caduca en")} ${Math.max(1, Math.round(dias * 24))} h`
                        : `${tr("caduca en")} ${Math.round(dias)} ${tr("días")}`}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ---------- EL HISTÓRICO ---------- */}
      <h4 className="ct-h">
        {tr("Histórico")} <span className="muted small">· {historico.length}</span>
      </h4>
      <div className="sig-btabs">
        {["todos", "courier", "item_exchange", "auction", "loan"].map((k) => (
          <button
            key={k}
            className={`sig-btab${tipo === k ? " active" : ""}`}
            onClick={() => setTipo(k)}
          >
            {k === "todos" ? tr("Todos") : nTipo(k)}
          </button>
        ))}
      </div>
      <table className="tabla ct-tabla">
        <thead>
          <tr>
            <th>{tr("Tipo")}</th>
            <th>{tr("Título")}</th>
            <th>{tr("Emisor")}</th>
            <th>{tr("Aceptó")}</th>
            <th>{tr("Dónde")}</th>
            <th className="num">{tr("Volumen")}</th>
            <th className="num">{tr("ISK")}</th>
            <th>{tr("Estado")}</th>
            <th>{tr("Fecha")}</th>
          </tr>
        </thead>
        <tbody>
          {filtrado.map((c) => (
            <tr key={c.contract_id} className="ct-fila" onClick={() => setAbierto(c)}>
              <td>{nTipo(c.kind)}</td>
              <td>{c.title ? desescapar(c.title) : <span className="muted">—</span>}</td>
              <td onClick={(e) => e.stopPropagation()}>
                <Persona nombre={c.issuer} />
              </td>
              <td onClick={(e) => e.stopPropagation()}>
                <Persona nombre={c.acceptor} />
              </td>
              <td className="small">
                <Ruta c={c} corto />
              </td>
              <td className="num">
                {c.volume
                  ? `${c.volume < 1 ? c.volume.toFixed(2) : Math.round(c.volume).toLocaleString()} m³`
                  : "—"}
              </td>
              <td className="num" title={c.reward ? tr("Recompensa por llevarlo") : tr("Precio del intercambio")}>
                {c.reward ? fmtIsk(c.reward) : c.price ? fmtIsk(c.price) : "—"}
              </td>
              <td className="small">{nEstado(c.status)}</td>
              <td className="small muted">{fecha(c.date_completed ?? c.date_issued)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {abierto && (
        <FichaContrato c={abierto} onClose={() => setAbierto(null)} onFicha={onFicha} veces={porPersona} />
      )}
    </>
  );
}

/** La ficha de un contrato: lo mismo que enseña el juego, más lo que el juego ya no te enseña. */
function FichaContrato({
  c,
  onClose,
  onFicha,
  veces,
}: {
  c: HaulRow;
  onClose: () => void;
  onFicha?: (name: string, id?: number | null) => void;
  veces: Map<string, number>;
}) {
  const [items, setItems] = useState<ContractItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setItems(null);
    setErr(null);
    invoke<ContractItem[]>("get_contract_items", {
      contractId: c.contract_id,
      characterId: c.character_id,
    })
      .then(setItems)
      // Si falla SE DICE. Una lista vacía y un error se ven igual, y no son lo mismo: una dice
      // «no llevaba nada» y el otro «no se pudo mirar».
      .catch((e) => setErr(String(e)));
  }, [c.contract_id, c.character_id]);

  const dan = (items ?? []).filter((i) => i.is_included);
  const piden = (items ?? []).filter((i) => !i.is_included);

  const Linea = ({ i }: { i: ContractItem }) => (
    <div className="ct-item">
      <TypeIcon typeId={i.type_id} size={28} blueprint={(i.raw_quantity ?? 0) < 0} />
      <span className="ct-item-n">
        <NombreTipo id={i.type_id} />
        {/* Una COPIA de plano no vale lo que el original, y ESI solo lo dice con un número
            negativo escondido en otro campo. Si no se declara, la ficha miente por omisión. */}
        {(i.raw_quantity ?? 0) < 0 && <span className="ct-bpc">{tr("copia")}</span>}
        {i.is_singleton && <span className="muted small"> · {tr("montado")}</span>}
      </span>
      <span className="ct-item-q">×{i.quantity.toLocaleString()}</span>
    </div>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal ct-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ct-modal-head">
          <h3>
            {c.title ? desescapar(c.title) : nTipo(c.kind)}{" "}
            <span className="muted small">({nTipo(c.kind)})</span>
          </h3>
          <button className="nota-btn del" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="ct-datos">
          <Dato k={tr("Estado")} v={nEstado(c.status)} />
          <Dato
            k={tr("Emisor")}
            v={
              c.issuer ? (
                <>
                  <PilotoNombre nombre={c.issuer} onFicha={onFicha} />
                  {(veces.get(c.issuer) ?? 0) > 1 && (
                    <span className="muted small">
                      {" "}
                      · {veces.get(c.issuer)} {tr("contratos con esta persona")}
                    </span>
                  )}
                </>
              ) : (
                "—"
              )
            }
          />
          {c.assignee && (
            <Dato k={tr("Para")} v={<PilotoNombre nombre={c.assignee} onFicha={onFicha} />} />
          )}
          {c.acceptor && (
            <Dato k={tr("Aceptó")} v={<PilotoNombre nombre={c.acceptor} onFicha={onFicha} />} />
          )}
          {c.start_name && (
            <Dato k={c.end_name && c.end_name !== c.start_name ? tr("Origen") : tr("Ubicación")} v={c.start_name} />
          )}
          {c.end_name && c.end_name !== c.start_name && <Dato k={tr("Destino")} v={c.end_name} />}
          {c.volume ? <Dato k={tr("Volumen")} v={`${c.volume.toLocaleString()} m³`} /> : null}
          {c.reward ? <Dato k={tr("Recompensa")} v={fmtIsk(c.reward)} /> : null}
          {c.price ? <Dato k={tr("Precio")} v={fmtIsk(c.price)} /> : null}
          {c.collateral ? <Dato k={tr("Fianza")} v={fmtIsk(c.collateral)} /> : null}
          {c.isk_por_m3 ? <Dato k="ISK/m³" v={fmtIsk(c.isk_por_m3)} /> : null}
          <Dato k={tr("Emitido")} v={fecha(c.date_issued)} />
          {c.date_expired && <Dato k={tr("Caduca")} v={fecha(c.date_expired)} />}
          {c.date_completed && <Dato k={tr("Completado")} v={fecha(c.date_completed)} />}
          {c.horas_entrega && c.horas_entrega > 0 ? (
            <Dato k={tr("Entrega")} v={`${c.horas_entrega.toFixed(1)} h`} />
          ) : null}
        </div>

        <h4 className="ct-h">{tr("Contenido")}</h4>
        {err ? (
          <p className="small" style={{ color: "var(--danger-text)" }}>
            {tr("No se pudo leer el contenido:")} {err}
          </p>
        ) : !items ? (
          <p className="muted small">{tr("Leyendo el contenido…")}</p>
        ) : items.length === 0 ? (
          <p className="muted small">{tr("Este contrato no lleva objetos.")}</p>
        ) : (
          <>
            {dan.length > 0 && (
              <>
                <div className="ct-lado">{tr("Recibes")}</div>
                {dan.map((i, n) => (
                  <Linea key={`d${n}`} i={i} />
                ))}
              </>
            )}
            {/* Los dos lados de un intercambio vienen en la MISMA lista de ESI. Separarlos no es
                cosmética: confundirlos le da la vuelta al sentido del contrato. */}
            {piden.length > 0 && (
              <>
                <div className="ct-lado pide">{tr("Entregas a cambio")}</div>
                {piden.map((i, n) => (
                  <Linea key={`p${n}`} i={i} />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Dato({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="ct-dato">
      <span className="ct-dato-k">{k}</span>
      <span className="ct-dato-v">{v}</span>
    </div>
  );
}

/** Nombre de un tipo desde el catálogo de mercado, cargado una vez por sesión. */
function NombreTipo({ id }: { id: number }) {
  const [n, setN] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    void import("./staticJson").then(({ loadJson }) =>
      loadJson<{ i: number; n: string }[]>("/market_types.json", []).then((ts) => {
        if (vivo) setN(ts.find((t) => t.i === id)?.n ?? null);
      }),
    );
    return () => {
      vivo = false;
    };
  }, [id]);
  return <>{n ?? `#${id}`}</>;
}
