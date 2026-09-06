# Design Decisions

Why Wavvon is shaped the way it is. Each entry: the decision, the
alternative we considered, and why we chose this. New decisions go at
the top. This file holds the most recent entries; older ones are
relocated verbatim to [decisions-archive.md](decisions-archive.md)
so this file stays small enough to read whole.

## The pairing code is the signed offer itself, not a pointer to it

**Decision** (2026-09-06): the string an existing device shows and a new device
pastes is the whole master-signed `PairingOffer` — `master_pubkey`,
`home_hubs`, `pairing_token`, `issued_at`, `expires_at`, `signature` — as
JSON, which is what [multi-device.md](multi-device.md) §"QR pairing protocol"
specified all along and what the desktop client already builds and parses.
The web client's shorter `base64({hub, token})` is the one that goes.

This was found as a bug rather than chosen as a design: the two clients emitted
different payloads, so **web and desktop could not pair in either direction**
and the paste was simply rejected as invalid (2026-09-06, desktop harness).
Something had to win; this is the reasoning for which.

**The offer carries the master pubkey out of band, and the pointer does not.**
With a pointer, everything the new device learns about *whose* identity it is
joining comes from the hub: it claims with a token, and accepts whatever
`SubkeyCert` comes back, verifying that cert against the master pubkey named
inside the cert. A hostile or compromised hub can therefore answer with a cert
under a master of its own choosing, and the new device pairs into the
attacker's identity while showing the user a successful pairing. With the offer
in the code, the master pubkey travelled over the same out-of-band channel the
user already trusts — their own screen — so the cert is checked against a
pubkey the hub never got to choose.

**The offer also carries the home hub list**, which is what lets the claiming
device try each hub in turn. The pointer names one hub, so a single unreachable
or hostile home hub blocks pairing — the property multi-device.md §"Security
properties" spends a line rejecting.

**Alternatives considered.**

*The pointer wins, and both clients shorten to it.* Rejected on the two points
above. It is genuinely shorter — ~60 characters against ~400 — but nothing in
either client asks a human to retype the code: it is copied, or it is a QR.

*Both clients accept both shapes.* Rejected. It is the smallest diff and it
leaves two wire shapes for one thing forever, with the weaker one still
reachable — a pairing that quietly loses the master binding depending on which
client generated the code.

*Keep base64 around the JSON so the code stays one opaque token.* Not taken:
the desktop client already emits raw JSON and reads raw JSON, so raw JSON costs
one client no change at all. The payload is single-line either way.

**Tradeoff.** The code is long, and it looks like machine output rather than
something a person could read aloud. That is the honest shape of it: a pairing
code that a person *could* retype would not be carrying a signature.

**Outcome.** Web builds the offer already (`buildPairingOffer` in
`packages/core`) — it just never showed it. The change is which string the
pairing UI displays, plus a `verifyPairingOffer` on the claiming side, plus
claiming against `home_hubs` in order instead of one hub. The desktop client
is unchanged.

## Leaving a hub clears the profile and the membership, and keeps the pubkey as an anchor

**Decision** (2026-09-05, design; execution in next-up.md): a person can ask a
hub to remove them, and what that does is delete their **profile** and their
**roles**, keeping the `users` row as a bare pubkey. Not a row delete, and not
a scrub of what they wrote.

The shape is settled by two things that are already true rather than by taste.

**The row cannot go.** Twenty-two tables carry a foreign key to
`users(public_key)` — `messages`, `bans`, `mutes`, `message_reports`,
`conversation_members`, `user_roles`, reactions, RSVPs, `soundboard_clips`,
and more. A hard delete either fails on those constraints or cascades through
the community's record and its moderation history. A departure that erases the
ban on the person departing is not a feature.

