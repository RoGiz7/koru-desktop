#!/usr/bin/env python3
"""Genera el banner de Koru en cada idioma.

Nace porque `branding/banner.png` no tenia fuente: cualquier cambio de texto obligaba a
repintar pixeles. Aqui el texto vive en IDIOMAS y el resto se dibuja solo, asi que sacar
un idioma nuevo son tres lineas.

    python3 scripts/make_banner.py

Salida:
    branding/banner.svg     + banner.png        (espanol, el que usa README.es.md)
    branding/banner-en.svg  + banner-en.png     (ingles,  el que usa README.md)

Requiere cairosvg:  pip install cairosvg
"""

import random
from pathlib import Path

import cairosvg

W, H = 1200, 400
RAIZ = Path(__file__).resolve().parent.parent
BRANDING = RAIZ / "branding"

# Paleta, sacada del propio koru-icon.svg para que el conjunto no desafine.
AZUL = "#7fd8ff"
BLANCO = "#f2f8ff"
TENUE = "#8ea9c4"
FONDO_1 = "#0d1b2c"
FONDO_2 = "#05080e"

IDIOMAS = {
    "es": {
        "fichero": "banner",
        "lema": "Tu copiloto para EVE Online",
        "tagline": "Estadísticas · Mapa de New Eden · Intel en vivo",
        "pastillas": ["GRATIS", "OPEN SOURCE · MIT"],
    },
    "en": {
        "fichero": "banner-en",
        "lema": "Your copilot for EVE Online",
        "tagline": "Stats · New Eden map · Live intel",
        "pastillas": ["FREE", "OPEN SOURCE · MIT"],
    },
}


def estrellas(semilla=7):
    """Campo de estrellas. Semilla FIJA a proposito: los dos idiomas tienen que salir
    con el mismo fondo, o puestos uno al lado del otro cantan como dos imagenes distintas."""
    r = random.Random(semilla)
    fuera = []
    for _ in range(260):
        x, y = r.uniform(0, W), r.uniform(0, H)
        # el texto vive a la izquierda-centro: alli las estrellas se apagan para no estorbar
        estorba = 340 < x < 1000 and 90 < y < 330
        op = r.uniform(0.05, 0.22) if estorba else r.uniform(0.10, 0.85)
        fuera.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r.uniform(0.4, 1.5):.2f}" '
                     f'fill="#dff2ff" opacity="{op:.2f}"/>')
    return "\n".join(fuera)


def constelacion():
    """El guino del mapa: unos cuantos nodos unidos, arriba a la derecha."""
    pts = [(1005, 168), (1082, 96), (1148, 140), (1120, 232), (1032, 250)]
    d = " ".join(("M" if i == 0 else "L") + f" {x} {y}" for i, (x, y) in enumerate(pts))
    fuera = [f'<path d="{d}" fill="none" stroke="{AZUL}" stroke-width="1.4" '
             f'stroke-linecap="round" opacity="0.30"/>']
    for i, (x, y) in enumerate(pts):
        r = 5.5 - i * 0.6
        fuera.append(f'<circle cx="{x}" cy="{y}" r="{r + 3:.1f}" fill="{AZUL}" opacity="0.13"/>')
        fuera.append(f'<circle cx="{x}" cy="{y}" r="{r:.1f}" fill="url(#nodo)"/>')
    return "\n".join(fuera)


def pastilla(x, y, texto, ancho_car=11.6, alto=34):
    """Pastilla clara con texto OSCURO. En el banner viejo el texto iba claro sobre fondo
    claro y apenas se leia; esto es el unico sitio donde me aparto del original a proposito."""
    ancho = len(texto) * ancho_car + 34
    return (
        f'<rect x="{x}" y="{y}" width="{ancho:.0f}" height="{alto}" rx="{alto/2}" '
        f'fill="{AZUL}" opacity="0.92"/>'
        f'<text x="{x + ancho/2:.0f}" y="{y + alto/2 + 6:.0f}" text-anchor="middle" '
        f'font-family="DejaVu Sans" font-size="17" font-weight="bold" '
        f'letter-spacing="1.1" fill="#062033">{texto}</text>'
    ), ancho


def icono():
    """El icono del propio koru-icon.svg, encogido y colocado a la izquierda."""
    svg = (BRANDING / "koru-icon.svg").read_text(encoding="utf-8")
    dentro = svg.split(">", 1)[1].rsplit("</svg>", 1)[0]
    dentro = dentro.replace('id="bg"', 'id="ibg"').replace('url(#bg)', 'url(#ibg)')
    dentro = dentro.replace('id="node"', 'id="inode"').replace('url(#node)', 'url(#inode)')
    dentro = dentro.replace('id="core"', 'id="icore"').replace('url(#core)', 'url(#icore)')
    lado = 216
    return (f'<g transform="translate(72,{(H - lado) / 2:.0f}) scale({lado / 1024:.5f})">'
            f'{dentro}</g>')


def construir(lang):
    cfg = IDIOMAS[lang]
    x = 358  # donde arranca todo el bloque de texto

    p1, w1 = pastilla(x, 282, cfg["pastillas"][0])
    p2, _ = pastilla(x + w1 + 14, 282, cfg["pastillas"][1])

    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
<defs>
  <linearGradient id="fondo" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="{FONDO_1}"/>
    <stop offset="55%" stop-color="#070d18"/>
    <stop offset="100%" stop-color="{FONDO_2}"/>
  </linearGradient>
  <radialGradient id="nebulosa" cx="20%" cy="35%" r="60%">
    <stop offset="0%" stop-color="#1b4f77" stop-opacity="0.45"/>
    <stop offset="100%" stop-color="#05080e" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="nodo" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#eaffff"/>
    <stop offset="35%" stop-color="{AZUL}"/>
    <stop offset="100%" stop-color="#2a6ea0"/>
  </radialGradient>
</defs>

<rect width="{W}" height="{H}" fill="url(#fondo)"/>
<rect width="{W}" height="{H}" fill="url(#nebulosa)"/>
{estrellas()}
{constelacion()}
{icono()}

<text x="{x}" y="162" font-family="DejaVu Sans" font-size="63" font-weight="bold" letter-spacing="1">
  <tspan fill="{AZUL}">KORU</tspan><tspan fill="{BLANCO}"> DESKTOP</tspan>
</text>
<text x="{x}" y="219" font-family="DejaVu Sans" font-size="30" fill="{BLANCO}" opacity="0.93">{cfg["lema"]}</text>
<text x="{x}" y="256" font-family="DejaVu Sans" font-size="21" fill="{TENUE}">{cfg["tagline"]}</text>
{p1}
{p2}

<rect x="0.5" y="0.5" width="{W - 1}" height="{H - 1}" fill="none" stroke="{AZUL}" stroke-width="1" opacity="0.35"/>
</svg>
'''


def main():
    for lang, cfg in IDIOMAS.items():
        svg = construir(lang)
        destino_svg = BRANDING / f"{cfg['fichero']}.svg"
        destino_png = BRANDING / f"{cfg['fichero']}.png"
        destino_svg.write_text(svg, encoding="utf-8")
        cairosvg.svg2png(bytestring=svg.encode("utf-8"),
                         write_to=str(destino_png), output_width=W, output_height=H)
        print(f"  {lang}: {destino_svg.name} + {destino_png.name}")


if __name__ == "__main__":
    main()
