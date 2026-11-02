// The change history (#25, the local half): what **this plugin** wrote.
//
// It is deliberately not an audit log of the address book — a plugin cannot see
// who else changed a contact, and pretending otherwise would be a lie in a
// compliance surface. What it can say honestly is what *it* did: which task,
// when, and how many contacts it touched. That is what makes a bulk change
// explainable after the toast has gone.
//
// Kept in api.storage — per account *and* per browser, like the projects and the
// saved searches — capped, and repaired on read. Pure plus api.storage; no DOM.

export const HISTORY_KEY = 'changeHistory';
export const MAX_HISTORY = 100;
const MAX_DETAIL = 120;

/**
 * The kinds of write the plugin makes. `undoable` marks the ones that leave a
 * rollback behind (a merge record, a cleanup/rules record, a delete batch).
 */
export const HISTORY_KINDS = [
  'merge', 'cleanup', 'rules', 'import', 'bulk',
  'create', 'update', 'delete', 'group',
  'consent', 'anonymise', 'erase',
];

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const count = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/** One entry, repaired; null when it cannot be used at all. */
export function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const kind = HISTORY_KINDS.includes(raw.kind) ? raw.kind : '';
  const contacts = count(raw.contacts);
  if (!kind || !contacts) return null;
  // `subject` names the contact a single-subject change was about (a consent
  // record, an anonymisation, an erasure) so a data-subject request can pull
  // the plugin's own changes for that person. It is absent on batch writes.
  const subject = text(raw.subject).slice(0, 120);
  return {
    at: Number.isFinite(Number(raw.at)) ? Number(raw.at) : 0,
    kind,
    contacts,
    detail: text(raw.detail).slice(0, MAX_DETAIL),
    undoable: raw.undoable === true,
    ...(subject ? { subject } : {}),
  };
}

/** Newest first, repaired, capped. */
export function normalizeHistory(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map(normalizeEntry)
    .filter(Boolean)
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_HISTORY);
}

/** The history, repaired. Rewrites storage when it dropped junk. */
export async function readHistory(api) {
  const stored = await api.storage.get(HISTORY_KEY);
  const list = Array.isArray(stored) ? stored : [];
  const entries = normalizeHistory(list);
  if (entries.length !== list.length) {
    if (entries.length) await api.storage.set(HISTORY_KEY, entries);
    else await api.storage.remove(HISTORY_KEY);
  }
  return entries;
}

/**
 * Records one write at the front of the history. Never throws at its caller:
 * the history is a record *of* a change, and a change that was made must not be
 * reported as failed because the note about it could not be written.
 */
export async function recordHistory(api, entry, now = Date.now()) {
  const clean = normalizeEntry({ ...entry, at: now });
  if (!clean) return null;
  try {
    const kept = normalizeHistory([clean, ...(await readHistory(api))]);
    await api.storage.set(HISTORY_KEY, kept);
    return clean;
  } catch {
    return null;
  }
}

/** Empties the history. */
export async function clearHistory(api) {
  await api.storage.remove(HISTORY_KEY);
}

/** How much was written, by kind — the summary line above the list. */
export function historyCounts(entries) {
  const byKind = {};
  let contacts = 0;
  for (const entry of normalizeHistory(entries)) {
    byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
    contacts += entry.contacts;
  }
  return { entries: normalizeHistory(entries).length, contacts, byKind };
}
