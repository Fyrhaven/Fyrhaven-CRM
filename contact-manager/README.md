# Contact Manager — a Bulwark Mail plugin

Find, review and merge **duplicate contacts** across all address books, drawn
entirely with Bulwark's own UI kit so it looks like part of the app. It is
meant to grow into a general contact-management addon.

This document is written for **human developers and AI coding assistants**.
Section 9 (“Working on this plugin”) is the part an AI model should read
first; section 10 is a compact, machine-checkable contract.

---

## 1. Purpose

The webmail stores contacts as JSContact cards in one or more address books.
Cards are added by hand, by import, by mail clients and by other software, so
the same person routinely exists several times over. Contact Manager finds
those cards, shows the user **exactly** what would change, and only then
merges them — one contact is kept, the missing details of the others are
copied into it, and the rest are deleted.

Design rules that hold everywhere in this codebase:

1. **Never delete before the data is safe.** The kept contact is patched
   first; if that update fails, the whole group is skipped.
2. **One decision point.** Every entry point (page, command palette, contact
   list toolbar, contact details) funnels into the same review dialog.
3. **Show the plan, not just a result.** The dialog shows the complete details
   of the contact selected to keep, marks every value the merge adds in green
   with `+`, and marks values that differ on the duplicates in orange with
   `≠` (they are not merged).
4. **Pure logic is separable.** Detection, merge planning and display shaping
   are plain functions over plain data, so they are unit-testable without a
   browser, a DOM or the plugin host.
5. **Never cache contacts.** `api.storage` holds only settings-derived state
   (hidden group signatures, the last scan summary).

---

## 2. Features and surfaces

| Surface | Where it appears | What it does |
|---|---|---|
| `app-page` slot | Navigation rail → *Contact Manager* | Statistics, duplicate groups, hide/restore, multi-select, *Review…* |
| Command palette action | Ctrl+K → *Find duplicate contacts* | Scans everything, opens the review dialog |
| Contact list action | Contact list toolbar → *Find duplicates in selection* | Scans only the selected contacts |
| `contact-detail-section` slot | Inside an open contact | A *Duplicate check* block with a *Review duplicates* button |
| `plugin-dialog` slot | Modal, opened by all of the above | The review/merge dialog — the only place that deletes |

All four entry points open the same review dialog. One place decides what is
kept and what is deleted.

---

## 3. Repository layout

```
contact-manager/
├── manifest.json           # id, version, permissions, settings schema, en + de strings
├── package.json            # scripts and dev dependencies (no runtime deps)
├── vitest.config.mjs       # test config + the @plugin-host/ui alias
├── .gitignore              # node_modules, dist, *.zip, logs
├── CHANGELOG.md            # user-facing history, newest on top
├── README.md               # this file
├── src/
│   ├── index.js            # slots, hooks, activate() — wiring only
│   └── lib/
│       ├── contacts.js     # JSContact readers, loaders, settings flags
│       ├── duplicates.js   # detection (union-find), merge planning, merging
│       ├── labels.js       # shared display helpers and toasts
│       ├── manager-page.js # the Contact Manager page (app-page slot)
│       ├── review-dialog.js# the review/merge dialog (plugin-dialog slot)
│       ├── detail-section.js# the duplicate hint in contact details
│       └── preview.js      # display shaping for the dialog (kept/added/conflicts)
├── test/
│   ├── fixtures.mjs        # card builders
│   ├── contacts.test.mjs   # readers, name/email/phone extraction
│   ├── duplicates.test.mjs # normalisation, keys, grouping
│   ├── merge.test.mjs      # merge planning and the merge run
│   ├── preview.test.mjs    # complete details, added values, conflicts, counts
│   ├── ui-page.test.mjs    # the manager page
│   ├── ui-dialog.test.mjs  # the review dialog and detail section
│   └── bundle.test.mjs     # the built bundle + locale completeness
├── test-utils/
│   ├── fake-api.mjs        # a recording fake of the plugin host API
│   └── ui-kit.mjs          # stand-in for @plugin-host/ui
└── scripts/
    └── package.mjs         # builds contact-manager.zip
```

> `src/lib/*.js` must stay free of `api` and DOM access wherever possible —
> that is what keeps the unit tests fast and the code portable. Only
> `duplicates.js` (merge run, storage), `manager-page.js`, `review-dialog.js`
> and `detail-section.js` are allowed to touch the host.


