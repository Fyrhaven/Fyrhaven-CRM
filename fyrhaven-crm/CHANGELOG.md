# Changelog

All notable changes to the **Contact Manager** plugin are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

The version in `manifest.json` is the single source of truth — the entry at the
top of this file must match it.

## [1.59.0] — 2026-11-05

### Changed

- **The cloud address is `crm.fyrhaven.com`.** The domain is bought and serving,
  so the one address a subscriber never types now points at it. `crm.mailz.se`
  keeps answering as an alias, so an install that connected before this release
  keeps working exactly as it did — the address is only read when connecting.

## [1.58.0] — 2026-11-04

### Added

- **A Settings sub-page.** Server and licence, the preferences that are not the
  host's, and an About line — together, instead of a button in the Overview menu.
  The behaviour settings (language, enabled, Gravatar, undo window, digest,
  save-time warning) stay where the host draws them, Settings → Plugins; this page
  says so rather than offering a second form over the same value.
- **The server connection can be locked down for the installation.**
  `configSchema.allowServerConfig` is an administrator switch (new `admin:config`
  permission): with it off, a normal user sees *"your administrator manages this
  connection"* and no button — because changing it moves every record in the
  company to another server.

## [1.57.0] — 2026-11-04

### Added

- **Licences, from the plugin.** The *Dedicated server* dialog now shows the
  self-hosted server's **installation key** (the thing you take to the website),
  whether it is licensed and until when, a field to **install a licence key** the
  site gave you, and a **Release this installation** flow that asks the server for
  a challenge and takes back the signed release code — so a licence can move to
  a new server without emailing anyone.
- **A second credential for a server you run.** `store-basic` (HTTP Basic, user
  name and password) is used for self-hosted connections; the cloud keeps the
  bearer token. A password-protected server therefore needs no token, and the
  password never reaches the plugin page.

### Notes

Nothing in the dialog decides whether a licence is valid: the server verifies the
key and answers, and the dialog repeats that answer. Writing a check twice is how
two checks end up disagreeing.

## [1.56.0] — 2026-11-04

### Changed

- **The rename is complete: the plugin is `fyrhaven-crm`.** The id, the page
  title (en and de), the ZIP (`fyrhaven-crm.zip`), the release tags
  (`fyrhaven-crm-v*`) and the `fyrhaven-crm` mirror branch all follow the name
  now — there is nothing left a user can see that says "contact-manager".
- The project export is tagged `bulwark-fyrhaven-crm-projects` and named
  `fyrhaven-crm-projects.json`. **Old export files still import**: `parseExport`
  accepts a bare array as well as the wrapper.
- The record server moved to `fyrhaven-server/` (package `fyrhaven-store`, 1.4.0).

### Notes

**What a new id costs, and what it does not.** A plugin id is its identity with
 the host, so this install starts with empty *local* state: settings (language,
 enabling switches, the gravatar toggle), the undo batch, the onboarding flag, the
 saved searches and the server address. **Records are not affected** — projects,
 private notes, consent records and the change history live on the server under
 their own store keys (`projects`, `contactNotes`, …), not under the plugin id, so
 they are all still there. Re-enter the two settings and the *Dedicated server*
 address and nothing else changes.

## [1.55.0] — 2026-11-04

### Changed

- **The plugin is now Fyrhaven CRM.** The name a host and a user see, the docs and
  the GitHub project all say it, and the description says what it became: contacts,
  companies, projects and time — not just a duplicate remover. The icon is the
  lighthouse mark from `brand/`: the beam is what makes it readable at 16 px, the
  stripes live in the lockup where there is room for them.
- **Nothing to migrate.** The plugin id, the storage keys and the ZIP/tag names are
  unchanged, so the update lands in place and every record stays where it is. The
  id/tag/folder rename (`contact-manager` → `fyrhaven-crm`) is a separate,
  mechanical change with its own release.

## [1.54.0] — 2026-11-04

### Added

