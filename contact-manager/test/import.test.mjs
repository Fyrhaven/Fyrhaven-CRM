// Field mapping and the import plan: a Google CSV in, contacts out, and the
// duplicates it refuses to create.
import { describe, expect, it } from 'vitest';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { guessField, guessMapping, isUsableMapping, mappingKey } from '../src/lib/import-fields.js';
import { applyImport, planImport, rowToDraft, rowsToDrafts, splitName } from '../src/lib/import.js';
import { parseCsv } from '../src/lib/csv.js';
import { makeCard } from './fixtures.mjs';

describe('guessField', () => {
  it('reads the headers Google writes', () => {
    const headers = [
      'Given Name', 'Family Name', 'E-mail 1 - Value', 'Phone 1 - Value',
      'Organization 1 - Name', 'Organization 1 - Title', 'Address 1 - City',
      'Address 1 - Region', 'Address 1 - Postal Code', 'Address 1 - Country',
      'Address 1 - Street', 'Notes', 'Group Membership',
    ];

    expect(guessMapping(headers)).toEqual([
      'given', 'surname', 'email', 'phone', 'organization', 'title', 'locality',
      'region', 'postcode', 'country', 'street', 'notes', 'tags',
    ]);
  });

  it('reads the headers Apple writes', () => {
    expect(guessMapping(['First Name', 'Last Name', 'E-mail Address', 'Home Phone', 'Company']))
      .toEqual(['given', 'surname', 'email', 'phone', 'organization']);
  });

  it('prefers the longer hint, so "Last Name" is a surname and not a name', () => {
    expect(guessField('Last Name')).toBe('surname');
    expect(guessField('Name')).toBe('name');
    expect(guessField('Full Name')).toBe('name');
  });

  it('ignores a column it does not know, and one with no name', () => {
    expect(guessField('Favourite Colour')).toBe('ignore');
    expect(guessField('')).toBe('ignore');
    expect(guessField(null)).toBe('ignore');
  });

  it('does not claim a URL column it cannot store', () => {
    expect(guessField('Website')).toBe('ignore');
  });
});

describe('the mapping as a template key', () => {
  it('is stable across the punctuation a spreadsheet adds', () => {
    expect(mappingKey(['E-mail 1 - Value'])).toBe(mappingKey(['E-mail_1_Value']));
    expect(mappingKey(['E-mail 1 - Value'])).not.toBe(mappingKey(['Phone 1 - Value']));
  });

  it('knows when a mapping does nothing', () => {
    expect(isUsableMapping(['given', 'email'])).toBe(true);
    expect(isUsableMapping(['ignore', 'ignore'])).toBe(false);
    expect(isUsableMapping(null)).toBe(false);
  });
});

describe('splitName', () => {
  it('takes the last token as the family name', () => {
    expect(splitName('Ada Lovelace')).toEqual({ given: 'Ada', surname: 'Lovelace' });
    expect(splitName('Ada King Lovelace')).toEqual({ given: 'Ada King', surname: 'Lovelace' });
    expect(splitName('Ada')).toEqual({ given: 'Ada', surname: '' });
    expect(splitName('  ')).toEqual({ given: '', surname: '' });
  });
});

describe('rowToDraft', () => {
  it('collects several emails and phones, the first preferred', () => {
    const draft = rowToDraft(
      ['Ada', 'Lovelace', 'ada@example.org', 'ada@work.org', '+491761234567'],
      ['given', 'surname', 'email', 'email', 'phone'],
    );

    expect(draft.given).toBe('Ada');
    expect(draft.emails).toEqual([
      { address: 'ada@example.org', pref: true },
      { address: 'ada@work.org', pref: false },
    ]);
    expect(draft.phones).toEqual([{ number: '+491761234567', pref: true }]);
  });

  it('uses a full-name column only when the file has no parts', () => {
    expect(rowToDraft(['Ada Lovelace'], ['name']).given).toBe('Ada');
    expect(rowToDraft(['Ada Lovelace'], ['name']).surname).toBe('Lovelace');
    // the parts win when both are present
    const both = rowToDraft(['Ada', 'Lovelace', 'Grace Hopper'], ['given', 'surname', 'name']);
    expect([both.given, both.surname]).toEqual(['Ada', 'Lovelace']);
  });

  it('fills the address components, and a single column into the street', () => {
    const parts = rowToDraft(['Main 1', 'Berlin', 'BE', '10115', 'DE'], ['street', 'locality', 'region', 'postcode', 'country']);
    expect(parts.address).toEqual({ street: 'Main 1', locality: 'Berlin', region: 'BE', postcode: '10115', country: 'DE' });

    const one = rowToDraft(['Main 1, 10115 Berlin'], ['address']);
    expect(one.address.street).toBe('Main 1, 10115 Berlin');
  });

  it('joins several note columns, and carries the target books', () => {
    const draft = rowToDraft(['first', 'second'], ['notes', 'notes'], { bookIds: ['b1'] });

    expect(draft.notes).toBe('first\nsecond');
    expect(draft.bookIds).toEqual(['b1']);
  });

  it('skips ignored and empty cells', () => {
    const draft = rowToDraft(['Ada', '', 'x'], ['given', 'surname', 'ignore']);

    expect(draft.surname).toBe('');
    expect(draft.emails).toEqual([]);
  });

  it('pads a short row rather than shifting the mapping', () => {
    const draft = rowToDraft(['Ada'], ['given', 'surname', 'email']);

    expect(draft.given).toBe('Ada');
    expect(draft.emails).toEqual([]);
  });
});

