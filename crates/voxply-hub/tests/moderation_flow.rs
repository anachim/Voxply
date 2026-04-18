use std::collections::HashMap;
use std::sync::Arc;

use axum_test::TestServer;
use serde_json::json;
use sqlx::sqlite::SqlitePoolOptions;
use tokio::sync::{broadcast, RwLock};
use voxply_hub::auth::models::{ChallengeResponse, VerifyResponse};
use voxply_hub::db;
use voxply_hub::federation::client::FederationClient;
use voxply_hub::routes::chat_models::ChannelResponse;
use voxply_hub::routes::moderation_models::{BanResponse, MuteResponse};
use voxply_hub::server;
use voxply_hub::state::AppState;
use voxply_identity::Identity;

async fn setup() -> TestServer {
    let db = SqlitePoolOptions::new()
        .connect("sqlite::memory:")
        .await
        .unwrap();
    db::migrations::run(&db).await.unwrap();
    let (chat_tx, _) = broadcast::channel(256);
    let (voice_event_tx, _) = broadcast::channel(16);

    let state = Arc::new(AppState {
        hub_name: "test-hub".to_string(),
        hub_identity: Identity::generate(),
        db,
        pending_challenges: RwLock::new(HashMap::new()),
        chat_tx,
        federation_client: FederationClient::new(),
        peer_tokens: RwLock::new(HashMap::new()),
        voice_channels: RwLock::new(HashMap::new()),
        voice_udp_port: 0,
        voice_event_tx,
    });
    let app = server::create_router(state);
    TestServer::new(app)
}

async fn authenticate(server: &TestServer, identity: &Identity) -> String {
    let pub_key = identity.public_key_hex();

    let resp = server
        .post("/auth/challenge")
        .json(&json!({ "public_key": pub_key }))
        .await;
    let challenge: ChallengeResponse = resp.json();

    let challenge_bytes = hex::decode(&challenge.challenge).unwrap();
    let signature = identity.sign(&challenge_bytes);

    let resp = server
        .post("/auth/verify")
        .json(&json!({
            "public_key": pub_key,
            "challenge": challenge.challenge,
            "signature": hex::encode(signature.to_bytes()),
        }))
        .await;
    let verify: VerifyResponse = resp.json();
    verify.token
}

