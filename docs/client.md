# Desktop Client

Tauri 2 + React 19 + TypeScript. Two halves:

- **Rust shell** (`client/voxply-desktop/src-tauri/`) — file I/O, voice,
  OS notifications, system tray, OS-native dialogs. Communicates with
  the UI via Tauri commands.
- **React UI** (`client/voxply-desktop/src/`) — everything visual.

## React entry

- `src/main.tsx` — boots React
- `src/App.tsx` — single-component app holding most state. Yes, it's
  large; the project is small enough that one file with hooks + context
  is simpler than a premature feature split.

State held in `App.tsx` includes: identity, hub list, active hub, channel
list, messages, DMs, blocked users, notifications, theme, and UI mode.

## Persistence (per-device)

JSON files in Tauri's app-data directory, owned by the Rust shell:

| File                  | Purpose                                  |
|-----------------------|------------------------------------------|
| `identity.json`       | The Ed25519 keypair (one per device)     |
| `hubs.json`           | Known hubs: URL + nickname + last token  |
| `prefs.json`          | UI prefs (theme, notification scopes)    |
| `blocked_users.json`  | Per-device pubkey block list             |

These do **not** sync across devices today. (See [decisions.md](decisions.md).)

## Tauri commands

Defined in `client/voxply-desktop/src-tauri/src/lib.rs`. A non-exhaustive
list:

- `load_identity` / `save_identity` — keypair persistence
- `load_hubs` / `save_hubs` — hub list
- `load_blocked_users` / `save_blocked_users` — per-device block list
- `preview_hub_info` — pre-add fetch of hub name/icon
- `clear_local_data` — wipes all of the above (double-confirmed in UI)
- voice control commands (start/stop capture, mute, deafen, device select)

## Themes

Four: Calm (default), Classic, Linear, Light. Theme tokens are CSS
variables applied at the root via `data-theme`; switching is just a
dataset change. Light overrides shadow tokens too — the dark-mode
shadow values would look heavy on a light background.

## WebSocket lifecycle

The Tauri side opens one WebSocket per connected hub and forwards
events to React. When the connection drops (hub restart, network blip),
the client emits `hub-ws-status: connected=false`. The React side
handles this by scheduling an automatic reconnect with exponential
backoff (1s, 2s, 4s, … capped at 30s) — no user action required. The
existing "Reconnect" button in the banner is a manual override that
resets backoff and tries immediately.

State lives in two refs: `reconnectTimers` (per-hub setTimeout IDs) and
`reconnectAttempts` (per-hub backoff counters). Both clear on success
or when the user leaves the hub.

## Conventions

- **One `App.tsx` until pain demands a split.** Adding a folder hierarchy
  before there's friction is overhead with no benefit.
- **No state library**. React state + context covers everything.
- **No router**. Internal "pages" are just conditionally rendered panels.
- **Client never trusts the hub for permissions** — it shows or hides UI
  based on what the hub returns; the hub re-checks every action.

## Tests

The Tauri Rust side has unit tests in `src-tauri/src/lib.rs` under a
`#[cfg(test)] mod tests` block. We deliberately avoid testing Tauri
commands directly (they need a real `AppHandle` / `State` / runtime);
instead we cover the boundary logic that doesn't need any of that —
URL encoding, serde shapes (so an old prefs file still round-trips),
and small pure helpers. Run with `cargo test` from `src-tauri/`.

To grow the suite: any function that takes plain values and returns
plain values is fair game. Anything that touches `dirs::data_dir()`
needs a refactor to take a base path before it's testable.

The React side has no test framework wired up yet — that's a separate
future task.

## What's not done

- Mobile client
- Web client (would need WebRTC voice)
- Plugin system / theme marketplace
