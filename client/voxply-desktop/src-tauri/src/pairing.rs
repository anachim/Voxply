use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use rand::RngCore;
use voxply_identity::{
    DeviceSubkey, Identity, MasterIdentity, PairingClaim, PairingComplete, PairingOffer,
    PairingStatus, SubkeyCert,
};

const OFFER_LIFETIME_SECS: u64 = 240; // 4 minutes — under the hub's 5-minute cap.
const HTTP_TIMEOUT_SECS: u64 = 10;

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn load_master() -> Result<MasterIdentity, String> {
    let path = Identity::default_path().map_err(|e| e.to_string())?;
    let identity = Identity::load(&path).map_err(|e| e.to_string())?;
    identity.master().map_err(|e| e.to_string())
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("HTTP client: {e}"))
}

fn random_token_hex() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// Build a master-signed PairingOffer for the given home hub list.
/// The token is freshly generated, lifetime is 4 minutes.
pub fn build_offer(home_hubs: Vec<String>) -> Result<PairingOffer, String> {
    if home_hubs.is_empty() {
        return Err("home_hubs must not be empty".to_string());
    }

    let master = load_master()?;
    let master_pubkey = master.public_key_hex();
    let pairing_token = random_token_hex();
    let issued_at = now_secs();
    let expires_at = issued_at + OFFER_LIFETIME_SECS;

    let bytes = PairingOffer::signing_bytes(
        &master_pubkey,
        &home_hubs,
        &pairing_token,
        issued_at,
        expires_at,
    );
    let signature = hex::encode(master.sign(&bytes).to_bytes());

    let offer = PairingOffer {
        master_pubkey,
        home_hubs,
        pairing_token,
        issued_at,
        expires_at,
        signature,
    };
    offer
        .verify()
        .map_err(|e| format!("self-verify failed: {e}"))?;

    Ok(offer)
}

/// POST the offer to every home hub in its list. Succeeds if at least
/// one hub accepts; partial failures are returned alongside.
async fn publish_offer(
    offer: &PairingOffer,
    client: &reqwest::Client,
) -> (usize, Vec<(String, String)>) {
    let mut ok_count = 0;
    let mut errors = Vec::new();

    for url in &offer.home_hubs {
        let endpoint = format!("{}/identity/pairing/offer", url.trim_end_matches('/'));
        match client.post(&endpoint).json(offer).send().await {
            Ok(resp) if resp.status().is_success() => ok_count += 1,
            Ok(resp) => {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                errors.push((url.clone(), format!("HTTP {status}: {body}")));
            }
            Err(e) => errors.push((url.clone(), e.to_string())),
        }
    }

    (ok_count, errors)
}

#[derive(serde::Serialize)]
pub struct StartPairingResult {
    pub offer: PairingOffer,
    /// JSON the UI should encode into a QR code. The new device parses
    /// this back into a PairingOffer when it scans.
    pub qr_payload: String,
    pub posted_count: usize,
    pub failures: Vec<HubFailure>,
}

#[derive(serde::Serialize)]
pub struct HubFailure {
    pub url: String,
    pub error: String,
}

/// E side — generate an offer, publish it to every home hub, and
/// return the JSON the UI should encode into a QR code.
#[tauri::command]
pub async fn start_pairing_offer(home_hubs: Vec<String>) -> Result<StartPairingResult, String> {
    let offer = build_offer(home_hubs)?;
    let qr_payload = serde_json::to_string(&offer)
        .map_err(|e| format!("serialize offer: {e}"))?;

    let client = http_client()?;
    let (posted_count, failures) = publish_offer(&offer, &client).await;

    if posted_count == 0 {
        return Err(format!(
            "No home hub accepted the pairing offer. Failures: {:?}",
            failures
        ));
    }

    Ok(StartPairingResult {
        offer,
        qr_payload,
        posted_count,
        failures: failures
            .into_iter()
            .map(|(url, error)| HubFailure { url, error })
            .collect(),
    })
}

/// Both sides — poll the pairing status from a single home hub.
/// Callers should walk the home hub list and try each until one
/// responds; this command is the one-hub primitive.
#[tauri::command]
pub async fn poll_pairing_status(
    home_hub_url: String,
    pairing_token: String,
) -> Result<PairingStatus, String> {
    let endpoint = format!(
        "{}/identity/pairing/status/{}",
        home_hub_url.trim_end_matches('/'),
        pairing_token
    );
    let client = http_client()?;
    let resp = client
        .get(&endpoint)
        .send()
        .await
        .map_err(|e| format!("request: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "HTTP {}: {}",
            resp.status(),
            resp.text().await.unwrap_or_default()
        ));
    }
    resp.json::<PairingStatus>()
        .await
        .map_err(|e| format!("parse: {e}"))
}

