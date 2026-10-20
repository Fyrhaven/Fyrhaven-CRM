// Display shaping for the review dialog: what one contact looks like in
// detail, and what the merged contact will look like — including which values
// the merge adds and who they come from. Pure functions over plain cards, so
// the unit tests in test/preview.test.mjs drive them directly.

import { bookIds, contactName, emailEntries, phoneEntries } from './contacts.js';
import { normalizeName } from './duplicates.js';

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const trunc = (value, max = 120) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/** One-line address from any of the shapes a card may carry. */
export function formatAddress(address) {
  if (!address || typeof address !== 'object') return '';
  const full = text(address.full || address.fullAddress);
  if (full) return full;
  const components = Array.isArray(address.components)
    ? address.components.map((c) => text(c?.value)).filter(Boolean).join(' ')
    : '';
  const flat = [address.street, address.locality, address.region, address.postcode, address.country]
    .map(text).filter(Boolean).join(' ');
  return trunc(components || flat, 80);
}

/** "birth 1990-05-12" — PartialDate objects and plain strings both arrive. */
export function formatAnniversary(anniversary) {
  if (!anniversary || typeof anniversary !== 'object') return '';
  const kind = text(anniversary.kind);
  const date = anniversary.date;
  let when = '';
  if (typeof date === 'string') when = date;
  else if (date && typeof date === 'object') {
    if (typeof date.utc === 'string') when = date.utc.slice(0, 10);
    else if (date.year || date.month || date.day) {
      when = [date.year, date.month, date.day]
        .map((part) => (part === undefined || part === null ? '' : String(part).padStart(2, '0')))
        .filter(Boolean)
        .join('-');
    }
  }
  return [kind, when].filter(Boolean).join(' ');
}

/** How each field's raw value becomes a line of text. */
const DISPLAY = {
  name: (value) => contactName({ name: value }),
  emails: (value) => text(value?.address),
  phones: (value) => text(value?.number),
  addresses: formatAddress,
  organizations: (value) => text(value?.name),
  titles: (value) => text(value?.name),
  nicknames: (value) => text(value?.name),
  onlineServices: (value) => text(value?.uri || (value?.service ? `${value.service}${value.user ? `: ${value.user}` : ''}` : value?.user)),
  links: (value) => text(value?.uri),
  notes: (value) => trunc(text(value?.note)),
  anniversaries: formatAnniversary,
  keywords: (value) => text(value),
  personalInfo: (value) => text(value?.value),
  media: (value) => text(value?.uri),
};

/** The fields of a card the dialog shows, in a stable order. */
export const PREVIEW_FIELDS = [
  ['name', 'dialog.field.name'],
  ['emails', 'dialog.field.email'],
  ['phones', 'dialog.field.phone'],
  ['addresses', 'dialog.field.address'],
  ['organizations', 'dialog.field.organization'],
  ['titles', 'dialog.field.title'],
  ['nicknames', 'dialog.field.nickname'],
  ['onlineServices', 'dialog.field.online'],
  ['links', 'dialog.field.link'],
  ['notes', 'dialog.field.note'],
  ['anniversaries', 'dialog.field.anniversary'],
  ['keywords', 'dialog.field.keyword'],
  ['personalInfo', 'dialog.field.personal'],
  ['media', 'dialog.field.media'],
];

/**
 * Fields the kept contact receives only when it has none of its own. A donor
 * value in one of these conflicts with the kept contact's own value instead of
 * being merged, so the dialog can say so explicitly.
 */
const FILL_FIELDS = new Set(['name', 'organizations', 'titles', 'personalInfo', 'media']);

function valuesOf(card, field) {
  if (!card) return [];
  if (field === 'name') return card.name ? [DISPLAY.name(card.name)].filter(Boolean) : [];
  if (field === 'keywords') return Object.keys(card.keywords ?? {});
  return Object.values(card[field] ?? {}).map(DISPLAY[field]).filter(Boolean);
}

/** Donor values a kept contact's single-value field would lose. */
function fieldConflicts(primary, others, field, kept) {
  if (!kept.length || !FILL_FIELDS.has(field)) return [];
  const conflicts = [];
  const seen = new Set(kept.map((value) => normalizeName(value)));
  for (const other of others) {
    for (const value of valuesOf(other, field)) {
      const key = normalizeName(value);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      conflicts.push({ value, fromId: other.id });
    }
  }
  return conflicts;
}

/**
 * The conflicting single-value fields of a plan — the options the review
 * dialog's value picker offers.
 * `[{ field, labelKey, kept: [text], options: [{ value, fromId }] }]`.
 */
