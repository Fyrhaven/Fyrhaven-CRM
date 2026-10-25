// Exporting: the CSV writer, and the round trip the issue asks for —
// "exported files re-import without data loss".
import { describe, expect, it } from 'vitest';
import { escapeCell, parseCsv, toCsv } from '../src/lib/csv.js';
import { CSV_COLUMNS, contactsToCsv, contactsToFile } from '../src/lib/export.js';
import { guessMapping } from '../src/lib/import-fields.js';
import { rowsToDrafts } from '../src/lib/import.js';
import { parseVCards } from '../src/lib/vcard-parse.js';
import { contactsToVCard } from '../src/lib/vcard.js';
import { cardFromDraft } from '../src/lib/editor.js';
import { contactName } from '../src/lib/contacts.js';
import { makeCard } from './fixtures.mjs';

const FULL = makeCard({
  id: 'a',
  name: 'Ada Lovelace',
  emails: ['ada@example.org', 'ada@work.org'],
  phones: ['+491761234567', '+493012345678'],
  organizations: { o: { name: 'Engines Ltd' } },
  titles: { t: { name: 'Analyst' } },
  notes: { n: { note: 'Met at a talk' } },
  nicknames: { k: { name: 'Ada' } },
  keywords: { vip: true, maths: true },
  addresses: { h: { street: 'Main 1', locality: 'Berlin', region: 'BE', postcode: '10115', country: 'DE' } },
});

const PLAIN = makeCard({ id: 'b', name: 'Grace Hopper', emails: ['grace@navy.mil'] });

