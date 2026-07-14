# Koru Desktop — Comunidad, estado del proyecto y visión

**Fecha:** 2026-06-23 · Autor: notas de investigación para RoGi7 / Rekium

> Objetivo del documento: mirar qué herramientas de terceros gustan y funcionan en EVE, situar
> dónde está Koru Desktop, y evaluar dos ideas potentes: **el mapa de New Eden como visualizador**
> de nuestros datos, y **cruzar kills masivos con eventos/noticias**. Todo respetando licencias
> (no copiamos código ni datos cuyo uso no esté permitido; tomamos ideas y usamos fuentes oficiales).

---

## 1. Panorama: qué usa y quiere la comunidad

Las herramientas de terceros de EVE se agrupan en familias bastante claras. Para cada una, lo que
la gente valora:

**Killboards / análisis PvP — zKillboard.** El estándar de facto. Lo que engancha: detalle por kill
(fit, carga, valor ISK, atacantes y su daño), tiempo casi real, y poder seguir a un personaje, corp
o alianza. Es la "fuente de verdad" social del PvP. *(Ya lo usamos como fuente.)*

**Battle reports — br.evetools.org.** Agrega muchos killmails de una batalla en un informe único:
bandos, ISK destruida por lado, naves implicadas, línea temporal. La gracia es convertir el caos de
una pelea en una historia legible y compartible.

**Mapas / intel — DOTLAN, Tripwire, Pathfinder, Wanderer, Nexum.** Aquí está la magia visual.
- **DOTLAN** muestra New Eden de otra forma (rutas, cuán transitado está un sistema, kills recientes).
- **Tripwire / Pathfinder / Wanderer / Nexum** son mapeadores de wormholes: dibujan tu cadena en
  tiempo real, gestionan firmas, y —clave— **comparten intel en vivo** con corp/alianza (ves dónde
  está cada piloto, kills y saltos sobre el mapa).
- Lo que la gente ama: **mapa bonito + datos en vivo encima + colaboración**. Es el patrón más
  pegajoso del ecosistema.

**Fittings / simulación — Pyfa, EVE Workbench.** Probar fits aplicando skills, guardar y compartir.
No es nuestro terreno, pero confirma que la gente valora "experimentar con mis datos".

**Datos / mercado / SDE — Fuzzwork, Adam4EVE, EVE Ref.** Bases de datos, precios, analítica de
mercado/industria. Útiles como fuentes; menos como producto "bonito".

**Gestión multi-cuenta / utilidades — EVE-O Preview, jEveAssets, EVEMon.** Lo relevante para
nosotros: **EVEMon** (skills/plan), **jEveAssets** (assets a lo grande). Confirman demanda de las
áreas que ya cubrimos (skills, assets), pero suelen ser feos/anticuados.

### Patrones que hacen que una tool "guste y funcione"
1. **Visualización espacial.** El mapa como lienzo es lo que más diferencia y enamora.
2. **Datos en vivo encima del mapa/UI** (posición, kills, actividad), no tablas sueltas.
3. **Profundidad por click** (de un número, ir al detalle: kill → fit → atacantes).
4. **Compartir / colaboración** (corp/alianza). Gran multiplicador… pero implica servidor.
5. **Estética y rendimiento.** Muchas tools son potentes pero feas; hay hueco para algo pulido.
6. **Open-source / self-host** genera confianza (Tripwire, Pathfinder, Nexum, Wanderer lo son).

---

## 2. Dónde está Koru Desktop hoy

**Lo que ya tenemos y compite bien:**
- **Enfoque stats-first** sobre PvP (histórico completo, eficacia, kills caros, daño/final
  blow/top damage, regiones), Wallet, Skills, Assets, Industria/Minería.
- **Multi-personaje + vista global** con deduplicado correcto — esto es **diferencial**: casi
  ninguna tool te da "la suma de todos tus personajes" como una sola huella de jugabilidad.
