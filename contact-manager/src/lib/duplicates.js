// Finding duplicate contacts and planning merges. The detection and merge
// planning are pure functions over plain cards (unit tests drive them
// directly); only readDismissed/writeDismissed and mergeGroups touch the api.
//
// Detection builds a key per contact (email / phone / name), unions every
// pair of contacts that share a key (union-find), and reports each connected
// component of two or more contacts as a group:
//   - shared email address or phone number  → strength 'strong'
//   - shared (normalised) name              → strength 'possible'
// One strong key anywhere in a component makes the whole group 'strong';
// the reasons list shows exactly which keys matched.

import { contactName, emailEntries, isMergeable, phoneEntries, primaryEmail } from './contacts.js';
import { phoneKey } from './phones.js';

const text = (value) => (typeof value === 'string' ? value.trim() : '');

// ── Normalisation ──────────────────────────────────────────────

/** Lower-cased, trimmed address for comparisons: `  A@B.de ` → `a@b.de`. */
export function normalizeEmail(address) {
  return text(address).toLowerCase();
}

/**
 * The comparison key for a phone number. With a region it is the E.164 digits,
 * so `0176 1234567` and `+49 176 1234567` agree; without one it is digits with
 * a leading `00` dropped, so `+49 …` and `0049 …` still agree. Under 7 digits
 * counts as no number (extensions, years).
 */
export function normalizePhone(number, region = '') {
  return phoneKey(number, region);
}

/**
 * Case- and diacritic-insensitive name for comparisons; punctuation becomes
 * spaces and tokens are sorted, so "Doe, John" matches "John Doe". Letters of
 * any script survive (`\p{L}`), so non-Latin names never collapse to ''.
 */
