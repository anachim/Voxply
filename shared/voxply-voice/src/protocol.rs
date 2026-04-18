use anyhow::{Context, Result};
use byteorder::{BigEndian, ReadBytesExt, WriteBytesExt};
use std::io::Cursor;

pub const SAMPLE_RATE: u32 = 48_000;
pub const CHANNELS: u16 = 1;
pub const FRAME_DURATION_MS: u32 = 20;
pub const FRAME_SIZE: usize = 960;
pub const MAX_PACKET_SIZE: usize = 1275;
pub const RING_BUFFER_SIZE: usize = 9600;

/// Wire format: [sequence: u16][timestamp: u32][opus_data: variable]
/// Header: 6 bytes. Max total: 6 + 1275 = 1281 bytes (well under UDP MTU).
pub struct VoicePacket {
    pub sequence: u16,
    pub timestamp: u32,
    pub opus_data: Vec<u8>,
}

impl VoicePacket {
    pub fn serialize(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(6 + self.opus_data.len());
        buf.write_u16::<BigEndian>(self.sequence).unwrap();
        buf.write_u32::<BigEndian>(self.timestamp).unwrap();
        buf.extend_from_slice(&self.opus_data);
        buf
    }

    pub fn deserialize(data: &[u8]) -> Result<Self> {
        if data.len() < 6 {
            anyhow::bail!("Packet too short: {} bytes", data.len());
        }
        let mut cursor = Cursor::new(data);
        let sequence = cursor.read_u16::<BigEndian>().context("Read sequence")?;
        let timestamp = cursor.read_u32::<BigEndian>().context("Read timestamp")?;
        let opus_data = data[6..].to_vec();

        Ok(Self {
            sequence,
            timestamp,
            opus_data,
        })
    }
}
