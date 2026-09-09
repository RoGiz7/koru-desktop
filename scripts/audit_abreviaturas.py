"""Que ABREVIATURAS de sistema se usan de verdad en tus canales de intel, por frecuencia.

SOLO LEE. Trabaja sobre los chatlogs de EVE, no sobre la base de datos.

POR QUE EXISTE (2026-09-09). El troceador de la app y el vigilante de Rust deberian dar lo mismo
desde el commit c6cfb0e, pero **eso no se ha visto en pantalla**: hace falta un aviso en el que los
dos DIFIERAN, y las lineas normales no valen — un sistema escrito entero y un piloto en mayuscula
los saca cualquiera de los dos. La forma que si distingue es la ABREVIATURA: `ab1` por AB1C-D.

Esperar a que pase es lo que llevamos dias haciendo. Este script le da la vuelta: mira lo que TU
gente escribe de verdad y dice **que palabra vigilar**, cuantas veces sale y cuando se uso la
ultima vez. Con eso se caza en la primera noche en vez de por casualidad.

LA REGLA es la MISMA que `sistemaAbreviado()` en src/intel.ts, copiada a proposito y no reinventada:
un token cuenta como abreviatura si (1) tiene FORMA de sistema de null —lleva digito o guion—,
(2) no es una cantidad tipo `2x`, (3) mide 3+ caracteres, (4) lleva al menos una letra, y (5) **un
unico sistema del mapa empieza por el**. Si dos sistemas comparten el prefijo NO cuenta: mandar a
alguien al sitio equivocado es peor que no decirle nada.

Si esta regla y la de `intel.ts` se separan algun dia, este informe mentira. Es el precio de
medir con una copia; la alternativa —arrancar node para cargar el TS— tarda diez veces mas.

USO:
    python scripts\\audit_abreviaturas.py                     (canal por defecto, enmascarado)
    python scripts\\audit_abreviaturas.py --canal Local
    python scripts\\audit_abreviaturas.py --claro             (SIN enmascarar: solo para TI)
    python scripts\\audit_abreviaturas.py --dias 30

⚠️ POR DEFECTO ENMASCARA los codigos de null. Una cifra de ISK es presumible; una ubicacion es
accionable. Usa `--claro` para leerlo tu en tu maquina, y pega la salida enmascarada si la
compartes. Misma regla que `audit_intel.py`.
"""

import argparse
import collections
import json
import os
import re
import sys

# --- la regla, copiada de src/intel.ts -----------------------------------------------------
FORMA_SISTEMA = re.compile(r"^(?=.*[a-z])(?=.*[\d-])[a-z0-9][a-z0-9-]{2,}$", re.I)
ES_CANTIDAD = re.compile(r"^(?:\d+x|x\d+)$", re.I)
MIN_PREFIJO = 3

# Cabecera de sesion y lineas del sistema: no son intel de nadie.
NO_ES_MENSAJE = ("EVE System", "Sistema EVE")
LINEA = re.compile(r"^\[\s*(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s*\]\s*(.+?)\s*>\s*(.*)$")


def raiz_proyecto() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def carga_sistemas() -> dict:
    """nombre en minusculas -> nombre real. Del mismo neweden.json que usa la app."""
    p = os.path.join(raiz_proyecto(), "public", "neweden.json")
    with open(p, encoding="utf-8") as f:
        d = json.load(f)
    return {s["n"].lower(): s["n"] for s in d["systems"]}


def indice_prefijos(nombres: dict) -> dict:
    """prefijo -> nombre, o None si DOS sistemas lo reclaman. Igual que `prefijosSistema()`."""
    idx: dict = {}
    for lc, real in nombres.items():
        for k in range(MIN_PREFIJO, len(lc)):
            pre = lc[:k]
            idx[pre] = None if pre in idx else real
    return idx


def lee_log(ruta: str):
    """Devuelve (fecha, autor, mensaje) por linea. UTF-16 con BOM POR LINEA — el `strip()` a secas
    NO se lleva el \\ufeff y por eso una version anterior de otro script dio 868 ficheros por
    vacios. Se quita explicitamente."""
    try:
        raw = open(ruta, "rb").read()
    except OSError:
        return
    for enc in ("utf-16", "utf-8-sig", "utf-8"):
        try:
            txt = raw.decode(enc)
            break
        except (UnicodeDecodeError, UnicodeError):
            continue
    else:
        return
    for linea in txt.splitlines():
        m = LINEA.match(linea.replace("﻿", "").strip())
        if not m:
            continue
        autor = m.group(7)
        if autor in NO_ES_MENSAJE:
            continue
        yield f"{m.group(1)}-{m.group(2)}-{m.group(3)}", autor, m.group(8)