/// E side — after the user confirms a claim, build a master-signed
/// SubkeyCert for the claiming subkey, wrap the prefs-blob key for
/// it, and POST the completion to the home hub that holds the offer.
///
/// The wrapped blob key is currently a placeholder: real X25519 ECIES
/// will land alongside the prefs-blob sync feature. The protocol
/// shape is correct so we don't have to revise the wire types when
/// that lands.
#[tauri::command]
pub async fn complete_pairing(
    home_hub_url: String,
    pairing_token: String,
    claim_subkey_pubkey: String,
    device_label: String,
    fallback_hubs: Vec<String>,
) -> Result<(), String> {
    let master = load_master()?;
    let master_pubkey = master.public_key_hex();
    let issued_at = now_secs();

    let bytes = SubkeyCert::signing_bytes(
        &master_pubkey,
        &claim_subkey_pubkey,
        &device_label,
        issued_at,
        None,
        &fallback_hubs,
    );
    let signature = hex::encode(master.sign(&bytes).to_bytes());

    let cert = SubkeyCert {
        master_pubkey,
        subkey_pubkey: claim_subkey_pubkey,
        device_label,
        issued_at,
        not_after: None,
        fallback_hubs,
        signature,
    };
    cert.verify().map_err(|e| format!("cert self-verify: {e}"))?;

    // Placeholder until X25519-ECIES wrap lands with the prefs-blob
    // sync feature. 32 zero bytes is recognizable as "no real key".
    let wrapped_blob_key_hex = hex::encode([0u8; 32]);

    let complete = PairingComplete {
        pairing_token,
        cert,
        wrapped_blob_key_hex,
    };

    let client = http_client()?;
    let endpoint = format!(
        "{}/identity/pairing/complete",
        home_hub_url.trim_end_matches('/')
    );
    let resp = client
        .post(&endpoint)
        .json(&complete)
        .send()
        .await
        .map_err(|e| format!("request: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "HTTP {}: {}",
            resp.status(),
            resp.text().await.unwrap_or_default()
        ));
    }
    Ok(())
}

/// Convenience for the UI: given an offer, return the home hub list
/// the new device should iterate when claiming. Hides the field name
/// and any future structural changes.
#[tauri::command]
pub fn home_hubs_from_offer(offer: PairingOffer) -> Vec<String> {
    offer.home_hubs
}

/// Convenience helper — turn a SubkeyCert's pubkey into the short
/// fingerprint string the confirm dialog renders. Format: groups of
/// two hex chars separated by colons, first 8 bytes only.
#[tauri::command]
pub fn fingerprint_pubkey(public_key_hex: String) -> String {
    fingerprint_inner(&public_key_hex)
}

// --- New-device side ---

fn paired_identity_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("No home directory")?;
    Ok(home.join(".voxply").join("paired_identity.json"))
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct PairedIdentity {
    pub master_pubkey: String,
    pub subkey_pubkey: String,
    pub subkey_secret_hex: String,
    pub device_label: String,
    pub cert: SubkeyCert,
    pub home_hubs: Vec<String>,
}

#[derive(serde::Serialize)]
pub struct ClaimPairingResult {
    pub home_hub_url: String,
    pub master_pubkey: String,
    pub subkey_pubkey: String,
    pub subkey_secret_hex: String,
    pub pairing_token: String,
    pub home_hubs: Vec<String>,
}

/// N side — parse a QR payload back into a PairingOffer and verify
/// the master signature. Surfaces a helpful error if the QR is junk
/// or the signature doesn't match the embedded master pubkey.
#[tauri::command]
pub fn parse_pairing_offer(qr_payload: String) -> Result<PairingOffer, String> {
    let offer: PairingOffer =
        serde_json::from_str(&qr_payload).map_err(|e| format!("parse: {e}"))?;
    offer
        .verify()
        .map_err(|e| format!("offer signature: {e}"))?;
    let now = now_secs();
    if offer.expires_at <= now {
        return Err("offer is already expired".to_string());
    }
    Ok(offer)
}

