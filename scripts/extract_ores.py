#!/usr/bin/env python3
"""Genera public/ores.json: lo que se MINA, para el filtro «Mineral» de los encargos de minería
(`src/freelance.tsx`).

POR QUÉ EXISTE (2026-11-26): el fichero se hizo a mano en julio y no tenía generador. Medido contra
el SDE 3749835 le faltaban 8 menas (las Z-Grade nuevas) y 5 tenían el nombre viejo («Raspite
X-Grade», hoy «Flawed Raspite»): buscarlas por su nombre de hoy no daba nada.

LA INTENCIÓN ES «LO QUE SE MINA», NO «LA CATEGORÍA DE ASTEROIDES». Por eso lleva el gas, que se
cosecha y es de la categoría Celestial, y la Prismaticite, que es de la categoría Material. Regla:
  · tipos PUBLICADOS de la categoría 25 (Asteroid), sin los comprimidos;
  · más los grupos de `MINADOS_SIN_SER_ASTEROIDE`, una lista DECLARADA y con nombre.
La lista no se deduce a propósito: «se mina» no es un campo del SDE. Lo que sí se comprobó (SDE
3749835): esos dos grupos son exactamente los únicos fuera de la categoría 25 con tipos en
`compressibleTypes`, que es lo más parecido a «esto sale de una nave minera». Añadir otro grupo es
una decisión de producto, no de este script.

⚠️ Los comprimidos se quitan POR NOMBRE («Compressed» en el nombre) y no con `compressibleTypes`:
   esa tabla no tiene los 63 «Batch Compressed» viejos, que siguen publicados. Filtrando por la
   tabla, volverían al buscador.

Campos: `i` type_id · `n` nombre en inglés · `g` nombre del grupo en inglés. Ordenado por (g, n).
Formato: JSON compacto, sin salto de línea final (el del fichero hecho a mano).

LA VARA DE MEDIR (2026-11-26), contra el fichero hecho a mano:
  · SDE 3749835: faltan 8, sobran 0, cambian 5 (las Z-Grade y los «Flawed»).
  · SDE 3607705 (el más viejo que hay): solo cambia «Pyroxeres  0-Grade», que el fichero tenía con
    DOS espacios y el SDE ya trae con uno. NO PROBADA, NO HAY SDE DE JUNIO: el zip más viejo es de
    octubre, tres meses después del fichero. Comprobado a mano contra el registro crudo del SDE de
    hoy (tipo 95395): un solo espacio, y eso es lo que sale.

Uso: python scripts/extract_ores.py [<zip del SDE>]
     python scripts/extract_ores.py --medir [<zip>]
       → no escribe nada: compara lo que generaría con public/ores.json y cuenta faltan / sobran /
         cambian, con ejemplos. Es la vara de arriba, para volver a pasarla.
"""
import glob
import json
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DOCS = os.path.join(os.path.dirname(ROOT), "documentacion")
OUT = os.path.join(ROOT, "public", "ores.json")

CATEGORIA_ASTEROIDE = 25
# Grupos que se minan o se cosechan y NO son de la categoría de asteroides. Con el motivo al lado.
MINADOS_SIN_SER_ASTEROIDE = {
    711: "Harvestable Cloud — el gas: se cosecha con harvesters, y en el SDE es «Celestial»",
    4915: "Prismaticite — se mina, y en el SDE es «Material»",
}


def zip_sde(args):
    if args:
        return args[0]
    zips = sorted(glob.glob(os.path.join(DOCS, "sde-source", "*jsonl.zip")))
    if not zips:
        raise SystemExit("ERROR: no encuentro el SDE en ../documentacion/sde-source/*jsonl.zip")
    return zips[-1]


def generar(z) -> list:
    def filas(n):
        with z.open(n) as f:
            for line in f:
                yield json.loads(line)

    grupos = {d["_key"]: d for d in filas("groups.jsonl")}
    out = []
    for d in filas("types.jsonl"):
        if not d.get("published"):
            continue
        g = grupos.get(d.get("groupID"))
        if not g:
            continue
        if g.get("categoryID") != CATEGORIA_ASTEROIDE and d["groupID"] not in MINADOS_SIN_SER_ASTEROIDE:
            continue
        nombre = (d.get("name") or {}).get("en", "")
        if "Compressed" in nombre:
            continue
        out.append({"i": d["_key"], "n": nombre, "g": (g.get("name") or {}).get("en", "")})
    out.sort(key=lambda x: (x["g"], x["n"]))
    return out


def medir(nuevo: list) -> None:
    with open(OUT, encoding="utf-8") as f:
        actual = {x["i"]: x for x in json.load(f)}
    nv = {x["i"]: x for x in nuevo}
    faltan = sorted(set(nv) - set(actual))
    sobran = sorted(set(actual) - set(nv))
    cambian = sorted(k for k in set(nv) & set(actual) if nv[k] != actual[k])
    print(f"faltan {len(faltan)} · sobran {len(sobran)} · cambian {len(cambian)}")
    for k in faltan[:3]:
        print(f"   falta: {nv[k]}")
    for k in sobran[:3]:
        print(f"   sobra: {actual[k]}")
    for k in cambian[:3]:
        print(f"   cambia: {actual[k]} → {nv[k]}")


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
    print(f"OK → public/ores.json ({len(nuevo)} tipos)")
    # Guardas: si alguna falla, el SDE cambió de forma. NO publicar sin mirarlo.
    grupos = {x["g"] for x in nuevo}
    assert "Harvestable Cloud" in grupos and "Prismaticite" in grupos, "faltan los grupos declarados"
    assert not any("Compressed" in x["n"] for x in nuevo), "se coló un comprimido"
    assert any(x["n"] == "Veldspar" for x in nuevo), "sin Veldspar no es un catálogo de menas"
    print("Guardas: gas y Prismaticite dentro, ningún comprimido, Veldspar está ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
