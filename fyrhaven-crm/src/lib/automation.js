// The automation rules engine (#33): rules over the events the host actually
// emits, so repetitive contact hygiene runs itself.
//
// A rule is *when* (a trigger) + *if* (a search query) + *then* (actions):
//
//   when:  create | update | import      the events this plugin can see
//   if:    a search query (search.js)    empty means "every contact"
//   then:  addTag | removeTag | addToGroup | proposeMerge
//
// The engine is pure: `planAutomation` returns the same plan a dry-run shows
// and a real run applies, so the preview can never disagree with the write. It
// is also **idempotent** — a tag already present produces no patch, so a rule
// that fires on `update` cannot loop with the write it makes.
//
// Deliberately absent, because the host does not provide them: `on tag` and
// `on email` triggers (no such events), `assign owner` (no owner concept, #23)
// and a shared execution log (needs the server tier, #68). The trigger list
// grows with the host rather than promising what it cannot do.
//
// Pure plus api.storage and api.contacts; no DOM.

import { bookNamesById, contactName, isMergeable, loadBooks, loadCards, text } from './contacts.js';
import { groupMemberIds } from './groups.js';
import { findDuplicatesOf } from './watch.js';
import { recordHistory } from './history.js';
import { isBlankQuery, matchCard, parseQuery } from './search.js';

export const AUTOMATION_KEY = 'automationRules';
export const MAX_AUTOMATION_RULES = 50;
export const PREVIEW_CAP = 20;

/** The events this plugin can see. `import` is the plugin's own flow. */
export const TRIGGERS = ['create', 'update', 'import'];

/** What a rule can do. Everything here is reversible or non-destructive. */
export const ACTIONS = ['addTag', 'removeTag', 'addToGroup', 'proposeMerge'];

export const DEFAULT_PRIORITY = 100;
const MAX_PRIORITY = 999;
const MAX_NAME = 80;
const MAX_TAG = 60;
const MAX_CONDITION = 200;

