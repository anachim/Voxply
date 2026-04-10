use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct ChallengeRequest {
    pub public_key: String,
}

#[derive(Deserialize)]
pub struct ChallengeResponse {
    pub challenge: String,
}

#[derive(Serialize)]
pub struct VerifyRequest {
    pub public_key: String,
    pub challenge: String,
    pub signature: String,
}

#[derive(Deserialize)]
pub struct VerifyResponse {
    pub token: String,
}

#[derive(Deserialize)]
pub struct MeResponse {
    pub public_key: String,
    pub display_name: Option<String>,
}

#[derive(Deserialize, Clone)]
pub struct ChannelResponse {
    pub id: String,
    pub name: String,
    pub created_by: String,
    pub created_at: String,
}

#[derive(Deserialize, Clone)]
pub struct MessageResponse {
    pub id: String,
    pub channel_id: String,
    pub sender: String,
    pub sender_name: Option<String>,
    pub content: String,
    pub created_at: String,
}

#[derive(Serialize)]
pub struct SendMessageRequest {
    pub content: String,
}

#[derive(Serialize)]
#[serde(tag = "type")]
pub enum WsClientMessage {
    #[serde(rename = "subscribe")]
    Subscribe { channel_id: String },
    #[serde(rename = "unsubscribe")]
    Unsubscribe { channel_id: String },
}

#[derive(Deserialize)]
pub struct WsServerMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub channel_id: String,
    pub message: MessageResponse,
}
