use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use voxply_identity::Identity;

// --- Shared state ---

#[derive(Default)]
struct AppState {
    inner: Mutex<Option<HubSession>>,
    voice: Mutex<Option<VoiceSession>>,
}

struct HubSession {
    hub_url: String,
    token: String,
    // Channel to send commands to the WS task (subscribe/unsubscribe)
    ws_tx: mpsc::UnboundedSender<WsCommand>,
    // Handle to the background WS task so we can abort on disconnect
    ws_task: JoinHandle<()>,
}

enum WsCommand {
    Subscribe(String),
    Unsubscribe(String),
    VoiceJoin { channel_id: String, udp_port: u16 },
    VoiceLeave { channel_id: String },
}

/// Voice session state. We send a "stop" signal to a background thread
/// that owns the AudioPipeline (which contains !Send cpal streams).
struct VoiceSession {
    channel_id: String,
    stop_tx: std::sync::mpsc::Sender<()>,
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
struct ChannelInfo {
    id: String,
    name: String,
    created_by: String,
    parent_id: Option<String>,
    is_category: bool,
    created_at: i64,
}

#[derive(Serialize, Deserialize, Clone)]
struct UserInfo {
    public_key: String,
    display_name: Option<String>,
    online: bool,
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

// Incoming WS message from the hub (tagged enum matching server)
#[derive(Deserialize)]
#[serde(tag = "type")]
enum WsServerMessage {
    #[serde(rename = "message")]
    ChatMessage {
        channel_id: String,
        message: MessageInfo,
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
    // Other variants we don't handle yet — serde will ignore them
    #[serde(other)]
    Other,
}

#[derive(Serialize, Deserialize, Clone)]
struct VoiceParticipantInfo {
    public_key: String,
    display_name: Option<String>,
}

// --- Tauri commands ---

#[tauri::command]
async fn connect(
    hub_url: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String, String> {
    let path = Identity::default_path().map_err(|e| e.to_string())?;
    let (identity, _) = Identity::load_or_create(&path).map_err(|e| e.to_string())?;
    let pub_key = identity.public_key_hex();

    let client = reqwest::Client::new();

    let challenge: ChallengeResponse = client
        .post(format!("{hub_url}/auth/challenge"))
        .json(&serde_json::json!({ "public_key": pub_key }))
        .send()
        .await
        .map_err(|e| format!("Failed to connect: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Invalid challenge response: {e}"))?;

    let challenge_bytes = hex::decode(&challenge.challenge)
        .map_err(|e| format!("Invalid challenge hex: {e}"))?;
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
        .map_err(|e| format!("Failed to verify: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Invalid verify response: {e}"))?;

    let token = verify.token;

    // Start the WebSocket connection
    let (cmd_tx, ws_task) = spawn_ws_task(hub_url.clone(), token.clone(), app.clone()).await?;

    *state.inner.lock().unwrap() = Some(HubSession {
        hub_url,
        token,
        ws_tx: cmd_tx,
        ws_task,
    });

    Ok(pub_key)
}

async fn spawn_ws_task(
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

    let task = tokio::spawn(async move {
        loop {
            tokio::select! {
                // Incoming WS messages from hub
                maybe_msg = ws_rx.next() => {
                    match maybe_msg {
                        Some(Ok(WsMessage::Text(text))) => {
                            if let Ok(server_msg) = serde_json::from_str::<WsServerMessage>(&text) {
                                match server_msg {
                                    WsServerMessage::ChatMessage { channel_id, message } => {
                                        let _ = app.emit("chat-message", serde_json::json!({
                                            "channel_id": channel_id,
                                            "message": message,
                                        }));
                                    }
                                    WsServerMessage::VoiceJoined { channel_id, hub_udp_port, participants } => {
                                        let _ = app.emit("voice-joined", serde_json::json!({
                                            "channel_id": channel_id,
                                            "hub_udp_port": hub_udp_port,
                                            "participants": participants,
                                        }));
                                    }
                                    WsServerMessage::VoiceParticipantJoined { channel_id, participant } => {
                                        let _ = app.emit("voice-participant-joined", serde_json::json!({
                                            "channel_id": channel_id,
                                            "participant": participant,
                                        }));
                                    }
                                    WsServerMessage::VoiceParticipantLeft { channel_id, public_key } => {
                                        let _ = app.emit("voice-participant-left", serde_json::json!({
                                            "channel_id": channel_id,
                                            "public_key": public_key,
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
                // Outgoing commands from React
                Some(cmd) = cmd_rx.recv() => {
                    let json = match cmd {
                        WsCommand::Subscribe(channel_id) => {
                            serde_json::json!({ "type": "subscribe", "channel_id": channel_id })
                        }
                        WsCommand::Unsubscribe(channel_id) => {
                            serde_json::json!({ "type": "unsubscribe", "channel_id": channel_id })
                        }
                        WsCommand::VoiceJoin { channel_id, udp_port } => {
                            serde_json::json!({ "type": "voice_join", "channel_id": channel_id, "udp_port": udp_port })
                        }
                        WsCommand::VoiceLeave { channel_id } => {
                            serde_json::json!({ "type": "voice_leave", "channel_id": channel_id })
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

#[tauri::command]
async fn create_channel(
    name: String,
    parent_id: Option<String>,
    is_category: bool,
    state: State<'_, AppState>,
) -> Result<ChannelInfo, String> {
    let (hub_url, token) = {
        let session = state.inner.lock().unwrap();
        let s = session.as_ref().ok_or("Not connected")?;
        (s.hub_url.clone(), s.token.clone())
    };

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{hub_url}/channels"))
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "name": name,
            "parent_id": parent_id,
            "is_category": is_category,
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to create channel: {e}"))?;

    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("Hub rejected: {body}"));
    }

    serde_json::from_str(&body).map_err(|e| format!("Invalid response: {e}"))
}

#[tauri::command]
async fn delete_channel(
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = {
        let session = state.inner.lock().unwrap();
        let s = session.as_ref().ok_or("Not connected")?;
        (s.hub_url.clone(), s.token.clone())
    };

    let client = reqwest::Client::new();
    let resp = client
        .delete(format!("{hub_url}/channels/{channel_id}"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed to delete channel: {e}"))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Hub rejected: {body}"));
    }

    Ok(())
}

#[tauri::command]
async fn list_users(state: State<'_, AppState>) -> Result<Vec<UserInfo>, String> {
    let (hub_url, token) = {
        let session = state.inner.lock().unwrap();
        let s = session.as_ref().ok_or("Not connected")?;
        (s.hub_url.clone(), s.token.clone())
    };

    let client = reqwest::Client::new();
    client
        .get(format!("{hub_url}/users"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch users: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Invalid users response: {e}"))
}

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

    messages.reverse();
    Ok(messages)
}

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

/// Join a voice channel.
/// Starts the audio pipeline in a dedicated thread (cpal streams may be !Send),
/// then sends the VoiceJoin WS message with the actual local UDP port.
#[tauri::command]
async fn voice_join(
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Already in voice?
    if state.voice.lock().unwrap().is_some() {
        return Err("Already in a voice channel".to_string());
    }

    let (hub_url, ws_tx) = {
        let session = state.inner.lock().unwrap();
        let s = session.as_ref().ok_or("Not connected")?;
        (s.hub_url.clone(), s.ws_tx.clone())
    };

    // Hub URL is http://host:port, voice UDP is on the same host + port 3001
    let host = hub_url
        .trim_start_matches("http://")
        .trim_start_matches("https://")
        .split(':')
        .next()
        .unwrap_or("127.0.0.1")
        .to_string();
    let hub_addr: std::net::SocketAddr = format!("{host}:3001")
        .parse()
        .map_err(|e| format!("Bad hub address: {e}"))?;

    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<u16, String>>();
    let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();

    // Run the pipeline in a dedicated thread with its own tokio runtime.
    // The cpal streams stay on this thread and don't need to be Send.
    std::thread::spawn(move || {
        let rt = match tokio::runtime::Runtime::new() {
            Ok(r) => r,
            Err(e) => {
                let _ = ready_tx.send(Err(format!("Failed to create runtime: {e}")));
                return;
            }
        };

        rt.block_on(async move {
            let pipeline = match voxply_voice::AudioPipeline::start_p2p(0, hub_addr).await {
                Ok(p) => p,
                Err(e) => {
                    let _ = ready_tx.send(Err(format!("Failed to start audio: {e}")));
                    return;
                }
            };

            let local_port = pipeline.local_udp_port;
            let _ = ready_tx.send(Ok(local_port));

            // Wait for stop signal
            let _ = tokio::task::spawn_blocking(move || stop_rx.recv()).await;

            pipeline.stop().await;
        });
    });

    // Wait for the pipeline to start and get the local port
    let local_port = ready_rx
        .recv()
        .map_err(|_| "Voice thread died".to_string())??;

    // Tell the hub we're joining via WS
    ws_tx
        .send(WsCommand::VoiceJoin {
            channel_id: channel_id.clone(),
            udp_port: local_port,
        })
        .map_err(|_| "WebSocket closed".to_string())?;

    *state.voice.lock().unwrap() = Some(VoiceSession {
        channel_id,
        stop_tx,
    });

    Ok(())
}

#[tauri::command]
fn voice_leave(state: State<'_, AppState>) -> Result<(), String> {
    let session = state.voice.lock().unwrap().take();
    if let Some(s) = session {
        let _ = s.stop_tx.send(()); // signal the audio thread to stop

        // Tell hub we're leaving
        let inner = state.inner.lock().unwrap();
        if let Some(hub) = inner.as_ref() {
            let _ = hub.ws_tx.send(WsCommand::VoiceLeave {
                channel_id: s.channel_id,
            });
        }
    }
    Ok(())
}

/// Subscribe to real-time updates for a channel (via WebSocket).
#[tauri::command]
fn subscribe_channel(
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = state.inner.lock().unwrap();
    let s = session.as_ref().ok_or("Not connected")?;
    s.ws_tx
        .send(WsCommand::Subscribe(channel_id))
        .map_err(|_| "WebSocket closed".to_string())
}

/// Unsubscribe from a channel's real-time updates.
#[tauri::command]
fn unsubscribe_channel(
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = state.inner.lock().unwrap();
    let s = session.as_ref().ok_or("Not connected")?;
    s.ws_tx
        .send(WsCommand::Unsubscribe(channel_id))
        .map_err(|_| "WebSocket closed".to_string())
}

#[tauri::command]
fn disconnect(state: State<'_, AppState>) {
    // Stop voice first
    if let Some(voice) = state.voice.lock().unwrap().take() {
        let _ = voice.stop_tx.send(());
    }
    if let Some(session) = state.inner.lock().unwrap().take() {
        session.ws_task.abort();
    }
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
            create_channel,
            delete_channel,
            list_users,
            get_messages,
            send_message,
            subscribe_channel,
            unsubscribe_channel,
            voice_join,
            voice_leave,
            disconnect
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
