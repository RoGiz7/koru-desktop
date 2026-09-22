import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getLang, tr } from "./i18n";
import { fmtAgo, fmtSp, secColor, typeIcon } from "./format";
import { Kpi } from "./charts";
import { loadNewEden } from "./neweden";
import { openExternal } from "./openExternal";
import { loadJson } from "./staticJson";
import { PilotoNombre } from "./fichaPiloto";

/** ★ ICONOGRAFÍA EVE (regla suya, 2026-07-29): antes de poner un emoji, buscar el objeto de EVE
 *  que representa la cosa — y **reutilizar el typeID que la app ya usa para ese concepto**, para
 *  reforzar un vocabulario en vez de inventar otro. Los tres verificados contra
 *  `public/market_types.json`.
 *
 *  Los que se quedan en emoji, y por qué: 🚀 (la lista de debajo YA son iconos de nave reales,
 *  repetirlo arriba es ruido) y 🔥 «horas activas» (el tiempo es abstracto, EVE no tiene un objeto
 *  para eso). El límite ya decidido dice que el chrome abstracto se queda en emoji. */
const TID_KILLS = 587; // Rifter — el mismo que la Bitácora usa para «Kills del mes»
const TID_GENTE = 3355; // Social (skillbook) — el que ya significa «tratar con gente» en la app
const TID_SISTEMAS = 30488; // Sisters Core Scanner Probe — el de «sistemas distintos con kills»
// Pod, elegido por él: «creo que quedará mejor y es fino al ser pequeño». Y además es el
// `TID_CAPSULE` que Abyssals ya usa, así que refuerza el vocabulario en vez de inventar otro.
const TID_NAVES = 670; // Capsule

/** Retrato de un piloto por su id, con hueco reservado para que la fila no salte al cargar. */
function Retrato({ id, size = 22 }: { id: number | null | undefined; size?: number }) {
  if (id == null || id <= 0) return <span className="intel-hab-noimg cz-sinretrato">?</span>;
  return (
    <img
      className="cz-retrato"
      src={`https://images.evetech.net/characters/${id}/portrait?size=64`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
    />
  );
}

/** Icono de EVE para una cabecera de sección. `alt` vacío: el texto de al lado ya lo dice. */
function IconoEve({ tid, size = 18 }: { tid: number; size?: number }) {
  return <img className="cz-ico" src={typeIcon(tid, 32)} alt="" width={size} height={size} />;
}

type Habitual = {
  name_lower: string;
  character_id: number | null;
  name: string;
  /** MENCIONES. Disparador interno, no cifra de usuario — ver `name_cache_habitual` en Rust. */
  seen_count: number;
  /** AVISTAMIENTOS: la cifra que manda. Es la misma que el KPI de la ficha, así que la lista y la
   *  ficha ya no pueden discrepar — antes salían «×186» y «156» y se leían igual. */
  sightings: number;
  last_seen: string | null;
  last_system_id: number | null;
};
// Los nombres de nave de ship_names.json vienen en minúsculas (para el matching del parser);
// los capitalizamos para mostrarlos ("dark blood exequror" → "Dark Blood Exequror").
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

type CountItem = { id: number; count: number };
type VsPersona = { character_id: number; name: string | null; count: number };
type PilotVs = {
  te_mato: number;
  le_mataste: number;
  peleas: number;
  dano_recibido: number;
  mediana_atacantes: number | null;
  max_atacantes: number | null;
  naves: CountItem[];
  acompanantes: VsPersona[];
  ultima: string | null;
};
type PilotProfile = {
  name: string;
  character_id: number | null;
  total: number;
  first_ms: number | null;
  last_ms: number | null;
  by_system: CountItem[];
  by_ship: CountItem[];
  by_hour: number[];
  vs: PilotVs | null;
};

// ---- ★ EL SISTEMA COMO SUJETO (2026-09-19) ----
// La pregunta del cazador al revés. La ficha del hostil dice «¿dónde anda éste?»; esto dice
// «¿quién pasa por AQUÍ, a qué horas y en qué?». Sus palabras: *«si el cazador tiene el sistema y
// puede ver los picos de horas y hostiles además de las naves, entonces puede decidir si el
// sistema está caliente para su actividad o no y sigue buscando»*.
//
// ★★ Y TODO SALE DE LAS FILAS CRUDAS (`get_system_sightings`), no de totales. Idea suya al ver la
// primera versión: *«¿trasladar los pilotos y las naves a la gráfica?»*. La forma buena no es
// dibujar nombres dentro del mapa de calor, es ENLAZAR: pinchar una celda, un día, una hora o una
// columna del tiempo FILTRA las listas de abajo; pasar el ratón por un piloto o una nave ILUMINA
// sus celdas y sus columnas. Para eso hace falta la fila, y con la fila en pantalla los agregados
// se calculan aquí: una sola fuente, así gráficas y listas no pueden discrepar.
type IntelSystemRow = { system_id: number; sightings: number; hostiles: number; last_ms: number };
/** UNA fila de avistamiento, la unidad de todo el bloque enlazado. En la ficha de sistema lleva
 *  el piloto (`name`); en la del hostil lleva el sistema (`system_id`). Nave y hora, siempre. */
type Fila = { name?: string; character_id?: number | null; system_id?: number; ship_type_id: number | null; ts_ms: number };
type SystemSightings = { system_id: number; rows: Fila[]; truncado: boolean };
type PilotSightings = { rows: Fila[]; truncado: boolean };

const DIAS_SEMANA = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const DIAS_SEMANA_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Fecha → `YYYY-MM-DD` en UTC. */
const isoDia = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DIA_MS = 86400000;
const HORA_MS = 3600000;
/** Día de la semana UTC con 0 = lunes: `+3` porque el 1970-01-01 fue jueves. */
const diaSemanaUtc = (ms: number) => (Math.floor(ms / DIA_MS) + 3) % 7;
const horaUtc = (ms: number) => Math.floor(ms / HORA_MS) % 24;
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** La ventana del Cazador por sistema. Es UNA para la lista y la ficha: si cada una tuviera la
 *  suya, el ×N de la izquierda y el KPI de la derecha hablarían de periodos distintos y el mismo
 *  sistema enseñaría dos cifras. `0` = todo el histórico. */
export type VentanaDias = 7 | 30 | 90 | 0;
type OrdenHostiles = "count" | "recent" | "name" | "mentions";
type OrdenSistemas = "count" | "hostiles" | "recent" | "name" | "region" | "sec";
const VENTANAS: VentanaDias[] = [7, 30, 90, 0];

/** Lo que el cazador ha PINCHADO en una gráfica. Filtra las listas de abajo. */
type Seleccion =
  | { tipo: "celda"; wd: number; h: number }
  | { tipo: "dia"; wd: number }
  | { tipo: "hora"; h: number }
  | { tipo: "columna"; desdeDia: number; hastaDia: number; etiqueta: string };
/** Lo que tiene el ratón encima en una lista. Ilumina las gráficas. */
type Resalte = { tipo: "piloto"; name: string } | { tipo: "nave"; id: number } | { tipo: "sistema"; id: number } | null;

const cumpleSeleccion = (r: Fila, sel: Seleccion | null): boolean => {
  if (!sel) return true;
  switch (sel.tipo) {
    case "celda": return diaSemanaUtc(r.ts_ms) === sel.wd && horaUtc(r.ts_ms) === sel.h;
    case "dia": return diaSemanaUtc(r.ts_ms) === sel.wd;
    case "hora": return horaUtc(r.ts_ms) === sel.h;
    case "columna": {
      const d = Math.floor(r.ts_ms / DIA_MS);
      return d >= sel.desdeDia && d <= sel.hastaDia;
    }
  }
};
const cumpleResalte = (r: Fila, res: Resalte): boolean => {
  if (!res) return true;
  if (res.tipo === "piloto") return r.name === res.name;
  if (res.tipo === "nave") return r.ship_type_id === res.id;
  return r.system_id === res.id;
};

/** ★ LA SERIE EN EL TIEMPO COMO COLUMNAS, CON LOS HUECOS A LA VISTA.
 *
 *  La primera versión era una barra horizontal por día CON DATOS, y pegaba el 09-10 al 09-16 como
 *  si fueran seguidos cuando en medio hubo cinco días sin nada. Un hueco tiene que verse como
 *  hueco — es la regla del rastro del hostil, aquí también. Así que se rellenan TODOS los días de
 *  la ventana, los vacíos como suelo tenue (`vacia`), con las mismas columnas que las horas.
 *
 *  Grano: días hasta ~4 meses, semanas hasta ~2 años, meses de ahí en adelante. Al agrupar, los
 *  cubos vacíos se conservan igual: una semana sin nada también es un hueco.
 *
 *  Pinchar una columna la SELECCIONA (filtra las listas); la parte resaltada de cada columna es la
 *  del piloto o la nave que tenga el ratón encima en la lista. */
function ColumnasTiempo({
  rows,
  desdeMs,
  hastaMs,
  seleccion,
  onSeleccion,
  resalte,
}: {
  rows: Fila[];
  desdeMs: number;
  hastaMs: number;
  seleccion: Seleccion | null;
  onSeleccion: (s: Seleccion | null) => void;
  resalte: Resalte;
}) {
  const cols = useMemo(() => {
    const d0 = Math.floor(desdeMs / DIA_MS);
    const d1 = Math.floor(hastaMs / DIA_MS);
    type Col = { label: string; largo: string; desdeDia: number; hastaDia: number; value: number; res: number };
    if (d1 < d0) return [] as Col[];
    const dias = d1 - d0 + 1;
    const grano: "dia" | "semana" | "mes" = dias <= 120 ? "dia" : dias <= 730 ? "semana" : "mes";
    const out: Col[] = [];
    if (grano === "dia") {
      for (let d = d0; d <= d1; d++) {
        const iso = isoDia(d * DIA_MS);
        out.push({ label: iso.slice(8, 10), largo: iso, desdeDia: d, hastaDia: d, value: 0, res: 0 });
      }
    } else if (grano === "semana") {
      // Empieza en el lunes de la primera semana para que las columnas sean semanas de verdad.
      for (let d = d0 - diaSemanaUtc(d0 * DIA_MS); d <= d1; d += 7) {
        const iso = isoDia(d * DIA_MS);
        out.push({ label: iso.slice(5, 10), largo: `${tr("semana del")} ${iso}`, desdeDia: d, hastaDia: d + 6, value: 0, res: 0 });
      }
    } else {
      let d = d0;
      while (d <= d1) {
        const f = new Date(d * DIA_MS);
        const fin = Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 1) / DIA_MS - 1;
        const k = isoDia(d * DIA_MS).slice(0, 7);
        out.push({ label: k.slice(2), largo: k, desdeDia: d, hastaDia: Math.min(fin, d1), value: 0, res: 0 });
        d = fin + 1;
      }
    }
    // Una pasada por las filas: a qué columna cae cada una. Las columnas son contiguas y
    // ordenadas, así que se localiza por aritmética o por bisección, no recorriéndolas por fila.
    const primeraDia = out[0].desdeDia;
    const idxDe = (dia: number) => {
      if (grano === "dia") return dia - primeraDia;
      if (grano === "semana") return Math.floor((dia - primeraDia) / 7);
      let lo = 0, hi = out.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (out[mid].desdeDia <= dia) lo = mid; else hi = mid - 1;
      }
      return lo;
    };
    for (const r of rows) {
      const i = idxDe(Math.floor(r.ts_ms / DIA_MS));
      if (i < 0 || i >= out.length) continue;
      out[i].value++;
      if (resalte && cumpleResalte(r, resalte)) out[i].res++;
    }
    return out;
  }, [rows, desdeMs, hastaMs, resalte]);

  if (cols.length === 0) return <p className="muted small">Sin datos.</p>;
  const max = Math.max(...cols.map((c) => c.value), 1);
  const cada = Math.max(1, Math.ceil(cols.length / 8));
  return (
    <div className="hourbars big cz-cols">
      {cols.map((c, i) => {
        const activa =
          seleccion?.tipo === "columna" && seleccion.desdeDia === c.desdeDia && seleccion.hastaDia === c.hastaDia;
        return (
          <div
            key={c.largo}
            className={`hourbar cz-col${c.value === 0 ? " vacia" : ""}${activa ? " sel" : ""}${resalte && c.res === 0 && c.value > 0 ? " apagada" : ""}`}
            data-v={`${c.largo} · ${c.value}${resalte ? ` · ${c.res}` : ""}`}
            title={`${c.largo} · ${c.value}`}
            onClick={() =>
              onSeleccion(activa ? null : { tipo: "columna", desdeDia: c.desdeDia, hastaDia: c.hastaDia, etiqueta: c.largo })
            }
          >
            <div className="hourbar-fill" style={{ height: `${(c.value / max) * 100}%` }}>
              {resalte && c.res > 0 && (
                <div className="cz-col-res" style={{ height: `${(c.res / c.value) * 100}%` }} />
              )}
            </div>
            <span className="hourbar-lbl">{i % cada === 0 ? c.label : ""}</span>
          </div>
        );
      })}
    </div>
  );
}

