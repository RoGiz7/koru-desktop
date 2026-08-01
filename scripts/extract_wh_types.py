#!/usr/bin/env python3
"""Genera public/wh_types.json: catálogo de tipos de wormhole (K162, B274…) desde el SDE.

Fuente DURA (dogma del SDE, no resúmenes de comunidad): tipos del grupo 988 (Wormhole, cat 2)
con sus atributos:
  1381 wormholeTargetSystemClass  → clase de destino (1-6 = C1-C6 · 7 HS · 8 LS · 9 NS · otros:
                                     12 Thera, 13 frig-shattered, 14-18 drifter — se guarda el
                                     NÚMERO crudo y la app lo etiqueta)
  1382 wormholeMaxStableTime      → vida máx (minutos)
  1383 wormholeMaxStableMass      → masa total (kg)
  1385 wormholeMaxJumpMass        → masa por salto (kg)

El código del WH (K162, B274…) se extrae del nombre («Wormhole K162»); igual en todos los idiomas.

Uso: python scripts/extract_wh_types.py   (elige el SDE más nuevo de documentacion/sde-source)
"""
import glob
import json
import os
import re
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(os.path.dirname(ROOT), "documentacion", "sde-source")
OUT = os.path.join(ROOT, "public", "wh_types.json")

GROUP_WORMHOLE = 988
A_CLASS, A_LIFE, A_MASS, A_JUMP = 1381, 1382, 1383, 1385


def main() -> int:
    zips = sorted(glob.glob(os.path.join(SRC, "*jsonl.zip")))
    if not zips:
        print("ERROR: sin SDE jsonl en documentacion/sde-source/")
        return 1
    zpath = zips[-1]
    print(f"SDE elegido: {os.path.basename(zpath)}")

    wh_ids: dict[int, str] = {}
    with zipfile.ZipFile(zpath) as z:
        with z.open("types.jsonl") as f:
            for line in f:
                d = json.loads(line)
                # OJO: los wormholes van TODOS con published=false (objetos celestes) — no filtrar.
                if d.get("groupID") != GROUP_WORMHOLE:
                    continue
                n = d.get("name")
                nm = n.get("en") if isinstance(n, dict) else str(n)
                m = re.search(r"Wormhole\s+([A-Z0-9]{1,4})\b", nm or "")
                if m:
                    wh_ids[d["_key"]] = m.group(1)
        # El catálogo nace de los NOMBRES; el dogma enriquece donde existe. Ojo: K162 (la boca de
        # SALIDA) no tiene dogma — sus propiedades dependen del agujero de origen → campos null,
        # que es la verdad, no un hueco.
        out: dict[str, dict] = {
            code: {"tid": tid, "cls": None, "life_h": None, "mass": None, "jump": None}
            for tid, code in wh_ids.items()
        }
        with z.open("typeDogma.jsonl") as f:
            for line in f:
                d = json.loads(line)
                tid = d.get("_key")
                if tid not in wh_ids:
                    continue
                attrs = {a["attributeID"]: a["value"] for a in d.get("dogmaAttributes", [])}
                out[wh_ids[tid]].update(
                    cls=int(attrs.get(A_CLASS, 0)) or None,  # clase destino (número crudo)
                    life_h=round(attrs.get(A_LIFE, 0) / 60, 1) or None,  # minutos → horas
                    mass=attrs.get(A_MASS) or None,  # kg totales
                    jump=attrs.get(A_JUMP) or None,  # kg por salto
                )

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(dict(sorted(out.items())), f, ensure_ascii=False, separators=(",", ":"))
    print(f"OK → public/wh_types.json: {len(out)} tipos de WH ({os.path.getsize(OUT)//1024} KB)")

    # Guardas con los WH más conocidos (datos estables del juego):
    k = out.get("K162")
    assert k is not None, "falta K162"
    b = out.get("B274")
    assert b and b["cls"] == 7, f"B274 debería salir a highsec (7): {b}"  # WH conocido C2→HS
    print(f"Guardas: K162 presente · B274 cls={b['cls']} (HS) ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