export function normalizeName(value) {
  const base = String(value ?? '').normalize('NFKD').toLowerCase().trim();
  const noMarks = base.replace(/\p{M}/gu, '');
  return noMarks.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function tokens(value) {
  const normalized = normalizeName(value);
  return normalized ? normalized.split(' ').sort() : [];
}

/** Sorted-token key of the contact's full name, or ''. */
export function nameKey(card) {
  return tokens(contactName(card)).join(' ');
}

/**
 * Like nameKey but without single-letter tokens, so initials do not hide a
 * match: "John A. Smith" ≡ "John Smith". '' when fewer than two substantial
 * tokens remain — one word is too weak to match on.
 */
export function coreNameKey(card) {
  const substantial = tokens(contactName(card)).filter((token) => token.length >= 2);
  return substantial.length >= 2 ? substantial.join(' ') : '';
}

// ── Keys of one card ───────────────────────────────────────────

/**
 * The match keys of a card as `{ email: [...], phone: [...], name: [...],
 * core: [...] }`, each already normalised and filtered by `opts`
 * (a strategy set to false contributes nothing; missing opts means on).
 */
export function cardKeys(card, opts = {}) {
  const email = opts.matchByEmail === false
    ? []
    : [...new Set(emailEntries(card).map((e) => normalizeEmail(e.address)).filter(Boolean))];
  const phone = opts.matchByPhone === false
    ? []
    : [...new Set(phoneEntries(card).map((p) => normalizePhone(p.number, opts.region)).filter(Boolean))];
  let name = [];
  let core = [];
  if (opts.matchByName !== false) {
    const full = nameKey(card);
    const coreOnly = coreNameKey(card);
    if (full) name = [full];
    if (coreOnly) core = [coreOnly];
  }
  return { email, phone, name, core };
}

function prefixedKeys(card, opts) {
  const keys = cardKeys(card, opts);
  return [
    ...keys.email.map((v) => ['e:', v]),
    ...keys.phone.map((v) => ['p:', v]),
    ...keys.name.map((v) => ['n:', v]),
    ...keys.core.map((v) => ['c:', v]),
  ];
}

const isStrongKey = (prefix) => prefix === 'e:' || prefix === 'p:';
const reasonType = (prefix) => (prefix === 'e:' ? 'email' : prefix === 'p:' ? 'phone' : 'name');

function signatureOf(members) {
  return `g:${members.map((m) => m.id).slice().sort().join(',')}`;
}

/**
 * One group for a hand-picked set of contacts, so a manual selection can go
 * through the same review dialog as a detected duplicate group — the keep
 * selector, the conflict resolution, the danger confirm and the undo all come
 * with it. `strength` is `'manual'`: the plugin matched nothing here, the user
 * chose these contacts, so the group claims no evidence.
 */
export function groupFromSelection(cards) {
  const members = (Array.isArray(cards) ? cards : []).filter((card) => card && card.id);
  return { signature: signatureOf(members), strength: 'manual', reasons: [], members };
}

// ── Grouping ───────────────────────────────────────────────────

/**
 * Duplicate groups over `cards`: `[{ signature, strength, reasons, members }]`
 * with `strength` 'strong' | 'possible', `reasons` `[{ type, value }]` where
 * type is 'email' | 'phone' | 'name', and members in the order of `cards`.
 * `signature` identifies the set of contacts (for hiding groups); groups in
 * `dismissed` are left out. Sorted strong first, then biggest, then by name.
 */
export function findDuplicateGroups(cards, opts = {}, dismissed = []) {
  const list = (Array.isArray(cards) ? cards : []).filter(isMergeable);
  const parent = list.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  const keysByCard = list.map((card) => prefixedKeys(card, opts));
  const owner = new Map(); // 'e:a@b.c' → first card index
  keysByCard.forEach((keys, i) => {
    for (const [prefix, value] of keys) {
      const key = prefix + value;
      if (owner.has(key)) union(i, owner.get(key));
      else owner.set(key, i);
    }
  });

  const components = new Map();
  keysByCard.forEach((_, i) => {
    const root = find(i);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(i);
  });

  const hidden = new Set(dismissed.filter((s) => typeof s === 'string'));
  const groups = [];
  for (const indices of components.values()) {
    if (indices.length < 2) continue;
    const members = indices.slice().sort((a, b) => a - b).map((i) => list[i]);
    const signature = signatureOf(members);
    if (hidden.has(signature)) continue;

    // Which keys do at least two members of this group share?
    const positionsByKey = new Map();
    indices.forEach((cardIndex, position) => {
      for (const [prefix, value] of keysByCard[cardIndex]) {
        const key = prefix + value;
        if (!positionsByKey.has(key)) positionsByKey.set(key, new Set());
        positionsByKey.get(key).add(position);
      }
    });

    const reasons = [];
    let strong = false;
    for (const [key, positions] of positionsByKey) {
      if (positions.size < 2) continue;
      const prefix = key.slice(0, 2);
      const value = key.slice(2);
      if (isStrongKey(prefix)) strong = true;
      const type = reasonType(prefix);
      if (!reasons.some((r) => r.type === type && r.value === value)) reasons.push({ type, value });
    }
    if (!reasons.length) continue;
    groups.push({ signature, strength: strong ? 'strong' : 'possible', reasons, members });
  }

  return groups.sort((a, b) => {
    if (a.strength !== b.strength) return a.strength === 'strong' ? -1 : 1;
    if (b.members.length !== a.members.length) return b.members.length - a.members.length;
    return contactName(a.members[0]).localeCompare(contactName(b.members[0]));
  });
}

// ── Merge planning ─────────────────────────────────────────────

/**
 * Donor names that differ from the kept contact's name and are not already a
 * nickname of it — the names a merge can preserve as nicknames (`#49`).
 * `[{ value, key, fromId }]`, de-duplicated by normalised name, in member
 * order. An email address is never a name, so a nameless card is skipped.
 */
export function nameSuggestions(primary, others) {
  if (!primary) return [];
  const keptKey = normalizeName(contactName(primary));
  const taken = new Set(Object.values(primary.nicknames ?? {})
    .map((entry) => normalizeName(entry?.name)).filter(Boolean));
  const out = [];
  for (const other of others ?? []) {
    const value = contactName(other);
    const key = normalizeName(value);
    if (!value || value.includes('@') || !key) continue;
    if (key === keptKey || taken.has(key)) continue;
    taken.add(key);
    out.push({ value, key, fromId: other.id });
  }
  return out;
}

function addressKey(value) {
  if (!value || typeof value !== 'object') return '';
  const full = text(value.full || value.fullAddress);
  if (full) return normalizeName(full);
  const components = Array.isArray(value.components) ? value.components.map((c) => text(c?.value)).join(' ') : '';
  const flat = [value.street, value.locality, value.region, value.postcode, value.country].map(text).join(' ');
  return normalizeName(components || flat);
}

/** Maps whose entries are unioned into the kept contact when new. */
const UNION_FIELDS = [
  ['emails', (entry) => normalizeEmail(entry?.address)],
  ['phones', (entry) => normalizePhone(entry?.number ?? entry?.phone ?? entry?.value)],
  ['addresses', addressKey],
  ['onlineServices', (entry) => text(entry?.uri || entry?.service || entry?.user).toLowerCase()],
  ['links', (entry) => text(entry?.uri).toLowerCase()],
  ['nicknames', (entry) => normalizeName(entry?.name)],
  ['notes', (entry) => text(entry?.note)],
  ['anniversaries', (entry) => `${entry?.kind ?? ''}:${JSON.stringify(entry?.date ?? '')}`],
];

/** Object fields the kept contact gets once, when it has none itself. */
const FILL_FIELDS = ['name', 'organizations', 'titles', 'personalInfo', 'media'];

/** Fields counted when picking the contact to keep. */
const SCORE_FIELDS = [
  'emails', 'phones', 'addresses', 'name', 'organizations', 'titles', 'notes',
  'anniversaries', 'onlineServices', 'links', 'nicknames', 'personalInfo', 'media',
];

function populated(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function createdTime(card) {
  const time = Date.parse(card?.created ?? '');
  return Number.isNaN(time) ? null : time;
}

/**
 * The member to keep: most populated fields wins; ties go to the oldest
 * `created`, then to the lowest id — always deterministic.
 */
export function pickPrimary(members) {
  const score = (card) => SCORE_FIELDS.filter((field) => populated(card[field])).length;
  return members.slice().sort((a, b) => {
    const byScore = score(b) - score(a);
    if (byScore) return byScore;
    const aCreated = createdTime(a);
    const bCreated = createdTime(b);
    if (aCreated !== bCreated) {
      if (aCreated === null) return 1;
      if (bCreated === null) return -1;
      return aCreated - bCreated;
    }
    return String(a.id).localeCompare(String(b.id));
  })[0];
}

/**
 * What a merge does for one group: `{ primary, others, patch, added, changed }`.
 * `keepId` overrides the automatic choice (the review dialog's selector).
 * `choices` resolves field conflicts: `{ [field]: donorId }` replaces the kept
 * contact's value for a single-value field (`name`, `organizations`, `titles`,
 * `personalInfo`, `media`) with that donor's value.
 * `patch` is a partial JSContact card for api.contacts.update: an omitted
 * key keeps its value, `undefined` would clear one — so the patch only holds
 * keys that actually change, and map fields are complete unions (the host
 * replaces a map wholesale). New entries get collision-free keys next to the
 * kept contact's own. Never touches uid/created/updated/addressBookIds/
 * cryptoKeys or any client-only field.
 * `added` lists everything the merge brings in — `[{ field, value, fromId }]`,
 * in the order it would appear — so the UI can show a preview.
 * `changed` lists the conflicting fields the user chose to replace —
 * `[{ field, value, fromId }]`.
 * `nameSuggestions` lists the donor names that differ from the kept name and
 * are therefore offered as nicknames — `[{ value, key, fromId }]`; the patch
 * adds every one the user did not drop (`choices.nicknames[key] = 'drop'`).
 */
export function planMerge(group, keepId, choices = {}) {
  const members = (group?.members ?? []).filter(isMergeable);
  const primary = (keepId && members.find((m) => m.id === keepId)) || pickPrimary(members) || null;
  const others = members.filter((m) => m !== primary && m.id !== primary?.id);
  const patch = {};
  const added = [];
  const changed = [];
  if (!primary) return { primary: null, others: [], patch, added, changed, nameSuggestions: [] };

  for (const [field, normalize] of UNION_FIELDS) {
    const out = { ...(primary[field] ?? {}) };
    const seen = new Set(Object.values(out).map(normalize).filter(Boolean));
    let changed = false;
    for (const other of others) {
      for (const [key, entry] of Object.entries(other[field] ?? {})) {
        const norm = normalize(entry);
        if (norm && seen.has(norm)) continue;
        let newKey = String(key);
        for (let n = 2; newKey in out; n += 1) newKey = `${key}-${n}`;
        out[newKey] = entry;
        changed = true;
        added.push({ field, value: entry, fromId: other.id });
        if (norm) seen.add(norm);
      }
    }
    if (changed) patch[field] = out;
  }

  // keywords is a plain { name: boolean } map, not keyed entries.
  const keywords = { ...(primary.keywords ?? {}) };
  let keywordsChanged = false;
  for (const other of others) {
    for (const [key, on] of Object.entries(other.keywords ?? {})) {
      if (!(key in keywords)) {
        keywords[key] = Boolean(on);
        keywordsChanged = true;
        added.push({ field: 'keywords', value: key, fromId: other.id });
      }
    }
  }
  if (keywordsChanged) patch.keywords = keywords;

  for (const field of FILL_FIELDS) {
    if (populated(primary[field])) continue;
    const donor = others.find((m) => populated(m[field]));
    if (donor) {
      patch[field] = donor[field];
      added.push({ field, value: donor[field], fromId: donor.id });
    }
  }

  // Explicit field choices: replace the kept contact's value with a donor's.
  // The whole field is replaced (the host replaces maps wholesale), which is
  // exactly what the review dialog's value picker promises.
  for (const field of FILL_FIELDS) {
    const donorId = choices?.[field];
    if (!donorId || donorId === primary.id) continue;
    const donor = others.find((m) => m.id === donorId && populated(m[field]));
    if (!donor) continue;
    patch[field] = donor[field];
    changed.push({ field, value: donor[field], fromId: donor.id });
    // A field can no longer be both "added" (filled) and "changed".
    for (let i = added.length - 1; i >= 0; i -= 1) {
      if (added[i].field === field) added.splice(i, 1);
    }
  }

  // Different names: keep each donor name as a nickname unless the user
  // chose to discard it, so a merge never silently loses a name (#49).
  // `choices.nicknames[key]` is 'nickname' (the default) or 'drop'; 'name'
  // means the dialog reused the name as the kept contact's name instead.
  const suggestions = nameSuggestions(primary, others);
  const finalNameKey = normalizeName(contactName({ name: patch.name ?? primary.name }));
  for (const suggestion of suggestions) {
    if (suggestion.key === finalNameKey) continue; // already the contact's name
    if (choices?.nicknames?.[suggestion.key] !== undefined
      && choices.nicknames[suggestion.key] !== 'nickname') continue;
    const out = { ...(patch.nicknames ?? primary.nicknames ?? {}) };
    const taken = new Set(Object.values(out).map((entry) => normalizeName(entry?.name)).filter(Boolean));
    if (taken.has(suggestion.key)) continue;
    let newKey = 'nickname';
    for (let n = 2; newKey in out; n += 1) newKey = `nickname-${n}`;
    out[newKey] = { name: suggestion.value };
    patch.nicknames = out;
    added.push({ field: 'nicknames', value: { name: suggestion.value }, fromId: suggestion.fromId });
  }

  return { primary, others, patch, added, changed, nameSuggestions: suggestions };
}

// ── Merging for real ───────────────────────────────────────────

/**
 * Runs the merges in order: patch the kept contact first — if that fails the
 * group is skipped, so no contact is deleted without its details being kept —
 * then delete the others one by one, collecting ids that failed.
 * `keepBySignature` maps group signatures to the chosen member id.
 * `choiceBySignature` maps group signatures to `{ [field]: donorId }`
 * conflict resolutions from the dialog.
 * Returns `{ merged, removed, failed: [id, …] }`.
 * When passed a `journal` array, each group that really changed gets one
 * entry describing the patch and the cards that were deleted, so the caller
 * can offer an undo (see lib/undo.js).
 */
export async function mergeGroups(api, groups, keepBySignature = {}, choiceBySignature = {}, journal = null) {
  let merged = 0;
  let removed = 0;
  const failed = [];
  for (const group of groups) {
    if (!group || !Array.isArray(group.members) || group.members.length < 2) continue;
    const plan = planMerge(group, keepBySignature[group.signature], choiceBySignature[group.signature]);
    if (!plan.primary || !plan.others.length) continue;
    if (Object.keys(plan.patch).length) {
      try {
        await api.contacts.update(plan.primary.id, plan.patch);
      } catch {
        failed.push(...plan.others.map((o) => o.id));
        continue;
      }
    }
    merged += 1;
    const gone = [];
    for (const other of plan.others) {
      try {
        await api.contacts.remove(other.id);
        removed += 1;
        gone.push(other);
      } catch {
        failed.push(other.id);
      }
    }
    if (journal && gone.length) journal.push({ plan, removedCards: gone });
  }
  return { merged, removed, failed };
}

// ── Hidden groups and scan results (api.storage) ───────────────

export const DISMISSED_KEY = 'dismissedGroups';
export const LAST_SCAN_KEY = 'lastScan';

/** Signatures of the groups the user hid, from api.storage. */
export async function readDismissed(api) {
  const stored = await api.storage.get(DISMISSED_KEY);
  return Array.isArray(stored) ? stored.filter((s) => typeof s === 'string') : [];
}

export async function writeDismissed(api, signatures) {
  await api.storage.set(DISMISSED_KEY, [...new Set(signatures.filter((s) => typeof s === 'string'))]);
}

// ── The group around one contact (contact details section) ─────

/**
 * The duplicate group `contact` belongs to, found with api.contacts.search:
 * candidates sharing a normalised email, phone or name key with the contact,
 * then grouped among themselves. `null` when there is none.
 */
export async function findGroupFor(api, contact, opts = {}) {
  if (!isMergeable(contact)) return null;
  const queries = [];
  const email = primaryEmail(contact);
  if (email) queries.push(email);
  const name = contactName(contact);
  if (name && !name.includes('@')) queries.push(name);

  const ownKeys = new Set(prefixedKeys(contact, opts).map(([prefix, value]) => prefix + value));
  if (!ownKeys.size) return null;

  const seen = new Set(contact.id ? [contact.id] : []);
  const related = [];
  for (const query of queries.slice(0, 2)) {
    let found = [];
    try {
      found = await api.contacts.search(query);
    } catch {
      found = [];
    }
    for (const hit of Array.isArray(found) ? found : []) {
      if (!isMergeable(hit) || seen.has(hit.id)) continue;
      seen.add(hit.id);
      const hitKeys = prefixedKeys(hit, opts).map(([prefix, value]) => prefix + value);
      if (hitKeys.some((key) => ownKeys.has(key))) related.push(hit);
    }
    if (related.length) break; // the first search that finds something is enough
  }
  if (!related.length) return null;
  return findDuplicateGroups([contact, ...related], opts, [])[0] ?? null;
}
