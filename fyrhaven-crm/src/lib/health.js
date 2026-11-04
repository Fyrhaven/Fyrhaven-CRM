// Contact health: what is wrong with a contact, what it costs the score, and
// how the address books compare.
//
// Pure: no api, no DOM, no clock beyond what the caller passes in.
//
// The score is **deductions from 100**, one per issue, and every issue carries
// its own weight — so the dashboard can show exactly why a contact lost points
// instead of a number nobody can argue with. A contact with more deductions than
// 100 simply floors at 0; the list of issues is the real information.

import { contactName, isMergeable, phoneEntries, rawEmailAddresses, text } from './contacts.js';
import { isDisposableAddress, isEmailSyntax, isRoleAddress } from './emails.js';
import { isValidE164, toE164 } from './phones.js';

/** Months without an update before a contact counts as stale. */
export const STALE_MONTHS = 24;

/**
 * The retention buckets, oldest threshold last. A contact falls in the first
 * bucket whose threshold it has passed.
 */
export const STALE_BANDS = [
  { id: 'year', months: 12 },
  { id: 'twoYears', months: 24 },
  { id: 'threeYears', months: 36 },
];

/**
 * How long ago a contact was last updated, and which retention bucket that puts
 * it in — or `null` when the host gave us no date to work from.
 *
 * The signal is the server's own `updated` field. A contact the host never
 * stamped is **not** guessed at: reporting a contact as untouched because the
 * plugin could not see a date would be worse than saying nothing.
 */
export function staleness(card, now = Date.now()) {
  const months = monthsSince(card?.updated, now);
  if (months === null) return null;
  const passed = STALE_BANDS.filter((band) => months >= band.months);
  return { months, band: passed.length ? passed.at(-1).id : 'fresh' };
}

/** The stale contacts, oldest first, with their age. */
export function staleContacts(cards, { now = Date.now(), months = STALE_MONTHS } = {}) {
  return (Array.isArray(cards) ? cards : [])
    .map((card) => ({ card, staleness: staleness(card, now) }))
    .filter((entry) => entry.staleness && entry.staleness.months >= months)
    .sort((a, b) => b.staleness.months - a.staleness.months);
}

/** How many contacts are in each retention bucket. */
export function staleCounts(cards, { now = Date.now() } = {}) {
  const counts = Object.fromEntries(STALE_BANDS.map((band) => [band.id, 0]));
  for (const card of Array.isArray(cards) ? cards : []) {
    const found = staleness(card, now);
    if (found && found.band !== 'fresh') counts[found.band] += 1;
  }
  return counts;
}

/** Score bands, and the cutoffs that define them. */
export const BANDS = { good: 80, fair: 50 };

/**
 * Every rule, with the deduction it makes and whether the plugin can fix it.
 * `fix` is `'cleanup'` (the normalisation flow), `'merge'` (the review dialog)
 * or `null` (the user edits it by hand).
 */
export const RULES = {
  'name.missing': { weight: 25, fix: null },
  'email.missing': { weight: 15, fix: null },
  'phone.missing': { weight: 10, fix: null },
  'email.invalid': { weight: 25, fix: null },
  'phone.unusable': { weight: 15, fix: null },
  duplicate: { weight: 20, fix: 'merge' },
  'email.disposable': { weight: 10, fix: null },
  'email.role': { weight: 5, fix: null },
  'phone.notE164': { weight: 5, fix: 'cleanup' },
  'email.untidy': { weight: 5, fix: 'cleanup' },
  stale: { weight: 5, fix: null },
};

/** Every rule key, in the order the dashboard lists them. */
export const RULE_KEYS = Object.keys(RULES);

const monthsSince = (value, now) => {
  if (!value) return null;
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return null;
  return (now - then) / (30 * 24 * 3600 * 1000);
};

/**
 * What is wrong with one contact, as `[{ key, weight, fix, value }]` — `value`
 * is the offending text, so the dashboard can say *what* is wrong and not only
 * *that* something is.
 *
 * @param {object} card
 * @param {{region?: string, duplicate?: boolean, duplicates?: Set<string>|string[],
 *          now?: number, staleMonths?: number}} context
 *   `duplicates` is the whole picture (the dashboard has it), `duplicate` is for
 *   one contact (the profile has it). Either says the same thing.
 */
