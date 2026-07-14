#!/usr/bin/env python3
# Genera public/industry_rigs.json: los bonos de INDUSTRIA de las estructuras Upwell y de sus rigs,
# sacados del SDE. Es lo que mata la parte más frágil de la config de F1: hasta ahora había que
# escribir a mano el "-1 %" de la estructura y el "valor BASE del rig", y las dos son trampas
# (in-game hay TRES bonos con el mismo nombre, y el % del rig se muestra REDONDEADO y ya
# multiplicado por la seguridad).
#
# Todo esto está en el SDE y lo comprobamos contra un job real (fixture Bantam en el Sotiyo GEZ):
#   Sotiyo (35827): strEngMatBonus 0.99 · strEngCostBonus 0.95 · strEngTimeBonus 0.70
#   Standup XL-Set Ship Manufacturing Efficiency II (37181):
#       attributeEngRigMatBonus -2.4 · attributeEngRigTimeBonus -24 · nullSecModifier 2.1
#   → factor de material = 0.90 (ME10) × 0.99 × (1 − 2.4×2.1/100) = 0.8460936 → 20.307 exactos.
#
# El ALCANCE de cada rig sale del NOMBRE DE SU EFECTO, no de un heurístico sobre el nombre visible:
#   6840 rigAllShipManufactureMaterialBonus → "AllShipManufacture" (todas las naves)
#   6841 rigAllShipManufactureTimeBonus
# Se guarda el scope crudo para que la app decida a qué producto aplica.
#
# Uso:  python3 scripts/extract_industry_rigs.py <sde-jsonl.zip> <dir_public>

import json
import re
import sys
import zipfile
from pathlib import Path

# Bonos de rol de la estructura (factores ya listos para multiplicar: 0.99 = −1 %).
STR_ATTR = {2600: "mat", 2601: "cost", 2602: "time"}
# Bonos del rig (porcentajes BASE, negativos: −2.4 = −2,4 %). Se multiplican por la seguridad.
RIG_ATTR = {2594: "mat", 2593: "time", 2595: "cost"}
# Multiplicadores por seguridad del sistema (viven en el propio rig).
SEC_ATTR = {2355: "hi", 2356: "low", 2357: "null"}
SLOTS, SIZE = 1137, 1547


def load(z, name):
    with z.open(name) as fh:
        for line in fh:
            line = line.strip()
            if line:
                yield json.loads(line)


def nm(rec):
    n = rec.get("name") or {}
    en = n.get("en") or ""
    return {"es": n.get("es") or en, "en": en}


def main() -> int:
    if len(sys.argv) != 3:
        print("uso: extract_industry_rigs.py <sde-jsonl.zip> <dir_public>", file=sys.stderr)
        return 2
    zpath, public = Path(sys.argv[1]), Path(sys.argv[2])

    with zipfile.ZipFile(zpath) as z:
        types = {d["_key"]: d for d in load(z, "types.jsonl")}
        effects = {d["_key"]: (d.get("effectName") or "") for d in load(z, "dogmaEffects.jsonl")}
        structures, rigs = {}, {}
        for d in load(z, "typeDogma.jsonl"):
            tid = d["_key"]
            t = types.get(tid)
            if not t:
                continue
            attrs = {a["attributeID"]: a["value"] for a in (d.get("dogmaAttributes") or [])}
            eff = [effects.get(e.get("effectID"), "") for e in (d.get("dogmaEffects") or [])]

            # --- Estructura Upwell con bonos de industria ---
            if any(k in attrs for k in STR_ATTR):
                structures[str(tid)] = {
                    "n": nm(t),
                    **{v: attrs.get(k) for k, v in STR_ATTR.items()},
                    "slots": int(attrs.get(SLOTS, 0)),
                    "size": int(attrs.get(SIZE, 0)),
                }

            # --- Rig de ingeniería ---
            if any(k in attrs for k in RIG_ATTR):
                # Alcance: del nombre del EFECTO (dato del SDE), no del nombre visible.
                scope = None
                for e in eff:
                    m = re.match(r"^rig(.+?)(MaterialBonus|TimeBonus|CostBonus)$", e)
                    if m:
                        scope = m.group(1)
                        break
                rigs[str(tid)] = {
                    "n": nm(t),
                    **{v: attrs.get(k, 0.0) for k, v in RIG_ATTR.items()},
                    "sec": {v: attrs.get(k) for k, v in SEC_ATTR.items() if k in attrs},
                    "size": int(attrs.get(SIZE, 0)),
                    "scope": scope,
                }

    out = {
        "_meta": {
            "source": f"SDE {zpath.name} · types/typeDogma/dogmaEffects.jsonl",
            "note": "Bonos de industria de estructuras Upwell y sus rigs. Estructura: factores "
            "(0.99 = -1%). Rig: % BASE negativo, a multiplicar por sec[hi|low|null] segun el "
            "sistema. `scope` sale del nombre del efecto (p.ej. AllShipManufacture).",
            "structures": len(structures),
            "rigs": len(rigs),
        },
        "structures": structures,
        "rigs": rigs,
    }
    dest = public / "industry_rigs.json"
    dest.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"OK -> {dest}: {len(structures)} estructuras · {len(rigs)} rigs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
