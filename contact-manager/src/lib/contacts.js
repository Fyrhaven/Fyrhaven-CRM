// Reading the JSContact cards that api.contacts.list hands out (RFC 9553,
// used by Stalwart and Bulwark) and the flatter shapes contact hooks and
// slots may receive. Everything here is pure — no api, no DOM — so the unit
// tests in test/ can import it directly.
//
// Card shape (lib/jmap/types.ts of the webmail):
//   { id, kind?, name?: { full, components }, emails: { k: { address, pref } },
//     phones: { k: { number, pref } }, addresses: { k: {...} },
//     organizations, titles, notes, anniversaries, keywords,
//     addressBookIds: { id: true }, created?, updated? }
// Maps may also arrive as arrays from imports; both are handled.

export const text = (value) => (typeof value === 'string' ? value.trim() : '');

function isAddress(value) {
  const address = text(value);
  return address.includes('@') && !/\s/.test(address);
}

/**
 * The name to show for a contact: JSContact `name` (string, `{ full }` or
 * `{ components }`), the flat ContactView fields, a nickname, else the email.
 */
export function contactName(card) {
  if (!card || typeof card !== 'object') return '';
  const name = card.name;
  if (typeof name === 'string' && name.trim()) return name.trim();
  if (name && typeof name === 'object') {
    if (text(name.full)) return text(name.full);
    const parts = Array.isArray(name.components) ? name.components : Object.values(name.components ?? {});
    const given = parts.filter((p) => p?.kind === 'given').map((p) => text(p.value)).filter(Boolean);
    const surname = parts.filter((p) => p?.kind === 'surname').map((p) => text(p.value)).filter(Boolean);
    const joined = [...given, ...surname].join(' ');
    if (joined) return joined;
  }
  if (text(card.fullName)) return text(card.fullName);
  const flat = [text(card.firstName), text(card.lastName)].filter(Boolean).join(' ');
  if (flat) return flat;
  const nick = Object.values(card.nicknames ?? {}).map((n) => text(n?.name)).find(Boolean);
  if (nick) return nick;
  return primaryEmail(card) ?? '';
}

/** All email entries of a card as `[{ key, address, pref?, … }]`. */
export function emailEntries(card) {
  const source = card?.emails;
  if (Array.isArray(source)) {
    return source
      .map((entry, i) => (typeof entry === 'string' ? { key: String(i), address: entry } : { key: String(i), ...(entry ?? {}) }))
      .filter((entry) => isAddress(entry.address));
  }
  return Object.entries(source ?? {})
    .map(([key, entry]) => (typeof entry === 'string' ? { key, address: entry } : { key, ...(entry ?? {}) }))
    .filter((entry) => isAddress(entry.address));
}

/** All phone entries of a card as `[{ key, number, pref?, … }]`. */
export function phoneEntries(card) {
  const source = card?.phones ?? card?.phoneNumbers;
  if (Array.isArray(source)) {
    return source
      .map((entry, i) => {
        if (typeof entry === 'string') return { key: String(i), number: entry };
        return { key: String(i), number: entry?.number ?? entry?.phone ?? entry?.value, ...(entry ?? {}) };
      })
      .filter((entry) => text(entry.number));
  }
  return Object.entries(source ?? {})
    .map(([key, entry]) => {
      if (typeof entry === 'string') return { key, number: entry };
      return { key, number: entry?.number ?? entry?.phone ?? entry?.value, ...(entry ?? {}) };
    })
    .filter((entry) => text(entry.number));
}

/** The preferred email address of a contact, or null. */
export function primaryEmail(card) {
  const entries = emailEntries(card).sort((a, b) => (a.pref ?? 101) - (b.pref ?? 101));
  return entries.length ? text(entries[0].address) : null;
}

/** The preferred phone number of a contact, or null. */
export function primaryPhone(card) {
  const entries = phoneEntries(card).sort((a, b) => (a.pref ?? 101) - (b.pref ?? 101));
  return entries.length ? text(entries[0].number) : null;
}

/** Address book ids of a card. */
export function bookIds(card) {
  const ids = Object.keys(card?.addressBookIds ?? {});
  if (!ids.length && typeof card?.addressBookId === 'string' && card.addressBookId) return [card.addressBookId];
  return ids;
}

/**
 * Whether we may merge this entry at all: it needs an id, and contact groups
 * (distribution lists, `kind: 'group'`) are never duplicates of a person.
 */
export function isMergeable(card) {
  return Boolean(card && typeof card.id === 'string' && card.id && card.kind !== 'group');
}

/** id → display name for the address books. */
export function bookNamesById(books) {
  const map = new Map();
  for (const book of Array.isArray(books) ? books : []) {
    if (book?.id) map.set(book.id, text(book.name) || book.id);
  }
  return map;
}

/** The match strategies from the plugin settings; a missing setting is on. */
export function matchOptions(settings) {
  return {
    matchByEmail: settings?.matchByEmail !== false,
    matchByPhone: settings?.matchByPhone !== false,
    matchByName: settings?.matchByName !== false,
  };
}

/** All contacts of the account. Throws when the fetch fails. */
export async function loadCards(api) {
  const cards = await api.contacts.list();
  return Array.isArray(cards) ? cards : [];
}

/** All address books of the account. Throws when the fetch fails. */
export async function loadBooks(api) {
  const books = await api.addressBooks.list();
  return Array.isArray(books) ? books : [];
}
