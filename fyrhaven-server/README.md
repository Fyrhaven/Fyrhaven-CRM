# Fyrhaven record server — self-hosted

The service the Contact Manager plugin's **record** stores live on (#68).

A record the plugin invents — a project, a private note, a consent record, the
change history, a saved search — cannot live in a browser (change device and it
is unreachable, clear site data and it is gone) and the Stalwart host has nowhere
to put it. So it lives here.

One small service in front of a SQLite file, speaking the four calls the plugin
already makes. **No dependencies**: `node:http` and `node:sqlite` are in the
runtime, so the image is the runtime plus four files, and there is no lockfile to
audit.

**This is not the cloud service.** The shop, the customer accounts, the
catalogue, billing and the operator panel are not in this folder and not in this
repository: they live in
[`Fyrhaven/Fyrhaven-CRM-Cloud`](https://github.com/Fyrhaven/Fyrhaven-CRM-Cloud)
and are never distributed. There is no mode flag here either — the customer's
copy cannot be turned into the operator's service by editing a compose file.

---

## Run it

```bash
cp env.example .env       # then fill in the four values
docker compose up -d
curl -s https://crm.example.com/version
```

Caddy gets a certificate for `CRM_DOMAIN` automatically. The server is **not
published** — only Caddy can reach it — so TLS is not something you can forget.

**If you already run a reverse proxy** (nginx-proxy-manager, Traefik, a Caddy
elsewhere), use the other compose file instead of the one above — it is the same
service without its own edge:

```bash
docker compose -f docker-compose.host.yml up -d    # add PROXY_NETWORK=… if the proxy lives on another network
```

Nothing is published then; the server joins the proxy's network as
`fyrhaven-server` and answers on port `8080`, so the proxy host you add for it is
the only way in and TLS stays where it already is.

It **refuses to start** without `STORE_TOKENS`, `STORE_MASTER_KEY` or a valid
`FYRHAVEN_LICENCE`: an open store, one whose data cannot be encrypted, or an
unlicensed install is worse than a container that will not come up.

| Variable | Default | Meaning |
|---|---|---|
| `STORE_TOKENS` | *(required)* | `token=workspace,token=workspace`. A token written alone is its own workspace. This is the "workspace token" the plugin stores. |
| `STORE_MASTER_KEY` | *(required)* | 32 bytes, base64. Wraps every workspace's data key. **Lose it and the data is unreadable.** |
| `FYRHAVEN_LICENCE` | *(required)* | The key Fyrhaven signed for this installation. Verified **offline**. |
| `CRM_DOMAIN` | *(required with the bundled Caddy)* | The public hostname Caddy gets a certificate for. |
| `PORT` | `8080` | What the server listens on, inside the network. |
| `STORE_DB` | `/data/store.sqlite` | The SQLite file. Put it on a volume. |
| `STORE_ADMIN_TOKEN` | *(unset)* | Enables `/v1/admin` — the storage controls below. Off when empty: those routes answer `503`. |
| `ALLOW_QUERY_TOKEN` | *(unset)* | `1` accepts `?token=` as well as the header. Off because a token in a URL leaks into logs. |
| `STORE_AUTH_USER` / `STORE_AUTH_PASSWORD` | *(unset)* | Protect the whole server with HTTP Basic, checked only when both are set. |
| `FYRHAVEN_LICENCE_PUBLIC` | the built-in key | Override the public key a licence is checked against (a test or a private deployment). |
| `FYRHAVEN_ACTIVATION` | *(unset)* | `online` fetches a licence for this installation instead of pasting one; `FYRHAVEN_ACTIVATION_URL` and `FYRHAVEN_ACTIVATION_TOKEN` say where. |
| `FYRHAVEN_INSTALL_KEY_FILE` | `/data/install.key` | The installation key this licence is bound to. Kept on the volume — a recreated container must keep it. |
| `R2_S3_API` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | *(unset)* | An S3-compatible bucket for a workspace's bytes. All three, or blob storage stays off. |

```bash
npm test     # node --test, 50 tests, no dependencies
npm start    # node server.js
```

## The licence

A self-hosted install refuses to start without a key Fyrhaven signed **for this
installation**, and the check is offline — the server never calls home. The
installation key is printed at startup (`FHI-…`), and it is what the licence is
bound to, so a key issued for one machine does not open another.

Why a licence at all, and what it does *not* enforce: [`LICENSING.md`](LICENSING.md).
The short version is that it is a contract with honest customers, not DRM —
removing it takes patching the source, not a setting.

## Security: what this protects, and what it does not

**In transit.** TLS at the edge with an automatic certificate, HSTS,
`nosniff`, `no-referrer` and `no-store` — and the server itself is never
published, so there is no plaintext hop to reach it by.

**At rest.** Every value is sealed with its **workspace's own 256-bit key**
(AES-256-GCM, a fresh IV per write), and that key is stored **wrapped** by the
master key, which lives in the environment and never in the database. A stolen
database file, volume or backup is opaque: `server.test.js` writes a marker
through the API and asserts the bytes on disk do not contain it. A row that will
not open — the wrong master key, or a tampered file — fails loudly rather than
serving a hole in the data.

**Tokens.** Compared in constant time, so a token cannot be discovered a byte at
a time; a token is a workspace, so one customer can never reach another's rows;
and `?token=` is refused unless explicitly enabled.

### What it does **not** do

**Whoever operates this service can read the data.** The running server must
unwrap a workspace's key in order to serve it, so the operator — and anyone who
has both the database and the master key — can read every record. That is the
price of a server-held key, and it is stated here rather than implied away.

If the data must be unreadable by the operator, the key has to be held by the
user instead — a passphrase only they have. Issue
[#68](https://github.com/Fyrhaven/Fyrhaven-CRM/issues/68) carries that design and
the host change it needs.

**What is visible even so:** the *shape* of the data — which workspace, which
store keys exist (`projects`, `contactNotes`, …), how many records, their sizes
and timestamps. Not their contents.

**And what no server can protect:** a compromised browser, a keylogger, or a
malicious plugin update. Encryption protects data at rest and in transit; it does
not protect a machine that is already owned.

## The protocol

`/health` and `/version` are **open** — the plugin's *Check the server* has to
answer before a credential is configured, and neither reveals more than a version
string. Everything under `/v1/store` needs a token, as
`Authorization: Bearer <token>` or `?token=<token>` (for a host that cannot set a
header).

```
GET    /health          -> { ok: true, version }
GET    /version         -> { ok: true, version }

GET    /v1/store        -> { records: { key: value, … }, revision }
GET    /v1/store/{key}  -> { key, value, revision } | 404
PUT    /v1/store/{key}  <- { value } -> { revision }
DELETE /v1/store/{key}  -> { ok: true }

GET    /v1/licence              -> { ok, mode, fingerprint, licensed, summary }
POST   /v1/licence              <- { licence } -> checks it, writes /data/licence.key
POST   /v1/licence/challenge    -> { challenge, fingerprint }
POST   /v1/licence/deactivate   <- { code }    -> { deactivated: true }
```

The licence routes are the server's own state — one key per installation, so they
are not scoped to a workspace, but they do need a token like everything else.

`?scope=` narrows within a workspace (default `default`). It is the seam the team
features (#23/#24) will widen — **it is not a security boundary**: the token is.

`revision` is a counter bumped by every write, so a client can tell "something
changed" without diffing, and a later sync can ask for everything above the
revision it last saw. A workspace on blob storage keeps its own counter, seeded
with the global one when it moves, so the number a client holds never goes
backwards.

A key is a slug (`A-Za-z0-9._-`, ≤ 64 chars) and a value is any JSON up to 1 MiB.

## Where a workspace's bytes live (#158)

The bytes are either in the SQLite file (`sqlite`, the default) or in an S3
bucket (`s3`: Cloudflare R2, B2, Wasabi, MinIO — anything that speaks Signature
V4). The **value is sealed before it reaches either**, so a leaked bucket is
opaque without `STORE_MASTER_KEY`: the envelope moves, the encryption does not.

These two routes are the one operator surface left in this build. They need
`STORE_ADMIN_TOKEN` — `503` while it is unset, `401` without it:

```
GET  /v1/admin/workspaces/{id}/storage  -> { provider, available, reachable, objects, bytes }
POST /v1/admin/workspaces/{id}/migrate  <- { provider }   (+ ?dry=1 to only report)
```

The migration is the only operation here that can lose data, so its order is
fixed and enforced in `storage.js`, not in a route:

1. read every record of **every scope** from the source backend
2. write each to the target, then **read it back and compare the sha256** of the
   sealed text. Any mismatch → remove what this run wrote, flip nothing
3. only when every object round-trips: flip `workspace_storage.provider`
4. only then: remove the source copies

A failure at step 2 or 3 leaves the workspace **exactly as it was** — the
provider stays `sqlite` and every original record is still there. `?dry=1`
reports what would move.

A workspace recorded on a provider this process cannot reach answers **503**
(`this workspace lives on s3, which is not configured on this server`) rather
than an empty record list: an empty answer would look like an empty address book
and invite the user to "restore" over their own data.

Object layout is `<workspace>/<scope>/<key>.json`. Moving a workspace back to
`sqlite` is the same call with `{"provider":"sqlite"}`, and it is the same code
path, so the disaster-recovery case (point a workspace at a fresh bucket) is
exercised by the same tests.

The variables must be in the compose **`environment:` block**, not only in
`.env` — a variable that is in `.env` but not in the block never reaches the
container.

## Pointing the plugin at it

The plugin reaches this through the webmail host's `http:proxy`, so **no secret
ships in the plugin ZIP**: the host holds the credential and injects it.

1. In Bulwark, grant the plugin `http:proxy` and create a credential whose value
   is the workspace token.
2. In the plugin, *Dedicated server → my own server* → set the URL
   (e.g. `https://crm.example`).
3. The server answers `/version`; the record stores then read and write here.

Put it behind TLS. The plugin will only talk HTTPS in practice, and a token over
plain HTTP is a token given away.

## Backup

It is one SQLite file. Copy the file, or use `sqlite3 store.sqlite ".backup
out.sqlite"` from the host. WAL mode is on, so include the `-wal` and `-shm`
files in a plain copy. Keep `/data/install.key` too: it is what a licence is
bound to, and losing it means asking for a new licence.

## What is deliberately not here

- **Accounts, login, billing, entitlement, the shop, the panel.** Those are the
  cloud service, in `Fyrhaven/Fyrhaven-CRM-Cloud`. A token is a workspace; who
  is allowed to have one is decided by whoever runs this server.
- **A route that deletes a whole workspace.** Records are deleted one key at a
  time through the protocol; erasing a workspace is dropping its rows (or the
  database).
- **Team features.** `scope` is in the schema, but roles, sharing and a review
  queue (#23/#24) are not built.
- **A scheduler.** #5's scans still run only while the webmail is open.

## Working on it

The repository used to build two artifacts from one tree, one of them with the
cloud replaced by stubs. It does not any more: the cloud has its own repository,
so what is here **is** the self-hosted server and there is nothing to stub out.

`server.js`, `storage.js`, `s3.js` and `licence.js` exist in both repositories and
are kept in step by hand. **A change to the record API is two commits**, one in
each repository; the shared files should differ only in the cloud's plugin
points.

```bash
node --test          # the suite: routing, auth, encryption, the licence, the seam
npm run package      # dist/fyrhaven-server-<version>.tar.gz — what a customer unpacks
npm run release      # test, package, tag fyrhaven-server-vX.Y.Z, attach the archive
```

The version the server reports is `package.json`'s, and `server.test.js` pins it
to `GET /version` so it cannot drift.

**The archive is the deliverable.** `scripts/package.mjs` copies the twelve files
a customer needs — the four modules, `package.json`, the changelog, the two
docs, the Dockerfile, both compose files, the Caddyfile and `env.example` — and
refuses to build if a cloud module is in the tree. A `BUILD` file travels inside
it with the version, the commit and which build it is, so "what did I download?"
is answerable without the file name. `npm run release` attaches that archive to
the GitHub release, so the download is the code in the repository.

A release is cut from `main` with a clean tree, and the first `## [x.y.z]`
section of `CHANGELOG.md` is its release note; the script refuses if the tag or
the section is missing.

## Licence

Same position as the plugin — see `fyrhaven-crm/README.md` §12. No `LICENSE`
file is committed yet, and the terms are the maintainer's to set.
