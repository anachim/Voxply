# Client feature parity

**Principle:** the two clients — **web** (`apps/web`) and **desktop**
(`apps/desktop`, Tauri) — should offer the same features. A capability landing
in one but not the other is a bug to track, not an accepted difference.

**Priority:** the **web client is the first product users will touch**, so web
leads: a feature ships on web first, and desktop is brought to parity from
there. This doc tracks the known gaps.

> The Android client (`apps/android`) was removed 2026-07-12 and its column
> dropped from this doc 2026-08-20. A clean-slate rewrite happens when mobile
> is prioritized — see [android-rewrite-notes.md](android-rewrite-notes.md).
> Nothing here tracks mobile.

**Sharing model (changed 2026-07-18 — see
[decisions.md](decisions.md#shared-ui-components-hoist-from-web-into-packagesui-desktop-adapts)):**
historically each client kept its own copy of the UI components and platform
commands (only `packages/{core,ui,platform,i18n}` were shared), so parity
meant porting a change into each app's copy. That model is retired: **web is
the source of truth**, new components ship straight into `packages/ui`
(prop-only; data access via callback props each app provides), and parity
work on an existing component now means **hoisting the web copy into
`packages/ui`** and adapting desktop — not hand-porting into desktop's
diverged copy. First hoisted batch (2026-07-18): `BotAppLaunchCard`,
`ImagePicker`, `BotCard`, `EmojiPicker`. **The mechanical phase
completed 2026-07-20** (clients `8500c63`): 41 more components hoisted;
see "Consolidation status" below for what remains and why.

---

## Consolidation status (2026-07-20, clients `8500c63`)

45 of the 61 audited duplicates are now single `packages/ui`
implementations. The rest stay app-local because a mechanical hoist
would drop shipped features — each needs a **feature reconciliation
pass** first:

**Update 2026-07-20 (clients `54a04c1`)**: the three bidirectional-fork
components below the line were unified via feature-union parity passes
(user decision: converge on the union; no shipped capability dropped)
and are now in `packages/ui`: `HubAdminPage` (+13 admin sections),
`ChannelSettingsModal` (permissions/bans/talk-power/icon tabs on both),
`ChannelSidebar` (desktop converged onto TTL+Invisible presence per the
2026-07-12 decision; gained voice-move, drill-in, spawner channels).

**Update 2026-07-20 (clients `2cae216`)**: the settings-IA implementation
([settings-ia.md](settings-ia.md)) closed `ProfileTab` (desktop's
profile-pool deleted) and `IdentityBackupSection` (one cross-platform
`.wavvon-backup` format, shared TS/Rust test vector), and shrank
`SettingsPage` to thin app shells over the shared `SettingsShell`.
Desktop is multi-account.

**Update 2026-07-20 (clients, orchestrators pass)**: `ChannelMessageList` and
`DmView` were hoisted (message-view pass). `ContentArea` followed as a full
hoist into `packages/ui` — the two copies were a near-identical layout/dispatch
shell over already-shared children (`ChannelHeader`, `ChannelMessageList`,
`ChannelComposer`, `ForumView`, `DmView`, `AllianceView`, `EventsPanel`,
`UserListGrouped`, `BotCard`, `UserProfileCard`, `PollComposer`); the
per-platform pieces (forum/message-row/profile-card actions, event/poll/bot
loaders, thread and hub-emoji fetchers, component-interaction sender) now
travel in through a widened actions-prop surface, same pattern as
`ForumActions`/`MessageRowActions`. `WelcomeInviteBanner` (was web-only) also
hoisted and is now wired on desktop too via its existing `preview_hub_info`
Tauri command. The desktop-only Events *modal overlay* and web's *tab strip*
both stayed — `eventsPresentation: "tabs" | "modal"` prop, no shipped UX
forced to change. The hub-streams entry point is now singular: the
always-visible `ChannelHeader` button on both apps; the voice-footer toggle
(`ChannelSidebar`'s `onToggleHubStreams`/`hubStreamsCount`, previously
present on both apps, not just desktop) was removed as the redundant,
context-dependent placement. `App` remains app-local (true orchestrator,
holds all state).

**Update 2026-07-20 (final — clients `3088346`/`cf6b39d`/`278fafe`,
server `4240377`)**: the entire command/glue ledger below the line was
**closed** in the gap-closing waves, and `RecoveryContactsSection` was
unblocked (the hub gained the verified attestation flow —
[recovery-attestation.md](recovery-attestation.md)) and hoisted with the
new requester/contact UI. Desktop also gained soundboard playback (real
voice-crate mixing), banner file upload, own-profile editing, quick
invite, and per-account local-store isolation; web gained camera device
selection and the alliance push-invite/share-code surface.

Remaining app-local, all by design:

| Component | Why |
|---|---|
| `App` | True state orchestrator (decisions.md 2026-07-18) — holds all component state, not a rendering shell. |
| `MicLevelMeter` | False twin — filename collision (web: mic test widget; desktop: VAD-threshold slider). No action needed. |

*(`PinnedMessagesModal` was the last feature-diverged pair; its union
pass shipped 2026-07-26, clients `5918873` — one shared modal with
desktop's admin unpin + web's a11y shell, and a fix for web's
wrong-vs-wire flat `PinnedMessage` type that crashed the modal on any
real pin. Covered by `e2e/live/55`.)*

**Open capability notes** (small, tracked):

- ~~Desktop DR receive side broken for conversations where desktop
  never sent first~~ — fixed 2026-07-27 (clients `9a60076`):
  `decrypt_dm_dr_inner` responder-inits a missing session from the
  envelope + the sender's published DH key (fetched in
  `get_dm_messages` only when no session exists). Pinned by a
  cross-language vector test (TS-initiator envelope → Rust responder).
  Desktop's *send* path upgraded to DR v2 the same day (clients
  `fef2ca3`, dead v1 `encrypt_dm` command removed, reverse Rust→TS
  vector added) — DM crypto is at full parity; both interop directions
  are vector-pinned across the two test suites.

