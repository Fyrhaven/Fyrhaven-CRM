# Bulwark Mail plugins

Plugins for [Bulwark Mail](https://github.com/zyntrax/bulwark) — the webmail
built on Stalwart. Each plugin is published here with its **source**, its
**build script** and the **installable artifact** produced from that source.

---

## Plugins

| Plugin | Version | What it does | Install |
|---|---|---|---|
| [**Contact Manager**](contact-manager/) | 1.2.0 | Find, review and merge duplicate contacts across all address books. Contact Manager page, command palette scan, duplicate hints in the contact details, English and German. | [`contact-manager.zip`](build/contact-manager/contact-manager.zip) |
| [**Remove contact duplicates**](build/remove-contact-duplicates/) | 0.0.1 | Minimal prototype: a contact-list action that lists the contacts of the account. Superseded by *Contact Manager*. | [`remove-contact-duplicates.zip`](build/remove-contact-duplicates/remove-contact-duplicates.zip) |

---

## Repository layout

```
bulwark-plugins/
├── README.md               # this file
├── .gitignore
├── contact-manager/        # source of the Contact Manager plugin
│   ├── manifest.json
│   ├── package.json
│   ├── vitest.config.mjs
│   ├── CHANGELOG.md
│   ├── README.md           # full documentation of the plugin
│   ├── src/                # plugin source
│   ├── test/               # vitest suite
│   ├── test-utils/         # fake host API and UI-kit stand-in
│   └── scripts/            # packaging script
└── build/                  # the published artifacts, one folder per plugin
    ├── contact-manager/
    │   ├── manifest.json
    │   ├── index.js        # the CommonJS bundle
    │   └── contact-manager.zip
    └── remove-contact-duplicates/
        ├── manifest.json
        ├── index.js
        └── remove-contact-duplicates.zip
```

**Source and artifacts live side by side on purpose.** The ZIP a user
downloads is built from the source in the same commit, so the two can never
drift apart.

---

## Installing a plugin

1. Download the `.zip` from the `build/` folder of the plugin you want.
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

1. Bump `version` in the plugin's `manifest.json` (semver).
2. Add a `CHANGELOG.md` entry for that version — newest on top.
3. `npm test` — all tests green.
4. `npm run package` — rebuild the ZIP.
5. Copy the plugin's `manifest.json`, `dist/index.js` and `<plugin>.zip` into
   `build/<plugin>/`.
6. Commit the source **and** the artifacts together, then push.

The two build directories always match the source in the same commit.

### Roadmap, issues and releases

- **Roadmap** — the [milestones](https://github.com/zyntrax/bulwark-plugins/milestones)
  map the planned Contact Manager releases; every feature is a GitHub issue
  labelled `roadmap`, grouped by area and milestone.
- **Releases** — `cd contact-manager && npm run release` tests, packages,
  refreshes `build/contact-manager/`, tags `contact-manager-vX.Y.Z` and uploads
  the ZIP to GitHub Releases (see [`scripts/release.mjs`](contact-manager/scripts/release.mjs)).

---

## License

See the individual plugin folders. Unless stated otherwise, the code in this
repository is released under the same license as Bulwark Mail.
