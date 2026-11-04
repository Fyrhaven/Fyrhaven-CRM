import { describe, expect, it } from 'vitest';
import {
  effectiveOpts, filterForScan, isCardIgnored, isCardScannable,
  normalizeIgnore, normalizePolicies, protectedFieldsFor, readIgnore, readPolicies,
  setBookPolicy, writeIgnore, writePolicies,
} from '../src/lib/book-policies.js';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { buildIndex } from '../src/lib/search.js';
import { makeCard } from './fixtures.mjs';

// ── Normalisation ───────────────────────────────────────────────

describe('normalizePolicies', () => {
  it('returns an empty object for junk input', () => {
    expect(normalizePolicies(null)).toEqual({});
    expect(normalizePolicies('nope')).toEqual({});
    expect(normalizePolicies([])).toEqual({});
  });

  it('keeps only known fields with valid booleans', () => {
    const result = normalizePolicies({
      b1: { enabled: false, matchByEmail: true, extra: 'no', matchByName: 'yes' },
    });
    expect(result).toEqual({ b1: { enabled: false, matchByEmail: true } });
  });

  it('drops books with no valid overrides', () => {
    expect(normalizePolicies({ b1: { extra: 'junk' } })).toEqual({});
    expect(normalizePolicies({ b1: {} })).toEqual({});
  });

  it('trims and drops empty book ids', () => {
    expect(normalizePolicies({ '': { enabled: true }, '  ': { enabled: false } })).toEqual({});
  });

  it('caps the number of book entries', () => {
    const big = {};
    for (let i = 0; i < 300; i++) big[`b${i}`] = { enabled: false };
    expect(Object.keys(normalizePolicies(big)).length).toBeLessThanOrEqual(200);
  });
});

describe('normalizeIgnore', () => {
  it('returns empty lists for junk input', () => {
    expect(normalizeIgnore(null)).toEqual({ domains: [], tags: [], companies: [] });
    expect(normalizeIgnore('nope')).toEqual({ domains: [], tags: [], companies: [] });
  });

  it('lower-cases domains, trims tags and companies, drops empties', () => {
    const result = normalizeIgnore({
      domains: ['Example.COM', '  ', null, 'foo.de'],
      tags: ['VIP', '', null, 'do-not-merge'],
      companies: [' Acme Inc. ', '', null, 'Initech'],
    });
    expect(result).toEqual({
      domains: ['example.com', 'foo.de'],
      tags: ['VIP', 'do-not-merge'],
      companies: ['Acme Inc.', 'Initech'],
    });
  });

  it('caps each list at 50', () => {
    const big = {
      domains: Array.from({ length: 100 }, (_, i) => `d${i}.com`),
      tags: Array.from({ length: 100 }, (_, i) => `t${i}`),
      companies: Array.from({ length: 100 }, (_, i) => `c${i}`),
    };
    const capped = normalizeIgnore(big);
    expect(capped.domains.length).toBe(50);
    expect(capped.tags.length).toBe(50);
    expect(capped.companies.length).toBe(50);
  });
});

// ── Storage round trips ─────────────────────────────────────────

describe('readPolicies / writePolicies', () => {
  it('reads an empty store as empty', async () => {
    const api = fakeApi();
    expect(await readPolicies(api)).toEqual({});
  });

  it('round-trips a valid policies map', async () => {
    const api = fakeApi();
    const policies = { b1: { enabled: false, matchByEmail: true } };
    await writePolicies(api, policies);
    expect(await readPolicies(api)).toEqual(policies);
  });

  it('rewrites storage when junk was repaired', async () => {
    const api = fakeApi();
    await api.storage.set('bookPolicies', { b1: { enabled: false, junk: 'x' } });
    const result = await readPolicies(api);
    expect(result).toEqual({ b1: { enabled: false } });
    expect(await api.storage.get('bookPolicies')).toEqual({ b1: { enabled: false } });
  });

  it('removes the key when nothing valid remains', async () => {
    const api = fakeApi();
    await api.storage.set('bookPolicies', { b1: { junk: 'x' } });
    expect(await readPolicies(api)).toEqual({});
    expect(await api.storage.get('bookPolicies')).toBeNull();
  });
});

