#!/usr/bin/env python3
"""Genera public/military_campaigns.json: definiciones de las Military Campaigns (Cradle of War).

Fuente: SDE `militaryCampaigns.jsonl` + `militaryCampaignObjectives.jsonl` (claves = las MISMAS
UUIDs que devuelven las rutas ESI /military-campaigns — devblog 2026-08-04). ESI da el estado VIVO
(progreso, participación); esto da los textos (ES/EN), recompensas y métodos de contribución.

⚠️ El SDE solo exporta definiciones de campañas RECIENTEMENTE ACTIVAS y se reconstruye 1 vez/día:
una campaña puede existir en ESI sin definición aquí → el frontend trata la ausencia como NORMAL.

Uso: python scripts/extract_military_campaigns.py  (elige el SDE más nuevo de documentacion/sde-source)
"""
import glob
import json
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(os.path.dirname(ROOT), "documentacion", "sde-source")
OUT = os.path.join(ROOT, "public", "military_campaigns.json")


def loc(d: dict | None) -> dict:
    """Se queda con ES/EN de un texto localizado (el HTML showinfo lo limpia el frontend)."""
    d = d or {}
    return {"es": d.get("es") or d.get("en") or "", "en": d.get("en") or ""}


def main() -> int:
    zips = sorted(glob.glob(os.path.join(SRC, "*jsonl.zip")))
    if not zips:
        print("ERROR: sin SDE jsonl en documentacion/sde-source/")
        return 1
    zpath = zips[-1]
    print(f"SDE elegido: {os.path.basename(zpath)}")

    camps: dict[str, dict] = {}
    objs: dict[str, dict] = {}
    with zipfile.ZipFile(zpath) as z:
        with z.open("militaryCampaigns.jsonl") as f:
            for line in f:
                d = json.loads(line)
                camps[d["_key"]] = {
                    "t": loc(d.get("title")),
                    "s": loc(d.get("subtitle")),
                    "target": d.get("targetProgress"),
                    "faction": (d.get("issuer") or {}).get("factionID"),
                }
        with z.open("militaryCampaignObjectives.jsonl") as f:
            for line in f:
                d = json.loads(line)
                rw = d.get("rewards") or {}
                ann = d.get("annotations") or {}
                objs[d["_key"]] = {
                    "camp": d.get("campaignID"),
                    "career": d.get("careerPath"),
                    "method": (d.get("contributionMethodConfiguration") or {}).get("name"),
                    "t": loc(d.get("title")),
                    "s": loc(d.get("subtitle")),
                    "target": d.get("targetProgress"),
                    "max_per": d.get("maxProgressPerParticipant"),
                    # Recompensas por intervalo de progreso (las 92 traen las tres).
                    "isk": (rw.get("isk") or {}).get("amountPerInterval"),
                    "lp": (rw.get("lp") or {}).get("amountPerInterval"),
                    "standing": (rw.get("standing") or {}).get("gainPercentPerInterval"),
                    "interval": (rw.get("isk") or {}).get("progressInterval"),
                    # Solo para milicianos: facción cuya milicia exige el objetivo (o null).
                    "militia": ann.get("requiredEnlistmentWithFactionID"),
                }

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"camps": camps, "objs": objs}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"OK → public/military_campaigns.json: {len(camps)} campañas · {len(objs)} objetivos "
          f"({os.path.getsize(OUT)//1024} KB)")

    # Guardas: datos verificados a mano del build 3448696.
    assert all(v["faction"] in (500001, 500002, 500003, 500004) for v in camps.values())
    militia = sum(1 for o in objs.values() if o["militia"])
    assert militia > 0, "esperaba objetivos de milicia"
    assert all(o["camp"] in camps or o["camp"] is None for o in objs.values()), "objetivo huérfano"
    print(f"Guardas: 4 facciones ✓ · {militia} objetivos de milicia ✓ · sin huérfanos ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
