// E.164 normalisation: the international formats, the national ones, and the
// cases where it must refuse rather than guess.
import { describe, expect, it } from 'vitest';
import { REGIONS, dialCode, formatE164, isValidE164, phoneKey, toE164 } from '../src/lib/phones.js';

describe('dialCode', () => {
  it('finds a region, and says nothing for one it does not know', () => {
    expect(dialCode('DE')).toBe('49');
    expect(dialCode('de')).toBe('49');
    expect(dialCode('ZZ')).toBe('');
    expect(dialCode('')).toBe('');
    expect(dialCode(null)).toBe('');
  });

  it('lists regions with a unique code', () => {
    const codes = REGIONS.map((entry) => entry.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('toE164', () => {
  it('normalises the international formats without a region', () => {
    expect(toE164('+49 176 1234567')).toBe('+491761234567');
    expect(toE164('+491761234567')).toBe('+491761234567');
    expect(toE164('0049 176 1234567')).toBe('+491761234567');
    expect(toE164('+1 (555) 123-4567')).toBe('+15551234567');
  });

  it('normalises a national number once the region is known', () => {
    expect(toE164('0176 1234567', 'DE')).toBe('+491761234567');
    expect(toE164('(0176) 123 4567', 'DE')).toBe('+491761234567');
    expect(toE164('076 123 45 67', 'SE')).toBe('+46761234567');
    expect(toE164('(020) 7946 0000', 'GB')).toBe('+442079460000');
  });

  it('refuses a national number when the country is unknown', () => {
    // guessing here is how a wrong number gets written onto a contact
    expect(toE164('0176 1234567')).toBe('');
    expect(toE164('0176 1234567', 'ZZ')).toBe('');
  });

  it('refuses an ambiguous national number that already starts with the dial code', () => {
    // German 0491 (Leer) against +49 491 …
    expect(toE164('0491 123456', 'DE')).toBe('');
  });

  it('refuses what is not a usable number', () => {
    expect(toE164('')).toBe('');
    expect(toE164('   ')).toBe('');
    expect(toE164('not a number')).toBe('');
    expect(toE164('12345')).toBe('');
    expect(toE164('+49 123')).toBe('');
    expect(toE164('0123456789012345678', 'DE')).toBe('');
  });

  it('accepts the shortest and longest E.164 lengths', () => {
    expect(toE164('+1234567')).toBe('+1234567');
    expect(toE164('+123456789012345')).toBe('+123456789012345');
    expect(toE164('+1234567890123456')).toBe('');
  });
});

describe('isValidE164', () => {
  it('requires a plus, 7 to 15 digits, and no leading zero', () => {
    expect(isValidE164('+491761234567')).toBe(true);
    expect(isValidE164('491761234567')).toBe(false);
    expect(isValidE164('+0123456')).toBe(false);
    expect(isValidE164('+123456')).toBe(false);
  });
});

describe('phoneKey', () => {
  it('agrees across the ways the same number is written', () => {
    const written = ['+49 176 1234567', '0049 176 1234567', '0176 1234567'];
    const keys = written.map((number) => phoneKey(number, 'DE'));
    expect(keys).toEqual(['491761234567', '491761234567', '491761234567']);
  });

  it('falls back to digits when the number cannot be E.164', () => {
    expect(phoneKey('0176 1234567')).toBe('1761234567');
    expect(phoneKey('5551234')).toBe('5551234');
    expect(phoneKey('12345')).toBe('');
    expect(phoneKey('')).toBe('');
  });

  it('keeps two different numbers apart', () => {
    expect(phoneKey('0176 1234567', 'DE')).not.toBe(phoneKey('0176 7654321', 'DE'));
  });
});

describe('formatE164', () => {
  it('groups a number for display, and leaves anything else alone', () => {
    expect(formatE164('+491761234567')).toBe('+49 176 123 456 7');
    expect(formatE164('nonsense')).toBe('nonsense');
  });
});
