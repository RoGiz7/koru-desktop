// ★★ LA FICHA DE RUN COMPARTIDA — las piezas que escalaciones, abismos y CRAB cuentan igual.
//
// Idea de RoGiz7 (2026-09-16), el mismo día que se publicó la 0.51.0: el botín objeto a objeto YA
// se estaba guardando en las tres actividades, pero **solo se veía en escalaciones**. Las notas de
// esa release lo dijeron con todas las letras —«en abismos y CRAB se está guardando para cuando esa
// ficha llegue allí»—, así que esto es una promesa pública que se paga, no una idea nueva.
//
// ★ POR QUÉ UN FICHERO Y NO UNA COPIA: `escalacionDetalle.tsx` ya tenía escrita la mitad de esto.
//   Duplicarla habría dejado dos fichas que cuentan lo mismo de dos maneras, y el histórico de este
//   proyecto dice a dónde lleva eso: «arreglado en un sitio y no en su hermano» es exactamente lo
//   que pasó con la nave por piloto, con «Por nave» diciendo 0 donde las otras decían −68M, y con
//   este mismo botín. Aquí las piezas comunes viven UNA vez.
//
// ★ EL PATRÓN LO FIJÓ LA FICHA DE PILOTO (fichaPiloto.tsx) y se respeta: un componente por pieza,
//   **solo se pinta el bloque que tiene datos**, y cada bloque dice su alcance. Una ficha llena de
//   guiones se lee como que faltan datos, cuando lo que pasa es que esa run no tuvo esa parte.
//
// ⚠️ LAS CLASES CSS SE LLAMAN `.esc-det-*` POR HISTORIA, no porque sean de escalaciones: nacieron
//    ahí y hoy las comparten las dos fichas. Se dejan con ese nombre a propósito —renombrarlas
//    tocaría quince reglas de App.css para no cambiar ni un píxel— y queda dicho aquí y en App.css
//    para que nadie deduzca del prefijo que esto solo sirve para una sección.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { fmtIsk, typeIcon } from "./format";
import { parseIskShorthand, type LootIndex } from "./lootPaste";
import { iskCorto } from "./isk";
import { LootPasteModal } from "./lootPasteModal";
import type { RunLootLine } from "./runLoot";
import type { ActivityRun, RunChar } from "./types";

/** Lo que la ficha necesita de una run, sea de la actividad que sea. `ActivityRun` lo cumple entero;
 *  escalaciones pasa un objeto con esta forma. Declarar un campo es prometer que se enseña. */
export type RunDet = {
  outcome?: string;
  loot_isk: number | null;
  loot_note?: string | null;
  ship_loss_isk: number | null;
  entry_cost?: number | null;
  /** Fabricador: oleadas alcanzadas y Rampancy con la que se entró. Solo en esa actividad. */
  waves?: number | null;
  rampancy?: number | null;
  started_at: string | null;
  ended_at: string | null;
  ship_type_id: number | null;
  chars?: {
    character_id: number;
    ship_type_id: number | null;
    outcome?: string;
    lost_value?: number;
  }[];
};

/** `2026-09-16T21:40:03Z` → `2026-09-16 21:40`. Se CORTA la cadena en vez de pasarla por `Date`:
 *  las horas de EVE son UTC y convertirlas a la zona del equipo haría que la cronología de una
 *  venta no cuadrara con lo que se vio en el juego. El resto de la app también corta. */
export const fechaCorta = (s: string | null | undefined): string =>
  s ? `${s.slice(0, 10)} ${s.slice(11, 16)}` : "—";

/** Una fila `etiqueta: valor`. No se pinta si no hay valor — ver el encabezado del fichero. */
export function Dato({ k, v, tone }: { k: string; v: React.ReactNode; tone?: "pos" | "neg" }) {
  if (v == null || v === "" || v === "—") return null;
  return (
    <div className="esc-det-fila">
      <span className="esc-det-k">{k}</span>
      <span className={tone === "pos" ? "kpi-pos" : tone === "neg" ? "kpi-neg" : ""}>{v}</span>
    </div>
  );
}

/** La duración de una run, o null si no se cronometró.
 *
 *  Una run cerrada en el mismo gesto (marcar «Hecha» sin haber pulsado «Voy») dura ~0: no se pinta
 *  un «0 min» que se leería como que la hiciste en cero. Misma regla que el histórico. */
export function duracionDeRun(run: RunDet | undefined): string | null {
  if (!run?.started_at || !run.ended_at) return null;
  const min = Math.round((Date.parse(run.ended_at) - Date.parse(run.started_at)) / 60000);
  return min >= 1 ? `${min} min` : null;
}

