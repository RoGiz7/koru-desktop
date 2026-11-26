#!/usr/bin/env python3
"""Genera public/agents.json: dónde está cada agente NPC, de qué nivel y corporación, y de qué tipo.

Lo leen la capa «Tus agentes» del mapa (`src/App.tsx`) y Lealtad (`src/lealtad.tsx`): cruzan tus
standings de agente con este fichero para saber en qué sistema está cada uno.

POR QUÉ EXISTE (2026-11-26): se hizo a mano en julio y no tenía generador. Hoy no cambia NADA (ni
contra el SDE 3749835 ni contra el 3607705): el generador está para avisar el día que cambie.

Regla: los `npcCharacters` con el campo `agent`. Por agente:
  · `s` = el sistema de su estación (`locationID` → `npcStations.solarSystemID`); si no está en una
    estación, el de `agentsInSpace`. Si no se encuentra en ninguno, el generador PARA: un agente sin
    sistema se pintaría en ninguna parte sin que nada lo dijera.
  · `l` = `agent.level` · `c` = `corporationID` · `t` = `agent.agentTypeID`.

Formato: JSON compacto `{agent_id: {s, l, c, t}}`, campos en ese orden, claves en orden numérico,
sin salto final.

LA VARA DE MEDIR (2026-11-26), contra el fichero hecho a mano:
  · SDE 3749835: faltan 0, sobran 0, cambian 0.
  · SDE 3607705 (el más viejo que hay): ninguna diferencia, y sale byte a byte el fichero hecho a
    mano. Nada nacido después, nada sin probar.

Uso: python scripts/extract_agents.py [<zip del SDE>]
     python scripts/extract_agents.py --medir [<zip>]   → cuenta la vara sin escribir nada
"""
import glob
import json
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DOCS = os.path.join(os.path.dirname(ROOT), "documentacion")
OUT = os.path.join(ROOT, "public", "agents.json")


def zip_sde(args):
    if args:
        return args[0]
    zips = sorted(glob.glob(os.path.join(DOCS, "sde-source", "*jsonl.zip")))
    if not zips:
        raise SystemExit("ERROR: no encuentro el SDE en ../documentacion/sde-source/*jsonl.zip")
    return zips[-1]


def generar(z) -> dict:
    def filas(n):
        with z.open(n) as f:
            for line in f:
                yield json.loads(line)

    estacion = {d["_key"]: d["solarSystemID"] for d in filas("npcStations.jsonl")}
    en_espacio = {d["_key"]: d["solarSystemID"] for d in filas("agentsInSpace.jsonl")}
    out = {}
    for d in filas("npcCharacters.jsonl"):
        a = d.get("agent")
        if not a:
            continue
        s = estacion.get(d.get("locationID")) or en_espacio.get(d["_key"])
        if s is None:
            raise SystemExit(f"ERROR: el agente {d['_key']} no tiene sistema (ni estación ni agentsInSpace): mira el SDE")
        out[d["_key"]] = {"s": s, "l": a["level"], "c": d["corporationID"], "t": a["agentTypeID"]}
    return {str(k): out[k] for k in sorted(out)}


def medir(nuevo: dict) -> None:
    with open(OUT, encoding="utf-8") as f:
        actual = json.load(f)
    faltan = sorted(set(nuevo) - set(actual), key=int)
    sobran = sorted(set(actual) - set(nuevo), key=int)
    cambian = sorted((k for k in set(nuevo) & set(actual) if nuevo[k] != actual[k]), key=int)
    print(f"faltan {len(faltan)} · sobran {len(sobran)} · cambian {len(cambian)}")
    for k in faltan[:3]:
        print(f"   falta: {k} {nuevo[k]}")
    for k in sobran[:3]:
        print(f"   sobra: {k} {actual[k]}")
    for k in cambian[:3]:
        print(f"   cambia: {k} {actual[k]} → {nuevo[k]}")


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")  # el «→» en la consola cp1252: ver CLAUDE.md
    args = sys.argv[1:]
    solo_medir = args[:1] == ["--medir"]
    if solo_medir:
        args = args[1:]
    zpath = zip_sde(args)
    z = zipfile.ZipFile(zpath)
    print(f"SDE: {os.path.basename(zpath)} · {z.open('_sde.jsonl').read().decode().strip()}")
    nuevo = generar(z)
    if solo_medir:
        medir(nuevo)
        return 0
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(nuevo, f, separators=(",", ":"))
    print(f"OK → public/agents.json ({len(nuevo)} agentes)")
    # Guardas: NO publicar si alguna falla. Niveles de agente del 1 al 5.
    assert {v["l"] for v in nuevo.values()} <= {1, 2, 3, 4, 5}, {v["l"] for v in nuevo.values()}
    assert nuevo.get("3008416", {}).get("c") == 1000002, nuevo.get("3008416")
    print("Guardas: niveles 1–5, el primer agente es de la corporación 1000002 ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
