// Consent records (#26): the lawful basis a contact is held on, per source,
// with an expiry — the record a data-subject request is answered from.
//
// Kept in api.storage — per account *and* per browser, like the projects, the
// saved searches and the history — because the host has no consent field and
// inventing one on the contact card would put data the user did not type into
// their address book. It is a record *about* a contact, never the contact
// itself: the person stays a real JSContact card. Pure plus api.storage; no DOM.

import { text } from './contacts.js';

export const CONSENT_KEY = 'consentRecords';
export const MAX_CONSENTS = 1000;
const MAX_NOTE = 200;
const MAX_SOURCE = 60;

/**
 * The lawful bases of GDPR Art. 6. Kept as the six the regulation names, so a
 * record can say *why* the data is held rather than only *that* it is. The
 * plugin does not judge which basis applies — that is the controller's call.
 */
export const LAWFUL_BASES = [
  'consent', 'contract', 'legal-obligation', 'legitimate-interest', 'vital-interest', 'public-task',
];
export const DEFAULT_BASIS = 'consent';

/** A record that has not expired yet but is within this many days is "expiring". */
export const EXPIRING_DAYS = 30;

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` from anything date-ish, or '' — the form an `<input type=date>` uses. */
export function isoDate(value) {
  if (value === null || value === undefined || value === '') return '';
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toISOString().slice(0, 10);
}

/** Midnight UTC of a date as ms, or null when there is no usable date. */
export function dateMs(value) {
  const iso = isoDate(value);
  return iso ? Date.parse(`${iso}T00:00:00Z`) : null;
}

/** The identity of a consent: one per (contact, source), source case-insensitive. */
export function consentKey(record) {
  return `${text(record?.contactId)}\u0000${text(record?.source).toLowerCase()}`;
}

/** One record, repaired; null when it says nothing usable. */
export function normalizeConsent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const contactId = text(raw.contactId);
  const source = text(raw.source);
  if (!contactId || !source) return null;
  return {
    contactId,
    source: source.slice(0, MAX_SOURCE),
    basis: LAWFUL_BASES.includes(raw.basis) ? raw.basis : DEFAULT_BASIS,
    grantedAt: isoDate(raw.grantedAt),
    expiresAt: isoDate(raw.expiresAt) || null,
    note: text(raw.note).slice(0, MAX_NOTE),
  };
}

/**
 * Repaired, de-duplicated by (contact, source) — first occurrence wins, so a
 * list stored newest-first keeps the newest — sorted by grant date and capped.
 */
export function normalizeConsents(raw) {
  const seen = new Map();
  for (const item of Array.isArray(raw) ? raw : []) {
    const record = normalizeConsent(item);
    if (!record) continue;
    const key = consentKey(record);
    if (!seen.has(key)) seen.set(key, record);
  }
  return [...seen.values()]
    .sort((a, b) => (dateMs(b.grantedAt) ?? 0) - (dateMs(a.grantedAt) ?? 0))
    .slice(0, MAX_CONSENTS);
}


/** The consent records, repaired. Rewrites storage when it dropped junk. */
export async function readConsents(api) {
  const stored = await api.storage.get(CONSENT_KEY);
  const list = Array.isArray(stored) ? stored : [];
  const records = normalizeConsents(list);
  if (records.length !== list.length) {
    if (records.length) await api.storage.set(CONSENT_KEY, records);
    else await api.storage.remove(CONSENT_KEY);
  }
  return records;
}

/** The records held for one contact. */
export function consentsFor(records, contactId) {
  const id = text(contactId);
  if (!id) return [];
  return (Array.isArray(records) ? records : []).filter((record) => record?.contactId === id);
}

/** Adds or replaces the record for its (contact, source). Returns it, or null. */
export async function setConsent(api, raw) {
  const record = normalizeConsent(raw);
  if (!record) return null;
  const key = consentKey(record);
  const kept = [record, ...(await readConsents(api)).filter((item) => consentKey(item) !== key)];
  await api.storage.set(CONSENT_KEY, normalizeConsents(kept));
  return record;
}

/** Removes the record for one (contact, source). Returns whether one went. */
export async function removeConsent(api, contactId, source) {
  const key = consentKey({ contactId, source });
  const all = await readConsents(api);
  const kept = all.filter((item) => consentKey(item) !== key);
  if (kept.length === all.length) return false;
  if (kept.length) await api.storage.set(CONSENT_KEY, kept);
  else await api.storage.remove(CONSENT_KEY);
  return true;
}

/** Drops every record for a contact — part of erasing it. Returns how many. */
export async function eraseConsents(api, contactId) {
  const id = text(contactId);
  if (!id) return 0;
  const all = await readConsents(api);
  const kept = all.filter((item) => item.contactId !== id);
  if (kept.length !== all.length) {
    if (kept.length) await api.storage.set(CONSENT_KEY, kept);
    else await api.storage.remove(CONSENT_KEY);
  }
  return all.length - kept.length;
}

/** Whole days until the expiry, or null when the record never expires. */
export function daysUntilExpiry(record, now = Date.now()) {
  const at = dateMs(record?.expiresAt);
  if (at === null) return null;
  return Math.floor((at - now) / DAY_MS);
}

/** `'expired'`, `'expiring'` (within EXPIRING_DAYS), `'active'`, or `'none'`. */
export function consentStatus(record, now = Date.now()) {
  if (!record) return 'none';
  const days = daysUntilExpiry(record, now);
  if (days === null) return 'active';
  if (days < 0) return 'expired';
  if (days <= EXPIRING_DAYS) return 'expiring';
  return 'active';
}

/** Totals for the page's headline. */
export function consentSummary(records, now = Date.now()) {
  const counts = { total: 0, active: 0, expiring: 0, expired: 0, subjects: 0, sources: 0 };
  const subjects = new Set();
  const sources = new Set();
  for (const record of Array.isArray(records) ? records : []) {
    counts.total += 1;
    const status = consentStatus(record, now);
    if (status === 'expired') counts.expired += 1;
    else if (status === 'expiring') counts.expiring += 1;
    else counts.active += 1;
    subjects.add(record.contactId);
    sources.add(record.source.toLowerCase());
  }
  counts.subjects = subjects.size;
  counts.sources = sources.size;
  return counts;
}
