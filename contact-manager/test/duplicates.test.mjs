import { describe, expect, it } from 'vitest';
import {
  cardKeys, coreNameKey, findDuplicateGroups, groupFromSelection, nameKey,
  normalizeEmail, normalizeName, normalizePhone,
} from '../src/lib/duplicates.js';
import { makeCard } from './fixtures.mjs';

describe('a hand-picked group', () => {
  it('claims no evidence and signs itself like a detected group', () => {
    const group = groupFromSelection([makeCard({ id: 'b' }), makeCard({ id: 'a' })]);

    expect(group.strength).toBe('manual');
    expect(group.reasons).toEqual([]);
    expect(group.signature).toBe('g:a,b');
    expect(group.members.map((card) => card.id)).toEqual(['b', 'a']);
  });

  it('drops anything without an id, so a bad selection cannot be signed', () => {
    expect(groupFromSelection([{ id: 'a' }, null, {}, { name: 'no id' }]).members).toHaveLength(1);
    expect(groupFromSelection(null).members).toEqual([]);
  });
});

describe('phone keys and the region', () => {
  // set up above: makeCard, findDuplicateGroups
  it('matches a national number against the same one written internationally', () => {
    const cards = [
      makeCard({ id: 'a', name: 'Ada Lovelace', phones: ['0176 1234567'] }),
      makeCard({ id: 'b', name: 'A. Lovelace', phones: ['+49 176 1234567'] }),
    ];

    // without a region the two forms cannot be known to be the same number
    expect(findDuplicateGroups(cards, {})).toEqual([]);

    const groups = findDuplicateGroups(cards, { region: 'DE' });
    expect(groups).toHaveLength(1);
    expect(groups[0].strength).toBe('strong');
    expect(groups[0].members.map((card) => card.id).sort()).toEqual(['a', 'b']);
  });

  it('still matches the international spellings with no region at all', () => {
    const cards = [
      makeCard({ id: 'a', name: 'Ada Lovelace', phones: ['+49 176 1234567'] }),
      makeCard({ id: 'b', name: 'A. Lovelace', phones: ['0049 176 1234567'] }),
    ];

    expect(findDuplicateGroups(cards, {})).toHaveLength(1);
  });

  it('does not merge two different national numbers', () => {
    // different people, different numbers: nothing may group them
    const cards = [
      makeCard({ id: 'a', name: 'Ada Lovelace', phones: ['0176 1234567'] }),
      makeCard({ id: 'b', name: 'Grace Hopper', phones: ['0176 7654321'] }),
    ];

    expect(findDuplicateGroups(cards, { region: 'DE' })).toEqual([]);
  });

  it('leaves a number it cannot normalise as the digits it had', () => {
    const cards = [
      makeCard({ id: 'a', name: 'Ada Lovelace', phones: ['0176 1234567'] }),
      makeCard({ id: 'b', name: 'Ada Lovelace', phones: ['01761234567'] }),
    ];

    // both fall back to the same digit string, so they still group
    expect(findDuplicateGroups(cards, {})).toHaveLength(1);
  });
});

describe('normalisation', () => {
  it('emails: trim + lowercase', () => {
    expect(normalizeEmail('  A@B.DE ')).toBe('a@b.de');
  });

  it('phones: digits only, 00 and + agree, short is empty', () => {
    expect(normalizePhone('+49 (176) 123-4567')).toBe('491761234567');
    expect(normalizePhone('0049 176 1234567')).toBe('491761234567');
    expect(normalizePhone('12345')).toBe('');
  });

  it('names: case, diacritics, punctuation, token order', () => {
    expect(normalizeName('  DOÈ, John!! ')).toBe('doe john');
    expect(nameKey(makeCard({ id: '1', name: 'Doe, John' }))).toBe(nameKey(makeCard({ id: '2', name: 'John Doe' })));
    expect(normalizeName('Иванов')).toBe('иванов'); // non-Latin names survive
  });

  it('core name drops initials so "John A. Smith" ≡ "John Smith"', () => {
    expect(coreNameKey(makeCard({ id: '1', name: 'John A. Smith' })))
      .toBe(coreNameKey(makeCard({ id: '2', name: 'John Smith' })));
    expect(coreNameKey(makeCard({ id: '3', name: 'Smith' }))).toBe(''); // one token is too weak
    expect(nameKey(makeCard({ id: '1', name: 'John A. Smith' })))
      .not.toBe(nameKey(makeCard({ id: '2', name: 'John Smith' })));
  });
});

