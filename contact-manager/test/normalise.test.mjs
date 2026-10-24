// Normalising a selection: what it plans, what it writes, and that it is
// reversible exactly.
import { describe, expect, it } from 'vitest';
import { fakeApi } from '../test-utils/fake-api.mjs';
import {
  applyNormalisation, planCard, planCounts, planNormalisation, readCleanup, readRegion, undoCleanup, writeRegion,
} from '../src/lib/normalise.js';
import { makeCard } from './fixtures.mjs';

const api = (handlers = {}) => fakeApi({ handlers });
const updates = (subject) => subject.calls('contacts.update').map((call) => call.args);

describe('the region', () => {
  it('is read, upper-cased, and cleared by an empty value', async () => {
    const subject = api();

    expect(await readRegion(subject)).toBe('');
    await writeRegion(subject, 'de');
    expect(await readRegion(subject)).toBe('DE');
    await writeRegion(subject, '');
    expect(await readRegion(subject)).toBe('');
    expect(subject.storageSnapshot().normalizeRegion).toBeUndefined();
  });
});

describe('planCard', () => {
  it('plans a national number to E.164 once the region is known', () => {
    const card = makeCard({ id: 'a', phones: ['0176 1234567'] });

    const item = planCard(card, { region: 'DE' });

    expect(item.changes).toEqual([{ field: 'phones', from: '0176 1234567', to: '+491761234567' }]);
    expect(item.patch.phones.p0).toEqual({ number: '+491761234567' });
  });

  it('leaves a number it cannot normalise confidently alone', () => {
    const card = makeCard({ id: 'a', phones: ['0176 1234567'] });

    expect(planCard(card, { region: '' })).toBeNull();
    expect(planCard(card, { region: 'DE' })).not.toBeNull();
  });

  it('notices a number that differs only by surrounding spaces', () => {
    const card = makeCard({ id: 'a', phones: ['  +491761234567 '] });

    const item = planCard(card, { region: 'DE' });

    // comparing against a trimmed copy would miss exactly this, which is the
    // whole point of normalising
    expect(item.changes).toEqual([{ field: 'phones', from: '  +491761234567 ', to: '+491761234567' }]);
  });

  it('trims and lower-cases an email address', () => {
    const card = makeCard({ id: 'a', emails: ['  Ada@Example.ORG '] });

    const item = planCard(card, {});

    // `from` is what is stored, spaces and all, so the preview is honest
    expect(item.changes).toEqual([{ field: 'emails', from: '  Ada@Example.ORG ', to: 'ada@example.org' }]);
    expect(item.patch.emails.e0).toEqual({ address: 'ada@example.org' });
  });

  it('sends the complete map, so other entries survive', () => {
    const card = {
      id: 'a',
      phones: { p0: { number: '0176 1234567' }, p1: { number: '+49 30 12345678', pref: 1 } },
      emails: { e0: { address: '  Ada@Example.ORG ' }, e1: { address: 'grace@example.org' } },
    };

    const item = planCard(card, { region: 'DE' });

    expect(Object.keys(item.patch.phones)).toEqual(['p0', 'p1']);
    expect(Object.keys(item.patch.emails)).toEqual(['e0', 'e1']);
    // already international, but spaced: canonicalising it is the point
    expect(item.patch.phones.p1).toEqual({ number: '+493012345678', pref: 1 });
  });

  it('keeps what it replaces, so the change can be put back', () => {
    const card = makeCard({ id: 'a', phones: ['0176 1234567'], emails: ['  A@B.de '] });

    const item = planCard(card, { region: 'DE' });

    expect(item.before.phones).toEqual(card.phones);
    expect(item.before.emails).toEqual(card.emails);
  });

  it('plans nothing for a card that is already clean, and for junk', () => {
    expect(planCard(makeCard({ id: 'a', phones: ['+491761234567'], emails: ['ada@example.org'] }), { region: 'DE' })).toBeNull();
    expect(planCard({ id: 'a' }, { region: 'DE' })).toBeNull();
    expect(planCard(null, { region: 'DE' })).toBeNull();
  });
});

