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
# one token per workspace; a token IS a workspace
echo "STORE_TOKENS=$(openssl rand -hex 32)=acme" > .env
docker compose up -d
curl -s localhost:8080/version
```

The store **refuses to start** without `STORE_TOKENS` — an open store on the
internet is worse than a container that will not come up.

| Variable | Default | Meaning |
|---|---|---|
| `STORE_TOKENS` | *(required)* | `token=workspace,token=workspace`. A token written alone is its own workspace. |
| `PORT` | `8080` | What it listens on. |
| `STORE_DB` | `/data/store.sqlite` | The SQLite file. Put it on a volume. |

```bash
npm test     # node --test, 15 tests, no dependencies
npm start    # node server.js
```

## The protocol

`/health` and `/version` are **open** — the plugin's *Check the server* has to
answer before a credential is configured, and neither reveals more than a version
string. Everything under `/v1/store` needs a token, as
`Authorization: Bearer <token>` or `?token=<token>` (for a host that cannot set a
header).

    GET    /health          -> { ok: true, version }
    GET    /version         -> { ok: true, version }

    GET    /v1/store        -> { records: { key: value, … }, revision }
    GET    /v1/store/{key}  -> { key, value, revision } | 404
    PUT    /v1/store/{key}  <- { value } -> { revision }
    DELETE /v1/store/{key}  -> { ok: true }

`?scope=` narrows within a workspace (default `default`). It is the seam the team
features (#23/#24) will widen — **it is not a security boundary**: the token is.

`revision` is one counter bumped by every write, so a client can tell "something
changed" without diffing, and a later sync can ask for everything above the
revision it last saw.

A key is a slug (`A-Za-z0-9._-`, ≤ 64 chars) and a value is any JSON up to 1 MiB.

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

Same position as the plugin — see `contact-manager/README.md` §12. No `LICENSE`
file is committed yet, and the terms are the maintainer's to set.
