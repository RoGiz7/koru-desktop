#!/usr/bin/env python3
"""Genera public/industry_services.json: los MÓDULOS DE SERVICIO de industria y dónde encajan.

POR QUÉ. La ficha de instalación (F1c) pide marcar tres casillas abstractas —fabricar, laboratorio,
reactor— que el jugador tiene que traducir mentalmente desde lo que ve en el juego, que son MÓDULOS:
«Standup Manufacturing Plant I», «Standup Research Lab I»… Declarar lo que ves es menos trabajo y se
equivoca menos.

Y hay una imprecisión de fondo que esto arregla: **`has_lab` mezcla INVENTAR con INVESTIGAR**, y en
el juego son módulos distintos (Invention Lab ≠ Research Lab). Se puede tener uno sin el otro.

DOS DATOS, los dos duros y del SDE (build 3464040):
  · QUÉ ACTIVIDADES da cada módulo → industryInstallationTypes + industryAssemblyLines +
    industryActivities.
  · DÓNDE ENCAJA cada módulo → atributos dogma `canFitShipGroup01..03` (grupo de estructura) y
    `canFitShipType1..10` (tipos concretos). Mismo mecanismo que ya se usa para los rigs.

⚠️ OJO A UNA TRAMPA QUE NOS MORDIÓ DOS VECES EL 2026-08-11: **una refinería (Tatara/Athanor) SÍ
puede fabricar** — el Manufacturing Plant encaja en el grupo 1406. Lo que solo cabe en refinería son
los REACTORES. No deducir «qué hace una estructura» por su nombre ni por intuición: está aquí.

Uso: python scripts/extract_service_modules.py   (elige el SDE más nuevo de documentacion/sde-source)
"""
import glob
import json
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(os.path.dirname(ROOT), "documentacion", "sde-source")
OUT = os.path.join(ROOT, "public", "industry_services.json")

# canFitShipGroup01..03 y canFitShipType1..10 (los ids salen del propio dogmaAttributes).
ATTR_GRUPO = (1298, 1299, 1300)
ATTR_TIPO = (1302, 1303, 1304, 1305, 1944, 2103, 2463, 2486, 2487, 2488)

# Actividad del SDE → la casilla de la ficha a la que contribuye. `research`/`invention` van
# separadas a propósito aunque hoy la ficha las funda en `has_lab`: el dato ya distingue, y el día
# que la ficha lo haga no habrá que regenerar nada.
CASILLA = {
    "Manufacturing": "mfg",
    "Invention": "invention",
    "Copying": "research",
    "Material Efficiency Research": "research",
    "Time Efficiency Research": "research",
    "Reactions": "reactor",
}


def main() -> int:
    zips = sorted(glob.glob(os.path.join(SRC, "*jsonl.zip")))
    if not zips:
        print("ERROR: sin SDE jsonl en documentacion/sde-source/")
        return 1
    zpath = zips[-1]
    print(f"SDE elegido: {os.path.basename(zpath)}")

    with zipfile.ZipFile(zpath) as z:
        need = ("industryInstallationTypes.jsonl", "industryAssemblyLines.jsonl",
                "industryActivities.jsonl", "types.jsonl", "typeDogma.jsonl", "groups.jsonl")
        faltan = [f for f in need if f not in z.namelist()]
        if faltan:
            print(f"ERROR: faltan en el zip: {faltan} (¿build anterior al 3464040?)")
            return 1
        def carga(f):
            return [json.loads(l) for l in z.read(f).decode("utf-8").splitlines()]
        inst = carga("industryInstallationTypes.jsonl")
        lines = {d["_key"]: d for d in carga("industryAssemblyLines.jsonl")}
        acts = {d["_key"]: d["name"] for d in carga("industryActivities.jsonl")}
        tipos = carga("types.jsonl")
        dogma = {d["_key"]: {a["attributeID"]: a["value"] for a in d.get("dogmaAttributes", [])}
                 for d in carga("typeDogma.jsonl")}
        grupos = {d["_key"]: d for d in carga("groups.jsonl")}

    def nom(d):
        n = d.get("name")
        return n if isinstance(n, dict) else {"en": n, "es": n}

    info = {d["_key"]: d for d in tipos}
    gname = {k: (nom(v).get("en") or "") for k, v in grupos.items()}

    out = {}
    for d in inst:
        tid = d["_key"]
        t = info.get(tid)
        if not t:
            continue
        nombre = nom(t)
        # Solo los módulos Standup: el resto de `industryInstallationTypes` son outposts y POS
        # antiguos, que ya no se pueden desplegar y no ayudan a rellenar una ficha de hoy.
        if "Standup" not in (nombre.get("en") or ""):
            continue
        actividades = sorted({acts.get(lines.get(x["assemblyLineID"], {}).get("activityID"), "?")
                              for x in d.get("assemblyLines", [])})
        casillas = sorted({CASILLA[a] for a in actividades if a in CASILLA})
        dg = dogma.get(tid, {})
        fit_g = sorted({int(dg[a]) for a in ATTR_GRUPO if a in dg})
        fit_t = sorted({int(dg[a]) for a in ATTR_TIPO if a in dg})
        out[str(tid)] = {
            "n": {"es": nombre.get("es") or nombre.get("en"), "en": nombre.get("en")},
            "acts": actividades,
            "does": casillas,
            "g": fit_g,   # grupos de estructura donde encaja
            "t": fit_t,   # tipos concretos (vacío = vale cualquiera de `g`)
        }

    meta = {
        "source": f"SDE {os.path.basename(zpath)} · industryInstallationTypes + typeDogma",
        "note": "Módulos Standup de industria: qué actividades dan y en qué estructuras encajan. "
                "OJO: una refinería (1406) SÍ admite Manufacturing Plant; lo exclusivo de refinería "
                "son los reactores.",
        "groups": {str(g): gname.get(g, "") for g in sorted({g for v in out.values() for g in v["g"]})},
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"_meta": meta, "mods": out}, fh, ensure_ascii=False, separators=(",", ":"))

    print(f"OK → public/industry_services.json: {len(out)} módulos ({os.path.getsize(OUT)/1024:.1f} KB)")
    for g, n in meta["groups"].items():
        print(f"   grupo {g} = {n}")

    # Guardas: si alguna falla, NO usar el resultado.
    mfg = out.get("35878")
    react = out.get("45537")
    inv, res = out.get("35886"), out.get("35891")
    assert mfg and mfg["does"] == ["mfg"] and 1406 in mfg["g"], mfg
    assert react and react["does"] == ["reactor"] and react["g"] == [1406], react
    assert inv and inv["does"] == ["invention"], inv
    assert res and res["does"] == ["research"], res
    print("  Guardas: Manufacturing Plant CABE en refinería ✓ · reactores SOLO refinería ✓ · "
          "Invention ≠ Research ✓")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
