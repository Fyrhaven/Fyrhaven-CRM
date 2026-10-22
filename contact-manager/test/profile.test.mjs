// The profile helpers: search over contacts and the "belongs to this contact"
// rules for tasks and messages.
import { describe, expect, it } from 'vitest';
import {
  contactTerms, filterCards, tasksForContact, timelineForContact,
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
