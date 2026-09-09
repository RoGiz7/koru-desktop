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
import { LootPasteModal } from "./lootPasteModal";
import { buildLootIndex, type LootIndex } from "./lootPaste";
import { loadShipRows, type ShipRow } from "./flotas";
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
  // (ver `RunEsc` abajo: la run enlazada vive en `activity_runs`, no aquí)
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
/** La run enlazada, tal y como la devuelve `run_list` — SOLO los campos que se pintan aquí.
 *
 *  A propósito no se copia el tipo entero de `ActivityRun`: esta pantalla no usa el clima, ni el
 *  tier, ni los participantes, y declararlos sería prometer que los enseña. */
type RunEsc = {
  id: number;
  loot_isk: number | null;
  started_at: string | null;
  ended_at: string | null;
};

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
 *  casos antes de escribirlo, incluidos los que deben devolver `null`.
 *
 *  ★ Y REESCRITA después, porque la primera versión FALLABA CALLANDO. Buscaba «número + unidad»
 *  sueltos por la cadena, así que en `17h20` el `20` no casaba con nada y se caía al suelo:
 *  contestaba «17 h 0 m» con toda la seguridad del mundo. Un error silencioso en el reloj de una
 *  escalación te hace llegar veinte minutos tarde a un sitio que caduca. Lo mismo con `24 h zzz`.
 *
 *  Ahora se recorre la cadena ENTERA y lo que no se entiende devuelve `null` — que en pantalla es
 *  una «?» roja. Y un número sin unidad hereda la siguiente unidad más pequeña, que es como se lee
 *  `17h20` en cualquier idioma. 24 casos, incluidos los que deben fallar. */
