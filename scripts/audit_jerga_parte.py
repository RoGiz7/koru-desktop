#!/usr/bin/env python3
"""¿QUE PALABRAS DE LA JERGA ESTAN PARTIENDO NOMBRES REALES? (2026-09-08)

# Por que existe

`INTEL_JARGON` cierra el nombre que se estuviera montando, y casi siempre acierta. Pero cuando la
palabra de jerga es **la segunda mitad de un nombre propio**, corta a la persona por el medio:

    «Iam Neutral»  ->  piloto «Iam»       (`neutral` esta en la jerga)
    «CCTV Eyes»    ->  piloto «CCTV»      (`eyes` esta en la jerga)

Es el patron de «Dee Yona», donde el que cortaba era un SISTEMA. Alli no se adivino: se proponen
las dos lecturas y decide `name_cache`. Aqui hara falta lo mismo — pero **primero se mide**, porque
el error del dia anterior fue el contrario: descartar el mecanismo de siglas mirando un solo caso
(`vni`) y dejar `eni` —487 avistamientos falsos— dos columnas mas abajo sin mirar.

# Que contesta este informe

  1. CUANTAS palabras de la jerga cortan nombres, no solo `neutral` y `eyes`.
  2. A QUIEN cortan, con las dos lecturas puestas una al lado de otra.
  3. QUE SE ARREGLA GRATIS: los nombres largos que `name_cache` YA confirma, sin pedir nada a ESI.
  4. QUE COSTARIA cerrarlo del todo: cuantos nombres distintos habria que preguntar, una vez.

⚠️ Solo LEE la base de datos (`mode=ro`) y enmascara los codigos de sistema de null antes de
   imprimir nada. Sin `--esi` no se manda ni una peticion.

⚠️ ESTE INFORME MIDE EL TROCEADOR DE HOY, no el de ayer. Desde que `intel.ts` sabe resolver la
   lectura larga, **los pares ya arreglados DESAPARECEN de aqui**: si «Iam Neutral» esta confirmado
   en `name_cache`, el piloto que sale ya es el largo y no hay corte que contar. O sea que las
   cifras bajando entre dos pasadas es la señal de que funciona, no de que se haya roto algo.
   Para ver el otro lado —que se recupero— esta `verificar_jerga_parte.py`.

Uso: python scripts/audit_jerga_parte.py
     python scripts/audit_jerga_parte.py --limite 200000
     python scripts/audit_jerga_parte.py --esi      (pregunta por los nombres largos desconocidos)
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import sqlite3

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, AQUI)

# ★ La mascara de privacidad y la busqueda de la base de datos se REUTILIZAN de `audit_intel.py`.
#   No se copian: un fallo de enmascarado arreglado en un sitio tiene que quedar arreglado en los
#   dos, y ya paso una vez (la mascara solo tapaba MAYUSCULAS y el intel se escribe en minuscula).
from audit_intel import enmascarar, preguntar_esi, ruta_bd  # noqa: E402

LIMITE = 0
if "--limite" in sys.argv:
    LIMITE = int(sys.argv[sys.argv.index("--limite") + 1])
ESI = "--esi" in sys.argv


def main() -> int:
    ruta = ruta_bd()
    if not os.path.isfile(ruta):
        print(f"No encuentro la base de datos en:\n  {ruta}")
        return 1
    node = shutil.which("node")
    if not node:
        print("No encuentro `node` en el PATH. Hace falta para trocear con el parser de la app.")
        return 1

    db = sqlite3.connect(f"file:{ruta}?mode=ro", uri=True)
    n = db.execute("SELECT COUNT(*) FROM intel_line").fetchone()[0]
    if n == 0:
        print("`intel_line` esta vacia: importa el historico antes (Ajustes -> Intel).")
        return 1
    print(f"Base de datos: {ruta}")
    print(f"Lineas guardadas: {n:,}{f'  (se auditan {LIMITE:,})' if LIMITE else ''}\n")

    tmp = tempfile.mkdtemp(prefix="koru-jerga-")
    jsonl, cache_j, salida = (os.path.join(tmp, x) for x in ("lineas.jsonl", "cache.json", "out.json"))
    sql = "SELECT texto FROM intel_line" + (f" LIMIT {LIMITE}" if LIMITE else "")
    with open(jsonl, "w", encoding="utf-8") as f:
        for (texto,) in db.execute(sql):
            f.write(json.dumps({"texto": texto}, ensure_ascii=False) + "\n")

    cache = {}
    for nl, cid in db.execute("SELECT name_lower, character_id FROM name_cache"):
        if cid is not None:
            cache[nl] = 1 if cid > 0 else -1
    with open(cache_j, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False)
    print(f"  name_cache: {len(cache):,} nombres con veredicto de ESI")

    r = subprocess.run(
        [node, os.path.join(AQUI, "audit_jerga_parte.mjs"), RAIZ, jsonl, cache_j, salida],
        capture_output=True, text=True,
    )
    print(r.stdout.strip())
    if r.returncode != 0:
        print("Fallo al trocear:\n" + (r.stderr[-2000:] or "(sin salida)"))
        return 1
    with open(salida, encoding="utf-8") as f:
        d = json.load(f)
    shutil.rmtree(tmp, ignore_errors=True)

    print("\n" + "=" * 74)
    print("CUANTO PASA ESTO")
    print("=" * 74)
    print(f"  lineas auditadas                          {d['lineas']:>10,}")
    print(f"  lineas que sacan al menos un piloto       {d['lineasConPiloto']:>10,}")
    print(f"  lineas donde la jerga CORTA un nombre     {d['lineasCortadas']:>10,}"
          f"   ({100*d['lineasCortadas']/(d['lineasConPiloto'] or 1):.1f} % de las que sacan piloto)")
    print(f"  cortes por DETRAS  («Iam» + «Neutral»)    {d['totalDetras']:>10,}")
    print(f"  cortes por DELANTE («Red» + «Fox»)        {d['totalDelante']:>10,}")
    print(f"  TECHO: cortes donde hoy NO sale nadie     {d['totalPerdidos']:>10,}   <- el caso peor")
    print("     ^ la mitad corta tampoco llega a piloto («CCTV Eyes»: ESI ya dijo que CCTV no")
    print("       existe), asi que la persona se pierde ENTERA y en silencio. Es un TECHO, no un")
    print("       hecho: aqui no hay veredicto del troceador, solo que ningun catalogo la reclama.")
    print(f"\n  de todo eso, el nombre largo YA confirmado por ESI: {d['confirmadosYa']:,}")
    print("     ^ eso es lo que se recupera SIN gastar una sola peticion.")

    for clave, etq, ejemplo in [
        ("jergaDetras", "LA JERGA QUE CORTA POR DETRAS", "«Iam» + «Neutral» -> «Iam Neutral»"),
        ("jergaDelante", "LA JERGA QUE CORTA POR DELANTE", "«Red» + «Fox» -> «Red Fox»"),
        ("jergaPerdidos", "LA JERGA QUE HACE DESAPARECER A ALGUIEN (techo)", "«CCTV» + «Eyes»"),
    ]:
        filas = d.get(clave) or []
        if not filas:
            continue
        print("\n" + "=" * 74)
        print(f"{etq}   ({ejemplo})")
        print("  veces = cortes totales   gente = personas distintas cortadas")
        print("  si/no/? = veredicto de name_cache sobre el nombre LARGO (?  = nadie lo ha preguntado)")
        print("=" * 74)
        print("  MAY   = veces que la palabra venia con mayuscula inicial (pista, NO veredicto)")
        print("  ratio = veces / gente  <-- LA PUERTA. Un apellido lo lleva poca gente y se repite")
        print("          mucho; una palabra de jerga la lleva todo el mundo detras.")
        print("  obj   = la lectura larga es el principio del nombre de un OBJETO del mercado")
        print(f"  {'palabra':<14} {'ratio':>7} {'veces':>8} {'MAY':>7} {'gente':>7} "
              f"{'si':>7} {'no':>7} {'?':>8} {'obj':>7}")
        # Se imprimen TODAS las que pasan la puerta y las 15 siguientes: el corte hay que VERLO.
        # El resto es cola larga de jerga confirmada y solo se cuenta, para no llenar la pantalla.
        arriba = [x for x in filas if x["ratio"] >= d["ratio"]]
        abajo = [x for x in filas if x["ratio"] < d["ratio"]]
        for x in arriba:
            print(f"  {enmascarar(x['jerga']):<14} {x['ratio']:>7} {x['veces']:>8,} "
                  f"{x['mayus']:>7,} {x['distintos']:>7,} {x['si']:>7,} {x['no']:>7,} "
                  f"{x['duda']:>8,} {x['obj']:>7,}")
        print(f"  {'':-<14}-- PUERTA: ratio {d['ratio']} --{'':-<40}")
        for x in abajo[:15]:
            print(f"  {enmascarar(x['jerga']):<14} {x['ratio']:>7} {x['veces']:>8,} "
                  f"{x['mayus']:>7,} {x['distintos']:>7,} {x['si']:>7,} {x['no']:>7,} "
                  f"{x['duda']:>8,} {x['obj']:>7,}")
        if len(abajo) > 15:
            print(f"  ... y {len(abajo)-15} palabras mas, todas por debajo de "
                  f"{abajo[15]['ratio']} — es la jerga de siempre (GRUPO DE CONTROL).")

    cp = d.get("candidatosPuerta") or []
    print("\n" + "=" * 74)
    print(f"★ LO QUE PASA LA PUERTA (ratio >= {d['ratio']})  —  ESTA es la lista que hay que juzgar")
    print("=" * 74)
    print(f"  cortes que pasan la puerta: {d['cortesPuerta']:,}  "
          f"(de ellos {d['cortesPuertaObjeto']:,} son un OBJETO del mercado, no una persona)")
    print(f"  {'veces':>7} {'MAY':>5}  {'lectura corta':<24} {'lectura larga':<30} corto largo obj")
    for x in cp[:70]:
        print(f"  {x['veces']:>7,} {x['mayus']:>5,}  {enmascarar(x['corto']):<24} "
              f"{enmascarar(x['largo']):<30} {x['esiCorto']:>5} {x['esiLargo']:>5} "
              f"{'OBJ' if x['obj'] else '':>4}")
    if len(cp) > 70:
        print(f"  ... y {len(cp)-70} pares mas.")

    print("\n" + "=" * 74)
    print("A QUIEN CORTA  (todo, sin puerta — las dos lecturas, sin elegir)")
    print("  esi corto / esi largo:  si = ESI lo confirma · no = ESI dice que no existe · ? = sin preguntar")
    print("  ⚠️ 'largo = si' NO cierra el caso por si solo: existe gente llamada «Small» o «ESS».")
    print("     Lo que hace probable la lectura larga es que la corta NO exista, o que la larga se")
    print("     escriba asi una y otra vez en el mismo canal.")
    print("=" * 74)
    print(f"  {'veces':>7} {'MAY':>5}  {'lectura corta':<24} {'lectura larga':<30} corto largo")
    for x in (d.get("candidatosDetras") or [])[:60]:
        print(f"  {x['veces']:>7,} {x['mayus']:>5,}  {enmascarar(x['corto']):<24} "
              f"{enmascarar(x['largo']):<30} {x['esiCorto']:>5} {x['esiLargo']:>5}")

    for clave, etq in [("candidatosDelante", "por delante"),
                       ("candidatosPerdidos", "los que hoy NO sacan a nadie (techo)")]:
        cd = d.get(clave) or []
        if cd:
            print(f"\n  --- {etq} ---")
            for x in cd[:30]:
                print(f"  {x['veces']:>7,} {x['mayus']:>5,}  {enmascarar(x['corto']):<24} "
                      f"{enmascarar(x['largo']):<30} {x['esiCorto']:>5} {x['esiLargo']:>5}")

    dudas = d.get("dudas") or []
    dudas_may = d.get("dudasMayus") or []
    print("\n" + "=" * 74)
    print("LO QUE COSTARIA CERRARLO DEL TODO")
    print("=" * 74)
    dudas_p = d.get("dudasPuerta") or []
    print(f"  Preguntando por TODO:                  {len(dudas):>7,} nombres, "
          f"{(len(dudas) + 249) // 250:>4} peticiones   <- impagable")
    print(f"  Solo los que venian CON MAYUSCULA:     {len(dudas_may):>7,} nombres, "
          f"{(len(dudas_may) + 249) // 250:>4} peticiones")
    print(f"  ★ Solo los que PASAN LA PUERTA:        {len(dudas_p):>7,} nombres, "
          f"{(len(dudas_p) + 249) // 250:>4} peticiones")
    print("     (y sin los que ya son un objeto del mercado: eso es catalogo, no ESI)")
    print("  (`/universe/ids/` acepta 250 nombres por peticion; la respuesta se guarda para siempre)")
    print("  ⚠️ La mayuscula NO es prueba de nada —eso quedo desmentido hoy— pero SI es un buen")
    print("     filtro para no preguntar por «Fulano Perez on»: aqui solo decide a quien se")
    print("     PREGUNTA, nunca quien es una persona. Eso lo sigue contestando ESI.")
    # ⚠️ `--esi` pregunta SOLO por lo que pasa la puerta, nunca por los 85.903. Los limites de ESI
    #    cuentan PETICIONES desde diciembre de 2025, y 344 peticiones por una auditoria no se pagan.
    #    Si algun dia hiciera falta preguntar por todo, que sea una decision suya y explicita.
    dudas = dudas_p
    if dudas and not ESI:
        print("\n  Para preguntarlo ahora:  python scripts/audit_jerga_parte.py --esi")
        print(f"  (solo los {len(dudas):,} que pasan la puerta, "
              f"{(len(dudas) + 249) // 250} peticiones — nunca los {len(d.get('dudas') or []):,})")
    elif dudas and ESI:
        print(f"\n  Preguntando a ESI por {len(dudas):,} nombres (los que pasan la puerta)...")
        reales = preguntar_esi(dudas)
        print(f"  ESI reconoce como PERSONAJE {len(reales):,} de {len(dudas):,}:\n")
        # Se ordenan por las veces que aparecian, no alfabeticamente: lo primero que se lee tiene
        # que ser lo que mas dano hace hoy.
        veces = {}
        for k in ("candidatosDetras", "candidatosDelante", "candidatosPerdidos"):
            for x in (d.get(k) or []):
                veces[x["largo"].lower()] = x["veces"]
        enc = sorted(reales.items(), key=lambda kv: -veces.get(kv[0], 0))
        for i, (lc, canonico) in enumerate(enc[:80]):
            print(f"  {veces.get(lc, 0):>7,}  {enmascarar(canonico):<26}",
                  end="\n" if i % 2 == 1 else "")
        print()
        print(f"\n  Suman {sum(veces.get(lc, 0) for lc in reales):,} cortes a personas REALES.")
        print("  ⚠️ Esto NO se ha escrito en `name_cache`: este script solo lee. La respuesta la")
        print("     guarda la app cuando el troceador proponga las dos lecturas.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
