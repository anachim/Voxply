use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::middleware::AuthUser;
use crate::state::AppState;

pub async fn me(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> Result<Json<MeResponse>, (StatusCode, String)> {
    let display_name: Option<String> =
        sqlx::query_scalar("SELECT display_name FROM users WHERE public_key = ?")
            .bind(&user.public_key)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
            .flatten();

    Ok(Json(MeResponse {
        public_key: user.public_key,
        display_name,
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

    Ok(Json(MeResponse {
        public_key: user.public_key,
        display_name: Some(req.display_name),
    }))
}

#[derive(Serialize, Deserialize)]
pub struct MeResponse {
    pub public_key: String,
    pub display_name: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateMeRequest {
    pub display_name: String,
}
