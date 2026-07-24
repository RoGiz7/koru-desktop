-- Esquema inicial de Koru Desktop (SQLite).
-- Los refresh tokens NO viven aquí: van en el keychain del SO.

-- Clave/valor para versionado de DATOS (distinto del esquema) y flags de migración.
-- Ej.: logi_data_version (versión de los agregados de logi reconstruidos del gamelog) y
-- logi_reparse_pending (target pendiente de reprocesar cuando haya logs). Ver db/mod.rs.
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);

-- Bitácora: desbloqueos de LOGROS propios (motor en db/bitacora.rs).
-- subject_id = character_id, o 0 para la vista Global. unlocked_at = fecha retroactiva
-- del hito (del histórico); seen_at = cuándo lo registró la app (para señalar los nuevos).
CREATE TABLE IF NOT EXISTS achievements_unlocked (
    subject_id  INTEGER NOT NULL,
    ach_id      TEXT NOT NULL,
    level       INTEGER NOT NULL,
    unlocked_at TEXT,
    seen_at     TEXT NOT NULL,
    PRIMARY KEY (subject_id, ach_id, level)
);

CREATE TABLE IF NOT EXISTS characters (
    character_id   INTEGER PRIMARY KEY,
    name           TEXT NOT NULL,
    scopes         TEXT,              -- scopes concedidos (claim scp, separados por espacio)
    added_at       TEXT NOT NULL,
    last_sync      TEXT
);

-- Control de caché por endpoint (ETag / expires) para respetar la caché de ESI.
CREATE TABLE IF NOT EXISTS esi_cache (
    character_id   INTEGER NOT NULL,
    endpoint       TEXT NOT NULL,
    etag           TEXT,
    expires        TEXT,
    payload        TEXT,              -- JSON crudo
    PRIMARY KEY (character_id, endpoint)
);

-- Killmails normalizados mínimos para stats de PvP.
CREATE TABLE IF NOT EXISTS killmails (
    killmail_id    INTEGER PRIMARY KEY,
    hash           TEXT,
    character_id   INTEGER NOT NULL,
    is_loss        INTEGER NOT NULL DEFAULT 0,  -- 0 kill, 1 loss
    ship_type_id   INTEGER,
    system_id      INTEGER,
    isk_value      REAL,
    killed_at      TEXT,
    solo           INTEGER NOT NULL DEFAULT 0,  -- 1 si el personaje fue el único atacante
    victim_ship_type_id INTEGER,                -- nave de la víctima
    victim_character_id INTEGER,                -- personaje de la víctima (para caza selectiva)
    victim_corporation_id INTEGER,             -- corp de la víctima
    char_damage    INTEGER,                     -- daño hecho por el personaje (en kills)
    final_blow     INTEGER NOT NULL DEFAULT 0,  -- 1 si el personaje dio el golpe final
    top_damage     INTEGER NOT NULL DEFAULT 0,  -- 1 si el personaje hizo el mayor daño
    raw            TEXT
);

CREATE INDEX IF NOT EXISTS idx_killmails_char ON killmails(character_id);
CREATE INDEX IF NOT EXISTS idx_killmails_killed_at ON killmails(killed_at);

-- Journal de cartera (wallet). id es el id de la entrada en ESI (único global).
CREATE TABLE IF NOT EXISTS wallet_journal (
    id             INTEGER PRIMARY KEY,
    character_id   INTEGER NOT NULL,
    date           TEXT,
    ref_type       TEXT,
    amount         REAL,
    balance        REAL,
    description    TEXT,
    reason          TEXT,
    context_id      INTEGER,
    context_id_type TEXT,
    first_party_id  INTEGER,
    second_party_id INTEGER
);

CREATE INDEX IF NOT EXISTS idx_wj_char ON wallet_journal(character_id);
CREATE INDEX IF NOT EXISTS idx_wj_date ON wallet_journal(date);

-- Transacciones de mercado acumuladas (ESI da ventana corta; aquí las conservamos).
CREATE TABLE IF NOT EXISTS wallet_transactions (
    transaction_id INTEGER PRIMARY KEY,
    character_id   INTEGER NOT NULL,
    date           TEXT,
    type_id        INTEGER,
    quantity       INTEGER,
    unit_price     REAL,
    is_buy         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_wt_char ON wallet_transactions(character_id);

-- Mining ledger acumulado (ESI solo da 90 días; aquí lo conservamos para histórico).
-- Una entrada = día + sistema + tipo de mineral (clave compuesta).
CREATE TABLE IF NOT EXISTS mining_ledger (
    character_id   INTEGER NOT NULL,
    date           TEXT NOT NULL,
    system_id      INTEGER NOT NULL,
    type_id        INTEGER NOT NULL,
    quantity       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, date, system_id, type_id)
);

