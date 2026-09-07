# Shipped log

Full historical record of shipped work, moved out of [ROADMAP.md](../ROADMAP.md)
to keep the roadmap slim. Newest entries first. Forward-looking work lives in
the roadmap; design rationale lives in [decisions.md](decisions.md).

- **One `useAlliances` for both clients (2026-09-07)**: the fourth converged
  hook pair, and the one `next-up` had flagged as entangled — rightly. Unlike
  the first three these had not drifted in behaviour; they had split the same
  work differently. Web kept alliance selection and messages in
  `useAlliances`, desktop kept them inline in `useChannelMessages` and left
  its `useAlliances` holding only the list, so the merge began by moving
  desktop's half out. Web's split won: the alliance IO belongs with the
  alliance state, and it leaves `useChannelMessages` taking the same props on
  both clients. State and flow now live in `packages/ui`; each app keeps a
  thin adapter for its own platform calls, and the send/refresh sequence went
  to `utils/allianceSend.ts` where it can be tested without a renderer.
  Two behaviour questions surfaced, as this pattern keeps promising: desktop
  cleared the composer **only on a successful send** while web cleared it
  first, so a refused send (an alliance revoked, the far hub down) took the
  message with it — the union keeps desktop's; and posting to an allied
  channel is two independent round trips (relay, then re-read through our own
  hub), so a send that landed with a refresh that did not was being reported
  as a failed send, which invites a double post. One desktop branch was
  **deleted rather than merged**: opening a shared channel as a local one
  cannot fire, because `ChannelSidebar` builds the alliance group as
  `remoteOnly` and filters out exactly those channels. The apps shed 186
  lines. Verified past the unit suites, since nothing in-process covers a
  federated read: `e2e-topology alliance alliancebrowser`, 5/5, including a
  real browser on one hub reading a channel its ally hosts.

- **A failed re-auth no longer ends the session in place (2026-09-07)**: two
  more dead ends of the same shape as the one below, on the live-connection
  path. `ws.ts`'s `scheduleReconnect` handed over completely once the socket
  had failed `REAUTH_AFTER_FAILURES` times — it called `onReauthNeeded` and
  returned **without arming its own retry** — and the handler swallowed the
  outcome (`.catch(() => {})`). A re-auth that failed for reasons that say
  nothing about the session left no timer, no socket and no further attempt,
  for as long as the tab stayed open; nothing else revives it, since the web
  client listens for neither `online` nor `visibilitychange`. Meanwhile
  `useHubConnection` had already announced "Disconnected from X.
  Reconnecting…", so the UI kept promising a retry that no longer existed —
  worse than silence. **Desktop never had this**: `useReconnectBackoff` keeps
  trying and a failed manual attempt hands control back to the auto loop, a
  divergence where desktop was ahead. The socket now arms its retry
  regardless (a successful re-auth calls `close()`, which cancels that timer,
  so no double socket), and the handler logs and guards against stacking
  re-auths. Covered by a fake-WebSocket test that fails if the `return` comes
  back.
  The same commit widens the startup restore retry from [1s, 2s] to
  [2s, 4s, 8s], and the reason is arithmetic rather than caution: **a
  handshake is two limited requests** (`/auth/challenge`, then
  `/auth/verify`) against a bucket that refills 1/s, so a 1s wait buys one
  token, the challenge spends it, and verify meets an empty bucket again — a
  1s retry against a drained limiter cannot succeed however often it runs.
  That is what kept two specs flaky after the first fix (4 → 2, not 4 → 0):
  the CI trace reads 200/429, wait 1s, 200/429, wait 2s, 429, give up.
  `39-soundboard` met it directly and `46-badges` through the app's own
  once-per-load reload, which runs the restore again *after* a successful
  join. Reading that trace was only possible because the report upload had
  just moved to `always()`.

- **A rate-limited startup no longer loses every hub (2026-09-07)**:
  `restorePersistedHubs` skipped a hub on *any* error, in a `catch` with no
  binding and a one-line comment about unreachable hubs. Right for a hub that
  is gone, wrong for one answering "not now" — and the web client keeps its
  token in `sessionStorage` unless asked to remember it, which nothing in the
  UI asks, so that path re-authenticates on **every page load** against a
  limiter the hub keys by IP (burst 10, refill 1/s) and shares with every
  other tab and everyone else behind the same address. The user's hub vanished
  and the welcome screen came back, with nothing said anywhere. A transient
  failure (429, 5xx) is now retried at 1s and 2s — short, because the limiter
  refills continuously and this is waiting for a token, not backing off from
  an outage — while anything else still fails on the first attempt, so an
  unreachable hub costs no extra startup time. The `catch` names the hub and
  the error now instead of swallowing them. This was also the entirety of the
  live suite's residual flakiness: all four flaky specs failed in
  `expectInHub` with "Join hub" still visible, which is what an empty restored
  hub list looks like. Reproduced by draining the hub's auth bucket and
  running `33-moderation` — the trace pins a 429 on `/auth/challenge` — and
  the same drained-bucket run passes with the fix. The Playwright report now
  uploads on `always()`: a flaky run counts as success, so the traces of the
  failed attempts were being thrown away, which is why the diagnosis had to
  start from a local reproduction instead of from CI.

- **A rate-limited bot no longer dies waiting to be invited (2026-09-07)**:
  `ttt-bot` retried only `403 bot_not_invited`; any other failure escaped
  through `?` and ended `main`. The one that happens is `429` — the hub's auth
  limiter is per-IP (burst 10, refill 1/s) and shared with everything else
  authenticating from that address, and in CI the hub, the bot and the whole
  browser suite are all on `localhost`. About five minutes into its wait the
  bot collected a 429 it had done nothing to earn and exited, so when
  `54-ttt-game` invited it moments later there was no process left to accept:
  the poll for its registered `ttt` command timed out on every run and the
  live workflow was red on every push, whatever the push contained. An attempt
  is now `try_authenticate` — `Ok(None)` for "not invited yet", `Err` for a
  failed attempt — and the caller logs and retries either way;
  `/auth/challenge` gained `error_for_status()` so a rate-limited response
  says 429 instead of failing to parse its own body as JSON, which is the
  shape the failure took first. Proven against a real hub with the auth bucket
  deliberately drained: the bot logs the 429s, keeps waiting, authenticates
  when the bucket refills, and the spec passes end to end. That was also
  `54-ttt-game`'s **first local run** — it skips itself without
  `TTT_BOT_PUBKEY`, which is exactly why nothing local had ever seen this.

- **A desktop identity gets asked its name (2026-09-06)**: the display-name
  prompt was web-only, and so was the onboarding nickname step, so a fresh
  desktop identity joined every hub with an empty `display_name` and sat in
  the roster as a slice of its pubkey until the user found the profile editor.
  The prompt is now `DisplayNamePrompt` in `packages/ui`, holding its own
  draft — which is what makes it reusable, and what let web drop the three
  props it threaded through `App.tsx` for it. Desktop asks on the first hub an
  identity joins with no name, and applies the default profile silently
  instead when there is one, the same condition web uses.

- **Pairing is driven in both directions (2026-09-06)**:
  `03-pairing-desktop-web` has the desktop app issue the code and a fresh
  browser claim it, which is the shape of "I installed the web client on a
  second machine". With `02` it says the two clients agree on the payload
  both ways rather than happening to meet one way.

- **Web and desktop can pair with each other (2026-09-06)**: they could not,
  in either direction, and nothing said so — the paste was rejected as
  invalid. Web handed the new device `base64({hub, token})`, a pointer to an
  offer the hub holds; desktop's `parse_pairing_offer` wants the signed
  `PairingOffer` JSON that [multi-device.md](multi-device.md) specified from
  the start. The offer won (decisions.md, "The pairing code is the signed
  offer itself, not a pointer to it"): it carries the master pubkey over the
  channel the user actually trusts — their other device's screen — where the
  pointer left the hub free to answer with a master of its own choosing, and
  it carries the home hub list, so one unreachable hub cannot block pairing.
  Web now shows the offer verbatim, and its claim verifies the signature,
  checks expiry, tries every hub in `home_hubs` in turn, and refuses a
  completion whose cert names a different master than the code did.
  `verifyPairingOffer` in `packages/core`; the desktop client is unchanged.
  `02-pairing-web-desktop` drives the whole thing across two real clients and
  ends on the hub's own device registry holding the cert.

- **A desktop DM reaches the hub, and reaches it encrypted (2026-09-06)**: the
  desktop client signed everything a hub verifies with the wrong key. It was
  found as "a DM sent from desktop reaches nothing, silently" and it was not a
  DM bug: an entropy-holding identity presents a **self-signed cert** at
  `/auth/verify` so the hub learns which master its roster pubkey belongs to
  (without that link no hub can resolve a home hub list), and a hub meeting
  that identity for the first time seats the **master** as the user — the
  hub's `resolve_canonical_identity`, "brand-new paired device" branch. The
  desktop client never learned that: it claimed and signed as its own device
  key everywhere. So the hub rejected the DM envelope
  (`Invalid envelope signature`), and `publish_dh_key` wrote the DH record
  under a pubkey with no `users` row — which is why the *other* direction
  arrived in **plaintext**: web looked up a key that was never stored.
  Web has none of this because a primary web device authenticates with no
  cert, so its canonical *is* its own key, and it already carries
  `canonical_pubkey` for the paired case.
  The fix is one resolver, `auth_creds::hub_identity`, and every hub-verified
  signature routed through it: the DR envelope, the group envelope, group
  sender-key distribution, the DH key record (published per hub now, since the
  canonical differs per hub), and `get_my_public_key`, which is what the UI
  compares against to answer "is this mine". A paired device signs with its
  subkey and the envelope carries its cert, which is the shape web has sent
  since paired-device DMs landed. Two envelope-shape bugs died on the way: the
  v2 envelope omitted `nonce_hex` entirely, which the hub requires, so every
  desktop DM 422'd before any of the above was reachable.
  `01-dm-web-desktop` passes both legs, and both rows are stored encrypted.
  The harness itself needed two fixes to be believed: `beforeAll` inherits the
  test timeout, so its 300-second wait for the debug port was being killed at
  30, and the app survived the kill — three windows were left running, and the
  next run attached to one of *them* and reported what a stale build did. It
  now refuses to start when the debug port already answers, and kills by pid
  every app process that appeared since launch.

- **Playwright drives the real desktop app now (2026-09-06)**: WebView2 is
  Chromium, so the Tauri window speaks CDP when it is started with
  `--remote-debugging-port`. `clients/apps/web/e2e/desktop/` sets that through
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`, spawns `tauri dev`, waits for the
  port and connects — the app's own page, its real IPC and Rust commands and
  its file-backed account store, none of which a browser context touches. It
  lives beside the web suite because half of every spec is the web client, and
  it is a separate Playwright project (`desktop`) that CI never runs.
  `accounts.rs` gained `WAVVON_DESKTOP_HOME` for it: without a way to move that
  root, the harness drives the developer's own `~/.wavvon`.
  **It found three things before it was green, which is the whole argument for
  it.** A DM sent *from* desktop reaches nothing — the composer clears, the hub
  gains no `dm_messages` row, and no error or encryption warning appears
  anywhere; web→desktop passes in the same spec, so the Rust side decrypts what
  TypeScript encrypted and the failure is one-directional and silent. Web and
  desktop **cannot pair with each other at all**: web's pairing code is
  `base64({hub, token})` and desktop's claim wants a signed `PairingOffer`
  JSON, so neither reads the other's code in either direction and the pairing
  spec this item asked for cannot be written yet. And desktop has no way to set
  a display name while onboarding — the nickname step and the post-join prompt
  are both web-only — so a fresh desktop identity joins as a bare pubkey.
  The DM spec is **left failing on purpose**: it is the reproduction, in a
  project nothing else runs.
- **The list-endpoint pagination sweep is finished (2026-09-06)**: seven more
  lists take `limit` and a keyset `cursor` — `/moderation/bans`,
  `/moderation/mutes`, `/invites`, `/hub/pending`, `/conversations`,
  `/channels/{id}/pins` and `/channels/{id}/polls` — with the shared query
  shape in `routes/paging.rs` instead of an eighth copy of the same struct.
  `/hub/pending` is the one that pages *forward*: an approval queue is worked
  from the front, so its cursor moves the other way.
  **The six left unpaged are a decision, not a remainder.** `/roles` and
  `/channels` feed permission checks and the sidebar tree, `/emojis` and
  `/hub/icons` feed pickers, `/badges` a profile: each is bounded by admin
  action and consumed *whole* by the UI, so paging would only add a walk to a
  caller that needs every row anyway. The banlist trio already caps at 1000.
  Reopen only if one of them starts growing with member activity rather than
  with configuration.
  **A paginated endpoint without a client that pages is the same truncation at
  a larger number**, so both clients walk: `platform/commands/paged.ts` on web
  and `src-tauri/src/paging.rs` on desktop, each with the stall guard and the
  capability branch that `fetchAllUsers` worked out first — a hub predating the
  change ignores both parameters and answers with everything, and paging *that*
  returns forty copies of every row. The web helper is now what `fetchAllUsers`
  itself calls. Two desktop call sites were fetching every conversation to find
  one by id and would have quietly stopped finding it past page one.
  The capability is a **new** string, `list.cursor.lists`, rather than a wider
  `list.cursor`: a client paging one of these against a hub that advertises only
  the older one would get page one back forever.
  `/channels/{channel_id}/polls` turned out to be undocumented in `openapi.yaml`
  — the coverage check counts *paths*, and the path existed for its `POST`.
- **The desktop app speaks four languages (2026-09-06)**: the last 190
  hardcoded English strings, all of them in `apps/desktop`, are keys. What the
  scan still lists is **34 findings and not one a UI string** — a MIME type, a
  class name, the brand, `{user}` in a spawner template, a doc comment the
  text-node regex tore in half, a CSS value the expression scan reads as prose,
  and the four language names in the picker, which a language chooser shows in
  their own language on purpose.
  **Most of it was reuse, not new keys.** Wherever web had already named the
  same thing — passkeys, trusted devices, home hubs, accounts, discover,
  push-to-talk, the approval screen — desktop now reads that entry, so the two
  clients say the same words in four languages by construction. New keys went
  only where desktop has UI web does not: the pairing wizard (34 of them, with
  its own confirm/deny and fingerprint check), the screen-share picker, the hub
  browser, identity restore, the account gate.
  **The parts a scan-and-replace does not reach**, each a real defect if
  missed: `THEMES` in `constants.ts` was a module-level English label map — the
  sixth of them — and name and tagline now come from
  `settings.skin.base.<id>` and `settings.theme.tagline.<id>`, with the tagline
  family added to the template-label test because neither check can see a key
  built from an id at render time. `ThemePicker` maps over `t`, which shadowed
  the translator and type-checked happily; it binds `t: translate` instead.
  `HubCard` is a second component inside `HubBrowser.tsx` and needed its own
  `useTranslation` — the same shape that left `ReactionBar` and friends English
  inside files that looked done. `RestoreIdentitySection`'s `window.confirm`
  text is user-facing and no JSX scan finds it by shape. Three plural ternaries
  became ICU plurals (home hub save count, bot-challenge attempts remaining,
  the browser's approximate member count), and prose spliced around a value
  became one key with an argument in six places.
- **Desktop's modal tree left App.tsx (2026-09-06)**: the ~275-line
  `{showX && <XModal/>}` tail — the same move web made on 2026-08-31, and the
  parity gap the refactor item named. It joins the three modals already in
  `components/AppModals.tsx`; App.tsx goes 2,062 → 1,793 lines.
  **The prop list is where this differs from web's version.** Web flattened
  every value into its own prop and needed a 145-line `appModalsProps.ts` to
  type them. Here the hooks that already own a cluster (`useAddHubFlow`,
  `useChannelCrud`, `useVoice`) travel whole, one prop each: the same type
  safety through `ReturnType`, and a hook gaining a field costs nothing at the
  boundary. The price is that App.tsx had to *name* those hook calls before
  destructuring them, which is the only edit the move made outside the imports
  it killed.
  Two things fell out of doing it. The DM encryption warning's three buttons
  were still English literals, so they became keys (`modal.dismiss`,
  `dm.encryption_warning.send_anyway`) rather than moving as-is. And
  `find-hardcoded`'s JSX text-node regex was reporting the code between two
  adjacent `invoke<Foo[]>(…)` calls as a label — the closing `]>` pairs with
  the next call's `<`, and everything between reads as a text node. The
  lookbehind drops it now; the desktop baselines had been quietly carrying
  those, so the count fell to 190 without a word being translated.
- **You can actually leave a hub now (2026-09-06)**: `DELETE /me`. Joining a
  community had been one-way — the router had `voice/leave` and
  `alliances/{id}/leave` and nothing for a person, so a client could only
  forget a hub locally while the hub kept you in the roster, with your roles,
  as a deliverable DM recipient, forever.
  **What leaving does was decided by two facts, not by taste.** The row cannot
  go: 22 tables carry a foreign key to `users(public_key)`, including `bans`,
  `mutes` and `message_reports`, so a hard delete either fails or takes the
  moderation history with the person it was about. And a hub holds a profile,
  never an account (decisions.md, the day before), which says what to remove
  instead — the profile columns, every `user_roles` row, the sessions. The
  pubkey stays as the anchor; messages, reactions and RSVPs are untouched, and
  the author becomes a pubkey with no name.
  Two things fell out rather than being built. The roster needed no new
  filter: `/users` already requires a role row, so clearing the membership is
  what removes someone from the member list. And the owner is refused with 409
  — letting them go leaves a hub nobody can administer and nobody who can let
  anyone back in.
  **The consequence that had to be chosen rather than inherited**: membership
  *is* the roles and the invite gate is `has_roles == 0`, so leaving an
  invite-only hub makes the return that is free today need a fresh invite.
  Decided as correct, tested, and said in the confirmation — only where the
  hub actually is invite-only, read from `/info` at open time, because warning
  about it on an open hub would be noise.
  Rewriting the author on each message was considered and rejected: it breaks
  reply chains and reactions, and federated copies on allied hubs would not be
  rewritten, so one message would show two authors depending which hub you
  read it from.
  Writing the invite-gate test needed `invite_only` set straight into
  `hub_settings` — only bootstrap writes it, there is no admin route, and a
  PATCH carrying it is ignored in silence. Same gap that once hid a federation
  bug. Also worth knowing: `check-openapi-coverage` counts *paths*, so a new
  method on an existing path is invisible to it; the spec was updated by hand.
- **A timed presence status survives a reload (2026-09-05)**: "clear after" was
  a `setTimeout` and nothing else, so it lived exactly as long as the page —
  set Away for an hour, reload, and you were Away until you noticed and changed
  it by hand. A reload quietly turned a timed status into a permanent one, and
  presence is what other people see, so that is the wrong direction to fail in.
  What is persisted is a deadline now: an absolute `until`, not a remaining
  duration, because a duration restarts every time it is written back. An
  expired one comes back online, one with time left comes back with the
  remainder counting, and anything unparseable is online — the safe direction,
  since the alternative is telling everyone you are away when you are not. The
  timer stays for the reverting-while-open half; it is just no longer the only
  thing holding the promise.
  Found while checking whether "mute with a duration" could reuse an existing
  expiry mechanism. It can now; before, it would have inherited this.
- **One hub menu behind two gestures (2026-09-05)**: the chevron dropdown and
  the right-click menu on the hub header were two copies of the same seven
  items, kept in step by hand — and had already stopped being: same items,
  different order. `HubMenuItems` is now the list, rendered by both with only
  the class names differing, so an entry added once appears under both.
  It also corrects what future-features.md said the work was. That entry read
  "right-click on the hub does nothing, and that is where people from other
  clients go first"; the gesture had been built since. What was actually
  missing was anything keeping the two menus telling the same story — which is
  the failure the entry itself predicted, arrived at from the other end.
- **Your own sent DM stops calling itself a decryption failure (2026-09-05)**:
  a ratchet cannot decrypt its own outbound envelopes, so the only readable
  copy of a message you sent is the one the sending device stashed locally. A
  second device had none and rendered `[decryption failed]` — the same words a
  tampered message gets — reporting a design limit as breakage on every
  message, every time someone paired a device. It now says you sent it from
  another device and only that device keeps a readable copy, which is also true
  of a cleared local stash.
  Two things it deliberately does not do. Someone else's unreadable message
  still says failure, and so does one whose **cert chain did not verify** —
  that branch does not consult who the sender claims to be, because softening a
  trust failure to "sent from another device" is the reassuring way to hide the
  one case worth noticing. And it does not close the gap: the choice of the
  three real fixes stays open, and this was picked precisely because it
  forecloses none of them (syncing the stash needs the identity vault, which
  stays parked behind the pilot).
  Both strings are translated; the literal never was.
- **"Leave hub" stops lying, and asks first (2026-09-05)**: the control removed
  a hub on a mis-click with no question, and it had never left anything —
  `removeHub` is local, and there is no leave endpoint on the hub to call. The
  design work found that first, which moved the whole feature: a mis-click is
  cheap and reversible (the invite gate is `has_roles == 0` and every member
  has `builtin-everyone`, so re-adding just works), and what is expensive is
  invisible. A removed *home* hub is still named in the signed designation, so
  other people's hubs keep delivering DMs there while this device stops reading
  them — the invisible-DM failure the 2026-08-30 read-from-the-home-hub fix
  addressed, reached from the other side.
  So: **Remove from this device**, with a confirmation that says you stay a
  member, and — when it applies — what a removed home hub keeps doing. It links
  to Settings, where that list is edited, and never edits it itself: a paired
  device could not, and an automatic designation edit is the bug found earlier
  the same day. Removing the last home hub is allowed, with the warning naming
  what stops working; refusing would hold someone in a hub they asked to be rid
  of. A failed home-hub lookup leaves the dialog silent rather than guessing
  "not a home hub", which is the wrong way to be wrong here.
  The hub may attach an operator-written farewell (`farewell_label`, the
  `welcome_label` pattern, 280 chars counted as chars), rendered attributed and
  secondary — the app's words say what removing does, the hub's sit beside them
  marked as the hub's, because that moment is when a hub has the most incentive
  to mislead. Admin field wired on both clients rather than web only.
  A capability string was written for it and removed: clients read a nullable
  field here rather than branching on behaviour, which is why `welcome_label`
  has none either. Design and the calls: decisions.md, "Leave hub does not
  leave". What is still missing — an *actual* server-side leave — is now its
  own future-features entry rather than an assumption.
- **Joining a second hub no longer rewrites your home hub list (2026-09-05)**:
  `ensureHomeHubDesignation` publishes a list naming the one hub it was handed
  and ran on *every* join. A hub that has never seen the designation answers
  404 whether or not one exists elsewhere — and every hub joined after the
  first answers 404 — so hub B ended up holding a single-hub list naming
  itself while hub A held the real one, with sequence unable to break the tie
  at 1 apiece.
  Desktop's copy, written the same day, was worse: it went through
  `set_home_hub_list`, which signs with `cached sequence + 1`. Consumers take
  the highest sequence, so that list would have **won** everywhere — "I joined
  another hub" quietly resetting the user's home hubs to that hub. Found by
  re-reading the new code rather than by a test, which is the honest way to
  describe it: nothing in either suite was watching for it.
  Both clients now publish only on an identity's first hub. Desktop returns
  early when the device already holds a designation; web reads whether any
  other hub is saved, before the join adds this one.
- **Auth records the cert it verifies, so a device appears in its own device
  list (2026-09-05)**: two writes that should have been one. Auth wrote
  `users.master_pubkey` — the link every home-hub lookup needs — and nothing
  else, while the Devices screen lists `subkey_certs`. A device whose cert
  arrived at auth rather than through `POST /identity/{master}/devices` was
  therefore correctly linked to its master and absent from its owner's own
  device list, with nothing reporting the difference.
  Web had been registering separately and never met the case; desktop, which
  started self-certifying at auth the same day, has no such call. Fixed on the
  hub rather than by adding a POST to desktop, so the two writes cannot drift
  again and any future client gets it by presenting a cert. `post_device`'s
  upsert became `upsert_subkey_cert` and both paths now write the same row the
  same way; the auth-side call is best-effort, because a registry write must
  not fail a sign-in. Web keeps its POST — it issues the cert *after* the
  session authenticated without one, so that call is what makes the device
  visible before the next sign-in.
- **`useWhisper` and `useTypingIndicators` converged too (2026-09-05)**: two
  more pairs into `packages/ui`, and the second one is where converging stopped
  being plumbing.
  **Whisper** was the easy case — the state machine was already identical line
  for line, so only persistence and transport moved into deps. Two divergences
  had to be settled rather than papered over: web sends the receive opt-out to
  *every* connected session and desktop only to the active hub (both right,
  since the hub holds it per connection and desktop authenticates per hub, so
  the dep keeps each answer), and inbound pushes arrive through web's WS
  handler registry but a Tauri event on desktop, so `subscribeInbound` is
  optional and only desktop passes it. Taking the union fixed a desktop bug:
  leaving voice cleared only the inbound half there, so the whisper button
  stayed lit with nothing behind it.
  **Typing indicators** had actually diverged in behaviour. Desktop keyed
  entries by bare pubkey and filtered by channel where the event arrived, so
  whoever was typing when you left a channel appeared to be typing in the one
  you switched to, until the 5s sweep caught up; entries are keyed by scope now
  (`channelId:pubkey`, web's shape) and both apps filter at render through one
  `typingForScope` helper. Expiry went the other way and took desktop's single
  1s sweep over web's per-entry `setTimeout`, which scheduled a timer per
  keystroke-burst per person, each holding a closure over the map. Desktop's
  `chat-typing`/`dm-typing` handlers now pass the scope id they were already
  filtering on. App copies: 108/130 → 54/69 and 119/130 → 63/30.
  The three remaining pairs were surveyed and are **not** the same job —
  `useAlliances` is entangled with `useChannelMessages`, `useSettingsProfile`
  shares almost nothing, and the big three differ by platform transport rather
  than drift. Recorded in next-up.md so nobody re-derives it.
- **One `useUnreadCounts` for both clients (2026-09-05)**: the first converged
  hook pair, and the pattern for the rest. The two copies had drifted in *both*
  directions rather than one being behind — web owned `unreadDms` and seeding
  from the server, desktop owned persistence, the per-hub counts and the tray
  badge, and both set the identical document title from their own App.tsx — so
  neither client had all of it and converging was a union pass, not a port.
  The union lives in `packages/ui` with the platform half injected
  (`loadPersisted`, `persist`, `onTotalChange`), which keeps the hook itself
  network-free as that directory requires; the title moved in because it was
  the same string on both sides. Desktop's DM unread left `useDms` on the way:
  one owner is what lets the badge and the title see the whole picture.
  Two things fixed in passing. Desktop persisted from *inside* a state
  updater — twice under StrictMode, and during render; it is an effect now,
  guarded so restoring the saved map does not immediately save it back. And
  the map transitions became pure functions in `utils/`, tested there since
  `packages/ui` has no jsdom: what the tests pin is that each returns the same
  object when nothing changed, because that identity is what makes React skip
  the re-render *and* the persistence effect skip a disk write. A version that
  always rebuilt would look correct and save on every message into an
  already-unread channel.
  Line counts barely moved (web App.tsx 1,679 → 1,665, desktop 2,055 → 2,058)
  and that is the honest measure: the win is one implementation instead of two
  that disagreed.
- **Desktop certifies its own device too, closing the gap web closed the same
  day (2026-09-05)**: `apps/desktop` had no self-cert path at all — the
  registered Tauri commands were `device_list`, `device_revoke` and the eight
  `pairing::*`, none of which issues a cert for *this* device — so a
  desktop-only identity was invisible to every hub's home-hub lookup, and
  unlike web there was not even a Settings workaround.
  The cert now rides on `/auth/verify` rather than a registration POST,
  because the hub's auth upsert already writes `users.master_pubkey` from the
  cert it is handed: the whole link, inside a request the client was making
  anyway. Nothing persists it — re-derivable from the seed, upserted by
  (master, subkey), and `device_list` reads certs from the hub. It is built at
  `authenticate()` rather than at credential load because the cert carries the
  hub URL as its designation-of-last-resort and only the caller knows it.
  The designation follows on the join path, cert first. It no-ops on anything
  but a 404, so an existing list, one the user emptied on purpose, and a hub
  that answered 5xx are all left alone rather than overwritten on a guess.
- **The musl builds stop promising a bundled database they cannot start
  (2026-09-05)**: the release shipped two musl hub binaries whose advertised
  no-prerequisites path could not run — their PostgreSQL archive needs
  `libicuuc.so.74` and krb5, and no current Alpine has either. Of the three
  ways out, two were taken and the third (carrying ICU alongside the archive)
  rejected as fighting the upstream archive for a case an extra artifact
  solves outright.
  Bundled mode now **refuses up front** on musl — `BUNDLED_AVAILABLE` is a
  `cfg!(target_env)` constant, so the answer exists before anything is
  downloaded, unpacked or initialised, where before the operator got a wall of
  relocation errors *and* a half-built data directory to clean up. `--doctor`
  reports it as a FAIL with the same sentence, from one shared
  `unavailable_reason()` so the two cannot drift, which makes a pre-flight
  check catch what used to surface at first boot. And the release now also
  publishes `wavvon-hub-linux-x86_64-glibc`, so "let the hub run its own
  database" is an artifact an operator can actually download rather than a
  claim with no binary behind it.
  `embedded_pg_flow`'s five happy-path tests are gated to non-musl and joined
  by a musl-only test asserting the refusal touches neither `pg/` nor
  `pgdata/`. Not a skip: on the one target where bundled mode misbehaves the
  file now runs the assertion that is true there, instead of four failures.
  While in the docs: `hosting.md` had been calling the aarch64 binary a
  known-broken roadmap item since before it was fixed on 2026-07-01 and
  shipping since 2026-07-06.
- **Every device certifies itself at first auth, so a hub can tell which master
  a member is (2026-09-05)**: the remaining half of the DM fan-out gap, and it
  was a one-line trigger rather than the model. The roster→master link comes
  only from a device cert, and `issueSelfCert` was reachable only from the
  device *naming* flow in Settings → Devices — an action almost nobody performs,
  so almost no identity had a link on any hub, no hub could find its
  designation, and neither mirroring nor fan-out happened, silently. Certs are
  now issued on the same hub-connect path that already published the home hub
  designation, in that order: the link has to exist before the list it points
  at. Matrix registers a device at login and treats its name as cosmetic; ours
  now does too (decisions.md, "Devices stay subkeys").
  Two things had to move together. `!!subkey_cert` was standing in for "this is
  a paired device" in four places, and once every device holds a cert that proxy
  inverts — `ensureHomeHubDesignation` would have stopped publishing for
  *everyone*, which is a worse silent bug than the one being fixed. The real
  predicate is local and exact: a paired device's seed derives a different
  master than the cert it was handed names, so `holdsMasterSeed()` decides, and
  a test pins it because nothing else would have said so. On the hub there were
  two resolvers for the same question — the mirror path's `master_of` fell back
  to `subkey_certs`, the fan-out read only `users.master_pubkey` — so a member
  whose cert was registered without a re-auth was mirrored to but never fanned
  out to. Both call `master_of` now.
- **A DM now reaches every home hub, not just the one it landed on
  (2026-09-05)**: home-hub.md "DM delivery" step 2, the half that was never
  built. A sender's hub fans out to the recipient's whole list *when it has
  it*, and usually it does not — a designation lives on the recipient's home
  hubs, so the sender falls back to the single address recorded on the
  conversation. One hub then held the message and never forwarded it, and a
  client reading a different slot saw nothing: "any hub in the list is
  authoritative" held for reads and not for writes.
  The accepting hub now queues a copy for every other hub in the list, through
  the outbox that already carries backoff, bounce and restart survival —
  "as soon as they're reachable" means a peer that is down still has to
  converge. A `mirror` flag on the delivery stops a copy being copied: dedupe
  by `message_id` already makes a second arrival a no-op, but without the flag
  n hubs would exchange n² deliveries before the dedupe settled. `dm_outbox`
  remembers the flag, because the retry worker rebuilds the envelope from
  `dm_messages` and would otherwise rebuild a copy as an original.
  The test is three real hubs — A knows only B, B accepts, C is the slot the
  recipient is reading — and it fails with the forward disabled, which is the
  only way to know it is testing anything.
  It is bounded by what a hub knows: the list is stored under the *master*
  pubkey, and the roster→master link comes only from a device cert. An identity
  that never issued one has no list any hub can find — now the remaining known
  issue, and the reason a sender's hub does not fan out for those users either.
- **Alliance voice had never connected (2026-09-05)**: driving the 🔊 on a
  federated channel row for the first time — e2e-topology's `alliancebrowser`
  stage, `60-alliance-voice` — found two bugs in a row. The join was **thrown
  away**: `handleAllianceVoiceJoin` opens a socket to the allied hub and sends
  `voice_join` on it, `HubWebSocket.send` drops what it is handed while the
  socket is still CONNECTING, and a socket built microseconds earlier always
  is. It failed as "Voice join timed out" ten seconds later, on every hub,
  always — the app's own socket works only because it has been open since boot.
  `openAllianceVoiceVisit` now waits for the socket, and one that never opens
  fails there rather than as a timeout on a frame nobody received. Then, with
  the join landing, the voice bar read a bare `#`: the channel lives on the
  other hub so the local list cannot name it, and `voiceChannelNameHint`, which
  exists for exactly that, was only ever set for a voice *move*. It now comes
  off the grant — the same name the confirm prompt already showed.
  Both needed a browser: the HTTP-level topology stage proves the grant and the
  relay URL, and passes with a client that could use neither. With them fixed,
  the WebTransport session to the *allied* hub's relay comes up, which is the
  first proof of a client dialling a hub it never joined. One trap worth
  knowing for the next spec: Playwright dismisses dialogs by default, and this
  join asks through `window.confirm` because the visitor's IP reaches the other
  hub — so an unhandled prompt aborts the join silently and looks exactly like
  the bug.
- **The far side of an alliance, in a real client (2026-09-05)**: alliance
  coverage was one-sided — the client suite creates an alliance on the hub the
  browser is already on, and this harness proved the cross-hub read over HTTP.
  Neither had put a browser on hub B looking at a channel hosted by hub A,
  which is what an alliance is for. `e2e-topology`s `alliancebrowser` stage
  builds the alliance between two hubs the suite owns and hands
  `59-alliance-federated-read` the channel, the message and the host hub name;
  the spec asserts the sidebar group, the host label and that the message
  posted on the *other* hub renders. The stage renames the host hub first,
  because both boot as "my-hub" and the label assertion would otherwise pass on
  either. 19 scenarios green. Learned writing it: a centre click on that row
  lands on the "join voice on the other hub" button, which stops propagation
  and selects nothing.
- **The bundled PostgreSQL does not run on musl, and now says so
  (2026-09-05)**: `embedded_pg_flow` had only ever run on Windows and on CI's
  ubuntu-22.04. Run on Alpine 3.24 with a musl-native build — `rust:1-alpine`,
  so the test *executes* rather than cross-compiles — it is 1 passed / 4
  failed, every failure a wall of `Error loading shared library
  libicuuc.so.74` and `symbol not found` relocations out of `initdb`.
  The cause is not `initdb`'s locale support, which is what this item had
  guessed. The archive is chosen by build target, and the musl one is the odd
  one out: `readelf -d` on its `initdb` declares libpq, **libicuuc.so.74**
  and libc.musl, while the glibc build declares only libpq, libm and libc —
  ICU is static there, which is why CI has been green on a distro shipping
  ICU 70. No current Alpine can satisfy that soname (3.24 ships ICU 78, so
  `apk add icu-libs` does not help) and its `libpq.so.5` additionally wants
  `libgssapi_krb5.so.2`. So "download a binary and run it, no prerequisites"
  holds on Windows and on glibc — including the `ghcr.io/wavvon/hub` image,
  which is `debian:trixie-slim` — and fails on exactly the static musl
  binaries the release builds for "runs anywhere". The hub now turns that into
  a sentence naming ICU and `WAVVON_DATABASE_URL` instead of relocation output
  from a program the operator never ran, with the non-loader errors passing
  through untouched; the operator guide says which builds bundled mode works
  on. What to *do* about the release stays open (next-up).
  **Sizes, while measuring:** the compiled-in archive is 12,184,736 B for
  glibc, 26,108,430 B for musl x86_64 and 54,068,902 B on Windows — the
  Windows one is the outlier because it is the only one bundling its own DLLs.
  Against v0.5.0, the last release before the bundle
  (`wavvon-hub-linux-x86_64` 51,746,776 B, aarch64 32,579,144 B), that puts
  the next musl binary near 78 MB and the image about 12 MB heavier.
