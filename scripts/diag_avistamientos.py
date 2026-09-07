"""De dónde sale el hueco entre «menciones» (name_cache.seen_count) y «avistamientos»
(filas de intel_sightings), y si la simultaneidad se puede medir sin inventarla.

Lo escribí el 2026-09-07 porque en la ficha del Cazador la lista decía «Lord Road x186» y su KPI
«156 avistamientos», y las dos cosas se leen como «cuantas veces le he visto». Antes de ponerle
una etiqueta nueva a ninguno de los dos, hay que saber QUE es el hueco: si son lineas sin sistema
no significa nada tactico, y si son reportes simultaneos si.

SOLO LEE. No escribe en la base de datos. Abre en modo lectura por si Koru esta arrancado.

    python scripts\\diag_avistamientos.py
    python scripts\\diag_avistamientos.py "C:\\otra\\ruta\\koru-desktop.sqlite3"
"""

import os
import sqlite3
import sys

# ⚠️ 60 s, no 5 min. La primera version usaba cubos de 5 minutos y daba como «pico» a un piloto
# reportado una vez por minuto — eso no es una banda cantandole a la vez, es alguien ahi parado.
# Un pico es una RAFAGA: varias voces encima. La ventana tiene que ser corta o la señal se
# confunde con la permanencia, que es justo lo contrario de lo que se quiere medir.
VENTANA_S = 60


def ruta_por_defecto() -> str:
    appdata = os.environ.get("APPDATA", "")
    return os.path.join(appdata, "com.rekium.korudesktop", "koru-desktop.sqlite3")


