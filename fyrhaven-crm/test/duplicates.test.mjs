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

    // without a region the two numbers cannot be known to be the same, so the only
    // evidence left is the name: "A." is an initial for "Ada" (#8), and that is a
    // 'possible' match, never a strong one
    const soft = findDuplicateGroups(cards, {});
    expect(soft).toHaveLength(1);
    expect(soft[0].strength).toBe('possible');
    expect(soft[0].reasons).toEqual([{ type: 'similar', value: 'Ada Lovelace ↔ A. Lovelace' }]);

    const groups = findDuplicateGroups(cards, { region: 'DE' });
    expect(groups).toHaveLength(1);
    expect(groups[0].strength).toBe('strong');
    expect(groups[0].members.map((card) => card.id).sort()).toEqual(['a', 'b']);
    // the phone number is the reason; the name pair is not repeated on top of it
    expect(groups[0].reasons).toEqual([{ type: 'phone', value: '491761234567' }]);
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
    // romanised (#8), so the same name in another script reaches the same key
    expect(normalizeName('Иванов')).toBe('ivanov');
    // and a script with no table is kept, never collapsed to ''
    expect(normalizeName('王')).toBe('王');
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
      email: ['a@x.de'], phone: ['491761234567'], name: ['ada lovelace'], core: ['ada lovelace'], nickname: [],
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

describe('per-book policies in findDuplicateGroups', () => {
  it('excludes contacts only in a disabled book', () => {
    const cards = [
      { id: 'a', name: { full: 'Ada' }, emails: { e0: { address: 'ada@x.de' } }, addressBookIds: { b1: true } },
      { id: 'b', name: { full: 'Ada' }, emails: { e0: { address: 'ada@y.de' } }, addressBookIds: { b1: true } },
    ];
    // without policies, they group by name
    expect(findDuplicateGroups(cards, {})).toHaveLength(1);
    // with b1 disabled, nothing is scanned
    expect(findDuplicateGroups(cards, { policies: { b1: { enabled: false } } })).toEqual([]);
  });

  it('keeps contacts that are in at least one enabled book', () => {
    const cards = [
      { id: 'a', name: { full: 'Ada' }, emails: { e0: { address: 'ada@x.de' } }, addressBookIds: { b1: true, b2: true } },
      { id: 'b', name: { full: 'Ada' }, emails: { e0: { address: 'ada@y.de' } }, addressBookIds: { b2: true } },
    ];
    // b1 disabled but both cards are in b2 (enabled by default), so they still group
    expect(findDuplicateGroups(cards, { policies: { b1: { enabled: false } } })).toHaveLength(1);
  });

  it('skips contacts matching an ignore domain', () => {
    const cards = [
      { id: 'a', name: { full: 'Ada' }, emails: { e0: { address: 'ada@spam.com' } }, addressBookIds: { b1: true } },
      { id: 'b', name: { full: 'Ada' }, emails: { e0: { address: 'ada@work.de' } }, addressBookIds: { b1: true } },
    ];
    expect(findDuplicateGroups(cards, { ignore: { domains: ['spam.com'], tags: [] } })).toEqual([]);
  });

  it('skips contacts matching an ignore tag, on the keywords shape the host uses', () => {
    // `{ tagName: true }`, not an array. The array shape is not something the
    // host produces, and a test built on it hides a rule that matches nothing.
    const cards = [
      makeCard({ id: 'a', name: 'Ada', emails: ['ada@x.de'], keywords: { 'do-not-merge': true } }),
      makeCard({ id: 'b', name: 'Ada', emails: ['ada@y.de'] }),
    ];
    expect(findDuplicateGroups(cards, { ignore: { domains: [], tags: ['do-not-merge'] } })).toEqual([]);
  });

  it('skips contacts matching an ignore company, on part of the name', () => {
    const cards = [
      makeCard({ id: 'a', name: 'Ada', emails: ['ada@x.de'], organizations: { o: { name: 'Acme Inc.' } } }),
      makeCard({ id: 'b', name: 'Ada', emails: ['ada@y.de'] }),
    ];
    expect(findDuplicateGroups(cards, { ignore: { domains: [], tags: [], companies: ['acme'] } })).toEqual([]);
    // The same cards are grouped the moment nothing is ignored — so the
    // assertion above cannot pass because the two never matched anyway.
    expect(findDuplicateGroups(cards, { ignore: { domains: [], tags: [], companies: [] } })).toHaveLength(1);
  });

  it('applies per-book match strategy overrides', () => {
    const cards = [
      { id: 'a', name: { full: 'Ada' }, emails: { e0: { address: 'ada@x.de' } }, addressBookIds: { b1: true } },
      { id: 'b', name: { full: 'Ada' }, emails: { e0: { address: 'ada@y.de' } }, addressBookIds: { b1: true } },
    ];
    // they match by name only
    expect(findDuplicateGroups(cards, {})).toHaveLength(1);
    // turning off name matching for b1 means no match
    expect(findDuplicateGroups(cards, { policies: { b1: { matchByName: false } } })).toEqual([]);
  });
});

