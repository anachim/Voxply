use std::collections::HashMap;
use std::sync::Arc;

use axum_test::TestServer;
use serde_json::json;
use sqlx::sqlite::SqlitePoolOptions;
use tokio::sync::{broadcast, RwLock};
use voxply_hub::auth::models::{ChallengeResponse, VerifyResponse};
use voxply_hub::db;
use voxply_hub::federation::client::FederationClient;
use voxply_hub::routes::dm_models::ConversationResponse;
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
        dm_tx: broadcast::channel(16).0,
        online_users: RwLock::new(std::collections::HashSet::new()),
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
async fn create_dm_conversation() {
    let server = setup().await;
    let alice = Identity::generate();
    let alice_token = authenticate(&server, &alice).await;
    let bob = Identity::generate();
    authenticate(&server, &bob).await;

    let resp = server
        .post("/conversations")
        .authorization_bearer(&alice_token)
        .json(&json!({ "members": [bob.public_key_hex()] }))
        .await;
    resp.assert_status(axum::http::StatusCode::CREATED);
    let conv: ConversationResponse = resp.json();
    assert_eq!(conv.conv_type, "dm");
    assert_eq!(conv.members.len(), 2);
}

#[tokio::test]
async fn dm_conversation_dedup() {
    let server = setup().await;
    let alice = Identity::generate();
    let alice_token = authenticate(&server, &alice).await;
    let bob = Identity::generate();
    authenticate(&server, &bob).await;

    // First DM creation
    let resp = server
        .post("/conversations")
        .authorization_bearer(&alice_token)
        .json(&json!({ "members": [bob.public_key_hex()] }))
        .await;
    let conv1: ConversationResponse = resp.json();

    // Second creation between same two users — should reuse
    let resp = server
        .post("/conversations")
        .authorization_bearer(&alice_token)
        .json(&json!({ "members": [bob.public_key_hex()] }))
        .await;
    let conv2: ConversationResponse = resp.json();

    assert_eq!(conv1.id, conv2.id, "DM should be deduped between same users");
}

#[tokio::test]
async fn create_group_dm() {
    let server = setup().await;
    let alice = Identity::generate();
    let alice_token = authenticate(&server, &alice).await;
    let bob = Identity::generate();
    let charlie = Identity::generate();
    authenticate(&server, &bob).await;
    authenticate(&server, &charlie).await;

    let resp = server
        .post("/conversations")
        .authorization_bearer(&alice_token)
        .json(&json!({ "members": [bob.public_key_hex(), charlie.public_key_hex()] }))
        .await;
    resp.assert_status(axum::http::StatusCode::CREATED);
    let conv: ConversationResponse = resp.json();
    assert_eq!(conv.conv_type, "group");
    assert_eq!(conv.members.len(), 3);
}

#[tokio::test]
async fn list_my_conversations() {
    let server = setup().await;
    let alice = Identity::generate();
    let alice_token = authenticate(&server, &alice).await;
    let bob = Identity::generate();
    authenticate(&server, &bob).await;

    server
        .post("/conversations")
        .authorization_bearer(&alice_token)
        .json(&json!({ "members": [bob.public_key_hex()] }))
        .await;

    let resp = server.get("/conversations").authorization_bearer(&alice_token).await;
    resp.assert_status_ok();
    let conversations: Vec<ConversationResponse> = resp.json();
    assert_eq!(conversations.len(), 1);
}

