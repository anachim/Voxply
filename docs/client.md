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

Three: Calm (default), Classic, Linear. Theme tokens are CSS variables
applied at the root; switching is just a class change on `<body>`.

## Conventions

- **One `App.tsx` until pain demands a split.** Adding a folder hierarchy
  before there's friction is overhead with no benefit.
- **No state library**. React state + context covers everything.
- **No router**. Internal "pages" are just conditionally rendered panels.
- **Client never trusts the hub for permissions** — it shows or hides UI
  based on what the hub returns; the hub re-checks every action.

## What's not done

- Mobile client
- Web client (would need WebRTC voice)
- Plugin system / theme marketplace
