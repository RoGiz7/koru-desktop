// Transporte → «Tus naves». La primera pieza visible del pilar logístico (T2).
//
// Contesta la pregunta que hoy no tiene respuesta en ningún sitio: **cuánto mueve DE VERDAD cada
// nave que tienes**. El juego te lo dice de la que estás pilotando; de las otras ocho que tienes
// repartidas por New Eden, no.
//
// EL RESOLVEDOR DE BODEGA vive aquí y en un solo sitio a propósito (ver SPEC_TRANSPORTE.md §2.1).
// Fuentes en ORDEN DE CONFIANZA: declarado por ti › tu nave real (assets + skills) › base del SDE.
// Hoy están implementadas las dos últimas; cuando entren los expansores y los rigs se toca esta
// función y nadie más se entera.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { fmtSp, typeIcon } from "./format";

type ShipModule = { type_id: number; slot: string; quantity: number; assembled: boolean };

/** Los dos volúmenes de cada tipo. `packed` es el de transportarlo (el de siempre); `asm` solo
 *  existe donde difiere, que son 685 tipos —casi todos naves—. */
type Volumenes = { packed: Record<string, number>; asm: Record<string, number> };

/** m³ que ocupa una pila. Un ítem MONTADO ocupa su volumen real; empaquetado, el reempaquetado.
 *  Devuelve `null` si no sabemos el volumen de ese tipo — y eso se propaga a propósito: un total
 *  al que le faltan piezas y no lo dice es peor que no dar total. */
function m3De(m: ShipModule, v: Volumenes): number | null {
  const k = String(m.type_id);
  const base = m.assembled ? v.asm[k] ?? v.packed[k] : v.packed[k];
  return base == null ? null : base * m.quantity;
}

/** Suma de una lista, y si falta algún volumen lo dice. */
function usadoDe(mods: ShipModule[], v: Volumenes): { m3: number; faltan: number } {
  let m3 = 0;
  let faltan = 0;
  for (const m of mods) {
    const x = m3De(m, v);
    if (x == null) faltan++;
    else m3 += x;
  }
  return { m3, faltan };
}

/** «1.960,3/11.500,0» — el formato con el que el juego enseña las bodegas. Un decimal, como allí. */
const fmtM3 = (n: number) =>
  n.toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
type MyShip = {
  item_id: number;
  type_id: number;
  type_name: string | null;
  character_id: number;
  character: string;
  system_id: number;
  system_name: string | null;
  location_name: string;
  assembled: boolean;
  modules: ShipModule[];
};

/** Una entrada de `ship_cargo.json`: bodega base, bodegas especializadas y bonus por skill. */
type CargoBonus = { skill: number | null; pct: number; target: string };
type CargoEntry = { cargo?: number; holds?: Record<string, number>; bonuses?: CargoBonus[] };

/** Los grupos cuyo oficio es MOVER cosas. Con nueve personajes salen ~370 cascos y un Atron en una
 *  sección de transporte es ruido, así que este filtro va PUESTO de fábrica — pero se puede quitar,
 *  porque a veces mueves algo en lo que tengas a mano.
 *
 *  Sale del grupo del SDE (`ships.json`), no de una lista de nombres a mano: si Fenris saca un carguero
 *  nuevo, entra solo. */
const GRUPOS_CARGA = new Set([
  "Freighter",
  "Jump Freighter",
  "Capital Industrial Ship",
  "Industrial Command Ship",
  "Deep Space Transport",
  "Blockade Runner",
  "Hauler",
  "Mining Barge",
  "Exhumer",
  "Expedition Frigate",
]);

/** A qué compartimento pertenece un `location_flag` de ESI.
 *
 *  Un Rorqual lleno devuelve ~150 ítems en una sola lista, y verlos juntos no dice nada: mezcla el
 *  fiteo con 92.000 unidades de mineral y con los drones. Son cosas distintas y se cargan distinto.
 *
 *  Lo que NO se reconoce se queda con su flag crudo como pestaña propia, en vez de caer en un cajón
 *  «otros»: un flag desconocido es algo que aprender, y esconderlo lo convertiría en un misterio. */