CREATE INDEX IF NOT EXISTS idx_ml_char ON mining_ledger(character_id);
CREATE INDEX IF NOT EXISTS idx_ml_date ON mining_ledger(date);

-- Precios de mercado (endpoint público /markets/prices/). Un valor medio global por tipo.
-- Sirve para valorar assets y el patrimonio sin depender de fuentes de terceros.
CREATE TABLE IF NOT EXISTS market_prices (
    type_id        INTEGER PRIMARY KEY,
    average_price  REAL,
    adjusted_price REAL,
    updated_at     TEXT
);

-- Snapshots de patrimonio: un registro por personaje y día. Acumula histórico local
-- para dibujar la evolución del patrimonio más allá de lo que ESI retiene.
CREATE TABLE IF NOT EXISTS networth_snapshots (
    character_id   INTEGER NOT NULL,
    date           TEXT NOT NULL,            -- YYYY-MM-DD
    liquid         REAL NOT NULL DEFAULT 0,  -- ISK en cartera
    asset_value    REAL NOT NULL DEFAULT 0,  -- valor estimado de assets (precio medio)
    total          REAL NOT NULL DEFAULT 0,  -- liquid + asset_value
    taken_at       TEXT NOT NULL,            -- timestamp RFC3339 de la toma
    PRIMARY KEY (character_id, date)
);

CREATE INDEX IF NOT EXISTS idx_nw_date ON networth_snapshots(date);

-- Snapshots del inventario de "papeles" (loot redimible de abyssal/CRAB): un registro por
-- personaje, día y typeID. Como los assets no tienen fecha, acumulamos una foto diaria del stock
-- (cantidad + valor estimado a precio de mercado) para dibujar la evolución del valor en el tiempo.
CREATE TABLE IF NOT EXISTS paper_snapshots (
    character_id   INTEGER NOT NULL,
    date           TEXT NOT NULL,            -- YYYY-MM-DD
    type_id        INTEGER NOT NULL,         -- 48121 abyssal | 60459 crab
    qty            INTEGER NOT NULL DEFAULT 0,
    value          REAL NOT NULL DEFAULT 0,  -- qty * precio de mercado en el momento de la toma
    taken_at       TEXT NOT NULL,            -- timestamp RFC3339 de la toma
    PRIMARY KEY (character_id, date, type_id)
);
CREATE INDEX IF NOT EXISTS idx_paper_date ON paper_snapshots(date);

-- R2 (memoria de precios): histórico diario de mercado por región y tipo. Se alimenta de ESI
-- /markets/{region}/history/ (~400 días) y se persiste para ACUMULAR más allá de esa ventana y
-- servir la gráfica sin refetch. Un registro por (región, tipo, día). PK → idempotente al re-backfill.
CREATE TABLE IF NOT EXISTS price_history (
    region_id   INTEGER NOT NULL,
    type_id     INTEGER NOT NULL,
    date        TEXT NOT NULL,            -- YYYY-MM-DD
    average     REAL NOT NULL DEFAULT 0,
    highest     REAL NOT NULL DEFAULT 0,
    lowest      REAL NOT NULL DEFAULT 0,
    volume      INTEGER NOT NULL DEFAULT 0,
    order_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (region_id, type_id, date)
);

-- Caché persistente de resolución ubicación → sistema (estaciones NPC y estructuras de jugador).
-- system_id = 0 = "no resuelta" (negative cache): evita reintentar estructuras sin acceso (403) que
-- agotarían el error budget de ESI. Cada location_id se resuelve como mucho una vez.
CREATE TABLE IF NOT EXISTS location_system (
    location_id   INTEGER PRIMARY KEY,
    system_id     INTEGER NOT NULL DEFAULT 0,
    updated_at    TEXT
);

-- Caché persistente tipo → categoría (Naves, Ore, Módulos…), resuelta vía ESI una vez por tipo.
CREATE TABLE IF NOT EXISTS type_category (
    type_id    INTEGER PRIMARY KEY,
    category   TEXT NOT NULL,
    updated_at TEXT
);

-- Caché de clasificación de NPC (ratas) para el contador de "ratas especiales" del rateo.
-- klass: 'officer' | 'capital' | 'faction' | 'normal'. Resuelta vía ESI (tipo→grupo) una vez por tipo.
CREATE TABLE IF NOT EXISTS npc_class (
    type_id    INTEGER PRIMARY KEY,
    name       TEXT,
    klass      TEXT NOT NULL,
    updated_at TEXT
);

-- Caché persistente sistema → región (nombre). Resuelta una vez vía ESI; luego a prueba de
-- downtime (durante el downtime de TQ, /universe/systems da 504 — con esto no se reintenta).
CREATE TABLE IF NOT EXISTS system_region (
    system_id  INTEGER PRIMARY KEY,
    region     TEXT NOT NULL,
    updated_at TEXT
);

