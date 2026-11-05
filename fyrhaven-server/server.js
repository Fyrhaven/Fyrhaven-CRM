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
import { fileURLToPath } from 'node:url';

import {
  accountOps, accountWorkspace, DEFAULT_TRIAL_DAYS, openAccountTables, SESSION_DAYS,
} from './accounts.js';
import {
  createCheckout, createStripePrice, paymentConfig, planFromEvent, verifyStripeSignature,
} from './payments.js';
import { catalogOps, defaultCatalogue, openCatalogTables } from './catalog.js';
import {
  activateOnline, deactivationChallenge, describeLicence, ensureInstallKey, isInstallKey, licencePayload,
  loadPrivateKey, publicKeyOf, readChallenge, signDeactivation, signLicence, startupLicence,
  verifyDeactivation, verifyLicence,
} from './licence.js';


export const VERSION = '1.0.0';

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
  // Accounts and sessions (#148). Safe on an existing database: every statement
  // is IF NOT EXISTS, so a store that predates accounts opens unchanged.
  openAccountTables(db);
  // What is for sale (#148). Seeded once, then owned by the operator's panel.
  openCatalogTables(db);
  const seeded = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
  if (!seeded) {
    const catalogue = catalogOps(db);
    for (const product of defaultCatalogue()) catalogue.save(product);
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
 * The four store operations, over one open database.
 *
 * `revision` is a single counter bumped by every write, so a client can tell
 * "something changed" without diffing — and a future sync can ask for
 * everything above the revision it last saw.
 */
export function storeOps(db, keys) {
  const revision = () => db.prepare('SELECT revision FROM counter WHERE id = 1').get().revision;
  const bump = () => {
    db.prepare('UPDATE counter SET revision = revision + 1 WHERE id = 1').run();
    return revision();
  };
  return {
    revision,
    list(workspace, scope) {
      const rows = db
        .prepare('SELECT key, value FROM records WHERE workspace = ? AND scope = ?')
        .all(workspace, scope);
      const records = {};
      // A row that will not open means the key changed or the file was tampered
      // with: fail loudly rather than serve a hole in the data.
      for (const row of rows) records[row.key] = JSON.parse(open(keys.get(workspace), row.value));
      return records;
    },
    get(workspace, scope, key) {
      const row = db
        .prepare('SELECT value FROM records WHERE workspace = ? AND scope = ? AND key = ?')
        .get(workspace, scope, key);
      return row ? JSON.parse(open(keys.get(workspace), row.value)) : null;
    },
    put(workspace, scope, key, value) {
      db.prepare(`
        INSERT INTO records (workspace, scope, key, value, updated) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (workspace, scope, key)
        DO UPDATE SET value = excluded.value, updated = excluded.updated
      `).run(workspace, scope, key, seal(keys.get(workspace), JSON.stringify(value)), new Date().toISOString());
      return bump();
    },
    remove(workspace, scope, key) {
      const info = db
        .prepare('DELETE FROM records WHERE workspace = ? AND scope = ? AND key = ?')
        .run(workspace, scope, key);
      if (info.changes) bump();
      return info.changes > 0;
    },
  };
}

// ── HTTP ────────────────────────────────────────────────────────

/** The pages the service itself serves (#148). No build step, no bundler. */
const SITE_FILES = {
  '/': 'index.html', '/index.html': 'index.html', '/site.js': 'site.js', '/site.css': 'site.css',
  '/admin': 'admin.html', '/admin.js': 'admin.js',
  '/favicon.svg': 'favicon.svg', '/banner.svg': 'banner.svg',
};
const SITE_TYPES = {
  'index.html': 'text/html; charset=utf-8',
  'site.js': 'text/javascript; charset=utf-8',
  'site.css': 'text/css; charset=utf-8',
  'admin.html': 'text/html; charset=utf-8',
  'admin.js': 'text/javascript; charset=utf-8',
  'favicon.svg': 'image/svg+xml',
  'banner.svg': 'image/svg+xml',
};
const SITE_DIR = fileURLToPath(new URL('./site/', import.meta.url));

/** One file from `site/`, or null. Names come from SITE_FILES, never the URL. */
async function siteFile(name) {
  try {
    return await readFile(new URL(name, `file://${SITE_DIR}`), 'utf8');
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
export function createRequestHandler(db, {
  tokens = new Map(), keys, allowQueryToken = false, accounts = null, trialDays = DEFAULT_TRIAL_DAYS,
  requestsPerMinute = 240, maxRecords = 5000, maxBytes = 64 * 1024 * 1024, now = () => Date.now(),
  adminToken = '', payments = paymentConfig(), fetchJson = globalThis.fetch, basicUser = '', basicPassword = '',
  licencePublic = '',
  licence = { ok: true, mode: 'cloud' }, licencePrivate = null, installKey = '',
} = {}) {
  const ops = storeOps(db, keys);
  const people = accounts ?? accountOps(db, { trialDays });
  const catalogue = catalogOps(db, { now });
  // The one challenge this installation has minted and not yet spent.
  let pendingChallenge = '';

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
    const account = people.sessionAccount(presented, now());
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
  const usageOf = (workspace) => {
    const row = db.prepare('SELECT COUNT(*) AS records, COALESCE(SUM(LENGTH(value)), 0) AS bytes FROM records WHERE workspace = ?')
      .get(workspace);
    return { records: Number(row.records ?? 0), bytes: Number(row.bytes ?? 0), maxRecords, maxBytes };
  };

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

    // The site (#148): the page a customer signs up and orders on. Static files,
    // no build step, served by the same container as the API.
    if (method === 'GET' && SITE_FILES[path]) {
      const body = await siteFile(SITE_FILES[path]);
      if (body === null) return send(res, 404, { error: 'not found' });
      res.writeHead(200, {
        'content-type': SITE_TYPES[SITE_FILES[path]],
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
      });
      return res.end(body);
    }

    // What is for sale: open, because a price list is a shop window.
    if (method === 'GET' && path === '/v1/products') {
      return send(res, 200, { ok: true, products: catalogue.all({ onlyActive: true }), payments: payments.provider });
    }

    const client = req.socket?.remoteAddress ?? 'unknown';
    const body = async () => {
      const raw = await readBody(req);
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    };

    // ── Open endpoints: sign up, sign in ────────────────────────────────
    if (method === 'POST' && (path === '/v1/accounts' || path === '/v1/sessions')) {
      if (tooMany(`open:${client}`)) return send(res, 429, { error: 'too many requests' });
      const payload = await body();
      if (!payload || typeof payload !== 'object') return send(res, 400, { error: 'body is not JSON' });

      if (path === '/v1/accounts') {
        const answer = await people.signup({ email: payload.email, password: payload.password, now: now() });
        if (answer.status === 'invalid-email') return send(res, 400, { error: 'that email address is not valid' });
        if (answer.status === 'too-short') return send(res, 400, { error: 'the password needs at least 10 characters' });
        if (answer.status === 'too-long') return send(res, 400, { error: 'the password is too long' });
        if (answer.status === 'exists') return send(res, 409, { error: 'that email already has an account' });
        return send(res, 201, { ok: true, token: answer.token, account: answer.account });
      }

      const answer = await people.login({ email: payload.email, password: payload.password, now: now() });
      if (answer.status !== 'ok') return send(res, 401, { error: 'email or password is wrong' });
      return send(res, 200, { ok: true, token: answer.token, account: answer.account });
    }

    // ── The payment provider's webhook (no bearer: the signature is the proof) ──
    if (path === '/v1/payments/webhook' && method === 'POST') {
      const raw = await readBody(req);
      const signature = req.headers['stripe-signature'];
      if (!verifyStripeSignature({ header: signature, payload: raw, secret: payments.webhookSecret, now: now() })) {
        return send(res, 400, { error: 'bad signature' });
      }
      let event;
      try {
        event = JSON.parse(raw);
      } catch {
        return send(res, 400, { error: 'body is not JSON' });
      }
      const meaning = planFromEvent(event);
      if (!meaning) return send(res, 200, { ok: true, ignored: true });
      if (!people.byId(meaning.accountId)) return send(res, 200, { ok: true, ignored: 'no such account' });
      people.setPlan(meaning.accountId, meaning.plan, { days: payments.planDays, now: now() });
      if (meaning.orderId) people.setOrderStatus(meaning.orderId, 'paid');

      // A licence product also hands out a key: the software is self-hosted, so
      // the key is the whole entitlement and nothing calls home to check it.
      let licence = null;
      const order = meaning.orderId ? people.order(meaning.orderId) : null;
      const product = order?.productId ? catalogue.get(order.productId) : null;
      if (product && product.kind === 'license') {
        licence = issueLicence(meaning.accountId, product, product.days);
      }
      return send(res, 200, { ok: true, plan: meaning.plan, licence });
    }

    // ── The operator's panel (#148): everything under /v1/admin ────────
    if (path === '/v1/admin' || path.startsWith('/v1/admin/')) {
      if (!adminToken) return send(res, 503, { error: 'no admin token configured' });
      const presented = tokenOf(req, url, { allowQueryToken });
      if (!presented || !sameToken(adminToken, presented)) return send(res, 401, { error: 'unauthorized' });
      if (tooMany('admin')) return send(res, 429, { error: 'too many requests' });

      if (path === '/v1/admin/orders' && method === 'GET') {
        return send(res, 200, { ok: true, orders: people.allOrders() });
      }
      if (path === '/v1/admin/products' && method === 'GET') {
        return send(res, 200, { ok: true, products: catalogue.all(), payments: payments.provider });
      }
      if (path === '/v1/admin/products' && method === 'POST') {
        const answer = catalogue.save((await body()) ?? {});
        if (answer.status !== 'ok') return send(res, 400, { error: 'a code and a label are needed' });
        return send(res, 200, { ok: true, product: answer.product });
      }

      const stripeProduct = /^\/v1\/admin\/products\/([^/]+)\/stripe$/.exec(path);
      if (stripeProduct && method === 'POST') {
        const product = catalogue.get(decodeURIComponent(stripeProduct[1]));
        if (!product) return send(res, 404, { error: 'no such product' });
        const created = await createStripePrice(payments, product, { fetch: fetchJson });
        if (created.status === 'unconfigured') return send(res, 503, { error: 'no payment provider configured' });
        if (created.status !== 'ok') return send(res, 502, { error: created.reason ?? 'stripe refused' });
        const saved = catalogue.setStripe(product.id, created);
        return send(res, 200, { ok: true, product: saved });
      }

      const activeProduct = /^\/v1\/admin\/products\/([^/]+)\/active$/.exec(path);
      if (activeProduct && method === 'POST') {
        const payload = (await body()) ?? {};
        const product = catalogue.setActive(decodeURIComponent(activeProduct[1]), payload.active !== false);
        if (!product) return send(res, 404, { error: 'no such product' });
        return send(res, 200, { ok: true, product });
      }

      const revoke = /^\/v1\/admin\/licenses\/([^/]+)\/revoke$/.exec(path);
      if (revoke && method === 'POST') {
        const licence2 = catalogue.revokeLicence(decodeURIComponent(revoke[1]));
        if (!licence2) return send(res, 404, { error: 'no such licence' });
        return send(res, 200, { ok: true, licence: licence2 });
      }

      if (path === '/v1/admin/licenses' && method === 'GET') {
        return send(res, 200, { ok: true, licences: catalogue.allLicences() });
      }

      if (path === '/v1/admin/accounts' && method === 'GET') {
        return send(res, 200, { ok: true, accounts: people.allAccounts(), payments: { provider: payments.provider } });
      }

      const paid = /^\/v1\/admin\/orders\/([^/]+)\/paid$/.exec(path);
      if (paid && method === 'POST') {
        const order = people.order(decodeURIComponent(paid[1]));
        if (!order) return send(res, 404, { error: 'no such order' });
        const payload = (await body()) ?? {};
        const days = Number(payload.days ?? payments.planDays);
        people.setOrderStatus(order.id, 'paid');
        const account = people.setPlan(order.accountId, order.plan, {
          days: Number.isFinite(days) && days > 0 ? days : payments.planDays, now: now(),
        });
        if (!account) return send(res, 404, { error: 'the order has no live account' });
        return send(res, 200, { ok: true, order: people.order(order.id), account });
      }

      const plan = /^\/v1\/admin\/accounts\/([^/]+)\/plan$/.exec(path);
      if (plan && method === 'POST') {
        const payload = (await body()) ?? {};
        const account = people.setPlan(decodeURIComponent(plan[1]), payload.plan ?? 'cloud', {
          days: Number(payload.days ?? payments.planDays), now: now(),
        });
        if (!account) return send(res, 400, { error: 'no such account, or an unknown plan' });
        return send(res, 200, { ok: true, account });
      }

      const accountPath = /^\/v1\/admin\/accounts\/([^/]+)$/.exec(path);
      if (accountPath && method === 'DELETE') {
        const id = decodeURIComponent(accountPath[1]);
        const workspace = accountWorkspace(id);
        if (!people.deleteAccount(id)) return send(res, 404, { error: 'no such account' });
        db.prepare('DELETE FROM records WHERE workspace = ?').run(workspace);
        db.prepare('DELETE FROM workspaces WHERE workspace = ?').run(workspace);
        return send(res, 200, { ok: true, deleted: true });
      }

      return send(res, 404, { error: 'not found' });
    }

    // ── Everything below needs a token ─────────────────────────────────
    const who = authenticate(req, url);
    if (!who) return send(res, 401, { error: 'unauthorized' });
    if (tooMany(who.token)) return send(res, 429, { error: 'too many requests' });

    if (path === '/v1/sessions' && method === 'DELETE') {
      people.logout(who.token);
      return send(res, 200, { ok: true });
    }


    if (path === '/v1/account') {
      if (method === 'GET') {
        return send(res, 200, {
          ok: true,
          workspace: who.workspace,
          plan: who.plan,
          expiresAt: who.expiresAt,
          entitled: who.entitled,
          account: who.account,
          licences: who.account ? catalogue.licences(who.account.id) : [],
          usage: usageOf(who.workspace),
        });
      }
      // Leaving: the account, its sessions, its orders, its records and the
      // wrapped key all go. Without the key the rows are unreadable, which is
      // what makes this an erasure rather than a flag.
      if (method === 'DELETE') {
        if (!who.account) return send(res, 409, { error: 'an installer token has no account' });
        const workspace = who.workspace;
        people.deleteAccount(who.account.id);
        db.prepare('DELETE FROM records WHERE workspace = ?').run(workspace);
        db.prepare('DELETE FROM workspaces WHERE workspace = ?').run(workspace);
        return send(res, 200, { ok: true, deleted: true });
      }
      return send(res, 405, { error: 'method not allowed' });
    }

    // Online activation (#148): a self-hosted install with an account token asks
    // the service for a key bound to its own fingerprint.
    if (path === '/v1/licence/activate' && method === 'POST') {
      if (!who.account) return send(res, 409, { error: 'activation belongs to an account, not an installer token' });
      if (!licencePrivate) return send(res, 503, { error: 'this service cannot sign licences' });
      const payload = (await body()) ?? {};
      const fingerprint = String(payload.fingerprint ?? '').trim();
      if (!isInstallKey(fingerprint)) return send(res, 400, { error: 'that is not an installation key (FHI-XXXX-XXXX-XXXX-XXXX)' });

      const owned = catalogue.licences(who.account.id).filter((entry) => !entry.revoked);
      if (!owned.length) return send(res, 402, { error: 'no licence to activate — buy one first' });
      const source = owned[0];
      const key = signLicence(licencePayload({
        subject: who.account.email,
        plan: 'selfhosted',
        fingerprint,
        issuedAt: new Date(now()).toISOString(),
        expiresAt: source.expiresAt,
      }), licencePrivate);
      const bound = catalogue.bindLicence(source.id, fingerprint, key);
      return send(res, 200, { ok: true, licence: key, expiresAt: source.expiresAt, fingerprint, record: bound });
    }

    // Deactivation, both halves. An **account** asks for a release code for the
    // installation it names; an **installer/basic** caller spends that code and
    // forgets its licence. A customer cannot mint the code, so a copied key can
    // not walk away from its server.
    if (path === '/v1/licence/deactivate' && method === 'POST') {
      const payload = (await body()) ?? {};

      if (who.account) {
        if (!licencePrivate) return send(res, 503, { error: 'this service cannot sign licences' });
        const challenge = readChallenge(payload.challenge);
        if (!challenge) return send(res, 400, { error: 'that is not a deactivation challenge' });
        const owned = catalogue.licenceForFingerprint(challenge.fp);
        if (!owned || owned.accountId !== who.account.id) {
          return send(res, 404, { error: 'no licence of yours is bound to that installation' });
        }
        const released = catalogue.deactivateLicence(owned.id);
        return send(res, 200, {
          ok: true,
          code: signDeactivation({ fingerprint: challenge.fp, nonce: challenge.nonce }, licencePrivate, { now: now() }),
          licence: released,
        });
      }

      // The installation's own side: one pending challenge at a time, because a
      // server is released once and then re-licensed.
      if (!pendingChallenge) return send(res, 409, { error: 'ask for a challenge first' });
      const checked = verifyDeactivation(String(payload.code ?? ''), {
        publicKey: publicKeyOf({ FYRHAVEN_LICENCE_PUBLIC: licencePublic }),
        fingerprint: installKey, nonce: pendingChallenge, now: now(),
      });
      if (!checked.ok) return send(res, 400, { error: `the deactivation code was not accepted (${checked.reason})` });
      pendingChallenge = '';
      process.env.FYRHAVEN_LICENCE = '';
      try {
        const { rmSync } = await import('node:fs');
        rmSync(process.env.FYRHAVEN_LICENCE_FILE ?? '/data/licence.key', { force: true });
      } catch {
        // nothing cached
      }
      return send(res, 200, { ok: true, deactivated: true, note: 'restart to run unlicensed, or paste a new key' });
    }

    if (path === '/v1/licence/challenge' && method === 'POST') {
      const challenge = deactivationChallenge(installKey, { now: now() });
      const read = readChallenge(challenge);
      pendingChallenge = read?.nonce ?? '';
      return send(res, 200, { ok: true, fingerprint: installKey, challenge });
    }

    if (path === '/v1/licence') {
      if (method !== 'GET') return send(res, 405, { error: 'method not allowed' });
      return send(res, 200, {
        ok: true,
        mode: licence.mode ?? 'cloud',
        fingerprint: installKey,
        licensed: Boolean(licence.licence),
        licence: licence.licence ?? null,
        summary: describeLicence(licence.licence ?? null),
      });
    }

    if (path === '/v1/account/order') {
      if (method !== 'POST') return send(res, 405, { error: 'method not allowed' });
      if (!who.account) return send(res, 409, { error: 'an installer token has no account' });
      const payload = (await body()) ?? {};
      // A product says what is being sold; without one the old `plan` shape is
      // still accepted, so the plugin's existing call keeps working.
      const product = payload.productId || payload.product
        ? catalogue.get(payload.productId ?? payload.product)
        : null;
      if ((payload.productId || payload.product) && !product) return send(res, 404, { error: 'no such product' });
      const order = people.placeOrder(who.account.id, product ? 'cloud' : (payload.plan ?? 'cloud'), {
        productId: product?.id ?? '', now: now(),
      });

      // With a provider configured the customer is sent to pay; without one the
      // order is a request an operator settles by hand. Neither is a lie, and
      // the client is told which it got.
      const checkout = await createCheckout(payments, {
        order, account: who.account, fetch: fetchJson,
        priceId: product?.stripePriceId ?? '',
        mode: product && product.interval === 'once' ? 'payment' : (product ? 'subscription' : ''),
      });
      return send(res, 202, {
        ok: true,
        order,
        payment: checkout.status === 'ok'
          ? { status: 'redirect', url: checkout.url, sessionId: checkout.id }
          : { status: checkout.status === 'unconfigured' ? 'unavailable' : 'failed', reason: checkout.reason },
        note: checkout.status === 'ok' ? 'pay on the provider page to switch the plan on' : 'pending — an invoice follows',
      });
    }

    // A trial or subscription that has run out may read (so the user can export
    // what is theirs) but not write. 402 says "not paid", not "not allowed".
    const mayWrite = who.entitled;

    const workspace = who.workspace;
    const scope = String(url.searchParams.get('scope') ?? '').trim() || DEFAULT_SCOPE;

    try {
      if (path === '/v1/store') {
        if (method !== 'GET') return send(res, 405, { error: 'method not allowed' });
        return send(res, 200, { records: ops.list(workspace, scope), revision: ops.revision() });
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
        const value = ops.get(workspace, scope, key);
        if (value === null) return send(res, 404, { error: 'no such record' });
        return send(res, 200, { key, value, revision: ops.revision() });
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
        const usage = usageOf(workspace);
        const previous = ops.get(workspace, scope, key);
        const previousBytes = previous === null ? 0 : Buffer.byteLength(JSON.stringify(previous));
        if (previous === null && usage.records >= maxRecords) {
          return send(res, 409, { error: 'record limit reached', usage });
        }
        if (usage.bytes - previousBytes + size > maxBytes) {
          return send(res, 409, { error: 'storage limit reached', usage });
        }
        return send(res, 200, { revision: ops.put(workspace, scope, key, parsed.value) });
      }

      if (method === 'DELETE') {
        ops.remove(workspace, scope, key);
        return send(res, 200, { ok: true });
      }

      return send(res, 405, { error: 'method not allowed' });
    } catch (err) {
      if (err?.tooLarge) return send(res, 413, { error: 'too large' });
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
  installKey = process.env.FYRHAVEN_INSTALL_KEY ?? '',
} = {}) {
  const db = openStore(dbPath);
  const tokens = parseTokens(tokenList);
  const keys = workspaceKeys(db, masterKey);
  const server = createHttpServer(createRequestHandler(db, {
    tokens, keys, allowQueryToken, trialDays, now, adminToken, payments, fetchJson,
    basicUser, basicPassword, licencePublic, licence, licencePrivate, installKey,
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
    console.error('A self-hosted install needs FYRHAVEN_LICENCE (from your Fyrhaven licence) ');
    console.error('or FYRHAVEN_MODE=cloud for the service itself. See LICENSING.md.');
    process.exit(1);
  }
  console.log(`Fyrhaven: ${licence.mode} mode` + (licence.licence ? ` — ${describeLicence(licence.licence)}` : ''));

  const adminToken = String(process.env.STORE_ADMIN_TOKEN ?? '').trim();
  if (!adminToken) console.warn('STORE_ADMIN_TOKEN is not set — /v1/admin and /admin answer 503.');
  const { server, tokens } = createStoreServer({
    dbPath, tokenList, masterKey, allowQueryToken, adminToken, payments: paymentConfig(process.env),
    installKey,
    trialDays: Number.isFinite(trialDays) && trialDays >= 0 ? trialDays : DEFAULT_TRIAL_DAYS,
    basicUser: String(process.env.STORE_AUTH_USER ?? '').trim(),
    basicPassword: String(process.env.STORE_AUTH_PASSWORD ?? ''),
  });
  server.listen(port, () => {
    console.log(`contact-manager-store v${VERSION} listening on :${port} — ${tokens.size} token(s), db ${dbPath}, values encrypted at rest`);
  });
}
