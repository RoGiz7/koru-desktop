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

# ---------------------------------------------------------------------------
# REACCIONES: atributos DISTINTOS de los de fabricación, y con menos piezas.
# Verificado leyendo el SDE 3448696 tipo a tipo (2026-08-04):
#
#   Estructura → `strReactionTimeMultiplier` (2721). SOLO la Tatara lo tiene (0.75 = −25 % de
#   TIEMPO). El Athanor NO tiene ningún bono de reacción, y NINGUNA estructura tiene bono de
#   COSTE ni de MATERIAL para reaccionar. O sea: el −5 % de coste del Sotiyo NO existe aquí.
#
#   Rig → `RefRigMatBonus` (2714) y `RefRigTimeBonus` (2713). **NO HAY RIG DE COSTE**: los rigs
#   de reacción no abaratan la tasa del job, solo materiales y tiempo.
#
#   Seguridad → los mismos atributos 2356/2357, pero con OTROS valores: low ×1.0 y null ×1.1
#   (los de fabricación son ×1.0 y ×2.1). Copiar el 2.1 aquí sería inflar el bono al doble.
#   Además llevan `disallowInHighSec` = 1: reaccionar en highsec no se puede, y es dato del SDE.
#
#   Familias → del nombre del efecto: rigReaction{Comp,Hyb,Bio}{Mat,Time}Bonus. El L-Set los
#   lleva los seis (sirve para las tres familias); los M-Set, solo el suyo.
REACT_STR_ATTR = {2721: "time"}
REACT_RIG_ATTR = {2714: "mat", 2713: "time"}
NO_HIGHSEC = 1970
# Módulos de servicio de reacción. Igual que con la planta de fabricación, no suponemos dónde
# entran: se lo preguntamos a ellos (canFitShipGroupNN) → 1406 Refinery, y solo ahí.
REACTORS = [45537, 45538, 45539]  # Standup Composite / Hybrid / Biochemical Reactor I

