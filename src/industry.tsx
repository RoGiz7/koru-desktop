// Sección Industria: trabajos de producción activos (estado y tiempo restante) por personaje o global.
// Extraído de App.tsx. fmtRemain (formatea el tiempo restante de un job) es interno.
import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr, getLang } from "./i18n";
import { fmtSp, fmtIsk, bpIcon, typeIcon } from "./format";
import { Kpi, Bars } from "./charts";
// F-REACCIONES / F4a — «de dónde traerlo»: grafo real de New Eden + BFS de saltos, los mismos que
// usa el mapa. Nada de estimaciones por distancia en píxeles.
import { loadNewEden } from "./neweden";
import { proximityBFS } from "./mapRoute";
import type { JobView, Blueprint } from "./types";

/** public/bp_tree.json — categoría y grupo de INVENTARIO del PRODUCTO de cada blueprint, con
 *  nombres ES/EN del SDE. Es la jerarquía que usa el cliente de EVE en su ventana de planos.
 *  (El árbol de MERCADO de planos NO vale: mete los supercarriers dentro de "Carriers" — la Nyx
 *  salía como portanave. Cazado por RoGiz7 y verificado en EVE Ref.) */
type BpTree = {
  bp: Record<string, [number, number]>; // blueprintTypeID → [categoríaID, grupoID]
  cat: Record<string, { es: string; en: string }>;
  grp: Record<string, { es: string; en: string }>;
};

/* ---------- F1a: árbol BOM ---------- */

/** public/bp_industry.json (R3): actividad → tiempo, insumos [[tid,qty]], producto, skills.
 *  En invención (`i`) el out lleva [bpT2, runs, probabilidad] y `sk` las skills [[id, nivel]]. */
type BpAct = { t: number; in: [number, number][]; out: number[][]; sk?: [number, number][] };
type BpIndustry = Record<
  string,
  {
    m?: BpAct;
    i?: BpAct;
    r?: BpAct;
    c?: number;
    max?: number;
    /** `1` = plano NO publicado en el SDE: existe en los datos pero no en el juego. Se conserva
     *  para que la biblioteca resuelva el tuyo si lo tienes (hay 204 objetos publicados cuya única
     *  receta es un plano así), pero NUNCA entra en los índices producto→plano del árbol: uno de
     *  ellos, el «Test Reaction Blueprint», traía números falsos del mismo producto que la fórmula
     *  buena y habría envenenado una cadena entera sin dar error. */
    np?: number;
  }
>;
/** Catálogo de nombres (public/market_types.json). Los ítems se muestran en INGLÉS a propósito. */
type MType = { i: number; n: string; g: number };

/** public/industry_rigs.json (SDE): bonos de industria de las estructuras Upwell y de sus rigs.
 *  Estructura: FACTORES ya listos (0.99 = −1 %). Rig: % BASE negativo, a multiplicar por la
 *  seguridad. `scopes` = los alcances del rig, del nombre de sus efectos del SDE (p. ej.
 *  "AllShipManufacture"): dicen a qué aplica. Son VARIOS a propósito — el 43705 tiene cuatro. */
type IndustryRigs = {
  /** Grupos donde ENTRA la Standup Manufacturing Plant I, leídos de sus propios `canFitShipGroupNN`:
   *  1657 Citadel · 1404 Engineering Complex · 1406 Refinery. Fuera de ahí no se fabrica, punto. */
  mfg_groups: number[];
  /** Grupos donde entran los reactores Standup (Composite/Hybrid/Biochemical), de sus propios
   *  `canFitShipGroupNN`: solo 1406 Refinery. Reaccionar fuera de ahí no existe. */
  reaction_groups?: number[];
  /** Toda estructura publicada → su grupo. Sirve para descartar las que no pueden fabricar. */
  kinds: Record<string, { n: { es: string; en: string }; g: number; gn: string }>;
  structures: Record<
    string,
    {
      n: { es: string; en: string };
      mat: number | null;
      cost: number | null;
      time: number | null;
      slots: number;
      size: number;
      /** Bono de REACCIÓN de la estructura. Hoy solo existe `time`, y solo lo tiene la Tatara
       *  (0.75 = −25 %). NO hay bono de coste ni de material de reacción en ninguna. */
      react?: { time?: number };
    }
  >;
  rigs: Record<
    string,
    {
      n: { es: string; en: string };
      mat: number;
      time: number;
      cost: number;
      sec: { hi?: number; low?: number; null?: number };
      size: number;
      scopes: string[];
      /** F1d — mapeo rig→producto del CLIENTE (Hoboleaks, extract_rig_targets.py): categorías y
       *  grupos de producto a los que aplica el bono de MATERIAL. Validado por triple vía:
       *  Hoboleaks = EVE Ref = fixture real del Bantam (37181 ON [6,32] · 43705 OFF para naves).
       *  Sin `aff` (outposts) se cae al fallback por nombre de efecto (SCOPE_CAT). */
      aff?: { c: number[]; g: number[] };
      /** F-REACCIONES — bonos de reacción, en atributos DISTINTOS de los de fabricación
       *  (RefRigMatBonus/RefRigTimeBonus). **No existe rig de coste de reacción.** Y su `sec`
       *  vale null ×1.1, no ×2.1: usar el de fabricación duplicaría el bono. */
      react?: { mat?: number; time?: number };
      /** `disallowInHighSec` del SDE: reaccionar en highsec no se puede. */
      no_hi?: boolean;
    }
  >;
  /** Procedencia del mapeo `aff` (revisión del cliente y timestamp de Hoboleaks). */
  aff_meta?: { source: string; revision: number; timestamp: string };
};

/** Ficha de instalación (tabla `facility`). Es el registro del fabricante: idea de RoGiz7, y nace de
 *  un hecho concreto — los rigs y los servicios de una estructura NO se ven in-game si no eres
 *  Director, y ESI tampoco los da. Así que no hay nada que deducir: lo declara quien lo sabe.
 *  Aquí NO se guardan porcentajes; los bonos se derivan del SDE con `type_id` y `rigs` al calcular. */
type Facility = {
  id: number;
  structure_id: number | null;
  name: string;
  system_id: number;
  type_id: number | null;
  has_mfg: boolean;
  /** ¿Laboratorio Standup (invención/copia/investigación ME-TE)? Lo declara el usuario, como has_mfg. */
  has_lab: boolean;
  /** ¿Reactor Standup? Solo cabe en refinerías (grupo 1406 del SDE), y esas no fabrican. */
  has_reactor: boolean;
  rigs: number[];
  /** Impuesto del centro en %. `null` = no lo has declarado · `0` = declaraste que no cobra nada.
   *  No son lo mismo: con el 0 declarado la ficha está COMPLETA. */
  tax: number | null;
  /** Impuesto POR ACTIVIDAD (JSON). Vacío = usa `tax` para todo, como hasta ahora.
   *  Existe porque el juego lo configura así: el Weaselior cobra 1% inventando y 0% en ME/TE, y
   *  una refinería lista TRES impuestos de reacción (compuestas/bioquímicas/híbridas) por separado.
   *  Claves: mfg · invention · copy · me · te · reaction_comp · reaction_bio · reaction_hyb. */
  tax_by_activity: string;
  /** Módulos Standup declarados (JSON con typeIDs). NO manda en los cálculos: de él se DERIVAN
   *  las tres casillas, que siguen siendo la fuente. Vacío = ficha de siempre, sin cambios. */
  services: string;
  eligible: boolean;
  source: string; // 'esi' descubierta · 'manual' escrita a mano
  notes: string | null;
};

/** Actividades con impuesto propio en las Upwell. El orden es el de la ficha. */
export const TAX_ACTS = [
  { k: "mfg", label: "Fabricación" },
  { k: "invention", label: "Invención" },
  { k: "copy", label: "Copia" },
  { k: "me", label: "Investigación ME" },
  { k: "te", label: "Investigación TE" },
  { k: "reaction_comp", label: "Reacciones compuestas" },
  { k: "reaction_bio", label: "Reacciones bioquímicas" },
  { k: "reaction_hyb", label: "Reacciones híbridas" },
] as const;
export type TaxAct = (typeof TAX_ACTS)[number]["k"];

/** Impuesto de UNA actividad: el declarado por actividad si existe, si no el `tax` general.
 *  Devuelve `null` si no hay ninguno de los dos — que NO es lo mismo que 0 (ver `tax`). */
export function taxFor(f: { tax: number | null; tax_by_activity?: string }, act: TaxAct): number | null {
  if (f.tax_by_activity) {
    try {
      const v = (JSON.parse(f.tax_by_activity) as Record<string, unknown>)[act];
      if (typeof v === "number" && Number.isFinite(v)) return v;
    } catch {
      // JSON corrupto: no rompemos la vista, caemos al impuesto general.
    }
  }
  return f.tax;
}
const PICK_KEY = "koru_bom_facility"; // última elegida: preferencia de UI, no dato
const OPEN_KEY = "koru_fac_open"; // registro plegado/desplegado: preferencia de UI, no dato
/** A partir de aquí el registro se pliega solo la primera vez. «Traer de ESI» soltó 27 estructuras
 *  en la primera prueba real: casi todas son sitios que ESI conoce y de los que no sabes nada. */
const FOLD_AT = 8;
/** Recargo de la CCS: 4 % del VEO, global del juego y NO configurable (verificado: 11.196 de 279.893). */
const CCS_SURCHARGE = 0.04;

/** A qué CATEGORÍA de producto aplica cada alcance de rig. **Solo los que podemos afirmar.**
 *  `AllShipManufacture` → Nave está VERIFICADO con el fixture (Bantam, categoría 6 → 20.307 exactos).
 *  Los que no están aquí (los de tamaño concreto: Small/Medium/Large/Cap, componentes…) se marcan
 *  «sin mapear» y NO se aplican: preferimos quedarnos cortos y decirlo, a inventar un bono. */
const SCOPE_CAT: Record<string, number[]> = {
  AllShipManufacture: [6], // Nave
  EquipmentManufacture: [7], // Módulo
  AmmoManufacture: [8], // Carga
  DroneManufacture: [18, 87], // Dron y Caza
  StructureManufacture: [65], // Estructura
};

/** Qué tan lejos llega esta ficha. NO es un «esto es aproximado» genérico: la fórmula está
 *  verificada al ítem contra un job real (Bantam: 20307/3808/1587/318 exactos), así que rebajarla
 *  toda por igual sería mentir a la baja. Lo que puede fallar es la FICHA, y aquí se dice cuál de
 *  sus piezas falta. La única incertidumbre que no podemos cerrar: que la estación haya cambiado
 *  desde que la declaraste — ESI no lo cuenta y Koru no puede saberlo. */
function Confianza({ f, bonos }: { f: Facility; bonos: Bonos | null }) {
  const falta: string[] = [];
  if (f.type_id == null) falta.push(tr("el tipo de estructura (sus 3 bonos)"));
  if (f.rigs.length === 0) falta.push(tr("los rigs"));
  // `null`, no `0`: un 0 declarado es un dato, no un hueco. Muchas estructuras no cobran nada, y
  // antes se quedaban en «te falta el impuesto» para siempre por no saber distinguirlo.
  if (f.tax == null) falta.push(tr("el impuesto del centro"));
  const dudosos = (bonos?.rigs ?? []).filter((r) => r.state === "unmapped").length;

  if (falta.length === 0 && dudosos === 0)
    return (
      <span
        className="bom-conf ok"
        title={tr("Ficha completa: tipo, rigs e impuesto declarados. Con estos datos la cuenta cuadra al ítem con el juego — lo verificamos contra un job real. El único margen que queda es que la estación haya cambiado desde que la rellenaste: eso ESI no lo dice y Koru no puede saberlo.")}
      >
        ✓ {tr("ficha completa")}
      </span>
    );
  return (
    <span
      className="bom-conf warn"
      title={
        (falta.length
          ? `${tr("Estimación: te falta declarar")} ${falta.join(", ")}. ${tr("Lo que falta se calcula como si no existiera, así que la cuenta se queda CORTA, nunca larga.")}`
          : "") +
        (dudosos
          ? ` ${dudosos} ${tr("rig(s) con alcance sin mapear: no los aplicamos.")}`
          : "")
      }
    >
      ~ {tr("estimación")}
      {falta.length > 0 && ` (${tr("falta")}: ${falta.length})`}
    </span>
  );
}

/** `rigSize` del SDE → etiqueta. Raitaru/Athanor = 2 (M) · Azbel/Fortizar = 3 (L) · Sotiyo = 4 (XL). */
const RIG_SIZE: Record<number, string> = { 1: "S", 2: "M", 3: "L", 4: "XL" };

/** Multiplicador del rig según la seguridad. Los valores viven en el propio rig (`sec`), pero la
 *  BANDA se decide con la seguridad REDONDEADA a un decimal: C-J6MT vale −0,29 y cuenta como −0,3. */
function secBand(sec: number): "hi" | "low" | "null" {
  const disp = Math.round(sec * 10) / 10;
  return disp >= 0.5 ? "hi" : disp >= 0.1 ? "low" : "null";
}

/** Bonos de la instalación ya resueltos desde el dato, listos para el cálculo. */
type Bonos = {
  /** Factor de material de la estructura (0.99 = −1 %). 1 = sin bono (p. ej. un Fortizar). */
  strMat: number;
  /** Factor de coste del trabajo de la estructura (0.95 = −5 %). */
  strCost: number;
  /** Rigs de la ficha con su estado para ESTE producto. */
  rigs: { id: number; name: string; mat: number; eff: number; state: "on" | "off" | "unmapped" }[];
};

/** Factor de material VERIFICADO contra el juego (fixture Bantam ME10 en Sotiyo nullsec):
 *  (1−ME) × factor_estructura × Π(1 + rig_base×mult_seguridad/100) de los rigs que APLICAN.
 *  Todo sale del SDE: el 0.99 del Sotiyo, el −2,4 del rig y el ×2,1 del nullsec. Nada a mano.
 *  ⚠️ Nunca usar el % que muestra EVE: viene redondeado (−5,0 % cuando es −5,04 %) y miente. */
function matFactor(me: number, b: Bonos | null): number {
  let f = 1 - me / 100;
  if (!b) return f;
  f *= b.strMat;
  for (const r of b.rigs) if (r.state === "on") f *= 1 + r.eff / 100;
  return f;
}

/** Cantidad real que pide EVE. `ceil`, con el mínimo de 1 por carrera. */
function matQty(base: number, runs: number, factor: number): number {
  return Math.max(runs, Math.ceil(base * runs * factor));
}

