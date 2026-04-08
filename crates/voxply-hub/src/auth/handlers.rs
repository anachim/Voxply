use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use rand::RngCore;

use crate::auth::models::{ChallengeRequest, ChallengeResponse, VerifyRequest, VerifyResponse};
use crate::state::{AppState, PendingChallenge};

pub async fn challenge(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ChallengeRequest>,
) -> (StatusCode, Json<ChallengeResponse>) {
    let mut challenge_bytes = vec![0u8; 32];
    rand::thread_rng().fill_bytes(&mut challenge_bytes);
    let challenge_hex = hex::encode(&challenge_bytes);

    let pending = PendingChallenge {
        challenge_bytes,
        expires_at: Instant::now() + Duration::from_secs(60),
    };
    state
        .pending_challenges
        .write()
        .await
        .insert(req.public_key, pending);

    (
        StatusCode::OK,
        Json(ChallengeResponse {
            challenge: challenge_hex,
        }),
    )
}

pub async fn verify(
    State(state): State<Arc<AppState>>,
    Json(req): Json<VerifyRequest>,
) -> Result<Json<VerifyResponse>, (StatusCode, String)> {
    let pending = state
        .pending_challenges
        .write()
        .await
        .remove(&req.public_key)
        .ok_or((
            StatusCode::UNAUTHORIZED,
            "No pending challenge for this key".to_string(),
        ))?;

    if Instant::now() > pending.expires_at {
        return Err((StatusCode::UNAUTHORIZED, "Challenge expired".to_string()));
    }

    let challenge_bytes = hex::decode(&req.challenge)
        .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid challenge hex".to_string()))?;

    if challenge_bytes != pending.challenge_bytes {
        return Err((StatusCode::UNAUTHORIZED, "Challenge mismatch".to_string()));
    }

    let signature_bytes = hex::decode(&req.signature)
        .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid signature hex".to_string()))?;

    voxply_identity::verify_signature(&req.public_key, &challenge_bytes, &signature_bytes)
        .map_err(|_| (StatusCode::UNAUTHORIZED, "Invalid signature".to_string()))?;

    let now = unix_timestamp();

    sqlx::query(
        "INSERT INTO users (public_key, first_seen_at, last_seen_at)
         VALUES (?, ?, ?)
         ON CONFLICT(public_key) DO UPDATE SET last_seen_at = ?",
    )
    .bind(&req.public_key)
    .bind(&now)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    let token = hex::encode({
        let mut bytes = vec![0u8; 32];
        rand::thread_rng().fill_bytes(&mut bytes);
        bytes
    });

    sqlx::query("INSERT INTO sessions (token, public_key, created_at) VALUES (?, ?, ?)")
        .bind(&token)
        .bind(&req.public_key)
        .bind(&now)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    tracing::info!("User authenticated: {}", &req.public_key[..16]);

    Ok(Json(VerifyResponse { token }))
}

pub fn unix_timestamp() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    format!("{secs}")
}