/// N side — generate a fresh subkey for this device, sign a claim
/// against the offer, and POST it to the first reachable home hub.
/// Returns the URL it claimed against (the UI polls status there)
/// plus the freshly-generated subkey material that the UI must hand
/// back via `save_paired_identity` once the pairing completes.
#[tauri::command]
pub async fn claim_pairing_offer(
    offer: PairingOffer,
    device_label: String,
) -> Result<ClaimPairingResult, String> {
    offer
        .verify()
        .map_err(|e| format!("offer signature: {e}"))?;

    let subkey = DeviceSubkey::generate(device_label.clone());
    let subkey_pubkey = subkey.public_key_hex();
    let subkey_secret_hex = hex::encode(subkey.secret_bytes());

    let bytes =
        PairingClaim::signing_bytes(&offer.pairing_token, &subkey_pubkey, &device_label);
    let proof = hex::encode(subkey.sign(&bytes).to_bytes());

    let claim = PairingClaim {
        pairing_token: offer.pairing_token.clone(),
        subkey_pubkey: subkey_pubkey.clone(),
        device_label: device_label.clone(),
        proof,
    };
    claim
        .verify()
        .map_err(|e| format!("claim self-verify: {e}"))?;

    let client = http_client()?;
    let mut last_error = String::new();
    for url in &offer.home_hubs {
        let endpoint = format!("{}/identity/pairing/claim", url.trim_end_matches('/'));
        match client.post(&endpoint).json(&claim).send().await {
            Ok(resp) if resp.status().is_success() => {
                return Ok(ClaimPairingResult {
                    home_hub_url: url.clone(),
                    master_pubkey: offer.master_pubkey,
                    subkey_pubkey,
                    subkey_secret_hex,
                    pairing_token: offer.pairing_token,
                    home_hubs: offer.home_hubs,
                });
            }
            Ok(resp) => {
                last_error = format!(
                    "{}: HTTP {} {}",
                    url,
                    resp.status(),
                    resp.text().await.unwrap_or_default()
                );
            }
            Err(e) => last_error = format!("{url}: {e}"),
        }
    }
    Err(format!(
        "No home hub accepted the claim. Last error: {last_error}"
    ))
}

/// N side — once `poll_pairing_status` reports Complete with a cert
/// matching the offer, the UI calls this to persist the new identity
/// at ~/.voxply/paired_identity.json. The cert's master signature is
/// verified again here as a final guard.
#[tauri::command]
pub fn save_paired_identity(
    master_pubkey: String,
    subkey_pubkey: String,
    subkey_secret_hex: String,
    device_label: String,
    cert: SubkeyCert,
    home_hubs: Vec<String>,
) -> Result<(), String> {
    cert.verify()
        .map_err(|e| format!("cert signature: {e}"))?;
    if cert.master_pubkey != master_pubkey {
        return Err("cert master_pubkey doesn't match expected".to_string());
    }
    if cert.subkey_pubkey != subkey_pubkey {
        return Err("cert subkey_pubkey doesn't match the one we generated".to_string());
    }

    // Sanity-check the subkey bytes round-trip to the same pubkey we
    // claimed under. If this fails the secret got mangled in transit
    // through the UI layer.
    let secret_bytes = hex::decode(&subkey_secret_hex)
        .map_err(|e| format!("decode secret: {e}"))?;
    let secret_array: [u8; 32] = secret_bytes
        .try_into()
        .map_err(|_| "subkey secret must be 32 bytes".to_string())?;
    let reconstructed = DeviceSubkey::from_secret_bytes(&secret_array, device_label.clone());
    if reconstructed.public_key_hex() != subkey_pubkey {
        return Err("subkey secret doesn't match its pubkey".to_string());
    }

    let identity = PairedIdentity {
        master_pubkey,
        subkey_pubkey,
        subkey_secret_hex,
        device_label,
        cert,
        home_hubs,
    };

    let path = paired_identity_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    }
    let text = serde_json::to_string_pretty(&identity).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| format!("write: {e}"))?;
    Ok(())
}

/// Read the locally-stored paired identity, if any.
#[tauri::command]
pub fn get_paired_identity() -> Option<PairedIdentity> {
    let path = paired_identity_path().ok()?;
    if !path.exists() {
        return None;
    }
    let text = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&text).ok()
}

fn fingerprint_inner(public_key_hex: &str) -> String {
    public_key_hex
        .as_bytes()
        .chunks(2)
        .take(8)
        .map(|c| std::str::from_utf8(c).unwrap_or("??"))
        .collect::<Vec<_>>()
        .join(":")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_offer_self_verifies_when_identity_exists() {
        if Identity::default_path()
            .ok()
            .filter(|p| p.exists())
            .is_none()
        {
            return;
        }
        let offer =
            build_offer(vec!["https://a.example".to_string()]).expect("build");
        assert!(offer.verify().is_ok());
        assert!(offer.expires_at > offer.issued_at);
        assert_eq!(offer.expires_at - offer.issued_at, OFFER_LIFETIME_SECS);
    }

    #[test]
    fn build_offer_rejects_empty_hub_list() {
        let result = build_offer(vec![]);
        assert!(result.is_err());
    }

    #[test]
    fn fingerprint_format() {
        // 64-char ed25519 pubkey → first 8 bytes (16 hex chars) → 8 groups
        let key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let fp = fingerprint_inner(key);
        assert_eq!(fp, "01:23:45:67:89:ab:cd:ef");
    }

    #[test]
    fn random_tokens_are_unique() {
        let a = random_token_hex();
        let b = random_token_hex();
        assert_eq!(a.len(), 64); // 32 bytes hex-encoded
        assert_ne!(a, b);
    }
}
