use anyhow::{Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleRate;
use ringbuf::traits::Producer;

use crate::protocol::SAMPLE_RATE;

pub struct AudioCapture {
    stream: cpal::Stream,
    pub actual_sample_rate: u32,
    pub actual_channels: u16,
}

impl AudioCapture {
    pub fn start(mut producer: ringbuf::HeapProd<f32>) -> Result<Self> {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .context("No input device available")?;

        tracing::info!("Input device: {}", device.name().unwrap_or_default());

        let default_config = device
            .default_input_config()
            .context("No default input config")?;

        tracing::info!(
            "Input config: {} Hz, {} ch, {:?}",
            default_config.sample_rate().0,
            default_config.channels(),
            default_config.sample_format()
        );

        let sample_rate = default_config.sample_rate().0;
        let channels = default_config.channels();

        let config = cpal::StreamConfig {
            channels,
            sample_rate: default_config.sample_rate(),
            buffer_size: cpal::BufferSize::Default,
        };

        let stream = device
            .build_input_stream(
                &config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    // If stereo, mix down to mono by averaging pairs
                    if channels > 1 {
                        for chunk in data.chunks(channels as usize) {
                            let mono: f32 =
                                chunk.iter().sum::<f32>() / channels as f32;
                            let _ = producer.try_push(mono);
                        }
                    } else {
                        let _ = producer.push_slice(data);
                    }
                },
                |err| {
                    tracing::error!("Audio capture error: {err}");
                },
                None,
            )
            .context("Failed to build input stream")?;

        stream.play().context("Failed to start capture")?;
        tracing::info!("Audio capture started");

        Ok(Self {
            stream,
            actual_sample_rate: sample_rate,
            actual_channels: channels,
        })
    }
}