## 4. Architecture

### 4.1 The plugin host contract

The webmail loads the plugin as **CommonJS** and provides three externals:

* `react` — the UI library,
* `@plugin-host` — the plugin API (`api.contacts`, `api.addressBooks`,
  `api.ui`, `api.i18n`, `api.storage`, `api.toast`, `api.log`, `api.plugin`),
* `@plugin-host/ui` — the UI kit (components only, no logic).

`src/index.js` exports exactly three things:

```js
export const slots  = { 'app-page': {component, shouldShow},
                        'plugin-dialog': {component},
                        'contact-detail-section': {component, shouldShow} };
export const hooks  = { async onAction({ surface, actionId, context }) {} };
export async function activate(pluginApi) {}
```

* **Slots** are React components rendered by the host in an iframe. The host
  passes `extraProps` from `api.ui.openDialog` in as props, and `onResult`
  closes the dialog with a value.
* **Hooks** are plain handlers running the host's background frame. Only
  `onAction` is used; it reacts to the buttons registered with
  `api.ui.setActions`.
* **`activate()`** is the one-shot initialiser. It publishes the page entry
  and the action buttons, and re-publishes on locale and settings changes so
  labels and the *enabled* switch stay correct.

`activate()` wraps `publish()` in a `try/catch` on purpose: a host that is too
old, or that is missing one of the UI permissions, must not stop the plugin
from loading.

### 4.2 Data model

Contacts are **JSContact** cards (RFC 9553) as used by Stalwart and Bulwark:

```js
{
  id: 'c1',
  kind: 'individual' | 'group',      // 'group' = distribution list, never a duplicate
  name: 'Ada Lovelace' | { full } | { components: [{kind, value}] },
  emails: { home: { address: 'ada@example.org', pref: 1 } },
  phones: { mobile: { number: '+49 176 …', pref: 1 } },
  addresses: { home: { full | components | street, locality, … } },
  organizations: { _: { name } },
  titles: { _: { name } },
  notes: { _: { note } },
  nicknames: { _: { name } },
  onlineServices: { _: { uri, service, user } },
  links: { _: { uri } },
  media: { _: { uri } },
  keywords: { 'vip': true },
  personalInfo: { _: { value } },
  anniversaries: { _: { kind, date } },
  addressBookIds: { 'book-1': true },
  created: '2024-01-01T00:00:00Z',
  updated: '2024-06-01T00:00:00Z',
}
```

Imports can also deliver plain arrays instead of keyed maps. `src/lib/contacts.js`
reads **both** shapes everywhere. Two spellings of the same field must never
be introduced; always go through the helpers in `contacts.js`:

| Helper | Purpose |
|---|---|
| `contactName(card)` | Display name: JSContact `name`, flat `fullName`/`firstName`+`lastName`, nickname, else the primary email |
| `emailEntries(card)` / `phoneEntries(card)` | All entries as `[{ key, address \| number, pref, … }]` |
| `primaryEmail(card)` / `primaryPhone(card)` | The preferred entry (lowest `pref`), or `null` |
| `bookIds(card)` | The address books the card is in |
| `isMergeable(card)` | Has an id and is not a `kind: 'group'` distribution list |
| `loadCards(api)` / `loadBooks(api)` | Fetch everything; throw on failure |
| `matchOptions(settings)` | The three match strategies; **a missing setting means “on”** |

The `name` of a card may also arrive as a flat `fullName` or as
`firstName` + `lastName`; `contactName` handles every shape.

### 4.3 Permissions

| Permission | Needed for |
|---|---|
| `contacts:read` | Listing and searching contacts |
| `contacts:write` | Updating and deleting contacts during a merge |
| `ui:app-page` | The Contact Manager page |
| `ui:contacts` | The contact list action and the contact detail section |
| `ui:commands` | The command palette action |
| `ui:observe` | The `plugin-dialog` slot |

Every slot and action must be covered by a permission — `test/bundle.test.mjs`
asserts this, so a new surface without a permission fails the test run.


## 5. How duplicates are found

Detection is a pure function in `src/lib/duplicates.js`:

```js
findDuplicateGroups(cards, opts, dismissed) -> [{ signature, strength, reasons, members }]
```