describe('rowsToDrafts', () => {
  it('drops a row that carries nothing', () => {
    const drafts = rowsToDrafts([['Ada', 'ada@example.org'], ['', ''], ['', '']], ['given', 'email']);

    expect(drafts).toHaveLength(1);
    expect(drafts[0].given).toBe('Ada');
  });

  it('reads a whole Google-shaped file', () => {
    const file = [
      'Given Name,Family Name,E-mail 1 - Value,Phone 1 - Value,Group Membership',
      'Ada,Lovelace,ada@example.org,+491761234567,:* myContacts',
      '"Smith, John",Smith,john@example.org,,',
    ].join('\n');
    const { headers, rows } = parseCsv(file);
    const drafts = rowsToDrafts(rows, guessMapping(headers), { bookIds: ['b1'] });

    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({ given: 'Ada', surname: 'Lovelace' });
    expect(drafts[0].emails[0].address).toBe('ada@example.org');
    // the quoted comma survives as part of the name
    expect(drafts[1].given).toBe('Smith, John');
  });
});

describe('planImport', () => {
  const existing = [
    makeCard({ id: 'a', name: 'Ada Lovelace', emails: ['ada@example.org'], phones: ['+491761234567'] }),
  ];

  it('calls a contact new when nothing matches it', () => {
    const drafts = rowsToDrafts([['Grace Hopper', 'grace@navy.mil']], ['name', 'email']);
    const plan = planImport(drafts, existing);

    expect(plan.fresh).toHaveLength(1);
    expect(plan.duplicates).toEqual([]);
  });

  it('finds the same person by email, and says why', () => {
    const drafts = rowsToDrafts([['Ada Lovelace', 'ada@example.org']], ['name', 'email']);
    const plan = planImport(drafts, existing);

    expect(plan.fresh).toEqual([]);
    expect(plan.duplicates).toHaveLength(1);
    expect(plan.duplicates[0].reason).toBe('email');
    expect(plan.duplicates[0].match.id).toBe('a');
  });

  it('finds the same person by phone across the ways it is written', () => {
    const drafts = rowsToDrafts([['A. Lovelace', '0176 1234567']], ['name', 'phone']);
    const plan = planImport(drafts, existing, { region: 'DE' });

    expect(plan.duplicates).toHaveLength(1);
    expect(plan.duplicates[0].reason).toBe('phone');
  });

  it('finds the same person by name alone', () => {
    const drafts = rowsToDrafts([['Ada Lovelace']], ['name']);

    expect(planImport(drafts, existing).duplicates[0].reason).toBe('name');
  });

  it('treats a file imported twice as all duplicates', () => {
    const drafts = rowsToDrafts([['Ada Lovelace', 'ada@example.org']], ['name', 'email']);
    const created = makeCard({ id: 'new', name: 'Ada Lovelace', emails: ['ada@example.org'] });

    // the same file again, against the contact the first run would have created
    expect(planImport(drafts, [...existing, created]).duplicates).toHaveLength(1);
  });

  it('does not call two different people duplicates', () => {
    const drafts = rowsToDrafts([['Grace Hopper', 'grace@navy.mil'], ['Alan Turing', 'alan@x.de']], ['name', 'email']);
    const plan = planImport(drafts, existing);

    expect(plan.fresh).toHaveLength(2);
    expect(plan.duplicates).toEqual([]);
  });

  it('survives junk', () => {
    expect(planImport(null, null)).toEqual({ fresh: [], duplicates: [] });
  });
});

describe('applyImport', () => {
  it('creates every draft, as a card the host can store', async () => {
    const subject = fakeApi({ handlers: { 'contacts.create': async () => ({ id: 'new' }) } });
    const drafts = rowsToDrafts(
      [['Ada Lovelace', 'ada@example.org', '+491761234567']], ['name', 'email', 'phone'], { bookIds: ['b1'] },
    );

    expect(await applyImport(subject, drafts)).toEqual({ created: 1, failed: 0 });
    const card = subject.calls('contacts.create')[0].args[0];
    expect(card.name.components).toEqual([{ kind: 'given', value: 'Ada' }, { kind: 'surname', value: 'Lovelace' }]);
    expect(card.emails.e0).toEqual({ address: 'ada@example.org', pref: 1 });
    expect(card.addressBookIds).toEqual({ b1: true });
  });

  it('counts a contact the host refuses, and keeps going', async () => {
    let calls = 0;
    const subject = fakeApi({
      handlers: { 'contacts.create': async () => { calls += 1; if (calls === 1) throw new Error('missing contacts:write'); } },
    });
    const drafts = rowsToDrafts([['Ada', 'a@x.de'], ['Grace', 'g@x.de']], ['given', 'email']);

    expect(await applyImport(subject, drafts)).toEqual({ created: 1, failed: 1 });
  });

  it('does nothing with nothing', async () => {
    const subject = fakeApi({});

    expect(await applyImport(subject, null)).toEqual({ created: 0, failed: 0 });
    expect(subject.calls('contacts.create')).toHaveLength(0);
  });
});
