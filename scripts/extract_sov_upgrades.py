#!/usr/bin/env python3
"""Genera public/sov_upgrades.json: el catálogo de MEJORAS DE SOBERANÍA (Equinox) del SDE.

Las alianzas publican en hojas de cálculo qué mejora tiene cada sistema (ESI no lo expone) y los
nombres que escriben son EXACTAMENTE los del juego («Major Threat Detection Array 1», «Zydrine
Prospecting Array 3», «Exotic Stability Generator»). Con este catálogo el pegado se resuelve
contra el SDE y una errata sale como «no reconocido», igual que las naves en el intel.

Grupos (categoría 39, sin los «Deprecated» del sistema viejo de iHubs):
  4768 Site Detection (amenazas Minor/Major 1-3 · prospección por mineral 1-3 · exploración 1-3)
  4839 System Effect Generator (Gamma/Plasma/Electric/Exotic)
  4772 Service Infrastructure (cyno, supresión de cyno, logística, supercapitales)
  4838 Colony Resources Management (energía y mano de obra)

Forma: [{i, n (EN), ne (ES), k (clase), lvl (nivel o null), m (mineral EN o null), d (EN), de (ES)}]
  k ∈ amenaza-menor | amenaza-mayor | mineral | exploracion | efecto | servicio | colonia

Uso: python scripts/extract_sov_upgrades.py  (elige el SDE más nuevo de documentacion/sde-source)
"""
import glob
import json
import os
import re
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(os.path.dirname(ROOT), "documentacion", "sde-source")
OUT = os.path.join(ROOT, "public", "sov_upgrades.json")
GRUPOS = {4768, 4839, 4772, 4838}


def limpia(s: str) -> str:
    s = re.sub(r"<[^>]+>", "", s or "")
    s = re.sub(r"\s+", " ", s).strip()
    # Las dos primeras frases bastan para la ficha; el resto es relleno de la descripción.
    partes = re.split(r"(?<=[.!])\s+", s)
    return " ".join(partes[:2]).strip()


def clasifica(nombre: str) -> tuple[str, int | None, str | None]:
    m = re.match(r"(Minor|Major) Threat Detection Array (\d)", nombre)
    if m:
        return ("amenaza-menor" if m.group(1) == "Minor" else "amenaza-mayor", int(m.group(2)), None)
    m = re.match(r"(\w+) Prospecting Array (\d)", nombre)
    if m:
        return ("mineral", int(m.group(2)), m.group(1))
    m = re.match(r"Exploration Detector (\d)", nombre)
    if m:
        return ("exploracion", int(m.group(1)), None)
    if nombre.endswith("Stability Generator"):
        return ("efecto", None, None)
    m = re.match(r"(Power Monitoring Division|Workforce Mecha-Tooling) (\d)", nombre)
    if m:
        return ("colonia", int(m.group(2)), None)
    return ("servicio", None, None)


def main() -> int:
    zips = sorted(glob.glob(os.path.join(SRC, "*jsonl.zip")))
    if not zips:
        print("ERROR: sin SDE jsonl en documentacion/sde-source/")
        return 1
    zpath = zips[-1]
    print(f"SDE elegido: {os.path.basename(zpath)}")
    out: list[dict] = []
    with zipfile.ZipFile(zpath) as z, z.open("types.jsonl") as f:
        for line in f:
            d = json.loads(line)
            if d.get("groupID") not in GRUPOS or not d.get("published"):
                continue
            n = d["name"]
            if n["en"].startswith("Deprecated"):
                continue
            k, lvl, mineral = clasifica(n["en"])
            desc = d.get("description") or {}
            out.append(
                {
                    "i": d["_key"],
                    "n": n["en"],
                    "ne": n.get("es") or n["en"],
                    "k": k,
                    "lvl": lvl,
                    "m": mineral,
                    "d": limpia(desc.get("en", "")),
                    "de": limpia(desc.get("es") or desc.get("en", "")),
                }
            )
    out.sort(key=lambda t: (t["k"], t["m"] or "", t["lvl"] or 0, t["n"]))
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    from collections import Counter

    print(f"{len(out)} mejoras → {os.path.relpath(OUT, ROOT)}  {dict(Counter(t['k'] for t in out))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
