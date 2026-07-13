# Pipeline R3 del PILAR INDUSTRIAL (ver documentacion/RESEARCH_INDUSTRIA.md):
# destila del SDE (zip jsonl) los datos de industria a JSONs compactos para public/.
#
#   python extract_industry_sde.py <ruta-al-zip-jsonl> <ruta-a-public>
#
# Genera:
#   public/bp_industry.json   — blueprint typeID → actividades compactas:
#       m/r = manufacturing/reaction: {t: seg, in: [[typeID,qty]…], out: [[typeID,qty]…], sk: [[skillID,lvl]…]}
#       i   = invention:              {t, in, out: [[typeID,qty,probabilidad]…], sk}
#       c   = tiempo de copia (seg) · max = maxProductionLimit
#   public/pi_schematics.json — esquema PI → {n: {es,en}, t: seg/ciclo, in: [[typeID,qty]…], out: [typeID,qty], pins}
#
# Formato en ARRAYS a propósito (mismo espíritu que neweden.json): compacto y estable.
# planetResources.jsonl NO se extrae: es de soberanía Equinox (power/workforce/reagent por
# planeta), no de PI. Los nombres de tipos ya viven en market_types.json; aquí solo IDs.
import json
import sys
import zipfile
from pathlib import Path


def compact_activity(a: dict, with_prob: bool) -> dict:
    out: dict = {"t": a.get("time", 0)}
    if a.get("materials"):
        out["in"] = [[m["typeID"], m["quantity"]] for m in a["materials"]]
    prods = a.get("products") or []
    if prods:
        if with_prob:
            out["out"] = [[p["typeID"], p["quantity"], p.get("probability", 1.0)] for p in prods]
        else:
            out["out"] = [[p["typeID"], p["quantity"]] for p in prods]
    if a.get("skills"):
        out["sk"] = [[s["typeID"], s["level"]] for s in a["skills"]]
    return out


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 1
    zpath, public = Path(sys.argv[1]), Path(sys.argv[2])
    bps: dict = {}
    pis: dict = {}
    with zipfile.ZipFile(zpath) as z:
        with z.open("blueprints.jsonl") as f:
            for line in f:
                row = json.loads(line)
                acts = row.get("activities") or {}
                entry: dict = {}
                if "manufacturing" in acts:
                    entry["m"] = compact_activity(acts["manufacturing"], with_prob=False)
                if "reaction" in acts:
                    entry["r"] = compact_activity(acts["reaction"], with_prob=False)
                if "invention" in acts:
                    entry["i"] = compact_activity(acts["invention"], with_prob=True)
                if "copying" in acts:
                    entry["c"] = acts["copying"].get("time", 0)
                if row.get("maxProductionLimit"):
                    entry["max"] = row["maxProductionLimit"]
                # Solo blueprints con alguna actividad útil (los hay vacíos/legacy).
                if entry:
                    bps[str(row["blueprintTypeID"])] = entry
        with z.open("planetSchematics.jsonl") as f:
            for line in f:
                row = json.loads(line)
                name = row.get("name") or {}
                inputs = [[t["_key"], t["quantity"]] for t in row.get("types", []) if t.get("isInput")]
                outs = [t for t in row.get("types", []) if not t.get("isInput")]
                if not outs:
                    continue
                pis[str(row["_key"])] = {
                    "n": {"es": name.get("es", ""), "en": name.get("en", "")},
                    "t": row.get("cycleTime", 0),
                    "in": inputs,
                    "out": [outs[0]["_key"], outs[0]["quantity"]],
                    "pins": row.get("pins", []),
                }

    public.mkdir(parents=True, exist_ok=True)
    bp_path = public / "bp_industry.json"
    pi_path = public / "pi_schematics.json"
    bp_path.write_text(json.dumps(bps, separators=(",", ":")), encoding="utf-8")
    pi_path.write_text(json.dumps(pis, separators=(",", ":")), encoding="utf-8")
    print(f"bp_industry.json: {len(bps)} blueprints · {bp_path.stat().st_size / 1e6:.2f} MB")
    print(f"pi_schematics.json: {len(pis)} esquemas · {pi_path.stat().st_size / 1e3:.1f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
