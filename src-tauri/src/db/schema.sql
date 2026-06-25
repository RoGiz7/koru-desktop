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
    description    TEXT
);

CREATE INDEX IF NOT EXISTS idx_wj_char ON wallet_journal(character_id);
CREATE INDEX IF NOT EXISTS idx_wj_date ON wallet_journal(date);

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
