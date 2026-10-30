// The change history: the store, and that every write path records into it.
import { describe, expect, it } from 'vitest';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { applyImport, rowsToDrafts } from '../src/lib/import.js';
import { applyBulkEdit, deleteContacts } from '../src/lib/bulk.js';
import {
  HISTORY_KEY, MAX_HISTORY, clearHistory, historyCounts, normalizeEntry, normalizeHistory,
  readHistory, recordHistory,
} from '../src/lib/history.js';
import { applyNormalisation } from '../src/lib/normalise.js';
import { saveUndo } from '../src/lib/undo.js';
import { makeCard } from './fixtures.mjs';

const entry = (overrides = {}) => ({ at: 1000, kind: 'merge', contacts: 2, detail: '', undoable: false, ...overrides });

describe('the history store', () => {
  it('repairs an entry, and drops one that says nothing', () => {
    expect(normalizeEntry(entry())).toEqual(entry());
    expect(normalizeEntry({ at: 1, kind: 'nonsense', contacts: 1 })).toBeNull();
    expect(normalizeEntry({ at: 1, kind: 'merge', contacts: 0 })).toBeNull();
    expect(normalizeEntry({ at: 1, kind: 'merge' })).toBeNull();
    expect(normalizeEntry(null)).toBeNull();
    expect(normalizeEntry('nope')).toBeNull();
  });

  it('keeps the newest first and caps the list', () => {
    const many = Array.from({ length: MAX_HISTORY + 5 }, (_, i) => entry({ at: i + 1 }));
    const kept = normalizeHistory(many);
    expect(kept).toHaveLength(MAX_HISTORY);
    expect(kept[0].at).toBe(MAX_HISTORY + 5);
  });

  it('records at the front and repairs what storage held', async () => {
    const api = fakeApi();
    await api.storage.set(HISTORY_KEY, [entry({ at: 5 }), { junk: true }]);
    await recordHistory(api, { kind: 'import', contacts: 3 }, 900);
    const stored = await readHistory(api);
    expect(stored.map((item) => item.kind)).toEqual(['import', 'merge']);
    // the junk was dropped, so storage was rewritten
    expect(await api.storage.get(HISTORY_KEY)).toEqual(stored);
  });

  it('never lets a failed write of the note reach the caller', async () => {
    const api = fakeApi();
    api.storage.set = async () => { throw new Error('quota'); };
    await expect(recordHistory(api, { kind: 'merge', contacts: 1 })).resolves.toBeNull();
  });

  it('clears the history, and counts what it holds', async () => {
    const api = fakeApi();
    await recordHistory(api, { kind: 'merge', contacts: 2 });
    await recordHistory(api, { kind: 'import', contacts: 3 });
    expect(historyCounts(await readHistory(api)))
      .toEqual({ entries: 2, contacts: 5, byKind: { merge: 1, import: 1 } });
    await clearHistory(api);
    expect(await readHistory(api)).toEqual([]);
    expect(await api.storage.get(HISTORY_KEY)).toBeNull();
  });

  it('survives junk in storage', async () => {
    const api = fakeApi();
    await api.storage.set(HISTORY_KEY, 'not a list');
    expect(await readHistory(api)).toEqual([]);
  });
});

describe('the write paths record themselves', () => {
  const kinds = async (api) => (await readHistory(api)).map((item) => item.kind);

  it('records a merge from the undo record it leaves', async () => {
    const api = fakeApi();
    await saveUndo(api, [{ keptId: 'a', before: {}, absent: [], removed: [{ id: 'b' }] }]);
    expect(await readHistory(api)).toEqual([
      expect.objectContaining({ kind: 'merge', contacts: 1, undoable: true }),
    ]);
  });

  it('records a delete batch as a delete, not a merge', async () => {
    const api = fakeApi({ handlers: { 'contacts.remove': async () => {} } });
    await deleteContacts(api, [makeCard({ id: 'a', name: 'Ada' })]);
    expect(await kinds(api)).toEqual(['delete']);
  });

  it('records a cleanup, and a rules batch as rules', async () => {
    const api = fakeApi({ handlers: { 'contacts.update': async () => {} } });
    const plan = [{ id: 'a', name: 'Ada', patch: { emails: {} }, before: { emails: {} }, changes: [] }];
    await applyNormalisation(api, plan);
    await applyNormalisation(api, plan, { kind: 'rules' });
    expect(await kinds(api)).toEqual(['rules', 'cleanup']);
  });

  it('records an import with the number created', async () => {
    const api = fakeApi({ handlers: { 'contacts.create': async () => ({ id: 'x' }) } });
    const drafts = rowsToDrafts([['Ada', 'Lovelace'], ['Grace', 'Hopper']], ['given', 'surname'], { bookIds: ['b1'] });
    await applyImport(api, drafts);
    expect(await readHistory(api)).toEqual([
      expect.objectContaining({ kind: 'import', contacts: 2 }),
    ]);
  });

  it('records a bulk edit with the number updated', async () => {
    const api = fakeApi({ handlers: { 'contacts.update': async () => {} } });
    await applyBulkEdit(api, [makeCard({ id: 'a', name: 'Ada' })], { tags: { add: ['vip'] } });
    expect(await readHistory(api)).toEqual([
      expect.objectContaining({ kind: 'bulk', contacts: 1 }),
    ]);
  });

  it('records nothing when a write changed nothing', async () => {
    const api = fakeApi();
    await applyNormalisation(api, []);
    await applyBulkEdit(api, [], { tags: { add: ['vip'] } });
    expect(await readHistory(api)).toEqual([]);
  });
});
