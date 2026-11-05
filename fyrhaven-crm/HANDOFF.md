# Handoff — Fyrhaven CRM

> The authoritative record of where this plugin stands and why. It lives in the
> repository at `fyrhaven-crm/HANDOFF.md` and is published on GitHub on the
> branches `main` and `contact-manager` (identical content on both). The rules
> for changing the code are in [`.clinerules`](../.clinerules).

## Current State
- **Version**: 1.55.0 (`manifest.json` is the single source of truth; `package.json` matches)
- **Last changes**: **renamed to Fyrhaven CRM** (display name, docs, GitHub) — the plugin id, storage keys and ZIP names are unchanged, so an existing install updates in place; the id/tag/folder rename is a separate mechanical change. Before that: the server settings ask **which** server (#147) — *Dedicated server* opens with two ways in: **Cloud** (fixed address, a *Sign in* button, the token from the website) or **my own server** (type the address); the choice is remembered, a cloud sign-in can never be sent to a stale address, and `GET /v1/account` is asked afterwards so a lapsed plan says so instead of failing at the first save. On top of 1.53.0 — a project says where it lives.
- **Cloud store deployed (2026-11-04)**: the service in
  `fyrhaven-server/` now runs on the maintainer's mail host as the compose
  project **`contact-manager-store`** — image built from this repository, on the
  host's existing `opt_default` network, **no published port**, a named volume
  (`contact-manager-store_store-data`), `restart: unless-stopped` and the image's
  own healthcheck (which reports *healthy*). It lives at
  **`/opt/stacks/09-contact-manager-store`** (its own `.env`, mode 600) and is
  deployed from there, so the folder and the running container are the same
  thing — `docker compose up -d --build` in it is the rebuild path, and its
  README carries the backup command and the Portainer adoption steps. It was
  added beside the running stacks without stopping or restarting any of them.
  Verified from another container on that network: `/version` answers, a
  `PUT`/`GET`/list/`DELETE` round trip works, no token and a wrong token are both
  `401`, and a marker written through the API does **not** appear in the SQLite
  file in cleartext.
  **It is live on `https://crm.mailz.se`** (CNAME → host, nginx-proxy-manager
  proxy host → `contact-manager-store:8080`, forced SSL): the certificate
  verifies, `http://` answers `301` to `https://`, `/v1/store` without a token is
  `401`, and a container on the webmail's own network reaches that HTTPS address
  — which is the path `api.proxy.fetch` takes. **Not on the Portainer Stacks
  page**: its API needs an admin token, so it is a compose project the CLI owns;
  the folder's README lists the two steps (bring it down, paste the image-only
  definition) that hand it over.
