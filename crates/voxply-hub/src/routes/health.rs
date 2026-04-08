use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::state::AppState;

pub async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
    })
}

pub async fn info(State(state): State<Arc<AppState>>) -> Json<InfoResponse> {
    Json(InfoResponse {
        name: state.hub_name.clone(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        public_key: state.hub_identity.public_key_hex(),
    })
}

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: String,
}

#[derive(Serialize, Deserialize)]
pub struct InfoResponse {
    pub name: String,
    pub version: String,
    pub public_key: String,
}
