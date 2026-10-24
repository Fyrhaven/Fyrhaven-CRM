# Contact Manager — a Bulwark Mail plugin

Find, review and merge **duplicate contacts** across all address books, drawn
entirely with Bulwark's own UI kit so it looks like part of the app. It is
meant to grow into a general contact-management addon.

> **Direction:** an eWay-CRM-style CRM workspace inside Bulwark — contacts and
> companies, activities, follow-ups and a pipeline — within what the plugin
> host allows. The module-by-module map, the phases and the non-goals are in
> [issue #54](https://github.com/zyntrax/bulwark-plugins/issues/54).

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
   of the contact selected to keep: green `+` for values the merge adds,
   orange `~` for values the user chooses to replace, and orange `≠` for
   differing values that stay unmerged.
4. **Pure logic is separable.** Detection, merge planning and display shaping
   are plain functions over plain data, so they are unit-testable without a
   browser, a DOM or the plugin host.
5. **Deletes are undoable.** Every merge leaves a short-lived, size-bounded
   undo record (removed cards plus the kept contact's original values), so a
   merge can be rolled back from the Contact Manager page.

`api.storage` otherwise holds only settings-derived state (hidden group
signatures, the last scan summary).

---

## 2. Features and surfaces

| Surface | Where it appears | What it does |
|---|---|---|
| `app-page` slot | Navigation rail → *Contact Manager* | The whole plugin. Its body is a tab strip: *Overview* (the main page: headline state, a menu of the palette tasks, and a row into every section), *Duplicates* (statistics, duplicate groups, hide/restore, multi-select, *Review…*), *Contacts*, *Projects* and *Health* |
| Command palette action | Ctrl+K → *Find duplicate contacts* | Scans everything, opens the review dialog |
| Contact list action | Contact list toolbar → *Find duplicates in selection* | Scans only the selected contacts |
| Command palette action | Ctrl+K → *Undo the last merge* | Restores the newest undo record while it is live |
| Undo banner | Top of the Contact Manager page | *Undo merge* / *Forget* for the newest merge record |
| `contact-detail-section` slot | Inside an open contact | A *Duplicate check* block with a *Review duplicates* button |
| Create/update hooks | After a contact is saved | A non-blocking warning when the saved contact looks like an existing one |
| Command palette action | Ctrl+K → *New contact* | Opens the contact editor (create) |
| *New contact* button | Contact Manager page header | Opens the contact editor (create) |
| *Edit contact* button | `contact-detail-section` | Opens the contact editor (edit / delete) |
| *Contacts* sub-tab | Contact Manager → *Contacts* | Searchable contact list with a query language (the box stays put while the list scrolls), saved searches with live counts, avatars, and the 360° profile: details, company, duplicates, messages, meetings, files and tasks. Checkboxes select several contacts for *Merge selected* / *Edit selected* / *Clean up* / *Export* / *Delete selected* / *Clear selection* |
| *Projects* sub-tab | Contact Manager → *Projects* | Local client-work projects: status, linked company and people, description, currency and rate, and milestones (real tasks) |
| Command palette action | Ctrl+K → *New project* | Opens the project editor (create) |
| `plugin-dialog` slot | Modal, opened by all of the above, *New contact* and *New project* | The review/merge dialog, the **contact editor** and the **project editor** — the only places that write |

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
│       ├── layout.js      # the plugin-owned page skeleton (the two-pane split)
│       ├── avatar.js      # MD5, the Gravatar URL, and whose picture wins
│       ├── avatar-view.js # the avatar element, which hides itself on failure
│       ├── health.js      # the health rules, their weights and the bands
│       ├── health-page.js # the Health dashboard
│       ├── home-page.js  # the main page: state, the menu and the section rows
│       ├── actions.js    # the tasks the palette and the main page both run
│       ├── search.js      # the query language and the matcher behind the search box
│       ├── phones.js      # E.164 normalisation and the region table
│       ├── emails.js      # email syntax, role addresses, throwaway domains
│       ├── region.js      # the stored country for national numbers
│       ├── normalise.js   # the cleanup plan, its application and its undo record
│       ├── normalise-dialog.js # the cleanup preview
│       ├── saved-searches.js # the queries a user keeps, in api.storage
│       ├── app-shell.js   # the single app page: the Overview/Duplicates/Contacts/Projects/Health sub-tabs
│       ├── bulk.js        # bulk edits and delete for a selection
│       ├── bulk-dialog.js # the bulk editor: tags and address books
│       ├── vcard.js       # contacts to vCard 3.0, for the bulk export
│       ├── capabilities.js# which optional host APIs this instance really has
│       ├── download.js    # hand bytes to the browser as a download (files, project export)
│       ├── manager-page.js # the Duplicates sub-tab
│       ├── review-dialog.js# the review/merge dialog (plugin-dialog slot)
│       ├── detail-section.js# the duplicate hint in contact details
│       ├── preview.js      # display shaping for the dialog (kept/added/changed/conflicts)
│       ├── undo.js        # merge undo records: retention, restore, purge
│       ├── editor.js      # the editor's draft <-> JSContact model, validation
│       ├── editor-dialog.js # the create/edit form (plugin-dialog slot)
│       ├── open-editor.js # one place that opens the editor and toasts the result
│       ├── profile.js     # pure search / task / timeline matching for the profile
│       ├── profile-page.js # the Contacts page: list + 360° profile
│       ├── projects.js    # the local project model, storage and milestone helpers
│       ├── projects-page.js # the Projects page (app-page slot)
│       ├── project-dialog.js # the create/edit project form (plugin-dialog slot)
│       ├── open-project.js # one place that opens the project editor and saves it
│       ├── optional.js    # optional host calls that degrade to null, never throw
│       └── watch.js       # warn about duplicates after a contact is saved
├── test/
│   ├── fixtures.mjs        # card builders
│   ├── contacts.test.mjs   # readers, name/email/phone extraction
│   ├── duplicates.test.mjs # normalisation, keys, grouping
│   ├── merge.test.mjs      # merge planning, conflict choices and the merge run
│   ├── preview.test.mjs    # complete details, added/changed values, conflicts, counts
│   ├── ui-page.test.mjs    # the manager page
│   ├── ui-dialog.test.mjs  # the review dialog and detail section
│   ├── undo.test.mjs       # undo records: retention, restore, partial failures
│   ├── editor.test.mjs     # draft/card conversions, validation, dirty check
│   ├── ui-editor.test.mjs  # the create/edit/delete dialog
│   ├── profile.test.mjs    # contact search, task and timeline matching
│   ├── ui-profile.test.mjs # the Contacts page
│   ├── ui-shell.test.mjs   # the app page sub-tabs
│   ├── projects.test.mjs   # project model, storage and milestones
│   ├── ui-projects.test.mjs # the Projects page and the project dialog
│   ├── optional.test.mjs   # optional host calls degrade instead of throwing
│   ├── layout.test.mjs     # the plugin-owned page skeleton
│   ├── bulk.test.mjs       # bulk edits and delete: map rules, refusals, undo
│   ├── ui-bulk.test.mjs    # the bulk editor dialog
│   ├── vcard.test.mjs      # the vCard writer
│   ├── search.test.mjs     # parsing, matching, and the 10k budget
│   ├── phones.test.mjs     # E.164 across the ways a number is written
│   ├── emails.test.mjs     # syntax, role addresses, throwaway domains
│   ├── avatar.test.mjs     # MD5 vectors, the Gravatar URL, the precedence
│   ├── ui-avatar.test.mjs  # the avatar element, including its failure
│   ├── health.test.mjs     # the rules, the weights and the bands
│   ├── ui-health.test.mjs  # the Health dashboard
│   ├── ui-home.test.mjs    # the main page
│   ├── normalise.test.mjs  # the cleanup plan, its application and its undo
│   ├── saved-searches.test.mjs # the saved-search store
│   ├── capabilities.test.mjs # the optional-API probe
│   ├── ui-kit.test.mjs     # every @plugin-host/ui name the source imports exists
│   ├── watch.test.mjs      # save-time duplicate warning (create and edit)
│   └── bundle.test.mjs     # the built bundle + locale completeness
├── test-utils/
│   ├── fake-api.mjs        # a recording fake of the plugin host API
│   └── ui-kit.mjs          # stand-in for @plugin-host/ui
└── scripts/
    └── package.mjs         # builds contact-manager.zip
```

> `src/lib/*.js` must stay free of `api` and DOM access wherever possible —
> that is what keeps the unit tests fast and the code portable. Only
> `duplicates.js` (merge run, storage), `undo.js` (undo storage and restore),
> `manager-page.js`, `review-dialog.js` and `detail-section.js` are allowed to
> touch the host.


## 4. Architecture

### 4.1 The plugin host contract

The webmail loads the plugin as **CommonJS** and provides three externals:

* `react` — the UI library,
* `@plugin-host` — the plugin API (`api.contacts`, `api.addressBooks`,
  `api.ui`, `api.i18n`, `api.storage`, `api.toast`, `api.log`, `api.plugin`),
* `@plugin-host/ui` — the UI kit (components only, no logic).

> **The optional APIs are not part of this contract.** `api.email`, `api.tasks`
> and `api.calendar` are context the plugin can live without, and the host does
> not guarantee their shape — on a current install `api.email` exists with **no
> `search` method**, which is what produced `api.email.search is not a function`
> and used to take the Contacts page down. Everything touching them goes through
> `optionalCall` (never a bare `.catch()`), `src/lib/capabilities.js` reports at
> activate time what the host really exposes, and the profile names whichever
> pieces came back empty.

`src/index.js` exports exactly three things:

```js
export const slots  = { 'app-page': {component, shouldShow},
                        'plugin-dialog': {component},
                        'contact-detail-section': {component, shouldShow} };
export const hooks  = { async onAction({ surface, actionId, context }) {},
                        async onAfterContactCreate(contact) {},
                        async onAfterContactUpdate(contact) {} };
export async function activate(pluginApi) {}
```

* **Slots** are React components rendered by the host in an iframe. The host
  passes `extraProps` from `api.ui.openDialog` in as props, and `onResult`
  closes the dialog with a value.
* **Hooks** are plain handlers running the host's background frame. `onAction`
  reacts to the buttons registered with `api.ui.setActions`;
  `onAfterContactCreate` and `onAfterContactUpdate` watch saved contacts for
  duplicates (see §6.5). They are observers, so they can never stop a save.
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
| `email:read` | The recent messages on the profile |
| `tasks:read` | The open tasks on the profile |
| `tasks:write` | Creating a milestone task from a project |
| `calendar:read` | The meetings on the profile |
| `email:blob-read` | Saving an attachment from the profile's Files section |

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
selector; `planMerge(group, keepId, choices)` honours that override.

### 6.2 Building the patch

`planMerge(group, keepId, choices)` returns
`{ primary, others, patch, added, changed, nameSuggestions }`:

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
* `choices` resolves conflicts in those single-value fields:
  `{ [field]: donorId }` replaces the kept contact's field with that donor's
  whole field. The replacement is recorded in `changed` as
  `[{ field, value, fromId }]`, never in `added`.
* **Never touched:** `uid`, `created`, `updated`, `addressBookIds`,
  encryption keys, and any client-only field.
* `added` is the list of everything the merge brings in,
  `[{ field, value, fromId }]`, in the order it would appear.
* `nameSuggestions` lists the donor names that differ from the kept name
  (`nameSuggestions(primary, others)` — normalised comparison, no email
  addresses, no value that is already a nickname). Each one is written to
  `patch.nicknames` by default, so a merge never silently loses the name a
  contact was saved under. `choices.nicknames[normalisedName] = 'drop'` keeps
  it out; the dialog's *Use it as the name* option sets `choices.name`
  instead, and a name that ends up as the contact's name is never also added
  as a nickname.
* `conflictFields(plan)` lists the conflicting single-value fields with their
  current value and every donor option, so the dialog can render the
  *Resolve differences* pickers.
* `previewFields(plan)` turns a plan into the complete details of the contact
  to keep, per field: `kept` (already there, stays), `added` (green `+`,
  merged in, with its source contact), `changed` (orange `~`, chosen donor
  values that replace the kept contact's value, with `previous` for context)
  and `conflicts` (orange `≠`, a value another contact has in a single-value
  field such as the name; the kept contact's own value stays, so that value
  is not merged). The review dialog renders this for whichever member the
  *Keep* selector points at.

### 6.3 Running the merge

`mergeGroups(api, groups, keepBySignature, choiceBySignature)` runs the groups
**in order**. `choiceBySignature` carries the per-field value choices from the
dialog; both maps are keyed by group signature.

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

`mergeGroups` takes an optional fifth argument, a `journal` array. Each group
that really removed a card appends `{ plan, removedCards }`, and the review
dialog turns those into undo entries with `buildEntry`.

### 6.4 Undo (`src/lib/undo.js`)

A merge deletes data, so every run leaves one undo batch in `api.storage`
under `undoBatches` (`UNDO_KEY`):

```js
{ at, expiresAt, entries: [{ keptId, before, absent, removed }] }
```

* `before` — the kept contact's original values for the fields the merge
  patched, so the revert can restore them.
* `absent` — patched fields the kept contact did not have; undo clears them
  again (the host treats `undefined` in a patch as *clear*).
* `removed` — the deleted cards, as scanned.

Retention is explicit and bounded:

| Rule | Value |
|---|---|
| Window | the `undoMinutes` setting (default 15, `0` = undo off, max 1440) |
| Cards per store | `MAX_CARDS` = 100 removed cards |
| Bytes per store | `MAX_BYTES` = 400 000 characters of JSON |
| Eviction | the oldest batch goes first; a single bigger batch is not kept |
| Purging | `readUndo` drops expired batches, `activate` purges once on load |

`undoLastMerge` restores the newest batch: it re-creates each removed card
with `api.contacts.create` (minus `id`, `created`, `updated`, which the host
assigns itself) and only then reverts the kept contact — a card that could
not be re-created keeps its duplicate's values intact. Failures stay in
storage so the undo can be retried; the returned
`{ restored, reverted, failed, total }` drives the toast.

Surfaces: the Contact Manager page shows a banner for the newest record with
*Undo merge* and *Forget*, and the command palette offers *Undo the last
merge* while a record exists.

### 6.5 Warning about duplicates while saving (`src/lib/watch.js`)

The host offers no contact-form surface, so the plugin hooks the observer
hooks that fire right after a save:

| Hook | Fires |
|---|---|
| `onAfterContactCreate(contact)` | after a contact was created |
| `onAfterContactUpdate(contact)` | after a contact was changed |

`warnAboutDuplicates(api, contact)` then:

1. runs `findDuplicatesOf`, which reuses the contact-details path
   (`findGroupFor`: `api.contacts.search` by the contact's email, then name,
   filtered by the same normalised keys);
2. drops the saved contact itself from the match (by id, or by content when
   the host sent no id);
3. shows one warning toast naming the duplicates and the reason, for example
   *This looks like an existing contact: Ada Lovelace (Same email address:
   ada@example.org).*

Nothing here can block the save: these are observers, and the handler never
returns a value. The persistent, clickable hint is the
`contact-detail-section` block, which offers *Review duplicates* for the open
contact and opens the shared review dialog.

The `warnOnSave` setting turns the warning off. A failed check is swallowed —
an unreachable address book must never look like a failed save. The
`matchByEmail` / `matchByPhone` / `matchByName` switches apply here too.

### 6.6 The contact editor (`src/lib/editor.js`, `editor-dialog.js`)

Bulwark has no contact form, so the plugin ships its own. `editor.js` is the
pure model; `editor-dialog.js` is the form.

* **Draft** — a flat, form-friendly shape: first/last name, nickname, email
  and phone lists (each with a *preferred* flag), one postal address,
  organisation, job title, notes, comma-separated tags and the address-book
  membership. `emptyDraft()`, `draftFromCard(card, books)` and
  `cardFromDraft(draft, mode)` are all pure.
* **Writing** — `cardFromDraft` emits only the fields the editor manages, so
  unmanaged fields survive an edit. An empty value is `undefined`, which the
  host reads as *clear* on update and ignores on create. Map keys are
  `e0`/`p0`/`a0`/`o0`/`t0`/`n0`; a preferred entry gets `pref: 1`.
* **Validation** — `validateDraft(draft, mode)`: a name, an email or a phone
  is required; emails must look like addresses; a phone needs at least five
  digits; a new contact needs at least one address book. It returns one
  `{ field, key }` per field, and the dialog shows the messages in an alert
  and on the field.
* **Dirty state** — `isDirty(draft, original)` ignores whitespace and the
  order of the address books. Cancelling a dirty draft asks first. The
  address book a new contact starts in is part of the *initial* draft, so
  opening and closing the dialog never counts as a change.
* **Delete** — the edit form has a *Delete contact* action behind a
  confirmation; it is the only way the plugin deletes outside a merge.
* **Entry points** — the palette and the Contact Manager page open it in
  create mode, the contact-details section in edit mode. All three go through
  `openEditor` in `open-editor.js`, and the result toast lives in
  `toastEditorResult` next to it.
* **Errors** — a failed write keeps the dialog open, shows the reason and
  leaves the form intact, so the user can retry.

### 6.7 The Contacts page (`src/lib/profile-page.js`)

The *Contacts* sub-tab is the CRM record view: a searchable
contact list on the left, the 360° profile of the selected contact on the
right.

* **List** — every contact, filtered by `filterCards` (name, nicknames, email
  addresses and phone numbers, case-insensitive `contains`). The profile of
  the open contact stays visible while the list is filtered, the way a mail
  client keeps the open message.
* **Profile** — name, organisation · job title, tags, email addresses (the
  preferred one tinted), phones, nickname, address, notes, and the duplicate
  block from `contact-detail-section` (same component, same *Review* action).
* **Recent messages** — `api.email.search({ text: <first email or name>,
  limit: 10 })`, then `timelineForContact` keeps only summaries that mention
  the contact in sender, recipients or subject.
* **Open tasks** — `api.tasks.list({ includeCompleted: false })`, then
  `tasksForContact` keeps the tasks whose title or description mentions the
  contact's name or an email address.
* **Meetings** — `api.calendar.getEvents` over the last six months and the next
  three, filtered by `eventsForContact` (participants by email/name, or the
  title).
* **Files** — `attachmentsForMessages` flattens and de-duplicates the
  attachments of those messages (name + size) and `formatBytes` renders the
  size. The profile shows each file's type, size and date next to the message
  it came from, and a *Save* button streams it to the browser through
  `api.email.getAttachment`. No bytes are stored on the server or in
  `api.storage`.
* **Company** — `companyNameOf` shows the organisation; `companyOf` finds the
  matching company record and `peopleOfCompany` counts its people. Companies
  are contacts with `kind: 'org'`; people link through their organisation name
  or email domain (#22).
* **Degradation** — messages, tasks and meetings need the `email:read`,
  `tasks:read` and `calendar:read` permissions, and saving a file needs
  `email:blob-read`. A missing permission or a failing call leaves the profile
  readable and shows one muted line instead of an error.

`profile.js` holds the pure matching rules (`filterCards`, `contactTerms`,
`tasksForContact`, `timelineForContact`), so the page itself only loads data
and renders.

### 6.8 Hidden groups

Hidden groups are stored as signatures in `api.storage` under
`dismissedGroups` (`DISMISSED_KEY`). A hidden group stays out of the scan
results until it is restored; adding or removing a member changes the
signature, so the group shows up again on its own. The last scan's summary
is stored under `lastScan` (`LAST_SCAN_KEY`).

### 6.9 Projects (`src/lib/projects.js`, `projects-page.js`)

The *Projects* sub-tab tracks client work. A project record
is `{ schemaVersion, id, name, status, companyId, contactIds, description,
currency, hourlyRate, createdAt, milestones }` and lives in `api.storage` under
`projects` (`PROJECTS_KEY`) — **per account and per browser, so it does not
sync between devices**, which the page says out loud.

Milestones are the deliberate exception to "summaries only": each one is
created as a real task (`api.tasks.create`, title `"Project: Milestone"`) and
its state is read back from `api.tasks.list`, so no parallel task store exists.
`normalizeProject` / `normalizeProjects` repair stored records on read and drop
junk; deleting a project removes only the local record and leaves its tasks and
linked contacts alone.

**Time and expenses** are local too: `timeEntries` (whole minutes, a date, a
note, a *billable* flag) and `expenses` (an amount, a date, a note, billable).
`totalMinutes` / `billableMinutes` / `billableExpenses` / `timeAmount` /
`projectTotal` compute the running totals (rounded to cents) and
`formatMinutes` / `formatAmount` render them. **Export** (`exportPayload`)
writes one JSON file per account carrying a `localOnly: true` header;
**Import** (`parseExport` / `mergeProjects` / `importProjects`) merges such a
file back in, newest record per id.

The pure helpers are `emptyProject`, `emptyMilestone`, `emptyTimeEntry`,
`emptyExpense`, `normalizeProject`, `normalizeProjects`, `validateProject`,
`projectsForContact`, `projectsForCompany`, `milestoneTaskDraft`,
`openMilestoneIds`, `totalMinutes`, `billableMinutes`, `billableExpenses`,
`timeAmount`, `projectTotal`, `formatMinutes`, `formatAmount`, `exportPayload`,
`parseExport` and `mergeProjects`.

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
| `npm test` | Runs `pretest` (the build) and then `vitest run` — currently **148 tests in 13 files** |
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
| `test/preview.test.mjs` | The complete details of the kept contact, added and changed values with their source, not-merged conflicts, conflict options and the summary counts |
| `test/ui-dialog.test.mjs` | The review dialog (complete details, colour-coded merge preview, footer buttons, keep-selector, confirm, cancel) and the contact detail section |
| `test/optional.test.mjs` | `optionalCall`: a value, a synchronous throw, a non-promise, a rejection |
| `test/layout.test.mjs` | The page skeleton: a wrapping flex row, a fixed-basis scrolling side pane, a shrinkable detail pane |
| `test/bulk.test.mjs` | `applyBulkEdit` / `applyTags` / `applyBooks`: complete map patches, the company marker, a card that would be in no book, one write per contact; and `deleteContacts` with its undo batch |
| `test/ui-bulk.test.mjs` | The bulk editor dialog: what it collects for tags and books, cancel, and an account with no books |
| `test/vcard.test.mjs` | The vCard writer: one block per contact, CRLF, the importable fields, RFC 2426 escaping, structured N/ADR |
| `test/search.test.mjs` | `parseQuery` (operators, unknown fields, values), matching per field, the fuzzy floor, and 10k contacts inside the 100 ms budget |
| `test/saved-searches.test.mjs` | The saved-search store: names, replacement, the cap, and the repairs it makes on the way in |
| `test/phones.test.mjs` | `toE164` across international and national formats, the refusals (no country, ambiguous, not a number), the length bounds, and `phoneKey` agreeing across spellings |
| `test/emails.test.mjs` | Email syntax, role addresses and throwaway domains, and that a role address is a warning rather than a rejection |
| `test/avatar.test.mjs` | MD5 against the published vectors, the Gravatar URL shape, `mediaUris`, and that a stored photo wins over Gravatar while Gravatar needs the setting |
| `test/ui-avatar.test.mjs` | The avatar element: lazy, no referrer, and gone the moment the image fails |
| `test/health.test.mjs` | Every rule and its weight, the score floor, the band cutoffs, the per-book breakdown, and the drill-downs |
| `test/ui-health.test.mjs` | The dashboard: the average, the book rows, filtering by a rule, the scores on the rows, and the fixes it offers |
| `test/ui-home.test.mjs` | The main page: the headline numbers, the last-scan line, each row leading into its section, and that the menu runs the same actions as the palette |
| `test/normalise.test.mjs` | The cleanup plan (complete maps, the values it keeps), its application, the refusal that is left out of the record, and the undo putting everything back exactly |
| `test/capabilities.test.mjs` | The optional-API probe: wanted methods present, renamed, absent, empty and unreadable |
| `test/ui-kit.test.mjs` | Every `@plugin-host/ui` name the source imports is exported by the kit stand-in |
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

Download `contact-manager.zip` from
[GitHub Releases](https://github.com/zyntrax/bulwark-plugins/releases), then
upload it:

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
* **Do not bypass the review dialog.** Every **merge** — detected group or
  hand-picked selection — funnels through `src/lib/review-dialog.js`, and
  `src/lib/duplicates.js` (`mergeGroups`) is the only place that removes a
  contact on a merge's behalf. **Deletion** has exactly two other paths, both
  behind a danger confirm and both undoable: the editor's single-contact delete
  (`editor-dialog.js`) and the bulk delete (`bulk.js`). Adding a third is a
  design decision, not a convenience.
* **Do not delete a contact before its data is kept.** Keep the
  update-then-delete order in `mergeGroups` intact.
* **Do not add a permission silently.** Every new surface needs a permission
  in `manifest.json`, and `bundle.test.mjs` checks that the declared
  permissions cover the slots.
* **Do not cache contacts in `api.storage`.** The only exception is the
  bounded, expiring undo record written by `src/lib/undo.js`; everything else
  there is settings-derived state (hidden-group signatures, last scan
  summary).
* **Keep the pure parts pure.** Detection, planning and preview shaping stay
  free of `api` and DOM access so they remain unit-testable.
* **Never call an optional host API directly.** Mail, tasks and calendar are
  context the plugin can live without, so every call goes through
  `optionalCall` from `src/lib/optional.js`. A missing namespace throws
  *synchronously*, which a bare `.catch()` cannot catch and which takes the
  whole page down inside a React effect.
* **Do not build the page skeleton out of the kit.** `Row` and `Stack` are
  fine for *content* — an actions row, a card's inner stack, a dialog footer —
  but whether they forward a `style` prop to the DOM is not part of any
  contract this plugin can check, and the test stand-in drops it. The
  two-pane split lives in `src/lib/layout.js` and is drawn with plain
  elements, so a list can never stretch the page and hide the pane beside it.

### 9.3 Definition of done

A change is complete when:

1. `npm test` passes — the whole suite, plus any new test you added.
2. New behaviour has a test in the matching `test/*.test.mjs` file, and the
   test name says what the behaviour *is*, not how it is implemented.
3. New strings exist in `en` **and** `de`.
4. `npm run package` produces a valid `contact-manager.zip` whose root holds
   `manifest.json` and `index.js`.
5. The `version` in `manifest.json` is bumped and `CHANGELOG.md` has an
   entry for it (see below).
6. The release script rebuilds the ZIP from the tagged source and attaches it
   to the GitHub release, so the download matches the code in the repository.

### 9.4 Making a change — the loop

```bash
cd contact-manager
npm test                 # 1. build + run the suite
npm run package          # 2. rebuild the installable ZIP
```

Then commit the source and push. Merge the branch into `main` through a PR
first; releases are cut from `main` with `npm run release`; there is no
committed `build/` directory. Delete the feature branch once its PR has landed
— `main` and `contact-manager` are the only long-lived branches.

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
| Calling an optional API directly (`api.calendar.getEvents(...).catch(...)`) | A missing namespace throws synchronously and takes the page down | `optionalCall(() => api.calendar.getEvents(range))` |
| Letting a dialog decide to write | A pure dialog that returns a draft writes nothing | Write in the `open*` funnel (`openProject`, `openEditor`) |
| Sizing a pane with `style` on a kit component | The kit may drop the prop; the panes collapse into one column and the list runs away | Draw the skeleton with `layout.js` (plain elements) |
| Hiding a control with `style` on a kit component | The prop may be dropped and the control appears | Wrap it in a plain element with `HIDDEN` |

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
  planMerge(group, keepId, choices) -> { primary, others, patch, added, changed }
  patch contains only changed keys; map fields are complete unions
  choices replace a single-value field and land in changed
  mergeGroups() updates the kept contact BEFORE removing the others

Safety
  a failing update leaves the duplicates untouched
  a merge leaves an undo record; undo restores before it reverts
  a save-time warning never blocks the save (observer hooks only)

Optional host calls
  optionalCall(run) resolves the value, or null when the namespace, the
    method or the promise is missing — it never throws and never rejects
  a missing api.calendar / api.tasks / api.email leaves the Contacts page
    readable, and the notice names only the pieces that failed
  detectCapabilities(api) -> per namespace { present, keys, missing }
  activate() logs one line when something is missing, naming the keys the
    host does expose; silent when nothing is missing

Projects (local to this browser)
  openProject() stores whatever the dialog returned (create and edit)
  a failing write is reported and never toasted as a success

UI kit
  every name src/ imports from @plugin-host/ui is exported by the kit stand-in
    (test/ui-kit.test.mjs) — an undefined component crashes a page on render

Page skeleton
  the two-pane split is drawn with plain elements (src/lib/layout.js), never
    with `style` on a kit component
  the Contacts and Projects pages put the list and the detail in one flex row
  the list scrolls inside the pane, not the pane itself — the Contacts search
    box sits above the scroll area and stays visible
  the import file input is hidden by a wrapper element, not a kit style prop

Bulk actions (Contacts)
  groupFromSelection(cards) -> a 'manual' group: no evidence claimed, signed
    like a detected group, so it goes through the review dialog unchanged
  merging a selection needs two or more contacts
  applyBulkEdit(api, cards, { tags, books }) -> { updated, skipped, failed }
    one update per contact; keywords and addressBookIds are sent complete
    the 'company' keyword is never removed by a tag edit
    a card that would be left in no address book is refused, not skipped
  deleteContacts(api, cards) -> { deleted, failed }, always behind a confirm
    and always leaving one undo batch; undoLastMerge restores every card
  a delete-only undo entry reports no reverted kept contact

vCard export
  contactsToVCard(cards) -> one VCARD 3.0 block per contact, CRLF, escaped
  N is family;given and ADR is structured, each component escaped separately
  a contact with neither a name nor any field is left out

Smart search
  parseQuery(text) -> { terms, filters, errors }
    errors name the token and the reason; the token is also kept as a term
  buildIndex(cards, { books }) derives the searchable strings once;
    matchIndexed(entry, parsed) and countsForIndex(index, queries) reuse it
  fields: name email phone company note tag book has is
  every term must match; tag: is whole, book: takes a name or an id
  a name also matches as a subsequence from three characters up
  10k contacts stay inside 100 ms

Saved searches
  readSaved / saveSearch / deleteSaved, key 'savedSearches', cap 20
  named by their own query, so no prompt API is needed; per browser only

Phone numbers
  toE164(number, region) -> '+491761234567' or '' — never a guess
    international (+…, 00…) needs no region; a national number does
    a national number already starting with the dial code is ambiguous -> ''
  phoneKey(number, region) is what detection compares
  isValidE164 requires the '+' and 7..15 digits with no leading zero

Main page (Overview)
  makeHomePage(React, api) renders the landing tab; every sub-page is handed
    onNavigate(tabId), which is how its rows lead into a section
  the menu and the command palette both call lib/actions.js — one implementation
    findDuplicates(api, scopeIds)  newContact  newCompany  newProject  undoMerge
  the counts come from one load of the cards, shared with the duplicate scan
    and the health rules
  the plugin lands on Overview, not on Duplicates

Health (#16)
  RULES maps a rule key to { weight, fix }; RULE_KEYS is the order shown
  contactIssues(card, ctx) -> [{ key, weight, fix, value }]   value = the text
  healthScore(issues) = 100 - the deductions, floored at 0
  healthBand(score) uses BANDS.good / BANDS.fair, defined once
  healthSummary(cards, { books, region, duplicates }) -> contacts, byRule, byBook
  a duplicate is either "in the set" (duplicates) or "is one" (duplicate: true)
  the email rules read rawEmailAddresses, not emailEntries, so a malformed
    address is visible

Avatars (#15, avatar half)
  md5(text) -> lowercase hex, checked against the published vectors
  gravatarUrl(email, { size, fallback, rating }) -> '' when there is no address
    d=404 so "no picture" is a failed image, not a stranger's silhouette
  avatarFor(card, { gravatar, size }) -> { url, source: 'card'|'gravatar' } | null
    a photo stored on the contact always wins; Gravatar needs the setting on
  the element hides itself on error, so a blocked request is simply absent

Cleanup (#17)
  planNormalisation(cards, { region }) -> the cards that would change, each
    with the complete new map and the maps it replaces
  applyNormalisation writes one update per contact, then one undo record
    a contact the host refuses is counted and left out of the record
  undoCleanup restores every contact; entries that fail stay for a retry
  the region lives in api.storage, not the settings schema (see #75)
  a failing removal is reported, not swallowed
  nothing outside review-dialog.js calls contacts.remove
```

---

## 11. Repository, releases and changelog policy

### 11.1 Where the code lives

| Path | Contents |
|---|---|
| `contact-manager/` | The full source tree — `src/`, `test/`, `test-utils/`, `scripts/`, `manifest.json`, `package.json`, `vitest.config.mjs`, `README.md`, `CHANGELOG.md` |

The source lives in **`zyntrax/bulwark-plugins`** on GitHub. Installable ZIPs
are published as assets on
[GitHub Releases](https://github.com/zyntrax/bulwark-plugins/releases); no
build artifacts are committed.

### 11.2 Release checklist

1. Merge the feature branch into `main` through a pull request — this also
   closes the shipped roadmap issues — and keep the `contact-manager` mirror
   branch in step with `main`.
2. Bump `version` in `manifest.json` (semver) and `package.json` on `main`.
3. Add a `CHANGELOG.md` entry for that version — newest on top, under a
   `## [x.y.z] — YYYY-MM-DD` heading, split into `### Added`,
   `### Changed`, `### Fixed`, `### Removed` (drop the empty ones).
4. `npm test` — all tests green.
5. Commit and push the source on `main`.
6. Run `npm run release` from `main`. It tests, packages, tags
   `contact-manager-vX.Y.Z`, pushes the tag and creates the GitHub release with
   the ZIP attached. It stops before tagging if `manifest.json`, `package.json`
   and the top `CHANGELOG.md` entry disagree.

`npm run ship` runs steps 1–6 in one command: it merges the open release PRs
into `main` (retargeting stacked ones), keeps the `contact-manager` mirror in
step, then runs `npm run release`. `npm run ship -- --dry-run` previews the
plan without changing anything; `--no-release` stops after the merge.

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

---

## 12. License

No separate `LICENSE` file is committed in this plugin folder yet. Per the
[repository README](../README.md#license), the code here is released under the
**same license as Bulwark Mail** unless stated otherwise; that license is not
restated in this repository, so confirm it — together with any plugin-store
terms — before distributing or selling the plugin. `manifest.json` names the
`author` (`Alexander`); add a `LICENSE` file, and a `license` field beside it,
once the terms are settled.

