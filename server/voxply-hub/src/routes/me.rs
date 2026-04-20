use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::middleware::AuthUser;
use crate::routes::role_models::RoleResponse;
use crate::state::AppState;

pub async fn me(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> Result<Json<MeResponse>, (StatusCode, String)> {
    let row: Option<(Option<String>, String)> = sqlx::query_as(
        "SELECT display_name, approval_status FROM users WHERE public_key = ?",
    )
    .bind(&user.public_key)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    let (display_name, approval_status) = row
        .unwrap_or((None, "approved".to_string()));

    let roles = fetch_user_roles(&state.db, &user.public_key).await?;

    Ok(Json(MeResponse {
        public_key: user.public_key,
        display_name,
        approval_status,
        roles,
    }))
}

pub async fn update_me(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(req): Json<UpdateMeRequest>,
) -> Result<Json<MeResponse>, (StatusCode, String)> {
    sqlx::query("UPDATE users SET display_name = ? WHERE public_key = ?")
        .bind(&req.display_name)
        .bind(&user.public_key)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    let roles = fetch_user_roles(&state.db, &user.public_key).await?;

    let approval_status: String = sqlx::query_scalar(
        "SELECT approval_status FROM users WHERE public_key = ?",
    )
    .bind(&user.public_key)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
    .unwrap_or_else(|| "approved".to_string());

    Ok(Json(MeResponse {
        public_key: user.public_key,
        display_name: Some(req.display_name),
        approval_status,
        roles,
    }))
}

async fn fetch_user_roles(
    db: &sqlx::SqlitePool,
    public_key: &str,
) -> Result<Vec<RoleResponse>, (StatusCode, String)> {
    let roles = sqlx::query_as::<_, RoleRow>(
        "SELECT r.id, r.name, r.priority, r.display_separately, r.created_at
         FROM roles r
         INNER JOIN user_roles ur ON r.id = ur.role_id
         WHERE ur.user_public_key = ?
         ORDER BY r.priority DESC",
    )
    .bind(public_key)
    .fetch_all(db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    let mut result = Vec::new();
    for role in roles {
        let perms: Vec<String> =
            sqlx::query_scalar("SELECT permission FROM role_permissions WHERE role_id = ?")
                .bind(&role.id)
                .fetch_all(db)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

        result.push(RoleResponse {
            id: role.id,
            name: role.name,
            permissions: perms,
            priority: role.priority,
            display_separately: role.display_separately != 0,
            created_at: role.created_at,
        });
    }
    Ok(result)
}

#[derive(Serialize, Deserialize)]
pub struct MeResponse {
    pub public_key: String,
    pub display_name: Option<String>,
    #[serde(default = "default_approval_status")]
    pub approval_status: String,
    #[serde(default)]
    pub roles: Vec<RoleResponse>,
}

fn default_approval_status() -> String {
    "approved".to_string()
}

#[derive(Deserialize)]
pub struct UpdateMeRequest {
    pub display_name: String,
}

#[derive(sqlx::FromRow)]
struct RoleRow {
    id: String,
    name: String,
    priority: i64,
    display_separately: i64,
    created_at: i64,
}
