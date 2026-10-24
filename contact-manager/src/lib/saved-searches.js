// Saved searches: the queries a user wants to come back to, kept in
// api.storage — per account *and* per browser, like the projects. They do not
// sync between devices, and the UI says so.
//
// Pure model plus api.storage; no DOM.

export const SAVED_KEY = 'savedSearches';
export const MAX_SAVED = 20;

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** Repairs a stored list: named, non-empty queries, de-duplicated by name. */
export function normalizeSaved(raw) {
  const byName = new Map();
  for (const item of Array.isArray(raw) ? raw : []) {
    const name = text(item?.name);
    const query = text(item?.query);
    if (!name || !query) continue;
    // The first record with a name wins; a later duplicate is corruption.
    if (!byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), { name, query });
  }
  return [...byName.values()].slice(0, MAX_SAVED);
}

/** The saved searches, repaired. Rewrites storage when it dropped junk. */
export async function readSaved(api) {
  const stored = await api.storage.get(SAVED_KEY);
  const list = Array.isArray(stored) ? stored : [];
  const saved = normalizeSaved(list);
  if (saved.length !== list.length) {
    if (saved.length) await api.storage.set(SAVED_KEY, saved);
    else await api.storage.remove(SAVED_KEY);
  }
  return saved;
}

/** Saves one search; a name that already exists is replaced. */
export async function saveSearch(api, name, query) {
  const cleanName = text(name);
  const cleanQuery = text(query);
  if (!cleanName || !cleanQuery) return readSaved(api);
  const saved = await readSaved(api);
  const next = [
    ...saved.filter((entry) => entry.name.toLowerCase() !== cleanName.toLowerCase()),
    { name: cleanName, query: cleanQuery },
  ].slice(-MAX_SAVED);
  await api.storage.set(SAVED_KEY, next);
  return next;
}

/** Drops one saved search by name; returns what is left. */
export async function deleteSaved(api, name) {
  const wanted = text(name).toLowerCase();
  const next = (await readSaved(api)).filter((entry) => entry.name.toLowerCase() !== wanted);
  if (next.length) await api.storage.set(SAVED_KEY, next);
  else await api.storage.remove(SAVED_KEY);
  return next;
}
