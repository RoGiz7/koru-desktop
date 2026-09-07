#!/usr/bin/env python3
"""¿Cuanto intel llega con el marcado de enlaces de EVE dentro?

# Por que existe (2026-09-08)

El reporto una linea real de su chat de intel:

    [16:08:16] ALGUIEN > <url=showinfo:5//30000785>XXX-XX</url>  <url=showinfo:1383//2123737549>Lucy Lee 1</url>

y dijo que Koru seguia apuntando al personaje SIN el 1 — aunque el arreglo del «1 pegado al
nombre» ya estaba puesto y probado. La explicacion es que ese arreglo nunca llego a ejecutarse:
el troceador no sabe nada de `<url=...>`, asi que la primera palabra que ve es
`<url=showinfo:1383//2123737549>Lucy` — que empieza por `<`, no pasa por nombre, y se descarta.
Medido: esa linea daba el piloto «Lee» y CERO sistemas, o sea que ni generaba reporte.

⚠️ PRIMER INTENTO FALLIDO, Y VALE LA PENA DEJARLO ESCRITO: mire en la base de datos y no habia
tabla de lineas de intel. **No la hay**: el intel se lee de los ficheros cada vez y solo se guarda
lo DERIVADO (`intel_sightings`). Yo habia dado por supuesto que lo crudo estaba almacenado. La
fuente de verdad son los chatlogs, asi que este script lee los ficheros.

Lo que hay que saber antes de escribir la fase 2:

  1. ¿Cuantas lineas traen el marcado? Si son cuatro, es una anecdota; si son cientos, es un
     agujero por el que se caen pilotos todos los dias.
  2. ¿Que IDs vienen dentro? Porque `showinfo:1383//2123737549` NO es ruido a limpiar: es el **id
     del personaje, dicho por el juego**. Si esta ahi, el nombre deja de ser una adivinanza — y se
     cae solo el bug abierto de enlazar el zKill del piloto equivocado.

⚠️ Solo LEE, y la muestra sale con los codigos de sistema enmascarados: un codigo de null es
accionable y esto puede acabar pegado en cualquier sitio.

Uso: python scripts/diag_intel_urls.py
     python scripts/diag_intel_urls.py "D:\\ruta\\a\\EVE\\logs\\Chatlogs"
"""
import os
import re
import sys
from collections import Counter

# `showinfo:TYPEID//ITEMID`. El typeID dice QUE es lo enlazado.
RE_URL = re.compile(r"<url=showinfo:(\d+)(?://(\d+))?>(.*?)</url>", re.I | re.S)
RE_TAG = re.compile(r"<(?:url|font|color|b|i|u|br|localized|a)\b", re.I)
# Los tipos de personaje de EVE (uno por linea de sangre). Es lo que hace util el id.
PERSONAJES = set(range(1373, 1387))
QUE_ES = {5: "sistema solar", 2: "corporacion", 3: "region", 16159: "alianza"}
# Canales que NO son intel: el marcado es normal en local o en corp y no dice nada del problema.
PISTAS_INTEL = ("intel", "-i_", "_i_", "scout", "vigil")


# `--volcar` no analiza: enseña los primeros bytes de un fichero. Cuando el analisis no saca nada,
# lo unico honesto es mirar el fichero crudo en vez de seguir suponiendo codificaciones.
# ⚠️ Un flag mal escrito NO se ignora: se para. Antes `--todos` (que aun no existia) se colaba por
# el filtro de ARGS y el script corria como si nada, dando una cifra que no era la pedida.
FLAGS = {"--volcar", "--buscar", "--todos", "--recursivo"}
_malos = [x for x in sys.argv[1:] if x.startswith("--") and x not in FLAGS]
if _malos:
    print(f"No conozco {' '.join(_malos)}. Los que hay: {' '.join(sorted(FLAGS))}")
    raise SystemExit(2)

# `--todos` mira los 6.202 ficheros en vez de los 60 ultimos: es lo que dice cuanto ocupa de verdad
# `intel_line`, y esa cifra decide si entra el historico entero o solo desde una fecha.
TODOS = "--todos" in sys.argv
# ⚠️ `--recursivo` entra en las SUBCARPETAS. Sin esto, un `old\` dentro de Chatlogs es invisible y
# sus canales se leen como «no existen» — que es exactamente lo que nos pasó buscando el canal de
# la region anterior. Una carpeta que no se mira no es una carpeta vacia.
RECURSIVO = "--recursivo" in sys.argv
VOLCAR = "--volcar" in sys.argv
# `--buscar TEXTO` enseña las lineas CRUDAS que contienen ese texto. Cuando Koru dice una cosa y el
# juego otra, lo unico que zanja la discusion es la linea tal y como esta escrita en el fichero.
BUSCAR = None
if "--buscar" in sys.argv:
    i = sys.argv.index("--buscar")
    BUSCAR = sys.argv[i + 1] if i + 1 < len(sys.argv) else None
