#!/usr/bin/env python3
"""Genera el MAPA de New Eden desde el SDE: public/neweden.json.

* POR QUE EXISTE (2026-11-11). `neweden.json` era el ultimo dato estatico grande que NO salia de
  un script. Los 19 extractores lo LEEN (extract_places_i18n, extract_ship_names_i18n,
  extract_industry_sde y los cuatro auditores del intel) y NINGUNO lo escribia. Mientras el mapa
  de EVE no cambiaba, no dolia. Con Fractured Skies (10-11-2026) cambio: dos puertas estelares
  nuevas (Renyn-Jufvitte y Ienakkamon-T-LIWS) y un sistema renombrado (Arzad -> Starkman). Sin
  script eso se queda viejo EN SILENCIO: el planificador de rutas devuelve un camino mas largo y
  no da ningun error, que es la peor forma de fallar. Misma familia que la Akoman en ships.json.

LAS REGLAS, deducidas del fichero que habia y COMPROBADAS contra el (5.485 sistemas):
  - Entran los sistemas con regionID < 11000000 (k-space). Los 3.005 que quedan fuera son de
    regiones 11/12/14/19 y NINGUNO de ellos tiene puertas.
  - id = _key  ·  n = name.en  ·  r = regionID  ·  c = constellationID
  - x, y     = position2D.x / position2D.y      -> 5.485 de 5.485 exactos
  - s        = round(securityStatus, 2)         -> 5.485 de 5.485 exactos
  - gx/gy/gz = round(position / 9.46e15, 4)     -> 5.485 de 5.485 exactos
  - jumps    = pares de mapStargates con los DOS extremos dentro, ordenados (a < b) y sin repetir.

* LA TRAMPA DEL ANO LUZ: la constante NO es el ano luz exacto (9.4607304725808e15). Con esa solo
  aciertas 1 de 5.485. Es 9.46e15 redondo, que es lo que uso quien genero el fichero en su dia.
  Esto se descubre midiendo, no leyendo. NO lo "corrijas" para que sea mas exacto: moverias los
  5.485 sistemas de golpe y el diff no diria nada.

* EL ORDEN DE `jumps`: el fichero historico venia en el orden de iteracion de un `set` de Python
  (comprobado: coincide pareja a pareja). Eso es reproducible por accidente, no por diseno — al
  anadir un solo salto se baraja la lista entera. Aqui se emite ORDENADO. El fichero es una sola
  linea minificada, asi que el diff de git es identico de todas formas, y a cambio el resultado
  es estable entre maquinas y versiones de Python.

Uso:  python scripts/extract_neweden.py [--sde RUTA_ZIP] [--dry]
      --sde  usa ese zip en vez del build mas alto de documentacion/sde-source/
      --dry  no escribe nada, solo dice que cambiaria

LA PRUEBA de que es de fiar, y la que hay que repetir si se toca: con --sde apuntando al 3667080
  (el SDE anterior a la expansion) reproduce el catalogo que habia, +0 -0 ~0.
"""
import argparse
import glob
import io
import json
import os
import sys
import zipfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(RAIZ, "public", "neweden.json")

LIMITE_KSPACE = 11000000
# Ver "LA TRAMPA DEL ANO LUZ" en la cabecera antes de tocar esto.
UNIDAD_LUZ = 9.46e15


def elige_sde(ruta):
    if ruta:
        return ruta
    # sorted()[-1] y no glob()[0]: el orden del glob no es el del numero de build, y coger un SDE
    # viejo al azar ya nos mordio una vez en extract_ship_cargo.py.
    zips = sorted(glob.glob(os.path.join(RAIZ, "..", "documentacion", "sde-source", "*jsonl.zip")))
    if not zips:
        sys.exit("ERROR: no encuentro el SDE en documentacion/sde-source/*jsonl.zip")
    return zips[-1]


def lee(z, fichero):
    with z.open(fichero) as f:
        for linea in f:
            yield json.loads(linea)


