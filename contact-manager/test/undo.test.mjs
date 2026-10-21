// The undo record: what a merge keeps so it can be rolled back, the retention
// window, the size limits, and the restore itself (also partially failing).
import { describe, expect, it } from 'vitest';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { findDuplicateGroups, mergeGroups, planMerge } from '../src/lib/duplicates.js';
import {
  MAX_CARDS, UNDO_KEY, buildEntry, clearUndo, enforceLimits, readUndo, saveUndo,
  undoLastMerge, undoWindowMs,
} from '../src/lib/undo.js';
import { makeCard } from './fixtures.mjs';

const groupOf = (members) => findDuplicateGroups(members, {})[0];

const fixture = () => [
  makeCard({ id: 'a', name: 'A', emails: ['a@x.de'], notes: { n: { note: 'Friend' } } }),
  makeCard({ id: 'b', name: 'A', emails: ['a@x.de'], phones: ['+4917612345678'] }),
];

/** A merge run with its journal, the way the review dialog does it. */
async function mergeWithJournal(api) {
  const journal = [];
  const groups = [groupOf(fixture())];
  const result = await mergeGroups(api, groups, {}, {}, journal);
  return { result, entries: journal.map((item) => buildEntry(item.plan, item.removedCards)) };
}

describe('undoWindowMs', () => {
  it('reads undoMinutes, clamps it and defaults to 15 minutes', () => {
    expect(undoWindowMs({ undoMinutes: 5 })).toBe(5 * 60_000);
    expect(undoWindowMs({})).toBe(15 * 60_000);
    expect(undoWindowMs({ undoMinutes: -3 })).toBe(0);
    expect(undoWindowMs({ undoMinutes: 99_999 })).toBe(1440 * 60_000);
  });
});

describe('buildEntry', () => {
  it('keeps the original field values and lists the fields the kept contact lacked', () => {
    const group = groupOf(fixture());
    const plan = planMerge(group);
    const entry = buildEntry(plan, [group.members.find((m) => m.id === 'b')]);
    expect(entry.keptId).toBe('a');
    // only the patched field is on record — here the phone the merge added
    expect(entry.before).toEqual({});
    expect(entry.absent).toEqual(['phones']); // patched, was missing → undo clears it
    expect(entry.removed.map((card) => card.id)).toEqual(['b']);
  });
});

describe('saveUndo / readUndo', () => {
  const entry = { keptId: 'a', before: {}, absent: [], removed: [makeCard({ id: 'b', name: 'B' })] };

  it('stores a batch with its expiry and returns it while it lives', async () => {
    const api = fakeApi();
    expect(await saveUndo(api, [entry], 1_000)).toBe(1);
    const [batch] = await readUndo(api, 1_001);
    expect(batch.at).toBe(1_000);
    expect(batch.expiresAt).toBe(1_000 + 15 * 60_000);
  });

  it('purges expired batches and keeps nothing when undo is off', async () => {
    const api = fakeApi();
    await saveUndo(api, [entry], 0);
    expect(await readUndo(api, 14 * 60_000)).toHaveLength(1);
    expect(await readUndo(api, 16 * 60_000)).toHaveLength(0);
    expect(await api.storage.get(UNDO_KEY)).toBeNull();

    const off = fakeApi({ settings: { undoMinutes: 0 } });
    expect(await saveUndo(off, [entry])).toBe(0);
    expect(await off.storage.get(UNDO_KEY)).toBeNull();
  });

  it('keeps nothing when there is nothing to restore', async () => {
    const api = fakeApi();
    expect(await saveUndo(api, [{ keptId: 'a', before: {}, absent: [], removed: [] }])).toBe(0);
    expect(await saveUndo(api, [])).toBe(0);
  });

  it('evicts the oldest batch when the card limit is reached', async () => {
    const api = fakeApi();
    const many = Array.from({ length: MAX_CARDS }, (_, i) => makeCard({ id: `r${i}`, name: `R${i}` }));
    expect(await saveUndo(api, [{ ...entry, removed: many }])).toBe(1);
    expect(await saveUndo(api, [entry])).toBe(1);
    const batches = await readUndo(api);
    expect(batches).toHaveLength(1); // the big one was evicted, the new one kept
    expect(batches[0].entries[0].removed[0].id).toBe('b');
  });

  it('refuses a single batch that is bigger than the limits', async () => {
    const api = fakeApi();
    const huge = Array.from({ length: MAX_CARDS + 1 }, (_, i) => makeCard({ id: `h${i}`, name: `H${i}` }));
    expect(await saveUndo(api, [{ ...entry, removed: huge }])).toBe(0);
    expect(await readUndo(api)).toEqual([]);
  });

  it('enforceLimits only trims from the front', () => {
    const batch = (n) => ({ entries: [{ removed: Array.from({ length: n }, (_, i) => ({ id: `x${i}` })) }] });
    expect(enforceLimits([batch(1), batch(1)])).toHaveLength(2);
    expect(enforceLimits([batch(MAX_CARDS), batch(1)])).toHaveLength(1);
  });

  it('clearUndo forgets everything', async () => {
    const api = fakeApi();
    await saveUndo(api, [entry]);
    await clearUndo(api);
    expect(await readUndo(api)).toEqual([]);
  });
});


