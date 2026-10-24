// The query language and the matcher behind the Contacts search box.
import { describe, expect, it } from 'vitest';
import {
  countMatches, matchCard, parseQuery, searchCards,
} from '../src/lib/search.js';
import { makeCard } from './fixtures.mjs';

const ADA = makeCard({
  id: 'a',
  name: 'Ada Lovelace',
  emails: ['ada@engines.example'],
  phones: ['+49 176 1234567'],
  organizations: { o: { name: 'Engines Ltd' } },
  notes: { n: { note: 'Met at the analytical engine talk' } },
  keywords: { vip: true, maths: true },
});
const GRACE = makeCard({
  id: 'g', name: 'Grace Hopper', emails: ['grace@navy.mil'], phones: ['5551234'],
  keywords: { vip: true },
});
const ACME = {
  id: 'co', kind: 'org', name: { full: 'Acme Ltd' }, keywords: { company: true },
  addressBookIds: { b2: true },
};
const CARDS = [ADA, GRACE, ACME];
const BOOKS = new Map([['b1', 'Personal'], ['b2', 'Work']]);
const ids = (cards) => cards.map((card) => card.id);

describe('matchCard and searchCards', () => {
  it('matches free text across names, emails, phones, companies, notes and tags', () => {
    expect(ids(searchCards(CARDS, 'lovelace').results)).toEqual(['a']);
    expect(ids(searchCards(CARDS, 'navy.mil').results)).toEqual(['g']);
    expect(ids(searchCards(CARDS, 'engines').results)).toEqual(['a']);
    expect(ids(searchCards(CARDS, 'analytical').results)).toEqual(['a']);
    expect(ids(searchCards(CARDS, 'vip').results)).toEqual(['a', 'g']);
  });

  it('requires every term to match', () => {
    expect(ids(searchCards(CARDS, 'vip navy').results)).toEqual(['g']);
    expect(ids(searchCards(CARDS, 'vip nothinglikethis').results)).toEqual([]);
  });

  it('returns the whole list for an empty query', () => {
    expect(ids(searchCards(CARDS, '   ').results)).toEqual(['a', 'g', 'co']);
  });

  it('scopes a term to one field', () => {
    expect(ids(searchCards(CARDS, 'name:grace').results)).toEqual(['g']);
    expect(ids(searchCards(CARDS, 'email:navy').results)).toEqual(['g']);
    // 'engines' is in the email domain and the organisation, but not the name
    expect(ids(searchCards(CARDS, 'name:engines').results)).toEqual([]);
  });

  it('compares phone digits, so formatting does not matter', () => {
    expect(ids(searchCards(CARDS, 'phone:01761234567').results)).toEqual(['a']);
    expect(ids(searchCards(CARDS, 'phone:+49 176 1234567').results)).toEqual(['a']);
    expect(ids(searchCards(CARDS, 'phone:5551234').results)).toEqual(['g']);
  });

  it('matches a company by organisation name or email domain', () => {
    expect(ids(searchCards(CARDS, 'company:engines').results)).toEqual(['a']);
    expect(ids(searchCards(CARDS, 'company:acme').results)).toEqual(['co']);
  });

  it('matches a tag whole, not as a substring', () => {
    expect(ids(searchCards(CARDS, 'tag:vip').results)).toEqual(['a', 'g']);
    expect(ids(searchCards(CARDS, 'tag:vi').results)).toEqual([]);
  });

  it('matches an address book by name or id', () => {
    expect(ids(searchCards(CARDS, 'book:Work', { books: BOOKS }).results)).toEqual(['co']);
    expect(ids(searchCards(CARDS, 'book:b2', { books: BOOKS }).results)).toEqual(['co']);
    expect(ids(searchCards(CARDS, 'book:Personal', { books: BOOKS }).results)).toEqual(['a', 'g']);
  });

  it('filters on presence', () => {
    expect(ids(searchCards(CARDS, 'has:phone').results)).toEqual(['a', 'g']);
    expect(ids(searchCards(CARDS, 'has:note').results)).toEqual(['a']);
    expect(ids(searchCards(CARDS, 'has:tag').results)).toEqual(['a', 'g', 'co']);
  });

  it('filters on what kind of contact it is', () => {
    expect(ids(searchCards(CARDS, 'is:company').results)).toEqual(['co']);
    expect(ids(searchCards(CARDS, 'is:person').results)).toEqual(['a', 'g']);
  });

  it('combines operators and free text', () => {
    expect(ids(searchCards(CARDS, 'is:person tag:vip has:phone', { books: BOOKS }).results)).toEqual(['a', 'g']);
    expect(ids(searchCards(CARDS, 'is:person has:note').results)).toEqual(['a']);
  });

  it('finds a name with letters missing, from three characters up', () => {
    expect(ids(searchCards(CARDS, 'grce').results)).toEqual(['g']);
    expect(ids(searchCards(CARDS, 'lovelac').results)).toEqual(['a']);
    // two characters must not fuzzy-match the whole book
    expect(ids(searchCards(CARDS, 'gc').results)).toEqual([]);
  });

  it('reports the parsed query so the page can show errors and counts', () => {
    const { parsed } = searchCards(CARDS, 'nope:x');
    expect(parsed.errors).toHaveLength(1);
    expect(countMatches(CARDS, 'tag:vip')).toBe(2);
  });

  it('survives cards with nothing in them', () => {
    expect(searchCards([{ id: 'empty' }], 'anything').results).toEqual([]);
    expect(searchCards(null, 'x').results).toEqual([]);
    expect(matchCard(null, parseQuery('x'))).toBe(false);
  });
});

