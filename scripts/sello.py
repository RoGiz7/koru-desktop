"""¿Quién escribió esta base de datos de Koru, y con qué formato?

Lee el sello que Koru deja en la tabla `meta` (ver `db/mod.rs`):

  · escrito_por — la versión de Koru que la abrió por ULTIMA vez. Un hecho.
  · esquema     — nivel de compatibilidad. Se sube A MANO, y solo cuando se rompe la lectura
                  hacia atras a sabiendas. Nunca baja.

Sirve para dos cosas:

  1. Comprobar que el sello se esta poniendo (tras estrenar la version que lo trae).
  2. **SOPORTE**: apuntarlo a una COPIA DE SEGURIDAD y saber con que version se hizo — una
     pregunta que hasta ahora no tenia respuesta, porque el .sqlite3 no decia nada de si mismo.
     El `VACUUM INTO` de las copias se lleva la tabla `meta` dentro, asi que el sello viaja.

SOLO LEE, y abre en modo lectura por si Koru esta arrancado.

    python scripts\\sello.py                       # tu base de datos
    python scripts\\sello.py "D:\\copias\\koru.sqlite3"
"""

import os
import sqlite3
import sys

# Debe coincidir con `ESQUEMA` en src-tauri/src/db/mod.rs.
ESQUEMA_DE_ESTE_SCRIPT = 1


def ruta_por_defecto() -> str:
    return os.path.join(
        os.environ.get("APPDATA", ""), "com.rekium.korudesktop", "koru-desktop.sqlite3"
    )


def main() -> int:
    ruta = sys.argv[1] if len(sys.argv) > 1 else ruta_por_defecto()
    if not os.path.exists(ruta):
        print(f"No encuentro la base de datos en:\n  {ruta}")
        print('\nPasa la ruta como argumento, o localizala con:')
        print('  Get-ChildItem "$env:APPDATA" -Filter "*korudesktop*"')
        return 1

    db = sqlite3.connect(f"file:{ruta}?mode=ro", uri=True)
    print(f"BD: {ruta}")
    print(f"    {os.path.getsize(ruta) / 1024 / 1024:.1f} MB\n")

    filas = dict(
        db.execute(
            "SELECT key, value FROM meta WHERE key IN ('escrito_por','esquema')"
        ).fetchall()
    )
    quien = filas.get("escrito_por")
    esquema = filas.get("esquema")

    if not quien and not esquema:
        print("  Sin sello.")
        print("  Es lo NORMAL en una base de datos anterior a la version que lo introdujo:")
        print("  se le pone en el primer arranque con esa version. No es un error.")
        db.close()
        return 0

    print(f"  escrito_por : {quien or '—'}")
    print(f"  esquema     : {esquema or '—'}   (este script entiende hasta el {ESQUEMA_DE_ESTE_SCRIPT})")

    if esquema and int(esquema) > ESQUEMA_DE_ESTE_SCRIPT:
        print("\n  ⚠️ Esta base de datos declara un formato MAS NUEVO del que este script conoce.")
        print("     Una version de Koru anterior la abriria igualmente (avisando), pero")
        print("     RESTAURARLA como copia se detiene y pregunta antes de sobrescribir nada.")
    else:
        print("\n  ✅ Formato compatible.")

    db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
