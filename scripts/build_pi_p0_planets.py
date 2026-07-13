#!/usr/bin/env python3
# Genera public/pi_p0_planets.json: la tabla P0 (materias primas) -> tipos de planeta que las
# producen, con typeIDs del SDE. Es la base del planificador inverso de Planetología R1b
# ("para fabricar T necesitas estos P0, y estos tipos de planeta los dan").
#
# FUENTE de la tabla planeta<->P0: EVE University Wiki, "Planetary Commodities" (Tier 1),
# https://wiki.eveuniversity.org/Planetary_Commodities  — verificada en vivo 2026-07-13.
# Motivo de no usar el SDE para esto: el mapeo P0->tipo de planeta NO vive de forma limpia en el
# SDE moderno (planetResources.jsonl del build actual es soberanía Equinox, no PI). La tabla es
# datos de juego estables desde Tyrannis; se congela aquí con su fuente.
# Se cruzó con un resumen agregado de la comunidad y este resultó INCOMPLETO (12/15 P0), por eso
# manda EVE Uni. typeIDs y nombres EN: public/market_types.json (grupo 1333, materias primas PI).
#
# Uso:  python3 scripts/build_pi_p0_planets.py
# (Idempotente; lee public/market_types.json para resolver typeIDs por nombre.)

import json
import sys
from pathlib import Path

# --- Tabla VERIFICADA contra EVE University (P0 -> tipos de planeta) ---
# Claves de planeta = string que devuelve ESI en planet_type (minúsculas).
P0_TO_PLANETS = {
    "Aqueous Liquids":   ["barren", "gas", "ice", "oceanic", "storm", "temperate"],
    "Autotrophs":        ["temperate"],
    "Base Metals":       ["barren", "gas", "lava", "plasma", "storm"],
    "Carbon Compounds":  ["barren", "oceanic", "temperate"],
    "Complex Organisms": ["oceanic", "temperate"],
    "Felsic Magma":      ["lava"],
    "Heavy Metals":      ["ice", "lava", "plasma"],
    "Ionic Solutions":   ["gas", "storm"],
    "Microorganisms":    ["barren", "ice", "oceanic", "temperate"],
    "Noble Gas":         ["gas", "ice", "storm"],
    "Noble Metals":      ["barren", "plasma"],
    "Non-CS Crystals":   ["lava", "plasma"],
    "Planktic Colonies": ["ice", "oceanic"],
    "Reactive Gas":      ["gas"],
    "Suspended Plasma":  ["lava", "plasma", "storm"],
}

PLANET_NAMES_EN = {
    "barren": "Barren", "gas": "Gas", "ice": "Ice", "lava": "Lava",
    "oceanic": "Oceanic", "plasma": "Plasma", "storm": "Storm", "temperate": "Temperate",
}


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    market = json.loads((root / "public" / "market_types.json").read_text(encoding="utf-8"))
    name_to_id = {e["n"]: e["i"] for e in market}

    # Resolver typeIDs por nombre (fallar ruidosamente si el SDE cambia un nombre).
    p0 = {}
    for name, planets in P0_TO_PLANETS.items():
        tid = name_to_id.get(name)
        if tid is None:
            print(f"ERROR: P0 '{name}' no está en market_types.json", file=sys.stderr)
            return 1
        p0[str(tid)] = {"en": name, "planets": planets}

    # Inversa planeta -> [typeIDs de P0].
    planets = {k: {"en": v, "p0": []} for k, v in PLANET_NAMES_EN.items()}
    for tid, rec in p0.items():
        for pk in rec["planets"]:
            planets[pk]["p0"].append(int(tid))
    for pk in planets:
        planets[pk]["p0"].sort()

    # --- VALIDACIÓN: en EVE, cada tipo de planeta produce EXACTAMENTE 5 P0 ---
    bad = {pk: len(v["p0"]) for pk, v in planets.items() if len(v["p0"]) != 5}
    if bad:
        print(f"ERROR de validación: planetas con != 5 P0: {bad}", file=sys.stderr)
        return 1
    if len(p0) != 15:
        print(f"ERROR: esperados 15 P0, hay {len(p0)}", file=sys.stderr)
        return 1

    out = {
        "_meta": {
            "source": "EVE University Wiki - Planetary_Commodities (Tier 1)",
            "source_url": "https://wiki.eveuniversity.org/Planetary_Commodities",
            "verified": "2026-07-13",
            "note": "P0 raw materials -> planet types (ESI planet_type string). typeIDs de market_types.json (grupo 1333). Cada tipo de planeta produce 5 P0 (validado).",
        },
        "p0": p0,
        "planets": planets,
    }
    dest = root / "public" / "pi_p0_planets.json"
    dest.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"OK -> {dest} ({len(p0)} P0, {len(planets)} tipos de planeta, 5 P0/planeta)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
