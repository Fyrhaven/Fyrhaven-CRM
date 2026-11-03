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
  'remoteUrl', 'remoteCredentialId',
]);

export const isRecord = (key) => RECORD_KEYS.has(key);
export const isViewKey = (key) => VIEW_KEYS.has(key);

/**
 * Which side a key belongs to. An unknown key is treated as view state, so a
 * store someone forgot to classify keeps working rather than breaking — and the
 * guard in `test/store.test.mjs` is what stops that from shipping.
 */
export const backendFor = (key) => (isRecord(key) ? 'remote' : 'local');

/**
 * Whether records can be read and written at all. A feature that needs the cloud
 * tier asks this *before* it reads, so it can say "this needs a server" instead
 * of showing an empty list.
 */
export async function recordsAvailable(api) {
  try {
    return Boolean(await readRemoteUrl(api));
  } catch {
    return false;
  }
}

/**
 * Read a key. The answer says *why* it is empty, so a caller can tell "nothing
 * saved yet" from "there is no server to ask":
 *
 * @returns {Promise<{status: 'ok'|'unavailable', value?: any, reason?: string}>}
 *   `unavailable` covers unconfigured, a host without `api.proxy`, and a server
 *   that refused — a caller that only needs the value treats them alike, and one
 *   that reports to the user has `reason`.
 */
export async function read(api, key) {
  if (!isRecord(key)) return { status: 'ok', value: await api.storage.get(key) };
  const answer = await storeGet(api, key);
  if (answer.status === 'ok') return { status: 'ok', value: answer.value };
  return { status: 'unavailable', reason: answer.reason ?? answer.status };
}

/** Write a key. A record write with nowhere to go reports `unavailable`. */
export async function write(api, key, value) {
  if (!isRecord(key)) {
    await api.storage.set(key, value);
    return { status: 'ok' };
  }
  const answer = await storePut(api, key, value);
  if (answer.status === 'ok') return { status: 'ok', revision: answer.revision };
  return { status: 'unavailable', reason: answer.reason ?? answer.status };
}

/** Remove a key. */
export async function remove(api, key) {
  if (!isRecord(key)) {
    await api.storage.remove(key);
    return { status: 'ok' };
  }
  const answer = await storeDelete(api, key);
  if (answer.status === 'ok') return { status: 'ok' };
  return { status: 'unavailable', reason: answer.reason ?? answer.status };
}
