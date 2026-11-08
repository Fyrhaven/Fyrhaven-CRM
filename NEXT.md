# Start here — the next run

One page for a fresh session. The long history is in `fyrhaven-crm/HANDOFF.md`;
the rules are in `.clinerules`; this file is only "what to do next and what not to
re-learn the hard way".

## State (verified 2026-11-07)

| | |
|---|---|
| Plugin | `fyrhaven-crm` **1.60.0** — 1 215 tests green |
| Record server | `fyrhaven-server` **1.18.0** — 89 tests green; **two builds**, and the self-hosted archive contains no cloud code |
| Cloud repository | `Fyrhaven/Fyrhaven-CRM-Cloud` exists and is **empty**. Cloud-only content is staged on branch `cloud-only` (86 tests) — see *the one job* |
| Live | `fyrhaven.com` (shop + legal), `crm.fyrhaven.com` (API + shop), `crm.mailz.se` (alias) |
| Panel | `fyrhaven.com/admin` — Orders · Accounts · Catalog · Licences · Usage |
| Money | Stripe **sandbox** end to end verified: order → checkout → signed webhook → plan on |
| Storage | blob seam wired (server 1.16.0): `s3Backend`, the read-back migration, the panel control. Not deployed, not yet run against R2 |
| Brand | profile header, YouTube banner, org page, repository page — all shipped (see `brand/`) |
| Git | `main` and `fyrhaven-crm` in step, clean tree; `cloud-only` pushed but not merged |

## The one job: land the cloud repository

`Fyrhaven/Fyrhaven-CRM-Cloud` exists and is empty. Its content is staged in this
repository on branch **`cloud-only`** — 29 commits of server history, files at the
root, 86 tests — because a session without access to that repository cannot push
to it.

**One command, in a session that has access:**

```bash
node scripts/land-cloud-repo.mjs            # the plan: reachable? empty? which commit?
node scripts/land-cloud-repo.mjs --apply    # push, clone it back, run its 86 tests
```

It refuses rather than overwrites if the target already has commits, prints the
one settings click when the app cannot see the repository, and verifies what
landed by cloning it and running the tests — not by trusting the push's exit code.
Exercised end to end against a local bare repository: push, file assertions
(`cloud.js` present; no `packaging/`, no `distribution.js`), 86 tests, and a
refusal with exit 1 when the target was not empty.

**If a human has to do it instead:**

```bash
git fetch origin cloud-only
git push https://github.com/Fyrhaven/Fyrhaven-CRM-Cloud.git \
  origin/cloud-only:refs/heads/main
```

Then confirm the branch is the cloud only — `node --test` gives 86, `ls` shows
`cloud.js` and no `packaging/` — and **delete the staging branch**
(`git push origin --delete cloud-only`); it exists only to carry the content.

Why the cloud repository holds no self-host machinery: `FYRHAVEN_MODE=cloud` was
once a variable any self-hoster could set, and while one tree produced both
builds, the code honouring it travelled in the copy they held. Two repositories,
no flag — the code that would honour it is not in their possession.

### Then: this repository's server becomes the self-hosted one

The cloud left with `cloud.js`, `accounts.js`, `catalog.js`, `payments.js` and
`site/`. What is still in `fyrhaven-server/` here is the **old full tree**, which
now belongs in neither place — the cloud copy is cloud-only, so this one has to
become the mirror image:

* **remove** `cloud.js`, `accounts.js`, `catalog.js`, `payments.js`, `site/`, and
the `cloudRoute` calls in `server.js` (two calls and the `cloudContext` object —
the handler keeps the record API, the auth and the licence gate);
* **remove** `scripts/dist.mjs` and `packaging/`, and replace them with plain
packaging: the folder *is* the self-hosted server now, so there is nothing to
stub out;
* **drop** the cloud test suites and keep the record-API ones;
* the licence gate becomes the only condition: `FYRHAVEN_LICENCE`, verified
  offline, no `FYRHAVEN_MODE` at all.

That is the price of two repositories: `server.js`, `storage.js`, `s3.js` and
`licence.js` exist twice and must be kept in step by hand. The rule to write down
when it happens: **a change to the record API is two commits**, one in each
repository, and the shared files should differ only in the cloud plugin points.

## Still open from before
## Still open from before

Deploy blob storage and move one test workspace. The code is done and its safety
property is pinned by a test: a target whose write silently truncates must abort
the move, leave the provider as `sqlite` and leave every original record intact.

1. Put `R2_S3_API`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` in
   the store's `.env` **and** in the compose `environment:` block.
2. Rebuild only that container, then check
   `curl -s -H "Authorization: Bearer $STORE_ADMIN_TOKEN" https://crm.mailz.se/v1/admin/workspaces/<id>/storage`
   → `available` must be `["sqlite","s3"]` and `reachable` true.
3. `POST …/migrate?dry=1` first, then move a **test** workspace, then read it back.
4. Only then a customer's workspace, and only from the panel's Usage tab.

After that: **#156** languages — the site has **no i18n layer**, and the plugin
carries ~980 keys in `manifest.json` (`en`/`de`); `sv` needs a native reader.

## Decided — do not re-litigate

