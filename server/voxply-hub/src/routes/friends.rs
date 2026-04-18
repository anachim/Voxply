use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::middleware::AuthUser;
use crate::state::AppState;

pub async fn send_friend_request(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(req): Json<FriendRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    if req.target_public_key == user.public_key {
        return Err((StatusCode::BAD_REQUEST, "Cannot friend yourself".to_string()));
    }

    let now = crate::auth::handlers::unix_timestamp();

    sqlx::query(
        "INSERT OR IGNORE INTO friends (user_a, user_b, status, created_at) VALUES (?, ?, 'pending', ?)",
    )
    .bind(&user.public_key)
    .bind(&req.target_public_key)
    .bind(now)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(StatusCode::CREATED)
}

pub async fn accept_friend_request(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(from_key): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    // The request was from `from_key` → `user.public_key`, update to accepted
    let result = sqlx::query(
        "UPDATE friends SET status = 'accepted' WHERE user_a = ? AND user_b = ? AND status = 'pending'",
    )
    .bind(&from_key)
    .bind(&user.public_key)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "No pending request from this user".to_string()));
    }

    Ok(StatusCode::OK)
}

pub async fn remove_friend(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(target_key): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    // Remove in both directions
    sqlx::query("DELETE FROM friends WHERE (user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?)")
        .bind(&user.public_key)
        .bind(&target_key)
        .bind(&target_key)
        .bind(&user.public_key)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_friends(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> Result<Json<Vec<FriendInfo>>, (StatusCode, String)> {
    let rows = sqlx::query_as::<_, FriendRow>(
        "SELECT
            CASE WHEN user_a = ? THEN user_b ELSE user_a END as friend_key,
            status, created_at
         FROM friends
         WHERE (user_a = ? OR user_b = ?) AND status = 'accepted'",
    )
    .bind(&user.public_key)
    .bind(&user.public_key)
    .bind(&user.public_key)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    let mut result = Vec::new();
    for row in rows {
        let display_name: Option<String> = sqlx::query_scalar(
            "SELECT display_name FROM users WHERE public_key = ?",
        )
        .bind(&row.friend_key)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
        .flatten();

        result.push(FriendInfo {
            public_key: row.friend_key,
            display_name,
            since: row.created_at,
        });
    }

    Ok(Json(result))
}

pub async fn list_pending_requests(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> Result<Json<Vec<FriendInfo>>, (StatusCode, String)> {
    // Requests sent TO this user (they can accept)
    let rows = sqlx::query_as::<_, FriendRow>(
        "SELECT user_a as friend_key, status, created_at
         FROM friends
         WHERE user_b = ? AND status = 'pending'",
    )
    .bind(&user.public_key)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    let mut result = Vec::new();
    for row in rows {
        let display_name: Option<String> = sqlx::query_scalar(
            "SELECT display_name FROM users WHERE public_key = ?",
        )
        .bind(&row.friend_key)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
        .flatten();

        result.push(FriendInfo {
            public_key: row.friend_key,
            display_name,
            since: row.created_at,
        });
    }

    Ok(Json(result))
}

#[derive(Deserialize)]
pub struct FriendRequest {
    pub target_public_key: String,
}

#[derive(Serialize)]
pub struct FriendInfo {
    pub public_key: String,
    pub display_name: Option<String>,
    pub since: i64,
}

#[derive(sqlx::FromRow)]
struct FriendRow {
    friend_key: String,
    status: String,
    created_at: i64,
}
