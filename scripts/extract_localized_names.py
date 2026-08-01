#!/usr/bin/env python3
"""Regenera los índices de nombres localizados ES desde el SDE (jsonl):

  - public/type_names_es.json   {nombre_es_lower: typeID}
      Criterio EXACTO del fichero original (verificado 2026-07-29: los 19.287 antiguos coinciden
      al 100%): tipos `published` CON `marketGroupID` (= el mismo universo que market_types.json).
      Lo usa buildLootIndex (pegar loot con cliente ES) — ver koru-nombres-localizados-trampa.
  - public/dungeon_names.json   {nombre_sitio_es_lower: nombre_en}
      Sitios (dungeons.jsonl) con nombre ES y EN — para traducir el nombre del sitio antes de
      buscar en la wiki de EVE University (siteNames.ts).

Uso: python scripts/extract_localized_names.py   (elige el SDE más nuevo de documentacion/sde-source)
"""
import glob
import json
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(os.path.dirname(ROOT), "documentacion", "sde-source")


def main() -> int:
    zips = sorted(glob.glob(os.path.join(SRC, "*jsonl.zip")))
    if not zips:
        print("ERROR: sin SDE jsonl en documentacion/sde-source/")
        return 1
    zpath = zips[-1]  # el build más alto
    print(f"SDE elegido: {os.path.basename(zpath)}")

    types_es: dict[str, int] = {}
    dungeons: dict[str, str] = {}
    with zipfile.ZipFile(zpath) as z:
        with z.open("types.jsonl") as f:
            for line in f:
                d = json.loads(line)
                n = d.get("name")
                if not isinstance(n, dict) or "es" not in n:
                    continue
                if not d.get("published") or d.get("marketGroupID") is None:
                    continue
                k = n["es"].strip().lower()
                if k:
                    types_es[k] = d["_key"]
        with z.open("dungeons.jsonl") as f:
            for line in f:
                d = json.loads(line)
                n = d.get("name")
                if not isinstance(n, dict):
                    continue
                es, en = n.get("es"), n.get("en")
                if es and en:
                    dungeons[es.strip().lower()] = en

    out_t = os.path.join(ROOT, "public", "type_names_es.json")
    out_d = os.path.join(ROOT, "public", "dungeon_names.json")
    with open(out_t, "w", encoding="utf-8") as f:
        json.dump(types_es, f, ensure_ascii=False, separators=(",", ":"))
    with open(out_d, "w", encoding="utf-8") as f:
        json.dump(dungeons, f, ensure_ascii=False, separators=(",", ":"))
    print(f"type_names_es.json: {len(types_es)} nombres ({os.path.getsize(out_t)//1024} KB)")
    print(f"dungeon_names.json: {len(dungeons)} sitios ({os.path.getsize(out_d)//1024} KB)")

    # Guardas mínimas (nombres estables del cliente ES):
    assert types_es.get("plagioclasa") == 18, types_es.get("plagioclasa")
    assert "almacén mercantil pith" in dungeons, "dungeon guard"
    print("Guardas: plagioclasa=18 · almacén mercantil pith ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
