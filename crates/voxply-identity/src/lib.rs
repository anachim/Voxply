use anyhow::{Context, Result};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

pub struct Identity {
    signing_key: SigningKey,
}

impl Identity {
    pub fn generate() -> Self {
        let signing_key = SigningKey::generate(&mut OsRng);
        Self { signing_key }
    }

    pub fn public_key_hex(&self) -> String {
        let verifying_key: VerifyingKey = self.signing_key.verifying_key();
        hex::encode(verifying_key.as_bytes())
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        let data = SavedIdentity {
            secret_key: hex::encode(self.signing_key.to_bytes()),
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
        Ok(Self { signing_key })
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
}

// #[cfg(test)] = "only compile this when running tests"
// Like [TestClass] in C# — the test runner discovers these automatically.
#[cfg(test)]
mod tests {
    use super::*; // import everything from the parent module

    // #[test] = [TestMethod] in C#
    #[test]
    fn sign_and_verify() {
        let identity = Identity::generate();
        let message = b"hello voxply";

        let signature = identity.sign(message);
        let pub_key_hex = identity.public_key_hex();

        // Should succeed
        let result = verify_signature(&pub_key_hex, message, &signature.to_bytes());
        assert!(result.is_ok());
    }

    #[test]
    fn verify_rejects_wrong_message() {
        let identity = Identity::generate();
        let signature = identity.sign(b"correct message");
        let pub_key_hex = identity.public_key_hex();

        // Should fail — signed "correct message" but verifying against "wrong message"
        let result = verify_signature(&pub_key_hex, b"wrong message", &signature.to_bytes());
        assert!(result.is_err());
    }
}
