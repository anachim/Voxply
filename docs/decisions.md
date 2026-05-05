# Design Decisions

Why Voxply is shaped the way it is. Each entry: the decision, the
alternative we considered, and why we chose this. New decisions go at
the top.

## Personal state lives on a home hub list; community state stays direct

**Decision**: a user designates a master-signed, ordered list of
**home hubs** that hold their *personal-axis* state — devices, prefs,
DMs, friends. Community-axis state (channel messages, voice,
alliances) still flows direct between client and the relevant
community hub. Writes to personal-axis state replicate across the
list; reads can hit any hub in the list.

**Alternative considered**: continue with no home hub at all (the
prior decision), pushing every personal-axis feature to invent its
own ad-hoc per-hub or per-device sync.

**Why a list wins**:
- Multi-device needs a single canonical place to publish device
  certs and revocations. Without one, every community hub would
  need its own copy and would drift.
- DMs need a canonical inbox view so phone + desktop see the same
  list. Spraying across community hubs without a canonical view
  forces every device to log into every hub.
- A *list* (rather than a single home hub) preserves the failover
  resilience that drove "DM failover, not load-balanced routing"
  below — any hub in the list can serve, and there is no single
  point of failure.
- Master-signed designations mean consumers never have to trust an
  individual home hub — they verify the master signature.

**What this supersedes**: the "Client connects directly to many hubs"
entry below was correct *for community traffic* but forced
personal-axis state into bad shapes. It is now scoped to community
traffic only; personal state goes through home hubs.

**Design docs**: [home-hub.md](home-hub.md) (storage layer) and
[multi-device.md](multi-device.md) (identity + pairing protocol).

## Channels are unified text + voice

**Decision**: every channel is both a chat room and a voice room. There
is no "text channel" vs "voice channel" type. Joining voice is something
a user *does* in a channel — not a property of the channel.

**Alternative considered**: a split model — separate channel types,
each doing one thing.

**Why unified wins**:
- Channel-as-place model: a channel is a *place*. People are there,
  talking and typing.
- Halves the channel count for the same expressiveness — communities
  don't need a "#raids" text channel and a separate "Raid Voice"
  channel; they have one "raids" room where both happen.
- Permissions, moderation, bans, naming, history all attach to the
  same entity.
- Schema is simpler: `channels` has no `kind` column. Voice is
  runtime state (`state.voice_channels` map keyed by channel id), not a
  persistent property.

**Implication for design**: when adding any channel feature, ask "does
this make sense for both chat and voice in the same room?" If yes,
build it once. If no, the feature probably belongs as a *channel
property* (e.g., `min_talk_power`) rather than a new channel kind.

## Client connects directly to many hubs

**Status**: partially superseded — see "Personal state lives on a home
hub list" above. This decision still holds for **community traffic**
(channels, voice, alliances), but **personal-axis state** (devices,
prefs, DMs, friends) now flows through a master-signed home hub list.

**Decision**: the desktop client connects to each hub directly. Hubs
are independent — they don't proxy each other's traffic.

**Alternative considered**: a "home hub" model where your home hub
proxies everything else.

**Why direct (for community traffic)**: simpler. Each hub is a self-
contained community. Cross-hub features (alliances, federated DMs)
are explicit opt-in protocols on top, not the default. The client
becomes the multi-hub orchestrator, not the hub server.

**Why this had to bend for personal-axis state**: see the home hub
list decision above — multi-device, DM unification, and prefs sync
all needed an anchor that "no home hub" couldn't provide.

## DM failover, not load-balanced routing

**Decision**: a user publishes an **ordered list** of delivery hubs in
their friend record. Sender tries primary → secondary → etc. on failure.

**Alternative considered**: load-aware / traffic-aware routing across
hubs.

**Why failover wins**: load-balancing needs gossip, cross-hub
consistency, and shared state we don't have. Failover gets ~90% of the
benefit at near-zero coordination cost. Don't add load-aware routing
without real telemetry justifying it.

## One device per account (today)

**Decision**: A recovery phrase is the secret. Pasting it on a device
*replaces* that device's identity; it doesn't sync.

**Alternatives considered**:
- HD-wallet style master seed → per-device subkeys via HKDF.
- "Home hub" picks a primary device and syncs an encrypted prefs blob.

**Why simple wins now**: multi-device adds key management, conflict
resolution, and revocation work that we don't yet need. The simple model
ships and is forward-compatible: the recovery phrase can later be
treated as a master seed without breaking existing identities (migrate
by deriving the existing key as "subkey 0").

**Revisit when**: design is now committed in
[multi-device.md](multi-device.md) (identity model + QR pairing
protocol) and [home-hub.md](home-hub.md) (storage layer). The
implementation is phased; this entry stays accurate as a description
of the *current shipped* behavior until phases 3-5 land.

## ROADMAP.md is gitignored

**Decision**: ROADMAP.md is the durable local task list. Not committed.

**Why**: it's a working document that changes hourly during a session;
versioning it produces noise without value. Public state lives in
README.md and `docs/`.

## Federated, not centralized

**Decision**: Communities are hubs. Hubs federate. No central server.

**Why**:
- Lets a community own its data and moderation policy.
- A single takedown doesn't kill the network.
- Matches the "many private servers" mental model people already have.

**Cost**: harder onboarding (you need a hub URL), harder discovery,
harder cross-community state. We accept these in exchange for community
sovereignty.

## Three crates, not a monorepo soup

**Decision**: `shared/`, `server/`, `client/` as the top-level split,
each with one or two crates.

**Why**: identity rules and voice rules must agree exactly between client
and server. One crate per cross-cutting concern prevents drift. Beyond
that, server and client have completely different shapes — separate
crates avoid a giant feature-flagged build.

## Tauri, not Electron

**Decision**: Tauri 2 + React for the desktop app.

**Why**: smaller binaries, native voice access via cpal, real OS APIs
without an Electron runtime. The cost is fewer pre-built integrations,
but for a voice-first app the OS-native audio path is non-negotiable.

## SQLite, not Postgres

**Decision**: each hub embeds SQLite.

**Why**: a hub is single-tenant by design. SQLite means zero-ops for the
operator (no DB to set up), trivial backups (one file), and good enough
performance for community-scale traffic. If we later want multi-tenant
hub farms, the storage layer can change underneath without affecting
the federation protocol.

## DMs as outbox, not session

**Decision**: federated DMs are mailbox-style — sender's hub queues
the message and pushes it to the recipient's hub.

**Why**: recipient's hub may be offline. Familiar mental model. Avoids
"home hub" picking — both hubs hold a copy by design. See
[federation.md](federation.md).

## No proof-of-work yet

**Decision**: anti-spam is in the ROADMAP, not shipped. The PoW
primitives exist (`shared/voxply-identity/src/pow.rs`) but aren't
enforced.

**Why**: premature spam mitigation in a private-network product would
just annoy real users. Add when there's actual abuse to mitigate.
