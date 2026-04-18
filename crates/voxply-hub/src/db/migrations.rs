use anyhow::Result;
use sqlx::SqlitePool;

pub async fn run(pool: &SqlitePool) -> Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS users (
            public_key    TEXT PRIMARY KEY,
            display_name  TEXT,
            first_seen_at INTEGER NOT NULL,
            last_seen_at  INTEGER NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS sessions (
            token      TEXT PRIMARY KEY,
            public_key TEXT NOT NULL REFERENCES users(public_key),
            created_at INTEGER NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS channels (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL UNIQUE,
            created_by TEXT NOT NULL REFERENCES users(public_key),
            created_at INTEGER NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS messages (
            id         TEXT PRIMARY KEY,
            channel_id TEXT NOT NULL REFERENCES channels(id),
            sender     TEXT NOT NULL REFERENCES users(public_key),
            content    TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS peers (
            public_key TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            url        TEXT NOT NULL,
            added_at   INTEGER NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS federated_channels (
            id              TEXT PRIMARY KEY,
            peer_public_key TEXT NOT NULL REFERENCES peers(public_key),
            remote_id       TEXT NOT NULL,
            name            TEXT NOT NULL,
            created_at      INTEGER NOT NULL,
            last_synced_at  INTEGER NOT NULL,
            UNIQUE(peer_public_key, remote_id)
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS federated_messages (
            id             TEXT PRIMARY KEY,
            fed_channel_id TEXT NOT NULL REFERENCES federated_channels(id),
            remote_id      TEXT NOT NULL,
            sender         TEXT NOT NULL,
            content        TEXT NOT NULL,
            created_at     INTEGER NOT NULL,
            UNIQUE(fed_channel_id, remote_id)
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS roles (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL UNIQUE,
            priority   INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS role_permissions (
            role_id    TEXT NOT NULL REFERENCES roles(id),
            permission TEXT NOT NULL,
            PRIMARY KEY (role_id, permission)
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS user_roles (
            user_public_key TEXT NOT NULL REFERENCES users(public_key),
            role_id         TEXT NOT NULL REFERENCES roles(id),
            assigned_at     INTEGER NOT NULL,
            PRIMARY KEY (user_public_key, role_id)
        )",
    )
    .execute(pool)
    .await?;

    // Seed built-in roles
    sqlx::query(
        "INSERT OR IGNORE INTO roles (id, name, priority, created_at) VALUES ('builtin-everyone', '@everyone', 0, 0)",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "INSERT OR IGNORE INTO roles (id, name, priority, created_at) VALUES ('builtin-owner', 'Owner', 999999, 0)",
    )
    .execute(pool)
    .await?;

    sqlx::query("INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('builtin-everyone', 'send_messages')")
        .execute(pool).await?;
    sqlx::query("INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('builtin-everyone', 'read_messages')")
        .execute(pool).await?;
    sqlx::query("INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('builtin-owner', 'admin')")
        .execute(pool).await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS bans (
            target_public_key TEXT PRIMARY KEY REFERENCES users(public_key),
            banned_by  TEXT NOT NULL,
            reason     TEXT,
            created_at INTEGER NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS mutes (
            target_public_key TEXT PRIMARY KEY REFERENCES users(public_key),
            muted_by   TEXT NOT NULL,
            reason     TEXT,
            expires_at INTEGER,
            created_at INTEGER NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS invites (
            code       TEXT PRIMARY KEY,
            created_by TEXT NOT NULL,
            max_uses   INTEGER,
            uses       INTEGER NOT NULL DEFAULT 0,
            expires_at INTEGER,
            created_at INTEGER NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    // Hub settings (key-value store for simple config)
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS hub_settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    // Default: hub is open (no invite required)
    sqlx::query("INSERT OR IGNORE INTO hub_settings (key, value) VALUES ('invite_only', 'false')")
        .execute(pool)
        .await?;

    sqlx::query(
        "INSERT OR IGNORE INTO hub_settings (key, value) VALUES ('min_security_level', '0')",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS alliances (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            created_by TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS alliance_members (
            alliance_id    TEXT NOT NULL REFERENCES alliances(id),
            hub_public_key TEXT NOT NULL,
            hub_name       TEXT NOT NULL,
            hub_url        TEXT NOT NULL,
            joined_at      INTEGER NOT NULL,
            PRIMARY KEY (alliance_id, hub_public_key)
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS alliance_shared_channels (
            alliance_id TEXT NOT NULL REFERENCES alliances(id),
            channel_id  TEXT NOT NULL REFERENCES channels(id),
            shared_at   INTEGER NOT NULL,
            PRIMARY KEY (alliance_id, channel_id)
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS channel_bans (
            channel_id TEXT NOT NULL REFERENCES channels(id),
            target_public_key TEXT NOT NULL REFERENCES users(public_key),
            banned_by TEXT NOT NULL,
            reason TEXT,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (channel_id, target_public_key)
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS voice_mutes (
            target_public_key TEXT PRIMARY KEY REFERENCES users(public_key),
            muted_by TEXT NOT NULL,
            reason TEXT,
            created_at INTEGER NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    // Add min_talk_power column to channels (0 = anyone can talk)
    // Using a separate table since ALTER TABLE IF NOT EXISTS isn't clean in SQLite
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS channel_settings (
            channel_id      TEXT PRIMARY KEY REFERENCES channels(id),
            min_talk_power  INTEGER NOT NULL DEFAULT 0
        )",
    )
    .execute(pool)
    .await?;

    // Conversations (DM / group DM) — only tracks members, NOT message content
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS conversations (
            id         TEXT PRIMARY KEY,
            conv_type  TEXT NOT NULL DEFAULT 'dm',
            created_at INTEGER NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS conversation_members (
            conversation_id TEXT NOT NULL REFERENCES conversations(id),
            public_key      TEXT NOT NULL REFERENCES users(public_key),
            joined_at       INTEGER NOT NULL,
            PRIMARY KEY (conversation_id, public_key)
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS friends (
            user_a TEXT NOT NULL REFERENCES users(public_key),
            user_b TEXT NOT NULL REFERENCES users(public_key),
            status TEXT NOT NULL DEFAULT 'pending',
            created_at INTEGER NOT NULL,
            PRIMARY KEY (user_a, user_b)
        )",
    )
    .execute(pool)
    .await?;

    tracing::info!("Database migrations complete");
    Ok(())
}
