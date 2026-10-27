// Turning a parsed file into contacts: rows to drafts, drafts to cards, and a
// plan that separates what is new from what looks like a contact you already
// have — before anything is written.
//
// Pure planning, plus api.contacts calls; no DOM.
//
// The duplicate check is the point of importing through a plan at all: a CSV
// from another service is exactly where the same person arrives twice, and the
// plugin already knows how to tell.

import { alignRow } from './csv.js';
import { cardFromDraft, emptyDraft } from './editor.js';
import { cardKeys, groupFromSelection } from './duplicates.js';
import { ADDRESS_FIELDS } from './import-fields.js';

/**
 * Best-effort split of a single "Full Name" column: the last token is the
 * family name, the rest the given name. Only used when the file has no
 * first/last columns of its own.
 */
export function splitName(value) {
  const tokens = String(value ?? '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return { given: tokens.join(' '), surname: '' };
  return { given: tokens.slice(0, -1).join(' '), surname: tokens.at(-1) };
}

/** The draft for one mapped row. */
export function rowToDraft(row, mapping, { bookIds = [] } = {}) {
  const cells = alignRow(row, Array.isArray(mapping) ? mapping.length : 0);
  const draft = emptyDraft();
  draft.bookIds = [...bookIds];
  let fullName = '';

  (Array.isArray(mapping) ? mapping : []).forEach((field, index) => {
    const value = String(cells[index] ?? '').trim();
    if (!value || field === 'ignore') return;
    if (field === 'email') draft.emails.push({ address: value, pref: draft.emails.length === 0 });
    else if (field === 'phone') draft.phones.push({ number: value, pref: draft.phones.length === 0 });
    else if (field === 'given') draft.given = value;
    else if (field === 'surname') draft.surname = value;
    else if (field === 'name') fullName = value;
    else if (field === 'nickname') draft.nickname = value;
    else if (field === 'organization') draft.organization = value;
    else if (field === 'title') draft.title = value;
    else if (field === 'notes') draft.notes = [draft.notes, value].filter(Boolean).join('\n');
    else if (field === 'tags') draft.tags = [draft.tags, value].filter(Boolean).join(',');
    else if (field === 'address') draft.address.street = value;
    else if (ADDRESS_FIELDS.includes(field)) draft.address[field] = value;
  });

  // a full name only fills in what the file did not give us
  if (fullName && !draft.given && !draft.surname) {
    const split = splitName(fullName);
    draft.given = split.given;
    draft.surname = split.surname;
  }
  return draft;
}

/** Every draft of a file, dropping the rows that carry nothing. */
export function rowsToDrafts(rows, mapping, options = {}) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => rowToDraft(row, mapping, options))
    .filter((draft) => draft.given || draft.surname || draft.emails.length || draft.phones.length);
}

/**
 * What an import would do: which drafts are new, and which look like a contact
 * already in the address books.
 *
 * A duplicate is matched on the same keys detection uses (email, phone, name),
 * so an import can never quietly create the duplicates the rest of the plugin
 * spends its time finding.
 *
 * @returns {{fresh: object[], duplicates: Array<{draft: object, match: object, reason: string}>}}
 */
export function planImport(drafts, existing, { region = '' } = {}) {
  const opts = { region };
  const byKey = new Map();
  for (const card of Array.isArray(existing) ? existing : []) {
    const keys = cardKeys(card, opts);
    const all = [
      ...keys.email.map((value) => ['e:', value]),
      ...keys.phone.map((value) => ['p:', value]),
      ...keys.name.map((value) => ['n:', value]),
      ...keys.core.map((value) => ['c:', value]),
    ];
    for (const [prefix, value] of all) {
      const id = `${prefix}${value}`;
      if (!byKey.has(id)) byKey.set(id, card);
    }
  }

  const fresh = [];
  const duplicates = [];
  for (const draft of Array.isArray(drafts) ? drafts : []) {
    // the same keys detection uses, so an import cannot create what detection hunts
    const keys = cardKeys(cardFromDraft(draft, 'create'), opts);
    const checks = [
      ...keys.email.map((value) => [`e:${value}`, 'email']),
      ...keys.phone.map((value) => [`p:${value}`, 'phone']),
      ...keys.name.map((value) => [`n:${value}`, 'name']),
      ...keys.core.map((value) => [`c:${value}`, 'name']),
    ];
    const hit = checks.map(([id, reason]) => ({ match: byKey.get(id), reason })).find((entry) => entry.match);
    if (hit) duplicates.push({ draft, match: hit.match, reason: hit.reason });
    else fresh.push(draft);
  }

  return { fresh, duplicates };
}

/**
 * A stable key for one duplicate of the plan, so a per-group decision survives
 * a re-render (the drafts are rebuilt whenever the mapping or the target book
 * changes, so their object identity does not). Keyed by what matched, why and
 * which draft — the same trio the wizard shows the user.
 */
export function duplicateKey(entry) {
  const draft = entry?.draft ?? {};
  const label = draft.emails?.[0]?.address
    || [draft.given, draft.surname].filter(Boolean).join(' ')
    || draft.fullName
    || draft.phones?.[0]?.number
    || '';
  return `${entry?.match?.id ?? ''}|${entry?.reason ?? ''}|${label}`;
}

/**
 * The review-dialog groups for the duplicates the user chose to *merge*.
 *
 * A merge is the one decision the import cannot make on its own: every merge in
 * this plugin goes through the review dialog (§9.2), so the wizard queues the
 * pair and this turns the pairs into groups the dialog understands. Each group
 * is `[existing, imported]` — the existing contact is preferred as the one to
 * keep, because "merge" here means "fold what the file adds into the contact I
 * already have" — and carries `keepId` so the dialog opens on that choice.
 *
 * Pairs whose imported card the host did not accept are dropped: there is
 * nothing to merge, and the import already reported the failure.
 *
 * @param {Array<{draft: object, match: object}>} merges the merge decisions
 * @param {Array<{draft: object, card: object}>} created what `applyImport` wrote
 * @returns {object[]} groups for `api.ui.openDialog`'s review dialog
 */
export function mergeGroupsFromImport(merges, created) {
  const byDraft = new Map((Array.isArray(created) ? created : []).map((entry) => [entry.draft, entry.card]));
  const groups = [];
  for (const entry of Array.isArray(merges) ? merges : []) {
    const card = byDraft.get(entry?.draft);
    if (!card?.id || !entry?.match?.id) continue;
    const group = groupFromSelection([entry.match, card]);
    group.keepId = entry.match.id;
    groups.push(group);
  }
  return groups;
}

/**
 * Writes the drafts the user accepted. A draft the host refuses is counted in
 * `failed` and reported, never silently dropped.
 *
 * `cards` pairs every draft that was created with the card the host returned,
 * so a caller that has to keep working with the new contact — the wizard's
 * merge decisions, which hand the pair to the review dialog — does not have to
 * guess the id the host assigned.
 *
 * @returns {Promise<{created: number, failed: number, cards: Array<{draft: object, card: object}>}>}
 */
export async function applyImport(api, drafts) {
  let created = 0;
  let failed = 0;
  const cards = [];
  for (const draft of Array.isArray(drafts) ? drafts : []) {
    try {
      const card = await api.contacts.create(cardFromDraft(draft, 'create'));
      created += 1;
      cards.push({ draft, card });
    } catch {
      failed += 1;
    }
  }
  return { created, failed, cards };
}
