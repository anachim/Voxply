import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RECOVERY_ACK_KEY } from "../constants";

/**
 * First-run banner that nudges the user to back up their 24-word
 * recovery phrase before joining their first hub. Persists the
 * acknowledgement in localStorage so the banner only shows once.
 */
export function WelcomeRecoveryBlock() {
  const [acked, setAcked] = useState<boolean>(
    () => localStorage.getItem(RECOVERY_ACK_KEY) === "1",
  );
  const [phrase, setPhrase] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (acked) {
    return (
      <div className="welcome-recovery acked">
        <span className="welcome-recovery-check">✓</span>
        <span>
          Recovery phrase backed up. You can re-reveal it any time from{" "}
          <strong>Settings → Security</strong>.
        </span>
      </div>
    );
  }

  async function reveal() {
    setBusy(true);
    try {
      const p = await invoke<string>("get_recovery_phrase");
      setPhrase(p);
    } catch {
      // If recovery isn't available yet (e.g. mid-load), the user can
      // come back to this from Settings; the welcome block just stays
      // in the unrevealed state.
    } finally {
      setBusy(false);
    }
  }

  function acknowledge() {
    localStorage.setItem(RECOVERY_ACK_KEY, "1");
    setAcked(true);
  }

  return (
    <div className="welcome-recovery">
      <h3>📝 Back up your recovery phrase first</h3>
      {phrase ? (
        <>
          <p className="muted">
            These 24 words are the <strong>only</strong> way to recover
            your identity. Write them down on paper or save them in a
            password manager. Anyone with these words can impersonate
            you on every hub you've joined — keep them private.
          </p>
          <div className="recovery-phrase">{phrase}</div>
          <button onClick={acknowledge} className="primary">
            I've backed it up — continue
          </button>
        </>
      ) : (
        <>
          <p className="muted">
            Voxply has no "forgot password" — your identity is a keypair
            on this device. If you lose the device without writing down
            the recovery phrase, every hub forgets you forever. Do this
            now, before you join your first hub.
          </p>
          <button onClick={reveal} className="btn-secondary" disabled={busy}>
            {busy ? "Loading…" : "Reveal my recovery phrase"}
          </button>
        </>
      )}
    </div>
  );
}
