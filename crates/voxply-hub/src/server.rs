use std::sync::Arc;

use axum::routing::{get, post, put};
use axum::Router;
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
        .route("/me/roles", get(routes::roles::my_roles))
        .route("/channels", post(routes::channels::create_channel))
        .route("/channels", get(routes::channels::list_channels))
        .route("/channels/{channel_id}/messages", post(routes::messages::send_message))
        .route("/channels/{channel_id}/messages", get(routes::messages::get_messages))
        .route("/ws", get(routes::ws::ws_handler))
        .route("/roles", get(routes::roles::list_roles).post(routes::roles::create_role))
        .route("/roles/{role_id}", axum::routing::patch(routes::roles::update_role).delete(routes::roles::delete_role))
        .route("/roles/{role_id}/members", get(routes::roles::list_role_members))
        .route("/users/{public_key}/roles", get(routes::roles::get_user_roles))
        .route("/users/{public_key}/roles/{role_id}", put(routes::roles::assign_role).delete(routes::roles::remove_role))
        .route("/federation/peers", get(federation::handlers::list_peers))
        .route("/federation/peers", post(federation::handlers::add_peer))
        .route("/federation/peers/{peer_key}/channels", get(federation::handlers::peer_channels))
        .route("/federation/channels", get(federation::handlers::all_federated_channels))
        .route("/federation/channels/{fed_channel_id}/messages", get(federation::handlers::federated_messages)
            .post(federation::handlers::send_federated_message))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
