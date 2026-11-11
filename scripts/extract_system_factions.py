#!/usr/bin/env python3
"""Genera public/system-factions.json desde el SDE: sistema -> faccion que lo controla.

Lo consume UNA cosa: la capa "standings" del mapa (src/map.tsx), que colorea cada sistema segun
tu relacion con la faccion que manda alli. O sea que la pregunta que contesta este fichero es
"si salto aqui, de quien es esto", no "quien tiene una oficina".

* POR QUE EXISTE (2026-11-11). Era, junto a neweden.json, uno de los dos ficheros estaticos que
  no salian de ningun script. Fractured Skies lo dejo viejo: la soberania de Starkman y Ezzara
  paso a Minmatar y el fichero seguia diciendo Amarr. Como el mapa no da error cuando el color
  esta mal, eso no se nota nunca -- se mira, se cree, y ya esta.

LA REGLA, deducida del fichero que habia y COMPROBADA contra el (2.665 entradas, 2.665 iguales):
  faccion = la de la CONSTELACION, y si no tiene, la de la REGION.
  El sistema RELEVA a su constelacion solo cuando es un imperio relevando a otro:
  CONCORD no decide, ni como la que entra ni como la que sale.

POR QUE esa excepcion, con los tres casos que la obligan (SDE 3687575, 32 sistemas con faccion
propia distinta de la heredada):
  - 30 son de Exordium: constelacion CONCORD y sistema de un imperio. El fichero historico los
    deja en CONCORD y aqui se respeta -- cambiarlos es una decision de producto aparte, no un
    arreglo, y moveria 30 sistemas de golpe sin que nadie lo haya pedido.
  - Jita hereda Caldari y su sistema dice CONCORD. Dejar que el sistema mandase pintaria el hub
    de comercio mas grande del juego como CONCORD, que no le sirve a nadie para standings.
  - Starkman y Ezzara heredan Amarr y su sistema dice Minmatar. ESTE es el caso de verdad: una
    transferencia de soberania entre imperios, y es justo lo que hay que recoger.

Uso:  python scripts/extract_system_factions.py [--sde RUTA_ZIP] [--dry]
      --sde  usa ese zip en vez del build mas alto de documentacion/sde-source/
      --dry  no escribe nada, solo dice que cambiaria

LA PRUEBA de que es de fiar, y la que hay que repetir si se toca: con --sde apuntando al 3667080
  (el SDE anterior a la expansion) reproduce el fichero que habia, 2.665 de 2.665.
"""
import argparse
import glob
import io
import json
import os
import sys
import zipfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(RAIZ, "public", "system-factions.json")

LIMITE_KSPACE = 11000000
CONCORD = 500006


def elige_sde(ruta):
    if ruta:
        return ruta
    zips = sorted(glob.glob(os.path.join(RAIZ, "..", "documentacion", "sde-source", "*jsonl.zip")))
    if not zips:
        sys.exit("ERROR: no encuentro el SDE en documentacion/sde-source/*jsonl.zip")
    return zips[-1]


def lee(z, fichero):
    with z.open(fichero) as f:
        for linea in f:
            yield json.loads(linea)


def en(valor):
    if isinstance(valor, dict):
        return valor.get("en")
    return valor


def escribe_min(path, dato):
    """JSON minificado y sin salto final, que es como estaba el fichero."""
    io.open(path, "w", encoding="utf-8").write(
        json.dumps(dato, ensure_ascii=False, separators=(",", ":"))
    )


def construye(z):
    con = {d["_key"]: d.get("factionID") for d in lee(z, "mapConstellations.jsonl")}
    reg = {d["_key"]: d.get("factionID") for d in lee(z, "mapRegions.jsonl")}
    out, nombres = {}, {}
    for d in lee(z, "mapSolarSystems.jsonl"):
        if d.get("regionID", 0) >= LIMITE_KSPACE:
            continue
        heredada = con.get(d.get("constellationID")) or reg.get(d.get("regionID"))
        propia = d.get("factionID")
        faccion = heredada
        # Ver "POR QUE esa excepcion" en la cabecera antes de relajar esta condicion.
        if propia and heredada and propia != heredada and propia != CONCORD and heredada != CONCORD:
            faccion = propia
        if faccion:
            out[d["_key"]] = faccion
            nombres[d["_key"]] = en(d.get("name"))
    ordenado = {str(k): out[k] for k in sorted(out)}
    return ordenado, nombres


def guardas(mapa, facciones):
    """Si alguna salta, NO escribas: el SDE ha cambiado de forma."""
    fallos = []
    if len(mapa) < 2500:
        fallos.append("solo %d entradas" % len(mapa))

    # Jita es el canario de "CONCORD no decide": su sistema dice CONCORD y su constelacion
    # Caldari. Si aqui sale 500006, la excepcion se ha roto.
    jita = mapa.get("30000142")
    if jita != 500001:
        fallos.append("Jita sale %r y deberia ser 500001 (Caldari)" % jita)
    amarr = mapa.get("30002187")
    if amarr != 500003:
        fallos.append("Amarr sale %r y deberia ser 500003" % amarr)

    desconocidas = sorted({f for f in mapa.values() if f not in facciones})
    if desconocidas:
        fallos.append("facciones que no existen en factions.jsonl: %s" % desconocidas[:5])
    return fallos


def diff(nuevo, nombres):
    if not os.path.exists(OUT):
        print("No hay fichero previo: se escribe entero.")
        return
    viejo = json.load(io.open(OUT, encoding="utf-8"))
    alta = sorted(set(nuevo) - set(viejo), key=int)
    baja = sorted(set(viejo) - set(nuevo), key=int)
    cam = [(k, viejo[k], nuevo[k]) for k in nuevo if k in viejo and viejo[k] != nuevo[k]]
    print("Sistemas: %d -> %d  (+%d  -%d  cambian de faccion %d)"
          % (len(viejo), len(nuevo), len(alta), len(baja), len(cam)))
    for k in alta[:10]:
        print("  +  %s %s -> %s" % (k, nombres.get(int(k), "?"), nuevo[k]))
    for k in baja[:10]:
        print("  -  %s" % k)
    for k, a, b in cam[:20]:
        print("  ~  %s %s: %s -> %s" % (k, nombres.get(int(k), "?"), a, b))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sde", default="")
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()

    ruta = elige_sde(args.sde)
    print("SDE elegido: %s" % os.path.basename(ruta))
    with zipfile.ZipFile(ruta) as z:
        mapa, nombres = construye(z)
        facciones = {d["_key"] for d in lee(z, "factions.jsonl")}

    print("Facciones por sistema: %d entradas" % len(mapa))
    fallos = guardas(mapa, facciones)
    if fallos:
        for f in fallos:
            print("  GUARDA: %s" % f)
        sys.exit("ERROR: guardas en rojo, no se escribe nada.")
    print("Guardas en verde (Jita Caldari, Amarr Amarr, ninguna faccion inventada).")

    print()
    diff(mapa, nombres)
    print()

    if args.dry:
        print("--dry: no se ha escrito nada.")
        return
    escribe_min(OUT, mapa)
    print("Escrito: public/system-factions.json (%d KB)" % (os.path.getsize(OUT) // 1024))


if __name__ == "__main__":
    main()
