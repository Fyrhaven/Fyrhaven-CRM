# Start here — the next run

One page for a fresh session. The long history is in `fyrhaven-crm/HANDOFF.md`;
the rules are in `.clinerules`; this file is only "what to do next and what not to
re-learn the hard way".

## State (verified 2026-11-05)

| | |
|---|---|
| Plugin | `fyrhaven-crm` **1.60.0** — 1 215 tests green |
| Record server | `fyrhaven-server` **1.15.0** — 69 tests green |
| Live | `fyrhaven.com` (shop + legal), `crm.fyrhaven.com` (API + shop), `crm.mailz.se` (alias) |
| Panel | `fyrhaven.com/admin` — Orders · Accounts · Catalog · Licences · Usage |
| Money | Stripe **sandbox** end to end verified: order → checkout → signed webhook → plan on |
| Storage | `s3.js` verified live against R2; seam in; **not yet wired** |
| Git | `main` and `fyrhaven-crm` in step, clean tree |

## The one job: wire blob storage (#158 step 2)

Plan: `fyrhaven-server/docs/storage-migration.md`. Read it first — it has the
object layout, the adapter shape and the migration order.

1. **Write the test first**: a fake backend whose write *silently truncates*.
   The migration must abort, leave `workspace_storage.provider = 'sqlite'`, and
   leave every original record intact. That test is the whole safety property.
2. `s3Backend(client, keys)` beside `sqliteBackend` — same `list/get/put/remove`.
3. `storeOps` picks the backend from `workspace_storage` (default `sqlite`).
4. The migration: **read → write → read back and compare sha256 → flip the row →
   only then delete**. Never delete before the read-back passes.
5. Provider select on the panel's Usage tab. Then delete the 501 fallback.

After that: **#155** website polish (front page, pricing cards, empty states,
360 px) and **#156** languages (the site has **no i18n layer**; the plugin needs a
reviewer for 980 keys before `sv` is worth adding).

## Gotchas this session paid for

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
