// The normalisation rules engine: what each rule does, the order they run in,
// the plan it produces, and the storage behind it. Pure — no DOM.
import { describe, expect, it } from 'vitest';
import { fakeApi } from '../test-utils/fake-api.mjs';
import {
  BUILTIN_IDS, MAX_USER_RULES, RULES_KEY, applyRulesToCard, applyToField, hasRules, newRuleId,
  normalizeRules, orderedRules, planRules, readRules, ruleChangesForCard, ruleCounts, writeRules,
} from '../src/lib/rules.js';

const person = (overrides = {}) => ({ id: 'p1', addressBookIds: { b1: true }, ...overrides });
const named = (full) => ({ name: { full } });
const builtin = (id) => ({ id, builtin: true });
const userRule = (id, field, from, to) => ({ id, field, from, to });

describe('normalizeRules', () => {
  it('keeps known built-ins and usable user rules, in that order', () => {
    const rules = normalizeRules([
      builtin('org.suffix'),
      userRule('r1', 'organization', 'ACME', 'Acme'),
      builtin('name.space'),
    ]);
    expect(rules.map((rule) => rule.id)).toEqual(['org.suffix', 'name.space', 'r1']);
    expect(rules[2]).toEqual({ id: 'r1', field: 'organization', from: 'ACME', to: 'Acme' });
  });

  it('drops junk, unknown built-ins, rules with nothing to find and duplicates', () => {
    const rules = normalizeRules([
      null,
      'nonsense',
      { id: 'not.a.rule' },
      builtin('name.space'),
      builtin('name.space'),
      userRule('r1', 'nonsense-field', 'a', 'b'),
      userRule('r2', 'name', '   ', 'b'),
      userRule('r3', 'name', 'Bob', 'Robert'),
    ]);
    expect(rules.map((rule) => rule.id)).toEqual(['name.space', 'r3']);
  });

  it('caps the user rules', () => {
    const many = Array.from({ length: MAX_USER_RULES + 5 }, (_, i) => userRule(`r${i}`, 'name', `a${i}`, 'b'));
    expect(normalizeRules(many)).toHaveLength(MAX_USER_RULES);
  });

  it('reads a rule with no replacement as a deletion', () => {
    expect(normalizeRules([userRule('r1', 'organization', ' GmbH', '')])[0].to).toBe('');
  });
});

describe('orderedRules', () => {
  it('runs the built-ins in catalogue order however they were stored', () => {
    const ordered = orderedRules([builtin('email.case'), builtin('name.space'), builtin('phone.e164')]);
    expect(ordered.map((rule) => rule.id)).toEqual(['name.space', 'phone.e164', 'email.case']);
  });

  it('runs the user rules after the built-ins, in the order they were added', () => {
    const ordered = orderedRules([
      userRule('r2', 'name', 'second', 'x'),
      builtin('name.space'),
      userRule('r1', 'name', 'first', 'y'),
    ]);
    expect(ordered.map((rule) => rule.id)).toEqual(['name.space', 'r2', 'r1']);
  });

  it('is empty when nothing is enabled', () => {
    expect(orderedRules([])).toEqual([]);
    expect(hasRules([])).toBe(false);
    expect(hasRules([builtin('name.space')])).toBe(true);
  });

  it('offers every built-in id in the catalogue', () => {
    expect(BUILTIN_IDS).toContain('org.suffix');
    expect(new Set(BUILTIN_IDS).size).toBe(BUILTIN_IDS.length);
  });

  it('makes a new user rule id', () => {
    expect(newRuleId()).not.toBe(newRuleId());
  });
});

