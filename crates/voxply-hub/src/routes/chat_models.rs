use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct CreateChannelRequest {
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ChannelResponse {
    pub id: String,
    pub name: String,
    pub created_by: String,
    pub created_at: String,
}

#[derive(Serialize, Deserialize)]
pub struct SendMessageRequest {
    pub content: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MessageResponse {
    pub id: String,
    pub channel_id: String,
    pub sender: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Clone, Debug)]
pub struct ChatEvent {
    pub channel_id: String,
    pub message: MessageResponse,
}

#[derive(Deserialize)]
pub struct PaginationParams {
    pub before: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Deserialize)]
pub struct WsParams {
    pub token: String,
}

#[derive(Deserialize)]
#[serde(tag = "type")]
pub enum WsClientMessage {
    #[serde(rename = "subscribe")]
    Subscribe { channel_id: String },
    #[serde(rename = "unsubscribe")]
    Unsubscribe { channel_id: String },
}

#[derive(Serialize)]
pub struct WsServerMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub channel_id: String,
    pub message: MessageResponse,
}
