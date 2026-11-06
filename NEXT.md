# Start here — the next run

One page for a fresh session. The long history is in `fyrhaven-crm/HANDOFF.md`;
the rules are in `.clinerules`; this file is only "what to do next and what not to
re-learn the hard way".

## State (verified 2026-11-06)

| | |
|---|---|
| Plugin | `fyrhaven-crm` **1.60.0** — 1 215 tests green |
| Record server | `fyrhaven-server` **1.16.0** — 81 tests green |
| Live | `fyrhaven.com` (shop + legal), `crm.fyrhaven.com` (API + shop), `crm.mailz.se` (alias) |
| Panel | `fyrhaven.com/admin` — Orders · Accounts · Catalog · Licences · Usage |
| Money | Stripe **sandbox** end to end verified: order → checkout → signed webhook → plan on |
| Storage | blob seam **wired** (server 1.16.0): `s3Backend`, the read-back migration, the panel control. Not yet deployed, not yet run against R2 |
| Git | `main` and `fyrhaven-crm` in step, clean tree |

## The one job: deploy blob storage and move one test workspace

The code is done and its safety property is pinned by a test: a target whose
write silently truncates must abort the move, leave the provider as `sqlite` and
leave every original record intact (removing the read-back comparison makes that
test fail — checked, not assumed). What is left is the part that needs the host:

1. Put `R2_S3_API`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` in
   the store's `.env` **and** confirm they are in the compose `environment:`
   block (they are in both files in the repo now — the deploy folder is a copy).
2. Rebuild only that container, then
   `curl -s https://crm.mailz.se/version` and
   `curl -s -H "Authorization: Bearer $STORE_ADMIN_TOKEN" https://crm.mailz.se/v1/admin/workspaces/<id>/storage`
   → `available` must now be `["sqlite","s3"]` and `reachable` true.
3. `POST …/migrate?dry=1` first, then a real move of a **test** workspace, then
   `GET /v1/store` on it and compare with what it held before.
4. Only then move a customer's workspace, and only from the panel's Usage tab.

After that: **#155** website polish (front page, pricing cards, empty states,
360 px) and **#156** languages (the site has **no i18n layer**; the plugin needs a
reviewer for 980 keys before `sv` is worth adding).

## Gotchas this session paid for

- **S3 answers 1 000 keys per list page.** `s3.js#list` follows
  `NextContinuationToken` now; before it did not, and a migration of a workspace
  with more than 1 000 records would have copied the first page, flipped the
  provider, and hidden the rest. Any new code that walks a bucket must page.
- **`CREATE TABLE IF NOT EXISTS` will not add a column.** `workspace_storage`
  gains its columns with `ALTER TABLE … ADD COLUMN` guarded by
  `PRAGMA table_info`, or a deployed store fails first in production.
- **A provider with no backend must be a 503, never `{records:{}}`.** An empty
  list reads as an empty address book and invites the user to restore over their
  own data.
- **`R2_*` must be in the compose `environment:` block**, not only `.env`, or the
  adapter reports "not configured" inside Docker while working on the host.
- **`docker compose up -d` answering `Running` means nothing was rebuilt.** A
  401 that looked like a routing bug was a stale container. Verify against the
  **live endpoint**, never the file on disk.
- **`open(path,'w')` truncates before it writes.** A failed write left
  `imprint.html` at 0 bytes and it was deployed that way. Write to a temp file or
  assert before/after.
- **The S3 signer needs `x-amz-date` without milliseconds** and a per-segment
  percent-encoded canonical URI; `R2_S3_API` already ends in the bucket path.
- **`fetch` must be injectable** everywhere (it now is in `s3.js`), or a test
  cannot fake a bucket and silently reaches the network.
- **Insert strings into the manifest carefully**: a block appended with the wrong
  offset lands in the *English* locale. The locale-parity test catches it; run it.

## Commands

```bash
cd fyrhaven-crm && npm test          # builds, then 1 215 tests
cd fyrhaven-crm && npm run release   # tag + GitHub release + ZIP (needs clean main)
cd fyrhaven-server && node --test    # 69 tests
```

Deploy the store (only that container — never touch the others):

```bash
ssh -i .ssh/id_ed25519 -p 37281 zyntrax@mailz.se \
  'cd /opt/stacks/09-contact-manager-store && tar xzf /tmp/srv.tgz && \
   docker compose -f docker-compose.host.yml up -d --build'
```

Then **verify the live endpoint**, not the file: `curl https://fyrhaven.com/version`.

## On the owner's side (not code)

- F-skatt + moms registration is **in progress** (2–6 weeks). Do not flip Stripe to
  **live** until it is granted: `sk_live_`, re-create the three prices in live
  mode, add a live webhook with its own `whsec_`.
- Demo video (scan → review → merge → undo), then claim the handles
  (`brand/social.md`), then one proper Show HN / r/selfhosted post.
- `BIZ.md` has the business checklist; the firma registration and trademark are
  **after** the first invoices, not before.
- Rotate the Cloudflare token — an old one is in the chat log.
