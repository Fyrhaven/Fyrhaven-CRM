// The profile helpers: search over contacts and the "belongs to this contact"
// rules for tasks and messages.
import { describe, expect, it } from 'vitest';
import {
  attachmentsForMessages, companiesAmong, companyDomains, companyNameOf, companyOf,
  contactTerms, eventsForContact, filterCards, formatBytes, isCompany, peopleOfCompany,
  tasksForContact, timelineForContact,
} from '../src/lib/profile.js';
import { makeCard } from './fixtures.mjs';

const ada = makeCard({ id: 'a', name: 'Ada Lovelace', emails: ['ada@example.org'] });
const grace = makeCard({ id: 'g', name: 'Grace Hopper', emails: ['grace@navy.mil'], phones: ['+49 176 5551234'] });

describe('filterCards', () => {
  it('matches name, email and phone, case-insensitively', () => {
    const cards = [ada, grace];
    expect(filterCards(cards, 'ADA').map((card) => card.id)).toEqual(['a']);
    expect(filterCards(cards, 'navy').map((card) => card.id)).toEqual(['g']);
    expect(filterCards(cards, '5551234').map((card) => card.id)).toEqual(['g']);
  });

  it('returns everything for an empty query and nothing for a miss', () => {
    expect(filterCards([ada, grace], '  ')).toHaveLength(2);
    expect(filterCards([ada, grace], 'nobody')).toEqual([]);
    expect(filterCards(null, 'x')).toEqual([]);
  });

  it('finds contacts by nickname', () => {
    const withNick = makeCard({ id: 'n', name: 'Bob', nicknames: undefined, emails: ['bob@x.de'] });
    withNick.nicknames = { n0: { name: 'Robert Smith' } };
    expect(filterCards([withNick], 'robert').map((card) => card.id)).toEqual(['n']);
  });
});

describe('contactTerms', () => {
  it('uses every email and a name long enough to be meaningful', () => {
    expect(contactTerms(ada)).toEqual(['ada@example.org', 'ada lovelace']);
    expect(contactTerms(makeCard({ id: 'x', name: 'Al', emails: ['al@x.de'] }))).toEqual(['al@x.de']);
  });
});

describe('tasksForContact', () => {
  const tasks = [
    { id: 't1', title: 'Call Ada Lovelace about the engine' },
    { id: 't2', title: 'Send invoice', description: 'ada@example.org asked for it' },
    { id: 't3', title: 'Unrelated' },
  ];

  it('returns the tasks that mention the name or an email address', () => {
    expect(tasksForContact(tasks, ada).map((task) => task.id)).toEqual(['t1', 't2']);
  });

  it('needs something to match on, and tolerates a missing list', () => {
    expect(tasksForContact(tasks, makeCard({ id: 'z', name: 'Zoe' }))).toEqual([]);
    expect(tasksForContact(null, ada)).toEqual([]);
  });
});

describe('timelineForContact', () => {
  const messages = [
    { id: 'm1', from: { email: 'ada@example.org' }, to: [], subject: 'Hello' },
    { id: 'm2', from: { email: 'someone@x.de' }, to: [{ email: 'ada@example.org' }], subject: 'Re: Hello' },
    { id: 'm3', from: { email: 'other@x.de' }, to: [], subject: 'Ada Lovelace in the news' },
    { id: 'm4', from: { email: 'noise@x.de' }, to: [], subject: 'Unrelated' },
  ];

  it('keeps messages from, to or about the contact', () => {
    expect(timelineForContact(messages, ada).map((message) => message.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('returns nothing without terms and tolerates a missing list', () => {
    expect(timelineForContact(messages, makeCard({ id: 'z', name: 'Zoe' }))).toEqual([]);
    expect(timelineForContact(null, ada)).toEqual([]);
  });
});

describe('companies', () => {
  const acme = {
    id: 'co', kind: 'org', name: { full: 'Acme Ltd' }, keywords: { company: true },
    onlineServices: { d0: { service: 'domain', uri: 'acme.com' } },
  };
  const ana = makeCard({ id: 'ana', name: 'Ana Diaz', emails: ['ana@acme.com'], organizations: { o: { name: 'Acme Ltd' } } });
  const ben = makeCard({ id: 'ben', name: 'Ben Ito', emails: ['ben@acme.com'] }); // no organization field
  const other = makeCard({ id: 'z', name: 'Zoe Reed', emails: ['zoe@elsewhere.net'] });
  const cards = [acme, ana, ben, other];

  it('recognises company records', () => {
    expect(isCompany(acme)).toBe(true);
    expect(isCompany(ana)).toBe(false);
    expect(companyNameOf(acme)).toBe('Acme Ltd');
    expect(companyNameOf(ana)).toBe('Acme Ltd');
    expect(companiesAmong(cards).map((card) => card.id)).toEqual(['co']);
  });

  it('links people by organisation name and by domain', () => {
    expect(peopleOfCompany(cards, acme).map((card) => card.id)).toEqual(['ana', 'ben']);
    expect(companyOf(cards, ben)?.id).toBe('co');
    expect(companyOf(cards, other)).toBeNull();
  });

  it('derives the domain from the people when the company has none', () => {
    const bare = { id: 'co2', kind: 'org', name: { full: 'Acme Ltd' } };
    expect(companyDomains([bare, ana, ben], bare)).toEqual(['acme.com']);
  });
});

describe('meetings and files', () => {
  const ada = makeCard({ id: 'a', name: 'Ada Lovelace', emails: ['ada@example.org'] });

  it('keeps the events the contact takes part in', () => {
    const events = [
      { id: 'e1', title: 'Kickoff', participants: [{ email: 'ada@example.org' }] },
      { id: 'e2', title: 'Ada Lovelace review', participants: [] },
      { id: 'e3', title: 'Unrelated', participants: [{ email: 'x@y.de' }] },
    ];
    expect(eventsForContact(events, ada).map((event) => event.id)).toEqual(['e1', 'e2']);
  });

  it('flattens and de-duplicates the attachments of the messages', () => {
    const messages = [
      { id: 'm1', subject: 'Report', receivedAt: '2026-10-01', attachments: [
        { name: 'q3.pdf', size: 100, type: 'application/pdf', blobId: 'b1' },
        { name: 'q3.pdf', size: 100, blobId: 'b1' },
      ] },
      { id: 'm2', subject: 'Photos', attachments: [{ name: 'q3.pdf', size: 100 }] },
      { id: 'm3', subject: 'Nothing' },
    ];
    const files = attachmentsForMessages(messages);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ name: 'q3.pdf', emailId: 'm1', subject: 'Report', type: 'application/pdf' });
  });
});

describe('formatBytes', () => {
  it('shows small sizes in bytes and drops an unknown size', () => {
    expect(formatBytes(42)).toBe('42 B');
    expect(formatBytes(0)).toBe('');
    expect(formatBytes(undefined)).toBe('');
    expect(formatBytes('nope')).toBe('');
  });

  it('scales to kB, MB and GB with at most one decimal', () => {
    expect(formatBytes(1024)).toBe('1 kB');
    expect(formatBytes(1536)).toBe('1.5 kB');
    expect(formatBytes(1048576)).toBe('1 MB');
    expect(formatBytes(2 * 1024 ** 3)).toBe('2 GB');
  });
});