describe('setBookPolicy', () => {
  it('sets a field for a book', async () => {
    const api = fakeApi();
    const result = await setBookPolicy(api, 'b1', 'enabled', false);
    expect(result).toEqual({ b1: { enabled: false } });
  });

  it('clears a field with undefined', async () => {
    const api = fakeApi();
    await setBookPolicy(api, 'b1', 'enabled', false);
    await setBookPolicy(api, 'b1', 'matchByEmail', true);
    const result = await setBookPolicy(api, 'b1', 'enabled', undefined);
    expect(result).toEqual({ b1: { matchByEmail: true } });
  });

  it('removes the book when all fields are cleared', async () => {
    const api = fakeApi();
    await setBookPolicy(api, 'b1', 'enabled', false);
    const result = await setBookPolicy(api, 'b1', 'enabled', undefined);
    expect(result).toEqual({});
    expect(await api.storage.get('bookPolicies')).toBeNull();
  });

  it('rejects unknown fields', async () => {
    const api = fakeApi();
    const result = await setBookPolicy(api, 'b1', 'bogus', true);
    expect(result).toEqual({});
  });
});

describe('readIgnore / writeIgnore', () => {
  it('reads an empty store as empty lists', async () => {
    const api = fakeApi();
    expect(await readIgnore(api)).toEqual({ domains: [], tags: [], companies: [] });
  });

  it('round-trips valid ignore rules', async () => {
    const api = fakeApi();
    const rules = { domains: ['example.com'], tags: ['VIP'], companies: ['Acme Inc.'] };
    await writeIgnore(api, rules);
    expect(await readIgnore(api)).toEqual(rules);
  });

  it('removes the key when lists are empty', async () => {
    const api = fakeApi();
    await writeIgnore(api, { domains: [], tags: [], companies: [] });
    expect(await api.storage.get('bookIgnore')).toBeNull();
  });
});

// ── Application ─────────────────────────────────────────────────

describe('isCardScannable', () => {
  it('returns true when there are no policies', () => {
    expect(isCardScannable(makeCard({ id: 'a', name: 'A' }), {})).toBe(true);
    expect(isCardScannable(makeCard({ id: 'a', name: 'A' }), null)).toBe(true);
  });

  it('returns true for cards with no books (default book)', () => {
    expect(isCardScannable({ id: 'a' }, { b1: { enabled: false } })).toBe(true);
  });

  it('excludes cards only in disabled books', () => {
    const card = { id: 'a', addressBookIds: { b1: true } };
    expect(isCardScannable(card, { b1: { enabled: false } })).toBe(false);
  });

  it('includes cards in at least one enabled book', () => {
    const card = { id: 'a', addressBookIds: { b1: true, b2: true } };
    expect(isCardScannable(card, { b1: { enabled: false } })).toBe(true);
    expect(isCardScannable(card, { b1: { enabled: false }, b2: { enabled: false } })).toBe(false);
  });

  it('sees a card whose book the host reports as a single id', () => {
    // `bookIds` in contacts.js falls back to `addressBookId` (singular). The
    // policy check must agree with it, or such a card looks like it belongs to
    // no book at all — always scanned, always with the global strategies.
    const card = { id: 'a', addressBookId: 'b9' };
    expect(isCardScannable(card, { b9: { enabled: false } })).toBe(false);
    expect(effectiveOpts(card, { b9: { matchByName: false } }, {}).matchByName).toBe(false);
  });
});