#[tokio::test]
async fn cannot_send_to_conversation_youre_not_in() {
    let server = setup().await;
    let alice = Identity::generate();
    let alice_token = authenticate(&server, &alice).await;
    let bob = Identity::generate();
    let bob_token = authenticate(&server, &bob).await;
    let charlie = Identity::generate();
    let charlie_token = authenticate(&server, &charlie).await;

    // Alice + Bob create a DM
    let resp = server
        .post("/conversations")
        .authorization_bearer(&alice_token)
        .json(&json!({ "members": [bob.public_key_hex()] }))
        .await;
    let conv: ConversationResponse = resp.json();

    // Alice can send
    server
        .post(&format!("/conversations/{}/messages", conv.id))
        .authorization_bearer(&alice_token)
        .json(&json!({ "content": "hi bob" }))
        .await
        .assert_status(axum::http::StatusCode::CREATED);

    // Bob can send
    server
        .post(&format!("/conversations/{}/messages", conv.id))
        .authorization_bearer(&bob_token)
        .json(&json!({ "content": "hi alice" }))
        .await
        .assert_status(axum::http::StatusCode::CREATED);

    // Charlie cannot
    server
        .post(&format!("/conversations/{}/messages", conv.id))
        .authorization_bearer(&charlie_token)
        .json(&json!({ "content": "intruder!" }))
        .await
        .assert_status(axum::http::StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn cannot_create_empty_conversation() {
    let server = setup().await;
    let alice = Identity::generate();
    let alice_token = authenticate(&server, &alice).await;

    let resp = server
        .post("/conversations")
        .authorization_bearer(&alice_token)
        .json(&json!({ "members": [] }))
        .await;
    resp.assert_status(axum::http::StatusCode::BAD_REQUEST);
}

// --- Cross-hub federated DM tests ---

async fn start_real_hub(name: &str) -> String {
    let db = SqlitePoolOptions::new()
        .connect("sqlite::memory:")
        .await
        .unwrap();
    db::migrations::run(&db).await.unwrap();
    let (chat_tx, _) = broadcast::channel(256);
    let (voice_event_tx, _) = broadcast::channel(16);

    let state = Arc::new(AppState {
        hub_name: name.to_string(),
        hub_identity: Identity::generate(),
        db,
        pending_challenges: RwLock::new(HashMap::new()),
        chat_tx,
        federation_client: FederationClient::new(),
        peer_tokens: RwLock::new(HashMap::new()),
        voice_channels: RwLock::new(HashMap::new()),
        voice_udp_port: 0,
        voice_event_tx,
        dm_tx: broadcast::channel(16).0,
        online_users: RwLock::new(std::collections::HashSet::new()),
    });
    let app = server::create_router(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let url = format!("http://127.0.0.1:{port}");
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    url
}

async fn authenticate_http(hub_url: &str, identity: &Identity) -> String {
    let client = reqwest::Client::new();
    let pub_key = identity.public_key_hex();

    let challenge: ChallengeResponse = client
        .post(format!("{hub_url}/auth/challenge"))
        .json(&json!({ "public_key": pub_key }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    let challenge_bytes = hex::decode(&challenge.challenge).unwrap();
    let signature = identity.sign(&challenge_bytes);

    let verify: VerifyResponse = client
        .post(format!("{hub_url}/auth/verify"))
        .json(&json!({
            "public_key": pub_key,
            "challenge": challenge.challenge,
            "signature": hex::encode(signature.to_bytes()),
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    verify.token
}

#[tokio::test]
async fn dm_delivered_across_hubs() {
    let hub_a = start_real_hub("hub-a").await;
    let hub_b = start_real_hub("hub-b").await;
    let client = reqwest::Client::new();

    let alice = Identity::generate();
    let bob = Identity::generate();
    let alice_token = authenticate_http(&hub_a, &alice).await;
    let bob_token = authenticate_http(&hub_b, &bob).await;

    // Alice creates a conversation on Hub A that includes Bob, routing to Hub B.
    let mut member_hubs = HashMap::new();
    member_hubs.insert(bob.public_key_hex(), hub_b.clone());
    let resp = client
        .post(format!("{hub_a}/conversations"))
        .bearer_auth(&alice_token)
        .json(&json!({
            "members": [bob.public_key_hex()],
            "member_hubs": member_hubs,
        }))
        .send()
        .await
        .unwrap();
    let status = resp.status();
    let body_text = resp.text().await.unwrap_or_default();
    assert!(
        status.is_success(),
        "Create conversation failed: {status} {body_text}",
    );
    let conv: ConversationResponse = serde_json::from_str(&body_text).unwrap();

    // Alice sends a DM. Hub A persists it locally and federates to Hub B.
    let resp = client
        .post(format!("{hub_a}/conversations/{}/messages", conv.id))
        .bearer_auth(&alice_token)
        .json(&json!({ "content": "hi bob, from across hubs" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::CREATED);

    // Give the async federation request time to land.
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    // Bob reads the thread from Hub B — message should have been federated there.
    let resp = client
        .get(format!("{hub_b}/conversations/{}/messages", conv.id))
        .bearer_auth(&bob_token)
        .send()
        .await
        .unwrap();
    assert!(resp.status().is_success(), "Hub B list endpoint failed: {}", resp.status());
    let messages: serde_json::Value = resp.json().await.unwrap();
    let arr = messages.as_array().expect("expected an array");
    assert_eq!(arr.len(), 1, "Bob should see the federated DM");
    assert_eq!(arr[0]["content"], "hi bob, from across hubs");
    assert_eq!(arr[0]["sender"], alice.public_key_hex());
}
