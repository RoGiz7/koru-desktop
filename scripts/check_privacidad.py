#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Revisa los TEXTOS PÚBLICOS en busca de datos que no deberían salir del repo.

POR QUÉ EXISTE
--------------
La regla («los textos públicos no llevan sistemas, pilotos, corps ni fechas de mis logs») existía
desde hace tiempo y aun así se coló: el changelog in-app publicado lleva un sistema de nullsec y un
nombre de personaje de entradas antiguas. Una regla que solo vive en la cabeza de alguien se salta
sola el día que hay prisa. Esto la convierte en un paso mecánico.

QUÉ MIRA, Y QUÉ NO PUEDE MIRAR
------------------------------
· **Códigos de sistema de nullsec** (`XXX-NNN`, `X-NNNN`…): esto SÍ se detecta solo. Es además lo
  más grave — una cifra de ISK es presumible, una ubicación es accionable.
· **Nombres de piloto y de corp NO se pueden detectar por patrón**: son palabras normales. El
  script no los busca, y decir lo contrario daría una falsa sensación de seguridad. Para eso está
  la lectura a ojo antes de publicar.
· ⚠️ **NI LOS NOMBRES DE CANAL** (`algo.algo`), y de eso hay experiencia: lo que se coló en
  `docs/` no fueron los sistemas, fue una línea que nombraba los canales de intel **y la coalición
  a la que pertenecen**. Tienen forma reconocible, pero se confunden con dominios, rutas de scope
  de ESI y nombres de fichero, así que una detección automática cantaría cien falsos y dejaría de
  leerse. Va a la lista de «mirar a ojo», que es donde debe estar.

★★ EL PATRÓN SE CONFIRMA CONTRA EL CATÁLOGO, NO SE ADIVINA (2026-09-19)
-----------------------------------------------------------------------
La primera versión decidía por forma: `[A-Z0-9]{1,4}-[A-Z0-9]{2,5}`, más una lista de excepciones
a mano (`UTF-8`, `SHA-256`…). Tenía los dos fallos de cualquier heurística:

1. **Se dejaba sistemas de verdad.** Exigía 2-5 caracteres tras el guion, así que un nombre como
   un nombre con UNA SOLA letra tras el guion —y los hay— **no lo veía**. Un agujero en la puerta que se
   pasa antes de CADA release.
2. **Cantaba falsos** (`EVE-O`, `T2-T3`, `P0-P4`…), y una alarma que se equivoca deja de leerse —
   la misma regla que gobierna los avisos del intel.

Ahora los candidatos se confirman contra **`public/neweden.json`, que trae los 5.485 sistemas de
verdad**. Cero falsos positivos y cero huecos, sin lista que mantener. Es la regla de la casa
(«catálogo primero») aplicada a la herramienta en vez de a la app.

⚠️ **Solo se cantan los sistemas con forma de CÓDIGO** (con guion y dígito). Los de nombre propio
—Jita, Amarr, Thera— son los ejemplos genéricos que la propia regla manda usar en textos públicos,
así que cantarlos sería cantar la solución.

⚠️ Este fichero va al repo, así que NO puede contener ningún nombre real ni ningún sistema suyo:
sería exactamente la fuga que viene a evitar. Solo lleva patrones. Los NOMBRES, que no tienen
patrón, se leen de `documentacion/nombres_privados.txt`, que está bajo candado en .gitignore.

★ 2026-11-04: ahora mira también EL CÓDIGO FUENTE, no solo la prosa. Ver `objetivos_por_defecto`.

USO
---
    python scripts/check_privacidad.py
    python scripts/check_privacidad.py ../notas-release-v0.45.0.md

Sale con código 1 si encuentra algo, para poder encadenarlo a un paso de release.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent

# TODO lo que va al repo público y lleva prosa. Antes eran tres ficheros sueltos y `docs/` se
# quedaba fuera — que es justo donde se coló lo que motivó esta versión. Se mira por patrón, no por
# lista, para que un fichero nuevo entre solo.
# ★★ 2026-11-04: ANTES SOLO MIRABA PROSA —el changelog y los .md— y eso dejaba fuera el sitio
#    por el que de verdad se escapan las cosas: LOS COMENTARIOS DEL CÓDIGO. Al extenderlo
#    aparecieron tres fugas de golpe: un sistema suyo escrito ese mismo día documentando un
#    arreglo, otro usado como ejemplo en los comentarios de PI, y un nombre de piloto real
#    contando cómo se lee una op. Los tres llevaban meses o minutos en el repo público y ninguno
#    habría salido jamás con la versión anterior, porque ninguno vive en un .md.
#
#    Explicar por qué se arregló algo es BUENO y hay que seguir haciéndolo; lo que no puede es
#    llevar el dato real dentro. El ejemplo genérico cuenta lo mismo.
EXTENSIONES = {".md", ".ts", ".tsx", ".rs", ".py", ".mjs", ".js", ".css", ".html", ".json"}


def objetivos_por_defecto() -> list[Path]:
    # `public/` queda fuera A PROPÓSITO: ahí vive el catálogo de New Eden, que son los 5.485
    # sistemas de verdad del juego y no es información de nadie. `gen/` e `icons/` son generados.
    fuera = {"node_modules", "dist", "target", ".git", "documentacion", "public", "gen", "icons"}
    salida: list[Path] = []
    # Se PODA al bajar, no se filtra después: `rglob` entraba en node_modules y target enteros
    # antes de descartar (2 min 37 s en el sandbox el 2026-09-22; ahora, segundos).
    pendientes = [RAIZ]
    encontrados: list[Path] = []
    while pendientes:
        d = pendientes.pop()
        for p in d.iterdir():
            if p.is_dir():
                if p.name not in fuera:
                    pendientes.append(p)
            elif p.suffix in EXTENSIONES:
                encontrados.append(p)
    salida.extend(sorted(encontrados))
    return salida


