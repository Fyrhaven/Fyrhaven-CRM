# Changelog — the Fyrhaven record server, self-hosted

Newest first. Versions continue the numbering this server has had since it lived
inside the plugin's repository; the cloud service is a separate repository with
its own history.

## [1.19.0] — 2026-11-16

### Changed

- **The cloud left this repository.** `cloud.js`, `accounts.js`, `catalog.js`,
  `payments.js`, `distribution.js`, `site/`, `scripts/dist.mjs` and `packaging/`
  are gone; the shop, the accounts, the catalogue, billing and the operator panel
  live in `Fyrhaven/Fyrhaven-CRM-Cloud` and are never distributed. This folder
  **is** the self-hosted server now, so there is nothing to stub out and no
  `FYRHAVEN_MODE` to honour.
- `server.js` keeps the record API, the auth, the licence gate and the storage
  seam's two admin routes; `openStore()` has no operator flag, and the cloud's
  tables are not created.
- `licence.js#startupLicence` requires `FYRHAVEN_LICENCE` and returns
  `{ ok, licence?, error? }` — there is no cloud mode to ask for.

### Added

- `GET/POST /v1/licence`, `POST /v1/licence/challenge` and
  `POST /v1/licence/deactivate` are served **here**: the customer's own server is
  what answers the plugin's *Server and licence* panel (fingerprint, paste a key,
  release this installation). They lived in `cloud.js` and were stubbed out of
  every self-hosted build, so the panel was dead on a self-hosted server.
- `npm run package` writes `dist/fyrhaven-server-<version>.tar.gz`, and
  `npm run release` tests, packages, tags `fyrhaven-server-vX.Y.Z` and attaches
  the archive to the GitHub release. The archive carries a `BUILD` file naming
  the version and commit, and the packaging script refuses to build if a cloud
  module is present.

### Kept

- The storage seam (#158): `sqlite` or an S3-compatible bucket, the read-back
  migration, and `GET /v1/admin/workspaces/{id}/storage` +
  `POST /v1/admin/workspaces/{id}/migrate` behind `STORE_ADMIN_TOKEN`.
- The record API unchanged: `GET /v1/store`, `GET/PUT/DELETE /v1/store/{key}`,
  `GET /health`, `GET /version`, scopes, quotas and encryption at rest.

### Removed

- The cloud's test suites, which went with the cloud. The record-API, licence and
  storage tests stayed; the suite is 50 tests with no dependencies.