function compartimento(flag: string): string {
  if (/^(HiSlot|MedSlot|LoSlot|RigSlot|SubSystemSlot|ServiceSlot)/.test(flag)) return "Fiteo";
  if (flag === "Cargo") return "Bodega";
  if (flag === "DroneBay") return "Drones";
  if (flag === "FleetHangar") return "Hangar de flota";
  if (flag === "ShipHangar") return "Hangar de naves";
  if (flag === "FighterBay" || /^FighterTube/.test(flag)) return "Cazas";
  if (flag === "SpecializedFuelBay") return "Combustible";
  const esp = /^Specialized(.*)(?:Hold|Bay)$/.exec(flag);
  if (esp) {
    // Nombre en cristiano de las bodegas especializadas conocidas. Sin esto salían a medias en
    // inglés («Bodega de planetary commodities»), que es peor que no traducir nada.
    const conocidas: Record<string, string> = {
      Ore: "mineral",
      Mineral: "mineral",
      Asteroid: "asteroides",
      Ice: "hielo",
      Gas: "gas",
      Salvage: "salvage",
      Ammo: "munición",
      PlanetaryCommodities: "planetaria",
      CommandCenter: "centros de mando",
      Ship: "naves",
      SmallShip: "naves pequeñas",
      MediumShip: "naves medianas",
      LargeShip: "naves grandes",
      IndustrialShip: "industriales",
      Subsystem: "subsistemas",
      Booster: "boosters",
      Material: "materiales",
      Infrastructure: "infraestructura",
      ColonyResources: "recursos de colonia",
    };
    const clave = esp[1];
    const nombre =
      conocidas[clave] ?? clave.replace(/([A-Z])/g, " $1").trim().toLowerCase();
    return `Bodega de ${nombre}`;
  }
  return flag || "Sin ubicación";
}

/** Nombre legible de cada bodega especializada. La general no lleva etiqueta: es «la bodega». */
const BODEGA: Record<string, string> = {
  mining: "mineral",
  mineral: "mineral",
  gas: "gas",
  ice: "hielo",
  planetary: "planetaria",
  colony: "infraestructura",
  salvage: "salvage",
  ship: "naves",
  industrial: "industriales",
  commandcenter: "centros de mando",
  asteroid: "asteroides",
  colony_resources: "recursos",
};

/** m³ efectivos por bodega = base × (1 + pct/100 × nivel de la skill).
 *
 *  `skill: null` = bonus de ROL: se aplica siempre y entero, no depende de nadie.
 *  Un bonus cuya bodega no existe en esta nave se ignora en vez de crearla de la nada. */
function resolverBodegas(
  entry: CargoEntry | undefined,
  niveles: Record<number, number>,
): Record<string, { base: number; efectivo: number }> {
  if (!entry) return {};
  const out: Record<string, { base: number; efectivo: number }> = {};
  if (entry.cargo) out.cargo = { base: entry.cargo, efectivo: entry.cargo };
  for (const [k, v] of Object.entries(entry.holds ?? {})) out[k] = { base: v, efectivo: v };
  for (const b of entry.bonuses ?? []) {
    const destino = out[b.target];
    if (!destino) continue;
    const nivel = b.skill == null ? 5 : niveles[b.skill] ?? 0;
    destino.efectivo *= 1 + (b.pct / 100) * nivel;
  }
  return out;
}

/** Qué bodega corresponde a cada compartimento, para poder decir «usado/total».
 *  El fiteo no cuenta: los módulos van en slots y no gastan bodega. */
const COMPARTIMENTO_A_BODEGA: Record<string, string> = {
  Bodega: "cargo",
  "Bodega de mineral": "mining",
  "Bodega de asteroides": "asteroid",
  "Bodega de hielo": "ice",
  "Bodega de gas": "gas",
  "Bodega de planetaria": "planetary",
  "Bodega de infraestructura": "colony",
  "Bodega de recursos de colonia": "colony",
  "Bodega de centros de mando": "commandcenter",
  "Bodega de salvage": "salvage",
  "Bodega de naves": "ship",
  "Bodega de industriales": "industrial",
  Drones: "drone",
};

/** Lo que hay dentro de una nave, repartido por compartimentos y en pestañas.
 *
 *  Pestañas y no todo seguido porque un Rorqual cargado son ~150 ítems: junto es una mancha, y la
 *  pregunta que se hace uno («¿qué llevo montado?» / «¿qué mineral tengo dentro?») siempre es de
 *  UN compartimento. El contador va en la propia pestaña para no tener que abrirlas a ciegas.
 *
 *  El «Fiteo» manda de primero cuando existe: es lo que define a la nave. Si no, la pestaña con
 *  más cosas. */
