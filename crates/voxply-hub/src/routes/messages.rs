use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::permissions;
use crate::routes::chat_models::{
    ChatEvent, MessageResponse, PaginationParams, SendMessageRequest,
};
use crate::state::AppState;

pub async fn send_message(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(channel_id): Path<String>,
    Json(req): Json<SendMessageRequest>,
) -> Result<(StatusCode, Json<MessageResponse>), (StatusCode, String)> {
    let perms = permissions::user_permissions(&state.db, &user.public_key).await?;
    perms.require(permissions::SEND_MESSAGES)?;

    if crate::routes::moderation::is_muted(&state.db, &user.public_key).await? {
        return Err((StatusCode::FORBIDDEN, "You are muted".to_string()));
    }

    if crate::routes::moderation::is_channel_banned(&state.db, &channel_id, &user.public_key).await? {
        return Err((StatusCode::FORBIDDEN, "You are banned from this channel".to_string()));
    }

    let exists: Option<String> =
        sqlx::query_scalar("SELECT id FROM channels WHERE id = ?")
            .bind(&channel_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    if exists.is_none() {
        return Err((StatusCode::NOT_FOUND, "Channel not found".to_string()));
    }

    let id = Uuid::new_v4().to_string();
    let now = crate::auth::handlers::unix_timestamp();

    sqlx::query(
        "INSERT INTO messages (id, channel_id, sender, content, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&channel_id)
    .bind(&user.public_key)
    .bind(&req.content)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    let sender_name: Option<String> =
        sqlx::query_scalar("SELECT display_name FROM users WHERE public_key = ?")
            .bind(&user.public_key)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
            .flatten();

    let message = MessageResponse {
        id,
        channel_id: channel_id.clone(),
        sender: user.public_key,
        sender_name,
        content: req.content,
        created_at: now,
    };

    let _ = state.chat_tx.send(ChatEvent {
        channel_id,
        message: message.clone(),
    });

    Ok((StatusCode::CREATED, Json(message)))
}

pub async fn get_messages(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
    Path(channel_id): Path<String>,
    Query(params): Query<PaginationParams>,
) -> Result<Json<Vec<MessageResponse>>, (StatusCode, String)> {
    let limit = params.limit.unwrap_or(50).min(100);

    let rows = if let Some(before_id) = &params.before {
        sqlx::query_as::<_, MessageRow>(
            "SELECT m.id, m.channel_id, m.sender, u.display_name as sender_name, m.content, m.created_at
             FROM messages m LEFT JOIN users u ON m.sender = u.public_key
             WHERE m.channel_id = ? AND m.rowid < (SELECT rowid FROM messages WHERE id = ?)
             ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?",
        )
        .bind(&channel_id)
        .bind(before_id)
        .bind(limit)
        .fetch_all(&state.db)
        .await
    } else {
        sqlx::query_as::<_, MessageRow>(
            "SELECT m.id, m.channel_id, m.sender, u.display_name as sender_name, m.content, m.created_at
             FROM messages m LEFT JOIN users u ON m.sender = u.public_key
             WHERE m.channel_id = ?
             ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?",
        )
        .bind(&channel_id)
        .bind(limit)
        .fetch_all(&state.db)
        .await
    }
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    let messages = rows
        .into_iter()
        .map(|r| MessageResponse {
            id: r.id,
            channel_id: r.channel_id,
            sender: r.sender,
            sender_name: r.sender_name,
            content: r.content,
            created_at: r.created_at,
        })
        .collect();

    Ok(Json(messages))
}

#[derive(sqlx::FromRow)]
struct MessageRow {
    id: String,
    channel_id: String,
    sender: String,
    sender_name: Option<String>,
    content: String,
    created_at: i64,
}
