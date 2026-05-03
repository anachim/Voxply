# Future Features

Designed-but-not-built features. Each section is the design we'd start
from when the time comes. None of this is shipping today.

> See also: [farm-model.md](farm-model.md) for the multi-hub server
> layer, and [gaming.md](gaming.md) for the game distribution platform.

## Anti-spam — proof-of-work + hub certifications

**Problem**: decentralized identity means bots can generate keypairs
instantly. Without friction, a hub can be flooded by fresh keys.

**Two-layer defense planned:**

### Layer 1 — proof-of-work levels

- Client computes a SHA-256 puzzle tied to its keypair (leading-zero hash).
- Each level takes exponentially more CPU: level 15 ≈ 1 min, level 23 ≈
  30 min, level 30 ≈ 8 hours.
- Hub sets a minimum level to connect.
- Proof stored in the identity file. Hub verifies instantly with one
  hash check. Cannot be faked — pure math.

PoW primitives already exist in
`shared/voxply-identity/src/pow.rs`; they aren't enforced yet.

### Layer 2 — hub certification (reputation)

- Hub signs a statement: "user X has been a member since Y in good
  standing."
- Signature is verifiable by anyone (hub's pubkey is published via `/info`).
- Users collect certifications from multiple hubs — a reputation
  portfolio.
- Other hubs can require certifications from trusted hubs.

### Also considered

- **Invite-only hubs** — admin issues invite codes. Simple, effective for
  private communities. Already shipped.
- **Per-IP rate limiting** — secondary barrier. Already in place on
  `/auth/*` and write endpoints.
- **Account age alone** — too weak. Easily faked by pre-generating keys.

### Order of implementation

PoW first (foundational, math-based). Hub certification later (requires
trust decisions). Invites are already the quick option for private hubs.

---

## Moderation enhancements — channel ban, voice mute, talk power

Beyond today's ban/mute/kick/timeout:

- **Channel ban** — block a user from specific channels (text + voice).
  New `channel_bans` table (channel_id × pubkey). Check on channel
  access.
- **Voice mute** — user can hear but can't speak. Hub stops forwarding
  their audio packets. New `voice_mutes` table.
- **Talk power** — channels carry a `min_talk_power` threshold for
  their voice side. Users get talk power from their role. Below
  threshold = can read/post text and listen in voice, but can't
  transmit. Users can "raise hand" to request permission.

**Why deferred**: basic moderation covers the essentials. Channel-level
controls and voice moderation are the next layer once the basics are
proven.

> Some of these (`voice_mutes`, talk power) have admin UI scaffolding
> already; the enforcement is partial. Check
> `server/voxply-hub/src/routes/moderation.rs` and
> `routes/role_models.rs` for current state.

---

## Identity recovery — beyond the recovery phrase

The recovery phrase ([identity.md](identity.md)) is shipped. These are
the next layers, none built:

1. **Backup / export** — explicit export-import of `identity.json` with
   a passphrase wrapper. The file already exists at
   `~/.voxply/identity.json`; this is just UX.
2. **Device linking** — master keypair authorizes per-device sub-keys.
   Revoke a lost device from another. Layers cleanly on the recovery
   phrase: phrase becomes the master seed; existing single-key
   identities migrate by treating themselves as "device 0."
3. **Recovery contacts** — designate trusted keypairs that can reclaim
   your roles or hub ownership if your key is lost. Hub-side, not
   identity-side.

**Why deferred**: the recovery phrase covers the "I formatted my PC"
case. Multi-device and social recovery are real needs, but only when
users actually want them.

---

## Bots and integrations

**Status**: future direction, not built. Tracked as task #148.

**Goal**: first-class bot support — automated identities that can read
channels, post messages, and react to events.

The pubkey-based identity is well-suited: a bot is an Ed25519 identity
with no recovery phrase and a long-lived token. Two likely shapes:

- **Bots-as-users** — bot identities are regular member rows with a
  `bot` flag and elevated permissions. Posts via the existing
  `/messages` endpoint. Federates the same way users do. Fits everything
  we've built.
- **Outbound webhooks** — hub POSTs to external URLs on events (channel
  message, voice join, etc.). One-way but trivial to integrate with
  existing tools.

Both shapes are valid; picking which (or whether to support both) is
the design exercise.

**Security**: bots get scoped tokens, not full user permissions. Token
rotation is owner-pubkey-gated. Per-bot rate limits. See
[threat-model.md](threat-model.md).

**How to apply now**: when suggesting features that touch identity,
permissions, or messaging APIs, keep the bot model in mind so we don't
paint ourselves into a corner.

---

## Nested channels

**Goal**: let users build an arbitrary tree of categories and channels.
Remember Voxply channels are **unified text + voice** ([decisions.md](decisions.md)) —
a "channel" in the tree is one room where both chat and voice live.

```
GamesCategory
├── LeagueOfLegendsCategory
│   ├── AllianceSection
│   │   ├── raid-planning
│   │   └── lounge
│   └── TeamSection
│       └── strats
└── DotaCategory
    └── general
```

Each leaf is a channel — chat history and voice in the same place. The
intermediate nodes are categories (containers).

**Why**: today's flat "category > channel" caps community organization at
two levels. Game communities, in particular, want topic > sub-topic >
section before getting to actual channels — and we don't know in advance
how deep any community will want to go.

### Rules

- **No depth cap.** Hubs are sovereign — admins decide their own
  structure. If they build a 12-level tree, it's their hub.
- **Categories are containers.** They hold other categories and/or
  channels. They can't hold messages or voice (`is_category=1` rows).
- **Channels are leaves.** Each channel is unified text + voice and can
  sit at any depth (a top-level channel is fine; nothing requires
  filling levels).
- **Permissions cascade** — a deny on a parent applies to children
  unless the child explicitly overrides. Same model as a file system.

### Data model

Today's `channels` table is already self-referential — it has
`parent_id TEXT REFERENCES channels(id)` and `is_category INTEGER` —
the schema **already supports nesting**. What's missing is just the UI
and any guardrails:

- The drag-drop UI in the desktop client treats categories as one level
  and channels as their children, with no recursion.
- There's no UI to make a category a child of another category, even
  though the data model accepts it.

So the work is mostly client-side and route validation:
- Allow drops that nest a category under another category.
- Allow drops that nest a channel under any category at any depth.
- Reject drops that would create a cycle (a node into its own
  descendant).

No schema migration needed.

### Open implementation questions

- **Drag-drop with arbitrary depth** — the only forbidden move is a
  cycle (dropping a node into one of its own descendants). Visual
  indentation past ~6 levels needs a strategy: horizontal scroll,
  auto-collapse, or breadcrumb-style display in the sidebar.
- **Permission override UI** — when a child explicitly grants what its
  parent denies, that override needs a clear UI affordance so admins
  understand what's happening.
- **Permalinks** — today's `#general` becomes
  `Games / LoL / Alliance / #raid-planning`. Permalink format: keep
  the channel id only and resolve display path client-side.
- **No migration needed** — both categories and channels can already
  live at the root (`parent_id NULL`) or nested under a category in
  today's schema. Existing data is unchanged; new nesting is opt-in
  whenever an admin decides to nest something.

### What we explicitly don't want

- **Channel-as-container** (a channel that holds messages AND has
  sub-channels). This would confuse users. Keep the `is_category`
  distinction sharp: containers vs. leaves.

---

## Server tags — federated portable badges

**Status**: future design. Tracked as task #98. No design committed yet.
