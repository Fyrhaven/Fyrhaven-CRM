// The Contact Manager cloud store (#68).
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
// **No dependencies on purpose.** `node:http` and `node:sqlite` are enough, so
// the image is `node:24-alpine` plus this file — there is no lockfile to audit
// and nothing to install at build time.
//
// Tenancy: a **token is a workspace**. A token can only ever reach its own
// records, so a leaked token is one tenant's problem and never a cross-tenant
// read. The optional `scope` narrows within a workspace, which is the seam the
// team features (#23/#24) will widen; it is not a security boundary.

import { createServer as createHttpServer } from 'node:http';
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { accountOps, accountWorkspace, DEFAULT_TRIAL_DAYS, openAccountTables } from './accounts.js';
import { paymentConfig } from './payments.js';
import { catalogOps, defaultCatalogue, openCatalogTables } from './catalog.js';
import { DISTRIBUTION, surfaceFor } from './distribution.js';
import { cloudRoute } from './cloud.js';
import { client as s3Client } from './s3.js';
import { backendFor, backendsFor, bumpWorkspaceRevision, migrateWorkspace, noteUsage, openStorageTable, providerOf, PROVIDERS, setProvider, storageRow } from './storage.js';

import { activateOnline, describeLicence, ensureInstallKey, licencePayload, loadPrivateKey, publicKeyOf, signLicence, startupLicence, verifyLicence } from './licence.js';

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
export function openStore(path = ':memory:', { operator = true } = {}) {
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
  // Accounts, the shop and what is for sale are the **cloud's** tables. A
  // self-hosted build never creates them, so its database has no customer
  // accounts and no price list in it at all.
  if (operator) {
    // Safe on an existing database: every statement is IF NOT EXISTS, so a store
    // that predates accounts opens unchanged.
    openAccountTables(db);
    // Seeded once, then owned by the operator's panel.
    openCatalogTables(db);
    const seeded = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
    if (!seeded) {
      const catalogue = catalogOps(db);
      for (const product of defaultCatalogue()) catalogue.save(product);
    }
  }
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

/** The pages the service itself serves (#148). No build step, no bundler. */
const SITE_FILES = {
  '/': 'index.html', '/index.html': 'index.html', '/site.js': 'site.js', '/site.css': 'site.css',
  '/admin': 'admin.html', '/admin.js': 'admin.js',
  '/favicon.svg': 'favicon.svg', '/banner.svg': 'banner.svg', '/banner.png': 'banner.png',
  '/terms': 'terms.html', '/privacy': 'privacy.html', '/imprint': 'imprint.html',
  '/changelog': 'changelog.html',
  '/robots.txt': 'robots.txt', '/sitemap.xml': 'sitemap.xml',
};
const SITE_TYPES = {
  'index.html': 'text/html; charset=utf-8',
  'site.js': 'text/javascript; charset=utf-8',
  'site.css': 'text/css; charset=utf-8',
  'admin.html': 'text/html; charset=utf-8',
  'admin.js': 'text/javascript; charset=utf-8',
  'favicon.svg': 'image/svg+xml',
  'banner.svg': 'image/svg+xml',
  'banner.png': 'image/png',
  'terms.html': 'text/html; charset=utf-8',
  'changelog.html': 'text/html; charset=utf-8',
  'privacy.html': 'text/html; charset=utf-8',
  'imprint.html': 'text/html; charset=utf-8',
  'robots.txt': 'text/plain; charset=utf-8',
  'sitemap.xml': 'application/xml; charset=utf-8',
};
const SITE_DIR = fileURLToPath(new URL('./site/', import.meta.url));

/** One file from `site/`, or null. Names come from SITE_FILES, never the URL. */
async function siteFile(name) {
  try {
    // Read with NO encoding. The social card is a PNG, and decoding it as utf8
    // replaces every byte that is not valid text — the response is a 200 with a
    // broken image in it, which is the worst kind of wrong: nothing logs.
    return await readFile(new URL(name, `file://${SITE_DIR}`));
  } catch {
    return null;
  }
}

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
/**
 * Which operator-only surface a path belongs to, or `''` for the record API
 * itself. One table, so a route cannot be added to the cloud and forgotten here
 * without a test noticing.
 */
export function closedSurface(path, surface = surfaceFor()) {
  const off = (name) => (surface[name] ? '' : name);
  if (path === '/admin' || path === '/admin.js') return off('admin');
  if (SITE_FILES[path]) return off('shop');
  if (path === '/v1/products' || path === '/v1/accounts') return off('shop');
  if (path === '/v1/sessions') return off('accounts');
  if (path === '/v1/account' || path.startsWith('/v1/account/')) return off('accounts');
  if (path === '/v1/payments/webhook') return off('billing');
  if (path === '/v1/admin' || path.startsWith('/v1/admin/')) return off('admin');
  if (path === '/v1/licence' || path.startsWith('/v1/licence/')) return off('issuing');
  return '';
}

export function createRequestHandler(db, {
  tokens = new Map(), keys, allowQueryToken = false, accounts = null, trialDays = DEFAULT_TRIAL_DAYS,
  requestsPerMinute = 240, maxRecords = 5000, maxBytes = 64 * 1024 * 1024, now = () => Date.now(),
  adminToken = '', payments = paymentConfig(), fetchJson = globalThis.fetch, basicUser = '', basicPassword = '',
  licencePublic = '',
  licence = { ok: true, mode: 'cloud' }, licencePrivate = null, installKey = '', s3 = null,
  surface = surfaceFor(),
} = {}) {
  const ops = storeOps(db, keys, { s3, now });
  // Built only when this build serves them: the self-hosted build has no
  // accounts and no catalogue, so nothing is opened and no route can reach one.
  const people = surface.accounts ? (accounts ?? accountOps(db, { trialDays })) : null;
  const catalogue = surface.shop ? catalogOps(db, { now }) : null;
  // The one challenge this installation has minted and not yet spent.
  let pendingChallenge = '';
  // Traffic per workspace, since this process started. Approximate by design:
  // it counts the bytes of the records that pass through the API, not headers or
  // TLS overhead — enough to answer "who is using the service and how much".
  const traffic = new Map();
  const bump = (workspace, direction, bytes) => {
    const entry = traffic.get(workspace) ?? { inBytes: 0, outBytes: 0, requests: 0 };
    entry.requests += 1;
    if (direction === 'in') entry.inBytes += Math.max(0, Number(bytes) || 0);
    else entry.outBytes += Math.max(0, Number(bytes) || 0);
    traffic.set(workspace, entry);
  };
  // When a webhook last arrived, and what it did — the panel's health line.
  let lastWebhook = { at: '', type: '', result: '' };

  /**
   * A licence key for an account. Signed when the operator holds the signing key
   * (so a self-hosted server can verify it offline), and a plain random key when
   * not (so the cloud keeps working without one).
   */
  const issueLicence = (accountId, product, days) => {
    const account = people.byId(accountId);
    const expiresAt = new Date(now() + days * 86_400_000).toISOString();
    const key = licencePrivate
      ? signLicence(licencePayload({
        subject: account?.email ?? accountId,
        plan: product.kind === 'license' ? 'selfhosted' : 'selfhosted-renewal',
        issuedAt: new Date(now()).toISOString(),
        expiresAt,
      }), licencePrivate)
      : '';
    return catalogue.issueLicence(accountId, product.id, days, { key, signed: Boolean(key) });
  };

  /**
   * Who is asking, and what they may do (#148).
   *
   * Two kinds of caller live side by side: an **installer's token** from
   * `STORE_TOKENS`, which is a workspace and always entitled, and an **account
   * session**, whose workspace is derived from the account and whose entitlement
   * is its plan. Legacy tokens keep working exactly as before — an existing
   * install notices nothing.
   */
  const authenticate = (req, url) => {
    // A server with a password set answers to that password; the plugin holds
    // it like any other credential, so a stranger without it gets 401.
    if (basicUser && basicPassword && basicOf(req, { user: basicUser, password: basicPassword })) {
      return { workspace: 'basic', account: null, token: 'basic', plan: 'installer', expiresAt: '', entitled: true };
    }
    const presented = tokenOf(req, url, { allowQueryToken });
    if (!presented) return null;
    for (const [token, workspace] of tokens) {
      if (sameToken(token, presented)) {
        return { workspace, account: null, token: presented, plan: 'installer', expiresAt: '', entitled: true };
      }
    }
    const account = people ? people.sessionAccount(presented, now()) : null;
    if (!account) return null;
    const view = people.view(account, now());
    return {
      workspace: accountWorkspace(account.id),
      account: view,
      token: presented,
      plan: view.plan,
      expiresAt: view.expiresAt,
      // A trial or a subscription that has run out may still READ — so the user
      // can export what is theirs — but cannot write.
      entitled: !view.overdue,
    };
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

  // Everything the cloud routes are allowed to touch, in one object: the module
  // cannot reach past it into the record API's own state.
  const cloudContext = {
    // What the cloud module may read. The licence helpers it needs, it imports
    // itself: `cloud.js` is replaced by a stub in the self-hosted build, so its
    // imports are dropped with it.
    send, readBody, now, people, catalogue, payments, fetchJson, authenticate, tooMany, bump,
    siteFile, SITE_FILES, SITE_TYPES, adminToken, licence, licencePublic, licencePrivate, installKey, VERSION,
    ops, issueLicence, usageOf, tokenOf, sameToken, db, keys, s3, allowQueryToken, traffic,
    DEFAULT_SCOPE,
    webhookState: () => lastWebhook, noteWebhook: (info) => { lastWebhook = info; },
    pendingChallenge: () => pendingChallenge, setChallenge: (value) => { pendingChallenge = value; },
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

    // What this build serves. The cloud build mounts the shop, the accounts, the
    // catalogue, the panel and licence issuing; the self-hosted build mounts none
    // of them. A closed surface answers **404**, not 403: a 403 would confirm that
    // the surface exists on this server.
    if (closedSurface(path, surface)) return send(res, 404, { error: 'not found' });

    // The cloud's own routes — shop, catalogue, signup, the Stripe webhook and the
    // panel — live in `cloud.js`, which is **not** in the self-hosted archive.
    // `dist` puts a stub there, so a customer's copy contains none of this code,
    // and the surface gate above means it is never reached on such a server.
    //
    // A throw inside it must not leave the request hanging: logged, and answered.
    const runCloud = async (request) => {
      try {
        return await cloudRoute(cloudContext, request);
      } catch (error) {
        console.error('cloud route failed:', error);
        send(res, 500, { error: 'internal error' });
        return true;
      }
    };

    if (await runCloud({ req, res, url, path, method, authed: false })) return;

    // ── Everything below needs a token ─────────────────────────────────
    const who = authenticate(req, url);
    if (!who) return send(res, 401, { error: 'unauthorized' });
    if (tooMany(who.token)) return send(res, 429, { error: 'too many requests' });

    // Phase two of the cloud: sessions, the account's own data, orders and
    // licence issuing — every one of which has to know who is asking.
    if (await runCloud({ req, res, url, path, method, who, authed: true })) return;

    // A trial or subscription that has run out may read (so the user can export
    // what is theirs) but not write. 402 says "not paid", not "not allowed".
    const mayWrite = who.entitled;

    const workspace = who.workspace;
    const scope = String(url.searchParams.get('scope') ?? '').trim() || DEFAULT_SCOPE;

    try {
      if (path === '/v1/store') {
        if (method !== 'GET') return send(res, 405, { error: 'method not allowed' });
        const records = await ops.list(workspace, scope);
        bump(workspace, 'out', Buffer.byteLength(JSON.stringify(records)));
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
        bump(workspace, 'out', Buffer.byteLength(JSON.stringify(value)));
        return send(res, 200, { key, value, revision: ops.revision(workspace) });
      }

      if (!mayWrite) {
        return send(res, 402, { error: 'no active subscription', plan: who.plan, expiresAt: who.expiresAt });
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
        bump(workspace, 'in', size);
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
  trialDays = DEFAULT_TRIAL_DAYS, now, adminToken = '', payments = paymentConfig(), fetchJson,
  basicUser = '', basicPassword = '', licencePublic = '',
  licence = startupLicence(), licencePrivate = loadPrivateKey(),
  installKey = process.env.FYRHAVEN_INSTALL_KEY ?? '', s3 = null,
  surface = surfaceFor(),
} = {}) {
  const operator = Object.values(surface).some(Boolean);
  const db = openStore(dbPath, { operator });
  const tokens = parseTokens(tokenList);
  const keys = workspaceKeys(db, masterKey);
  const server = createHttpServer(createRequestHandler(db, {
    tokens, keys, allowQueryToken, trialDays, now, adminToken, payments, fetchJson,
    basicUser, basicPassword, licencePublic, licence, licencePrivate, installKey, s3, surface,
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
  // A trial length of 0 turns the trial off: a new account then has to be put
  // on a plan before it can write anything.
  const trialDays = Number(process.env.STORE_TRIAL_DAYS ?? DEFAULT_TRIAL_DAYS);
  // The operator's panel is off until a token is set: an admin surface that
  // comes up open on a fresh install is worse than one that has to be enabled.
  // The lock (#148): a self-hosted install must present a licence key it can
  // verify offline. `FYRHAVEN_MODE=cloud` is the operator's own service, which
  // needs none — it *is* the product.
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
          writeFileSync(process.env.FYRHAVEN_LICENCE_FILE ?? '/data/licence.key', `${activated.licence}
`, { mode: 0o600 });
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
    if (DISTRIBUTION === 'cloud') {
      console.error("The operator's own service may run with FYRHAVEN_MODE=cloud instead.");
    }
    process.exit(1);
  }
  console.log(`Fyrhaven: ${licence.mode} mode` + (licence.licence ? ` — ${describeLicence(licence.licence)}` : ''));

  const adminToken = String(process.env.STORE_ADMIN_TOKEN ?? '').trim();
  // Only the cloud has a panel to be closed; saying this in a self-hosted build
  // would advertise a surface that is not in the build at all.
  if (!adminToken && DISTRIBUTION === 'cloud') {
    console.warn('STORE_ADMIN_TOKEN is not set — /v1/admin and /admin answer 503.');
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
    dbPath, tokenList, masterKey, allowQueryToken, adminToken, payments: paymentConfig(process.env),
    installKey, s3: bucketClient,
    surface: surfaceFor(DISTRIBUTION),
    trialDays: Number.isFinite(trialDays) && trialDays >= 0 ? trialDays : DEFAULT_TRIAL_DAYS,
    basicUser: String(process.env.STORE_AUTH_USER ?? '').trim(),
    basicPassword: String(process.env.STORE_AUTH_PASSWORD ?? ''),
  });
  server.listen(port, () => {
    console.log(`contact-manager-store v${VERSION} listening on :${port} — ${tokens.size} token(s), db ${dbPath}, values encrypted at rest`);
    console.log(`Fyrhaven: ${DISTRIBUTION} build — ` + (DISTRIBUTION === 'cloud'
      ? 'shop, accounts, billing and panel are mounted'
      : 'record API only: no shop, no accounts, no billing, no panel'));
  });
}
