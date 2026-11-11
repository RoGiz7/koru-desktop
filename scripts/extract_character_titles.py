#!/usr/bin/env python3
"""Genera public/character_titles.json desde el SDE: UUID de titulo -> nombre en ES y EN.

PARA QUE SIRVE: ESI devuelve el titulo equipado de un personaje como un UUID, no como texto
(esi/character.rs). Este fichero es lo UNICO que lo convierte en algo legible, y lo leen dos
sitios: el catalogo de titulos de la Bitacora (bitacora.tsx) y la ficha de Personaje
(personaje.tsx). Si falta el UUID, el titulo no se puede ensenar.

* POR QUE EXISTE (2026-11-11). Se mantenia a mano y se habia quedado atras sin que nadie se
  enterara: 43 titulos en el fichero contra 45 en el SDE anterior a la expansion. Los dos que
  faltaban -- "Destroyer of the Pack" y "Wolf Hunter" -- no estaban excluidos a proposito; nunca
  se anadieron. Con Fractured Skies el SDE pasa a 119: la expansion mete 78 logros nuevos y
  6 titulos mas 6 ocultos por cada campana. O sea que el fichero se quedaba a 76 de distancia
  justo en la expansion que va de logros.

LA REGLA: todas las entradas de characterTitles.jsonl, sin filtrar. El SDE las da ya resueltas
  ({"_key": uuid, "name": {"es": ..., "en": ...}}), asi que no hay nada que deducir. Si algun
  titulo no trae espanol, se queda con el ingles en los dos campos y el script lo avisa.

FORMATO: este fichero NO va minificado como el resto de public/. Va una entrada por linea y
  ORDENADO POR EL NOMBRE EN INGLES, que es como estaba y como se lee a ojo cuando hay que
  comprobar uno. Se respeta tal cual para que el diff siga siendo legible.

Uso:  python scripts/extract_character_titles.py [--sde RUTA_ZIP] [--dry]
      --sde  usa ese zip en vez del build mas alto de documentacion/sde-source/
      --dry  no escribe nada, solo dice que cambiaria

LA PRUEBA de que es de fiar: con --sde apuntando al 3667080 (el SDE anterior a la expansion), las
  43 entradas que ya habia salen con el MISMO valor, y las unicas de mas son los dos titulos que
  se habian quedado por el camino.
"""
import argparse
import glob
import io
import json
import os
import sys
import zipfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(RAIZ, "public", "character_titles.json")


def elige_sde(ruta):
    if ruta:
        return ruta
    zips = sorted(glob.glob(os.path.join(RAIZ, "..", "documentacion", "sde-source", "*jsonl.zip")))
    if not zips:
        sys.exit("ERROR: no encuentro el SDE en documentacion/sde-source/*jsonl.zip")
    return zips[-1]


def construye(z):
    titulos, sin_es = {}, []
    with z.open("characterTitles.jsonl") as f:
        for linea in f:
            d = json.loads(linea)
            nombre = d.get("name") or {}
            en = nombre.get("en")
            if not en:
                continue
            es = nombre.get("es")
            if not es:
                sin_es.append(en)
                es = en
            titulos[d["_key"]] = {"es": es, "en": en}
    ordenado = {k: titulos[k] for k in sorted(titulos, key=lambda k: titulos[k]["en"])}
    return ordenado, sin_es


def serializa(titulos):
    """Una entrada por linea y ordenado por nombre EN, que es como estaba el fichero."""
    filas = [
        ' %s: { "es": %s, "en": %s }'
        % (json.dumps(k), json.dumps(v["es"], ensure_ascii=False), json.dumps(v["en"], ensure_ascii=False))
        for k, v in titulos.items()
    ]
    return "{\n" + ",\n".join(filas) + "\n}\n"


def guardas(titulos):
    fallos = []
    if len(titulos) < 40:
        fallos.append("solo %d titulos" % len(titulos))
    malos = [k for k, v in titulos.items() if not v.get("es") or not v.get("en")]
    if malos:
        fallos.append("%d titulos sin nombre (ej. %s)" % (len(malos), malos[:3]))
    # Los UUID son la clave con la que ESI identifica el titulo: si dejan de serlo, el fichero
    # no sirve para nada y mejor enterarse aqui.
    raros = [k for k in titulos if len(k) != 36 or k.count("-") != 4]
    if raros:
        fallos.append("%d claves que no parecen UUID (ej. %s)" % (len(raros), raros[:3]))
    return fallos


def diff(nuevo):
    if not os.path.exists(OUT):
        print("No hay fichero previo: se escribe entero.")
        return
    viejo = json.load(io.open(OUT, encoding="utf-8"))
    alta = [k for k in nuevo if k not in viejo]
    baja = [k for k in viejo if k not in nuevo]
    cam = [(k, viejo[k], nuevo[k]) for k in nuevo if k in viejo and viejo[k] != nuevo[k]]
    print("Titulos: %d -> %d  (+%d  -%d  con el nombre cambiado %d)"
          % (len(viejo), len(nuevo), len(alta), len(baja), len(cam)))
    for k in alta[:25]:
        print("  +  %s" % nuevo[k]["en"])
    if len(alta) > 25:
        print("     ... y %d mas" % (len(alta) - 25))
    for k in baja[:10]:
        print("  -  %s" % viejo[k]["en"])
    for k, a, b in cam[:10]:
        print("  ~  %s / %s  ->  %s / %s" % (a["en"], a["es"], b["en"], b["es"]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sde", default="")
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()

    ruta = elige_sde(args.sde)
    print("SDE elegido: %s" % os.path.basename(ruta))
    with zipfile.ZipFile(ruta) as z:
        titulos, sin_es = construye(z)

    print("Titulos: %d" % len(titulos))
    if sin_es:
        print("  Aviso: %d sin nombre en espanol, se quedan con el ingles (ej. %s)"
              % (len(sin_es), sin_es[:3]))

    fallos = guardas(titulos)
    if fallos:
        for f in fallos:
            print("  GUARDA: %s" % f)
        sys.exit("ERROR: guardas en rojo, no se escribe nada.")
    print("Guardas en verde.")

    print()
    diff(titulos)
    print()

    if args.dry:
        print("--dry: no se ha escrito nada.")
        return
    io.open(OUT, "w", encoding="utf-8").write(serializa(titulos))
    print("Escrito: public/character_titles.json (%d titulos)" % len(titulos))


if __name__ == "__main__":
    main()
