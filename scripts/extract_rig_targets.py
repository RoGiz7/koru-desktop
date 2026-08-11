#!/usr/bin/env python3
"""Añade a public/industry_rigs.json el mapeo rig→producto (`aff`) desde el SDE OFICIAL.

★ FUENTE CAMBIADA EL 2026-08-11, y es una dependencia externa menos.
Hasta hoy esto se leía de HOBOLEAKS, porque el alcance de un rig de industria (a qué productos
aplica su bono) vivía solo en el CLIENTE de EVE. **El build 3464040 del SDE lo publica**:
  - industryModifierSources.jsonl → por typeID: actividad → material/time/cost → filterID
  - industryTargetFilters.jsonl   → filterID → {categoryIDs, groupIDs}
Son exactamente los dos ficheros que Hoboleaks servía.

CONFRONTADO ANTES DE CAMBIAR (regla de las tres fuentes), Hoboleaks 3457062 contra SDE 3464040:
  · los 18 filtros: IDÉNTICOS, cero diferencias
  · el mapeo rig→filtros de los 220 tipos: IDÉNTICO, cero diferencias
  · los 15 rigs sin `aff` (Upwell Outpost Rigs) tampoco están en el SDE: no era un agujero de
    Hoboleaks, es que esos rigs no llevan filtro de industria.
Hoboleaks llevaba años clavándolo. Lo que se gana no es exactitud: es que **la regeneración ya no
depende de un tercero que no debe nada a nadie**.

Ojo a la nomenclatura, que es lo único que cambia: Hoboleaks usaba `research_material`/
`research_time` (snake_case) y el SDE usa `researchMaterial`/`researchTime`. Como aquí se recorren
TODAS las actividades sin mirar su nombre, da igual — pero conviene saberlo si algún día se filtra
por actividad.

Uso: python scripts/extract_rig_targets.py   (elige el SDE más nuevo de documentacion/sde-source)
Escribe public/industry_rigs.json (añade `aff: {c: [...], g: [...]}` a cada rig mapeado y
`aff_meta` con la procedencia).
"""
import glob
import json
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)  # koru-desktop/
SRC = os.path.join(os.path.dirname(ROOT), "documentacion", "sde-source")
OUT = os.path.join(ROOT, "public", "industry_rigs.json")


def main() -> int:
    zips = sorted(glob.glob(os.path.join(SRC, "*jsonl.zip")))
    if not zips:
        print("ERROR: sin SDE jsonl en documentacion/sde-source/")
        return 1
    zpath = zips[-1]
    print(f"SDE elegido: {os.path.basename(zpath)}")
    with zipfile.ZipFile(zpath) as z:
        faltan = [f for f in ("industryModifierSources.jsonl", "industryTargetFilters.jsonl")
                  if f not in z.namelist()]
        if faltan:
            print(f"ERROR: {faltan} no están en el zip (¿build anterior al 3464040?)")
            return 1
        ms = {str(d["_key"]): d
              for d in (json.loads(l) for l in
                        z.read("industryModifierSources.jsonl").decode("utf-8").splitlines())}
        tf = {str(d["_key"]): d
              for d in (json.loads(l) for l in
                        z.read("industryTargetFilters.jsonl").decode("utf-8").splitlines())}

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
        for clave, act in src.items():
            if clave == "_key" or not isinstance(act, dict):
                continue  # el `_key` del SDE no es una actividad
            for kind in ("material", "time", "cost"):
                for ent in act.get(kind, []):
                    filt = tf.get(str(ent.get("filterID")))
                    if filt:
                        # `.get(...) or []`: el SDE omite la lista vacía en vez de mandarla vacía.
                        cats.update(filt.get("categoryIDs") or [])
                        grps.update(filt.get("groupIDs") or [])
        rig["aff"] = {"c": sorted(cats), "g": sorted(grps)}
        mapped += 1

    data["aff_meta"] = {
        "source": "sde",
        "sde": os.path.basename(zpath),
        "note": "industryModifierSources + industryTargetFilters. Antes venía de Hoboleaks; las dos "
                "fuentes se confrontaron el 2026-08-11 y daban EXACTAMENTE lo mismo.",
    }

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

    print(f"OK: {mapped}/{len(data['rigs'])} rigs con aff (SDE {os.path.basename(zpath)})")

    # Guardas del fixture (si fallan, NO uses el resultado):
    r1 = data["rigs"]["37181"]["aff"]
    r2 = data["rigs"]["43705"]["aff"]
    assert r1 == {"c": [6, 32], "g": []}, r1
    assert r2["c"] == [23, 39, 40, 65, 66] and 873 in r2["g"], r2
    print("Fixture Bantam: 37181 cats [6,32] · 43705 sin cat 6 → guardas OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