describe('isCardIgnored', () => {
  it('returns false when there are no rules', () => {
    expect(isCardIgnored(makeCard({ id: 'a', name: 'A', emails: ['a@x.de'] }), null)).toBe(false);
    expect(isCardIgnored(makeCard({ id: 'a', name: 'A' }), { domains: [], tags: [] })).toBe(false);
  });

  it('matches by email domain (case insensitive)', () => {
    const card = makeCard({ id: 'a', name: 'A', emails: ['user@Example.COM'] });
    expect(isCardIgnored(card, { domains: ['example.com'], tags: [] })).toBe(true);
    expect(isCardIgnored(card, { domains: ['other.com'], tags: [] })).toBe(false);
  });

  it('matches by tag on the keywords shape the host actually uses', () => {
    // `keywords` is `{ tagName: true }` — the KEYS are the tags, which is how
    // search.js, bulk.js, editor.js and duplicates.js all read them. Reading
    // the *values* instead finds nothing, so no contact is ever ignored.
    const card = makeCard({ id: 'a', name: 'A', keywords: { VIP: true, customer: true } });
    expect(isCardIgnored(card, { domains: [], tags: ['vip'] })).toBe(true);
    expect(isCardIgnored(card, { domains: [], tags: ['friend'] })).toBe(false);
  });

  it('matches array-shaped keywords too', () => {
    const card = makeCard({ id: 'a', name: 'A', keywords: ['VIP', 'customer'] });
    expect(isCardIgnored(card, { domains: [], tags: ['vip'] })).toBe(true);
  });

  it('sees the same tags the search box does', () => {
    // One reading of `keywords` for the whole plugin: whatever `tag:vip`
    // matches in the search box is what an ignore rule matches here. If the
    // two ever drift, a user can search for a tag the policy cannot see.
    const card = makeCard({ id: 'a', name: 'A', keywords: { VIP: true } });
    const [entry] = buildIndex([card], { books: new Map() });
    expect(entry.tags).toEqual(['vip']);
    expect(isCardIgnored(card, { domains: [], tags: ['vip'] })).toBe(true);
  });

  it('matches by company, case-insensitively and on part of the name', () => {
    // A rule has to survive the ways the same employer is written down, or it
    // fails silently: "Acme" has to cover "Acme Inc." and "ACME GmbH".
    const card = makeCard({ id: 'a', name: 'A', organizations: { o: { name: 'Acme Inc.' } } });
    expect(isCardIgnored(card, { domains: [], tags: [], companies: ['acme'] })).toBe(true);
    expect(isCardIgnored(card, { domains: [], tags: [], companies: ['ACME INC.'] })).toBe(true);
    expect(isCardIgnored(card, { domains: [], tags: [], companies: ['Initech'] })).toBe(false);
  });

  it('matches no company when the contact has none', () => {
    const card = makeCard({ id: 'a', name: 'A' });
    expect(isCardIgnored(card, { domains: [], tags: [], companies: ['acme'] })).toBe(false);
    expect(isCardIgnored(card, { domains: [], tags: [], companies: [''] })).toBe(false);
  });
});

describe('effectiveOpts', () => {
  it('returns global opts when there are no policies', () => {
    const card = makeCard({ id: 'a', name: 'A' });
    const opts = { matchByEmail: true, matchByPhone: false, region: 'DE' };
    expect(effectiveOpts(card, {}, opts)).toBe(opts);
  });

  it('a book that says false loses when another book has no override', () => {
    const card = { id: 'a', addressBookIds: { b1: true, b2: true } };
    const policies = { b1: { matchByEmail: false } };
    // b2 has no override, so it defaults to global (true)
    expect(effectiveOpts(card, policies, {}).matchByEmail).toBe(true);
  });

  it('all books must say false for the strategy to be off', () => {
    const card = { id: 'a', addressBookIds: { b1: true, b2: true } };
    const policies = {
      b1: { matchByEmail: false },
      b2: { matchByEmail: false },
    };
    expect(effectiveOpts(card, policies, {}).matchByEmail).toBe(false);
  });

  it('preserves the region from global opts', () => {
    const card = { id: 'a', addressBookIds: { b1: true } };
    const result = effectiveOpts(card, { b1: { matchByEmail: false } }, { region: 'DE' });
    expect(result.region).toBe('DE');
  });
});

