# Next up

**What we are working on and about to work on.** Everything here is
*designed* — the thinking is done and the remaining work is doing it — plus
the open bugs.

Work that is on the list but **not yet designed** lives in
[future-features.md](future-features.md). Things we might introduce one day
and have not committed to live in [wishlist.md](wishlist.md). Shipped work
moves to [shipped-log.md](shipped-log.md); design rationale to
[decisions.md](decisions.md).

## 🔨 In flight

- [ ] **Split the web client into a hub build and a user build.** Designed
  2026-08-25 — decisions.md, "Two web clients: one per hub, one per user". One
  codebase, two targets: the hub build shows one hub and its interconnections,
  the user build (hosted by us, next to the directory) is the only one that
  knows what a list of hubs is.
  - **one repo, one app, two targets** — not two repos and not two `apps/`
    directories. Measured 2026-08-25: 328 files and ~51k lines across
    `apps/web` + `packages/ui`, of which **11** touch discovery / add-hub /
    create-hub / home-hubs at all. The difference is UX, not code; the hub
    build is the user build *minus* entry points, and a subtraction wants a
    flag. Two `apps/` dirs would fork `App.tsx`, the app-local state
    orchestrator, which is the one file not to duplicate. Two repos would also
    make a fifth copy of the wire-format mirror and re-run the divergence that
    `packages/ui` was created to undo (desktop's `Other => {}`: four hub
    features silently absent for months). Revisit only if the hub build ever
    becomes *additive* — its own features rather than fewer.
  - **[done 2026-08-26]** the flag: `MULTI_HUB` in
    `apps/web/src/constants.ts`, from `VITE_BUILD_TARGET` via `.env.hub` and
    `vite build --mode hub` — no `vite.config.ts` change needed, and the
    literal comparison still folds, so the dropped screens leave the bundle.
    `npm run build:hub` → `dist-hub`; `scripts/check-hub-build.mjs` asserts
    three **code-only** markers present in `dist` and absent from `dist-hub`
    (i18n keys are useless as markers — the catalogs ship whole in both
    builds, which is how the first version of that check failed on a clean
    bundle). Dropped: the `+` menu, AddHubModal, the create-hub wizard, the
    directory, the home-hub editor. `WelcomeScreen` gained `hubUrlLocked` so
    the address cannot be retyped into a second, unreachable hub.
    What the hub build **keeps**: everything cross-hub that routes through its
    own hub (alliance channels, messages, forum — all already `hubFetch`),
    *and* alliance voice, which dials the owning hub's relay direct. Defining
    the flag as "one origin only" would break alliance voice.
  - **[done 2026-08-26]** the member-invite path: `redeemInvite` calls
    `POST /join/:code` when a path invite arrives with a live session, so an
    invite clicked by an existing member applies its role grant instead of
    being dropped. The effect waits on a restore-settled flag rather than
    racing it — `hubs.length` cannot tell "restored, empty" from "not run".
  - **[done 2026-08-26]** the early handoff, as a **link** rather than a
    postMessage: only hub URL and invite code travel, both public. Offered on
    the identity-creation screen (`USER_CLIENT_URL`, null until the hosted app
    has a domain), received as `?hub=&code=` and collapsed to an invite URL so
    the add-hub flow sees one shape; `handoffTargetUrl` round-trips against the
    real parser in test.
  - **[done 2026-08-26]** the late handover, by `postMessage`:
    `packages/core/handover.ts` (protocol + guards — a malformed seed rejects
    the whole offer rather than dropping the field, which would read as a join
    that quietly left the identity behind), `MoveToUserClientSection` sending,
    `/adopt` receiving, wired in `main.tsx` so it runs without the app booting.
    The receiver names the sending origin as the browser reports it, shows the
    fingerprint and asks; the sender wipes only on the acknowledgement, then
    reloads onto the identity screen carrying a "you moved" notice. Verified
    across two real origins in both directions — including that "keep my
    identity" wipes nothing, which is where a wrong wipe would destroy a key.
  - **[done 2026-08-29]** RP ID: it has no bearing, because the user build
    never gets to pick one — decisions.md, "Passkeys belong to the hub, so the
    user build has none". A passkey's rp_id is the hub's own hostname and a
    browser only honours an rp_id the page is registrable under, so the
    ceremony works on the page a hub serves and nowhere else. The affordances
    are now gated on `passkeysUsableWith(hubUrl)` — the page's origin, not the
    build flag, so a self-hoster serving either build gets the right answer —
    and the handover screen no longer promises a new passkey on the other side.
  - **[done 2026-08-29]** the build half of the release pipeline: `build.yml`
    and `release-web.yml` build both targets and run `check-hub-build`, the
    hub's Dockerfile bakes `dist-hub` (`WAVVON_WEB_CLIENT_DIR` unchanged), and
    the release attaches `web-dist-hub.tar.gz` next to `web-dist.tar.gz` so a
    bare-binary install has the right artifact. Both come from one commit,
    which is what makes "version-matched" true by construction rather than by
    discipline. Nothing downstream had known about the split until then: every
    hub was serving the *user* build, offering add-a-hub and the home-hub
    editor from its own origin, and `check-hub-build` — never wired into CI —
    had gone red when the create-hub removal took two of its markers with it.
    No Playwright smoke per target: the bundle check already proves the dropped
    screens are absent, and it cannot be fooled by a screen that renders
    nothing.
  - release pipeline, the half that is left: **deploying the user build**.
    `discovery/` is already a running Next.js site and is the obvious host, but
    it has no deployment of its own yet, and `USER_CLIENT_URL` stays null until
    that host has a domain — which is also what keeps the handover button and
    its `check-hub-build` marker dormant.
  - LAN mode keeps the hub build as its only web path — an HTTPS page cannot
    reach an `http://` or self-signed LAN hub ([lan-mode.md](lan-mode.md)).

