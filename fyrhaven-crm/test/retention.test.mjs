// Retention: the age thresholds, the buckets, and the rule that a delete always
// writes the file first.
import { describe, expect, it } from 'vitest';
import { STALE_BANDS, STALE_MONTHS, staleContacts, staleCounts, staleness } from '../src/lib/health.js';
import { makeCard } from './fixtures.mjs';

const NOW = Date.UTC(2026, 0, 1);
const monthsAgo = (n) => new Date(NOW - n * 30 * 24 * 3600 * 1000).toISOString();
const card = (id, months) => makeCard({ id, name: `Person ${id}`, updated: months === null ? undefined : monthsAgo(months) });

describe('the thresholds', () => {
  it('are a year, two years and three years, oldest last', () => {
    expect(STALE_BANDS.map((band) => band.months)).toEqual([12, 24, 36]);
    expect(STALE_MONTHS).toBe(24);
  });
});

describe('staleness', () => {
  it('puts a contact in the first bucket it has passed', () => {
    expect(staleness(card('a', 11), NOW).band).toBe('fresh');
    expect(staleness(card('b', 12), NOW).band).toBe('year');
    expect(staleness(card('c', 23), NOW).band).toBe('year');
    expect(staleness(card('d', 24), NOW).band).toBe('twoYears');
    expect(staleness(card('e', 35), NOW).band).toBe('twoYears');
    expect(staleness(card('f', 36), NOW).band).toBe('threeYears');
    expect(staleness(card('g', 400), NOW).band).toBe('threeYears');
  });

  it('reports the age in months', () => {
    expect(Math.round(staleness(card('a', 30), NOW).months)).toBe(30);
  });

  it('says nothing when the host gave no date, or a nonsense one', () => {
    // guessing here would report a contact as untouched on no evidence
    expect(staleness(card('a', null), NOW)).toBeNull();
    expect(staleness({ id: 'b', updated: 'not a date' }, NOW)).toBeNull();
    expect(staleness(null, NOW)).toBeNull();
  });
});

describe('staleContacts', () => {
  it('lists the ones past the threshold, oldest first', () => {
    const cards = [card('fresh', 2), card('old', 50), card('middle', 30), card('nodate', null)];

    expect(staleContacts(cards, { now: NOW }).map((entry) => entry.card.id)).toEqual(['old', 'middle']);
    expect(staleContacts(cards, { now: NOW })[0].staleness.months).toBeGreaterThan(49);
  });

  it('takes a different threshold when asked', () => {
    const cards = [card('a', 14), card('b', 30)];

    expect(staleContacts(cards, { now: NOW, months: 12 }).map((entry) => entry.card.id)).toEqual(['b', 'a']);
    expect(staleContacts(cards, { now: NOW, months: 60 })).toEqual([]);
  });

  it('has nothing to say about no data', () => {
    expect(staleContacts([], { now: NOW })).toEqual([]);
    expect(staleContacts(null, { now: NOW })).toEqual([]);
    expect(staleContacts([card('a', null)], { now: NOW })).toEqual([]);
  });
});

describe('staleCounts', () => {
  it('counts each bucket, and a contact in the oldest is not in the newer ones', () => {
    const cards = [card('a', 13), card('b', 30), card('c', 40), card('d', 40), card('e', 2), card('f', null)];

    expect(staleCounts(cards, { now: NOW })).toEqual({ year: 1, twoYears: 1, threeYears: 2 });
  });

  it('counts nothing for no data', () => {
    expect(staleCounts([], { now: NOW })).toEqual({ year: 0, twoYears: 0, threeYears: 0 });
    expect(staleCounts(null, { now: NOW })).toEqual({ year: 0, twoYears: 0, threeYears: 0 });
  });
});