**The rule from the same day says what to remove instead**: a hub holds a
*profile*, never an account ("A hub may hold what you sign or encrypt, never
what can reconstitute you"). So leaving removes exactly what the hub was
holding on the person's behalf — `display_name`, `avatar`, `bio`, `pronouns`,
`status_message`, `activities`, `accent_color`, `cover`, `favorite_hubs`,
`birthday`, `name_color` — plus every `user_roles` row, which is what
"member" means here. What stays is the pubkey and the record it anchors.

**Alternatives considered.**

*Delete the row and let the cascades run.* Rejected above: it takes the ban
list and the reports with it, and the messages are the community's record as
much as the author's words.

*Tombstone the author on each message instead (rewrite `sender`).* Rejected:
it rewrites history rather than annotating it, breaks reply chains and
reactions that key off the sender, and federated copies on allied hubs would
not be rewritten anyway — so the same message would show two different authors
depending on which hub you read it from.

*Let the leaver choose whether their messages go.* Rejected for the first
release. It is a real position, but it is a per-message deletion feature
wearing a departure's clothes, and it needs an answer for federated copies
before it can promise anything.

**Tradeoff.** Someone leaving is still visible in the history they wrote,
under a pubkey with no name. That is honest about what a shared record is, and
it is less than they might expect — so the confirmation has to say it, in the
same voice as the remove-from-device one.

**Outcome — the consequence to design against, not inherit.** Dropping the
roles silently re-arms the invite gate: it is `has_roles == 0`, and
`assign_initial_roles` grants `builtin-everyone` on a first auth, so today
anyone who ever joined can come back freely. After a real leave they cannot,
on an invite-only hub. That may well be right — leaving should mean something
— but it must be *chosen*, said in the confirmation, and not discovered later
by someone who assumed the door stayed open.

## A hub may hold what you sign or encrypt, never what can reconstitute you — the identity vault is rejected

**Decision** (2026-09-05, user call): the hub-hosted identity vault
([identity-vault.md](identity-vault.md)) is **not built**, and this is not a
deferral. It had been parked since 2026-07-19 pending the first external
pilot; that trigger is withdrawn, because no amount of evidence about how
people lose identities changes what the feature is.

The vault would store a passphrase-wrapped copy of the **master seed** on the
user's home hubs, so someone who kept neither the 24 words nor a
`.wavvon-backup` file could recover by remembering a passphrase. The design is
complete and would work. Its own doc is honest about the price: the hub holds
brute-forceable ciphertext of the seed, an operator or anyone with a database
dump can attack it offline forever, and no rate limiting applies because the
attacker never touches the endpoint. Same crypto as the file, far wider
exposure.

**The rule that decides it, stated once so it decides the next one too: a hub
may hold anything the user has signed or encrypted, and nothing that can
reconstitute the user.** A hub is not, in any sense, the owner of an account.
It holds *profiles* — how you appear in that community — plus records you
signed (the home hub list, device certs) and blobs you encrypted (prefs, DM
history). Every one of those is inert without you. A wrapped master seed is
the single exception: it is the identity, one passphrase away, and putting it
on someone else's machine makes that machine a place your identity can be
taken from. Losing both of your own copies is the user's loss to take.

**Alternatives considered.**

*Build it opt-in, behind Argon2id and strong-passphrase warnings.* This was the
recommendation on the table, and it does bound the damage rather than pretend
to remove it. Rejected because the mitigations are all quantitative — a better
KDF, a longer passphrase, a self-hosted slot — and the objection is not. The
exposure exists the moment the ciphertext leaves the device, whatever the work
factor.

*Keep parking it behind the pilot.* Rejected as its own small cost: an
undecided question gets re-argued every time someone reads the wiki, and this
one had already been reopened twice. A "no" with a reason ends it; a "later"
does not.

**Tradeoff, accepted deliberately.** Someone who keeps neither the phrase nor
a backup file loses their identity, permanently, with no recourse — no reset,
no support path, because there is no account to reset. That is the cost of the
project's central claim rather than a gap in it, and the honest thing is to
make the two recovery paths easy and say plainly that they are the only two.

**Outcome.** It also closes one of the three ways out of the own-DM
`[decryption failed]` limit: syncing the sender's plaintext stash through the
prefs blob needs a paired device to derive the blob key, which needs the vault
(decisions.md, "Devices stay subkeys"). Two remain — re-encrypting each message
to the sender's own DH key, which is a cross-repo wire-format change for a
convenience, and the honest UI message, which shipped the same day. Matrix
answered this wall with 4S, server-side encrypted secret storage; that is the
same trade under a different name and the same answer applies.

## "Leave hub" does not leave, so it stops saying it does — and a confirmation names what stays behind

**Decision** (2026-09-05, design; execution in next-up.md): the sidebar's
**Leave hub** becomes **Remove from this device**, it asks first, and the
confirmation says what removing does *not* do. A real server-side leave is a
separate feature, filed in [future-features.md](future-features.md) rather than
folded into this.

Reading the code to design the confirmation turned up that the entry this was
drawn from rested on a wrong premise, and that the label has been lying:

- **`removeHub` is purely local** (Wavvon-clients:
  `apps/web/src/platform/commands/hubs.ts`). It closes the socket, drops the
  session, forgets the saved hub and the token. It does not call the hub.
- **There is no leave endpoint to call.** Wavvon-server's router has
  `/bots/{id}/voice/leave` and `/alliances/{id}/leave` and nothing for a person
  leaving a hub. Leaving a community is not a thing the hub knows how to be
  told, so the user stays in the roster, keeps their roles, and stays a
  deliverable DM recipient — permanently.
- **Rejoining is free**, contrary to the "rejoining an invite-only hub is not
  something the user can do alone" this was written on. The invite gate is
  `has_roles == 0`, and `assign_initial_roles` gives every member
  `builtin-everyone` on their first auth, so anyone who has ever joined skips
  the gate on the way back in.

So the risk is not the one the entry named. A mis-click is cheap and reversible.
What is expensive is invisible: **if the hub is a home hub, the signed
designation still names it.** Senders keep delivering DMs to a hub this client
no longer has a session for, the inbox goes quiet, and nothing says why — the
same invisible-DM failure the 2026-08-30 read-from-the-home-hub fix was for,
arrived at from the other side. The prefs blob and the device registry live
there too.

**Alternatives considered.**

*Keep the word "leave" and make the confirmation carry the nuance.* Rejected:
the dialog would spend its first sentence undoing its own button. A control
that says one thing and does another is a defect whatever the dialog adds, and
the fix is free.

*Have leaving re-sign the designation to drop the hub.* Tempting — it makes the
word honest — and rejected on two counts. It needs the master seed, so a paired
device could not do it, giving the same button two meanings depending on which
device you are at. And silently editing a signed identity record as a side
effect of a local UI action is the exact shape of the bug found earlier the
same day, where an automatic single-hub designation won on sequence and reset
someone's home hubs. Editing that list stays deliberate, in Settings.

*Refuse to remove the last home hub.* Rejected: it holds the user hostage in a
hub they have asked to be rid of. Allowed, with the warning naming what stops
working rather than a wall.

**Tradeoff.** The user still cannot actually leave a community they joined —
this decision makes that visible instead of fixing it, which is worse for
anyone who wanted out and better than the status quo, where they believed they
had left. The real leave has its own questions (what happens to their messages,
whether an operator can refuse, whether it is a tombstone or a delete) and
answering them inside a confirmation-dialog design would have buried them.

**Outcome.** Also settled, since the dialog needs them: the hub may attach an
operator-written farewell, on the `welcome_label` pattern — a `hub_settings`
key served on `/info`, plain text, length-capped, edited in hub admin. It is
rendered as **mediated**: attributed to the hub, visually secondary to the
app's own words, never styled as a warning the client is making, because the
moment someone is leaving is exactly when a hub has an incentive to mislead.
It stays in whatever language the operator wrote it in while the dialog around
it is translated; a mixed-language dialog is the honest outcome.

## Client state access: containers only. No context, and no store until a ref mirror actually breaks something

**Decision** (2026-09-05): shared components in `packages/ui` stay **prop-only**,
App.tsx keeps its per-app containers, and the store proposed as Phase 2 of
[state-access-design.md](state-access-design.md) is **not built**. React Context
is rejected outright. This closes a proposal that had been open since
2026-07-29 without a decision, which is its own cost — an undecided document
gets re-read and re-argued every time someone touches App.tsx.

What settled it is that the proposal named its own stopping condition — *"if
Phase 1 alone lands App.tsx somewhere the user is happy with, stop there and
skip Phase 2 — the ref mirroring is a papercut, not a fire"* — and that
condition is met. Measured 2026-09-05:

- **Phase 1 shipped and hit its estimate.** `ChannelSidebarContainer`,
  `SettingsPageContainer`, `HubAdminContainer` and `AppModals` all exist on
  web; App.tsx is 1,679 lines against the ~1,650 predicted.
- **Phase 2's justification grew rather than shrank**, and that turns out not
  to matter. The hand-mirrored refs in web App.tsx were ~13 when the proposal
  was written and are **19** now; `useWsHandlers` is still frozen (`useMemo`,
  deps `[]`).
- **The bug class the store was meant to remove has never occurred.** The
  proposal's tradeoff paragraph justifies the second state model as buying
  safety from "a frozen memo capturing first-render values". Searching all
  **4,107 lines** of [shipped-log.md](shipped-log.md) — which records every
  real defect this project has found — for stale refs, stale closures and
  frozen handlers returns **nothing**. Nineteen ref mirrors are plumbing we
  pay for in lines, not a source of defects.

The classes that *do* recur in that log are silent fallthroughs, cross-hub and
cross-client gaps, and name drift across process boundaries. A store addresses
none of them.

**Alternatives considered.**

*React Context slices.* Rejected on three counts, all still true: a context
re-renders every consumer on any value change, so voice state changing several
times a second would re-render the message list unless we hand-maintain the
memo discipline a selector gives free; it does nothing for the frozen WS
registry, which reads outside render and would keep every ref; and it turns
"an optional prop a client omits" into "a context field both clients must
supply", directly against the union rule that made the 2026-07-20
consolidation work.

*The ~30-line `useSyncExternalStore` store.* The strongest option on paper —
selectors plus readable/writable outside React, no new dependency — and still
declined, because it buys a second state model ("where does this live?" on
every new feature) against a cost that has produced no bugs. It is deferred,
not refused: see the trigger below.

*Convergence instead.* [next-up.md](next-up.md) already names the better lever
for the same file: web/desktop hook pairs (`useDms`, `useScreenShare`,
`useWhisper`, …) differ mainly in platform access, so they can be hoisted into
`packages/ui` with an injected actions object and **both app copies deleted**.
That removes duplicated code; a store only moves plumbing inside one file.
Desktop is still at 2,055 lines, and it is duplication rather than prop
threading that keeps it there.

**Tradeoff.** App.tsx stays larger than a store would leave it, and every new
piece of WS-visible state still costs a hand-written ref mirror — a real,
recurring papercut we are choosing to keep paying. Accepted because the
alternative is a permanent second state model bought against a hypothetical.

**Outcome.** The trigger to reopen is named and narrow: **the first real defect
caused by a stale ref mirror or a frozen handler reading first-render values.**
When that lands, the store is a ~30-line `packages/core` module and the plan is
already written — Phase 2 of state-access-design.md, unchanged. Two secondary
triggers from the proposal also stand: render tests arriving in `packages/ui`
(providers would then have a harness cost they lack today), and the Android
rewrite becoming near-term (a third client raises the value of components that
self-serve state).

## Devices stay subkeys, and a device certifies itself at first auth

**Decision** (2026-09-05, implemented web + hub the same day): Wavvon keeps the
master-key → per-device-cert identity model, and issues a device its self-cert
the first time it **authenticates at a hub** — not the first time its owner
opens Settings → Devices and types a name.

The question that forced this was the reverse one: whether to drop subkeys
entirely, give every device the same master seed by importing an exported
profile, and stop replicating personal-axis state at all. That framing came
from a real frustration — the roster-pubkey/master-pubkey split is invisible
until something crosses it, and then it silently does nothing.

What settled it is that the split was never the bug. **The trigger was.** The
cert is the only thing linking a roster pubkey to the master a home hub list is
signed by and stored under, and `issueSelfCert` was reachable only from the
device *naming* flow. Almost nobody names a device, so almost no identity had a
link on any hub: no hub could find its designation, DM mirroring skipped it, and
a sender's hub declined to fan out — with no error anywhere. Binding an
identity-critical record to a cosmetic action is the defect; the record itself
is fine.

**Alternatives considered.**

*One key, N devices, carried as an exported file.* Delete pairing and subkeys
(≈210 references in the server, ≈200 in the clients), make multi-device an
import of the `.wavvon-backup`/`wavvon-archive` the clients already produce, and
shrink the home hub designation to a single hub. Genuinely smaller, and it
dissolves the roster/master split by construction rather than fixing it.
Rejected on evidence: Matrix converged independently on exactly Wavvon's shape —
cross-signing ([MSC1756](https://github.com/matrix-org/matrix-spec-proposals/pull/1756))
has a master key signing a self-signing key that signs each device, and a device
is registered at **login**, with its name purely cosmetic. Per-device keys buy
two things the single-key model cannot: revoking one device without burning the
identity, and a compromised device that does not hand over the whole identity.
The opposite path exists in the wild (Nostr: the key *is* the identity, carried
around by hand) and its lived failure mode is exactly private-key hygiene.

*Matrix's own answer to "where do I deliver?"* is worth recording because we
cannot copy it: their MXID is `@user:server`, so the server is inside the
identity and DNS resolves delivery — no designation, no signed list, no link to
maintain. They paid for it with a decade of no account portability
([MSC1228](https://github.com/matrix-org/matrix-spec-proposals/pull/1228), open
since 2018), and are now moving toward keys-as-user-IDs to get it back
([MSC4243](https://github.com/matrix-org/matrix-spec-proposals/pull/4243),
[MSC4080](https://github.com/matrix-org/matrix-spec-proposals/pull/4080),
[MSC4348](https://github.com/matrix-org/matrix-spec-proposals/pull/4348) — none
with a qualifying implementation yet). Wavvon already has key-as-identity, which
is why it meets this problem first and has nothing finished to copy.

**Tradeoff.** Keeping per-device keys keeps the machinery: certs, revocations,
pairing, and a device that holds no master seed. It also keeps a coupling worth
naming — a paired device has no local entropy to derive the prefs blob key, so
"sync the own-message stash through the prefs blob" is not available to it. That
is the same wall Matrix hit and answered with server-side encrypted secret
storage ([MSC1946](https://github.com/matrix-org/matrix-spec-proposals/pull/1946),
shipped as 4S and now the default in Element). Our equivalent,
[identity-vault.md](identity-vault.md), stayed parked — and was **rejected
later the same day** (see the entry at the top of this file). So the price
named here is one the project declines to pay: per-device keys stay, and the
user who keeps nothing loses their identity. What that costs concretely is the
own-message stash, which now has no cheap route at all.

**Outcome.** Two things had to change together, and the second was only visible
once the first was written. `!!subkey_cert` was standing in for "this is a
paired device" in four places, and once every device holds a cert that proxy
inverts — `ensureHomeHubDesignation` would have stopped publishing for
everyone, trading a silent bug for a worse one. The exact test is local: a
paired device's seed derives a *different* master than the cert it was handed
names, so `holdsMasterSeed()` (Wavvon-clients:
`apps/web/src/identity/store.ts`) is the predicate, and all four sites use it.
On the hub, the fan-out resolver
(Wavvon-server: `crates/hub/src/routes/dms/messages.rs`) read only
`users.master_pubkey` while the mirror path's `master_of` already fell back to
`subkey_certs` — so a member whose cert was registered without a re-auth was
mirrored to but never fanned out to. Both now call `master_of`.

## A paired device authenticates at the hub, never at the farm

**Decision** (2026-09-05, implemented web + farm the same day): a farm-managed
hub tells clients to send `/auth/*` to the farm — that is what
`/info.farm_url` means, and it is what gives a farm one token across all its
hubs. An identity holding a **subkey cert** is exempt: it authenticates at the
hub itself.

Resolving a subkey to the identity it speaks for is the hub's job and only the
hub can do it. `resolve_canonical_identity` reads either the cert the client
presents or the device row the pairing flow registered with *that hub*, and a
farm has neither. So a paired device sent to the farm got a farm token whose
subject was its own subkey — and the hub, which trusts a farm token's subject
completely, seated it as a brand-new user. The join succeeded. Nothing logged
anything. The device was simply somebody else, on every farm-hosted hub, and
the two accounts diverged from there: separate roles, separate DM ratchet,
separate everything.

The farm's own `/auth/verify` now also resolves a **presented** cert
(`subkey_cert` in the body, which every client already sends) to its master,
filling in the `master` field its token payload has always declared and the
`farm_users.master_pubkey` column that has always existed — the code said
"no cert resolution in Phase 1 — that lives on the hub still". That is worth
having on its own, but it does not cover this case: the web pairing flow does
not carry a cert into the join, it registers the device with the hub, so the
farm sees no cert to resolve.

**Alternatives considered.**

*Give the farm a device registry.* The farm would hold certs farm-wide and
resolve any of its hubs' paired devices. It is the shape that keeps SSO for
paired devices too, and it is a real feature: a second identity store, its own
revocation path, and a new answer to "which of these two registries is
authoritative when they disagree". Not for a case that today has no reported
user.

*Have the hub re-resolve the farm token's subject.* The hub would look up the
subject in its own device table and swap in the master. Cheap, and wrong in a
way that is hard to see: it makes a farm token mean something different
depending on which hub redeems it, and the hub cannot tell "this subkey belongs
to a master I know" from "this pubkey happens to be in my devices table for
another reason" without the cert the token never carried.

**Tradeoff.** A paired device loses farm SSO: it authenticates per hub, like
every device on a standalone hub does. In exchange it is the same user
everywhere, which is the whole point of pairing.

**Outcome.** `28-pairing` passes against a farm-hosted `/hub/<pubkey>` — it
had been failing there, and only there, since the shape existed. Found by
pointing the live suite at a farm-hosted hub through e2e-topology's
`farmbrowser` stage; no in-process suite could see it, because both halves
(client and farm) behaved exactly as written.

## An invite link does not stop at the recovery phrase

**Decision** (2026-09-03, implemented web the same day): a visitor who arrives
on `/join/<code>` and creates an identity is not shown the 24 words on the way
in. The identity is created, labelled with the suggested name, and taken
straight to the profile step; the welcome screen that names the hub does the
joining. The phrase moves to **after** the first message, and until the key has
actually left the browser the client says so continuously.

The old flow put the phrase screen between a clicked link and a first message,
with the copy "Anyone with this phrase can control your identity" and a button
reading "I saved my phrase — Continue". Nothing verified that claim, and at
that moment the visitor has nothing to lose, which is the worst possible time
to ask anyone to write anything down. It bought friction and no safety.

What replaces it has to be un-losable, because nothing else holds a copy: the
seed lives in one browser's IndexedDB, passkeys here are the hub's own session
credential rather than a seed wrapper, and the PRF-derived identity path that
would have changed that was pulled in July when the provider matrix came back
too thin (see "Passkey PRF output is the identity entropy" below, and clients
`9afe8b0`). So the unsaved state is **three fixed things, no toast**: a marker
on the settings gear, which is always on screen and never moves; a line in the
backup section saying the identity exists only in this browser; and one prompt
at the first message the user sends, whose "Not now" leaves the marker rather
than clearing it. Revealing the phrase or exporting a `.wavvon-backup` clears
all three.

Every other entry path still hands the key over on the way in and is recorded
as having done so: creating deliberately shows the words and asks, recovering
means the user typed them, and a paired device holds a subkey it could never
reveal a phrase for — asking it would be a lie. The flags are per account and
**device-local, never synced**: the prefs blob is decrypted with a key derived
from the very seed they are about, so a browser that has lost that seed could
not read them, and a second browser asking again is the correct answer.

**Alternatives considered.**

- **Keep the gate.** Rejected: it was already an unverified self-attestation.
  Trading a placebo for something that can actually work is not a safety loss.
- **Verify the phrase by asking for words back.** Rejected for the invite path
  — it makes the wall taller at the moment we are trying to lower it. It is the
  right shape for the deliberate create flow if that ever needs strengthening.
- **A toast after joining.** Rejected: a reminder that can be dismissed into
  nowhere is worse than the gate it replaced, because it also feels handled.
- **Auto-join without the welcome screen.** Rejected: the screen names the hub,
  shows who hosts it and its icon, and is the only confirmation between a link
  someone was handed and joining. One click on a screen that says where you are
  going is not the friction that was hurting.
- **Defer until the passkey path returns.** Rejected: that path has no date, it
  depends on WebAuthn PRF support this codebase does not control, and the
  invite flow is the one people actually arrive through today.

**Tradeoff accepted**: there is now a window in which an identity exists with
no copy anywhere. It closes the first time the user posts, and the marker
persists until they act — but a browser wiped before either still loses the
identity, silently. That is the price of not asking for 24 words at the door,
and it is why the state is a fixture rather than a notification.

## Passkeys belong to the hub, so the user build has none

**Decision** (2026-08-29): a passkey affordance is rendered only when the page
is served from the hub it would authenticate against. In the hub build that is
always true; in the user build, hosted on our own domain, it is never true. The
user build therefore has no passkeys at all, and signing in there is the
recovery phrase or the backup file.

This closes the open RP ID question from the two-build split, and the answer is
that the user build's RP ID has no bearing on hubs: it never gets to pick one.
A passkey's rp_id is the hub's own hostname (`webauthn_rp_id`, defaulting to
the host in `public_url`), and a browser only lets a page use an rp_id its own
origin is registrable under. A page on `app.wavvon.example` asking for
`chat.example` is refused by the browser, not by us. Nothing about that is a
policy we can set.

Before this, both builds rendered the passkey section and the add-hub modal's
"use a passkey" button, and the user build's version failed at the ceremony
with a SecurityError translated into "open the hub URL directly".

**Alternatives considered.**

- **Related Origin Requests** — a hub publishes `/.well-known/webauthn` listing
  the user client's origin, and a browser then allows that origin to use the
  hub's rp_id. This is the mechanism designed for exactly this shape. Rejected
  for now on two counts: browser support is recent and uneven, so it would work
  for some visitors and fail for others with no way to tell them apart in
  advance; and it asks every hub operator to publish a well-known file naming
  *our* domain, which makes a federated hub's passkeys depend on a host the
  operator does not run. Revisit if the user build ever becomes the primary
  entry point — the cost is one static file per hub and a capability string.
- **Ship the buttons and let the ceremony fail** — what we had. The failure is
  a system dialog followed by an error, at the moment someone is trying to sign
  in.
- **Gate on the build flag instead of the origin.** Simpler by one comparison,
  and wrong for anyone self-hosting either build: the constraint is where the
  page is served from, which a build flag does not know. The check is
  `passkeysUsableWith(hubUrl)` in the web client's platform layer.

**Tradeoff.** Someone who moves from a hub's page to the user client loses
passkey sign-in — the handover screen says so. They keep it whenever they open
the hub's own address, which is also the only place it ever worked.

**Outcome.** Hub build unchanged; user build has no passkey UI. A hub that
overrides `webauthn_rp_id` to a parent domain would in principle admit a
sibling origin, and the client says no there too: the rp_id is not on `/info`,
and finding out costs starting a ceremony.

## The directory is English only; the clients stay translated

**Decision** (2026-08-29): the discovery site ships one language. The clients
keep their four (en/it/es/de) and can gain more.

The directory was translated into six languages and reverted the same day. The
revert is the decision worth recording, because the translation looked
obviously right: the directory is the first Wavvon surface a stranger meets,
and it was the only one with no translation at all.

What that missed is that a directory is a frame around other people's writing.
Its content is the listings — a hub's name and bio, a bot's command
descriptions, a client's feature notes — and every word of that is written by
whoever published it, in whatever language they chose. The site cannot
translate it and should not try. So translating the site translated the
navigation, the filter labels and the empty states, and left a Portuguese
reader looking at Portuguese chrome wrapped around English listings.

**Alternatives considered.**

- **Keep the six and accept the mixed page.** A reader still gets their own
  language for the parts we wrote. Rejected because those parts are the small
  ones, and the price was permanent: `[locale]` routing, an Accept-Language
  middleware, a switcher, a coverage gate, six catalogues to hold in step, and
  168 prerendered documentation pages instead of 28 — all to be re-paid on
  every page added.
- **Machine-translate the listings on render.** Rejected: a hub's own
  description of itself is not ours to rewrite, and a wrong translation of an
  admission rule or a moderation policy is worse than one the reader has to
  paste into a translator knowingly.
- **Let publishers declare translations of their own listing text.** Not
  rejected — deferred. This is the version that would actually work, because
  it puts the words in the hands of whoever wrote them. It is a wire-format
  question, not a website question, and nothing today asks for it.

**Tradeoff.** A reader who does not read English meets an English directory.
That is a real cost and it is the one we chose: they were going to meet
English listings regardless, and the client they end up in — the thing they
will actually spend time in — is translated.

**Outcome.** 3,164 lines deleted from the discovery repo, no dictionary in the
browser bundle, and a note in that repo's `CLAUDE.md` saying not to bring it
back without solving the listings first.

## Every listing on the directory is signed, bots included

**Decision** (2026-08-28): a listing is published by proving possession of the
key it names, and removed the same way. No exceptions.

Hubs, clients and skins had done this from the start. Bots had not, and it was
an oversight that read like a design: `POST /api/bots` believed whatever
`pubkey` the body carried, `PUT` overwrote on the same terms, and `DELETE`
took no credential at all — a bare `curl -X DELETE` removed anybody's listing.
The submit page was a form that asked an author to *type* a public key.

**Alternatives considered.**

- **A moderation queue.** Approving listings would stop the takeover, and would
  make the directory a gatekeeper — the one thing it must never become. It also
  scales with our attention rather than with the network.
- **An API token per publisher.** A credential we issue is a credential we can
  revoke, which is the same gatekeeping wearing a different hat, and it means
  running an account system for a site that deliberately has no accounts.
- **Leave it; a bot listing is low value.** Rejected on the shape of the bug
  rather than its blast radius: an unauthenticated delete is not a small
  version of a problem, it is the problem.

**Tradeoff that decided it.** Signing costs a publisher one signature and costs
this site nothing to verify, because the primitive was already there for three
other listing types. The alternative that "costs less" costs a policy.

**Outcome.** `POST /api/bots` takes `{payload, sig}` and verifies through the
same `signed-listing.ts` as clients and skins; `DELETE` requires a signature
over the pubkey. `PUT` is gone — republishing updates, and one write path is
easier to reason about than two. `/bots/submit` is gone with it: a bot runs on
its author's machine and already speaks this API, exactly as a hub publishes
itself.

---

## The directory does not probe hubs

**Decision** (2026-08-28): uptime tracking is removed. Discovery makes no
scheduled outbound request of any kind, and a listing that has gone stale is
reported by whoever noticed.

It was built as designed in [discovery-v2.md](discovery-v2.md) — a ping every
fifteen minutes, a `hub_pings` table, a 7-day percentage on every card — and
then deleted.

**Alternatives considered.**

- **Keep it, cache the aggregate.** A denormalised column would fix the query
  cost. Rejected because it fixes the cheaper half of the problem and leaves a
  table growing at 2,880 rows per hub per month for a number nobody browses by.
- **Probe on demand, when somebody opens a hub's page.** Genuinely tempting:
  the cost becomes O(views) instead of O(hubs), and no table is needed.
  Rejected for now because it still makes the directory a thing that reaches
  out to hubs on a schedule set by strangers, and because the reported-listing
  path covers the same need at zero infrastructure. Worth revisiting if reports
  turn out not to arrive.

**Tradeoff that decided it.** The probing itself was never expensive — a
thousand hubs every fifteen minutes is about one request a second. What was
expensive was rendering: the browse page computed the 7-day aggregate per card,
per render. And a directory of communities is not a status page; the question a
reader asks is "is this for me", not "what was its availability last week".

**Outcome.** The `hub_pings` table, `lib/uptime.ts`,
`POST /api/internal/ping-hubs` and `CRON_SECRET` are gone. The hub detail page
says plainly that the directory does not probe, so a dead address stays listed
until somebody reports it, and offers the report link next to that sentence.

---

## A hub is self-hosted; no client creates one

**Decision** (2026-08-28): a hub comes into existence because somebody ran the
binary on their own server. There is no flow, in any client or on the
directory, that creates one for you.

A **farm** is the server-side aggregate of hubs an operator runs, and it is
**not a client concept**. The farm admin panel, its settings, quotas and
creation policy, and the eighteen Tauri commands behind them are removed from
web, desktop and the Tauri shell. An operator who chooses to run hubs for other
people is a **provider**, and the directory lists that offer at `/providers`.
That list is a curated file in the directory's own repository, not a registry
farms publish to: hubs, clients and bots describe themselves and are signed,
while a page about which companies sell hosting is editorial.

**Alternatives considered.**

- **Keep creation, restrict it to your own farm.** A farm operator would have
  kept a provisioning UI inside the client. Rejected because it leaves the farm
  noun in the client to serve one rare user, and the same operator already has
  a server in front of them — the place where provisioning belongs.
- **Keep the hosted wizard, drop only the in-client path.** Rejected: the wizard
  hands somebody a hub they did not install, which is the thing being ruled out.
  Halfway would have left the bootstrap-token handshake and the signed template
  catalogue alive with nothing to feed.
- **Delete farms from the directory entirely.** Rejected: renting out capacity
  is a real choice an operator can make, and somebody who cannot run a server
  still needs a road. What was wrong was the *noun*, not the listing.

**Tradeoff that decided it.** Creating a hub for somebody is the one operation
that makes the network depend on whoever performed it — a hub you did not
install sits on hardware you do not control, provisioned by a flow you did not
run. Every other part of Wavvon is arranged so that no such dependency exists.
Removing the flow costs the least technical user a click and gains the property
that owning a hub and running a hub are the same act.

**Outcome.** The `seed` crate — a cross-farm registry nothing ever read — is
deleted; discovery's provider list answers the same question and is the only
one with a reader. Discovery loses `/new`, `/api/wizard/generate`,
`/api/bootstrap/redeem`, the `bootstrap_tokens` table, the config-template
catalogue and `/submit`; `/farms` becomes `/providers`, a curated file rather than a table. The clients lose the
creation wizard, the farm admin surface and 103 translation keys per locale.
Two things keep the word "farm" deliberately: `farm_url` on the hub's `/info`
(renaming it is a wire-format change) and the path-prefix parsing a client needs
to join a hub that shares a host. [hub-creation-wizard.md](hub-creation-wizard.md)
is superseded; the hub's own first-run bootstrap is untouched.

## Two web clients: one per hub, one per user

**Decision** (2026-08-25): the web client ships as **two builds from one
codebase**.

- The **hub build** is what a hub serves from its own origin
  (`WAVVON_WEB_CLIENT_DIR`, unchanged). It shows *that hub and its
  interconnections* — nothing else. No hub switcher, no add-hub, no directory,
  no create-hub, no home-hub list. It is version-matched to the hub that serves
  it, so an operator upgrades when they like and their users are never served a
  client newer than their hub.
- The **user build** is served from one origin we host, next to the directory,
  always at the current release. This is the only build that knows what a *list
  of hubs* is: identity, the hub list, home hubs, discovery, multi-hub
  switching.

This supersedes the "Distribution: hosted page vs. browser extension" row in
[browser-client.md](browser-client.md), which named hub-served as the primary
path for a single multi-hub client. Both halves of that stance survive, split by
job rather than ranked.

**What this buys, stated precisely.** Not less code — the hub build still needs
identity, backup, channels, voice, settings, and the shared surface is ~90%.
What it removes is a *concept*: in a hub's origin there is no such thing as a
list of hubs. Every edge case of the previous few days — an invite link landing
you where your identity does not exist, per-origin identities that diverge, a
hub list that must be taught to travel — needed that concept to exist in N
origins. Now it exists in one.

It also fixes version skew in the direction that was hurting: an old hub used to
serve an old *client*, so its users sat on a stale UI. Now the stale client only
ever talks to the hub it matches, and the user build (always current) degrades
per hub through the capability strings that already exist for exactly this.

**The invite link still points at the hub's own origin.** Deliberate: the
on-ramp must not depend on our domain being up, unblocked, or paid for, and the
hub operator keeps sovereignty over how people arrive. A newcomer sees one hub
and zero concepts, which is also the better onboarding. The user build is an
upgrade offered from there, not a requirement.

**Handing an identity from the hub build to the user build.** A button — put on
the **identity-creation screen**, not buried in settings — opens the user build
in a window and hands over `{hub_url, invite_code?, seed_hex?}` by
`postMessage`, targeted at the user build's origin (a build-time constant).
The receiving side shows the sending `event.origin` and the key fingerprint and
**asks**, offering two answers: join that hub with the identity you already
have (the seed is dropped, the invite code is used with the existing key), or
bring this identity in as another account. On acknowledgement the hub build
wipes its local key and records that it migrated, so a later visit to that
origin redirects instead of offering a fresh start — which is what stops one
person becoming two users on one hub.

Three constraints on that flow, none optional:

- **The seed never travels in a URL** — not in a query, not in a fragment. It
  would land in history, in the referrer, and in logs. `postMessage` to an
  explicit target origin exists precisely so it does not have to.
- **No silent import.** Without a confirmation naming the origin and the
  fingerprint, any page could open the user build and push in an identity, or a
  hostile hub into the list.
- A blocked or closed window falls back to the recovery phrase or
  `.wavvon-backup`, both already shipped.

**Passkeys do not migrate, and the button's placement is the fix.** A passkey's
private key lives in the authenticator bound to the RP ID, which is the origin;
no message can move it. Offered at identity creation, there is nothing to move.
Clicked months later, the seed moves, the old passkey is dead weight on the
hub's origin, and the user makes a new one where they land. Worth saying out
loud rather than discovering.

**The automatic home-hub designation stays in both builds.** It reads oddly in
the hub build — publishing a list to a client that has no UI for editing it —
but the hub already holds that identity's profile, so its personal-axis state is
on that box either way; designating it does not extend trust, it states what is
already true. The prefs blob and the DM inbox then have a home, and a user who
never leaves that hub never needs the concept. Changing the list is one of the
things you graduate to the user build for.

The one place it degrades is a **LAN hub as your only home hub**: personal state
on a box that is unreachable when you are off that network. Accepted — LAN is
its own track ([lan-mode.md](lan-mode.md)) and the hub build is already its only
web path.

**This kills the `web+wavvon:` protocol-handler idea** (removed from
future-features.md the same day). It existed to guess where a user's client
lived; with a user build at a known URL, the target is a build-time constant and
the handover is an explicit, user-initiated message. No Safari gap, no
undetectable registration.

**Tradeoff.** A build matrix: every new feature must answer "which build is this
in?", and the answer is not always obvious. The gate is cheap — `constants.ts`
already does exactly this for `DISCOVERY_URL` (a build-time `null` with every
entry point written as `DISCOVERY_URL ? … : undefined`) — but the discipline is
ongoing, and CI has to build both. And the strip must be defined as "no hub
list, no directory, no create-hub, no switcher", **not** as "one origin only":
alliance channels, messages and forum already reach the user through their own
hub as a proxy, but alliance *voice* deliberately dials the owning hub's relay
direct ([alliances.md](alliances.md)). A single-origin build breaks it.

## The first hub you sign in to becomes your home hub, and the hub list rides the prefs blob

**Decision** (2026-08-25): a web client that reaches a hub with no
`HomeHubList` published for that account publishes one naming that hub, slot 0,
sequence 1 — once, never overwriting an existing designation, including one the
user deliberately emptied. And `wavvon:saved_hubs` joins the synced-settings
map, so the hub list travels in the encrypted prefs blob alongside theme and
language.

The two halves are one decision. An account with no hub is not a thing that
exists, so there is no reason to make the user find
Settings → Manage accounts → Home hubs before their personal-axis state has
anywhere to live — and until a designation exists, `resolveTargets` in
`prefsSync.ts` falls back to whatever hubs the session happens to be connected
to, which is not a durable home. Once the designation is automatic, the hub list
has somewhere to be stored, and clearing browser data stops costing the user the
map of where their communities are: the phrase restores the key, the key
decrypts the blob, the blob names the hubs.

**Why not carry the hub list in `.wavvon-backup`.** It was the first answer, and
it is worse. The file's payload is one account's `{label, secret_key_hex}`,
mirrored byte-for-byte in `apps/desktop/src-tauri/src/backup.rs` against a fixed
test vector — a field added there is a wire-format change in two repos for data
that is neither identity nor secret. The prefs blob already exists, already
syncs, already encrypts under a phrase-derived key, and already has a
version counter. The backup file's job is the seed; the hub list is state.

**Why not try to share storage across hub origins.** Each hub serves its own
copy of the web client from its own origin, and browser storage is per-origin —
so the identity set up on hub A's page is invisible on hub B's page, which is
what makes an invite link feel like it loses your account. There is no fix
available to a web page: cookies are per-domain too, a shared third-party
origin in an iframe is dead under storage partitioning in every modern browser,
and a page cannot read a file without the user picking it. The two mechanisms
that would work are outside the page — a browser extension
(`chrome.storage.local` is per-extension, not per-origin; considered and
rejected in [browser-client.md](browser-client.md) for maintenance cost) and
`navigator.registerProtocolHandler("web+wavvon", …)`, which makes one page on
the device the handler for every Wavvon deep link. The latter is the promising
one and is written up as an idea, not built:
[future-features.md](future-features.md).

**Tradeoff.** The hub list syncs last-writer-wins like every other value in the
blob, so two browsers open at once, each adding a different hub, lose one
addition until it is re-added. A union merge trades that for zombie hubs — a
hub removed on one device coming back from the other — which is the worse
failure, so LWW stands until a tombstone is worth building. And a browser with
nothing saved has no hub to sync through at all: `startPrefsSync` returns null,
and the first hub added in that session syncs nothing until the next page load.
Both ceilings are marked in the source.

**Consequence worth knowing.** Federated DM delivery already prefers the
designation over the stored `hub_url` (`routes/dms/messages.rs`, step 3), so a
designation existing changes where inbound DMs land — and the web client reads
conversations from the *active* hub, not from the home hub list. For the usual
case those are the same hub. For a user who signs in to one hub, abandons it and
lives on another, a friend's DM now goes to the abandoned one and is only
visible after switching to it. That is the client not yet reading the canonical
inbox the design calls for ([home-hub.md](home-hub.md) "DM delivery"), not the
designation being wrong; making the auto-designation the default is what exposed
it to everyone rather than only to users who published a list by hand.

## Outbound packet loss rides on `pong`, and is absent rather than zero

**Decision** (2026-08-22): the relay counts gaps in each sender's cleartext
`ctr` and returns the percentage on the existing `pong`, as an optional field
gated by a `voice.loss` capability. When there is no answer the field is
**omitted**, never sent as `0.0`.

Outbound loss can only be measured at the relay. A sender cannot know which of
its own datagrams were dropped, which is why the connection panel shipped with
inbound loss and a sentence explaining the gap rather than a fabricated zero.
The relay can: every voice packet's `[key_id][ctr][ts]` header is cleartext, so
reading a counter decrypts nothing and the hub stays a header-only forwarder.

**Alternative — a periodic stat frame.** The obvious shape, and one more
heartbeat: the client already sends `ping` every two seconds for latency, and
the panel already had somewhere to put a number. A second timer on the same
interval to the same client, carrying one float, is a mechanism where a field
would do. `pong` also keeps the hub stateless in the sense that matters — there
is still no probe table; the reply reads a map the relay maintains anyway.

**Alternative — always send a number, zero when unknown.** Rejected, and this
is the load-bearing half of the decision. A client cannot distinguish "this hub
does not measure outbound loss" from "your loss is 0.0%" if the hub answers 0.0
to both, and there are three ways to have no answer: not in voice, fewer than
two packets sent, and an older hub. A reassuring zero in any of them is worse
than an em dash, and it is the exact failure the panel was built to avoid.

**Tradeoff.** Loss is cumulative per voice session, so a long call dilutes a bad
patch into its average. Deliberate: the inbound figure alongside it has the same
property, and two numbers in one panel computed on different windows would
mislead more than either window being wrong. Both move to a sliding window
together, or neither. Marked in the source as a shared ceiling.

**Also settled**: the figure is keyed by pubkey and answered only to the socket
it belongs to. One participant's uplink is not the channel's business, and
publishing it to the roster would turn diagnostics into gossip.

**Outcome**: `voice_loss.rs` (~80 lines, pure, unit-tested), three integration
tests over the WS reply, one capability string, and one optional field. The
arithmetic deliberately mirrors `connectionStats.ts` — expected from the counter
span rather than elapsed time, so a silent participant is not reported as 100%
lost, and reordering is not loss on a QUIC datagram path where it is routine.

## Alliance voice: the owning hub's relay is the room, and visitors dial it directly

**Decision** (2026-08-22): a member of hub B joining voice in an alliance
channel owned by hub A authenticates to **hub A** with a short-lived,
hub-B-signed grant, receives a session scoped to `alliance_voice`, and dials
hub A's WebTransport relay directly. One room, on one hub, one sender-id space,
one E2E key fan-out. Design: [alliances.md](alliances.md) "Voice in alliance
channels".

This also **retires a claim the wiki carried for a year** — that cross-hub voice
"needs a relay redesign". It needs none: `voice_wt.rs`, `voice_channels`,
`voice_sender_ids`, the datagram header and the sender-key construction are all
untouched, so there is no `wire-format.md` entry and no three-way identity-crate
mirror. The visitor proves its own identity to hub A by challenge-response; only
its display name is hub-vouched, rendered mediated exactly like federated forum
authorship.

**Alternatives considered**: (a) a relay-to-relay mesh, hub B forwarding its
participants' datagrams into hub A's room — rejected: `sender_id` is a
per-channel u16 allocated locally, so two hubs collide; it also needs a
virtual-participant lifecycle, hub-to-hub relaying of `voice_key_offer` bundles,
and a third failure domain (mid-hub down while both endpoints are up), and it
buys only "the client keeps one connection" on a client that is already
multi-hub. (b) Merging rooms across every member hub — rejected on the ground
forum federation already rejected replication: no authoritative copy means
roster reconciliation and split-brain, for a surface where one room on one
server is simply correct.

**Tradeoff**: availability for simplicity. Hub A offline means its shared voice
channel is unjoinable — exactly as its shared *text* channel already is. And a
visitor's IP reaches hub A, which the join confirmation discloses by naming the
host being dialed. The scope is enforced as an **allowlist** (`/info`, the WS
limited to six voice/key frames, the two `dh-key` routes) rather than a denylist,
because the `lobby` scope's history is that a denylist grows a hole every time a
route is added.

**Outcome**: capability string `voice.alliance`; one optional field on
`/auth/verify`; one new route on the origin hub; one additive visitor table; one
additive `voice_remote_join` policy column on `alliance_shared_channels`. No
`users` row is created for a visitor, so "no message read access" is structural
rather than a check someone can forget.

## Certification relay inside a farm: the receiving hub pulls the portfolio

**Decision** (2026-08-22): when a hub's `cert_mode` gate is not satisfied by the
certs presented in `/auth/verify`, the hub **fetches the candidate's portfolio
itself** from each configured trusted issuer (`GET
/identity/{master}/certs`), bounded at 8 concurrent issuers, 2 s each, cached
10 minutes, failure-is-a-miss. Design:
[hub-certifications.md](hub-certifications.md) §11.

The trust wiring already shipped and the payoff never arrived, for one reason:
**nothing presents a cert.** No client sends the `certifications` array
`/auth/verify` has accepted since Layer 2 landed, so a hub setting `cert_mode`
to anything but `none` today rejects *everyone* with `cert_required`. The
feature is a lockout, not a relay. Pull makes it work with zero client
releases — which matters more than usual while the web client the hub itself
serves is the only delivery target.

**Alternatives considered**: (a) client push as the sole mechanism, per the
original §4 design — rejected as the only path: it needs the client to poll
`/certs/me` on every known hub, deposit into a portfolio, read the target's
advertised `cert_requirement` and select a subset, i.e. client work before the
server feature does anything; the privacy argument for client-side selection
(don't leak your membership list) does not apply intra-farm, where one operator
runs both hubs anyway. Push stays as the fast path — it is already implemented
and needs no hop. (b) A farm-level reputation store — rejected: it makes the
farm a trust root for reputation, which `hub/src/farm_siblings.rs` was written
specifically to avoid and which `farm-model.md` excludes ("hosting + SSO +
inbox"). (c) Auto-granting good standing to siblings' members — rejected in
`farm_siblings.rs`'s own header and still rejected: one complacent hub becomes a
pass factory for the whole farm.

**Tradeoff**: up to 8 outbound calls on a first auth that would otherwise be
refused — paid only on the miss path, only by a hub whose admin opted in, and
cached after. Intra-farm those calls are loopback, so the case the relay exists
for is the cheapest one.

**Outcome**: no capability string (nothing a client branches on changes — that
is the test), no `openapi.yaml` change. It also uncovered a live bug that must
be fixed first: `farm_siblings` writes `cert_trusted_issuers` as bare pubkey
strings while `certs::load_trusted_issuers` parses `Vec<TrustedIssuer>` and
swallows the mismatch into `unwrap_or_default()`, so sibling trust currently
resolves to an **empty list** — and because `farm_siblings::read_set` reads the
same key as `Vec<String>`, its write also **overwrites an admin's configured
issuers**. Another `unwrap_or_default()` over a shape mismatch saying nothing.

## Trust roots are a personal preference in the prefs blob, and never clear an admin's bar

**Decision** (2026-08-22): user-configurable trust roots — `{pubkey, label}`
entries that make a badge or cert from an otherwise-unknown issuer render as
trusted — live in the **encrypted prefs blob** as one allowlisted key in
`clients/apps/web/src/utils/syncedSettings.ts`. They affect **rendering only**
and never satisfy a hub's `cert_mode` gate. Design:
[server-tags.md](server-tags.md) Part 4.

**Alternatives considered**: (a) `localStorage` — rejected: precisely the gap
the prefs-blob work closed on 2026-08-21, and a trust list that vanishes in
another browser is worse than none, because the badge silently downgrades to
"(unknown issuer)" with no explanation. (b) A typed field on the blob like
`blocked_users` — rejected: a typed field is a wire-format change across the
identity crate, the TS mirror, the desktop mirror and the test vectors; the
generic `settings` map exists so a new preference costs one line. (c) Hub-side
trust roots — rejected: that is the *admin's* decision and already exists as
`cert_trusted_issuers`; viewer state on a community hub breaks the two-axis
rule.

**Tradeoff**: a root added on another device appears here on the next page load,
the propagation limit already recorded for every synced setting. Fine — a trust
root is not time-critical. The real discipline is the separation: letting a
viewer's preference clear an admin's admission bar would be the same pass-factory
failure the cert relay rejects, so the two lists stay strictly apart.

**Outcome**: set starts empty; no shipped defaults, because there is no
Wavvon-blessed authority. Added in context from the badge popover ("Trust this
issuer"); reviewed and removed in Settings → Privacy, one fixed home. Badge and
cert transitivity is promoted from "deferred" to **Won't do** in `ROADMAP.md` —
two documents had independently reached that verdict, so it was a decision
filed as a deferral.

## Farm↔node is TLS to an advertised host, and PostgreSQL is per node

**Decision** (2026-08-22): the two questions blocking the farm multi-node data
plane are answered. (1) The farm dials nodes over **plain TLS to a host the
agent advertises** in its WebSocket `hello`, validated either by CA or by a
pinned certificate digest (`WAVVON_NODE_TLS=ca|pin`) — not over an assumed
private network. (2) Each node runs its **own PostgreSQL**; the farm holds a
per-server connection *template* and never node credentials. Design:
[farm-model.md](farm-model.md) "Multi-node data plane".

**Alternatives considered**: (a) require WireGuard/VPC/SSH between farm and
nodes and keep dialing plaintext — rejected not as weaker security (it is
stronger) but because it moves a prerequisite the farm cannot verify into the
operator's lap, and a farm that silently proxies plaintext over the open
internet when the tunnel drops is the worse failure. Making the transport the
farm's own concern lets the farm *check* it; a private network remains an
operator choice that happens to make `ca`/`pin` trivial. (b) One central
PostgreSQL every node dials across the network — rejected: a single point of
failure for every hub on every node, every query on the wire, and it multiplies
the `WAVVON_DB_MAX_CONNECTIONS`-vs-`max_connections` arithmetic by the node
count.

**Tradeoff**: each node needs a certificate, and backup/restore becomes
per-node. The latter is nearly free — `backup`/`restore` are already per-hub
logical `pg_dump`, so the dump just runs where the data is — but the farm's
admin surface must name which node hosts a hub, or an operator looks for the
dump in the wrong place. The `pin` mode reuses the rotating-self-signed-cert
machinery voice already ships (`voice_cert_hash`), so there is an
implementation to copy rather than invent.

**Outcome**: additive `servers.host` / `tls_mode` / `cert_sha256` /
`db_url_template`, all defaulted so existing single-node rows stay loopback; the
five hardcoded `127.0.0.1` literals in `farm/src/proxy.rs` go on **both** paths
(the WebSocket socket-bridge is the one that will be forgotten). Sequenced
**after** "A PostgreSQL role per hub" — per-node Postgres without a role per hub
isolates between nodes and not within one, the exact gap
`farm/src/db/provision.rs` documents in its own header.

## Settings follow the identity, in the prefs blob, as raw storage strings

**Decision** (2026-08-21): the web client now pushes and pulls the encrypted
prefs blob, and carries the user's settings in it as a generic
`settings: Record<string, string>` map — storage key to the raw string that key
already holds. Which settings ride along is a single allowlist in
`clients/apps/web/src/utils/syncedSettings.ts`; adding one is a one-line change
with no wire-shape edit, and the rule for what qualifies is written there:
a choice about yourself travels, a fact about this machine does not.

The blob, its hub endpoints, its key derivation and its signed envelope all
already existed — the desktop client had a full push/pull round trip and the
hub has stored ciphertext under `/identity/{master}/prefs` since multi-device
landed. Web only ever *read* it, for the backup export. So a second browser on
the same identity, or an identity restored from a `.wavvon-backup`, started
from factory defaults: no theme, no language, no notification choices, no
ignored users. That was the gap `client-parity.md` had tracked as "future work
if a user actually complains", and a user did.

**Alternatives considered**: (a) typed fields per setting, the way
`blocked_users` / `voice_settings` / `hide_birthdays` are modelled — rejected:
every new setting would then be a wire-format change across the TS mirror, the
Rust mirror and the test vectors, which is exactly the tax that kept this
undone; a client only reads back keys it wrote, so the names need no
cross-client agreement. (b) Put the settings in the `.wavvon-backup` file —
rejected: that fixes restore and not a second live device, and it makes an
identity backup a settings backup, which is a different thing with a different
lifetime. (c) Sync through the hub's member state (`PATCH /me`) — rejected:
these are identity-level, not per-hub, and the hub would read them in plaintext.

**Tradeoff**: the blob is pulled once per page load and pushed on change, so a
change made on another device while this one is open lands only on its next
load. Live propagation needs a per-setting answer to "can this hot-apply?" —
language and theme are read at boot and cannot — and that is a bigger design.
A pull that did change something triggers exactly one reload, guarded by a
sessionStorage flag. Every client must round-trip the fields it does not
understand rather than drop them, or the two clients overwrite each other;
desktop's `LocalPrefs` carries `settings` as an opaque `serde_json::Value` for
that reason.

## One voice session per identity, latest join wins

**Decision** (2026-08-21): a pubkey occupies at most one voice channel per
hub. `voice_join` now evicts every prior membership for that pubkey through
the shared `leave_voice` teardown before registering the new one, so a second
device joining a different room takes the session over rather than adding to
it. The web client also sends `voice_leave` on teardown, which it never did —
only the desktop client had.

The hub always assumed the invariant without enforcing it: `voice_channels`,
`voice_sender_ids`, `voice_relay_active`, `voice_last_active`,
`whisper_target_defs` and the staging voice grants are all keyed by pubkey
alone. Two clients on the same identity therefore showed the user in two rooms
of the same hub simultaneously, and — because `leave_voice` is the sole
authority for roster removal while a closed WebTransport session only clears
the audio handle — a web client that left voice stayed in the roster until its
whole WS dropped.

**Alternatives considered**: (a) key the voice state by (pubkey, device) so
multi-device voice is genuinely supported — rejected for now: it touches every
voice side table, the wire roster, sender-id allocation and the encryption key
fan-out, to enable something nobody asked for; (b) reject the second join with
an error — rejected, the user who just double-clicked a channel on their laptop
wants to be there, and "your other device holds the voice session" is a dead
end they cannot act on from the device in front of them.

**Tradeoff**: joining voice from a second device silently kicks the first. That
is the rule most voice platforms apply, and it is recoverable in one click.

## The roadmap splits by commitment level, into three files

**Decision** (2026-08-21): `ROADMAP.md` becomes an index. The work moves into
`docs/next-up.md` (designed, in flight, plus Blocked and Known issues),
`docs/future-features.md` (intent settled, design pending) and
`docs/wishlist.md` (not committed to). An item moves right to left as it earns
it. `ROADMAP.md` keeps only the index and Won't do, and stays at the repo root
because `Wavvon-server/README.md` links it publicly.

The old file mixed four axes: commitment (Next up, Wishlist), status
(Blocked), kind (Known issues) and decision (Won't do). "Where does this go?"
had no single answer, and entries landed wherever — "Hosted web client"
self-described as *undesigned* while sitting in a wishlist whose sibling
`future-features.md` was defined as the undesigned bucket; "Passkey
registration from desktop" sat in the wishlist while a Blocked section existed
two paragraphs above; `future-features.md` still opened with "Farm layer —
**this is the major next change**, partially implemented" four months after
the farm shipped, and carried a section its own rule said to delete
(gaming, shipped 2026-07-19) plus one marked SUPERSEDED. The new split asks
one question — how committed are we — and the answer is monotonic, so an item
has exactly one home and the promotion path is visible.

**Alternatives considered**: (a) keep one file and enforce the sections
harder — rejected, that is what had been happening; the sections were
documented in `docs/CLAUDE.md` and still drifted, because the taxonomy itself
made two of them near-synonyms; (b) move only the misfiled entries and leave
the structure — considered and started, then rejected once the third
mis-sorted item turned up: the placements were symptoms; (c) a fourth file for
bugs — rejected, it would break the single axis. Known issues live in
next-up.md under a header stating they are open and not necessarily scheduled,
which is the honest reading and the one thing the commitment axis cannot say
about a bug on its own.

**Tradeoff**: the whole picture now takes three files instead of one, and 19
wiki documents plus a public README link to `ROADMAP.md`. Keeping the path and
making it an index preserves every one of those links; the deep ones that
named a section were already rotten — `README.md` pointed at a "Recently
shipped" section the roadmap never had, at a "Gaming Tier 3" wishlist item
neither the roadmap nor `gaming.md` contained, and at an E2E v2 wishlist entry
that shipped 2026-06-30.

**Outcome**: `docs/CLAUDE.md` updated in the same change, since it specified
the section list this replaces. No content was dropped without a destination:
shipped sections were deleted with the shipped log as their record, and
`docs/README.md`'s dangling `games-sdk.md` links went with the games removal
that had orphaned them.

## Every bot is an external bot — the self-service bot system is removed

**Decision** (2026-08-21): the hub has one bot model. A bot is an Ed25519
keypair its operator owns, invited to a hub by pubkey by someone holding
`MANAGE_ROLES` or `ADMIN`, accepted by signing the invite token, and
authenticated from then on through the normal challenge-response flow with
`is_bot: true`. `POST /admin/bots` — which minted a synthetic `bot_<uuid>`
identity plus a bearer token and could be called by *any authenticated
member* with no permission check — is gone, along with the `bots`,
`bot_slash_commands` and `bot_tokens` tables and `authenticate_bot`.

A bot running on the same machine as the hub is still an external bot.
Co-location is a deployment detail; it was never an identity model.

The two systems were near-duplicates. `bot_profiles` (external) is a
superset of `bots` (self-service) except for `token_hash` and
`created_by`, and `bot_commands` duplicated `bot_slash_commands`. This is
the "duplicate endpoints get folded, not versioned side by side"
constraint, and it had already produced the failure that constraint
predicts: `routes/bots/voice.rs` carried a comment explaining that the
`can_speak_voice` grant gates external bots and *deliberately does not*
gate the self-service voice endpoints, because self-service bots never
populate `bot_profiles`. A capability gate that silently does not apply to
half the bots on the hub is the silent-fallthrough bug class this
codebase has been bitten by twice before.

Removing it also removes a special case from the capability resolver.
`effective_capabilities` read "no `bot_profiles` row → self-service bot →
a grant is effective on its own"; with one model the rule is just
requested ∩ granted, and an orphaned grant on a pubkey that never asked
for anything is no longer effective by itself.

The `/bot/send`, `/bot/poll` and `/bot/events` HTTP transport **stays** —
it is the only way to write a bot with no persistent WebSocket, which is a
real capability and not a property of the auth mechanism. It moves to
session-token auth like everything else. `PUT /bot/commands` does go, as a
straight duplicate of `PUT /bots/me/commands`.

**Alternatives considered**: (a) keep both and make the capability gate
cover self-service bots too — rejected: it fixes the symptom and leaves
two auth paths, two tables and two consent stories to keep in sync
forever, which is how the gap appeared in the first place; (b) keep
hub-generated identities for convenience, with the hub minting a real
Ed25519 keypair and handing the private key over once — considered
seriously and rejected by the same call that made this one: the ergonomic
win was for the "any member clicks a button" flow, and that flow is
exactly what should not exist. A bot is infrastructure an operator runs,
not something a member conjures; (c) drop the polling transport along
with the system that introduced it — rejected: it would remove a shipped
capability for reasons that have nothing to do with it.

**Tradeoff**: a trivial webhook bot now costs an Ed25519 keypair and a
challenge-response handshake instead of copy-pasting a bearer token. That
is a real DX step up, mitigated by `bot-kit` and by `ttt-bot` already
being written against this exact flow — the reference bot never used the
self-service path.

**Outcome**: accepted in beta with no compatibility shim and a schema
baseline reset rather than dead tables left behind, on the explicit call
that breaking things now is cheap: there is no bot deployed anywhere, and
the one pilot hub was wiped the same day.

## The shipped compose files have no default database password

**Decision** (2026-08-21): `docker-compose.yml` and
`docker-compose.farm.yml` interpolate `${WAVVON_DB_PASSWORD:?...}` — no
default. Compose refuses to start until the operator sets it, in a `.env`
next to the file or in the shell. The README quick start gained one line
(`openssl rand -hex 16` into `.env`) before `docker compose up -d`.

Both files previously carried `${WAVVON_DB_PASSWORD:-wavvon}`. A default
in a public repo is a password every reader knows, and the failure mode is
silent: the hub comes up, works, and stays on it. The Postgres sidecar
publishes no host port, so the blast radius needs a second mistake — but
"needs a second mistake" is not a security property worth keeping. The
`wavvon-hub setup` wizard already generated a random password and wrote
`${WAVVON_DB_PASSWORD}` with no default into the compose file it emits;
the hand-written files were the outlier.

*Alternatives considered*: (a) keep the default and document the override
above it — that is exactly what `docker-compose.yml` already did, and it
is what any operator taking the quick-start path skips; (b) generate a
password on first boot inside the container — needs somewhere durable to
put it, which means either the data volume (unreadable to the operator who
later needs `psql`) or a bind mount the compose file doesn't have;
(c) accept the risk because the port isn't published — rejected: a shared
box, a later `ports:` addition, or a compromised neighbouring container
all remove that single layer.

*Outcome*: `docker compose up -d` on a fresh clone now fails with
`required variable WAVVON_DB_PASSWORD is missing a value` until the
operator sets one. That break is the point. Also cleared the literal
placeholder passwords out of `hub.toml.example` and
`crates/farm/Dockerfile` comments, which were tripping secret scanners.

## Hub capabilities are advertised, not inferred from a version number

**Decision** (2026-08-08): `GET /info` gains `capabilities: Vec<String>`, and
clients decide what to render by testing membership in that list — never by
comparing version strings. `version` stays in `/info`, but for display and for
a "this hub is very old" warning, not for deciding whether to draw a button.

Capabilities are **per-hub state**, held alongside name, icon and timezone in
the same record. This is not a new architecture: the client already keeps
channels, roles and permissions per hub, and `refreshHubInfo` already fetches
`/info` per hub — it currently discards the `version` it receives.

This matters more in Wavvon than in most federated products because of how the
web client is distributed. Each hub bakes a web client into its own Docker
image and serves it, and that client is **multi-hub**: the copy served by
hub A talks to hubs B and C as well. There is no "client and server update
together" — the client's version is decided by whichever hub the user happened
to open, and bears no relation to the hubs it then talks to. Matrix and
similar have one client per homeserver; Wavvon has one client across many.

`/info` is already a capability document without the name: `farm_url` means
"delegate `/auth/*` to the farm", and `challenge_mode`, `invite_only`,
`cert_mode`, `min_pow_level` and `birthdays_enabled` all drive client
branching today. The array formalises a pattern already in force.

*Alternatives considered*: (a) gate on the version number — rejected: it ties
the client to a release timeline, breaks on forks, backports and custom
builds, and requires the client to carry a "which version introduced what"
mapping nobody will maintain; (b) probe endpoints and treat 404 as absence —
rejected as the primary mechanism: it makes a missing feature and a broken
hub indistinguishable, and costs a failed round trip per feature. It stays as
the *safety net*: an unexpected 404 on a known endpoint degrades to "this hub
is older, feature unavailable" rather than a raw error.

*Tradeoff*: every new feature must remember to add its capability string, and
the list grows monotonically. Accepted — it is one line in the same commit
that adds the feature, and a forgotten capability fails visibly (the feature
never appears) rather than silently.

*Corollary — two web client channels, both permanent.* A hosted client
(`app.wavvon.io`) would decouple the client version from any hub and is the
right canonical entry point for public hubs. It **cannot replace** the
hub-served copy: a page served over HTTPS cannot call an `http://` hub, which
rules out LAN mode, self-signed hubs, and anyone trying Wavvon before buying a
domain. Keeping both is also the honest position for a self-hosted federated
product — a hub that stops working when our domain does would contradict the
premise. The hosted client itself is not decided here; the constraint that it
cannot be the only channel is.

## Wire changes are additive; removals wait for a major

**Decision** (2026-08-08): once 1.0 ships, the hub's HTTP and WebSocket
surface only ever grows. No endpoint is removed or repurposed, no response
field is deleted or has its meaning changed, no validation is tightened, no
enum value is retired. Removals accumulate for a major release.

This is what makes the benign direction of version skew actually benign. Of
the two directions, only one breaks:

| | Effect |
|---|---|
| New client → old hub | **Breaks.** Calls endpoints that do not exist |
| Old client → new hub | **Harmless**, *if and only if* the server is additive |

The additive rule buys the second row unconditionally. Capability advertising
handles the first. Neither alone is enough.

Serde already enforces much of this by construction: nearly every field on
`InfoResponse` carries `#[serde(default)]`, so an old client parsing a new
hub's `/info` ignores what it does not know and defaults what is absent. The
rule generalises that from an accident of the type definitions to a contract.

*Alternatives considered*: (a) version the API by path (`/v1/`, `/v2/`) —
rejected: it multiplies the surface to maintain and test, and self-hosted hubs
update on their own schedule so old versions can never be retired on a
timetable we control; (b) negotiate a protocol version at connect and branch
server-side — rejected: the branching lands in the hub for every skew
combination, which is the N×M matrix this avoids; (c) guarantee a supported
combination matrix — rejected outright: nobody can test it and it grows
quadratically.

*Tradeoff*: dead fields and superseded endpoints accumulate until a major.
Accepted; the alternative is breaking installations we do not control. **This
rule is not yet in force** — the project is in alpha with an explicit
no-backcompat policy and one external operator. It binds from 1.0.

*Precedent, learned the hard way*: desktop's WebSocket enum swallowed four hub
events for months behind a silent catch-all arm — a version-skew failure that
produced no symptom at all. See
[Unknown WebSocket events must be loud](#unknown-websocket-events-must-be-loud);
that logging arm is the first piece of skew handling in the codebase.

## One mechanism moves the data: logical dump/restore

**Decision** (2026-08-08): every operation that moves a hub's data uses the
same logical `pg_dump` → restore path. Three things that looked like separate
features are one piece of code:

- **Backup.** `wavvon-hub backup` today writes `hub_identity.json` and nothing
  else, while telling operators to run `pg_dump` separately — which they will
  not be able to do at all once PostgreSQL is bundled and the binaries live in
  our install directory. It dumps the database, using whichever binaries the
  hub is actually using.
- **Embedded ↔ external moves.** An operator adopting their own PostgreSQL, or
  giving one up, gets `wavvon-hub db move --to/--from <url>` rather than a
  documented `pg_dump` incantation.
- **Embedded major upgrades.** Dump with the retained old binaries, `initdb`
  the new major, restore. This replaces `pg_upgrade` in the bundling entry
  above.

**Direction is constrained by version, not by which side is "ours".** A dump
restores into an equal or newer major and *not* into an older one — a newer
server's dump may contain syntax an older one cannot parse. The rule is
therefore `target_major >= source_major`, checked before anything is written,
and this cuts against intuition once bundled PostgreSQL follows upstream: the
embedded instance will usually be the *newer* side, so "move my data to my own
PostgreSQL" is the direction likely to be refused, because distributions ship
older majors.

**Migration copies; it does not switch modes.** `db move` writes the data and
stops. The operator then sets or unsets `WAVVON_DATABASE_URL` and restarts.
The source is left intact, so a destination that misbehaves is undone by
changing one variable back.

*Alternatives considered*: (a) migrate automatically when
`WAVVON_DATABASE_URL` appears — rejected, and this was the original proposal:
setting that variable means "point at this database", not "copy my data into
it". An operator restoring from backup or aiming at a replica would have data
written over something they did not nominate, at startup, with no
confirmation. What is right about the idea is that the operator should not
need to know `pg_dump` — hence a one-line command that does everything, not an
implicit trigger; (b) `pg_upgrade` for the embedded major upgrade — rejected:
faster on large databases and the standard tool, but it is a third code path
with its own build-option sensitivities, for data volumes a community hub does
not reach. One well-tested path beats two. Revisit if someone arrives with a
database large enough to care; (c) physical file copy — rejected: only valid
between identical majors, which is the case that needs no help.

*Tradeoff*: dump/restore is O(data) where `pg_upgrade --link` is nearly O(1),
so a very large hub sees real downtime on a major upgrade. Accepted for now;
the guard rails matter more than the speed. Every path refuses rather than
half-writes: destination must be empty, version must be compatible, the dump
file is kept and its location printed, and row counts are compared afterwards.

## The hub bundles PostgreSQL, and never touches one it did not create

**Decision** (2026-08-08): the hub binary ships PostgreSQL inside it
(`postgresql_embedded`, `bundled` feature — the archive is embedded at
compile time, not fetched at runtime). Mode is chosen by the absence of
configuration:

- **`WAVVON_DATABASE_URL` unset** → the hub installs, initialises, starts and
  supervises its own PostgreSQL. Zero prerequisites: download a binary, run
  it, you have a hub.
- **`WAVVON_DATABASE_URL` set** → the hub is a plain client. It runs schema
  migrations and nothing else. It does not upgrade, tune, restart or in any
  way manage a database it did not create.

This restores the operator experience the founding "SQLite, not Postgres"
decision valued — and gave up on 2026-06-27 — without a second dialect, a
second migration set, or the type-decoding hazards that made dual-backend
dangerous ([PostgreSQL is the only storage backend](#postgresql-is-the-only-storage-backend)).

**Bundled PostgreSQL follows upstream; it is not pinned.** Major versions
carry security and performance work and standing still to avoid an upgrade
path is the wrong trade. What made pinning tempting is real but narrow: SQL
does not change between majors, the *on-disk data directory format* does, and
a newer server refuses to start on an older data directory by design.

The constraint that dictates the layout: reading an old data directory at all
requires that major's own binaries, so the install directory is version-scoped
and the previous version is not deleted:

```
<data_root>/pg/18.4.0/   binaries (kept — needed to read the old data)
<data_root>/pg/19.1.0/   binaries (new)
<data_root>/pgdata/      data, carrying its own PG_VERSION
```

On startup the hub compares `PG_VERSION` against what it bundles and either
starts, migrates, or **refuses with instructions** when it cannot do so
safely. It never half-migrates and never guesses.

> **Amended 2026-08-08**: the migration step was originally specified as
> `pg_upgrade`. It is now the logical dump/restore described in
> [One mechanism moves the data](#one-mechanism-moves-the-data-logical-dumprestore)
> — same retained-binaries requirement, but one code path shared with backup
> and with embedded↔external moves instead of a third bespoke one.

**External PostgreSQL gets a declared minimum, per Wavvon version.** Not a
pin, not a supported-combinations matrix: one floor, checked at startup with a
clear message, documented in a table in `hosting.md`. The floor starts at
**PostgreSQL 14** — the oldest release still receiving upstream security
patches as of 2026-08 — and rises only when a feature genuinely requires it,
never on a schedule. The code's actual floor today is PG 12, set by a single
`tsvector GENERATED ALWAYS AS (...) STORED` column in `migrations.rs`, and
nothing checks it: an operator on an older server currently gets a syntax
error from a half-applied migration instead of a sentence telling them why.

*Alternatives considered*: (a) pin the bundled major indefinitely — rejected:
trades away security updates to avoid work that is routine once the
both-binaries constraint is designed for; (b) auto dump/restore on every major
change without keeping old binaries — rejected: it cannot read the old data
directory at all, which is the whole problem; (c) require an external
PostgreSQL always (status quo) — rejected: it is the single largest adoption
tax on a self-hosted product competing with unzip-and-run incumbents; (d)
manage the operator's external database too — rejected: we have no title to
it, usually no permission, and on managed providers no filesystem access.

*Tradeoff*: ~25 MB added to each release binary, plus one superseded
PostgreSQL install left on disk after an upgrade. The SQL Wavvon writes is
also now bounded by the **oldest supported external** version, not by the
bundled one — bundling PG 19 does not license PG 19 syntax while PG 14 is
still supported. That is ongoing discipline, not a one-time decision.

*Not restored*: SQLite's "backup is one file". Operators still use `pg_dump`.

## PostgreSQL is the only storage backend

**Decision** (2026-08-08, ratifying what happened on 2026-06-27): Wavvon
targets PostgreSQL and nothing else. No SQLite, no second engine, no
runtime-selectable backend. Reopening this needs a new entry here, not a
comment somewhere.

This is written down because it never was. The archaeology: the founding
decision was the *opposite* — "SQLite, not Postgres", argued on zero-ops for
the operator, one-file backups, and single-tenant hubs, with an explicit
escape hatch ("if we later want multi-tenant hub farms, the storage layer can
change underneath"). The store-trait design that followed was about
*decoupling*, not about Postgres: its stated motivation is that every handler
ran raw SQL against `state.db` and errors were classified by sniffing
`"UNIQUE"` in a message string. That design listed `wavvon-store-postgres` as
a *"future community backend"*.

Then Postgres landed alongside SQLite on `AnyPool` (2026-06-07), and twenty
days later SQLite was deleted. The commit that did it is 24 lines of pure
mechanics with no rationale, and the only record in this file was a `Status:`
line appended to the store-trait entry. The won't-do entry added 2026-07-20
says why *it* was written: a stale note "kept resurfacing the idea", so the
door was closed — not because the merits were re-examined.

**The real reasons, reconstructed and now stated properly:**

- **Runtime-polymorphic dual backend was actively dangerous.** `AnyPool`'s
  bool decoding silently failed against SQLite's integer booleans, which made
  `COUNT(*) > 0` return false and **revocation and federated-ban checks pass
  unconditionally**. A security hole produced by the abstraction itself, found
  in `bfb1b93`. Two engines behind one pool means every type mismatch is a
  silent wrong answer rather than an error.
- **Full-text search had no shared query shape** — SQLite FTS5 vs Postgres
  `tsvector`; the design doc listed it as "Undecided". (This one has since
  dissolved on its own: Tantivy owns search now and the database is not
  involved.)
- **The farm is genuinely multi-tenant**, which is the exact case the founding
  decision named as grounds for changing storage.
- **109 test suites, CI service containers, and every migration** now assume
  Postgres. That is sunk, but it is real.

*Alternatives considered*: (a) keep SQLite for small self-hosters and Postgres
for farms — rejected: this is precisely the dual-backend that produced the
security bug, and the cost lands on every future query, not once; (b) an
ORM/abstraction layer (`sea-orm`, `diesel`, or a hand-rolled one) to hide the
difference — rejected: it does not remove the need for two sets of migrations,
which is the actual expense; (c) revert to SQLite-only — rejected: the farm
case stands and the migration cost is now paid.

*Tradeoff*: Wavvon loses SQLite's zero-ops install story, which the founding
decision valued and which is a genuine adoption cost for a self-hosted product
competing with unzip-and-run incumbents. **Bundling PostgreSQL into the hub
binary is the answer to that** — it restores the operator experience without
reintroducing a second dialect, a second migration set, or a second set of
type-decoding hazards. What it does not restore is "backup is one file";
operators still use `pg_dump`.

## Cross-process config keys live in a shared crate, not in string literals

**Decision** (2026-08-08): the name of any environment key that one Wavvon
process sets on another is a `pub const` in the tiny `wavvon-hub-env` crate,
which the hub, the farm and the agent all depend on. No process spells such a
name as a string literal.

The farm and the agent launch hub child processes and configure them purely
through `WAVVON_*` env vars. Both ends wrote those names as literals, and they
drifted: the launchers set `WAVVON_HUB_DB` and `WAVVON_HUB_HTTP_PORT`, names
the hub has never read. Nothing failed. A spawned hub ignored its carefully
allocated port and bound the default 3000, so the farm's reverse proxy routed
to a port nothing listened on and a second hub on the same box collided; and
with no database key reaching it, every farm-hosted hub fell back to the same
default database. The hub's `settings.rs` calls itself "single source of
truth for every `WAVVON_*` env var the hub reads" — accurately, which is
exactly why two other crates writing names it had never heard of went
unnoticed.

*Alternatives considered*: (a) have the farm and agent depend on
`wavvon-hub` for its constants — rejected: pulls axum, sqlx and tantivy into
a control-plane binary for a handful of strings, and inverts the dependency
so the spawner compiles the spawned; (b) put the names in `wavvon-identity`
— rejected, that crate is the wire-format authority and deliberately has no
I/O or process concerns; (c) leave the literals and add a test asserting they
match — rejected: it guards duplication rather than removing it, and the test
still needs the same shared dependency to compare against.

*Tradeoff*: a new crate for ~40 lines of constants. Worth it because the
alternative failure is silent — this class of bug produces a working-looking
system, not an error.

**A shared symbol is not enough on its own.** The first guard written here
asserted that every key in `SPAWNABLE` appears in the hub's `ENV_VAR_HELP`
table, and it passed even after the constant was changed back to
`WAVVON_HUB_HTTP_PORT` — both sides read the same symbol, so the assertion
was tautological. The guard that works is behavioural: set each key, call
`settings::load()`, assert the value arrives. That one fails with
"`WAVVON_HUB_HTTP_PORT` is not read".

## List pagination: one cursor dialect, array responses, no envelope

**Decision** (2026-08-08): every paginated hub list uses the shape
`GET /messages` already had — a bare JSON array plus `limit` and a
**keyset cursor** naming the last row the caller holds. No `{items,
total, page}` envelope, no offset paging, no second dialect for
"table-like" lists.

This supersedes the plan recorded in ROADMAP on 2026-08-07, which called
for two shapes: cursor for feeds, `page`/`limit`/`total` for admin
tables, the latter said to mirror `GET /farm/users`. Two facts killed it
on contact with the code. First, `GET /farm/users` is not `page`-based —
it is `cursor`/`limit` with a `total`, so "mirror the farm console"
already meant cursor. Second, the endpoint that motivated the split,
`GET /users`, is not table-like *or* feed-like: the member sidebar wants
the whole roster and the admin Users table wants a page, and both are
served fine by a large default (200) with a cursor for the rare hub that
exceeds it. Inventing a second dialect to serve one endpoint that did not
need it was the whole cost of the plan.

*Alternatives considered*: (a) the two-shape plan — rejected above;
(b) an envelope carrying `total`, so a client can render "342 members" —
rejected for now: nothing in either client displays a server-side total
today, `total` costs a second `COUNT(*)` per request, and adding it later
is additive whereas removing it is not; (c) offset paging — rejected, it
skips and repeats rows when the underlying list mutates mid-scroll, which
a member roster does constantly.

*Tradeoff*: the keyset on `/users` orders by `COALESCE(display_name,'')`
rather than raw `display_name`, so members with no display name sort
first instead of last. Row-value comparison against a NULL yields NULL,
which would drop those rows from every page — correctness of the walk
beats the cosmetic ordering of a rare case.

*Outcome*: `/users`, `/conversations/{id}/messages` and `/admin/reports`
converted; the remaining unbounded lists are inventoried in ROADMAP and
convert to the same shape when someone actually hits one.

**Corollary — a paginated endpoint needs a client that pages.** The first
cut of this raised `/users` from 50 rows to a 200 default and stopped
there, which would have left a hub of 250 members truncating its sidebar
silently: the identical bug, relocated. Anything whose consumer wants the
whole collection (member roster, channel list) walks pages to exhaustion
on the client; the cursor exists so that walk is correct, not so the cap
can be a bigger number. Both walks are bounded (40 pages) purely as a
backstop against a server that stops advancing the cursor.

## Duplicate endpoints are folded, not versioned side by side

**Decision** (2026-08-08): when two route families write the same table,
one wins and the other is deleted outright — no `_v2` suffix left
standing beside a `v1`, no deprecation window. Alpha rules
([project alpha state](../ROADMAP.md)) make this cheap; keeping both is
what is expensive.

The concrete case: `/moderation/channels/{id}/bans` and
`/channels/{id}/bans` both wrote `channel_bans`, but with different
permission gates (`MUTE_MEMBERS` vs `BAN_MEMBERS`), different field names
(`target_public_key` vs `pubkey`), and — the actual damage — the second
hardcoded `reason = NULL` on insert. Desktop used the first, web the
second. So a moderator's written ban reason survived exactly until
someone re-banned that user from the other client, at which point it was
silently erased. Two doors to one table is not redundancy, it is two
half-specified behaviours that disagree, and the disagreement is invisible
until it costs data.

*Alternatives considered*: (a) keep both, make v2 write `reason` too —
rejected: fixes this instance and leaves the shape that produced it,
including the permission-gate split, where a `MUTE_MEMBERS` holder can
place a channel ban a `BAN_MEMBERS` holder is required for; (b) keep both
and make v1 a thin forward to v2 — rejected: same surface area to
maintain, plus indirection, for a route no client would use.

*Outcome*: `/channels/{id}/bans` is the only channel-ban API, gates on
`BAN_MEMBERS`, and round-trips `reason` (pinned by a test). Desktop was
repointed. `GET /channels/{id}/members` — which ignored its `channel_id`
and returned the `/users` rows — went the same way.

## Unknown WebSocket events must be loud

**Decision** (2026-08-08): a client's catch-all arm for unmodelled server
events logs the event type. It is never a bare no-op.

Desktop's `WsServerMessage` enum ended in `#[serde(other)] Other`, matched
as `Other => {}`. That single empty block is why four separate features —
live hub branding, live channel list, live member profiles, and soundboard
attribution chips — were shipped on web and quietly absent on desktop.
Each was individually small; what made them a *class* of bug is that the
absence produced no symptom a developer would see. Desktop even POSTed the
soundboard `played` event, causing chips on everyone else's screen while
showing none of its own.

*Alternatives considered*: (a) removing the catch-all so unknown events
fail to deserialize — rejected: a hub newer than the client is a normal
federated state, and hard-failing the WS loop over an event the client
does not care about is worse than ignoring it; (b) a doc note listing
which events each client handles — rejected: that is a table that goes
stale exactly as silently as the code did.

*Outcome*: the fallthrough logs `unhandled hub event type "..."`. The four
backed-up handlers were added at the same time, but the log line is the
fix — it converts a silent divergence into something the next hub feature
surfaces on first run.

## Member name colors: hub-chosen priority between role color and profile color, resolved server-side

**Decision** (2026-08-07, iterated with the user from "Discord role
colors vs. free profile colors" to "both, owner decides"): nicknames in
the message stream and member list are colored from two sources — the
role's existing `color` and a new per-hub profile field
`users.name_color` (nullable, beside `accent_color`, editable via the
existing PATCH `/me`) — with a hub-wide `hub_settings` key
`name_color_mode` choosing the policy: `user_over_role`,
`role_over_user` (default), `role_only`, `user_only`, `none`. All five
ship in alpha (values are additive/deletable strings). Resolution is a
null-cascade (`role_over_user` = roleColor ?? userColor ?? neutral,
etc.; roleColor = highest-priority colored role) computed **server-side
once**, delivered as a single resolved `name_color` field in the roster
and profile payloads — clients do no priority logic and the mode never
needs public exposure. Rendering reuses the `safeRoleColor` +
`color-mix`-toward-theme-text pipeline, so untrusted-hub colors stay
sanitized and readable in both themes.

*Alternatives considered*: (a) role colors only (Discord model) —
rejected: the owner setting moves the impersonation/legibility tradeoff
to the right decision-maker (the hub owner) instead of the platform;
(b) a separate per-role badge color vs. name color — rejected: one
color per role is the role's visual identity, and the existing
color-mix blends already differentiate badge vs. name rendering;
(c) client-side resolution — rejected: needs the mode + both raw colors
exposed publicly and the cascade duplicated per client.

**Decision** (2026-08-06, user chose "final version directly, no two
versions"): voice moves to a single WebTransport (QUIC) transport with
per-packet E2E AEAD for both clients — spec in
[voice-transport-v2.md](voice-transport-v2.md). The raw-UDP relay
(desktop) and the WS Opus relay (web) are deleted, not kept as
fallbacks (alpha, no backcompat). Key choices: reuse the shipped
voice_join token as the WT CONNECT credential; reuse the never-wired
`voice_key_offer/received/request` signaling as the E2E key channel;
AES-256-GCM with `salt[4]||ctr[8]` nonces (the old `seq:u16` wrapped
in ~22 min); rotating self-signed ECDSA cert + `serverCertificateHashes`
so hubs need no CA cert for voice. Folds in two latent bugs: the
desktop `:3001` hardcode (ignores `voice_udp_addr`) and the farm spawn
never passing a per-hub voice port.

*Alternatives considered*: (a) AEAD over the existing raw UDP + keep
the WS relay (the original Phase 2 plan) — rejected: two transports to
encrypt and maintain, and web voice stays TCP-degraded; (b) WebRTC —
rejected: screen-share v2 carries it for P2P video, but voice is
hub-relayed by design and WebTransport needs no SDP/ICE machinery;
(c) farm-level voice proxying — rejected again: extra hop and
bandwidth funnel, voice stays direct-to-node.

## AFK channel rides the voice-move primitive; idle = server-observed silence

**Decision** (2026-08-04, user asked for Discord/TeamSpeak-style AFK
auto-move): the AFK sweep ([afk-channel.md](afk-channel.md)) is a thin
30s worker over machinery that already existed — it pushes the same
`voice_move` control message the events staging tool uses (events.md
§7.1, client obeys with leave-and-join; `auto: true` since an AFK user
can't answer a prompt), and defines idle as "no `voice_speaking`
message seen", stamped in a new in-memory `voice_last_active` map. Two
new `hub_settings` keys, zero new wire messages, zero client push
handling — clients only gained the admin UI.

*Alternatives considered*: (a) TeamSpeak-style client-reported OS idle
time — rejected: new wire messages on every client plus trusting the
client, for marginal accuracy; (b) a dedicated server-side yank
(forcibly rebinding the relay) — rejected: the voice-move contract is
deliberately client-driven everywhere else, and a second move mechanism
would fork that.

## App.tsx hook split + shared orchestration hooks in packages/ui

**Decision** (2026-07-28, user asked to shrink both App.tsx files and
reduce web/desktop duplication): both orchestrators were split into
hooks with mirrored names (web gained desktop's `useVoice`/`useVideo`/
`useWsHandlers` split plus `useAddHubFlow`/`useChannelCrud`; desktop
gained `useAddHubFlow`/`useChannelCrud`/`useFarmAdmin`). Logic that was
a verbatim copy in both apps moved to a new `packages/ui/src/hooks/`
home as prop-injected hooks (`useVoiceMoveUx`, `usePresenceStatus`,
`useHubSetupWizardGate`) — same injection discipline as the prop-only
component rule. Web App.tsx went 3485 → 2383 lines, desktop 2975 → 2730
(while gaining features, below). Clients commit `5db0f31`.

*Alternative considered*: also unifying the same-named per-app hooks
(`useDms`, `useScreenShare`, `useHubAdmin`, `useUnreadCounts`, …) —
rejected: they have genuinely platform-bound bodies (desktop persists
unread state to disk and drives the tray icon, native capture, local DM
ratchet store); one shared hook would need a mega-injection surface
that costs more than the duplication. Only verbatim-identical
orchestration was hoisted. `useTypingIndicators` is a borderline future
candidate (same logic, different dep plumbing).

**Pass 2** (2026-07-29, same session — user wanted the files smaller
still): web landed at 1868 lines (useChannelMessages, useHubLifecycle,
useAppKeybinds, static admin action objects hoisted to module scope,
HubAdminContainer), desktop at 2274 (same treatment + its own
useHubLifecycle; the ~400-line remaining difference is genuine desktop
platform surface: Tauri listeners, native windows, screen-share
overlay). Clients commit `1b567c8`. What remains in both files is prop
threading through prop-only shared components — the floor of this
architecture. Going lower means revisiting prop-only (context slices /
a store), which is a separate design decision, deliberately NOT taken
here.

**ChannelContextMenu union** (same session, follows the 2026-07-20
union rule): one shared prop-only `ChannelContextMenu` in packages/ui
replaced web's inline menu and desktop's local component. Entries
render iff their callback prop is wired; structural gating (category /
channel type) lives in the component, permission gating in the app.
Desktop gained copy-link, create event, create poll (shared composers
over its existing `create_event_hub`/`create_poll` commands), temp-room
owner rename, and root-level create channel/category; web gained
notify-mode entries on categories (modes inherit down the tree).
Desktop's plain "Rename" now opens the full shared ChannelSettingsModal
(superset), and desktop now clears the voice-move name hint on voice
leave (pre-existing quirk vs web, fixed while touching the same code).

## Whisper round 2: inbox, per-list keybinds, hub-enforced receive opt-out

**Decision** (2026-07-26, user request after trying whisper on web):
three additions, web-first ([whisper.md](whisper.md) has the details):

- **Whisper inbox** — inbound whispers land in a fixed overlay that
  persists until dismissed (live "is whispering" → "whispered you" +
  time). *Alternative considered*: transient toast — rejected, the whole
  point is catching a whisper you missed while alt-tabbed. Session-only
  state, no persistence.
- **Per-list keybinds with Hold/Toggle mode** — the dormant
  `WhisperList.keybind` field is now real; a `keybindMode` field picks
  PTT-style hold or toggle per list. In-app keys on web (same limitation
  as web PTT). *Alternative considered*: one global whisper key +
  separate mode setting — rejected, a raid commander wants different
  keys for different target lists, and per-list needed less UI surface.
- **Receive opt-out is enforced on the hub, not the client** — new
  `voice_whisper_optout { enabled }` WS message; opted-out pubkeys are
  excluded from all target resolution (incl. live re-resolution), so
  they get neither audio nor the started/stopped signals. *Alternative
  considered*: client-side ignore (drop 0x01 frames locally) — rejected:
  the hub would still waste bandwidth fanning out to them, the whisperer
  would see a lying "delivered" target count, and a bystander refusing
  whispers shouldn't even be observable as a target. Ephemeral hub
  state; the client persists the pref per account and re-sends on every
  reconnect (same posture as other per-session voice state).

Tradeoff: whisper UX now diverges from desktop (gaps recorded in
[client-parity.md](client-parity.md)); acceptable since web is the
delivery target.

## Hub setup wizard: client-side channel templates after ownership

**Decision** (2026-07-25, user feedback from first-run walkthrough): a
fresh hub owner gets a **"How do you want to use this hub?"** wizard the
first time they land in a hub they own that has **no channels** —
template cards (Gaming, Community, Clan, Reading, plus Blank) that
pre-create a channel structure (categories, text, voice, forum) through
the ordinary channel-creation API. Without it the first owner faces an
empty sidebar and members "never know where the channels are."

- **Client-side only.** Templates are hardcoded data in `packages/ui`;
  the wizard is just a loop of existing create-channel calls made with
  the owner's own session. *Alternative considered*: server-side
  bootstrap templates (the hub-creation-wizard.md §1 catalog, hub
  redeems a template at first boot). Rejected for now — that path
  needs the discovery catalog + bootstrap-token plumbing, while the
  client loop ships today and produces the identical end state. The
  server catalog remains the plan for farm/discovery-driven creation;
  this wizard can consume it later without UX change.
- **Trigger = owner + zero channels on entering the hub**, not "just
  redeemed an owner invite" — this also covers WAVVON_OWNER_PUBKEY
  bootstrap and hubs wiped after creation. Dismissing the wizard
  (Blank) marks it done locally; it never re-nags.
- Related same-round UX decision: **invite links are shared in the
  plain `http(s)://host/join/<code>` form everywhere** (client
  `buildInviteLink` + hub first-boot log). The
  `wavvon://host/i/<serial>/<code>` deep link stays parse-accepted but
  is no longer what users copy — it was "quite long and terrible to
  use". The serial-carrying form returns when farm-hosted hubs need
  serial routing in links.

## Hub timezone + birthday badge: plain profile field, viewer-local day, triple opt-in

## Hub timezone + birthday badge: plain profile field, viewer-local day, triple opt-in

**Decision** (2026-07-21, user idea + calls): two small, decoupled
social features.

1. **Hub timezone** is a `hub_settings` key (`hub_timezone`, IANA name)
   set by admins; clients render an ambient hub-local clock with
   `Intl.DateTimeFormat` (no deps, no server time math yet). It is
   **flavor and a reference point for hub-wide daily features only** —
   message and event timestamps stay rendered in the *viewer's* local
   time. *Alternative considered*: rendering timestamps in hub time —
   rejected, instants must read correctly for every viewer.
2. **Birthday** is a plain nullable `users.birthday` column (`MM-DD`,
   **never a year** — no age PII), riding the existing profile-field
   rails over HTTP. Explicitly NOT a signed envelope / wire-format
   change and NOT federated: shared per hub, deleted per hub.
3. **The badge shows on the viewer's local calendar day** (client-side
   MM-DD comparison). *Alternatives*: hub-timezone day (needs the hub
   setting, confusing when the viewer's calendar disagrees) and
   birthday-owner's timezone (requires sharing a timezone — more PII).
   A birthday is a floating calendar date, not an instant; viewer-local
   matches how humans treat it (and how Facebook renders it).
4. **Triple opt-in, each enforced at its own layer**: user shares
   (setting the field IS the consent; null by default), hub serves it
   (`birthdays_enabled` setting; off = field never leaves the server),
   viewer renders it (`hideBirthdays` in the synced prefs blob). Any
   single "no" wins without coordination.
5. **Badge first; announcement message deferred.** The worker-posted
   "happy birthday" message needs a channel picker, a daily worker,
   hub-midnight math, and chrono-tz — and cannot be un-delivered per
   grumpy viewer. Demand-gated tail.

**Outcome**: shipped same day — server `cb7e79c` (settings + `MM-DD`
field + gated payloads, 9 flow tests), clients `66deab5` (HubClock,
admin controls, profile selects, badge, viewer opt-out). One
integration catch: the badge reads the member *roster* payload, which
the first server pass didn't serve — caught in cross-half review, fixed
before merge. The `hideBirthdays` pref rides device-local storage for
now; the synced-prefs-blob push path doesn't exist yet on either client
(pre-existing gap, noted in client-parity.md).

## Recovery attestation: out-of-band id, K=2 default, 14-day expiry, new-key proof

**Decision** (2026-07-20, user calls; design in
[recovery-attestation.md](recovery-attestation.md)): the four open points
of the attestation design, all resolved to the architect's
recommendations. Contacts learn of a rotation request via an
**out-of-band request id** (the hub never pushes vouch requests — no spam
surface); threshold **defaults to K=2 with K=1 allowed** (admin review is
the backstop); pending requests **expire after 14 days**; and opening a
rotation request **requires a signature by the new key** (proves the
requester holds it). Context: the audit behind the design found the hub
was counting attestation signatures **without verifying them** — the
signed `recovery-attestation/v1` envelope + hub-side Ed25519 verification
is the substance of the fix.

**Outcome**: shipped same day — server `4240377` (envelope + verified
attest flow + expiry, 15/15 flow tests), clients `cf6b39d` (TS + desktop
Rust mirrors byte-identical to the vectors, unioned
RecoveryContactsSection with requester/contact UI). One deviation: the
new-key proof carries no nonce (the hub mints it after the request
opens); distinct wire tags keep proof and attestation
non-interchangeable.

## Settings IA unification: desktop adopts multi-account; one cross-platform backup file; one Notifications tab

**Decision** (2026-07-20, user calls; design in
[settings-ia.md](settings-ia.md)): three calls that unblock the last
Settings parity passes.

1. **Desktop adopts web's multi-account model** ("multi-account yes! We
   need that!"). `~/.wavvon/` restructures to per-account identity files +
   an accounts registry; switcher + guarded in-place remount mirror web's
   2026-07-11/12 multi-account decisions; account list stays device-local.
   *Alternative considered* (architect recommendation): stay
   single-identity with a degraded one-account rendering, since web is the
   current delivery target. Rejected — multi-account is wanted on every
   client, and adopting now avoids a permanent single-account conditional
   the web code never exercises.
2. **Backup: phrase-first UI + ONE cross-platform file format.** The user
   rejected per-platform files outright ("the backup should be usable on
   both web or desktop or any other kind of device"). The shared UI leads
   with the 24-word phrase as the canonical backup; the encrypted file is
   secondary but is **one format both clients read and write**: Argon2id
   KDF (web via `@noble/hashes`, desktop via the existing `argon2` crate),
   single JSON envelope, `.wavvon-backup` extension, **one account per
   file** (user call, same day: the user picks which account to export;
   import restores exactly that account — supersedes a multi-account-array
   plaintext considered first). Desktop's earlier format, with an
   incompatible envelope, is retired; alpha rules — no importer for old
   files.
3. **One Notifications tab on both clients** (mention ping + notify
   sound; desktop's notify-sound moves out of Voice). Per-hub notify
   *mode* stays in the sidebar. The signed-public-profile vs
   favorite-hubs fork stays **deferred** per the 2026-07-19 decision; the
   unified Profile tab renders the web surface and desktop's
   signed-publish control drops from Settings for now.

**Outcome**: shipped 2026-07-20 (clients `2cae216`) — desktop
multi-account storage + switcher, the cross-platform `.wavvon-backup`
format (shared test vector asserted byte-identical in TS and Rust), and
the shared `SettingsShell` (8 tabs / 3 groups on both clients).
Documented cuts in settings-ia.md §7.

## Cross-allied-hub favorite-hubs: defer; reuse the existing envelope, don't mint a new one

**Decision** (2026-07-19): **defer** cross-allied-hub visibility of a
member's favorite hubs. When it is picked up, it reuses the **already-shipped**
`wavvon/public-hub-profile/v1` envelope — no new wire format.

**The premise was stale.** The known issue and the 2026-07-12 Hubs-tab entry
below both say federation "needs a signed public-profile envelope that doesn't
exist yet." It exists: `PublicHubProfile` in `server/crates/identity/src/wire.rs`
(pubkey + `public_hubs[{hub_url, hub_name, joined_at}]` + issued_at, signed by
the identity master key), with a test-vector layout in
[wire-format.md](wire-format.md), stored/verified on the hub in
`public_hub_profiles` (`hub/src/routes/profile.rs`, `GET`/`PUT /profile/{pubkey}`),
and consumed end-to-end by the desktop context menu ("Their hubs",
`fetch_public_profile`). What never happened is reconciliation: the web-shipped
Hubs tab uses a *different, unsigned* per-hub `favorite_hubs` column
(`GET /users/:pubkey/profile`), and nothing fetches either one across an
alliance. So this is two parallel systems, not a missing primitive.

**Why defer anyway**: alpha, no users asking, and the current delivery target
is web-only ([project_delivery_target]) — while the one place the signed
envelope is already wired (desktop) is future. The remaining work is real
cross-repo plumbing (reconcile the two systems, alliance-fetch path, web
render) for a cosmetic feature. The wire-format cost that originally justified
deferring is already paid, but the integration cost isn't worth it now.

**Decided path for when it returns** (so nobody mints `wavvon/favorite-hubs/v1`):
publish the Hubs-tab `favorite_hubs` list *as* a `PublicHubProfile` on change,
only when `show_hubs` is true (publication is the privacy gate — a hidden list
is simply never signed/served, so the gate holds cross-hub with no server-side
enforcement on the reader). Staleness: re-sign on change, keyed by `issued_at`,
newest wins; **no TTL** (consistent with "TTL on the profile is wrong" below).
An allied hub renders a member's favorites by fetching the owning hub's
`GET /profile/{pubkey}` and calling `verify()` — same read-through-proxy shape
as forum federation ([forum.md §9](forum.md)), no new trust infrastructure.

**Alternatives**: mint a new `favorite_hubs` envelope (rejected — the existing
one already carries a signed hub list; ladder says reuse); embed favorites in
the per-hub profile and have allied hubs trust the serving hub's copy (rejected
— unsigned, and it would put personal-axis data on a community hub as
authoritative). Two soft spots to fix on pickup, noted in
[federation.md](federation.md): `display_name`/`avatar` are in the struct but
**not** in the signing bytes (unauthenticated today), and the envelope has no
`icon` field that the Hubs tab's `{url,name,icon}` shape carries.

## Game-bot distribution (gaming Phase 4): reuse invite + discovery, no bot index

**Decision** (2026-07-19): game-bot distribution needs **almost no new
machinery**. A game-bot is structurally just a bot, so *adding* one is the
shipped invite-by-pubkey flow ([bots.md §2](bots.md)) plus the Phase 1
`can_use_interactive_ui` grant — no game-specific step. *Discovering* one
reuses the two shipped opt-in surfaces unchanged: the per-hub bot directory
([bots.md §4](bots.md)) within a hub, and Wavvon-discovery's signed,
pubkey-keyed *hub* listings across hubs ([hub-discovery.md](hub-discovery.md)).
The directory indexes hubs, never bots, so no global bot index appears. Full
design: [bot-capability-layer.md §11](bot-capability-layer.md).

**Alternatives considered**:
- **A global/central game-bot directory** (a browseable index of bots you
  could invite). Rejected outright, not deferred — same ground the central
  hub registry was rejected on ([bots.md Tradeoffs](bots.md)): it needs a
  coordinator Wavvon refuses to be, and is a ROADMAP won't-do.
- **Cross-hub game-bot recommendation over alliances** (an ally surfacing
  its bot list as suggestions). Deferred, not rejected: it reuses federation
  and stays decentralized, so it *would* be design-appropriate — but it
  invents a hub-to-hub bot-list read path with its own trust/staleness cost
  for a benefit no operator has asked for. Revisit on demand.

**Tradeoff**: discovery is coarse — a user finds a *hub* that runs a
game-bot (via a `games` tag on its listing) and tries it there, rather than
browsing bots directly. Accepted: it keeps the federated-not-centralized
boundary clean and adds zero new indexed surface.

**Outcome**: designed 2026-07-19, not built. The only buildable-now slice is
a per-hub directory render tweak — a **Play** affordance on a bot's card
from the Phase 1 `game` descriptor — and it is gated on Phase 1 landing
first. Everything else is deferred-until-demand.

## Multiplayer lobby (gaming Phase 3): a bot-side convention, not hub surface

**Decision** (2026-07-19): the multiplayer session/lobby helper is a
**message convention plus a reusable bot-side Rust module (`wavvon-bot-kit`)
layered over the shipped `mini_app_message` relay** — not new hub surface.
The hub gains no roster, lobby, matchmaking, game state, or game registry;
it stays a content-opaque relay (bot-capability-layer.md decision 4). Join
discovery, roster, and turn/tick sync live in the bot; the mini-app renders
`roster`/`state` and sends `hello`/`bye`/`ping`. Full design:
[bot-capability-layer.md §10](bot-capability-layer.md).

**Alternatives considered**:
- **A hub-side lobby/matchmaking service** (roster query, session registry,
  matchmaking API). Rejected: it is the removed games-platform spec
  (gaming.md history, descoped 2026-06-26) re-entering through a side door,
  and makes the hub the bottleneck for every new game — the exact thing the
  bot-relay bet exists to avoid.
- **A hub `mini_app_session_closed` lifecycle event now**, so the bot sees a
  player close the modal (the one thing the relay can't express today —
  `bot_app_dismiss` is bot→all, and the disconnect path at
  `connection.rs:619-627` never notifies the bot). Deferred, not rejected:
  it is generic session-lifecycle, not game-aware, so it *would* be
  hub-appropriate — but a `bye`-on-unload + `ping` heartbeat convention
  covers leave detection with zero hub work. Build the event only if the
  ~30s heartbeat lag proves too slow.

**Tradeoff**: leave detection is best-effort/heartbeat-latent (up to ~30s to
notice a silent drop) instead of instant, in exchange for shipping Phase 3
with no hub changes at all. Join discovery is already a convention because
`bot_sessions` tracks the bot's own sessions, not a player roster.

**Outcome**: designed 2026-07-19, not built. First buildable slice is
bot-side only (generalize `ttt-bot`'s session map into `wavvon-bot-kit`);
the sole potential hub change (`mini_app_session_closed`) is deferred behind
the heartbeat convention.

## Game icons in Activities: curated emoji row, no game catalog

**Decision** (2026-07-19): "attach game icons to Activities entries"
ships as a **curated game-emoji row** in the profile editor's activities
field — one click inserts the emoji at the start of the cursor's line.
Entries stay what they already are (lines of the free-text `activities`
field); emoji live in the text itself.

**Alternatives considered**:
- **Real per-game artwork** (icon picker backed by a game list). Rejected:
  requires a game catalog, which is either a central authority (won't-do)
  or the undesigned gaming/bot distribution layer (bot-capability-layer.md
  Phase 4). Revisit as part of that layer, with bot-declared games.
- **Token syntax** (`[icon:controller]` swapped to bundled SVGs at render).
  Rejected: invents a private markup for marginal visual gain; breaks
  copy-paste and every non-web surface until each implements the renderer.

**Tradeoff**: emoji are generic (a controller, not *the* game's logo), but
they need zero schema/server/renderer changes and degrade nowhere.

**Outcome**: web shipped 2026-07-19.

## Events calendar: month grid over the already-fetched upcoming window, no date library

**Decision** (2026-07-19): the events calendar view is a **Month / List
toggle inside `EventsPanel`** (Wavvon-clients, `apps/web`) that renders the
**same** hub-scoped, already-read-gated event set the list fetches, on a
native-`Date` 6×7 grid — no calendar library, no new dependency, and for v1
**no server change**. A new prop-only `EventCalendar` + a pure
`utils/calendar.ts` are hoistable to `packages/ui` as-is. Full design:
[events.md](events.md) §9.

**Alternatives considered**:
- **A calendar library (a full month/week/agenda component).** Rejected:
  the month-grid math is ~20 lines of `Date`, the components must stay
  prop-only and ~200 lines to hoist into `packages/ui`, and a new dependency
  contradicts the lazy/minimal rule for the lowest-priority events slice.
- **Add a `from`/`to` date-range query to `list_events` first**, so the grid
  can browse any month. Deferred, not rejected: it's the right eventual
  shape (additive `ListEventsParams` fields + a `starts_at BETWEEN` branch)
  but isn't needed to ship the common case (upcoming events on a month
  grid), and building server surface for browsing nobody has asked for yet
  is speculative.

**Tradeoff / outcome**: v1's grid is meaningful only within the loaded
upcoming window (now → the 100th future event); past-month and
beyond-window browsing render empty and wait on the deferred range query.
Accepted as the lazy first cut for the lowest-priority events feature —
community-axis (hub-scoped), client-only, reuses the one read-gated
`GET /events` call the list already makes.

## Hub-hosted identity vault: opt-in, passphrase-locked, handle-addressed

> **SUPERSEDED 2026-09-05** — the vault is rejected outright, and the pilot
> trigger below is withdrawn. See the entry at the top of this file, "A hub
> may hold what you sign or encrypt, never what can reconstitute you". Kept
> for what it weighed and how.

> **PARKED 2026-07-19 (user call, same day as the design)**: not built,
> not scheduled. Revisit **after the first external pilot** — real
> users will show how identities actually get lost, which is the
> evidence that decides whether hub-held encrypted seed material is
> worth its trade-off. The design below stays as the considered option.

**Decision** (2026-07-19): design an **opt-in** recovery tier that stores the
user's passphrase-encrypted master seed — the same `.wavvon-backup`
envelope family — on their **home hub(s)** as personal-axis state,
retrievable and decryptable on a fresh device that holds **no key
material**. The device fetches by a **handle-derived locator**
(`locator = HKDF(PBKDF2(passphrase, salt=f(handle)))`) computed entirely
client-side, so the hub learns neither the handle nor the passphrase; the
same single KDF pass also yields the AES key (domain-separated by HKDF
label). Design: [identity-vault.md](identity-vault.md).

**Trust model, stated honestly**: this is **strictly weaker** than the
recovery phrase or the local backup file, because the ciphertext lives on a
hub instead of in the user's sole custody. A hub operator (or a DB dump) can
mount an **offline dictionary attack against the passphrase forever** — the
KDF is the only wall, and server-side rate-limiting does nothing against the
party that already holds the DB. We accept this and bound it: memory-hard
KDF path (PBKDF2-100k now, Argon2id as vault-`v2`), a stronger passphrase
warning at creation than the file flow uses, a 256-bit locator plus a PoW
gate so the endpoint is never a *cheaper* passphrase oracle than local
cracking, and key-authorized `purge`. What it buys over **PRF**: recovery
that needs no passkey provider (Windows Hello / Bitwarden PRF proved
unreliable — see the entry below) and no synced credential — just reach a
hub. What it costs versus the **file**: the file is exposed only if the
user's own storage is breached; the vault is exposed to every home-hub
operator, always. Same crypto, wider exposure.

**Alternatives considered**:
- **Keep it deferred** (the prior [home-hub.md](home-hub.md) stance:
  "revisit only with a strong argument"). The strong argument is the
  opt-in + locator + KDF-hardness + purge package above; the concentration
  risk is disclosed, not eliminated. That deferral is now marked
  superseded.
- **Shamir-split across the home hub list** (k-of-n shares; no single hub
  holds a crackable blob). Genuinely reduces per-operator exposure, but
  needs ≥k hubs online to recover and breaks the "remember one hub URL"
  story. Deferred, not rejected.
- **Server-side secret store (SVR / enclave-attested hardware brute-force
  wall)** — the model that makes a weak PIN safe. Rejected for a
  self-hosted federation: it presumes trusted attested hardware every
  operator runs, contradicting "any operator can run a hub on anything." A
  hub is a dumb store, not an HSM.

**Tradeoff / outcome**: designed, not built. The residual concentration
risk is the explicit price; mitigated most by self-hosting a home-hub slot.
Buildable slices in [ROADMAP.md](../ROADMAP.md). Reads anonymous +
PoW-gated; writes/deletes/purge master-signed (reuse the `put_prefs`
pattern). Additive migration (`identity_vault_blobs`).

## Passkey identity: refuse creation unless restore is proven at birth

**Decision** (2026-07-18, user call): identity creation via passkey PRF
performs a **restore self-test** (a scoped PRF sign-in immediately after
creation) and **refuses to create the identity if it fails** — no
identity, an error telling the user the stranded vault entry is safe to
delete, and a route to the recovery-phrase flow. The self-test's output
is also the **canonical seed source** (restores go through sign-in, so a
create-time output that sign-in can't reproduce must never mint an
identity).

**Why**: live provider testing (owner, 2026-07-18) found real platforms
where PRF works at creation but never at sign-in — Windows Hello 25H2
fails every PRF-carrying `get()` — and providers that store the passkey
while returning no PRF at all (Bitwarden extension, all browsers). An
identity created there *looks* passkey-backed but the passkey can never
restore it: a decoy that fails exactly when the user needs it.

**Alternative considered — create with a warning** (shipped briefly the
same day): keep the identity, derive from the create-output, show a
"your phrase is the only recovery" banner with forced acknowledgment.
Rejected by the user as dishonest UX ("what's the purpose of the
passkey if we can't restore from it?") — the passkey button's contract
is restore-by-passkey, and warnings don't fix a broken mental model.

**Tradeoff accepted**: a genuinely-cancelled verification prompt is
indistinguishable from a broken platform (both `NotAllowedError`), so a
cancel also refuses creation — the message invites a retry. Healthy
providers pay one extra authenticator prompt at signup; that's the cost
of the invariant "every passkey identity has proven restore at birth."

**Outcome**: clients `a310f64` (supersedes the warn-and-acknowledge UI
from `a310f64`/`a310f64` the same day). Provider matrix + platform bugs
in [webauthn-auth.md](webauthn-auth.md).

## Voice-move: hub-requested leave-and-join with claim-based auto-consent and ephemeral voice-only presence

**Decision** (2026-07-18, user call): event staging
([events.md](events.md) §7) introduces moving a member between voice
channels. A move is **not** a server-side yank — voice join is always
client-initiated (desktop UDP after a `voice_join` handshake, web over a
`/voice/ws` relay), so the hub instead **pushes a `voice_move` control
message and the target's client runs its normal leave-and-join**. One
mechanism covers both transports. The push is delivered targeted-by-pubkey
using the shipped `WhisperSignal` pattern (a `ChatEvent` returning `""`
from `channel_id()`, filtered on the recipient pubkey in the WS dispatch
loop). A new channel-scoped `move_members` permission gates the mover.

**Consent** follows the existing consent-spine posture (opt-in is
established by a prior deliberate act, not a blanket grant):

- **Auto-accept** when the target has claimed a slot or RSVP'd "going" on
  the event driving the move — claiming a slot *is* opting into being
  organized. The client shows a toast with a "Rejoin previous channel?"
  escape hatch rather than a blocking modal, so bulk marshalling isn't
  gated behind N confirmations.
- **Prompt-or-decline** for a move with no event context (the generic
  Phase-1 right-click primitive) or when the target hasn't
  claimed/RSVP'd. Decline is a server no-op.

**Voice-only presence**: a member moved into a channel they can't read is
still moved, but gains **only** voice — roster presence, speak/hear, and
the channel *name* in the voice HUD — and **no** `READ_MESSAGES` (no text
history, no message stream, no sidebar entry). The organizer's consented
move is the authorization, a deliberately narrower reveal than the
404-hides-hidden-channels posture events read-gating uses. The grant is
**ephemeral in-memory `AppState`** keyed by (pubkey, channel), created
when the move targets an unreadable channel, consumed by the single
voice-join read-gate bypass, and dropped by `leave_voice`. It never
persists, never survives a restart, and **exactly one** enforcement point
bypasses read-gating — the voice-join gate; message history, subscribe,
channel list, and event read-gating all stay strict.

**Alternatives considered**:

- **Server-side forced move** (hub relocates the participant without the
  client) — impossible cleanly: voice join is client-initiated on both
  transports, so there is no server-authoritative "move" without inventing
  a second, transport-specific control path. Request-to-join reuses the
  join path both clients already run.
- **A persisted DB grant for voice-only presence** — rejected: it would
  need its own revocation and cleanup lifecycle and could outlive the
  voice session it authorizes. In-memory state consumed by the join gate
  and dropped on leave can't leak past the session and needs no migration.
- **Full `READ_MESSAGES` on the destination during the move** — rejected:
  it would leak the channel's text history and put it in the sidebar,
  far more than the organizer consented to. The narrowest grant that
  satisfies "be in this voice room" is voice-only.
- **A blocking accept modal for every move** — rejected for slot
  claimants: it defeats the point of marshalling dozens of raiders at
  once. The slot claim is the consent; the toast escape hatch covers
  misplacement.

**Tradeoff / outcome**: designed, not built. Phasing in
[ROADMAP.md](../ROADMAP.md): Phase 1 = `move_members` + `voice_move` +
right-click move (generic primitive, no events); Phase 2 = staging panel
+ queued `event_move_assignments` + voice-only presence; Phase 3 =
optional auto-spawned squad channels. Full design, SQL, WS/API shapes,
and flagged conflicts (list_events/get_event read-gating, reminder
worker, voice_ws auth, invisible-presence roster) in
[events.md](events.md) §7.

## Shared UI components: hoist from web into packages/ui; desktop adapts

**Decision** (2026-07-18, user call): stop maintaining per-app copies of UI
components. The **web client is the source of truth** — going forward,
components ship into `packages/ui` (prop-only, data access via callback
props) instead of `apps/web/src/components`, and existing duplicated
components are **hoisted from the web copy** whenever they're touched;
desktop adapts by passing its own (Tauri `invoke`-based) loaders as props.
Desktop-parity work changes meaning: instead of hand-porting a web feature
into desktop's diverged copy, move the web component into `packages/ui` and
point both apps at it — the last port that component ever needs.

- **Why now**: an audit (2026-07-18) found only ~14 components shared in
  `packages/ui` vs **61 duplicated by filename** across web/desktop, at an
  average **73% divergence** — the July web-only feature run made the copies
  race apart, and the parity backlog grows with every web feature.
- **Alternative considered**: keep the documented per-app-copies model
  (`client-parity.md`: "parity work usually means porting a change into each
  app's copy"). Rejected — porting cost is paid on *every* feature forever;
  hoisting pays it once. The plumbing (prop-only `packages/ui`,
  `packages/platform` interface contract) already existed and was simply
  under-used.
- **Direction is one-way**: web wins on divergence, but strict desktop-side
  improvements (i18n keys where web hardcoded English, `FocusTrap`) are
  folded into the hoisted version rather than discarded.
- **Not everything hoists**: state orchestrators (`App.tsx`,
  `SettingsPage`) and components whose divergence is *feature* divergence in
  both directions (e.g. `ChannelMessageList`, `DmView`) need a real parity
  reconciliation first — those hoist during their parity pass, not
  mechanically.

**Outcome**: first slice shipped 2026-07-18 — `BotAppLaunchCard`,
`ImagePicker`, `BotCard`, `EmojiPicker` hoisted; both app copies deleted.
`client-parity.md` stance updated. `CreateHubWizard` followed 2026-07-19.
**Mechanical phase completed 2026-07-20** (clients `8500c63`): 41 more
components hoisted in one pass; 12 remain app-local pending feature
reconciliation (skip table + missing-command ledger in
[client-parity.md](client-parity.md)). The "not everything hoists"
carve-out proved out: `ChannelSidebar`, `HubAdminPage`, and
`ChannelSettingsModal` all turned out to be bidirectional feature forks.

## Presence: Invisible + "clear after" TTL; custom-text status removed

**Decision** (2026-07-12, user call): the footer presence picker becomes
**Online / Away / Do Not Disturb / Invisible** plus an optional **"clear
after"** duration (Off / 30m / 1h / 3h). The free-text custom status is
removed.

- **Invisible** = connected but shown offline to everyone else. The hub
  keeps the user in `online_users` (delivery, voice, routing all work) but
  gates the roster (`reported_online()` → false) and the realtime presence
  broadcast (emits offline, never the literal "invisible") for other
  members. The user's own client tracks its invisible state locally (hollow
  dot) and sees itself offline in the roster — acceptable for v1; a
  self-distinct indicator is a later nicety. Known gap: an invisible user in
  a voice channel still shows in that channel's participant list.
- **TTL on presence, never on the profile**: earlier we explicitly rejected
  a TTL on the persistent profile "thought" (expiring profile data is
  wrong). Presence is the right home — it's ephemeral/online-only already.
  The timer is **client-side** (reverts to Online on fire); disconnecting
  resets presence anyway, so no hub-side scheduling.
- **Two "status" concepts reconciled**: the persistent per-hub profile
  status_message (the avatar thought bubble) is the lasting tagline; the
  ephemeral presence picker is the transient mood. Removing the redundant
  free-text presence custom keeps them from overlapping.

**Outcome**: hub + web shipped 2026-07-12 (`39c2208`/`844e74d`). The
`presence_custom` column stays (dormant; desktop/Android may still set it).
Desktop/Android presence-picker parity deferred (ROADMAP).

## Profile card is tabbed; interests become free-text status + activities

**Decision** (2026-07-12, user call, same day — supersedes the structured
interests block below): the structured "Now / Looking for" verb-form felt
impersonal ("like a survey"), so it's replaced. The profile card is now
**tabbed** — a fixed header (banner, avatar, name, pronouns, key) over two
tabs: **Bio** (about me + badges) and **Activities** (a short
`status_message` line, placeholder "What are you thinking?", ≤ 140, plus a
longer free-text `activities` field, ≤ 1000). Both are plain per-hub text
fields on the same `/me` + profile plumbing as bio; the old `interests`
JSON column is left dormant (additive-only migrations).

**Why the reversal so soon**: the fixed-verb form was built to enable hub
*grouping* ("who else is Looking for X"), but the user judged that
structure too rigid for a personal profile and preferred free expression.
Grouping/matchmaking-by-interest is not lost forever — if it returns it'll
be a deliberate *browse* feature (the deferred Slice 2), not a data shape
forced onto every profile.

**Still automatic-free**: this remains fully self-authored. Truly automatic
"playing X" detection stays out (OS scanning / connected accounts = the
declined tracking); auto game presence remains a future *gaming/bot-layer*
feature with explicit consent, not a profile field.

**A third tab, Hubs** — opt-in featured hubs, drag-ordered, hidden by
default. `favorite_hubs` (JSON array of {url,name,icon}) + `show_hubs`
(bool) are stored per-hub like the other profile fields (reusing the draft
model), even though a favorite-hubs list is conceptually one cross-hub
thing — uniformity won over a bespoke identity-wide store, and default +
follow propagates it. **Privacy**: the public profile endpoint gates
`favorite_hubs` to empty when `show_hubs` is false, *except* for the owner
(the web editor reads its own profile through that endpoint, so the owner
must always get their real list back). Drag via the app's existing
`@dnd-kit`. Federation of favorites deferred (same reason as the fields).

**Outcome**: hub + web shipped 2026-07-12 (`cde17a5`/`af062e2` for the
tabs; `1a68d2e`/`9400e22` for the Hubs tab).

## ~~Self-authored interests block~~ + profile cosmetics (accent, cover)

**SUPERSEDED same day** by the tabbed free-text redesign above — the
structured interests form was replaced by free-text `status_message` +
`activities`. The accent-color / cover-image cosmetics below still stand.

**Decision** (2026-07-12, user call): members get an opt-in **"Now /
Looking for"** block — an ordered list (≤ 6) of self-written entries, each a
fixed verb (`playing` / `want` / `lfg` / `into`) plus free text (≤ 80
chars). Stored per-hub on the hub next to bio/pronouns, seeded from the
default profile — the same two-axis shape. Plus two cosmetics: an **accent
color** and an uploaded **cover image**, both overriding the key-derived
banner gradient (precedence cover → accent → identity). All three ride the
existing `/me` PATCH/GET and `/users/{pubkey}/profile` — no wire-format or
federation work.

**This reverses the earlier "activity surfacing declined" stance for the
opt-in case only.** The line that still holds: no *automatic* activity
history (see the entry below). This block is the opposite — nothing is
observed or logged; you type "playing X" yourself and delete it yourself.
The four fixed verbs (rather than free tags) exist so a hub can group
members ("who else is Looking for X") without unmatchable-tag noise or a
moderation surface.

**Alternatives**: free-text-only interests (rejected — collapses into bio,
kills grouping); arbitrary user tags (rejected — unmatchable, moderation
surface); identity-wide-only placement (rejected — matchmaking needs *this
hub's* members to see it, which is community-axis); federation now
(deferred — needs a signed public-profile envelope that doesn't exist yet).

**Tradeoff**: interests JSON + two cosmetic columns and more `/me` surface,
in exchange for profiles that help people find common ground. Cover images
reuse the avatar data-URL approach (client-downscaled to a small JPEG,
length-capped server-side) so no new image-storage or moderation surface.
A "browse everyone Looking for X" filter is a tempting Slice 2 but wants
queryable storage (a child table), not the JSON column — deferred.

**Outcome**: hub + web shipped 2026-07-12. Desktop/Android parity pending
(ROADMAP).

## Profile cosmetics: bio + pronouns in; activity surfacing declined

**Decision** (2026-07-12, user call, inspired by Discord's profile
surface): member profiles gain **bio** (≤ 500 chars) and **pronouns**
(≤ 40 chars) — per-hub values stored on each hub next to
display_name/avatar, defaults carried in the account's default profile.
The editor is a **WYSIWYG card**: the profile card itself is the form
(inline inputs, click-to-edit avatar with hover pencil), with per-context
drafts and one "Save changes" persisting everything edited.

**Alternatives**: Discord-style extras were considered — profile widgets,
a wishlist tab, and "last activities". Widgets/wishlist are deferred (they
lean on a store/game ecosystem Wavvon doesn't have; banner + accent color
are the natural next cosmetics instead). **"Last activities" is declined
outright**: surfacing what a user recently did is activity tracking, and
Wavvon's no-telemetry ethos means it must not exist as a default-on
profile filler. If ever wanted, it needs its own explicitly opt-in design.

**Tradeoff**: two more nullable columns on `users` and two more fields on
the /me PATCH surface, in exchange for profiles that feel like a person.
The member_updated WS broadcast stays name/avatar-only — cards fetch live,
so bio edits don't need hub-wide push.

**Outcome**: hub + web shipped 2026-07-12. Desktop/Android parity pending
(ROADMAP).

## Profiles: one default per account; per-hub identity lives on the hub

**Decision** (2026-07-12, user call during the settings redesign): the
client-side named-profile preset pool and its per-hub assignment map are
deleted. Each account keeps exactly one **default profile** (display name +
avatar, local per-account storage) that prefills and auto-applies when the
account joins a hub. How you appear on a hub is edited in place and stored
by that hub itself (member state via `PATCH /me`) — the hub is the source
of truth; nothing per-hub is mirrored client-side.

**Alternatives**: (a) keep the preset pool (status quo) — presets you
"apply" to hubs, with a local hub→profile map; (b) make the pool
device-global so profiles can be reused across accounts, with a per-account
default pointer.

**Tradeoff**: we lose one-click re-application of a persona across many
hubs. In exchange the model aligns exactly with the two-axis rule: per-hub
profile is community-axis state on the community hub (it already was,
server-side — the pool just duplicated it), and the single default profile
is personal-axis state that can later ride the per-account prefs blob to
other devices. Option (b) was rejected because device-global state is owned
by no identity — no keypair to sign it, no home hub to sync it, stuck
per-device forever — and because cross-account profile sharing nudges users
into publicly linking identities that separate accounts exist to keep
apart. Alpha state: no migration; orphaned localStorage keys are ignored.

**Outcome**: shipped web 2026-07-12. Desktop/Android still on the old
model (tracked in ROADMAP known issues).

## Settings IA: "Accounts" macro group with four scoped tabs

**Decision** (2026-07-12, user call, three iterations): user settings nav
gains an **Accounts** group with four tabs — **Profile** (default profile,
per-hub profile, badges/certifications), **Manage accounts** (switcher
table, recovery phrase, identity backup, full archive, home hubs),
**Devices** (paired devices, passkeys, trusted devices — all "what can act
as this account, revoke it"), **Privacy** (blocked/ignored users — about
other people, not account access). The "Managing account" selector is
owned by SettingsPage and shared across tabs, so a selection survives tab
changes; the Profile tab participates too (a non-active account's default
profile is plain local scoped storage — editable without switching). The
language selector moved to Appearance (app-level, not account-level).

**Alternatives**: one mega Account tab (status quo — ~1,400 lines of
sections, and four active-only sections sat *below* the managing selector
while ignoring it); two tabs (accounts list vs. everything else — re-merges
unrelated concerns); splitting Devices further per section (three tabs of
one list each).

**Tradeoff**: more tabs to scan in the nav, but each answers one question,
and grouping certifications under Profile (identity presentation, not
security) and recovery/backup next to the switcher (getting identities
on/off the device) removes the old tab's mixed active-only/managing
semantics.

**Outcome**: shipped web 2026-07-12 with the profile-model change above.

## Account switching is an in-place key-remount, guarded, not a reload

**Decision** (2026-07-12, user call after live testing, supersedes the
"switch = reload" paragraph of the multi-account entry below): switching
accounts remounts the app tree in place — `AccountRoot` renders
`<App key={activeAccountId}>`, so React unmount runs every cleanup and
the new account mounts fresh from local data. No navigation, no
transition overlay (an interim overlay approach was built and rejected
same-day: account data is local, so a loading page was papering over an
unnecessary reload).

What preserved the reload's safety guarantee:

- **Teardown audit** — the one real leak found: the module-level hub
  sessions map (`platform/session.ts`) survives React remounts, so the
  outgoing account's WebSockets would have stayed open;
  `resetHubSessions()` now runs before the key flips. Voice/video/
  screen-share/webcam-processor refs gained a master unmount effect.
- **Voice guard** — switching is *blocked* while joined to a voice
  channel (disabled buttons + surfaced reason), not auto-left; the
  user's explicit call: prevention over interruption.
- **4s switch cooldown** — rapid consecutive switches race the
  remount + per-hub reconnect cycle; refused with a reason.

The e2e proves the contract: a `window` marker planted before the
switch survives it (a reload would wipe it), no overlay is ever
attached, and the cooldown engages. Managing *other* accounts without
switching at all is the companion feature (account selector, same-day).

## Invite role policies: privileged inviters pick, everyone else gets the hub default

**Decision** (2026-07-11, implemented hub + web same day): two-tier
role assignment through invites, replacing the "every newcomer is only
everyone until someone fixes it" default that pushes other platforms'
communities toward auto-role bots.

1. **Inviter with role power picks the role** — any member whose role
   grants `manage_channels` (the invite-creation permission) can mint
   an invite carrying `grant_role_id`, limited to roles strictly below
   their own max priority. Guarded at mint AND at redemption (an
   inviter demoted after minting confers nothing). This tier mostly
   shipped with role-granting invites; this decision extends the UI to
   non-admin members (QuickInviteModal) and pins the non-admin paths
   with tests.
2. **Hub default for everyone else** — a hub setting
   `default_invite_role_id` (admin-configured, on the standard
   hub-settings surface; `""` clears). Applied at redemption to any
   invite with no explicit grant, on both `/auth/verify` and
   `/join/:code`, through the same shared grant helper. Explicit
   grants always win. The default may never be a role carrying the
   `admin` permission — rejected at configuration and skipped at
   redemption if the role later gains admin or is deleted
   (defense-in-depth).

**Alternatives considered**:

- **Per-inviter-role policy matrix** ("invites from role X grant role
  Y") — deferred: a single hub default covers the observed need
  (newcomer trust tier) with one setting; the matrix adds admin UI
  complexity with no demonstrated demand. The redemption helper is the
  seam if it's ever wanted.
- **Applying the default only when the inviter lacks role power** —
  rejected: "no explicit grant → default" is simpler to reason about
  and makes admin-minted plain invites behave identically to member
  ones.
- **Allowing an admin-permission role as default** — rejected outright:
  a standing setting that silently hands out admin to anyone with an
  invite link is a takeover primitive, not a convenience.

**Outcome**: live-verified e2e — a plain-invite joiner received the
configured default role; explicit-grant, priority-guard, and
clear-the-default paths covered by 11 new hub tests.

## Paired-device DMs attribute to canonical via cert-chained envelopes; DH capability is a wrapped canonical scalar

**Decision** (2026-07-11): fix the multi-device DM bug (paired devices
attributing DMs to their subkey and keying E2E against the wrong X25519
key) with two anchored-to-canonical mechanisms, neither of which puts a
signing seed on a paired device:

1. **DH capability** — the canonical DM DH keypair stays what ships
   today: the X25519 scalar derived from the *canonical* (subkey-0 /
   entropy) Ed25519 seed via the SHA-512+clamp recipe, published at
   `/identity/{canonical}/dh-key`. At pairing the enrolling device (which
   holds the entropy) wraps that **32-byte X25519 scalar** — not the
   Ed25519 seed — for the new subkey with the existing ECIES
   `wrapBlobKey`, delivered in `PairingComplete.wrapped_dh_seed_hex`
   next to `wrapped_blob_key_hex`. The paired device stores the scalar
   and uses it for every DM key agreement. It gains decrypt/agreement
   capability with **no** signing capability (the scalar is not
   reversible to either the master or the subkey-0 seed), preserving the
   "paired devices never hold the master seed" invariant. Only a device
   holding the entropy publishes the DH key; paired devices skip publish.

2. **Attribution** — the envelope keeps `sender_pubkey = canonical`
   (unchanged semantics). A paired device signs with its subkey and
   attaches its `SubkeyCert` in a new optional `signer_cert` field.
   Verifiers with an absent `signer_cert` behave exactly as today (verify
   against `sender_pubkey`); with a present one they verify (a) the cert
   (master→subkey), (b) the envelope signature against
   `signer_cert.subkey_pubkey`, and (c) that `sender_pubkey` is owned by
   `signer_cert.master_pubkey`. Binding (c) is tiered: the origin hub
   proves it from the authenticated session's resolved `(canonical,
   master)`; a federated hub or recipient client resolves master→canonical
   from its local `users` row, falling back to the sender's device
   registry (canonical's self-cert) when the user is unknown. The
   `FederatedDmRequest` carries `signer_cert` so downstream hubs verify
   without a session.

**Alternatives considered**:

- **Client signs the envelope as the canonical identity** — impossible
  by design: a paired device deliberately holds neither the master nor
  the subkey-0 (canonical) signing seed.
- **Hub rewrites `sender` subkey→canonical on the DM path** — works on
  the origin hub but breaks downstream: the envelope signature (by the
  subkey) no longer verifies against the rewritten canonical `sender` on
  a federated hub or a recipient client, and a rewrite carries no proof
  that resists a malicious peer hub spoofing `sender`. Cert-chaining
  keeps the proof self-contained across federation.
- **Attribute DMs to the master pubkey** (self-contained with one cert,
  `sender_pubkey = cert.master_pubkey`) — rejected: the DR receive path
  fetches the sender's static DH by `sender_pubkey`, and the DH key lives
  at the canonical pubkey, not the master; it would also make DM
  attribution a third identifier inconsistent with community actions and
  existing DM history (both keyed to the canonical/subkey-0 pubkey).
- **Per-subkey published DH keys with cert-chained binding** — rejected
  for v1: every recipient would re-key existing conversations against a
  new per-device DH key and track which device is current. Wrapping the
  one canonical scalar keeps every shipped conversation working with zero
  re-keying and one small pairing-payload field.
- **Defer to the full home-hub build-out** — rejected: the fix needs
  only a pairing-payload field, an optional envelope field, a publish
  guard, and verification tiering, all on machinery (subkey certs, ECIES
  wrap, device registry, `resolve_canonical_identity`) that already
  ships. It does not need the canonical DM inbox or designation
  replication.

**Tradeoff / outcome**: one refinement to the
[e2e-encryption.md](e2e-encryption.md) "Multi-device" open question —
the DH anchor is the **canonical (subkey-0/entropy) seed's** DH, not the
HKDF-master's, because that is what is already published and what
existing conversations key against; anchoring elsewhere would force a
re-key. Compatibility: historical rows are not rewritten. Because
paired-device E2E sends previously failed hub signature verification
(subkey signature checked against canonical), almost no cert-less
subkey-keyed encrypted rows exist; any orphaned ones from the pre-fix
window stay unreadable and are documented as a bounded loss (multi-device
pairing is recent and web-only). A cert-chained envelope reaching an
un-upgraded hub or client fails its signature check and does not
federate/decrypt until that peer upgrades — a strict improvement over
today (paired-device E2E did not work at all), and the un-upgraded
population shrinks as the single web delivery target updates. Full detail
and file list in [multi-device.md](multi-device.md#implementation--dm-attribution--dh-fix).

## Multi-account is device-local storage namespacing, not a synced concept

**Decision** (2026-07-11, implemented web same day): a device can hold
multiple identities ("accounts") and switch between them. An account is
purely **device-local client state** — the account list is never synced
to any hub, never enters the prefs blob or any personal-axis store, and
no hub knows or cares that two pubkeys share a browser. Each account's
local state (hub list, session tokens, drafts, profiles, notification
prefs, DM ratchet state) is isolated by a localStorage namespace
(`wavvon:acct:<pubkey>:<key>`, one helper module all per-user storage
routes through); the account registry is just the rows of the existing
IndexedDB identity store keyed by pubkey. ~~Switching swaps the
active-account pointer and reloads the app — guaranteed teardown of
sockets/voice, replaceable later by an in-place switch.~~ *(Superseded
2026-07-12: switching is now an in-place key-remount — see the entry
above.)* Removing an account requires typing its fingerprint and purges
its namespace (session tokens and ratchet state must not outlive the
identity on a shared device).

**Alternatives considered**:

- **Simultaneous multi-account sessions** — rejected for v1: parallel
  socket/voice/notification stacks per account for marginal benefit;
  two browser profiles already deliver it for free.
- **Syncing the account list across devices** — rejected: which
  identities live on which device is the user's per-device choice
  (identity A on devices 1+2, identity B only on device 2 is fine).
  Pairing already handles per-identity device enrollment; an
  account-list sync would create a new cross-identity linkage that
  contradicts identities being unrelated keypairs.
- **Cross-account safeguards** (wrong-account posting warnings) —
  rejected: each account has its own hub list; using two accounts on
  one hub is the user's responsibility, not the client's.
- **Backward-compatible migration of the single-account store** —
  deliberately skipped (pre-release): the IndexedDB upgrade drops the
  legacy singleton row; existing installs re-import via
  phrase/passkey/pairing.

## Passkey PRF output is the identity entropy, not a new key layer

**Decision** (2026-07-11, implemented web-only same day): the
"passkey = master key anchor" design from
[webauthn-auth.md](webauthn-auth.md) is implemented by using the
WebAuthn **PRF extension output (32 bytes) directly as the identity
entropy** — the exact slot BIP39 entropy occupies. The PRF eval salt is
the pinned protocol constant `wavvon-master/v1` (must be byte-identical on
every client, never changed — only versioned alongside). *Since 2026-09-04 that
constant is specified in [webauthn-auth.md](webauthn-auth.md) and nowhere in
code: `packages/core/src/identity/prf.ts` was deleted along with the last of
this path, having never reached a release.* Everything
downstream (HKDF master derivation, subkey 0, entropy ↔ 24-word
phrase) is untouched, so a passkey-created identity can still reveal
its 24 words, and the phrase remains the domain-independent backup —
offered, not forced, right after passkey creation.

The bootstrap credential is created **fully client-side** (self-signed
challenge, discoverable credential, rp = current origin) and is never
registered with a hub — it exists purely as a PRF oracle. The separate
hub-session passkey ceremony (`/auth/webauthn/*`) is unchanged.

**Alternatives considered**:

- **PRF output feeds a new derivation layer** (PRF → HKDF → entropy) —
  rejected: adds a second protocol constant and breaks the property
  that passkey identities and phrase identities are the same kind of
  identity with interchangeable backups.
- **Register the bootstrap credential with the hub during creation** —
  rejected: identity creation must not require a hub round-trip, and
  the hub gains nothing (PRF results never leave the client).
- **Raw-seed QR export for portability** — rejected: a QR of the seed
  is the plaintext secret in scannable form; screenshots sync to cloud
  photo libraries. The encrypted `.wavvon-backup` +
  recovery-kit idea ([identity-recovery.md](identity-recovery.md))
  is the QR-shaped answer.

**Tradeoff accepted**: the passkey is bound to the rp domain it was
created on (the hub domain serving the web app). If that domain dies,
the passkey can't be asserted elsewhere — the revealed 24-word phrase
is the deliberate escape hatch, and the onboarding copy says so.

## Presence is global across hubs; per-hub quiet is hub mute, not status

**Decision** (2026-07-10, same day as the DND-via-status decision below,
after review): a user's presence status (Online / Away / DND + custom
text) is **one global fact**, not a per-hub setting. Setting it per hub
would conflate two different concepts: *"I am not to be disturbed"*
(a property of the person, visible everywhere) versus *"this hub should
not disturb me"* (a property of the relationship with one hub). The
second concept already has its own tool — the per-hub/per-channel
**notify modes** (`all`/`mentions`/`silent`), where `silent` is hub
mute, already surfaced in the hub sidebar as a muted badge.

Implementation (web, 2026-07-10): the client is the source of truth for
presence — the status picker broadcasts `set_status` to **all** connected
hub sessions (previously only the active one), persists the choice on
the device, and re-applies it to each hub on (re)connect (only when an
explicit choice exists on the device, so a fresh device doesn't stomp a
status set elsewhere). The notification gate now checks **both** quiets
independently: mention pings/popups are suppressed when own presence is
`dnd` *or* when the message's hub/channel effective notify mode is
`silent` — the latter was previously cosmetic (the muted hub still
pinged).

**Alternatives considered**:

- **Per-hub presence** (the accidental status quo — `set_status` went
  only to the active hub) — rejected: nobody is "in a meeting" on one
  hub and free on another; the badge others see would depend on which
  hub happened to be active when you set it.
- **Hub-side fan-out** (a hub propagates your status to your other
  hubs) — rejected: hubs don't know each other's membership and must
  not (privacy); the client already holds every session, so client-side
  fan-out is one loop with no protocol change.

**Superseded**: nothing removed; refines the scope of the decision below.

## Do Not Disturb engages via presence status, not a dedicated toggle

**Decision** (2026-07-10): DND has no control of its own. The presence
status picker in the sidebar footer (Online / Away / Do Not Disturb,
shipped 2026-07-05) is the single surface — selecting **Do Not Disturb**
both broadcasts the badge to other members and arms the local
notification gate (mention pings and system notifications suppressed;
unread counters still accumulate). The gate is a read-time client
transform per [block-mute-ignore.md](block-mute-ignore.md) §3; no new
storage, since the status is already hub-synced and persisted. The
never-mounted `DndToggle` / `DndSettingsSection` components and the
`DndSettings` prefs shape from the earlier draft were deleted from
Wavvon-web.

**Alternatives considered**:

- **Sidebar-footer quick-toggle next to self-mute/deafen** (the original
  block-mute-ignore.md §3 design; a `DndToggle` component was even built
  but never wired) — rejected: it duplicates a state the status picker
  already owns, giving one fact two homes and two controls that can
  disagree visually. One fixed home per control.
- **DND enabled flag in the encrypted prefs blob** — rejected for the
  on/off state: presence is already synced and persisted hub-side;
  mirroring it into the prefs blob invites drift. The blob remains the
  right home for the *future* quiet-hours schedule, which is a private
  preference, not a broadcast state.

**Superseded**: the "quick-toggle" half of block-mute-ignore.md §3
(section revised in place, 2026-07-10). The one-step-downgrade transform
and the deferred schedule are unchanged.

## "Create a hub" from the `+` button is a two-exit router, not a spawner

**Decision** (2026-07-06): the hub-list `+` button gets a Join/Create
fork. "Create a hub" does not pretend the client can stand up a server —
it routes to one of two honest exits and re-absorbs the result as an
owned hub. **(a) Self-host**: hand off to the web wizard
(`discovery.wavvon.app/new`) or the offline `wavvon-hub setup` one-liner;
the operator runs the server, then pastes the shipped first-boot
owner-granting invite back into the client to land as owner. **(b)
Managed/farm**: pick a farm advertising public hosting; the farm
provisions a hub and returns its address plus a server-assigned owner
claim. The buildable **first slice is (a)** — UI-only over already-shipped
primitives (invite-first defaults, one-time owner invite, role-granting
invite redemption, `wavvon-hub setup`), needing **no new farm capability
and no new hub endpoint**. (b) is deferred behind farm lifecycle. Full
design: [hub-creation-wizard.md](hub-creation-wizard.md#4-client-entry--create-a-hub-from-the--button).

**Alternatives considered**:

- **One unified in-client create form** that asks template + name and
  then "picks" a host — rejected: it hides the fact the client can spawn
  nothing itself, and would dead-end for self-hosters who must leave the
  app to run a command. The explicit two-exit fork is honest and lets the
  self-host exit ship now.
- **Embed the whole template wizard in the client** — rejected for the
  same reason Section 3 keeps the wizard on the web: Docker/binary command
  generation and managed-farm signup already live there; duplicating
  template browsing in-client is maintenance for no gain.
- **Ship Create as farm-only** (skip self-host, wait for lifecycle) —
  rejected: it blocks the whole feature on farm lifecycle work when the
  self-host path is fully unblocked today.

**Tradeoff**: the self-host exit sends the user out of the app to run a
command and come back with an invite — more steps than a one-click
managed create. Accepted because it is the only honest thing a client can
offer without a provisioning backend, and it ships now instead of waiting
on farm lifecycle (`farm/src/hub_manager.rs` + the `agent` crate,
Wavvon-server).

**Outcome**: designed; self-host slice queued as the buildable next step
(ROADMAP #13). Client change is the `+` fork + self-host handoff panel +
owner-invite paste (delegating to the existing invite-redeem path), in
Wavvon-web first. Managed path deferred to Phase 3 §C
([farm-impl.md](farm-impl.md#c-user-facing-hub-creation-flow)) once
`POST /farm/hubs` provisioning + auto-spawn lifecycle land.

## Farm reverse-proxy routes by hub serial, not opaque hub_id

**Decision** (2026-07-05): the farm's shared-domain reverse proxy keys
on the **hub serial** (its Ed25519 pubkey) as the client-facing routing
segment — `https://farm.example.com/hub/<serial>/<path>` resolved via a
unique index on `hubs.hub_pubkey` to the hub's `process_port`. The
opaque 8-12 hex `hubs.id` PK stays, but only as the farm-internal
management handle (`/farm/hubs/{hub_id}`), not as the proxy key. Path
prefix, not subdomain or header. Full design:
[farm-impl.md](farm-impl.md#serial-routing--first-slice).

**Alternatives considered**:

- **Opaque `hub_id` as the routing key** (the original Phase 2 choice) —
  reversed. Shipped farm-ready invites already carry the serial
  (`wavvon://<host>/i/<serial>/<code>`), so routing on `hub_id` would
  force a serial→id resolution round-trip before any client could reach
  the hub. The serial is also the identifier federation and DM
  addressing already use.
- **Subdomain per hub** (`<serial>.farm.example.com`) — rejected: a
  64-hex serial exceeds the 63-char DNS label limit, and subdomains
  need a wildcard cert + wildcard DNS, defeating the one-cert
  self-hoster goal.
- **Header (`X-Hub-Serial`)** — rejected: invisible to links, breaks
  the shipped invite URL shape, can't be shared or bookmarked.

**Tradeoff**: 64-char path segments on every request (cosmetically ugly,
well within HTTP limits) and a second identifier space for the same hub
(serial for routing, `id` for management). Accepted because the serial
is the durable, federation-consistent, already-public identity, and the
"pubkey exposes routing details" objection behind the original opaque-id
choice no longer holds once the serial ships in every invite.

**Outcome**: designed; implementation slice queued (ROADMAP farm
wishlist). The concrete change is a `hub_pubkey` unique index, a
serial-keyed lookup in `farm/src/proxy.rs`, and a WS-upgrade socket
bridge — the existing proxy handles HTTP-by-`id` only. Supersedes the
Phase 2 routing text in [farm-impl.md](farm-impl.md), which now carries
a forward pointer.

## Schema baseline reset at v0.3.0 (pre-production)

**Decision** (2026-07-05): collapse the hub's accumulated migration
history — every `ALTER TABLE ADD COLUMN` layered on since the first
schema — into a single clean baseline in `migrations.rs`. A fresh
install now creates the final schema in one pass; the wizard/template
first-run bootstrap ([hub-creation-wizard.md](hub-creation-wizard.md))
is the one and only first-setup path. The additive-only migration rule
resumes **from this baseline**: future changes are still
`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN` only.

**Why**: no production deployments exist yet, and the upgrade-ALTER
ballast made the schema unreadable as a whole and slowed every fresh
test database. Resetting now is nearly free; resetting after GA never
is.

**Alternatives considered**:

- **Keep accumulating ALTERs** — rejected: pure cost with no
  beneficiary; no deployed hub needs the upgrade path yet.
- **Adopt a versioned migration framework** (numbered files, journal
  table) — deferred, not rejected: worth revisiting before the first
  supported production upgrade, but overkill while a baseline reset is
  still an option.

**Tradeoff**: hubs created before v0.3.0 (the first external pilot hub)
cannot upgrade in place — they must wipe the database and re-run first
setup (the wizard makes this cheap). Accepted explicitly as the last
moment this is acceptable.

## Alliance space-sharing v2: read-time recursive-CTE expansion

**Decision** (2026-07-05): recursive alliance sharing resolves the
effective shared set — explicit shares ∪ all descendants of any
`include_descendants` share — at **read time** via a recursive CTE
(depth-guarded at 32), not by materializing a row per shared descendant.
A single `include_descendants BOOLEAN` on `alliance_shared_channels`
records intent; `GET /alliances/:id/channels` and the message endpoints
expand it on each call. Full design: [alliances.md](alliances.md).

**Why**: the expansion is correct **by construction**. Sub-channels
created after a category is shared are shared automatically; unsharing a
root drops the whole subtree; moving a channel out of a shared category
un-shares it — all with no bookkeeping, because nothing derived is
stored to go stale.

**Alternatives considered**:

- **Materialized per-descendant rows** — rejected: every channel
  create / move / delete would have to fan out inserts and deletes into
  the shared set, needing triggers or a sync worker, and any missed hook
  leaves stale shares. Trades a cheap read for fragile write-time
  bookkeeping.
- **Path-prefix matching** (store a materialized path, match by prefix)
  — rejected: no foreign-key integrity, and re-parenting a subtree means
  rewriting every descendant's path anyway.

**Tradeoff**: a CTE walk per list/message call instead of a plain index
lookup. Accepted — alliance share sets are small (a hub shares a handful
of spaces), the depth guard bounds the walk, and correctness beats
micro-optimizing a low-frequency read.

## LAN mode: explicit flag + hard private-address guard

**Decision** (designed 2026-07-04, not yet implemented): a hub runs on
a LAN via mDNS/DNS-SD discovery (`_wavvon._tcp.local`) and one of three
trust tiers — CA cert (today), self-signed + out-of-band fingerprint
pinning, or gated plaintext. All non-CA paths are reachable **only**
under an explicit `WAVVON_LAN_MODE=1` flag, and under that flag the hub
**refuses to bind or advertise a non-private address** (loopback /
RFC 1918 / link-local only), exiting otherwise. Ships server-first;
native mDNS-discovery UX is deferred to the client era. Full design:
[lan-mode.md](lan-mode.md).

**Why**: "works at a LAN party with no internet" is a structural
differentiator over centralized platforms, and the Rust hub is already
self-contained. The dominant risk is a self-signed/plaintext hub
accidentally exposed to the internet — the explicit flag plus the
address guard make that structurally impossible rather than merely
discouraged.

**Alternatives considered**:

- **Local CA / ACME-on-LAN** — rejected: heavy PKI, and browsers still
  wouldn't trust the root without a manual import. Fingerprint-in-invite
  TOFU is simpler and needs no PKI.
- **Auto-detect LAN and relax TLS silently** — rejected outright: the
  whole point is that relaxed trust must be a loud, explicit,
  un-exposable opt-in, never inferred.
- **Block the feature until the browser can do it** — rejected: the
  browser can't do mDNS or self-signed trust and web is the delivery
  target, but the safe *server* half stands alone and is shippable now;
  coupling it to deferred client work would strand a useful capability.

**Tradeoff**: full LAN UX (in-app nearby-hubs list, fingerprint
pinning, QR scan) is native-client work that lands later; on web today,
LAN works only in the plaintext tier when the web bundle is also served
over http from the LAN. Accepted — the server capability is the
valuable, safety-critical part.

## Discord import: two-stage CLI with a neutral, reviewable manifest

**Decision** (designed 2026-07-04, not yet implemented): the migration
tool is a standalone workspace CLI (`discord-import`, modeled on
`demo-seed`) with two stages: `export` reads a guild's structure via a
read-only **bot** the owner invites (channels, roles, permission
overwrites — no privileged intents) and writes a neutral, versioned,
human-editable `import-manifest.json`; `apply` replays that manifest
onto a **fresh** hub through existing public HTTP routes only.
Structure only in v1 — members, history, and emoji are reported as
skipped, never silently dropped. Full design:
[discord-import.md](discord-import.md).

**Why**: "do we have to rebuild everything?" is the first objection
every switching community raises, and structure is the cheap 90% of
the answer. The manifest between the stages gives the operator a
review/edit step, decouples the Discord-facing half from the
hub-facing half, and becomes an input format other sources (Matrix,
Slack, generators) can emit later.

**Alternatives considered**:

- **Single live Discord→hub pipe** — rejected: no review step, couples
  both APIs in one process, can't run the halves on different machines.
- **User-token scraping / data package** — rejected: user tokens
  violate Discord ToS; the personal data package doesn't contain
  server structure at all.
- **DiscordChatExporter output as primary input** — rejected:
  third-party, message-centric format; may become another manifest
  *producer* later.
- **Message history in v1** — rejected: imported messages have no
  author keypair (identity is a keypair, not an account), so history
  import is an attribution-design problem with 10× the surface.

**Tradeoff**: a fresh-hub-only, fail-forward apply means no
merge-into-existing and "wipe and re-run" as the recovery path.
Accepted for a v1 migration tool.

## Role categories are display-only; role color/icon ships with them

**Decision** (designed 2026-07-03, not yet implemented): roles gain
native grouping via a `role_categories` table plus a nullable
`roles.category_id`, and cosmetic identity (`color`, `icon` — emoji
only in v1) on both roles and categories. Categories carry **no
permissions** and render on exactly two surfaces: the hub-admin Roles
tab (grouped list) and the user profile card (badges sectioned under
category headers). The member sidebar is untouched — hoisting stays on
`display_separately`. Full design: [role-categories.md](role-categories.md).

**Why**: communities on centralized platforms fake this with
permissionless divider roles (`─── Staff ───`), polluting the
permission system, role pickers, and mention search. Native grouping
removes the hack without adding a second permission axis.

**Alternatives considered**:

- **Categories with permissions** (roles inherit from their category) —
  rejected: a second grouping axis competing with roles and the
  channel-overwrite cascade ([nested-channels-ux.md](nested-channels-ux.md) §3);
  the permission model keeps exactly one unit, the role.
- **Sectioning the member sidebar by category** — rejected for v1: the
  profile card is where flat role chips hurt most; re-sectioning every
  member list on day one of a cosmetic feature is disproportionate.
- **Icon image uploads** — rejected for v1 in favor of emoji: uploads
  need storage, quotas, and moderation for a decoration; the TEXT
  column upgrades to an asset-id scheme later if justified.

**Tradeoff**: display-only categories can't express "everyone in this
group of roles may…" — bulk permission tooling, if ever wanted, must
operate on roles, not categories. Accepted; that's the point.

## Web voice via a WebSocket Opus relay, not WebRTC

**Decision** (shipped 2026-06-13): the browser client joins the same voice
channels as native clients by relaying Opus frames over a hub WebSocket
endpoint (`/voice/ws`), not over WebRTC. Native clients keep their UDP
path; the hub fan-out routes each relayed frame to both UDP (desktop,
Android) and WS (web) participants in one channel. The browser frames the
same Opus wire format as UDP, encoding/decoding with the `opusscript` WASM
codec. Hub handler is `hub/src/routes/voice_ws.rs` (Wavvon-server); the
client side is `VoiceWsSession` in `apps/web/src/platform/voice.ts`
(Wavvon-client). Full data flow in [voice.md](voice.md).

**Why**: the browser cannot open raw UDP sockets, so the existing transport
was a hard wall. The WS relay reuses what already exists — the hub's Opus
fan-out, the session-token auth, and the exact UDP wire format — adding
only a second sender registry (`voice_ws_senders`) and a socket handle to
`AppState`. It got browser voice working end-to-end against the live pipeline
with no new media stack on the hub.

**Alternatives considered**:

- **WebRTC (SFU on the hub)** — rejected for v1: it forces the hub to
  terminate ICE/DTLS-SRTP and run a real SFU, a large new subsystem, for
  no gain over relaying the Opus frames we already produce. WebRTC stays
  the right answer for a future P2P/lower-latency upgrade and is already
  the chosen path for screen-share v2 ([screen-share-webrtc.md](screen-share-webrtc.md)),
  but voice did not need it to ship.
- **Leave browser voice deferred (status quo)** — rejected: it was the
  largest remaining parity gap and produced the "join voice button + voice
  unavailable banner" contradiction the design review flagged.

**Tradeoff**: the WS relay carries audio through the hub's WebSocket layer
rather than a dedicated media transport, and the browser path has no
RNNoise/VAD denoise (the WASM codec and `ScriptProcessorNode` graph are the
v1 ceiling). Per-stream WS framing is heavier than UDP; acceptable because
the browser audience is smaller and latency-tolerant relative to native.

## Client apps consolidate into one monorepo; hub server stays separate

> **Status (2026-06-13): shipped.** The three client repos were merged into
> the Wavvon-client monorepo across five staged commits — `apps/desktop`,
> `apps/web`, `apps/android/android` plus shared `packages/core|ui|platform|i18n`.
> The decision below is preserved as written (future tense); the structure
> it describes is now live. See [architecture.md](architecture.md) for the
> current repository map.

**Decision**: the three client repos — Wavvon-desktop, Wavvon-web,
Wavvon-android — merge into a single client monorepo (`wavvon`) with
internal pnpm workspace packages (`packages/core`, `packages/ui`,
`packages/platform`, `packages/i18n`) for shared code and per-app
projects under `apps/*`. The Rust hub server (Wavvon-server) stays its
own repo. Full plan, staged migration, and CI/release/updater details in
[client-monorepo.md](client-monorepo.md).

**Why**: the clients already share code, but through three fragile edges.
A `file:` dep from desktop into Wavvon-web (`@wavvon/utils`,
`@wavvon/i18n`) pulled a **second copy of React** into the packaged
desktop build and crashed it, forcing a `dedupe` band-aid in the desktop
Vite config (desktop `7844c31`). The desktop release workflow checks out
**two repos** just to resolve i18n. The Android web fork reaches across
repos via a Vite alias (`@components` → `../wavvon-desktop/src/...`) that
only works with both repos checked out side by side. And the trigger:
invite-link parsing (`#invite=` / `?invite=`) would otherwise be written
2–3 times — the desktop has `parseHubInput()`, the web client has no URL
invite parser at all. A workspace makes the double-React class
structurally impossible (single hoisted React), collapses the dual
checkout to one, and lets a shared-code change plus all consuming clients
land in one commit. [browser-client.md](browser-client.md) already
flagged this refactor as deferred; this is it.

**Alternatives considered**:

- **Keep multi-repo + the cross-repo Vite alias / `file:` deps (status
  quo)** — rejected: it is the source of the double-React crash, the
  dual-checkout release, and the side-by-side-checkout requirement; every
  shared-code change is a multi-repo dance.
- **Standalone published `@wavvon/core` npm package (separate repo)** —
  rejected: the publish / version-bump / update-consumers cycle adds
  *more* friction than today, not less. An internal workspace package
  shares code with zero release machinery and lets a shared-code change
  and all its consumers ship in one commit.
- **Full monorepo including the Rust hub server** — rejected: the hub is
  a different deploy unit (server binary / Docker image with its own
  release cadence and its own CI), not an installed app. Co-locating it
  buys nothing and couples unrelated release pipelines.

**Tradeoff**: consolidating three public repos into one drops the org's
public repo count six → four, a minor negative against the stated
stars/visibility goal (mitigated by keeping the old repos archived but
visible, and by one well-documented clients repo being a stronger
newcomer entry point). The Wavvon-server Docker web-builder stage must
re-point its Wavvon-web checkout to the monorepo's `apps/web` — a
cross-repo coordination point called out in the migration. The TS
identity crypto stays byte-pinned to the hub's wire-format vectors; that
contract was already cross-repo and is unchanged (now one TS
implementation instead of three).

## Hubs may optionally self-serve the web client (operator sovereignty, not central hosting)

> **Refined 2026-08-25, not reversed** — see "Two web clients: one per hub, one
> per user" at the top. Hub-serving survives unchanged, including
> `WAVVON_WEB_CLIENT_DIR`, the version-matched Docker bake and the
> `window.__WAVVON_HOME_HUB__` default. What changes is *which build* it serves:
> the single-hub build, which has no hub list at all. The multi-hub client moves
> to one origin we host. The sovereignty argument below still holds — the invite
> link still points at the operator's own domain — but "keeping the multi-hub
> story consistent" turned out to cost the identity-per-origin problem, and that
> is what the split pays off.

**Decision**: a hub can serve the browser client from its own origin. Setting
`WAVVON_WEB_CLIENT_DIR` makes the hub serve a directory of built web-client
assets at `/` with SPA fallback; unset, the hub is API-only exactly as before.
The official Docker image bakes a version-matched web-client build in and sets
the var by default, so `docker compose up` yields a working client at the hub's
own URL. The served client defaults its first hub connection to its serving
origin (via an injected `window.__WAVVON_HOME_HUB__`) while keeping the
type-a-URL flow for adding other hubs.

**Why**: the highest-value growth lever for a small operator is "send a link, a
friend is in" — no app install, no typing a hub URL into a separate hosted page.
Serving the client from the hub's own origin delivers that and is also the most
federation-honest shape: each operator serves their own client from their own
domain. This is not a Wavvon-operated service — it reinforces operator
sovereignty rather than centralizing anything, and it does not phone home.
Requested by the first external hub operator (pilot, 2026-06-12).

**Alternatives considered**:

- **Compile-time embed (rust-embed) behind a toggle** — rejected: freezes a
  web-client build into every hub binary, bloats the binary for the
  proxy/hosted-client majority, and forces a hub recompile to ship a web-client
  fix.
- **Hosted client only (status quo) + documented nginx/Caddy sidecar** — kept as
  a documented option for advanced operators, but doesn't meet the zero-config
  bar the pilot operator asked for.
- **Runtime-dir only, no Docker baking** — leaves the dominant Docker path
  needing a manual mount; baking into the image is what makes it frictionless.

**Tradeoff**: the Docker image grows by the web-client bundle and the hub
release pipeline gains a cross-repo Wavvon-web checkout (same pattern the
desktop release uses for i18n). The served client is pinned to the web-client
release current at the hub release cut; the floor is that the served client
never requires API surface newer than the hub shipping it. API 404 semantics
are preserved by serving the SPA fallback only to `Accept: text/html`
navigations.

## Demo Hub removed — discovery is the entry point for new users

**Decision**: the "Try a demo hub" button and `DEMO_HUB_URL` constant are
removed from all clients. There is no Wavvon-operated demo hub. New users
find entry points through the discovery site; communities that want to be
newcomer-friendly can tag themselves accordingly there.

**Why**: a Wavvon-operated hub is a service relationship — the project
would run infrastructure, make uptime commitments, and own a community
space. That directly contradicts the "we publish software, not services"
posture. The code was always a single constant and one conditional button;
a dead code path with no operational backing is worse than no path at all.

**What we ruled out**:

- **A community-volunteer "official demo hub"** — possible, but gives one
  community a privileged label the project can't sustain or control. A
  "newcomer-friendly" tag in discovery is the right shape.
- **Keeping the constant as `null`** — the feature was already half-dead.
  Removing the code removes the implication that someone will fill it in.

---

## Missions, sparks, and cosmetic catalog removed — Wavvon operates no monetization infrastructure

**Decision**: the missions system (sponsor-funded spark rewards), spark
balance, cosmetic catalog, and entitlement blobs are removed entirely from
all clients and from Wavvon-discovery. `MISSIONS_ENABLED`,
`MISSIONS_SERVICE_URL`, `MissionsSection`, `CosmeticsSection`, and all
related discovery API routes are deleted. Wavvon ships software only; it
operates no monetization service. Sustainability is an open question
handled by donations and community support, without building a revenue
mechanism into the protocol.

**Why**: missions required the project to permanently run a central service
— handling sponsor relationships, anti-fraud, PoW on claims, entitlement
signing. That is infrastructure debt that grows with adoption and assumes
the project always operates it. More importantly, it puts a sponsor
relationship structurally inside the software, even when well-scoped. The
sovereignty pitch is cleaner and more honest without it: Wavvon publishes
software, anyone can run it, no part of the software phones home to a
project-operated service.

**What we ruled out**:

- **Keeping missions behind `MISSIONS_ENABLED = false`** — dead code with
  a constant implies future intent. If the intent is gone, so is the code.
- **Farm hosting as a Wavvon revenue line** — anyone can operate a farm;
  the project publishing farm software is not the same as the project
  running a farm for money. If someone at Wavvon wants to run a commercial
  farm later, that is an independent business decision, not something baked
  into the software design.
- **A "supporter flair" cosmetic tied to donations** — tying any cosmetic
  to money reintroduces missions complexity at a smaller scale. Donations
  remain a simple link with no in-software perks.

**What's still open**: how the project sustains itself long-term. Donations
are the current answer. Other approaches (grants, commercial support,
community funding) can be explored without adding any code to the protocol.

---

## Observability: operator-scoped infrastructure metrics only — no PII in spans or metrics

**Decision**: Wavvon ships two observability surfaces for hub operators:
a Prometheus-compatible `GET /metrics` endpoint (aggregate counters —
uptime, DB size, active connections, message throughput) and optional
OTLP trace export via `WAVVON_OTLP_ENDPOINT`. Both are **infrastructure
observability tools for the hub operator**, not user analytics. The
hard rule: **no personally-identifiable information may appear in any
span, metric label, or structured log field**. Permitted: HTTP
method/route, status code, query latency, error type, aggregate counts.
Forbidden: user IDs, pubkeys, display names, channel names, message
content, DM participants, social graph edges, or any value that
identifies a specific user, conversation, or relationship.

**Why**: the metrics endpoint and OTLP export are opt-in, operator-run
surfaces — the hub admin points them at their own Grafana, Jaeger, or
Prometheus instance. But "operator-only" is not a sufficient privacy
guarantee on its own, because operators differ in trust level depending
on the hub, and the data shape matters regardless of who receives it.
An attribute like `user_id=<pubkey>` or `channel=general` appearing in
a span means a leaked trace file or a compromised monitoring stack
becomes a surveillance artifact. Keeping spans strictly technical
eliminates that class of risk entirely, with no loss of operational
value — latency, error rates, and throughput do not require identity.

**What we ruled out**:

- **Per-user request tracing** (attaching `user_pubkey` to spans for
  debugging auth flows). Rejected: the debug value can be achieved in
  a dev environment with a local trace sink and a test account; shipping
  it in the production path permanently associates identity with traffic
  patterns in the operator's monitoring store.
- **Message-count metrics labelled by channel** (`wavvon_messages_total{channel="general"}`).
  Rejected: channel names are community content, not infrastructure. The
  existing aggregate `wavvon_messages_total` counter carries no label.
- **Opt-in "detailed mode"** that unlocks PII labels when the operator
  enables it. Rejected: any opt-in expands the surface and the rule
  becomes "PII is ok in some deployments," which is the wrong invariant
  to hold over time. The technical spans are sufficient; detailed mode
  offers no observability benefit that can't be met without identity.

**Tradeoff**: a stripped span for a failed auth request contains the
error type but not the pubkey that failed. Debugging an auth bug in
production requires correlating with server logs, not just the trace.
We accept that because structured logs are the right tool for
per-request debugging and traces are the right tool for latency
profiling — the two should stay separate. Nothing in this decision
prevents operators from adding a non-PII correlation ID (a random
request ID) to both.

---

## Hub admin panel removed — hub management moves to desktop client

**Decision**: the web-based hub admin panel (`/admin/panel`) is removed
entirely. Hub management — banning users, managing roles, channels, and
reports — belongs in the desktop client, not a separate web UI. Hub ownership
is set at hub-creation time through the client wizard, so there is no
bootstrapping problem to solve.

**Why**: the hub panel duplicated what the desktop client already does or
should do. Adding a full Ed25519+TOTP web auth system to a panel that manages
things the client already handles is the wrong abstraction. One entry point for
hub management.

**What we ruled out**:

- **Web panel with static token auth** — already existed; removed for security.
- **Web panel with Ed25519+TOTP auth** — designed and built, then reverted
  because the underlying use case was wrong. Supersedes the entry below
  ("Admin panel auth: desktop-app signing + TOTP"); see
  [`admin-panel-auth.md`](admin-panel-auth.md) (now archived).

---

## Architecture: Farm → Server → Hub; standalone hub binary deprecated

**Decision**: the canonical deployment unit is Farm (control plane, manages
multiple servers) → Server (compute node, runs hub processes) → Hub (community
space, the product users experience). A hub is never run directly — it is
always started and managed by a server agent connected to a farm. Standalone
`wavvon-hub` binary usage is deprecated.

**Why**: the original "hub = server" assumption no longer holds. The farm needs
to manage geographically distributed servers. A standalone hub creates a
separate bootstrapping and management problem that complicates both the client
wizard and the farm's control surface.

**What we ruled out**:

- **Standalone hub with web-panel bootstrap** — the original approach; removed.
- **Hub binary as a first-class deployment target** — superseded by the
  server-agent-managed model.

---

## OAuth account linking — rejected as an auth mechanism; deferred as a social badge

**Decision**: OAuth login (Google, Steam, GitHub, etc.) will not be used as an
identity mechanism or recovery path in Wavvon.

**Why rejected for auth/recovery**: linking a Wavvon identity to a centralized
provider account means that if the provider bans the user, suspends the app, or
changes its API, the user loses Wavvon access too. This directly conflicts with
the "your hub can't take your identity" sovereignty pillar that justifies the
Ed25519 keypair model.

**Better path for the same UX problem** (the "I forgot my 24-word phrase" case):
encrypted-passphrase identity backup — the user picks a passphrase, the recovery
phrase is encrypted with it, and the result is stored wherever the user chooses
(their hub, a password manager, cloud storage). Gives the "login with passphrase"
feel without any third-party dependency. Design in
[`identity-recovery.md`](identity-recovery.md) — Part 1 (Backup / export).

**OAuth may still ship as**: a "verified badge" feature — "this Wavvon identity is
linked to my GitHub / Steam profile". That is metadata for social proof, not auth.
Tracked in [`future-features.md`](future-features.md).

**Alternative considered**: use OAuth only for first-time onboarding to smooth
key creation. Rejected: the keys the OAuth flow would create would still be tied
to the provider — losing the provider account loses the key. The recovery phrase
is a better first-time safety net and doesn't require any external account.

---

## Admin panel auth: desktop-app signing + TOTP, not a shared bearer token

**Decision**: the web admin surfaces (hub web panel, farm console) drop the
shared `web_admin_token` for a two-factor login tied to real identity. Factor
one is an Ed25519 challenge signed by the user's **desktop app** — the browser
shows a challenge, a `wavvon://sign-admin` deep link hands it to the Tauri app,
which confirms with a dialog and signs with the user's existing key
(`auth_creds.rs`), then POSTs the signature to the server's own
`/admin/auth/signed` endpoint (desktop→server, so no browser localhost listener
and no CORS). Factor two is RFC 6238 TOTP, secret stored server-side keyed by
canonical pubkey, with a QR enrollment on first login. A successful login mints
a short-lived, server-side, opaque cookie session (12h, instantly revocable) —
not a signed blob. The panel is **role-aware**: farm admin (`farms.admin_pubkey`)
gets the farm console, a hub admin (role with `admin` on that hub) gets that
hub's panel, multi-hub admins get a desktop-side picker. A signed, 8-hour
`admin_panel: true` farm token is the remote/headless fallback (still requires
TOTP). TOTP applies to the web panels only, never the desktop client. Full design
in [`admin-panel-auth.md`](admin-panel-auth.md).

**Alternatives considered**:

- **Keep the shared bearer `web_admin_token`** ([`hub-admin-panel.md`](hub-admin-panel.md)
  Feature 1). Rejected: a single secret with no identity behind it, no second
  factor, and no link to the role system; a leak grants full admin with nothing
  to revoke per-person. This entry supersedes that flow.
- **Sign in the browser** (import the key into the page / WebCrypto). Rejected:
  the private key must never enter the browser. Keeping the desktop app as the
  signer matches the rest of Wavvon's auth and behaves like a hardware key.
- **A browser localhost callback server** for the signature. Rejected: it
  reintroduces the CORS/preflight problem and an open local port. Routing the
  signature desktop→server over HTTPS avoids both — the browser only ever talks
  same-origin and polls for completion.
- **A farm-level `hub_admin_grants` table** to centralize who admins which hub.
  Rejected: hub-admin authority is community-axis and already lives in each hub's
  `user_roles`. A farm-side grant store would put a community decision on the
  hosting layer, violating the two-axis rule ([`home-hub.md`](home-hub.md)). Hub
  admin is managed per-hub; the multi-hub picker is client-side convenience.

**Tradeoff**: the flow needs the desktop app installed and adds a browser
poll-for-callback round trip, which is more moving parts than pasting a token.
We accept that because it buys real identity (the same key the user already
holds), a true second factor, instant per-person revocation, and reuse of the
existing role and `admin_pubkey` authorization — and the remote-token fallback
covers the headless case for operators without the desktop app on the box.

---

## Custom themes: CSS design tokens, not CSS injection; personal-axis, file-portable

**Decision**: user-created skins expose a curated set of CSS custom properties
(surfaces, text, accent, status, borders, effects, shadows, one radius scale knob)
as a JSON `.wavvonskin` file with a `base` fallback theme and a `tokens` override
map. The active skin is applied via `element.style.setProperty()` on
`document.documentElement`; a `[data-theme="custom"]` block in `styles.css` holds
the base fallback. The skin is stored in `~/.wavvon/appearance.json` (desktop/android)
or `localStorage` (web) using the same `#[serde(default)]` pattern as `voice.json`.
The existing four-theme picker gains a fifth "Custom" card that shows the skin name
and three swatches when a skin is active. Full design in
[`custom-themes.md`](custom-themes.md).

**Alternatives considered**:

- **Arbitrary CSS injection** (a raw textarea the user types CSS into). Rejected:
  a shared `.wavvonskin` file becomes an attack vector (`url()` for external
  fetches, `;`/`}` to break out of declarations, `expression()` in older engines).
  Even locally, an accidental layout breakage is unrecoverable without a "reset all."
  A validated token allowlist is the correct blast radius.
- **Full CSS custom property surface** (every `--r-*`, `--space-*`, `--text-*` token
  exposed). Rejected: spacing and type-scale tokens are load-bearing for layout and
  are not theme-specific — the built-in themes don't touch them. Exposing them means
  a skin can overflow text, collapse panels, or break grid math. Only the tokens the
  built-in themes actually override are skinnable.
- **Theme stored entirely in the profile file** (alongside the theme selection today).
  Rejected: the profile is the identity/hub-membership document, not a settings bag.
  The `voice.json` sidecar pattern is the established precedent for audio settings;
  `appearance.json` follows the same shape and will migrate cleanly into the personal
  prefs blob when home hubs land.
- **Hub-level themes as the first skin feature.** Rejected for v1: community-axis
  operator branding is a separate design problem — it requires hub DB storage,
  federation of the token blob, operator permissions, and a "user opt-out" story.
  Personal skins have none of those dependencies and deliver user value sooner.

**Tradeoff**: the `base` + sparse overrides model means a skin file is tiny and
forward-compatible (new tokens just inherit from `base`), but it means a skin and its
base theme are coupled — if the base theme's values change in a future release, the
skin's unset tokens change with them. We accept that because the alternative
(snapshotting all token values into every skin file) makes files verbose, breaks when
token names change, and loses the benefit of upstream theme improvements. The skin
author sets only what they want to differ; the theme maintainer owns the rest.

---

## Database abstraction: trait-based store crate split, not inline raw SQLx

**Decision**: the hub's data layer will move from a bare `sqlx::SqlitePool` embedded directly in `AppState` and raw `sqlx::query*` calls scattered across every route handler, to a set of domain-split traits (`AuthStore`, `UserStore`, `ChannelStore`, `MessageStore`, `RoleStore`, `InviteStore`, `ModerationStore`, `SettingsStore`, and more) collected into a `HubStore` super-trait, implemented by `wavvon-store-sqlite` (the current code, moved) and eventually `wavvon-store-postgres` (community contribution). `AppState.db: SqlitePool` becomes `AppState.store: Arc<dyn HubStore>`. A `StoreError` enum (`NotFound`, `Conflict`, `PermissionDenied`, `Internal`) replaces per-route ad-hoc `.map_err()` and `"UNIQUE"` string-sniffing. `#[async_trait]` is the dispatch mechanism. Transaction scope is managed by a `with_transaction<F, T>` closure. Migration contract: each backend owns its schema via a `Migrate` trait; the hub calls `store.run_migrations()` on startup. Full design in [`store-trait-design.md`](store-trait-design.md).

**Alternatives considered**:

- **Keep the current raw-SQLx approach indefinitely.** Rejected: it makes every handler a database-backend coupling point. Swapping the database means touching every route file, and error normalization requires ad-hoc per-handler decisions. The current design accidentally bakes SQLite's FTS5 and UNIQUE-conflict message text into the application layer.
- **One God trait `HubStore` with all methods.** Rejected: a single 100-method trait is unimplementable in pieces — the compiler demands all methods at once, so a backend author can't work domain by domain. Domain-split traits with a blanket super-trait impl give a seam per domain.
- **An explicit `Transaction<'conn>` object** (begin/commit/rollback). Rejected: the lifetime of a SQLite transaction handle (`&mut Connection`) differs from Postgres's pooled `Transaction<'c>`, so abstracting it leaks backend types. The closure form (`with_transaction<F, T>`) keeps the transaction type private to each backend.
- **Feature-flag the backend at compile time** (one `Cargo.toml` feature, conditional impls). Rejected: forces recompilation to switch backends and cannot support runtime selection (an operator editing `hub.toml` without recompiling). `Arc<dyn HubStore>` supports runtime selection by `database_url` prefix.
- **Move to `sea-orm` or `diesel` with their own abstraction layers.** Rejected: both introduce significant LoC overhead and ORM conventions that fight the existing `sqlx` query patterns. The trait layer is thinner and lets each backend stay idiomatic to its own engine.

**Tradeoff**: `Arc<dyn HubStore>` with `#[async_trait]` adds one heap allocation (a boxed `Pin<Box<dyn Future>>`) per database call — negligible against any real IO round-trip. The `with_transaction` closure pattern is awkward when callers need to branch on intermediate results inside a transaction; those flows must be written as linear closures. Both costs are accepted: allocation is noise; transaction shape discipline is necessary regardless of the abstraction.

**Status**: shipped (2026-06-27). The `store` crate implements all `HubStore` sub-traits with a PostgreSQL backend. The `wavvon-store-sqlite` intermediate step was skipped; PostgreSQL landed directly as the canonical backend. SQLite was removed from the workspace entirely.

---

Older entries (everything from "Discovery v2" back to the founding
"No proof-of-work yet" entry) are relocated verbatim to
[decisions-archive.md](decisions-archive.md).
