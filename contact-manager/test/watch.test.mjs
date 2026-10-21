// The save-time duplicate warning: detection around a just-saved contact and
// the non-blocking toast, for both the create and the edit path.
import { describe, expect, it } from 'vitest';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { makeCard } from './fixtures.mjs';
import { findDuplicatesOf, isSameCard, warnAboutDuplicates } from '../src/lib/watch.js';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));

const existing = makeCard({ id: 'a', name: 'Ada Lovelace', emails: ['ada@example.org'], phones: ['+4917612345678'] });

/** api.contacts.search returns whatever shares the query with `existing`. */
const searching = (settings = {}) => fakeApi({
  translations: manifest.locales,
  settings,
  handlers: {
    'contacts.search': async (query) => (String(query).includes('ada') || String(query).includes('Ada') ? [existing] : []),
  },
});

describe('isSameCard', () => {
  it('matches by id, and by content when the host added no id yet', () => {
    expect(isSameCard(existing, { ...existing, emails: {} })).toBe(true);
    const draft = { name: { full: 'Ada Lovelace' }, emails: { e: { address: 'ada@example.org' } } };
    expect(isSameCard(draft, { ...draft })).toBe(true);
    expect(isSameCard(draft, { ...draft, created: '2024-01-01T00:00:00Z', id: 'x' })).toBe(true);
    expect(isSameCard(draft, existing)).toBe(false);
  });
});

describe('findDuplicatesOf', () => {
  it('finds the existing contact that shares an email with the saved card', async () => {
    const api = searching();
    const saved = makeCard({ id: 'b', name: 'A. Lovelace', emails: ['ada@example.org'] });
    const found = await findDuplicatesOf(api, saved);
    expect(found.others.map((card) => card.id)).toEqual(['a']);
    expect(found.group.reasons.map((reason) => reason.type)).toContain('email');
  });

  it('ignores the saved contact itself when the search returns it', async () => {
    const api = searching();
    const found = await findDuplicatesOf(api, existing);
    expect(found).toBeNull();
  });

  it('returns null when nothing matches', async () => {
    const api = searching();
    const saved = makeCard({ id: 'z', name: 'Zoe', emails: ['zoe@example.org'] });
    expect(await findDuplicatesOf(api, saved)).toBeNull();
  });
});

describe('warnAboutDuplicates', () => {
  it('warns after a create with the name and the reason', async () => {
    const api = searching();
    const saved = makeCard({ id: 'b', name: 'A. Lovelace', emails: ['ada@example.org'] });
    const matches = await warnAboutDuplicates(api, saved);
    expect(matches.map((card) => card.id)).toEqual(['a']);
    expect(api.calls('toast.warning')).toHaveLength(1);
    expect(api.calls('toast.warning')[0].args[0]).toBe(
      'This looks like an existing contact: Ada Lovelace (Same email address: ada@example.org). '
      + 'Open the contact or the Contact Manager page to review and merge.',
    );
  });

  it('warns after an edit too', async () => {
    const api = searching();
    const edited = makeCard({ id: 'b', name: 'Ada Lovelace', phones: ['+4917612345678'] });
    await warnAboutDuplicates(api, edited);
    expect(api.calls('toast.warning').at(-1).args[0]).toContain('Ada Lovelace');
  });

  it('stays silent when the setting is off', async () => {
    const api = searching({ warnOnSave: false });
    const saved = makeCard({ id: 'b', name: 'A. Lovelace', emails: ['ada@example.org'] });
    expect(await warnAboutDuplicates(api, saved)).toEqual([]);
    expect(api.calls('toast.warning')).toHaveLength(0);
  });

  it('stays silent when the check fails', async () => {
    const api = fakeApi({
      translations: manifest.locales,
      handlers: { 'contacts.search': async () => { throw new Error('offline'); } },
    });
    const saved = makeCard({ id: 'b', name: 'A. Lovelace', emails: ['ada@example.org'] });
    expect(await warnAboutDuplicates(api, saved)).toEqual([]);
    expect(api.calls('toast.warning')).toHaveLength(0);
  });

  it('respects the match settings', async () => {
    const api = searching({ matchByEmail: false, matchByPhone: false, matchByName: false });
    const saved = makeCard({ id: 'b', name: 'Ada Lovelace', emails: ['ada@example.org'] });
    expect(await warnAboutDuplicates(api, saved)).toEqual([]);
  });
});