- **Three bugs between a browser and a farm-hosted hub (2026-09-05)**: the
  `farmbrowser` stage in `e2e-topology` points the live suite at a hub behind a
  farm's `/hub/<pubkey>` proxy — the shape every farm customer's hub is reached
  on, and one no suite had ever driven. It boots its own farm, because the farm
  makes whoever created a hub its owner and `creation_policy` is
  `admin_only`: the only route to a farm-hosted hub the suite owns is a farm
  whose admin *is* the suite's identity, so the harness derives that identity
  from the seed the suite states and signs as it. The first run found three
  things, each invisible to every in-process suite for the same reason —
  `fetch` from Node and `axum_test` send no Origin and follow no link.
  **The farm had no CORS layer at all.** A farm-hosted hub's `/info` carries
  `farm_url`, and the hub's own source says clients route `/auth/*` there when
  it is set. So the preflight for `POST /auth/challenge` came back with no
  `Access-Control-Allow-Origin` and the browser refused to send it: **no web
  client not served by the farm's own origin could join a farm-hosted hub**, and
  the symptom was the welcome screen quietly reappearing with "Could not reach".
  The layer covers the farm's own routes only — the proxied hub answers with its
  own CORS headers, and a second set is a duplicate a browser rejects outright.
  **A `wavvon://` permalink dropped the hub's path.** The client could not read
  the links it writes: "Copy channel link" on a path-hosted hub produces
  `wavvon://host/hub/<pubkey>/channel/<id>`, and `parseHubInput`'s
  `wavvon://` branch took everything up to the first slash as the host and the
  rest as the invite code — so pasting it back reached the *farm root* with
  `hub/<pubkey>/channel/<id>` sitting in the code. The http(s) branch had been
  fixed for exactly this shape; the deep-link branch never was.
  `02-nested-channels` compared the permalink against the hub's *host* alone,
  which is why it had never noticed: on a hub that owns its origin the two
  strings are identical.
  **A paired device landed on every farm-hosted hub as a stranger.** Resolving a
  subkey to the identity it speaks for is the hub's job — off the presented cert
  or off the device the pairing flow registered with that hub — and the farm has
  neither, so it minted a token whose subject was the device's own subkey and
  the hub, which trusts a farm token's subject completely, seated a brand-new
  user. The join succeeded; nothing logged anything. A paired device now
  authenticates at its hub and gives up farm SSO to stay the same user
  everywhere (decisions.md, "A paired device authenticates at the hub, never at
  the farm"); separately the farm now resolves a cert a client *does* present,
  filling in the `master` field its token payload always declared and the
  `farm_users.master_pubkey` column that always existed — the code had it as
  "no cert resolution in Phase 1".
  The whole live suite now runs through the farm proxy: 86 passed, 1 skipped in 12.1 minutes — the skip is 54-ttt-game, which needs its bot process.
- **The browser accepts the hub's self-signed voice cert (2026-09-04)**: the
  live job set no `WAVVON_PUBLIC_URL`, so the hub advertised no
  `voice_wt_url` and no voice spec ever opened a transport. Setting it changes
  none of the results — 86 passed / 1 skipped with it, the same without — and
  that is the finding: every voice spec asserts on roster state the hub pushes
  over the WebSocket, so all of them pass identically whether the transport
  connected, failed, or was never attempted. Which means the question that had
  been filed as "untested" — does Chromium accept the hub's self-signed
  WebTransport cert through `serverCertificateHashes` — was not one this suite
  could answer at all. It can now, and the answer is yes:
  `58-voice-wt-handshake` opens a transport with a token the hub cannot have
  minted and asserts the failure is the hub's own session rejection
  (`ERR_METHOD_NOT_SUPPORTED`, from `session_request.forbidden()`) with
  nothing certificate-shaped in it, then repeats with a wrong hash and asserts
  `QUIC_TLS_CERTIFICATE_UNKNOWN`. The negative control is what makes the first
  half a measurement rather than an absence of evidence. It proves the
  handshake, not audio.
- **The live browser job runs all 86 specs (2026-09-04)**: `54-ttt-game` —
  the one spec that covers the bot mini-app relay end to end, launch card
  through both players' game modals to a finished board — skipped itself
  whenever `TTT_BOT_PUBKEY` was unset, and did it silently, so the job had
  been reporting green having run 85 of 86. `e2e-live.yml` now builds
  `ttt-bot` with the hub, starts it, and reads the pubkey off the bot's own
  first line of output. Nothing needed pre-seeding: the bot's authenticate loop
  already waits for the invite, and the spec performs the invite and the
  capability grant itself. Rehearsed locally against a fresh hub and a fresh
  bot identity before landing.
- **A browser inside the topology harness (2026-09-04)**: `e2e-topology` has
  a `browser` stage. It boots a hub owned by the live suite's deterministic
  identity — read out of `e2e/live/helpers/live.ts` rather than copied, so a
  changed seed cannot leave the stage booting a hub the suite does not own —
  and runs the live Playwright project against it, `11-channel-crud` by
  default, `E2E_BROWSER_SPECS` for others. 17 scenarios green. It deliberately
  does not repeat all 86 live specs, which `e2e-live.yml` already runs against
  a hub of its own: what this proves is that a hub *this harness* booted is one
  the web client can drive, which is the prerequisite for pointing the suite at
  the far side of an alliance or at a farm's `/hub/<slug>`. A spec filter that
  matches nothing fails the stage rather than passing empty.
- **The desktop commands that spoke to routes the hub never had (2026-09-04)**:
  `create_bot` was the reported symptom — it posted `{ name }` to `POST /bots`,
  which is `ext_invite_bot` and wants `{ pubkey, note? }`, because the hub has
  no bot-creation concept at all. Reading the rest of the file found the same
  rot around it: `rotate_bot_token` addressed `/bots/:pk/rotate-token`, a route
  that exists nowhere; `list_bots` deserialized `GET /bots` into a
  `public_key`/`display_name`/`token` shape the route has never returned, so it
  could not parse; and it had reached live code too — `useSlashCommands`
  invoked `admin_list_bots` and `admin_get_bot_detail`, neither a registered
  command, inside a catch that swallowed the failure, so desktop slash-command
  autocomplete has always been empty; `get_bot_profile` asked
  `GET /bots/:pubkey`, registered for DELETE only; and the external-bot admin
  panel added and removed bots on `POST`/`DELETE /admin/bots/external`, of which
  only the GET exists. The four dead commands, `HubBotsSection` and the
  `NativeBot`/`BotAdminInfo`/`BotDetailInfo`/`BotCreatedResult` type family that
  described the minted-bot model are gone; one correct `list_bots` on
  `GET /bots` now feeds both the profile card and the slash commands, the way
  the web client does, and the two admin calls point at the routes that answer.
- **A sweep for the rest of the plumbing no screen reaches (2026-09-04)**: the
  bot commands rotted because nothing exercised them, so the same question was
  asked of everything else. Desktop: **26** Tauri commands registered in
  `invoke_handler` and invoked by no frontend, some superseded by a hub-scoped
  twin (`rsvp_event` by `rsvp_event_hub`), plus the account-path helpers they
  orphaned. Web: `sendComponentInteraction` (ContentArea sends the same WS
  frame inline), `getAlliance`, `fetchMyCert`, `getHubInfo`, `searchUsers`,
  `renameSavedHub`, `generateIdentity`, and the four per-slot event commands —
  EventComposer posts its slots with the event itself. `packages/ui`: two
  unused icons, the slot rsvp payload builders, `isTemporaryChannel`,
  `normalizeSpawnerNameTemplate`; `packages/core`: `newProfileId`.
  `apps/web/src/platform/webrtc.ts`, 166 lines, imported by nothing. And
  `packages/platform` — a types-only package no file has ever imported, not
  even as a devDependency, while both apps carry their own copy of the
  interfaces it declared. ~1,050 lines out, every suite green. The server
  workspace came back clean (rustc sees its own dead code) and its 241 routes
  are all still registered and documented; the directory site had one dead
  component and one validator with no caller, which turned out to be a missing
  check rather than dead code — `POST /api/bots` accepted any capability
  string while the detail page renders a closed set.
- **Joining from an invite link stopped asking for 24 words at the door
  (2026-09-03)**: a friend following an invite met four screens before a first
  message, one of them the recovery phrase behind a button reading "I saved my
  phrase" that verified nothing. The invite path now creates the identity and
  goes to the profile step; the welcome screen, which names the hub and who
  hosts it, does the joining. Until the key has left the browser the settings
  gear carries a marker, the backup section says the identity exists only
  there, and the first message raises the ask once — "Not now" leaves the
  marker. Revealing the phrase or exporting a `.wavvon-backup` clears it, and
  every other entry path (create, recover, pair) is recorded as already having
  handed the key over. The invite screen names the hub too, which only the hub
  build can do — its own origin answers `/info`. Rationale and the rejected
  alternatives in decisions.md, "An invite link does not stop at the recovery
  phrase"; driven end to end against a hub serving `dist-hub`, since the live
  suite runs the user build on a different origin and cannot reach `/join/`.
- **The live browser suite is green on a runner (2026-09-03)**: 85 passed, 1
  skipped, 0 failed, **0 flaky, in 7.6 minutes** — against 8 failed, 65 flaky,
  12 passed in 1h49m two days earlier, on the same specs. Two causes, and
  neither was a spec being wrong about the product.
  **The workflow served the Vite dev server.** Every page load pulled 370-odd
  separate module requests, and the first interaction with anything not yet
  transformed waited on Vite compiling it — invisible on a fast laptop, seconds
  per menu or modal on a two-core runner. That is what the failures were:
  clicks on `.hub-header-button` → "Create…" where the dropdown had not
  rendered yet, passing on retry once the transform cache was warm. `webServer`
  now runs `npm run build && npm run preview` under `CI`; one bundle, warm from
  the first attempt, and the suite costs the runner what it costs a laptop.
  **The app reloads itself once per page load.** The prefs pull brings back
  settings that are only read at boot, so App.tsx reloads once per load
  (`PREFS_RELOAD_FLAG`) — a few round trips after the hub header renders, which
  on a laptop is before the first click and on a runner is in the middle of
  one. A dropdown opened a moment earlier closed under the test, and in-flight
  `page.evaluate` calls died as "Execution context was destroyed" or had their
  fetch aborted as "Failed to fetch" — both had been logged as unexplained and
  are the same reload. `expectInHub` and `onboardWithSeed` now claim the flag
  before driving anything, and `hubApi` retries once past a navigation.
  Two specs also pinned affordances the UI had outgrown, failing identically on
  a fresh hub locally: `27-home-hubs` clicked an "Add this hub" button that no
  longer renders (signing in publishes the hub automatically), and
  `02-nested-channels` clicked a "Join a hub" menu entry that went with the
  create-hub wizard. And the reporting was blind by configuration:
  `trace: "on-first-retry"` recorded the *retry*, so a spec that failed once
  and passed on retry handed back a trace of the run that passed — 264MB of
  artifact with nothing in it about any failure. It is `retain-on-failure` now,
  which is how the socket race behind the vanished message was found at all.
- **A sent message no longer waits on the socket to appear (2026-09-03)**: the
  composer put nothing on screen itself — it sent, cleared the input, and
  waited for the hub to echo the message back over the WebSocket. A send the
  hub accepted while that socket was down or still reconnecting was stored
  (201 Created) and then simply absent from its own author's view until the
  next channel load. `sendMessage` now resolves to the message the hub returns
  and `handleSend` appends it, reusing the id dedupe the socket handler already
  applies so the echo is a no-op when it lands; the slash-command 200 still
  resolves to null, since that reply is inserted server-side. A rejected send
  stopped emptying the composer too — there is no toast at that layer, so the
  text goes back in the input rather than vanishing without a word. Found by
  `55-pinned-messages`, whose trace had the POST at 201 and the WebSocket
  taking 8 seconds to come up: the kind of failure only a real browser against
  a real hub produces, and the reason the trace of a *failing* attempt is now
  what CI keeps.
- **The web UI speaks four languages (2026-09-01)**: 1,011 hardcoded English
  strings down to 223, and every one of the remaining is in `apps/desktop` —
  the shared package and the web app have nothing translatable left. Eleven
  batches over one day, and the shape repeated enough to be worth recording:
  **six module-level label maps** carried English as data (role permissions,
  channel icons, keyboard shortcuts, skin bases, themes, RSVP answers) and are
  now id lists with `t(`prefix.${id}`)` at render, guarded by a test since no
  scan can see a key built from a variable; **prose spliced around values**
  ("Delete <strong>{name}</strong>?", "Attestations: 2 / 3 · Status: pending",
  `${kind === "kick" ? "Kick" : "Ban"} ${name}?`) became single keys with
  arguments; and **a file with a translator was not a translated file** —
  `ReactionBar`, `AttachmentList`, `ForumReplyRow`, `ForumPostRow` and others
  rendered English from inside files whose main component had `t` all along.
  Two real bugs fell out of it: `bot.card.play` and `user.ctx.history_header`
  used i18next's `{{name}}` under i18next-icu and printed their own braces in
  all four languages, and reusing an unread catalog key silently changed two
  labels the live suite drives by name. `check-i18n` now parses every message
  as ICU and compares placeholder names, and the hardcoded scan stopped
  counting CSS values, request paths and torn JSX — 128 of the "473 remaining"
  were never strings. Also deleted rather than translated: `ChannelIconPicker`
  (imported by nothing), two stale `ALL_PERMISSIONS` copies, and eight catalog
  keys describing an alliances screen this codebase does not have.

- **The first live-e2e run on a runner, and the overlay it found (2026-09-01)**:
  the workflow had been authored and never executed. It hit the 90-minute cap
  with nearly every spec timing out on `.hub-header-button` → "Create…", while
  the hub log showed a healthy hub that only ever authenticated the owner. A hub
  with no channels offers its admin the first-boot wizard, and
  `dismissHubSetupWizard` sampled `isVisible()` **once** — but the gate behind
  that dialog cannot decide until the channel list arrives, so on a loaded
  machine it lands a beat after the header `expectInHub` waits for. The miss
  meant the "don't nag again" flag never reached the saved storageState, every
  spec then met a modal overlay that swallows clicks, and since nothing could
  create a channel the hub stayed at zero and the dialog kept coming back. It
  waits up to 10s now, for the owner only — the sole admin, and the only identity
  that can be offered it. Worth keeping as a shape: a helper that samples state
  once is a helper that works only on the machine it was written on.

- **Three server tests that only a runner could fail (2026-09-01)**: each fixed
  where it was actually wrong. `node_tls_flow` — all four panicked before the
  handshake on "Could not automatically determine the process-level
  CryptoProvider", because the binary links both rustls backends (the farm asks
  for ring, `tokio-tungstenite`'s `rustls-tls-webpki-roots` pulls in aws-lc-rs)
  and `node::client_config` had only ever named one for the client side.
  `db_move_flow` — "pg_dump not found" on two of three, and not a missing
  install: each bundled instance extracts its client tools into its own scratch
  directory and the test deletes that directory when it ends, while
  `WAVVON_PG_BIN_DIR` is process-wide, so on four threads one test can be
  pointed at another's tools and at a deleted path once that test finishes. A
  static async mutex keeps one instance alive at a time, guard returned first so
  it outlives both the server and its directory. `e2e_server_agent` — 409
  Conflict, because the helper sent `hub_spawned` and then slept a fixed 50ms
  before calling a route that refuses a hub whose `process_port` is NULL; it
  polls for the port now. One shape, three times: a fixed sleep or a
  process-wide hint is a guess about scheduling that only holds on the machine
  it was written on.

- **Whisper, the shortcut sheet, the channel icon names, channel settings and the
  server tags page speak four languages (2026-09-01)**: 120 more literals in two
  batches. The keyboard cheat-sheet and the channel icon registry were the
  permission list's shape again — English in a module-level array — so both are
  ids now (`shortcuts.action.<id>`, `channel.icon.<id>`) and the one test that
  guards template-built keys covers three families. `WhisperPanel` had three
  callbacks using `t` for a whisper target or a tab id, which is the shadow the
  clients CLAUDE.md warns about; `ServerTagsSection` had no translator at all;
  the channel delete confirmation was prose broken around
  `<strong>{name}</strong>` and is one key with an argument now (the name loses
  its bold). `ChannelIconPicker` was deleted rather than translated — nothing
  imported it and the settings modal renders the same grid inline. Text the live
  suite drives by name was kept byte for byte, which is the lesson from the batch
  before: reusing an unread catalog key means adopting its copy too, and doing
  that silently changed "New category name" to "Category name" until
  `04-role-categories` said so. 758 left.

- **Roles and alliances speak four languages (2026-09-01)**: 63 of the 1,011
  hardcoded strings, taken as one screen — `RolesSection`,
  `AlliancesSection` and `RoleCategoryManager`. The permission labels stopped
  being data carried in the component: `ALL_PERMISSIONS` is a list of ids and
  each label is `hub.admin.roles.perm.<id>`, which no scan can verify, hence the
  one test asserting every id has a label in all four catalogs. Two dead
  `ALL_PERMISSIONS` copies in `apps/*/src/constants.ts` were imported by
  nothing and desktop's had drifted two permissions behind — deleted rather than
  translated three times. The catalogs already held `hub.admin.roles.*` and
  `alliances.*` keys **nobody read**, written for a UI that never shipped and
  several still English in es/de: the names that fit were reused, eight
  describing a tabbed master/detail alliances screen were dropped, and the live
  component text won where the two disagreed. 948 left.

- **The node TLS test could not run on a runner (2026-09-01)**: all four
  `node_tls_flow` tests panicked before the handshake — "Could not
  automatically determine the process-level CryptoProvider from Rustls crate
  features". The binary links both backends (the farm asks rustls for ring,
  `tokio-tungstenite`'s `rustls-tls-webpki-roots` pulls in aws-lc-rs) and
  rustls refuses to guess. `node::client_config` had always named one for the
  client side; the test's server side was on `ServerConfig::builder()`, which
  reads the process default. A first CI execution finding it is the shape worth
  noting: the code had been green locally since 2026-08-29.

- **The modals left App.tsx (2026-08-31)**: 213 lines of
  `{showX && <XModal/>}` sat between the layout and the closing tag, which is
  how the file kept growing while the refactor meant to shrink it stalled —
  1,773 lines, up 117 since the previous count. They are one component now
  (`components/layout/AppModals.tsx`); App.tsx is 1,642. A move, not a rewrite:
  the props are named after the values they carry so the JSX is unchanged, and
  their types are borrowed from the hooks that own each value, so a change
  there surfaces as a type error rather than as a modal that quietly stops
  opening. Which is exactly the failure mode types alone miss, so it was also
  driven in a browser against a real hub — identity, join, main UI, zero page
  errors, with AddHubModal, the setup wizard (its `createChannelForWizard`
  really creating the channels), the display-name prompt and hub admin all
  confirmed on screen. The channel settings modal, quick invite, the composers
  and the context menus were not reached by that driver and were not seen.

- **DMs are read from the home hub (2026-08-30)**: a sender's hub walks the
  recipient's designation, so an inbound DM lands on a *home* hub — and the
  client was reading `/conversations` from whichever hub was on screen. Someone
  who signed in to one hub, drifted to another community and stayed there never
  saw those messages: delivered, stored, invisible until they happened to switch
  back. `dmSession()` resolves the designation once per account and takes the
  first hub in the list this client can reach (list order is the user's
  preference, not a correctness requirement), skipping a lobby-scoped session
  because that 403s `/conversations` and would turn a working inbox into an
  error. No designation, or none of its hubs open here, falls back to the active
  hub — what every DM did before, so a single-hub user notices nothing. The
  membership-change WS arm went through it too: it refetched from the active hub
  while the list came from elsewhere. Publishing our own DH key deliberately
  stays on the active hub, since a sender looks that key up on *their* hub.

- **The upgrade path covers a PostgreSQL major (2026-08-30)**: the last open
  dimension of the upgrade work, unblocked by bundling and closed the same day.
  The bundled server follows upstream rather than being pinned, so a hub
  release can carry a newer major than the one that wrote the data directory —
  and PostgreSQL refuses to read an older directory by design. The hub refuses
  too, at startup, before touching anything, and prints the two commands;
  hub-operator-guide.md now walks them (`backup` with the previous binary,
  `restore` with the new one after moving `pgdata` aside) and says to keep the
  old directory, since the previous major's binaries are still there and are
  the only thing that can read it. The `pg_dump` prerequisite stops being
  universal in the same edit: a hub on its built-in server carries its own
  copies. What remains coupled to the capability work — that upgrading a hub
  also swaps the web client it serves — lives with that work, not here.

- **`db move --to` / `--from` (2026-08-30)**: the last user of the one
  dump/restore path (decisions.md, "One mechanism moves the data"), and the
  reason it waited for bundling — with no embedded side it was `backup` then
  `restore` against another URL, which both commands already did. Now that a
  hub can carry its own server, "adopt my own PostgreSQL" and "give it up
  again" are real operations, and neither needs a `pg_dump` incantation the
  operator cannot run. It **copies and stops**: nothing switches mode, the
  source is left intact, and a destination that disappoints is undone by
  setting one variable back. Direction is checked before a byte is written and
  now cuts against intuition — a dump restores into an equal or newer major and
  the embedded side is usually the newer one, so "move to my own PostgreSQL" is
  the direction most likely to be refused. The mechanism sits in `db::dump`
  rather than `main.rs` so it can be tested, and the tests run against the
  **bundled** server on both ends: nothing to install, same version for tools
  and server, and no way for the file to skip itself. Found while writing them:
  the bundled installation directory has two shapes depending on whether this
  is the first run, so `pg_dump` came out "not found" on a machine that was
  carrying it.

- **The hub carries its own PostgreSQL (2026-08-30)**: `WAVVON_DATABASE_URL`
  unset now means "start and supervise your own server" rather than "guess
  localhost with the default superuser" — download a binary, run it, you have a
  hub, with no network and no package manager on first start because the
  archive is compiled in. A URL still means plain client: migrations and
  nothing else, because a database the operator built is theirs
  (decisions.md). The layout follows from the one fact that matters — SQL does
  not change between majors, the on-disk data directory does, and reading an
  old one needs that major's own binaries — so installs are version-scoped,
  the previous one is kept, and a major mismatch **refuses with the
  dump/restore commands** instead of starting. A downgraded binary refuses too
  and says so. Port and password are written down on first run (initdb sets
  that password once; regenerating it strands the directory), a server left
  behind by a killed hub is adopted rather than restarted, and starting points
  `WAVVON_PG_BIN_DIR` at the bundled `bin` — otherwise backup would fail on
  exactly the install story that has no PostgreSQL on PATH. `doctor` reports
  which mode is in use and where the data lives. Proven by execution: the
  archive installs, the real migrations apply, a restart keeps data and
  credentials, a crashed hub's server is adopted, an old data directory is
  refused untouched, and backup/restore round-trips through the bundled
  `pg_dump`. Not yet proven on musl, which is a release target — see next-up.

- **User-configurable trust roots (2026-08-30)**: a badge from an issuer the
  viewer has no relationship with was a signature by a stranger, and there was
  nothing they could do about it. A trust root — `{pubkey, label}` — is the
  knob (server-tags.md Part 4). It rides in the synced prefs blob rather than
  `localStorage`, because whom you believe is a choice about yourself: it
  follows the identity across devices and survives a backup restore, for one
  line in `SYNCED_KEYS` and no hub change at all. **Rendering only**, and the
  UI says so — a root never satisfies a hub's `cert_mode` gate, which is the
  admin's `cert_trusted_issuers`; the two lists have the same shape and
  opposite authority. Not transitive, and no shipped defaults: the set starts
  empty because there is no such authority. Reviewed and removed in Settings →
  Privacy, added from the badge itself, which is the only place anyone will
  actually do it. A pasted key that is not 64 hex characters is refused with a
  reason rather than stored to silently match nothing.

- **The agent half of the multi-node data plane, and a shared database nobody
  had noticed (2026-08-30)**: the agent advertises `host`, `tls_mode` and
  `cert_sha256` in its WS `hello` and the farm records them on **every**
  connect, so a node that moves or rotates a certificate corrects the farm by
  reconnecting rather than by an operator remembering to — and a `hello` with
  no host *clears* the column, because a stale address sends the proxy where
  nothing answers. The spawn command now carries the hub's database **name**
  and the server's template, and a node holding `WAVVON_NODE_DB_TEMPLATE`
  creates the database on its own PostgreSQL, so its credentials never reach
  the farm.
  Found on the way, and the reason this was urgent: **the agent ignored the
  `db_url` the farm sent.** It logged a warning and spawned the hub with no
  database configuration at all, so every agent-hosted hub used the hub's
  default URL and they all shared one database — the exact bug per-hub
  provisioning had closed on the farm's own spawn path, still live on the
  agent's, with a warning nobody was reading. A hub with nowhere of its own is
  refused now. Tested where it can only be wrong at runtime: the template
  really provisions a database and the URL handed to the hub really connects,
  twice in a row for a restart.

- **The farm proxy reaches other machines (2026-08-29)**: the control plane had
  been multi-node for a while — the agent reverse-connects, the farm spawns hubs
  on remote nodes — while the data plane was not, because `proxy.rs` dialed
  `127.0.0.1` for every hub. So a hub the farm had itself placed on another
  machine was unreachable through the farm's own domain. `servers` now carries
  `host`, `tls_mode`, `cert_sha256` and `db_url_template` (all nullable or
  defaulted — a row with no host is a hub on this machine, which is every row
  that exists today), resolution carries the node with the port, and **both**
  dial paths use it: the buffered reqwest one and the raw socket bridge. The
  bridge is the half that gets forgotten, and forgetting it is invisible — every
  REST call works and only the WebSocket fails, which is the connection a chat
  client spends its whole session on. Another machine is always TLS: `ca` for a
  node with a real certificate, `pin` for one that advertises its self-signed
  certificate's SHA-256, the primitive voice already uses. Pinning with no digest
  recorded is an error, not a quiet fall back to CA validation. Tested over real
  handshakes, on the refusals: a mismatched certificate is refused, one node's
  pin does not admit another, and `ca` still rejects a self-signed node. The
  agent half — advertising its host, `db_url_template` at spawn, the monitor —
  is still open (next-up).

- **A PostgreSQL role per hub (2026-08-29)**: farm-spawned hubs could already
  get a database or a schema of their own, and both stop hubs *colliding*
  rather than stopping one hub reading another — every hub connected as the
  farm's own role, as `farm/src/db/provision.rs` said in its own header.
  `hub_db_role = 'per_hub'` now gives each hub a login role with a generated
  password, granted its own database (and `CONNECT` revoked from `PUBLIC`, or
  the grant is decoration) or its own schema, and nothing else. Default stays
  `shared`: it needs `CREATEROLE`, which the managed plans schema isolation
  exists for do not grant, and provisioning failure refuses the hub rather than
  falling back to the farm's role — falling back would silently hand out the
  access the setting was turned on to remove. Tested where it matters: hub A's
  role is **refused** by hub B's database, and a schema-isolated hub is refused
  when it names its sibling's schema explicitly; plus a real hub, spawned
  through the farm, booting and migrating under the narrower grants, because a
  hub that cannot run its own migrations is not isolated, it is broken. This
  was the prerequisite the farm multi-node data plane was sequenced after.

- **Certification relay across the hubs of one farm (2026-08-29)**: the
  admission gate now **pulls** a candidate's portfolio from the issuers it
  trusts (`GET {issuer_url}/identity/{pk}/certs`, at most 8 issuers, 2 s each,
  concurrent, cached 10 minutes) and re-runs the same predicate over what comes
  back — hub-certifications.md §11. Until this, `cert_mode != none` refused
  *everyone* with `cert_required`, because nothing on earth sends the
  `certifications` array `/auth/verify` accepts: the feature was a lockout, not
  a relay. A pulled cert is verified exactly like a presented one, so answering
  the fetch with someone else's cert buys an issuer nothing. Addresses live in a
  new `cert_issuer_urls` setting, filled by farm siblings from the `hub_url` the
  heartbeat already carried and editable per row in the admin screen, which had
  no way to enter one. Two things fixed on the way: the auth gate had its own
  copy of the admission predicate beside the one in `certs.rs` (now one), and
  **the cert settings screen had never been able to save at all** — it PATCHes
  booleans and numbers, the route demanded strings, and 422'd the whole request,
  which is why nobody had ever hit the lockout.

- **Voice in alliance channels, end to end (2026-08-29)**: the hub side shipped
  in August with no client able to use it. The web client now mints a grant on
  its own hub, redeems it at the owning hub for a voice-only session, and from
  `voice_join` onward runs the ordinary flow against that hub's socket — a
  visitor is an ordinary pubkey in the owner's maps, so the relay, the
  sender-id space and the datagram format are untouched
  ([alliances.md](alliances.md)). The structural change is that voice is no
  longer implicitly "on the active hub": the socket owning the room is a
  parameter, threaded through join, leave, watch, key offers and speaking, and
  the old room always goes down before the new one comes up — the hub enforces
  one session per identity *per hub*, so it would happily leave a mic live in
  two places. Two hub gaps closed with it: `voice_remote_join` shipped as a
  column nothing could write, so an owner could only close a room by unsharing
  it (the share route carries the policy now, and the list reports it); and a
  visitor, having no `users` row by design, rendered as a bare public key —
  `voice_identity` resolves them from the visitor table joined to the hub that
  vouched for them, and the new `visiting_from` renders as "name · HubName",
  muted rather than badged, because the name is asserted and not proven. The
  affordance is gated on our own hub's `voice.alliance`; the owner's half is
  checked at redemption rather than by asking every allied hub for `/info` on
  every load. The join confirmation names the address being dialed, because the
  visitor's IP reaches it.

- **The directory rebuilt, and four things deleted from the network (2026-08-28)**:
  a long pass that simplified more than it added. Discovery had never had a
  design — `globals.css` was still the create-next-app default, the accent was
  indigo while every client theme and `brand.md` say violet, and the hub list
  lived at `/`. It now runs on the client design system's tokens (theme
  `linear`), with a landing page, `/hubs`, `/clients`, `/bots`, `/providers`
  and `/docs`. Clients got a real directory — a `clients` table, author-signed
  `.wavvonclient` listings, a support table and a maintainer on every page —
  replacing three hardcoded cards whose download links pointed at
  `Wavvon-desktop`, `Wavvon-web` and `Wavvon-android`, three repositories that
  do not exist. `/docs` renders the wiki's own markdown, fetched at build from
  an allowlist of slugs so `/docs/<anything>` cannot reach an arbitrary file.
  Filters distinguish closed sets from open ones: platforms and features are
  enumerated in code and render as checkboxes, while tags and languages are
  whatever publishers declare and render as a searchable facet — a fixed list of
  languages would have capped the network at the four our own clients ship.
  Every rail control is a link toggling a search param, so the rails stay server
  components and a filtered view is a URL you can send.

  Deleted in the same pass, each for its own reason: **hub creation** from every
  client, along with the wizard, the bootstrap-token handshake and the config
  template catalogue — a hub exists because somebody ran the binary on their own
  server; **the farm concept** from web, desktop and the Tauri shell, 103
  translation keys per locale included, because a farm is a server-side
  aggregate; **uptime probing**, because the per-card 7-day aggregate cost more
  than the answer was worth; and **the `seed` crate**, a cross-farm registry
  nothing had ever read. `/farm/public-info` and `allow_discovery_listing` went
  with it once they gated nothing.

  Two things were found rather than planned. Every detail page 404'd because a
  raw colon in `ed25519:<hex>` never reaches a page component — URLs carry the
  bare hex now, and `getHub`/`getBot` accept either spelling. And the bots API
  turned out to be the one listing type nobody had to prove they owned: an
  unauthenticated `DELETE` removed anybody's listing. Bots sign now, like
  everything else.

  Reasoning in [decisions.md](decisions.md) — three entries. Superseded designs
  marked, not deleted: [hub-creation-wizard.md](hub-creation-wizard.md), and
  sections D and E of [farm-impl.md](farm-impl.md), and three of the five
  features in [discovery-v2.md](discovery-v2.md).

- **A home hub without being asked, a hub list that survives a browser wipe, and
  a Help & FAQ tab (2026-08-25)**: three small changes that together close "I
  cleared my browser and lost everything". The web client now publishes a
  `HomeHubList` naming the first hub an account signs in to, if that account has
  no designation yet — personal-axis state had nowhere durable to live while the
  list was something you had to find in Settings. `wavvon:saved_hubs` joined the
  synced-settings map, so the hub list travels in the encrypted prefs blob with
  theme and language: the phrase restores the key, the key opens the blob, the
  blob names the hubs. And Settings gained a **Help & FAQ** tab (shared
  `HelpTab`, so desktop gets it too) answering the questions people actually ask
  once identity is a keypair in a browser — where the key lives, what a wipe
  costs, why coming back to the same page matters, what to do when an invite link
  lands you somewhere with no account — plus an alpha disclaimer, in all four
  locales.
  The rejected option is the interesting half: carrying the hub list in
  `.wavvon-backup` was the first answer and would have been a wire-format change
  in two repos, against a fixed test vector, for data that is neither identity
  nor secret. See decisions.md (2026-08-25) for that and for why no web page can
  share storage across hub origins at all.

- **Two farms, an alliance across the farm boundary, and the seed registry
  (2026-08-23)**: the topology harness reaches 17 scenarios. Two farms each host
  a hub, and a hub on farm A allies with a hub on farm B — every request in that
  scenario crossing two reverse proxies, which is the part no in-process test can
  stand in for. The seed gets its first end-to-end coverage at all: a farm opts
  in to listing, registers, and is listed; a caller claiming someone else's
  pubkey for a real farm URL is refused, because the seed calls the farm back at
  `/farm/public-info` and compares rather than trusting the request; an
  unreachable farm is refused too.
  Three things learned by driving it, each of which had to be built into the
  scenario rather than assumed. A farm seeds the **creating user** as its
  spawned hub's owner, so a fresh identity meets the hub's `invite_only` default
  instead. `allow_discovery_listing` is **off** by default and the seed answers
  `farm_not_accepting_listing` — being in a public registry is a decision, not a
  default, so the operator opts in through the admin API. And `hub_url` being
  absent until a hub claims its row turns out to be the right thing to *wait* on:
  the harness polls for it rather than sleeping.
  One more inconsistency fixed on the way: the seed read the unprefixed
  `DATABASE_URL` while its other two variables are `WAVVON_SEED_*`, so an
  operator reaching for the prefix got no error and the built-in default —
  whatever database answers at localhost. The farm carries a comment about the
  same mistake from the other direction. Both names work now, prefixed first.

- **`moderation_flow` stopped flaking (2026-08-23)**: four voice-join tests
  failed roughly one full-suite run in three, always the same four, and all 18
  passed when the binary ran alone. Two causes, both in one shared helper, and
  both the same mistake wearing different clothes — guessing what the socket
  would deliver instead of stating what the test wanted.
  The helper skipped a **denylist** of noisy frames (`member_online`,
  `member_offline`) and returned the next frame of any kind. The hub pushes
  unsolicited frames on connect — roster, in-progress screen shares — and under
  load those land *after* the `hello` read rather than before it, so the
  assertion landed on one of them. It is an allowlist now: a join is answered by
  `voice_joined` or `error`, and nothing else is the answer. A denylist grows a
  hole every time the hub learns to push something new, which is the same
  argument that shaped the `alliance_voice` WS scope a day earlier.
  The second was a panic on WebSocket **control** frames — "expected text frame,
  got Ping([])", the hub's own keepalive. Harmless at low load and reliably fatal
  under `--test-threads=4`: exactly the shape of a failure nobody can reproduce
  on demand. Control frames are skipped now, and every wait has a 20-second
  bound so a hang fails with a sentence instead of hanging.

- **A fresh farm can be claimed, and the URL it advertises resolves
  (2026-08-22)**: two bugs, both found by driving a real farm binary, both
  invisible to the in-process suite for the same reason — the farm's tests
  insert their own `farms` row and their own expectations, so neither the real
  default nor the real proxy was ever in the picture.
  **A freshly deployed farm was unusable.** `farms.admin_pubkey` starts NULL,
  `creation_policy` defaults to `admin_only`, and nothing in the codebase ever
  wrote the column — so every hub creation was refused with `admin_only` and
  there was no route to appoint the admin who could change that. Editing the
  database by hand was the only way in. `farm-impl.md` had specified
  `admin_pubkey TEXT (set on first start)` all along; it was simply never built.
  Now `WAVVON_FARM_ADMIN_PUBKEY`, the farm's counterpart to the hub's
  `WAVVON_OWNER_PUBKEY`, with `WHERE admin_pubkey IS NULL` so a restart cannot
  take over a farm that already has one — that property has its own test. A farm
  still lacking an admin warns at startup rather than answering `admin_only` to
  everything.
  **The farm advertised a hub URL that 404s.** `hub_url()` built
  `{farm}/hub/{hub_id}`, and the proxy resolves a segment as either a 64-hex
  pubkey or a slug — an 8-hex id is neither. Every client that followed the
  farm's own URL got a 404, the web client's farm admin view included, since it
  fetches `{hub_url}/info` directly. It now applies the rule
  `slugs::hub_address_by_pubkey` already had right: canonical slug, else pubkey.
  `Option<String>` and absent until the hub claims its row on first heartbeat,
  because an absent field a client must handle beats a present one that cannot
  work.
  Three tests asserted `hub_url` *contained the hub id* — true, and no evidence
  at all: nothing checked the URL resolved. That is the shape worth remembering,
  because it is what let this live. Rewritten, plus the assertion that was
  missing.

