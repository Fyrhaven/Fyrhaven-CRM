// Warn about duplicates while a contact is saved. The host has no contact
// form surface, so this runs on the observer hooks that fire after a save
// (`onAfterContactCreate`, `onAfterContactUpdate`): the saved contact is
// compared with the cards already in the address books, and a match produces
// a warning toast naming the contact and the reason.
//
// Nothing here can block the save — the hooks are observers, and the issue is
// explicit that the user decides. The persistent, clickable hint is the
// `contact-detail-section` slot, which offers *Review duplicates* for the
// open contact.

import { contactName, detectionOptions } from './contacts.js';
import { findGroupFor } from './duplicates.js';
import { reasonLine } from './labels.js';

// The host fills these in; they say nothing about which contact this is.
const SERVER_FIELDS = ['id', 'created', 'updated'];

const core = (card) => {
  const copy = { ...(card ?? {}) };
  for (const field of SERVER_FIELDS) delete copy[field];
  return JSON.stringify(copy);
};

/** True when two cards are the same contact (same id, or the same content). */
export function isSameCard(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id) return a.id === b.id;
  return core(a) === core(b);
}

/**
 * The duplicate group around a just-saved contact, minus the contact itself:
 * `{ group, others }`, or `null` when there is no duplicate.
 * Uses api.contacts.search (email, then name), so it stays cheap on large
 * address books.
 */
export async function findDuplicatesOf(api, contact, opts = null) {
  if (!contact || typeof contact !== 'object') return null;
  const group = await findGroupFor(api, contact, opts ?? await detectionOptions(api));
  if (!group) return null;
  const others = (group.members ?? []).filter((member) => !isSameCard(member, contact));
  if (!others.length) return null;
  return { group, others };
}

/**
 * Non-blocking warning after a contact was created or changed. Returns the
 * matches (empty when there were none, when the setting is off or when the
 * check failed) so tests and callers can see what happened.
 */
export async function warnAboutDuplicates(api, contact) {
  if (api.plugin?.settings?.warnOnSave === false) return [];
  try {
    const found = await findDuplicatesOf(api, contact);
    if (!found) return [];
    const t = (key, vars) => api.i18n.t(key, vars);
    const names = found.others.map((member) => contactName(member) || member.id).join(', ');
    api.toast.warning(t('watch.toast', { name: names, reason: reasonLine(t, found.group) }));
    return found.others;
  } catch {
    // A failed check must never look like a failed save.
    return [];
  }
}
