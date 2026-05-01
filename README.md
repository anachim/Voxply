# Voxply

A decentralized platform where players can hang out, talk, and play
together. Voice chat, text messaging, federated alliances of hubs, and
community-built games — all keypair-based identity, no central servers.

## Features

- **Voice channels** — Opus over UDP with RNNoise denoise, voice activity
  detection, push-to-talk, self-mute / self-deafen.
- **Text chat** — channels with categories, drag-drop reordering,
  collapse/pin, search, markdown, code blocks, attachments (3 MB),
  reactions, replies, mentions, /me actions, edit/delete.
- **Direct messages** — federated outbox with retry, attachments,
  typing indicator, unread tracking, sort by activity.
- **Alliances** — multi-hub groups. Hubs share channels, messages, and
  reactions across the alliance via federation.
- **Hub federation** — independent hubs peer over HTTPS + WebSocket.
- **Identity** — Ed25519 keypair, 24-word BIP39 recovery phrase, no
  accounts, no passwords.
- **Roles & moderation** — custom roles with priority and permissions,
  ban / mute / timeout / kick, channel ban, voice mute, talk power, hub
  approval queue.
- **Notifications** — three-state per scope (all / mentions only /
  silent), system tray badge, OS notifications, mention sound.
- **Themes** — Calm (default), Classic, Linear.

## Architecture

```
server/
├── voxply-hub/          Hub server (axum + SQLite + WebSocket + UDP voice)
└── voxply-seed/         Discovery scaffold (not in active use)

client/
└── voxply-desktop/      Tauri + React desktop client

shared/
├── voxply-identity/     Ed25519 keypairs, signing, recovery phrases
└── voxply-voice/        Audio pipeline (cpal + Opus + RNNoise)
```

## Quick start

### Hub server

```bash
cargo run -p voxply-hub
# Listens on http://0.0.0.0:3000 (HTTP) and 0.0.0.0:3001 (voice UDP).
# Override with VOXPLY_HTTP_PORT / VOXPLY_VOICE_UDP_PORT.
# Set VOXPLY_TLS_CERT and VOXPLY_TLS_KEY for HTTPS.
```

### Desktop client

```bash
cd client/voxply-desktop
npm install
npm run tauri dev
```

The window opens with an "Add a hub" prompt; paste your hub URL
(`http://localhost:3000` for a local dev hub) to connect.

## Building

```bash
cargo build                       # all Rust crates
cargo test                        # hub + shared crate tests
cd client/voxply-desktop && npm run tauri build   # desktop release
```

## Documentation

- [`ROADMAP.md`](ROADMAP.md) — shipped features, open tasks, deferred
  items, and product gaps.
- [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) — what we defend
  against, what we don't, and the design decisions each gap drives.

## License

[GNU Affero General Public License v3.0](LICENSE). Network use of a
modified version requires offering the corresponding source to those
users — important for a federated platform like this.
