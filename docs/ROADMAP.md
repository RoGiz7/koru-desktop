# Koru Desktop — Hoja de ruta

**Fecha:** 2026-06-24 · Revisión completa de estado y pendientes.
**Actualizado:** 2026-06-25 (v0.2.0) — ver "Estado actual" justo abajo.

---

## 📌 Estado actual (v0.2.0 · 2026-06-25)

> Resumen vivo por encima del histórico de abajo (que se conserva como contexto).

### Aplicado recientemente (v0.1.2 → v0.2.0)
- **Comercio** (órdenes de mercado), **Planetología** (PI), **Assets Fase B** (resuelve estructuras
  privadas con caché persistente + tabs por categoría).
- **Reestructura de navegación en grupos** (Resumen·Patrimonio·PvP·PvE·Industria·Personaje + Mapa
  central) con **iconos EVE** por grupo/categoría, **KPI cards con color** pos/neg, **tablas ordenables**
  e **icono Dotlan** en top sistemas.
- **Tema EVE inmersivo** (fondo nebulosa + paneles translúcidos) y **footer con hora EVE (UTC) +
  estado de Tranquility**.
- **Caché de regiones desde el SDE local** (a prueba de downtime).
- **Histórico local que supera la ventana de ESI** (journal ~30d / mining 90d): se acumula en SQLite.
  El journal ahora persiste `reason`/`context_id`/`context_id_type`/`first/second_party_id`.
- **Rateo pro** (PvE): ISK por sistema (context_id), nº de ratas (parseo de `reason`), gráficas
  día/semana/mes/año/acumulado, rango de fechas, ISK/hora.
- **Resumen** (home/dashboard): selector **Año/Mes**, ingresos y gastos **por categoría** con **donut**
  y comparativa **vs mes anterior**.
- **PvP → Actividad**: actividad diaria kills/losses + **horas calientes (UTC EVE)**, con selector de periodo.
- **Minería pro**: ore breakdown (donut), ISK estimado (precios de mercado), por sistema, tendencia mensual.
- **Pase de estilo global**: KPI cards con borde coloreado en todas las secciones; **donuts** en
  Wallet, Assets, Patrimonio, Rateo y Minería.
- **Gráficas interactivas**: donut con **hover** (resalta + centro informativo con % ) y **leyenda
  clicable para filtrar** porciones; barras con **tooltip** (valor + % del total) y resaltado.
- **Auto-update multicapa**: comprueba al arrancar **+ cada 6 h + al recuperar el foco** de la ventana.
- **Instancia única**: un 2º lanzamiento **enfoca la ventana existente** (evita conflictos de BD y
  carreras de refresh token).
- **Selector de tema** persistido (Nebulosa/Amarr/Caldari/Gallente/Minmatar/Abismo).
- **i18n ES/EN** — framework (`src/i18n.ts` + `t()` + selector persistido) y **chrome traducida**
  (navegación, cabeceras, pie, botones). Cuerpos de cada vista: pendiente (incremental).
- **Selector de tema** persistido (Nebulosa/Amarr/Caldari/Gallente/Minmatar/Abismo; `data-theme` + localStorage).
- **i18n ES/EN** — framework `src/i18n.ts` (`t()` por string-fuente + selector persistido) y **chrome traducida**
  (navegación, cabeceras, pie, botones). Cuerpos de vista: pendiente (incremental).
- **Personaje "header rico"** — atributos (5 + remaps), implantes (con icono/nombre), jump clones,
  sec status, fecha de nacimiento y bio. `esi/character.rs` + `get_character_detail`. Scopes de
  clones/implantes añadidos.
- **PvE — Factional** (`/fw/stats`, scope `esi-characters.read_fw_stats.v1`): facción, rango, enlistado,
  kills y victory points (ayer/semana/total). **PvE — Abyssals** (estimación honesta): runs e ISK por
  **compras de filamentos** en las transacciones de wallet (`wallet/transactions/` + match por nombre).
