# Cloud handover — for a session with access to `Fyrhaven-CRM-Cloud`

This repository (`Fyrhaven/Fyrhaven-CRM`) is the **plugin** and the
**self-hosted record server**. The cloud service — shop, customer accounts,
catalogue, billing, operator panel, licence issuing — lives in
`Fyrhaven/Fyrhaven-CRM-Cloud` and is never distributed.

The split landed here in **#175** (`fyrhaven-server` 1.19.0). This page lists
what changed on this side that the cloud repository has to mirror, and the two
places where the two copies of a shared file now legitimately differ. Read it
before editing either copy.

> The GitHub App this session uses cannot see `Fyrhaven-CRM-Cloud` (it answers
> `404`). A session that *can* see it is the only one that can do the work below.

## What is shared, and how the two copies differ

`server.js`, `storage.js`, `s3.js` and `licence.js` exist in both repositories,
kept in step **by hand**. A change to the record API is **two commits**.

| File | Here (self-hosted) | There (cloud) |
|---|---|---|
| `server.js` | record API, auth, licence gate, three `/v1/licence*` legs, two `/v1/admin/workspaces/*` routes | the same record API, plus `cloudRoute`/`cloudContext`, the cloud's tables, `people` and `catalogue` |
| `storage.js`, `s3.js` | identical — copy either way | identical |
| `licence.js` | `startupLicence(env)` **requires** `FYRHAVEN_LICENCE` and returns `{ ok, licence?, error? }`; no `FYRHAVEN_MODE`, no `distribution.js` import | the operator's service needs no key: `startupLicence()` should return `{ ok: true, mode: 'cloud' }` unconditionally — see task 1 |
| `distribution.js` | **gone** | **gone** (it was the build switch; two repositories replaced it) |
| `cloud.js`, `accounts.js`, `catalog.js`, `payments.js`, `site/` | **gone** | theirs; never copied back here |

## Tasks for the cloud repository

### 1. Drop the last of the mode switch from `licence.js`

The cloud copy still has a `FYRHAVEN_MODE` branch (it returns `mode: 'cloud'`
when the variable is set, and a licence check otherwise). There is no
self-hosted build to protect there any more, so it should read:

```js
export function startupLicence() {
  // The operator's own service: it *is* the product, so it needs no key.
  return { ok: true, mode: 'cloud' };
}
```

and the `distribution.js` import stays deleted. Nothing else in the file changes:
the signing, verification, installation-key and deactivation helpers are all
still used, by `cloud.js` and by the tests.

### 2. Do not implement `/v1/licence` twice

`server.js` here now serves the **customer's** legs, because the plugin's
*Server and licence* panel talks to the customer's own server:

```
GET  /v1/licence            -> { ok, mode, fingerprint, licensed, licence, summary }
POST /v1/licence            <- { licence }  (checks it, writes /data/licence.key)
POST /v1/licence/challenge  -> { challenge, fingerprint }
POST /v1/licence/deactivate <- { code }     -> { deactivated: true }
```

The cloud's `cloud.js` already answers these (they were written there first).
Both may keep them **only while they answer different requests**, and in the
cloud build the request handler calls `cloudRoute` before the record API, so a
copy in `server.js` would never be reached — but it would still be a trap. Pick
one:

* **simplest:** leave `cloud.js` as it is, and do **not** port `licenceRoute`
  from this `server.js`; or
* port `licenceRoute` into the cloud's `server.js` and delete the customer legs
  from `cloud.js`, keeping only the seller's halves:
  `POST /v1/licence/activate` and the account-side `POST /v1/licence/deactivate`
  that signs a release code.

### 3. Same question for the storage routes

`server.js` here keeps `GET /v1/admin/workspaces/{id}/storage` and
`POST /v1/admin/workspaces/{id}/migrate` (behind `STORE_ADMIN_TOKEN`), because
the panel is the cloud's and the self-hoster needs some way to move a workspace
to a bucket. `cloud.js` has its own `/v1/admin/*` block that includes those two
routes. Again: one implementation per build. If the cloud adopts `adminRoute`
from this `server.js`, the `/v1/admin` block in `cloud.js` must stop answering
those two paths.

### 4. Keep the two deployments apart

| | This repository | Cloud |
|---|---|---|
| Compose project | `fyrhaven-server` | `contact-manager-store` |
| Ports | Caddy, or the host proxy (`docker-compose.host.yml`) | the host proxy only |
| Env | `FYRHAVEN_LICENCE`, `STORE_TOKENS`, `STORE_MASTER_KEY`, optional `R2_*` | the above plus Stripe, `PUBLIC_URL`, `STORE_TRIAL_DAYS` |
| Release tag | `fyrhaven-server-vX.Y.Z` (asset: `fyrhaven-server-X.Y.Z.tar.gz`) | its own tag and asset — do not reuse this one |

The stack at `/opt/stacks/09-contact-manager-store` is deployed from the
**cloud** repository. Do not point it at this repository's compose files: the
project name differs, and its environment no longer carries the shop's
variables.

### 5. Mirror the docs, not the code

* `LICENSING.md` here no longer mentions `FYRHAVEN_MODE`, and says explicitly
  that issuing, tracking and revoking keys are the seller's
  (`GET /v1/admin/licenses`, `POST /v1/admin/licenses/{id}/revoke`).
* A change to the plugin's *Server and licence* panel has two ends: the
  customer's server (here) and the seller's (`/v1/licence/activate`, release
  signing — there).
* `fyrhaven-server/CHANGELOG.md` starts at 1.19.0. The cloud's version numbering
  is its own again.

## What does not need doing

* **Nothing to copy back.** `cloud.js`, `accounts.js`, `catalog.js`,
  `payments.js` and `site/` must never reappear here — nothing guards them but
  `fyrhaven-server/scripts/package.mjs`, which **refuses to build** the customer
  archive if any of them is present.
* **No `packaging/`, no `scripts/dist.mjs`.** Both are gone here; the cloud-only
  tree removed them too. The folder is what ships.
* **No test suites to port back.** The cloud's went with it; this repository
  keeps the record-API, licence and storage ones (50 tests).

## How to check the cloud after a change

```bash
cd /path/to/Fyrhaven-CRM-Cloud
node --test                     # the cloud's own suite
node server.js                  # with STORE_TOKENS + STORE_MASTER_KEY, no licence needed
curl -s localhost:8080/version
curl -s -X POST -H 'content-type: application/json' \
     -d '{"email":"x@example.com","password":"a-long-password"}' \
     localhost:8080/v1/accounts   # 201 + a session token
```

And on this side, after a shared file changed:

```bash
cd fyrhaven-server && node --test && npm run package
```
