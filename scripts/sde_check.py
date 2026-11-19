#!/usr/bin/env python3
# GUARDIÁN DEL SDE — compara lo que Koru tiene GENERADO contra lo que el SDE publica ahora, y dice
# SOLO lo que hay que regenerar. No toca Koru ni escribe en public/: imprime una tabla y devuelve
# un código de salida, así que sirve igual a mano que como puerta antes de integrar.
#
#   python scripts/sde_check.py                   → qué ha cambiado desde nuestra base
#   python scripts/sde_check.py --guardar-base    → DESPUÉS de integrar y probar: fija la base
#   python scripts/sde_check.py --indice i.json --changelog c.jsonl   → sin red (pruebas)
#
# POR QUÉ EXISTE: hasta la 0.57.0, auditar un SDE era que alguien leyera una web a mano. El 19-11
# eso ya había fallado sin que nos enterásemos: el build 3693310 borró `blueprints.blueprintTypeID`
# y `extract_industry_sde.py` habría muerto con KeyError a mitad de una regeneración de 22 scripts.
# Un cambio así NO aparece en el diff de datos, porque no es un dato que cambie: es una forma.
#
# DOS COSAS DEL SDE NUEVO QUE OBLIGAN A ESTE DISEÑO:
#   1. Solo se conservan la release ACTUAL y la ANTERIOR, así que los diffs de datos de builds
#      viejos ya no existen y encadenar `changes/<build>.jsonl` hacia atrás dejó de funcionar.
#      Pero `_schemaChangelog` es ACUMULATIVO (guarda desde septiembre de 2025) y va por
#      `afterBuildNumber`, así que el hueco histórico sí se puede auditar. De ahí que el aviso de
#      esquema no necesite tener la base puesta.
#   2. Los números de build YA NO SON ÚNICOS — lo dice FC. La identidad de una release es su marca
#      de tiempo (`release`). La base guarda las dos y compara por `release`.
#
# ⚠️ EL MAPA extractor → tablas SE DERIVA DEL PROPIO CÓDIGO (los `"X.jsonl"` literales de cada
# script), nunca se escribe a mano. Un mapa a mano se queda viejo y miente justo el día que importa,
# que es exactamente cómo se nos colaron las naves que faltaban en su momento.
#
# ⚠️ NO se deriva qué FICHERO de public/ produce cada extractor, y es a propósito: de los 22
# scripts solo 3 usan el idioma `public / "x.json"`; el resto escriben con constantes propias
# (OUT, SALIDA, out_asm) y tres dialectos distintos, y un grep de literales `"x.json"` confunde
# ENTRADAS con salidas (extract_places_i18n *lee* neweden.json, no lo escribe). Una lista
# incompleta que parece completa es peor que no darla: la unidad accionable es qué extractor hay
# que volver a correr, y el orden de regeneración vive en el checklist de release.
#
# ⚠️ TODO llega comprimido: FC dice «files are always sent gzip-compressed» y lo manda aunque no lo
# pidas, así que hay que descomprimir a mano. Sin eso, json.loads recibe binario y el error no se
# parece en nada a la causa.
import argparse
import gzip
import io
import json
import re
import sys
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SCRIPTS = RAIZ / "scripts"
BASE = SCRIPTS / "sde_base.json"
URL_INDICE = "https://sde.evetech.net/tranquility/latest/"

RE_TABLA = re.compile(r'"([A-Za-z][A-Za-z0-9]*)\.jsonl"')


def baja(url: str) -> bytes:
    pet = urllib.request.Request(url, headers={"User-Agent": "koru-desktop sde_check (RoGiz7)"})
    with urllib.request.urlopen(pet, timeout=60) as r:
        datos = r.read()
        if r.headers.get("Content-Encoding") == "gzip" or datos[:2] == b"\x1f\x8b":
            datos = gzip.decompress(datos)
        return datos


def lee(origen: str | None, url: str) -> bytes:
    return Path(origen).read_bytes() if origen else baja(url)


def mapa_extractores() -> dict[str, dict[str, set]]:
    """script → {tablas que lee, ficheros que escribe}. Derivado del código, no escrito a mano."""
    m = {}
    for f in sorted(SCRIPTS.glob("extract_*.py")):
        txt = f.read_text(encoding="utf-8", errors="replace")
        tablas = set(RE_TABLA.findall(txt))
        if not tablas:
            continue
        m[f.name] = {"tablas": tablas}
    return m


def quien_lee(mapa, tabla):
    return sorted(s for s, d in mapa.items() if tabla in d["tablas"])


