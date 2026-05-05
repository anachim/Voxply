use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use rand::rngs::OsRng;

pub struct DeviceSubkey {
    signing_key: SigningKey,
    label: String,
}

impl DeviceSubkey {
    pub fn generate(label: String) -> Self {
        Self {
            signing_key: SigningKey::generate(&mut OsRng),
            label,
        }
    }

    /// Subkey 0 is the legacy single-key identity. Its pubkey equals
    /// the existing per-device identity's pubkey, so non-upgraded hubs
    /// see no change.
    pub fn subkey_zero_from_entropy(entropy: &[u8; 32], label: String) -> Self {
        Self {
            signing_key: SigningKey::from_bytes(entropy),
            label,
        }
    }

    pub fn label(&self) -> &str {
        &self.label
    }

    pub fn public_key_hex(&self) -> String {
        hex::encode(self.signing_key.verifying_key().as_bytes())
    }

    pub fn sign(&self, message: &[u8]) -> Signature {
        self.signing_key.sign(message)
    }

    pub fn verifying_key(&self) -> VerifyingKey {
        self.signing_key.verifying_key()
    }
}
