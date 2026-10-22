// Pure helpers for the 360° contact profile page: searching the contact list
// and deciding which tasks and messages belong to a contact. No api, no DOM —
// the page in `profile-page.js` only loads data and renders.

import { contactName, emailEntries, phoneEntries, text } from './contacts.js';

const lower = (value) => text(value).toLowerCase();

/** Every text a contact can be found by: name, nicknames, emails, phones. */
export function searchTerms(card) {
  const nicknames = Object.values(card?.nicknames ?? {}).map((entry) => text(entry?.name));
  return [
    contactName(card),
    ...nicknames,
    ...emailEntries(card).map((entry) => text(entry.address)),
    ...phoneEntries(card).map((entry) => text(entry.number)),
  ].filter(Boolean).map(lower);
}

/**
 * Contacts matching a free-text query — `{ name: 'ada', email: 'x' }` style
 * queries are not supported, this is a simple "contains" over the search
 * terms. An empty query returns the list unchanged, so the page can show
 * everything.
 */
export function filterCards(cards, query) {
  const list = Array.isArray(cards) ? cards : [];
  const needle = lower(query);
  if (!needle) return list;
  return list.filter((card) => searchTerms(card).some((term) => term.includes(needle)));
}

/**
 * The terms a task or a message must mention to belong to a contact: the
 * display name (if it is not just an email address) and every email address.
 * Short names are ignored so "Ada" does not match every task containing it by
 * accident — the caller decides, this returns the terms.
 */
export function contactTerms(card) {
  const name = contactName(card);
  const emails = emailEntries(card).map((entry) => lower(entry.address)).filter(Boolean);
  const terms = [...emails];
  if (name && !name.includes('@') && name.trim().length >= 3) terms.push(lower(name));
  return [...new Set(terms)];
}

const taskText = (task) => lower([task?.title, task?.description, task?.location].filter(Boolean).join(' '));

/** Tasks that mention the contact in their title or description. */
export function tasksForContact(tasks, card) {
  const terms = contactTerms(card);
  if (!terms.length) return [];
  return (Array.isArray(tasks) ? tasks : []).filter((task) => {
    const haystack = taskText(task);
    return terms.some((term) => haystack.includes(term));
  });
}

/** Messages the profile shows as the interaction timeline. */
export function timelineForContact(messages, card) {
  const terms = new Set(contactTerms(card));
  if (!terms.size) return [];
  return (Array.isArray(messages) ? messages : []).filter((message) => {
    const haystack = [message?.from?.email, message?.to?.map?.((entry) => entry.email)?.join(' '),
      message?.subject]
      .filter(Boolean).join(' ').toLowerCase();
    return [...terms].some((term) => haystack.includes(term));
  });
}
