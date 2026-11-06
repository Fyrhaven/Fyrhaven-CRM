## What this changes

<!-- The behaviour before, and the behaviour after. A reviewer should be able to
     tell whether it is right without opening the diff. -->

## Why

<!-- The issue it closes, and the thing that made you open it. -->

## Definition of done

The full list is in [`.clinerules`](.clinerules); these are the ones that go wrong.

- [ ] `cd fyrhaven-crm && npm test` passes — the whole suite, plus any new test
- [ ] New behaviour has a test whose name says what the behaviour **is**, not how it is built
- [ ] New strings exist in `en` **and** `de` in `manifest.json`
- [ ] `npm run package` produces a ZIP whose root holds `manifest.json` and `index.js`
- [ ] `version` bumped in `manifest.json`, with a matching `CHANGELOG.md` entry — if behaviour changed
- [ ] No new runtime dependencies; no optional host API called without `optionalCall`
- [ ] No contact deleted before its data is written, and no merge outside the review dialog