-- Índice local de nombres de personaje → id, para resolver pilotos del intel sin pegar a ESI.
-- character_id NULL = visto pero aún sin resolver; -1 = caché negativa (NO es personaje).
-- Se siembra de Rivales/killmails y se rellena al resolver por ESI (1 vez por nombre).
-- seen_count/last_seen permiten "hostiles habituales" y aprender objetivos del propio intel.
CREATE TABLE IF NOT EXISTS name_cache (
    name_lower    TEXT PRIMARY KEY,
    character_id  INTEGER,                 -- NULL=sin resolver · -1=no es personaje (negativa)
    display_name  TEXT,                    -- nombre canónico (de ESI) para mostrar
    kind          TEXT,                    -- 'character' | 'none'
    seen_count    INTEGER NOT NULL DEFAULT 0,
    first_seen    TEXT,
    last_seen     TEXT,
    last_system_id INTEGER,                 -- último sistema donde se le reportó (intel)
    updated_at    TEXT
);

-- Avistamientos de intel persistentes ("modo cazador"): cada vez que un piloto aparece en un
-- reporte se guarda (nombre, sistema, hora). Backbone para el rastro histórico entre sesiones.
-- PK dedup por (nombre, sistema, hora de la línea). character_id/ship_type_id = enriquecido si se sabe.
CREATE TABLE IF NOT EXISTS intel_sightings (
    name_lower    TEXT NOT NULL,
    character_id  INTEGER,                 -- resuelto si se conoce (NULL si no)
    system_id     INTEGER NOT NULL,
    ts_ms         INTEGER NOT NULL,        -- timestamp (ms) de la línea de intel
    ship_type_id  INTEGER,                 -- nave citada junto al piloto (futuro; NULL por ahora)
    PRIMARY KEY (name_lower, system_id, ts_ms)
);
CREATE INDEX IF NOT EXISTS idx_sight_name ON intel_sightings(name_lower, ts_ms);

-- Watchlist de mercado (Comercio → inteligencia de mercado): tipos que el usuario vigila.
-- Solo el typeID; el precio/spread/volumen se piden en vivo a ESI (públicos, cacheados).
CREATE TABLE IF NOT EXISTS market_watch (
    type_id    INTEGER PRIMARY KEY,
    added_at   TEXT NOT NULL             -- RFC3339 de cuándo se añadió
);

-- Gestor de fiteos local (propio): guarda fits importados por EFT. `modules` es JSON.
CREATE TABLE IF NOT EXISTS fits (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    ship_type_id  INTEGER NOT NULL,
    ship_name     TEXT NOT NULL,
    eft           TEXT NOT NULL,
    modules       TEXT NOT NULL,
    created_at    TEXT NOT NULL
);

-- Proyectos personales (Bitácora): metas propias definidas por el usuario, medidas del histórico
-- local. subject_id = character_id, o 0 = global. metric = clave de métrica (kills/damage/isk_
-- destruido/final_blows/solo_kills/sistemas/rateo/mineria/patrimonio); target = objetivo.
CREATE TABLE IF NOT EXISTS personal_projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id  INTEGER NOT NULL,
    name        TEXT NOT NULL,
    metric      TEXT NOT NULL,
    target      REAL NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    -- Filtro opcional: param_kind = ''|ship|ore|system; param_ids = CSV de typeID/systemID
    -- (multi-selección); param_name = etiqueta para mostrar.
    param_kind  TEXT NOT NULL DEFAULT '',
    param_id    INTEGER NOT NULL DEFAULT 0,
    param_ids   TEXT NOT NULL DEFAULT '',
    param_name  TEXT NOT NULL DEFAULT '',
    -- solo mineria: ''|value (valor mercado) | units | volume (m³) | reproceso (ISK reproc. 85%)
    mode        TEXT NOT NULL DEFAULT '',
    -- fecha (RFC3339) en que se alcanzó el objetivo; '' = aún activo.
    completed_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_pp_subject ON personal_projects(subject_id);

