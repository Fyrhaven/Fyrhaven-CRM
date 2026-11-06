# Moving a workspace to blob storage (#158) — the executable plan

Status: **step 1 done** (the seam and a verified S3 client). This is the rest, written
down so it can be executed mechanically rather than re-derived.

## What exists

- `workspace_storage (workspace, provider, updated)` — `sqlite` is the only provider
  today and the default for every workspace.
- `GET /v1/admin/workspaces/{id}/storage` → provider, objects, bytes.
- `POST /v1/admin/workspaces/{id}/migrate?dry=1` → reports without touching anything.
- `s3.js` — `client({ base, accessKeyId, secretKey })` with `list/put/get/remove`,
  **verified live against the R2 bucket** (list, put, read-back, delete).
- The store's `.env` has `R2_S3_API`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
  `R2_BUCKET` (and a custom domain `r2.fyrhaven.com` for reads).

## Object layout

```
<workspace>/<scope>/<key>.json      e.g. acct:abc123/default/projects.json
```

The **value stays sealed by the workspace key** before it reaches the bucket, exactly
as it is sealed before it reaches SQLite. A leaked bucket is opaque without
`STORE_MASTER_KEY`; the envelope moves, the encryption does not.

## The adapter

One function with four calls, so both backends are the same shape:

```js
// storage.js
export function sqliteBackend(db, keys) { return { list, get, put, remove }; }
export function s3Backend(client, keys)  { return { list, get, put, remove }; }
```

`storeOps` keeps its public API; only its body chooses the backend:

```js
const provider = db.prepare('SELECT provider FROM workspace_storage WHERE workspace = ?').get(workspace)?.provider ?? 'sqlite';
const backend = provider === 's3' ? s3 : sqlite;
```

## Revision

`revision` is one global counter today. A blob-backed workspace needs its own:
add `revision INTEGER NOT NULL DEFAULT 0` to `workspace_storage` and bump it per
write; the global counter stays for compatibility.

## The migration — the only order that does not lose data

```
1. read every record of the workspace from the source backend
2. for each: write to the target, then READ IT BACK and compare the sha256 of the
   sealed value. Any mismatch → abort, delete what was written, change nothing
3. only when every object round-trips: flip workspace_storage.provider
4. only then: delete the source copies
```

- `?dry=1` reports objects and bytes and writes nothing (already implemented).
- A failure at step 2 leaves the workspace exactly as it was — that is the whole
  point of doing the read-back before the flip.
- The same endpoint is the disaster-recovery path: point a workspace at a fresh
  bucket after a provider outage.

## Tests to write first

1. `s3Backend` against a fake `fetch` that stores objects in a Map — put, get,
   list, remove, and a 404 that reads as `null`.
2. A migration on a scratch sqlite workspace: seed 3 records, migrate to the Map
   backend, assert the objects exist with identical bytes, the provider row flipped,
   and the originals are gone.
3. The **failure** path: a backend whose write silently truncates → migration must
   abort, leave the provider as `sqlite`, and leave the original records intact.
4. `?dry=1` on a real workspace touches nothing (already covered).

## Then

- Offer the provider per workspace in the admin panel (a select on the Usage tab).
- `R2_BUCKET` and the R2 keys must reach the container: add them to the compose
  `environment:` block, or the adapter will report "not configured" inside Docker
  while working perfectly on the host.
