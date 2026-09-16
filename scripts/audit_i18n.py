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

★★ LOS CATALOGOS (anadido 2026-09-16) — la mitad de las «dinamicas» SI se pueden comprobar.

  Hasta hoy esto contaba ~177 claves dinamicas y decia «miralas a ojo». Pero muchas NO son
  dinamicas de verdad: salen de catalogos ESTATICOS escritos en el propio codigo —`ACH_UI`,
  `CH_UI`, `TAB_HEAD`, `KIND_META`, `BUCKETS`…— que se pintan con `tr(ui.label)` o
  `tr(TAB_HEAD[tab].subtitle)`. La clave se decide en ejecucion, pero **el conjunto de claves
  posibles esta ahi escrito**, asi que se puede extraer y comprobar igual que el resto.

  Por que se anadio: el 2026-09-16 se colaron DOS etiquetas de reto sin ingles y este auditor dio
  verde, porque solo miraba cadenas literales. Al cerrar el agujero aparecieron **decenas** que ya
  estaban publicadas: subtitulos de seccion, nombres y descripciones de medallas, metricas de
  Freelance. Fallo silencioso de manual — el usuario ingles ve espanol y nadie da un error.

  Van en BLOQUE APARTE y no sumadas al total de arriba, a proposito: el recuento literal es exacto
  y no conviene ensuciarlo con uno que depende de una lista de campos.

  ⚠️ `CAMPOS_CATALOGO` se saco MIRANDO el codigo, no de memoria. Para rehacerlo:
      grep -o 'tr(\s*[A-Za-z_$][^)]*\.\w\+\s*)' src/*.ts*   → quedarse con los campos de catalogo
  Los campos de DATO (`name`, `estado`, `category`, `group`, `planet_type`…) quedan fuera aposta:
  su valor viene de la BD o de ESI, no del codigo, y recogerlos llenaria esto de ruido.

LO QUE NO PUEDE VER, dicho para que nadie confie de mas:
  · `tr(variable)` con clave de DATO — p. ej. `tr(e.estado)`. Se cuentan aparte y se avisa.
  · Si la traduccion es BUENA. Solo dice si existe. **Y eso ya mordio**: al renombrar una clave se
    dejo el valor ingles viejo y este auditor lo dio por bueno, porque existir, existia.
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
    # ---- Nombres propios de EVE (anadidos con los catalogos, 2026-09-16) ----
    # Un nombre propio se escribe igual en los dos clientes: no es una promesa arriesgada, es un
    # hecho del juego. Sin esto, el bloque de catalogos cantaria una veintena de falsos positivos
    # permanentes y dejaria de leerse — la misma razon por la que existe esta lista.
    "Amarr", "Caldari", "Gallente", "Minmatar", "EDENCOM",
    "Angel Cartel", "Blood Raiders", "Guristas", "Sansha", "Sansha's Nation", "Serpentis",
    "Thera", "Turnur", "Tranquility", "Koru",
    # Los cinco hubs, con su region entre parentesis: la region ya va en ingles en el propio texto.
    "Jita (The Forge)", "Amarr (Domain)", "Dodixie (Sinq Laison)", "Rens (Heimatar)",
    "Hek (Metropolis)",
    # Palabras que coinciden en los dos idiomas. Cada una comprobada, no supuesta.
    "Social", "Hubs", "Prospector", "Radar", "Kills", "Logi", "PI",
    # Las clases de seguridad de la leyenda del mapa: `high`, `low` y `null` son los terminos del
    # propio juego en ingles, y el parentesis son cifras. No hay nada que traducir.
    "high (≥0.5)", "low (0.1–0.4)", "null (≤0.0)",
}


# Campos de CATALOGO: los que se pintan con `tr(algo.campo)` y cuyo valor esta escrito en el
# codigo, no en la base de datos. Ver el encabezado para como se rehace esta lista.
CAMPOS_CATALOGO = ("label", "desc", "short", "subtitle", "title")
# Arrays de cadenas indexados dentro de `tr()`: `tr(LEVEL_NAME[a.level])` y compania.
ARRAYS_CATALOGO = ("LEVEL_NAME", "MONTH_NAMES", "TIER_NAME")


def cadenas_de_catalogo(codigo: str) -> set:
    """Las cadenas de los catalogos estaticos de UN fichero.

    No intenta entender TypeScript: busca `campo: "..."` y el contenido de los arrays conocidos.
    Es deliberadamente simple — si algun dia se le escapa algo, se vera al anadir un catalogo
    nuevo y bastara con sumar su campo arriba."""
    out = set()
    for campo in CAMPOS_CATALOGO:
        out.update(re.findall(rf'\b{campo}:\s*"((?:[^"\\]|\\.)*)"', codigo))
    for arr in ARRAYS_CATALOGO:
        m = re.search(rf"{arr}\s*(?::[^=]*)?=\s*\[(.*?)\]", codigo, re.S)
        if m:
            out.update(re.findall(r'"((?:[^"\\]|\\.)*)"', m.group(1)))
    return {s for s in out if s.strip()}


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
    total_cat = 0
    total_cat_falta = 0
    peores = []
    peores_cat = []
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
        # Catalogos: las que ya salieron como literales no se repiten aqui.
        cat = cadenas_de_catalogo(d) - usos
        cat_faltan = sorted(s for s in cat if not tiene(s, entrecomilladas, texto))
        total_cat += len(cat)
        total_cat_falta += len(cat_faltan)
        if cat_faltan:
            peores_cat.append((len(cat_faltan), f, cat_faltan))

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

    # ---- Catalogos estaticos, en bloque aparte (ver el encabezado) ----
    print(f"\nCatalogos (tr(ui.label), tr(TAB_HEAD[t].subtitle)…): {total_cat}  ·  SIN ingles: {total_cat_falta}")
    if not peores_cat:
        print("✅ Los catalogos tambien estan traducidos.")
    else:
        print("   Estas NO las ve el bloque de arriba y el usuario ingles las lee EN ESPANOL:")
        peores_cat.sort(reverse=True)
        for n, f, faltan in peores_cat:
            print(f"  {n:>3} sin ingles  {f}")
            for s in faltan if todas else faltan[:4]:
                corta = s if len(s) <= 90 else s[:87] + "..."
                print(f"        · {corta}")
            if not todas and len(faltan) > 4:
                print(f"        … y {len(faltan) - 4} mas (--todas)")

    print("\nOJO: esto dice si la traduccion EXISTE, no si es buena — al renombrar una clave se")
    print("puede quedar el valor ingles viejo y esto lo da por bueno. Y las claves dinamicas de")
    print("DATO (`tr(e.estado)` y companía) siguen sin poder comprobarse: se deciden en ejecucion.")
    return 1 if (total_falta or total_cat_falta) else 0


if __name__ == "__main__":
    raise SystemExit(main())
