use std::collections::HashSet;
use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::{Query, State, WebSocketUpgrade};
use axum::extract::ws::{Message, WebSocket};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use futures_util::{SinkExt, StreamExt};

use crate::routes::chat_models::{
    VoiceParticipantInfo, WsClientMessage, WsParams, WsServerMessage,
};
use crate::state::AppState;

pub async fn ws_handler(
    State(state): State<Arc<AppState>>,
    Query(params): Query<WsParams>,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let public_key: Option<String> =
        sqlx::query_scalar("SELECT public_key FROM sessions WHERE token = ?")
            .bind(&params.token)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    let public_key = public_key
        .ok_or((StatusCode::UNAUTHORIZED, "Invalid token".to_string()))?;

    tracing::info!("WebSocket connected: {}", &public_key[..16]);

    Ok(ws.on_upgrade(move |socket| handle_socket(socket, state, public_key)))
}

async fn handle_socket(socket: WebSocket, state: Arc<AppState>, public_key: String) {
    // Track online status
    state.online_users.write().await.insert(public_key.clone());

    let (mut ws_tx, mut ws_rx) = socket.split();
    let mut chat_rx = state.chat_tx.subscribe();
    let mut dm_rx = state.dm_tx.subscribe();
    let mut subscribed: HashSet<String> = HashSet::new();
    let mut subscribe_all = false;
    let mut voice_channel: Option<String> = None;

    // Load this user's conversation IDs for DM filtering
    let my_conversations: HashSet<String> = sqlx::query_scalar::<_, String>(
        "SELECT conversation_id FROM conversation_members WHERE public_key = ?",
    )
    .bind(&public_key)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default()
    .into_iter()
    .collect();

    loop {
        tokio::select! {
            result = chat_rx.recv() => {
                match result {
                    Ok(event) => {
                        if subscribe_all || subscribed.contains(&event.channel_id) {
                            let msg = WsServerMessage::ChatMessage {
                                channel_id: event.channel_id,
                                message: event.message,
                            };
                            let json = serde_json::to_string(&msg).unwrap();
                            if ws_tx.send(Message::Text(json.into())).await.is_err() {
                                break;
                            }
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("WebSocket client lagged, missed {n} messages");
                    }
                    Err(_) => break,
                }
            }

            msg = ws_rx.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        match serde_json::from_str::<WsClientMessage>(&text) {
                            Ok(WsClientMessage::Subscribe { channel_id }) => {
                                subscribed.insert(channel_id);
                            }
                            Ok(WsClientMessage::Unsubscribe { channel_id }) => {
                                subscribed.remove(&channel_id);
                            }
                            Ok(WsClientMessage::SubscribeAll) => {
                                subscribe_all = true;
                            }
                            Ok(WsClientMessage::VoiceJoin { channel_id, udp_port }) => {
                                let client_addr: SocketAddr =
                                    format!("127.0.0.1:{udp_port}").parse().unwrap();

                                // Register participant
                                state.voice_channels.write().await
                                    .entry(channel_id.clone())
                                    .or_default()
                                    .insert(public_key.clone(), client_addr);

                                voice_channel = Some(channel_id.clone());

                                // Get participant list
                                let participants = get_voice_participants(&state, &channel_id).await;

                                // Send confirmation to this client
                                let msg = WsServerMessage::VoiceJoined {
                                    channel_id: channel_id.clone(),
                                    hub_udp_port: state.voice_udp_port,
                                    participants: participants.clone(),
                                };
                                let json = serde_json::to_string(&msg).unwrap();
                                let _ = ws_tx.send(Message::Text(json.into())).await;

                                // Get display name for broadcast
                                let display_name: Option<String> = sqlx::query_scalar(
                                    "SELECT display_name FROM users WHERE public_key = ?",
                                )
                                .bind(&public_key)
                                .fetch_optional(&state.db)
                                .await
                                .ok()
                                .flatten();

                                // Broadcast to others via chat broadcast (they'll filter)
                                let _ = state.voice_event_tx.send((
                                    channel_id,
                                    WsServerMessage::VoiceParticipantJoined {
                                        channel_id: voice_channel.clone().unwrap(),
                                        participant: VoiceParticipantInfo {
                                            public_key: public_key.clone(),
                                            display_name,
                                        },
                                    },
                                ));

                                tracing::info!("Voice join: {} in channel", &public_key[..16]);
                            }
                            Ok(WsClientMessage::VoiceLeave { channel_id }) => {
                                leave_voice(&state, &public_key, &channel_id).await;
                                voice_channel = None;
                                tracing::info!("Voice leave: {}", &public_key[..16]);
                            }
                            Err(_) => {}
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }

            // DM relay
            dm_result = dm_rx.recv() => {
                if let Ok(dm) = dm_result {
                    // Only relay to members of this conversation (and not back to sender)
                    if dm.sender != public_key && my_conversations.contains(&dm.conversation_id) {
                        let msg = WsServerMessage::DirectMessage {
                            conversation_id: dm.conversation_id,
                            sender: dm.sender,
                            sender_name: dm.sender_name,
                            content: dm.content,
                            timestamp: dm.timestamp,
                        };
                        let json = serde_json::to_string(&msg).unwrap();
                        if ws_tx.send(Message::Text(json.into())).await.is_err() {
                            break;
                        }
                    }
                }
            }
        }
    }

    // Clean up on disconnect
    if let Some(ch_id) = voice_channel {
        leave_voice(&state, &public_key, &ch_id).await;
    }
    state.online_users.write().await.remove(&public_key);

    tracing::info!("WebSocket disconnected: {}", &public_key[..16]);
}

async fn leave_voice(state: &AppState, public_key: &str, channel_id: &str) {
    let mut channels = state.voice_channels.write().await;
    if let Some(participants) = channels.get_mut(channel_id) {
        participants.remove(public_key);
        if participants.is_empty() {
            channels.remove(channel_id);
        }
    }

    let _ = state.voice_event_tx.send((
        channel_id.to_string(),
        WsServerMessage::VoiceParticipantLeft {
            channel_id: channel_id.to_string(),
            public_key: public_key.to_string(),
        },
    ));
}

async fn get_voice_participants(state: &AppState, channel_id: &str) -> Vec<VoiceParticipantInfo> {
    let channels = state.voice_channels.read().await;
    let Some(participants) = channels.get(channel_id) else {
        return Vec::new();
    };

    let mut result = Vec::new();
    for (pk, _addr) in participants {
        let display_name: Option<String> = sqlx::query_scalar(
            "SELECT display_name FROM users WHERE public_key = ?",
        )
        .bind(pk)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();

        result.push(VoiceParticipantInfo {
            public_key: pk.clone(),
            display_name,
        });
    }
    result
}
