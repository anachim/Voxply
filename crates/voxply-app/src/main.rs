use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use voxply_identity::Identity;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    tracing::info!("Starting Voxply...");

    let path = Identity::default_path()?;
    let (identity, is_new) = Identity::load_or_create(&path)?;

    if is_new {
        tracing::info!("Generated new identity: {}", identity);
    } else {
        tracing::info!("Loaded existing identity: {}", identity);
    }

    let hub_url = "http://localhost:3000";
    match authenticate(&identity, hub_url).await {
        Ok(token) => {
            tracing::info!("Authenticated to hub! Token: {}...", &token[..16]);

            let me = get_me(hub_url, &token).await?;
            tracing::info!("Hub confirms identity: {}", me.public_key);
        }
        Err(e) => {
            tracing::warn!("Could not connect to hub: {e}");
            tracing::info!("Running in offline mode.");
        }
    }

    tracing::info!("Voxply shut down cleanly.");
    Ok(())
}

async fn authenticate(identity: &Identity, hub_url: &str) -> Result<String> {
    let client = reqwest::Client::new();
    let pub_key = identity.public_key_hex();

    let challenge_resp: ChallengeResponse = client
        .post(format!("{hub_url}/auth/challenge"))
        .json(&ChallengeRequest {
            public_key: pub_key.clone(),
        })
        .send()
        .await
        .context("Failed to connect to hub")?
        .json()
        .await
        .context("Invalid challenge response")?;

    tracing::info!("Received challenge from hub");

    let challenge_bytes = hex::decode(&challenge_resp.challenge)
        .context("Invalid challenge hex")?;
    let signature = identity.sign(&challenge_bytes);
    let signature_hex = hex::encode(signature.to_bytes());

    let verify_resp: VerifyResponse = client
        .post(format!("{hub_url}/auth/verify"))
        .json(&VerifyRequest {
            public_key: pub_key,
            challenge: challenge_resp.challenge,
            signature: signature_hex,
        })
        .send()
        .await
        .context("Failed to verify with hub")?
        .json()
        .await
        .context("Invalid verify response")?;

    Ok(verify_resp.token)
}

async fn get_me(hub_url: &str, token: &str) -> Result<MeResponse> {
    let client = reqwest::Client::new();
    let resp: MeResponse = client
        .get(format!("{hub_url}/me"))
        .bearer_auth(token)
        .send()
        .await
        .context("Failed to call /me")?
        .json()
        .await
        .context("Invalid /me response")?;
    Ok(resp)
}

#[derive(Serialize)]
struct ChallengeRequest {
    public_key: String,
}

#[derive(Deserialize)]
struct ChallengeResponse {
    challenge: String,
}

#[derive(Serialize)]
struct VerifyRequest {
    public_key: String,
    challenge: String,
    signature: String,
}

#[derive(Deserialize)]
struct VerifyResponse {
    token: String,
}

#[derive(Deserialize)]
struct MeResponse {
    public_key: String,
}
