// The automation rules engine (#33): the rule model, the pure plan, the dry
// run, and the write path — plus the events the plugin actually sees.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { makeCard } from './fixtures.mjs';
import { readHistory } from '../src/lib/history.js';
import {
  AUTOMATION_KEY, MAX_AUTOMATION_RULES, applyAutomation, conditionMatches, hasRulesFor,
  normalizeRule, normalizeRules, planAutomation, previewRule, readAutomation, removeRule,
  runAutomationForCard, runAutomationForCards, saveRule, withMember,
} from '../src/lib/automation.js';

const rule = (overrides = {}) => ({
  id: 'r1', name: 'VIP', enabled: true, priority: 100, trigger: 'create',
  condition: '', actions: [{ type: 'addTag', value: 'vip' }], ...overrides,
});

const ADA = makeCard({ id: 'a', name: 'Ada Lovelace', emails: ['ada@example.org'], keywords: { maths: true } });
const GRACE = makeCard({ id: 'g', name: 'Grace Hopper', emails: ['grace@navy.mil'] });
const GROUP = makeCard({
  id: 'g1', name: 'Team', kind: 'group', keywords: { group: true },
  members: { m0: { kind: 'individual', value: 'a' } },
});

describe('normalizeRule', () => {
  it('repairs a rule and drops one that cannot do anything', () => {
    expect(normalizeRule(rule())).toEqual(rule());
    expect(normalizeRule(rule({ id: '' }))).toBeNull();
    expect(normalizeRule(rule({ actions: [] }))).toBeNull();
    expect(normalizeRule(rule({ actions: [{ type: 'nonsense', value: 'x' }] }))).toBeNull();
    expect(normalizeRule(rule({ actions: [{ type: 'addTag', value: '   ' }] }))).toBeNull();
    expect(normalizeRule(null)).toBeNull();
    expect(normalizeRule('nope')).toBeNull();
  });

  it('defaults the trigger and clamps the priority', () => {
    expect(normalizeRule(rule({ trigger: 'nonsense' })).trigger).toBe('create');
    expect(normalizeRule(rule({ priority: -5 })).priority).toBe(0);
    expect(normalizeRule(rule({ priority: 99999 })).priority).toBe(999);
    expect(normalizeRule(rule({ priority: 'x' })).priority).toBe(100);
    expect(normalizeRule(rule({ enabled: false })).enabled).toBe(false);
  });
});

describe('normalizeRules', () => {
  it('de-duplicates by id, orders by priority then id, and caps the list', () => {
    const list = normalizeRules([
      rule({ id: 'b', priority: 2 }),
      rule({ id: 'a', priority: 1 }),
      rule({ id: 'a', priority: 9, name: 'second' }),
    ]);
    expect(list.map((item) => item.id)).toEqual(['a', 'b']);
    expect(list[0].name).toBe('VIP'); // first occurrence wins

    const many = Array.from({ length: MAX_AUTOMATION_RULES + 5 }, (_, i) => rule({ id: `r${i}` }));
    expect(normalizeRules(many)).toHaveLength(MAX_AUTOMATION_RULES);
  });
});

describe('the rule store', () => {
  it('saves by id, replaces, removes, and repairs junk', async () => {
    const api = fakeApi();
    await saveRule(api, rule());
    await saveRule(api, rule({ id: 'r2', trigger: 'import' }));
    expect((await readAutomation(api)).map((item) => item.id)).toEqual(['r1', 'r2']);

    await saveRule(api, rule({ name: 'Changed' }));
    expect((await readAutomation(api)).find((item) => item.id === 'r1').name).toBe('Changed');

    await removeRule(api, 'r1');
    expect((await readAutomation(api)).map((item) => item.id)).toEqual(['r2']);

    await api.storage.set(AUTOMATION_KEY, [rule(), { junk: true }]);
    const repaired = await readAutomation(api);
    expect(repaired).toHaveLength(1);
    expect(await api.storage.get(AUTOMATION_KEY)).toEqual(repaired);

    await removeRule(api, 'r1');
    expect(await api.storage.get(AUTOMATION_KEY)).toBeNull();
  });

  it('answers whether a trigger has enabled rules', () => {
    expect(hasRulesFor([rule()], 'create')).toBe(true);
    expect(hasRulesFor([rule()], 'update')).toBe(false);
    expect(hasRulesFor([rule({ enabled: false })], 'create')).toBe(false);
  });
});

