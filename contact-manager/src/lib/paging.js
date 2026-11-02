// Pagination for a long contact list (#39, the scale half).
//
// The Contacts page used to render every contact a query matched. That is fine
// for a few hundred and a freeze for tens of thousands — the whole match set
// became DOM, all at once. Paging keeps the *rendered* list bounded while the
// search box, the match counts and *Select all* still work over the whole match
// set: the page is a view of the results, not a limit on them.
//
// Pure — no DOM, no api. The UI lives in profile-page.js.

/** How many contacts one page holds. */
export const PAGE_SIZE = 100;

const perPage = (size) => (Number.isFinite(size) && size > 0 ? Math.trunc(size) : PAGE_SIZE);
const count = (total) => (Number.isFinite(total) && total > 0 ? Math.trunc(total) : 0);

/** How many pages a list of `total` items has — at least one, even when empty. */
export function pageCount(total, size = PAGE_SIZE) {
  return Math.max(1, Math.ceil(count(total) / perPage(size)));
}

/** Clamp a page index into range, so a shrinking list never leaves a blank page. */
export function clampPage(page, total, size = PAGE_SIZE) {
  const last = pageCount(total, size) - 1;
  const index = Number.isFinite(page) ? Math.trunc(page) : 0;
  return Math.min(Math.max(index, 0), last);
}

/** Whether a pager is worth showing at all: more than one page of items. */
export function isPaged(total, size = PAGE_SIZE) {
  return count(total) > perPage(size);
}

/**
 * The items on one page, with the 1-based range they cover and the page count.
 * `from`/`to` are 0/0 for an empty list, so the caller can word the line
 * without a special case for "nothing".
 */
export function pageSlice(list, page, size = PAGE_SIZE) {
  const items = Array.isArray(list) ? list : [];
  const per = perPage(size);
  const index = clampPage(page, items.length, per);
  const from = items.length ? index * per + 1 : 0;
  const to = Math.min((index + 1) * per, items.length);
  return {
    items: items.slice(index * per, (index + 1) * per),
    page: index,
    pages: pageCount(items.length, per),
    from,
    to,
    total: items.length,
  };
}
