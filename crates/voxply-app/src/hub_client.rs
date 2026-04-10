use anyhow::{Context, Result};
use tokio_tungstenite::tungstenite::Message;
use voxply_identity::Identity;

use crate::protocol::*;

type WsStream =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

pub struct HubClient {
    http: reqwest::Client,
    pub hub_url: String,
    pub token: String,
    pub display_name: Option<String>,
}

impl HubClient {
    pub async fn connect(hub_url: &str, identity: &Identity) -> Result<Self> {
        let http = reqwest::Client::new();
        let pub_key = identity.public_key_hex();

        // Challenge
        let challenge: ChallengeResponse = http
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

        // Sign
        let challenge_bytes = hex::decode(&challenge.challenge)?;
        let signature = identity.sign(&challenge_bytes);

        // Verify
        let verify: VerifyResponse = http
            .post(format!("{hub_url}/auth/verify"))
            .json(&VerifyRequest {
                public_key: pub_key,
                challenge: challenge.challenge,
                signature: hex::encode(signature.to_bytes()),
            })
            .send()
            .await
            .context("Failed to verify with hub")?
            .json()
            .await
            .context("Invalid verify response")?;

        // Get profile
        let me: MeResponse = http
            .get(format!("{hub_url}/me"))
            .bearer_auth(&verify.token)
            .send()
            .await?
            .json()
            .await?;

        Ok(Self {
            http,
            hub_url: hub_url.to_string(),
            token: verify.token,
            display_name: me.display_name,
        })
    }

    pub async fn create_channel(&self, name: &str) -> Result<ChannelResponse> {
        self.http
            .post(format!("{}/channels", self.hub_url))
            .bearer_auth(&self.token)
            .json(&serde_json::json!({ "name": name }))
            .send()
            .await?
            .json()
            .await
            .context("Failed to create channel")
    }

    pub async fn list_channels(&self) -> Result<Vec<ChannelResponse>> {
        self.http
            .get(format!("{}/channels", self.hub_url))
            .bearer_auth(&self.token)
            .send()
            .await?
            .json()
            .await
            .context("Failed to list channels")
    }

    pub async fn get_messages(&self, channel_id: &str) -> Result<Vec<MessageResponse>> {
        let mut messages: Vec<MessageResponse> = self
            .http
            .get(format!("{}/channels/{channel_id}/messages", self.hub_url))
            .bearer_auth(&self.token)
            .send()
            .await?
            .json()
            .await
            .context("Failed to get messages")?;
        messages.reverse(); // API returns newest-first, we want oldest-first
        Ok(messages)
    }

    pub async fn send_message(
        &self,
        channel_id: &str,
        content: &str,
    ) -> Result<MessageResponse> {
        self.http
            .post(format!("{}/channels/{channel_id}/messages", self.hub_url))
            .bearer_auth(&self.token)
            .json(&SendMessageRequest {
                content: content.to_string(),
            })
            .send()
            .await?
            .json()
            .await
            .context("Failed to send message")
    }

    pub async fn connect_ws(&self) -> Result<WsStream> {
        let ws_url = self
            .hub_url
            .replace("http://", "ws://")
            .replace("https://", "wss://");
        let url = format!("{ws_url}/ws?token={}", self.token);

        let (stream, _) = tokio_tungstenite::connect_async(&url)
            .await
            .context("Failed to connect WebSocket")?;

        Ok(stream)
    }

    pub fn subscribe_msg(channel_id: &str) -> Message {
        let msg = WsClientMessage::Subscribe {
            channel_id: channel_id.to_string(),
        };
        Message::Text(serde_json::to_string(&msg).unwrap().into())
    }

    pub fn unsubscribe_msg(channel_id: &str) -> Message {
        let msg = WsClientMessage::Unsubscribe {
            channel_id: channel_id.to_string(),
        };
        Message::Text(serde_json::to_string(&msg).unwrap().into())
    }
}
