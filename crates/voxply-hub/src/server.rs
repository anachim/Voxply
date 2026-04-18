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
        .route("/invites", get(routes::invites::list_invites).post(routes::invites::create_invite))
        .route("/invites/{code}", axum::routing::delete(routes::invites::revoke_invite))
        .route("/moderation/bans", get(routes::moderation::list_bans).post(routes::moderation::ban_user))
        .route("/moderation/bans/{target_key}", axum::routing::delete(routes::moderation::unban_user))
        .route("/moderation/mutes", get(routes::moderation::list_mutes).post(routes::moderation::mute_user))
        .route("/moderation/mutes/{target_key}", axum::routing::delete(routes::moderation::unmute_user))
        .route("/moderation/timeout", post(routes::moderation::timeout_user))
        .route("/moderation/kick", post(routes::moderation::kick_user))
        .route("/moderation/channels/{channel_id}/bans", post(routes::moderation::channel_ban))
        .route("/moderation/channels/{channel_id}/bans/{target_key}", axum::routing::delete(routes::moderation::channel_unban))
        .route("/moderation/voice-mutes", post(routes::moderation::voice_mute))
        .route("/moderation/voice-mutes/{target_key}", axum::routing::delete(routes::moderation::voice_unmute))
        .route("/channels/{channel_id}/talk-power", post(routes::moderation::set_talk_power))
        .route("/alliances", get(routes::alliances::list_alliances).post(routes::alliances::create_alliance))
        .route("/alliances/{alliance_id}", get(routes::alliances::get_alliance))
        .route("/alliances/{alliance_id}/invite", post(routes::alliances::create_invite))
        .route("/alliances/{alliance_id}/join", post(routes::alliances::join_alliance))
        .route("/alliances/{alliance_id}/leave", axum::routing::delete(routes::alliances::leave_alliance))
        .route("/alliances/{alliance_id}/channels", get(routes::alliances::list_shared_channels)
            .post(routes::alliances::share_channel))
        .route("/alliances/{alliance_id}/channels/{channel_id}", axum::routing::delete(routes::alliances::unshare_channel))
        .route("/federation/peers", get(federation::handlers::list_peers))
        .route("/federation/peers", post(federation::handlers::add_peer))
        .route("/federation/peers/{peer_key}/channels", get(federation::handlers::peer_channels))
        .route("/federation/channels", get(federation::handlers::all_federated_channels))
        .route("/federation/channels/{fed_channel_id}/messages", get(federation::handlers::federated_messages)
            .post(federation::handlers::send_federated_message))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