-- ===== Gamelogs de EVE (Fase B): datos ESI-invisibles parseados del log de combate local =====
-- Seguimiento de ficheros ya parseados para NO releer los 6,6 GB (lectura incremental por offset).
CREATE TABLE IF NOT EXISTS gamelog_parsed (
    filename    TEXT PRIMARY KEY,
    size        INTEGER NOT NULL DEFAULT 0,
    mtime       INTEGER NOT NULL DEFAULT 0,
    read_offset INTEGER NOT NULL DEFAULT 0  -- byte hasta donde se leyó (para el tail del activo)
);
-- Agregado de reparación remota (logi) por personaje/día/tipo/dirección. kind = shield|armor|hull;
-- direction = given (curado por ti) | received (curado a ti). hp = HP acumulados.
CREATE TABLE IF NOT EXISTS logi_ledger (
    character_id INTEGER NOT NULL,
    date         TEXT NOT NULL,
    kind         TEXT NOT NULL,
    direction    TEXT NOT NULL,
    hp           REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, date, kind, direction)
);
-- Histórico de pilotos REALES (solo personajes, formato [Nave] Piloto): a quién curaste (given) y de
-- quién recibiste (received), con HP total y por tipo, nº de reps, su nave y el módulo usado.
CREATE TABLE IF NOT EXISTS logi_pilots (
    character_id INTEGER NOT NULL,
    direction    TEXT NOT NULL,
    pilot        TEXT NOT NULL,
    hp           REAL NOT NULL DEFAULT 0,    -- total
    reps         INTEGER NOT NULL DEFAULT 0,
    ship         TEXT NOT NULL DEFAULT '',   -- última nave vista (para el icono)
    module       TEXT NOT NULL DEFAULT '',   -- último módulo de rep visto
    hp_shield    REAL NOT NULL DEFAULT 0,
    hp_armor     REAL NOT NULL DEFAULT 0,
    hp_hull      REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, direction, pilot)
);
-- Granular por día para desglosar la gráfica por personaje/nave/módulo × fecha. Solo personajes reales.
CREATE TABLE IF NOT EXISTS logi_daily (
    character_id INTEGER NOT NULL,
    direction    TEXT NOT NULL,
    date         TEXT NOT NULL,
    pilot        TEXT NOT NULL,
    ship         TEXT NOT NULL DEFAULT '',
    module       TEXT NOT NULL DEFAULT '',
    hp           REAL NOT NULL DEFAULT 0,
    reps         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, direction, date, pilot, ship, module)
);
-- Fase C — reconstrucción desde el gamelog (años de histórico que ESI no da). Agregados, no raw.
-- Minería por personaje/día/mena (nombre EN visible; se resuelve a type_id/icono con ores.json).
CREATE TABLE IF NOT EXISTS gamelog_mining (
    character_id INTEGER NOT NULL,
    date         TEXT NOT NULL,
    ore          TEXT NOT NULL,
    units        INTEGER NOT NULL DEFAULT 0,  -- base (ciclo normal)
    crit         INTEGER NOT NULL DEFAULT 0,  -- bonus de "extracción crítica" (Equinox); base+crit = ESI
    cycles       INTEGER NOT NULL DEFAULT 0,
    -- Residuo destruido, ATRIBUIDO A SU MENA. Solo existe en la era en que la línea de extracción
    -- trae el sufijo "…con un residuo perdido de N unidades". En la otra era el residuo va en línea
    -- aparte y sin mena (tabla `gamelog_mining_waste`). Nunca coexisten: no hay doble conteo.
    waste        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, date, ore)
);
-- Bounty (rateo) reconstruido: ISK y nº de pagos por personaje/día.
CREATE TABLE IF NOT EXISTS gamelog_bounty (
    character_id INTEGER NOT NULL,
    date         TEXT NOT NULL,
    isk          INTEGER NOT NULL DEFAULT 0,
    pays         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, date)
);
-- Saltos entre sistemas: nº de saltos por arista (origen→destino) y día. Distintos sistemas = de las
-- columnas from_sys/to_sys; total saltos = SUM(jumps).
CREATE TABLE IF NOT EXISTS gamelog_jumps (
    character_id INTEGER NOT NULL,
    date         TEXT NOT NULL,
    from_sys     TEXT NOT NULL,
    to_sys       TEXT NOT NULL,
    jumps        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, date, from_sys, to_sys)
);
-- Desperdicio de minería (residuo destruido) por personaje/día. LOG-ONLY: ESI no lo expone. Sin mena.
CREATE TABLE IF NOT EXISTS gamelog_mining_waste (
    character_id INTEGER NOT NULL,
    date         TEXT NOT NULL,
    units        INTEGER NOT NULL DEFAULT 0,
    cycles       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, date)
);
-- Combate por personaje/día (LOG-ONLY, ESI no lo da): daño hecho/recibido, nº de golpes y wrecking
-- ("Destruye") en cada dirección → permite DPS, daño in/out y % de golpes de gracia.
CREATE TABLE IF NOT EXISTS gamelog_combat (
    character_id INTEGER NOT NULL,
    date         TEXT NOT NULL,
    dmg_done     INTEGER NOT NULL DEFAULT 0,
    dmg_taken    INTEGER NOT NULL DEFAULT 0,
    shots_done   INTEGER NOT NULL DEFAULT 0,
    shots_taken  INTEGER NOT NULL DEFAULT 0,
    wrecks_done  INTEGER NOT NULL DEFAULT 0,
    wrecks_taken INTEGER NOT NULL DEFAULT 0,
    -- DPS: `active_secs` = segundos distintos con daño hecho (tiempo de combate real, no de sesión);
    -- `peak_dps` = daño máximo concentrado en un solo segundo. DPS medio = dmg_done / active_secs.
    active_secs  INTEGER NOT NULL DEFAULT 0,
    peak_dps     INTEGER NOT NULL DEFAULT 0,
    -- Disparos sin daño. `misses_done` = fallaste tú (ratio de acierto); `misses_taken` = te
    -- fallaron (evasión). El log registra AMBOS, con verbos distintos en cada idioma.
    misses_done  INTEGER NOT NULL DEFAULT 0,
    misses_taken INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, date)
);
-- Daño hecho por OBJETIVO (rata) y día → "ratas más batidas". LOG-ONLY.
CREATE TABLE IF NOT EXISTS gamelog_rats (
    character_id INTEGER NOT NULL,
    date         TEXT NOT NULL,
    rat          TEXT NOT NULL,
    dmg          INTEGER NOT NULL DEFAULT 0,
    shots        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, date, rat)
);