function fmtRemain(end: string | null): { text: string; ready: boolean } {
  if (!end) return { text: "-", ready: false };
  const ms = Date.parse(end) - Date.now();
  if (Number.isNaN(ms)) return { text: "-", ready: false };
  if (ms <= 0) return { text: `✅ ${tr("listo")}`, ready: true };
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  const text = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${mm}m` : `${mm}m`;
  return { text, ready: false };
}

/* ---------- F2: invención ---------- */

/** public/invention.json (extract_invention.py): 8 decryptors genéricos + skills de encriptación. */
type InventionData = {
  dec: Record<string, { n: string; prob: number; me: number; te: number; runs: number }>;
  enc: number[];
};

/** Probabilidad de invención — fórmula estándar de la comunidad (la que usan Ravworks/IPH):
 *  base × (1 + encriptación/40 + Σciencias/30) × decryptor. El juego ENSEÑA la probabilidad final
 *  en la ventana de industria, así que esto es CONTRASTABLE a simple vista — si tu pantalla dice
 *  otra cosa, la fórmula está mal y hay que arreglarla, no discutirle al juego. */
function inventionProb(base: number, enc: number, sciSum: number, decMult: number): number {
  return base * (1 + enc / 40 + sciSum / 30) * decMult;
}

/** F2 — Panel de invención de un BP T1: datacores, skills (niveles reales por ESI, editables) y
 *  la tabla por decryptor con probabilidad, BPC resultante (runs/ME/TE) y coste por intento /
 *  por ÉXITO / por run. HONESTIDAD: sin la tasa del job (pendiente de calibrar con un job real)
 *  y sin el coste de la copia del T1. */
/** Desplegable de instalación CON ICONOS REALES (petición de RoGiz7: el tipo de estructura).
 *  Un <select> nativo no admite <img> (limitación documentada), así que es un picker propio con
 *  el patrón del autocompletar del Watchlist: botón + panel. Icono = el TIPO de la estructura
 *  (Sotiyo/Raitaru/…) del Image Server; sin tipo declarado, un interrogante honesto. */
function FacilityPicker({
  usable,
  pick,
  onPick,
}: {
  usable: Facility[];
  pick: number | null;
  onPick: (id: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const cur = usable.find((f) => f.id === pick) ?? null;
  return (
    <span className="watch-search" style={{ display: "inline-block", width: "18rem", verticalAlign: "middle" }}>
      <button
        type="button"
        className="small fac-pick-btn"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
      >
        {cur ? (
          <>
            {cur.type_id != null ? (
              <img className="kind-glyph" src={typeIcon(cur.type_id, 32)} alt="" />
            ) : (
              <span>❔</span>
            )}{" "}
            {cur.name}
          </>
        ) : (
          tr("— Elige tu instalación —")
        )}
        <span className="muted"> ▾</span>
      </button>
      {open && (
        <div className="watch-ac">
          <button onMouseDown={() => { onPick(null); setOpen(false); }}>
            <span className="muted">{tr("— Elige tu instalación —")}</span>
          </button>
          {usable.map((f) => (
            <button key={f.id} onMouseDown={() => { onPick(f.id); setOpen(false); }}>
              {f.type_id != null ? (
                <img src={typeIcon(f.type_id, 32)} alt="" />
              ) : (
                <span style={{ width: 22, textAlign: "center" }}>❔</span>
              )}
              <span>{f.name}</span>
              <span className="fac-pick-svc">
                {/* Servicios con los MISMOS iconos EVE de las pestañas (regla de la casa). */}
                {f.has_mfg && (
                  <img src={typeIcon(TID_MFG_PLANT, 32)} alt="" title={tr("Fabricar")} />
                )}
                {f.has_lab && (
                  <img src={typeIcon(TID_INVENTION_LAB, 32)} alt="" title={tr("Inventar")} />
                )}
                {f.has_reactor && (
                  <img src={typeIcon(TID_COMPOSITE_REACTOR, 32)} alt="" title={tr("Reaccionar")} />
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/** public/industry_services.json (SDE): los módulos Standup, qué actividades dan y dónde encajan.
 *  Ver scripts/extract_service_modules.py. `does` son las casillas de la ficha a las que
 *  contribuye el módulo; `g`/`t`, dónde cabe (grupo de estructura / tipos concretos). */
type ServiceMod = {
  n: { es: string; en: string };
  acts: string[];
  does: string[];
  g: number[];
  t: number[];
};
type ServiceCat = { mods: Record<string, ServiceMod> };

/** Advanced Industry (−3% de tiempo por nivel): la parte de skills del tiempo de invención. */
const ADV_INDUSTRY_SKILL = 3388;
/** Industry (−4% de tiempo de fabricación por nivel). Factores VERIFICADOS contra el fixture del
 *  Bantam: Industry V × Advanced Industry V = 0,80 × 0,85 = 0,68 (multiplicativos). */
const INDUSTRY_SKILL = 3380;
/** Iconos EVE de los servicios (regla de la casa: iconografía EVE primero; typeIDs verificados
 *  en market_types.json): 35878 Standup Manufacturing Plant I · 35886 Standup Invention Lab I. */
const TID_MFG_PLANT = 35878;
const TID_INVENTION_LAB = 35886;
/** 45537 Standup Composite Reactor I — el icono del servicio de reacción. */
const TID_COMPOSITE_REACTOR = 45537;
/** Science (−5 % de tiempo por nivel en los trabajos de ciencia: copia e investigación).
 *  Verificado con el fixture del Apostle: Science V × Advanced Industry V = 0,75 × 0,85 = 0,6375,
 *  que es el «−36,3 %» que enseñó el juego. */
const SCIENCE_SKILL = 3402;
/** Reactions (45746): −4 % de tiempo de reacción por nivel. Verificado contra el fixture del
 *  Tatara — el juego enseñó «Habilidades e implantes −20,0 %», que es exactamente el nivel V. */
const REACTIONS_SKILL = 45746;

function InventionBlock({
  bpId,
  inv,
  ind,
  nameOf,
  subject,
  lab,
  noLabPicked,
  ir,
  sys,
  stock,
  inFacility,
  vols,
}: {
  bpId: number;
  inv: InventionData;
  ind: BpIndustry;
  nameOf: (tid: number) => string;
  subject: number | "global";
  /** La instalación del desplegable ÚNICO de arriba, SI tiene laboratorio (si no, null). */
  lab: Facility | null;
  /** true = hay instalación elegida pero sin Lab (para avisar con precisión). */
  noLabPicked: boolean;
  ir: IndustryRigs | null;
  sys: { id: number; n: string; s: number }[] | null;
  /** Stock que manda (en la instalación si se conoce, si no el total) + volúmenes: la lista de
   *  compra/transporte del MODO invención son los datacores que faltan. */
  stock: Map<number, number> | null;
  inFacility: boolean;
  vols: Map<number, number>;
}) {
  const act = ind[String(bpId)]?.i;
  const [prices, setPrices] = useState<Map<number, number>>(new Map());
  const [adjInv, setAdjInv] = useState<Map<number, number>>(new Map());
  /** Niveles de las skills (las 3 de la invención + Advanced Industry para el tiempo):
   *  precargados de ESI (nivel ACTIVO) y editables a mano. */
  const [lvls, setLvls] = useState<Map<number, number>>(new Map());
  // F2b — el laboratorio viene del desplegable ÚNICO de arriba (prop `lab`). De él salen índice
  // del sistema, banda de seguridad (multiplicador de los rigs de lab), bonos e impuesto.
  const [labIdx, setLabIdx] = useState<Record<string, number> | null>(null);
  /** Cuántas unidades T2 quieres: la entrada de la cadena hacia atrás (BPCs → intentos → copias). */
  const [want, setWant] = useState(1);
  // Leyenda «¿quién es tu mejor inventor?» (idea de RoGiz7): skills de TODOS los personajes para
  // esta invención. Clic en un chip → carga sus niveles en el simulador.
  const [allChars, setAllChars] = useState<
    { character_id: number; name: string; levels: Record<number, number> }[] | null
  >(null);

  const skIds = useMemo(() => (act?.sk ?? []).map(([s]) => s), [act]);
  const t2bp0 = act?.out?.[0]?.[0];
  useEffect(() => {
    const ids = [
      ...(act?.in ?? []).map(([tid]) => tid),
      ...Object.keys(inv.dec).map(Number),
    ];
    if (ids.length)
      invoke<Record<number, number>>("get_type_prices", { ids })
        .then((r) => setPrices(new Map(Object.entries(r).map(([k, v]) => [Number(k), v]))))
        .catch(() => setPrices(new Map()));
    // VEO de invención — CANDIDATO a calibrar: materiales BASE de 1 run del BP T2 × adjusted.
    // El fixture real dio VEO 263.050 (HH I→HH II): el panel lo enseña para compararlo en vivo.
    const t2in = t2bp0 != null ? (ind[String(t2bp0)]?.m?.in ?? []) : [];
    if (t2in.length)
      invoke<Record<number, number>>("get_type_adjusted_prices", { ids: t2in.map(([t]) => t) })
        .then((r) => setAdjInv(new Map(Object.entries(r).map(([k, v]) => [Number(k), v]))))
        .catch(() => setAdjInv(new Map()));
  }, [act, inv, ind, t2bp0]);
  useEffect(() => {
    const all = [...skIds, ADV_INDUSTRY_SKILL];
    if (typeof subject !== "number" || skIds.length === 0) {
      // Global o sin skills: niveles por defecto 3 (se pueden ajustar a mano).
      setLvls(new Map(all.map((s) => [s, 3])));
      return;
    }
    invoke<Record<number, number>>("get_skill_levels", { characterId: subject, ids: all })
      .then((r) => setLvls(new Map(Object.entries(r).map(([k, v]) => [Number(k), v]))))
      .catch(() => setLvls(new Map(all.map((s) => [s, 3]))));
  }, [subject, skIds]);
  useEffect(() => {
    if (skIds.length === 0) return;
    invoke<{ character_id: number; name: string; levels: Record<number, number> }[]>(
      "get_skill_levels_all",
      { ids: [...skIds, ADV_INDUSTRY_SKILL] },
    )
      .then(setAllChars)
      .catch(() => setAllChars(null));
  }, [skIds]);

  const labSys = useMemo(
    () => (lab ? (sys ?? []).find((x) => x.id === lab.system_id) ?? null : null),
    [sys, lab],
  );
  useEffect(() => {
    if (!lab) {
      setLabIdx(null);
      return;
    }
    invoke<Record<string, number>>("get_industry_index", { systemId: lab.system_id })
      .then(setLabIdx)
      .catch(() => setLabIdx(null));
  }, [lab?.system_id]);

  if (!act) return null;
  const [t2bp, baseRuns, baseProb] = act.out[0] as [number, number, number];
  const t2prod = ind[String(t2bp)]?.m?.out?.[0]?.[0] ?? null;

  // ---- F2b: la tasa del job de invención, con la fórmula VERIFICADA AL ISK contra el fixture
  // (HH I→HH II, 739 ISK): CTB = 2% del VEO → bruto = CTB × índice(invention) → bonificaciones
  // MULTIPLICATIVAS de rigs de lab (× banda de seguridad) y estructura → + impuestos SOBRE el CTB
  // (centro + CCS 4%). El VEO es el único CANDIDATO sin verificar (materiales del T2 a adjusted).
  const veoInv = (t2bp != null ? (ind[String(t2bp)]?.m?.in ?? []) : []).reduce(
    (a, [tid, q]) => a + q * (adjInv.get(tid) ?? 0),
    0,
  );
  const fee = (() => {
    if (!lab || !ir || labIdx?.invention == null || veoInv <= 0) return null;
    const ctb = veoInv * 0.02;
    const band = labSys ? secBand(labSys.s) : "hi";
    let f = 1;
    for (const id of lab.rigs) {
      const r = ir.rigs[String(id)];
      // Los rigs de LABORATORIO aplican a la invención SIN filtro de producto (Hoboleaks:
      // entradas cost/time sin filterID = universales). Solo cuentan los que dan bono de coste.
      if (r && r.mat === 0 && r.cost !== 0) f *= 1 + (r.cost * (r.sec[band] ?? 1)) / 100;
    }
    const sd = lab.type_id != null ? ir.structures[String(lab.type_id)] : null;
    const brutoTotal = ctb * labIdx.invention * f * (sd?.cost ?? 1);
    // Impuesto de INVENCIÓN: el fixture de RoGiz7 destapó que su Weaselior cobra 1 % inventando y
    // 0 % en ME/TE, así que el general no siempre vale. `taxFor` cae al general si no se declaró.
    const taxes = ctb * ((taxFor(lab, "invention") ?? 0) / 100 + CCS_SURCHARGE);
    // Desglose para el tooltip: espejo del tooltip del juego, para cazar desviaciones al vuelo.
    return {
      total: brutoTotal + taxes,
      ctb,
      idx: labIdx.invention,
      rigF: f,
      strF: sd?.cost ?? 1,
      strKnown: sd != null,
      taxes,
      nRigs: lab.rigs.length,
    };
  })();
  // Tiempo por intento: base × (1 − 3%·Advanced Industry) × rigs de tiempo × estructura.
  // Verificado al segundo contra el fixture (15900×0,85×0,496×0,70 = 1:18:12). Implantes no
  // contemplados (el juego los mete en la misma línea de skills).
  const timePerTry = (() => {
    if (!lab || !ir) return null;
    const band = labSys ? secBand(labSys.s) : "hi";
    let f = 1;
    for (const id of lab.rigs) {
      const r = ir.rigs[String(id)];
      if (r && r.mat === 0 && r.time !== 0) f *= 1 + (r.time * (r.sec[band] ?? 1)) / 100;
    }
    const sd = lab.type_id != null ? ir.structures[String(lab.type_id)] : null;
    const ai = lvls.get(ADV_INDUSTRY_SKILL) ?? 0;
    return act.t * (1 - 0.03 * ai) * f * (sd?.time ?? 1);
  })();
  const encSet = new Set(inv.enc);
  // Generalizado: 1 encriptación + N ciencias (102 invenciones del catálogo no siguen el 1+2 exacto).
  const encLvl = skIds.filter((s) => encSet.has(s)).reduce((a, s) => a + (lvls.get(s) ?? 0), 0);
  const sciSum = skIds.filter((s) => !encSet.has(s)).reduce((a, s) => a + (lvls.get(s) ?? 0), 0);
  const attemptBase = (act.in ?? []).reduce((a, [tid, q]) => a + q * (prices.get(tid) ?? 0), 0);
  const missingPrice = (act.in ?? []).some(([tid]) => prices.get(tid) == null);

  type DecRow = { id: number | null; n: string; prob: number; me: number; te: number; runs: number };
  const decRows: DecRow[] = [
    { id: null, n: tr("Sin decryptor"), prob: 1, me: 0, te: 0, runs: 0 },
    ...Object.entries(inv.dec).map(([id, d]) => ({ id: Number(id), ...d })),
  ];
  // La mejor fila por coste/run (solo comparable si hay precios). La tasa del job entra en
  // TODOS los intentos por igual (no cambia el ranking entre decryptors, sí el número honesto).
  const costPerRun = (r: DecRow): number => {
    const p = inventionProb(baseProb, encLvl, sciSum, r.prob);
    const attempt = attemptBase + (r.id != null ? (prices.get(r.id) ?? 0) : 0) + (fee?.total ?? 0);
    const runs = baseRuns + r.runs;
    return p > 0 && runs > 0 ? attempt / (p * runs) : Infinity;
  };
  const best = decRows.reduce((a, b) => (costPerRun(b) < costPerRun(a) ? b : a), decRows[0]);
  /** Cuántas unidades T2 quieres: la entrada de la cadena hacia atrás. */
  const fmtTry = (s: number) => {
    const m = Math.round(s / 60);
    return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
  };

  return (
    <div className="bom-cost small">
      <div className="bom-cost-row">
        <span>
          <img className="kind-glyph" src={typeIcon(TID_INVENTION_LAB, 32)} alt="" />{" "}
          <strong>{tr("Invención")}</strong> → {t2prod != null && (
            <img className="kind-glyph" src={typeIcon(t2prod, 32)} alt="" />
          )}{" "}
          {t2prod != null ? nameOf(t2prod) : nameOf(t2bp)}
        </span>
        <span className="muted">{tr("base")} {(baseProb * 100).toFixed(0)}%</span>
      </div>

      {/* CADENA HACIA ATRÁS: «quiero N unidades T2» → BPCs → intentos → RUNS DE BPC T1 A COPIAR.
          El eslabón de la copia es el que faltaba para que un plan T2 fuera completo. La regla la
          fija la documentación oficial: «se utilizará UNA iteración de producción con licencia por
          cada iteración de invención, independientemente de si el trabajo tiene éxito o no» → un
          intento = una RUN del BPC T1 (no la copia entera), y se gasta aunque falle.
          Todo esto es ESPERANZA, no promesa: con un 44 % puedes tener suerte o no tenerla. */}
      {(() => {
        const p = inventionProb(baseProb, encLvl, sciSum, best.prob);
        const runsPorBpc = baseRuns + best.runs;
        const porRun = t2bp != null ? ind[String(t2bp)]?.m?.out?.[0]?.[1] ?? 1 : 1;
        const porBpc = runsPorBpc * porRun;
        if (!(p > 0) || porBpc <= 0) return null;
        const bpcs = Math.ceil(want / porBpc);
        const intentos = Math.ceil(bpcs / p);
        return (
          <div className="bom-cost-row">
            <span>
              {tr("Para")}{" "}
              <input
                type="number"
                min="1"
                value={want}
                onChange={(e) => setWant(Math.max(1, Number(e.target.value) || 1))}
                style={{ width: "5rem", textAlign: "right" }}
              />{" "}
              {t2prod != null ? nameOf(t2prod) : tr("unidades")}
            </span>
            <span
              title={`${tr("Con la mejor fila")} (${best.n}): ${(p * 100).toFixed(1)}% · ${runsPorBpc} runs/BPC × ${porRun} ${tr("por run")}`}
            >
              {fmtSp(bpcs)} {tr("BPC T2")} · <strong>{fmtSp(intentos)}</strong> {tr("intentos")} ·{" "}
              <strong>{fmtSp(intentos)}</strong> {tr("runs de BPC T1 a copiar")}
            </span>
          </div>
        );
      })()}
      <div className="bom-cost-row muted">
        <span>{(act.in ?? []).map(([tid, q]) => `${q}× ${nameOf(tid)}`).join(" + ")}</span>
        <span>{fmtIsk(attemptBase)}</span>
      </div>
      {/* Qué comprar/transportar EN ESTE MODO: los datacores que faltan (contra el stock de la
          instalación si se conoce). El decryptor va aparte porque depende de la fila que elijas. */}
      {stock != null &&
        (() => {
          let isk = 0;
          let m3 = 0;
          const missing = (act.in ?? [])
            .map(([tid, q]) => ({ tid, q, miss: Math.max(0, q - (stock.get(tid) ?? 0)) }))
            .filter((x) => x.miss > 0);
          for (const x of missing) {
            isk += x.miss * (prices.get(x.tid) ?? 0);
            m3 += x.miss * (vols.get(x.tid) ?? 0);
          }
          return missing.length === 0 ? (
            <div className="bom-cost-row muted">
              <span>
                <img className="kind-glyph" src={typeIcon(act.in?.[0]?.[0] ?? 20419, 32)} alt="" />{" "}
                {inFacility ? tr("Datacores: ya están EN la instalación") : tr("Datacores: los tienes")}
              </span>
              <span>✓</span>
            </div>
          ) : (
            <div className="bom-cost-row muted">
              <span>
                <img className="kind-glyph" src={typeIcon(act.in?.[0]?.[0] ?? 20419, 32)} alt="" />{" "}
                {tr("Datacores que faltan")}: {missing.map((x) => `${x.miss}× ${nameOf(x.tid)}`).join(" + ")}
              </span>
              <span>
                {fmtIsk(isk)} · {m3 < 1 ? m3.toFixed(1) : fmtSp(Math.ceil(m3))} m³
              </span>
            </div>
          );
        })()}
      {/* F2b — Laboratorio: la MISMA instalación del desplegable de arriba (si tiene 🔬). */}
      <div className="bom-cost-row muted">
        <span>
          <img className="kind-glyph" src={typeIcon(TID_INVENTION_LAB, 32)} alt="" /> {tr("Laboratorio")}
        </span>
        <span>
          {lab
            ? `${lab.name}${labIdx?.invention != null ? ` · ${tr("índice")} ${(labIdx.invention * 100).toFixed(2)}%` : ""}`
            : noLabPicked
              ? tr("la instalación elegida no tiene laboratorio declarado (marca 🔬 «Lab» en su ficha)")
              : tr("elige arriba una instalación con laboratorio — sin ella falta la tasa del job")}
        </span>
      </div>
      {fee != null && (
        <div className="bom-cost-row muted">
          <span>{tr("Tasa del job por intento")}{timePerTry != null ? ` · ⏱ ${fmtTry(timePerTry)}` : ""}</span>
          {/* Desglose en el title = el espejo del tooltip del juego, para cazar desviaciones al
              instante (CTB → índice → rigs → estructura → impuestos). */}
          <span
            style={{ cursor: "help" }}
            title={`CTB (2% VEO): ${fmtIsk(fee.ctb)} · ${tr("índice")} ${(fee.idx * 100).toFixed(2)}% · rigs ×${fee.rigF.toFixed(3)} (${fee.nRigs} ${tr("declarados")}) · ${tr("estructura")} ×${fee.strF.toFixed(2)}${fee.strKnown ? "" : ` ⚠ ${tr("tipo de estructura no resuelto")}`} · ${tr("impuestos")} ${fmtIsk(fee.taxes)}`}
          >
            +{fmtIsk(fee.total)}
          </span>
        </div>
      )}
      {lab && veoInv > 0 && (
        <div className="bom-cost-row muted">
          <span title={tr("VEO de invención (candidato: materiales del T2 a adjusted — compáralo con el tooltip del juego)")}>
            {tr("VEO de invención")}
          </span>
          <span>{fmtIsk(veoInv)}</span>
        </div>
      )}
      {/* Skills: nivel ACTIVO real del personaje (ESI), editable para simular. */}
      <div className="bom-cost-row muted">
        <span>{tr("Skills (nivel activo; toca para simular)")}</span>
        <span>
          {[...skIds, ADV_INDUSTRY_SKILL].map((s) => (
            <label key={s} style={{ marginLeft: "0.6rem" }} title={s === ADV_INDUSTRY_SKILL ? `${nameOf(s)} (${tr("tiempo")})` : nameOf(s)}>
              {s === ADV_INDUSTRY_SKILL ? "⏱ " : ""}
              {nameOf(s).replace(/^Datacore - /, "").slice(0, 22)}{" "}
              <select
                className="small"
                value={lvls.get(s) ?? 3}
                onChange={(e) => setLvls(new Map(lvls).set(s, Number(e.target.value)))}
              >
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          ))}
        </span>
      </div>
      {/* ¿Quién es tu MEJOR inventor? Retratos reales, ordenados por su probabilidad (sin
          decryptor) con SUS skills. Clic en uno → el simulador carga sus niveles. */}
      {allChars && allChars.length > 0 && (
        <div className="bom-cost-row muted">
          <span>{tr("Tus inventores (clic = usar sus niveles)")}</span>
          <span>
            {allChars
              .map((c) => {
                const enc = skIds
                  .filter((s) => encSet.has(s))
                  .reduce((a, s) => a + (c.levels[s] ?? 0), 0);
                const sci = skIds
                  .filter((s) => !encSet.has(s))
                  .reduce((a, s) => a + (c.levels[s] ?? 0), 0);
                return { c, p: inventionProb(baseProb, enc, sci, 1) };
              })
              .sort((a, b) => b.p - a.p)
              .map(({ c, p }, i) => (
                <button
                  key={c.character_id}
                  className="pp-tag"
                  style={{ marginLeft: "0.4rem", cursor: "pointer" }}
                  title={`${c.name}: ${[...skIds, ADV_INDUSTRY_SKILL].map((s) => `${nameOf(s).replace(/^Datacore - /, "")} ${c.levels[s] ?? 0}`).join(" · ")}`}
                  onClick={() =>
                    setLvls(
                      new Map(
                        [...skIds, ADV_INDUSTRY_SKILL].map((s) => [s, c.levels[s] ?? 0]),
                      ),
                    )
                  }
                >
                  <img
                    className="kind-glyph"
                    src={`https://images.evetech.net/characters/${c.character_id}/portrait?size=32`}
                    alt=""
                    style={{ borderRadius: "50%", width: 16, height: 16, verticalAlign: -3 }}
                  />{" "}
                  {i === 0 ? "★ " : ""}
                  {c.name} {(p * 100).toFixed(1)}%
                </button>
              ))}
          </span>
        </div>
      )}

      <table className="small sig-table" style={{ marginTop: "0.3rem" }}>
        <thead>
          <tr className="sig-th">
            <th>{tr("Decryptor")}</th>
            <th style={{ textAlign: "right" }}>{tr("Prob.")}</th>
            <th style={{ textAlign: "right" }}>{tr("BPC (runs · ME/TE)")}</th>
            <th style={{ textAlign: "right" }}>{tr("Intento")}</th>
            <th style={{ textAlign: "right" }}>{tr("Por ÉXITO")}</th>
            <th style={{ textAlign: "right" }}>{tr("Por run")}</th>
          </tr>
        </thead>
        <tbody>
          {decRows.map((r) => {
            const p = inventionProb(baseProb, encLvl, sciSum, r.prob);
            const attempt = attemptBase + (r.id != null ? (prices.get(r.id) ?? 0) : 0) + (fee?.total ?? 0);
            const runs = baseRuns + r.runs;
            const isBest = r === best && !missingPrice;
            return (
              <tr key={r.id ?? 0} className={isBest ? "bom-ok" : ""}>
                <td style={{ whiteSpace: "nowrap" }}>
                  {r.id != null && <img className="kind-glyph" src={typeIcon(r.id, 32)} alt="" style={{ width: 16, height: 16 }} />}{" "}
                  {r.n}
                  {isBest && <span className="bom-verdict build" title={tr("El coste por run del BPC más barato con estos precios y skills")}> ★ {tr("mejor")}</span>}
                </td>
                <td style={{ textAlign: "right" }}>{(p * 100).toFixed(1)}%</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {runs} · ME{2 + r.me}/TE{4 + r.te}
                </td>
                <td style={{ textAlign: "right" }}>{fmtIsk(attempt)}</td>
                <td style={{ textAlign: "right" }}>{p > 0 ? fmtIsk(attempt / p) : "—"}</td>
                <td style={{ textAlign: "right" }}>{p > 0 && runs > 0 ? fmtIsk(attempt / (p * runs)) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="muted" style={{ marginTop: "0.25rem" }}>
        {missingPrice && <>⚠ {tr("Falta el precio de algún datacore: los costes se quedan cortos.")} </>}
        {fee != null
          ? tr("Coste = datacores + decryptor + tasa del job (fórmula verificada al ISK contra un job real; el VEO es candidato — compáralo arriba). Sin el coste de la copia del T1.")
          : tr("Coste = datacores + decryptor, SIN la tasa del job (elige laboratorio). Sin el coste de la copia del T1.")}{" "}
        {tr("La probabilidad es la fórmula estándar — compárala con la que enseña tu ventana de industria.")}
      </div>
    </div>
  );
}

/** Sección Industria = jobs + biblioteca de blueprints.
 *  La biblioteca se pinta SIEMPRE: vive de otro scope (read_blueprints) y no debe desaparecer
 *  porque este personaje no tenga jobs (o no haya concedido el scope de jobs). */
export function IndustryView(props: {
  jobs: JobView[] | null;
  busy: boolean;
  global?: boolean;
  subject: number | "global";
}) {
  // El registro de instalaciones vive aquí arriba para que el árbol BOM (abajo, en la biblioteca)
  // se entere cuando editas una ficha: `facsVersion` sube y el BomPanel recarga de la BD.
  const [facsVersion, setFacsVersion] = useState(0);
  return (
    <>
      <JobsBlock jobs={props.jobs} busy={props.busy} global={props.global} />
      <ProduccionBlock subject={props.subject} global={props.global} />
      <FacilitiesBlock onChange={() => setFacsVersion((v) => v + 1)} />
      <BlueprintLibrary
        subject={props.subject}
        global={props.global}
        facsVersion={facsVersion}
      />
    </>
  );
}

function JobsBlock({
  jobs,
  busy,
  global,
}: {
  jobs: JobView[] | null;
  busy: boolean;
  global?: boolean;
}) {
  const [act, setAct] = useState<string>("all");
  if (!jobs && busy) return <p className="muted">{tr("Cargando…")}</p>;
  if (!jobs) return <p className="muted small">{tr("Sin datos.")}</p>;

  const isReady = (j: JobView) =>
    j.status === "ready" || j.status === "delivered" || fmtRemain(j.end_date).ready;
  const readyCount = jobs.filter(isReady).length;
  // Próximo en terminar (entre los que aún no están listos).
  const upcoming = jobs
    .filter((j) => j.end_date && !isReady(j))
    .sort((a, b) => Date.parse(a.end_date!) - Date.parse(b.end_date!));
  const nextEta = upcoming[0] ? fmtRemain(upcoming[0].end_date).text : "—";

  const activities = [...new Set(jobs.map((j) => j.activity))];
  const shown = act === "all" ? jobs : jobs.filter((j) => j.activity === act);
  // Listos primero, luego por fecha de fin.
  const ordered = [...shown].sort((a, b) => {
    const ra = isReady(a) ? 0 : 1;
    const rb = isReady(b) ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return Date.parse(a.end_date ?? "9999") - Date.parse(b.end_date ?? "9999");
  });

  return (
    <>
      <div className="kpis">
        <Kpi label={tr("Jobs activos")} value={fmtSp(jobs.length)} />
        <Kpi label={tr("Listos para recoger")} value={fmtSp(readyCount)} tone={readyCount > 0 ? "pos" : undefined} />
        <Kpi label={tr("Próximo en terminar")} value={nextEta} />
      </div>

      {activities.length > 1 && (
        <div className="rateo-controls">
          <div className="seg seg-sm">
            <button className={act === "all" ? "active" : ""} onClick={() => setAct("all")}>
              {tr("Todas")}
            </button>
            {activities.map((a) => (
              <button key={a} className={act === a ? "active" : ""} onClick={() => setAct(a)}>
                {a}
              </button>
            ))}
          </div>
        </div>
      )}

      <h4>{tr("Jobs de industria")}</h4>
      {ordered.length === 0 ? (
        <p className="muted small">{tr("Sin jobs activos.")}</p>
      ) : (
        <table className="km-table">
          <thead>
            <tr>
              {global && <th>{tr("Personaje")}</th>}
              <th>{tr("Actividad")}</th>
              <th>{tr("Producto / Blueprint")}</th>
              <th>{tr("Runs")}</th>
              <th>{tr("Estado")}</th>
              <th>{tr("Restante")}</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((j) => {
              const rem = fmtRemain(j.end_date);
              return (
                <tr key={j.job_id} className={rem.ready ? "job-ready" : ""}>
                  {global && <td>{j.character ?? "-"}</td>}
                  <td>{j.activity}</td>
                  <td>{j.product_name ?? j.blueprint_name ?? "-"}</td>
                  <td>{j.runs}</td>
                  <td>{j.status ?? "-"}</td>
                  <td>{rem.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

/* ---------- F3: PRODUCCIÓN (el histórico que ESI ya no te devuelve) ---------- */

/** Una fila de `industry_job`, vestida por `get_industry_history`. */
type JobHistoryRow = {
  job_id: number;
  character_id: number;
  activity: string;
  runs: number;
  successful_runs: number | null;
  probability: number | null;
  cost: number | null;
  status: string | null;
  blueprint_name: string | null;
  blueprint_type_id: number;
  product_name: string | null;
  product_type_id: number | null;
  start_date: string | null;
  end_date: string | null;
  completed_date: string | null;
};
type JobHistory = { jobs: JobHistoryRow[]; total: number; since: string | null };

/** Actividades cuyo producto es un OBJETO con precio de mercado. Las demás sacan BPCs (invención,
 *  copia) o no sacan nada (ME/TE), y **un BPC no tiene valor en Koru en ninguna sección** — es la
 *  regla que pidió RoGiz7 y aquí sale gratis: valorar una copia por el precio del objeto que
 *  fabricaría convertiría un plano de 50 M en cincuenta millones que no tienes. */
const ACT_CON_PRODUCTO = new Set(["Manufacturing", "Reactions"]);

/** ¿La diferencia entre lo esperado y lo conseguido cabe en el azar? Una desviación típica es el
 *  listón deliberadamente BAJO: si ni siquiera lo pasa, no hay nada que contar. Con σ = 0 (un solo
 *  trabajo, o probabilidad 0/1) se considera normal — no hay variación de la que hablar. */
function normal(inv: { exitos: number; esperados: number; sigma: number }): boolean {
  return inv.sigma <= 0 || Math.abs(inv.exitos - inv.esperados) <= inv.sigma;
}

/** El día (YYYY-MM-DD) en que un trabajo cuenta como producido: cuando se recogió, y si no, cuando
 *  terminó el reloj. `first_seen` NO vale — es cuándo lo vio Koru, no cuándo pasó. */
function diaDeJob(j: JobHistoryRow): string | null {
  const d = j.completed_date ?? j.end_date;
  return d ? d.slice(0, 10) : null;
}

/** ¿El producto de este trabajo EXISTE ya?
 *
 * ⚠️ Esto no es un detalle: sin ello, «unidades producidas» sumaba lo que aún está en el horno y el
 * titular de la sección mentía por lo que tuvieras lanzado en ese momento. `delivered` es entregado
 * y `ready` es terminado sin recoger — en los dos casos el objeto ya se fabricó. `active` y
 * `paused` todavía no, y `cancelled`/`reverted` no llegaron a existir.
 *
 * Se es CONSERVADOR con el estado tal cual lo dijo ESI la última vez: si un trabajo acabó hace una
 * hora pero el último sync lo vio `active`, no cuenta. Preferimos quedarnos cortos a inventarnos
 * una entrega mirando el reloj. */
function haSalido(j: JobHistoryRow): boolean {
  return j.status === "delivered" || j.status === "ready";
}

/**
 * F3 — **Producción**: lo que ha salido del horno, con el dinero que ESI solo enseña una vez.
 *
 * ## Por qué existe y por qué llega tarde
 * `industry_job` se llena desde el 2026-08-06 porque ESI mira **90 días atrás y ni uno más**: lo
 * que no se guardara en esa ventana se perdía para siempre, así que se guardó antes de que hubiera
 * ninguna pantalla que lo enseñara. Esta es esa pantalla.
 *
 * ## ⚠️ LO QUE ESTA VISTA **NO** DICE, y se dice en alto
 * **No es tu beneficio.** ESI no ata los materiales a un trabajo: sabe que fabricaste 100 obuses y
 * lo que pagaste de TASA, pero no de dónde salió el tritanio ni a cómo. Restar solo la tasa daría
 * un «beneficio» inflado que parecería un dato. Así que aquí hay tres cifras separadas y ninguna
 * pretende ser la cuarta: lo que salió (a precio de mercado), lo que costó instalarlo, y desde
 * cuándo se mira.
 *
 * ## La joya: esperanza contra realidad en invención
 * Es lo único de todo esto que se puede afirmar **sin ninguna estimación**, porque ESI da los dos
 * lados: la probabilidad que declaró al instalar cada trabajo y cuántas carreras salieron bien. Y
 * va con su desviación típica, porque con pocos intentos «vas por debajo» no significa nada — la
 * binomial se mueve mucho, y un panel que grite mala suerte con 12 intentos estaría mintiendo con
 * aritmética correcta.
 */
function ProduccionBlock({
  subject,
  global,
}: {
  subject: number | "global";
  global?: boolean;
}) {
  const [hist, setHist] = useState<JobHistory | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ind, setInd] = useState<BpIndustry | null>(null);
  const [precios, setPrecios] = useState<Record<number, number>>({});
  const [nombres, setNombres] = useState<Record<number, string>>({});
  const [act, setAct] = useState<string>("all");
  const [dias, setDias] = useState<number>(0); // 0 = todo lo que haya
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    setHist(null);
    setErr(null);
    invoke<JobHistory>("get_industry_history", {
      characterId: subject === "global" ? null : subject,
      limit: 2000,
    })
      .then(setHist)
      // Sin `catch` esto sería un bloque que no aparece nunca y nadie sabría por qué. La regla del
      // overlay: si algo se rechaza, que se vea.
      .catch((e) => setErr(String(e)));
  }, [subject]);

  useEffect(() => {
    fetch("/bp_industry.json").then((r) => r.json()).then(setInd).catch(() => setInd({}));
    invoke<{ character_id: number; name: string }[]>("list_characters")
      .then((cs) => setNombres(Object.fromEntries(cs.map((c) => [c.character_id, c.name]))))
      .catch(() => setNombres({}));
  }, []);

  // Precios SOLO de los productos que de verdad salieron. `get_type_prices` no toca la red (lee
  // `average_price` ya guardado), así que abrir la sección no dispara una ráfaga a ESI.
  useEffect(() => {
    if (!hist) return;
    const ids = [
      ...new Set(
        hist.jobs
          .filter((j) => ACT_CON_PRODUCTO.has(j.activity) && j.product_type_id)
          .map((j) => j.product_type_id as number),
      ),
    ];
    if (ids.length === 0) return;
    invoke<Record<number, number>>("get_type_prices", { ids })
      .then(setPrecios)
      .catch(() => setPrecios({}));
  }, [hist]);

  /** Unidades que salen de UNA carrera de este plano. Sin esto se valoraría por carreras y un
   *  plano de munición (200 por carrera) se quedaría corto por dos órdenes de magnitud. */
  function porCarrera(j: JobHistoryRow): number | null {
    const e = ind?.[String(j.blueprint_type_id)];
    const a = j.activity === "Reactions" ? e?.r : e?.m;
    const q = a?.out?.[0]?.[1];
    return typeof q === "number" && q > 0 ? q : null;
  }

  const filtradas = useMemo(() => {
    if (!hist) return [];
    const corte = dias > 0 ? Date.now() - dias * 86400000 : 0;
    return hist.jobs.filter((j) => {
      if (act !== "all" && j.activity !== act) return false;
      if (corte > 0) {
        const d = diaDeJob(j);
        if (!d || Date.parse(`${d}T00:00:00Z`) < corte) return false;
      }
      return true;
    });
  }, [hist, act, dias]);

  /** Valor de lo producido y qué parte de él es una estimación coja. `sinPrecio` y `sinPlano` se
   *  CUENTAN en vez de tratarse como ceros: un total al que le faltan cosas y no lo dice es peor
   *  que no dar total. */
  const eco = useMemo(() => {
    let valor = 0;
    let tasas = 0;
    let unidades = 0;
    let sinPrecio = 0;
    let sinPlano = 0;
    let enElHorno = 0;
    const porProducto = new Map<string, number>();
    const porPersonaje = new Map<number, number>();
    for (const j of filtradas) {
      // La TASA se paga al instalar, así que cuenta aunque el trabajo siga corriendo o lo cancelaras.
      // El VALOR no: eso solo existe cuando el objeto existe.
      tasas += j.cost ?? 0;
      if (!ACT_CON_PRODUCTO.has(j.activity) || !j.product_type_id) continue;
      if (!haSalido(j)) {
        if (j.status === "active" || j.status === "paused") enElHorno++;
        continue;
      }
      const uds = porCarrera(j);
      if (uds === null) {
        sinPlano++;
        continue;
      }
      const p = precios[j.product_type_id];
      const n = j.runs * uds;
      unidades += n;
      if (!p) {
        sinPrecio++;
        continue;
      }
      const v = n * p;
      valor += v;
      const k = j.product_name ?? String(j.product_type_id);
      porProducto.set(k, (porProducto.get(k) ?? 0) + v);
      porPersonaje.set(j.character_id, (porPersonaje.get(j.character_id) ?? 0) + v);
    }
    return { valor, tasas, unidades, sinPrecio, sinPlano, enElHorno, porProducto, porPersonaje };
  }, [filtradas, precios, ind]);

  /** ★ Invención: lo declarado contra lo salido. Sin estimar nada — los dos lados son de ESI.
   *  σ es la binomial (Σ n·p·(1−p)): sirve para saber si la diferencia es suerte o es un dato. */
  const inv = useMemo(() => {
    // Solo trabajos TERMINADOS: un intento en curso no ha fallado, todavía no ha pasado nada. Meterlo
    // contaría como fracaso lo que aún no ha ocurrido y hundiría la tasa real sin motivo.
    const j = filtradas.filter(
      (x) =>
        x.activity === "Invention" &&
        x.probability != null &&
        x.successful_runs != null &&
        haSalido(x),
    );
    let intentos = 0;
    let esperados = 0;
    let varianza = 0;
    let exitos = 0;
    for (const x of j) {
      const p = x.probability as number;
      intentos += x.runs;
      esperados += x.runs * p;
      varianza += x.runs * p * (1 - p);
      exitos += x.successful_runs as number;
    }
    const sigma = Math.sqrt(varianza);
    return { trabajos: j.length, intentos, esperados, exitos, sigma };
  }, [filtradas]);

  const actividades = useMemo(
    () => [...new Set((hist?.jobs ?? []).map((j) => j.activity))],
    [hist],
  );

  if (err) return <p className="small fits-err">{tr("Producción")}: {err}</p>;
  if (!hist) return null;

  const desde = hist.since ? hist.since.slice(0, 10) : null;
  const ordenadas = [...filtradas].sort(
    (a, b) => Date.parse(diaDeJob(b) ?? "0") - Date.parse(diaDeJob(a) ?? "0"),
  );

  return (
    <section className="prod-block">
      <h4>
        {tr("Producción")}{" "}
        <span className="muted small">{tr("(lo que ya salió del horno)")}</span>
      </h4>

      {hist.total === 0 ? (
        <p className="muted small">
          {tr(
            "Todavía no hay ningún trabajo guardado. Koru empieza a grabar en cuanto lances el primero; ESI solo mira 90 días atrás, así que lo de antes ya no está.",
          )}
        </p>
      ) : (
        <>
          {/* LA CEGUERA, ARRIBA Y NO EN UN PIE. Un histórico que empieza el 6 de agosto y no lo
              dice se lee como «antes no fabricaste nada», que es falso. */}
          {desde && (
            <p className="small muted prod-ceguera">
              {tr("Koru guarda esto desde el")} <strong>{desde}</strong>.{" "}
              {tr("Lo anterior no es un cero: es que no se miraba.")}
            </p>
          )}

          <div className="kpis">
            <Kpi label={tr("Trabajos guardados")} value={fmtSp(filtradas.length)} />
            <Kpi label={tr("Unidades producidas")} value={fmtSp(eco.unidades)} />
            <Kpi
              label={tr("Valor a precio medio")}
              value={fmtIsk(eco.valor)}
              tone={eco.valor > 0 ? "pos" : undefined}
            />
            <Kpi label={tr("Tasas de instalación")} value={fmtIsk(eco.tasas)} tone="neg" />
          </div>

          {/* ⚠️ EL AVISO QUE HACE HONESTA A ESTA PANTALLA. Va junto a los números, no escondido:
              quien vea «valor 200 M» y «tasas 3 M» va a restar mentalmente, y esa resta está mal. */}
          <p className="small muted prod-aviso">
            {tr(
              "Esto NO es tu beneficio: faltan los materiales. ESI no dice qué material entró en cada trabajo ni a qué precio lo compraste, así que Koru no se lo inventa. El valor está a precio MEDIO de New Eden, que no es lo que tú venderías en tu hub.",
            )}
            {(eco.sinPrecio > 0 || eco.sinPlano > 0 || eco.enElHorno > 0) && (
              <>
                {" "}
                <span className="prod-falta">
                  {[
                    eco.enElHorno > 0 &&
                      `${fmtSp(eco.enElHorno)} ${tr("todavía en marcha")}`,
                    eco.sinPrecio > 0 &&
                      `${fmtSp(eco.sinPrecio)} ${tr("sin precio conocido")}`,
                    eco.sinPlano > 0 && `${fmtSp(eco.sinPlano)} ${tr("sin plano en los datos")}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  {` — ${tr("no entran en el total")}.`}
                </span>
              </>
            )}
          </p>

          <div className="rateo-controls">
            <div className="seg seg-sm">
              <button className={dias === 0 ? "active" : ""} onClick={() => setDias(0)}>
                {tr("Todo")}
              </button>
              <button className={dias === 30 ? "active" : ""} onClick={() => setDias(30)}>
                {tr("30 días")}
              </button>
              <button className={dias === 7 ? "active" : ""} onClick={() => setDias(7)}>
                {tr("7 días")}
              </button>
            </div>
            {actividades.length > 1 && (
              <div className="seg seg-sm">
                <button className={act === "all" ? "active" : ""} onClick={() => setAct("all")}>
                  {tr("Todas")}
                </button>
                {actividades.map((a) => (
                  <button key={a} className={act === a ? "active" : ""} onClick={() => setAct(a)}>
                    {a}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ★ INVENCIÓN: lo único aquí que no lleva ni una estimación. */}
          {inv.trabajos > 0 && (
            <div className="prod-inv">
              <h5>{tr("Invención: lo que decía la ficha y lo que salió")}</h5>
              <div className="kpis">
                <Kpi label={tr("Intentos")} value={fmtSp(inv.intentos)} />
                <Kpi label={tr("Esperados")} value={inv.esperados.toFixed(1)} />
                {/* ⚠️ SIN COLOR mientras la diferencia quepa en la variación normal. Pintar de rojo
                    «14 conseguidos de 15,2 esperados» es exactamente la superstición que este
                    panel existe para evitar: con 30 intentos eso pasa la mitad de las veces. */}
                <Kpi
                  label={tr("Conseguidos")}
                  value={fmtSp(inv.exitos)}
                  tone={
                    !normal(inv) ? (inv.exitos > inv.esperados ? "pos" : "neg") : undefined
                  }
                />
                <Kpi
                  label={tr("Tasa real")}
                  value={
                    inv.intentos > 0 ? `${((inv.exitos / inv.intentos) * 100).toFixed(1)} %` : "—"
                  }
                />
              </div>
              <p className="small muted">
                {normal(inv)
                  ? tr(
                      "Dentro de lo normal: la diferencia cabe en la variación esperada de ±SIGMA éxitos. Con estos números no se puede hablar de buena ni de mala suerte.",
                    ).replace("SIGMA", inv.sigma.toFixed(1))
                  : tr(
                      "La diferencia se sale de la variación esperada (±SIGMA éxitos), pero hacen falta cientos de intentos para que eso signifique algo más que una racha.",
                    ).replace("SIGMA", inv.sigma.toFixed(1))}
              </p>
            </div>
          )}

          {eco.porProducto.size > 0 && (
            <>
              <h5>{tr("Qué has producido, por valor")}</h5>
              <Bars
                items={[...eco.porProducto.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 10)
                  .map(([label, value]) => ({ label, value }))}
                fmt={fmtIsk}
              />
            </>
          )}

          {global && eco.porPersonaje.size > 1 && (
            <>
              <h5>{tr("Quién produce")}</h5>
              <Bars
                items={[...eco.porPersonaje.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([cid, value]) => ({ label: nombres[cid] ?? String(cid), value }))}
                fmt={fmtIsk}
                color="#7ad17a"
              />
            </>
          )}

          <button className="prod-fold" onClick={() => setAbierto((v) => !v)}>
            {abierto
              ? tr("Ocultar el detalle")
              : `${tr("Ver los")} ${fmtSp(ordenadas.length)} ${tr("trabajos")}`}
          </button>
          {abierto && (
            <table className="km-table">
              <thead>
                <tr>
                  <th>{tr("Día")}</th>
                  {global && <th>{tr("Personaje")}</th>}
                  <th>{tr("Actividad")}</th>
                  <th>{tr("Producto / Blueprint")}</th>
                  <th>{tr("Runs")}</th>
                  <th>{tr("Estado")}</th>
                  <th>{tr("Tasa")}</th>
                  <th>{tr("Valor")}</th>
                </tr>
              </thead>
              <tbody>
                {ordenadas.slice(0, 300).map((j) => {
                  const uds = porCarrera(j);
                  const p = j.product_type_id ? precios[j.product_type_id] : undefined;
                  const conValor =
                    ACT_CON_PRODUCTO.has(j.activity) && haSalido(j) && uds !== null && p;
                  return (
                    <tr key={j.job_id}>
                      <td>{diaDeJob(j) ?? "—"}</td>
                      {global && <td>{nombres[j.character_id] ?? "—"}</td>}
                      <td>{j.activity}</td>
                      <td>{j.product_name ?? j.blueprint_name ?? "—"}</td>
                      <td>
                        {j.runs}
                        {uds !== null && uds > 1 && (
                          <span className="muted small"> × {fmtSp(uds)}</span>
                        )}
                      </td>
                      <td>{j.status ?? "—"}</td>
                      <td>{j.cost ? fmtIsk(j.cost) : "—"}</td>
                      <td
                        title={
                          conValor
                            ? undefined
                            : !ACT_CON_PRODUCTO.has(j.activity)
                              ? tr("Lo que sale de aquí es un BPC, y un BPC no tiene valor en Koru.")
                              : !haSalido(j)
                                ? tr("Todavía no ha salido del horno.")
                                : tr("Sin precio o sin plano para valorarlo.")
                        }
                      >
                        {conValor ? fmtIsk(j.runs * (uds as number) * (p as number)) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {abierto && ordenadas.length > 300 && (
            <p className="small muted">
              {tr("Se enseñan los 300 más recientes de")} {fmtSp(ordenadas.length)}.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** F1a — Árbol BOM: qué hace falta para fabricar ESTE plano, con TU ME y los bonos de TU
 *  instalación. Fórmula verificada contra el juego (ver SPEC_F1_FABRICACION.md). Sin ISK todavía:
 *  primero que el árbol sea CIERTO; el dinero llega en F1b. */
function BomPanel({
  bp,
  owned,
  subject,
  onClose,
  facsVersion,
}: {
  bp: Blueprint;
  owned: Blueprint[];
  subject: number | "global";
  onClose: () => void;
  /** Sube cada vez que tocas una ficha arriba: así el árbol recarga el registro y no se queda
   *  calculando con los bonos de antes. */
  facsVersion: number;
}) {
  const [ind, setInd] = useState<BpIndustry | null>(null);
  const [names, setNames] = useState<Map<number, string>>(new Map());
  const [stock, setStock] = useState<Map<number, number> | null>(null);
  const [runs, setRuns] = useState(1);
  const [open, setOpen] = useState<Set<number>>(new Set());
  // F1b/F1c: sistemas, índice de coste, adjusted_price, estructuras (ESI) y bonos del SDE.
  const [sys, setSys] = useState<{ id: number; n: string; s: number }[] | null>(null);
  const [idx, setIdx] = useState<Record<string, number> | null>(null);
  const [adj, setAdj] = useState<Map<number, number>>(new Map());
  // F1d: precio de MERCADO (prices_map local; ≠ adjusted_price, que es solo para el VEO) y m³
  // (SDE + reempaquetado de Hoboleaks) de todo el universo de materiales de este árbol.
  const [prices, setPrices] = useState<Map<number, number>>(new Map());
  const [vols, setVols] = useState<Map<number, number>>(new Map());
  const [ir, setIr] = useState<IndustryRigs | null>(null);
  const [tree, setTree] = useState<BpTree | null>(null);
  // F2: catálogo de invención (decryptors + skills de encriptación).
  const [inv, setInv] = useState<InventionData | null>(null);
  /** F1c: el registro de instalaciones (BD). El BOM ya no pregunta a ESI qué estructuras tienes:
   *  usa las fichas que TÚ has declarado, porque ESI no sabe ni los rigs ni los servicios. */
  const [facs, setFacs] = useState<Facility[] | null>(null);
  const [pick, setPick] = useState<number | null>(() => {
    const v = Number(localStorage.getItem(PICK_KEY)); // solo la ÚLTIMA elegida: preferencia, no dato
    return v > 0 ? v : null;
  });
  /** Modo del panel (feedback de RoGiz7: mezclados era confuso): 🏭 fabricar o 🔬 inventar.
   *  Cada modo enseña SOLO lo suyo, incluida su lista de compra/transporte. */
  const [mode, setMode] = useState<"build" | "invent" | "react" | "copy">("build");
  /** Nodos desplegados del árbol de REACCIONES (clave de ruta, para distinguir el mismo material
   *  colgando de dos ramas distintas). Lo desplegado se reacciona; lo que queda de hoja, se compra. */
  const [openReact, setOpenReact] = useState<Set<string>>(new Set());
  /** Leyenda «tus fabricantes» (petición de RoGiz7, gemela de la de inventores): skills de TODOS
   *  los personajes — velocidad (Industry × Advanced Industry) y si CUMPLEN las requeridas. */
  const [buildChars, setBuildChars] = useState<
    { character_id: number; name: string; levels: Record<number, number> }[] | null
  >(null);

  useEffect(() => {
    fetch("/bp_industry.json").then((r) => r.json()).then(setInd).catch(() => setInd({}));
    fetch("/market_types.json")
      .then((r) => r.json())
      .then((m: MType[]) => setNames(new Map(m.map((t) => [t.i, t.n]))))
      .catch(() => setNames(new Map()));
    fetch("/neweden.json")
      .then((r) => r.json())
      .then((d: { systems: { id: number; n: string; s: number }[] }) => setSys(d.systems))
      .catch(() => setSys([]));
    fetch("/industry_rigs.json").then((r) => r.json()).then(setIr).catch(() => setIr(null));
    fetch("/bp_tree.json").then((r) => r.json()).then(setTree).catch(() => setTree(null));
    fetch("/invention.json").then((r) => r.json()).then(setInv).catch(() => setInv(null));
    fetch("/type_volumes.json")
      .then((r) => r.json())
      .then((d: Record<string, number>) =>
        setVols(new Map(Object.entries(d).map(([k, v]) => [Number(k), v]))),
      )
      .catch(() => setVols(new Map()));
    invoke<Facility[]>("facility_list").then(setFacs).catch(() => setFacs([]));
  }, [facsVersion]);

  /** Elegibles: las fichas que TÚ has marcado. UN solo desplegable para todo el panel (decisión de
   *  RoGiz7 2026-07-30: dos selectores mezclaban la vista): la FABRICACIÓN usa la ficha si tiene
   *  planta (🏭) y la INVENCIÓN si tiene laboratorio (🔬). Cada bloque avisa si le falta su servicio. */
  const usable = useMemo(() => (facs ?? []).filter((f) => f.eligible), [facs]);
  const st = useMemo(() => usable.find((f) => f.id === pick) ?? null, [usable, pick]);
  const sysHit = useMemo(
    () => (st ? (sys ?? []).find((x) => x.id === st.system_id) ?? null : null),
    [sys, st],
  );

  // Índice de coste del sistema de la estructura (ESI, público).
  useEffect(() => {
    if (!st) {
      setIdx(null);
      return;
    }
    invoke<Record<string, number>>("get_industry_index", { systemId: st.system_id })
      .then(setIdx)
      .catch(() => setIdx(null));
  }, [st?.system_id]);

  const es = getLang() === "es";
  /** Categoría y GRUPO del producto de este plano: deciden qué rigs aplican (Bantam → cat 6 grupo 25). */
  const prodCat = tree?.bp[String(bp.type_id)]?.[0] ?? null;
  const prodGrp = tree?.bp[String(bp.type_id)]?.[1] ?? null;

  /** F1d — bonos POR PRODUCTO: el mismo cálculo de siempre pero parametrizado por la categoría y el
   *  grupo del producto que se fabrica en CADA nodo del árbol (antes todo el árbol se juzgaba con la
   *  categoría del producto RAÍZ: bien para el Bantam, mal en cuanto se despliegan componentes). */
  const bonosFor = useMemo(() => {
    // Sin planta de fabricación declarada (🏭) los bonos de fabricar no aplican: la ficha puede
    // ser un laboratorio puro. La invención va aparte, con su propio bloque.
    if (!st || !st.has_mfg || !ir) return null;
    const sd = st.type_id != null ? ir.structures[String(st.type_id)] : null;
    const band = sysHit ? secBand(sysHit.s) : "hi";
    return (cat: number | null, grp: number | null): Bonos => {
      const rigs = st.rigs.map((id) => {
        const r = ir.rigs[String(id)];
        if (!r) return { id, name: `#${id}`, mat: 0, eff: 0, state: "unmapped" as const };
        const eff = r.mat * (r.sec[band] ?? 1);
        // Decidir si el rig aplica a ESTE producto. Dos vías, por orden de calidad del dato:
        //   1) `aff` (SDE oficial desde el 2026-08-11, antes Hoboleaks; es la tabla con la que
        //      decide el SERVIDOR): categorías + grupos.
        //      Con aff el veredicto es BINARIO (on/off): ya no existe «unmapped» para estos rigs.
        //   2) Fallback por nombre de efecto (SCOPE_CAT), para rigs sin aff — con sus tres estados
        //      de siempre (on / off afirmado / unmapped que no aplicamos y decimos).
        let state: "on" | "off" | "unmapped";
        if (r.aff) {
          const cubre =
            (cat != null && r.aff.c.includes(cat)) || (grp != null && r.aff.g.includes(grp));
          state = cubre ? "on" : "off";
        } else {
          const conocidos = r.scopes.filter((s) => SCOPE_CAT[s]);
          const cubre = cat != null && conocidos.some((s) => SCOPE_CAT[s].includes(cat));
          state = cubre
            ? "on"
            : conocidos.length < r.scopes.length || r.scopes.length === 0
              ? "unmapped"
              : "off";
        }
        return { id, name: es ? r.n.es : r.n.en, mat: r.mat, eff, state };
      });
      // Fortizar y compañía no tienen bono de material: `null` = sin bono (factor 1), NO cero.
      return { strMat: sd?.mat ?? 1, strCost: sd?.cost ?? 1, rigs };
    };
  }, [st, ir, sysHit, es]);

  /** F-REACCIONES — bonos de reacción de la ficha para EL PRODUCTO que sale de la fórmula.
   *
   *  Reaccionar tiene MUCHAS menos palancas que fabricar, y esto no es una simplificación nuestra:
   *  el SDE dice que **ninguna estructura y ningún rig dan bono de COSTE de reacción**. La única
   *  bonificación de estructura que existe es el −25 % de TIEMPO de la Tatara; el Athanor no da
   *  nada. Por eso aquí solo salen material y tiempo.
   *
   *  Ojo con dos trampas verificadas contra el juego (fixture Carbon Polymers ×100 en su Tatara):
   *   · Los bonos de reacción viven en `react`, NO en mat/time/cost (que son los de fabricación).
   *   · Su multiplicador de seguridad es null ×1.1 (fabricación es ×2.1). Usar el otro DUPLICA
   *     el bono: −24 × 1,1 = −26,4 % es lo que enseña el juego; con 2,1 saldría −50,4 %.
   *  A qué familia (Composite / Hybrid / Biochemical) aplica cada rig lo decide el mismo `aff` de
   *  Hoboleaks que ya usamos en fabricación, por el GRUPO del producto — comprobado: las salidas
   *  de las 120 reacciones caen todas en alguno de los 6 grupos mapeados, sin huérfanas. */
  const reactBonos = useMemo(() => {
    if (!st || !st.has_reactor || !ir) return null;
    const sd = st.type_id != null ? ir.structures[String(st.type_id)] : null;
    const band = sysHit ? secBand(sysHit.s) : "hi";
    return (grp: number | null) => {
      let mat = 1;
      let time = 1;
      const aplican: { id: number; name: string; mat: number; time: number }[] = [];
      for (const id of st.rigs) {
        const r = ir.rigs[String(id)];
        if (!r?.react) continue; // no es rig de reacción: no pinta nada aquí
        if (grp != null && r.aff && !r.aff.g.includes(grp)) continue; // otra familia
        const secF = r.sec[band] ?? 1;
        const m = (r.react.mat ?? 0) * secF;
        const t = (r.react.time ?? 0) * secF;
        mat *= 1 + m / 100;
        time *= 1 + t / 100;
        aplican.push({ id, name: es ? r.n.es : r.n.en, mat: m, time: t });
      }
      // Estructura: SOLO tiempo, y solo la Tatara. `null` = sin bono → factor 1, no cero.
      const strTime = sd?.react?.time ?? 1;
      return { mat, time: time * strTime, strTime, rigs: aplican, strKnown: sd != null };
    };
  }, [st, ir, sysHit, es]);

  /** Bonos del producto RAÍZ (para el coste del job, la Confianza y el desglose visible). */
  const bonos: Bonos | null = useMemo(
    () => (bonosFor ? bonosFor(prodCat, prodGrp) : null),
    [bonosFor, prodCat, prodGrp],
  );

  // Stock real: lo que ya tienes, para el "te falta". Multi-personaje si el sujeto es Global.
  // F1d+ (idea de RoGiz7): se guarda también POR UBICACIÓN RAÍZ, para poder decir qué stock ya
  // está EN la instalación elegida (= qué NO hay que transportar). El root viene del backend
  // (root_location sube contenedor/nave → estructura, código ya probado en la vista de Assets).
  type StockRow = { type_id: number; quantity: number; location_id: number };
  const [stockRows, setStockRows] = useState<StockRow[] | null>(null);
  useEffect(() => {
    const p =
      subject === "global"
        ? invoke<StockRow[]>("get_assets_detail_global")
        : invoke<StockRow[]>("get_assets_detail", { characterId: subject });
    p.then(setStockRows).catch(() => setStockRows([]));
  }, [subject]);
  // Total global (comportamiento de siempre)…
  useEffect(() => {
    if (stockRows == null) return;
    const m = new Map<number, number>();
    for (const r of stockRows) m.set(r.type_id, (m.get(r.type_id) ?? 0) + r.quantity);
    setStock(m);
  }, [stockRows]);
  // …y el stock EN la estructura de la ficha elegida (null si la ficha es manual: ahí «no lo sé»
  // es la respuesta honesta — sin structure_id no hay ubicación que casar, y no fingimos un 0).
  const stockHere = useMemo(() => {
    if (stockRows == null || st?.structure_id == null) return null;
    const m = new Map<number, number>();
    for (const r of stockRows)
      if (r.location_id === st.structure_id) m.set(r.type_id, (m.get(r.type_id) ?? 0) + r.quantity);
    return m;
  }, [stockRows, st?.structure_id]);
  /** El stock que manda en la tabla y la lista de la compra: el de la instalación si se conoce. */
  const stockUsed = stockHere ?? stock;
  const inFacility = stockHere != null;

  // producto → blueprint que lo fabrica (para saber qué material es a su vez fabricable)
  const bpByProduct = useMemo(() => {
    const m = new Map<number, string>();
    for (const [bid, v] of Object.entries(ind ?? {})) {
      // Los planos sin publicar (`np`) siguen en el catálogo para que la biblioteca resuelva el
      // tuyo si lo tienes, pero NO pueden ser una rama del árbol: no existen en el juego, y uno
      // de ellos traía números falsos. Que un material salga «fabricable» por un plano que nadie
      // puede conseguir es peor que decir «cómpralo».
      if (v.np) continue;
      const out = v.m?.out?.[0]?.[0];
      if (out != null) m.set(out, bid);
    }
    return m;
  }, [ind]);

  // Tu MEJOR ME por blueprint (si tienes varias copias del mismo plano).
  const meOf = useMemo(() => {
    const m = new Map<number, number>();
    for (const b of owned) {
      const cur = m.get(b.type_id);
      if (cur == null || b.me > cur) m.set(b.type_id, b.me);
    }
    return m;
  }, [owned]);

  const nameOf = (tid: number) => names.get(tid) ?? `#${tid}`;

  /** F1d — TODOS los typeIDs alcanzables desde este plano (a cualquier profundidad): el universo
   *  de materiales del árbol, para pedir precios y adjusted de una vez (lecturas locales, sin red). */
  /** La fórmula de reacción de este «plano», si lo es. Las reacciones NO llevan ME/TE.
   *  Se declara aquí arriba porque de ella dependen `allTids` (para pedir sus adjusted_price) y
   *  la carga de skills. */
  const ract = ind?.[String(bp.type_id)]?.r;

  const allTids = useMemo(() => {
    const s = new Set<number>();
    if (!ind) return s;
    const seen = new Set<string>();
    const rec = (bpId: string) => {
      if (seen.has(bpId)) return;
      seen.add(bpId);
      const a = ind[bpId]?.m;
      if (!a) return;
      for (const [tid] of a.in) {
        s.add(tid);
        const sb = bpByProduct.get(tid);
        if (sb) rec(sb);
      }
    };
    rec(String(bp.type_id));
    // Una FÓRMULA de reacción no tiene actividad `m`, así que el recorrido de arriba salía sin
    // añadir nada y el VEO se quedaba en 0 (no había adjusted_price de sus materiales). Sus
    // entradas se piden aparte.
    for (const [tid] of ind[String(bp.type_id)]?.r?.in ?? []) s.add(tid);
    return s;
  }, [ind, bp.type_id, bpByProduct]);

  type Row = {
    tid: number;
    qty: number;
    depth: number;
    subBp: string | null;
    /** ME usado para calcular los hijos de este nodo (null = no tienes el plano → estimado a 0). */
    childMe: number | null;
  };

  const rows = useMemo(() => {
    const out: Row[] = [];
    if (!ind) return out;
    const walk = (bpId: string, n: number, depth: number) => {
      const act = ind[bpId]?.m;
      if (!act) return;
      const me = meOf.get(Number(bpId));
      // F1d: los bonos se juzgan con el producto de ESTE plano (cada nodo el suyo), no con el de
      // la raíz. Un rig de componentes debe aplicar al subárbol de componentes de una nave, y el
      // de naves no debe tocar los componentes.
      const [c, g] = tree?.bp[bpId] ?? [null, null];
      const f = matFactor(me ?? 0, bonosFor ? bonosFor(c, g) : null);
      for (const [tid, base] of act.in) {
        const qty = matQty(base, n, f);
        const sb = bpByProduct.get(tid) ?? null;
        const childMe = sb ? (meOf.get(Number(sb)) ?? null) : null;
        out.push({ tid, qty, depth, subBp: sb, childMe });
        if (sb && open.has(tid)) {
          const outQty = ind[sb]?.m?.out?.[0]?.[1] ?? 1;
          walk(sb, Math.ceil(qty / outQty), depth + 1);
        }
      }
    };
    walk(String(bp.type_id), runs, 0);
    return out;
  }, [ind, bp, runs, bonosFor, tree, open, meOf, bpByProduct]);

  const act = ind?.[String(bp.type_id)]?.m;

  // Skills de todos los personajes para la leyenda de fabricantes: las dos de velocidad + las
  // REQUERIDAS por este plano (sin ellas el juego no deja ni lanzar el job).
  /** Índice de COPIA del sistema de la instalación. ESI lo llama `copying`. */
  const labIdxCopy = idx?.copying ?? null;

  useEffect(() => {
    // Las requeridas salen de la actividad que toque: `m` al fabricar, `r` al reaccionar. Sin
    // pedir REACTIONS_SKILL, la duración de una reacción se calculaba con nivel 0 y salía un 25 %
    // más larga de lo real (165h en vez de las 132h del juego).
    const reqIds = [...(act?.sk ?? []), ...(ract?.sk ?? [])].map(([s]) => s);
    invoke<{ character_id: number; name: string; levels: Record<number, number> }[]>(
      "get_skill_levels_all",
      { ids: [INDUSTRY_SKILL, ADV_INDUSTRY_SKILL, REACTIONS_SKILL, SCIENCE_SKILL, ...reqIds] },
    )
      .then(setBuildChars)
      .catch(() => setBuildChars(null));
  }, [act, ract]);

  // --- F1b: coste del trabajo, con la fórmula VERIFICADA al ISK contra el juego ---
  // El VEO usa las cantidades BASE del blueprint (NO las de tras-ME) y el `adjusted_price`.
  // F1d: se piden para TODO el árbol (los sub-jobs del build-vs-buy también tienen su VEO).
  useEffect(() => {
    const ids = [...allTids];
    if (ids.length === 0) return;
    invoke<Record<number, number>>("get_type_adjusted_prices", { ids })
      .then((r) => setAdj(new Map(Object.entries(r).map(([k, v]) => [Number(k), v]))))
      .catch(() => setAdj(new Map()));
    invoke<Record<number, number>>("get_type_prices", { ids })
      .then((r) => setPrices(new Map(Object.entries(r).map(([k, v]) => [Number(k), v]))))
      .catch(() => setPrices(new Map()));
  }, [allTids]);

  const cost = useMemo(() => {
    if (!act) return null;
    let veo = 0;
    let faltan = 0;
    for (const [tid, base] of act.in) {
      const p = adj.get(tid);
      if (p == null) faltan++;
      veo += base * runs * (p ?? 0);
    }
    // Sin planta declarada no hay job de fabricación que costear en esa estructura.
    const index = st?.has_mfg ? (idx?.manufacturing ?? null) : null;
    if (index == null) return { veo, faltan, index: null as number | null };
    const bruto = veo * index;
    // La bonificación de coste de la estructura sale del SDE (Sotiyo 0.95) y va sobre el BRUTO.
    const brutoTotal = bruto * (bonos?.strCost ?? 1);
    // El impuesto lo pone el dueño: ni ESI ni SDE lo saben. Se pide el de FABRICACIÓN, que puede
    // ser distinto del general (el juego lo configura por actividad); si no está declarado aparte,
    // `taxFor` cae al general y todo sigue como siempre.
    const tax = veo * ((st ? taxFor(st, "mfg") ?? 0 : 0) / 100);
    const ccs = veo * CCS_SURCHARGE;
    return { veo, faltan, index, bruto, brutoTotal, tax, ccs, total: brutoTotal + tax + ccs };
  }, [act, adj, runs, idx, bonos, st, st?.has_mfg]);
  // --- F-REACCIONES --- (`ract` se declara arriba: lo necesitan allTids y la carga de skills)

  /** Familia de la reacción (Composite / Hybrid / Biochemical) DEDUCIDA del dato, no de una lista
   *  escrita a mano: se busca qué rig de reacción declara cubrir el grupo del producto, y su
   *  `scopes` dice la familia. Así, si Fenris añade un grupo nuevo, lo hereda al regenerar. */
  const reactFam = useMemo((): "comp" | "hyb" | "bio" | null => {
    if (!ract || !ir) return null;
    const grp = tree?.bp[String(bp.type_id)]?.[1] ?? null;
    if (grp == null) return null;
    for (const r of Object.values(ir.rigs)) {
      if (!r.react || !r.aff || !r.aff.g.includes(grp)) continue;
      // El L-Set lleva las tres familias: no sirve para decidir, se salta.
      if (r.scopes.length !== 1) continue;
      if (r.scopes[0] === "ReactionComp") return "comp";
      if (r.scopes[0] === "ReactionHyb") return "hyb";
      if (r.scopes[0] === "ReactionBio") return "bio";
    }
    return null;
  }, [ract, ir, tree, bp.type_id]);

  const reactBon = useMemo(
    () => (reactBonos ? reactBonos(tree?.bp[String(bp.type_id)]?.[1] ?? null) : null),
    [reactBonos, tree, bp.type_id],
  );

  /** Coste del job de reacción. Fórmula VERIFICADA AL ISK contra el juego (Carbon Polymers ×100 en
   *  el Tatara «T2 Repro» de C-J6MT): total 1.053.491 exacto.
   *
   *      bruto = VEO × índice(reaction)          ← SIN bonos: no existen para reaccionar
   *      + impuesto de centro (% DEL VEO)
   *      + recargo CCS 4 % (DEL VEO)
   *
   *  Los impuestos van sobre el VEO, no sobre el bruto (1 % del bruto habrían sido 6.502 ISK, y el
   *  juego cobró 80.667). Es la misma forma que fabricación; la rara es la invención, que mete la
   *  capa CTB del 2 %. El VEO usa las cantidades BASE × `adjusted_price`, como siempre. */
  /** Materiales de la reacción, que son el 90 % de lo que uno viene a mirar aquí.
   *
   *  Cantidad = base × runs × factor de los rigs, y **redondeando hacia ARRIBA**: verificado
   *  contra el juego (5 × 100 × 0,9736 = 486,8 → el juego pide **487**, no 486). Sin ME/TE: en
   *  reacciones no existen, así que el único descuento posible es el del rig de la refinería.
   *  El «te falta» se cruza con el stock EN la instalación si se conoce, igual que en fabricación. */
  /** Producto → fórmula que lo hace. Sin ambigüedad desde que el extractor descarta los planos sin
   *  publicar (el «Test Reaction Blueprint» producía el mismo Tungsten Carbide con datos falsos). */
  const reactByProduct = useMemo(() => {
    const m = new Map<number, string>();
    for (const [k, v] of Object.entries(ind ?? {})) {
      if (v.np) continue; // sin publicar: no existe en el juego, no puede ser una rama del árbol
      for (const o of v.r?.out ?? []) m.set(o[0], k);
    }
    return m;
  }, [ind]);

  const reactRows = useMemo(() => {
    if (!ract) return null;
    type RRow = {
      key: string;
      tid: number;
      base: number;
      need: number;
      have: number;
      miss: number;
      price: number | undefined;
      depth: number;
      /** Fórmula que lo produce, si es a su vez una reacción (35 de las 119 encadenan). */
      sub: string | null;
      /** Cuántas veces habría que correr esa sub-reacción para cubrir lo que falta. */
      subRuns: number;
    };
    const out: RRow[] = [];
    // Cada nivel se juzga con la familia de SU producto: el rig de compuestas no abarata una
    // bioquímica. Mismo criterio que el walk() por nodo de F1d en fabricación.
    const walk = (formula: string, mult: number, depth: number, path: string) => {
      const r = ind?.[formula]?.r;
      if (!r || depth > 4) return; // 4 niveles sobran: la cadena más larga del juego tiene 3
      const grp = tree?.bp[formula]?.[1] ?? null;
      const f = reactBonos ? reactBonos(grp).mat : 1;
      for (const [tid, base] of r.in) {
        const need = Math.ceil(base * mult * f);
        const have = stockUsed?.get(tid) ?? 0;
        const miss = Math.max(0, need - have);
        const sub = reactByProduct.get(tid) ?? null;
        const perRun = sub ? (ind?.[sub]?.r?.out?.[0]?.[1] ?? 1) : 1;
        const key = `${path}/${tid}`;
        out.push({
          key,
          tid,
          base,
          need,
          have,
          miss,
          price: prices.get(tid),
          depth,
          sub,
          subRuns: sub && miss > 0 ? Math.ceil(miss / perRun) : 0,
        });
        // Solo se baja por lo que TÚ has desplegado: lo desplegado se reacciona, lo demás se compra.
        if (sub && openReact.has(key) && miss > 0) {
          walk(sub, Math.ceil(miss / perRun), depth + 1, key);
        }
      }
    };
    walk(String(bp.type_id), runs, 0, "r");
    return out;
  }, [ract, ind, tree, reactBonos, runs, stockUsed, prices, reactByProduct, openReact, bp.type_id]);

  /** Lo que hay que CONSEGUIR de fuera: solo las HOJAS. Un nodo desplegado lo reaccionas tú, así
   *  que sale de la lista y entran sus materiales — contar los dos sería duplicar. Mismo criterio
   *  que la lista de la compra de fabricación.
   *  ⚠️ Va declarado ANTES de `traer` y `reactShop` a propósito: los useMemo se evalúan en orden
   *  durante el render, y usarlo antes daba un ReferenceError que `tsc` no ve (el callback lo
   *  oculta). */
  const reactLeaves = useMemo(
    () => (reactRows ?? []).filter((r) => !(r.sub && openReact.has(r.key))),
    [reactRows, openReact],
  );

  /** ¿DÓNDE está lo que falta? La pregunta que ninguna calculadora responde, porque ninguna sabe
   *  dónde tienes tus cosas — Koru sí, y sin pedir nada nuevo: `stockRows` ya trae `location_id`
   *  por stack desde F1d+.
   *
   *  Distingue dos cosas que no son iguales y que la lista de la compra mezclaba:
   *    · lo que **tienes en otro sitio** → no hay que comprarlo, hay que TRAERLO (y de dónde).
   *    · lo que no tienes en ninguna parte → eso sí es compra.
   *  Los saltos salen del grafo real de stargates (`neweden.json`), con BFS desde el sistema de la
   *  instalación. No cuenta los Ansiblex todavía: prefiero decir «5 saltos por puertas» a inventar
   *  un atajo que quizá no puedas usar con un carguero. */
  const [ne, setNe] = useState<{ systems: { id: number; n: string }[]; jumps: [number, number][] } | null>(null);
  const [structs, setStructs] = useState<{ id: number; name: string | null; system_id: number }[]>([]);
  useEffect(() => {
    loadNewEden().then(setNe).catch(() => setNe(null));
    invoke<{ id: number; name: string | null; system_id: number }[]>("get_structures")
      .then(setStructs)
      .catch(() => setStructs([]));
  }, []);

  const traer = useMemo(() => {
    if (!reactRows || !stockRows || !st) return null;
    // Solo las hojas: lo que se reacciona no se trae, se hace allí.
    const faltan = new Map(reactLeaves.filter((r) => r.miss > 0).map((r) => [r.tid, r.miss]));
    if (faltan.size === 0) return null;
    // Saltos desde el sistema de la instalación a todo New Eden (una sola pasada).
    let dist = new Map<number, number>();
    if (ne) {
      const adj = new Map<number, number[]>();
      for (const [a, b] of ne.jumps) {
        (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
        (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
      }
      dist = proximityBFS(adj, [st.system_id]);
    }
    const sysOf = new Map(structs.map((s) => [s.id, s.system_id]));
    const nameOfStruct = new Map(structs.map((s) => [s.id, s.name]));
    const sysName = new Map((ne?.systems ?? []).map((s) => [s.id, s.n]));

    type Sitio = {
      loc: number;
      label: string;
      system: number | null;
      jumps: number | null;
      items: { tid: number; qty: number }[];
    };
    const sitios = new Map<number, Sitio>();
    for (const row of stockRows) {
      const need = faltan.get(row.type_id);
      if (!need || row.location_id === st.structure_id) continue; // lo que ya está allí no se trae
      const sysId = sysOf.get(row.location_id) ?? null;
      const s =
        sitios.get(row.location_id) ??
        sitios
          .set(row.location_id, {
            loc: row.location_id,
            label:
              nameOfStruct.get(row.location_id) ??
              (sysId != null ? sysName.get(sysId) ?? `#${row.location_id}` : `#${row.location_id}`),
            system: sysId,
            jumps: sysId != null ? dist.get(sysId) ?? null : null,
            items: [],
          })
          .get(row.location_id)!;
      s.items.push({ tid: row.type_id, qty: row.quantity });
    }
    // Más cerca primero; lo que no sabemos ubicar, al final (y se dice, no se esconde).
    return [...sitios.values()].sort(
      (a, b) => (a.jumps ?? 9999) - (b.jumps ?? 9999) || a.label.localeCompare(b.label),
    );
  }, [reactRows, reactLeaves, stockRows, st, ne, structs]);

  const reactShop = useMemo(() => {
    if (!reactRows) return null;
    let isk = 0;
    let m3 = 0;
    let types = 0;
    let sinPrecio = 0;
    for (const r of reactLeaves) {
      if (r.miss <= 0) continue;
      types++;
      if (r.price == null) sinPrecio++;
      else isk += r.miss * r.price;
      const v = vols.get(r.tid);
      if (v != null) m3 += r.miss * v;
    }
    return { types, isk, m3, sinPrecio };
  }, [reactRows, reactLeaves, vols]);

  const reactCost = useMemo(() => {
    if (!ract) return null;
    let veo = 0;
    let faltan = 0;
    for (const [tid, base] of ract.in) {
      const p = adj.get(tid);
      if (p == null) faltan++;
      veo += base * runs * (p ?? 0);
    }
    // La clave la pone ESI tal cual en `activity`. Hoy es `reaction`; aceptamos también el plural
    // por si cambia de nombre en algún compatibility date, antes que enseñar un 0 sin explicación.
    const index = st?.has_reactor ? (idx?.reaction ?? idx?.reactions ?? null) : null;
    if (index == null) return { veo, faltan, index: null as number | null };
    const bruto = veo * index; // sin bonificación: ninguna estructura ni rig abarata la reacción
    const taxPct = !st ? null : reactFam ? taxFor(st, `reaction_${reactFam}` as TaxAct) : st.tax;
    const tax = veo * ((taxPct ?? 0) / 100);
    const ccs = veo * CCS_SURCHARGE;
    return { veo, faltan, index, bruto, tax, ccs, taxPct, total: bruto + tax + ccs };
  }, [ract, adj, runs, idx, st, reactFam]);

  // En una fórmula de reacción el «producto» sale de `r`, no de `m`: si no, la cabecera decía
  // «produce» y dejaba el hueco en blanco.
  // --- F2c: COPIA ---
  /** Tiempo base de copia POR RUN copiada (el `c` del SDE). Verificado con el fixture del Apostle:
   *  1 copia × 1 run usó exactamente los 1.600.000 s del SDE. La documentación lo confirma —
   *  «la duración se calcula en función del número TOTAL de producciones con licencia». */
  const copyT = ind?.[String(bp.type_id)]?.c ?? 0;
  const [copies, setCopies] = useState(1);
  const [runsPerCopy, setRunsPerCopy] = useState(1);
  const maxPerCopy = ind?.[String(bp.type_id)]?.max ?? 1;

  /** Coste y tiempo del trabajo de COPIA.
   *
   *  ⚠️ La copia NO usa la fórmula de fabricación: es un «trabajo de ciencia» y comparte fórmula
   *  con la INVENCIÓN — con su capa CTB del 2 %. VERIFICADO AL ISK contra el juego (Apostle
   *  Blueprint, 1 copia × 1 run, Sotiyo «Weaselior University T2 Lab» en null):
   *
   *      VEO 2.853.005.600 → CTB 2 % = 57.060.112
   *      bruto = CTB × índice(copying) 14,0107 % = 7.994.500
   *      × rig 0,748 × estructura 0,95 = 5.680.891   (el juego TRUNCA, no redondea)
   *      + CCS 4 % DEL CTB = 2.282.404
   *      = 7.963.295  ✓ clavado
   *
   *  El impuesto de centro ni salía en su tooltip porque ese lab cobra 0 % en copia — la prueba en
   *  vivo de que el impuesto por actividad hacía falta.
   *
   *  El VEO es un CANDIDATO (materiales de 1 run del propio plano a `adjusted`), igual que lo fue
   *  el de invención hasta que se contrastó: se enseña para compararlo con el tooltip. Y su escala
   *  con varias copias/runs está SIN verificar — el fixture era de 1×1. */
  const copyJob = useMemo(() => {
    if (!copyT || !act) return null;
    const totalRuns = Math.max(1, copies) * Math.max(1, runsPerCopy);
    // VEO por run con licencia, y el total escalado por ellas. La escala con las runs es la
    // hipótesis coherente con lo ÚNICO verificado: el TIEMPO escala exactamente con las runs
    // totales (fixture Antimatter Charge L: 1×1 = 459 s, 10×10 = 45.900 s, ×100 clavado). El
    // coste con varias runs sigue sin contrastar — el fixture del Apostle era de 1×1.
    const veoRun = act.in.reduce((a, [tid, q]) => a + q * (adj.get(tid) ?? 0), 0);
    const veo = veoRun * totalRuns;
    const lvls = new Map<number, number>();
    for (const c of buildChars ?? [])
      for (const [k, v] of Object.entries(c.levels))
        lvls.set(Number(k), Math.max(lvls.get(Number(k)) ?? 0, v));
    // Skills de copia: Science −5 %/nivel × Advanced Industry −3 %/nivel (0,75 × 0,85 = el
    // «−36,3 %» que enseñó el juego con ambas a V).
    const skillF =
      (1 - 0.05 * (lvls.get(SCIENCE_SKILL) ?? 0)) * (1 - 0.03 * (lvls.get(ADV_INDUSTRY_SKILL) ?? 0));
    const sd = st?.type_id != null ? ir?.structures[String(st.type_id)] : null;
    const band = sysHit ? secBand(sysHit.s) : "hi";
    let rigCost = 1;
    let rigTime = 1;
    for (const id of st?.rigs ?? []) {
      const r = ir?.rigs[String(id)];
      // Rigs de LABORATORIO: los que no tocan material (mat 0) y sí coste o tiempo. Aplican sin
      // filtro de producto, igual que en invención.
      if (!r || r.mat !== 0) continue;
      if (r.cost !== 0) rigCost *= 1 + (r.cost * (r.sec[band] ?? 1)) / 100;
      if (r.time !== 0) rigTime *= 1 + (r.time * (r.sec[band] ?? 1)) / 100;
    }
    const time = copyT * totalRuns * skillF * rigTime * (sd?.time ?? 1);
    const index = st?.has_lab ? (labIdxCopy ?? null) : null;
    if (index == null) return { veo, totalRuns, time, index: null as number | null };
    const ctb = veo * 0.02;
    const bruto = Math.trunc(ctb * index * rigCost * (sd?.cost ?? 1));
    const tax = ctb * ((taxFor(st!, "copy") ?? 0) / 100);
    const ccs = ctb * CCS_SURCHARGE;
    return { veo, totalRuns, time, index, ctb, bruto, tax, ccs, total: bruto + tax + ccs };
  }, [copyT, act, adj, copies, runsPerCopy, buildChars, st, ir, sysHit, labIdxCopy]);

  const product = act?.out?.[0]?.[0] ?? ract?.out?.[0]?.[0];
  const perRun = act?.out?.[0]?.[1] ?? ract?.out?.[0]?.[1] ?? 1;
  // El modo por defecto lo decide lo que el plano SABE hacer, y se RECALCULA al cambiar de plano.
  // Antes solo forzaba «react» al abrir una fórmula y nunca volvía atrás: al pasar de una fórmula a
  // un plano normal el modo se quedaba pegado en Reaccionar y el panel salía MUDO (lo cazó RoGiz7
  // con el Helium Fuel Block). Depende del plano, no del modo, así que no pisa tu elección manual
  // entre Fabricar e Inventar mientras sigas en el mismo plano.
  useEffect(() => {
    setMode(ract ? "react" : "build");
  }, [ract, bp.type_id]);
  const maxRuns = bp.quantity === -1 ? 1_000_000 : Math.max(1, bp.runs);

  /** F1d — coste de FABRICAR una unidad de un material fabricable, para el build-vs-buy por nodo:
   *  sus materiales (un nivel, valorados a MERCADO) + la tasa de su job (VEO×índice×bonif + centro
   *  + CCS), entre las unidades que salen por carrera. Decisión v1 a propósito: los hijos se valoran
   *  a mercado (no se optimiza el árbol entero recursivamente) y se dice — esperanza ≠ promesa.
   *  `est` = true si falta algún precio o no tienes el plano (ME 0 estimado). */
  const buildUnit = (sb: string): { unit: number; est: boolean } | null => {
    const a = ind?.[sb]?.m;
    if (!a) return null;
    const outQty = a.out?.[0]?.[1] ?? 1;
    const me = meOf.get(Number(sb));
    const [c, g] = tree?.bp[sb] ?? [null, null];
    const f = matFactor(me ?? 0, bonosFor ? bonosFor(c, g) : null);
    let mats = 0;
    let veo = 0;
    let est = me == null;
    for (const [tid, base] of a.in) {
      const q = matQty(base, 1, f);
      const p = prices.get(tid);
      if (p == null) est = true;
      mats += q * (p ?? 0);
      veo += base * (adj.get(tid) ?? 0);
    }
    // Tasa del sub-job con TU misma instalación (índice del sistema + bonos de la ficha elegida).
    const index = idx?.manufacturing ?? 0;
    const fee =
      veo * index * (bonos?.strCost ?? 1) + veo * ((st?.tax ?? 0) / 100) + veo * CCS_SURCHARGE;
    return { unit: (mats + fee) / outQty, est };
  };

  /** F1d — la LISTA DE LA COMPRA según el árbol tal y como lo tienes desplegado: lo desplegado se
   *  fabrica, las hojas se compran. Agregada por tipo (el stock se descuenta UNA vez, no por fila)
   *  → total ISK a mercado y m³ a transportar (volumen reempaquetado cuando Hoboleaks lo corrige). */
  const shopping = useMemo(() => {
    const need = new Map<number, number>();
    for (const r of rows) {
      const leaf = !r.subBp || !open.has(r.tid);
      if (!leaf) continue;
      need.set(r.tid, (need.get(r.tid) ?? 0) + r.qty);
    }
    let isk = 0;
    let m3 = 0;
    let types = 0;
    let sinPrecio = 0;
    let sinVol = 0;
    for (const [tid, n] of need) {
      const miss = Math.max(0, n - (stockUsed?.get(tid) ?? 0));
      if (miss <= 0) continue;
      types++;
      const p = prices.get(tid);
      if (p == null) sinPrecio++;
      else isk += miss * p;
      const v = vols.get(tid);
      if (v == null) sinVol++;
      else m3 += miss * v;
    }
    return { types, isk, m3, sinPrecio, sinVol };
  }, [rows, open, stockUsed, prices, vols]);

  if (!ind) return <p className="muted small">{tr("Cargando…")}</p>;
  // Una FÓRMULA DE REACCIÓN no tiene actividad de fabricación, y hasta aquí eso la mandaba al
  // «este plano no fabrica nada». Sigue valiendo para lo que de verdad no produce nada.
  if (!act && !ract)
    return (
      <div className="bom-panel">
        <div className="bom-head">
          <strong>{bp.name ?? `#${bp.type_id}`}</strong>
          <button className="sys-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="muted small">{tr("Este plano no fabrica nada (o el SDE no lo tiene).")}</p>
      </div>
    );

  return (
    <div className="bom-panel">
      <div className="bom-head">
        <img src={bpIcon(bp.type_id, bp.quantity === -1, 32)} alt="" width={20} height={20} />
        <strong>{bp.name ?? `#${bp.type_id}`}</strong>
        <span className="muted small">
          {/* Las reacciones NO llevan ME/TE: enseñar «ME 0% · TE 0%» ahí sería inventarse una
              propiedad que la fórmula no tiene. */}
          {!ract && `ME ${bp.me}% · TE ${bp.te}% · `}
          {tr("produce")} {fmtSp(perRun * runs)}{" "}
          {product != null ? nameOf(product) : ""}
        </span>
        <button className="sys-close" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="bom-cfg small">
        <label>
          {tr("Carreras")}{" "}
          <input
            type="number"
            min={1}
            max={maxRuns}
            value={runs}
            onChange={(e) => setRuns(Math.max(1, Math.min(maxRuns, Number(e.target.value) || 1)))}
          />
        </label>
        <span className="bom-sep">·</span>
        <label title={tr("Tus fichas de instalación marcadas como elegibles. De la ficha salen el sistema (→ índice de coste y banda de seguridad), el tipo (→ los 3 bonos del SDE) y los rigs. Se editan en «Mis instalaciones», arriba.")}>
          {tr("Instalación")}{" "}
          <FacilityPicker
            usable={usable}
            pick={pick}
            onPick={(v) => {
              setPick(v);
              if (v) localStorage.setItem(PICK_KEY, String(v));
            }}
          />
        </label>
        <span className="muted">
          {usable.length === 0
            ? tr("aún no tienes fichas elegibles: créala arriba, en «Mis instalaciones»")
            : !st
              ? tr("elige una instalación para el coste y los bonos")
              : `${sysHit?.n ?? `#${st.system_id}`} · ${tr("sec")} ${sysHit ? sysHit.s.toFixed(1) : "?"}${
                  st.type_id && ir?.structures[String(st.type_id)]
                    ? ` · ${ir.structures[String(st.type_id)].n.en}`
                    : ""
                }${
                  // El índice que se enseña es el de LA ACTIVIDAD que estás mirando: en modo
                  // reacción, poner el de fabricación era decir un número que no interviene.
                  (mode === "react" ? (idx?.reaction ?? idx?.reactions) : idx?.manufacturing) != null
                    ? ` · ${tr("índice")} ${(
                        (mode === "react"
                          ? (idx!.reaction ?? idx!.reactions)!
                          : idx!.manufacturing) * 100
                      ).toFixed(2)}%`
                    : ""
                }${
                  (mode === "react" && reactFam
                    ? taxFor(st, `reaction_${reactFam}` as TaxAct)
                    : st.tax) != null
                    ? ` · ${tr("impuesto")} ${
                        mode === "react" && reactFam
                          ? taxFor(st, `reaction_${reactFam}` as TaxAct)
                          : st.tax
                      }%`
                    : ""
                }`}
        </span>
        {st && <Confianza f={st} bonos={bonos} />}
      </div>

      {/* Modo del panel: cada actividad con su espacio (regla de la casa). Solo hay pestañas si el
          plano puede inventar; si no, el modo es fabricar y no se enseña el selector. */}
      {((ind?.[String(bp.type_id)]?.i && inv) || ract || copyT > 0) && (
        <div className="seg seg-sm" style={{ margin: "0.4rem 0" }}>
          {!ract && (
            <button className={mode === "build" ? "active" : ""} onClick={() => setMode("build")}>
              <img className="kind-glyph" src={typeIcon(TID_MFG_PLANT, 32)} alt="" /> {tr("Fabricar")}
            </button>
          )}
          {ind?.[String(bp.type_id)]?.i && inv && (
            <button className={mode === "invent" ? "active" : ""} onClick={() => setMode("invent")}>
              <img className="kind-glyph" src={typeIcon(TID_INVENTION_LAB, 32)} alt="" /> {tr("Inventar")}
            </button>
          )}
          {/* Copiar: cualquier plano con actividad de copia (4.340 de los 5.082). Es el eslabón que
              faltaba de la cadena T2 — la invención consume RUNS de un BPC T1, y esas runs salen
              de aquí. */}
          {copyT > 0 && !ract && (
            <button className={mode === "copy" ? "active" : ""} onClick={() => setMode("copy")}>
              <img className="kind-glyph" src={typeIcon(TID_INVENTION_LAB, 32)} alt="" />{" "}
              {tr("Copiar")}
            </button>
          )}
          {/* Una fórmula de reacción NO se fabrica: no tiene sentido ofrecer «Fabricar» al lado. */}
          {ract && (
            <button className={mode === "react" ? "active" : ""} onClick={() => setMode("react")}>
              <img className="kind-glyph" src={typeIcon(TID_COMPOSITE_REACTOR, 32)} alt="" />{" "}
              {tr("Reaccionar")}
            </button>
          )}
        </div>
      )}

      {/* Leyenda «tus fabricantes» (gemela de la de inventores): velocidad del job por personaje
          (Industry −4%/nivel × Advanced Industry −3%/nivel, factores verificados con el fixture)
          y ✗ si le FALTAN las skills requeridas por el plano (el juego no le dejaría lanzarlo). */}
      {mode === "build" && buildChars && buildChars.length > 0 && (
        <div className="bom-cost small">
          <div className="bom-cost-row muted">
            <span>{tr("Tus fabricantes (velocidad del job)")}</span>
            <span>
              {buildChars
                .map((c) => {
                  const f =
                    (1 - 0.04 * (c.levels[INDUSTRY_SKILL] ?? 0)) *
                    (1 - 0.03 * (c.levels[ADV_INDUSTRY_SKILL] ?? 0));
                  const missing = (act?.sk ?? []).filter(
                    ([s, lvl]) => (c.levels[s] ?? 0) < lvl,
                  );
                  return { c, f, missing };
                })
                .sort((a, b) => (a.missing.length ? 1 : 0) - (b.missing.length ? 1 : 0) || a.f - b.f)
                .map(({ c, f, missing }, i) => (
                  <span
                    key={c.character_id}
                    className="pp-tag"
                    style={{ marginLeft: "0.4rem" }}
                    title={
                      missing.length
                        ? `${tr("Le falta")}: ${missing.map(([s, lvl]) => `${nameOf(s)} ${lvl}`).join(" · ")}`
                        : `Industry ${c.levels[INDUSTRY_SKILL] ?? 0} · Advanced Industry ${c.levels[ADV_INDUSTRY_SKILL] ?? 0}`
                    }
                  >
                    <img
                      className="kind-glyph"
                      src={`https://images.evetech.net/characters/${c.character_id}/portrait?size=32`}
                      alt=""
                      style={{ borderRadius: "50%", width: 16, height: 16, verticalAlign: -3 }}
                    />{" "}
                    {i === 0 && missing.length === 0 ? "★ " : ""}
                    {c.name} {missing.length ? "✗" : `−${Math.round((1 - f) * 100)}%`}
                  </span>
                ))}
            </span>
          </div>
        </div>
      )}

      {/* Leyenda «tus reaccionadores» — la tercera de la familia (inventores / fabricantes / esta).
          La velocidad sale SOLO de la skill Reactions (−4 %/nivel, verificada con el fixture del
          Tatara: nivel V = el «−20,0 %» que enseña el juego). Ojo, Advanced Industry NO entra aquí:
          eso es fabricación e invención. Y ✗ si le faltan las skills que pide la fórmula: el juego
          no le dejaría ni lanzar el job. */}
      {mode === "react" && ract && buildChars && buildChars.length > 0 && (
        <div className="bom-cost small">
          <div className="bom-cost-row muted">
            <span>{tr("Tus reaccionadores (velocidad del job)")}</span>
            <span>
              {buildChars
                .map((c) => {
                  const lvl = c.levels[REACTIONS_SKILL] ?? 0;
                  const f = 1 - 0.04 * lvl;
                  const missing = (ract.sk ?? []).filter(([s, l]) => (c.levels[s] ?? 0) < l);
                  return { c, f, lvl, missing };
                })
                .sort((a, b) => (a.missing.length ? 1 : 0) - (b.missing.length ? 1 : 0) || a.f - b.f)
                .map(({ c, f, lvl, missing }, i) => (
                  <span
                    key={c.character_id}
                    className="pp-tag"
                    style={{ marginLeft: "0.4rem" }}
                    title={
                      missing.length
                        ? `${tr("Le falta")}: ${missing.map(([s, l]) => `${nameOf(s)} ${l}`).join(" · ")}`
                        : `Reactions ${lvl}`
                    }
                  >
                    <img
                      className="kind-glyph"
                      src={`https://images.evetech.net/characters/${c.character_id}/portrait?size=32`}
                      alt=""
                      style={{ borderRadius: "50%", width: 16, height: 16, verticalAlign: -3 }}
                    />{" "}
                    {i === 0 && missing.length === 0 ? "★ " : ""}
                    {c.name} {missing.length ? "✗" : `−${Math.round((1 - f) * 100)}%`}
                  </span>
                ))}
            </span>
          </div>
        </div>
      )}

      {/* F2c — COPIA. Comparte fórmula con la invención («trabajos de ciencia»), con su capa CTB
          del 2 %. Verificada al ISK contra el fixture del Apostle. */}
      {mode === "copy" && copyJob && (
        <div className="bom-cost small">
          {!st?.has_lab && (
            <div className="muted">
              {tr("La instalación elegida no tiene laboratorio declarado (marca 🔬 «Lab» en su ficha).")}
            </div>
          )}
          <div className="bom-cost-row">
            <span>{tr("Copias")}</span>
            <span>
              <input
                type="number"
                min="1"
                value={copies}
                onChange={(e) => setCopies(Math.max(1, Number(e.target.value) || 1))}
                style={{ width: "4.5rem", textAlign: "right" }}
              />{" "}
              × {tr("runs por copia")}{" "}
              <input
                type="number"
                min="1"
                max={maxPerCopy}
                value={runsPerCopy}
                onChange={(e) =>
                  setRunsPerCopy(Math.min(maxPerCopy, Math.max(1, Number(e.target.value) || 1)))
                }
                style={{ width: "4.5rem", textAlign: "right" }}
                title={`${tr("máximo por copia según el plano")}: ${fmtSp(maxPerCopy)}`}
              />
              <span className="muted small">
                {" "}
                = {fmtSp(copyJob.totalRuns)} {tr("runs con licencia")}
              </span>
            </span>
          </div>
          <div className="bom-cost-row">
            <span title={tr("Candidato: materiales de 1 run del plano a adjusted, × las runs con licencia. El tiempo SÍ escala así (verificado); el coste con varias runs está sin contrastar — compáralo con el tooltip del juego.")}>
              {tr("Valor estimado del objeto (VEO)")}
            </span>
            <strong>{fmtIsk(copyJob.veo)}</strong>
          </div>
          {copyJob.total == null ? (
            <div className="muted">
              {tr("Sin índice de copia: elige una instalación con laboratorio para calcular la tasa.")}
            </div>
          ) : (
            <>
              <div className="bom-cost-row">
                <span
                  title={`CTB (2% VEO): ${fmtIsk(copyJob.ctb!)} · ${tr("índice")} ${(copyJob.index! * 100).toFixed(2)}% ${tr("sobre el CTB")} · ${tr("impuesto")} ${taxFor(st!, "copy") ?? 0}% · CCS 4%`}
                >
                  {tr("Tasa del job")}
                </span>
                <strong>{fmtIsk(copyJob.total)}</strong>
              </div>
              <div className="bom-cost-row muted">
                <span>{tr("Desglose")}</span>
                <span>
                  {tr("bruto")} {fmtIsk(copyJob.bruto!)} · {tr("centro")} {fmtIsk(copyJob.tax!)} · CCS{" "}
                  {fmtIsk(copyJob.ccs!)}
                </span>
              </div>
            </>
          )}
          <div className="bom-cost-row">
            <span title={`${tr("base")} ${fmtSp(copyT)}s/run · Science −5%/${tr("nivel")} × Advanced Industry −3%/${tr("nivel")} · ${tr("rigs y estructura")}`}>
              ⏱ {tr("Duración")}
            </span>
            <span>
              {Math.floor(copyJob.time / 3600)}h {Math.floor((copyJob.time % 3600) / 60)}m
            </span>
          </div>
          <p className="muted">
            {tr("Copiar es un «trabajo de ciencia»: comparte fórmula con la invención (capa CTB del 2 %) y compite por las mismas ranuras que copiar, investigar e inventar. Un BPO T1 no pide materiales; un BPO T2 sí (hojas de datos y BDI), y eso todavía no se cuenta aquí.")}
          </p>
        </div>
      )}

      {/* F-REACCIONES — panel propio. Reaccionar no lleva ME/TE, no tiene bonos de coste y solo se
          puede en lowsec/null: cada una de esas tres cosas se DICE, no se esconde. */}
      {mode === "react" && ract && reactCost && (
        <div className="bom-cost small">
          {!st?.has_reactor && (
            <div className="muted">
              {tr("La instalación elegida no tiene reactor declarado (marca «Reactor» en su ficha).")}
            </div>
          )}
          {sysHit?.s != null && secBand(sysHit.s) === "hi" && (
            <div className="muted">
              ⚠ {tr("Reaccionar en highsec no se puede: lo dice el propio módulo en el SDE.")}
            </div>
          )}
          <div className="bom-cost-row">
            <span>{tr("Valor estimado del objeto (VEO)")}</span>
            <strong>{fmtIsk(reactCost.veo)}</strong>
          </div>
          {reactCost.total == null ? (
            <div className="muted">
              {tr("Sin índice de reacción: elige una instalación con reactor para calcular la tasa.")}
            </div>
          ) : (
            <>
              <div className="bom-cost-row">
                <span
                  title={`${tr("índice")} ${(reactCost.index * 100).toFixed(2)}% · ${tr("impuesto")} ${
                    reactCost.taxPct ?? 0
                  }% · CCS 4% · ${tr("reaccionar no tiene bonificación de coste: ninguna estructura ni rig la dan (SDE)")}`}
                >
                  {tr("Tasa del job")}
                </span>
                <strong>{fmtIsk(reactCost.total)}</strong>
              </div>
              <div className="bom-cost-row muted">
                <span>{tr("Desglose")}</span>
                <span>
                  {tr("bruto")} {fmtIsk(reactCost.bruto!)} · {tr("centro")} {fmtIsk(reactCost.tax!)} ·
                  CCS {fmtIsk(reactCost.ccs!)}
                </span>
              </div>
            </>
          )}
          {/* ⏱ Tiempo. Los tres factores están VERIFICADOS contra el fixture del Tatara:
              10.800 s/run × 100 × 0,80 (Reactions V) × 0,736 (rig) × 0,75 (Tatara) = 5D 12:28:48. */}
          {reactBon && (
            <div className="bom-cost-row">
              <span
                title={`${tr("base")} ${ract.t}s/run × ${runs} · ${tr("skill Reactions −4%/nivel")} · ${tr("rigs y estructura")}`}
              >
                ⏱ {tr("Duración")}
              </span>
              <span>
                {(() => {
                  // El MEJOR de tus personajes que además pueda lanzar el job: sin las skills
                  // requeridas el juego no le deja, así que su velocidad no es una opción real.
                  const aptos = (buildChars ?? []).filter((c) =>
                    (ract.sk ?? []).every(([s, l]) => (c.levels[s] ?? 0) >= l),
                  );
                  const lvl = Math.max(0, ...aptos.map((c) => c.levels[REACTIONS_SKILL] ?? 0));
                  const s = ract.t * runs * (1 - 0.04 * lvl) * reactBon.time;
                  const h = Math.floor(s / 3600);
                  return `${h}h ${Math.floor((s % 3600) / 60)}m${
                    (buildChars ?? []).length ? ` · Reactions ${lvl}` : ` · ${tr("sin skills")}`
                  }`;
                })()}
              </span>
            </div>
          )}
          {reactBon && (
            <div className="bom-cost-row muted">
              <span>{tr("Bonificaciones de reacción")}</span>
              <span
                title={reactBon.rigs
                  .map((r) => `${r.name}: ${r.mat.toFixed(2)}% mat · ${r.time.toFixed(1)}% tiempo`)
                  .join(" · ")}
              >
                {tr("materiales")} ×{reactBon.mat.toFixed(4)} · {tr("tiempo")} ×
                {reactBon.time.toFixed(3)}
                {reactBon.strTime !== 1 && ` (${tr("estructura")} ×${reactBon.strTime})`}
              </span>
            </div>
          )}
          <p className="muted">
            {tr("Las reacciones no llevan ME/TE: los materiales solo bajan con los rigs de la refinería. Y no existe bonificación de coste — ni de estructura ni de rig —, así que la tasa es índice + impuestos y nada más.")}
          </p>
        </div>
      )}

      {/* Los materiales de entrada: lo que de verdad se viene a mirar. Cantidades REDONDEADAS
          HACIA ARRIBA (el juego pide 487 donde salen 486,8) y cruzadas con tu stock. */}
      {mode === "react" && reactRows && (
        <table className="km-table small">
          <thead>
            <tr>
              <th>{tr("Material")}</th>
              <th style={{ textAlign: "right" }}>{tr("Necesitas")}</th>
              <th style={{ textAlign: "right" }}>
                {inFacility ? tr("En instalación") : tr("Tienes")}
              </th>
              <th style={{ textAlign: "right" }}>{tr("Te falta")}</th>
              <th style={{ textAlign: "right" }}>{tr("Comprar")}</th>
            </tr>
          </thead>
          <tbody>
            {reactRows.map((r) => (
              <tr key={r.key}>
                <td style={{ paddingLeft: `${r.depth * 1.2}rem` }}>
                  {/* Desplegable solo si ese material sale a su vez de otra reacción. */}
                  {r.sub ? (
                    <button
                      className="bom-exp"
                      title={
                        openReact.has(r.key)
                          ? tr("plegar: volver a comprarlo")
                          : tr("desplegar: reaccionarlo tú")
                      }
                      onClick={() =>
                        setOpenReact((prev) => {
                          const n = new Set(prev);
                          if (n.has(r.key)) n.delete(r.key);
                          else n.add(r.key);
                          return n;
                        })
                      }
                    >
                      {openReact.has(r.key) ? "▾" : "▸"}
                    </button>
                  ) : (
                    <span className="bom-exp" style={{ visibility: "hidden" }}>
                      ▸
                    </span>
                  )}{" "}
                  <img className="kind-glyph" src={typeIcon(r.tid, 32)} alt="" /> {nameOf(r.tid)}
                  <span className="muted small">
                    {" "}
                    · {tr("base")} {fmtSp(r.base)}/run
                    {r.sub && r.subRuns > 0 && (
                      <>
                        {" "}
                        · {r.subRuns} {tr("runs de su reacción")}
                      </>
                    )}
                  </span>
                </td>
                <td style={{ textAlign: "right" }}>{fmtSp(r.need)}</td>
                <td style={{ textAlign: "right" }} className="muted">
                  {fmtSp(r.have)}
                </td>
                <td style={{ textAlign: "right" }} className={r.miss > 0 ? "bad" : ""}>
                  {r.miss > 0 ? fmtSp(r.miss) : "—"}
                </td>
                <td style={{ textAlign: "right" }} className="muted">
                  {r.miss > 0 && r.price != null ? fmtIsk(r.miss * r.price) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {mode === "react" && reactShop && reactShop.types > 0 && (
        <div className="bom-cost small">
          <div className="bom-cost-row">
            <span>
              {tr("Lista de la compra")}{" "}
              <span className="muted">
                · {reactShop.types} {tr("tipos")}
              </span>
            </span>
            <strong>
              {fmtIsk(reactShop.isk)}
              {reactShop.sinPrecio > 0 && " *"}
            </strong>
          </div>
          <div className="bom-cost-row muted">
            <span>{tr("Volumen a transportar")}</span>
            <span>{fmtSp(Math.round(reactShop.m3))} m³</span>
          </div>
        </div>
      )}

      {/* «No lo compres, tráelo»: dónde tienes ya lo que falta, y a cuántos saltos. */}
      {mode === "react" && traer && traer.length > 0 && (
        <div className="bom-cost small">
          <div className="bom-cost-row">
            <span>{tr("Ya lo tienes en otro sitio")}</span>
            <span className="muted">
              {traer.length} {tr("ubicaciones")}
            </span>
          </div>
          {traer.slice(0, 6).map((s) => (
            <div className="bom-cost-row muted" key={s.loc}>
              <span>
                {s.label}
                {s.jumps != null ? (
                  <span className="small"> · {s.jumps === 0 ? tr("mismo sistema") : `${s.jumps} ${tr("saltos")}`}</span>
                ) : (
                  <span className="small"> · {tr("sin ubicar")}</span>
                )}
              </span>
              <span className="small">
                {s.items
                  .map((it) => `${nameOf(it.tid)} ×${fmtSp(it.qty)}`)
                  .join(" · ")}
              </span>
            </div>
          ))}
          <p className="muted">
            {tr("Saltos por puertas desde el sistema de la instalación. Las estructuras sin resolver salen como «sin ubicar»: preferimos decirlo a inventar una distancia.")}
          </p>
        </div>
      )}

      {/* F1b — Coste del trabajo. Fórmula verificada al ISK contra el juego (fixture Bantam:
          279.893 × 0,0998 = 27.938 → −5% = 26.541 · +1% VEO = 2.799 · +4% VEO = 11.196 → 40.536).
          Ojo al orden: la bonificación de estructura va sobre el BRUTO; los impuestos, sobre el VEO. */}
      {mode === "build" && cost && (
        <div className="bom-cost small">
          <div className="bom-cost-row">
            <span>{tr("Valor estimado del objeto (VEO)")}</span>
            <strong>{fmtIsk(cost.veo)}</strong>
          </div>
          {cost.index == null ? (
            /* ⚠️ SIN índice hay DOS causas muy distintas, y hasta hoy las dos decían «elige una
               estructura» — con una estructura ya elegida. Lo cazó RoGiz7 (2026-08-11) probando el
               mismo plano en tres sitios: el Tatara y el «Weaselior University T2 Lab» daban ese
               aviso, y el Lab **es un Sotiyo**, que fabricar fabrica. O sea que la causa no era la
               estructura: era que su ficha no tiene marcada la FABRICACIÓN.
               Un mensaje que manda a hacer algo que ya está hecho es peor que no decir nada. */
            <div className="muted">
              {st && !st.has_mfg
                ? `${tr("Esta instalación no tiene marcada la fabricación en su ficha")}${
                    st.has_lab || st.has_reactor
                      ? ` (${tr("solo")} ${[
                          st.has_lab ? tr("laboratorio") : null,
                          st.has_reactor ? tr("reactor") : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}).`
                      : "."
                  } ${tr("Márcala en Ajustes → Instalaciones si de verdad fabrica ahí.")}`
                : tr("Sin índice de coste: elige una estructura para calcular el coste del trabajo.")}
            </div>
          ) : (
            <>
              <div className="bom-cost-row muted">
                <span>
                  {tr("Índice de coste en sistema")} ({(cost.index * 100).toFixed(2)}%)
                </span>
                <span>{fmtIsk(cost.bruto!)}</span>
              </div>
              {(bonos?.strCost ?? 1) !== 1 && (
                <div className="bom-cost-row muted">
                  <span>
                    {tr("Bonificación de estructura")} (−
                    {((1 - (bonos?.strCost ?? 1)) * 100).toFixed(0)}%)
                  </span>
                  <span>−{fmtIsk(cost.bruto! - cost.brutoTotal!)}</span>
                </div>
              )}
              <div className="bom-cost-row muted">
                <span>
                  {tr("Impuesto de centro")} ({(st?.tax ?? 0)}% VEO)
                </span>
                <span>+{fmtIsk(cost.tax!)}</span>
              </div>
              <div className="bom-cost-row muted">
                <span>{tr("Recargo de CCS")} (4% VEO)</span>
                <span>+{fmtIsk(cost.ccs!)}</span>
              </div>
              <div className="bom-cost-row bom-cost-total">
                <span>{tr("Coste total del trabajo")}</span>
                <strong>{fmtIsk(cost.total!)}</strong>
              </div>
            </>
          )}
          {cost.faltan > 0 && (
            <div className="muted">
              ⚠ {cost.faltan} {tr("material(es) sin adjusted_price: el VEO se queda corto. Sincroniza precios.")}
            </div>
          )}
        </div>
      )}

      {/* F2 — Invención: si este plano T1 puede inventar, la tabla por decryptor (probabilidad,
          BPC resultante y coste por intento/éxito/run). El componente se autoexcluye si no inventa. */}
      {mode === "invent" && inv && ind && (
        <InventionBlock
          bpId={bp.type_id}
          inv={inv}
          ind={ind}
          nameOf={nameOf}
          subject={subject}
          lab={st?.has_lab ? st : null}
          noLabPicked={st != null && !st.has_lab}
          ir={ir}
          sys={sys}
          stock={stockUsed}
          inFacility={inFacility}
          vols={vols}
        />
      )}

      {/* F1d — Qué comprar y transportar, según el árbol tal y como está desplegado: lo abierto se
          fabrica, las hojas se compran. El m³ usa el volumen REEMPAQUETADO cuando Hoboleaks corrige
          al SDE — si la ventaja se construye sobre un número, que sea el bueno. */}
      {mode === "build" && stockRows != null && shopping.types > 0 && (
        <div className="bom-cost small">
          <div className="bom-cost-row">
            <span>
              {/* PLEX (44992) = comprar, Badger (648) = transportar: los mismos iconos reales del
                  Image Server que usa el resto de la app (elección de RoGiz7). */}
              <img className="kind-glyph" src={typeIcon(44992, 32)} alt="" />{" "}
              {inFacility
                ? tr("Qué comprar (descontado lo que ya hay EN la instalación)")
                : tr("Qué comprar (las hojas del árbol, descontado tu stock)")}
              : {shopping.types} {tr("tipos")}
            </span>
            <strong>{fmtIsk(shopping.isk)}</strong>
          </div>
          <div className="bom-cost-row muted">
            <span>
              <img className="kind-glyph" src={typeIcon(648, 32)} alt="" /> {tr("Qué transportar")}
            </span>
            <span>{fmtSp(Math.ceil(shopping.m3))} m³</span>
          </div>
          {(shopping.sinPrecio > 0 || shopping.sinVol > 0) && (
            <div className="muted">
              ⚠{" "}
              {shopping.sinPrecio > 0 &&
                `${shopping.sinPrecio} ${tr("tipo(s) sin precio de mercado (el ISK se queda corto)")}`}
              {shopping.sinPrecio > 0 && shopping.sinVol > 0 && " · "}
              {shopping.sinVol > 0 && `${shopping.sinVol} ${tr("sin volumen (el m³ se queda corto)")}`}
            </div>
          )}
        </div>
      )}

      {mode === "build" && (
      <>
      <table className="km-table bom-table">
        <thead>
          <tr>
            <th>{tr("Material")}</th>
            <th>{tr("Necesitas")}</th>
            <th
              title={
                inFacility
                  ? tr("Lo que ya está DENTRO de la estructura de tu ficha (contenedores y naves incluidos)")
                  : tr("Todos tus assets, estén donde estén")
              }
            >
              {inFacility ? tr("En instalación") : tr("Tienes")}
            </th>
            <th>{tr("Te falta")}</th>
            <th title={tr("Lo que te falta, a precio de mercado (prices_map local)")}>{tr("Comprar")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const have = stockUsed?.get(r.tid) ?? 0;
            const miss = Math.max(0, r.qty - have);
            const isOpen = open.has(r.tid);
            const price = prices.get(r.tid);
            // F1d — veredicto build-vs-buy del nodo fabricable: comprar la unidad a mercado vs
            // fabricarla (materiales de UN nivel a mercado + tasa de su job). v1 honesto: no
            // optimiza recursivamente el árbol entero, y lo dice en el tooltip.
            const bi = r.subBp && price != null ? buildUnit(r.subBp) : null;
            const verdict =
              bi && price != null
                ? bi.unit < price
                  ? { build: true, pct: (1 - bi.unit / price) * 100 }
                  : { build: false, pct: (1 - price / bi.unit) * 100 }
                : null;
            return (
              <tr key={`${r.tid}-${r.depth}-${i}`} className={miss === 0 ? "bom-ok" : ""}>
                <td style={{ paddingLeft: `${0.4 + r.depth * 1.1}rem` }}>
                  {r.subBp ? (
                    <button
                      className="bom-exp"
                      onClick={() => {
                        const s = new Set(open);
                        isOpen ? s.delete(r.tid) : s.add(r.tid);
                        setOpen(s);
                      }}
                      title={tr("Desplegar sus materiales")}
                    >
                      {isOpen ? "▾" : "▸"}
                    </button>
                  ) : (
                    <span className="bom-exp bom-leaf">·</span>
                  )}
                  <img src={typeIcon(r.tid, 32)} alt="" width={16} height={16} /> {nameOf(r.tid)}
                  {r.subBp && isOpen && (
                    <span className="muted small">
                      {" "}
                      — ME {r.childMe ?? 0}%{r.childMe == null ? ` (${tr("estimado")})` : ""}
                    </span>
                  )}
                  {verdict && (
                    <span
                      className={`bom-verdict ${verdict.build ? "build" : "buy"}`}
                      title={`${tr("Fabricar la unidad")}: ${fmtIsk(bi!.unit)} · ${tr("Comprarla")}: ${fmtIsk(price!)}. ${tr("Fabricar = sus materiales (un nivel, a mercado) + la tasa de su job con TU instalación. No optimiza el árbol entero: es la comparación de ESTE nodo.")}${bi!.est ? ` ${tr("Estimado: falta algún precio o el plano (ME 0).")}` : ""}`}
                    >
                      {verdict.build ? "🔧" : "🛒"}{" "}
                      {verdict.build ? tr("fabricar") : tr("comprar")} −{verdict.pct.toFixed(0)}%
                      {bi!.est ? "~" : ""}
                    </span>
                  )}
                </td>
                <td>{fmtSp(r.qty)}</td>
                <td className="muted">{stockRows == null ? "…" : fmtSp(have)}</td>
                <td className={miss > 0 ? "bom-miss" : "bom-ok-txt"}>
                  {stockRows == null ? "…" : miss > 0 ? fmtSp(miss) : "✓"}
                </td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>
                  {miss > 0 && price != null ? fmtIsk(miss * price) : miss > 0 ? "—" : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">
        {inFacility
          ? tr("«En instalación» cuenta SOLO lo que ya está dentro de la estructura de tu ficha (subiendo por contenedores y naves): lo que falte ahí es exactamente lo que hay que comprar o transportar.")
          : tr("«Tienes» suma tus assets (los del personaje activo, o de todos en Global). Un material desplegado usa el ME de TU plano; si no lo tienes, se calcula con ME 0 y se marca «estimado» — nunca se disfraza de real.")}{" "}
        {!inFacility && st != null && st.structure_id == null && (
          <>{tr("Tu ficha es manual (sin estructura de ESI), así que no sabemos qué hay dentro: se usa el total de tus assets.")} </>
        )}
        {tr("El veredicto 🔧/🛒 compara comprar cada unidad a mercado con fabricarla (sus materiales a un nivel + la tasa del job); lo que despliegas se fabrica y las hojas van a la lista de la compra.")}
      </p>
      </>
      )}
    </div>
  );
}

/** F1a — Tu biblioteca de blueprints con los ME/TE REALES (scope read_blueprints, R4).
 *  Con 2.000+ planos una tabla plana no vale: se navega como Assets, por pestañas de categoría
 *  (nivel 1 del árbol de mercado: Naves, Munición…) + subpestañas (Fragatas, Cruceros…) + buscador.
 *  Los nombres de grupo salen del SDE y YA vienen bilingües (`n` EN / `ne` ES). Idea de RoGiz7. */
function BlueprintLibrary({
  subject,
  global,
  facsVersion,
}: {
  subject: number | "global";
  global?: boolean;
  facsVersion: number;
}) {
  const [bps, setBps] = useState<Blueprint[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [tree, setTree] = useState<BpTree | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<number | "">("");
  const [sub, setSub] = useState<number | "">("");
  const [bom, setBom] = useState<Blueprint | null>(null); // plano abierto en el árbol BOM

  useEffect(() => {
    fetch("/bp_tree.json").then((r) => r.json()).then(setTree).catch(() => setTree(null));
  }, []);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    setDenied(false);
    const p =
      subject === "global"
        ? invoke<Blueprint[]>("get_blueprints_global")
        : invoke<Blueprint[]>("get_blueprints", { characterId: subject });
    p.then((v) => alive && setBps(v))
      .catch(() => {
        if (alive) {
          setBps(null);
          setDenied(true); // sin scope todavía: se dice, no se disimula
        }
      })
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [subject]);

  const es = getLang() === "es";
  const catName = (id: number) => {
    const e = tree?.cat[String(id)];
    return e ? (es ? e.es : e.en) : `#${id}`;
  };
  const grpName = (id: number) => {
    const e = tree?.grp[String(id)];
    return e ? (es ? e.es : e.en) : `#${id}`;
  };

  // Cada blueprint con la categoría y el grupo de su PRODUCTO (null = sin producto resoluble).
  const rows = useMemo(
    () =>
      (bps ?? []).map((bp) => {
        const e = tree?.bp[String(bp.type_id)];
        return { bp, l1: e ? e[0] : null, l2: e ? e[1] : null };
      }),
    [bps, tree],
  );

  const tally = (
    pick: (r: (typeof rows)[number]) => number | null,
    name: (id: number) => string,
    only?: number | "",
  ) => {
    const c = new Map<number, number>();
    for (const r of rows) {
      if (only !== undefined && only !== "" && r.l1 !== only) continue;
      const id = pick(r);
      if (id != null) c.set(id, (c.get(id) ?? 0) + 1);
    }
    return [...c.entries()]
      .map(([id, n]) => ({ id, n, label: name(id) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  };
  // `es` en las deps: al cambiar de idioma hay que reetiquetar las pestañas.
  const cats = useMemo(() => tally((r) => r.l1, catName), [rows, tree, es]);
  const subs = useMemo(
    () => (cat === "" ? [] : tally((r) => r.l2, grpName, cat)),
    [rows, cat, tree, es],
  );

  const ql = q.trim().toLowerCase();
  const shown = rows
    .filter((r) => (cat === "" || r.l1 === cat) && (sub === "" || r.l2 === sub))
    .filter((r) => ql === "" || (r.bp.name ?? "").toLowerCase().includes(ql))
    .sort((a, b) => (a.bp.name ?? "").localeCompare(b.bp.name ?? ""));

  if (busy && !bps) return <p className="muted">{tr("Cargando biblioteca de blueprints…")}</p>;
  if (denied)
    return (
      <p className="muted small">
        {tr("Sin acceso a tus blueprints: concede el grupo «Industria» en «Conceder acceso».")}
      </p>
    );
  if (!bps || bps.length === 0) return <p className="muted small">{tr("No tienes blueprints.")}</p>;

  const bpo = bps.filter((b) => b.quantity === -1).length;
  const LIMIT = 300;

  return (
    <div className="bp-lib">
      <h4>📘 {tr("Tu biblioteca de blueprints")}</h4>
      {bom && (
        <BomPanel
          bp={bom}
          owned={bps}
          subject={subject}
          onClose={() => setBom(null)}
          facsVersion={facsVersion}
        />
      )}
      <div className="kpis">
        <Kpi label={tr("Blueprints")} value={fmtSp(bps.length)} />
        <Kpi label="BPO" value={fmtSp(bpo)} />
        <Kpi label="BPC" value={fmtSp(bps.length - bpo)} />
      </div>

      <div className="tabs" style={{ marginTop: "0.5rem" }}>
        <button
          className={`tab ${cat === "" ? "active" : ""}`}
          onClick={() => {
            setCat("");
            setSub("");
          }}
        >
          {tr("Todos")} ({fmtSp(rows.length)})
        </button>
        {cats.map((c) => (
          <button
            key={c.id}
            className={`tab ${cat === c.id ? "active" : ""}`}
            onClick={() => {
              setCat(c.id);
              setSub("");
            }}
          >
            {c.label} ({fmtSp(c.n)})
          </button>
        ))}
      </div>

      {cat !== "" && subs.length > 1 && (
        <div className="tabs bp-subtabs">
          <button className={`tab ${sub === "" ? "active" : ""}`} onClick={() => setSub("")}>
            {tr("Todas")}
          </button>
          {subs.map((s) => (
            <button
              key={s.id}
              className={`tab ${sub === s.id ? "active" : ""}`}
              onClick={() => setSub(s.id)}
            >
              {s.label} ({fmtSp(s.n)})
            </button>
          ))}
        </div>
      )}

      <div className="asset-search">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tr("Buscar blueprint…")}
        />
      </div>

      <table className="km-table">
        <thead>
          <tr>
            {global && <th>{tr("Personaje")}</th>}
            <th>{tr("Blueprint")}</th>
            <th>{tr("Tipo")}</th>
            <th>ME</th>
            <th>TE</th>
            <th>{tr("Runs")}</th>
          </tr>
        </thead>
        <tbody>
          {shown.slice(0, LIMIT).map((r, i) => {
            const b = r.bp;
            const isBpo = b.quantity === -1;
            return (
              <tr
                key={`${b.type_id}-${i}`}
                className="bp-row"
                onClick={() => setBom(b)}
                title={tr("Ver qué hace falta para fabricarlo")}
              >
                {global && <td>{b.character ?? "-"}</td>}
                <td>
                  <img src={bpIcon(b.type_id, isBpo, 32)} alt="" width={18} height={18} />{" "}
                  {b.name ?? `#${b.type_id}`}
                </td>
                <td className={isBpo ? "bp-bpo" : "bp-bpc"}>{isBpo ? "BPO" : "BPC"}</td>
                <td>{b.me}%</td>
                <td>{b.te}%</td>
                <td>{isBpo ? "∞" : fmtSp(b.runs)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {shown.length > LIMIT && (
        <p className="muted small">
          {tr("Mostrando los primeros")} {LIMIT} / {fmtSp(shown.length)} —{" "}
          {tr("afina con las pestañas o el buscador.")}
        </p>
      )}
      {/* 0 resultados con texto en el buscador: decirlo. (RoGiz7 perdió 10 min por un filtro
          fantasma — el buscador tenía texto y las pestañas parecían rotas.) */}
      {shown.length === 0 && ql !== "" && (
        <p className="muted small">
          ⚠ {tr("Sin resultados… pero tienes")} «{q.trim()}» {tr("en el buscador — bórralo para ver la pestaña completa.")}
        </p>
      )}
    </div>
  );
}

/* ============================ F1c — Mis instalaciones ============================
 *
 * El registro de estructuras del fabricante. Idea de RoGiz7, y corrige el rumbo anterior: intentar
 * DEDUCIR qué tiene cada estructura es imposible — los rigs y los servicios no los da ESI (solo a
 * un Director vía /corporations/{id}/structures/) ni se ven in-game sin roles.
 * Por eso las alianzas publican hojas de cálculo con las mejoras de sus estaciones.
 *
 * La respuesta no es importar la hoja de una alianza concreta (serviría a esa alianza y a nadie
 * más), sino un ASISTENTE que le pregunte al fabricante lo que sabe. La hoja de los Goons sirvió
 * para validar el modelo de datos, no como fuente: su forma —Sistema | Estructura | Nombre |
 * Servicios | Rig 1-3— es exactamente lo que se pregunta aquí. Y confirmó el fixture por su cuenta
 * (dice que el Sotiyo de C-J6MT lleva el rig 37181, el mismo que dedujimos del job del Bantam).
 *
 * Regla de oro: aquí NO se piden porcentajes. Se pide QUÉ es y QUÉ lleva; los números los pone el
 * SDE. Pedir % a mano fue la trampa que ya nos mordió (tres bonos con el mismo nombre in-game, y
 * el % del rig se muestra redondeado: −5,0 % cuando en realidad es −5,04 %).
 */
function FacilitiesBlock({ onChange }: { onChange: () => void }) {
  const [facs, setFacs] = useState<Facility[] | null>(null);
  const [ir, setIr] = useState<IndustryRigs | null>(null);
  const [sys, setSys] = useState<{ id: number; n: string; s: number }[] | null>(null);
  const [edit, setEdit] = useState<Facility | null>(null);
  const [busy, setBusy] = useState(false);
  const [abierto, setAbierto] = useState<boolean | null>(() => {
    const v = localStorage.getItem(OPEN_KEY);
    return v === null ? null : v === "1"; // null = sin opinión, decide el tamaño de la lista
  });

  const load = () => {
    invoke<Facility[]>("facility_list")
      .then(setFacs)
      .catch(() => setFacs([]));
  };
  useEffect(() => {
    load();
    fetch("/industry_rigs.json").then((r) => r.json()).then(setIr).catch(() => setIr(null));
    fetch("/neweden.json")
      .then((r) => r.json())
      .then((d: { systems: { id: number; n: string; s: number }[] }) => setSys(d.systems))
      .catch(() => setSys([]));
  }, []);

  /** Cuántas fichas están DECLARADAS y entran en el BOM. Es el único número que importa de un
   *  registro de 27: las demás son nombres que ESI conoce y de los que no sabemos nada. */
  const enUso = facs?.filter((f) => f.eligible).length ?? 0;
  /** Plegado. `abierto === null` = aún no ha opinado → se pliega solo si la lista es un muro.
   *  En cuanto toca el botón manda él, y se recuerda. */
  const visible = abierto ?? (facs?.length ?? 0) <= FOLD_AT;

  // Guardar y borrar dicen si fallan. Sin esto el `invoke` reventaba, el asistente se quedaba
  // abierto y no pasaba NADA: el usuario ve un botón que no hace nada y no tiene dónde mirar.
  const save = async (f: Facility) => {
    try {
      await invoke("facility_upsert", { facility: f });
      setEdit(null);
      load();
      onChange();
    } catch (e) {
      alert(`${tr("No se pudo guardar la ficha")}:\n\n${e}`);
    }
  };
  const remove = async (id: number) => {
    try {
      await invoke("facility_delete", { id });
      load();
      onChange();
    } catch (e) {
      alert(`${tr("No se pudo borrar la ficha")}:\n\n${e}`);
    }
  };
  const toggle = async (f: Facility, k: "eligible" | "has_mfg" | "has_lab" | "has_reactor") =>
    save({ ...f, [k]: !f[k] });

  /** Trae de ESI las estructuras que ya conocemos, para no empezar con la lista en blanco. Solo
   *  rellena lo que ESI sabe (nombre/sistema/tipo) y las deja SIN marcar: una ficha sin declarar no
   *  debe colarse en el desplegable como si supiéramos sus rigs. */
  const seed = async () => {
    setBusy(true);
    try {
      const n = await invoke<number>("facility_seed_from_esi");
      load();
      onChange();
      if (n === 0) alert(tr("No hay estructuras nuevas que traer: ya están todas en tu registro."));
    } catch (e) {
      // El error se enseña TAL CUAL. Antes aquí había un `catch` pelado que endosaba «¿has
      // concedido read_structures?» a cualquier fallo: nos mandó a mirar los scopes cuando lo que
      // fallaba era un ON CONFLICT contra un índice parcial. Adivinar la causa en un mensaje de
      // error no ahorra un diagnóstico: lo desvía.
      alert(`${tr("No se pudo traer de ESI")}:\n\n${e}`);
    } finally {
      setBusy(false);
    }
  };

  const nuevo = (): Facility => ({
    id: 0,
    structure_id: null,
    name: "",
    system_id: 0,
    type_id: null,
    has_mfg: true,
    has_lab: false,
    has_reactor: false,
    rigs: [],
    tax: null, // sin declarar, que es la verdad de una ficha recién creada
    tax_by_activity: "", // vacío = el impuesto general vale para todo
    services: "", // sin módulos declarados: las casillas se marcan a mano, como siempre
    eligible: true,
    source: "manual",
    notes: null,
  });

  const sysName = (id: number) => (sys ?? []).find((s) => s.id === id)?.n ?? `#${id}`;

  return (
    <div className="fac-block">
      <div className="fac-head">
        {/* Replegable: «Traer de ESI» puede soltar decenas de estructuras de golpe (27 en la primera
         *  prueba real) y el registro sepultaba a la biblioteca de blueprints que va debajo. La
         *  cabecera sigue diciendo lo que importa aunque esté plegado: cuántas hay y cuántas usas. */}
        <button
          className="fac-fold"
          onClick={() => {
            const v = !visible;
            setAbierto(v);
            localStorage.setItem(OPEN_KEY, v ? "1" : "0");
          }}
          aria-expanded={visible}
          disabled={!facs?.length}
          title={visible ? tr("Plegar la lista") : tr("Desplegar la lista")}
        >
          {facs?.length ? (visible ? "▾" : "▸") : "·"}
        </button>
        <strong>{tr("Mis instalaciones")}</strong>
        {facs?.length ? (
          <span className="fac-count muted small">
            {facs.length} {facs.length === 1 ? tr("ficha") : tr("fichas")} ·{" "}
            {enUso === 0 ? (
              <span className="fac-none">{tr("ninguna en uso")}</span>
            ) : (
              `${enUso} ${tr("en uso")}`
            )}
          </span>
        ) : null}
        <span className="muted small fac-why">
          {tr("EVE no enseña los rigs ni los servicios de una estructura si no tienes roles, y ESI tampoco. Así que lo pones tú: Koru saca los números del SDE a partir de lo que declares.")}
        </span>
        <button onClick={() => setEdit(nuevo())}>+ {tr("Nueva ficha")}</button>
        <button onClick={seed} disabled={busy} title={tr("Trae de ESI las estructuras que ya conocemos por tus assets, con su nombre, sistema y tipo. Los rigs y los servicios los tendrás que declarar tú: eso ESI no lo da.")}>
          {busy ? tr("Buscando…") : tr("Traer de ESI")}
        </button>
      </div>

      {facs === null ? (
        <p className="muted small">{tr("Cargando…")}</p>
      ) : facs.length === 0 ? (
        <p className="muted small">
          {tr("Aún no tienes fichas. Crea una a mano, o trae de ESI las que ya conocemos y complétalas.")}
        </p>
      ) : !visible ? (
        // Plegado no es esconder: si trajiste 27 de ESI y no has declarado ninguna, el BOM no las
        // usa y hay que decirlo aquí, que es donde se arregla.
        <p className="muted small">
          {enUso === 0
            ? tr("Están plegadas y ninguna está declarada todavía: el árbol BOM no usará ninguna hasta que completes al menos una.")
            : tr("Están plegadas. Despliega para editarlas.")}
        </p>
      ) : (
        <table className="fac-table small">
          <thead>
            <tr>
              <th title={tr("Solo las marcadas salen en el desplegable del árbol BOM.")}>{tr("Usar")}</th>
              <th>{tr("Nombre")}</th>
              <th>{tr("Sistema")}</th>
              <th>{tr("Tipo")}</th>
              <th title={tr("¿Tiene la planta de fabricación instalada? Sin ella no se puede fabricar ahí.")}>{tr("Fabrica")}</th>
              <th title={tr("¿Tiene laboratorio Standup (invención, copia, investigación ME/TE)?")}>{tr("Lab")}</th>
              <th title={tr("¿Tiene reactor Standup? Solo cabe en refinerías (Athanor / Tatara).")}>{tr("Reactor")}</th>
              <th>{tr("Rigs")}</th>
              <th>{tr("Impuesto")}</th>
              <th>{tr("Origen")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {facs.map((f) => {
              const k = f.type_id != null ? ir?.kinds?.[String(f.type_id)] : null;
              const puede = !k || !ir?.mfg_groups?.length || ir.mfg_groups.includes(k.g);
              const puedeReactF = (kk: typeof k) =>
                !kk || !ir?.reaction_groups?.length || ir.reaction_groups.includes(kk.g);
              return (
                <tr key={f.id} className={f.eligible ? "" : "fac-off"}>
                  <td>
                    <input
                      type="checkbox"
                      checked={f.eligible}
                      disabled={!puede}
                      onChange={() => toggle(f, "eligible")}
                    />
                  </td>
                  <td>{f.name}</td>
                  <td>{sysName(f.system_id)}</td>
                  <td>{k ? k.n.en : <span className="muted">{tr("sin declarar")}</span>}</td>
                  <td>
                    {!puede ? (
                      // No es opinión: el módulo de fabricación lleva en el SDE los grupos donde
                      // encaja, y este tipo no está entre ellos.
                      <span
                        className="muted"
                        title={tr("Este tipo de estructura no admite la planta de fabricación: lo dice el propio módulo en el SDE (solo encaja en Citadel, Engineering Complex y Refinery).")}
                      >
                        {tr("no puede")}
                      </span>
                    ) : (
                      <input
                        type="checkbox"
                        checked={f.has_mfg}
                        onChange={() => toggle(f, "has_mfg")}
                      />
                    )}
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={f.has_lab}
                      onChange={() => toggle(f, "has_lab")}
                    />
                  </td>
                  <td>
                    {!puedeReactF(k) ? (
                      // Igual que con la planta: los reactores Standup declaran en el SDE que solo
                      // encajan en refinerías. No es criterio nuestro.
                      <span
                        className="muted"
                        title={tr("Este tipo no admite reactor: solo encaja en refinerías (Athanor / Tatara), y lo dice su propio módulo en el SDE.")}
                      >
                        {tr("no puede")}
                      </span>
                    ) : (
                      <input
                        type="checkbox"
                        checked={f.has_reactor}
                        onChange={() => toggle(f, "has_reactor")}
                      />
                    )}
                  </td>
                  <td>{f.rigs.length || <span className="muted">—</span>}</td>
                  {/* `== null`, no falsy: un 0 declarado se enseña como «0 %», que es un dato. */}
                  <td>{f.tax == null ? <span className="muted">—</span> : `${f.tax}%`}</td>
                  <td className="muted">{f.source === "esi" ? "ESI" : tr("a mano")}</td>
                  <td>
                    <button className="bom-exp" onClick={() => setEdit(f)}>
                      {tr("Editar")}
                    </button>
                    <button
                      className="bom-exp"
                      onClick={() => confirm(tr("¿Borrar esta ficha?")) && remove(f.id)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {edit && ir && sys && (
        <FacilityWizard
          f={edit}
          ir={ir}
          sys={sys}
          onSave={save}
          onCancel={() => setEdit(null)}
        />
      )}
    </div>
  );
}

/** El asistente. Una sola pantalla con los pasos a la vista (no un wizard de «siguiente, siguiente»:
 *  el fabricante que ya sabe lo que hace no debería tener que pasar 5 pantallas para cambiar el
 *  impuesto). Cada campo dice de dónde sale su número. */
function FacilityWizard({
  f,
  ir,
  sys,
  onSave,
  onCancel,
}: {
  f: Facility;
  ir: IndustryRigs;
  sys: { id: number; n: string; s: number }[];
  onSave: (f: Facility) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<Facility>(f);
  const [q, setQ] = useState("");
  const [allRigs, setAllRigs] = useState(false);
  const [svc, setSvc] = useState<ServiceCat | null>(null);
  useEffect(() => {
    fetch("/industry_services.json").then((r) => r.json()).then(setSvc)
      .catch((e) => console.error("industry_services.json", e));
  }, []);
  const es = getLang() === "es";
  const set = (p: Partial<Facility>) => setD({ ...d, ...p });

  const sysHit = sys.find((s) => s.id === d.system_id) ?? null;
  const cands = q.trim().length >= 2
    ? sys.filter((s) => s.n.toLowerCase().startsWith(q.trim().toLowerCase())).slice(0, 8)
    : [];
  const sd = d.type_id != null ? ir.structures[String(d.type_id)] : null;
  const kind = d.type_id != null ? ir.kinds?.[String(d.type_id)] : null;
  const puede = !kind || !ir.mfg_groups?.length || ir.mfg_groups.includes(kind.g);
  // Reaccionar: los reactores Standup solo entran en refinerías, y eso lo dicen sus propios
  // `canFitShipGroup` en el SDE (reaction_groups = [1406]). No es una lista escrita a mano.
  const puedeReact =
    !kind || !ir.reaction_groups?.length || ir.reaction_groups.includes(kind.g);
  const band = sysHit ? secBand(sysHit.s) : null;
  const listos = d.name.trim() !== "" && d.system_id > 0;

  /* ---- Módulos de servicio (SDE): declarar lo que VES en el juego ---- */
  const mods: number[] = (() => {
    try {
      return d.services ? (JSON.parse(d.services) as number[]) : [];
    } catch {
      return []; // una ficha con el campo corrupto no debe reventar el editor
    }
  })();
  /** ¿Cabe este módulo en esta estructura? `t` (tipos concretos) manda sobre `g` (grupos): el
   *  Supercapital Shipyard solo entra en el Sotiyo aunque su grupo admita otros. */
  const cabe = (m: ServiceMod) =>
    !kind
      ? true
      : m.t.length
        ? d.type_id != null && m.t.includes(d.type_id)
        : m.g.includes(kind.g);
  /** Las tres casillas DERIVADAS de los módulos. `invention` y `research` caen las dos en
   *  `has_lab` porque la ficha aún no los distingue — el dato del SDE sí, y el día que la ficha lo
   *  haga no habrá que regenerar nada. */
  const derivar = (ids: number[]) => {
    const does = new Set(ids.flatMap((id) => svc?.mods[String(id)]?.does ?? []));
    return {
      has_mfg: does.has("mfg"),
      has_lab: does.has("invention") || does.has("research"),
      has_reactor: does.has("reactor"),
    };
  };
  const setMods = (ids: number[]) =>
    set({ services: JSON.stringify(ids), ...derivar(ids) });
  /** Lo declarado a mano que el juego NO permite. Solo se afirma lo que dice el SDE: los reactores
   *  únicamente caben en refinerías. **NO** se avisa de «una refinería no fabrica», porque SÍ
   *  fabrica: el Manufacturing Plant encaja en el grupo 1406. Nos equivocamos dos veces con eso el
   *  2026-08-11 antes de mirar el dato. */
  const imposible = d.has_reactor && !puedeReact ? tr("un reactor no cabe en este tipo de estructura") : null;

  // Tipos ofrecidos: los que admiten la planta de fabricación, según el propio módulo (SDE).
  const tipos = Object.entries(ir.kinds ?? {})
    .filter(([, k]) => !ir.mfg_groups?.length || ir.mfg_groups.includes(k.g))
    .sort((a, b) => a[1].n.en.localeCompare(b[1].n.en));

  return (
    <div className="fac-wiz">
      <div className="fac-wiz-head">
        <strong>{d.id ? tr("Editar ficha") : tr("Nueva ficha de instalación")}</strong>
        <button className="sys-close" onClick={onCancel}>
          ✕
        </button>
      </div>

      <p className="muted small">
        {tr("Rellena lo que sepas. Lo que dejes en blanco no se inventa: se calcula como si no existiera, así que la cuenta se queda corta y Koru te lo dice. Cuanto más completa, más se acerca — con la ficha entera cuadra al ítem con el juego.")}
      </p>

      <label className="fac-f">
        <span>1 · {tr("Nombre")}</span>
        <input
          value={d.name}
          placeholder={tr("p. ej. Sotiyo de C-J6MT (naves T2)")}
          onChange={(e) => set({ name: e.target.value })}
        />
        <em className="muted">{tr("para ti: el que te ayude a reconocerla")}</em>
      </label>

      <label className="fac-f">
        <span>2 · {tr("Sistema")}</span>
        <span>
          <input
            value={q}
            placeholder={sysHit ? sysHit.n : tr("escribe 2 letras…")}
            onChange={(e) => setQ(e.target.value)}
          />
          {cands.length > 0 && (
            <span className="fac-cands">
              {cands.map((s) => (
                <button
                  key={s.id}
                  className="bom-exp"
                  onClick={() => {
                    set({ system_id: s.id });
                    setQ("");
                  }}
                >
                  {s.n} ({s.s.toFixed(1)})
                </button>
              ))}
            </span>
          )}
        </span>
        <em className="muted">
          {sysHit
            ? `${sysHit.n} · ${tr("sec")} ${sysHit.s.toFixed(1)} → ${tr("de aquí salen el índice de coste (ESI, en vivo) y el multiplicador de los rigs")}`
            : tr("obligatorio: sin sistema no hay índice de coste ni banda de seguridad")}
        </em>
      </label>

      <label className="fac-f">
        <span>3 · {tr("Tipo")}</span>
        <select
          value={d.type_id ?? ""}
          onChange={(e) => set({ type_id: Number(e.target.value) || null, rigs: [] })}
        >
          <option value="">{tr("— no lo sé —")}</option>
          {tipos.map(([id, k]) => (
            <option key={id} value={id}>
              {(es ? k.n.es : k.n.en) + ` · ${k.gn}`}
            </option>
          ))}
        </select>
        <em className="muted">
          {sd
            ? `${tr("bonos del SDE")}: ${sd.mat != null ? `${tr("material")} ${((1 - sd.mat) * 100).toFixed(0)}%` : tr("sin bono de material")} · ${tr("coste")} ${(((1 - (sd.cost ?? 1)) * 100)).toFixed(0)}% · ${tr("tiempo")} ${(((1 - (sd.time ?? 1)) * 100)).toFixed(0)}%`
            : d.type_id
              ? tr("este tipo no tiene bonos de industria (una Citadel normal, p. ej.): se calcula sin ellos")
              : tr("si lo dejas en blanco calculamos SIN los bonos de estructura: te quedarás corto")}
        </em>
      </label>

      {/* ★ MÓDULOS DE SERVICIO (SDE 3464040). Declarar los módulos es declarar lo que VES en el
          juego; las tres casillas de abajo obligaban a traducir. De los módulos se DERIVAN las
          casillas, que siguen mandando en los cálculos — así una ficha vieja se comporta igual.
          Ver scripts/extract_service_modules.py. */}
      <div className="fac-f">
        <span>4 · {tr("Módulos instalados")}</span>
        <span className="fac-rigs">
          {mods.map((id) => {
            const m = svc?.mods[String(id)];
            return (
              <span key={id} className="fac-rig">
                <img src={typeIcon(id, 32)} alt="" width={16} height={16} />
                {m ? (es ? m.n.es : m.n.en) : `#${id}`}
                <button
                  className="bom-exp"
                  onClick={() => setMods(mods.filter((x) => x !== id))}
                >
                  ✕
                </button>
              </span>
            );
          })}
          <select
            value=""
            onChange={(e) => {
              const id = Number(e.target.value);
              if (id && !mods.includes(id)) setMods([...mods, id]);
            }}
          >
            <option value="">{tr("+ añadir módulo…")}</option>
            {Object.entries(svc?.mods ?? {})
              .filter(([id, m]) => cabe(m) && !mods.includes(Number(id)))
              .sort((a, b) => a[1].n.en.localeCompare(b[1].n.en))
              .map(([id, m]) => (
                <option key={id} value={id}>
                  {es ? m.n.es : m.n.en}
                </option>
              ))}
          </select>
        </span>
        <em className="muted">
          {mods.length > 0
            ? tr("las casillas de abajo se rellenan solas con lo que dan estos módulos")
            : tr("opcional: si los declaras, los servicios de abajo se marcan solos. Solo se ofrecen los que caben en este tipo de estructura, según el propio módulo en el SDE.")}
        </em>
      </div>

      <label className="fac-f">
        <span>5 · {tr("Servicios")}</span>
        <span>
          <input
            type="checkbox"
            checked={d.has_mfg}
            disabled={!puede}
            onChange={(e) => set({ has_mfg: e.target.checked })}
          />{" "}
          {tr("tiene planta de fabricación instalada")}
          {"  ·  "}
          <input
            type="checkbox"
            checked={d.has_lab}
            onChange={(e) => set({ has_lab: e.target.checked })}
          />{" "}
          {tr("tiene laboratorio (invención / copia / investigación)")}
          {"  ·  "}
          <input
            type="checkbox"
            checked={d.has_reactor}
            disabled={!puedeReact}
            onChange={(e) => set({ has_reactor: e.target.checked })}
          />{" "}
          {tr("tiene reactor (reacciones)")}
        </span>
        <em className={imposible ? "warn" : "muted"}>
          {imposible
            ? `⚠ ${imposible}`
            : !puede
            ? tr("este tipo NO admite la planta: lo dice el propio módulo en el SDE")
            : !puedeReact
              ? tr("el reactor solo cabe en refinerías (Athanor / Tatara): lo dice su propio módulo en el SDE")
              : tr("si no la tiene, no podrás fabricar ahí y no saldrá en el desplegable")}
        </em>
      </label>

      <div className="fac-f">
        <span>6 · {tr("Rigs")}</span>
        <span className="fac-rigs">
          {d.rigs.map((id) => {
            const r = ir.rigs[String(id)];
            return (
              <span key={id} className="fac-rig">
                {r ? (es ? r.n.es : r.n.en) : `#${id}`}
                <button
                  className="bom-exp"
                  onClick={() => set({ rigs: d.rigs.filter((x) => x !== id) })}
                >
                  ✕
                </button>
              </span>
            );
          })}
          {sd && d.rigs.length >= sd.slots && (
            <em className="muted">
              {tr("has llenado los")} {sd.slots} {tr("slots de esta estructura")}
            </em>
          )}
          <select
            value=""
            onChange={(e) => {
              const id = Number(e.target.value);
              if (id && !d.rigs.includes(id)) set({ rigs: [...d.rigs, id] });
            }}
          >
            <option value="">{tr("+ añadir rig…")}</option>
            {Object.entries(ir.rigs)
              // Rigs con ALGÚN bono real: material (fabricación) O tiempo/coste (los de
              // invención/copia/investigación dan coste-tiempo y mat 0 — antes quedaban invisibles
              // y una ficha de laboratorio no podía declararlos; lo cazó RoGiz7 con F2).
              .filter(
                ([, r]) =>
                  r.scopes.length > 0 &&
                  (r.mat !== 0 || r.time !== 0 || r.cost !== 0 || r.react != null),
              )
              // Por SERVICIO declarado (idea de RoGiz7): con bono de material = rig de fabricación →
              // solo si la ficha tiene planta; sin material (coste/tiempo puro) = rig de laboratorio
              // → solo si tiene lab. Los de REACCIÓN van por su cuenta: viven en otros atributos
              // (`react`) y solo caben en refinerías, así que solo salen si hay reactor declarado.
              .filter(([, r]) =>
                r.react != null ? d.has_reactor : r.mat !== 0 ? d.has_mfg : d.has_lab,
              )
              // Tamaño: rig y estructura comparten el atributo `rigSize` del SDE — el MISMO que usan
              // los rigs de nave, donde la regla es coincidencia EXACTA, y el devblog lo respalda
              // (al pasar de Raitaru a Sotiyo se cambian los rigs M por XL). Pero ninguna fuente
              // dura lo afirma para estructuras, así que dejamos la escotilla: si tu rig no sale,
              // la hipótesis rota es la nuestra, no tus datos.
              .filter(([, r]) => allRigs || !sd || r.size === sd.size)
              .sort((a, b) => a[1].n.en.localeCompare(b[1].n.en))
              .map(([id, r]) => (
                <option key={id} value={id}>
                  {RIG_SIZE[r.size] ?? "?"} · {es ? r.n.es : r.n.en}
                </option>
              ))}
          </select>
          <label className="bom-rig-all">
            <input
              type="checkbox"
              checked={allRigs}
              onChange={(e) => setAllRigs(e.target.checked)}
            />{" "}
            {tr("ver rigs de todos los tamaños")}
          </label>
        </span>
        <em className="muted">
          {d.rigs.length === 0
            ? tr("¿no los sabes? Déjalo vacío: calcularemos sin ellos y te lo diremos. Mejor quedarse corto que inventar un bono.")
            : band
              ? `${tr("en")} ${band === "null" ? "nullsec/WH" : band === "low" ? "lowsec" : "highsec"} ${tr("sus bonos base se multiplican por")} ${ir.rigs[String(d.rigs[0])]?.sec[band] ?? 1}`
              : tr("elige el sistema para saber cuánto rinden")}
        </em>
      </div>

      <label className="fac-f">
        <span>7 · {tr("Impuesto")}</span>
        <span>
          {/* Vacío = null («no lo sé»), no 0. `Number("") || 0` daba 0 y se tragaba la diferencia. */}
          <input
            type="number"
            step="0.1"
            min="0"
            placeholder={tr("sin declarar")}
            value={d.tax ?? ""}
            onChange={(e) =>
              set({ tax: e.target.value.trim() === "" ? null : Number(e.target.value) })
            }
          />{" "}
          %
        </span>
        <em className="muted">
          {tr("el que cobra el dueño de la estructura. Nadie más lo sabe: ni ESI ni el SDE.")}
        </em>
      </label>

      {/* Dónde mirarlo, con el desglose del juego delante. NO es adorno: ese tooltip tiene CUATRO
       *  porcentajes y tres son trampas — el índice del sistema, el bono de la estructura (el mismo
       *  que ya nos confundió: hay tres bonos que se llaman igual) y el recargo de la CCS, que es
       *  global y Koru ya aplica solo. Sin esto la gente teclea el 4 % y la ficha miente en silencio. */}
      <div className="fac-tax-help">
        <div className="fac-tax-title">
          {tr("¿Dónde lo veo? En el juego, al abrir el plano: «Coste total del trabajo» → pasa el ratón por encima.")}
        </div>
        <table className="fac-tax-eg">
          <tbody>
            <tr className="no">
              <td>{tr("Índice de coste en sistema")}</td>
              <td>9,95 % VEO</td>
              <td>{tr("no — lo saca Koru de ESI, en vivo")}</td>
            </tr>
            <tr className="no">
              <td>{tr("Bonificación por función de estructura")}</td>
              <td>−5,0 %</td>
              <td>{tr("no — sale del SDE por el tipo de estructura")}</td>
            </tr>
            <tr className="si">
              <td>
                <strong>{tr("Impuesto de centro")}</strong>
              </td>
              <td>
                <strong>+1,00 % VEO</strong>
              </td>
              <td>
                <strong>{tr("👈 ESTE. Aquí escribirías 1")}</strong>
              </td>
            </tr>
            <tr className="no">
              <td>{tr("Recargo de CCS")}</td>
              <td>+4,00 % VEO</td>
              <td>{tr("no — es global del juego, Koru ya lo aplica")}</td>
            </tr>
          </tbody>
        </table>
        <div className="fac-tax-foot muted">
          {tr("Escribe solo el número, sin el %. Si tu estructura no cobra nada, deja 0 — es un dato válido, no un hueco.")}
        </div>
      </div>

      {/* Impuesto POR ACTIVIDAD. No es un lujo: el juego lo configura así de verdad, y lo vimos en
       *  los tooltips de RoGiz7 — su Weaselior cobra 1 % inventando y 0 % en ME/TE, y su Tatara
       *  lista TRES impuestos de reacción por separado. Con un solo número acertábamos de casualidad.
       *  Todo vacío = hereda el general, que es como funcionaba hasta ahora: nadie tiene que tocar
       *  nada si su estructura cobra lo mismo para todo. */}
      <div className="fac-f">
        <span>8 · {tr("Impuesto por actividad")}</span>
        <span className="fac-tax-acts">
          {(() => {
            let cur: Record<string, number> = {};
            try {
              cur = d.tax_by_activity ? JSON.parse(d.tax_by_activity) : {};
            } catch {
              cur = {}; // JSON corrupto: empezamos limpios en vez de romper el asistente
            }
            const setAct = (k: string, v: string) => {
              const next = { ...cur };
              if (v.trim() === "") delete next[k];
              else next[k] = Number(v);
              // Sin nada declarado guardamos cadena vacía, no "{}": así `tax_by_activity` sigue
              // significando exactamente «no declarado» y el fallback al general es inequívoco.
              set({ tax_by_activity: Object.keys(next).length ? JSON.stringify(next) : "" });
            };
            return TAX_ACTS.map(({ k, label }) => (
              <label key={k} className="fac-tax-act">
                <span>{tr(label)}</span>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  placeholder={d.tax != null ? `${d.tax}` : tr("general")}
                  value={cur[k] ?? ""}
                  onChange={(e) => setAct(k, e.target.value)}
                />
                <span className="muted">%</span>
              </label>
            ));
          })()}
        </span>
        <em className="muted">
          {tr("Opcional. Lo que dejes en blanco usa el impuesto general de arriba (sale de fondo en el hueco). Rellena solo las actividades que tu estructura cobre distinto — las refinerías cobran las tres reacciones por separado.")}
        </em>
      </div>

      <div className="fac-wiz-foot">
        <span className="muted small">
          {tr("Ojo: esto es una foto de lo que TÚ sabes hoy. Si la estación cambia sus rigs o su impuesto, Koru no se entera — vuelve aquí y edítala.")}
        </span>
        <button onClick={onCancel}>{tr("Cancelar")}</button>
        <button
          disabled={!listos}
          title={listos ? "" : tr("hacen falta el nombre y el sistema")}
          onClick={() => onSave(d)}
        >
          {tr("Guardar ficha")}
        </button>
      </div>
    </div>
  );
}
