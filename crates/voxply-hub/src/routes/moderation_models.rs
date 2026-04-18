use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct BanRequest {
    pub target_public_key: String,
    pub reason: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct BanResponse {
    pub target_public_key: String,
    pub banned_by: String,
    pub reason: Option<String>,
    pub created_at: String,
}

#[derive(Deserialize)]
pub struct MuteRequest {
    pub target_public_key: String,
    pub reason: Option<String>,
}

#[derive(Deserialize)]
pub struct TimeoutRequest {
    pub target_public_key: String,
    pub reason: Option<String>,
    pub duration_seconds: u64,
}

#[derive(Serialize, Deserialize)]
pub struct MuteResponse {
    pub target_public_key: String,
    pub muted_by: String,
    pub reason: Option<String>,
    pub expires_at: Option<String>,
    pub created_at: String,
}

#[derive(Deserialize)]
pub struct KickRequest {
    pub target_public_key: String,
}