# ¿Dónde se puede fabricar? No lo suponemos: lo dice el propio módulo de servicio. El
# "Standup Manufacturing Plant I" lleva en el SDE sus reglas de encaje:
#   canFitShipGroup01 = 1657 (Citadel) · 02 = 1404 (Engineering Complex) · 03 = 1406 (Refinery)
# Así, un Ansiblex / Metenox / Pharolux / Tenebrex queda descartado POR EL DATO: la planta no
# cabe ahí, no es que "creamos" que no fabrica. Ojo: que el módulo QUEPA no significa que esté
# instalado — eso ESI no lo dice salvo en /corporations/{id}/structures/ (Director).
MFG_PLANT = 35878
# canFitShipGroup01..20 (los 20 que existen: no cortamos por los 4 primeros, no vaya a ser que
# algún día añadan un grupo y nos dejemos una estructura fuera en silencio).
CAN_FIT = [1298, 1299, 1300, 1301, 1872, 1879, 1880, 1881, 2065, 2396] + list(range(2476, 2486))
STRUCT_CAT = 65  # categoría Structure


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
        groups = {d["_key"]: d for d in load(z, "groups.jsonl")}
        # OJO: en dogmaEffects.jsonl el campo es `name` (NO `effectName`). Con `effectName` salía
        # vacío y todos los rigs quedaban sin `scope`.
        effects = {d["_key"]: (d.get("name") or "") for d in load(z, "dogmaEffects.jsonl")}
        structures, rigs, kinds = {}, {}, {}
        mfg_groups: list[int] = []
        reaction_groups: set[int] = set()
        for d in load(z, "typeDogma.jsonl"):
            tid = d["_key"]
            t = types.get(tid)
            if not t:
                continue
            attrs = {a["attributeID"]: a["value"] for a in (d.get("dogmaAttributes") or [])}
            eff = [effects.get(e.get("effectID"), "") for e in (d.get("dogmaEffects") or [])]

            # --- Dónde entra la planta de fabricación: lo dice ella misma ---
            if tid == MFG_PLANT:
                mfg_groups = sorted({int(attrs[k]) for k in CAN_FIT if k in attrs})

            # --- Dónde entra un reactor: se lo preguntamos a los tres módulos de servicio ---
            if tid in REACTORS:
                reaction_groups |= {int(attrs[k]) for k in CAN_FIT if k in attrs}

            # --- Toda estructura publicada: su grupo, para poder descartar las que no fabrican ---
            g = groups.get(t.get("groupID"))
            if g and g.get("categoryID") == STRUCT_CAT and t.get("published"):
                kinds[str(tid)] = {"n": nm(t), "g": t["groupID"], "gn": nm(g)["en"]}

            # --- Estructura Upwell con bonos de industria (fabricación y/o reacción) ---
            # Entra también la que SOLO tiene bono de reacción: la Tatara, que sin esto se quedaba
            # fuera del mapa. El Athanor NO aparece aquí y es correcto — no tiene ningún bono. Que
            # una estructura pueda reaccionar lo decide `reaction_groups` + su grupo en `kinds`,
            # no su presencia en este mapa (igual que el Astrahus al fabricar).
            if any(k in attrs for k in STR_ATTR) or any(k in attrs for k in REACT_STR_ATTR):
                ent = {
                    "n": nm(t),
                    **{v: attrs.get(k) for k, v in STR_ATTR.items()},
                    "slots": int(attrs.get(SLOTS, 0)),
                    "size": int(attrs.get(SIZE, 0)),
                }
                # `react` solo con lo que EXISTE de verdad: hoy únicamente tiempo, y solo la Tatara.
                react = {v: attrs[k] for k, v in REACT_STR_ATTR.items() if k in attrs}
                if react:
                    ent["react"] = react
                structures[str(tid)] = ent

            # --- Rig de ingeniería o de reacción ---
            if any(k in attrs for k in RIG_ATTR) or any(k in attrs for k in REACT_RIG_ATTR):
                # Alcance: del nombre del EFECTO (dato del SDE), no del nombre visible.
                #
                # ⚠️ UN RIG PUEDE TENER VARIOS ALCANCES, y hay que quedarse con TODOS. Antes esto
                # cortaba en el primero (`break`) y guardaba un solo string: el 43705 «Structure and
                # Component» tiene CUATRO (AdvComponent, BasCapComp, Structure, AdvCapComponent) y se
                # quedaba solo con AdvComponent → el rig no se aplicaba al fabricar una estructura.
                # 11 de los 113 rigs con bono de material estaban truncados así.
                #
                # Alcances de TODOS los tipos de bono (Material|Time|Cost). Antes solo Material:
                # los 18 rigs de invención/copia/investigación (que dan coste/tiempo y mat 0)
                # quedaban con scopes VACÍO → el desplegable de la ficha los escondía y una ficha
                # de laboratorio no podía declararlos. Lo cazó Zigor montando F2 (2026-07-30).
                # ⚠️ `Mat` además de `Material`: los efectos de REACCIÓN se llaman
                # `rigReactionCompMatBonus` (abreviado), no `...MaterialBonus`. Sin esa alternativa
                # los 6 rigs de material de reacción salían con scopes VACÍO y el desplegable de la
                # ficha los habría escondido — exactamente el mismo agujero mudo que tuvieron los
                # rigs de laboratorio hasta que Zigor preguntó por ellos.
                scopes = sorted(
                    {
                        m.group(1)
                        for e in eff
                        if (m := re.match(r"^rig(.+?)(?:Material|Mat|Time|Cost)Bonus$", e))
                    }
                )
                ent = {
                    "n": nm(t),
                    **{v: attrs.get(k, 0.0) for k, v in RIG_ATTR.items()},
                    "sec": {v: attrs.get(k) for k, v in SEC_ATTR.items() if k in attrs},
                    "size": int(attrs.get(SIZE, 0)),
                    "scopes": scopes,
                }
                # Bonos de REACCIÓN aparte: viven en otros atributos y su `sec` no vale lo mismo
                # (null ×1.1 aquí, ×2.1 en fabricación). Mezclarlos en mat/time/cost habría hecho
                # que un rig de reacción se aplicara a un job de fabricación, y al revés.
                react = {v: attrs[k] for k, v in REACT_RIG_ATTR.items() if k in attrs}
                if react:
                    ent["react"] = react
                if attrs.get(NO_HIGHSEC):
                    ent["no_hi"] = True
                rigs[str(tid)] = ent

    out = {
        "_meta": {
            "source": f"SDE {zpath.name} · types/typeDogma/dogmaEffects.jsonl",
            "note": "Bonos de industria de estructuras Upwell y sus rigs. Estructura: factores "
            "(0.99 = -1%). Rig: % BASE negativo, a multiplicar por sec[hi|low|null] segun el "
            "sistema. `scopes` = TODOS los alcances del rig, del nombre de sus efectos "
            "`rig*MaterialBonus` (p.ej. AllShipManufacture). Un rig puede tener varios: el 43705 "
            "tiene 4. Que significa cada alcance lo dice CCP en la descripcion de un rig que solo "
            "tenga ese: AllShipManufacture = 'any ship', BasCapCompManufacture = 'capital ship "
            "construction components'...",
            "structures": len(structures),
            "rigs": len(rigs),
            "note2": "`kinds` = toda estructura publicada -> su grupo. `mfg_groups` = los grupos "
            "donde ENTRA la Standup Manufacturing Plant I (canFitShipGroupNN del propio modulo). "
            "Fuera de esos grupos NO se puede fabricar, y eso es un hecho del SDE. Dentro de "
            "ellos, que quepa no implica que este instalada: eso ESI solo lo dice en "
            "/corporations/{id}/structures/ (scope read_structures + rol Director).",
        },
        "mfg_groups": mfg_groups,
        "reaction_groups": sorted(reaction_groups),
        "kinds": kinds,
        "structures": structures,
        "rigs": rigs,
    }
    out["_meta"]["note3"] = (
        "REACCIONES: `reaction_groups` = grupos donde entran los Standup Composite/Hybrid/"
        "Biochemical Reactor I (canFitShipGroupNN de los propios modulos) -> solo Refinery. "
        "`structures[].react.time` = strReactionTimeMultiplier (solo la Tatara, 0.75); no existe "
        "bono de coste ni de material de reaccion en NINGUNA estructura. `rigs[].react` = "
        "{mat: RefRigMatBonus, time: RefRigTimeBonus}; NO hay rig de coste de reaccion. Sus `sec` "
        "valen low 1.0 / null 1.1 (los de fabricacion, 1.0 / 2.1): no intercambiarlos. `no_hi` = "
        "disallowInHighSec: reaccionar en highsec no se puede, y es dato del SDE."
    )
    if not mfg_groups:
        print("AVISO: no se pudo leer canFitShipGroup de la planta; no filtramos a ciegas.", file=sys.stderr)
    if not reaction_groups:
        print("AVISO: no se pudo leer canFitShipGroup de los reactores; sin filtro de reaccion.", file=sys.stderr)
    n_react_rigs = sum(1 for r in rigs.values() if "react" in r)
    n_react_str = sum(1 for s in structures.values() if "react" in s)
    if not n_react_rigs or not n_react_str:
        print("AVISO: 0 rigs o 0 estructuras de reaccion; revisa los atributos 2713/2714/2721.",
              file=sys.stderr)
    dest = public / "industry_rigs.json"
    dest.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"OK -> {dest}: {len(structures)} estructuras ({n_react_str} con bono de reaccion) · "
          f"{len(rigs)} rigs ({n_react_rigs} de reaccion) · {len(kinds)} tipos · "
          f"fabrica en grupos {mfg_groups} · reacciona en grupos {sorted(reaction_groups)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