- Soundboard ponytail ceilings: linear resampler, one-clip-at-a-time.
  ~~played-attribution chip not wired on desktop~~ — fixed 2026-08-08 (see
  "Desktop WS event gap class" below).
- Web camera *mid-call* device switching reuses the disable/enable
  renegotiation path (no `replaceTrack`); fine for v1.
- Desktop Devices/Privacy tabs are active-account-only (no Rust surface
  for other accounts' state — permanent model difference vs web's
  IndexedDB).
- ~~web `onOpenEditDescription` is a no-op at its `App.tsx` call site~~
  — fixed 2026-07-26 (clients `0a1700e`): `EditDescriptionModal` hoisted
  to packages/ui and wired on web (`e2e/live/56`).

---

## Parity matrix

Legend: ✅ present · ❌ missing · ➖ n/a or native-only · `?` not audited.

### Desktop features missing from web (audited 2026-07-04)

Everything here is **portable** (no native API) unless marked native-only.

| Feature | Web | Desktop |
|---|:--:|:--:|
| **Real-time media** | | |
| Start a screen share (outbound) | ✅ (2026-07-04) | ✅ |
| View someone's screen share | ✅ | ✅ |
| Camera / webcam video (`VideoGrid`) | ✅ (2026-07-04) | ✅ |
| Whisper (targeted voice) | ✅ (2026-07-04) | ✅ |
| Hub-streams panel (cross-channel) | ✅ (2026-07-04) | ✅ |
| Mic level meter | ✅ (2026-07-04) | ✅ |
| In-app push-to-talk | ✅ (2026-07-04) | ✅ |
| Global (unfocused) PTT hotkey | ➖ native | ✅ |
| Audio-profile applied to live session | ✅ (2026-07-04) | ✅ |
| **Identity / profile / social** | | |
| Avatar image upload + crop | ✅ (2026-07-04) | ✅ |
| Friends (requests/list/remove) | ✅ (2026-07-04) | ✅ |
| Multi-profile + per-hub assignment | ✅ (2026-07-04) | ✅ |
| "My certifications" viewer (member) | ✅ (2026-07-04) | ✅ |
| Home-hub list management | ✅ (2026-07-04) | ✅ |
| Multi-device pairing + device list/revoke | ✅ (2026-07-04) | ✅ |
| **Hub admin** | | |
| Assign/remove roles — right-click menu | ✅ (2026-07-04) | ✅ |
| Create / delete roles + edit permissions | ✅ (2026-07-04) | ✅ |
| Role appearance (color/icon) + categories | ✅ | partial |
| Alliances (create/leave) + invite inbox | ✅ (2026-07-04) | ✅ |
| Alliance channel-sharing | ✅ (2026-07-04) | ✅ |
| Onboarding: approval queue + lobby/challenge settings | ✅ (2026-07-04) | ✅ |
| Onboarding survey builder + member survey | ✅ (2026-07-04) | ✅ |
| Hub audit log | ✅ (2026-07-04) | ✅ |
| Hub icon library | ✅ (2026-07-04) | ✅ |
| Native bot admin / create | ✅ (2026-07-04) | ✅ |
| Channel bans | ✅ (2026-07-04) | ✅ |
| Channel appearance (color/icon) | ✅ (2026-07-04) | ✅ |
| Kick / Ban / Mute — right-click menu | ✅ | ✅ |
| Presence status (away / DND / custom) | ✅ (2026-07-05) | ✅ (2026-07-11) |
| Banner-channel rename/delete from sidebar | ❌ | ? |

