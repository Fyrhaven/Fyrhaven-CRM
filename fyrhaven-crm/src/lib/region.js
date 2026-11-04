// The default region for phone numbers, kept in api.storage.
//
// It is **not** a manifest setting on purpose: the settings schema in use here
// only has boolean and number fields, and inventing a string type would be
// assuming host behaviour this repo has already been burnt by (#75). Storage is
// verified, so the region lives there and the plugin's own UI sets it.
//
// Imports nothing, so both `contacts.js` (detection options) and
// `normalise.js` (the cleanup flow) can use it without a cycle.

export const REGION_KEY = 'normalizeRegion';

/** The stored region, or '' when the user has not chosen one. */
export async function readRegion(api) {
  const stored = await api.storage.get(REGION_KEY);
  return typeof stored === 'string' ? stored.trim().toUpperCase() : '';
}

/** Stores the region; an empty string clears it. */
export async function writeRegion(api, region) {
  const clean = String(region ?? '').trim().toUpperCase();
  if (clean) await api.storage.set(REGION_KEY, clean);
  else await api.storage.remove(REGION_KEY);
  return clean;
}
