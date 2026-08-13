#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Revisa los TEXTOS PÚBLICOS en busca de datos que no deberían salir del repo.

POR QUÉ EXISTE
--------------
La regla («los textos públicos no llevan sistemas, pilotos, corps ni fechas de mis logs») existía
desde hace tiempo y aun así se coló: el changelog in-app publicado lleva un sistema de nullsec y un
nombre de personaje de entradas antiguas. Una regla que solo vive en la cabeza de alguien se salta
sola el día que hay prisa. Esto la convierte en un paso mecánico.

QUÉ MIRA, Y QUÉ NO PUEDE MIRAR
------------------------------
· **Códigos de sistema de nullsec** (`XXX-NNN`, `X-NNNN`…): esto SÍ se detecta solo, porque tienen
  una forma reconocible. Es además lo más grave — una cifra de ISK es presumible, una ubicación es
  accionable.
· **Nombres de piloto y de corp NO se pueden detectar por patrón**: son palabras normales. El
  script no los busca, y decir lo contrario daría una falsa sensación de seguridad. Para eso está
  la lectura a ojo antes de publicar.

⚠️ Este fichero va al repo, así que NO puede contener ningún nombre real ni ningún sistema suyo:
sería exactamente la fuga que viene a evitar. Solo lleva patrones.

USO
---
    python scripts/check_privacidad.py
    python scripts/check_privacidad.py ../notas-release-v0.45.0.md

Sale con código 1 si encuentra algo, para poder encadenarlo a un paso de release.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent

# Textos que SALEN del repo o se publican. Añadir aquí cualquier fichero público nuevo.
POR_DEFECTO = [
    RAIZ / "src" / "changelog.ts",
    RAIZ / "README.md",
    RAIZ / "README.es.md",
]

# Un código de sistema de nullsec: letras/números, guion, letras/números. `4-CM8I`, `PS-94K`, `C-J6MT`.
SISTEMA = re.compile(r"\b[A-Z0-9]{1,4}-[A-Z0-9]{2,5}\b")

# Falsos positivos con la misma forma. Se listan a propósito en vez de aflojar el patrón: aflojarlo
# dejaría pasar sistemas de verdad, y aquí preferimos ruido a un silencio tranquilizador.
PERMITIDOS = {
    "UTF-8", "ISO-8601", "RFC-3339", "T2-T3", "X11", "P0-P4", "T1-T6", "N1-N4",
    "WCAG-AA", "MIT-0", "SHA-256", "AES-256", "UTC-0",
}
FECHA = re.compile(r"^\d{4}-\d{2}$|^\d{2}-\d{2}$")


def revisar(ruta: Path) -> list[tuple[int, str, str]]:
    if not ruta.exists():
        return []
    hallazgos = []
    for n, linea in enumerate(ruta.read_text(encoding="utf-8").splitlines(), 1):
        for m in SISTEMA.findall(linea):
            if m in PERMITIDOS or FECHA.match(m):
                continue
            hallazgos.append((n, m, linea.strip()[:120]))
    return hallazgos


def main() -> int:
    objetivos = [Path(a) for a in sys.argv[1:]] or POR_DEFECTO
    total = 0
    for f in objetivos:
        for n, hallazgo, linea in revisar(f):
            total += 1
            print(f"⚠️  {f.name}:{n}  «{hallazgo}»  →  {linea}")
    if total:
        print(f"\n{total} posible(s) sistema(s) en texto público. Revisar UNO A UNO: puede haber")
        print("falsos positivos, pero un sistema de nullsec de verdad no puede publicarse.")
        return 1
    print("Sin códigos de sistema en los textos públicos revisados.")
    print("⚠️  Los nombres de piloto y de corp NO se detectan por patrón: leerlos a ojo.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