### Where web is ahead of desktop (parity is bidirectional)

Web should not regress these; desktop should catch up:
events with role slots + reminders, soundboard, full encrypted
data-export archive, channel permission-overwrite tab, role categories +
per-role color/icon, the quiet-hours schedule (deferred everywhere; DND
itself is on web + desktop now), the moderation suite (content reports,
automod webhook, outgoing webhooks, federated ban lists), link previews,
and passkeys + hub trusted-devices.

Added 2026-09-07: **the mic test's verdict.** Web's meter draws the transmit
gate on its bar and says which of three things happened after four seconds —
nothing arriving, arriving but never crossing (the case that means nobody
hears you, and the one the bar alone cannot show), or crossing it. Desktop
has its own copy of `MicLevelMeter` with none of that. The decision itself is
`micTestVerdict` beside `effectiveVad`, so the port is the rendering, not the
thinking.

Closed the same day, in the other direction: **the DM encryption warning.**
Desktop stopped to ask before sending to a recipient with no published key;
web did not, and sent in the clear. Now `EncryptionWarningModal` in
`packages/ui`, used by both, with its strings in the catalogs rather than
hardcoded English — and web's refusal is stricter than desktop's, since a
*failed* key lookup is not a missing key (shipped-log, 2026-09-07).

### Present under a different name (NOT gaps)

Badges/tags → `ServerTagsSection`; cert admin → `CertificationsSection`;
invites → inlined in `HubAdminPage`; hub browse → `DiscoverPage`;
screen-share **viewing**, theme picker, and recovery-phrase import all
exist on web.

---

## Tracked items

### 1. Role assignment via the member right-click menu

- **Web — DONE (2026-07-04).** `apps/web/src/components/UserContextMenu.tsx`
  gained a "Roles" section, gated on `manage_roles`, that toggles the hub
  endpoints `PUT`/`DELETE /users/{public_key}/roles/{role_id}` via the new
  `assignRoleToUser` / `removeRoleFromUser` / `listUserRoles` platform
  commands. It hides `everyone` and any role whose priority is ≥ the
  viewer's own (mirroring the hub guard), and refetches `/users` on change
  so the member list regroups. Covered by
  `apps/web/e2e/live/12-role-assignment.spec.ts`.
- **Desktop — already present.** `apps/desktop/src/components/UserContextMenu.tsx`
  has a "Roles" submenu (`allRoles` + `onToggleRole`) backed by
  `useHubAdmin.ts` (`invoke("assign_role"/"unassign_role")`). Behavior is
  close but not identical to web — desktop filters only `builtin-owner`;
  web also filters `builtin-everyone` and by priority. **Align the two.**

### 2. Create / delete hub roles + edit permissions (admin UI)

- **Web — DONE (2026-07-04).** `apps/web/src/components/RolesSection.tsx`
  gained a "New role" creator (name + priority + permission checkboxes +
  hoist), a per-role expandable **Permissions** editor, and a **Delete**
  button (non-builtin only; `builtin-owner` permissions stay locked). Uses
  the existing `createRole`/`updateRole`/`deleteRole` commands. Covered by
  `apps/web/e2e/live/13-role-admin.spec.ts`. *(New controls use plain
  English, not i18n, to match desktop and avoid a 4-locale coverage gap —
  a follow-up is to add `hub.admin.roles.*` keys across all locales.)*

### 3. Presence status