export function conflictFields(plan) {
  const primary = plan?.primary;
  const others = plan?.others ?? [];
  const out = [];
  for (const [field, labelKey] of PREVIEW_FIELDS) {
    if (!FILL_FIELDS.has(field)) continue;
    const kept = valuesOf(primary, field);
    const options = fieldConflicts(primary, others, field, kept);
    if (options.length) out.push({ field, labelKey, kept, options });
  }
  return out;
}

/**
 * The complete picture of the contact that will be kept, field by field, from
 * a planMerge plan:
 * `[{ field, labelKey, kept: [text], previous?: [text],
 *     added: [{ value, fromId }], conflicts: [{ value, fromId }],
 *     changed: [{ value, fromId }] }]`
 *
 * - `kept`      values the kept contact already has and keeps unchanged
 * - `added`     values the merge brings in from the other contacts
 * - `conflicts` values only the other contacts have in a single-value field
 *               the kept contact already fills; they are NOT merged
 * - `changed`   donor values the user chose to replace the kept contact's
 *               value with; `previous` holds the values being replaced
 *
 * Only fields with something to show are returned. The caller resolves
 * `labelKey` through i18n and `fromId` through the group's members.
 */
export function previewFields(plan) {
  const primary = plan?.primary;
  const others = plan?.others ?? [];
  const addedByField = new Map();
  for (const entry of plan?.added ?? []) {
    if (!addedByField.has(entry.field)) addedByField.set(entry.field, []);
    addedByField.get(entry.field).push(entry);
  }
  const changedByField = new Map();
  for (const entry of plan?.changed ?? []) {
    if (!changedByField.has(entry.field)) changedByField.set(entry.field, []);
    changedByField.get(entry.field).push(entry);
  }

  const out = [];
  for (const [field, labelKey] of PREVIEW_FIELDS) {
    const kept = valuesOf(primary, field);
    const changed = (changedByField.get(field) ?? [])
      .flatMap((entry) => valuesOf({ [field]: entry.value }, field)
        .map((value) => ({ value, fromId: entry.fromId })))
      .filter((entry) => entry.value);

    if (changed.length) {
      out.push({ field, labelKey, kept: [], previous: kept, added: [], conflicts: [], changed });
      continue;
    }

    const added = (addedByField.get(field) ?? [])
      .map((entry) => ({ value: DISPLAY[field](entry.value), fromId: entry.fromId }))
      .filter((entry) => entry.value);
    const conflicts = fieldConflicts(primary, others, field, kept);

    if (!kept.length && !added.length && !conflicts.length) continue;
    out.push({ field, labelKey, kept, added, conflicts, changed: [] });
  }
  return out;
}

/** Totals for the dialog summary: `{ kept, added, changed, conflicts }`. */
export function previewCounts(fields) {
  return (Array.isArray(fields) ? fields : []).reduce(
    (counts, field) => ({
      kept: counts.kept + field.kept.length,
      added: counts.added + field.added.length,
      changed: counts.changed + field.changed.length,
      conflicts: counts.conflicts + field.conflicts.length,
    }),
    { kept: 0, added: 0, changed: 0, conflicts: 0 },
  );
}


/**
 * Everything the dialog shows about one member of a group:
 * `{ name, meta, emails, phones, addresses, notes, keywords }` — all text,
 * `booksById` (id → name) fills the address book names into `meta`.
 */
export function memberDetails(card, booksById) {
  const orgs = Object.values(card?.organizations ?? {}).map((o) => text(o?.name)).filter(Boolean);
  const titles = Object.values(card?.titles ?? {}).map((title) => text(title?.name)).filter(Boolean);
  const books = bookIds(card).map((id) => booksById?.get?.(id) ?? '').filter(Boolean);
  const meta = [...orgs, ...titles, ...books];
  if (text(card?.created)) meta.push(text(card.created).slice(0, 10));
  return {
    name: contactName(card) || primaryText(card) || text(card?.id),
    meta: meta.join(' · '),
    emails: emailEntries(card).map((e) => text(e.address)),
    phones: phoneEntries(card).map((p) => text(p.number)),
    addresses: Object.values(card?.addresses ?? {}).map(formatAddress).filter(Boolean),
    notes: Object.values(card?.notes ?? {}).map((note) => trunc(text(note?.note))).filter(Boolean),
    keywords: Object.keys(card?.keywords ?? {}),
  };
}

function primaryText(card) {
  return emailEntries(card)[0]?.address ? text(emailEntries(card)[0].address) : '';
}
