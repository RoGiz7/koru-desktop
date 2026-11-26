#!/usr/bin/env python3
"""Genera public/module_slots.json: en qué ranura va cada módulo (alta, media, baja, rig, subsistema).

Lo lee el visor de fits de Fiteos (`src/fit.tsx`): pinta cada módulo en su anillo. Un módulo que no
está aquí cae en «extra», fuera del anillo, como si no fuera de ninguna ranura.

POR QUÉ EXISTE (2026-11-26): se hizo a mano en junio. Contra el SDE 3749835 le faltaban 96 módulos
(50 publicados) y el Countermeasure Launcher I estaba en alta cuando el SDE lo pone en media.

Regla: todo tipo de `typeDogma` con uno de los efectos de ranura, publicado o no (el fichero hecho a
mano llevaba 804 sin publicar: un fit viejo puede tener un módulo retirado):
    12 hiPower → "high" · 13 medPower → "mid" · 11 loPower → "low" · 2663 rigSlot → "rig" ·
    3772 subSystem → "sub".
Ningún tipo lleva dos a la vez (medido en 3607705 y 3749835). Si un SDE lo trae, el generador
PARA: elegir uno en silencio pondría el módulo en una ranura al azar.

Formato: JSON compacto `{type_id: ranura}`, claves en orden numérico, sin salto final.

LA VARA DE MEDIR (2026-11-26), contra el fichero hecho a mano:
  · SDE 3749835: faltan 96, sobran 0, cambian 1.
  · SDE 3607705 (el más viejo que hay), con la vara de tres cajas:
    - nacidas después del fichero: 13, entre los ids 95414 y 97712 (todas por encima del más alto
      del fichero, 94067).
    - no probadas (NO PROBADAS, NO HAY SDE DE JUNIO):
      · 10642 Countermeasure Launcher I: el fichero dice alta («high»); el SDE de octubre y el de
        hoy solo le dan el efecto 13, ranura media. Comprobado a mano contra el registro crudo de
        hoy: sale «mid».
    - ninguna otra diferencia.

Uso: python scripts/extract_module_slots.py [<zip del SDE>]
     python scripts/extract_module_slots.py --medir [<zip>]   → cuenta la vara sin escribir nada
"""
import glob
import json
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DOCS = os.path.join(os.path.dirname(ROOT), "documentacion")
OUT = os.path.join(ROOT, "public", "module_slots.json")

EFECTO_RANURA = {12: "high", 13: "mid", 11: "low", 2663: "rig", 3772: "sub"}


def zip_sde(args):
    if args:
        return args[0]
    zips = sorted(glob.glob(os.path.join(DOCS, "sde-source", "*jsonl.zip")))
    if not zips:
        raise SystemExit("ERROR: no encuentro el SDE en ../documentacion/sde-source/*jsonl.zip")
    return zips[-1]


def generar(z) -> dict:
    out = {}
    with z.open("typeDogma.jsonl") as f:
        for line in f:
            d = json.loads(line)
            ranuras = [EFECTO_RANURA[e["effectID"]] for e in d.get("dogmaEffects") or [] if e["effectID"] in EFECTO_RANURA]
            if len(ranuras) > 1:
                raise SystemExit(f"ERROR: el tipo {d['_key']} tiene dos ranuras ({ranuras}): mira el SDE antes de seguir")
            if ranuras:
                out[d["_key"]] = ranuras[0]
    return {str(k): out[k] for k in sorted(out)}


def medir(nuevo: dict) -> None:
    with open(OUT, encoding="utf-8") as f:
        actual = json.load(f)
    faltan = sorted(set(nuevo) - set(actual), key=int)
    sobran = sorted(set(actual) - set(nuevo), key=int)
    cambian = sorted((k for k in set(nuevo) & set(actual) if nuevo[k] != actual[k]), key=int)
    print(f"faltan {len(faltan)} · sobran {len(sobran)} · cambian {len(cambian)}")
    for k in faltan[:3]:
        print(f"   falta: {k} {nuevo[k]}")
    for k in sobran[:3]:
        print(f"   sobra: {k} {actual[k]}")
    for k in cambian[:3]:
        print(f"   cambia: {k} {actual[k]} → {nuevo[k]}")


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")  # el «→» en la consola cp1252: ver CLAUDE.md
    args = sys.argv[1:]
    solo_medir = args[:1] == ["--medir"]
    if solo_medir:
        args = args[1:]
    zpath = zip_sde(args)
    z = zipfile.ZipFile(zpath)
    print(f"SDE: {os.path.basename(zpath)} · {z.open('_sde.jsonl').read().decode().strip()}")
    nuevo = generar(z)
    if solo_medir:
        medir(nuevo)
        return 0
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(nuevo, f, separators=(",", ":"))
    print(f"OK → public/module_slots.json ({len(nuevo)} módulos)")
    # Guardas contra el juego: NO publicar si alguna falla.
    assert set(nuevo.values()) == set(EFECTO_RANURA.values()), set(nuevo.values())
    assert nuevo.get("10642") == "mid", nuevo.get("10642")  # Countermeasure Launcher I
    print("Guardas: las cinco ranuras presentes, Countermeasure Launcher I en media ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