- **Web — DONE (2026-07-05, gates + global broadcast 2026-07-10).**
  **Desktop — DONE (2026-07-11,** clients `81de52c`): hub-synced picker
  with custom text, DND notification gating, global broadcast +
  re-apply on reconnect, member-list status dots.
- **Fixed 2026-07-04:** newly-joined members now appear in an already-loaded
  web client's member list live (`onMemberOnline` refetches `/users` for an
  unknown pubkey) — previously they only showed after a reload.
- **New known limit:** the hub's `GET /users` caps at 50 rows, so large
  communities' member lists truncate — needs pagination/search (hub work).

### 4. Banner-channel management

- **Banner rows manageable (FIXED, verified 2026-07-28).** The shared
  `SortableChannelItem` banner branch renders the row's context-menu handler
  plus an admin-gated name strip + settings gear (comment in the component
  explains the affordance), and both clients now use the shared
  `ChannelContextMenu`, which offers copy-link/edit/delete on banner
  channels (notify modes intentionally hidden there — no messages). Desktop
  additionally wires the menu's `onEditBanner` to its BannerEditModal.

### 5. Half-wired / dead on web

- **Audio profile now applied (FIXED 2026-07-04).** `handleVoiceJoin`
  reads the saved `AudioProfileConfig` from `localStorage` and passes it as
  the 5th `VoiceWsSession` arg, so the settings choice takes effect on the
  live session.
- **Friends built (DONE 2026-07-04).** `components/FriendsModal.tsx` +
  `platform/commands/friends.ts` (`listFriends`, `listPendingFriendRequests`,
  `sendFriendRequest`, `acceptFriendRequest`, `removeFriend`) against the hub
  `/friends` endpoints. The 👥 DM-sidebar button now opens it: add a friend by
  public key, accept pending requests, list + remove friends. Covered by
  `e2e/live/16-friends.spec.ts` (two-client send → accept → remove).
  *Follow-up:* a "Message" action to open a DM directly from a friend row
  (needs a start-DM-by-pubkey path).
- **Dead code:** `web/src/platform/webrtc.ts` `WebRtcSharerSession` is
  defined but never instantiated — the intended outbound-screen-share path
  was never wired (see the media gaps above).

### 6. Client-side error handling for unreachable services (2026-07-04)

- **Problem:** external network calls had no timeout, so an unreachable
  host (mistyped hub address, down discovery service, offline skin gallery)
  left the UI stuck on a spinner with no error.
- **Done:** added `fetchWithTimeout` (`platform/http.ts`, 10s default,
  respects a caller signal) that turns a timeout/network failure into a
  clear "Could not reach {host}" / "Timed out reaching {host}" error.
  `rawFetch` and `hubFetch` now use it (covers hub add/submit + `/info`
  preview + health), and `DiscoverPage` (`/api/hubs`) and `SkinsGallery`
  (`/api/skins`) call it directly. Error messages surface via each screen's
  existing error UI.
- **Follow-up:** apply the same timeout treatment in desktop
  network paths (its fetches live in the Tauri Rust layer); audit for other bare `fetch`/`invoke` calls that can
  hang.

### 7. Outbound screen share (web) — DONE (2026-07-04)

- Web could previously only *view* shares. New `WebScreenShareSession`
  (`platform/screenShare.ts`) captures via `getDisplayMedia` + `MediaRecorder`
  and speaks the hub's **chunk-transport** protocol byte-for-byte with the
  desktop sharer: `screen_share_start` (`transport:"chunks"`), then per blob
  a `screen_share_chunk` JSON envelope followed by a raw binary frame, then
  `screen_share_stop`. Added `HubWebSocket.sendBinary` (`platform/ws.ts`).
  A "🖥 Share screen" header button + the existing "You're sharing" bar drive
  it (`ChannelHeader`), with `sharing`/`shareKbps` state in `App.tsx`. The
  existing web viewer renders it unchanged. Covered by
  `e2e/live/15-screen-share.spec.ts` (sharer bar + second client sees the
  panel, both on fake media). *NOT ported to WebRTC — `webrtc.ts`'s unused
  `WebRtcSharerSession` (the `transport:"webrtc"` v2 path) still doesn't
  interoperate with the current viewer; a follow-up could adopt it.*
- **Camera video / whisper / hub-streams panel** — all DONE (2026-07-04);
  see items 11–12 below.

### 8. Avatar image upload (web) — DONE (2026-07-04)

