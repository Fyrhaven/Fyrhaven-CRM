import { describe, expect, it } from 'vitest';
import {
  addressLabel, addressList, bookIds, bookNamesById, contactName, emailEntries, isMergeable,
  matchOptions, phoneEntries, primaryEmail, primaryPhone,
} from '../src/lib/contacts.js';
import { makeCard } from './fixtures.mjs';

describe('contactName', () => {
  it('reads JSContact names in every shape', () => {
    expect(contactName(makeCard({ id: '1', name: 'Ada Lovelace' }))).toBe('Ada Lovelace');
    expect(contactName({ id: '1', name: { full: 'Ada Lovelace' } })).toBe('Ada Lovelace');
    expect(contactName({ id: '1', name: { components: [
      { kind: 'given', value: 'Ada' }, { kind: 'surname', value: 'Lovelace' },
    ] } })).toBe('Ada Lovelace');
  });

  it('falls back: flat fields, nickname, then email', () => {
    expect(contactName({ id: '1', firstName: 'Ada', lastName: 'Lovelace' })).toBe('Ada Lovelace');
    expect(contactName({ id: '1', nicknames: { n: { name: 'Enchantress' } } })).toBe('Enchantress');
    expect(contactName({ id: '1', emails: { e: { address: 'ada@example.org' } } })).toBe('ada@example.org');
    expect(contactName(null)).toBe('');
  });
});

describe('emailEntries / primaryEmail', () => {
  it('reads the keyed map and drops invalid addresses', () => {
    const card = { id: '1', emails: { a: { address: ' Ada@Example.org ', pref: 2 }, b: { address: 'nope' } } };
    expect(emailEntries(card)).toEqual([{ key: 'a', address: ' Ada@Example.org ', pref: 2 }]);
    expect(primaryEmail(card)).toBe('Ada@Example.org');
  });

  it('reads arrays and plain string values', () => {
    expect(emailEntries({ emails: ['a@b.de'] })).toEqual([{ key: '0', address: 'a@b.de' }]);
    expect(emailEntries({ emails: { x: 'a@b.de' } })).toEqual([{ key: 'x', address: 'a@b.de' }]);
  });

  it('sorts by pref', () => {
    const card = { emails: { a: { address: 'first@x.de' }, b: { address: 'second@x.de', pref: 1 } } };
    expect(primaryEmail(card)).toBe('second@x.de');
  });
});

describe('phoneEntries / primaryPhone', () => {
  it('reads number entries and the phoneNumbers alias', () => {
    expect(phoneEntries({ phones: { p: { number: '+49 176 1234567' } } })[0].number).toBe('+49 176 1234567');
    expect(phoneEntries({ phoneNumbers: { p: { number: '123' } } })[0].number).toBe('123');
    expect(phoneEntries({ phones: [{ number: '5551234' }] })[0].number).toBe('5551234');
    expect(primaryPhone({ phones: { a: { number: '5551' }, b: { number: '5552', pref: 1 } } })).toBe('5552');
  });
});

describe('bookIds / bookNamesById', () => {
  it('reads the membership map, with a single-id fallback', () => {
    expect(bookIds({ addressBookIds: { b1: true, b2: true } })).toEqual(['b1', 'b2']);
    expect(bookIds({ addressBookId: 'b9' })).toEqual(['b9']);
    expect(bookIds({})).toEqual([]);
  });

  it('maps ids to names', () => {
    const map = bookNamesById([{ id: 'b1', name: 'Personal' }, { id: 'b2' }]);
    expect(map.get('b1')).toBe('Personal');
    expect(map.get('b2')).toBe('b2');
  });
});

describe('isMergeable', () => {
  it('takes contacts with an id but never groups', () => {
    expect(isMergeable(makeCard({ id: 'c1' }))).toBe(true);
    expect(isMergeable({ id: 'g1', kind: 'group' })).toBe(false);
    expect(isMergeable({ kind: 'individual' })).toBe(false);
    expect(isMergeable(null)).toBe(false);
  });
});

describe('matchOptions', () => {
  it('treats missing settings as on', () => {
    expect(matchOptions(undefined)).toEqual({ matchByEmail: true, matchByPhone: true, matchByName: true });
    expect(matchOptions({ matchByName: false })).toEqual({ matchByEmail: true, matchByPhone: true, matchByName: false });
  });
});

describe('address fields', () => {
  it('reads the array of { name, email } the webmail actually sends', () => {
    const from = [{ name: 'Ada Lovelace', email: 'ada@example.org' }];

    expect(addressList(from)).toEqual(['ada@example.org']);
    expect(addressLabel(from)).toBe('Ada Lovelace <ada@example.org>');
  });

  it('reads every other shape too', () => {
    expect(addressList('a@b.de')).toEqual(['a@b.de']);
    expect(addressList({ email: 'a@b.de' })).toEqual(['a@b.de']);
    expect(addressList({ address: 'a@b.de' })).toEqual(['a@b.de']);
    expect(addressList([{ email: 'a@b.de' }, { address: 'c@d.de' }])).toEqual(['a@b.de', 'c@d.de']);
    expect(addressList(null)).toEqual([]);
  });

  it('never returns an object, whatever it is handed', () => {
    // rendering the array itself is what crashed the profile (React error #31)
    for (const value of [null, undefined, {}, [], [{}, null], { name: 'only a name' }]) {
      expect(typeof addressLabel(value)).toBe('string');
      for (const entry of addressList(value)) expect(typeof entry).toBe('string');
    }
  });

  it('falls back to the name when there is no address', () => {
    expect(addressLabel({ name: 'Ada' })).toBe('Ada');
    expect(addressLabel([])).toBe('');
  });
});
