// Pure helpers for the 360° contact profile page: searching the contact list
// and deciding which tasks and messages belong to a contact. No api, no DOM —
// the page in `profile-page.js` only loads data and renders.

import { contactName, emailEntries, phoneEntries, text } from './contacts.js';
import { normalizeName } from './duplicates.js';

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

/** True for a company record: a JSContact card marked `kind: 'org'`. */
export function isCompany(card) {
  return card?.kind === 'org' || Boolean(card?.keywords?.company);
}

/** The organisation name of a contact or company ("" when there is none). */
export function companyNameOf(card) {
  if (!card) return '';
  const own = Object.values(card.organizations ?? {})[0]?.name;
  return text(own) || (isCompany(card) ? contactName(card) : '');
}

const companyKeyOf = (name) => normalizeName(name);

/** Company cards among a list of contacts. */
export function companiesAmong(cards) {
  return (Array.isArray(cards) ? cards : []).filter(isCompany);
}

/**
 * The people that belong to a company: their organisation name matches after
 * normalisation, or their email domain is one of the company's domains.
 * The company itself is never in its own list.
 */
export function peopleOfCompany(cards, company) {
  const key = companyKeyOf(companyNameOf(company));
  const domains = new Set(companyDomains(cards, company));
  return (Array.isArray(cards) ? cards : []).filter((card) => {
    if (!card || card.id === company?.id || isCompany(card)) return false;
    if (key && companyKeyOf(companyNameOf(card)) === key) return true;
    const domain = emailDomain(card);
    return Boolean(domain && domains.has(domain));
  });
}

/** The domain of a contact's first email address, lower-cased. */
export function emailDomain(card) {
  const address = emailEntries(card)[0]?.address;
  if (!address || !address.includes('@')) return '';
  return text(address.split('@').pop()).toLowerCase();
}

/**
 * Domains that belong to a company: the ones listed in its `onlineServices`
 * plus the most common domain of the people already linked by organisation
 * name. Deriving them is what lets a colleague without an `organizations`
 * field show up under the right company.
 */
export function companyDomains(cards, company) {
  const explicit = Object.values(company?.onlineServices ?? {})
    .map((entry) => text(entry?.uri || entry?.service).toLowerCase())
    .filter((value) => value.includes('.'));
  const key = companyKeyOf(companyNameOf(company));
  const counts = new Map();
  for (const card of Array.isArray(cards) ? cards : []) {
    if (!card || isCompany(card)) continue;
    if (!key || companyKeyOf(companyNameOf(card)) !== key) continue;
    const domain = emailDomain(card);
    if (domain) counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  const derived = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([domain]) => domain);
  return [...new Set([...explicit, ...derived])];
}

/** The company card a contact belongs to, or null. */
export function companyOf(cards, card) {
  if (!card || isCompany(card)) return null;
  const key = companyKeyOf(companyNameOf(card));
  const domain = emailDomain(card);
  return companiesAmong(cards).find((company) => {
    if (key && companyKeyOf(companyNameOf(company)) === key) return true;
    return Boolean(domain && companyDomains(cards, company).includes(domain));
  }) ?? null;
}

const participantEmails = (event) => [
  event?.organizer?.email,
  ...(Array.isArray(event?.participants) ? event.participants : [])
    .flatMap((entry) => [entry?.email, entry?.name]),
].filter(Boolean).map(lower);

/** Calendar events the contact takes part in, newest first. */
export function eventsForContact(events, card) {
  const terms = new Set([...contactTerms(card), ...emailEntries(card).map((entry) => lower(entry.address))]);
  if (!terms.size) return [];
  return (Array.isArray(events) ? events : []).filter((event) => {
    const people = participantEmails(event);
    const subject = lower(event?.title ?? '');
    return people.some((person) => terms.has(person))
      || [...terms].some((term) => subject.includes(term));
  });
}

/**
 * A compact, human-readable size for a file — "42 B", "1.5 kB", "2 MB". Empty
 * for a missing or non-positive size, so the caller can drop that part.
 */
export function formatBytes(size) {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'kB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const shown = unit === 0 ? String(Math.round(value)) : String(Math.round(value * 10) / 10);
  return `${shown} ${units[unit]}`;
}

/**
 * Every attachment in a message list, flattened and de-duplicated by name and
 * size, newest message first: `[{ emailId, subject, receivedAt, name, type,
 * size, blobId }]`.
 */
export function attachmentsForMessages(messages) {
  const out = [];
  const seen = new Set();
  for (const message of Array.isArray(messages) ? messages : []) {
    for (const attachment of message?.attachments ?? []) {
      const name = text(attachment?.name);
      if (!name) continue;
      const size = Number(attachment?.size) || 0;
      const key = `${name}:${size}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        emailId: message.id,
        subject: text(message.subject),
        receivedAt: message.receivedAt,
        name,
        type: text(attachment.type),
        size,
        blobId: attachment.blobId,
      });
    }
  }
  return out;
}