- **App de escritorio nativa, local y sin servidor** (Tauri/Rust): tus datos en tu máquina, sin
  depender de infra de terceros. Privacidad real.
- **Infra sólida**: caché ETag, backoff anti-ban, keychain, resolución de nombres. Base seria.
- **UI propia y limpia** (tarjetas con foto/corp, pestañas), ya por encima estéticamente de
  EVEMon/jEveAssets.

**Lo que nos falta para "salirnos de lo que existe":**
- **Visualización espacial.** Hoy somos tablas y KPIs. El mapa es el salto que nos haría únicos.
- **Profundidad narrativa del PvP** (batallas, rivales) — empezado en backlog (némesis).
- **Contexto/eventos** alrededor de los datos (qué pasó, cuándo, dónde).
- Colaboración corp/alianza (deliberadamente fuera de alcance: rompería el "sin servidor"; sigue
  siendo terreno de AA/koru_auditor).

**Veredicto:** tenemos una base de datos personales muy buena y un ángulo claro (stats + privacidad
+ multi-personaje). Lo que nos elevaría de "otra tool de stats" a "algo que merece la pena y es
bonito" es **el mapa como visualizador** y **el contexto de eventos**. Ambas encajan con tu visión.

---

## 3. El mapa de New Eden como visualizador (viable y con licencia limpia)

**Es totalmente factible y, además, lo recomienda la propia documentación de CCP.** La guía oficial
de *Map Data* explica el sistema de coordenadas y **trae un ejemplo de código para renderizar el
mapa de New Eden** a partir del SDE (coordenadas de cada sistema). Es decir: **dibujamos nuestro
propio mapa** desde datos oficiales (SDE, bajo el Developer License Agreement), sin depender de
DOTLAN ni copiar sus imágenes/tiles. Limpio de licencia.

**Qué podríamos pintar encima (nuestra vuelta de tuerca stats-first):**
- **Dónde están tus personajes** (con el scope de localización que ya soportamos) — un punto por
  alt en su sistema, con su foto.
- **Mapa de calor de tu PvP**: sistemas coloreados por nº de kills/losses o ISK destruida. "Tu
  territorio real" según dónde peleas, no dónde dices que vives.
- **Assets por sistema**: dónde tienes cosas y cuánto (volumen/valor), para no olvidar hangares.
- **Minería**: en qué sistemas/regiones has minado más.
- **Filtros por personaje o vista global** (reutiliza lo que ya hicimos).

**Cómo encaja técnicamente (sin coste de API):**
- Descargar el SDE una vez (mapSolarSystems, mapConstellations, mapRegions) → cachear local
  (reutilizable con lo de `eve_sde` que ya conocéis).
- Render 2D con las `position2D` ("schematic") del SDE → SVG/Canvas en el frontend. Para el detalle
  espacial, las coordenadas 3D están disponibles si algún día queremos algo más ambicioso.
- Cruzar con nuestras tablas locales (killmails.system_id, assets, mining) → overlays.

**Esfuerzo:** medio. El render base del mapa 2D + un overlay (p. ej. heat de kills) es una primera
entrega realista y muy vistosa. Es, con diferencia, **lo que más nos diferenciaría**.

---

## 4. Cruzar kills masivos con eventos / noticias

La idea es buena pero conviene separarla por niveles de viabilidad, de lo seguro a lo ambicioso:

**Nivel 1 — Detección de "batallas" desde nuestros propios datos (fácil, ya tenemos el dato).**
Agrupar killmails por **sistema + ventana temporal**; si hay muchos en poco tiempo, es una batalla.
Marcar esos eventos en la línea temporal y en el mapa ("aquí estuviste en una pelea de 120 kills").

**Nivel 2 — Enlazar al contexto que ya existe (fácil-medio, sin inventar nada).**
Para cada batalla detectada, generar enlaces a:
- **br.evetools.org** (battle report de ese sistema/fecha) — el informe agregado de la pelea.
- **zKillboard** (related kills) — el contexto social.
Esto da el "qué pasó" sin que tengamos que recalcularlo.