describe('conditionMatches', () => {
  it('is true for an empty condition, and a query otherwise', () => {
    expect(conditionMatches('', ADA)).toBe(true);
    expect(conditionMatches('tag:maths', ADA)).toBe(true);
    expect(conditionMatches('tag:vip', ADA)).toBe(false);
    expect(conditionMatches('is:person has:email', GRACE)).toBe(true);
  });
});

describe('planAutomation', () => {
  it('applies only the rules of the trigger', () => {
    const rules = [rule({ id: 'c', trigger: 'create' }), rule({ id: 'u', trigger: 'update', actions: [{ type: 'addTag', value: 'edited' }] })];
    const plan = planAutomation(rules, { trigger: 'create', card: GRACE });
    expect(plan.matched.map((item) => item.id)).toEqual(['c']);
    expect(plan.keywords).toEqual({ vip: true });
  });

  it('filters by the condition', () => {
    const rules = [rule({ condition: 'tag:maths' })];
    expect(planAutomation(rules, { trigger: 'create', card: ADA }).keywords).toEqual({ maths: true, vip: true });
    expect(planAutomation(rules, { trigger: 'create', card: GRACE }).matched).toEqual([]);
  });

  it('is idempotent: a tag already present produces no patch', () => {
    const plan = planAutomation([rule({ actions: [{ type: 'addTag', value: 'maths' }] })], { trigger: 'create', card: ADA });
    expect(plan.keywords).toBeNull();
  });

  it('lets the later rule win when two touch the same tag', () => {
    const add = (priority) => rule({ id: 'add', priority, actions: [{ type: 'addTag', value: 'x' }] });
    const remove = (priority) => rule({ id: 'remove', priority, actions: [{ type: 'removeTag', value: 'x' }] });
    // lower priority runs first, so a later remove undoes an earlier add
    expect(planAutomation([add(1), remove(2)], { trigger: 'create', card: GRACE }).keywords).toBeNull();
    expect(planAutomation([remove(1), add(2)], { trigger: 'create', card: GRACE }).keywords).toEqual({ x: true });
  });

  it('collects groups and a merge proposal', () => {
    const rules = [rule({ id: 'a', actions: [{ type: 'addToGroup', value: 'g1' }, { type: 'proposeMerge' }] })];
    const plan = planAutomation(rules, { trigger: 'create', card: GRACE });
    expect(plan.groups).toEqual(['g1']);
    expect(plan.proposeMerge).toBe(true);
  });

  it('removes the last tag, leaving an empty map', () => {
    const plan = planAutomation([rule({ actions: [{ type: 'removeTag', value: 'maths' }] })], { trigger: 'create', card: ADA });
    expect(plan.keywords).toEqual({});
  });
});

describe('previewRule', () => {
  it('counts matches and shows what would change, skipping groups', () => {
    const preview = previewRule(rule({ condition: 'is:person' }), [ADA, GRACE, GROUP]);
    expect(preview.count).toBe(2);
    expect(preview.changes.map((change) => change.id)).toEqual(['a', 'g']);
    expect(preview.changes[0].plan.keywords).toEqual({ maths: true, vip: true });
  });

  it('reports a broken condition', () => {
    expect(previewRule(rule({ condition: 'tag:vip OR' }), [ADA]).errors[0]).toMatchObject({ reason: 'dangling-or' });
  });
});

describe('withMember', () => {
  it('adds a member and is a no-op when they are already one', () => {
    expect(withMember(GROUP, 'g')).toEqual({
      m0: { kind: 'individual', value: 'a' },
      m1: { kind: 'individual', value: 'g' },
    });
    expect(withMember(GROUP, 'a')).toBeNull();
    expect(withMember(GROUP, '')).toBeNull();
  });
});