export function contactIssues(card, {
  region = '', duplicate = false, duplicates = null, now = Date.now(), staleMonths = STALE_MONTHS,
} = {}) {
  const issues = [];
  const add = (key, value = '') => issues.push({ key, weight: RULES[key].weight, fix: RULES[key].fix, value });
  if (!card || typeof card !== 'object') return issues;

  const name = contactName(card);
  // The raw addresses, not `emailEntries`: a malformed address is dropped by
  // the reader, and reporting it is the point of this check.
  const emails = rawEmailAddresses(card);
  const phones = phoneEntries(card).map((entry) => text(entry.number)).filter(Boolean);

  // A contact with no name shows as its own email address, which is worth a lot.
  if (!name || emails.some((address) => address.trim() === name)) add('name.missing');
  if (!emails.length) add('email.missing');
  if (!phones.length) add('phone.missing');

  for (const address of emails) {
    if (!isEmailSyntax(address)) add('email.invalid', address);
    else if (isDisposableAddress(address)) add('email.disposable', address);
    else if (isRoleAddress(address)) add('email.role', address);
    if (address !== address.trim().toLowerCase()) add('email.untidy', address);
  }

  for (const number of phones) {
    const digits = number.replace(/\D/g, '');
    if (digits.length < 5) add('phone.unusable', number);
    else if (!isValidE164(number) && toE164(number, region)) add('phone.notE164', number);
  }

  const isDuplicate = duplicate === true
    || (duplicates instanceof Set ? duplicates.has(card.id) : Array.isArray(duplicates) && duplicates.includes(card.id));
  if (isDuplicate && isMergeable(card)) add('duplicate');
  if (monthsSince(card.updated, now) > staleMonths) add('stale', card.updated);

  return issues;
}

/** 100 minus every deduction, never below 0. */
export function healthScore(issues) {
  const total = (Array.isArray(issues) ? issues : []).reduce((sum, issue) => sum + (issue?.weight ?? 0), 0);
  return Math.max(0, 100 - total);
}

/** Which band a score falls in, by the documented cutoffs. */
export function healthBand(score) {
  if (score >= BANDS.good) return 'good';
  if (score >= BANDS.fair) return 'fair';
  return 'poor';
}

/** One contact's health: `{ id, name, score, band, issues }`. */
export function contactHealth(card, context = {}) {
  const issues = contactIssues(card, context);
  const score = healthScore(issues);
  return {
    id: card?.id ?? '',
    name: contactName(card) || card?.id || '',
    score,
    band: healthBand(score),
    issues,
  };
}

/**
 * The dashboard's numbers over a list of contacts: a per-contact list, the
 * totals per rule, and a per-address-book breakdown.
 *
 * `books` maps an address-book id to its name, so the breakdown can be
 * labelled; a contact in several books counts in each.
 *
 * @returns {{contacts: object[], total: number, average: number, band: string,
 *            byRule: Record<string, number>, byBook: object[]}}
 */
export function healthSummary(cards, { books, ...context } = {}) {
  const list = (Array.isArray(cards) ? cards : []).filter((card) => card?.id);
  const contacts = list.map((card) => contactHealth(card, context));

  const byRule = Object.fromEntries(RULE_KEYS.map((key) => [key, 0]));
  for (const entry of contacts) {
    for (const issue of entry.issues) byRule[issue.key] = (byRule[issue.key] ?? 0) + 1;
  }

  const perBook = new Map();
  list.forEach((card, index) => {
    for (const id of Object.keys(card.addressBookIds ?? {})) {
      const bucket = perBook.get(id) ?? { id, name: books?.get?.(id) ?? id, count: 0, score: 0 };
      bucket.count += 1;
      bucket.score += contacts[index].score;
      perBook.set(id, bucket);
    }
  });

  const byBook = [...perBook.values()]
    .map((bucket) => ({ ...bucket, average: Math.round(bucket.score / bucket.count) }))
    .sort((a, b) => a.average - b.average);

  const average = contacts.length
    ? Math.round(contacts.reduce((sum, entry) => sum + entry.score, 0) / contacts.length)
    : 100;

  return { contacts, total: contacts.length, average, band: healthBand(average), byRule, byBook };
}

/** The contacts that have one particular issue, for a drill-down list. */
export function withIssue(summary, key) {
  return (summary?.contacts ?? []).filter((entry) => entry.issues.some((issue) => issue.key === key));
}

/** The contacts whose issues the plugin can fix by itself, for one fix kind. */
export function fixableContacts(summary, fix) {
  return (summary?.contacts ?? []).filter((entry) => entry.issues.some((issue) => issue.fix === fix));
}