#[tokio::test]
async fn ban_blocks_authentication() {
    let server = setup().await;

    let owner = Identity::generate();
    let owner_token = authenticate(&server, &owner).await;

    let user2 = Identity::generate();
    let _token2 = authenticate(&server, &user2).await;

    // Owner bans user2
    let resp = server
        .post("/moderation/bans")
        .authorization_bearer(&owner_token)
        .json(&json!({
            "target_public_key": user2.public_key_hex(),
            "reason": "spamming",
        }))
        .await;
    resp.assert_status(axum::http::StatusCode::CREATED);

    // user2 tries to authenticate again — should be rejected
    let pub_key = user2.public_key_hex();
    let resp = server
        .post("/auth/challenge")
        .json(&json!({ "public_key": pub_key }))
        .await;
    let challenge: ChallengeResponse = resp.json();
    let challenge_bytes = hex::decode(&challenge.challenge).unwrap();
    let signature = user2.sign(&challenge_bytes);

    let resp = server
        .post("/auth/verify")
        .json(&json!({
            "public_key": pub_key,
            "challenge": challenge.challenge,
            "signature": hex::encode(signature.to_bytes()),
        }))
        .await;
    resp.assert_status(axum::http::StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn mute_blocks_sending_messages() {
    let server = setup().await;

    let owner = Identity::generate();
    let owner_token = authenticate(&server, &owner).await;

    let user2 = Identity::generate();
    let token2 = authenticate(&server, &user2).await;

    // Create a channel
    let resp = server
        .post("/channels")
        .authorization_bearer(&owner_token)
        .json(&json!({ "name": "general" }))
        .await;
    let channel: ChannelResponse = resp.json();

    // user2 can send before mute
    let resp = server
        .post(&format!("/channels/{}/messages", channel.id))
        .authorization_bearer(&token2)
        .json(&json!({ "content": "hello" }))
        .await;
    resp.assert_status(axum::http::StatusCode::CREATED);

    // Owner mutes user2
    server
        .post("/moderation/mutes")
        .authorization_bearer(&owner_token)
        .json(&json!({
            "target_public_key": user2.public_key_hex(),
        }))
        .await
        .assert_status(axum::http::StatusCode::CREATED);

    // user2 can't send while muted
    let resp = server
        .post(&format!("/channels/{}/messages", channel.id))
        .authorization_bearer(&token2)
        .json(&json!({ "content": "still here" }))
        .await;
    resp.assert_status(axum::http::StatusCode::FORBIDDEN);

    // Owner unmutes
    server
        .delete(&format!("/moderation/mutes/{}", user2.public_key_hex()))
        .authorization_bearer(&owner_token)
        .await
        .assert_status(axum::http::StatusCode::NO_CONTENT);

    // user2 can send again
    let resp = server
        .post(&format!("/channels/{}/messages", channel.id))
        .authorization_bearer(&token2)
        .json(&json!({ "content": "im back" }))
        .await;
    resp.assert_status(axum::http::StatusCode::CREATED);
}

#[tokio::test]
async fn cannot_moderate_higher_priority_user() {
    let server = setup().await;

    // Owner is first user (gets Owner role)
    let owner = Identity::generate();
    let _owner_token = authenticate(&server, &owner).await;

    // user2 (only @everyone) tries to ban owner
    let user2 = Identity::generate();
    let token2 = authenticate(&server, &user2).await;

    let resp = server
        .post("/moderation/bans")
        .authorization_bearer(&token2)
        .json(&json!({
            "target_public_key": owner.public_key_hex(),
        }))
        .await;
    resp.assert_status(axum::http::StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn unban_allows_reauth() {
    let server = setup().await;

    let owner = Identity::generate();
    let owner_token = authenticate(&server, &owner).await;

    let user2 = Identity::generate();
    authenticate(&server, &user2).await;

    // Ban then unban
    server
        .post("/moderation/bans")
        .authorization_bearer(&owner_token)
        .json(&json!({ "target_public_key": user2.public_key_hex() }))
        .await;

    server
        .delete(&format!("/moderation/bans/{}", user2.public_key_hex()))
        .authorization_bearer(&owner_token)
        .await
        .assert_status(axum::http::StatusCode::NO_CONTENT);

    // user2 can authenticate again
    let token2 = authenticate(&server, &user2).await;
    assert!(!token2.is_empty());
}

#[tokio::test]
async fn list_bans() {
    let server = setup().await;

    let owner = Identity::generate();
    let owner_token = authenticate(&server, &owner).await;

    let user2 = Identity::generate();
    authenticate(&server, &user2).await;

    server
        .post("/moderation/bans")
        .authorization_bearer(&owner_token)
        .json(&json!({
            "target_public_key": user2.public_key_hex(),
            "reason": "testing",
        }))
        .await;

    let resp = server
        .get("/moderation/bans")
        .authorization_bearer(&owner_token)
        .await;
    resp.assert_status_ok();
    let bans: Vec<BanResponse> = resp.json();
    assert_eq!(bans.len(), 1);
    assert_eq!(bans[0].target_public_key, user2.public_key_hex());
    assert_eq!(bans[0].reason, Some("testing".to_string()));
}

#[tokio::test]
async fn channel_ban_blocks_messages() {
    let server = setup().await;

    let owner = Identity::generate();
    let owner_token = authenticate(&server, &owner).await;

    let user2 = Identity::generate();
    let token2 = authenticate(&server, &user2).await;

    // Create channel
    let resp = server
        .post("/channels")
        .authorization_bearer(&owner_token)
        .json(&json!({ "name": "general" }))
        .await;
    let channel: ChannelResponse = resp.json();

    // user2 can send before channel ban
    server
        .post(&format!("/channels/{}/messages", channel.id))
        .authorization_bearer(&token2)
        .json(&json!({ "content": "hello" }))
        .await
        .assert_status(axum::http::StatusCode::CREATED);

    // Ban user2 from channel
    server
        .post(&format!("/moderation/channels/{}/bans", channel.id))
        .authorization_bearer(&owner_token)
        .json(&json!({ "target_public_key": user2.public_key_hex() }))
        .await
        .assert_status(axum::http::StatusCode::CREATED);

    // user2 can't send to that channel
    server
        .post(&format!("/channels/{}/messages", channel.id))
        .authorization_bearer(&token2)
        .json(&json!({ "content": "blocked" }))
        .await
        .assert_status(axum::http::StatusCode::FORBIDDEN);

    // Unban
    server
        .delete(&format!("/moderation/channels/{}/bans/{}", channel.id, user2.public_key_hex()))
        .authorization_bearer(&owner_token)
        .await
        .assert_status(axum::http::StatusCode::NO_CONTENT);

    // user2 can send again
    server
        .post(&format!("/channels/{}/messages", channel.id))
        .authorization_bearer(&token2)
        .json(&json!({ "content": "im back" }))
        .await
        .assert_status(axum::http::StatusCode::CREATED);
}