# Candidato a código de sistema. A propósito MÁS ANCHO que la forma real (`{1,5}` tras el guion,
# no `{2,5}`): aquí se pesca de más y luego decide el catálogo. La versión vieja afinaba el patrón
# y por eso perdía los nombres que acaban en una sola letra.
CANDIDATO = re.compile(r"\b[A-Za-z0-9]{1,4}-[A-Za-z0-9]{1,5}\b")
# Un sistema con forma de CÓDIGO: lleva guion y al menos un dígito. Los de nombre propio (Jita,
# Amarr) quedan fuera a propósito — son los ejemplos que la regla manda usar. Ver la cabecera.
CODIGO = re.compile(r"^(?=.*\d)[A-Z0-9]+-[A-Z0-9]+$")

# ★ Sistemas que son PATRIMONIO PÚBLICO de EVE, no información de nadie: los escenarios de las
# batallas históricas que cuenta cualquier artículo del juego. Ojo a la diferencia con la lista de
# excepciones que este script TENÍA y se quitó: aquella tapaba fallos del patrón (`UTF-8`), y eso
# era esconder ruido. Esta es una decisión de POLÍTICA —estos sí se pueden nombrar— y por eso se
# mantiene a mano y corta: si algún día hay que añadir uno «porque también sale en mis logs», la
# respuesta correcta es quitarlo del texto, no meterlo aquí.
PUBLICOS = {"b-r5rb", "m2-xfe"}


def catalogo_sistemas() -> set[str] | None:
    """Los nombres de sistema de verdad, en minúsculas. `None` si no está el catálogo."""
    ruta = RAIZ / "public" / "neweden.json"
    if not ruta.exists():
        return None
    try:
        ne = json.loads(ruta.read_text(encoding="utf-8"))
    except Exception:
        return None
    return {s["n"].lower() for s in ne.get("systems", []) if CODIGO.match(s["n"].upper())}


# ★ LOS NOMBRES NO SE PUEDEN CAZAR POR PATRÓN (un piloto puede llamarse cualquier cosa), así que
#   se cazan por LISTA. Y la lista NO vive aquí: este fichero va al repo, y escribir en él los
#   nombres sería exactamente la fuga que viene a evitar. Vive en
#   `documentacion/nombres_privados.txt` —un nombre por línea, `#` para comentarios—, que está
#   bajo candado en .gitignore. Si no existe, el script lo dice y sigue: la caza de sistemas no
#   depende de ella.
def nombres_privados() -> tuple[list[str], Path | None]:
    for ruta in (
        RAIZ / "documentacion" / "nombres_privados.txt",
        RAIZ.parent / "documentacion" / "nombres_privados.txt",
    ):
        if ruta.exists():
            nombres = [
                l.strip()
                for l in ruta.read_text(encoding="utf-8", errors="ignore").splitlines()
                if l.strip() and not l.strip().startswith("#")
            ]
            return nombres, ruta
    return [], None


def revisar(
    ruta: Path, catalogo: set[str] | None, nombres: list[str]
) -> list[tuple[int, str, str, str]]:
    if not ruta.exists():
        return []
    hallazgos = []
    for n, linea in enumerate(ruta.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
        bajo = linea.lower()
        for nombre in nombres:
            if nombre.lower() in bajo:
                hallazgos.append((n, "nombre", nombre, linea.strip()[:120]))
        for m in CANDIDATO.findall(linea):
            if m.lower() in PUBLICOS:
                continue
            if catalogo is not None:
                # El catálogo decide: o es un sistema de verdad o no lo es. Sin lista de excepciones.
                if m.lower() not in catalogo:
                    continue
            elif not CODIGO.match(m.upper()):
                # Sin catálogo (no debería pasar) se cae a la forma, que canta de más. Se avisa abajo.
                continue
            hallazgos.append((n, "sistema", m, linea.strip()[:120]))
    return hallazgos


def main() -> int:
    objetivos = [Path(a) for a in sys.argv[1:]] or objetivos_por_defecto()
    catalogo = catalogo_sistemas()
    if catalogo is None:
        print("⚠️  No encuentro public/neweden.json: se decide por FORMA y habrá falsos positivos.")
    nombres, ruta_nombres = nombres_privados()
    if ruta_nombres is None:
        print("⚠️  Sin documentacion/nombres_privados.txt: NO se buscan nombres de piloto ni de canal.")
    total = 0
    for f in objetivos:
        for n, tipo, hallazgo, linea in revisar(f, catalogo, nombres):
            total += 1
            try:
                nombre = f.resolve().relative_to(RAIZ)
            except ValueError:
                nombre = f.name
            print(f"⚠️  [{tipo}] {nombre}:{n}  «{hallazgo}»  →  {linea}")
    if total:
        print(f"\n{total} hallazgo(s) en lo que va al repo. Los sistemas están confirmados contra el")
        print("catálogo, así que no son falsos positivos. Sustituir por un ejemplo genérico (Jita y")
        print("compañía) o por una descripción: contar POR QUÉ se arregló algo no exige el dato real.")
        return 1
    print(f"Limpio: {len(objetivos)} ficheros revisados (prosa y código).")
    if not nombres:
        print("⚠️  Sin lista de nombres: los de piloto, corp y CANAL hay que leerlos a ojo.")
    else:
        print(f"Incluye {len(nombres)} nombre(s) privados de la lista bajo candado.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
