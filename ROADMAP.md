# Voxply Roadmap

Tracks **what's next, what's broken, and what we'd like to build but
haven't designed yet**. Everything else — architecture, design rationale,
shipped features, design questions — lives in the wiki at
[`docs/`](docs/README.md).

## 🔨 Next up

- **Cross-hub friend system** — friends keyed on pubkey, not per-hub
- **Tauri backend tests** — hub side covered; Tauri side isn't

## 📌 Wishlist (undesigned)

Things we want to build but haven't committed to a design yet. Designed
items live in the wiki — see
[`future-features.md`](docs/future-features.md),
[`farm-model.md`](docs/farm-model.md),
[`gaming.md`](docs/gaming.md).

- **Screen share** — WebRTC or similar; multi-week
- **E2E encryption for DMs** — sender-key against recipient pubkey; group DMs are the hard part
- **Onboarding / first-run** — guided first-hub flow, demo hub option
- **Hub operator docs** — systemd unit, TLS guide, backup, upgrade path
- **Cross-platform packaging** — installers for macOS / Linux / mobile
- **Performance ceiling** — load test WS broadcast, search, voice relay
- **Accessibility + i18n** — keyboard nav audit, screen-reader, localization
- **Key revocation** — leaked-key story; today is "regen + notify friends"
- **Hub discovery** — `voxply-seed` scaffolded but unused; central registry / DHT / word-of-mouth?

## ⚠️ Known issues

- `subscribe_all` firehose — every client receives every channel's messages just for unread tracking. Fine at current scale
- Hub name mutation is lazy — `AppState.hub_name` only read at startup; alliance code still uses the startup value
- No WS auto-reconnect loop — HTTP re-auths silently; WS doesn't auto-reopen
- Bounced DMs aren't surfaced in UI — `dm_outbox.bounced_at` is logged only
- Avatars uploaded full-resolution to every hub — base64 in `users.avatar`; doesn't scale
- No light theme yet — token system supports it; not authored
- No custom display font — system stack only

## 💤 Won't do

- **Load-aware DM routing across a user's hubs** — failover only; load-balancing needs gossip + cross-hub consistency. See [decisions.md](docs/decisions.md)
- **Concurrent mic test while in voice** — two cpal input streams unreliable cross-platform; live meter covers it
