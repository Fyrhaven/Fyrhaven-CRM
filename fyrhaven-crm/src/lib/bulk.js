// Bulk actions on a hand-picked selection of contacts.
//
// Merging a selection is deliberately **not** done here: the review dialog owns
// every merge, so a selection is turned into a group by `groupFromSelection`
// and handed to it, and the keep selector, conflict resolution, danger confirm
// and undo all come along for free.
//
// Deleting has no plan to review, so it happens here. It is still gated: the
// caller confirms first, and the removed cards go into an undo batch, so a bulk
// delete is as recoverable as a merge.
//
// Pure api calls; no DOM.

import { recordHistory } from './history.js';
import { saveUndo } from './undo.js';

/**
 * `keywords: { name: true }` marks a contact as a company rather than a person.
 * It is structure, not a label, so a bulk tag edit must never remove it.
 */
export const COMPANY_KEYWORD = 'company';

/** Trimmed, non-empty, de-duplicated tag names. */
const cleanTags = (values) => [...new Set(
  (Array.isArray(values) ? values : String(values ?? '').split(','))
    .map((value) => String(value ?? '').trim())
    .filter(Boolean),
)];

/** Tag names from a comma-separated string (or an array). */
export const parseTags = (values) => cleanTags(values);

const sameMap = (a, b) => {
  const left = Object.entries(a ?? {}).filter(([, on]) => on).map(([key]) => key).sort();
  const right = Object.entries(b ?? {}).filter(([, on]) => on).map(([key]) => key).sort();
  return left.length === right.length && left.every((key, i) => key === right[i]);
};

/**
 * Runs one update per card and counts what the host refused.
 *
 * `patchOf` returns the patch to send, `null` when there is nothing to change,
 * or `false` when the card cannot be changed at all — counted as failed, never
 * silently dropped.
 */
async function updateEach(api, cards, patchOf) {
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  for (const card of Array.isArray(cards) ? cards : []) {
    const patch = patchOf(card);
    if (patch === false) {
      failed += 1;
      continue;
    }
    if (!patch) {
      skipped += 1;
      continue;
    }
    try {
      await api.contacts.update(card.id, patch);
      updated += 1;
    } catch {
      failed += 1;
    }
  }
  return { updated, skipped, failed };
}

/**
 * The patch for one card: both map fields at once. The host replaces a map
 * wholesale, so each field is sent complete, and one write per contact keeps
 * the reported counts honest.
 *
 * Returns `null` when there is nothing to change, or `false` when the card
 * cannot be changed at all (it would be left in no address book).
 */
function bulkPatch(card, { addTags, removeTags, addBooks, removeBooks }) {
  const patch = {};

  const keywords = { ...(card?.keywords ?? {}) };
  for (const tag of addTags) keywords[tag] = true;
  for (const tag of removeTags) delete keywords[tag];
  if (!sameMap(keywords, card?.keywords ?? {})) {
    // An empty map means "no tags", the same shape the editor writes.
    patch.keywords = Object.keys(keywords).length ? keywords : undefined;
  }

  const current = card?.addressBookIds ?? {};
  const next = {};
  for (const [id, on] of Object.entries(current)) if (on && !removeBooks.has(id)) next[id] = true;
  for (const id of addBooks) next[id] = true;
  // A contact must stay in at least one book, so this card is refused.
  if (!Object.keys(next).length) return false;
  if (!sameMap(next, current)) patch.addressBookIds = next;

  return Object.keys(patch).length ? patch : null;
}

/**
 * Applies tag and address-book changes across a selection, in **one** update
 * per contact. A contact that would be left in no address book is reported as
 * failed rather than quietly skipped.
 */
export async function applyBulkEdit(api, cards, { tags = {}, books = {} } = {}) {
  const spec = {
    addTags: cleanTags(tags.add ?? []),
    // 'company' is how a contact is marked as an organisation; removing it
    // would turn a company into a person, which is not what a tag edit means.
    removeTags: cleanTags(tags.remove ?? []).filter((tag) => tag !== COMPANY_KEYWORD),
    addBooks: [...new Set((Array.isArray(books.add) ? books.add : []).map(String).filter(Boolean))],
    removeBooks: new Set((Array.isArray(books.remove) ? books.remove : []).map(String).filter(Boolean)),
  };
  const result = await updateEach(api, cards, (card) => bulkPatch(card, spec));
  if (result.updated) await recordHistory(api, { kind: 'bulk', contacts: result.updated });
  return result;
}

/** Tags only. */
export const applyTags = (api, cards, tags = {}) => applyBulkEdit(api, cards, { tags });

/** Address books only. */
export const applyBooks = (api, cards, books = {}) => applyBulkEdit(api, cards, { books });

/**
 * Deletes contacts one by one, keeping the removed cards in one undo batch.
 * A card the host refuses to delete stays and is counted in `failed`, so a
 * partial run is reported rather than hidden.
 *
 * `kind` names the task in the change history: a plain delete is `'delete'`, a
 * data-subject erasure is `'erase'` (#26), so the history says which it was.
 *
 * @returns {Promise<{deleted:number, failed:number}>}
 */
export async function deleteContacts(api, cards, { kind = 'delete' } = {}) {
  const removed = [];
  let failed = 0;
  for (const card of Array.isArray(cards) ? cards : []) {
    try {
      await api.contacts.remove(card.id);
      removed.push(card);
    } catch {
      failed += 1;
    }
  }
  // No kept contact: an undo of a delete only has to re-create what went away.
  if (removed.length) await saveUndo(api, [{ keptId: '', before: {}, absent: [], removed }], Date.now(), kind);
  return { deleted: removed.length, failed };
}
