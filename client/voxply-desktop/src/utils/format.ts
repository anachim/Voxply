// Pure formatting helpers used across the UI. No React, no Tauri.

/** Format a public key for display: 12 hex chars in groups of 4, separated
 * by dashes, followed by the last 4 chars. Full key still copied/sent under
 * the hood — this is purely visual. */
export function formatPubkey(key: string | null | undefined): string {
  if (!key) return "";
  if (key.length < 20) return key;
  const head = key.slice(0, 12).match(/.{1,4}/g)!.join("-");
  const tail = key.slice(-4);
  return `${head}…${tail}`;
}

/**
 * "/me does the thing" → render in third person. Only triggers when /me is
 * the very first 4 chars of the message and there's at least one trailing
 * char of action text. Keeps the expected IRC-style behavior without
 * accidentally swallowing messages that happen to mention "/me " mid-line.
 */
export function meAction(content: string): string | null {
  if (content.startsWith("/me ") && content.length > 4) {
    return content.slice(4);
  }
  return null;
}

/** Returns true if `content` contains an @mention of `name` (case-insensitive). */
export function mentionsName(content: string, name: string | null): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  const re = /@([\w.\-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m[1].toLowerCase() === lower) return true;
  }
  return false;
}

/**
 * Stable color for a public key. Hashes the pubkey to a hue and pins
 * saturation/lightness so the result is always legible against the dark
 * theme. Empty/missing keys fall back to the accent color.
 */
export function colorForKey(pubkey: string | null | undefined): string {
  if (!pubkey) return "var(--accent)";
  // Tiny FNV-1a — plenty of entropy for hue distribution and cheap to run
  // on every render.
  let h = 2166136261;
  for (let i = 0; i < pubkey.length; i++) {
    h ^= pubkey.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hue = (h >>> 0) % 360;
  return `hsl(${hue}, 55%, 65%)`;
}

/** Local-day key (yyyy-mm-dd) used to detect day boundaries. */
export function dayKey(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Friendly label for a day separator: Today / Yesterday / Mar 4 / Mar 4, 2024. */
export function formatDayLabel(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (dayKey(unixSec) === dayKey(today.getTime() / 1000)) return "Today";
  if (dayKey(unixSec) === dayKey(yest.getTime() / 1000)) return "Yesterday";
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
}

/** Localized full timestamp suitable for a hover tooltip. */
export function formatFullTimestamp(unixSec: number): string {
  if (!unixSec) return "";
  const d = new Date(unixSec * 1000);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatRelative(unixSec: number): string {
  if (!unixSec) return "—";
  const now = Math.floor(Date.now() / 1000);
  const diff = now - unixSec;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
