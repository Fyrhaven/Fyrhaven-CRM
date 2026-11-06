# Contact Manager cloud store

The service the Contact Manager plugin's **record** stores live on (#68).

A record the plugin invents — a project, a private note, a consent record, the
change history, a saved search — cannot live in a browser (change device and it
is unreachable, clear site data and it is gone) and the Stalwart host has nowhere
to put it. So it lives here.

One small service in front of a SQLite file, speaking the four calls the plugin
already makes. **No dependencies**: `node:http` and `node:sqlite` are in the
runtime, so the image is the runtime plus one file, and there is no lockfile to
audit.

---

## Run it

```bash
cat > .env <<EOF
CRM_DOMAIN=crm.example.com
STORE_TOKENS=$(openssl rand -hex 32)=acme
STORE_MASTER_KEY=$(openssl rand -base64 32)
EOF
docker compose up -d
curl -s https://crm.example.com/version
```

Caddy gets a certificate for `CRM_DOMAIN` automatically. The store is **not
published** — only Caddy can reach it — so TLS is not something you can forget.

**If you already run a reverse proxy** (nginx-proxy-manager, Traefik, a Caddy
elsewhere), use the other compose file instead of the one above — it is the same
service without its own edge:

```bash
docker compose -f docker-compose.host.yml up -d    # add PROXY_NETWORK=… if the proxy lives on another network
```

Nothing is published then; the store joins the proxy's network as
`contact-manager-store` and answers on port `8080`, so the proxy host you add for
it is the only way in and TLS stays where it already is.

It **refuses to start** without `STORE_TOKENS` or `STORE_MASTER_KEY`: an open
store, or one whose data cannot be encrypted, is worse than a container that will
not come up.

| Variable | Default | Meaning |
|---|---|---|
| `STORE_TOKENS` | *(required)* | `token=workspace,token=workspace`. A token written alone is its own workspace. |
| `STORE_MASTER_KEY` | *(required)* | 32 bytes, base64. Wraps every workspace's data key. **Lose it and the data is unreadable.** |
| `CRM_DOMAIN` | *(required)* | The public hostname Caddy gets a certificate for. |
| `PORT` | `8080` | What the store listens on, inside the network. |
| `STORE_DB` | `/data/store.sqlite` | The SQLite file. Put it on a volume. |
| `STORE_TRIAL_DAYS` | `14` | Days a new account may write before a plan is paid for. `0` turns the trial off. |
| `ALLOW_QUERY_TOKEN` | *(unset)* | `1` accepts `?token=` as well as the header. Off because a token in a URL leaks into logs. |

```bash
npm test     # node --test, 81 tests, no dependencies
npm start    # node server.js
```

## Security: what this protects, and what it does not

**In transit.** TLS at the edge with an automatic certificate, HSTS,
`nosniff`, `no-referrer` and `no-store` — and the store itself is never
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

