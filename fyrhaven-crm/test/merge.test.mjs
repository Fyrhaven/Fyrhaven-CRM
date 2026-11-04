import { describe, expect, it } from 'vitest';
import { fakeApi } from '../test-utils/fake-api.mjs';
import {
  DISMISSED_KEY, findGroupFor, mergeGroups, pickPrimary, planMerge,
  readDismissed, writeDismissed,
} from '../src/lib/duplicates.js';
import { findDuplicateGroups } from '../src/lib/duplicates.js';
import { contactName } from '../src/lib/contacts.js';
import { buildEntry } from '../src/lib/undo.js';
import { makeCard } from './fixtures.mjs';

const groupOf = (members) => findDuplicateGroups(members, {})[0];

describe('pickPrimary', () => {
  it('keeps the contact with the most fields, then oldest, then lowest id', () => {
    const rich = makeCard({ id: 'b', name: 'Rich', emails: ['r@x.de'], phones: ['12345678'], organizations: { o: { name: 'ACME' } } });
    const poor = makeCard({ id: 'a', name: 'Poor', emails: ['p@x.de'] });
    expect(pickPrimary([poor, rich]).id).toBe('b');

    const tie1 = makeCard({ id: 'z', name: 'Tie' });
    const tie2 = makeCard({ id: 'a', name: 'Tie' });
    expect(pickPrimary([tie1, tie2]).id).toBe('a');

    const older = makeCard({ id: 'z', name: 'Old', created: '2020-01-01T00:00:00Z' });
    const newer = makeCard({ id: 'a', name: 'New', created: '2024-01-01T00:00:00Z' });
    expect(pickPrimary([newer, older]).id).toBe('z');
  });
});

