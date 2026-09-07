# Hub Operator Guide

Practical reference for **operating** a Wavvon hub that's already running:
configuration, ownership, backup/restore, upgrades, hardening, and
observability. For how to **deploy** one in the first place (Docker
Compose + Caddy, Docker behind an existing proxy, bare binary + systemd,
build from source — with TLS, firewall, and web-client serving per
method), see [hosting.md](hosting.md). For architecture background, see
[architecture.md](architecture.md) and [threat-model.md](threat-model.md).

---

## Configuration

The hub reads configuration from three sources, in priority order (highest last):

1. **Built-in defaults** — sensible values that work out of the box.
2. **`hub.toml`** — a TOML file in the working directory. Copy `hub.toml.example` (shipped with the binary) and edit it. The file is optional; missing it is fine.
3. **`WAVVON_*` environment variables** — override anything in the file. Useful for Docker / Kubernetes where env injection is the norm.

### hub.toml quick reference

```toml
http_port       = 3000           # HTTP / WebSocket port
voice_udp_port  = 3001           # Voice UDP relay port

# tls_cert = "/etc/wavvon/hub.crt"   # enable HTTPS (both must be set)
# tls_key  = "/etc/wavvon/hub.key"

owner_pubkey    = "<64-hex>"     # hub owner identity (set before first boot)
# farm_url      = "https://farm.example.com"

discovery_url   = "https://discovery.wavvon.io"
# template_url  = "https://example.com/template.json"
# bootstrap_token = ""

log_format      = "text"         # "text" or "json"
# otlp_endpoint = "http://localhost:4317"
```

Every option also has a `WAVVON_<OPTION_NAME>` env var equivalent (e.g. `WAVVON_HTTP_PORT`, `WAVVON_TLS_CERT`). `wavvon-hub --help` prints the full table generated directly from the binary — treat it as authoritative.

The hub binds to `0.0.0.0` on both ports. `hub_identity.json` is written to the process working directory; set `WorkingDirectory=` in your service unit to control where it lands. The database is PostgreSQL — configure with `WAVVON_DATABASE_URL`.

### Database connection pool

`WAVVON_DB_MAX_CONNECTIONS` (default `5`, also `db_max_connections` in
`hub.toml`) sizes the PostgreSQL connection pool, for the primary and the
read replica alike.

It caps **concurrent database work, not concurrent users**. A connection is
borrowed for the length of a single query and returned immediately —
WebSockets, voice sessions and idle members hold none — so a small pool
serves far more members than the number suggests. Raise it when requests
start queueing: the symptom is `PoolTimedOut` in the hub log after ~30s,
under load rather than at startup.

The ceiling is PostgreSQL's own `max_connections` (default `100`). Count
every client of that server — each hub, the farm, plus a few for `psql` and
backups — and keep the total underneath it, or connections get refused
outright. Several hubs on one PostgreSQL server is the case to watch: five
hubs at the default already reach 25.

### The bundled PostgreSQL needs glibc

Leaving `WAVVON_DATABASE_URL` unset makes the hub start and manage its own
PostgreSQL, and that works on Windows and on any glibc Linux — including the
`ghcr.io/wavvon/hub` image, which is Debian. It does **not** work on a
musl-only system such as Alpine: the PostgreSQL binaries for that target are
not self-contained, they need `libicuuc.so.74` and krb5, and no current Alpine
ships ICU at that version. The static `wavvon-hub-linux-x86_64` and
`wavvon-hub-linux-aarch64` binaries from a release are musl builds, so on those
point `WAVVON_DATABASE_URL` at a PostgreSQL you provide. A database you built
is never touched by bundled mode, which is the whole rule that path follows.

You are told this before it costs you anything. A musl build **refuses bundled
mode up front** — it does not download an archive, create a data directory or
reach `initdb` — and `wavvon-hub --doctor` reports it as a FAIL with the same
sentence, so a pre-flight check catches it rather than a first boot. If you
want the bundled database on x86_64 Linux, take
**`wavvon-hub-linux-x86_64-glibc`** from the same release instead.

### CORS

