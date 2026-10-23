# AI Handoff - Contact Manager Plugin

> The authoritative handoff for this plugin. It lives in the repository at
> `contact-manager/AI_HANDOFF.md` and is published on GitHub on the branches
> `main` and `contact-manager` (identical content on both).

## Current State
- **Version**: 1.10.0 (`manifest.json` is the single source of truth; `package.json` matches)
- **Last changes**: File downloads on the profile (v1.10.0) on top of company profiles (v1.9.0), the activity tracking (v1.8.0), the Contacts page (v1.7.0), the contact editor (v1.6.0), nickname preservation (v1.5.0), the save-time warning (v1.4.0) and merge undo (v1.3.0)
- **Released**: `contact-manager-v1.9.0` is the newest GitHub release (v1.8.0,
  v1.7.0, v1.6.0 and v1.5.0 before it). `main` and `contact-manager` are in
  step at v1.9.0 (PRs #52, #53, #55, #56 and #59 merged).
- **Files modified in 1.4.0**:
  - `src/lib/watch.js` - new: `isSameCard`, `findDuplicatesOf`, `warnAboutDuplicates`
  - `src/index.js` - hooks `onAfterContactCreate` / `onAfterContactUpdate`
  - `manifest.json` - `warnOnSave` setting, `watch.toast` string in `en` and `de`, version bumped
- **Files added in 1.3.0**:
  - `src/lib/undo.js` - new: the undo records, their retention policy and `undoLastMerge`
  - `test/undo.test.mjs` - the undo tests

## Implementation Summary

### Meetings, files and company rollup (v1.8.0)

The profile now tracks three more activity sources without manual linking:
calendar events (`eventsForContact` on `api.calendar.getEvents`), attachments
of the recent messages (`attachmentsForMessages`, de-duplicated by name and
size) and the company line (`companyNameOf` / `companyOf` /
`peopleOfCompany`). Companies are contacts with `kind: 'org'`; people link by
organisation name or email domain, and `companyDomains` derives a company's
domains from its people when it has none. The manifest gained `calendar:read`,
and every optional call degrades to a muted line.

### Contacts page and 360° profile (v1.7.0)

The second app page (`pageId: 'contacts'`) is the CRM record view.
`profile.js` holds the pure rules (`filterCards`, `contactTerms`,
`tasksForContact`, `timelineForContact`); `profile-page.js` renders the list
plus the profile (details, tags, notes, the duplicate block, recent messages
from `api.email.search`, open tasks from `api.tasks.list`). The manifest now
asks for `email:read` and `tasks:read`; both calls are wrapped so a missing
permission leaves the profile readable with a muted explanation.

### Contact editor (v1.6.0)

Bulwark has no contact form surface, so the plugin ships its own. `editor.js`
is the pure model (`emptyDraft`, `draftFromCard`, `cardFromDraft`,
`validateDraft`, `isDirty`); `editor-dialog.js` is the form. `index.js`
dispatches the one `plugin-dialog` slot to either the review dialog or the
editor (`extraProps.editor`), and `open-editor.js` holds `openEditor` /
`toastEditorResult` for the palette, the page header and the contact details.
Create posts to `api.contacts.create`, edit patches with
`api.contacts.update` (empty fields as `undefined` = clear), delete uses
`api.contacts.remove` behind a confirmation. Validation blocks empty drafts,
malformed emails, too-short phones and a missing address book; cancelling a
dirty draft asks first; a failed write keeps the dialog open.

### Nickname preservation on merge (v1.5.0)

When duplicate members carry different names, `nameSuggestions(primary, others)`
lists the donor names (normalised comparison, no emails, no existing nicknames).
`planMerge` writes each accepted name into `patch.nicknames` by default and
returns `nameSuggestions` for the dialog; `choices.nicknames[key] = 'drop'`
excludes one, and a name that becomes the contact's name (`choices.name`) is
never also added as a nickname. The review dialog renders a *Different names*
section with *Keep as a nickname* / *Use it as the name* / *Discard it* per
suggestion. The nickname rides in the same update that patches the kept
contact, so the undo record (`buildEntry`) captures and reverts it too.

### Save-time duplicate warning (v1.4.0)

The host has no contact form surface, so the plugin watches the observer
hooks that fire after a save (`onAfterContactCreate`, `onAfterContactUpdate`).
`warnAboutDuplicates` searches the address books with `findGroupFor` (email,
then name), drops the saved card itself (by id, or by content when the host
sends no id) and toasts a warning naming the match and the reason. Observer
hooks cannot stop a save, so the feature never blocks the user. The
`warnOnSave` setting turns it off; the `contact-detail-section` block stays
the persistent, clickable hint (it has the *Review duplicates* button).

### Merge undo (v1.3.0)

`src/lib/undo.js` stores one bounded, expiring batch per merge under
`undoBatches`: `{ at, expiresAt, entries: [{ keptId, before, absent, removed }] }`.
Retention: `undoMinutes` (default 15, 0 = off), 100 cards / ~400 kB, oldest
batch evicted first, expired records purged on load and on every read.
`undoLastMerge` re-creates the removed cards first and reverts the kept
contact only when its duplicates are back; failures stay retryable. Surfaces:
the page banner (*Undo merge* / *Forget*) and the palette action
*Undo the last merge*.

### Merge duplicate window visual indicators (v1.2.0)

The review/merge dialog shows the **complete details** of whichever contact is
selected in the *Keep* selector. The details redraw when the selection changes.

| Indicator | Meaning |
|-----------|---------|
| `Kept` (green) / `Deleted` (red) badges | Which group member is kept and which ones are removed |
| Plain badge | Value already on the kept contact and unchanged |
| `+ value` (green, tone `success`) | **New information** merged in from another contact |
| `~ value` (orange, tone `warning`) | **Changed** — the user chose this donor value to replace the kept contact value; `was …` shows the old value |
| `≠ value` (orange, tone `warning`) | Another contact has a different value in a single-value field; the kept contact's value stays, so this value is **not merged** |
| `from {names}` line | Source contact(s) of the added/not-merged values |
| Summary line | `{kept} kept · {added} new · {changed} changed · {conflicts} not merged` |

An *How to read this* legend above the groups explains every indicator.

### Key Functions

**`src/lib/watch.js`** (v1.4.0):
- `isSameCard(a, b)` - the same contact by id, or by content when the host sends no id
- `findDuplicatesOf(api, contact)` - the duplicate group around a just-saved contact, minus the contact itself; `null` when there is none
- `warnAboutDuplicates(api, contact)` - the non-blocking warning toast; returns the matches (empty when there were none, the setting is off, or the check failed)

**`src/lib/undo.js`** (v1.3.0):
- `undoWindowMs(settings)` / `buildEntry(plan, removedCards)` / `enforceLimits(batches)`
- `readUndo(api)` / `purgeUndo(api)` / `saveUndo(api, entries)` / `clearUndo(api)` - the bounded, expiring store
- `undoLastMerge(api)` - re-creates the removed cards, then reverts the kept contact; returns `{ restored, reverted, failed, total }`

**`src/lib/preview.js`**:
- `previewFields(plan)` - the complete per-field picture:
  `{ field, labelKey, kept, previous, added, changed, conflicts }` with `{ value, fromId }` entries
- `conflictFields(plan)` - the conflicting single-value fields and donor options for the Resolve pickers
- `previewCounts(fields)` - totals for the summary line (`kept`, `added`, `changed`, `conflicts`)
- `memberDetails` / `formatAddress` / `formatAnniversary` - unchanged display helpers

**`src/lib/review-dialog.js`**:
- Renders the legend, the member roster, the Keep selector, the Resolve differences pickers, and the complete details of the selected kept contact
- `planMerge(group, keepId, choices)` and `mergeGroups(api, groups, keepBy, choicesBy)` carry the choices
- Merge logic is unchanged: update the kept contact first, then remove others

### String Keys (manifest.json, en & de)
- `watch.toast` - the save-time duplicate warning (v1.4.0)
- `dialog.previewTitle`, `dialog.previewNote`, `dialog.previewSummary`
- `dialog.legendTitle`, `dialog.legendNew`, `dialog.legendChanged`, `dialog.legendConflict`, `dialog.legendKept`
- `dialog.resolveTitle`, `dialog.resolveHint`, `dialog.keepValue`, `dialog.useValue`, `dialog.wasValue`
- `dialog.addedFrom`, `dialog.noChanges`, `dialog.field.*`

### Settings (manifest.json `settingsSchema`)
- `enabled`, `autoScan` - the plugin on/off and the automatic scan on open
- `matchByEmail`, `matchByPhone`, `matchByName` - one switch per matching rule
- `undoMinutes` - the undo window in minutes (default 15, `0` = off) (v1.3.0)
- `warnOnSave` - turn the save-time duplicate warning off (v1.4.0)

### Testing
- `test/preview.test.mjs` - complete details, added/changed values, conflicts, counts (7 tests)
- `test/ui-dialog.test.mjs` - green/orange indicators, Keep redraw, legend, merge flow, undo record written after a merge
- `test/undo.test.mjs` - retention window, size limits, eviction, purge, restore, partial restore
- `test/watch.test.mjs` - save-time detection and warning, create and edit paths, setting off
- `test/editor.test.mjs` - draft/card conversions, validation, dirty check
- `test/ui-editor.test.mjs` - create, validation, cancel, edit and delete
- `test/profile.test.mjs` - contact search, task and timeline matching
- `test/ui-profile.test.mjs` - the Contacts page
- `test/ui-page.test.mjs` - undo banner, Undo merge, Forget
- `test/bundle.test.mjs` - palette undo entry, undo action toasts
- Full suite: 148 tests in 13 files

## Roadmap (GitHub)

The roadmap lives on GitHub, not in this file:

- **Milestones** — https://github.com/zyntrax/bulwark-plugins/milestones
  track the planned releases (`v1.2.0` … `v2.0.0`).
- **Feature issues** — https://github.com/zyntrax/bulwark-plugins/issues?q=is%3Aissue+label%3Aroadmap
  are the individual todos, grouped by area and milestone.
- **Pinned roadmap issue** — https://github.com/zyntrax/bulwark-plugins/issues/40
  is the top-level vision with links to every planned feature.

When a feature ships, close its issue in the release commit/PR. New ideas go
into a new issue with the `roadmap` label and a milestone — never into a local
todo list.

## Open Findings (2026-10-21)

One direction shipped, one is still open. Both have a GitHub issue (the
roadmap issue #40 links them):

1. **Nicknames / alias names** — issue **#49** — **shipped in v1.5.0**. The
   research below is kept for context.
2. **Turning the plugin into a real contact manager** — issue **#51**
   (milestone v1.3.0) — **open**. Start with **#9**, the full contact editor
   plus the missing create path; see the note at the end of this file.

### 1. Nicknames / alias names are supported by the host, but the merge drops them (shipped in v1.5.0)

> **Shipped in v1.5.0.** `nameSuggestions()` + `planMerge`'s `nickname`
> handling and the dialog's *Different names* picker implement this. The
> notes below are the original research.

Researched against the Stalwart source (the server behind Bulwark):

- Stalwart stores contacts as vCards and converts them to JSContact with the
  `calcard` crate. Its `JSContactProperty` enum includes **`Nicknames`**,
  `Name`, `SpeakToAs`, `Pronouns`, `PersonalInfo`, `Anniversaries`,
  `Keywords`, `OnlineServices`, `Links`, `Media`, `Organizations`, `Titles`,
  `Notes` and `Addresses` — so the whole JSContact field set the plugin already
  renders is writable, not just readable.
- `nickname` is a **first-class indexed field** in Stalwart's contact search
  (`ContactSearchField::Nickname` in `crates/groupware/src/contact/index.rs`),
  and the JMAP filter parser accepts `nickname` as a filter condition. So
  nicknames are searchable, not decorative.

The gap in this plugin is in `planMerge` (`src/lib/duplicates.js`):

- `nicknames` is one of the `UNION_FIELDS`, so a nickname on a **dropped**
  contact is already carried over to the kept contact. That part works.
- But a *name* is a `FILL_FIELD`: it is only taken from a donor when the kept
  contact has **no** name at all. When two contacts have genuinely different
  names, the donor's name is **silently discarded** — there is no
  `nameConflict` / `alternates` concept in the current code (both probe
  properties are `undefined`).
- So the user's scenario — "Bob" added first, later "Robert Smith" added for
  the same person — merges on the shared email, and the losing name vanishes
  with no offer to keep it.

The feature: when the names differ, let the user keep the discarded name as a
**nickname** (or as a second name) instead of dropping it, e.g. keep
"Robert Smith" as the name and record "Bob" as a nickname. Implementation
notes: `nicknames` is a map union, so the dialog would add the entry to the
existing `nicknames` map with a collision-free key; the merge already reports
`added`/`changed` entries per field, so a nickname suggestion fits that
shape. Needs a new `nameConflict` on the plan plus a picker in the review
dialog, and a `dialog.field.nickname`-style string key in `en` and `de`.

### 2. The plugin is still mostly a duplicate finder, not a contact manager

Agreed and visible in the roadmap: the shipped feature set is scan → review →
merge → remove. Everything that makes it a *manager* (editing, searching,
organising, profiles) is still in milestone **v1.3.0 "Contact workspace and
daily UX"** and unstarted:

- #9 full contact editor inside the plugin
- #10 360-degree contact profile with interaction timeline
- #11 custom fields and per-address-book field schemas
- #12 contact groups and distribution-list management
- #13 smart search and saved searches
- #14 bulk actions
- #15 avatar management and universal hover cards

Two structural reasons the plugin cannot do much more today:

- The host exposes **no contact form surface** — that is why the save-time
  warning (v1.4.0) had to hook the observer hooks instead of validating in a
  form. A real editor (#9) may need host support, or must be built entirely
  inside the plugin.
- The plugin only ever **reads** contacts via `api.contacts.list/search` and
  writes via `update`/`remove`. There is no create-a-contact path in the UI.

Suggested order for the next work: #9 (editor) → #13 (search) → #10 (profile),
because the editor is the prerequisite for every other "manager" feature.

## Versioning Policy
- Follows semantic versioning: MAJOR.MINOR.PATCH
- `manifest.json` version is the single source of truth
- `CHANGELOG.md` top entry must match `manifest.json` version
- Patch: Bug fixes, wording changes, internal refactors
- Minor: New features, new surfaces, new settings
- Major: Removing surfaces, settings, or permissions (announce first)

## Release Checklist
1. merge the feature branch into `main` through a PR (closes the roadmap
   issues) and keep the `contact-manager` mirror branch in step with `main`
2. bump `version` in `manifest.json` (semver) and `package.json`
3. add the `CHANGELOG.md` entry for that version (newest on top)
4. `npm test` - all tests green
5. commit and push the source on `main`, then run `npm run release`
6. the script packages, tags and uploads the ZIP to GitHub Releases; it refuses
   to run when `manifest.json`, `package.json` and the top `CHANGELOG.md` entry
   disagree

`npm run ship` does steps 1, 5 and 6 in one command (merge the open PRs into
`main`, sync the mirror, release); `npm run ship -- --dry-run` previews the plan
and `--no-release` stops after the merge.

## Project Structure
```
contact-manager/
├── manifest.json          # id, version, permissions, settingsSchema, locales (en+de)
├── package.json           # scripts and dev dependencies
├── CHANGELOG.md           # user-facing history
├── README.md              # user-facing plugin documentation
├── AI_HANDOFF.md          # this file - the handoff for the next agent
├── vitest.config.mjs      # test config
├── src/
│   ├── index.js           # slots, hooks, activate() wiring
│   └── lib/
│       ├── contacts.js    # JSContact readers, loaders, settings flags
│       ├── duplicates.js  # detection (union-find), merge planning, merging
│       ├── labels.js      # shared display helpers and toasts
│       ├── manager-page.js # the Contact Manager page
│       ├── review-dialog.js # the review/merge dialog
│       ├── detail-section.js# the duplicate hint in contact details
│       ├── preview.js     # display shaping for the dialog
│       ├── undo.js        # merge undo records, retention, undoLastMerge (v1.3.0)
│       └── watch.js       # save-time duplicate warning (v1.4.0)
├── test/
│   ├── fixtures.mjs       # card builders
│   ├── contacts.test.mjs  # readers, name/email/phone extraction
│   ├── duplicates.test.mjs # normalisation, keys, grouping
│   ├── merge.test.mjs     # merge planning and the merge run
│   ├── preview.test.mjs   # complete details, added/changed values, conflicts
│   ├── ui-page.test.mjs   # the manager page
│   ├── ui-dialog.test.mjs # the review dialog and detail section
│   ├── undo.test.mjs      # undo records: retention, restore, partial failures
│   ├── watch.test.mjs     # save-time duplicate warning
│   ├── editor.test.mjs    # draft/card conversions and validation
│   ├── ui-editor.test.mjs # the create/edit/delete dialog
│   ├── profile.test.mjs   # contact search, task and timeline matching
│   ├── ui-profile.test.mjs # the Contacts page
│   └── bundle.test.mjs    # the built bundle + locale completeness
├── test-utils/
│   ├── fake-api.mjs       # recording fake of plugin host API
│   └── ui-kit.mjs         # stand-in for @plugin-host/ui
└── scripts/
    ├── package.mjs        # builds contact-manager.zip
    └── release.mjs        # tags, pushes the tag, uploads the ZIP to Releases
```

## How to Continue

1. **Run tests**: `cd contact-manager && npm test` (builds first, then runs vitest suite)
2. **Build package**: `npm run package` (creates contact-manager.zip)
3. **Update version**: bump `manifest.json` version (and `package.json`) and add the CHANGELOG entry
4. **Merge**: merge the feature branch into `main` through a PR and keep the
   `contact-manager` mirror branch in step with `main`
5. **Commit**: source only (the ZIP is a GitHub release asset)
6. **GitHub**: run `npm run release` on `main`. It tags
   `contact-manager-vX.Y.Z`, pushes the tag and creates the GitHub release with
   the ZIP attached; the roadmap and todos live in GitHub issues/milestones.

### Where to pick up next

**Direction (2026-10-21): an eWay-CRM-style workspace.** The product goal is no
longer just duplicate cleanup — it is the contact/CRM layer of Bulwark. The
full map of eWay-CRM modules to host capabilities, the phases and the
non-goals live in **issue #54**
(https://github.com/zyntrax/bulwark-plugins/issues/54), linked from the
roadmap issue #40.

Hard limits to remember before promising CRM data:

- `api.storage` is per-account, per-browser `localStorage` — **not** a shared
  server store. Deals, notes or pipelines the plugin invents are single-user
  and do not sync between devices.
- Contacts, address books, mail, calendar events and tasks are native APIs
  (`api.contacts`, `api.email.search`, `api.calendar`, `api.tasks`); custom
  object types and custom fields do not exist.
- There is no server-side scheduler; background work runs only while the
  webmail is open.

Shipped so far: v1.2.0 merge preview, v1.3.0 undo, v1.4.0 save-time warning,
v1.5.0 nickname preservation, v1.6.0 contact editor (create/edit/delete),
v1.7.0 Contacts page and 360° profile, v1.8.0 activity tracking (meetings,
files, company rollup), v1.9.0 company profiles, v1.10.0 file downloads.

**Next: #57.** #22 (company profiles, v1.9.0) and #58 (files, v1.10.0) are
done — companies are contacts with `kind: 'org'`, and the profile lists and
saves the attachments of the interaction history. What is left on the CRM
direction is #57 (projects, milestones, time, expenses — local-only, single
user). Deals/pipeline and custom fields are explicitly out of scope.

## GitHub Integration
- Repository: **zyntrax/bulwark-plugins** (private). The plugin lives in
  `contact-manager/`; there is no separate `bulwark-addons` repository.
- **Branches**: `main` is the release branch and carries the current version.
  `contact-manager` mirrors the plugin work and is kept in step with `main`.
  Feature branches are `feat/contact-manager-<feature>` and are merged into
  `main` through a PR.
- **Roadmap**: https://github.com/zyntrax/bulwark-plugins/issues/40 is the
  single roadmap issue; it links every feature issue. Milestones
  `Contact Manager v1.2.0` … `v2.0.0` group them by release.
- **Releases**: tagged `contact-manager-vX.Y.Z`; installable ZIPs are the
  release assets. The newest release is `contact-manager-v1.9.0`.
- **Cutting a release**: merge the feature PR(s) into `main`, keep
  `contact-manager` in step, bump `manifest.json`/`package.json` + `CHANGELOG.md`
  on `main`, then run `npm run release` — it tags, pushes the tag and uploads
  the ZIP. The script refuses to run when the manifest, package and top
  changelog versions disagree. `npm run ship` automates the merge, the mirror
  sync and the release.
- Ship a feature by closing its issue in the release commit/PR.