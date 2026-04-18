use std::collections::HashMap;
use std::net::SocketAddr;
use std::time::Instant;

use sqlx::SqlitePool;
use tokio::sync::{broadcast, RwLock};
use voxply_identity::Identity;

use crate::federation::client::FederationClient;
use crate::routes::chat_models::{ChatEvent, WsServerMessage};

#[derive(Clone, Debug, serde::Serialize)]
pub struct DmEvent {
    pub conversation_id: String,
    pub sender: String,
    pub sender_name: Option<String>,
    pub content: String,
    pub timestamp: i64,
}

pub struct AppState {
    pub hub_name: String,
    pub hub_identity: Identity,
    pub db: SqlitePool,
    pub pending_challenges: RwLock<HashMap<String, PendingChallenge>>,
    pub chat_tx: broadcast::Sender<ChatEvent>,
    pub federation_client: FederationClient,
    pub peer_tokens: RwLock<HashMap<String, String>>,
    // Voice: channel_id → {public_key → udp_addr}
    pub voice_channels: RwLock<HashMap<String, HashMap<String, SocketAddr>>>,
    pub voice_udp_port: u16,
    pub voice_event_tx: broadcast::Sender<(String, WsServerMessage)>,
    // DM relay: broadcast DMs to all WS clients (they filter by conversation membership)
    pub dm_tx: broadcast::Sender<DmEvent>,
    // Online users: public_key set (updated by WS connect/disconnect)
    pub online_users: RwLock<std::collections::HashSet<String>>,
}

pub struct PendingChallenge {
    pub challenge_bytes: Vec<u8>,
    pub expires_at: Instant,
}
