<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/fyrhaven-lockup-dark.svg">
    <img src="brand/fyrhaven-lockup.svg" alt="Fyrhaven — mail · records · people" width="330">
  </picture>
</p>

<h3 align="center">Your mail. Your records. Your rock.</h3>

<p align="center">
  Contacts, companies, projects and time inside your own mail server.<br>
  A CRM plugin for <a href="https://github.com/bulwarkmail/webmail">Bulwark Mail</a> on top of
  <a href="https://stalw.art">Stalwart</a> — and the small record server those records live on.
</p>

<p align="center">
  <a href="https://github.com/Fyrhaven/Fyrhaven-CRM/releases"><img alt="Fyrhaven CRM for Bulwark Mail" src="https://img.shields.io/badge/Bulwark%20Mail-plugin-0E2233?style=flat-square"></a>
  <a href="https://stalw.art"><img alt="Stalwart 1.0 and later" src="https://img.shields.io/badge/Stalwart-1.0%2B-0E2233?style=flat-square"></a>
  <a href="fyrhaven-server/"><img alt="Self-hosted or cloud" src="https://img.shields.io/badge/records-self--hosted%20or%20cloud-C8453B?style=flat-square"></a>
  <a href="fyrhaven-crm/manifest.json"><img alt="English and German" src="https://img.shields.io/badge/languages-EN%20%C2%B7%20DE-5B7382?style=flat-square"></a>
</p>

---

## Why

Anyone who has run a mail server for a few years has the same address book: the
same person three times, because a client, an import and a phone each wrote
their own card. Cleaning that up by hand is the reason people give up on
contacts entirely.

Fyrhaven CRM finds those cards, shows **exactly** what a merge would change
before it changes anything, and — if the merge turns out wrong — undoes it. It
is drawn with Bulwark's own UI kit, so it looks like part of the app rather than
a page bolted onto it.

Two rules hold everywhere, and they are what the test suite is really about:

* **Never delete before the data is safe.** The kept contact is patched first;
  if that write fails, the group is left untouched.
* **A record the plugin invents belongs on a server, not in a browser tab.**
  Notes, consent records and the plugin's other records survive clearing site
  data and follow you to a second device, because they live on a server —
  yours, or the one you pay for.

## The two halves

