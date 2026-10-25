// @vitest-environment jsdom
// The import wizard: reading a file, checking the mapping, and what it writes.
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { makeImportDialog } from '../src/lib/import-dialog.js';
import { makeCard } from './fixtures.mjs';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));
afterEach(cleanup);

const ADA = makeCard({ id: 'a', name: 'Ada Lovelace', emails: ['ada@example.org'] });

const GOOGLE_CSV = [
  'Given Name,Family Name,E-mail 1 - Value',
  'Grace,Hopper,grace@navy.mil',
  'Ada,Lovelace,ada@example.org',
].join('\n');

const VCARD = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'FN:Grace Hopper',
  'EMAIL:grace@navy.mil',
  'END:VCARD',
].join('\n');

function importApi(handlers = {}) {
  return fakeApi({
    translations: manifest.locales,
    handlers: {
      'contacts.list': async () => [ADA],
      'addressBooks.list': async () => [{ id: 'b1', name: 'Personal' }],
      'contacts.create': async () => ({ id: 'new' }),
      ...handlers,
    },
  });
}

async function open(api) {
  const results = [];
  const Dialog = makeImportDialog(React, api);
  await act(async () => {
    render(React.createElement(Dialog, { onResult: (value) => results.push(value) }));
  });
  await waitFor(() => expect(screen.getByLabelText('File')).toBeTruthy());
  return results;
}

/** Hand the file input a file, the way a user picking one does. */
async function pickFile(name, text, type = 'text/csv') {
  const file = new File([text], name, { type });
  await act(async () => {
    fireEvent.change(screen.getByLabelText('File'), { target: { files: [file] } });
  });
}

describe('the import wizard', () => {
  it('says what it will and will not do before anything is written', async () => {
    const api = importApi();
    await open(api);

    expect(screen.getByText(/Nothing is written until you import/)).toBeTruthy();
    expect(api.calls('contacts.create')).toHaveLength(0);
  });

  it('reads a Google CSV, guesses the columns and previews the result', async () => {
    const api = importApi();
    await open(api);

    await pickFile('google.csv', GOOGLE_CSV);

    await waitFor(() => expect(screen.getByText('2 contact(s) in the file.')).toBeTruthy());
    expect(screen.getByText('CSV')).toBeTruthy();
    expect(screen.getByLabelText('Given Name').value).toBe('given');
    expect(screen.getByLabelText('Family Name').value).toBe('surname');
    expect(screen.getByLabelText('E-mail 1 - Value').value).toBe('email');
    expect(screen.getByText('Grace Hopper')).toBeTruthy();
    expect(screen.getByText('grace@navy.mil')).toBeTruthy();
  });

  it('holds back a contact that already exists, and says so', async () => {
    const api = importApi();
    await open(api);

    await pickFile('google.csv', GOOGLE_CSV);

    // Ada is already in the address book, by email
    await waitFor(() => expect(screen.getByText('1 contact(s) look like ones you already have.')).toBeTruthy());
    expect(screen.getByText('1 contact(s) would be created.')).toBeTruthy();
  });

  it('writes only the new contacts, into the chosen address book', async () => {
    const api = importApi();
    const results = await open(api);
    await pickFile('google.csv', GOOGLE_CSV);
    await waitFor(() => expect(screen.getByText('1 contact(s) would be created.')).toBeTruthy());

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Import' })); });

    await waitFor(() => expect(results).toHaveLength(1));
    expect(results[0]).toMatchObject({ created: 1, failed: 0, skipped: 1 });
    expect(api.calls('contacts.create')).toHaveLength(1);
    expect(api.calls('contacts.create')[0].args[0].emails.e0.address).toBe('grace@navy.mil');
    expect(api.calls('contacts.create')[0].args[0].addressBookIds).toEqual({ b1: true });
  });

  it('imports the duplicates too when the user says so', async () => {
    const api = importApi();
    const results = await open(api);
    await pickFile('google.csv', GOOGLE_CSV);
    await waitFor(() => expect(screen.getByText('1 contact(s) would be created.')).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Skip those, import only the new ones'));
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Import' })); });

    await waitFor(() => expect(results).toHaveLength(1));
    expect(results[0]).toMatchObject({ created: 2, skipped: 0 });
  });

  it('remembers the mapping, and uses it next time', async () => {
    const api = importApi();
    await open(api);
    await pickFile('google.csv', GOOGLE_CSV);
    await waitFor(() => expect(screen.getByText('2 contact(s) in the file.')).toBeTruthy());

    // change a column, then import so the mapping is kept
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Family Name'), { target: { value: 'nickname' } });
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Import' })); });
    await waitFor(() => expect(api.storageSnapshot().importMappings).toHaveLength(1));
    expect(api.storageSnapshot().importMappings[0].mapping).toEqual(['given', 'nickname', 'email']);

    // the same api, because the mapping is remembered in its storage
    cleanup();
    await open(api);
    await pickFile('google.csv', GOOGLE_CSV);
    await waitFor(() => expect(screen.getByText('2 contact(s) in the file.')).toBeTruthy());
    // the remembered mapping, not the guess
    expect(screen.getByLabelText('Family Name').value).toBe('nickname');
  });

  it('reads a vCard file without asking about columns', async () => {
    const api = importApi();
    const results = await open(api);

    await pickFile('contacts.vcf', VCARD, 'text/vcard');

    await waitFor(() => expect(screen.getByText('vCard')).toBeTruthy());
    expect(screen.getByText('1 contact(s) in the file.')).toBeTruthy();
    expect(screen.queryByText('Columns')).toBeNull();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Import' })); });
    await waitFor(() => expect(results).toHaveLength(1));
    expect(api.calls('contacts.create')[0].args[0].emails.e0.address).toBe('grace@navy.mil');
  });

  it('refuses an empty file and imports nothing', async () => {
    const api = importApi();
    await open(api);

    await pickFile('empty.csv', '   \n  ');

    await waitFor(() => expect(screen.getByText('That file has no columns.')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Import' }).disabled).toBe(true);
  });

  it('closes without writing when cancelled', async () => {
    const api = importApi();
    const results = await open(api);
    await pickFile('google.csv', GOOGLE_CSV);
    await waitFor(() => expect(screen.getByText('2 contact(s) in the file.')).toBeTruthy());

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });

    expect(results).toEqual([null]);
    expect(api.calls('contacts.create')).toHaveLength(0);
  });
});