The REST API ships with CORS fully open (`*`) by default. This is safe: every protected endpoint requires a bearer token and there is no cookie-based credential, so there is no CSRF surface. Any origin can read public data or authenticate with its own keypair.

To restrict origins (tightly-controlled deployments only):

```
WAVVON_CORS_ORIGINS=https://app.example.com,https://dashboard.example.com
```

If you restrict origins, add the serving origin of any browser client (including a hub that self-serves the web client) to the list. WebSocket connections (`/ws`) are not subject to CORS.

**A farm has the same setting, and it is not optional to think about.** A farm-hosted hub is reached through the farm proxy, and its `/info.farm_url` tells clients to send `/auth/*` to the farm itself — so a browser talks to both. `WAVVON_CORS_ORIGINS` on the farm covers the farm own routes (the proxy passes the hub headers through, and a second set would be a duplicate a browser rejects). It defaults to `*` there too; a farm that restricts origins and forgets the client origin refuses every join, and the client shows only "could not reach".

---

## Hub ownership

On a fresh hub **no owner is set by default**. You must assign one before opening the hub to users, otherwise nobody has admin access.

**Before first boot (recommended):**
```toml
# hub.toml
owner_pubkey = "<your-64-char-ed25519-pubkey>"
```

**After first boot (CLI):**
```bash
wavvon-hub admin users set-owner <pubkey>
```

**After first boot (web panel):**  
Visit `http://your-server:3000/admin/panel` → Ownership tab.  
Activate the panel first: `wavvon-hub admin rotate-admin-token`

Your public key is shown in the desktop client's identity / profile panel.

---

## First-run bootstrap

On an empty database, the hub runs all migrations automatically.

To pre-configure a hub for unattended deployment, point it at a bootstrap
document: `template_url` in `hub.toml` (or `WAVVON_TEMPLATE_URL`) for a plain
HTTP(S) fetch, `template_file` (or `WAVVON_TEMPLATE_FILE`) for a local file, or
`template` (or `WAVVON_TEMPLATE`) for a built-in preset — `gaming`,
`community` or `minimal`. The hub applies the first one that resolves on its
first run and creates channels, roles and settings from it. All three are
documents you supply; there is no catalogue to authenticate against.
[hub-creation-wizard.md](hub-creation-wizard.md) is superseded but still
carries the template schema.

---

## Backup and restore

A hub is three things, and `wavvon-hub backup` puts all three in one file:

| What | Contents | In the archive as |
|------|----------|-------------------|
| PostgreSQL database | All community data (messages, roles, certs, sessions, …) | `database.dump` |
| `hub_identity.json` | Hub Ed25519 key pair | `hub_identity.json` |
| Uploads directory | Attachments (`WAVVON_UPLOADS_DIR`, default `./uploads/`) | `uploads/` |

The Tantivy search index is deliberately **not** included — it is derived
from the messages table. Rebuild it after a restore with `POST
/admin/search/reindex` (or leave it; the hub builds it as it goes).

> `hub_identity.json` is the one thing no amount of data recovers. Whoever
> holds it can impersonate your hub to federation peers, and losing it means
> the hub comes back as a *different* hub. Keep a copy off-box.

**Backup** — safe while the hub is running:

```bash
wavvon-hub backup /backup/hub-$(date +%F).tar.gz
```

**Restore** — into an **empty** database:

```bash
# 1. Stop the hub.
# 2. Point WAVVON_DATABASE_URL at an empty database (or drop and recreate it).
wavvon-hub restore /backup/hub-2026-08-09.tar.gz
# 3. Start the hub. Migrations run on startup as usual.
```

Restore refuses rather than half-writing:

- **Destination not empty** → refuses. Restoring over an existing hub would
  merge two communities into one. `--force` overrides, if that is genuinely
  what you meant.
- **Destination PostgreSQL older than the source's major** → refuses, and
  says both versions. A dump restores into an equal or newer major only.
  This one is not overridable: past it `pg_restore` cannot parse the archive.
- **Row counts do not match afterwards** → reports which tables are short and
  tells you not to start the hub against that database.

