// PLAN DE ESTUDIOS — pega un skill plan del juego y Koru te dice cuánto te queda… y con CUÁL de
// tus personajes sale antes.
//
// ★ POR QUÉ EXISTE (idea de RoGiz7, 2026-08-26). El juego te dice cuánto tarda un plan EN EL
//   PERSONAJE QUE TIENES DELANTE. Con nueve pilotos, la pregunta de verdad es otra: «¿a cuál de
//   ellos le pongo esto?». Nadie la contesta con TUS datos, y Koru los tiene todos a la vez.
//
// ★ DE DÓNDE SALE CADA NÚMERO, que es lo que hace que se pueda confiar en él:
//   · SP para un nivel  = rango × 250 × 2^(2,5×(nivel−1)) — la fórmula del juego. El rango sale
//     de `public/skill_training.json` (extraído del SDE, 587 skills).
//   · SP que ya tienes  = `skillpoints_in_skill` de ESI. Una RESTA, no una estimación.
//   · Ritmo (SP/min)    = MEDIDO de la cola de entrenamiento: el servidor dice cuántos SP faltan
//     para acabar lo que entrenas y cuándo acaba. Eso ya lleva dentro implantes y boosters, que
//     es justo lo que no se puede modelar (ESI ni siquiera expone los boosters).
//
// ★ LO QUE NO SE FINGE: un personaje que no está entrenando nada NO TIENE ritmo medible. Se dice
//   —«no está entrenando»— en vez de rellenarlo con una estimación por atributos que sería peor y
//   nadie podría distinguir. Misma regla que el hueco de la película: la ceguera se declara.
import { Fragment, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr, getLang } from "./i18n";
import { fmtSp } from "./format";
import { loadJson } from "./staticJson";

type SkillState = { skill_id: number; level: number; sp: number };
type CharSkillState = {
  character_id: number;
  character_name: string;
  total_sp: number;
  rate_sp_min: number | null;
  /** [carisma, inteligencia, memoria, percepción, voluntad] */
  attributes: [number, number, number, number, number] | null;
  training_skill_id: number | null;
  skills: SkillState[];
};

/** La foto de UN piloto frente a un plan guardado: dónde estaba el día que se guardó.
 *
 *  ★ NO es «lo que le queda». Lo que le queda se calcula SIEMPRE contra ESI en vivo, igual que
 *  antes de que existieran los planes guardados. Esto es solo el punto de partida contra el que
 *  se compara — el registro de dónde estabas, no una segunda verdad sobre lo que tienes. */
type PlanTarget = {
  character_id: number;
  based_at: string;
  sp_left: number;
  /** `null` = ese día no entrenaba nada. Por eso el avance se mide en SP y no en tiempo. */
  min_left: number | null;
  rate_sp_min: number | null;
  /** Marca «este plan se lo he puesto a él». No hace falta para medirle el avance. */
  assigned: boolean;
};
type PlanRow = {
  plan_id: number;
  name: string;
  /** El pegado CRUDO. Se reparsea al cargarlo: guardar las líneas parseadas petrificaría el parser. */
  body: string;
  created_at: string;
  updated_at: string;
  targets: PlanTarget[];
};

/** id de atributo del dogma → posición en el array que manda el backend. */
const POS_ATTR: Record<number, number> = { 164: 0, 165: 1, 166: 2, 167: 3, 168: 4 };

/** SP/min de UNA skill: primario + secundario/2, la fórmula del juego.
 *
 *  ⚠️ Cada skill entrena con SU par de atributos, así que usar un único ritmo para todo el plan es
 *  una simplificación — medida contra el juego con un plan real, se quedaba corta un 0,7 % por las
 *  skills de mando (van por carisma). Poco, pero puede no serlo con atributos desiguales. */
function ritmoDeSkill(attrs: CharSkillState["attributes"], p: number, s: number): number | null {
  if (!attrs) return null;
  const ip = POS_ATTR[p];
  const is = POS_ATTR[s];
  if (ip == null || is == null) return null;
  return attrs[ip] + attrs[is] / 2;
}
/** `public/skill_training.json`: { typeID: { r: rango, p: primario, s: secundario, g: grupo } } */
type SkillTraining = Record<string, { r: number; p: number; s: number; g: number }>;
/** `public/skill_groups.json`: los 24 grupos de skills, con su nombre TAL COMO LO DA EL SDE.
 *  No pasa por `i18n.ts` a propósito: los nombres localizados los manda el SDE, y escribirlos a
 *  mano es la vía segura para que acaben diciendo algo distinto que el juego. */
