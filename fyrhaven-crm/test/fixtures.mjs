// Shared test cards: minimal JSContact cards in the shape api.contacts.list
// hands out (maps keyed by id, `name.full`, address book membership).

export function makeCard({ id, name, emails = [], phones = [], ...rest }) {
  const card = { id, addressBookIds: { b1: true }, ...rest };
  if (name) card.name = typeof name === 'string' ? { full: name } : name;
  if (emails.length) card.emails = Object.fromEntries(emails.map((address, i) => [`e${i}`, { address }]));
  if (phones.length) card.phones = Object.fromEntries(phones.map((number, i) => [`p${i}`, { number }]));
  return card;
}

/** The address book names a group's members live in (page subtitles). */
export const BOOKS = [{ id: 'b1', name: 'Personal' }];
