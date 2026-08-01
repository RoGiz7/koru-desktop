#!/usr/bin/env python3
"""Añade a public/industry_rigs.json el mapeo rig→producto (`aff`) desde Hoboleaks.

Por qué existe: el alcance de un rig de industria (a qué productos aplica su bono) NO está en el
SDE ni en ESI — vive en el CLIENTE de EVE, y Hoboleaks lo extrae en:
  - industrymodifiersources.json  → por typeID de rig: actividad → material/time/cost → filterID
  - industrytargetfilters.json    → filterID → {categoryIDs, groupIDs}
Validado el 2026-07-29 contra EVE Ref (derivado de Hoboleaks) y contra el fixture real del Bantam
(rigs 37181+43705 del Sotiyo: 37181 ON cats [6,32] · 43705 OFF para naves → 20307/3808/1587/318).

⚠️ DEPENDENCIA DE TERCEROS: Hoboleaks no debe nada a nadie y EVE Ref declara su Reference Data
«in development». Este script solo corre al regenerar (SDE/parche nuevo); el resultado se CONGELA
en public/industry_rigs.json → si Hoboleaks desaparece, no rompe la app, rompe la REGENERACIÓN.

Uso: python scripts/extract_rig_targets.py
Lee  ../documentacion/hoboleaks/{industrymodifiersources,industrytargetfilters,meta}.json
Escribe public/industry_rigs.json (añade `aff: {c: [...], g: [...]}` a cada rig mapeado y
`aff_meta` con la procedencia).
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)  # koru-desktop/
HOBO = os.path.join(os.path.dirname(ROOT), "documentacion", "hoboleaks")
OUT = os.path.join(ROOT, "public", "industry_rigs.json")


def load(name: str):
    with open(os.path.join(HOBO, name), encoding="utf-8") as f:
        return json.load(f)


def main() -> int:
    ms = load("industrymodifiersources.json")
    tf = load("industrytargetfilters.json")
    meta = load("meta.json")
    # Frescura: si Hoboleaks marca stale alguno de los dos, avisar en voz alta (regla meta.json).
    for fn in ("industrymodifiersources.json", "industrytargetfilters.json"):
        info = meta.get("files", {}).get(fn, {})
        if info.get("stale"):
            print(f"⚠️  {fn} viene marcado STALE en meta.json (rev {info.get('revision')}) — revisar antes de fiarse")

    with open(OUT, encoding="utf-8") as f:
        data = json.load(f)

    mapped = 0
    for rid, rig in data["rigs"].items():
        src = ms.get(rid)
        if not src:
            rig.pop("aff", None)  # sin dato en Hoboleaks (outposts): sin aff, la UI ya los filtra
            continue
        cats: set[int] = set()
        grps: set[int] = set()
        # Unimos material + time + cost de todas las actividades: el material decide el BOM de
        # fabricación, y el time/cost es lo ÚNICO que traen los rigs de invención/copia/research
        # (sin esto se quedaban sin aff). El producto elige la actividad que le toca vía cat/grupo.
        for act in src.values():
            for kind in ("material", "time", "cost"):
                for ent in act.get(kind, []):
                    filt = tf.get(str(ent.get("filterID")))
                    if filt:
                        cats.update(filt["categoryIDs"])
                        grps.update(filt["groupIDs"])
        rig["aff"] = {"c": sorted(cats), "g": sorted(grps)}
        mapped += 1

    data["aff_meta"] = {
        "source": "hoboleaks",
        "revision": meta.get("revision"),
        "timestamp": meta.get("timestamp"),
    }

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

    print(f"OK: {mapped}/{len(data['rigs'])} rigs con aff (rev Hoboleaks {meta.get('revision')})")

    # Guardas del fixture (si fallan, NO uses el resultado):
    r1 = data["rigs"]["37181"]["aff"]
    r2 = data["rigs"]["43705"]["aff"]
    assert r1 == {"c": [6, 32], "g": []}, r1
    assert r2["c"] == [23, 39, 40, 65, 66] and 873 in r2["g"], r2
    print("Fixture Bantam: 37181 cats [6,32] · 43705 sin cat 6 → guardas OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
