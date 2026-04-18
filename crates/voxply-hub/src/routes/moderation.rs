use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;

use crate::auth::middleware::AuthUser;
use crate::permissions::{self, BAN_MEMBERS, KICK_MEMBERS, MUTE_MEMBERS, TIMEOUT_MEMBERS};
use crate::routes::moderation_models::*;
use crate::state::AppState;

async fn require_can_moderate(
    state: &AppState,
    actor_key: &str,
    target_key: &str,
    permission: &str,
) -> Result<(), (StatusCode, String)> {
    let actor_perms = permissions::user_permissions(&state.db, actor_key).await?;
    actor_perms.require(permission)?;

    let target_perms = permissions::user_permissions(&state.db, target_key).await?;
    if target_perms.max_priority >= actor_perms.max_priority {
        return Err((
            StatusCode::FORBIDDEN,
            "Cannot moderate a user with equal or higher priority".to_string(),
        ));
    }
    Ok(())
}

// --- Ban ---

pub async fn ban_user(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(req): Json<BanRequest>,
) -> Result<(StatusCode, Json<BanResponse>), (StatusCode, String)> {
    require_can_moderate(&state, &user.public_key, &req.target_public_key, BAN_MEMBERS).await?;

    let now = crate::auth::handlers::unix_timestamp();

    sqlx::query(
        "INSERT OR REPLACE INTO bans (target_public_key, banned_by, reason, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(&req.target_public_key)
    .bind(&user.public_key)
    .bind(&req.reason)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    // Delete their sessions so they're immediately logged out
    sqlx::query("DELETE FROM sessions WHERE public_key = ?")
        .bind(&req.target_public_key)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    tracing::info!("Banned user: {}", &req.target_public_key[..16]);

    Ok((
        StatusCode::CREATED,
        Json(BanResponse {
            target_public_key: req.target_public_key,
            banned_by: user.public_key,
            reason: req.reason,
            created_at: now,
        }),
    ))
}

pub async fn unban_user(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(target_key): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let perms = permissions::user_permissions(&state.db, &user.public_key).await?;
    perms.require(BAN_MEMBERS)?;

    sqlx::query("DELETE FROM bans WHERE target_public_key = ?")
        .bind(&target_key)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_bans(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> Result<Json<Vec<BanResponse>>, (StatusCode, String)> {
    let perms = permissions::user_permissions(&state.db, &user.public_key).await?;
    perms.require(BAN_MEMBERS)?;

    let rows = sqlx::query_as::<_, BanRow>(
        "SELECT target_public_key, banned_by, reason, created_at FROM bans ORDER BY created_at DESC",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(Json(
        rows.into_iter()
            .map(|r| BanResponse {
                target_public_key: r.target_public_key,
                banned_by: r.banned_by,
                reason: r.reason,
                created_at: r.created_at,
            })
            .collect(),
    ))
}

// --- Mute ---

pub async fn mute_user(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(req): Json<MuteRequest>,
) -> Result<(StatusCode, Json<MuteResponse>), (StatusCode, String)> {
    require_can_moderate(&state, &user.public_key, &req.target_public_key, MUTE_MEMBERS).await?;

    let now = crate::auth::handlers::unix_timestamp();

    sqlx::query(
        "INSERT OR REPLACE INTO mutes (target_public_key, muted_by, reason, expires_at, created_at) VALUES (?, ?, ?, NULL, ?)",
    )
    .bind(&req.target_public_key)
    .bind(&user.public_key)
    .bind(&req.reason)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    tracing::info!("Muted user: {}", &req.target_public_key[..16]);

    Ok((
        StatusCode::CREATED,
        Json(MuteResponse {
            target_public_key: req.target_public_key,
            muted_by: user.public_key,
            reason: req.reason,
            expires_at: None,
            created_at: now,
        }),
    ))
}

pub async fn unmute_user(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(target_key): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let perms = permissions::user_permissions(&state.db, &user.public_key).await?;
    perms.require(MUTE_MEMBERS)?;

    sqlx::query("DELETE FROM mutes WHERE target_public_key = ?")
        .bind(&target_key)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_mutes(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> Result<Json<Vec<MuteResponse>>, (StatusCode, String)> {
    let perms = permissions::user_permissions(&state.db, &user.public_key).await?;
    perms.require(MUTE_MEMBERS)?;

    let rows = sqlx::query_as::<_, MuteRow>(
        "SELECT target_public_key, muted_by, reason, expires_at, created_at FROM mutes ORDER BY created_at DESC",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(Json(
        rows.into_iter()
            .map(|r| MuteResponse {
                target_public_key: r.target_public_key,
                muted_by: r.muted_by,
                reason: r.reason,
                expires_at: r.expires_at,
                created_at: r.created_at,
            })
            .collect(),
    ))
}

// --- Timeout ---

pub async fn timeout_user(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(req): Json<TimeoutRequest>,
) -> Result<(StatusCode, Json<MuteResponse>), (StatusCode, String)> {
    require_can_moderate(&state, &user.public_key, &req.target_public_key, TIMEOUT_MEMBERS)
        .await?;

    let now = crate::auth::handlers::unix_timestamp();
    let now_secs: u64 = now.parse().unwrap_or(0);
    let expires_at = format!("{}", now_secs + req.duration_seconds);

    sqlx::query(
        "INSERT OR REPLACE INTO mutes (target_public_key, muted_by, reason, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&req.target_public_key)
    .bind(&user.public_key)
    .bind(&req.reason)
    .bind(&expires_at)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    tracing::info!(
        "Timed out user: {} for {}s",
        &req.target_public_key[..16],
        req.duration_seconds
    );

    Ok((
        StatusCode::CREATED,
        Json(MuteResponse {
            target_public_key: req.target_public_key,
            muted_by: user.public_key,
            reason: req.reason,
            expires_at: Some(expires_at),
            created_at: now,
        }),
    ))
}

// --- Kick ---

pub async fn kick_user(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(req): Json<KickRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    require_can_moderate(&state, &user.public_key, &req.target_public_key, KICK_MEMBERS).await?;

    // Delete their sessions to force re-auth
    sqlx::query("DELETE FROM sessions WHERE public_key = ?")
        .bind(&req.target_public_key)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    tracing::info!("Kicked user: {}", &req.target_public_key[..16]);

    Ok(StatusCode::OK)
}

// DB row types

#[derive(sqlx::FromRow)]
struct BanRow {
    target_public_key: String,
    banned_by: String,
    reason: Option<String>,
    created_at: String,
}

#[derive(sqlx::FromRow)]
struct MuteRow {
    target_public_key: String,
    muted_by: String,
    reason: Option<String>,
    expires_at: Option<String>,
    created_at: String,
}

// --- Helpers for enforcement (used by other modules) ---

pub async fn is_banned(db: &sqlx::SqlitePool, public_key: &str) -> Result<bool, (StatusCode, String)> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM bans WHERE target_public_key = ?",
    )
    .bind(public_key)
    .fetch_one(db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(count > 0)
}

pub async fn is_muted(db: &sqlx::SqlitePool, public_key: &str) -> Result<bool, (StatusCode, String)> {
    let now = crate::auth::handlers::unix_timestamp();

    // Check for permanent mute (no expires_at) or active timeout (expires_at > now)
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM mutes WHERE target_public_key = ? AND (expires_at IS NULL OR expires_at > ?)",
    )
    .bind(public_key)
    .bind(&now)
    .fetch_one(db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(count > 0)
}
