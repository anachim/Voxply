# Voxply

A decentralized platform where players can hang out, talk, and play together. Voice chat, text messaging, and community-built games all live in one place — with no central servers required.

## Features

- **Voice & Text Chat** — Real-time voice channels and text messaging with Opus codec
- **Hub Federation** — Self-hosted hubs that can form alliances for cross-hub collaboration
- **Identity** — Cryptographic keypair-based identity (no accounts, no passwords)
- **Roles & Permissions** — Custom roles with priority ordering, channel-level moderation
- **Anti-Spam** — Proof-of-work security levels (TeamSpeak-style)
- **Direct Messages** — Privacy-first DMs (hub-routed, not stored)
- **Friend System** — Send/accept friend requests, friend list

## Architecture

```
server/
├── voxply-hub/          Hub server (axum, SQLite, WebSocket, UDP voice)
└── voxply-seed/         Seed tool for test data

client/
└── voxply-tui/          Terminal UI client (ratatui)

shared/
├── voxply-identity/     Ed25519 keypairs, signing, recovery phrases, proof-of-work
└── voxply-voice/        Audio pipeline (cpal, Opus, RNNoise noise suppression)
```

## Quick Start

```bash
# Start the hub server
cargo run -p voxply-hub

# Seed with test data (channels + messages)
cargo run -p voxply-seed

# Start the TUI client
cargo run -p voxply-tui

# Start a second client (different identity)
cargo run -p voxply-tui -- http://localhost:3000 /tmp/identity2.json
```

## Building

```bash
cargo build
cargo test
```

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE).
