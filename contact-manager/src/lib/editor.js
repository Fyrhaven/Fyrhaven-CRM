// The contact editor's data model: a flat, form-friendly draft and the
// conversions to and from a JSContact card. Pure — no api, no DOM — so the
// rules (what a valid draft is, what the patch looks like) are unit-testable
// without a browser. `editor-dialog.js` renders it, `index.js` opens it.

import { bookIds, emailEntries, phoneEntries, text } from './contacts.js';

/** A blank draft, geared for the create form. */
export function emptyDraft() {
  return {
    given: '',
    surname: '',
    nickname: '',
    emails: [],
    phones: [],
    address: { street: '', locality: '', region: '', postcode: '', country: '' },
    organization: '',
    title: '',
    notes: '',
    tags: '',
    bookIds: [],
  };
}

const firstEntry = (map) => Object.values(map ?? {})[0] ?? null;

/** Splits a `name.full` value when the card has no components. */
function splitFull(full) {
  const parts = text(full).split(/\s+/).filter(Boolean);
  if (!parts.length) return { given: '', surname: '' };
  if (parts.length === 1) return { given: parts[0], surname: '' };
  return { given: parts.slice(0, -1).join(' '), surname: parts.at(-1) };
}

/**
 * The editor's draft for an existing card. Every managed field is filled in;
 * fields the editor does not manage are left untouched in the card itself.
 * `books` is the address-book list, used to keep the membership checkboxes in
 * a stable order.
 */
export function draftFromCard(card, books = []) {
  const draft = emptyDraft();
  if (!card) return draft;

  const components = Array.isArray(card.name?.components)
    ? card.name.components
    : Object.values(card.name?.components ?? {});
  if (components.length) {
    draft.given = components.filter((c) => c?.kind === 'given').map((c) => text(c.value)).join(' ');
    draft.surname = components.filter((c) => c?.kind === 'surname').map((c) => text(c.value)).join(' ');
    if (!draft.given && !draft.surname) draft.given = text(card.name?.full);
  } else {
    const split = splitFull(card.name?.full ?? '');
    draft.given = split.given;
    draft.surname = split.surname;
  }

  draft.nickname = text(firstEntry(card.nicknames)?.name);
  draft.emails = emailEntries(card).map((entry) => ({ address: text(entry.address), pref: Boolean(entry.pref) }));
  draft.phones = phoneEntries(card).map((entry) => ({ number: text(entry.number), pref: Boolean(entry.pref) }));

  const address = firstEntry(card.addresses);
  if (address) {
    draft.address = {
      street: text(address.street),
      locality: text(address.locality),
      region: text(address.region),
      postcode: text(address.postcode),
      country: text(address.country),
    };
  }

  draft.organization = text(firstEntry(card.organizations)?.name);
  draft.title = text(firstEntry(card.titles)?.name);
  draft.notes = text(firstEntry(card.notes)?.note);
  draft.tags = Object.keys(card.keywords ?? {}).join(', ');

  const known = new Set(books.map((book) => book.id));
  const owned = bookIds(card);
  draft.bookIds = known.size ? books.filter((book) => owned.includes(book.id)).map((book) => book.id) : owned;
  return draft;
}

const emailOk = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const phoneOk = (value) => value.replace(/\D/g, '').length >= 5;

const normalize = (draft) => ({
  ...draft,
  emails: (draft.emails ?? []).map((entry) => ({ address: text(entry.address), pref: Boolean(entry.pref) })),
  phones: (draft.phones ?? []).map((entry) => ({ number: text(entry.number), pref: Boolean(entry.pref) })),
  bookIds: [...(draft.bookIds ?? [])].sort(),
});

/**
 * What is wrong with a draft: `[{ field, key }]`, where `key` is an i18n key
 * under `editor.error.*`. `mode` is 'create' or 'edit' — a new contact needs
 * at least one address book. One message per field is enough for the summary.
 */
export function validateDraft(draft, mode = 'create') {
  const errors = [];
  const emails = (draft.emails ?? []).map((entry) => text(entry.address)).filter(Boolean);
  const phones = (draft.phones ?? []).map((entry) => text(entry.number)).filter(Boolean);

  if (!text(draft.given) && !text(draft.surname) && !emails.length && !phones.length) {
    errors.push({ field: 'name', key: 'editor.error.empty' });
  }
  if (emails.some((address) => !emailOk(address))) errors.push({ field: 'emails', key: 'editor.error.email' });
  if (phones.some((number) => !phoneOk(number))) errors.push({ field: 'phones', key: 'editor.error.phone' });
  if (mode === 'create' && !(draft.bookIds ?? []).length) {
    errors.push({ field: 'books', key: 'editor.error.book' });
  }
  const seen = new Set();
  return errors.filter((error) => (seen.has(error.field) ? false : seen.add(error.field)));
}

/** True when the draft differs from the one it started as. */
export function isDirty(draft, original) {
  return JSON.stringify(normalize(draft)) !== JSON.stringify(normalize(original));
}

const prefMap = (entries, valueKey, prefix) => {
  const map = {};
  entries.forEach((entry, index) => {
    const out = { [valueKey]: text(entry.value) };
    if (entry.pref) out.pref = 1;
    map[`${prefix}${index}`] = out;
  });
  return map;
};

/**
 * The JSContact fields for a draft. Only the fields the editor manages are
 * present, and an empty value becomes `undefined` so an update clears it (the
 * host treats an omitted key as "keep" and `undefined` as "clear").
 * `mode` only affects the address-book membership: create always sends it,
 * edit sends it when the user kept at least one book.
 */
