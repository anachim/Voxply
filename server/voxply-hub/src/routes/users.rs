use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::middleware::AuthUser;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct UserSearchParams {
    pub q: Option<String>,
}

#[derive(Serialize)]
pub struct UserInfo {
    pub public_key: String,
    pub display_name: Option<String>,
    pub online: bool,
}

pub async fn list_users(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
    Query(params): Query<UserSearchParams>,
) -> Result<Json<Vec<UserInfo>>, (StatusCode, String)> {
    let online = state.online_users.read().await;

    let rows = if let Some(q) = &params.q {
        let search = format!("%{q}%");
        sqlx::query_as::<_, UserRow>(
            "SELECT public_key, display_name FROM users
             WHERE display_name LIKE ? OR public_key LIKE ?
             ORDER BY display_name, public_key LIMIT 50",
        )
        .bind(&search)
        .bind(&search)
        .fetch_all(&state.db)
        .await
    } else {
        sqlx::query_as::<_, UserRow>(
            "SELECT public_key, display_name FROM users ORDER BY display_name, public_key LIMIT 50",
        )
        .fetch_all(&state.db)
        .await
    }
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(Json(
        rows.into_iter()
            .map(|r| UserInfo {
                online: online.contains(&r.public_key),
                public_key: r.public_key,
                display_name: r.display_name,
            })
            .collect(),
    ))
}

pub async fn channel_members(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
    Path(channel_id): Path<String>,
) -> Result<Json<Vec<UserInfo>>, (StatusCode, String)> {
    // For now, all hub users can see all channels (no per-channel access control yet).
    // Return all users, marking who's online.
    // When channel bans exist, we filter out banned users.
    let online = state.online_users.read().await;

    let rows = sqlx::query_as::<_, UserRow>(
        "SELECT u.public_key, u.display_name FROM users u
         WHERE u.public_key NOT IN (
             SELECT target_public_key FROM channel_bans WHERE channel_id = ?
         )
         ORDER BY u.display_name, u.public_key",
    )
    .bind(&channel_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(Json(
        rows.into_iter()
            .map(|r| UserInfo {
                online: online.contains(&r.public_key),
                public_key: r.public_key,
                display_name: r.display_name,
            })
            .collect(),
    ))
}

#[derive(sqlx::FromRow)]
struct UserRow {
    public_key: String,
    display_name: Option<String>,
}
