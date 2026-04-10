use std::collections::HashMap;
use std::sync::Arc;

use axum_test::TestServer;
use serde_json::json;
use sqlx::sqlite::SqlitePoolOptions;
use tokio::sync::{broadcast, RwLock};
use voxply_hub::auth::models::{ChallengeResponse, VerifyResponse};
use voxply_hub::db;
use voxply_hub::federation::client::FederationClient;
use voxply_hub::routes::chat_models::{ChannelResponse, MessageResponse};
use voxply_hub::routes::me::MeResponse;
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

    let state = Arc::new(AppState {
        hub_name: "test-hub".to_string(),
        hub_identity: Identity::generate(),
        db,
        pending_challenges: RwLock::new(HashMap::new()),
        chat_tx,
        federation_client: FederationClient::new(),
        peer_tokens: RwLock::new(HashMap::new()),
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
async fn create_and_list_channels() {
    let server = setup().await;
    let identity = Identity::generate();
    let token = authenticate(&server, &identity).await;

    // Create a channel
    let resp = server
        .post("/channels")
        .authorization_bearer(&token)
        .json(&json!({ "name": "general" }))
        .await;
    resp.assert_status(axum::http::StatusCode::CREATED);
    let channel: ChannelResponse = resp.json();
    assert_eq!(channel.name, "general");
    assert_eq!(channel.created_by, identity.public_key_hex());

    // Create another
    let resp = server
        .post("/channels")
        .authorization_bearer(&token)
        .json(&json!({ "name": "random" }))
        .await;
    resp.assert_status(axum::http::StatusCode::CREATED);

    // List channels
    let resp = server
        .get("/channels")
        .authorization_bearer(&token)
        .await;
    resp.assert_status_ok();
    let channels: Vec<ChannelResponse> = resp.json();
    assert_eq!(channels.len(), 2);
    assert_eq!(channels[0].name, "general");
    assert_eq!(channels[1].name, "random");
}

#[tokio::test]
async fn duplicate_channel_name_returns_conflict() {
    let server = setup().await;
    let identity = Identity::generate();
    let token = authenticate(&server, &identity).await;

    server
        .post("/channels")
        .authorization_bearer(&token)
        .json(&json!({ "name": "general" }))
        .await;

    let resp = server
        .post("/channels")
        .authorization_bearer(&token)
        .json(&json!({ "name": "general" }))
        .await;
    resp.assert_status(axum::http::StatusCode::CONFLICT);
}

#[tokio::test]
async fn channels_require_auth() {
    let server = setup().await;
    let resp = server.get("/channels").await;
    resp.assert_status_unauthorized();
}

#[tokio::test]
async fn send_and_get_messages() {
    let server = setup().await;
    let identity = Identity::generate();
    let token = authenticate(&server, &identity).await;

    // Create a channel
    let resp = server
        .post("/channels")
        .authorization_bearer(&token)
        .json(&json!({ "name": "general" }))
        .await;
    let channel: ChannelResponse = resp.json();

    // Send messages
    for i in 1..=3 {
        let resp = server
            .post(&format!("/channels/{}/messages", channel.id))
            .authorization_bearer(&token)
            .json(&json!({ "content": format!("message {i}") }))
            .await;
        resp.assert_status(axum::http::StatusCode::CREATED);
    }

    // Get messages (newest first)
    let resp = server
        .get(&format!("/channels/{}/messages", channel.id))
        .authorization_bearer(&token)
        .await;
    resp.assert_status_ok();
    let messages: Vec<MessageResponse> = resp.json();
    assert_eq!(messages.len(), 3);
    assert_eq!(messages[0].content, "message 3");
    assert_eq!(messages[2].content, "message 1");
    assert_eq!(messages[0].sender, identity.public_key_hex());
    assert!(messages[0].sender_name.is_none());

    // Set display name and send another message
    server
        .patch("/me")
        .authorization_bearer(&token)
        .json(&json!({ "display_name": "Alice" }))
        .await;

    server
        .post(&format!("/channels/{}/messages", channel.id))
        .authorization_bearer(&token)
        .json(&json!({ "content": "message 4" }))
        .await;

    let resp = server
        .get(&format!("/channels/{}/messages", channel.id))
        .authorization_bearer(&token)
        .await;
    let messages: Vec<MessageResponse> = resp.json();
    assert_eq!(messages[0].sender_name, Some("Alice".to_string()));
}

#[tokio::test]
async fn set_and_get_display_name() {
    let server = setup().await;
    let identity = Identity::generate();
    let token = authenticate(&server, &identity).await;

    // Initially no display name
    let resp = server.get("/me").authorization_bearer(&token).await;
    resp.assert_status_ok();
    let me: MeResponse = resp.json();
    assert_eq!(me.public_key, identity.public_key_hex());
    assert!(me.display_name.is_none());

    // Set display name
    let resp = server
        .patch("/me")
        .authorization_bearer(&token)
        .json(&json!({ "display_name": "Alice" }))
        .await;
    resp.assert_status_ok();
    let me: MeResponse = resp.json();
    assert_eq!(me.display_name, Some("Alice".to_string()));

    // Verify it persists
    let resp = server.get("/me").authorization_bearer(&token).await;
    let me: MeResponse = resp.json();
    assert_eq!(me.display_name, Some("Alice".to_string()));
}

#[tokio::test]
async fn message_to_nonexistent_channel_returns_404() {
    let server = setup().await;
    let identity = Identity::generate();
    let token = authenticate(&server, &identity).await;

    let resp = server
        .post("/channels/nonexistent/messages")
        .authorization_bearer(&token)
        .json(&json!({ "content": "hello" }))
        .await;
    resp.assert_status(axum::http::StatusCode::NOT_FOUND);
}
