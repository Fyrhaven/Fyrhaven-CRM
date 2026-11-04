// Accounts, sessions and subscriptions (#148).
//
// The store used to have exactly one kind of caller: an installer. A token in
// `STORE_TOKENS` WAS a workspace, minted by hand, and everyone holding it was the
// same person. That is fine for one owner's own install and wrong for a service
// with customers — no sign-up, no revocation, nothing to sell.
//
// So: an account has an email, a password (scrypt, never stored in the clear), a
// plan and an expiry; a session is a random token whose **hash** is stored, so a
// stolen database file cannot be replayed as a login. A legacy `STORE_TOKENS`
// entry keeps working unchanged — an existing install must not notice this.
//
// No dependencies: `node:crypto` and `node:sqlite` are enough, which is the same
// reason the rest of this service has no lockfile to audit.

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

/** scrypt cost: ~16 MiB and a few ms — slow enough to hurt, fast enough to serve. */
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_BYTES = 64;
const SALT_BYTES = 16;

/** A session lives this long, in days. */
export const SESSION_DAYS = 30;
/** A new account starts on a trial of this many days. 0 turns the trial off. */
export const DEFAULT_TRIAL_DAYS = 14;
/** Plans an account can be on. An expired one is derived, never stored. */
export const PLANS = ['trial', 'cloud'];
export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 200;

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const iso = (ms) => new Date(ms).toISOString();
const addDays = (ms, days) => ms + days * 24 * 60 * 60 * 1000;

/** Deliberately loose: one `@`, something either side, a dot in the domain. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = (value) => EMAIL.test(text(value)) && text(value).length <= 254;

/** The workspace an account's records live in. Never collides with a token's. */
export const accountWorkspace = (accountId) => `acct:${accountId}`;

/** The session token a client holds; only its hash is stored. */
export const sessionHash = (token) => createHash('sha256').update(String(token ?? '')).digest('hex');

/** `scrypt$salt$hash`, so the parameters can change later without a migration. */
export async function hashPassword(password, salt = randomBytes(SALT_BYTES).toString('hex')) {
  const key = await scrypt(String(password), salt, KEY_BYTES, SCRYPT);
  return `scrypt$${salt}$${key.toString('hex')}`;
}

