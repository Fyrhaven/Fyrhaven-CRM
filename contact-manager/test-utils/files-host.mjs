// An in-memory stand-in for Stalwart's Files storage (`api.files`), for tests.
//
// It implements the documented surface — `list`, `find`, `getText`, `create`,
// `createFolder` — and nothing else, so a test that passes against it cannot be
// passing against a method the host does not have. Shared by the files-store,
// the storage seam and the pages that store records.
//
//   const host = filesHost();                 // -> { host, handlers, state }
//   fakeApi({ ...host, handlers: { ...host.handlers, ...more } })

export const FILES_SURFACE = ['list', 'find', 'getText', 'create', 'createFolder'];

export function filesHost({ seed = [], features = { files: true }, handlers = {} } = {}) {
  const state = { files: [...seed], nextId: seed.length + 1, folders: [], created: [] };
  const info = ({ content, ...rest }) => rest;

  return {
    state,
    host: { exposes: { files: FILES_SURFACE }, features },
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
        // The host refuses anything but these two (seen on a live install), so
        // the fake does too — a wrong type must fail here, not in production.
        if (type !== 'text/plain' && type !== 'text/markdown') {
          throw new Error('files.create: type must be text/markdown or text/plain');
        }
        // `replace` is the **id** of the file to replace — a string, and one the
        // host can actually find (two live installs taught this, in that order).
        if (replace !== undefined && (typeof replace !== 'string' || !replace.length || replace.length > 256)) {
          throw new Error('files.create: replace must be a string of 1-256 characters');
        }
        const replaced = replace === undefined
          ? null
          : state.files.find((file) => file.id === replace && file.parentId === folderId);
        if (replace !== undefined && !replaced) {
          throw new Error(`files.create: no file or folder with id "${replace}" in your own files`);
        }
        const existing = state.files.find((file) => file.parentId === folderId && file.name === name);
        if (existing && !replaced) throw new Error('already there');
        if (existing) {
          existing.content = content;
          state.created.push(payload);
          return { file: info(existing) };
        }
        const file = {
          id: `f${state.nextId++}`, name, kind: 'file', parentId: folderId, content, mimeType: type,
        };
        state.files.push(file);
        state.created.push(payload);
        return { file: info(file) };
      },
      ...handlers,
    },
  };
}