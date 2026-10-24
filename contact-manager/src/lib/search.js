// Smart search over the loaded contact list: a small query language, and the
// matcher behind it.
//
// Pure — no api, no DOM — so the whole thing is unit-testable and the page only
// renders what this returns.
//
//   ada                    free text over name, nickname, email, phone,
//                          company, note, tag and address-book name
//   name:ada  email:x.de   one field only
//   phone:0176             digits compared, so spaces and + do not matter
//   company:acme           organisation names and the email domain
//   tag:vip                a keyword, matched whole
//   book:Work              an address-book name or id
//   has:phone  has:email   presence — also has:note, has:tag
//   is:company is:person   what kind of contact it is
//
// An unknown operator is reported *and* treated as free text, so a typo never
// silently returns nothing.

import { contactName, emailEntries, phoneEntries, text } from './contacts.js';
import { isCompany } from './profile.js';

const lower = (value) => text(value).toLowerCase();

/** Operator names the parser understands. */
export const FIELDS = ['name', 'email', 'phone', 'company', 'note', 'tag', 'book', 'has', 'is'];

/** Values `has:` accepts. */
export const HAS_FLAGS = ['email', 'phone', 'note', 'tag'];

/** Values `is:` accepts. */
export const IS_VALUES = ['company', 'person'];

/** Digits only, so `phone:0176 12` and `phone:+4917612` agree. */
const digits = (value) => String(value ?? '').replace(/\D/g, '');

