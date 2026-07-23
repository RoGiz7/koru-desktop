# Koru Desktop — Spec Técnico v1

**Estado:** vivo · **Fecha:** 2026-06-22 · **Actualizado:** 2026-07-23 (v0.30.0) · **Owner:** RoGiz7 / equipo Rekium

## 1. Objetivo

App de escritorio standalone para que cada jugador saque sus **estadísticas personales** de EVE Online
(PvP, wallet, skills, assets/industria) hablando **directamente con ESI** (API oficial de CCP),
sin depender de la infraestructura de Alliance Auth.

Replica el valor de `koru_stats` (PvP + export) pero como binario distribuible: cada usuario
gestiona su propio token, caché local, funciona offline, y puede leer cosas que la web/AA no
puede (logs locales del juego).

### Qué NO es
- No sustituye a AA/corptools para **datos de corp/alianza** ni auditoría (eso necesita tokens de
  director y BD central → sigue siendo `koru_auditor` / `koru_tickets`).
- No agrega datos de terceros sin su consentimiento: solo ve los datos del personaje que loguea.

## 2. Stack

| Capa | Tecnología | Notas |
|------|-----------|-------|
| Shell | **Tauri 2.x** | Binario nativo multiplataforma, ~10 MB |
| Backend | **Rust** | OAuth, cliente ESI, caché, parsing de logs |
| Frontend | **React + TypeScript** | Mejor ecosistema para dashboards de datos |
| Estado/fetch | **TanStack Query** | Encaja con el caché y revalidación de ESI |
| Charts | **Recharts** (o visx) | Tablas y gráficos de stats |
| HTTP (Rust) | `reqwest` (rustls) | Cliente ESI/SSO |
| JWT | `jsonwebtoken` + JWKS | Validación del access_token |
| Storage seguro | `keyring` | Refresh token en el keychain del SO |
| Caché local | **SQLite** (`rusqlite` bundled) | Datos ESI cacheados + histórico |
| Logs locales | `notify` (file watch) | Fase 5: intel desde Gamelogs/Chatlogs |

**Por qué Rust hace el grueso:** OAuth, almacenamiento del refresh token y llamadas ESI viven en
el backend de Tauri (Rust), expuestas al frontend vía `#[tauri::command]`. El frontend nunca toca
el token directamente.

## 3. Registro de la aplicación (CCP)

Ver `docs/REGISTRO_APP.md`. Resumen: tipo **Authentication & API Access** (PKCE, sin secret),
callback `http://localhost:8765/callback`, copiar el **client_id** a `src-tauri/src/config.rs`.

## 4. Flujo de autenticación — OAuth 2.0 Authorization Code + PKCE

> CCP recomienda PKCE explícitamente para apps de escritorio (no pueden guardar un secret).

### Endpoints
- **No hardcodear.** Leer de `https://login.eveonline.com/.well-known/oauth-authorization-server`
  y cachear (implementado en `sso/metadata.rs`). De ahí salen `authorization_endpoint`,
  `token_endpoint`, `jwks_uri`.

### Pasos (implementado en `sso/`)
1. `code_verifier` = 32 bytes aleatorios → base64url. (`sso/pkce.rs`)
2. `code_challenge` = base64url(SHA256(verifier)) **sin padding**.
3. `state` aleatorio (anti-CSRF).
4. Listener local en `http://localhost:8765/callback`. (`sso/callback.rs`)
5. Abrir navegador en `authorization_endpoint` con `response_type=code`, `client_id`,
   `redirect_uri`, `scope`, `state`, `code_challenge`, `code_challenge_method=S256`.
6. Capturar `code`, **verificar `state`**.
7. POST a `token_endpoint` (form, **sin Basic Auth**): `grant_type=authorization_code`, `code`,
   `code_verifier`, `client_id`. (`sso/token.rs`)
8. Respuesta: `access_token` (JWT ~20 min) + `refresh_token`.
9. Guardar `refresh_token` en **keyring**. (`sso/store.rs`)

