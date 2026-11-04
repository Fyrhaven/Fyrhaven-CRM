// Private notes about a contact (#38, the private half).
//
// The host has no note *record* per contact: JSContact's `notes` field is a field
// ON the card, so everyone who can see the card sees it. A note that is private
// to one browser therefore cannot be a card field — it is a record ABOUT the
// contact, kept through the storage seam (#68) on the customer's own server, in
// the same shape as the consent records and the change history. Nothing shared
// can read it as a card field, because it never is one.
//
// Pure model plus the storage seam — no DOM. The UI is notes-section.js.

import { read, remove, write } from './store.js';

export const NOTES_KEY = 'contactNotes';
/** Across every contact… */
export const MAX_NOTES = 500;
/** …and per contact. */
export const MAX_PER_CONTACT = 50;
export const MAX_LENGTH = 2000;

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** `@` followed by a word — the way a mention is written. */
const MENTION = /@([\p{L}\p{N}._-]+)/gu;

/** The names a note mentions, folded to lower case and de-duplicated. */
export function mentionsIn(value) {
  const found = String(value ?? '').match(MENTION) ?? [];
  return [...new Set(found.map((token) => token.slice(1).toLowerCase()))];
}

/** One note, repaired. A note with no id or no text is corruption, not a note. */
export function normalizeNote(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = text(raw.id);
  const body = text(raw.text).slice(0, MAX_LENGTH);
  if (!id || !body) return null;
  return { id, at: text(raw.at), text: body };
}

/** The whole store, repaired: only real contacts, only real notes, capped. */
export function normalizeNotes(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  let total = 0;
  for (const [contactId, list] of Object.entries(raw)) {
    const id = text(contactId);
    if (!id || !Array.isArray(list)) continue;
    const seen = new Set();
    const notes = [];
    for (const item of list) {
      const note = normalizeNote(item);
      if (!note || seen.has(note.id)) continue;
      seen.add(note.id);
      notes.push(note);
      if (notes.length >= MAX_PER_CONTACT) break;
    }
    if (!notes.length) continue;
    if (total + notes.length > MAX_NOTES) break;
    out[id] = notes;
    total += notes.length;
  }
  return out;
}

/**
 * Read the store; rewrites when junk was dropped.
 *
 * Through the seam (#68), so a note lives on a server rather than only in this
 * browser. An unavailable store reads as no notes, so the section can say what
 * is missing instead of failing to draw.
 */
export async function readNotes(api) {
  const answer = await read(api, NOTES_KEY);
  const stored = answer.status === 'ok' ? answer.value : null;
  const raw = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  const notes = normalizeNotes(raw);
  if (answer.status === 'ok' && JSON.stringify(notes) !== JSON.stringify(raw)) {
    if (Object.keys(notes).length) await write(api, NOTES_KEY, notes);
    else await remove(api, NOTES_KEY);
  }
  return notes;
}

/** Write the whole store. An empty store removes the key. */
export async function writeNotes(api, all) {
  const clean = normalizeNotes(all);
  const answer = Object.keys(clean).length
    ? await write(api, NOTES_KEY, clean)
    : await remove(api, NOTES_KEY);
  // A note with nowhere to live must not look like it was kept.
  if (answer.status !== 'ok') throw new Error(answer.reason ?? 'unconfigured');
  return clean;
}

/** The notes about one contact, newest first. */
export function notesFor(all, contactId) {
  const list = all?.[text(contactId)];
  return (Array.isArray(list) ? [...list] : []).sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** An id for a new note. The clock is injectable, so a test is deterministic. */
export function noteId(now = Date.now()) {
  return `n${now.toString(36)}`;
}

/** A new note, or null when there is nothing to say. */
export function makeNote(value, { id, now = Date.now() } = {}) {
  const body = text(value).slice(0, MAX_LENGTH);
  if (!body) return null;
  return { id: text(id) || noteId(now), at: new Date(now).toISOString(), text: body };
}

/** Store a note about a contact; returns the repaired store. */
export async function saveNote(api, contactId, value, { id, now = Date.now() } = {}) {
  const all = await readNotes(api);
  const id2 = text(contactId);
  const note = makeNote(value, { id, now });
  if (!id2 || !note) return all;
  const list = [note, ...(all[id2] ?? [])].slice(0, MAX_PER_CONTACT);
  return writeNotes(api, { ...all, [id2]: list });
}

/** Drop one note; returns what is left. */
export async function deleteNote(api, contactId, noteId2) {
  const all = await readNotes(api);
  const id = text(contactId);
  const wanted = text(noteId2);
  const list = (all[id] ?? []).filter((note) => note.id !== wanted);
  const next = { ...all };
  if (list.length) next[id] = list;
  else delete next[id];
  return writeNotes(api, next);
}

/**
 * Forget every note about a contact — the erasure path (#26). A data-subject
 * erasure has to take the notes with it, or the erasure is a half-measure.
 */
export async function eraseNotes(api, contactId) {
  const all = await readNotes(api);
  const id = text(contactId);
  const removed = (all[id] ?? []).length;
  if (!removed) return 0;
  const next = { ...all };
  delete next[id];
  await writeNotes(api, next);
  return removed;
}