describe('applyToField', () => {
  it('walks name components and the full name, keeping the shape', () => {
    const card = person({
      name: { full: 'Ada Lovelace', components: { a: { kind: 'given', value: 'Ada' }, b: { kind: 'surname', value: 'Lovelace' } } },
    });
    const next = applyToField(card, 'name', (value) => value.toUpperCase());
    expect(next.full).toBe('ADA LOVELACE');
    expect(next.components.a).toEqual({ kind: 'given', value: 'ADA' });
    expect(next.components.b).toEqual({ kind: 'surname', value: 'LOVELACE' });
  });

  it('keeps an array an array', () => {
    const card = person({ organizations: [{ name: 'Acme' }, { name: 'Beta' }] });
    expect(applyToField(card, 'organization', (value) => value.toUpperCase()))
      .toEqual([{ name: 'ACME' }, { name: 'BETA' }]);
  });

  it('returns null when nothing changed, and for a field the card does not have', () => {
    expect(applyToField(person(named('Ada')), 'name', (value) => value)).toBeNull();
    expect(applyToField(person(), 'phone', (value) => value.toUpperCase())).toBeNull();
  });

  it('leaves a value alone when the transform returns null', () => {
    const card = person({ phones: { p0: { number: 'nonsense' } } });
    expect(applyToField(card, 'phone', () => null)).toBeNull();
  });
});

describe('the built-in rules', () => {
  const run = (card, rules, region = '') => ruleChangesForCard(card, rules, { region });

  it('collapses whitespace in a name', () => {
    const plan = run(person(named('Ada   Lovelace')), [builtin('name.space')]);
    expect(plan.patch.name.full).toBe('Ada Lovelace');
    expect(plan.changes).toEqual([{ field: 'name', from: 'Ada   Lovelace', to: 'Ada Lovelace' }]);
  });

  it('title-cases a shouting name and leaves a mixed-case one alone', () => {
    expect(run(person(named('ADA LOVELACE')), [builtin('name.case')]).patch.name.full)
      .toBe('Ada Lovelace');
    expect(run(person(named('McDonald')), [builtin('name.case')])).toBeNull();
    expect(run(person(named('Ada Lovelace')), [builtin('name.case')])).toBeNull();
  });

  it('collapses whitespace and title-cases an organisation', () => {
    const card = person({ organizations: { o0: { name: 'ACME   Inc.' } } });
    const plan = run(card, [builtin('org.space'), builtin('org.case')]);
    expect(plan.patch.organizations.o0.name).toBe('Acme Inc.');
  });

  it('strips a trailing legal suffix, and never the whole name', () => {
    const suffix = [builtin('org.suffix')];
    const org = (name) => person({ organizations: { o0: { name } } });
    expect(run(org('Acme Inc.'), suffix).patch.organizations.o0.name).toBe('Acme');
    expect(run(org('Acme Pty Ltd'), suffix).patch.organizations.o0.name).toBe('Acme');
    expect(run(org('Acme GmbH & Co. KG'), suffix).patch.organizations.o0.name).toBe('Acme');
    // a company actually called "Inc." keeps its name
    expect(run(org('Inc.'), suffix)).toBeNull();
    expect(run(org('Acme'), suffix)).toBeNull();
  });

  it('rewrites a national phone number when the region is known', () => {
    const card = person({ phones: { p0: { number: '0176 1234567' } } });
    expect(run(card, [builtin('phone.e164')], 'DE').patch.phones.p0.number).toBe('+491761234567');
    // without a region there is nothing honest to do
    expect(run(card, [builtin('phone.e164')])).toBeNull();
    expect(run(person({ phones: { p0: { number: 'nonsense' } } }), [builtin('phone.e164')], 'DE')).toBeNull();
  });

  it('trims and lower-cases an email address', () => {
    const card = person({ emails: { e0: { address: '  Ada@Example.ORG ' } } });
    expect(run(card, [builtin('email.case')]).patch.emails.e0.address).toBe('ada@example.org');
  });
});

