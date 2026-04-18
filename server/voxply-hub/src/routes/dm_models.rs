use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct CreateConversationRequest {
    pub members: Vec<String>, // public keys of other participants (not including yourself)
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
}
