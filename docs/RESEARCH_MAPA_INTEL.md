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

---

## 6. Spec afinado para implementación (2026-06-29, confirmado por web)

**Log de chat (confirmado):**
- Carpeta: `Documents\EVE\logs\Chatlogs\` (Win). Encoding **UTF-16LE** (con BOM).
- Nombre: `Canal_AAAAMMDD_HHMMSS_<charID>.txt` (incluye el character_id "listener").
- Cabecera delimitada por guiones (channelName, listener, sessionStarted) → saltar.
- Línea: `[ AAAA.MM.DD HH:MM:SS ] Autor > mensaje`.
- **Uno por (canal, personaje, sesión):** cada cliente escribe su propio fichero. Con N alts en el
  mismo canal de intel hay N ficheros con líneas duplicadas → **juntar todos los ficheros de los
  canales configurados y deduplicar por (timestamp + autor + mensaje)**. Ficheros rotan por sesión:
  seguir el/los más recientes por canal.

**Arquitectura propuesta (Rust backend + watcher):**
- Watcher de la carpeta Chatlogs (crate `notify`) filtrando por los canales que configure el usuario.
- Lector incremental UTF-16LE (tail por offset) de los ficheros activos; parsear líneas nuevas.
- Estado en memoria: `Map<system_id, IntelReport{ last_seen, pilot?, ship?, raw, jumps }>`; emitir
  evento a frontend (Tauri `emit`) al llegar intel nuevo.
- NO persistir en BD (efímero) salvo quizá un historial corto opcional.

**Parser:**
- Sistema: match de tokens vs `neweden.json` `nameIdx` (prefijo + soportar `*` y abreviaturas).
- Keywords clear: `clr`/`clear`/`status`/`nv`/`nothing` → limpiar sistema.
- Piloto/nave: best-effort (regex laxa); guardar siempre el texto crudo.

**Enlaces:**
- Piloto → zKill: resolver nombre con ESI `/universe/ids` (nombre→character_id) → `zkillboard.com/character/<id>/`;
  fallback a búsqueda de zKill si no resuelve.
- Sistema → zKill/Dotlan (ya existe).

**Overlay "Intel" en el mapa:** círculos rojos pulsantes por recencia (fade en X min configurable);
tooltip hora/sistema/piloto/nave + "a N saltos" (Dijkstra desde sistema actual). Capa nueva en
OVERLAY_CATS "En vivo".

**Alertas configurables:** notificación nativa (`tauri-plugin-notification`) + sonido opcional si entra
intel a ≤ N saltos de tu sistema actual (o un "home" fijado). Config persistida (localStorage):
canales a seguir, ventana de recencia, umbral de saltos, sonido on/off.

**Panel "Intel reciente":** lista (hora · sistema · piloto · nave · saltos · enlace zKill) + botón limpiar.

**TOS:** read-only sobre logs locales, sin tocar el cliente → permitido (igual que SMT/Vintel/IntelPy).

---

## 7. Ejemplos REALES analizados (`../documentacion/chat logs/`, 2026-06-29)

El usuario copió logs reales de 3 personajes (charIDs 2117767770, 152730148, 331681765) y varios
canales: `Local`, `Corp.`, `Rekium Corp`, `Flota`, `Alianza`, `isk.imperium`, `fareast.imperium`.
**Canales de intel = `fareast.imperium` (Imperium/Goons) e `isk.imperium`.** El resto NO es intel.

**Confirmado de los ficheros:**
- Cabecera: 2 líneas de guiones; campos `Channel ID` (player_<hex>), `Channel Name`, `Listener`
  (= nombre del personaje, p. ej. SieteHierros), `Session started`. Saltar hasta tras la 2ª línea de guiones.
- Cada línea de datos lleva un carácter de control/BOM antes del `[` → limpiar (trim de no-imprimibles).
- Formato exacto: `[ AAAA.MM.DD HH:MM:SS ] Autor > mensaje`.
- El MOTD del sistema viene como línea de "Sistema EVE >" (ignorar).

**Patrones de intel reales (parser):**
- Sistema = código null-sec (`9PX2-F`, `8-WYQZ`, `TZN-2V`, `78-0R6`, `EFM-C4`, `R-3FBU`…) → match exacto
  contra `neweden.json` `nameIdx`. El `*` final (`9PX2-F*`) = hostil EN el sistema → quitar antes de matchear.
- Keywords: `clr`/`clear`/`CLR`/`cleared` = limpiar el sistema; `nv`/`NV` = neutral/sin visual; otros: `ess`,
  `drops`, `caps(ul)`, "on the X gate", "on ansiblex" (notas, no críticas).
- Estructura típica del mensaje: `SISTEMA* <piloto(s)> <nave?> <notas>` (sistema suele ir primero, pero no
  siempre). Pilotos = tokens capitalizados multi-palabra; naves a menudo en minúscula → poco fiables.
- Guardar SIEMPRE el texto crudo; extraer piloto/nave best-effort. Si NO hay sistema reconocido →
  es charla/ruido ("gj", "sorry", "wrong channel", "Kill: X (Proteus)") → no pintar en mapa.
- Hay nombres no-latinos (ruso/chino) y texto corrupto → no romper; el match de sistema (ASCII) sigue ok.

**Multi-personaje confirmado:** `fareast.imperium` existe para los 3 charIDs con líneas idénticas →
**deduplicar por (timestamp + autor + mensaje)** al juntar todos los ficheros de un canal.

**Para tests:** usar estos ficheros de `documentacion/chat logs/` como fixtures del parser.