- **Releases v0.1.2 → v0.2.0** publicadas; auto-update verificado y **multicapa** (arranque + 6h + foco);
  **instancia única**; `workflow_dispatch` (botón manual) en el workflow como red de seguridad.

### Pendiente (orden por prioridad)
1. **i18n — completar** la traducción de los textos dentro de cada vista (mecánico, incremental).
2. **Friends & Foes**: overlay de **standings** (contactos) azul/rojo en el mapa.
3. **Fabricación**: separar de "Industria" con su propia vista (jobs) — split del grupo Industria.
4. **Scrub temporal** en PvP/Wallet (moverse en el tiempo) y orden por defecto Gráfica en PvP.
5. **Persistir histórico de transacciones** (para Abyssals/Comercio fiables más allá de la ventana
   de ESI) — hoy Abyssals usa solo la ventana reciente de `wallet/transactions/`.
6. **Jump planner avanzado**: fatiga (`/characters/{id}/fatigue/`) + rango/fuel automático por skills.
7. **Iconos reales de EVE en el mapa** (estaciones, estructuras, ore).
8. **Tematización por evento** (sobre el selector de temas ya hecho).
9. **Refactor pasada 2**: mover `MapView` y vistas a sus propios archivos.
10. **Feed de noticias** (RSS CCP/comunidad) + hitos históricos.
11. **Firma de código** (SignPath Foundation, gratis para OSS) para mitigar SmartScreen.

#### Apuntes / ideas surgidas
- **Rangos de FW por facción**: hoy se muestra el rango como número; mapear a nombre por facción (cosmético).
- **Abyssals fiable** necesita persistir transacciones (ventana ESI es corta); además distinguir tier/clima
  por el nombre del filamento daría desglose por dificultad.
- **Resolver nombres de ubicación** (home clone, estaciones) reutilizando el patrón de Assets Fase B.
- **i18n incremental**: ir traduciendo vista por vista; el diccionario `i18n.ts` ya admite añadir claves.

### Ideas / visión recogidas
- **Norte de diseño = dashboard "Koru Alliance Auth"** (capturas en `../documentacion/koru alliance auth/`):
  lo **personal** se replica en local (Resumen/Ingresos/Gastos/PvP/Actividad/Minería con periodo y vs
  anterior). Lo **de corp** (leaderboards de alianza, Kill Feed, top enemigos) **NO es local-first** →
  queda para el tool web (ecosistema koru_stats/Baserow), no para Koru Desktop.
- **Filosofía local-first reforzada**: conservar en el PC lo que ESI olvida (sincronizar con frecuencia).

---

## Visión / decisiones tomadas
- **App mapa-céntrica**: el mapa de New Eden es el centro; todo orbita alrededor.
- **Global por defecto**, el personaje es un **filtro** (sujeto: Global o personaje).
- **Stats-first, local y privado**: datos en la máquina del usuario, sin servidor (vía ESI).
- **Mapa 2D** como vista analítica. 3D queda aparcado (se haría con Three.js sobre el SDE, NO con
  Carbon — Carbon es un motor nativo C++ que no encaja en nuestra stack Tauri/web).
- Multi-personaje con deduplicado correcto en global.

---

## ✅ Hecho (estado actual)

**Núcleo / infraestructura**
- Tauri 2 + Rust + React/TS; SQLite local; keychain para refresh tokens.
- Auth EVE SSO **OAuth2 PKCE** (sin secret), multi-personaje, validación JWT, rotación de tokens.
- Cliente ESI con **caché ETag/304 + Expires**, **backoff anti-rate-limit**, `X-Compatibility-Date`,
  resolución de nombres (`/universe/names`) y de regiones.

**Secciones de datos (por personaje y global)**
- **PvP**: killmails (ESI + zKill), histórico completo, eficacia ISK, kills más caros (nave víctima),
  daño / final blow / top damage (con reproceso desde caché), regiones, export CSV.
