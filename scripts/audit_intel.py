#!/usr/bin/env python3
"""AUDITORIA DEL INTEL: que escribe la gente de verdad, sobre las lineas guardadas.

# Por que existe (2026-09-08). Idea de RoGiz7.

Llevabamos el dia entero afinando el troceador a base de capturas suyas. Su propuesta:
*«¿podemos hacer una auditoria de toda esa informacion para que aprendas como se mencionan los
nombres, naves y eventos? tal vez asi en vez de por pantallazos mios puedas resolver mejor como
afinar el intel»*. Es la misma disciplina que ya aplicamos al `WH`: **la lista de jerga no se
inventa, se saca de lo que la gente escribe** — solo que ahora vale para todo el troceador.

Esto no era posible esta manana. Lo hace posible `intel_line`, que guarda 826.781 lineas de seis
anos de intel.

# Como funciona, y la regla que lo hace fiable

Python lee SQLite. Node trocea con `src/intel.ts`, **el troceador de la app**. Koru ya tiene TRES
troceadores y este NO es el cuarto: si el auditor clasificara por su cuenta, el informe mediria al
auditor y no a Koru.

⚠️ Solo LEE la base de datos (`mode=ro`), y **enmascara los codigos de sistema** en todo lo que
imprime: las cifras son presumibles, una ubicacion es accionable.

Uso: python scripts/audit_intel.py            (todas las lineas)
     python scripts/audit_intel.py --limite 200000
     python scripts/audit_intel.py --esi       (ademas, pregunta a ESI por lo desconocido)
"""
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
FICHERO = "koru-desktop.sqlite3"
CARPETAS = ["koru-desktop", "com.rekium.korudesktop"]

LIMITE = 0
if "--limite" in sys.argv:
    LIMITE = int(sys.argv[sys.argv.index("--limite") + 1])
ESI = "--esi" in sys.argv

# ⚠️ ESI limita PETICIONES desde diciembre de 2025, no solo errores. Esto es una auditoria puntual y
# de LECTURA, asi que se manda en tandas grandes (un POST por cada 250 nombres, ~2 peticiones para
# los 400 candidatos) y **solo si se pide con --esi**. Nunca se repregunta lo que ya sabemos: los
# nombres que ya tienen veredicto en `name_cache` ni siquiera llegan hasta aqui.
ESI_URL = "https://esi.evetech.net/latest/universe/ids/?datasource=tranquility"
ESI_TANDA = 250
# ESI exige identificarse. Va el ALIAS publico, nunca un dato personal.
ESI_UA = "koru-desktop/auditoria-intel (RoGiz7)"