-- Daño, disparos y FALLOS por arma/módulo y día. El arma va en el penúltimo segmento de la línea de
-- combate y está en el 100% de los golpes dados. Con `misses` sale el ratio de acierto por arma:
-- medido en logs reales, Berserker II 92,9% frente a Curator II 41,7%. LOG-ONLY.
CREATE TABLE IF NOT EXISTS gamelog_weapons (
    character_id INTEGER NOT NULL,
    date         TEXT NOT NULL,
    weapon       TEXT NOT NULL,
    dmg          INTEGER NOT NULL DEFAULT 0,
    shots        INTEGER NOT NULL DEFAULT 0,
    misses       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, date, weapon)
);

-- Reparto de la CALIDAD del golpe (1..6, de peor a mejor), en cada dirección. La escala unifica ES y
-- EN por daño medio, no por traducción: 1 Roza/Grazes … 6 Destruye/Wrecks. LOG-ONLY.
CREATE TABLE IF NOT EXISTS gamelog_quality (
    character_id INTEGER NOT NULL,
    date         TEXT NOT NULL,
    quality      INTEGER NOT NULL,
    done         INTEGER NOT NULL DEFAULT 0,
    taken        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, date, quality)
);

-- PvP del gamelog (#45): daño/golpes/fallos contra ENTIDADES DE JUGADOR, cara a cara y por arma.
-- Cubre las peleas SIN killmail (zKill no las tiene). La firma `Nombre[TICKER](Nave)` separa
-- jugadores de ratas; kind: 1 nave · 2 dron/fighter (nombre == tipo) · 3 estructura (el nombre
-- lleva "SISTEMA - " delante). El gamelog NO dice tu propia nave (se cruza con killmails si hace
-- falta). LOG-ONLY. Fallos dados: solo si el nombre se vio como jugador en los GOLPES de la misma
-- sesión (el fallo va sin firma; no se adivina contra catálogo). Fallos recibidos: el atacante
-- jugador firma su arma en la línea; las ratas no.
CREATE TABLE IF NOT EXISTS gamelog_pvp (
    character_id INTEGER NOT NULL,
    date         TEXT NOT NULL,
    done         INTEGER NOT NULL,             -- 1 = tú a ellos · 0 = ellos a ti
    kind         INTEGER NOT NULL,             -- 1 nave · 2 dron/fighter · 3 estructura
    pilot        TEXT NOT NULL,                -- piloto (o "SISTEMA - nombre" si estructura)
    ticker       TEXT NOT NULL,                -- corp del otro
    ship         TEXT NOT NULL,                -- nave/tipo del otro ('' si solo se le vio fallar)
    weapon       TEXT NOT NULL DEFAULT '',     -- tu arma si done, la suya si no ('' si no consta)
    dmg          INTEGER NOT NULL DEFAULT 0,
    shots        INTEGER NOT NULL DEFAULT 0,
    wrecks       INTEGER NOT NULL DEFAULT 0,   -- golpes "Destruye"/Wrecks
    misses       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, date, done, kind, pilot, ticker, ship, weapon)
);

