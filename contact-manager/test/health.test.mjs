// The health rules, their weights, the bands, and the dashboard's numbers.
import { describe, expect, it } from 'vitest';
import {
  BANDS, RULES, RULE_KEYS, STALE_MONTHS, contactHealth, contactIssues, fixableContacts,
  healthBand, healthScore, healthSummary, withIssue,
} from '../src/lib/health.js';
import { makeCard } from './fixtures.mjs';

const keys = (card, context) => contactIssues(card, context).map((issue) => issue.key);

const CLEAN = makeCard({ id: 'good', name: 'Ada Lovelace', emails: ['ada@example.org'], phones: ['+491761234567'] });

describe('the rules', () => {
  it('has a weight and a fix for every rule, and lists them once', () => {
    expect(new Set(RULE_KEYS).size).toBe(RULE_KEYS.length);
    for (const key of RULE_KEYS) {
      expect(RULES[key].weight, key).toBeGreaterThan(0);
      expect(['cleanup', 'merge', null]).toContain(RULES[key].fix);
    }
  });
});

describe('contactIssues', () => {
  it('finds nothing wrong with a complete contact', () => {
    expect(contactIssues(CLEAN)).toEqual([]);
    expect(healthScore([])).toBe(100);
  });

  it('reports what is missing, and what it costs', () => {
    const issues = contactIssues(makeCard({ id: 'a', emails: ['ada@example.org'] }));

    expect(issues.map((issue) => issue.key)).toEqual(['name.missing', 'phone.missing']);
    expect(healthScore(issues)).toBe(100 - 25 - 10);
  });

  it('flags a broken address, and the throwaway and function ones', () => {
    expect(keys(makeCard({ id: 'a', name: 'Ada', emails: ['nope'] }))).toContain('email.invalid');
    expect(keys(makeCard({ id: 'a', name: 'Ada', emails: ['x@mailinator.com'] }))).toContain('email.disposable');
    expect(keys(makeCard({ id: 'a', name: 'Ada', emails: ['info@example.org'] }))).toContain('email.role');
  });

  it('flags an address that only needs tidying, and not one that is also broken', () => {
    const untidy = contactIssues(makeCard({ id: 'a', name: 'Ada', emails: ['  Ada@Example.ORG '], phones: ['+491761234567'] }));
    expect(untidy.map((issue) => issue.key)).toEqual(['email.untidy']);
    expect(untidy[0].value).toBe('  Ada@Example.ORG ');

    // 'nope' is broken, so it is reported as broken rather than merely untidy
    expect(keys(makeCard({ id: 'a', name: 'Ada', emails: ['nope'] }))).not.toContain('email.untidy');
  });

  it('flags a phone it cannot use, and one it could normalise', () => {
    expect(keys(makeCard({ id: 'a', name: 'Ada', phones: ['12'] }))).toContain('phone.unusable');
    expect(keys(makeCard({ id: 'a', name: 'Ada', phones: ['0176 1234567'] }), { region: 'DE' }))
      .toContain('phone.notE164');
    // without a country it cannot be normalised, so it is not the contact's fault
    expect(keys(makeCard({ id: 'a', name: 'Ada', phones: ['0176 1234567'] }), { region: '' }))
      .not.toContain('phone.notE164');
    expect(keys(makeCard({ id: 'a', name: 'Ada', phones: ['+491761234567'] }), { region: 'DE' }))
      .not.toContain('phone.notE164');
  });

  it('counts a duplicate only when it was told to', () => {
    expect(keys(CLEAN, { duplicate: true })).toContain('duplicate');
    expect(keys(CLEAN, { duplicate: false })).not.toContain('duplicate');
    // a distribution list is never merged, so it is never a duplicate
    expect(keys({ ...CLEAN, kind: 'group' }, { duplicate: true })).not.toContain('duplicate');
  });

  it('counts a contact as stale only past the threshold', () => {
    const now = Date.UTC(2026, 0, 1);
    const months = (n) => new Date(now - n * 30 * 24 * 3600 * 1000).toISOString();

    expect(keys({ ...CLEAN, updated: months(STALE_MONTHS - 1) }, { now })).not.toContain('stale');
    expect(keys({ ...CLEAN, updated: months(STALE_MONTHS + 1) }, { now })).toContain('stale');
    // a contact the host never stamped, and a nonsense date, are not stale
    expect(keys(CLEAN, { now })).not.toContain('stale');
    expect(keys({ ...CLEAN, updated: 'not a date' }, { now })).not.toContain('stale');
  });

  it('survives junk', () => {
    expect(contactIssues(null)).toEqual([]);
    expect(contactIssues('nonsense')).toEqual([]);
  });
});
describe('healthScore and the bands', () => {
  it('subtracts every deduction and never goes below zero', () => {
    expect(healthScore([{ weight: 30 }, { weight: 20 }])).toBe(50);
    expect(healthScore([{ weight: 90 }, { weight: 90 }])).toBe(0);
    expect(healthScore(null)).toBe(100);
  });

  it('uses the documented cutoffs', () => {
    expect(BANDS).toEqual({ good: 80, fair: 50 });
    expect(healthBand(100)).toBe('good');
    expect(healthBand(80)).toBe('good');
    expect(healthBand(79)).toBe('fair');
    expect(healthBand(50)).toBe('fair');
    expect(healthBand(49)).toBe('poor');
    expect(healthBand(0)).toBe('poor');
  });
});

