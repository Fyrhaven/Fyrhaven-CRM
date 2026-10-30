// Contact groups — distribution lists — are ordinary JSContact cards the host
// stores beside people: `kind: 'group'`, a `name`, and a `members` map whose
// values are the uids of other cards. This module is the pure model behind the
// Groups tab and the group editor: what a group card is, the editor's draft,
// the member search, and the duplicates a list may hold. No api, no DOM, so
// the rules are unit-testable.
//
// The plugin never invents a second store for groups — a group is a real card,
// shared, searchable and exportable like a company (v1.9.0). `api.storage` is
// only ever used for state *about* a group, never for the group itself.

import { bookIds, contactName, isGroupCard, text } from './contacts.js';
import { findDuplicateGroups } from './duplicates.js';
import { filterCards } from './profile.js';

export { isGroupCard };

/** A blank group draft, geared for the create form. */
export function emptyGroupDraft() {
  return { name: '', memberIds: [], bookIds: [] };
}

/**
 * The member ids of a group card, in order, deduplicated. Reads the JSContact
 * `members` map (`{ k: { kind, value } }`) and the flatter shapes a host may
 * hand back (a bare string, `{ id }`, an array).
 */
export function groupMemberIds(card) {
  const members = card?.members;
  if (!members) return [];
  const entries = Array.isArray(members) ? members : Object.values(members);
  const ids = entries
    .map((entry) => (typeof entry === 'string' ? entry : text(entry?.value ?? entry?.id ?? entry?.cardId)))
    .filter(Boolean);
  return [...new Set(ids)];
}

/** The editor's draft for an existing group card. `books` keeps the order stable. */
export function groupDraftFromCard(card, books = []) {
  const draft = emptyGroupDraft();
  if (!card) return draft;
  const list = Array.isArray(books) ? books : [];
  draft.name = text(card.name?.full) || text(card.name);
  draft.memberIds = groupMemberIds(card);
  const known = new Set(list.map((book) => book.id));
  const owned = bookIds(card);
  draft.bookIds = known.size ? list.filter((book) => owned.includes(book.id)).map((book) => book.id) : owned;
  return draft;
}

/** What is wrong with a group draft: a name is required, plus a book on create. */
export function validateGroupDraft(draft, mode = 'create') {
  const errors = [];
  if (!text(draft?.name)) errors.push({ field: 'name', key: 'groups.error.name' });
  if (mode === 'create' && !(draft?.bookIds ?? []).length) {
    errors.push({ field: 'books', key: 'editor.error.book' });
  }
  return errors;
}

/**
 * The JSContact card for a group draft. A group card carries no emails, phones
 * or organisation — only its name and its members — so a merge can never fold
 * a person into it, and the keyword is the fallback marker for a host that
 * does not keep `kind`.
 */
export function groupCardFromDraft(draft, mode = 'create') {
  const name = text(draft?.name);
  const ids = [...new Set((draft?.memberIds ?? []).map((id) => text(id)).filter(Boolean))];
  const card = {
    kind: 'group',
    name: name ? { full: name } : undefined,
    members: ids.length
      ? Object.fromEntries(ids.map((id, index) => [`m${index}`, { kind: 'individual', value: id }]))
      : undefined,
    keywords: { group: true },
  };
  const books = draft?.bookIds ?? [];
  if (mode === 'create' || books.length) card.addressBookIds = Object.fromEntries(books.map((id) => [id, true]));
  return card;
}

/** The people a member picker may offer: contacts, never another group. */
export function memberPool(cards, exclude = []) {
  const skip = new Set(Array.isArray(exclude) ? exclude : []);
  return (Array.isArray(cards) ? cards : [])
    .filter((card) => card && card.id && !isGroupCard(card) && !skip.has(card.id));
}

/**
 * The member candidates for a query, capped so the picker stays a picker.
 * Reuses the profile page's free-text matching, so a member is found the same
 * way a contact is — one matcher, not two.
 */
export function memberCandidates(cards, query, { exclude = [], limit = 20 } = {}) {
  return filterCards(memberPool(cards, exclude), query).slice(0, limit);
}

/**
 * The duplicate groups *inside* one contact group's membership — two members
 * that are the same person. Uses the same detection as the Duplicates page, so
 * a list cannot hold a duplicate the rest of the plugin would not see. The
 * group card itself is excluded: a group is never a member of itself.
 */
export function duplicatesInGroup(card, cards, opts = {}) {
  const byId = new Map((Array.isArray(cards) ? cards : []).map((entry) => [entry?.id, entry]));
  const members = groupMemberIds(card).map((id) => byId.get(id)).filter(Boolean);
  if (members.length < 2) return [];
  return findDuplicateGroups(members, opts, []);
}

/** "Ada Lovelace", or the id when the card is gone. */
export const groupMemberLabel = (card, id) => contactName(card) || id;