### Refresh
- `grant_type=refresh_token` + `client_id`. **Manejar rotación**: guardar siempre el último.
- Un solo refresh en vuelo por personaje (mutex en `TokenManager`, `sso/mod.rs`) → evita la race
  condition que vimos en corptools.

### Validación del JWT (`sso/jwt.rs`)
- JWKS desde `jwks_uri` (cacheado). Verificar firma RSA, `iss`, `aud` (client_id + "EVE Online"), `exp`.
- Claims: `sub = EVE:CHARACTER:<id>`, `name`, `scp`.

### Multi-personaje
- Cada login añade un personaje; su refresh token va al keyring con clave = character_id.

## 5. Llamadas a ESI (`esi/mod.rs`)

- **Base:** `https://esi.evetech.net`
- **Header obligatorio:** `X-Compatibility-Date: YYYY-MM-DD` (en `config.rs`). Sin él, ESI sirve la
  versión más antigua. Reemplaza el viejo esquema `/latest/` `/v5/` de corptools.
- **User-Agent** identificativo.
- **Error budget:** cabeceras `X-ESI-Error-Limit-Remain` / `-Reset`; back-off al agotarse.
- **Caché:** respetar `Expires`/`ETag` (tabla `esi_cache`).
- **Paginación:** cabecera `X-Pages`.

## 6. Endpoints y scopes por estadística

Ver `docs/SCOPES.md` (verificado contra la lista oficial route→scope).

## 7. Esquema SQLite

Ver `src-tauri/src/db/schema.sql`. Tablas: `characters`, `esi_cache`, `killmails` (+ por dominio
en fases siguientes). Los refresh tokens **NO** van en SQLite (keyring).

## 8. Arquitectura de carpetas (real)

```
koru-desktop/
├── docs/                 # SPEC, SCOPES, REGISTRO_APP
├── src-tauri/src/
│   ├── config.rs         # constantes (client_id, scopes, compat date)
│   ├── error.rs          # AppError serializable
│   ├── sso/              # pkce, metadata, token, jwt, store, callback, mod
│   ├── esi/              # cliente ESI (compat-date, error budget)
│   ├── db/               # SQLite + schema.sql
│   ├── commands.rs       # #[tauri::command]
│   └── lib.rs            # builder + estado
└── src/                  # frontend React+TS (App.tsx)
```

## 9. Roadmap por fases

- **F0 — Andamiaje:** Tauri + React + SQLite. ✅
- **F1 — Auth:** PKCE, multi-personaje, refresh + keyring, validación JWT. ✅
- **F2 — PvP:** killmails (ESI + zKill), dashboard + export CSV, histórico completo, caché ETag,
  rate-limit/backoff. ✅
- **F3 — Wallet + Skills.**
- **F4 — Assets + Industria.**
- **F5 — Intel local:** watcher + parser de Chatlogs/Gamelogs.
- **F6 — Pulido:** export, packaging, auto-update Tauri, firma Windows.

### Cross-cutting (aplica a TODAS las secciones)

- **Vista global multi-personaje (importante):** además de la vista por personaje, una vista
  "Todos / Global" que **suma los datos de todos los personajes** para cada sección (PvP, wallet,
  skills, assets). Es la suma de tus personajes lo que da la foto real de tu jugabilidad.
  - **Matiz de diseño — deduplicar por evento:** al agregar PvP, contar **killmails distintos**,
    no filas por personaje. Si dos de tus personajes participan en el MISMO kill, es **un** kill, no
    dos (kills/ISK no se deben doblar). Global kills = killmail_ids únicos donde algún personaje
    tuyo es atacante; global losses = killmail_ids únicos donde algún personaje tuyo es víctima.
  - Para wallet/skills/assets la suma es directa (no hay solapamiento entre personajes), salvo
    cuidar el SP total y balances por personaje vs total.
  - UI: un selector arriba "Personaje ▾ / Global" que recalcula cada sección.

## 9b. Backlog (pendientes acordados, para implementar pronto)