/** ★★ EL MAPA DE CALOR día de la semana × hora UTC — la gráfica única de «cuándo».
 *
 *  Idea suya al ver la primera versión (dos histogramas sueltos, horas y días): *«¿una sola
 *  gráfica con toda la información? ganamos espacio y damos más sentido»*. Y da más sentido de
 *  verdad: «lunes a las 20» y «domingo a las 20» son cosas distintas para un cazador, y los dos
 *  histogramas por separado no lo podían decir. Aquí cada celda es exactamente eso.
 *
 *  ⚠️ LA n VA AL LADO DE CADA DÍA. Con 30 días cada fila son cuatro lunes: una flota un lunes
 *  pinta la fila entera. La primera versión enseñaba «lun 74» sin decir que era un solo lunes de
 *  33. Ahora cada fila dice cuántos de ese día caben en la ventana, y el globo da el total de la
 *  celda: el que mira decide cuánto fiarse, con el dato delante.
 *
 *  Pinchar: una celda, la etiqueta de un día (toda la fila) o la de una hora (toda la columna).
 *  Con un piloto o una nave resaltados desde la lista, sus celdas se marcan y el resto se apaga. */
function MapaCalor({
  rows,
  desdeMs,
  hastaMs,
  seleccion,
  onSeleccion,
  resalte,
}: {
  rows: Fila[];
  desdeMs: number;
  hastaMs: number;
  seleccion: Seleccion | null;
  onSeleccion: (s: Seleccion | null) => void;
  resalte: Resalte;
}) {
  const nombres = getLang() === "en" ? DIAS_SEMANA_EN : DIAS_SEMANA;
  const nPorDia = useMemo(() => {
    const n = [0, 0, 0, 0, 0, 0, 0];
    const d0 = Math.floor(desdeMs / DIA_MS);
    const d1 = Math.floor(hastaMs / DIA_MS);
    for (let d = d0; d <= d1; d++) n[diaSemanaUtc(d * DIA_MS)]++;
    return n;
  }, [desdeMs, hastaMs]);
  const { grid, res } = useMemo(() => {
    const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    const res = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    for (const r of rows) {
      const wd = diaSemanaUtc(r.ts_ms);
      const h = horaUtc(r.ts_ms);
      grid[wd][h]++;
      if (resalte && cumpleResalte(r, resalte)) res[wd][h]++;
    }
    return { grid, res };
  }, [rows, resalte]);
  const max = Math.max(1, ...grid.flat());
  const ahoraH = horaUtc(Date.now());
  const ahoraD = diaSemanaUtc(Date.now());
  const totalDia = (fila: number[]) => fila.reduce((s, v) => s + v, 0);
  const selDia = seleccion?.tipo === "dia" ? seleccion.wd : -1;
  const selHora = seleccion?.tipo === "hora" ? seleccion.h : -1;
  return (
    <div className="cz-calor">
      <div className="cz-calor-fila cz-calor-cab">
        <span className="cz-calor-dia" />
        {Array.from({ length: 24 }, (_, h) => (
          <button
            key={h}
            className={`cz-calor-h${h === ahoraH ? " ahora" : ""}${selHora === h ? " sel" : ""}`}
            title={`${hh(h)} UTC · ${tr("filtrar por esta hora")}`}
            onClick={() => onSeleccion(selHora === h ? null : { tipo: "hora", h })}
          >
            {h % 3 === 0 || selHora === h ? h : ""}
          </button>
        ))}
        <span className="cz-calor-tot muted">Σ</span>
      </div>
      {grid.map((fila, d) => (
        <div key={d} className={`cz-calor-fila${d === ahoraD ? " hoy" : ""}`}>
          <button
            className={`cz-calor-dia${selDia === d ? " sel" : ""}`}
            title={`${nPorDia[d]} ${nombres[d]} ${tr("en la ventana")} · ${tr("filtrar por este día")}`}
            onClick={() => onSeleccion(selDia === d ? null : { tipo: "dia", wd: d })}
          >
            {nombres[d]} <span className="muted">·{nPorDia[d]}</span>
          </button>
          {fila.map((v, h) => {
            const activa = seleccion?.tipo === "celda" && seleccion.wd === d && seleccion.h === h;
            const enSel = !seleccion || activa || selDia === d || selHora === h || seleccion.tipo === "columna";
            const apagada = (resalte && v > 0 && res[d][h] === 0) || (!enSel && v > 0);
            const intensidad = resalte && res[d][h] > 0 ? res[d][h] / max : v / max;
            return (
              <span
                key={h}
                className={`cz-calor-celda${v === 0 ? " vacia" : ""}${h === ahoraH ? " ahora" : ""}${activa ? " sel" : ""}${apagada ? " apagada" : ""}`}
                style={v > 0 ? { background: `rgba(255, 106, 213, ${0.18 + 0.82 * intensidad})` } : undefined}
                data-v={`${nombres[d]} ${hh(h)} UTC · ${v}${resalte ? ` · ${res[d][h]}` : ""}`}
                title={`${nombres[d]} ${hh(h)} UTC · ${v}`}
                onClick={() => onSeleccion(activa ? null : { tipo: "celda", wd: d, h })}
              />
            );
          })}
          <span className="cz-calor-tot">{totalDia(fila) || ""}</span>
        </div>
      ))}
    </div>
  );
}

