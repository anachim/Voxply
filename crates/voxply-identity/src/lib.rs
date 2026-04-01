//! voxply-identity — Decentralized identity (DIDs + keypairs)
//!
//! Each user has an Ed25519 keypair. Their public key acts as their identity
//! (no central server needed). Messages are signed so others can verify
//! who sent them.

/// Placeholder — will load or generate a keypair
pub fn init() {
    tracing::info!("voxply-identity: initialized");
}
