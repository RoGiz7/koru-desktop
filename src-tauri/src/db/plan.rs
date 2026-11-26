//! ★★ EL PLAN: varias paradas con su plazo, ordenadas para salvar las que se puedan.
//!
//! Aquí solo vive el ALMACÉN y el contrato de cada tipo de parada. El orden y los márgenes se
//! calculan en el frontend (`src/plan.ts`) porque dependen del grafo de rutas que pinta el mapa
//! —Ansiblex, wormholes, sistemas a evitar—, y si los contara otro grafo los márgenes dirían una
//! ruta distinta de la línea amarilla que se ve al lado.
//!
//! ★ EL CONTRATO DE UN `kind`. Cada tipo de parada aporta DOS cosas con nombre, las dos en un
//!   `match` exhaustivo de `PlanKind`:
//!   1. `resolver`: dame sistema, plazo y título de este `ref_id`, leídos de SU tabla y en el
//!      momento. Nada se copia a `plan_stop` (ver el comentario de la tabla en `schema.sql`).
//!   2. `borrar_origen`: el borrado del propio objeto. Quien borra pasa por `Db::plan_borrar_ref`,
//!      que lo envuelve y se lleva sus paradas EN LA MISMA TRANSACCIÓN.
//!   Añadir courier es añadir una variante: los dos `match` dejan de compilar hasta rellenar los
//!   dos huecos. Lo que el compilador no puede ver —que alguien borre filas por otra puerta— lo
//!   caza el cargador, que **canta** la parada que no resuelve en vez de tragársela.

use super::Db;
use crate::error::{AppError, AppResult};
use rusqlite::{Connection, OptionalExtension, Transaction};

/// Los tipos de parada que existen. En la fase 1, solo escalaciones.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlanKind {
    Escalacion,
}

/// Todas las variantes, para traducir el texto de la BD. ⚠️ El compilador NO comprueba que una
/// variante nueva esté aquí; si falta, sus paradas salen en pantalla como «tipo desconocido» (el
/// cargador canta), que es ruidoso a propósito.
const TODOS: [PlanKind; 1] = [PlanKind::Escalacion];

/// Lo que una parada ES en este momento, leído de la tabla de su `kind`.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ParadaResuelta {
    pub titulo: String,
    /// `None` cuando el objeto no sabe su sistema (escalaciones muy viejas): no se puede rutar.
    pub system_id: Option<i64>,
    pub system_name: String,
    /// El plazo, RFC 3339. Una parada se pierde si llegas después.
    pub caduca_at: String,
    /// El estado tal cual lo dice su tabla («pendiente», «hecha», «caducada»…).
    pub estado: String,
    /// ¿Sigue habiendo que ir? Lo decide el kind, no el plan: una escalación vendida ya no es
    /// tuya, una hecha ya está hecha. Solo las que lo están entran en el cálculo del orden.
    pub por_hacer: bool,
    /// ¿Has salido ya hacia ella? Para una escalación, «▶ Voy»: hay una run ABIERTA enlazada.
    ///
    /// ★ Es el disparador de la fase 2: solo el tramo empezado AVISA del intel; los demás se marcan
    ///   en silencio. Se mira `outcome = 'open'` y no solo `run_id IS NOT NULL` porque «Hecha»
    ///   cierra la run y DESPUÉS cambia el estado en otra llamada: si esa segunda fallara, la
    ///   escalación quedaría pendiente con la run cerrada, y un tramo que ya hiciste seguiría sonando.
    pub empezada: bool,
}

