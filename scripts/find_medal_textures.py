# Spike: localizar las texturas de las MEDALLAS de corp en la caché del cliente de EVE.
#
# Contexto: ESI (/characters/{id}/medals/) devuelve cada condecoración como capas
# {part, layer, graphic: "caldari.1_1", color}, pero las medallas NO tienen typeID, así que el
# image server no las sirve, y el Image Export Collection tampoco las trae. Las texturas de las
# piezas (cintas y medallones) viven en la caché del propio juego: SharedCache/tq/resfileindex.txt
# mapea rutas res:/ a ficheros dentro de SharedCache/ResFiles/.
#
# Uso:  python find_medal_textures.py "C:\EVE\SharedCache" [carpeta_salida]
#   - Sin carpeta_salida: solo lista lo que encuentra (rutas res:/ con "medal" o "ribbon").
#   - Con carpeta_salida: además COPIA los ficheros renombrados a su ruta res:/ legible.
#
# Si no sabes dónde está tu SharedCache: el launcher lo muestra en Configuración; rutas típicas
# son C:\EVE\SharedCache o la carpeta elegida al instalar (contiene "tq" y "ResFiles").
#
# Con la salida de esto se decide el mapeo graphic→fichero ("caldari.1_1" → ¿qué png?) y se copian
# a public/medals/ SOLO las piezas necesarias. El tintado (campo color) y el apilado van en el front.
import sys
import shutil
from pathlib import Path

PATTERNS = ("medal", "ribbon", "decoration")


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__ or "Uso: python find_medal_textures.py <SharedCache> [salida]")
        return 1
    shared = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    indexes = list(shared.glob("*/resfileindex.txt"))
    if not indexes:
        print(f"No hay resfileindex.txt bajo {shared} — ¿es esa la carpeta SharedCache (contiene 'tq')?")
        return 1
    total = 0
    for idx in indexes:
        print(f"== {idx} ==")
        for line in idx.read_text(encoding="utf-8", errors="replace").splitlines():
            # Formato: res:/ruta,hashdir/hashfile,md5,size,compressed
            parts = line.split(",")
            if len(parts) < 2:
                continue
            res, blob = parts[0], parts[1]
            low = res.lower()
            if not any(p in low for p in PATTERNS):
                continue
            total += 1
            print(f"  {res}  ->  {blob}")
            if out:
                src = shared / "ResFiles" / blob
                if src.is_file():
                    dst = out / res.replace("res:/", "").replace("/", "_")
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src, dst)
    print(f"\n{total} ficheros con {PATTERNS} en la ruta.")
    if out and total:
        print(f"Copiados a {out} (renombrados a su ruta res:/ legible).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
