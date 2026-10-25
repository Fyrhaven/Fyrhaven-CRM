// @vitest-environment jsdom
// The Health dashboard: the totals, the drill-down, and the fixes it offers.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { makeHealthPage } from '../src/lib/health-page.js';
import { makeCard } from './fixtures.mjs';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));

// jsdom has no Blob URL support; the retention export needs it.
const createObjectURL = vi.fn(() => 'blob:test');
URL.createObjectURL = createObjectURL;
URL.revokeObjectURL = vi.fn();
afterEach(cleanup);

const CLEAN = makeCard({ id: 'good', name: 'Ada Lovelace', emails: ['ada@example.org'], phones: ['+491761234567'] });
const EMPTY = { id: 'empty', name: 'Nobody', addressBookIds: { b1: true } };
const UNTIDY = makeCard({ id: 'untidy', name: 'Untidy', emails: ['  Grace@Example.ORG '], phones: ['+493012345678'] });

function healthApi(handlers = {}) {
  return fakeApi({
    translations: manifest.locales,
    handlers: {
      'contacts.list': async () => [CLEAN, EMPTY, UNTIDY],
      'addressBooks.list': async () => [{ id: 'b1', name: 'Personal' }],
      'contacts.update': async () => {},
      ...handlers,
    },
  });
}

async function renderPage(api) {
  const Page = makeHealthPage(React, api);
  await act(async () => { render(React.createElement(Page)); });
  await waitFor(() => expect(screen.getByText(/Average score/)).toBeTruthy());
}

describe('health dashboard', () => {
  it('shows the average over the address book, and each book', async () => {
    await renderPage(healthApi());

    // 100 + 75 + 95, rounded
    expect(screen.getByText(/Average score 90/)).toBeTruthy();
    expect(screen.getByText('Personal')).toBeTruthy();
    expect(screen.getByText('3 contact(s) · average 90')).toBeTruthy();
  });

  it('lists every rule that fired, with its count', async () => {
    await renderPage(healthApi());

    expect(screen.getByRole('button', { name: 'No email address (1)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'No phone number (1)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Email address needs tidying (1)' })).toBeTruthy();
    // a rule nothing fired is not offered at all
    expect(screen.queryByRole('button', { name: /Malformed email/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /No name/ })).toBeNull();
  });

  it('filters the list to the contacts a rule affects, worst first', async () => {
    await renderPage(healthApi());

    // the whole list starts worst first: the empty contact, then the untidy one, then the clean one
    expect(screen.getByText('Nobody')).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Email address needs tidying (1)' })); });

    expect(screen.getByText('Untidy')).toBeTruthy();
    expect(screen.queryByText('Nobody')).toBeNull();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show all' })); });
    expect(screen.getByText('Nobody')).toBeTruthy();
  });

  it('explains the score on every row', async () => {
    await renderPage(healthApi());

    expect(screen.getByText('Score 75 · Needs work')).toBeTruthy();
    expect(screen.getByText('Score 95 · Good')).toBeTruthy();
    expect(screen.getByText('Score 100 · Good')).toBeTruthy();
  });
});

describe('duplicates on the dashboard', () => {
  const TWIN_A = makeCard({ id: 'a', name: 'Ada Lovelace', emails: ['ada@example.org'], phones: ['+491761234567'] });
  const TWIN_B = makeCard({ id: 'b', name: 'A. Lovelace', emails: ['ada@example.org'], phones: ['+493012345678'] });

  it('counts a duplicate and offers the review dialog for it', async () => {
    const api = healthApi({
      'contacts.list': async () => [TWIN_A, TWIN_B],
      'ui.openDialog': async () => ({ merged: 1, removed: 1, failed: 0 }),
    });
    await renderPage(api);

    expect(screen.getByRole('button', { name: 'Duplicate of another contact (2)' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Review' }).length).toBeGreaterThan(0);

    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Review' })[0]); });

    const call = api.calls('ui.openDialog')[0];
    expect(call.args[0].slot).toBe('plugin-dialog');
    // the whole group is handed over, so the review dialog has both sides
    expect(call.args[0].extraProps.groups[0].members.map((member) => member.id).sort()).toEqual(['a', 'b']);
  });
});

describe('retention', () => {
  const monthsAgo = (n) => new Date(Date.now() - n * 30 * 24 * 3600 * 1000).toISOString();
  const OLD = makeCard({ id: 'old', name: 'Old Timer', emails: ['old@example.org'], updated: monthsAgo(40) });
  const MIDDLE = makeCard({ id: 'mid', name: 'Middle Aged', emails: ['mid@example.org'], updated: monthsAgo(14) });

  const retentionApi = (handlers = {}) => healthApi({
    'contacts.list': async () => [OLD, MIDDLE, CLEAN],
    'contacts.remove': async () => {},
    ...handlers,
  });

  it('explains where the signal comes from, and says nothing is deleted on its own', async () => {
    await renderPage(retentionApi());

    expect(screen.getByText(/last-updated date the server keeps/)).toBeTruthy();
    expect(screen.getByText(/Nothing is deleted on its own/)).toBeTruthy();
  });

  it('buckets the untouched contacts, and shows how old each one is', async () => {
    await renderPage(retentionApi());

    expect(screen.getByRole('button', { name: 'Untouched for a year (1)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Untouched for two years (0)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Untouched for three years (1)' })).toBeTruthy();
    // the age lines belong to the retention list only
    expect(screen.getByText('Last changed 3 year(s) ago')).toBeTruthy();
    expect(screen.getByText('Last changed 14 month(s) ago')).toBeTruthy();
  });

  it('filters to one bucket', async () => {
    await renderPage(retentionApi());

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Untouched for a year (1)' })); });

    // only the year-old contact is left in the retention list
    expect(screen.getByText('Last changed 14 month(s) ago')).toBeTruthy();
    expect(screen.queryByText('Last changed 3 year(s) ago')).toBeNull();
  });

  it('writes the file before it deletes anything, and is undoable', async () => {
    createObjectURL.mockClear();
    const click = vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(() => {});
    try {
      const api = retentionApi({ 'ui.confirm': async () => true });
      await renderPage(api);

      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Export and delete/ })); });

      await waitFor(() => expect(api.calls('contacts.remove')).toHaveLength(2));
      // the export happened as part of the delete, so the data is on disk
      expect(createObjectURL).toHaveBeenCalled();
      expect(api.calls('toast.success').at(-1).args[0]).toBe('Exported and deleted 2 contact(s).');
      // and it is undoable
      expect(api.storageSnapshot().undoBatches.at(-1).entries[0].removed).toHaveLength(2);
    } finally {
      click.mockRestore();
    }
  });

  it('deletes nothing when the confirmation is declined', async () => {
    const api = retentionApi({ 'ui.confirm': async () => false });
    await renderPage(api);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Export and delete/ })); });

    expect(api.calls('contacts.remove')).toHaveLength(0);
  });

  it('exports on its own without deleting', async () => {
    createObjectURL.mockClear();
    const click = vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(() => {});
    try {
      const api = retentionApi();
      await renderPage(api);

      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Export 2' })); });

      expect(createObjectURL).toHaveBeenCalled();
      expect(api.calls('contacts.remove')).toHaveLength(0);
      expect(api.calls('toast.success').at(-1).args[0]).toBe('Wrote 2 contact(s) to a file.');
    } finally {
      click.mockRestore();
    }
  });

  it('says so when nothing has gone stale', async () => {
    await renderPage(healthApi());

    expect(screen.getByText('Nothing has gone untouched for a year.')).toBeTruthy();
  });
});