- **Tabla de killmails: paginación + filtros.** Hoy la tabla "Recientes" muestra solo los 50
  últimos (las stats y el CSV sí usan TODO el historial). Falta paginar (p. ej. 50/página,
  Anterior/Siguiente) y filtros básicos (kills / losses, por sistema, por nave) para navegar el
  historial completo dentro de la app.
- **Vista global multi-personaje** (ver sección 9, cross-cutting).
- **Límite de páginas de zKill** configurable (hoy 100) por si alguien tiene un historial enorme.
- **UX de progreso en sincronizaciones largas.** El "Procesados: N" actual no transmite que sigue
  trabajando; con historiales grandes (5000+ kills) la sync dura varios minutos y un usuario podría
  pensar que se colgó y cortarla. Mejorar:
  - Mensaje explícito tipo "Sincronizando histórico… N killmails (página X). Puede tardar varios
    minutos la primera vez; no cierres la app."
  - Indicador de actividad (spinner/animación) + tiempo transcurrido y/o página actual.
  - Emitir también la página actual en el evento `km_progress` (hoy solo manda el contador).
  - Idealmente, deshabilitar/avisar en el botón mientras corre y permitir cancelar de forma limpia.

### Backlog PvP — afinado de métricas (para ir puliendo)

- **Daño por kill / top damage.** El detalle del killmail trae `damage_done` por atacante. Guardar
  el daño del personaje y si fue **top damage** y/o **final blow**. Mostrarlo por kill en la tabla.
- **% de eficacia (ISK efficiency).** `isk_destroyed / (isk_destroyed + isk_lost) * 100`. Es un KPI
  directo con los datos que ya tenemos; añadir tarjeta. (zKill también lo expone, pero lo calculamos
  nosotros.)
- **Top 5 naves más caras destruidas.** Ordenar kills por `isk_value` desc. OJO: hoy en los kills
  guardamos la nave DEL PERSONAJE, no la de la víctima. Para esto hay que **añadir
  `victim_ship_type_id`** (y quizá `victim_name`) al guardar el killmail y a la tabla.
- **Región junto a cada sistema (top sistemas).** A la derecha de "Top sistemas", mostrar la región
  de cada sistema. Mapear `system_id -> region` vía SDE (recomendado, sin coste de API) o por ESI
  (`/universe/systems/{id}` → constellation → region). Cachear el mapa; reutilizable de `eve_sde`.

### Backlog UI — lista de personajes (rediseño)

- **Tarjetas de personaje más limpias y escalables.** Hoy cada personaje muestra la lista cruda de
  scopes (ruidoso). Rediseñar para que sea estético y útil incluso con 20+ personajes:
  - **Foto del personaje** (`https://images.evetech.net/characters/{id}/portrait?size=64`).
  - **Corporación** (y alianza) a la que pertenece, con su logo
    (`https://images.evetech.net/corporations/{id}/logo`). Resolver vía
    `/characters/{id}/` → corporation_id → nombre.
  - **Sistema actual** (requiere scope `esi-location.read_location.v1`, que ya está declarado).
  - Quitar la lista de scopes de la vista principal (moverla a un "detalle" o iconos).
  - **Layout en rejilla** (p. ej. 4 columnas, tantas filas como hagan falta) en vez de tarjetas
    apiladas a ancho completo, para que con muchos personajes siga siendo compacto y ordenado.
  - Mantener accesos rápidos por tarjeta (Ver datos / Cerrar sesión) de forma discreta.

- **Ranking de rivales (posible pestaña nueva "Némesis/Rivales").** A partir de los killmails:
  - **Quién más te mata** y **a quién más matas**, tanto por **personaje** como por **corporación**
    (y opcionalmente alianza). Rankings con nº de kills/losses e ISK implicada.
  - Datos: el detalle del killmail ya trae `character_id`/`corporation_id`/`alliance_id` de víctima
    y de cada atacante. Para "a quién matas" → contar víctimas (y sus corps) en tus kills; para
    "quién te mata" → contar atacantes (y sus corps) en tus losses. Resolver nombres con
    `/universe/names/` (cachear).
  - Encaja como pestaña propia por volumen de datos; reutiliza el `raw` del killmail (conviene
    guardar el detalle completo en `raw`, hoy guardamos solo el id — ver nota abajo).
  - **Nota de datos:** para esto y para "naves de víctima", merece la pena **guardar el JSON
    completo del killmail en `killmails.raw`** (hoy guardamos solo el `killmail_id`). Así estos
    análisis no requieren re-bajar nada de ESI.