**Nivel 3 — Eventos del juego vía ESI (medio).**
ESI expone cosas como **sovereignty** (campañas/timers), **incursiones**, **factional warfare**.
Se pueden cruzar con tus kills para añadir contexto ("este cluster coincide con un timer de sov").

**Nivel 4 — Noticias / vídeos automáticos (difícil / curado).**
Aquí hay que ser honesto: **no existe una API que mapee una batalla concreta a un vídeo de YouTube
o a un artículo**. Lo viable:
- **Noticias oficiales de CCP** vía RSS y feeds de comunidad (INN, EVE News24) — se pueden mostrar
  como "feed de actualidad", pero **casarlas automáticamente con TU batalla** es poco fiable.
- Para batallas **históricas famosas** (B-R5RB, M2-XFE, etc.) sí cabe un mapeo **curado** manual
  (una pequeña base nuestra de "hitos") que enriquezca si coincides geográfica/temporalmente.
- Auto-matching general de vídeos/artículos: lo dejaría como exploración futura, no como promesa.

**Recomendación:** hacer Niveles 1–2 (detección de batallas + enlaces a br/zKill) que son sólidos y
aportan muchísimo, asomarse al 3 (eventos ESI), y tratar el 4 como "feed de noticias" + curado de
hitos, sin prometer magia.

---

## 5. Propuesta de identidad y roadmap

**La frase que nos define:** *"Tu vida en New Eden, vista a través de tus datos y dibujada sobre el
mapa — local, privada y para todos tus personajes a la vez."* Stats-first, espacial, y honesta.

**Roadmap sugerido (encima de lo ya hecho):**
1. **SDE local + mapa 2D base de New Eden** (render propio desde datos oficiales).
2. **Overlay 1: heat de PvP** (kills/losses/ISK por sistema) — el "wow" inicial.
3. **Overlay 2: posición de personajes** (scope localización) y **assets por sistema**.
4. **Detección de batallas** (clustering de killmails) + **enlaces a br.evetools/zKill**.
5. **Pestaña Rivales/Némesis** (ya en backlog) — complementa la narrativa del PvP.
6. **Feed de noticias** (RSS CCP/comunidad) + curado de hitos históricos.
7. Pulido: filtros/paginación, alianza en tarjetas, empaquetado .exe y reparto por Rekium.

**Lo que NO deberíamos hacer (para no diluir la identidad):**
- Convertirnos en otro mapeador de wormholes colaborativo (ya hay buenos y exige servidor).
- Replicar Pyfa/fittings.
- Datos de corp/alianza compartidos (eso es AA/koru_auditor; rompe el "sin servidor/privado").

---

## 6. Grafismo disponible (SDE + servicios oficiales) para mejorar el aspecto

El SDE no trae imágenes, pero sí **datos que convertimos en visuales**, y CCP ofrece servicios de
imagen oficiales. Lo aprovechable:

**Datos del SDE para colorear/dibujar el mapa:**
- **`securityStatus`** por sistema → el clásico degradado **verde → amarillo → rojo** (lo más
  reconocible de EVE). Coloreado de puntos por seguridad.
- **Color de estrella (clase espectral)** → pintar cada estrella con su color real (azules, rojas,
  amarillas…). Da un mapa precioso y "de verdad".
- **`mapSolarSystemJumps`** (saltos entre sistemas) → **dibujar las líneas de stargates**, la
  telaraña reconocible del mapa de New Eden. Clave para que parezca el mapa real.
- **Regiones / constelaciones / soberanía / facción** → esquemas de color alternativos
  (por región, por facción), igual que el mapa del juego.
- **`position` / `position2D`** → posiciones reales para el layout.

