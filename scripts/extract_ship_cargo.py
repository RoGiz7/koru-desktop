#!/usr/bin/env python3
"""Genera public/ship_cargo.json: capacidad de carga por nave (T2 del pilar de transporte).

POR QUÉ: `public/ships.json` solo trae {i, n, g} — id, nombre y grupo. Sin la capacidad, Koru no
puede contestar la única pregunta que decide si un encargo es tuyo: **¿cuántos viajes son?**

Universo: los typeIDs de `public/ships.json` (423 naves), no los ~25k del SDE.

Fuentes:
  1. `types.jsonl` → `capacity`: la BODEGA GENERAL. Verificado: Bestower (1944) = 4.800 m³.
  2. `typeDogma.jsonl` → BODEGAS ESPECIALIZADAS (mineral, gas, PI, salvage…). No están en el campo
     `capacity`: son atributos de dogma. Verificado: la **Epithal (655)** lleva 45.000 m³ de
     commodities planetarias y solo 550 de bodega general — mirando `capacity` a secas parecería
     una nave inútil. (Ojo: 655 es la Epithal; la Miasmos es la 656 y su bodega es de MINERAL.)

⚠️ ESTO ES LA CAPACIDAD BASE, NO LA DEL JUGADOR. Expansores de carga, rigs y skills la cambian, y
ESI **no publica tu capacidad real**. Este fichero es el valor por defecto de la ficha de nave que
el jugador puede corregir a mano — mismo patrón que las fichas de instalación de industria (F1c).
Presentarlo como «tu bodega» sería mentir en cada viaje.

Uso: python scripts/extract_ship_cargo.py
"""
import glob
import json
import os
import re
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DOCS = os.path.join(os.path.dirname(ROOT), "documentacion")
OUT = os.path.join(ROOT, "public", "ship_cargo.json")

# Bodegas especializadas que importan para transportar, con el nombre corto que usará la app.
# Se dejan fuera a propósito las de munición, cadáveres, Quafe y subsistemas: existen, pero nadie
# planifica un viaje alrededor de ellas y solo ensuciarían la ficha.
#
# ⚠️ TRAMPA: en `dogmaAttributes` hay una segunda familia con nombres casi idénticos —
# `gallenteIndustrialBonusMiningHoldCapacity`, `industrialCommandBonusGasHoldCapacity`,
# `exhumersBonusGeneralMiningHoldCapacity`… — que NO son metros cúbicos, son **porcentajes por
# nivel de skill**. La Miasmos lleva `generalMiningHoldCapacity = 42000` y, al lado,
# `gallenteIndustrialBonusMiningHoldCapacity = 10` (un +10 %/nivel). Meter la segunda en la lista
# daría naves con «10 m³ de bodega» y nadie sospecharía de un número tan pequeño.
# Por eso esto es una lista blanca de IDs concretos y no un filtro por nombre.
#
# Consecuencia directa: con Gallente Industrial a V, esa Miasmos mueve 63.000 m³ y no 42.000. **El
# número del juego será SIEMPRE mayor o igual que el de aquí**, y por eso el jugador tiene que
# poder corregirlo.
HOLDS = {
    1556: "mining",       # generalMiningHoldCapacity
    1557: "gas",          # specialGasHoldCapacity
    1558: "mineral",      # specialMineralHoldCapacity
    1559: "salvage",      # specialSalvageHoldCapacity
    1560: "ship",         # specialShipHoldCapacity
    1564: "industrial",   # specialIndustrialShipHoldCapacity
    1646: "commandcenter",  # specialCommandCenterHoldCapacity
    1653: "planetary",    # specialPlanetaryCommoditiesHoldCapacity
    3136: "ice",          # specialIceHoldCapacity
    3227: "asteroid",     # specialAsteroidHoldCapacity
    5646: "colony",       # specialColonyResourcesHoldCapacity
}


# Bonus de nave a la bodega, sacados de `typeBonus.jsonl`. Se emparejan por el TEXTO EN INGLÉS del
# bonus, que es corto y cerrado: en las 423 naves solo existen nueve variantes distintas (contadas,
# no supuestas). Emparejar por texto y no por atributo es lo que permite saber que el «+10 % a la
# infrastructure hold» de las Upwell nuevas va a la bodega `colony` y no a otra.
#
# Los tres casos que NO se adivinan a ojo y hubo que mirar en el dato:
#   · «infrastructure hold» → `colony`  (Squall, Deluge, Torrent, Avalanche)
#   · «mineral hold»        → `mineral` (Kryos; que además tiene bodega de hielo SIN bonus)
#   · «cargo and ore hold»  → afecta a DOS bodegas a la vez (Orca, Porpoise)
BONUS_TEXTO = [
    ("cargo and ore hold capacity", ("cargo", "mining")),
    ("planetary commodity hold capacity", ("planetary",)),
    ("infrastructure hold capacity", ("colony",)),
    ("mineral hold capacity", ("mineral",)),
    ("ore hold capacity", ("mining",)),
    ("mining hold capacity", ("mining",)),
    ("gas hold capacity", ("gas",)),
    ("ice hold capacity", ("ice",)),
    ("ship cargo capacity", ("cargo",)),
]


def objetivos(texto_en: str):
    """A qué bodega(s) afecta este bonus. El orden de BONUS_TEXTO importa: «cargo and ore» tiene
    que probarse ANTES que «ship cargo», o se quedaría a medias."""
    t = re.sub(r"<[^>]+>", "", texto_en or "").lower()
    for patron, destino in BONUS_TEXTO:
        if patron in t:
            return destino
    return None


