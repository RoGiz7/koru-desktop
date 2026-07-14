# Koru Desktop — Hoja de ruta

**Fecha:** 2026-06-24 · Revisión completa de estado y pendientes.
**Actualizado:** 2026-07-14 (v0.27.1) — ver "Estado actual" justo abajo.

---

## 📌 Estado actual (v0.27.1 · 2026-07-14)

### Hecho desde v0.16.1 (resumen por versión)
- **v0.17–v0.18.4 — BITÁCORA completa**: motor de logros retroactivos + retos adaptativos
  (`db/bitacora.rs`), notificación nativa, pase de inmersión (marcos SVG, dominios, puntuación),
  Diario biográfico, medallero mixto con condecoraciones in-game (`read_medals`), Lealtad/LP +
  Misiones/Agentes con overlays en el mapa, freelance jobs + proyectos de corporación, y
  **proyectos personales parametrizados** (filtros nave/mineral/sistema/PJ/corp, modos de minería,
  completar/celebrar).
- **v0.19.0** — modal "Novedades" in-app (`changelog.ts`, mantener en CADA release) + iconos por carrera.
- **v0.20.x — Logi Fase B (gamelog)**: reps remotas escudo/blindaje/casco (dato que ESI no expone),
  apartado Logis con desglose por piloto/nave/módulo, dominio de medallas "Apoyo", lector
  incremental y datos a prueba de borrados (BD = fuente de verdad).
- **v0.21.0 — Fase D «¿Dónde?»**: sistema por evento cruzando gamelog ↔ chatlogs de Local
  (`chatlog.rs`, tablas `*_sys`), 596 gamelogs huérfanos rescatados (2019–2021, 294 MB), y tres
  datos falsos cazados (ratas en español, `Veldspar*`, `PS-94K*`).
- **v0.22.0 — Fase D en las vistas**: Minería «Por sistema» empalmada (2019→), Rateo con Bruto
  (gamelog) por sistema, **Daño y Fallos por arma**, Especiales con eje propio, fin de seis años
  de ceros falsos en Ratas/ISK-rata, cuentas sin suavizar, intel lee solo la cola del log.
- **v0.23.0 — «Condecoraciones»**: 8 medallas nuevas del gamelog (Capataz, Voz de mando, Filón,
  Chatarrero, Prospector, Trotamundos, Demoledor, Artillero), magnitudes Calidad del golpe y
  Salvage en Rateo, tablas Residuo por mena y Bonificaciones de mando en Minería, banner con
  iconos reales, fix de condecoración duplicada, `get_medals` expone `graphics`.
- **v0.24.0 — «Medallas pintadas»**: condecoraciones de corp DIBUJADAS (`medals.rs` +
  `medalArt.tsx`): SharedCache autodetectada o picker en Ajustes, extracción en runtime a
  app-data (cero redistribución — decisión EULA; las hojas resultaron DDS SIN comprimir → decode
  a mano, solo crate `png`), canvas con la receta calibrada (tinte multiplicativo, capa 0 encima,
  bbox, cinta+medallón), fallback al marco genérico, medallas repetidas agrupadas ×N con fecha y
  motivo por entrega, aviso "EVE Online © Fenris Creations (FC)" en Ajustes. Validado en vivo con
  las 4 del usuario.

- **v0.24.1 — «Filón»**: umbrales recalibrados con datos reales (100k/1M/10M; el resto de las 8
  medallas de la 0.23.0 quedaron clavadas: verificadas 7/8 en plata con el oro a la vista).
- **v0.25.0 — «Cara a cara»**: PvP del gamelog (#45) COMPLETO — tabla cara a cara (naves/drones/
  estructuras, peleas sin killmail, desde 2019), magnitud «Daño PvP (gamelog)» en la gráfica con
  top-5 rivales, fix intel (mtime congelado de Windows → fecha del nombre como respaldo),
  reescaneo REANUDABLE (marca reset_done por versión), y 3 venenos fuera (ratas fantasma tipo
  "M2-XFE"/"Hoeybye[UKMF](Scimitar", fallos enemigos como propios, fila `*` en boosts).
  LOGI_DATA_VERSION=19. Lección de era: hint localized cambia de idioma según época → parsear
  el VISIBLE; validar parsers también contra la carpeta principal, no solo `old/`.