impl PlanKind {
    pub fn clave(self) -> &'static str {
        match self {
            PlanKind::Escalacion => "escalacion",
        }
    }

    pub fn de_clave(s: &str) -> Option<Self> {
        TODOS.iter().copied().find(|k| k.clave() == s)
    }

    /// Hueco 1 del contrato: qué es `ref_id` ahora mismo. `Ok(None)` = ya no existe.
    pub fn resolver(self, conn: &Connection, ref_id: i64) -> AppResult<Option<ParadaResuelta>> {
        match self {
            PlanKind::Escalacion => Ok(conn
                .query_row(
                    "SELECT e.titulo, e.system_id, e.system_name, e.caduca_at, e.estado, e.modo, \
                            COALESCE((SELECT r.outcome = 'open' FROM activity_runs r WHERE r.id = e.run_id), 0) \
                     FROM escalaciones e WHERE e.id = ?1",
                    [ref_id],
                    |r| {
                        let estado: String = r.get(4)?;
                        let modo: String = r.get(5)?;
                        // Solo la propia y pendiente. Una vendida la corre el comprador: su
                        // reloj ya no es tuyo (mismo criterio que `escalaciones_avisar`).
                        let por_hacer = modo == "propia" && estado == "pendiente";
                        let run_abierta: bool = r.get(6)?;
                        Ok(ParadaResuelta {
                            titulo: r.get(0)?,
                            system_id: r.get(1)?,
                            system_name: r.get(2)?,
                            caduca_at: r.get(3)?,
                            por_hacer,
                            empezada: por_hacer && run_abierta,
                            estado,
                        })
                    },
                )
                .optional()?),
        }
    }

    /// Hueco 2 del contrato: el borrado del objeto en sí, dentro de la transacción que le dan.
    /// No toca `plan_stop`: eso lo hace `Db::plan_borrar_ref` para que ningún kind pueda olvidarlo.
    /// Devuelve si borró algo.
    fn borrar_origen(self, tx: &Transaction, ref_id: i64) -> AppResult<bool> {
        match self {
            PlanKind::Escalacion => {
                // Se lee el `run_id` ANTES de borrar la fila: después ya no hay dónde preguntarlo.
                // Ver `Db::escalacion_delete` para por qué la run se va con ella.
                let run_id: Option<i64> = tx
                    .query_row("SELECT run_id FROM escalaciones WHERE id = ?1", [ref_id], |r| {
                        r.get(0)
                    })
                    .optional()?
                    .flatten();
                let n = tx.execute("DELETE FROM escalaciones WHERE id = ?1", [ref_id])?;
                if let Some(rid) = run_id {
                    tx.execute("DELETE FROM activity_runs WHERE id = ?1", [rid])?;
                }
                Ok(n > 0)
            }
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Plan {
    pub id: i64,
    pub nombre: String,
    pub creado_at: String,
    pub origen_system_id: Option<i64>,
    pub orden_manual: bool,
    pub salta_character_id: Option<i64>,
    pub cyno_character_id: Option<i64>,
    pub ojos_character_id: Option<i64>,
    /// La forma de viajar (`forma_viaje`). `None` = a puertas con el número del panel, como antes.
    pub forma_id: Option<i64>,
}

/// Una manera de moverse, con nombre (ver la tabla `forma_viaje` en `schema.sql`). Solo lo que se
/// DECLARA: lo del casco se resuelve por `casco_type_id` en el catálogo al calcular.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FormaViaje {
    pub id: i64,
    pub nombre: String,
    /// `puertas` | `salto`.
    pub modo: String,
    pub casco_type_id: Option<i64>,
    pub ciclo_cyno_min: f64,
    pub min_por_salto: f64,
    /// Los planes que la usan, por nombre: una ficha en uso no se borra, y se dice por quién.
    #[serde(default)]
    pub planes: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PlanResumen {
    pub id: i64,
    pub nombre: String,
    pub creado_at: String,
    pub paradas: i64,
}

/// Una parada tal como sale del cargador: o resuelta, o con el motivo por el que no resuelve.
/// **Nunca desaparece**: una parada que no resuelve es un fallo de otro sitio (un borrado que no
/// limpió) y tiene que verse para que alguien lo arregle.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ParadaCargada {
    pub id: i64,
    pub orden: i64,
    pub kind: String,
    pub ref_id: i64,
    pub resuelta: Option<ParadaResuelta>,
    /// Por qué no resuelve, como CÓDIGO y no como frase: el texto lo pone la pantalla con `tr()`
    /// para que salga en los dos idiomas. `kind_desconocido` · `no_existe`.
    pub fallo: Option<&'static str>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PlanCargado {
    pub plan: Plan,
    pub paradas: Vec<ParadaCargada>,
}

/// Una parada a la que YA has salido («▶ Voy» con la run abierta), de cualquier plan guardado.
///
/// ★ Es lo que el vigilante mira con el plan CERRADO. Cuando vuelas de verdad estás en EVE, no en
///   el mapa de Koru: atar la vigilancia al panel abierto la apagaba justo cuando hace falta. Y
///   vigilar todos los planes guardados para siempre sería ruido; la run abierta es la condición
///   buena: «Empezar» la enciende, terminar o abandonar la apaga.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ParadaEmpezada {
    pub stop_id: i64,
    pub system_id: i64,
    pub system_name: String,
    pub caduca_at: String,
    /// ¿Su plan va SALTANDO? Entonces quien cruza los sistemas del camino es el CYNO, no el que
    /// salta, y el tramo vigilado se cuenta desde donde está el cyno (fase 3a).
    pub salto: bool,
    /// El cyno de su plan, si la forma es `salto` y está puesto.
    pub cyno_character_id: Option<i64>,
}

