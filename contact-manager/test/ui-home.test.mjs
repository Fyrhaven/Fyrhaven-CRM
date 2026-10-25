// @vitest-environment jsdom
// The main page: the numbers it lands on, and that its menu runs the same
// actions as the command palette.
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { makeHomePage } from '../src/lib/home-page.js';
import { makeCard } from './fixtures.mjs';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));
afterEach(cleanup);

const ADA = makeCard({ id: 'a', name: 'Ada Lovelace', emails: ['ada@example.org'], phones: ['+491761234567'] });
const TWIN = makeCard({ id: 'b', name: 'A. Lovelace', emails: ['ada@example.org'], phones: ['+493012345678'] });

function homeApi(handlers = {}) {
  return fakeApi({
    translations: manifest.locales,
    handlers: {
      'contacts.list': async () => [ADA, TWIN],
      'addressBooks.list': async () => [{ id: 'b1', name: 'Personal' }],
      'ui.openDialog': async () => null,
      ...handlers,
    },
  });
}

async function renderPage(api, onNavigate = () => {}) {
  const Page = makeHomePage(React, api);
  await act(async () => { render(React.createElement(Page, { onNavigate })); });
  await waitFor(() => expect(screen.getByText('Sections')).toBeTruthy());
}

describe('the main page', () => {
  it('lands on what needs attention, not on a section', async () => {
    await renderPage(homeApi());

    // two contacts sharing one address are one group of two, said twice:
    // once as the headline and once on the Duplicates row
    expect(screen.getAllByText('1 group(s) · 2 contact(s) involved')).toHaveLength(2);
    expect(screen.getByText('2 contact(s)')).toBeTruthy();
    expect(screen.getByText('0 project(s)')).toBeTruthy();
    // both are otherwise complete, and both lose 20 for being each other's duplicate
    expect(screen.getByText('Average 80 · Good')).toBeTruthy();
  });

  it('says so when there is nothing to fix', async () => {
    const api = homeApi({ 'contacts.list': async () => [ADA] });
    await renderPage(api);

    expect(screen.getByText('No duplicates found.')).toBeTruthy();
    expect(screen.getByText('Nothing to fix')).toBeTruthy();
  });

  it('says it has never scanned, and shows the last scan when there is one', async () => {
    const api = homeApi();
    await renderPage(api);
    expect(screen.getByText('Not scanned yet.')).toBeTruthy();

    cleanup();
    const scanned = homeApi();
    await scanned.storage.set('lastScan', { when: '2026-10-01T10:00:00Z', contacts: 120, books: 3 });
    await renderPage(scanned);
    expect(screen.getByText(/Last scan: .* · 120 contact\(s\) in 3 book\(s\)\./)).toBeTruthy();
  });

  it('leads into each section', async () => {
    const seen = [];
    await renderPage(homeApi(), (tab) => seen.push(tab));

    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]); });
    expect(seen).toEqual(['duplicates']);

    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[3]); });
    expect(seen).toEqual(['duplicates', 'health']);
  });

  it('offers the palette tasks in its menu, and runs them', async () => {
    const api = homeApi();
    await renderPage(api);

    expect(screen.getByRole('button', { name: 'Find duplicate contacts' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New contact' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New company' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New project' })).toBeTruthy();

    // the menu calls the same code the palette does
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'New project' })); });
    await waitFor(() => expect(api.calls('ui.openDialog')).toHaveLength(1));
    expect(api.calls('ui.openDialog')[0].args[0].extraProps.projectEditor).toMatchObject({ mode: 'create' });
  });

  it('runs a scan from the menu and reports a clean book', async () => {
    const api = homeApi({ 'contacts.list': async () => [ADA] });
    await renderPage(api);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Find duplicate contacts' })); });

    await waitFor(() => expect(api.calls('toast.info').length).toBeGreaterThan(0));
    expect(api.calls('toast.info').at(-1).args[0]).toBe('No duplicates found.');
    // no dialog for an empty scan
    expect(api.calls('ui.openDialog')).toHaveLength(0);
  });

  it('offers undo only while a merge can be undone', async () => {
    const api = homeApi();
    await renderPage(api);
    expect(screen.queryByRole('button', { name: 'Undo the last merge' })).toBeNull();

    cleanup();
    const withUndo = homeApi();
    await withUndo.storage.set('undoBatches', [{
      at: Date.now(), expiresAt: Date.now() + 60_000,
      entries: [{ keptId: 'a', before: {}, absent: [], removed: [{ id: 'x' }] }],
    }]);
    await renderPage(withUndo);
    expect(screen.getByRole('button', { name: 'Undo the last merge' })).toBeTruthy();
  });
});

describe('telling the other pages that something changed', () => {
  it('signals a change after a task, instead of only reloading itself', async () => {
    let bumped = 0;
    const api = homeApi();
    const Page = makeHomePage(React, api);
    await act(async () => {
      render(React.createElement(Page, { onNavigate: () => {}, revision: 0, onDataChanged: () => { bumped += 1; } }));
    });
    await waitFor(() => expect(screen.getByText('Sections')).toBeTruthy());

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'New contact' })); });
    await waitFor(() => expect(api.calls('ui.openDialog')).toHaveLength(1));

    // the Contacts tab has no idea a contact was just created unless it is told
    expect(bumped).toBe(1);
  });

  it('reloads its own numbers when the revision moves', async () => {
    const api = homeApi();
    const Page = makeHomePage(React, api);
    const draw = async (revision) => {
      await act(async () => {
        render(React.createElement(Page, { onNavigate: () => {}, revision, onDataChanged: () => {} }));
      });
      await waitFor(() => expect(screen.getByText('Sections')).toBeTruthy());
    };
    await draw(0);
    expect(api.calls('contacts.list')).toHaveLength(1);

    cleanup();
    await draw(1);
    expect(api.calls('contacts.list')).toHaveLength(2);
  });
});