**Requirement**: `backup` and `restore` shell out to `pg_dump` /
`pg_restore`. Running the hub's **built-in** PostgreSQL (no
`WAVVON_DATABASE_URL`)? Then there is nothing to install — the hub points them
at the copies it carries. Otherwise they come from the official Docker image,
or from `apt install postgresql-client` (or equivalent) on a bare-binary
install, or from wherever `WAVVON_PG_BIN_DIR` points.

---

## Moving the database

`db move` copies a hub's database from one PostgreSQL to another. It is the
command for adopting your own server, or for giving one up and letting the hub
run its built-in one.

```bash
# From this hub's current database into your own PostgreSQL:
wavvon-hub db move --to postgres://wavvon:secret@db.internal:5432/wavvon

# The other direction — pull an existing database into this hub's:
wavvon-hub db move --from postgres://wavvon:secret@db.internal:5432/wavvon
```

The URL is always the **other** database; this hub's own comes from
`WAVVON_DATABASE_URL`, or from its built-in server when that is unset.

**It copies and stops.** Nothing switches over: when the move reports success,
set (or unset) `WAVVON_DATABASE_URL` and restart the hub. The source is left
exactly as it was, so a destination that misbehaves is undone by putting the
variable back.

It refuses for the same reasons `restore` does — a destination that already
has tables (`--force` if you meant it), a destination on an older PostgreSQL
major, and row counts that do not match afterwards. The version rule is worth
reading twice here: a dump restores into an equal or **newer** major only, and
the built-in PostgreSQL follows upstream, so it is usually the newer side.
Moving *to* the PostgreSQL your distribution ships is the direction most likely
to be refused.

Database only. `hub_identity.json` and the uploads directory are files on the
machine and do not travel with a database — `backup` is the command that takes
all three.

---

## Upgrade path

1. **Take a backup** — `wavvon-hub backup /backup/pre-upgrade.tar.gz`. This
   is the supported way back; see Rollback below.
2. Stop the current hub process.
3. Replace the binary with the new version.
4. Start the hub. New migrations run automatically on startup.

Wavvon uses additive migrations only — there are no destructive schema
changes in minor/patch upgrades. If a migration fails (e.g., disk full),
the hub exits and the database is left untouched.

### When the upgrade also carries a PostgreSQL major

Only applies to the **built-in** PostgreSQL. The bundled server follows
upstream rather than being pinned, so a hub release may carry a newer major
than the one that wrote your data directory — and PostgreSQL refuses to read
an older data directory by design.

The hub refuses too, at startup, before touching anything, and prints the two
commands. They are the same ones above:

```bash
# With the PREVIOUS hub binary — it has the PostgreSQL that can read the data:
wavvon-hub backup /backup/pre-pg-upgrade.tar.gz

# Then with the new binary, after moving the old data directory aside:
mv pgdata pgdata.old
wavvon-hub restore /backup/pre-pg-upgrade.tar.gz
```

Keep `pgdata.old` until the hub has been running on the new one for a while.
The previous major's binaries are still in `pg/<version>/` — the hub never
deletes them, because they are the only thing that can read that directory.

An **older** hub binary against a **newer** data directory is refused with a
different message, and it means the binary is the wrong one, not the database.

### Rollback

**The schema is safe to downgrade. The data is not guaranteed to be.**

Schema side: migrations only add tables and columns, and every added column
that is `NOT NULL` carries a `DEFAULT` — enforced by a test, not a habit. So
an older binary, which does not know the new columns and omits them from its
inserts, keeps reading and writing a newer schema without error. Reinstall
the previous version and start it; nothing needs undoing.

Data side: no such guarantee, and this is where a rollback actually bites. In
the window before you downgraded, the newer binary may have written data the
older one has no code for — a channel of a type it does not recognise, a
field it will not read, an envelope version it cannot verify. That data does
not disappear, but the old binary may ignore it, render it wrong, or reject
it. Nothing checks this, and no downgrade has been driven end to end.

So the supported rollback is: **restore the backup you took before the
upgrade, then run the old binary against it.** That is exact, and it is why
step 1 above is step 1.

