// The storage seam (#68).
//
// Every store used to call `api.storage` directly. That is per-account,
// per-browser `localStorage`: a record kept there is unreachable from another
// device, and gone the moment site data is cleared. The maintainer's ruling is
// that the **server is the source of truth** for the records this plugin
// invents, so this module is the one place that decides where a key's bytes live.
//
// Two kinds of key:
//
//   RECORD — something the user made: a project, a private note, a consent
//     record, a history entry, a role, a policy, an automation rule, a saved
//     search, a hidden duplicate group. These belong on the dedicated server.
//     With no server configured they are *unavailable*, and the feature that
//     needs one says so — it must not quietly keep working on one device, which
//     is the bug this whole change exists to remove.
//   VIEW — state that costs nothing to lose, or that cannot leave the browser:
//     whether the guide has been seen, the undo batch (it holds copies of
//     removed contacts, so the browser is the *safer* place for it), the last
//     cleanup record, the phone-region preference, and the server's own address
//     and credential id — which have to be readable *before* any server can be
//     reached.
//
// The classification is one list, and `test/store.test.mjs` asserts that every
// key this plugin stores appears in it, so a new store cannot be added without
// deciding which kind it is.

import { readRemoteUrl, storeDelete, storeGet, storePut } from './remote.js';
import { filesAvailable, makeFilesStore } from './files-store.js';

/** Records: the server is the source of truth (#68 carries the boundary table). */
export const RECORD_KEYS = new Set([
  'projects', 'contactNotes', 'consentRecords', 'deletionLog', 'changeHistory',
  'bookPolicies', 'bookIgnore', 'bookRoles', 'automationRules', 'savedSearches',
  'importMappings', 'normalizeRules', 'dismissedGroups', 'lastScan', 'scanDigest',
  // A preference rather than a record, but the maintainer's call: it follows the
  // user. NOTE the consequence — phone matching is a free feature and the region
  // sharpens it, so with no server the region is unset and national numbers stop
  // matching their international spelling. See the handoff.
  'normalizeRegion',
]);

/** View state, and the server's own address: these stay local. */
export const VIEW_KEYS = new Set([
  'onboarding', 'undoBatches', 'lastCleanup',
  'remoteUrl', 'remoteCredentialId', 'remoteMode',
]);

export const isRecord = (key) => RECORD_KEYS.has(key);
export const isViewKey = (key) => VIEW_KEYS.has(key);

/**
 * Which side a key belongs to. An unknown key is treated as view state, so a
 * store someone forgot to classify keeps working rather than breaking — and the
 * guard in `test/store.test.mjs` is what stops that from shipping.
 */
export const backendFor = (key) => (isRecord(key) ? 'remote' : 'local');

// The files store is per-session — its cache is what keeps a page load inside
// the host's rate limits — so one instance is kept per `api` rather than made
// per call. Keyed by the api, not held in a single slot, so a second api (a
// test, or a second host in the same realm) gets its own.
const filesStores = new WeakMap();
const filesFor = (api) => {
  let store = filesStores.get(api);
  if (!store) {
    store = makeFilesStore(api);
    filesStores.set(api, store);
  }
  return store;
};

/**
 * Where a record's bytes live right now:
 *
 * - `'files'` — the customer's own Stalwart, which is the first choice: their
 *   server, their backups, no cloud and no secret.
 * - `'cloud'` — the dedicated plugin server, for a host that cannot or will not
 *   enable Files, and for the work the host refuses by design.
 * - `'unavailable'` — neither. A record feature says so and offers the cloud
 *   tier; it does **not** quietly fall back to the browser.
 */
