#!/usr/bin/env python3
"""Genera public/jumpships.json: las naves con motor de salto, para el planificador de salto y el
plan de escalaciones.

POR QUÉ EXISTE (2026-11-26): `jumpships.json` era uno de los siete ficheros de `public/` sin
generador. Medido contra el SDE 3749835 coincidía campo a campo con el SDE, pero nadie podía
rehacerlo, y le faltaba un dato que ya hacía daño: la rebaja de fatiga de cada casco. El
planificador la adivinaba por NOMBRE DE GRUPO y solo conocía dos; a una Black Ops no le rebajaba
nada.

Universo: los tipos PUBLICADOS de la categoría Ship (6) con alcance de salto (atributo 867). El SDE
tiene dos tipos publicados más con esos atributos y NO son naves: los jump bridge (27897 y 35841),
que son estructuras. Por eso el filtro es la categoría, no «tiene el atributo».

Campos por nave (`ships`, ordenadas por (grupo, nombre), en inglés como el SDE):
  · range     = 867 `jumpDriveRange`, años luz, SIN skills (Jump Drive Calibration lo sube).
  · fuelPerLy = 868 `jumpDriveConsumptionAmount`, isótopos por año luz, sin skills.
  · isotope   = el nombre del tipo al que apunta 866 `jumpDriveConsumptionType`.
  · fatMult   = 1971 `jumpFatigueMultiplier`; 1 si la nave no lo lleva. Multiplica la DISTANCIA
                antes de las dos fórmulas (cooldown y fatiga). Medido en el 3749835: las Black Ops
                0,25, los Jump Freighter y la Rorqual 0,1, el resto no lo lleva.
                El 1972 (para quien cruza un portal) no se saca: nadie lo lee todavía.

`cynos`: los generadores de campo cynosural con su ciclo (atributo 73, `duration`, en ms → min).
El ciclo es lo que el cyno queda clavado al llegar el que salta. Es el valor BASE: hay cascos que
lo acortan y Koru no los modela, por eso la ficha de «forma de viajar» deja cambiarlo.

⚠️ EL FORMATO DE SALIDA ES RARO A PROPÓSITO: una clave por línea y sin sangría
   (`json.dump(..., indent=0)`), y sin salto de línea final. No es el de los demás ficheros, pero es
   el que tenía el fichero hecho a mano, y la prueba de oro exige reproducirlo byte a byte.

Uso: python scripts/extract_jumpships.py [<zip del SDE>]
     python scripts/extract_jumpships.py --prueba-de-oro <salida> [<zip>]
       → escribe en <salida> el fichero SIN los campos nuevos (`fatMult`, `cynos`), que es el
         fichero hecho a mano de antes del 26-11. Con el SDE 3749835 tiene que salir idéntico,
         byte a byte, al `jumpships.json` de `a3b330a`. Es la prueba de que el generador lee el SDE
         igual que quien hizo el fichero a mano, antes de fiarse de lo que añade.
"""
import glob
import json
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DOCS = os.path.join(os.path.dirname(ROOT), "documentacion")
OUT = os.path.join(ROOT, "public", "jumpships.json")

CATEGORIA_NAVE = 6
ATR_ISOTOPO, ATR_ALCANCE, ATR_CONSUMO, ATR_FATIGA = 866, 867, 868, 1971
ATR_DURACION = 73
# Los generadores de cyno: normal, covert e industrial. Lista blanca y no un filtro por grupo: el
# grupo de los cyno incluye otras cosas (inhibidores, balizas) que no son un ciclo que esperar.
CYNOS = [21096, 28646, 52694]


