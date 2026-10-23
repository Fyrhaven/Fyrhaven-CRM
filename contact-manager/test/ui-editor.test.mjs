// @vitest-environment jsdom
// The contact editor dialog: create, validate, cancel, edit and delete.
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { makeEditorDialog } from '../src/lib/editor-dialog.js';
import { makeCard } from './fixtures.mjs';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));
afterEach(cleanup);

const BOOKS = [{ id: 'b1', name: 'Personal' }, { id: 'b2', name: 'Work' }];

function editorApi(handlers = {}) {
  return fakeApi({
    translations: manifest.locales,
    handlers: {
      'addressBooks.list': async () => BOOKS,
      'ui.confirm': async () => true,
      'contacts.create': async () => {},
      'contacts.update': async () => {},
      'contacts.remove': async () => {},
      ...handlers,
    },
  });
}

async function renderEditor(api, props) {
  const Dialog = makeEditorDialog(React, api);
  let result;
  await act(async () => {
    render(React.createElement(Dialog, { ...props, onResult: (value) => { result = value; } }));
  });
  await waitFor(() => expect(screen.getByLabelText('First name')).toBeTruthy());
  return () => result;
}

const type = async (label, value) => {
  await act(async () => { fireEvent.change(screen.getByLabelText(label), { target: { value } }); });
};

describe('contact editor', () => {
  it('creates a contact from the form and reports the result', async () => {
    const api = editorApi();
    const result = await renderEditor(api, { mode: 'create' });

    await type('First name', 'Ada');
    await type('Last name', 'Lovelace');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add email address' })); });
    await type('Email 1', 'ada@example.org');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create contact' })); });

    await waitFor(() => expect(api.calls('contacts.create')).toHaveLength(1));
    const card = api.calls('contacts.create')[0].args[0];
    expect(card.name).toEqual({ components: [
      { kind: 'given', value: 'Ada' },
      { kind: 'surname', value: 'Lovelace' },
    ] });
    expect(card.emails).toEqual({ e0: { address: 'ada@example.org' } });
    expect(card.addressBookIds).toEqual({ b1: true }); // the first book is preselected
    expect(result()).toMatchObject({ saved: 'created' });
  });

  it('blocks the save and explains why when the draft is empty', async () => {
    const api = editorApi();
    await renderEditor(api, { mode: 'create' });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create contact' })); });

    expect(api.calls('contacts.create')).toHaveLength(0);
    expect(screen.getAllByText('Enter a name, an email address or a phone number.').length).toBeGreaterThan(0);
  });

  it('rejects a malformed email address', async () => {
    const api = editorApi();
    await renderEditor(api, { mode: 'create' });
    await type('First name', 'Ada');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add email address' })); });
    await type('Email 1', 'not-an-email');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create contact' })); });

    expect(api.calls('contacts.create')).toHaveLength(0);
    expect(screen.getAllByText('That email address is not valid.').length).toBeGreaterThan(0);
});


  it('asks before discarding a dirty draft, and closes cleanly when cancelled', async () => {
    const api = editorApi({ 'ui.confirm': async () => true });
    const result = await renderEditor(api, { mode: 'create' });
    await type('First name', 'Ada');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });

    expect(api.calls('ui.confirm')[0].args[0]).toMatchObject({ title: 'Discard your changes?' });
    expect(result()).toBeNull();
  });

  it('stays open when the discard is declined', async () => {
    const api = editorApi({ 'ui.confirm': async () => false });
    const result = await renderEditor(api, { mode: 'create' });
    await type('First name', 'Ada');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });

    expect(result()).toBeUndefined();
    expect(screen.getByLabelText('First name').value).toBe('Ada');
  });

  it('closes without asking when nothing changed', async () => {
    const api = editorApi();
    const result = await renderEditor(api, { mode: 'create' });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });
    expect(api.calls('ui.confirm')).toHaveLength(0);
    expect(result()).toBeNull();
  });

  it('prefills the form for an existing contact and saves the changes', async () => {
    const contact = makeCard({
      id: 'c1',
      name: { components: [{ kind: 'given', value: 'Ada' }, { kind: 'surname', value: 'Lovelace' }] },
      emails: ['ada@example.org'],
    });
    const api = editorApi();
    await renderEditor(api, { mode: 'edit', contact, books: BOOKS });

    expect(screen.getByLabelText('First name').value).toBe('Ada');
    expect(screen.getByLabelText('Email 1').value).toBe('ada@example.org');

    await type('First name', 'Augusta');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); });

    await waitFor(() => expect(api.calls('contacts.update')).toHaveLength(1));
    const [id, patch] = api.calls('contacts.update')[0].args;
    expect(id).toBe('c1');
    expect(patch.name.components[0]).toEqual({ kind: 'given', value: 'Augusta' });
    expect(patch.emails).toEqual({ e0: { address: 'ada@example.org' } });
  });

  it('deletes a contact after the confirmation', async () => {
    const contact = makeCard({ id: 'c1', name: 'Ada Lovelace' });
    const api = editorApi();
    const result = await renderEditor(api, { mode: 'edit', contact, books: BOOKS });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete contact' })); });
    expect(api.calls('ui.confirm')[0].args[0]).toMatchObject({
      title: 'Delete this contact?',
      message: 'Ada Lovelace will be removed from your address books.',
    });
    await waitFor(() => expect(api.calls('contacts.remove')[0].args[0]).toBe('c1'));
    expect(result()).toEqual({ deleted: true });
  });

  it('keeps the dialog open and reports a failed save', async () => {
    const api = editorApi({ 'contacts.create': async () => { throw new Error('offline'); } });
    const result = await renderEditor(api, { mode: 'create', books: BOOKS });
    await type('First name', 'Ada');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create contact' })); });

    await waitFor(() => expect(screen.getByText('Saving failed: offline')).toBeTruthy());
    expect(result()).toBeUndefined();
  });
});
