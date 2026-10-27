// @vitest-environment jsdom
// The manager page, driven with a fake api: scan, hide/restore, review.
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { makeManagerPage } from '../src/lib/manager-page.js';
import { makeCard } from './fixtures.mjs';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));
afterEach(cleanup);

const CARDS = [
  makeCard({ id: 'c1', name: 'Ada Lovelace', emails: ['Ada@Example.org'] }),
  makeCard({ id: 'c2', name: 'A. Lovelace', emails: ['ada@example.org'], addressBookIds: { b1: true } }),
  makeCard({ id: 'c3', name: 'John Doe', emails: ['john@home.org'] }),
  makeCard({ id: 'c4', name: 'Doe, John', emails: ['john@work.org'] }),
];

function pageApi(handlers = {}, settings = {}) {
  return fakeApi({
    translations: manifest.locales,
    settings,
    handlers: {
      'contacts.list': async () => CARDS,
      'addressBooks.list': async () => [{ id: 'b1', name: 'Personal' }],
      ...handlers,
    },
  });
}

async function renderPage(api) {
  const Page = makeManagerPage(React, api);
  await act(async () => { render(React.createElement(Page)); });
  await waitFor(() => screen.getByText(/duplicate groups/));
}

describe('manager page', () => {
  it('auto-scans on open and shows statistics, groups and the kept contact', async () => {
    const api = pageApi();
    await renderPage(api);
    expect(api.calls('contacts.list')).toHaveLength(1);
    expect(screen.getByText(/4 contacts · 1 address books · 2 duplicate groups \(1 certain, 1 possible\)/)).toBeTruthy();
    expect(screen.getByText('Certain match')).toBeTruthy();
    expect(screen.getByText('Possible match')).toBeTruthy();
    expect(screen.getByText('Same email address: ada@example.org')).toBeTruthy();
    // the first group's default keep: most fields, then lowest id → c1
    expect(screen.getAllByText('Keep')).toHaveLength(2); // one kept contact per group
    expect(screen.getAllByText(/Ada Lovelace · Ada@Example\.org/).length).toBeGreaterThan(0);
    // last scan persisted
    expect((await api.storage.get('lastScan')).contacts).toBe(4);
  });

  it('hides a group and restores it again', async () => {
    const api = pageApi();
    await renderPage(api);

    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Hide' })[0]); });
    expect((await api.storage.get('dismissedGroups'))).toContain('g:c1,c2');
    expect(screen.queryByText(/Augusta|A\. Lovelace/)).toBeNull();
    expect(api.calls('toast.info').at(-1).args[0]).toBe('Group hidden.');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show hidden groups' })); });
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Restore' })[0]); });
    expect(await api.storage.get('dismissedGroups')).toEqual([]);
    expect(screen.getByText(/duplicate groups/)).toBeTruthy();
  });

  it('offers Undo for the newest merge record and restores the contacts', async () => {
    const api = pageApi({
      'ui.confirm': async () => true,
      'contacts.create': async () => {},
      'contacts.update': async () => {},
    });
    await api.storage.set('undoBatches', [{
      at: Date.now(),
      expiresAt: Date.now() + 10 * 60_000,
      entries: [{ keptId: 'c1', before: {}, absent: ['phones'], removed: [makeCard({ id: 'c2', name: 'A. Lovelace' })] }],
    }]);
    await renderPage(api);

    expect(screen.getByText('The last merge removed 1 contacts.')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo merge' })); });
    await waitFor(() => expect(api.calls('contacts.create')).toHaveLength(1));
    expect(api.calls('contacts.create')[0].args[0].id).toBeUndefined();
    expect(api.calls('ui.confirm')[0].args[0]).toMatchObject({ title: 'Undo the last merge?' });
    expect(api.calls('toast.success').at(-1).args[0])
      .toBe('Restored 1 contacts and reverted 1 kept contacts.');
    expect(await api.storage.get('undoBatches')).toBeNull();
  });

  it('hides the Undo banner when there is no record and forgets on demand', async () => {
    const api = pageApi({ 'contacts.create': async () => {}, 'contacts.update': async () => {} });
    await api.storage.set('undoBatches', [{
      at: Date.now(),
      expiresAt: Date.now() + 10 * 60_000,
      entries: [{ keptId: 'c1', before: {}, absent: [], removed: [makeCard({ id: 'c2', name: 'A. Lovelace' })] }],
    }]);
    await renderPage(api);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Forget' })); });
    await waitFor(() => expect(screen.queryByText(/The last merge removed/)).toBeNull());
    expect(await api.storage.get('undoBatches')).toBeNull();
    expect(api.calls('toast.info').at(-1).args[0]).toBe('Undo records deleted.');
  });

  it('opens the review dialog for one group and rescans after a merge', async () => {
    const api = pageApi({ 'ui.openDialog': async () => ({ merged: 1, removed: 1, failed: 0 }) });
    await renderPage(api);
    const before = api.calls('contacts.list').length;

    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /Review/ })[0]); });
    const call = api.calls('ui.openDialog')[0];
    expect(call.args[0]).toMatchObject({ slot: 'plugin-dialog', title: 'Merge duplicate contacts' });
    expect(call.args[0].extraProps.groups).toHaveLength(1);
    expect(call.args[0].extraProps.groups[0].signature).toBe('g:c1,c2');
    await waitFor(() => expect(api.calls('toast.success').at(-1).args[0])
      .toBe('Merged 1 groups, removed 1 contacts.'));
    await waitFor(() => expect(api.calls('contacts.list').length).toBeGreaterThan(before));
  });

  it('merges the selected groups through the same dialog', async () => {
    const api = pageApi({ 'ui.openDialog': async () => ({ merged: 2, removed: 3, failed: 0 }) });
    await renderPage(api);

    for (const box of screen.getAllByRole('checkbox')) {
      await act(async () => { fireEvent.click(box); });
    }
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Merge 2 groups' })); });
    const groups = api.calls('ui.openDialog')[0].args[0].extraProps.groups;
    expect(groups.map((g) => g.signature).sort()).toEqual(['g:c1,c2', 'g:c3,c4']);
  });

  it('shows the error and retries when loading fails', async () => {
    let fail = true;
    const api = pageApi({ 'contacts.list': async () => { if (fail) throw new Error('offline'); return CARDS; } });
    const Page = makeManagerPage(React, api);
    await act(async () => { render(React.createElement(Page)); });
    await waitFor(() => screen.getByText(/Could not load your contacts: offline/));

    fail = false;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })); });
    await waitFor(() => screen.getByText(/duplicate groups/));
  });

  it('hands the address books to the policies dialog even when autoScan is off', async () => {
    // The *Policies* button is always in the header, but the books it handed
    // over came from the last scan. With autoScan off the page has not scanned,
    // so the dialog opened on "No address books found." and there was nothing
    // to configure — the one page that owns the policies could not edit them.
    const api = pageApi({ 'ui.openDialog': async () => null }, { autoScan: false });
    const Page = makeManagerPage(React, api);
    await act(async () => { render(React.createElement(Page)); });
    expect(api.calls('contacts.list')).toHaveLength(0); // it really did not scan

    const policies = screen.getByRole('button', { name: 'Policies' });
    await act(async () => { fireEvent.click(policies); });
    await waitFor(() => expect(api.calls('ui.openDialog')).toHaveLength(1));
    expect(api.calls('ui.openDialog')[0].args[0].extraProps.books)
      .toEqual([{ id: 'b1', name: 'Personal' }]);
  });
});
