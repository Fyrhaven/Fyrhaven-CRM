// Saved searches: the storage side, and the repairs it does on the way in.
import { describe, expect, it } from 'vitest';
import { fakeApi } from '../test-utils/fake-api.mjs';
import {
  MAX_SAVED, deleteSaved, normalizeSaved, readSaved, saveSearch,
} from '../src/lib/saved-searches.js';

const api = () => fakeApi({});

describe('normalizeSaved', () => {
  it('keeps named, non-empty queries and drops the rest', () => {
    expect(normalizeSaved([
      { name: 'VIP', query: 'tag:vip' },
      { name: '', query: 'x' },
      { name: 'n', query: '  ' },
      null,
      { name: 'No phone', query: 'has:phone' },
    ])).toEqual([{ name: 'VIP', query: 'tag:vip' }, { name: 'No phone', query: 'has:phone' }]);
  });

  it('de-duplicates by name, case-insensitively, and the first wins', () => {
    expect(normalizeSaved([
      { name: 'vip', query: 'tag:vip' },
      { name: 'VIP', query: 'tag:other' },
    ])).toEqual([{ name: 'vip', query: 'tag:vip' }]);
  });

  it('caps how many are kept', () => {
    const many = Array.from({ length: MAX_SAVED + 5 }, (_, i) => ({ name: `s${i}`, query: `q${i}` }));

    expect(normalizeSaved(many)).toHaveLength(MAX_SAVED);
    expect(normalizeSaved('not a list')).toEqual([]);
  });
});

describe('saved searches in storage', () => {
  it('saves a search and reads it back', async () => {
    const subject = api();

    await saveSearch(subject, 'VIP', 'tag:vip');

    expect(await readSaved(subject)).toEqual([{ name: 'VIP', query: 'tag:vip' }]);
  });

  it('replaces a search saved under the same name', async () => {
    const subject = api();

    await saveSearch(subject, 'VIP', 'tag:vip');
    await saveSearch(subject, 'VIP', 'tag:customer');

    expect(await readSaved(subject)).toEqual([{ name: 'VIP', query: 'tag:customer' }]);
  });

  it('refuses a search with no name or no query', async () => {
    const subject = api();

    await saveSearch(subject, '   ', 'tag:vip');
    await saveSearch(subject, 'VIP', '   ');

    expect(await readSaved(subject)).toEqual([]);
  });

  it('drops one by name, case-insensitively, and clears storage with the last', async () => {
    const subject = api();
    await saveSearch(subject, 'VIP', 'tag:vip');
    await saveSearch(subject, 'No phone', 'has:phone');

    expect(await deleteSaved(subject, 'vip')).toEqual([{ name: 'No phone', query: 'has:phone' }]);

    await deleteSaved(subject, 'No phone');
    expect(subject.storageSnapshot().savedSearches).toBeUndefined();
  });

  it('repairs junk left in storage', async () => {
    const subject = api();
    await subject.storage.set('savedSearches', [{ name: 'VIP', query: 'tag:vip' }, { junk: true }]);

    expect(await readSaved(subject)).toEqual([{ name: 'VIP', query: 'tag:vip' }]);
    expect(subject.storageSnapshot().savedSearches).toEqual([{ name: 'VIP', query: 'tag:vip' }]);
  });

  it('keeps the newest when it is full', async () => {
    const subject = api();
    for (let i = 0; i < MAX_SAVED + 3; i += 1) await saveSearch(subject, `s${i}`, `q${i}`);

    const saved = await readSaved(subject);
    expect(saved).toHaveLength(MAX_SAVED);
    expect(saved.at(-1).name).toBe(`s${MAX_SAVED + 2}`);
    expect(saved[0].name).toBe('s3');
  });
});
