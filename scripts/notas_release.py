"""Genera `notas-release-vX.Y.Z.md` A PARTIR de `src/changelog.ts`. Solo lee el changelog.

    python scripts\\notas_release.py            (la version de arriba del changelog)
    python scripts\\notas_release.py 0.51.0     (una concreta)

★ POR QUE EXISTE: el texto de las notas de GitHub y el del modal «Novedades» son EL MISMO, y hasta
  ahora se copiaba a mano de un sitio al otro. Dos copias del mismo parrafo es la forma clasica de
  que se separen: se corrige una coma en el changelog y las notas publicadas se quedan con la
  version vieja, o al reves. Aqui hay una sola fuente y la otra se genera.

  (Ya nos ha pasado con cosas mas serias que una coma: un cambio aplicado en un sitio y no en su
  hermano es el fallo que mas veces se ha repetido en este proyecto.)

FORMATO, el mismo que las releases anteriores: titulo, las vinetas en INGLES, separador, y despues
las de espanol. El ingles va primero porque la mayoria de quien lee las notas en GitHub no habla
espanol.

⚠️ NO comprueba la ortografia ni que el texto sea bueno. Comprueba que las dos listas tengan el
   MISMO numero de vinetas, porque una vineta que existe en un idioma y no en el otro es lo unico
   que este fichero puede detectar y lo que mas veces se ha colado.
"""

import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHANGELOG = os.path.join(RAIZ, "src", "changelog.ts")


def entradas(texto: str):
    """(version, fecha, [es], [en]) por cada entrada, en el orden del fichero."""
    # Se corta por `version:` y se lee cada bloque. No se parsea TS de verdad: basta con localizar
    # los limites, y un parser a medias daria una falsa sensacion de rigor.
    cortes = [m.start() for m in re.finditer(r'^\s*version: "', texto, re.M)]
    cortes.append(len(texto))
    for i in range(len(cortes) - 1):
        b = texto[cortes[i] : cortes[i + 1]]
        ver = re.search(r'version: "([^"]+)"', b)
        fecha = re.search(r'date: "([^"]+)"', b)
        if not ver:
            continue
        try:
            es_ini, en_ini = b.index("es: ["), b.index("en: [")
        except ValueError:
            continue
        # Cada vineta es una cadena entrecomillada que EMPIEZA una linea. Asi no se parte una
        # vineta que lleve comillas dentro.
        vin = lambda t: [
            m.group(1).replace('\\"', '"') for m in re.finditer(r'^\s{6}"(.*)",?$', t, re.M)
        ]
        yield ver.group(1), (fecha.group(1) if fecha else "?"), vin(b[es_ini:en_ini]), vin(b[en_ini:])


def main() -> int:
    if not os.path.exists(CHANGELOG):
        print(f"No encuentro {CHANGELOG}")
        return 1
    texto = open(CHANGELOG, encoding="utf-8").read()
    todas = list(entradas(texto))
    if not todas:
        print("No pude leer ninguna entrada del changelog.")
        return 1

    pedida = sys.argv[1] if len(sys.argv) > 1 else todas[0][0]
    elegida = next((e for e in todas if e[0] == pedida), None)
    if not elegida:
        print(f"No hay entrada para {pedida}. Hay: {', '.join(v for v, *_ in todas)}")
        return 1

    ver, fecha, es, en = elegida
    print(f"Version {ver} ({fecha})")
    print(f"  vinetas ES: {len(es)} · EN: {len(en)}")
    if len(es) != len(en):
        print("\n🚨 Las dos listas NO tienen el mismo numero de vinetas. Una de las dos se quedo")
        print("   corta, y eso en las notas publicadas se ve. No se escribe nada.")
        return 1

    salida = os.path.join(RAIZ, f"notas-release-v{ver}.md")
    with open(salida, "w", encoding="utf-8", newline="\n") as f:
        f.write(f"# Koru Desktop v{ver}\n\n")
        for b in en:
            f.write(f"- {b}\n")
        f.write("\n---\n\n")
        for b in es:
            f.write(f"- {b}\n")
    print(f"\nEscrito: {os.path.relpath(salida, RAIZ)}  ({len(es)} vinetas por idioma)")
    print("Recuerda: esto NO revisa el texto, solo que las dos listas cuadren.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
