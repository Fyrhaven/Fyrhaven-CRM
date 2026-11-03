// Private notes (#38, the private half): the store, its repairs, and the erasure
// path. Pure, plus api.storage.
import { describe, expect, it } from 'vitest';
import {
  MAX_LENGTH, MAX_PER_CONTACT, NOTES_KEY, deleteNote, eraseNotes, makeNote, mentionsIn,
  normalizeNote, normalizeNotes, noteId, notesFor, readNotes, saveNote, writeNotes,
} from '../src/lib/notes.js';
import { fakeApi } from '../test-utils/fake-api.mjs';

const at = (iso) => ({ id: `n-${iso}`, at: iso, text: 'note' });

describe('mentionsIn', () => {
  it('finds the names a note mentions, folded and de-duplicated', () => {
    expect(mentionsIn('Ask @Ada about it')).toEqual(['ada']);
    expect(mentionsIn('@Ada and @bob and @Ada')).toEqual(['ada', 'bob']);
    expect(mentionsIn('mail me at ada@example.org')).toEqual(['example.org']);
  });

  it('finds nothing when there is nothing to find', () => {
    expect(mentionsIn('no mentions here')).toEqual([]);
    expect(mentionsIn('')).toEqual([]);
    expect(mentionsIn(null)).toEqual([]);
  });
});

describe('normalizeNote', () => {
  it('keeps an id, a date and text', () => {
    expect(normalizeNote({ id: 'n1', at: '2026-01-01T00:00:00Z', text: ' hello ' }))
      .toEqual({ id: 'n1', at: '2026-01-01T00:00:00Z', text: 'hello' });
  });

  it('drops a note with no id or no text — that is corruption, not a note', () => {
    expect(normalizeNote({ text: 'hello' })).toBeNull();
    expect(normalizeNote({ id: 'n1' })).toBeNull();
    expect(normalizeNote({ id: 'n1', text: '   ' })).toBeNull();
    expect(normalizeNote(null)).toBeNull();
    expect(normalizeNote('nope')).toBeNull();
  });

  it('caps the length of one note', () => {
    const note = normalizeNote({ id: 'n1', text: 'x'.repeat(MAX_LENGTH + 500) });
    expect(note.text).toHaveLength(MAX_LENGTH);
  });
});

describe('normalizeNotes', () => {
  it('returns an empty store for junk', () => {
    expect(normalizeNotes(null)).toEqual({});
    expect(normalizeNotes('nope')).toEqual({});
    expect(normalizeNotes([])).toEqual({});
  });

  it('keeps only real contacts with real notes', () => {
    const store = normalizeNotes({
      c1: [{ id: 'n1', at: '2026-01-01T00:00:00Z', text: 'a' }, { id: 'n1', text: 'duplicate id' }, null],
      c2: 'not a list',
      '': [{ id: 'n3', text: 'orphan' }],
    });
    expect(Object.keys(store)).toEqual(['c1']);
    expect(store.c1).toHaveLength(1);
  });

  it('caps the notes per contact', () => {
    const many = Array.from({ length: MAX_PER_CONTACT + 20 }, (_, i) => ({ id: `n${i}`, text: 'x' }));
    expect(normalizeNotes({ c1: many }).c1).toHaveLength(MAX_PER_CONTACT);
  });
});

describe('readNotes / writeNotes', () => {
  it('reads an empty store as empty', async () => {
    expect(await readNotes(fakeApi())).toEqual({});
  });

  it('round-trips a store', async () => {
    const api = fakeApi();
    const store = { c1: [{ id: 'n1', at: '2026-01-01T00:00:00Z', text: 'hello' }] };
    await writeNotes(api, store);
    expect(await readNotes(api)).toEqual(store);
  });

  it('rewrites storage when junk was dropped', async () => {
    const api = fakeApi();
    await api.storage.set(NOTES_KEY, { c1: [{ id: 'n1', text: 'a' }, { text: 'no id' }] });
    expect(await readNotes(api)).toEqual({ c1: [{ id: 'n1', at: '', text: 'a' }] });
    expect(await api.storage.get(NOTES_KEY)).toEqual({ c1: [{ id: 'n1', at: '', text: 'a' }] });
  });

  it('removes the key when nothing is left to store', async () => {
    const api = fakeApi();
    await api.storage.set(NOTES_KEY, { c1: [{ id: 'n1', text: 'a' }] });
    await writeNotes(api, { c1: [{ id: 'n1' }] });
    expect(await api.storage.get(NOTES_KEY)).toBeNull();
  });
});