describe('undoLastMerge', () => {
  it('re-creates the removed contacts and reverts the kept contact', async () => {
    let stored = fixture();
    const api = fakeApi({ handlers: {
      'contacts.update': async (id, patch) => {
        stored = stored.map((card) => (card.id === id ? { ...card, ...patch } : card));
      },
      'contacts.remove': async (id) => { stored = stored.filter((card) => card.id !== id); },
      'contacts.create': async (card) => { stored = [...stored, { ...card, id: `new${stored.length}` }]; return card; },
    } });
    const { entries } = await mergeWithJournal(api);
    await saveUndo(api, entries);
    expect(stored.map((card) => card.id)).toEqual(['a']); // b is gone, a has b's phone

    const result = await undoLastMerge(api);
    expect(result).toEqual({ restored: 1, reverted: 1, failed: 0, total: 1 });
    expect(stored.map((card) => card.id).sort()).toEqual(['a', 'new1']);
    const recreated = api.calls('contacts.create')[0].args[0];
    expect(recreated.id).toBeUndefined(); // the host assigns a fresh id
    expect(recreated.name).toEqual({ full: 'A' });
    // the kept contact is back to its own values: the merged phone is cleared
    expect(api.calls('contacts.update').at(-1).args).toEqual(['a', { phones: undefined }]);
    expect(stored[0].phones).toBeUndefined();
    expect(await readUndo(api)).toEqual([]);
  });

  it('keeps a partially failed undo so it can be retried', async () => {
    let attempts = 0;
    const api = fakeApi({ handlers: {
      'contacts.update': async () => {},
      'contacts.remove': async () => {},
      'contacts.create': async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('rejected');
      },
    } });
    const { entries } = await mergeWithJournal(api);
    await saveUndo(api, entries);

    const first = await undoLastMerge(api);
    expect(first).toEqual({ restored: 0, reverted: 0, failed: 1, total: 1 });
    // the kept contact is not reverted while its duplicate is still missing
    expect(api.calls('contacts.update')).toHaveLength(1);
    const [batch] = await readUndo(api);
    expect(batch.entries[0].removed.map((card) => card.id)).toEqual(['b']);

    const second = await undoLastMerge(api);
    expect(second).toEqual({ restored: 1, reverted: 1, failed: 0, total: 1 });
    expect(await readUndo(api)).toEqual([]);
  });

  it('reports a failed revert but keeps the restored card on record', async () => {
    const api = fakeApi({ handlers: {
      'contacts.update': async (_id, patch) => {
        if (patch.phones === undefined) throw new Error('locked');
      },
      'contacts.remove': async () => {},
      'contacts.create': async () => {},
    } });
    const { entries } = await mergeWithJournal(api);
    await saveUndo(api, entries);
    const result = await undoLastMerge(api);
    expect(result).toEqual({ restored: 1, reverted: 0, failed: 1, total: 1 });
    const [batch] = await readUndo(api);
    expect(batch.entries[0].removed).toEqual([]); // card is back, only the revert is pending
    expect(batch.entries[0].keptId).toBe('a');
  });

  it('does nothing when there is no record', async () => {
    const api = fakeApi();
    expect(await undoLastMerge(api)).toEqual({ restored: 0, reverted: 0, failed: 0, total: 0 });
    expect(api.calls('contacts.create')).toHaveLength(0);
  });
});
