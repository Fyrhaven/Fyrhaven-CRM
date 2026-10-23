// Bulk delete: what it removes, what it refuses, and that it stays undoable.
import { describe, expect, it } from 'vitest';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { deleteContacts } from '../src/lib/bulk.js';
import { readUndo, undoLastMerge } from '../src/lib/undo.js';
import { makeCard } from './fixtures.mjs';

const api = (handlers = {}) => fakeApi({ handlers });

describe('deleteContacts', () => {
  it('removes every contact and keeps one undo batch of what went', async () => {
    const subject = api({ 'contacts.remove': async () => {} });

    const result = await deleteContacts(subject, [
      makeCard({ id: 'a', name: 'Ada Lovelace' }),
      makeCard({ id: 'b', name: 'Grace Hopper' }),
    ]);

    expect(result).toEqual({ deleted: 2, failed: 0 });
    expect(subject.calls('contacts.remove').map((call) => call.args[0])).toEqual(['a', 'b']);
    const batches = await readUndo(subject);
    expect(batches.at(-1).entries[0].removed.map((card) => card.id)).toEqual(['a', 'b']);
  });

  it('restores every contact when the bulk delete is undone', async () => {
    const subject = api({ 'contacts.remove': async () => {}, 'contacts.create': async () => {} });

    await deleteContacts(subject, [makeCard({ id: 'a', name: 'Ada Lovelace' })]);
    const result = await undoLastMerge(subject);

    expect(result.restored).toBe(1);
    expect(result.failed).toBe(0);
    expect(subject.calls('contacts.create')).toHaveLength(1);
    // Nothing was kept, so no contact is reported as reverted.
    expect(result.reverted).toBe(0);
  });

  it('counts a contact the host refuses to delete, and still undoes the rest', async () => {
    const subject = api({
      'contacts.remove': async (id) => { if (id === 'b') throw new Error('missing contacts:write'); },
    });

    const result = await deleteContacts(subject, [makeCard({ id: 'a' }), makeCard({ id: 'b' })]);

    expect(result).toEqual({ deleted: 1, failed: 1 });
    const batches = await readUndo(subject);
    expect(batches.at(-1).entries[0].removed.map((card) => card.id)).toEqual(['a']);
  });

  it('keeps no undo record when nothing could be deleted', async () => {
    const subject = api({ 'contacts.remove': async () => { throw new Error('nope'); } });

    expect(await deleteContacts(subject, [makeCard({ id: 'a' })])).toEqual({ deleted: 0, failed: 1 });
    expect(await readUndo(subject)).toEqual([]);
  });
});
