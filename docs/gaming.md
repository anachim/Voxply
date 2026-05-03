# Gaming

Voxply's "gaming" pillar is a **distribution + runtime platform**, not
a set of games we ship. Game authors publish games, hub admins install
them, users play them inside the hub UI. The platform is what we build —
a runtime that hub admins use to bring games into their community.

## Tiers

Three tiers, simplest first. Tier 1 is the only one shipping today.

### Tier 1 — flash-style

Small single-player or turn-based HTML5 games embedded in a sandbox.
Low-risk surface; no multiplayer machinery. Good for casual hub use.

- Currently per-hub installation
- Iframe sandbox
- Today's reference game: dice game (`server/voxply-hub/src/routes/games.rs`)

### Tier 2 — party multiplayer

Small-group multiplayer (≤20) over the existing hub WebSocket. Party-
game and social-deduction shape. State lives on the hub for the game's
lifetime.

**Not built.**

### Tier 3 — MMO

Persistent shared game state scoped to one hub or alliance. Much bigger
engineering; real stretch goal. Proximity voice (volume attenuates with
in-game distance) is the voice integration that makes Tier 3 feel real.

**Not built.**

## What the platform provides

When the SDK ships, it will expose:

- **Game bundle format** — manifest + HTML5/WASM entry + assets
- **Sandbox runtime** — iframe first, WASM module host later
- **SDK** — APIs for hub/user context, state sync, voice attenuation,
  per-user / per-hub persistence
- **Game registry** — central vs hub-operated still open
- **Hub admin UI** — browse, install, enable/disable per hub
- **User UI** — launch from a channel or a dedicated game tab

## What we explicitly DO NOT build

Games. The platform ships with one or two reference games (chess, dice)
to demo the SDK. Beyond that, every game is third-party.

## Open design questions

- Iframe-only, or native WASM via the desktop client?
- Author publishing flow — anyone with a signed manifest, or moderated?
- Game state storage — hub DB, IPFS, author's choice?
- Multiplayer protocol — dedicated WS per game instance, or main chat WS?
- Alliance scope — separate instance per hub or shared state across the alliance?

## Future: games at the farm level

Once the [farm model](farm-model.md) lands, games belong at the **farm
level**, not per hub. One install, available to every hub on that farm.
The catalog, files, dashboards, matchmaking, persistent state, and Tier
2 WebSocket multiplexer all live on the farm.

Why:
- One source of truth for game files; no duplication across hubs.
- Bigger matchmaking pool (the whole farm).
- Hub admins opt in to enable a game; they don't re-install.

Cross-farm sessions follow the same shape as [federated DMs](federation.md):
one **host farm** owns authoritative state; **joining farms** opt their
users in via signed "member in good standing" tokens.

## How to apply when gaming comes up

The question to ask is "what does the platform need" (SDK, registry,
sandbox), not "what game should we write". Reject scope that drifts into
building games beyond minimal reference demos.