- [ ] **Browser e2e in CI — the tail.** The suite is no longer tied to one
  laptop, and since 2026-09-03 no longer tied to a *fast* one:
  `WAVVON_E2E_HUB_URL` / `WAVVON_E2E_APP_URL` override both ends, and
  `e2e-live.yml` starts postgres, builds the hub, builds the web client and
  drives Chromium against them. The runner's original 8 failed / 65 flaky /
  12 passed in 1h49m had two causes, both fixed (shipped log): CI served the
  **Vite dev server**, and the app's own **once-per-load self-reload** landed
  in the middle of interactions. Left:
  - **audio**, still. `WAVVON_PUBLIC_URL` is set now, so the hub advertises a
    transport, and setting it changed nothing: 86 passed / 1 skipped locally
    either way. That is the finding — every voice spec asserts on roster state
    the hub pushes over the WebSocket, so all of them pass whether the
    transport connected, failed, or was never attempted. The cert question is
    settled separately (`58-voice-wt-handshake`, shipped log): Chromium does
    accept the hub's self-signed cert through `serverCertificateHashes`. What
    no spec here can do is prove a datagram carried audio, and two clients on a
    real network remains the only thing that does;
  - **[done 2026-09-07]** the residual flakiness — four specs, one cause, and
    it was a product bug rather than a test one: a hub whose startup re-auth
    met a 429 was dropped from the restored list silently, which is the
    welcome screen (shipped log).
  - **[done 2026-09-07]** `54-ttt-game`, which had failed on the runner on
    every push for days: the demo bot exited on a `429` from the shared per-IP
    auth limiter while waiting to be invited, so the invite the spec sent
    arrived at a process that was gone (shipped log). The colour of a live run
    means something again — before this, the only usable signal was the *list*
    of failures, not the red.

- [ ] **Topology e2e — the stages not yet built.** `e2e-topology/` at the
  monorepo root drives real hub binaries plus the discovery site: alliance
  formation across two hubs, federated channel reads, the alliance voice grant
  and its confinement, `voice_remote_join`, the cert pull between two hubs,
  directory publish + search, one farm end to end, and two farms with an
  alliance across the boundary, one live browser spec over a hub it booted,
  the live suite over a hub behind a farm proxy, and a browser reading *and
  joining voice in* a channel the allied hub hosts. **19 scenarios**, green
  (the seed stage went with the seed crate). It has found **ten** real bugs
  so far, each invisible to the in-process suites for the same reason — those
  construct their own state, and neither Node's `fetch` nor `axum_test` is a
  browser, so the real defaults, the real proxy and the real CORS preflight
  were never in the picture (shipped log). What it does not cover yet:
  - **audio.** The visitor is admitted and handed a relay URL, cert hash and
    token, and stops there — no datagram crosses. This proves admission, not
    audio, and two clients on a real network remains the only thing that proves
    audio.
  - **audio across an alliance.** `alliancebrowser` drives the 🔊 on a
    federated row and the WebTransport session to the *allied* hub's relay
    comes up (`60-alliance-voice`; the voice label is set from `onReady`,
    which fires after `transport.ready`, so a named label is an open
    transport). What no harness proves is a datagram anyone could hear.

