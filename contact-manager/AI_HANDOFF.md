# AI Handoff - Contact Manager Plugin

> The authoritative handoff for this plugin. It lives in the repository at
> `contact-manager/AI_HANDOFF.md` and is published on GitHub on the branches
> `main` and `contact-manager` (identical content on both).

## Current State
- **Version**: 1.25.0 (`manifest.json` is the single source of truth; `package.json` and `package-lock.json` match)
- **Last changes**: the server client and the `http:proxy` permission — *Check the server* asks a user-configured server for its version (#68, first step, v1.25.0); on top of failures worth stopping for using the host’s `ui.alert`, and the page having its own icon (v1.24.2); on top of `not:` as well as `-`, the probe’s calendar format, and exports saved through the host’s `ui.downloadFile` (v1.24.1); on top of search exclusion (v1.24.0) and plainer wording for the untouched-contacts section; before that, v1.23.2 (Meetings were refused because the calendar range carried milliseconds, the probe cried wolf about tasks, exporting shows its file because the sandbox forbids downloads, and the probe reports the host API surface) and v1.23.1 (four reported bugs fixed) — the profile crashed on a JMAP-shaped message sender, exporting downloaded nothing, the contact list did not refresh after an import, and the side pane was too short; on top of retention — the untouched contacts by age bucket, with an export that is written as part of any delete (#21, v1.23.0); on top of exporting the selection or the shown list as vCard or CSV, with the round trip asserted (#19, export half, v1.22.0); on top of importing contacts from CSV or vCard, with column mapping, a preview, duplicate protection and remembered mappings (#19, import half, v1.21.0); on top of the plugin opening on a main page — headline state, a menu of the palette tasks and a row into every section (v1.20.0); on top of a Health sub-tab — per-contact and per-address-book scores, eleven named rules and one-click fixes (#16, v1.19.0); on top of avatars on the contact list and profile — a contact's own photo, or Gravatar behind a new off-by-default setting (#15, avatar half, v1.18.0); on top of E.164 cleanup of a selection with a preview and an undo, region-aware phone matching and editor warnings (#17, v1.17.0), smart search with operators and saved searches with live counts, the page half of #13 (v1.16.0), bulk edit (tags and address books) and vCard export for a selection, completing #14 (v1.15.0), the capability probe and a precise unavailable notice (v1.14.1), multi-select bulk merge and delete plus the fixed search box (v1.14.0), the plugin-owned two-pane page skeleton (v1.13.2), the two bugs fixed in v1.13.1 (the *Contacts* sub-tab crashed when an optional API was missing, and new/edited projects were never written to storage), project time, expenses, billable totals and JSON export/import (v1.13.0), one app page with sub-tabs (v1.12.0), local projects (v1.11.0), file downloads (v1.10.0), company profiles (v1.9.0), activity tracking (v1.8.0), the Contacts page (v1.7.0), the contact editor (v1.6.0), nickname preservation (v1.5.0), the save-time warning (v1.4.0) and merge undo (v1.3.0)
- **Released**: `contact-manager-v1.23.2` is the newest GitHub release (v1.23.1,
  v1.23.0,
  v1.22.0,
  v1.21.0,
  v1.20.0,
  v1.19.0,
  v1.18.0,
  v1.17.0,
  v1.16.0,
  v1.15.0,
  v1.14.1, v1.14.0, v1.13.2, v1.13.1, v1.13.0, v1.12.0, v1.11.1, v1.11.0, v1.10.0, v1.9.0,
  v1.8.0, v1.7.0, v1.6.0 and v1.5.0 before it). `main` and `contact-manager` are
  in step (PRs #52, #53, #55, #56, #59, #62, #63, #64, #65, #66, #67, #69, #70,
  #71, #72, #73, #76, #78, #80, #81, #83, #85, #87, #89, #91, #93, #95, #97, #98, #99
  and #101 merged). **v1.25.0 is prepared on `feat/contact-manager-server-spike`**
  and still needs its PR, the merge, the mirror sync and `npm run release`. **v1.24.0 is prepared on `feat/contact-manager-search-exclusion`** and
  still needs its PR, the merge, the mirror sync and `npm run release` — then a
  handoff commit saying it is released.
- **Files modified in 1.4.0**:
  - `src/lib/watch.js` - new: `isSameCard`, `findDuplicatesOf`, `warnAboutDuplicates`
  - `src/index.js` - hooks `onAfterContactCreate` / `onAfterContactUpdate`
  - `manifest.json` - `warnOnSave` setting, `watch.toast` string in `en` and `de`, version bumped
- **Files added in 1.3.0**:
  - `src/lib/undo.js` - new: the undo records, their retention policy and `undoLastMerge`
  - `test/undo.test.mjs` - the undo tests

## Implementation Summary

### The webmail is JMAP-shaped, and two bugs came from forgetting it (v1.23.1)

A message’s `from`, `to` and `cc` arrive as an **array** of `{ name, email }`, not
as one object — `eventsForContact` already handled that for calendar
participants, but the profile did not for mail. Two consequences, both reported
from a live install:

- **A crash.** `message.from?.email ?? message.from` fell through to the array
  and React refused to render it: *“Objects are not valid as a React child
  (found: object with keys {name, email})”*.
- **Silent nothing.** `timelineForContact` matched on `message.from.email`, which
  is `undefined` for an array, so a message was only ever found by its `to` or
  its subject. “Recent messages” looked empty for contacts you had mail from.

`addressList` and `addressLabel` in `contacts.js` read every shape the host uses
— the array, a single entry, `{ address }`, a bare string — and the tests pin all
of them plus “never returns an object”. **Treat every address-ish field as a
list.**

Two more, from the same report:

- **Downloads were cancelled by the plugin itself.** `downloadBlob` revoked the
  object URL on the same turn as the click; the browser had not read the blob
  yet. It revokes on the next turn now. This affected the contact export, the
  project export and the profile’s attachments.
- **The list did not refresh after an import.** Sub-tabs mount once and stay
  mounted by design, so the Contacts tab kept its first read of the address book.
  The app page now owns a `revision` counter and every sub-page reloads when it
  moves; a ref stops a page that mounts late from reading everything twice.

**The capability probe was too shallow**, and that is worth remembering: it
checked that a namespace and its methods *exist*, but a present method can still
refuse a call — which is what a missing permission looks like from inside a
plugin. `activate()` now makes one cheap read per optional namespace and logs the
reason (`optional API calls failed — calendar: …`). On this instance the
existence probe was silent while the profile said *“Unavailable: Meetings”*, which
is exactly that gap.

### Retention, and an export that cannot be skipped (v1.23.0) — #21

The Health dashboard gained a *Retention* section: three age buckets (a year, two,
three), each a filter, with the stale contacts oldest first and their age.

**#21 asks for two things that shaped the design.** "Never auto-delete; require
explicit confirmation **and an export**" is implemented literally: *Export and
delete* writes the CSV **as part of** the delete, so a retention clean-up can
never be the only copy of what it removed. Removing that step fails its test. The
delete is also behind a confirmation and leaves an undo record, so it is
recoverable twice over.

**"Explain their data source" is in the UI**, not just the docs: the section says
it works from the server's own last-updated date, and that a contact the server
never stamped is **not** counted. Reporting a contact as untouched on no evidence
would be worse than staying quiet.

**CSV is the archive format**, because it carries every field including the ones
vCard has no place for — "bulk archive or export preserves all fields" is
asserted by the v1.22.0 round-trip fixture rather than by a new claim.

**A bug the tests caught:** the buckets started at a year while the list below
them filtered at two, so the two could disagree about who was stale. The list now
uses the lowest band, and a test pins it.

### Exporting, and a bug the round trip found (v1.22.0) — #19, export half

`csv.js` gained a writer, `export.js` the column layout, and `export-dialog.js`
the two questions (*what* and *in which format*). The entry point moved to the
Contacts page **header**, because the selection-bar button could not reach
"everything the search shows" — a scope with no way to ask for it.

**The round-trip fixture immediately found a bug: vCard export dropped the
tags.** `CATEGORIES` was never written, so a contact's tags survived a CSV round
trip but not a vCard one. That is precisely what the fixture is for, and it is
now asserted for both formats — export, re-import through the wizard's own
pipeline, compare field by field.

**The CSV headers are the spellings `guessMapping` recognises**, so a file
exported here and imported back needs no column work at all. A test says so
rather than trusting the two lists to stay in step.

**One limit the tests are honest about:** a contact that only ever had a full
name comes back with the name intact but its parts guessed, because a single
column cannot say where the boundary was. The name is what is asserted.

### Importing a file, without importing its duplicates (v1.21.0) — #19, import half

`csv.js` (RFC 4180 as a character scanner, not a `split`), `vcard-parse.js`
(3.0 and 4.0, folded lines, grouped properties), `import-fields.js` (the field
catalogue and the header guesses), `import.js` (rows → drafts → cards, the
duplicate plan) and `import-dialog.js` (the wizard).

**The duplicate check is the reason the import goes through a plan.** A CSV from
another service is exactly where the same person arrives twice, and the plugin
already knows how to tell — `planImport` matches on the **same keys detection
uses**, so an import cannot create what the rest of the plugin spends its time
finding. Disabling that check fails six tests.

**Cards are built by the editor's own `cardFromDraft`**, so an imported contact
is shaped exactly like a hand-created one — one place decides what a card looks
like, and a change there reaches both paths.

**Two mapping bugs the tests caught against real Google headers**, both from the
"longest hint wins" rule:

- `Organization 1 - Title` mapped to the *organisation*, because `organization`
  is a longer substring than `title`. The composite hint
  `organization1title` now beats it.
- `Group Membership` mapped to nothing, because the hint was `groups` and the
  header says `group`. It is `groupmembership` now.

**Deliberately not imported, rather than imported badly:** photos and URLs (the
card builder writes neither `media` nor `onlineServices`), custom fields (#11),
and any encoding other than UTF-8. A `Website` column is offered as *Ignore*,
which is visible in the wizard rather than silent.

### A main page, and actions that had to move to exist (v1.20.0)

The plugin used to open on *Duplicates*. It opens on *Overview* now: the duplicate
headline, a **menu** of tasks, and a row into each of the four sections with its
headline number and state badge.

**The interesting part was a frame boundary.** The menu needed to run the same
tasks as the command palette, and it could not: the palette actions were
implemented inside `index.js`, which is the host's **background frame**, while a
page runs in its **own frame**. So the implementations moved to
`src/lib/actions.js`, which both import, and `index.js` keeps only the wiring.
A second copy of the same logic on the page would have been the thing that
drifts — and `test/ui-home.test.mjs` pins that the menu and the palette call the
same function by breaking the shared one and watching both fail.

**Navigation is still open.** The user was explicit that they are not sure yet:
the sub-tabs stay, with *Overview* first. The main page is the part every
navigation idea needs, so it went first; a menu-over-dialogs or a sidebar is a
later decision, and the sidebar in particular needs kit components this plugin
has never used.

**One load, four numbers.** The main page derives the duplicate groups, the
contact count, the project count and the health summary from a single
`loadCards`, rather than each section paying for its own read. That is the same
work the Duplicates tab does when you press its scan button.

### A Health dashboard, and a reader that hid the bug it looks for (v1.19.0) — #16

A fourth sub-tab: the average score over the address book, a per-address-book
breakdown worst-first, the totals for each rule, and a drill-down list worst
first. Every total is a filter, and every deduction is named — the score is
deductions from 100, so the list of issues *is* the explanation.

**A real bug the tests caught, in an existing reader.** `contactIssues` first
read addresses through `emailEntries`, which filters on "has an `@` and no
spaces" — so a **malformed** address was invisible to the check written to find
it. `rawEmailAddresses` in `contacts.js` now returns every address as written
(untrimmed, so the rules can also tell `Ada@Example.ORG` from
`  Ada@Example.ORG `). The phone side had no equivalent gap: `phoneEntries` only
drops empties.

**The fixes reuse machinery that is already reversible**, rather than inventing
a second kind of change: `cleanup` issues open the normalisation dialog
(preview, then undo) and `duplicate` issues open the review dialog (preview,
then undo). Everything else opens the editor. That is what makes #16's "fixes
are previewable and reversible" true without new safety work.

**The band cutoffs live in `BANDS` and nowhere else.** The page's per-book badge
originally recomputed `>= 80 / >= 50` inline; it calls `healthBand` now, so the
dashboard and the rules cannot drift apart.

A duplicate is expressed two ways on purpose: `duplicates` (a Set of ids) for the
dashboard, which has the whole picture, and `duplicate: true` for a single
contact, which is what the profile has. Both are tested.

### Avatars, and a picture that will not load (v1.18.0) — #15, the avatar half

A contact's own photo (`media`) is shown when it has one — server-stored, no
third-party request. Otherwise Gravatar, **only when the user turns it on**,
because Gravatar identifies a person by a hash of their address.

Two decisions worth keeping:

- **MD5 is implemented here** (`avatar.js`). `crypto.subtle` has no MD5, and
  using it for SHA-256 would be a platform dependency the sandbox does not
  promise — the mistake #75 is about. It is checked against the published
  vectors, including the canonical Gravatar example (`myemailaddress@example.com`
  → `0bc83cb571cd1c50ba6f3e8a78ef1346`), and against node's `crypto` for the
  multi-byte and multi-block cases.
- **A failed image is not an error state.** A blocked request, an offline
  browser and "no picture" are indistinguishable from inside the plugin, so the
  element hides itself on `onError` and all three end as nothing. `d=404` makes
  "no picture" the same code path rather than a placeholder silhouette, and
  `loading="lazy"` keeps a long address book from firing one request per row on
  open.

**Not verified from here:** whether the sandbox's content policy allows the
request. If it does not, avatars are absent and nothing else changes. The
instance this was built for already runs a `gravatar` plugin with
`default=404, cached=358`, which suggests the host does allow it.

**Still open on #15:** universal contact hover cards. They need host surface the
plugin does not have, so the issue stays open.

### E.164 cleanup, and phone matching that works (v1.17.0) — #17

`phones.js` normalises to E.164 and `normalise.js` plans, applies and reverses a
batch. Three rules exist to stop a **wrong** value being written onto a contact:

- **No country, no national normalisation.** `0176…` cannot become E.164 without
  knowing the country, so it is left alone rather than guessed at.
- **An ambiguous number is refused.** German `0491…` (Leer) and `+49 491…` both
  exist, so a national number that already starts with the dial code is left
  alone instead of being double-prefixed.
- **A refusal is never recorded as a change.** A contact the host declines is
  counted in `failed` and left out of the undo record, so undoing can never
  revert something that never happened.

The real payoff is **detection**, not tidying: `normalizePhone(number, region)`
now returns the E.164 digits, so `0176 1234567` and `+49 176 1234567` finally
produce the same key and group as one contact. Without a region the old
digits-only behaviour stands, so nothing changes for an existing install.
Because the region is needed in four places (`index.js`, `manager-page.js`,
`detail-section.js`, `watch.js`), they all go through one async helper,
`detectionOptions(api)` in `contacts.js` — four call sites that each remembered
to read the region would eventually be three.

**Where the region lives is a deliberate choice.** It is *not* a manifest
setting: `settingsSchema` in this plugin only uses boolean and number fields,
and inventing a string type would be assuming host behaviour — the mistake #75
is about. It sits in `api.storage`, set from the cleanup dialog, and
`region.js` holds it so both `contacts.js` and `normalise.js` can read it
without an import cycle.

A bug the tests caught: `planCard` first compared the *trimmed* value against
the normalised one, so a number that differed only by surrounding spaces was
never seen as a change — which is exactly what trimming is for. It compares the
stored value now, and a test pins it.

### A flaky budget test, caught by a failed release (v1.17.0)

The first attempt to release v1.17.0 **failed its own test run**: the 10k-contact
budget test in `test/search.test.mjs` measured 103 ms against its 100 ms bound.
It was not a regression. Vitest runs the files in parallel, and the single
measurement was picking up scheduler noise — the same test measures ~30 ms when
it runs alone, and a 4x genuine slowdown fails it at ~172 ms.

It now takes the **best of three** after a warm-up: noise only ever makes a run
slower, so the minimum is closest to the real cost, while a real regression
raises every run. Ten consecutive full-suite runs pass; before the change, one
of eight failed.

Worth knowing for next time: `npm run ship` merges the pull request **before** it
runs the release, so a failed release leaves `main` merged but untagged — the fix
is to re-run `npm run release` once the cause is dealt with.

### Smart search and saved searches (v1.16.0) — the page half of #13

The *Contacts* box went from a `includes()` filter to a small query language in
`src/lib/search.js` (pure, so all of it is unit-testable):

`name:` `email:` `phone:` `company:` `note:` `tag:` `book:` `has:` `is:`, plus
free text over name, nickname, email, phone, company, note, tag and
address-book name. Three details that only showed up while testing:

- `company:` has to match **a company record's own name**, not just
  `organizations` — a company card has no `organizations` entry, so
  `company:acme` missed *Acme Ltd* until `companyTerms` included it.
- `book:` takes an **id as well as a name**: the card only stores ids and the
  page only knows names, so both are indexed.
- `phone:` compares digits with leading zeros dropped, so a number typed in
  local format (`0176…`) still finds the stored international one.

Matching is strict — every term must match — except for a **subsequence fallback
on names, from three characters up**, which is what makes `grce` find *Grace
Hopper*. Below three characters a subsequence would match half the address book.

**Performance drove the shape of the module.** The issue asks for under 100 ms
on 10k contacts, but the page also needs a *count per saved search*, and running
`searchCards` once per chip would re-read every card each time. So
`buildIndex(cards, { books })` derives the searchable strings **once** and
`matchIndexed` / `countsForIndex` reuse it: N saved searches cost N cheap passes
over pre-built strings. Measured **~30 ms** for 10k contacts, asserted by a test.

An unknown operator is reported **and** kept as a free-text term, so a typo
returns something and the line under the box says what was wrong. The saved
searches (`saved-searches.js`, key `savedSearches`, cap 20) are **named by their
own query** — `tag:vip · 3` — deliberately: the plugin has no verified prompt
API, and inventing one is the mistake #75 is about.

**Still open on #13:** the command-palette entry point. There is no verified host
API for the palette to switch the page to a query (cross-frame messaging or page
navigation), so it is not implemented rather than guessed at.

### Bulk edit and vCard export (v1.15.0) — completes #14

The selection bar gained *Edit selected* and *Export* beside the merge and
delete actions from v1.14.0.

**Tags and address books are map fields the host replaces wholesale**, which
drives the whole design. `applyBulkEdit(api, cards, { tags, books })` computes
one patch per contact containing the **complete** new `keywords` and
`addressBookIds` maps — sending only the added entries would silently drop every
other tag and book membership. Two rules are enforced in the module rather than
left to the dialog:

- the `company` keyword is **never** removed by a tag edit. It is what marks a
  contact as an organisation (`isCompany`, company profiles, `companyLine`), not
  a label the user chose;
- a card that would be left in **no** address book is **refused**, and counted in
  `failed`. That is the same guard the editor applies when it declines to write
  an empty book set.

Tags and books go out in **one update per contact**, so `{ updated, skipped,
failed }` counts contacts, not calls. `skipped` means "nothing would change" and
is deliberately distinct from `failed`.

The dialog (`bulk-dialog.js`) only *collects* the change; the writing lives in
`bulk.js`, so those rules have one home. It offers add-tags, remove-tags, a book
action (add to / remove from) and a checkbox per book.

**Export** writes the selection as one `.vcf` of vCard **3.0** — the version
address books, phones and desktop clients import without complaint, and nothing
here needs a 4.0-only feature. `vcard.js` escapes RFC 2426 TEXT values, and
escapes structured `N` and `ADR` **per component**, because escaping the joined
string would escape the `;` separators and destroy the structure. The
single-value JSContact readers moved from `profile-page.js` into `contacts.js`
so the profile and the export cannot drift.

### The optional-API contract is not what the docs said (v1.14.1)

Reported from the running webmail: `api2.email.search is not a function`, on the
**latest** host version. That rules out "the host is too old" — the plugin's
documented host contract simply does not describe the API a current install
exposes. `api.email` is present, so it is not a permission-less namespace being
absent; it is there with no `search` method.

Two consequences, both handled:

- **The notice was guessing.** It said *"Messages, meetings and tasks are
  unavailable — the plugin may be missing the email, calendar or tasks
  permission"* whether one API failed or all three, which blames permissions the
  user may well have granted. `context.degraded` is now the list of pieces that
  actually came back null, and the notice names only those.
- **The plugin cannot introspect the host**, so `src/lib/capabilities.js` probes
  what is really there — `detectCapabilities(api)` returns
  `{ present, keys, missing }` per optional namespace, and `activate()` logs one
  line when something is missing:

  ```
  optional APIs unavailable (email, calendar) — host exposes email: query, send | tasks: create, list | calendar: absent
  ```

  `keys` is the payload: the method names the host *does* use are what tells a
  renamed method from a missing one. Silent when nothing is missing.

**Open:** the real names are unknown until that line is read from a live
install. Do **not** add speculative method-name fallbacks — correct the names in
`WANTED_METHODS` and the call sites once the probe reports them. If the host has
no mail API at all, the profile's messages, files, meetings and tasks sections
are dead weight and should be reconsidered rather than kept as permanently
degraded.

### Bulk actions on a selection (v1.14.0)

The *Contacts* list gained a checkbox per row and a bar that appears once
something is selected: the count, *Merge selected*, *Delete selected* and
*Clear selection*. A contact that disappears — deleted, or filtered out — drops
out of the selection rather than lingering.

The two actions take deliberately different routes, because they carry
different risk:

- **Merge** does not get its own code. `groupFromSelection(cards)` in
  `duplicates.js` wraps the selection in a group with `strength: 'manual'`
  (no evidence is claimed: the plugin matched nothing, the user chose) and the
  page hands it to `api.ui.openDialog({ slot: 'plugin-dialog' })` exactly as a
  detected group is handed over. The keep selector, field-by-field conflict
  resolution, danger confirm and undo therefore all apply unchanged, and the
  dialog shows *Selected by you* rather than *Certain*/*Possible match*.
  `strengthKey` in `labels.js` learned the third value for this.
- **Delete** has no plan to review, so `src/lib/bulk.js` does it: one confirm
  naming the contacts, then `api.contacts.remove` per card, then a **single undo
  batch** holding everything that was removed. A card the host refuses to delete
  is counted in `failed` and reported, never silently skipped. `undoLastMerge`
  needed one fix for this: a delete-only entry has no kept contact, so
  `keptId` is empty and the entry must not be counted as a "reverted kept
  contact" in the toast.

This is the deletion half of #14; bulk tag/address-book edits and bulk export
stay open.

### The search box stays put (v1.14.0)

`sidePane` made the *pane* scroll, and the search box lived inside it, so
scrolling the address book carried the box out of view. The pane is now a
`flex-direction: column` with the box above and a new `SCROLL_AREA` beneath it,
and only the scroll area scrolls. The pane keeps its bounded height, so a long
list still cannot stretch the page.

### The page skeleton is plugin-owned (v1.13.2)

The *Contacts* page built its list-beside-profile layout out of the kit's
`Row`/`Stack` and sized the panes with `style={{ flex: '0 0 320px' }}`. On a
real host that collapsed into one column: the contact list ran the full width
of the page, grew without bound, and pushed the profile (details, duplicate
check, meetings, files, messages, tasks) off the bottom.

Two assumptions were doing the work, and neither is checkable from this repo:
that `Row` lays its children out horizontally, and that `Stack`/`Row` forward
an inline `style` prop to the DOM node. The unit-test stand-in *drops* `style`
entirely, which is why 220+ green tests never saw it — the third bug in a row
to hide in that gap, after the optional-API crash and the unsaved projects.

`src/lib/layout.js` now holds the skeleton as plain data — `SPLIT` (a wrapping
flex row), `sidePane(basis)` (fixed basis, `overflowY: auto`, bounded height so
a long list scrolls in place), `CONTENT_PANE` (shrinks, stacks its sections) and
`HIDDEN` — and the pages draw it with plain elements. `data-pane` markers
(`split`, `list`, `detail`) give the layout tests something stable to assert on.

The kit still draws every piece of *content* inside the panes, so the page keeps
looking like part of the app. `Row`/`Stack` remain in use for the actions row, a
card's inner stack and the dialog footer — this is layout only, not a fork.

The *Projects* page used the identical pattern and is fixed the same way, and
its import `<input type="file">` is now hidden by a wrapper element instead of
an inline `style` prop on the kit's `Input` (which, if dropped, would surface a
raw file control in the toolbar).

### Optional host calls and project persistence (v1.13.1)

Two reported bugs, both about code that only ran in the real host:

- **The Contacts sub-tab crashed.** `profile-page.js` read `api.email`,
  `api.tasks` and `api.calendar` and only handled a *rejected* promise with
  `.catch(() => null)`. A namespace the host does not expose throws
  **synchronously** when read (and a method that returns nothing is not a
  promise), so the throw escaped the catch and, inside the React effect, took
  the whole sub-tab down. `src/lib/optional.js` now holds `optionalCall(run)`,
  which always resolves — the value, or `null` when the namespace, the method
  or the promise is missing. `profile-page.js` and `projects-page.js` use it;
  `degraded` is then set and the profile shows the unavailable notice. This is
  a hard rule in the README now: never call an optional host API directly.
- **New and edited projects were never saved.** `project-dialog.js` collected
  the draft and returned `{ saved, project }`, and `openProject` passed that
  straight back to `toastProjectResult` — nothing wrote it. `openProject` is
  the single funnel (page header, empty state and the command palette), so it
  now calls `saveProject` itself, reports a storage failure with the new
  `projects.saveFailed` string and returns `null` so a failed write is never
  toasted as “Project created.”.
- **The UI-kit guard the stand-in promised now exists.**
  `test-utils/ui-kit.mjs` says a `ui-kit.test.mjs` checks it against the real
  kit, but no such file was ever committed. `test/ui-kit.test.mjs` now fails
  when the source imports a `@plugin-host/ui` name the stand-in does not
  export — an undefined component is the other way a sub-tab dies on open
  (“Element type is invalid”). It cannot see the real kit (that lives in the
  webmail repo), so it guards source-vs-stand-in drift; keep the stand-in in
  step with the host.

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
- `gravatar` - show Gravatar avatars, **off by default**: it sends a hash of the contact's address to gravatar.com (v1.18.0)

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
files, company rollup), v1.9.0 company profiles, v1.10.0 file downloads,
v1.11.0 local projects, v1.12.0 one tab with sub-tabs, v1.13.0 project
time/expenses and export, v1.13.1 optional-call crash and project saving fixes,
v1.13.2 the plugin-owned two-pane page skeleton, v1.14.0 bulk merge and delete
on a hand-picked selection plus the fixed search box, v1.14.1 the capability
probe and precise unavailable notice, v1.15.0 bulk tag/book edits and vCard
export for a selection, v1.16.0 smart search and saved searches, v1.17.0 E.164
cleanup with preview and undo, v1.18.0 avatars, v1.19.0 the Health dashboard, v1.20.0 the main page, v1.21.0 CSV/vCard import, v1.22.0 CSV/vCard export, v1.23.0 retention.

**Next: the v1.3.0 milestone.** The #54 CRM direction now has companies (#22,
v1.9.0), files (#58, v1.10.0) and projects (#57, v1.11.0 — milestones are real
tasks; time and expense entries are still open). What is left on the near
roadmap is the rest of the v1.3.0 milestone: #13 (smart search and saved
searches — the operators and saved searches shipped in v1.16.0, the command
palette half is still open), #12 (contact groups) and #15 (avatars) — #14 (bulk
actions) is done as of v1.15.0. #11
(custom fields) needs a host change and stays parked; deals/pipeline stay out
of scope.

## GitHub Integration
- Repository: **zyntrax/bulwark-plugins** (private). The plugin lives in
  `contact-manager/`; there is no separate `bulwark-addons` repository.
- **Branches**: `main` is the release branch and carries the current version.
  `contact-manager` mirrors the plugin work and is kept in step with `main`.
  Feature branches are `feat/contact-manager-<feature>` and are merged into
  `main` through a PR. **Only `main` and `contact-manager` are long-lived** —
  a feature branch is deleted once its PR has landed, so the branch list stays
  short. Deleting one loses nothing: its commits are in `main` through the
  merge, and the PR keeps the discussion.
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