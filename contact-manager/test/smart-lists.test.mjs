// Smart lists (#13, the command-palette half): the list model, the members of a
// list, and the export file name. Pure.
import { describe, expect, it } from 'vitest';
import { ALL_KEY, fileNameFor, matchesFor, smartLists } from '../src/lib/smart-lists.js';
import { buildIndex } from '../src/lib/search.js';
import { makeCard } from './fixtures.mjs';

const CARDS = [
  makeCard({ id: 'a', name: 'Ada Lovelace', emails: ['ada@example.org'], keywords: { vip: true } }),
  makeCard({ id: 'b', name: 'Grace Hopper', emails: ['grace@navy.mil'] }),
  makeCard({ id: 'c', name: 'Alan Turing', emails: ['alan@example.org'] }),
];

describe('smartLists', () => {
  it('always offers "everything" first', () => {
    const lists = smartLists([], { total: 3 });
    expect(lists).toEqual([{ key: ALL_KEY, name: '', query: '', count: 3, all: true }]);
    expect(ALL_KEY).toBe('*');
  });

  it('pairs each saved search with its count, in order', () => {
    const saved = [{ name: 'VIP', query: 'tag:vip' }, { name: 'On example.org', query: 'email:example.org' }];
    const lists = smartLists(saved, { total: 3, counts: [1, 2] });

    expect(lists.map((entry) => entry.key)).toEqual([ALL_KEY, 'list:VIP', 'list:On example.org']);
    expect(lists.map((entry) => entry.count)).toEqual([3, 1, 2]);
    expect(lists[1]).toMatchObject({ name: 'VIP', query: 'tag:vip', all: false });
  });

  it('reads junk as an empty set of lists', () => {
    expect(smartLists(null)).toEqual([{ key: ALL_KEY, name: '', query: '', count: 0, all: true }]);
    expect(smartLists('nope').map((entry) => entry.count)).toEqual([0]);
  });

  it('reads a missing or junk count as 0, and never negative', () => {
    const lists = smartLists([{ name: 'A', query: 'x' }, { name: 'B', query: 'y' }], { total: -4, counts: ['nope', 2] });
    expect(lists.map((entry) => entry.count)).toEqual([0, 0, 2]);
  });
});

describe('matchesFor', () => {
  const index = buildIndex(CARDS, {});

  it('a blank query (the "everything" entry) is the whole index', () => {
    expect(matchesFor(index, { key: ALL_KEY, query: '' }).map((card) => card.id)).toEqual(['a', 'b', 'c']);
  });

  it('filters by the list query, using the same matcher the page uses', () => {
    expect(matchesFor(index, { query: 'tag:vip' }).map((card) => card.id)).toEqual(['a']);
    expect(matchesFor(index, { query: 'email:example.org' }).map((card) => card.id)).toEqual(['a', 'c']);
    expect(matchesFor(index, { query: 'name:Nobody' })).toEqual([]);
  });

  it('reads junk as an empty index', () => {
    expect(matchesFor(null, { query: '' })).toEqual([]);
  });
});

describe('fileNameFor', () => {
  it('names the file after the list', () => {
    expect(fileNameFor('VIP customers', 'vcard')).toBe('vip-customers.vcf');
    expect(fileNameFor('VIP customers', 'csv')).toBe('vip-customers.csv');
  });

  it('falls back to a generic name when the list has none to give', () => {
    expect(fileNameFor('', 'vcard')).toBe('smart-list.vcf');
    expect(fileNameFor(null)).toBe('smart-list.vcf');
    expect(fileNameFor('!!!', 'csv')).toBe('smart-list.csv');
  });

  it('strips anything that is not safe in a file name', () => {
    expect(fileNameFor('Acme / EU: 2026', 'vcard')).toBe('acme-eu-2026.vcf');
  });
});