// ── Smarter name matching (#8) ──────────────────────────────────
//
// A precision/recall fixture set: every pair that *should* match, and the pairs
// that must not — the second list is the one that matters, because a false
// positive here proposes merging two different people.

describe('name evidence, end to end', () => {
  const pair = (...names) => names.map((name, i) => makeCard({ id: `p${i}`, name, emails: [`p${i}@x.test`] }));
  const group = (cards, opts = {}) => findDuplicateGroups(cards, opts);

  it('recall: the spellings that mean the same person', () => {
    const matches = [
      ['Ada Lovelace', 'A. Lovelace'],       // an initial
      ['John Smith', 'John Smyth'],          // a phonetic surname
      ['Jon Smith', 'John Smith'],           // a short form (in the nickname table)
      ['Sara Jones', 'Sarah Jones'],         // a typo
      ['Bob Smith', 'Robert Smith'],         // a nickname
      ['Müller, Hans', 'Hans Mueller'],      // transliteration
      ['Иванов Иван', 'Ivanov Ivan'],        // romanisation
    ];

    for (const names of matches) {
      const groups = group(pair(...names));
      expect(groups, names.join(' / ')).toHaveLength(1);
      expect(groups[0].strength).toBe('possible');
    }
  });

  it('precision: the pairs that are different people', () => {
    const strangers = [
      ['John Smith', 'Jane Smith'],
      ['John Smith', 'Mary Smith'],
      ['Sara Jones', 'Sara Joneson'],        // a longer surname is not the same one
      ['Ada Lovelace', 'Ada Byron'],
      ['Ann Lee', 'Bob Lee'],
    ];

    for (const names of strangers) {
      expect(group(pair(...names)), names.join(' / ')).toEqual([]);
    }
  });

  it('groups Bob and Robert as a nickname, and says so', () => {
    const groups = group(pair('Bob Smith', 'Robert Smith'));

    expect(groups).toHaveLength(1);
    expect(groups[0].strength).toBe('possible');
    expect(groups[0].reasons).toEqual([{ type: 'nickname', value: 'robert smith' }]);
  });

  it('names both spellings when the evidence is a pair, not a key', () => {
    const groups = group(pair('J. Smith', 'John Smith'));

    expect(groups[0].reasons).toEqual([{ type: 'similar', value: 'J. Smith ↔ John Smith' }]);
  });

  it('never makes a group strong: the merge is still the user\'s decision', () => {
    expect(group(pair('Ada Lovelace', 'A. Lovelace'))[0].strength).toBe('possible');
    expect(group(pair('Bob Smith', 'Robert Smith'))[0].strength).toBe('possible');
  });

  it('honours the threshold, and 0 falls back to the default', () => {
    // "Sara"/"Sarah" is a typo, not a table entry, so only the threshold decides
    const cards = pair('Sara Jones', 'Sarah Jones');

    expect(group(cards, { nameSimilarity: 100 })).toEqual([]);
    expect(group(cards, { nameSimilarity: 80 })).toHaveLength(1);
    expect(group(cards, { nameSimilarity: 0 })).toHaveLength(1);
  });

  it('is off when name matching is off', () => {
    expect(group(pair('J. Smith', 'John Smith'), { matchByName: false })).toEqual([]);
    expect(group(pair('Bob Smith', 'Robert Smith'), { matchByName: false })).toEqual([]);
    expect(group(pair('Müller, Hans', 'Hans Mueller'), { matchByName: false })).toEqual([]);
  });

  it('keeps an email match strong even when the names also agree', () => {
    const cards = [
      makeCard({ id: 'a', name: 'J. Smith', emails: ['same@x.test'] }),
      makeCard({ id: 'b', name: 'John Smith', emails: ['same@x.test'] }),
    ];

    expect(group(cards)[0].strength).toBe('strong');
    // the email explains the group; the name pair is not repeated on top of it
    expect(group(cards)[0].reasons).toEqual([{ type: 'email', value: 'same@x.test' }]);
  });
});