describe('applyAutomation', () => {
  it('writes the tag patch and records one automation entry', async () => {
    const api = fakeApi({ handlers: { 'contacts.update': async () => {} } });
    const plan = planAutomation([rule()], { trigger: 'create', card: GRACE });
    const result = await applyAutomation(api, GRACE, plan, { now: 1000 });

    expect(result.updated).toBe(1);
    expect(api.calls('contacts.update')[0].args).toEqual(['g', { keywords: { vip: true } }]);
    expect((await readHistory(api))[0]).toMatchObject({ kind: 'automation', contacts: 1 });
  });

  it('adds the contact to a group', async () => {
    const api = fakeApi({ handlers: { 'contacts.update': async () => {} } });
    const plan = planAutomation([rule({ actions: [{ type: 'addToGroup', value: 'g1' }] })], { trigger: 'create', card: GRACE });
    const result = await applyAutomation(api, GRACE, plan, { cards: [GROUP] });

    expect(result.groups).toBe(1);
    const call = api.calls('contacts.update').find((entry) => entry.args[0] === 'g1');
    expect(call.args[1].members.m1).toEqual({ kind: 'individual', value: 'g' });
  });

  it('proposes a merge without writing a contact', async () => {
    const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));
    const duplicate = makeCard({ id: 'd', name: 'Ada Lovelace', emails: ['ada@example.org'] });
    const api = fakeApi({ translations: manifest.locales, handlers: { 'contacts.search': async () => [duplicate] } });
    const plan = planAutomation([rule({ actions: [{ type: 'proposeMerge' }] })], { trigger: 'create', card: ADA });
    const result = await applyAutomation(api, ADA, plan);

    expect(result.proposed).toBe(true);
    expect(api.calls('toast.info').at(-1).args[0]).toContain('A merge looks worth reviewing');
    expect(api.calls('contacts.update')).toHaveLength(0);
  });

  it('never throws when a write is refused', async () => {
    const api = fakeApi({ handlers: { 'contacts.update': async () => { throw new Error('nope'); } } });
    const plan = planAutomation([rule()], { trigger: 'create', card: GRACE });
    await expect(applyAutomation(api, GRACE, plan)).resolves.toMatchObject({ updated: 0, failed: 1 });
  });
});

describe('runAutomationForCard', () => {
  it('does nothing when no rule matches the trigger', async () => {
    const api = fakeApi({ handlers: { 'contacts.update': async () => {} } });
    await saveRule(api, rule({ trigger: 'update' }));
    const result = await runAutomationForCard(api, { trigger: 'create', card: GRACE });
    expect(result.matched).toBe(0);
    expect(api.calls('contacts.update')).toHaveLength(0);
  });

  it('runs the matching rules for the trigger', async () => {
    const api = fakeApi({ handlers: { 'contacts.update': async () => {} } });
    await saveRule(api, rule({ trigger: 'create', condition: 'tag:maths' }));
    const result = await runAutomationForCard(api, { trigger: 'create', card: ADA });

    expect(result).toMatchObject({ matched: 1, updated: 1 });
    expect(api.calls('contacts.update')[0].args).toEqual(['a', { keywords: { maths: true, vip: true } }]);
  });

  it('skips a group card, which is never a person to tag', async () => {
    const api = fakeApi({ handlers: { 'contacts.update': async () => {} } });
    await saveRule(api, rule({ trigger: 'update' }));
    const result = await runAutomationForCard(api, { trigger: 'update', card: GROUP });
    expect(result.matched).toBe(0);
    expect(api.calls('contacts.update')).toHaveLength(0);
  });
});

describe('runAutomationForCards', () => {
  it('runs the import trigger over a batch', async () => {
    const api = fakeApi({
      handlers: { 'contacts.update': async () => {}, 'contacts.list': async () => [ADA, GRACE] },
    });
    await saveRule(api, rule({ trigger: 'import', actions: [{ type: 'addTag', value: 'imported' }] }));
    const result = await runAutomationForCards(api, { trigger: 'import', cards: [ADA, GRACE] });

    expect(result).toMatchObject({ contacts: 2, updated: 2 });
    expect(api.calls('contacts.update')).toHaveLength(2);
  });
});

