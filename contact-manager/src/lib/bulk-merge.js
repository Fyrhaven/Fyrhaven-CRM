// Bulk merge by facet (#6): "everything at Acme", "everything at example.org".
//
// The batch itself is still the review dialog — this module only decides *which*
// groups a facet selects and what merging them would do, so the preview and the
// write cannot disagree. Pure: no api, no DOM.
//
// This is **not** a matching rule. #20 (normalisation) is where a company name is
// rewritten ("Acme Inc." → "Acme"); here a company is matched exactly as written,
// because the facets are *offered* from the data — the user clicks the spelling
// that exists instead of typing a guess, so there is nothing to be fuzzy about.

import { emailEntries, orgName, text } from './contacts.js';

/**
 * How many groups one batch may merge.
 *
 * The undo record keeps 100 cards, and a batch of 50 groups removes at least 50,
 * so a capped batch can always be undone. Any bigger and the safety net the merge
 * relies on would start evicting its own entries.
 */
export const BATCH_CAP = 50;

/** A company name as a matching key: case- and whitespace-insensitive. */
export function companyKey(name) {
  return text(name).replace(/\s+/g, ' ').toLowerCase();
}

/** The domain of an address, lower-cased, or '' when it has none. */
export function domainKey(address) {
  const value = text(address);
  const at = value.lastIndexOf('@');
  const domain = at === -1 ? '' : value.slice(at + 1).trim().toLowerCase();
  return domain.includes('.') ? domain : '';
}

/** The facets of one card, as `[{ kind, key }]`, de-duplicated. */
export function cardFacets(card) {
  const found = [];
  const company = companyKey(orgName(card));
  if (company) found.push({ kind: 'company', key: company });
  for (const entry of emailEntries(card)) {
    const domain = domainKey(entry.address);
    if (domain) found.push({ kind: 'domain', key: domain });
  }
  const seen = new Set();
  return found.filter((facet) => {
    const id = `${facet.kind}:${facet.key}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * The facets over `groups`: `[{ kind, key, label, signatures }]`, biggest first.
 *
 * A group belongs to every facet **any** of its members has, so a group whose
 * members sit at two companies appears under both. A facet is a filter, not a
 * partition: dropping a group because another member disagrees would make the
 * batch smaller than the user asked for.
 *
 * A facet that covers a single group is left out — that is *Review* on that
 * group, not a batch.
 */
export function groupFacets(groups) {
  const byFacet = new Map();
  for (const group of Array.isArray(groups) ? groups : []) {
    if (!group?.signature) continue;
    const seen = new Set();
    for (const member of Array.isArray(group.members) ? group.members : []) {
      for (const facet of cardFacets(member)) {
        const id = `${facet.kind}:${facet.key}`;
        if (seen.has(id)) continue;
        seen.add(id);
        if (!byFacet.has(id)) {
          byFacet.set(id, {
            kind: facet.kind,
            key: facet.key,
            // the first spelling seen, so a chip reads like the data
            label: facet.kind === 'company' ? text(orgName(member)) : facet.key,
            signatures: [],
          });
        }
        byFacet.get(id).signatures.push(group.signature);
      }
    }
  }
  return [...byFacet.values()]
    .filter((entry) => entry.signatures.length > 1)
    .sort((a, b) => b.signatures.length - a.signatures.length
      || a.kind.localeCompare(b.kind)
      || a.label.localeCompare(b.label));
}

/**
 * What merging `signatures` would do — the dry-run summary shown before the
 * dialog opens. One contact per group is kept, so `removals` is what the review
 * dialog will ask to delete.
 *
 * @param {object[]} groups every duplicate group the page holds
 * @param {Set<string>|string[]} signatures the selection
 * @returns {{groups: number, contacts: number, removals: number, signatures: string[]}}
 */
export function batchPlan(groups, signatures) {
  const wanted = signatures instanceof Set
    ? signatures
    : new Set(Array.isArray(signatures) ? signatures : []);
  const chosen = (Array.isArray(groups) ? groups : []).filter((group) => wanted.has(group?.signature));
  const contacts = chosen.reduce((total, group) => total + (group.members?.length ?? 0), 0);
  return {
    groups: chosen.length,
    contacts,
    // a detected group has at least two members, so exactly one per group stays
    removals: contacts - chosen.length,
    signatures: chosen.map((group) => group.signature),
  };
}

/** True when a batch is bigger than one merge should be. */
export function isOverCap(plan, cap = BATCH_CAP) {
  if (!plan || !Number.isFinite(plan.groups)) return false;
  return plan.groups > cap;
}