export function cardFromDraft(draft, mode = 'create') {
  const given = text(draft.given);
  const surname = text(draft.surname);
  const components = [];
  if (given) components.push({ kind: 'given', value: given });
  if (surname) components.push({ kind: 'surname', value: surname });

  const emails = (draft.emails ?? []).map((entry) => ({ value: entry.address, pref: entry.pref }))
    .filter((entry) => text(entry.value));
  const phones = (draft.phones ?? []).map((entry) => ({ value: entry.number, pref: entry.pref }))
    .filter((entry) => text(entry.value));

  const address = draft.address ?? {};
  const addressValues = {
    street: text(address.street),
    locality: text(address.locality),
    region: text(address.region),
    postcode: text(address.postcode),
    country: text(address.country),
  };
  const hasAddress = Object.values(addressValues).some(Boolean);

  const nickname = text(draft.nickname);
  const organization = text(draft.organization);
  const title = text(draft.title);
  const notes = text(draft.notes);
  const tags = text(draft.tags).split(',').map((tag) => tag.trim()).filter(Boolean);

  const card = {
    name: components.length ? { components } : undefined,
    nicknames: nickname ? { n0: { name: nickname } } : undefined,
    emails: emails.length ? prefMap(emails, 'address', 'e') : undefined,
    phones: phones.length ? prefMap(phones, 'number', 'p') : undefined,
    addresses: hasAddress ? { a0: addressValues } : undefined,
    organizations: organization ? { o0: { name: organization } } : undefined,
    titles: title ? { t0: { name: title } } : undefined,
    notes: notes ? { n0: { note: notes } } : undefined,
    keywords: tags.length ? Object.fromEntries(tags.map((tag) => [tag, true])) : undefined,
  };
  const ids = draft.bookIds ?? [];
  if (mode === 'create' || ids.length) card.addressBookIds = Object.fromEntries(ids.map((id) => [id, true]));
  return card;
}

// ── Companies (#22) ────────────────────────────────────────────
//
// A company is a contact card with `kind: 'org'`, so it lives in the address
// books like any other record: shared, searchable, exportable. The draft is
// smaller than a person's — a name, domains, one address, notes and tags.

/** A blank company draft. */
export function emptyCompanyDraft() {
  return {
    name: '',
    domains: '',
    address: { street: '', locality: '', region: '', postcode: '', country: '' },
    notes: '',
    tags: '',
    bookIds: [],
  };
}

const domainList = (value) => text(value)
  .split(/[,\s]+/)
  .map((domain) => domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, ''))
  .filter((domain) => domain.includes('.'));

/** The editor's draft for an existing company card. */
export function companyDraftFromCard(card, books = []) {
  const draft = emptyCompanyDraft();
  if (!card) return draft;
  draft.name = text(card.name?.full) || Object.values(card.organizations ?? {})[0]?.name || '';
  draft.domains = Object.values(card.onlineServices ?? {})
    .map((entry) => text(entry?.uri || entry?.service)).filter(Boolean).join(', ');
  const address = Object.values(card.addresses ?? {})[0];
  if (address) {
    draft.address = {
      street: text(address.street),
      locality: text(address.locality),
      region: text(address.region),
      postcode: text(address.postcode),
      country: text(address.country),
    };
  }
  draft.notes = Object.values(card.notes ?? {})[0]?.note ?? '';
  draft.tags = Object.keys(card.keywords ?? {}).filter((tag) => tag !== 'company').join(', ');
  const known = new Set(books.map((book) => book.id));
  const owned = bookIds(card);
  draft.bookIds = known.size ? books.filter((book) => owned.includes(book.id)).map((book) => book.id) : owned;
  return draft;
}

/** What is wrong with a company draft: a name is required, plus a book on create. */
export function validateCompanyDraft(draft, mode = 'create') {
  const errors = [];
  if (!text(draft.name)) errors.push({ field: 'name', key: 'editor.error.companyName' });
  if (mode === 'create' && !(draft.bookIds ?? []).length) {
    errors.push({ field: 'books', key: 'editor.error.book' });
  }
  return errors;
}

/** The JSContact card for a company draft. */
export function companyCardFromDraft(draft, mode = 'create') {
  const name = text(draft.name);
  const domains = domainList(draft.domains);
  const address = draft.address ?? {};
  const addressValues = {
    street: text(address.street),
    locality: text(address.locality),
    region: text(address.region),
    postcode: text(address.postcode),
    country: text(address.country),
  };
  const hasAddress = Object.values(addressValues).some(Boolean);
  const notes = text(draft.notes);
  const tags = text(draft.tags).split(',').map((tag) => tag.trim()).filter(Boolean).filter((tag) => tag !== 'company');

  const card = {
    kind: 'org',
    name: name ? { full: name } : undefined,
    onlineServices: domains.length
      ? Object.fromEntries(domains.map((domain, index) => [`d${index}`, { service: 'domain', uri: domain }]))
      : undefined,
    addresses: hasAddress ? { a0: addressValues } : undefined,
    notes: notes ? { n0: { note: notes } } : undefined,
    // The keyword is the fallback marker for hosts that do not keep `kind`.
    keywords: { company: true, ...Object.fromEntries(tags.map((tag) => [tag, true])) },
  };
  const ids = draft.bookIds ?? [];
  if (mode === 'create' || ids.length) card.addressBookIds = Object.fromEntries(ids.map((id) => [id, true]));
  return card;
}