- **An invite-only hub now accepts a federating peer, so two default hubs can
  actually ally (2026-08-22)**: they could not. A fresh hub is `invite_only`, and
  `/auth/verify`'s invite gate exempted bots but not federating hubs — so hub B's
  federation client got "This hub requires an invite code" from hub A and the
  alliance join surfaced as a **502 blaming the network**. Every pair of hubs
  with default settings, since alliances shipped.
  The same bug as the bot one the comment directly above it already describes: a
  peer hub is not a person joining a community. It authenticates to deliver
  federation traffic, receives no human roles, and its token is tagged so
  `PeerHub` can tell it apart; an invite code is something a community gives a
  person, and there is nobody there to give one to.
  **Nothing caught it and nothing could have.** The integration harness builds
  `AppState` directly and never writes the `invite_only` setting, so
  `is_invite_only` answered false and federation auth sailed straight through.
  The only place the real default exists is a real hub binary reading its real
  configuration. The regression test now sets the setting explicitly, because a
  test leaning on a default it does not state stops covering the thing the day
  the default moves.

- **A cross-hub e2e topology, and it found that bug on its first run
  (2026-08-22)**: `e2e-topology/` at the monorepo root — it needs two checkouts
  at once, so it cannot live in a repo that must be cloneable alone. Boots
  several real hub binaries and the discovery site, then drives what only exists
  between them: an alliance forming across two hubs, hub B reading A's shared
  channel over federation, an alliance **voice grant** crossing the boundary and
  being confined on arrival, the per-share `voice_remote_join` refusal, and a hub
  publishing itself to the directory so a stranger's search finds it by tag, by
  bio text, and in the plain catalog. 8 scenarios.
  Processes, not containers, and deliberately: every assertion is an HTTP fact,
  neither `seed` nor `discovery` has a Dockerfile, and discovery is a Next app
  over a SQLite file — so an image build would buy nothing and cost two
  Dockerfiles per run. Postgres stays a container because it already was one.
  `farm/tests/farm_hub_e2e.rs` had already established spawning the real binary;
  this is that idea with more of the system in frame. Containers earn their place
  the day the whole thing wants to be one CI command, or when the *published
  images* are what needs testing.
  Everything is isolated per run: a database per hub, a port pair, and a working
  directory each — the last because a hub writes `hub_identity.json` and its
  search index into the current directory, so two hubs sharing one share an
  identity. Discovery gained a `WAVVON_DISCOVERY_DATA_DIR` for the same reason;
  it was hardcoded to `cwd/data`, which is the dev database.

- **Voice in alliance channels, hub side (2026-08-22)**: a member of an allied
  hub can join voice in a channel this hub shares with the alliance. The owning
  hub's relay is the room and the visitor dials it directly, so `voice_wt.rs`,
  `voice_channels`, `voice_sender_ids`, the sender-key construction and the
  datagram format are untouched — no `wire-format.md` entry and no three-way
  identity-crate mirror, which is what made this a week of work rather than a
  quarter.
  The origin hub signs the one thing the owner cannot know: that this pubkey is
  its member and that channel is shared. The owner re-resolves every channel
  fact against its **own** shared set, so an allied hub cannot name a channel it
  likes, and the grant vouches for membership and never for identity — the
  subject must be the identity the challenge-response just authenticated.
  Two things the design had asserted turned out to be false, and the tests found
  both. **A visitor's session cannot live in `sessions`**: that table has
  `public_key REFERENCES users(public_key)` and a visitor has no user row by
  design, while the additive-only migration rule rightly forbids dropping the
  constraint. The first fix was a LEFT JOIN in both auth paths; the better one is
  that the visit *is* the session — the token lives on
  `alliance_voice_visitors` beside the channel and the expiry, `sessions` keeps
  meaning what it always meant, and "a visitor is not a member" becomes
  structural instead of something a loosened join has to remember. And
  **`voice_key_request` is not a client message** — it is server→client, so
  listing it in the WS allowlist would have been an arm for a variant that
  cannot arrive.
  Scope is an allowlist because a denylist grows a hole every time a route is
  added: `/info`, the two DH-key routes, `/ws`. Both DH directions are needed —
  E2E voice keys are wrapped per recipient, so a visitor who cannot publish its
  own key is audible to nobody and one who cannot read others' hears nobody. On
  the socket, six message types; anything else is dropped **with a log line**,
  never an `Other => {}`, which is the arm on this exact enum that once hid four
  hub features for months.
  Reuses the shared enforcement helpers rather than copying their predicates —
  `is_muted`, and `is_denied_by_federated_policy`, whose own doc comment says
  every admission point must call it because the overrides were once missed at
  the message layer by exactly the inline copy this avoided.
  Six integration tests, on a two-hub harness that turned out to already exist:
  the happy path (asserting no `users` row appears, and that `/users`,
  `/channels`, `/conversations` and `/me` all 403), unsharing between mint and
  redemption invalidating an outstanding grant, `voice_remote_join = 'none'`,
  presenting someone else's grant, and minting for a channel you own yourself.

- **Outbound voice packet loss, measured where it can be measured
  (2026-08-22)**: the connection panel showed inbound loss only, and said so
  rather than showing a guess — a sender genuinely cannot know which of its own
  datagrams were dropped. The relay can, and now does: every voice packet
  carries a cleartext `[key_id][ctr][ts]` header, `ctr` is the sender's own
  monotonic counter, and gaps in it are packets that left the client and never
  arrived. Reading a counter decrypts nothing, so voice stays end-to-end
  encrypted and the relay stays a header-only forwarder.
  It rides back on the existing `pong`. The client already probes every two
  seconds for latency and the panel already had somewhere to put a number, so a
  periodic stat frame of its own would have been a second heartbeat at the same
  interval for the same client. The hub still keeps no probe table — the reply
  reads a map the relay maintains anyway.
  Absent, never zero, in the three cases where there is no answer: not in
  voice, fewer than two packets sent, or a hub without the new `voice.loss`
  capability. A client cannot tell "this hub does not measure it" from "your
  loss is 0.0%" if the hub answers 0.0 to both, and a reassuring zero is
  exactly what this panel was built not to show.
  Deliberately the same arithmetic as the inbound figure, because the two sit
  in one panel: expected comes from the counter span rather than elapsed time
  (a silent participant sends nothing, and time-based arithmetic calls that
  100% loss), and reordering never counts as loss on a QUIC datagram path where
  it is routine. Both are cumulative per session, which a long call dilutes —
  marked as a shared ceiling rather than fixed on one side only.
  Keyed by pubkey and answered only to the socket it belongs to: one
  participant's uplink is not the channel's business. A test asserts that.

- **The live browser e2e suite runs somewhere other than one laptop
  (2026-08-22)**: `HUB_URL` was a hard-coded const, so the 57 specs that cover
  the real app only ever ran against a hub someone had started by hand — and
  the suite that covers the most was the one nobody ran. `WAVVON_E2E_HUB_URL`
  and `WAVVON_E2E_APP_URL` now override both ends, which is also what lets the
  same specs point at a farm-hosted `/hub/<slug>`. A workflow starts postgres,
  builds the hub from the server repo, runs it API-only and drives Chromium
  against it.
  85 passed, 1 skipped, 0 failed on a clean database. The skip is
  `54-ttt-game`, which needs a running ttt-bot and skips silently, so green
  here means 85 of 86 — said out loud in the suite README rather than left to
  read as full coverage.
  Two things had to be fixed before a fresh hub could be driven at all, and
  both were invisible on a dev box that already had state. The hub refused to
  start with `WAVVON_WEB_CLIENT_DIR=` — its own documented API-only switch —
  because an empty env var deserialised as `Some("")`. And a hub with no
  channels greets its owner with the first-boot template picker, whose overlay
  swallows every click behind it; no spec had ever seen it, because they were
  written against a hub that already had channels. It is dismissed during
  setup, so the flag lands in the saved owner session and the rest of the suite
  never meets it.
  Running it then found five failing specs, none of them a product bug, all of
  them the kind of rot a suite nobody runs accumulates — which is the argument
  for the workflow in one sentence. The mic-test button was renamed when the voice tab
  was localized. "Create and delete a native bot" tested the hub-minted-token
  bot model that `bots.external` replaced: a tab, a heading and a form that no
  longer exist, rewritten against the invite-by-pubkey model that does. And two
  invite-link specs asserted `wavvon://<host>/i/<serial>/<code>`, a format
  dropped when invite links were changed to open the app instead of serving raw
  JSON — one rewritten for `http(s)://<host>/join/<code>`, the other deleted,
  because the serial it existed to check is not in the link any more.
  The fifth looked like a real DM bug and was the most instructive one. It
  matched the owner’s display name against the seed constant, in a suite that
  shares one persistent hub in file order, where an earlier spec renames the
  owner and never puts the name back. Another spec had already hit this and
  already read the name back from `/me`, with a comment explaining why. Reading
  “element(s) not found” as a product bug cost a detour; the fix was three lines
  and already in the repo.

- **The VAD toggle now drops silence, which is what its label always said
  (2026-08-22)**: "Enable voice activity detection (drops silence)" had never
  dropped a single frame. On web nothing read `customVad` at all; on desktop
  `vad_enabled` only chose how the speaking indicator behaved. Both clients
  sealed and sent every 20 ms frame whether or not anyone was talking — the
  settings row was a switch wired to nothing.
  Two properties had to hold for gating to be safe, and both already did.
  `ctr` counts packets actually *sent*, so a silence gap is not read as
  inbound loss — the same reason the loss metric uses the counter span rather
  than elapsed time. And `nextPlayoutStart` already treats a gap as a real
  event and rebuilds its lead instead of scheduling in the past. The encoder
  still runs through suppressed frames, because it carries state between them
  and starving it pops on the first frame after a silence; `timestamp` still
  advances, being a media clock.
  The soundboard needed different code on each client, which is the part worth
  remembering. Desktop mixes a clip into `denoised` *before* the VAD, so a
  playing clip holds `is_speaking` by itself. Web runs `updateSpeaking` on the
  raw mic frame on purpose — a clip is not you talking — so the web gate has
  to test `activeClip` separately. Gating on speech alone there would have
  silenced the soundboard.
  A second bug fell out of it: web applied `customVadThreshold` under every
  profile and ignored `customVad`, so a slider only the custom profile
  displays was changing how the standard profile detected speech, and the
  music profile — the one that must never gate silence — got a silence gate.
  `effectiveVad` now mirrors the desktop pipeline's `effective_config`, with
  three assert tests over the resolution table.

- **`cert_trusted_issuers` had a shape nobody agreed on, so no hub trusted
  anyone (2026-08-22)**: found while designing the cert relay.
  `certs::load_trusted_issuers` — the only reader whose answer matters, since
  it is what the auth gate consults under `cert_mode = "trusted"` — parsed
  `Vec<TrustedIssuer>` (`{pubkey, url, label}`), while `farm_siblings` and the
  admin UI both wrote a flat array of pubkey strings. The mismatch fell into
  `unwrap_or_default()`, so farm sibling trust had never once taken effect,
  and because `farm_siblings::read_set` read the same key as `Vec<String>`,
  its write **overwrote** whatever an admin had configured.
  Fixed by collapsing to one shape rather than teaching the writers to emit
  objects: `url` and `label` were read by nothing in the workspace — the trust
  check compares pubkeys and only pubkeys — the admin UI cannot produce them,
  and `GET /admin/settings/certs` already returned strings. `TrustedIssuer` is
  deleted. The spec had documented both shapes at once, GET as strings and
  PATCH as objects.
  Why six passing tests missed it: every one of them read the setting back
  with its own `Vec<String>` parse, so they all agreed with the writer and none
  of them agreed with the hub. The new test goes *through*
  `load_trusted_issuers`. Cost recorded in
  [hub-certifications.md](hub-certifications.md) §11 — the pull path there
  needs a per-issuer URL, and re-adding one means giving the admin surface a
  field for it, which it has never had.

- **The pipeline was red on develop for five pushes (2026-08-22)**: `cargo
  clippy --workspace -- -D warnings` failed on `bot_kit::send_to`, whose
  `tungstenite::Error` is 136 bytes — `result_large_err`. The workflow tracks
  `stable`, so the lint arrived with a toolchain no local box had yet, and
  every local check stayed green while CI went red. Boxed the error, which is
  clippy's own suggestion and costs nothing on a cold path. Probed the other
  error types the workspace returns while there — `sqlx::Error` 40 bytes,
  `wtransport::ConnectingError` 56, `StoreError` 32 — so it was the single
  offender rather than the first of many. Also gave the postgres service
  healthcheck an explicit `-U postgres`: it had been calling `pg_isready` with
  no user, and the dozen `FATAL: role "root" does not exist` lines it logged
  were the entire output of `gh run view --log-failed`.

- **Live connection readout: ping, spread, inbound loss (2026-08-21)**: what
  the pilot operator's "limits" remark actually meant, once clarified — a
  real-time connection panel like TeamSpeak's, not a settings page. A latency
  chip in the channel header, click for the detail.
  There was no way to measure round trip at all: no application ping, no
  heartbeat. `ping { nonce }` → `pong { nonce }` echoed verbatim, with the hub
  keeping **no state** — the client sends its own timestamp as the nonce and
  subtracts on arrival, so there is no probe table and no cross-machine clock
  comparison. The nonce is what makes it correct: with a 2-second interval on a
  slow link, overlapping probes are normal, and a hub that replied with
  anything else would let a client pair a reply with the wrong probe.
  Median and mean-absolute-deviation, not mean and standard deviation, so one
  stalled probe cannot move the headline number — a test pins it: a 2-second
  outlier among steady 24 ms samples reads 25 ms where a mean says 420.
  Inbound voice loss reads the `ctr` in each packet's **cleartext** header, so
  gaps are visible without decrypting anything — which matters, because voice
  v2 is end-to-end encrypted and the relay genuinely cannot listen. Expected
  count comes from the counter span, not elapsed time: a silent participant
  sends nothing, and time-based arithmetic would call that 100% loss.
  Reordering is not loss either, or QUIC datagrams would show a permanent fake
  percentage.
  **Outbound loss is absent rather than empty**, and the panel says why: a
  sender cannot know which of its own packets went missing. The relay could,
  from the same cleartext counter — tracked in next-up.
  Measured with two clients in voice: chip "1 ms" in the good band, panel
  "Ping | 1 ms ± 0.2 | Packet loss (in) | 0 %", and "± 0.4" on the other
  client — a real jitter figure from real samples.
  Also dropped "(up to 3 MB)" from the empty-channel drag-and-drop tip, since
  as of the same day that number is operator-configurable.

- **The attachment cap is an operator setting (2026-08-21)**: the pilot
  operator asked where to configure server-side limits like upload size. There
  was nowhere — `MAX_ATTACHMENTS_BYTES` was a compile-time constant, so the
  honest answer was "recompile the hub".
  Now `hub_settings.max_attachment_bytes`, read per request so a change needs
  no restart, defaulting to the constant's 3 MB so nothing shifts under an
  existing hub. Both enforcement sites read it and the constant is gone rather
  than left as a second source of truth. Bounded 64 KB – 8 MB, and the ceiling
  is not arbitrary: attachments are stored **inline** (the column is TEXT
  holding base64), so this caps message row size, and `hosting.md`'s nginx
  vhost sets `client_max_body_size 10M` — a higher hub-side limit would only
  produce uploads that die at the proxy.
  `/info` carries the value, publicly, because a client needs it to refuse an
  oversized file before uploading; capability string `limits.attachments`.
  Surfaced as a **Limits** card in hub admin's Overview rather than a new tab,
  since there is one editable limit today. The card also names what it
  deliberately does not offer inputs for — `WAVVON_DB_MAX_CONNECTIONS`,
  `WAVVON_VOICE_UDP_PORT`, build-fixed rate limits — because those need a
  restart, and an input that cannot deliver is worse than a sentence.
  Both clients had a hardcoded copy. The web one was read by nothing and its
  comment claimed it "matches the hub cap"; removed. The desktop one *was*
  enforced at 3 MB and would have refused files an operator had deliberately
  allowed; it is a pre-flight ceiling at the hub's hard maximum now.
  The test that matters tightens the cap and watches a 200 KB attachment take a
  413 while a 1 KB one goes through — it fails if the send path ever returns to
  reading a constant.

- **Speaking indicator, and the AFK sweep it also broke (2026-08-21)**: the
  operator reported no sign of who is talking. The hub had the entire chain
  built — `voice_speaking` (client → hub) fans out as
  `voice_participant_speaking`, which the web client turns into
  `voiceActiveUsers` and the member list renders — and **no client ever sent
  the first message**. Dead at the first link, silently.
  The badge was the visible half. `voice_last_active` is stamped on join *and
  on every `voice_speaking`*, and `afk_worker` moves anyone whose stamp is
  older than the timeout — so a hub with an AFK channel configured **dragged
  every participant into it once the timeout passed, however much they were
  talking**. Same one-line cause, and the same fix.
  Detection has to be local: voice v2 encrypts every packet end to end and the
  relay forwards headers only, so the hub cannot distinguish speech from
  silence even in principle. `speakingDetector.ts` is pure (RMS energy plus
  hysteresis: on at the first loud frame, off after 400 ms of quiet) and
  reports only edges — one message per frame would be a storm for a boolean.
  Its threshold comes from `customVadThreshold`, a setting that had been in the
  voice UI all along with nothing reading it.
  Measured with two real clients: alternating `[true,false,true,…]` edges from
  both, ~680 audio frames each, and the badge present in the DOM — which can
  only come from a hub broadcast, so it proves the round trip.
  The surface was also mislabelled: the prop was `inVoice` and the tooltip "In
  voice" while being fed the *speaking* set. It is `speaking` now, i18n'd with
  an aria-label, and pulses rather than sitting static beside a name.

