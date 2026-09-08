#!/usr/bin/env python3
"""¿POR QUE SALEN DOS VECES ALGUNAS LINEAS DE INTEL? (2026-09-08)

# El reporte

RoGiz7, con capturas del feed en vivo: *«los nv lanza dos mensajes»*. En la captura, la MISMA linea
aparece dos veces con **un segundo de diferencia** («hace 38s» y «hace 39s»), y las dos que se
duplican terminan en `nv`.

# La hipotesis, y por que hay que medirla antes de tocar nada

El dedup del intel en vivo (`collect_intel_ext`, commands.rs) usa:

    let key = (l.ts_ms / 1000, l.author.clone(), l.message.clone());

Divide por 1000, asi que **solo funde lineas que caigan en el MISMO segundo**. Con multibox hay un
log por cliente y cada uno escribe la hora a la que ESE cliente recibio el mensaje: si el mensaje
cae a caballo de un segundo, dos clientes lo fechan distinto y el dedup no lo ve.

⚠️ Si eso es todo, **`nv` no tiene nada que ver** y la correlacion que vio es casualidad de dos
casos. Pero eso no se decide mirando dos capturas: se cuenta. Aqui esta el grupo de control —
¿que porcentaje de las lineas CON `nv` se duplican, frente a las que no lo llevan?

Tres teorias falsas nos costaron dos sesiones con el bug de los dos canales del overlay. Esta vez,
la cuenta primero.

⚠️ Solo LEE (`mode=ro`). Enmascara los codigos de null antes de imprimir.

Uso: python scripts/diag_intel_duplicados.py
     python scripts/diag_intel_duplicados.py --ventana 5    (segundos de margen, por defecto 3)
"""
import os
import sqlite3
import sys
from collections import defaultdict

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
from audit_intel import enmascarar, ruta_bd  # noqa: E402

VENTANA = 3
if "--ventana" in sys.argv:
    VENTANA = int(sys.argv[sys.argv.index("--ventana") + 1])

# ★★ HASTA DONDE MIRAR PARA EL HISTOGRAMA (2026-09-08). Medido el reparto con VENTANA=3, salio
#    97,8 % a 1 segundo exacto. Eso ya apunta al multibox, pero **no basta para elegir la ventana
#    del arreglo**: hace falta saber como se reparte una repeticion HUMANA, que es lo que NO hay que
#    fundir (su regla: «un aviso por reporte aunque se repita» — para eso existe el `nv`).
#
#    Si a 1 s hay un pico y de 2 s en adelante sale una cola plana, entonces el pico es la maquina y
#    la cola son personas: la ventana va justo detras del pico. Si no hay pico, mi teoria se cae.
HASTA = 60


