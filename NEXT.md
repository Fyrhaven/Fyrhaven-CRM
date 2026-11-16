# Start here — the next run

One page for a fresh session. The long history is in `fyrhaven-crm/HANDOFF.md`;
the rules are in `.clinerules`; this file is only "what to do next and what not to
re-learn the hard way".

## State (verified 2026-11-16)

| | |
|---|---|
| Plugin | `fyrhaven-crm` **1.60.0** — 1 215 tests green |
| Record server | `fyrhaven-server` **1.19.0**, self-hosted — 50 tests green; no cloud code, no build switch |
| Cloud repository | `Fyrhaven/Fyrhaven-CRM-Cloud` — the cloud server (shop, accounts, catalogue, billing, panel), copied out of this repository and never distributed |
| Live | `fyrhaven.com` (shop + legal), `crm.fyrhaven.com` (API + shop), `crm.mailz.se` (alias) — the cloud, from its own repository |
| Money | Stripe **sandbox** end to end verified: order → checkout → signed webhook → plan on |
| Storage | blob seam wired (server 1.16.0): `s3Backend`, the read-back migration, the `/v1/admin` control. Not deployed, not yet run against R2 |
| Brand | profile header, YouTube banner, org page, repository page — all shipped (see `brand/`) |
| Git | `main` and `fyrhaven-crm` in step, clean tree; every merged branch deleted, including the `cloud-only` staging branch |

## What just happened: two repositories, one tree split

The cloud left this repository. `cloud.js`, `accounts.js`, `catalog.js`,
`payments.js` and `site/` are in `Fyrhaven/Fyrhaven-CRM-Cloud` now, and what is
left in `fyrhaven-server/` is the **self-hosted** server:

* the record API, the auth and the licence gate — nothing that sells anything;
* no `distribution.js`, no `scripts/dist.mjs`, no `packaging/`: the folder **is**
  the self-hosted server, so there is nothing to stub out;
* `licence.js` has no `FYRHAVEN_MODE` at all — a key is required, and that is the
  only condition;
* the cloud's test suites went with the cloud; the record-API, licence and
  storage-seam ones stayed;
* `/v1/licence` (status, paste a key, challenge, release) moved here, because it
  is the customer's own server that answers it. `/v1/licence/activate` stayed
  with the seller.

**A change to the record API is two commits**, one in each repository.
`server.js`, `storage.js`, `s3.js` and `licence.js` exist twice and are kept in
step by hand; they should differ only in the cloud's plugin points.

One thing still to check by hand: the cloud repository is invisible to the GitHub
App this session uses (it answers `404`, even to `gh repo view`). If a later
session needs to touch it, an organisation owner adds it once at
<https://github.com/organizations/Fyrhaven/settings/installations> — the Cline
app → *Configure* → *Repository access* → add `Fyrhaven-CRM-Cloud`
(Contents: read and write).

## Still open from before

Deploy blob storage and move one test workspace. The code is done and its safety
property is pinned by a test: a target whose write silently truncates must abort
the move, leave the provider as `sqlite` and leave every original record intact.

1. Put `R2_S3_API`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` in
   the store's `.env` **and** in the compose `environment:` block.
2. `STORE_ADMIN_TOKEN` must be set too — the storage routes answer `503`
   without it, and that is the only way in now that the panel went with the cloud.
3. Rebuild only that container, then check
   `curl -s -H "Authorization: Bearer $STORE_ADMIN_TOKEN" https://crm.mailz.se/v1/admin/workspaces/<id>/storage`
   → `available` must be `["sqlite","s3"]` and `reachable` true.
4. `POST …/migrate?dry=1` first, then move a **test** workspace, then read it back.
5. Only then a customer's workspace.

After that: **#156** languages — the site has **no i18n layer**, and the plugin
carries ~980 keys in `manifest.json` (`en`/`de`); `sv` needs a native reader.

## Decided — do not re-litigate

* **Two repositories, not two builds.** The cloud (shop, accounts, catalogue,
  billing, panel, licence issuing) has its own repository and is never
  distributed. This one holds the self-hosted server, which has no switch that
  could become the cloud — `FYRHAVEN_MODE` is gone, and the code that would honour
  it is not in a customer's possession. There is no `npm run dist` and no
  `packaging/`: the folder is what ships.
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
  `ERR_HTTP_HEADERS_SENT`. (That was `cloud.js`, in the cloud repository now; the
  handler here answers through `send` and returns the route's own value.)
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
cd fyrhaven-server && node --test    # 50 tests, no dependencies
```

Deploy the store (only that container — never touch the others). The stack this
command targets is the **cloud**, and its compose file and README now live in
`Fyrhaven/Fyrhaven-CRM-Cloud`; a self-hosted install uses
`fyrhaven-server/docker-compose.yml` instead:

```bash
ssh -i .ssh/id_ed25519 -p 37281 zyntrax@mailz.se \
  'cd /opt/stacks/09-contact-manager-store && tar xzf /tmp/srv.tgz && \
   docker compose -f docker-compose.host.yml up -d --build'
```

Then **verify the live endpoint**, not the file: `curl https://fyrhaven.com/version`.

## On the owner's side (not code)

- **Add `Fyrhaven-CRM-Cloud` to the GitHub App installation** — until then the
  cloud repository is invisible to an automated session (`gh` answers `404`), even
  though it exists and has the code.
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