impl Db {
    /// Borra el objeto `ref_id` de tipo `kind` **y sus paradas en todos los planes**, en una sola
    /// transacción. Es la ÚNICA puerta de borrado de algo que puede estar en un plan: así la
    /// limpieza no es una regla que cada kind tenga que acordarse de cumplir.
    pub fn plan_borrar_ref(&self, kind: PlanKind, ref_id: i64) -> AppResult<bool> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let borrado = kind.borrar_origen(&tx, ref_id)?;
        tx.execute(
            "DELETE FROM plan_stop WHERE kind = ?1 AND ref_id = ?2",
            rusqlite::params![kind.clave(), ref_id],
        )?;
        tx.commit()?;
        Ok(borrado)
    }

    /// Crea un plan vacío. Las paradas entran con `plan_anadir`, una a una, para que cada una pase
    /// la misma comprobación.
    pub fn plan_crear(&self, nombre: &str) -> AppResult<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO plan (nombre, creado_at) VALUES (?1, ?2)",
            rusqlite::params![nombre, chrono::Utc::now().to_rfc3339()],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn plan_listar(&self) -> AppResult<Vec<PlanResumen>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT p.id, p.nombre, p.creado_at, \
             (SELECT COUNT(*) FROM plan_stop s WHERE s.plan_id = p.id) \
             FROM plan p ORDER BY p.creado_at DESC",
        )?;
        let v = st
            .query_map([], |r| {
                Ok(PlanResumen {
                    id: r.get(0)?,
                    nombre: r.get(1)?,
                    creado_at: r.get(2)?,
                    paradas: r.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(v)
    }

    /// ★ EL CARGADOR QUE CANTA. Cada parada sale con su `resuelta` o con un `fallo` que dice por
    /// qué no resuelve: tipo desconocido (un Koru más nuevo escribió algo que este no sabe leer) o
    /// referencia que ya no existe (un borrado que no pasó por `plan_borrar_ref`). Filtrarlas
    /// aquí haría que un kind futuro que olvide limpiar se notara como «se me perdió una parada»
    /// en vez de como el fallo que es.
    pub fn plan_cargar(&self, plan_id: i64) -> AppResult<PlanCargado> {
        let conn = self.conn.lock().unwrap();
        let plan = conn
            .query_row(
                "SELECT id, nombre, creado_at, origen_system_id, orden_manual, \
                 salta_character_id, cyno_character_id, ojos_character_id, forma_id FROM plan WHERE id = ?1",
                [plan_id],
                |r| {
                    Ok(Plan {
                        id: r.get(0)?,
                        nombre: r.get(1)?,
                        creado_at: r.get(2)?,
                        origen_system_id: r.get(3)?,
                        orden_manual: r.get::<_, i64>(4)? != 0,
                        salta_character_id: r.get(5)?,
                        cyno_character_id: r.get(6)?,
                        ojos_character_id: r.get(7)?,
                        forma_id: r.get(8)?,
                    })
                },
            )
            .optional()?
            .ok_or_else(|| AppError::Other(format!("el plan #{plan_id} ya no existe")))?;
        let filas: Vec<(i64, i64, String, i64)> = {
            let mut st = conn.prepare(
                "SELECT id, orden, kind, ref_id FROM plan_stop WHERE plan_id = ?1 ORDER BY orden, id",
            )?;
            let v = st
                .query_map([plan_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
                .collect::<Result<Vec<_>, _>>()?;
            v
        };
        let mut paradas = Vec::with_capacity(filas.len());
        for (id, orden, kind, ref_id) in filas {
            let (resuelta, fallo) = match PlanKind::de_clave(&kind) {
                // Un Koru más nuevo escribió un tipo que este no sabe leer.
                None => (None, Some("kind_desconocido")),
                Some(k) => match k.resolver(&conn, ref_id)? {
                    Some(r) => (Some(r), None),
                    // Un borrado que no pasó por `plan_borrar_ref`.
                    None => (None, Some("no_existe")),
                },
            };
            paradas.push(ParadaCargada { id, orden, kind, ref_id, resuelta, fallo });
        }
        Ok(PlanCargado { plan, paradas })
    }

    /// Las paradas empezadas de TODOS los planes (ver `ParadaEmpezada`). Pasa por el mismo
    /// `resolver` que el cargador, para que «empezada» signifique lo mismo en el panel y fuera de
    /// él. Una escalación que está en dos planes sale UNA vez: dos tramos iguales serían dos
    /// marcas del mismo hostil. Las que no saben su sistema no se pueden rutar y no salen.
    pub fn plan_paradas_empezadas(&self) -> AppResult<Vec<ParadaEmpezada>> {
        let conn = self.conn.lock().unwrap();
        let filas: Vec<(i64, String, i64, bool, Option<i64>)> = {
            let mut st = conn.prepare(
                "SELECT s.id, s.kind, s.ref_id, COALESCE(f.modo = 'salto', 0), p.cyno_character_id \
                 FROM plan_stop s JOIN plan p ON p.id = s.plan_id \
                 LEFT JOIN forma_viaje f ON f.id = p.forma_id \
                 ORDER BY s.plan_id, s.orden, s.id",
            )?;
            let v = st
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?
                .collect::<Result<Vec<_>, _>>()?;
            v
        };
        let mut vistas = std::collections::HashSet::new();
        let mut out = Vec::new();
        for (stop_id, kind, ref_id, salto, cyno) in filas {
            // Un kind que este Koru no conoce no puede estar empezado por este Koru: lo canta el
            // cargador, aquí solo no se vigila.
            let Some(k) = PlanKind::de_clave(&kind) else { continue };
            let Some(r) = k.resolver(&conn, ref_id)? else { continue };
            let Some(sid) = r.system_id else { continue };
            if r.empezada && vistas.insert((kind.clone(), ref_id)) {
                out.push(ParadaEmpezada {
                    stop_id,
                    system_id: sid,
                    system_name: r.system_name,
                    caduca_at: r.caduca_at,
                    salto,
                    cyno_character_id: if salto { cyno } else { None },
                });
            }
        }
        Ok(out)
    }

    /// Las formas de viajar, cada una con los planes que la usan.
    pub fn forma_listar(&self) -> AppResult<Vec<FormaViaje>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT id, nombre, modo, casco_type_id, ciclo_cyno_min, min_por_salto FROM forma_viaje ORDER BY nombre, id",
        )?;
        let mut v = st
            .query_map([], |r| {
                Ok(FormaViaje {
                    id: r.get(0)?,
                    nombre: r.get(1)?,
                    modo: r.get(2)?,
                    casco_type_id: r.get(3)?,
                    ciclo_cyno_min: r.get(4)?,
                    min_por_salto: r.get(5)?,
                    planes: Vec::new(),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        for f in &mut v {
            f.planes = planes_de_forma(&conn, f.id)?;
        }
        Ok(v)
    }

    /// Crea (`id` = None) o cambia una forma de viajar. Devuelve su id.
    ///
    /// La validación está AQUÍ y no solo en la pantalla: una forma `salto` sin casco no se puede
    /// calcular, y una a puertas con casco tendría un dato que nadie lee y que parecería que cuenta.
    pub fn forma_guardar(&self, f: &FormaViaje) -> AppResult<i64> {
        let nombre = f.nombre.trim();
        if nombre.is_empty() {
            return Err(AppError::Other("la forma de viajar necesita un nombre".into()));
        }
        let casco = match f.modo.as_str() {
            "puertas" => None,
            "salto" => Some(f.casco_type_id.ok_or_else(|| {
                AppError::Other("una forma «salto» necesita el casco que salta".into())
            })?),
            otro => return Err(AppError::Other(format!("modo de viaje desconocido «{otro}»"))),
        };
        // `!(x > 0)` y no `x <= 0`: un NaN tiene que caer aquí, no colarse como número.
        if !(f.min_por_salto > 0.0) || !(f.ciclo_cyno_min > 0.0) {
            return Err(AppError::Other("los minutos por salto y el ciclo del cyno tienen que ser mayores que 0".into()));
        }
        let conn = self.conn.lock().unwrap();
        if f.id > 0 {
            let n = conn.execute(
                "UPDATE forma_viaje SET nombre = ?2, modo = ?3, casco_type_id = ?4, ciclo_cyno_min = ?5, \
                 min_por_salto = ?6 WHERE id = ?1",
                rusqlite::params![f.id, nombre, f.modo, casco, f.ciclo_cyno_min, f.min_por_salto],
            )?;
            if n == 0 {
                return Err(AppError::Other(format!("la forma de viajar #{} ya no existe", f.id)));
            }
            Ok(f.id)
        } else {
            conn.execute(
                "INSERT INTO forma_viaje (nombre, modo, casco_type_id, ciclo_cyno_min, min_por_salto, creado_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![nombre, f.modo, casco, f.ciclo_cyno_min, f.min_por_salto, chrono::Utc::now().to_rfc3339()],
            )?;
            Ok(conn.last_insert_rowid())
        }
    }

    /// Borra una forma de viajar. ⚠️ Si algún plan la usa, NO se borra y el error dice cuáles:
    /// volver esos planes «a puertas» en silencio cambiaría sus márgenes sin que nadie lo pidiera.
    pub fn forma_borrar(&self, id: i64) -> AppResult<bool> {
        let conn = self.conn.lock().unwrap();
        let planes = planes_de_forma(&conn, id)?;
        if !planes.is_empty() {
            return Err(AppError::Other(format!(
                "la usan estos planes: {}. Cámbiales antes la forma de viajar.",
                planes.join(", ")
            )));
        }
        Ok(conn.execute("DELETE FROM forma_viaje WHERE id = ?1", [id])? > 0)
    }

    /// Pone (o quita, con `None`) la forma de viajar de un plan.
    pub fn plan_forma(&self, plan_id: i64, forma_id: Option<i64>) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute("UPDATE plan SET forma_id = ?2 WHERE id = ?1", rusqlite::params![plan_id, forma_id])?;
        if n == 0 {
            return Err(AppError::Other(format!("el plan #{plan_id} ya no existe")));
        }
        Ok(())
    }

    /// Fija quién SALTA y quién pone el CYNO. `ojos` no se toca aquí a propósito: no hay selector
    /// porque todavía no hace nada, y un control que no hace nada miente.
    pub fn plan_papeles(&self, plan_id: i64, salta: Option<i64>, cyno: Option<i64>) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute(
            "UPDATE plan SET salta_character_id = ?2, cyno_character_id = ?3 WHERE id = ?1",
            rusqlite::params![plan_id, salta, cyno],
        )?;
        if n == 0 {
            return Err(AppError::Other(format!("el plan #{plan_id} ya no existe")));
        }
        Ok(())
    }

    /// Añade una parada al final. Comprueba que el tipo exista y que el objeto exista HOY: dejar
    /// entrar una referencia rota sería fabricar lo que el cargador tiene que cantar.
    /// Devuelve `false` si ya estaba en el plan (la clave única lo impide y no es un error).
    pub fn plan_anadir(&self, plan_id: i64, kind: &str, ref_id: i64) -> AppResult<bool> {
        let k = PlanKind::de_clave(kind)
            .ok_or_else(|| AppError::Other(format!("tipo de parada desconocido «{kind}»")))?;
        let conn = self.conn.lock().unwrap();
        if k.resolver(&conn, ref_id)?.is_none() {
            return Err(AppError::Other(format!("«{kind}» #{ref_id} no existe")));
        }
        let n = conn.execute(
            "INSERT OR IGNORE INTO plan_stop (plan_id, orden, kind, ref_id) VALUES \
             (?1, COALESCE((SELECT MAX(orden) + 1 FROM plan_stop WHERE plan_id = ?1), 0), ?2, ?3)",
            rusqlite::params![plan_id, kind, ref_id],
        )?;
        Ok(n > 0)
    }

    /// Saca una parada del plan. Es el «no la hago»: la escalación sigue con su estado intacto.
    pub fn plan_quitar(&self, stop_id: i64) -> AppResult<bool> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.execute("DELETE FROM plan_stop WHERE id = ?1", [stop_id])? > 0)
    }

    /// Guarda el orden manual: `stop_ids` en el orden nuevo, y TODAS las del plan. Si faltan o
    /// sobran, error y no se toca nada — un orden parcial dejaría paradas con números repetidos y
    /// el orden saldría distinto según cómo desempatara SQLite.
    pub fn plan_reordenar(&self, plan_id: i64, stop_ids: &[i64]) -> AppResult<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let mut actuales: Vec<i64> = {
            let mut st = tx.prepare("SELECT id FROM plan_stop WHERE plan_id = ?1")?;
            let v = st
                .query_map([plan_id], |r| r.get(0))?
                .collect::<Result<Vec<i64>, _>>()?;
            v
        };
        let mut pedidos = stop_ids.to_vec();
        actuales.sort_unstable();
        pedidos.sort_unstable();
        if actuales != pedidos {
            return Err(AppError::Other(
                "el orden no coincide con las paradas del plan (¿ha cambiado en otra ventana?)".into(),
            ));
        }
        for (i, id) in stop_ids.iter().enumerate() {
            tx.execute(
                "UPDATE plan_stop SET orden = ?2 WHERE id = ?1",
                rusqlite::params![id, i as i64],
            )?;
        }
        tx.execute("UPDATE plan SET orden_manual = 1 WHERE id = ?1", [plan_id])?;
        tx.commit()?;
        Ok(())
    }

    /// Vuelve a dejar que Koru ordene. El orden guardado se conserva, pero deja de mandar.
    pub fn plan_orden_propuesto(&self, plan_id: i64) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE plan SET orden_manual = 0 WHERE id = ?1", [plan_id])?;
        Ok(())
    }

    /// Fija el origen. `None` = vuelve a contar desde el personaje activo.
    pub fn plan_origen(&self, plan_id: i64, system_id: Option<i64>) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE plan SET origen_system_id = ?2 WHERE id = ?1",
            rusqlite::params![plan_id, system_id],
        )?;
        Ok(())
    }

    /// Borra el plan. Sus paradas se van por `ON DELETE CASCADE`; las escalaciones no se tocan.
    pub fn plan_borrar(&self, plan_id: i64) -> AppResult<bool> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.execute("DELETE FROM plan WHERE id = ?1", [plan_id])? > 0)
    }
}

