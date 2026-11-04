# Contact Manager — a Bulwark Mail plugin

Find, review and merge **duplicate contacts** across all address books, drawn
entirely with Bulwark's own UI kit so it looks like part of the app. It is
meant to grow into a general contact-management addon.

> **Direction:** an eWay-CRM-style CRM workspace inside Bulwark — contacts and
> companies, activities, follow-ups and a pipeline — within what the plugin
> host allows. The module-by-module map, the phases and the non-goals are in
> [issue #54](https://github.com/zyntrax/bulwark-plugins/issues/54).

This document describes what the plugin does, how it is built and how it
behaves. The rules an automated contributor works to, and the contract the test
suite enforces, live in [`.clinerules`](../.clinerules) at the repository root;
the current state of the project is in [`HANDOFF.md`](HANDOFF.md).

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
| `app-page` slot | Navigation rail → *Contact Manager* | The whole plugin. Its body is a tab strip: *Overview* (the main page: headline state, the follow-ups block, a menu of the palette tasks, and a row into every section), *Duplicates* (statistics, duplicate groups, hide/restore, multi-select, *Review…*), *Contacts*, *Groups*, *Projects*, *Health*, *History* and *Privacy* |
| *Follow-ups* block | Contact Manager → *Overview* | The open tasks over **every** contact at once (#36): overdue first and badged, then what is due within seven days, then a count of what can wait. Hidden when there is nothing to chase; says so when the host has no task list |
| Getting started guide | Contact Manager → *Overview*, on first run | A short card that walks a first clean-up — import, scan (which opens the review dialog), set policies — running the same actions the menu and the palette run. It records that it is done, and the Overview menu re-opens it (#39, the onboarding half) |
| *Policies* button | Contact Manager → *Duplicates* header | Opens the **address-book policies** dialog: whether each book is scanned, each match strategy per book (*Default* / *On* / *Off*), and global ignore rules by email domain or tag (#7) |
| *Roles* button | Contact Manager → *Duplicates* header | Opens the **address-book roles** dialog (#23): the role held on each book — *Viewer* / *Editor* / *Merger* / *Admin* — which disables the actions it does not allow. Advisory only; the host is not enforcing it |
| Command palette action | Ctrl+K → *Find duplicate contacts* | Scans everything, opens the review dialog |
| Contact list action | Contact list toolbar → *Find duplicates in selection* | Scans only the selected contacts |
| Command palette action | Ctrl+K → *Undo the last merge* | Restores the newest undo record while it is live |
| Undo banner | Top of the Contact Manager page | *Undo merge* / *Forget* for the newest merge record |
| Duplicate digest | Contact Manager → *Overview*, above the headline | When the plugin opens, says so if no scan has run within `digestDays` days or if duplicate groups have appeared since you were last shown them, with *Review now* and *Got it* (#5) |
| Bulk merge | Contact Manager → *Duplicates*, above the groups | Facet buttons (*All N groups*, *Acme Inc. · 2 groups*, *@example.org · 3 groups*) select every group a company or email domain touches, preview the batch and merge it in one dialog. Capped at 50 groups per batch (#6) |
| `contact-detail-section` slot | Inside an open contact | A *Duplicate check* block with a *Review duplicates* button |
| Create/update hooks | After a contact is saved | A non-blocking warning when the saved contact looks like an existing one |
| Command palette action | Ctrl+K → *New contact* | Opens the contact editor (create) |
| *New contact* button | Contact Manager page header | Opens the contact editor (create) |
| Command palette action / *Import contacts* button | Ctrl+K → *Import contacts*, or the Overview page | Opens the **import wizard**: reads a CSV or vCard, guesses the columns (and remembers a mapping), previews, and gives every contact that matches one you already have its own *Skip* / *Merge into the existing contact* / *Import as a separate contact* choice (#4). A merge goes on to the review dialog |
| *Edit contact* button | `contact-detail-section` | Opens the contact editor (edit / delete) |
| *Follow up* button | Contact Manager → *Contacts*, on the open contact | Opens the **follow-up task** editor (#36): title (prefilled), due date, priority and notes, created as a real host task. The profile's task list shows the contact's tasks with anything past due badged *Overdue*, first |
| *Private notes* section | Contact Manager → *Contacts*, on the open contact | Notes kept on your server about the contact (#38, the private half): write, read back with a timestamp, delete. Private by construction — a note is a record of its own through the storage seam, never a card field, so nothing shared can show it. Free text, `note:` and `has:note` in the search box find them too. A small documented subset of marks (`**bold**`, `*italic*`, `` `code` ``, `@mention`) is rendered as elements, never as markup. The subject-access export carries them, and erasure removes them |
| *Contacts* sub-tab | Contact Manager → *Contacts* | Searchable contact list with a query language — fields (`name:`, `email:`, `phone:`, `company:`, `tag:`, `book:`, `has:`, `is:`), a leading `-`/`not:` to exclude, and `OR` with parentheses to group — saved searches with live counts, avatars, and the 360° profile: details, company, duplicates, messages, meetings, files and tasks. The list is paged (100 at a time, *Previous* / *Next*), so a large address book does not turn the whole match set into DOM. `/` jumps to the search box and `Esc` clears it. Checkboxes select several contacts, and *Select all N* takes everything the list shows (a saved search used as a bulk scope), for *Merge selected* / *Edit selected* / *Clean up* / *Rules…* / *Export* / *Delete selected* / *Clear selection* |
| *Projects* sub-tab | Contact Manager → *Projects* | Local client-work projects: status, linked company and people, description, currency and rate, and milestones (real tasks) |
| *Groups* sub-tab | Contact Manager → *Groups* | Distribution lists as real contact cards: create, rename, search and delete them, add or remove members with a contact search, and a warning when a list holds two contacts that are one person (#12) |
| Command palette action / *New group* button | Ctrl+K → *New group*, or the Groups page header | Opens the group editor (create) |
| Command palette action | Ctrl+K → *New project* | Opens the project editor (create) |
| *Rules…* button | Contact Manager → *Contacts*, with a selection | Opens the **normalisation rules** dialog: the built-in rules, your own find-and-replace rules, and the exact edits they would make before anything is written (#20) |
| Command palette action | Ctrl+K → *Normalisation rules* | The same rules dialog, over every contact |
| Command palette action / *Automation rules* button | Ctrl+K → *Automation rules*, or the Overview menu | Opens the **automation rules** builder (#33): rules that run on a contact being created, changed or imported, with a condition (a search query) and actions (add/remove tag, add to a group, propose a merge), a priority order, an enable/disable toggle and a *Test* dry run |
| Command palette action | Ctrl+K → *Smart lists* | Opens the **Smart lists** dialog (#13, the palette half): the saved searches with live counts, the contacts a list holds (paged), and a vCard export of the chosen list |
| Command palette action / *Help* button | Ctrl+K → *Help*, or the Overview menu | Opens the **Help** dialog (#39): the search operator cheatsheet (every field, what `has:`/`is:` take, worked AND/OR/grouping/exclusion examples), the keyboard shortcuts, and a short *what's new* |
| *History* sub-tab | Contact Manager → *History* | What this plugin wrote — merges, cleanups, rules, imports, bulk edits, creates/updates/deletes and group changes — newest first, with the rollback that is still live (#25, the local half) |
| *Privacy* sub-tab | Contact Manager → *Privacy* | The GDPR toolkit (#26): pick a person, export everything held about them (JSON subject-access export, vCard, CSV), record the lawful basis they are held on per source with an expiry, and erase or anonymise them with confirmation, leaving a proof-of-deletion report |
| `plugin-dialog` slot | Modal, opened by all of the above, *New contact*, *New project*, *New group*, *Rules…*, *Automation rules* and *Manage consent…* | One slot, several dialogs picked by `extraProps`: the review/merge dialog, the **contact editor**, the **project editor**, the **group editor**, the **consent editor**, the **automation editor**, the **bulk editor**, the **cleanup preview**, the **rules editor**, the **import wizard**, the **export choice**, the **policies** dialog and the **roles** dialog |

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
├── HANDOFF.md              # where the project stands and why
├── src/
│   ├── index.js            # slots, hooks, activate() — wiring only
│   └── lib/
│       ├── store.js       # the storage seam: which key lives on which server (#68)
│       ├── files-store.js # records in the customer's own Files storage (#68)
│       ├── contacts.js     # JSContact readers, loaders, settings flags
│       ├── duplicates.js   # detection (union-find), merge planning, merging
│       ├── name-match.js   # folding, nicknames, phonetic keys, name evidence (#8)
│       ├── book-policies.js # per-book duplicate policies and ignore rules (#7)
│       ├── labels.js       # shared display helpers and toasts
│       ├── layout.js      # the plugin-owned page skeleton (the two-pane split)
│       ├── avatar.js      # MD5, the Gravatar URL, and whose picture wins
│       ├── avatar-view.js # the avatar element, which hides itself on failure
│       ├── health.js      # the health rules, their weights and the bands
│       ├── health-page.js # the Health dashboard
│       ├── home-page.js  # the main page: state, the menu and the section rows
│       ├── actions.js    # the tasks the palette and the main page both run
│       ├── remote.js     # the client for a user-configured server (#68)
│       ├── csv.js        # the RFC 4180 reader
│       ├── vcard-parse.js# reading vCard 3.0 and 4.0 back in
│       ├── import-fields.js # the column fields and the header guesses
│       ├── import.js     # rows to drafts to cards, and the duplicate plan
│       ├── import-templates.js # remembered column mappings
│       ├── import-dialog.js # the import wizard
│       ├── export.js     # the CSV writer and the file the export builds
│       ├── export-dialog.js # what to export, and in which format
│       ├── search.js      # the query language and the matcher behind the search box
│       ├── phones.js      # E.164 normalisation and the region table
│       ├── emails.js      # email syntax, role addresses, throwaway domains
│       ├── region.js      # the stored country for national numbers
│       ├── normalise.js   # the cleanup plan, its application and its undo record
│       ├── normalise-dialog.js # the cleanup preview
│       ├── saved-searches.js # the queries a user keeps, in api.storage
│       ├── digest.js     # the duplicate digest: the window, the baseline, staleness (#5)
│       ├── app-shell.js   # the single app page: the Overview/Duplicates/Contacts/Groups/Projects/Health/History/Privacy sub-tabs
│       ├── bulk.js        # bulk edits and delete for a selection
│       ├── bulk-dialog.js # the bulk editor: tags and address books
│       ├── vcard.js       # contacts to vCard 3.0, for the bulk export
│       ├── capabilities.js# which optional host APIs this instance really has
│       ├── download.js    # hand bytes to the browser as a download (files, project export)
│       ├── manager-page.js # the Duplicates sub-tab
│       ├── bulk-merge.js  # facets (company/domain) and the batch plan (#6)
│       ├── policies-dialog.js # the address-book policies dialog (#7)
│       ├── book-roles.js  # per-address-book roles: the ladder, the store, the reading (#23)
│       ├── roles-dialog.js # the address-book roles dialog (#23)
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
│       ├── groups.js      # the group model: cards, drafts, member search, duplicates in a list (#12)
│       ├── groups-page.js # the Groups page: lists, searches and flags the lists
│       ├── group-dialog.js # the create/edit/delete group form (plugin-dialog slot)
│       ├── open-group.js  # one place that opens the group editor and toasts the result
│       ├── rules.js       # the normalisation rules engine: the catalogue, the order, the plan (#20)
│       ├── rules-dialog.js # the rules editor (plugin-dialog slot)
│       ├── open-rules.js  # one place that opens the rules dialog and applies it
│       ├── history.js     # the change history of the plugin's own writes (#25)
│       ├── history-page.js # the History page
│       ├── consent.js     # the consent records: the store, the lawful bases, the expiry (#26)
│       ├── privacy.js     # the subject export, anonymisation, erasure and the deletion log (#26)
│       ├── privacy-page.js # the Privacy page (app-page slot)
│       ├── consent-dialog.js # the consent editor (plugin-dialog slot)
│       ├── automation.js  # the automation rules engine: the model, the plan, the write (#33)
│       ├── automation-dialog.js # the rule builder and its dry run (plugin-dialog slot)
│       ├── open-automation.js # one place that opens the rule builder and toasts the result
│       ├── onboarding.js  # the first-run guide's steps and its storage (#39)
│       ├── onboarding-card.js # the Getting started card on the Overview tab (#39)
│       ├── paging.js      # the pure page math for a long contact list (#39)
│       ├── smart-lists.js # saved searches as smart lists: counts, members, file name (#13)
│       ├── smart-lists-dialog.js # the Smart lists dialog (plugin-dialog slot, #13)
│       ├── help.js        # the help model: operators, examples, shortcuts, what's new (#39)
│       ├── help-dialog.js # the Help dialog (plugin-dialog slot, #39)
│       ├── tasks.js       # follow-up tasks: the payload, the due date, the overdue split (#36)
│       ├── task-dialog.js # the follow-up task editor (plugin-dialog slot, #36)
│       ├── open-task.js   # one place that opens the task editor and creates the task (#36)
│       ├── notes.js       # private notes: the store, its repairs, the erasure (#38)
│       ├── markdown.js    # the tiny inline formatter for a note (#38)
│       ├── notes-section.js # the Private notes section on a contact (#38)
│       ├── optional.js    # optional host calls that degrade to null, never throw
│       └── watch.js       # warn about duplicates after a contact is saved
├── test/
│   ├── fixtures.mjs        # card builders
│   ├── contacts.test.mjs   # readers, name/email/phone extraction
│   ├── duplicates.test.mjs # normalisation, keys, grouping
│   ├── book-policies.test.mjs # policy resolution, ignore rules, storage repairs
│   ├── book-roles.test.mjs # the role ladder, the store, the role that applies (#23)
│   ├── merge.test.mjs      # merge planning, conflict choices and the merge run
│   ├── preview.test.mjs    # complete details, added/changed values, conflicts, counts
│   ├── ui-page.test.mjs    # the manager page
│   ├── ui-policies.test.mjs # the policies dialog
│   ├── ui-roles.test.mjs   # the roles dialog (#23)
│   ├── onboarding.test.mjs # the guide's step order and storage (#39)
│   ├── ui-onboarding.test.mjs # the Getting started card (#39)
│   ├── paging.test.mjs     # the page math and its budget (#39)
│   ├── smart-lists.test.mjs # the smart-list model and its file name (#13)
│   ├── ui-smart-lists.test.mjs # the Smart lists dialog (#13)
│   ├── help.test.mjs       # the help model: the cheatsheet can't drift (#39)
│   ├── ui-help.test.mjs    # the Help dialog (#39)
│   ├── tasks.test.mjs      # the follow-up payload, due dates and the overdue split (#36)
│   ├── ui-task.test.mjs    # the follow-up task editor (#36)
│   ├── notes.test.mjs      # the note store, its repairs and the erasure (#38)
│   ├── markdown.test.mjs   # the tiny inline formatter (#38)
│   ├── ui-notes.test.mjs   # the Private notes section (#38)
│   ├── ui-dialog.test.mjs  # the review dialog and detail section
│   ├── undo.test.mjs       # undo records: retention, restore, partial failures
│   ├── editor.test.mjs     # draft/card conversions, validation, dirty check
│   ├── ui-editor.test.mjs  # the create/edit/delete dialog
│   ├── profile.test.mjs    # contact search, task and timeline matching
│   ├── ui-profile.test.mjs # the Contacts page
│   ├── ui-shell.test.mjs   # the app page sub-tabs
│   ├── projects.test.mjs   # project model, storage and milestones
│   ├── ui-projects.test.mjs # the Projects page and the project dialog
│   ├── groups.test.mjs     # the group model: cards, drafts, member search, duplicates (#12)
│   ├── ui-groups.test.mjs  # the Groups page and the group dialog
│   ├── rules.test.mjs      # the rules, their order, the plan and the storage (#20)
│   ├── ui-rules.test.mjs   # the rules dialog
│   ├── history.test.mjs    # the change-history store and the paths that record into it (#25)
│   ├── ui-history.test.mjs # the History page
│   ├── consent.test.mjs    # the consent store: records, expiry status, repairs (#26)
│   ├── privacy.test.mjs    # the subject export, anonymisation, erasure, the deletion log (#26)
│   ├── ui-privacy.test.mjs # the Privacy page and the consent editor (#26)
│   ├── automation.test.mjs # the automation engine: the model, the plan, the dry run, the write (#33)
│   ├── ui-automation.test.mjs # the rule builder (#33)
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
│   ├── csv.test.mjs        # the RFC 4180 edge cases
│   ├── vcard-parse.test.mjs # reading vCard 3.0 and 4.0
│   ├── import.test.mjs     # mapping, the duplicate plan, the write
│   ├── import-templates.test.mjs # remembered mappings
│   ├── ui-import.test.mjs  # the import wizard
│   ├── export.test.mjs     # the CSV writer and both round trips
│   ├── retention.test.mjs  # the age thresholds and the buckets
│   ├── remote.test.mjs     # the server client: five answers, never a throw
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
> `book-policies.js` (policy and ignore-rule storage), `consent.js` (consent
> storage), `privacy.js` (the erasure and the deletion log), `automation.js`
> (the rule store and the write), `manager-page.js`,
> `policies-dialog.js`, `review-dialog.js`, `detail-section.js`,
> `groups-page.js`, `group-dialog.js`, `rules-dialog.js`, `open-rules.js`,
> `history-page.js`, `privacy-page.js`, `consent-dialog.js`,
> `automation-dialog.js` and `open-automation.js` are allowed to
> touch the host.


## 4. Architecture

### 4.1 The plugin host contract

The webmail loads the plugin as **CommonJS** and provides three externals:

* `react` — the UI library,
* `@plugin-host` — the plugin API (`api.contacts`, `api.addressBooks`,
  `api.files`, `api.accountData`, `api.ui`, `api.i18n`, `api.storage`,
  `api.toast`, `api.log`, `api.plugin`, `api.host`, and more),
* `@plugin-host/ui` — the UI kit (components only, no logic).

> **Where the contract is written down.** The host's documentation is
> **generated from the webmail source** (`scripts/gen-docs.mjs`), so *it* is the
> source of truth and this file is only a summary:
>
> * the plugin guide — the full `api` object, the hooks, the UI surfaces and the
>   method-permission table: <https://github.com/bulwarkmail/plugins/blob/main/WRITING_PLUGINS.md>
> * the `manifest.json` reference — permissions, `settingsSchema`, `configSchema`,
>   `credentials`, `httpOrigins`: <https://bulwarkmail.org/docs/extensions/manifest>
> * the permission table: <https://extensions.bulwarkmail.org/api/v2/permissions>
>
> **When this file and those disagree, they win.** This summary was once wrong in
> ways that mattered — see #75 — so check the generated docs before relying on a
> name here.

**The pieces this plugin relies on, as the host documents them:**

| Call | What it really is |
|---|---|
| `api.storage` | `localStorage` — per signed-in account, shared by the plugin's frames, **1 MB per account**. Not server-side, and shared with nobody. |
| `api.contacts`, `api.addressBooks` | native JSContact cards — server-side, shared per address book |
| `api.files` | **Stalwart's file storage** (1.20+, `files:read`/`files:write`, gated by `api.host.features.files`). Server-side and cross-device; writes go only into the user's own drive, never into a folder shared with others, and there is no delete or share call |
| `api.accountData` | **a small (≤ 4 KB) JSON value in a mail account's Inbox metadata** (1.19+, `email:read`/`email:write`, Stalwart 1.0+). Namespaced `org.bulwarkmail.plugin.<plugin id>`, invisible to other JMAP clients, and **shared by everyone who can open that account** — the team-mailbox case |
| `api.tasks`, `api.calendar`, `api.email` | optional context — see the note below |
| `api.proxy` + `credentials` | the secret proxy: the host holds the credential and adds it to the request, so the plugin never sees a secret. A `configSchema` `secret` is admin-set and **installation-wide** (`scope: 'admin'`); `scope: 'user'` is one per user, connected in a dialog the host draws |

`manifest.json` is the other half: `permissions`, `settingsSchema` (`boolean`,
`string`, `number`, `select` — per user, drawn in Settings), `configSchema`
(admin-set, including `secret`, drawn on the plugin's page in the admin console),
`credentials`, `locales`, and `httpOrigins` / `frameOrigins` / `apiPostPaths`.

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
| Same name (full) | `n:` | NFKD, diacritics stripped, **script romanised**, punctuation → spaces, tokens sorted, **one key per honest spelling** | possible |
| Same name (core) | `c:` | as above, but single-letter tokens dropped | possible |
| Nickname | `k:` | as `n:`, then each token replaced by its canonical name (`bob` → `robert`) | possible |
| Name evidence (#8) | — | pairwise: initials, phonetic surnames, similar given names | possible |

* `normalizeEmail('  A@B.de ') → 'a@b.de'`
* `normalizePhone('+49 176 1234567')` and `normalizePhone('0049 176 1234567')`
  agree; `'12345'` (an extension, a year) is ignored.
* `normalizeName` romanises Cyrillic and Greek (`Иванов` → `ivanov`), so the same
  name in either script reaches one key. A script with no table is kept as it is
  (`\p{L}`), so a name never collapses to an empty string.
* A name with more than one honest spelling contributes **one key each**:
  `Müller` gives `muller` *and* `mueller`, so it matches either.
* The `c:` (core) key drops single-letter tokens (initials): `John A. Smith`
  ≡ `John Smith`. It needs **two** substantial tokens, so a single-word name
  never matches on its own.
* `Doe, John` ≡ `John Doe`, because the tokens are sorted before comparison.
* `k:` shares the **name namespace** with `n:`/`c:`, so `Bob Smith`'s
  `k:robert smith` meets `Robert Smith`'s `n:robert smith`. A nickname variant
  that equals the plain name is not emitted: `Robert Smith` contributes nothing.
* **Name evidence never becomes a key.** A key for `J. Smith` would also match
  `Jane Smith`, and those are different people. Initials, phonetic surnames and
  near-miss given names are found **pairwise** inside a phonetic-surname bucket,
  and only when the given name agrees — see §5.6.

### 5.2 Group strength and reasons

* A group containing at least one `e:` or `p:` key is **Certain match**
  (`strength: 'strong'`).
* A group that only shares a name is **Possible match** (`strength:
  'possible'`) — two different people can share a name, so these must always
  be reviewed by a human before merging.
* `reasons` lists exactly which keys at least two members share, as
  `[{ type: 'email' | 'phone' | 'name' | 'nickname' | 'similar', value }]`. The
  UI renders them as “Same email address: a@b.de · Same name”, “Nickname:
  robert smith” and “Similar name: J. Smith ↔ John Smith”.
* Groups are sorted: certain first, then largest, then by the first
  member's name.
* A group is identified by its `signature` — `g:` plus the sorted member ids.
  The signature is what “hide this group” stores.

### 5.3 Settings that steer detection

`matchOptions(settings)` reads three booleans from the plugin settings:
`matchByEmail`, `matchByPhone`, `matchByName`. **A missing setting means the
strategy is on** (`!== false`), so new strategies default to enabled.
`matchByName: false` turns off **all** name matching, including nicknames and the
pairwise pass in §5.6.

`nameSimilarity` (60–100, default 80) is the one threshold: how alike two given
names must be before the plugin proposes them. Initials and nicknames are
structural and match regardless of it.

Contact groups (distribution lists, `kind: 'group'`) are never treated as
duplicates and never merged.

### 5.4 Per-address-book policies and ignore rules (#7, v1.27.0)

`src/lib/book-policies.js` is the model and `src/lib/policies-dialog.js` the
dialog behind the *Policies* button on the Duplicates page. Both are stored in
`api.storage` (per browser, like projects and saved searches) and repair
themselves on read — an empty policy set behaves exactly as the plugin did
before this feature.

A per-book policy is keyed by book id and holds any of four booleans:

| Field | Meaning |
|---|---|
| `enabled` | `false` excludes the whole book from scanning |
| `matchByEmail` / `matchByPhone` / `matchByName` | override the global strategy for this book |

`undefined` means "use the global setting". The dialog offers that as a third
position — *Default*, beside *On* and *Off* — so an override can always be taken
back: a book forced off can return to the global behaviour without anyone
editing storage by hand.

The ignore rules are one list, `{ domains, tags, companies }`, that skips a
contact whatever book it lives in:

| Rule | Matches |
|---|---|
| `domains` | an email domain, folded to lower case |
| `tags` | a tag, read the way the search box reads it — the **keys** of `keywords` — so `tag:vip` and an ignore rule for `vip` always agree |
| `companies` | **part** of the organisation name, case-insensitively |

Companies match on a *part* of the name, so one rule covers `Acme`, `Acme Inc.`
and `ACME GmbH`; an exact match would fail silently on the spellings nobody can
predict. `hasIgnoreRules(ignore)` is the single place that decides whether any
rule is set — every caller asks it rather than testing the fields itself, which
is how a rule that set only `companies` first slipped past the scan.

Two rules decide the outcome, and both lean towards scanning rather than
silence:

* **A card with no book is always scanned** (the default book).
* **A card in several books keeps the most permissive setting** across its
  enabled books: if book A turns email matching off but book B leaves it on, the
  card still matches on email. A book that opts out never silences a match
  another book still wants.

A book can also **protect fields**. A protected field is never filled from a
donor, never unioned into, and never replaced — not even when the dialog offers a
specific donor's value. The union rule applies here too, but in the *opposite*
direction: a field protected by **any** book the kept contact is in is protected,
because protection is a safety property and more of it is the safe way to be
wrong. `protectedFieldsFor(card, policies)` is that reading, and `planMerge`
derives the frozen set from it, so the preview the dialog shows and the write
`mergeGroups` performs cannot disagree about what a merge will change. The
dialog names the fields it is holding back, so a merge that deliberately leaves
something alone says so instead of looking like it forgot.

`filterForScan(cards, { policies, ignore, globalOpts })` applies both and
returns the surviving cards together with their per-card effective options, so
`findDuplicateGroups` uses each contact's own strategies instead of the globals.

**Every** path that looks for duplicates goes through it — the Duplicates page,
the command palette, the Home overview, the Health tab, the *Duplicate check*
block inside an open contact, and the warning after a save. `policyAwareOptions(api)`
is the one call that assembles the detection options with the stored policies,
so a policy cannot be honoured on one page and forgotten on another.

### 5.5 The group around one contact

`findGroupFor(api, contact, opts)` is the contact-details path. It queries
`api.contacts.search` with the contact's primary email and its name, keeps
only the hits that share a normalised key with the contact, and groups those
candidates among themselves. The first search that yields a candidate is
enough. It returns `null` when there is no duplicate.

### 5.6 Name evidence: initials, phonetic surnames, near misses (#8, v1.33.0)

Some of the ways one name is written *cannot* be a shared key, because the key
would also be shared by two different people: a key for `J. Smith` would have to
match `John Smith` **and** `Jane Smith`, and only one of those is the same person.

So `src/lib/name-match.js` splits the problem, and `findDuplicateGroups` runs both
halves:

| Half | Where it lives | Examples |
|---|---|---|
| **Equivalence** — one name, two spellings | keys (`n:`, `c:`, `k:`) | `Müller` ≡ `Mueller`, `Иванов` ≡ `Ivanov`, `Bob` ≡ `Robert` |
| **Evidence** — probably the same person | pairwise, `pairNameEvidence` | `J.` ≡ `John`, `Smyth` ≡ `Smith`, `Sara` ≡ `Sarah` |

The pairwise pass is bounded and conservative on purpose:

1. **Bucket by phonetic surname** (`phoneticKey`, a compact Soundex), so it never
   compares the whole address book. A surname needs **two letters** — a numeric
   token like `Twin 1` has none, and allowing it collapsed a 51-group fixture
   into one.
2. **Skip a bucket with more than `bucketLimit` (60) members.** A surname that
   common is a crowd, not a clue, and comparing it pairwise would be both slow and
   noisy.
3. **The surnames must agree** — equal letters, or both at least three letters and
   `jaroWinkler` at or above the threshold. `Smith`/`Smyth` passes; `Li`/`Lo` does
   not.
4. **The given name must corroborate**: the same given name (with a different
   surname spelling), an initial of it, or a similarity at or above
   `nameSimilarity` (60–100, default 80). `John` vs `Jane` is 0.70 and stays apart.

A pair found this way unions the two cards like any key, and the group gets a
`{ type: 'similar', value: 'J. Smith ↔ John Smith' }` reason naming **both**
spellings. The strength is always `possible`, never `strong` — the user is the one
who decides. A pair that already shares an exact key (an email, or the same name)
adds no reason: the group is already explained.

> The precision fixtures in `test/duplicates.test.mjs` are the point of this
> section: `John Smith` / `Jane Smith`, `John Smith` / `Mary Smith` and
> `Ann Lee` / `Bob Lee` must **not** group, and they are asserted first.

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

* **List** — every contact, filtered by the search query (`search.js`). The
  profile of the open contact stays visible while the list is filtered, the way
  a mail client keeps the open message.
* **Query language** — `name:` `email:` `phone:` `company:` `note:` `tag:`
  `book:` `has:` `is:`, a leading `-` (or `not:`) to exclude, and `OR` with
  parentheses to group (`(tag:vip OR tag:customer) has:email`). Adjacent terms
  are AND and `OR` binds looser. An unbalanced parenthesis or a dangling `OR` is
  reported under the box, and the rest of the query is still parsed.
* **Saved searches** — a named query with a live count, kept in `api.storage`.
* **Bulk scope** — *Select all N* turns everything the list shows into the
  selection, so a saved search (or any query) drives the bulk actions below,
  not just hand-picked rows.
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

### 6.10 Contact groups (`src/lib/groups.js`, `groups-page.js`, `group-dialog.js`)

A contact group — a distribution list — is **not** a local record: it is a real
JSContact card (`kind: 'group'`) in the address books, so it is shared across
devices, searchable and exported with the contacts, unlike Projects. The
`group` keyword is the fallback marker for a host that does not keep `kind`,
exactly as `company` is for an organisation (#12, v1.34.0).

`isGroupCard` recognises both, and `isMergeable` excludes a group from
detection: a distribution list is never a duplicate of a person, and two lists
are never duplicates of each other.

**Members are uids.** `groupMemberIds` reads the JSContact `members` map
(`{ k: { kind, value } }`) and the flatter shapes a host may return, in order
and deduplicated. The editor's draft is `{ name, memberIds, bookIds }`;
`groupDraftFromCard` / `groupCardFromDraft` round-trip it, and the built card
carries only a name, a members map and the books — no emails, phones or
organisation — so a merge can never fold a person into it.

**The member search reuses the contact search.** `memberCandidates` filters with
`filterCards` (the same free-text matcher the Contacts page uses), never offers
another group, and skips the ids already chosen. It is capped so the picker
stays a picker.

**The duplicate warning is the same detection.** `duplicatesInGroup` runs
`findDuplicateGroups` over the group's members with the options the Duplicates
page scans with (per-book policies and ignore rules included), so a list cannot
hold a duplicate the rest of the plugin would not see. The Groups page flags
such a list and the editor warns as the membership is edited; the list itself is
never changed — the review goes through the one review dialog (see `.clinerules`).

Two parts of #12 are deliberately not built because the host has no surface for
them: groups in the composer's autocomplete, and a membership view inside the
webmail's own group card.

### 6.11 Normalisation rules (`src/lib/rules.js`, `rules-dialog.js`, v1.35.0) — #20

The rules engine generalises the E.164 cleanup: a rule is one transformation of
one field, and a *batch* of them is planned, previewed, applied and rolled back
exactly as the cleanup is — `planRules` returns the same
`{ id, name, patch, before, changes }` shape, so `applyNormalisation` and
`undoCleanup` are reused rather than re-implemented, and one *Undo cleanup*
covers both.

**Two kinds of rule, one order.** `BUILTIN_RULES` is a fixed catalogue
(collapse whitespace, title case, strip a legal suffix, phone to E.164, email
case); a user rule is a literal, case-insensitive find-and-replace on one field.
`orderedRules` is the only place that decides the order — the enabled built-ins
in catalogue order, then the user rules in the order they were stored — so the
same input and the same rules always give the same output, and an object's
iteration order can never leak into a result.

**The patch is the whole field.** As in the cleanup, the host replaces a map
wholesale, so the patch carries the complete new map and `before` carries the
one it replaced.

**Three entry points, one transform.** `applyRulesToCard` is the same function
behind all of them: the dialog (on demand, over a selection or every contact),
the import wizard (the rules run *before* the duplicate keys are taken, so the
preview matches what would be written and a rule that fixes a spelling can fix
the match) and the contact editor (a save writes the normalised card). A failed
rule read never blocks a save — the card is written as typed.

**Two limitations, said out loud.** `name.case` / `org.case` rewrite a word
written entirely in capitals, which rewrites a genuine acronym too; a
find-and-replace rule is the way to put one back. `phone.e164` needs a region,
which the cleanup dialog stores — with no region there is nothing honest to do,
so the rule leaves the number alone rather than guessing.

### 6.12 The change history (`src/lib/history.js`, `history-page.js`, v1.36.0) — #25

The History tab is the local half of #25: a record of **the plugin's own
writes**. It is deliberately not an audit log of the address book — a plugin
cannot see who else changed a contact — and the page says so, because a
compliance surface that overstates what it knows is worse than one that does
not exist.

An entry is `{ at, kind, contacts, detail, undoable }`, kept newest first in
`api.storage` under `changeHistory` (per account and per browser), capped at
100, repaired on read, and removed rather than written when it would be empty.
`recordHistory` **never throws at its caller**: a change that was made must not
be reported as failed because the note about it could not be stored.

**Recording is a by-product, not a second code path.** `saveUndo` and
`applyNormalisation` are the choke points every batch already passes through, so
a merge, a delete batch, a cleanup and a rules batch all record themselves, and
a future batch task will too without being told to. The single-contact paths
(editor create/update/delete, group create/update/delete) and the import and
bulk paths call `recordHistory` directly, one line each.

**One rollback, in one place.** `liveRollback` picks the newest of the two
records that can still be undone — a merge batch or a cleanup/rules record — and
the page offers exactly that, through `undoLastMerge` / `undoCleanup`. The
history never invents a second undo: it points at the one that exists.

### 6.13 The GDPR and consent toolkit (`src/lib/consent.js`, `privacy.js`, `privacy-page.js`, `consent-dialog.js`, v1.37.0) — #26

The *Privacy* tab answers a data-subject request. #26 asked for four things —
export everything held about a person, erase or anonymise them, a consent basis
per contact and source with an expiry, and proof-of-deletion reports — and the
first and the last already had machinery to reuse: the export is `contactsToFile`
(#22) and the delete is `deleteContacts` (#14, v1.14.0).

**Consent is a record *about* a contact, not a field on it.** The host has no
consent field, and inventing one would put data the user did not type into their
address book, so `consent.js` keeps records in `api.storage` — per account and
per browser, like the projects, the saved searches and the history. A record is
`{ contactId, source, basis, grantedAt, expiresAt, note }`, one per
(contact, source) with the source folded to lower case, and the basis is one of
the six lawful bases of GDPR Art. 6. The plugin does not judge which applies —
that is the controller's call — so the list is exactly the regulation's.

**An expiry is a status, not a filter.** `consentStatus` is `active`, `expiring`
(within 30 days of the date), `expired` or `none`, and `daysUntilExpiry` is the
number behind it. A record with no expiry never expires. Dates are stored as
`YYYY-MM-DD`, the shape an `<input type=date>` uses, so what is written is what
the user picked.

**Erase and anonymise are two different promises.** *Erase* deletes the card
through `deleteContacts`, so it leaves the same undo record every other delete
does — a data-subject erasure is still recoverable inside the undo window — and
then drops the contact's consent records. *Anonymise* keeps the card as an empty
tombstone (`anonymisePatch` clears every field in `PERSONAL_FIELDS` with
`undefined`, the way undo clears a field) so nothing that pointed at the id
dangles. Both write a proof-of-deletion entry.

**A tombstone is never a duplicate.** `isMergeable` already kept a group out of
detection; it now keeps an anonymised card out too, through the same single
gate, so an anonymised contact is never offered as a duplicate of a person.

**The proof-of-deletion log holds no personal data.** An entry is
`{ at, id, method, fields, books }` — the id, whether it was erased or
anonymised, and which fields were cleared. It deliberately does **not** keep the
name: a log that did would put back the data the erasure was for. The page
exports it as a CSV report. `recordDeletion` never throws at its caller, for the
same reason `recordHistory` does not.

**The subject-access export is the whole card, plus the records about it.**
`buildSubjectExport` returns `{ generatedAt, subject, data, consents, changes }`,
where `data` is the card in full (completeness is the point) and `changes` are
the plugin's own history entries whose `subject` is this person — the field
`history.js` grew so a consent change or an erasure can be tied to the contact
it was about.

**Consent changes are audited.** `saveConsent` and `deleteConsent` write the
record and then a `consent` history entry, one line each, so the *History* tab
shows who consented and when — the same by-product rule as the rest of the
history.

### 6.14 The automation rules engine (`src/lib/automation.js`, `automation-dialog.js`, v1.39.0) — #33

A rule is *when* + *if* + *then*: a **trigger** (a contact is created, changed,
or imported), a **condition** (a search query, empty for every contact) and
**actions** (add tag, remove tag, add to group, propose a merge).

**Only the events the host actually emits.** The triage on #33 is the design:
the host fires `onAfterContactCreate` / `onAfterContactUpdate`, the plugin owns
the import flow, and there is **no** event for a tag change or an arriving
message — so the trigger list is exactly those three and grows with the host
rather than promising what it cannot do. `assign owner` is absent because there
is no owner concept (#23), and a shared execution log needs the server tier
(#68); the local run is recorded in the change history instead.

**The plan is pure, so the dry run cannot lie.** `planAutomation(rules, {trigger,
card}, {books})` returns `{ matched, keywords, groups, proposeMerge }` and writes
nothing; `applyAutomation` applies exactly that plan. The builder's *Test* calls
`previewRule`, which uses the same per-rule delta folding, so what the preview
shows is what a run would do.

**Idempotency is what makes a save-triggered rule safe.** A tag already present
folds to no change, so `keywords` is `null` and nothing is written — a rule that
fires on `update` cannot loop with the write it just made. A group membership
that already exists is likewise a no-op (`withMember` returns `null`). Rules run
in **priority order** (then by id, so the order is total and stable), and the
later rule wins when two touch the same tag.

**A rule can never break a save.** The hooks are observers; `runAutomationForCard`
reads the rules first and returns before any other read when none match the
trigger, every write is wrapped, and `applyAutomation` never throws at its
caller. A group card or an anonymised tombstone is skipped (`isMergeable`), so
the group write cannot re-trigger the rules on the group itself.

**The import trigger runs once per batch.** `runAutomationForCards` reads the
rules and the address books once, and `importContacts` calls it over the cards
the wizard created, before any merge is reviewed — the import is the one event
the plugin owns.

### 6.15 Per-address-book roles (`src/lib/book-roles.js`, `roles-dialog.js`, v1.40.0) — #23

`src/lib/book-roles.js` is the model and `src/lib/roles-dialog.js` the dialog
behind the *Roles…* button on the Duplicates page. A role is stored in
`api.storage` (per account and per browser, like the policies) and repaired on
read; an install that never opens the dialog behaves exactly as before.

**The four roles are a strict ladder**, each step adding a capability and never
taking one away:

| Role | May |
|---|---|
| *Viewer* | view only |
| *Editor* | also create and edit contacts, groups, projects, import, normalise |
| *Merger* | also merge duplicates, undo a merge and delete contacts |
| *Admin* | also change the roles and the duplicate policies |

`roleAllows(role, capability)` is the one place that reads the table, and
`ROLE_CAPABILITIES` is the table, so the pages and the tests cannot disagree
about what a role may do.

**It is advisory, and the dialog says so.** The host grants the plugin write
access once at install, all-or-nothing; it has no per-book permission and no
shared member list. So a role cannot be enforced — the pages read it and
**disable** the actions it does not allow, and the dialog states plainly that the
webmail is not enforcing it. Enforced permissions, ownership transfer and safe
removal of a member's access need the server tier (#68).

**A contact's role is the weakest across every book it lives in.**
`roleForCard(card, roles)` folds the roles of the card's books with
`weakestRole`, so a contact in a book where the user is only a viewer stays
read-only even if another book would allow more. It is the opposite direction to
the match strategies in `book-policies.js` (which take the most permissive
reading, so a book that opts out never silences another): a limit on what the
user may do is the safe direction *inwards*. A card in **no** book — and a book
with no stored role — grants `admin`, the default.

**A global action uses the most permissive configured role.** Creating a contact
or opening the roles or policies dialog is not tied to one contact, so
`mostPermissiveRole(roles)` decides it: the action is available if any book
allows it. `canPerform(cards, capability, roles)` and `canManage(capability,
roles)` are the two calls the pages make.

The role gates the Duplicates page (*Review…*, the batch merge, *New contact*,
*Policies*, *Roles*, *Undo merge*) and the Contacts page (*New contact*, *New
company*, the per-contact *Edit*, and the selection's *Merge selected* / *Edit
selected* / *Clean up* / *Rules…* / *Delete selected*). Each page shows a muted
line naming the role when one is set.

### 6.16 The Getting started guide (`src/lib/onboarding.js`, `onboarding-card.js`, v1.41.0) — #39

`src/lib/onboarding.js` is the step model and `src/lib/onboarding-card.js` the
card at the top of the *Overview* tab. It is the onboarding half of #39: a new
install should not have to guess the order of things.

**The steps are data, and each one runs a shared action.** The order is
`welcome → import → scan → policies → done`. A step that has something to do
carries an action, and every action is the same function the command palette and
the Overview menu run (`importContacts`, `findDuplicates`, `managePolicies`), so
the guide cannot describe a different change from the one a task would make.

**It records that it is done, and re-opens on demand.** The state is a single
`{ done, at }` record in `api.storage` (per account and per browser, like the
projects). `readOnboarding` repairs junk on read, `completeOnboarding` writes the
flag and `resetOnboarding` forgets it. The Overview menu's *Getting started*
button re-opens the card without rewriting what was stored (the page keeps a
local flag), and *Finish* / *Skip the guide* writes the flag and hides the card.

**A failing step never traps the user.** Each action is awaited inside a
`try/finally`, and a step that throws (a refused dialog, a failed read) still
advances — the action reported its own failure, and the guide is a help surface,
not a gate. `managePolicies(api, { fallbackBooks })` is the one place the
policies dialog is opened from, so the guide and the Duplicates page cannot
disagree about which address books it lists; the Duplicates page passes its last
scan as the fallback for when the read fails.

### 6.17 Paging a long contact list (`src/lib/paging.js`, v1.42.0) — #39

`src/lib/paging.js` is the pure page math and the Contacts page is its only
caller. It is the scale half of #39's first bullet: the list used to render
**every** contact a query matched, so a large address book became a large DOM at
once.

**A page is a view of the results, not a limit on them.** `pageSlice(list, page,
size)` returns `{ items, page, pages, from, to, total }` for one page of
`PAGE_SIZE` (100), and the page renders `items` while the match count and *Select
all N* keep reading the whole `visible` list. So a paged list is still a bulk
scope: *Select all* after a search takes everything the query matches, not the
100 on screen. A new query resets to the first page, and `clampPage` keeps the
index in range, so a list that shrinks under the user (a delete, a narrower
query) can never leave a blank page.

**The pager is drawn with plain elements**, like the rest of the skeleton, and
sits **above** the scroll area so it does not scroll away with a long list. It is
shown only when there is more than one page, so a small address book looks
exactly as it did before.

**The budget is pinned.** `test/paging.test.mjs` slices one page out of 100k
contacts and asserts it stays well inside a budget — the cost of showing a page
must not grow with the size of the book — and `test/ui-profile.test.mjs` renders
5000 contacts and asserts the DOM holds one page.

Still to come for full scale (#39): virtualised rows, worker-based duplicate
matching and incremental search indexes.

### 6.18 Smart lists in the command palette (`src/lib/smart-lists.js`, `smart-lists-dialog.js`, v1.43.0) — #13

`src/lib/smart-lists.js` is the model and `src/lib/smart-lists-dialog.js` the
dialog behind the *Smart lists* palette action. It is the palette half of #13:
the issue asked for saved searches and smart lists "usable from the page **and
command palette**", and the page half shipped in v1.16.0.

**A smart list is a saved search with a live count.** `smartLists(saved, { total,
counts })` returns "everything" first and then one entry per saved search, with
the counts `countsForIndex` produced — positionally aligned, so the list and its
counts cannot drift out of order. `matchesFor(index, entry)` is the members,
using the **same** matcher the Contacts page uses (`isBlankQuery` /
`matchIndexed`), so a list's count and its members cannot disagree.

**The dialog reads and returns a choice; the action does the work.** The dialog
loads the cards, books and saved searches, and returns `{ export: { cards,
format, name } }`; `lib/actions.js` builds the file, names it after the list
(`fileNameFor`), hands it to the host and falls back to showing the file when the
download is refused. That keeps the dialog from ever opening a dialog of its own
— a nested dialog is a host behaviour this plugin does not rely on.

**It reuses the paging from v1.42.0**, so a list with thousands of members shows
one page of 100, and it is honest that the saved searches live in `api.storage`
per account and per browser.

### 6.19 In-app help and keyboard shortcuts (`src/lib/help.js`, `help-dialog.js`, v1.44.0) — #39

This is #39's third bullet: *in-app help, changelog and keyboard shortcuts*. The
search operators are the least discoverable part of the plugin, so the cheatsheet
is the point of the dialog.

**The cheatsheet cannot drift.** `help.js` derives the operator list from
`search.js`'s own `FIELDS`, and the `has:` / `is:` values from `HAS_FLAGS` /
`IS_VALUES` directly — so a new operator appears in the help without anyone
remembering to add it. Every worked example is asserted in
`test/help.test.mjs` to parse **without an error**, so a help line can never
describe syntax the box rejects.

**The shortcuts are scoped to the page's own search box.** On the Contacts page,
`/` focuses the search box and `Esc` clears it. `/` is ignored while a field has
focus (so typing a slash still types a slash), and `Esc` only acts when the
search box itself is focused (so a dialog's own `Esc` still reaches the host).
Both cases have a negative twin in `test/ui-profile.test.mjs` — a shortcut that
steals a keystroke meant for something else is the failure mode here.

The dialog also carries a short **what's new**, newest first; its entries are
translation keys and the test pins that the versions descend and every note
exists in both locales. Prepend an entry when a release has something a user
would want to read.

### 6.20 Follow-up tasks per contact (`src/lib/tasks.js`, `task-dialog.js`, `open-task.js`, v1.45.0) — #36

The task-creation half of #36. A *Follow up* button on the open contact opens
`task-dialog.js`; `open-task.js` creates the task through `api.tasks.create` and
the profile's task list reloads.

**A follow-up *is* a host task, not a record the plugin keeps.** So it shows in
the webmail's own task list, survives a reload and is searchable there — nothing
is cached in `api.storage`. The plugin already creates host tasks for project
milestones, so this is the proven path rather than a new one.

**The host task has no contact field, so the contact rides in the description** —
its email first, because `tasksForContact` matches a task by the words in its
title and description (`test/ui-profile` drives the whole funnel and asserts the
created payload). For the same reason the **priority is carried at the end of the
title** (`· High`): the known task shape is `{ title, description, due }`, there
is no priority field to set, and the title is the one part every task list shows.
The milestone draft's rule is kept for the due date — it is omitted, never `''`,
so the host keeps "no due date" and "due today" apart.

**Overdue is computed locally and conservatively.** `isOverdue` compares the due
date against **today in the user's own time zone** (`todayIso`, never UTC, which
can be a day off), and a task with no due date is never overdue.
`taskBuckets` splits a contact's tasks into the overdue ones and the rest, each in
due-date order with undated tasks last, and the profile badges the overdue ones
and lists them first. The tasks themselves come from `api.tasks.list` through
`optionalCall`, so a host without tasks simply shows the existing "unavailable"
note.

**A failing create is reported, never toasted as a success.** The `api.tasks`
access happens *inside* the `try`, so a host with no tasks namespace fails there
rather than at the call site.

**The cross-contact half (v1.47.0).** The Overview's *Follow-ups* block lists the
open tasks over **every** contact at once, so an overdue task is visible without
opening the contact it is about — the issue's last *done when*. `taskSummary`
splits them into overdue / due soon / later, and `isDueSoon` measures the window
in **local calendar days** (`new Date(y, m, d + 7)`), so a daylight-saving change
cannot shift the boundary by an hour and drop a task; an overdue task is never
counted as due soon. The tasks come from `api.tasks.list` through `optionalCall`,
so a host without a task list leaves the page readable and says so — the same
rule as the profile. The block renders nothing when there is nothing to chase,
rather than an empty section on the landing page.

Still to come from #36: per-contact *completion history*, and reminders — which
need a timer hook the plugin does not have.

### 6.21 Private notes on a contact (`src/lib/notes.js`, `markdown.js`, `notes-section.js`, v1.46.0) — #38

The private half of #38. A *Private notes* section on the contact profile: write
a note, read it back with a timestamp, delete it.

**Private by construction, not by a visibility flag.** The host has no note
*record* per contact, and JSContact's `notes` field is a field **on the card** —
so everyone who can see the card can see it, and a private note cannot be a card
field. A note is therefore a record *about* the contact, kept through the storage
seam (#68) on the customer's own server — a file in their own drive, or the cloud
store — like the consent records and the change history. Nothing shared can show
it because nothing shared can read it — the strongest form of "private notes
never appear in shared views". The section says so out loud (`notes.hint`),
rather than implying a flag enforces it.

**The store is bounded and repairs itself.** `normalizeNotes` keeps only real
contacts with real notes, de-duplicates by note id, drops a note with no id or no
text (corruption, not a note), and caps both the notes per contact and the total;
`readNotes` rewrites when it dropped junk and removes the key when nothing is
left. `notesFor` sorts newest first **without mutating the stored list**.

**Marks are rendered as elements, never as markup.** `parseInline` is a
deliberately tiny, documented subset — `**bold**`, `*italic*`/`_italic_`,
`` `code` ``, `@mention` — and returns tokens, so `notes-section.js` builds
`<strong>`, `<em>`, `<code>` and a badge. Nothing a note contains can become
markup, and no parser dependency is needed. An unmatched mark stays literal, so a
stray `*` is shown rather than swallowed; a matched pair *is* emphasis, however
spaced.

**It is personal data, so the GDPR toolkit knows about it.** The subject-access
export carries the notes (`buildSubjectExport({ …, notes })`), and both
`eraseSubject` and `anonymiseSubject` drop them — an erasure that left the notes
behind would be a half-measure. The vCard/CSV subject exports stay card-only,
since a note is not a card field.

Still to come from #38: team visibility, mentions that notify, and a *shared*
note store — those need the server tier's team features (#68). There is
deliberately **no author** on a note: the host exposes no user identity to the
plugin, and inventing one would be a lie.

### 6.22 Searching the private notes (`src/lib/search.js`, v1.51.0) — #38

A note that could only be read from the contact it was written on is a note you
have to remember to look for. Search is where a user asks *"where did I write
that?"*, so the search index now carries the private notes: free text, `note:`
and `has:note` treat a private note exactly like a note on the card.

**Where it is kept is not the searcher's concern.** `indexEntry` merges the
card's own `notes` with the private ones into one field, so `has:note` means "a
note about this contact" whether the host holds it or the seam does. The private
notes arrive as an option — `buildIndex(cards, { books, notes })`, the record as
`{ [contactId]: [{ text }] }` — so `search.js` stays free of `api` and of the
storage seam, exactly as it stayed free of the DOM.

**Every place that counts matches must pass it, or the page and the palette
disagree.** That is why this was its own piece of work rather than a one-line
change: the Contacts page (`profile-page.js`) and the palette's Smart lists
dialog both read the note record and both index it, so a saved search's count and
its members are the same number.

**One copy, so a new note is searchable at once.** The page reads the record
once, feeds it to the index, and hands it to the *Private notes* section as a
controlled value (`notes` + `onChange`). Saving a note updates the page's copy,
the index is rebuilt, and the word is searchable without a reload — a second read
inside the section would have left the index describing the notes as they were
when the page opened.

**An unavailable store is not an error.** `readNotes` never throws for a missing
server, and the page catches a failed read as "no notes", so search keeps working
over the cards alone — the #68 rule that a record feature degrades instead of
breaking the page.

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
| `npm test` | Runs `pretest` (the build) and then `vitest run` — currently **906 tests in 60 files** |
| `npm run package` | Builds and writes `contact-manager.zip` with `manifest.json` and `index.js` at the ZIP root, then re-opens the ZIP to verify its entries |

The bundle is CommonJS because the host `require()`s it; React and the
plugin host are **not** bundled, the host provides them.

### 7.1 The test suite

| File | Covers |
|---|---|
| `test/contacts.test.mjs` | Name/email/phone extraction across the card shapes, `isMergeable`, `matchOptions` |
| `test/duplicates.test.mjs` | Normalisation, key building, union-find grouping, strength, reasons, sorting, hidden groups, and the precision/recall fixture set for name evidence (#8) |
| `test/name-match.test.mjs` | Name matching: the fold (diacritics, transliteration, Cyrillic/Greek, both German spellings), the nickname table and its ambiguous aliases, the phonetic key, Jaro-Winkler, the name split, and the pairwise pass with its guards |
| `test/book-policies.test.mjs` | Policy resolution: per-book overrides, the most-permissive rule, the ignore rules, and the repairs on read |
| `test/merge.test.mjs` | `pickPrimary`, `planMerge` (unions, fills, keywords, patch shape), `mergeGroups` (update before remove, failure handling) |
| `test/ui-page.test.mjs` | The manager page: scanning, statistics, hide/restore, selection, and the bulk merge by company/domain (facets, the dry-run plan, the dialog, the cap) |
| `test/bulk-merge.test.mjs` | Bulk merge: the company and domain keys, the facets read off the groups, one group under every facet its members have, the batch plan, and the cap against the undo record |
| `test/ui-policies.test.mjs` | The policies dialog: the book list, the ignore sections, and the save |
| `test/rules.test.mjs` | The normalisation rules: what each built-in does, the order they run in, the user rules (literal, case-insensitive, deletion), the plan and its counts, and the storage repairs (#20) |
| `test/ui-rules.test.mjs` | The rules dialog: previewing a built-in and a rule of your own, the disabled apply, storing the choice, and removing a rule |
| `test/groups.test.mjs` | The group model: what a group card is, the member map shapes, the draft round trip, the member search, and the duplicates a list may hold (#12) |
| `test/ui-groups.test.mjs` | The Groups page (list, flag, search, empty state, open create/edit) and the group dialog (create, validation, edit, delete, the live duplicate warning) |
| `test/history.test.mjs` | The change-history store (repairs, the newest-first cap, a failed note never reaching the caller) and that every write path records itself — merge, delete, cleanup, rules, import, bulk (#25) |
| `test/ui-history.test.mjs` | The History page: the list, the counts, the live rollback and running it, and the clear |
| `test/consent.test.mjs` | The consent store: the record repair, one per (contact, source), the expiry status and days left, the summary, and the storage repairs (#26) |
| `test/privacy.test.mjs` | The subject export (completeness, subject filtering), the anonymisation patch and the tombstone marker, erasure leaving an undo record and a proof of deletion, the deletion log and its CSV report, and the consent audit (#26) |
| `test/ui-privacy.test.mjs` | The Privacy page (subject picker, export through the host download, anonymise, erase, the deletion log) and the consent editor (save, status, remove, refusal) (#26) |
| `test/automation.test.mjs` | The automation engine: the rule repair and ordering, the store, the condition, the pure plan (trigger, condition, priority, idempotency, groups, merge proposal), the dry run, and the write path (tag patch, group membership, merge proposal, a refused write) (#33) |
| `test/ui-automation.test.mjs` | The rule builder: the empty state, saving a rule, the dry run count, removing a rule, and toggling one off (#33) |
| `test/preview.test.mjs` | The complete details of the kept contact, added and changed values with their source, not-merged conflicts, conflict options and the summary counts |
| `test/ui-dialog.test.mjs` | The review dialog (complete details, colour-coded merge preview, footer buttons, keep-selector, confirm, cancel) and the contact detail section |
| `test/optional.test.mjs` | `optionalCall`: a value, a synchronous throw, a non-promise, a rejection |
| `test/layout.test.mjs` | The page skeleton: a wrapping flex row, a fixed-basis scrolling side pane, a shrinkable detail pane |
| `test/bulk.test.mjs` | `applyBulkEdit` / `applyTags` / `applyBooks`: complete map patches, the company marker, a card that would be in no book, one write per contact; and `deleteContacts` with its undo batch |
| `test/ui-bulk.test.mjs` | The bulk editor dialog: what it collects for tags and books, cancel, and an account with no books |
| `test/vcard.test.mjs` | The vCard writer: one block per contact, CRLF, the importable fields, RFC 2426 escaping, structured N/ADR |
| `test/search.test.mjs` | `parseQuery` (operators, unknown fields, values, `OR`/grouping, the ast only when needed, unbalanced parentheses and a dangling `OR`), matching per field, the fuzzy floor, and 10k contacts inside the 100 ms budget |
| `test/saved-searches.test.mjs` | The saved-search store: names, replacement, the cap, and the repairs it makes on the way in |
| `test/phones.test.mjs` | `toE164` across international and national formats, the refusals (no country, ambiguous, not a number), the length bounds, and `phoneKey` agreeing across spellings |
| `test/emails.test.mjs` | Email syntax, role addresses and throwaway domains, and that a role address is a warning rather than a rejection |
| `test/avatar.test.mjs` | MD5 against the published vectors, the Gravatar URL shape, `mediaUris`, and that a stored photo wins over Gravatar while Gravatar needs the setting |
| `test/ui-avatar.test.mjs` | The avatar element: lazy, no referrer, and gone the moment the image fails |
| `test/health.test.mjs` | Every rule and its weight, the score floor, the band cutoffs, the per-book breakdown, and the drill-downs |
| `test/ui-health.test.mjs` | The dashboard: the average, the book rows, filtering by a rule, the scores on the rows, and the fixes it offers |
| `test/ui-home.test.mjs` | The main page: the headline numbers, the last-scan line, each row leading into its section, the menu running the same actions as the palette, and the duplicate digest (stale, new, acknowledged, hidden groups, *Review now*) |
| `test/digest.test.mjs` | The digest: the window, staleness at every boundary, the baseline (including an empty one), what counts as new, the cap and the repairs on read |
| `test/csv.test.mjs` | The RFC 4180 cases: quoted commas and newlines, doubled quotes, CRLF, a BOM, empty fields |
| `test/vcard-parse.test.mjs` | vCard 3.0 and 4.0, folded lines, grouped properties, the escapes, and junk |
| `test/import.test.mjs` | Header guessing for Google and Apple exports, row to draft, the duplicate plan by email, phone and name, the per-duplicate key, and the merge groups an import queues |
| `test/import-templates.test.mjs` | Remembered mappings: found by header row, replaced, capped, repaired |
| `test/ui-import.test.mjs` | The wizard: guessing, previewing, a decision per duplicate (skip / merge / separate), the batch default, remembering a mapping, vCard, and cancel |
| `test/export.test.mjs` | The CSV writer, the column widths, and the **round trip** for both formats: export, re-import, compare |
| `test/retention.test.mjs` | The age thresholds at every boundary, the buckets, and that no date means no claim |
| `test/remote.test.mjs` | The server client: unconfigured, no proxy, a refusal, a throw, a bad answer, and the URL and credential it sends |
| `test/normalise.test.mjs` | The cleanup plan (complete maps, the values it keeps), its application, the refusal that is left out of the record, and the undo putting everything back exactly |
| `test/capabilities.test.mjs` | The optional-API probe: wanted methods present, renamed, absent, empty and unreadable |
| `test/ui-kit.test.mjs` | Every `@plugin-host/ui` name the source imports is exported by the kit stand-in |
| `test/editor.test.mjs` | Draft ↔ JSContact conversions, validation and the dirty check (#9) |
| `test/ui-editor.test.mjs` | The create/edit/delete dialog: create, validation, cancel, edit and delete (#9) |
| `test/undo.test.mjs` | The undo records: the retention window, the size caps, eviction, purge, restore and a partial restore |
| `test/watch.test.mjs` | The save-time duplicate warning: the create and edit paths, and the setting off |
| `test/profile.test.mjs` | Contact search, task and timeline matching for the 360° profile (#10) |
| `test/projects.test.mjs` | The project model and storage, the milestone task draft, billable totals, and the JSON export/import (#11) |
| `test/ui-projects.test.mjs` | The Projects page and editor, and the milestone task it creates (#11) |
| `test/ui-shell.test.mjs` | The one app page: the sub-tabs, the first-mount rule and the revision bump |
| `test/report.test.mjs` | `reportError`: the host alert, the toast fallback, and a refused alert |
| `test/book-roles.test.mjs` | The role ladder and its monotonicity, the unknown-role default, the storage repairs, the weakest-link reading and the empty-map default (#23) |
| `test/ui-roles.test.mjs` | The roles dialog: the four roles per book, the advisory line, cancel and the save (#23) |
| `test/onboarding.test.mjs` | The guide's step order, the clamps at both ends, and its storage repairs (#39) |
| `test/ui-onboarding.test.mjs` | The Getting started card: each step's action, the walk forward and back, and Finish/Skip (#39) |
| `test/smart-lists.test.mjs` | The smart-list model: the entries and their counts, the members of a list, and the export file name (#13) |
| `test/ui-smart-lists.test.mjs` | The Smart lists dialog: the counts, the members of a picked list, and the export choice (#13) |
| `test/help.test.mjs` | The help model cannot drift from the search box: the operators match `FIELDS`, and every example parses (#39) |
| `test/ui-help.test.mjs` | The Help dialog: the cheatsheet, the shortcuts and what's new (#39) |
| `test/tasks.test.mjs` | The follow-up payload, the due-date rules and the overdue split (#36) |
| `test/ui-task.test.mjs` | The follow-up task editor: the prefilled title, the priority suffix and the due-date rule (#36) |
| `test/notes.test.mjs` | The note store, its repairs and the erasure (#38) |
| `test/markdown.test.mjs` | The tiny inline formatter: each mark, the precedence, and the unmatched cases (#38) |
| `test/ui-notes.test.mjs` | The Private notes section: add, the marks as elements, per-contact isolation and delete (#38) |
| `test/release.test.mjs` | The release guard: the manifest/package/CHANGELOG agreement, and the notes it extracts |
| `test/ship.test.mjs` | The ship plan: which pull requests are ready, which are blocked, and retargeting a stacked one |
| `test/labels.test.mjs` | `formatDate`: a date and a timestamp agree, an empty value is empty, and a value that is not a date is shown as it is |
| `test/store.test.mjs` | The storage seam (#68): every key the plugin stores is classified as a record or view state, a record goes to the customer's own server when Files is on and to the cloud when it is not, and with neither it writes nothing locally |
| `test/files-store.test.mjs` | Records in the customer's own Files storage (#68): the folder is made once and reused, a value round-trips as JSON, removal is a tombstone because the host has no delete, the folder is read once per session (the rate limits), and a failure is reported rather than cached |
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

## 9. Repository, releases and changelog policy

### 9.1 Where the code lives

| Path | Contents |
|---|---|
| `contact-manager/` | The full source tree — `src/`, `test/`, `test-utils/`, `scripts/`, `manifest.json`, `package.json`, `vitest.config.mjs`, `README.md`, `HANDOFF.md`, `CHANGELOG.md` |
| `.clinerules` (repository root) | The rules for changing the code, and the contract the test suite enforces |

The source lives in **`zyntrax/bulwark-plugins`** on GitHub. Installable ZIPs
are published as assets on
[GitHub Releases](https://github.com/zyntrax/bulwark-plugins/releases); no
build artifacts are committed.

### 9.2 Release checklist

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

### 9.2.1 Roadmap and todos

There is **no local todo file**. The roadmap lives in GitHub:

* [Milestones](https://github.com/zyntrax/bulwark-plugins/milestones) — group the
  feature issues. Their titles (`v1.2.0` … `v2.0.0`) are the **originally planned
  releases**, not the current release train; read them as phases and read each
  milestone's description for what has shipped and what remains.
* [Issues labelled `roadmap`](https://github.com/zyntrax/bulwark-plugins/issues?q=is%3Aissue+label%3Aroadmap)
  — the individual features and tasks.
* The pinned roadmap issue — the top-level vision linking every milestone.

New ideas become a new issue with the `roadmap` label and a milestone.

### 9.3 Changelog policy

* The changelog is **user-facing**: describe what a user can now do, not how
  the code is structured.
* Every release gets an entry — including bug fixes. A release without a
  changelog entry is not finished.
* The version in `manifest.json` and the top entry in `CHANGELOG.md` must
  always agree.

### 9.4 Versioning rules

| Change | Bump |
|---|---|
| New feature, new surface, new setting | minor (`1.1.0`) |
| Bug fix, wording change, internal refactor | patch (`1.0.1`) |
| Removing a surface, a setting or a permission | major (`2.0.0`) — announce it first |

---

## 10. License

No separate `LICENSE` file is committed in this plugin folder yet, and the terms
are the maintainer's to set. The repository README's default — *"the same license
as Bulwark Mail"* — is **not to be relied on**: the maintainer has said the
licence will be set later and the current position disregarded.

The repository is **private** and no licensing decision is needed to keep
working. What follows from that, and what does not:

- **Feature placement is open.** Some features that exist today may end up in
  the paid tier. Do not treat the current split as a promise.
- **Server-side work may continue.** Nothing waits on the licence text.
- **A plugin-side feature must still work with no server configured**, because
  most users will never set one up.

`manifest.json` names the `author` (`Alexander`); add a `LICENSE` file, and a
`license` field beside it, when the terms are settled.

