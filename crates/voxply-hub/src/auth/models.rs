use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct ChallengeRequest {
    pub public_key: String,
}

#[derive(Serialize, Deserialize)]
pub struct ChallengeResponse {
    pub challenge: String,
}

#[derive(Deserialize)]
pub struct VerifyRequest {
    pub public_key: String,
    pub challenge: String,
    pub signature: String,
    pub invite_code: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct VerifyResponse {
    pub token: String,
}
