use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use anyhow::Result;
use sqlx::sqlite::SqlitePoolOptions;
use tokio::net::UdpSocket;
use tokio::sync::{broadcast, RwLock};
use voxply_hub::db;
use voxply_hub::federation::client::FederationClient;
use voxply_hub::server;
use voxply_hub::state::AppState;
use voxply_identity::Identity;

const VOICE_UDP_PORT: u16 = 3001;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    let (hub_identity, is_new) = Identity::load_or_create(Path::new("hub_identity.json"))?;
    if is_new {
        tracing::info!("Generated new hub identity: {}", hub_identity);
    } else {
        tracing::info!("Loaded hub identity: {}", hub_identity);
    }

    let db = SqlitePoolOptions::new()
        .max_connections(5)
        .connect("sqlite:hub.db?mode=rwc")
        .await?;

    db::migrations::run(&db).await?;

    let (chat_tx, _) = broadcast::channel(256);
    let (voice_event_tx, _) = broadcast::channel(256);

    let state = Arc::new(AppState {
        hub_name: "my-hub".to_string(),
        hub_identity,
        db,
        pending_challenges: RwLock::new(HashMap::new()),
        chat_tx,
        federation_client: FederationClient::new(),
        peer_tokens: RwLock::new(HashMap::new()),
        voice_channels: RwLock::new(HashMap::new()),
        voice_udp_port: VOICE_UDP_PORT,
        voice_event_tx,
    });

    // Bind voice UDP socket and start forwarding task
    let voice_socket = UdpSocket::bind(format!("0.0.0.0:{VOICE_UDP_PORT}")).await?;
    tracing::info!("Voice UDP listening on port {VOICE_UDP_PORT}");

    let voice_state = state.clone();
    tokio::spawn(async move {
        let mut buf = [0u8; 2048];
        loop {
            match voice_socket.recv_from(&mut buf).await {
                Ok((len, from_addr)) => {
                    let packet_data = buf[..len].to_vec();
                    // Find which channel this sender is in
                    let channels = voice_state.voice_channels.read().await;
                    for (_channel_id, participants) in channels.iter() {
                        // Find if this sender is a participant (by UDP addr)
                        let is_sender = participants.values().any(|addr| *addr == from_addr);
                        if is_sender {
                            // Forward to all OTHER participants in this channel
                            for (_pk, addr) in participants {
                                if *addr != from_addr {
                                    let _ = voice_socket.send_to(&packet_data, addr).await;
                                }
                            }
                            break;
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!("Voice UDP recv error: {e}");
                }
            }
        }
    });

    let app = server::create_router(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    tracing::info!("Hub server listening on http://localhost:3000");

    axum::serve(listener, app).await?;

    Ok(())
}
