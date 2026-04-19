use anyhow::{Context, Result};
use cpal::traits::{DeviceTrait, HostTrait};

/// Names of all available input devices (microphones).
/// The default device is always listed first when present.
pub fn list_input_devices() -> Result<Vec<String>> {
    let host = cpal::default_host();
    let default_name = host
        .default_input_device()
        .and_then(|d| d.name().ok());

    let mut names: Vec<String> = host
        .input_devices()
        .context("Failed to enumerate input devices")?
        .filter_map(|d| d.name().ok())
        .collect();

    if let Some(def) = default_name {
        if let Some(pos) = names.iter().position(|n| n == &def) {
            names.remove(pos);
            names.insert(0, def);
        }
    }
    Ok(names)
}

/// Names of all available output devices (speakers/headphones).
pub fn list_output_devices() -> Result<Vec<String>> {
    let host = cpal::default_host();
    let default_name = host
        .default_output_device()
        .and_then(|d| d.name().ok());

    let mut names: Vec<String> = host
        .output_devices()
        .context("Failed to enumerate output devices")?
        .filter_map(|d| d.name().ok())
        .collect();

    if let Some(def) = default_name {
        if let Some(pos) = names.iter().position(|n| n == &def) {
            names.remove(pos);
            names.insert(0, def);
        }
    }
    Ok(names)
}

pub(crate) fn find_input_device(preferred: Option<&str>) -> Result<cpal::Device> {
    let host = cpal::default_host();
    if let Some(name) = preferred {
        if let Ok(mut devices) = host.input_devices() {
            if let Some(matched) = devices.find(|d| d.name().ok().as_deref() == Some(name)) {
                return Ok(matched);
            }
        }
        tracing::warn!("Preferred input device '{name}' not found; falling back to default");
    }
    host.default_input_device()
        .context("No input device available")
}

pub(crate) fn find_output_device(preferred: Option<&str>) -> Result<cpal::Device> {
    let host = cpal::default_host();
    if let Some(name) = preferred {
        if let Ok(mut devices) = host.output_devices() {
            if let Some(matched) = devices.find(|d| d.name().ok().as_deref() == Some(name)) {
                return Ok(matched);
            }
        }
        tracing::warn!("Preferred output device '{name}' not found; falling back to default");
    }
    host.default_output_device()
        .context("No output device available")
}
