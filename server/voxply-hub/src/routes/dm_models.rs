use crate::routes::chat_models::Attachment;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Deserialize)]
pub struct CreateConversationRequest {
    pub members: Vec<String>, // public keys of other participants (not including yourself)
    /// Optional: where each remote member is reachable. Missing entries = local member.
    #[serde(default)]
    pub member_hubs: HashMap<String, String>,
}

#[derive(Serialize, Deserialize)]
pub struct ConversationResponse {
    pub id: String,
    pub conv_type: String,
    pub members: Vec<String>,
    pub created_at: i64,
}

#[derive(Deserialize)]
pub struct SendDmRequest {
    pub content: String,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DmMessageResponse {
    pub id: String,
    pub conversation_id: String,
    pub sender: String,
    pub sender_name: Option<String>,
    pub content: String,
    pub created_at: i64,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
}

/// Hub-to-hub DM delivery envelope (POST /federation/dm).
#[derive(Serialize, Deserialize)]
pub struct FederatedDmRequest {
    pub message_id: String,
    pub conversation_id: String,
    pub conv_type: String,
    pub sender: String,
    pub members: Vec<String>,
    pub content: String,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
    #[serde(default)]
    pub signature: Option<String>,
    pub created_at: i64,
}
