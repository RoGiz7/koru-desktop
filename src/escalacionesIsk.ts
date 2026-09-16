// ★★ ISK POR DÍAS DE LAS ESCALACIONES — el cálculo, separado de la pantalla.
//
// Lo pidió un piloto probando la sección: «no hay una gráfica o visor del ISK generado por días
// como en las otras secciones de crabs y abisales».
//
// ★ POR QUÉ ESTÁ AQUÍ Y NO EN `escalaciones.tsx`: para poder probarlo. Node sabe quitar los tipos
//   de un `.ts`, pero no el JSX de un `.tsx`, así que dentro del componente esta cuenta no se
//   podría ejecutar desde un script — y copiarla en el script serían DOS VERDADES del mismo
//   número, que es justo el fallo del que llevo registro. La prueba llama a esta función.
//   Ver `scripts/verificar_isk_escalaciones.mjs`.
// ⚠️ De `fechas.ts` (módulo hoja) y CON la extensión, las dos cosas a propósito: Node sabe quitar
// los tipos de un `.ts` pero NO resuelve imports sin extensión como Vite, y tirando de `format.ts`
// se arrastraría `./i18n` detrás. Así el script de pruebas puede cargar esto tal cual.
import { weekKey } from "./fechas.ts";

/** Los campos de una escalación que ESTA cuenta necesita, y ni uno más.
 *
 *  Estructural a propósito: `Escalacion` de `escalaciones.tsx` encaja sola. Declarar el tipo
 *  entero sería prometer que la cuenta mira cosas que no mira — la misma razón por la que
 *  `RunEsc` no copia `ActivityRun` completo. */
export type EscIsk = {
  id: number;
  precio: number | null;
  /** El día que COBRASTE la venta. Es la fecha buena para una escalación vendida. */
  cobrada_at: string | null;
  cerrada_at: string | null;
  run_id: number | null;
};

/** Lo que la cuenta necesita de la run enlazada. */
export type RunIsk = {
  loot_isk: number | null;
  ship_loss_isk: number | null;
  ended_at: string | null;
};

export type SerieIsk = {
  labels: string[];
  botin: number[];
  venta: number[];
  perdido: number[];
  tBotin: number;
  tVenta: number;
  tPerdido: number;
  /** Años con datos, descendente. Para el selector de año del rango. */
  anios: number[];
};

/** ★ LAS ESCALACIONES GANAN ISK DE DOS MANERAS, que es lo que hace distinta a esta pantalla. De
 *  ahí TRES series y no una:
 *   · **Botín** — la corriste tú. Sale de la run enlazada (`run_list('escalacion')`).
 *   · **Ventas** — la vendiste. Sale de `precio`, y la fecha buena es `cobrada_at`: **el día que
 *     entró el ISK**, no el día que la apuntaste. Una escalación puede apuntarse el lunes,
 *     venderse el martes y cobrarse el viernes; contarla el lunes sería contar mal el día.
 *   · **Naves perdidas** — lo que costó. Va en su PROPIA serie en vez de restarse del botín, por la
 *     misma regla que ya está escrita en el histórico de esta pantalla: un saldo que esconde sus
 *     partes no deja ver si la semana fue de botín pobre o de naves caras.
 *
 *  🚨 SE LE PASAN LAS DOS LISTAS, vivas Y histórico, y esto es una trampa de verdad. El ciclo de
 *  venta es `en_venta → cobrada → entregada → cerrada`, así que una escalación **ya cobrada puede
 *  seguir viva**. Leer solo el histórico dejaría fuera ISK que YA entró, y la gráfica lo callaría.
 *  Aquí se deduplica por `id`, que es lo único que no puede repetirse.
 *
 *  `from`/`to` son días ISO (YYYY-MM-DD) inclusive; vacío = sin tope por ese lado. */
export function agregarIsk(
  escalaciones: EscIsk[],
  runs: Map<number, RunIsk>,
  gran: "day" | "week" | "month",
  from = "",
  to = "",
): SerieIsk {
  // Una escalación cobrada-pero-no-cerrada llega en las DOS listas: el id la funde en una.
  const todas = new Map<number, EscIsk>();
  for (const e of escalaciones) todas.set(e.id, e);

  const cuboDe = (dia: string) =>
    gran === "month" ? dia.slice(0, 7) : gran === "week" ? weekKey(dia) : dia;

  const cubos = new Map<string, { botin: number; venta: number; perdido: number }>();
  const anios = new Set<number>();

  const anota = (dia: string, campo: "botin" | "venta" | "perdido", isk: number) => {
    if (!isk || !dia) return;
    // El año se apunta ANTES de filtrar: el selector de año tiene que ofrecer todos los años con
    // datos, no solo los del rango puesto — si no, al elegir un año desaparecería de la lista.
    anios.add(+dia.slice(0, 4));
    if (from && dia < from) return;
    if (to && dia > to) return;
    const k = cuboDe(dia);
    const c = cubos.get(k) ?? { botin: 0, venta: 0, perdido: 0 };
    c[campo] += isk;
    cubos.set(k, c);
  };

  for (const e of todas.values()) {
    const r = e.run_id != null ? runs.get(e.run_id) : undefined;
    // El día en que el ISK se materializó. `cerrada_at` es el respaldo cuando no hay run.
    const diaHecha = (r?.ended_at ?? e.cerrada_at ?? "").slice(0, 10);
    const diaVenta = (e.cobrada_at ?? e.cerrada_at ?? "").slice(0, 10);
    if (e.precio) anota(diaVenta, "venta", e.precio);
    if (r?.loot_isk) anota(diaHecha, "botin", r.loot_isk);
    if (r?.ship_loss_isk) anota(diaHecha, "perdido", r.ship_loss_isk);
  }

  const labels = [...cubos.keys()].sort();
  const col = (campo: "botin" | "venta" | "perdido") => labels.map((l) => cubos.get(l)![campo]);
  const botin = col("botin");
  const venta = col("venta");
  const perdido = col("perdido");
  // ★ Los totales se suman DE LOS CUBOS, no otra vez de las escalaciones. Dos cuentas del mismo
  //   número son dos verdades, y con un rango puesto acabarían discrepando: el KPI diría una cosa
  //   y la gráfica dibujaría otra. Sumando lo que se dibuja, no pueden.
  const suma = (a: number[]) => a.reduce((x, y) => x + y, 0);
  return {
    labels,
    botin,
    venta,
    perdido,
    tBotin: suma(botin),
    tVenta: suma(venta),
    tPerdido: suma(perdido),
    anios: [...anios].sort((a, b) => b - a),
  };
}
