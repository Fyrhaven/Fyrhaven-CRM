// Per-address-book duplicate policies and ignore rules (#7). Each address book
// can override the global match strategies (email, phone, name) or be excluded
// from scanning entirely. Global ignore rules skip contacts by email domain or
// tag regardless of which book they live in.
//
// Pure model plus api.storage — no DOM. The UI lives in the manager page.
//
// Stored shape (one record per book, keyed by book id):
//   {
//     [bookId]: {
//       enabled: true | false,
//       matchByEmail: true | false | undefined,   // undefined = use global
//       matchByPhone: true | false | undefined,
//       matchByName: true | false | undefined,
//     }
//   }
// Plus an ignore list:
//   { domains: ['example.com', ...], tags: ['do-not-merge', ...] }
//
// A contact is scannable when it belongs to at least one enabled book. Its
// effective match strategy is the most permissive across every enabled book it
// belongs to — if book A says matchByEmail:false but book B says true (or is
// unset, defaulting to the global on), the contact keeps email matching. That
// is the safe direction: a book that opts out never silences a match another
// book still wants.

import { bookIds, detectionOptions, emailEntries } from './contacts.js';

export const POLICIES_KEY = 'bookPolicies';
export const IGNORE_KEY = 'bookIgnore';
export const MAX_POLICIES = 200;
export const MAX_IGNORE = 50;

/**
 * The fields a book can protect from a merge. Every field `planMerge` is able
 * to write is here, so there is no field a user can see being changed but
 * cannot freeze.
 */
export const PROTECTED_FIELDS = [
  'name', 'emails', 'phones', 'addresses', 'onlineServices', 'links',
  'nicknames', 'notes', 'anniversaries', 'organizations', 'titles',
  'personalInfo', 'media', 'keywords',
];

const text = (value) => (typeof value === 'string' ? value.trim() : '');

// ── Policies ────────────────────────────────────────────────────

/** Is this a valid boolean override? `undefined` means "use the global". */
const isOptBool = (value) => value === true || value === false;

/** One book's overrides, repaired: only known fields, only valid values. */
function normalizeBookPolicy(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  if (isOptBool(raw.enabled)) out.enabled = raw.enabled;
  if (isOptBool(raw.matchByEmail)) out.matchByEmail = raw.matchByEmail;
  if (isOptBool(raw.matchByPhone)) out.matchByPhone = raw.matchByPhone;
  if (isOptBool(raw.matchByName)) out.matchByName = raw.matchByName;
  if (Array.isArray(raw.protectedFields)) {
    const fields = [...new Set(raw.protectedFields.filter((f) => PROTECTED_FIELDS.includes(f)))];
    if (fields.length) out.protectedFields = fields;
  }
  return out;
}

/** The stored policies map, repaired. Only book ids with real overrides survive. */
export function normalizePolicies(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  let count = 0;
  for (const [bookId, policy] of Object.entries(raw)) {
    const id = text(bookId);
    if (!id) continue;
    const cleaned = normalizeBookPolicy(policy);
    if (!Object.keys(cleaned).length) continue;
    if (count >= MAX_POLICIES) break;
    out[id] = cleaned;
    count += 1;
  }
  return out;
}

/** Read the stored policies; rewrites when junk was dropped. */
export async function readPolicies(api) {
  const stored = await api.storage.get(POLICIES_KEY);
  const raw = stored && typeof stored === 'object' ? stored : {};
  const policies = normalizePolicies(raw);
  if (JSON.stringify(policies) !== JSON.stringify(raw)) {
    if (Object.keys(policies).length) await api.storage.set(POLICIES_KEY, policies);
    else await api.storage.remove(POLICIES_KEY);
  }
  return policies;
}

/** Write a full policies map. An empty map removes the key. */
export async function writePolicies(api, policies) {
  const cleaned = normalizePolicies(policies);
  if (Object.keys(cleaned).length) await api.storage.set(POLICIES_KEY, cleaned);
  else await api.storage.remove(POLICIES_KEY);
  return cleaned;
}

