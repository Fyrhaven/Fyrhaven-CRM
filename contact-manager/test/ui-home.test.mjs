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
import { findDuplicateGroups } from '../src/lib/duplicates.js';
import { todayIso } from '../src/lib/tasks.js';
import { makeCard } from './fixtures.mjs';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));
afterEach(cleanup);

const DAY_MS = 24 * 3600 * 1000;
const CARL = makeCard({ id: 'c', name: 'Carl Jung', emails: ['carl@example.org'] });
const KARL = makeCard({ id: 'd', name: 'K. Jung', emails: ['carl@example.org'] });

const ADA = makeCard({ id: 'a', name: 'Ada Lovelace', emails: ['ada@example.org'], phones: ['+491761234567'] });
const TWIN = makeCard({ id: 'b', name: 'A. Lovelace', emails: ['ada@example.org'], phones: ['+493012345678'] });

/** The signature of the ADA/TWIN group, as the page computes it. */
const adaTwinSignature = () => findDuplicateGroups([ADA, TWIN], {}, [])[0].signature;

function homeApi(handlers = {}, settings = {}, host = {}) {
  return fakeApi({
    translations: manifest.locales,
    settings,
    host,
    handlers: {
      'contacts.list': async () => [ADA, TWIN],
      'addressBooks.list': async () => [{ id: 'b1', name: 'Personal' }],
      'ui.openDialog': async () => null,
      // A host with a task list and nothing to chase: the common case, and the
      // one the other tests here want. `tasks.list` is overridden per test.
      'tasks.list': async () => [],
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

    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[2]); });
    expect(seen).toEqual(['duplicates', 'groups']);

    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[4]); });
    expect(seen).toEqual(['duplicates', 'groups', 'health']);
  });

  it('offers the palette tasks in its menu, and runs them', async () => {
    const api = homeApi();
    await renderPage(api);

    expect(screen.getByRole('button', { name: 'Find duplicate contacts' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New contact' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New company' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New project' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New group' })).toBeTruthy();

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

describe('the duplicate digest', () => {
  const stale = () => ({ when: new Date(Date.now() - 10 * DAY_MS).toISOString(), contacts: 2, books: 1 });

  it('stays quiet while the reminder is off', async () => {
    const api = homeApi();
    await api.storage.set('lastScan', stale());
    await renderPage(api);

    expect(screen.queryByText('Duplicate digest')).toBeNull();
    // and nothing is remembered: the feature was not on
    expect(await api.storage.get('scanDigest')).toBeNull();
  });

  it('reminds about a scan older than the window', async () => {
    const api = homeApi({}, { digestDays: 7 });
    await api.storage.set('lastScan', stale());
    await renderPage(api);

    expect(screen.getByText('Duplicate digest')).toBeTruthy();
    expect(screen.getByText(/The last scan was .*more than 7 day\(s\) ago\./)).toBeTruthy();
    // the first look also sets the baseline for what comes next
    expect((await api.storage.get('scanDigest')).signatures).toHaveLength(1);
  });

  it('does not repeat a reminder the user has already been given', async () => {
    const api = homeApi({}, { digestDays: 7 });
    await api.storage.set('lastScan', stale());
    await renderPage(api);
    expect(screen.getByText('Duplicate digest')).toBeTruthy();

    cleanup();
    await renderPage(api);
    expect(screen.queryByText('Duplicate digest')).toBeNull();
  });

  it('reports a group that appears after the user was last shown the list', async () => {
    let cards = [ADA, TWIN];
    const api = homeApi({ 'contacts.list': async () => cards }, { digestDays: 7 });
    await api.storage.set('lastScan', { when: new Date().toISOString(), contacts: 2, books: 1 });
    await renderPage(api);
    // the group that was already there is not "new"
    expect(screen.queryByText('Duplicate digest')).toBeNull();

    cleanup();
    cards = [ADA, TWIN, CARL, KARL];
    await renderPage(api);
    expect(screen.getByText('Duplicate digest')).toBeTruthy();
    expect(screen.getByText(/1 group\(s\) appeared since you were last shown them/)).toBeTruthy();
  });

  it('acknowledges what it showed, so dismissing it sticks', async () => {
    const api = homeApi({}, { digestDays: 7 });
    await api.storage.set('lastScan', stale());
    await renderPage(api);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Got it' })); });
    await waitFor(() => expect(screen.queryByText('Duplicate digest')).toBeNull());
    expect((await api.storage.get('scanDigest')).signatures).toHaveLength(1);

    cleanup();
    await renderPage(api);
    expect(screen.queryByText('Duplicate digest')).toBeNull();
  });

  it('reviews the groups it reports, through the one review dialog', async () => {
    const api = homeApi({}, { digestDays: 7 });
    await api.storage.set('lastScan', stale());
    await renderPage(api);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Review now' })); });

    await waitFor(() => expect(api.calls('ui.openDialog')).toHaveLength(1));
    expect(api.calls('ui.openDialog')[0].args[0].extraProps.groups).toHaveLength(1);
  });

  it('leaves hidden groups out: a hidden group is a decision, not news', async () => {
    const hidden = homeApi({}, { digestDays: 7 });
    await hidden.storage.set('scanDigest', { at: new Date().toISOString(), signatures: [] });
    await hidden.storage.set('dismissedGroups', [adaTwinSignature()]);
    await hidden.storage.set('lastScan', { when: new Date().toISOString(), contacts: 2, books: 1 });
    await renderPage(hidden);
    expect(screen.queryByText('Duplicate digest')).toBeNull();

    // the positive twin: the same setup with the group visible does report it
    cleanup();
    const visible = homeApi({}, { digestDays: 7 });
    await visible.storage.set('scanDigest', { at: new Date().toISOString(), signatures: [] });
    await visible.storage.set('lastScan', { when: new Date().toISOString(), contacts: 2, books: 1 });
    await renderPage(visible);
    expect(screen.getByText('Duplicate digest')).toBeTruthy();
  });
});

// ── Follow-ups over every contact (#36) ─────────────────────────
//
// The Overview is the page that answers "what needs attention", so an overdue
// task has to be visible here rather than only on the contact it is about. The
// dates are relative to today, so the test cannot rot.

describe('the follow-ups block', () => {
  const dayOffset = (days) => {
    const now = new Date();
    return todayIso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
  };

  const task = (id, title, due) => ({ id, title, due });

  it('shows the overdue ones first, then what is due soon', async () => {
    const api = homeApi({
      'tasks.list': async () => [
        task('t3', 'Ask Ada about the engine', dayOffset(30)),
        task('t1', 'Call Ada Lovelace', dayOffset(-2)),
        task('t2', 'Send Grace Hopper the invoice', dayOffset(3)),
      ],
    });
    await renderPage(api);

    expect(screen.getByText('Follow-ups')).toBeTruthy();
    // only the past-due one is badged
    expect(screen.getAllByText('Overdue')).toHaveLength(1);

    const late = screen.getByText('Call Ada Lovelace');
    const soon = screen.getByText('Send Grace Hopper the invoice');
    expect(late.compareDocumentPosition(soon) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // and the rest is a count, not a list
    expect(screen.getByText('1 more later')).toBeTruthy();
  });

  it('says nothing when there is nothing to chase', async () => {
    const api = homeApi({
      'tasks.list': async () => [task('t1', 'Ask Ada about the engine', dayOffset(30))],
    });
    await renderPage(api);

    expect(screen.queryByText('Follow-ups')).toBeNull();
  });

  it('says so when the host has no task list', async () => {
    const api = homeApi({}, {}, { absent: ['tasks'] });
    await renderPage(api);

    expect(screen.getByText('Follow-ups')).toBeTruthy();
    expect(screen.getByText('The task list is not available on this host.')).toBeTruthy();
  });
});

describe('the Getting started guide', () => {
  const finished = () => ({ done: true, at: new Date().toISOString() });

  it('shows on first run', async () => {
    await renderPage(homeApi());

    expect(screen.getByText('Step 1 of 5')).toBeTruthy();
    expect(screen.getByText('Welcome to Contact Manager')).toBeTruthy();
  });

  it('stays hidden once it has been finished', async () => {
    const api = homeApi();
    await api.storage.set('onboarding', finished());
    await renderPage(api);

    expect(screen.queryByText('Step 1 of 5')).toBeNull();
  });

  it('re-opens from the menu after it was finished', async () => {
    const api = homeApi();
    await api.storage.set('onboarding', finished());
    await renderPage(api);
    expect(screen.queryByText('Step 1 of 5')).toBeNull();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Getting started' })); });

    expect(screen.getByText('Step 1 of 5')).toBeTruthy();
  });

  it('hides itself when the user skips it, and remembers that', async () => {
    const api = homeApi();
    await renderPage(api);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Skip the guide' })); });

    expect(screen.queryByText('Step 1 of 5')).toBeNull();
    expect(await api.storage.get('onboarding')).toMatchObject({ done: true });
  });
});
