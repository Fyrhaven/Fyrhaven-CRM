// The vCard writer behind the bulk export.
import { describe, expect, it } from 'vitest';
import { cardToVCard, contactsToVCard } from '../src/lib/vcard.js';
import { makeCard } from './fixtures.mjs';

describe('vCard export', () => {
  it('writes one VCARD per contact, with CRLF line endings', () => {
    const body = contactsToVCard([
      makeCard({ id: 'a', name: 'Ada Lovelace' }),
      makeCard({ id: 'b', name: 'Grace Hopper' }),
    ]);

    expect(body.match(/BEGIN:VCARD/g)).toHaveLength(2);
    expect(body.match(/END:VCARD/g)).toHaveLength(2);
    expect(body).toContain('VERSION:3.0');
    expect(body).toContain('\r\n');
    expect(body.endsWith('END:VCARD\r\n')).toBe(true);
  });

  it('carries the fields a mail client can import', () => {
    const vcf = cardToVCard(makeCard({
      id: 'a',
      name: 'Ada Lovelace',
      emails: ['ada@example.org'],
      phones: ['+4917612345678'],
      organizations: { o: { name: 'Engines Ltd' } },
      titles: { t: { name: 'Analyst' } },
      notes: { n: { note: 'Met at a talk' } },
      nicknames: { k: { name: 'Ada' } },
      addresses: { h: { street: 'Main 1', locality: 'Berlin', country: 'DE' } },
      onlineServices: { w: { uri: 'https://ada.example' } },
    }));

    expect(vcf).toContain('FN:Ada Lovelace');
    // N is family;given, not the other way round
    expect(vcf).toContain('N:Lovelace;Ada;;;');
    expect(vcf).toContain('EMAIL;TYPE=OTHER:ada@example.org');
    expect(vcf).toContain('TEL;TYPE=OTHER:+4917612345678');
    expect(vcf).toContain('ORG:Engines Ltd');
    expect(vcf).toContain('TITLE:Analyst');
    expect(vcf).toContain('NICKNAME:Ada');
    expect(vcf).toContain('NOTE:Met at a talk');
    expect(vcf).toContain('URL:https://ada.example');
    expect(vcf).toContain('ADR;TYPE=OTHER:;;Main 1;Berlin;;;DE');
  });

  it('escapes the characters the format reserves', () => {
    const vcf = cardToVCard(makeCard({
      id: 'a',
      name: 'Smith, John',
      notes: { n: { note: 'Line one\nLine two; and, more\\' } },
    }));

    expect(vcf).toContain('FN:Smith\\, John');
    expect(vcf).toContain('NOTE:Line one\\nLine two\\; and\\, more\\\\');
  });

  it('keeps a contact that is only a name, and drops one with nothing at all', () => {
    expect(cardToVCard({ id: 'a', name: { full: 'Ada Lovelace' } })).toContain('FN:Ada Lovelace');
    expect(cardToVCard({ id: 'b' })).toBe('');
    expect(contactsToVCard([{ id: 'b' }])).toBe('');
  });

  it('reads a name given as first and last name fields', () => {
    expect(cardToVCard({ id: 'a', firstName: 'Ada', lastName: 'Lovelace' })).toContain('N:Lovelace;Ada;;;');
  });
});
