# Bulwark Mail plugins

Plugins for [Bulwark Mail](https://github.com/zyntrax/bulwark) — the webmail
built on Stalwart. Each plugin is published here with its **source** and its
**build script**; installable ZIPs are attached to
[GitHub Releases](https://github.com/zyntrax/bulwark-plugins/releases).

---

## Plugins

| Plugin | Version | What it does | Install |
|---|---|---|---|
| [**Contact Manager**](contact-manager/) | 1.25.0 | Find, review and merge duplicate contacts across all address books. One *Contact Manager* page with *Duplicates*, *Contacts* and *Projects* sub-tabs, command palette scan, duplicate hints in the contact details and while saving, a full contact editor with create/edit/delete, a 360° contact profile (recent messages, meetings, files with downloads, open tasks, company rollup, duplicate check) and company profiles, local projects with milestones as tasks, time and expenses with billable totals and JSON export/import, nickname preservation, undo for merges, English and German. | [Latest release](https://github.com/zyntrax/bulwark-plugins/releases/latest) |

---

## Repository layout

```
bulwark-plugins/
├── README.md               # this file
├── .gitignore
└── contact-manager/        # source of the Contact Manager plugin
    ├── manifest.json
    ├── package.json
    ├── vitest.config.mjs
    ├── CHANGELOG.md
    ├── README.md           # full documentation of the plugin
    ├── src/                # plugin source
    ├── test/               # vitest suite
    ├── test-utils/         # fake host API and UI-kit stand-in
    └── scripts/            # packaging and release scripts
```

**Installable ZIPs live on GitHub Releases.** `npm run release` builds the ZIP
from the tagged source and attaches it to the release, so the download and the
tag can never drift apart.

---

## Installing a plugin

1. Download the plugin's `contact-manager.zip` from
   [GitHub Releases](https://github.com/zyntrax/bulwark-plugins/releases).
2. In Bulwark Mail, go to **Admin → Plugins** (or **Settings → Plugins** if
   the administrator allows user uploads) and upload the ZIP.
3. Confirm the permissions the plugin asks for.

The ZIP must contain `manifest.json` and `index.js` **at its root** — that is
what the plugin loader expects.

---

## Working on a plugin

Every plugin with a `package.json` is developed with npm. The source tree is
self-contained; `node_modules` and build output are never committed.

```bash
cd contact-manager
npm install        # once — dev dependencies only
npm test           # builds first, then runs the vitest suite
npm run package    # builds and writes contact-manager.zip
```

See [`contact-manager/README.md`](contact-manager/README.md) for the full
documentation: architecture, the plugin host contract, the data model, the
duplicate-detection and merge rules, and the conventions an AI coding
assistant must follow when changing the code.

### Publishing a new version

1. **Merge the work into `main`.** Feature branches (`feat/contact-manager-*`)
   are merged through a pull request, which also closes the shipped roadmap
   issues. Keep the `contact-manager` mirror branch in step with `main`, and
   delete the merged feature branch — `main` and `contact-manager` are the only
   long-lived branches.
2. Bump `version` in the plugin's `manifest.json` (and `package.json`) on
   `main`, and add the matching `CHANGELOG.md` entry — newest on top.
3. `npm test` — all tests green.
4. Commit and push `main`, then run `npm run release` from `main`.
5. The release script rebuilds the ZIP, tags `contact-manager-vX.Y.Z`, pushes
   the tag and attaches the ZIP to the GitHub release. It refuses to run when
   `manifest.json`, `package.json` and the top `CHANGELOG.md` entry disagree.

`cd contact-manager && npm run ship` does the whole thing in one command: it
merges the open release pull requests into `main` (retargeting stacked ones),
keeps the `contact-manager` mirror in step and then runs `npm run release`.
`npm run ship -- --dry-run` prints the plan and changes nothing;
`--no-release` stops after the merge.

### Roadmap, issues and releases

- **Roadmap** — the [milestones](https://github.com/zyntrax/bulwark-plugins/milestones)
  map the planned Contact Manager releases; every feature is a GitHub issue
  labelled `roadmap`, grouped by area and milestone.
- **Releases** — `cd contact-manager && npm run release` tests, packages,
  tags `contact-manager-vX.Y.Z` and uploads the ZIP to GitHub Releases (see
  [`scripts/release.mjs`](contact-manager/scripts/release.mjs)).

---

## License

See the individual plugin folders. Unless stated otherwise, the code in this
repository is released under the same license as Bulwark Mail.