ARGS = [x for x in sys.argv[1:] if not x.startswith("--") and x != BUSCAR]


def candidatas() -> list:
    if ARGS:
        return [ARGS[0]]
    home = os.path.expanduser("~")
    docs = [os.path.join(home, "Documents"), os.path.join(home, "Documentos")]
    # OneDrive se lleva «Documentos» por defecto en muchos Windows y es donde suele estar de verdad.
    od = os.environ.get("OneDrive") or os.environ.get("OneDriveConsumer")
    if od:
        docs += [os.path.join(od, "Documents"), os.path.join(od, "Documentos")]
    return [os.path.join(d, "EVE", "logs", "Chatlogs") for d in docs]


def leer(ruta: str) -> str:
    """Decodifica un chatlog. **Espejo exacto de `decode_bytes` en `src-tauri/src/chatlog.rs`.**

    ⚠️ Mi primera version solo miraba el BOM y saco «0 lineas» de 60 ficheros — y lo presento como
    un 0,0 % con toda la naturalidad, que es la misma forma de mentir que llevo el dia entero
    arreglando en el troceador. EVE tambien escribe **UTF-16LE SIN BOM**, y entonces decodificar
    como UTF-8 deja un `\\x00` entre cada letra: `" > "` ya no casa con nada y todas las lineas se
    caen. Koru lo resuelve contando ceros; aqui se copia esa regla en vez de inventar otra.
    """
    with open(ruta, "rb") as f:
        b = f.read()
    if b[:2] == b"\xff\xfe":
        return b[2:].decode("utf-16-le", errors="replace")
    # Sin BOM: si hay muchos ceros intercalados, sigue siendo UTF-16LE.
    if sum(1 for x in b[:400] if x == 0) > 40:
        return b.decode("utf-16-le", errors="replace")
    return b.decode("utf-8", errors="replace")


# ⚠️ ESPEJO DE `parse_intel_text` EN commands.rs: EVE mete caracteres de control y un `\ufeff` al
# principio de las lineas. Python NO considera `\ufeff` un espacio, asi que `lstrip()` no lo quita
# y NINGUNA linea empezaba por «[» — de ahi el «0 lineas» de 60 ficheros. La respuesta llevaba
# meses escrita en el Rust de Koru; me la salte por escribir el filtro de memoria.
RE_BASURA_INICIO = re.compile(r"^[\s\ufeff\x00-\x1f]+")


def txts(carpeta: str) -> list:
    """Los .txt de la carpeta, y con `--recursivo` tambien los de dentro de sus subcarpetas."""
    if not RECURSIVO:
        return [os.path.join(carpeta, f) for f in os.listdir(carpeta) if f.lower().endswith(".txt")]
    out = []
    for raiz, _dirs, ficheros in os.walk(carpeta):
        out += [os.path.join(raiz, f) for f in ficheros if f.lower().endswith(".txt")]
    return out


def subcarpetas(carpeta: str) -> list:
    """Que hay DENTRO de las subcarpetas. Se enseña siempre, aunque no se vaya a leer: es la
    diferencia entre «no hay ese canal» y «no he mirado donde estaba»."""
    out = []
    try:
        for d in sorted(os.listdir(carpeta)):
            ruta = os.path.join(carpeta, d)
            if not os.path.isdir(ruta):
                continue
            n = sum(len([f for f in fs if f.lower().endswith(".txt")]) for _, _, fs in os.walk(ruta))
            out.append((d, n))
    except OSError:
        pass
    return out


def enmascarar(s: str) -> str:
    """Deja ver la FORMA de la linea sin publicar donde esta nadie."""
    return re.sub(r"\b[A-Z0-9]{1,4}-[A-Z0-9]{1,4}\b", "XXX-XX", s)


