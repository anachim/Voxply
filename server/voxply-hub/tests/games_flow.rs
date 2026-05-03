use std::collections::HashMap;
use std::sync::Arc;

use axum_test::TestServer;
use serde_json::json;
use sqlx::sqlite::SqlitePoolOptions;
use tokio::sync::{broadcast, RwLock};
use voxply_hub::auth::models::{ChallengeResponse, VerifyResponse};
use voxply_hub::db;
use voxply_hub::federation::client::FederationClient;
use voxply_hub::server;
use voxply_hub::state::AppState;
use voxply_identity::Identity;

async fn setup() -> TestServer {
    let db = SqlitePoolOptions::new()
        .connect("sqlite::memory:")
        .await
        .unwrap();
    db::migrations::run(&db).await.unwrap();
    let state = Arc::new(AppState {
        hub_name: "test-hub".to_string(),
        hub_identity: Identity::generate(),
        db,
        pending_challenges: RwLock::new(HashMap::new()),
        chat_tx: broadcast::channel(256).0,
        federation_client: FederationClient::new(),
        peer_tokens: RwLock::new(HashMap::new()),
        voice_channels: RwLock::new(HashMap::new()),
        voice_udp_port: 0,
        voice_event_tx: broadcast::channel(16).0,
        dm_tx: broadcast::channel(16).0,
        online_users: RwLock::new(std::collections::HashSet::new()),
    });
    TestServer::new(server::create_router(state))
}

async fn authenticate(server: &TestServer, identity: &Identity) -> String {
    let pub_key = identity.public_key_hex();
    let challenge: ChallengeResponse = server
        .post("/auth/challenge")
        .json(&json!({ "public_key": pub_key }))
        .await
        .json();
    let signature = identity.sign(&hex::decode(&challenge.challenge).unwrap());
    let verify: VerifyResponse = server
        .post("/auth/verify")
        .json(&json!({
            "public_key": pub_key,
            "challenge": challenge.challenge,
            "signature": hex::encode(signature.to_bytes()),
        }))
        .await
        .json();
    verify.token
}

#[tokio::test]
async fn owner_can_install_list_and_uninstall_a_game() {
    let server = setup().await;
    let owner = Identity::generate();
    let token = authenticate(&server, &owner).await;

    // Install via inline manifest (no URL fetch).
    let resp = server
        .post("/hub/games")
        .authorization_bearer(&token)
        .json(&json!({
            "manifest_url": "builtin:dice",
            "manifest": {
                "id": "demo-dice",
                "name": "Dice",
                "version": "1.0.0",
                "entry_url": "/demo-games/dice.html",
            }
        }))
        .await;
    resp.assert_status(axum::http::StatusCode::CREATED);

    // Listing shows it
    let list: serde_json::Value = server
        .get("/hub/games")
        .authorization_bearer(&token)
        .await
        .json();
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["id"], "demo-dice");

    // Uninstall
    server
        .delete("/hub/games/demo-dice")
        .authorization_bearer(&token)
        .await
        .assert_status(axum::http::StatusCode::NO_CONTENT);

    // Gone
    let list: serde_json::Value = server
        .get("/hub/games")
        .authorization_bearer(&token)
        .await
        .json();
    assert_eq!(list.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn non_admin_cannot_install_games() {
    let server = setup().await;
    // Owner signs up first (gets Owner role); second user gets @everyone.
    let _owner = authenticate(&server, &Identity::generate()).await;
    let rando_token = authenticate(&server, &Identity::generate()).await;

    let resp = server
        .post("/hub/games")
        .authorization_bearer(&rando_token)
        .json(&json!({
            "manifest_url": "builtin:dice",
            "manifest": {
                "id": "evil",
                "name": "Evil",
                "version": "1.0.0",
                "entry_url": "https://example.com/evil.html",
            }
        }))
        .await;
    resp.assert_status(axum::http::StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn install_derives_id_and_version_when_omitted() {
    let server = setup().await;
    let owner = authenticate(&server, &Identity::generate()).await;

    // Manifest with ONLY name + entry_url (no id, no version) — what the
    // quick-install form sends.
    let resp = server
        .post("/hub/games")
        .authorization_bearer(&owner)
        .json(&json!({
            "manifest_url": "inline:https://example.com/g/index.html",
            "manifest": {
                "name": "Quick Install Test",
                "entry_url": "https://example.com/g/index.html",
            }
        }))
        .await;
    resp.assert_status(axum::http::StatusCode::CREATED);
    let body = resp.json::<serde_json::Value>();
    let id = body["id"].as_str().unwrap();
    assert!(id.starts_with("game-"), "derived id should be prefixed: got {id}");
    assert_eq!(body["version"], "1.0.0", "default version should be 1.0.0");
    assert_eq!(body["name"], "Quick Install Test");

    // Re-installing the same entry_url should upsert (= same id) so the
    // listing stays at 1 entry, not duplicate.
    let resp = server
        .post("/hub/games")
        .authorization_bearer(&owner)
        .json(&json!({
            "manifest_url": "inline:https://example.com/g/index.html",
            "manifest": {
                "name": "Renamed",
                "entry_url": "https://example.com/g/index.html",
            }
        }))
        .await;
    resp.assert_status(axum::http::StatusCode::CREATED);

    let list: serde_json::Value = server
        .get("/hub/games")
        .authorization_bearer(&owner)
        .await
        .json();
    let arr = list.as_array().unwrap();
    assert_eq!(arr.len(), 1, "same entry_url should upsert, not duplicate");
    assert_eq!(arr[0]["name"], "Renamed", "the upsert should have applied");
}

#[tokio::test]
async fn install_rejects_missing_name() {
    let server = setup().await;
    let owner = authenticate(&server, &Identity::generate()).await;

    let resp = server
        .post("/hub/games")
        .authorization_bearer(&owner)
        .json(&json!({
            "manifest_url": "inline:no-name",
            "manifest": {
                "name": "",
                "entry_url": "https://example.com/g.html",
            }
        }))
        .await;
    resp.assert_status(axum::http::StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn install_rejects_bad_entry_url() {
    let server = setup().await;
    let owner = authenticate(&server, &Identity::generate()).await;

    // javascript: URL should be refused
    let resp = server
        .post("/hub/games")
        .authorization_bearer(&owner)
        .json(&json!({
            "manifest_url": "builtin:bad",
            "manifest": {
                "id": "bad",
                "name": "Bad",
                "version": "1.0.0",
                "entry_url": "javascript:alert(1)",
            }
        }))
        .await;
    resp.assert_status(axum::http::StatusCode::BAD_REQUEST);
}
