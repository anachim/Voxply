# Voxply

A decentralized platform where players can hang out, talk, and play together. Voice chat, text messaging, and community-built games all live in one place — with no central servers required.

## Features

- **Voice & Text Chat** — Real-time voice channels and text messaging over WebRTC
- **Community Games** — Create, share, and play games built by the community
- **Decentralized** — No central servers. Peers connect directly via libp2p
- **Game Scripting** — Build games using Lua (Luau) or WASM modules
- **Identity** — Cryptographic keypair-based identity (no accounts, no passwords)
- **Cross-Platform Rendering** — Native GPU rendering with wgpu

## Architecture

```
crates/
├── voxply-app/         Main binary — ties everything together
├── voxply-net/         P2P networking (libp2p)
├── voxply-voice/       Voice chat (WebRTC)
├── voxply-render/      GPU rendering (wgpu + winit)
├── voxply-script/      Game scripting (Lua/Luau + WASM)
├── voxply-identity/    Decentralized identity (Ed25519 keypairs)
└── voxply-world/       Game world state
```

## Usage

*Coming soon.*

## Building

```bash
cargo build
```

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE).