- **Discovery surfaces are absent when there is no directory (2026-08-21)**:
  the operator asked for a CSS class with `display:none` for the features that
  do not work yet. What was actually wrong was worse: the clients hardcoded
  **three different hostnames for one service across five files** —
  `discovery.wavvon.io` (DiscoverPage, hub admin), `discovery.wavvon.app`
  (hub-creation link, skins gallery) and `hub-directory.wavvon.io` (desktop hub
  browser) — and none of the three resolves.
  Fixed his way, using the rule `constants.ts` already stated three lines above
  the offending constant ("null means the button is hidden — don't ship a dead
  button"): one nullable `DISCOVERY_URL` per app, and the sidebar ⊕, both
  "Browse public hubs" buttons, the hosted-wizard link, the skins gallery, the
  desktop hub browser and hub admin's Discovery tab are all **not rendered**
  rather than rendered broken. Most of the guards already existed —
  `WelcomeScreen` and `AddHubModal` check `onBrowse` — the app was simply
  always passing them.
  This also corrected an earlier suggestion of gating on `hubSupports()`: the
  directory is an independent site, not a hub feature, so a hub cannot report
  whether it is up. Setting `DISCOVERY_URL` brings every surface back.
  Two traps surfaced once the defaults were gone: `DiscoverPage.directoryUrl`
  was optional *with* a hardcoded default, so removing the default alone would
  have fetched `undefined/api/hubs` — typechecks, fails at runtime — and
  `HubAdminPage` seeded a form with a literal inside a package that is
  prop-only by convention.

- **Voice played every frame on arrival (2026-08-21)**: the first external
  operator reported voice arriving "a tratti" across the internet while the
  same build was clean locally, and that asymmetry was the diagnosis. `playPcm`
  called `src.start()` with no argument — "play at once". On a loopback frames
  arrive 20 ms apart almost exactly, so playing each on arrival sounded
  gapless; across a real network a frame 5 ms late leaves 5 ms of silence and
  two arriving together both start immediately and *overlap* instead of
  queueing. There was no jitter buffer to tune: there was no playout
  scheduling at all.
  Frames are now scheduled where the previous one ends, per sender, held 60 ms
  ahead of the audio clock, with a 200 ms cap so a bursting sender cannot push
  latency up forever — hitting it costs one skip instead of permanent lag. Web
  only; the desktop pipeline buffers through ringbuf and cpal.
  Measured with two real clients over 10 s, wrapping
  `AudioBufferSourceNode.start`: 682 and 694 frames scheduled, **zero at
  `when == 0`**, consecutive starts exactly one frame (0.02 s) apart, lead
  holding at 0.08–0.088 s. The audible confirmation still needs the pilot,
  because the jitter only exists there — that stays open in next-up.
  The first draft's underrun check (`prevEnd < floor`) would have re-buffered
  on every frame of a healthy stream and manufactured the skipping it was
  meant to remove; its own test caught it.

- **An invite link opens the app (2026-08-21)**: `GET /join/{code}` was a JSON
  preview endpoint, so the link an operator hands out rendered
  `{"code":…,"hub_name":…,"member_count":…}` in a browser. The pilot operator
  sent it to a friend, who asked what to do with it — the first step of every
  new user. The endpoint now content-negotiates: accepts `text/html` gets the
  web client, anything else keeps the preview JSON, and with no web client
  configured the JSON stands because there is nothing better to answer with.
  Serving the app there was only half of it. The client never looked at
  `window.location.pathname`, so it would have landed the user on an empty app
  with the code silently dropped. `inviteCodeFromPath` reads it and the
  add-hub flow opens prefilled — not an automatic join, since a link should
  not silently change someone's hub list, and the URL is cleared only once the
  invite is applied so reloading mid-onboarding still honours it.
  Verified end to end rather than by unit test: a local hub serving a freshly
  built web client, driven in Chromium through onboarding, ending with
  `invites.uses = 1 of 1` and the new identity holding `builtin-owner` in the
  database.

- **Every bot is an external bot (2026-08-21)**: the hub had two bot systems.
  Self-service bots were hub-minted `bot_<uuid>` identities with a bearer
  token, created through `POST /admin/bots` by **any authenticated member with
  no permission check**; external bots hold their own Ed25519 keypair, are
  invited by pubkey and authenticate on the normal session path. The first is
  gone, along with the `bots`, `bot_slash_commands` and `bot_tokens` tables and
  `authenticate_bot`. A bot on the hub's own machine is still an external bot —
  co-location was never an identity model. Decision and alternatives in
  [decisions.md](decisions.md).
  The two were near-duplicates (`bot_profiles` ⊃ `bots` bar `token_hash` and
  `created_by`), and they had already produced the failure the fold-duplicates
  rule predicts: `routes/bots/voice.rs` carried a comment explaining that the
  `can_speak_voice` grant gates external bots and *deliberately does not* gate
  the self-service voice endpoints, because self-service bots never populate
  `bot_profiles`. A capability gate covering half the bots on a hub.
  Two finds while pulling the thread. `bot_tokens` was **read by two auth
  paths and written by none** — a table granting authentication that no code
  populated. And `effective_capabilities` had a branch reading "no
  `bot_profiles` row → a grant is effective on its own"; the rule is now
  requested ∩ granted with no exception, so a grant for something the bot
  never declared is inert, pinned by a new test.
  Kept: the `/bot/send`, `/bot/poll`, `/bot/events` HTTP transport, the only
  way to write a bot with no persistent WebSocket — moved to session auth,
  with `bot_event_queue`'s foreign key repointed from `bots` to `users`.
  Migrations drop three tables, which that file otherwise never does: a
  baseline reset authorised for beta with no bot deployed anywhere, commented
  as such at the drop site. `POST /bots/{id}/voice/join` went too — after
  voice v2 it authenticated the caller and returned the constant `"/ws"`,
  while the real join and the real gate were on the WebSocket. Client side:
  `NativeBotsSection`, its platform commands and five Tauri commands removed,
  and the remaining tab relabelled to just **Bots**. 240 registered routes,
  240 documented.

- **Hub admin Overview is compact (2026-08-21)**: eleven fields, each a
  full-width band with a full-width divider under it and a control inside
  keeping the browser's default ~185px width — a 1265px rule under a 185px
  input on a 1360px pane, and 1673px of scrolling for controls that fit on one
  screen. Now five cards (Identity, Access, Locale & appearance, Channels &
  voice, Welcome message) on an auto-fit grid; from 1600px up the tab fits
  without scrolling. New `.settings-cards` / `.settings-card` /
  `.settings-card-wide` / `.settings-card-row` / `.settings-save-bar`
  primitives, all scoped under `.settings-card` so no existing settings screen
  changed, ready for the other admin tabs. Verified in Chromium at six widths:
  columns 4/3/2/2/1/1, no clipping, no horizontal overflow.

- **No default database password in the shipped compose files (2026-08-21)**:
  GitGuardian flagged `docker-compose.farm.yml` when v0.5.0 landed on `main`.
  The connection URI carried `${WAVVON_DB_PASSWORD:-wavvon}`, so a hub taking
  the quick-start path ran on a password printed in a public repo, silently and
  forever. Both compose files now use `${WAVVON_DB_PASSWORD:?…}` and refuse to
  start without one; the wizard-emitted compose already had no default, so the
  hand-written files were the outlier. Also cleared placeholder passwords out
  of `hub.toml.example`, `hub-scaling.md` and the farm Dockerfile comment, and
  added `.gitguardian.yaml` to server/clients/docs for the localhost
  `postgres/postgres` dev default — which is a documented default, not a
  credential.

- **Pilot rebuilt on v0.5.0 (2026-08-21)**: the external pilot hub was two
  releases behind. Upgraded 0.3.2 → 0.5.0 in place first, which proved the
  path — 96 commits of additive migrations against a real older schema, clean,
  data and hub identity intact — then wiped and rebuilt from scratch on
  operator decision, since the old install held two accounts (both the
  project's own) and zero messages. New hub identity, fresh first-boot owner
  invite. Voice on that port is now QUIC/WebTransport rather than the raw UDP
  relay. Deployment specifics stay out of this repo.

- **First operator feedback: four UI fixes (2026-08-21)**: two were not what
  they looked like. The channel-header icons are **emoji**, so the rule
  styling them set a `color` an emoji ignores; what made them unreadable was
  having no plate behind them, and raw contrast had been passing AA at 6.35:1
  all along. And the Discover tag chips were reported as "no margin" but had
  **no CSS at all** — `.discover-tag-chips` / `.discover-tag-chip` lived in
  `DiscoverPage.tsx` and never in `styles.css`. Plus: the event composer no
  longer discards a filled-in form on a backdrop click, and its start time
  seeds to the next half-hour instead of `""`, which is why the native picker
  used to highlight a time it had not committed and the submit guard rejected
  a form the user believed was complete. New `localDateTimeValue` /
  `nextHalfHourValue` helpers with tests through the midnight rollover.

- **Docs: two quick starts that could not work (2026-08-21)**: both
  `hosting.md` compose blocks started a hub with no PostgreSQL sidecar and no
  `WAVVON_DATABASE_URL`, so as written neither came up; `getting-started.md`
  offered a bare `docker run` of the hub image, which can never reach a
  database. All three fixed and the compose blocks verified by extracting them
  from the markdown and running `docker compose config`. Separately,
  `hub-scaling.md` still described SQLite + FTS5 as current and PostgreSQL as
  a future tier chosen per deployment — all three of its tiers had shipped, and
  PostgreSQL replaced SQLite rather than joining it. Also scrubbed the pilot
  hub's real hostnames out of six wiki pages: the repos are public and that is
  a third party's infrastructure, whatever the earlier note in this file argued
  about keeping them as live facts.

- **The farm works end to end on a single node (2026-08-20)**: closing the
  umbrella item opened 2026-08-09, when the farm was "quasi tutto costruito,
  niente collaudato" and three of its gaps were silent. All of it now has its
  own entry below: the serial claim, without which the proxy could route to
  nothing; the public URL, without which a farm-hosted hub had no voice; a
  place of its own per hub, after every spawned hub shared one database; an
  identity per hub, after every hub on a farm loaded the same key; the
  WebSocket a farm-managed hub refused; spawned hubs outliving their
  supervisor; and two hubs handed the same port. `farm_hub_e2e` creates a hub
  through the farm's own API, lets the real binary start and asks the proxy for
  its `/info`, so any of those regressing fails a test — and CI's
  `WAVVON_REQUIRE_E2E=1` means it cannot skip itself quietly.
  Two things were carved out rather than finished, because neither is farm
  work: a **PostgreSQL role per hub**, which is a containment measure
  orthogonal to the database-or-schema choice (still in the roadmap), and
  **browser e2e in CI**, which is its own infrastructure and was only ever
  filed here because the farm was the first thing that wanted it. Multi-node
  stays in the wishlist behind a decision on private networking farm↔nodes.
  Reviewed against the code 2026-08-20; nothing in the closed list depends on
  the two carve-outs.

- **Two hubs could be handed the same port (2026-08-19)**: `allocate_port`
  and `allocate_voice_port` returned the first gap above the base port,
  scanning `self.hubs` — the map of children this farm process spawned
  *successfully*. Nothing was reserved at allocation time, so anything that
  allocated without landing in that map got the same number again: a hub whose
  spawn failed had its ports written to its row but never entered the map, and
  every agent-hosted hub, always, because it runs on another node and never
  enters that map at all. `process_port` is what the proxy routes on, so two
  rows sharing one is two hubs at one address — the same silent shape as the
  shared identity and the shared database before it. Occupied ports now come
  from the `hubs` table, which all four allocation sites write to, unioned
  with the local children; suspended hubs keep theirs, since resuming onto a
  taken port is the same collision, later. The test that asserts exactly this
  (`allocate_and_spawn_yields_distinct_ports_and_persists_voice_port`) was
  written on 2026-08-07 and had never run in CI — clippy failed ahead of it.

- **`restore` failed on every PostgreSQL 14 client (2026-08-19)**: pg_dump 14
  and older write `CREATE SCHEMA public` into the archive. Every destination
  database already has `public`, so that TOC entry failed, and
  `--exit-on-error` — which exists precisely so a half-restore cannot pass for
  a whole one — turned it into a failed restore. 14 is the floor the hub
  declares, so this was the low end of the supported range: `wavvon-hub
  restore` could not restore on Ubuntu 22.04, whose client tools are 14.
  pg_dump 15+ stopped emitting the line, which is why every local run passed
  and only CI ever saw it. Fixed with `--clean --if-exists`, whose drops are
  guarded and therefore no-ops into the empty database a restore normally
  targets. Reproduced against real 14 and 16 servers before and after.

- **CI dumped a 16 server with a 14 client (2026-08-19)**: the workflow
  installed the `postgresql-client` meta-package, which on ubuntu-22.04 is 14,
  so the 16 half of the matrix could not run pg_dump at all — a client will not
  dump a server newer than itself. Installing `postgresql-client-16` was not
  enough either: `/usr/bin/pg_dump` is `pg_wrapper`, which resolves to the
  version of the default cluster on the runner rather than the newest client
  installed. The client is now pinned to the matrix version with
  `/usr/lib/postgresql/<major>/bin` on PATH — pinned rather than "newest
  everywhere" on purpose, since the 14 job is the only place an old pg_dump
  `CREATE SCHEMA public` line is exercised at all.

- **Every hub on a farm loaded the same identity (2026-08-09)**: a hub
  resolves `hub_identity.json` and its search index relative to the process
  working directory, and a spawned child inherits its parent's. The farm never
  set one, so every hub it spawned read the **same identity file** — the first
  to boot created it and every other adopted its key.
  One pubkey across a whole farm. That key is the hub's identity in
  federation, the serial the proxy routes on, and the signature under every
  badge, certification and ban list it issues. Two hubs claiming to be the same
  hub is not a degraded mode. Each hub now runs in `<hubs_dir>/<hub_id>`; the
  `hubs_dir` setting existed and was carried around for a SQLite-era path
  nothing consumed.
  Found by adding an end-to-end test for **schema isolation**, which shipped
  the same morning with unit tests for the URL it builds and nothing that had
  ever run a hub behind one. Its failure mode was the worst kind: had the
  driver ignored the `options` parameter, every hub would have migrated into
  `public` and shared it again — the exact bug per-hub isolation replaced,
  wearing the appearance of a fix. The test asserts the tables land in
  `hub_<id>` and that `public` stays empty. Also learned there: schema
  isolation keeps the base URL's database, so a farm's `WAVVON_DATABASE_URL`
  must name one.

- **A farm-managed hub refused every WebSocket (2026-08-09)**:
  `validate_ws_token` tried the sessions table, then bot tokens, then returned
  401 — it never verified a **farm-issued** token. Against a farm-managed hub
  the client authenticates *at the farm* (`authBaseUrl` follows
  `/info.farm_url`) and opens its socket with that token, so a farm-hosted hub
  served HTTP and refused every socket: no messages, no presence, no voice
  signalling, nothing real-time. HTTP working made the hub look alive; the
  socket simply never connected.
  The fourth bug of the same family found the same way — something that only
  breaks between the farm and a real hub, which nothing had ever put together.
  Farm-token verification is now one function used by both the HTTP middleware
  and the WebSocket handshake. It was seventy lines inline in the middleware,
  and copying it into the socket path would have recreated the exact
  duplication this repo has already paid for twice.
  Found by extending `farm_hub_e2e` to open a real socket through the farm's
  bridge — the last thing about a farm-hosted hub that cannot be verified by
  reading: a path-prefixed Upgrade, handed to another process, authenticated
  with a token the hub did not issue.

- **The farm→hub path has a test with real processes (2026-08-09)**: every
  other farm test mocked the hub — `e2e_server_agent` a mock agent,
  `serial_routing_flow` a stub HTTP server, the rest seeded rows by hand. That
  is why three separate bugs lived in this path for months without a single red
  test: each one exists only *between* the farm and a real `wavvon-hub`
  process. `farm_hub_e2e` creates a hub through the farm's own API, lets the
  binary start, and asks the farm's proxy for its `/info` — checking that the
  serial got claimed, that the hub knows its canonical slug address, that it
  has a voice endpoint (which needs a public URL it could only derive itself),
  that its database is its own, and that the key behind the address is the key
  the farm recorded. It skips when the binary is not built and CI sets
  `WAVVON_REQUIRE_E2E=1` to turn that skip into a failure.
  **It found a crash on its first run.** A farm reached at an IP derives an
  `rp_id` of `127.0.0.1`; WebAuthn requires an effective *domain*, and the
  builder's `.expect()` killed the hub at startup. Farm-hosted hubs had been
  safe from it only because they previously had no public URL at all and fell
  back to `localhost` — deriving one exposed it. A relying party the browser
  would refuse now disables passkeys with a loud warning instead of taking the
  process down: losing passkeys on a hub that could never have offered them is
  correct, refusing to boot is not, and on a farm it costs a community per
  misconfigured address.
  Also from writing it: the heartbeat skipped its first tick, so a freshly
  spawned hub said nothing for a full minute — and the first heartbeat is what
  claims its serial. For that minute the farm had a hub it could not route to
  and a monitor with no evidence it was alive. It announces on boot now.

- **Sibling hubs vouch for each other; `soft-flag` became visible
  (2026-08-09)**: a farm now reports a hub's siblings in the heartbeat
  response, and each hub wires them in — subscribing to their ban lists in
  `soft-flag` and adding them to `cert_trusted_issuers`. Somebody vouched for
  on one hub of a farm is not a stranger on the next, and somebody with history
  arrives with it attached. Built from the federation primitives that already
  exist rather than a farm-level reputation store, which decisions.md rules
  out: the trust decision stays local to each hub, and the farm only saves its
  owner from wiring it by hand.
  **Once per sibling, and recorded whether or not it took.** An owner who
  unsubscribes stays unsubscribed — a compromised sibling has to be cuttable,
  and a setting the farm silently reverts every minute is not a setting. What
  it never touches is what a hub *requires*: trusting an issuer means its
  certificates can be read, not that they clear a bar the owner set. Granting
  good standing automatically would turn one complacent hub into a pass factory
  for the whole farm. Suspended hubs and hubs that have never claimed a serial
  are not offered — the first because suspending it meant something, the second
  because an unverifiable issuer is not an issuer.
  The other half was making `soft-flag` mean anything. It has been selectable
  since federated ban lists shipped and the admission check correctly ignores
  it, but nothing could ask **"does this member have history?"**, and the raw
  entries list did not say which policy an entry came from — so an advisory
  entry and a blocking one looked identical and meant opposite things.
  Choosing `soft-flag` was indistinguishable from not subscribing at all. `GET
  /moderation/history/{pubkey}` (ban-members permission) answers the question
  with source, policy, reason and date, resolved against the master pubkey so a
  paired device does not read as a clean record; the entries list carries
  `policy` too. Deliberately not a judgement: another hub's ban is another
  hub's decision, and the moderator gets the facts and makes their own.
  Entries whose source is gone are listed as `policy: "unknown"` rather than
  dropped — hiding rows would make the list quietly disagree with the table it
  claims to show.

- **Hub placement — capacity per server (2026-08-09)**: choosing which node a
  new hub went on was `map.iter().next()` — the first entry of a HashMap
  iteration, an arbitrary connected agent, with no notion of how many hubs it
  already held. "This server holds five hubs, that one holds three" could not
  be expressed: there was nowhere to say it and nothing that would have read
  it, and `CreateHubRequest` had no field for naming a server either.
  `servers.max_hubs` and `farms.max_local_hubs` now cap each node — including
  the farm's own process, which is a real placement target and not a fallback
  that skips the accounting. A request may name a server; unnamed, the
  **emptiest** node wins, so hubs spread instead of piling onto whichever one
  hashed first, with ties going to an agent so the farm stays free for the work
  only it can do.
  Placement is **refused, never overflowed**: a named server that is full is a
  409 rather than a quiet redirect elsewhere, because an operator who named one
  wants that one and would find out much later and much more confusingly. Same
  for everything being full — with an error that says to raise a cap or
  register another server.
  One ordering bug found by its own test: the first version chose *after*
  inserting the hub row, so the new hub counted against its own node and a node
  capped at one refused the very first hub placed on it. The decision happens
  before the row exists now, which also removes the rollback the old order
  needed.

- **Somewhere of its own for each hub — database *or* schema (2026-08-09)**:
  the farm passed **no** database
  configuration to the hubs it spawned, so every one of them fell back to the
  same default URL and **they all shared a single database** — each hub reading
  and writing every other community's channels, users and messages. The code
  logged a warning per spawn saying exactly this; `hubs.db_path` was a
  SQLite-era file path nothing consumed, and the parameter carrying it was
  threaded through every spawn path unused.
  Each hub now gets its own database on the farm's own PostgreSQL server,
  created on first spawn and recorded on the row, so the work happens once. The
  dead `db_path` parameter became `db_url` rather than gaining a new one beside
  it. `CREATE DATABASE` takes no bind parameters, so the name is formatted in —
  guarded by an identifier check that hub ids can never fail today, present so
  that a future change to id generation breaks loudly there instead of quietly
  becoming an injection point.
  **A provisioning failure refuses the hub** — creation returns an error and
  the row is rolled back, a startup sweep skips that hub, a restart reports it.
  Falling back to the shared default is the bug this replaced, and it is
  exactly the sort of fallback that hides for months. Hubs that predate the
  column are provisioned on their next spawn or restart, so an admin restart
  doubles as the repair path.
  Farm tests hand the harness a real base URL, because there is no "skip it in
  tests" path that still exercises the refusal, and their teardown drops the
  hub databases a test created — they are not children of the farm database and
  nothing else would ever remove them.
  **Second layout, added the same day**: a database each needs `CREATEDB`, and
  a managed PostgreSQL plan routinely grants one database and no such right —
  so the first version could not create a *single* hub in an entire class of
  hosting. `hub_isolation` = `database` (default) | `schema` picks between one
  database per hub and one **schema** per hub inside the farm's own database,
  selected via `search_path` on the connection. The hub needs no idea which is
  in use: all of its SQL names tables unqualified, verified before relying on
  it, so PostgreSQL places them without a line of hub code changing.
  The one place that did assume `public` was `db/dump.rs` — mine, from the day
  before — and left alone it would have dumped **zero tables and called the
  backup a success** for every schema-isolated hub. It reads `current_schema()`
  now and passes `--schema` to `pg_dump` explicitly rather than trusting the
  connection's path, since in schema mode a hub's siblings live in the same
  database and the default would take everyone's or nobody's.
  Stated rather than implied, because it is easy to assume otherwise: **neither
  layout contains a hostile hub.** Every hub connects with the same role, so a
  compromised hub process can reach its siblings' data under both. Real
  containment needs a PostgreSQL role per hub — orthogonal to this choice,
  works with either, and is the only one of the three that is a security
  measure. On the roadmap as such.

- **Hub slugs — owner-chosen addresses (2026-08-09)**: a hub on a farm was
  reachable only at `/hub/<64 hex chars>`. It now also answers at a name its
  owner picks — `https://farm.example/hub/MangiaDaPippo` — deliberately *not*
  a slugification of the display name, which stays free to be "Osteria di
  Pippo" with spaces and emoji and to change without disturbing anyone's
  bookmark.
  **The slug is an alias; the pubkey stays the identity.** That is the whole
  design and it buys one property nothing else does: a client compares the key
  it expects against `/info.public_key` and notices if a name now points
  somewhere else. Were the slug the identity there would be nothing to compare
  against and the farm's mapping would have to be taken on faith — which a
  self-hosted federated product cannot ask of anyone. Both addresses resolve
  through one lookup function over two key spaces that cannot overlap
  (`normalize` refuses anything shaped like a key), not two route families
  that could drift apart.
  Two naming rules earn their place, and both guard risks that **did not exist
  while the address was a pubkey**: matching is case-insensitive (the slug is
  stored lowercase as the primary key, so `MangiaDaPippo` and the all-lowercase
  variant cannot be two owners) and ASCII-only (a Cyrillic "а" renders
  identically to the Latin one; refused at the door rather than analysed).
  Slugs are released, never deleted. Releasing stops resolution and frees a
  quota slot, but the row stays: for a cooling-off window only the hub that
  gave the name up may reclaim it, after which it returns to the pool. Names do
  come back — just not the instant somebody lets one go, which is exactly when
  inheriting their inbound links is worth most. How many a hub may hold at once
  and how long the window lasts are farm policy, beside `max_hubs_per_user`.
  Releasing the canonical slug promotes the next one rather than refusing, so
  a hub can never end up holding names while advertising none.
  Alongside it, **`canonical_url` on `/info`**: the hub publishes its current
  address and the client follows it, keyed on the pubkey. A rename now reaches
  every client that reconnects instead of stranding them. The hub learns its
  own name from the **heartbeat response** — an env var is fixed at spawn and
  could never carry a later rename, whereas the heartbeat is already a
  standing farm→hub channel and gets there within one interval.
  Client side, a bug the round-trip test caught immediately: `parseHubInput`
  built `hubUrl` from the origin alone, so
  `https://farm.example/hub/pippo/join/abc` parsed to the **farm's root with
  no invite code** — pasting a farm invite link into Add-hub would have
  reached nothing. A hub on a farm lives *under* a path, so its base URL
  includes that prefix; the parser splits `/hub/<slug>` off the front now and
  parses the remainder as an ordinary hub path. Standalone hubs are untouched
  (empty prefix). `buildInviteLink` needed no such fix once the client's
  stored address carries the slug — its unused `hubSerial` argument, and the
  props threading it through four components, were deleted rather than left
  ignored.

- **A farm-hosted hub had no public address (2026-08-09)**: `voice_wt_url`,
  the first-boot invite link and the WebAuthn relying party all derive from
  `WAVVON_PUBLIC_URL`. That key was a string literal the farm and agent never
  set, and could not have: the URL of a farm-hosted hub is
  `{farm}/hub/{pubkey}`, and the pubkey does not exist until the hub's first
  boot. So every farm-spawned hub started with no public URL, which meant no
  `voice_wt_url` at all — **voice was not degraded on farm-hosted hubs, it was
  absent** — plus an invite link pointing at localhost and no passkeys.
  Resolved where both halves are actually held: the hub derives its own from
  `FARM_URL` + its pubkey, via a pure `effective_public_url()` with its own
  tests. An explicit `WAVVON_PUBLIC_URL` still wins, for an operator fronting
  the farm with their own domain, and the key now lives in `hub-env` so a
  launcher *can* set it without spelling it. A hub that ends up with no public
  URL says so at startup instead of losing three features quietly.
  Two things fixed on the way. `--doctor` printed a localhost invite link for
  a hub actually reachable at `https://farm/hub/<key>`; it now loads the
  identity (read, never create) and prints the real one. And `rp_origin` was
  built from the whole public URL including its path — fine while every hub
  sat at a domain root, wrong the moment one lives under `/hub/<key>`, since
  WebAuthn compares origins. It takes the origin explicitly now, which also
  fixes the pre-existing case of a hub behind any path-prefixing proxy.
  Not fixed, and worth naming: on a **multi-node** farm the derived host is
  the farm's, not the agent node's, so voice would point at the wrong machine.
  Consistent with the state of multi-node routing generally — the proxy still
  hardcodes `127.0.0.1` — and it belongs with that work.

- **A farm-spawned hub could never become routable (2026-08-09)**:
  `hubs.hub_pubkey` is the serial the farm's reverse proxy resolves
  `/hub/<serial>` on, and **nothing ever wrote it** — not the INSERT, not any
  UPDATE. The column was created nullable and stayed NULL for the life of
  every row. Every consequence was silent: the proxy found no row so every
  farm-routed request 404'd; `/farm/heartbeat` only accepts hubs whose pubkey
  is already in `hubs`, so it rejected every heartbeat a spawned hub sent; and
  the monitor, reading liveness from those heartbeats, concluded each hub was
  down, restarted it on an exponential backoff, and finally disabled its own
  auto-restart. A farm could create, spawn, supervise and delete hubs it was
  structurally unable to send one request to.
  The missing piece was a bootstrap handshake, and it has the same shape as
  the public-URL bug: the farm allocates the row before the process exists so
  it cannot know the key, and the hub does not know which row is its own. The
  farm now hands its row id over at spawn (`WAVVON_FARM_HUB_ID`, in `hub-env`
  rather than as a literal) and the hub echoes it on every heartbeat; the farm
  binds pubkey to row on first contact. `WHERE hub_pubkey IS NULL` makes the
  claim strictly one-shot — a hub can take an unclaimed row and nothing else,
  which is the property that makes it safe on an unauthenticated endpoint, and
  it has its own test. A row already bound to a different key is left alone
  and logged: that is a restored identity or a duplicated id, and both want a
  human rather than a silent rebind.
  `serial_routing_flow.rs` did not catch this because it seeds `hub_pubkey` by
  hand — it proves the proxy works *given* a serial, which is a different
  claim from "a real hub ever gets one".

- **Farm/agent-spawned hubs outlived their supervisor (2026-08-09)**: tokio
  does not kill a child when its `Child` handle drops — it detaches it. Both
  `hub_manager.rs` files stored the handle and relied on `stop_hub` being
  called, so any path that skipped it (a panic, a test ending, the process
  exiting) left a `wavvon-hub` running with nothing supervising it: still
  holding its allocated port, still writing to the default database every
  other spawned hub shares. The agent's field name — `_child`,
  underscore-prefixed, held purely for ownership — shows the intent was always
  "this dies with the manager"; `kill_on_drop(true)` makes it true.
  Found because `cargo test --workspace` hung for the better part of an hour
  on an orphaned hub whose parent was already gone. That is the visible
  symptom; the real one is a fleet node quietly losing track of a hub that
  keeps serving and keeps writing — the same family as the two failures
  CLAUDE.md records for this pair (the env-key drift and the silent WS
  fallthrough), a supervisor losing its process without noticing. The suite
  completes now: 80 test binaries, zero failures, and a watcher sampling every
  60s across the whole run never saw a surviving hub process.

- **Rollback is defined now (2026-08-09)**: "additive migrations" implied an
  older binary tolerates a newer schema, but nothing said so and nothing
  checked it. Split into the two halves, because they have different answers.
  *Schema*: safe by construction, and now by rule rather than by luck — every
  `ADD COLUMN ... NOT NULL` in `migrations.rs` carries a `DEFAULT`, so an
  older binary, whose inserts omit columns it does not know about, keeps
  writing against a newer schema. All 35 satisfied it already; a source-level
  test in `tests/migrations.rs` pins it, and it was verified to fail on an
  injected violation rather than merely pass. `information_schema` cannot
  answer this — it cannot distinguish a column added by `ALTER TABLE` from
  one in the original `CREATE TABLE`, and the latter are legitimately `NOT
  NULL` without a default.
  *Data*: no guarantee, and this is the half that actually bites. The newer
  binary may have written a channel type, field or envelope version the older
  one has no code for; it will not error, it will ignore or misrender. So the
  supported rollback is "restore the backup you took before upgrading" —
  which is only a real answer because `backup` now takes a real backup. Both
  upgrade docs were reordered to make taking one step 1, every time, not just
  for majors.

- **`wavvon-hub backup` now backs the hub up (2026-08-09)**: it used to
  write `hub_identity.json` and a metadata stub, with a comment in the source
  telling operators to run `pg_dump` themselves — so "take a backup first" in
  the upgrade docs pointed at a tool that did not take one, and the operator
  guide documented `--out` / `--from` flags that never existed. Uploads had
  never been in the archive either, so a restored hub came back with every
  attachment a broken link. The archive now carries `database.dump` (a
  `pg_dump` custom-format dump), `hub_identity.json` and `uploads/`. The
  Tantivy index stays out on purpose: it is derived from the messages table
  and rebuilt by `POST /admin/search/reindex`.
  The mechanism is `db/dump.rs`, built as the shared one the dump/restore
  decision calls for — embedded↔external moves and embedded major upgrades
  will use the same code. Every path refuses rather than half-writing, in
  cost order: direction first (`target_major >= source_major`, not
  overridable, because past it `pg_restore` cannot parse the archive), then
  emptiness (refuse a destination that already has tables — restoring over a
  live hub merges two communities; `--force` waives only this), then
  `pg_restore --exit-on-error` (without it `pg_restore` reports every failure
  and still exits 0, so a half-dropped schema looks like success), then a
  per-table row-count comparison against counts recorded at backup time,
  naming any short table and saying not to start the hub against that
  database. Extra tables in the destination are fine — migrations run on
  startup and a newer binary legitimately adds them.
  Two things the change needed beyond the code: `postgresql-client` in the
  hub's Docker image (`pg_dump` was simply not there, so the command would
  have failed on the box the operator runs it on), and the same in CI, where
  `WAVVON_REQUIRE_PG_TOOLS=1` turns the integration test's
  tools-not-found skip into a failure — a test that skips itself is a test
  that can stop running unnoticed. That test round-trips a real migrated
  schema and asserts the `posts` `tsvector GENERATED ALWAYS` column survives,
  the one piece of schema that is not plain DDL.
  Still missing from the original design: the archive no longer carries
  `hub_pubkey`, so restoring one hub's identity over another's is not warned
  about — recorded in [hub-operations.md](hub-operations.md) §1.

- **Capability advertising (2026-08-09)**: `GET /info` now carries
  `capabilities: Vec<String>`, and the web client decides what to offer by
  testing membership in it — never by comparing version strings. Decision:
  [decisions.md](decisions.md#hub-capabilities-are-advertised-not-inferred-from-a-version-number).
  This matters more here than in most federated products because of how the
  web client is distributed: each hub bakes a client into its own image and
  serves it, and that client is multi-hub, so its version is decided by
  whichever hub the user happened to open and bears no relation to the hubs
  it then talks to.
  Hub side: `capabilities.rs` holds one sorted list with a "add your string
  here, in the same commit" rule; unit tests pin sorting, uniqueness and one
  spelling convention, and an integration test pins that the strings reach
  `/info` unauthenticated and never change spelling (renaming one is a
  removal, and removals wait for a major). Seeded with the five cases where a
  newer client would otherwise call a route an older hub lacks, or silently
  get a worse answer: `list.cursor`, `pairing.subkey`,
  `recovery.attestation`, `screenshare.v2`, `voice.wt`.
  Client side: capabilities and version are per-hub state beside name and
  icon — live in `HubSession`, persisted in `SavedHub` so the UI is right on
  the first frame after a reload, refreshed by `refreshHubInfo` (which
  already runs on connect and on every `hub_updated`, exactly when a hub
  could have restarted onto a new version). Read through
  `hubSupports(hubId, cap)` / `activeHubSupports(cap)`; unknown means false,
  so a feature is absent rather than erroring on a route that isn't there.
  **That collapse is right for rendering and wrong for choosing a request
  strategy**, which the first consumer proved immediately. `fetchAllUsers`
  walks keyset pages, and against a pre-pagination hub the cursor is ignored
  and every page is the same full roster, so the loop would have returned 40
  copies of every member — one plain request there *is* the complete list,
  since the endpoint was unbounded. But gating that on `hubSupports` sent the
  same unparameterised request to a hub merely *saved by an older client
  build*, silently keeping its first 200 members: the exact truncation
  pagination existed to fix, at a bigger number. So `hubCapabilities()`
  returns `string[] | null`, and the null is load-bearing — `[]` is a hub that
  answered and advertised nothing (a fact about the hub), `null` is a hub we
  have not asked (a fact about us). The shortcut fires only on the former;
  unknown pages, which is correct against a new hub and merely a few wasted
  round trips against an old one. Those are bounded by a stall guard rather
  than by the page cap: the keyset uses a strict `>`, so a hub honouring the
  cursor can never return a page ending on the key just sent, and one that
  does is ignoring it.
  Backstop for the feature whose author forgets to gate it: an unrouted path
  answers with exactly `"Not Found"` (the non-HTML branch of the SPA
  fallback), distinguishable from a handler's own 404, and `checkResponse`
  turns that into "this hub is running an older version" instead of a bare
  `Not Found`. Desktop still discards the field —
  [client-parity.md](client-parity.md).
  Alongside it, `openapi.yaml`'s `HubInfo` schema was corrected (it still
  described a `hub_name`/`require_invite` shape the hub has not served in a
  long time) and the deleted `/voice/ws` endpoint removed from the spec —
  voice v2 deleted it, and `POST /bots/{id}/voice/join` returns `ws_url:
  "/ws"`, not the `voice_ws_url` the spec claimed.

- **Declared minimum PostgreSQL, enforced before migrations
  (2026-08-09)**: the hub ran its own schema migrations with no idea what
  server it was pointed at. Below the floor, migrations failed partway
  through and the operator got a `CREATE TABLE` syntax error and a
  half-applied schema instead of a sentence saying their PostgreSQL is too
  old. `db/version.rs` now declares **PostgreSQL 14** and checks
  `server_version_num` on both entry points (the `migrate` subcommand and
  server startup). The comparison and the message are a pure function so
  they are testable without a server of every vintage; the message renders
  both versions humanly (`160004` → `"16.4"`) and names the remedy. CI runs
  the test matrix against `14-alpine` as well as `16-alpine` — testing only
  the newest would leave "we support 14" a claim nobody checks, which is
  how the floor stayed undeclared this long. The floor rises only when a
  feature needs it, never on a schedule; the table lives in
  [hosting.md](hosting.md) §Providing PostgreSQL. Also folded the
  hardcoded connection string into one `DEFAULT_DATABASE_URL` — it had five
  copies in hub production code, and it is a superuser credential in
  source. Every caller that falls back to it now says so on stderr:
  silently operating on whatever answers at localhost is the failure mode
  behind the `admin` bug below.

- **`wavvon-hub admin` ignored `WAVVON_DATABASE_URL` (2026-08-09)**: the
  `admin` subcommand resolved its database from the unprefixed
  `DATABASE_URL` only, falling back to the built-in default. On a hub
  configured the documented way every admin subcommand therefore targeted a
  different database, silently — including `admin users set-owner`, the
  ownership bootstrap on a fresh hub, which would report success against a
  database the hub does not use. The identical bug in `migrate` was fixed
  during voice v2; `admin` was missed because each subcommand resolved the
  URL independently — the same duplicated-literal pattern that produced the
  farm/agent env mismatch. Both go through one `cli_database_url()` now.

- **Configurable DB pool + shared env-key contract (2026-08-08)**: the
  PostgreSQL pool was `max_connections(5)` hardcoded in all three server
  binaries with no way to change it; it is now
  `WAVVON_DB_MAX_CONNECTIONS` on the hub and farm (and
  `WAVVON_SEED_DB_MAX_CONNECTIONS` on seed, matching that crate's own env
  convention), documented in the operator guide with the thing that
  actually matters — the sum across every hub sharing one PostgreSQL
  server has to stay under its `max_connections`.
  Alongside it, the names of env keys that cross a process boundary moved
  into a new `wavvon-hub-env` crate shared by hub, farm and agent. That
  fixed three live bugs the literals had been hiding: farm and agent set
  `WAVVON_HUB_HTTP_PORT` and `WAVVON_HUB_DB`, names the hub never reads,
  so spawned hubs ignored their allocated port and bound the default 3000
  (proxy → nothing, second hub → collision) and shared one database; the
  farm's Dockerfile and compose set `WAVVON_FARM_HTTP_PORT`, also unread,
  working only because it matched the default; and the farm needed *two*
  differently-named database vars to start while `docker-compose.farm.yml`
  set neither and defined no database service at all — the documented
  quick start could not boot. Compose now provisions a PostgreSQL service
  with a database each for farm and hub. Guarded by a behavioural test
  that sets every spawnable key and asserts it reaches `Settings` (a
  same-symbol assertion passed even with the bug reintroduced; this one
  fails). Per-hub database provisioning is still unimplemented and now
  logs a warning per spawn instead of looking handled —
  [farm-impl.md](farm-impl.md).

- **Desktop pairing Mechanism A — paired-device E2E (2026-08-08)**: a
  paired desktop account could not read encrypted DMs or unwrap voice
  sender keys. Peers agree on E2E keys against the DH key published
  under the roster pubkey (derived from `Identity` in
  `dm.rs::publish_dh_key`), but a paired device holds only a subkey
  seed, which derives a different scalar — so every shared secret came
  out different, and silently: the symptom is an undecryptable message,
  not an error. The enrolling device now ECIES-wraps its canonical
  X25519 scalar for the claiming subkey (same `wrap_blob_key` primitive
  `wrapped_blob_key_hex` already used) and the claiming device unwraps it
  into `paired_identity.json`. **No new wire format** — the hub, the
  `identity` crate and `packages/core` had carried `wrapped_dh_seed_hex`
  since web shipped this; only desktop's mirror lagged. Consumption goes
  through one chokepoint, `Identity::e2e_dh_secret()`, rather than the
  nine call sites across `dm.rs`/`voice_keys.rs`/`ws.rs` — with a silent
  failure mode, per-site correctness is the wrong thing to have to
  remember. Degrades rather than fails: an older enroller or any
  wrap/unwrap error leaves the device fully working for messages,
  membership, roles and bans (all token-based) with no E2E, exactly as
  before. Four tests pin the crypto properties (the unwrapped scalar
  reproduces the published DH pubkey — which catches wrapping the
  Ed25519 seed instead of the X25519 scalar; paired and enrolling devices
  agree on a third party's shared secret; a subkey-derived scalar
  demonstrably does not). **Not yet live-driven** — a real desktop↔web
  pairing is still the standing ROADMAP item. Clients `ba7b41b`.

- **List pagination + endpoint dedup + desktop WS/whisper parity
  (2026-08-08)**: three related cleanups.
  **Pagination** — `GET /users` dropped its hardcoded `LIMIT 50` (member
  lists silently truncated above 50) for `limit` (default 200, max 500)
  plus a keyset `cursor` on `(display_name, public_key)`, collapsing two
  near-identical SQL branches into one predicate-switched query. Both
  clients then gained an actual page walk — web's `fetchAllUsers()`
  behind the eight inline `/users` fetches, desktop's inside its single
  `list_users` command — because a raised cap that still truncates
  silently is the same bug at a larger number, and the sidebar wants the
  whole roster. Also fixed while in there: the `q` cap truncated with
  `&s[..64]`, a *byte* index, so a search of 22+ three-byte characters
  (`€`, most CJK) panicked the handler outright — reachable by typing, in
  a hub that ships in four locales;
  `GET /conversations/{id}/messages` took **no query params at all** and
  returned entire DM history on every open, while both clients had been
  sending `before`/`limit` all along — now honoured;
  `GET /admin/reports` gained the same. Pinned by `list_pagination_flow.rs`
  (cursor walk with no gaps or repeats, clamping, search+limit composition,
  DM backward paging, membership still enforced).
  **Endpoint dedup** — channel bans existed as two route families over one
  `channel_bans` table with different permission gates and field names, and
  the `/channels/...` one hardcoded `reason = NULL` on insert, so a ban
  placed with a reason lost it the moment anyone re-banned through the
  other door; unified onto `/channels/{id}/bans` with `reason` preserved
  (`channel_ban_round_trips_reason`). `GET /channels/{id}/members` was
  deleted — it ignored its `channel_id` and returned the same rows as
  `/users`; its only caller was ttt-bot, repointed to `/users?q=`.
  **Desktop parity** — the real find: desktop's WS enum ended in
  `#[serde(other)] Other` handled as `Other => {}`, so every unmodelled hub
  event vanished silently. Four had piled up behind it (`hub_updated`,
  `channels_updated`, `member_updated`, `soundboard_played`); all four are
  handled now and the fallthrough **logs the unhandled type** so the next
  one cannot hide. Whisper reached parity by hoisting rather than porting:
  `useWhisperKeybinds`, the inbox reducer, and `useSoundboardChips` were
  platform-free web-app-local code and moved to `packages/ui`, so desktop
  got keybinds, reply bind, inbox and chips from the shared copies; opt-out
  rides the existing `send_hub_ws_raw_to` and re-sends on reconnect beside
  presence. Desktop's 193-line `ChannelAppearanceModal` was deleted (it
  duplicated, worse, a tab of the shared `ChannelSettingsModal` the same
  menu already opened), along with an orphaned hand-rolled `svgSanitize`.

- **Member name colors (2026-08-07)**: colored nicknames in the message
  stream and member list, from two sources — role color and a new
  `users.name_color` profile field (PATCH `/me`, validated like
  `accent_color`) — with a hub-owner `hub_settings` key
  `name_color_mode` choosing the policy (`user_over_role`,
  `role_over_user` default, `role_only`, `user_only`, `none`). The
  null-cascade is resolved server-side once and shipped as a single
  resolved `name_color` in roster/profile payloads and the
  `member_updated` WS push; clients sanitize (`safeRoleColor`) and
  render via a `color-mix` blend toward the theme text. Pinned by
  `name_colors_flow.rs` (9 tests) + a live Playwright drive (role
  color, colored message sender, mode flip via the real admin UI,
  profile color after the flip). Design: decisions.md 2026-08-07.
  Server `c49ba32`, clients `31ce9f3`.

- **Voice transport v2 — WebTransport + E2E encryption (2026-08-07)**:
  one QUIC/WebTransport transport for web + desktop replacing BOTH the
  raw-UDP relay (VXRG/VXRA) and the `/voice/ws` WS relay; per-packet
  E2E AES-256-GCM under per-sender keys (X25519 static-static wrap,
  `wavvon/voice-key/v1`) distributed over the previously-unwired
  `voice_key_offer/received/request` signaling — the hub relay
  forwards headers only and cannot listen. Rotating self-signed ECDSA
  cert + `serverCertificateHashes`; canonical vectors pinned across
  identity crate / packages-core TS / desktop Rust. Folded-in fixes:
  farm/agent per-hub voice port at spawn (second hub on a box crashed
  at bind), `can_speak_voice` + mini-app gates re-enforced on unified
  voice_join, desktop `:3001` hardcode removed. The live two-browser
  drive (bidirectional, zero drops) caught four bugs every unit suite
  missed: web's opusscript needed a Node `Buffer` polyfill (web voice
  SEND was silently broken since before v2), `voice_joined` carried no
  sender_id, the web session ref was set after `start()` (early E2E
  keys dropped), WT cert persistence raced across processes, and
  `wavvon-hub migrate` ignored `WAVVON_DATABASE_URL`. Design:
  [voice-transport-v2.md](voice-transport-v2.md). Known ceiling:
  paired-desktop devices can't unwrap voice/DM keys yet
  ([client-parity.md](client-parity.md)). Server `3d49c11`, clients
  `2ab799e`.

- **AFK channel (2026-08-04)**: Discord/TeamSpeak-style auto-move of
  idle voice users ([afk-channel.md](afk-channel.md)). Hub owner picks
  an AFK channel + timeout in Hub admin → Overview (two `hub_settings`
  keys via `PATCH /hub`); a 30s `afk_worker` stamps activity from
  `voice_speaking` messages and pushes idle participants the existing
  `voice_move` message with `auto: true` — no new wire messages, no
  client push handling; clients only gained the settings UI. Pinned by
  `afk_flow.rs` (settings round-trip, rejections, moved-once, skip
  rules, speaking refresh). Server `efbef96`, clients `cc198c7`.

- **Desktop DM send path upgraded to DR v2 (2026-07-27)**: the last
  DM-crypto parity gap — desktop's 1:1 send used the legacy v1
  static-static scheme. It now `init_dr_session`s (idempotent; a
  responder-inited session is reused) and sends the same v2 envelopes
  web sends; the dead v1 `encrypt_dm` command was removed (v1 decrypt
  stays for old history). A reverse cross-language vector (Rust
  initiator → TS responder) completes the interop triangle. Clients
  `fef2ca3`.

- **Desktop DR receive side wired (2026-07-27)**: desktop could never
  decrypt an inbound DR v2 DM in a conversation it hadn't sent in
  first (`init_dr_session` existed but nothing called it; the decrypt
  hard-failed on a missing session) — every web→desktop encrypted DM
  rendered "[decryption failed]". `decrypt_dm_dr_inner` now
  responder-inits a missing session from the envelope's ratchet key +
  the sender's published DH key (fetched in `get_dm_messages` only
  when no session exists; failed decrypts never persist state).
  Pinned by a chain-equality unit test and a cross-language vector
  (packages/core TS-initiator envelope decrypted by the Rust
  responder). Desktop still *sends* v1 — tracked in ROADMAP. Clients
  `9a60076`.

- **Desktop DM parity fixes (2026-07-27)**: the mirror forms of two of
  the web DM bugs, fixed the same way (clients `e38e861`) —
  `publish_dh_key` ran only once at startup, so hubs joined mid-session
  never got the DH key until an app restart (now invoked after add-hub
  and create-hub-wizard joins); and `get_dm_messages` DR-decrypted our
  own outbound envelopes (guaranteed "[decryption failed]" on history
  reload) — `send_dm` now stashes the plaintext per message id in the
  per-account store and the read path uses it for own encrypted +
  group messages. The desktop DR *receive* side (no responder init
  ever wired) is a recorded gap in client-parity.md, for the next
  desktop pass.

