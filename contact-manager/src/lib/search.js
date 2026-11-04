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
//   -tag:vip  not:tag:vip  excludes instead of requiring
//   is:company is:person   what kind of contact it is
//   a OR b                 either side matches (case-insensitive `OR`)
//   (a OR b) c             grouping; adjacent terms are AND, `OR` binds looser
//
// A leading `-` excludes instead of requiring: `-tag:vip`, `-has:phone`,
// `-ada`. Everything else is unchanged.
//
// An unknown operator is reported *and* treated as free text, so a typo never
// silently returns nothing.
//
// **A note is a note, wherever it is kept.** `note:` and `has:note` — and free
// text — see a card's own notes *and* the private notes the plugin keeps about
// that contact (#38), because a searcher looking for "what did I write about
// Ada" does not care that one is a card field and the other is a record. The
// private ones arrive as a `notes` option (`{ [contactId]: [{ text }] }`), so
// this module stays free of the storage seam and of `api`.
//
// **When `OR` or a group is used, `parseQuery` also returns an `ast`** — the
// expression tree — because a flat AND of every atom cannot express a
// disjunction. Simple queries keep the old flat shape, so `parsed.terms` and
// `parsed.filters` still describe the whole query for the error line and the
// saved-search chips. `matchIndexed` evaluates the `ast` when it is there and
// the flat lists otherwise, so the two can never disagree about a simple query.

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
 * Parses a query into the flat lists the rest of the code has always used, and
 * — only when the query uses `OR` or a group — the `ast` that expresses it.
 *
 * Grammar: `orExpr := andExpr (OR andExpr)*`, `andExpr := factor+`,
 * `factor := '(' orExpr ')' | atom`. So adjacent terms are AND, `OR` binds
 * looser than AND, and parentheses group.
 *
 * @returns {{terms: string[], notTerms: string[],
 *            filters: Array<{field: string, value: string}>,
 *            notFilters: Array<{field: string, value: string}>,
 *            errors: Array<{token: string, field: string, value: string, reason: string}>,
 *            ast?: object}}
 *   `reason` is `'unknown-field' | 'unknown-has' | 'unknown-is' | 'empty-value'
 *   | 'unbalanced' | 'dangling-or'`. A token with an error is kept as a
 *   free-text term as well. `ast` is present only when the query is not a plain
 *   AND, so a simple query keeps the exact shape it always had.
 */
