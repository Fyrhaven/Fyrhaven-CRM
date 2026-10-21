// Undo for merges. A merge deletes contacts, so every merge leaves a
// short-lived, size-bounded undo record in api.storage: the removed cards in
// full plus the kept contact's original values for the fields the merge
// changed. This is the one deliberate exception to "never cache contacts"
// and its retention policy is explicit:
//   * records live for the `undoMinutes` setting (0 turns undo off),
//   * at most MAX_CARDS removed cards / MAX_BYTES of JSON are kept — older
//     records are evicted first, a single merge that is too big is not kept,
//   * expired records are purged on every read, on activate and on undo,
//   * the page shows the retained records, and undo deletes them.
// Pure functions plus api.storage / api.contacts calls; no DOM.

export const UNDO_KEY = 'undoBatches';
export const DEFAULT_UNDO_MINUTES = 15;
export const MAX_UNDO_MINUTES = 1440;
export const MAX_CARDS = 100;
export const MAX_BYTES = 400_000;

/** The retention window in ms from settings; 0 when undo is off. */
export function undoWindowMs(settings) {
  const raw = settings?.undoMinutes;
  const minutes = typeof raw === 'number' && Number.isFinite(raw) ? raw : DEFAULT_UNDO_MINUTES;
  return Math.round(Math.min(Math.max(minutes, 0), MAX_UNDO_MINUTES) * 60_000);
}

const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

/**
 * One undo entry for a finished group merge: `keptId`, `before` (original
 * values of the patched fields that existed), `absent` (patched fields the
 * kept contact did not have — undo clears them), and `removed` (the deleted
 * cards, as they were scanned).
 */
export function buildEntry(plan, removedCards) {
  const before = {};
  const absent = [];
  for (const field of Object.keys(plan.patch ?? {})) {
    if (plan.primary[field] === undefined) absent.push(field);
    else before[field] = structuredClone(plan.primary[field]);
  }
  return { keptId: plan.primary.id, before, absent, removed: structuredClone(removedCards) };
}

const sizeOf = (value) => JSON.stringify(value).length;
const cardCount = (batches) => batches.reduce((n, b) => n + b.entries.reduce((m, e) => m + e.removed.length, 0), 0);

/** Drops the oldest batches until the store fits the limits. */
export function enforceLimits(batches) {
  const list = [...batches];
  while (list.length && (cardCount(list) > MAX_CARDS || sizeOf(list) > MAX_BYTES)) list.shift();
  return list;
}

/** Valid, unexpired batches from storage; rewrites storage when it purged any. */
export async function readUndo(api, now = Date.now()) {
  const stored = await api.storage.get(UNDO_KEY);
  const all = Array.isArray(stored) ? stored : [];
  const live = all.filter((b) => isPlainObject(b) && typeof b.expiresAt === 'number'
    && b.expiresAt > now && Array.isArray(b.entries) && b.entries.length);
  if (live.length !== all.length) {
    if (live.length) await api.storage.set(UNDO_KEY, live);
    else await api.storage.remove(UNDO_KEY);
  }
  return live;
}

/** Deletes expired records; returns how many batches remain. */
export async function purgeUndo(api, now = Date.now()) {
  return (await readUndo(api, now)).length;
}

/**
 * Stores the entries of one merge run as a new batch. Returns how many
 * entries were kept (0 when undo is off, there was nothing to keep or the
 * run is bigger than the size limits).
 */
export async function saveUndo(api, entries, now = Date.now()) {
  const windowMs = undoWindowMs(api.plugin?.settings);
  const useful = (entries ?? []).filter((e) => e.removed.length);
  if (!windowMs || !useful.length) {
    await purgeUndo(api, now);
    return 0;
  }
  const batch = { at: now, expiresAt: now + windowMs, entries: useful };
  if (cardCount([batch]) > MAX_CARDS || sizeOf([batch]) > MAX_BYTES) {
    await purgeUndo(api, now);
    return 0;
  }
  const kept = enforceLimits([...(await readUndo(api, now)), batch]);
  await api.storage.set(UNDO_KEY, kept);
  return useful.length;
}

/** Removes every undo record. */
export async function clearUndo(api) {
  await api.storage.remove(UNDO_KEY);
}


// What the host assigns itself must not be sent back when re-creating a card.
const SERVER_FIELDS = ['id', 'created', 'updated'];

/**
 * Undoes the newest batch: re-creates every removed card, then — only when
 * all of an entry's cards are back — reverts the kept contact. Entries that
 * fail stay in storage so the undo can be retried.
 * Returns `{ restored, reverted, failed, total }`; `total` is the number of
 * removed cards the batch held (0 when there was nothing to undo). `failed`
 * counts cards that could not be created plus kept contacts that could not
 * be reverted.
 */
export async function undoLastMerge(api, now = Date.now()) {
  const batches = await readUndo(api, now);
  const batch = batches.at(-1);
  if (!batch) return { restored: 0, reverted: 0, failed: 0, total: 0 };

  let restored = 0;
  let reverted = 0;
  let failed = 0;
  const leftover = [];
  for (const entry of batch.entries) {
    const stillRemoved = [];
    for (const card of entry.removed) {
      const copy = { ...card };
      for (const field of SERVER_FIELDS) delete copy[field];
      try {
        await api.contacts.create(copy);
        restored += 1;
      } catch {
        stillRemoved.push(card);
        failed += 1;
      }
    }
    let needsRevert = true;
    if (!stillRemoved.length) {
      const patch = { ...entry.before };
      for (const field of entry.absent) patch[field] = undefined;
      try {
        if (Object.keys(patch).length) await api.contacts.update(entry.keptId, patch);
        reverted += 1;
        needsRevert = false;
      } catch {
        failed += 1;
      }
    }
    if (stillRemoved.length || needsRevert) leftover.push({ ...entry, removed: stillRemoved });
  }

  const rest = batches.slice(0, -1);
  if (leftover.length) rest.push({ ...batch, entries: leftover });
  if (rest.length) await api.storage.set(UNDO_KEY, rest);
  else await api.storage.remove(UNDO_KEY);
  return { restored, reverted, failed, total: batch.entries.reduce((n, e) => n + e.removed.length, 0) };
}
