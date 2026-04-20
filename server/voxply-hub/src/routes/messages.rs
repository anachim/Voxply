use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::permissions;
use crate::routes::chat_models::{
    ChatEvent, EditMessageRequest, MessageResponse, PaginationParams, SendMessageRequest,
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
        edited_at: None,
    };

    let _ = state.chat_tx.send(ChatEvent::New {
        channel_id,
        message: message.clone(),
    });

    Ok((StatusCode::CREATED, Json(message)))
}

pub async fn edit_message(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path((channel_id, message_id)): Path<(String, String)>,
    Json(req): Json<EditMessageRequest>,
) -> Result<Json<MessageResponse>, (StatusCode, String)> {
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT sender, channel_id FROM messages WHERE id = ?",
    )
    .bind(&message_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    let (sender, msg_channel) = row
        .ok_or((StatusCode::NOT_FOUND, "Message not found".to_string()))?;
    if msg_channel != channel_id {
        return Err((StatusCode::NOT_FOUND, "Message not in this channel".to_string()));
    }
    if sender != user.public_key {
        return Err((StatusCode::FORBIDDEN, "You can only edit your own messages".to_string()));
    }

    let now = crate::auth::handlers::unix_timestamp();
    sqlx::query(
        "UPDATE messages SET content = ?, edited_at = ? WHERE id = ?",
    )
    .bind(&req.content)
    .bind(now)
    .bind(&message_id)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    let updated = load_message(&state, &message_id).await?;
    let _ = state.chat_tx.send(ChatEvent::Edited {
        channel_id: channel_id.clone(),
        message: updated.clone(),
    });
    Ok(Json(updated))
}

pub async fn delete_message(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path((channel_id, message_id)): Path<(String, String)>,
) -> Result<StatusCode, (StatusCode, String)> {
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT sender, channel_id FROM messages WHERE id = ?",
    )
    .bind(&message_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    let (sender, msg_channel) = row
        .ok_or((StatusCode::NOT_FOUND, "Message not found".to_string()))?;
    if msg_channel != channel_id {
        return Err((StatusCode::NOT_FOUND, "Message not in this channel".to_string()));
    }

    // Author can always delete their own. Others need manage_messages.
    if sender != user.public_key {
        let perms = permissions::user_permissions(&state.db, &user.public_key).await?;
        perms.require(permissions::MANAGE_MESSAGES)?;
    }

    sqlx::query("DELETE FROM messages WHERE id = ?")
        .bind(&message_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    let _ = state.chat_tx.send(ChatEvent::Deleted {
        channel_id,
        message_id,
    });

    Ok(StatusCode::NO_CONTENT)
}

async fn load_message(
    state: &AppState,
    message_id: &str,
) -> Result<MessageResponse, (StatusCode, String)> {
    let row = sqlx::query_as::<_, MessageRow>(
        "SELECT m.id, m.channel_id, m.sender, u.display_name as sender_name,
                m.content, m.created_at, m.edited_at
         FROM messages m LEFT JOIN users u ON m.sender = u.public_key
         WHERE m.id = ?",
    )
    .bind(message_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(MessageResponse {
        id: row.id,
        channel_id: row.channel_id,
        sender: row.sender,
        sender_name: row.sender_name,
        content: row.content,
        created_at: row.created_at,
        edited_at: row.edited_at,
    })
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
            "SELECT m.id, m.channel_id, m.sender, u.display_name as sender_name, m.content, m.created_at, m.edited_at
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
            "SELECT m.id, m.channel_id, m.sender, u.display_name as sender_name, m.content, m.created_at, m.edited_at
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
            edited_at: r.edited_at,
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
    edited_at: Option<i64>,
}