/** Constant-time password check; a malformed stored value simply never matches. */
export async function verifyPassword(stored, password) {
  const [scheme, salt, hash] = String(stored ?? '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const key = await scrypt(String(password), salt, KEY_BYTES, SCRYPT);
  const known = Buffer.from(hash, 'hex');
  if (known.length !== key.length) return false;
  return timingSafeEqual(known, key);
}

/** Too short, too long — the only rule a signup enforces on a password. */
export function passwordProblem(password) {
  const value = String(password ?? '');
  if (value.length < MIN_PASSWORD) return 'too-short';
  if (value.length > MAX_PASSWORD) return 'too-long';
  return '';
}

/** The tables a store needs for accounts. Safe to run on an existing database. */
export function openAccountTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id       TEXT PRIMARY KEY,
      email    TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      plan     TEXT NOT NULL DEFAULT 'trial',
      expires  TEXT NOT NULL DEFAULT '',
      created  TEXT NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      hash       TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      created    TEXT NOT NULL,
      expires    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id         TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      plan       TEXT NOT NULL,
      status     TEXT NOT NULL,
      created    TEXT NOT NULL
    );
  `);
  // Added after orders shipped, so an existing database is migrated in place.
  try {
    db.exec("ALTER TABLE orders ADD COLUMN product_id TEXT NOT NULL DEFAULT ''");
  } catch {
    // already there
  }
}

/**
 * The account operations, over one open database.
 *
 * Synchronous except the two that hash a password, because scrypt is
 * deliberately slow and must not block the event loop.
 */
export function accountOps(db, { trialDays = DEFAULT_TRIAL_DAYS } = {}) {
  const row = (email) => db.prepare('SELECT * FROM accounts WHERE email = ?').get(text(email).toLowerCase());
  const byId = (id) => db.prepare('SELECT * FROM accounts WHERE id = ?').get(String(id ?? ''));
  const newId = () => `a${randomBytes(9).toString('hex')}`;

  /** The public shape of an account — never the password. */
  const view = (account, now = Date.now()) => ({
    id: account.id,
    email: account.email,
    plan: account.plan,
    expiresAt: account.expires,
    verified: account.verified === 1,
    overdue: Boolean(account.expires) && Date.parse(account.expires) <= now,
    trial: account.plan === 'trial',
  });

  const startSession = (accountId, now) => {
    const token = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions (hash, account_id, created, expires) VALUES (?, ?, ?, ?)')
      .run(sessionHash(token), accountId, iso(now), iso(addDays(now, SESSION_DAYS)));
    return token;
  };

  return {
    byEmail: row,
    byId,

    /** Creates an account on a trial and returns it with a session token. */
    async signup({ email, password, now = Date.now() }) {
      const address = text(email).toLowerCase();
      if (!isEmail(address)) return { status: 'invalid-email' };
      const problem = passwordProblem(password);
      if (problem) return { status: problem };
      if (row(address)) return { status: 'exists' };
      const id = newId();
      const expires = trialDays > 0 ? iso(addDays(now, trialDays)) : '';
      db.prepare('INSERT INTO accounts (id, email, password, plan, expires, created, verified) VALUES (?, ?, ?, ?, ?, ?, 0)')
        .run(id, address, await hashPassword(password), trialDays > 0 ? 'trial' : 'none', expires, iso(now));
      return { status: 'ok', account: view(byId(id), now), token: startSession(id, now) };
    },

    /** Email and password in; a session token out. One answer for both failures. */
    async login({ email, password, now = Date.now() }) {
      const account = row(email);
      // Hash even when there is no account, so "no such email" and "wrong
      // password" take the same time and cannot be told apart by a timer.
      const stored = account?.password ?? (await hashPassword('not-a-real-password'));
      const ok = await verifyPassword(stored, password);
      if (!account || !ok) return { status: 'refused' };
      return { status: 'ok', account: view(account, now), token: startSession(account.id, now) };
    },

    /** The account behind a live session token, or null. Expiry is checked here. */
    sessionAccount(token, now = Date.now()) {
      const hash = sessionHash(token);
      const session = db.prepare('SELECT * FROM sessions WHERE hash = ?').get(hash);
      if (!session) return null;
      if (session.expires && Date.parse(session.expires) <= now) {
        db.prepare('DELETE FROM sessions WHERE hash = ?').run(hash);
        return null;
      }
      return byId(session.account_id) ?? null;
    },

    /** Ends one session; the token stops working immediately. */
    logout(token) {
      db.prepare('DELETE FROM sessions WHERE hash = ?').run(sessionHash(token));
    },

    /**
     * Puts an account on a plan until a date. `days` is added to now, so an
     * operator (or a payment webhook) never computes an ISO date by hand.
     */
    setPlan(accountId, plan, { days = 365, now = Date.now() } = {}) {
      const clean = PLANS.includes(plan) ? plan : null;
      if (!clean) return null;
      const expires = days > 0 ? iso(addDays(now, days)) : '';
      db.prepare('UPDATE accounts SET plan = ?, expires = ? WHERE id = ?').run(clean, expires, String(accountId));
      const account = byId(accountId);
      return account ? view(account, now) : null;
    },

    /** Records an order request; the payment itself is the next step. */
    placeOrder(accountId, plan = 'cloud', { productId = '', now = Date.now() } = {}) {
      const id = `o${randomBytes(6).toString('hex')}`;
      db.prepare('INSERT INTO orders (id, account_id, plan, product_id, status, created) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, String(accountId), PLANS.includes(plan) ? plan : 'cloud', String(productId ?? ''), 'pending', iso(now));
      return {
        id,
        plan: PLANS.includes(plan) ? plan : 'cloud',
        productId: String(productId ?? ''),
        status: 'pending',
        createdAt: iso(now),
      };
    },

    /** Every order, newest first, with the email it belongs to — the admin list. */
    allOrders({ limit = 200 } = {}) {
      return db.prepare(`
        SELECT o.id, o.account_id, o.plan, o.status, o.created, a.email
        FROM orders o LEFT JOIN accounts a ON a.id = o.account_id
        ORDER BY o.created DESC LIMIT ?
      `).all(Number(limit)).map((order) => ({
        id: order.id,
        accountId: order.account_id,
        email: order.email ?? '',
        plan: order.plan,
        status: order.status,
        createdAt: order.created,
      }));
    },

    /** One order, or undefined. */
    order(id) {
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(String(id ?? ''));
      return order
        ? {
          id: order.id, accountId: order.account_id, plan: order.plan,
          productId: order.product_id ?? '', status: order.status, createdAt: order.created,
        }
        : undefined;
    },

    /** Moves an order to `paid` (or `cancelled`); returns it, or null. */
    setOrderStatus(id, status) {
      const allowed = ['pending', 'paid', 'cancelled'];
      if (!allowed.includes(status)) return null;
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, String(id ?? ''));
      return this.order(id) ?? null;
    },

    /** Every account, newest first — the admin list. */
    allAccounts({ limit = 500, now = Date.now() } = {}) {
      return db.prepare('SELECT * FROM accounts ORDER BY created DESC LIMIT ?')
        .all(Number(limit))
        .map((account) => view(account, now));
    },

    /** Orders for an account, newest first. */
    orders(accountId) {
      return db.prepare('SELECT id, plan, status, created FROM orders WHERE account_id = ? ORDER BY created DESC')
        .all(String(accountId))
        .map((order) => ({ id: order.id, plan: order.plan, status: order.status, createdAt: order.created }));
    },

    /**
     * Removes an account and everything that could still open it: its sessions
     * and its orders. The caller drops the records and the wrapped key, because
     * those belong to the store tables.
     */
    deleteAccount(accountId) {
      const id = String(accountId ?? '');
      if (!byId(id)) return 0;
      db.prepare('DELETE FROM sessions WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM orders WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
      return 1;
    },

    view,
  };
}
