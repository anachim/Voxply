use std::sync::Arc;

use axum::extract::FromRequestParts;
use axum::http::StatusCode;
use axum::http::request::Parts;

use crate::state::AppState;

pub struct AuthUser {
    pub public_key: String,
}

/// Paths that pending (not-yet-approved) users are allowed to hit.
/// They can see their own status at /me and nothing else.
const PENDING_ALLOWED_PATHS: &[&str] = &["/me"];

impl FromRequestParts<Arc<AppState>> for AuthUser {
    type Rejection = (StatusCode, String);

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        let header = parts
            .headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .ok_or((StatusCode::UNAUTHORIZED, "Missing Authorization header".to_string()))?;

        let token = header
            .strip_prefix("Bearer ")
            .ok_or((StatusCode::UNAUTHORIZED, "Invalid Authorization format".to_string()))?;

        let row: Option<(String, String)> = sqlx::query_as(
            "SELECT s.public_key, u.approval_status
             FROM sessions s
             INNER JOIN users u ON s.public_key = u.public_key
             WHERE s.token = ?",
        )
        .bind(token)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

        let (public_key, approval_status) = row
            .ok_or((StatusCode::UNAUTHORIZED, "Invalid or expired token".to_string()))?;

        if approval_status == "pending" {
            let path = parts.uri.path();
            if !PENDING_ALLOWED_PATHS.iter().any(|p| path == *p) {
                return Err((
                    StatusCode::FORBIDDEN,
                    "Account is pending admin approval".to_string(),
                ));
            }
        }

        Ok(AuthUser { public_key })
    }
}