def preguntar_esi(nombres: list) -> dict:
    """nombre_en_minusculas -> nombre canonico, solo para los que ESI reconoce como PERSONAJE.

    `/universe/ids/` tambien devuelve corporaciones, alianzas, sistemas y tipos con ese nombre. Se
    mira UNICAMENTE `characters`: que exista una corp llamada «fleet» no convierte a `fleet` en un
    piloto. Si la peticion falla, se dice y se sigue: el resto del informe no depende de esto.
    """
    salida = {}
    for i in range(0, len(nombres), ESI_TANDA):
        tanda = nombres[i:i + ESI_TANDA]
        req = urllib.request.Request(
            ESI_URL,
            data=json.dumps(tanda).encode("utf-8"),
            headers={"Content-Type": "application/json", "Accept": "application/json",
                     "User-Agent": ESI_UA, "X-User-Agent": ESI_UA},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                d = json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            print(f"  ⚠️ ESI respondio {e.code} en la tanda {i // ESI_TANDA + 1}: "
                  f"{e.read()[:200].decode('utf-8', 'replace')}")
            continue
        except Exception as e:  # red caida, DNS, timeout...
            print(f"  ⚠️ No pude hablar con ESI: {e}")
            return salida
        for p in d.get("characters", []) or []:
            salida[p["name"].lower()] = p["name"]
    return salida


def ruta_bd() -> str:
    args = [a for a in sys.argv[1:] if not a.startswith("--") and not a.isdigit()]
    if args:
        return args[0]
    appdata = os.environ.get("APPDATA", "")
    for c in CARPETAS:
        p = os.path.join(appdata, c, FICHERO)
        if os.path.isfile(p):
            return p
    return os.path.join(appdata, CARPETAS[0], FICHERO)


def _prefijos_null() -> set:
    """Todas las formas ABREVIADAS de un sistema de null, que es como se escriben de verdad.

    ⚠️ ESTO NACE DE UN FALLO MIO (2026-09-08). `enmascarar` solo tapaba `AB1-CD` en MAYUSCULAS, y el
    intel se escribe en minuscula: el informe imprimio sus abreviaturas de casa —tres letras, sin
    guion muchas veces— tal cual, y el se las pego a otro sitio dos veces. La mascara existia y daba
    sensacion de seguridad mientras dejaba pasar justo el formato mas comun.

    Se marcan solo los sistemas cuyo NOMBRE lleva digito o guion (los codigos). Los sistemas con
    nombre propio no se tocan: taparlos borraria palabras normales del informe sin ganar nada.
    """
    pres = set()
    try:
        with open(os.path.join(RAIZ, "public", "neweden.json"), encoding="utf-8") as f:
            d = json.load(f)
    except Exception:
        return pres
    for s in d.get("systems", []):
        n = s.get("n") or ""
        if s.get("s", 1.0) >= 0.05 or not re.search(r"[\d-]", n):
            continue
        lo = n.lower()
        pres.add(lo)
        for k in range(2, len(lo)):
            pres.add(lo[:k])
    return pres


PREFIJOS_NULL = _prefijos_null()


def enmascarar(s: str) -> str:
    """Un codigo de null es accionable; el resto del texto no. Se enmascara SIEMPRE."""
    s = re.sub(r"\b[A-Z0-9]{1,4}-[A-Z0-9]{1,4}\b", "XXX-XX", s, flags=re.IGNORECASE)
    # ⚠️ Se exige que el propio token lleve DIGITO O GUION, que es como se ve un codigo. Sin eso,
    # bajar el minimo a dos letras taparia palabras corrientes («mo», «we») por ser prefijo de algun
    # sistema, y un informe que borra lo que no debe deja de servir para lo que lo hicimos.
    def _uno(m):
        t = m.group(0)
        # Un numero suelto o un «x2» son CANTIDADES, no ubicaciones: taparlos no protege nada y
        # rompe el informe. Es la misma forma que el troceador ya distingue en `ES_CANTIDAD`.
        if re.fullmatch(r"\d+|\d+x|x\d+", t, flags=re.IGNORECASE):
            return t
        return "XXX" if re.search(r"[\d-]", t) and t.lower() in PREFIJOS_NULL else t

    return re.sub(r"[A-Za-z0-9][A-Za-z0-9-]+", _uno, s)


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
        print("`intel_line` esta vacia: importa el historico antes (Ajustes → Intel).")
        return 1
    print(f"Base de datos: {ruta}")
    print(f"Lineas guardadas: {n:,}{f'  (se auditan {LIMITE:,})' if LIMITE else ''}\n")

    tmp = tempfile.mkdtemp(prefix="koru-audit-")
    jsonl, cache_j, salida = (os.path.join(tmp, x) for x in ("lineas.jsonl", "cache.json", "out.json"))

    # `autor` y `ts_ms` hacen falta para la DISPERSION: cuanta gente distinta lo dice y desde cuando.
    # Es la unica señal candidata para distinguir jerga de persona, y sin quien-y-cuando no existe.
    sql = ("SELECT canal, autor, ts_ms, texto FROM intel_line"
           + (f" LIMIT {LIMITE}" if LIMITE else ""))
    with open(jsonl, "w", encoding="utf-8") as f:
        for canal, autor, ts_ms, texto in db.execute(sql):
            f.write(json.dumps({"canal": canal, "autor": autor, "ts": ts_ms, "texto": texto},
                               ensure_ascii=False) + "\n")

    # 1 = ESI lo resolvio como persona · -1 = ESI dice que no es de nadie. Lo demas, sin preguntar.
    cache = {}
    for nl, cid in db.execute("SELECT name_lower, character_id FROM name_cache"):
        if cid is not None:
            cache[nl] = 1 if cid > 0 else -1
    with open(cache_j, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False)
    print(f"  name_cache: {len(cache):,} nombres con veredicto de ESI")

    r = subprocess.run(
        [node, os.path.join(AQUI, "audit_intel.mjs"), RAIZ, jsonl, cache_j, salida],
        capture_output=True, text=True,
    )
    print(r.stdout.strip())
    if r.returncode != 0:
        print("Fallo al trocear:\n" + (r.stderr[-2000:] or "(sin salida)"))
        return 1
    with open(salida, encoding="utf-8") as f:
        d = json.load(f)
    shutil.rmtree(tmp, ignore_errors=True)

    L = d["lineas"] or 1
    pc = lambda x: f"{100*x/L:5.1f} %"
    print("\n" + "=" * 72)
    print("QUE FORMA TIENEN LAS LINEAS")
    print("=" * 72)
    for k, etq in [
        ("dobleEspacio", "usan DOBLE espacio (la convencion)"),
        ("conSistema", "nombran un sistema reconocido"),
        ("conPiloto", "sacan al menos un piloto"),
        ("conNave", "sacan al menos una nave"),
        ("conContador", "traen un contador (+N)"),
        ("clears", "son un «clear»"),
        ("conEnlace", "traen el ENLACE del juego dentro"),
        ("mudas", "NO PRODUCEN NADA  <-- lo que se pierde"),
    ]:
        print(f"  {etq:<38} {d[k]:>9,}  {pc(d[k])}")

    print("\n" + "=" * 72)
    print("LO QUE EL TROCEADOR TIRA  (ni sistema, ni nave, ni nombre, ni jerga conocida)")
    print("Aqui esta la jerga que NO conocemos, ordenada por lo que de verdad se escribe.")
    print("=" * 72)
    for i, (tok, c) in enumerate(d["descartados"][:120]):
        print(f"  {c:>7,}  {enmascarar(tok)}", end="\n" if i % 3 == 2 else "")
    print()

    # ★★ LO QUE SE PIERDE POR ESCRIBIRSE EN MINUSCULA (2026-09-08). Idea suya: *«¿y si creamos una
    #    condicion que diga que si ya se resuelve el sistema, lo demas se considera como nombres?»*.
    #    Tal cual no puede ser —solo el 78 % de las lineas nombran un sistema, y las que lo hacen van
    #    llenas de jerga que se convertiria en hostiles inventados—, pero la intuicion de fondo era
    #    correcta: SI hay nombres perdiendose. Esto los cuenta antes de tocar el troceador.
    pn = d.get("posiblesNombres") or []
    if pn:
        print("\n" + "=" * 72)
        print("DESCARTADOS QUE PARECEN PERSONAS  (hoy se tiran por no llevar mayuscula inicial)")
        print("  veces  = cuantas veces se tiro       entero = veces que Koru YA lo saca como piloto")
        print("  parte  = dentro de un nombre mas largo    esi = ESI resuelve ese nombre")
        print("  SOLO   = era TODO su campo (doble espacio) -> formato de reporte, no de frase")
        print("  +SIS   = ademas la linea resolvia un sistema  <-- la version estricta de la idea")
        print("  ⚠️ 'esi = sí' NO es prueba: 'dead' y 'blue' son personajes reales.")
        print("=" * 72)
        print(f"  {'token':<20} {'veces':>8} {'entero':>7} {'parte':>7} {'SOLO':>7} {'+SIS':>7}  esi")
        for x in pn[:60]:
            print(f"  {enmascarar(x['tok']):<20} {x['veces']:>8,} {x['entero']:>7,} "
                  f"{x['parte']:>7,} {x.get('solo', 0):>7,} {x.get('solosis', 0):>7,}  {x['esi']}")
        print()
        print(f"  {d['posiblesNombresTotal']:,} tokens distintos, "
              f"{d['posiblesNombresVeces']:,} apariciones en total.")
        print(f"  De las {d['mudas']:,} lineas que NO PRODUCEN NADA, {d['mudasRescatables']:,} "
              f"({100*d['mudasRescatables']/(d['mudas'] or 1):.1f} %) llevan dentro")
        print("  al menos uno de estos tokens. Ese es el TECHO de lo que se recuperaria.")

    desc = d.get("desconocidos") or []
    if desc:
        print("\n" + "=" * 72)
        print("PALABRAS DE LAS QUE NADIE SABE NADA  (ni ESI preguntado, ni vistas como nombre)")
        print("=" * 72)
        print("  veces / SOLO en su campo / +SIS la linea ademas resolvia un sistema")
        for i, fila in enumerate(desc[:60]):
            tok, c = fila[0], fila[1]
            solo, sis = (fila[2], fila[3]) if len(fila) > 3 else (0, 0)
            print(f"  {c:>6,} {solo:>5,} {sis:>5,}  {enmascarar(tok):<20}",
                  end="\n" if i % 2 == 1 else "")
        print()
        if not ESI:
            print(f"\n  Hay {len(desc):,}. Para saber cuales son personas de verdad:")
            print("  python scripts/audit_intel.py --esi     "
                  f"({(len(desc) + 249) // 250} peticiones a ESI, solo lectura)")
        else:
            print(f"\n  Preguntando a ESI por {len(desc):,} nombres "
                  f"({(len(desc) + 249) // 250} peticiones)...")
            reales = preguntar_esi([f[0] for f in desc])
            cuenta = {f[0]: f[1] for f in desc}
            enc = sorted(reales.items(), key=lambda kv: -cuenta.get(kv[0], 0))
            print(f"  ESI reconoce como PERSONAJE {len(enc):,} de {len(desc):,}:\n")
            for i, (lc, canonico) in enumerate(enc[:60]):
                print(f"  {cuenta.get(lc, 0):>7,}  {enmascarar(canonico):<22}",
                      end="\n" if i % 2 == 1 else "")
            print()
            perdidas = sum(cuenta.get(lc, 0) for lc in reales)
            print(f"\n  Suman {perdidas:,} apariciones tiradas.")
            print("  ⚠️ Que ESI diga que existe NO significa que en esa linea se hablara de esa")
            print("     persona: hay palabras corrientes que son nombre de alguien. Lo que decide")
            print("     es que ADEMAS el corpus lo escriba con mayuscula (columna 'entero').")

    # ★★ ¿PUEDE UNA MAQUINA APRENDER LA JERGA SOLA? Idea suya. Se mide con grupo de control: si la
    #    señal no separa la jerga que YA conocemos de las personas que ESI YA confirmo, no sirve.
    di = d.get("dispersion") or {}
    if di:
        print("\n" + "=" * 72)
        print("¿SE PUEDE DISTINGUIR JERGA DE PERSONA SIN PREGUNTAR?  (medianas)")
        print("Hipotesis: una persona sale en pocos sistemas y la dice poca gente; un concepto")
        print("del juego sale en todas partes, siempre, y lo dice todo el mundo.")
        print("Los dos primeros grupos son CONTROL: ya sabemos lo que son.")
        print("=" * 72)
        print(f"  {'grupo':<28} {'n':>6} {'veces':>8} {'sistemas':>9} {'autores':>8} {'dias':>7}")
        for k, etq in [("jerga", "JERGA ya conocida (control)"),
                       ("persona", "PERSONAS de ESI (control)"),
                       ("duda", "los que hay que clasificar")]:
            g = di.get(k) or {}
            if g.get("n"):
                print(f"  {etq:<28} {g['n']:>6,} {g['veces']:>8,} {g['sistemas']:>9,} "
                      f"{g['autores']:>8,} {g['dias']:>7,}")
        print("\n  ⚠️ 'sistemas' esta topado en 400: sirve para distinguir pocos de muchos, no mas.")

        def muestra(clave, titulo):
            filas = di.get(clave) or []
            if not filas:
                return
            print(f"\n  --- {titulo} ---")
            print(f"  {'token':<24} {'veces':>7} {'sist':>6} {'aut':>6} {'dias':>6}  esi")
            for x in filas:
                print(f"  {enmascarar(x['tok']):<24} {x['v']:>7,} {x['sis']:>6,} "
                      f"{x['aut']:>6,} {x['dias']:>6,}  {x['esi']}")

        muestra("muestraJerga", "JERGA conocida (asi se ve un concepto del juego)")
        muestra("muestraPersona", "PERSONAS confirmadas (asi se ve alguien de carne y hueso)")
        muestra("muestraDuda", "LOS QUE HAY QUE CLASIFICAR — ¿a cual de los dos se parecen?")

    # ★★ EL DECISOR QUE FALTABA. Idea suya viendo el informe: *«small dudo que sea una persona,
    #    tiene mas pinta de ser small bubble o small gang»*. Ni yo ni ESI podemos saberlo —ESI
    #    confirma que existe alguien llamado «Small», que es la trampa de `ess`— pero el corpus sí:
    #    lo que va DETRAS lo dice. Esto es lo que convierte la tabla de jerga en algo decidible.
    sos = d.get("sospechosos") or []
    if sos:
        print("\n" + "=" * 72)
        print("PALABRAS QUE SON PERSONA **Y** PALABRA CORRIENTE  <-- ESTAS LAS DECIDES TU")
        print("ESI dice que existe alguien con ese nombre. Eso NO basta: tambien existe un")
        print("personaje llamado ESS y le colgamos 4.218 avistamientos falsos.")
        print("Si detras viene 'gang' o 'bubble', es jerga. Si viene un apellido, es una persona.")
        print("=" * 72)
        for x in sos:
            print(f"\n  {enmascarar(x['tok']).upper()}   {x['v']:,} lineas · "
                  f"Koru la ficha como piloto {x['entero']:,} veces")
            print(f"     detras:  {enmascarar(x['detras'])}")
            print(f"     delante: {enmascarar(x['delante'])}")

    pres = d.get("presupuesto") or {}
    if pres:
        print("\n" + "=" * 72)
        print("EL PRESUPUESTO: si el troceador preguntara a ESI por lo tirado, ¿cuanto costaria?")
        print("Cada nombre se pregunta UNA vez en la VIDA y la respuesta se guarda. Esto es el total")
        print("historico sobre seis años de intel, no un coste por sesion.")
        print("=" * 72)
        print(f"  {'filtro':<40} {'tokens':>9} {'apariciones':>13}")
        for k, (n, ap) in pres.items():
            print(f"  {k:<40} {n:>9,} {ap:>13,}")

    # ★★ «23 redeemers»: el tamaño de la banda que hoy se tira. Salio de una captura suya.
    if d.get("numNaveLineas"):
        print("\n" + "=" * 72)
        print("UN NUMERO SUELTO DELANTE DE UNA NAVE  («23 redeemers»)")
        print("Koru entiende '+4' y 'x4', pero un numero a secas lo tira. Eso es el TAMAÑO DE LA")
        print("BANDA, que es lo que decide si sales o te escondes.")
        print("=" * 72)
        print(f"  lineas con el patron:                  {d['numNaveLineas']:>9,}  "
              f"{100*d['numNaveLineas']/L:5.1f} %")
        print(f"  ...y que HOY no traen contador ninguno: {d['numNaveSinContador']:>8,}  "
              f"{100*d['numNaveSinContador']/L:5.1f} %   <-- lo que se ganaria")
        print()
        for i, (par, c) in enumerate(d.get("numAntesNave") or []):
            print(f"  {c:>6,}  {enmascarar(par):<22}", end="\n" if i % 3 == 2 else "")
        print()

    if d.get("rotuloSistema"):
        print("\n" + "=" * 72)
        print("EL ROTULO «Solar System»  (hoy se quita SOLO si trae guion detras)")
        print("=" * 72)
        print(f"  lineas que lo llevan:            {d['rotuloSistema']:>9,}")
        print(f"  ...de esas, SIN guion (se cuela): {d['rotuloSinGuion']:>9,}")
        for s in (d.get("ejemplosRotulo") or [])[:6]:
            print("    " + enmascarar(s.strip())[:120])

    print("\n" + "=" * 72)
    print("CANDIDATOS A PILOTO  (sí = ESI lo confirma · NO = ESI dice que no existe · ? = sin preguntar)")
    print("=" * 72)
    for nombre, c in d["pilotos"][:80]:
        print(f"  {c:>7,}  {enmascarar(nombre)}")

    if d["naveEnNombre"]:
        print("\n" + "=" * 72)
        print("NOMBRES QUE CONTIENEN UNA NAVE  (el caso «Escal Zephyr»)")
        print("=" * 72)
        for nombre, c in d["naveEnNombre"][:30]:
            print(f"  {c:>7,}  {enmascarar(nombre)}")

    if d["alts"]:
        print("\n" + "=" * 72)
        print("LAS DOS LECTURAS  (corto ⟂ largo — hoy decide ESI; el caso «Dee Yona»)")
        print("=" * 72)
        for a, c in d["alts"][:25]:
            print(f"  {c:>7,}  {enmascarar(a)}")

    print("\n" + "=" * 72)
    print("LINEAS QUE NO PRODUCEN NADA  (muestra)")
    print("=" * 72)
    for s in d["ejemplosMudas"][:25]:
        print("  " + enmascarar(s.strip())[:150])
    return 0


if __name__ == "__main__":
    sys.exit(main())
