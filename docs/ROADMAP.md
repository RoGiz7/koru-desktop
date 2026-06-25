# Koru Desktop — Hoja de ruta

**Fecha:** 2026-06-24 · Revisión completa de estado y pendientes.

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

### C. Análisis / narrativa
7. **Batallas detectadas**: clustering de killmails por sistema+tiempo, marcadas en el mapa +
   enlace a **br.evetools** (usa el `raw` ya guardado).
8. **Feed de noticias** (RSS CCP/comunidad) + curado de hitos históricos.

### D. Distribución (cuando la base esté madura)
9. **Empaquetar el .exe** (instalador Tauri) para repartir por Rekium.
10. **git + `.gitignore`** → movido a **sección 0** (ya no es "cuando madure": hace falta ya).
11. **Firma de binario Windows** (SmartScreen) y **auto-update** de Tauri.

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
