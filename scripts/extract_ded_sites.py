#!/usr/bin/env python3
"""Catalogo de complejos con valoracion DED: nombre → rating (X/10) + faccion.

# Por que existe (2026-09-08)

Al disenar la seccion Escalaciones yo iba a pedirle al usuario el rating a mano, y ademas iba a
poner en el formulario «el juego lo llama Nivel N» — porque su captura del cliente enseñaba
«DIFICULTAD: Nivel 5». **Lo tumbo el:** *«para nosotros esa de nivel 5 llamada naval shipyard es
una escalacion 10/10»*. Las dos escalas NO son el mismo numero, y yo estaba a punto de hacer que
la gente copiase el valor equivocado.

Lo que SI identifica el rating es **el titulo del sitio**: quien lee «Astillero naval» sabe que es
una 10/10. Y eso no es folclore — esta en los datos del juego: la valoracion DED viene escrita
dentro de la DESCRIPCION de cada dungeon, en cada idioma.

    "DED Threat Assessment: Extreme (10 of 10)"
    "Evaluacion de amenaza DED: Extrema (10 de 10)"

Comprobado: «Angel Cartel Naval Shipyard» / «Astillero naval del Cartel de los Angeles» sale como
**10/10, faccion 500011** — exactamente lo que el dijo.

➡️ Asi que el formulario NO pregunta el rating: el usuario elige el titulo que ve en su cliente
(en su idioma) y Koru rellena rating y faccion. Un dato menos que teclear y cero ocasiones de
equivocarse.

# Lo que NO cubre, y hay que decirlo en pantalla

Solo **38** dungeons llevan valoracion DED. Las escalaciones de anomalia y las expediciones de
cuatro partes son **sin rating**, y eso no es un hueco del catalogo: es que no tienen. Un sitio que
no este aqui se queda «sin rating», que es la verdad.

⚠️ Y la regla de siempre: si dos dungeons comparten nombre y NO coinciden en rating, se descarta.
Adivinar el rating de un sitio al que vas a entrar es peor que no decirlo.

Uso: python scripts/extract_ded_sites.py
"""
import glob
import io
import json
import os
import re
import sys
import zipfile
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SDE_DIR = os.path.join(os.path.dirname(ROOT), "documentacion", "sde-source")
SALIDA = os.path.join(ROOT, "public", "ded_sites.json")

# Idiomas cuyo nombre se indexa: el usuario copia el titulo TAL COMO lo ve en su cliente.
IDIOMAS = ["en", "es", "de", "fr", "ja", "ko", "ru", "zh"]

PATRONES = [
    re.compile(r"DED Threat Assessment[^(]*\((\w+)\s+of\s+(\d+)\)", re.I),
    re.compile(r"Evaluaci[óo]n de amenaza DED[^(]*\((\w+)\s+de\s+(\d+)\)", re.I),
]
PALABRA = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "uno": 1, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5,
    "seis": 6, "siete": 7, "ocho": 8, "nueve": 9, "diez": 10,
}


def rating_de(desc: dict) -> int | None:
    """La valoracion sale de la descripcion, probando idioma por idioma hasta que una casa."""
    if not isinstance(desc, dict):
        return None
    for texto in desc.values():
        if not texto:
            continue
        for p in PATRONES:
            m = p.search(texto)
            if not m:
                continue
            v = m.group(1).lower()
            r = int(v) if v.isdigit() else PALABRA.get(v)
            if r and 1 <= r <= 10:
                return r
    return None


def main() -> int:
    zips = sorted(glob.glob(os.path.join(SDE_DIR, "*jsonl.zip")))
    if not zips:
        raise SystemExit(f"No hay SDE en {SDE_DIR}")
    ruta = zips[-1]
    print(f"SDE: {os.path.basename(ruta)}\n")

    # nombre_minusculas → conjunto de (rating, faccion). Si un nombre reclama DOS cosas, fuera.
    reclamos: dict[str, set] = defaultdict(set)
    con_rating = 0
    with zipfile.ZipFile(ruta).open("dungeons.jsonl") as f:
        for linea in io.TextIOWrapper(f, "utf-8"):
            o = json.loads(linea)
            r = rating_de(o.get("description") or {})
            if not r:
                continue
            con_rating += 1
            fac = o.get("factionID")
            nombres = o.get("name") or {}
            if not isinstance(nombres, dict):
                continue
            for idi in IDIOMAS:
                v = nombres.get(idi)
                if v and v.strip():
                    # La clave va en minusculas para BUSCAR; el nombre ORIGINAL viaja dentro,
                    # porque es el que se enseña. Sin esto la ficha escribia «astillero naval del
                    # cartel de los angeles» en minusculas y el juego lo pone con mayusculas: se
                    # veia como un dato de segunda mano, que es justo lo contrario de «parece EVE».
                    reclamos[v.strip().lower()].add((r, fac, v.strip()))

    out, ambiguos = {}, 0
    for nombre, opciones in sorted(reclamos.items()):
        if len(opciones) > 1:
            ambiguos += 1
            continue
        r, fac, display = next(iter(opciones))
        out[nombre] = {"r": r, "f": fac, "n": display}

    print(f"dungeons con valoracion DED : {con_rating}")
    print(f"nombres indexados           : {len(out)}  (en {len(IDIOMAS)} idiomas)")
    print(f"descartados por ambiguos    : {ambiguos}")

    with open(SALIDA, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=0, sort_keys=True)
    print(f"\nEscrito: {os.path.relpath(SALIDA, ROOT)}")

    print("\n--- el caso que motivo todo esto ---")
    for t in ("angel cartel naval shipyard", "astillero naval del cártel de los ángeles"):
        v = out.get(t)
        print(f"  {t:<46} → {('DED ' + str(v['r']) + '/10 · faccion ' + str(v['f'])) if v else '❌ NO ESTA'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
