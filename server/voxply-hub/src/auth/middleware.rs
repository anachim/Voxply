use std::sync::Arc;

use axum::extract::FromRequestParts;
use axum::http::StatusCode;
use axum::http::request::Parts;

use crate::state::AppState;

pub struct AuthUser {
    pub public_key: String,
}

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

        let public_key: Option<String> =
            sqlx::query_scalar("SELECT public_key FROM sessions WHERE token = ?")
                .bind(token)
                .fetch_optional(&state.db)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

        let public_key = public_key
            .ok_or((StatusCode::UNAUTHORIZED, "Invalid or expired token".to_string()))?;

        Ok(AuthUser { public_key })
    }
}
