#!/usr/bin/env python3
"""Genera public/npc_corp_systems.json: en qué sistemas tiene estaciones cada corporación NPC.

Lo lee la capa «Mis corps NPC» del mapa (`src/App.tsx`): cruza tus LP con estas corporaciones y
pinta sus sistemas. Una corporación que no está aquí no se pinta aunque tengas LP con ella.

POR QUÉ EXISTE (2026-11-26): se hizo a mano en julio. Contra el SDE 3749835 faltaba el Starkmanir
Council, y cuatro corporaciones (1000144 a 1000147) habían cambiado de facción, 500009 → 500001.

Regla: `npcStations` agrupadas por dueño (`ownerID`). Por corporación:
  · `s` = los sistemas de sus estaciones, sin repetir y en orden numérico;
  · `f` = su `factionID` en `npcCorporations` (`null` si no la tiene). Hoy NADIE la lee en `src/`.
Universo: TODAS las corporaciones con alguna estación. (Probado y descartado: «solo las que tienen
agentes» deja fuera 9 que el fichero hecho a mano sí tenía.)

Formato: JSON compacto, sin salto final. ⚠️ Las claves NO van en orden numérico: van por la
estación de id más bajo de cada corporación, que es el orden del fichero hecho a mano. Se ordena
por ese id explícitamente y no por el orden de las líneas del zip, que nadie garantiza.

LA VARA DE MEDIR (2026-11-26), contra el fichero hecho a mano:
  · SDE 3749835: faltan 1 (Starkmanir Council), sobran 0, cambian 4 (la facción de cuatro
    corporaciones; los sistemas no cambian).
  · SDE 3607705 (el más viejo que hay): ninguna diferencia, y generado con ese zip sale byte a byte
    el fichero hecho a mano. Así que las cinco de hoy son cambios del SDE entre octubre y noviembre.

Uso: python scripts/extract_npc_corp_systems.py [<zip del SDE>]
     python scripts/extract_npc_corp_systems.py --medir [<zip>]   → cuenta la vara sin escribir nada
"""
import glob
import json
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DOCS = os.path.join(os.path.dirname(ROOT), "documentacion")
OUT = os.path.join(ROOT, "public", "npc_corp_systems.json")


def zip_sde(args):
    if args:
        return args[0]
    zips = sorted(glob.glob(os.path.join(DOCS, "sde-source", "*jsonl.zip")))
    if not zips:
        raise SystemExit("ERROR: no encuentro el SDE en ../documentacion/sde-source/*jsonl.zip")
    return zips[-1]


def generar(z) -> dict:
    def filas(n):
        with z.open(n) as f:
            for line in f:
                yield json.loads(line)

    faccion = {d["_key"]: d.get("factionID") for d in filas("npcCorporations.jsonl")}
    sistemas: dict[int, set] = {}
    primera: dict[int, int] = {}
    for d in filas("npcStations.jsonl"):
        c = d["ownerID"]
        sistemas.setdefault(c, set()).add(d["solarSystemID"])
        primera[c] = min(primera.get(c, d["_key"]), d["_key"])
    return {str(c): {"s": sorted(sistemas[c]), "f": faccion.get(c)} for c in sorted(sistemas, key=lambda c: primera[c])}


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
    for k in cambian[:4]:
        qué = [c for c in ("s", "f") if nuevo[k][c] != actual[k][c]]
        print(f"   cambia: {k} {qué}: f {actual[k]['f']} → {nuevo[k]['f']}")


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
    print(f"OK → public/npc_corp_systems.json ({len(nuevo)} corporaciones)")
    # Guardas: NO publicar si alguna falla. 1000002 (CBD Corporation) es la primera estación del SDE.
    assert next(iter(nuevo)) == "1000002", next(iter(nuevo))
    assert all(v["s"] and v["s"] == sorted(set(v["s"])) for v in nuevo.values())
    print("Guardas: empieza por 1000002 y cada lista de sistemas va ordenada y sin repetir ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
