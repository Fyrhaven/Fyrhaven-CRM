// Avatars: the hash Gravatar needs, the URL it builds, and whose picture wins.
import { describe, expect, it } from 'vitest';
import { GRAVATAR_BASE, avatarFor, gravatarUrl, md5 } from '../src/lib/avatar.js';
import { mediaUris } from '../src/lib/contacts.js';
import { makeCard } from './fixtures.mjs';

describe('md5', () => {
  it('matches the published vectors', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5('The quick brown fox jumps over the lazy dog')).toBe('9e107d9d372bb6826bd81d3542a419d6');
    // the canonical example from the Gravatar documentation
    expect(md5('myemailaddress@example.com')).toBe('0bc83cb571cd1c50ba6f3e8a78ef1346');
  });

  it('matches across the block and encoding boundaries', () => {
    // each of these was checked against node's crypto, which is the point of
    // having the algorithm here at all
    expect(md5('ü')).toBe('c03410a5204b21cd8229ff754688d743');
    expect(md5('北京')).toBe('692e92669c0ca340eff4fdcef32896ee');
    expect(md5('a'.repeat(1000))).toBe('cabe45dcc9ae5b66ba86600cca6b8ba8');
    expect(md5('Ada Lovelace <ada@example.org>')).toBe('88360b0d6d4c484917d9cc58a9bd4e99');
  });

  it('hashes a string, not an object', () => {
    expect(md5(undefined)).toBe(md5('undefined'));
    expect(md5(42)).toBe(md5('42'));
  });
});

describe('gravatarUrl', () => {
  it('builds the documented URL shape', () => {
    expect(gravatarUrl('myemailaddress@example.com'))
      .toBe(`${GRAVATAR_BASE}0bc83cb571cd1c50ba6f3e8a78ef1346?s=80&d=404&r=g`);
  });

  it('trims and lower-cases the address first', () => {
    expect(gravatarUrl('  MyEmailAddress@Example.COM  ')).toBe(gravatarUrl('myemailaddress@example.com'));
  });

  it('takes a size, and asks for a 404 rather than a placeholder', () => {
    expect(gravatarUrl('a@b.de', { size: 160 })).toContain('?s=160&d=404&r=g');
    expect(gravatarUrl('a@b.de', { fallback: 'mp' })).toContain('d=mp');
  });

  it('has nothing to build without an address', () => {
    expect(gravatarUrl('')).toBe('');
    expect(gravatarUrl('   ')).toBe('');
    expect(gravatarUrl(null)).toBe('');
  });
});

describe('mediaUris', () => {
  it('reads the photos a contact carries, photos first', () => {
    const card = {
      id: 'a',
      media: { m1: { kind: 'logo', uri: 'https://x/logo.png' }, m2: { kind: 'photo', uri: 'https://x/me.jpg' } },
    };

    expect(mediaUris(card)).toEqual(['https://x/me.jpg', 'https://x/logo.png']);
    expect(mediaUris({ id: 'b' })).toEqual([]);
    expect(mediaUris(null)).toEqual([]);
  });
});

describe('avatarFor', () => {
  it('prefers the photo stored on the contact, and asks nobody for it', () => {
    const card = makeCard({
      id: 'a', emails: ['ada@example.org'], media: { m: { kind: 'photo', uri: 'https://x/me.jpg' } },
    });

    expect(avatarFor(card, { gravatar: true })).toEqual({ url: 'https://x/me.jpg', source: 'card' });
    expect(avatarFor(card, { gravatar: false })).toEqual({ url: 'https://x/me.jpg', source: 'card' });
  });

  it('falls back to Gravatar only when it is turned on', () => {
    const card = makeCard({ id: 'a', emails: ['ada@example.org'] });

    expect(avatarFor(card, { gravatar: false })).toBeNull();
    expect(avatarFor(card, { gravatar: true }))
      .toEqual({ url: gravatarUrl('ada@example.org'), source: 'gravatar' });
  });

  it('has nothing to show without a photo or an address', () => {
    expect(avatarFor(makeCard({ id: 'a', phones: ['0176 1234567'] }), { gravatar: true })).toBeNull();
    expect(avatarFor({ id: 'a' }, { gravatar: true })).toBeNull();
    expect(avatarFor(null, { gravatar: true })).toBeNull();
  });
});
