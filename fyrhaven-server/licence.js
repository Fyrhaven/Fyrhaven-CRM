// Self-hosted licences (#148, the lock): a signed key the server verifies offline.
//
// Two wrong ways and one right one:
//
//   * A key checked against our server on every boot — that is not self-hosted,
//     and it stops working the day we are down or the customer's link is.
//   * A key that is just a random string — nothing stops anyone editing the
//     database, or generating their own.
//   * A key the **operator signs** and the server verifies with a public key
//     compiled in: no call home, no secret in the customer's hands, and forging
//     one means forging an Ed25519 signature.
//
// What that honestly buys you: nobody runs it without a key you issued. What it
// does **not** buy: revocation in real time. An offline licence cannot be taken
// back, and anyone with the source can patch the check — so the licence is a
// contract with honest customers, not a lock on the determined. That is stated
// in the README rather than implied away.
//
// Key format, one line, easy to paste into an `.env`:
//
//     FH1.<base64url(payload JSON)>.<base64url(ed25519 signature)>

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as signRaw, verify as verifyRaw } from 'node:crypto';

export const LICENCE_PREFIX = 'FH1';
export const LICENCE_PLANS = ['selfhosted', 'selfhosted-renewal'];

/**
 * The public key half of the operator's signing key. A self-hoster needs nothing
 * but this (it ships in the code); the private half never leaves the seller.
 * `FYRHAVEN_LICENCE_PUBLIC` can override it, so an operator can rotate keys
 * without a code change.
 */
export const DEFAULT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAGZ1c1v5m9VQ3Q1sJ4Xz0Q9t7y0l6oQ0m9m5o9Q0m9Vw=
-----END PUBLIC KEY-----`;

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const b64u = (buffer) => Buffer.from(buffer).toString('base64url');
const fromB64u = (value) => Buffer.from(String(value), 'base64url');

export const publicKeyOf = (env = process.env) => text(env.FYRHAVEN_LICENCE_PUBLIC) || DEFAULT_PUBLIC_KEY;

/**
 * A public key from either form an operator might paste: PEM, or the base64 DER
 * that `openssl`/`node` print on one line (which is what fits in an `.env`).
 */
export function loadPublicKey(value) {
  const raw = text(value);
  if (!raw) return undefined;
  try {
    if (raw.includes('BEGIN')) return createPublicKey(raw);
    return createPublicKey({ key: Buffer.from(raw, 'base64'), format: 'der', type: 'spki' });
  } catch {
    return undefined;
  }
}

/** The operator's signing key, stored as base64 of a PKCS#8 PEM, or undefined. */
export function loadPrivateKey(env = process.env) {
  const raw = text(env.FYRHAVEN_LICENCE_PRIVATE_B64) || text(env.FYRHAVEN_LICENCE_PRIVATE);
  if (!raw) return undefined;
  try {
    const pem = raw.includes('BEGIN') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    return createPrivateKey(pem);
  } catch {
    return undefined;
  }
}

/** A licence body: who it is for, which plan, and when it stops. */
export function licencePayload({ subject, plan = 'selfhosted', seats = 1, issuedAt, expiresAt }) {
  return {
    v: 1,
    sub: text(subject).slice(0, 200),
    plan: LICENCE_PLANS.includes(plan) ? plan : 'selfhosted',
    seats: Number.isFinite(Number(seats)) ? Math.max(1, Math.round(Number(seats))) : 1,
    iss: text(issuedAt) || new Date().toISOString(),
    exp: text(expiresAt),
  };
}

/** Signs a payload with the operator's private key (PEM, PKCS#8). */
export function signLicence(payload, privateKeyPem) {
  const body = b64u(JSON.stringify(payload));
  const signature = signRaw(null, Buffer.from(body), privateKeyPem);
  return `${LICENCE_PREFIX}.${body}.${b64u(signature)}`;
}

/**
 * Verifies a key against the public key. Never throws: every failure is a reason.
 *
 * @returns {{ok: boolean, reason?: string, payload?: object, expiresAt?: string}}
 */
export function verifyLicence(key, { publicKey = DEFAULT_PUBLIC_KEY, now = Date.now() } = {}) {
  const parts = String(key ?? '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== LICENCE_PREFIX) return { ok: false, reason: 'not-a-licence-key' };
  const [, body, signature] = parts;

  let payload;
  try {
    payload = JSON.parse(fromB64u(body).toString('utf8'));
  } catch {
    return { ok: false, reason: 'unreadable-payload' };
  }
  if (!payload || typeof payload !== 'object' || payload.v !== 1) return { ok: false, reason: 'unknown-version' };

  let good = false;
  try {
    good = verifyRaw(null, Buffer.from(body), loadPublicKey(publicKey), fromB64u(signature));
  } catch {
    good = false;
  }
  if (!good) return { ok: false, reason: 'bad-signature' };

  if (!text(payload.exp)) return { ok: false, reason: 'no-expiry' };
  const expires = Date.parse(payload.exp);
  if (!Number.isFinite(expires)) return { ok: false, reason: 'unreadable-expiry' };
  if (expires <= now) return { ok: false, reason: 'expired', payload };

  return { ok: true, payload, expiresAt: payload.exp, daysLeft: Math.ceil((expires - now) / 86_400_000) };
}

/**
 * What the process must do before it may serve anything.
 *
 * `cloud` is the operator's own instance (the paid tier): it needs no licence,
 * because it *is* the service. Everything else is a self-hosted install, and it
 * must present a valid key or refuse to start — a lock that only warns is a lock
 * nobody buys.
 *
 * @returns {{ok: boolean, mode: 'cloud'|'selfhosted', licence?: object, error?: string}}
 */
export function startupLicence(env = process.env, { now = Date.now() } = {}) {
  const mode = text(env.FYRHAVEN_MODE) === 'cloud' ? 'cloud' : 'selfhosted';
  if (mode === 'cloud') return { ok: true, mode };
  const key = text(env.FYRHAVEN_LICENCE);
  if (!key) return { ok: false, mode, error: 'FYRHAVEN_LICENCE is not set — a self-hosted install needs a licence key.' };
  const answer = verifyLicence(key, { publicKey: publicKeyOf(env), now });
  if (!answer.ok) return { ok: false, mode, error: `The licence key is not valid (${answer.reason}).` };
  return { ok: true, mode, licence: { ...answer.payload, daysLeft: answer.daysLeft } };
}

/** A keypair for the operator to generate once, offline. */
export function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

/** One licence, as a human reads it. */
export function describeLicence(licence) {
  if (!licence) return 'none';
  return `${licence.plan} for ${licence.sub || 'unknown'}, expires ${String(licence.exp).slice(0, 10)}`;
}
