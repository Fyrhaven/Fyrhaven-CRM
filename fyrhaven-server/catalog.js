// What is for sale (#148, the catalogue half).
//
// Prices do not belong in code: a product, its amount, its interval and the
// Stripe price it maps to are the operator's decision, and they change. So they
// live in a table, the panel edits them, and the site reads them — one place, no
// deploy to change a price.
//
// Two kinds of thing are sold, and they are not the same shape:
//
//   subscription — the cloud service, per workspace, monthly or yearly. It buys
//     time on the operator's server.
//   license — the **software**, self-hosted. It buys a licence key and a year of
//     updates; renewing extends the updates, not the right to run it.
//
// A licence key is a random string the customer pastes into their own install;
// nothing phones home. That is deliberate: a self-hosted licence that needs a
// call to the seller is not self-hosted.

import { randomBytes } from 'node:crypto';

export const PRODUCT_KINDS = ['subscription', 'license'];
export const INTERVALS = ['month', 'year', 'once'];

/** Days one interval buys. A month is 31 so nobody loses a day in February. */
export const INTERVAL_DAYS = { month: 31, year: 365, once: 365 };

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const amountOf = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
};
const iso = (ms) => new Date(ms).toISOString();
const addDays = (ms, days) => ms + days * 24 * 60 * 60 * 1000;

/** `CM-XXXX-XXXX-XXXX`, unambiguous alphabet (no O/0, no I/1). */
export function newLicenceKey() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const block = () => Array.from(randomBytes(4))
    .map((byte) => alphabet[byte % alphabet.length])
    .join('');
  return `CM-${block()}-${block()}-${block()}`;
}

