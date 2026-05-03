# Voxply Roadmap

Tracks **what's next, what's broken, and what we'd like to build but
haven't designed yet**. Everything else — architecture, design rationale,
shipped features, design questions — lives in the wiki at
[`docs/`](docs/README.md).

## 🔨 Next up

*(nothing right now — pick from Wishlist below.)*

## 📌 Wishlist (undesigned)

Things we want to build but haven't committed to a design yet. Designed
items live in the wiki — see
[`future-features.md`](docs/future-features.md),
[`farm-model.md`](docs/farm-model.md),
[`gaming.md`](docs/gaming.md).

- **Screen share** — WebRTC or similar; multi-week
- **E2E encryption for DMs** — sender-key against recipient pubkey; group DMs are the hard part
- **Onboarding / first-run** — guided first-hub flow, demo hub option
- **Cross-platform packaging** — installers for macOS / Linux / mobile
- **Performance ceiling** — load test WS broadcast, search, voice relay
- **Accessibility + i18n** — keyboard nav audit, screen-reader, localization
- **Key revocation** — leaked-key story; today is "regen + notify friends"
- **Hub discovery** — `voxply-seed` scaffolded but unused; central registry / DHT / word-of-mouth?

## ⚠️ Known issues

- `subscribe_all` firehose — every client receives every channel's messages just for unread tracking. Fine at current scale
- Avatars uploaded full-resolution to every hub — base64 in `users.avatar`; doesn't scale
- No custom display font — system stack only

## 💤 Won't do

- **Load-aware DM routing across a user's hubs** — failover only; load-balancing needs gossip + cross-hub consistency. See [decisions.md](docs/decisions.md)
- **Concurrent mic test while in voice** — two cpal input streams unreliable cross-platform; live meter covers it