- **DM liveness bug chain + web `useDms` extraction (2026-07-26)**:
  second App.tsx hook-extraction slice (`useDms`, mirrors desktop's)
  plus the first-ever DM e2e (`e2e/live/57`, two clients), which
  surfaced four real pre-existing bugs, all fixed. Hub (server
  `2f9e992`): `create_conversation` now announces itself via
  `dm_member_changed`, and each WS connection keeps its connect-time
  `my_conversations` snapshot live from MemberChanged events — before
  this, a conversation created after a client connected was dead air
  until reconnect (new `dm_live_membership_flow` test). Web (clients
  `e3d45f7`): the WelcomeScreen first-join path now calls
  `publishDhKey` like every other join path (a first-run user
  otherwise had no DH key → plaintext fallback + undecryptable sends);
  own sent messages now render (reload-after-send + per-message own-
  plaintext stash — a ratchet can't decrypt its own envelopes);
  `onDmMemberChanged` upserts new conversations and drops removed
  ones. Core: `decryptDmDr`'s responder-init was gated on `ckr ==
  null`, which also matches an *initiator* awaiting the first reply —
  the reply got hijacked into a bogus re-init and never decrypted;
  init now runs only for an empty session (matches the desktop Rust
  impl; new two-way DR unit test).

- **Web `useScreenShare` extraction (2026-07-26)**: first slice of the
  App.tsx hook-extraction effort (ROADMAP Next up) — outbound share
  session, viewer state, cross-channel hub-streams discovery, their WS
  arms, and the unmount teardown moved from `App.tsx` into
  `hooks/useScreenShare.ts`, behavior unchanged (e2e/live/15 + 26
  green). App.tsx 3646 → 3556 lines. Clients `41e4b91`.

- **Channel-description editing wired on web (2026-07-26)**: the
  header's "Add a description" affordance called a no-op
  `onOpenEditDescription` on web (parity note since the orchestrators
  pass) — desktop's `EditDescriptionModal` hoisted unchanged into
  packages/ui and wired on web with a `PATCH /channels/{id}` save
  (empty clears). `e2e/live/56` drives add → edit from the header.
  Clients `0a1700e`.

- **PinnedMessages union pass (2026-07-26)**: the last feature-diverged
  app-local component pair is one shared `PinnedMessagesModal` in
  packages/ui — web's FocusTrap/Escape/aria modal shell + desktop's
  admin Unpin and pinned-by metadata, data access via
  `getPins`/`unpinMessage` callback props. Also fixed a real web bug:
  web's flat `PinnedMessage` type never matched the hub's `PinResponse`
  (nested `message` object), so the modal crashed on any real pin. New
  `e2e/live/55` drives pin → modal render → unpin against a real hub.
  Only `App` and the `MicLevelMeter` false twin remain app-local.
  Clients `5918873`.

- **Whisper reply key (2026-07-26)**: the whisper.md deferred "whisper
  reply" item — a dedicated reply key (a *different* button from any
  per-list bind, user ruling), bound from a Reply key row in the
  whisper panel with hold/toggle mode, whispers back at the most
  recent inbound whisperer; falls back to the latest inbox entry so
  replying works after the whisper ended. Per-account persistence;
  panel row hidden on clients that don't wire it (desktop). Pure
  `pickReplyPubkey` unit-tested; e2e drives owner-whisper → held-key
  reply → owner sees the indicator. Clients `b798a27`.

- **Whisper Roles tab (2026-07-26)**: the hub resolved role-type
  whisper targets since whisper round 1, but the panel had no way to
  pick one — new Roles tab in the shared `WhisperPanel`, lazy-loaded
  behind an optional `onListWhisperRoles` prop (hidden when absent, so
  desktop is unaffected); web wires `listRoles`. e2e/live/21 drives a
  real role-target whisper (role created + assigned via API, whisper
  started from the Roles tab, role member sees the indicator). Whisper
  target types are now all reachable from the UI: user, channel, role,
  saved lists. Clients `3d23da1`.

- **Voice-event resilience (2026-07-26)**: the two gaps recorded during
  the roster-bug hunt, closed same day. Hub: the main-WS voice-event
  arm now handles broadcast `Lagged` like the chat arm (warn + push the
  `lagged` resync message — was silently dropped, making a missed
  Joined permanent), and `/voice/ws` joins now broadcast a
  `VoiceRosterUpdate` like the UDP path (sender_id map + heals missed
  Joined events); new flow test
  `voice_ws_join_broadcasts_roster_update`. Web: `lagged` gets a
  dedicated `onLagged` handler resyncing channels + users + voice
  roster (previously channels only). Server `454259a`, clients
  `35ba88d`.

- **Voice-roster presence bug + whisper e2e coverage (2026-07-26)**: a
  member whose `/users` refetch snapshot raced their presence
  registration was stamped offline forever, and web's
  `visibleParticipants` filter then hid their **live voice presence**
  from the sidebar and whisper panel (intermittent "user is in voice
  but nobody sees them"). The filter existed to avoid outing invisible
  users, but the hub has been authoritative for that since 2026-07-12
  (invisible members omitted from ready frames, join/leave broadcasts,
  rosters; mid-call toggle emits Left) — deleted it, raw
  `voicePartByChannel` everywhere, and the `member_online` refetch now
  stamps the triggering member online. Found (after unit suites and
  the hub both checked out clean) by driving the real app; the hunt is
  the 2026-07-20 lesson repeating. e2e/live/21 extended to cover
  whisper round 2: inbox persistence, opt-out + mid-session opt-back-in
  (exercises the re-resolution diff live), hold-mode keybind, plus a
  roster-sync regression guard. Clients `6b00a7a`.

- **Known-issue sweep (2026-07-26)**: two ROADMAP known issues closed.
  **Whisper re-resolution diffing** — `re_resolve_whisper_sessions` now
  diffs old vs new target pubkey sets and pushes `voice_whisper_started`
  to added / `voice_whisper_stopped` to dropped recipients on every
  trigger (voice join, leave, opt-out); teardown (whisperer leaves or
  disconnects) notifies its recipients; and `leave_voice` itself now
  re-resolves, covering a recipient dropping via raw WS disconnect —
  a sub-gap found during the fix. 5 new hub flow tests. Server
  `e73f7a7`. **Store-crate dead scaffolding** — never-called `Migrate`
  trait + its drifted 650-line DDL duplicate deleted from
  `crates/store` (found 2026-07-20; the "second recovery schema" was
  in fact a full-schema copy). Deletion only, −684 lines. Server
  `247d524`.

- **Whisper round 2 (2026-07-26)**: three whisper UX additions, web-first
  ([whisper.md](whisper.md); rationale in decisions.md same date).
  **Whisper inbox** — inbound whispers land in a persistent overlay
  ("is whispering" → "whispered you" + time) until dismissed, covering
  the deferred history-indicator item. **Per-list keybinds** — the
  dormant `WhisperList.keybind` field is now real, bound from the Saved
  Lists tab, with per-list Hold (PTT-style) or Toggle mode; in-app keys,
  same scope as web push-to-talk. **Receive opt-out** — hub-enforced
  `voice_whisper_optout` WS message; opted-out pubkeys are excluded from
  all target resolution incl. live re-resolution, pref persisted
  per-account and re-sent on reconnect, checkbox in the whisper panel.
  Hub integration test `whisper_optout_flow.rs`; web vitest for the
  inbox reducer. Desktop gaps recorded in
  [client-parity.md](client-parity.md). Server `c77ff7a`, clients
  `9513858`. Known issue found during the work: re-resolution pushes no
  started/stopped diff notifications (ROADMAP).

- **Forum post tags (2026-07-21)**: admin-curated per-channel tag
  definitions ([forum.md](forum.md) §10) — `forum_tags` + `post_tags`
  join, CRUD gated on `manage_posts`, ≤5 tags per post assigned by the
  author (moderator retag = triage), single-tag list filter, optional
  per-channel require-tag flag, tags pass through alliance reads
  (owner-sovereign, no federated assignment). UI: chips on rows,
  filter bar, composer/edit picker, `ForumTagManager` in channel
  settings. Full desktop parity (new Tauri tag commands). Driving use
  case: community bug/feature-request tracker; a triage bot needs no
  new API (polls REST, retags via `manage_posts` role). 12 hub flow
  tests. Server `a03176c`, clients `6097b37`. **E2E-verified same day**
  driving the real web app against a live hub: tag CRUD in channel
  settings, require-tag blocking untagged posts, chips, filter bar
  (positive + negative). The drive caught and fixed two real client
  bugs the suites missed: the birthday month select never sticking
  (clients `1712b3b`) and — pre-existing since forum v1 — web calling
  bare `/posts/{pid}` routes the hub never registered, so opening any
  forum post on web 404ed (clients `488ac0a`; desktop was always
  correct).

- **Hub timezone + birthday badge (2026-07-21)**: hub-local clock
  (admin-set IANA `hub_timezone` in hub_settings, ☀️/🌙 `HubClock` in
  the channel sidebar via `Intl.DateTimeFormat`, no new deps) and an
  opt-in `MM-DD` birthday (never a year) on the member profile with a
  🎂 badge in member list + message rows on the viewer's local calendar
  day. Triple opt-in enforced per layer: field-set = user consent,
  `birthdays_enabled` hub setting gates every member-facing payload
  server-side, `hideBirthdays` viewer pref. 9 hub integration tests
  incl. roster gating. Announcement-message variant deferred
  (ROADMAP wishlist). Server `cb7e79c`, clients `66deab5`. Design:
  decisions.md 2026-07-21. **E2E-verified same day** on the real web
  app: admin timezone dropdown → ☀️ Tokyo clock in the sidebar; profile
  month/day selects → 🎂 in the member list. The drive found the month
  select never sticking (composeBirthday collapsed month-without-day
  to ""); fixed in clients `1712b3b`.

- **Parity-gap ledger closed + orchestrators hoisted (2026-07-20)**:
  every tracked capability gap from client-parity.md resolved in three
  waves. Desktop gained: working inline polls (route fix), message
  reporting, role categories, spawner naming, full events incl.
  organizer staging, **soundboard playback** (Ogg-Opus demux + mixing
  into the outbound stream post-denoise, no new deps), banner file
  upload, own-profile editing, quick invite, per-account local-store
  isolation (+ a voice-session leak on account switch fixed). Web
  gained camera device selection and alliance push-invite/share-code.
  Final orchestrators hoisted: `ChannelMessageList`, `DmView` (group-DM
  E2E ack kept desktop-side via optional prop), and `ContentArea` as a
  full hoist (~90% identical shell; thin per-app action wrappers);
  hub-streams entry consolidated to the ChannelHeader button. 59 of 61
  audited duplicates now shared; remainder by design (App,
  PinnedMessages pair, one false twin). Clients `3088346`, `cf6b39d`,
  `278fafe`.

- **Recovery-contact attestation — end to end (2026-07-20)**: the
  rotation-vouch flow works for the first time. The hub was counting
  attestation signatures **without verifying them** (threshold
  fabricatable from public contact pubkeys); it now verifies Ed25519
  over the new `recovery-attestation/v1` envelope, requires a new-key
  proof (`recovery-request/v1`) to open a request, exposes the split
  GET/attest routes, and expires pending requests after 14 days
  (decisions.md 2026-07-20). Wire encoding asserted byte-identical in
  server Rust, desktop Rust, and TS with shared vectors.
  `RecoveryContactsSection` unioned + hoisted with requester progress
  and contact review card; desktop's swapped old/new pubkeys in
  rotation requests fixed. Server `4240377`, clients `cf6b39d`. Design:
  [recovery-attestation.md](recovery-attestation.md).

- **Settings IA: desktop multi-account, cross-platform backup, shared
  Settings shell (2026-07-20)**: implements
  [settings-ia.md](settings-ia.md) (three user decisions, same day).
  Desktop gained multi-account (`~/.wavvon` per-account dirs + registry,
  switcher with guarded in-place remount, purge-on-remove). One
  `.wavvon-backup` format (Argon2id + AES-256-GCM, one account per
  file) implemented in both TS and Rust with a shared test vector
  asserted byte-identical; `.voxback` + web's PBKDF2 envelope retired.
  Both clients render the shared `SettingsShell` (8 tabs / 3 groups,
  incl. a unified Notifications tab); desktop's deleted-model profile
  pool removed. Closes the `ProfileTab` + `IdentityBackupSection`
  parity items. Clients `2cae216`.

- **Client feature-union parity passes (2026-07-20)**: the three
  components skipped by the mechanical consolidation as bidirectional
  forks — `HubAdminPage`, `ChannelSettingsModal`, `ChannelSidebar` —
  unified on the union of both clients' features and hoisted into
  `packages/ui` (user decision: no shipped capability drops). Desktop
  gained: permissions/bans tabs, richer invites, working audit log
  (old copy read a shape the hub never sends), voice-move, drill-in +
  spawner sidebar, TTL+Invisible presence (custom-text UI removed per
  the 2026-07-12 decision). Web gained: talk-power tab, SVG channel
  icons, public-listing toggle, member mute/timeout/voice-mute, a
  cert_mode fix (old enum could 400 the hub), hub-icon picker (prop
  existed, never rendered). Remaining gaps tracked in the
  client-parity.md ledger. Clients `54a04c1`.

- **Shared-component consolidation — mechanical phase complete
  (2026-07-20)**: 41 of the 53 remaining duplicated components hoisted
  into `packages/ui` as single prop-only implementations consumed by
  both apps (web = source of truth, decisions.md 2026-07-18); both app
  copies deleted; `packages/ui` gained a vitest runner (90 tests).
  Desktop gained forum edit/delete/reactions (+8 Tauri commands),
  the full events UI, working poll creation and lobby PoW (both were
  broken), message context menu, spawner channels; web gained farm
  Servers/Security tabs, hub notification-mode menu, user context
  actions, and a hub custom-emoji rendering fix. 12 components remain
  app-local pending real parity passes — skip list + follow-up ledger
  in [client-parity.md](client-parity.md). Clients `8500c63`.

- **Bot channel-scope readback + test-pool starvation fix
  (2026-07-20)**: `GET /admin/bots/:pubkey/channels` (mirror of the
  PUT) and the admin editor now pre-populates saved scope on open.
  The `event_slots_flow` full-suite flake root-caused to per-test
  pools starving each other (dozens of 5-connection pools, 30s acquire
  timeout) — harness now uses 3 connections/60s; 71 suites green under
  full load. Server `e1e9cae`, clients `c2eba95`.

- **Admin external-bot panel wired to real routes (2026-07-19)**: the
  panel called routes that never existed (found by the live ttt run).
  Hub gained `GET /admin/bots/external` (management list incl.
  pending/removed + local note) and `PUT /admin/bots/:pubkey/channels`
  (first writer of the pre-existing `bot_channel_scope` table, bots.md
  §14); invite/remove repointed at the working `/bots` routes; the
  invite `note` field now actually persists. 33/33 bots tests, web
  291/291. Server `d7939e5`, clients `300aa0d`.

- **Invisible presence gaps closed (2026-07-19)**: voice surfaces now
  respect presence visibility — viewer-aware participant lists/rosters,
  gated Joined/Left/Speaking broadcasts, mid-call invisible-toggle
  handling, and gated `/voice/participants`, `/voice/active-users`,
  `/voice/populations` (server-side, so nothing leaks on the wire);
  the user's own roster row now shows a distinct invisible state with
  a tooltip instead of plain offline. Hub integration test in
  `voice_relay_flow.rs`. Server `2714c41`, clients `fc90c04`.

- **Tic-tac-toe demo bot: first live run, passing (2026-07-19)**: new
  live e2e `54-ttt-game.spec.ts` — two browser contexts play a full
  game through the bot's modal against a live hub, 3/3 green. The run
  earned its keep: found and fixed (1) external bots 403'd by the human
  invite-code gate on every default `invite_only` hub — the whole
  documented bot flow was broken by default (server, regression-tested),
  (2) board buttons clickable before first state (ttt-bot), (3) stale
  Play CTA lingering after the result embed (web). Also exposed the
  dead admin external-bot panel (new known issue). Server `d2d6cb5`,
  clients `c77d1e6`.

- **Web: Settings account list refreshes mid-session (2026-07-19)**:
  known issue closed — `identity/store.ts` gained a subscribe/notify
  hook fired from the three roster mutation points (all add paths
  funnel through `saveIdentity`); `SettingsPage` subscribes and
  refetches. Clients `9771880`. Confirmed still green 2026-07-19
  evening (287/287).

- **Web: account-switch e2e deflaked (2026-07-19)**: known issue closed
  — the parallel-worker timing race fixed in clients `2d93ad4`;
  verified with the mocked e2e suite at 3× repeat under default
  parallel workers, 30/30 green.

- **Gaming Phase 3 first slice: bot-kit lobby module (2026-07-19)**:
  new `crates/bot-kit` — `Lobby<S>` roster/liveness registry
  (hello/bye/ping convention, injectable-clock timeout eviction,
  reconnect dedup) + `broadcast`/`send_to` over `mini_app_message`;
  ttt-bot refactored onto it as regression proof (board tests
  untouched); zero hub surface added. Server `9c9ce24`.

- **Gaming Phase 4 first slice: directory Play badge (2026-07-19)**:
  bots self-declare a `game` descriptor on `bot_profiles` (same
  plumbing as `mini_app_url`), surfaced on `GET /bots`; web bot cards
  render a Play button launching through the existing `bot_app_join`
  path. Drive-by fix: the bot card's profile fetch hit a nonexistent
  route and 405'd on every open — now sourced from the directory list.
  Server `549e9fb`, clients `ae82eb7` (+`761416b` capability note).

- **Gaming + rich bots Phase 2: video/canvas grants (2026-07-19)**:
  `can_inject_video` gated at `screen_share_start` for bots (effective
  resolver + `WAVVON_BOTS_ALLOW_VIDEO` operator flag + READ_MESSAGES +
  hub-wide concurrent bot-video budget, default 2 via
  `WAVVON_BOT_VIDEO_STREAM_BUDGET`); human path untouched; admin panel
  card notes the flag. Budget is coarse hub-wide (`ponytail:` marked).
  Server `684bc97`, clients `761416b`.

- **Forum federation phases 2–3: proxied writes + retraction
  (2026-07-19)**: alliance-shared forum channels accept remote writes
  per a per-share `forum_remote_write` policy (`none`/`replies_only`/
  `posts_and_replies`, default `replies_only`) with `author_hub`
  attribution and a per-origin-hub rate limiter; origin hubs can
  retract their own users' content (double author_hub + author_pubkey
  check, local tombstone semantics); pin/lock stay owner-only. Web
  alliance forum view un-gates reply/react/compose per policy and
  renders a via-hub author suffix. Deferred tail documented in
  forum.md §9. Server `bdb8083`+`b2d7d46`, clients `be9bdbe`.

- **Farm: agent-hosted hub restart (2026-07-19)**: new agent WS
  `restart_hub` command (stop-if-running then spawn); the force-restart
  route and the supervision monitor both delegate to the owning agent
  for `server_id` hubs (503 `agent_offline` when disconnected), same
  backoff/give-up logic as farm-local. Fire-and-forget like spawn
  delegation (200 = enqueued). Server `75edcd0`.

- **Web: account-scoped custom themes (2026-07-19)**: the theme library
  (+active selection) moved from device-global localStorage into the
  per-account scoped store — exports no longer leak other accounts'
  themes and restores land account-isolated (themes were the one
  restored field bypassing `setScoped`). No migration for the old
  global key per the alpha no-backcompat rule. Long-term home remains
  the prefs blob (custom-themes.md). Clients `ef738f6`.

- **Web: §7.4 voice-only-presence e2e (2026-07-19)**:
  `e2e/live/53-voice-only-presence.spec.ts` (Wavvon-clients) closes the
  last events.md §7.4 gap — both halves (hub `staging_voice_grants`
  bypass, web's `target_channel_name` HUD hint) already existed; only the
  browser assertion was missing. Along the way, corrected a stale
  2026-07-18 events.md note claiming the general `/voice/ws` read gate
  was missing (it now covers plain human joins, not just bots/spawners)
  and documented a previously-uncalled-out rule the test surfaced: the
  event-less Phase-1 right-click move rejects a move into an unreadable
  channel outright rather than granting voice-only presence — only an
  event-scoped staging-panel move can trigger §7.4, and since every
  staged claimant/RSVP already holds `status = 'going'`, that move is
  always `auto: true` (never the blocking accept/decline prompt).
  Ran live against a fresh `wavvon_e2e` DB: suites 48, 49, 53 all pass.
  Clients `e4a0a76`.

- **Farm: hub lifecycle supervision (2026-07-19)**: a monitor task
  auto-restarts farm-local hubs offline >180s (exponential backoff
  10s·2^n capped 5min, gives up + disables after 5 attempts, heartbeat
  resets the counter); additive `hubs` columns + fleet-endpoint
  visibility; admin `POST /farm/hubs/{id}/restart`. Audit dividend: farm
  SSO and serial routing turned out already shipped and tested — the
  ROADMAP "lifecycle/SSO" entry was half stale. Agent-hosted restart
  deferred (agent WS protocol lacks a restart command). Server `d583e3e`.

- **Gaming + rich bots Phase 1 (2026-07-19)**: the full
  bot-capability-layer.md Phase 1 slice — `bot_capability_grants` +
  `effective_capabilities()` resolver, admin grant/readback routes with
  `capabilities_changed` push, `can_use_interactive_ui`-gated game modal,
  hardened scoped tokens, `game` launch cards on messages, and the §7
  tic-tac-toe demo bot (`crates/ttt-bot`: launch card, WS-relay moves,
  result PATCH, embedded mini-app page). Building the demo exposed and
  fixed three hub gaps: bot-authored `embeds` on PATCH, external-bot
  `mini_app_url` registration, and the `mini_app_message` opaque relay
  envelope (now documented in bot-mini-apps.md). Full server workspace
  suite green (95 suites). Server `1df3971`+`7db2da8`+`86e62a6`,
  clients `22aa2b7`. Live two-browser game still pending (known issue).

- **Web: LAN hub fingerprint verification (2026-07-19)**: invites can
  carry `?fp=`/`#fp=` (SHA-256 of the LAN hub's self-signed cert DER,
  already exposed as `/info` `lan_fingerprint`); one shared
  `verifyLanFingerprint` helper gates both the AddHubModal and first-run
  WelcomeScreen joins, blocking on mismatch. The rest of lan-mode §5–§6
  client work (mDNS discovery, QR scan, TLS pinning) is
  browser-impossible and stays desktop-era. Clients `2f58602`.

- **Web: events calendar month view (2026-07-19)**: Month/List toggle in
  `EventsPanel` rendering the already-fetched, read-gated event set on a
  native-`Date` 6×7 grid (events.md §9; no date library, no server
  change); day selection filters the card list; `getEvents` gained
  optional `upcoming`/`limit` params. Prop-only `EventCalendar` +
  pure `calendar.ts` helpers, hoistable to `packages/ui`. 270/270 web
  tests. Clients `3d05a1a`.

- **Web: game-emoji row in the Activities editor (2026-07-19)**: the
  "game icons in Activities" wishlist item, shipped as a curated
  game-emoji row inserting at the cursor's line start (decisions.md —
  emoji over a game catalog; no schema/server/renderer change).
  Clients `c9b94d0`.

- **Web: data export decrypts the hub-synced prefs blob (2026-07-19)**:
  `SignedPrefsBlob` verify + HKDF/AES-256-GCM decrypt ported to
  `packages/core` with cross-language test vectors pinned from the Rust
  identity crate; the archive's prefs section now carries decrypted
  blocked users + voice settings (gap_note remains only for paired
  devices, which hold no local entropy). Bonus fix: designation/
  device-cert/revocation fetches now use the derived master pubkey
  instead of the device pubkey. Core 92/92, web 261/261. Clients
  `276d86d`.

- **Forum post federation, read slice (2026-07-19)**: forum.md §9
  phase 1 complete — alliance-shared forum channels are readable
  cross-hub via a read-through proxy (`/alliances/:id/channels/:cid/
  posts[/:id]`) backed by `FederationClient::get_forum_posts/get_forum_post`;
  web renders them read-only through `ForumView` with alliance context.
  Two-hub integration tests (happy path + unshared-channel rejection) in
  `forum_flow.rs`; web command tests in `allianceForumRead.test.ts`.
  Phases 2 (proxied writes) and 3 (retraction/moderation) remain
  designed-not-built. Server `e424760`, clients `6e88c02`.

- **Desktop: `npm run dev` launches the full Tauri shell (2026-07-19)**:
  the script only started Vite (no Tauri window), tripping people up
  expecting the real dev experience. `dev` now runs `tauri dev`; the
  Vite-only variant moved to `dev:web`, which `tauri.conf.json`'s
  `beforeDevCommand` now invokes to avoid recursion. Clients `4d727df`.

- **Desktop: registered missing `get_pending_deep_link` command
  (2026-07-19)**: the frontend called a Tauri command the Rust shell
  never registered, causing an unhandled rejection on every startup. No
  OS-level `wavvon://` scheme registration exists anywhere yet (no
  `tauri-plugin-deep-link`, installer/registry/Info.plist/desktop-file
  entry), so real deep-link capture is unimplemented — the command is a
  stub returning null, just removing the startup error. Clients `c4794e6`.

- **Clients: shared-component consolidation batch 2 — CreateHubWizard
  (2026-07-19)**: the farm-based create-hub wizard hoisted from both
  apps into one prop-only `packages/ui` component (more platform-coupled
  than batch 1, so `probeFarm`/`getFarmHubQuota`/`createHubOnFarm`/
  `addHub` became callback props — web passes the `@platform` functions,
  desktop passes `invoke()` adapters; `WsHandlers` stays out of
  packages/ui via web's onAddHub closure). Farm types hoisted; both app
  copies deleted. Reconciliation dividend: desktop's `friendlyJoinError`
  became a shared `joinErrorKey()` now applied on both platforms — web
  previously surfaced raw error strings. Typecheck clean both apps; web
  245/245, desktop 80/80. Clients `0b45802`.

- **Web: encrypted backup download offered at identity creation
  (2026-07-19)**: with PRF removed, the recovery story is phrase +
  `.wavvon-backup` file + pairing, but the file export lived only in
  Settings. The creation "generated" step (where the 24 words show) now
  also offers an optional "Download encrypted backup" (passphrase +
  confirm, shared strength meter) producing the just-created account's
  `.wavvon-backup`; the user can still continue with only the phrase.
  Refactor dividend: `encryptBackup` + `passphraseStrength` extracted to
  shared utils, killing a third duplicate strength meter in
  FullArchiveSection; envelope bytes unchanged (round-trip test). Verified
  live in headless Chromium (affordance renders, download yields a valid
  v2 envelope, Continue still works). Clients `16115fa`.

- **Hub + web: staging panel voice-only hint chip (2026-07-19)**: the
  events.md §7.5 chip the panel couldn't show at Phase-2 time (a client
  can't see another member's channel perms). `GET /events/:id/assignments`
  entries gain a hub-computed `voice_only: bool` (`!READ_MESSAGES` on the
  assignment's target channel, per-row resolve — raid-sized bounded
  list); the web staging panel folds it into the existing
  `ClaimantVoiceStatus` and renders a warning-toned chip (label + tooltip
  localized ×4). Hub `dabdd51`, clients `a98c05d`.

- **Web: live e2e suite deflaked to 76/76 (2026-07-19)**: the 18
  pre-existing failures from the 2026-07-18 first-full-run were all spec
  rot (app moved on, specs didn't) — none product regressions. Fixed
  spec-side: the removed desktop-era "Join Voice" button → voice-channel
  double-click (7 specs, plus adjacent camera/screen-share selector
  drift), the settings-IA restructure (5 specs, incl. selecting the
  joined hub before propagation edits since the default-profile context
  is local-only), namespaced-localStorage reads (2), a hardcoded past
  event date, and an alliance channel-share option-label prefix. Notably
  `10-member-presence`'s "custom status text" case tested a field
  deliberately removed from web 2026-07-12 — rewritten to assert DND-dot
  propagation, not to re-add the input (verified live). No product code
  touched, no assertions weakened, no skips. Clients `b5df011`.

- **Hub: /voice/ws read gate closed (2026-07-19)**: the H-series gap
  from the voice-move Phase 2 pass — the web voice transport enforced
  `READ_MESSAGES` only for bots and spawner-channel joins, so a web
  client could join voice in a hidden channel by guessing its id. Now
  one hoisted gate covers every human join (spawner branch's duplicate
  removed), with the `staging_voice_grants` bypass preserved for
  event-context moves. Three transport-specific tests in
  `voice_relay_flow.rs` (rejection regression, happy path, grant
  bypass); full suite green. Hub `360272e`.

- **Web: passkey-PRF identity surface removed (2026-07-19)**: user call
  after the provider-matrix testing below — two of three real providers
  broken (Bitwarden: no third-party PRF anywhere; Windows Hello 25H2:
  create-only), the third (GPM) untested; too little ecosystem to ship
  an identity path on. Removed the create/restore-by-passkey entry
  points, `prfIdentity.ts` + 13 unit tests, the capability probe, and
  11×4 i18n keys; hub-session passkey auth + trusted devices stay;
  `PRF_SALT_LABEL` kept as a pinned protocol constant. First slice to
  use the new branch → squash-merge workflow. Reinstatement notes in
  [webauthn-auth.md](webauthn-auth.md). Clients `9afe8b0`. Web 237/237.

- **Web: passkey PRF identity hardening — refuse-on-unverified
  (2026-07-18)**: one squashed commit (clients `a310f64`) from a live
  owner-testing session across three real providers. The
  create-response is advisory only (providers legitimately answer PRF
  only on assertion — `prfExtensionEnabled` removed); the follow-up
  scoped `get()` is both the **canonical seed source** and a **restore
  self-test that gates creation**: if the passkey can't prove it can
  re-derive the secret, no identity is created
  (`PrfRestoreUnverifiedError`; the stranded vault entry is flagged
  safe to delete; user routed to the recovery-phrase flow — see the
  decisions.md entry "Passkey identity: refuse creation unless restore
  is proven at birth"). Also: realm-safe buffer extraction
  (`ArrayBuffer.isView` instead of cross-realm-fragile `instanceof`)
  and honest provider guidance (Bitwarden named as non-working).
  Provider findings → [webauthn-auth.md](webauthn-auth.md): Bitwarden
  extension serves no third-party PRF on any browser; Windows Hello
  25H2 is create-only (every PRF `get()` fails). 13 prfIdentity unit
  tests; web 250/250.

- **Web: live e2e pass for the events delta + harness revival
  (2026-07-18)**: five new live specs (48-52) drive the shipped
  voice-move/staging/hub-wide/propagation/squad-rooms features with
  real browsers against a hub built from `08d873b` — all five pass
  reliably. The pass surfaced and fixed four real client bugs, chief
  among them `EventRsvp.pubkey` vs the hub's `user_pubkey` (crashed the
  staging panel on any real slot claim — invisible to unit tests), plus
  a stale-slots snapshot (panel now refetches via new `getEvent`), a
  broken composer modal class, and an unbounded move-submenu. Also
  repaired the live harness itself, silently broken for weeks
  (account-naming step, invite-only default, namespaced localStorage) —
  the full suite runs again: 57/76 green, the 18 pre-existing failures
  root-caused and tracked in ROADMAP. Clients `bfce564`.

- **Hub + web: events Phase 3 — hub-wide events, card propagation,
  squad rooms (2026-07-18)**: completes the guild-scale delta
  ([events.md](events.md) §5-§6, §7.5). `hub_wide` (create-time only,
  needs hub-level `CREATE_EVENTS` on top of the anchor gate;
  `list_events`/`get_event` read-gate bypassed for hub-wide rows) and
  `propagate_to_children` (event + reminder cards fan out to the
  anchor's descendants via a BFS subtree walk; one event row, delivery
  gating per channel unchanged — tested). Squad rooms:
  `POST /events/:id/squad-rooms` (count 1-20, prefix default "Squad")
  creates temp voice channels under the anchor with `channels.event_id`
  (nullable, deliberately NO FK — cleanup must distinguish
  empty-delete-now from occupied-never-yank): delete_event cascades by
  hand, the worker sweep deletes empty rooms of ended events, and
  voice-join rejects NEW joins to ended-event rooms while occupants
  drain (user ruling: lifetime tied to the event, never yank an
  occupied room). Web: EventComposer scope control (This channel /
  Whole hub + Announcement-channel relabel), sub-channel propagation
  checkbox (only when the anchor has children), Hub-wide badge, and the
  staging panel's squad-room spawner (rooms arrive via the live
  channels push, event's rooms listed first as destinations). Hub: 12
  new tests across three flow files, full suite green; web 246/246,
  i18n ×4. Hub `08d873b`, clients `1f9d1d0`.

- **Hub + web: voice-move Phase 2 — staging panel, queued assignments,
  voice-only presence (2026-07-18)**: the raid-marshalling core
  ([events.md](events.md) §7.3-§7.5). `event_move_assignments`
  (additive; upsert = latest wins): a move to a target not in voice,
  with an event context, queues instead of erroring, applies on every
  voice join (row not consumed — drop-and-rejoin re-lands in the squad),
  `auto` re-computed from RSVPs at application time (an assignment alone
  is not consent), pruned by the reminder-worker sweep at event end.
  Voice-only presence: in-memory `staging_voice_grants`, created before
  the push when an event-context move targets an unreadable channel,
  consumed only by the voice-join read gate, evicted on leave/disconnect
  — message history/subscribe/channel list stay strict (tested);
  no-event moves to unreadable destinations stay rejected. New
  `GET /events/:id/assignments` (organizer-gated, anchor-scoped). Web:
  "Staging" button on the event card → panel grouping claimants by slot
  (+ Unassigned bucket) with live voice state, per-claimant and bulk
  moves, assignment refetch; prop-only `StagingPanel`/`StagingSlotGroup`
  in `packages/ui`; `events.staging.*` keys ×4 locales. Hub
  `voice_move_flow.rs` at 10 tests, full suite green; web 230/230.
  **Live pass pending** (same as Phase 1). Hub `d0a1a53`, clients
  `77dab02`. Follow-ups → ROADMAP: `/voice/ws` human-join read gate
  (pre-existing, H-series), voice-only hint chip needs server data.

- **Hub + web: voice-move Phase 1 — the move primitive (2026-07-18)**:
  first slice of the events guild-scale delta
  ([events.md](events.md) §7): new channel-scoped `move_members`
  permission; `voice_move` client→hub WS request (mover authorized via
  `channel_permissions` on the destination; Phase-1 guards reject a
  target not in voice or lacking read access to the destination) and a
  targeted-by-pubkey hub→target push carrying
  `target_channel_name`/`source_channel_id`/`auto` — delivered through
  the hub-wide-bypass dispatch arm with an explicit pubkey filter, firmer
  than the WhisperSignal precedent (which rides the subscription gate;
  events.md corrected). Consent per the decisions.md model: `auto` only
  with an RSVP-'going' event context, else the web client prompts
  accept/decline (decline = no-op); auto-moves show a "rejoin previous
  channel" toast. Web UI: right-click a voice participant → "Move to
  channel…" (gated on `move_members`), new prop-only
  `VoiceMoveMenu`/`VoiceMoveToast`/`VoiceMovePromptModal` in
  `packages/ui`, `move_members` in the Roles admin + channel-overwrite
  permission lists, `voice.move.*` keys in all four locales. Hub tests:
  `voice_move_flow.rs` real-WS harness (happy path, auto-via-RSVP, three
  rejections); web 221/221 with 6 new `decideVoiceMove` unit tests.
  **Live pass pending** (real two-client move over a running hub). Hub
  `b78aa67`, clients `50c1dbb`.

- **Clients: shared-component consolidation, batch 1 (2026-07-18)**:
  first slice of the new hoist-from-web policy (see
  [decisions.md](decisions.md)) — `BotAppLaunchCard`, `ImagePicker`,
  `BotCard`, `EmojiPicker` moved from per-app copies into `packages/ui`
  as prop-only components (data access via callback props: web passes
  `hubFetch` loaders, desktop passes Tauri `invoke` loaders); all 8
  app-local copies deleted, net −538 lines (clients `d5c9acd`). BotCard
  regains desktop's `FocusTrap` + `bot.card.*` i18n keys that web had
  dropped; desktop's EmojiPicker gains web's `unicodeOnly` + SVG
  composer trigger; `EMOJI_CATALOG` moved to `packages/ui`
  (byte-identical copies). Shared bot/emoji types consolidated into
  `packages/ui/src/types.ts`. Typecheck clean both apps; vitest 215/215
  (web), 80/80 (desktop). Audit baseline recorded: 61 duplicated
  components at 73% avg divergence.

- **Hub + web: Invisible presence + "clear after" TTL (2026-07-12)**:
  the footer status picker is now Online / Away / Do Not Disturb /
  **Invisible** with an optional **clear-after** duration (Off/30m/1h/
  3h); the free-text custom status is removed (the profile "thought"
  bubble is separate). Invisible = connected but shown offline to
  others — the hub gates the roster (`reported_online`) and the realtime
  broadcast (emits offline, never "invisible") while keeping the user in
  `online_users` for delivery. TTL is a client-side timer reverting to
  Online. Two real-WS hub tests + the roster-gate unit test. Verified
  live: picking Invisible persists and flips the roster to offline (hub
  `39c2208`, clients `844e74d`). Desktop/Android picker parity deferred.
  See [decisions.md](decisions.md).

- **Web: WYSIWYG editing on your own member card (2026-07-12)**: your
  own profile card is directly editable — status (thought bubble), bio,
  and activities are live inline inputs with a "Save changes" button
  that shows only when something changed (no edit-mode toggle). Save is
  default-propagation-aware — always PATCHes the current hub, and if
  that hub follows the default profile it also updates the default and
  pushes the changed fields to every other following hub
  (`patchMyProfileOnHub` sends only the changed fields). Name/avatar/
  pronouns/cosmetics/hubs stay in the Settings editor. Verified live:
  card edit persists to the hub and propagates into the default
  (clients `27a6563`).

- **Web: tabbed member profile card (2026-07-12)**: `UserProfileCard`
  (what other members see) is now tabbed — Bio / Activities / Hubs —
  mirroring the editor, so what you edit is what others see. Bio shows
  about-me + roles + badges; Activities the activities text; Hubs the
  featured hubs or a "this member doesn't show their hubs" empty state.
  Status renders in the avatar thought bubble. Also dropped the "(N)"
  count from the editor's "Save changes" (following the default marks
  every followed hub dirty, so it could read "(100)" for one typo).
  Clients `4a0f9f7`.

- **Hub + web: Hubs profile tab + account-switch card fix
  (2026-07-12)**: third profile tab, **Hubs** — an opt-in "show my
  hubs" toggle and a drag-ordered (`@dnd-kit`) list of favorite hubs
  picked from the ones you've joined. `favorite_hubs` (JSON
  {url,name,icon}, ≤30) + `show_hubs` (bool) are additive `users`
  columns on the usual /me + profile plumbing; the public profile
  **gates the list to empty when hidden, except for the owner** (the
  editor reads its own profile through that endpoint). `UserProfileCard`
  shows a member's featured hubs. Also fixed a bug where the profile
  card vanished when switching the managing account (the reset effect
  cleared drafts but the context-loader didn't re-run for an unchanged
  "Default" context — now the default draft is seeded synchronously);
  verified live with two accounts. 5 new hub tests; favorite_hubs
  round-trips into Postgres (hub `1a68d2e`, clients `9400e22`). See
  [decisions.md](decisions.md).

- **Hub + web: tabbed profile card (Bio + Activities) (2026-07-12)**:
  same-day redesign of the interests feature below — the structured
  "Now / Looking for" verb-form read as impersonal, so it's replaced by
  a **tabbed** profile card: a fixed header (banner, avatar, name,
  pronouns, key) over **Bio** (about me + badges) and **Activities** (a
  short `status_message`, ≤140, placeholder "What are you thinking?"
  (later moved into a thought bubble beside the avatar — the avatar
  "thinking" — with the tab content in a fixed-height panel so the card
  no longer resizes between tabs, clients `f86a27d`), +
  a longer free-text `activities`, ≤500). Both are plain per-hub text
  fields on the existing `/me` + profile plumbing (absent=unchanged,
  empty=clear); the `interests` JSON column is left dormant. Accent /
  cover cosmetics from the prior entry are unchanged. `UserProfileCard`
  shows the status under the name and activities as a section. Verified
  live: bio + status + activities round-trip into Postgres across the
  tabs (hub `cde17a5`, clients `af062e2`). A third **Hubs** tab (opt-in
  draggable favorites) is designed but deferred. See
  [decisions.md](decisions.md).

- **Hub + web: self-authored interests block + profile cosmetics
  (2026-07-12, superseded same day)**: the original opt-in **"Now /
  Looking for"** block — a fixed-verb + free-text list. Replaced hours
  later by the tabbed free-text card above; kept here for history. The
  **accent color** + **cover image** banner cosmetics it introduced
  (precedence cover → accent → identity, cover via the avatar
  data-URL approach) remain in use. Was hub `f11526c` / clients
  `6460138`.

- **Web: Profile tab redesigned as an identity-colored card
  (2026-07-12)**: the tab read as a plain form in an empty pane; it's
  now a real profile. The WYSIWYG editor card gained a banner whose
  gradient is derived deterministically from the account's Ed25519
  public key (`utils/identityColor.ts`) — identity-is-a-key made
  visible, every account its own consistent colors — with the avatar
  overlapping the banner, a large name, muted pronouns, the short
  pubkey, and bio/badges under hairline dividers
  (`.profile-card*` in the shared styles.css). Plus a subtitle and a
  responsive two-column layout (`.profile-two-col`): the editor card
  and the Badges & certifications panel sit side by side on wide
  screens (using the pane width) and stack on narrow ones. The boxed "Managing account" selector is
  replaced by an inline scope line reading "[profile] for [account]"
  (the account half only when more than one account exists). Verified
  in dark and light themes (clients `1377203`).

- **Hub + web: bio & pronouns + WYSIWYG profile editor (2026-07-12)**:
  members get per-hub `bio` (≤ 500 chars) and `pronouns` (≤ 40) —
  additive `users` columns, PATCH/GET /me and the public profile
  endpoint carry them, avatar-style clear-on-empty-string, 400 on
  oversize, three new integration tests (hub `2aa7c11`). Web-side the
  profile editor became the card itself: inline name/pronouns/bio
  inputs styled as the member card, click-to-edit avatar with a hover
  pencil (`avatar-edit-btn`/`profile-inline-input` in the shared
  styles.css), per-context **drafts** with "•" dirty markers in the
  context dropdown, and a single "Save changes" persisting every edited
  context (default → scoped storage, hubs → their own sessions). The
  default profile and first-join auto-apply carry bio/pronouns;
  UserProfileCard displays both, and the editor card has an always-present badges section under the bio (per-hub badges in hub contexts, identity-wide curated badges in the default context, honest empty state) with the avatar chooser in a proper modal; the bio field auto-grows with its content (200px floor, no manual resize handle) (also fixed two latent UserProfileCard bugs: badges typed as strings while the hub serializes {id,label} objects — a guaranteed render crash — and the card using the undefined .modal-box class, rendering the dialog transparent). "Use default" has a fixed home next to the context dropdown, disabled when inapplicable, instead of appearing and disappearing. Round-trip verified against a live
  hub's Postgres (clients `77c5cad`, squashed feature commit). Widgets/
  wishlist deferred and
  activity surfacing declined — see [decisions.md](decisions.md).

- **Web: profile context dropdown — edit any hub's profile from Settings
  (2026-07-12)**: the Profile tab's two fixed editors (default + active
  hub) became one editor with a context dropdown (the Discord
  server-profiles pattern): pick the default profile or *any* joined
  hub and edit how you appear there in place. Per-hub reads/writes go
  through that hub's own live session via the new
  `platform/commands/myProfile.ts` (`getMyProfileOnHub` /
  `updateMyProfileOnHub` on top of `hubFetchWithToken` — the active hub
  isn't special); a friendly note covers hubs with no session this run; "Use default" in hub contexts links the context to the default profile persistently (per-account stored set): the hub mirrors the default from then on and every save of the default also updates followed hubs; editing a field there detaches it.
  Hub contexts are active-account-only (sessions belong to the active
  account); the default profile stays editable for any on-device
  account. Verified live against a real hub (PATCH landed in the hub
  DB); live/24 spec rewritten for the dropdown flow.

- **Web: settings "Accounts" group + default-profile-per-account
  (2026-07-12)**: user settings reorganized into an Accounts nav group
  with four tabs — Profile / Manage accounts / Devices / Privacy — the
  "Managing" selector lifted to `SettingsPage` (selection survives tab
  changes, e2e-proven), certifications moved under Profile, language
  selector moved to Appearance. The named-profile preset pool +
  per-hub assignment map were **deleted** (see
  [decisions.md](decisions.md)): each account now has one default
  profile (new `DefaultProfileSection`, editable for any on-device
  account via scoped storage without switching) and the per-hub
  profile is edited in place against the hub (`HubProfileSection`,
  `PATCH /me`). Onboarding's profile step now writes the default
  profile directly; the first-hub-join effect reads it at fire time.
  All four locales updated (13 new keys, 20 dead ones removed);
  10 mock-API e2e pass incl. the rewritten `settings-tabs` /
  `account-managing` specs; live specs repointed. Alpha: no
  migration, old localStorage keys orphaned by design. Desktop/
  Android parity pending (ROADMAP).

- **Web: manage any account without switching — "Managing" selector
  (2026-07-12)**: the Account tab gains a "Managing: [account]"
  selector; the per-account sections operate on the selected account.
  Home hubs and device certs/revocations sign locally with the selected
  account's master seed (those endpoints are signature-authoritative —
  no session needed); dm-blocks/passkeys/trusted-devices go through the
  new `hubFetchAs` background token (challenge/verify as the selected
  account, cached in its own namespace, active session untouched).
  Non-member accounts get a friendly notice; passkey *registration*
  stays active-only (WebAuthn binds the live session). **The
  sovereignty differentiator made tangible: stay in a voice call on one
  identity while administering another — possible only because Wavvon
  identities are locally held keys, not server accounts.** 8 unit +
  1 e2e proving the managed request carries the managed account's
  distinct token (clients `5f3f029`).

