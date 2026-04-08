use std::collections::HashSet;
use std::sync::Arc;

use axum::extract::{Query, State, WebSocketUpgrade};
use axum::extract::ws::{Message, WebSocket};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use futures_util::{SinkExt, StreamExt};

use crate::routes::chat_models::{WsClientMessage, WsParams, WsServerMessage};
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

async fn handle_socket(socket: WebSocket, state: Arc<AppState>, _public_key: String) {
    let (mut ws_tx, mut ws_rx) = socket.split();
    let mut chat_rx = state.chat_tx.subscribe();
    let mut subscribed: HashSet<String> = HashSet::new();

    loop {
        tokio::select! {
            result = chat_rx.recv() => {
                match result {
                    Ok(event) => {
                        if subscribed.contains(&event.channel_id) {
                            let msg = WsServerMessage {
                                msg_type: "message".to_string(),
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
                            Err(_) => {}
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }

    tracing::info!("WebSocket disconnected");
}
