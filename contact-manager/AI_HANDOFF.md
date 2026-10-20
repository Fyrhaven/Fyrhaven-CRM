# AI Handoff - Contact Manager Plugin

## Current State
- **Version**: 1.0.0 (manifest.json)
- **Last changes**: Merge duplicate window visual indicators enhancement
- **Files modified**:
  - `src/lib/preview.js` - Added formatPreview, previewSummary, previewTitle functions
  - `src/lib/review-dialog.js` - Enhanced ReviewDialog with green+/orange visual indicators, KeepSelector, DetailSectionHint

## Implementation Summary

### Merge Duplicate Window Visual Indicators
The review/merge dialog now displays clear visual indicators for what happens during a merge:

| Indicator | Meaning |
|-----------|---------|
| `+ value` (green) | **New information** being merged in from other contacts |
| Orange/▲ | Existing values being modified/changed |
| Normal display | Values kept from primary contact (as-is) |
| ⨉ | Values being removed/cleared |

### Key Functions Added

**`src/lib/preview.js`**:
- `formatPreview(added)` - Formats merge preview fields with type indicators
- `previewSummary(added)` - Generates summary string (kept/added/changed/removed counts)
- `previewTitle(added)` - Generates title based on number of added fields

**`src/lib/review-dialog.js`**:
- `ReviewDialog` - Main dialog component with preview header/summary, members list, field entries with visual indicators, and footer buttons
- `KeepSelector` - Radio button group to override the automatically chosen primary contact
- `DetailSectionHint` - "Review duplicates" button in contact detail sections

### string Keys (already in manifest.json locales en & de)
- `dialog.previewTitle`, `dialog.previewNote`, `dialog.addedFrom`
- `detail.found`, `dialog.review`, `group.*`, `settings.*`

### Testing
- Existing tests should pass (backward-compatible changes)
- No breaking changes to merge logic or data model
- String keys resolved from manifest.json

## Future Feature Suggestions (from user)

### Long-term Roadmap
1. **Inbox & Communication Intelligence** - Contacts interacting with inbox, timeline history, forgotten contacts, auto-enrichment from email signatures
2. **Organization & Smart Segmentation** - Dynamic folders, company grouping, VIP management
3. **Data Hygiene & Enrichment** - Health scoring, auto-normalization, avatar fetching, smart import/export
4. **Privacy, Security & Compliance** - External domain marking, sensitive info redaction, stale contact pruning
5. **Bulwark UI Integration Hooks** - Hover cards, composer integration, sidebar widgets
6. **Advanced Data Hygiene & Health Engine** - Contact health scoreboard, one-click normalization rules
7. **Power-User Workflow & UX Integrations** - Universal hover cards, composer quick-insert, private notes
8. **Smart Segmentation** - Dynamic/saved smart lists, custom tagging & color coding
9. **Security, Privacy & Native Sync** - Granular privacy controls, CardDAV/vCard 4.0 compatibility

## Versioning Policy
- Follows semantic versioning: MAJOR.MINOR.PATCH
- `manifest.json` version is the single source of truth
- `CHANGELOG.md` top entry must match `manifest.json` version
- Patch: Bug fixes, wording changes, internal refactors
- Minor: New features, new surfaces, new settings
- Major: Removing surfaces, settings, or permissions (announce first)

## Release Checklist
1. bump `version` in `manifest.json` (semver)
2. add `CHANGELOG.md` entry for that version (newest on top)
3. `npm test` - all tests green
4. `npm run package` - rebuild the ZIP
5. copy `manifest.json`, `dist/index.js` and `contact-manager.zip` into `build/contact-manager/`
6. commit source **and** artifacts together, tag the release

## Project Structure
```
contact-manager/
├── manifest.json          # id, version, permissions, settings schema, en+de strings
├── package.json           # scripts and dev dependencies
├── CHANGELOG.md           # user-facing history
├── README.md              # this documentation
├── vitest.config.mjs      # test config
├── src/
│   ├── index.js           # slots, hooks, activate() wiring
│   └── lib/
│       ├── contacts.js    # JSContact readers, loaders, settings flags
│       ├── duplicates.js  # detection (union-find), merge planning, merging
│       ├── labels.js      # shared display helpers and toasts
│       ├── manager-page.js # the Contact Manager page
│       ├── review-dialog.js # the review/merge dialog (UPDATED)
│       ├── detail-section.js# the duplicate hint in contact details
│       └── preview.js     # display shaping for the dialog (UPDATED)
├── test/
│   ├── fixtures.mjs       # card builders
│   ├── contacts.test.mjs  # readers, name/email/phone extraction
│   ├── duplicates.test.mjs # normalisation, keys, grouping
│   ├── merge.test.mjs     # merge planning and the merge run
│   ├── ui-page.test.mjs   # the manager page
│   ├── ui-dialog.test.mjs # the review dialog and detail section
│   └── bundle.test.mjs    # the built bundle + locale completeness
├── test-utils/
│   ├── fake-api.mjs       # recording fake of plugin host API
│   └── ui-kit.mjs         # stand-in for @plugin-host/ui
└── scripts/
    └── package.mjs        # builds contact-manager.zip
```

## How to Continue

1. **Run tests**: `cd contact-manager && npm test` (builds first, then runs vitest suite)
2. **Build package**: `npm run package` (creates contact-manager.zip)
3. **Update version**: bump `manifest.json` version and add CHANGELOG entry
4. **Commit**: source + artifacts into `build/contact-manager/`
5. **Github**: create release, update roadmap, add Todo if available

## GitHub Integration
- Repository: bulwark-plugins (zyntrax/bulwark-plugins)
- Use GitHub Projects/roadmap for planned features
- Consider GitHub Issues for tracking user requests
- Tag releases with version (e.g., `contact-manager-v1.0.0`)