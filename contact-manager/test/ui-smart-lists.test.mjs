// @vitest-environment jsdom
// The Smart lists dialog (#13, the command-palette half): the saved searches
// with live counts, the members of the selected one, and the export choice.
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { makeSmartListsDialog } from '../src/lib/smart-lists-dialog.js';
import { makeCard } from './fixtures.mjs';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));
afterEach(cleanup);

const en = () => manifest.locales.en;

const CARDS = [
  makeCard({ id: 'a', name: 'Ada Lovelace', emails: ['ada@example.org'], keywords: { vip: true } }),
  makeCard({ id: 'b', name: 'Grace Hopper', emails: ['grace@navy.mil'] }),
  makeCard({ id: 'c', name: 'Alan Turing', emails: ['alan@example.org'] }),
];
const SAVED = [{ name: 'VIP', query: 'tag:vip' }, { name: 'On example.org', query: 'email:example.org' }];

function dialogApi({ saved = SAVED, handlers = {} } = {}) {
  const api = fakeApi({
    translations: manifest.locales,
    handlers: {
      'contacts.list': async () => CARDS,
      'addressBooks.list': async () => [{ id: 'b1', name: 'Personal' }],
      ...handlers,
    },
  });
  void api.storage.set('savedSearches', saved);
  return api;
}

async function open(api) {
  const Dialog = makeSmartListsDialog(React, api);
  const state = { result: undefined };
  await act(async () => {
    render(React.createElement(Dialog, { smartLists: true, onResult: (value) => { state.result = value; } }));
  });
  await waitFor(() => {
    const ready = screen.queryByText(en()['smartLists.intro']) ?? screen.queryByText(en()['smartLists.unavailable']);
    expect(ready).toBeTruthy();
  });
  return state;
}

const click = async (name) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name })); }); };

describe('smart lists dialog', () => {
  it('shows every list with its live count', async () => {
    await open(dialogApi());

    expect(screen.getByRole('button', { name: 'All contacts · 3' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'VIP · 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'On example.org · 2' })).toBeTruthy();
  });

  it('starts on everything and shows its members', async () => {
    await open(dialogApi());

    expect(screen.getByText('3 contact(s)')).toBeTruthy();
    for (const name of ['Ada Lovelace', 'Grace Hopper', 'Alan Turing']) {
      expect(screen.getByText(name)).toBeTruthy();
    }
  });

  it('picks a list and shows only its members', async () => {
    await open(dialogApi());

    await click('VIP · 1');

    expect(screen.getByText('1 contact(s)')).toBeTruthy();
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.queryByText('Grace Hopper')).toBeNull();
  });

  it('returns the members of the picked list, to export', async () => {
    const state = await open(dialogApi());

    await click('On example.org · 2');
    await click(en()['smartLists.exportVcard']);

    expect(state.result).toEqual({
      export: { cards: [CARDS[0], CARDS[2]], format: 'vcard', name: 'On example.org' },
    });
  });

  it('closing returns nothing', async () => {
    const state = await open(dialogApi());

    await click(en()['smartLists.close']);

    expect(state.result).toBeNull();
  });

  it('says so when there are no saved searches yet', async () => {
    await open(dialogApi({ saved: [] }));

    expect(screen.getByText(en()['smartLists.noSaved'])).toBeTruthy();
    // and "everything" is still offered, so the dialog is never empty
    expect(screen.getByRole('button', { name: 'All contacts · 3' })).toBeTruthy();
  });

  it('says so when a list has no members, and will not export it', async () => {
    await open(dialogApi({ saved: [{ name: 'Nobody', query: 'name:Nobody' }] }));

    await click('Nobody · 0');

    expect(screen.getByText(en()['smartLists.empty'])).toBeTruthy();
    expect(screen.getByRole('button', { name: en()['smartLists.exportVcard'] }).disabled).toBe(true);
  });

  it('reports a failed read instead of showing an empty dialog', async () => {
    const api = dialogApi({ handlers: { 'contacts.list': async () => { throw new Error('refused'); } } });
    await open(api);

    await waitFor(() => expect(api.calls('ui.alert')).toHaveLength(1));
    expect(screen.getByText(en()['smartLists.unavailable'])).toBeTruthy();
  });
});
