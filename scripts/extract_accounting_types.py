#!/usr/bin/env python3
"""Genera public/accounting_types.json: los TIPOS DE MOVIMIENTO del wallet, en ES y EN.

POR QUÉ. El wallet journal de ESI trae un `ref_type` en crudo —`bounty_prizes`,
`planetary_import_tax`, `player_trading`— y hasta ahora Koru lo pintaba tal cual: en inglés, con
guiones bajos y sin traducir en una app que sí es bilingüe. Traducirlos a mano habría sido inventar
177 cadenas y mantenerlas a cada parche.

El SDE del build 3464040 (2026-08-11) publicó `accountingEntryTypes.jsonl` con los 177 tipos y su
nombre en los 8 idiomas del juego. Y —esto es lo que lo hace utilizable— su campo `internalName`
**es exactamente el `ref_type` que devuelve ESI**, así que el cruce es directo y sin heurísticas.

Formato de salida: {internalName: {"es": …, "en": …}}. Solo esos dos idiomas: son los que la app
habla. Se ignora `journalMessage` (la frase completa con {name1}/{name2}); si algún día se quiere la
narración entera del movimiento, está ahí en el SDE.

Uso: python scripts/extract_accounting_types.py   (elige el SDE más nuevo de documentacion/sde-source)
"""
import glob
import json
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(os.path.dirname(ROOT), "documentacion", "sde-source")
OUT = os.path.join(ROOT, "public", "accounting_types.json")

FICHERO = "accountingEntryTypes.jsonl"


def main() -> int:
    zips = sorted(glob.glob(os.path.join(SRC, "*jsonl.zip")))
    if not zips:
        print("ERROR: sin SDE jsonl en documentacion/sde-source/")
        return 1
    zpath = zips[-1]
    print(f"SDE elegido: {os.path.basename(zpath)}")

    with zipfile.ZipFile(zpath) as z:
        if FICHERO not in z.namelist():
            print(f"ERROR: {FICHERO} no está en el zip (¿build anterior al 3464040?)")
            return 1
        filas = [json.loads(l) for l in z.read(FICHERO).decode("utf-8").splitlines()]

    out = {}
    sin_nombre = []
    for f in filas:
        interno = f.get("internalName")
        nombre = f.get("name") or {}
        if not interno:
            continue
        es, en = nombre.get("es"), nombre.get("en")
        if not en:
            sin_nombre.append(interno)
            continue
        # Si faltara el español, se cae al inglés: mejor el nombre oficial en otro idioma que el
        # `ref_type` con guiones bajos, que no es un nombre en ninguno.
        out[interno] = {"es": es or en, "en": en}

    meta = {
        "source": f"SDE {os.path.basename(zpath)} · accountingEntryTypes.jsonl",
        "note": "ref_type del wallet journal de ESI → nombre del movimiento. La clave ES el ref_type.",
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"_meta": meta, "types": out}, fh, ensure_ascii=False, separators=(",", ":"))

    kb = os.path.getsize(OUT) / 1024
    print(f"OK → public/accounting_types.json: {len(out)} tipos ({kb:.1f} KB)")
    if sin_nombre:
        print(f"  aviso: {len(sin_nombre)} sin nombre, fuera: {sin_nombre[:5]}")

    # Guardas: si estos cuatro no salen, el cruce con ESI no vale y hay que mirarlo antes de usarlo.
    for k in ("bounty_prizes", "market_transaction", "player_trading", "industry_job_tax"):
        v = out.get(k)
        print(f"  Guarda {k}: {v['es'] if v else '❌ FALTA'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
