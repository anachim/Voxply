use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use voxply_identity::Identity;

// --- Shared state ---

#[derive(Default)]
struct AppState {
    /// Live hub sessions keyed by hub_id (the hub's public_key).
    hubs: Mutex<HashMap<String, HubSession>>,
    /// Currently active hub_id (what the UI is showing).
    active_hub: Mutex<Option<String>>,
    /// Voice session (only one at a time across all hubs).
    voice: Mutex<Option<VoiceSession>>,
}

struct HubSession {
    hub_id: String,
    hub_name: String,
    hub_url: String,
    hub_icon: Option<String>,
    token: String,
    ws_tx: mpsc::UnboundedSender<WsCommand>,
    ws_task: JoinHandle<()>,
}

enum WsCommand {
    Subscribe(String),
    Unsubscribe(String),
    SubscribeAll,
    VoiceJoin { channel_id: String, udp_port: u16 },
    VoiceLeave { channel_id: String },
    VoiceSpeaking { channel_id: String, speaking: bool },
    Typing { channel_id: String, typing: bool },
}

struct VoiceSession {
    channel_id: String,
    hub_id: String,
    stop_tx: std::sync::mpsc::Sender<()>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct StoredVoiceSettings {
    input_device: Option<String>,
    output_device: Option<String>,
    /// Range [0.001, 0.2]. Higher = less sensitive.
    vad_threshold: Option<f32>,
}

#[derive(Serialize)]
struct AudioDeviceList {
    inputs: Vec<String>,
    outputs: Vec<String>,
}

// --- DTOs ---

#[derive(Serialize, Deserialize)]
struct ChallengeResponse {
    challenge: String,
}

#[derive(Serialize, Deserialize)]
struct VerifyResponse {
    token: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct HubInfo {
    hub_id: String,
    hub_name: String,
    hub_url: String,
    hub_icon: Option<String>,
    is_active: bool,
}

#[derive(Serialize, Deserialize, Clone)]
struct SavedHub {
    hub_id: String,
    hub_name: String,
    hub_url: String,
}

#[derive(Serialize, Deserialize)]
struct InfoResponse {
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    icon: Option<String>,
    public_key: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct RoleInfo {
    id: String,
    name: String,
    permissions: Vec<String>,
    priority: i64,
    #[serde(default)]
    display_separately: bool,
}

#[derive(Serialize, Deserialize, Clone)]
struct MeInfo {
    public_key: String,
    display_name: Option<String>,
    #[serde(default)]
    avatar: Option<String>,
    /// Either "approved" or "pending". The hub server defaults missing
    /// rows to "approved", so for unmoderated hubs this is just always
    /// "approved".
    #[serde(default = "default_approval_status")]
    approval_status: String,
    roles: Vec<RoleInfo>,
}

fn default_approval_status() -> String {
    "approved".to_string()
}

#[derive(Serialize, Deserialize, Clone)]
struct HubBranding {
    name: String,
    description: Option<String>,
    icon: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct HubSettings {
    require_approval: bool,
    invite_only: bool,
}

#[derive(Serialize, Deserialize, Clone)]
struct PendingUser {
    public_key: String,
    display_name: Option<String>,
    first_seen_at: i64,
}

#[derive(Serialize, Deserialize, Clone)]
struct InstalledGame {
    id: String,
    name: String,
    description: Option<String>,
    version: String,
    entry_url: String,
    thumbnail_url: Option<String>,
    author: Option<String>,
    min_players: i64,
    max_players: i64,
    installed_by: String,
    installed_at: i64,
    manifest_url: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct GameManifest {
    id: String,
    name: String,
    description: Option<String>,
    version: String,
    entry_url: String,
    thumbnail_url: Option<String>,
    author: Option<String>,
    min_players: i64,
    max_players: i64,
}

#[derive(Serialize, Deserialize, Clone)]
struct ChannelInfo {
    id: String,
    name: String,
    created_by: String,
    parent_id: Option<String>,
    is_category: bool,
    display_order: i64,
    description: Option<String>,
    created_at: i64,
}

#[derive(Serialize, Deserialize, Clone)]
struct UserInfo {
    public_key: String,
    display_name: Option<String>,
    #[serde(default)]
    avatar: Option<String>,
    online: bool,
    #[serde(default)]
    group_role: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct FriendInfo {
    public_key: String,
    display_name: Option<String>,
    since: i64,
}

#[derive(Serialize, Deserialize, Clone)]
struct ConversationInfo {
    id: String,
    conv_type: String,
    members: Vec<String>,
    created_at: i64,
}

#[derive(Serialize, Deserialize, Clone)]
struct DmMessageInfo {
    id: String,
    conversation_id: String,
    sender: String,
    sender_name: Option<String>,
    content: String,
    created_at: i64,
}

#[derive(Serialize, Deserialize, Clone)]
struct AttachmentInfo {
    name: String,
    mime: String,
    data_b64: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct ReactionInfo {
    emoji: String,
    count: i64,
    me: bool,
}

#[derive(Serialize, Deserialize, Clone)]
struct ReplyContextInfo {
    message_id: String,
    sender: String,
    sender_name: Option<String>,
    content_preview: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct MessageInfo {
    id: String,
    channel_id: String,
    sender: String,
    sender_name: Option<String>,
    content: String,
    created_at: i64,
    #[serde(default)]
    edited_at: Option<i64>,
    #[serde(default)]
    attachments: Vec<AttachmentInfo>,
    #[serde(default)]
    reactions: Vec<ReactionInfo>,
    #[serde(default)]
    reply_to: Option<ReplyContextInfo>,
}

#[derive(Deserialize)]
#[serde(tag = "type")]
enum WsServerMessage {
    #[serde(rename = "message")]
    ChatMessage {
        channel_id: String,
        message: MessageInfo,
    },
    #[serde(rename = "message_edited")]
    MessageEdited {
        channel_id: String,
        message: MessageInfo,
    },
    #[serde(rename = "message_deleted")]
    MessageDeleted {
        channel_id: String,
        message_id: String,
    },
    #[serde(rename = "reactions_updated")]
    ReactionsUpdated {
        channel_id: String,
        message_id: String,
        reactions: Vec<ReactionInfo>,
    },
    #[serde(rename = "typing")]
    Typing {
        channel_id: String,
        public_key: String,
        display_name: Option<String>,
        typing: bool,
    },
    #[serde(rename = "voice_joined")]
    VoiceJoined {
        channel_id: String,
        hub_udp_port: u16,
        participants: Vec<VoiceParticipantInfo>,
    },
    #[serde(rename = "voice_participant_joined")]
    VoiceParticipantJoined {
        channel_id: String,
        participant: VoiceParticipantInfo,
    },
    #[serde(rename = "voice_participant_left")]
    VoiceParticipantLeft {
        channel_id: String,
        public_key: String,
    },
    #[serde(rename = "voice_participant_speaking")]
    VoiceParticipantSpeaking {
        channel_id: String,
        public_key: String,
        speaking: bool,
    },
    #[serde(rename = "error")]
    Error {
        context: String,
        message: String,
    },
    #[serde(rename = "dm")]
    DirectMessage {
        conversation_id: String,
        sender: String,
        sender_name: Option<String>,
        content: String,
        timestamp: i64,
    },
    #[serde(other)]
    Other,
}

#[derive(Serialize, Deserialize, Clone)]
struct VoiceParticipantInfo {
    public_key: String,
    display_name: Option<String>,
}

// --- Persistence: saved hubs file ---

fn saved_hubs_path() -> Result<std::path::PathBuf, String> {
    let home = dirs::home_dir().ok_or("No home directory")?;
    Ok(home.join(".voxply").join("hubs.json"))
}

fn active_hub_path() -> Result<std::path::PathBuf, String> {
    let home = dirs::home_dir().ok_or("No home directory")?;
    Ok(home.join(".voxply").join("active_hub"))
}

fn voice_settings_path() -> Result<std::path::PathBuf, String> {
    let home = dirs::home_dir().ok_or("No home directory")?;
    Ok(home.join(".voxply").join("voice.json"))
}

fn unread_state_path() -> Result<std::path::PathBuf, String> {
    let home = dirs::home_dir().ok_or("No home directory")?;
    Ok(home.join(".voxply").join("unread.json"))
}

#[tauri::command]
fn load_unread_state() -> Result<serde_json::Value, String> {
    let path = unread_state_path()?;
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let text = std::fs::read_to_string(&path).map_err(|e| format!("read: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("parse: {e}"))
}

#[tauri::command]
fn save_unread_state(state: serde_json::Value) -> Result<(), String> {
    let path = unread_state_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    }
    let text = serde_json::to_string(&state).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| format!("write: {e}"))?;
    Ok(())
}

fn profile_path() -> Result<std::path::PathBuf, String> {
    let home = dirs::home_dir().ok_or("No home directory")?;
    Ok(home.join(".voxply").join("profile.json"))
}

#[derive(Serialize, Deserialize, Clone)]
struct NamedProfile {
    /// Stable identifier (UUID generated on the client when the profile is
    /// created).
    id: String,
    /// User-given label for this profile, e.g. "Work" or "Gaming".
    label: String,
    /// Display name applied when this profile is used.
    #[serde(default)]
    display_name: String,
    /// Optional avatar (base64 data URL).
    #[serde(default)]
    avatar: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct LocalProfile {
    /// All profiles the user has defined. Empty on fresh installs.
    #[serde(default)]
    profiles: Vec<NamedProfile>,
    /// Which profile to auto-apply on new hubs. Falls back to the first
    /// profile in the list when missing or stale.
    #[serde(default)]
    default_profile_id: Option<String>,

    /// Visual theme preference: "calm" | "classic" | "linear". Missing or
    /// unknown values fall back to calm at the client.
    #[serde(default)]
    theme: Option<String>,
}

impl LocalProfile {
    fn default_profile(&self) -> Option<&NamedProfile> {
        if self.profiles.is_empty() {
            return None;
        }
        if let Some(id) = self.default_profile_id.as_ref() {
            if let Some(p) = self.profiles.iter().find(|p| &p.id == id) {
                return Some(p);
            }
        }
        self.profiles.first()
    }
}

fn load_profile() -> LocalProfile {
    if let Ok(path) = profile_path() {
        if let Ok(data) = std::fs::read_to_string(&path) {
            if let Ok(p) = serde_json::from_str::<LocalProfile>(&data) {
                return p;
            }
        }
    }
    LocalProfile::default()
}

fn save_profile_to_disk(profile: &LocalProfile) -> Result<(), String> {
    let path = profile_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Mkdir failed: {e}"))?;
    }
    let json = serde_json::to_string_pretty(profile).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("Write failed: {e}"))?;
    Ok(())
}

#[tauri::command]
fn get_profile() -> LocalProfile {
    load_profile()
}

#[tauri::command]
fn save_profile(profile: LocalProfile) -> Result<(), String> {
    save_profile_to_disk(&profile)
}

fn load_voice_settings() -> StoredVoiceSettings {
    if let Ok(path) = voice_settings_path() {
        if let Ok(data) = std::fs::read_to_string(&path) {
            if let Ok(s) = serde_json::from_str::<StoredVoiceSettings>(&data) {
                return s;
            }
        }
    }
    StoredVoiceSettings::default()
}

fn save_voice_settings_to_disk(settings: &StoredVoiceSettings) -> Result<(), String> {
    let path = voice_settings_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Mkdir failed: {e}"))?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("Write failed: {e}"))?;
    Ok(())
}

fn load_saved_hubs() -> Vec<SavedHub> {
    if let Ok(path) = saved_hubs_path() {
        if let Ok(data) = std::fs::read_to_string(&path) {
            if let Ok(hubs) = serde_json::from_str(&data) {
                return hubs;
            }
        }
    }
    Vec::new()
}

fn save_hubs_list(hubs: &[SavedHub]) -> Result<(), String> {
    let path = saved_hubs_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Mkdir failed: {e}"))?;
    }
    let json = serde_json::to_string_pretty(hubs).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("Write failed: {e}"))?;
    Ok(())
}

fn load_active_hub_id() -> Option<String> {
    let path = active_hub_path().ok()?;
    let data = std::fs::read_to_string(&path).ok()?;
    let trimmed = data.trim();
    if trimmed.is_empty() { None } else { Some(trimmed.to_string()) }
}

fn save_active_hub_id(hub_id: Option<&str>) {
    let Ok(path) = active_hub_path() else { return };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&path, hub_id.unwrap_or(""));
}

// --- Helpers ---

/// Get the active session details (hub_url, token) or error if no hub selected.
fn active_session(state: &AppState) -> Result<(String, String), String> {
    let active_id = state
        .active_hub
        .lock()
        .unwrap()
        .clone()
        .ok_or("No active hub")?;
    let hubs = state.hubs.lock().unwrap();
    let s = hubs.get(&active_id).ok_or("Active hub not connected")?;
    Ok((s.hub_url.clone(), s.token.clone()))
}

/// Get the active session's WS sender.
fn active_ws_tx(state: &AppState) -> Result<mpsc::UnboundedSender<WsCommand>, String> {
    let active_id = state
        .active_hub
        .lock()
        .unwrap()
        .clone()
        .ok_or("No active hub")?;
    let hubs = state.hubs.lock().unwrap();
    let s = hubs.get(&active_id).ok_or("Active hub not connected")?;
    Ok(s.ws_tx.clone())
}

// --- Tauri commands ---

/// Connect to a hub by URL. Adds it to the saved list.
#[tauri::command]
async fn add_hub(
    hub_url: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<HubInfo, String> {
    let path = Identity::default_path().map_err(|e| e.to_string())?;
    let (identity, _) = Identity::load_or_create(&path).map_err(|e| e.to_string())?;
    let pub_key = identity.public_key_hex();

    let client = reqwest::Client::new();

    // Get hub info first (gives us hub_id and name)
    let info: InfoResponse = client
        .get(format!("{hub_url}/info"))
        .send()
        .await
        .map_err(|e| format!("Failed to reach hub: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Invalid info response: {e}"))?;

    let hub_id = info.public_key.clone();
    let hub_name = info.name.clone();
    let hub_icon = info.icon.clone();

    // Authenticate
    let challenge: ChallengeResponse = client
        .post(format!("{hub_url}/auth/challenge"))
        .json(&serde_json::json!({ "public_key": pub_key }))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Invalid challenge: {e}"))?;

    let challenge_bytes = hex::decode(&challenge.challenge).map_err(|e| e.to_string())?;
    let signature = identity.sign(&challenge_bytes);

    let verify: VerifyResponse = client
        .post(format!("{hub_url}/auth/verify"))
        .json(&serde_json::json!({
            "public_key": pub_key,
            "challenge": challenge.challenge,
            "signature": hex::encode(signature.to_bytes()),
        }))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Invalid verify: {e}"))?;

    let token = verify.token;

    // Auto-apply the user's default profile to this hub whenever the hub
    // doesn't already have a value for the field. Lets a new hub inherit
    // your identity instead of showing your pubkey.
    let profile = load_profile();
    if let Some(default_profile) = profile.default_profile().cloned() {
        if let Ok(me_resp) = client
            .get(format!("{hub_url}/me"))
            .bearer_auth(&token)
            .send()
            .await
        {
            if let Ok(me) = me_resp.json::<serde_json::Value>().await {
                let mut patch = serde_json::Map::new();
                let has_name = me
                    .get("display_name")
                    .and_then(|v| v.as_str())
                    .map(|s| !s.is_empty())
                    .unwrap_or(false);
                if !has_name && !default_profile.display_name.trim().is_empty() {
                    patch.insert(
                        "display_name".to_string(),
                        serde_json::Value::String(default_profile.display_name.clone()),
                    );
                }
                let has_avatar = me
                    .get("avatar")
                    .and_then(|v| v.as_str())
                    .map(|s| !s.is_empty())
                    .unwrap_or(false);
                if !has_avatar {
                    if let Some(a) = default_profile.avatar.as_deref() {
                        if !a.is_empty() {
                            patch.insert(
                                "avatar".to_string(),
                                serde_json::Value::String(a.to_string()),
                            );
                        }
                    }
                }
                if !patch.is_empty() {
                    let _ = client
                        .patch(format!("{hub_url}/me"))
                        .bearer_auth(&token)
                        .json(&serde_json::Value::Object(patch))
                        .send()
                        .await;
                }
            }
        }
    }

    // Spawn WS task with hub_id tagging
    let (cmd_tx, ws_task) = spawn_ws_task(hub_id.clone(), hub_url.clone(), token.clone(), app.clone()).await?;

    let session = HubSession {
        hub_id: hub_id.clone(),
        hub_name: hub_name.clone(),
        hub_url: hub_url.clone(),
        hub_icon: hub_icon.clone(),
        token,
        ws_tx: cmd_tx,
        ws_task,
    };

    {
        let mut hubs = state.hubs.lock().unwrap();
        hubs.insert(hub_id.clone(), session);
    }

    // Auto-set as active if no active hub yet
    {
        let mut active = state.active_hub.lock().unwrap();
        if active.is_none() {
            *active = Some(hub_id.clone());
        }
    }

    // Persist to disk
    let mut saved = load_saved_hubs();
    if !saved.iter().any(|h| h.hub_id == hub_id) {
        saved.push(SavedHub {
            hub_id: hub_id.clone(),
            hub_name: hub_name.clone(),
            hub_url: hub_url.clone(),
        });
        let _ = save_hubs_list(&saved);
    }

    let active = state.active_hub.lock().unwrap().clone();
    Ok(HubInfo {
        hub_id: hub_id.clone(),
        hub_name,
        hub_url,
        hub_icon,
        is_active: active.as_deref() == Some(hub_id.as_str()),
    })
}

#[tauri::command]
async fn ping_hub(hub_id: String, state: State<'_, AppState>) -> Result<u64, String> {
    let hub_url = {
        let hubs = state.hubs.lock().unwrap();
        hubs.get(&hub_id).map(|s| s.hub_url.clone())
    }
    .ok_or("Hub not connected")?;

    let client = reqwest::Client::new();
    let start = std::time::Instant::now();
    let resp = client
        .get(format!("{hub_url}/health"))
        .timeout(std::time::Duration::from_secs(3))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    Ok(start.elapsed().as_millis() as u64)
}

#[tauri::command]
fn list_hubs(state: State<'_, AppState>) -> Vec<HubInfo> {
    let hubs = state.hubs.lock().unwrap();
    let active = state.active_hub.lock().unwrap().clone();
    hubs.values()
        .map(|s| HubInfo {
            hub_id: s.hub_id.clone(),
            hub_name: s.hub_name.clone(),
            hub_url: s.hub_url.clone(),
            hub_icon: s.hub_icon.clone(),
            is_active: active.as_deref() == Some(s.hub_id.as_str()),
        })
        .collect()
}

#[tauri::command]
fn set_active_hub(hub_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let hubs = state.hubs.lock().unwrap();
    if !hubs.contains_key(&hub_id) {
        return Err("Hub not connected".to_string());
    }
    *state.active_hub.lock().unwrap() = Some(hub_id.clone());
    save_active_hub_id(Some(&hub_id));
    Ok(())
}

#[tauri::command]
fn remove_hub(hub_id: String, state: State<'_, AppState>) -> Result<(), String> {
    if let Some(session) = state.hubs.lock().unwrap().remove(&hub_id) {
        session.ws_task.abort();
    }
    {
        let mut active = state.active_hub.lock().unwrap();
        if active.as_deref() == Some(hub_id.as_str()) {
            *active = None;
            save_active_hub_id(None);
        }
    }
    let mut saved = load_saved_hubs();
    saved.retain(|h| h.hub_id != hub_id);
    let _ = save_hubs_list(&saved);
    Ok(())
}

#[tauri::command]
async fn auto_connect_saved(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<HubInfo>, String> {
    let saved = load_saved_hubs();
    for hub in &saved {
        let _ = add_hub(hub.hub_url.clone(), state.clone(), app.clone()).await;
    }

    // Restore the previously-active hub if it successfully reconnected.
    if let Some(persisted) = load_active_hub_id() {
        let hubs = state.hubs.lock().unwrap();
        if hubs.contains_key(&persisted) {
            drop(hubs);
            *state.active_hub.lock().unwrap() = Some(persisted);
        }
    }

    Ok(list_hubs(state))
}

async fn spawn_ws_task(
    hub_id: String,
    hub_url: String,
    token: String,
    app: AppHandle,
) -> Result<(mpsc::UnboundedSender<WsCommand>, JoinHandle<()>), String> {
    let ws_url = hub_url
        .replace("http://", "ws://")
        .replace("https://", "wss://");
    let url = format!("{ws_url}/ws?token={token}");

    let (ws_stream, _) = tokio_tungstenite::connect_async(&url)
        .await
        .map_err(|e| format!("WebSocket connect failed: {e}"))?;

    let (mut ws_tx, mut ws_rx) = ws_stream.split();
    let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<WsCommand>();
    let hub_id_for_task = hub_id.clone();

    // Ask the hub to forward every channel message so we can show unread badges
    // for hubs the user isn't currently viewing.
    let _ = cmd_tx.send(WsCommand::SubscribeAll);

    let task = tokio::spawn(async move {
        loop {
            tokio::select! {
                maybe_msg = ws_rx.next() => {
                    match maybe_msg {
                        Some(Ok(WsMessage::Text(text))) => {
                            if let Ok(server_msg) = serde_json::from_str::<WsServerMessage>(&text) {
                                match server_msg {
                                    WsServerMessage::ChatMessage { channel_id, message } => {
                                        let _ = app.emit("chat-message", serde_json::json!({
                                            "hub_id": hub_id_for_task,
                                            "channel_id": channel_id,
                                            "message": message,
                                        }));
                                    }
                                    WsServerMessage::MessageEdited { channel_id, message } => {
                                        let _ = app.emit("chat-message-edited", serde_json::json!({
                                            "hub_id": hub_id_for_task,
                                            "channel_id": channel_id,
                                            "message": message,
                                        }));
                                    }
                                    WsServerMessage::MessageDeleted { channel_id, message_id } => {
                                        let _ = app.emit("chat-message-deleted", serde_json::json!({
                                            "hub_id": hub_id_for_task,
                                            "channel_id": channel_id,
                                            "message_id": message_id,
                                        }));
                                    }
                                    WsServerMessage::ReactionsUpdated { channel_id, message_id, reactions } => {
                                        let _ = app.emit("chat-reactions-updated", serde_json::json!({
                                            "hub_id": hub_id_for_task,
                                            "channel_id": channel_id,
                                            "message_id": message_id,
                                            "reactions": reactions,
                                        }));
                                    }
                                    WsServerMessage::Typing { channel_id, public_key, display_name, typing } => {
                                        let _ = app.emit("chat-typing", serde_json::json!({
                                            "hub_id": hub_id_for_task,
                                            "channel_id": channel_id,
                                            "public_key": public_key,
                                            "display_name": display_name,
                                            "typing": typing,
                                        }));
                                    }
                                    WsServerMessage::VoiceJoined { channel_id, hub_udp_port, participants } => {
                                        let _ = app.emit("voice-joined", serde_json::json!({
                                            "hub_id": hub_id_for_task,
                                            "channel_id": channel_id,
                                            "hub_udp_port": hub_udp_port,
                                            "participants": participants,
                                        }));
                                    }
                                    WsServerMessage::VoiceParticipantJoined { channel_id, participant } => {
                                        let _ = app.emit("voice-participant-joined", serde_json::json!({
                                            "hub_id": hub_id_for_task,
                                            "channel_id": channel_id,
                                            "participant": participant,
                                        }));
                                    }
                                    WsServerMessage::VoiceParticipantLeft { channel_id, public_key } => {
                                        let _ = app.emit("voice-participant-left", serde_json::json!({
                                            "hub_id": hub_id_for_task,
                                            "channel_id": channel_id,
                                            "public_key": public_key,
                                        }));
                                    }
                                    WsServerMessage::VoiceParticipantSpeaking { channel_id, public_key, speaking } => {
                                        let _ = app.emit("voice-participant-speaking", serde_json::json!({
                                            "hub_id": hub_id_for_task,
                                            "channel_id": channel_id,
                                            "public_key": public_key,
                                            "speaking": speaking,
                                        }));
                                    }
                                    WsServerMessage::Error { context, message } => {
                                        let _ = app.emit("hub-error", serde_json::json!({
                                            "hub_id": hub_id_for_task,
                                            "context": context,
                                            "message": message,
                                        }));
                                    }
                                    WsServerMessage::DirectMessage { conversation_id, sender, sender_name, content, timestamp } => {
                                        let _ = app.emit("dm", serde_json::json!({
                                            "hub_id": hub_id_for_task,
                                            "conversation_id": conversation_id,
                                            "sender": sender,
                                            "sender_name": sender_name,
                                            "content": content,
                                            "timestamp": timestamp,
                                        }));
                                    }
                                    WsServerMessage::Other => {}
                                }
                            }
                        }
                        Some(Ok(WsMessage::Close(_))) | None => break,
                        Some(Err(e)) => {
                            eprintln!("WS recv error: {e}");
                            break;
                        }
                        _ => {}
                    }
                }
                Some(cmd) = cmd_rx.recv() => {
                    let json = match cmd {
                        WsCommand::Subscribe(channel_id) => {
                            serde_json::json!({ "type": "subscribe", "channel_id": channel_id })
                        }
                        WsCommand::Unsubscribe(channel_id) => {
                            serde_json::json!({ "type": "unsubscribe", "channel_id": channel_id })
                        }
                        WsCommand::SubscribeAll => {
                            serde_json::json!({ "type": "subscribe_all" })
                        }
                        WsCommand::VoiceJoin { channel_id, udp_port } => {
                            serde_json::json!({ "type": "voice_join", "channel_id": channel_id, "udp_port": udp_port })
                        }
                        WsCommand::VoiceLeave { channel_id } => {
                            serde_json::json!({ "type": "voice_leave", "channel_id": channel_id })
                        }
                        WsCommand::VoiceSpeaking { channel_id, speaking } => {
                            serde_json::json!({
                                "type": "voice_speaking",
                                "channel_id": channel_id,
                                "speaking": speaking,
                            })
                        }
                        WsCommand::Typing { channel_id, typing } => {
                            serde_json::json!({
                                "type": "typing",
                                "channel_id": channel_id,
                                "typing": typing,
                            })
                        }
                    };
                    if ws_tx.send(WsMessage::Text(json.to_string().into())).await.is_err() {
                        break;
                    }
                }
            }
        }
    });

    Ok((cmd_tx, task))
}

#[tauri::command]
async fn list_channels(state: State<'_, AppState>) -> Result<Vec<ChannelInfo>, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    client
        .get(format!("{hub_url}/channels"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
async fn create_channel(
    name: String,
    parent_id: Option<String>,
    is_category: bool,
    description: Option<String>,
    state: State<'_, AppState>,
) -> Result<ChannelInfo, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{hub_url}/channels"))
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "name": name,
            "parent_id": parent_id,
            "is_category": is_category,
            "description": description,
        }))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
async fn update_channel_description(
    channel_id: String,
    description: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .patch(format!("{hub_url}/channels/{channel_id}"))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "description": description }))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
async fn move_channel(
    channel_id: String,
    parent_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    // Body always contains the parent_id key so the server treats it as a real
    // change (Option<Option<String>> tri-state).
    let body = serde_json::json!({ "parent_id": parent_id });
    let resp = client
        .patch(format!("{hub_url}/channels/{channel_id}"))
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
async fn reorder_channels(
    channel_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{hub_url}/channels/reorder"))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "channel_ids": channel_ids }))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
async fn delete_channel(channel_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .delete(format!("{hub_url}/channels/{channel_id}"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
async fn list_users(state: State<'_, AppState>, app: AppHandle) -> Result<Vec<UserInfo>, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{hub_url}/users"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;

    // On 401 the session token is stale (hub restarted, kicked, etc). Try to
    // re-authenticate transparently. Only if re-auth itself fails do we treat
    // this as a terminal session loss and notify the UI.
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        let active_id = state.active_hub.lock().unwrap().clone();
        if let Some(hub_id) = active_id {
            match reauth_session(&state, &app, &hub_id).await {
                Ok(new_token) => {
                    let retry = client
                        .get(format!("{hub_url}/users"))
                        .bearer_auth(&new_token)
                        .send()
                        .await
                        .map_err(|e| format!("Failed: {e}"))?;
                    return retry.json().await.map_err(|e| format!("Invalid: {e}"))
                }
                Err(e) => {
                    // Auth refused — likely banned, or the hub identity changed.
                    let hubs = state.hubs.lock().unwrap();
                    if let Some(session) = hubs.get(&hub_id) {
                        let _ = app.emit(
                            "hub-session-lost",
                            serde_json::json!({
                                "hub_id": session.hub_id,
                                "hub_name": session.hub_name,
                            }),
                        );
                    }
                    return Err(format!("Session lost: {e}"));
                }
            }
        }
        return Err("Session lost".to_string());
    }

    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

/// Re-authenticate the identity against the hub_id's url and, on success,
/// swap in the fresh session token + restart the WS subscription so real-time
/// events keep flowing. Returns the new token.
async fn reauth_session(
    state: &State<'_, AppState>,
    app: &AppHandle,
    hub_id: &str,
) -> Result<String, String> {
    let hub_url = {
        let hubs = state.hubs.lock().unwrap();
        let s = hubs.get(hub_id).ok_or("Hub not connected")?;
        s.hub_url.clone()
    };

    let path = Identity::default_path().map_err(|e| e.to_string())?;
    let (identity, _) = Identity::load_or_create(&path).map_err(|e| e.to_string())?;
    let pub_key = identity.public_key_hex();

    let client = reqwest::Client::new();

    let challenge: ChallengeResponse = client
        .post(format!("{hub_url}/auth/challenge"))
        .json(&serde_json::json!({ "public_key": pub_key }))
        .send()
        .await
        .map_err(|e| format!("re-challenge: {e}"))?
        .json()
        .await
        .map_err(|e| format!("re-challenge decode: {e}"))?;

    let challenge_bytes =
        hex::decode(&challenge.challenge).map_err(|e| format!("bad challenge hex: {e}"))?;
    let signature = identity.sign(&challenge_bytes);

    let verify_resp = client
        .post(format!("{hub_url}/auth/verify"))
        .json(&serde_json::json!({
            "public_key": pub_key,
            "challenge": challenge.challenge,
            "signature": hex::encode(signature.to_bytes()),
        }))
        .send()
        .await
        .map_err(|e| format!("re-verify: {e}"))?;

    if !verify_resp.status().is_success() {
        return Err(format!(
            "re-verify rejected ({}): {}",
            verify_resp.status(),
            verify_resp.text().await.unwrap_or_default()
        ));
    }

    let verify: VerifyResponse = verify_resp
        .json()
        .await
        .map_err(|e| format!("re-verify decode: {e}"))?;
    let new_token = verify.token.clone();

    // Restart the WS task with the new token. Abort the stale one first.
    let (old_task, hub_id_clone) = {
        let mut hubs = state.hubs.lock().unwrap();
        let session = hubs.get_mut(hub_id).ok_or("Hub vanished mid-reauth")?;
        session.token = new_token.clone();
        let old_task =
            std::mem::replace(&mut session.ws_task, tokio::spawn(async {}));
        (old_task, session.hub_id.clone())
    };
    old_task.abort();

    let (new_cmd_tx, new_task) =
        spawn_ws_task(hub_id_clone.clone(), hub_url, new_token.clone(), app.clone())
            .await
            .map_err(|e| format!("ws reconnect: {e}"))?;

    {
        let mut hubs = state.hubs.lock().unwrap();
        if let Some(session) = hubs.get_mut(hub_id) {
            session.ws_tx = new_cmd_tx;
            session.ws_task = new_task;
        }
    }

    println!("Re-authenticated with hub {}", &hub_id_clone[..16]);
    Ok(new_token)
}

#[tauri::command]
async fn get_messages(
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<MessageInfo>, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let mut messages: Vec<MessageInfo> = client
        .get(format!("{hub_url}/channels/{channel_id}/messages"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Invalid: {e}"))?;

    messages.reverse();
    Ok(messages)
}

#[tauri::command]
async fn add_reaction(
    channel_id: String,
    message_id: String,
    emoji: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!(
            "{hub_url}/channels/{channel_id}/messages/{message_id}/reactions"
        ))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "emoji": emoji }))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
async fn remove_reaction(
    channel_id: String,
    message_id: String,
    emoji: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    // URL-encoding emoji is important since some are multi-byte and can
    // include reserved chars (variation selectors, etc.).
    let encoded = urlencoding_emoji(&emoji);
    let resp = client
        .delete(format!(
            "{hub_url}/channels/{channel_id}/messages/{message_id}/reactions/{encoded}"
        ))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

/// Minimal percent-encoder for emoji path segments. We can't add a new
/// crate dep just for this; this hand-rolled version covers the chars
/// that appear in real emoji strings.
fn urlencoding_emoji(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => {
                out.push('%');
                out.push_str(&format!("{:02X}", b));
            }
        }
    }
    out
}

#[tauri::command]
async fn search_messages(
    channel_id: String,
    query: String,
    state: State<'_, AppState>,
) -> Result<Vec<MessageInfo>, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    // Server returns newest-first; we keep that order for the results panel
    // since users scanning search hits expect recent matches at the top.
    let messages: Vec<MessageInfo> = client
        .get(format!("{hub_url}/channels/{channel_id}/messages"))
        .query(&[("q", query.as_str())])
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Invalid: {e}"))?;
    Ok(messages)
}

#[tauri::command]
async fn send_message(
    channel_id: String,
    content: String,
    attachments: Option<Vec<AttachmentInfo>>,
    reply_to: Option<String>,
    state: State<'_, AppState>,
) -> Result<MessageInfo, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "content": content,
        "attachments": attachments.unwrap_or_default(),
        "reply_to": reply_to,
    });
    let resp = client
        .post(format!("{hub_url}/channels/{channel_id}/messages"))
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
async fn edit_message(
    channel_id: String,
    message_id: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<MessageInfo, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .patch(format!("{hub_url}/channels/{channel_id}/messages/{message_id}"))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "content": content }))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
async fn delete_message(
    channel_id: String,
    message_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .delete(format!("{hub_url}/channels/{channel_id}/messages/{message_id}"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
fn subscribe_channel(channel_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let tx = active_ws_tx(&state)?;
    tx.send(WsCommand::Subscribe(channel_id))
        .map_err(|_| "WS closed".to_string())
}

#[tauri::command]
fn unsubscribe_channel(channel_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let tx = active_ws_tx(&state)?;
    tx.send(WsCommand::Unsubscribe(channel_id))
        .map_err(|_| "WS closed".to_string())
}

#[tauri::command]
fn set_typing(
    channel_id: String,
    typing: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let tx = active_ws_tx(&state)?;
    // Best-effort: if the WS is closed, the user just doesn't broadcast a
    // typing event -- not worth surfacing to the UI.
    let _ = tx.send(WsCommand::Typing { channel_id, typing });
    Ok(())
}

#[tauri::command]
async fn voice_join(
    channel_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    if state.voice.lock().unwrap().is_some() {
        return Err("Already in a voice channel".to_string());
    }

    let (active_id, hub_url, ws_tx) = {
        let active_id = state
            .active_hub
            .lock()
            .unwrap()
            .clone()
            .ok_or("No active hub")?;
        let hubs = state.hubs.lock().unwrap();
        let s = hubs.get(&active_id).ok_or("Hub not connected")?;
        (active_id, s.hub_url.clone(), s.ws_tx.clone())
    };

    let host = hub_url
        .trim_start_matches("http://")
        .trim_start_matches("https://")
        .split('/')
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("127.0.0.1")
        .to_string();

    // Resolve the hostname (works for both "localhost" and raw IPs).
    let hub_addr = tokio::net::lookup_host(format!("{host}:3001"))
        .await
        .map_err(|e| format!("Cannot resolve {host}: {e}"))?
        .next()
        .ok_or_else(|| format!("No addresses for {host}"))?;

    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<u16, String>>();
    let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();

    let speaking_ws = ws_tx.clone();
    let speaking_channel_id = channel_id.clone();
    let speaking_app = app.clone();

    std::thread::spawn(move || {
        let rt = match tokio::runtime::Runtime::new() {
            Ok(r) => r,
            Err(e) => {
                let _ = ready_tx.send(Err(format!("Runtime: {e}")));
                return;
            }
        };

        rt.block_on(async move {
            let saved = load_voice_settings();
            let vsettings = voxply_voice::VoiceSettings {
                input_device: saved.input_device,
                output_device: saved.output_device,
                vad_threshold: saved.vad_threshold,
            };
            let mut pipeline = match voxply_voice::AudioPipeline::start_p2p_with_settings(
                0, hub_addr, vsettings,
            )
            .await
            {
                Ok(p) => p,
                Err(e) => {
                    let _ = ready_tx.send(Err(format!("Audio: {e}")));
                    return;
                }
            };

            let local_port = pipeline.local_udp_port;
            let _ = ready_tx.send(Ok(local_port));

            // Forward speaking state from the VAD to the hub WS and emit a
            // local Tauri event so the current user's own chip can pulse too.
            let speaking_rx = pipeline.speaking_rx.take();
            let speaking_task = tokio::spawn(async move {
                let Some(mut rx) = speaking_rx else { return };
                while let Some(speaking) = rx.recv().await {
                    let _ = speaking_ws.send(WsCommand::VoiceSpeaking {
                        channel_id: speaking_channel_id.clone(),
                        speaking,
                    });
                    let _ = speaking_app.emit(
                        "voice-self-speaking",
                        serde_json::json!({ "speaking": speaking }),
                    );
                }
            });

            // Forward live mic RMS level so the UI can draw a level meter.
            let level_rx = pipeline.level_rx.take();
            let level_app = app.clone();
            let level_task = tokio::spawn(async move {
                let Some(mut rx) = level_rx else { return };
                while let Some(level) = rx.recv().await {
                    let _ = level_app.emit("mic-level", level);
                }
            });

            let _ = tokio::task::spawn_blocking(move || stop_rx.recv()).await;
            speaking_task.abort();
            level_task.abort();
            pipeline.stop().await;
        });
    });

    let local_port = ready_rx
        .recv()
        .map_err(|_| "Voice thread died".to_string())??;

    ws_tx
        .send(WsCommand::VoiceJoin {
            channel_id: channel_id.clone(),
            udp_port: local_port,
        })
        .map_err(|_| "WS closed".to_string())?;

    *state.voice.lock().unwrap() = Some(VoiceSession {
        channel_id,
        hub_id: active_id,
        stop_tx,
    });

    Ok(())
}

#[tauri::command]
fn voice_leave(state: State<'_, AppState>) -> Result<(), String> {
    let session = state.voice.lock().unwrap().take();
    if let Some(s) = session {
        let _ = s.stop_tx.send(());
        let hubs = state.hubs.lock().unwrap();
        if let Some(hub) = hubs.get(&s.hub_id) {
            let _ = hub.ws_tx.send(WsCommand::VoiceLeave {
                channel_id: s.channel_id,
            });
        }
    }
    Ok(())
}

#[tauri::command]
fn list_audio_devices() -> Result<AudioDeviceList, String> {
    let inputs = voxply_voice::devices::list_input_devices()
        .map_err(|e| format!("inputs: {e}"))?;
    let outputs = voxply_voice::devices::list_output_devices()
        .map_err(|e| format!("outputs: {e}"))?;
    Ok(AudioDeviceList { inputs, outputs })
}

#[tauri::command]
fn get_voice_settings() -> StoredVoiceSettings {
    load_voice_settings()
}

#[tauri::command]
fn save_voice_settings(settings: StoredVoiceSettings) -> Result<(), String> {
    save_voice_settings_to_disk(&settings)
}

#[tauri::command]
fn mic_test_start(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    // Reuse the voice session slot so we don't collide with an in-progress call.
    if state.voice.lock().unwrap().is_some() {
        return Err("Leave the voice channel before testing the mic".to_string());
    }

    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();
    let level_app = app.clone();

    std::thread::spawn(move || {
        let rt = match tokio::runtime::Runtime::new() {
            Ok(r) => r,
            Err(e) => {
                let _ = ready_tx.send(Err(format!("Runtime: {e}")));
                return;
            }
        };
        rt.block_on(async move {
            let saved = load_voice_settings();
            let vsettings = voxply_voice::VoiceSettings {
                input_device: saved.input_device,
                output_device: saved.output_device,
                vad_threshold: saved.vad_threshold,
            };
            let mut pipeline =
                match voxply_voice::AudioPipeline::start_loopback_with_settings(vsettings).await {
                    Ok(p) => p,
                    Err(e) => {
                        let _ = ready_tx.send(Err(format!("Audio: {e}")));
                        return;
                    }
                };
            let _ = ready_tx.send(Ok(()));

            let level_rx = pipeline.level_rx.take();
            let level_task = tokio::spawn(async move {
                let Some(mut rx) = level_rx else { return };
                while let Some(level) = rx.recv().await {
                    let _ = level_app.emit("mic-level", level);
                }
            });

            let _ = tokio::task::spawn_blocking(move || stop_rx.recv()).await;
            level_task.abort();
            pipeline.stop().await;
        });
    });

    ready_rx
        .recv()
        .map_err(|_| "Mic test thread died".to_string())??;

    // Stash the stop channel inside a dummy VoiceSession so mic_test_stop can close it.
    *state.voice.lock().unwrap() = Some(VoiceSession {
        channel_id: "__mic_test__".to_string(),
        hub_id: String::new(),
        stop_tx,
    });

    Ok(())
}

#[tauri::command]
fn mic_test_stop(state: State<'_, AppState>) -> Result<(), String> {
    let session = state.voice.lock().unwrap().take();
    if let Some(s) = session {
        if s.channel_id == "__mic_test__" {
            let _ = s.stop_tx.send(());
            return Ok(());
        } else {
            // Put it back if it wasn't a mic test.
            *state.voice.lock().unwrap() = Some(s);
            return Err("No mic test in progress".to_string());
        }
    }
    Ok(())
}

#[tauri::command]
async fn update_display_name(display_name: String, state: State<'_, AppState>) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .patch(format!("{hub_url}/me"))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "display_name": display_name }))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
async fn update_avatar(avatar: String, state: State<'_, AppState>) -> Result<(), String> {
    // Empty string clears the avatar on this hub.
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .patch(format!("{hub_url}/me"))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "avatar": avatar }))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
fn get_recovery_phrase() -> Result<String, String> {
    let path = Identity::default_path().map_err(|e| e.to_string())?;
    let identity = Identity::load(&path).map_err(|e| e.to_string())?;
    Ok(identity.recovery_phrase())
}

#[tauri::command]
fn recover_identity_from_phrase(
    phrase: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // Validate + reconstruct first so we can fail without touching anything.
    let restored = Identity::from_recovery_phrase(phrase.trim())
        .map_err(|e| format!("Invalid recovery phrase: {e}"))?;
    let new_pubkey = restored.public_key_hex();

    let identity_path = Identity::default_path().map_err(|e| e.to_string())?;

    // Tear down every live hub session — their tokens belong to the old
    // identity and won't authenticate anymore. We drain the map first, then
    // abort outside the lock so a slow shutdown doesn't hold it.
    let drained: Vec<_> = state
        .hubs
        .lock()
        .unwrap()
        .drain()
        .map(|(_, s)| s.ws_task)
        .collect();
    for task in drained {
        task.abort();
    }
    *state.active_hub.lock().unwrap() = None;
    save_active_hub_id(None);

    // Wipe the persisted hubs list — the user will re-add hubs under the
    // restored identity. Any hub that knew the old key as a member will
    // see the new key as a stranger.
    let _ = save_hubs_list(&[]);

    restored
        .save(&identity_path)
        .map_err(|e| format!("Failed to save identity: {e}"))?;

    Ok(new_pubkey)
}

#[tauri::command]
fn get_my_public_key() -> Result<String, String> {
    let path = Identity::default_path().map_err(|e| e.to_string())?;
    let (identity, _) = Identity::load_or_create(&path).map_err(|e| e.to_string())?;
    Ok(identity.public_key_hex())
}

#[derive(Serialize, Deserialize, Clone)]
struct BanInfo {
    target_public_key: String,
    banned_by: String,
    reason: Option<String>,
    created_at: i64,
}

#[derive(Serialize, Deserialize, Clone)]
struct AllianceInfo {
    id: String,
    name: String,
    created_by: String,
    created_at: i64,
}

#[derive(Serialize, Deserialize, Clone)]
struct AllianceMemberInfo {
    hub_public_key: String,
    hub_name: String,
    hub_url: String,
    joined_at: i64,
}

#[derive(Serialize, Deserialize, Clone)]
struct AllianceDetail {
    id: String,
    name: String,
    created_by: String,
    created_at: i64,
    members: Vec<AllianceMemberInfo>,
}

#[derive(Serialize, Deserialize, Clone)]
struct AllianceInvite {
    token: String,
    alliance_id: String,
    alliance_name: String,
    hub_url: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct AllianceSharedChannel {
    channel_id: String,
    channel_name: String,
    hub_public_key: String,
    hub_name: String,
}

#[tauri::command]
async fn list_alliances(state: State<'_, AppState>) -> Result<Vec<AllianceInfo>, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{hub_url}/alliances"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
async fn create_alliance(
    name: String,
    state: State<'_, AppState>,
) -> Result<AllianceInfo, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{hub_url}/alliances"))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "name": name }))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
async fn get_alliance(
    alliance_id: String,
    state: State<'_, AppState>,
) -> Result<AllianceDetail, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{hub_url}/alliances/{alliance_id}"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
async fn create_alliance_invite(
    alliance_id: String,
    state: State<'_, AppState>,
) -> Result<AllianceInvite, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{hub_url}/alliances/{alliance_id}/invite"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
async fn join_alliance(
    inviter_hub_url: String,
    alliance_id: String,
    invite_token: String,
    own_hub_public_url: String,
    state: State<'_, AppState>,
) -> Result<AllianceDetail, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    // The join endpoint runs on OUR hub; our hub then talks to the inviter
    // and mirrors the alliance into our local DB so it shows up in our list.
    let resp = client
        .post(format!("{hub_url}/alliances/join"))
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "inviter_hub_url": inviter_hub_url,
            "alliance_id": alliance_id,
            "invite_token": invite_token,
            "own_hub_url": own_hub_public_url,
        }))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
async fn leave_alliance(
    alliance_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .delete(format!("{hub_url}/alliances/{alliance_id}/leave"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[derive(Serialize, Deserialize, Clone)]
struct ProxiedMessage {
    id: String,
    channel_id: String,
    sender: String,
    sender_name: Option<String>,
    content: String,
    created_at: i64,
    edited_at: Option<i64>,
    #[serde(default)]
    attachments: Vec<AttachmentInfo>,
}

#[tauri::command]
async fn get_alliance_channel_messages(
    alliance_id: String,
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ProxiedMessage>, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!(
            "{hub_url}/alliances/{alliance_id}/channels/{channel_id}/messages"
        ))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
async fn send_alliance_channel_message(
    alliance_id: String,
    channel_id: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!(
            "{hub_url}/alliances/{alliance_id}/channels/{channel_id}/messages"
        ))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "content": content }))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
async fn list_alliance_shared_channels(
    alliance_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<AllianceSharedChannel>, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{hub_url}/alliances/{alliance_id}/channels"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
async fn share_channel_with_alliance(
    alliance_id: String,
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{hub_url}/alliances/{alliance_id}/channels"))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "channel_id": channel_id }))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
async fn unshare_channel_from_alliance(
    alliance_id: String,
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .delete(format!(
            "{hub_url}/alliances/{alliance_id}/channels/{channel_id}"
        ))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[derive(Serialize, Deserialize, Clone)]
struct InviteInfo {
    code: String,
    created_by: String,
    max_uses: Option<i64>,
    uses: i64,
    expires_at: Option<i64>,
    created_at: i64,
}

#[tauri::command]
async fn list_invites(state: State<'_, AppState>) -> Result<Vec<InviteInfo>, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{hub_url}/invites"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
async fn create_invite(
    max_uses: Option<i64>,
    expires_in_seconds: Option<i64>,
    state: State<'_, AppState>,
) -> Result<InviteInfo, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{hub_url}/invites"))
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "max_uses": max_uses,
            "expires_in_seconds": expires_in_seconds,
        }))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
async fn revoke_invite(code: String, state: State<'_, AppState>) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .delete(format!("{hub_url}/invites/{code}"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
async fn list_bans(state: State<'_, AppState>) -> Result<Vec<BanInfo>, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{hub_url}/moderation/bans"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
async fn unban_user(
    target_public_key: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .delete(format!("{hub_url}/moderation/bans/{target_public_key}"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[derive(Serialize, Deserialize, Clone)]
struct MemberAdminInfo {
    public_key: String,
    display_name: Option<String>,
    online: bool,
    first_seen_at: i64,
    last_seen_at: i64,
    roles: Vec<RoleInfo>,
}

#[tauri::command]
async fn get_hub_settings(state: State<'_, AppState>) -> Result<HubSettings, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{hub_url}/hub/settings"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
async fn list_pending_members(
    state: State<'_, AppState>,
) -> Result<Vec<PendingUser>, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{hub_url}/hub/pending"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
async fn list_installed_games(
    state: State<'_, AppState>,
) -> Result<Vec<InstalledGame>, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{hub_url}/hub/games"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
async fn install_game(
    manifest_url: String,
    manifest: Option<GameManifest>,
    state: State<'_, AppState>,
) -> Result<InstalledGame, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{hub_url}/hub/games"))
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "manifest_url": manifest_url,
            "manifest": manifest,
        }))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
async fn uninstall_game(game_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .delete(format!("{hub_url}/hub/games/{game_id}"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
async fn approve_member(
    target_public_key: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{hub_url}/hub/pending/{target_public_key}/approve"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
async fn list_hub_members(
    state: State<'_, AppState>,
) -> Result<Vec<MemberAdminInfo>, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{hub_url}/hub/members"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
async fn kick_user_cmd(
    target_public_key: String,
    reason: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    post_moderation(&state, "moderation/kick", serde_json::json!({
        "target_public_key": target_public_key,
        "reason": reason,
    }))
    .await
}

#[tauri::command]
async fn ban_user_cmd(
    target_public_key: String,
    reason: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    post_moderation(&state, "moderation/bans", serde_json::json!({
        "target_public_key": target_public_key,
        "reason": reason,
    }))
    .await
}

#[tauri::command]
async fn mute_user_cmd(
    target_public_key: String,
    reason: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    post_moderation(&state, "moderation/mutes", serde_json::json!({
        "target_public_key": target_public_key,
        "reason": reason,
    }))
    .await
}

#[tauri::command]
async fn timeout_user_cmd(
    target_public_key: String,
    duration_seconds: u64,
    reason: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    post_moderation(&state, "moderation/timeout", serde_json::json!({
        "target_public_key": target_public_key,
        "duration_seconds": duration_seconds,
        "reason": reason,
    }))
    .await
}

#[derive(Serialize, Deserialize, Clone)]
struct ChannelBanInfo {
    channel_id: String,
    target_public_key: String,
    banned_by: String,
    reason: Option<String>,
    created_at: i64,
}

#[tauri::command]
async fn channel_ban_user(
    channel_id: String,
    target_public_key: String,
    reason: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!(
            "{hub_url}/moderation/channels/{channel_id}/bans"
        ))
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "target_public_key": target_public_key,
            "reason": reason,
        }))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
async fn channel_unban_user(
    channel_id: String,
    target_public_key: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .delete(format!(
            "{hub_url}/moderation/channels/{channel_id}/bans/{target_public_key}"
        ))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
async fn list_channel_bans(
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ChannelBanInfo>, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!(
            "{hub_url}/moderation/channels/{channel_id}/bans"
        ))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[derive(Serialize, Deserialize, Clone)]
struct VoiceMuteInfo {
    target_public_key: String,
    muted_by: String,
    reason: Option<String>,
    created_at: i64,
}

#[tauri::command]
async fn voice_mute_user_cmd(
    target_public_key: String,
    reason: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    post_moderation(&state, "moderation/voice-mutes", serde_json::json!({
        "target_public_key": target_public_key,
        "reason": reason,
    }))
    .await
}

#[tauri::command]
async fn voice_unmute_user_cmd(
    target_public_key: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .delete(format!("{hub_url}/moderation/voice-mutes/{target_public_key}"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
async fn list_voice_mutes(state: State<'_, AppState>) -> Result<Vec<VoiceMuteInfo>, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{hub_url}/moderation/voice-mutes"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[derive(Serialize, Deserialize, Clone)]
struct TalkPowerInfo {
    channel_id: String,
    min_talk_power: i64,
}

#[tauri::command]
async fn get_talk_power(
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<TalkPowerInfo, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{hub_url}/channels/{channel_id}/talk-power"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
async fn set_talk_power_cmd(
    channel_id: String,
    min_talk_power: i64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{hub_url}/channels/{channel_id}/talk-power"))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "min_talk_power": min_talk_power }))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

async fn post_moderation(
    state: &State<'_, AppState>,
    path: &str,
    body: serde_json::Value,
) -> Result<(), String> {
    let (hub_url, token) = active_session(state)?;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{hub_url}/{path}"))
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
async fn assign_role(
    target_public_key: String,
    role_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .put(format!("{hub_url}/users/{target_public_key}/roles/{role_id}"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
async fn unassign_role(
    target_public_key: String,
    role_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .delete(format!("{hub_url}/users/{target_public_key}/roles/{role_id}"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
async fn list_roles(state: State<'_, AppState>) -> Result<Vec<RoleInfo>, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    client
        .get(format!("{hub_url}/roles"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
async fn create_role(
    name: String,
    permissions: Vec<String>,
    priority: i64,
    display_separately: Option<bool>,
    state: State<'_, AppState>,
) -> Result<RoleInfo, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{hub_url}/roles"))
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "name": name,
            "permissions": permissions,
            "priority": priority,
            "display_separately": display_separately.unwrap_or(false),
        }))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
async fn update_role(
    role_id: String,
    name: Option<String>,
    permissions: Option<Vec<String>>,
    priority: Option<i64>,
    display_separately: Option<bool>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .patch(format!("{hub_url}/roles/{role_id}"))
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "name": name,
            "permissions": permissions,
            "priority": priority,
            "display_separately": display_separately,
        }))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
async fn delete_role(role_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .delete(format!("{hub_url}/roles/{role_id}"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
async fn get_me(state: State<'_, AppState>) -> Result<MeInfo, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    client
        .get(format!("{hub_url}/me"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
async fn get_hub_branding(state: State<'_, AppState>) -> Result<HubBranding, String> {
    let (hub_url, _) = active_session(&state)?;
    let client = reqwest::Client::new();
    let info: InfoResponse = client
        .get(format!("{hub_url}/info"))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Invalid: {e}"))?;
    Ok(HubBranding {
        name: info.name,
        description: info.description,
        icon: info.icon,
    })
}

#[tauri::command]
async fn update_hub_branding(
    name: Option<String>,
    description: Option<String>,
    icon: Option<String>,
    require_approval: Option<bool>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .patch(format!("{hub_url}/hub"))
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "name": name,
            "description": description,
            "icon": icon,
            "require_approval": require_approval,
        }))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }

    // Update the in-memory branding in the active session so list_hubs reflects it.
    if let Some(active_id) = state.active_hub.lock().unwrap().clone() {
        if let Some(s) = state.hubs.lock().unwrap().get_mut(&active_id) {
            if let Some(new_name) = name {
                s.hub_name = new_name;
            }
            if let Some(new_icon) = icon {
                s.hub_icon = if new_icon.is_empty() { None } else { Some(new_icon) };
            }
        }
    }

    Ok(())
}

#[tauri::command]
async fn list_friends(state: State<'_, AppState>) -> Result<Vec<FriendInfo>, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    client
        .get(format!("{hub_url}/friends"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
async fn list_pending_friends(state: State<'_, AppState>) -> Result<Vec<FriendInfo>, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    client
        .get(format!("{hub_url}/friends/pending"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
async fn send_friend_request(target_public_key: String, state: State<'_, AppState>) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{hub_url}/friends"))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "target_public_key": target_public_key }))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
async fn accept_friend(from_public_key: String, state: State<'_, AppState>) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{hub_url}/friends/{from_public_key}/accept"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
async fn remove_friend(target_public_key: String, state: State<'_, AppState>) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .delete(format!("{hub_url}/friends/{target_public_key}"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
async fn list_conversations(state: State<'_, AppState>) -> Result<Vec<ConversationInfo>, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    client
        .get(format!("{hub_url}/conversations"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
async fn create_conversation(
    members: Vec<String>,
    member_hubs: Option<HashMap<String, String>>,
    state: State<'_, AppState>,
) -> Result<ConversationInfo, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{hub_url}/conversations"))
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "members": members,
            "member_hubs": member_hubs.unwrap_or_default(),
        }))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
async fn get_dm_messages(
    conversation_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<DmMessageInfo>, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    client
        .get(format!("{hub_url}/conversations/{conversation_id}/messages"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
async fn send_dm(conversation_id: String, content: String, state: State<'_, AppState>) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{hub_url}/conversations/{conversation_id}/messages"))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "content": content }))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

/// Update the tray tooltip + title to reflect current unread count. Called
/// from the frontend whenever the aggregated unread number changes.
#[tauri::command]
fn set_tray_unread(count: u32, app: AppHandle) -> Result<(), String> {
    let tray = app.tray_by_id("main").ok_or("tray missing")?;
    let label = if count == 0 {
        "Voxply".to_string()
    } else if count > 99 {
        "Voxply — 99+ unread".to_string()
    } else {
        format!("Voxply — {count} unread")
    };
    tray.set_tooltip(Some(&label)).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            app.manage(AppState::default());

            // System tray: a "Show Voxply" / "Quit" menu plus left-click to
            // focus the main window. Tooltip carries the unread count, kept
            // in sync by the frontend via set_tray_unread.
            let show = MenuItem::with_id(app, "show", "Show Voxply", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let _tray = TrayIconBuilder::with_id("main")
                .tooltip("Voxply")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    use tauri::tray::TrayIconEvent;
                    if let TrayIconEvent::Click { button, button_state, .. } = event {
                        if button == tauri::tray::MouseButton::Left
                            && button_state == tauri::tray::MouseButtonState::Up
                        {
                            if let Some(w) = tray.app_handle().get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            add_hub,
            list_hubs,
            ping_hub,
            set_active_hub,
            remove_hub,
            auto_connect_saved,
            list_channels,
            create_channel,
            update_channel_description,
            move_channel,
            delete_channel,
            reorder_channels,
            list_users,
            get_messages,
            search_messages,
            add_reaction,
            remove_reaction,
            send_message,
            edit_message,
            delete_message,
            subscribe_channel,
            unsubscribe_channel,
            set_typing,
            voice_join,
            voice_leave,
            list_audio_devices,
            get_voice_settings,
            save_voice_settings,
            mic_test_start,
            mic_test_stop,
            update_display_name,
            update_avatar,
            get_profile,
            save_profile,
            get_recovery_phrase,
            recover_identity_from_phrase,
            get_my_public_key,
            get_me,
            get_hub_branding,
            update_hub_branding,
            list_roles,
            create_role,
            update_role,
            delete_role,
            get_hub_settings,
            list_pending_members,
            approve_member,
            list_installed_games,
            install_game,
            uninstall_game,
            list_hub_members,
            kick_user_cmd,
            ban_user_cmd,
            mute_user_cmd,
            timeout_user_cmd,
            voice_mute_user_cmd,
            voice_unmute_user_cmd,
            list_voice_mutes,
            channel_ban_user,
            channel_unban_user,
            list_channel_bans,
            set_tray_unread,
            load_unread_state,
            save_unread_state,
            get_talk_power,
            set_talk_power_cmd,
            assign_role,
            unassign_role,
            list_bans,
            unban_user,
            list_invites,
            create_invite,
            revoke_invite,
            list_alliances,
            create_alliance,
            get_alliance,
            create_alliance_invite,
            join_alliance,
            leave_alliance,
            list_alliance_shared_channels,
            get_alliance_channel_messages,
            send_alliance_channel_message,
            share_channel_with_alliance,
            unshare_channel_from_alliance,
            list_friends,
            list_pending_friends,
            send_friend_request,
            accept_friend,
            remove_friend,
            list_conversations,
            create_conversation,
            get_dm_messages,
            send_dm,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
