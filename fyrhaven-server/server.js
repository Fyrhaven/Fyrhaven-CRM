// The Contact Manager record server, self-hosted (#68).
//
// A record this plugin invents — a project, a private note, a consent record,
// the change history, a saved search — cannot live in a browser, and the
// Stalwart host has nowhere to put it. So it lives here: one small service in
// front of a SQLite file, speaking the four calls `src/lib/remote.js` makes.
//
//   GET    /v1/store        -> { records: { key: value, … }, revision }
//   GET    /v1/store/{key}  -> { key, value, revision } | 404
//   PUT    /v1/store/{key}  <- { value } -> { revision }
//   DELETE /v1/store/{key}  -> { ok: true }
//
// Plus `GET /version` (what the plugin's *Check the server* asks for) and
// `GET /health` (the container's healthcheck).
//
// **This is the self-hosted server, not the cloud service.** The shop, the
// customer accounts, the catalogue, billing and the operator panel are not in
// this repository at all — they live in `Fyrhaven/Fyrhaven-CRM-Cloud`, which is
// never distributed. Nothing here can be switched into that service: there is
// no mode flag, only the licence gate below.
//
// **No dependencies on purpose.** `node:http` and `node:sqlite` are enough, so
// the image is `node:24-alpine` plus these files — there is no lockfile to audit
// and nothing to install at build time.
//
// Tenancy: a **token is a workspace**. A token can only ever reach its own
// records, so a leaked token is one tenant's problem and never a cross-tenant
// read. The optional `scope` narrows within a workspace, which is the seam the
// team features (#23/#24) will widen; it is not a security boundary.
//
// The licence is checked **offline** at startup (`FYRHAVEN_LICENCE`), and the
// one operator surface that survives — where a workspace's bytes live (#158) —
// sits behind `STORE_ADMIN_TOKEN`.

import { createServer as createHttpServer } from 'node:http';
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { client as s3Client } from './s3.js';
import { backendFor, backendsFor, bumpWorkspaceRevision, migrateWorkspace, noteUsage, openStorageTable, providerOf, PROVIDERS, setProvider, storageRow } from './storage.js';

import { activateOnline, deactivationChallenge, describeLicence, ensureInstallKey, publicKeyOf, readChallenge, startupLicence, verifyDeactivation, verifyLicence } from './licence.js';

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/** The version the service reports — `package.json` is the single source of truth. */
export const VERSION = String(packageJson.version ?? '0.0.0');

/** The largest single record, in bytes. A project with time entries fits easily. */
export const MAX_VALUE_BYTES = 1024 * 1024;

/** The scope a request lands in when it names none. */
export const DEFAULT_SCOPE = 'default';

/** Storage keys are slugs: no slashes, no traversal, no surprises in a path. */
const KEY_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

// ── Encryption at rest ──────────────────────────────────────────
//
// **Nothing is stored as clear text.** Every value is sealed with its
// workspace's own 256-bit key (AES-256-GCM, a fresh IV per write), and that key
// is itself stored **wrapped** by a master key that lives in the server's
// environment and never in the database. A stolen database file, volume or
// backup is therefore opaque.
//
// What this does *not* do: the running server must unwrap a workspace's key in
// order to serve it, so **whoever operates this service can read the data**. That
// is a deliberate, documented limit of a server-held key — see README, "What this
// protects and what it does not". A workspace whose operator must not be able to
// read it needs the key held by the customer instead.

/** `v1.<iv>.<tag>.<ciphertext>`, each part base64 — one shape for every sealed blob. */
const SEAL_PREFIX = 'v1';

const b64 = (buffer) => Buffer.from(buffer).toString('base64');

/** Seals a string with a 32-byte key. A fresh random IV every time, so equal values differ. */
export function seal(key, plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return [SEAL_PREFIX, b64(iv), b64(cipher.getAuthTag()), b64(ciphertext)].join('.');
}

/** Opens a sealed string. Throws when the key is wrong or the blob was tampered with. */
export function open(key, sealed) {
  const parts = String(sealed ?? '').split('.');
  if (parts.length !== 4 || parts[0] !== SEAL_PREFIX) throw new Error('not a sealed value');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64'));
  decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8');
}

/** Reads the master key from its environment variable. Refuses anything but 32 bytes. */
export function parseMasterKey(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  let key;
  try {
    key = Buffer.from(text, 'base64');
  } catch {
    return null;
  }
  return key.length === 32 ? key : null;
}