- New `components/ImagePicker.tsx` (ported from desktop) — file picker +
  drag-drop, center-crops to a 128px JPEG data URL — added to the Settings
  profile tab alongside the existing URL field. Saves through the existing
  `PATCH /me` avatar. Covered by `e2e/live/14-avatar-upload.spec.ts`.

### 9. Admin cluster (web) — DONE (2026-07-04)

- **Hub audit log** (`AuditLogSection`, `GET /admin/audit-log`),
  **native bots** (`NativeBotsSection`, `/admin/bots` create/list/delete +
  one-time token) — *removed 2026-08-21 with the self-service bot system
  ([decisions.md](decisions.md), "Every bot is an external bot"); the one
  remaining bot tab is `ExternalBotSection`* —, **hub SVG icon library**
  (`HubIconsSection`,
  `/hub/icons` CRUD), **alliances** (`AlliancesSection`, list/create/leave +
  invite inbox), **onboarding** (`OnboardingAdminSection`: approval queue
  `/hub/pending`, lobby settings, anti-spam challenge settings), and
  **per-channel bans** (`ChannelBansTab` in Channel Settings,
  `/channels/{id}/bans` v2). New platform commands: `audit`, `channelBans`,
  `hubIcons`, `nativeBots`, `alliances`, `onboardingAdmin`. Covered by
  `e2e/live/18-admin-cluster.spec.ts`. New role-admin/section strings are
  plain English (same i18n follow-up noted in item 2).

### 10. Mic meter + my-certs (web) — DONE (2026-07-04)

- **Mic level meter** — `MicLevelMeter` in Settings → Voice (client-only
  getUserMedia + AnalyserNode). `e2e/live/17`.
- **My certifications viewer** — `MyCertificationsSection` in Settings →
  Account, read-only fan-out over `GET /identity/{pubkey}/certs`.
  `e2e/live/19`.

---

## Remaining after the 2026-07-04 porting pass

Definitive status for everything still not at parity:

- **Camera video — DONE (2026-07-04).** `WebVideoSession`
  (`platform/video.ts`) does full-mesh WebRTC over the main WS
  (video_offer/answer/ice, STUN-only, smaller-pubkey-initiates). Created at
  voice-join (to catch the `video_participants` roster), camera captured on
  toggle; `VideoGrid` + a header camera button. `e2e/live/20` verifies two
  clients exchange remote tracks. *Follow-ups: background blur, device
  picker, active-speaker gating — desktop extras not ported.*
- **Whisper — DONE (2026-07-04).** Web `WhisperBar` + `voice_whisper_*`
  control, `voice.ts` now accepts 0x01 frames, and the **hub** gained
  pubkey-based whisper routing (`whisper_target_pubkeys` +
  `voice_ws.rs` `only_to` filter) so a web whisper actually reaches only its
  targets. `e2e/live/21` verifies the control plane. *Follow-ups (1) and (2)
  fixed 2026-07-23: **desktop→web** whisper audio now reaches a web target
  (the UDP relay's `0x01` branch in `main.rs` also delivers to each resolved
  target pubkey's `voice_ws_senders` entry, alongside the existing SocketAddr
  delivery), and role-type whisper targets are now resolved into the pubkey
  set too (`resolve_whisper_target_pubkeys`, shared by whisper-start and the
  membership-change re-resolve), not just the UDP addr set. Follow-up (3)
  also fixed 2026-07-23: web now wires the shared `WhisperPanel`
  (users/channels/saved lists) via a web `useWhisper` hook, with whisper
  lists persisted per-account/per-hub in localStorage
  (`apps/web/src/utils/whisperLists.ts`); the users-only `WhisperBar` was
  removed. Whisper is at full parity.* **Update 2026-07-26 — web pulled
  ahead:** whisper inbox (`WhisperInbox` in packages/ui, persists until
  dismissed), per-list keybinds with hold/toggle mode
  (`apps/web/src/hooks/useWhisperKeybinds.ts`), and receive opt-out
  (`voice_whisper_optout` WS message, hub-enforced; persisted per account
  in `apps/web/src/utils/whisperOptout.ts`, re-sent on reconnect).
  *Desktop gaps — closed 2026-08-08.* `useWhisperKeybinds` and the inbox
  reducer (`applyWhisperLogEvent` / `pickReplyPubkey`) were app-local on web
  despite being entirely platform-free; both are now in `packages/ui`
  (`hooks/useWhisperKeybinds.ts`, `utils/whisperInbox.ts`) and desktop uses
  them unchanged, so it gained per-list keybinds, the reply bind, and the
  `WhisperInbox` render for free. Receive opt-out needed no new WS plumbing
  — desktop already had `send_hub_ws_raw_to` (used for the presence push),
  so the frame rides that, re-sent on reconnect next to presence for the
  same reason (the hub holds opt-out per connection). Persistence is a new
  per-account `whisper_optout.json` via `local_store.rs`, matching
  `dnd_settings`; desktop localStorage is **not** account-scoped, so the
  web pattern could not be copied directly. Keybinds stay focused-only on
  both clients — a Tauri global shortcut is still open if anyone asks.
