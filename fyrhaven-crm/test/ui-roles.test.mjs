// @vitest-environment jsdom
// The roles dialog (#23): renders the books, picks a role, and saves — and is
// honest that the host is not enforcing it.
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { makeRolesDialog } from '../src/lib/roles-dialog.js';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));
afterEach(cleanup);

const en = () => manifest.locales.en;
const dialogApi = (handlers = {}) => fakeApi({
  translations: manifest.locales,
  handlers: { 'ui.confirm': async () => true, ...handlers },
});

const ONE_BOOK = [{ id: 'b1', name: 'Personal' }];
const TWO_BOOKS = [{ id: 'b1', name: 'Personal' }, { id: 'b2', name: 'Work' }];

async function openDialog(books = ONE_BOOK) {
  const api = dialogApi();
  const Dialog = makeRolesDialog(React, api);
  const state = { result: undefined };
  await act(async () => {
    render(React.createElement(Dialog, {
      rolesDialog: true, books, onResult: (value) => { state.result = value; },
    }));
  });
  await waitFor(() => screen.getByText(en()['roles.intro']));
  return { api, state };
}

const click = async (element) => { await act(async () => { fireEvent.click(element); }); };
const save = async () => { await click(screen.getByText(en()['roles.save'])); };
const roleGroup = () => screen.getByRole('radiogroup', { name: en()['roles.roleLabel'] });
const roleRadio = (role) => within(roleGroup()).getByRole('radio', { name: en()[`roles.role.${role}`] });
const checked = (role) => roleRadio(role).getAttribute('aria-checked');

describe('roles dialog', () => {
  it('lists every book and offers the four roles', async () => {
    await openDialog(TWO_BOOKS);
    expect(screen.getByText('Personal')).toBeTruthy();
    expect(screen.getByText('Work')).toBeTruthy();
    for (const role of ['viewer', 'editor', 'merger', 'admin']) {
      expect(screen.getAllByRole('radio', { name: en()[`roles.role.${role}`] })).toHaveLength(2);
    }
  });

  it('says out loud that the host is not enforcing the role', async () => {
    await openDialog();
    expect(screen.getByText(en()['roles.advisory'])).toBeTruthy();
  });

  it('starts a book on Admin and stores the role that is picked', async () => {
    const { api, state } = await openDialog();
    expect(checked('admin')).toBe('true');
    await click(roleRadio('viewer'));
    expect(checked('viewer')).toBe('true');
    await save();
    await waitFor(() => expect(state.result).toEqual({ saved: true }));
    expect(await api.storage.get('bookRoles')).toEqual({ b1: 'viewer' });
  });

  it('reads a stored role back', async () => {
    const api = dialogApi();
    await api.storage.set('bookRoles', { b1: 'merger' });
    const Dialog = makeRolesDialog(React, api);
    await act(async () => {
      render(React.createElement(Dialog, { rolesDialog: true, books: ONE_BOOK, onResult: () => {} }));
    });
    await waitFor(() => screen.getByText('Personal'));
    expect(checked('merger')).toBe('true');
    expect(checked('admin')).toBe('false');
  });

  it('keeps a role per book, not one for the whole account', async () => {
    const { api, state } = await openDialog(TWO_BOOKS);
    const groups = screen.getAllByRole('radiogroup', { name: en()['roles.roleLabel'] });
    await click(within(groups[0]).getByRole('radio', { name: en()['roles.role.viewer'] }));
    await click(within(groups[1]).getByRole('radio', { name: en()['roles.role.editor'] }));
    await save();
    await waitFor(() => expect(state.result).toEqual({ saved: true }));
    expect(await api.storage.get('bookRoles')).toEqual({ b1: 'viewer', b2: 'editor' });
  });

  it('cancel writes nothing', async () => {
    const { api, state } = await openDialog();
    await click(roleRadio('viewer'));
    await click(screen.getByText(en()['dialog.cancel']));
    expect(state.result).toBeNull();
    expect(await api.storage.get('bookRoles')).toBeNull();
  });

  it('says so when the account has no address books', async () => {
    const api = dialogApi();
    const Dialog = makeRolesDialog(React, api);
    await act(async () => {
      render(React.createElement(Dialog, { rolesDialog: true, books: [], onResult: () => {} }));
    });
    await waitFor(() => screen.getByText(en()['roles.noBooks']));
  });

  it('reports a save that failed instead of swallowing it', async () => {
    const { api, state } = await openDialog();
    await click(roleRadio('viewer'));
    api.storage.set = async () => { throw new Error('refused'); };
    await save();
    await waitFor(() => expect(api.calls('ui.alert')).toHaveLength(1));
    expect(state.result).toBeUndefined(); // the dialog did not claim success
  });

  it('says so when the stored roles could not be read', async () => {
    const api = dialogApi();
    api.storage.get = async () => { throw new Error('refused'); };
    const Dialog = makeRolesDialog(React, api);
    await act(async () => {
      render(React.createElement(Dialog, { rolesDialog: true, books: ONE_BOOK, onResult: () => {} }));
    });
    await waitFor(() => expect(api.calls('ui.alert')).toHaveLength(1));
  });
});