| | What it is | Where records live |
|---|---|---|
| **[Fyrhaven CRM](fyrhaven-crm/)**<br>`fyrhaven-crm` 1.60.0 | The plugin: duplicate detection and merge, a contact and company 360°, projects, time and expenses, health and retention, a GDPR toolkit, import and export, smart search | The webmail's own address books, plus — when configured — the record server |
| **[fyrhaven-server](fyrhaven-server/)**<br>`fyrhaven-server` 1.19.0 | The record server, **self-hosted**: a small key/value service, no runtime dependencies, encrypted at rest, SQLite or an S3-compatible bucket, licensed offline | On the server — yours |
| **[Fyrhaven-CRM-Cloud](https://github.com/Fyrhaven/Fyrhaven-CRM-Cloud)** | The cloud service — shop, accounts, catalogue, billing, operator panel — which is also the hosted tier. Never distributed | On the hosted service |

The plugin needs nothing but the webmail. The server is what turns it from a
clean-up tool into a CRM that outlives one browser profile. The cloud service is
its own repository, so the self-hosted server a customer runs contains none of
the code that sells it.

## What the plugin does

| Area | What you get |
|---|---|
| **Duplicates** | A scan across every address book, with a review dialog that shows every `+` it would add and `≠` it would leave alone. Undo after a merge, bulk merge by company or email domain, and a digest of what changed since your last visit |
| **Contacts** | The whole address book, paged and searchable; a full editor; groups (distribution lists) as real cards; a 360° profile with recent messages, meetings, files, open tasks and private notes |
| **Companies** | Company profiles with their people and contacts rolled up from the cards' organisations |
| **Work** | Projects with milestones, time and expenses with billable totals, and follow-up tasks that are real host tasks — so they are searchable and survive a reload |
| **Health & retention** | Rule-based contact health with a score per contact, staleness bands, and *export and delete* that writes the archive first |
| **Privacy** | Private notes that are a record of their own (never a card field), consent records with expiry, subject-access export, and erase/anonymise with a proof-of-deletion report. Plus a history of the plugin's own writes, and the rollback that is still live |
| **Matching** | Normalisation rules for names, companies, phones and emails; per-address-book policies, ignore rules and protected fields; and advisory per-book roles that disable actions they do not allow |
| **Getting data in and out** | CSV and vCard import with a decision per duplicate and remembered column mappings; export as either format; smart search with `OR` and grouping, saved as lists you can act on |

Everything is translated into **English and German**, and every surface is
rendered with the host's own components.

## Install

1. Download `fyrhaven-crm.zip` from the
   [latest release](https://github.com/Fyrhaven/Fyrhaven-CRM/releases/latest).
2. In Bulwark Mail open **Admin → Plugins** (or **Settings → Plugins**, if your
   administrator allows user uploads) and upload the ZIP.
3. Confirm the permissions the plugin asks for.

The ZIP holds `manifest.json` and `index.js` at its root — that is what the
plugin loader expects, and the release script builds it from the tagged source
so the download and the tag can never disagree.

The plugin works on its own. To connect the record server, open
**Settings → Fyrhaven CRM → Server and licence** and either point it at a server
you run (see [`fyrhaven-server/LICENSING.md`](fyrhaven-server/LICENSING.md)) or
use the hosted one.

## Repository layout

```
Fyrhaven-CRM/
├── brand/                    # logo, lockup, social card, palette — and the rules for using them
│   └── org-profile.md        # the copy of github.com/Fyrhaven, published by a script
├── scripts/
│   ├── brand-github-page.mjs # description, website and topics — the page settings the API can set
│   ├── publish-org-profile.mjs # the organisation page: Fyrhaven/.github/profile/README.md
│   └── migrate-to-org.mjs    # how this repository moved to the Fyrhaven org, and the link sweep
├── fyrhaven-crm/             # the plugin
│   ├── manifest.json         # the contract with the host: permissions, settings, every string
│   ├── src/                  # plugin source
│   ├── test/                 # the suite — the expected behaviour, in executable form
│   ├── scripts/              # packaging, release and ship
│   └── CHANGELOG.md · README.md · HANDOFF.md
└── fyrhaven-server/          # the record server, self-hosted
    ├── server.js             # the record API: auth, the store, the licence gate
    ├── licence.js            # Ed25519 licences, verified offline, and the installation key
    ├── storage.js · s3.js    # SQLite, and the S3-compatible bucket backend
    └── Dockerfile · docker-compose.yml · Caddyfile · env.example
```

## Documentation

| Where | What it answers |
|---|---|
| [`fyrhaven-crm/README.md`](fyrhaven-crm/README.md) | How the plugin works: architecture, the host contract, the data model, and the detection and merge rules |
| [`fyrhaven-crm/HANDOFF.md`](fyrhaven-crm/HANDOFF.md) | Where the project stands, what is blocked, and why past decisions were made |
| [`fyrhaven-crm/CHANGELOG.md`](fyrhaven-crm/CHANGELOG.md) | What shipped, release by release, newest first |
| [`fyrhaven-server/README.md`](fyrhaven-server/README.md) | Running the record server, the API, and what it does and does not protect |
| [`CLOUD-HANDOVER.md`](CLOUD-HANDOVER.md) | What the cloud repository has to mirror after the split, and what never to copy back |
| [`.clinerules`](.clinerules) | The rules for changing the code, and the contract the suite enforces |
| [`brand/README.md`](brand/README.md) | The palette, the mark, and which file goes where |

## Working on it

Every folder with a `package.json` is developed with npm; the source tree is
self-contained and `node_modules` and build output are never committed.

```bash
cd fyrhaven-crm
npm install        # once — dev dependencies only
npm test           # builds, then runs the suite
npm run package    # builds and writes fyrhaven-crm.zip
```

```bash
cd fyrhaven-server && node --test && npm run package
```

The plugin ships as a ZIP attached to a `fyrhaven-crm-vX.Y.Z` release; the
server ships as `fyrhaven-server-<version>.tar.gz` attached to a
`fyrhaven-server-vX.Y.Z` release, built by the script from the tagged source —
neither archive is committed.

A change is done when the suite passes, new behaviour has a test that says what
the behaviour *is*, new strings exist in `en` **and** `de`, the version is
bumped with a `CHANGELOG.md` entry, and `npm run package` still produces a valid
ZIP. The full list is in [`.clinerules`](.clinerules).

### Roadmap, issues and releases

* **Issues** — every planned feature is an issue labelled `roadmap`, grouped by
  area and [milestone](https://github.com/Fyrhaven/Fyrhaven-CRM/milestones).
* **Releases** — `cd fyrhaven-crm && npm run release` tests, packages, tags
  `fyrhaven-crm-vX.Y.Z` and attaches the ZIP to the GitHub release. `npm run
  ship` lands the open release pull requests into `main` first.

## Licence

The plugin is released under the same licence as Bulwark Mail. The record server
in [`fyrhaven-server/`](fyrhaven-server/) is licensed per install — a
self-hosted install verifies its own key, offline, with no call back home. See
[`fyrhaven-server/LICENSING.md`](fyrhaven-server/LICENSING.md).

