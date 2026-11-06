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

import {
  createPrivateKey, createPublicKey, generateKeyPairSync, sign as signRaw, verify as verifyRaw,
} from 'node:crypto';
import { DISTRIBUTION } from './distribution.js';

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
export function licencePayload({ subject, plan = 'selfhosted', seats = 1, issuedAt, expiresAt, fingerprint = '' }) {
  return {
    v: 1,
    sub: text(subject).slice(0, 200),
    plan: LICENCE_PLANS.includes(plan) ? plan : 'selfhosted',
    seats: Number.isFinite(Number(seats)) ? Math.max(1, Math.round(Number(seats))) : 1,
    iss: text(issuedAt) || new Date().toISOString(),
    exp: text(expiresAt),
    // The installation this key opens. Empty means "any" (keys issued before
    // activation existed), so an old key keeps working.
    fp: text(fingerprint),
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
export function verifyLicence(key, { publicKey = DEFAULT_PUBLIC_KEY, now = Date.now(), fingerprint = '' } = {}) {
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

  // A key that names an installation only opens that one: a licence copied to a
  // second server is not a licence for a second server.
  const bound = text(payload.fp);
  if (bound && text(fingerprint) && bound !== text(fingerprint)) {
    return { ok: false, reason: 'wrong-installation', payload };
  }
  if (bound && !text(fingerprint)) return { ok: false, reason: 'wrong-installation', payload };

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
export function startupLicence(env = process.env, { now = Date.now(), distribution = DISTRIBUTION } = {}) {
  const mode = text(env.FYRHAVEN_MODE) === 'cloud' ? 'cloud' : 'selfhosted';
  if (mode === 'cloud') {
    // The cloud is a build, not a switch. In the self-hosted artifact this
    // constant is compiled to 'selfhosted', so the customer's copy cannot be
    // turned into the operator's service by editing a compose file — which is
    // what `FYRHAVEN_MODE=cloud` used to do for anyone who set it.
    if (distribution !== 'cloud') {
      return {
        ok: false,
        mode,
        error: 'This is the self-hosted build, which has no cloud mode.',
      };
    }
    return { ok: true, mode };
  }
  const key = text(env.FYRHAVEN_LICENCE);
  if (!key) return { ok: false, mode, error: 'FYRHAVEN_LICENCE is not set — a self-hosted install needs a licence key.' };
  const answer = verifyLicence(key, { publicKey: publicKeyOf(env), now, fingerprint: text(env.FYRHAVEN_INSTALL_KEY) });
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

// ── Installation identity and activation (#148, the other half) ──────────────
//
// A licence bound to nothing can be copied from one customer to the next. So the
// server owns an **installation key**, generated once, stored beside its database
// and shown to the operator — who either pastes it into the website (offline
// activation) or lets the server present it to the licensing service itself
// (online activation). Either way the licence carries the fingerprint, and a key
// issued for one installation does not open another.

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Unambiguous alphabet: no O/0, no I/1 — this gets typed by a human. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** `FHI-XXXX-XXXX-XXXX-XXXX` — an installation, not a licence. */
export function newInstallKey() {
  const block = () => Array.from(randomBytes(4)).map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `FHI-${block()}-${block()}-${block()}-${block()}`;
}

export const isInstallKey = (value) => /^FHI-[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(text(value));

/**
 * The installation key, created on first use and kept on the volume.
 *
 * It must survive a restart — a licence bound to it would otherwise invalidate
 * itself every time the container is recreated — so it is a file next to the
 * database, not a value in memory.
 */
export function ensureInstallKey(path = '/data/install.key') {
  try {
    const existing = text(readFileSync(path, 'utf8'));
    if (isInstallKey(existing)) return existing;
  } catch {
    // first boot
  }
  const key = newInstallKey();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${key}\n`, { mode: 0o600 });
  } catch {
    // an unwritable volume still lets the install run, unlicensed-bound
  }
  return key;
}

/**
 * Asks the licensing service for a key for this installation (online activation).
 *
 * The caller presents the **account token** it was given when it signed up — the
 * same bearer the plugin uses — so the service knows whose subscription this is
 * without another credential. A refused or unreachable service is an answer, not
 * a throw: the install keeps running on its last good licence.
 *
 * @returns {Promise<{status: 'ok'|'unconfigured'|'failed', licence?: string, expiresAt?: string, reason?: string}>}
 */
export async function activateOnline({
  url, token, fingerprint, fetch = globalThis.fetch,
}) {
  const base = text(url).replace(/\/+$/, '');
  if (!base || !text(token)) return { status: 'unconfigured' };
  if (!isInstallKey(fingerprint)) return { status: 'failed', reason: 'no installation key' };
  try {
    const response = await fetch(`${base}/v1/licence/activate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ fingerprint }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) return { status: 'failed', reason: payload?.error ?? `HTTP ${response.status}` };
    if (!text(payload?.licence)) return { status: 'failed', reason: 'no licence in the answer' };
    return { status: 'ok', licence: payload.licence, expiresAt: payload.expiresAt };
  } catch (err) {
    return { status: 'failed', reason: String(err?.message ?? err) };
  }
}

// ── Deactivation, so one licence cannot run on two servers ───────────────────
//
// The problem: a key is copied, two servers claim one licence, and nothing on
// earth stops the second one. The fix has to work **without the server being
// able to forge its own release**, so it is a round trip in three steps:
//
//   1. the server mints a **challenge** — its fingerprint and a one-time nonce;
//   2. the operator takes it to the service, which releases that installation
//      and hands back a **signed code** naming the same fingerprint and nonce;
//   3. the server verifies the code against the public key before it forgets the
//      licence.
//
// A customer cannot mint step 2 (it is signed by the seller), and the same
// challenge cannot be spent twice (the nonce is remembered until it is used).

export const DEACTIVATION_PREFIX = 'DH1';

/** Step 1: the server's side of the bargain. */
export function deactivationChallenge(fingerprint, { now = Date.now() } = {}) {
  return Buffer.from(JSON.stringify({
    fp: text(fingerprint), nonce: randomBytes(12).toString('base64url'), iss: new Date(now).toISOString(),
  })).toString('base64url');
}

/** Reads a challenge without trusting it — the service only needs `fp`/`nonce`. */
export function readChallenge(challenge) {
  try {
    const parsed = JSON.parse(Buffer.from(String(challenge ?? ''), 'base64url').toString('utf8'));
    if (!parsed || !isInstallKey(parsed.fp) || !text(parsed.nonce)) return null;
    return { fp: parsed.fp, nonce: parsed.nonce, iss: text(parsed.iss) };
  } catch {
    return null;
  }
}

/** Step 2: the service releases the installation, in a code the server can check. */
export function signDeactivation({ fingerprint, nonce }, privateKeyPem, { now = Date.now(), minutes = 60 } = {}) {
  const payload = {
    v: 1,
    fp: text(fingerprint),
    nonce: text(nonce),
    exp: new Date(now + minutes * 60_000).toISOString(),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = signRaw(null, Buffer.from(body), privateKeyPem);
  return `${DEACTIVATION_PREFIX}.${body}.${Buffer.from(signature).toString('base64url')}`;
}

/** Step 3: the server checks the release before dropping its licence. */
export function verifyDeactivation(code, { publicKey = DEFAULT_PUBLIC_KEY, fingerprint = '', nonce = '', now = Date.now() } = {}) {
  const parts = String(code ?? '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== DEACTIVATION_PREFIX) return { ok: false, reason: 'not-a-deactivation-code' };
  const [, body, signature] = parts;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'unreadable-payload' };
  }
  let good = false;
  try {
    good = verifyRaw(null, Buffer.from(body), loadPublicKey(publicKey), Buffer.from(signature, 'base64url'));
  } catch {
    good = false;
  }
  if (!good) return { ok: false, reason: 'bad-signature' };
  if (text(payload.fp) !== text(fingerprint)) return { ok: false, reason: 'wrong-installation' };
  if (text(payload.nonce) !== text(nonce)) return { ok: false, reason: 'wrong-challenge' };
  if (!(Date.parse(payload.exp) > now)) return { ok: false, reason: 'expired' };
  return { ok: true, payload };
}
