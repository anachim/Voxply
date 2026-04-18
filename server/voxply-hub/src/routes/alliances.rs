use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::permissions::{self, ADMIN};
use crate::routes::alliance_models::*;
use crate::state::AppState;

pub async fn create_alliance(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(req): Json<CreateAllianceRequest>,
) -> Result<(StatusCode, Json<AllianceResponse>), (StatusCode, String)> {
    let perms = permissions::user_permissions(&state.db, &user.public_key).await?;
    perms.require(ADMIN)?;

    let id = Uuid::new_v4().to_string();
    let now = crate::auth::handlers::unix_timestamp();

    sqlx::query("INSERT INTO alliances (id, name, created_by, created_at) VALUES (?, ?, ?, ?)")
        .bind(&id)
        .bind(&req.name)
        .bind(&user.public_key)
        .bind(now)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    // Add this hub as the first member
    sqlx::query(
        "INSERT INTO alliance_members (alliance_id, hub_public_key, hub_name, hub_url, joined_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&state.hub_identity.public_key_hex())
    .bind(&state.hub_name)
    .bind("self")
    .bind(now)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    tracing::info!("Created alliance '{}'", req.name);

    Ok((
        StatusCode::CREATED,
        Json(AllianceResponse {
            id,
            name: req.name,
            created_by: user.public_key,
            created_at: now,
        }),
    ))
}

pub async fn list_alliances(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
) -> Result<Json<Vec<AllianceResponse>>, (StatusCode, String)> {
    let rows = sqlx::query_as::<_, AllianceRow>(
        "SELECT DISTINCT a.id, a.name, a.created_by, a.created_at
         FROM alliances a
         INNER JOIN alliance_members am ON a.id = am.alliance_id
         WHERE am.hub_public_key = ?
         ORDER BY a.created_at",
    )
    .bind(&state.hub_identity.public_key_hex())
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(Json(
        rows.into_iter()
            .map(|r| AllianceResponse {
                id: r.id,
                name: r.name,
                created_by: r.created_by,
                created_at: r.created_at,
            })
            .collect(),
    ))
}

pub async fn get_alliance(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
    Path(alliance_id): Path<String>,
) -> Result<Json<AllianceDetailResponse>, (StatusCode, String)> {
    let alliance = sqlx::query_as::<_, AllianceRow>(
        "SELECT id, name, created_by, created_at FROM alliances WHERE id = ?",
    )
    .bind(&alliance_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
    .ok_or((StatusCode::NOT_FOUND, "Alliance not found".to_string()))?;

    let members = sqlx::query_as::<_, MemberRow>(
        "SELECT hub_public_key, hub_name, hub_url, joined_at FROM alliance_members WHERE alliance_id = ?",
    )
    .bind(&alliance_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(Json(AllianceDetailResponse {
        id: alliance.id,
        name: alliance.name,
        created_by: alliance.created_by,
        created_at: alliance.created_at,
        members: members
            .into_iter()
            .map(|m| AllianceMemberInfo {
                hub_public_key: m.hub_public_key,
                hub_name: m.hub_name,
                hub_url: m.hub_url,
                joined_at: m.joined_at,
            })
            .collect(),
    }))
}

pub async fn share_channel(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(alliance_id): Path<String>,
    Json(req): Json<ShareChannelRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let perms = permissions::user_permissions(&state.db, &user.public_key).await?;
    perms.require(ADMIN)?;

    // Verify alliance exists
    let exists: Option<String> =
        sqlx::query_scalar("SELECT id FROM alliances WHERE id = ?")
            .bind(&alliance_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;
    if exists.is_none() {
        return Err((StatusCode::NOT_FOUND, "Alliance not found".to_string()));
    }

    // Verify channel exists
    let ch_exists: Option<String> =
        sqlx::query_scalar("SELECT id FROM channels WHERE id = ?")
            .bind(&req.channel_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;
    if ch_exists.is_none() {
        return Err((StatusCode::NOT_FOUND, "Channel not found".to_string()));
    }

    let now = crate::auth::handlers::unix_timestamp();

    sqlx::query(
        "INSERT OR IGNORE INTO alliance_shared_channels (alliance_id, channel_id, shared_at) VALUES (?, ?, ?)",
    )
    .bind(&alliance_id)
    .bind(&req.channel_id)
    .bind(now)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(StatusCode::OK)
}

pub async fn unshare_channel(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path((alliance_id, channel_id)): Path<(String, String)>,
) -> Result<StatusCode, (StatusCode, String)> {
    let perms = permissions::user_permissions(&state.db, &user.public_key).await?;
    perms.require(ADMIN)?;

    sqlx::query("DELETE FROM alliance_shared_channels WHERE alliance_id = ? AND channel_id = ?")
        .bind(&alliance_id)
        .bind(&channel_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_shared_channels(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
    Path(alliance_id): Path<String>,
) -> Result<Json<Vec<SharedChannelResponse>>, (StatusCode, String)> {
    // Get locally shared channels
    let rows = sqlx::query_as::<_, SharedChannelRow>(
        "SELECT asc_.channel_id, c.name as channel_name
         FROM alliance_shared_channels asc_
         INNER JOIN channels c ON asc_.channel_id = c.id
         WHERE asc_.alliance_id = ?",
    )
    .bind(&alliance_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    let hub_key = state.hub_identity.public_key_hex();

    Ok(Json(
        rows.into_iter()
            .map(|r| SharedChannelResponse {
                channel_id: r.channel_id,
                channel_name: r.channel_name,
                hub_public_key: hub_key.clone(),
                hub_name: state.hub_name.clone(),
            })
            .collect(),
    ))
}

pub async fn leave_alliance(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(alliance_id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let perms = permissions::user_permissions(&state.db, &user.public_key).await?;
    perms.require(ADMIN)?;

    let hub_key = state.hub_identity.public_key_hex();

    // Remove shared channels
    sqlx::query(
        "DELETE FROM alliance_shared_channels WHERE alliance_id = ? AND channel_id IN (SELECT id FROM channels)",
    )
    .bind(&alliance_id)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    // Remove membership
    sqlx::query("DELETE FROM alliance_members WHERE alliance_id = ? AND hub_public_key = ?")
        .bind(&alliance_id)
        .bind(&hub_key)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    // If no members left, delete the alliance
    let member_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM alliance_members WHERE alliance_id = ?")
            .bind(&alliance_id)
            .fetch_one(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    if member_count == 0 {
        sqlx::query("DELETE FROM alliances WHERE id = ?")
            .bind(&alliance_id)
            .execute(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;
    }

    Ok(StatusCode::NO_CONTENT)
}

// Invite: generate a signed token that another hub can use to join
pub async fn create_invite(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(alliance_id): Path<String>,
) -> Result<Json<AllianceInviteResponse>, (StatusCode, String)> {
    let perms = permissions::user_permissions(&state.db, &user.public_key).await?;
    perms.require(ADMIN)?;

    let alliance = sqlx::query_as::<_, AllianceRow>(
        "SELECT id, name, created_by, created_at FROM alliances WHERE id = ?",
    )
    .bind(&alliance_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
    .ok_or((StatusCode::NOT_FOUND, "Alliance not found".to_string()))?;

    // Sign the alliance_id with the hub's identity as the invite token
    let signature = state.hub_identity.sign(alliance_id.as_bytes());
    let token = hex::encode(signature.to_bytes());

    Ok(Json(AllianceInviteResponse {
        token,
        alliance_id: alliance.id,
        alliance_name: alliance.name,
        hub_url: format!("self"), // The receiving hub knows our URL from the API call
    }))
}

// Join: a remote hub calls this with an invite token to join the alliance
pub async fn join_alliance(
    State(state): State<Arc<AppState>>,
    Path(alliance_id): Path<String>,
    Json(req): Json<JoinAllianceRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    // Verify the invite token (signature of alliance_id by this hub)
    let sig_bytes = hex::decode(&req.invite_token)
        .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid invite token hex".to_string()))?;

    voxply_identity::verify_signature(
        &state.hub_identity.public_key_hex(),
        alliance_id.as_bytes(),
        &sig_bytes,
    )
    .map_err(|_| (StatusCode::FORBIDDEN, "Invalid invite token".to_string()))?;

    // Discover the joining hub's info
    let hub_info = state
        .federation_client
        .get_info(&req.hub_url)
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("Cannot reach hub: {e}")))?;

    let now = crate::auth::handlers::unix_timestamp();

    sqlx::query(
        "INSERT OR IGNORE INTO alliance_members (alliance_id, hub_public_key, hub_name, hub_url, joined_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&alliance_id)
    .bind(&hub_info.public_key)
    .bind(&hub_info.name)
    .bind(&req.hub_url)
    .bind(now)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    // Also peer with them if not already peered
    let peer_exists: Option<String> =
        sqlx::query_scalar("SELECT public_key FROM peers WHERE public_key = ?")
            .bind(&hub_info.public_key)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    if peer_exists.is_none() {
        sqlx::query("INSERT INTO peers (public_key, name, url, added_at) VALUES (?, ?, ?, ?)")
            .bind(&hub_info.public_key)
            .bind(&hub_info.name)
            .bind(&req.hub_url)
            .bind(now)
            .execute(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

        // Authenticate to peer
        if let Ok(token) = state
            .federation_client
            .authenticate(&req.hub_url, &state.hub_identity)
            .await
        {
            state
                .peer_tokens
                .write()
                .await
                .insert(hub_info.public_key.clone(), token);
        }
    }

    tracing::info!("Hub '{}' joined alliance {}", hub_info.name, &alliance_id[..8]);

    Ok(StatusCode::OK)
}

#[derive(sqlx::FromRow)]
struct AllianceRow {
    id: String,
    name: String,
    created_by: String,
    created_at: i64,
}

#[derive(sqlx::FromRow)]
struct MemberRow {
    hub_public_key: String,
    hub_name: String,
    hub_url: String,
    joined_at: i64,
}

#[derive(sqlx::FromRow)]
struct SharedChannelRow {
    channel_id: String,
    channel_name: String,
}