/** A constant-time comparison, so a token cannot be discovered one byte at a time. */
function sameToken(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * The `token=workspace,…` list as a Map. A token written on its own is its own
 * workspace, so the single-tenant case is `STORE_TOKENS=<random string>`.
 */
export function parseTokens(value) {
  const tokens = new Map();
  for (const part of String(value ?? '').split(',')) {
    const entry = part.trim();
    if (!entry) continue;
    const [token, workspace] = entry.split('=');
    const name = String(token ?? '').trim();
    if (!name) continue;
    tokens.set(name, String(workspace ?? '').trim() || name);
  }
  return tokens;
}

/**
 * The token a request carries.
 *
 * The **header** is the only way in by default. `?token=` exists for a host that
 * genuinely cannot set one, and is **off unless asked for** (`ALLOW_QUERY_TOKEN`)
 * because a token in a URL ends up in access logs, proxy logs, browser history
 * and `Referer` headers — a leak that no amount of TLS prevents.
 */
/**
 * HTTP Basic, the way a self-hosted server is protected (#148).
 *
 * A token is right for a service you sign up to; a username and password are
 * right for a machine you own, and they are what the plugin can hold through the
 * host's credential store. Checked only when both are configured, so a store
 * without them behaves exactly as before.
 */
function basicOf(req, { user = '', password = '' } = {}) {
  if (!user || !password) return false;
  const header = String(req.headers?.authorization ?? '');
  if (!header.toLowerCase().startsWith('basic ')) return false;
  let decoded = '';
  try {
    decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
  } catch {
    return false;
  }
  const index = decoded.indexOf(':');
  if (index < 0) return false;
  // Constant time on both halves, so neither can be found a byte at a time.
  return sameToken(user, decoded.slice(0, index)) && sameToken(password, decoded.slice(index + 1));
}

function tokenOf(req, url, { allowQueryToken = false } = {}) {
  const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers?.authorization ?? '').trim());
  if (bearer) return bearer[1].trim();
  if (!allowQueryToken) return '';
  return String(url.searchParams.get('token') ?? '').trim();
}

