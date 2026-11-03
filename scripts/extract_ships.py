#!/usr/bin/env python3
"""Genera el CATALOGO DE NAVES desde el SDE: public/ships.json, src-tauri/src/ships.json y
public/ship_names.json.

★ POR QUE EXISTE (2026-11-03). Estos tres ficheros se mantenian A MANO, y es el unico dato
  estatico de Koru que no salna de un script. Ya fallo dos veces con la Akoman (95741): primero
  faltaba entera, y al anadirla se olvido la COPIA EMBEBIDA EN RUST. El 10 de noviembre entran
  cuatro battlecruisers navy de golpe con Fractured Skies; si se escapa uno, el intel no reconoce
  esa nave cuando alguien la canta y el planificador de Rampancy no la puntua.

LA REGLA, deducida del fichero que habia y comprobada contra el: categoria 6 (Ship) + published.
  NO se filtra por marketGroup: eso dejaria fuera las Capsulas y la Stratios Emergency Responder,
  que si estan en el catalogo.

LAS DOS COPIAS. `public/ships.json` lo lee el front y `src-tauri/src/ships.json` va embebido en
  Rust con include_str! (nombres de nave, conjunto de naves, BFS). DEBEN ser identicas: el script
  escribe las dos y lo comprueba al final.
  Ojo: tocar el .json embebido no basta para que Rust lo recompile si la fecha no cambia.

ship_names.json es nombre en MINUSCULA -> typeID, con el nombre en espanol ademas del ingles
  cuando difieren (asi el intel reconoce «sonda» igual que «probe»).

Uso:  python scripts/extract_ships.py [--sde RUTA_ZIP] [--dry]
      --sde  usa ese zip en vez del build mas alto de documentacion/sde-source/
      --dry  no escribe nada, solo dice que cambiaria
"""
import argparse
import glob
import io
import json
import os
import sys
import zipfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_SHIPS = [
    os.path.join(RAIZ, "public", "ships.json"),
    os.path.join(RAIZ, "src-tauri", "src", "ships.json"),
]
OUT_NAMES = os.path.join(RAIZ, "public", "ship_names.json")
CATEGORIA_NAVE = 6


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


def escribe_min(path, dato):
    """JSON minificado y sin salto final, que es como estaban los tres ficheros."""
    io.open(path, "w", encoding="utf-8").write(
        json.dumps(dato, ensure_ascii=False, separators=(",", ":"))
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sde", default="")
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()

    zp = elige_sde(a.sde)
    print("SDE elegido: %s" % os.path.basename(zp))
    z = zipfile.ZipFile(zp)

    grupos = {g["_key"]: g for g in lee(z, "groups.jsonl")}
    de_nave = {k for k, g in grupos.items() if g.get("categoryID") == CATEGORIA_NAVE}

    naves = []
    for t in lee(z, "types.jsonl"):
        if t.get("groupID") not in de_nave or not t.get("published"):
            continue
        nombre = t.get("name") or {}
        en = nombre.get("en")
        if not en:
            print("  AVISO: nave %s publicada sin nombre en ingles, se omite" % t["_key"])
            continue
        grupo = (grupos[t["groupID"]].get("name") or {}).get("en") or "?"
        naves.append({"i": t["_key"], "n": en, "g": grupo, "_es": (nombre.get("es") or "")})

    # Orden por grupo y nombre: es como se leia el fichero a mano y hace el diff legible.
    naves.sort(key=lambda s: (s["g"], s["n"]))
    ships = [{"i": s["i"], "n": s["n"], "g": s["g"]} for s in naves]

    # ship_names: por typeID, el ingles y detras el espanol si difiere.
    # ⚠️ EL INGLES MANDA: si el nombre ES de una nave coincide con el nombre EN de OTRA, no se
    #    pisa. Pasaba con «velator» (el ES de 33083 se comia el EN de 606, la nave de novato).
    nombres = {}
    chocaron = []
    for s in sorted(naves, key=lambda s: s["i"]):
        nombres[s["n"].lower()] = s["i"]
    for s in sorted(naves, key=lambda s: s["i"]):
        es = s["_es"].lower()
        if not es or es == s["n"].lower():
            continue
        if es in nombres and nombres[es] != s["i"]:
            chocaron.append((es, nombres[es], s["i"]))
            continue
        nombres[es] = s["i"]

    # --- guardas ---
    assert len(ships) > 400, "solo %d naves: algo ha ido mal" % len(ships)
    assert all(s["n"] and s["g"] for s in ships), "hay naves sin nombre o sin grupo"
    bantam = [s for s in ships if s["i"] == 582]
    assert bantam and bantam[0]["n"] == "Bantam", "guarda: la Bantam (582) no aparece"
    print("Naves: %d en %d grupos  ·  ship_names: %d claves" %
          (len(ships), len({s["g"] for s in ships}), len(nombres)))
    print("Guarda: Bantam 582 = %s ✓" % bantam[0]["g"])
    for es, tenia, queria in chocaron:
        print("  nombre ES «%s» ya era el ingles de %d; no se pisa (lo pedia %d)" % (es, tenia, queria))

    # --- diff contra lo que habia ---
    try:
        previo = json.load(io.open(OUT_SHIPS[0], encoding="utf-8"))
    except Exception:
        previo = []
    antes = {s["i"]: s for s in previo}
    ahora = {s["i"]: s for s in ships}
    nuevas = [ahora[i] for i in sorted(set(ahora) - set(antes))]
    fuera = [antes[i] for i in sorted(set(antes) - set(ahora))]
    cambiadas = [(antes[i], ahora[i]) for i in sorted(set(antes) & set(ahora)) if antes[i] != ahora[i]]
    print("\nDiff contra el catalogo actual: +%d  -%d  ~%d" % (len(nuevas), len(fuera), len(cambiadas)))
    for s in nuevas:
        print("  + %6d  %-28s %s" % (s["i"], s["n"], s["g"]))
    for s in fuera:
        print("  - %6d  %-28s %s" % (s["i"], s["n"], s["g"]))
    for v, n in cambiadas:
        print("  ~ %6d  %s → %s  ·  %s → %s" % (v["i"], v["n"], n["n"], v["g"], n["g"]))

    if a.dry:
        print("\n--dry: no se ha escrito nada.")
        return 0

    for p in OUT_SHIPS:
        escribe_min(p, ships)
    escribe_min(OUT_NAMES, nombres)

    # La guarda que de verdad importa: las dos copias IDENTICAS byte a byte.
    a_, b_ = (io.open(p, "rb").read() for p in OUT_SHIPS)
    assert a_ == b_, "las dos copias de ships.json NO han quedado identicas"
    print("\nEscritos:")
    for p in OUT_SHIPS + [OUT_NAMES]:
        print("  %s (%d KB)" % (os.path.relpath(p, RAIZ), os.path.getsize(p) // 1024))
    print("Las dos copias de ships.json son identicas ✓")
    print("⚠️  Si cambio el .json embebido, recompila el Rust (refresca su fecha si cargo no lo ve).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