describe('planMerge', () => {
  it('unions emails without losing the kept contact’s own entries or keys', () => {
    const primary = makeCard({ id: 'a', name: 'A', emails: ['keep@x.de'], notes: { n: { note: 'x' } } });
    const duplicate = makeCard({ id: 'b', name: 'A', emails: ['new@x.de'], phones: ['+49 176 999999'] });
    const plan = planMerge(groupOf([primary, duplicate]));
    expect(plan.primary.id).toBe('a');
    expect(plan.others.map((o) => o.id)).toEqual(['b']);
    // primary's e0 stays untouched; the other address lands under a free key
    expect(plan.patch.emails.e0.address).toBe('keep@x.de');
    expect(Object.values(plan.patch.emails).map((e) => e.address).sort())
      .toEqual(['keep@x.de', 'new@x.de']);
    // phone entries are also copied verbatim
    expect(Object.values(plan.patch.phones).map((p) => p.number)).toEqual(['+49 176 999999']);
  });

  it('does not duplicate an address already present (case-insensitive)', () => {
    const primary = makeCard({ id: 'a', name: 'A', emails: ['Same@X.de'] });
    const duplicate = makeCard({ id: 'b', name: 'A', emails: ['same@x.de'] });
    const plan = planMerge(groupOf([primary, duplicate]));
    expect(plan.patch).toEqual({});
  });

  it('fills a missing name but never overwrites one', () => {
    const withoutName = { id: 'a', addressBookIds: { b1: true }, emails: { e: { address: 'a@x.de' } }, phones: { p: { number: '5551234' } } };
    const donor = makeCard({ id: 'b', name: 'Donor Name', emails: ['a@x.de'] });
    expect(planMerge(groupOf([withoutName, donor])).patch.name).toEqual({ full: 'Donor Name' });

    const named = makeCard({ id: 'a', name: 'Mine', emails: ['a@x.de'] });
    expect(planMerge(groupOf([named, donor])).patch.name).toBeUndefined();
  });

  it('keeps only safe keys: no uid/created/addressBookIds/cryptoKeys/client fields', () => {
    const primary = makeCard({ id: 'a', name: 'A', emails: ['a@x.de'], uid: 'u1', created: '2020-01-01T00:00:00Z' });
    const duplicate = makeCard({ id: 'b', name: 'A', emails: ['b@x.de'], uid: 'u2', cryptoKeys: { c: { uri: 'key' } } });
    const plan = planMerge(groupOf([primary, duplicate]));
    const keys = Object.keys(plan.patch);
    for (const forbidden of ['uid', 'created', 'updated', 'addressBookIds', 'cryptoKeys', 'id', 'accountId']) {
      expect(keys).not.toContain(forbidden);
    }
    // and no undefined anywhere (undefined would clear the field on the wire)
    expect(JSON.stringify(plan.patch)).not.toContain('undefined');
  });

  it('respects an explicit keepId', () => {
    const rich = makeCard({ id: 'a', name: 'Tie', emails: ['r@x.de'], phones: ['12345678'] });
    const poor = makeCard({ id: 'b', name: 'Tie', emails: ['p@x.de'] });
    const plan = planMerge(groupOf([rich, poor]), 'b');
    expect(plan.primary.id).toBe('b');
    expect(plan.others.map((o) => o.id)).toEqual(['a']);
    expect(Object.values(plan.patch.emails).map((e) => e.address)).toContain('r@x.de');
  });

  it('replaces a conflicting single value when the user picks a donor', () => {
    const primary = makeCard({ id: 'a', name: 'Bob Smith', emails: ['bob@x.de'], organizations: { o: { name: 'Acme' } } });
    const duplicate = makeCard({ id: 'b', name: 'Robert Smith', emails: ['bob@x.de'], organizations: { o: { name: 'Globex' } } });
    const plan = planMerge(groupOf([primary, duplicate]), 'a', { name: 'b', organizations: 'b' });

    expect(plan.patch.name).toEqual({ full: 'Robert Smith' });
    expect(plan.patch.organizations).toEqual({ o: { name: 'Globex' } });
    expect(plan.changed).toEqual([
      { field: 'name', value: { full: 'Robert Smith' }, fromId: 'b' },
      { field: 'organizations', value: { o: { name: 'Globex' } }, fromId: 'b' },
    ]);
  });

  it('ignores unknown or empty field choices and keeps the default', () => {
    const primary = makeCard({ id: 'a', name: 'Mine', emails: ['a@x.de'] });
    const duplicate = makeCard({ id: 'b', name: 'Theirs', emails: ['a@x.de'] });
    const plan = planMerge(groupOf([primary, duplicate]), 'a', { name: 'missing', organizations: 'keep' });

    expect(plan.patch.name).toBeUndefined();
    expect(plan.changed).toEqual([]);
  });

  it('adds new keywords but keeps the kept contact’s own', () => {
    const primary = { id: 'a', addressBookIds: { b1: true }, emails: { e: { address: 'a@x.de' } }, keywords: { work: true } };
    const duplicate = { id: 'b', addressBookIds: { b1: true }, emails: { e: { address: 'a@x.de' } }, keywords: { family: true } };
    // the patch is the whole keyword map (the host replaces it wholesale)
    expect(planMerge(groupOf([primary, duplicate])).patch.keywords).toEqual({ work: true, family: true });
  });
});

