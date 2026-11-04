// The normalisation rules engine (#20): the ordered, deterministic set of
// transformations the plugin may apply to names, organisations, phones and
// email addresses.
//
// Two kinds of rule, one order:
//   * **built-in** rules (`BUILTIN_RULES`) — a fixed catalogue, run in that
//     order whenever they are enabled;
//   * **user** rules — a literal find-and-replace on one field, run after the
//     built-ins, in the order the user arranged them.
//
// The order is a property of the *catalogue plus the stored list*, never of the
// iteration order of an object, so the same input always produces the same
// output. `planRules` returns the same plan shape `normalise.js` uses
// (`{ id, name, patch, before, changes }`), which is what lets a rules batch be
// applied and rolled back by the machinery that already exists.
//
// Pure — no api, no DOM — except `readRules` / `writeRules`, which are thin
// wrappers over api.storage.

import { contactName, text } from './contacts.js';
import { toE164 } from './phones.js';

export const RULES_KEY = 'normalizeRules';
export const MAX_USER_RULES = 25;
export const PREVIEW_CAP = 50;

// ── The catalogue ──────────────────────────────────────────────
// `field` is the field the rule works on; the order of this array is the order
// the built-ins run in.

export const BUILTIN_RULES = [
  { id: 'name.space', field: 'name' },
  { id: 'name.case', field: 'name' },
  { id: 'org.space', field: 'organization' },
  { id: 'org.case', field: 'organization' },
  { id: 'org.suffix', field: 'organization' },
  { id: 'phone.e164', field: 'phone' },
  { id: 'email.case', field: 'email' },
];

export const BUILTIN_IDS = BUILTIN_RULES.map((rule) => rule.id);
export const USER_FIELDS = ['name', 'organization', 'phone', 'email'];

const FIELD_PROPERTY = {
  name: 'name',
  organization: 'organizations',
  phone: 'phones',
  email: 'emails',
};

// ── The transforms ─────────────────────────────────────────────

/** Whitespace collapsed to single spaces, ends trimmed. */
const collapse = (value) => text(value).replace(/\s+/g, ' ');

/**
 * A word written entirely in capitals becomes Title Case; a word with any
 * lower-case letter is left exactly as it is. A genuine acronym written in
 * capitals is rewritten too — that is what "title case" means — and a
 * find-and-replace rule is the way to put one back.
 */
const titleWord = (word) => (word && word === word.toUpperCase()
  ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  : word);
const titleCase = (value) => collapse(value).split(' ').map(titleWord).join(' ');

/**
 * Legal forms a company name may end in. Only **trailing** tokens are dropped,
 * at most three of them, and the name can never be emptied: `Inc.` on its own
 * stays `Inc.`.
 */
export const LEGAL_SUFFIXES = new Set([
  'inc', 'incorporated', 'ltd', 'limited', 'llc', 'llp', 'plc',
  'corp', 'corporation', 'co', 'gmbh', 'ag', 'kg', 'ohg', 'ug',
  'bv', 'nv', 'sa', 'sas', 'sarl', 'srl', 'spa', 'oy', 'ab', 'aps',
  'pty', 'sdn', 'bhd',
]);

/** Conjunctions that join two legal forms: "GmbH & Co. KG", "Foo and Sons". */
const SUFFIX_JOINERS = new Set(['&', 'and', 'und']);

