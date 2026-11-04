// Smarter name matching (#8): the folding, the nickname table, the phonetic key,
// and the pairwise pass that must stay quiet on different people.
import { describe, expect, it } from 'vitest';
import {
  canonicalToken, foldName, foldVariants, givenKind, jaroWinkler, nicknameKey,
  pairNameEvidence, phoneticKey, splitName,
} from '../src/lib/name-match.js';

describe('foldName', () => {
  it('folds case, diacritics and punctuation, and sorts nothing', () => {
    expect(foldName('  DOÈ, John!! ')).toBe('doe john');
    expect(foldName('ŁUKASZ')).toBe('lukasz');
  });

  it('romanises the scripts it knows, so one name has one key', () => {
    expect(foldName('Иванов')).toBe('ivanov');
    // consistency beats convention here: "й" is "i" in this table, always
    expect(foldName('Сергей')).toBe('sergei');
    expect(foldName('Γιώργος')).toBe('giorgos');
    expect(foldName('Đorđe')).toBe('dorde');
  });

  it('keeps a script it has no table for — a name never collapses to nothing', () => {
    expect(foldName('王')).toBe('王');
    expect(foldName('محمد')).toBe('محمد');
  });

  it('maps the letters with no decomposition of their own', () => {
    expect(foldName('Straße')).toBe('strasse');
    expect(foldName('Søren')).toBe('soren');
    expect(foldName('Þór')).toBe('thor');
    expect(foldName('Ægir')).toBe('aegir');
  });
});

describe('foldVariants', () => {
  it('offers both honest German spellings, and only the ones that differ', () => {
    expect(foldVariants('Müller').sort()).toEqual(['mueller', 'muller']);
    expect(foldVariants('Mueller')).toEqual(['mueller']);
    expect(foldVariants('Smith')).toEqual(['smith']);
  });

  it('is empty for an empty name', () => {
    expect(foldVariants('')).toEqual([]);
    expect(foldVariants(null)).toEqual([]);
  });
});

describe('nicknames', () => {
  it('knows the names people actually answer to', () => {
    expect(canonicalToken('bob')).toBe('robert');
    expect(canonicalToken('bobby')).toBe('robert');
    expect(canonicalToken('bill')).toBe('william');
    expect(canonicalToken('jim')).toBe('james');
    expect(canonicalToken('peggy')).toBe('margaret');
    expect(canonicalToken('robert')).toBe('robert');
    expect(canonicalToken('smith')).toBe('smith');
  });

  it('leaves an ambiguous alias alone rather than guessing', () => {
    // "Alex" is Alexander and Alexandra; "Pat" is Patrick and Patricia
    expect(canonicalToken('alex')).toBe('alex');
    expect(canonicalToken('pat')).toBe('pat');
  });

  it('keys a whole name, and refuses a single token', () => {
    expect(nicknameKey('Bob Smith')).toBe('robert smith');
    expect(nicknameKey('Robert Smith')).toBe('robert smith');
    expect(nicknameKey('Bob')).toBe('');
  });
});

describe('phoneticKey', () => {
  it('gives the same sound the same key', () => {
    expect(phoneticKey('smith')).toBe(phoneticKey('smyth'));
    expect(phoneticKey('schmidt')).toBe(phoneticKey('schmitt'));
    expect(phoneticKey('meier')).toBe(phoneticKey('mayer'));
    expect(phoneticKey('smith')).not.toBe(phoneticKey('jones'));
  });

  it('is empty for nothing', () => {
    expect(phoneticKey('')).toBe('');
    expect(phoneticKey(null)).toBe('');
  });
});

describe('jaroWinkler', () => {
  it('is 1 for the same string and 0 for nothing in common', () => {
    expect(jaroWinkler('john', 'john')).toBe(1);
    expect(jaroWinkler('', '')).toBe(1);
    expect(jaroWinkler('john', '')).toBe(0);
  });

  it('rewards a shared opening, which is what a short form looks like', () => {
    expect(jaroWinkler('jon', 'john')).toBeGreaterThan(0.9);
    expect(jaroWinkler('sara', 'sarah')).toBeGreaterThan(0.9);
    expect(jaroWinkler('catherine', 'katharine')).toBeGreaterThan(0.8);
  });

  it('does not confuse two different given names', () => {
    expect(jaroWinkler('jane', 'john')).toBeLessThan(0.8);
    expect(jaroWinkler('bob', 'robert')).toBeLessThan(0.8);
  });
});

