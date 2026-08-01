#!/usr/bin/env python3
"""Genera public/type_volumes.json: m³ por typeID para «qué transportar» (F1d/F4).

Universo: SOLO los tipos que aparecen en bp_industry.json (insumos y productos de fabricación,
invención y reacciones) — no los ~25k del SDE enteros.

Fuentes, por orden:
  1. SDE types.jsonl (documentacion/sde-source/*.jsonl.zip) → volume normal.
  2. Hoboleaks repackagedvolumes.json → OVERRIDE: el volumen REEMPAQUETADO, que es el que ocupa de
     verdad en la bodega al transportar (y Hoboleaks avisa de que el del SDE está mal para estos).

⚠️ DEPENDENCIA DE TERCEROS (Hoboleaks): solo afecta a la regeneración, el resultado queda congelado.

Uso: python scripts/extract_type_volumes.py
"""
import glob
import json
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DOCS = os.path.join(os.path.dirname(ROOT), "documentacion")
OUT = os.path.join(ROOT, "public", "type_volumes.json")


def main() -> int:
    # 1. Universo: todos los typeIDs que tocan la industria (insumos + productos).
    with open(os.path.join(ROOT, "public", "bp_industry.json"), encoding="utf-8") as f:
        bps = json.load(f)
    tids: set[int] = set()
    for v in bps.values():
        for act in ("m", "i", "r"):
            a = v.get(act)
            if not a:
                continue
            for tid, _q in a.get("in", []):
                tids.add(int(tid))
            for row in a.get("out", []):
                tids.add(int(row[0]))
    print(f"universo industria: {len(tids)} tipos")

    # 2. Volumen del SDE.
    # Pueden convivir varios builds en sde-source: elegir SIEMPRE el más nuevo (número más alto).
    zips = sorted(glob.glob(os.path.join(DOCS, "sde-source", "*jsonl.zip")))
    if not zips:
        print("ERROR: no encuentro el SDE jsonl.zip en documentacion/sde-source/")
        return 1
    print(f"SDE elegido: {os.path.basename(zips[-1])}")
    zips = zips[-1:]
    vols: dict[int, float] = {}
    with zipfile.ZipFile(zips[0]) as z, z.open("types.jsonl") as f:
        for line in f:
            d = json.loads(line)
            k = d.get("_key")
            if k in tids and isinstance(d.get("volume"), (int, float)):
                vols[k] = d["volume"]
    print(f"con volumen SDE: {len(vols)}")

    # 3. Override reempaquetado (Hoboleaks). Solo pisa los del universo.
    with open(os.path.join(DOCS, "hoboleaks", "repackagedvolumes.json"), encoding="utf-8") as f:
        rep = json.load(f)
    overrides = 0
    for k, v in rep.items():
        k = int(k)
        if k in tids:
            vols[k] = float(v)
            overrides += 1
    print(f"overrides reempaquetados aplicados: {overrides}")

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({str(k): v for k, v in sorted(vols.items())}, f, separators=(",", ":"))
    print(f"OK → public/type_volumes.json ({os.path.getsize(OUT)//1024} KB)")

    # Guardas: Tritanio 0.01 (SDE) y algún reempaquetado presente.
    assert abs(vols[34] - 0.01) < 1e-9, vols.get(34)
    print("Guarda: Tritanium 0.01 m³ ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
