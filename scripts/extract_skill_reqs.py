#!/usr/bin/env python3
"""Genera public/skill_reqs.json: qué skills (y a qué nivel) pide cada tipo para usarlo.

Lo lee el skill-check de Fiteos y de assets (`src/fit.tsx`, `src/assets.tsx`): «¿puedes volarlo?».

★ «NO PIDE NADA» Y «NO LO CONOZCO» SON DOS RESPUESTAS (26-11, tercer tiempo de los huérfanos).
  Antes, un tipo que no estaba aquí contaba como «no pide nada» y la pantalla decía «puedes
  volarlo»: el próximo SDE con módulos nuevos habría vuelto a mentir. Ahora:
    · `"id": [[skill, nivel], …]` → pide eso;
    · `"id": []`                  → Koru lo conoce y NO pide nada;
    · que falte la clave          → Koru NO lo conoce.
  Las entradas `[]` solo se escriben para lo que se fitea o se vuela (`UNIVERSO_SIN_REQUISITOS`):
  meter todo el SDE triplicaría el fichero por tipos que nunca pasan por el skill-check.

POR QUÉ EXISTE (2026-11-26): se hizo a mano en junio. Contra el SDE 3749835 le faltaban 259 tipos
(entre ellos 7 naves publicadas, 23 módulos y 66 implantes) y 11 drones T2 no llevaban la skill
nueva que piden.

Regla: todo tipo de `typeDogma` con alguno de los seis pares «skill requerida / nivel», en este
orden: 182/277 · 183/278 · 184/279 · 1285/1286 · 1289/1287 · 1290/1288. Cada requisito es
[skill, nivel]. Ningún tipo usa los seis (el máximo es cinco), y todos los que traen la skill traen
también su nivel (medido en 3749835).
El nivel es el que dice el SDE, también 0 (Citizen Miner): no se «arregla» aquí.

Formato: JSON compacto `{type_id: [[skill, nivel], …]}`, claves en orden numérico, sin salto final.

LA VARA DE MEDIR (2026-11-26), contra el fichero hecho a mano:
  · SDE 3749835: faltan 259, sobran 0, cambian 11.
  · SDE 3607705 (el más viejo que hay), con la vara de tres cajas:
    - nacidas después del fichero: 63, entre los ids 95414 y 97712 (por encima del más alto del
      fichero, 95395).
    - no probadas (NO PROBADAS, NO HAY SDE DE JUNIO), comprobadas a mano contra el registro crudo
      del SDE de hoy:
      · 48780 Citizen Miner: el fichero pedía Mining a nivel 1; el SDE dice nivel 0.
      · 60766 Aralez: el fichero, 3 requisitos; el SDE, 4 y con otros niveles.
      · 92514 Ultratidal Entropic Disintegrator II: el fichero pedía la primera skill a nivel 1;
        el SDE, a nivel 5.
      · 95348 Research Vault, 95385 y 95390 Surveillance Vault: faltaban en el fichero. Son de la
        categoría Entity, no publicados, y con ids POR DEBAJO del máximo del fichero: por id no se
        pueden fechar.
    - ninguna otra diferencia.

Uso: python scripts/extract_skill_reqs.py [<zip del SDE>]
     python scripts/extract_skill_reqs.py --medir [<zip>]   → cuenta la vara sin escribir nada
"""
import glob
import json
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DOCS = os.path.join(os.path.dirname(ROOT), "documentacion")
OUT = os.path.join(ROOT, "public", "skill_reqs.json")

# (atributo de la skill requerida, atributo de su nivel), en el orden en que se listan.
PARES = [(182, 277), (183, 278), (184, 279), (1285, 1286), (1289, 1287), (1290, 1288)]

# Categorías de lo que se fitea o se vuela: de estas, los tipos PUBLICADOS que no piden nada se
# escriben como `[]` («lo conozco y no pide nada»). Medido en 3749835: 1.632 tipos, +17,8 KB.
# Un tipo fuera de esta lista y sin requisitos se queda sin clave, y el skill-check lo dirá como
# «no lo conozco»: equivocarse hacia «no sé» es el lado bueno.
UNIVERSO_SIN_REQUISITOS = {
    6: "Ship",
    7: "Module",
    8: "Charge",
    18: "Drone",
    20: "Implant",
    22: "Deployable",
    32: "Subsystem",
    66: "Structure Module",
    87: "Fighter",
}