/**
 * Flip or set one book's override. Pass `undefined` as value to clear the
 * override (the book falls back to the global setting).
 */
export async function setBookPolicy(api, bookId, field, value) {
  const policies = await readPolicies(api);
  const id = text(bookId);
  if (!id) return policies;
  const boolFields = ['enabled', 'matchByEmail', 'matchByPhone', 'matchByName'];
  if (!boolFields.includes(field) && field !== 'protectedFields') return policies;
  const current = policies[id] ?? {};
  const empty = value === undefined || value === null || (Array.isArray(value) && !value.length);
  if (empty) {
    delete current[field];
  } else if (field === 'protectedFields') {
    if (!Array.isArray(value)) return policies;
    const fields = [...new Set(value.filter((f) => PROTECTED_FIELDS.includes(f)))];
    if (fields.length) current[field] = fields;
    else delete current[field];
  } else if (isOptBool(value)) {
    current[field] = value;
  } else {
    return policies;
  }
  if (!Object.keys(normalizeBookPolicy(current)).length) {
    delete policies[id];
  } else {
    policies[id] = normalizeBookPolicy(current);
  }
  return writePolicies(api, policies);
}

// ── Ignore rules ────────────────────────────────────────────────

/** The stored ignore rules, repaired. */
export function normalizeIgnore(raw) {
  if (!raw || typeof raw !== 'object') return { domains: [], tags: [] };
  const domains = Array.isArray(raw.domains)
    ? raw.domains.map((d) => text(d).toLowerCase()).filter(Boolean).slice(0, MAX_IGNORE)
    : [];
  const tags = Array.isArray(raw.tags)
    ? raw.tags.map((t) => text(t)).filter(Boolean).slice(0, MAX_IGNORE)
    : [];
  return { domains, tags };
}

/** Read the stored ignore rules; rewrites when junk was dropped. */
export async function readIgnore(api) {
  const stored = await api.storage.get(IGNORE_KEY);
  const raw = stored && typeof stored === 'object' ? stored : {};
  const ignore = normalizeIgnore(raw);
  if (JSON.stringify(ignore) !== JSON.stringify(raw)) {
    if (ignore.domains.length || ignore.tags.length) await api.storage.set(IGNORE_KEY, ignore);
    else await api.storage.remove(IGNORE_KEY);
  }
  return ignore;
}

/** Write a full ignore map. Empty lists remove the key. */
export async function writeIgnore(api, ignore) {
  const cleaned = normalizeIgnore(ignore);
  if (cleaned.domains.length || cleaned.tags.length) await api.storage.set(IGNORE_KEY, cleaned);
  else await api.storage.remove(IGNORE_KEY);
  return cleaned;
}

/**
 * `detectionOptions` plus the stored policies and ignore rules — everything a
 * duplicate check needs, from one call.
 *
 * Every path that looks for duplicates uses this, so a policy cannot be
 * honoured on the Duplicates page and forgotten in the contact details or in
 * the save-time warning. That is the bug this exists to make impossible.
 */
export async function policyAwareOptions(api) {
  const [globalOpts, policies, ignore] = await Promise.all([
    detectionOptions(api), readPolicies(api), readIgnore(api),
  ]);
  return { ...globalOpts, policies, ignore };
}

// ── Application ─────────────────────────────────────────────────
//
// Cards are read through the shared readers in `contacts.js` — `bookIds` and
// `emailEntries` — never by reaching into `addressBookIds` or `emails` here.
// A second reading of the same field is a second opinion about what a card
// looks like, and the two drift apart.

/** The tags of a card: the KEYS of `keywords`, exactly as search.js reads them. */
function cardTags(card) {
  const kw = card?.keywords;
  if (Array.isArray(kw)) return kw.map((tag) => text(tag)).filter(Boolean);
  if (kw && typeof kw === 'object') return Object.keys(kw);
  return [];
}