- **The server settings now ask *which* server, not just where (#147).** The
  dialog is *Dedicated server* and offers two ways in: **Contact Manager Cloud**
  — the service, with a fixed address that is shown as a fact and never as an
  editable field, and a *Sign in* button — or **my own server**, where you type
  the address. The choice is remembered, so the dialog opens where you left it.
- **Connected is not the same as entitled.** After a successful connect the plugin
  asks `GET /v1/account` and reports the plan and its expiry; a lapsed plan says
  so ("records can be read, not written") instead of failing at the first save,
  and an installer token is reported as unlimited.

### Notes

The cloud address is in `remote.js` (`CLOUD_ORIGIN`) and is not read from storage:
pointing a subscriber at someone else's server is a support call nobody wants. A
self-hosted install keeps typing its own address, exactly as before.

## [1.53.0] — 2026-11-04

### Added

- **A project says where it lives, and you choose (#68).** The record now carries
  a target — **your own server** (your Files storage: *only you* can open it) or
  **the Contact Manager server** (shared with the workspace) — and the project
  dialog asks when both are configured. The list and the project card show which
  one it is, so nobody has to guess who can see a project.

- **A record never moves behind your back.** The storage seam grew an explicit
  target (`readAs` / `writeAs` / `removeAs`): a write aimed at your own drive is
  reported `unavailable` when Files is off instead of quietly landing in the
  cloud, and the other way round. Projects are read from **both** servers and
  merged, so a move rewrites both halves — one copy, never two.

### Changed

- The export file no longer claims projects are "local only" — they are records
  on a server, and the note says which one.
- The *Private notes* and *Projects* wording no longer says "local": a project on
  your own server is **yours alone**, which is a statement about the server, not
  about this browser.

### Notes

Access control *per project* — choosing which colleagues can read, write, add
time or create tasks — is the next step and needs accounts and identities on the
store; the badge added here is what it will hang off. Issues opened for that, for
protecting the service, and for the signup/ordering site.

## [1.52.0] — 2026-11-04

### Added

- **The plugin can be pointed at a Contact Manager server (#68).** Until now the
  cloud tier was unreachable from the plugin: the address was read from storage
  and nothing ever wrote it, and the manifest declared no credential, so a
  request had no token to carry. A new *Cloud server* dialog (Overview menu and
  the command palette) takes the address, the **host** asks for the workspace
  token through `api.proxy.connect` and keeps it, and the plugin remembers only
  where the server is. On success it says what the server answered, so a wrong
  address or a refused token is visible immediately rather than at the first
  record the user tries to save. *Disconnect* forgets the address and asks the
  host to drop the credential.
- **`manifest.json` declares that credential** — `credentials.store`, `scope:
  "user"`, `inject: bearer` — so the token never ships in the ZIP and
  `api.proxy.fetch` has something to attach.

### Notes

The dialog only returns a *choice* (`{ connect: { url } }` / `{ disconnect:
true }`), and `actions.js` performs it — the same rule every other dialog here
follows, and the reason `api.proxy.connect` (which opens a dialog of the host's
own) is never driven from inside one. Nothing is written until the host answers
`connected`, so closing that dialog leaves the plugin exactly as it was.

Verified against a live instance: `https://crm.mailz.se/version` answers
`{"ok":true,"version":"1.0.0"}`, `/v1/store` is `401` without a token, and a
container on the same Docker network as the webmail reaches that HTTPS address —
so the path the proxy takes works. **Not yet confirmed against a live webmail**:
`api.proxy.connect`'s exact dialog is the host's, and the shape used here is the
one in the host's own documentation.

## [1.51.0] — 2026-11-04

### Added

- **The Contacts search finds your private notes (#38).** Until now a note was
  readable only from the contact it was written on: looking for the one where
  you wrote *"met at the conference"* meant opening contacts until you found it.
  Free text, `note:` and `has:note` now see a private note exactly where they
  see the card's own, so the word is enough. The **command palette's smart
  lists count the same matches** as the page, and a note is searchable **the
  moment it is saved** — the page holds one copy of the note record and hands it
  to both the search index and the *Private notes* section, so the two cannot
  drift.

### Changed

- **The Private notes hint tells the truth again.** It still said the notes were
  kept *in this browser*; they have lived on your server since 1.49.0. It now
  says so, and mentions that the search box finds them.

## [1.50.5] — 2026-11-03

### Fixed

- **A `Contact Manager` folder someone else shared would be used instead of the
  user's own.** `files.list()` returns *the user's own drive **and the top items
  others shared with them***, so a folder with this name that another account
  made was picked up — and writes into a shared folder are refused, so saving
  would fail, and reading it would mean reading somebody else's records as your
  own. The lookup now takes only a folder this user **owns** (`shared`/`owner`
  aside), and makes its own otherwise.

### Notes

**Two users do not collide on `projects.json`.** Each person's records live in
**their own** drive, so two colleagues each have their own
`Contact Manager/projects.json`; the shared case above is the only way the two
could ever meet, and it is now excluded. Records are also **not** shared until
the user shares the folder in the Files app, and then read-only.

A file **per record** (`projects/<id>.json`) is the natural next step once
records can be written by more than one person — it would make a concurrent edit
or one corrupt file a local problem instead of a whole-list rewrite. It is not
free: the seam's API is whole-store (`read`/`write` by key), so it would become
record-level, and a bulk edit would cost one write per record against the host's
20-a-minute cap. Worth doing — with the cloud tier, where shared writes exist.

## [1.50.4] — 2026-11-03

### Fixed

- **A saved project was still missing when the page was reopened.** The file was
  on the server, but `files.getText` answers with an **object**
  (`{ text, status, truncated, … }`), not a string — reading it as one made
  `JSON.parse` throw, the throw was swallowed, and the store looked empty. The
  read handles the documented shape, and **a record that is there but unreadable
  now reports the failure instead of looking like no data at all** — which is
  how this hid for two releases.

- **The test double returned a bare string from `getText`**, which is why the
  suite passed while a real host showed nothing. It now returns the documented
  object, and a test pins both the object shape and the `no_text` status.

## [1.50.3] — 2026-11-03

### Fixed

- **Saving a second project failed with *"no file or folder with id
"projects.json""*.** `files.create`'s `replace` is the **id** of the file being
replaced — not a flag (1.50.1) and not a name (1.50.2). The store keeps each
file's id from the folder listing, sends it as `replace`, and keeps the id the
host reports back, so the next save replaces the right file. Both fakes now
reject a `replace` that is not a file they actually hold.

## [1.50.2] — 2026-11-03

### Fixed

- **A saved project was gone the next time the page opened.** Reported from a
  live install — the file was there under Files, but the Projects tab was empty.
  The store read the folder with `find`, which searches by **text**; with no text
  it returns nothing, so every reopen looked at an empty folder. It uses
  `list(folderId)` now, which is the call that lists what is *in* a folder, and
  both fakes keep the two apart so the mistake cannot come back.

### Notes

**A record in Files is shared with nobody but its owner, and the plugin cannot
change that.** There is no share call on `api.files`, and the host refuses writes
into a folder shared with others — so `Contact Manager/` shows *Only you* until
the user shares the folder in the Files app, and even then the others get
**read-only**. Team-*writable* records are exactly what the cloud tier is for.

## [1.50.1] — 2026-11-03

### Fixed

- **Saving a record to Files failed with *"replace must be a string of 1-256
characters"*.** Reported from a live install: `files.create`'s `replace` is not
**a flag but the name of the file being replaced**. The store now sends
`replace: <name>` only when that file is really in the folder, so a first write
is an ordinary create, and the test double rejects any non-string `replace` so
the mistake cannot ship again.

## [1.50.0] — 2026-11-03

### Changed

- **Consent records are records on your server now (#26, #68).** They went the
  same way as projects and notes, through the storage seam — which matters more
  here than anywhere: a consent record is what a data-subject request is answered
  from, and one that vanished with site data would be worse than useless. The
  subject-access export, the erasure paths and the audit entry are unchanged.

## [1.49.0] — 2026-11-03

### Changed

- **Private notes are records on your server now (#38, #68).** They went the same
  way as projects: through the storage seam, so a note lives on your own server
  instead of only in one browser — and it still never touches the contact card.
  `writeNotes` throws when there is nowhere to write, so a note that could not be
  saved is reported rather than shown as kept. The subject-access export and the
  erasure paths follow the note to its new home unchanged.

### Fixed

- **Saving a record to Files failed with *"type must be text/markdown or
text/plain"*.** Reported from a live install: `files.create` refuses
`application/json`, and 1.48.0 asked for exactly that, so every project save
there failed. The value is written as `text/plain` now — which is what JSON is —
and the test double refuses any other type, so the same mistake cannot ship
again.

## [1.48.0] — 2026-11-03

### Added

- **Records can live on the customer's own Stalwart server (#68).** `api.files`
  is Stalwart's file storage, so the storage seam gained a `files` backend that
  keeps one JSON file per store in a `Contact Manager/` folder in the user's own
  drive. No cloud, no token, no secret — their server, their backups.

### Changed

- **Where a record goes is now decided in one place.** `recordBackend(api)`
  answers `'files'` (the customer's own server), `'cloud'` (the dedicated server,
  for a host without Files) or `'unavailable'`. There is **no fallback to the
  browser**: with neither server, a record feature says so and offers the cloud,
  and writes nothing locally.

### Notes

Two host facts shape the files backend, both from the plugin guide. **Writes go
only into the user's own drive** and there is **no delete call**, so removal is a
tombstone (`null`) and the store is per user — a team *reads* a folder the owner
shares, it cannot write it. And the calls are **rate-limited** (`getText` 30/min,
writes 20/min), so the folder is listed and read **once per session** and cached;
that cache is why `store.js` keeps one files store per `api`. If `api.files`
fails, the seam reports `unavailable` with the reason rather than an empty store —
an empty list and an unreachable server must never look alike.

No behaviour changes yet: no store has been switched over, so every feature still
reads where it read before. Switching them is the next step, projects first.

### Changed — projects are records now

**Projects moved onto the seam**, so they are the first feature to stop living in
a browser: saved to your own server through Files (or to the cloud, if that is
configured), and they follow you between devices. `saveProject` and
`deleteProject` now **throw** when there is nowhere to write instead of
pretending — a failed write is never toasted as a success.

The page tells the truth about it: with no server storage at all it shows a
notice naming what is missing rather than an empty project list, and
`projects.localNotice` no longer claims the records are browser-only.

Two permissions were added for this: **`files:read`** and **`files:write`**.

## [1.47.0] — 2026-11-03

### Added

- **Overdue follow-ups on the Overview (#36, the cross-contact half).** The
  landing page now has a *Follow-ups* block: the open tasks over **every**
  contact at once, overdue ones first and badged, then anything due within the
  next seven days, and a count of what can wait. An overdue task used to be
  visible only on the contact it was about.

### Notes

The tasks come from `api.tasks.list` through `optionalCall`, so a host without a
task list leaves the page readable and says so rather than showing nothing. The
seven-day window is a **local calendar day** (`new Date(y, m, d + 7)`), so a
daylight-saving change cannot shift the boundary by an hour and drop a task; an
overdue task is never counted as due soon. `formatDate` moved from the profile
page into `labels.js`, so the Overview and the profile cannot disagree about what
a date looks like.

### Also in the tree: the storage seam (no behaviour change yet)

The first step of the decision recorded in #68 — **the server is the source of
truth for records this plugin invents**, because a record kept only in a browser
is unreachable from another device and gone when site data is cleared. Nothing
changes for a user yet: no store has been switched over.

`src/lib/store.js` is now the one place that decides where a key's bytes live —
`RECORD_KEYS` go to the dedicated plugin server, `VIEW_KEYS` stay in
`api.storage` (view state, preferences, and the server's own address, which has
to be readable before any server can be reached). A record write with no server
reports *unavailable* and writes nothing locally. `src/lib/remote.js` gained the
key/value client (`GET`/`PUT`/`DELETE /v1/store[/{key}]`) over the host's
`http:proxy`, with the credential held by the host. `test/store.test.mjs` pins
the routing and asserts that **every** key constant the plugin exports is
classified, so a new store cannot be added without deciding which kind it is.

## [1.46.0] — 2026-11-02

### Added

- **Private notes on a contact (#38, the private half).** A *Private notes*
  section on the contact profile: write a note, and read it back with a
  timestamp and delete it. Notes are rendered as elements, never as markup, with
  a tiny documented subset — `**bold**`, `*italic*`/`_italic_`, `` `code` `` and
  `@mention` — so a note can never become markup.
- **The subject-access export now carries the notes, and erasure takes them
  away.** A data-subject request is answered with everything held about the
  person, and the private notes are held about them; an erasure or
  anonymisation removes them, or it would be a half-measure.

### Notes

A note is **private by construction**: the host has no note *record* per
contact, and JSContact's `notes` field is a field ON the card that everyone who
can see the card can see — so a private note cannot be a card field. It is a
record *about* the contact, kept in `api.storage` per account and per browser,
exactly like the consent records and the change history; nothing shared can show
it because nothing shared can read it. The section says so out loud.

Still to come from #38: team visibility, mentions that notify, and search across
notes — all of which need the server tier (#68) for the shared half. There is
also no *author* on a note: the host exposes no user identity to the plugin, and
inventing one would be a lie.

## [1.45.0] — 2026-11-02

### Added

- **Follow-up tasks per contact (#36, the task-creation half).** A *Follow up*
  button on a contact's profile opens a small editor — title (prefilled), due
  date, priority and notes — and creates the task through `api.tasks.create`. A
  follow-up *is* a real host task, so it shows in the webmail, survives a reload
  and is searchable there.
- **Overdue tasks are flagged on the profile.** The contact's open tasks are now
  sorted by due date with anything past its due date badged *Overdue* and listed
  first.

### Notes

The host task has no field this plugin can point at a contact, so the contact
rides in the description — its email first, because `tasksForContact` matches a
task by the words in its title and description. For the same reason the
**priority is carried at the end of the title** (`· High`), where every task list
shows it; there is no host priority field to set. Still to come from #36: a
cross-contact *My tasks* view with overdue/upcoming filters (it must degrade
cleanly on a host whose `api.tasks` is absent or shaped differently — the #75
lesson) and reminders, which need a timer hook the plugin does not have.

## [1.44.0] — 2026-11-02

### Added

- **In-app help and keyboard shortcuts (#39).** A new *Help* action (Ctrl+K, and
  a *Help* button on the Overview menu) opens a dialog with the **search
  operator cheatsheet** — every field operator, what `has:` and `is:` accept,
  and worked AND / OR / grouping / exclusion examples — plus the **keyboard
  shortcuts** and a short **what's new**.
- **Keyboard shortcuts on the Contacts page:** `/` jumps to the contact search
  box and `Esc` clears it.

### Notes

The cheatsheet is derived from the search box's own constants (`FIELDS`,
`HAS_FLAGS`, `IS_VALUES`), so a new operator cannot ship without appearing in the
help, and every worked example is asserted to parse in the test suite — a help
line cannot describe syntax the box rejects. Both shortcuts are scoped to the
Contacts page's own search box: `/` is ignored while a field has focus, and `Esc`
only clears when the search box is focused, so a dialog's own `Esc` still reaches
the host. This completes #39's third bullet (*in-app help, changelog and keyboard
shortcuts*); the scale bullets shipped in v1.41.0–v1.42.0.

## [1.43.0] — 2026-11-02

### Added

- **Smart lists in the command palette (#13, the palette half).** A new
  *Smart lists* action (Ctrl+K) opens the saved searches with their **live
  counts**, shows the contacts a list holds, and exports the chosen list as a
  vCard. The saved searches were reachable only from the Contacts page until
  now; this is the palette half the issue asked for.

### Notes

The dialog is honest about where the data lives: a saved search is stored in
`api.storage` per account and per browser, so the list is the one you saved on
this browser. It reads and returns a *choice* — the export happens in
`lib/actions.js` after the dialog closes — so the dialog never opens a dialog of
its own, and the export falls back to showing the file when the sandbox refuses
the download, exactly as the Contacts page does. The list is paged with the same
`paging.js` the Contacts page uses, so a very large list does not build a very
large DOM.

## [1.42.0] — 2026-11-02

### Added

- **A paged Contacts list (#39, the scale half).** The Contacts tab used to
  render every contact a query matched, which is fine for a few hundred and a
  freeze for tens of thousands — the whole match set became DOM at once. It now
  renders one page of 100 at a time, with *Previous* / *Next* and a
  `Page X of Y · A–B of N` line above the list. A new query starts at the first
  page, and a shrinking list is clamped so a page index can never point past the
  end.

### Notes

The page is a view of the results, not a limit on them: the match counts and
*Select all N* still work over the whole match set, so a paged list is still a
bulk scope. `src/lib/paging.js` is the pure page math (`pageCount`, `clampPage`,
`isPaged`, `pageSlice`) and a budget test pins that slicing one page out of 100k
contacts does not walk the list. Still to come for full scale (#39): virtualised
rows, worker-based duplicate matching and incremental search indexes.

## [1.41.0] — 2026-11-02

### Added

- **A first-run "Getting started" guide (#39, the onboarding half).** A new card
  at the top of the *Overview* tab walks a first clean-up once: bring your
  contacts in (import), scan for duplicates (which opens the review dialog),
  and choose what to scan (the address-book policies). Each step runs the same
  action the command palette and the menu run, and the guide records that it is
  done so it does not open again on its own. Reopen it any time from the
  Overview menu.

### Notes

The guide is a first-run help surface, not a second code path: every button
calls a shared action in `lib/actions.js`. Opening the policies dialog from the
guide and the Duplicates page now goes through one `managePolicies` action, so
the two cannot disagree about which address books it lists. The step is
remembered in `api.storage` (per account and per browser, like the projects and
the saved searches); a step whose action fails does not trap the user — the
guide still advances.

## [1.40.0] — 2026-11-02

### Added

- **Per-address-book roles (#23, the advisory half).** A new *Roles* dialog
  (the *Roles…* button on the Duplicates page) records who may act on each
  address book: **viewer**, **editor**, **merger** or **admin**. The four form a
  strict ladder — a viewer may only look; an editor may create and edit; a merger
  may also merge duplicates and delete; an admin may also change the roles and
  the duplicate policies. The pages reflect the role by disabling the actions it
  does not allow, so a viewer cannot merge, edit or delete.

### Notes

The host grants the plugin write access once at install, all-or-nothing, and has
no per-book permission and no shared member list, so a role cannot be *enforced*.
It is a convention a team agrees on, stored in `api.storage` (per account and per
browser, like the policies), and the dialog says so out loud. The enforced half —
and ownership transfer and safe removal of a member's access — needs the server
tier (#68). An install that never opens the dialog behaves exactly as before: a
book with no role, and a contact in no book at all, grants **admin**.

The role that applies is the **weakest** across every book a contact lives in, so
a contact that lives in a book where the user is only a viewer stays read-only
even if another book would allow more. A global action (creating a contact,
opening the roles or policies dialog) uses the **most** permissive configured
role, so it is available if any book allows it.

## [1.39.0] — 2026-11-02

### Added

- **An automation rules engine (#33).** Repetitive contact hygiene can run
  itself: a rule is *when* (a trigger), *if* (a search query) and *then*
  (actions). The triggers are the events this plugin can actually see — a
  contact is created, a contact is changed, and contacts are imported — and the
  actions are *add tag*, *remove tag*, *add to group* and *propose a merge*.
  Rules run in priority order, are idempotent (a tag already present writes
  nothing, so a rule that fires on `update` cannot loop with its own write), and
  each run is recorded in the change history.

- **A rule builder with a dry run.** A new *Automation rules* dialog (command
  palette and the main page menu) lists the rules, adds or changes one, and
  *Test* shows how many contacts it matches and what it would change — through
  the same `previewRule` the engine uses, so the preview cannot describe a
  different change from the one a run would make. Rules are kept in
  `api.storage`, per account and per browser, like the projects and the history.

### Notes

Deliberately absent, because the host does not provide them: an *on tag* or *on
email* trigger (no such events), *assign owner* (there is no owner concept,
#23) and a shared execution log (needs the server tier, #68). The trigger list
grows with the host rather than promising what it cannot do. A rule can never
break a save: the hooks are observers, the writes are wrapped, and a group card
or an anonymised tombstone is skipped.

## [1.38.0] — 2026-11-02

### Added

- **OR and grouping in the search box (#34).** A query can now say *either*:
  `tag:vip OR tag:customer`, or group with parentheses —
  `(tag:vip OR tag:customer) has:email`. Adjacent terms are still AND, `OR`
  binds looser than AND, and `OR` is case-insensitive. An unbalanced parenthesis
  or a dangling `OR` is reported under the box, and the rest of the query is
  still parsed so a typo never throws the search away.

- **A saved search — or any query — as a bulk scope (#34).** A *Select all N*
  button under the search box turns everything the list currently shows into the
  selection, so *Merge*, *Edit*, *Clean up*, *Rules*, *Export* and *Delete*
  apply to the whole set rather than to hand-picked rows. Click a saved search,
  then *Select all*, to act on exactly what it matches.

### Fixed

- **A query that is only a negation now filters the list.** `-tag:vip` (or
  `not:tag:vip`) used to be parsed correctly but the page showed the whole
  address book, because it decided "is there a query?" from the positive terms
  and filters alone. It asks `isBlankQuery` now, the same rule the matcher uses,
  so the list and the match count agree.

## [1.37.0] — 2026-11-02

### Added

- **A GDPR and consent toolkit (#26).** A new *Privacy* tab answers a
  data-subject request: pick a person, see what personal data the address book
  holds about them, export it all as JSON (the subject-access export, with the
  consent records and this plugin's own changes for that person), vCard or CSV,
  and erase or anonymise them.

- **Consent records, per contact and source, with an expiry.** Each record
  carries one of the six lawful bases of GDPR Art. 6, the date it was granted
  and an optional expiry. A record within 30 days of its expiry is shown as
  *expiring*, and an expired one as *expired*. The records live in
  `api.storage` — per account and per browser, like the projects and the history
  — because the host has no consent field and inventing one would put data the
  user did not type into their address book.

- **Erase or anonymise, with confirmation, and a proof-of-deletion report.**
  *Erase* deletes the contact through the same delete path everything else uses
  (so it leaves an undo record), drops its consent records and writes a
  proof-of-deletion entry. *Anonymise* overwrites every personal field, keeps
  the card as an empty tombstone so nothing that pointed at it dangles, and
  records the same entry. The deletion log records the contact id, the method
  and the fields cleared — never the name, which the erasure removed — and
  exports as a CSV report.

### Notes

Consent changes are audited: every save or removal writes a `consent` entry to
the change history, tied to the subject it was about, and an erasure or
anonymisation writes an `erase`/`anonymise` entry. An anonymised tombstone is
kept out of duplicate detection by `isMergeable`, the same single gate that
keeps a group out, so a tombstone is never offered as a duplicate of a person.

## [1.36.0] — 2026-10-30

### Added

- **A change history of the plugin's own writes (#25, the local half).** A new
  *History* tab lists what this plugin wrote — merges, cleanups, rules batches,
  imports, bulk edits, contact creates/updates/deletes and group changes —
  newest first, with how many contacts each touched and whether it can still be
  rolled back. It says out loud that it is a record of the plugin's own writes,
  not an audit log of the address book: a plugin cannot see who else changed a
  contact, and a compliance surface should not pretend otherwise.

- **The rollback that is still live, in one place.** The tab offers the newest
  batch that can still be undone — a merge record or a cleanup/rules record —
  through the same undo the other pages offer, so a change made from anywhere
  can be taken back from the history.

### Notes

The history lives in `api.storage` (per account and per browser, like the
projects and the saved searches), keeps the newest 100 entries and repairs
itself on read. It never blocks a write: a change that was made is not reported
as failed because the note about it could not be stored. Recording is a
by-product of the write path rather than a second code path — `saveUndo` and
`applyNormalisation` are the choke points every batch already passes through, so
a future batch task records itself without being told to.

## [1.35.0] — 2026-10-30

### Added

- **A normalisation rules engine for names, organisations, phones and email
  addresses (#20).** A *Rules…* button on the Contacts selection, and a
  *Normalisation rules* command-palette action, open a dialog with seven
  built-in rules — collapse whitespace, title-case a shouting name or
  organisation, strip a trailing legal suffix, phone numbers to E.164, and trim
  and lower-case an email address — plus your own literal find-and-replace
  rules on one field. The exact edits are previewed before anything is written.

- **One deterministic order.** The built-ins always run in the catalogue order,
  then your rules in the order you added them, so the same input always produces
  the same output. The order is a property of the catalogue, never of an
  object's iteration order.

- **The rules also run on import and on edit.** An imported file is normalised
  before its duplicate plan is worked out, so the preview shows what would be
  written (and a rule that fixes a spelling can fix the match); the editor
  applies the enabled rules when a contact is saved.

### Notes

A rules batch is applied and rolled back by the same machinery as the E.164
cleanup, so one *Undo cleanup* covers both. Two limitations are deliberate and
said out loud in the dialog: title-casing rewrites a genuine acronym written in
capitals — that is what title case means, and a find-and-replace rule puts one
back — and the phone rule needs a region, which the cleanup dialog sets.

## [1.34.0] — 2026-10-30

### Added

- **Contact groups: distribution lists as first-class records (#12).** A new
  *Groups* tab lists the group cards in your address books and lets you create,
  rename, search and delete them, and add or remove members with a contact
  search. A group is an ordinary JSContact card (`kind: 'group'`) written
  through `api.contacts`, not a local record — so it is shared across devices,
  searchable and exported with your contacts, unlike the local-only Projects.

- **A duplicate warning inside a list (#12).** The Groups tab flags a group
  whose members contain two contacts that look like the same person, using the
  same detection and policies as the Duplicates page, and the editor warns as
  the membership is edited. The list itself is never changed — the review
  happens where every other merge does.

### Fixed

- **A group card can never be merged as a person (#12).** The group marker is
  now recognised by its keyword as well as `kind`, so a host that does not keep
  `kind: 'group'` still leaves a distribution list out of duplicate detection.

### Notes

The command palette gains *New group*. Two parts of #12 are deliberately not
built because the host has no surface for them: using groups in the composer's
autocomplete, and a membership view inside the webmail's own group card. Both
are host changes, like #11 and the command-palette half of #13.

## [1.33.0] — 2026-10-27

### Added

- **Smarter name matching (#8).** The same person written differently now reaches
  the same key: scripts are romanised (`Иванов` ≡ `Ivanov`, `Γιώργος` ≡ `Giorgos`),
  German umlauts match **both** honest spellings (`Müller` ≡ `Mueller` and
  `Müller` ≡ `Muller`), and a curated nickname table pairs `Bob`/`Robert`,
  `Bill`/`William`, `Peggy`/`Margaret` and more. An ambiguous alias is left alone
  rather than guessed at — `Alex` is both Alexander and Alexandra.

- **Initials, phonetic surnames and near-miss given names.** A second, pairwise
  pass finds `J. Smith` ≡ `John Smith`, `John Smyth` ≡ `John Smith` and
  `Sara` ≡ `Sarah`. It only looks inside a bucket that already shares a phonetic
  surname, and **the given name has to corroborate** — so `John Smith` and
  `Jane Smith` stay two people, which matters more than any recall.

- **A `nameSimilarity` setting** (60–100, default 80) is how alike two given names
  must be. Initials and nicknames are structural and always match; the threshold
  governs typos and short forms only.

### Fixed

- **`normalizeName` now romanises instead of leaving a script alone.** It kept
  Cyrillic as Cyrillic, so `Иванов` and `Ivanov` could never match. A script with
  no table is still kept as it is, so a name never collapses to `''`.

### Notes

Every group these rules produce is **`possible`**, never `strong`, and its reason
names both spellings (`Similar name: J. Smith ↔ John Smith`) so the user decides.

A guard the tests found on the first run: the phonetic key of `1` and `10` is the
same, which collapsed a 51-group fixture into groups of 22, 4 and 2. A surname now
needs at least two letters, and two different surnames must be *similar*, not
merely bucketed. A bucket with more than 60 members is skipped entirely — a
surname that common is a crowd, not a clue.

## [1.32.0] — 2026-10-27

### Added

- **Bulk merge by company or domain (#6).** The Duplicates page now reads the
  facets out of the duplicate groups themselves — *Acme Inc. · 2 groups*,
  *@example.org · 3 groups*, and *All N groups*. Picking one selects every group
  it touches, shows what the batch would do (`{groups} group(s) · {contacts}
  contact(s) · {removals} would be removed`) and merges the whole batch through
  the one review dialog, with its per-group *Keep* override and its confirmation.

- **A safety cap on one batch.** More than 50 groups disables *Merge* and says
  why instead of quietly trimming the selection: 50 groups removes at least 50
  contacts, which still fits the 100-card undo record, so a capped batch can
  always be undone.

### Notes

The facets are **read from the data, not typed**, so a company is matched exactly
as it is written — the user clicks the spelling that exists. Rewriting
`Acme Inc.` to `Acme` is #20 (normalisation) and is deliberately not duplicated
here. A facet that covers a single group is not offered: that is *Review* on that
group.

"…or group" in the issue title is the detected duplicate group; contact groups
(#12) do not exist as a host object yet.

## [1.31.0] — 2026-10-27

### Added

- **A duplicate digest on the Overview page (#5).** When the plugin opens it now
  compares the last scan and the current duplicate groups against what you have
  already been shown, and says so when either the scan is older than the
  configured window or groups have appeared since. *Review now* opens the same
  review dialog as everywhere else; *Got it* acknowledges what was shown, so the
  same news is never repeated. A new `digestDays` setting (0 = off, default 7) is
  the window, and only the summary and the group signatures are stored — never
  contacts.

### Notes

This is #5 **re-scoped**. The issue asked for a *scheduled* background scan, and
there is no timer hook in the host contract (only `onAction` and the two contact
observers) and no server-side scheduler, so a scan cannot run while the webmail is
closed. The digest keeps what the issue is really about — duplicates not going
unnoticed — and needs no host change. The *"a scheduled scan runs without opening
the page"* line is deliberately struck; the staleness signal replaces it.

The digest counts exactly what a scan would, so it respects the *enabled* switch,
the match strategies, the per-book policies and the ignore rules. Groups the user
has **hidden** are left out: a hidden group is a decision, not news.

## [1.30.0] — 2026-10-27

### Added

- **A decision per contact for duplicates during import (#4).** The wizard used
  to offer a single switch for the whole file — hold back every duplicate, or
  import every duplicate. Each contact in the file that matches one you already
  have now gets its own choice: *Skip*, *Merge into the existing contact*, or
  *Import as a separate contact*, with one default that applies to the whole
  file. The choices are kept for the batch, so a file does not have to be
  decided twice.

- **A merge chosen during import still goes through the review dialog (#4).**
  "Merge" writes the imported contact and then hands the pair to the one review
  dialog every merge in this plugin uses (see `.clinerules`), pre-selected to keep the
  contact that was already there. Nothing is merged without the user seeing the
  plan, and the merge is undoable like any other.

### Notes

The detection half of #4 shipped in v1.21.0; this closes the remaining gap — the
*clear per-group decision* the issue asked for. The import now reports what it
wrote, what it skipped and what it queued for review instead of a single count.

## [1.29.0] — 2026-10-27

### Added

- **Ignore rules by field: ignored companies (#7).** The policies dialog gains a
  third ignore rule beside domains and tags. A contact is skipped when its
  organisation name **contains** the text, so one rule covers `Acme`,
  `Acme Inc.` and `ACME GmbH` — an exact match would fail silently on the
  spellings nobody can predict.

### Fixed

- **A rule that set only companies did nothing.** `filterForScan` decided whether
  to filter at all by testing `domains` and `tags` itself, so a companies-only
  rule never reached `isCardIgnored` and the scan returned every duplicate as
  before. There is now one `hasIgnoreRules(ignore)` that every caller asks, so
  adding a rule type cannot leave a gate behind again. The new test caught it.

### Notes

This completes #7's build list apart from the auto-merge threshold, which is
deliberately not built: every merge must go through the review dialog (see `.clinerules`), so
an automatic merge would bypass the one surface the plugin insists on.

The stored ignore record is now `{ domains, tags, companies }`; a record written
by an earlier version repairs itself on read.

## [1.28.0] — 2026-10-27

### Added

- **Protected fields, per address book (#7).** A book can now freeze the fields a
  merge must never change — name, emails, phones, organizations, notes, tags and
  the rest. The kept contact's books decide, and a field protected by **any**
  book the contact is in is protected: protection is a safety property, so more
  protection is the safe way to be wrong. A protected field is not filled from a
  donor, not unioned into, and not replaced even when the dialog offers a
  donor's value.

- **The review dialog shows the policy in force (#7).** When a book protects
  fields, the dialog names them above the group, so a merge that deliberately
  leaves something alone says so instead of looking like it forgot.

### Fixed

- **An organisation filled from a donor was written but never shown.** The merge
  plan reported a filled map field (`organizations`, `titles`, `personalInfo`,
  `media`) as one whole-map entry, and the preview handed that map to `DISPLAY`
  as if it were a single entry — so the value landed on the contact with no line
  in the dialog explaining where it came from. The plan now reports one entry per
  value, the shape the union fields already used.

### Notes

`mergeGroups` reads the policies itself, so the preview and the write derive the
frozen fields from the same source and cannot disagree. A storage failure while
reading them falls back to no protection rather than refusing to merge.

## [1.27.2] — 2026-10-26

### Fixed

- **The policies dialog had nothing to configure when auto-scan was off.** The
  *Policies* button is always in the Duplicates header, but the address books it
  handed to the dialog came from the last scan — so with *Scan automatically*
  turned off the dialog opened on "No address books found." and there was nothing
  to set. The one page that owns the policies could not edit them until you ran a
  scan first. It now reads the books when the dialog opens.

## [1.27.1] — 2026-10-26

### Fixed

- **Ignored tags never matched anything.** The ignore rule read the *values* of a
  contact's `keywords` map and looked for a label on them — but the tags are the
  map's **keys** (`{ vip: true }`), which is how the search box reads them too.
  The values are booleans, so every contact sailed through the rule and the
  *Ignored tags* half of the policies dialog did nothing at all. It now reads the
  keys, and a test compares the rule against the search index so the two readings
  of `keywords` cannot drift apart again.

- **Every checkbox in the policies dialog needed two clicks.** The box was drawn
  from `!== false` but flipped with `!value`, so an untouched setting — which
  *looks* on — was read as off and the first click changed nothing.

- **A match strategy could never go back to the global setting.** Once a book had
  been overridden there was no way to undo it. The three positions the strings
  already described — *Default*, *On*, *Off* — are now a real control, and
  *Default* removes the override instead of storing a value.

- **Policies are now honoured everywhere.** The *Duplicate check* block inside an
  open contact and the warning after a save both ignored the policies, so a book
  you had turned off stayed quiet on the Duplicates page while those two kept
  reporting it.

### Changed

- A policy save that fails now says so through the host's own alert instead of
  silently re-enabling the button, and a dialog that could not *read* the stored
  policies says so too, rather than offering to overwrite them.

### Notes

13 of the 16 new tests were written first and watched fail. Each "stays silent"
test sits next to one that still warns, so silence cannot pass for the wrong
reason.

## [1.27.0] — 2026-10-25

### Added

- **Per-address-book duplicate policies and ignore rules (#7).** The Duplicates
  page gains a *Policies* button that opens a dialog to configure how each
  address book is scanned:

  | Setting | What it does |
  |---|---|
  | *Scan this book* | exclude a book from scanning entirely |
  | *Match by email / phone / name* | override the global strategy per book |

  Plus global **ignore rules** that skip contacts by email domain or tag —
  useful for noreply addresses, service accounts, or contacts you deliberately
  keep separate.

  A contact in multiple books uses the most permissive setting across all its
  enabled books, so a book that opts out never silences a match another book
  still wants. Cards with no book (the default book) are always scanned.

  The policies apply to every scan — the Duplicates page, the command palette,
  the Home overview and the Health tab.

### Notes

Policies are stored in `api.storage` (per browser, like projects) and repair
themselves on read. An empty policy set is the same as the previous behaviour:
every book is scanned with the global strategies.

## [1.26.0] — 2026-10-25

### Added

- **Act on several contacts at once from the Health tab.** Every row has a
  checkbox, and a selection reveals the same actions the Contacts page offers:

  | Action | What it does |
  |---|---|
  | *Edit selected* | tags and address books, through the bulk dialog |
  | *Clean up* | the normalisation dialog, for the ones that need it |
  | *Review* | the merge dialog, for the duplicates in the selection |
  | *Delete selected* | behind a danger confirm, and undoable |

  It reuses the machinery the Contacts page already had — `applyBulkEdit`,
  `applyNormalisation`, `deleteContacts` — so there is no second way to change
  a contact, and no second set of rules about what a map patch contains.

### Notes

A selection is dropped whenever the page reloads, so a fix cannot be applied to
contacts that have already changed underneath it.

## [1.25.0] — 2026-10-25

### Added

- **The plugin can talk to a server the user configures (#68, first step).**
  `src/lib/remote.js` holds the client, and *Check the server* in the command
  palette asks it for its version — the smallest thing that proves the path
  end to end.

  Every request goes through the **host's** proxy with the `http:proxy`
  permission, so the host holds the credential and the plugin never sees a
  secret. That is the whole reason this shape works for a paid tier: no API key
  can leak out of a ZIP.

- `scripts/mock-server.mjs` — a throwaway server for checking the path without
  touching anything real:

  ```
  node scripts/mock-server.mjs 8787
  curl http://localhost:8787/version   # { "version": "0.1.0-mock", … }
  ```

### Notes

**Five answers, never a throw.** `callServer` reports `unconfigured` (no server
set), `unavailable` (a webmail with no request proxy), `ok`, or `failed` with a
reason or an HTTP code. An unconfigured plugin is the normal case, and it
behaves exactly as it does today.

The response shape — `{ status, ok, headers, body }` — is the one the host's
own test double documents. **The request signature (`proxy.fetch(credentialId,
url, init)`) is from that same source and has not been confirmed against a live
host**: if it differs, *Check the server* reports a failure rather than doing
anything unexpected.

Nothing in this release sends user data anywhere, and the repository stays
private, so no licensing decision was needed to start.

## [1.24.2] — 2026-10-25

### Changed

- **A failure the user needs to see now stops them.** A toast is right for "that
  did not work, carry on", but some failures are not: a scan that could not read
  the address books, an undo that could not restore, a download the host refused.
  Those go through `reportError`, which uses the host’s own `ui.alert` (called
  the way `ui.confirm` is, with an object) and falls back to a toast when the
  host has no usable alert.
- **The plugin’s page has its own icon.** It used `users`, which is the webmail’s
  own contacts icon, so the rail showed two identical ones. It is `book-user`
  now — a name taken from the kit’s set, and any other name from that set works
  here if this one does not render.

## [1.24.1] — 2026-10-25

### Fixed

- **`not:` now excludes, as well as a leading `-`.** The shorthand was shipped
  without the word you had actually asked for, so `not:tag:vip` was read as an
  unknown field and searched for as text — which is why excluding a tag looked
  like it did nothing. Both spellings work now, in either case.
- **The capability probe stopped reporting the calendar as broken.** The fix in
  v1.23.2 went into the profile’s calendar range but not into the probe, which
  kept sending milliseconds and kept failing — so the log still said the
  calendar was refused while the profile had already been fixed.
- **Exports and attachments are saved by the host.** The plugin frame is
  sandboxed without `allow-downloads`, so an anchor download is refused outright.
  The API surface shows the host has `ui.downloadFile`, which is not subject to
  that flag, so `saveFile()` tries the host first and only falls back to showing
  the content when the host will not take it. This covers the contact export, the
  project export and the attachments on a contact profile.
- **A shadowed name that recursed until it ran out of memory.** The Contacts
  page already had a local `saveFile` for attachments; importing the shared
  helper under the same name made the local one call itself. Caught by the test
  suite as an out-of-memory failure rather than by a user. The local one is now
  `saveAttachment`.

## [1.24.0] — 2026-10-25

### Added

- **Exclusion in the search box.** A leading minus now excludes instead of
  requiring, on operators and on plain text alike:

  | Query | Finds |
  |---|---|
  | `-tag:vip` | everyone **without** the vip tag |
  | `is:person -has:phone` | people with no phone number |
  | `-ada` | everyone whose name, address or note does not mention ada |

  It combines with everything else, so `is:person -tag:vip -has:phone` reads as
  one sentence. A lone `-` is still just a character, and an unknown operator
  behind the minus is still reported.

### Changed

- **“Retention” is now “Untouched contacts”.** The section was named after the
  concept rather than the thing on screen, which is no help to anyone who has
  not read the changelog. The buckets already read “Untouched for a year”, so the
  heading says what they are now.
- The operator hint under the search box mentions the minus.

## [1.23.2] — 2026-10-25

### Fixed

- **Meetings now load.** The calendar window was sent as `toISOString()`, which
  ends in `.123Z`; the host accepts `2026-05-01`, `2026-05-01T09:30` or
  `2026-05-01T07:30:00Z` and **rejected the milliseconds**, so every call failed
  and the profile reported *“Meetings are unavailable”*. It was never a
  permission. `calendarRange()` now sends the accepted shape.
- **The capability probe was crying wolf.** It passed `limit` to
  `api.tasks.list`, which the host refuses as an unknown option — so tasks were
  reported as broken when the plugin’s own calls (which send no `limit`) work
  fine. The probe now sends only what the plugin sends.
- **Exporting showed a success with no file.** The console names it: *“Download
  is disallowed. The frame is sandboxed, but the flag `allow-downloads` is not
  set.”* No plugin can download in that sandbox, so the export now **opens the
  file it built** — in a text area with a *Copy to clipboard* button, and a
  *Try the download anyway* for a host that allows it. Nothing is lost either
  way.
- A little room under the tab strip, since the bar’s own height belongs to the
  kit and cannot be set from here.

### Added

- **The probe now reports the host’s API surface** — the namespaces and their
  method names:

  ```
  host API surface — api: … | ui: … | email: … | tasks: … | calendar: …
  ```

  One paste of that line says exactly what a plugin can call, which is how a
  method this plugin does not know about (opening a message, for one) becomes
  findable instead of guessed at.

## [1.23.1] — 2026-10-25

### Fixed

- **The profile crashed on a contact whose recent messages were listed.**
  `Objects are not valid as a React child (found: object with keys {name,
  email})`. The webmail is JMAP-shaped, so a message’s `from` and `to` arrive as
  an **array** of `{ name, email }` — not as one object — and the page
  rendered `from` itself when `from.email` was undefined. The same assumption
  meant the timeline **never matched a message by its sender**, so “Recent
  messages” quietly showed nothing. Both now go through `addressList` /
  `addressLabel`, which read the array, a single entry, `{ address }` and a bare
  string.
- **Exporting downloaded nothing**, while reporting success. The object URL was
  revoked on the same turn as the click, which cancels the download before the
  browser has read the blob. It is released on the next turn now. This affected
  every download the plugin offers: contact export, project export and the
  attachments on a contact profile.
- **The contact list did not refresh after an import.** Each sub-tab mounts once
  and stays mounted, so the *Contacts* tab kept the address book it read when it
  was first opened. The app page now owns a revision counter: a task that writes
  something bumps it and every sub-page reloads.
- The side pane is taller (`72vh`), so the list no longer sits in a small
  scrollbar inside a much taller page.

### Added

- **The capability probe now tries a call, not only a look.** A namespace can be
  present with its method attached and the call still refused — which is what a
  missing permission looks like from inside a plugin, and exactly what this
  instance hit: the profile said *“Unavailable: Meetings”* while the existence
  probe found nothing missing. `activate()` now makes one cheap read per
  optional namespace and logs `optional API calls failed — calendar: …` with
  the reason.

## [1.23.0] — 2026-10-23

### Added

- **Retention: who has gone untouched, and what to do about it (#21).** A
  *Retention* section on the Health dashboard with three buckets — a year, two
  years, three years — each one a filter, and the stale contacts listed oldest
  first with their age.
- **The signal is named in the UI.** The section says it works from the
  **server's own last-updated date**, and that **a contact the server never
  stamped is not counted**. Reporting a contact as untouched on no evidence
  would be worse than staying quiet.
- **The export is not optional.** *Export and delete* writes the file **as part
  of** the delete, so a retention clean-up can never be the only copy of what it
  removed — which is what the issue asks for ("never auto-delete; require
  explicit confirmation and an export"). A plain *Export* button sits beside it
  for a copy without deleting, and the delete also leaves an undo record, so it
  is recoverable twice over.

### Fixed

- The retention buckets started at a year while the list below them filtered at
  two, so the two could disagree about who was stale. The list now uses the
  lowest bucket, and a test pins it.

### Notes

**CSV is the archive format here**, because it carries every field including the
ones vCard has no place for — the issue's "bulk archive or export preserves all
fields" is asserted by the round-trip fixture added in v1.22.0.

## [1.22.0] — 2026-10-23

### Added

- **Export the selection, or everything the search shows, as vCard or CSV
  (#19, the export half).** *Export* now sits in the Contacts page header — so
  it works with or without a selection — and asks two questions: **what** (the
  selection, or every contact the current search shows) and **in which format**
  (vCard for other address books and phones, CSV for a spreadsheet).
- `src/lib/export.js` — the CSV writer, and `contactsToFile(cards, format)`.
  Email and phone columns are as wide as the **widest** contact, so nobody's
  second address is dropped, and a contact with fewer is padded with blanks.

### Fixed

- **vCard export dropped the tags.** `CATEGORIES` was never written, so a
  contact's tags survived a CSV round trip but not a vCard one. Caught by the
  round-trip fixture this release adds — which is exactly what that fixture is
  for. The company marker is still left out of both formats: it is structure,
  not a label, and re-importing it would turn a person into a company.
- An empty selection wrote a CSV with a header row and no contacts; it now
  writes nothing, like the vCard writer always did.

### Notes

**The round trip is asserted, not assumed.** `test/export.test.mjs` exports
contacts with every field the plugin stores, re-imports them through the same
pipeline the wizard uses, and compares the result field by field — for CSV and
for vCard. The CSV headers are deliberately the spellings `guessMapping`
recognises, so a file exported here and imported back needs **no column work at
all**, and a test says so.

One thing the round trip cannot promise, and the tests are honest about: a
contact that only ever had a **full name** (no first/last split) comes back with
the name intact but its parts guessed, because one column cannot say where the
boundary was. The name itself is asserted to survive.

## [1.21.0] — 2026-10-23

### Added

- **Import contacts from CSV or vCard (#19, the import half).** A new *Import
  contacts* task on the main page's menu and in the command palette opens a
  wizard that:
  - **reads the file** and works out what it is — a vCard needs no column
    questions, a CSV gets its delimiter guessed from the first line;
  - **maps the columns**, guessing from the header names (Google's `Given Name`,
    `E-mail 1 - Value`, `Address 1 - City`… and Apple's `First Name`,
    `E-mail Address`… are both recognised) and letting every column be changed;
  - **previews** the first few contacts exactly as they would be imported;
  - **holds back contacts that already exist**, matched on the same email,
    phone and name keys duplicate detection uses, so an import can never create
    the duplicates the rest of the plugin spends its time finding;
  - **remembers the column mapping** for the next file from the same service.
- `src/lib/csv.js` — an RFC 4180 parser as a character scanner rather than a
  `split`, because the two things that break a naive CSV reader are quoted
  commas and quoted newlines, and "Smith, John" in a name column is the common
  case. Handles doubled quotes, CRLF and a byte-order mark.
- `src/lib/vcard-parse.js` — reads vCard 3.0 **and** 4.0, folded lines, grouped
  properties (`item1.EMAIL`), and the RFC 2426 escapes.
- `src/lib/import.js` — rows to drafts to cards, the duplicate plan, and the
  write. Cards are built by the **editor's own `cardFromDraft`**, so an imported
  contact is shaped exactly like a hand-created one.
- `src/lib/import-templates.js` — remembered mappings, keyed by the header row
  rather than the file name.

### Notes

Three things are deliberately **not** imported yet, rather than imported badly:

- **Photos** (`PHOTO`) and **URLs** — the card builder does not write `media` or
  `onlineServices` yet, and a field the import cannot store is worse than one it
  admits it cannot. A `Website` column is therefore offered as *Ignore*.
- **Custom fields** — the host has no custom field support (#11).
- **Encoding detection** beyond UTF-8, which is what the webmail's own APIs
  hand back.

The other half of #19 — exporting the current selection as CSV or vCard, with a
round-trip fixture — is the next release, so the issue stays open.

## [1.20.0] — 2026-10-23

### Added

- **The plugin now opens on a main page, not on *Duplicates*.** The *Overview*
  tab answers *what needs attention* and *what can I do*:
  - **A headline** — how many duplicate groups and how many contacts are in
    them, or that the books are clean.
  - **A menu** — *Find duplicate contacts*, *New contact*, *New company*, *New
    project* and, while one is live, *Undo the last merge*. These are **the same
    tasks as the command palette**, not a second set that can drift.
  - **Section rows** — Duplicates, Contacts, Projects and Health, each with its
    headline number, its state badge, and an *Open* button that lands on it.
  - **When the last scan ran**, from the summary the Duplicates tab stores.
- **`src/lib/actions.js`.** The action implementations moved out of `index.js`
  into a module the page can import. They had to: the palette actions run in the
  host's background frame and a page runs in its own frame, so a menu on the
  page had nothing to call — and a second copy of the same logic is exactly what
  drifts. `index.js` keeps only the wiring.

### Notes

The sub-tabs stay as they are, with *Overview* first and selected. The main page
is what every navigation idea needs, so it is the part worth having first;
whether the sections later move behind a menu or a sidebar is still open.

The counts on the main page come from **one** load of the contacts, shared by the
duplicate scan and the health rules — the same work the Duplicates tab does when
you press its scan button, done once here instead of on every visit.

## [1.19.0] — 2026-10-23

### Added

- **A *Health* sub-tab: what is missing or broken, and what it costs (#16).** A
  fourth tab beside *Duplicates*, *Contacts* and *Projects*, with the average
  score over the whole address book, a **per-address-book** breakdown (worst
  first), the totals for each rule, and a drill-down list of the contacts,
  worst first.
- **Every deduction is named.** Eleven rules, each with its own weight and its
  own line: no name, no email, no phone, a malformed address, an unusable phone
  number, a duplicate, a throwaway domain, a function address, a phone that is
  not E.164, an address that only needs tidying, and a contact nobody has
  touched in two years. The score is deductions from 100, so the list of issues
  *is* the explanation — and a contact with more than 100 points of problems
  floors at 0 rather than going negative.
- **Every total is a filter.** `No phone number (18)` leads to those eighteen.
- **One-click fixes, reusing what is already reversible.** A phone that only
  needs normalising goes through the cleanup dialog (preview, then undo); a
  duplicate goes through the review dialog (preview, then undo); anything else
  opens the editor. A *Clean up N* button in the header handles every
  normalisation problem at once.

### Fixed

- **`rawEmailAddresses` for the health check.** `emailEntries` drops an address
  that does not look like one — it requires an `@` and no spaces — so a
  *malformed* address was invisible to exactly the check written to find it.
  The health rules read the raw map, which is also what lets them tell
  `Ada@Example.ORG` from `  Ada@Example.ORG `.

### Notes

The band cutoffs live in one place (`BANDS`), including for the per-book
breakdown, so the dashboard and the rules can never disagree about what "good"
means.

#16's "stale data" rule uses `updated` when the host provides it; a contact the
host never stamped is not counted as stale, because the plugin cannot know.

## [1.18.0] — 2026-10-23

### Added

- **Avatars on the *Contacts* list and the profile (#15, the avatar half).** A
  contact's **own photo** (`media`) is shown when it has one — it lives on the
  server, so it costs no third-party request. Otherwise **Gravatar** fills in,
  when the user has turned it on.
- **A new setting, *Show Gravatar avatars*, off by default.** Gravatar
  identifies a person by a hash of their email address, so turning this on sends
  that hash to gravatar.com. That is the user's decision, not a default, and the
  setting says so.
- `src/lib/avatar.js` — the MD5 the Gravatar URL needs, the URL itself, and
  whose picture wins. `crypto.subtle` has no MD5 and using it for SHA-256 would
  be a platform dependency the sandbox does not promise, so the algorithm is
  implemented here and checked against published vectors, including the canonical
  Gravatar example.

### Notes

**A picture that will not load simply is not there.** A blocked request (the
sandbox's content policy), an offline browser and "this contact has no picture"
are indistinguishable from inside the plugin, and all three end as nothing at
all rather than a broken-image icon. `d=404` asks Gravatar for a 404 instead of a
placeholder, which makes that the same code path. The image also sends **no
referrer** and is **lazy**, so a long address book does not fire one request per
row the moment the page opens.

The plugin cannot verify that the sandbox allows the request; if the content
policy refuses it, avatars are absent and nothing else changes.

#15's other half — universal contact hover cards — is not here; it needs host
surface this plugin does not have, and the issue stays open for it.

## [1.17.0] — 2026-10-23

### Added

- **Clean up a selection: phone numbers to E.164, addresses trimmed and
  lower-cased (#17).** The selection bar gained *Clean up*, which opens a
  **preview** — every change, per contact, before anything is written — and
  applies only what you approve. The batch is **reversible**: the dialog keeps
  what it replaced, and the page then offers *Undo cleanup* for as long as the
  undo window lasts (`undoMinutes`, the same setting the merge undo uses).
- **A country for national numbers.** `0176 1234567` and `+49 176 1234567` are
  the same number, but only once the country is known. The choice is remembered
  in this browser.
- **Phone matching across spellings.** Duplicate detection now keys phone
  numbers by their E.164 digits, so a contact saved as `0176…` and the same one
  saved as `+49 176…` finally group — the gap that made a whole class of
  duplicates invisible. Without a country set, behaviour is unchanged.
- **Role and throwaway warnings in the editor.** `info@…` and known disposable
  domains are flagged as *warnings* while editing. They never block a save —
  plenty of legitimate contacts are `info@` — they just say why the contact may
  be a weak anchor for duplicate detection.
- The email check is now shared between the editor and the cleanup flow, so the
  two can never disagree about what a usable address is.

### Notes

Three rules the implementation holds to, because each one prevents writing a
wrong value onto a contact:

- **No country, no national normalisation.** A bare `0176…` is left alone rather
  than guessed at.
- **An ambiguous number is refused.** German `0491…` (Leer) and `+49 491…` both
  exist, so a national number that already begins with the country's dial code
  is left alone instead of being double-prefixed.
- **A refusal is never recorded as a change.** A contact the host declines to
  update is counted and left out of the undo record, so undoing never reverts
  something that never happened.

The country is **not** a manifest setting: the settings schema in use here only
has boolean and number fields, and inventing a string type would be assuming
host behaviour this repo has already been burnt by (#75). It lives in
`api.storage`, set from the dialog.

#17 also mentions a *health report* — that is #16, a separate issue.

## [1.16.0] — 2026-10-23

### Added

- **Smart search with operators (#13, the page half).** The *Contacts* search
  box understands a small query language on top of free text:

  | Query | Finds |
  |---|---|
  | `ada` | free text over name, nickname, email, phone, company, note, tag and address-book name |
  | `name:ada` · `email:x.de` | one field only |
  | `phone:0176` | digits compared, so `+49 176` and `0176` agree |
  | `company:acme` | an organisation name, the email domain, or a company record's own name |
  | `tag:vip` | a keyword, matched whole |
  | `book:Work` | an address-book name **or** id |
  | `has:phone` · `has:email` · `has:note` · `has:tag` | presence |
  | `is:company` · `is:person` | what kind of contact it is |

  Every term must match, so `is:person tag:vip` narrows rather than widens. A
  name also matches fuzzily from three characters up, so `grce` finds *Grace
  Hopper*; below three, a subsequence would match half the address book.
- **Helpful feedback for a bad operator.** An unknown field, an unknown `has:`
  or `is:` value, and an operator with no value are each named in the line under
  the box — and the token is *still* searched as free text, so a typo never
  returns nothing by silence.
- **Saved searches with live counts.** A query can be saved and comes back as a
  button carrying its own count (`tag:vip · 3`). One click re-runs it; `×`
  removes it. They live in this browser only, like the projects.
- The line under the box also shows `{shown} of {total} contacts`, and the
  operator list while the box is empty.

### Notes

Built for the scale the issue asks for: one pass derives the searchable strings
per contact, and every query — the list plus each saved-search count — reuses
that index. 10k contacts search in **~30 ms** against the issue's 100 ms budget,
and a test asserts it.

#13's other half, the **command palette** entry point, stays open. The plugin has
no verified host API to make the palette switch the page to a query (cross-frame
messaging, or page navigation), and this repo has already been burnt once by
assuming an API that was not there — see #75.

## [1.15.0] — 2026-10-23

### Added

- **Bulk edit and export for a selection (#14).** The action bar for a selected
  set of contacts gained two actions:
  - **Edit selected** — one dialog for **tags** (add and remove) and **address
    books** (add to, or remove from). Both are map fields the host replaces
    wholesale, so every patch carries the complete new set and nothing else on a
    contact is lost. Two rules are enforced rather than left to the caller: the
    `company` marker is never removed — it is what makes a contact an
    organisation, not a label — and a contact is **never** left in no address
    book; that card is reported as failed instead. Tags and books go out in
    **one update per contact**, so the reported counts stay honest.
  - **Export** — the selection as a single `.vcf` (vCard 3.0), the format other
    address books and phones import. Nothing is sent to the server.
- `src/lib/vcard.js` — the vCard writer: RFC 2426 text escaping, and structured
  `N`/`ADR` values escaped per component so the separators survive.
- The single-value JSContact readers (`orgName`, `titleName`, `nicknameLine`,
  `notesLine`, `addressLine`, `linkUris`) moved to `src/lib/contacts.js`, so the
  profile and the export cannot drift apart.

### Notes

This completes #14 — tags, books, export and deletion are all covered now.

## [1.14.1] — 2026-10-23

### Fixed

- **The unavailable notice says what is actually missing.** It read
  *"Messages, meetings and tasks are unavailable — the plugin may be missing the
  email, calendar or tasks permission"* whether one API was missing or all
  three. It now names only the ones that failed, e.g. *"Unavailable: Messages"*,
  so the page no longer blames permissions the user may well have granted.

### Added

- **A capability probe on activate.** When an optional API is missing, the
  plugin logs one line naming what each namespace really exposes:

  ```
  optional APIs unavailable (email, calendar) — host exposes email: query, send | tasks: create, list | calendar: absent
  ```

  This exists because the plugin's own documented host contract turned out to
  describe an API the current host does not have: `api.email` is present on a
  current install but has no `search` method, which is what produced
  `api.email.search is not a function`. Reporting the method names the host
  *does* use is the only way to tell a renamed method from a missing one — the
  plugin cannot introspect the host from the outside. Silent on a host that has
  everything.

## [1.14.0] — 2026-10-23

### Added

- **Select several contacts and act on them (part of #14).** The *Contacts* list
  now carries a checkbox per row, and selecting one reveals a bar with the count
  and three actions:
  - **Merge selected** — the selection becomes a group and opens the **same
    review dialog** a detected duplicate group uses, so the keep selector, the
    field-by-field conflict resolution, the danger confirm and the undo all
    apply. The dialog labels it *Selected by you* instead of claiming a match
    the plugin never found, and the action needs at least two contacts.
  - **Delete selected** — a danger confirm naming the contacts, then a bulk
    delete that leaves one undo batch, so the page's undo banner restores every
    removed contact. A contact the host refuses to delete is reported rather
    than hidden.
  - **Clear selection.**
  A contact that disappears — deleted, or filtered out of the list — drops out
  of the selection instead of lingering in it.

### Fixed

- **The search box stays put.** It sat *inside* the scrolling list, so scrolling
  the address book carried it out of view. The pane is now a column: the search
  box fixed above, the list scrolling beneath it. Only the list scrolls.

### Notes

#14 also asks for bulk tag and address-book edits and bulk export; those remain
open. This release covers the deletion half and the merge path.

## [1.13.2] — 2026-10-23

### Fixed

- **The *Contacts* page lays out as a two-pane split again.** The page built
  its list-beside-profile skeleton out of the kit's `Row`/`Stack` and sized the
  panes with an inline `style` prop. On a real host the split collapsed into a
  single column: the contact list ran the full width of the page, grew without
  bound and pushed the profile — details, duplicate check, meetings, files,
  recent messages, open tasks — off the bottom. The skeleton is now drawn by
  the plugin itself (`src/lib/layout.js`): a plain wrapping flex row, a side
  pane with its own scrollbar, and a detail pane that can shrink. The kit still
  draws every piece of content inside the panes, so the page keeps looking like
  part of the app.
- **The *Projects* page is fixed the same way** — it used the identical
  `Row`/`Stack` + `style` pattern, so it collapsed identically.
- The *Projects* import file input is hidden by a wrapper element instead of an
  inline `style` prop on the kit's `Input`, so it can no longer surface as a
  raw file control in the toolbar.

### Notes

The kit's `Row`/`Stack` remain the right choice for *content* (the actions row,
a card's inner stack, the dialog footer). They are no longer used for the
page's skeleton, because whether they forward a `style` prop to the DOM is not
part of any contract the plugin can check — the unit-test stand-in drops it,
which is why this bug was invisible to the suite.

## [1.13.1] — 2026-10-23

### Fixed

- **The *Contacts* tab no longer crashes when an optional API is missing.**
  Recent messages, open tasks and meetings are optional context, but the page
  read `api.email`, `api.tasks` and `api.calendar` directly and only handled a
  *rejected* promise. A host without one of those namespaces (or one whose
  method returns nothing) throws before a promise exists, which took the whole
  sub-tab down. Optional calls now go through `optionalCall`, so the profile
  stays readable and says what is unavailable.
- **New and edited projects are saved.** The project dialog collected the
  draft and returned it, but nothing ever wrote it to storage — the *Projects*
  tab stayed empty and an edit was silently lost. `openProject` now stores the
  result, so the page and the command palette both save, and a storage failure
  is reported instead of a false “Project created.”.
- The unavailable-context notice now names meetings as well, since a missing
  `calendar:read` shows it too.
- **The missing UI-kit guard is back.** `test-utils/ui-kit.mjs` claimed a
  `ui-kit.test.mjs` checked that it exports the same names the source uses, but
  the file did not exist. `test/ui-kit.test.mjs` now fails when the source
  imports a `@plugin-host/ui` name the kit does not export — the other way a
  sub-tab can crash on open.

## [1.13.0] — 2026-10-23

### Added

- **Time and expenses per project (#57).** A project now records **time
  entries** (whole minutes on a date, with a note and a *billable* flag) and
  **expenses** (an amount, a date, a note, billable). The project card shows
  the running totals: recorded and billable time, and the billable amount —
  billable minutes at the hourly rate plus the billable expenses, rounded to
  cents and shown in the project's currency.
- **Export and import (#57).** *Export* writes one JSON file holding every
  project, with a header saying the data lives in one browser only; *Import*
  merges such a file back in (newest record per id), so the data is never
  trapped.

### Notes

Everything here stays **local to this browser**; nothing is sent to the server.
Deleting a project still drops only its local record.

## [1.12.0] — 2026-10-23

### Changed

- **One tab, three sub-tabs.** The navigation rail now carries a single
  *Contact Manager* entry; *Duplicates*, *Contacts* and *Projects* are
  sub-tabs inside it instead of three separate rail entries. A sub-tab mounts
  the first time it is opened and then stays mounted but hidden, so switching
  tabs keeps a scan result or a selected contact.

## [1.11.1] — 2026-10-23

### Fixed

- The Projects page rendered its project card and its milestone list as an
  array of children without keys, so React logged a "unique key" warning on
  every render. Both are now children of one fragment.

## [1.11.0] — 2026-10-23

### Added

- **Projects (#57).** A *Projects* page tracks client work: a project has a
  name, a status, a linked company and people, a description, a currency and an
  hourly rate. **Milestones are real tasks** — each one is created with
  `api.tasks.create` and its state is read back from `api.tasks.list`, so it
  appears in your task list like any other task. The new `tasks:write`
  permission is needed for that.

### Notes

Project records are **local to this browser** (`api.storage`) and do not sync
between devices; the page says so plainly. Deleting a project drops only that
local record — its milestone tasks and the linked contacts stay.

## [1.10.0] — 2026-10-23

### Added

- **Files on the profile (#58).** The *Files* section of a contact and of a
  company now shows each attachment's type, size and date next to the message
  it came from, and a *Save* button streams the file to your computer through
  `api.email.getAttachment`. No copy is kept on the server and nothing is
  cached locally — the bytes only pass through. The download needs the new
  `email:blob-read` permission; without it the section stays readable and a
  failed save shows an error instead of breaking the profile.

## [1.9.0] — 2026-10-22

### Added

- **Company profiles (#22).** Companies are contacts with `kind: 'org'`, so
  their data lives in the address books and is shared like any contact. The
  editor gains a company mode (name, domains, address, notes, tags) and the
  company page shows the domains, the linked people — matched by organisation
  name or email domain — and the rolled-up messages, meetings, files and open
  tasks across everyone at the company.
- The Contacts page gained a *New company* button, and company cards show a
  *Company* badge that links to their people.

## [1.8.0] — 2026-10-22

### Added

- **Automatic activity tracking on the profile** — meetings and files join the
  recent messages and open tasks, all matched without manual linking:
  calendar events by participant or title (`api.calendar.getEvents`), and the
  attachments of the recent messages, de-duplicated by name and size.
- **Company line** on the contact profile: the organisation, the matching
  company record and how many people belong to it. Companies are contacts
  with `kind: 'org'`; people link by organisation name or email domain.
- New permission: `calendar:read`, needed only for the meetings section;
  without it the profile still loads and says what is missing.

### Notes

The new `profile.js` helpers (`companyOf`, `peopleOfCompany`,
`companyDomains`, `eventsForContact`, `attachmentsForMessages`) are the
foundation for company profiles (#22) and the files section (#58).

## [1.7.0] — 2026-10-21

### Added

- **Contacts page with a 360° profile.** A second page lists every contact
  with a search box over names, nicknames, emails and phones. Selecting one
  shows its details, tags, notes, the duplicate check, the **recent messages**
  from and to the contact and the **open tasks** that mention it — the record
  view the CRM direction (#54) builds on.
- Messages and tasks come from `api.email.search` and `api.tasks.list`, so the
  plugin now asks for the `email:read` and `tasks:read` permissions. If either
  is missing the profile still loads and says so.

### Changed

- The navigation rail now carries two entries: *Contact Manager* (duplicates)
  and *Contacts* (the profile).

## [1.6.0] — 2026-10-21

### Added

- **Contact editor (create, edit, delete).** The plugin can now create a
  contact, change every field it manages, and delete one — all without
  leaving Bulwark. Opened from the command palette and the Contact Manager
  page (*New contact*) and from the contact details (*Edit contact*).
- Fields: first/last name, nickname, multiple email addresses and phone
  numbers each with a *preferred* flag, one postal address, organisation,
  job title, notes, tags and address-book membership.
- **Validation** before writing: a name, email or phone is required, email
  addresses are checked, phone numbers need at least five digits, and a new
  contact needs an address book.
- **Dirty-state protection**: cancelling with unsaved changes asks first.
- A failed write keeps the dialog open with the reason and the form intact.

### Changed

- The `plugin-dialog` slot now serves two components: the review/merge dialog
  and the editor (`extraProps.editor` picks which).
- The command palette gained *New contact*.

## [1.5.0] — 2026-10-21

### Added

- **The other name is kept as a nickname.** When duplicates carry different
  names (for example *Bob* and *Robert Smith*), the review dialog now offers
  the differing name with three choices: *Keep as a nickname* (default),
  *Use it as the name*, or *Discard it*. The nickname is written in the same
  `api.contacts.update` that patches the kept contact, so Stalwart keeps the
  contact findable under both names.
- The merge preview shows the nickname as a green `+` addition, and the undo
  record covers it — undoing a merge removes the nickname it added.

### Changed

- `planMerge` returns `nameSuggestions` and writes every accepted name into
  `patch.nicknames`; a name that becomes the contact's name is never also
  added as a nickname.

## [1.4.0] — 2026-10-21

### Added

- **Warning while saving.** After a contact is created or changed, the plugin
  compares it with the address books and shows a non-blocking warning when it
  looks like an existing contact, naming the match and the reason (same email,
  phone or name). Backed by the `onAfterContactCreate` and
  `onAfterContactUpdate` hooks — saving is never blocked.
- **`warnOnSave` setting** to turn that warning off.
- The open contact's *Duplicate check* block is the persistent hint: it offers
  *Review duplicates*, which opens the shared review dialog.

## [1.3.0] — 2026-10-21

### Added

- **Undo a merge.** Every merge now leaves a short-lived undo record, and the
  Contact Manager page shows a banner with *Undo merge* and *Forget*. Undo
  brings back every removed contact and returns the kept contact to its
  earlier field values.
- **Undo window setting.** *Settings → Plugins → Contact Manager → Undo window*
  controls how long a merge can be undone (default 15 minutes, `0` turns undo
  off).
- **Command palette entry** *Undo the last merge*, shown while an undo record
  exists.
- **Partial undos are retried.** When a contact cannot be re-created the rest
  is kept undoable and the toast reports how many steps failed.

### Changed

- The merge confirmation no longer says the merge "cannot be undone".
- Undo records are bounded (100 removed cards / ~400 kB) and expire on their
  own; expired records are purged when the plugin loads or reads them.

## [1.2.0] — 2026-10-20

### Added

- **Field-by-field conflict resolution.** When the kept contact and a duplicate
  disagree on a single-value field (name, organisation, title, personal info
  or media), the merge window now shows a *Resolve differences* picker for
  each field. Keep the current value or take the duplicate's value before
  merging.
- **Orange `~` changed values** in the complete-details preview, with a muted
  `was …` line showing the value being replaced.
- The summary line now counts `kept · new · changed · not merged`, and the
  legend explains the changed indicator.
- `planMerge(group, keepId, choices)` records replacements in `changed`;
  `mergeGroups(..., choiceBySignature)` writes the selected values.

## [1.1.0] — 2026-10-20

### Added

- **Complete details in the merge window.** The review dialog now shows every
  detail of whichever contact is selected as *Keep* — name, e-mail, phone,
  address, organisation, title, nickname, online services, links, notes,
  anniversaries, keywords, personal info and media — not only the fields that
  change.
- **Green `+` values** mark every value the merge brings in from another
  contact, and the field names the source contact beneath it.
- **Orange `≠` values** mark details that another contact has but that will
  **not** be merged, because the kept contact already has its own value in a
  single-value field (for example a different name or organisation).
- **Legend and summary** — *How to read this* explains the colours and
  symbols, and each group shows a `kept · new · not merged` count.
- The details redraw immediately when a different contact is chosen as *Keep*.

## [1.0.0] — 2026-10-20

First public release.

### Added

- **Contact Manager page** (`app-page` slot): scans every address book, shows
  the contact and address-book counts, and lists the duplicate groups with
  their strength badge (*Certain match* / *Possible match*) and the reason
  they matched (*Same email address*, *Same phone number*, *Same name*).
- **Review and merge dialog** (`plugin-dialog` slot): one shared dialog for
  every entry point. It shows the member roster, a per-group *Keep* selector,
  the *After the merge* preview of every field that will be kept and added
  (and which contact each added value comes from), and asks for confirmation
  before anything is deleted.
- **Command palette action** — *Find duplicate contacts* scans all contacts.
- **Contact list action** — *Find duplicates in selection* scans only the
  selected contacts.
- **Duplicate check in contact details** (`contact-detail-section` slot): a
  per-contact hint that lists the suspected duplicates and opens the review
  dialog for that group.
- **Duplicate detection** in `src/lib/duplicates.js`: union-find over
  normalised email, phone and name keys, so matches are transitive. E-mail
  and phone matches are *certain*; name-only matches are *possible*.
- **Safe merge** in `planMerge` / `mergeGroups`: one contact is kept (most
  populated fields, then oldest, then lowest id — always deterministic), the
  missing details of the others are copied into it as a complete union, and
  the duplicates are removed only **after** the kept contact was updated
  successfully. A failed update skips the whole group; a failed removal is
  reported in a warning toast.
- **Hide and restore** for duplicate groups the user does not want to act on.
- **Settings**: *enabled*, *autoScan*, and one switch each for matching by
  e-mail address, phone number and name.
- **German translation** — every string is available in `en` and `de`.

[1.2.0]: https://github.com/zyntrax/bulwark-plugins/releases/tag/contact-manager-v1.2.0
[1.1.0]: https://github.com/zyntrax/bulwark-plugins/releases/tag/contact-manager-v1.1.0
[1.0.0]: https://github.com/zyntrax/bulwark-plugins/releases/tag/contact-manager-v1.0.0