* **Two builds from one tree.** `cloud.js` (shop, accounts, catalogue, billing,
  panel, licence issuing) is the cloud's; `npm run dist` replaces it and the three
  operator modules with stubs and rewrites `DISTRIBUTION` to `selfhosted`, so the
  archive cannot enter cloud mode. Demonstrated, not asserted: the built archive
  answers `404` to `/`, `/v1/products`, `/admin`, `/v1/account`, `/v1/licence` and
  still serves `/v1/store`.
* **Licences are offline Ed25519 and are a contract, not DRM** — said in
  `LICENSING.md`. Making them impossible is not achievable for distributed code;
  making it take a patch rather than a flag is, and that is done.
* **Covers never draw the mark.** The profile picture *is* the mark. The beam
  enters from outside the frame, so nothing has to line up with the avatar at any
  width. No wordmark on the Gravatar cover; the slogan yes.
* **Palette.** Amber only works on ink (8.79:1); on paper it is 1.75:1. Red is for
  the tower's bands, never a link colour. Slate on ink is 3.26:1 — fine for large
  text, too low for body copy (use `#93A5B2`, 6.38:1).
* **npm.** The scope `@fyrhaven` already exists, owned by the npm user
  `fyrhaven`. npm orgs belong to npm *users*; the only place a GitHub org appears
  is a package's trusted publisher. The plugin stays a ZIP — it is not a package.

## Gotchas this session paid for

- **`send()` returns nothing.** A route ending `return send(...)` reported "not
  mine" to its caller, which then answered a second time on the same socket — 114
  `ERR_HTTP_HEADERS_SENT`. `cloud.js` answers through a `send` that returns `true`.
- **A private repository the app is not installed on is invisible, not just
  read-only.** That is why `Fyrhaven-CRM-Cloud` 404s; a *public* one it is not
  installed on is readable but still not writable.
- **Gravatar is not 2:1 and its avatar is not centred.** The cover renders around
  40:9, and the profile picture's centre sits about **63%** down the band. Every
  beam that looked right in a centred simulation was too high on the real page.
- **YouTube keeps three areas of one 2560×1440 upload**: the canvas on a TV, a
  2560×423 strip on desktop, and only the middle **1546×423** on a phone. Check by
  cropping the PNG, not by looking at the canvas.
- **Yellow over navy at equal luminance goes green.** Use a pale yellow
  (`#FFF8D6` → `#FFE94A`) and two blurs — a halo and a tighter core. One blur that
  is wide enough to be soft dilutes the colour to olive.
- **The shop had never rendered a price.** `chosenCurrency()` was called above its
  own `const`, so the module died on load and every line after it — including the
  price list — never ran. Pinned by a test on the call site, not the word.
- **A table cell without `data-label` breaks the phone layout silently**: the
  stacked view shows a bare "yes" and the reader cannot tell which plan it is.
- **S3 answers 1 000 keys per list page.** `s3.js#list` follows
  `NextContinuationToken`; any new code that walks a bucket must page.
- **`CREATE TABLE IF NOT EXISTS` will not add a column.** `workspace_storage`
  gains columns with `ALTER TABLE … ADD COLUMN` guarded by `PRAGMA table_info`.
- **`open(path,'w')` truncates before it writes.** A failed write left
  `imprint.html` at 0 bytes and it was deployed that way.
- **`docker compose up -d` answering `Running` means nothing was rebuilt.** Verify
  against the live endpoint, never the file on disk.

## Commands

```bash
cd fyrhaven-crm && npm test          # builds, then 1 215 tests
cd fyrhaven-crm && npm run release   # tag + GitHub release + ZIP (needs clean main)
cd fyrhaven-server && node --test    # 89 tests
cd fyrhaven-server && npm run dist   # dist/fyrhaven-selfhost-<version>.tar.gz
```

Deploy the store (only that container — never touch the others):

```bash
ssh -i .ssh/id_ed25519 -p 37281 zyntrax@mailz.se \
  'cd /opt/stacks/09-contact-manager-store && tar xzf /tmp/srv.tgz && \
   docker compose -f docker-compose.host.yml up -d --build'
```

Then **verify the live endpoint**, not the file: `curl https://fyrhaven.com/version`.

## On the owner's side (not code)

- **Add `Fyrhaven-CRM-Cloud` to the GitHub App installation** — the one thing
  blocking the cloud repository. Or push `fyrhaven-cloud.bundle` by hand.
- **The organisation page** is live; its source copy is `brand/org-profile.md`.
  GitHub renders it only from a **public** repository named `.github`, and it is
  there now.
- **The repository page's description, topics and social preview** need
  *Administration: write*: `node scripts/brand-github-page.mjs` prints the values
  and the one settings click.
- **npm**: add a second owner to the `fyrhaven` org and require 2FA.
- **Social**: the Gravatar colours are background `#0E2233`, surface `#1B3346`,
  accent `#F2B441`; upload `brand/fyrhaven-header.png` (2048×460) as the cover and
  `brand/fyrhaven-mark.png` as the avatar. The YouTube banner is
  `brand/fyrhaven-youtube.png` (2560×1440).
- F-skatt + moms registration is **in progress**. Do not flip Stripe to **live**
  until it is granted: `sk_live_`, re-create the three prices in live mode, add a
  live webhook with its own `whsec_`.
- Demo video (scan → review → merge → undo), then claim the handles
  (`brand/social.md`), then one proper Show HN / r/selfhosted post.
- Rotate the Cloudflare token — an old one sits in the chat log.

