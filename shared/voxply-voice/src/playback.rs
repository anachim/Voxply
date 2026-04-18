use anyhow::{Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use ringbuf::traits::Consumer;

pub struct AudioPlayback {
    stream: cpal::Stream,
    pub actual_sample_rate: u32,
    pub actual_channels: u16,
}

impl AudioPlayback {
    pub fn start(mut consumer: ringbuf::HeapCons<f32>) -> Result<Self> {
        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .context("No output device available")?;

        tracing::info!("Output device: {}", device.name().unwrap_or_default());

        let default_config = device
            .default_output_config()
            .context("No default output config")?;

        tracing::info!(
            "Output config: {} Hz, {} ch, {:?}",
            default_config.sample_rate().0,
            default_config.channels(),
            default_config.sample_format()
        );

        let channels = default_config.channels();

        let config = cpal::StreamConfig {
            channels,
            sample_rate: default_config.sample_rate(),
            buffer_size: cpal::BufferSize::Default,
        };

        let stream = device
            .build_output_stream(
                &config,
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    // If stereo output, duplicate mono samples to both channels
                    if channels > 1 {
                        for chunk in data.chunks_mut(channels as usize) {
                            let sample = consumer.try_pop().unwrap_or(0.0);
                            for ch in chunk.iter_mut() {
                                *ch = sample;
                            }
                        }
                    } else {
                        for sample in data.iter_mut() {
                            *sample = consumer.try_pop().unwrap_or(0.0);
                        }
                    }
                },
                |err| {
                    tracing::error!("Audio playback error: {err}");
                },
                None,
            )
            .context("Failed to build output stream")?;

        stream.play().context("Failed to start playback")?;
        tracing::info!("Audio playback started");

        Ok(Self {
            stream,
            actual_sample_rate: default_config.sample_rate().0,
            actual_channels: channels,
        })
    }
}