- [ ] **Bundled PostgreSQL — the tail.** The hub carries its own PostgreSQL
  since 2026-08-30 (decisions.md,
  [The hub bundles PostgreSQL](decisions.md#the-hub-bundles-postgresql-and-never-touches-one-it-did-not-create)):
  mode by the absence of `WAVVON_DATABASE_URL`, version-scoped installs, a
  refusal with instructions on a major mismatch, `doctor` reporting mode and
  data directory, and backup/restore through the bundled `pg_dump`. Left:
  - **the actual major upgrade.** The refusal is tested; the dump-with-old,
    restore-with-new path it names has never been walked end to end, because
    doing that needs two hub binaries carrying two PostgreSQL majors.

- [ ] **Desktop live-drive verification — the tail.** The harness exists
  (2026-09-06, shipped log): `clients/apps/web/e2e/desktop/`, Tauri dev +
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port` + Playwright
  `connectOverCDP`, with `WAVVON_DESKTOP_HOME` keeping a run out of the
  developer's own `~/.wavvon`. It found three bugs on its first run and all
  three are fixed (shipped log). DM and pairing are driven in both directions
  (`01`–`03`). Left:
  - the desktop→web DM leg is done (shipped log): the fix was not in the DM
    path but in **which identity the desktop signs as**, and it left a
    question worth carrying — every hub-verified signature now routes through
    `auth_creds::hub_identity`, but a *paired* desktop device still signs
    group envelopes and sender-key distributions with its subkey, which the
    hub verifies against the canonical with no cert tier. Same gap on web.
    Nothing exercises it yet.

- [ ] **App.tsx refactor — desktop parity + convergence.** Web 1,665 lines /
  desktop 1,793, counted 2026-09-06. The hook-extraction phase landed
  2026-07-28 and after, the **modal render tree left web on 2026-08-31**
  (`components/layout/AppModals.tsx`, 213 lines out of App.tsx) and **desktop
  on 2026-09-06** (275 lines, shipped log — there the hooks that own a cluster
  of the values travel whole instead of being flattened into thirty props).
  The container phase is now **all** of the mechanism this item gets:
  decisions.md 2026-09-05 declined the state store, so what is left shrinks
  App.tsx by removing duplication, not by moving plumbing. Left:
  - **desktop parity pass** on the web slices desktop still lacks;
  - **convergence** — the actual payoff: web/desktop hook pairs (`useDms`, `useScreenShare`, `useWhisper`, …) differ mainly in platform access, which can travel in via an injected actions object like `packages/ui` components already do. Hoist converged pairs into `packages/ui`, delete both app copies. App.tsx stays app-local orchestration by design.
    **Four pairs are converged: `useUnreadCounts`, `useWhisper`,
    `useTypingIndicators` (2026-09-05) and `useAlliances` (2026-09-07) —
    shipped log.** The pattern they set: platform
    access injected as deps, pure logic in `utils/` where it can be tested
    without a renderer (`packages/ui` has no jsdom), and each merge is a
    *union* — the copies had drifted in both directions, so there is no
    "behind" client to port from. Expect behaviour questions, not just
    plumbing: two of the three fixed a real desktop bug on the way.
    **The remaining pairs were surveyed and are not the same job**, so do not
    plan them as more of the above:
    - ~~`useAlliances` (97/48)~~ — **done 2026-09-07** (shipped log). It was
      the entangled one, and the entanglement was the point: desktop's
      selection and messages moved out of `useChannelMessages` into the hook
      before the two could merge. Two behaviour questions surfaced on the way
      (a composer cleared before a send could be refused; a failed *refresh*
      reported as a failed send), and one desktop branch turned out to be
      unreachable and was deleted.
    - `useSettingsProfile` (197/133) — **not a pair worth merging.** Only the
      theme/skin state is shared. Web additionally owns multi-account
      switching (including a sessionStorage hand-off that exists because a
      browser reloads), the custom-theme store and the recovery phrase;
      desktop handles those in `AccountRoot` and `ManageAccountsTab`. The
      union would be mostly `if (web)`.
    - `useDms` (142/361) — **converges everywhere except the send.** The
      returned keys line up (seven outright, three more differing only in
      name), but that reading flattered it: reading the bodies, the two hooks
      sit at *different layers*. Web's encryption is entirely in
      `platform/commands/dms.ts` and the hook is a state container; desktop
      keeps the whole decision tree inline — group vs 1:1, the `no_sender_key`
      retry, `fetch_dh_key`, `init_dr_session`. Converging the send means
      first moving desktop's tree into its own command layer, which is a
      refactor of the DM path rather than a hoist. The state, selection,
      loading and WS arms would converge cheaply, and save about as many lines
      as the shared hook plus two adapters would add — so **not worth doing
      for its own sake**; do it if the send path is being reworked anyway.
      The union item that *was* visible is done: `encryptionWarning` shipped
      on desktop only, and closing that gap is what surfaced the unencrypted
      DM fallback (shipped log, 2026-09-07). `EncryptionWarningModal` now
      lives in `packages/ui` and both clients use it.
    - `useScreenShare` (16 returned keys web / 5 desktop, **1 in common**) and
      `useVideo` (9 / 16, **1 in common**) — **not pairs at all, and the
      earlier note here claiming "the size gap is platform transport, not
      drift" was wrong** (measured 2026-09-07). They have diverged in
      *features*, in both directions: web owns screen-share viewing, hub
      streams, subscriptions and watch/stop-watch while desktop owns only
      start/stop; desktop owns video backgrounds, camera switching, device
      selection and pinning while web owns the remote-stream plumbing.
      Converging them means building the missing halves first — that is
      **parity work, filed above**, not a hoist, and treating it as a hoist
      would silently drop whichever side went second.
  - Not worth extracting (checked 2026-07-27): message send/edit.

- [ ] **First external operator pilot.** A hub is live on an external
  operator's own server, **wiped and rebuilt on v0.5.0 (2026-08-21)** after an
  in-place 0.3.2 → 0.5.0 upgrade proved the migration path; the old install
  held two accounts and zero messages, so nothing was worth keeping. The hub
  boots blank and its first-boot owner invite is **unredeemed**. Remaining:
  redeem it, operator onboarding + ownership transfer, hub naming and channel
  setup, whether the docs were enough to get there, and the two-operator
  federation test. First real operator feedback arrived 2026-08-21 — four UI
  items fixed same day, the rest in Known issues. Host details and
  per-deployment steps stay out of this repo.

- [ ] **Voice v2 across the internet — confirm the fix on the pilot.** It has
  crossed: audio arrives over WebTransport/QUIC, so port, cert trust tier and
  relay all work. It arrived choppy, and the cause turned out to be the web
  client scheduling every frame on arrival rather than the network (fixed
  2026-08-21). What is left is one two-client session on the pilot to hear
  whether it is actually gone.

## 🚧 Blocked

Committed, cannot proceed.

- **Windows code-signing** — blocked until the project reaches meaningful
  popularity; ship unsigned with the documented SmartScreen workaround
  ([code-signing.md](code-signing.md)). Consequence worth naming: with the
  desktop client not seriously distributable, web is the only real channel,
  which is what makes the capability/version-skew work product scope rather
  than a 1.0 nicety. A desktop client is structurally immune to that skew, so
  signing would relieve pressure there too.

## ⚠️ Known issues

**Open, and not necessarily scheduled** — a bug being listed here says it is
real and unfixed, not that anyone is on it. When one is fixed its entry moves
to the [shipped log](shipped-log.md).

- **Voice audio was choppy across the internet** — cause found and fixed
  2026-08-21 (no playout scheduling in the web client; see shipped log). The
  jitter only exists on a real network, so **the audible confirmation is still
  outstanding** — it needs a session on the pilot. Reopen this if it persists.

- **Discord importer needs a live run** — `export` with a real bot token +
  `apply` against a running hub never exercised live.

- **Windows installer unsigned** — SmartScreen warning; "More info → Run
  anyway". See the code-signing blocker.

- **Bot deferred scope** — bot DMs: no timeline. (Voice/video injection and
  bot-launched game modals shipped 2026-07-19 as capability-layer Phases 1–2.)

- **A second device cannot show the messages you sent from the first.** The
  own-plaintext stash is device-local by nature — a ratchet cannot decrypt its
  own envelopes, so the sending device keeps the only readable copy. Still
  true; what changed on 2026-09-05 is that it no longer *reports* itself as
  breakage: it said "[decryption failed]", which is what a tampered message
  says, and now says you sent it from another device (shipped log).
  **This is now close to permanent.** Of the three ways out, two are gone.
  Syncing the sender's stash through the prefs blob needed a paired device to
  derive the blob key, which needed the identity vault — rejected outright on
  2026-09-05, so that route is closed rather than waiting. Re-encrypting each
  message to the sender's own DH key remains possible and is not worth it: a
  second ciphertext on every message and a cross-repo wire-format change, for
  the convenience of reading your own sent history on a second device. What
  shipped is the third: saying so honestly.
  Reopen only if someone actually asks for their sent history across devices —
  and then the answer is the re-encryption, priced accordingly.
  Edge of the tracked paired-device canonical-DM follow-up
  ([client-parity.md](client-parity.md) pairing item).
