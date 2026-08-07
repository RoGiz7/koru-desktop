#!/usr/bin/env python3
"""Genera public/type_volumes.json y public/type_volumes_assembled.json: m³ por typeID.

Universo: **TODOS los tipos publicados del SDE** (~26.000).

⚠️ CAMBIO DE ALCANCE (2026-08-07, pilar de transporte). Antes eran solo los tipos de
`bp_industry.json` (~6.800), y tenía sentido cuando esto solo servía a la lista de la compra de
industria. Pero el transporte tiene que poder decir cuánto ocupa CUALQUIER cosa que muevas —
mineral, productos de PI, naves, módulos, munición—, y con el universo viejo no salían ni las
menas. El fichero pasa de ~87 KB a ~350 KB, que para lo que da es barato.

DOS FICHEROS, y la diferencia importa:
  · `type_volumes.json`      → volumen **REEMPAQUETADO**: el que ocupa al transportarlo. Es el que
    hay que usar para «¿cuántos viajes son?».
  · `type_volumes_assembled.json` → volumen **MONTADO**, solo para los tipos donde difiere (naves,
    sobre todo). Es el que ocupa algo que ya está montado dentro de una bodega.
Confundirlos hace que Koru diga que cabe algo que no cabe, y eso se descubre en la estación con el
carguero delante. Quién usa cuál lo decide `is_singleton` de los assets.

Fuentes, por orden:
  1. SDE types.jsonl (documentacion/sde-source/*.jsonl.zip) → volume normal.
  2. Hoboleaks repackagedvolumes.json → OVERRIDE: el volumen REEMPAQUETADO, que es el que ocupa de
     verdad en la bodega al transportar (y Hoboleaks avisa de que el del SDE está mal para estos).

⚠️ DEPENDENCIA DE TERCEROS (Hoboleaks): solo afecta a la regeneración, el resultado queda congelado.

Uso: python scripts/extract_type_volumes.py
"""
import glob
import json
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DOCS = os.path.join(os.path.dirname(ROOT), "documentacion")
OUT = os.path.join(ROOT, "public", "type_volumes.json")


def main() -> int:
    # 1. Volumen del SDE de TODO lo publicado.
    # Pueden convivir varios builds en sde-source: elegir SIEMPRE el más nuevo (número más alto).
    zips = sorted(glob.glob(os.path.join(DOCS, "sde-source", "*jsonl.zip")))
    if not zips:
        print("ERROR: no encuentro el SDE jsonl.zip en documentacion/sde-source/")
        return 1
    print(f"SDE elegido: {os.path.basename(zips[-1])}")
    # `montado` = el valor tal cual del SDE: lo que ocupa algo YA MONTADO dentro de una bodega.
    montado: dict[int, float] = {}
    with zipfile.ZipFile(zips[-1]) as z, z.open("types.jsonl") as f:
        for line in f:
            d = json.loads(line)
            k = d.get("_key")
            if d.get("published") and isinstance(d.get("volume"), (int, float)) and d["volume"]:
                montado[k] = float(d["volume"])
    print(f"tipos publicados con volumen: {len(montado)}")

    # 2. Override reempaquetado (Hoboleaks): lo que ocupa AL TRANSPORTARLO.
    vols = dict(montado)
    with open(os.path.join(DOCS, "hoboleaks", "repackagedvolumes.json"), encoding="utf-8") as f:
        rep = json.load(f)
    overrides = 0
    for k, v in rep.items():
        k = int(k)
        if k in vols:
            vols[k] = float(v)
            overrides += 1
    print(f"overrides reempaquetados aplicados: {overrides}")

    # 3. Segundo fichero: SOLO donde montado ≠ reempaquetado. Son un puñado (naves, sobre todo), así
    #    que no se duplican 26.000 números que serían idénticos.
    dif = {k: montado[k] for k in vols if abs(montado[k] - vols[k]) > 1e-9}
    out_asm = os.path.join(ROOT, "public", "type_volumes_assembled.json")
    with open(out_asm, "w", encoding="utf-8") as f:
        json.dump({str(k): v for k, v in sorted(dif.items())}, f, separators=(",", ":"))
    print(
        f"OK → public/type_volumes_assembled.json "
        f"({os.path.getsize(out_asm) // 1024} KB, {len(dif)} tipos donde difiere)"
    )

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({str(k): v for k, v in sorted(vols.items())}, f, separators=(",", ":"))
    print(f"OK → public/type_volumes.json ({os.path.getsize(OUT)//1024} KB)")

    # Guardas contra el juego. Si alguna falla, el SDE cambió de forma: NO publicar el fichero.
    assert abs(vols[34] - 0.01) < 1e-9, vols.get(34)
    print("Guarda: Tritanium 0.01 m³ ✓")
    # Veldspar 0,1 m³ — comprueba que el universo ya NO es solo industria (las menas no estaban).
    assert abs(vols[1230] - 0.1) < 1e-9, vols.get(1230)
    print("Guarda: Veldspar 0,1 m³ ✓ (universo ampliado: antes ni salía)")
    # Bestower: 20.000 m³ empaquetado contra 260.000 montado (verificado 2026-08-07 contra el SDE;
    # el 4.000 que puse primero era de memoria y estaba MAL — la guarda lo cazó). Es EL caso que
    # justifica los dos ficheros: confundirlos sería errar por trece veces el tamaño.
    assert abs(vols[1944] - 20000.0) < 1e-6, vols.get(1944)
    assert abs(dif[1944] - 260000.0) < 1e-6, dif.get(1944)
    print("Guarda: Bestower 20.000 m³ empaquetado vs 260.000 montado ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