def main() -> int:
    ruta = ruta_bd()
    if not os.path.isfile(ruta):
        print(f"No encuentro la base de datos en:\n  {ruta}")
        return 1
    db = sqlite3.connect(f"file:{ruta}?mode=ro", uri=True)
    n = db.execute("SELECT COUNT(*) FROM intel_line").fetchone()[0]
    print(f"Base de datos: {ruta}")
    print(f"Lineas guardadas: {n:,}\n")

    # (canal, autor, texto) -> lista de ts_ms. Si el mismo texto del mismo autor en el mismo canal
    # aparece con ts DISTINTOS pero muy juntos, es la misma frase fechada dos veces.
    grupos = defaultdict(list)
    for canal, ts, autor, texto in db.execute(
        "SELECT canal, ts_ms, autor, texto FROM intel_line ORDER BY ts_ms"
    ):
        grupos[(canal, autor, texto)].append(ts)

    tope = VENTANA * 1000
    dup_lineas = 0          # copias de mas (no la primera)
    dup_grupos = 0
    con_nv = {"total": 0, "dup": 0}
    sin_nv = {"total": 0, "dup": 0}
    reparto = defaultdict(int)   # diferencia en segundos -> veces
    # ★ El histograma largo va sobre TODAS las repeticiones, no solo las de la ventana: es lo unico
    #   que separa «la maquina fecho lo mismo dos veces» de «una persona lo repitio».
    histo = defaultdict(int)
    histo_largas = defaultdict(int)   # solo mensajes de 12+ caracteres (dificiles de repetir a mano)
    ejemplos = []

    for (canal, autor, texto), tss in grupos.items():
        # ¿lleva `nv` como palabra suelta? Es la marca de «han vuelto a aparecer», dicha por el.
        es_nv = f" nv" in f" {texto.lower()} " or texto.lower().endswith(" nv")
        caja = con_nv if es_nv else sin_nv
        caja["total"] += 1
        if len(tss) < 2:
            continue
        tss.sort()
        copias = 0
        largo = len(texto.strip()) >= 12
        for a, b in zip(tss, tss[1:]):
            d = b - a
            s = round(d / 1000)
            if 0 < d <= HASTA * 1000:
                histo[s] += 1
                if largo:
                    histo_largas[s] += 1
            if 0 < d <= tope:
                copias += 1
                reparto[s] += 1
        if copias:
            dup_grupos += 1
            dup_lineas += copias
            caja["dup"] += 1
            if len(ejemplos) < 25:
                ejemplos.append((autor, texto, [t % 100000 for t in tss[:4]], copias))

    print("=" * 74)
    print(f"LINEAS FECHADAS DOS VECES  (mismo canal, autor y texto, a menos de {VENTANA} s)")
    print("=" * 74)
    print(f"  frases distintas afectadas      {dup_grupos:>10,}")
    print(f"  copias de mas en la base        {dup_lineas:>10,}")
    print(f"  sobre {n:,} lineas               {100*dup_lineas/(n or 1):>9.2f} %")
    print("\n  Diferencia entre copias:")
    for s in sorted(reparto):
        print(f"    {s} s  ->  {reparto[s]:,}")
    print("  ^ Si casi todo esta en 1 s, el culpable es el dedup por segundo entero:")
    print("    `l.ts_ms / 1000` solo funde lo que cae en el MISMO segundo, y con multibox cada")
    print("    cliente fecha el mensaje cuando EL lo recibio.")

    print("\n" + "=" * 74)
    print(f"¿DONDE PONER LA VENTANA?  —  repeticiones hasta {HASTA} s")
    print("=" * 74)
    print("  Un PICO en 1 s con cola plana detras = la maquina fecho lo mismo dos veces (multibox).")
    print("  La cola son PERSONAS repitiendo, y esas NO se pueden fundir: para eso existe el `nv`.")
    print("  La columna 'largas' (mensajes de 12+ caracteres) es el control: nadie reteclea eso")
    print("  identico en un segundo, asi que ahi el pico solo puede ser la maquina.")
    print(f"\n  {'seg':>4} {'todas':>9} {'largas':>9}")
    tot = sum(histo.values()) or 1
    for s in range(1, 11):
        barra = "#" * min(60, round(60 * histo.get(s, 0) / max(histo.values() or [1])))
        print(f"  {s:>4} {histo.get(s,0):>9,} {histo_largas.get(s,0):>9,}  {barra}")
    resto = sum(v for k, v in histo.items() if k > 10)
    resto_l = sum(v for k, v in histo_largas.items() if k > 10)
    print(f"  11-{HASTA} {resto:>9,} {resto_l:>9,}")
    med = (sum(v for k, v in histo.items() if 2 <= k <= HASTA) / max(1, HASTA - 1))
    print(f"\n  Media por segundo de 2 s en adelante: {med:,.0f}")
    print(f"  A 1 s hay {histo.get(1,0):,}  ->  {histo.get(1,0)/max(med,1):.0f}x la cola.")
    print("  Si ese multiplicador es grande, el pico NO son personas y la ventana de 1 s basta.")

    print("\n" + "=" * 74)
    print("¿ES COSA DE `nv`?  — EL GRUPO DE CONTROL")
    print("=" * 74)
    print(f"  {'grupo':<28} {'frases':>10} {'duplicadas':>12} {'%':>8}")
    for etq, c in [("lineas CON `nv`", con_nv), ("lineas SIN `nv` (control)", sin_nv)]:
        pct = 100 * c["dup"] / (c["total"] or 1)
        print(f"  {etq:<28} {c['total']:>10,} {c['dup']:>12,} {pct:>7.2f} %")
    print("\n  Si los dos porcentajes se parecen, `nv` NO tiene nada que ver: se duplica todo por")
    print("  igual y lo que vio fueron dos casos seguidos. Si el de `nv` es MUCHO mayor, entonces")
    print("  hay un mecanismo propio y hay que buscarlo — pero entonces lo dice el dato, no yo.")

    if ejemplos:
        print("\n" + "=" * 74)
        print("EJEMPLOS  (ts recortado a los ultimos 5 digitos, solo para ver la diferencia)")
        print("=" * 74)
        for autor, texto, tss, copias in ejemplos:
            print(f"  x{copias}  {enmascarar(autor)[:18]:<18} {tss}  {enmascarar(texto)[:60]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
