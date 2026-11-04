// Normalising a selection: phone numbers to E.164, email addresses trimmed and
// lower-cased.
//
// Pure planning, plus api.storage / api.contacts calls; no DOM.
//
// The plan is what the dialog shows *before* anything is written, and it is
// also what makes a batch reversible: each entry keeps the values it replaced,
// so undoing is one patch per contact — no guessing, no re-deriving.

import { contactName, text } from './contacts.js';
import { recordHistory } from './history.js';
import { toE164 } from './phones.js';
import { undoWindowMs } from './undo.js';

export const REGION_KEY = 'normalizeRegion';
export const CLEANUP_KEY = 'lastCleanup';
export const MAX_CLEANUP_CARDS = 200;
const MAX_CLEANUP_BYTES = 400_000;

/** The stored region, or '' when the user has not chosen one. */
export async function readRegion(api) {
  const stored = await api.storage.get(REGION_KEY);
  return typeof stored === 'string' ? stored.trim().toUpperCase() : '';
}

/** Stores the region; an empty string clears it. */
export async function writeRegion(api, region) {
  const clean = String(region ?? '').trim().toUpperCase();
  if (clean) await api.storage.set(REGION_KEY, clean);
  else await api.storage.remove(REGION_KEY);
  return clean;
}

/** One address normalised: trimmed, lower-cased. */
const cleanEmail = (address) => text(address).toLowerCase();

/**
 * What would change for one contact, or `null` when nothing would.
 *
 * The patch carries the **complete** new map for a field, because the host
 * replaces a map wholesale — sending only the changed entries would drop the
 * others. `before` holds the maps about to be replaced, which is what makes the
 * batch reversible.
 */
export function planCard(card, { region = '' } = {}) {
  const changes = [];
  const before = {};
  const patch = {};

  const phones = { ...(card?.phones ?? {}) };
  let phonesChanged = false;
  for (const [key, entry] of Object.entries(card?.phones ?? {})) {
    // Compare against the stored value, not a trimmed copy: a number that
    // differs only by spacing is exactly what normalising is for.
    const raw = typeof entry?.number === 'string' ? entry.number : '';
    if (!raw.trim()) continue;
    const e164 = toE164(raw, region);
    if (!e164 || e164 === raw) continue;
    phones[key] = { ...entry, number: e164 };
    phonesChanged = true;
    changes.push({ field: 'phones', from: raw, to: e164 });
  }
  if (phonesChanged) {
    patch.phones = phones;
    before.phones = structuredClone(card.phones);
  }

  const emails = { ...(card?.emails ?? {}) };
  let emailsChanged = false;
  for (const [key, entry] of Object.entries(card?.emails ?? {})) {
    const raw = typeof entry?.address === 'string' ? entry.address : '';
    const cleaned = cleanEmail(raw);
    if (!cleaned || cleaned === raw) continue;
    emails[key] = { ...entry, address: cleaned };
    emailsChanged = true;
    changes.push({ field: 'emails', from: raw, to: cleaned });
  }
  if (emailsChanged) {
    patch.emails = emails;
    before.emails = structuredClone(card.emails);
  }

  if (!changes.length) return null;
  return { id: card.id, name: contactName(card) || card.id, patch, before, changes };
}

/** The contacts that would change, in list order. */
export function planNormalisation(cards, { region = '' } = {}) {
  return (Array.isArray(cards) ? cards : [])
    .map((card) => (card?.id ? planCard(card, { region }) : null))
    .filter(Boolean);
}

/** What the plan would touch, for a summary line. */
export function planCounts(plan) {
  const items = Array.isArray(plan) ? plan : [];
  return {
    contacts: items.length,
    phones: items.reduce((n, item) => n + item.changes.filter((c) => c.field === 'phones').length, 0),
    emails: items.reduce((n, item) => n + item.changes.filter((c) => c.field === 'emails').length, 0),
  };
}

/** The live cleanup record, or `null`; an expired record is dropped. */
export async function readCleanup(api, now = Date.now()) {
  const stored = await api.storage.get(CLEANUP_KEY);
  if (!stored || typeof stored !== 'object' || typeof stored.expiresAt !== 'number'
    || !Array.isArray(stored.entries) || !stored.entries.length) {
    return null;
  }
  if (stored.expiresAt <= now) {
    await api.storage.remove(CLEANUP_KEY);
    return null;
  }
  return stored;
}

/** Keeps the record of a batch, bounded by the undo window and by size. */
async function saveCleanup(api, entries, now = Date.now()) {
  const windowMs = undoWindowMs(api.plugin?.settings);
  const kept = entries.slice(0, MAX_CLEANUP_CARDS);
  const record = { at: now, expiresAt: now + windowMs, entries: kept };
  if (!windowMs || !kept.length || JSON.stringify(record).length > MAX_CLEANUP_BYTES) {
    await api.storage.remove(CLEANUP_KEY);
    return 0;
  }
  await api.storage.set(CLEANUP_KEY, record);
  return kept.length;
}

/**
 * Writes a plan: one update per contact, then one record holding what was
 * replaced. A contact the host refuses is counted in `failed` and left out of
 * the record, so undoing never reverts a change that was never made.
 */
export async function applyNormalisation(api, plan, options = {}) {
  // `now` used to be the third positional argument; a plain number still means
  // "the time", so older callers keep working.
  const { now = Date.now(), kind = 'cleanup' } = typeof options === 'number' ? { now: options } : options;
  const entries = [];
  let failed = 0;
  for (const item of Array.isArray(plan) ? plan : []) {
    try {
      await api.contacts.update(item.id, item.patch);
      entries.push({ id: item.id, before: item.before });
    } catch {
      failed += 1;
    }
  }
  const undoable = await saveCleanup(api, entries, now);
  if (entries.length) {
    await recordHistory(api, { kind, contacts: entries.length, undoable: undoable > 0 }, now);
  }
  return { updated: entries.length, failed, undoable };
}

/**
 * Puts every contact of the live record back as it was. Entries that fail stay
 * in the record, so the undo can be retried.
 */
export async function undoCleanup(api, now = Date.now()) {
  const record = await readCleanup(api, now);
  if (!record) return { restored: 0, failed: 0 };
  let restored = 0;
  const leftover = [];
  for (const entry of record.entries) {
    try {
      await api.contacts.update(entry.id, entry.before);
      restored += 1;
    } catch {
      leftover.push(entry);
    }
  }
  if (leftover.length) await api.storage.set(CLEANUP_KEY, { ...record, entries: leftover });
  else await api.storage.remove(CLEANUP_KEY);
  return { restored, failed: leftover.length };
}
