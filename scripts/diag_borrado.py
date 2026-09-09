"""Radiografia de lo que Koru guarda de UN personaje — y de lo que quedaria despues de borrarlo.

SOLO LEE. No escribe, no borra, no toca la base de datos. Se puede ejecutar con Koru abierto.

Existe porque el borrado de datos de un personaje es lo unico DESTRUCTIVO de Koru y llevaba dos
releases en manos de la gente sin que nadie lo hubiera ejecutado nunca. Un borrado que no se puede
comprobar no es un borrado, es una promesa.

USO — se ejecuta DOS veces, antes y despues, y se comparan las dos salidas:

    python scripts\\diag_borrado.py                 (lista tus personajes y sus ids)
    python scripts\\diag_borrado.py 90000001        (la radiografia de ese personaje)
    python scripts\\diag_borrado.py 90000001 "C:\\otra\\ruta\\koru-desktop.sqlite3"

QUE MIRA, y es la parte que no es obvia: el borrado pregunta a la base de datos EN MARCHA que
tablas llevan el id del personaje, y lo barre. Pero la misma idea esta escrita con VARIOS nombres:
`character_id` y `subject_id` se barren; `boss_id` (la op grabada) y `listener_id` (tus
conversaciones) NO, a proposito y dicho en pantalla, porque eso es del JUGADOR y no del personaje.
Este script enseña las dos listas por separado para que la diferencia se VEA en vez de suponerse:
si algun dia aparece una tabla nueva en el bloque 2 sin que nadie lo haya decidido, se nota aqui.
"""

import os
import sqlite3
import sys

# Tablas que el borrado SALTA a proposito. Tiene que coincidir con EXCEPCIONES en
# db/mod.rs::character_purge — si las dos listas se separan, este script mentiria.
EXCEPCIONES = {
    "name_cache": "su `character_id` es la persona NOMBRADA, no tu",
    "intel_sightings": "su `character_id` es el piloto AVISTADO: borrar ahi quita TU intel",
    "note": "una nota es del JUGADOR; esta prometido en pantalla",
    "intel_alias": "su `character_id` es el HOSTIL que declaraste, no tu",
}

# Las columnas que el borrado SI barre, en el mismo orden que db/mod.rs::character_purge. Una tabla
# usa una o la otra, nunca las dos.
COLUMNAS = ("character_id", "subject_id")

# Columnas que significan lo mismo pero que el borrado NO barre, a proposito y dicho en pantalla:
# la op grabada, tus conversaciones y tus notas son del JUGADOR, no del personaje.
ALIAS = ("boss_id", "listener_id", "owner_id", "pilot_id")

# Lo que el cartel del borrado promete que NO se lleva. Si alguna de estas apareciera en la lista
# de barridas, el cartel estaria mintiendo.
PROMESA_NO_SE_BORRA = {"fleet_op", "social_session", "social_message", "social_file", "note"}


def ruta_por_defecto() -> str:
    appdata = os.environ.get("APPDATA", "")
    return os.path.join(appdata, "com.rekium.korudesktop", "koru-desktop.sqlite3")


def columnas(con: sqlite3.Connection, tabla: str) -> list:
    return [r[1] for r in con.execute(f"pragma table_info({tabla})")]


def cuenta(con: sqlite3.Connection, tabla: str, col: str, cid: int) -> int:
    try:
        return con.execute(f"SELECT COUNT(*) FROM {tabla} WHERE {col} = ?", (cid,)).fetchone()[0]
    except sqlite3.Error:
        return -1


def main() -> int:
    args = [a for a in sys.argv[1:]]
    cid = None
    ruta = ruta_por_defecto()
    for a in args:
        if a.lstrip("-").isdigit():
            cid = int(a)
        else:
            ruta = a

    if not os.path.exists(ruta):
        print(f"No encuentro la base de datos en:\n  {ruta}\n")
        print("Pasa la ruta como argumento. Para localizarla:")
        print('  Get-ChildItem "$env:APPDATA" -Filter "*korudesktop*"')
        return 1

    # Solo lectura de verdad: si Koru esta abierto, que no le toquemos nada.
    con = sqlite3.connect(f"file:{ruta}?mode=ro", uri=True)

    if cid is None:
        print("Tus personajes en la base de datos:\n")
        try:
            filas = con.execute(
                "SELECT character_id, name FROM characters ORDER BY name"
            ).fetchall()
        except sqlite3.Error as e:
            print("  No pude leer `characters`:", e)
            return 1
        for i, n in filas:
            print(f"  {i:>12}  {n}")
        print("\nVuelve a ejecutarlo con el id del que quieras radiografiar:")
        print("  python scripts\\diag_borrado.py <id>")
        return 0

    tablas = [
        r[0]
        for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
    ]

    nombre = "(ya no esta en la base de datos)"
    try:
        r = con.execute(
            "SELECT name FROM characters WHERE character_id = ?", (cid,)
        ).fetchone()
        if r:
            nombre = r[0]
    except sqlite3.Error:
        pass

    print(f"Base de datos: {ruta}")
    print(f"Personaje:     {cid}  ·  {nombre}")
    print(f"Tablas:        {len(tablas)}\n")

    # --- 1) lo que el borrado SI se lleva -------------------------------------------------
    barre = []
    for t in tablas:
        if t in EXCEPCIONES or t == "characters":
            continue
        cols = columnas(con, t)
        col = next((c for c in COLUMNAS if c in cols), None)
        if col:
            etiqueta = t if col == "character_id" else f"{t} ({col})"
            barre.append((etiqueta, cuenta(con, t, col, cid)))

    con_datos = [(t, n) for t, n in barre if n > 0]
    total = sum(n for _, n in con_datos)
    print(f"🧹 LO QUE EL BORRADO SE LLEVA — {len(barre)} tablas con `character_id`/`subject_id`, "
          f"{len(con_datos)} con datos suyos, {total:,} filas")
    for t, n in sorted(con_datos, key=lambda x: -x[1]):
        aviso = "   🚨 EL CARTEL DICE QUE ESTA NO SE BORRA" if t in PROMESA_NO_SE_BORRA else ""
        print(f"   {n:>10,}  {t}{aviso}")
    if not con_datos:
        print("   (ninguna fila: o ya se borro, o este personaje no tenia nada)")

    # --- 2) lo que se QUEDA aunque hable de el --------------------------------------------
    print("\n🔎 LO QUE SE QUEDA aunque lleve su id, porque la columna se llama de otra forma")
    print("   (el barrido mira `character_id` y `subject_id`; estas usan otra)")
    algo = False
    for t in tablas:
        cols = columnas(con, t)
        for a in ALIAS:
            if a not in cols:
                continue
            n = cuenta(con, t, a, cid)
            if n > 0:
                algo = True
                intencion = "decidido: es TUYO" if t in PROMESA_NO_SE_BORRA else "❓ SIN DECIDIR"
                print(f"   {n:>10,}  {t}.{a}   → {intencion}")
    if not algo:
        print("   (nada)")

    # --- 3) las excepciones, para que se vea que siguen ahi --------------------------------
    print("\n🛡️ TABLAS QUE EL BORRADO SALTA A PROPOSITO (total de la tabla, no se tocan)")
    for t, porque in sorted(EXCEPCIONES.items()):
        if t in tablas:
            n = con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            print(f"   {n:>10,}  {t:<18} {porque}")

    print("\nEjecuta esto MISMO despues del borrado: el bloque 1 debe quedar a cero y el 2 no.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
