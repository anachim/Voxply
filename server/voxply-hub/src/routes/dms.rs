use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::routes::dm_models::*;
use crate::state::{AppState, DmEvent};

pub async fn create_conversation(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(req): Json<CreateConversationRequest>,
) -> Result<(StatusCode, Json<ConversationResponse>), (StatusCode, String)> {
    if req.members.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Need at least one other member".to_string()));
    }

    let conv_type = if req.members.len() == 1 { "dm" } else { "group" };

    // For DMs (1-on-1), check if a conversation already exists between these two users
    if conv_type == "dm" {
        let existing = find_existing_dm(&state, &user.public_key, &req.members[0]).await?;
        if let Some(conv) = existing {
            return Ok((StatusCode::OK, Json(conv)));
        }
    }

    let id = Uuid::new_v4().to_string();
    let now = crate::auth::handlers::unix_timestamp();

    sqlx::query("INSERT INTO conversations (id, conv_type, created_at) VALUES (?, ?, ?)")
        .bind(&id)
        .bind(conv_type)
        .bind(now)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    // Add the creator
    sqlx::query("INSERT INTO conversation_members (conversation_id, public_key, joined_at) VALUES (?, ?, ?)")
        .bind(&id)
        .bind(&user.public_key)
        .bind(now)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    // Add other members
    for member_key in &req.members {
        sqlx::query("INSERT INTO conversation_members (conversation_id, public_key, joined_at) VALUES (?, ?, ?)")
            .bind(&id)
            .bind(member_key)
            .bind(now)
            .execute(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;
    }

    let mut all_members = req.members.clone();
    all_members.push(user.public_key);

    Ok((
        StatusCode::CREATED,
        Json(ConversationResponse {
            id,
            conv_type: conv_type.to_string(),
            members: all_members,
            created_at: now,
        }),
    ))
}

pub async fn list_conversations(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> Result<Json<Vec<ConversationResponse>>, (StatusCode, String)> {
    let rows = sqlx::query_as::<_, ConvRow>(
        "SELECT c.id, c.conv_type, c.created_at
         FROM conversations c
         INNER JOIN conversation_members cm ON c.id = cm.conversation_id
         WHERE cm.public_key = ?
         ORDER BY c.created_at DESC",
    )
    .bind(&user.public_key)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    let mut result = Vec::new();
    for row in rows {
        let members: Vec<String> = sqlx::query_scalar(
            "SELECT public_key FROM conversation_members WHERE conversation_id = ?",
        )
        .bind(&row.id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

        result.push(ConversationResponse {
            id: row.id,
            conv_type: row.conv_type,
            members,
            created_at: row.created_at,
        });
    }

    Ok(Json(result))
}

pub async fn send_dm(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(conversation_id): Path<String>,
    Json(req): Json<SendDmRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    // Verify user is a member of this conversation
    let is_member: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM conversation_members WHERE conversation_id = ? AND public_key = ?",
    )
    .bind(&conversation_id)
    .bind(&user.public_key)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    if is_member == 0 {
        return Err((StatusCode::FORBIDDEN, "Not a member of this conversation".to_string()));
    }

    // Get sender display name
    let sender_name: Option<String> = sqlx::query_scalar(
        "SELECT display_name FROM users WHERE public_key = ?",
    )
    .bind(&user.public_key)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
    .flatten();

    let now = crate::auth::handlers::unix_timestamp();

    // Broadcast via dm_tx — NOT stored in DB
    let _ = state.dm_tx.send(DmEvent {
        conversation_id,
        sender: user.public_key,
        sender_name,
        content: req.content,
        timestamp: now,
    });

    Ok(StatusCode::OK)
}

async fn find_existing_dm(
    state: &AppState,
    user_a: &str,
    user_b: &str,
) -> Result<Option<ConversationResponse>, (StatusCode, String)> {
    // Find a DM conversation that has exactly these two members
    let convs: Vec<String> = sqlx::query_scalar(
        "SELECT cm1.conversation_id FROM conversation_members cm1
         INNER JOIN conversation_members cm2 ON cm1.conversation_id = cm2.conversation_id
         INNER JOIN conversations c ON c.id = cm1.conversation_id
         WHERE cm1.public_key = ? AND cm2.public_key = ? AND c.conv_type = 'dm'",
    )
    .bind(user_a)
    .bind(user_b)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    for conv_id in convs {
        let member_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM conversation_members WHERE conversation_id = ?",
        )
        .bind(&conv_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

        if member_count == 2 {
            let conv = sqlx::query_as::<_, ConvRow>(
                "SELECT id, conv_type, created_at FROM conversations WHERE id = ?",
            )
            .bind(&conv_id)
            .fetch_one(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

            return Ok(Some(ConversationResponse {
                id: conv.id,
                conv_type: conv.conv_type,
                members: vec![user_a.to_string(), user_b.to_string()],
                created_at: conv.created_at,
            }));
        }
    }

    Ok(None)
}

#[derive(sqlx::FromRow)]
struct ConvRow {
    id: String,
    conv_type: String,
    created_at: i64,
}
