pub const SAMPLE_RATE: u32 = 48_000;
pub const CHANNELS: u16 = 1;
pub const FRAME_DURATION_MS: u32 = 20;
pub const FRAME_SIZE: usize = 960; // 48000 * 0.020
pub const MAX_PACKET_SIZE: usize = 1275;
pub const RING_BUFFER_SIZE: usize = 9600; // ~200ms buffer
