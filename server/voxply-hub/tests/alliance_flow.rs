use std::collections::HashMap;
use std::sync::Arc;

use serde_json::json;
use sqlx::sqlite::SqlitePoolOptions;
use tokio::sync::{broadcast, RwLock};
use voxply_hub::auth::models::{ChallengeResponse, VerifyResponse};
use voxply_hub::db;
use voxply_hub::federation::client::FederationClient;
use voxply_hub::routes::alliance_models::*;
use voxply_hub::routes::chat_models::ChannelResponse;
use voxply_hub::server;
use voxply_hub::state::AppState;
use voxply_identity::Identity;

async fn start_hub(name: &str) -> (String, Arc<AppState>) {
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

    let app = server::create_router(state.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let url = format!("http://127.0.0.1:{port}");

    tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
        )
        .await
        .unwrap();
    });

    (url, state)
}

async fn authenticate_user(hub_url: &str, identity: &Identity) -> String {
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
async fn two_hubs_form_alliance() {
    let (hub_a_url, hub_a_state) = start_hub("hub-a").await;
    let (hub_b_url, _hub_b_state) = start_hub("hub-b").await;
    let client = reqwest::Client::new();

    // Create users (owners) on each hub
    let user_a = Identity::generate();
    let token_a = authenticate_user(&hub_a_url, &user_a).await;

    let user_b = Identity::generate();
    let token_b = authenticate_user(&hub_b_url, &user_b).await;

    // Hub A: Create an alliance
    let resp = client
        .post(format!("{hub_a_url}/alliances"))
        .bearer_auth(&token_a)
        .json(&json!({ "name": "WoW Alliance" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 201);
    let alliance: AllianceResponse = resp.json().await.unwrap();
    assert_eq!(alliance.name, "WoW Alliance");

    // Hub A: Create and share a channel
    let channel: ChannelResponse = client
        .post(format!("{hub_a_url}/channels"))
        .bearer_auth(&token_a)
        .json(&json!({ "name": "raids" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    let resp = client
        .post(format!("{hub_a_url}/alliances/{}/channels", alliance.id))
        .bearer_auth(&token_a)
        .json(&json!({ "channel_id": channel.id }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    // Hub A: Generate an invite token
    let invite: AllianceInviteResponse = client
        .post(format!("{hub_a_url}/alliances/{}/invite", alliance.id))
        .bearer_auth(&token_a)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(invite.alliance_name, "WoW Alliance");

    // Hub B: Join the alliance via Hub B's own /alliances/join endpoint --
    // that endpoint calls Hub A internally AND mirrors the alliance into
    // Hub B's local DB so Hub B's list_alliances includes it.
    let resp = client
        .post(format!("{hub_b_url}/alliances/join"))
        .bearer_auth(&token_b)
        .json(&json!({
            "inviter_hub_url": hub_a_url,
            "alliance_id": alliance.id,
            "invite_token": invite.token,
            "own_hub_url": hub_b_url,
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    // Hub A: Verify alliance has 2 members
    let detail: AllianceDetailResponse = client
        .get(format!("{hub_a_url}/alliances/{}", alliance.id))
        .bearer_auth(&token_a)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(detail.members.len(), 2);

    // Hub B: Verify it sees the alliance in its own list
    let b_alliances: Vec<AllianceResponse> = client
        .get(format!("{hub_b_url}/alliances"))
        .bearer_auth(&token_b)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(b_alliances.len(), 1);
    assert_eq!(b_alliances[0].id, alliance.id);

    // Hub B: Create and share its own channel with the alliance
    let b_channel: ChannelResponse = client
        .post(format!("{hub_b_url}/channels"))
        .bearer_auth(&token_b)
        .json(&json!({ "name": "guild-chat" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    let resp = client
        .post(format!("{hub_b_url}/alliances/{}/channels", alliance.id))
        .bearer_auth(&token_b)
        .json(&json!({ "channel_id": b_channel.id }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    // Hub A: List shared channels -- should now include both raids (local)
    // and guild-chat (federated from Hub B).
    let shared: Vec<SharedChannelResponse> = client
        .get(format!("{hub_a_url}/alliances/{}/channels", alliance.id))
        .bearer_auth(&token_a)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let names: Vec<&str> = shared.iter().map(|s| s.channel_name.as_str()).collect();
    assert!(names.contains(&"raids"), "expected raids in {names:?}");
    assert!(
        names.contains(&"guild-chat"),
        "expected guild-chat (from Hub B via federation) in {names:?}"
    );
    assert_eq!(shared.len(), 2);
}