- **fyrhaven.com bought (2026-11-04)**: three DNS records created through the Cloudflare API, all **DNS-only** so nginx-proxy-manager keeps terminating TLS — `CNAME @ -> mailz.se` (Cloudflare flattens the apex), `CNAME crm -> mailz.se`, `CNAME www -> fyrhaven.com`, all DNS-only. **mailz.se tracks the dynamic IP**, so the new names follow it by CNAME instead of pinning an address — a new ISP address needs no DNS change. All three resolve to the host. **HTTPS does not answer yet** and cannot from here: NPM needs a proxy host and a certificate per name (it is the only thing holding ports 80/443). **Done (2026-11-05):** NPM serves `fyrhaven.com`, `www.fyrhaven.com` and `crm.fyrhaven.com` with a valid certificate (all three answer `200` over TLS), the store runs with `PUBLIC_URL=https://fyrhaven.com`, and **1.59.0** points `CLOUD_ORIGIN` at `https://crm.fyrhaven.com`. `crm.mailz.se` still answers as an alias, so an install that connected earlier keeps working. The Cloudflare token used for this is in the chat log and **should be rotated** (scope `Zone:DNS:Edit`, one zone).
- **Cloud store 1.1.0 (2026-11-04)**: accounts, sessions and the signup site (#148) — `accounts.js` adds `POST /v1/accounts`, `POST /v1/sessions`, `GET /v1/account` (plan, expiry, usage), `POST /v1/account/order` (202, pending) and `DELETE /v1/account`; passwords are scrypt hashes, a session is a random token stored **hashed**, a lapsed plan can still read but every write is `402`, and 240 req/min plus 5 000 records / 64 MiB per workspace are enforced. The site (`site/`) is served by the same container, so there is no second service. A `STORE_TOKENS` entry stays an installer token — unlimited, never expiring, unchanged. Deployed and verified live on `https://crm.mailz.se` (signup → write → `/v1/account` → delete → `401`). Not wired: email verification (no SMTP); payment is an invoice or webhook that calls `setPlan`. Server tests 35 (was 21).
- **Cloud store 1.2.0 (2026-11-04)**: payments and the operator panel (#148). `payments.js` asks Stripe for a Checkout Session over plain `fetch` and verifies its webhook with `node:crypto` (constant time, five-minute window) — no SDK, no lockfile, card never touches the service; with no key the store takes no money and an order stays pending. `/admin` is guarded by `STORE_ADMIN_TOKEN` (503 until it is set) and settles orders, sets plans, deletes accounts. The webhook reads the account and order from metadata the service wrote, never from a body a customer can edit. Live on `https://crm.mailz.se` (`/admin` 200, admin API 401 without the token, 503 when no token is configured). Server tests 44 (was 35). `docker-compose*.yml` pass the new variables through and pin `name: contact-manager-store`, so the volume keeps its identity.
- **Released**: `fyrhaven-crm-v1.53.0` is the newest GitHub release; v1.52.0, v1.51.0,
  v1.50.5,
  v1.50.4, v1.50.3, v1.50.2, v1.50.1 and v1.50.0 were cut from `main` before it,
  and every release from v1.5.0 up has a tag and a ZIP. `main` and `contact-manager` are
  in step (PRs #52, #53, #55, #56, #59, #62, #63, #64, #65, #66, #67, #69, #70,
  #71, #72, #73, #76, #78, #80, #81, #83, #85, #87, #89, #91, #93, #95, #97, #98, #99,
  #101, #102, #103, #104, #106, #107, #108, #110, #112, #114, #115, #116, #117,
  #118, #119, #120, #121, #122, #123, #125, #127, #130, #132, #134, #136, #137,
  #138, #139, #140, #141, #142, #143 and #144
  merged, plus the handoff PRs #131, #133 and #135). Every
  stacked PR was retargeted to `main`, merged and released **one at a time** —
  v1.30.0 through v1.39.0 each have a tag and a ZIP. **v1.40.0 (#23, the advisory
  half), v1.41.0 (#39, the onboarding half), v1.42.0 (#39, the scale half),
  v1.43.0 (#13, the palette half), v1.44.0 (#39's help + shortcuts) and v1.45.0
  (#36's task-creation half) landed together in `fyrhaven-crm-v1.45.0` (PR
  #132, cut with `npm run ship`), **v1.46.0 (#38, the private half) in
  `fyrhaven-crm-v1.46.0`** (PR #134, cut the same way), and **v1.47.0 (#36's
  cross-contact half, plus the #68 storage seam and the cloud store) in
  `fyrhaven-crm-v1.47.0`** (PR #136). **Nothing is waiting to be released.**
- **Test double**: `test-utils/fake-api.mjs` can now declare a host **shape** —
  `fakeApi({ host: { absent: [...], exposes: { email: ['query', 'send'] } } })` —
  so "the method was renamed" and "the namespace is gone" are expressible in a
  test instead of invisible to it. The permissive default is unchanged and now
  documented as deliberate. **No version bump**: `test-utils/` is not shipped, so
  the bundle is identical to v1.29.0 and there is nothing to release.
- **Files modified in 1.4.0**:
  - `src/lib/watch.js` - new: `isSameCard`, `findDuplicatesOf`, `warnAboutDuplicates`
  - `src/index.js` - hooks `onAfterContactCreate` / `onAfterContactUpdate`
  - `manifest.json` - `warnOnSave` setting, `watch.toast` string in `en` and `de`, version bumped
- **Files added in 1.3.0**:
  - `src/lib/undo.js` - new: the undo records, their retention policy and `undoLastMerge`
  - `test/undo.test.mjs` - the undo tests

## Implementation Summary

### Where a project lives, and who can see it (v1.53.0) — #68

The plugin had two servers a record could live on and did not say which one it
used: `recordBackend` picked whichever answered first, so a project looked
identical whether it was private to the user (their own Files drive) or shared
with everyone in the workspace (the Contact Manager server). The user asked for
the difference to be explicit and chosen, and that is what this release does.

**The target is on the record.** `storage: 'personal' | 'cloud'`, defaulting to
`personal` — which is where every existing record actually is, so the migration
is a default rather than a rewrite. The dialog offers the choice only when both
servers are configured, and states the one home when there is only one.

**The seam pins a target and refuses to substitute.** `readAs`/`writeAs`/
`removeAs` take the target and report `unavailable` when that backend is not
there — no silent fall back. This is the property the feature rests on: a project
the user made private must not become shared because Files was switched off, and
a shared one must not leak onto a drive.

**Reads merge, writes split.** `readProjects` reads both servers and tags each
record; `writeProjects` rewrites both halves, so a move leaves the old half
behind. Two writes per save is the price of never having a project in two places.

The badge (*Only you* / *Shared*) is what per-project access control will hang
off: the next step is identities on the store, then a per-project ACL (read /
write / add time / create tasks), then the signup and ordering site in front of
the service.

Tests: 1209 passing (was 1197) — 5 for the seam (the target per backend, what is
available, a pinned write, no fall back either way, and a single-target remove), 4
for projects (cloud only, both merged, a move, and a legacy record reading as
personal) and 3 for the dialog (the choice, the single home, and a cloud project
falling back to personal when the cloud is not configured).

### Pointing the plugin at a server: the connect half of #68 (v1.52.0) — #68

`remote.js` had a client for the store and no way to configure it: the address was
**read** from storage and nothing ever **wrote** it, and the manifest declared no
credential, so `api.proxy.fetch` had no token to attach. Both gaps were silent —
the plugin reported `unconfigured` for ever while a working server sat on the
other end of it.

**The token never enters the bundle.** `manifest.json` declares
`credentials.store` (`scope: "user"`, `inject: bearer`), and *Connect* calls
`api.proxy.connect('store', { mode: 'password', server })` — the host's own
dialog, the host's own storage. The plugin learns `{ connected, origin,
credentialId }` and nothing else; `api.proxy.fetch` adds the header server-side.
That is the whole reason a paid tier can ship in a ZIP.

**Nothing is written until the host says `connected`.** The three failures a user
can meet — a closed dialog, a refused token, and a webmail with no
`api.proxy.connect` at all — get three different answers, and only a success
touches storage. A cancelled connect therefore cannot leave the plugin pointed at
a server it cannot authenticate to, which would have turned *every* record
feature into a failure at once.

**The dialog returns a choice; the funnel writes.** `server-dialog.js` returns
`{ connect: { url } }` or `{ disconnect: true }`; `openServer` in `actions.js`
performs it — the same split the review dialog, the editor and the import wizard
use. It matters more here than anywhere: `api.proxy.connect` *opens a dialog of
the host's own*, so a plugin dialog that drove it from inside itself would be
nesting host surfaces nobody promised work.

**A success asks `/version` immediately.** A wrong address or a refused token is
then reported in the same breath as the connection, instead of at the first
record the user tries to save.

The address is normalised once (`normalizeServerUrl`), so `crm.example.com`,
`https://crm.example.com/` and the value the dialog shows are the same string in
storage — a second normaliser is the thing that would drift.

Tests: 1197 passing (was 1181) — 7 for the client (the call the host receives,
a closed dialog writing nothing, a host without `connect`, a refused token with
its reason, the state the dialog is handed, disconnect surviving a host that
refuses, and the normaliser) and 9 for the dialog and funnel (the local-only
line, the choice it returns, connected state and disconnect, the no-connect case,
and the four funnel outcomes including the version check).

### Searching the private notes: the search half of #38 (v1.51.0) — #38

A private note could only be read from the contact it was written on, so the one
question a note is for — *"where did I write that?"* — had no answer. The search
box is that answer, and it now carries the notes: free text, `note:` and
`has:note` see a private note exactly where they see a note on the card.

**Where a note is kept is not the searcher's concern.** `indexEntry` merges
`card.notes` and the private record into one field, so `has:note` means "a note
about this contact" whether the host holds it or the seam does — and the same
free-text array matches, so one implementation serves both. The record arrives
as an **option** (`buildIndex(cards, { books, notes })`, shaped
`{ [contactId]: [{ text }] }`) rather than an import, so `search.js` stays pure:
no `api`, no DOM, and no dependency on the storage seam.

**This was its own piece of work because every counter has to agree.** A saved
search shows a count in the Contacts page *and* in the palette's Smart lists
dialog; if only one of them indexed the notes, the chip would claim two matches
and list one. Both now read the note record and pass it, and the unit test pins
`countsForIndex` against `searchCards` over the same record.

**One copy, so a saved note is searchable at once.** The page reads the record
once and hands it to the *Private notes* section as a controlled value (`notes` +
`onChange`) instead of letting the section read its own. The index is rebuilt
from the page's copy, so a note typed and saved is searchable in the same
session — the test drives exactly that: save, then search the new word.

**An unavailable store is not an error.** `readNotes` reports an unavailable
seam as "no notes" rather than throwing, and the page catches a failed read the
same way, so the box keeps searching the cards on an older host with no Files
storage and no cloud (#68's rule: degrade, do not break).

The `notes.hint` string was also corrected: it still said the notes were kept *in
this browser*, which stopped being true in 1.49.0 when they moved to the
customer's own server.

Tests: 1181 passing (was 1171) — 6 for the matcher (free text, `note:`,
`has:note`, no leakage between contacts, the counts, and the shapes it tolerates),
3 on the Contacts page (a note-only word filters the list, the negative twin when
the word is in no note, and a note searchable the moment it is saved) and 1 in the
palette (a `note:` saved search counts and lists the same contact). One latent
test bug was fixed on the way: a missing `});` had nested the `OR and grouping`
block inside the `not:` block, so those tests were reported under the wrong
describe.

### Follow-ups over every contact: the cross-contact half of #36 (v1.47.0) — #36

#36's last *done when* was *"overdue tasks are visible without opening each
contact"*, and it was the missing piece: the profile listed a contact's tasks,
but an overdue one was invisible until you happened to open that contact. The
Overview is the page that answers *what needs attention*, so the block belongs
there.

**The Overview is the second page to read the optional task API**, after the
profile, and it follows the same rule: `optionalCall(() => api.tasks.list({
includeCompleted: false }))`, so a host with no task list leaves the page readable
— and the block says so rather than vanishing silently. That is the #75 lesson:
a missing namespace throws *synchronously*, and a bare `.catch()` cannot catch it
inside a React effect.

**`taskSummary` is the split, `isDueSoon` is the window.** `taskSummary(tasks,
now)` returns `{ overdue, soon, later, total }` by folding `taskBuckets` and
filtering the rest — so the overdue bucket is decided in exactly one place and
the Overview cannot disagree with the profile about what is overdue. `isDueSoon`
measures its window in **local calendar days** (`new Date(y, m, d + days)`), not
milliseconds: `+7 * 24h` would drift an hour across a daylight-saving change and
could drop a task due on the boundary. An overdue task is never *also* due soon.

**Nothing to chase means no section.** A landing page should not carry an empty
"Follow-ups" heading, so the block returns `null` when there is no overdue and no
soon task; only a host *without* tasks gets a visible line, because that is
something the user should know rather than wonder about.

**`formatDate` moved into `labels.js`.** It was a private helper in the profile
page; the Overview needs the same thing, and two copies would eventually format a
date two ways. It also shows a value that is not a date as it is, rather than as
"Invalid Date".

Tests: 1128 passing (was 1114) — 8 for the model (`isDueSoon` at both ends of the
window, the month boundary, an overdue task, a custom window; `taskSummary`'s
three buckets and its total), 3 on the Overview (overdue first and badged with the
count of what can wait, nothing when there is nothing to chase, and the line when
the host has no task list) and 3 for `formatDate`.

### Private notes on a contact: the private half of #38 (v1.46.0) — #38

#38 asks for notes with visibility, mentions that notify, and search across
notes. The half that is buildable without the server tier is the **private** one.

**Private by construction, not by a visibility flag.** The host has no note
*record* per contact, and JSContact's `notes` field is a field **on the card** —
so everyone who can see the card can see it, and a private note cannot be a card
field. A note is therefore a record *about* the contact in `api.storage` (key
`contactNotes`), exactly like the consent records and the change history. Nothing
shared can show it because nothing shared can read it, which is a stronger answer
to "private notes never appear in shared views" than a flag would be — and the
section says so out loud rather than implying a flag enforces it.

**The store is bounded and repairs itself.** `normalizeNotes` keeps only real
contacts with real notes, de-duplicates by note id, drops a note with no id or no
text (corruption, not a note), and caps both the notes per contact
(`MAX_PER_CONTACT`) and the total (`MAX_NOTES`); `readNotes` rewrites when it
dropped junk and removes the key when nothing is left. `notesFor` sorts newest
first **without mutating the stored list** — the same trap the milestones had.

**Marks are rendered as elements, never as markup.** `parseInline` is a
deliberately tiny, documented subset — `**bold**`, `*italic*`/`_italic_`,
`` `code` ``, `@mention` — and returns *tokens*, so `notes-section.js` builds
`<strong>`, `<em>`, `<code>` and a badge. Nothing a note contains can become
markup and no parser dependency is needed. The rules are ordered so `**bold**`
wins over `*italic*`, and an unmatched mark stays literal: a stray `*` is shown,
not swallowed, while a matched pair *is* emphasis however it is spaced (that
distinction is pinned by a test).

**It is personal data, so the GDPR toolkit knows about it.** `buildSubjectExport`
takes `notes` and puts them in the bundle, and both `eraseSubject` and
`anonymiseSubject` call `eraseNotes` and report the count — an erasure that left
the notes behind would be a half-measure. The vCard/CSV subject exports stay
card-only, because a note is not a card field.

Tests: 1114 passing (was 1070) — 25 for the store (mentions, the two repairs and
their caps, the round trip, the newest-first order without mutation, the id and
the clock, save/delete per contact, and the erasure), 10 for the formatter (each
mark, the precedence, the unmatched cases, and the line split), 7 for the section
(empty state, add, the marks as elements, per-contact isolation, delete, the
failed save, and an empty box writing nothing) and 2 for the privacy export.

### Follow-up tasks per contact: the task-creation half of #36 (v1.45.0) — #36

#36 asks for a lightweight todo list attached to people. The half that is
buildable without new host features is *creating* one: the plugin already holds
`tasks:write` (it creates project-milestone tasks) and already lists a contact's
open tasks on the profile.

**A follow-up *is* a host task, not a record the plugin keeps.** `open-task.js`
calls `api.tasks.create` with the shape the milestone draft already uses —
`{ title, description, due }` — so the task shows in the webmail's own list,
survives a reload and is searchable there. Nothing is cached in `api.storage`,
which keeps the "no contact data in storage" line intact.

**The host task has no contact field, so the contact rides in the description** —
its email first, because `tasksForContact` matches a task by the words in its
title and description. That is also why the **priority is carried at the end of
the title** (`· High`): there is no priority field to set, and the title is the
one part every task list shows. The editor's own default title comes from a
translation key, so no user-visible English is hard-coded.

**The due date keeps the milestone rule** — omitted, never `''`, so the host
keeps "no due date" and "due today" apart. `isDate` accepts only `YYYY-MM-DD`.

**Overdue is local and conservative.** `todayIso` is the user's **own** calendar
day, never UTC (which can be a day off); `isOverdue` is a due date strictly before
it, and a task with no due date is never overdue. `taskBuckets` splits a contact's
tasks into the overdue ones and the rest, each in due-date order with undated last
— and it copies before sorting, so the caller's array is untouched. The profile
badges the overdue ones and lists them first; the tasks come from `api.tasks.list`
through `optionalCall`, so a host without tasks keeps the existing "unavailable"
note rather than breaking the page.

**A failing create is reported, never toasted as a success**, and the `api.tasks`
access sits *inside* the `try`, so a host with no tasks namespace fails there
rather than at the call site — the #75 lesson applied.

Tests: 1070 passing (was 1044) — 15 for the model (the date shape, the local
`todayIso`, the description lines, the payload with and without a due date,
validity, overdue, and the bucket order) and 8 for the editor (the prefilled
title, the priority suffix, the due-date rule both ways, the notes, the empty-title
error, and cancel) plus 3 on the Contacts page driving the whole funnel (create
and reload, a refused create, and the overdue badge and order).

### In-app help and keyboard shortcuts (v1.44.0) — #39

#39's third bullet: *in-app help, changelog and keyboard shortcuts*. The search
operators are the least discoverable part of the plugin, so the cheatsheet is the
point of the dialog.

**The cheatsheet cannot drift.** `help.js` derives the operator list from
`search.js`'s own `FIELDS`, and the `has:` / `is:` values straight from
`HAS_FLAGS` / `IS_VALUES` — a new operator appears in the help without anyone
remembering to add it. And every worked example is asserted in
`test/help.test.mjs` to parse **without an error**, so a help line can never
describe syntax the box rejects. That is the whole reason the model is a module
rather than a blob of markup in the dialog.

**The shortcuts are scoped, and each has a negative twin.** On the Contacts page
`/` focuses the search box and `Esc` clears it. `/` is ignored while a field has
focus (so a slash typed into the box still types a slash); `Esc` only acts when
the search box itself has the focus, so a dialog's own `Esc` still reaches the
host. The listener uses the pane ref that already existed — no wrapper element was
added, because the pane skeleton is what `test/ui-profile`'s layout test pins.
Both shortcuts carry a "left alone" test beside their positive one: a shortcut
that steals a keystroke meant for something else is the failure mode here.

**A short in-app changelog.** `WHATS_NEW` is newest first and each entry is a
translation key; the test pins that the versions descend and every note exists in
both locales. Prepend an entry when a release has something a user would read.

Tests: 1044 passing (was 1024) — 9 for the model (the operators match `FIELDS`,
the has/is values match the parser, every example parses, the examples cover
AND/OR/grouping/exclusion, the shortcut labels exist in both locales, and the
what's-new versions descend) and 6 for the dialog (each section renders, and
closing returns nothing) plus 4 for the shortcuts (focus, the "/-while-typing"
twin, clear, the "Esc elsewhere" twin) and 1 in the built-bundle suite.

### Smart lists in the command palette: the palette half of #13 (v1.43.0) — #13

#13 asks for saved searches and smart lists "usable from the page **and command
palette**". The page half shipped in v1.16.0 (chips with live counts on the
Contacts tab); the palette half is this. The plugin's palette actions are
published once by `activate()` and re-published only on a locale or settings
change, so a palette action per saved search would go stale the moment a search
was saved — the honest shape is **one static action that opens a dialog**, which
is also why the palette was left ungated by roles in v1.40.0.

**A smart list is a saved search with a live count.** `smartLists(saved, {
total, counts })` returns "everything" first and then one entry per saved search,
with the counts `countsForIndex` produced — positionally aligned, so the list and
its counts cannot drift out of order. `matchesFor(index, entry)` is the members,
using the **same** matcher the Contacts page uses (`isBlankQuery` /
`matchIndexed`), so a list's count and its members cannot disagree.

**The dialog reads and returns a choice; the action does the work.** The dialog
loads the cards, books and saved searches and returns `{ export: { cards, format,
name } }`; `lib/actions.js` builds the file, names it after the list
(`fileNameFor`), hands it to the host and falls back to showing the file when the
download is refused — the same pattern the Contacts page's export uses. Keeping
the work out of the dialog is what stops it from ever opening a dialog of its own
(a nested dialog is a host behaviour this plugin does not rely on).

**It reuses the paging from v1.42.0**, so a list with thousands of members shows
one page of 100 — the two features were built to fit each other. And it is honest
that the saved searches live in `api.storage` per account and per browser.

Tests: 1024 passing (was 1004) — 10 for the model (the entries and their counts,
the members of a list, junk input, and the file name) and 8 for the dialog (every
list with its count, the members of a picked list, the export choice, closing,
no saved searches, an empty list, and a failed read) plus 2 in the built-bundle
suite for the new palette action and its export.

### Paging the Contacts list: the scale half of #39 (v1.42.0) — #39

#39's first bullet is *pagination, virtualised lists, worker-based duplicate
matching and incremental search indexes*. This is the **pagination** piece — the
one that removes the actual freeze: the Contacts page rendered **every** contact
a query matched, so a 50k address book built a 50k-row DOM the moment the tab
opened. Virtualisation, a matching worker and incremental indexes remain; the
issue's "done when" is 100k contacts loading and searching without freezing the
UI, and paging is the half that bounds the render.

**A page is a view of the results, not a limit on them.** This is the whole
design. `pageSlice(list, page, size)` returns one page of `PAGE_SIZE` (100) plus
the 1-based `from`/`to` range and the page count; the page renders `items`, but
the match count and *Select all N* keep reading the whole `visible` list. So a
paged list is still a bulk scope — *Select all* after a search takes everything
the query matches, not the hundred on screen. `test/ui-profile` pins that with
250 matches and one *Select all*.

**`paging.js` is pure, and `clampPage` is the safety rail.** `pageCount` is at
least 1 even for an empty list; `clampPage` keeps an index in range, so a list
that shrinks under the user (a delete, a narrower query) can never leave a blank
page; `isPaged` decides whether a pager is worth showing at all. A new query
resets to the first page, so narrowing never leaves the user on page 7 of 1.

**The pager is drawn with plain elements** and sits **above** the scroll area,
so it does not scroll away with a long list — the same reasoning as the rest of
the skeleton in `layout.js` (the kit may drop a `style` prop, and the list runs
away).

**The budget is pinned, in two places.** `test/paging.test.mjs` slices one page
out of 100k and asserts it stays inside a budget, because the cost of showing a
page must not grow with the size of the book; `test/ui-profile.test.mjs` renders
5000 contacts and asserts the DOM holds exactly one page (100 rows).

Tests: 1004 passing (was 985) — 13 for the pure page math (the count, the clamp,
`isPaged`, the first/middle/last/short/empty page, a custom size, and the budget)
and 6 on the Contacts page (one page of 250 with its range line, walking
next/next/back, no pager for a short list, a new query resetting to page 1,
*Select all* over the whole set, and a bounded render for 5000).

### The Getting started guide: the onboarding half of #39 (v1.41.0) — #39

#39 is broad — scale, virtualised lists, performance budgets — and most of it is
about the host the plugin runs in. The one piece that is self-contained and
entirely the plugin's own is the onboarding bullet: *a first-run wizard: import,
scan, merge, set policies*. That is what ships. The issue's "done when" — *a new
user can import and clean contacts in under five minutes* — is the goal the
guide exists for.

**The steps are data, and every action is shared.** `onboarding.js` holds
`STEPS = ['welcome', 'import', 'scan', 'policies', 'done']` and the pure step
arithmetic (`nextStep`/`previousStep` clamp at the ends). `onboarding-card.js`
maps a step to an action, and every action is the same function the command
palette and the Overview menu run — `importContacts`, `findDuplicates`,
`managePolicies`. So the guide cannot describe a different change from the one a
task would make; it is a surface over the actions, not a second copy of them.

**It records that it is done, and re-opens on demand.** The state is a single
`{ done, at }` record in `api.storage` (per account and per browser, like the
projects). `normalizeOnboarding` trusts only `done === true`; `readOnboarding`
repairs junk on read and removes a not-done record; `completeOnboarding` writes
the flag and `resetOnboarding` forgets it. The Overview menu's *Getting started*
button re-opens the card through a **local** page flag, so re-opening never
rewrites what was stored.

**A failing step never traps the user.** Each action is awaited in a
`try/finally`; a step that throws (a refused dialog, a failed read) still
advances, because the action already reported its own failure and the guide is a
help surface, not a gate.

**One place opens the policies dialog.** `managePolicies(api, { fallbackBooks })`
in `actions.js` reads the address books itself, so the guide and the Duplicates
page cannot disagree about which books the dialog lists; the Duplicates page
passes its last scan as the fallback for when the read fails. The Duplicates
page's `openPolicies` was refactored onto it — the one behaviour change in a
tested file.

Tests: 985 passing (was 957) — 15 for the model (the order, the clamps, the
storage repairs, complete/reset), 9 for the card (each step's action opens the
right dialog, the walk forward and back, Finish and Skip, the change signal, and
a throwing step still advancing) and 4 on the Home page (shown on first run,
hidden once finished, re-opened from the menu, hidden on skip).

### Per-address-book roles: the advisory half of #23 (v1.40.0) — #23

#23 asks for per-book roles, UI that hides what the user cannot do, ownership
transfer and safe removal of a member's access. The triage is the whole design:
the host grants write permission once at install, all-or-nothing, and has **no
per-book permission and no shared member list**, so a role cannot be enforced and
a member list cannot be stored (plugin storage is per browser, not shared). What
ships is the half that is honest — a role the pages *show back* by disabling the
actions it forbids — and the dialog says out loud that the webmail is not
enforcing it. Enforced permissions, ownership transfer and safe removal need the
server tier (#68).

**The four roles are a strict ladder, and one table is the truth.** `book-roles.js`
holds `ROLES = ['viewer', 'editor', 'merger', 'admin']` and `ROLE_CAPABILITIES`
— `viewer: ['view']`, `editor: ['view', 'edit']`, `merger: […, 'merge',
'delete']`, `admin: […, 'manage']`. Each step adds a capability and never takes
one away, and `roleAllows(role, capability)` is the one place that reads the
table, so the pages and the tests cannot disagree. `manage` is the top — the
roles and the duplicate policies — and `delete` sits with `merger` because a
merge is itself a delete of the merged-away contacts.

**A contact's role is the weakest across its books.** `roleForCard` folds the
roles of a card's books with `weakestRole`, so a contact that lives in a book
where the user is only a viewer stays read-only even if another book would allow
more. That is the opposite direction to the match strategies in
`book-policies.js` — those take the *most* permissive reading so a book that opts
out never silences another, but a limit on what the user may do is the safe
direction *inwards*. A card in no book, and a book with no stored role, grants
`admin`, so an install that never opens the dialog behaves exactly as it did
before. A **global** action (creating a contact, opening the roles or policies
dialog) is not tied to one contact, so it uses `mostPermissiveRole` — available if
any book allows it.

**Storage is a plain map, keyed by book id, and repairs itself on read.**
`normalizeRoles` keeps only known ids with a known role; `readRoles` rewrites
when it dropped junk and removes the key when nothing is left, exactly like the
policies. An unknown role reads as the default, so a corrupt value can never
weaken an answer to a stronger one.

**The gating is on the two pages the actions live on.** The Duplicates page
disables *Review…* and the batch merge (over the group's members), *New contact*,
*Policies*, *Roles* and *Undo merge*; the Contacts page disables *New contact*,
*New company*, the per-contact *Edit* and the selection's *Merge selected* / *Edit
selected* / *Clean up* / *Rules…* / *Delete selected*. Each page shows a muted
line naming the role when one is set. `canPerform(cards, capability, roles)` and
`canManage(capability, roles)` are the two calls they make.

**The command palette is deliberately not gated.** Its actions are published by
`activate()` and re-published only on a locale or settings change, so a role read
at publish time would go stale the moment it changed; and the palette's merge
action only *scans*. The role is advisory, and the pages are where it is shown.

Tests: 957 passing (was 906) — 32 for the model (the ladder, monotonicity, the
unknown-role default, storage round trips and repairs, the weakest-link reading,
`canPerform`/`canManage` and the empty-map default), 9 for the dialog (the four
roles per book, the advisory line, cancel, no books, a failed save and a failed
load) and 10 page tests (a viewer cannot merge/edit/delete on either page, a merger
can, the weakest member of a group decides, the empty map changes nothing, and
the roles dialog opens with the books).

### The automation engine: rules over the events the host emits (v1.39.0) — #33

#33 asked for a when/then rules engine. The triage on the issue is the whole
design: the host fires `onAfterContactCreate` / `onAfterContactUpdate`, the
plugin owns the import flow, and there is **no** event for a tag change or an
arriving message — so the trigger list is exactly those three, and it grows with
the host rather than promising what it cannot do. `assign owner` is absent
because there is no owner concept (#23), and a shared execution log needs the
server tier (#68); the local run is recorded in the change history instead.

**A rule is when + if + then.** Triggers: `create`, `update`, `import`. The
condition is a **search query** — the query language from #13/#34, reused rather
than invented, so `tag:vip`, `has:email` and `(company:acme OR company:globex)`
all work — and an empty condition means "every contact". Actions: `addTag`,
`removeTag`, `addToGroup` (a real group card, #12) and `proposeMerge`.

**The plan is pure, so the dry run cannot lie.** `planAutomation(rules, {trigger,
card}, {books})` returns `{ matched, keywords, groups, proposeMerge }` and writes
nothing; `applyAutomation` applies exactly that plan. The builder's *Test* calls
`previewRule`, which folds the same per-rule deltas, so the preview shows what a
run would do — the same "one plan, two uses" rule the merge preview follows.

**Idempotency is what makes a save-triggered rule safe.** A tag already present
folds to no change, so `keywords` is `null` and nothing is written; a group the
contact is already in is a no-op (`withMember` returns `null`). That is what
stops a rule that fires on `update` from looping with the write it just made —
the one real hazard of hooking the observer events. Rules run in **priority
order**, then by id, so the order is total and stable, and the later rule wins
when two touch the same tag.

**A rule can never break a save.** The hooks stay observers: `runAutomationForCard`
reads the rules first and returns before any other read when none match the
trigger, every write is wrapped, and `applyAutomation` never throws at its
caller. A group card or an anonymised tombstone is skipped (`isMergeable`, the
same single gate the merge and the privacy work use), so the group write cannot
re-trigger the rules on the group itself.

**The import trigger runs once per batch.** `runAutomationForCards` reads the
rules and the address books once, and `importContacts` calls it over the cards
the wizard created — the import is the one event the plugin owns, and the wizard
now hands the created cards back for exactly this.

Tests: 906 passing (was 878) — 23 for the engine (the repair and ordering, the
store, the condition, the pure plan with its idempotency and priority rules, the
dry run, and the write path including a refused write and a group card that is
skipped) and 5 for the builder (the empty state, saving, the dry-run count,
removing, toggling off). The bundle test was updated for the tenth palette
action.

### Smart lists: the small, well-defined half of #34 (v1.38.0) — #34

The issue's comment had already done the triage: "smart lists" is the saved-search
feature (v1.16.0) under another name, sharing and pinning need the server tier
(#68) or a sidebar the plugin does not have, and the genuinely new work is
**OR/grouping** in the query language plus **a saved search used as a bulk
scope**. That is what shipped.

**A flat AND cannot express a disjunction, so the parser grew an AST — but only
when it has to.** `parseQuery` is now a small recursive-descent parser:
`orExpr := andExpr (OR andExpr)*`, `andExpr := factor+`,
`factor := '(' orExpr ')' | atom`. Adjacent terms are AND, `OR` binds looser than
AND, and `OR` is case-insensitive. Crucially, the returned object keeps the same
flat `terms`/`notTerms`/`filters`/`notFilters` shape it always had, and attaches
`ast` **only when the query is not a plain AND**. So every existing caller, test
and the error line are unchanged, and a simple query is byte-for-byte the same
object as before — the `parseQuery('   ')` equality test still passes.

**One matcher, two shapes.** `matchIndexed` evaluates `parsed.ast` when it is
there and the flat lists otherwise, so the two can never disagree about a simple
query. The AST leaves are `{type:'term'|'filter', …, negated}` and the branches
are `and`/`or`; `leafMatches` folds negation into one comparison
(`hit !== negated`).

**A typo must not throw the query away.** Unbalanced parentheses and a dangling
`OR` are reported under the box (two new reasons, `unbalanced` and
`dangling-or`), but parsing continues: a `)` with no opener is skipped and the
rest of the query is still parsed, and a leading/trailing `OR` still parses its
other side. This is the same rule the language has always had for an unknown
operator — reported *and* kept as free text.

**The bulk scope is one button, not a new action path.** *Select all N* sets the
selection to every id the list shows; the existing selection bar
(Merge/Edit/Clean up/Rules/Export/Delete) then applies unchanged. Because a
saved-search chip just sets the query, "click a saved search, then *Select all*"
is exactly "act on everything it matches" with no new plumbing.

**A latent bug fixed on the way.** The page decided "is there a query?" from
`parsed.terms.length || parsed.filters.length`, so a query of **only** negations
(`-tag:vip`) was parsed correctly by `searchCards` but the page showed the whole
address book. It now asks `isBlankQuery(parsed)` — the same rule the matcher
uses — so the list and the match count agree. A test pins it.

Tests: 878 passing (was 866) — 9 for the parser (either side of an `OR`,
precedence, grouping, exclusion inside a group, the ast only when needed, the
flat lists still filled, unbalanced parens, a dangling `OR`) and 3 for the page
(*Select all* follows the query, an OR query applies, a negation-only query
filters). `test/ui-profile` now reads the operator hint from the manifest so it
cannot drift again.

### The GDPR and consent toolkit: four asks, two of them already had machinery (v1.37.0) — #26

#26 asked for four things — export everything held about a person, erase or
anonymise them, a consent basis per contact and source with an expiry, and
proof-of-deletion reports — and two of them already existed in another form: the
export is `contactsToFile` (#19/#22) and the delete is `deleteContacts` (#14).
So the work was the two that did not exist, built to reuse the two that did.

**Consent is a record *about* a contact, not a field on it.** The host has no
consent field, and inventing one would put data the user did not type into their
address book — the same line the history and the projects draw. So `consent.js`
keeps records in `api.storage`, per account and per browser, one per
(contact, source) with the source folded to lower case. The basis is one of the
six lawful bases of GDPR Art. 6, exactly the regulation's list: the plugin does
not judge which applies, because that is the controller's call.

**An expiry is a status, not a filter.** `consentStatus` returns `active`,
`expiring` (within 30 days of the date), `expired` or `none`, and
`daysUntilExpiry` is the number behind it. Dates are stored `YYYY-MM-DD`, the
shape an `<input type=date>` writes, so what is stored is what the user picked.

**Erase and anonymise are two different promises, and both reuse what exists.**
*Erase* deletes the card through `deleteContacts` — so a data-subject erasure
leaves the same undo record every other delete does, and is recoverable inside
the undo window — then drops the consent records. *Anonymise* keeps the card as
an empty tombstone: `anonymisePatch` clears every field in `PERSONAL_FIELDS`
with `undefined` (the way undo clears a field) and stamps an `anonymised`
keyword. `isMergeable` grew one clause to keep that tombstone out of duplicate
detection, through the same single gate that already keeps a group out, so an
anonymised contact is never offered as a duplicate of a person.

**The proof-of-deletion log holds no personal data.** An entry is
`{ at, id, method, fields, books }` — the id, whether it was erased or
anonymised, and which fields were cleared. It deliberately does **not** keep the
name: a log that did would put back the data the erasure was for. The page
exports it as a CSV report. `recordDeletion` never throws at its caller, for the
same reason `recordHistory` does not.

**The subject-access export is the whole card, plus the records about it.**
`buildSubjectExport` returns `{ generatedAt, subject, data, consents, changes }`,
where `data` is the card in full — completeness is the point — and `changes` are
the plugin's own history entries whose `subject` is this person. That `subject`
field is the one thing `history.js` grew: without it a consent change or an
erasure could not be tied to the contact it was about.

**Consent changes are audited.** `saveConsent` and `deleteConsent` write the
record and then a `consent` history entry, one line each, so the *History* tab
shows who consented and when — the same by-product rule the rest of the history
follows. The three new kinds (`consent`, `erase`, `anonymise`) have labels in
both locales.

Tests: 866 passing (was 832) — 11 for the consent store, 15 for the export, the
writes and the deletion log, and 8 for the page and the dialog. The shell test
was updated for the eighth sub-tab and the locale-completeness test covers every
new string in `en` and `de`.

### The change history: a by-product, not a second code path (v1.36.0) — #25

#25 is *audit log and change history*, and only half of it is buildable: a plugin
cannot see who else changed a contact, and cannot hold a shared, tamper-evident
store (#68). So what shipped is the half that is honest — **what this plugin
wrote** — and the page says exactly that, because a compliance surface that
overstates what it knows is worse than one that does not exist.

**The recording had to be free.** A history that every write path has to
remember to update is a history that is wrong the first time someone adds a
write path. So the two choke points every batch already passes through —
`saveUndo` and `applyNormalisation` — record themselves, and `saveUndo` grew a
`kind` so a bulk delete is recorded as a delete rather than a merge. The
single-contact paths (editor, group dialog) and the import and bulk paths call
`recordHistory` directly, one line each.

**A note about a write must never fail the write.** `recordHistory` catches
everything and returns null: the change was made, and reporting it as failed
because the note about it could not be stored would be a lie in the other
direction. The same reason `applyNormalisation` records *after* the writes.

**One rollback, not two.** `liveRollback` picks the newest of the records that
can still be undone — a merge batch or a cleanup/rules record — and the page
offers that one, through the undo functions that already exist. The history
points at the rollback rather than inventing a second one, which is the same
rule as the one-review-dialog rule in `.clinerules`.

**`applyNormalisation`'s third argument changed shape.** It used to be `now`;
it is now `{ now, kind }`, and a plain number still means "the time", so the
existing callers and tests kept working while the rules batch could say it was
rules.

Tests: 832 passing (was 813) — 12 for the store and the recording paths, 5 for
the page, and one each in the editor and group-dialog suites. The shell test was
updated for the seventh sub-tab.

### The rules engine: a cleanup that became a language (v1.35.0) — #20

#20 asked for user-defined and built-in rules, a preview with dry-run and
rollback, and to run them on import, on edit and on demand. The plugin already
had exactly one hard-coded rule set — the E.164 cleanup — with a plan, a preview
and an undo, so the work was to **generalise what existed rather than build a
second pipeline**.

**A rule is one transformation of one field.** `BUILTIN_RULES` is a fixed
catalogue; a user rule is a literal, case-insensitive find-and-replace on one
field. `orderedRules` is the single place that decides the order — enabled
built-ins in catalogue order, then the user rules in stored order — so the
determinism #20 asks for is a property of the catalogue, not of `Object.keys`.

**`planRules` returns the cleanup's own shape.** `{ id, name, patch, before,
changes }` means `applyNormalisation` and `undoCleanup` are reused unchanged, so
a rules batch is undone by the same button as a cleanup and there is no second
rollback path to keep correct. That was the whole reason to build on the
cleanup instead of beside it.

**One transform, three callers.** `applyRulesToCard` is behind all three entry
points #20 lists: the dialog (on demand), the import wizard (applied to the card
*before* the duplicate keys are taken, so the preview matches what is written —
and a rule that fixes a spelling can fix the match) and the editor (the save
writes the normalised card). The editor path never blocks a save: a failed rules
read writes the card exactly as typed.

**Two honest limits.** Title case rewrites a word written entirely in capitals,
so a genuine acronym written that way is rewritten too — that is what title case
means, and a find-and-replace rule puts one back; the dialog says so. And
`phone.e164` needs a region (the cleanup dialog stores it); with no region the
rule leaves the number alone rather than guessing at a country.

**The bug the tests found.** `normalizeRules` originally stored the find text
through `text()`, which trims — so a rule written as `" GmbH" → ""` silently
became `"GmbH" → ""` and left a trailing space. The find text is now stored as
typed (validated non-blank), which is what "literal find and replace" has to
mean.

Tests: 813 passing (was 775) — 31 for the engine and 6 for the dialog, plus one
on the Contacts page for the button. The bundle test was updated for the ninth
palette action.

### Contact groups: a real card, and the one safety rule (v1.34.0) — #12

#12 wanted distribution lists to be first-class, with three parts: group CRUD,
membership, and safety (never merge a group as a person; warn about duplicates
inside a list). Two other parts need host surface and are not built — the
composer's autocomplete and a membership view inside the webmail's own card.

**A group is a card, not a local record.** Projects are local because the host
has no custom object store; a group has a native home — JSContact `kind:
'group'` with a `members` map — so it is written through `api.contacts` like a
company (v1.9.0). That is why the page says out loud that groups are shared
across devices while projects are not: the difference is the host's, not the
plugin's.

**The one safety rule is in `isMergeable`.** A group is never a duplicate of a
person, and two groups are never duplicates of each other — so the exclusion
belongs in `isMergeable`, the single gate `findDuplicateGroups` and `planMerge`
already ask, rather than in the Groups page. `isGroupCard` reads `kind: 'group'`
*and* the `group` keyword, because a host that drops `kind` would otherwise let
a list be merged. The keyword is a fallback, exactly as `company` is for an
organisation; the editor writes it on every group card.

**The duplicate warning reuses the scan, so it cannot disagree with it.**
`duplicatesInGroup` runs `findDuplicateGroups` over the group's members with the
options the Duplicates page scans with — the per-book policies and ignore rules
included — and the editor recomputes it on the *draft*, so the warning follows
the edit instead of describing the card as it was opened. The list itself is
never changed: the review goes through the one review dialog (see `.clinerules`), the same
reason the import wizard queues a merge rather than performing it.

**The member search reuses the contact search.** `memberCandidates` filters with
`filterCards` — the matcher behind the Contacts page box — never offers another
group, skips the ids already chosen and caps the result. A second matcher would
be the thing that drifts.

Tests: 775 passing (was 749) — 16 for the model and 10 for the page and dialog.
The shell and bundle tests were updated for the sixth sub-tab and the ninth
palette action.

### Name matching: what is a key, and what is only evidence (v1.33.0) — #8

The hard part of #8 is not recall, it is **precision**: this plugin *proposes
merging people*, so a name rule that is a little too eager offers to fold two
different humans into one. (#75 made the same point about host APIs.)

**The design follows from one fact: some spellings cannot be keys.** `Müller` and
`Mueller` are one name, so they belong in a shared key — anything two cards share
by definition is a match. But `J. Smith` cannot be a key, because the same key
would match `John Smith` **and** `Jane Smith`, and those are two people. So the
module splits into **equivalence** (keys) and **evidence** (pairwise):

| Equivalence → keys | Evidence → pairwise |
|---|---|
| romanisation, both German spellings, nicknames | initials, phonetic surnames, near-miss given names |
| cheap, deterministic, always `possible` | bucketed, guarded, always `possible` |

**Two honest spellings, not one.** `Müller` is "Muller" on a keyboard and
"Mueller" on a passport. One fold has to be wrong for one of them, so
`foldVariants` emits both and `nameKeys` keys each. The fold runs **twice**: the
first pass expands `ü` → `ue` (which needs the precomposed letter), the second
catches a script letter that only appears once its mark is gone (`ώ` → `ω` +
tonos). That second pass was a real bug: Greek kept `ω` because the mapping ran
before the decomposition.

**`nicknameKeys` only emits what adds something.** `Robert Smith` contributes no
`k:` key, because its canonical form *is* its name. And the `k:` key shares the
name **namespace** with `n:`/`c:` (`unionId`), or `Bob`'s `k:robert smith` could
never meet `Robert`'s `n:robert smith`. A nickname is reported as the *reason*
only when a canonical variant met a real name — two cards that both say "Bob"
already share a plain name key and are not a nickname match.

**The pairwise pass has four guards, in order of how much they matter:**

1. the surname must have **two letters** (a numeric "surname" like `Twin 1` has
   none);
2. the surname must **agree** — equal letters, or both ≥ 3 letters and Jaro-Winkler
   at the threshold;
3. the bucket must have **≤ 60 members** (a surname that common is a crowd);
4. the **given name must corroborate** — same, an initial of it, or similar.

**The bug the first test run found.** Without (1), `phoneticKey('1')` and
`phoneticKey('10')` are both `1000`, the given name "Twin" corroborated, and a
51-group fixture collapsed into groups of 22, 4 and 2 — the exact failure mode the
issue warns about, caught because v1.32.0's cap test uses 51 groups. Guard (2) was
added with it: phonetic equality alone is too weak for short tokens.

**A reason that names both spellings.** A pairwise group carries
`{ type: 'similar', value: 'J. Smith ↔ John Smith' }`, so the dialog explains
itself without the user guessing. A pair that already shares an exact key adds no
reason — "Similar name" on top of "Same email address" is noise.

### Bulk merge by facet, without a second merge path (v1.32.0) — #6

Large address books need batches. The Duplicates page already had multi-select and
*a* review dialog; what it lacked was a way to say *"everything at Acme"* without
clicking fifty checkboxes.

**The facets come from the data, not from the user.** `groupFacets(groups)` reads
each member's organisation and email domains and offers the ones that cover more
than one group — *Acme Inc. · 2 groups*, *@example.org · 3 groups*, *All N groups*.
Because the user **clicks a spelling that exists** rather than typing a guess,
there is nothing to be fuzzy about: `companyKey` only has to fold case and
whitespace. Rewriting `Acme Inc.` to `Acme` is #20 (normalisation) and is
deliberately not duplicated here — two places deciding what a company name *is*
would be the thing that drifts.

**A facet is a filter, not a partition.** A group whose members sit at two
companies appears under **both**, because dropping it from one would make the
batch smaller than the user asked for. Facets covering a single group are not
offered at all: that is *Review* on that group, not a batch.

**The batch still goes through the one dialog.** *Merge N groups* opens the same
review dialog as everything else, so the per-group *Keep* override, the
field-by-field conflict resolution, the danger confirm and the undo record all
come for free. `batchPlan` is only the dry run the page shows first
(`{groups} · {contacts} · {removals} would be removed`), with `removals =
contacts − groups` — one kept per group.

**The cap is enforced, not hinted.** More than `BATCH_CAP` (50) groups disables
*Merge* and says so. It is tied to the undo store: `MAX_CARDS` is 100 and a batch
removes at least one card per group, so a capped batch can always be undone.
Trimming the selection silently would merge less than the user asked for; asking
them to narrow it is the only honest option.

**A collision worth remembering.** The first draft used `bulk.*` string keys and
silently overwrote `bulk.title` — the bulk *editor* dialog's title. The fix was a
`batch.*` prefix, and the lesson is that `bulk.js`/`bulk-dialog.js` already own
that namespace.

### A digest, without the timer #5 asked for (v1.31.0) — #5, re-scoped

#5 wanted *"a settings-backed schedule (daily or weekly) executed by the plugin
background hook"*. **There is no background hook.** The plugin exports `onAction`
and the two contact observers and nothing else, and there is no server-side
scheduler, so a scan cannot run while the webmail is closed — that was recorded
on the issue before any code was written. What shipped is the half that needs no
host change and keeps the point of the issue: duplicates do not go unnoticed.

**The signal is staleness and change, not a clock.** When the plugin opens it
compares two things against what the user has already been told: the age of the
last scan (`lastScan.when`, which every scan already stored) and the current
duplicate group signatures. It says something when the scan is older than
`digestDays`, or when groups have appeared since.

**"New" needs a baseline, or it is a false alarm every time.** Before anything has
been acknowledged, a group is not new — it is the state of the address book, and
calling it new on a fresh browser would fire on every first visit. So the first
look **writes the baseline**, including an *empty* one: "nothing to see" is
information, and losing it is exactly what would make the next duplicate
invisible. That is why `readDigestState` returns `{ baseline, at, signatures }`
rather than just a list.

**A staleness nag is said once per scan age.** `buildDigest` suppresses it when
`seenAt >= at` — the user was told at or after the scan that is now old. Without
that, *Got it* would look broken: the scan stays stale until a scan happens, so
the banner would return on every reload. `isScanStale` stays a plain age test;
the "already told" rule lives in `buildDigest`, where the reason is visible.

**It counts what a scan would.** The signatures come from the same
`findDuplicateGroups` call the headline uses, with the same match strategies,
policies and ignore rules — so the digest cannot disagree with the Duplicates tab.
Groups the user has **hidden** are filtered out: a hidden group is a decision, not
news. And it stores only the summary and the signatures, never contacts, which is
what #5 asked for.

**Reuse, not a second path.** *Review now* calls the same `findDuplicates` action
the menu and the command palette use, so the merge still goes through the one
review dialog. `digest.js` is pure logic plus `api.storage`; the page renders what
it returns.

### A decision per duplicate during import (v1.30.0) — #4, the per-group half

The import wizard already *found* the duplicates (v1.21.0: `planImport` matches on
the same keys detection uses) but offered one control for the whole file — a
boolean `skipDuplicates` that chose between `plan.fresh` and `plan.fresh +
plan.duplicates`. All-or-nothing: skip every duplicate, or import every duplicate.
#4 asked for a decision **per group**: *merge*, *skip*, or *import as a separate
contact*, remembered per batch.

**The design question, settled the way the issue suggested.** A merge here would
be the first merge in the plugin that does not go through the review dialog, and
that is a hard rule (see `.clinerules`). So "merge" does **not** merge inside the
wizard. The wizard writes the imported contact and hands the pair
`[existing, imported]` back to the caller, and `importContacts` in `actions.js`
opens the one review dialog every other merge uses. The wizard queues; the dialog
merges.

**`keepId` on a group.** `groupFromSelection` produces a group whose kept contact
`planMerge` picks by field score, which could be the imported copy. For an import
"merge" means *fold what the file adds into the contact I already have*, so
`mergeGroupsFromImport` sets `group.keepId = match.id` and the review dialog opens
on that choice (`g.keepId ?? planMerge(g).primary?.id`). The user can still change
it in the dialog.

**A stable key for a decision.** The drafts are rebuilt by a `useMemo` whenever
the mapping or the target book changes, so their object identity does not survive
a render. `duplicateKey(entry)` keys a decision by what matched, why, and which
draft (`match.id | reason | label`), so a per-contact choice sticks while the
wizard is open. The batch default is separate state, applied to any duplicate the
user has not overridden.

**`applyImport` now returns `cards`.** Pairing each created draft with the card
the host returned is what lets a merge reach the id the host assigned; without it
the wizard would have to guess. `failed` still counts a draft the host refused,
and a pair whose imported card was not created is dropped — there is nothing to
merge, and the failure is already reported.

**The toast adds up.** A merge decision is written as a contact and then removed
by the merge, so it is no longer new: `actions.js` reports `created - merged` and
toasts the merge outcome through the shared `toastMergeResult`. If the review
dialog is cancelled the contact stays, so it still counts as created.

### The ignore rule that was never reached (v1.29.0) — #7, the field rule

`companies` joins `domains` and `tags` on the ignore record: a contact is skipped
when its organisation name **contains** the text, case-insensitively, so one rule
covers `Acme`, `Acme Inc.` and `ACME GmbH`. The organisation is read through
`orgName()` from `contacts.js`, like every other field this module needs.

**A part of the name, not the whole of it.** An exact match would fail silently on
the spellings nobody can predict, and a rule that quietly matches nothing is worse
than no rule at all — the user believes they have configured something.

**The bug the new test found on its first run.** `isCardIgnored` learned about
companies, but `filterForScan` still decided whether to filter at all by testing
`domains` and `tags` itself. A rule that set only `companies` never reached the
matcher, so the scan returned every duplicate exactly as before. There is now one
`hasIgnoreRules(ignore)` that every caller asks, and the gate and the matcher
cannot disagree about what counts as a rule. The lesson is worth keeping: adding a
case to a function is not the same as adding it to the *condition that reaches* the
function.

**Two test fixtures were still lying.** `duplicates.test.mjs` hand-wrote its cards
and gave the tag rule `keywords: ['do-not-merge']` — an array the host never
produces. It passed only because `cardTags` accepts both shapes. Those fixtures now
use `makeCard` and the real `{ tagName: true }` map, which is what the v1.27.1
lesson asked for.

Tests: 653 passing (was 647).


### Protected fields, and protection points the other way (v1.28.0) — #7

`PROTECTED_FIELDS` lists every field a merge can write, so there is no field a
user can watch being changed but cannot freeze. A book's `protectedFields` is a
list on its policy, edited with checkboxes in the same dialog.

**Protection unions; matching does not.** The match strategies take the *most
permissive* reading across a contact's books, because silence is the failure
there. Protection takes the **union**, because losing data is the failure here:
a field protected by any book the contact is in is protected. Same shape of rule,
opposite direction, and both are the safe way to be wrong.

**Derived, not passed around.** `planMerge(group, keepId, choices, { policies })`
computes the frozen set from the kept contact itself, and `mergeGroups` reads the
policies on its own. Neither is told the answer by the other, so the preview the
user approves and the write that follows cannot disagree — which is exactly the
failure a "pass the frozen fields down" design would have had.

**Protection is not silence.** A frozen field simply never appears as filled,
unioned or replaced, and the dialog names the fields it is holding back, so a
merge that deliberately leaves something alone says so instead of looking like it
forgot.

**A bug found while writing the tests.** `planMerge` reported a filled map field
(`organizations`, `titles`, `personalInfo`, `media`) as one whole-map entry, and
the preview handed that map to `DISPLAY` as if it were a single entry — so an
organisation merged in from a donor was written to the contact with no line in
the dialog explaining where it came from. The plan now reports one entry per
value, the shape the union fields already used. It was caught by the
protected-fields UI test, which asserts the donor's organisation *is* offered
when nothing protects it: the positive twin that stops the assertion passing for
the wrong reason.

Tests: 647 passing (was 623).


### The two bugs a green suite hid (v1.27.1) — #7, the fixes

v1.27.0 shipped with **606 tests passing and two features that did not work.**
Both were the same mistake in different clothes: the tests described the code
instead of the host.

**Ignored tags never matched anything.** `cardTags` read `Object.values(keywords)`
and looked for `.label` / `.name` — but `keywords` is `{ tagName: true }`, so the
**keys** are the tags, exactly as `search.js` reads them. The values are
booleans, `text(true)` is `''`, and every contact survived the rule. The test
passed because it asserted `keywords: { k1: { label: 'VIP' } }`, a shape nothing
in the host or the codebase produces. It is fixed by reading the keys, and pinned
by a test that compares the ignore rule against `buildIndex` — one reading of
`keywords` for the whole plugin.

**Every checkbox needed two clicks.** The box rendered `!== false` but toggled
with `!current[field]`, so an untouched `undefined` was read as *off* and the
first click stored `true` — no visible change. The kit even hands the dialog the
correct value (`onChange(!checked)`) and the dialog threw the argument away.

**The tri-state the strings promised.** `policies.on` / `.off` / `.default`
shipped in `en` and `de` with no code behind them, so a book forced off could
never return to “use the global setting”. The strategies are now a real
*Default* / *On* / *Off* control; `bundle.test.mjs` checks that the two locales
agree, not that a string is **used**, which is why three dead ones sailed through.

**One call assembles the options.** `policyAwareOptions(api)` replaces four
copies of the same `Promise.all`, and `findGroupFor` now honours the policies —
before this, a book you turned off stayed quiet on the Duplicates page while the
contact-details hint and the save-time warning kept shouting about it.

**The lesson, and it is now in the tests:** a fixture must use the shape the host
sends, and a negative test needs a positive twin. Each “stays silent” test here
sits next to one that still warns, so silence cannot pass for the wrong reason.

Tests: 622 passing (was 606) — 13 written first and watched fail.

### Per-address-book policies, and a rule that leans towards scanning (v1.27.0) — #7

`book-policies.js` is the model (pure, plus `api.storage`), `policies-dialog.js`
the dialog behind the *Policies* button on the Duplicates page. A policy is one
record per book id — `enabled` and an optional `matchByEmail` / `matchByPhone` /
`matchByName` — plus one global `{ domains, tags }` ignore list. An untouched
field is `undefined`, which means “use the global setting”, and an empty policy
set is exactly the previous behaviour.

**The multi-book rule is the whole design.** A contact can live in several
books, so “does book A’s policy apply?” has no single answer. The plugin takes
the **most permissive** setting across every enabled book, and a card with no
book is always scanned. Both choices lean towards scanning: a book that opts out
never silences a match another book still wants, so a policy cannot make a
duplicate disappear by accident.

**One filter, six entry points.** `filterForScan` returns the surviving cards
and each card’s effective options together, so `findDuplicateGroups` compares
with a contact’s own strategies instead of the globals. `actions.js`,
`manager-page.js`, `home-page.js` and `health-page.js` pass the policies into a
full scan, and `findGroupFor` filters each candidate the same way — which is what
makes a policy true of the Duplicates page, the palette, the Home overview, the
Health tab, the *Duplicate check* block in an open contact and the warning after
a save, all at once.

**Stored like the other per-browser state** (projects, saved searches, import
mappings): `api.storage`, repaired on read, capped, and removed rather than
written when it would be empty.

Tests: 606 passing (was 564) — 35 for the policy model and 2 for the dialog,
with the resolution rule and the ignore rules asserted both ways.

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

**Since v1.30.0 the duplicate check is not just a warning.** `planImport` still
produces `{ fresh, duplicates }`, but the wizard now turns each duplicate into a
per-contact decision and `mergeGroupsFromImport` queues the ones marked *merge*
for the review dialog — see *A decision per duplicate during import* above.

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
- `digestDays` - the duplicate digest window in days (default 7, `0` = off) (v1.31.0)
- `matchByEmail`, `matchByPhone`, `matchByName` - one switch per matching rule
- `nameSimilarity` - how alike two given names must be, in percent (default 80); initials and nicknames match regardless (v1.33.0)
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
  group the feature issues. Their titles (`v1.2.0` … `v2.0.0`) are the
  **originally planned releases**, not the current release train — the plugin is
  at v1.43.0. Read them as phases, and read each milestone's description, which
  records what has shipped and what remains.
- **Feature issues** — https://github.com/zyntrax/bulwark-plugins/issues?q=is%3Aissue+label%3Aroadmap
  are the individual todos, grouped by area and milestone.
- **Pinned roadmap issue** — https://github.com/zyntrax/bulwark-plugins/issues/40
  is the top-level vision with links to every planned feature; its checkboxes
  mirror the issues (ticked when the issue is **closed**).

When a feature ships, close its issue in the release commit/PR — that is what
ticks the roadmap box and moves the milestone count. New ideas go into a new
issue with the `roadmap` label and a milestone — never into a local todo list.

**Milestone hygiene (2026-11-02):** five features whose code shipped in an
earlier release (#4, #6, #8, #12, #20) had stayed open, so their milestone counts
and roadmap boxes were wrong; they were closed and the boxes ticked. #5 (a
*scheduled* scan) stays open — it needs a host timer hook the plugin does not
have, so only its digest half shipped. **#13 was closed on the v1.45.0 release**
(both its halves had shipped: the page half in v1.16.0, the palette half in
v1.43.0). **No issue was fully shipped in v1.46.0**, so none was closed: #36, #38
and #39 each keep a comment recording what shipped and what remains — every one
of them has a named half still to do, or needs the server tier (#68).

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

> **Updated 2026-10-27:** every item in that list has since shipped — the editor
> (#9, v1.6.0), the profile (#10, v1.7.0), smart search and saved searches (#13,
> v1.16.0), bulk actions (#14, v1.15.0) and avatars (#15, v1.18.0). #11 (custom
> fields) is the only one still open, and it needs a host change. See finding 3.

### 3. The open roadmap, sorted by what actually blocks it (2026-10-27)

A triage of every open issue against the tree at v1.30.0, recorded on **#40**.
The short version, because it changes what "next" means:

**Buildable now, no host change** — #13 (the palette half of search), #20
(normalisation rules), #12 (groups, emulated via `keywords` — a plugin convention,
not a host record), #39 (scale), and the local halves of #25 (a change history of
the plugin's own writes) and #26 (consent records + anonymise). #34's saved lists
with live counts already shipped in v1.16.0; what is left is AND/OR composition and
using a saved search as a bulk scope. **v1.2.0 is complete**: #5's digest (v1.31.0),
#6's bulk merge (v1.32.0) and #8's name matching (v1.33.0) all shipped.

**Needs a host change** — #11 (custom fields: the host has no custom object types
or fields), #37 (composer and hover cards: the plugin has only three slots), #23
(per-book role *enforcement*: permissions are plugin-level and granted once at
install, so only an advisory UI is honest), and #18 / #35 / #36 (they read mail or
tasks — the optional APIs #75 is waiting on).

**Needs the server tier (#68)** — #24 (a shared review queue) and #28–#32
(CardDAV, LDAP/AD, directory sync, CRM sync, webhooks). `http:proxy` lets the
plugin reach a user-configured server, but secrets and shared state cannot live in
plugin storage.

This is #75's finding one level up: the plugin cannot assume a host API exists,
cannot hold a secret and cannot share state. Anything that must be *dependable* is
a #68 candidate; anything needing a new *surface* is a host change; everything
else is ordinary work and can be taken in any order.

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
fyrhaven-crm/
├── manifest.json          # id, version, permissions, settingsSchema, locales (en+de)
├── package.json           # scripts and dev dependencies
├── CHANGELOG.md           # user-facing history
├── README.md              # user-facing plugin documentation
├── HANDOFF.md             # this file - where the project stands and why
├── vitest.config.mjs      # test config
├── src/
│   ├── index.js           # slots, hooks, activate() wiring
│   └── lib/
│       ├── contacts.js    # JSContact readers, loaders, settings flags
│       ├── duplicates.js  # detection (union-find), merge planning, merging
│       ├── labels.js      # shared display helpers and toasts
│       ├── manager-page.js # the Contact Manager page
│       ├── groups-page.js # the Groups page and group model (#12, v1.34.0)
│       ├── rules.js       # the normalisation rules engine (#20, v1.35.0)
│       ├── history.js     # the change history of the plugin's own writes (#25, v1.36.0)
│       ├── book-roles.js  # per-address-book roles: ladder, store, reading (#23, v1.40.0)
│       ├── roles-dialog.js # the address-book roles dialog (#23, v1.40.0)
│       ├── onboarding.js  # the Getting started guide: steps and store (#39, v1.41.0)
│       ├── onboarding-card.js # the Getting started card on the Overview tab (#39, v1.41.0)
│       ├── paging.js      # the pure page math for a long contact list (#39, v1.42.0)
│       ├── smart-lists.js # saved searches as smart lists: counts, members, name (#13, v1.43.0)
│       ├── smart-lists-dialog.js # the Smart lists dialog (plugin-dialog slot, #13, v1.43.0)
│       ├── help.js        # the help model: operators, examples, shortcuts, what's new (#39, v1.44.0)
│       ├── help-dialog.js # the Help dialog (plugin-dialog slot, #39, v1.44.0)
│       ├── tasks.js       # follow-up tasks: payload, due dates, the overdue/soon split (#36, v1.45.0–v1.47.0)
│       ├── task-dialog.js # the follow-up task editor (plugin-dialog slot, #36, v1.45.0)
│       ├── open-task.js   # opens the task editor and creates the task (#36, v1.45.0)
│       ├── notes.js       # private notes: the store, its repairs, the erasure (#38, v1.46.0)
│       ├── markdown.js    # the tiny inline formatter for a note (#38, v1.46.0)
│       ├── notes-section.js # the Private notes section on a contact (#38, v1.46.0)
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
│   ├── book-roles.test.mjs # the role ladder, the store, the role that applies (#23, v1.40.0)
│   ├── ui-roles.test.mjs  # the roles dialog (#23, v1.40.0)
│   ├── onboarding.test.mjs # the guide's step order and storage (#39, v1.41.0)
│   ├── ui-onboarding.test.mjs # the Getting started card (#39, v1.41.0)
│   ├── paging.test.mjs     # the page math and its budget (#39, v1.42.0)
│   ├── smart-lists.test.mjs # the smart-list model and its file name (#13, v1.43.0)
│   ├── ui-smart-lists.test.mjs # the Smart lists dialog (#13, v1.43.0)
│   ├── help.test.mjs       # the help model cannot drift from the search box (#39, v1.44.0)
│   ├── ui-help.test.mjs    # the Help dialog (#39, v1.44.0)
│   ├── tasks.test.mjs      # the follow-up payload, due dates, the overdue split (#36, v1.45.0)
│   ├── ui-task.test.mjs    # the follow-up task editor (#36, v1.45.0)
│   ├── labels.test.mjs     # the shared date formatter (#36, v1.47.0)
│   ├── notes.test.mjs      # the note store, its repairs and the erasure (#38, v1.46.0)
│   ├── markdown.test.mjs   # the tiny inline formatter (#38, v1.46.0)
│   ├── ui-notes.test.mjs   # the Private notes section (#38, v1.46.0)
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
    ├── package.mjs        # builds fyrhaven-crm.zip
    └── release.mjs        # tags, pushes the tag, uploads the ZIP to Releases
```

## How to Continue

1. **Run tests**: `cd contact-manager && npm test` (builds first, then runs vitest suite)
2. **Build package**: `npm run package` (creates fyrhaven-crm.zip)
3. **Update version**: bump `manifest.json` version (and `package.json`) and add the CHANGELOG entry
4. **Merge**: merge the feature branch into `main` through a PR and keep the
   `contact-manager` mirror branch in step with `main`
5. **Commit**: source only (the ZIP is a GitHub release asset)
6. **GitHub**: run `npm run release` on `main`. It tags
   `fyrhaven-crm-vX.Y.Z`, pushes the tag and creates the GitHub release with
   the ZIP attached; the roadmap and todos live in GitHub issues/milestones.

### Where to pick up next

**Direction (2026-10-21): an eWay-CRM-style workspace.** The product goal is no
longer just duplicate cleanup — it is the contact/CRM layer of Bulwark. The
full map of eWay-CRM modules to host capabilities, the phases and the
non-goals live in **issue #54**
(https://github.com/zyntrax/bulwark-plugins/issues/54), linked from the
roadmap issue #40.

Hard limits to remember before promising CRM data — **corrected against the
host's own generated documentation** (see `.clinerules`, "The host contract"):

- `api.storage` is per-account, per-browser `localStorage`, **1 MB per account**
  — not a shared server store. A record kept there is unreachable from another
  device and gone when site data is cleared.
- **There *is* server-side storage a plugin can use.** Finding it took far longer
  than it should have, because this file used to say the opposite:
  - **`api.files`** — Stalwart's file storage (1.20+, `files:read`/`files:write`,
    gated on `api.host.features.files`): server-side, cross-device, no size
    problem. Writes go only into the user's **own** drive — never into a folder
    shared with others — and there is no delete or share call. So it is
    **per-user**, and team-*readable* only if the owner shares the folder in the
    Files app.
  - **`api.accountData`** — at most **4 KB** of JSON in a **mail account's** Inbox
    metadata (1.19+, `email:read`/`email:write`, Stalwart 1.0+), namespaced per
    plugin and **shared by everyone who can open that account**. Small, invisible
    to other JMAP clients, and the one genuinely *shared* server-side slot.
- Contacts, address books, mail, calendar events and tasks are native APIs
  (`api.contacts`, `api.email.search`, `api.calendar`, `api.tasks`). Custom object
  types and custom fields still do not exist — but a plugin **can** hold a
  credential (`configSchema` `secret`, admin-set and installation-wide, used
  through `api.proxy`) and a per-user setting (`settingsSchema`, which takes
  `string` and `select` too).
- There is no server-side scheduler; background work runs only while the
  webmail is open.

### Decision (2026-11-03): the server is the source of truth

The maintainer ruled on the storage question — the full record is **#68** — and
it reverses what this file used to say about local-first:

- **A record the plugin invents must not live only in a browser.** Change device
  and it is unreachable; clear site data and it is gone. So the **dedicated
  plugin server is the source of truth** for projects, private notes, consent
  records, the deletion log, the change history, per-book policies / ignore rules
  / roles, automation rules, saved searches, import templates and normalisation
  rules.
- **An earlier version of this note said those records "cannot live on the
  Stalwart server". That was wrong**, and correcting it is the point of this
  paragraph: `api.files` and `api.accountData` *are* server-side, and between them
  they cover the bulk records (files, per user) and a small shared value (account
  data, per account). **The customer's own server is the first home for these
  records**, not ours.
- The dedicated server is therefore **not** the first choice for storage. It is
  for what the host refuses — team-*writable* shared state, a scheduler,
  cross-user automation and integrations — and it is a **cloud feature** (hosted;
  self-hosting may follow), with an admin-set `configSchema` `secret` as its
  credential rather than a token kept in the browser.
- **Everything that needs no such storage keeps working with no server
  configured.** Follow-up tasks and project *milestones* are already real host
  tasks, so they stay free and server-side. The scan, review, merge, editor,
  profile, company profiles, groups, health, import/export, search, bulk actions,
  avatars, the guide and in-app help need nothing.
- **The paid boundary moves with it.** A feature whose data fits `api.files` or
  `api.accountData` needs no cloud tier at all and stays free; the cloud tier is
  for the work that genuinely needs a service. #68 carries the boundary table,
  which this correction narrows rather than widens.
- **No silent local fallback, and the cloud is an *option*.** If
  `api.host.features.files !== true` — an older webmail, or an admin who turned
  Files off — a feature that needs it becomes **unavailable** with a notice
  naming what is missing, and **the cloud tier is offered as the alternative**.
  `api.storage` is never used for a record: a record that quietly lives in one
  browser is the bug this whole decision exists to remove. That was the
  maintainer's call, and it is stricter than the "warn and keep working" reading
  it replaced.

### The storage seam (the enabling work)

Every store already reads and writes through `api.storage.get/set/remove`. The
seam puts **one** module in front of that, so a store never knows where its bytes
live and no feature has to be rewritten twice:

- **`src/lib/store.js`** — `read(api, key)` / `write(api, key, value)` /
  `remove(api, key)`, plus the one list that classifies a key as a **record**
  (server) or **view state** (local), and `recordsAvailable(api)`.
  **The phone `region` is a record**, by the maintainer's call, so it follows the
  user. The consequence to keep in mind: phone matching is a *free* feature and
  the region sharpens it, so with no server configured the region is unset and a
  nationally written number (`0176…`) stops matching its international spelling
  (`+49 176…`). That is the one place where this decision reaches into a feature
  that needs no storage.
- **`src/lib/remote.js`** — the server client, a key/value API over the host's
  `http:proxy` with the credential held by the host, so no secret ships in the
  ZIP.

The wire protocol (draft — `scope` is the workspace, defaulting to the user the
credential identifies):

    GET    /v1/store            -> { records: { key: value, … }, revision }
    GET    /v1/store/{key}      -> { key, value, revision } | 404
    PUT    /v1/store/{key}      <- { value } -> { revision }
    DELETE /v1/store/{key}      -> { ok: true }

With **no server configured**, a record read reports *unavailable* and the
feature that needs it says so. Nothing silently falls back to the browser: a
feature that quietly kept working on one device is the bug this decision exists
to remove.

**The server itself is in this repository**, in `fyrhaven-server/`: one
file with no dependencies (`node:http` + `node:sqlite`), a `Dockerfile`, a
`docker-compose.yml` with TLS at the edge (Caddy, automatic certificates) and its
own `node --test` suite. A **token is a workspace**, so one deployment serves
many customers without any of them reaching another's records, and `?scope=` is
the seam the team features (#23/#24) will widen. It is hosted by the maintainer
as a cloud feature; self-hosting may follow.

**Values are encrypted at rest.** Each workspace has its own 256-bit key
(AES-256-GCM, fresh IV per write); that key is stored wrapped by a master key
that lives in the server's environment and never in the database, so a stolen
file, volume or backup is opaque. **The limit, stated in the server's README
rather than implied away: the running server must unwrap a key to serve it, so
whoever operates the service can read the data.**

**The better home for these records is the customer's own server, and it is one
host change away.** Stalwart already implements **JMAP Metadata**
(`urn:ietf:params:jmap:metadata`) — a per-account key/value store with a *shared*
and a *private* root, containers, quotas and change tracking — but Bulwark does
not expose it to plugins, and a plugin has no other server-side write (see
`api.plugin.settings`, which is read-only). Issue **#68** carries the request,
with the Stalwart file paths as evidence. If it lands: the records move to the
customer's Stalwart, no cloud is needed for storage at all, and a key kept in the
*shared* section gives an org automatic access for everyone on its server while
the cloud operator cannot read a thing. The **record envelope is identical**
either way, so that is a key-location change, not a data migration.

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
cleanup with preview and undo, v1.18.0 avatars, v1.19.0 the Health dashboard, v1.20.0 the main page, v1.21.0 CSV/vCard import, v1.22.0 CSV/vCard export, v1.23.0 retention,
v1.24.0 search exclusion, v1.24.1 host downloads and the probe’s calendar
format, v1.24.2 the alert on a real failure and the page icon, v1.25.0 the
server client (#68, first step), v1.26.0 multi-select on the Health tab, v1.27.0
per-address-book duplicate policies and ignore rules (#7), v1.28.0 protected
fields per address book, v1.29.0 ignore rules by field, v1.30.0 a decision per
duplicate during import (#4, the per-group half), v1.31.0 the duplicate digest
(#5, re-scoped), v1.32.0 bulk merge by facet (#6), v1.33.0 smarter name matching
(#8), v1.34.0 contact groups (#12), v1.35.0 the normalisation rules engine (#20),
v1.36.0 the change history (#25, the local half), v1.37.0 the GDPR and consent
toolkit (#26, the local half), v1.38.0 smart lists — `OR`/grouping in the search
box and a saved search as a bulk scope (#34) — v1.39.0 the automation rules
engine (#33), v1.40.0 per-address-book roles (#23, the advisory half), v1.41.0
the first-run Getting started guide (#39, the onboarding half), v1.42.0 a paged
Contacts list (#39, the scale half), v1.43.0 smart lists in the command palette
(#13, the palette half), v1.44.0 in-app help and keyboard shortcuts (#39's help
bullet), v1.45.0 follow-up tasks (#36, the task-creation half) and v1.46.0
private notes (#38, the private half).

**Next: the v1.5.0 local halves, three done.** v1.5.0 was #22 (companies, v1.9.0),
#23 (shared books and roles — the *advisory* UI shipped in v1.40.0; enforced
permissions and a member list need #68), #24 (a shared review queue — needs #68),
#25 (the change history — the local half shipped in v1.36.0; a *shared* log needs
#68), #26 (consent records plus anonymise — the local half shipped in v1.37.0; a
*shared* consent store needs #68) and #27 (field-level masking). #34's AND/OR
composition shipped in v1.38.0, #33's engine in v1.39.0, #23's advisory half in
v1.40.0, #39's onboarding half in v1.41.0, #39's paging in v1.42.0, #13's palette
half in v1.43.0, #39's help + shortcuts in v1.44.0 — which **completes #39's three
bullets** for the buildable parts — #36's task-creation half in v1.45.0, #38's
private-notes half in v1.46.0, #36's cross-contact half in v1.47.0 and #38's
search half in v1.51.0. **Every *done when* of every issue that can be met
without the server tier is now met.** What is left is a named, smaller half
rather than a missing feature: the rest of #39's scale half (virtualised rows,
worker matching, incremental indexes) — low-yield now that paging bounds the DOM
— and per-contact task *completion history*. #24, #27, #26's shared half, #23's
enforced half, #38's shared half and #36's reminders need the server tier or a
timer hook. v1.4.0 is complete except **#18**, which needs message bodies —
`api.email` is optional and its shape is what #75 waits on. The one open *bug*,
#75, still waits on a line of console output from a live install.

> **v1.51.0 shipped** — #38's search half, so the last "clearly buildable"
> item on this list is done. **The next work is the #68 line**: stand the store
> up (the compose file and image are in `fyrhaven-server/`; TLS needs a
> DNS name pointed at the host and a proxy host in front of it), then switch the
> remaining record stores through the seam one at a time (policies, roles,
> automation rules, saved searches, import templates, normalisation rules — each
> claiming its local copy once), and — the better outcome — pursue the host
> request on #68 so the records can live on the customer's own Stalwart instead.

> **One inconsistency worth naming**: `savedSearches` is classified as a record
> in `src/lib/store.js`, but `readSaved`/`saveSearch`/`deleteSaved` still use
> `api.storage` directly — it is the one store that has not been moved through
> the seam. Moving it is a small, self-contained change (and the one a test
> asserting "every record key goes through `read`/`write`" would catch).

## GitHub Integration
- Repository: **zyntrax/bulwark-plugins** (private). The plugin lives in
  `fyrhaven-crm/`; there is no separate `bulwark-addons` repository.
- **Branches**: `main` is the release branch and carries the current version.
  `contact-manager` mirrors the plugin work and is kept in step with `main`.
  Feature branches are `feat/contact-manager-<feature>` and are merged into
  `main` through a PR. **Only `main` and `contact-manager` are long-lived** —
  a feature branch is deleted once its PR has landed, so the branch list stays
  short. Deleting one loses nothing: its commits are in `main` through the
  merge, and the PR keeps the discussion.
- **Roadmap**: https://github.com/zyntrax/bulwark-plugins/issues/40 is the
  single roadmap issue; it links every feature issue, and its checkboxes mirror
  the issues (ticked when closed). Milestones `Contact Manager v1.2.0` …
  `v2.0.0` group them — the titles are the originally planned releases (the
  plugin is at v1.43.0), so read them as phases and read each description for
  what has shipped and what remains.
- **Releases**: tagged `fyrhaven-crm-vX.Y.Z`; installable ZIPs are the
  release assets. The newest release is `fyrhaven-crm-v1.53.0`.
- **Cutting a release**: merge the feature PR(s) into `main`, keep
  `contact-manager` in step, bump `manifest.json`/`package.json` + `CHANGELOG.md`
  on `main`, then run `npm run release` — it tags, pushes the tag and uploads
  the ZIP. The script refuses to run when the manifest, package and top
  changelog versions disagree. `npm run ship` automates the merge, the mirror
  sync and the release.
- Ship a feature by closing its issue in the release commit/PR.