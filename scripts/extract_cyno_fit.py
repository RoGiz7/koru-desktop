#!/usr/bin/env python3
"""Genera public/cyno_fit.json: qué cascos pueden montar cada generador de cyno, y qué cascos
ACORTAN su duración. Para el plan de escalaciones: el reloj del cyno.

POR QUÉ EXISTE (2026-11-28): el plan contaba el ciclo del cyno con la base del módulo (10 min el
normal, 1 el covert) y lo guardaba a mano en cada salto. Pero la duración la cambia el casco de
QUIEN LO ENCIENDE: las Force Recon y las Black Ops la dejan en la mitad. Con una Force Recon
encendiendo, el plan contaba el doble de lo que dura. Y «puede encender un cyno» no es solo la
skill: el módulo solo se monta en ciertos cascos.

Universo y campos (en inglés, como el SDE):
  · `cynos`: los tres generadores que ya están en `jumpships.json` (21096 normal, 28646 covert,
    52694 industrial), con `tipo` sacado de sus atributos (1252 `isCovert`, 2826
    `isIndustrialCyno`; ninguno de los dos = normal) y `fitTypes`, los cascos PUBLICADOS de la
    categoría Ship (6) que lo pueden montar: los grupos de `canFitShipGroupNN` expandidos a sus
    tipos, más los tipos de `canFitShipTypeNN`.
  · `durationMult`: casco → multiplicador de la duración. Sale del efecto 2008
    `cynosuralDurationBonus` (modifica el atributo 73 `duration` de lo que pide Cynosural Field
    Theory, con el atributo 66 `durationBonus` del casco, operación 6 = porcentaje): multiplicador
    = 1 + atributo66/100. En el SDE 3749835, 15 cascos y todos −50 %: 9 Force Recon y 6 Black Ops.

⚠️ La base de la duración NO se repite aquí: está en `jumpships.json` (`cynos[].cycleMin`), y un
   número con dos dueños acaba con dos valores.

Formato: el de casi todo `public/`, una línea minificada, claves ordenadas, sin salto final.

Uso: python scripts/extract_cyno_fit.py [<zip del SDE>]
"""
import glob
import json
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DOCS = os.path.join(os.path.dirname(ROOT), "documentacion")
OUT = os.path.join(ROOT, "public", "cyno_fit.json")

