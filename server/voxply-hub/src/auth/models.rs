use serde::{Deserialize, Serialize};
use voxply_identity::SubkeyCert;

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
    pub security_nonce: Option<u64>,
    pub security_level: Option<u32>,
    /// Multi-device: when present, `public_key` is the device's
    /// subkey and the cert links it to a master. The hub uses the
    /// master to find the canonical user row across devices.
    #[serde(default)]
    pub subkey_cert: Option<SubkeyCert>,
}

#[derive(Serialize, Deserialize)]
pub struct VerifyResponse {
    pub token: String,
}