type SkillGroups = Record<string, { en: string; es: string }>;

/** Los niveles de skill en EVE se escriben en romanos, siempre. Un «4» a secas es de hoja de
 *  cálculo; un «IV» es del juego. */
const ROMANO = ["", "I", "II", "III", "IV", "V"];

/** SP acumulados necesarios para TENER un nivel. La fórmula del juego, contrastada contra los
 *  valores conocidos de una skill de rango 1 (250 · 1.414 · 8.000 · 45.255 · 256.000) y contra una
 *  skill real en pantalla (Signature Focusing V = 1.280.000 = rango 5 × 250 × 2^10). */
function spDeNivel(rango: number, nivel: number): number {
  return Math.round(rango * 250 * Math.pow(2, 2.5 * (nivel - 1)));
}

/** Una línea del plan: «Nombre N». El nivel es el ÚLTIMO token y eso es seguro por construcción:
 *  de las 587 skills del catálogo, ninguna acaba en dígito (comprobado, no supuesto). */
const RE_LINEA = /^(.*?)\s+([1-5])$/;

/** ★ EL JUEGO NO COPIA TEXTO PLANO (descubierto pegando de verdad, 2026-08-26).
 *
 *  Al copiar un plan desde EVE, cada nombre viene envuelto:
 *      <localized hint="Foco de la señal">Signature Focusing</localized> 2
 *  El CONTENIDO es el nombre en inglés (el del SDE) y el `hint` es el nombre en el idioma del
 *  cliente. O sea que el propio pegado trae la traducción de regalo.
 *
 *  Se aceptan las DOS formas a propósito: así pegado del juego y limpio (que es como queda si
 *  pasa por un editor o si alguien lo escribe a mano). Devuelve el nombre «bueno» y, si venía,
 *  el localizado — que sirve de plan B cuando el cliente no es inglés. */
function desenvuelve(linea: string): { texto: string; hint: string | null } {
  let hint: string | null = null;
  const texto = linea
    .replace(/<localized\s+hint="([^"]*)"\s*>([\s\S]*?)<\/localized>/gi, (_m, h, inner) => {
      if (!hint) hint = String(h);
      return String(inner);
    })
    // Cualquier otro marcado que el juego pudiera meter: fuera. Mismo criterio que cleanEveText.
    .replace(/<[^>]+>/g, "")
    .trim();
  return { texto, hint };
}

function duracion(min: number): string {
  if (!isFinite(min) || min <= 0) return "—";
  const d = Math.floor(min / 1440);
  const h = Math.floor((min - d * 1440) / 60);
  if (d >= 1) return `${d} d ${h} h`;
  const m = Math.round(min - h * 60);
  return `${h} h ${m} m`;
}