**Servicios de imagen oficiales (`images.evetech.net`, ya en uso):**
- **types**: `icon` (objetos), `render` (naves/estructuras en el espacio), `bp`/`bpc` (blueprints).
- **corporations / alliances**: `logo` — y, dato útil, **los logos de facción NPC** se sacan con el
  *faction ID* en la categoría `corporations`. Sirve para etiquetar soberanía/facción en el mapa.
- **characters**: `portrait` (ya en las tarjetas). Tamaños 32–1024.

**Idea estética:** mapa con líneas de stargate tenues, estrellas coloreadas por seguridad (o por
color real de estrella como modo alternativo), y NUESTROS overlays encima (heat de PvP, posiciones,
assets). Eso ya se ve mejor que la mayoría de tools.

## 7. Opciones del mapa del juego y cómo aprovecharlas

El Star Map del juego permite colorear/filtrar por muchas dimensiones. No necesitamos replicarlas
todas; la idea es marcar la **misma línea** para que dé inmersión EVE. Mapeo de cada opción a
nuestra fuente de datos y su viabilidad:

### Coloreado de estrellas ("Stars")
| Opción del juego | Fuente para nosotros | Viabilidad |
|---|---|---|
| Color real de la estrella (clase espectral) | SDE (star_id → spectral class) | Media (necesita SDE) |
| Estado de seguridad | SDE / ESI `security_status` | **Fácil (ya lo usamos)** |
| Dónde tienes assets | **Nuestros datos** (assets por sistema) | **Fácil** ← diferencial |
| Saltos última hora | ESI `GET /universe/system_jumps/` (¡todos los sistemas en 1 llamada!) | **Fácil** |
| Naves destruidas última hora | ESI `GET /universe/system_kills/` (ship_kills, 1 llamada) | **Fácil** |
| Pods destruidos última hora | ESI `/universe/system_kills/` (pod_kills) | **Fácil** |
| Kills de NPC última hora | ESI `/universe/system_kills/` (npc_kills) | **Fácil** |
| Pilotos en espacio (30 min) | **No expuesto en ESI** | No (omitir) |

> Joya: `/universe/system_kills/` y `/universe/system_jumps/` devuelven **todos los sistemas en una
> sola petición pública**. Con eso pintamos overlays "en vivo" (dónde se está peleando/moviendo
> ahora mismo en New Eden) baratísimo y muy vistoso.

### Líneas (stargates)
| Opción | Fuente | Viabilidad |
|---|---|---|
| Dibujar las conexiones | SDE `mapSolarSystemJumps` | Media (SDE) — **clave para la silueta de New Eden** |
| Por tipo de salto (intra-constelación / intra-región / inter-región) | SDE jumps + region/const ids | Media |
| Por región (colores por región) | SDE | Media |

### Tiles / soberanía
| Opción | Fuente | Viabilidad |
|---|---|---|
| Colorear por soberanía / facción | ESI `GET /sovereignty/map/` + facción | Media |
| Contornos de región | SDE (polígonos por región) | Media-alta |

### Etiquetas
Región / constelación / sistema / landmarks → SDE. Mostrar pocas (como el juego) para no saturar.

### Nuestros overlays propios (el diferencial stats-first)
- **Heat de tu PvP** (hecho). 
- **Tus assets por sistema** (fácil, ya tenemos el dato).
- **Posición de tus personajes** (scope ubicación, ya soportado).
- **Tu minería por sistema**.
- Cruce con **batallas detectadas** (clustering de killmails) marcadas en el mapa.

### Dirección de estilo (según el mapa actual del juego)
- Fondo negro/azul muy oscuro; mucho espacio negativo.
- **Líneas de stargate finas y tenues** (gris ~20-30% opacidad).
- Nodos pequeños; el dato se transmite por **color** (seguridad) y por número de seguridad junto al
  nombre (verde→rojo por décimas).
- Etiquetas de región en gris claro, espaciado amplio, mayúsculas.
- Overlays del usuario en un color de acento (verde/cian, como la ruta/flota del juego) para que
  destaquen sobre el mapa base.