## 9d. Backlog — Soberanía / upgrades Equinox en el tooltip de sistema

Mostrar en la **leyenda/tooltip de cada sistema** (y opcional overlay) la info de soberanía Equinox.
**Disponible vía ESI** (no es importación manual): con Equinox CCP añadió una ruta de "Sovereignty
Systems" que junta mapa + estructuras en una sola respuesta.

Qué mostrar por sistema:
- **Quién lo posee** (alianza/corp) — ya teníamos `/sovereignty/map/`.
- **Sovereignty Hub**: upgrades instalados, si están online.
- **Reagents restantes**, **Power** y **Workforce** (de los Orbital Skyhooks del sistema).
- Estado de los **Skyhooks**.

Notas de implementación:
- Parte es pública (ocupación, qué estructuras hay); el detalle fino (reagents, etc.) puede
  requerir **auth + access lists** → encaja con "solo tus propios tokens".
- **Confirmar endpoint(s) y scopes exactos** al implementarlo (la API de soberanía cambió mucho con
  Equinox; ver dev blog "Equinox on ESI" y "Updates for Equinox – Developers Edition").
- Integrar en el `map-tip` (tooltip de hover) y/o como overlay "Soberanía".

## 9c. Backlog — Planificador de rutas en el mapa (feature grande)

Diseñar rutas sobre nuestro mapa de New Eden, estilo autopilot del juego pero más potente.
Inspirado en que CCP liberó `carbonengine/pathfinder` (C++), pero lo hacemos **nativo en Rust**
sobre nuestro `neweden.json` (no dependemos de su código; sirve de referencia de correctitud).

Por niveles de viabilidad:

**Nivel 1 — Rutas por stargates (fácil, ya tenemos los datos).**
- Grafo de saltos = `neweden.json` jumps. Dijkstra/BFS en Rust.
- Modos como el juego: **más corta · más segura (≥0.5) · menos segura**.
- UI: clic origen → destino en el mapa, dibuja la ruta resaltada; lista de saltos con seguridad.
- Coste: bajo. Es el MVP del planificador.

**Nivel 2 — Fatiga de salto (medio, scope disponible).**
- ESI `/characters/{id}/fatigue/` (scope `esi-characters.read_fatigue.v1`, ya registrable) →
  `last_jump_date`, `jump_fatigue_expire_date`, `last_update_date`.
- Mostrar fatiga actual del personaje y **estimar la fatiga añadida** por una ruta de jump drive.
- Nota: los **Ansiblex NO generan fatiga** (ventaja a reflejar en el cálculo).

**Nivel 3 — Jump drive de capitales: rango y fuel por skills (medio).**
- Rango de salto = f(nave, skill **Jump Drive Calibration**). Fórmula de rango ya documentada en
  `docs/COMUNIDAD_Y_VISION` (map-data: distancia LY con el factor 9.46e15 m/LY).
- Fuel (Liquid Ozone) por salto de capital = consumo_base_nave × distancia_LY ×
  (1 − 0.10 × **Jump Fuel Conservation**). Necesita skills del personaje (scope skills, ya lo
  tenemos) + nave elegida + consumo base por SDE (dogma attributes).
- UI: elegir nave + personaje → calcular saltos posibles, fuel total y fatiga.

**Nivel 4 — Ansiblex (jump gates) — TOPOLOGÍA DESBLOQUEADA (jul 2026).**