function stripLegalSuffix(value) {
  const clean = collapse(value);
  if (!clean) return clean;
  const tokens = clean.split(' ');
  let end = tokens.length;
  let dropped = 0;
  // Walk back over the legal forms — and the joiners between them — and stop at
  // the first token that is neither. The name can never be emptied.
  while (end - 1 >= 1 && dropped < 5) {
    const token = tokens[end - 1].toLowerCase().replace(/[.,]/g, '');
    if (!LEGAL_SUFFIXES.has(token) && !SUFFIX_JOINERS.has(token)) break;
    end -= 1;
    dropped += 1;
  }
  if (end === tokens.length) return clean;
  const kept = tokens.slice(0, end).join(' ').replace(/[\s,&]+$/, '');
  return kept || clean;
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const TRANSFORMS = {
  'name.space': (value) => collapse(value),
  'name.case': (value) => titleCase(value),
  'org.space': (value) => collapse(value),
  'org.case': (value) => titleCase(value),
  'org.suffix': (value) => stripLegalSuffix(value),
  // null means "could not normalise" — the value is left alone.
  'phone.e164': (value, region) => toE164(value, region) || null,
  'email.case': (value) => text(value).toLowerCase(),
};

/** The string transform of one rule, or null when the rule is not usable. */
function transformFor(rule, region) {
  if (rule?.builtin) {
    const transform = TRANSFORMS[rule.id];
    return transform ? (value) => transform(value, region) : null;
  }
  // The find text is used exactly as stored — a rule may legitimately want to
  // take a leading space with it (" GmbH" → "") — but it has to say something.
  const from = typeof rule?.from === 'string' ? rule.from : '';
  if (!from.trim()) return null;
  const pattern = new RegExp(escapeRegExp(from), 'gi');
  const to = String(rule?.to ?? '');
  // Case-insensitive on purpose: one rule for "ACME" covers acme, Acme and ACME.
  return (value) => value.replace(pattern, to);
}

// ── Reading and writing a field ────────────────────────────────

/** A map or array as `[key, value]` pairs, or null when it is neither. */
function mapEntries(source) {
  if (Array.isArray(source)) return source.map((value, index) => [String(index), value]);
  if (source && typeof source === 'object') return Object.entries(source);
  return null;
}

/** Rebuilds what `mapEntries` read, in the shape it arrived in. */
const shapeLike = (source, entries) => (Array.isArray(source)
  ? entries.map(([, value]) => value)
  : Object.fromEntries(entries));

/**
 * One field of a card with `transform` applied to each of its strings, or null
 * when nothing changed. The shape the host sent is the shape that comes back:
 * a `name` keeps its components, a map stays a map, an array stays an array.
 */
export function applyToField(card, field, transform) {
  const property = FIELD_PROPERTY[field];
  if (!property) return null;

  if (field === 'name') {
    const name = card?.name;
    if (!name || typeof name !== 'object') return null;
    const next = { ...name };
    let changed = false;
    const components = mapEntries(name.components);
    if (components && components.length) {
      next.components = shapeLike(name.components, components.map(([key, component]) => {
        const raw = text(component?.value);
        const replaced = transform(raw);
        const value = replaced === null || replaced === undefined ? raw : replaced;
        if (value !== raw) changed = true;
        return [key, { ...component, value }];
      }));
    }
    if (typeof name.full === 'string') {
      const replaced = transform(name.full);
      const value = replaced === null || replaced === undefined ? name.full : replaced;
      if (value !== name.full) changed = true;
      next.full = value;
    }
    return changed ? next : null;
  }

  const source = card?.[property];
  const entries = mapEntries(source);
  if (!entries || !entries.length) return null;
  const key = field === 'organization' ? 'name' : field === 'phone' ? 'number' : 'address';
  let changed = false;
  const mapped = entries.map(([index, entry]) => {
    const raw = typeof entry === 'string' ? entry : text(entry?.[key]);
    const replaced = transform(raw);
    const value = replaced === null || replaced === undefined ? raw : replaced;
    if (value !== raw) changed = true;
    return [index, typeof entry === 'string' ? value : { ...entry, [key]: value }];
  });
  return changed ? shapeLike(source, mapped) : null;
}

/** Every string a field holds, in the order `applyToField` walks them. */
function fieldStrings(source, field) {
  if (field === 'name') {
    if (!source || typeof source !== 'object') return [];
    const components = mapEntries(source.components) ?? [];
    return [
      ...components.map(([, component]) => text(component?.value)),
      ...(typeof source.full === 'string' ? [source.full] : []),
    ];
  }
  const key = field === 'organization' ? 'name' : field === 'phone' ? 'number' : 'address';
  return (mapEntries(source) ?? [])
    .map(([, entry]) => (typeof entry === 'string' ? entry : text(entry?.[key])));
}

/** The `{ from, to }` pairs one field changed by, index-aligned. */
function diffField(beforeSource, afterSource, field) {
  const before = fieldStrings(beforeSource, field);
  const after = fieldStrings(afterSource, field);
  const changes = [];
  for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
    const from = before[index] ?? '';
    const to = after[index] ?? '';
    if (from !== to) changes.push({ field, from, to });
  }
  return changes;
}

// ── The rules themselves ───────────────────────────────────────

/** A stable id for a new user rule. */
export function newRuleId(prefix = 'r') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Repairs a stored rule set: known built-ins (marked `builtin`), then usable
 * user rules (`{ id, field, from, to }` with a field and something to find),
 * de-duplicated by id and capped. Unknown junk is dropped.
 */