def enmascara(s: str) -> str:
    """Un codigo de null es accionable. Se tapa el patron LETRA/DIGITO-GUION-LETRA/DIGITO."""
    return re.sub(r"\b[A-Z0-9]{1,4}-[A-Z0-9]{1,4}\b", "XXX-XX", s, flags=re.I)


def main() -> int:
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--canal", default="fareast.imperium", help="prefijo del nombre del fichero")
    ap.add_argument("--dias", type=int, default=0, help="solo los ultimos N dias (0 = todo)")
    ap.add_argument("--claro", action="store_true", help="NO enmascarar (solo para tu maquina)")
    ap.add_argument("--logs", default="", help="carpeta de Chatlogs si no es la de documentacion")
    a = ap.parse_args()

    carpeta = a.logs or os.path.join(raiz_proyecto(), "..", "documentacion", "logs", "Chatlogs")
    carpeta = os.path.abspath(carpeta)
    if not os.path.isdir(carpeta):
        print(f"No encuentro los chatlogs en:\n  {carpeta}\n")
        print("Pasa la carpeta con --logs, p. ej. tu carpeta de EVE:")
        print(r'  --logs "%USERPROFILE%\Documents\EVE\logs\Chatlogs"')
        return 1

    ficheros = [f for f in os.listdir(carpeta) if f.startswith(a.canal) and f.endswith(".txt")]
    if not ficheros:
        canales = sorted({re.sub(r"_\d{8}_\d+.*", "", f) for f in os.listdir(carpeta)})
        print(f"Ningun fichero empieza por «{a.canal}». Canales que veo:\n")
        for c in canales:
            print("   ", c)
        return 1

    nombres = carga_sistemas()
    prefijos = indice_prefijos(nombres)

    corte = ""
    if a.dias > 0:
        import datetime

        corte = (datetime.date.today() - datetime.timedelta(days=a.dias)).isoformat()

    # abreviatura -> [veces, sistema, primera fecha, ultima fecha, ejemplo de linea]
    hallazgos: dict = {}
    lineas = 0
    con_sistema_entero = 0
    for f in ficheros:
        for fecha, _autor, msg in lee_log(os.path.join(carpeta, f)):
            if corte and fecha < corte:
                continue
            lineas += 1
            entero = False
            for tok in re.findall(r"[A-Za-z0-9][A-Za-z0-9-]*", msg):
                lc = tok.lower()
                if lc in nombres:
                    entero = True
                    continue
                if not FORMA_SISTEMA.match(tok) or ES_CANTIDAD.match(tok):
                    continue
                sis = prefijos.get(lc)
                if sis is None:
                    continue
                h = hallazgos.setdefault(lc, [0, sis, fecha, fecha, msg])
                h[0] += 1
                h[2] = min(h[2], fecha)
                h[3] = max(h[3], fecha)
                if fecha >= h[3]:
                    h[4] = msg
            if entero:
                con_sistema_entero += 1

    def m(s: str) -> str:
        return s if a.claro else enmascara(s)

    print(f"Canal        : {a.canal}  ({len(ficheros)} ficheros)")
    print(f"Lineas leidas: {lineas:,}" + (f"  (ultimos {a.dias} dias)" if a.dias else ""))
    print(f"Con un sistema escrito ENTERO: {con_sistema_entero:,}")
    if not a.claro:
        print("Enmascarado. Usa --claro para verlo tal cual EN TU MAQUINA.")
    print()

    if not hallazgos:
        print("Ninguna abreviatura. O el canal no es de intel, o aqui se escribe todo entero.")
        return 0

    total = sum(h[0] for h in hallazgos.values())
    print(f"ABREVIATURAS QUE USA TU GENTE — {len(hallazgos)} distintas, {total:,} apariciones\n")
    print(f"  {'veces':>7}  {'abreviatura':<14} {'es':<18} {'ultima vez':<12}")
    print(f"  {'-'*7}  {'-'*14} {'-'*18} {'-'*12}")
    for lc, (n, sis, _pri, ult, _ej) in sorted(hallazgos.items(), key=lambda x: -x[1][0])[:25]:
        print(f"  {n:>7,}  {m(lc):<14} {m(sis):<18} {ult:<12}")

    print("\nLA QUE HAY QUE VIGILAR es la de arriba: cuando alguien la escriba, mira si el OVERLAY")
    print("dice lo mismo que el mapa. Si el mapa saca el nombre largo y el overlay se queda con la")
    print("abreviatura, el evento `intel-parse` no esta llegando (mirar `capabilities/`).")
    ej = sorted(hallazgos.items(), key=lambda x: -x[1][0])[0]
    print(f"\nUltima linea real con «{m(ej[0])}»:\n   {m(ej[1][4])[:150]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
