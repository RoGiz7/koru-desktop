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
import { tr } from "./i18n";
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
/** `public/skill_training.json`: { typeID: { r: rango, p: primario, s: secundario } } */
type SkillTraining = Record<string, { r: number; p: number; s: number }>;

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

  useEffect(() => {
    loadJson<SkillTraining>("/skill_training.json", {}).then(setCat);
    loadJson<Record<string, string>>("/skill_names.json", {}).then(setNombres);
    invoke<CharSkillState[]>("get_skill_states")
      .then(setEstados)
      .catch((e) => setErr(String(e)));
  }, []);

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

  return (
    <>
      <p className="muted small">
        {tr(
          "Pega aquí un plan de habilidades exportado del juego (una línea por nivel, como lo copia EVE). Koru te dice lo que te falta y con cuál de tus personajes sale antes.",
        )}
      </p>
      <textarea
        className="loot-modal-paste"
        rows={6}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder={"Hull Upgrades 1\nHull Upgrades 2\nShield Management 5"}
      />
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
                  <span className="plan-desplegar">{abierto === f.id ? "▾" : "▸"}</span> {f.nombre}
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
              </tr>
              {abierto === f.id && (
                <tr>
                  <td colSpan={5}>
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
