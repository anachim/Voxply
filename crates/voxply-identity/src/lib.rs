mod pow;

use anyhow::{Context, Result};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

pub use pow::{compute_security_level, verify_security_level, leading_zero_bits};

pub struct Identity {
    signing_key: SigningKey,
    pub security_nonce: u64,
    pub security_level: u32,
}

impl Identity {
    pub fn generate() -> Self {
        let signing_key = SigningKey::generate(&mut OsRng);
        Self {
            signing_key,
            security_nonce: 0,
            security_level: 0,
        }
    }

    pub fn public_key_hex(&self) -> String {
        let verifying_key: VerifyingKey = self.signing_key.verifying_key();
        hex::encode(verifying_key.as_bytes())
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        let data = SavedIdentity {
            secret_key: hex::encode(self.signing_key.to_bytes()),
            security_nonce: Some(self.security_nonce),
            security_level: Some(self.security_level),
        };
        let json = serde_json::to_string_pretty(&data)?;

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).context("Failed to create identity directory")?;
        }

        fs::write(path, json).context("Failed to write identity file")?;
        Ok(())
    }

    pub fn load(path: &Path) -> Result<Self> {
        let json = fs::read_to_string(path).context("Failed to read identity file")?;
        let data: SavedIdentity =
            serde_json::from_str(&json).context("Failed to parse identity file")?;
        let secret_bytes = hex::decode(&data.secret_key).context("Invalid hex in identity file")?;

        let secret_array: [u8; 32] = secret_bytes
            .try_into()
            .map_err(|_| anyhow::anyhow!("Secret key must be exactly 32 bytes"))?;

        let signing_key = SigningKey::from_bytes(&secret_array);
        Ok(Self {
            signing_key,
            security_nonce: data.security_nonce.unwrap_or(0),
            security_level: data.security_level.unwrap_or(0),
        })
    }

    pub fn load_or_create(path: &Path) -> Result<(Self, bool)> {
        if path.exists() {
            let identity = Self::load(path)?;
            Ok((identity, false))
        } else {
            let identity = Self::generate();
            identity.save(path)?;
            Ok((identity, true))
        }
    }

    pub fn sign(&self, message: &[u8]) -> Signature {
        self.signing_key.sign(message)
    }

    pub fn verifying_key(&self) -> VerifyingKey {
        self.signing_key.verifying_key()
    }

    /// Improve security level by computing more proof-of-work.
    /// Starts from current nonce and tries to find a higher level.
    /// Returns the new level reached.
    pub fn improve_security_level(&mut self, target_level: u32) -> u32 {
        let pub_key = self.public_key_hex();
        let (nonce, level) = compute_security_level(&pub_key, self.security_nonce, target_level);
        self.security_nonce = nonce;
        self.security_level = level;
        level
    }

    pub fn default_path() -> Result<PathBuf> {
        let home = dirs::home_dir().context("Could not find home directory")?;
        Ok(home.join(".voxply").join("identity.json"))
    }
}

impl fmt::Display for Identity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.public_key_hex())
    }
}

pub fn verify_signature(public_key_hex: &str, message: &[u8], signature_bytes: &[u8]) -> Result<()> {
    let pub_bytes = hex::decode(public_key_hex).context("Invalid public key hex")?;
    let pub_array: [u8; 32] = pub_bytes
        .try_into()
        .map_err(|_| anyhow::anyhow!("Public key must be 32 bytes"))?;
    let verifying_key =
        VerifyingKey::from_bytes(&pub_array).context("Invalid public key bytes")?;

    let sig_array: [u8; 64] = signature_bytes
        .try_into()
        .map_err(|_| anyhow::anyhow!("Signature must be 64 bytes"))?;
    let signature = Signature::from_bytes(&sig_array);

    verifying_key
        .verify(message, &signature)
        .context("Signature verification failed")?;
    Ok(())
}

#[derive(Serialize, Deserialize)]
struct SavedIdentity {
    secret_key: String,
    #[serde(default)]
    security_nonce: Option<u64>,
    #[serde(default)]
    security_level: Option<u32>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_and_verify() {
        let identity = Identity::generate();
        let message = b"hello voxply";

        let signature = identity.sign(message);
        let pub_key_hex = identity.public_key_hex();

        let result = verify_signature(&pub_key_hex, message, &signature.to_bytes());
        assert!(result.is_ok());
    }

    #[test]
    fn verify_rejects_wrong_message() {
        let identity = Identity::generate();
        let signature = identity.sign(b"correct message");
        let pub_key_hex = identity.public_key_hex();

        let result = verify_signature(&pub_key_hex, b"wrong message", &signature.to_bytes());
        assert!(result.is_err());
    }

    #[test]
    fn proof_of_work_computes_and_verifies() {
        let mut identity = Identity::generate();
        assert_eq!(identity.security_level, 0);

        let level = identity.improve_security_level(8);
        assert!(level >= 8);

        // Verify it
        let valid = verify_security_level(
            &identity.public_key_hex(),
            identity.security_nonce,
            identity.security_level,
        );
        assert!(valid);
    }

    #[test]
    fn proof_of_work_rejects_fake_nonce() {
        let identity = Identity::generate();
        // Fake nonce should not verify at level 20
        let valid = verify_security_level(&identity.public_key_hex(), 12345, 20);
        assert!(!valid);
    }
}
