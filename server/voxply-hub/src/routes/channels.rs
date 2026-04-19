use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::permissions;
use crate::routes::chat_models::{ChannelResponse, CreateChannelRequest};
use crate::state::AppState;

pub async fn create_channel(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(req): Json<CreateChannelRequest>,
) -> Result<(StatusCode, Json<ChannelResponse>), (StatusCode, String)> {
    let perms = permissions::user_permissions(&state.db, &user.public_key).await?;
    perms.require(permissions::MANAGE_CHANNELS)?;

    // Validate parent if specified
    if let Some(parent_id) = &req.parent_id {
        let parent_is_category: Option<i64> = sqlx::query_scalar(
            "SELECT is_category FROM channels WHERE id = ?",
        )
        .bind(parent_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

        match parent_is_category {
            None => return Err((StatusCode::NOT_FOUND, "Parent channel not found".to_string())),
            Some(0) => return Err((StatusCode::BAD_REQUEST, "Parent must be a category".to_string())),
            _ => {}
        }
    }

    let id = Uuid::new_v4().to_string();
    let now = crate::auth::handlers::unix_timestamp();
    let is_category_int = if req.is_category { 1i64 } else { 0 };

    sqlx::query(
        "INSERT INTO channels (id, name, created_by, parent_id, is_category, created_at)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&req.name)
    .bind(&user.public_key)
    .bind(&req.parent_id)
    .bind(is_category_int)
    .bind(now)
    .execute(&state.db)
    .await
    .map_err(|e| {
        if e.to_string().contains("UNIQUE") {
            (StatusCode::CONFLICT, format!("Channel '{}' already exists", req.name))
        } else {
            (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}"))
        }
    })?;

    Ok((
        StatusCode::CREATED,
        Json(ChannelResponse {
            id,
            name: req.name,
            created_by: user.public_key,
            parent_id: req.parent_id,
            is_category: req.is_category,
            created_at: now,
        }),
    ))
}

pub async fn list_channels(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
) -> Result<Json<Vec<ChannelResponse>>, (StatusCode, String)> {
    let rows = sqlx::query_as::<_, ChannelRow>(
        "SELECT id, name, created_by, parent_id, is_category, created_at FROM channels ORDER BY is_category DESC, created_at",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    let channels = rows
        .into_iter()
        .map(|r| ChannelResponse {
            id: r.id,
            name: r.name,
            created_by: r.created_by,
            parent_id: r.parent_id,
            is_category: r.is_category != 0,
            created_at: r.created_at,
        })
        .collect();

    Ok(Json(channels))
}

pub async fn delete_channel(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(channel_id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let perms = permissions::user_permissions(&state.db, &user.public_key).await?;
    perms.require(permissions::MANAGE_CHANNELS)?;

    // Check if channel exists
    let exists: Option<i64> = sqlx::query_scalar(
        "SELECT is_category FROM channels WHERE id = ?",
    )
    .bind(&channel_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    if exists.is_none() {
        return Err((StatusCode::NOT_FOUND, "Channel not found".to_string()));
    }

    // Check for children (prevent deleting non-empty categories)
    let child_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM channels WHERE parent_id = ?",
    )
    .bind(&channel_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    if child_count > 0 {
        return Err((
            StatusCode::CONFLICT,
            "Cannot delete: category still has channels".to_string(),
        ));
    }

    // Clean up related data
    sqlx::query("DELETE FROM messages WHERE channel_id = ?")
        .bind(&channel_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    sqlx::query("DELETE FROM channel_bans WHERE channel_id = ?")
        .bind(&channel_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    sqlx::query("DELETE FROM channel_settings WHERE channel_id = ?")
        .bind(&channel_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    sqlx::query("DELETE FROM alliance_shared_channels WHERE channel_id = ?")
        .bind(&channel_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    sqlx::query("DELETE FROM channels WHERE id = ?")
        .bind(&channel_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(StatusCode::NO_CONTENT)
}

#[derive(sqlx::FromRow)]
struct ChannelRow {
    id: String,
    name: String,
    created_by: String,
    parent_id: Option<String>,
    is_category: i64,
    created_at: i64,
}
