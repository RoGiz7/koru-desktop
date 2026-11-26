#!/usr/bin/env python3
"""Genera public/skill_reqs.json: qué skills (y a qué nivel) pide cada tipo para usarlo.

Lo lee el skill-check de Fiteos y de assets (`src/fit.tsx`, `src/assets.tsx`): «¿puedes volarlo?».
⚠️ Un tipo que NO está aquí cuenta hoy como «no pide nada» y la pantalla dice que puedes usarlo.
   Regenerar lo tapa para este SDE, no lo arregla: ver el tercer tiempo en el HANDOFF.

POR QUÉ EXISTE (2026-11-26): se hizo a mano en junio. Contra el SDE 3749835 le faltaban 259 tipos
(entre ellos 7 naves publicadas, 23 módulos y 66 implantes) y 11 drones T2 no llevaban la skill
nueva que piden.

Regla: todo tipo de `typeDogma` con alguno de los seis pares «skill requerida / nivel», en este
orden: 182/277 · 183/278 · 184/279 · 1285/1286 · 1289/1287 · 1290/1288. Cada requisito es
[skill, nivel]. Ningún tipo usa los seis (el máximo es cinco), y todos los que traen la skill traen
también su nivel (medido en 3749835).
El nivel es el que dice el SDE, también 0 (Citizen Miner): no se «arregla» aquí.

Formato: JSON compacto `{type_id: [[skill, nivel], …]}`, claves en orden numérico, sin salto final.

LA VARA DE MEDIR (2026-11-26), contra el fichero hecho a mano:
  · SDE 3749835: faltan 259, sobran 0, cambian 11.
  · SDE 3607705 (el más viejo que hay), con la vara de tres cajas:
    - nacidas después del fichero: 63, entre los ids 95414 y 97712 (por encima del más alto del
      fichero, 95395).
    - no probadas (NO PROBADAS, NO HAY SDE DE JUNIO), comprobadas a mano contra el registro crudo
      del SDE de hoy:
      · 48780 Citizen Miner: el fichero pedía Mining a nivel 1; el SDE dice nivel 0.
      · 60766 Aralez: el fichero, 3 requisitos; el SDE, 4 y con otros niveles.
      · 92514 Ultratidal Entropic Disintegrator II: el fichero pedía la primera skill a nivel 1;
        el SDE, a nivel 5.
      · 95348 Research Vault, 95385 y 95390 Surveillance Vault: faltaban en el fichero. Son de la
        categoría Entity, no publicados, y con ids POR DEBAJO del máximo del fichero: por id no se
        pueden fechar.
    - ninguna otra diferencia.

Uso: python scripts/extract_skill_reqs.py [<zip del SDE>]
     python scripts/extract_skill_reqs.py --medir [<zip>]   → cuenta la vara sin escribir nada
"""
import glob
import json
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DOCS = os.path.join(os.path.dirname(ROOT), "documentacion")
OUT = os.path.join(ROOT, "public", "skill_reqs.json")

# (atributo de la skill requerida, atributo de su nivel), en el orden en que se listan.
PARES = [(182, 277), (183, 278), (184, 279), (1285, 1286), (1289, 1287), (1290, 1288)]


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
            a = {x["attributeID"]: x["value"] for x in d.get("dogmaAttributes") or []}
            req = []
            for skill, nivel in PARES:
                if a.get(skill):
                    if nivel not in a:
                        # Sin nivel no se sabe qué pide: inventar uno haría mentir al skill-check.
                        raise SystemExit(f"ERROR: el tipo {d['_key']} pide la skill {int(a[skill])} sin nivel: mira el SDE")
                    req.append([int(a[skill]), int(a[nivel])])
            if req:
                out[d["_key"]] = req
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
    print(f"OK → public/skill_reqs.json ({len(nuevo)} tipos)")
    # Guardas contra el juego: NO publicar si alguna falla. Veldspar (1230) pide Mining 1.
    assert nuevo.get("1230") == [[3386, 1]], nuevo.get("1230")
    assert max(len(v) for v in nuevo.values()) <= len(PARES)
    print("Guardas: Veldspar pide Mining 1 ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
