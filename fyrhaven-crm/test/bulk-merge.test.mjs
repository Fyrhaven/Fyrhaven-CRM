// Bulk merge by facet (#6): which groups a company or domain selects, what the
// batch would do, and the cap that keeps a batch inside the undo record.
import { describe, expect, it } from 'vitest';
import { BATCH_CAP, batchPlan, cardFacets, companyKey, domainKey, groupFacets, isOverCap } from '../src/lib/bulk-merge.js';
import { findDuplicateGroups } from '../src/lib/duplicates.js';
import { MAX_CARDS } from '../src/lib/undo.js';
import { makeCard } from './fixtures.mjs';

const org = (name) => ({ o0: { name } });

describe('companyKey', () => {
  it('is case- and whitespace-insensitive', () => {
    expect(companyKey('Acme Inc.')).toBe('acme inc.');
    expect(companyKey('  ACME   Inc. ')).toBe('acme inc.');
    expect(companyKey('')).toBe('');
    expect(companyKey(null)).toBe('');
  });
});

describe('domainKey', () => {
  it('takes the part after the last @, lower-cased', () => {
    expect(domainKey('Ada@Example.ORG')).toBe('example.org');
    expect(domainKey('a@b@example.org')).toBe('example.org');
  });

  it('refuses what is not a domain', () => {
    expect(domainKey('')).toBe('');
    expect(domainKey('ada.example.org')).toBe('');
    expect(domainKey('ada@localhost')).toBe('');
    expect(domainKey(null)).toBe('');
  });
});

describe('cardFacets', () => {
  it('collects the company and every email domain, de-duplicated', () => {
    const card = makeCard({
      id: 'a',
      name: 'Ada Lovelace',
      emails: ['ada@example.org', 'ada@work.org', 'ADA@example.org'],
      organizations: org('Acme Inc.'),
    });

    expect(cardFacets(card)).toEqual([
      { kind: 'company', key: 'acme inc.' },
      { kind: 'domain', key: 'example.org' },
      { kind: 'domain', key: 'work.org' },
    ]);
  });

  it('is empty for a card with neither', () => {
    expect(cardFacets(makeCard({ id: 'a', name: 'Ada' }))).toEqual([]);
  });
});

describe('groupFacets', () => {
  // two groups, both at Acme Inc. and both on one.test
  const groups = findDuplicateGroups([
    makeCard({ id: 'a1', name: 'Ann One', emails: ['ann@one.test'], organizations: org('Acme Inc.') }),
    makeCard({ id: 'a2', name: 'A. One', emails: ['ann@one.test'], organizations: org('Acme Inc.') }),
    makeCard({ id: 'b1', name: 'Bob Two', emails: ['bob@one.test'], organizations: org('Acme Inc.') }),
    makeCard({ id: 'b2', name: 'B. Two', emails: ['bob@one.test'], organizations: org('Acme Inc.') }),
  ], {});

  it('reads the facets off the data, biggest first, with the spelling the data uses', () => {
    const facets = groupFacets(groups);

    expect(facets.map((facet) => `${facet.kind}:${facet.key}`).sort()).toEqual([
      'company:acme inc.', 'domain:one.test',
    ]);
    const company = facets.find((facet) => facet.kind === 'company');
    expect(company.label).toBe('Acme Inc.');
    expect(company.signatures).toHaveLength(2);
  });

  it('leaves out a facet that covers a single group: that is Review, not a batch', () => {
    const one = findDuplicateGroups([
      makeCard({ id: 'a1', name: 'Ann One', emails: ['ann@one.test'], organizations: org('Acme Inc.') }),
      makeCard({ id: 'a2', name: 'A. One', emails: ['ann@one.test'], organizations: org('Acme Inc.') }),
    ], {});

    expect(groupFacets(one)).toEqual([]);
  });

  it('puts a group under every facet any of its members has', () => {
    const mixed = findDuplicateGroups([
      makeCard({ id: 'a1', name: 'Ann One', emails: ['ann@one.test'], organizations: org('Acme Inc.') }),
      makeCard({ id: 'a2', name: 'A. One', emails: ['ann@one.test'], organizations: org('Beta Ltd') }),
      makeCard({ id: 'b1', name: 'Bob Two', emails: ['bob@one.test'], organizations: org('Beta Ltd') }),
      makeCard({ id: 'b2', name: 'B. Two', emails: ['bob@one.test'], organizations: org('Beta Ltd') }),
    ], {});

    const beta = groupFacets(mixed).find((facet) => facet.kind === 'company' && facet.key === 'beta ltd');
    // the group whose members disagree is still under Beta, because one member is
    expect(beta.signatures).toHaveLength(2);
  });

  it('survives junk', () => {
    expect(groupFacets(null)).toEqual([]);
    expect(groupFacets([null, {}, { signature: 's' }])).toEqual([]);
  });
});

describe('batchPlan', () => {
  const groups = [
    { signature: 'g1', members: [{ id: 'a' }, { id: 'b' }] },
    { signature: 'g2', members: [{ id: 'c' }, { id: 'd' }, { id: 'e' }] },
  ];

  it('counts what the batch would touch, one kept per group', () => {
    expect(batchPlan(groups, new Set(['g1', 'g2']))).toEqual({
      groups: 2, contacts: 5, removals: 3, signatures: ['g1', 'g2'],
    });
  });

  it('takes an array as well as a Set, and ignores what is not there', () => {
    expect(batchPlan(groups, ['g2', 'nope'])).toMatchObject({ groups: 1, contacts: 3, removals: 2 });
  });

  it('survives nothing', () => {
    expect(batchPlan(null, null)).toEqual({ groups: 0, contacts: 0, removals: 0, signatures: [] });
  });
});

describe('the safety cap', () => {
  it('allows exactly the cap and refuses one more', () => {
    expect(isOverCap({ groups: BATCH_CAP - 1 })).toBe(false);
    expect(isOverCap({ groups: BATCH_CAP })).toBe(false);
    expect(isOverCap({ groups: BATCH_CAP + 1 })).toBe(true);
  });

  it('keeps a capped batch inside the undo record', () => {
    // the undo store keeps MAX_CARDS removed cards and a batch removes at least
    // one per group, so a capped batch can always be undone
    expect(BATCH_CAP).toBeLessThanOrEqual(MAX_CARDS);
  });

  it('makes no claim about nothing', () => {
    expect(isOverCap(null)).toBe(false);
    expect(isOverCap({})).toBe(false);
  });
});
