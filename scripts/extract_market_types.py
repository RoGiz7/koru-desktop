#!/usr/bin/env python3
"""Regenera public/market_types.json y public/market_groups.json desde el SDE.

Los dos ficheros nacieron en la v0.15.0 (Comercio) y NUNCA se habían regenerado: el 2026-09-22,
con el SDE 3532181, les faltaban 192 tipos y 12 grupos de mercado (los SKIN nuevos, las secciones
de drones híbridos de Cradle of War, los mutaplásmidos Radical, la Babaroga…). Se notó al querer
enseñar en Wormholes qué se compra con el Fabricator Data: los mutaplásmidos no tenían nombre.

Formas (las MISMAS que usan Comercio, PI y las búsquedas — no se cambian):
  market_types.json  = [{i: typeID, n: nombre EN, g: marketGroupID}]   tipos published CON grupo
  market_groups.json = [{i, n: EN, ne: ES, p: padre|null, h: tiene tipos}]  todos los grupos

Uso: python scripts/extract_market_types.py  (elige el SDE más nuevo de documentacion/sde-source)
"""
import glob
import json
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(os.path.dirname(ROOT), "documentacion", "sde-source")
OUT_TYPES = os.path.join(ROOT, "public", "market_types.json")
OUT_GROUPS = os.path.join(ROOT, "public", "market_groups.json")


def main() -> int:
    zips = sorted(glob.glob(os.path.join(SRC, "*jsonl.zip")))
    if not zips:
        print("ERROR: sin SDE jsonl en documentacion/sde-source/")
        return 1
    zpath = zips[-1]
    print(f"SDE elegido: {os.path.basename(zpath)}")

    types: list[dict] = []
    groups: list[dict] = []
    with zipfile.ZipFile(zpath) as z:
        with z.open("types.jsonl") as f:
            for line in f:
                d = json.loads(line)
                if d.get("published") and d.get("marketGroupID"):
                    types.append({"i": d["_key"], "n": d["name"]["en"], "g": d["marketGroupID"]})
        with z.open("marketGroups.jsonl") as f:
            for line in f:
                d = json.loads(line)
                n = d.get("name") or {}
                groups.append(
                    {
                        "i": d["_key"],
                        "n": n.get("en", ""),
                        "ne": n.get("es") or n.get("en", ""),
                        "p": d.get("parentGroupID"),
                        "h": bool(d.get("hasTypes")),
                    }
                )
    types.sort(key=lambda t: (t["n"], t["i"]))
    groups.sort(key=lambda g: g["i"])

    for path, data in ((OUT_TYPES, types), (OUT_GROUPS, groups)):
        antes = None
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                antes = json.load(f)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        viejos = {x["i"] for x in antes} if antes else set()
        nuevos = {x["i"] for x in data}
        print(
            f"{os.path.basename(path)}: {len(data)} entradas"
            + (f" (+{len(nuevos - viejos)} nuevas, -{len(viejos - nuevos)} retiradas)" if antes else "")
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