def main() -> int:
    carpeta = None
    for c in candidatas():
        if os.path.isdir(c):
            carpeta = c
            break
    if not carpeta:
        print("No encuentro la carpeta de Chatlogs. La he buscado en:")
        for c in candidatas():
            print(f"  {c}")
        print("\nPasala a mano — es la MISMA que tienes elegida en Koru:")
        print('  python scripts\\diag_intel_urls.py "D:\\ruta\\EVE\\logs\\Chatlogs"')
        return 1
    print(f"Chatlogs: {carpeta}\n")

    if VOLCAR:
        recientes = sorted(
            (os.path.join(carpeta, f) for f in os.listdir(carpeta) if f.lower().endswith(".txt")),
            key=os.path.getmtime, reverse=True)[:3]
        for r in recientes:
            with open(r, "rb") as f:
                crudo = f.read(220)
            ceros = sum(1 for x in crudo if x == 0)
            print(f"  {os.path.basename(r)}")
            print(f"    tamaño {os.path.getsize(r):,} B · primeros 2 bytes {crudo[:2]!r} · "
                  f"ceros en los primeros 220: {ceros}")
            print(f"    bytes  {crudo[:64]!r}")
            texto = leer(r)
            print(f"    leido  {enmascarar(texto[:110])!r}")
            msgs = [l for l in texto.splitlines() if " > " in l][:2]
            for m in msgs:
                print(f"    linea  {enmascarar(m)[:150]!r}")
            if not msgs:
                print("    linea  (ninguna con ' > ' — el fichero es solo cabecera)")
            print()
        return 0

    ficheros = sorted(txts(carpeta), key=os.path.getmtime, reverse=True)
    subs = subcarpetas(carpeta)
    if subs:
        con = [f"{d} ({n:,} .txt)" for d, n in subs if n]
        if con:
            print(("Subcarpetas CON logs dentro: " + ", ".join(con)))
            print("  " + ("Se estan leyendo (--recursivo)." if RECURSIVO
                          else "⚠️ NO se estan leyendo. Añade --recursivo para incluirlas."))
            print()
    if BUSCAR:
        # Aqui se miran TODOS los ficheros, no los 60 ultimos: se busca un caso concreto, y el caso
        # puede ser de hace meses.
        print(f"Buscando {BUSCAR!r} en {len(ficheros)} ficheros...\n")
        n = 0
        for ruta in ficheros:
            try:
                texto = leer(ruta)
            except OSError:
                continue
            for cruda in texto.splitlines():
                linea = RE_BASURA_INICIO.sub("", cruda)
                if " > " not in linea or BUSCAR.lower() not in linea.lower():
                    continue
                n += 1
                if n <= 25:
                    canal = re.sub(r"_\d{8}_\d{6}_\d+$", "", os.path.splitext(os.path.basename(ruta))[0])
                    # repr() a proposito: asi se ven los espacios DOBLES, que son los que separan
                    # los campos del intel. Con texto normal no se distinguen de uno solo.
                    print(f"  [{canal}] {enmascarar(linea)!r}")
        print(f"\n{n} lineas encontradas" + ("  (enseño las 25 primeras)" if n > 25 else ""))
        return 0
    if not TODOS:
        # Los 60 mas recientes: suficiente para medir, y no tarda un minuto.
        ficheros = ficheros[:60]
    else:
        print(f"Leyendo los {len(ficheros):,} ficheros. Tarda un rato.\n")
    if not ficheros:
        print("La carpeta esta vacia.")
        return 1

    # Los canales de intel se llaman como quiera la alianza, asi que la pista del nombre puede
    # fallar entera. Si no reconozco ninguno NO invento una cifra sobre cero lineas: cuento todo y
    # lo digo. Una estadistica con el denominador vacio es peor que no darla.
    hay_pista = any(any(p in os.path.basename(r).lower() for p in PISTAS_INTEL) for r in ficheros)
    # ★ EL DESGLOSE POR CANAL es lo util de verdad. Sus canales se llaman «fareast.imperium» y
    # «isk.imperium»: ninguna heuristica de nombre iba a adivinar cual es el de intel, y el que lo
    # sabe es el. Asi que en vez de clasificar yo, se lo enseño canal por canal.
    por_canal = {}
    total = con_tag = 0
    total_i = con_tag_i = 0
    tipos = Counter()
    con_id_pj = 0
    muestras = []
    canales = set()
    for ruta in ficheros:
        base = os.path.basename(ruta)
        # «fareast.imperium_20260907_111237_152730148.txt» -> «fareast.imperium»
        # Dos formatos de nombre: el actual «Canal_FECHA_HORA_charID» y el viejo «Canal_FECHA_HORA».
        # Sin el segundo, cada dia de 2020 salia como un canal distinto y la tabla se fragmentaba en
        # cientos de filas de una sola sesion. (Koru importa por prefijo, asi que a EL no le afecta.)
        canal = re.sub(r"_\d{8}_\d{6}(?:_\d+)?$", "", os.path.splitext(base)[0])
        es_intel = (any(p in base.lower() for p in PISTAS_INTEL)) if hay_pista else True
        if es_intel:
            canales.add(base.split("_")[0])
        try:
            texto = leer(ruta)
        except OSError:
            continue
        for cruda in texto.splitlines():
            linea = RE_BASURA_INICIO.sub("", cruda)
            if " > " not in linea or not linea.startswith("["):
                continue
            total += 1
            c = por_canal.setdefault(canal, [0, 0, 0, 0, "", ""])
            c[0] += 1
            f = linea[2:12]  # «[ 2026.09.07 ...» -> la fecha, para saber cuando vivio el canal
            if len(f) == 10 and f[4] == ".":
                if not c[4] or f < c[4]:
                    c[4] = f
                if f > c[5]:
                    c[5] = f
            c[3] += len(linea.encode("utf-8")) + 24  # +24: ts, canal e indice, a ojo
            if es_intel:
                total_i += 1
            if not RE_TAG.search(linea):
                continue
            con_tag += 1
            c[1] += 1
            if es_intel:
                con_tag_i += 1
            for tid, iid, _txt in RE_URL.findall(linea):
                tipos[int(tid)] += 1
                if int(tid) in PERSONAJES and iid:
                    con_id_pj += 1
                    c[2] += 1
            if es_intel and len(muestras) < 6:
                muestras.append(linea)

    # ⚠️ CERO LINEAS DE 60 FICHEROS NO ES UN RESULTADO, ES UN FALLO. Sin esto el script imprime un
    # «0,0 %» impecable y te manda a tomar una decision sobre datos que nunca leyo. Que se note.
    if total == 0:
        print(f"❌ He abierto {len(ficheros)} ficheros y no he sacado NI UNA linea de chat.")
        print("   Eso no significa que no haya intel: significa que no se leerlos.")
        print("   Pasame uno para mirarlo:")
        print(f'     python scripts\\diag_intel_urls.py "{carpeta}" --volcar')
        return 2

    pc = lambda a, b: (100 * a / b) if b else 0
    print(f"ficheros mirados               : {len(ficheros)}  (los mas recientes)")
    print(f"canales de intel detectados    : {', '.join(sorted(canales)) if hay_pista else 'NINGUNO reconocido por el nombre -> cuento TODOS los canales'}")
    print()
    print(f"lineas de chat en total        : {total:,}")
    print(f"  con marcado <url=/<font=...  : {con_tag:,}  ({pc(con_tag, total):.1f} %)")
    etq = "lineas SOLO de canales de intel" if hay_pista else "lineas (NO se cual es de intel)  "
    print(f"{etq}: {total_i:,}")
    print(f"  con marcado                  : {con_tag_i:,}  ({pc(con_tag_i, total_i):.1f} %)   <-- LA CIFRA QUE DECIDE")
    print(f"enlaces a un PERSONAJE con id  : {con_id_pj:,}")
    print()
    if tipos:
        print("que se enlaza (typeID -> veces):")
        for tid, n in tipos.most_common(10):
            que = QUE_ES.get(tid) or ("PERSONAJE" if tid in PERSONAJES else "?")
            print(f"  {tid:>6}  {que:<14} {n:>6}")
        print()
    print("POR CANAL  (mira el tuyo de intel: fareast/isk.imperium o el que sea)")
    print(f"  {'canal':<24} {'lineas':>8} {'marcado':>8} {'%':>6} {'ids pj':>7} {'en la BD':>11}  {'vivo desde → hasta'}")
    # ⚠️ SIN recortar. Con `[:14]` no salia el canal que buscaba (el de la region anterior), y un
    # canal que no aparece se lee como «no existe» — cuando lo unico que pasaba es que era pequeño.
    for canal, v in sorted(por_canal.items(), key=lambda kv: -kv[1][0]):
        n, tg, ids, by, de, has = v
        print(f"  {canal[:24]:<24} {n:>8,} {tg:>8,} {pc(tg, n):>5.1f}% {ids:>7,} {by/1e6:>8.1f} MB  {de} → {has}")
    print()
    print()
    tot_by = sum(x[3] for x in por_canal.values())
    print(f"  {'TODOS LOS CANALES':<24} {total:>8,} {con_tag:>8,} {pc(con_tag, total):>5.1f}% "
          f"{con_id_pj:>7,} {tot_by/1e6:>8.1f} MB")
    if not TODOS:
        print("\n  (solo los 60 ficheros mas recientes — para el total real: --todos)")
    print()
    print("--- muestra de intel (sistemas enmascarados) ---")
    for m in muestras:
        print("  " + enmascarar(m.strip())[:170])
    if not muestras:
        print("  (ninguna linea de intel con marcado)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
