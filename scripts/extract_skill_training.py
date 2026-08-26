#!/usr/bin/env python3
"""Genera public/skill_training.json: rango y atributos de entrenamiento de cada skill (SDE).

★ PARA QUÉ. Es lo único que le falta a Koru para responder «¿cuánto me queda para este nivel?» y
  «¿con cuál de mis nueve personajes sale antes?». Todo lo demás YA está: `/skills` da el nivel y
  los SP actuales de cada skill, y `/attributes` da los atributos del personaje (los dos con
  scopes ya concedidos). Lo que no había en local era la constante del juego.

★ LAS DOS FÓRMULAS que este fichero habilita:
    SP para el nivel L = rango × 250 × 2^(2,5 × (L−1))
      → rango 1: 250 · 1.414 · 8.000 · 45.255 · 256.000 (valores conocidos del juego)
    SP por minuto      = atributo primario + atributo secundario / 2

★ FUENTE DURA, del dogma del SDE (verificado contra el build 3475087, no de memoria):
    275 skillTimeConstant  → el RANGO de la skill (1..16)
    180 primaryAttribute   → id del atributo primario
    181 secondaryAttribute → id del atributo secundario
  Los ids de atributo son 164 charisma · 165 intelligence · 166 memory · 167 perception ·
  168 willpower (nombres leídos de dogmaAttributes.jsonl, no supuestos).

★ QUÉ NO ENTRA AQUÍ, a propósito:
  - Los BOOSTERS no se pueden saber: son temporales y ESI no los expone. El cálculo dirá el
    tiempo con tus atributos, y donde no se vea algo se declara — no se estima.
  - Los IMPLANTES no van en este fichero: son del personaje, no de la skill. Salen de
    `/characters/{id}/implants` (scope ya concedido). ⚠️ PENDIENTE DE COMPROBAR CON DATOS REALES:
    si `/characters/{id}/attributes` ya viene con los implantes sumados, volver a sumarlos daría
    un tiempo optimista que nadie detectaría.
  - Lo que se COMPRA (inyectores) no es tiempo de entrenamiento y no se modela.

Salida: { "<typeID>": {"r": rango, "p": id_primario, "s": id_secundario} }

Uso: python scripts/extract_skill_training.py   (elige el SDE más nuevo de documentacion/sde-source)
"""
import glob
import json
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(os.path.dirname(ROOT), "documentacion", "sde-source")
OUT = os.path.join(ROOT, "public", "skill_training.json")

CATEGORY_SKILL = 16
A_PRIMARY, A_SECONDARY, A_RANK = 180, 181, 275
ATTR_IDS = {164, 165, 166, 167, 168}  # charisma, intelligence, memory, perception, willpower


def main() -> int:
    zips = sorted(glob.glob(os.path.join(SRC, "*jsonl.zip")))
    if not zips:
        print("ERROR: sin SDE jsonl en documentacion/sde-source/")
        return 1
    zpath = zips[-1]
    print(f"SDE elegido: {os.path.basename(zpath)}")

    with zipfile.ZipFile(zpath) as z:
        # Los grupos de la categoría 16 (Skill). No se listan a mano: el SDE manda.
        grupos: set[int] = set()
        with z.open("groups.jsonl") as f:
            for line in f:
                d = json.loads(line)
                if d.get("categoryID") == CATEGORY_SKILL:
                    grupos.add(d["_key"])

        skills: dict[int, str] = {}
        with z.open("types.jsonl") as f:
            for line in f:
                d = json.loads(line)
                if d.get("groupID") not in grupos:
                    continue
                n = d.get("name")
                skills[d["_key"]] = n.get("en") if isinstance(n, dict) else str(n)

        out: dict[str, dict] = {}
        sin_dogma: list[str] = []
        with z.open("typeDogma.jsonl") as f:
            for line in f:
                d = json.loads(line)
                tid = d.get("_key")
                if tid not in skills:
                    continue
                attrs = {a["attributeID"]: a["value"] for a in d.get("dogmaAttributes", [])}
                r, p, s = attrs.get(A_RANK), attrs.get(A_PRIMARY), attrs.get(A_SECONDARY)
                if r is None or p is None or s is None:
                    sin_dogma.append(f"{skills[tid]} ({tid})")
                    continue
                out[str(tid)] = {"r": int(r), "p": int(p), "s": int(s)}

    faltan = [f"{skills[t]} ({t})" for t in skills if str(t) not in out]
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(dict(sorted(out.items(), key=lambda kv: int(kv[0]))), f,
                  ensure_ascii=False, separators=(",", ":"))
    print(f"OK → public/skill_training.json: {len(out)} skills "
          f"({os.path.getsize(OUT)//1024} KB) de {len(skills)} de la categoría Skill")
    if faltan:
        print(f"  sin rango/atributos ({len(faltan)}): {', '.join(faltan)}")

    # ---- GUARDAS. Un extractor que se rompe en silencio es peor que no tenerlo: estos son
    # valores estables del juego, así que si alguno falla es que el SDE cambió de forma. ----
    err = []
    por_nombre = {skills[int(t)]: v for t, v in out.items()}
    for nombre, rango in (("Mechanics", 1), ("Hull Upgrades", 2), ("Shield Management", 3)):
        v = por_nombre.get(nombre)
        if not v:
            err.append(f"falta la skill {nombre}")
        elif v["r"] != rango:
            err.append(f"{nombre}: rango {v['r']}, esperado {rango}")
    malos = [t for t, v in out.items() if v["p"] not in ATTR_IDS or v["s"] not in ATTR_IDS]
    if malos:
        err.append(f"{len(malos)} skills con atributo fuera de 164-168 (p.ej. {malos[:3]})")
    iguales = [t for t, v in out.items() if v["p"] == v["s"]]
    if iguales:
        err.append(f"{len(iguales)} skills con primario == secundario (p.ej. {iguales[:3]})")
    if len(out) < 500:
        err.append(f"solo {len(out)} skills: el SDE trae ~588, algo se está filtrando de más")
    if err:
        print("⚠️ GUARDAS EN ROJO:")
        for e in err:
            print("   -", e)
        return 2
    print("Guardas en verde: rangos conocidos ✓ · atributos en rango ✓ · primario ≠ secundario ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
