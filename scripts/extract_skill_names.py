#!/usr/bin/env python3
"""Genera public/skill_names.json: el nombre de cada skill, por type_id.

Lo leen el skill-check de Fiteos y de assets (`src/fit.tsx`, `src/assets.tsx`) y el plan de
estudios (`src/planEstudios.tsx`). Una skill que no está aquí sale en pantalla como `#96100`.

POR QUÉ EXISTE (2026-11-26): se hizo a mano en junio y no tenía generador. Contra el SDE 3749835 le
faltaban dos skills: Synchronization Rigging y Hybrid Drone Specialization.

Regla: TODOS los tipos de la categoría 16 (Skill), publicados o no, con su nombre en inglés. Los no
publicados entran a propósito, como en el fichero hecho a mano (77 de 588): un requisito de
`skill_reqs.json` puede apuntar a una skill que ya no se vende, y sin nombre saldría como número.

Formato: JSON compacto `{type_id: nombre}`, claves en orden numérico, sin salto final.

LA VARA DE MEDIR (2026-11-26), contra el fichero hecho a mano:
  · SDE 3749835: faltan 2, sobran 0, cambian 0.
  · SDE 3607705 (el más viejo que hay), con la vara de tres cajas:
    - nacidas después del fichero: 1, Hybrid Drone Specialization (97263). Su id es mayor que el
      más alto del fichero (93983): si hubiera existido en junio, el máximo sería ella.
    - no probadas: ninguna.
    Comprobado a mano contra el registro crudo del SDE de hoy: es una skill (grupo de la categoría
    16), publicada, y sale con su nombre.

Uso: python scripts/extract_skill_names.py [<zip del SDE>]
     python scripts/extract_skill_names.py --medir [<zip>]   → cuenta la vara sin escribir nada
"""
import glob
import json
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DOCS = os.path.join(os.path.dirname(ROOT), "documentacion")
OUT = os.path.join(ROOT, "public", "skill_names.json")

CATEGORIA_SKILL = 16


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

    cat_de_grupo = {d["_key"]: d.get("categoryID") for d in filas("groups.jsonl")}
    out = {}
    for d in filas("types.jsonl"):
        if cat_de_grupo.get(d.get("groupID")) == CATEGORIA_SKILL:
            out[d["_key"]] = (d.get("name") or {}).get("en", "")
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
    print(f"OK → public/skill_names.json ({len(nuevo)} skills)")
    # Guardas contra el juego: NO publicar si alguna falla.
    assert nuevo.get("3300") == "Gunnery", nuevo.get("3300")
    assert nuevo.get("3386") == "Mining", nuevo.get("3386")
    print("Guardas: Gunnery (3300) y Mining (3386) ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
