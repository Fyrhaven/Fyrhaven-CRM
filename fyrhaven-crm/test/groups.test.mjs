// The group model: what a group card is, the editor's draft round trip, the
// member search, and the duplicates a list may hold. Pure — no api, no DOM.
import { describe, expect, it } from 'vitest';
import { isMergeable } from '../src/lib/contacts.js';
import { findDuplicateGroups } from '../src/lib/duplicates.js';
import {
  duplicatesInGroup, emptyGroupDraft, groupCardFromDraft, groupDraftFromCard,
  groupMemberIds, groupMemberLabel, isGroupCard, memberCandidates, validateGroupDraft,
} from '../src/lib/groups.js';
import { makeCard } from './fixtures.mjs';

const person = (id, name, email) => makeCard({ id, name, emails: email ? [email] : [] });
const group = (id, name, memberIds) => ({
  id,
  kind: 'group',
  name: { full: name },
  members: Object.fromEntries(memberIds.map((value, index) => [`m${index}`, { kind: 'individual', value }])),
  addressBookIds: { b1: true },
});

describe('isGroupCard', () => {
  it('reads the kind, and the keyword a host without kind leaves behind', () => {
    expect(isGroupCard({ id: 'g', kind: 'group' })).toBe(true);
    expect(isGroupCard({ id: 'g', keywords: { group: true } })).toBe(true);
    expect(isGroupCard(person('p1', 'Ada'))).toBe(false);
    expect(isGroupCard({ id: 'c', kind: 'org' })).toBe(false);
    expect(isGroupCard(null)).toBe(false);
  });

  it('keeps a group card out of merging, however it is marked', () => {
    expect(isMergeable({ id: 'g', kind: 'group' })).toBe(false);
    expect(isMergeable({ id: 'g', keywords: { group: true } })).toBe(false);
    expect(isMergeable(person('p1', 'Ada'))).toBe(true);
  });

  it('never groups a contact group with a person, or with another group', () => {
    const cards = [
      person('p1', 'Ada', 'ada@example.org'),
      group('g1', 'Ada', ['p1']),
      group('g2', 'Ada', ['p1']),
      { id: 'g3', keywords: { group: true }, name: { full: 'Ada' } },
    ];
    expect(findDuplicateGroups(cards, {}, [])).toEqual([]);
  });
});

describe('groupMemberIds', () => {
  it('reads the members map, deduplicated and in order', () => {
    const card = { id: 'g', members: { a: { value: 'x' }, b: { value: 'y' }, c: { value: 'x' } } };
    expect(groupMemberIds(card)).toEqual(['x', 'y']);
  });

  it('reads a bare string, an { id } and an array too', () => {
    expect(groupMemberIds({ members: ['x', 'y'] })).toEqual(['x', 'y']);
    expect(groupMemberIds({ members: { a: { id: 'x' } } })).toEqual(['x']);
    expect(groupMemberIds({})).toEqual([]);
  });
});

describe('the group draft', () => {
  const books = [{ id: 'b1', name: 'Personal' }, { id: 'b2', name: 'Work' }];

  it('round-trips a group card through a draft', () => {
    const card = group('g1', 'Team', ['p1', 'p2']);
    expect(groupDraftFromCard(card, books)).toEqual({ name: 'Team', memberIds: ['p1', 'p2'], bookIds: ['b1'] });

    const built = groupCardFromDraft(groupDraftFromCard(card, books), 'edit');
    expect(built.kind).toBe('group');
    expect(built.name).toEqual({ full: 'Team' });
    expect(groupMemberIds(built)).toEqual(['p1', 'p2']);
    expect(built.keywords).toEqual({ group: true });
    expect(built.addressBookIds).toEqual({ b1: true });
  });

  it('requires a name, and a book only on create', () => {
    expect(validateGroupDraft({ name: '', bookIds: [] }, 'create').map((error) => error.field))
      .toEqual(['name', 'books']);
    expect(validateGroupDraft({ name: 'Team', bookIds: [] }, 'edit')).toEqual([]);
    expect(validateGroupDraft({ name: 'Team', bookIds: ['b1'] }, 'create')).toEqual([]);
  });

  it('omits an empty name and an empty members map rather than writing them', () => {
    const card = groupCardFromDraft(emptyGroupDraft(), 'create');
    expect(card.name).toBeUndefined();
    expect(card.members).toBeUndefined();
  });
});

describe('memberCandidates', () => {
  const cards = [
    person('p1', 'Ada Lovelace', 'ada@example.org'),
    person('p2', 'Grace Hopper', 'grace@navy.mil'),
    group('g1', 'Team', ['p1']),
  ];

  it('never offers another group', () => {
    expect(memberCandidates(cards, '').map((card) => card.id)).toEqual(['p1', 'p2']);
  });

  it('filters by the same free text a contact search uses', () => {
    expect(memberCandidates(cards, 'grace').map((card) => card.id)).toEqual(['p2']);
    expect(memberCandidates(cards, 'navy').map((card) => card.id)).toEqual(['p2']);
  });

  it('leaves out the ids already chosen', () => {
    expect(memberCandidates(cards, '', { exclude: ['p1'] }).map((card) => card.id)).toEqual(['p2']);
  });

  it('caps the list so the picker stays a picker', () => {
    const many = Array.from({ length: 40 }, (_, i) => person(`p${i}`, `Person ${i}`));
    expect(memberCandidates(many, '', { limit: 5 })).toHaveLength(5);
  });
});

describe('duplicatesInGroup', () => {
  const a = person('p1', 'Ada Lovelace', 'ada@example.org');
  const b = person('p2', 'Ada Lovelace', 'ada@example.org');
  const c = person('p3', 'Grace Hopper', 'grace@navy.mil');
  const cards = [a, b, c];

  it('finds two members that are one person', () => {
    const found = duplicatesInGroup(group('g1', 'Team', ['p1', 'p2', 'p3']), cards, {});
    expect(found).toHaveLength(1);
    expect(found[0].members.map((member) => member.id).sort()).toEqual(['p1', 'p2']);
  });

  it('finds nothing when the members are all different people', () => {
    expect(duplicatesInGroup(group('g2', 'Team', ['p1', 'p3']), cards, {})).toEqual([]);
  });

  it('never treats a group member as a person to compare', () => {
    const list = [a, group('g1', 'Ada Lovelace', ['p1'])];
    expect(duplicatesInGroup(group('g2', 'Team', ['p1', 'g1']), list, {})).toEqual([]);
  });
});

describe('groupMemberLabel', () => {
  it('names the card, and falls back to the id when it is gone', () => {
    expect(groupMemberLabel(person('p1', 'Ada Lovelace'), 'p1')).toBe('Ada Lovelace');
    expect(groupMemberLabel(undefined, 'gone')).toBe('gone');
  });
});
