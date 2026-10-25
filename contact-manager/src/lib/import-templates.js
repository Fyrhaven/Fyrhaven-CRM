// Remembered column mappings, so a file exported by the same service twice does
// not have to be mapped twice.
//
// Pure model plus api.storage; no DOM. Kept per browser, like the other local
// state, and keyed by the header row rather than by file name — the same
// service writes the same headers, whatever the file is called.

import { mappingKey } from './import-fields.js';

export const TEMPLATES_KEY = 'importMappings';
export const MAX_TEMPLATES = 20;

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** Repairs a stored list: keyed, with a mapping, de-duplicated by key. */
export function normalizeTemplates(raw) {
  const byKey = new Map();
  for (const item of Array.isArray(raw) ? raw : []) {
    const key = text(item?.key);
    const mapping = Array.isArray(item?.mapping) ? item.mapping.map(text) : [];
    if (!key || !mapping.length) continue;
    if (!byKey.has(key)) byKey.set(key, { key, headers: (item.headers ?? []).map(text), mapping });
  }
  return [...byKey.values()].slice(-MAX_TEMPLATES);
}

/** The remembered mappings, repaired. */
export async function readTemplates(api) {
  const stored = await api.storage.get(TEMPLATES_KEY);
  const list = Array.isArray(stored) ? stored : [];
  const templates = normalizeTemplates(list);
  if (templates.length !== list.length) {
    if (templates.length) await api.storage.set(TEMPLATES_KEY, templates);
    else await api.storage.remove(TEMPLATES_KEY);
  }
  return templates;
}

/** The mapping remembered for a header row, or `null`. */
export async function findTemplate(api, headers) {
  const wanted = mappingKey(headers);
  return (await readTemplates(api)).find((template) => template.key === wanted) ?? null;
}

/** Remembers one mapping; a header row already known is replaced. */
export async function saveTemplate(api, headers, mapping) {
  const key = mappingKey(headers);
  if (!key || !Array.isArray(mapping) || !mapping.length) return readTemplates(api);
  const templates = await readTemplates(api);
  const next = [
    ...templates.filter((template) => template.key !== key),
    { key, headers: (headers ?? []).map(text), mapping: mapping.map(text) },
  ].slice(-MAX_TEMPLATES);
  await api.storage.set(TEMPLATES_KEY, next);
  return next;
}

/** Forgets one mapping; returns what is left. */
export async function deleteTemplate(api, key) {
  const next = (await readTemplates(api)).filter((template) => template.key !== text(key));
  if (next.length) await api.storage.set(TEMPLATES_KEY, next);
  else await api.storage.remove(TEMPLATES_KEY);
  return next;
}
