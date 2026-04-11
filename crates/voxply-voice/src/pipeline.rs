use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use ringbuf::HeapRb;
use ringbuf::traits::{Consumer, Producer, Split};
use tokio::task::JoinHandle;

use crate::capture::AudioCapture;
use crate::codec::{self, VoiceDecoder, VoiceEncoder};
use crate::playback::AudioPlayback;
use crate::protocol::{VoicePacket, RING_BUFFER_SIZE};
use crate::transport::VoiceSocket;

pub struct AudioPipeline {
    _capture: AudioCapture,
    _playback: AudioPlayback,
    tasks: Vec<JoinHandle<()>>,
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
        let capture_rb = HeapRb::<f32>::new(RING_BUFFER_SIZE);
        let (capture_prod, mut capture_cons) = capture_rb.split();

        let playback_rb = HeapRb::<f32>::new(RING_BUFFER_SIZE);
        let (mut playback_prod, playback_cons) = playback_rb.split();

        let capture = AudioCapture::start(capture_prod)?;
        let playback = AudioPlayback::start(playback_cons)?;

        let opus_rate = resolve_opus_rate(capture.actual_sample_rate);
        let frame_size = codec::frame_size_for_rate(opus_rate);

        let task = tokio::spawn(async move {
            let mut encoder = VoiceEncoder::new(opus_rate).expect("Failed to create encoder");
            let mut decoder = VoiceDecoder::new(opus_rate).expect("Failed to create decoder");
            let mut read_buf = vec![0.0f32; frame_size];
            let mut interval = tokio::time::interval(Duration::from_millis(10));

            loop {
                interval.tick().await;

                let count = capture_cons.pop_slice(&mut read_buf);
                if count == 0 {
                    continue;
                }

                let packets = encoder.encode(&read_buf[..count]);

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
        })
    }

    /// P2P mode: capture → encode → UDP send to remote,
    /// UDP recv from remote → decode → playback.
    pub async fn start_p2p(local_port: u16, remote_addr: SocketAddr) -> Result<Self> {
        let capture_rb = HeapRb::<f32>::new(RING_BUFFER_SIZE);
        let (capture_prod, mut capture_cons) = capture_rb.split();

        let playback_rb = HeapRb::<f32>::new(RING_BUFFER_SIZE);
        let (mut playback_prod, playback_cons) = playback_rb.split();

        let capture = AudioCapture::start(capture_prod)?;
        let playback = AudioPlayback::start(playback_cons)?;

        let opus_rate = resolve_opus_rate(capture.actual_sample_rate);
        let frame_size = codec::frame_size_for_rate(opus_rate);

        let mut socket = VoiceSocket::bind(local_port).await?;
        socket.set_remote(remote_addr);
        let socket = Arc::new(socket);

        // Send task: capture → encode → UDP
        let send_socket = socket.clone();
        let send_task = tokio::spawn(async move {
            let mut encoder = VoiceEncoder::new(opus_rate).expect("Failed to create encoder");
            let mut read_buf = vec![0.0f32; frame_size];
            let mut interval = tokio::time::interval(Duration::from_millis(10));
            let mut sequence: u16 = 0;
            let mut timestamp: u32 = 0;

            loop {
                interval.tick().await;

                let count = capture_cons.pop_slice(&mut read_buf);
                if count == 0 {
                    continue;
                }

                let packets = encoder.encode(&read_buf[..count]);

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
        })
    }

    pub async fn stop(self) {
        for task in self.tasks {
            task.abort();
        }
    }
}
