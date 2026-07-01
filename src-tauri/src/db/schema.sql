-- Esquema inicial de Koru Desktop (SQLite).
-- Los refresh tokens NO viven aquí: van en el keychain del SO.

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