fn planes_de_forma(conn: &Connection, forma_id: i64) -> AppResult<Vec<String>> {
    let mut st = conn.prepare("SELECT nombre FROM plan WHERE forma_id = ?1 ORDER BY nombre, id")?;
    let v = st.query_map([forma_id], |r| r.get(0))?.collect::<Result<Vec<String>, _>>()?;
    Ok(v)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Las dos mitades del contrato, con una BD de verdad: borrar una escalación se lleva sus
    /// paradas, y una parada que no resuelve SALE del cargador con su motivo en vez de esfumarse.
    /// La segunda mitad se fabrica a mano (un DELETE que no pasa por `plan_borrar_ref`), que es
    /// justo el fallo que el cargador tiene que cantar.
    #[test]
    fn cascada_al_borrar_y_cargador_que_canta() {
        let tmp = std::env::temp_dir().join(format!("koru-plan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        let db = Db::open(tmp.join("koru.db")).unwrap();

        let a = db
            .escalacion_abrir(None, "A", None, None, Some(30000142), "Jita", 600, "propia", None)
            .unwrap();
        let b = db
            .escalacion_abrir(None, "B", None, None, Some(30002187), "Amarr", 300, "propia", None)
            .unwrap();
        let plan = db.plan_crear("prueba").unwrap();
        assert!(db.plan_anadir(plan, "escalacion", a).unwrap());
        assert!(db.plan_anadir(plan, "escalacion", b).unwrap());
        assert!(!db.plan_anadir(plan, "escalacion", a).unwrap(), "repetida: no entra dos veces");
        assert!(db.plan_anadir(plan, "escalacion", 999_999).is_err(), "no existe: no entra");
        assert!(db.plan_anadir(plan, "courier", a).is_err(), "kind desconocido: no entra");

        // 1) Borrar por la puerta buena se lleva la parada.
        assert!(db.escalacion_delete(a).unwrap());
        let c = db.plan_cargar(plan).unwrap();
        assert_eq!(c.paradas.len(), 1);
        assert_eq!(c.paradas[0].ref_id, b);
        assert!(c.paradas[0].resuelta.as_ref().unwrap().por_hacer);

        // 1b) «▶ Voy» la marca como empezada mientras la run está ABIERTA; al cerrarla, deja de
        //     estarlo aunque el estado siga «pendiente» (el caso de la segunda llamada que falla).
        assert!(!c.paradas[0].resuelta.as_ref().unwrap().empezada, "sin Voy no está empezada");
        // La misma escalación en OTRO plan: con el plan cerrado tiene que vigilarse UNA vez.
        let otro = db.plan_crear("otro").unwrap();
        assert!(db.plan_anadir(otro, "escalacion", b).unwrap());
        assert!(db.plan_paradas_empezadas().unwrap().is_empty(), "sin Voy, nada que vigilar");
        let run = db.escalacion_run_start(b, None, None, None).unwrap();
        let c = db.plan_cargar(plan).unwrap();
        assert!(c.paradas[0].resuelta.as_ref().unwrap().empezada, "con Voy, empezada");
        let e = db.plan_paradas_empezadas().unwrap();
        assert_eq!(e.len(), 1, "empezada en dos planes: un solo tramo vigilado");
        assert_eq!((e[0].stop_id, e[0].system_id), (c.paradas[0].id, 30002187));
        db.run_end(run, "done", None, None, None, None, None).unwrap();
        let c = db.plan_cargar(plan).unwrap();
        assert!(!c.paradas[0].resuelta.as_ref().unwrap().empezada, "run cerrada: ya no suena");
        assert!(db.plan_paradas_empezadas().unwrap().is_empty(), "run cerrada: se deja de vigilar");
        assert!(db.plan_borrar(otro).unwrap());

        // 2) Un borrado por otra puerta deja la parada colgando: el cargador la CANTA.
        db.conn.lock().unwrap().execute("DELETE FROM escalaciones WHERE id = ?1", [b]).unwrap();
        // 3) Y un kind que este Koru no conoce, también.
        db.conn
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO plan_stop (plan_id, orden, kind, ref_id) VALUES (?1, 9, 'courier', 7)",
                [plan],
            )
            .unwrap();
        let c = db.plan_cargar(plan).unwrap();
        assert_eq!(c.paradas.len(), 2, "ninguna desaparece");
        assert_eq!(c.paradas[0].fallo, Some("no_existe"));
        assert_eq!(c.paradas[1].fallo, Some("kind_desconocido"));

        // 4) Reordenar exige TODAS las paradas, y marca el orden como manual.
        let ids: Vec<i64> = c.paradas.iter().map(|p| p.id).collect();
        assert!(db.plan_reordenar(plan, &ids[..1]).is_err(), "orden parcial: rechazado");
        db.plan_reordenar(plan, &[ids[1], ids[0]]).unwrap();
        let c = db.plan_cargar(plan).unwrap();
        assert!(c.plan.orden_manual);
        assert_eq!(c.paradas[0].id, ids[1]);

        // 4b) La forma de viajar y los papeles. Sin ficha, el plan sigue «a puertas» (None).
        assert_eq!(c.plan.forma_id, None, "un plan nuevo no tiene forma: a puertas, como antes");
        let ficha = |modo: &str, casco: Option<i64>| FormaViaje {
            id: 0,
            nombre: "blops con cyno covert".into(),
            modo: modo.into(),
            casco_type_id: casco,
            ciclo_cyno_min: 1.0,
            min_por_salto: 1.0,
            planes: vec![],
        };
        assert!(db.forma_guardar(&ficha("salto", None)).is_err(), "salto sin casco: no entra");
        assert!(db.forma_guardar(&ficha("volar", None)).is_err(), "modo desconocido: no entra");
        assert!(db.forma_guardar(&FormaViaje { min_por_salto: f64::NAN, ..ficha("puertas", None) }).is_err(), "NaN: no entra");
        let fid = db.forma_guardar(&ficha("salto", Some(22430))).unwrap();
        let pid_a_puertas = db.forma_guardar(&ficha("puertas", Some(22430))).unwrap();
        let formas = db.forma_listar().unwrap();
        assert_eq!(formas.iter().find(|f| f.id == pid_a_puertas).unwrap().casco_type_id, None, "a puertas no guarda casco");
        db.plan_forma(plan, Some(fid)).unwrap();
        db.plan_papeles(plan, Some(7), Some(8)).unwrap();
        let c2 = db.plan_cargar(plan).unwrap();
        assert_eq!((c2.plan.forma_id, c2.plan.salta_character_id, c2.plan.cyno_character_id), (Some(fid), Some(7), Some(8)));
        let err = db.forma_borrar(fid).unwrap_err().to_string();
        assert!(err.contains("prueba"), "una ficha en uso no se borra, y dice qué plan la usa: {err}");
        assert_eq!(db.forma_listar().unwrap().iter().find(|f| f.id == fid).unwrap().planes, vec!["prueba".to_string()]);
        // La costura con la fase 2: saltando, el camino vigilado es el del CYNO, y se dice cuál es.
        let d = db
            .escalacion_abrir(None, "D", None, None, Some(30002659), "Dodixie", 600, "propia", None)
            .unwrap();
        assert!(db.plan_anadir(plan, "escalacion", d).unwrap());
        let run_d = db.escalacion_run_start(d, None, None, None).unwrap();
        let e = db.plan_paradas_empezadas().unwrap();
        assert_eq!((e.len(), e[0].salto, e[0].cyno_character_id), (1, true, Some(8)), "saltando: el camino es del cyno");
        db.plan_forma(plan, None).unwrap();
        let e = db.plan_paradas_empezadas().unwrap();
        assert_eq!((e[0].salto, e[0].cyno_character_id), (false, None), "a puertas: tu camino, como en la fase 2");
        db.run_end(run_d, "done", None, None, None, None, None).unwrap();
        assert!(db.forma_borrar(fid).unwrap(), "sin planes, se borra");
        assert!(db.forma_borrar(pid_a_puertas).unwrap());

        // 5) Borrar el plan se lleva sus paradas por la clave ajena.
        assert!(db.plan_borrar(plan).unwrap());
        let n: i64 = db
            .conn
            .lock()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM plan_stop", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);

        drop(db);
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