/** ★★ EL BOTÍN OBJETO A OBJETO, PEDIDO SOLO AL ABRIR LA FICHA — idea de RoGiz7: *«leer la info solo
 *  cuando se pide en el detalle»*. Un pegado son decenas de líneas por run; viajar con cada listado
 *  del histórico sería traer miles de filas para enseñar cuarenta.
 *
 *  `null` = todavía no se ha preguntado · `[]` = se preguntó y esa run no tiene detalle guardado,
 *  que es el caso de **todas las runs anteriores al 2026-09-16**. Los dos estados se distinguen a
 *  propósito, porque «cargando» y «no hay» no son lo mismo. */
export function BotinDesglose({
  runId,
  hayTotal,
  fuente = "run",
}: {
  runId: number | null;
  hayTotal: boolean;
  /** De qué tabla se lee. Son dos tablas hijas distintas porque los padres son distintos —
   *  `activity_runs` y `exploration_log`—, pero la LÍNEA es la misma y se pinta igual, así que el
   *  componente es uno. Ver el comentario de `exploration_loot` en `schema.sql`. */
  fuente?: "run" | "exploracion";
}) {
  const [botin, setBotin] = useState<RunLootLine[] | null>(null);
  useEffect(() => {
    if (runId == null) return;
    let vivo = true;
    setBotin(null);
    const cmd = fuente === "run" ? "run_loot_list" : "exploration_loot_list";
    // El nombre del parámetro también cambia: Tauri convierte `run_id`/`log_id` a camelCase.
    const args = fuente === "run" ? { runId } : { logId: runId };
    invoke<RunLootLine[]>(cmd, args)
      .then((r) => {
        if (vivo) setBotin(r);
      })
      // Si falla, se queda en «no hay»: la ficha entera no se cae por el desglose.
      .catch(() => {
        if (vivo) setBotin([]);
      });
    return () => {
      vivo = false;
    };
  }, [runId, fuente]);

  if (botin == null) return null;
  if (botin.length === 0) {
    // Lo de antes del 2026-09-16 (o del 2026-09-17 en exploración) no tiene desglose porque no se
    // guardaba. Decirlo es mejor que no poner nada: si no, parece que la ficha se dejó algo.
    return hayTotal ? (
      <p className="muted small">
        {fuente === "run"
          ? tr("De esta run solo se guardó el total: el botín objeto a objeto empezó a guardarse después.")
          : tr("De este sitio solo se guardó el total: el botín objeto a objeto empezó a guardarse después. Y el botín repartido en lote tampoco lo tiene, a propósito.")}
      </p>
    ) : null;
  }
  return (
    <div className="esc-det-loot">
      <table className="small sig-table">
        <thead>
          <tr className="sig-th">
            <th>{tr("Item")}</th>
            <th style={{ textAlign: "right" }}>{tr("Cant.")}</th>
            <th style={{ textAlign: "right" }}>{tr("Valor")}</th>
          </tr>
        </thead>
        <tbody>
          {botin.map((l, i) => (
            <tr key={i}>
              <td className="cell-icon">
                {l.type_id != null ? (
                  <img className="run-ship" src={typeIcon(l.type_id, 32)} alt="" style={{ marginLeft: 0, marginRight: "0.3rem" }} />
                ) : null}
                {l.name}
              </td>
              <td style={{ textAlign: "right" }}>{l.qty}</td>
              {/* ★ La procedencia se VE, no se esconde: `~` y atenuado cuando el precio lo puso Koru
                  y no el juego. Sin esta marca, una estimación local se leería como un precio del
                  pegado — el mismo problema que él cazó en una captura cuando el total salía de
                  precios locales y las filas decían «—». Y un BPC dice POR QUÉ no vale nada. */}
              <td style={{ textAlign: "right" }} className={l.isk_src === "koru" ? "muted" : ""}>
                {l.isk_src === "bpc"
                  ? tr("copia de plano")
                  : l.isk == null
                    ? "—"
                    : `${l.isk_src === "koru" ? "~" : ""}${fmtIsk(l.isk)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Las cifras de una run: duración, botín, entrada, nave perdida, la nota y el desglose.
 *  El `<h5>` lo pone quien la monta: escalaciones tiene además el caso «no se registró ninguna run»,
 *  que aquí no puede darse. */
export function ComoFue({ run, runId }: { run: RunDet; runId: number | null }) {
  return (
    <>
      <Dato k={tr("Duración")} v={duracionDeRun(run)} />
      <Dato k={tr("Oleadas alcanzadas")} v={run.waves != null ? String(run.waves) : null} />
      <Dato k={tr("Rampancy al entrar")} v={run.rampancy != null ? String(run.rampancy) : null} />
      <Dato k={tr("Botín")} v={run.loot_isk != null ? fmtIsk(run.loot_isk) : null} tone="pos" />
      <Dato k={tr("Coste de entrada")} v={run.entry_cost != null ? fmtIsk(run.entry_cost) : null} tone="neg" />
      <Dato k={tr("Nave perdida")} v={run.ship_loss_isk != null ? fmtIsk(run.ship_loss_isk) : null} tone="neg" />
      {/* ★ LA NOTA DEL BOTÍN, DESTACADA. En escalaciones era un campo de SOLO ESCRITURA —Koru te la
          pedía al cerrar y no te la devolvía en ninguna pantalla—; en abismos y CRAB directamente se
          tiraba, a propósito, por no tener dónde enseñarla. Desde hoy se guarda en las tres. */}
      {run.loot_note ? (
        <div className="esc-det-nota">
          <span className="esc-det-k">{tr("Nota del botín")}</span>
          <div>{run.loot_note}</div>
        </div>
      ) : null}
      <BotinDesglose runId={runId} hayTotal={run.loot_isk != null} />
    </>
  );
}

/** Quién voló, con su nave y lo que le costó morirse.
 *
 *  `duenoId` = quien REGISTRÓ la run (en abismos y CRAB, quien lanzó la baliza; en escalaciones, de
 *  quién era). Va marcado porque con multibox es la pregunta que se hace uno al mirar la fila. */
export function QuienFue({
  parts,
  duenoId,
  marcaDueno,
  charName,
  shipName,
}: {
  parts: NonNullable<RunDet["chars"]>;
  duenoId: number | null;
  marcaDueno: string;
  charName: (id: number) => string;
  shipName: (id: number) => string;
}) {
  if (parts.length === 0) return null;
  return (
    <div className="esc-det-sec">
      <h5>{tr("Quién fue")}</h5>
      {parts.map((p) => {
        const muerto = p.outcome === "dead";
        return (
          <div className="esc-det-fila" key={p.character_id}>
            <span>
              <img
                src={`https://images.evetech.net/characters/${p.character_id}/portrait?size=32`}
                alt=""
                width={18}
                height={18}
                style={{ borderRadius: "50%", verticalAlign: "-4px", marginRight: "0.35rem" }}
              />
              {charName(p.character_id)}
              {p.character_id === duenoId ? (
                <span className="muted small"> · {marcaDueno}</span>
              ) : null}
            </span>
            <span className={muerto ? "kpi-neg" : ""}>
              {p.ship_type_id != null ? (
                <img
                  src={typeIcon(p.ship_type_id, 32)}
                  alt=""
                  width={18}
                  height={18}
                  style={{ verticalAlign: "-4px", marginRight: "0.3rem" }}
                  title={shipName(p.ship_type_id)}
                />
              ) : null}
              {p.ship_type_id != null ? shipName(p.ship_type_id) : ""}
              {muerto ? ` · 💀${p.lost_value ? ` ${fmtIsk(p.lost_value)}` : ""}` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** El bloque de borrar, con su confirmación en línea.
 *
 *  ★ AQUÍ Y NO EN UN 🗑 POR FILA. La fila del histórico entera abre la ficha, así que un icono de
 *    borrar dentro de ella pondría el accidente a un clic del gesto normal. Obligar a abrir la run
 *    primero significa que la ves antes de borrarla.
 *  ★ Y CONFIRMACIÓN CORTA, no el panel rojo del borrado de personaje: aquello es irreversible y se
 *    lleva años de datos, esto es una fila. Un aviso desproporcionado enseña a ignorar los avisos. */
export function BloqueBorrar({
  etiqueta,
  aviso,
  onBorrar,
}: {
  etiqueta: string;
  aviso: string;
  onBorrar: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  return (
    <div className="esc-det-sec esc-det-borrar">
      {!confirmando ? (
        <button className="esc-det-del" onClick={() => setConfirmando(true)}>
          🗑 {etiqueta}
        </button>
      ) : (
        <div className="esc-det-fila">
          <span className="small">{aviso}</span>
          <span>
            <button className="esc-det-del confirma" onClick={onBorrar}>
              {tr("Borrar")}
            </button>{" "}
            <button onClick={() => setConfirmando(false)}>{tr("Cancelar")}</button>
          </span>
        </div>
      )}
    </div>
  );
}

/** ★★ LA FICHA DE UNA RUN DE ABISMO O CRAB.
 *
 *  Decisión de RoGiz7 (2026-09-16): **la fila entera del histórico abre esto, y editar y borrar
 *  viven dentro**, como en escalaciones. Le cuesta un clic más corregir un botín; a cambio, las dos
 *  pantallas se abren igual y el borrado deja de estar pegado al gesto normal.
 *
 *  Se monta por PORTAL en <body> por el mismo motivo que los demás modales: las secciones van dentro
 *  de `.panel-art-wrap`, que con `isolation: isolate` dejaría la ventana presa. */
export function RunDetalle({
  run,
  titulo,
  color,
  lootIndex,
  charName,
  shipName,
  onGuardado,
  onBorrar,
  onClose,
}: {
  run: ActivityRun;
  /** La cabecera la pone quien la monta: el filamento con su tier y su clima, o la baliza. La ficha
   *  no sabe de filamentos y no tiene por qué. */
  titulo: React.ReactNode;
  /** Color del desenlace, para la barra de la cabecera. */
  color: string;
  lootIndex: LootIndex;
  charName: (id: number) => string;
  shipName: (id: number) => string;
  /** Se ha guardado algo: quien monta recarga el histórico. La ficha NO se cierra sola — corregir
   *  una cifra y perder de vista lo que estabas mirando es el gesto contrario al que se pidió. */
  onGuardado: () => void;
  onBorrar: () => void;
  onClose: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [eLoot, setELoot] = useState("");
  const [eEntry, setEEntry] = useState("");
  const [eWaves, setEWaves] = useState("");
  const [eShip, setEShip] = useState("");
  const [eNota, setENota] = useState("");
  /** Vacío = no se ha pegado nada en esta edición, y entonces NO se llama a `run_loot_set`, que
   *  REEMPLAZA: corregir el ISK a mano de una run que ya tenía desglose no debe borrárselo. */
  const [eBotin, setEBotin] = useState<RunLootLine[]>([]);
  const [lootOpen, setLootOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  function empezar() {
    setELoot(iskCorto(run.loot_isk));
    setEEntry(iskCorto(run.entry_cost));
    setEWaves(run.waves != null ? String(run.waves) : "");
    setEShip(iskCorto(run.ship_loss_isk));
    setENota(run.loot_note ?? "");
    setEBotin([]);
    setEditando(true);
  }

  async function guardar() {
    setBusy(true);
    setMsg("");
    try {
      await invoke("run_set", {
        id: run.id,
        lootIsk: parseIskShorthand(eLoot),
        // La nota se manda SIEMPRE, también vacía: así se puede borrar una nota equivocada. Vacío
        // viaja como null y no como "", que en la ficha se pintaría igual pero en la BD no.
        lootNote: eNota.trim() || null,
        shipLossIsk: run.outcome === "died" ? parseIskShorthand(eShip) : (run.ship_loss_isk ?? null),
        note: null,
        entryCost: parseIskShorthand(eEntry),
        // Oleadas: solo tiene sentido en el Fabricador; en las demás el campo no se pinta y viaja
        // null, que en Rust es «no tocar».
        waves: run.activity === "fabricator" && eWaves.trim() !== "" ? Math.max(0, Math.floor(Number(eWaves))) : null,
      });
      if (eBotin.length > 0) {
        try {
          await invoke("run_loot_set", { runId: run.id, items: eBotin });
        } catch (e) {
          setMsg(`${tr("Se guardó el total, pero no el detalle del botín")}: ${String(e).slice(0, 120)}`);
        }
      }
      setEBotin([]);
      setEditando(false);
      onGuardado();
    } catch (e) {
      setMsg(`${tr("Error")}: ${String(e).slice(0, 160)}`);
    } finally {
      setBusy(false);
    }
  }

  // Si la run no tiene tabla hija, el que la registró es el único que voló.
  const parts: RunChar[] = run.chars?.length
    ? run.chars
    : run.character_id != null
      ? [{ character_id: run.character_id, outcome: run.outcome === "died" ? "dead" : "ok", ship_type_id: run.ship_type_id, lost_value: run.ship_loss_isk ?? 0 }]
      : [];

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal esc-det" onClick={(e) => e.stopPropagation()} style={{ borderTop: `3px solid ${color}` }}>
        <div className="loot-modal-head">
          <strong>{titulo}</strong>
          <button className="loot-modal-x" onClick={onClose} title={tr("Cerrar")}>
            ✕
          </button>
        </div>

        <div className="esc-det-sec">
          <Dato k={tr("Fecha")} v={fechaCorta(run.ended_at ?? run.started_at)} />
          <Dato k={tr("Sistema")} v={run.system_name} />
          <Dato
            k={tr("Resultado")}
            v={run.outcome === "died" ? `💀 ${tr("Muerto")}` : run.outcome === "aborted" ? `✕ ${tr("Abortada")}` : `✓ ${tr("Completada")}`}
            tone={run.outcome === "died" ? "neg" : undefined}
          />
        </div>

        <div className="esc-det-sec">
          <h5>{tr("Cómo fue")}</h5>
          {!editando ? (
            <>
              <ComoFue run={run} runId={run.id} />
              {/* Una run abortada no tiene botín que corregir: si no se puede editar, no se pinta el
                  botón y el motivo va en el hueco. Un botón DESHABILITADO no recibe eventos de ratón
                  en WebView2, así que su `title` no se ve nunca — le pasó a RoGiz7 justo con estas. */}
              {run.outcome === "aborted" ? (
                <p className="muted small">
                  {tr("Una run abortada no tiene botín que corregir. Si te equivocaste al cerrarla, bórrala y vuelve a registrarla.")}
                </p>
              ) : (
                <button className="sig-done-btn" onClick={empezar} disabled={busy}>
                  ✏️ {tr("Editar")}
                </button>
              )}
            </>
          ) : (
            <>
              <div className="esc-det-fila">
                <span className="esc-det-k">{tr("Botín")}</span>
                <span>
                  <input className="small" value={eLoot} onChange={(e) => setELoot(e.target.value)} placeholder={tr("ISK (p.ej. 45m)")} style={{ width: 110 }} />
                  <button className="sig-done-btn" title={tr("Pegar loot")} onClick={() => setLootOpen(true)}>📋</button>
                </span>
              </div>
              {run.activity === "fabricator" ? (
                <div className="esc-det-fila">
                  <span className="esc-det-k">{tr("Oleadas alcanzadas")}</span>
                  <input className="small" type="number" min={0} max={100} value={eWaves} onChange={(e) => setEWaves(e.target.value)} style={{ width: 80 }} />
                </div>
              ) : (
                <div className="esc-det-fila">
                  <span className="esc-det-k">{tr("Coste de entrada")}</span>
                  <input className="small" value={eEntry} onChange={(e) => setEEntry(e.target.value)} placeholder={tr("ISK")} style={{ width: 110 }} />
                </div>
              )}
              {run.outcome === "died" && (
                <div className="esc-det-fila">
                  <span className="esc-det-k">{tr("Nave perdida")}</span>
                  <input className="small" value={eShip} onChange={(e) => setEShip(e.target.value)} placeholder={tr("ISK")} style={{ width: 110 }} />
                </div>
              )}
              <div className="esc-det-fila">
                <span className="esc-det-k">{tr("Nota del botín")}</span>
                <input className="small" value={eNota} onChange={(e) => setENota(e.target.value)} style={{ width: 200 }} />
              </div>
              {eBotin.length > 0 && (
                <p className="muted small">
                  {tr("Se guardará también el botín pegado")}: {eBotin.length} {tr("líneas")}
                </p>
              )}
              <div className="esc-det-fila">
                <span />
                <span>
                  <button className="sig-done-btn" title={tr("Guardar")} onClick={() => void guardar()} disabled={busy}>✓</button>
                  <button className="sig-done-btn" title={tr("Cancelar")} onClick={() => setEditando(false)} disabled={busy}>✕</button>
                </span>
              </div>
            </>
          )}
        </div>

        <QuienFue
          parts={parts}
          duenoId={run.character_id}
          marcaDueno={tr("lanzó la run")}
          charName={charName}
          shipName={shipName}
        />

        <BloqueBorrar
          etiqueta={tr("Borrar esta run")}
          aviso={tr("Se borra la run con el botín que tuviera anotado.")}
          onBorrar={onBorrar}
        />

        {msg && <div className="small muted">{msg}</div>}

        <LootPasteModal
          open={lootOpen}
          siteCount={1}
          index={lootIndex}
          busy={busy}
          title={tr("Botín de la run")}
          confirmLabel={tr("Usar botín")}
          onCancel={() => setLootOpen(false)}
          onConfirm={(isk, nota, lineas) => {
            if (isk != null) setELoot(iskCorto(isk));
            // La nota ya NO se tira: desde hoy hay dónde enseñarla. Solo pisa lo que hubiera si el
            // modal devolvió algo — confirmar sin escribir nota no debe borrar la que ya tenías.
            if (nota.trim()) setENota(nota);
            setEBotin(lineas);
            setLootOpen(false);
          }}
        />
      </div>
    </div>,
    document.body,
  );
}
