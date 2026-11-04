// The contact editor's pure model: draft round-trips, the JSContact card it
// writes, validation and the dirty check.
import { describe, expect, it } from 'vitest';
import {
  cardFromDraft, companyCardFromDraft, companyDraftFromCard, draftFromCard, draftWarnings,
  emptyCompanyDraft, emptyDraft, isDirty, validateCompanyDraft, validateDraft,
} from '../src/lib/editor.js';
import { makeCard } from './fixtures.mjs';

const fullCard = () => makeCard({
  id: 'c1',
  name: { components: [{ kind: 'given', value: 'Ada' }, { kind: 'surname', value: 'Lovelace' }] },
  emails: ['ada@example.org'],
  phones: ['+49 176 1234567'],
  nicknames: { n: { name: 'The Enchantress' } },
  organizations: { o: { name: 'Analytical Engines' } },
  titles: { t: { name: 'Mathematician' } },
  notes: { n: { note: 'Met at a conference' } },
  addressBookIds: { b1: true },
});

describe('draftFromCard', () => {
  it('fills every managed field from the card', () => {
    const draft = draftFromCard(fullCard(), [{ id: 'b1', name: 'Personal' }]);
    expect(draft).toMatchObject({
      given: 'Ada',
      surname: 'Lovelace',
      nickname: 'The Enchantress',
      organization: 'Analytical Engines',
      title: 'Mathematician',
      notes: 'Met at a conference',
      bookIds: ['b1'],
    });
    expect(draft.emails).toEqual([{ address: 'ada@example.org', pref: false }]);
    expect(draft.phones).toEqual([{ number: '+49 176 1234567', pref: false }]);
  });

  it('reads a flat full name and an empty card without throwing', () => {
    const draft = draftFromCard(makeCard({ id: 'c2', name: 'Robert Smith' }));
    expect(draft.given).toBe('Robert');
    expect(draft.surname).toBe('Smith');
    expect(draftFromCard(null)).toEqual(emptyDraft());
  });

  it('keeps the preferred flag a card carries', () => {
    const card = { id: 'c3', emails: { e0: { address: 'a@x.de', pref: 1 }, e1: { address: 'b@x.de' } } };
    expect(draftFromCard(card).emails).toEqual([
      { address: 'a@x.de', pref: true },
      { address: 'b@x.de', pref: false },
    ]);
  });
});


describe('cardFromDraft', () => {
  it('builds JSContact fields, map keys and the preferred markers', () => {
    const draft = {
      ...emptyDraft(),
      given: 'Ada',
      surname: 'Lovelace',
      nickname: 'The Enchantress',
      emails: [{ address: 'ada@example.org', pref: true }, { address: 'ada@work.org', pref: false }],
      phones: [{ number: '+49 176 1234567', pref: false }],
      address: { street: 'Main St 1', postcode: '12345', locality: 'London', region: '', country: 'UK' },
      organization: 'Analytical Engines',
      title: 'Mathematician',
      notes: 'Met at a conference',
      tags: 'maths, friends',
      bookIds: ['b1'],
    };
    const card = cardFromDraft(draft, 'create');
    expect(card.name).toEqual({ components: [
      { kind: 'given', value: 'Ada' },
      { kind: 'surname', value: 'Lovelace' },
    ] });
    expect(card.emails).toEqual({
      e0: { address: 'ada@example.org', pref: 1 },
      e1: { address: 'ada@work.org' },
    });
    expect(card.phones).toEqual({ p0: { number: '+49 176 1234567' } });
    expect(card.addresses).toEqual({ a0: {
      street: 'Main St 1', locality: 'London', region: '', postcode: '12345', country: 'UK',
    } });
    expect(card.organizations).toEqual({ o0: { name: 'Analytical Engines' } });
    expect(card.titles).toEqual({ t0: { name: 'Mathematician' } });
    expect(card.notes).toEqual({ n0: { note: 'Met at a conference' } });
    expect(card.nicknames).toEqual({ n0: { name: 'The Enchantress' } });
    expect(card.keywords).toEqual({ maths: true, friends: true });
    expect(card.addressBookIds).toEqual({ b1: true });
  });

  it('sends undefined for empty fields so an update clears them', () => {
    const card = cardFromDraft(emptyDraft(), 'edit');
    expect(card.name).toBeUndefined();
    expect(card.emails).toBeUndefined();
    expect(card.addresses).toBeUndefined();
    expect(card.keywords).toBeUndefined();
    expect(card.addressBookIds).toBeUndefined(); // nothing ticked on edit
  });

  it('drops blank rows instead of writing empty entries', () => {
    const draft = {
      ...emptyDraft(),
      emails: [{ address: '  ', pref: true }, { address: 'a@x.de', pref: false }],
      phones: [{ number: '' }],
      tags: ' , ',
    };
    const card = cardFromDraft(draft);
    expect(card.emails).toEqual({ e0: { address: 'a@x.de' } });
    expect(card.phones).toBeUndefined();
    expect(card.keywords).toBeUndefined();
  });
});

