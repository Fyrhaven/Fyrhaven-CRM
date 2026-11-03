// The customer's own server as a home for records (#68): `api.files` is
// Stalwart's file storage, and this is the seam's backend for it.
//
// The fake declares the **documented surface** (`host.exposes`) so a test cannot
// pass against a method the host does not have, and the folder behaves like the
// real one: a listing, a find, a text read, and a create that can replace.
import { describe, expect, it } from 'vitest';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { FILES_FOLDER, filesAvailable, makeFilesStore } from '../src/lib/files-store.js';

const SURFACE = ['list', 'find', 'getText', 'create', 'createFolder'];

/** A stand-in for Stalwart's Files, with the documented calls and nothing else. */
function filesApi({ seed = [], features = { files: true }, overrides = {} } = {}) {
  const state = { files: [...seed], nextId: seed.length + 1, folders: [], created: [] };
  const info = ({ content, ...rest }) => rest;
  const api = fakeApi({
    host: { exposes: { files: SURFACE }, features },
    handlers: {
      'files.list': async (folderId) => state.files
        .filter((file) => (folderId === undefined ? !file.parentId : file.parentId === folderId))
        .map(info),
      // `find` searches by text in the name or path; with no text it finds
      // nothing. `list(folderId)` is what lists a folder's contents — the two
      // are not interchangeable, which is why the fake keeps them apart.
      'files.find': async ({ text, folderId } = {}) => (text
        ? state.files.filter((file) => file.parentId === folderId
          && String(file.name).toLowerCase().includes(String(text).toLowerCase()))
        : []).map(info),
      'files.getText': async (fileId) => {
        const file = state.files.find((entry) => entry.id === fileId);
        if (!file) throw new Error('no such file');
        return file.content;
      },
      'files.createFolder': async ({ parentId = null, name }) => {
        const folder = { id: `f${state.nextId++}`, name, kind: 'folder', parentId };
        state.files.push(folder);
        state.folders.push(folder);
        return folder;
      },
      'files.create': async (payload) => {
        const { folderId, name, content, type, replace } = payload;
        const existing = state.files.find((file) => file.parentId === folderId && file.name === name);
        // `replace` is the **id** of the file to replace, and it must be one
        // this folder really holds (as on a live install).
        const replaced = replace === undefined
          ? null
          : state.files.find((file) => file.id === replace && file.parentId === folderId);
        if (replace !== undefined && !replaced) {
          throw new Error(`files.create: no file or folder with id "${replace}" in your own files`);
        }
        if (existing && !replaced) throw new Error('already there');
        if (existing) {
          existing.content = content;
          state.created.push(payload);
          return { file: info(existing) };
        }
        const file = { id: `f${state.nextId++}`, name, kind: 'file', parentId: folderId, content, mimeType: type };
        state.files.push(file);
        state.created.push(payload);
        return { file: info(file) };
      },
      ...overrides,
    },
  });
  return { api, state };
}

describe('filesAvailable', () => {
  it('needs both the feature flag and the calls', () => {
    const { api } = filesApi();
    expect(filesAvailable(api)).toBe(true);

    // the flag without the calls is a promise, not a proof
    const absent = fakeApi({ host: { absent: ['files'], features: { files: true } } });
    expect(filesAvailable(absent)).toBe(false);

    // and the calls without the flag mean Files is off for this account
    const off = fakeApi({ host: { exposes: { files: SURFACE }, features: {} } });
    expect(filesAvailable(off)).toBe(false);
  });

  it('is false on a host with no api.host at all', () => {
    expect(filesAvailable(fakeApi())).toBe(false);
  });
});