If you did not take one, running the old binary against the current database
is very likely fine and is not something we test. Take the backup.

> **One-time exception — upgrading to v0.3.0**: the schema baseline was
> reset pre-production ([decisions.md](decisions.md)). Databases created
> by hubs **older than 0.3.0** cannot upgrade in place: drop the
> database, start the new binary, and re-run first setup (`wavvon-hub
> setup`). `pg_dump` archives
> from pre-0.3.0 hubs restore only onto pre-0.3.0 binaries. From 0.3.0
> onward the additive in-place upgrade path above applies again.

---

## Basic hardening checklist

- [ ] **TLS**: terminate TLS at the hub (via `WAVVON_TLS_CERT` / `WAVVON_TLS_KEY`)
  or at a reverse proxy (nginx/Caddy). Never expose HTTP to the public internet.
- [ ] **Firewall**: allow only ports 443 (HTTPS) and `WAVVON_VOICE_UDP_PORT`
  (UDP). No SSH from the internet.
- [ ] **Service user**: run the hub as a dedicated non-root user.
  `hub_identity.json` must be readable only by that user (`chmod 600`).
- [ ] **Backups**: schedule daily `wavvon-hub backup FILE` + an off-site copy of
  `hub_identity.json`. (This line used to name a `sqlite3` command; SQLite has
  never been a backend of this hub — see `decisions.md`, 2026-08-08 — and
  `backup` goes through PostgreSQL's own `pg_dump`, bundled or not.)
- [ ] **Auth rate limiting**: automatic, per IP, and a **token bucket** rather
  than a fixed window: `WAVVON_AUTH_RATE_BURST` tokens (default 10) refilling
  `WAVVON_AUTH_RATE_PER_SEC` per second (default 1). One login spends **two**
  tokens — `/auth/challenge` then `/auth/verify` — so the default admits a
  crowd of five arriving at once and one login every two seconds after that.
  **Raise both if your members share an address** (an office, a school, a
  campus, CGNAT): the limiter cannot tell them apart, and to someone who is
  rate-limited the hub looks like one that will not have them. For additional
  protection put a WAF in front (Cloudflare, or rate-limit at nginx).
- [ ] **Approval gate**: consider enabling *require approval* in Hub Settings
  so new members are vetted before joining a community hub.
- [ ] **PoW level**: set a minimum proof-of-work level (Hub Settings → Auth)
  for open hubs to deter spam registrations.
- [ ] **Monitoring**: `GET /health` returns `{"status":"ok","version":"...","uptime_seconds":...,"db_status":"ok"}`.
  Point your uptime checker at it.

---

## Health check

```
GET /health
```

Returns:

```json
{
  "status": "ok",
  "version": "0.2.0",
  "uptime_seconds": 86400,
  "db_status": "ok"
}
```

`db_status` is `"ok"` when a `SELECT 1` probe against the pool succeeds,
`"error"` otherwise.

---

## Hub admin CLI

```bash
# Create an invitation link (bypasses approval gate)
wavvon-hub admin invite --expires 24h

# Revoke a session by token
wavvon-hub admin revoke-session <token>

# Promote a user to Owner
wavvon-hub admin grant-role <pubkey> builtin-owner

# Key rotation (updates hub_identity.json and publishes /key-rotation)
wavvon-hub rotate-key
```

For the full admin CLI reference, see [hub-admin-panel.md](hub-admin-panel.md).

---

## Observability

Prometheus-compatible metrics are exposed at `GET /metrics` (text format).
Key metrics:

| Metric | What it measures |
|--------|-----------------|
| `hub_active_ws_connections` | WebSocket connections right now |
| `hub_messages_total` | Chat messages sent (counter) |
| `hub_auth_attempts_total` | Auth verifications (labelled `ok`/`failed`) |
| `hub_voice_participants` | UDP voice relay participants right now |
| `hub_db_query_duration_seconds` | SQLite query latency histogram |

Logs are emitted in JSON to stdout (structured, `tracing`-based). Pipe to
`journald`, Loki, or any JSON log aggregator.