-- Fase D — lo mismo que gamelog_bounty/mining/combat pero ATRIBUIDO AL SISTEMA, cruzando la hora del
-- evento con la línea temporal del canal Local (ver `chatlog.rs`). Son tablas APARTE a propósito:
-- añadir `system` a la clave primaria de las existentes obligaría a recrearlas y migrar. Solo se
-- llenan cuando el gamelog encontró su sesión Local gemela; si no, el evento se queda sin sistema.
CREATE TABLE IF NOT EXISTS gamelog_bounty_sys (
    character_id INTEGER NOT NULL,
    date         TEXT NOT NULL,
    system       TEXT NOT NULL,
    isk          INTEGER NOT NULL DEFAULT 0,
    pays         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, date, system)
);
CREATE TABLE IF NOT EXISTS gamelog_mining_sys (
    character_id INTEGER NOT NULL,
    date         TEXT NOT NULL,
    system       TEXT NOT NULL,
    ore          TEXT NOT NULL,
    units        INTEGER NOT NULL DEFAULT 0,
    crit         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, date, system, ore)
);
CREATE TABLE IF NOT EXISTS gamelog_combat_sys (
    character_id INTEGER NOT NULL,
    date         TEXT NOT NULL,
    system       TEXT NOT NULL,
    dmg_done     INTEGER NOT NULL DEFAULT 0,
    dmg_taken    INTEGER NOT NULL DEFAULT 0,
    shots_done   INTEGER NOT NULL DEFAULT 0,
    shots_taken  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, date, system)
);

-- Rescate de restos por día. `failed` solo se llena en logs en inglés: el texto de fallo en español
-- no aparece en la muestra, así que en logs ES la tasa de éxito saldrá al 100%. LOG-ONLY.
CREATE TABLE IF NOT EXISTS gamelog_salvage (
    character_id INTEGER NOT NULL,
    date         TEXT NOT NULL,
    salvaged     INTEGER NOT NULL DEFAULT 0,
    failed       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, date)
);

-- Pulsos de módulos de mando (Mining Foreman Burst, etc.): cuántas veces y a cuántos de la flota.
CREATE TABLE IF NOT EXISTS gamelog_boosts (
    character_id INTEGER NOT NULL,
    date         TEXT NOT NULL,
    module       TEXT NOT NULL,
    pulses       INTEGER NOT NULL DEFAULT 0,
    members      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, date, module)
);

-- Diccionario ES→EN de nombres de rata, extraído del propio gamelog (`<localized hint="ES">EN`).
-- Los logs de los años en que el cliente estuvo en español guardan el nombre ES sin tag; con esto
-- los canonizamos al inglés AL CONSULTAR, en vez de duplicar la misma rata en dos filas.
CREATE TABLE IF NOT EXISTS gamelog_rat_alias (
    es TEXT PRIMARY KEY,
    en TEXT NOT NULL
);

