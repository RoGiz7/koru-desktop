# Koru Desktop — Research de comunidad: potenciar el MAPA + Intel en vivo

> **Fecha:** 2026-06-26 · Búsqueda web sobre qué herramientas de mapa/intel usa y quiere la comunidad
> de EVE, y cómo aprovechar **la estructura que ya tenemos** (grafo de New Eden + Dijkstra + overlays +
> integración zKill/Dotlan). Decisiones del usuario: **multiboxing descartado**; **intel = leer el log
> de chat del juego** (canales de intel donde los jugadores avisan "sistema · piloto · nave").

---

## 1. Qué usa y quiere la comunidad (mapas/intel)

Herramientas de referencia (todas leen el **log de chat** del juego para intel, NO el cliente):
- **SMT (Eve Map Tool)** — el benchmark. Parsing de intel → **círculo rojo** en el sistema con
  hostiles + **alarma si entra a ≤N saltos**. Modos **Hunting** (ver ratting/kills por New Eden,
  buscar objetivos, mapas de rango, jump bridges) y **Anti-Hunting** (intel + alarmas). Tracking de
  ubicación del personaje. Overlays ESI (ratting/pod/ship kills). Integración zKill/Dotlan.
- **Vintel** — intel visual sobre mapa regional de Dotlan; hostiles desde canales de intel.
- **RIFT Intel Fusion Tool** — parsing de intel + alertas flexibles + mapa avanzado + feeds de killboard.
- **IntelPy / IntelWalker / EveIntelChecker** — monitores de log de intel con alertas por proximidad.
- **Pathfinder** — mapeo de wormholes (J-space) auto-poblado por los saltos del personaje.

**Patrón claro:** lo más valorado de un mapa de EVE es **intel en vivo + proximidad + alarmas**, y
**hunting/anti-hunting** (cruzar actividad ESI con tu posición). Justo lo que nuestra base permite.

## 2. Lo que YA tenemos (ventaja competitiva)

- **Grafo completo de New Eden** (5.485 sistemas + 6.989 stargates) y **Dijkstra** (route planner,
  modos corta/segura/insegura). → tenemos **proximidad por saltos** gratis.
- **Overlays**: kills/jumps 1h, soberanía, FW, incursiones, assets, minería, **standings por sistema**.
- **zKill/Dotlan** por sistema, marcador "estás aquí", tooltip de actividad, zoom/paneo.
- **App completa de stats** (no solo un mapa) → diferenciador: **stats personales + intel map en una**.
  La mayoría de tools de intel son mono-propósito; nosotros unificamos.

## 3. Propuesta estrella: **Capa de Intel en vivo (desde el log de chat)**

Encaja con todo lo anterior y es lo más pedido. **Read-only y permitido por TOS** (no toca el cliente).

**Lectura del log:**
- Carpeta: `…/Documents/EVE/logs/Chatlogs/` (Win: `C:\Users\<user>\Documents\EVE\logs\Chatlogs\`).
- Codificación **UTF-16LE**; cabecera con guiones a saltar.
- Formato de línea: `[ 2026.06.26 12:34:56 ] Autor > mensaje`.
- El usuario configura **qué canal(es) de intel** seguir (nombre del fichero por canal). Hacemos
  *tail* del fichero más reciente de ese canal (los ficheros rotan por sesión).

**Parsing:**
- Detectar **nombres de sistema** en el mensaje cruzando con `neweden.json` (índice por nombre, ya
  existe `nameIdx`). Soportar abreviaturas comunes y `*` (los jugadores escriben "Jita*", "X-7O*").
- Extraer (best-effort) **piloto** y **nave** si aparecen; si no, solo sistema + texto crudo.
- Marcar **"clear"/"clr"** para limpiar un sistema reportado.

**En el mapa (overlay "Intel"):**
- **Círculo rojo pulsante** en cada sistema reportado; **tamaño/opacidad por recencia** (se desvanece
  en X min). Tooltip con piloto/nave/hora.
- **Proximidad**: usando Dijkstra desde tu sistema actual, colorear/anillar por **nº de saltos** y
  mostrar "a N saltos de ti".
- **Alarma configurable**: notificación nativa (plugin notification de Tauri) si un hostil entra a
  ≤ N saltos. (Opción de sonido.)

**Panel lateral "Intel reciente":** lista de avisos (hora · sistema · piloto · nave · saltos) con
**enlace a zKill** del piloto; botón "limpiar".

**Por qué nos sale barato:** el grafo + Dijkstra + overlays + zKill ya están. Lo nuevo es: un lector
de ficheros en Rust (tail UTF-16LE + watcher), el parser, y el overlay + panel + alarma.

## 4. Otras potenciaciones del mapa (rápidas, sobre lo existente)

- **Modo Hunting**: reutilizar overlay de **kills/jumps 1h** + **ratting** para resaltar sistemas con
  NPC kills altos y pocos jugadores (objetivos de caza). Filtro "actividad por hora".
- **Anillos de proximidad "X saltos desde mí"** (Dijkstra) como overlay independiente — útil siempre.
- **Notificaciones nativas** (Tauri) reutilizables también para **skill queue <24 h** (ver
  `COMUNIDAD_FEATURES.md`).
- **Jump bridges de alianza**: potente para routing, pero requiere datos de estructuras de la alianza
  (ESI con permisos) → **aplazar**.
- **Wormholes (Pathfinder-like)**: nicho y complejo → aplazar.

## 5. Recomendación de prioridad

1. **Intel en vivo (chat-log) + overlay en el mapa + alarma de proximidad** ← mayor impacto/comunidad,
   y explota nuestra base. _Nuevo "killer feature" del mapa._
2. **Anillos de proximidad** + **Modo Hunting** (reusan grafo/overlays; baratos).
3. **Notificaciones nativas** (infra reusable: intel + skill queue).
4. Resto del backlog (jump planner avanzado, etc.) según `ROADMAP.md`.

> Nota de diseño: el intel-log es **opcional y local**; si el usuario no juega en esa máquina o no usa
> canales de intel, la capa simplemente no muestra nada. Cero dependencia de servidores nuestros.

---

### Fuentes
- SMT (Eve Map Tool) — foros oficiales y dev docs.
- Vintel, IntelPy, IntelWalker, RIFT Intel Fusion Tool, EveIntelChecker — repos/foros.
- Formato y ubicación del log de chat — EVE University Wiki ("EVE logs") y guía de parsing.
- Listas de tools — awesome-eve, EVE University Wiki.
