#!/usr/bin/env python3
"""Nombres de SISTEMA, REGION y CONSTELACION en otros idiomas, para que el intel los reconozca.

## Por que existe (2026-09-19). Pregunta de RoGiz7

Al medir un chatlog trilingue real quedo claro que Koru ya reconocia las NAVES chinas pero no los
SITIOS: `静寂谷` es Vale of the Silent y `对舞之域` es Geminate, y `neweden.json` solo trae ingles.
El pregunto lo correcto: *«es importante que el sistema si se sepa, ¿lo tenemos en el SDE para
añadir?»*. Si: `mapSolarSystems.jsonl`, `mapRegions.jsonl` y `mapConstellations.jsonl` traen
`name.{de,en,es,fr,ja,ko,ru,zh}`, igual que `types.jsonl`.

★ Y esto pesa MAS que traducir los nombres de nave, porque **un sistema sin reconocer no dispara
  aviso**. Una nave mal escrita se lee raro; un sistema mal leido es una alarma que no suena.

## Lo que hace

Escribe `public/place_names_i18n.json` = {"sistemas": {nombre: id}, "zonas": {nombre: id}},
en minusculas, SOLO con los nombres que difieren del ingles (los demas ya los reconoce
`neweden.json`, y repetirlos seria engordar el fichero para nada).

## ⚠️ LAS CINCO REGLAS QUE LO HACEN SEGURO

Las dos primeras son las de `extract_ship_names_i18n.py`; las otras tres salieron de medir.

1. **Lo AMBIGUO se descarta.** Si una clave apunta a dos sitios distintos, fuera. 🚨 Esto no es
   teorico: el japones y el coreano **colapsan sistemas distintos en la misma clave** porque
   transliteran por sonido — `オンスー` es Aunsou *y* Onsooh, `パーラ` es Paala *y* Paara. El chino
   usa caracteres con significado y no se mezcla (0 ambiguas de 2.373). Meter un aviso en el
   sistema equivocado es lo peor que puede pasar en el intel: mejor no reconocerlo.
2. **LA NAVE GANA AL SITIO, SIEMPRE.** Es la misma regla que ya explica `zonasDe` en intel.ts
   —`Basilisk` es el logi que hay que reventar, no la constelacion— y aqui hace falta por partida
   doble: en `classifyWord` el SISTEMA se resuelve ANTES que la nave, asi que una clave de sitio
   que choque con el catalogo de naves le robaria la nave al troceador. En chino choca una
   (`狮鹫级`, la constelacion Griffin, que se escribe igual que la nave Griffin); en japones 13 y
   en coreano 10.
3. **Nada que choque con un nombre INGLES** de sistema o de zona. Hoy son cero, pero la regla
   tiene que existir antes de que un export del SDE la necesite.
4. 🚨 **SOLO ENTRA LO QUE NO SEA ASCII.** Esta regla empezo siendo tres y se quedo en una al
   medirlas: **de lo que se escribe en alfabeto latino, no habia NADA que ganar y si cosas que
   perder.** Los tres casos que aparecieron:

   a) **Fallos del SDE que meterian datos FALSOS.** El sistema `J170376` tiene como nombre japones
      `J140208`… que es **otro agujero de gusano REAL**. La constelacion `LLAP-1` se llama
      `014U-A`. Un aviso cantado en J140208 se archivaria en J170376: el peor fallo posible aqui.
      (Primero escribi que estos codigos eran truncamientos del cliente y que convenia
      reconocerlos. Medido, es falso.)

   b) **Envenenan el indice de abreviaturas, quitando algo que HOY funciona.** `sistemaAbreviado`
      resuelve por prefijo unico, asi que cada clave nueva puede volver ambiguo un prefijo:
          `me-pq`             -> `me-`  dejaba de resolver a ME-4IU
          `m-sru`             -> `m-sr` dejaba de resolver a M-SRKS
          `el crisol`         -> `cen`/`cent` dejaban de resolver a Central Point
          `gesegnete vidette` -> `ges`  dejaba de resolver a Gesh
      Una regla que le quita algo a alguien no entra. Medido: con esta regla, **0 abreviaturas se
      rompen y 0 cambian de destino**.

   c) **Y encima no iban a acertar nunca.** `classifyWord` casa TOKEN A TOKEN y no hay ningun
      `sistemaDesde` multipalabra (para naves si lo hay, `naveDesde`). Un `barbican liberado` o un
      `distrito de manifest` no se pueden reconocer aunque esten en el indice.

   Las palabras latinas sueltas (`refuge`, `leumund`, `zuflucht`, `madriguera`, `reflexion`)
   caen con la misma regla, y ademas podrian ser el nombre de un piloto.

   ★ El beneficio de todo esto es CJK y esta medido: 2.373 claves en chino, ~2.350 en japones y
   coreano. Lo latino eran 24 claves entre los cuatro idiomas restantes. Se pierde poco y se gana
   no poder romper nada: **una clave no ASCII no puede chocar con un prefijo ASCII ni pasar por el
   nombre de un piloto latino.** Seguro por construccion, no por revision.

5. **Las regiones mandan sobre las constelaciones**, igual que en `zonasDe`: es lo que la gente
   nombra en el intel.

El nombre que se ENSEÑA sigue siendo el ingles: aqui solo se añade por donde entra. Misma decision
que con las naves.

Uso:
    python scripts/extract_places_i18n.py            # los siete idiomas
    python scripts/extract_places_i18n.py zh ru      # los que digas
"""
import glob
import io
import json
import os
import re
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SDE_DIR = os.path.join(os.path.dirname(ROOT), "documentacion", "sde-source")
SALIDA = os.path.join(ROOT, "public", "place_names_i18n.json")