describe('notesFor', () => {
  it('returns the notes about one contact, newest first', () => {
    const store = { c1: [at('2026-01-01T00:00:00Z'), at('2026-03-01T00:00:00Z'), at('2026-02-01T00:00:00Z')] };
    expect(notesFor(store, 'c1').map((note) => note.at)).toEqual([
      '2026-03-01T00:00:00Z', '2026-02-01T00:00:00Z', '2026-01-01T00:00:00Z',
    ]);
  });

  it('does not mutate the stored list', () => {
    const store = { c1: [at('2026-01-01T00:00:00Z'), at('2026-02-01T00:00:00Z')] };
    const before = store.c1.map((note) => note.id);
    notesFor(store, 'c1');
    expect(store.c1.map((note) => note.id)).toEqual(before);
  });

  it('is empty for an unknown contact or a junk store', () => {
    expect(notesFor({}, 'c1')).toEqual([]);
    expect(notesFor(null, 'c1')).toEqual([]);
  });
});

describe('makeNote / noteId', () => {
  it('stamps the note with the injected clock', () => {
    const now = Date.parse('2026-05-05T10:00:00Z');
    expect(makeNote('  hello  ', { id: 'n1', now }))
      .toEqual({ id: 'n1', at: '2026-05-05T10:00:00.000Z', text: 'hello' });
  });

  it('makes an id when the caller does not', () => {
    const now = Date.parse('2026-05-05T10:00:00Z');
    expect(makeNote('hello', { now }).id).toBe(noteId(now));
  });

  it('is null when there is nothing to say', () => {
    expect(makeNote('   ')).toBeNull();
    expect(makeNote(null)).toBeNull();
  });
});

describe('saveNote / deleteNote', () => {
  it('stores a note about one contact, newest first', async () => {
    const api = fakeApi();
    await saveNote(api, 'c1', 'first', { id: 'n1', now: Date.parse('2026-01-01T00:00:00Z') });
    await saveNote(api, 'c1', 'second', { id: 'n2', now: Date.parse('2026-02-01T00:00:00Z') });

    const store = await readNotes(api);
    expect(store.c1.map((note) => note.text)).toEqual(['second', 'first']);
  });

  it('keeps each contact apart', async () => {
    const api = fakeApi();
    await saveNote(api, 'c1', 'about one', { id: 'n1' });
    await saveNote(api, 'c2', 'about two', { id: 'n2' });

    const store = await readNotes(api);
    expect(store.c1.map((note) => note.text)).toEqual(['about one']);
    expect(store.c2.map((note) => note.text)).toEqual(['about two']);
  });

  it('caps the notes per contact, dropping the oldest', async () => {
    const api = fakeApi();
    for (let i = 0; i < MAX_PER_CONTACT + 5; i++) {
      await saveNote(api, 'c1', `note ${i}`, { id: `n${i}`, now: 1000 + i });
    }
    const store = await readNotes(api);
    expect(store.c1).toHaveLength(MAX_PER_CONTACT);
    expect(store.c1[0].text).toBe(`note ${MAX_PER_CONTACT + 4}`);
  });

  it('ignores an empty note or an empty contact id', async () => {
    const api = fakeApi();
    await saveNote(api, 'c1', '   ', { id: 'n1' });
    await saveNote(api, '', 'hello', { id: 'n2' });
    expect(await readNotes(api)).toEqual({});
  });

  it('deletes one note and forgets the contact when the last one goes', async () => {
    const api = fakeApi();
    await saveNote(api, 'c1', 'first', { id: 'n1', now: 1 });
    await saveNote(api, 'c1', 'second', { id: 'n2', now: 2 });

    await deleteNote(api, 'c1', 'n1');
    expect((await readNotes(api)).c1.map((note) => note.id)).toEqual(['n2']);

    await deleteNote(api, 'c1', 'n2');
    expect(await readNotes(api)).toEqual({});
    expect(await api.storage.get(NOTES_KEY)).toBeNull();
  });
});

describe('eraseNotes', () => {
  it('takes every note about one contact and leaves the rest', async () => {
    const api = fakeApi();
    await saveNote(api, 'c1', 'a', { id: 'n1' });
    await saveNote(api, 'c1', 'b', { id: 'n2' });
    await saveNote(api, 'c2', 'c', { id: 'n3' });

    expect(await eraseNotes(api, 'c1')).toBe(2);

    const store = await readNotes(api);
    expect(store.c1).toBeUndefined();
    expect(store.c2).toHaveLength(1);
  });

  it('reports nothing removed when there was nothing', async () => {
    const api = fakeApi();
    expect(await eraseNotes(api, 'c1')).toBe(0);
  });
});