/** The email domains of a card, lower-cased. */
function cardEmailDomains(card) {
  return emailEntries(card)
    .map((entry) => {
      const address = text(entry.address);
      const at = address.lastIndexOf('@');
      return at >= 0 ? address.slice(at + 1).toLowerCase() : '';
    })
    .filter(Boolean);
}

/**
 * Whether a card is ignored by the current rules: it matches a domain or a tag.
 */
export function isCardIgnored(card, ignore) {
  if (!ignore) return false;
  const { domains, tags } = ignore;
  if (domains?.length) {
    const cardDomains = cardEmailDomains(card);
    if (cardDomains.some((d) => domains.includes(d))) return true;
  }
  if (tags?.length) {
    const cardTagSet = cardTags(card).map((t) => t.toLowerCase());
    if (tags.some((tag) => cardTagSet.includes(tag.toLowerCase()))) return true;
  }
  return false;
}

/**
 * Whether a card is scannable: it must belong to at least one enabled book.
 * Cards with no books are always scannable.
 */
export function isCardScannable(card, policies) {
  if (!policies || !Object.keys(policies).length) return true;
  const ids = bookIds(card);
  if (!ids.length) return true;
  return ids.some((id) => {
    const policy = policies[id];
    return !policy || policy.enabled !== false;
  });
}

/**
 * The effective match options for one card, given per-book overrides and the
 * global options. The most permissive setting across every enabled book wins.
 */
export function effectiveOpts(card, policies, globalOpts = {}) {
  if (!policies || !Object.keys(policies).length) return globalOpts;
  const ids = bookIds(card);
  if (!ids.length) return globalOpts;
  const result = {
    matchByEmail: globalOpts.matchByEmail !== false,
    matchByPhone: globalOpts.matchByPhone !== false,
    matchByName: globalOpts.matchByName !== false,
    region: globalOpts.region,
  };
  const enabledIds = ids.filter((id) => {
    const policy = policies[id];
    return !policy || policy.enabled !== false;
  });
  if (!enabledIds.length) return result;
  const bookOpts = (id) => policies[id] ?? {};
  result.matchByEmail = enabledIds.some((id) => bookOpts(id).matchByEmail !== false);
  result.matchByPhone = enabledIds.some((id) => bookOpts(id).matchByPhone !== false);
  result.matchByName = enabledIds.some((id) => bookOpts(id).matchByName !== false);
  return result;
}

/**
 * The fields a merge must not change for this card: the **union** over every
 * enabled book it belongs to.
 *
 * The union — not the most permissive reading the match strategies use —
 * because protection is a safety property and the two directions are opposite.
 * A field protected by *any* book the contact lives in is protected: more
 * protection is the safe way to be wrong. A book that is switched off
 * contributes nothing, since its contacts are not scanned at all.
 */
export function protectedFieldsFor(card, policies) {
  if (!policies || !Object.keys(policies).length) return [];
  const out = new Set();
  for (const id of bookIds(card)) {
    const policy = policies[id];
    if (!policy || policy.enabled === false) continue;
    for (const field of policy.protectedFields ?? []) out.add(field);
  }
  return [...out];
}

/**
 * Filter a card list to the scannable, non-ignored subset. Per-card effective
 * options are returned alongside so the caller can use them instead of the
 * global ones.
 */
export function filterForScan(cards, { policies, ignore, globalOpts } = {}) {
  const list = Array.isArray(cards) ? cards : [];
  const hasPolicies = policies && Object.keys(policies).length;
  const hasIgnore = ignore && (ignore.domains?.length || ignore.tags?.length);
  if (!hasPolicies && !hasIgnore) {
    return { cards: list, perCardOpts: null };
  }
  const filtered = [];
  const perCardOpts = [];
  for (const card of list) {
    if (hasPolicies && !isCardScannable(card, policies)) continue;
    if (hasIgnore && isCardIgnored(card, ignore)) continue;
    filtered.push(card);
    perCardOpts.push(hasPolicies ? effectiveOpts(card, policies, globalOpts) : globalOpts);
  }
  return { cards: filtered, perCardOpts };
}
