#!/usr/bin/env python3
"""Nombres de NAVE en otros idiomas, para que el intel deje de ficharlos como pilotos.

## Por que existe (2026-09-07)

En la base de datos real aparecen `剑齿虎级`, `狞獾级海军型` y `秃鹰级`. Verificado contra el SDE:
son **Sabre** (22456), **Caracal Navy Issue** (17634) y **Buzzard** (11192). Hay gente con el
cliente en chino en el canal de intel y `ship_names.json` es solo ingles (con algun alias ES).

⚠️ QUE ARREGLA ESTO, dicho bien a la segunda: primero escribi que se estaban fichando como
PILOTOS. Es falso — `pareceNombre` es `/^\\p{Lu}/u` y los caracteres Han dan `false`, asi que el
troceador de hoy no los admite como nombre por ninguna de sus dos ramas. Los que estan en
`name_cache` son poso de antes de que existiera ese criterio, y esa tabla no se limpia nunca.

Lo que pasa HOY es que **se tiran en silencio**: no casan como nave, no pasan como nombre, y la
linea se queda sin nave. Un Sabre cantado en chino es un Sabre INVISIBLE — y el Sabre es la nave
que te pone la burbuja. Esto recupera un dato que se perdia; no quita uno falso.

## Lo que hace

Saca de `types.jsonl` los tipos PUBLICADOS de la categoria 6 (naves) y escribe
`public/ship_names_i18n.json` = {nombre_en_minusculas: typeID}, en los idiomas pedidos.

## ⚠️ Las dos reglas que lo hacen seguro

1. **NO se emite un nombre que ya signifique OTRA cosa.** Si el mismo texto sale como nave en dos
   typeIDs distintos, o si ya esta en `ship_names.json` apuntando a otro id, se descarta: adivinar
   la nave del hostil es peor que no nombrarla — la misma regla que el prefijo inequivoco.
2. **NO se emiten nombres que choquen con nombres de SISTEMA** (`neweden.json`). Un token que
   podria ser las dos cosas romperia el troceador por el otro lado, que es el bug que arreglamos
   el 2026-09-07 con «Yona».

Uso:
    python scripts/extract_ship_names_i18n.py            # solo zh (lo visto en el intel real)
    python scripts/extract_ship_names_i18n.py zh ru de   # los idiomas que digas
"""
import glob
import io
import json
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SDE_DIR = os.path.join(os.path.dirname(ROOT), "documentacion", "sde-source")
CATEGORIA_NAVES = 6
SALIDA = os.path.join(ROOT, "public", "ship_names_i18n.json")

# Por defecto SOLO chino: es el unico idioma del que hay evidencia en el intel real. Añadir
# idiomas "por si acaso" mete miles de cadenas en el matcher a cambio de nada, y cada una es una
# oportunidad de colision con un nombre de piloto.
IDIOMAS_POR_DEFECTO = ["zh"]


def sde_mas_nuevo() -> str:
    zips = sorted(glob.glob(os.path.join(SDE_DIR, "*jsonl.zip")))
    if not zips:
        raise SystemExit(f"No hay SDE en {SDE_DIR}")
    return zips[-1]


def main() -> int:
    idiomas = sys.argv[1:] or IDIOMAS_POR_DEFECTO
    ruta = sde_mas_nuevo()
    print(f"SDE: {os.path.basename(ruta)}\nIdiomas: {', '.join(idiomas)}\n")
    z = zipfile.ZipFile(ruta)

    # 1) Grupos de la categoria "Ship".
    grupos_nave = set()
    with z.open("groups.jsonl") as f:
        for linea in io.TextIOWrapper(f, "utf-8"):
            o = json.loads(linea)
            if o.get("categoryID") == CATEGORIA_NAVES and o.get("published"):
                grupos_nave.add(o.get("_key"))
    print(f"grupos de nave: {len(grupos_nave)}")

    # 2) Nombres por idioma. Se cuenta cuantos typeIDs reclama cada texto: si mas de uno, fuera.
    reclamos: dict[str, set] = {}
    naves = 0
    with z.open("types.jsonl") as f:
        for linea in io.TextIOWrapper(f, "utf-8"):
            o = json.loads(linea)
            if o.get("groupID") not in grupos_nave or not o.get("published"):
                continue
            naves += 1
            tid = o.get("_key")
            nombres = o.get("name") or {}
            if not isinstance(nombres, dict):
                continue
            for idi in idiomas:
                v = nombres.get(idi)
                if not v or not v.strip():
                    continue
                reclamos.setdefault(v.strip().lower(), set()).add(tid)
    print(f"naves publicadas: {naves}")

    # 3) Los filtros. Cada descarte se cuenta y se enseña: un filtro que no dice cuanto tira es un
    #    filtro en el que no se puede confiar.
    ya = {}
    p_ship = os.path.join(ROOT, "public", "ship_names.json")
    if os.path.exists(p_ship):
        ya = json.load(open(p_ship, encoding="utf-8"))
    sistemas = set()
    p_ne = os.path.join(ROOT, "public", "neweden.json")
    if os.path.exists(p_ne):
        sistemas = {s["n"].strip().lower() for s in json.load(open(p_ne, encoding="utf-8"))["systems"]}

    out, amb, choca_ship, choca_sys, ya_esta = {}, 0, 0, 0, 0
    for texto, ids in sorted(reclamos.items()):
        if len(ids) > 1:
            amb += 1
            continue
        tid = next(iter(ids))
        if texto in ya:
            if ya[texto] != tid:
                choca_ship += 1
            else:
                ya_esta += 1
            continue
        if texto in sistemas:
            choca_sys += 1
            continue
        out[texto] = tid

    print(f"\ndescartados · ambiguos (mismo texto, 2 naves): {amb}"
          f" · chocan con ship_names.json: {choca_ship}"
          f" · chocan con un SISTEMA: {choca_sys}"
          f" · ya estaban igual: {ya_esta}")
    print(f"NUEVOS nombres utilizables: {len(out)}")

    with open(SALIDA, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=0, sort_keys=True)
    print(f"\nEscrito: {os.path.relpath(SALIDA, ROOT)}")

    # 4) Comprobacion contra los casos REALES que motivaron esto.
    print("\n--- los tres que salieron en el intel de verdad ---")
    for t, esperado in [("剑齿虎级", "Sabre"), ("狞獾级海军型", "Caracal Navy Issue"), ("秃鹰级", "Buzzard")]:
        tid = out.get(t)
        print(f"  {t:<10} → {'typeID ' + str(tid) if tid else '❌ NO ESTA'}   ({esperado})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