def zip_sde(args):
    if args:
        return args[0]
    zips = sorted(glob.glob(os.path.join(DOCS, "sde-source", "*jsonl.zip")))
    if not zips:
        raise SystemExit("ERROR: no encuentro el SDE en ../documentacion/sde-source/*jsonl.zip")
    return zips[-1]


def requisitos(z) -> dict:
    """Solo los tipos que PIDEN algo: el fichero tal como era antes del tercer tiempo. La vara de
    medir contra el fichero hecho a mano se pasa sobre esto."""
    out = {}
    with z.open("typeDogma.jsonl") as f:
        for line in f:
            d = json.loads(line)
            a = {x["attributeID"]: x["value"] for x in d.get("dogmaAttributes") or []}
            req = []
            for skill, nivel in PARES:
                if a.get(skill):
                    if nivel not in a:
                        # Sin nivel no se sabe qué pide: inventar uno haría mentir al skill-check.
                        raise SystemExit(f"ERROR: el tipo {d['_key']} pide la skill {int(a[skill])} sin nivel: mira el SDE")
                    req.append([int(a[skill]), int(a[nivel])])
            if req:
                out[d["_key"]] = req
    return {str(k): out[k] for k in sorted(out)}


def sin_requisitos(z, con_requisitos: dict) -> list:
    """Los tipos publicados de `UNIVERSO_SIN_REQUISITOS` que no piden nada."""
    def filas(n):
        with z.open(n) as f:
            for line in f:
                yield json.loads(line)

    cat_de_grupo = {d["_key"]: d.get("categoryID") for d in filas("groups.jsonl")}
    return sorted(
        d["_key"]
        for d in filas("types.jsonl")
        if d.get("published")
        and cat_de_grupo.get(d.get("groupID")) in UNIVERSO_SIN_REQUISITOS
        and str(d["_key"]) not in con_requisitos
    )


def generar(z) -> dict:
    req = requisitos(z)
    todo = {int(k): v for k, v in req.items()}
    for t in sin_requisitos(z, req):
        todo[t] = []
    return {str(k): todo[k] for k in sorted(todo)}


def medir(nuevo: dict) -> None:
    """La vara, SOBRE LOS QUE PIDEN ALGO (sin las entradas `[]` de los dos lados), y aparte cuántas
    entradas `[]` hay: así se ve que añadirlas no movió ni una de las otras."""
    with open(OUT, encoding="utf-8") as f:
        actual = json.load(f)
    vacios = sum(1 for v in nuevo.values() if v == [])
    print(f"entradas [] («lo conozco y no pide nada»): {vacios}")
    nuevo = {k: v for k, v in nuevo.items() if v}
    actual = {k: v for k, v in actual.items() if v}
    faltan = sorted(set(nuevo) - set(actual), key=int)
    sobran = sorted(set(actual) - set(nuevo), key=int)
    cambian = sorted((k for k in set(nuevo) & set(actual) if nuevo[k] != actual[k]), key=int)
    print(f"faltan {len(faltan)} · sobran {len(sobran)} · cambian {len(cambian)}")
    for k in faltan[:3]:
        print(f"   falta: {k} {nuevo[k]}")
    for k in sobran[:3]:
        print(f"   sobra: {k} {actual[k]}")
    for k in cambian[:3]:
        print(f"   cambia: {k} {actual[k]} → {nuevo[k]}")


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")  # el «→» en la consola cp1252: ver CLAUDE.md
    args = sys.argv[1:]
    solo_medir = args[:1] == ["--medir"]
    if solo_medir:
        args = args[1:]
    zpath = zip_sde(args)
    z = zipfile.ZipFile(zpath)
    print(f"SDE: {os.path.basename(zpath)} · {z.open('_sde.jsonl').read().decode().strip()}")
    nuevo = generar(z)
    if solo_medir:
        medir(nuevo)
        return 0
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(nuevo, f, separators=(",", ":"))
    print(f"OK → public/skill_reqs.json ({len(nuevo)} tipos)")
    # Guardas contra el juego: NO publicar si alguna falla. Veldspar (1230) pide Mining 1.
    assert nuevo.get("1230") == [[3386, 1]], nuevo.get("1230")
    assert max(len(v) for v in nuevo.values()) <= len(PARES)
    vacios = [k for k, v in nuevo.items() if v == []]
    assert vacios, "ninguna entrada []: el skill-check volvería a no distinguir «no pide nada»"
    print(f"Guardas: Veldspar pide Mining 1, y {len(vacios)} tipos «no pide nada» ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