- **Web: in-place account switch — no reload, guarded (2026-07-12)**:
  switching remounts the app tree (`AccountRoot`, `<App key=account>`)
  instead of reloading; teardown audit fixed the one real leak (the
  module-level hub-sessions map survived remounts — outgoing account's
  WebSockets now reset before the key flips) and gave voice/video/
  screen-share refs a master unmount effect. Switching is blocked while
  in a voice channel (prevention, not auto-leave) and rate-limited by a
  4s cooldown protecting the remount+reconnect window. An interim
  "Switching account…" overlay approach was built and rejected same-day
  (two of its bugs — parse-time paint and a StrictMode flag race — are
  covered by the account-switch e2e, which now proves no navigation via
  a surviving window marker). Decision in
  [decisions.md](decisions.md) (clients `d36a664`…`6c03ff0`).

- **Web: account-switcher UX polish from live user testing
  (2026-07-11)**: iterative session with the user driving a running
  hub + both clients. Editable account labels behind a visible pencil
  (the old click-the-name rename had zero affordance); the standalone
  "Your public key" section merged into the account list with a
  per-row copy-full-key button (canonical-aware); required label on
  every new account (count-based prefill, dedupe keeps existing);
  the list is now a real table (# | Label+pencil | Public key |
  Actions) with fixed action positions (Switch/Copy/Remove; active row
  shows a disabled Active); adding an account no longer auto-switches;
  drag-and-drop ordering via a handle-only native-DnD # column with
  keyboard fallback, persisted as device-local account_order
  (18 new tests, 201 total) (clients `a9d18ef`, `f93e8c0`, `2876394`).

- **Invite role policies — default role + member invites (2026-07-11)**:
  hub setting `default_invite_role_id` grants a role automatically to
  anyone joining via an invite with no explicit grant (both redemption
  paths, explicit grants win, admin-permission roles rejected/skipped);
  non-admin `manage_channels` holders confirmed able to mint
  priority-guarded role invites and get a QuickInviteModal with an
  optional role picker; admin Invites tab gains the default-role
  picker. 11 new hub tests; live-verified: plain-invite joiner received
  the default role (DB-checked). Decision in
  [decisions.md](decisions.md) (hub `edca039`, clients `1bf0b8c`).

- **Live e2e session against a real hub: 4 bugs found + fixed
  (2026-07-11)**: booted a fresh hub + Postgres locally and drove the
  web client headless through owner-invite join, role-granting invites,
  lobby PoW promotion, channels, and DMs. Found and fixed same-day:
  (1) hub never registered `GET /channels/{id}/polls` — poll listing
  405'd on every channel load since polls shipped; (2) hub never
  registered `GET /conversations/{id}` and (3) `createConversation`
  sent `member_pubkeys` for the server's `members` — together with the
  dead Message-button code fixed earlier, starting a DM was impossible
  in web; (4) `handleSendDm` swallowed failures after clearing the
  input (silent message loss) — now restores text + shows the error.
  Cosmetic: DM composer placeholder showed "Invia" (send-button key).
  Live-verified after fixes: owner invite → owner role, member invite
  → `tester` role (DB-checked), lobby confine → PoW → `promoted`
  (DB-checked), DM started from profile card and received cross-account
  (server `d88722f`, clients `cc1c6e6` + `c2af774`).

- **Paired-device DM canonical attribution — fixed cross-repo
  (2026-07-11)**: implements the same-day design (decisions.md,
  [multi-device.md](multi-device.md)). Pairing now wraps the canonical
  X25519 DH scalar for the new subkey (`wrapped_dh_seed_hex` — agreement
  capability without signing capability); DM envelopes gain optional
  `signer_cert` with tiered verification (origin hub binds via session;
  federation resolves via users row / device registry);
  `FederatedDmRequest` forwards the cert. Cert-less envelopes stay
  byte-identical — no wire-vector break. Client attaches the cert and
  attributes to canonical when the signing key differs; paired devices
  never publish the DH key. This makes paired-device E2E DMs work at
  all — they previously failed hub signature verification outright.
  6 new hub flow tests + 7 client decision tests; full suites green
  (server `aab8107`, clients `974fe5e`).

- **Web: full-archive import/restore (2026-07-11)**: "Restore from
  archive…" decrypts the export, resolves-or-creates its identity as an
  account, and restores hub list/drafts/ignored users/voice gains into
  that account's namespace with skip-and-report conflicts (local data
  never silently overwritten); DM history, home-hub designations, and
  the encrypted-prefs `gap_note` reported as not-restorable per
  [data-export.md](data-export.md) §5. Pure merge logic +12 tests incl.
  cross-account isolation (clients `53ccce2`).

- **Hub: voice_udp_addr on /info + demo-seed invite fix + mini-app
  scoped tokens (2026-07-11)**: `/info` advertises the voice UDP
  endpoint (from `WAVVON_PUBLIC_URL`/LAN advertise addr; farm
  serial-routing slice). demo-seed redeems the first-boot owner invite
  (`--invite`/`INVITE_CODE`), mints a roster invite, and writes real
  `secret_key_hex` (was empty) — clears the known issue. **Security**:
  `bot_app_join` sessions are now `scope='mini_app'` bound to one
  channel+bot — REST fully confined, WS confined to the bound channel,
  voice rejected; closes the full-session gap found in the
  [bot-capability-layer.md](bot-capability-layer.md) design pass
  (hub `59e28ec`, 6 confinement tests).

- **Web: ctx-menu create event/poll + invisible + popover fix
  (2026-07-11)**: channel right-click menu gains Create event
  (admin-gated) and Create poll (`send_messages`-gated), reusing the
  existing composers. Found + fixed: the shipped Join/Create `+` popover
  (`da250c9`) was silently clipped by `.hub-sidebar` `overflow-x:hidden`
  — never actually visible; rebuilt on the fixed-position context-menu
  pattern and wired its unused i18n keys (clients `83a7676`).

- **Web: role-granting invite admin UI + invite-expiry fix
  (2026-07-11)**: `InviteManager` with role picker (limited below the
  admin's own max priority), single-use/24h clamp on admin-permission
  roles, role chips on the invite list. Fixed pre-existing bug: create
  body sent `expires_in` but the server reads `expires_in_seconds` —
  admin-typed expiry was silently dropped (clients `68a1f73`).

- **Hub: /join/:code role grants + redemption-time priority guard;
  lobby is_hub regression test (2026-07-11)**: `apply_invite_role_grant`
  shared by both redemption paths; priority guard now re-checked at
  redemption (inviter demoted after minting no longer confers the role —
  grant withheld, join succeeds; first-boot system invite exempt). Added
  the missing test that `is_hub` peers are never lobby-confined
  (exemption itself shipped in `8dc6739`) (hub `5d2b7a8`).

- **Web: lobby soft-landing polish (2026-07-11)**: persistent sidebar
  clock badge on lobby-scoped hubs (visible when not the active hub) +
  promote-decision forks extracted to `utils/lobbyDecision.ts` with 15
  tests. Core flow had shipped in `c1f95d0` (clients `1474561`).

- **Designs: bot capability layer, forum federation, paired-DM fix
  (2026-07-11)**: [bot-capability-layer.md](bot-capability-layer.md)
  (admin-granted capability spine, game modal, video via screen-share
  relay, Phase-1 tic-tac-toe slice); [forum.md](forum.md) §9 federation
  via read-through proxy; paired-device DM attribution fix designed
  (decisions.md + [multi-device.md](multi-device.md) implementation
  plan) — design pass found paired-device E2E DMs were fully broken,
  not just mis-attributed (docs `5c3995b`, `df9fc4c`).

- **Web: identity/account i18n sweep + de/es admin translations
  (2026-07-11)**: ~150 new keys across IdentitySetupScreen,
  IdentityBackupSection, AddHubModal (clears that known issue), and six
  account-section components + shared BlockIgnoreSection; raw
  "Error: No active hub" replaced with translated empty-states; 18
  `hub.admin.overview.*` de/es English placeholders translated
  (clients `71d1b51`, `f7158d5`).

- **Web: identity backup exports selected accounts (2026-07-11)**:
  the encrypted backup gains a checkbox list when the device holds
  multiple accounts (active pre-checked, select-all) — one passphrase,
  one file. Envelope `version` 2: payload is always an array of
  identity records; import still accepts v1 single-object files,
  dedupes by pubkey, reports "N added, M already on this device", and
  never replaces. Pure payload logic in
  `utils/identityBackupPayload.ts` (15 tests) (clients `04b5d38`).

- **Web: multi-account with device-local switcher (2026-07-11)**:
  multiple identities per device, isolated via
  `utils/accountScope.ts` localStorage namespacing (hub lists, session
  tokens, drafts, profiles, notify prefs, DM ratchet state);
  `IdentityRecord.id` is now the account pubkey, registry = the
  IndexedDB identity rows, switcher lives in Settings → Account
  (switch = pointer swap + reload; removal = fingerprint-typed confirm
  + namespace purge). Add-account reuses all setup paths via the
  extracted `IdentitySetupScreen` (create/passkey/phrase/pair),
  deduping by pubkey. No migration by design (pre-release). Also fixed
  `IdentityBackupSection` reading a never-populated key (export always
  failed). Client-only — no hub changes (clients `99d363e`; decision
  in [decisions.md](decisions.md)).

- **Web: passkey-derived identity via WebAuthn PRF (2026-07-11)**:
  identity setup gains "Create identity with a passkey" and "I have a
  passkey" — the passkey's PRF output (salt `wavvon-master/v1`, pinned
  constant in `packages/core/src/identity/prf.ts`) is used directly as
  the 32-byte identity entropy, so the derived 24-word phrase remains
  available and is offered as the domain-independent backup after
  creation. Fully client-side (`apps/web/src/platform/prfIdentity.ts`);
  the hub-session passkey ceremony is unchanged. Graceful fallback to
  phrase flows when PRF is unsupported. New `identity_setup.passkey.*`
  keys in all four locales. Desktop/Android PRF shims remain wishlist
  (clients `5f9008f`; decision in [decisions.md](decisions.md)).

- **Web: nickname + avatar step in first-run onboarding (2026-07-11)**:
  all three identity-setup paths (create, recover from phrase/hex, pair
  with existing device) now finish on a profile step — nickname input +
  the existing `AvatarChooser` (upload or generated) in a new
  `ProfileSetupStep` component. The choice is saved as the user's
  default named profile, which the existing first-hub effect applies
  automatically via `PATCH /me`; skipping keeps the old bare
  display-name modal as the fallback on first hub join. New
  `onboarding.profile.*` keys in all four locales (clients `89222bd`).

- **Desktop: hub-synced presence with DND gating + global broadcast
  (2026-07-11)**: ported web's full presence set (web `5af06ca`,
  `e137c87`, `ac8e251`) — the local-only, purely visual status picker in
  `ChannelSidebar` now syncs away/DND/custom text over
  `set_status`/`member_status` (picker gains the custom-text input,
  drops the meaningless "offline" option). Presence is device-global:
  broadcast to every connected hub session (new `send_all_hubs_ws_raw`
  Tauri command) and re-applied per hub on (re)connect
  (`send_hub_ws_raw_to`). The Rust WS layer learns `member_status`
  (previously dropped as `Other`); the member list renders away/DND dots
  + custom text; `/users` fields threaded through `UserInfo`. DND now
  actually gates mention pings and system notifications (unreads still
  accumulate); desktop's `silent` notify mode already gated. The inert
  `dndActive`/`save_dnd_settings` plumbing was removed (clients
  `81de52c`). Live two-client pass still pending.

- **Desktop: camera background choice persists + Settings live preview
  (2026-07-11)**: background mode/source now persist via the same
  localStorage keys web uses (`wavvon.bgMode`/`bgSource`), loaded/saved
  in `useVideo` — blur/image/video no longer reset every launch. The
  hardcoded-English background buttons in Settings were replaced by a
  new `CameraSection` ported from web's CameraTab: i18n'd controls plus
  a live mirrored preview that runs outside a call and restarts on
  device/mode/source change (clients `e41842b`). Closes the 2026-07-05
  known issue.

- **Desktop + docs: wire test vectors regenerated for wavvon tags
  (2026-07-11)**: the bulk rename to Wavvon (clients `032028d`)
  updated envelope tag string literals but not the hex-encoded test
  vectors — 20 of desktop's 38 wire vector tests had been failing since,
  and `wire-format.md`'s vectors were equally stale. Desktop vectors
  copied from the server identity crate's regenerated
  `wire_vectors.rs` (clients `4cb5933`); all 20 hex blocks in
  `wire-format.md` refreshed to match.

- **Desktop: camera background effects fix ported from web (2026-07-11)**:
  desktop's `backgroundProcessor.ts` copy had the same two bugs fixed on
  web the day before (globalThis constructor resolution, mask consumed as
  ImageData instead of composited as a canvas) — ported the full web fix
  (drawImage/source-in cutout, serialized send(), eager initialize(),
  `activeMode`) and surfaced the active/unavailable status line in the
  Settings camera-background section via a new `backgroundActive` value on
  `useVideo` (reuses the shared `settings.camera.bg.*` keys). Unit tests
  extended with a segmentation-failure fallback case (clients `9ab943e`).
  Live webcam pass still pending — desktop has no fake-camera e2e harness
  like web's.

- **Web: camera background effects fixed (2026-07-10)**: blur/image/video
  backgrounds never actually engaged — two bugs in `backgroundProcessor.ts`
  made every mode silently fall back to raw video: the MediaPipe package
  (Closure IIFE, no module exports) meant `mod.SelfieSegmentation` was
  always undefined, and the segmentation mask (a GpuBuffer canvas) was
  consumed as ImageData, which would have killed the render loop. Fixed
  with the globalThis constructor + drawImage/source-in compositing;
  send() serialized to one in-flight frame; eager initialize() so broken
  environments fall back deterministically; the Camera tab now shows an
  active/unavailable status instead of pretending (clients `9426c20`,
  4-locale keys). Verified with a new fake-camera e2e spec + visual check
  of the composited blur. Desktop's copy has the same bugs → new known
  issue in ROADMAP.

- **Web: DND status now gates notifications, presence made global, hub
  mute made real + components/ reorg (2026-07-10)**: selecting **Do Not
  Disturb** in the status picker now actually suppresses mention pings
  and system notifications (unreads still accumulate) — previously
  visual-only on every client. Presence is now **global across hubs**:
  the picker broadcasts `set_status` to all connected sessions (was
  active-hub-only), persists on the device, and re-applies per hub on
  (re)connect. The notify-mode gate also landed: a hub/channel set to
  `silent` (hub mute) no longer pings on mentions — it was cosmetic
  before. Two decisions recorded ([decisions.md](decisions.md)): DND
  rides on presence status with no dedicated toggle; presence is global
  while per-hub quiet is hub mute. The never-mounted `DndToggle` /
  `DndSettingsSection` dead code and `DndSettings` types were deleted.
  Quiet-hours schedule stays deferred. Desktop/Android gates still
  pending (with presence parity). Also: the ~100 flat files in web's
  `src/components/` were reorganized into 13 themed subfolders (clients
  `b149281`), imports normalized to `@components/<group>/<Name>`; and
  SettingsPage.tsx (724 lines) was split into per-tab components under
  `settings/tabs/` + extracted Passkey/TrustedDevices sections (clients
  `91e4b80`), with a new hubless e2e spec asserting every settings tab
  renders — written to chase a reported "Camera tab not visible", which
  turned out to be real only on released builds: the tab shipped to
  develop 2026-07-07 (`1b03e8a`), after v0.3.2 was cut.

- **v0.3.2 (clients + server) + pilot on latest (2026-07-06 evening)**:
  nine web fixes from the owner's live pilot pass — /join/<code> invite
  links parse in Add-hub; banner channels regained their image controls
  (create URL/upload + settings editing; the desktop-only three-step
  flow was never ported); channel-permissions rows at/above own rank
  render read-only (even the owner 403'd on the Owner row's >= guard);
  fixed-size tabbed settings modal + single-row footer + Apply label +
  icon-placeholder cleanup; hub rename now syncs the sidebar (save hook
  + /info self-heal, new renameSavedHub keeps remember_token);
  hub-dropdown closes on Invite/Settings; emoji channel icons render
  (ChannelIcon only knew svg registry ids). Server v0.3.2: banner
  source-switch atomically clears the other column (PATCH had no
  explicit-NULL; stale banner_url shadowed new uploads). Release
  hygiene: clients release.sh syncs all app manifest versions; server
  release.sh regenerates Cargo.lock. **Pilot** switched to
  `hub:latest` (owner call: alpha, surprise-upgrades fine) and pulled
  v0.3.2 — data intact, hub name intact, fresh web bundle
  served. Android APK still blocked on audiopus cross-compile (known
  issue).

- **Clients v0.3.0/v0.3.1 released + pilot hub fresh-installed on v0.3.1
  (2026-07-06)**: first clients release since v0.2.6 and since the rename.
  v0.3.0 shipped desktop (Windows exe, macOS universal dmg — first CI
  proof of the xcap 0.9.6 fix — Linux AppImage, updater manifest) and the
  web bundle; v0.3.1 re-ran for Android after fixing the doubled
  `apps/android/android` workflow paths, which unmasked the real blocker
  (audiopus_sys host-arch libopus → ROADMAP known issue; still no APK).
  Clients release.sh fixed (pre-monorepo tauri.conf path, changelog-wiping
  git-cliff mode) and CHANGELOG.md introduced. **The external pilot hub**
  was wiped and reinstalled per operator decision: `ghcr.io/wavvon/hub:0.3.1`
  + postgres:16 sidecar (db container given a non-default name to avoid
  colliding with an unrelated container on the same box),
  `WAVVON_PUBLIC_URL` set, fresh hub identity, first-boot owner invite
  minted and handed to the operator.

- **Server v0.3.1 released — first working release pipeline since v0.2.0
  (2026-07-06)**: `wavvon-hub-linux-x86_64`, `wavvon-hub-linux-aarch64`
  (first successful aarch64 build ever), `wavvon-farm-linux-x86_64` +
  Docker images published. Three pipeline bugs fixed to get there:
  auto-tag dispatched release.yml without its required `tag` input
  (422'd silently on every tag since v0.2.1 — tags pushed, nothing
  built); OpenSSL (via webauthn-rs) was vendored only on Windows, so the
  musl static and Docker builds had nothing to link (now vendored on all
  targets, Docker builder gained perl+make); release.sh used a stale
  `hub/Cargo.toml` pathspec and a git-cliff mode that wiped previous
  releases' notes from CHANGELOG.md on every run. Also de-flaked the
  four cross-hub DM delivery tests (poll instead of fixed sleeps) that
  were failing CI on unrelated PRs, and the openapi coverage gate got
  unbroken (script knew only the old `hub/` layout) + fed a spec that
  documents all 228 routes. v0.3.0's tag/release exists but is empty —
  its notes fold into v0.3.1. Dependabot PRs #10–#14 merged along the
  way. Closes the "no release assets since v0.2.1" known issue.

- **Public-facing cleanup after the rename to Wavvon (2026-07-06)**
  (docs `674cfd3`+assets, server `1c99dd8`, clients `3020ada`, discovery
  `037d403`): every `github.com/Wavvon/Wavvon` link now points at
  `Wavvon-docs` and `Wavvon-client` at `Wavvon-clients` — the renames had
  left 404s in all four repos' READMEs plus server CI's spec checkout.
  Server README/compose/hub.toml.example caught up with reality:
  PostgreSQL (not SQLite), `WAVVON_DATABASE_URL` documented, compose
  gained the postgres:16 sidecar, crate table matches the workspace.
  Client READMEs no longer claim voice is desktop-only. **README assets
  regenerated** — the old screenshots/join-flow GIF still showed the
  pre-rename hub name; recaptured against a demo-seeded hub as "Wavvon HQ" with the
  current UI, via a new committed capture harness
  (`apps/web/e2e/capture/`). Release-pipeline failure diagnosed →
  ROADMAP known issue (needs the next tag).

- **Web UX bug batch (2026-07-06)** (clients `479af88`): four fixes from
  the owner's manual pass. **Message right-click menu** — a message row
  now opens a context menu with message actions (reply, copy text, copy
  link, pin, edit, delete, report) plus author actions (profile, copy
  key, admin mute/kick/ban); the author name/avatar still opens the full
  user menu with role management. **Resizable channel sidebar** —
  drag-handle on the right edge (220–480px, persisted, double-click
  resets), and the voice-controls footer wraps instead of overflowing.
  **Floating camera window** — video moved out of the channel header
  into an app-level picture-in-picture window (draggable, resizable,
  position/size persisted) that follows the voice session rather than
  the selected channel. **Header cleanup** — the "Copy channel link"
  header button removed; the action lives in the channel's right-click
  menu instead.

- **Backlog sweep, 2026-07-06 (loop session)** — cleared the buildable
  backlog: **invite-first defaults + role-granting invites** (hub `10f3e2d`,
  incl. one-time first-boot owner invite) and **is_hub lobby exemption**
  (`8dc6739`); **`wavvon-hub setup` install wizard** (`89119a2`); web
  **lobby UX + background PoW** (clients `c1f95d0`, first JS PoW in
  `packages/core`); **generated offline avatar picker + profile avatar
  editing** (`4c93c9d`); **multiple named custom themes** (`afc07a8`);
  **Settings › profile dedup + Voice&Video restructure + 2-col layout**
  (`b270a3d`). **create-hub-via-discovery** designed (`bc798da`), UI slice
  built separately. Human-gated remainder: pilot upgrade, v0.3.0 release
  tag, git remotes.