- **Wallet**: balance, ingresos/gastos/neto, top ref_types, journal reciente.
- **Skills**: SP total, cola por personaje; en global "qué entrena cada personaje".
- **Assets**: stacks, tipos, top por cantidad.
- **Industria/Minería**: jobs activos, mining ledger, top minerales.
- **Vista global** de todas las secciones (suma multi-personaje, PvP deduplicado por killmail).

**Mapa (centro de la app)**
- New Eden completo desde el **SDE local** (`neweden.json`): 5.485 sistemas + 6.989 stargates + 70 regiones.
- Overlays: **Tu PvP · Seguridad · Kills 1h · Jumps 1h · Tus assets**.
- Etiquetas de región, **zoom/paneo**, **click en sistema** (panel + zKill/Dotlan), marcador
  **"estás aquí"**, dock de KPIs siempre visible.

**UI/UX**
- Armazón rail + escenario; tarjetas de personaje con foto + corp (+logo) + sistema actual.

---

## ✅ Hecho también (desde la primera versión del roadmap)
- Paginación + filtros (Todos/Kills/Losses) en la tabla de killmails.
- Guardar el **JSON completo del killmail** (`raw`) + reproceso para rellenar histórico.
- **Pestaña Rivales/Némesis** (a quién matas / quién te mata, por personaje y corp; con logos y zKill).
- **Planificador de rutas N1** (stargates, Dijkstra, modos corta/segura/insegura, multi-parada con
  buscador, lista de sistemas con seguridad + kills 1h + Dotlan).
- **Planificador de saltos** de capital (burbuja de rango en LY sobre coords 3D del SDE).
- Mapa: zoom centrado (botones), doble-click = zoom (sin seleccionar), rueda sin scrollear la página,
  **LOD de etiquetas** (región → constelación → sistema, tamaño constante), **tooltip de actividad**
  por sistema (kills/jumps 1h), acciones al seleccionar (Ruta/Salto desde aquí), overlay "Ubicación"
  por defecto, marcador "estás aquí".
- **Inventario ESI + detector de cambios**: `scripts/capture-esi-spec.mjs` (`npm run esi:capture`)
  descarga el spec OpenAPI oficial y genera `docs/esi/esi-endpoints.md` (218 endpoints, 36 categorías)
  + `esi-endpoints.snapshot.json` para diffs. Baseline capturada (spec 2026-05-19). Línea base para
  saber qué se puede hacer y cuándo CCP cambia la API.

---

## 🔜 Pendiente (priorizado)

### 0. Higiene del repo (rápido, desbloquea todo) ⚠️
- **`.gitignore`** ✅ actualizado (excluye `node_modules/`, `dist/`, **`src-tauri/target/`**, BD local).
  Falta el `git init` + primer commit: se hará desde **GitHub Desktop** (repo raíz = `koru-desktop/`).
- **Refactor (pasada 1)** ✅: `App.tsx` partido — extraídos `src/format.ts` (formateadores) y
  `src/constants.ts` (FEATURES, SCOPE, TABS, TAB_HEAD, OVERLAYS, FW_FACTIONS, POIS + tipos Tab/MapOverlay).
  Pasada 2 pendiente: extraer `MapView` y las vistas a sus propios archivos.
- ✅ **`.zip` del SDE archivados** en `../documentacion/sde-source/` (no borrados: son la fuente
  estática completa, útil para el jump planner/dogma más adelante). Fuera del repo. `neweden.json`
  sigue extraído en `public/`.

### Fase 1 — Mercado + patrimonio (mayor diferenciador) ✅ HECHO — falta compilar/probar en Windows
> Implementado 2026-06-24 (después de la última edición previa de este roadmap; por eso no figuraba).
- **Precios de mercado** vía endpoint **público** ESI `/markets/prices/` (`esi/market.rs`, sin scopes
  ni terceros) + tabla `market_prices`.
