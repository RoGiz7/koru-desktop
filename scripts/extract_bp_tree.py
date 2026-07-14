#!/usr/bin/env python3
# Genera public/bp_tree.json: para cada blueprint, la CATEGORÍA y el GRUPO de INVENTARIO de su
# PRODUCTO (con nombres ES/EN del propio SDE). Es la jerarquía que usa el cliente de EVE en su
# ventana de planos (columna "Grupo": el Bantam Blueprint sale como "Frigate").
#
# POR QUÉ NO EL MARKET GROUP (cazado por RoGiz7 2026-07-14):
#   El árbol de MERCADO de planos de EVE es una antigualla: mete los supercarriers dentro de
#   "Carriers" (Nyx Blueprint → Blueprints & Reactions > Ships > Carriers > Gallente, verificado
#   en EVE Ref). Nuestra jerarquía era idéntica a la de EVE... pero a la EQUIVOCADA. Por grupo de
#   inventario, la Nyx es "Supercarrier" y el Moros "Dreadnought", que es lo que uno espera.
#
# Uso:  python3 scripts/extract_bp_tree.py <sde-jsonl.zip> <dir_public>
# Salida: {"_meta":…, "bp": {bpID: [catID, grpID]}, "cat": {id:{es,en}}, "grp": {id:{es,en}}}

import json
import sys
import zipfile
from pathlib import Path


def load_jsonl(z: zipfile.ZipFile, name: str) -> dict:
    """Lee un .jsonl del SDE → {_key: registro}."""
    out = {}
    with z.open(name) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            out[d["_key"]] = d
    return out


def nm(rec: dict) -> dict:
    """Nombre bilingüe del SDE; si falta el ES, cae al EN (no inventamos traducciones)."""
    n = rec.get("name") or {}
    en = n.get("en") or ""
    return {"es": n.get("es") or en, "en": en}


def main() -> int:
    if len(sys.argv) != 3:
        print("uso: extract_bp_tree.py <sde-jsonl.zip> <dir_public>", file=sys.stderr)
        return 2
    zpath, public = Path(sys.argv[1]), Path(sys.argv[2])
    bp_industry = json.loads((public / "bp_industry.json").read_text(encoding="utf-8"))

    with zipfile.ZipFile(zpath) as z:
        types = load_jsonl(z, "types.jsonl")
        groups = load_jsonl(z, "groups.jsonl")
        cats = load_jsonl(z, "categories.jsonl")

    bp_map, used_g, used_c, sin_producto = {}, set(), set(), 0
    for bid, v in bp_industry.items():
        # El producto sale de manufacturing; si es una fórmula de reacción, de reaction.
        act = v.get("m") or v.get("r")
        out = (act or {}).get("out") or []
        if not out:
            sin_producto += 1
            continue
        prod = out[0][0]
        t = types.get(prod)
        if not t:
            sin_producto += 1
            continue
        gid = t.get("groupID")
        g = groups.get(gid)
        if not g:
            sin_producto += 1
            continue
        cid = g.get("categoryID")
        bp_map[str(bid)] = [cid, gid]
        used_g.add(gid)
        used_c.add(cid)

    out = {
        "_meta": {
            "source": f"SDE {zpath.name} · types/groups/categories.jsonl",
            "note": "Categoria y grupo de INVENTARIO del PRODUCTO de cada blueprint (lo que usa la "
            "ventana de planos del cliente). El market group de planos agrupa mal los supercarriers.",
            "blueprints": len(bp_map),
        },
        "bp": bp_map,
        "cat": {str(c): nm(cats[c]) for c in sorted(used_c) if c in cats},
        "grp": {str(g): nm(groups[g]) for g in sorted(used_g) if g in groups},
    }
    dest = public / "bp_tree.json"
    dest.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"OK -> {dest}: {len(bp_map)} blueprints · {len(used_c)} categorias · {len(used_g)} grupos")
    if sin_producto:
        print(f"   ({sin_producto} blueprints sin producto resoluble: quedan fuera del arbol)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
