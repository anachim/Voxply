use anyhow::Result;
use crossterm::event::{KeyCode, KeyEvent};
use futures_util::SinkExt;
use tokio_tungstenite::tungstenite::Message;

use crate::app::{App, Focus};
use crate::protocol::WsClientMessage;

type WsTx = futures_util::stream::SplitSink<
    tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    Message,
>;

pub async fn handle_key(app: &mut App, ws_tx: &mut WsTx, key: KeyEvent) -> Result<()> {
    match app.focus {
        Focus::Channels => handle_channels(app, key),
        Focus::Messages => handle_messages(app, key),
        Focus::Input => handle_input(app, ws_tx, key).await?,
    }
    Ok(())
}

fn handle_channels(app: &mut App, key: KeyEvent) {
    match key.code {
        KeyCode::Up => {
            if app.selected_channel > 0 {
                app.selected_channel -= 1;
            }
        }
        KeyCode::Down => {
            if app.selected_channel + 1 < app.channels.len() {
                app.selected_channel += 1;
            }
        }
        KeyCode::Enter => {
            app.focus = Focus::Input;
        }
        _ => {}
    }
}

fn handle_messages(app: &mut App, key: KeyEvent) {
    match key.code {
        KeyCode::Esc => {
            app.focus = Focus::Channels;
        }
        _ => {}
    }
}

async fn handle_input(app: &mut App, ws_tx: &mut WsTx, key: KeyEvent) -> Result<()> {
    match key.code {
        KeyCode::Enter => {
            if !app.input_buffer.is_empty() {
                let content = app.input_buffer.drain(..).collect::<String>();

                if let Some(name) = content.strip_prefix("/create ") {
                    let name = name.trim();
                    if !name.is_empty() {
                        let channel = app.hub_client.create_channel(name).await?;
                        app.channels.push(channel);
                        app.selected_channel = app.channels.len() - 1;
                        app.channel_changed = true;
                    }
                } else if content.trim() == "/voice join" {
                    if let Some(channel_id) = app.current_channel_id().map(|s| s.to_string()) {
                        if app.voice_channel.is_none() {
                            // Start pipeline first to discover our actual UDP port
                            let hub_addr = format!(
                                "127.0.0.1:{}",
                                app.voice_hub_port.unwrap_or(3001)
                            ).parse().unwrap();

                            match voxply_voice::AudioPipeline::start_p2p(0, hub_addr).await {
                                Ok(pipeline) => {
                                    let local_port = pipeline.local_udp_port;
                                    app.voice_pipeline = Some(pipeline);
                                    app.voice_channel = Some(channel_id.clone());

                                    let msg = WsClientMessage::VoiceJoin {
                                        channel_id,
                                        udp_port: local_port,
                                    };
                                    let json = serde_json::to_string(&msg)?;
                                    ws_tx.send(Message::Text(json.into())).await?;
                                }
                                Err(e) => {
                                    tracing::error!("Failed to start voice: {e}");
                                }
                            }
                        }
                    }
                } else if content.trim() == "/voice leave" {
                    if let Some(channel_id) = app.voice_channel.take() {
                        let msg = WsClientMessage::VoiceLeave { channel_id };
                        let json = serde_json::to_string(&msg)?;
                        ws_tx.send(Message::Text(json.into())).await?;

                        if let Some(pipeline) = app.voice_pipeline.take() {
                            pipeline.stop().await;
                        }
                        app.voice_participants.clear();
                        app.voice_hub_port = None;
                    }
                } else if let Some(channel_id) = app.current_channel_id().map(|s| s.to_string()) {
                    let msg = app.hub_client.send_message(&channel_id, &content).await?;
                    if !app.seen_message_ids.contains(&msg.id) {
                        app.seen_message_ids.insert(msg.id.clone());
                        app.messages.push(msg);
                    }
                }
            }
        }
        KeyCode::Char(c) => {
            app.input_buffer.push(c);
        }
        KeyCode::Backspace => {
            app.input_buffer.pop();
        }
        KeyCode::Esc => {
            app.focus = Focus::Channels;
        }
        _ => {}
    }
    Ok(())
}
