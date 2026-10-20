// Display shaping for the review dialog: what one contact looks like in
// detail, and what the merged contact will look like — including which values
// the merge adds and who they come from. Pure functions over plain cards, so
// the unit tests in test/preview.test.mjs drive them directly.

import { bookIds, contactName, emailEntries, phoneEntries } from './contacts.js';

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

function keptValues(primary, field) {
  if (!primary) return [];
  if (field === 'name') return primary.name ? [DISPLAY.name(primary.name)].filter(Boolean) : [];
  if (field === 'keywords') return Object.keys(primary.keywords ?? {});
  return Object.values(primary[field] ?? {}).map(DISPLAY[field]).filter(Boolean);
}

/**
 * The merged contact, field by field, from a planMerge plan:
 * `[{ field, labelKey, kept: [text], added: [{ value, fromId }] }]` —
 * only fields that have something. The caller resolves `labelKey` through
 * i18n and `fromId` through the group's members.
 */
export function previewFields(plan) {
  const out = [];
  for (const [field, labelKey] of PREVIEW_FIELDS) {
    const kept = keptValues(plan?.primary, field);
    const added = (plan?.added ?? [])
      .filter((entry) => entry.field === field)
      .map((entry) => ({ value: DISPLAY[field](entry.value), fromId: entry.fromId }))
      .filter((entry) => entry.value);
    if (!kept.length && !added.length) continue;
    out.push({ field, labelKey, kept, added });
  }
  return out;
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