def main() -> int:
    # 1. Universo: las naves que la app ya conoce.
    with open(os.path.join(ROOT, "public", "ships.json"), encoding="utf-8") as f:
        ships = json.load(f)
    wanted = {int(s["i"]) for s in ships}
    print(f"Naves en ships.json: {len(wanted)}")

    zips = glob.glob(os.path.join(DOCS, "sde-source", "*.zip"))
    if not zips:
        print("ERROR: no encuentro el SDE en documentacion/sde-source/*.zip", file=sys.stderr)
        return 1
    z = zipfile.ZipFile(zips[0])

    # 2. Bodega general, del propio tipo.
    cargo: dict[int, float] = {}
    with z.open("types.jsonl") as f:
        for line in f:
            d = json.loads(line)
            tid = d.get("_key")
            if tid in wanted:
                cap = d.get("capacity")
                if cap:
                    cargo[tid] = float(cap)

    # 3. Bodegas especializadas, de dogma. Una nave puede tener varias.
    holds: dict[int, dict[str, float]] = {}
    with z.open("typeDogma.jsonl") as f:
        for line in f:
            d = json.loads(line)
            tid = d.get("_key")
            if tid not in wanted:
                continue
            for a in d.get("dogmaAttributes") or []:
                name = HOLDS.get(a.get("attributeID"))
                if name and a.get("value"):
                    holds.setdefault(tid, {})[name] = float(a["value"])

    # 4. Bonus por SKILL. `skill` es el typeID de la skill (Koru ya conoce tu nivel de cada una por
    #    ESI: `active_skill_level`), `pct` es el % POR NIVEL y `target` la bodega afectada.
    #    `skill: null` = bonus de rol, se aplica siempre y sin depender de nadie.
    bonuses: dict[int, list] = {}
    with z.open("typeBonus.jsonl") as f:
        for line in f:
            d = json.loads(line)
            tid = d.get("_key")
            if tid not in wanted:
                continue
            grupos = [(t.get("_key"), t.get("_value") or []) for t in d.get("types") or []]
            grupos.append((None, d.get("roleBonuses") or []))
            for skill_id, lista in grupos:
                for b in lista:
                    dest = objetivos((b.get("bonusText") or {}).get("en") or "")
                    if not dest or not b.get("bonus"):
                        continue
                    for target in dest:
                        bonuses.setdefault(tid, []).append(
                            {"skill": skill_id, "pct": float(b["bonus"]), "target": target}
                        )

    out = {}
    for tid in sorted(wanted):
        entry = {}
        if tid in cargo:
            entry["cargo"] = cargo[tid]
        if tid in holds:
            entry["holds"] = holds[tid]
        if tid in bonuses:
            entry["bonuses"] = bonuses[tid]
        if entry:
            out[str(tid)] = entry

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"OK → public/ship_cargo.json ({os.path.getsize(OUT)//1024} KB, {len(out)} naves)")

    # Guardas contra el juego. Si alguna falla, el SDE cambió de forma y hay que mirarlo:
    # NO publicar un fichero que no pase estas.
    assert abs(out["1944"]["cargo"] - 4800.0) < 1e-6, out.get("1944")
    print("Guarda: Bestower 4.800 m³ ✓")
    assert out["655"]["holds"]["planetary"] == 45000.0, out.get("655")
    print("Guarda: Epithal 45.000 m³ de commodities planetarias ✓")
    assert out["656"]["holds"]["mining"] == 42000.0, out.get("656")
    print("Guarda: Miasmos 42.000 m³ de bodega de mineral ✓")
    # Guardas de los BONUS, contra números que se pueden mirar en el juego:
    #   Bestower + Amarr Industrial V → 4.800 × 1,25 = 6.000 m³
    #   Epithal  + Gallente Industrial V → 45.000 × 1,50 = 67.500 m³ de planetarias
    bes = [b for b in out["1944"]["bonuses"] if b["target"] == "cargo"]
    assert bes and bes[0]["pct"] == 5.0, bes
    print(f"Guarda: Bestower +5 %/nivel → con V, {out['1944']['cargo'] * 1.25:,.0f} m³ ✓")
    epi = [b for b in out["655"]["bonuses"] if b["target"] == "planetary"]
    assert epi and epi[0]["pct"] == 10.0, epi
    print(f"Guarda: Epithal +10 %/nivel → con V, {out['655']['holds']['planetary'] * 1.5:,.0f} m³ ✓")
    # La Orca tiene que llevar el bonus DUPLICADO (cargo y bodega de mineral), que es el caso que
    # se pierde si «ship cargo capacity» se prueba antes que «cargo and ore hold».
    orca = {b["target"] for b in out["28606"]["bonuses"]} if "28606" in out else set()
    assert {"cargo", "mining"} <= orca, orca
    print("Guarda: Orca con bonus a las DOS bodegas ✓")

    sin_bonus = [s["n"] for s in ships if str(s["i"]) in out and "bonuses" not in out[str(s["i"])]]
    print(f"Naves con bonus de bodega: {len(out) - len(sin_bonus)} de {len(out)}")
    sin_cargo = [s["n"] for s in ships if str(s["i"]) not in out]
    if sin_cargo:
        print(f"Aviso: {len(sin_cargo)} naves sin capacidad (ej. {sin_cargo[:3]})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