function Compartimentos({
  modules,
  vols,
  bodegas,
}: {
  modules: ShipModule[];
  vols: Volumenes;
  bodegas: Record<string, { base: number; efectivo: number }>;
}) {
  const grupos = useMemo(() => {
    const m = new Map<string, ShipModule[]>();
    for (const x of modules) {
      const k = compartimento(x.slot);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(x);
    }
    return [...m.entries()].sort((a, b) => {
      if (a[0] === "Fiteo") return -1;
      if (b[0] === "Fiteo") return 1;
      return b[1].length - a[1].length;
    });
  }, [modules]);

  const [activa, setActiva] = useState(grupos[0]?.[0] ?? "");
  const actual = grupos.find(([k]) => k === activa) ?? grupos[0];
  if (!actual) return null;

  return (
    <div>
      {grupos.length > 1 && (
        <div className="nave-tabs" onClick={(e) => e.stopPropagation()}>
          {grupos.map(([k, v]) => (
            <button
              key={k}
              className={`nave-tab ${k === actual[0] ? "on" : ""}`}
              onClick={() => setActiva(k)}
            >
              {tr(k)} <span className="muted">{fmtSp(v.length)}</span>
            </button>
          ))}
        </div>
      )}
      {/* «usado/total», como lo enseña el juego. Solo cuando sabemos la capacidad de ESA bodega:
          en el fiteo no tiene sentido (los módulos van en slots) y en un hangar de flota no
          tenemos el dato. Si a algún tipo le falta el volumen se dice, en vez de dar un total
          incompleto que parece exacto. */}
      {(() => {
        const cap = bodegas[COMPARTIMENTO_A_BODEGA[actual[0]] ?? ""]?.efectivo;
        const { m3, faltan } = usadoDe(actual[1], vols);
        if (!cap && m3 === 0) return null;
        return (
          <div className="nave-uso">
            <b>{fmtM3(m3)}</b>
            {cap ? `/${fmtM3(cap)}` : ""} m³
            {cap ? (
              <span className="muted small">
                {" "}
                · {fmtM3(Math.max(0, cap - m3))} {tr("libres")}
              </span>
            ) : null}
            {faltan > 0 && (
              <span className="muted small" title={tr("El SDE no publica el volumen de estos tipos")}>
                {" "}
                · {tr("faltan")} {faltan}
              </span>
            )}
          </div>
        );
      })()}
      {/* Con scroll y alto tope: la lista completa sigue estando, pero una nave llena no puede
          estirar la tarjeta hasta empujar a las demás fuera de la pantalla. */}
      <div className="nave-mods">
        {actual[1].map((m, i) => (
          <span key={`${m.type_id}-${i}`} className="nave-mod" title={m.slot}>
            <img src={typeIcon(m.type_id, 32)} alt="" loading="lazy" />
            {m.quantity > 1 && <i>×{fmtSp(m.quantity)}</i>}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Ficha de una nave, en ventana propia.
 *
 *  En la tarjeta el detalle no cabía: un Rorqual cargado empujaba la rejilla entera y las pestañas
 *  se apelotonaban en tres filas. Aquí hay sitio y encima se ve la nave en grande.
 *
 *  Va por PORTAL a `<body>` y no dentro de la sección: si no, quedaría preso del contexto de
 *  apilamiento del panel (el fix de los modales de la v0.39.0). `z-index` 800 = por debajo del
 *  aviso de intel, que manda sobre cualquier ventana si hay hostiles en local. */
function FichaNave({
  ship,
  bodegas,
  vols,
  onClose,
}: {
  ship: MyShip;
  bodegas: Record<string, { base: number; efectivo: number }>;
  vols: Volumenes;
  onClose: () => void;
}) {
  // Escape cierra. Un modal del que solo se sale con el ratón es un modal que atrapa.
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return createPortal(
    // El clic en el fondo cierra; dentro de la ficha NO, o se cerraría al pinchar una pestaña.
    <div className="modal-backdrop" onClick={onClose}>
      <div className="nave-modal" onClick={(e) => e.stopPropagation()}>
        <div className="loot-modal-head">
          <div className="nave-modal-tit">
            <img
              className="nave-modal-render"
              src={`https://images.evetech.net/types/${ship.type_id}/render?size=128`}
              alt=""
              loading="lazy"
            />
            <div>
              <div className="nave-nombre">{ship.type_name ?? `#${ship.type_id}`}</div>
              <div className="muted small">
                {ship.character} · {ship.system_name ?? tr("sistema desconocido")}
                {ship.location_name ? ` · ${ship.location_name}` : ""}
              </div>
              {!ship.assembled && (
                <span className="nave-badge">{tr("empaquetada")}</span>
              )}
            </div>
          </div>
          <button className="loot-modal-x" onClick={onClose} title={tr("Cerrar")}>
            ✕
          </button>
        </div>

        <div className="nave-bodegas">
          {Object.entries(bodegas).map(([k, v]) => (
            <span key={k} className="nave-bodega">
              {k === "cargo" ? tr("bodega") : BODEGA[k] ?? k}:{" "}
              <b>{fmtSp(Math.round(v.efectivo))}</b> m³
              {v.efectivo > v.base && (
                <span className="muted"> ({fmtSp(Math.round(v.base))} {tr("de base")})</span>
              )}
            </span>
          ))}
        </div>

        {ship.modules.length === 0 ? (
          <div className="muted small">{tr("Sin nada montado ni en la bodega.")}</div>
        ) : (
          <Compartimentos modules={ship.modules} vols={vols} bodegas={bodegas} />
        )}
      </div>
    </div>,
    document.body,
  );
}

export function NavesView({ subject }: { subject: number | "global" }) {
  const [ships, setShips] = useState<MyShip[] | null>(null);
  const [cargo, setCargo] = useState<Record<string, CargoEntry>>({});
  const [niveles, setNiveles] = useState<Record<number, Record<number, number>>>({});
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<number | null>(null);
  /** typeID → grupo del SDE, para el filtro «solo las de carga». */
  const [grupos, setGrupos] = useState<Record<number, string>>({});
  const [vols, setVols] = useState<Volumenes>({ packed: {}, asm: {} });
  const [soloCarga, setSoloCarga] = useState(true);
  const [ocultarEmpaquetadas, setOcultarEmpaquetadas] = useState(false);
  const [sistema, setSistema] = useState<string>("");
  const [busca, setBusca] = useState("");
  /** Grupo de nave del SDE elegido. `""` = todas. */
  const [grupo, setGrupo] = useState("");

  useEffect(() => {
    fetch("/ship_cargo.json")
      .then((r) => r.json())
      .then(setCargo)
      .catch(() => setCargo({}));
    fetch("/ships.json")
      .then((r) => r.json())
      .then((rows: { i: number; g: string }[]) =>
        setGrupos(Object.fromEntries(rows.map((r) => [r.i, r.g]))),
      )
      .catch(() => setGrupos({}));
    // Los dos volúmenes. Si alguno falla se sigue: la vista pierde el «usado/total» pero no se
    // rompe, que es peor.
    Promise.all([
      fetch("/type_volumes.json").then((r) => r.json()),
      fetch("/type_volumes_assembled.json").then((r) => r.json()),
    ])
      .then(([packed, asm]) => setVols({ packed, asm }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let vivo = true;
    invoke<MyShip[]>("get_my_ships")
      .then((v) => vivo && setShips(v))
      .catch((e) => vivo && setError(String(e)));
    return () => {
      vivo = false;
    };
  }, []);

  // Los niveles de skill se piden SOLO de las skills que alguna nave necesita, y de una vez para
  // todos los personajes. Pedirlas todas de cada uno serían nueve llamadas para usar tres números.
  useEffect(() => {
    const ids = new Set<number>();
    for (const e of Object.values(cargo)) {
      for (const b of e.bonuses ?? []) if (b.skill != null) ids.add(b.skill);
    }
    if (ids.size === 0) return;
    invoke<{ character_id: number; name: string; levels: Record<number, number> }[]>(
      "get_skill_levels_all",
      { ids: [...ids] },
    )
      .then((rows) =>
        setNiveles(Object.fromEntries(rows.map((r) => [r.character_id, r.levels]))),
      )
      .catch(() => {});
  }, [cargo]);

  /** m³ de la bodega MAYOR ya resuelta. Es el número por el que se ordena y el que se enseña:
   *  en una Epithal la general son 550 y la planetaria 67.500, así que ordenar por la general
   *  hundiría justo la nave más útil. */
  const mayorDe = useMemo(() => {
    return (s: MyShip) => {
      const b = resolverBodegas(cargo[String(s.type_id)], niveles[s.character_id] ?? {});
      let max = 0;
      for (const v of Object.values(b)) max = Math.max(max, v.efectivo);
      return max;
    };
  }, [cargo, niveles]);

  /** Todas las que pasan el filtro de personaje: la base para poblar el desplegable de sistemas. */
  const delPersonaje = useMemo(() => {
    const v = ships ?? [];
    return subject === "global" ? v : v.filter((s) => s.character_id === subject);
  }, [ships, subject]);

  const sistemas = useMemo(() => {
    const set = new Set<string>();
    for (const s of delPersonaje) if (s.system_name) set.add(s.system_name);
    return [...set].sort();
  }, [delPersonaje]);

  /** Lo que queda tras TODO menos el grupo: es el conjunto del que se sacan las pestañas, para que
   *  los contadores digan lo que hay de verdad al pulsarlas y no se queden desfasados. */
  const antesDeGrupo = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return delPersonaje
      .filter((s) => !soloCarga || GRUPOS_CARGA.has(grupos[s.type_id] ?? ""))
      .filter((s) => !ocultarEmpaquetadas || s.assembled)
      .filter((s) => !sistema || s.system_name === sistema)
      .filter((s) => !q || (s.type_name ?? "").toLowerCase().includes(q));
  }, [delPersonaje, soloCarga, ocultarEmpaquetadas, sistema, busca, grupos]);

  /** Pestañas por grupo del SDE, ordenadas por lo que MÁS mueve el grupo. Un carguero antes que
   *  una barcaza minera no es alfabético, es útil: en transporte manda el tamaño. */
  const pestañas = useMemo(() => {
    const m = new Map<string, { n: number; max: number }>();
    for (const s of antesDeGrupo) {
      const g = grupos[s.type_id] ?? "?";
      const e = m.get(g) ?? { n: 0, max: 0 };
      e.n += 1;
      e.max = Math.max(e.max, mayorDe(s));
      m.set(g, e);
    }
    return [...m.entries()].sort((a, b) => b[1].max - a[1].max);
  }, [antesDeGrupo, grupos, mayorDe]);

  const filtradas = useMemo(() => {
    return antesDeGrupo
      .filter((s) => !grupo || (grupos[s.type_id] ?? "?") === grupo)
      // Por capacidad, de mayor a menor: en una sección de transporte, lo primero que quieres
      // saber es qué es lo más grande que tienes y dónde está. Las empaquetadas van detrás
      // aunque sean enormes, porque hoy no puedes usarlas.
      .slice()
      .sort(
        (a, b) =>
          Number(b.assembled) - Number(a.assembled) || mayorDe(b) - mayorDe(a),
      );
  }, [antesDeGrupo, grupo, grupos, mayorDe]);

  // Si el grupo elegido desaparece al cambiar un filtro, se vuelve a «todas» solo. Quedarse en una
  // pestaña vacía haría pensar que no tienes naves.
  useEffect(() => {
    if (grupo && !pestañas.some(([g]) => g === grupo)) setGrupo("");
  }, [pestañas, grupo]);

  if (error) return <div className="error">{error}</div>;
  if (!ships) return <div className="muted">{tr("Cargando…")}</div>;

  const montadas = filtradas.filter((s) => s.assembled).length;
  const total = delPersonaje.length;
  // Se busca entre TODAS y no entre las filtradas: si cambias un filtro con la ficha abierta, la
  // ficha no tiene por qué cerrarse de golpe en la cara.
  const abiertaNave = (ships ?? []).find((s) => s.item_id === abierta) ?? null;

  return (
    <div className="naves">
      <div className="naves-filtros">
        <label className="intel-chk">
          <input
            type="checkbox"
            checked={soloCarga}
            onChange={(e) => setSoloCarga(e.target.checked)}
          />
          {tr("Solo las de carga")}
        </label>
        <label className="intel-chk">
          <input
            type="checkbox"
            checked={ocultarEmpaquetadas}
            onChange={(e) => setOcultarEmpaquetadas(e.target.checked)}
          />
          {tr("Ocultar empaquetadas")}
        </label>
        <select value={sistema} onChange={(e) => setSistema(e.target.value)}>
          <option value="">{tr("Todos los sistemas")}</option>
          {sistemas.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          type="search"
          placeholder={tr("Buscar nave…")}
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>

      {/* Pestañas por CATEGORÍA del juego. Con 52 cargueros repartidos, «enséñame solo los
          freighters» es la pregunta que se hace uno, y el nombre del grupo del SDE es el mismo que
          usa el juego — así que no hay nada que traducir ni que aprender. */}
      {pestañas.length > 1 && (
        <div className="nave-tabs">
          <button
            className={`nave-tab ${grupo === "" ? "on" : ""}`}
            onClick={() => setGrupo("")}
          >
            {tr("Todas")} <span className="muted">{fmtSp(antesDeGrupo.length)}</span>
          </button>
          {pestañas.map(([g, e]) => (
            <button
              key={g}
              className={`nave-tab ${grupo === g ? "on" : ""}`}
              onClick={() => setGrupo(g)}
              title={`${tr("La mayor mueve")} ${fmtSp(Math.round(e.max))} m³`}
            >
              {g} <span className="muted">{fmtSp(e.n)}</span>
            </button>
          ))}
        </div>
      )}

      <p className="muted small">
        {fmtSp(filtradas.length)} {tr("de")} {fmtSp(total)} {tr("naves")} · {fmtSp(montadas)}{" "}
        {tr("montadas")} · {fmtSp(filtradas.length - montadas)} {tr("empaquetadas")}
        {" — "}
        {tr("la capacidad es la base del juego más tus skills; expansores y rigs todavía no cuentan")}
      </p>

      {filtradas.length === 0 && (
        <div className="muted">
          {total === 0
            ? tr("No se ha encontrado ninguna nave en tus assets.")
            : tr("Ninguna nave pasa los filtros.")}
        </div>
      )}

      <div className="naves-grid">
        {filtradas.map((s) => {
          const bodegas = resolverBodegas(cargo[String(s.type_id)], niveles[s.character_id] ?? {});
          const principal =
            Object.entries(bodegas).sort((a, b) => b[1].efectivo - a[1].efectivo)[0] ?? null;
          return (
            <div
              key={s.item_id}
              className={`nave-card ${s.assembled ? "" : "nave-packed"}`}
              onClick={() => setAbierta(s.item_id)}
              title={tr("Ver la ficha de la nave")}
            >
              <img className="nave-render" src={typeIcon(s.type_id, 64)} alt="" loading="lazy" />
              <div className="nave-body">
                <div className="nave-top">
                  <span className="nave-nombre">{s.type_name ?? `#${s.type_id}`}</span>
                  {!s.assembled && (
                    <span
                      className="nave-badge"
                      title={tr("Empaquetada: no puede llevar nada hasta que la montes")}
                    >
                      {tr("empaquetada")}
                    </span>
                  )}
                </div>
                <div className="muted small">
                  {s.character} · {s.system_name ?? tr("sistema desconocido")}
                  {s.location_name ? ` · ${s.location_name}` : ""}
                </div>
                {/* La bodega MAYOR manda en la tarjeta: en una Epithal la general son 550 m³ y la
                    planetaria 67.500, así que enseñar la general sería enseñar lo irrelevante. */}
                {principal && (
                  <div className="nave-m3">
                    <b>{fmtSp(Math.round(principal[1].efectivo))} m³</b>
                    {principal[0] !== "cargo" && (
                      <span className="muted small"> {BODEGA[principal[0]] ?? principal[0]}</span>
                    )}
                    {principal[1].efectivo > principal[1].base && (
                      <span className="muted small" title={tr("Base del juego sin tus skills")}>
                        {" "}
                        ({fmtSp(Math.round(principal[1].base))} {tr("de base")})
                      </span>
                    )}
                  </div>
                )}
                {/* Pista de lo que hay dentro, sin abrir: un número basta para decidir si merece
                    la pena mirar. Vacía no dice nada y no lo pinta. */}
                {s.modules.length > 0 && (
                  <div className="muted small">
                    {fmtSp(s.modules.length)} {tr("cosas dentro")}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {abiertaNave && (
        <FichaNave
          ship={abiertaNave}
          bodegas={resolverBodegas(
            cargo[String(abiertaNave.type_id)],
            niveles[abiertaNave.character_id] ?? {},
          )}
          vols={vols}
          onClose={() => setAbierta(null)}
        />
      )}
    </div>
  );
}