def main() -> int:
    # En la consola de Windows (cp1252) el «→» y el «✓» de abajo revientan al imprimirse y el
    # traceback tapa el veredicto: parece que falló cuando pasó (la trampa de audit_i18n en CLAUDE.md).
    sys.stdout.reconfigure(encoding="utf-8")
    args = sys.argv[1:]
    oro = None
    if args[:1] == ["--prueba-de-oro"]:
        oro, args = args[1], args[2:]
    if args:
        zpath = args[0]
    else:
        zips = sorted(glob.glob(os.path.join(DOCS, "sde-source", "*jsonl.zip")))
        if not zips:
            print("ERROR: no encuentro el SDE en documentacion/sde-source/*jsonl.zip", file=sys.stderr)
            return 1
        zpath = zips[-1]
    print(f"SDE elegido: {os.path.basename(zpath)}")
    z = zipfile.ZipFile(zpath)

    grupos: dict[int, tuple[int, str]] = {}
    with z.open("groups.jsonl") as f:
        for line in f:
            d = json.loads(line)
            grupos[d["_key"]] = (d.get("categoryID"), (d.get("name") or {}).get("en", ""))

    tipos: dict[int, tuple[int, str, bool]] = {}
    with z.open("types.jsonl") as f:
        for line in f:
            d = json.loads(line)
            tipos[d["_key"]] = (d.get("groupID"), (d.get("name") or {}).get("en", ""), bool(d.get("published")))

    dogma: dict[int, dict[int, float]] = {}
    with z.open("typeDogma.jsonl") as f:
        for line in f:
            d = json.loads(line)
            attrs = {a["attributeID"]: a["value"] for a in d.get("dogmaAttributes") or []}
            if ATR_ALCANCE in attrs or d["_key"] in CYNOS:
                dogma[d["_key"]] = attrs

    ships = []
    descartados = []
    for tid, attrs in dogma.items():
        if ATR_ALCANCE not in attrs:
            continue
        gid, nombre, publicado = tipos.get(tid, (None, "", False))
        if not publicado:
            continue
        cat, grupo = grupos.get(gid, (None, ""))
        if cat != CATEGORIA_NAVE:
            descartados.append((tid, nombre))
            continue
        iso_id = int(attrs[ATR_ISOTOPO])
        consumo = attrs[ATR_CONSUMO]
        ships.append(
            {
                "id": tid,
                "name": nombre,
                "group": grupo,
                "range": float(attrs[ATR_ALCANCE]),
                "fuelPerLy": int(consumo) if float(consumo).is_integer() else consumo,
                "isotope": tipos[iso_id][1],
                "fatMult": attrs.get(ATR_FATIGA, 1),
            }
        )
    ships.sort(key=lambda s: (s["group"], s["name"]))

    cynos = []
    for tid in CYNOS:
        ms = dogma[tid][ATR_DURACION]
        cynos.append({"id": tid, "name": tipos[tid][1], "cycleMin": int(ms / 60000) if (ms / 60000).is_integer() else ms / 60000})

    if oro:
        viejo = {"ships": [{k: v for k, v in s.items() if k != "fatMult"} for s in ships]}
        with open(oro, "w", encoding="utf-8", newline="\n") as f:
            json.dump(viejo, f, indent=0, ensure_ascii=False)
        print(f"Prueba de oro → {oro}")
        return 0
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"ships": ships, "cynos": cynos}, f, indent=0, ensure_ascii=False)
    print(f"OK → public/jumpships.json ({len(ships)} naves, {len(cynos)} cynos)")
    print(f"Fuera por no ser naves: {descartados}")

    # Guardas contra el juego. Si alguna falla, el SDE cambió de forma: NO publicar.
    por_id = {s["id"]: s for s in ships}
    assert sorted(t for t, _ in descartados) == [27897, 35841], descartados
    print("Guarda: los dos jump bridge se quedan fuera ✓")
    blops = [s for s in ships if s["group"] == "Black Ops"]
    assert len(blops) == 6 and all(s["fatMult"] == 0.25 for s in blops), blops
    print("Guarda: las 6 Black Ops con fatMult 0,25 ✓")
    jf = [s for s in ships if s["group"] == "Jump Freighter"]
    assert len(jf) == 4 and all(s["fatMult"] == 0.1 for s in jf), jf
    assert por_id[28352]["fatMult"] == 0.1, por_id.get(28352)
    print("Guarda: los 4 Jump Freighter y la Rorqual con fatMult 0,1 ✓")
    rebajadas = [s for s in ships if s["fatMult"] != 1]
    assert len(rebajadas) == 11, [s["name"] for s in rebajadas]
    print("Guarda: ninguna otra nave rebaja la fatiga ✓")
    assert [c["cycleMin"] for c in cynos] == [10, 1, 10], cynos
    print("Guarda: cyno normal 10 min, covert 1, industrial 10 ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