/** Opens (and migrates) the SQLite file. `:memory:` is for the tests. */
export function openStore(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      workspace TEXT NOT NULL,
      scope     TEXT NOT NULL,
      key       TEXT NOT NULL,
      value     TEXT NOT NULL,
      updated   TEXT NOT NULL,
      PRIMARY KEY (workspace, scope, key)
    );
    CREATE TABLE IF NOT EXISTS counter (
      id       INTEGER PRIMARY KEY CHECK (id = 1),
      revision INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO counter (id, revision) VALUES (1, 0);
    CREATE TABLE IF NOT EXISTS workspaces (
      workspace   TEXT PRIMARY KEY,
      wrapped_key TEXT NOT NULL,
      created     TEXT NOT NULL
    );
  `);
  // Where a workspace's bytes live (#158). The columns are added to an existing
  // table when they are missing, so a deployed store upgrades in place.
  openStorageTable(db);
  return db;
}

/**
 * Each workspace's data key, created on first use and kept **wrapped** by the
 * master key. The plain key exists only in memory while the server is running.
 */
export function workspaceKeys(db, masterKey) {
  const cache = new Map();
  return {
    /** The 32-byte key for a workspace, creating and wrapping one when it is new. */
    get(workspace) {
      const cached = cache.get(workspace);
      if (cached) return cached;
      const row = db.prepare('SELECT wrapped_key FROM workspaces WHERE workspace = ?').get(workspace);
      let key;
      if (row) {
        key = Buffer.from(open(masterKey, row.wrapped_key), 'base64');
      } else {
        key = randomBytes(32);
        db.prepare('INSERT INTO workspaces (workspace, wrapped_key, created) VALUES (?, ?, ?)')
          .run(workspace, seal(masterKey, b64(key)), new Date().toISOString());
      }
      cache.set(workspace, key);
      return key;
    },
  };
}

/**
 * The four store operations, over one open database **or** a bucket (#158).
 *
 * `revision` is bumped by every write, so a client can tell "something changed"
 * without diffing — and a future sync can ask for everything above the revision
 * it last saw. A workspace on blob storage keeps its own counter, seeded with the
 * global one when it moves, so the number a client holds never goes backwards.
 *
 * The payload is sealed here, in one place, and the backend only ever sees
 * ciphertext: moving a workspace to a bucket moves the envelope, not the
 * encryption.
 */
export function storeOps(db, keys, { s3 = null, now = () => Date.now() } = {}) {
  const adapters = backendsFor(db, { s3 });
  const revision = () => db.prepare('SELECT revision FROM counter WHERE id = 1').get().revision;
  const bump = () => {
    db.prepare('UPDATE counter SET revision = revision + 1 WHERE id = 1').run();
    return revision();
  };
  const backendOf = (workspace) => backendFor(db, workspace, adapters);
  return {
    /** The revision a workspace's client should compare with. */
    revision(workspace) {
      const global = revision();
      if (!workspace) return global;
      const row = storageRow(db, workspace);
      return row.provider === 'sqlite' ? global : Math.max(global, row.revision);
    },
    async list(workspace, scope) {
      const objects = await backendOf(workspace).list(workspace, scope);
      const records = {};
      // A row that will not open means the key changed or the file was tampered
      // with: fail loudly rather than serve a hole in the data.
      for (const [key, sealed] of objects) records[key] = JSON.parse(open(keys.get(workspace), sealed));
      return records;
    },
    async get(workspace, scope, key) {
      const sealed = await backendOf(workspace).get(workspace, scope, key);
      return sealed === null ? null : JSON.parse(open(keys.get(workspace), sealed));
    },
    async put(workspace, scope, key, value) {
      const backend = backendOf(workspace);
      const previous = await backend.get(workspace, scope, key);
      const sealed = seal(keys.get(workspace), JSON.stringify(value));
      await backend.put(workspace, scope, key, sealed);
      noteUsage(db, workspace, {
        records: previous === null ? 1 : 0,
        bytes: Buffer.byteLength(sealed) - (previous === null ? 0 : Buffer.byteLength(previous)),
        now,
      });
      bumpWorkspaceRevision(db, workspace, { now });
      return bump();
    },
    async remove(workspace, scope, key) {
      const backend = backendOf(workspace);
      const previous = await backend.get(workspace, scope, key);
      const removed = await backend.remove(workspace, scope, key);
      if (removed) {
        noteUsage(db, workspace, {
          records: previous === null ? 0 : -1,
          bytes: previous === null ? 0 : -Buffer.byteLength(previous),
          now,
        });
        bumpWorkspaceRevision(db, workspace, { now });
        bump();
      }
      return removed;
    },
    /**
     * Records and bytes. A SQLite workspace is counted from its rows; a
     * blob-backed one uses the counters every write maintains, so a save does not
     * pay for a bucket listing. `recount` is the check that those counters are
     * still true.
     */
    async usage(workspace) {
      const provider = providerOf(db, workspace);
      const backend = backendFor(db, workspace, adapters, provider);
      if (provider === 'sqlite') return backend.usage(workspace);
      const row = storageRow(db, workspace);
      return { records: row.objects, bytes: row.bytes };
    },
    /** Recounts from the backend and repairs the counters — the operator's check. */
    async recount(workspace) {
      const provider = providerOf(db, workspace);
      const used = await backendFor(db, workspace, adapters, provider).usage(workspace);
      if (provider !== 'sqlite') {
        db.prepare('UPDATE workspace_storage SET objects = ?, bytes = ?, updated = ? WHERE workspace = ?')
          .run(used.records, used.bytes, new Date(now()).toISOString(), workspace);
      }
      return used;
    },
    /**
     * Removes a workspace's objects from the bucket when an account is erased.
     *
     * SQLite rows are deleted with one statement by the caller; a bucket needs a
     * call per object. A backend that cannot be reached is reported, never
     * assumed: "the key is gone so the bytes are unreadable" is true, but it is
     * not the same as having deleted them.
     */
    async erase(workspace) {
      const provider = providerOf(db, workspace);
      if (provider === 'sqlite') {
        db.prepare('DELETE FROM workspace_storage WHERE workspace = ?').run(workspace);
        return { removed: 0, unreachable: false };
      }
      let backend;
      try {
        backend = backendFor(db, workspace, adapters, provider);
      } catch {
        db.prepare('DELETE FROM workspace_storage WHERE workspace = ?').run(workspace);
        return { removed: 0, unreachable: true };
      }
      let removed = 0;
      try {
        for (const scope of await backend.scopes(workspace)) {
          for (const key of (await backend.list(workspace, scope)).keys()) {
            await backend.remove(workspace, scope, key);
            removed += 1;
          }
        }
      } catch {
        // The account is being deleted either way; the operator is told the bucket
        // needs a look rather than the request failing halfway.
        return { removed, unreachable: true };
      } finally {
        db.prepare('DELETE FROM workspace_storage WHERE workspace = ?').run(workspace);
      }
      return { removed, unreachable: false };
    },
    /** The providers this process can reach. `sqlite` always, `s3` when configured. */
    get available() {
      return Object.keys(adapters);
    },
    provider(workspace) {
      return providerOf(db, workspace);
    },
    /**
     * Moves a workspace to another backend (#158). The order — copy, read back,
     * flip, only then delete — lives in `migrateWorkspace`; what stays here is the
     * provider row and the revision it is seeded with, so a client's number never
     * goes backwards when its workspace changes house.
     */
    async migrate(workspace, target) {
      if (!PROVIDERS.includes(target)) {
        return { ok: false, status: 400, reason: `unknown provider "${target}"`, available: Object.keys(adapters) };
      }
      const to = adapters[target];
      if (!to) {
        return { ok: false, status: 501, reason: `no storage adapter for "${target}" is configured`, available: Object.keys(adapters) };
      }
      const from = providerOf(db, workspace);
      if (from === target) {
        const used = await to.usage(workspace);
        return { ok: true, status: 200, provider: target, moved: false, objects: used.records, bytes: used.bytes };
      }
      const result = await migrateWorkspace({
        from: backendFor(db, workspace, adapters),
        to,
        workspace,
        flip: ({ objects, bytes }) => setProvider(db, workspace, target, {
          revision: Math.max(revision(), storageRow(db, workspace).revision),
          objects,
          bytes,
          now,
        }),
        now,
      });
      if (!result.ok) {
        return { ok: false, status: 502, reason: result.reason, provider: from, objects: result.objects, bytes: result.bytes };
      }
      return {
        ok: true, status: 200, provider: target, moved: true,
        objects: result.objects, bytes: result.bytes, leftBehind: result.leftBehind,
      };
    },
  };
}

// ── HTTP ────────────────────────────────────────────────────────

const send = (res, status, body) => {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    // The edge sets HSTS too, but the app should not depend on being behind one.
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
  });
  res.end(text);
};

/** Reads the body, refusing anything past the cap rather than buffering it. */
function readBody(req, limit = MAX_VALUE_BYTES + 4096) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('too large'), { tooLarge: true }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * The request handler, as a plain function so a test can drive the real HTTP
 * path without a socket if it wants to.
 *
 * `/health` and `/version` are deliberately **open**: the plugin's *Check the
 * server* has to answer before a credential is configured, and neither reveals
 * anything but a version string. Everything under `/v1/store` needs a token.
 */
export function createRequestHandler(db, {
  tokens = new Map(), keys, allowQueryToken = false,
  requestsPerMinute = 240, maxRecords = 5000, maxBytes = 64 * 1024 * 1024, now = () => Date.now(),
  adminToken = '', basicUser = '', basicPassword = '', s3 = null,
  licence = { ok: false }, licencePublic = publicKeyOf(),
  installKey = process.env.FYRHAVEN_INSTALL_KEY ?? '',
  licenceFile = process.env.FYRHAVEN_LICENCE_FILE ?? '/data/licence.key',
} = {}) {
  const ops = storeOps(db, keys, { s3, now });
  // The licence this process is running under, and the one challenge it has
  // minted and not yet spent. Both change at runtime: a key can be pasted in,
  // and a released installation forgets its own.
  let current = licence;
  let pendingChallenge = '';

  /**
   * Who is asking. A **workspace token** from `STORE_TOKENS` is a workspace; a
   * server with a password set also accepts that password, because it is what
   * the plugin can hold through the host's credential store.
   */
  const authenticate = (req, url) => {
    // A server with a password set answers to that password; the plugin holds
    // it like any other credential, so a stranger without it gets 401.
    if (basicUser && basicPassword && basicOf(req, { user: basicUser, password: basicPassword })) {
      return { workspace: 'basic', token: 'basic' };
    }
    const presented = tokenOf(req, url, { allowQueryToken });
    if (!presented) return null;
    for (const [token, workspace] of tokens) {
      if (sameToken(token, presented)) {
        return { workspace, token: presented };
      }
    }
    return null;
  };

  /** Records and bytes a workspace holds — the usage line and the quota. */
  const usageOf = async (workspace) => ({
    ...(await ops.usage(workspace)),
    maxRecords,
    maxBytes,
  });

  // One bucket per token, refilled every minute. Cheap, in memory, and enough to
  // stop a script; the host's own proxy also rate-limits.
  const buckets = new Map();
  const tooMany = (who) => {
    const minute = Math.floor(now() / 60_000);
    const entry = buckets.get(who);
    if (!entry || entry.minute !== minute) {
      buckets.set(who, { minute, count: 1 });
      return false;
    }
    entry.count += 1;
    return entry.count > requestsPerMinute;
  };

  /**
   * The operator's storage control (#158) — the one surface that is neither the
   * record API nor part of a customer's use of it.
   *
   * It is guarded by `STORE_ADMIN_TOKEN`: answers **503** until one is set (an
   * admin surface that comes up open on a fresh install is worse than one that
   * has to be enabled), **401** to a request that does not present it.
   */
  const adminRoute = async ({ req, res, url, path, method }) => {
    if (!adminToken) return send(res, 503, { error: 'no admin token configured' });
    const presented = tokenOf(req, url, { allowQueryToken });
    if (!presented || !sameToken(adminToken, presented)) return send(res, 401, { error: 'unauthorized' });
    if (tooMany('admin')) return send(res, 429, { error: 'too many requests' });

    const body = async () => {
      try {
        return JSON.parse(await readBody(req));
      } catch {
        return null;
      }
    };

    // Where a workspace's bytes live (#158). `sqlite` is always available and
    // `s3` appears once a bucket is configured, so a caller is offered only what
    // this process can actually reach.
    const storageRoute = /^\/v1\/admin\/workspaces\/([^/]+)\/storage$/.exec(path);
    if (storageRoute && method === 'GET') {
      const workspace = decodeURIComponent(storageRoute[1]);
      const provider = ops.provider(workspace);
      let used = { records: 0, bytes: 0 };
      let reachable = true;
      try {
        // `?fresh=1` recounts from the bucket; the default reads the counters
        // every write maintains, so an operator can check them without paying
        // for a listing on every page view.
        used = url.searchParams.get('fresh') === '1'
          ? await ops.recount(workspace)
          : await ops.usage(workspace);
      } catch (err) {
        // A workspace on a bucket this process cannot reach has no count, and
        // saying "0 objects" would read as "empty" rather than "unreachable".
        if (!err?.unavailable) throw err;
        reachable = false;
      }
      return send(res, 200, {
        ok: true,
        workspace,
        provider,
        available: ops.available,
        reachable,
        objects: used.records,
        bytes: used.bytes,
      });
    }

    const migrateRoute = /^\/v1\/admin\/workspaces\/([^/]+)\/migrate$/.exec(path);
    if (migrateRoute && method === 'POST') {
      const workspace = decodeURIComponent(migrateRoute[1]);
      const payload = (await body()) ?? {};
      const target = String(payload.provider ?? '').trim();
      const dry = url.searchParams.get('dry') === '1';

      if (dry) {
        const used = await usageOf(workspace);
        return send(res, 200, {
          ok: true, dry: true, workspace, target,
          provider: ops.provider(workspace), available: ops.available,
          objects: used.records, bytes: used.bytes,
        });
      }

      // Copy, READ BACK AND COMPARE, flip the provider row, and only then delete
      // the old copies. Deleting first is how a migration loses a customer's
      // data when the copy was silently truncated — the order lives in
      // `storage.js`, where no route can skip it.
      const moved = await ops.migrate(workspace, target);
      if (!moved.ok) {
        return send(res, moved.status, {
          ok: false,
          workspace,
          provider: ops.provider(workspace),
          available: ops.available,
          objects: moved.objects,
          bytes: moved.bytes,
          error: moved.reason,
        });
      }
      return send(res, 200, {
        ok: true,
        workspace,
        provider: moved.provider,
        moved: moved.moved,
        objects: moved.objects,
        bytes: moved.bytes,
        leftBehind: moved.leftBehind ?? [],
      });
    }

    return send(res, 404, { error: 'not found' });
  };

  /**
   * The licence this server runs under (#148) — its own state, not a
   * workspace's: one server, one key, one installation.
   *
   * A plugin that only holds a workspace token can still read the fingerprint
   * to take to the website, paste a key in, and spend a release code. Whether a
   * key is acceptable is decided here; the plugin only carries the text.
   */
  const licenceRoute = async ({ req, res, path, method }) => {
    const readJson = async () => {
      try {
        return JSON.parse(await readBody(req));
      } catch {
        return null;
      }
    };

    if (path === '/v1/licence' && method === 'GET') {
      return send(res, 200, {
        ok: true,
        mode: 'selfhosted',
        fingerprint: installKey,
        licensed: Boolean(current.licence),
        licence: current.licence ?? null,
        summary: describeLicence(current.licence ?? null),
      });
    }

    if (path === '/v1/licence' && method === 'POST') {
      const payload = (await readJson()) ?? {};
      const key = String(payload.licence ?? '').trim();
      const check = verifyLicence(key, { publicKey: licencePublic, fingerprint: installKey, now: now() });
      if (!check.ok) return send(res, 400, { error: `that licence was not accepted (${check.reason})` });
      process.env.FYRHAVEN_LICENCE = key;
      let stored = false;
      try {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(licenceFile, `${key}\n`, { mode: 0o600 });
        stored = true;
      } catch {
        // an unwritable volume still runs with the key in memory
      }
      current = { ok: true, licence: { ...check.payload, daysLeft: check.daysLeft } };
      return send(res, 200, {
        ok: true, stored, fingerprint: installKey,
        licence: check.payload, summary: describeLicence(check.payload), daysLeft: check.daysLeft,
      });
    }

    if (path === '/v1/licence/challenge' && method === 'POST') {
      // A challenge names this installation and a one-time nonce, and only the
      // seller can sign the release that spends it — so a copied key cannot walk
      // away from its server.
      const challenge = deactivationChallenge(installKey, { now: now() });
      pendingChallenge = readChallenge(challenge)?.nonce ?? '';
      return send(res, 200, { ok: true, fingerprint: installKey, challenge });
    }

    if (path === '/v1/licence/deactivate' && method === 'POST') {
      if (!pendingChallenge) return send(res, 409, { error: 'ask for a challenge first' });
      const payload = (await readJson()) ?? {};
      const checked = verifyDeactivation(String(payload.code ?? ''), {
        publicKey: licencePublic, fingerprint: installKey, nonce: pendingChallenge, now: now(),
      });
      if (!checked.ok) return send(res, 400, { error: `the deactivation code was not accepted (${checked.reason})` });
      pendingChallenge = '';
      process.env.FYRHAVEN_LICENCE = '';
      current = { ok: false };
      try {
        const { rmSync } = await import('node:fs');
        rmSync(licenceFile, { force: true });
      } catch {
        // nothing cached
      }
      return send(res, 200, { ok: true, deactivated: true, note: 'restart to run unlicensed, or paste a new key' });
    }

    if (path.startsWith('/v1/licence/')) return send(res, 404, { error: 'not found' });
    return send(res, 405, { error: 'method not allowed' });
  };

  return async function handle(req, res) {
    let url;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      return send(res, 400, { error: 'bad request' });
    }
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method ?? 'GET';

    if (method === 'GET' && (path === '/health' || path === '/version')) {
      return send(res, 200, { ok: true, version: VERSION });
    }

    try {
      // The operator's own storage control, before a workspace token: it takes
      // the admin token, not a customer's.
      if (path === '/v1/admin' || path.startsWith('/v1/admin/')) {
        await adminRoute({ req, res, url, path, method });
        return;
      }

      // ── Everything below needs a token ─────────────────────────────────
      const who = authenticate(req, url);
      if (!who) return send(res, 401, { error: 'unauthorized' });
      if (tooMany(who.token)) return send(res, 429, { error: 'too many requests' });

      // The server's own licence — one per installation, so it is not scoped to
      // a workspace. It needs a token like everything else, so a stranger
      // cannot mint challenges against this installation.
      if (path === '/v1/licence' || path.startsWith('/v1/licence/')) {
        await licenceRoute({ req, res, path, method });
        return;
      }

      const workspace = who.workspace;
      const scope = String(url.searchParams.get('scope') ?? '').trim() || DEFAULT_SCOPE;

      if (path === '/v1/store') {
        if (method !== 'GET') return send(res, 405, { error: 'method not allowed' });
        const records = await ops.list(workspace, scope);
        return send(res, 200, { records, revision: ops.revision(workspace) });
      }

      const match = /^\/v1\/store\/([^/]+)$/.exec(path);
      if (!match) return send(res, 404, { error: 'not found' });

      let key;
      try {
        key = decodeURIComponent(match[1]);
      } catch {
        return send(res, 400, { error: 'bad key' });
      }
      if (!KEY_PATTERN.test(key)) return send(res, 400, { error: 'bad key' });

      if (method === 'GET') {
        const value = await ops.get(workspace, scope, key);
        if (value === null) return send(res, 404, { error: 'no such record' });
        return send(res, 200, { key, value, revision: ops.revision(workspace) });
      }

      if (method === 'PUT') {
        const raw = await readBody(req);
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return send(res, 400, { error: 'body is not JSON' });
        }
        if (!parsed || typeof parsed !== 'object' || !('value' in parsed)) {
          return send(res, 400, { error: 'body needs a value' });
        }
        const encoded = JSON.stringify(parsed.value);
        const size = Buffer.byteLength(encoded);
        if (size > MAX_VALUE_BYTES) return send(res, 413, { error: 'too large' });

        // Quota: a workspace has a record count and a byte budget, so one
        // account cannot fill the disk. Rewriting a record only costs the delta.
        const usage = await usageOf(workspace);
        const previous = await ops.get(workspace, scope, key);
        const previousBytes = previous === null ? 0 : Buffer.byteLength(JSON.stringify(previous));
        if (previous === null && usage.records >= maxRecords) {
          return send(res, 409, { error: 'record limit reached', usage });
        }
        if (usage.bytes - previousBytes + size > maxBytes) {
          return send(res, 409, { error: 'storage limit reached', usage });
        }
        return send(res, 200, { revision: await ops.put(workspace, scope, key, parsed.value) });
      }

      if (method === 'DELETE') {
        await ops.remove(workspace, scope, key);
        return send(res, 200, { ok: true });
      }

      return send(res, 405, { error: 'method not allowed' });
    } catch (err) {
      if (err?.tooLarge) return send(res, 413, { error: 'too large' });
      // A workspace whose bytes live somewhere this process cannot reach must say
      // so. An empty answer would look like an empty address book.
      if (err?.unavailable) {
        return send(res, 503, {
          error: `this workspace lives on ${err.provider}, which is not configured on this server`,
          provider: err.provider,
        });
      }
      return send(res, 500, { error: 'server error' });
    }
  };
}

/** A listening server over its own database, for `main` and for the tests. */
export function createStoreServer({
  dbPath = ':memory:', tokenList = '', masterKey, allowQueryToken = false,
  now, adminToken = '', basicUser = '', basicPassword = '', s3 = null,
  licence, licencePublic, installKey, licenceFile,
} = {}) {
  const db = openStore(dbPath);
  const tokens = parseTokens(tokenList);
  const keys = workspaceKeys(db, masterKey);
  const server = createHttpServer(createRequestHandler(db, {
    tokens, keys, allowQueryToken, now, adminToken, basicUser, basicPassword, s3,
    ...(licence === undefined ? {} : { licence }),
    ...(licencePublic === undefined ? {} : { licencePublic }),
    ...(installKey === undefined ? {} : { installKey }),
    ...(licenceFile === undefined ? {} : { licenceFile }),
  }));
  server.on('close', () => {
    try {
      db.close();
    } catch {
      // already closed
    }
  });
  return { server, db, tokens };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const port = Number(process.env.PORT ?? 8080);
  const dbPath = process.env.STORE_DB ?? '/data/store.sqlite';
  const tokenList = process.env.STORE_TOKENS ?? '';
  const masterKey = parseMasterKey(process.env.STORE_MASTER_KEY);
  // Both of these are "the container must not come up half-safe" checks: an open
  // store serves everyone, and a store whose master key is missing or the wrong
  // length would either refuse to open the data or be trivially guessable.
  if (!parseTokens(tokenList).size) {
    console.error('STORE_TOKENS is empty — set at least one token (token=workspace).');
    process.exit(1);
  }
  if (!masterKey) {
    console.error('STORE_MASTER_KEY must be 32 bytes, base64 — generate with: openssl rand -base64 32');
    process.exit(1);
  }
  const allowQueryToken = process.env.ALLOW_QUERY_TOKEN === '1';
  if (allowQueryToken) {
    console.warn('ALLOW_QUERY_TOKEN=1 — tokens may appear in URLs and therefore in logs. Prefer a header.');
  }
  // The licence (#148): a self-hosted install must present a key it can verify
  // offline. There is no other mode — the cloud service is a different
  // repository, and this build has no switch that could become it.
  //
  // The installation's own key (#148). It is what a licence binds to, so it is
  // created once and kept on the volume — a recreated container must keep it or
  // every restart would invalidate the licence.
  const installKey = ensureInstallKey(process.env.FYRHAVEN_INSTALL_KEY_FILE ?? '/data/install.key');
  process.env.FYRHAVEN_INSTALL_KEY = installKey;
  console.log(`Fyrhaven: installation ${installKey}`);

  // Online activation is an *option*: with a URL and an account token the server
  // fetches a key bound to this installation and caches it; without them the
  // operator pastes a key in FYRHAVEN_LICENCE. Both paths are the same check.
  if (String(process.env.FYRHAVEN_ACTIVATION ?? '') === 'online') {
    const activated = await activateOnline({
      url: process.env.FYRHAVEN_ACTIVATION_URL ?? '',
      token: process.env.FYRHAVEN_ACTIVATION_TOKEN ?? '',
      fingerprint: installKey,
    });
    if (activated.status === 'ok') {
      const check = verifyLicence(activated.licence, {
        publicKey: publicKeyOf(process.env), fingerprint: installKey,
      });
      if (check.ok) {
        process.env.FYRHAVEN_LICENCE = activated.licence;
        try {
          const { writeFileSync } = await import('node:fs');
          writeFileSync(process.env.FYRHAVEN_LICENCE_FILE ?? '/data/licence.key', `${activated.licence}\n`, { mode: 0o600 });
        } catch {
          // a read-only volume still runs with the key in memory
        }
        console.log(`Fyrhaven: activated online — ${describeLicence(check.payload)}`);
      } else {
        console.error(`Fyrhaven: online activation returned an unusable key (${check.reason})`);
      }
    } else {
      console.error(`Fyrhaven: online activation failed (${activated.reason ?? activated.status}) — falling back to FYRHAVEN_LICENCE`);
    }
  }

  const licence = startupLicence(process.env);
  if (!licence.ok) {
    console.error(`Fyrhaven: ${licence.error}`);
    console.error('This server needs FYRHAVEN_LICENCE — the key Fyrhaven signed for this installation,');
    console.error('bound to the installation key printed above. It is verified offline; see LICENSING.md.');
    process.exit(1);
  }
  console.log(`Fyrhaven: licensed${licence.licence ? ` — ${describeLicence(licence.licence)}` : ''}`);

  const adminToken = String(process.env.STORE_ADMIN_TOKEN ?? '').trim();
  // The storage routes are the only operator surface here, and they are off
  // until a token is set — an admin surface that comes up open on a fresh
  // install is worse than one that has to be enabled.
  if (!adminToken) {
    console.warn('STORE_ADMIN_TOKEN is not set — /v1/admin answers 503, so a workspace cannot be moved to blob storage.');
  }
  // The bucket, when one is configured (#158). `R2_S3_API` already ends in the
  // bucket path, so it is used exactly as given. Without all three parts the
  // service simply offers `sqlite` and a migration to `s3` answers 501 — it does
  // not half-work.
  const bucket = String(process.env.R2_S3_API ?? '').trim();
  const bucketKey = String(process.env.R2_ACCESS_KEY_ID ?? '').trim();
  const bucketSecret = String(process.env.R2_SECRET_ACCESS_KEY ?? '');
  let bucketClient = null;
  if (bucket && bucketKey && bucketSecret) {
    bucketClient = s3Client({ base: bucket, accessKeyId: bucketKey, secretKey: bucketSecret });
    console.log(`Fyrhaven: blob storage offered at ${bucket}`);
  } else if (bucket || bucketKey || bucketSecret) {
    console.warn('Fyrhaven: R2_S3_API, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must all be set — blob storage is off.');
  }

  const { server, tokens } = createStoreServer({
    dbPath, tokenList, masterKey, allowQueryToken, adminToken,
    s3: bucketClient, licence, installKey,
    basicUser: String(process.env.STORE_AUTH_USER ?? '').trim(),
    basicPassword: String(process.env.STORE_AUTH_PASSWORD ?? ''),
  });
  server.listen(port, () => {
    console.log(`fyrhaven-server v${VERSION} listening on :${port} — ${tokens.size} token(s), db ${dbPath}, values encrypted at rest`);
    console.log('Fyrhaven: record API only — no shop, no accounts, no billing, no panel');
  });
}