def main() -> int:
    ruta = sys.argv[1] if len(sys.argv) > 1 else ruta_por_defecto()
    if not os.path.exists(ruta):
        print(f"No encuentro la base de datos en:\n  {ruta}\n")
        print("Pasa la ruta como argumento. Para localizarla:")
        print('  Get-ChildItem "$env:APPDATA" -Filter "*korudesktop*"')
        return 1

    # Solo lectura: si Koru esta abierto, que no toquemos nada suyo.
    db = sqlite3.connect(f"file:{ruta}?mode=ro", uri=True)
    print(f"BD: {ruta}\n")

    tot_men, tot_avi = db.execute(
        "SELECT (SELECT SUM(seen_count) FROM name_cache),"
        "       (SELECT COUNT(*) FROM intel_sightings)"
    ).fetchone()
    print(f"TOTAL menciones {tot_men or 0}  ·  avistamientos {tot_avi or 0}")
    if tot_men:
        print(f"       hueco global: {(tot_men or 0) - (tot_avi or 0)}"
              f"  ({100 * (1 - (tot_avi or 0) / tot_men):.0f} % de las menciones no llegan a avistamiento)\n")

    print("--- Los 15 mas mencionados: menciones vs avistamientos ---")
    filas = db.execute(
        """SELECT n.name_lower, n.seen_count,
                  (SELECT COUNT(*) FROM intel_sightings s WHERE s.name_lower = n.name_lower)
           FROM name_cache n
           WHERE n.seen_count > 20
           ORDER BY n.seen_count DESC LIMIT 15"""
    ).fetchall()
    print(f"{'piloto':<24}{'menc.':>7}{'avist.':>8}{'hueco':>7}{'ratio':>8}")
    for nombre, menc, avi in filas:
        ratio = f"{menc / avi:.2f}x" if avi else "—"
        print(f"{nombre[:23]:<24}{menc:>7}{avi:>8}{menc - avi:>7}{ratio:>8}")

    # ¿El hueco es constante? Si lo es, es una causa sistematica (lineas sin sistema).
    # Si baila mucho, depende del piloto y hay que mirar caso a caso.
    ratios = [m / a for _, m, a in filas if a]
    if len(ratios) > 2:
        ratios.sort()
        print(f"\nratio menciones/avistamientos: min {ratios[0]:.2f}x · "
              f"mediana {ratios[len(ratios) // 2]:.2f}x · max {ratios[-1]:.2f}x")
        print("   (constante = causa sistematica · disperso = depende de como le canten)")

    # ★ LA PREGUNTA DE VERDAD: la simultaneidad, medida sobre la tabla BUENA.
    # Reportes del MISMO piloto en el MISMO sistema dentro de una ventana corta. Como la hora de
    # la linea tiene precision de segundo, dos personas distintas cantando casi nunca colisionan:
    # cada una deja su fila. Si esto sale con numeros, la urgencia se puede medir sin tocar nada.
    # Ventana DESLIZANTE, no cubos fijos: se cuenta, para cada reporte, cuantos hay del mismo
    # piloto y sistema en los VENTANA_S segundos siguientes, y se guarda la rafaga mas densa de
    # cada piloto. Con cubos fijos una rafaga partida por el borde del cubo se cuenta a la mitad.
    print(f"\n--- Rafagas: mas reportes del mismo piloto/sistema en {VENTANA_S} s ---")
    picos = db.execute(
        # Sin columna de segundos a proposito: la ventana ya dice «en <= VENTANA_S s», y sacar el
        # lapso exacto de la ventana ganadora exigia otra pasada. Un numero de relleno mal cogido
        # (salia 0 s, que era la ULTIMA ventana y no la del pico) es peor que no ponerlo.
        """SELECT name_lower, system_id, MAX(n) AS pico FROM (
             SELECT a.name_lower, a.system_id, COUNT(*) AS n
               FROM intel_sightings a
               JOIN intel_sightings b
                 ON b.name_lower = a.name_lower AND b.system_id = a.system_id
                AND b.ts_ms >= a.ts_ms AND b.ts_ms < a.ts_ms + ? * 1000
              GROUP BY a.name_lower, a.system_id, a.ts_ms)
           GROUP BY name_lower, system_id
           HAVING pico >= 3
           ORDER BY pico DESC LIMIT 12""",
        (VENTANA_S,),
    ).fetchall()
    if not picos:
        print(f"  Ninguna con 3 o mas en {VENTANA_S} s.")
        print("  ➡️ La simultaneidad NO da señal con estos datos: no se puede pintar urgencia con esto.")
    else:
        print(f"{'piloto':<24}{'sistema':>10}{'rafaga (<=' + str(VENTANA_S) + 's)':>16}")
        for nombre, sid, n in picos:
            print(f"{nombre[:23]:<24}{sid:>10}{n:>16}")

    # ★ BASURA DEMOSTRADA, no sospechada: character_id = -1 es la marca de que ESI contesto que
    # ese nombre NO EXISTE (`name_cache_put_negative`). Un nombre con muchas menciones y un -1 es
    # un trozo de linea que se ha estado colando como hostil en la lista del Cazador.
    # ⚠️ CON FECHA, y la fecha es lo que decide que hacer. `last_seen` dice si esa basura SIGUE
    # entrando o es un poso de versiones viejas: el criterio «un nombre de piloto empieza por
    # mayuscula» se añadio despues de que se acumulara mucho de esto, y name_cache esta en las
    # excepciones del borrado, asi que no se limpia sola nunca. Sin la fecha, un mismo listado
    # justifica dos arreglos opuestos: tocar el troceador (si entra hoy) o limpiar (si es poso).
    print("\n--- Nombres que ESI dice que NO EXISTEN (y aun asi se cuentan) ---")
    fake = db.execute(
        """SELECT name_lower, seen_count, COALESCE(substr(last_seen,1,10),'?') FROM name_cache
            WHERE character_id = -1 AND seen_count >= 10
            ORDER BY seen_count DESC LIMIT 20"""
    ).fetchall()
    if not fake:
        print("  Ninguno con 10 o mas menciones.")
    else:
        print(f"  {'nombre':<30}{'menc.':>7}   ultima vez")
        for nombre, n, cuando in fake:
            print(f"  {nombre[:29]:<30}{n:>7}   {cuando}")
    recientes = db.execute(
        """SELECT COUNT(*) FROM name_cache
            WHERE character_id = -1 AND last_seen >= date('now','-7 day')"""
    ).fetchone()[0]
    print(f"  ➡️ inexistentes vistos en los ULTIMOS 7 DIAS: {recientes}")
    print("     (0 = es poso viejo, toca LIMPIAR · >0 = sigue entrando, toca el TROCEADOR)")
    n_fake, m_fake = db.execute(
        "SELECT COUNT(*), COALESCE(SUM(seen_count),0) FROM name_cache WHERE character_id = -1"
    ).fetchone()
    print(f"  total: {n_fake} nombres inexistentes, {m_fake} menciones suyas")

    # ¿Se puede descartar por LONGITUD? EVE no deja nombres de personaje de 1-2 caracteres, asi
    # que `i`, `v`, `d`, `+` no pueden ser nadie. Pero eso NO se afirma de memoria: se comprueba
    # contra los nombres que ESI SI resolvio en esta misma base de datos. Si aparece aunque sea uno
    # corto y real, la regla se cae y no se implementa.
    corto_real = db.execute(
        """SELECT name_lower, character_id FROM name_cache
            WHERE character_id > 0 AND length(name_lower) < 3 LIMIT 5"""
    ).fetchall()
    corto_falso = db.execute(
        "SELECT COUNT(*) FROM name_cache WHERE character_id = -1 AND length(name_lower) < 3"
    ).fetchone()[0]
    resueltos = db.execute(
        "SELECT COUNT(*) FROM name_cache WHERE character_id > 0"
    ).fetchone()[0]
    print(f"\n--- ¿Vale la regla «menos de 3 letras no es nadie»? ---")
    print(f"  nombres REALES resueltos por ESI: {resueltos}")
    if corto_real:
        print(f"  ❌ LA REGLA SE CAE, hay reales de 1-2 letras: {corto_real}")
    else:
        print(f"  ✅ ninguno de 1-2 letras entre los reales · y descartaria {corto_falso} inexistentes")

    # Los que NADIE ha preguntado todavia: sin resolver y por debajo del umbral, o en cola.
    sin_preguntar = db.execute(
        "SELECT COUNT(*) FROM name_cache WHERE character_id IS NULL"
    ).fetchone()[0]
    print(f"  sin resolver aun (nunca preguntados a ESI): {sin_preguntar} nombres")

    # Cuantos avistamientos NO tienen character_id: son los que no se pueden cruzar con killmails.
    sin_id = db.execute(
        "SELECT COUNT(*) FROM intel_sightings WHERE character_id IS NULL"
    ).fetchone()[0]
    print(f"\navistamientos sin character_id resuelto: {sin_id} de {tot_avi or 0}")
    db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
