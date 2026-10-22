# Changelog

All notable changes to the **Contact Manager** plugin are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

The version in `manifest.json` is the single source of truth — the entry at the
top of this file must match it.

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