/** El texto de la selección, para la cabecera de las listas y el botón de quitarla. */
function textoSeleccion(sel: Seleccion, nombres: string[]): string {
  switch (sel.tipo) {
    case "celda": return `${nombres[sel.wd]} ${hh(sel.h)} UTC`;
    case "dia": return nombres[sel.wd];
    case "hora": return `${hh(sel.h)} UTC`;
    case "columna": return sel.etiqueta;
  }
}

/** ★★ EL BLOQUE ENLAZADO — gráficas y listas de UNA misma lista de filas, atadas entre sí.
 *
 *  Lo comparten la ficha de SISTEMA (filas con piloto) y la ficha del HOSTIL (filas con sistema):
 *  mapa de calor día × hora, columnas en el tiempo con los huecos a la vista, y dos listas debajo
 *  — quién/dónde según el sujeto, y las naves. Pinchar en una gráfica FILTRA las listas; pasar el
 *  ratón por una lista ILUMINA las gráficas. Una sola implementación para que las dos fichas se
 *  lean igual: la misma forma, el mismo gesto.
 *
 *  `sujeto` dice qué va en la lista de la izquierda: en un sistema, los pilotos que pasan; en un
 *  hostil, los sistemas por los que pasa. */
function BloqueEnlazado({
  rows,
  ventana,
  truncado,
  sujeto,
  sysNames,
  shipNames,
  onHostil,
  onSistema,
}: {
  rows: Fila[];
  ventana: { desde: number; hasta: number };
  truncado: boolean;
  sujeto: "pilotos" | "sistemas";
  sysNames: Map<number, string>;
  shipNames: Map<number, string>;
  onHostil?: (name: string) => void;
  onSistema?: (sysId: number) => void;
}) {
  const [seleccion, setSeleccion] = useState<Seleccion | null>(null);
  const [resalte, setResalte] = useState<Resalte>(null);
  const nombres = getLang() === "en" ? DIAS_SEMANA_EN : DIAS_SEMANA;
  // Al cambiar las filas (otra ventana, otro sujeto) la selección deja de significar lo mismo.
  useEffect(() => {
    setSeleccion(null);
    setResalte(null);
  }, [rows]);
  // Esc quita el filtro. Solo se escucha mientras hay algo que quitar.
  useEffect(() => {
    if (!seleccion) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSeleccion(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [seleccion]);

  const filtradas = useMemo(() => rows.filter((r) => cumpleSeleccion(r, seleccion)), [rows, seleccion]);
  /** La lista de la izquierda: pilotos (por nombre) o sistemas (por id), con su nave más vista. */
  const izquierda = useMemo(() => {
    type Ent = { clave: string; name: string; id: number | null; sysId: number | null; count: number; last: number; naves: Map<number, number> };
    const m = new Map<string, Ent>();
    for (const r of filtradas) {
      const clave = sujeto === "pilotos" ? (r.name ?? "").toLowerCase() : String(r.system_id ?? 0);
      if (!clave || clave === "0") continue;
      let e = m.get(clave);
      if (!e) {
        e = {
          clave,
          name: sujeto === "pilotos" ? (r.name ?? "") : (sysNames.get(r.system_id!) ?? `#${r.system_id}`),
          id: r.character_id ?? null,
          sysId: r.system_id ?? null,
          count: 0,
          last: 0,
          naves: new Map(),
        };
        m.set(clave, e);
      }
      e.count++;
      if (r.ts_ms > e.last) e.last = r.ts_ms;
      if (e.id == null && r.character_id != null) e.id = r.character_id;
      if (r.ship_type_id != null) e.naves.set(r.ship_type_id, (e.naves.get(r.ship_type_id) ?? 0) + 1);
    }
    return [...m.values()].sort((a, b) => b.count - a.count || b.last - a.last).slice(0, 25);
  }, [filtradas, sujeto, sysNames]);
  const naves = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of filtradas) if (r.ship_type_id != null) m.set(r.ship_type_id, (m.get(r.ship_type_id) ?? 0) + 1);
    return [...m.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count).slice(0, 12);
  }, [filtradas]);
  const nombreNave = (id: number) => (shipNames.has(id) ? titleCase(shipNames.get(id)!) : `#${id}`);

  return (
    <>
      {truncado && (
        <p className="muted small">
          {tr("Se enseñan los 20.000 más recientes: antes de esa fecha no es que no hubiera nada, es que no se está mirando.")}
        </p>
      )}
      <div className="cazador-sec">
        <h4>
          🔥 {tr("Cuándo (día de la semana × hora UTC)")}
          <span className="muted small cz-pista"> · {tr("pincha una celda, un día o una hora para filtrar")}</span>
        </h4>
        <MapaCalor rows={rows} desdeMs={ventana.desde} hastaMs={ventana.hasta} seleccion={seleccion} onSeleccion={setSeleccion} resalte={resalte} />
      </div>
      <div className="cazador-sec">
        <h4>📈 {tr("En el tiempo")}</h4>
        <ColumnasTiempo rows={rows} desdeMs={ventana.desde} hastaMs={ventana.hasta} seleccion={seleccion} onSeleccion={setSeleccion} resalte={resalte} />
      </div>

      {/* La cabecera de la selección, UNA para las dos listas: dice qué se está mirando y cómo
          volver a todo. Sin esto una lista corta se leería como «poca gente pasa por aquí». */}
      {seleccion && (
        <div className="cz-selbar">
          <strong>{textoSeleccion(seleccion, nombres)}</strong>
          {" · "}
          <span>{fmtSp(filtradas.length)} {tr("de")} {fmtSp(rows.length)} {tr("avistamientos")}</span>
          <button className="intel-head-link" onClick={() => setSeleccion(null)}>{tr("quitar filtro")}</button>
        </div>
      )}

      <div className="cazador-grid">
        <div className="cazador-sec">
          <h4>
            {sujeto === "pilotos"
              ? <><IconoEve tid={TID_GENTE} /> {tr("Quién pasa por aquí")}</>
              : <><IconoEve tid={TID_SISTEMAS} /> {tr("Por dónde pasa")}</>}
          </h4>
          {izquierda.length === 0 ? (
            <p className="muted small">{tr("Nada con esa selección.")}</p>
          ) : (
            <table className="km-table cat-table cz-tabla-enlazada">
              <tbody>
                {izquierda.map((e) => {
                  // La nave con la que MÁS se le ha visto (solo se atribuye en reportes de un
                  // único piloto, así que puede no haberla).
                  const naveTop = [...e.naves.entries()].sort((a, b) => b[1] - a[1])[0];
                  const res: Resalte = sujeto === "pilotos" ? { tipo: "piloto", name: e.name } : { tipo: "sistema", id: e.sysId ?? 0 };
                  const activo = resalte != null && resalte.tipo === res.tipo &&
                    (res.tipo === "piloto" ? (resalte as { name: string }).name === e.name : (resalte as { id: number }).id === e.sysId);
                  return (
                    <tr
                      key={e.clave}
                      className={activo ? "res" : ""}
                      onMouseEnter={() => setResalte(res)}
                      onMouseLeave={() => setResalte(null)}
                    >
                      <td>
                        {sujeto === "pilotos" ? (
                          <>
                            <Retrato id={e.id} size={20} />{" "}
                            {onHostil ? (
                              <button className="linklike" onClick={() => onHostil(e.name)} title={tr("Abrir su ficha")}>{e.name}</button>
                            ) : e.name}
                          </>
                        ) : onSistema && e.sysId != null ? (
                          <button className="linklike" onClick={() => onSistema(e.sysId!)} title={tr("Abrir la ficha del sistema")}>{e.name}</button>
                        ) : e.name}
                      </td>
                      <td>
                        {naveTop && (
                          <img src={typeIcon(naveTop[0], 32)} alt="" width={18} height={18} title={nombreNave(naveTop[0])} style={{ verticalAlign: -4 }} />
                        )}
                      </td>
                      <td className="muted small">{fmtAgo(Date.now() - e.last)}</td>
                      <td style={{ textAlign: "right" }}>×{e.count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="cazador-sec">
          <h4><IconoEve tid={TID_NAVES} /> {tr("Naves reportadas en el intel")}</h4>
          {naves.length === 0 ? (
            <p className="muted small">{tr("Aún sin datos (solo se atribuye en reportes de un único piloto).")}</p>
          ) : (
            <div className="cazador-ships">
              {naves.map((s) => (
                <div
                  className={`cazador-ship cz-fila-enlazada${resalte?.tipo === "nave" && resalte.id === s.id ? " res" : ""}`}
                  key={s.id}
                  title={nombreNave(s.id)}
                  onMouseEnter={() => setResalte({ tipo: "nave", id: s.id })}
                  onMouseLeave={() => setResalte(null)}
                >
                  <img src={typeIcon(s.id, 32)} alt="" width={30} height={30} />
                  <span className="cazador-ship-name">{nombreNave(s.id)}</span>
                  <span className="intel-count fleet">×{s.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/** Una preferencia de vista que se recuerda entre sesiones (orden, ventana). Vive en el
 *  navegador de ESTE piloto: es comodidad de pantalla, no dato. Si el almacén falla o está
 *  vacío, el valor por defecto — nunca un error. */
function usePref<T extends string | number>(clave: string, porDefecto: T, valida: (v: unknown) => v is T) {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`koru-cazador-${clave}`);
      if (raw == null) return porDefecto;
      const parsed: unknown = JSON.parse(raw);
      return valida(parsed) ? parsed : porDefecto;
    } catch {
      return porDefecto;
    }
  });
  const set = (n: T) => {
    setV(n);
    try {
      localStorage.setItem(`koru-cazador-${clave}`, JSON.stringify(n));
    } catch {
      /* sin almacén: se queda en memoria */
    }
  };
  return [v, set] as const;
}
const esVentana = (v: unknown): v is VentanaDias => v === 7 || v === 30 || v === 90 || v === 0;
const esOrdenH = (v: unknown): v is OrdenHostiles => ["count", "recent", "name", "mentions"].includes(v as string);
const esOrdenS = (v: unknown): v is OrdenSistemas => ["count", "hostiles", "recent", "name", "region", "sec"].includes(v as string);

/** Los cuatro botones de ventana, iguales en las dos fichas y en la lista de sistemas. */
function SelectorVentana({ dias, setDias, className = "" }: { dias: VentanaDias; setDias: (d: VentanaDias) => void; className?: string }) {
  return (
    <div className={`seg seg-sm cz-sys-dias ${className}`}>
      {VENTANAS.map((d) => (
        <button key={d} className={dias === d ? "active" : ""} onClick={() => setDias(d)}>
          {d === 0 ? tr("Todo") : `${d} ${tr("días")}`}
        </button>
      ))}
    </div>
  );
}

/** Pide las filas de una ventana y devuelve también la ventana fijada al pedir (no en cada
 *  render: si «ahora» se moviera con cada repintado, la n de los días y la serie bailarían sin que
 *  cambiara ningún dato). Con «Todo», la ventana empieza donde empiezan los datos. */
function useFilasVentana<T extends { rows: Fila[]; truncado: boolean }>(
  comando: string,
  args: Record<string, unknown>,
  dias: VentanaDias,
  clave: string,
) {
  const [datos, setDatos] = useState<T | null>(null);
  const [cargando, setCargando] = useState(false);
  const [ventana, setVentana] = useState<{ desde: number; hasta: number }>({ desde: 0, hasta: Date.now() });
  useEffect(() => {
    let vivo = true;
    setCargando(true);
    const hasta = Date.now();
    const desde = dias === 0 ? 0 : hasta - dias * DIA_MS;
    invoke<T>(comando, { ...args, fromMs: desde || null, toMs: hasta })
      .then((d) => {
        if (!vivo) return;
        setDatos(d);
        const primera = d.rows.length ? d.rows[d.rows.length - 1].ts_ms : hasta;
        setVentana({ desde: dias === 0 ? primera : desde, hasta });
      })
      .catch(() => vivo && setDatos(null))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comando, clave, dias]);
  return { datos, cargando, ventana };
}

/** ★★ LA FICHA DE UN SISTEMA. Todo sale de `get_system_sightings` con la ventana elegida: al mover
 *  la ventana se vuelve a pedir — con seis años de histórico el total no describe ningún momento
 *  real, y lo que decide si un sistema está caliente es «estos días».
 *
 *  La ventana viene de FUERA (la misma que ordena la lista) y se cambia desde aquí también: una
 *  sola, para que el ×N de la izquierda y el KPI de la derecha no puedan hablar de periodos
 *  distintos. Los presets de fecha libres se quitaron por eso mismo.
 *
 *  ⚠️ Lo que se dice en pantalla y no se puede quitar: esto es lo que se CANTÓ en tus canales.
 *  Los huecos son ceguera vuestra, no calma suya — la misma regla que el rastro del hostil. */
function FichaSistema({
  systemId,
  dias,
  setDias,
  sysNames,
  sysInfo,
  vecinos,
  actividad,
  onSistema,
  shipNames,
  onHostil,
  onVerEnMapa,
}: {
  systemId: number;
  dias: VentanaDias;
  setDias: (d: VentanaDias) => void;
  sysNames: Map<number, string>;
  sysInfo: Map<number, { s: number; region: string }>;
  vecinos: Map<number, number[]>;
  actividad: Map<number, IntelSystemRow>;
  onSistema: (sysId: number) => void;
  shipNames: Map<number, string>;
  onHostil: (name: string) => void;
  onVerEnMapa?: (sysId: number) => void;
}) {
  const { datos, cargando, ventana } = useFilasVentana<SystemSightings>(
    "get_system_sightings", { systemId }, dias, String(systemId),
  );
  const rows = datos?.rows ?? [];
  const distintos = useMemo(() => new Set(rows.map((r) => (r.name ?? "").toLowerCase())).size, [rows]);
  const ultimo = rows.length ? rows[0].ts_ms : null;
  // Últimos 7 días frente a la media semanal del periodo: tendencia sin veredicto. Solo tiene
  // sentido con más de una semana de ventana; con 7 días sería comparar la cifra consigo misma.
  const ultimos7 = useMemo(() => {
    const corte = ventana.hasta - 7 * DIA_MS;
    return rows.filter((r) => r.ts_ms >= corte).length;
  }, [rows, ventana]);
  const semanas = (ventana.hasta - ventana.desde) / (7 * DIA_MS);
  const mediaSemanal = semanas > 1 ? rows.length / semanas : null;
  const nombre = sysNames.get(systemId) ?? `#${systemId}`;
  const info = sysInfo.get(systemId);
  /** ★ ALREDEDOR: los sistemas a uno y a dos saltos, con su actividad en la MISMA ventana. Un
   *  sistema se elige también por lo que pasa al lado: el que está tranquilo pero rodeado de
   *  tráfico es donde se caza. Ordenados por actividad; los que no tienen nada cantado salen al
   *  final, con raya — que están, aunque nadie haya dicho nada de ellos. */
  const anillos = useMemo(() => {
    const uno = new Set(vecinos.get(systemId) ?? []);
    const dos = new Set<number>();
    for (const v of uno) for (const w of vecinos.get(v) ?? []) if (w !== systemId && !uno.has(w)) dos.add(w);
    const fila = (id: number) => ({ id, act: actividad.get(id) ?? null });
    const orden = (a: { act: IntelSystemRow | null }, b: { act: IntelSystemRow | null }) =>
      (b.act?.sightings ?? 0) - (a.act?.sightings ?? 0);
    return {
      uno: [...uno].map(fila).sort(orden),
      dos: [...dos].map(fila).sort(orden),
    };
  }, [vecinos, actividad, systemId]);
  const FilaVecino = ({ id, act }: { id: number; act: IntelSystemRow | null }) => {
    const i = sysInfo.get(id);
    return (
      <tr key={id} className={act && Date.now() - act.last_ms < 3600000 ? "viva" : ""}>
        <td>
          <button className="linklike" onClick={() => onSistema(id)} title={tr("Abrir la ficha del sistema")}>
            {sysNames.get(id) ?? `#${id}`}
          </button>
          {i && <span className="small" style={{ color: secColor(i.s) }}> {i.s.toFixed(1)}</span>}
        </td>
        <td className="muted small">{act ? `${fmtSp(act.hostiles)} ${tr("hostiles")}` : ""}</td>
        <td className="muted small">{act ? fmtAgo(Date.now() - act.last_ms) : ""}</td>
        <td style={{ textAlign: "right" }}>{act ? `×${fmtSp(act.sightings)}` : "—"}</td>
      </tr>
    );
  };

  return (
    <>
      <div className="cazador-ficha-head">
        <h3>
          <IconoEve tid={TID_SISTEMAS} size={24} /> {nombre}
          {info && (
            <span className="muted small cz-sys-sub">
              {" "}· {info.region} · <span style={{ color: secColor(info.s) }}>{info.s.toFixed(1)}</span>
            </span>
          )}
        </h3>
        <div className="cazador-ficha-btns">
          {onVerEnMapa && (
            <button className="cazador-track-btn" onClick={() => onVerEnMapa(systemId)}>
              🗺️ {tr("Ver en el mapa")}
            </button>
          )}
          <button onClick={() => openExternal(`https://zkillboard.com/system/${systemId}/`)}>zKill</button>
        </div>
      </div>

      {/* La MISMA ventana que la lista, con los mismos cuatro botones. */}
      <SelectorVentana dias={dias} setDias={setDias} className="cz-sys-dias-ficha" />

      {datos == null ? (
        <p className="muted small">{cargando ? tr("Cargando…") : tr("No se pudo leer el sistema.")}</p>
      ) : rows.length === 0 ? (
        <p className="muted small">
          {tr("Nada cantado en este sistema en ese periodo. Eso no dice que esté tranquilo: dice que nadie de tus canales lo ha reportado.")}
        </p>
      ) : (
        <>
          <div className="kpis">
            <Kpi label={tr("Avistamientos")} value={fmtSp(rows.length)} />
            <Kpi label={tr("Hostiles distintos")} value={fmtSp(distintos)} />
            {ultimo != null && <Kpi label={tr("Último visto")} value={fmtAgo(Date.now() - ultimo)} />}
            <Kpi
              label={tr("Últimos 7 días")}
              value={mediaSemanal != null ? `${fmtSp(ultimos7)} · ×${(ultimos7 / Math.max(mediaSemanal, 0.01)).toFixed(1)}` : fmtSp(ultimos7)}
            />
          </div>
          {mediaSemanal != null && (
            <p className="muted small">
              {tr("El ×N compara los últimos 7 días con la media semanal del periodo elegido. Más de 1 = más movido que de costumbre en esa ventana.")}
            </p>
          )}
          {/* La regla del rastro, aquí también: esto es lo que se CANTÓ, no lo que pasó. */}
          <p className="muted small cazador-dosnum">
            {tr("Solo lo que se ha cantado en tus canales de intel en ese periodo. Un hueco es que nadie lo reportó, no que no hubiera nadie.")}
          </p>
          <BloqueEnlazado
            rows={rows}
            ventana={ventana}
            truncado={datos.truncado}
            sujeto="pilotos"
            sysNames={sysNames}
            shipNames={shipNames}
            onHostil={onHostil}
          />
        </>
      )}
      {(anillos.uno.length > 0 || anillos.dos.length > 0) && (
        <div className="cazador-grid">
          <div className="cazador-sec">
            <h4>🧭 {tr("Alrededor · a 1 salto")}</h4>
            <table className="km-table cat-table"><tbody>{anillos.uno.map((v) => <FilaVecino key={v.id} {...v} />)}</tbody></table>
          </div>
          <div className="cazador-sec">
            <h4>🧭 {tr("A 2 saltos")}</h4>
            <table className="km-table cat-table"><tbody>{anillos.dos.slice(0, 20).map((v) => <FilaVecino key={v.id} {...v} />)}</tbody></table>
            {anillos.dos.length > 20 && (
              <p className="muted small">{tr("Se enseñan los 20 con más actividad de")} {fmtSp(anillos.dos.length)}.</p>
            )}
          </div>
        </div>
      )}
      <p className="muted small">{tr("Las cifras de alrededor son de la misma ventana que la lista. Una raya es que nadie lo cantó, no que estuviera vacío.")}</p>
    </>
  );
}

/** El bloque enlazado del HOSTIL: sus avistamientos en una ventana, con el mapa de calor, el
 *  tiempo, POR DÓNDE pasa y en qué. La ventana es propia de la ficha y arranca en «Todo» para que
 *  su cifra cuadre con el ×N de la lista, que es de siempre; si se acorta, se dice cuántos caen
 *  dentro. Ver `BloqueEnlazado`. */
function BloqueHostil({
  name,
  dias,
  setDias,
  sysNames,
  shipNames,
  onSistema,
}: {
  name: string;
  dias: VentanaDias;
  setDias: (d: VentanaDias) => void;
  sysNames: Map<number, string>;
  shipNames: Map<number, string>;
  onSistema?: (sysId: number) => void;
}) {
  const { datos, cargando, ventana } = useFilasVentana<PilotSightings>("get_pilot_sightings", { name }, dias, name);
  const rows = datos?.rows ?? [];
  return (
    <>
      <div className="cz-ventana-fila">
        <SelectorVentana dias={dias} setDias={setDias} className="cz-sys-dias-ficha" />
        {datos && dias !== 0 && (
          <span className="muted small">{fmtSp(rows.length)} {tr("avistamientos en la ventana")}</span>
        )}
      </div>
      {datos == null ? (
        <p className="muted small">{cargando ? tr("Cargando…") : tr("No se pudo leer el rastro.")}</p>
      ) : rows.length === 0 ? (
        <p className="muted small">{tr("Sin avistamientos con sistema y hora en ese periodo.")}</p>
      ) : (
        <BloqueEnlazado
          rows={rows}
          ventana={ventana}
          truncado={datos.truncado}
          sujeto="sistemas"
          sysNames={sysNames}
          shipNames={shipNames}
          onSistema={onSistema}
        />
      )}
    </>
  );
}

// ---- Caché de MÓDULO (vive lo que la app, muere al cerrarla) ----
// El trato de siempre (ver inventario.tsx): pintar lo conocido al instante, re-pedir detrás.
// La lista de habituales no lleva argumentos → una sola caché, sin clave. Las fichas van por
// NOMBRE, que es su único argumento.
// ⚠️ `ship_names.json` NO es `ships.json`: éste va de nombre (en minúsculas, con los alias en
// castellano del parser) a typeID, y aquí se invierte para enseñar. Son ficheros distintos con
// semánticas distintas — no se unifican con `loadShipNames()` de flotas.tsx por parecerse.
let cacheHabituales: Habitual[] | null = null;
const cachePerfil = new Map<string, PilotProfile>();
let shipByIdPromise: Promise<Map<number, string>> | null = null;
function loadShipNamesPorId(): Promise<Map<number, string>> {
  if (!shipByIdPromise)
    shipByIdPromise = loadJson<Record<string, number>>("/ship_names.json", {})
      .then((d) => {
        const m = new Map<number, string>();
        for (const [n, id] of Object.entries(d)) if (!m.has(id)) m.set(id, n);
        return m;
      })
      .catch(() => new Map<number, string>());
  return shipByIdPromise;
}

// ---- ★★ EL CARA A CARA ----
// Esta ficha se lee con el hostil A UN SALTO, así que arriba va un VEREDICTO de una línea y el
// detalle debajo. Las dos reglas que no se negocian:
//   1. **El alcance se dice en cada línea.** Todo esto sale de killmails en los que estabas TÚ.
//      No son «sus naves», son las que le has visto usar. Sin la etiqueta, el número miente.
//   2. **Vacío ≠ inofensivo.** «0 encuentros» tiene que decirse CON PALABRAS —«nunca te has
//      cruzado con él»—, nunca como un marcador a cero, que se lee como «no es peligroso».
function CaraACara({
  vs,
  shipNames,
  onAbrir,
  onFicha,
}: {
  vs: PilotVs | null;
  shipNames: Map<number, string>;
  onAbrir: (id: number) => void;
  onFicha?: (name: string, id?: number | null) => void;
}) {
  // `null` = ni siquiera se ha podido mirar (Koru no conoce su ID). Distinto de mirarlo y no
  // encontrar nada, y por eso no comparten mensaje.
  if (!vs) {
    return (
      <div className="cazador-vs vacia">
        <p className="muted small">
          {tr("Sin cara a cara: Koru todavía no conoce su ID, así que no ha podido mirar en tus killmails.")}
        </p>
      </div>
    );
  }
  const cruces = vs.te_mato + vs.le_mataste + vs.peleas;
  if (cruces === 0) {
    return (
      <div className="cazador-vs vacia">
        <p className="small">
          <strong>{tr("Nunca te has cruzado con él en un killmail.")}</strong>{" "}
          {tr("Eso no dice que sea inofensivo: dice que no os habéis visto. Lo que haga fuera de tus peleas no está aquí.")}
        </p>
      </div>
    );
  }
  // ⚠️ Los umbrales van sobre la MEDIANA, nunca sobre la media. Con la media, un piloto de null
  // que suele salir en banda de diez salía como «suele ir en flota (153,9 por pelea)» porque dos
  // batallas de bloque tiraban del promedio — un número que no describía ninguna de sus peleas.
  const mediana = vs.mediana_atacantes;
  const compania =
    mediana == null
      ? null
      : mediana <= 1
        ? tr("suele ir solo")
        : mediana <= 5
          ? tr("suele ir en banda pequeña")
          : mediana <= 20
            ? tr("suele ir en banda")
            : tr("suele ir en flota");
  // La mayor solo se enseña si de verdad se sale de lo normal: si su pelea más grande es como
  // las demás, repetir la cifra es ruido.
  const picoRelevante =
    mediana != null && vs.max_atacantes != null && vs.max_atacantes >= mediana * 3 && vs.max_atacantes > 5;
  return (
    <div className="cazador-vs">
      <p className="cazador-veredicto">
        <IconoEve tid={TID_KILLS} /> <strong>{tr("Te ha matado")} {fmtSp(vs.te_mato)}</strong> · {tr("tú a él")}{" "}
        <strong>{fmtSp(vs.le_mataste)}</strong>
        {compania && (
          <>
            {" — "}
            {compania}
            <span className="muted">
              {" ("}
              {fmtSp(mediana as number)} {tr("de mediana")}
              {picoRelevante && (
                <>
                  {" · "}
                  {tr("su mayor")}: {fmtSp(vs.max_atacantes as number)}
                </>
              )}
              {")"}
            </span>
          </>
        )}
      </p>
      <p className="muted small cazador-vs-alcance">
        {tr("Todo esto sale de killmails en los que estabas tú. Lo que haya hecho sin ti delante no aparece.")}
      </p>
      <div className="kpis">
        <Kpi label={tr("Peleas compartidas")} value={fmtSp(vs.peleas)} />
        <Kpi label={tr("Daño que te ha hecho")} value={fmtSp(vs.dano_recibido)} />
        {vs.ultima && (
          <Kpi
            label={tr("Último encuentro")}
            value={fmtAgo(Date.now() - new Date(vs.ultima).getTime())}
          />
        )}
      </div>
      <div className="cazador-grid">
        <div className="cazador-sec">
          <h4><IconoEve tid={TID_NAVES} /> {tr("Naves que le has visto usar")}</h4>
          {vs.naves.length === 0 ? (
            <p className="muted small">{tr("Ninguna registrada en esos killmails.")}</p>
          ) : (
            <div className="cazador-ships">
              {vs.naves.map((s) => (
                <div
                  className="cazador-ship"
                  key={s.id}
                  title={shipNames.has(s.id) ? titleCase(shipNames.get(s.id)!) : `#${s.id}`}
                >
                  <img src={typeIcon(s.id, 32)} alt="" width={30} height={30} />
                  <span className="cazador-ship-name">
                    {shipNames.has(s.id) ? titleCase(shipNames.get(s.id)!) : `#${s.id}`}
                  </span>
                  <span className="intel-count fleet">×{s.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="cazador-sec">
          <h4><IconoEve tid={TID_GENTE} /> {tr("Con quién le has visto")}</h4>
          {vs.acompanantes.length === 0 ? (
            <p className="muted small">{tr("En esas peleas no había nadie más con nombre.")}</p>
          ) : (
            <table className="km-table cat-table">
              <tbody>
                {vs.acompanantes.map((a) => (
                  <tr key={a.character_id}>
                    <td className="cz-acomp">
                      <Retrato id={a.character_id} />
                      {/* ★ CON NOMBRE → LA FICHA DE PILOTO, no zKillboard. Idea suya: de alguien que
                          vuela con el hostil, lo primero que interesa es «¿tengo algo interno de
                          éste?» —si habéis coincidido, hablado, o volado juntos—, y eso solo lo
                          sabe Koru. El killboard sigue a un clic desde la propia ficha.
                          SIN nombre no se puede: la ficha se abre por nombre y Koru no lo conoce,
                          así que ahí queda el id y su killboard, que es lo único cierto. */}
                      {a.name ? (
                        <PilotoNombre nombre={a.name} id={a.character_id} onFicha={onFicha} />
                      ) : (
                        <button
                          className="linklike"
                          onClick={() => onAbrir(a.character_id)}
                          title={tr("Ver su killboard")}
                        >
                          #{a.character_id}
                        </button>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>×{a.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}


// Sección PvP → "Cazador": análisis de hostiles aprendidos del intel local. Lista buscable/ordenable
// de todos los pilotos conocidos + ficha amplia del seleccionado (horas UTC, sistemas, naves,
// frecuencia). El rastro se sigue pintando en el mapa; `onTrackOnMap` (si se pasa) hace el puente.
export function CazadorView({
  onTrackOnMap,
  initialPilot,
  onFicha,
  onVerEnMapa,
}: {
  onTrackOnMap?: (name: string) => void;
  initialPilot?: string | null;
  /** Abre LA ficha de piloto de la app — la misma de Contratos, Flotas y Social. Idea suya: de un
   *  acompañante del hostil interesa antes «¿tengo algo interno de éste?» que su killboard. */
  onFicha?: (name: string, id?: number | null) => void;
  /** Salta al Mapa y CENTRA ese sistema (con su animación y su pulso). Ya existía como `verEnMapa`
   *  para el resto de secciones; aquí solo se enchufa. */
  onVerEnMapa?: (sysId: number) => void;
}) {
  const [list, setList] = useState<Habitual[] | null>(null);
  const [q, setQ] = useState("");
  /** ★ ÓRDENES A GUSTO DE CADA PILOTO (pedido el 2026-09-19). Uno por modo, porque las preguntas
   *  no son las mismas: a un hostil se le busca por cuánto se le ve, cuándo fue la última vez o
   *  por nombre; a un sistema, además, por cuánta gente distinta pasa o por su seguridad. */
  const [sortH, setSortH] = usePref<OrdenHostiles>("orden-hostiles", "count", esOrdenH);
  const [sortS, setSortS] = usePref<OrdenSistemas>("orden-sistemas", "count", esOrdenS);
  const [sel, setSel] = useState<string | null>(null);
  const [profile, setProfile] = useState<PilotProfile | null>(null);
  /** Menciones del hostil seleccionado. Sale de la lista que ya está en memoria, no de una llamada
   *  nueva: `get_pilot_profile` cuenta avistamientos y este número es el otro, el de `name_cache`. */
  const [menciones, setMenciones] = useState<number | null>(null);
  const [sysNames, setSysNames] = useState<Map<number, string>>(new Map());
  /** Seguridad y región de cada sistema, para la cabecera de la ficha de sistema y para buscar
   *  por región en la lista. Del mismo fichero que los nombres. */
  const [sysInfo, setSysInfo] = useState<Map<number, { s: number; region: string }>>(new Map());
  /** Sistema → sistemas a un salto. Para «Alrededor» en la ficha de sistema. */
  const [vecinos, setVecinos] = useState<Map<number, number[]>>(new Map());
  const [shipNames, setShipNames] = useState<Map<number, string>>(new Map());
  /** ★ El modo: por HOSTIL (lo de siempre) o por SISTEMA (2026-09-19). Misma pantalla, mismo
   *  sitio de la lista, distinta pregunta. La ficha de la derecha cambia con él. */
  const [modo, setModo] = useState<"hostiles" | "sistemas">("hostiles");
  const [sysList, setSysList] = useState<IntelSystemRow[] | null>(null);
  /** Ventana del RANKING de sistemas (la ficha tiene la suya). 30 días por defecto: «¿qué está
   *  caliente ahora?». El histórico entero ordena por seis años y no dice nada del momento. */
  const [sysDias, setSysDias] = usePref<VentanaDias>("ventana-sistemas", 30, esVentana);
  const [sysSel, setSysSel] = useState<number | null>(null);
  /** Ventana del bloque enlazado del HOSTIL. «Todo» por defecto: la lista de hostiles ordena por
   *  avistamientos de siempre, y así la ficha abre con la misma cifra. */
  const [hostDias, setHostDias] = usePref<VentanaDias>("ventana-hostil", 0, esVentana);

  useEffect(() => {
    // Lo último conocido, al instante; se re-pide detrás. La consulta no lleva argumentos
    // (siempre minCount 1 / limit 500), así que hay UNA sola caché y no hace falta clave.
    setList(cacheHabituales ?? null);
    invoke<Habitual[]>("get_habitual_hostiles", { minCount: 1, limit: 500 })
      .then((d) => {
        cacheHabituales = d; // se guarda aunque la vista ya no esté montada
        setList(d);
      })
      .catch(() => setList([]));
    loadNewEden()
      .then((ne) => {
        setSysNames(new Map(ne.systems.map((s) => [s.id, s.n])));
        const regiones = new Map(ne.regions.map((r) => [r.id, r.n]));
        setSysInfo(new Map(ne.systems.map((s) => [s.id, { s: s.s, region: regiones.get(s.r) ?? "" }])));
        // Quién está a un salto de quién, para «Alrededor». Los saltos de neweden.json son pares
        // sin dirección; aquí se meten en los dos sentidos.
        const ady = new Map<number, number[]>();
        for (const [a, b] of ne.jumps) {
          (ady.get(a) ?? ady.set(a, []).get(a)!).push(b);
          (ady.get(b) ?? ady.set(b, []).get(b)!).push(a);
        }
        setVecinos(ady);
      })
      .catch(() => {});
    loadShipNamesPorId().then(setShipNames);
  }, []);

  // La lista de sistemas se pide al entrar en el modo y al cambiar su ventana. Es una consulta
  // por índice; no hace falta caché de módulo.
  useEffect(() => {
    if (modo !== "sistemas") return;
    let vivo = true;
    // Se piden TODOS los sistemas con actividad en la ventana (no solo los 300 que se pintan):
    // «Alrededor» necesita la cifra de cualquier vecino, esté donde esté en el ranking.
    invoke<IntelSystemRow[]>("get_intel_systems", { days: sysDias, limit: 2000 })
      .then((d) => vivo && setSysList(d))
      .catch(() => vivo && setSysList([]));
    return () => {
      vivo = false;
    };
  }, [modo, sysDias]);

  const sistemasFiltrados = useMemo(() => {
    let l = sysList ?? [];
    const ql = q.trim().toLowerCase();
    if (ql) {
      l = l.filter((r) => {
        const n = (sysNames.get(r.system_id) ?? "").toLowerCase();
        const reg = (sysInfo.get(r.system_id)?.region ?? "").toLowerCase();
        return n.includes(ql) || reg.includes(ql);
      });
    }
    const nombre = (id: number) => sysNames.get(id) ?? "";
    const seg = (id: number) => sysInfo.get(id)?.s ?? 1;
    l = [...l].sort((a, b) => {
      switch (sortS) {
        case "recent": return b.last_ms - a.last_ms;
        case "hostiles": return b.hostiles - a.hostiles || b.sightings - a.sightings;
        case "name": return nombre(a.system_id).localeCompare(nombre(b.system_id));
        case "region": return (sysInfo.get(a.system_id)?.region ?? "").localeCompare(sysInfo.get(b.system_id)?.region ?? "") || b.sightings - a.sightings;
        // Seguridad ASCENDENTE: el null más profundo primero, que es donde caza quien mira esto.
        case "sec": return seg(a.system_id) - seg(b.system_id) || b.sightings - a.sightings;
        default: return b.sightings - a.sightings;
      }
    });
    // Sin búsqueda se pintan 300: más filas no se leen y sí se notan al ordenar.
    return q.trim() ? l : l.slice(0, 300);
  }, [sysList, q, sortS, sysNames, sysInfo]);
  /** Actividad por sistema en la ventana, para «Alrededor». */
  const actividadSistemas = useMemo(() => new Map((sysList ?? []).map((r) => [r.system_id, r])), [sysList]);

  async function select(name: string) {
    setSel(name);
    setMenciones(
      (cacheHabituales ?? []).find((h) => h.name === name)?.seen_count ?? null,
    );
    // La ficha cacheada se pinta YA y se re-pide siempre: los avistamientos son dato vivo y el
    // rastro de un piloto crece mientras miras. Pintar lo viejo sin releer sería petrificarlo.
    setProfile(cachePerfil.get(name) ?? null);
    try {
      const p = await invoke<PilotProfile>("get_pilot_profile", { name });
      cachePerfil.set(name, p);
      setProfile(p);
    } catch {
      setProfile(null);
    }
  }

  // Fase 3.5 — fichar un objetivo NUEVO por nombre: si no está entre los aprendidos, se resuelve
  // contra ESI (nombre EXACTO) y se abre su ficha. `resolve_intel_entities` ya cachea el id en
  // name_cache, así que cuando el piloto aparezca en tu intel llegará resuelto (retrato incluido)
  // y su rastro empezará a acumularse desde el primer avistamiento.
  const [esiBusy, setEsiBusy] = useState(false);
  const [esiMsg, setEsiMsg] = useState("");
  async function ficharPorNombre() {
    const name = q.trim();
    if (!name) return;
    setEsiBusy(true);
    setEsiMsg("");
    try {
      const r = await invoke<{ characters: { id: number; name: string }[] }>(
        "resolve_intel_entities",
        { names: [name] },
      );
      const c = r.characters[0];
      if (c) {
        setQ("");
        void select(c.name);
      } else {
        setEsiMsg(tr("ESI no conoce ese nombre. Tiene que ser exacto (las mayúsculas dan igual)."));
      }
    } catch {
      setEsiMsg(tr("No se pudo consultar ESI. Inténtalo en un momento."));
    } finally {
      setEsiBusy(false);
    }
  }

  // Puente desde la ficha del mapa: si llega un piloto preseleccionado, abrir su ficha directamente.
  useEffect(() => {
    if (initialPilot) select(initialPilot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPilot]);

  const filtered = useMemo(() => {
    let l = list ?? [];
    const ql = q.trim().toLowerCase();
    if (ql) l = l.filter((h) => h.name.toLowerCase().includes(ql));
    l = [...l].sort((a, b) => {
      switch (sortH) {
        case "recent": return Date.parse(b.last_seen ?? "0") - Date.parse(a.last_seen ?? "0");
        case "name": return a.name.localeCompare(b.name);
        // Las menciones existen como orden explícito, con su nombre: elegirlo a sabiendas es
        // distinto de que la lista lo usara a escondidas, que era el problema de antes.
        case "mentions": return b.seen_count - a.seen_count || b.sightings - a.sightings;
        default: return b.sightings - a.sightings || b.seen_count - a.seen_count;
      }
    });
    return l;
  }, [list, q, sortH]);

  return (
    <div className="cazador">
      <div className="cazador-list">
        {/* ★ HOSTILES o SISTEMAS: la misma lista, la pregunta al revés. Al cambiar de modo se
            limpia la búsqueda: «stefanita» no es un sistema y «Delve» no es una persona. */}
        <div className="seg seg-sm cz-modo">
          <button
            className={modo === "hostiles" ? "active" : ""}
            onClick={() => { setModo("hostiles"); setQ(""); }}
          >
            <IconoEve tid={TID_GENTE} size={14} /> {tr("Hostiles")}
          </button>
          <button
            className={modo === "sistemas" ? "active" : ""}
            onClick={() => { setModo("sistemas"); setQ(""); }}
          >
            <IconoEve tid={TID_SISTEMAS} size={14} /> {tr("Sistemas")}
          </button>
        </div>
        <div className="cazador-tools">
          <input
            className="cazador-search"
            placeholder={modo === "hostiles" ? tr("Nombre del hostil…") : tr("Sistema o región…")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {/* Un desplegable y no dos botones: con cuatro o seis órdenes, los botones no caben y
              el desplegable dice siempre por qué está ordenada la lista. */}
          {modo === "hostiles" ? (
            <select className="cz-orden" value={sortH} onChange={(e) => setSortH(e.target.value as OrdenHostiles)} title={tr("Ordenar por")}>
              <option value="count">{tr("Avistamientos")}</option>
              <option value="recent">{tr("Reciente")}</option>
              <option value="name">{tr("Nombre")}</option>
              <option value="mentions">{tr("Menciones")}</option>
            </select>
          ) : (
            <select className="cz-orden" value={sortS} onChange={(e) => setSortS(e.target.value as OrdenSistemas)} title={tr("Ordenar por")}>
              <option value="count">{tr("Avistamientos")}</option>
              <option value="hostiles">{tr("Hostiles distintos")}</option>
              <option value="recent">{tr("Reciente")}</option>
              <option value="name">{tr("Nombre")}</option>
              <option value="region">{tr("Región")}</option>
              <option value="sec">{tr("Seguridad")}</option>
            </select>
          )}
        </div>
        {modo === "sistemas" && (
          <div className="seg seg-sm cz-sys-dias">
            {VENTANAS.map((d) => (
              <button key={d} className={sysDias === d ? "active" : ""} onClick={() => setSysDias(d)}>
                {d === 0 ? tr("Todo") : `${d} ${tr("días")}`}
              </button>
            ))}
          </div>
        )}
        {modo === "sistemas" ? (
          sysList == null ? (
            <p className="muted small">{tr("Cargando…")}</p>
          ) : sistemasFiltrados.length === 0 ? (
            <p className="muted small">
              {q.trim()
                ? tr("Ningún sistema así con avistamientos en ese periodo.")
                : tr("Sin avistamientos en ese periodo. Prueba una ventana más larga.")}
            </p>
          ) : (
            <div className="cazador-rows">
              {sistemasFiltrados.map((r) => {
                const info = sysInfo.get(r.system_id);
                return (
                  <div
                    key={r.system_id}
                    className={`cazador-row${sysSel === r.system_id ? " active" : ""}${Date.now() - r.last_ms < 3600000 ? " viva" : ""}`}
                    onClick={() => setSysSel(r.system_id)}
                    title={Date.now() - r.last_ms < 3600000 ? tr("Con actividad en la última hora") : undefined}
                  >
                    <IconoEve tid={TID_SISTEMAS} size={22} />
                    <div className="cazador-row-main">
                      <span className="cazador-row-name">{sysNames.get(r.system_id) ?? `#${r.system_id}`}</span>
                      <span className="muted small">
                        {info?.region}
                        {info && (
                          <>
                            {" · "}
                            <span style={{ color: secColor(info.s) }}>{info.s.toFixed(1)}</span>
                          </>
                        )}
                        {` · ${fmtSp(r.hostiles)} ${tr("hostiles")} · ${fmtAgo(Date.now() - r.last_ms)}`}
                      </span>
                    </div>
                    <span className="intel-count fleet" title={`${fmtSp(r.sightings)} ${tr("avistamientos con sitio y hora")}`}>
                      ×{r.sightings}
                    </span>
                  </div>
                );
              })}
            </div>
          )
        ) : list == null ? (
          <p className="muted small">{tr("Cargando…")}</p>
        ) : filtered.length === 0 ? (
          <div className="cazador-esi">
            <p className="muted small">
              {q.trim()
                ? tr("Nadie con ese nombre entre tus aprendidos.")
                : tr("Sin hostiles conocidos aún. Deja correr el intel un rato.")}
            </p>
            {q.trim().length >= 3 && (
              <>
                <button className="pp-add" onClick={ficharPorNombre} disabled={esiBusy}>
                  {esiBusy ? "⏳" : <>🔎 {tr("Fichar por nombre (ESI)")}: «{q.trim()}»</>}
                </button>
                {esiMsg && <p className="muted small">{esiMsg}</p>}
              </>
            )}
          </div>
        ) : (
          <div className="cazador-rows">
            {filtered.map((h) => {
              const sysName = h.last_system_id != null ? sysNames.get(h.last_system_id) : null;
              return (
                <div
                  key={h.name_lower}
                  className={`cazador-row${sel === h.name ? " active" : ""}${h.last_seen && Date.now() - Date.parse(h.last_seen) < 3600000 ? " viva" : ""}`}
                  onClick={() => select(h.name)}
                  title={h.last_seen && Date.now() - Date.parse(h.last_seen) < 3600000 ? tr("Con actividad en la última hora") : undefined}
                >
                  {h.character_id != null && h.character_id > 0 ? (
                    <img
                      src={`https://images.evetech.net/characters/${h.character_id}/portrait?size=32`}
                      alt=""
                      width={28}
                      height={28}
                    />
                  ) : (
                    <span className="intel-hab-noimg">?</span>
                  )}
                  <div className="cazador-row-main">
                    <span className="cazador-row-name">{h.name}</span>
                    {sysName && (
                      <span className="muted small">
                        {tr("visto en")} {sysName}
                        {h.last_seen && ` · ${fmtAgo(Date.now() - Date.parse(h.last_seen))}`}
                      </span>
                    )}
                  </div>
                  {/* ★ AVISTAMIENTOS, la misma cifra que el KPI de la ficha — antes aquí salía
                      `seen_count` (menciones) y abajo los avistamientos, y los dos se leían como
                      «cuántas veces le he visto». Etiquetarlos no bastó: lo que confundía es que
                      la lista presidiera con un número que la ficha no repetía. Ahora es el mismo
                      dato en los dos sitios y no pueden discrepar. Las menciones siguen ahí, en el
                      `title`, y solo se nombran cuando difieren: si son iguales, decirlo sobra. */}
                  <span
                    className="intel-count fleet"
                    title={
                      h.seen_count !== h.sightings
                        ? `${fmtSp(h.sightings)} ${tr("avistamientos con sitio y hora")} · ${fmtSp(h.seen_count)} ${tr("menciones en el intel")}`
                        : `${fmtSp(h.sightings)} ${tr("avistamientos con sitio y hora")}`
                    }
                  >
                    ×{h.sightings}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="cazador-ficha">
        {modo === "sistemas" ? (
          sysSel == null ? (
            <p className="muted">{tr("Selecciona un sistema para ver quién pasa por él, a qué horas y en qué.")}</p>
          ) : (
            <FichaSistema
              systemId={sysSel}
              dias={sysDias}
              setDias={setSysDias}
              sysNames={sysNames}
              sysInfo={sysInfo}
              vecinos={vecinos}
              actividad={actividadSistemas}
              onSistema={setSysSel}
              shipNames={shipNames}
              // De un hostil de la lista del sistema a SU ficha: se cambia de modo y se abre.
              onHostil={(name) => { setModo("hostiles"); setQ(""); void select(name); }}
              onVerEnMapa={onVerEnMapa}
            />
          )
        ) : sel == null ? (
          <p className="muted">{tr("Selecciona un hostil de la lista para ver su ficha.")}</p>
        ) : profile == null ? (
          <p className="muted small">{tr("Cargando…")}</p>
        ) : profile.total === 0 ? (
          // Fichado por nombre (Fase 3.5) o aprendido sin avistamientos aún: dossier mínimo con
          // retrato + zKill; el rastro y las horas nacerán con su primer reporte en tu intel.
          <>
            <div className="cazador-ficha-head">
              {/* Su cara ANTES que su nombre: es lo que se reconoce de un vistazo en el local. */}
              <h3>
                <Retrato id={profile.character_id} size={28} /> {profile.name}
              </h3>
              <div className="cazador-ficha-btns">
                {profile.character_id != null && profile.character_id > 0 && (
                  <button onClick={() => openExternal(`https://zkillboard.com/character/${profile.character_id}/`)}>
                    zKill
                  </button>
                )}
              </div>
            </div>
            <p className="muted small">
              {tr("Fichado. Aún sin avistamientos: en cuanto aparezca en tu intel, su rastro, sus horas y sus naves nacen aquí.")}
            </p>
            {/* ★ El cara a cara TAMBIÉN aquí, y aquí es donde más vale: «nunca lo has visto en el
                intel, pero te ha matado dos veces» es exactamente el aviso que salva la ficha de
                un recién fichado. Sale de los killmails, que no dependen de los avistamientos. */}
            <CaraACara
              vs={profile.vs}
              shipNames={shipNames}
              onAbrir={(id) => openExternal(`https://zkillboard.com/character/${id}/`)}
              onFicha={onFicha}
            />
          </>
        ) : (
          <>
            <div className="cazador-ficha-head">
              <h3>
                <Retrato id={profile.character_id} size={28} /> {profile.name}
              </h3>
              <div className="cazador-ficha-btns">
                {onTrackOnMap && (
                  <button className="cazador-track-btn" onClick={() => onTrackOnMap(profile.name)}>
                    🎯 {tr("Ver rastro en el mapa")}
                  </button>
                )}
                {profile.character_id != null && profile.character_id > 0 && (
                  <button onClick={() => openExternal(`https://zkillboard.com/character/${profile.character_id}/`)}>
                    zKill
                  </button>
                )}
              </div>
            </div>
            {/* ★ ARRIBA DEL TODO, antes que ningún avistamiento: con el hostil a un salto lo que
                se necesita es el veredicto, no el dossier. Lo demás se lee si da tiempo. */}
            <CaraACara
              vs={profile.vs}
              shipNames={shipNames}
              onAbrir={(id) => openExternal(`https://zkillboard.com/character/${id}/`)}
              onFicha={onFicha}
            />
            <div className="kpis">
              {/* ★★ LOS DOS NÚMEROS, JUNTOS Y ETIQUETADOS (2026-09-07).
                  La lista decía «×186» y este KPI «156» y las dos cosas se leían igual: «cuántas
                  veces le he visto». Son preguntas distintas y las dos son ciertas —
                  · MENCIONES = veces que ha pasado por delante (`name_cache.seen_count`);
                  · AVISTAMIENTOS = veces distintas con SITIO y HORA (`intel_sightings`, cuya clave
                    primaria es nombre+sistema+hora, así que una línea repetida no cuenta dos veces).
                  Medido en su BD: el hueco es del 38 %, y son sobre todo líneas de intel en las que
                  el troceador sacó el piloto pero no el sistema. Esconder uno de los dos habría
                  sido perder información; dejarlos sin etiqueta es lo que confundía. */}
              <Kpi label={tr("Avistamientos")} value={fmtSp(profile.total)} />
              {menciones != null && menciones !== profile.total && (
                <Kpi label={tr("Menciones")} value={fmtSp(menciones)} />
              )}
              {profile.last_ms != null && (
                <Kpi label={tr("Último visto")} value={fmtAgo(Date.now() - profile.last_ms)} />
              )}
              {profile.first_ms != null && (
                <Kpi label={tr("Primer visto")} value={fmtAgo(Date.now() - profile.first_ms)} />
              )}
              <Kpi label={tr("Sistemas distintos")} value={fmtSp(profile.by_system.length)} />
            </div>
            {/* Solo cuando difieren: si coinciden, explicar una diferencia que no se ve es ruido. */}
            {menciones != null && menciones !== profile.total && (
              <p className="muted small cazador-dosnum">
                {tr("Se le ha nombrado")} <strong>{fmtSp(menciones)}</strong> {tr("veces, y de ahí salen")}{" "}
                <strong>{fmtSp(profile.total)}</strong>{" "}
                {tr("avistamientos distintos: los que traían sistema y hora, sin contar dos veces una línea repetida. Son los que alimentan su rastro, sus horas y sus sistemas.")}
              </p>
            )}

            {/* ★ EL MISMO BLOQUE ENLAZADO que la ficha de sistema, con el sujeto al revés: aquí la
                lista de la izquierda es POR DÓNDE pasa. Sustituye a «Horas activas», «Sistemas
                favoritos» y «Naves», que eran tres piezas sueltas de la misma información. */}
            <BloqueHostil
              name={profile.name}
              dias={hostDias}
              setDias={setHostDias}
              sysNames={sysNames}
              shipNames={shipNames}
              onSistema={(id) => { setModo("sistemas"); setQ(""); setSysSel(id); }}
            />
          </>
        )}
      </div>
    </div>
  );
}
