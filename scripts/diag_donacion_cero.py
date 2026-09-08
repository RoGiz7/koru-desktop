#!/usr/bin/env python3
"""¿Te afecto la fuga de saldos del 4 de septiembre de 2026?

# Por que existe (2026-09-08)

CCP publico un aviso de seguridad: un cliente modificado podia mandar una donacion y, a cambio, VER
EL SALDO de quien la recibia. Cuatro cuentas mandaron ~1.000.000 de donaciones de 0 ISK el viernes
4 de septiembre entre las 15:00 y las 21:00 UTC.

La forma de saber si te toco es mirar tu diario de cartera... y Koru ya lo tiene guardado, para los
nueve personajes a la vez. Eso es exactamente para lo que sirve tener el historico en casa: la
pregunta se contesta en un segundo en vez de abriendo nueve clientes.

⚠️ Lo expuesto fue SOLO el saldo en ese instante (y el de la cartera maestra de la corp). NO se
expusieron usuario, correo, PLEX ni transacciones. Y el saldo capturado NO se actualiza: es una foto
de aquel momento. Fuente: el aviso de seguridad del 8-sep-2026.

⚠️ Solo LEE la base de datos (`mode=ro`). No modifica nada.

Uso: python scripts/diag_donacion_cero.py
"""
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request

# ⚠️ UNA PETICION, Y SOLO SI HACE FALTA. `name_cache` solo tiene los nombres que Koru ya resolvio
# alguna vez, asi que un remitente desconocido sale como un numero — y con un numero no se puede
# contestar «¿es uno de los cuatro del aviso?». Se pregunta por los ids encontrados en UNA llamada.
ESI_NOMBRES = "https://esi.evetech.net/latest/universe/names/?datasource=tranquility"
ESI_UA = "koru-desktop/diag-donacion-cero (RoGiz7)"


def nombres_esi(ids: list) -> dict:
    """id -> nombre, con una sola peticion. Si falla, se devuelve vacio y se dice."""
    if not ids:
        return {}
    req = urllib.request.Request(
        ESI_NOMBRES,
        data=json.dumps(sorted(set(ids))).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json",
                 "User-Agent": ESI_UA, "X-User-Agent": ESI_UA},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return {x["id"]: x["name"] for x in json.loads(r.read().decode("utf-8"))}
    except Exception as e:
        print(f"   (no pude preguntar a ESI por los nombres: {e})")
        return {}

FICHERO = "koru-desktop.sqlite3"
CARPETAS = ["koru-desktop", "com.rekium.korudesktop"]

# Los cuatro personajes que nombra el aviso de CCP.
CULPABLES = ["Mye Esubria", "fxprobe1", "fenriscw1", "Skiasten"]
# La ventana que da el aviso, en UTC. `date` se guarda en ISO-8601 UTC, asi que compara en texto.
DESDE = "2026-09-04T15:00"
HASTA = "2026-09-04T21:00"


def ruta_bd() -> str:
    if len(sys.argv) > 1:
        return sys.argv[1]
    appdata = os.environ.get("APPDATA", "")
    for c in CARPETAS:
        p = os.path.join(appdata, c, FICHERO)
        if os.path.isfile(p):
            return p
    return os.path.join(appdata, CARPETAS[0], FICHERO)


def main() -> int:
    ruta = ruta_bd()
    if not os.path.isfile(ruta):
        print(f"No encuentro la base de datos en:\n  {ruta}")
        return 1
    db = sqlite3.connect(f"file:{ruta}?mode=ro", uri=True)
    print(f"Base de datos: {ruta}")
    print(f"Ventana del aviso: {DESDE} a {HASTA} UTC\n")

    # 1) Lo que de verdad importa: donaciones de 0 ISK en esa ventana, sea quien sea el remitente.
    #    Se busca por CANTIDAD y FECHA, no por nombre: el aviso da cuatro nombres, pero quien mira
    #    su propio diario no tiene por que fiarse de que la lista este completa.
    filas = db.execute(
        """SELECT wj.character_id, wj.date, wj.ref_type, wj.amount, wj.first_party_id,
                  COALESCE(nc.display_name, '') AS quien
             FROM wallet_journal wj
        LEFT JOIN name_cache nc ON nc.character_id = wj.first_party_id
            WHERE wj.date >= ? AND wj.date < ?
              AND (wj.amount = 0 OR wj.amount IS NULL)
         ORDER BY wj.date""",
        (DESDE, HASTA),
    ).fetchall()

    # Cuantos personajes tuyos hay en la BD, para que un 0 se pueda interpretar.
    chars = db.execute("SELECT COUNT(DISTINCT character_id) FROM wallet_journal").fetchone()[0]
    total = db.execute("SELECT COUNT(*) FROM wallet_journal").fetchone()[0]
    print(f"Diario de cartera: {total:,} apuntes de {chars} personajes\n")

    if not filas:
        print("✅ NINGUNA donacion de 0 ISK en esa ventana.")
        print("   Ojo con lo que esto significa y lo que no: dice que en LO QUE KORU TIENE")
        print("   GUARDADO no aparece. ESI sirve 30 dias de diario, asi que si un personaje no")
        print("   sincronizo desde antes del 4-sep, ese apunte puede no haberse descargado nunca.")
    else:
        # ⚠️ Los remitentes desconocidos se RESUELVEN antes de imprimir nada. Sin esto el informe
        # decia «de 2124685588» y, dos lineas mas abajo, «ninguno de los cuatro aparece» — dos
        # frases que juntas insinuan que hay un quinto remitente cuando lo unico que pasa es que
        # Koru no tenia ese nombre guardado. Un informe no puede dejar esa duda abierta.
        print(f"⚠️ {len(filas)} apunte(s) de 0 ISK en la ventana del aviso:\n")
        faltan = [q for _, _, _, _, q, nom in filas if q and not nom]
        resueltos = nombres_esi(faltan)
        remitentes = {}
        for cid, fecha, ref, amt, quien_id, quien in filas:
            nom = quien or resueltos.get(quien_id) or f"id {quien_id}"
            remitentes[quien_id] = nom
            print(f"   personaje {cid} · {fecha} · {ref} · {amt} ISK · de {nom}")
        print("\n   Lo expuesto seria SOLO tu saldo en ese instante. Ni usuario, ni correo, ni")
        print("   PLEX, ni transacciones. Y no se refresca: es una foto de aquel momento.")
        # ¿El remitente esta en la lista publicada? Es la pregunta que de verdad se hace uno.
        lista = {c.lower() for c in CULPABLES}
        for qid, nom in remitentes.items():
            if nom.lower() in lista:
                print(f"\n   ✔ «{nom}» ES uno de los cuatro que nombra el aviso.")
            elif nom.startswith("id "):
                print(f"\n   ❔ No se pudo resolver el {nom}: comprobalo a mano en zKillboard")
                print(f"      https://zkillboard.com/character/{qid}/")
            else:
                print(f"\n   ⚠️ «{nom}» NO esta en la lista de cuatro del aviso, y aun asi te mando")
                print("      una donacion de 0 ISK dentro de la ventana. Puede ser casualidad, o")
                print("      puede que la lista publicada no estuviera completa. Merece decirselo")
                print("      a CCP con la fecha exacta de arriba.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
