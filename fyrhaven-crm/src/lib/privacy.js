// The GDPR toolkit (#26): answering a data-subject request — what personal
// data a contact holds, the export that hands it back, and the erasure that
// removes it — plus the proof-of-deletion log that says what was removed.
//
// Pure model, plus the deletion-log store and the two writes, in the same
// shape `bulk.js` uses: the caller confirms, these functions do the work and
// record it. The writes reuse the paths that already exist — a delete leaves
// the same undo record every other delete does — so nothing here is a second
// way to remove a contact.

import { contactName, emailEntries, phoneEntries, text } from './contacts.js';
import { eraseConsents, removeConsent, setConsent } from './consent.js';
import { eraseNotes } from './notes.js';
import { deleteContacts } from './bulk.js';
import { recordHistory } from './history.js';
import { toCsv } from './csv.js';

/**
 * The fields that hold personal data, in the order the export lists them.
 * `id` and `addressBookIds` are deliberately absent: the host's id and the
 * books a card sits in are structural, not the person's data.
 */
export const PERSONAL_FIELDS = [
  'name', 'nicknames', 'emails', 'phones', 'addresses', 'organizations',
  'titles', 'notes', 'anniversaries', 'onlineServices', 'media',
  'personalInfo', 'pronouns', 'speakToAs', 'preferredLanguages', 'members', 'keywords',
];

/** The placeholder a tombstone keeps where the name was. */
export const ANONYMISED_NAME = '[anonymised]';

const hasContent = (value) => {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
};

/** Which personal fields a card actually holds, and how many addresses/numbers. */
export function personalDataInventory(card) {
  const fields = PERSONAL_FIELDS.filter((field) => hasContent(card?.[field]));
  return {
    fields,
    emails: emailEntries(card).length,
    phones: phoneEntries(card).length,
    empty: fields.length === 0,
  };
}

/**
 * The patch that turns a card into a tombstone: every personal field cleared
 * (the host clears a field sent as `undefined`, the same way undo does), a
 * placeholder name, and a keyword that keeps the card out of duplicate
 * detection however the host spells its `kind`.
 */
export function anonymisePatch(card, { name = ANONYMISED_NAME } = {}) {
  const patch = {};
  for (const field of PERSONAL_FIELDS) patch[field] = undefined;
  patch.name = { full: text(name) || ANONYMISED_NAME };
  patch.kind = 'individual';
  patch.keywords = { anonymised: true };
  return patch;
}

/**
 * Everything the plugin holds about one subject, as one JSON-ready object:
 * the card in full, the consent records, and the plugin's own changes that
 * name the subject. `generatedAt` is the request time, so the file says when
 * it was answered.
 */
export function buildSubjectExport({ card, consents = [], history = [], notes = [], now = Date.now() } = {}) {
  const id = text(card?.id);
  return {
    generatedAt: new Date(now).toISOString(),
    subject: { id, name: contactName(card) },
    data: card ?? null,
    // The private notes are held about this person, so a subject-access export
    // has to hand them back — completeness is the point of the export.
    notes: Array.isArray(notes) ? notes : [],
    consents: (Array.isArray(consents) ? consents : []).filter((record) => record?.contactId === id),
    changes: (Array.isArray(history) ? history : []).filter((entry) => entry?.subject && entry.subject === id),
  };
}

/** The subject export as pretty JSON, the format a DSR is answered in. */
export function subjectExportJson(bundle) {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

/** A file name for the export, derived from the subject and the format. */
export function subjectExportName(card, format = 'json') {
  const base = (contactName(card) || text(card?.id) || 'contact')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'contact';
  if (format === 'json') return `${base}.json`;
  return format === 'csv' ? `${base}.csv` : `${base}.vcf`;
}

// ── The proof-of-deletion log ──────────────────────────────────

export const DELETION_KEY = 'deletionLog';
export const MAX_DELETIONS = 200;

/**
 * One proof-of-deletion entry. It records the **id**, the method and which
 * fields were cleared — never the name or any other value the erasure removed.
 * A log that kept the name would put back the data the erasure was for.
 */
export function normalizeDeletion(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = text(raw.id);
  const method = raw.method === 'anonymise' ? 'anonymise' : raw.method === 'erase' ? 'erase' : '';
  if (!id || !method) return null;
  return {
    at: Number.isFinite(Number(raw.at)) ? Number(raw.at) : 0,
    id,
    method,
    fields: [...new Set((Array.isArray(raw.fields) ? raw.fields : []).map(text).filter(Boolean))].slice(0, 40),
    books: [...new Set((Array.isArray(raw.books) ? raw.books : []).map(text).filter(Boolean))].slice(0, 40),
  };
}

/** Repaired, newest first, capped. */
export function normalizeDeletions(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map(normalizeDeletion)
    .filter(Boolean)
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_DELETIONS);
}