-- F1c — Fichas de instalación. El registro de estructuras del fabricante.
--
-- POR QUÉ EXISTE: ESI no dice qué servicios ni qué rigs tiene una estructura (solo se lo cuenta a
-- un Director de la corp dueña vía /corporations/{id}/structures/), e IN-GAME tampoco se ven sin
-- roles. Así que el dato lo declara el usuario. Va a SQLite y no a localStorage a propósito: es
-- configuración cara de reunir y tiene que sobrevivir a restaurar una copia.
--
-- QUÉ GUARDAMOS Y QUÉ NO: aquí solo va lo que la máquina NO puede deducir. Los porcentajes NO se
-- guardan nunca — se derivan del SDE a partir de `type_id` (los 3 bonos de la estructura) y de
-- `rigs` (bono base × multiplicador de la seguridad del sistema). Pedir % a mano fue la trampa que
-- ya nos mordió: in-game hay tres bonos con el mismo nombre y el % del rig se muestra redondeado.
--
-- `structure_id` = el ID de ESI si la conocemos; NULL si es una ficha a mano (la de un aliado, o
-- una que aún no existe). No intentamos casar fichas con estructuras por sistema+tipo: no es único
-- (hay 8 Raitarus en un mismo sistema), y adivinar sería mentir.
CREATE TABLE IF NOT EXISTS facility (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    structure_id INTEGER,          -- ID de ESI, o NULL si es manual
    name         TEXT NOT NULL,
    system_id    INTEGER NOT NULL, -- de aquí salen el índice de coste (ESI) y la banda de seguridad
    type_id      INTEGER,          -- Sotiyo, Raitaru…: de aquí salen sus 3 bonos del SDE
    has_mfg      INTEGER NOT NULL DEFAULT 1, -- ¿planta de fabricación instalada? lo sabe el usuario
    rigs         TEXT NOT NULL DEFAULT '[]', -- JSON [typeID]: se resuelven contra el SDE al calcular
    -- Impuesto del centro: lo pone el dueño, nadie más lo sabe. ANULABLE a propósito:
    -- NULL = no lo has declarado · 0 = declaraste que no cobra nada. Son cosas distintas y la ficha
    -- solo está completa en el segundo caso. Muchas estructuras de alianza cobran 0 de verdad.
    tax          REAL,
    eligible     INTEGER NOT NULL DEFAULT 1, -- ¿sale en el desplegable del BOM?
    -- 'esi' descubierta | 'manual' escrita a mano. Sirve para decir de dónde sale cada dato.
    source       TEXT NOT NULL DEFAULT 'manual',
    notes        TEXT,
    updated_at   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS facility_structure ON facility(structure_id)
    WHERE structure_id IS NOT NULL;

-- Red de Ansiblex (jump bridges) de la alianza.
--
-- POR QUÉ ESTO ES UNA TABLA DECLARADA Y NO UN SYNC: ESI no expone la red. No hay endpoint ni scope
-- de Ansiblex; lo único que los enseña es `/corporations/{id}/structures` — que exige rol Director,
-- solo devuelve los de TU corp, y ni siquiera trae el destino (habría que deducirlo del nombre).
-- Para un piloto de línea no hay nada que sincronizar. El dato entra pegando la tabla que la
-- alianza publica en su wiki, y el piloto confirma lo que se guarda. Mismo principio que `facility`:
-- lo que la máquina no puede saber, lo declara el usuario, y se dice de dónde salió.
--
-- UNA FILA POR PUENTE, NO DOS. El wiki lista cada puente dos veces (una por extremo) porque cada
-- punta es una estructura distinta —con su propio dueño; 7 de los 97 de la Webway son de corps
-- diferentes—, pero para el grafo de rutas es UNA arista. Par canónico: a_id < b_id siempre.
--
-- LO QUE NO GUARDAMOS: los años luz. Se calculan de gx/gy/gz del SDE, que son más exactos que los
-- del wiki (que redondea a 2 decimales). Guardamos el declarado solo para poder CONTRASTARLO y
-- cazar erratas al pegar: en la red real la desviación máxima es 0,005 ly, así que cualquier cosa
-- por encima de 0,05 es un emparejamiento mal copiado.
CREATE TABLE IF NOT EXISTS ansiblex (
    a_id       INTEGER NOT NULL,  -- system_id del extremo A (SIEMPRE el menor de los dos)
    b_id       INTEGER NOT NULL,  -- system_id del extremo B
    a_name     TEXT NOT NULL,     -- copia del nombre: para poder enseñar la red sin cargar el SDE
    b_name     TEXT NOT NULL,
    ly_declared REAL,             -- el que decía la fuente; informativo/contraste, NO se usa a calcular
    owner_a    TEXT,              -- ticker de la corp dueña de cada punta (pueden diferir)
    owner_b    TEXT,
    route      TEXT,              -- etiqueta/color con la que la alianza nombra el corredor
    status     TEXT,              -- Online/Offline según la fuente
    source     TEXT NOT NULL DEFAULT 'paste',
    updated_at TEXT,
    PRIMARY KEY (a_id, b_id)
);

-- Firmas y anomalías del escáner de sondas, por sistema. El pegado del escáner NO trae el sistema
-- (igual que la tabla de Ansiblex no traía la región): lo pone el piloto. Clave = (sistema, id de
-- firma); el id ("QLO-590") es estable dentro del sistema hasta el downtime.
-- `note` es la anotación del piloto (p. ej. el destino de un wormhole) y se CONSERVA al re-pegar:
-- por eso el re-escaneo hace upsert por firma, no un borrado total del sistema.
CREATE TABLE IF NOT EXISTS signatures (
    system_id   INTEGER NOT NULL,
    sig_id      TEXT NOT NULL,           -- "QLO-590" (3 letras-guion-3 dígitos)
    sig_group   TEXT NOT NULL,           -- 'anomaly' | 'signature'
    kind        TEXT NOT NULL,           -- combat|ore|gas|data|relic|wormhole|unknown
    name        TEXT NOT NULL DEFAULT '',-- "Madriguera de los Ángeles" ('' si sin identificar)
    signal_pct  REAL,                    -- 0..100
    distance_au REAL,                    -- distancia en AU (unidad canónica)
    note        TEXT,                    -- anotación del piloto; NO se pierde al re-pegar
    first_seen  TEXT NOT NULL,           -- RFC3339 del primer avistamiento de esta firma
    last_seen   TEXT NOT NULL,           -- RFC3339 del último pegado que la incluía
    done_log_id INTEGER,                 -- enlace SUAVE a exploration_log (NULL = pendiente).
                                         -- Estado EFÍMERO de la lista viva: muere en el downtime
                                         -- igual que la firma. La verdad histórica vive en
                                         -- exploration_log. Se conserva al re-pegar (no está en el
                                         -- DO UPDATE SET del upsert). Ver koru-desktop-EXPLORACION_*.
    entered_at  TEXT,                    -- RFC3339 de cuándo ENTRASTE en el sitio (NULL = no dentro).
                                         -- Marca "estoy en ella". Al marcar «hecha» se sella la salida
                                         -- (done_at) y la duración = done_at − entered_at. Efímero
                                         -- como done_at: se conserva al re-pegar, muere en el downtime.
    PRIMARY KEY (system_id, sig_id)
);
CREATE INDEX IF NOT EXISTS idx_sig_system ON signatures(system_id);

-- Registro PERMANENTE de firmas COMPLETADAS ("hechas"). No caduca (a diferencia de `signatures`,
-- que rota en el downtime). Se llena SOLO al marcar una firma como hecha; independiente de la firma
-- viva, que puede desaparecer. `id` propio e INMUTABLE: (system_id, sig_id) NO sirve como clave
-- porque el sig_id se recicla entre sistemas y días. Todo lo demás es un SNAPSHOT congelado en el
-- momento de cerrar (la firma viva ya no existirá para releerlo). De aquí salen las estadísticas de
-- exploración y, más adelante, las medallas de explorador. Ver koru-desktop-EXPLORACION_HISTORICO_*.
CREATE TABLE IF NOT EXISTS exploration_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    system_id    INTEGER NOT NULL,
    system_name  TEXT NOT NULL DEFAULT '', -- congelado (el frontend lo resuelve del SDE al cerrar)
    sig_id       TEXT,                      -- "QLO-590" como referencia, NO clave
    kind         TEXT NOT NULL,             -- combat|ore|gas|data|relic|wormhole|unknown
    name         TEXT NOT NULL DEFAULT '',  -- nombre del sitio ('' si no se identificó)
    scanned_at   TEXT,                      -- first_seen de la firma viva (cuándo apareció)
    entered_at   TEXT,                      -- cuándo entraste (NULL si no marcaste entrada); con
                                            -- done_at da la DURACIÓN dentro del sitio
    done_at      TEXT NOT NULL,             -- RFC3339 de cuándo se marcó hecha = SALIDA (evento)
    loot_isk     REAL,                      -- valor total estimado del botín (nullable)
    loot_note    TEXT,                      -- texto libre / pegado del inventario (MVP)
    note         TEXT,                      -- notas del piloto sobre el sitio
    character_id INTEGER                    -- quién lo hizo (NULL si sin personaje; Global = todos)
);
CREATE INDEX IF NOT EXISTS idx_explog_system ON exploration_log(system_id);
CREATE INDEX IF NOT EXISTS idx_explog_done   ON exploration_log(done_at);
CREATE INDEX IF NOT EXISTS idx_explog_char   ON exploration_log(character_id);