describe('contactHealth', () => {
  it('carries the name, the score, the band and every issue', () => {
    const entry = contactHealth(makeCard({ id: 'a', name: 'Ada', phones: ['12'] }));

    expect(entry).toMatchObject({ id: 'a', name: 'Ada', band: 'fair' });
    expect(entry.score).toBe(100 - 15 - 15);
    expect(entry.issues.map((issue) => issue.key)).toEqual(['email.missing', 'phone.unusable']);
  });
});

describe('healthSummary', () => {
  const BOOKS = new Map([['b1', 'Personal'], ['b2', 'Work']]);
  // explicit scores, so the arithmetic in the assertions is checkable by eye
  const EMPTY = { id: 'empty', addressBookIds: { b2: true } };            // 25 + 15 + 10 -> 50
  const THROWAWAY = makeCard({
    id: 'mid', name: 'Half', emails: ['x@mailinator.com'], phones: ['+491761234567'],
    addressBookIds: { b1: true, b2: true },
  });                                                                     // 10 -> 90
  const cards = [CLEAN, EMPTY, THROWAWAY];                                // 100

  it('totals the contacts, the average and each rule', () => {
    const summary = healthSummary(cards, { books: BOOKS });

    expect(summary.total).toBe(3);
    expect(summary.average).toBe(Math.round((100 + 50 + 90) / 3));
    expect(summary.band).toBe(healthBand(summary.average));
    expect(summary.byRule['name.missing']).toBe(1);
    expect(summary.byRule['email.missing']).toBe(1);
    expect(summary.byRule['phone.missing']).toBe(1);
    expect(summary.byRule['email.disposable']).toBe(1);
    expect(summary.byRule['stale']).toBe(0);
  });

  it('breaks the books down by name, worst first, counting a shared contact twice', () => {
    const summary = healthSummary(cards, { books: BOOKS });

    expect(summary.byBook.map((book) => book.name)).toEqual(['Work', 'Personal']);
    // Work holds the empty contact and the throwaway; Personal the clean and the throwaway
    expect(summary.byBook.find((book) => book.id === 'b2'))
      .toMatchObject({ count: 2, average: Math.round((50 + 90) / 2) });
    expect(summary.byBook.find((book) => book.id === 'b1'))
      .toMatchObject({ count: 2, average: Math.round((100 + 90) / 2) });
  });

  it('falls back to the id for a book it has no name for', () => {
    const summary = healthSummary([makeCard({ id: 'a', name: 'A', emails: ['a@b.de'] })], { books: new Map() });

    expect(summary.byBook[0].name).toBe('b1');
  });

  it('calls an empty address book healthy rather than dividing by zero', () => {
    const summary = healthSummary([], { books: BOOKS });

    expect(summary).toMatchObject({ total: 0, average: 100, band: 'good' });
    expect(summary.byBook).toEqual([]);
    expect(summary.byRule.stale).toBe(0);
  });

  it('survives a non-list and cards without an id', () => {
    expect(healthSummary(null).total).toBe(0);
    expect(healthSummary([{ name: 'no id' }]).total).toBe(0);
  });
});

describe('drilling down', () => {
  const summary = healthSummary([
    CLEAN,
    { id: 'empty' },
    makeCard({ id: 'untidy', name: 'Untidy', emails: ['  Ada@Example.ORG '], phones: ['+491761234567'] }),
  ], { books: new Map() });

  it('lists the contacts with one issue', () => {
    expect(withIssue(summary, 'name.missing').map((entry) => entry.id)).toEqual(['empty']);
    expect(withIssue(summary, 'email.missing').map((entry) => entry.id)).toEqual(['empty']);
    expect(withIssue(summary, 'nothing.like.this')).toEqual([]);
  });

  it('lists the contacts the plugin can fix itself', () => {
    expect(fixableContacts(summary, 'cleanup').map((entry) => entry.id)).toEqual(['untidy']);
    expect(fixableContacts(summary, 'merge')).toEqual([]);
  });
});

describe('duplicates as a set', () => {
  it('marks the contacts the set names, and no others', () => {
    const cards = [CLEAN, makeCard({ id: 'other', name: 'Other', emails: ['o@example.org'], phones: ['+4917612345678'] })];
    const summary = healthSummary(cards, { duplicates: new Set(['good']) });

    expect(summary.byRule.duplicate).toBe(1);
    expect(summary.contacts.find((entry) => entry.id === 'good').issues.map((i) => i.key)).toContain('duplicate');
    expect(summary.contacts.find((entry) => entry.id === 'other').issues).toEqual([]);
  });

  it('takes a plain array too', () => {
    expect(contactIssues(CLEAN, { duplicates: ['good'] }).map((i) => i.key)).toEqual(['duplicate']);
  });
});