const isSubsequence = (needle, haystack) => {
  let i = 0;
  for (const char of haystack) {
    if (char === needle[i]) i += 1;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
};

/**
 * Splits a query into text terms and filters.
 *
 * @returns {{terms: string[], filters: Array<{field: string, value: string}>,
 *            errors: Array<{token: string, field: string, reason: string}>}}
 *   `reason` is `'unknown-field' | 'unknown-has' | 'unknown-is' | 'empty-value'`.
 *   A token with an error is kept as a free-text term as well.
 */
export function parseQuery(input) {
  const terms = [];
  const filters = [];
  const errors = [];

  for (const token of String(input ?? '').trim().split(/\s+/).filter(Boolean)) {
    const at = token.indexOf(':');
    if (at <= 0) {
      terms.push(lower(token));
      continue;
    }
    const field = token.slice(0, at).toLowerCase();
    const value = token.slice(at + 1);
    const fail = (reason) => {
      errors.push({ token, field, value, reason });
      terms.push(lower(token));
    };

    if (!FIELDS.includes(field)) {
      fail('unknown-field');
      continue;
    }
    if (!value) {
      fail('empty-value');
      continue;
    }
    if (field === 'has' && !HAS_FLAGS.includes(lower(value))) {
      fail('unknown-has');
      continue;
    }
    if (field === 'is' && !IS_VALUES.includes(lower(value))) {
      fail('unknown-is');
      continue;
    }
    filters.push({ field, value: lower(value) });
  }

  return { terms, filters, errors };
}

/** Organisation names, the email domain, and a company record's own name. */
export function companyTerms(card) {
  const organisations = Object.values(card?.organizations ?? {}).map((entry) => text(entry?.name));
  const domains = emailEntries(card)
    .map((entry) => text(entry.address).split('@')[1] ?? '')
    .filter(Boolean);
  // A company record *is* a company, so its own name is the company name.
  const own = isCompany(card) ? [contactName(card)] : [];
  return [...organisations, ...own, ...domains].filter(Boolean);
}

/**
 * A card's address books as both ids and names, so `book:Work` and `book:b2`
 * both work — the page knows the names, the card only knows the ids.
 */
function bookTermsOf(card, books) {
  return Object.keys(card?.addressBookIds ?? {})
    .flatMap((id) => [id, books instanceof Map ? books.get(id) : undefined])
    .filter(Boolean);
}

/** Every text a free-text term may match, lower-cased. */
function freeTextTerms(card, bookTerms) {
  const names = [
    contactName(card),
    ...Object.values(card?.nicknames ?? {}).map((entry) => text(entry?.name)),
  ];
  return [
    ...names,
    ...emailEntries(card).map((entry) => text(entry.address)),
    ...phoneEntries(card).map((entry) => text(entry.number)),
    ...companyTerms(card),
    ...Object.values(card?.notes ?? {}).map((entry) => text(entry?.note)),
    ...Object.keys(card?.keywords ?? {}),
    ...bookTerms,
  ].filter(Boolean).map(lower);
}

const hasTerm = (terms, needle) => terms.some((term) => term.includes(needle));

/**
 * Fuzzy-ish, on names only: every character of the needle appears in order.
 * Applied for needles of three characters or more, so `grce` still finds
 * `Grace Hopper` while a two-letter query cannot match half the address book.
 */
const hasFuzzyName = (names, needle) => needle.length >= 3
  && names.some((name) => isSubsequence(needle, name));

/** The strings one card is searched by, derived once and reused across queries. */
function indexEntry(card, books) {
  const bookTerms = bookTermsOf(card, books);
  return {
    card,
    names: [
      contactName(card),
      ...Object.values(card?.nicknames ?? {}).map((entry) => text(entry?.name)),
    ].filter(Boolean).map(lower),
    free: freeTextTerms(card, bookTerms),
    emails: emailEntries(card).map((entry) => lower(entry.address)),
    phones: phoneEntries(card).map((entry) => digits(entry.number).replace(/^0+/, '')).filter(Boolean),
    companies: companyTerms(card).map(lower),
    notes: Object.values(card?.notes ?? {}).map((entry) => lower(entry?.note)),
    tags: Object.keys(card?.keywords ?? {}).map(lower),
    books: bookTerms.map(lower),
    company: isCompany(card),
  };
}

/**
 * Derives the searchable strings for every card **once**, so a page can run
 * many queries — the list, plus one count per saved search — without reading
 * the cards again each time.
 */
export function buildIndex(cards, { books } = {}) {
  return (Array.isArray(cards) ? cards : []).map((card) => indexEntry(card, books));
}

/** Does one indexed card satisfy every term and every filter? */
export function matchIndexed(entry, parsed) {
  for (const term of parsed.terms) {
    if (!hasTerm(entry.free, term) && !hasFuzzyName(entry.names, term)) return false;
  }

  for (const { field, value } of parsed.filters) {
    if (field === 'name' && !(hasTerm(entry.names, value) || hasFuzzyName(entry.names, value))) return false;
    if (field === 'email' && !hasTerm(entry.emails, value)) return false;
    if (field === 'phone') {
      const wanted = digits(value).replace(/^0+/, '');
      if (!wanted || !entry.phones.some((number) => number.includes(wanted))) return false;
    }
    if (field === 'company' && !hasTerm(entry.companies, value)) return false;
    if (field === 'note' && !hasTerm(entry.notes, value)) return false;
    if (field === 'tag' && !entry.tags.includes(value)) return false;
    if (field === 'book' && !entry.books.includes(value)) return false;
    if (field === 'has') {
      const present = {
        email: entry.emails.length,
        phone: entry.phones.length,
        note: entry.notes.length,
        tag: entry.tags.length,
      }[value];
      if (!present) return false;
    }
    if (field === 'is' && (value === 'company') !== entry.company) return false;
  }

  return true;
}

const isBlank = (parsed) => !parsed.terms.length && !parsed.filters.length;

/** Does one card satisfy a parsed query? Convenience for a single card. */
export function matchCard(card, parsed, { books } = {}) {
  return matchIndexed(indexEntry(card, books), parsed);
}

/**
 * The cards matching `query`, with the parsed query so the page can show the
 * errors and the count without parsing twice.
 *
 * @returns {{results: any[], parsed: object}}
 */
export function searchCards(cards, query, { books } = {}) {
  const list = Array.isArray(cards) ? cards : [];
  const parsed = parseQuery(query);
  if (isBlank(parsed)) return { results: list, parsed };
  return {
    results: buildIndex(list, { books })
      .filter((entry) => matchIndexed(entry, parsed))
      .map((entry) => entry.card),
    parsed,
  };
}

/** How many cards a query matches, for a single query. */
export function countMatches(cards, query, { books } = {}) {
  return searchCards(cards, query, { books }).results.length;
}

/**
 * How many cards each query matches, over one already-built index — what the
 * saved-search chips need, so N saved searches cost N cheap passes instead of
 * N full reads of the address book.
 */
export function countsForIndex(index, queries) {
  const entries = Array.isArray(index) ? index : [];
  return (Array.isArray(queries) ? queries : []).map((query) => {
    const parsed = parseQuery(query);
    if (isBlank(parsed)) return entries.length;
    return entries.filter((entry) => matchIndexed(entry, parsed)).length;
  });
}