/** A stable id for a new rule, generated without a uuid API. */
export const newRuleId = () => `auto-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** One action, repaired; null when it says nothing usable. */
function normalizeAction(raw) {
  const type = ACTIONS.includes(raw?.type) ? raw.type : '';
  if (!type) return null;
  if (type === 'proposeMerge') return { type };
  const value = text(raw?.value);
  if (!value) return null;
  return { type, value: value.slice(0, type === 'addTag' || type === 'removeTag' ? MAX_TAG : 120) };
}

/** One rule, repaired; null when it has no id or no usable action. */
export function normalizeRule(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = text(raw.id);
  if (!id) return null;
  const actions = (Array.isArray(raw.actions) ? raw.actions : []).map(normalizeAction).filter(Boolean);
  if (!actions.length) return null;
  const priority = Number.isFinite(Number(raw.priority))
    ? Math.min(Math.max(Math.round(Number(raw.priority)), 0), MAX_PRIORITY)
    : DEFAULT_PRIORITY;
  return {
    id: id.slice(0, 80),
    name: text(raw.name).slice(0, MAX_NAME),
    enabled: raw.enabled !== false,
    priority,
    trigger: TRIGGERS.includes(raw.trigger) ? raw.trigger : 'create',
    condition: text(raw.condition).slice(0, MAX_CONDITION),
    actions,
  };
}

/** Repaired, de-duplicated by id (first wins), ordered by priority then id, capped. */
export function normalizeRules(raw) {
  const seen = new Map();
  for (const item of Array.isArray(raw) ? raw : []) {
    const rule = normalizeRule(item);
    if (!rule) continue;
    if (!seen.has(rule.id)) seen.set(rule.id, rule);
  }
  return [...seen.values()]
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
    .slice(0, MAX_AUTOMATION_RULES);
}

/** The rules, repaired. Rewrites storage when it dropped junk. */
export async function readAutomation(api) {
  const stored = await api.storage.get(AUTOMATION_KEY);
  const list = Array.isArray(stored) ? stored : [];
  const rules = normalizeRules(list);
  if (rules.length !== list.length) {
    if (rules.length) await api.storage.set(AUTOMATION_KEY, rules);
    else await api.storage.remove(AUTOMATION_KEY);
  }
  return rules;
}

/** Saves one rule (by id); returns the whole list. */
export async function saveRule(api, raw) {
  const rule = normalizeRule(raw);
  if (!rule) return readAutomation(api);
  const kept = [rule, ...(await readAutomation(api)).filter((item) => item.id !== rule.id)];
  await api.storage.set(AUTOMATION_KEY, normalizeRules(kept));
  return readAutomation(api);
}

/** Drops one rule by id; returns what is left. */
export async function removeRule(api, id) {
  const wanted = text(id);
  const next = (await readAutomation(api)).filter((rule) => rule.id !== wanted);
  if (next.length) await api.storage.set(AUTOMATION_KEY, next);
  else await api.storage.remove(AUTOMATION_KEY);
  return next;
}

/** Whether the enabled rules of a trigger exist at all — the cheap gate for a hook. */
export function hasRulesFor(rules, trigger) {
  return normalizeRules(rules).some((rule) => rule.enabled && rule.trigger === trigger);
}

// ── The plan (pure) ────────────────────────────────────────────

/** Whether two keyword maps say the same thing. */
const sameKeywords = (a, b) => {
  const names = (map) => Object.entries(map ?? {}).filter(([, on]) => on).map(([key]) => key).sort();
  const left = names(a);
  const right = names(b);
  return left.length === right.length && left.every((key, i) => key === right[i]);
};

/** Does a rule's condition hold for a card? An empty condition always holds. */
export function conditionMatches(condition, card, books) {
  const parsed = parseQuery(condition);
  if (isBlankQuery(parsed)) return true;
  return matchCard(card, parsed, { books });
}

/** The tag/group/merge deltas of one rule on one card. */
function ruleDeltas(rule, card) {
  const tags = [];
  const groups = [];
  let proposeMerge = false;
  for (const action of rule.actions) {
    if (action.type === 'addTag') tags.push([action.value, true]);
    else if (action.type === 'removeTag') tags.push([action.value, false]);
    else if (action.type === 'addToGroup') groups.push(action.value);
    else if (action.type === 'proposeMerge') proposeMerge = true;
  }
  return { tags, groups, proposeMerge };
}

/** Folds per-rule deltas onto a card's current keywords, in rule order. */
function foldDeltas(deltas, card) {
  const tagState = new Map();
  const groups = new Set();
  let proposeMerge = false;
  for (const delta of deltas) {
    for (const [tag, on] of delta.tags) tagState.set(tag, on);
    for (const id of delta.groups) groups.add(id);
    proposeMerge = proposeMerge || delta.proposeMerge;
  }
  const current = { ...(card?.keywords ?? {}) };
  for (const [tag, on] of tagState) {
    if (on) current[tag] = true;
    else delete current[tag];
  }
  return {
    keywords: sameKeywords(current, card?.keywords ?? {}) ? null : current,
    groups: [...groups],
    proposeMerge,
  };
}

/**
 * What the enabled rules of `trigger` would do to `card`. Pure: the same plan
 * is shown by a dry-run and applied by `applyAutomation`, so they cannot
 * disagree. `books` is the id→name map the `book:` condition needs.
 *
 * @returns {{matched: Array<{id: string, name: string}>, keywords: object|null,
 *            groups: string[], proposeMerge: boolean}}
 */
export function planAutomation(rules, { trigger, card } = {}, { books } = {}) {
  const matched = [];
  const deltas = [];
  for (const rule of normalizeRules(rules)) {
    if (!rule.enabled || rule.trigger !== trigger) continue;
    if (!conditionMatches(rule.condition, card, books)) continue;
    matched.push({ id: rule.id, name: rule.name });
    deltas.push(ruleDeltas(rule, card));
  }
  return { matched, ...foldDeltas(deltas, card) };
}

/**
 * A dry run of one rule over a list of contacts: how many it matches and what
 * it would change for the first few. The rule need not be enabled or saved, so
 * the builder can preview a draft.
 */
export function previewRule(rule, cards, { books } = {}) {
  const clean = normalizeRule(rule);
  if (!clean) return { count: 0, changes: [], errors: [] };
  const parsed = parseQuery(clean.condition);
  const list = (Array.isArray(cards) ? cards : []).filter((card) => card?.id && isMergeable(card));
  const matched = list.filter((card) => isBlankQuery(parsed) || matchCard(card, parsed, { books }));
  const changes = matched.slice(0, PREVIEW_CAP).map((card) => ({
    id: card.id,
    name: contactName(card) || card.id,
    plan: foldDeltas([ruleDeltas(clean, card)], card),
  }));
  return { count: matched.length, changes, errors: parsed.errors };
}


// ── The write ──────────────────────────────────────────────────

/** The members map of a group with `contactId` added, or null when it is already one. */
export function withMember(group, contactId) {
  const id = text(contactId);
  if (!id) return null;
  const ids = groupMemberIds(group);
  if (ids.includes(id)) return null; // idempotent: already a member, so no write
  return Object.fromEntries(
    [...ids, id].map((member, index) => [`m${index}`, { kind: 'individual', value: member }]),
  );
}

/**
 * Applies a plan to one card: the keyword patch, the group memberships, and a
 * merge proposal when a rule asked for one. Never throws at its caller — a rule
 * that runs on a save must not be able to break the save — and records one
 * `automation` history entry when it wrote anything.
 *
 * @returns {Promise<{updated:number, groups:number, proposed:boolean, failed:number}>}
 */
export async function applyAutomation(api, card, plan, { now = Date.now(), cards = null } = {}) {
  const id = text(card?.id);
  if (!id || !plan) return { updated: 0, groups: 0, proposed: false, failed: 0 };
  let updated = 0;
  let groups = 0;
  let failed = 0;

  if (plan.keywords) {
    try {
      // an empty map means "no tags", the shape the editor writes
      await api.contacts.update(id, { keywords: Object.keys(plan.keywords).length ? plan.keywords : undefined });
      updated += 1;
    } catch { failed += 1; }
  }

  if (plan.groups.length) {
    const list = cards ?? await loadCards(api).catch(() => []);
    const byId = new Map((Array.isArray(list) ? list : []).map((entry) => [entry.id, entry]));
    for (const groupId of plan.groups) {
      const group = byId.get(groupId);
      if (!group) { failed += 1; continue; }
      const members = withMember(group, id);
      if (!members) continue; // already a member
      try {
        await api.contacts.update(groupId, { members });
        groups += 1;
      } catch { failed += 1; }
    }
  }

  let proposed = false;
  if (plan.proposeMerge) {
    try {
      const found = await findDuplicatesOf(api, card);
      if (found) {
        const names = found.others.map((member) => contactName(member) || member.id).join(', ');
        api.toast.info(api.i18n.t('automation.mergeProposed', { name: names }));
        proposed = true;
      }
    } catch {
      // a failed proposal must never look like a failed save
    }
  }

  if (updated || groups) {
    await recordHistory(api, {
      kind: 'automation',
      contacts: updated + groups,
      detail: plan.matched.map((rule) => rule.name || rule.id).join(', '),
    }, now);
  }
  return { updated, groups, proposed, failed };
}

const NOTHING = { matched: 0, updated: 0, groups: 0, proposed: false, failed: 0 };

/**
 * Runs the rules of one trigger for one saved contact — what the host's
 * observer hooks call. Cheap when nothing is configured: it reads the rules
 * first and returns before any other read.
 */
export async function runAutomationForCard(api, { trigger, card } = {}, { now = Date.now() } = {}) {
  if (!card?.id || !isMergeable(card)) return NOTHING;
  let rules;
  try {
    rules = await readAutomation(api);
  } catch {
    return NOTHING;
  }
  if (!hasRulesFor(rules, trigger)) return NOTHING;
  const books = bookNamesById(await loadBooks(api).catch(() => []));
  const plan = planAutomation(rules, { trigger, card }, { books });
  if (!plan.matched.length) return NOTHING;
  const result = await applyAutomation(api, card, plan, { now });
  return { matched: plan.matched.length, ...result };
}

/**
 * Runs the rules of one trigger for a batch of contacts — what the import flow
 * calls. The rules and the address books are read once for the whole batch.
 */
export async function runAutomationForCards(api, { trigger, cards } = {}, { now = Date.now() } = {}) {
  const list = (Array.isArray(cards) ? cards : []).filter((card) => card?.id && isMergeable(card));
  const nothing = { contacts: 0, updated: 0, groups: 0, failed: 0 };
  if (!list.length) return nothing;
  let rules;
  try {
    rules = await readAutomation(api);
  } catch {
    return nothing;
  }
  if (!hasRulesFor(rules, trigger)) return nothing;
  const books = bookNamesById(await loadBooks(api).catch(() => []));
  const all = await loadCards(api).catch(() => []);
  let contacts = 0;
  let updated = 0;
  let groups = 0;
  let failed = 0;
  for (const card of list) {
    const plan = planAutomation(rules, { trigger, card }, { books });
    if (!plan.matched.length) continue;
    const result = await applyAutomation(api, card, plan, { now, cards: all });
    contacts += 1;
    updated += result.updated;
    groups += result.groups;
    failed += result.failed;
  }
  return { contacts, updated, groups, failed };
}