export function PlanEstudiosView() {
  const [texto, setTexto] = useState("");
  const [estados, setEstados] = useState<CharSkillState[] | null>(null);
  const [cat, setCat] = useState<SkillTraining>({});
  const [nombres, setNombres] = useState<Record<string, string>>({});
  /** Nombres LOCALIZADOS → typeID. Se carga solo si hace falta (ver el efecto de abajo). */
  const [esIdx, setEsIdx] = useState<Record<string, number>>({});
  const [err, setErr] = useState<string | null>(null);
  /** Personaje cuyo desglose está desplegado. Uno cada vez: la tabla ya es ancha. */
  const [abierto, setAbierto] = useState<number | null>(null);
  /** Los planes guardados. UNO por plan, no uno por personaje: el plan no se repite. */
  const [planes, setPlanes] = useState<PlanRow[]>([]);
  /** El plan cargado ahora mismo, si viene de la lista. `null` = pegado suelto, sin guardar. */
  const [planId, setPlanId] = useState<number | null>(null);
  const [nombrePlan, setNombrePlan] = useState("");
  const [grupos, setGrupos] = useState<SkillGroups>({});
  /** `true` = se ve la caja de texto. Un plan ya entendido se enseña como lista, no como pegote:
   *  el texto crudo es la ENTRADA, no la forma de leerlo. Se vuelve a él con un botón. */
  const [editando, setEditando] = useState(true);

  const recargarPlanes = () =>
    invoke<PlanRow[]>("skill_plan_list")
      .then(setPlanes)
      .catch((e) => setErr(String(e)));

  useEffect(() => {
    loadJson<SkillTraining>("/skill_training.json", {}).then(setCat);
    loadJson<Record<string, string>>("/skill_names.json", {}).then(setNombres);
    loadJson<SkillGroups>("/skill_groups.json", {}).then(setGrupos);
    invoke<CharSkillState[]>("get_skill_states")
      .then(setEstados)
      .catch((e) => setErr(String(e)));
    recargarPlanes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** El plan cargado, con sus fotos. */
  const planActual = useMemo(
    () => planes.find((p) => p.plan_id === planId) ?? null,
    [planes, planId],
  );

  /** Foto por personaje, para no buscar en el array en cada fila. */
  const fotos = useMemo(() => {
    const m = new Map<number, PlanTarget>();
    for (const t of planActual?.targets ?? []) m.set(t.character_id, t);
    return m;
  }, [planActual]);

  /** ⚠️ ¿El texto de la caja sigue siendo el del plan guardado?
   *
   *  Si lo has editado, las fotos siguen siendo verdad sobre lo que pedía el plan VIEJO, así que
   *  el avance deja de ser comparable. No se borra nada ni se recalcula a escondidas: se dice en
   *  pantalla y se ofrece guardar los cambios. Es el mismo error que ya nos costó una tarde
   *  persiguiendo un descuadre que era comparar dos versiones distintas del mismo plan. */
  const textoCambiado = planActual != null && planActual.body !== texto;

  /** nombre en minúsculas → typeID. Del catálogo del SDE, que es quien manda con los nombres. */
  const idPorNombre = useMemo(() => {
    const m = new Map<string, number>();
    for (const [id, n] of Object.entries(nombres)) m.set(n.trim().toLowerCase(), Number(id));
    return m;
  }, [nombres]);

  /** El plan pegado, ya reducido a «skill → nivel objetivo». Una skill puede aparecer una vez por
   *  escalón (el export del juego lista Hull Upgrades 1,2,3,4): manda el máximo. */
  const plan = useMemo(() => {
    const objetivo = new Map<number, number>();
    const desconocidas: string[] = [];
    let necesitaEs = false;
    for (const linea of texto.split("\n")) {
      const l = linea.trim();
      if (!l) continue;
      const { texto: limpia, hint } = desenvuelve(l);
      const m = RE_LINEA.exec(limpia);
      if (!m) {
        desconocidas.push(l);
        continue;
      }
      // 1) por el nombre del SDE (inglés) · 2) por el nombre localizado que trae el propio pegado.
      let id = idPorNombre.get(m[1].trim().toLowerCase());
      if (id == null && hint) {
        id = esIdx[hint.trim().toLowerCase()];
        if (id == null) necesitaEs = true; // aún no ha cargado el índice localizado
      }
      if (id == null) {
        desconocidas.push(l);
        continue;
      }
      const nivel = Number(m[2]);
      objetivo.set(id, Math.max(objetivo.get(id) ?? 0, nivel));
    }
    return { objetivo, desconocidas, necesitaEs };
  }, [texto, idPorNombre, esIdx]);

  // El índice de nombres localizados pesa ~900 KB y casi nunca hace falta: solo se pide si una
  // línea NO resolvió por su nombre inglés. Se paga cuando se necesita, no por si acaso.
  useEffect(() => {
    if (!plan.necesitaEs || Object.keys(esIdx).length > 0) return;
    loadJson<Record<string, number>>("/type_names_es.json", {}).then(setEsIdx);
  }, [plan.necesitaEs, esIdx]);

  /** Por personaje: SP que le faltan para el plan y cuánto tardaría a su ritmo real. */
  const filas = useMemo(() => {
    if (!estados || plan.objetivo.size === 0) return [];
    return estados
      .map((c) => {
        const mio = new Map(c.skills.map((s) => [s.skill_id, s]));

        // ★ CALIBRACIÓN. El modelo por atributos da el ritmo de CADA skill; el servidor nos da el
        // ritmo REAL de la que se entrena ahora. Dividiendo uno por otro sale un factor que recoge
        // lo que el modelo no ve —implantes y boosters— y se aplica al resto del plan.
        // Si no hay nada entrenando, no hay factor: se usa el modelo puro y se dice que es una
        // estimación. Nunca al revés: no se inventa un ritmo donde no hay medición.
        let factor = 1;
        let calibrado = false;
        if (c.rate_sp_min && c.training_skill_id != null) {
          const t = cat[String(c.training_skill_id)];
          const base = t ? ritmoDeSkill(c.attributes, t.p, t.s) : null;
          if (base && base > 0) {
            factor = c.rate_sp_min / base;
            calibrado = true;
          }
        }

        let faltan = 0;
        // SP que pide el plan ENTERO, contados desde cero. Es el denominador del «% conseguido».
        // Ojo con el techo: si ya tiene el nivel 5 y el plan pide el 3, lo que cuenta es lo que el
        // PLAN pide, no lo que él tiene — si no, el porcentaje se pasaría del 100 %.
        let totalSp = 0;
        let yaHechas = 0;
        let sinRango = 0;
        let minutos = 0; // suma de los tiempos POR SKILL, cada una a su ritmo
        // El DESGLOSE: qué skills concretas faltan y con cuántos SP. Existe para que el total sea
        // AUDITABLE — un número que no se puede comprobar contra el juego no se puede usar para
        // decidir a qué personaje le metes tres meses de estudio.
        const pendientes: {
          id: number;
          nombre: string;
          objetivo: number;
          nivelActual: number;
          rango: number;
          sp: number;
          ritmo: number | null;
        }[] = [];
        for (const [id, nivel] of plan.objetivo) {
          const t = cat[String(id)];
          if (!t) {
            sinRango++;
            continue;
          }
          const objetivoSp = spDeNivel(t.r, nivel);
          totalSp += objetivoSp;
          const actual = mio.get(id)?.sp ?? 0;
          const nivelActual = mio.get(id)?.level ?? 0;
          if (nivelActual >= nivel) yaHechas++;
          const falta = Math.max(0, objetivoSp - actual);
          faltan += falta;
          if (falta > 0) {
            // Cada skill con SU ritmo (su par de atributos) × el factor de calibración.
            const base = ritmoDeSkill(c.attributes, t.p, t.s);
            const ritmo = base ? base * factor : null;
            minutos += ritmo && ritmo > 0 ? falta / ritmo : Infinity;
            pendientes.push({
              id,
              nombre: nombres[String(id)] ?? `#${id}`,
              objetivo: nivel,
              nivelActual,
              rango: t.r,
              sp: falta,
              ritmo,
            });
          }
        }
        pendientes.sort((a, b) => b.sp - a.sp);
        return {
          id: c.character_id,
          nombre: c.character_name,
          faltan,
          totalSp,
          yaHechas,
          sinRango,
          pendientes,
          calibrado,
          // El ritmo que se ENSEÑA es el medio efectivo del plan: es el que explica el tiempo.
          ritmo: minutos > 0 && isFinite(minutos) ? faltan / minutos : c.rate_sp_min,
          min: isFinite(minutos) && minutos > 0 ? minutos : null,
        };
      })
      // Quien lo tenga hecho, primero; después por tiempo. Sin ritmo medible van al final: no se
      // les inventa un puesto en la carrera.
      .sort((a, b) => {
        if (a.faltan === 0 && b.faltan !== 0) return -1;
        if (b.faltan === 0 && a.faltan !== 0) return 1;
        if (a.min == null) return 1;
        if (b.min == null) return -1;
        return a.min - b.min;
      });
  }, [estados, plan, cat, nombres]);

  const totalPlan = plan.objetivo.size;

  /** ★ EL PLAN, LEGIBLE: agrupado por grupo de skill, con su icono y el nivel en romanos.
   *
   *  Esto NO depende de ningún personaje — es lo que el plan PIDE, desde cero. Por eso va arriba
   *  del todo, separado de la tabla de quién lo tiene más andado.
   *
   *  Los grupos se ordenan por SP, de más a menos: así la primera línea ya te dice de qué va el
   *  plan («esto es sobre todo Escudos»). Alfabético sería más predecible y no diría nada. */
  const vista = useMemo(() => {
    const porGrupo = new Map<
      number,
      { sp: number; skills: { id: number; nombre: string; nivel: number; sp: number }[] }
    >();
    for (const [id, nivel] of plan.objetivo) {
      const t = cat[String(id)];
      // Sin rango no se puede calcular el peso; se mete igual en su grupo con sp 0 para que la
      // skill NO desaparezca de la lista. Perderla en silencio sería peor que enseñarla sin peso.
      const g = t?.g ?? 0;
      const sp = t ? spDeNivel(t.r, nivel) : 0;
      const e = porGrupo.get(g) ?? { sp: 0, skills: [] };
      e.sp += sp;
      e.skills.push({ id, nombre: nombres[String(id)] ?? `#${id}`, nivel, sp });
      porGrupo.set(g, e);
    }
    const lang = getLang() === "en" ? "en" : "es";
    return [...porGrupo.entries()]
      .map(([g, e]) => ({
        g,
        nombre: grupos[String(g)]?.[lang] ?? tr("Otras"),
        sp: e.sp,
        // Dentro del grupo, lo más gordo primero: es lo que de verdad te va a costar.
        skills: e.skills.sort((a, b) => b.sp - a.sp || a.nombre.localeCompare(b.nombre)),
      }))
      .sort((a, b) => b.sp - a.sp);
  }, [plan.objetivo, cat, nombres, grupos]);

  const spPlan = useMemo(() => vista.reduce((s, g) => s + g.sp, 0), [vista]);

  /** La foto de HOY de cada personaje, tal y como se guarda. Sale de la misma `filas` que pinta la
   *  tabla: una sola fuente para lo que se ve y lo que se guarda — si divergieran, el avance de
   *  mañana no cuadraría con el número que hoy tienes delante. */
  const fotosDeHoy = () =>
    filas.map((f) => ({
      character_id: f.id,
      sp_left: f.faltan,
      min_left: f.min,
      rate_sp_min: f.ritmo ?? null,
    }));

  const guardar = async () => {
    const nombre = nombrePlan.trim();
    if (!nombre || filas.length === 0) return;
    try {
      const id = await invoke<number>("skill_plan_create", {
        name: nombre,
        body: texto,
        baselines: fotosDeHoy(),
      });
      await recargarPlanes();
      setPlanId(id);
    } catch (e) {
      setErr(String(e));
    }
  };

  /** Guarda el texto editado SOBRE el plan cargado, y vuelve a retratar a todos.
   *
   *  Re-retratar es obligado, no una comodidad: si el plan cambia y las fotos se quedan, el avance
   *  se estaría midiendo contra lo que pedía otro plan. */
  const guardarCambios = async () => {
    if (planId == null) return;
    try {
      await invoke("skill_plan_update", { planId, name: nombrePlan.trim() || "—", body: texto });
      for (const b of fotosDeHoy()) {
        await invoke("skill_plan_set_baseline", { planId, baseline: b });
      }
      await recargarPlanes();
    } catch (e) {
      setErr(String(e));
    }
  };

  const cargar = (p: PlanRow) => {
    setTexto(p.body);
    setPlanId(p.plan_id);
    setNombrePlan(p.name);
    setAbierto(null);
    // Un plan que se abre de la lista ya está entendido: se enseña, no se edita.
    setEditando(false);
  };

  const borrar = async (p: PlanRow) => {
    try {
      await invoke("skill_plan_delete", { planId: p.plan_id });
      if (planId === p.plan_id) {
        setPlanId(null);
        setNombrePlan("");
      }
      await recargarPlanes();
    } catch (e) {
      setErr(String(e));
    }
  };

  /** Pone el contador de UN piloto a cero: «lo suyo empieza hoy». También es lo que se usa con un
   *  personaje que no existía cuando se guardó el plan y por eso no tiene referencia. */
  const rebasar = async (charId: number) => {
    if (planId == null) return;
    const b = fotosDeHoy().find((x) => x.character_id === charId);
    if (!b) return;
    try {
      await invoke("skill_plan_set_baseline", { planId, baseline: b });
      await recargarPlanes();
    } catch (e) {
      setErr(String(e));
    }
  };

  /** Marca/desmarca «se lo he puesto a él». Si no tenía foto, se le hace primero: el backend
   *  devuelve `false` en vez de tragárselo, así que aquí hay algo que hacer y no un silencio. */
  const alternarAsignado = async (charId: number, ahora: boolean) => {
    if (planId == null) return;
    try {
      const ok = await invoke<boolean>("skill_plan_set_assigned", {
        planId,
        characterId: charId,
        assigned: !ahora,
      });
      if (!ok) {
        await rebasar(charId);
        await invoke("skill_plan_set_assigned", {
          planId,
          characterId: charId,
          assigned: !ahora,
        });
      }
      await recargarPlanes();
    } catch (e) {
      setErr(String(e));
    }
  };

  return (
    <>
      <p className="muted small">
        {tr(
          "Pega aquí un plan de habilidades exportado del juego (una línea por nivel, como lo copia EVE). Koru te dice lo que te falta y con cuál de tus personajes sale antes.",
        )}
      </p>
      {planes.length > 0 && (
        <div className="plan-guardados">
          {planes.map((p) => (
            <span
              key={p.plan_id}
              className={"plan-chip" + (p.plan_id === planId ? " plan-chip-on" : "")}
            >
              <button className="plan-chip-cargar" onClick={() => cargar(p)} title={tr("Abrir este plan")}>
                {p.name}
                {/* Cuántos pilotos lo llevan puesto. Los que solo tienen foto NO cuentan aquí:
                    tener medido el avance no es lo mismo que haber decidido. */}
                {p.targets.some((t) => t.assigned) && (
                  <span className="plan-chip-n"> ★{p.targets.filter((t) => t.assigned).length}</span>
                )}
              </button>
              <button
                className="plan-chip-x"
                onClick={() => borrar(p)}
                title={tr("Borrar este plan guardado")}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* La caja de texto es la ENTRADA, no la forma de leer un plan. En cuanto Koru lo entiende
          se enseña como lista con iconos; al texto crudo se vuelve con un botón. */}
      {editando || totalPlan === 0 ? (
        <textarea
          className="loot-modal-paste"
          rows={6}
          spellCheck={false}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={"Hull Upgrades 1\nHull Upgrades 2\nShield Management 5"}
        />
      ) : (
        <div className="plan-lista">
          {vista.map((g) => (
            <div key={g.g} className="plan-grupo">
              <div className="plan-grupo-cab">
                <span className="plan-grupo-nom">{g.nombre}</span>
                <span className="plan-grupo-n">
                  {g.skills.length} · {fmtSp(g.sp)} SP
                </span>
              </div>
              <div className="plan-skills">
                {g.skills.map((s) => (
                  <span
                    key={s.id}
                    className="plan-skill"
                    title={`${s.nombre} ${ROMANO[s.nivel]} · ${fmtSp(s.sp)} SP`}
                  >
                    {/* Las skills SÍ tienen icono en el servidor de imágenes (comprobado: para una
                        skill la única variante que sirve es `icon`, ni `render` ni `bp`). */}
                    <img
                      className="plan-skill-ico"
                      src={`https://images.evetech.net/types/${s.id}/icon?size=32`}
                      alt=""
                      loading="lazy"
                    />
                    {s.nombre}
                    {/* Romanos, como en el juego. El nivel es el FINAL que pide el plan: las 31
                        líneas del pegado son escalones, y aquí solo importa dónde acaba. */}
                    <span className="plan-skill-lvl">{ROMANO[s.nivel]}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPlan > 0 && (
        <div className="plan-modo">
          <button className="ver-mapa" onClick={() => setEditando(!editando)}>
            {editando ? tr("Ver el plan como lista") : tr("Editar el texto del plan")}
          </button>
          {!editando && (
            <span className="muted small">
              {" · "}
              {tr("TOTAL SP en total, desde cero").replace("TOTAL", fmtSp(spPlan))}
            </span>
          )}
        </div>
      )}

      {filas.length > 0 && (
        <div className="plan-guardar">
          <input
            type="text"
            value={nombrePlan}
            onChange={(e) => setNombrePlan(e.target.value)}
            placeholder={tr("Nombre del plan (p. ej. «Logi para el finde»)")}
          />
          {planId == null ? (
            <button className="ida-btn ida-primary" onClick={guardar} disabled={!nombrePlan.trim()}>
              {tr("Guardar plan")}
            </button>
          ) : (
            <button className="ida-btn" onClick={guardarCambios} disabled={!textoCambiado}>
              {tr("Guardar cambios")}
            </button>
          )}
        </div>
      )}

      {/* El aviso que evita repetir el error de la tarde del descuadre: comparar un plan contra la
          foto de OTRO plan. Se dice; no se recalcula por su cuenta. */}
      {textoCambiado && (
        <p className="small fits-err">
          ⚠{" "}
          {tr(
            "Has cambiado el texto de este plan guardado. El avance de abajo se sigue midiendo contra el plan ANTERIOR: guarda los cambios para que vuelva a cuadrar.",
          )}
        </p>
      )}

      {err && <p className="small fits-err">{err}</p>}
      {!estados && !err && <p className="muted small">{tr("Cargando…")}</p>}

      {totalPlan > 0 && (
        <p className="small muted">
          {tr("SKILLS habilidades en el plan").replace("SKILLS", String(totalPlan))}
          {plan.desconocidas.length > 0 && (
            <>
              {" · "}
              <span title={plan.desconocidas.slice(0, 10).join("\n")}>
                ⚠ {tr("LINEAS líneas no reconocidas").replace("LINEAS", String(plan.desconocidas.length))}
              </span>
            </>
          )}
        </p>
      )}

      {filas.length > 0 && (
        <table className="km-table">
          <thead>
            <tr>
              <th>{tr("Personaje")}</th>
              <th style={{ textAlign: "right" }}>{tr("Ya tiene")}</th>
              <th style={{ textAlign: "right" }}>{tr("SP que faltan")}</th>
              <th style={{ textAlign: "right" }}>{tr("Ritmo")}</th>
              <th style={{ textAlign: "right" }}>{tr("Tardaría")}</th>
              {/* El % conseguido NO necesita plan guardado: sale de comparar lo que tiene con lo
                  que el plan pide. Por eso está siempre, a diferencia de la ★. */}
              <th style={{ textAlign: "right" }}>{tr("Conseguido")}</th>
              {planActual && <th style={{ textAlign: "center" }} title={tr("Se lo he puesto a él")}>★</th>}
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              // Fragment CON CLAVE: cada personaje son DOS <tr> (la fila y su desglose), y un
              // `<>` suelto no admite key — React se quejaría en consola por cada fila.
              <Fragment key={f.id}>
              <tr
                className="plan-fila"
                onClick={() => setAbierto(abierto === f.id ? null : f.id)}
                title={tr("Ver qué le falta exactamente")}
              >
                <td>
                  <span className="plan-quien">
                    <span className="plan-desplegar">{abierto === f.id ? "▾" : "▸"}</span>
                    {/* Retrato redondo, como en toda la app: en EVE los retratos son circulares.
                        Con nueve alts, la cara se reconoce antes que el nombre. */}
                    <img
                      className="plan-cara"
                      src={`https://images.evetech.net/characters/${f.id}/portrait?size=32`}
                      alt=""
                      loading="lazy"
                    />
                    {f.nombre}
                  </span>
                </td>
                <td style={{ textAlign: "right" }} className="muted">
                  {f.yaHechas}/{totalPlan}
                </td>
                <td style={{ textAlign: "right" }}>{f.faltan === 0 ? "—" : fmtSp(f.faltan)}</td>
                <td style={{ textAlign: "right" }} className="muted">
                  {f.ritmo ? `${f.ritmo.toFixed(1)} SP/min` : "—"}
                </td>
                <td style={{ textAlign: "right" }}>
                  {f.faltan === 0 ? (
                    <strong>{tr("ya lo tiene")}</strong>
                  ) : f.min == null ? (
                    <span className="muted" title={tr("No está entrenando nada, así que no hay ritmo que medir. No se estima: se dice.")}>
                      {tr("sin ritmo medible")}
                    </span>
                  ) : (
                    duracion(f.min)
                  )}
                </td>
                {(() => {
                  const foto = planActual ? fotos.get(f.id) : undefined;
                  // ★ EL NÚMERO PRINCIPAL: cuánto del plan YA TIENE, en SP y no en número de
                  // skills. La columna «Ya tiene» cuenta skills, y una skill a nivel 5 vale ~30
                  // veces una a nivel 3: contar skills da una sensación de avance que no es cierta.
                  const conseguido = f.totalSp - f.faltan;
                  const pct = f.totalSp > 0 ? (conseguido / f.totalSp) * 100 : 100;
                  // Y de propina, si hay plan guardado: cuánto ha subido ese % desde la foto. Va
                  // pequeño y en verde a propósito — el porcentaje contesta «dónde está», esto
                  // solo «se está moviendo». Si no se movió, no se pinta nada: un «+0,0 %» sería
                  // ruido en las nueve filas.
                  const subida =
                    foto && f.totalSp > 0 ? ((foto.sp_left - f.faltan) / f.totalSp) * 100 : 0;
                  return (
                    <>
                      {/* ★ LA BARRA. Nueve porcentajes en una columna hay que leerlos uno a uno;
                          nueve barras se comparan de un vistazo, que es la pregunta real («¿quién
                          lo tiene más andado?»). El número NO se quita: la barra es para mirar, el
                          número para decidir. */}
                      <td className="plan-prog-td" title={`${fmtSp(conseguido)} / ${fmtSp(f.totalSp)} SP`}>
                        <div className="plan-prog-num">
                          {/* Un decimal: con planes grandes, un día entero de estudio puede no
                              mover el entero y parecería que no ha pasado nada. */}
                          {pct.toFixed(1)}%
                          {subida > 0.05 && (
                            <span className="plan-subida" title={tr("Lo que ha subido desde que guardaste el plan")}>
                              {" "}
                              +{subida.toFixed(1)}
                            </span>
                          )}
                          {/* Negativo = el plan creció o reordenaste la cola. Se ve, no se tapa:
                              esconderlo borraría justo el día en que algo cambió de rumbo. */}
                          {subida < -0.05 && (
                            <span className="muted" title={tr("Desde la foto ha bajado: si ampliaste el plan, es lo normal.")}>
                              {" "}
                              {subida.toFixed(1)}
                            </span>
                          )}
                        </div>
                        <div className="plan-barra">
                          {/* Mínimo visible: con un 0,3 % la barra sería invisible y parecería que
                              el dato falta, no que es pequeño. */}
                          <span
                            className={f.faltan === 0 ? "plan-barra-full" : undefined}
                            style={{ width: `${Math.max(pct, pct > 0 ? 1.5 : 0)}%` }}
                          />
                        </div>
                      </td>
                      {planActual && (
                        <td style={{ textAlign: "center" }}>
                          {foto ? (
                            <button
                              className="plan-estrella"
                              onClick={(e) => {
                                e.stopPropagation();
                                alternarAsignado(f.id, foto.assigned);
                              }}
                              title={foto.assigned ? tr("Quitar la marca") : tr("Se lo he puesto a él")}
                            >
                              {foto.assigned ? "★" : "☆"}
                            </button>
                          ) : (
                            // Sin foto no hay contra qué medir la subida. La estrella igualmente
                            // funciona: al marcarla se le hace la foto (lo resuelve el backend
                            // devolviendo `false` en vez de tragárselo).
                            <button
                              className="plan-estrella"
                              onClick={(e) => {
                                e.stopPropagation();
                                alternarAsignado(f.id, false);
                              }}
                              title={tr("Se lo he puesto a él")}
                            >
                              ☆
                            </button>
                          )}
                        </td>
                      )}
                    </>
                  );
                })()}
              </tr>
              {abierto === f.id && (
                <tr>
                  {/* colSpan VIVO: «Conseguido» está siempre (6 columnas) y la ★ solo con un plan
                      guardado (7). Dejarlo fijo partiría la tabla justo cuando se usa. */}
                  <td colSpan={planActual ? 7 : 6}>
                    {f.pendientes.length === 0 ? (
                      <p className="muted small">{tr("No le falta nada de este plan.")}</p>
                    ) : (
                      <>
                      <p className="muted small">
                        {f.calibrado
                          ? tr(
                              "El ritmo de cada skill sale de tus atributos, ajustado con el ritmo REAL medido en la cola — así entran también implantes y boosters.",
                            )
                          : tr(
                              "Este personaje no está entrenando nada, así que el ritmo es SOLO el de tus atributos: si lleva implantes, irá más rápido de lo que dice aquí.",
                            )}
                      </p>
                      <table className="km-table plan-detalle">
                        <thead>
                          <tr>
                            <th>{tr("Le falta")}</th>
                            <th style={{ textAlign: "right" }}>{tr("Tiene")}</th>
                            <th style={{ textAlign: "right" }}>{tr("Quiere")}</th>
                            <th style={{ textAlign: "right" }}>{tr("Rango de skill")}</th>
                            <th style={{ textAlign: "right" }}>SP</th>
                            <th style={{ textAlign: "right" }}>{tr("Ritmo")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {f.pendientes.map((p) => (
                            <tr key={p.id}>
                              <td>{p.nombre}</td>
                              <td style={{ textAlign: "right" }} className="muted">
                                {p.nivelActual}
                              </td>
                              <td style={{ textAlign: "right" }}>{p.objetivo}</td>
                              <td style={{ textAlign: "right" }} className="muted">
                                ×{p.rango}
                              </td>
                              <td style={{ textAlign: "right" }}>{fmtSp(p.sp)}</td>
                              {/* Cada skill entrena a SU ritmo: aquí se ve por qué dos skills con
                                  los mismos SP pueden tardar distinto. */}
                              <td style={{ textAlign: "right" }} className="muted">
                                {p.ritmo ? p.ritmo.toFixed(1) : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </>
                    )}
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}

      {filas.length > 0 && (
        <p className="small muted">
          {tr(
            "El tiempo sale de tu ritmo REAL medido en la cola del servidor, así que ya cuenta tus implantes y boosters actuales. Si los cambias, cambia el tiempo.",
          )}
        </p>
      )}
    </>
  );
}