/** The tables a catalogue needs. Safe on an existing database. */
export function openCatalogTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id             TEXT PRIMARY KEY,
      code           TEXT NOT NULL UNIQUE,
      label          TEXT NOT NULL,
      description    TEXT NOT NULL DEFAULT '',
      kind           TEXT NOT NULL,
      interval       TEXT NOT NULL,
      amount         INTEGER NOT NULL,
      currency       TEXT NOT NULL DEFAULT 'EUR',
      stripe_price   TEXT NOT NULL DEFAULT '',
      stripe_product TEXT NOT NULL DEFAULT '',
      active         INTEGER NOT NULL DEFAULT 1,
      created        TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS licences (
      id         TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      key        TEXT NOT NULL UNIQUE,
      issued     TEXT NOT NULL,
      expires    TEXT NOT NULL
    );
  `);
  // Added after licences shipped: a signed key, and whether it was revoked.
  for (const column of ["signed INTEGER NOT NULL DEFAULT 0", "revoked INTEGER NOT NULL DEFAULT 0", "fingerprint TEXT NOT NULL DEFAULT ''"]) {
    try {
      db.exec(`ALTER TABLE licences ADD COLUMN ${column}`);
    } catch {
      // already there
    }
  }
}

/** A product, repaired into the shape the API answers with. */
export function normalizeProduct(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const code = text(raw.code);
  const label = text(raw.label);
  if (!code || !label) return null;
  return {
    code,
    label,
    description: text(raw.description),
    kind: PRODUCT_KINDS.includes(raw.kind) ? raw.kind : 'subscription',
    interval: INTERVALS.includes(raw.interval) ? raw.interval : 'month',
    amount: amountOf(raw.amount),
    currency: (text(raw.currency) || 'EUR').toUpperCase().slice(0, 3),
    stripePriceId: text(raw.stripePriceId),
    active: raw.active !== false,
  };
}

/** What a product costs, for the page: `6.00 EUR per month`. */
export function priceLabel(product) {
  const amount = (product.amount / 100).toFixed(2);
  const per = product.interval === 'once' ? 'one-off' : `per ${product.interval}`;
  return `${amount} ${product.currency} ${per}`;
}

/** The catalogue operations. */
export function catalogOps(db, { now = () => Date.now() } = {}) {
  const row = (id) => db.prepare('SELECT * FROM products WHERE id = ?').get(String(id ?? ''))
    ?? db.prepare('SELECT * FROM products WHERE code = ?').get(String(id ?? ''));
  const byCode = (code) => db.prepare('SELECT * FROM products WHERE code = ?').get(text(code));

  const view = (product) => ({
    id: product.id,
    code: product.code,
    label: product.label,
    description: product.description,
    kind: product.kind,
    interval: product.interval,
    amount: product.amount,
    currency: product.currency,
    price: priceLabel({ amount: product.amount, currency: product.currency, interval: product.interval }),
    stripePriceId: product.stripe_price,
    active: product.active === 1,
    days: INTERVAL_DAYS[product.interval] ?? 365,
  });

  return {
    row,
    byCode,

    /** Everything, active first — the panel list and the public one. */
    all({ onlyActive = false } = {}) {
      const sql = onlyActive
        ? 'SELECT * FROM products WHERE active = 1 ORDER BY kind DESC, amount ASC'
        : 'SELECT * FROM products ORDER BY active DESC, kind DESC, amount ASC';
      return db.prepare(sql).all().map(view);
    },

    /** One product, by id or by code. */
    get(id) {
      const product = row(id);
      return product ? view(product) : null;
    },

    /** Creates or replaces a product by `code`. */
    save(raw) {
      const clean = normalizeProduct(raw);
      if (!clean) return { status: 'invalid' };
      const existing = byCode(clean.code);
      if (existing) {
        db.prepare(`UPDATE products SET label = ?, description = ?, kind = ?, interval = ?, amount = ?,
          currency = ?, active = ? WHERE id = ?`)
          .run(clean.label, clean.description, clean.kind, clean.interval, clean.amount,
            clean.currency, clean.active ? 1 : 0, existing.id);
        return { status: 'ok', product: view(row(existing.id)) };
      }
      const id = `pr${randomBytes(6).toString('hex')}`;
      db.prepare(`INSERT INTO products (id, code, label, description, kind, interval, amount, currency,
        stripe_price, stripe_product, active, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?)`)
        .run(id, clean.code, clean.label, clean.description, clean.kind, clean.interval,
          clean.amount, clean.currency, clean.active ? 1 : 0, iso(now()));
      return { status: 'ok', product: view(row(id)) };
    },

    /** Remembers the Stripe price the operator created for this product. */
    setStripe(productId, { priceId = '', productId: stripeProduct = '' } = {}) {
      db.prepare('UPDATE products SET stripe_price = ?, stripe_product = ? WHERE id = ?')
        .run(text(priceId), text(stripeProduct), String(productId));
      const product = row(productId);
      return product ? view(product) : null;
    },

    /** Turns a product off (the site stops offering it). */
    setActive(id, active) {
      db.prepare('UPDATE products SET active = ? WHERE id = ?').run(active ? 1 : 0, String(id));
      const product = row(id);
      return product ? view(product) : null;
    },

    /** Issues a licence key for a paid licence order. */
    issueLicence(accountId, productId, days, { key = '', signed = false } = {}) {
      const id = `l${randomBytes(6).toString('hex')}`;
      const value = text(key) || newLicenceKey();
      const expires = iso(addDays(now(), days));
      db.prepare('INSERT INTO licences (id, account_id, product_id, key, issued, expires, signed) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, String(accountId), String(productId), value, iso(now()), expires, signed ? 1 : 0);
      return { id, key: value, signed: Boolean(signed), issuedAt: iso(now()), expiresAt: expires };
    },

    /** Binds a licence to one installation and remembers the key it issued. */
    bindLicence(id, fingerprint, key) {
      db.prepare('UPDATE licences SET fingerprint = ?, key = ? WHERE id = ?')
        .run(text(fingerprint), text(key), String(id ?? ''));
      const row2 = db.prepare('SELECT * FROM licences WHERE id = ?').get(String(id ?? ''));
      return row2
        ? {
          id: row2.id, key: row2.key, fingerprint: row2.fingerprint ?? '',
          signed: row2.signed === 1, revoked: row2.revoked === 1,
          issuedAt: row2.issued, expiresAt: row2.expires,
        }
        : null;
    },

    /** Marks a licence revoked. An offline licence cannot be un-run, but the list
     * stops claiming it is good, and a renewal is issued instead. */
    revokeLicence(id) {
      db.prepare('UPDATE licences SET revoked = 1 WHERE id = ?').run(String(id ?? ''));
      const row2 = db.prepare('SELECT * FROM licences WHERE id = ?').get(String(id ?? ''));
      return row2
        ? { id: row2.id, key: row2.key, revoked: row2.revoked === 1, issuedAt: row2.issued, expiresAt: row2.expires }
        : null;
    },

    /** An account's licences, with the product they belong to. */
    licences(accountId) {
      return db.prepare(`SELECT l.id, l.key, l.issued, l.expires, l.signed, l.revoked, l.fingerprint, p.label, p.code
        FROM licences l LEFT JOIN products p ON p.id = l.product_id
        WHERE l.account_id = ? ORDER BY l.issued DESC`).all(String(accountId)).map((licence) => ({
        id: licence.id,
        key: licence.key,
        label: licence.label ?? licence.code ?? '',
        signed: licence.signed === 1,
        revoked: licence.revoked === 1,
        fingerprint: licence.fingerprint ?? '',
        issuedAt: licence.issued,
        expiresAt: licence.expires,
      }));
    },

    /** Every licence — the operator's list. */
    allLicences({ limit = 500 } = {}) {
      return db.prepare(`SELECT l.id, l.key, l.issued, l.expires, l.signed, l.revoked, l.fingerprint, a.email, p.code
        FROM licences l LEFT JOIN accounts a ON a.id = l.account_id
        LEFT JOIN products p ON p.id = l.product_id
        ORDER BY l.issued DESC LIMIT ?`).all(Number(limit)).map((licence) => ({
        id: licence.id,
        key: licence.key,
        email: licence.email ?? '',
        code: licence.code ?? '',
        signed: licence.signed === 1,
        revoked: licence.revoked === 1,
        fingerprint: licence.fingerprint ?? '',
        issuedAt: licence.issued,
        expiresAt: licence.expires,
      }));
    },
  };
}

/**
 * What to seed a new catalogue with, in cents. A starting point, not a law: the
 * panel edits every one of these.
 */
export function defaultCatalogue() {
  return [
    {
      code: 'cloud-monthly',
      label: 'Contact Manager Cloud — monthly',
      kind: 'subscription',
      interval: 'month',
      amount: 600,
      currency: 'EUR',
      description: 'Your records on the Contact Manager server, per workspace, cancel any time.',
    },
    {
      code: 'cloud-yearly',
      label: 'Contact Manager Cloud — yearly',
      kind: 'subscription',
      interval: 'year',
      amount: 6000,
      currency: 'EUR',
      description: 'Two months free against the monthly price.',
    },
    {
      code: 'selfhosted',
      label: 'Self-hosted licence — one year of updates',
      kind: 'license',
      interval: 'once',
      amount: 14900,
      currency: 'EUR',
      description: 'Run the server on your own machine. Includes 12 months of updates; renew to keep receiving them.',
    },
  ];
}
