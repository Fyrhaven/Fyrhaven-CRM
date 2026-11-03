// The customer's own server, as a home for records (#68).
//
// `api.files` is Stalwart's file storage (Bulwark 1.20+), so a record can live on
// the server the user already owns instead of a cloud: server-side,
// cross-device, and out of the browser. One JSON file per store, in a
// `Contact Manager/` folder in the user's own drive.
//
// Three things from the host's documentation shape this code:
//
// 1. **Writes go only into the user's own drive** — "never into, out of or inside
//    a folder shared with others" — and **there is no delete call**. So this is
//    per-user storage, and "removing" a store means writing a tombstone: a file
//    whose content is `null`, which reads back as nothing.
// 2. **It is rate-limited**: `getText` 30 a minute, every write 20 a minute. A
//    page that reads fifteen stores must therefore read the folder **once**, not
//    fifteen times, so the whole folder is cached for the session.
// 3. **It is optional.** `api.host.features.files` is true only when the server
//    has Files for this signed-in account and the admin left Files on; with it
//    off every call rejects with "Files is not available". Nothing here may
//    throw, and a failure is reported as such rather than as an empty store.

/** The folder records live in, in the user's own drive. */
export const FILES_FOLDER = 'Contact Manager';

/**
 * The type the host accepts for a record. `files.create` refuses anything but
 * `text/markdown` or `text/plain` (a live install says so: *"type must be
 * text/markdown or text/plain"*), so the value is written as **plain text** —
 * which is what JSON is, and the extension still says what it holds.
 */
const MIME = 'text/plain';
const SUFFIX = '.json';

/**
 * Whether this host can hold records: the feature flag says Files is on for
 * this account, and the calls are really there. Both, because the flag alone is
 * a promise and the method is the proof.
 */
export function filesAvailable(api) {
  return api?.host?.features?.files === true && typeof api?.files?.find === 'function';
}

/**
 * A reader/writer for the folder, with the session cache.
 *
 * `load()` is memoised as a promise, so two stores reading at the same moment
 * share one listing instead of racing two past the rate limit.
 */
export function makeFilesStore(api) {
  let cache = null;

  async function findFolder() {
    const listing = await api.files.list();
    const existing = (listing ?? []).find((item) => item?.kind === 'folder' && item?.name === FILES_FOLDER);
    if (existing) return existing.id;
    const created = await api.files.createFolder({ parentId: null, name: FILES_FOLDER });
    return created?.id ?? null;
  }

  function load() {
    if (!cache) {
      cache = (async () => {
        const folderId = await findFolder();
        const values = new Map();
        // The names already there, so a write can say which file it replaces.
        const names = new Set();
        if (folderId) {
          const files = await api.files.find({ folderId, limit: 50 });
          for (const file of files ?? []) {
            const name = String(file?.name ?? '');
            if (file?.kind !== 'file') continue;
            names.add(name);
            if (!name.endsWith(SUFFIX)) continue;
            const key = name.slice(0, -SUFFIX.length);
            try {
              const text = await api.files.getText(file.id);
              values.set(key, text ? JSON.parse(text) : null);
            } catch {
              // One unreadable file must not sink every store beside it.
              values.set(key, null);
            }
          }
        }
        return { folderId, values, names };
      })().catch((err) => {
        // Do not cache a failure: the next read should try again.
        cache = null;
        throw err;
      });
    }
    return cache;
  }

  async function write(key, content) {
    const current = await load();
    const name = `${key}${SUFFIX}`;
    // `replace` is not a flag: the host wants the **name** of the file being
    // replaced (a live install says *"replace must be a string of 1-256
    // characters"*). It is sent only when that file is really there, so a first
    // write is an ordinary create.
    const payload = { folderId: current.folderId, name, content, type: MIME };
    if (current.names.has(name)) payload.replace = name;
    await api.files.create(payload);
    current.names.add(name);
    current.values.set(key, content === 'null' ? null : JSON.parse(content));
  }

  return {
    async read(key) {
      const { values } = await load();
      return values.has(key) ? values.get(key) : null;
    },
    async write(key, value) {
      await write(key, JSON.stringify(value ?? null));
    },
    /** There is no delete call: a tombstone reads back as nothing. */
    async remove(key) {
      await write(key, 'null');
    },
    /** Forget the session cache, so the next read goes back to the server. */
    invalidate() {
      cache = null;
    },
  };
}