Every contact is reduced to **comparison keys**; contacts that share a key
are joined with a **union-find**, so the relation is transitive — if A~B and
B~C, all three end up in one group. Each connected component with two or more
members becomes a group.

### 5.1 Keys and normalisation

| Strategy | Key prefix | Normalisation | Strength |
|---|---|---|---|
| Same email address | `e:` | trimmed, lower-cased | **certain** (`strong`) |
| Same phone number | `p:` | digits only, leading `00` dropped, fewer than 7 digits ignored | **certain** (`strong`) |
| Same name (full) | `n:` | NFKD, diacritics stripped, punctuation → spaces, tokens sorted | possible |
| Same name (core) | `c:` | as above, but single-letter tokens dropped | possible |

* `normalizeEmail('  A@B.de ') → 'a@b.de'`
* `normalizePhone('+49 176 1234567')` and `normalizePhone('0049 176 1234567')`
  agree; `'12345'` (an extension, a year) is ignored.
* `normalizeName` keeps letters of **any** script (`\p{L}`), so non-Latin
  names never collapse to an empty string.
* The `c:` (core) key drops single-letter tokens (initials): `John A. Smith`
  ≡ `John Smith`. It needs **two** substantial tokens, so a single-word name
  never matches on its own.
* `Doe, John` ≡ `John Doe`, because the tokens are sorted before comparison.

### 5.2 Group strength and reasons

* A group containing at least one `e:` or `p:` key is **Certain match**
  (`strength: 'strong'`).
* A group that only shares a name is **Possible match** (`strength:
  'possible'`) — two different people can share a name, so these must always
  be reviewed by a human before merging.
* `reasons` lists exactly which keys at least two members share, as
  `[{ type: 'email' | 'phone' | 'name', value }]`. The UI renders them as
  “Same email address: a@b.de · Same name”.
* Groups are sorted: certain first, then largest, then by the first
  member's name.
* A group is identified by its `signature` — `g:` plus the sorted member ids.
  The signature is what “hide this group” stores.

### 5.3 Settings that steer detection

`matchOptions(settings)` reads three booleans from the plugin settings:
`matchByEmail`, `matchByPhone`, `matchByName`. **A missing setting means the
strategy is on** (`!== false`), so new strategies default to enabled.

Contact groups (distribution lists, `kind: 'group'`) are never treated as
duplicates and never merged.

### 5.4 The group around one contact

`findGroupFor(api, contact, opts)` is the contact-details path. It queries
`api.contacts.search` with the contact's primary email and its name, keeps
only the hits that share a normalised key with the contact, and groups those
candidates among themselves. The first search that yields a candidate is
enough. It returns `null` when there is no duplicate.

---

## 6. What a merge does

### 6.1 Choosing the contact to keep

`pickPrimary(members)` is fully deterministic:

1. the contact with the **most populated fields** wins (13 fields counted),
2. ties go to the **oldest `created`** timestamp,
3. ties go to the **lowest id** (string compare).

The review dialog lets the user override this per group with a *Keep*
selector; `planMerge(group, keepId)` honours that override.

### 6.2 Building the patch

`planMerge(group, keepId)` returns `{ primary, others, patch, added }`:

* `patch` is a **partial JSContact card** for `api.contacts.update`. The host
  treats an omitted key as “keep” and `undefined` as “clear”, so the patch
  only ever contains keys that actually change.
* Map fields are sent as **complete unions**, because the host replaces a map
  wholesale. Unioned fields: `emails`, `phones`, `addresses`,
  `onlineServices`, `links`, `nicknames`, `notes`, `anniversaries`. Entries
  are deduplicated by normalised address / number / content, and new entries
  get collision-free keys (`key`, `key-2`, `key-3`, …) next to the kept
  contact's own.
* `keywords` is a plain `{ name: boolean }` map and is **combined**, not
  unioned by key.
* Filled once when the kept contact has nothing: `name`, `organizations`,
  `titles`, `personalInfo`, `media` — copied from the first donor that has
  them.
* **Never touched:** `uid`, `created`, `updated`, `addressBookIds`,
  encryption keys, and any client-only field.
* `added` is the list of everything the merge brings in,
  `[{ field, value, fromId }]`, in the order it would appear.
