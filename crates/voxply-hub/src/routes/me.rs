use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::middleware::AuthUser;

pub async fn me(user: AuthUser) -> Json<MeResponse> {
    Json(MeResponse {
        public_key: user.public_key,
    })
}

#[derive(Serialize, Deserialize)]
pub struct MeResponse {
    pub public_key: String,
}
