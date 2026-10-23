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

import { saveUndo } from './undo.js';

/**
 * Deletes contacts one by one, keeping the removed cards in one undo batch.
 * A card the host refuses to delete stays and is counted in `failed`, so a
 * partial run is reported rather than hidden.
 *
 * @returns {Promise<{deleted:number, failed:number}>}
 */
export async function deleteContacts(api, cards) {
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
  if (removed.length) await saveUndo(api, [{ keptId: '', before: {}, absent: [], removed }]);
  return { deleted: removed.length, failed };
}
