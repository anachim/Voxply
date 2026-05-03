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
- Today's reference game: dice game
  (`client/voxply-desktop/public/demo-games/dice.html`)

**Authoring a Tier 1 game** — see
[the manifest reference and SDK below](#authoring-a-tier-1-game).

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

---

## Authoring a Tier 1 game

This section is the practical reference for anyone writing a game or
trying to install one. It covers the manifest format, the install flow,
the iframe sandbox model, and the postMessage SDK.

### The manifest

A game is a JSON file conventionally named `manifest.json`. Schema:

```json
{
  "id": "my-cool-game",
  "name": "My Cool Game",
  "version": "1.0.0",
  "entry_url": "https://example.com/my-cool-game/index.html",

  "description": "Optional one-line description.",
  "thumbnail_url": "https://example.com/my-cool-game/thumb.png",
  "author": "Your Name",
  "min_players": 1,
  "max_players": 1
}
```

| Field | Required | What it is |
|-------|----------|------------|
| `id` | yes | Stable unique identifier. Re-installing with the same id updates the existing entry — use this for game updates. |
| `name` | yes | Display name in the sidebar and game launcher. |
| `version` | yes | Semver string. Shown in the games list. |
| `entry_url` | yes | The URL the iframe loads. Must start with `http://`, `https://`, `data:`, or `/`. `javascript:`, `file:`, and other schemes are rejected. |
| `description` | no | One-line description. |
| `thumbnail_url` | no | URL of a thumbnail (currently used in the title hover, future: rendered inline). |
| `author` | no | Free-form attribution. |
| `min_players` | no | Defaults to 1. Used by Tier 2 matchmaking when it ships. |
| `max_players` | no | Defaults to 1. Same. |

### How install works

A hub admin opens **Install game** in the games sidebar and provides
the game in one of two ways:

1. **Manifest URL** — paste a URL that returns the JSON above. The hub
   fetches it, validates the fields, and stores the metadata in
   `hub_games`. Use this for any game hosted somewhere reachable.
2. **Inline manifest** — pass the JSON directly via the Tauri command
   without a URL. Used by the bundled demo dice game (its `entry_url`
   points at `/demo-games/dice.html` shipped inside the desktop client).

Once installed, the game shows up in the sidebar **for every member of
that hub** and clicking it opens the iframe in the main panel.

The hub does **not proxy** the game. It only stores the manifest. The
iframe loads `entry_url` directly from the user's machine, so the
author's hosting (CDN, S3, GitHub Pages, etc.) is what serves the game.

### Iframe sandbox model

The game runs in a Tauri webview iframe that's sandboxed. Practical
implications for game authors:

- **No access to the parent's DOM**, cookies, or storage. Cross-origin
  isolation is enforced by the browser.
- **The game can use its own `localStorage`/`sessionStorage`** scoped
  to the `entry_url`'s origin.
- **Same-origin XHR/fetch** is fine. CORS rules apply for anything
  else.
- **No native APIs**: no filesystem, no microphone, no Tauri commands.
  If you need any of that, you need a proper integration (not a Tier
  1 game).

### The postMessage SDK

The parent client sets up a `message` listener on the iframe. Today
the SDK is intentionally tiny — just one call.

**Get the current user**:

```js
window.parent.postMessage({ type: "voxply:getUser" }, "*");

// Reply arrives as:
window.addEventListener("message", (e) => {
  if (e.data?.type === "voxply:user") {
    const user = e.data.data;
    // user = { public_key: "...", display_name: "...", avatar: ... }
  }
});
```

**Theme**: the parent appends `?theme=<calm|classic|linear|light>` to
the iframe `src`. Read it from `location.search` and apply your own
theming — your CSS can't read the parent's CSS variables across the
iframe boundary. The dice game has a working pattern.

### Minimal complete example

A "hello, $username" game in one HTML file:

```html
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Hello</title></head>
<body>
  <h1 id="greeting">Hello!</h1>
  <script>
    const themeParam = new URLSearchParams(location.search).get("theme");
    if (themeParam) document.documentElement.dataset.theme = themeParam;

    const onUser = (e) => {
      if (e.data?.type !== "voxply:user") return;
      document.getElementById("greeting").textContent =
        `Hello, ${e.data.data.display_name || "player"}!`;
    };
    window.addEventListener("message", onUser);
    window.parent.postMessage({ type: "voxply:getUser" }, "*");
  </script>
</body>
</html>
```

Host this file at, say, `https://yoursite.example/hello/index.html`.
Then create a manifest at `https://yoursite.example/hello/manifest.json`:

```json
{
  "id": "hello-game",
  "name": "Hello",
  "version": "1.0.0",
  "entry_url": "https://yoursite.example/hello/index.html",
  "description": "Says hi to whoever is playing."
}
```

Hub admin pastes the manifest URL → game appears in everyone's sidebar.

### Updating a game

Re-install with the same `id` and a new `version`. The hub does an
upsert: name/description/version/entry_url all replace; install metadata
(who installed it, when) is preserved.

### Uninstalling

Hub admin clicks **Uninstall** on the game in the sidebar. The
manifest row is deleted. The hosted game itself is unaffected — the
hub only forgot about it.

### What doesn't work yet

- **Persistent per-user state on the hub** — games can use their own
  origin's `localStorage`, but if you need state to follow a user
  across devices, the SDK doesn't expose that yet.
- **Multiplayer** — Tier 2 work, not started. Today's iframe is local
  to one client.
- **Voice integration** — Tier 3 (proximity voice), not built.
- **Game permissions** — every Tier 1 game has the same minimal
  sandbox. Authors can't request extra capabilities.