- **Hub-streams panel — DONE (2026-07-04).** `HubStreamsPanel` behind a 📡
  header button lists screen shares in other channels
  (`requestStreamList`/`subscribeStream`/`unsubscribeStream` over the WS
  control plane); a subscribed stream is pushed into `activeScreenShares` so
  the shared `ScreenShareViewer` renders it. `e2e/live/26` has a member watch
  a share from another channel without joining it.
- **In-app (focused) push-to-talk — DONE (2026-07-04).** `PushToTalkSection`
  (Settings → Voice) + an App effect that gates `VoiceWsSession.setMuted()`
  on the bound key while in voice; isolated so non-PTT users are unaffected.
  `e2e/live/23`. Global/unfocused PTT stays native-only.
- **Alliance channel-sharing — DONE (2026-07-04)** (`e2e/live/18`).
- **Channel appearance (color/icon) — DONE (2026-07-04)** (`e2e/live/22`).
- **Multi-profile + per-hub assignment — DONE (2026-07-04).** Client-only
  (`utils/profiles.ts` localStorage store); `ProfilesSection` in Settings →
  Profile does CRUD + set-default + apply-to-hub (applying does `PATCH /me`
  display-name/avatar), with per-hub assignment persisted locally.
  `e2e/live/24`.
- **Onboarding survey builder + member survey — DONE (2026-07-04).**
  `SurveyAdminSection` (add text/choice questions, choices, enable, save via
  `PUT /admin/survey`) + `SurveyModal` shown to members on join
  (`GET /survey/current`, `POST /survey/submit`; the public shape has no
  `enabled` field, so App gates on `questions.length` + a dismissed set).
  `e2e/live/25`.
- **Identity crypto port — DONE (2026-07-04).** The blocker for both items
  below. `packages/core/src/identity/` now has `master.ts` (HKDF master-key
  derivation from the device seed), `wire.ts` (length-prefixed signing-bytes +
  signed-struct builders for HomeHubList, SubkeyCert, RevocationEntry,
  PairingOffer, PairingClaim), and `ecies.ts` (X25519 wrap/unwrap for the
  prefs-blob key). `wire.test.ts` asserts every envelope against the canonical
  hex vectors in `wavvon-identity`, so the port is byte-for-byte identical; a
  new `MASTER_FROM_ENTROPY_PUB` vector pins the HKDF derivation cross-language.
- **Home-hub list management — DONE (2026-07-04).** `HomeHubsSection`
  (Settings → Account) reads `GET /identity/{master}/designation`, edits the
  ordered hub list, and publishes a master-signed `HomeHubList` via
  `POST …/designation`. `e2e/live/27`.
- **Multi-device pairing + device list/revoke — DONE (2026-07-04).**
  `DevicesSection` (existing device): enable multi-device (self-issue a
  subkey-0 cert + re-auth so the hub records the master), create a signed
  pairing offer, show a paste code, approve the new device's claim by issuing
  a master-signed `SubkeyCert`; plus device list + revoke. Identity setup (new
  device): paste the code, mint a fresh subkey, claim, and on approval store
  the cert and join. Auth (`platform/commands/hubs.ts`) now presents the stored
  cert and records the `canonical_pubkey` the hub returns, so a paired device
  self-identifies as the shared user. `e2e/live/28` pairs a second browser
  context and asserts the hub resolves it to the owner's canonical identity.
  *Follow-up: DM sender attribution and the DH key are still signed with the
  device subkey rather than mapped to the canonical identity, so DMs from a
  paired device attribute to its subkey. The community experience (messages,
  membership, roles, bans) is token-based and already canonical. Tracked.*