If a customer's data must be unreadable by the operator, the key has to be held
**by the customer** instead — a passphrase only they have, or a key kept on their
own server. Issue [#68](https://github.com/zyntrax/bulwark-plugins/issues/68)
carries that design and the host change it needs.

**What is visible even so:** the *shape* of the data — which workspace, which
store keys exist (`projects`, `contactNotes`, …), how many records, their sizes
and timestamps. Not their contents.

**And what no server can protect:** a compromised browser, a keylogger, or a
malicious plugin update. Encryption protects data at rest and in transit; it does
not protect a machine that is already owned.

## Accounts, subscriptions and the site (#148)

A token in `STORE_TOKENS` is an **installer token**: it is a workspace, it never
expires, and it is how the owner's own install talks to its own store. Everything
below is the other kind of caller — a customer.

**Accounts.** `POST /v1/accounts { email, password }` creates one and returns a
**session token**. Passwords are hashed with scrypt (never stored in the clear),
sessions are random 256-bit tokens stored **hashed**, and a wrong password and an
unknown email answer identically and take the same time.

**Plans.** A new account starts a `trial` (14 days by default, `STORE_TRIAL_DAYS`).
An account whose plan has expired may still **read** — so it can export what is
its — but every write is refused with `402`. `GET /v1/account` is what the plugin
asks before it claims a subscription:

```json
{ "ok": true, "workspace": "acct:…", "plan": "trial", "expiresAt": "…",
  "entitled": true, "account": { "email": "…" },
  "usage": { "records": 1, "bytes": 12, "maxRecords": 5000, "maxBytes": 67108864 } }
```

**Orders.** `POST /v1/account/order { plan: "cloud" }` records a request and
answers `202` as *pending*. Payment is deliberately not wired: an invoice (or a
provider webhook calling `setPlan`) is what turns a pending order into a plan.

**Leaving.** `DELETE /v1/account` removes the account, its sessions, its orders,
its records **and** its wrapped workspace key — without the key the rows are
unreadable, which is what makes it an erasure and not a flag.

**The site** is served by this same container: `GET /` returns a small sign-up,
sign-in and account page (`site/`), so there is no second service and no build
step. It sits behind the same TLS proxy as the API.

**Limits.** 240 requests a minute per token (in memory), 5 000 records and
64 MiB per workspace (`409` when a write would cross them).

**Not wired yet:** email verification — the flag is recorded and stays `0`,
because there is no SMTP here. Nothing else depends on it.

## Paying for it, and the operator panel (#148)

**Payment is a provider seam, not an SDK.** `payments.js` asks Stripe's REST API
for a Checkout Session with `fetch` and verifies the webhook with `node:crypto` —
no dependency, no lockfile, and the card never touches this service.

| Variable | Meaning |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_…`. With no key the store **takes no money**: an order stays `pending`. |
| `STRIPE_PRICE_CLOUD` | The price a cloud order buys. Half a configuration counts as none. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…`; the signature is `t=<unix>,v1=HMAC-SHA256("<t>.<body>")`. |
| `STRIPE_PLAN_DAYS` | Days a paid order buys (default `365`). |
| `STRIPE_MODE` | `payment` (default, one-off) or `subscription`. |
| `PUBLIC_URL` | `https://crm.mailz.se` — where the provider sends the customer back. |

`POST /v1/account/order` answers `202` with
`payment: { status: "redirect", url }` when a provider is configured, and
`payment: { status: "unavailable" }` when it is not — the site then says an
invoice follows.

**The webhook is the only thing that switches a plan on**, and it reads the
account and the order from **metadata this service put there**, never from a body
a customer could edit. A signature outside a five-minute window is refused, so a
captured request cannot be replayed later.

**The operator panel** lives at `/admin` and is guarded by `STORE_ADMIN_TOKEN`
(`Authorization: Bearer …`, compared in constant time). With no token set every
`/v1/admin` route answers **503** — an admin surface that comes up open on a fresh
install is worse than one that has to be enabled.

```
GET    /v1/admin/orders              -> orders, with the account email
GET    /v1/admin/accounts            -> accounts, plans and expiry
POST   /v1/admin/orders/{id}/paid    <- { days } -> order paid + plan switched on
POST   /v1/admin/accounts/{id}/plan  <- { plan, days }
DELETE /v1/admin/accounts/{id}       -> account, records and wrapped key removed
```

It is the collection point when no provider is configured: money arrives by
invoice, the operator clicks *Mark paid*, and the customer's plugin sees the plan
on its next `GET /v1/account`.

## The protocol

`/health` and `/version` are **open** — the plugin's *Check the server* has to
answer before a credential is configured, and neither reveals more than a version
string. Everything under `/v1/store` needs a token, as
`Authorization: Bearer <token>` or `?token=<token>` (for a host that cannot set a
header).

    POST   /v1/accounts     <- { email, password } -> { token, account } | 400 | 409
    POST   /v1/sessions     <- { email, password } -> { token, account } | 401
    DELETE /v1/sessions     -> { ok: true }
    GET    /v1/account      -> { plan, expiresAt, entitled, account, usage }
    POST   /v1/account/order<- { plan } -> 202 { order } (pending)
    DELETE /v1/account      -> { ok: true } (account, records and key removed)

    GET    /health          -> { ok: true, version }
    GET    /version         -> { ok: true, version }

    GET    /v1/store        -> { records: { key: value, … }, revision }
    GET    /v1/store/{key}  -> { key, value, revision } | 404
    PUT    /v1/store/{key}  <- { value } -> { revision }
    DELETE /v1/store/{key}  -> { ok: true }

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

```
GET  /v1/admin/workspaces/{id}/storage  -> { provider, available, reachable, objects, bytes }
POST /v1/admin/workspaces/{id}/migrate  <- { provider }   (+ ?dry=1 to only report)
```

The migration is the only operation here that can lose a customer's data, so its
order is fixed and enforced in `storage.js`, not in a route:

1. read every record of **every scope** from the source backend
2. write each to the target, then **read it back and compare the sha256** of the
   sealed text. Any mismatch → remove what this run wrote, flip nothing
3. only when every object round-trips: flip `workspace_storage.provider`
4. only then: remove the source copies

A failure at step 2 or 3 leaves the workspace **exactly as it was** — the
provider stays `sqlite` and every original record is still there. That is the
point of doing the read-back before the flip. `?dry=1` reports what would move.

A workspace recorded on a provider this process cannot reach answers **503**
(`this workspace lives on s3, which is not configured on this server`) rather
than an empty record list: an empty answer would look like an empty address book
and invite the user to "restore" over their own data.

The panel's **Usage** tab shows the provider per workspace and moves one with a
single deliberate click. The provider list it offers is the list this process can
actually reach, so `s3` appears only when the bucket is configured:

| Variable | Meaning |
|---|---|
| `R2_S3_API` | The bucket-scoped endpoint, e.g. `https://<account>.r2.cloudflarestorage.com/<bucket>`. Ends in the bucket path — it is used exactly as given. |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | The bucket credential. All three are needed; set only some and blob storage stays off. |
| `R2_BUCKET` | The bucket name, for the operator's own reference and the compose file. |

These must be in the compose **`environment:` block**, not only in `.env` — a
variable that is in `.env` but not in the block never reaches the container.

Object layout is `<workspace>/<scope>/<key>.json`. Moving a workspace back to
`sqlite` is the same call with `{"provider":"sqlite"}`, and it is the same code
path, so the disaster-recovery case (point a workspace at a fresh bucket) is
exercised by the same tests.

## Pointing the plugin at it

The plugin reaches this through the webmail host's `http:proxy`, so **no secret
ships in the plugin ZIP**: the host holds the credential and injects it.

1. In Bulwark, grant the plugin `http:proxy` and create a credential whose value
   is the workspace token.
2. In the plugin, *Check the server* → set the URL (e.g. `https://crm.example`).
3. The store answers `/version`; the record stores then read and write here.

Put it behind TLS. The plugin will only talk HTTPS in practice, and a token over
plain HTTP is a token given away.

## Backup

It is one SQLite file. `docker compose exec contact-manager-store node -e "…"`
is not needed — copy the file, or use `sqlite3 store.sqlite ".backup out.sqlite"`
from the host. WAL mode is on, so include the `-wal` and `-shm` files in a plain
copy.

## What is deliberately not here yet

- **Accounts, login, billing, entitlement.** A token is a workspace; who is
  allowed to have one is a decision the maintainer makes by hand today. #68 open
  questions 3 and 4.
- **Self-hosting.** Hosted-only for now; nothing in the protocol assumes one
  deployment shape.
- **Team features.** `scope` is in the schema, but roles, sharing and a review
  queue (#23/#24) are not built.
- **A scheduler.** #5's scans still run only while the webmail is open.

## Licence

Same position as the plugin — see `fyrhaven-crm/README.md` §12. No `LICENSE`
file is committed yet, and the terms are the maintainer's to set.