- Glow sutil en los puntos activos.

### Plan de implementación recomendado (orden)
1. **Overlays "en vivo" baratos** sobre el mapa actual: selector para colorear/dimensionar por
   `system_kills` / `system_jumps` (1 llamada ESI). Da inmersión inmediata sin SDE.
2. **Backdrop del cluster con líneas de stargate** (requiere empaquetar SDE) → la silueta real.
3. **Selector de overlay** estilo juego: Seguridad / Tu PvP / Tus assets / Kills última hora /
   Jumps última hora / Soberanía.
4. **Posición de personajes** y **batallas** sobre el mapa.

## 8. Arquitectura objetivo: app mapa-céntrica (decisión)

Decisión de producto (RoGi7, jun 2026): **el mapa de New Eden es el centro de la app y todo orbita
a su alrededor.** Es la seña de identidad — nadie hace stats personales sobre el mapa.

- **Lienzo principal = mapa** a (casi) pantalla completa, como el F10 del juego.
- **Rail lateral**: personajes (tarjetas compactas), toggle Personaje/Global y **selector de
  overlay** (qué pinta el mapa).
- **Overlays del mapa** (lentes de datos): Tu PvP · Seguridad · Kills última hora · Jumps última
  hora · (futuro) Tus assets · Soberanía. Los "en vivo" usan `/universe/system_kills` y
  `/universe/system_jumps` (1 llamada pública cada uno, todos los sistemas).
- **Click en sistema** → panel contextual con TU info ahí (kills/losses/assets/batallas + zKill).
- **No-espacial** (Wallet, Skills, SP): viven en un **dock/cajón** resumido, sin competir con el
  mapa; el detalle completo sigue en sus vistas.
- Reutiliza TODO lo construido (comandos, datos, vistas); solo cambia el *shell*/navegación.
- Migración **incremental**: primero mapa grande + rail + overlays; luego click-en-sistema y dock.

## Notas de licencia / buenas prácticas
- **SDE y ESI**: datos oficiales de CCP bajo el *Developer License Agreement*; podemos usarlos para
  render propio. Citar a CCP donde toque.
- **No** reutilizar imágenes/tiles ni datos derivados de DOTLAN u otras tools; **renderizamos lo
  nuestro** desde el SDE.
- **zKillboard / br.evetools**: enlazar (mandar al usuario a su web) es lo correcto; su API se usa
  con User-Agent identificativo y respetando rate limits (ya lo hacemos).
- **Imágenes** (retratos, logos, render de naves): servicio oficial `images.evetech.net` (ya en uso).

---

## Fuentes
- [Map Data — EVE Developer Documentation (incluye ejemplo de render del mapa)](https://developers.eveonline.com/docs/guides/map-data/)
- [Static Data Export — EVE Developer Documentation](https://developers.eveonline.com/docs/services/static-data/)
- [The 10 best third-party tools for EVE Online — Just EVE Online](https://justabout.com/eve-online/32805/the-10-best-third-party-tools-for-eve-online)
- [Third-party tools — EVE University Wiki](https://wiki.eveuniversity.org/Third-party_tools)
- [awesome-eve (lista de apps/tools)](https://github.com/devfleet/awesome-eve)
- [Battle Report Tool — br.evetools.org](https://br.evetools.org/)
- [zKillboard](https://zkillboard.com/)
- [DOTLAN :: EveMaps](https://evemaps.dotlan.net/)
- [Tripwire](https://tripwiremap.app/) · [Pathfinder](https://pathfinder.eve-linknet.com/) · [Nexum](https://nexum.schubitza.at/)
- [Understanding the EVE Online SDE — Fuzzwork](https://www.fuzzwork.co.uk/2021/07/17/understanding-the-eve-online-sde-1/)
- [Star Map (opciones de estadística/color) — EVE University Wiki](https://wiki.eveuniversity.org/Star_Map)
