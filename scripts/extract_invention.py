#!/usr/bin/env python3
"""Genera public/invention.json: los datos estáticos que necesita F2 (invención).

Contenido:
  - dec: los 8 DECRYPTORS GENÉRICOS (grupo 1304, los únicos que acepta la invención T2 moderna)
      {typeID: {n, prob (multiplicador), me (+/-), te (+/-), runs (+/-)}}
      Atributos dogma: 1112 inventionPropabilityMultiplier · 1113 ME · 1114 TE · 1124 maxRuns.
      Los grupos 728-731/979 (por facción/híbridos) y los de cat 17 (Sleeper/Yan Jung/Takmahl/
      Talocan) son LEGACY/reliquias antiguas: fuera a propósito.
  - enc: los skillIDs cuyo nombre EN contiene «Encryption Methods» — para separar, en las 3 skills
      de cada invención de bp_industry.json (campo `sk`), la de ENCRIPTACIÓN (÷40 en la fórmula)
      de las dos CIENCIAS (÷30).

Uso: python scripts/extract_invention.py   (elige el SDE más nuevo de documentacion/sde-source)
"""
import glob
import json
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(os.path.dirname(ROOT), "documentacion", "sde-source")
OUT = os.path.join(ROOT, "public", "invention.json")

GROUP_GENERIC_DECRYPTOR = 1304
A_PROB, A_ME, A_TE, A_RUNS = 1112, 1113, 1114, 1124


def main() -> int:
    zips = sorted(glob.glob(os.path.join(SRC, "*jsonl.zip")))
    if not zips:
        print("ERROR: sin SDE jsonl en documentacion/sde-source/")
        return 1
    zpath = zips[-1]
    print(f"SDE elegido: {os.path.basename(zpath)}")

    dec_ids: dict[int, str] = {}
    enc: list[int] = []
    with zipfile.ZipFile(zpath) as z:
        with z.open("types.jsonl") as f:
            for line in f:
                d = json.loads(line)
                n = d.get("name")
                nm = n.get("en") if isinstance(n, dict) else str(n)
                if d.get("groupID") == GROUP_GENERIC_DECRYPTOR and d.get("published"):
                    dec_ids[d["_key"]] = nm
                if nm and "Encryption Methods" in nm and d.get("published"):
                    enc.append(d["_key"])
        dec: dict[str, dict] = {}
        with z.open("typeDogma.jsonl") as f:
            for line in f:
                d = json.loads(line)
                tid = d.get("_key")
                if tid not in dec_ids:
                    continue
                attrs = {a["attributeID"]: a["value"] for a in d.get("dogmaAttributes", [])}
                dec[str(tid)] = {
                    "n": dec_ids[tid],
                    "prob": attrs.get(A_PROB, 1.0),
                    "me": int(attrs.get(A_ME, 0)),
                    "te": int(attrs.get(A_TE, 0)),
                    "runs": int(attrs.get(A_RUNS, 0)),
                }

    out = {"dec": dict(sorted(dec.items(), key=lambda kv: kv[1]["n"])), "enc": sorted(enc)}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"OK → public/invention.json: {len(dec)} decryptors · {len(enc)} skills de encriptación")

    # Guardas: valores canónicos conocidos del juego.
    assert dec["34201"] == {"n": "Accelerant Decryptor", "prob": 1.2, "me": 2, "te": 10, "runs": 1}, dec["34201"]
    assert dec["34203"]["prob"] == 0.6 and dec["34203"]["runs"] == 9, dec["34203"]  # Augmentation
    assert len(dec) == 8, f"esperaba 8 decryptors genéricos, hay {len(dec)}"
    assert len(enc) >= 4, f"esperaba ≥4 Encryption Methods, hay {len(enc)}"
    print("Guardas: Accelerant 1.2/+2/+10/+1 · Augmentation 0.6/+9 · 8 genéricos ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