describe('nickname suggestions', () => {
  const bob = makeCard({ id: 'a', name: 'Bob', emails: ['bob@x.de'] });
  const robert = makeCard({ id: 'b', name: 'Robert Smith', emails: ['bob@x.de'] });

  it('suggests a differing name and keeps it as a nickname by default', () => {
    const plan = planMerge(groupOf([bob, robert]));
    expect(plan.nameSuggestions.map((s) => s.value)).toEqual(['Robert Smith']);
    expect(Object.values(plan.patch.nicknames).map((n) => n.name)).toEqual(['Robert Smith']);
    expect(plan.added.filter((entry) => entry.field === 'nicknames')).toHaveLength(1);
    // the kept contact's own name is untouched
    expect(plan.patch.name).toBeUndefined();
    expect(contactName(plan.primary)).toBe('Bob');
  });

  it('never suggests an equal name (normalised) or an existing nickname', () => {
    const same = makeCard({ id: 'b', name: 'bob', emails: ['bob@x.de'] });
    expect(planMerge(groupOf([bob, same])).nameSuggestions).toEqual([]);

    const withNick = makeCard({ id: 'a', name: 'Bob', emails: ['bob@x.de'], nicknames: { n: { name: 'Robert Smith' } } });
    expect(planMerge(groupOf([withNick, robert])).nameSuggestions).toEqual([]);
  });

  it('drops a suggested name when the user says so', () => {
    const key = planMerge(groupOf([bob, robert])).nameSuggestions[0].key;
    const plan = planMerge(groupOf([bob, robert]), undefined, { nicknames: { [key]: 'drop' } });
    expect(plan.patch.nicknames).toBeUndefined();
    expect(plan.nameSuggestions).toHaveLength(1); // still offered, just not written
  });

  it('adds the name to an existing nickname map without losing its keys', () => {
    const withNick = makeCard({ id: 'a', name: 'Bob', emails: ['bob@x.de'], nicknames: { n: { name: 'Bobby' } } });
    const plan = planMerge(groupOf([withNick, robert]));
    expect(Object.values(plan.patch.nicknames).map((n) => n.name).sort())
      .toEqual(['Bobby', 'Robert Smith']);
    expect(plan.patch.nicknames.n).toEqual({ name: 'Bobby' });
  });

  it('undo records the nickname the merge added', async () => {
    const api = fakeApi({ handlers: { 'contacts.update': async () => {}, 'contacts.remove': async () => {} } });
    const journal = [];
    await mergeGroups(api, [groupOf([bob, robert])], {}, {}, journal);
    const entry = buildEntry(journal[0].plan, journal[0].removedCards);
    // Bob had no nicknames before, so undo clears the whole field
    expect(entry.absent).toContain('nicknames');
  });
});

describe('mergeGroups', () => {
  const fixture = () => [
    makeCard({ id: 'a', name: 'A', emails: ['a@x.de'], notes: { n: { note: 'Friend' } }, organizations: { o: { name: 'ACME' } } }),
    makeCard({ id: 'b', name: 'A', emails: ['a@x.de'], phones: ['+4917612345678'] }),
  ];

  it('patches the kept contact first, then deletes the others', async () => {
    const api = fakeApi({ handlers: { 'contacts.update': async () => {}, 'contacts.remove': async () => {} } });
    const result = await mergeGroups(api, [groupOf(fixture())]);
    expect(result).toEqual({ merged: 1, removed: 1, failed: [] });
    const order = api.calls().map((c) => c.method);
    expect(order).toEqual(['contacts.update', 'contacts.remove']);
    expect(api.calls('contacts.update')[0].args[0]).toBe('a');
    expect(api.calls('contacts.remove')[0].args[0]).toBe('b');
  });

  it('skips the whole group when the update fails — nothing is deleted', async () => {
    const api = fakeApi({ handlers: {
      'contacts.update': async () => { throw new Error('nope'); },
      'contacts.remove': async () => {},
    } });
    const result = await mergeGroups(api, [groupOf(fixture())]);
    expect(result).toEqual({ merged: 0, removed: 0, failed: ['b'] });
    expect(api.calls('contacts.remove')).toHaveLength(0);
  });

  it('collects failed deletions and keeps going', async () => {
    const cards = [
      makeCard({ id: 'a', name: 'A', emails: ['a@x.de'], notes: { n: { note: 'Friend' } } }),
      makeCard({ id: 'b', name: 'A', emails: ['a@x.de'] }),
      makeCard({ id: 'c', name: 'A', emails: ['a@x.de'] }),
    ];
    const api = fakeApi({ handlers: {
      'contacts.update': async () => {},
      'contacts.remove': async (id) => { if (id === 'b') throw new Error('locked'); },
    } });
    const result = await mergeGroups(api, [groupOf(cards)]);
    expect(result.merged).toBe(1);
    expect(result.removed).toBe(1);
    expect(result.failed).toEqual(['b']);
  });

  it('honours keepBySignature', async () => {
    const api = fakeApi({ handlers: { 'contacts.update': async () => {}, 'contacts.remove': async () => {} } });
    const group = groupOf(fixture());
    await mergeGroups(api, [group], { [group.signature]: 'b' });
    expect(api.calls('contacts.update')[0].args[0]).toBe('b');
    expect(api.calls('contacts.remove')[0].args[0]).toBe('a');
  });

  it('writes the field choices selected in the dialog', async () => {
    const cards = [
      makeCard({ id: 'a', name: 'Bob Smith', emails: ['bob@x.de'] }),
      makeCard({ id: 'b', name: 'Robert Smith', emails: ['bob@x.de'] }),
    ];
    const group = groupOf(cards);
    const api = fakeApi({ handlers: { 'contacts.update': async () => {}, 'contacts.remove': async () => {} } });
    await mergeGroups(api, [group], { [group.signature]: 'a' }, { [group.signature]: { name: 'b' } });

    expect(api.calls('contacts.update')[0].args[1].name).toEqual({ full: 'Robert Smith' });
    expect(api.calls('contacts.remove')[0].args[0]).toBe('b');
  });
});