CATEGORIA_NAVE = 6
CYNOS = [21096, 28646, 52694]
ATR_ES_COVERT, ATR_ES_INDUSTRIAL = 1252, 2826
EFECTO_DURACION = 2008
ATR_BONO = 66


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    args = sys.argv[1:]
    if args:
        zpath = args[0]
    else:
        zips = sorted(glob.glob(os.path.join(DOCS, "sde-source", "*jsonl.zip")))
        if not zips:
            print("ERROR: no encuentro el SDE en documentacion/sde-source/*jsonl.zip", file=sys.stderr)
            return 1
        zpath = zips[-1]
    z = zipfile.ZipFile(zpath)
    # El build de DENTRO del zip, no el nombre del fichero (CLAUDE.md, «SDE»).
    with z.open("_sde.jsonl") as f:
        build = json.loads(f.readline()).get("buildNumber")
    print(f"SDE elegido: {os.path.basename(zpath)} (build {build})")

    grupos: dict[int, tuple[int, str]] = {}
    with z.open("groups.jsonl") as f:
        for line in f:
            d = json.loads(line)
            grupos[d["_key"]] = (d.get("categoryID"), (d.get("name") or {}).get("en", ""))

    tipos: dict[int, tuple[int, str, bool]] = {}
    with z.open("types.jsonl") as f:
        for line in f:
            d = json.loads(line)
            tipos[d["_key"]] = (d.get("groupID"), (d.get("name") or {}).get("en", ""), bool(d.get("published")))

    nombres_atr: dict[int, str] = {}
    with z.open("dogmaAttributes.jsonl") as f:
        for line in f:
            d = json.loads(line)
            nombres_atr[d["_key"]] = d.get("name") or ""

    # La forma del efecto, comprobada: si CCP lo cambia, el multiplicador de abajo dejaría de valer.
    with z.open("dogmaEffects.jsonl") as f:
        for line in f:
            d = json.loads(line)
            if d["_key"] == EFECTO_DURACION:
                mods = d.get("modifierInfo") or []
                assert d.get("name") == "cynosuralDurationBonus", d.get("name")
                assert len(mods) == 1 and mods[0]["modifiedAttributeID"] == 73 and mods[0]["modifyingAttributeID"] == ATR_BONO \
                    and mods[0]["operation"] == 6 and mods[0]["skillTypeID"] == 21603, mods
                break
        else:
            raise SystemExit("ERROR: el SDE no tiene el efecto 2008 (cynosuralDurationBonus)")

    attrs_de: dict[int, dict[int, float]] = {}
    con_bono: list[int] = []
    with z.open("typeDogma.jsonl") as f:
        for line in f:
            d = json.loads(line)
            a = {x["attributeID"]: x["value"] for x in d.get("dogmaAttributes") or []}
            if d["_key"] in CYNOS:
                attrs_de[d["_key"]] = a
            if any(e["effectID"] == EFECTO_DURACION for e in d.get("dogmaEffects") or []):
                con_bono.append(d["_key"])
                attrs_de[d["_key"]] = a

    def es_nave(t: int) -> bool:
        gid, _, pub = tipos.get(t, (None, "", False))
        return pub and grupos.get(gid, (None, ""))[0] == CATEGORIA_NAVE

    naves_de_grupo: dict[int, list[int]] = {}
    for t, (gid, _, _) in tipos.items():
        if es_nave(t):
            naves_de_grupo.setdefault(gid, []).append(t)

    cynos = []
    for c in CYNOS:
        a = attrs_de[c]
        tipo = "covert" if a.get(ATR_ES_COVERT) else "industrial" if a.get(ATR_ES_INDUSTRIAL) else "normal"
        fit: set[int] = set()
        for k, v in a.items():
            n = nombres_atr.get(k, "")
            if n.startswith("canFitShipGroup"):
                fit.update(naves_de_grupo.get(int(v), []))
            elif n.startswith("canFitShipType") and es_nave(int(v)):
                fit.add(int(v))
        cynos.append({"id": c, "tipo": tipo, "fitTypes": sorted(fit)})

    mult = {}
    for t in sorted(con_bono):
        if not es_nave(t):
            continue
        v = attrs_de[t].get(ATR_BONO)
        assert v is not None, (t, tipos[t][1])
        m = 1 + v / 100
        mult[str(t)] = int(m) if float(m).is_integer() else m

    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"cynos": cynos, "durationMult": mult}, f, separators=(",", ":"), sort_keys=True, ensure_ascii=False)
    print(f"OK → public/cyno_fit.json ({len(cynos)} cynos, {len(mult)} cascos que cambian la duración)")

    # Guardas contra el juego. Si alguna falla, el SDE cambió de forma: NO publicar sin mirarlo.
    por = {c["tipo"]: c for c in cynos}
    assert sorted(por) == ["covert", "industrial", "normal"], list(por)
    grupo_de = lambda t: grupos[tipos[t][0]][1]
    bonos = sorted(grupo_de(int(t)) for t in mult)
    assert bonos.count("Force Recon Ship") == 9 and bonos.count("Black Ops") == 6 and len(bonos) == 15, bonos
    assert all(v == 0.5 for v in mult.values()), mult
    print("Guarda: 15 cascos a la mitad (9 Force Recon, 6 Black Ops) ✓")
    con = {int(t) for t in mult}
    assert con <= set(por["normal"]["fitTypes"]) and con <= set(por["covert"]["fitTypes"]), "un casco con bono no monta el normal o el covert"
    assert not (con & set(por["industrial"]["fitTypes"])), "un casco con bono monta el industrial"
    print("Guarda: los 15 montan el normal y el covert, y ninguno el industrial ✓")
    for c in cynos:
        print(f"  {c['tipo']}: {len(c['fitTypes'])} cascos")
    return 0


if __name__ == "__main__":
    sys.exit(main())
