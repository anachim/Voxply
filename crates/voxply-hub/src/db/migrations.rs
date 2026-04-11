use anyhow::Result;
use sqlx::SqlitePool;

pub async fn run(pool: &SqlitePool) -> Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS users (
            public_key  TEXT PRIMARY KEY,
            display_name TEXT,
            first_seen_at TEXT NOT NULL,
            last_seen_at  TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS sessions (
            token       TEXT PRIMARY KEY,
            public_key  TEXT NOT NULL REFERENCES users(public_key),
            created_at  TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS channels (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL UNIQUE,
            created_by  TEXT NOT NULL REFERENCES users(public_key),
            created_at  TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS messages (
            id          TEXT PRIMARY KEY,
            channel_id  TEXT NOT NULL REFERENCES channels(id),
            sender      TEXT NOT NULL REFERENCES users(public_key),
            content     TEXT NOT NULL,
            created_at  TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS peers (
            public_key  TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            url         TEXT NOT NULL,
            added_at    TEXT NOT NULL
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
            created_at      TEXT NOT NULL,
            last_synced_at  TEXT NOT NULL,
            UNIQUE(peer_public_key, remote_id)
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS federated_messages (
            id              TEXT PRIMARY KEY,
            fed_channel_id  TEXT NOT NULL REFERENCES federated_channels(id),
            remote_id       TEXT NOT NULL,
            sender          TEXT NOT NULL,
            content         TEXT NOT NULL,
            created_at      TEXT NOT NULL,
            UNIQUE(fed_channel_id, remote_id)
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS roles (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL UNIQUE,
            priority    INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL
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
            assigned_at     TEXT NOT NULL,
            PRIMARY KEY (user_public_key, role_id)
        )",
    )
    .execute(pool)
    .await?;

    // Seed built-in roles
    sqlx::query(
        "INSERT OR IGNORE INTO roles (id, name, priority, created_at)
         VALUES ('builtin-everyone', '@everyone', 0, '0')",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "INSERT OR IGNORE INTO roles (id, name, priority, created_at)
         VALUES ('builtin-owner', 'Owner', 999999, '0')",
    )
    .execute(pool)
    .await?;

    // Seed permissions for built-in roles
    sqlx::query("INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('builtin-everyone', 'send_messages')")
        .execute(pool).await?;
    sqlx::query("INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('builtin-everyone', 'read_messages')")
        .execute(pool).await?;
    sqlx::query("INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('builtin-owner', 'admin')")
        .execute(pool).await?;

    tracing::info!("Database migrations complete");
    Ok(())
}
