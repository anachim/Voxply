use std::sync::Arc;

use axum::{routing::{get, post}, Router};
use tower_http::trace::TraceLayer;

use crate::auth;
use crate::routes;
use crate::state::AppState;

pub fn create_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(routes::health::health))
        .route("/info", get(routes::health::info))
        .route("/auth/challenge", post(auth::handlers::challenge))
        .route("/auth/verify", post(auth::handlers::verify))
        .route("/me", get(routes::me::me))
        .route("/channels", post(routes::channels::create_channel))
        .route("/channels", get(routes::channels::list_channels))
        .route("/channels/{channel_id}/messages", post(routes::messages::send_message))
        .route("/channels/{channel_id}/messages", get(routes::messages::get_messages))
        .route("/ws", get(routes::ws::ws_handler))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