export async function recordBackend(api) {
  if (filesAvailable(api)) return 'files';
  try {
    return (await readRemoteUrl(api)) ? 'cloud' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/**
 * Whether records can be read and written at all. A feature asks this *before*
 * it reads, so it can say what is missing instead of showing an empty list.
 */
export const recordsAvailable = async (api) => (await recordBackend(api)) !== 'unavailable';

/**
 * Read a key. The answer says *why* it is empty, so a caller can tell "nothing
 * saved yet" from "there is no server to ask":
 *
 * @returns {Promise<{status: 'ok'|'unavailable', value?: any, reason?: string}>}
 *   `unavailable` covers unconfigured, a host without `api.proxy`, and a server
 *   that refused — a caller that only needs the value treats them alike, and one
 *   that reports to the user has `reason`.
 */
/**
 * Replace a whole record store with `value` — or remove the key when there is
 * nothing left. Throws when there is nowhere to write, so a caller never reports
 * a save that did not happen.
 *
 * The shape every list-shaped store wants: a store module keeps its own
 * normalisation and decision, and this does the write and the empty case.
 */
export async function replace(api, key, value, isEmpty) {
  const answer = isEmpty ? await remove(api, key) : await write(api, key, value);
  if (answer.status !== 'ok') throw new Error(answer.reason ?? 'unconfigured');
  return answer;
}

/**
 * Where a record can live right now.
 *
 * Two servers, and they are **not** the same audience: `files` is the user's own
 * drive (only they can open it), `cloud` is the Contact Manager server, where a
 * workspace is shared. A record that says which one it chose is a record whose
 * visibility the user can understand, so the answer is returned to the caller
 * instead of being decided invisibly here.
 */
export async function availableBackends(api) {
  const files = filesAvailable(api);
  let cloud = false;
  try {
    cloud = Boolean(await readRemoteUrl(api));
  } catch {
    cloud = false;
  }
  return { files, cloud };
}

/** The targets a record can be given, and the backend each one means. */
export const RECORD_TARGETS = ['personal', 'cloud'];
const BACKEND_FOR_TARGET = { personal: 'files', cloud: 'cloud' };

/** `'personal'` -> `'files'`; anything else -> `null` (an unknown target). */
export const backendForTarget = (target) => BACKEND_FOR_TARGET[target] ?? null;

/** The target a backend means, for reading a record back with its origin. */
export const targetForBackend = (backend) => (backend === 'cloud' ? 'cloud' : 'personal');

/** Which targets can hold a record right now — what a "where?" control offers. */
export async function availableTargets(api) {
  const { files, cloud } = await availableBackends(api);
  return { personal: files, cloud };
}

/**
 * Run a record operation against whichever server holds the records.
 *
 * `files` and `cloud` are the two ways to do the same thing; a throw from
 * either is reported as `unavailable` rather than propagated, because every
 * caller of this seam is a page that has to stay readable.
 *
 * `prefer` pins the backend — `'personal'` (the user's own Files), `'cloud'` (the
 * Contact Manager server) — and reports `unavailable` when that one cannot be
 * reached, instead of quietly using the other one. A record the user placed
 * somewhere must never turn up somewhere else.
 */
async function recordOp(api, key, files, cloud, prefer = 'auto') {
  let backend = 'unavailable';
  if (prefer === 'auto') backend = await recordBackend(api);
  else {
    const usable = await availableBackends(api);
    const wanted = prefer === 'personal' ? 'files' : prefer === 'cloud' ? 'cloud' : '';
    if (wanted && usable[wanted]) backend = wanted;
  }
  try {
    if (backend === 'files') return await files(filesFor(api), key);
    if (backend === 'cloud') {
      const answer = await cloud(key);
      if (answer.status === 'ok') return answer;
      return { status: 'unavailable', reason: answer.reason ?? answer.status };
    }
  } catch (err) {
    return { status: 'unavailable', reason: String(err?.message ?? err) };
  }
  // The same word the cloud client uses for "there is nowhere to put this": the
  // seam cannot tell *why* the user has no storage, only that they have none.
  return { status: 'unavailable', reason: 'unconfigured' };
}

/**
 * Read one key from one target. `'auto'` keeps the old behaviour (the first
 * backend that exists); `'personal'` and `'cloud'` are the explicit ones.
 */
export async function readAs(api, key, target = 'auto') {
  if (!isRecord(key)) return read(api, key);
  const prefer = target === 'personal' ? 'personal' : target === 'cloud' ? 'cloud' : 'auto';
  return recordOp(
    api,
    key,
    async (store, k) => ({ status: 'ok', value: await store.read(k) }),
    (k) => storeGet(api, k),
    prefer,
  );
}

/** Write one key to one target; an unreachable target reports `unavailable`. */
export async function writeAs(api, key, value, target = 'auto') {
  if (!isRecord(key)) return write(api, key, value);
  const prefer = target === 'personal' ? 'personal' : target === 'cloud' ? 'cloud' : 'auto';
  return recordOp(
    api,
    key,
    async (store, k) => {
      await store.write(k, value);
      return { status: 'ok' };
    },
    (k) => storePut(api, k, value),
    prefer,
  );
}

/** Remove one key from one target. */
export async function removeAs(api, key, target = 'auto') {
  if (!isRecord(key)) return remove(api, key);
  const prefer = target === 'personal' ? 'personal' : target === 'cloud' ? 'cloud' : 'auto';
  return recordOp(
    api,
    key,
    async (store, k) => {
      await store.remove(k);
      return { status: 'ok' };
    },
    (k) => storeDelete(api, k),
    prefer,
  );
}

export async function read(api, key) {
  if (!isRecord(key)) return { status: 'ok', value: await api.storage.get(key) };
  return recordOp(
    api,
    key,
    async (store, k) => ({ status: 'ok', value: await store.read(k) }),
    (k) => storeGet(api, k),
  );
}

/** Write a key. A record write with nowhere to go reports `unavailable`. */
export async function write(api, key, value) {
  if (!isRecord(key)) {
    await api.storage.set(key, value);
    return { status: 'ok' };
  }
  return recordOp(
    api,
    key,
    async (store, k) => {
      await store.write(k, value);
      return { status: 'ok' };
    },
    (k) => storePut(api, k, value),
  );
}

/** Remove a key. */
export async function remove(api, key) {
  if (!isRecord(key)) {
    await api.storage.remove(key);
    return { status: 'ok' };
  }
  return recordOp(
    api,
    key,
    async (store, k) => {
      await store.remove(k);
      return { status: 'ok' };
    },
    (k) => storeDelete(api, k),
  );
}
