# Start here — the next run

One page for a fresh session. The long history is in `fyrhaven-crm/HANDOFF.md`;
the rules are in `.clinerules`; this file is only "what to do next and what not to
re-learn the hard way".

## State (verified 2026-11-07)

| | |
|---|---|
| Plugin | `fyrhaven-crm` **1.60.0** — 1 215 tests green |
| Record server | `fyrhaven-server` **1.18.0** — 89 tests green; **two builds**, and the self-hosted archive contains no cloud code |
| Cloud repository | `Fyrhaven/Fyrhaven-CRM-Cloud` exists and is **empty**. The content is staged on branch `cloud-split` — see *the one job* |
| Live | `fyrhaven.com` (shop + legal), `crm.fyrhaven.com` (API + shop), `crm.mailz.se` (alias) |
| Panel | `fyrhaven.com/admin` — Orders · Accounts · Catalog · Licences · Usage |
| Money | Stripe **sandbox** end to end verified: order → checkout → signed webhook → plan on |
| Storage | blob seam wired (server 1.16.0): `s3Backend`, the read-back migration, the panel control. Not deployed, not yet run against R2 |
| Brand | profile header, YouTube banner, org page, repository page — all shipped (see `brand/`) |
| Git | `main` and `fyrhaven-crm` in step, clean tree; `cloud-split` pushed but not merged |

## The one job: land the cloud repository

`Fyrhaven/Fyrhaven-CRM-Cloud` is created but empty. Its content is ready and
verified — 29 commits of server history, files at the root, 89 tests passing and
`npm run dist` still emitting the self-hosted archive when run from it.

It is blocked on **one permission**, not on code: the GitHub App this workspace
runs as is installed on *selected repositories* — `Fyrhaven-CRM` and `.github` —
so the new private repository answers `404` to everything, reads included.

**Either** an org owner adds the repository to the installation
(<https://github.com/organizations/Fyrhaven/settings/installations> → *Cline* →
*Configure* → Repository access → add `Fyrhaven-CRM-Cloud`, Contents: read & write),

**or** land it from a machine that can push, using the bundle in this workspace's
artifacts (`fyrhaven-cloud.bundle`, 207 kB, complete history):

```bash
git clone fyrhaven-cloud.bundle fyrhaven-cloud
cd fyrhaven-cloud
git remote set-url origin https://github.com/Fyrhaven/Fyrhaven-CRM-Cloud.git
git push -u origin main
```

Then, from a fresh clone of *this* repository — which already holds the branch:

```bash
git fetch origin cloud-split
git push https://github.com/Fyrhaven/Fyrhaven-CRM-Cloud.git \
  origin/cloud-split:refs/heads/main
```

Verify it landed as its own project, not as a folder:

```bash
git clone https://github.com/Fyrhaven/Fyrhaven-CRM-Cloud.git /tmp/cloud && cd /tmp/cloud
node --test          # 89 tests
npm run dist         # dist/fyrhaven-selfhost-<version>.tar.gz
```

**Then delete `cloud-split` here** — it exists only to carry the content across.

### The decision that follows

Right now the server would live in **both** repositories, and that is the drift
trap: two copies of `server.js`, `cloud.js`, `storage.js` and `licence.js`, fixed
in one place and not the other.

* **Recommended:** remove `fyrhaven-server/` from this repository once the cloud
  copy is live. This repo becomes plugin + docs. The self-hosted archive keeps
  being built by `npm run dist` *in the cloud repository*, so customers still get
  it; the self-host **source** then lives only in the private repository, while
  the archive itself ships readable JS anyway.
* **The alternative:** keep `fyrhaven-server/` here as the canonical record API
  and have the cloud repository consume it (submodule or vendored copy). Choose
  this only if the self-host server should be developed in public.

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