* `previewFields(plan)` turns a plan into the complete details of the contact
  to keep, per field: `kept` (already there, stays), `added` (green `+`,
  merged in, with its source contact) and `conflicts` (orange `≠`, a value
  another contact has in a single-value field such as the name; the kept
  contact's own value stays, so that value is not merged). The review dialog
  renders this for whichever member the *Keep* selector points at.

### 6.3 Running the merge

`mergeGroups(api, groups, keepBySignature)` runs the groups **in order**:

1. `api.contacts.update(plan.primary.id, plan.patch)` — when the patch is not
   empty. If the update throws, the group is skipped and its duplicates are
   reported as failed. **Nothing is deleted without its details being kept
   first.**
2. `api.contacts.remove(other.id)` for each remaining member, one by one.
   A failure here is collected and reported, but the group still counts as
   merged.

It returns `{ merged, removed, failed }`; `failed` is a list of contact ids.
`toastMergeResult` in `labels.js` turns that into the success toast or, if
anything failed, the partial-failure warning.

### 6.4 Hidden groups

Hidden groups are stored as signatures in `api.storage` under
`dismissedGroups` (`DISMISSED_KEY`). A hidden group stays out of the scan
results until it is restored; adding or removing a member changes the
signature, so the group shows up again on its own. The last scan's summary
is stored under `lastScan` (`LAST_SCAN_KEY`).

---

## 7. Build, test and package

```bash
cd contact-manager
npm install        # once — dev dependencies only, no runtime dependencies
npm test           # builds first (pretest), then runs the vitest suite
npm run build      # esbuild -> dist/index.js
npm run package    # build + scripts/package.mjs -> contact-manager.zip
```

| Script | What it does |
|---|---|
| `npm run build` | `esbuild src/index.js --bundle --format=cjs --platform=browser --target=es2020 --charset=utf8 --outfile=dist/index.js` with `react`, `react-dom`, `react-dom/client`, `react/jsx-runtime`, `@plugin-host` and `@plugin-host/ui` kept **external** |
| `npm test` | Runs `pretest` (the build) and then `vitest run` — currently **66 tests in 7 files** |
| `npm run package` | Builds and writes `contact-manager.zip` with `manifest.json` and `index.js` at the ZIP root, then re-opens the ZIP to verify its entries |

The bundle is CommonJS because the host `require()`s it; React and the
plugin host are **not** bundled, the host provides them.

### 7.1 The test suite

| File | Covers |
|---|---|
| `test/contacts.test.mjs` | Name/email/phone extraction across the card shapes, `isMergeable`, `matchOptions` |
| `test/duplicates.test.mjs` | Normalisation, key building, union-find grouping, strength, reasons, sorting, hidden groups |
| `test/merge.test.mjs` | `pickPrimary`, `planMerge` (unions, fills, keywords, patch shape), `mergeGroups` (update before remove, failure handling) |
| `test/ui-page.test.mjs` | The manager page: scanning, statistics, hide/restore, selection |
| `test/preview.test.mjs` | The complete details of the kept contact, added values with their source, not-merged conflicts, and the summary counts |
| `test/ui-dialog.test.mjs` | The review dialog (complete details, colour-coded merge preview, footer buttons, keep-selector, confirm, cancel) and the contact detail section |
| `test/bundle.test.mjs` | The **built** bundle: exported slots/hooks, `activate`, `onAction`, `shouldShow`, and that every string and every settings label exists in **en** and **de** |

`test/bundle.test.mjs` evaluates `dist/index.js` with a `require` that only
knows `react`, `@plugin-host` and `@plugin-host/ui` — the same shape as the
real host. That is why `npm test` must build first.

`test-utils/fake-api.mjs` is a **recording** fake: it logs every call
(`api.calls('contacts.update')`) and lets a test stub individual methods.
`test-utils/ui-kit.mjs` is a stand-in for `@plugin-host/ui`; `vitest.config.mjs`
aliases the real module name to it, so the source can import
`@plugin-host/ui` unchanged.

**A new user-visible string must be added to `manifest.json` in both `en` and
`de`** — `bundle.test.mjs` fails otherwise. Do not hard-code user-visible
text in the source; always use `t('key')`.

---

## 8. Installing in Bulwark

Build the ZIP (`npm run package`), then upload `contact-manager.zip`:

* **Admin**: Admin dashboard → Plugins (can be enabled for everyone), or
* **User**: Settings → Plugins, if the administrator allows uploads.

The webmail asks the user to confirm the permissions (`contacts:read`,
`contacts:write` and the four UI surfaces). For live development, start the
webmail with `PLUGIN_DEV_DIR` pointing at a folder that contains this plugin's
folder.


---

## 9. Working on this plugin (for AI coding assistants)

### 9.1 Orientation — read in this order

1. `manifest.json` — the contract with the host: id, version, permissions,
   settings schema, and every translated string.
2. `src/index.js` — the wiring: which slots exist, which actions are
   published, when `activate()` runs.
3. `src/lib/duplicates.js` — the heart: normalisation, detection, merge
   planning, the merge run.
4. `src/lib/contacts.js` — how a card is read.
5. `src/lib/review-dialog.js` and `src/lib/manager-page.js` — the UI.
6. The matching file in `test/` — the expected behaviour, in executable form.

### 9.2 Hard rules

* **Do not change the host contract.** The exports of `src/index.js` are
  `slots`, `hooks` and `activate`. A slot component is a React component
  created by a `make*` factory that takes `(React, api)`.
* **Do not add runtime dependencies.** `package.json` has `devDependencies`
  only; the bundle must stay self-contained.
* **Do not hard-code user-visible strings.** Use `t('key')` /
  `api.i18n.t('key', vars)` and add the key to `manifest.json` under **both**
  `locales.en` and `locales.de`.
* **Do not bypass the review dialog.** Nothing outside
  `src/lib/review-dialog.js` may call `api.contacts.remove`.
* **Do not delete a contact before its data is kept.** Keep the
  update-then-delete order in `mergeGroups` intact.
* **Do not add a permission silently.** Every new surface needs a permission
  in `manifest.json`, and `bundle.test.mjs` checks that the declared
  permissions cover the slots.
* **Do not cache contacts in `api.storage`.** Only the hidden-group
  signatures and the last scan summary belong there.
* **Keep the pure parts pure.** Detection, planning and preview shaping stay
  free of `api` and DOM access so they remain unit-testable.

### 9.3 Definition of done

A change is complete when:

1. `npm test` passes — all 66 tests, plus any new test you added.
2. New behaviour has a test in the matching `test/*.test.mjs` file, and the
   test name says what the behaviour *is*, not how it is implemented.
3. New strings exist in `en` **and** `de`.
4. `npm run package` produces a valid `contact-manager.zip` whose root holds
   `manifest.json` and `index.js`.
5. The `version` in `manifest.json` is bumped and `CHANGELOG.md` has an
   entry for it (see below).
6. The built artifacts under `build/` in the published repository are
   regenerated from the same source, so the ZIP users download matches the
   code in the repository.

### 9.4 Making a change — the loop

```bash
cd contact-manager
npm test                 # 1. build + run the suite
npm run package          # 2. rebuild the installable ZIP
```

Then copy the artifacts into the published repository and push:

```bash
cp dist/index.js        ../bulwark-plugins-repo/build/contact-manager/index.js
cp manifest.json        ../bulwark-plugins-repo/build/contact-manager/manifest.json
cp contact-manager.zip  ../bulwark-plugins-repo/build/contact-manager/contact-manager.zip
```

### 9.5 Test-writing conventions

* Pure logic → a plain unit test in `test/duplicates.test.mjs`,
  `test/merge.test.mjs` or `test/contacts.test.mjs`. No DOM.
* UI → `test/ui-page.test.mjs` or `test/ui-dialog.test.mjs` with
  `@testing-library/react`, `act()` around every state-changing call, and
  `fakeApi` for the host.
* The host is **always** faked. Never call the network, never touch a real
  address book, never write outside `api.storage`.
* Assert on **behaviour**, not on markup: `screen.getByRole('button', {
  name: 'Merge' })` rather than snapshotting the tree.
* Use the card builders in `test/fixtures.mjs` (`makeCard`) instead of
  hand-writing card literals.

### 9.6 Common pitfalls

| Pitfall | Consequence | Do this instead |
|---|---|---|
| Adding a string only to `en` | `bundle.test.mjs` fails | Add it to `en` **and** `de` |
| Patching a map field with only the new entries | The host replaces maps wholesale — existing entries are lost | Send the **complete union** |
| Sending `undefined` in the patch | The host clears the field | Omit the key instead |
| Deleting before updating | Data loss if the update fails | Update first, then delete |
| Hard-coding English text | Breaks the German locale and the locale test | `t('key')` + manifest entry |
| Reading `card.emails` directly | Breaks on array-shaped cards from imports | `emailEntries(card)` from `contacts.js` |
| Matching a single-word name | False positives on common surnames | Require two substantial tokens (`coreNameKey`) |
| Treating a `kind: 'group'` card as a person | Distribution lists get merged | `isMergeable` filters them out |
| Adding a slot without a permission | The host refuses the surface | Add the permission to `manifest.json` |

---

## 10. Machine-checkable contract

Everything below is asserted by the test suite. If a change breaks one of
these, the build is broken.

```
Manifest
  id, version (semver), permissions[], settings schema
  locales.en and locales.de contain exactly the same key sets

Exports of src/index.js
  slots['app-page'], slots['plugin-dialog'], slots['contact-detail-section']
  hooks.onAction
  activate(pluginApi)

Detection
  findDuplicateGroups(cards, opts, dismissed) -> groups
  group = { signature, strength: 'strong'|'possible', reasons[], members[] }
  strong  <=> the group shares an email or a phone number
  possible <=> the group shares only a name
  dismissed signatures are excluded from the result

Merging
  pickPrimary(members) -> deterministic (fields, then created, then id)
  planMerge(group, keepId) -> { primary, others, patch, added }
  patch contains only changed keys; map fields are complete unions
  mergeGroups() updates the kept contact BEFORE removing the others

Safety
  a failing update leaves the duplicates untouched
  a failing removal is reported, not swallowed
  nothing outside review-dialog.js calls contacts.remove
```

---

## 11. Repository, releases and changelog policy

### 11.1 Where the code lives

| Path | Contents |
|---|---|
| `contact-manager/` | The full source tree — `src/`, `test/`, `test-utils/`, `scripts/`, `manifest.json`, `package.json`, `vitest.config.mjs`, `README.md`, `CHANGELOG.md` |
| `build/contact-manager/` | The published artifacts — `manifest.json`, `index.js` (the CommonJS bundle) and `contact-manager.zip` (the installable plugin) |

Both live in **`zyntrax/bulwark-plugins`** on GitHub. The `build/` artifacts
are always regenerated from the source in the same commit — the ZIP a user
downloads must match the code in the repository.

### 11.2 Release checklist

1. Bump `version` in `manifest.json` (semver).
2. Add a `CHANGELOG.md` entry for that version — newest on top, under a
   `## [x.y.z] — YYYY-MM-DD` heading, split into `### Added`,
   `### Changed`, `### Fixed`, `### Removed` (drop the empty ones).
3. `npm test` — all tests green.
4. `npm run package` — rebuild the ZIP.
5. Copy `manifest.json`, `dist/index.js` and `contact-manager.zip` into
   `build/contact-manager/`.
6. Commit the source **and** the artifacts together.
7. Run `npm run release`. It tests, packages, refreshes
   `build/contact-manager/`, checks the artifacts are committed, tags
   `contact-manager-vX.Y.Z` on `main`, pushes the tag and creates the GitHub
   release with the ZIP attached.
8. Close the shipped roadmap issues.

### 11.2.1 Roadmap and todos

There is **no local todo file**. The roadmap lives in GitHub:

* [Milestones](https://github.com/zyntrax/bulwark-plugins/milestones) — one per
  planned release.
* [Issues labelled `roadmap`](https://github.com/zyntrax/bulwark-plugins/issues?q=is%3Aissue+label%3Aroadmap)
  — the individual features and tasks.
* The pinned roadmap issue — the top-level vision linking every milestone.

New ideas become a new issue with the `roadmap` label and a milestone.

### 11.3 Changelog policy

* The changelog is **user-facing**: describe what a user can now do, not how
  the code is structured.
* Every release gets an entry — including bug fixes. A release without a
  changelog entry is not finished.
* The version in `manifest.json` and the top entry in `CHANGELOG.md` must
  always agree.

### 11.4 Versioning rules

| Change | Bump |
|---|---|
| New feature, new surface, new setting | minor (`1.1.0`) |
| Bug fix, wording change, internal refactor | patch (`1.0.1`) |
| Removing a surface, a setting or a permission | major (`2.0.0`) — announce it first |
