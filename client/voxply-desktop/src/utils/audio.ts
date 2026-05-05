// WebAudio cues. Synthesized on demand so we don't bundle audio files —
// these are short tones with no licensing concerns and the user can tell
// what they're hearing without waiting for a file fetch on first play.
//
// Failures are intentionally swallowed: audio is best-effort, and the
// browser can refuse to start an AudioContext before user interaction.

let cachedAudioCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  return (
    cachedAudioCtx ??
    (cachedAudioCtx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext)())
  );
}

/**
 * Plays a short two-tone "ping" — used for @mention notifications.
 */
export function playMentionPing() {
  try {
    const ctx = getCtx();
    const now = ctx.currentTime;
    const tone = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(0.18, now + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur);
    };
    tone(880, 0, 0.12);
    tone(1175, 0.08, 0.18);
  } catch {
    // best-effort
  }
}

/**
 * Voice-channel join/leave cues. Rising two-tone for join (connecting
 * feel), descending two-tone for leave.
 */
export function playVoiceTone(direction: "up" | "down") {
  try {
    const ctx = getCtx();
    const now = ctx.currentTime;
    const tone = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(0.14, now + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur);
    };
    if (direction === "up") {
      tone(523, 0, 0.1); // C5
      tone(784, 0.07, 0.16); // G5
    } else {
      tone(784, 0, 0.1); // G5
      tone(523, 0.07, 0.16); // C5
    }
  } catch {
    // best-effort
  }
}