- **Valoración de assets** con esos precios → `AssetsSummary.est_value` (personal y global), KPI en Assets.
- **Snapshots de patrimonio** locales diarios por personaje (tabla `networth_snapshots`); `auto_sync`
  guarda snapshot (líquido wallet + valor estimado assets). Comandos `sync_market`, `get_networth`,
  `get_networth_global`.
- **Pestaña Patrimonio** (personal y global): KPIs total/líquido/assets + **gráfico SVG propio** de
  evolución con delta y % desde el primer snapshot. Estados vacíos honestos.
- ⚠️ Pendiente: **compilar y probar en Windows**. Matices conocidos: la curva empieza a acumularse
  desde ahora (sale a partir del 2º día); el valor usa *average price* de ESI (tendencia, no
  liquidación exacta en Jita → afinar luego en la calculadora de mineral).

### Fase 3 (adelantable) — Fruta madura confirmada por el inventario ESI
> El inventario confirma viabilidad sin tokens de terceros. Encajan directo en el mapa.
- **Planetary Interaction** con timers (`esi-planets.manage_planets.v1`, 4 endpoints).
- **Friends & Foes** — overlay azul/rojo por standings personales (**Contacts**, 9 endpoints).
- **Incursions** — overlay público trivial (1 endpoint).
- **Header de personaje rico** — implantes / jump clones / bio (Clones 2 + Character 14).

### ★ Reestructuración de navegación (propuesta Zigor, 2026-06-25)

Pasar de las pestañas planas actuales (PvP·Rivales·Batallas·Patrimonio·Wallet·Skills·Assets·Industria)
a **grupos con subsecciones**. El **Mapa** sigue siendo el centro. Estructura objetivo:

- **Patrimonio** (grupo; overview = gráfica de patrimonio ya hecha)
  - **Wallet** — gráfica de tendencia con **filtro de tiempo**.
  - **Assets** — buscador (Fase A hecho) + tabs por categoría (Fase B).
  - **Comercio** — compra/venta: visor de **órdenes propias** de compra/venta. ESI
    `/characters/{id}/orders/` (scope `esi-markets.read_character_orders.v1`). _Sección nueva._
- **PvP** — vista **por defecto Gráfica**, luego **Tabla**, luego **Tendencia con scrub temporal**
  (moverse en el tiempo). (Charts Nivel 1 ya hechos; falta el orden por defecto y el scrub.)
  - **Rivales**, **Batallas**.
- **PvE** (grupo; gráfica de tendencia con filtro de tiempo) — _todo nuevo:_
  - **Rateo** — bounties, derivable del wallet journal (`bounty_prizes`).
  - **Abyssals** — ESI **no** expone runs abisales directamente → se infiere de **loot + journal**
    (única vía posible; precisión limitada, se asume).
  - **Factional** — participación en FW: `/characters/{id}/fw/stats` (scope
    `esi-characters.read_fw_stats.v1`).
  - _(Incursiones personales en PvE: **descartado por ahora** — la capa Incursiones del mapa sí está.)_
- **Industria** (grupo; gráfica de tendencia con filtro de tiempo)
  - **Mining Ledger** (ya hay datos), **Planetología** (`/characters/{id}/planets/`, scope
    `esi-planets.manage_planets.v1`), **Fabricación** (jobs de industria, ya hay datos).
- **Personaje** (grupo nuevo)
  - **Skills** (ya hechas) + **header rico**: implantes (`/characters/{id}/implants/`),
    jump clones (`/characters/{id}/clones/`), bio. (Inspiración EVE Carbon.)

#### Mejoras transversales (de la misma propuesta)
- **Iconos EVE por categoría y subcategoría** (no solo en las listas internas). Para grupos/secciones
  habrá que elegir iconos representativos (algunos por type/group del SDE, otros de set propio).
- **KPI cards con color positivo/negativo** (verde/rojo) para que se lean de un vistazo: ISK destruido
  vs perdido, neto de wallet, eficacia, etc.
