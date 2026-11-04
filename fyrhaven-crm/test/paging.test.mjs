// Pagination for a long contact list (#39, the scale half): the pure page math.
import { describe, expect, it } from 'vitest';
import { PAGE_SIZE, clampPage, isPaged, pageCount, pageSlice } from '../src/lib/paging.js';

const list = (n) => Array.from({ length: n }, (_, i) => i);

describe('pageCount', () => {
  it('is one page for an empty or exactly-full list', () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(100)).toBe(1);
    expect(pageCount(PAGE_SIZE)).toBe(1);
  });

  it('rounds up past the page size', () => {
    expect(pageCount(101)).toBe(2);
    expect(pageCount(250)).toBe(3);
    expect(pageCount(1000, 100)).toBe(10);
  });

  it('reads junk as an empty list, and a bad size as the default', () => {
    expect(pageCount(NaN)).toBe(1);
    expect(pageCount(-5)).toBe(1);
    expect(pageCount(250, 0)).toBe(3);
    expect(pageCount(250, 'nope')).toBe(3);
  });
});

describe('clampPage', () => {
  it('keeps a page in range, so a shrinking list never leaves a blank page', () => {
    expect(clampPage(0, 250)).toBe(0);
    expect(clampPage(2, 250)).toBe(2);
    expect(clampPage(9, 250)).toBe(2);
    expect(clampPage(-3, 250)).toBe(0);
    expect(clampPage(4, 0)).toBe(0);
    expect(clampPage(NaN, 250)).toBe(0);
  });
});

describe('isPaged', () => {
  it('is only true when there is more than one page', () => {
    expect(isPaged(0)).toBe(false);
    expect(isPaged(PAGE_SIZE)).toBe(false);
    expect(isPaged(PAGE_SIZE + 1)).toBe(true);
    expect(isPaged(1000)).toBe(true);
  });
});

describe('pageSlice', () => {
  it('returns the first page and the 1-based range it covers', () => {
    const result = pageSlice(list(250), 0);
    expect(result.items).toHaveLength(100);
    expect(result.items[0]).toBe(0);
    expect(result.items.at(-1)).toBe(99);
    expect(result).toMatchObject({ page: 0, pages: 3, from: 1, to: 100, total: 250 });
  });

  it('returns a middle page', () => {
    const result = pageSlice(list(250), 1);
    expect(result.items[0]).toBe(100);
    expect(result).toMatchObject({ page: 1, pages: 3, from: 101, to: 200 });
  });

  it('returns a short last page', () => {
    const result = pageSlice(list(250), 2);
    expect(result.items).toHaveLength(50);
    expect(result).toMatchObject({ page: 2, pages: 3, from: 201, to: 250 });
  });

  it('clamps a page past the end to the last one', () => {
    expect(pageSlice(list(250), 9)).toMatchObject({ page: 2, from: 201, to: 250 });
  });

  it('reads an empty list as page 1 of 1, with a 0 range', () => {
    expect(pageSlice([], 0)).toMatchObject({ items: [], page: 0, pages: 1, from: 0, to: 0, total: 0 });
  });

  it('reads junk input as an empty list', () => {
    expect(pageSlice(null, 3)).toMatchObject({ items: [], pages: 1, total: 0 });
  });

  it('honours a custom page size', () => {
    const result = pageSlice(list(10), 1, 4);
    expect(result.items).toEqual([4, 5, 6, 7]);
    expect(result).toMatchObject({ pages: 3, from: 5, to: 8 });
  });
});

// ── The scale budget (#39) ──────────────────────────────────────
//
// Slicing a page must not walk the whole list: the point of paging is that the
// cost of showing one page does not grow with the size of the address book.

describe('the paging budget', () => {
  it('slices one page out of 100k contacts well inside a budget', () => {
    const big = Array.from({ length: 100_000 }, (_, i) => i);

    const start = performance.now();
    const result = pageSlice(big, 999);
    const elapsed = performance.now() - start;

    expect(result.items).toHaveLength(100);
    expect(result.pages).toBe(1000);
    expect(result).toMatchObject({ page: 999, from: 99901, to: 100000 });
    expect(elapsed).toBeLessThan(25);
  });
});