describe('applyNormalisation', () => {
  it('writes one update per contact and keeps a reversible record', async () => {
    const subject = api({ 'contacts.update': async () => {} });
    const plan = planNormalisation([makeCard({ id: 'a', phones: ['0176 1234567'] })], { region: 'DE' });

    const result = await applyNormalisation(subject, plan);

    expect(result).toEqual({ updated: 1, failed: 0, undoable: 1 });
    expect(updates(subject)[0][0]).toBe('a');
    expect(updates(subject)[0][1].phones.p0).toEqual({ number: '+491761234567' });
    expect((await readCleanup(subject)).entries).toHaveLength(1);
  });

  it('counts a contact the host refuses and keeps it out of the record', async () => {
    const subject = api({
      'contacts.update': async (id) => { if (id === 'b') throw new Error('missing contacts:write'); },
    });
    const plan = planNormalisation([
      makeCard({ id: 'a', phones: ['0176 1234567'] }),
      makeCard({ id: 'b', phones: ['0176 7654321'] }),
    ], { region: 'DE' });

    const result = await applyNormalisation(subject, plan);

    expect(result).toEqual({ updated: 1, failed: 1, undoable: 1 });
    // a change that was never made must not be in the record
    expect((await readCleanup(subject)).entries.map((entry) => entry.id)).toEqual(['a']);
  });

  it('keeps no record when undo is switched off', async () => {
    const subject = fakeApi({
      settings: { undoMinutes: 0 },
      handlers: { 'contacts.update': async () => {} },
    });
    const plan = planNormalisation([makeCard({ id: 'a', phones: ['0176 1234567'] })], { region: 'DE' });

    expect((await applyNormalisation(subject, plan)).undoable).toBe(0);
    expect(await readCleanup(subject)).toBeNull();
  });
});

describe('undoCleanup', () => {
  it('puts every contact back exactly as it was', async () => {
    const subject = api({ 'contacts.update': async () => {} });
    const original = makeCard({ id: 'a', phones: ['0176 1234567'], emails: ['  Ada@Example.ORG '] });

    await applyNormalisation(subject, planNormalisation([original], { region: 'DE' }));

    const result = await undoCleanup(subject);

    expect(result).toEqual({ restored: 1, failed: 0 });
    // the last call is the undo, and it must carry the values that were there before
    expect(updates(subject).at(-1)).toEqual(['a', { phones: original.phones, emails: original.emails }]);
    expect(await readCleanup(subject)).toBeNull();
  });

  it('keeps the entries that failed, so the undo can be retried', async () => {
    let refuse = null;
    const subject = api({
      'contacts.update': async (id) => { if (refuse === id) throw new Error('nope'); },
    });
    const plan = planNormalisation([
      makeCard({ id: 'a', phones: ['0176 1234567'] }),
      makeCard({ id: 'b', phones: ['0176 7654321'] }),
    ], { region: 'DE' });
    await applyNormalisation(subject, plan);

    refuse = 'b';
    const result = await undoCleanup(subject);

    expect(result).toEqual({ restored: 1, failed: 1 });
    expect((await readCleanup(subject)).entries.map((entry) => entry.id)).toEqual(['b']);
  });

  it('does nothing when there is no record', async () => {
    expect(await undoCleanup(api())).toEqual({ restored: 0, failed: 0 });
  });

  it('drops an expired record', async () => {
    const subject = api();
    await subject.storage.set('lastCleanup', { at: 1, expiresAt: 2, entries: [{ id: 'a', before: {} }] });

    expect(await readCleanup(subject)).toBeNull();
    expect(subject.storageSnapshot().lastCleanup).toBeUndefined();
  });
});

describe('planNormalisation', () => {
  it('keeps only the cards that would change, in order', () => {
    const cards = [
      makeCard({ id: 'a', phones: ['0176 1234567'] }),
      makeCard({ id: 'b', phones: ['+491761234567'] }),
      makeCard({ id: 'c', emails: ['  x@y.de '] }),
    ];

    const plan = planNormalisation(cards, { region: 'DE' });

    expect(plan.map((item) => item.id)).toEqual(['a', 'c']);
    expect(planCounts(plan)).toEqual({ contacts: 2, phones: 1, emails: 1 });
  });

  it('survives a non-list', () => {
    expect(planNormalisation(null, { region: 'DE' })).toEqual([]);
    expect(planCounts(null)).toEqual({ contacts: 0, phones: 0, emails: 0 });
  });
});
