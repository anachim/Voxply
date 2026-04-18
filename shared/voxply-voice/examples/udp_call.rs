use anyhow::Result;
use voxply_voice::AudioPipeline;

/// Run two instances of this to test P2P voice:
///   Terminal 1: cargo run --example udp_call -p voxply-voice -- 4000 4001
///   Terminal 2: cargo run --example udp_call -p voxply-voice -- 4001 4000
///
/// First arg: local port. Second arg: remote port.
/// Both on localhost (127.0.0.1).

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        println!("Usage: udp_call <local_port> <remote_port>");
        println!("  Terminal 1: cargo run --example udp_call -p voxply-voice -- 4000 4001");
        println!("  Terminal 2: cargo run --example udp_call -p voxply-voice -- 4001 4000");
        return Ok(());
    }

    let local_port: u16 = args[1].parse()?;
    let remote_port: u16 = args[2].parse()?;
    let remote_addr = format!("127.0.0.1:{remote_port}").parse()?;

    println!("=== Voxply P2P Voice Call ===");
    println!("Local port: {local_port}, Remote: 127.0.0.1:{remote_port}");
    println!("Speak into your microphone to send audio.");
    println!("Press Ctrl+C to stop.\n");

    let pipeline = AudioPipeline::start_p2p(local_port, remote_addr).await?;

    tokio::signal::ctrl_c().await?;

    println!("\nStopping...");
    pipeline.stop().await;

    Ok(())
}