IDIOMAS_POR_DEFECTO = ["de", "es", "fr", "ja", "ko", "ru", "zh"]
FICHEROS = [
    # El orden importa: lo de abajo pisa a lo de arriba cuando no hay ambiguedad de destino.
    ("mapSolarSystems.jsonl", "sistemas"),
    ("mapConstellations.jsonl", "zonas"),
    ("mapRegions.jsonl", "zonas"),
]
# Todo ASCII = no aporta y puede romper (regla 4). Lo que entra lleva al menos un caracter fuera.
SOLO_ASCII = re.compile(r"^[ -~]+$")


def sde_mas_reciente() -> str:
    zips = sorted(glob.glob(os.path.join(SDE_DIR, "*-jsonl.zip")))
    if not zips:
        sys.exit(f"No hay ningun SDE en {SDE_DIR}")
    return zips[-1]


def lee(z: zipfile.ZipFile, nombre: str):
    with z.open(nombre) as f:
        for linea in io.TextIOWrapper(f, encoding="utf-8"):
            linea = linea.strip()
            if linea:
                yield json.loads(linea)


def main() -> None:
    idiomas = sys.argv[1:] or IDIOMAS_POR_DEFECTO
    zpath = sde_mas_reciente()
    print(f"SDE: {os.path.basename(zpath)}")
    print(f"Idiomas: {', '.join(idiomas)}")

    ne = json.load(open(os.path.join(ROOT, "public", "neweden.json"), encoding="utf-8"))
    en_sis = {s["n"].lower() for s in ne["systems"]}
    en_zona = {z["n"].lower() for k in ("regions", "constellations") for z in ne.get(k, [])}
    naves = set(json.load(open(os.path.join(ROOT, "public", "ship_names.json"), encoding="utf-8")))
    ruta_i18n = os.path.join(ROOT, "public", "ship_names_i18n.json")
    if os.path.exists(ruta_i18n):
        naves |= set(json.load(open(ruta_i18n, encoding="utf-8")))
    print(f"Catalogo ingles: {len(en_sis)} sistemas · {len(en_zona)} zonas · {len(naves)} naves")

    # clave -> {"tipo": sistemas|zonas, "ids": {id}, "en": {nombre_en}}
    crudo: dict[str, dict] = {}
    with zipfile.ZipFile(zpath) as z:
        for fichero, tipo in FICHEROS:
            for fila in lee(z, fichero):
                n = fila.get("name") or {}
                ingles = n.get("en")
                if not ingles:
                    continue
                for lg in idiomas:
                    v = n.get(lg)
                    if not v or v == ingles:
                        continue
                    k = v.lower()
                    e = crudo.setdefault(k, {"tipo": tipo, "ids": set(), "en": set()})
                    e["tipo"] = tipo  # gana el ultimo fichero: regiones > constelaciones
                    e["ids"].add(fila["_key"])
                    e["en"].add(ingles)

    fuera = {"ambigua": [], "nave": [], "ingles": [], "ascii": []}
    salida = {"sistemas": {}, "zonas": {}}
    for k, e in sorted(crudo.items()):
        if len(e["ids"]) > 1:
            fuera["ambigua"].append((k, sorted(e["en"])))
            continue
        if k in naves:
            fuera["nave"].append(k)
            continue
        if k in en_sis or k in en_zona:
            fuera["ingles"].append(k)
            continue
        if SOLO_ASCII.fullmatch(k):
            fuera["ascii"].append((k, sorted(e["en"])[0]))
            continue
        salida[e["tipo"]][k] = next(iter(e["ids"]))

    with open(SALIDA, "w", encoding="utf-8") as f:
        json.dump(salida, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)

    print(f"\nEscrito {SALIDA}")
    print(f"  sistemas: {len(salida['sistemas'])}")
    print(f"  zonas   : {len(salida['zonas'])}")
    print(f"  tamaño  : {os.path.getsize(SALIDA) // 1024} KB")
    print("\nDescartado a proposito (ver las cinco reglas de la cabecera):")
    print(f"  ambiguas (una clave -> varios sitios): {len(fuera['ambigua'])}")
    for k, ens in fuera["ambigua"][:12]:
        print(f"      {k}  ->  {', '.join(ens)}")
    print(f"  chocan con el catalogo de NAVES      : {len(fuera['nave'])}  {fuera['nave'][:10]}")
    print(f"  chocan con un nombre INGLES          : {len(fuera['ingles'])}  {fuera['ingles'][:10]}")
    print(f"  en alfabeto latino (ver regla 4)     : {len(fuera['ascii'])}")
    for k, en1 in fuera["ascii"]:
        print(f"      {en1}  ->  {k}")


if __name__ == "__main__":
    main()