describe('filterForScan', () => {
  it('is a no-op with no policies and no ignore', () => {
    const cards = [makeCard({ id: 'a', name: 'A' }), makeCard({ id: 'b', name: 'B' })];
    const result = filterForScan(cards, {});
    expect(result.cards).toBe(cards);
    expect(result.perCardOpts).toBeNull();
  });

  it('filters out cards in disabled books', () => {
    const cards = [
      { id: 'a', addressBookIds: { b1: true } },
      { id: 'b', addressBookIds: { b2: true } },
    ];
    const result = filterForScan(cards, {
      policies: { b2: { enabled: false } },
      globalOpts: {},
    });
    expect(result.cards.map((c) => c.id)).toEqual(['a']);
  });

  it('filters out cards matching ignore rules', () => {
    const cards = [
      makeCard({ id: 'a', name: 'A', emails: ['a@example.com'] }),
      makeCard({ id: 'b', name: 'B', emails: ['b@other.de'] }),
    ];
    const result = filterForScan(cards, {
      ignore: { domains: ['example.com'], tags: [] },
      globalOpts: {},
    });
    expect(result.cards.map((c) => c.id)).toEqual(['b']);
  });

  it('computes per-card opts when policies are present', () => {
    const cards = [
      { id: 'a', addressBookIds: { b1: true } },
      { id: 'b', addressBookIds: { b2: true } },
    ];
    const result = filterForScan(cards, {
      policies: { b1: { matchByEmail: false } },
      globalOpts: { matchByEmail: true },
    });
    expect(result.perCardOpts[0].matchByEmail).toBe(false);
    expect(result.perCardOpts[1].matchByEmail).toBe(true);
  });
});

// ── Protected fields (#7) ───────────────────────────────────────

describe('protectedFieldsFor', () => {
  it('returns nothing without policies', () => {
    expect(protectedFieldsFor(makeCard({ id: 'a' }), {})).toEqual([]);
    expect(protectedFieldsFor(makeCard({ id: 'a' }), null)).toEqual([]);
  });

  it('unions the protected fields of every enabled book', () => {
    const card = makeCard({ id: 'a', addressBookIds: { b1: true, b2: true } });
    const policies = { b1: { protectedFields: ['name'] }, b2: { protectedFields: ['emails'] } };
    expect(protectedFieldsFor(card, policies).sort()).toEqual(['emails', 'name']);
  });

  it('ignores a book that is switched off', () => {
    const card = makeCard({ id: 'a', addressBookIds: { b1: true, b2: true } });
    const policies = { b2: { enabled: false, protectedFields: ['name'] } };
    expect(protectedFieldsFor(card, policies)).toEqual([]);
  });

  it('names a field once even when two books protect it', () => {
    const card = makeCard({ id: 'a', addressBookIds: { b1: true, b2: true } });
    const policies = { b1: { protectedFields: ['name'] }, b2: { protectedFields: ['name'] } };
    expect(protectedFieldsFor(card, policies)).toEqual(['name']);
  });
});

describe('protectedFields in the stored policy', () => {
  it('keeps known fields, drops the rest and de-duplicates', () => {
    expect(normalizePolicies({ b1: { protectedFields: ['name', 'nonsense', 'name'] } }))
      .toEqual({ b1: { protectedFields: ['name'] } });
  });

  it('drops an empty list or a value that is not a list', () => {
    expect(normalizePolicies({ b1: { protectedFields: [] } })).toEqual({});
    expect(normalizePolicies({ b1: { protectedFields: 'name' } })).toEqual({});
  });

  it('sets and clears the list through setBookPolicy', async () => {
    const api = fakeApi({});
    await setBookPolicy(api, 'b1', 'protectedFields', ['name', 'nonsense']);
    expect(await api.storage.get('bookPolicies')).toEqual({ b1: { protectedFields: ['name'] } });
    await setBookPolicy(api, 'b1', 'protectedFields', []);
    expect(await api.storage.get('bookPolicies')).toBeNull();
  });

  it('survives a round trip through storage', async () => {
    const api = fakeApi({});
    await writePolicies(api, { b1: { enabled: false, protectedFields: ['emails', 'phones'] } });
    expect(await readPolicies(api)).toEqual({ b1: { enabled: false, protectedFields: ['emails', 'phones'] } });
  });
});