- **Lobby soft-landing, server half (2026-07-06)** (hub `bded78c`;
  [`lobby-bot-survey.md`](lobby-bot-survey.md) Feature 1). `min_security_level`
  used to hard-403 every sub-level join (even the owner's own first join) —
  now, when the lobby is enabled, a sub-level join is admitted with
  `scope="lobby"` and confined to `/me` + `/lobby/*` + survey (deny-by-default
  in the AuthUser extractor; WS rejects lobby scope). `POST /lobby/submit-pow`
  promotes lobby→member in place once PoW qualifies. Owner + implicit first
  user are exempt (always member). Additive `sessions.scope` column; gaming
  preset's `min_security_level: 8` restored now that the gate admits instead
  of walls. 7 new tests. Web lobby UX + is_hub-peer exemption tracked as
  follow-ups.
  Also (server `4490d5c`): first real user becomes owner even on a
  preset-seeded hub — the "first user" check had been counting the bootstrap
  `system` sentinel.

- **Manual-test feedback wave 3 (2026-07-05 late night)** (server `a503ede`
  `9457a5b`, clients `0ec7fa8` `fa23c1f` `4ada361`):
  - **Batch 2 web fixes** (`4ada361`): no-hub shell keeps the rails (welcome
    moves into the content slot); right-click message authors for the
    moderation menu; composer click-anywhere focus; channel silence finally
    has UI (per-channel Notifications submenu; hide-silenced props were
    never wired); submenu z-index/overflow; message permalinks replace the
    channel-link menu item.
  - **Admin surfaces** (`0ec7fa8`): grouped User Settings nav; ErrorRetry
    across 8 admin sections (Roles used to hang on failed fetch); icon
    library file upload (raster → 64×64 svg-wrapped) + Recovery explainer;
    Federation nav group; anti-spam challenge Preview modal; inline member
    role management in the Members table.
  - **Welcome invite banner** (`9457a5b` + `fa23c1f`): operator-set
    label/invite in hub settings → /info; join-preview + dismissible
    post-join banner.
  - **Survey → roles** (`a503ede` + `fa23c1f`): per-choice role mappings
    with admin-permission guard and strict free-text review rule
    ([`lobby-bot-survey.md`](lobby-bot-survey.md) clarified); admin UI role
    picker per option.

- **Manual-test feedback wave 2 (2026-07-05 night)** (server `8867105`
  `db25169`, clients `9815177` `207e7bf` `e0c3bf8`):
  - **Kick/ban end membership** (`8867105`): membership = holding roles;
    kick/ban strip them, /users hides banned + role-less non-bots, users
    row kept for message attribution. Kicked users rejoin as new members
    (invite needed on invite-only hubs); banned stay 403.
  - **Voice roster, web half** (`e0c3bf8`): the current channel's row no
    longer blanks its own roster.
  - **Year-58479 timestamps** (`9815177`): messages carry ms, everything
    else seconds — shared formatters now normalize.
  - **Voice UI batch** (`207e7bf`): SVG icons replace unrenderable emoji,
    "Deafen"→"Mute all audio", default initial-avatars, screenshare
    self-preview, unified header command row.
  - **CI green again** (`db25169`): two clippy -D warnings lints.

- **Manual-test feedback wave 1 (2026-07-05 evening)** (server `327c399`
  `7ed61c7`, clients `9467b0d` `df6064b`). From the owner's live pass:
  - **Voice roster ghost fixed** (`7ed61c7`): the WS voice filter
    suppressed the actor's own Joined/Left events, so after a channel
    switch/leave your own sidebar kept you in the old channel forever.
    Roster events now reach everyone including the actor.
  - **First-run bootstrap presets** (`327c399`,
    [`hub-creation-wizard.md`](hub-creation-wizard.md) piece 2 local half):
    `WAVVON_TEMPLATE=gaming|community|minimal` + `WAVVON_TEMPLATE_FILE`;
    bootstrap runs pre-owner-seeding; unknown preset = startup error. 22 tests.
  - **Web quick fixes**: language setting → Profile; "Voice Lobby" →
    "Room Creator" (`9467b0d`); voice devices first in the Voice tab;
    status picker dismisses on outside click; event modal start/end
    widths (`df6064b`).

- **Farm serial routing, first slice (2026-07-05)** (server `012b791`;
  design in [`farm-impl.md`](farm-impl.md) § Serial routing). The farm
  reverse proxy resolves `/hub/{serial}/…` by hub pubkey (unique partial
  index) instead of the opaque id — the serial clients already hold from
  invite links. WebSocket upgrades bridge through a raw socket relay
  (copy_bidirectional on 101). Fixed two latent `process_port`
  INTEGER-as-i64 decode bugs — one made the proxy silently 404 every
  registered hub (zero prior test coverage), one would have broken
  startup re-spawn. 5 integration tests incl. end-to-end WS echo.

- **LAN / offline mode, server half (2026-07-05)** (hub `a6ec49b`,
  [`lan-mode.md`](lan-mode.md)). `WAVVON_LAN_MODE=1`: hard private-address
  guard (refuses to start on a public address; hostnames rejected — no DNS
  on a LAN), self-signed cert tier with restart-stable SHA-256 fingerprint
  (`WAVVON_LAN_TLS_MODE=self`, default) or gated plaintext (`none`), mDNS
  advertisement with join-URL + fingerprint TXT fields
  (`WAVVON_LAN_MDNS=0` opt-out), `/info` exposes
  `lan_mode`/`lan_tls`/`lan_fingerprint`, doctor prints the join URL +
  fingerprint. Native discovery UX / QR payloads stay client-era. 15 tests.

- **Desktop: MediaPipe self-hosted + video background (2026-07-05)** (clients
  `73cdadf`). Background effects no longer hit jsDelivr — web's
  `mediapipeAssets` Vite plugin now serves desktop too (`/mediapipe/*`,
  bundled into the Tauri dist), fixing offline use. Video background mode
  ported from web; the Image picker the class always supported finally got
  UI. 5 vitest cases. Follow-up in ROADMAP: desktop doesn't persist the
  choice across launches.

- **Farm challenge race fixed + farm/seed test-DB guards (2026-07-05)**
  (server `8b45c9e`). Farm's pubkey-keyed challenge slot had the same
  concurrent-auth stomping race as the hub; now nonce-keyed
  (`pending_challenges_v2`, additive) with an optional `challenge` echo on
  verify (race-free; old clients fall back to newest-challenge). Farm and
  seed integration tests adopt hub's `TestDbGuard` — test databases are
  dropped on scope exit instead of leaking (~80 observed on a dev volume).

- **Presence status: away/DND/custom text, hub-synced (2026-07-05)**. New WS
  `set_status` client message + `member_status` hub-wide broadcast; status
  persisted on the users row (additive `presence_status`/`presence_custom`
  columns — first post-baseline migration) and surfaced by `/users` only
  while online. Web: footer status picker (ported from desktop's local-only
  one), colored dots + custom text in the member list, live updates.
  "Online" click clears the custom text (back-to-normal semantics). The
  "new member appears live" half of the old known issue was already fixed
  on 07-04 (`fb97442`). 2 hub integration tests + `e2e/live/10` extended.
  Also fixed en route: vitest was collecting Playwright specs under `e2e/`
  (48 failing suites in `npm run test`) — excluded in `vite.config.ts`.

- **Temp-room owner rename UI (2026-07-05)** (clients `4100671`). The last
  open piece of join-to-create temp voice channels: a non-admin room owner
  gets a "Rename room" context-menu item (name-only modal, matching the
  server's `owner_rename_only` grant). i18n ×4, `e2e/live/06` extended.

- **`GET /channels/:id/my-permissions` + channel-scoped client gating
  (2026-07-05)** (server `daac936`, clients `fdb2086`). Members read their
  own effective channel-scoped permission set without `manage_roles` —
  closes the recurring UX gap (soundboard play-gate, Permissions tab
  reachability). Web: soundboard button now respects channel-level denies;
  the settings gear opens for `manage_roles` members straight into the
  Permissions tab (rename/delete stay admin-only). `e2e/live/47` + 4 hub
  integration tests. **Also (server `fab74e2`): int4-cast sweep** — channel
  message reactions 500'd the whole history fetch whenever a message had a
  reaction (same uncast `MAX(CASE…)` as the forum bug, three loaders), and
  `/health` `db_status` had reported a decode error on every check since
  the Postgres migration; both fixed, reaction read-back now covered in
  `chat_flow.rs`.

- **v0.3.0 schema baseline reset + four federation bug fixes (2026-07-05)**
  (server `b6e09f5`, `2bd80b8`). All ALTER-ballast folded into clean CREATE
  TABLEs — verified byte-identical via pg_dump diff (decision in
  [`decisions.md`](decisions.md); pre-0.3.0 hubs wipe + re-setup, see
  [`hub-operator-guide.md`](hub-operator-guide.md)). Fixing the ~20
  integration-test files that hadn't compiled since the whisper commit
  unmasked four real bugs, all fixed:
  1. **Auth challenge stomping** — challenges were one-slot-per-pubkey, so
     concurrent federation auth flows for the same key killed each other;
     now keyed by challenge value (regression tests in `auth_flow.rs`).
  2. **Federated DM receive not idempotent** — redelivery (at-least-once by
     design) 500'd on duplicate keys forever; receive inserts are now
     `ON CONFLICT DO NOTHING` and `dm_outbox.last_error` records the remote
     body.
  3. **Forum reactions silently dead since the Postgres migration
     (2026-06-27)** — int4 aggregate decode failed and was swallowed by
     `unwrap_or_default()`; every post showed zero reactions while the
     write path returned 201.
  4. **Federated-ban overrides unenforced at 2 of 3 gates** — whitelist/
     blacklist only worked at auth verify; message layer and farm-token
     middleware had drifted copies without them. Policy unified in
     `moderation::is_denied_by_federated_policy`; auth path now fails
     closed on DB errors.

- **Alliance space-sharing v2 (2026-07-05)** — any space type shareable across
  an alliance; sharing a category shares its subtree recursively with live
  semantics (read-time recursive CTE). Shared-channel responses carry
  `channel_type`/`parent_id`/`is_category`; web sidebar renders allied trees and
  alliance messaging is now wired (was stubbed). Fixed two pre-existing
  federation bugs en route: joiner stored literal `"self"` as inviter URL;
  mutual hubs recursed indefinitely merging shared views (`local_only` hop).
  See [`alliances.md`](alliances.md), [`decisions.md`](decisions.md).

- **Manual-test bug pass (2026-07-05) — batch 5 (features + polish)**. All with
  2+ Playwright tests each; full live suite 62 green.
  - **Farm-ready invites** (`237eb59`): `wavvon://<host>/i/<hubSerial>/<code>`
    (serial = hub public key) so a farm can route the same domain to different
    hubs by serial. `parseHubInput` extracts the serial (path or `?hub=`,
    backward-compatible), `buildInviteLink` generates it, and the Invites admin
    tab shows a full copyable link. 5 core unit tests + `e2e/live/42`.
  - **Soundboard popover** no longer overflows the viewport (`0ea4404`,
    `e2e/live/39`); **channel-header buttons** spaced out.
  - **Voice join/leave sound cues** wired (`playVoiceTone`) with a toggle
    (`37db681`, `e2e/live/41`); mention ping already covered notifications.
  - **Incoming + outgoing webhooks** merged into one Integrations tab
    (`756e7f3`, `e2e/live/40`).
  - **Camera device picker + live preview** in Settings (`9edb456`,
    `e2e/live/43`).
  - **Webcam background effects — blur / image / video** (`8b1d489`,
    `e2e/live/45`). Ported + extended the desktop `BackgroundProcessor`
    (MediaPipe selfie segmentation); no device gating (opt-in, user decides);
    model + WASM served **self-hosted** from `/mediapipe/*` via a Vite plugin
    (no CDN, offline-friendly, nothing committed), lazy-loaded on first use,
    graceful fallback to raw video if it can't load.
  - **Hub-admin nav grouped** into labeled sections + made scrollable
    (`e803326`, `e2e/live/44`).
  - **#7** (redundant join-voice button): investigated — the channel header is
    the only join-voice control; nothing redundant found to remove.

- **Manual-test bug pass (2026-07-05) — batch 1** (server `4d38025`, clients
  `33c4485`). From hands-on testing of the running hub:
  - **Ban/kick/mute from the member right-click menu were broken** — the client
    hit `/admin/bans`, `DELETE /admin/members/{pk}`, `/admin/members/{pk}/mute`,
    none of which exist. Pointed them at `POST /moderation/{bans,kick,mutes}`.
    `e2e/live/33`.
  - **Integrations tab 405'd** — listing used `GET /admin/webhooks` and
    regenerate used `PATCH /admin/webhooks/{id}`, but only POST/DELETE existed.
    Added both handlers. Also fixed a pre-existing **create 500** (the INSERT
    passed integer `1` for the BOOLEAN `active` column). `e2e/live/34`.
  - **Theme-picker buttons unreadable in calm/light** — inherited the base
    button's `var(--accent-text)` (dark in calm, white in light) on a surface
    background. Set an explicit `color: var(--text)`.
  - **"Identity backup" label shown twice** in the account tab — deduped.

- **Manual-test bug pass (2026-07-05) — batches 2–4** (server `05b890d`,
  clients `f3ee45e`, `22dcc58`, `c05c544`, `bfb658c`, `fa5bd85`, `1173f94`):
  - **Voice:** switching voice channels now leaves the previous one (repeated
    joins stacked sessions → "in 3 rooms at once" + stale roster entries that
    blocked temp-channel cleanup); the channel tree no longer duplicates the
    voice roster (your name showed twice). `e2e/live/35`.
  - **Channels:** deleting a category/channel cascades to all descendants
    (was 409); long channel names truncate so the settings gear stays reachable.
    Also fixed `tests/common.rs` (the hub integration suite hadn't compiled since
    the whisper AppState field). `e2e/live/36,37`.
  - **Settings surfaces:** language switcher (Settings → Appearance, `e2e/live/38`);
    audio input/output device pickers (Settings → Voice); discovery directory
    shows a greyed "Service not available" state when unreachable; clarified the
    SVG icon-library field.

- **Known-issue fix batch (2026-07-04/05)** — issues fixed out of ROADMAP
  Known issues, moved here on close:
  - **SECURITY — 2026-07-04 audit findings all fixed** — full audit in
    [`security-audit-2026-07-04.md`](security-audit-2026-07-04.md).
    Server fixes hub `efbf17b`, web fix clients `62792cb`. Verified by
    hand + regression tests. **H1** (WS Subscribe read-gate):
    `handle_subscribe` requires channel-scoped `READ_MESSAGES`; 2 WS
    integration tests over real TCP. **H2** (channel-perm escalation):
    priority guard + unconditional `admin`-grant block + self-grant guard
    on PUT/DELETE; `manager_cannot_grant_admin_via_overwrite` asserts 403.
    **H3** (events) / **H4** (pins): read paths channel-gated (`get_event`
    404s to avoid existence leak); pin writes channel-scoped. **D1/D2/D3**
    (importer): TLS-bypass now loopback-only behind `--insecure`,
    non-`https` hub rejected unless loopback, `Retry-After` clamped; same
    TLS line scrubbed from `demo-seed`. **W1** (color beacon):
    `safeRoleColor` validator on both swatch sinks. **W2** (2026-07-05,
    clients `46fa57e`): `SortableItems.tsx` validates `channel.color` via
    `safeRoleColor` before the category-header `background` sink.
  - **Temp voice spawners on web** (2026-07-04, hub `1fc5aa6`) — the
    spawn-on-join logic (hub `3005fc5`) had only been added to
    `routes/ws/handlers/voice.rs` (the main-hub-WS / UDP path used by
    desktop/Android); web's separate `/voice/ws` transport
    (`routes/voice_ws.rs`) never detected `channel_type = 'spawner'`, so a
    web user clicking a spawner joined the spawner row itself.
    `voice_ws_task` now reuses the same `spawn_temp_channel()` helper,
    gates on channel-scoped `read_messages` against the spawner first, and
    echoes the resolved `channel_id` in `voice_ws_ready`. Broadcasts
    `channels_updated` on spawn, matching the main-hub-WS path. Two new
    integration tests in `temp_voice_channels_flow.rs`.
  - **Web profile changes propagate live** (2026-07-04, hub `a23a7d9`,
    clients `fb97442`) — `PATCH /me` now broadcasts a hub-wide
    `member_updated` WS event carrying the fresh name/avatar; the client
    updates the member in its `users` map in place, so display-name/avatar
    changes show live on other clients without a reload. `e2e/live/29`.
  - **Banner channels manageable from the web sidebar** (2026-07-05,
    clients `47ee91f`) — admins get a management row (name + settings
    gear) plus a right-click context menu on banner rows, so they can
    rename/delete like any channel; members still see just the image.
    `e2e/live/11`.
  - **`packages/core` crypto test vectors regenerated** (2026-07-04,
    clients `fb97442`) — `src/identity/crypto.test.ts` asserted pre-rename
    wire tags and was excluded from the suite; regenerated the
    DhKeyRecord + DM-envelope vectors against the canonical
    `wavvon-identity` values and re-enabled it.
  - **Hub switch / fresh load left the message pane empty** (2026-07-04,
    clients `42a3390`) — `loadHubData` auto-selected the first channel but
    never fetched its messages, so the pane stayed empty until a manual
    click. It now fetches + subscribes the auto-selected channel (guarded
    against a racing manual selection). `e2e/live/30`.
  - **Web mock-API e2e (`forum.spec.ts`) repaired** (2026-07-05, clients
    `46fa57e`) — `injectSession` now also seeds the IndexedDB
    `wavvon/identity/main` record; the catch-all mock route falls back to
    the specific mocks instead of the network, the list-posts mocks match
    the query string, and the reaction test keys off the POST landing.
    5/5 green.
  - **Web role appearance controls on built-in roles** (2026-07-04,
    clients `42a3390`) — `RolesSection` no longer renders the
    color/icon/category controls for `everyone`/`Owner` (the hub rejects
    appearance PATCHes on built-in roles); permissions remain editable.
    `e2e/live/31`.
  - **Icon pickers can no longer store non-rendering shortcodes**
    (2026-07-05, clients `47ee91f`) — `EmojiPicker` gained a `unicodeOnly`
    prop that hides the hub-custom-emoji (`:name:`) section; the role,
    channel, category, and soundboard icon pickers pass it (the message
    composer still offers custom emoji). `e2e/live/32`.
  - **Test harness DB leak** (2026-07-04, hub `e203106`) —
    `create_test_db()` returns a `TestDbGuard` whose `Drop` issues
    `DROP DATABASE … WITH (FORCE)` (via a dedicated OS thread so it fires
    on panic too); verified 0→0 leaked DBs across back-to-back full-suite
    runs. A `db_sweep` `#[ignore]`d test clears any backlog. The farm/seed
    equivalent is still open (ROADMAP Known issues).

- **Multi-device pairing + home-hub write (web, 2026-07-04)** — ported the
  identity envelopes that were Rust-only into `packages/core`
  (`master`/`wire`/`ecies`, byte-for-byte pinned by the `wavvon-identity` hex
  vectors), then built the two features it unblocked: publishing a
  master-signed home-hub list, and full device pairing (offer → claim →
  approve → cert), device list + revoke. Auth now presents the subkey cert and
  records the canonical pubkey, so a paired device is recognised as the same
  user. `e2e/live/27` (home hubs) + `28` (pairing). Closes the last two web
  parity gaps — see [`client-parity.md`](client-parity.md).

- **Web e2e live-test suite + 2026-07-04 batch live pass** — new
  `apps/web/e2e/live/` Playwright suite runs against a real hub (owner
  seeded via `WAVVON_OWNER_PUBKEY`; see `e2e/live/README.md`). Covers
  smoke (onboard/join/send), nested-channel permalinks + drill-in +
  breadcrumbs, channel permission overwrites, role categories +
  color/icon, event slots + reminders, temp-voice spawner (1fc5aa6
  regression), soundboard upload/delete, and full-archive export. Bugs
  found + fixed during the pass:
  - **W (web): channel live-push broken for newly-created channels** —
    the web client never sent the WS `subscribe` frame (the platform
    `subscribeChannel` hit a non-existent HTTP route), so messages in a
    channel created after connect never pushed live. Now sends the WS
    frame and subscribes on channel select.
  - **W (web): event creation fully broken** — composer never sent
    `channel_id` (hub 400), and the bare create-response (no
    `rsvp_counts`/`slots`) crashed `EventCard`; threaded `channel_id`
    through and refetch after create.
  - **W (web): modal clipped tall content** — `.modal` had no
    `max-height`, so the channel Permissions tab's Save/actions row was
    pushed off-screen. Added `max-height`/`overflow-y`.

- **Web e2e round 2 — profile / member list / channel CRUD / roles
  (2026-07-04)** — added `e2e/live/09..12`: profile-edit propagation, member
  presence, channel/category/forum/banner CRUD, and role-assignment. Bug
  found + fixed:
  - **W (web): i18n placeholders shown literally** — 11 catalog entries
    used i18next double-brace `{{name}}` syntax, but the client uses
    **i18next-icu** (single-brace `{name}`), so they rendered the raw
    `{{name}}` to users. Most visible on the channel/category right-click
    menu (`Edit "{{name}}"` / `Delete "{{name}}"`); also user profile
    "Joined", archive strength/progress, invite/discovery hints. Converted
    all to single-brace in `packages/i18n/en.json`.

- **Web: assign/remove roles from the member right-click menu (2026-07-04)**
  — closed the biggest client discrepancy found in round 2. The web
  `UserContextMenu` now has a "Roles" section (gated on `manage_roles`,
  hides `everyone` and roles at/above the viewer's priority) that toggles
  `PUT`/`DELETE /users/{pubkey}/roles/{role_id}`; member list regroups on
  change. New platform commands `assignRoleToUser`/`removeRoleFromUser`/
  `listUserRoles`; covered by `12-role-assignment.spec.ts`. Cross-client
  parity is tracked in [`client-parity.md`](client-parity.md)
  (**android still lacks it**; desktop has a near-identical version to
  align).

- **Soundboard — web UI (2026-07-04)** — clients `eed7c04`.
  **Client-side mix is real** (`mixClipIntoFrame` in `platform/voice.ts`):
  a clip decoded via `AudioContext.decodeAudioData` (handles Opus-in-Ogg,
  resamples to 48kHz, mono downmix) is sample-added onto each mic frame
  with a `[-1,1]` clamp *before* the int16 quantize + Opus encode, so
  it's baked into the sender's own outgoing stream (zero relay change,
  per soundboard.md §1). Voice-bar `SoundboardPopover`, hub-admin
  `SoundboardAdminSection` (upload/list/delete + local preview),
  `soundboard_played` chips via `useSoundboardChips`. Rate-limited to
  one clip at a time. 109 web tests green. **Caveat**: the `use_soundboard`
  play-gate is checked against hub-wide roles, not channel-scoped
  overwrites (see the "no member-facing channel-perms endpoint"
  follow-up in ROADMAP) — the server still enforces the real
  channel-scoped check on `played`, so a denied member's play 403s.

- **Soundboard + bot audio injection — server (2026-07-04)** —
  [`soundboard.md`](soundboard.md), hub `ef9beed`. `soundboard_clips`
  table; `use_soundboard`/`manage_soundboard` permissions (in
  `ALL_PERMISSIONS`, so channel-deniable); list/upload/delete/audio/
  played routes with Opus-in-Ogg validation (OggS + OpusHead, duration
  from the final page granule) and hard caps (≤10s / ≤512KB / ≤50
  clips); `soundboard_played` WS attribution event (channel-scoped
  fan-out; enforcement is the `use_soundboard` check, not audio
  inspection). **Bot audio injection (Part B) also shipped**: external
  `is_bot` sessions on `/voice/ws` are gated on the `can_speak_voice`
  capability + channel `read_messages` before relay registration; the
  older self-service `/bots/:id/voice/join` REST helper predates the
  capability model and was left untouched. 11 soundboard + 2 bot-voice
  tests. Web UI (voice-bar popover, client-side PCM mix, admin manage,
  `played` chip) is the next pass.

- **Join-to-create temporary voice channels — web UI (2026-07-04)** —
  clients `fb607de`. Spawner option + "room name template" field in
  `CreateChannelModal`; spawner rows click-to-voice-join (no
  unread/draft/voice badges); temp rooms show a "Temporary" badge +
  owner tooltip; voice UI state re-keyed off the *resolved* channel id
  from the join reply. `channels_updated` was already handled by the
  web WS layer, so temp spawn/GC refetch works for free.
  **⚠️ Does not yet function end-to-end on web** — see the `voice_ws.rs`
  spawner gap in ROADMAP Known issues: web's `/voice/ws` transport
  never got the spawn-detection the main-hub-WS path did, so clicking a
  spawner currently joins the spawner row itself. The web client is
  correct-by-construction (uses the reply's resolved id); the hub-side
  gap is the blocker.

- **Join-to-create temporary voice channels — server (2026-07-04)** —
  [`temp-voice-channels.md`](temp-voice-channels.md), hub `3005fc5`.
  Additive `channels` columns (`is_temporary`, `owner_pubkey`,
  `spawner_name_template`, `empty_since`); `channel_type = 'spawner'`
  validated on create; voice-join against a spawner runs
  `spawn_temp_channel()` (sibling placement under the spawner's parent,
  `{user}` template substitution, numbered-suffix collision retry) and
  the `voice_joined` reply carries the spawned room's id;
  `temp_channel_worker.rs` 30s tick stamps `empty_since` and GCs rooms
  past a 60s grace (boot-sweep via the same path); owner-rename
  carve-out in `update_channel`. 7 integration tests. **Deviation**:
  the doc specified a new `channel_list_changed` WS event, but the
  codebase already had an equivalent payload-free `channels_updated`
  event (fired on channel create/update/reorder/delete) — reused it for
  spawn/GC rather than fragment the wire protocol. Web consumes
  `channels_updated`, not `channel_list_changed`. Web UI (spawner
  creation option, temp-room badge) is the next pass.

- **Personal data export — export half (2026-07-04)** —
  [`data-export.md`](data-export.md), web only (clients `542891e`).
  Client-assembled passphrase-encrypted archive (no server changes —
  the DM route is unpaginated so one fetch per conversation = complete
  history). New `archiveCrypto.ts` ships a self-contained
  `wavvon-archive` envelope: Argon2id (64 MiB/t=3/p=1, `@noble/hashes`)
  → AES-256-GCM (WebCrypto); **deliberately not** byte-matched to the
  desktop identity-backup format (cross-client compat deferred).
  `dataExport.ts` assembles identity (incl. seed material, matching the
  identity-backup policy), home-hub designations, device certs +
  revocations, full per-peer DM history, active theme, and local
  drafts; aborts on any fetch failure rather than shipping a partial
  archive. `FullArchiveSection.tsx` settings card (passphrase +
  plaintext-DM warning + progress). **Gap**: web has no decrypt path
  for the hub-synced E2E prefs blob, so `prefs` is a local-only
  snapshot with a `gap_note` in the archive — wiring the real blob
  decrypt is a follow-up. **Import/restore deferred** (§5); only the
  export half shipped. 83 web tests green.

- **Event role-slot sign-ups + reminders, web client (2026-07-04)** —
  [`events.md`](events.md) §2-§3, clients `dea0df0` (server side
  shipped separately, hub `825b0da`). `EventComposer.tsx` gained a
  slot editor (add/remove name+capacity rows, folded into the create
  payload) and a reminder offset picker (Off/15m/1h/24h); `EventCard.tsx`
  now renders a read-only reminder line and delegates slot rows to a
  new `EventSlotList.tsx` (claim/unclaim via `POST /events/:id/rsvp`
  with/without `slot_id`, claimed slot bolded, claimants by short
  pubkey, 409/404 surfaced inline). New `EventSlotEditor.tsx` keeps the
  composer under the ~200-line convention. Platform adapter gained
  `createEventSlot`/`updateEventSlot`/`deleteEventSlot` (not yet wired
  to a UI — no post-creation slot-management surface exists yet).
  Fixed a pre-existing bug where the web `HubEvent` type used `end_at`
  while the hub's field is `ends_at` (silently dropped on create).
  Pure slot/reminder logic (fill-state, claim/unclaim payloads,
  reminder-offset↔minutes mapping) covered by vitest. Desktop/Android
  UI not yet built.

- **Discord server import CLI (2026-07-04)** — new
  `crates/discord-import` workspace crate implementing
  [`discord-import.md`](discord-import.md) (server `a85e37f`).
  `export --guild <id>` reads structure via a read-only bot
  (Discord API v10, 429-aware) into the neutral versioned manifest;
  `apply --hub <url>` replays it onto a fresh hub (demo-seed-style
  auth, fail-forward, created/skipped/warnings report with PARTIAL
  banner). Pure fixture-tested layers (mapping, permission-bit table
  bits 0–50, plan/topological ordering, report rendering; 29 unit
  tests) around thin reqwest executors. Role colors applied directly
  (role appearance had shipped by then — the doc's "once color ships"
  clause resolved in the same day). NOT yet exercised live against a
  real guild or running hub — fixture-only by design; live e2e is the
  remaining step.

- **Role categories + role color/icon, web client (2026-07-04)** —
  [`role-categories.md`](role-categories.md) §4, clients `a6b2d24`
  (server side shipped separately, hub `31c291b`). Types + platform
  adapter (`listRoles`/`createRole`/`updateRole`/`deleteRole`,
  `listRoleCategories`/`createRoleCategory`/`updateRoleCategory`/
  `deleteRoleCategory`, tri-state null-clearing payload builders with
  vitest coverage). Hub-admin Roles tab now lists every hub role
  (previously it rendered only the current user's own roles — a
  pre-existing gap, not a regression) grouped under category headers,
  with a `RoleCategoryManager` for create/rename/recolor/re-icon/
  reorder(up-down)/delete, and per-role category dropdown + color
  swatch + `EmojiPicker` icon controls. User profile card groups
  `profile.roles` by category with a trailing uncategorized group;
  role badges tint border/text via `color-mix()` against the theme's
  own foreground (not the raw hex) to keep contrast in both themes.
  Categories cached module-level in `UserProfileCard.tsx` keyed by hub
  id. Member sidebar untouched per the doc's decided scope. Desktop/
  Android parity not started — see Wishlist.

- **Deep-nesting sidebar (2026-07-04)** — §2 of
  [`nested-channels-ux.md`](nested-channels-ux.md), web only (clients
  `2289304`). Capped indent (`min(depth,5)×12px` + `aria-hidden` depth
  marker past the cap; true depth kept in `aria-level`); drill-in via a
  dedicated ⤢ button on categories at depth ≥4 (button, not header
  click — the header is a drag handle) re-rooting the sidebar with a
  `channelPath` back-crumb, aria-live announcement, and real focus
  movement. Cross-boundary drags while drilled-in are blocked for free
  by the existing render-what's-visible dnd architecture. Pure helpers
  in `channelSidebarLayout.ts` with vitest coverage. **Also fixed a
  latent bug**: sidebar arrow-key navigation had never focused real DOM
  elements (`channelItemRefs` was never populated) — keyboard nav works
  for the first time. With §1 and §3 shipped this completes
  `nested-channels-ux.md` entirely.

- **Channel permalinks (2026-07-04)** — §1 of
  [`nested-channels-ux.md`](nested-channels-ux.md), web only (clients
  `bed7fe3`). `parseHubInput` now returns an optional `target`
  (`channel/{id}` / `channel/{id}/message/{id}`), fixing
  message-permalink navigation as a side effect (the web
  scroll-to-message handler was a no-op — now real, also used by
  reply-jump/pinned-jump). `channelPath()` helper in `packages/core`
  (cycle-guarded); deep-link targets carried through the add-hub flow;
  "Copy channel link" in the channel context menu + header button
  (no overflow-menu precedent existed, so an icon button); breadcrumb
  header with clickable category crumbs scrolling the sidebar.
  `packages/core` gained its own vitest script (17 new tests) — which
  surfaced the stale pre-rename crypto test vectors now in ROADMAP
  Known issues. First-run zero-hub permalink carry-through
  deliberately not wired (edge case; `AddHubModal` path only).

- **Channel permission overwrites (2026-07-04)** — the §3 "cascade like a
  file system" mechanism from [`nested-channels-ux.md`](nested-channels-ux.md).
  Server (hub `5912459`): `channel_permission_overwrites` table;
  `channel_permissions()` resolver (root→target fold, allow-wins at same
  level, child-over-parent, `admin` immune); channel-scoped checks in
  messages/posts/channels, WS auto-subscribe, and voice join (gated on
  channel-scoped `read_messages` — no voice-specific constant exists);
  nested channel creation checks `MANAGE_CHANNELS` on the parent;
  channel-list read-gating server-side; GET/PUT/DELETE
  `/channels/:id/permissions[/:role_id]` with audit-log entries; 7
  integration tests in `hub/tests/channel_permissions_flow.rs`. Client,
  web only (clients `a4e1366`): tri-state Permissions tab
  (`ChannelPermissionsTab.tsx`, ghost inherited values, override dots,
  Save/Reset per role) in `ChannelSettingsModal.tsx`, three
  `platform/commands/channelPermissions.ts` adapter functions,
  empty-category suppression in the sidebar for non-admins, i18n ×4
  locales, 7 unit tests. Not yet visually verified in a running client;
  desktop/Android UI parity deferred per delivery-target decision.

- **Outgoing webhooks (2026-07-02)** — admin registers external HTTPS URLs;
  hub POSTs HMAC-SHA256-signed `hub_event` envelopes on matching events
  (fire-and-forget, no bot identity/WS session needed). New
  `hub/src/outgoing_webhooks/` module: 9 admin routes (added a `GET
  .../subscriptions` read-back beyond the original 8-route spec so the UI
  can pre-fill the subscription editor instead of blind-overwriting it),
  delivery worker with 4-attempt retry (5s/30s/5min), auto-disable after 5
  consecutive failures, last-200 delivery log per webhook. Dispatch hooks
  directly into `publish_hub_event` (`bots/events.rs`) — the design doc
  originally described a broadcast channel that doesn't exist in this
  codebase; doc corrected to match. Web admin UI only (desktop deferred
  per delivery-target decision): `OutgoingWebhooksSection.tsx` +
  `EventSubscriptionEditor.tsx` (new, reusable — bots don't have an event
  subscription UI yet) + `platform/commands/outgoingWebhooks.ts`. 13
  integration tests in `hub/tests/outgoing_webhooks_flow.rs`. See
  [`outgoing-webhooks.md`](outgoing-webhooks.md).

- **Moderation enhancements ME1/ME2/ME3 (2026-07-02)** — ME1: `federated_ban_sources`
  + `federated_ban_overrides` tables; admin CRUD routes at `/admin/banlist/sources|entries|overrides`
  and `/admin/settings/banlist`; banlist_worker reads per-source policy; auth layer
  applies whitelist/blacklist overrides. ME2: `WebhookCircuit` in `AppState`; circuit
  breaker on 3× 5xx in 60s → 10-min backoff; `GET /admin/settings/moderation` exposes
  state. ME3: server was already shipped; web client adds report button on messages +
  admin Reports queue. Web admin Moderation tab covers all three features.

- **Code audit — all 46 findings resolved (2026-06-27)** — H9 CORS warn, H11
  get_messages N+1 → 3 bulk queries, H14 list_members N+M+1 → 3 queries + LIMIT
  1000, H15 farm-token auth 5 reads → 1 query, H16 federated DM delivery
  background tokio::spawn, H17 tantivy Mutex unwrap, H20 chat broadcast capacity
  256→4096, H21 handle_typing ban check, H22 badge-offer rate-limit + duplicate
  guard, H23 preview SSRF proxy-aware + redirect IP guard. DB indexes H12/H13
  verified present. W25/W27 already fixed by monorepo consolidation + identity
  refactor. Full finding list: [`code-audit-2026-06-11.md`](../code-audit-2026-06-11.md).

- **Per-hub subkey revocation propagation (2026-06-30)** — background worker polls
  each master key's home hub every 6 hours, verifies Ed25519 signatures, and inserts
  new revocations into the local `subkey_revocations` table. See
  `subkey_revocation_worker.rs`.

- **First user silently becomes hub owner — fixed (2026-06-27)** — removed
  auto-grant from `assign_initial_roles`; hub now starts ownerless and warns on
  startup when `WAVVON_OWNER_PUBKEY` is unset. Found live on the external pilot hub.

- **Design review + pilot feedback resolved (2026-06-27)** — all 10 web client
  design-review items and all desktop pilot-feedback items (D1–D9) fixed: composer
  layout, poll fetch on channel switch, i18n wiring, display-name prompt, message
  anatomy, voice control bar, emoji picker, chat column max-width, channel hash
  glyph, WelcomeScreen browse wiring, whisper portal, camera picker, leave-voice
  button, screen-share picker thumbnails, role submenu, banner channel editing.
  Details: [`design-review-2026-06-13.md`](../design-review-2026-06-13.md) and
  [`pilot-feedback-2026-06-12.md`](../pilot-feedback-2026-06-12.md).

- **Forum reactions + attachments (2026-07-01)** — `post_reactions` and
  `reply_reactions` tables added; `attachments` JSON column on `posts` and
  `post_replies`; four new endpoints (`POST/DELETE /posts/:pid/reactions`,
  `POST/DELETE /replies/:rid/reactions`); reactions and attachments included in
  `PostDetail` and `ReplyView`; 6 integration tests in `forum_flow.rs`. Web client:
  `ReactionBar` component on posts and replies, attachment list + file picker shell
  in `ForumComposer`, Playwright E2E test suite (5 tests, mocked API).

- **`cargo test --workspace` works on Windows (2026-07-01)** — two blockers
  fixed: (1) `webauthn-rs-core` depends directly on `openssl-sys`; resolved by
  adding `openssl = { version = "0.10", features = ["vendored"] }` to
  `hub/Cargo.toml` (forces a source build; requires cmake and Strawberry Perl, both
  now installed as dev tools) and switching `wavvon-seed`'s `reqwest` to
  `default-features = false, features = ["json", "rustls-tls"]`. (2)
  `create_test_db()` needs a live PostgreSQL; `server/docker-compose.dev.yml` added
  (`docker compose -f docker-compose.dev.yml up -d` before running tests).

- **Remove games feature (2026-07-01)** — replaced by bots; iframe/session
  infrastructure dead weight. All 11 sub-tasks (S1–S5, D1–D3, W1, A1, Docs)
  completed: hub routes/WS/farm game handling removed; `GameStore` trait and
  database tables dropped; desktop/web/android client game modals and state removed;
  docs updated (`gaming.md` and `games-sdk.md` deleted; `/games/*` removed from
  openapi.yaml and ws-protocol.md; bot deferred-scope known issue updated).

- **Bot mini-apps + bot media (2026-07-01)** — generic mechanism for bots to
  embed interactive web experiences and inject audio/video into channels.
  All 9 sub-tasks (M1–M8, Docs) completed: `mini_app_url` field added to bot
  registration; `bot_app_launch`/`join`/`open`/`close` WS messages implemented;
  hub endpoints for bot voice and screen-share (`POST/DELETE /bots/{id}/voice/*`,
  `POST/DELETE /bots/{id}/screenshare/*`); desktop/web/android clients open
  sandboxed webviews/iframes with injected token and hub context; camera
  permission CSP plumbed; docs updated with WS protocol and operator guide.

- **Fix the aarch64 hub binary build (2026-07-01)** — replaced
  `aarch64-linux-gnu-gcc` (GNU ABI, incompatible with musl) with
  `cargo-zigbuild` (Zig provides its own musl headers; handles aws-lc-sys/ring
  C objects cleanly). x86_64 and Docker builds unchanged.

- **Voice enhancements V1–V4 (2026-07-01)** — four sequenced improvements to
  the voice pipeline. All four phases completed:
  - **V1 — Per-participant volume control** — hub and desktop already fully done;
    web and Android wired: per-sender `GainNode` in `voice.ts`, `ChannelSidebar`
    gain slider, `App.tsx` wiring, Android `set_voice_gain` Tauri command +
    `StoredVoiceSettings`. Vitest 4/4.
  - **V2 — Voice audio quality profiles** — `AudioProfileSection` moved to
    `packages/ui`; desktop re-exports as shim; web `SettingsPage` Voice tab
    wired; Android `StoredVoiceSettings` extended. Workspace typecheck clean.
  - **V3 — Proximity voice** — hub side pre-existing; server integration tests
    (`proximity_voice_flow.rs`, 4 tests) + web client attenuation shipped:
    `computeAttenuation()` (4 models), zone lifecycle handlers,
    `recomputeAllProximityGains` on every position update; WS dispatch in
    `ws.ts`. 18 vitest tests.
  - **V4 — Voice encryption (Phase 2)** — AES-256-GCM per-packet on Opus stream;
    hub relays ciphertext transparently; `VoiceKeyOffer`/`VoiceKeyReceived`/
    `VoiceKeyRequest` WS key distribution with X25519 ECDH; `ws_key_senders`
    map in AppState for targeted delivery. 4 integration tests.

- **Hub creation wizard (2026-07-01)** — zero-to-live path for new operators.
  All three pieces shipped:
  - **HW1 — Template catalog on discovery** — `POST/DELETE /api/templates/register`
    (Ed25519-signed, ownership-checked); 8 vitest tests.
  - **HW2 — First-run bootstrap in hub** — `maybe_bootstrap()` fetches template
    URL, applies channels/roles/settings/welcome message; 4 integration tests.
  - **HW3 — Creation wizard on discovery** — `/new` web flow generates
    `docker-compose.yml` download.

- **E2E v2 — Double Ratchet (2026-06-30)** — 1:1 DMs upgraded from static ECDH
  to Signal Double Ratchet: per-message forward secrecy and post-compromise
  recovery. Session init via 2DH (static × static seeds root key; ephemeral ×
  static seeds first sending chain). KDF_RK / KDF_CK / derive_nonce via
  HKDF-SHA256 with `wavvon/dr-*` domain strings. v2 envelope adds `v`,
  `message_index`, `prev_count`; no `nonce_hex` (nonce derived from msg key).
  Skipped-key cache (cap 1000) handles out-of-order delivery. Implemented in:
  identity crate (`dr_envelope_signing_bytes`), hub models + signing dispatch,
  Tauri `dm.rs` (`init_dr_session`, `encrypt_dm_dr`, `decrypt_dm_dr` commands),
  TypeScript `core/crypto.ts` (`initDrSession`, `encryptDmDr`, `decryptDmDr`).
  Group DMs keep the sender-key scheme; X3DH one-time prekeys are v3.

- **Passkey login in AddHubModal (2026-06-30)** — "Sign in with passkey" button
  appears in the modal when the hub is reachable, WebAuthn is supported, and the
  user has a public key. Runs the assertion ceremony via `authenticateWithPasskey()`,
  then passes the session token to `addHub({ sessionToken })` to skip the Ed25519
  challenge flow. Error handling and loading state shared with the standard Connect
  path.

- **Client-side passkey flows (2026-06-30)** — web client: `platform/webauthn.ts`
  with full passkey registration + assertion ceremony (manual base64url/ArrayBuffer
  conversion, no external dependency), plus management API calls (list/delete/rename
  passkeys, list/revoke trusted devices) via hubFetch; PasskeySection and
  TrustedDevicesSection added to the Account tab; `addHub()` accepts `sessionToken`
  to allow passkey-obtained tokens to bypass Ed25519 auth. Desktop: five new Tauri
  commands (`passkey_list/delete/rename`, `trusted_device_list/revoke`) using the
  shared http_client + stored session token; PasskeySection + TrustedDevicesSection
  wired into the Security tab (view/rename/remove only — desktop cannot register
  passkeys due to Tauri webview RP ID mismatch with the hub's domain).

- **WebAuthn/passkey auth — hub server layer (2026-06-30)** — hub now supports
  passkey registration and login via webauthn-rs 0.5 as a parallel auth path
  alongside the existing Ed25519 challenge/verify flow. New endpoints:
  `POST /auth/webauthn/begin` + `/finish` (register a passkey),
  `POST /auth/webauthn/assert/begin` + `/finish` (authenticate),
  `POST /auth/device-token/create` (mint a 30-day "Trust this device" token),
  `POST /auth/device-token/redeem` (exchange for session token; rotates on use).
  Credential management at `GET/PATCH/DELETE /me/credentials`; trusted device
  management at `GET/DELETE /me/devices`. `rp_id` derived from
  `WAVVON_PUBLIC_URL` hostname; override via `WAVVON_WEBAUTHN_RP_ID`. Device
  token TTL configurable via `WAVVON_DEVICE_TOKEN_TTL_DAYS` (default 30).
  New DB tables: `webauthn_credentials`, `device_tokens`. Eight integration
  tests in `hub/tests/webauthn_flow.rs`.

- **Per-hub subkey revocation propagation (2026-06-30)** — background worker
  (`subkey_revocation_worker`) discovers all distinct `(master_pubkey,
  home_hub_url)` pairs from `subkey_certs`, polls
  `GET /identity/{master}/revocations?since={cursor}` on each home hub every
  6 hours, verifies the Ed25519 signature on each entry, inserts valid
  revocations into `subkey_revocations` with `ON CONFLICT DO NOTHING`, and
  advances the cursor with `GREATEST()`. `GET /identity/{master}/revocations`
  endpoint gained a `?since=` query param. New `subkey_revocation_sync`
  migration table tracks per-`(master, hub)` cursor. Five integration tests
  in `hub/tests/subkey_revocation_relay_flow.rs`.

- **Cross-farm cert revocation relay (2026-06-29)** — hub now polls every
  remote cert issuer it knows about for revocations. A new
  `cert_revocation_sync` table tracks the per-issuer cursor; a background
  worker (`cert_revocation_worker`) fires 2 min after startup then every 6
  hours: discovers all distinct `(issuer_pubkey, issuer_url)` pairs in
  `user_certs`, calls `GET {issuer_url}/certs/revocations?since={cursor}`
  on each, deletes the matching `user_certs` rows, and advances the cursor
  with `GREATEST()` so it never goes backwards. Unreachable issuers are
  silently skipped (certs retained). Five integration tests in
  `hub/tests/cert_revocation_relay_flow.rs`.

- **Farm agent WS token moved to first message frame (2026-06-29)** — token no
  longer appears in the `/ws/agent` URL and therefore in access logs. Agent now
  connects to `/ws/agent` (no query param) and sends
  `{"type":"hello","version":"...","token":"<hex>"}` as its first frame; server
  validates token there before registering the connection. Invalid or missing
  token receives `{"type":"error","code":"auth_failed"}` and the socket closes.

- **Timestamp hygiene complete (2026-06-29)** — five farm route files each
  had a private copy of `unix_now()`; consolidated into a single `pub fn
  unix_now()` in `wavvon-farm/src/lib.rs`. Seven hub test-migration columns
  (`channel_voice_mutes.muted_at`, `raise_hand_requests.requested_at`,
  `badge_offers.created_at`, `hub_badges.accepted_at`,
  `issued_badges.issued_at/expires_at/revoked_at`) changed TEXT → BIGINT;
  handlers and response models updated to use `i64`. `"chrono"` sqlx feature
  removed from workspace `Cargo.toml`. `iso_from_unix` unified into a single
  `pub fn` in `auth/handlers.rs`; `badges.rs` local copy deleted.

- **Full PostgreSQL backend (2026-06-27)** — SQLite removed from the server
  entirely; `wavvon-store-sqlite` crate deleted and replaced by
  `wavvon-store-postgres`. sqlx features trimmed to `postgres + runtime-tokio
  + macros + chrono + uuid`; hub, seed, and farm all use `PgPool`/`PgPoolOptions`.
  New `wavvon-store-postgres` crate (19 impl files) covers every `HubStore`
  sub-trait with PostgreSQL DDL. All 18 hub integration test files updated to
  create a fresh isolated PostgreSQL database per test (UUID-named, migrations
  pre-applied) via `create_test_db()` in `tests/common.rs`. CI gains a
  `postgres:16-alpine` service container with health checks and `TEST_DATABASE_URL`
  wired to `cargo test`.

- **Web client stabilisation pass (2026-06-22/23)** —
  Welcome screen gated on `hubs.length === 0`; "Hosted by [url]" link added to
  `WelcomeScreen` and `AddHubModal` hub preview cards.
  `CreateChannelModal` wired from all three entry points; added Banner and
  Category types alongside Text and Forum. `ChannelSettingsModal` created —
  pre-filled name/description edit, two-step delete confirmation; accessible via
  gear icon and right-click context menu. WS event audit: `forum_event`, all
  screen-share signalling, and video/whisper events wired into `ws.ts` dispatch.
  Profile: `SettingsPage` calls `onProfileSaved` after `PATCH /me`; `App.tsx`
  re-fetches `/me` and `/users` so display name updates immediately.

- **Web client audit remainder (W5–W24) — 13 findings fixed (2026-06-14)** —
  W5: reactions broadcast preserves `me` flag. W7: `voice_participant_speaking`
  wired; speaking ring lights. W9: `dm_member_changed` WS event handled. W11:
  poll event names fixed; `onPin`/`onPoll` wired. W14: events types corrected
  (`starts_at`, `rsvp_counts`); RSVP uses POST/cancel. W15: farm unsuspend
  uses correct endpoint. W17: pending-approval hub shows landing screen. W18:
  alliance shared channels fetched on hub connect. W19: mention pings play audio
  + OS notification on permission. W20: `pingHub` called on interval. W21:
  `UserContextMenu` wired; right-click on members works. W22: group-DM
  `group_encrypted_envelope` handled. W23: scroll position tracked; "N new
  messages" pill wired. W24: unmounted components cleanup.

- **CI build fixes (2026-06-14)** — Android: `@noble/curves` and
  `@noble/hashes` added as direct deps, resolving Rollup import failure.
  Desktop macOS: `xcap` bumped 0.0.14 → 0.9.6 (E0282 fixed); call sites in
  `screen_share.rs` updated for new API. Auto-tag correctly dispatches release
  workflows via `gh workflow run`.

- **App.tsx decomposition — channel-message, alliance, WS hooks (2026-06-14)** —
  desktop App.tsx 3,259 → ~1,450 lines; android App.tsx 993 → ~560 lines.
  Desktop: `useChannelMessages`, `useAlliances`, `useWsHandlers` extracted.
  Android: same three hooks; stableHandlers wired via stable setter refs.
  pnpm typecheck clean across all three apps.

- **Desktop voice/composer UI pass + web screen-share viewing (2026-06-13)** —
  attach+poll collapsed into a "+" menu in desktop `ChannelComposer`; voice
  control bar buttons replaced with SVG icons; joining a new voice channel now
  implicitly leaves the current one; camera button enumerates devices on first
  enable; screen-share source grid gains `max-height`. Web screen-share VIEWING
  now works — `HubWebSocket` gains binary frame support and `App.tsx` wires
  `activeScreenShares` state through to the existing `ScreenShareViewer`.

- **Hub: first-user-becomes-owner bug fixed (2026-06-13)** — `assign_initial_roles`
  now skips the auto-owner grant when `WAVVON_OWNER_PUBKEY` is configured.
  `AppState` gains `owner_pubkey: Option<String>`.

- **H4 federated-DM sender spoofing fixed (2026-06-13)** — Ed25519
  signature verification is enforced on all three receive-federated-DM
  paths (encrypted, group-encrypted, plaintext) in
  `hub/src/routes/dms/messages.rs`. All hub audit findings from the
  2026-06-11 audit are now resolved.

- **Web voice via WebSocket audio relay (2026-06-13)** — browsers cannot send
  raw UDP, so hub gains a `/voice/ws` WebSocket endpoint; web clients
  authenticate with the session token + channel_id, receive a `voice_ws_ready`
  JSON frame, then exchange binary Opus frames. Hub fan-out routes to both UDP
  (desktop/android) and WS (web) participants. Web client gains `opusscript`
  (WASM Opus encoder/decoder) and a new `VoiceWsSession` class. All four clients
  now participate in shared voice channels.

- **Client monorepo consolidation — all 5 stages complete (2026-06-13)** —
  Wavvon-desktop, Wavvon-web, and Wavvon-android collapsed into the single
  Wavvon-client pnpm + Cargo monorepo. Stage 0 (scaffold), Stage 1
  (`packages/core`), Stage 2 (`@wavvon/utils` + noble crypto), Stage 3
  (`packages/ui` + 10 shared components), Stage 4 (`packages/platform` +
  android collapse), Stage 5 (CI consolidated — path-gated per-app jobs).
  Double-React hazard eliminated, cross-repo Vite alias eliminated,
  dual-checkout release eliminated.

- **Hub optionally self-serves the web client (2026-06-13)** — new
  `WAVVON_WEB_CLIENT_DIR` setting. When set, hub serves a pre-built SPA at
  `/` via tower-http `ServeDir` with SPA deep-link fallback. `index.html`
  cached at startup with `window.__WAVVON_HOME_HUB__` injected. Official Docker
  image gains a `node:22-slim` web-builder stage. 7 integration tests in
  `hub/tests/web_client_flow.rs`.

- **Networked voice Phase 1 — token-gated source-address learning (2026-06-12)**
  — hub relay no longer registers clients as 127.0.0.1. On `voice_join` the hub
  mints a 32-byte single-use UDP register token delivered in the `voice_joined`
  WS reply. The client sends a VXRG packet; the hub binds the real source address
  into `voice_addr_map` and replies VXRA. Fan-out gated on `voice_addr_map`
  membership. Five new integration tests in `hub/tests/voice_relay_flow.rs`.

- **H5/H6 rate-limiter trusted-proxy + IPv6 canonicalization (2026-06-12)** —
  `rate_limit.rs` gains `WAVVON_TRUSTED_PROXY` setting. When enabled, real
  client IP derived from last `X-Forwarded-For` entry. All IPs canonicalized:
  IPv4-mapped IPv6 collapses to plain IPv4; genuine IPv6 bucketed at /64 prefix.
  6 new unit tests.

- **H2/H3 presence refcount + bot_sessions per-session (2026-06-12)** —
  `online_users` changed from `HashSet` to `HashMap<String, usize>` (refcounted).
  `bot_sessions` changed from `HashMap<pubkey, Sender>` to
  `HashMap<pubkey, HashMap<session_id, Sender>>`; each WS session registers
  under its own UUID. 4 new tests in `hub/tests/presence_multi_session_flow.rs`.

- **Hub CORS layer + self-describing CLI (2026-06-11)** — `WAVVON_CORS_ORIGINS`
  env-var wires a tower-http `CorsLayer`; `--help` prints a generated env-var
  table, `--version` prints version, `--doctor` runs pre-flight checks. Startup
  banner logs effective port, scheme, UDP port, TLS state, CORS origins, and
  data-file paths. Four CORS integration tests added.

- **Real screenshots + join-flow GIF in READMEs; web client fixes; demo-seed tool (2026-06-11)** —
  screenshots and join-flow GIFs added to main/desktop/web/hub READMEs; web
  client desktop layout CSS fix, message ordering fix, onboarding improvements,
  voice roster bootstrap via `GET /voice/participants`; demo-seed tool added.

- **Web onboarding styling + voice roster bootstrap (2026-06-11)** — web
  client onboarding screens now match the app's visual style; missing `button`,
  `input`/`textarea`/`select` base CSS rules and utility classes added.
  Voice roster now populated on connect via `GET /voice/participants`;
  `voice_roster_update`, `voice_participant_joined`, and `voice_participant_left`
  WS events handled individually.

- **demo-seed tool (2026-06-11)** — new `tools/demo-seed` binary; populates a
  fresh running hub with 8 identities, 5 channels under 4 categories, ~30
  realistic messages, a poll, a pinned welcome message, and emoji reactions.
  Reads `HUB_URL`; writes credentials to `demo-credentials.json`.

- **ContentArea.tsx ports to all forks (2026-06-11)** — web (1,157 → ~320-line
  composition root), android/wavvon-desktop (979 → ~290), android/wavvon-web
  (881 → ~280) now mirror desktop's `components/content/` shape. tsc clean in
  all three apps; vitest web 6/6, android 14/14.

- **ws/connection.rs dispatch refactor (2026-06-11)** — introduced `ConnState`
  and a `DispatchResult` enum; extracted all match-arm logic into per-domain
  handlers under `routes/ws/handlers/`: `voice.rs`, `screen.rs`, `game.rs`,
  `chat.rs`, `bot.rs`. `connection.rs` is now 605 lines (was 1,910). All 250+
  tests green.

- **ContentArea.tsx desktop split (2026-06-11)** — 1,383-line `ContentArea.tsx`
  split into 9 files under `components/content/`. `ContentArea.tsx` is now 688
  lines. Props interface and export signature unchanged. tsc clean, vitest
  71/71, vite build succeeds.

- **Signing-service removal + spec CI gate (2026-06-11)** — all signing-service
  steps removed from desktop CI; hub CI now fails when a registered route is
  missing from `openapi.yaml` (currently 201/201 documented).

- **Desktop lib.rs module split (2026-06-11)** — 9,844-line desktop
  `src-tauri/src/lib.rs` split into 28 domain modules; `lib.rs` is now ~350
  lines. Zero TS-side changes required. `cargo clippy -D warnings`, `cargo fmt
  --check`, and all 38 tests green.

- **Hub route module splits wave 2 (2026-06-11)** — directory-module conversions
  for `dms.rs` (1,305 → 4 files), `bots.rs` (1,236 → 5 files), `alliances.rs`
  (1,119 → 5 files), `moderation.rs` (1,016 → 5 files). Zero route-path or
  public-API changes.

- **Big-file refactor wave 1 + complete API spec (2026-06-11)** — hub
  `routes/ws.rs` (2,101 → 4 files) and `routes/games.rs` (1,617 → 6 files),
  android Tauri `lib.rs` (5,332 → 559 + 14 domain modules), web `App.tsx`
  (1,402 → 1,255 via extracted hooks). `openapi.yaml` now documents all 201 hub
  routes (103 were missing), verified by `docs/scripts/check-openapi-coverage.mjs`.

- **App.tsx decomposition batch 3 (2026-06-11)** — DM cluster extracted into
  `desktop/src/hooks/useDms.ts`. App.tsx: 3,461 → 3,259 lines.

- **App.tsx decomposition batch 2 (2026-06-11)** — `useHubAdmin`, `useFriends`,
  and `useSettingsProfile` extracted into `desktop/src/hooks/`. App.tsx:
  3,937 → 3,461 lines.

- **UDP voice relay tied to WS session (2026-06-10)** — added `voice_relay_active`
  set to `AppState`; `VoiceJoin` inserts, `leave_voice` removes; UDP receive loop
  rejects packets from pubkeys absent from the set. Five integration tests in
  `hub/tests/voice_relay_flow.rs`.

- **Farm/seed/server/voice security sweep (2026-06-10)** — WS agent channel made
  bounded; DB error during token lookup now closes the socket; heartbeat endpoint
  rejects unknown hub pubkeys on DB error; proxy body capped at 32 MiB;
  `public_key` added to `/farm/public-info`; `agent::run` survives malformed JSON;
  voice pipeline tasks no longer panic on Opus init failure. Eight new integration
  tests added.

- **Hub wishlist quick wins (2026-06-10)** — `GET /preview` rate-limited (10/min),
  `POST /admin/search/reindex` for operator-driven index rebuilds, `federated_bans`
  enforced on outbound messages and DMs, dead `game_session_left` WS variant removed.

- **Full CI test coverage across all repos (2026-06-10)** — vitest suites gated in
  CI for web (6 tests), android/wavvon-web (14 tests), desktop (71 tests), and
  discovery (28 tests); web gains i18n coverage check; android gains `cargo fmt
  --check` and `cargo clippy -D warnings` gates.

- **WebSocket protocol documented (2026-06-10)** — complete message-by-message
  wire reference in `docs/ws-protocol.md` (34 client→server, 55 server→client
  messages, verified against hub source).

- **Workspace hardening batch (2026-06-10)** — hub security fixes (WS session
  validation, atomic invites, SSRF DNS-rebinding, federated-ban check on farm
  tokens, upload headers), client race/cleanup fixes + error boundaries, android
  parity restored, shared `@wavvon/utils` package, wire-format spec with
  cross-client byte-level vector tests, CI gains fmt/clippy gates and SHA-pinned
  actions.

- **Forum per-post read cursors (all 4 clients)** — `post_reads` table, `INSERT OR REPLACE` mark-read endpoint (`POST /channels/:cid/posts/:id/read`), `unread_reply_count` subquery on list/get; unread dot + count shown per thread row in all 4 clients. Design in [`forum.md`](forum.md).

- **Custom skins discovery gallery (all 4 clients)** — `skins` table in Wavvon-discovery with Ed25519 signature verification and SHA-256 content-addressed IDs; `GET /api/skins` (search/paginate) + `POST` (publish) + `DELETE` (author-signed removal); `SkinsGallery` component with search, base filter, and "Load more" in the Appearance tab of all 4 clients. Design in [`custom-themes.md`](custom-themes.md).

- **Database abstraction layer** — `wavvon-store` supertrait crate + `wavvon-store-sqlite` impl; `StoreError` enum mapping to HTTP codes; `AppState` gains `store: Arc<dyn HubStore>` alongside existing `db: SqlitePool` for incremental migration. Design in [`store-trait-design.md`](store-trait-design.md).

- **Custom user skins (all 4 clients)** — Fifth "Custom" slot in the theme picker. `skinValidation.ts` (token allow-list, forbidden-substring guard, `validateSkin`, `applySkinTokens/clearSkinTokens`, export/import helpers) shared across all clients. `SkinEditor` component: name field, base-theme selector, token groups (Surfaces / Text / Accent / Status / Border & Effects / Shadows / Radius), live preview via `setProperty`, per-token reset, Reset all, Export `.wavvonskin`, Import with validation. Desktop and android/wavvon-desktop persist via `load_appearance`/`save_appearance` Tauri commands (`~/.wavvon/appearance.json`); web and android/wavvon-web via `localStorage` key `wavvon:appearance`. Design in [`custom-themes.md`](custom-themes.md).

- **Block/ignore settings panel + DM-block server sync** — `BlockIgnoreSection` wired into all 4 clients (desktop, web, android/wavvon-web, android/wavvon-desktop); `toggleBlockUser` calls `PUT /identity/dm-blocks` on the active hub in all 4 clients so the server enforces DM blocking. Design in [`block-mute-ignore.md`](block-mute-ignore.md).

- **android/wavvon-desktop recovery contacts parity** — six Tauri commands (`list_recovery_contacts`, `set_recovery_contacts`, `remove_recovery_contact`, `list_admin_recovery_requests`, `approve_recovery_request`, `deny_recovery_request`) added to lib.rs with proper bearer auth; `RecoveryContactsSection.tsx` rewritten to use `invoke()` with correct field names (`pubkey`/`added_at`); workspace Cargo.toml fixed (added `wavvon-desktop/src-tauri` member, missing deps); `VoiceSettings` initializers updated for new audio profile fields.

- **android/wavvon-web recovery contacts parity** — `platform/commands/hubAdmin.ts` (recovery contact CRUD + admin queue commands), `RecoveryContactsSection.tsx` (contact list editor, K-of-N threshold, collapsible how-it-works guide, admin rotation-request queue with approve/deny), wired into `SettingsPage.tsx` Account tab alongside `IdentityBackupSection`. Types match actual server field names (`pubkey`/`added_at`).

- **E2E group DM member management** — hub `POST /conversations/:id/members` (add) and `DELETE /conversations/:id/members/:pubkey` (self-leave) routes; `DmEvent::MemberChanged` and `WsServerMessage::DmMemberChanged` wire the event to WS subscribers; `rotate_group_sender_key` Tauri command generates a fresh chain key (bumped version) for the remaining membership set; App.tsx handles `dm-member-changed` by refreshing conversations, deselecting if removed, and triggering key rotation.

- **Identity backup for android/wavvon-web** — `IdentityBackupSection` component (PBKDF2-SHA256 100k iterations + AES-256-GCM via `crypto.subtle`, same format as the web client) added to the Account tab of `SettingsPage`. Reads/writes the IndexedDB `IdentityRecord`; cross-client backup files are interchangeable between the web and android/wavvon-web clients.

- **Gaming Tier 1 capabilities enforcement** — hub `PUT /admin/games/:id/permissions` stores capability grants; `GET /admin/games` returns them; desktop `list_admin_games` and `set_game_permissions` Tauri commands wired end-to-end; admin UI in all four clients shows live capability toggles and explains their effect; `GameModal` enforces grants via `hasCapability()` before calling `game_post_message`, `game_get_recent_messages`, or `game_list_channel_users`.

- **Android multi-device pairing UI** — full device-pairing flow for android/wavvon-web: `identity/master.ts` (HKDF-SHA256 master key derivation matching the Rust crate), `identity/wire.ts` (wire format helpers byte-identical to Rust signing_bytes), `platform/commands/pairing.ts` (all eight pairing commands — getPairedIdentity, startPairingOffer, pollPairingStatus, completePairing, fingerprintPubkey, parsePairingOffer, claimPairingOffer, savePairedIdentity), `PairingSection.tsx` (E-side and N-side flows), `SettingsPage.tsx` full-screen overlay (Profile / Account / Appearance / Devices tabs). Gear button in ChannelSidebar now opens settings.

- **Unified screen-share modal (desktop)** — `ScreenSharePicker` replaced by `ScreenShareModal`; new `list_capture_sources` Tauri command (xcap + image + base64) enumerates monitors and application windows with 160×90 PNG thumbnails; modal shows Screens/Windows tab strip, thumbnail grid with selection ring, and audio/webcam settings section; `useScreenShare` passes `chromeMediaSourceId` to `getDisplayMedia` to bypass the OS picker entirely. Design in [`screen-share-modal.md`](screen-share-modal.md).

- **Banner channel upload seamless flow** — `POST /channels/:channel_id/upload` now returns `{"id": ...}` in the response; new `patch_channel_banner_file` Tauri command PATCHes `banner_file_id` onto the channel; `CreateChannelModal` accepts a `File` prop and `App.tsx` orchestrates the 3-step flow (create channel → upload file → patch banner_file_id) without any extra steps from the user.

- **Farm hub_spawned tracking fix** — farm's `handle_agent_socket` now parses `hub_spawned` messages from connected server agents and writes `process_port` + `server_id` to the `hubs` table; clears both on `hub_stopped`. `ServerEntry` includes `running_hub_count` so the fleet console shows live hub counts per server.

- **Android client QoL — global search, drafts, thread view, custom emoji picker** — `SearchBar` component (Ctrl+K shortcut) wired into android/wavvon-web `App.tsx`; `drafts.ts` utility ported and connected (load on channel switch, save on input change, clear on send); `EmojiPicker` loads hub custom emojis via `hubFetch("/emojis")`; `ContentArea` gains `expandedThreads`/`threadReplies` with localStorage persistence and inline reply rendering; `SortableChannelItem` renders draft badge; `reply_count` added to `Message` type.

- **Web client: message drafts, thread view, custom emoji picker** — `drafts.ts` utility ported verbatim from desktop; web `App.tsx` loads draft on channel switch, saves on input change, clears on send; `SortableChannelItem` gains `activeHubId` prop and renders the `channel-draft-badge`; `ContentArea` gains `expandedThreads`/`threadReplies` state with per-channel localStorage persistence, `toggleThread` fetches replies via `hubFetch`; `EmojiPicker` component created loading hub emojis from `hubFetch("/emojis")`, wired into the channel composer toolbar; `reply_count` added to `Message` type.

- **Admin panel auth — desktop + farm complete** — Farm crate now has
  `POST /farm/admin/totp/setup`, `/confirm`, `/disable` endpoints plus TOTP
  verification on admin login. Server agent binary (wavvon-server crate)
  reverse-connects via WebSocket to farm, manages hub processes on remote nodes.
  Farm hub routing delegates `create_hub` to connected agent if available,
  else local spawn. Desktop FarmSettingsPage gains two tabs: Servers (register
  form, one-time token display, agent list with status/last-seen) and Security
  (TOTP setup/confirm/disable). Hub server side (from prior session) already had
  8 endpoints, 3 new DB tables, session cookies, role-gating, and login HTML.
  Design in [`admin-panel-auth.md`](admin-panel-auth.md).
  *Superseded: hub web admin panel removed — see [decisions.md](decisions.md)
  ("Hub admin panel removed"). The farm-side pieces (server agent, TOTP on the
  farm console) remain.*

- **TOML config files for hub and farm** — `hub.toml` / `farm.toml` next to the binary replace scattered env vars. Load order: defaults → config file → `WAVVON_*` env vars (highest priority). `hub.toml.example` and `farm.toml.example` document every option. Hub operator guide updated.

- **Predictable hub ownership** — removed "first user to connect becomes admin" behaviour. Server operators now set the owner explicitly via `wavvon-hub admin users set-owner <pubkey>` (CLI) or through the web admin panel at `/admin/panel` → Ownership tab. The web panel gained a new Ownership section with a pubkey form. `GET/POST /admin/owner` endpoints added, protected by the existing web admin token.
  *Superseded: the `/admin/panel` web panel was removed — see [decisions.md](decisions.md). Ownership is now set at hub-creation time through the client wizard, or via the CLI.*

- **Android CI fully fixed** — workflow had been failing on every push since the repo was created; root causes: `tags:` indentation error (YAML treated it as an event, not a push filter), stale lockfiles in wavvon-desktop + wavvon-web, npm version mismatch requiring `npm install` over `npm ci`, missing `@tauri-apps/cli` + `tauri` script, `gen/android/` never initialised (`tauri android init` added to CI), and `intl-messageformat` peer dep not being installed. All fixed; CI now builds signed APKs on every push to main.

- **InvitesSection create-invite controls (desktop + android/desktop)** — Max-uses number input and expiry select had no labels; added `aria-label` to both.

- **IdentityBackupSection passphrase/label inputs (all 3 clients with this component)** — Export passphrase, confirm passphrase, backup label, and import passphrase inputs gained `htmlFor`/`id` (desktop) or `aria-label` (web + android/desktop) so screen readers announce the purpose of each credential field.

- **PairingSection device label (desktop)** — "Device label" input lacked `htmlFor`/`id`; fixed to match the android/desktop fix applied earlier.

- **Stable attachment keys (all 4 clients)** — `PendingAttachments` and `MessageAttachments` replaced `key={i}` with `key={a.name}` so removing an attachment doesn't cause React to reuse the wrong DOM node for remaining items.

- **Label/control sweeps — AudioProfileSection, ExternalBotSection (desktop), ForumComposer/HubAdminPage/RecoveryContacts (web), RecoveryContacts/PairingSection (android/desktop), ScreenShareViewer volume (android/web)** — All remaining unlinked form labels gained `htmlFor`/`id` or `aria-label` associations.

- **Label/control association — HubBotsSection, ChannelBansModal, LobbySettingsSection (desktop + android/desktop)** — "Create bot" name input, "Ban a user" user select (+ aria-label on reason input), and "Welcome message" textarea all gained proper `htmlFor`/`id` or `aria-label` associations.

- **Label/control association — FarmSettingsPage (desktop) + ChannelSettingsModal Talk power (desktop + android/desktop)** — Desktop FarmSettingsPage was missing the same `htmlFor`/`id` pairs already fixed on the web; ChannelSettingsModal Talk power number input was unlinked in both desktop and android/desktop.

- **maxLength on form inputs** — Channel name (64), channel description (280), role name (64), poll question (200), and poll options (100) gained `maxLength` constraints in desktop, web, and android/desktop so unbounded input can't reach the server.

- **Label/control association sweep — BotAdminSection, ForumComposer, BotWizard, FarmSettingsPage, AlliancesSection** — Webhook URL input in BotAdminSection (desktop + android/desktop), Title/Body in ForumComposer (desktop + android/desktop), bot display name in BotWizard (desktop + android/desktop), farm name/description/max-per-user/max-total/suspend-reason in FarmSettingsPage (web), and push-target-URL/join-code inputs in AlliancesSection invite tab (desktop + android/desktop) all gained matching `htmlFor`/`id` pairs.

- **Fix identity key no-op after hub add (desktop + android/desktop)** — `if (!publicKey) setPublicKey(null)` was a dead statement that left `publicKey` unset for first-time users who added a hub before identity initialized; replaced with an actual `get_my_public_key` invoke.

- **Remove localhost default from Add Hub URL inputs (web + android/web)** — `hubUrl` state in `App.tsx` and `WelcomeScreen` was initialized to `"http://localhost:3000"`, pre-filling the add-hub form with a development address invisible to end users. Changed to empty string.

- **Admin form label/control association sweep (desktop + android/desktop)** — HubAdminPage (hub name, description, antispam, max depth, discovery fields) and WebhooksSection (channel select, display name, avatar URL) gained `htmlFor`/`id` pairs in both clients.

- **Web form label/control association sweep** — EventComposer (title, description, location, start, end), DndSettingsSection (quiet-hours start/end), and SettingsPage (display name, avatar URL) all gained `htmlFor`/`id` pairs so screen readers announce labels when controls are focused.

- **Settings selects and DND time inputs label association** — Language, microphone, speaker, and media-output `<select>` elements in desktop and android/desktop SettingsPage, plus DND quiet-hours `<input type="time">` in android/desktop DndSection, all gained `id`/`htmlFor` pairs for proper screen-reader label announcement.

- **CertificationsSection label/input linkage + DiscoverPage badge keys** — Number inputs for cert min-age and validity now have `htmlFor`/`id` pairs (web + android/desktop) so screen readers announce the label on focus; DiscoverPage badge list replaced `key={i}` with a stable composite key.

- **Icon-only button accessibility sweep (all clients)** — WhisperPanel close/delete-list, AllianceInvitesSection/AlliancesSection dismiss-error, SortableItems volume-close, ForumPostDetail clear-reply, and GameModal permissions-dismiss buttons all gained `aria-label` + `title`.

- **PollComposer stable option keys (desktop + web)** — `options` state changed from `string[]` to `{id,value}[]` with a `useRef` counter; `key={i}` → `key={opt.id}`, preventing React from clobbering input values when an option is removed from the middle of the list.

- **Stable DM message keys (all 4 clients)** — `id?: string` added to `DmMessage`; all `getDmMessages` mapping sites now pass through the server UUID; `ContentArea` DM renders use `key={m.id ?? \`${m.timestamp}-${m.sender}\`}` instead of the array index, preventing React from reusing stale DOM nodes when messages are deleted.

- **android/wavvon-web nav semantics + message list ARIA** — `ChannelSidebar` `<div className="sidebar">` promoted to `<nav aria-label="Channels">`; Settings gear button gains `aria-label`; `ContentArea` messages container gains `role="list" aria-label="Messages"`; each message `<div>` gains `role="listitem"`.

- **GameModal dialog semantics + android/web ContentArea aria-labels** — `GameModal` gains `role="dialog" aria-modal` + `aria-label={game.name}` + `aria-label="Close"` on close button in desktop, web, and android/desktop; android/wavvon-web `ContentArea` message-action buttons (Reply, Copy link, Edit, Delete), search button, member-toggle button, and reply-banner close all gain `aria-label` to match their `title` text.

- **Icon-only button aria-label + ScreenSharePicker/GamePicker dialog semantics** — `Attachments` remove button gains `aria-label="Remove"` in all four clients; `Lightbox` close button gains `aria-label="Close"` in desktop and android/desktop; `GamePicker` gains `role="dialog"` + `aria-labelledby` in desktop/web/android-desktop; `ScreenSharePicker` gains `FocusTrap`, Escape handler, `role="dialog"`, and `aria-label="Camera"` on the device select in desktop; android/desktop `ScreenSharePicker` gets the same role and select label.

- **role="dialog" + aria-modal parity across all four clients** — `AddHubModal`, `CreateChannelModal`, `EditDescriptionModal`, `BotWizard`, and `FarmSettingsPage` sub-dialogs across desktop, web, android/desktop, and android/web all gain `role="dialog" aria-modal="true" aria-labelledby`; `BotWizard` also gains `FocusTrap` + Escape handler in both clients that were missing it; `FarmSettingsPage` `SuspendDialog` and `DeleteHubDialog` gain `FocusTrap` in both clients.

- **android/wavvon-web full accessibility parity** — `FocusTrap` component created; `AddHubModal` and `ReactionPicker` now trap keyboard focus and close on Escape; `ScreenShareViewer` migrated from single-stream find() to sharerMap grouping by `sharer_pubkey` (multi-sharer support); four focus-ring `box-shadow` gaps fixed (`.recovery-input`, `.user-list-filter input`, `.palette-input`, `.reaction-picker-search`); `App.tsx` gains `assertive` (hub connect/disconnect) and `polite` (voice join/leave) `aria-live` regions.

- **FocusTrap on Android ScreenSharePicker/GameModal/GamePicker + web ReactionPicker; voice announcements wired** — four overlay components were trapping no keyboard focus and ignoring Escape; all now wrap in FocusTrap with Escape handlers. Android `voicePoliteAnnouncement` state (added previous turn) is now populated by `voice-participant-joined` and `voice-participant-left` events so screen readers hear participant changes.

- **Multi-sharer ScreenShareViewer parity + Android aria-live + web PinnedMessagesModal FocusTrap** — web and Android ScreenShareViewer were only rendering the first screen/webcam stream globally; both now group by sharer_pubkey matching desktop. Android App.tsx was missing aria-live regions entirely; added assertive (disconnect/reconnect) and polite (voice) regions. Web PinnedMessagesModal had role="dialog" but no FocusTrap or Escape handler; both added.

- **Accessibility parity sweep (web + Android) + ChannelSidebar landmark fix** — focus-ring `box-shadow` added to `.recovery-input`, `.user-list-filter input`, `.reaction-picker-search`, and `.palette-input:focus-visible` in both web and Android clients (same fix previously applied to desktop); `channel.sidebar.label` i18n key added to all four locales; desktop `ChannelSidebar` `<nav>` was using `member.list.title` ("Members") — now correctly uses `channel.sidebar.label` ("Channels").

- **Per-sharer independent overlay windows + accessibility focus rings** — `ScreenShareOverlay` now renders one independently draggable/resizable floating window per concurrent sharer (composite ref routes `appendChunk`/`stopStream`/`attachStream` by stream_id→pubkey); five input variants (global search, recovery, palette, reaction picker, member filter) that overrode the global `:focus-visible` rule now carry the consistent `box-shadow: 0 0 0 3px var(--ring)` ring on keyboard focus.

- **Markdown rendering, link previews, keyboard shortcuts, code quality** — `MessageContent` migrated to `marked` + `DOMPurify`; `LinkPreviewCard` + `fetch_link_preview` Tauri command + hub `GET /link-preview` endpoint; `@` mention autocomplete, `Alt+↑/↓` unread channel navigation, `Escape` dismiss shortcuts; `useMessages` and `useChannels` extracted from App.tsx (composition root pattern); `tests/common.rs` shared hub test helper; all remaining `unwrap()` in `hub/src` replaced with `?`/`ok_or`; remaining Tauri commands migrated to `Result<T, AppError>`. Ships in hub, desktop, and web.

- **Markdown rendering, link previews, keyboard shortcuts, hook extraction, typed errors** — `MessageContent` migrated to `marked` + `DOMPurify` (allow-listed tags, `rel=noopener noreferrer` on all links); `LinkPreviewCard` + lazy `fetch_link_preview` Tauri command; `@` mention autocomplete in channel composer; `Alt+↑/↓` jumps to next/prev unread channel; `Escape` dismisses context menu / palette / reply target; `useNotificationPrefs`, `useUnreadCounts`, `useTypingIndicators`, `useHubConnections` extracted from App.tsx (tsc clean after each); `AppError` enum added to lib.rs, `send_message`, `edit_message`, `delete_message`, `add_reaction`, `remove_reaction`, `get_messages` migrated to `Result<T, AppError>`.

- **File uploads, message pinning, user profiles, polls, events, notification prefs** — full stack: `POST /channels/:id/upload` multipart endpoint + `RemoteAttachment` wire type; `POST/DELETE /channels/:id/pins` + pinned-message broadcast; `GET /users/:pubkey/profile` server route; poll and event REST endpoints (`polls`, `poll_votes`, `hub_events`, `event_rsvps` tables); per-hub notification preference storage. Desktop and web clients wired end-to-end: `uploadFile` Tauri command, `PinnedMessagesModal`, `UserProfileCard`, `PollCard`/`PollComposer`, `EventCard`/`EventsPanel`/`EventComposer`, `getNotifPref`/`setNotifPref`. WS handler extended for `message_pinned`, `message_unpinned`, `poll_created`, `poll_updated`, `poll_deleted`.

- **Web client feature batch** — file/image upload (`uploadFile` platform call, `RemoteAttachment` type, multipart POST), message pinning (`PinnedMessagesModal`, pin/unpin in message toolbar for admins, 📌 button in channel header), user profile cards (`UserProfileCard` opens on sender name click), native polls (`PollCard` with animated vote bars, `PollComposer` modal), events/calendar (`EventCard`, `EventsPanel`, `EventComposer` modal), per-hub browser notification preferences (`getNotifPref`/`setNotifPref` helpers, settings UI in Notifications tab). WS handler extended for `message_pinned`, `message_unpinned`, `poll_created`, `poll_updated`, `poll_deleted`.

- **Web client chat feature parity** — typing indicators (`typing_start`/`typing_stop` WS events, debounced send, per-channel "X is typing…" display), unread counts (`GET /channels/unread` seeded on hub load, `POST /channels/:id/read` on channel select), and `reactions_updated` WS event handling now wired in the web client. All 7 chat features (WS auto-reconnect, message edit/delete, unread+read, typing, reply-to, invite links, emoji reactions) are now live in the web client.
- **Rate limiting + RateLimiters refactor** — per-user 30 msg/60 s guard on `POST /messages` and DMs; all AppState rate-limit fields consolidated into a `RateLimiters` struct, fixing all 34+ test setups.
- **Admin audit log in desktop React settings** — `HubAuditLogSection` React component added to the desktop settings panel.
- **Web client parity** — SearchBar, WelcomeScreen, SettingsPage (hub settings + user profile), UserContextMenu, and MobileShell added to the web client, closing the highest-priority component gaps.
- **Pre-launch hardening** — server panic fixes (games.rs), `GET /health`, auth
  rate limiting, `GET /federation/listing` hub directory + HubBrowser client UI +
  listing toggle in admin, WelcomeScreen first-run experience, friendlier hub-join
  errors, discovery dead-end notice, game permissions notice, Windows signing CI
  wired, three new docs (getting-started, hub-operator-guide, games-sdk).
- **Cert/badge, game management, discovery Tauri commands** — all remaining
  missing commands wired: `get_cert_settings`, `list_issued_certs`, `save_cert_settings`,
  `issue_cert`, `revoke_cert`, `fetch_my_certs`, `list_badges`, `list_pending_badges`,
  `accept_badge`, `decline_badge`, `remove_badge`, `grant_badge`, `list_admin_games`,
  `fetch_game_manifest`, `install_game`, `uninstall_game`, `set_game_permissions`,
  `set_game_channels`, `game_list_channel_users`, `game_post_message`,
  `game_get_recent_messages`, `game_kv_get`, `game_kv_set`, `get_discovery_settings`,
  `set_discovery_tags`. Hub also gained `GET /admin/settings/certs` and nsfw support
  on `GET/PATCH /admin/settings/tags`.
- **Forum channels** — `forum_list_posts`, `forum_get_post`, `forum_create_post`,
  `forum_create_reply`, `forum_get_post_replies`, `forum_pin_post`, `forum_lock_post`
  Tauri commands wired; hub routes and UI components (`ForumPostList`, `ForumPostDetail`,
  `ForumComposer`) were already complete. Design in [`forum.md`](forum.md).
- **Block / ignore / DND persistence** — `load_ignored_users` / `save_ignored_users` and
  `load_dnd_settings` / `save_dnd_settings` Tauri commands added; App.tsx seeds both
  states from disk on startup. Phase 1+2 client-side block/ignore is now fully persistent.
  Design in [`block-mute-ignore.md`](block-mute-ignore.md).
- **Multi-stream screen share overlay** — floating, draggable, resizable `ScreenShareOverlay`
  replaces the inline viewer; multiple co-op streams tile in a CSS grid. Hub cap removed —
  unlimited concurrent sharers per channel. Design in [`decisions.md`](decisions.md).
- **E2E group DMs** — sender-key scheme; hub endpoints + Tauri commands +
  desktop client all complete. Design in [`e2e-encryption.md`](e2e-encryption.md).

- **Whisper UI** — `useWhisper` hook with inbound event tracking and
  list persistence. `WhisperPanel` in the voice bar with User/Channel/Saved
  Lists tabs, target checkboxes, one-click activate, save-as-list form.
  Inbound whisper badge on participant rows in the channel sidebar.
  Design in [`whisper.md`](whisper.md).
- **Hub server operations** — backup/restore CLI, data retention sweep,
  Prometheus `/metrics`, hub key rotation (`wavvon-hub rotate-key` +
  `GET /key-rotation`). Design in [`hub-operations.md`](hub-operations.md).
- **Hub admin tooling** — web admin panel at `/admin/panel` (token-gated,
  embedded HTML), `wavvon-hub admin` CLI subcommands, farm heartbeat +
  fleet console. Design in [`hub-admin-panel.md`](hub-admin-panel.md).
  *Superseded: the `/admin/panel` web panel was removed — see [decisions.md](decisions.md)
  ("Hub admin panel removed"). The admin CLI and farm console remain.*
- **Hub moderation enhancements** — federated ban lists (`GET /federation/banlist`,
  6h background sync), auto-mod webhook (500ms, fail-open, HMAC-SHA256),
  content reporting (`POST /messages/:id/report`, admin review queue).
  Design in [`moderation-enhancements.md`](moderation-enhancements.md).
- **Discovery: full suite** — hub uptime tracking, global search, farm
  browsing catalog, anonymous aggregate analytics, hub config template
  catalog, hub creation wizard (`/new`). Design in
  [`discovery-v2.md`](discovery-v2.md) and
  [`hub-creation-wizard.md`](hub-creation-wizard.md).
- **Hub first-run bootstrap** — `WAVVON_TEMPLATE_URL` / `WAVVON_BOOTSTRAP_TOKEN`
  on empty-DB first launch; applies channels, roles, hub name from template.
  Design in [`hub-creation-wizard.md`](hub-creation-wizard.md).
- **Client quality-of-life** — global message search (FTS5), message drafts,
  custom emojis per hub, events/calendar (`EventCard`, `EventsPanel`),
  native polls (`PollCard`, live bars), thread collapse/expand, notification
  grouping (3s per-hub debounce). Design in [`client-qol.md`](client-qol.md).
- **Events / calendar** — `hub_events` + `event_rsvps` tables, full REST,
  `EventCard`, `EventsPanel`, Tauri commands. Design in [`client-qol.md`](client-qol.md).
- **Native polls** — `polls` + `poll_votes`, live broadcast, `PollCard`,
  Tauri command. Design in [`client-qol.md`](client-qol.md).
- **Video in voice channels** — WebRTC mesh, active-speaker management
  (top-3, 3s linger), `VideoGrid` (equal grid ≤4, active-speaker+thumbnails
  5+, self-view overlay), `BackgroundProcessor` (MediaPipe none/blur/image),
  camera toggle + background picker in voice bar, hub signaling envelopes.
  Scale: mesh works up to ~20; SFU hook designed-in for large events.
  Design in [`video-voice.md`](video-voice.md).
- **Voice advanced settings** — Standard / Music / Custom audio quality
  profiles. `EffectiveVoiceConfig` resolved at pipeline start; Denoiser
  bypass; VAD gate per-profile; custom Opus bitrate, app mode, channels,
  frame size, complexity. Settings persisted to `voice.json`.
  Design in [`voice-advanced-settings.md`](voice-advanced-settings.md).
- **Windows Authenticode signing** — CI signing wired in `release.yml`;
  activates once `WINDOWS_CERT_THUMBPRINT` secret is set (cert procurement
  never completed; signing has since been deferred — see code-signing.md).
- **Per-participant voice volume** — `sender_id` in UDP fan-out,
  per-sender gain pipeline, volume slider in channel sidebar, persistence
  to `voice_gains.json`. Design in [`voice-volume.md`](voice-volume.md).
- **Proximity voice** — voice zones in hub (WS protocol, in-memory state,
  `manage_voice` permission), client-side attenuation (4 models), game SDK
  calls (`wavvon:createVoiceZone`, `wavvon:setVoicePosition`). Design in
  [`proximity-voice.md`](proximity-voice.md).
- **Gaming Tier 2 client SDK** — `wavvon:game:ready/start/send/end/
  snapshot/sharedKvGet|Set/setJoinPolicy` postMessage calls, incoming
  event delivery to iframe, Activities live-session badge, session
  create/join/leave Tauri commands. Full Tier 2 now complete.