-- Runs de actividad CRONOMETRADAS con botín: abisales (por filamento) y CRAB. MISMO patrón que
-- exploration_log (sesión + cronómetro + loot pegado/valorado), pero para actividades con TIEMPO. Da lo
-- que el asset-diff de abyssals NO puede: ISK/hora por tier/clima, tasa de muerte y P&L honesto (loot −
-- naves perdidas). `ended_at` NULL = sesión ABIERTA (en curso; sobrevive a cerrar Koru a mitad de run).
-- Ver documentacion/koru-desktop-ABYSSAL_CRAB_RUNS_diseno.md.
CREATE TABLE IF NOT EXISTS activity_runs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    activity      TEXT NOT NULL,            -- 'abyssal' | 'crab'
    variant_id    INTEGER,                  -- typeID del filamento (o beacon CRAB) → icono + tier/clima
    variant_name  TEXT NOT NULL DEFAULT '', -- snapshot ("Raging Gamma Filament")
    tier          TEXT,                     -- Calm..Cataclysmic (T1-T6), derivado del filamento
    weather       TEXT,                     -- Dark|Electrical|Exotic|Firestorm|Gamma (null en CRAB)
    system_id     INTEGER,
    system_name   TEXT NOT NULL DEFAULT '',
    ship_type_id  INTEGER,                  -- nave usada (opcional)
    started_at    TEXT NOT NULL,            -- inicio de la sesión (cronómetro)
    ended_at      TEXT,                     -- NULL = en curso; al terminar da la duración
    outcome       TEXT NOT NULL DEFAULT 'open', -- open | done | died | aborted
    loot_isk      REAL,                     -- valor del botín (del pegado, como exploración)
    loot_note     TEXT,
    ship_loss_isk REAL,                     -- si outcome='died': valor de la nave+fit perdidos (P&L)
    note          TEXT,
    character_id  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_runs_activity ON activity_runs(activity);
CREATE INDEX IF NOT EXISTS idx_runs_ended    ON activity_runs(ended_at);
CREATE INDEX IF NOT EXISTS idx_runs_char     ON activity_runs(character_id);