describe('cardKeys', () => {
  it('honours the strategy toggles', () => {
    const card = makeCard({ id: '1', name: 'Ada Lovelace', emails: ['a@x.de'], phones: ['+491761234567'] });
    expect(cardKeys(card, {})).toEqual({
      email: ['a@x.de'], phone: ['491761234567'], name: ['ada lovelace'], core: ['ada lovelace'],
    });
    expect(cardKeys(card, { matchByEmail: false }).email).toEqual([]);
    expect(cardKeys(card, { matchByPhone: false }).phone).toEqual([]);
    expect(cardKeys(card, { matchByName: false }).name).toEqual([]);
    expect(cardKeys(card, { matchByName: false }).core).toEqual([]);
  });
});

const emailPair = () => [
  makeCard({ id: 'e1', name: 'Ada Lovelace', emails: ['Ada@Example.org'] }),
  makeCard({ id: 'e2', name: 'Augusta Ada', emails: ['ada@example.org'] }),
];
const phonePair = () => [
  makeCard({ id: 'p1', name: 'Alan One', emails: ['one@x.de'], phones: ['+49 176 111111'] }),
  makeCard({ id: 'p2', name: 'Completely Different', emails: ['two@x.de'], phones: ['0049 176 111111'] }),
];
const namePair = () => [
  makeCard({ id: 'n1', name: 'John Doe', emails: ['john@home.org'] }),
  makeCard({ id: 'n2', name: 'Doe, John', emails: ['john@work.org'] }),
];
const all = () => [...emailPair(), ...phonePair(), ...namePair()];

describe('findDuplicateGroups', () => {
  it('groups a shared email address as strong', () => {
    const [group] = findDuplicateGroups(emailPair(), {});
    expect(group.strength).toBe('strong');
    expect(group.reasons).toContainEqual({ type: 'email', value: 'ada@example.org' });
    expect(group.members.map((m) => m.id)).toEqual(['e1', 'e2']);
  });

  it('groups a shared phone number as strong, even across formats', () => {
    const [group] = findDuplicateGroups(phonePair(), {});
    expect(group.strength).toBe('strong');
    expect(group.reasons).toContainEqual({ type: 'phone', value: '49176111111' });
  });

  it('groups the same name in different order as possible', () => {
    const [group] = findDuplicateGroups(namePair(), {});
    expect(group.strength).toBe('possible');
    expect(group.reasons).toEqual([{ type: 'name', value: 'doe john' }]);
  });

  it('finds one group per pair, strong first', () => {
    const groups = findDuplicateGroups(all(), {});
    expect(groups.map((g) => g.strength)).toEqual(['strong', 'strong', 'possible']);
    expect(groups.map((g) => g.signature)).toEqual(['g:e1,e2', 'g:p1,p2', 'g:n1,n2']);
  });

  it('unions transitively through shared keys', () => {
    const cards = [
      makeCard({ id: 'a', name: 'One', emails: ['shared@x.de'] }),
      makeCard({ id: 'b', name: 'Two', emails: ['shared@x.de'], phones: ['+491234567890'] }),
      makeCard({ id: 'c', name: 'Three', phones: ['00491234567890'] }),
    ];
    const [group] = findDuplicateGroups(cards, {});
    expect(group.members.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(group.strength).toBe('strong');
  });

  it('applies the strategy toggles', () => {
    expect(findDuplicateGroups(all(), { matchByEmail: false })).toHaveLength(2);
    expect(findDuplicateGroups(all(), { matchByPhone: false })).toHaveLength(2);
    expect(findDuplicateGroups(all(), { matchByName: false })).toHaveLength(2);
    expect(findDuplicateGroups(all(), { matchByName: false, matchByPhone: false })).toHaveLength(1);
    expect(findDuplicateGroups(all(), { matchByEmail: false, matchByPhone: false })).toHaveLength(1);
  });

  it('leaves unique contacts out and never groups contact groups', () => {
    const cards = [...all(), makeCard({ id: 'u', name: 'Unique', emails: ['u@x.de'] }),
      { id: 'g', kind: 'group', name: { full: 'Ada Lovelace' }, emails: { e: { address: 'ada@example.org' } } }];
    const ids = findDuplicateGroups(cards, {}).flatMap((g) => g.members.map((m) => m.id));
    expect(ids).not.toContain('u');
    expect(ids).not.toContain('g');
  });

  it('hides dismissed signatures; the signature is the sorted id set', () => {
    expect(findDuplicateGroups(all(), {}, ['g:e1,e2'])).toHaveLength(2);
    const reversed = findDuplicateGroups([...all()].reverse(), {});
    expect(reversed.map((g) => g.signature).sort()).toEqual(['g:e1,e2', 'g:n1,n2', 'g:p1,p2']);
  });

  it('returns nothing for empty or unmatched lists', () => {
    expect(findDuplicateGroups([], {})).toEqual([]);
    expect(findDuplicateGroups(emailPair().slice(0, 1), {})).toEqual([]);
  });
});