def en(valor):
    """name/description del SDE vienen como dict por idioma; el mapa va en ingles."""
    if isinstance(valor, dict):
        return valor.get("en")
    return valor


def escribe_min(path, dato):
    """JSON minificado y sin salto final, que es como estaba el fichero."""
    io.open(path, "w", encoding="utf-8").write(
        json.dumps(dato, ensure_ascii=False, separators=(",", ":"))
    )


def construye(z):
    sistemas, dentro = [], set()
    for d in lee(z, "mapSolarSystems.jsonl"):
        region = d.get("regionID")
        if region is None or region >= LIMITE_KSPACE:
            continue
        p = d["position"]
        p2 = d["position2D"]
        sid = d["_key"]
        dentro.add(sid)
        sistemas.append({
            "id": sid,
            "n": en(d.get("name")),
            "x": p2["x"],
            "y": p2["y"],
            "s": round(d["securityStatus"], 2),
            "r": region,
            "c": d["constellationID"],
            "gx": round(p["x"] / UNIDAD_LUZ, 4),
            "gy": round(p["y"] / UNIDAD_LUZ, 4),
            "gz": round(p["z"] / UNIDAD_LUZ, 4),
        })
    sistemas.sort(key=lambda s: s["id"])

    pares = set()
    for d in lee(z, "mapStargates.jsonl"):
        a = d.get("solarSystemID")
        b = (d.get("destination") or {}).get("solarSystemID")
        if a in dentro and b in dentro:
            pares.add((a, b) if a < b else (b, a))
    saltos = [list(p) for p in sorted(pares)]

    regiones = sorted(
        ({"id": d["_key"], "n": en(d.get("name"))}
         for d in lee(z, "mapRegions.jsonl") if d["_key"] < LIMITE_KSPACE),
        key=lambda r: r["id"],
    )
    consts = sorted(
        ({"id": d["_key"], "n": en(d.get("name"))}
         for d in lee(z, "mapConstellations.jsonl") if d.get("regionID", 0) < LIMITE_KSPACE),
        key=lambda c: c["id"],
    )
    return {"systems": sistemas, "jumps": saltos, "regions": regiones, "constellations": consts}


def guardas(mapa):
    """Si alguna de estas salta, NO escribas: el SDE ha cambiado de forma."""
    sis = {s["id"]: s for s in mapa["systems"]}
    fallos = []

    jita = sis.get(30000142)
    if not jita or jita["n"] != "Jita":
        fallos.append("Jita (30000142) no esta o no se llama Jita")
    elif jita["s"] != 0.95:
        fallos.append("la seguridad de Jita es %r y deberia ser 0.95" % jita["s"])
    elif round(jita["gz"], 2) != 12.42:
        # Ancla de la constante de anos luz: si esto se mueve, UNIDAD_LUZ ya no vale.
        fallos.append("gz de Jita es %r; la constante de anos luz no cuadra" % jita["gz"])

    if len(mapa["systems"]) < 5000:
        fallos.append("solo %d sistemas" % len(mapa["systems"]))
    if len(mapa["regions"]) < 60:
        fallos.append("solo %d regiones" % len(mapa["regions"]))
    if len(mapa["constellations"]) < 700:
        fallos.append("solo %d constelaciones" % len(mapa["constellations"]))

    rid = {r["id"] for r in mapa["regions"]}
    cid = {c["id"] for c in mapa["constellations"]}
    huerfanos = [s["id"] for s in mapa["systems"] if s["r"] not in rid or s["c"] not in cid]
    if huerfanos:
        fallos.append("%d sistemas sin region o constelacion (ej. %s)" % (len(huerfanos), huerfanos[:3]))

    sueltos = [p for p in mapa["jumps"] if p[0] not in sis or p[1] not in sis]
    if sueltos:
        fallos.append("%d saltos apuntan fuera del catalogo (ej. %s)" % (len(sueltos), sueltos[:3]))
    if any(a >= b for a, b in mapa["jumps"]):
        fallos.append("hay saltos con el par sin ordenar")
    if len({tuple(p) for p in mapa["jumps"]}) != len(mapa["jumps"]):
        fallos.append("hay saltos repetidos")

    sin_nombre = [s["id"] for s in mapa["systems"] if not s["n"]]
    if sin_nombre:
        fallos.append("%d sistemas sin nombre en ingles (ej. %s)" % (len(sin_nombre), sin_nombre[:3]))
    return fallos


