#!/usr/bin/env python3
"""Que ocupa la base de datos de Koru, tabla por tabla.

# Por que existe (2026-09-08)

Al proponer guardar las lineas de intel en la base de datos (`intel_line`), el pregunto lo unico
sensato: *«¿esto puede hacer que la DB nos crezca demasiado? ¿no seria mejor una aparte?»*.

Yo puedo estimar que una linea son ~100 bytes y que 400.000 lineas son ~40 MB. Pero **esa cifra no
significa nada sola**: 40 MB es enorme si la base de datos pesa 12, e irrelevante si ya pesa 400.
La decision no se toma con mi estimacion, se toma comparando contra lo que ya hay.

Asi que esto no adivina: lee el tamaño REAL de cada tabla y de sus indices.

⚠️ Solo LEE (`mode=ro`). No imprime ni un dato de juego: solo nombres de tabla y cifras.

Uso: python scripts/diag_tamano_bd.py
     python scripts/diag_tamano_bd.py "C:\\otra\\ruta\\koru-desktop.sqlite3"
"""
import os
import sqlite3
import sys

FICHERO = "koru-desktop.sqlite3"
# La carpeta nueva primero: la mudanza de la v0.49.0 manda en cuanto exista.
CARPETAS = ["koru-desktop", "com.rekium.korudesktop"]


def ruta_bd() -> str:
    if len(sys.argv) > 1:
        return sys.argv[1]
    appdata = os.environ.get("APPDATA", "")
    for c in CARPETAS:
        p = os.path.join(appdata, c, FICHERO)
        if os.path.isfile(p):
            return p
    return os.path.join(appdata, CARPETAS[0], FICHERO)


def mb(n: float) -> str:
    return f"{n / 1e6:>8.1f} MB"


def main() -> int:
    ruta = ruta_bd()
    if not os.path.isfile(ruta):
        print(f"No encuentro la base de datos en:\n  {ruta}")
        print('\nBuscala con:  Get-ChildItem "$env:APPDATA" -Recurse -Filter "koru-desktop.sqlite3"')
        return 1
    tam = os.path.getsize(ruta)
    print(f"Base de datos: {ruta}")
    print(f"Tamaño del fichero: {mb(tam)}\n")
    db = sqlite3.connect(f"file:{ruta}?mode=ro", uri=True)

    filas = {t: db.execute(f"SELECT COUNT(*) FROM '{t}'").fetchone()[0]
             for (t,) in db.execute(
                 "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}

    # `dbstat` da el tamaño de verdad, pagina a pagina. No siempre esta compilado; si falta, se
    # estima con el largo de los datos — y se DICE que es una estimacion, no se disimula.
    exacto = True
    tabla_bytes: dict = {}
    try:
        for nombre, pgs in db.execute(
                "SELECT name, SUM(pgsize) FROM dbstat GROUP BY name"):
            tabla_bytes[nombre] = pgs or 0
    except sqlite3.Error:
        exacto = False
        for t, n in filas.items():
            if n == 0:
                tabla_bytes[t] = 0
                continue
            cols = [r[1] for r in db.execute(f"PRAGMA table_info('{t}')")]
            expr = " + ".join(f"COALESCE(LENGTH(CAST(\"{c}\" AS BLOB)), 0)" for c in cols) or "0"
            try:
                tabla_bytes[t] = db.execute(f"SELECT SUM({expr}) FROM '{t}'").fetchone()[0] or 0
            except sqlite3.Error:
                tabla_bytes[t] = 0

    # Los indices se suman a su tabla: ocupan disco igual, y al decidir «¿cabe intel_line?» lo que
    # importa es el coste TOTAL de guardar algo, no solo el de los datos.
    indices = {}
    if exacto:
        for idx, tbl in db.execute(
                "SELECT name, tbl_name FROM sqlite_master WHERE type='index'"):
            if idx in tabla_bytes:
                indices[tbl] = indices.get(tbl, 0) + tabla_bytes.pop(idx)

    orden = sorted(
        ((t, tabla_bytes.get(t, 0), indices.get(t, 0), filas.get(t, 0)) for t in filas),
        key=lambda x: -(x[1] + x[2]))

    print("MEDIDO CON dbstat (tamaño real en disco)" if exacto
          else "⚠️ ESTIMADO: sin dbstat en este Python. Cuenta el largo de los datos, sin\n"
               "   contar indices ni el hueco de las paginas. El fichero real es MAYOR.")
    print()
    print(f"  {'tabla':<26} {'filas':>10} {'datos':>11} {'indices':>11} {'total':>11}   {'%':>5}")
    suma = sum(a + b for _, a, b, _ in orden) or 1
    for t, datos, idx, n in orden[:22]:
        tot = datos + idx
        if tot == 0 and n == 0:
            continue
        print(f"  {t[:26]:<26} {n:>10,} {mb(datos)} {mb(idx)} {mb(tot)}   {100*tot/suma:>4.1f}%")
    resto = sum(a + b for _, a, b, _ in orden[22:])
    if resto:
        print(f"  {'(las demas)':<26} {'':>10} {'':>11} {'':>11} {mb(resto)}")
    print()
    print(f"  {'SUMA':<26} {'':>10} {'':>11} {'':>11} {mb(suma)}")
    print()
    # ⚠️ `intel_line` SIEMPRE se nombra, exista o no y tenga o no filas. La lista de arriba se salta
    # las tablas vacias, asi que «no aparece» se leia igual que «no existe» — y con esa ambigüedad
    # no se puede diagnosticar nada. Una tabla recien creada esta vacia por definicion.
    hay = "intel_line" in filas
    print("--- estado de intel_line ---")
    if not hay:
        print("  ❌ LA TABLA NO EXISTE. El Koru que escribe en esta base de datos no lleva el")
        print("     esquema nuevo: se crea sola al arrancar, asi que es que corre una build vieja.")
    else:
        n = filas["intel_line"]
        print(f"  ✅ existe · {n:,} lineas guardadas")
        if n == 0:
            print("     Vacia: la tabla esta creada pero nadie escribe. Mira la consola de Koru")
            print("     (F12) buscando «[intel_line]».")
    print()
    print("--- la pregunta: ¿cabe intel_line? ---")
    print("  Una linea de intel ocupa ~100 B. Con el numero de lineas que saque")
    print("  `diag_intel_urls.py --todos`, comparalo con la columna 'total' de arriba.")
    print("  Referencia rapida:  100.000 lineas ~ 10 MB   ·   1.000.000 ~ 100 MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
