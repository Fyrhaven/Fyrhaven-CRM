// Bulk edits: the map-replacement rules the host forces on the plugin.
import { describe, expect, it } from 'vitest';
import { fakeApi } from '../test-utils/fake-api.mjs';
import {
  COMPANY_KEYWORD, applyBooks, applyBulkEdit, applyTags, deleteContacts, parseTags,
} from '../src/lib/bulk.js';
import { readUndo, undoLastMerge } from '../src/lib/undo.js';
import { makeCard } from './fixtures.mjs';

const api = (handlers = {}) => fakeApi({ handlers });
const updates = (subject) => subject.calls('contacts.update').map((call) => call.args);

describe('parseTags', () => {
  it('splits on commas, trims, drops blanks and de-duplicates', () => {
    expect(parseTags(' vip, client ,, vip , ')).toEqual(['vip', 'client']);
    expect(parseTags(['a', ' a ', ''])).toEqual(['a']);
  });
});

describe('applyTags', () => {
  it('sends the complete keyword map, so other tags are not lost', async () => {
    const subject = api({ 'contacts.update': async () => {} });

    const result = await applyTags(subject, [makeCard({ id: 'a', keywords: { vip: true } })], { add: ['client'] });

    expect(result).toEqual({ updated: 1, skipped: 0, failed: 0 });
    expect(updates(subject)[0]).toEqual(['a', { keywords: { vip: true, client: true } }]);
  });

  it('never removes the company marker', async () => {
    const subject = api({ 'contacts.update': async () => {} });

    await applyTags(subject, [makeCard({ id: 'a', keywords: { company: true, vip: true } })], { remove: ['company', 'vip'] });

    // 'vip' goes, 'company' survives: removing it would turn the company into a person
    expect(updates(subject)[0][1]).toEqual({ keywords: { company: true } });
  });

  it('skips a contact whose tags would not change', async () => {
    const subject = api({ 'contacts.update': async () => {} });

    const result = await applyTags(subject, [makeCard({ id: 'a', keywords: { vip: true } })], { add: ['vip'] });

    expect(result).toEqual({ updated: 0, skipped: 1, failed: 0 });
    expect(subject.calls('contacts.update')).toHaveLength(0);
  });

  it('counts a contact the host refuses', async () => {
    const subject = api({ 'contacts.update': async () => { throw new Error('missing contacts:write'); } });

    expect(await applyTags(subject, [makeCard({ id: 'a' })], { add: ['vip'] }))
      .toEqual({ updated: 0, skipped: 0, failed: 1 });
  });
});

describe('applyBooks', () => {
  it('adds to a book while keeping the existing membership', async () => {
    const subject = api({ 'contacts.update': async () => {} });

    await applyBooks(subject, [makeCard({ id: 'a', addressBookIds: { b1: true } })], { add: ['b2'] });

    expect(updates(subject)[0]).toEqual(['a', { addressBookIds: { b1: true, b2: true } }]);
  });

  it('refuses to leave a contact in no book at all', async () => {
    const subject = api({ 'contacts.update': async () => {} });

    const result = await applyBooks(subject, [makeCard({ id: 'a', addressBookIds: { b1: true } })], { remove: ['b1'] });

    expect(result).toEqual({ updated: 0, skipped: 0, failed: 1 });
    expect(subject.calls('contacts.update')).toHaveLength(0);
  });

  it('removes from one book when another one remains', async () => {
    const subject = api({ 'contacts.update': async () => {} });

    await applyBooks(subject, [makeCard({ id: 'a', addressBookIds: { b1: true, b2: true } })], { remove: ['b1'] });

    expect(updates(subject)[0]).toEqual(['a', { addressBookIds: { b2: true } }]);
  });
});

describe('applyBulkEdit', () => {
  it('writes tags and books in one update per contact', async () => {
    const subject = api({ 'contacts.update': async () => {} });

    const result = await applyBulkEdit(subject, [makeCard({ id: 'a', addressBookIds: { b1: true } })], {
      tags: { add: ['vip'] },
      books: { add: ['b2'] },
    });

    expect(result).toEqual({ updated: 1, skipped: 0, failed: 0 });
    expect(subject.calls('contacts.update')).toHaveLength(1);
    expect(updates(subject)[0][1]).toEqual({ keywords: { vip: true }, addressBookIds: { b1: true, b2: true } });
  });

  it('does nothing at all when asked for nothing', async () => {
    const subject = api({ 'contacts.update': async () => {} });

    expect(await applyBulkEdit(subject, [makeCard({ id: 'a' })], {})).toEqual({ updated: 0, skipped: 1, failed: 0 });
  });
});

describe('the company marker', () => {
  it('is the keyword the plugin uses to mean organisation', () => {
    expect(COMPANY_KEYWORD).toBe('company');
  });
});

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