*Historia: aparcado en jun 2026 porque «la entrada manual de toda una red de golpe es poco
práctica». Eso resultó ser falso: lo que era poco práctico era el formulario que imaginábamos, no
el dato. Las alianzas ya publican la red entera en una tabla, y lo que el piloto hace con esa tabla
es copiarla. El pegado convierte «meter 97 puentes a mano» en un Ctrl+V.*

- **Confirmado (2026-07-18): ESI NO expone la red.** No hay endpoint ni scope de Ansiblex. Lo único
  que los enseña es `/corporations/{id}/structures` (`esi-corporations.read_structures.v1`) y no
  sirve: exige rol **Director**, solo devuelve los de TU corp, y **ni siquiera trae el destino** —
  habría que deducirlo del nombre autogenerado («SistemaA » SistemaB»). Para un piloto de línea no
  hay nada que sincronizar. Cerrado: no volver a investigarlo sin una noticia de FC que lo cambie.
- **Solución implementada: PEGADO + CONFIRMACIÓN** (`src/ansiblex.ts`, `src/ansiblexControl.tsx`,
  tabla `ansiblex`). El piloto copia la tabla del wiki de su alianza y la pega; Koru la analiza,
  enseña lo que ha entendido y **no guarda nada hasta que el piloto confirma**. Mismo trato que las
  fichas de instalación (F1c): la app propone, quien sabe declara.
- **Reglas del parser** (validadas contra la red real de 194 filas → 97 puentes):
  - Anclaje por CONTENIDO, no por posición de columna: una línea vale si tiene exactamente dos
    campos que resuelven a sistemas reales del SDE. Aguanta que el wiki reordene columnas o que
    otra alianza publique con otro formato.
  - **Trampa ya pisada:** «coger la primera palabra corta como dueño» NO vale — las regiones de una
    sola palabra (Cache, Catch, Detorid, Immensea, Omist, Tenerifis…) van primeras y se colaban
    como dueño. De ahí el anclaje a los dos sistemas y leer los extras solo de lo que va DETRÁS.
  - Una fila por puente (par canónico `a_id < b_id`), no dos: el wiki lista cada puente dos veces
    porque cada punta es una estructura distinta, con **su propio dueño** (7 de los 97 de la Webway
    son de corps diferentes). Para el grafo es UNA arista.
  - Lo que no se entiende **no se traga en silencio**: se cuenta y se enseña (líneas ignoradas,
    nombres sin resolver, puentes en un solo sentido).
- **Detector de erratas medido:** se contrasta el ly declarado por la fuente contra el calculado de
  `gx/gy/gz`. En la red real la desviación máxima es **0,0052 ly** (redondeo a 2 decimales del
  wiki), así que el umbral de aviso es **0,05** — margen de 10× y sigue cazando cualquier
  emparejamiento mal copiado, que se desviaría años luz enteros.
- **`gx/gy/gz` de `neweden.json` ESTÁN en años luz.** Verificado contra las 97 distancias publicadas
  (ratio 1.000). De aquí sale cualquier cálculo de distancia sin datos nuevos.
- **Reemplazo total en cada pegado**, no fusión: el wiki es la foto completa y los puentes se caen y
  se mueven. Un puente fantasma en el planificador es peor que no tener red — te manda por una ruta
  que no existe.
- ✅ **HECHO en v0.30.0:** los puentes entran como **aristas extra** en el rutado (`findRoute` con
  conjuntos de aristas añadidas, SIN mutar `geo.adj`) y la ruta marca qué tramos van por Ansiblex.
  Se pintan en verde curvo (`ansiArc`) como el mapa del juego, y la ruta puede **enviarse a EVE**
  (`set_ingame_route`, ver Nivel 6). También el «llegas en N» del cazador contando los puentes.

**Nivel 4b — Coste de condensador Ansiblex (A LA ESPERA — deploy sept 2026).**
- FC anunció el 2026-07-17/21 la revisión de proyección de fuerza. **Los números son PROPUESTOS y
  FC avisa expresamente de que pueden variar hasta el deploy** → NO incrustarlos todavía; cuando se
  implementen, que vayan versionados y fechados, no a pelo en el código.
