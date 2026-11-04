// The duplicate digest: what the plugin tells the user when they come back.
//
// #5 asked for a *scheduled* background scan with a digest. There is no timer
// hook in the host contract — the plugin exports `onAction` and the two contact
// observers, and nothing else — and there is no server-side scheduler, so a scan
// cannot run while the webmail is closed. This is the re-scoped half that needs
// no host change: when the plugin is opened it compares the last scan and the
// current duplicate groups against what the user has already been told, and says
// so when the situation is **stale** (no scan within the configured window) or
// **changed** (groups the user has not been shown).
//
// Only the summary and the group signatures are stored — never contacts, which
// is what #5 asked for. Storage is per account and per browser, like everything
// else the plugin keeps.
//
// Pure logic plus api.storage; no DOM.

export const DIGEST_KEY = 'scanDigest';

/** One signature per duplicate group; a cap keeps a huge book bounded. */
export const MAX_ACKNOWLEDGED = 1000;

const DAY_MS = 24 * 3600 * 1000;

/** The configured window in days; 0 (or junk) means the digest is off. */
export function digestWindowDays(settings) {
  const value = Number(settings?.digestDays);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** The signatures of a set of groups, sorted, so a comparison is stable. */
export function groupSignatures(groups) {
  return (Array.isArray(groups) ? groups : [])
    .map((group) => group?.signature)
    .filter((signature) => typeof signature === 'string' && signature)
    .sort();
}

/** The signatures the user has not been told about yet. */
export function unseenSignatures(signatures, acknowledged) {
  const known = new Set(Array.isArray(acknowledged) ? acknowledged : []);
  return (Array.isArray(signatures) ? signatures : []).filter((signature) => !known.has(signature));
}

/**
 * True when the last scan is older than the window. A scan that never ran makes
 * no claim — "not scanned yet" is the headline's line to say, not a staleness
 * alarm about a scan that does not exist.
 */
export function isScanStale(at, days, now = Date.now()) {
  if (!days || !Number.isFinite(at)) return false;
  return now - at >= days * DAY_MS;
}

/**
 * What to tell the user, or `null` when there is nothing to say.
 *
 * `changed` needs a **baseline**: before the user has been shown anything, a
 * group is not *new* — it is just the state of the address book, and calling it
 * new on the first visit would be a false alarm every time the plugin is opened
 * in a fresh browser.
 *
 * @param {{at?: number, signatures?: string[], acknowledged?: string[],
 *          seenAt?: number, baseline?: boolean, days?: number, now?: number}} input
 *   `at` is the last scan's timestamp, `seenAt` when the baseline was recorded.
 * @returns {null | {at: number|null, seenAt: number|null, count: number,
 *   fresh: number, stale: boolean, changed: boolean, signatures: string[]}}
 */
export function buildDigest({ at, signatures, acknowledged, seenAt, baseline = false, days, now = Date.now() } = {}) {
  const current = Array.isArray(signatures) ? signatures : [];
  const fresh = unseenSignatures(current, acknowledged);
  // A staleness nag is worth saying once per scan age: if the user has been
  // told since that scan ran, it is acknowledged, not forgotten.
  const toldSinceScan = Number.isFinite(seenAt) && Number.isFinite(at) && seenAt >= at;
  const stale = isScanStale(at, days, now) && !toldSinceScan;
  const changed = Boolean(baseline) && fresh.length > 0;
  if (!days || (!stale && !changed)) return null;
  return {
    at: Number.isFinite(at) ? at : null,
    seenAt: Number.isFinite(seenAt) ? seenAt : null,
    count: current.length,
    fresh: fresh.length,
    stale,
    changed,
    signatures: current,
  };
}

/**
 * What the user has been told: `{ baseline, at, signatures }`. `baseline` is
 * true once anything has been acknowledged — including an empty address book,
 * so a duplicate that appears later is still recognisable as new.
 */
export async function readDigestState(api) {
  const stored = await api.storage.get(DIGEST_KEY);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return { baseline: false, at: null, signatures: [] };
  }
  const signatures = [...new Set((Array.isArray(stored.signatures) ? stored.signatures : [])
    .filter((signature) => typeof signature === 'string' && signature))];
  const at = Date.parse(String(stored.at ?? ''));
  return { baseline: true, at: Number.isFinite(at) ? at : null, signatures };
}

/**
 * Records what the user has now been told. An empty list is stored as an empty
 * baseline rather than dropped: "nothing to see" is information, and losing it
 * would make the next duplicate invisible.
 *
 * @returns {Promise<string[]>} the signatures that were stored
 */
export async function acknowledge(api, signatures, now = Date.now()) {
  const list = [...new Set((Array.isArray(signatures) ? signatures : [])
    .filter((signature) => typeof signature === 'string' && signature))]
    .sort()
    .slice(0, MAX_ACKNOWLEDGED);
  await api.storage.set(DIGEST_KEY, { at: new Date(now).toISOString(), signatures: list });
  return list;
}

/** Forgets the baseline, so the next look starts over. */
export async function forgetDigest(api) {
  await api.storage.remove(DIGEST_KEY);
}
