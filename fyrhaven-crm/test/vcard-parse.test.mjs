// Reading vCard back: both versions, the folded lines, and the escapes.
import { describe, expect, it } from 'vitest';
import {
  looksLikeVCard, parseVCards, splitComponents, unescapeText,
} from '../src/lib/vcard-parse.js';

const wrap = (body) => `BEGIN:VCARD\nVERSION:3.0\n${body}\nEND:VCARD`;

describe('unescapeText', () => {
  it('undoes the escapes the format defines', () => {
    expect(unescapeText('Smith\\, John')).toBe('Smith, John');
    expect(unescapeText('line one\\nline two')).toBe('line one\nline two');
    expect(unescapeText('a\\;b')).toBe('a;b');
    expect(unescapeText('back\\\\slash')).toBe('back\\slash');
  });

  it('leaves ordinary text alone, and survives a trailing backslash', () => {
    expect(unescapeText('Ada Lovelace')).toBe('Ada Lovelace');
    expect(unescapeText('trailing\\')).toBe('trailing\\');
  });
});

describe('splitComponents', () => {
  it('splits on unescaped semicolons only', () => {
    expect(splitComponents('Lovelace;Ada;;;')).toEqual(['Lovelace', 'Ada', '', '', '']);
    expect(splitComponents('a\\;b;c')).toEqual(['a;b', 'c']);
  });
});

describe('looksLikeVCard', () => {
  it('recognises a card, whatever the case or the leading blank lines', () => {
    expect(looksLikeVCard('BEGIN:VCARD\nVERSION:3.0')).toBe(true);
    expect(looksLikeVCard('\n\n  begin:vcard')).toBe(true);
    expect(looksLikeVCard('Name,E-mail\nada,x')).toBe(false);
    expect(looksLikeVCard('')).toBe(false);
  });
});

describe('parseVCards', () => {
  it('reads the fields a mail client writes', () => {
    const [card] = parseVCards(wrap([
      'N:Lovelace;Ada;;;',
      'FN:Ada Lovelace',
      'NICKNAME:Ada',
      'ORG:Engines Ltd',
      'TITLE:Analyst',
      'EMAIL;TYPE=PREF:ada@example.org',
      'EMAIL;TYPE=WORK:ada@work.org',
      'TEL;TYPE=CELL:+491761234567',
      'NOTE:Met at a talk',
      'CATEGORIES:maths,vip',
      'ADR;TYPE=HOME:;;Main 1;Berlin;;10115;DE',
    ].join('\n')));

    expect(card).toMatchObject({
      given: 'Ada', surname: 'Lovelace', fullName: 'Ada Lovelace', nickname: 'Ada',
      organization: 'Engines Ltd', title: 'Analyst', notes: 'Met at a talk', tags: 'maths,vip',
    });
    expect(card.emails).toEqual([
      { address: 'ada@example.org', pref: true },
      { address: 'ada@work.org', pref: false },
    ]);
    expect(card.phones).toEqual([{ number: '+491761234567', pref: false }]);
    expect(card.address).toEqual({ street: 'Main 1', locality: 'Berlin', region: '', postcode: '10115', country: 'DE' });
  });

  it('reads a folded line as one value', () => {
    const [card] = parseVCards(wrap('FN:Ada Lovelace\nNOTE:first part\n  and the rest'));

    expect(card.notes).toBe('first part and the rest');
  });

  it('reads 4.0, where the type is a parameter and properties may be grouped', () => {
    const [card] = parseVCards(wrap([
      'FN:Ada Lovelace',
      'item1.EMAIL;TYPE=work:ada@example.org',
      'TEL;VALUE=uri:tel:+491761234567',
    ].join('\n')));

    expect(card.emails).toEqual([{ address: 'ada@example.org', pref: false }]);
    expect(card.phones).toEqual([{ number: 'tel:+491761234567', pref: false }]);
  });

  it('falls back to the parts when there is no FN', () => {
    const [card] = parseVCards(wrap('N:Lovelace;Ada;;;'));

    expect(card.fullName).toBe('Ada Lovelace');
  });

  it('keeps a contact that has only an address', () => {
    const cards = parseVCards(wrap('FN:Ada Lovelace\nEMAIL:ada@example.org'));

    expect(cards).toHaveLength(1);
  });

  it('drops a card with nothing worth keeping', () => {
    expect(parseVCards(wrap('VERSION:3.0'))).toEqual([]);
  });

  it('reads several cards, and ignores text between them', () => {
    const file = `${wrap('FN:Ada Lovelace\nEMAIL:ada@example.org')}\nsome stray text\n${wrap('FN:Grace Hopper\nEMAIL:grace@navy.mil')}`;

    expect(parseVCards(file).map((card) => card.fullName)).toEqual(['Ada Lovelace', 'Grace Hopper']);
  });

  it('does not fall over on an unterminated card', () => {
    expect(parseVCards('BEGIN:VCARD\nFN:Ada Lovelace\n')).toEqual([]);
  });

  it('has nothing for an empty file', () => {
    expect(parseVCards('')).toEqual([]);
    expect(parseVCards(null)).toEqual([]);
  });
});
