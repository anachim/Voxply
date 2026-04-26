use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct CreateAllianceRequest {
    pub name: String,
}

#[derive(Serialize, Deserialize)]
pub struct AllianceResponse {
    pub id: String,
    pub name: String,
    pub created_by: String,
    pub created_at: i64,
}

#[derive(Serialize, Deserialize)]
pub struct AllianceDetailResponse {
    pub id: String,
    pub name: String,
    pub created_by: String,
    pub created_at: i64,
    pub members: Vec<AllianceMemberInfo>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AllianceMemberInfo {
    pub hub_public_key: String,
    pub hub_name: String,
    pub hub_url: String,
    pub joined_at: i64,
}

#[derive(Deserialize)]
pub struct ShareChannelRequest {
    pub channel_id: String,
}

#[derive(Serialize, Deserialize)]
pub struct SharedChannelResponse {
    pub channel_id: String,
    pub channel_name: String,
    pub hub_public_key: String,
    pub hub_name: String,
}

#[derive(Serialize, Deserialize)]
pub struct AllianceInviteResponse {
    pub token: String,
    pub alliance_id: String,
    pub alliance_name: String,
    pub hub_url: String,
}

#[derive(Deserialize)]
pub struct JoinAllianceRequest {
    pub invite_token: String,
    pub hub_url: String,
}

/// Request body for the joining-side endpoint: this hub's user pastes the
/// invite, we call out to the inviter to register, then mirror the alliance
/// into our own DB so it shows up in our list.
#[derive(Deserialize)]
pub struct JoinAllianceLocalRequest {
    pub inviter_hub_url: String,
    pub alliance_id: String,
    pub invite_token: String,
    pub own_hub_url: String,
}
