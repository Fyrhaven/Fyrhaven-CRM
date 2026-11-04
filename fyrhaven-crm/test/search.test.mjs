// The query language and the matcher behind the Contacts search box.
import { describe, expect, it } from 'vitest';
import {
  buildIndex, countMatches, countsForIndex, matchCard, parseQuery, searchCards,
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
    expect(parseQuery('   ')).toEqual({ terms: [], notTerms: [], filters: [], notFilters: [], errors: [] });
  });
});

describe('negation', () => {
  it('parses a leading minus into the negative lists', () => {
    const parsed = parseQuery('-tag:vip -ada -has:phone');

    expect(parsed.notFilters).toEqual([{ field: 'tag', value: 'vip' }, { field: 'has', value: 'phone' }]);
    expect(parsed.notTerms).toEqual(['ada']);
    expect(parsed.filters).toEqual([]);
    expect(parsed.terms).toEqual([]);
  });

  it('excludes a tag instead of requiring it', () => {
    expect(ids(searchCards(CARDS, 'tag:vip').results)).toEqual(['a', 'g']);
    expect(ids(searchCards(CARDS, '-tag:vip').results)).toEqual(['co']);
  });

  it('excludes on presence and on text', () => {
    expect(ids(searchCards(CARDS, '-has:phone').results)).toEqual(['co']);
    expect(ids(searchCards(CARDS, 'is:person -grace').results)).toEqual(['a']);
  });

  it('combines with a positive filter', () => {
    expect(ids(searchCards(CARDS, 'is:person -has:note').results)).toEqual(['g']);
  });

  it('treats a lone minus as ordinary text', () => {
    const parsed = parseQuery('-');

    expect(parsed.terms).toEqual(['-']);
    expect(parsed.notTerms).toEqual([]);
  });

  it('still reports an unknown operator behind the minus', () => {
    const parsed = parseQuery('-nope:x');

    expect(parsed.errors[0]).toMatchObject({ field: 'nope', reason: 'unknown-field' });
    expect(parsed.notTerms).toEqual(['nope:x']);
  });

  it('a query of nothing but negations still searches', () => {
    expect(ids(searchCards(CARDS, '-tag:vip').results)).toEqual(['co']);
  });
});

describe('not:', () => {
  it('excludes, the same as the minus', () => {
    expect(parseQuery('not:tag:vip').notFilters).toEqual([{ field: 'tag', value: 'vip' }]);
    expect(ids(searchCards(CARDS, 'not:tag:vip').results)).toEqual(['co']);
  });

  it('works on a free word, and in either case', () => {
    expect(parseQuery('NOT:ada').notTerms).toEqual(['ada']);
    expect(ids(searchCards(CARDS, 'is:person NOT:grace').results)).toEqual(['a']);
  });

  it('is not a field of its own', () => {
    expect(parseQuery('not:tag:vip').errors).toEqual([]);
  });
});