describe('search performance', () => {
  it('stays well inside the 100 ms budget for 10k contacts', () => {
    const many = Array.from({ length: 10_000 }, (_, i) => makeCard({
      id: `c${i}`,
      name: `Person ${i}`,
      emails: [`person${i}@example.org`],
      phones: [`+4917600${String(i).padStart(5, '0')}`],
      keywords: { vip: i % 3 === 0 },
    }));

    // Best of three, after a warm-up. The suite runs its files in parallel, so
    // a single measurement picks up scheduler noise — one run of this test
    // measured 103 ms purely because the other workers were busy, which failed
    // a release. Noise only ever makes a run *slower*, so the minimum is the
    // closest to the real cost, while a genuine regression raises every run.
    const query = 'tag:vip has:phone person9';
    searchCards(many, query, { books: BOOKS });
    const runs = [];
    let results = [];
    for (let i = 0; i < 3; i += 1) {
      const started = performance.now();
      results = searchCards(many, query, { books: BOOKS }).results;
      runs.push(performance.now() - started);
    }

    expect(results.length).toBeGreaterThan(0);
    expect(Math.min(...runs)).toBeLessThan(100);
  });
});

describe('parseQuery', () => {
  it('reads free text and operators', () => {
    const parsed = parseQuery('ada tag:vip has:phone');

    expect(parsed.terms).toEqual(['ada']);
    expect(parsed.filters).toEqual([
      { field: 'tag', value: 'vip' },
      { field: 'has', value: 'phone' },
    ]);
    expect(parsed.errors).toEqual([]);
  });

  it('lower-cases operators and values', () => {
    expect(parseQuery('TAG:VIP').filters).toEqual([{ field: 'tag', value: 'vip' }]);
  });

  it('reports an unknown field and still searches for the text', () => {
    const parsed = parseQuery('nope:x ada');

    expect(parsed.errors).toEqual([{ token: 'nope:x', field: 'nope', value: 'x', reason: 'unknown-field' }]);
    // the token stays a free-text term, so a typo does not silently return nothing
    expect(parsed.terms).toEqual(['nope:x', 'ada']);
  });

  it('reports a has: or is: value it cannot use', () => {
    expect(parseQuery('has:fax').errors[0]).toMatchObject({ field: 'has', reason: 'unknown-has' });
    expect(parseQuery('is:robot').errors[0]).toMatchObject({ field: 'is', reason: 'unknown-is' });
  });

  it('reports an operator with no value', () => {
    expect(parseQuery('tag:').errors[0]).toMatchObject({ field: 'tag', reason: 'empty-value' });
  });

  it('treats a colon inside a value as part of the value', () => {
    expect(parseQuery('email:a@b.de').filters).toEqual([{ field: 'email', value: 'a@b.de' }]);
  });

  it('reads an empty query as no terms and no filters', () => {
    expect(parseQuery('   ')).toEqual({ terms: [], filters: [], errors: [] });
  });
});
