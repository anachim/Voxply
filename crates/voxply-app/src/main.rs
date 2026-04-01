//! Voxply — decentralized voice chat + platform gaming
//!
//! This is the main entry point. It initializes all subsystems
//! (networking, voice, rendering, scripting, identity, world)
//! and runs the application loop.

use anyhow::Result;
use voxply_identity::Identity;

#[tokio::main]
async fn main() -> Result<()> {
    // Set up logging so we can see what's happening in the terminal.
    tracing_subscriber::fmt::init();

    tracing::info!("Starting Voxply...");

    // Load existing identity or create a new one
    let path = Identity::default_path()?;
    let (identity, is_new) = Identity::load_or_create(&path)?;

    if is_new {
        tracing::info!("Generated new identity: {}", identity);
    } else {
        tracing::info!("Loaded existing identity: {}", identity);
    }

    // TODO: Initialize other subsystems
    // - voxply_net::init()       — start libp2p node
    // - voxply_voice::init()     — set up WebRTC
    // - voxply_world::init()     — create game world
    // - voxply_script::init()    — load Lua/WASM runtime
    // - voxply_render::run()     — open window and start render loop

    tracing::info!("Voxply shut down cleanly.");
    Ok(())
}