describe('splitName', () => {
  it('trusts the name components when the host sends them', () => {
    expect(splitName('', [
      { kind: 'given', value: 'Ada' },
      { kind: 'surname', value: 'Lovelace' },
    ])).toEqual({ surname: 'lovelace', given: ['ada'] });
  });

  it('falls back to the last token of the full name', () => {
    expect(splitName('Ada Lovelace')).toEqual({ surname: 'lovelace', given: ['ada'] });
    expect(splitName('Ada King Lovelace')).toEqual({ surname: 'lovelace', given: ['ada', 'king'] });
    expect(splitName('Prince')).toEqual({ surname: '', given: ['prince'] });
  });
});

describe('givenKind', () => {
  it('is "same" for the same given name, whatever the accents', () => {
    expect(givenKind(['jose'], ['jose'])).toBe('same');
  });

  it('is "initial" when one side is an initial of the other', () => {
    expect(givenKind(['j'], ['john'])).toBe('initial');
    expect(givenKind(['john'], ['j'])).toBe('initial');
    expect(givenKind(['j', 'r'], ['john', 'ronald'])).toBe('initial');
  });

  it('is "similar" for a short form or a typo above the threshold', () => {
    expect(givenKind(['jon'], ['john'], 80)).toBe('similar');
    expect(givenKind(['sara'], ['sarah'], 80)).toBe('similar');
  });

  it('is null when the names are different people', () => {
    expect(givenKind(['jane'], ['john'], 80)).toBeNull();
    expect(givenKind(['bob'], ['robert'], 80)).toBeNull();
    // a different number of names is not evidence of anything
    expect(givenKind(['ada'], ['ada', 'king'], 80)).toBeNull();
    expect(givenKind([], ['ada'], 80)).toBeNull();
  });
});

describe('pairNameEvidence', () => {
  const people = (...names) => names.map((name) => ({ name }));

  it('pairs an initial with the full given name', () => {
    const pairs = pairNameEvidence(people('J. Smith', 'John Smith'));

    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ a: 0, b: 1, kind: 'initial' });
  });

  it('pairs a phonetic surname when the given name is the same', () => {
    const pairs = pairNameEvidence(people('John Smith', 'John Smyth'));

    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ kind: 'phonetic' });
  });

  it('pairs a short form or a typo of the given name', () => {
    expect(pairNameEvidence(people('Jon Smith', 'John Smith'))[0]).toMatchObject({ kind: 'similar' });
    expect(pairNameEvidence(people('Sara Jones', 'Sarah Jones'))[0]).toMatchObject({ kind: 'similar' });
  });

  // The safety property the issue asks for, spelled out.
  it('never pairs two different people who share a common surname', () => {
    expect(pairNameEvidence(people('John Smith', 'Jane Smith'))).toEqual([]);
    expect(pairNameEvidence(people('Bob Smith', 'Robert Smith'))).toEqual([]);
    expect(pairNameEvidence(people('John Smith', 'Mary Smith'))).toEqual([]);
  });

  it('does not treat a number or a bare token as a surname', () => {
    // the regression that collapsed 51 groups into one: "Twin 1" / "Twin 10"
    expect(pairNameEvidence(people('Twin 1', 'Twin 10'))).toEqual([]);
    expect(pairNameEvidence(people('A 1', 'A 2'))).toEqual([]);
  });

  it('leaves a bucket of unrelated Smiths alone and skips one that is too big', () => {
    const crowd = people(...Array.from({ length: 80 }, (_, i) => `John Smith${i}`));
    expect(pairNameEvidence(crowd)).toEqual([]);
  });

  it('needs a given name to corroborate, and a name at all', () => {
    expect(pairNameEvidence(people('Smith', 'Smyth'))).toEqual([]);
    expect(pairNameEvidence([{}, null, { name: '' }])).toEqual([]);
  });

  it('honours the threshold', () => {
    expect(pairNameEvidence(people('Jon Smith', 'John Smith'), { threshold: 100 })).toEqual([]);
    expect(pairNameEvidence(people('Jon Smith', 'John Smith'), { threshold: 80 })).toHaveLength(1);
  });

  it('survives junk', () => {
    expect(pairNameEvidence(null)).toEqual([]);
    expect(pairNameEvidence([null, undefined])).toEqual([]);
  });
});