/** The deletion log, repaired. Rewrites storage when it dropped junk. */
export async function readDeletions(api) {
  const stored = await api.storage.get(DELETION_KEY);
  const list = Array.isArray(stored) ? stored : [];
  const entries = normalizeDeletions(list);
  if (entries.length !== list.length) {
    if (entries.length) await api.storage.set(DELETION_KEY, entries);
    else await api.storage.remove(DELETION_KEY);
  }
  return entries;
}

/**
 * Records one deletion. Never throws at its caller: the erasure happened, and
 * reporting it as failed because the note about it could not be stored would
 * be a lie in the other direction — the same rule the change history follows.
 */
export async function recordDeletion(api, entry, now = Date.now()) {
  const clean = normalizeDeletion({ ...entry, at: now });
  if (!clean) return null;
  try {
    const kept = normalizeDeletions([clean, ...(await readDeletions(api))]);
    await api.storage.set(DELETION_KEY, kept);
    return clean;
  } catch {
    return null;
  }
}

/** Headline numbers for the deletion log. */
export function deletionSummary(deletions) {
  const list = normalizeDeletions(deletions);
  return {
    total: list.length,
    erased: list.filter((entry) => entry.method === 'erase').length,
    anonymised: list.filter((entry) => entry.method === 'anonymise').length,
  };
}

/** The deletion log as a CSV report — the artefact a DSR audit asks for. */
export function deletionsToCsv(deletions) {
  const rows = [['Erased at', 'Subject id', 'Method', 'Fields', 'Address books']];
  for (const entry of normalizeDeletions(deletions)) {
    rows.push([
      new Date(entry.at).toISOString(),
      entry.id,
      entry.method,
      entry.fields.join(' '),
      entry.books.join(' '),
    ]);
  }
  return toCsv(rows);
}

// ── The two writes ─────────────────────────────────────────────

/** The books a card sits in, as ids. */
const bookIdsOf = (card) => Object.keys(card?.addressBookIds ?? {}).filter(Boolean);

/**
 * Anonymises a subject: overwrites every personal field, drops its consent
 * records, and writes the proof-of-deletion entry. The card itself stays, as a
 * tombstone, so nothing that pointed at it dangles. Returns what it cleared.
 */
export async function anonymiseSubject(api, card, { now = Date.now(), name } = {}) {
  const id = text(card?.id);
  if (!id) return { anonymised: false, fields: [], consents: 0 };
  const inventory = personalDataInventory(card);
  const books = bookIdsOf(card);
  await api.contacts.update(id, anonymisePatch(card, { name }));
  const consents = await eraseConsents(api, id);
  // The private notes are personal data this browser holds; an anonymisation
  // that left them behind would not be one.
  const notes = await eraseNotes(api, id);
  await recordDeletion(api, { id, method: 'anonymise', fields: inventory.fields, books }, now);
  await recordHistory(api, { kind: 'anonymise', contacts: 1, subject: id, detail: 'anonymise' }, now);
  return { anonymised: true, fields: inventory.fields, consents, notes };
}

/**
 * Erases a subject: deletes the card through the one delete path (so it leaves
 * the same undo record every other delete does), drops its consent records,
 * and writes the proof-of-deletion entry. Returns what it removed.
 */
export async function eraseSubject(api, card, { now = Date.now() } = {}) {
  const id = text(card?.id);
  if (!id) return { erased: false, fields: [], consents: 0, failed: 0 };
  const inventory = personalDataInventory(card);
  const books = bookIdsOf(card);
  const result = await deleteContacts(api, [card], { kind: 'erase' });
  if (!result.deleted) return { erased: false, fields: [], consents: 0, notes: 0, failed: result.failed };
  const consents = await eraseConsents(api, id);
  // Erasure has to take the private notes with it, or it is a half-measure.
  const notes = await eraseNotes(api, id);
  await recordDeletion(api, { id, method: 'erase', fields: inventory.fields, books }, now);
  return { erased: true, fields: inventory.fields, consents, notes, failed: 0 };
}

/** Saves a consent and audits the change, so the history says who consented. */
export async function saveConsent(api, record, now = Date.now()) {
  const saved = await setConsent(api, record);
  if (saved) {
    await recordHistory(api, { kind: 'consent', contacts: 1, subject: saved.contactId, detail: saved.source }, now);
  }
  return saved;
}

/** Removes a consent and audits the change. */
export async function deleteConsent(api, contactId, source, now = Date.now()) {
  const removed = await removeConsent(api, contactId, source);
  if (removed) {
    await recordHistory(api, { kind: 'consent', contacts: 1, subject: text(contactId), detail: text(source) }, now);
  }
  return removed;
}