- **v0.26.0 — «Pulso»**: gráficas VIVAS (syncTick/glTick: la vista abierta se refresca en sitio
  con cada sync/escaneo), retos de corporación en la Bitácora (proyectos activos con TU
  aportación), Cazador ficha por nombre vía ESI (Fase 3.5; get_pilot_profile con respaldo de id
  en name_cache), banner intel con «+N más» (el más cercano manda; timer renovado), magnitud DPS
  en Rateo, Daño/Fallos PvE-puros (resta exacta de gamelog_pvp por día+arma), título oficial en
  la Bitácora, fósiles «#-1» borrados del mining_ledger. Sin reescaneo.

- **v0.27.0 — «Colonias»** (Pilar Industrial: R1+R3+R2a): Planetología deja de ser una tabla plana.
  Dashboard multi-personaje (caducidad, producción/h REAL del pin, capacidad/día valorada) ·
  **alarma de extractores configurable** (umbrales a gusto, por defecto 8h y 1h + parada; banner
  ámbar propio que lleva a Planetología; texto que distingue colonias del mismo sistema por tipo de
  planeta) · **capa «🪐 Tu PI» en el mapa** (sistema coloreado por su peor extractor) + panel por
  colonia al clicar · **explorador de cadenas P0→P4** y **planificador inverso** con la tabla
  P0→planetas **verificada contra EVE University** (`pi_p0_planets.json`; la comunidad agregada
  daba 12/15) · **memoria de precios (R2a)**: `price_history`, `get_market_history`, el watchlist
  acumula histórico al mirarlo, y «actual ±X% vs su media». Fixes: el rename bidireccional de serde
  que impedía pintar los extractores, y la poda del dedup que se vaciaba sola.
- **v0.27.1 — «Que se oiga»** (R4 + F1a + intel): **el intel ya no puede fallar en silencio** —
  `IntelStatus` publicado por el hilo y franja honesta en la UI («leyendo N log(s) · M líneas» en
  verde; ámbar/rojo con el motivo exacto); fuera el `unwrap_or_default()` que convertía cualquier
  error en «0 líneas» mudas; la recencia deja de podar FICHEROS (filtra mensajes). ⚠️ La causa raíz
  del arranque mudo NO está identificada: lo que se arregló es que sea VISIBLE. **R4**: scopes
  `read_blueprints` + `read_contracts` (grupo Industria, dentro de `core_v1()`). **F1a**: biblioteca
  de blueprints con **ME/TE reales** (pestañas por categoría/grupo del producto + buscador) y
  **árbol BOM** con las cantidades EXACTAS del juego (fórmula verificada contra un job real:
  20.307/3.808/1.587/318) cruzado con tus assets.

### Pendiente REAL (orden recomendado)
0. **PILAR INDUSTRIAL**: F1b y F1c HECHOS (sin release: falta probar el asistente en vivo contra el
   fixture del Bantam → 20307/3808/1587/318). Siguiente: **F1d** (build-vs-buy por nodo + «qué hay
   que transportar») o **F2** (invención). Ver el bloque del pilar abajo.
