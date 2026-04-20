use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use ringbuf::HeapRb;
use ringbuf::traits::{Consumer, Producer, Split};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::capture::AudioCapture;
use crate::codec::{self, VoiceDecoder, VoiceEncoder};
use crate::denoise::Denoiser;
use crate::playback::AudioPlayback;
use crate::protocol::{VoicePacket, RING_BUFFER_SIZE};
use crate::transport::VoiceSocket;

/// Default threshold for the RMS voice activity detector. Values in [0, 1].
/// 0.02 picks up normal speech at typical mic gain while ignoring fan/room noise.
pub const DEFAULT_VAD_THRESHOLD: f32 = 0.02;

/// How long we must stay below threshold before declaring "stopped speaking".
/// Prevents flickering on consonant gaps.
const VAD_RELEASE_MS: u64 = 250;

/// Configuration the client can tune in its settings UI.
#[derive(Clone, Debug, Default)]
pub struct VoiceSettings {
    pub input_device: Option<String>,
    pub output_device: Option<String>,
    /// VAD threshold override. `None` uses DEFAULT_VAD_THRESHOLD.
    pub vad_threshold: Option<f32>,
}

pub struct AudioPipeline {
    _capture: AudioCapture,
    _playback: AudioPlayback,
    tasks: Vec<JoinHandle<()>>,
    pub local_udp_port: u16,
    /// Receives `true` when voice activity starts, `false` when it ends.
    /// Available on pipelines started with `start_p2p` / `start_loopback_*`.
    pub speaking_rx: Option<mpsc::UnboundedReceiver<bool>>,
    /// Receives the post-denoise RMS level of each captured frame (decimated
    /// to ~20 Hz). Range is roughly 0..0.3 for normal speech.
    pub level_rx: Option<mpsc::UnboundedReceiver<f32>>,
}

fn resolve_opus_rate(device_rate: u32) -> u32 {
    match device_rate {
        8000 | 12000 | 16000 | 24000 | 48000 => device_rate,
        _ => {
            tracing::warn!(
                "Device rate {device_rate} Hz not supported by Opus, using 48000 Hz"
            );
            48000
        }
    }
}

impl AudioPipeline {
    pub async fn start_loopback() -> Result<Self> {
        Self::start_loopback_with_settings(VoiceSettings::default()).await
    }

    pub async fn start_loopback_with_settings(settings: VoiceSettings) -> Result<Self> {
        let capture_rb = HeapRb::<f32>::new(RING_BUFFER_SIZE);
        let (capture_prod, mut capture_cons) = capture_rb.split();

        let playback_rb = HeapRb::<f32>::new(RING_BUFFER_SIZE);
        let (mut playback_prod, playback_cons) = playback_rb.split();

        let capture = AudioCapture::start_with_device(capture_prod, settings.input_device.as_deref())?;
        let playback = AudioPlayback::start_with_device(playback_cons, settings.output_device.as_deref())?;

        let opus_rate = resolve_opus_rate(capture.actual_sample_rate);
        let frame_size = codec::frame_size_for_rate(opus_rate);
        let (level_tx, level_rx) = mpsc::unbounded_channel::<f32>();

        let task = tokio::spawn(async move {
            let mut encoder = VoiceEncoder::new(opus_rate).expect("Failed to create encoder");
            let mut decoder = VoiceDecoder::new(opus_rate).expect("Failed to create decoder");
            let mut denoiser = Denoiser::new();
            let mut read_buf = vec![0.0f32; frame_size];
            let mut interval = tokio::time::interval(Duration::from_millis(10));
            let mut level_tick: u32 = 0;

            loop {
                interval.tick().await;

                let count = capture_cons.pop_slice(&mut read_buf);
                if count == 0 {
                    continue;
                }

                // Denoise → encode → decode → playback
                let denoised = denoiser.process(&read_buf[..count]);

                level_tick = level_tick.wrapping_add(1);
                if level_tick % 5 == 0 {
                    let _ = level_tx.send(rms_of(&denoised));
                }

                let packets = encoder.encode(&denoised);

                for packet in &packets {
                    match decoder.decode(packet) {
                        Ok(samples) => {
                            let _ = playback_prod.push_slice(samples);
                        }
                        Err(e) => {
                            tracing::warn!("Decode error: {e}");
                        }
                    }
                }
            }
        });

        Ok(Self {
            _capture: capture,
            _playback: playback,
            tasks: vec![task],
            local_udp_port: 0,
            speaking_rx: None,
            level_rx: Some(level_rx),
        })
    }

    /// P2P mode: capture → encode → UDP send to remote,
    /// UDP recv from remote → decode → playback.
    pub async fn start_p2p(local_port: u16, remote_addr: SocketAddr) -> Result<Self> {
        Self::start_p2p_with_settings(local_port, remote_addr, VoiceSettings::default()).await
    }

