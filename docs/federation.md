# Federation

Hubs are independent SQLite-backed servers. Federation lets them talk
without a central authority. Two federation features ship today:

- **Federated DMs** — sender's hub → recipient's hub via an outbox
- **Alliances** — named groups of peers sharing channels (see [alliances.md](alliances.md))

## Peer auth

Every hub has its own Ed25519 keypair. Hub A authenticates to Hub B with
the same challenge-response primitive used for users
([identity.md](identity.md)), just acting as itself rather than on behalf
of a user.

Code: `server/voxply-hub/src/federation/client.rs` (outbound),
`server/voxply-hub/src/federation/handlers.rs` (inbound).

## Federated DMs

Mailbox model — store-and-forward, not a sync protocol.

```
User on Hub A sends DM to User on Hub B
  ↓
Hub A writes to its outbox table
  ↓
dm_worker (server/voxply-hub/src/dm_worker.rs) picks it up
  ↓
Hub A POSTs to Hub B's federation endpoint, signed as Hub A
  ↓
Hub B verifies, stores in recipient's inbox
  ↓
Hub B pushes via WebSocket if recipient is online
```

Retry logic and failover live in the worker. The outbox survives
restarts because it's a SQLite table.

Routes: `server/voxply-hub/src/routes/dms.rs`. Models:
`server/voxply-hub/src/routes/dm_models.rs`.

### Why outbox-style

- The recipient's hub may be offline; the sender's hub holds the message.
- It maps to a familiar mental model (email).
- It avoids the "pick a home hub" problem — the message just lives in two
  places by design.

## Federated reactions on alliance reads

When Hub B reads messages from Hub A's shared alliance channel, Hub B
gets the messages *and* their reactions in one shot.
`server/voxply-hub/src/routes/alliances.rs::get_alliance_channel_messages`
loads reactions for both local and remote rows by reusing
`messages::load_reactions` (made `pub(crate)` for this).

## What federation does **not** do

- **No global directory**. There's no DHT or seed-list mechanism in active
  use. `voxply-seed/` is a scaffold; users connect by URL.
- **No automatic peer discovery**. Alliance members are added explicitly
  via invite tokens.
- **No cross-hub user identity sync**. Your pubkey is the same; your
  membership rows on each hub are independent.
- **No multi-device account sync** (today — see [decisions.md](decisions.md)).

## Where to look in code

| Concern              | File |
|----------------------|------|
| Outbound HTTP client | `server/voxply-hub/src/federation/client.rs` |
| Inbound handlers     | `server/voxply-hub/src/federation/handlers.rs` |
| DM outbox worker     | `server/voxply-hub/src/dm_worker.rs` |
| Wire models          | `server/voxply-hub/src/federation/models.rs` |
| Alliance routes      | `server/voxply-hub/src/routes/alliances.rs` |