- **Hub timezone + birthday badge — DONE (2026-07-21)** (see
  [decisions.md](decisions.md#hub-timezone--birthday-badge-plain-profile-field-viewer-local-day-triple-opt-in)).
  `HubAdminPage` Overview gained a timezone `<select>`
  (`Intl.supportedValuesOf`, feature-detected — hidden with a fallback note
  where unsupported) and a "Show member birthdays" toggle, wired to both
  clients' hub-settings save/load. `HubClock` (packages/ui, member-facing,
  no admin gate) mounts in the sidebar hub-header on both clients, sourced
  from `/info` on web and from `get_hub_branding` on desktop (desktop had no
  existing member-facing `/info` fetch to hang it off, so `get_hub_branding`
  — previously admin-only by call site, not by permission — now doubles as
  that source). The birthday profile field (month+day `<select>`s, never a
  year) rides the existing `PATCH /me` clear-with-empty-string convention on
  both clients; the 🎂 badge renders in the member list and message rows on
  both. **Gap:** the viewer's `hideBirthdays` opt-out is per-device only on
  both clients today — web stores it in scoped localStorage (like the
  existing "hide silenced channels" toggle), desktop holds it in plain
  in-memory state (like desktop's own existing "hide silenced" toggle,
  neither persisted). The decision doc calls for this to live in the
  encrypted hub-synced prefs blob (`packages/core` `PrefsBlobContents.
  hide_birthdays`, mirrored in desktop's `prefs_blob::LocalPrefs`) for
  cross-device consistency. **Closed 2026-08-21**: web now has a full
  push/pull round trip for that blob, and `hideBirthdays` rides in it along
  with the rest of the user's settings — see the decisions.md entry "Settings
  follow the identity, in the prefs blob, as raw storage strings". The
  allowlist of what syncs lives in `apps/web/src/utils/syncedSettings.ts`;
  device-bound settings (microphone, speaker and camera ids) deliberately do
  not travel. Desktop still writes only its own typed fields and carries
  web's `settings` map through untouched.

**Feature parity with desktop is complete** for the web client's scope. The
remaining refinement is canonical-identity mapping for a paired device's DMs
and DH key (see the pairing follow-up above) — an enhancement, not a gap.

- ~~**Paired-device E2E (DMs + voice) on DESKTOP**~~ (noted 2026-08-06,
  **implemented 2026-08-08**): desktop pairing never provisioned the
  canonical DH scalar, so a paired desktop account could not unwrap DM
  or voice sender keys wrapped to the canonical published DH key.
  Mechanism A ([multi-device.md](multi-device.md)) is now implemented on
  desktop: `PairingComplete` / `PairingStatus::Complete` carry
  `wrapped_dh_seed_hex`, the enrolling device ECIES-wraps its canonical
  X25519 scalar for the claiming subkey with the same `wrap_blob_key`
  primitive `wrapped_blob_key_hex` already used, and the claiming device
  unwraps it into `paired_identity.json`. Nothing new landed on the wire
  — the hub, the `identity` crate and `packages/core` had all carried
  this field since the web implementation; only desktop's mirror lagged.

  Consumption went through **one** chokepoint rather than nine patched
  call sites: `Identity::e2e_dh_secret()` returns the canonical scalar on
  a paired device and the seed-derived one otherwise, and every DM and
  voice-key path calls it. That shape is the point — the failure mode
  here is silent (a wrong scalar produces an undecryptable message, not
  an error), so "did we remember at this call site?" is exactly the
  question that must not exist.

  **Verification status:** four unit tests pin the properties that
  matter — the unwrapped scalar reproduces the published DH pubkey, a
  paired device and the enrolling device reach the same shared secret
  with a third party, and a subkey-derived scalar demonstrably does not.
  **A real desktop↔web pairing has still not been driven**, which is the
  standing "Desktop live-drive DM verification" item in ROADMAP. Treat
  paired-desktop E2E as implemented-but-undriven until that runs.

---

## Desktop WS event gap class — CLOSED 2026-08-08

Desktop's `WsServerMessage` enum ends in `#[serde(other)] Other`, and
`ws.rs` handled that arm as `Other => {}`. Every hub event desktop did not
model was therefore dropped **with no log line, no warning, nothing** — so
features web shipped simply never arrived on desktop and nobody noticed.
Four had accumulated behind it:

| Event | What desktop was missing |
|---|---|
| `hub_updated` | Stale hub name/icon/timezone until a reload |
| `channels_updated` | Stale channel list |
| `member_updated` | Stale member names/avatars/name colors after any `PATCH /me` |
| `soundboard_played` | No attribution chip — desktop *caused* chips on web clients but showed none itself |

All four variants are now modelled and handled, and **the fallthrough arm
logs the unhandled `type`** so the next one surfaces instead of vanishing.
That log line is the actual fix; the four handlers are just the backlog it
had hidden. The chip reuses `useSoundboardChips`, hoisted into
`packages/ui/src/hooks/` (it was network-free all along).

*(The old "Related" note here claimed `PATCH /me` broadcast no WS event.
That stopped being true when `MemberUpdated` landed — the hub had been
broadcasting it and only web listened.)*

## Gaps opened by the 2026-07-23 web bug batch

- ~~**Unified channel icon picker**~~ — closed 2026-08-08 by deletion.
  Desktop was rendering *both* the shared `ChannelSettingsModal` (with the
  merged emoji / predefined / hub-SVG / upload grid) **and** its own
  193-line `ChannelAppearanceModal` with the old four disconnected
  controls, reachable only from the category context menu — a strictly
  poorer duplicate of a tab the same menu already opened. Deleted, along
  with the now-orphaned app-local `svgSanitize` (the shared one uses
  DOMPurify).

## Capability advertising — web only (2026-08-09)

`GET /info` advertises `capabilities`, and **web** reads it: per-hub, cached
in the session and persisted in `SavedHub`, queried through
`hubSupports(hubId, cap)` / `activeHubSupports(cap)`
(`apps/web/src/platform/session.ts`). Desktop's `hub_session.rs` fetches
`/info` and discards the field.

Not a bug on desktop today, and structurally less urgent there: a desktop
client's version is owned by the user and inherits nothing from a hub, so it
does not have web's problem of the client version being decided by whichever
hub happened to serve the page. It still talks to hubs older than itself, so
the gap closes when a desktop feature actually needs to branch on a hub's
version — parse `capabilities` into the session record and mirror
`hubSupports`. Rationale: decisions.md, "Hub capabilities are advertised, not
inferred from a version number".

## Device self-certification and designation on connect — CLOSED 2026-09-05

Web issues and registers a device's own `SubkeyCert` on connecting to a hub,
and publishes a `HomeHubList` naming that hub if the identity has none —
`ensureSelfDeviceCert` / `ensureHomeHubDesignation` in
`apps/web/src/platform/commands/identity.ts`, both fire-and-forget from
`connectHub`, cert first. **Desktop now does both too**, on the same day and by a different route — the
cert rides on `/auth/verify` (`auth_creds.rs::self_signed_cert`), since the
hub's auth upsert already writes `users.master_pubkey` from a presented cert,
and `home_hub.rs::ensure_designation` follows it on the join path. What follows
is what the gap was.

Before that, `devices.rs` only listed and revoked, nothing POSTed a cert to
`/identity/{master}/devices`, and `home_hub.rs` published a designation only
when the user drove the Home Hubs screen by hand. The registered Tauri commands
were `devices::device_list`, `devices::device_revoke` and the eight
`pairing::*`, none of which issues a cert for *this* device — pairing hands one
to the *claiming* device, so a desktop that paired a phone left the phone
linked and itself not. There was no workaround either: web at least had the
Settings → Devices route.

The failure was silent on both ends. The roster→master link exists only in a
device cert, so a desktop-only identity was invisible to every hub's home-hub
lookup, and DM fan-out and mirror-forward skipped it with no error anywhere
([home-hub.md](home-hub.md), decisions.md "Devices stay subkeys, and a device
certifies itself at first auth").

**Closed the same day, on the hub rather than in the client**: a device did not
appear in its own `device_list`, which reads `subkey_certs`, because auth wrote
only `users.master_pubkey` — the link every home-hub lookup needs, but not what
that screen lists. Web had been registering separately and never noticed;
desktop has no such call. `resolve_canonical_identity` now records the cert it
just verified, so both writes happen in one place and any future client gets it
by presenting a cert. Web keeps its POST: it issues the cert *after* the
session authenticated without one, so that call is what makes the device
visible before the next sign-in.
