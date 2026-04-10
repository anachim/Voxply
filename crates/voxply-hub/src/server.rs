use std::sync::Arc;

use axum::{routing::{get, post}, Router};
use tower_http::trace::TraceLayer;

use crate::auth;
use crate::federation;
use crate::routes;
use crate::state::AppState;

pub fn create_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(routes::health::health))
        .route("/info", get(routes::health::info))
        .route("/auth/challenge", post(auth::handlers::challenge))
        .route("/auth/verify", post(auth::handlers::verify))
        .route("/me", get(routes::me::me).patch(routes::me::update_me))
        .route("/channels", post(routes::channels::create_channel))
        .route("/channels", get(routes::channels::list_channels))
        .route("/channels/{channel_id}/messages", post(routes::messages::send_message))
        .route("/channels/{channel_id}/messages", get(routes::messages::get_messages))
        .route("/ws", get(routes::ws::ws_handler))
        .route("/federation/peers", get(federation::handlers::list_peers))
        .route("/federation/peers", post(federation::handlers::add_peer))
        .route("/federation/peers/{peer_key}/channels", get(federation::handlers::peer_channels))
        .route("/federation/channels", get(federation::handlers::all_federated_channels))
        .route("/federation/channels/{fed_channel_id}/messages", get(federation::handlers::federated_messages)
            .post(federation::handlers::send_federated_message))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
