// Tauri backend — Rust code callable from React via invoke("command_name", args)

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Manager, State};
use voxply_identity::Identity;

// --- Shared state ---
// A Tauri "managed state" — like a singleton service in DI.
// React commands receive it via `State<AppState>` parameter.

#[derive(Default)]
struct AppState {
    // Wrap in Mutex because Tauri shares state across async commands
    inner: Mutex<Option<HubSession>>,
}

struct HubSession {
    hub_url: String,
    token: String,
    identity: Identity,
}

// --- DTOs (shared with hub server) ---

#[derive(Serialize, Deserialize)]
struct ChallengeResponse {
    challenge: String,
}

#[derive(Serialize, Deserialize)]
struct VerifyResponse {
    token: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct ChannelInfo {
    id: String,
    name: String,
    created_by: String,
    created_at: i64,
}

#[derive(Serialize, Deserialize, Clone)]
struct MessageInfo {
    id: String,
    channel_id: String,
    sender: String,
    sender_name: Option<String>,
    content: String,
    created_at: i64,
}

// --- Tauri commands ---

/// Connect to a hub and authenticate.
/// React calls: invoke("connect", { hubUrl: "http://localhost:3000" })
#[tauri::command]
async fn connect(
    hub_url: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // Load or create identity
    let path = Identity::default_path().map_err(|e| e.to_string())?;
    let (identity, _) = Identity::load_or_create(&path).map_err(|e| e.to_string())?;
    let pub_key = identity.public_key_hex();

    let client = reqwest::Client::new();

    // Challenge
    let challenge: ChallengeResponse = client
        .post(format!("{hub_url}/auth/challenge"))
        .json(&serde_json::json!({ "public_key": pub_key }))
        .send()
        .await
        .map_err(|e| format!("Failed to connect: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Invalid challenge response: {e}"))?;

    // Sign
    let challenge_bytes = hex::decode(&challenge.challenge)
        .map_err(|e| format!("Invalid challenge hex: {e}"))?;
    let signature = identity.sign(&challenge_bytes);

    // Verify
    let verify: VerifyResponse = client
        .post(format!("{hub_url}/auth/verify"))
        .json(&serde_json::json!({
            "public_key": pub_key,
            "challenge": challenge.challenge,
            "signature": hex::encode(signature.to_bytes()),
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to verify: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Invalid verify response: {e}"))?;

    let token = verify.token;

    // Store session
    *state.inner.lock().unwrap() = Some(HubSession {
        hub_url,
        token: token.clone(),
        identity,
    });

    Ok(pub_key)
}

/// List channels on the connected hub.
#[tauri::command]
async fn list_channels(
    state: State<'_, AppState>,
) -> Result<Vec<ChannelInfo>, String> {
    let (hub_url, token) = {
        let session = state.inner.lock().unwrap();
        let s = session.as_ref().ok_or("Not connected")?;
        (s.hub_url.clone(), s.token.clone())
    };

    let client = reqwest::Client::new();
    let channels: Vec<ChannelInfo> = client
        .get(format!("{hub_url}/channels"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch channels: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Invalid channels response: {e}"))?;

    Ok(channels)
}

/// Get messages for a channel.
#[tauri::command]
async fn get_messages(
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<MessageInfo>, String> {
    let (hub_url, token) = {
        let session = state.inner.lock().unwrap();
        let s = session.as_ref().ok_or("Not connected")?;
        (s.hub_url.clone(), s.token.clone())
    };

    let client = reqwest::Client::new();
    let mut messages: Vec<MessageInfo> = client
        .get(format!("{hub_url}/channels/{channel_id}/messages"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch messages: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Invalid messages response: {e}"))?;

    // API returns newest-first, we want oldest-first for display
    messages.reverse();

    Ok(messages)
}

/// Send a message to a channel.
#[tauri::command]
async fn send_message(
    channel_id: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<MessageInfo, String> {
    let (hub_url, token) = {
        let session = state.inner.lock().unwrap();
        let s = session.as_ref().ok_or("Not connected")?;
        (s.hub_url.clone(), s.token.clone())
    };

    let client = reqwest::Client::new();
    let msg: MessageInfo = client
        .post(format!("{hub_url}/channels/{channel_id}/messages"))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "content": content }))
        .send()
        .await
        .map_err(|e| format!("Failed to send message: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Invalid message response: {e}"))?;

    Ok(msg)
}

/// Disconnect from the hub (clears session).
#[tauri::command]
fn disconnect(state: State<'_, AppState>) {
    *state.inner.lock().unwrap() = None;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            app.manage(AppState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connect,
            list_channels,
            get_messages,
            send_message,
            disconnect
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