describe('hidden groups storage', () => {
  it('round-trips and dedupes signatures', async () => {
    const api = fakeApi();
    expect(await readDismissed(api)).toEqual([]);
    await writeDismissed(api, ['g:a,b', 'g:a,b', 42]);
    expect(await readDismissed(api)).toEqual(['g:a,b']);
    await writeDismissed(api, []);
    expect(await api.storage.get(DISMISSED_KEY)).toEqual([]);
  });
});

describe('findGroupFor', () => {
  const contact = makeCard({ id: 'x1', name: 'Jane Roe', emails: ['jane@x.io'] });

  it('finds contacts sharing a key and groups them with the contact', async () => {
    const twin = makeCard({ id: 'x2', name: 'Roe, Jane', emails: ['other@x.io'] });
    const stranger = makeCard({ id: 'x3', name: 'Someone Else', emails: ['s@x.io'] });
    const api = fakeApi({ handlers: { 'contacts.search': async () => [contact, twin, stranger] } });
    const group = await findGroupFor(api, contact);
    expect(group.members.map((m) => m.id)).toEqual(['x1', 'x2']);
  });

  it('returns null when nothing matches or the contact is not mergeable', async () => {
    const api = fakeApi({ handlers: { 'contacts.search': async () => [] } });
    expect(await findGroupFor(api, contact)).toBeNull();
    expect(await findGroupFor(api, { id: 'g1', kind: 'group' })).toBeNull();
  });
});

// ── Protected fields (#7) ───────────────────────────────────────
//
// Each test asserts BOTH readings — what a merge does by default and what it
// does once a book protects the field — so it cannot pass by the field simply
// never being written in the first place.