describe('the user rules', () => {
  it('replaces a literal, ignoring case', () => {
    const card = person({ organizations: { o0: { name: 'acme gmbh' } } });
    const plan = ruleChangesForCard(card, [userRule('r1', 'organization', 'ACME', 'Acme')]);
    expect(plan.patch.organizations.o0.name).toBe('Acme gmbh');
  });

  it('deletes when the replacement is empty', () => {
    const card = person({ organizations: { o0: { name: 'Acme GmbH' } } });
    const plan = ruleChangesForCard(card, [userRule('r1', 'organization', ' GmbH', '')]);
    expect(plan.patch.organizations.o0.name).toBe('Acme');
  });

  it('treats the find text literally, not as a pattern', () => {
    const card = person(named('Ada (Lovelace)'));
    const plan = ruleChangesForCard(card, [userRule('r1', 'name', '(Lovelace)', 'Byron')]);
    expect(plan.patch.name.full).toBe('Ada Byron');
  });

  it('reaches every phone and email of a card', () => {
    const card = person({
      phones: { p0: { number: '+49 176 1' }, p1: { number: '+49 176 2' } },
      emails: { e0: { address: 'a@x.test' }, e1: { address: 'b@y.test' } },
    });
    const plan = ruleChangesForCard(card, [
      userRule('r1', 'phone', '+49', '+43'),
      userRule('r2', 'email', '@', '@mail.'),
    ]);
    expect(plan.patch.phones.p0.number).toBe('+43 176 1');
    expect(plan.patch.phones.p1.number).toBe('+43 176 2');
    expect(plan.patch.emails.e0.address).toBe('a@mail.x.test');
    expect(plan.changes).toHaveLength(4);
  });
});


describe('the plan', () => {
  const cards = [
    person({ id: 'p1', ...named('ADA   LOVELACE') }),
    person({ id: 'p2', ...named('Grace Hopper') }),
  ];
  const rules = [builtin('name.space'), builtin('name.case')];

  it('lists only the contacts that would change, with what was replaced', () => {
    const plan = planRules(cards, rules);
    expect(plan.map((item) => item.id)).toEqual(['p1']);
    expect(plan[0].before.name).toEqual({ full: 'ADA   LOVELACE' });
    expect(plan[0].patch.name.full).toBe('Ada Lovelace');
    expect(plan[0].name).toBe('ADA   LOVELACE');
  });

  it('counts what it would touch', () => {
    expect(ruleCounts(planRules(cards, rules))).toEqual({
      contacts: 1,
      changes: 1,
      byField: { name: 1, organization: 0, phone: 0, email: 0 },
    });
    expect(ruleCounts([])).toEqual({
      contacts: 0, changes: 0, byField: { name: 0, organization: 0, phone: 0, email: 0 },
    });
  });

  it('is deterministic: the same input and rules give the same plan', () => {
    const a = planRules(cards, [builtin('name.case'), builtin('name.space')]);
    const b = planRules(cards, [builtin('name.space'), builtin('name.case')]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('plans nothing without rules', () => {
    expect(planRules(cards, [])).toEqual([]);
    expect(ruleChangesForCard(cards[0], [])).toBeNull();
  });

  it('gives the card with the rules applied, unchanged when there is nothing to do', () => {
    expect(applyRulesToCard(cards[0], rules).name.full).toBe('Ada Lovelace');
    const untouched = person({ id: 'p3', ...named('Grace Hopper') });
    expect(applyRulesToCard(untouched, rules)).toBe(untouched);
  });
});

describe('the stored rules', () => {
  it('reads and repairs what storage holds', async () => {
    const api = fakeApi();
    await api.storage.set(RULES_KEY, [builtin('name.space'), { id: 'junk' }]);
    expect((await readRules(api)).map((rule) => rule.id)).toEqual(['name.space']);
    // the junk was dropped, so storage was rewritten
    expect(await api.storage.get(RULES_KEY)).toEqual([{ id: 'name.space', field: 'name', builtin: true }]);
  });

  it('removes the key rather than storing an empty set', async () => {
    const api = fakeApi();
    await writeRules(api, [builtin('name.space')]);
    expect(await api.storage.get(RULES_KEY)).toHaveLength(1);
    await writeRules(api, []);
    expect(await api.storage.get(RULES_KEY)).toBeNull();
    expect(await readRules(api)).toEqual([]);
  });

  it('survives junk in storage', async () => {
    const api = fakeApi();
    await api.storage.set(RULES_KEY, 'not a list');
    expect(await readRules(api)).toEqual([]);
  });
});