export function parseQuery(input) {
  const tokens = String(input ?? '')
    .replace(/\(/g, ' ( ')
    .replace(/\)/g, ' ) ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const terms = [];
  const notTerms = [];
  const filters = [];
  const notFilters = [];
  const errors = [];
  let pos = 0;
  let hasOr = false;

  const peek = () => tokens[pos];
  const atOr = () => (peek() ?? '').toLowerCase() === 'or';
  const atClose = () => peek() === ')';

  // One atom: `field:value`, a bare word, or a token we cannot use. Returns a
  // leaf node, or null for a paren this level should not have seen.
  const parseAtom = (raw) => {
    // `not:` and a leading `-` both exclude. `not:` is what a user asks for by
    // name; `-` is the shorthand. A lone `-` is still just a character.
    const lowerRaw = raw.toLowerCase();
    const negated = lowerRaw.startsWith('not:')
      ? { not: true, token: raw.slice(4) }
      : (raw.length > 1 && raw.startsWith('-') ? { not: true, token: raw.slice(1) } : { not: false, token: raw });
    const not = negated.not;
    const token = negated.token;
    const pushTerm = (value) => (not ? notTerms : terms).push(value);
    const pushFilter = (value) => (not ? notFilters : filters).push(value);

    const at = token.indexOf(':');
    if (at <= 0) {
      const value = lower(token);
      pushTerm(value);
      return { type: 'term', value, negated: not };
    }
    const field = token.slice(0, at).toLowerCase();
    const value = token.slice(at + 1);
    const fail = (reason) => {
      errors.push({ token, field, value, reason });
      pushTerm(lower(token));
      return { type: 'term', value: lower(token), negated: not };
    };

    if (!FIELDS.includes(field)) return fail('unknown-field');
    if (!value) return fail('empty-value');
    if (field === 'has' && !HAS_FLAGS.includes(lower(value))) return fail('unknown-has');
    if (field === 'is' && !IS_VALUES.includes(lower(value))) return fail('unknown-is');
    const filter = { field, value: lower(value) };
    pushFilter(filter);
    return { type: 'filter', ...filter, negated: not };
  };

  // How deep inside parentheses we are: a `)` at depth 0 is a stray one, and
  // `parseAnd` must not treat it as the end of a group it is not inside.
  let depth = 0;

  const parseFactor = () => {
    if (peek() === '(') {
      pos += 1;
      depth += 1;
      const node = parseOr();
      if (peek() === ')') pos += 1;
      else errors.push({ token: '(', field: '(', value: '', reason: 'unbalanced' });
      depth -= 1;
      return node;
    }
    if (peek() === ')') {
      // a closing paren with no opener: reported, and skipped rather than
      // swallowing the rest of the query
      errors.push({ token: ')', field: ')', value: '', reason: 'unbalanced' });
      pos += 1;
      return null;
    }
    const node = parseAtom(tokens[pos]);
    pos += 1;
    return node;
  };

  const parseAnd = () => {
    const clauses = [];
    while (pos < tokens.length && !atOr() && !(atClose() && depth > 0)) {
      const node = parseFactor();
      if (node) clauses.push(node);
    }
    if (!clauses.length) return null;
    return clauses.length === 1 ? clauses[0] : { type: 'and', clauses };
  };

  const parseOr = () => {
    const clauses = [];
    const first = parseAnd();
    if (first) clauses.push(first);
    while (atOr()) {
      hasOr = true;
      // an `OR` with nothing before it is a mistake, but the right-hand side is
      // still parsed, so the rest of the query survives
      if (!clauses.length) errors.push({ token: 'OR', field: 'OR', value: '', reason: 'dangling-or' });
      pos += 1;
      const next = parseAnd();
      if (next) clauses.push(next);
      else errors.push({ token: 'OR', field: 'OR', value: '', reason: 'dangling-or' });
    }
    if (!clauses.length) return null;
    return clauses.length === 1 ? clauses[0] : { type: 'or', clauses };
  };

  const ast = parseOr();
  const parsed = { terms, notTerms, filters, notFilters, errors };
  // A plain AND is already the flat lists; only a disjunction needs the tree.
  if (hasOr) parsed.ast = ast;
  return parsed;
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

/**
 * The private notes about one contact, as plain text (#38).
 *
 * They are records of their own — `{ [contactId]: [{ id, at, text }] }` — never
 * a card field, so they arrive from the caller rather than from the card. This
 * reader is deliberately tolerant: a missing map, a map without the contact, a
 * list of strings or a list of records all read as "the note texts", so a
 * caller that has not loaded them yet simply contributes nothing.
 */
function privateNoteTexts(notes, contactId) {
  const id = text(contactId);
  if (!id || !notes || typeof notes !== 'object') return [];
  const list = notes[id];
  if (!Array.isArray(list)) return [];
  return list.map((entry) => text(typeof entry === 'string' ? entry : entry?.text)).filter(Boolean);
}

/** Every text a free-text term may match, lower-cased. */
function freeTextTerms(card, bookTerms, noteTexts) {
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
    ...noteTexts,
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
function indexEntry(card, books, notes) {
  const bookTerms = bookTermsOf(card, books);
  const noteTexts = privateNoteTexts(notes, card?.id);
  return {
    card,
    names: [
      contactName(card),
      ...Object.values(card?.nicknames ?? {}).map((entry) => text(entry?.name)),
    ].filter(Boolean).map(lower),
    free: freeTextTerms(card, bookTerms, noteTexts),
    emails: emailEntries(card).map((entry) => lower(entry.address)),
    phones: phoneEntries(card).map((entry) => digits(entry.number).replace(/^0+/, '')).filter(Boolean),
    companies: companyTerms(card).map(lower),
    // The card's own notes and the private ones are one field to the matcher:
    // `note:` and `has:note` describe "a note about this contact", and where it
    // is kept is not the searcher's concern.
    notes: [
      ...Object.values(card?.notes ?? {}).map((entry) => lower(entry?.note)),
      ...noteTexts.map(lower),
    ],
    tags: Object.keys(card?.keywords ?? {}).map(lower),
    books: bookTerms.map(lower),
    company: isCompany(card),
  };
}

/**
 * Derives the searchable strings for every card **once**, so a page can run
 * many queries — the list, plus one count per saved search — without reading
 * the cards again each time.
 *
 * `notes` is the private-note record (#38) as `{ [contactId]: [{ text }] }`.
 * Passing it is what makes `note:` and free text see a note the user wrote, so
 * every surface that counts matches has to pass the same map — the list, the
 * saved-search chips and the palette dialog — or they would disagree.
 */
export function buildIndex(cards, { books, notes } = {}) {
  return (Array.isArray(cards) ? cards : []).map((card) => indexEntry(card, books, notes));
}

/** Does one indexed card carry this filter? */
function filterMatches(entry, { field, value }) {
  if (field === 'name') return hasTerm(entry.names, value) || hasFuzzyName(entry.names, value);
  if (field === 'email') return hasTerm(entry.emails, value);
  if (field === 'phone') {
    const wanted = digits(value).replace(/^0+/, '');
    return Boolean(wanted) && entry.phones.some((number) => number.includes(wanted));
  }
  if (field === 'company') return hasTerm(entry.companies, value);
  if (field === 'note') return hasTerm(entry.notes, value);
  if (field === 'tag') return entry.tags.includes(value);
  if (field === 'book') return entry.books.includes(value);
  if (field === 'has') {
    return Boolean({
      email: entry.emails.length,
      phone: entry.phones.length,
      note: entry.notes.length,
      tag: entry.tags.length,
    }[value]);
  }
  if (field === 'is') return (value === 'company') === entry.company;
  // an unknown field never filters anything out
  return true;
}

/** Does one indexed card carry this leaf (a term or a filter)? */
function leafMatches(entry, node) {
  const hit = node.type === 'term'
    ? hasTerm(entry.free, node.value) || hasFuzzyName(entry.names, node.value)
    : filterMatches(entry, node);
  // a negated leaf must NOT match; a plain one must
  return hit !== (node.negated === true);
}

/** Evaluates one node of a parsed query's `ast`. */
function nodeMatches(entry, node) {
  if (!node) return true;
  if (node.type === 'and') return node.clauses.every((clause) => nodeMatches(entry, clause));
  if (node.type === 'or') return node.clauses.some((clause) => nodeMatches(entry, clause));
  return leafMatches(entry, node);
}

/**
 * Does one indexed card satisfy a parsed query?
 *
 * When the query used `OR`/grouping, `parsed.ast` holds the tree and decides;
 * otherwise every flat term and filter must hold — the same rule as before, so
 * a simple query is unchanged.
 */
export function matchIndexed(entry, parsed) {
  if (parsed?.ast) return nodeMatches(entry, parsed.ast);
  const hasText = (term) => hasTerm(entry.free, term) || hasFuzzyName(entry.names, term);
  for (const term of parsed.terms) if (!hasText(term)) return false;
  for (const term of parsed.notTerms ?? []) if (hasText(term)) return false;

  for (const filter of parsed.filters ?? []) if (!filterMatches(entry, filter)) return false;
  for (const filter of parsed.notFilters ?? []) if (filterMatches(entry, filter)) return false;

  return true;
}

/**
 * Whether a parsed query asks for nothing — no terms, no filters, no negations.
 * Exported so the page can decide "show everything" the same way `searchCards`
 * does, instead of guessing from the positive lists (which once made a query of
 * only negations silently show the whole address book).
 */
export const isBlankQuery = (parsed) => !parsed.terms.length && !parsed.filters.length
  && !(parsed.notTerms ?? []).length && !(parsed.notFilters ?? []).length;

const isBlank = isBlankQuery;

/** Does one card satisfy a parsed query? Convenience for a single card. */
export function matchCard(card, parsed, { books, notes } = {}) {
  return matchIndexed(indexEntry(card, books, notes), parsed);
}

/**
 * The cards matching `query`, with the parsed query so the page can show the
 * errors and the count without parsing twice.
 *
 * @returns {{results: any[], parsed: object}}
 */
export function searchCards(cards, query, { books, notes } = {}) {
  const list = Array.isArray(cards) ? cards : [];
  const parsed = parseQuery(query);
  if (isBlank(parsed)) return { results: list, parsed };
  return {
    results: buildIndex(list, { books, notes })
      .filter((entry) => matchIndexed(entry, parsed))
      .map((entry) => entry.card),
    parsed,
  };
}

/** How many cards a query matches, for a single query. */
export function countMatches(cards, query, { books, notes } = {}) {
  return searchCards(cards, query, { books, notes }).results.length;
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