describe('escapeCell and toCsv', () => {
  it('quotes only what needs quoting', () => {
    expect(escapeCell('Ada')).toBe('Ada');
    expect(escapeCell('Smith, John')).toBe('"Smith, John"');
    expect(escapeCell('line\nbreak')).toBe('"line\nbreak"');
    expect(escapeCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(escapeCell(null)).toBe('');
  });

  it('writes CRLF rows, and nothing for nothing', () => {
    expect(toCsv([['a', 'b'], ['1', '2']])).toBe('a,b\r\n1,2\r\n');
    expect(toCsv([])).toBe('');
    expect(toCsv(null)).toBe('');
  });

  it('survives a row that is not a list', () => {
    expect(toCsv([['a'], 'nonsense'])).toBe('a\r\n\r\n');
  });
});

describe('contactsToCsv', () => {
  it('writes one header row and one row per contact', () => {
    const { headers, rows } = parseCsv(contactsToCsv([FULL, PLAIN]));

    expect(headers.slice(0, CSV_COLUMNS.length)).toEqual(CSV_COLUMNS.map((column) => column.header));
    expect(rows).toHaveLength(2);
  });

  it('is as wide as the contact with the most emails and phones', () => {
    const { headers } = parseCsv(contactsToCsv([FULL, PLAIN]));

    expect(headers).toContain('E-mail 1');
    expect(headers).toContain('E-mail 2');
    expect(headers).toContain('Phone 2');
    expect(headers).not.toContain('E-mail 3');
  });

  it('pads the contact that has fewer', () => {
    const { headers, rows } = parseCsv(contactsToCsv([FULL, PLAIN]));
    const phone1 = headers.indexOf('Phone 1');

    expect(rows[0][phone1]).toBe('+491761234567');
    expect(rows[1][phone1]).toBe('');
  });

  it('leaves the company marker out of the tags', () => {
    const { headers, rows } = parseCsv(contactsToCsv([{ ...PLAIN, keywords: { company: true, vip: true } }]));

    expect(rows[0][headers.indexOf('Tags')]).toBe('vip');
  });

  it('has nothing to write for nothing', () => {
    expect(contactsToCsv([])).toBe('');
    expect(contactsToCsv(null)).toBe('');
  });
});

describe('the CSV round trip', () => {
  it('needs no column work: the headers it writes are the headers it recognises', () => {
    const { headers } = parseCsv(contactsToCsv([FULL, PLAIN]));

    expect(guessMapping(headers)).not.toContain('ignore');
  });

  it('brings every field it exports back in', () => {
    const { headers, rows } = parseCsv(contactsToCsv([FULL, PLAIN]));
    const drafts = rowsToDrafts(rows, guessMapping(headers));
    const back = cardFromDraft(drafts[0], 'create');

    expect(back.name.components).toEqual([
      { kind: 'given', value: 'Ada' }, { kind: 'surname', value: 'Lovelace' },
    ]);
    expect(Object.values(back.emails).map((entry) => entry.address)).toEqual(['ada@example.org', 'ada@work.org']);
    expect(Object.values(back.phones).map((entry) => entry.number)).toEqual(['+491761234567', '+493012345678']);
    expect(Object.values(back.organizations)[0].name).toBe('Engines Ltd');
    expect(Object.values(back.titles)[0].name).toBe('Analyst');
    expect(Object.values(back.notes)[0].note).toBe('Met at a talk');
    expect(Object.keys(back.keywords).sort()).toEqual(['maths', 'vip']);
    expect(Object.values(back.addresses)[0])
      .toMatchObject({ street: 'Main 1', locality: 'Berlin', postcode: '10115', country: 'DE' });
  });

  it('brings a plain contact back too, and keeps the two apart', () => {
    const { headers, rows } = parseCsv(contactsToCsv([FULL, PLAIN]));
    const drafts = rowsToDrafts(rows, guessMapping(headers));

    expect(drafts).toHaveLength(2);
    expect(drafts[1].given).toBe('Grace');
    expect(drafts[1].surname).toBe('Hopper');
    expect(drafts[1].emails[0].address).toBe('grace@navy.mil');
  });

  it('survives a name with a comma in it', () => {
    const card = makeCard({ id: 'c', name: 'Smith, John', emails: ['john@example.org'] });
    const { headers, rows } = parseCsv(contactsToCsv([card]));
    const draft = rowsToDrafts(rows, guessMapping(headers))[0];

    // the name survives; how it splits into parts cannot be known from one column
    expect(contactName(cardFromDraft(draft, 'create'))).toBe('Smith, John');
  });
});

describe('the vCard round trip', () => {
  it('brings every field it exports back in', () => {
    const [back] = parseVCards(contactsToVCard([FULL]));

    expect(back.fullName).toBe('Ada Lovelace');
    expect(back.given).toBe('Ada');
    expect(back.surname).toBe('Lovelace');
    expect(back.emails.map((entry) => entry.address)).toEqual(['ada@example.org', 'ada@work.org']);
    expect(back.phones.map((entry) => entry.number)).toEqual(['+491761234567', '+493012345678']);
    expect(back.organization).toBe('Engines Ltd');
    expect(back.title).toBe('Analyst');
    expect(back.notes).toBe('Met at a talk');
    expect(back.tags).toBe('vip,maths');
    expect(back.address).toMatchObject({ street: 'Main 1', locality: 'Berlin', postcode: '10115', country: 'DE' });
  });

  it('keeps a name with a comma in it', () => {
    const [back] = parseVCards(contactsToVCard([makeCard({ id: 'c', name: 'Smith, John' })]));

    expect(back.fullName).toBe('Smith, John');
  });
});

describe('contactsToFile', () => {
  it('names and types each format', () => {
    expect(contactsToFile([PLAIN], 'csv')).toMatchObject({ name: 'contacts.csv', type: 'text/csv' });
    expect(contactsToFile([PLAIN], 'vcard')).toMatchObject({ name: 'contacts.vcf', type: 'text/vcard' });
    // vCard is the default
    expect(contactsToFile([PLAIN]).name).toBe('contacts.vcf');
  });

  it('has nothing for nothing', () => {
    expect(contactsToFile([], 'csv').body).toBe('');
    expect(contactsToFile([], 'vcard').body).toBe('');
  });
});
