"""Que cadena de `tr()` se queda SIN INGLES — en toda la interfaz, no en el fichero que toque hoy.

SOLO LEE.

    python scripts\\audit_i18n.py            (resumen: cuantas faltan por fichero)
    python scripts\\audit_i18n.py --todas    (la lista entera)
    python scripts\\audit_i18n.py escalaciones map   (solo esos ficheros)

★ POR QUE EXISTE: el texto fuente de Koru es ESPANOL y `tr()` cae al original cuando no encuentra
  la clave. O sea que una cadena sin traducir **no da ningun error**: simplemente el usuario ingles
  ve espanol en medio de su pantalla. Es un fallo silencioso, la familia de fallo que mas caro nos
  ha salido, y hasta hoy se revisaba a ojo fichero por fichero.

⚠️ LAS CLAVES VIVEN EN DOS FORMAS y hay que mirar las dos, o la auditoria miente:

      "Coste de entrada": "Entry cost",     <- entre comillas (lleva espacios o signos)
      Semana: "Week",                       <- identificador desnudo (una palabra sin acentos raros)

  Buscar solo la primera forma daba 19 falsos positivos la primera vez que lo hice a mano.

LO QUE NO PUEDE VER, dicho para que nadie confie de mas:
  · `tr(variable)` — p. ej. `tr(e.estado)`, donde la clave se decide en ejecucion. Se cuentan
    aparte y se avisa: son los sitios donde hay que mirar a ojo de verdad.
  · Si la traduccion es BUENA. Solo dice si existe.
"""

import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(RAIZ, "src")
I18N = os.path.join(SRC, "i18n.ts")

# `tr("...")`, admitiendo salto de linea y escapes dentro de la cadena.
LITERAL = re.compile(r'tr\(\s*\n?\s*"((?:[^"\\]|\\.)*)"')
# `tr(algo)` que NO es una cadena literal: la clave se decide en ejecucion.
DINAMICA = re.compile(r'tr\(\s*(?![")\n])')
# Un identificador puede ser clave desnuda solo si es una palabra "simple".
IDENT = re.compile(r"^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+$")

# ★★ LO QUE YA ES INGLES, y por eso NO necesita entrada en el diccionario.
#
# Jerga de EVE y unidades que se escriben igual en los dos idiomas. Si no estuvieran aqui, el
# auditor cantaria 16 falsos positivos permanentes — y una alarma que casi siempre se equivoca deja
# de leerse, que es exactamente la leccion que ya esta escrita para las alarmas del intel. Mejor un
# auditor que dice 2 y acierta, que uno que dice 18 y nadie abre.
#
# ⚠️ Esta lista se amplia con CUIDADO: cada entrada es una promesa de que esa palabra se lee igual
# para un ingles. «Prob.» NO entra —abreviatura de «probabilidad», que en ingles seria «chance»—.
IGUAL_EN_INGLES = {
    # Moneda y unidades
    "ISK", "ly", "m3", "m³", "AU", "SP", "LP", "PLEX",
    # Mecanicas y sitios, tal como los nombra el juego (en ingles en todos los clientes)
    "ESS", "CRAB", "Bounties", "Salvage", "Beacon", "Decryptor", "Lab", "Snapshots", "Spread",
    "BPC", "BPO", "Abyssal", "Omega", "Alpha", "Pochven", "Triglavian",
    # Interruptores
    "ON", "OFF",
}


def claves_del_diccionario(texto: str) -> tuple[set, str]:
    """Las claves entrecomilladas, como conjunto. Las desnudas se buscan por regex sobre el texto
    (construir el set entero pediria parsear TS, y aqui basta con preguntar por una)."""
    return set(re.findall(r'^\s*"((?:[^"\\]|\\.)*)"\s*:', texto, re.M)), texto


def tiene(clave: str, entrecomilladas: set, texto: str) -> bool:
    if clave in IGUAL_EN_INGLES:
        return True
    if clave in entrecomilladas:
        return True
    if IDENT.match(clave) and re.search(rf'^\s*{re.escape(clave)}\s*:\s*"', texto, re.M):
        return True
    return False


def main() -> int:
    args = [a for a in sys.argv[1:]]
    todas = "--todas" in args
    filtros = [a for a in args if not a.startswith("--")]

    if not os.path.exists(I18N):
        print(f"No encuentro {I18N}")
        return 1
    texto = open(I18N, encoding="utf-8").read()
    entrecomilladas, texto = claves_del_diccionario(texto)

    ficheros = sorted(
        f
        for f in os.listdir(SRC)
        if (f.endswith(".tsx") or f.endswith(".ts")) and f != "i18n.ts"
    )
    if filtros:
        ficheros = [f for f in ficheros if any(x.lower() in f.lower() for x in filtros)]

    total_usos = 0
    total_falta = 0
    total_dinamicas = 0
    peores = []
    for f in ficheros:
        d = open(os.path.join(SRC, f), encoding="utf-8").read()
        usos = set(LITERAL.findall(d))
        dinamicas = len(DINAMICA.findall(d))
        faltan = sorted(s for s in usos if not tiene(s, entrecomilladas, texto))
        total_usos += len(usos)
        total_falta += len(faltan)
        total_dinamicas += dinamicas
        if faltan or (dinamicas and todas):
            peores.append((len(faltan), f, faltan, dinamicas))

    peores.sort(reverse=True)
    print(f"Cadenas literales con tr(): {total_usos}  ·  SIN ingles: {total_falta}")
    print(f"Claves dinamicas (tr(variable)) que esto NO puede comprobar: {total_dinamicas}\n")

    if not peores:
        print("✅ Todas las cadenas literales de la interfaz tienen ingles.")
    for n, f, faltan, din in peores:
        extra = f" · {din} dinamicas" if din else ""
        print(f"  {n:>3} sin ingles  {f}{extra}")
        for s in faltan if todas else faltan[:4]:
            corta = s if len(s) <= 90 else s[:87] + "..."
            print(f"        · {corta}")
        if not todas and len(faltan) > 4:
            print(f"        … y {len(faltan) - 4} mas (--todas)")

    print("\nOJO: esto dice si la traduccion EXISTE, no si es buena. Y las claves dinamicas")
    print("(`tr(e.estado)` y companía) hay que mirarlas a ojo: la clave se decide en ejecucion.")
    return 1 if total_falta else 0


if __name__ == "__main__":
    raise SystemExit(main())
