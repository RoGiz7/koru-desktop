# Koru Desktop — Revisión de aspecto + ideas de inmersión

**Fecha:** 2026-07-02 · Complementa `REVISION_2026-07-02.md` (eje "aspecto").
Restricciones respetadas en todas las ideas: EULA/copyright de FC (Fenris Creations, antes CCP),
sin terceros nuevos, local-first, rendimiento (nada que recargue el mapa).

---

## 1. Estado actual del aspecto

### Lo que ya funciona bien

- **Sistema de design tokens** completo (fondos, acentos, bordes, radios, espaciado, sombras) —
  la base correcta para todo lo demás.
- **6 temas** persistidos (Nebulosa/Amarr/Caldari/Gallente/Minmatar/Abismo).
- **Fondo de nebulosa** fijo con tinte por tema + **paneles translúcidos** con `backdrop-filter` —
  el efecto "cristal sobre el espacio" es la seña de identidad actual.
- **Iconos oficiales** vía images.evetech.net (retratos, naves, items, corps) — canal correcto.
- **Charts SVG propios** coherentes entre vistas (donuts con hover, barras con tooltip, scrub).
- **Statusbar** con actividad + hora EVE (UTC) + estado de Tranquility.
- KPI cards con color semántico, tablas ordenables, LOD de etiquetas en el mapa.

### Dónde flojea (diagnóstico franco)

| # | Debilidad | Detalle |
|---|-----------|---------|
| A1 | **Tipografía genérica** | Inter para TODO (títulos, KPIs, cuerpo). Es la misma fuente de mil dashboards web; no dice "EVE" en ningún sitio. Solo hay mono en 3 sitios puntuales. |
| A2 | **Temas poco diferenciados** | Cada tema solo cambia acento + tinte (~4 variables). Amarr y Caldari se sienten "el mismo dashboard con otro borde". |
| A3 | **App muy estática** | Solo 6 `@keyframes` (spinner, pulsos de intel). No hay transiciones entre vistas ni micro-feedback. El intel-pulse demuestra que el lenguaje de animación funciona — pero está solo. |
| A4 | **Nebulosa única y estática** | El mismo `space-bg.png` para los 6 temas y sin profundidad al panear el mapa. |
| A5 | **Identidad Koru tímida** | El `brand h1` es texto plano; el icono propio (cúmulo cian) casi no aparece dentro de la app. |
| A6 | ⚠️ **Procedencia de `space-bg.png`** | Verificar origen/licencia. Si es un wallpaper de CCP: su política de fan media lo permite en proyectos no comerciales **con atribución** → añadirla al README. Alternativa 100% limpia y más ligera: starfield procedural propio (ver idea N2-c). |

---

## 2. Ideas de inmersión, priorizadas por coste

### Nivel 1 — baratas (CSS + datos que ya tenemos en local)

**N1-a · Tipografía "sci-fi" para display.** La mejora de identidad más rentable. Empaquetar EN
LOCAL (nada de Google Fonts: CSP, offline, privacidad) una fuente libre SIL-OFL para títulos, KPIs
y cifras — candidatas: **Rajdhani** (la más "EVE" sin copiar), Oxanium, Michroma. Inter se queda
para cuerpo/tablas. Además: `font-variant-numeric: tabular-nums` en KPIs e ISK (las cifras dejan
de "bailar" al refrescar). NO usar la fuente del cliente EVE (propiedad de CCP).

**N1-b · Tu nave actual junto al retrato.** `ship_type_id` ya llega con el scope LOCATION y el
render existe en images.evetech.net. Ver tu Ishtar/Loki al lado de tu cara en la topbar es
inmersión directa con ~0 coste. Bonus: tooltip con el nombre de la nave.

**N1-c · Cuenta atrás de downtime.** Junto a la hora EVE del footer: "DT en 2h 14m" (11:00 UTC
fijo). Todo jugador vive pendiente de eso; es un detalle que "sabe" a EVE. Trivial.

**N1-d · Tema ambiental "donde estás" (opcional, séptimo tema).** Un modo que tiñe la app según
la seguridad del sistema donde está tu personaje activo (dato ya en local): azul highsec, ámbar
lowsec, rojo profundo nullsec, púrpura wormhole/Pochven. Al hacer jump y sincronizar, la app
"viaja contigo". Solo toca `--accent`/`--bg-tint` → cero coste de render.