describe('the files store', () => {
  it('creates the folder when it is missing, and reuses it when it is there', async () => {
    const { api, state } = filesApi();
    await makeFilesStore(api).write('projects', [{ id: 'p1' }]);
    expect(state.folders.map((folder) => folder.name)).toEqual([FILES_FOLDER]);

    // a second store must not make a second folder
    await makeFilesStore(api).write('contactNotes', {});
    expect(state.folders).toHaveLength(1);
  });

  it('round-trips a value, and writes it as JSON that can replace', async () => {
    const { api, state } = filesApi();
    const store = makeFilesStore(api);

    await store.write('projects', [{ id: 'p1' }]);
    expect(await store.read('projects')).toEqual([{ id: 'p1' }]);
    const firstId = state.files.find((file) => file.name === 'projects.json').id;

    await store.write('projects', [{ id: 'p2' }]);
    expect(await store.read('projects')).toEqual([{ id: 'p2' }]);

    expect(state.created.at(-1)).toMatchObject({
      name: 'projects.json',
      content: JSON.stringify([{ id: 'p2' }]),
      type: 'text/plain',
      // the second write replaces the file it made, **by id**
      replace: firstId,
    });
  });

  it('sends no replace on a first write — only an id when one is there', async () => {
    const { api, state } = filesApi();
    await makeFilesStore(api).write('projects', []);
    expect(state.created[0]).not.toHaveProperty('replace');
  });

  it('reads a store that is not there as nothing', async () => {
    const { api } = filesApi();
    expect(await makeFilesStore(api).read('projects')).toBeNull();
  });

  it('removes by writing a tombstone, because the host has no delete', async () => {
    const { api, state } = filesApi();
    const store = makeFilesStore(api);
    await store.write('projects', [{ id: 'p1' }]);

    await store.remove('projects');

    expect(await store.read('projects')).toBeNull();
    // the file is still there, holding `null` — that is the honest shape of it
    expect(state.created.at(-1).content).toBe('null');
  });

  it('reads the folder once, not once per store', async () => {
    const { api, state } = filesApi();
    const store = makeFilesStore(api);

    await store.write('projects', []);
    await store.read('projects');
    await store.read('contactNotes');

    // the folder's contents were listed once; the rest is the session cache
    const contents = api.calls('files.list').filter((call) => call.args.length > 0);
    expect(contents).toHaveLength(1);
    expect(state.folders).toHaveLength(1);
  });

  it('goes back to the server after invalidate', async () => {
    const { api } = filesApi();
    const store = makeFilesStore(api);
    await store.write('projects', []);
    store.invalidate();
    await store.read('projects');
    const contents = api.calls('files.list').filter((call) => call.args.length > 0);
    expect(contents).toHaveLength(2);
  });

  it('reads a seeded store from the server, beside the folder it found', async () => {
    const folder = { id: 'f1', name: FILES_FOLDER, kind: 'folder', parentId: null };
    const file = { id: 'f2', name: 'projects.json', kind: 'file', parentId: 'f1', content: '[{"id":"p9"}]' };
    const { api } = filesApi({ seed: [folder, file] });

    expect(await makeFilesStore(api).read('projects')).toEqual([{ id: 'p9' }]);
    expect(api.calls('files.createFolder')).toHaveLength(0);
  });

  it('lets one unreadable file not sink the store beside it', async () => {
    const folder = { id: 'f1', name: FILES_FOLDER, kind: 'folder', parentId: null };
    const broken = { id: 'f2', name: 'projects.json', kind: 'file', parentId: 'f1', content: 'x' };
    const good = { id: 'f3', name: 'contactNotes.json', kind: 'file', parentId: 'f1', content: '{"a":1}' };
    const { api } = filesApi({
      seed: [folder, broken, good],
      overrides: {
        'files.getText': async (fileId) => {
          if (fileId === 'f2') throw new Error('too_big');
          return '{"a":1}';
        },
      },
    });
    const store = makeFilesStore(api);

    expect(await store.read('projects')).toBeNull();
    expect(await store.read('contactNotes')).toEqual({ a: 1 });
  });

  it('reports a failure instead of caching it', async () => {
    const { api } = filesApi({ overrides: { 'files.list': async () => { throw new Error('refused'); } } });
    const store = makeFilesStore(api);

    await expect(store.read('projects')).rejects.toThrow('refused');
    // the next read tries again rather than remembering the failure
    await expect(store.read('projects')).rejects.toThrow('refused');
  });
});

// The bug a live install found: a project saved fine, then was missing the next
// time the page opened. The store read the folder with `find`, which searches
// by *text* — so with no text it returned nothing. These are the regressions.

describe('reopening a store', () => {
  it('reads back what a previous session wrote', async () => {
    const folder = { id: 'f1', name: FILES_FOLDER, kind: 'folder', parentId: null };
    const saved = { id: 'f2', name: 'projects.json', kind: 'file', parentId: 'f1', content: '[{"id":"p1"}]' };
    const { api } = filesApi({ seed: [folder, saved] });

    // a fresh store, as a page load makes
    expect(await makeFilesStore(api).read('projects')).toEqual([{ id: 'p1' }]);
  });

  it('lists the folder rather than searching it with no text', async () => {
    const { api } = filesApi();
    await makeFilesStore(api).read('projects');

    expect(api.calls('files.find')).toHaveLength(0);
    expect(api.calls('files.list').filter((call) => call.args.length > 0)).toHaveLength(1);
  });
});