describe('planMerge and the protected fields', () => {
  const frozenBy = (fields, bookId = 'b1') => ({ [bookId]: { protectedFields: fields } });
  const pair = () => [
    makeCard({ id: 'a', name: 'Ada Lovelace', emails: ['ada@x.de'], notes: { n: { note: 'keep me' } } }),
    makeCard({ id: 'b', name: 'A. Lovelace', emails: ['ada@x.de', 'other@x.de'], organizations: { o: { name: 'ACME' } } }),
  ];
  const namePair = () => [
    makeCard({ id: 'a', name: 'Bob', emails: ['bob@x.de'] }),
    makeCard({ id: 'b', name: 'Robert Smith', emails: ['bob@x.de'] }),
  ];

  it('will not fill a protected field from a donor', () => {
    const [a, b] = pair();
    expect(planMerge(groupOf([a, b]), 'a').patch.organizations).toEqual({ o: { name: 'ACME' } });
    const plan = planMerge(groupOf([a, b]), 'a', {}, { policies: frozenBy(['organizations']) });
    expect(plan.patch.organizations).toBeUndefined();
  });

  it('will not union entries into a protected field', () => {
    const [a, b] = pair();
    expect(Object.values(planMerge(groupOf([a, b]), 'a').patch.emails ?? {})).toHaveLength(2);
    const plan = planMerge(groupOf([a, b]), 'a', {}, { policies: frozenBy(['emails']) });
    expect(plan.patch.emails).toBeUndefined();
  });

  it('will not union keywords into a protected keywords map', () => {
    const [a, b] = pair();
    a.keywords = { work: true };
    b.keywords = { family: true };
    expect(planMerge(groupOf([a, b]), 'a').patch.keywords).toEqual({ work: true, family: true });
    const plan = planMerge(groupOf([a, b]), 'a', {}, { policies: frozenBy(['keywords']) });
    expect(plan.patch.keywords).toBeUndefined();
  });

  it('ignores an explicit donor choice for a protected field', () => {
    const [a, b] = pair();
    expect(planMerge(groupOf([a, b]), 'a', { name: 'b' }).patch.name).toEqual({ full: 'A. Lovelace' });
    const plan = planMerge(groupOf([a, b]), 'a', { name: 'b' }, { policies: frozenBy(['name']) });
    expect(plan.patch.name).toBeUndefined();
  });

  it('freezing the name still records the other name as a nickname', () => {
    // Protecting `name` is not protecting `nicknames`: the name is never
    // replaced, and the discarded name is still kept rather than lost (#49).
    const plan = planMerge(groupOf(namePair()), 'a', {}, { policies: frozenBy(['name']) });
    expect(plan.patch.name).toBeUndefined();
    expect(plan.nameSuggestions.map((s) => s.value)).toContain('Robert Smith');
  });

  it('adds no nickname at all when nicknames are protected', () => {
    const plan = planMerge(groupOf(namePair()), 'a', {}, { policies: frozenBy(['nicknames']) });
    expect(plan.nameSuggestions).toEqual([]);
    expect(plan.patch.nicknames).toBeUndefined();
  });

  it('protects a field when ANY of the contact’s books protects it', () => {
    // The union, not the most permissive reading: more protection is the safe
    // way to be wrong.
    const [a, b] = pair();
    a.addressBookIds = { b1: true, b2: true };
    const policies = { b1: { protectedFields: ['organizations'] }, b2: { protectedFields: ['emails'] } };
    const plan = planMerge(groupOf([a, b]), 'a', {}, { policies });
    expect(plan.patch.organizations).toBeUndefined();
    expect(plan.patch.emails).toBeUndefined();
  });

  it('ignores a book that is switched off', () => {
    const [a, b] = pair();
    a.addressBookIds = { b1: true, b2: true };
    const policies = { b2: { enabled: false, protectedFields: ['organizations'] } };
    expect(planMerge(groupOf([a, b]), 'a', {}, { policies }).patch.organizations)
      .toEqual({ o: { name: 'ACME' } });
  });
});

describe('mergeGroups and the protected fields', () => {
  it('freezes the field on the write, not only in the plan', async () => {
    const pair = () => [
      makeCard({ id: 'a', name: 'Ada Lovelace', emails: ['ada@x.de'] }),
      makeCard({ id: 'b', name: 'A. Lovelace', emails: ['ada@x.de'], organizations: { o: { name: 'ACME' } } }),
    ];
    const write = async (policies) => {
      const api = fakeApi({});
      if (policies) await api.storage.set('bookPolicies', policies);
      const group = groupOf(pair());
      const result = await mergeGroups(api, [group], { [group.signature]: 'a' });
      return { patch: api.calls('contacts.update')[0]?.args[1] ?? {}, result };
    };

    const open = await write(null);
    expect(open.patch.organizations).toEqual({ o: { name: 'ACME' } });
    expect(open.result).toEqual({ merged: 1, removed: 1, failed: [] });

    const frozen = await write({ b1: { protectedFields: ['organizations'] } });
    expect(frozen.patch.organizations).toBeUndefined();
    // The merge itself still happens — protection changes what is written, not
    // whether the duplicate is removed.
    expect(frozen.result).toEqual({ merged: 1, removed: 1, failed: [] });
  });
});