def diff(nuevo):
    if not os.path.exists(OUT):
        print("No hay catalogo previo: se escribe entero.")
        return
    viejo = json.load(io.open(OUT, encoding="utf-8"))
    va = {s["id"]: s for s in viejo["systems"]}
    nu = {s["id"]: s for s in nuevo["systems"]}
    alta = sorted(set(nu) - set(va))
    baja = sorted(set(va) - set(nu))
    renom = [(i, va[i]["n"], nu[i]["n"]) for i in nu if i in va and va[i]["n"] != nu[i]["n"]]
    otros = [i for i in nu if i in va and va[i] != nu[i] and va[i]["n"] == nu[i]["n"]]
    print("Sistemas: +%d  -%d  renombrados %d  otros cambios %d" % (len(alta), len(baja), len(renom), len(otros)))
    for i in alta[:10]:
        print("  +  %d  %s" % (i, nu[i]["n"]))
    for i in baja[:10]:
        print("  -  %d  %s" % (i, va[i]["n"]))
    for i, a, b in renom[:10]:
        print("  ~  %d  %s -> %s" % (i, a, b))

    ja = {tuple(p) for p in viejo["jumps"]}
    jn = {tuple(p) for p in nuevo["jumps"]}
    print("Saltos: %d -> %d  (+%d  -%d)" % (len(ja), len(jn), len(jn - ja), len(ja - jn)))
    for p in sorted(jn - ja)[:10]:
        print("  +  %s <-> %s" % (nu[p[0]]["n"], nu[p[1]]["n"]))
    for p in sorted(ja - jn)[:10]:
        print("  -  %s <-> %s" % (va[p[0]]["n"], va[p[1]]["n"]))

    for clave, etiqueta in (("regions", "Regiones"), ("constellations", "Constelaciones")):
        a = {r["id"]: r["n"] for r in viejo[clave]}
        b = {r["id"]: r["n"] for r in nuevo[clave]}
        cam = [(i, a[i], b[i]) for i in b if i in a and a[i] != b[i]]
        print("%s: %d -> %d  (+%d  -%d  renombradas %d)"
              % (etiqueta, len(a), len(b), len(set(b) - set(a)), len(set(a) - set(b)), len(cam)))
        for i, x, y in cam[:5]:
            print("  ~  %d  %s -> %s" % (i, x, y))

    if viejo["jumps"] != nuevo["jumps"] and ja == jn:
        print("(el orden de `jumps` cambia a ordenado; el conjunto es el mismo)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sde", default="")
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()

    ruta = elige_sde(args.sde)
    print("SDE elegido: %s" % os.path.basename(ruta))
    with zipfile.ZipFile(ruta) as z:
        mapa = construye(z)

    print("Mapa: %d sistemas · %d saltos · %d regiones · %d constelaciones"
          % (len(mapa["systems"]), len(mapa["jumps"]), len(mapa["regions"]), len(mapa["constellations"])))

    fallos = guardas(mapa)
    if fallos:
        for f in fallos:
            print("  GUARDA: %s" % f)
        sys.exit("ERROR: guardas en rojo, no se escribe nada.")
    print("Guardas en verde.")

    print()
    diff(mapa)
    print()

    if args.dry:
        print("--dry: no se ha escrito nada.")
        return
    escribe_min(OUT, mapa)
    print("Escrito: public/neweden.json (%d KB)" % (os.path.getsize(OUT) // 1024))


if __name__ == "__main__":
    main()