export function normalizeRules(raw) {
  const builtins = [];
  const user = [];
  const seen = new Set();
  for (const item of Array.isArray(raw) ? raw : []) {
    const id = text(item?.id);
    if (!id || seen.has(id)) continue;
    if (BUILTIN_IDS.includes(id)) {
      seen.add(id);
      builtins.push({ id, field: BUILTIN_RULES.find((rule) => rule.id === id).field, builtin: true });
      continue;
    }
    const field = USER_FIELDS.includes(item?.field) ? item.field : '';
    const from = typeof item?.from === 'string' ? item.from : '';
    if (!field || !from.trim()) continue;
    seen.add(id);
    user.push({ id, field, from, to: String(item?.to ?? '') });
  }
  return [...builtins, ...user.slice(0, MAX_USER_RULES)];
}

/**
 * The rules in the order they run: the enabled built-ins in catalogue order,
 * then the user rules in the order they were stored. This is the only place
 * that decides the order.
 */
export function orderedRules(raw) {
  const rules = normalizeRules(raw);
  const enabled = new Set(rules.filter((rule) => rule.builtin).map((rule) => rule.id));
  return [
    ...BUILTIN_RULES.filter((rule) => enabled.has(rule.id)).map((rule) => ({ ...rule, builtin: true })),
    ...rules.filter((rule) => !rule.builtin),
  ];
}


// ── Applying the rules to a card ───────────────────────────────

/**
 * What the rules would change for one contact, or null when nothing would.
 *
 * The patch carries the **complete** new value for a field (the host replaces a
 * map wholesale), and `before` holds what is about to be replaced — the same
 * contract `normalise.js` uses, so one undo covers a cleanup and a rules batch
 * alike.
 *
 * @param {object} card
 * @param {Array} rules normalised rules, or a raw stored list (ordered here)
 * @param {{region?: string}} options
 * @returns {{id, name, patch, before, changes}|null}
 */
export function ruleChangesForCard(card, rules, { region = '' } = {}) {
  const active = orderedRules(rules);
  if (!card?.id || !active.length) return null;

  const before = {};
  const patch = {};
  for (const rule of active) {
    const transform = transformFor(rule, region);
    if (!transform) continue;
    const property = FIELD_PROPERTY[rule.field];
    const current = property in patch ? patch[property] : card[property];
    const next = applyToField({ ...card, [property]: current }, rule.field, transform);
    if (!next) continue;
    if (!(property in before)) before[property] = structuredClone(card[property] ?? null);
    patch[property] = next;
  }
  if (!Object.keys(patch).length) return null;

  const changes = [];
  for (const field of USER_FIELDS) {
    const property = FIELD_PROPERTY[field];
    if (!(property in patch)) continue;
    changes.push(...diffField(card[property], patch[property], field));
  }
  if (!changes.length) return null;
  return { id: card.id, name: contactName(card) || card.id, patch, before, changes };
}

/**
 * The card with the rules applied — what an import or an editor save writes.
 * A card the rules do not change comes back as it was, so a caller can always
 * write the result.
 */
export function applyRulesToCard(card, rules, options = {}) {
  const plan = ruleChangesForCard(card, rules, options);
  return plan ? { ...card, ...plan.patch } : card;
}

/** The contacts the rules would change, in list order. */
export function planRules(cards, rules, options = {}) {
  return (Array.isArray(cards) ? cards : [])
    .map((card) => (card?.id ? ruleChangesForCard(card, rules, options) : null))
    .filter(Boolean);
}

/** What a rules plan would touch, for a summary line. */
export function ruleCounts(plan) {
  const items = Array.isArray(plan) ? plan : [];
  return {
    contacts: items.length,
    changes: items.reduce((total, item) => total + item.changes.length, 0),
    byField: USER_FIELDS.reduce((counts, field) => {
      counts[field] = items.reduce(
        (total, item) => total + item.changes.filter((change) => change.field === field).length,
        0,
      );
      return counts;
    }, {}),
  };
}

// ── Storage ────────────────────────────────────────────────────

/** The rules, repaired. Rewrites storage when it dropped junk. */
export async function readRules(api) {
  const stored = await api.storage.get(RULES_KEY);
  const list = Array.isArray(stored) ? stored : [];
  const rules = normalizeRules(list);
  if (rules.length !== list.length) {
    if (rules.length) await api.storage.set(RULES_KEY, rules);
    else await api.storage.remove(RULES_KEY);
  }
  return rules;
}

/** Stores the rules; an empty set is removed rather than written. */
export async function writeRules(api, rules) {
  const clean = normalizeRules(rules);
  if (clean.length) await api.storage.set(RULES_KEY, clean);
  else await api.storage.remove(RULES_KEY);
  return clean;
}

/** Whether anything would run at all — the gate the editor and import ask. */
export const hasRules = (rules) => orderedRules(rules).length > 0;

