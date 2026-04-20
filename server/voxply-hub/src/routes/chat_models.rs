use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct CreateChannelRequest {
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub is_category: bool,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ChannelResponse {
    pub id: String,
    pub name: String,
    pub created_by: String,
    pub parent_id: Option<String>,
    pub is_category: bool,
    pub display_order: i64,
    pub description: Option<String>,
    pub created_at: i64,
}

#[derive(Serialize, Deserialize, Default)]
pub struct UpdateChannelRequest {
    #[serde(default)]
    pub description: Option<String>,
    /// Tri-state: absent = don't touch, `Some(Some(id))` = set parent,
    /// `Some(None)` = move to top level.
    #[serde(default, deserialize_with = "deserialize_some")]
    pub parent_id: Option<Option<String>>,
}

/// Lets us distinguish "field missing" from "field explicitly null" in JSON.
fn deserialize_some<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: serde::Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    serde::Deserialize::deserialize(deserializer).map(Some)
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
    pub sender_name: Option<String>,
    pub content: String,
    pub created_at: i64,
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
    #[serde(rename = "subscribe_all")]
    SubscribeAll,
    #[serde(rename = "voice_join")]
    VoiceJoin { channel_id: String, udp_port: u16 },
    #[serde(rename = "voice_leave")]
    VoiceLeave { channel_id: String },
    #[serde(rename = "voice_speaking")]
    VoiceSpeaking { channel_id: String, speaking: bool },
}

#[derive(Serialize, Clone)]
#[serde(tag = "type")]
pub enum WsServerMessage {
    #[serde(rename = "message")]
    ChatMessage {
        channel_id: String,
        message: MessageResponse,
    },
    #[serde(rename = "voice_joined")]
    VoiceJoined {
        channel_id: String,
        hub_udp_port: u16,
        participants: Vec<VoiceParticipantInfo>,
    },
    #[serde(rename = "voice_participant_joined")]
    VoiceParticipantJoined {
        channel_id: String,
        participant: VoiceParticipantInfo,
    },
    #[serde(rename = "voice_participant_left")]
    VoiceParticipantLeft {
        channel_id: String,
        public_key: String,
    },
    #[serde(rename = "voice_participant_speaking")]
    VoiceParticipantSpeaking {
        channel_id: String,
        public_key: String,
        speaking: bool,
    },
    #[serde(rename = "dm")]
    DirectMessage {
        conversation_id: String,
        sender: String,
        sender_name: Option<String>,
        content: String,
        timestamp: i64,
    },
}

#[derive(Serialize, Deserialize, Clone)]
pub struct VoiceParticipantInfo {
    pub public_key: String,
    pub display_name: Option<String>,
}
