# Changelog

All notable changes to the **Contact Manager** plugin are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

The version in `manifest.json` is the single source of truth — the entry at the
top of this file must match it.

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
deliberately not built: every merge must go through the review dialog (§9.2), so
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