- **Tablas ordenables por columna** (flechas asc/desc: A→Z, 0→9) en kills, losses, wallet, assets…
- **Top sistemas**: añadir **icono → Dotlan** para revisar el sistema.
- **Iconos reales de EVE en el mapa** (estaciones, estructuras, ore, naves) — consolidar con el punto
  de "iconos reales" de la sección C.

> Nota: esta reestructuración toca el armazón de pestañas del `stage`; conviene hacerla **antes** de
> seguir metiendo charts en cada sección, para no duplicar trabajo. Varias subsecciones nuevas
> (Comercio, Factional, Planetología, Rateo) requieren **comandos ESI nuevos** (backend).

#### Robustez / a prueba de downtime
- **Resolver nombres de región desde el SDE local**, no desde ESI. Hoy las "Top sistemas" piden región
  vía `/universe/systems/{id}` → durante el **downtime de TQ** dan 504 ("Timeout contacting tranquility")
  y son llamadas innecesarias. `neweden.json` ya tiene sistema→región: resolverlo en local es **más
  rápido y a prueba de downtime**. (Detectado 2026-06-25 con el downtime real.)

### A. Pulido de base (≈ Fase 2 del plan EVE Carbon: barra de estado + design system)
1. **Barra de estado / log inferior** (lo más visible): resuelve el problema UX del "Procesados 2520".
   Línea inferior persistente con actividad actual ("Sincronizando histórico… N killmails, página X.
   No cierres la app"), indicador SDE / "cargado de BD local, sin llamada ESI", reloj de última sync.
2. **Sistema de diseño consistente**: cards uniformes, header de sección (título + subtítulo),
   sub-herramientas por sección. Es lo que da el "aspecto a ese nivel" de EVE Carbon.
3. **UX de sincronizaciones largas**: mensaje "no cierres la app", spinner/tiempo, página actual en
   el progreso (emitir página en `km_progress`), botón deshabilitado mientras corre y **cancelar** limpio.
4. **Logo de alianza** en la tarjeta de personaje (además de la corp).
5. **Rejilla de tarjetas de personaje** (4 col.) para que escale con 20+ personajes (SPEC §9b backlog UI).

### B. Mapa — siguientes capas
0. ✅ **Panel de filtros estilo mapa oficial de New Eden** (inspiración que más gustó; ver
   `../documentacion/inspiracion-mapa-new-eden.md`) — HECHO (frontend, falta compilar/probar Windows):
   **barra inferior de capas** (Ubicación·Seguridad·Soberanía·Kills 1h·Jumps 1h·Tu PvP·Assets·Minería,
   con las capas "tuyas" marcadas) + **panel de contexto derecho** con título/descripción/KPIs por capa.
   **Sub-filtros desplegables** ✅ HECHOS (frontend): Soberanía→Todos/Alianzas/Facciones,
   FW→por imperio, Lugares→por tipo (fila de pastillas sobre la barra, reset al cambiar de capa).
0e. ✅ **Capa Incursiones (Sansha)** — HECHA (backend + frontend): comando público `get_incursions`
   (`/incursions`) + overlay `incursion` (sistemas infestados, staging destacado, color por estado,
   KPI). Falta compilar (cargo + tsc) y probar en Windows.
   **OJO**: la "Insurgencias" (Havoc/piratas) del mapa oficial **NO tiene endpoint ESI** → no es
   construible; Incursiones (Sansha) es la capa pública equivalente que sí existe.
0d. ✅ **Capa Guerra de facciones** — HECHA (backend + frontend): comando público `get_fw_systems`
   (`/fw/systems/`, sin token) + overlay `fw` coloreado por imperio (Caldari/Minmatar/Amarr/Gallente),
   radio/intensidad según `victory_points`/`contested`, KPI "sistemas disputados" y facción en el
   tooltip. Falta compilar (cargo + tsc) y probar en Windows.
0b. ✅ **Capa Lugares/POI** — HECHA (frontend): overlay `poi` con pines de hubs/históricos/PvP
   (lista curada por nombre buscada en `neweden.json`, sin hardcodear IDs). Ampliable con más lugares.
0c. ✅ **Rework del lateral a barra superior** — HECHO (frontend): rail → `topbar` sticky con Global +
   personajes como **foto compacta que se expande en hover** (nombre/corp/alianza/sistema/logout) +
   "Conceder acceso" colapsable + ⟳ sync. Libera ancho para el mapa.
3. **Planificador de saltos avanzado** (sobre la burbuja ya hecha): **fatiga**
   (`/characters/{id}/fatigue/`) y **rango/fuel automático por skills** (Jump Drive Calibration /
   Fuel Conservation + datos de nave del SDE). Ansiblex y wormholes: **aparcados** (ver `SPEC.md §9c`).
4. **Overlay de minería** en el mapa (dónde has minado), análogo al de assets.
5. **Soberanía / upgrades Equinox** en el tooltip de sistema y/o overlay (vía ESI; ver `SPEC.md §9d`).
6. **Vista 3D opcional** (Three.js sobre coords 3D del SDE) — aparcado, "explorar el cluster".

### Inmersión / identidad (nuevos)
- ✅ **Buscador de Assets (Fase A)** — HECHO: quitado "Top tipos"; comandos `get_assets_detail`(+global)
  con resolución LIGERA (espacio + estaciones NPC, sin estructuras → no agota el error budget); UI con
  buscador que filtra por item/sistema, con iconos reales. Pendiente Fase B (abajo).
- ✅ **Aviso de scopes por personaje** — HECHO: punto rojo "!" en la foto si falta acceso, popover lista
  qué falta + botón "Añadir acceso" (relogin con set completo). `CAPS` en constants.
- ✅ **Icono de la app (Koru)** — HECHO: icono propio (cúmulo estelar cian sobre fondo oscuro) en
  `branding/koru-icon.svg/png`, aplicado con `npm run tauri icon`. Reemplaza el placeholder de Tauri.
- ✅ **v0.1.1 publicada y auto-update VERIFICADO** end-to-end (la app instalada se actualizó sola).
- **Resolver estructuras privadas (citadels) en assets** — IMPORTANTE: ahora los assets en estructuras
  de jugador salen con sistema "—". Sin esto el buscador de assets pierde mucho valor. Implementación
  **ligera y correcta**: tabla persistente `location_system(location_id, system_id)` que resuelve cada
  ubicación **una sola vez** (incl. estructuras vía `/universe/structures/{id}` con el token del dueño),
  **cacheando también los fallos** (negative cache) para no reintentar y no agotar el error budget de ESI.
- **Tematización / fondos por evento** — visión: temas visuales (p. ej. "Citadel War", eventos) que den
  vida a la app, **cambiables por el usuario** y persistidos en local. Fase 1: selector + 2-3 temas
  (tokens de color + fondo sutil). Fase 2: tema "evento actual". Se apoya en los design tokens ya creados.

### C. Análisis / narrativa
0. **Personalización visual — Nivel 1 (gráficas + toggle Tabla/Gráfica)** — EN CURSO. Componentes
   reutilizables `Bars` (barras SVG/CSS), `TrendChart` (líneas) y `ViewToggle`. Hecho en **PvP** (top
   naves/sistemas, kills vs losses, ISK, **tendencia por semana** vía `get_pvp_trend`). Pendiente
   extender a Wallet, Assets, Rivales, Skills, Industria. Niveles 2 (ajustes guardados) y 3 (dashboard
   de widgets configurable estilo Metabase-lite) quedan como fases futuras.
0b. **Inmersión EVE — iconos reales** — EN CURSO. Helper `typeIcon`/`typeRender` (images.evetech.net).
   Hecho: render de nave en "Top naves", icono de item en Assets y ore en Minería. Pendiente: iconos en
   más listas, killmails, e iconos reales de estación/estructura/ore en el mapa.
0c. **Idioma ES/EN** — pendiente. i18n: selector + diccionario de textos guardado local. Valioso si la
   app sale de la corp.
0d. ✅ **BUG Assets — RESUELTO**: era el scope `esi-assets.read_assets.v1` faltante en ese personaje
   (no un bug de código). Reconfirmado al reloguear con set completo. De ahí nació el **aviso de scopes
   por personaje** (sección Inmersión).
7. **Batallas detectadas**: clustering de killmails por sistema+tiempo, marcadas en el mapa +
   enlace a **br.evetools** (usa el `raw` ya guardado).
8. **Feed de noticias** (RSS CCP/comunidad) + curado de hitos históricos.

### D. Distribución (cuando la base esté madura)
9. **Empaquetar el .exe** (instalador Tauri) para repartir por Rekium.
10. **git + `.gitignore`** → movido a **sección 0** (ya no es "cuando madure": hace falta ya).
11. **Firma de binario Windows** (SmartScreen) pendiente. **Auto-update de Tauri** ✅ IMPLEMENTADO:
    plugins `updater`+`process`, `tauri.conf.json` con pubkey y endpoint a Releases, botón "Actualizar"
    en la barra superior (check al arrancar), y workflow `.github/workflows/release.yml` (tauri-action)
    que compila/firma/publica y genera `latest.json`. Requiere 2 secrets en GitHub
    (`TAURI_SIGNING_PRIVATE_KEY` = contenido de `koru.key`, y `..._PASSWORD`). Release = subir tag `vX.Y.Z`.
    La clave privada `koru.key` vive fuera del repo (en `~/.tauri/`) — NUNCA commitearla.

#### Open source (decidido)

El proyecto se publica **open source bajo licencia MIT** (`LICENSE`) como aporte a la comunidad de EVE,
sin ánimo de lucro. `README.md` con filosofía, privacidad, build y créditos. **Donativos voluntarios**
vía Ko-fi (`ko-fi.com/rogiz7`) — permitido por la Developer License de CCP siempre que **no se restrinja
la app según donaciones**. Revisado: **no hay secretos** en el repo (PKCE → `client_id` no es secreto;
refresh tokens en keychain). Pendiente: hacer el repo **público** en GitHub. Bonus: si es OSS,
**SignPath Foundation** firma gratis (mitiga SmartScreen).

#### Guía de distribución v1 (cómo repartir el .exe)

Clave: **el código va al repo; el instalador (.exe) NO** (la carpeta de compilado está en `.gitignore`).
El binario se reparte aparte, vía **GitHub Releases**.

Pasos:
1. **Generar el instalador** en Windows: `npm run tauri build`. Sale en
   `src-tauri/target/release/bundle/` (un `.msi` y/o un `setup.exe` NSIS). Eso es lo que se instala.
2. **Publicar en GitHub Releases** (en github.com, pestaña *Releases*, no en el árbol de archivos):
   *Draft a new release* → crear un tag (`v0.1.0`) → título + notas → **arrastrar el instalador** como
   adjunto → *Publish*. Queda una página de descarga; se reparte ese enlace por Rekium.
3. Subir la versión: cada release nueva = nuevo tag (`v0.1.1`…) con su instalador.

Avisos:
- **SmartScreen**: como el binario no está firmado, Windows mostrará "Windows protegió tu PC" →
  el usuario pulsa "Más información → Ejecutar de todas formas". Normal en apps indie; avisarlo en las
  instrucciones. Quitarlo del todo = certificado de firma (de pago) → ver punto 11.
- **Auto-update (opcional, futuro)**: el updater de Tauri puede mirar la última Release y actualizar
  solo. Se monta cuando interese; para empezar basta el enlace de la Release.

---

## Notas
- Recordatorio: **borrar los dos `.zip` del SDE** de la carpeta (ya extraído `neweden.json`).
- Documentos relacionados: `SPEC.md` (técnico + backlog detallado), `COMUNIDAD_Y_VISION.md`
  (ecosistema, mapa, grafismo SDE, overlays del juego), `SCOPES.md`, `REGISTRO_APP.md`.
