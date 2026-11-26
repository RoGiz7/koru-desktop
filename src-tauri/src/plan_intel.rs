//! ★★ EL INTEL MIRA HACIA DELANTE — fase 2 del plan de escalaciones.
//!
//! Hasta aquí el intel contestaba «¿hay algo cerca de mí?». Con el plan guardado puede contestar
//! «¿hay algo en mi camino?»: es la misma maquinaria (`intel_bfs`) con OTROS orígenes, los
//! sistemas de los tramos que aún no has hecho.
//!
//! 🚨 LA TRAMPA, y por qué esto vive aparte: los tramos NO entran en `cfg.origins`. Esos son los
//!    sistemas donde están tus personajes, y la alerta de siempre salta con `d <= alert_jumps`
//!    medido desde ellos. Si se les sumaran los del plan, el aviso flotante y el minimapa sonarían
//!    por sitios donde no estás. Así que aquí hay un SEGUNDO cálculo de distancias, por tramo, con su
//!    propia puerta (`PlanTramoIntel::empezado`), y `cfg.origins` no se lee ni se toca.
//!
//! ★ MARCAR SIEMPRE, AVISAR SOLO EL TRAMO EMPEZADO (decisión de RoGiz7). Un hostil cerca de un
//!   tramo que no has empezado se MARCA (lo ve el panel del plan, en silencio); solo el tramo del
//!   «▶ Voy» pasa por el camino de alerta de verdad. Se calla la alarma, nunca el dato: por eso
//!   cada marca dice POR QUÉ suena o no suena (`PlanMarca::aviso`), y el silencio se ve.

use std::collections::{HashMap, HashSet};

/// Un tramo del plan tal como lo manda el frontend: los sistemas de SU ruta (la misma línea que
/// pinta el mapa) y si ya has salido hacia su parada.
#[derive(Clone, Debug, serde::Deserialize, Hash, PartialEq)]
pub struct PlanTramoIntel {
    /// `plan_stop.id` de la parada a la que llega el tramo.
    pub stop_id: i64,
    /// Nombre del sistema de la parada, para decirlo en el aviso: «en tu camino a Amarr».
    pub destino: String,
    /// Los sistemas del tramo, en orden. Para el empezado, desde donde estás AHORA: lo que ya has
    /// pasado no entra (un hostil por donde ya pasaste es ruido).
    pub sistemas: Vec<i64>,
    /// «▶ Voy» pulsado en esta parada (run abierta). El ÚNICO que avisa.
    pub empezado: bool,
}

/// Un hostil cantado cerca de un tramo del plan.
#[derive(Clone, Debug, serde::Serialize, PartialEq)]
pub struct PlanMarca {
    pub stop_id: i64,
    pub sys_id: i64,
    pub system: String,
    /// Saltos del sistema cantado al sistema MÁS CERCANO del tramo.
    pub jumps: i64,
    /// Ese sistema del tramo, para decir «a 2 saltos de X» y no un número sin dueño.
    pub cerca_de: i64,
    pub cerca_de_name: String,
    pub ts_ms: i64,
    pub author: String,
    pub message: String,
    /// Por qué suena o no, con las condiciones de AHORA:
    /// `"avisa"` (tramo empezado, alertas encendidas, sistema sin silenciar) · `"no_empezado"` ·
    /// `"silenciado"` · `"alertas_apagadas"`. Un tramo marcado que no suena tiene que parecer
    /// marcado, no limpio: la pantalla pinta esto tal cual.
    pub aviso: &'static str,
}

/// Lo que sale de una pasada: todas las marcas (para el panel) y, de ellas, cuáles hay que avisar
/// AHORA (índices en `marcas`): las del tramo empezado que aún no habían avisado.
#[derive(Debug, Default)]
pub struct PasadaPlan {
    pub marcas: Vec<PlanMarca>,
    pub avisar: Vec<usize>,
}