    pub async fn start_p2p_with_settings(
        local_port: u16,
        remote_addr: SocketAddr,
        settings: VoiceSettings,
    ) -> Result<Self> {
        let capture_rb = HeapRb::<f32>::new(RING_BUFFER_SIZE);
        let (capture_prod, mut capture_cons) = capture_rb.split();

        let playback_rb = HeapRb::<f32>::new(RING_BUFFER_SIZE);
        let (mut playback_prod, playback_cons) = playback_rb.split();

        let capture = AudioCapture::start_with_device(capture_prod, settings.input_device.as_deref())?;
        let playback = AudioPlayback::start_with_device(playback_cons, settings.output_device.as_deref())?;

        let vad_threshold = settings.vad_threshold.unwrap_or(DEFAULT_VAD_THRESHOLD);
        let (level_tx, level_rx) = mpsc::unbounded_channel::<f32>();

        let opus_rate = resolve_opus_rate(capture.actual_sample_rate);
        let frame_size = codec::frame_size_for_rate(opus_rate);

        let mut socket = VoiceSocket::bind(local_port).await?;
        let actual_local_port = socket.local_addr()?.port();
        socket.set_remote(remote_addr);
        let socket = Arc::new(socket);

        let (speaking_tx, speaking_rx) = mpsc::unbounded_channel::<bool>();

        // Send task: capture → encode → UDP, plus RMS-based VAD + level meter
        let send_socket = socket.clone();
        let send_task = tokio::spawn(async move {
            let mut encoder = VoiceEncoder::new(opus_rate).expect("Failed to create encoder");
            let mut denoiser = Denoiser::new();
            let mut read_buf = vec![0.0f32; frame_size];
            let mut interval = tokio::time::interval(Duration::from_millis(10));
            let mut sequence: u16 = 0;
            let mut timestamp: u32 = 0;

            let mut is_speaking = false;
            let mut last_active_at: Option<std::time::Instant> = None;
            let mut level_tick: u32 = 0;

            loop {
                interval.tick().await;

                let count = capture_cons.pop_slice(&mut read_buf);
                if count == 0 {
                    // Still fire a release even without new audio.
                    if is_speaking {
                        if let Some(last) = last_active_at {
                            if last.elapsed() > Duration::from_millis(VAD_RELEASE_MS) {
                                is_speaking = false;
                                let _ = speaking_tx.send(false);
                            }
                        }
                    }
                    continue;
                }

                let denoised = denoiser.process(&read_buf[..count]);

                // Voice activity detection on post-denoise samples.
                let rms = rms_of(&denoised);

                // Decimate level emission to ~20 Hz (every 5 ticks of 10 ms).
                level_tick = level_tick.wrapping_add(1);
                if level_tick % 5 == 0 {
                    let _ = level_tx.send(rms);
                }

                if rms > vad_threshold {
                    last_active_at = Some(std::time::Instant::now());
                    if !is_speaking {
                        is_speaking = true;
                        let _ = speaking_tx.send(true);
                    }
                } else if is_speaking {
                    if let Some(last) = last_active_at {
                        if last.elapsed() > Duration::from_millis(VAD_RELEASE_MS) {
                            is_speaking = false;
                            let _ = speaking_tx.send(false);
                        }
                    }
                }

                let packets = encoder.encode(&denoised);

                for opus_data in packets {
                    let packet = VoicePacket {
                        sequence,
                        timestamp,
                        opus_data,
                    };
                    if let Err(e) = send_socket.send(&packet).await {
                        tracing::warn!("UDP send error: {e}");
                    }
                    sequence = sequence.wrapping_add(1);
                    timestamp = timestamp.wrapping_add(frame_size as u32);
                }
            }
        });

        // Receive task: UDP → decode → playback
        let recv_socket = socket.clone();
        let recv_task = tokio::spawn(async move {
            let mut decoder = VoiceDecoder::new(opus_rate).expect("Failed to create decoder");

            loop {
                match recv_socket.recv().await {
                    Ok((packet, _from)) => {
                        match decoder.decode(&packet.opus_data) {
                            Ok(samples) => {
                                let _ = playback_prod.push_slice(samples);
                            }
                            Err(e) => {
                                tracing::warn!("Decode error: {e}");
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!("UDP recv error: {e}");
                    }
                }
            }
        });

        tracing::info!("P2P voice started → {remote_addr}");

        Ok(Self {
            _capture: capture,
            _playback: playback,
            tasks: vec![send_task, recv_task],
            local_udp_port: actual_local_port,
            speaking_rx: Some(speaking_rx),
            level_rx: Some(level_rx),
        })
    }

    pub async fn stop(self) {
        for task in self.tasks {
            task.abort();
        }
    }
}

fn rms_of(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
    (sum_sq / samples.len() as f32).sqrt()
}
