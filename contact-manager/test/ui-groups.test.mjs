// @vitest-environment jsdom
// The Groups tab and the group editor dialog, driven with a fake api.
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { makeGroupsPage } from '../src/lib/groups-page.js';
import { makeGroupDialog } from '../src/lib/group-dialog.js';
import { groupMemberIds } from '../src/lib/groups.js';
import { makeCard } from './fixtures.mjs';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));
afterEach(cleanup);

const person = (id, name, email) => makeCard({ id, name, emails: [email] });
const groupCard = (id, name, memberIds) => ({
  id,
  kind: 'group',
  name: { full: name },
  members: Object.fromEntries(memberIds.map((value, index) => [`m${index}`, { kind: 'individual', value }])),
  addressBookIds: { b1: true },
});
const BOOKS = [{ id: 'b1', name: 'Personal' }];
// p1 and p4 are the same person; g1 is clean, g2 holds the duplicate.
const CARDS = [
  person('p1', 'Ada Lovelace', 'ada@example.org'),
  person('p2', 'Grace Hopper', 'grace@navy.mil'),
  person('p3', 'Alan Turing', 'alan@example.org'),
  person('p4', 'Ada Lovelace', 'ada@example.org'),
  groupCard('g1', 'Team', ['p1', 'p2']),
  groupCard('g2', 'Twin list', ['p1', 'p4']),
];

const groupsApi = (handlers = {}) => fakeApi({
  translations: manifest.locales,
  handlers: {
    'contacts.list': async () => CARDS,
    'addressBooks.list': async () => BOOKS,
    ...handlers,
  },
});

async function renderPage(api) {
  const Page = makeGroupsPage(React, api);
  await act(async () => { render(React.createElement(Page)); });
  await waitFor(() => expect(screen.getByText('Contact groups')).toBeTruthy());
}

async function renderDialog(api, props) {
  const Dialog = makeGroupDialog(React, api);
  const box = { result: null };
  await act(async () => {
    render(React.createElement(Dialog, { ...props, onResult: (value) => { box.result = value; } }));
  });
  return box;
}

describe('the Groups tab', () => {
  it('lists the groups, never the people, with a member count', async () => {
    await renderPage(groupsApi());
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Team')).toBeTruthy();
    expect(screen.getByText('Twin list')).toBeTruthy();
    expect(screen.getAllByText('2 member(s)')).toHaveLength(2);
  });

  it('flags a group whose members are one person', async () => {
    await renderPage(groupsApi());
    expect(screen.getByText('Possible duplicate')).toBeTruthy();
    expect(screen.getByText('1 group(s) hold a possible duplicate')).toBeTruthy();
  });

  it('searches the groups by name', async () => {
    await renderPage(groupsApi());
    await act(async () => { fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'twin' } }); });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('Twin list')).toBeTruthy();
    expect(screen.queryByText('Team')).toBeNull();
  });

  it('says so when there are no groups yet', async () => {
    await renderPage(groupsApi({ 'contacts.list': async () => [person('p1', 'Ada', 'ada@example.org')] }));
    expect(screen.getByText('No contact groups yet')).toBeTruthy();
  });

  it('opens the editor for a new group and for an existing one', async () => {
    const api = groupsApi({ 'ui.openDialog': async () => null });
    await renderPage(api);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'New group' })); });
    expect(api.calls('ui.openDialog')[0].args[0].extraProps.groupEditor)
      .toMatchObject({ mode: 'create', group: null });

    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]); });
    const editor = api.calls('ui.openDialog')[1].args[0].extraProps.groupEditor;
    expect(editor.mode).toBe('edit');
    expect(editor.group.id).toBe('g1');
  });
});

describe('the group editor dialog', () => {
  const editApi = () => groupsApi({
    'contacts.create': async () => ({}),
    'contacts.update': async () => ({}),
    'contacts.remove': async () => ({}),
    'ui.confirm': async () => true,
  });

  it('writes a group card with the chosen members', async () => {
    const api = editApi();
    const box = await renderDialog(api, { groupEditor: { mode: 'create' }, cards: CARDS, books: BOOKS, detectOptions: {} });

    await act(async () => { fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'New team' } }); });
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create group' })); });

    const card = api.calls('contacts.create')[0].args[0];
    expect(card.kind).toBe('group');
    expect(card.name).toEqual({ full: 'New team' });
    expect(groupMemberIds(card)).toEqual(['p1']);
    expect(card.addressBookIds).toEqual({ b1: true });
    expect(box.result).toMatchObject({ saved: 'created' });
  });

  it('refuses a group with no name', async () => {
    const api = editApi();
    await renderDialog(api, { groupEditor: { mode: 'create' }, cards: CARDS, books: BOOKS, detectOptions: {} });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create group' })); });

    expect(screen.getAllByText('Enter a group name.').length).toBeGreaterThan(0);
    expect(api.calls('contacts.create')).toHaveLength(0);
  });

  it('loads the existing members, edits them and updates the card', async () => {
    const api = editApi();
    await renderDialog(api, {
      groupEditor: { mode: 'edit', group: groupCard('g1', 'Team', ['p1', 'p2']) },
      cards: CARDS, books: BOOKS, detectOptions: {},
    });

    expect(screen.getByLabelText('Group name').value).toBe('Team');
    // p1 and p2 are in the list; take the second one out again
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1]); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save group' })); });

    const call = api.calls('contacts.update')[0];
    expect(call.args[0]).toBe('g1');
    expect(groupMemberIds(call.args[1])).toEqual(['p1']);
  });

  it('deletes a group after the confirm', async () => {
    const api = editApi();
    const box = await renderDialog(api, {
      groupEditor: { mode: 'edit', group: groupCard('g1', 'Team', ['p1']) },
      cards: CARDS, books: BOOKS, detectOptions: {},
    });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete group' })); });

    expect(api.calls('contacts.remove')[0].args[0]).toBe('g1');
    expect(box.result).toEqual({ deleted: true });
  });

  it('warns while the list would hold a duplicate', async () => {
    await renderDialog(groupsApi(), {
      groupEditor: { mode: 'edit', group: groupCard('g2', 'Twin list', ['p1', 'p4']) },
      cards: CARDS, books: BOOKS, detectOptions: {},
    });

    expect(screen.getByText('1 possible duplicate(s) in this list')).toBeTruthy();
    expect(screen.getAllByText('Possible duplicate').length).toBeGreaterThan(0);
  });

  it('records the write in the change history', async () => {
    const api = editApi();
    await renderDialog(api, {
      groupEditor: { mode: 'create' }, cards: CARDS, books: BOOKS, detectOptions: {},
    });

    await act(async () => { fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Team' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create group' })); });

    expect(await api.storage.get('changeHistory')).toEqual([
      expect.objectContaining({ kind: 'group', contacts: 1 }),
    ]);
  });
});