/// La pasada entera, PURA: sin `AppHandle`, sin mutex, sin reloj propio. Así se prueba con un
/// grafo de juguete, y el hilo del vigilante solo pone los efectos (notificación, evento, overlay).
///
/// `rep` es lo que el vigilante YA sacó de las líneas (sistema → (ts, autor, mensaje), con los
/// «clear» aplicados): el troceador no se repite ni se toca.
///
/// `alerted` es el MISMO conjunto de claves `"{sid}-{ts}"` que usa la alerta de tus personajes.
/// Compartirlo es a propósito: un reporte que ya sonó porque estaba cerca de ti no vuelve a sonar
/// por estar además en tu camino. Y la clave se apunta SOLO para el tramo empezado: si un hostil
/// está en el camino a Amarr y aún no has salido, al pulsar «▶ Voy» en Amarr sí sonará.
#[allow(clippy::too_many_arguments)]
pub fn pasada(
    adj: &HashMap<i64, Vec<i64>>,
    id_to_name: &HashMap<i64, String>,
    rep: &HashMap<i64, (i64, String, String)>,
    tramos: &[PlanTramoIntel],
    alert_jumps: i64,
    silenciado: &dyn Fn(i64) -> bool,
    alerts_enabled: bool,
    alerted: &mut HashSet<String>,
) -> PasadaPlan {
    let bfs = crate::commands::intel_bfs;
    let nombre = |sid: i64| id_to_name.get(&sid).cloned().unwrap_or_else(|| sid.to_string());
    let mut out = PasadaPlan::default();
    if rep.is_empty() {
        return out;
    }
    // Desde cada sistema cantado, una sola vez: sirve para decir de QUÉ sistema del tramo está
    // cerca. Solo se calcula para los que caen dentro del radio de algún tramo.
    let mut desde_rep: HashMap<i64, HashMap<i64, i64>> = HashMap::new();
    // Orden estable: `rep` es un HashMap y el panel no puede bailar entre pasadas.
    let mut reps: Vec<(&i64, &(i64, String, String))> = rep.iter().collect();
    reps.sort_by_key(|(sid, (ts, _, _))| (**sid, *ts));
    for t in tramos {
        if t.sistemas.is_empty() {
            continue;
        }
        let dist = bfs(adj, &t.sistemas);
        for (sid, (ts, author, message)) in &reps {
            let Some(&d) = dist.get(sid) else { continue };
            if d > alert_jumps {
                continue;
            }
            let d_rep = desde_rep.entry(**sid).or_insert_with(|| bfs(adj, &[**sid]));
            let cerca_de = t
                .sistemas
                .iter()
                .copied()
                .filter(|s| d_rep.get(s) == Some(&d))
                .next()
                // No puede faltar (la distancia es simétrica en este grafo), pero si faltara se
                // nombra el primero del tramo antes que inventar uno.
                .unwrap_or(t.sistemas[0]);
            let aviso = if !t.empezado {
                "no_empezado"
            } else if silenciado(**sid) {
                "silenciado"
            } else if !alerts_enabled {
                "alertas_apagadas"
            } else {
                "avisa"
            };
            out.marcas.push(PlanMarca {
                stop_id: t.stop_id,
                sys_id: **sid,
                system: nombre(**sid),
                jumps: d,
                cerca_de,
                cerca_de_name: nombre(cerca_de),
                ts_ms: *ts,
                author: author.clone(),
                message: message.clone(),
                aviso,
            });
            if t.empezado {
                // La clave se apunta aunque no suene (silencio, maestro apagado): mismo criterio que
                // la alerta de tus personajes, para que quitar el silencio no vacíe la noche encima.
                let nueva = alerted.insert(format!("{sid}-{ts}"));
                if nueva && aviso == "avisa" {
                    out.avisar.push(out.marcas.len() - 1);
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Una cadena 1-2-3-…-20. Tú estás en 1; el plan va a 5 (empezado) y luego a 15 (no empezado).
    fn grafo() -> (HashMap<i64, Vec<i64>>, HashMap<i64, String>) {
        let mut adj: HashMap<i64, Vec<i64>> = HashMap::new();
        for i in 1..20 {
            adj.entry(i).or_default().push(i + 1);
            adj.entry(i + 1).or_default().push(i);
        }
        let names = (1..=20).map(|i| (i, format!("S{i}"))).collect();
        (adj, names)
    }

    fn tramos() -> Vec<PlanTramoIntel> {
        vec![
            PlanTramoIntel { stop_id: 100, destino: "S5".into(), sistemas: vec![1, 2, 3, 4, 5], empezado: true },
            PlanTramoIntel { stop_id: 200, destino: "S15".into(), sistemas: (5..=15).collect(), empezado: false },
        ]
    }

    fn rep(items: &[(i64, i64)]) -> HashMap<i64, (i64, String, String)> {
        items.iter().map(|&(s, ts)| (s, (ts, "alguien".to_string(), format!("S{s} +3")))).collect()
    }

    /// La vara de medir, entera: un hostil en el tramo empezado SUENA; uno en el tramo que no has
    /// empezado SE MARCA y no suena; uno lejos de los dos, nada.
    #[test]
    fn marca_siempre_avisa_solo_el_empezado() {
        let (adj, names) = grafo();
        let mut alerted = HashSet::new();
        // 3 está EN el tramo a S5 (y a 2 de S5, que es del segundo). 18 está a 3 de S15. 20, lejos.
        let r = rep(&[(3, 10), (18, 20)]);
        let p = pasada(&adj, &names, &r, &tramos(), 3, &|_| false, true, &mut alerted);

        let a5: Vec<_> = p.marcas.iter().filter(|m| m.stop_id == 100).collect();
        let a15: Vec<_> = p.marcas.iter().filter(|m| m.stop_id == 200).collect();
        assert_eq!(a5.len(), 1, "el hostil de S3 marca el tramo empezado");
        assert_eq!((a5[0].sys_id, a5[0].jumps, a5[0].cerca_de), (3, 0, 3));
        assert_eq!(a5[0].aviso, "avisa");
        // En el segundo tramo caen los dos: S3 a 2 de S5 y S18 a 3 de S15.
        assert_eq!(a15.len(), 2);
        assert!(a15.iter().all(|m| m.aviso == "no_empezado"), "marcado, pero no suena");
        let s18 = a15.iter().find(|m| m.sys_id == 18).unwrap();
        assert_eq!((s18.jumps, s18.cerca_de_name.as_str()), (3, "S15"));

        // Solo suena UNO: el del tramo empezado.
        assert_eq!(p.avisar.len(), 1);
        assert_eq!(p.marcas[p.avisar[0]].stop_id, 100);
        // Y no se apuntó la clave del que no suena: al pulsar «Voy» en ese tramo, sonará.
        assert!(!alerted.contains("18-20"));

        // Segunda pasada con lo mismo: ya sonó, no repite; las marcas siguen ahí.
        let p2 = pasada(&adj, &names, &r, &tramos(), 3, &|_| false, true, &mut alerted);
        assert!(p2.avisar.is_empty());
        assert_eq!(p2.marcas.len(), 3);

        // «▶ Voy» en el segundo tramo: ahora el de S18 sí suena.
        let mut t = tramos();
        t[1].empezado = true;
        let p3 = pasada(&adj, &names, &r, &t, 3, &|_| false, true, &mut alerted);
        assert_eq!(p3.avisar.len(), 1);
        assert_eq!(p3.marcas[p3.avisar[0]].sys_id, 18);
    }

    /// Fuera del radio no se marca nada, y el silencio y el maestro apagado se DICEN.
    #[test]
    fn radio_silencio_y_maestro() {
        let (adj, names) = grafo();
        let mut alerted = HashSet::new();
        // 20 está a 5 de S15: fuera con alert_jumps = 3.
        let p = pasada(&adj, &names, &rep(&[(20, 1)]), &tramos(), 3, &|_| false, true, &mut alerted);
        assert!(p.marcas.is_empty());

        let p = pasada(&adj, &names, &rep(&[(2, 2)]), &tramos(), 3, &|s| s == 2, true, &mut alerted);
        assert_eq!(p.marcas[0].aviso, "silenciado");
        assert!(p.avisar.is_empty());
        assert!(alerted.contains("2-2"), "visto aunque no suene");

        let p = pasada(&adj, &names, &rep(&[(4, 3)]), &tramos(), 3, &|_| false, false, &mut alerted);
        assert_eq!(p.marcas.iter().find(|m| m.stop_id == 100).unwrap().aviso, "alertas_apagadas");
        assert!(p.avisar.is_empty());
    }

    /// Un reporte que YA sonó por estar cerca de tus personajes (su clave en `alerted`) no vuelve a
    /// sonar por estar además en tu camino.
    #[test]
    fn no_suena_dos_veces() {
        let (adj, names) = grafo();
        let mut alerted: HashSet<String> = ["3-10".to_string()].into_iter().collect();
        let p = pasada(&adj, &names, &rep(&[(3, 10)]), &tramos(), 3, &|_| false, true, &mut alerted);
        assert!(p.avisar.is_empty());
        assert!(!p.marcas.is_empty(), "pero se sigue marcando");
    }
}