**N1-e · Micro-transiciones.** Fade corto (~120 ms) al cambiar de vista, transición suave del
color de acento al cambiar tema, hover con elevación en KPI cards. Todo CSS puro +
`prefers-reduced-motion: reduce` para quien no lo quiera. Convierte A3 sin tocar rendimiento.

### Nivel 2 — medianas (una sesión o dos cada una)

**N2-a · Estrellas con clase espectral real.** El SDE (archivado en `documentacion/sde-source/`)
tiene el tipo de estrella de cada sistema. Regenerar `neweden.json` añadiendo un byte de clase
(O/B/A/F/G/K/M) y colorear el punto del sistema con su tono real (azul-blanco→rojo) cuando no hay
overlay activo. El mapa pasa de "grafo" a "cielo". Perf: es el mismo círculo con otro `fill`;
opcional twinkle CSS SOLO en zoom cercano (sistemas visibles).

**N2-b · Sonido de interfaz propio (opt-in).** `sound.ts` ya sintetiza audio por WebAudio para
intel. Extender con 2-3 sonidos cortos sintetizados: "dock" al cambiar de grupo, "ping" al acabar
un sync, ya existente la alerta intel. SIEMPRE opt-in (toggle en Ajustes, off por defecto) y
NUNCA samplear sonidos del cliente EVE (copyright). Lo sintético además pesa 0 bytes.

**N2-c · Nebulosa por tema + parallax sutil.** O bien un fondo distinto por tema (dorado Amarr,
gris-azul Caldari…), o mejor: **starfield procedural propio** en 2-3 capas (canvas estático
generado al arrancar con seed) que se desplaza levemente con el paneo del mapa
(`transform: translate3d` → GPU, desactivable). Resuelve A4 y A6 de golpe: arte 100% nuestro.

**N2-d · Efemérides personales en Resumen.** "Tal día como hoy hace un año: tu primer kill en
Tama" / "Récord de ISK/día: 2026-03-14". Sale íntegramente de la BD local (killmails, journal,
snapshots). Inmersión narrativa: la app te cuenta TU historia — nadie más puede hacer esto porque
nadie más tiene tu histórico local. Antesala perfecta de la visión Bitácora.

**N2-e · Splash de arranque "undocking".** Pantalla breve con el icono Koru (cúmulo cian) +
barra de carga del SDE + una línea de estado ("Cargando New Eden… 5.485 sistemas"). Hoy ese hueco
de carga existe pero está mudo. Textos propios, no lore de CCP (copyright).

### Nivel 3 — gordas (ligar al roadmap, no empezar por aquí)

**N3-a · Bitácora / "historia jugada"** — ya es la visión acordada (categoría Objetivos/Rumbo).
Es LA feature de inmersión: timeline de tu carrera (kills, patrimonio, sistemas visitados, hitos)
montada sobre el histórico local. N2-d es su aperitivo barato.

**N3-b · Tematización por evento** — ya en roadmap. Con N1-d y N2-c hechas, un "evento" es solo
un paquete de tokens + fondo + POIs destacados en el mapa (p. ej. temporada de guerra de facciones).

**N3-c · Modo "puente de mando".** Vista fullscreen solo-mapa (F11): overlays personales + intel
en vivo + reloj EVE, pensada para segunda pantalla mientras juegas. Read-only, cero interacción
con el cliente → EULA-safe. Reusa todo lo existente; es más "quitar chrome" que construir.

---

## 3. Orden recomendado

1. **N1-a tipografía + N1-e transiciones** — un día, transforma la primera impresión (ataca A1+A3).
2. **N1-b nave actual + N1-c countdown DT** — horas, puro sabor EVE.
3. **N2-c starfield propio** — resuelve la duda de licencia del fondo (A6) y da profundidad.
4. **N1-d tema ambiental** — diferenciador que nadie más tiene.
5. **N2-d efemérides** — puente narrativo hacia la visión Bitácora (N3-a).
6. N2-a estrellas espectrales y N2-b sonido, cuando apetezca un capricho.

## 4. Límites de cumplimiento (recordatorio)

- **Nunca empaquetar** fuentes, sonidos, música o arte extraídos del cliente EVE — todo copyright
  de FC (Fenris Creations). Fuentes = SIL OFL; sonido = sintetizado propio; arte = procedural
  propio o media kit oficial con atribución.
- images.evetech.net sigue siendo el único canal para retratos/renders/iconos (oficial y permitido).
- Nada de overlays que lean/escriban sobre el cliente del juego: la inmersión es DENTRO de Koru.