describe('OR and grouping', () => {
  it('matches either side of an OR', () => {
    expect(ids(searchCards(CARDS, 'tag:vip OR tag:maths').results)).toEqual(['a', 'g']);
    expect(ids(searchCards(CARDS, 'tag:maths OR company:acme').results)).toEqual(['a', 'co']);
  });

  it('reads OR case-insensitively', () => {
    expect(ids(searchCards(CARDS, 'tag:maths or company:acme').results)).toEqual(['a', 'co']);
  });

  it('binds AND tighter than OR, so `a b OR c` is `(a AND b) OR c`', () => {
    // maths AND has:email -> Ada; OR is:company -> Acme
    expect(ids(searchCards(CARDS, 'tag:maths has:email OR is:company').results)).toEqual(['a', 'co']);
  });

  it('groups with parentheses', () => {
    // (vip OR maths) AND has:email -> Ada and Grace (both have email); Acme has none
    expect(ids(searchCards(CARDS, '(tag:vip OR tag:maths) has:email').results)).toEqual(['a', 'g']);
  });

  it('excludes inside a group', () => {
    // vip OR (no email) -> Ada, Grace, Acme
    expect(ids(searchCards(CARDS, '(tag:vip OR -has:email)').results)).toEqual(['a', 'g', 'co']);
  });

  it('only attaches the ast when the query is not a plain AND', () => {
    expect(parseQuery('tag:vip has:email').ast).toBeUndefined();
    expect(parseQuery('(tag:vip)').ast).toBeUndefined();
    expect(parseQuery('tag:vip OR tag:maths').ast).toMatchObject({ type: 'or' });
  });

  it('still fills the flat lists, for the error line and the chips', () => {
    const parsed = parseQuery('(tag:vip OR tag:maths) has:email');
    expect(parsed.filters).toEqual([{ field: 'tag', value: 'vip' }, { field: 'tag', value: 'maths' }, { field: 'has', value: 'email' }]);
    expect(parsed.errors).toEqual([]);
  });

  it('reports unbalanced parentheses', () => {
    expect(parseQuery('(tag:vip').errors[0]).toMatchObject({ reason: 'unbalanced' });
    expect(parseQuery('tag:vip)').errors[0]).toMatchObject({ reason: 'unbalanced' });
    // the atoms are still parsed, so the query is not thrown away
    expect(parseQuery('(tag:vip').filters).toEqual([{ field: 'tag', value: 'vip' }]);
  });

  it('reports a dangling OR', () => {
    expect(parseQuery('tag:vip OR').errors[0]).toMatchObject({ reason: 'dangling-or' });
    expect(parseQuery('OR tag:vip').errors[0]).toMatchObject({ reason: 'dangling-or' });
  });
});

describe('private notes (#38)', () => {
  // Grace has no note on her card; the note about her is a private record.
  const NOTES = { g: [{ id: 'n1', at: '2026-01-01T00:00:00Z', text: 'Introduced by Ada at the conference' }] };

  it('finds a contact by a word that only appears in a private note', () => {
    expect(ids(searchCards(CARDS, 'conference', { notes: NOTES }).results)).toEqual(['g']);
    // the positive twin: without the map nothing matches, so the hit is the note
    expect(ids(searchCards(CARDS, 'conference').results)).toEqual([]);
  });

  it('answers note: and has:note for a note wherever it is kept', () => {
    expect(ids(searchCards(CARDS, 'note:conference', { notes: NOTES }).results)).toEqual(['g']);
    // Ada's note is on her card, Grace's is private — one field to the searcher
    expect(ids(searchCards(CARDS, 'has:note', { notes: NOTES }).results)).toEqual(['a', 'g']);
    expect(ids(searchCards(CARDS, 'has:note').results)).toEqual(['a']);
  });

  it('never puts one contact\u2019s note on another', () => {
    expect(ids(searchCards(CARDS, 'conference', { notes: { a: NOTES.g } }).results)).toEqual(['a']);
    expect(ids(searchCards(CARDS, 'conference', { notes: { g: NOTES.g } }).results)).toEqual(['g']);
  });

  it('counts the same matches the list shows, so the chips cannot drift', () => {
    const index = buildIndex(CARDS, { notes: NOTES });
    expect(countsForIndex(index, ['conference', 'note:conference', 'has:note']))
      .toEqual([1, 1, 2]);
    expect(countMatches(CARDS, 'conference', { notes: NOTES })).toBe(1);
    expect(matchCard(GRACE, parseQuery('conference'), { notes: NOTES })).toBe(true);
  });

  it('reads a plain list of strings as well as a list of records', () => {
    expect(ids(searchCards(CARDS, 'conference', { notes: { g: ['Conference'] } }).results)).toEqual(['g']);
  });

  it('ignores a note record it cannot read, rather than throwing', () => {
    expect(ids(searchCards(CARDS, 'conference', { notes: { g: 'not a list' } }).results)).toEqual([]);
    expect(ids(searchCards(CARDS, 'conference', { notes: { g: [null, {}, { text: '  ' }] } }).results)).toEqual([]);
    expect(ids(searchCards(CARDS, 'conference', { notes: null }).results)).toEqual([]);
  });
});
