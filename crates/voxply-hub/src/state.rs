use std::collections::HashMap;
use std::time::Instant;

use sqlx::SqlitePool;
use tokio::sync::RwLock;

pub struct AppState {
    pub hub_name: String,
    pub db: SqlitePool,
    pub pending_challenges: RwLock<HashMap<String, PendingChallenge>>,
}

pub struct PendingChallenge {
    pub challenge_bytes: Vec<u8>,
    pub expires_at: Instant,
}
