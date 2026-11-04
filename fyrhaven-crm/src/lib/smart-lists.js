// Smart lists (#13, the command-palette half).
//
// A saved search is a *smart list*: a query with a live count. The Contacts page
// has offered them as chips since v1.16.0; this is the half the palette needs —
// the lists, their counts and their members, reachable without leaving the page
// you are on.
//
// Pure — no DOM, no api. The dialog is smart-lists-dialog.js.

import { isBlankQuery, matchIndexed, parseQuery } from './search.js';

/** The key of the "everything" entry, which is not a saved search. */
export const ALL_KEY = '*';

const toCount = (value) => (Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0);

/**
 * The lists a user can pick: "everything" first, then each saved search with its
 * live count. `counts` is positionally aligned with `saved` — the shape
 * `countsForIndex` returns — so the two can never drift out of order.
 */
export function smartLists(saved, { total = 0, counts = [] } = {}) {
  const lists = Array.isArray(saved) ? saved : [];
  return [
    { key: ALL_KEY, name: '', query: '', count: toCount(total), all: true },
    ...lists.map((item, index) => ({
      key: `list:${String(item?.name ?? '')}`,
      name: String(item?.name ?? ''),
      query: String(item?.query ?? ''),
      count: toCount(counts[index]),
      all: false,
    })),
  ];
}

/**
 * The contacts a list holds, from a built search index. A blank query (the
 * "everything" entry, or a search with no terms) is the whole index — the same
 * rule the Contacts page uses, so the count and the members cannot disagree.
 */
export function matchesFor(index, entry) {
  const entries = Array.isArray(index) ? index : [];
  const parsed = parseQuery(entry?.query ?? '');
  if (isBlankQuery(parsed)) return entries.map((item) => item.card);
  return entries.filter((item) => matchIndexed(item, parsed)).map((item) => item.card);
}

/**
 * A safe file name for an exported smart list, so the download says what it
 * holds instead of the generic `contacts.vcf`.
 */
export function fileNameFor(name, format = 'vcard') {
  const ext = format === 'csv' ? 'csv' : 'vcf';
  const base = String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60);
  return `${base || 'smart-list'}.${ext}`;
}