def main() -> int:
    p = argparse.ArgumentParser(description="Compara el SDE publicado con la base de Koru.")
    p.add_argument("--guardar-base", action="store_true",
                   help="fija la release actual como base (hazlo DESPUÉS de integrar y probar)")
    p.add_argument("--indice", help="fichero local con el índice de la release (sin red)")
    p.add_argument("--changelog", help="fichero local con _schemaChangelog.jsonl (sin red)")
    a = p.parse_args()

    ind = json.loads(lee(a.indice, URL_INDICE).decode("utf-8"))
    publicadas = ind.get("tables") or {}
    rel, build = ind.get("release"), ind.get("buildNumber")

    mapa = mapa_extractores()
    usadas = sorted({t for d in mapa.values() for t in d["tablas"]})

    print(f"SDE publicado : release {rel} · build {build} · {ind.get('releaseDate','?')}")
    print(f"Koru          : {len(mapa)} extractores · {len(usadas)} tablas del SDE")

    base = json.loads(BASE.read_text(encoding="utf-8")) if BASE.exists() else None
    if base:
        print(f"Base          : release {base.get('release')} · build {base.get('buildNumber')}"
              f" · fijada el {base.get('fijada','?')}")
    else:
        print("Base          : NO HAY (primera vez: usa --guardar-base cuando integres)")

    if a.guardar_base:
        BASE.write_text(json.dumps({
            "release": rel, "buildNumber": build, "releaseDate": ind.get("releaseDate"),
            "fijada": __import__("datetime").date.today().isoformat(),
            "nota": "Versiones por tabla del SDE del que salieron los ficheros de public/. "
                    "Se actualiza SOLO tras integrar y pasar las pruebas de cada extractor.",
            "tablas": {t: publicadas[t]["version"] for t in usadas if t in publicadas},
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"\n✅ Base fijada en {BASE.relative_to(RAIZ)} ({len(usadas)} tablas).")
        return 0

    problema = False

    # 1) Tablas que Koru lee y que ya NO existen. Lo más grave: no es un dato que cambia, es que
    #    desaparece la fuente, y el extractor fallará al abrirla.
    ausentes = [t for t in usadas if t not in publicadas]
    if ausentes:
        problema = True
        print("\n🚨 TABLAS QUE KORU LEE Y YA NO EXISTEN EN EL SDE")
        for t in ausentes:
            print(f"   {t:34s} ← {', '.join(quien_lee(mapa, t))}")

    # 2) Cambios de ESQUEMA desde nuestra build. Funciona SIN base, porque el changelog es
    #    acumulativo y va por afterBuildNumber.
    desde = (base or {}).get("buildNumber")
    if desde:
        crudo = lee(a.changelog, URL_INDICE + "_schemaChangelog.jsonl").decode("utf-8")
        filas = [json.loads(l) for l in crudo.splitlines() if l.strip()]
        nuevas = [f for f in filas if (f.get("afterBuildNumber") or 0) >= desde]
        tocadas = []
        for f in nuevas:
            for t in f.get("tables") or []:
                if t.get("table") in usadas:
                    tocadas.append((f.get("afterBuildNumber"), f.get("date"), t))
        if tocadas:
            problema = True
            print(f"\n🚨 CAMBIOS DE ESQUEMA EN TABLAS QUE KORU LEE (desde la build {desde})")
            for b, fecha, t in tocadas:
                nombre = t["table"]
                print(f"   build {b} ({fecha}) · {nombre}")
                if t.get("change"):
                    print(f"      tabla: {t['change']}")
                for c in t.get("fields") or []:
                    det = c.get("change") or (f"renombrado desde {c['renamedFrom']}"
                                              if c.get("renamedFrom") else "?")
                    print(f"      {c.get('field')}: {det}")
                print(f"      → lo leen: {', '.join(quien_lee(mapa, nombre))}")
        else:
            print(f"\n✅ Sin cambios de esquema en nuestras tablas desde la build {desde}.")

    # 3) Datos nuevos: versión distinta a la de la base.
    if base and base.get("tablas"):
        cambiadas = [t for t in usadas
                     if t in publicadas and t in base["tablas"]
                     and publicadas[t]["version"] != base["tablas"][t]]
        sin_base = [t for t in usadas if t in publicadas and t not in base["tablas"]]
        if cambiadas:
            print(f"\n🔄 TABLAS CON DATOS NUEVOS ({len(cambiadas)} de {len(usadas)})")
            for t in cambiadas:
                print(f"   {t:34s} → {', '.join(quien_lee(mapa, t))}")
        else:
            print("\n✅ Ninguna tabla que Koru lee ha cambiado de datos.")
        if sin_base:
            print(f"\nℹ️  Tablas sin versión en la base (añadidas después): {', '.join(sin_base)}")
        if cambiadas or ausentes:
            return 2 if problema else 1
        return 2 if problema else 0

    return 2 if problema else 0


if __name__ == "__main__":
    sys.exit(main())
