use std::time::Duration;

use anyhow::{Context, Result};
use ringbuf::HeapRb;
use ringbuf::traits::{Consumer, Producer, Split};
use tokio::task::JoinHandle;

use crate::capture::AudioCapture;
use crate::codec::{self, VoiceDecoder, VoiceEncoder};
use crate::playback::AudioPlayback;
use crate::protocol::RING_BUFFER_SIZE;

pub struct AudioPipeline {
    _capture: AudioCapture,
    _playback: AudioPlayback,
    task: JoinHandle<()>,
}

impl AudioPipeline {
    pub async fn start_loopback() -> Result<Self> {
        let capture_rb = HeapRb::<f32>::new(RING_BUFFER_SIZE);
        let (capture_prod, mut capture_cons) = capture_rb.split();

        let playback_rb = HeapRb::<f32>::new(RING_BUFFER_SIZE);
        let (mut playback_prod, playback_cons) = playback_rb.split();

        let capture = AudioCapture::start(capture_prod)?;
        let playback = AudioPlayback::start(playback_cons)?;

        // Use the capture device's actual sample rate for Opus.
        // If the device rate isn't Opus-compatible, we'll get an error.
        let sample_rate = capture.actual_sample_rate;
        tracing::info!("Using sample rate: {sample_rate} Hz");

        // Opus only supports specific rates. If the device uses something
        // else (e.g., 44100), we need to use the nearest supported rate.
        // For now, try the device rate and fall back to 48000.
        let opus_rate = match sample_rate {
            8000 | 12000 | 16000 | 24000 | 48000 => sample_rate,
            _ => {
                tracing::warn!(
                    "Device rate {sample_rate} Hz not directly supported by Opus, using 48000 Hz"
                );
                48000
            }
        };

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
            task,
        })
    }

    pub async fn stop(self) {
        self.task.abort();
    }
}