- Modelo anunciado: `coste = base(clase de nave) × multiplicador(zona del Ansiblex DESTINO)`, con la
  zona medida en LY **desde el sistema capital de la alianza** (Z1 0-5 ×0 · Z2 5,1-10 ×2 ·
  Z3 10,1-15 ×6 · Z4 15,1-20 ×9 · Z5 20,1+ ×15). Condensador 1250 TJ, ~200 TJ/h, recarga NO lineal.
- **TRAMPA:** el multiplicador es el de la zona del **DESTINO**, pero el cap lo paga el Ansiblex de
  **ORIGEN**. Es facilísimo programarlo al revés.
- **TRAMPA 2:** la fila del Rorqual no cuadra con sus propios multiplicadores (base 19, pero Z2=57 y
  Z3=104,5 en vez de 38 y 114). Verificar al lanzamiento: ¿errata o excepción?
- Ya no hace falta ningún dato nuevo salvo **declarar el sistema capital de la alianza**: la
  topología ya entra por pegado y las distancias salen de `gx/gy/gz`.
- Lo que SÍ cambia y afecta al modelo actual: **fuera el ozono líquido** como requisito (la fórmula
  `ozono = masa × ly × 0.000003 + 50` de más abajo queda obsoleta para Ansiblex), fuera los peajes,
  ACL solo de alianza, y **capitales/supercapitales ya no pasan** (salvo Rorqual en la 1ª iteración).

**Nivel 5 — Wormholes (Thera/Turnur) — ✅ HECHO en v0.30.0.**
- Las conexiones de wormhole son **dinámicas** y **no están en ESI** ni en el SDE. Para Thera y
  Turnur las publica **eve-scout** (`api.eve-scout.com/v2/public/signatures`), igual que zKill o
  Dotlan: se consultan en vivo y se usan como aristas de ruta (en cian discontinuo).
- Thera es un nodo **sintético** (no está en el SDE): rombo aparte, y los tramos que lo cruzan se
  colapsan vecino↔vecino. Turnur sí es sistema real.
- **EVE no sabe rutear wormholes**, así que al enviar la ruta al cliente se pone solo el destino
  final y el piloto da el salto. El tramo a tramo por WH queda como mejora futura.
- Pendiente del alcance original: añadir conexiones **manuales** (un WH cualquiera abierto de X a Y)
  para la sesión. Sinergia con el rastreador de firmas (idea abierta): auto-escaneadas como aristas.

**Nivel 6 — Enviar la ruta a EVE — ✅ HECHO en v0.30.0.**
- `POST /ui/autopilot/waypoint` con el **único scope de ESCRITURA** de Koru,
  `esi-ui.write_waypoint.v1` (grupo LOCATION). `set_ingame_route` manda todas las paradas en orden
  (la 1ª con `clear=true`); con una sola parada = poner destino.
- **EXIGE re-login con «Ubicación»**: el scope es nuevo, los tokens ya emitidos no lo traen. La UI lo
  comprueba (`canWaypoint` mira `characters[].scopes`) y avisa ANTES en ámbar — un 403 se explica,
  pero llega tarde. OJO: el `title` de un botón deshabilitado NO se ve en WebView2.

**Orden sugerido (histórico):** N1 (rutas stargate) → N3 (rango/fuel) + N2 (fatiga) → N4 (Ansiblex)
→ N5 (WH) → N6 (enviar a EVE). **Todo hecho salvo N4b (coste condensador, a la espera de FC).**

## 10. Riesgos / decisiones abiertas

- **Rotación de refresh tokens:** mitigada con mutex por personaje.
- **Compatibility-date:** fijada `2026-06-01`; definir proceso para subirla.
- **SDE:** ¿descarga embebida vs. `/universe/`? Decidir en F2.
- **Distribución/firma:** SmartScreen + auto-update en F6.
- **zKillboard ToS / rate limit:** respetar User-Agent y caché.
- **Privacidad:** todo local; nada sale de la máquina salvo las llamadas propias a ESI/zKill.