describe('validateDraft', () => {
  it('needs a name, an email or a phone', () => {
    const draft = { ...emptyDraft(), bookIds: ['b1'] };
    expect(validateDraft(draft)).toEqual([{ field: 'name', key: 'editor.error.empty' }]);
    expect(validateDraft({ ...draft, given: 'Ada' })).toEqual([]);
    expect(validateDraft({ ...emptyDraft(), emails: [{ address: 'a@x.de' }], bookIds: ['b1'] })).toEqual([]);
  });

  it('rejects a malformed email and a too-short phone', () => {
    const draft = { ...emptyDraft(), given: 'Ada', bookIds: ['b1'] };
    expect(validateDraft({ ...draft, emails: [{ address: 'nope' }] }))
      .toEqual([{ field: 'emails', key: 'editor.error.email' }]);
    expect(validateDraft({ ...draft, phones: [{ number: '12' }] }))
      .toEqual([{ field: 'phones', key: 'editor.error.phone' }]);
    expect(validateDraft({ ...draft, phones: [{ number: '+49 176 1234567' }] })).toEqual([]);
  });

  it('warns about a function address and a throwaway domain, without blocking', () => {
    const draft = { ...emptyDraft(), given: 'Ada', bookIds: ['b1'] };

    expect(draftWarnings({ ...draft, emails: [{ address: 'info@example.org' }] }))
      .toEqual([{ field: 'emails', index: 0, key: 'editor.warn.role' }]);
    expect(draftWarnings({ ...draft, emails: [{ address: 'x@mailinator.com' }] }))
      .toEqual([{ field: 'emails', index: 0, key: 'editor.warn.disposable' }]);
    expect(draftWarnings({ ...draft, emails: [{ address: 'ada@example.org' }] })).toEqual([]);
    // a warning is not an error: the draft still validates
    expect(validateDraft({ ...draft, emails: [{ address: 'info@example.org' }] })).toEqual([]);
  });

  it('says nothing about an address that is empty or unusable', () => {
    const draft = { ...emptyDraft(), given: 'Ada', bookIds: ['b1'] };

    expect(draftWarnings({ ...draft, emails: [{ address: '  ' }] })).toEqual([]);
    expect(draftWarnings({ ...draft, emails: [{ address: 'nope' }] })).toEqual([]);
    expect(draftWarnings({})).toEqual([]);
  });

  it('requires an address book only when creating', () => {
    const draft = { ...emptyDraft(), given: 'Ada' };
    expect(validateDraft(draft, 'create')).toEqual([{ field: 'books', key: 'editor.error.book' }]);
    expect(validateDraft(draft, 'edit')).toEqual([]);
  });

  it('reports each field once', () => {
    const draft = { ...emptyDraft(), emails: [{ address: 'nope' }, { address: 'also-nope' }] };
    expect(validateDraft(draft).filter((error) => error.field === 'emails')).toHaveLength(1);
  });
});

describe('isDirty', () => {
  it('compares the meaningful values only', () => {
    const draft = { ...emptyDraft(), given: 'Ada' };
    expect(isDirty(draft, { ...emptyDraft(), given: 'Ada' })).toBe(false);
    expect(isDirty(draft, { ...emptyDraft(), given: 'Grace' })).toBe(true);
    expect(isDirty({ ...draft, bookIds: ['b2', 'b1'] }, { ...draft, bookIds: ['b1', 'b2'] })).toBe(false);
  });
});

describe('company drafts', () => {
  it('builds a company card with kind org, domains, address and the marker keyword', () => {
    const draft = {
      ...emptyCompanyDraft(),
      name: 'Acme Ltd',
      domains: 'acme.com, https://acme.de/',
      address: { street: 'Main St 1', postcode: '12345', locality: 'London', region: '', country: 'UK' },
      notes: 'Key account',
      tags: 'partner, priority',
      bookIds: ['b1'],
    };
    const card = companyCardFromDraft(draft, 'create');
    expect(card.kind).toBe('org');
    expect(card.name).toEqual({ full: 'Acme Ltd' });
    expect(Object.values(card.onlineServices ?? {}).map((entry) => entry.uri)).toEqual(['acme.com', 'acme.de']);
    expect(card.addresses.a0).toMatchObject({ street: 'Main St 1', locality: 'London', country: 'UK' });
    expect(card.notes).toEqual({ n0: { note: 'Key account' } });
    expect(card.keywords).toEqual({ company: true, partner: true, priority: true });
    expect(card.addressBookIds).toEqual({ b1: true });
  });

  it('round-trips a company card back into a draft', () => {
    const card = companyCardFromDraft({
      ...emptyCompanyDraft(),
      name: 'Acme Ltd',
      domains: 'acme.com',
      notes: 'Key account',
      tags: 'partner',
      bookIds: ['b1'],
    });
    const draft = companyDraftFromCard(card, [{ id: 'b1', name: 'Work' }]);
    expect(draft).toMatchObject({
      name: 'Acme Ltd',
      domains: 'acme.com',
      notes: 'Key account',
      tags: 'partner',
      bookIds: ['b1'],
    });
  });

  it('requires a name, and an address book only on create', () => {
    expect(validateCompanyDraft(emptyCompanyDraft(), 'edit')).toEqual([{ field: 'name', key: 'editor.error.companyName' }]);
    const named = { ...emptyCompanyDraft(), name: 'Acme' };
    expect(validateCompanyDraft(named, 'create')).toEqual([{ field: 'books', key: 'editor.error.book' }]);
    expect(validateCompanyDraft({ ...named, bookIds: ['b1'] }, 'create')).toEqual([]);
  });
});