1. **Menores**: partir App() en `useAppData()`, deriva del QA.sql (medallas nuevas sin cubrir).
2. **Lote del próximo reescaneo** (agrupar, el I/O de 6,6 GB se paga una vez): **PvP desde el
   gamelog (tarea #45)** — daño/fallos/calidad por arma contra jugadores, peleas sin killmail — +
   fix del parser de boosts (preferir el hint EN localizado).
3. Horizonte: Ansiblex (sigue bloqueado por FC) y el PILAR INDUSTRIAL (ver abajo). HECHOS y
   fuera de esta lista: corp projects como retos (0.26.0), Fase 3.5 (0.26.0), títulos oficiales
   (0.26.0), +N intel (0.26.0), sistema del CSV → al lote de reescaneo, **repo público + firma
   SignPath (ya operativos)**.

### 🏭 PILAR INDUSTRIAL — comercio · contratos · transporte · fabricación e invención
Research y confrontación con la comunidad: `../documentacion/RESEARCH_INDUSTRIA.md` (2026-07-11).
Ventaja estructural: lo que Ravworks/IPH piden pegado a mano (stock, skills, jobs, precios),
Koru lo sabe EN VIVO y multi-personaje; y el transporte como coste (que nadie integra) tenemos
mapa y rutas para hacerlo. Dependía a propósito de todo lo construido.

**REFUERZOS previos — LOS CUATRO HECHOS (publicados en 0.27.0 y 0.27.1):**
- ✅ **R1 — Planetología de verdad** (era el módulo más débil: 43 líneas de tabla plana). Dashboard
  multi-personaje, alarma de extractores configurable, cadenas P0→P4, planificador inverso, capa en
  el mapa y panel por colonia. Spec: `../documentacion/SPEC_PLANETOLOGIA.md`.
  Flecos: nombres de los 15 P0 en EN (cosmético) · skyhooks (endpoints de corp con rol;
  `/skyhooks/raidable` público como idea de intel; experimento de assets pendiente).
- ⏳ **R2 — Memoria de precios**: **R2a hecho** (`price_history`, `get_market_history`, el watchlist
  acumula histórico al mirarlo, «actual ±X% vs su media»; `adjusted_price` y `region_history` ya
  existían). **Pendiente R2b** (gráfica 400d con presets + banda alto/bajo + volumen) y **R2c**
  (cruce con tu journal). Spec: `../documentacion/SPEC_R2_PRECIOS.md`.
- ✅ **R3 — Pipeline SDE → public/**: `scripts/extract_industry_sde.py` → `bp_industry.json`
  (5.081 BPs) + `pi_schematics.json` (68 esquemas). Más `scripts/build_bp_tree.py` →
  `bp_tree.json` (categoría/grupo de inventario del producto de cada plano) y
  `scripts/build_pi_p0_planets.py` → `pi_p0_planets.json`.
- ✅ **R4 — Scopes nuevos**: `read_blueprints` + `read_contracts` en el grupo `INDUSTRIA`
  (`config::scopes`), incluido en `core_v1()`. Concedido en vivo. ⚠️ `upsert_character` REEMPLAZA
  los scopes (y el token SSO también): un login granular deja al personaje solo con esos → el
  camino bueno es «Set completo».

**FASES del pilar** (spec fina por fase antes de codificar — `../documentacion/SPEC_F1_FABRICACION.md`):
- ⏳ **F1 — Fabricación (la joya)**. **F1a HECHO**: biblioteca de blueprints con ME/TE REALES
  (pestañas por categoría/grupo del producto + buscador) + **árbol BOM** con las cantidades exactas
  del juego + cruce con Assets («necesitas / tienes / te falta»).
  **Fórmulas VERIFICADAS contra un job real** (fixture Bantam ME10 en Sotiyo nullsec):
  materiales = `ceil(base × runs × (1−ME) × (1−bonif_estructura) × (1−rig_base × mult_seguridad))`
  → 20.307/3.808/1.587/318 exactos · tiempo → 18:53 al segundo · coste → 40.536 ISK al ISK.
  ⚠️ **Los rigs escalan con la seguridad** (null/WH ×2.1 · low ×1.9 · high ×1.0) y **EVE muestra el
  efectivo REDONDEADO** (−5,0 % cuando es −5,04 %): pedir SIEMPRE el valor BASE del rig.
  **F1b HECHO (el dinero)**: `VEO = Σ(qty_BASE × adjusted_price)` × índice del sistema
  (`/industry/systems/`, público) → bonif. de estructura sobre el BRUTO + impuesto de centro +
  recargo de CCS (4 %), estos dos sobre el VEO. Desglose calcado al tooltip del juego.
  **F1c HECHO — «Mis instalaciones»** (idea de RoGiz7, 2026-07-14): el registro del fabricante,
  tabla `facility` en SQLite (entra en las copias) + asistente de 6 pasos.
  **Por qué el usuario lo declara y Koru no lo deduce**: los rigs y los servicios de una estructura
  NO se ven in-game sin roles, y ESI solo se los cuenta a un Director de la corp dueña
  (`/corporations/{id}/structures/`). No hay nada que deducir. Por eso las alianzas publican hojas
  de cálculo con las mejoras de sus estaciones — y por eso se hizo **asistente y no importador**:
  importar la hoja de una alianza concreta habría servido a esa alianza y a nadie más.
  Reglas que sostienen la ficha: **nunca se piden porcentajes** (se pide QUÉ es y QUÉ lleva; los
  números los pone el SDE) · **lo que falta se queda CORTO, nunca largo** (un rig con alcance sin
  mapear no se aplica, y se dice) · **la confianza se dice en voz alta** (ficha completa → «cuadra
  al ítem»; a medias → «estimación, falta X»), en vez de un «esto es aproximado» genérico que
  rebajaría una fórmula ya verificada al ISK.
  Se descarta POR EL DATO lo que no puede fabricar: la `Standup Manufacturing Plant I` (35878) lleva
  en el SDE sus `canFitShipGroup` → Citadel (1657), Engineering Complex (1404), Refinery (1406);
  Ansiblex/Metenox/Pharolux/Tenebrex quedan fuera como hecho. Que quepa ≠ que esté instalada.
  **F1d — SIGUIENTE**: build-vs-buy POR NODO, y la idea de RoGiz7 → **«¿este material ya está EN la
  instalación elegida?»**, para decir exactamente qué hay que transportar. Ojo: `get_assets_detail`
  hoy tira el `location_id`, y los assets de EVE son un **árbol** (el material puede estar en un
  contenedor dentro de la estructura); una ficha manual no tiene `structure_id` → «no lo sé», no 0.
- **F2 — Invención**: esperanza por decryptor con skills reales, coste POR ÉXITO, propiedades
  del BPC resultante, encadenado al coste de F1. Ya tenemos los 1.117 BPs con sus probabilidades.
- **F3 — Jobs con economía**: cada job con coste/valor esperado/beneficio; al entregar, cruce
  con wallet → beneficio REAL por línea de producción (EVE Tycoon, pero automático).
- **F4 — Transporte**: coste de mover BOM/producto (ISK/salto configurable estilo Red Frog +
  m³ + colateral) integrado en build-vs-buy. El hueco que nadie cubre.
- **F5 — Contratos**: leer contratos del personaje, valorarlos (mini-Janice interno con
  nuestros precios) y unirlos al P&L. **El scope ya está concedido (R4)**: arranca sin relogin.

---

## 📌 Histórico — Estado v0.16.1 (2026-07-02)

> Puesta al día tras la revisión de proyecto (`../documentacion/koru-desktop-REVISION_2026-07-02.md`,
> fuera del repo). El bloque v0.8.0 de
> abajo se conserva como histórico; varios de sus "pendientes" ya están hechos.

### Hecho desde v0.8.0 (resumen por versión)
- **v0.9.0–v0.10.x** — lección de release: subir versión en los 3 ficheros
  (package.json / tauri.conf.json / Cargo.toml) ANTES del tag; el updater compara el build.
- **v0.11.0 — i18n ES/EN COMPLETO** (bilingüe publicado; cadenas sueltas cerradas 2026-07-01).
  Cierra el punto 2 del bloque v0.8.0. Regla al añadir texto: envolver en `tr()` + clave EN.
- **v0.12.0 — Abyssals/CRAB valorados por loot**: papeles (48121/60459) valorados por inventario,
  líneas ESTIMADAS en Ingresos PvE + snapshot diario (`paper_snapshots`), separado del realizado.
- **v0.14.0 — Comercio N2 (P&L)** + **importador CSV de corptools** (`import_wallet_csv` en Ajustes,
  probado con 30k filas / 2,8 años; sin reason/context → no backfillea ratas especiales).
  _(El "descartado" del bloque v0.7.0 era el CSV de minería; el de wallet sí se hizo.)_
- **v0.15.0 — Comercio N3** (watchlist / libro / arbitraje).
- **v0.16.1 — Comercio N4 (buscador de oportunidades)**: `scan_opportunities` en 2 fases +
  `market_groups.json`. **Roadmap de Comercio cerrado** (N1–N4). Todo con ESI legal.
- **Intel en vivo v1+v2 COMPLETO** (el candidato "0" del bloque v0.8.0): watcher Rust del chat log
  (UTF-16LE) + `classifyIntel` (ship_names.json del SDE) + notificación nativa + trayectoria +
  hostiles habituales + `clr` silencia; encapsulado en `useIntel.ts` (validado en vivo 2026-07-01).
  Pendiente menor: contador +N en banner/notificación.
- **Refactor COMPLETO (fases 1–12)** — cierra el punto 5: App.tsx **5493→1794 líneas (−67%)**;
  todas las vistas en su fichero; mapa en módulos (mapRoute/mapOverlays/jumpCalc) + hooks por
  feature (useJumpPlanner/useRoutePlanner/useHuntTrack/useIntel). Opcional: extraer `useAppData()`.
- **Fix patrimonio**: blueprints fuera de la valoración (`est_value_clean`, 828B→217B) + top por valor.
- **Hardening (2026-07-02, de la revisión)**: CSP definida en `tauri.conf.json` (antes `null`),
  User-Agent con versión dinámica (`CARGO_PKG_VERSION`), ventana por defecto 1280×800 (mín 960×600).

### Pendiente REAL (orden recomendado)
0. **⭐ BITÁCORA FASE 1 — IMPLEMENTADA (2026-07-02, pendiente QA y release 0.18.0).**
   La piedra angular: como FC no expone logros/oportunidades por ESI, **los generamos nosotros
   del histórico local**. Motor en `src-tauri/src/db/bitacora.rs` + vista `src/bitacora.tsx`
   (categoría 📖): 4 retos adaptativos del mes (baseline = tu mes anterior, objetivo escala
   1-2-5) + 12 logros bronce/plata/oro con fecha de desbloqueo RETROACTIVA. Detalle y Fase 2 en
   `../documentacion/koru-desktop-BITACORA_HANDOFF.md`.
1. **Bitácora Fase 2**: QA del catálogo (umbrales/fechas) → notificación nativa al desbloquear →
   Diario (timeline de la historia jugada + `corporationhistory` público) → medallas in-game
   (`read_medals`) → LP/misiones (`read_loyalty`). Retos de corp por fichero: futuro puente.
2. **Ansiblex en rutas** — sigue bloqueado por el archivo de la red de puentes de la alianza.
3. **Repo público + firma de código** (SignPath Foundation) — mitiga SmartScreen.
4. Menores: contador +N intel · `useAppData()` · tematización por evento · feed de noticias ·
   merge de BD de dos PCs · Fabricación (aplazada).
5. Del patrón del mapa oficial aún sin adoptar (comparativa en
   `../documentacion/koru-desktop-REVISION_2026-07-02.md` §8, fuera del repo):
   breadcrumb hover Región/Constelación/Sistema · barras de control FW (Caldari/Gallente,
   Minmatar/Amarr) · sub-filtro "franja de seguridad" · minimapa/inset al hacer zoom.
6. De EVE Carbon aún sin adoptar: calculadora de refinado/ore · biblioteca de blueprints ME/TE
   (ligada a Fabricación) · timers de PI (Planetología hoy es básica).

---

## 📌 Histórico — Estado v0.8.0 (2026-06-29)

> Resumen vivo por encima del histórico de abajo (que se conserva como contexto).

### Aplicado en v0.8.0
- **Jump planner avanzado**: selector de nave (56 del SDE) + skills JDC/JFC + rango efectivo
  (base×(1+0,2·JDC)) + destino con isótopos; selector de personaje (carga skills reales y marca naves
  propias); **fatiga** (cooldown + estimación). Validado contra Dotlan.
- **Mejoras de assets**: paginación resiliente (se arregló que faltaran naves —iban en páginas
  posteriores—), resolución de estructuras de jugador (scope read_structures + entre personajes),
  anidados en contenedores/naves, Asset Safety, columnas **Ubicación** y **Contenedor**, y **drill-down**
  (abrir contenedor/nave).
- **Gestor de fiteos local**: importar por **EFT** o **desde el juego** (ESI fittings); **visor circular**
  estilo ventana de fitting (nave al centro + slots en arco, hover con info) y **skill-check** contra el
  personaje activo (✅ puedes / lista de skills que faltan).
- ⚠️ **Scopes nuevos** (añadir en developers.eveonline.com + re-login): `esi-characters.read_fatigue.v1`,
  `esi-universe.read_structures.v1`, `esi-fittings.read_fittings.v1`.

### Aplicado recientemente (v0.1.2 → v0.7.0)
- ⭐ **Backup / restauración del histórico local (v0.7.0)**: desplegable **⚙️ Ajustes** en la
  topbar con **Crear copia de seguridad** (exporta la BD a un único `.sqlite3` vía `VACUUM INTO`,
  consistente aunque la app esté en uso) y **Restaurar** (valida que sea una BD de Koru, la deja
  en staging `*.sqlite3.restore` y reinicia; el reemplazo se aplica al arrancar con la BD cerrada,
  limpiando los sidecar `-wal`/`-shm`). Comandos `backup_db`/`restore_db`, `tauri-plugin-dialog`,
  `db_path` en `AppState`. Tokens siguen en el keychain → en un PC nuevo solo hay que re-loguear.
  El popup de Ajustes se posiciona con `fixed` recortado al viewport (no se corta en ventanas
  estrechas). Extras en el mismo menú: **ruta + tamaño de la BD** (`db_info`, incluye el `-wal`),
  **Abrir carpeta de datos** (`revealItemInDir`) y **"Última copia hace X"** (timestamp en
  localStorage). **Copias automáticas**: toggle + carpeta destino + frecuencia (diaria/semanal/al
  abrir) + rotación (conservar 7/14/30/todas); comando `auto_backup(dir, keep)` que hace `VACUUM INTO`
  con nombre `koru-autobackup-FECHA.sqlite3` y borra las antiguas; el frontend lo dispara al arrancar
  y cada hora si toca. _Resuelve el ítem CRÍTICO por completo._
  _Importador CSV (p. ej. minería desde Alliance Auth) DESCARTADO: AA no guarda más allá de los
  ~90 días de EVE, no aporta sobre el histórico que ya acumulamos en local._
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
- **Selector de tema** persistido (Nebulosa/Amarr/Caldari/Gallente/Minmatar/Abismo; `data-theme` + localStorage).
- **i18n ES/EN** — framework `src/i18n.ts` (`t()` por string-fuente + selector persistido) y **chrome traducida**
  (navegación, cabeceras, pie, botones). Cuerpos de vista: pendiente (incremental).
- **Personaje "header rico"** — atributos (5 + remaps), implantes (con icono/nombre), jump clones,
  sec status, fecha de nacimiento y bio. `esi/character.rs` + `get_character_detail`. Scopes de
  clones/implantes añadidos.
- **PvE — Factional** (`/fw/stats`, scope `esi-characters.read_fw_stats.v1`): facción, rango, enlistado,
  kills y victory points (ayer/semana/total). **PvE — Abyssals** (estimación honesta): runs e ISK por
  **compras de filamentos** en las transacciones de wallet (`wallet/transactions/` + match por nombre).
- **Zoom de rueda en el mapa arreglado + cómodo**: el listener no se enganchaba hasta cargar el SDE
  (deps `[ne]`); ahora se "arma" por **permanencia del cursor (~140 ms) o clic**, sin robar el scroll de página.
- **Friends & Foes (completo)** — **Contactos** (lista con standing + info pública + logos) y **Standings
  NPC** (facciones/corps/agentes) en el grupo Personaje (`get_contacts`/`get_standings`, scopes nuevos).
  **Capa de mapa "Standings NPC"**: colorea cada sistema por **tu standing con la facción NPC que lo
  controla** (verde↔rojo), incluido **highsec** — `public/system-factions.json` generado del **SDE**
  (facción por constelación/región). Útil para misioneros.
- **Scrub temporal (PvP + Wallet)**: gráfica de tendencia con **ventana deslizante** (2 sliders) +
  selector **Año/Mes** + botón "Todo"; los **KPIs se recalculan** para el tramo elegido (sombreado).
  PvP por defecto en **Gráfica**. Wallet usa serie mensual nueva (`wallet_trend`).
- **Transacciones persistidas**: tabla `wallet_transactions` que **acumula** (como journal/mining);
  `sync_transactions` en cada sync (manual + auto-sync). **Abyssals** ahora lee del **histórico
  guardado** (crece con el tiempo), no solo de la ventana de ESI.
- **Releases v0.1.2 → v0.6.0** publicadas; auto-update verificado y **multicapa** (arranque + 6h + foco);
  **instancia única**; `workflow_dispatch` (botón manual) en el workflow como red de seguridad.

> **Convención de versiones (semver):** subimos el **minor** (`0.X.0`) cuando el lote añade *features*
> nuevas (p. ej. v0.3.0 = Contactos, v0.4.0 = capa de standings en el mapa), y el **patch** (`0.x.y`)
> para fixes/ajustes (p. ej. v0.2.1 = arreglo del zoom de rueda). El auto-update compara numéricamente.

### Pendiente (orden por prioridad)

✅ **HECHO (v0.7.0) — Backup / restauración del histórico local** (vía ⚙️ Ajustes) **+ auto-backup
periódico** (carpeta + frecuencia + rotación, también hecho en v0.7.0). Pendiente como mejora futura:
**merge de dos PCs** (dedupe por id: journal/killmails/transacciones por id, mining por clave
compuesta). Cero servidor nuestro.

★★ **SIGUIENTE — NAVEGACIÓN (próxima release, decidido 2026-06-29):**
- 👉 **Accionable ya — Wormholes / Thera / Turnur (estilo eve-scout)**: capa de mapa con las
  conexiones públicas de `api.eve-scout.com` (fetch nativo desde el backend Tauri, sin CORS).
  Fase 1 = mostrar la info en el mapa (sistemas con conexión Thera/Turnur, in/out, vida/masa).
  Fase 2 (más gorda) = rutar a través de wormholes (origen→sistema con WH→Thera→salida→destino).
  Es lo primero a hacer porque NO depende de nada externo del usuario.
- ⏳ **Bloqueado — Ansiblex en rutas**: importar un archivo con la red de jump bridges de la alianza
  (pares de sistemas) y añadir esas aristas al grafo de Dijkstra para que el planificador use los
  puentes. Esperando a que el usuario consiga el archivo → al tenerlo, pasar una muestra para fijar
  el formato del parser.

0. **★ NUEVO CANDIDATO DE CABEZA — Capa de Intel en vivo en el mapa** (research en
   `docs/RESEARCH_MAPA_INTEL.md`): leer el **log de chat** del juego (`Documents/EVE/logs/Chatlogs/`,
   UTF-16LE), parsear avisos "sistema · piloto · nave", pintar **círculos rojos por recencia** en el
   mapa, **proximidad por saltos** (Dijkstra que ya tenemos) y **alarma/notificación si entra a ≤N
   saltos** + panel "intel reciente" con enlace zKill. Read-only y TOS-safe. Es lo más pedido por la
   comunidad y explota toda nuestra base (grafo+overlays+zKill). _Decidir en próxima sesión si va antes
   que el jump planner._ Complementos baratos: **anillos de proximidad** y **modo Hunting** (reusan
   grafo/overlays); **notificaciones nativas** (infra reusable: intel + skill queue <24 h).
   **Multiboxing: DESCARTADO** (decisión del usuario).
- ✅ **Auto-refresh de la vista al sincronizar (v0.7.0)** — al terminar cualquier sync (auto de 30 min
  o ⟳ manual) se recarga la vista activa (`loadTab(subject, tab)` + header + mapa) en **modo silencioso**
  (`loadTab(..., silent=true)`: sin skeleton de carga, sin borrar/lanzar errores) para no resetear
  scroll/selección. El listado de killmails NO se recarga a propósito (evita resetear la paginación).
  El scrub solo se reajusta si cambia el nº de puntos (semana/mes nuevo), no en cada refresco.
1. **Jump planner avanzado** — ✅ COMPLETO (v0.8.0-dev):
   - ✅ **Rango + fuel por nave y skills**: `public/jumpships.json` (59 naves de salto extraídas del
     SDE: rango base LY attr 867, fuel/LY attr 868, isótopo attr 866, agrupadas por clase). Panel de
     salto con selector de nave, niveles **JDC** (Jump Drive Calibration, **+20% rango/nivel**, ×2 a V
     — SDE attr 870) y **JFC** (Jump Fuel Conservation, −10% fuel/nivel — SDE attr 1296). Rango
     efectivo = base×(1+0,20·JDC) autorrellena la
     burbuja; destino por click (1º origen, 2º destino) o buscador → distancia LY + isótopos
     necesarios + aviso fuera de rango. **Selector de personaje** (`get_jump_profile`): autorrellena
     JDC/JFC con los niveles reales del pj y **marca con ★ + ordena primero las naves que posee**
     (cruce con assets). El campo Rango se **bloquea** (dato calculado) al elegir nave; editable solo
     en modo manual. Sin scope nuevo (reusa skills + assets).
   - ✅ **Fatiga**: `get_fatigue` (`/characters/{id}/fatigue/`, scope `esi-characters.read_fatigue.v1`
     añadido a `config::scopes::FATIGUE` + `core_v1`). Muestra fatiga actual (minutos del timer azul,
     contador cada 30 s) y estima el salto al destino: cooldown=max(1+LY, fatiga/10) [máx 30 min],
     fatiga nueva=max(10·(1+LY), fatiga·(1+LY)) [máx 5 h] (fórmula EVE Uni); JF/Rorqual marcan que
     reducen fatiga (bono de rol, mostramos el máximo). Si falta el scope, hint para re-loguear.
     **OJO**: hay que añadir el scope en developers.eveonline.com y re-loguear (Conceder acceso).
   - ✅ **Bug de assets resuelto** (afectaba al ★ y a la pestaña Assets/mapa): (a) paginación
     **resiliente** (`assets::fetch_all_assets`, reintenta cada página y no abandona ante un error
     transitorio; usado por summary/detail/by_system/owned_type_ids) → ya no se pierden assets de
     páginas posteriores; (b) **estructuras de jugador**: faltaba el scope `esi-universe.read_structures.v1`
     (las NPC son endpoint público, por eso sí salían) → añadido a `ASSETS`/`core_v1`; (c) la caché
     **negativa** (system_id=0) se limpia al arrancar (`location_system_clear_negative`) para reintentar
     con el scope nuevo. **Requiere añadir el scope en developers.eveonline.com + re-login.**
   - Nota: assets en **hangares de corp** siguen sin contar (son corp assets, no personales);
     requeriría `esi-assets.read_corporation_assets.v1` + rol Director. Fuera de alcance.
2. **i18n — completar** la traducción de los textos dentro de cada vista (mecánico, incremental).
3. ~~**Iconos reales de EVE en el mapa**~~ — VALORADO y APLAZADO: recargaría el mapa (5.485 sistemas)
   y en POI los círculos de color comunican mejor que iconos arbitrarios. Alternativa futura: iconos en
   el **panel del sistema al hacer clic** (necesita datos de estaciones/estructuras por sistema vía ESI).
4. **Tematización por evento** (sobre el selector de temas ya hecho).
- ✅ **Fix iconos de blueprints** (post-v0.8.0): componente `TypeIcon` con fallback a `/bp` (el endpoint
  `/icon` no existe para planos → salían rotos); usado en Assets, Comercio y top-tipos.
- ✅ **Gráficas a más vistas**: ya estaban en Wallet/Assets/Patrimonio/Rateo/Minería; añadidas **barras
  de top-rivales** en Rivales. Pendiente menor: Skills e Industria (necesitan algo más de datos).
5. **Refactor pasada 2**: mover `MapView` y vistas a sus propios archivos.
6. **Feed de noticias** (RSS CCP/comunidad) + hitos históricos.
7. **Firma de código** (SignPath Foundation, gratis para OSS) para mitigar SmartScreen.
8. **Fabricación** (APLAZADO por complejidad: blueprints, materiales, ME/TE): split de Industria con
   su propia vista. Se retoma más adelante.

#### Apuntes / ideas surgidas
- **Rangos de FW por facción**: hoy se muestra el rango como número; mapear a nombre por facción (cosmético).
- **Abyssals fiable** necesita persistir transacciones (ventana ESI es corta); además distinguir tier/clima
  por el nombre del filamento daría desglose por dificultad.
- **Resolver nombres de ubicación** (home clone, estaciones) reutilizando el patrón de Assets Fase B.
- **i18n incremental**: ir traduciendo vista por vista; el diccionario `i18n.ts` ya admite añadir claves.
- **Capa de standings**: hoy colorea por tu standing; opción futura = **sub-filtro "territorio NPC"**
  (colorear por facción que controla, sin standing) reusando el mismo `system-factions.json`. Regenerar
  ese archivo si CCP cambia la asignación de facciones (script ad-hoc desde el SDE en `documentacion/sde-source`).

### Ideas / visión recogidas
- **Norte de diseño = dashboard "Koru Alliance Auth"** (capturas en `../documentacion/koru alliance auth/`):
  lo **personal** se replica en local (Resumen/Ingresos/Gastos/PvP/Actividad/Minería con periodo y vs
  anterior). Lo **de corp** (leaderboards de alianza, Kill Feed, top enemigos) **NO es local-first** →
  queda para el tool web (ecosistema koru_stats/Baserow), no para Koru Desktop.
- **Filosofía local-first reforzada**: conservar en el PC lo que ESI olvida (sincronizar con frecuencia).
- **Menú de features de comunidad** en `docs/COMUNIDAD_FEATURES.md` (notas de RoGiz7 + contraste con lo
  que ya tenemos). Candidatos nuevos destacados a evaluar: **intel/local scanner** (pegar local →
  zKill → clasificar amenazas; cuidado TOS = solo portapapeles), **alertas de skill queue (<24 h)**,
  **calculadora de inyectores**, **calculadora de refinado**, **aviso de orden superada** en Comercio,
  **modo overlay "siempre al frente"**. Pesados/aplazables: ship fitting (existe Pyfa), build-vs-buy
  (ligado a Fabricación), multi-boxing. **Pendiente: nuestra propia búsqueda en la comunidad** para
  priorizar con datos reales antes de comprometer módulos grandes.

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

### ★ Reestructuración de navegación (propuesta RoGiz7, 2026-06-25)

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