export function minutosDe(txt: string): number | null {
  const t = txt.trim().toLowerCase().replace(",", ".");
  if (!t) return null;
  // "17:20" y "17:20:15" — el otro modo en que la gente escribe un tiempo.
  const reloj = t.match(/^(\d{1,2})\s*:\s*(\d{1,2})(?:\s*:\s*(\d{1,2}))?$/);
  if (reloj) return Math.round(+reloj[1] * 60 + +reloj[2] + Number(reloj[3] ?? 0) / 60);
  const re = /\s*(\d+(?:\.\d+)?)\s*([hms])?/y; // pegajosa: obliga a consumirlo TODO
  let i = 0;
  let min = 0;
  let visto = false;
  let ultima: "h" | "m" | "s" | null = null;
  while (i < t.length) {
    re.lastIndex = i;
    const m = re.exec(t);
    if (!m) return null; // sobra algo que no es un número: mejor «?» que inventarse una cifra
    i = re.lastIndex;
    const n = parseFloat(m[1]);
    // La anotación es obligatoria: `u` sale de `ultima` y `ultima` sale de `u`, y sin ella TS no
    // puede cerrar el círculo (TS7022).
    const u: "h" | "m" | "s" | null = (m[2] as "h" | "m" | "s" | undefined)
      ?? (ultima === "h" ? "m" : ultima === "m" ? "s" : ultima === "s" ? null : "h");
    if (!u) return null; // «17h20m15s30»: después de los segundos no queda nada más pequeño
    if (u === "h") min += n * 60;
    else if (u === "m") min += n;
    else min += n / 60;
    ultima = u;
    visto = true;
  }
  return visto ? Math.round(min) : null;
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
  /** Las runs de escalación por id, para que el histórico pueda enseñar botín y duración. Solo se
   *  leen los cuatro campos que se pintan: si mañana la run crece, esto no se entera ni le importa. */
  const [runs, setRuns] = useState<Map<number, RunEsc>>(new Map());
  // Un tic por minuto para que el reloj corra solo. No hace falta más: el dato es a minutos.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(t);
  }, []);

  async function recargar() {
    try {
      const [v, h, r, rn] = await Promise.all([
        invoke<Escalacion[]>("escalaciones_vivas"),
        invoke<Escalacion[]>("escalaciones_historico", { limit: 100 }),
        invoke<Ranura[]>("escalaciones_ranuras"),
        // Las runs de escalación, del MISMO comando del que comen el abismo y los CRAB. Si esto
        // falla, el histórico se queda sin botín ni duración pero no se cae: `catch` → mapa vacío.
        invoke<RunEsc[]>("run_list", { activity: "escalacion" }).catch(() => [] as RunEsc[]),
      ]);
      setVivas(v);
      setHist(h);
      setRanuras(r);
      setRuns(new Map(rn.map((x) => [x.id, x])));
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
  /** ★★ DE QUIÉN ES LA ESCALACIÓN (pedido suyo, 2026-09-09).
   *
   *  La columna existía y `escalacion_abrir` ya la aceptaba, pero **el formulario nunca la pedía**:
   *  todas se apuntaban con `character_id = NULL`. En multibox eso importa —quien la sacó es quien
   *  la tiene en su diario— y además es lo que hereda la run, así que sin esto el P&L de una
   *  escalación no se podía atribuir a nadie.
   *
   *  ★ Se RECUERDA la última elección: rateas con el mismo personaje muchas veces seguidas, y
   *  volver a elegirlo en cada escalación sería exactamente el tipo de fricción que hace que la
   *  gente deje de apuntarlas — y una escalación no apuntada no existe.
   *
   *  Sigue siendo OPCIONAL: apuntarla rápido y sin dueño es mejor que no apuntarla. */
  const [chars, setChars] = useState<{ character_id: number; name: string }[]>([]);
  const [charId, setCharId] = useState<number | null>(() => {
    const v = Number(localStorage.getItem("koru.esc.char") ?? "");
    return Number.isFinite(v) && v > 0 ? v : null;
  });
  useEffect(() => {
    invoke<{ character_id: number; name: string }[]>("list_characters")
      .then(setChars)
      .catch(() => setChars([]));
  }, []);

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
        characterId: charId,
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

  /** ★★ LA COSTURA CON LAS RUNS (#23/#24, 2026-09-09).
   *
   *  El esquema lo dejó escrito hace días: la escalación es **el rato en que existe y aún NO la has
   *  hecho** —el reloj de 24 h es el producto— y cuando se hace, se enlaza con su `activity_runs`.
   *  Faltaba justo esto: nadie escribía `run_id`, así que el botín, las naves y el ISK/hora de una
   *  escalación no existían aunque todo el aparato llevara meses funcionando para CRAB y abismo.
   *
   *  ★ DOS CAMINOS, decisión suya, y el barato no es el pobre:
   *    · **«Voy»** arranca la run al salir → hay duración de verdad, y por tanto ISK/hora comparable
   *      con el resto de actividades.
   *    · **«Hecha» a secas** crea la run y la cierra en el mismo gesto → sin duración, pero con
   *      resultado, botín y P&L. Quien no quiera cronometrar no se queda sin registro.
   *
   *  ⚠️ Y si te matan, la escalación queda **`perdida`**, no `hecha`: la ventana se gastó igual, pero
   *  el histórico tiene que poder distinguirlo de un vistazo sin abrir la run. Decisión suya. */
  const [cerrando, setCerrando] = useState<{ id: number; muerto: boolean } | null>(null);
  /** ★ EL BOTÍN SE PEGA, NO SE TECLEA — corrección suya (2026-09-09).
   *
   *  Había puesto un campo para escribir el ISK a mano. Su respuesta: *«lo de botín isk no tenemos
   *  que poner, solo el copia pega del loot y que calcule Koru»*. Tiene razón y además es la regla
   *  de la casa: **no pedir una cifra que Koru sabe sacar**. El pegado del juego trae su columna de
   *  precio estimado, y ya existe el modal que lo parsea y lo valora para exploración y abismo.
   *  Reutilizarlo no es solo menos código: es que el botín de una escalación se cuente EXACTAMENTE
   *  igual que el de un abismo, o los ISK/hora no serían comparables entre secciones. */
  const [lootIndex, setLootIndex] = useState<LootIndex>(new Map());
  useEffect(() => {
    // Promesa cacheada en lootPaste.ts (son 2 MB): pedirla aquí no la descarga otra vez.
    void buildLootIndex().then(setLootIndex);
  }, []);

  /** ★★ CON QUÉ NAVE Y CON QUIÉN — se elige AL IR, decisión suya (2026-09-09).
   *
   *  *«que se pueda elegir qué personaje tiene la escalación, con qué naves las haces»*, y al ir
   *  porque es lo que de verdad llevas puesto: preguntarlo al volver es pedirle a alguien que
   *  recuerde con qué salió hace media hora.
   *
   *  ★ Todo reutilizado de abisales y CRAB, que era lo que él pidió: `loadShipRows` (ahora en
   *  flotas.tsx), el desplegable con **las que TIENES primero** —si un casco está en tu hangar es
   *  muchísimo más probable que sea el que vas a volar— y `run_chars_set` para el multibox, que
   *  **solo se escribe si de verdad va más de uno**: con uno, la run se queda como siempre y no se
   *  crea una fila hija que no aporta nada. */
  const [yendo, setYendo] = useState<{ id: number; nave: string; crew: number[] } | null>(null);
  const [ships, setShips] = useState<ShipRow[]>([]);
  const [ownedShips, setOwnedShips] = useState<Set<number>>(new Set());
  useEffect(() => {
    void loadShipRows().then(setShips);
  }, []);
  useEffect(() => {
    if (ships.length === 0) return;
    // Los cascos que tienes, para ordenarlos delante. Si falla, el desplegable sigue completo: es
    // una ayuda para elegir, no un filtro — nunca esconde una nave por no verla en tus assets.
    invoke<{ type_id: number }[]>("get_assets_detail_global")
      .then((rows) => {
        const ids = new Set(ships.map((s) => s.i));
        setOwnedShips(new Set(rows.map((r) => r.type_id).filter((t) => ids.has(t))));
      })
      .catch(() => setOwnedShips(new Set()));
  }, [ships]);

  async function voy(e: Escalacion) {
    const q = (yendo?.nave ?? "").trim().toLowerCase();
    const nave = q ? (ships.find((s) => s.n.toLowerCase() === q) ?? null) : null;
    try {
      // El sistema y el título NO se pasan: los sabe la propia escalación. Pedírselos a la pantalla
      // sería abrir la puerta a que la run diga un sistema y la escalación otro.
      const runId = await invoke<number>("escalacion_run_start", {
        id: e.id,
        shipTypeId: nave?.i ?? null,
        characterId: e.character_id,
        entryCost: null,
      });
      const todos = [...new Set([...(e.character_id != null ? [e.character_id] : []), ...(yendo?.crew ?? [])])];
      if (todos.length > 1) {
        await invoke("run_chars_set", {
          runId,
          chars: todos.map((cid) => ({
            character_id: cid,
            outcome: "ok",
            // La nave elegida es la de quien lleva la escalación; la de los demás se apunta luego
            // si hace falta, igual que en abisales.
            ship_type_id: cid === e.character_id ? (nave?.i ?? null) : null,
            lost_value: 0,
          })),
        });
      }
      setYendo(null);
      await recargar();
    } catch (err) {
      setError(String(err));
    }
  }

  async function cerrar(e: Escalacion, isk: number | null, nota: string) {
    const muerto = cerrando?.muerto ?? false;
    try {
      // Si no hubo «Voy», la run se crea AHORA y se cierra a continuación: así los dos caminos
      // acaban en el mismo sitio y el histórico no tiene dos formas de contar lo mismo.
      const runId = e.run_id ?? (await invoke<number>("escalacion_run_start", {
        id: e.id, shipTypeId: null, characterId: e.character_id, entryCost: null,
      }));
      await invoke("run_end", {
        id: runId,
        outcome: muerto ? "died" : "done",
        lootIsk: isk != null && Number.isFinite(isk) ? isk : null,
        lootNote: nota || null,
        shipLossIsk: null,
        note: null,
      });
      // El estado de la escalación va DESPUÉS y aparte: si esto fallara, la run queda cerrada y la
      // escalación sigue viva — visible y arreglable. Al revés sería una escalación cerrada con una
      // run abierta para siempre, que no se ve.
      await invoke("escalacion_estado", { id: e.id, estado: muerto ? "perdida" : "hecha" });
      setCerrando(null);
      await recargar();
    } catch (err) {
      setError(String(err));
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
            {/* La etiqueta pregunta lo que hay que TECLEAR, no lo que significa el campo.
                ★ Y la confirmación va DENTRO de la casilla, a la derecha, y **solo cuando dice algo
                distinto de lo que tecleaste**. Estaba debajo y en dos líneas: descuadraba el alto
                de la fila (lo vio él) y, escribiendo «24 h», contestar «= 24 h 0 m» no confirma
                nada — repite. Confirmar sin aportar es ruido con buenas intenciones. */}
            <label className="small muted">{tr("¿Cuánto le queda?")}</label>
            <div className="esc-conreloj">
              <input
                value={queda}
                onChange={(e) => setQueda(e.target.value)}
                placeholder="17 h 20 m"
              />
              {(() => {
                const min = minutosDe(queda);
                if (queda.trim() === "") return null;
                if (min == null) return <span className="esc-eco err">?</span>;
                const eco = restante(min);
                // Comparación laxa: «24 h» y «24 h 0 m» son lo mismo escrito distinto.
                const igual = queda.replace(/\s|0\s*m$/g, "").toLowerCase() === eco.replace(/\s|0\s*m$/g, "").toLowerCase();
                return igual ? null : <span className="esc-eco">{eco}</span>;
              })()}
            </div>
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
          {/* ★ De quién es. Opcional a propósito y con memoria: ver `charId`. Solo se enseña si
              hay más de un personaje — con uno solo, preguntarlo es preguntar por preguntar. */}
          {chars.length > 1 && (
            <div className="esc-campo">
              <label className="small muted">{tr("De quién es")}</label>
              <select
                value={charId ?? ""}
                onChange={(ev) => {
                  const v = ev.target.value ? Number(ev.target.value) : null;
                  setCharId(v);
                  if (v) localStorage.setItem("koru.esc.char", String(v));
                  else localStorage.removeItem("koru.esc.char");
                }}
              >
                <option value="">{tr("— sin asignar —")}</option>
                {chars.map((c) => (
                  <option key={c.character_id} value={c.character_id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
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
                <span className="muted small">
                  {e.titulo || tr("sin título")}
                  {/* De quién es. Se pinta solo si lo sabemos: un «sin asignar» en cada fila sería
                      reñir al usuario por no haber contestado algo opcional. */}
                  {e.character_id != null && chars.length > 1 && (
                    <> · {chars.find((c) => c.character_id === e.character_id)?.name ?? ""}</>
                  )}
                </span>
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
                    {/* «Voy» solo si no hay run: arranca el cronómetro y la enlaza. Quien no lo
                        use no pierde nada — al cerrar se crea la run igual, sin duración. */}
                    {e.run_id == null && yendo?.id === e.id ? (
                      <>
                        <input
                          className="esc-nave"
                          list="esc-ships"
                          placeholder={tr("nave (opcional)")}
                          value={yendo.nave}
                          autoFocus
                          onChange={(ev) => setYendo({ ...yendo, nave: ev.target.value })}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter") void voy(e);
                            if (ev.key === "Escape") setYendo(null);
                          }}
                        />
                        <button onClick={() => void voy(e)}>▶ {tr("Empezar")}</button>
                        <button onClick={() => setYendo(null)}>{tr("Cancelar")}</button>
                      </>
                    ) : e.run_id == null ? (
                      <button
                        title={tr("Arranca el cronómetro y registra la run")}
                        onClick={() => setYendo({ id: e.id, nave: "", crew: [] })}
                      >
                        ▶ {tr("Voy")}
                      </button>
                    ) : (
                      <span className="intel-count fleet" title={tr("Run en curso")}>⏱</span>
                    )}
                    <button onClick={() => setCerrando({ id: e.id, muerto: false })}>
                      {tr("Hecha")}
                    </button>
                    <button
                      title={tr("Te mataron dentro: la ventana se gastó igual")}
                      onClick={() => setCerrando({ id: e.id, muerto: true })}
                    >
                      ☠
                    </button>
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

      {/* Las naves, UNA vez para toda la sección: un `datalist` por fila serían 512 opciones × N
          filas en el DOM. Las que TIENES van primero — si un casco está en tu hangar es muchísimo
          más probable que sea el que vas a volar. El resto sigue estando, solo que después. */}
      <datalist id="esc-ships">
        {[...ships]
          .sort((a, b) => Number(ownedShips.has(b.i)) - Number(ownedShips.has(a.i)))
          .map((s) => (
            <option key={s.i} value={s.n}>
              {ownedShips.has(s.i) ? `✔ ${tr("la tienes")} · ${s.g}` : s.g}
            </option>
          ))}
      </datalist>

      {/* ★ EL MISMO modal que exploración y abismo, no uno parecido. `siteCount={1}` porque una
          escalación se cierra sola: no hay reparto que hacer. Y el botín sigue siendo OPCIONAL —
          confirmar sin pegar nada guarda la run con su resultado y su duración, que es lo que no se
          puede reconstruir después. */}
      <LootPasteModal
        open={cerrando != null}
        siteCount={1}
        index={lootIndex}
        title={cerrando?.muerto ? tr("Botín antes de morir") : tr("Botín de la escalación")}
        confirmLabel={cerrando?.muerto ? tr("Guardar (muerto)") : tr("Guardar")}
        onCancel={() => setCerrando(null)}
        onConfirm={(total, nota) => {
          const e = vivas?.find((x) => x.id === cerrando?.id);
          if (e) void cerrar(e, total, nota);
          else setCerrando(null);
        }}
      />

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
                  <td className={e.estado === "caducada" || e.estado === "perdida" ? "kpi-neg" : ""}>
                    {tr(e.estado)}
                  </td>
                  {/* ★ Lo que sacaste y lo que tardaste. Sin esto la run se guardaba y NO se veía
                      en ninguna parte: el dato existía y la pantalla decía que no había pasado
                      nada. Sale de `run_list('escalacion')`, el mismo sitio del que come el
                      abismo — no hay una segunda fuente para lo mismo. */}
                  <td style={{ textAlign: "right" }} className={runs.get(e.run_id ?? -1)?.loot_isk ? "kpi-pos" : "muted"}>
                    {(() => {
                      const r = e.run_id != null ? runs.get(e.run_id) : undefined;
                      return r?.loot_isk ? `${fmtSp(Math.round(r.loot_isk / 1e6))} M` : "";
                    })()}
                  </td>
                  <td className="muted" style={{ textAlign: "right" }}>
                    {(() => {
                      const r = e.run_id != null ? runs.get(e.run_id) : undefined;
                      if (!r?.started_at || !r.ended_at) return "";
                      const min = Math.round(
                        (Date.parse(r.ended_at) - Date.parse(r.started_at)) / 60000,
                      );
                      // Una run cerrada en el mismo gesto («Hecha» sin «Voy») dura ~0: no se pinta
                      // un «0 min» que se leería como que la hiciste en cero, sino nada.
                      return min >= 1 ? `${min} min` : "";
                    })()}
                  </td>
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
