use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::middleware::AuthUser;
use crate::permissions::{self, ADMIN};
use crate::state::AppState;

/// Update the hub's branding: name, description, icon (all optional).
/// Requires the caller to have the admin permission.
pub async fn update_hub(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(req): Json<UpdateHubRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let perms = permissions::user_permissions(&state.db, &user.public_key).await?;
    perms.require(ADMIN)?;

    if let Some(name) = req.name.as_deref() {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err((StatusCode::BAD_REQUEST, "Name cannot be empty".to_string()));
        }
        upsert_setting(&state.db, "hub_name", trimmed).await?;
    }
    if let Some(description) = req.description.as_deref() {
        upsert_setting(&state.db, "hub_description", description).await?;
    }
    if let Some(icon) = req.icon.as_deref() {
        // Accept any string here — caller sends a base64 data URL or empty to clear.
        upsert_setting(&state.db, "hub_icon", icon).await?;
    }

    Ok(StatusCode::OK)
}

async fn upsert_setting(
    db: &sqlx::SqlitePool,
    key: &str,
    value: &str,
) -> Result<(), (StatusCode, String)> {
    sqlx::query(
        "INSERT INTO hub_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = ?",
    )
    .bind(key)
    .bind(value)
    .bind(value)
    .execute(db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;
    Ok(())
}

#[derive(Deserialize)]
pub struct UpdateHubRequest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct HubBranding {
    pub name: String,
    pub description: Option<String>,
    pub icon: Option<String>,
}

/// Read all three branding fields with fallback to the value seeded in AppState.
pub async fn read_branding(state: &AppState) -> HubBranding {
    let name = read_setting(&state.db, "hub_name")
        .await
        .unwrap_or_else(|| state.hub_name.clone());
    let description = read_setting(&state.db, "hub_description").await;
    let icon = read_setting(&state.db, "hub_icon").await;
    HubBranding { name, description, icon }
}

async fn read_setting(db: &sqlx::SqlitePool, key: &str) -> Option<String> {
    sqlx::query_scalar::<_, String>("SELECT value FROM hub_settings WHERE key = ?")
        .bind(key)
        .fetch_optional(db)
        .await
        .ok()
        .flatten()
}
