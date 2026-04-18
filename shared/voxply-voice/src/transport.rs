use std::net::SocketAddr;

use anyhow::{Context, Result};
use tokio::net::UdpSocket;

use crate::protocol::VoicePacket;

pub struct VoiceSocket {
    socket: UdpSocket,
    remote_addr: Option<SocketAddr>,
}

impl VoiceSocket {
    pub async fn bind(port: u16) -> Result<Self> {
        let addr = format!("0.0.0.0:{port}");
        let socket = UdpSocket::bind(&addr)
            .await
            .context(format!("Failed to bind UDP socket on {addr}"))?;

        let local = socket.local_addr()?;
        tracing::info!("Voice UDP socket bound to {local}");

        Ok(Self {
            socket,
            remote_addr: None,
        })
    }

    pub fn set_remote(&mut self, addr: SocketAddr) {
        self.remote_addr = Some(addr);
    }

    pub fn local_addr(&self) -> Result<SocketAddr> {
        self.socket.local_addr().context("Get local addr")
    }

    pub async fn send(&self, packet: &VoicePacket) -> Result<()> {
        let addr = self
            .remote_addr
            .context("No remote address set")?;
        let data = packet.serialize();
        self.socket
            .send_to(&data, addr)
            .await
            .context("UDP send failed")?;
        Ok(())
    }

    pub async fn recv(&self) -> Result<(VoicePacket, SocketAddr)> {
        let mut buf = [0u8; 2048];
        let (len, from) = self
            .socket
            .recv_from(&mut buf)
            .await
            .context("UDP recv failed")?;
        let packet = VoicePacket::deserialize(&buf[..len])?;
        Ok((packet, from))
    }
}
