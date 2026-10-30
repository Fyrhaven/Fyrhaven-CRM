// @vitest-environment jsdom
// The History tab: the list, the live rollback and the clear.
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { makeHistoryPage, liveRollback } from '../src/lib/history-page.js';
import { HISTORY_KEY, recordHistory } from '../src/lib/history.js';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));
afterEach(cleanup);

const historyApi = (handlers = {}) => fakeApi({
  translations: manifest.locales,
  handlers: { 'ui.confirm': async () => true, ...handlers },
});

async function renderPage(api) {
  const Page = makeHistoryPage(React, api);
  await act(async () => { render(React.createElement(Page)); });
  await waitFor(() => expect(screen.getByText('Change history')).toBeTruthy());
}

describe('liveRollback', () => {
  it('takes the newest of the two records, and nothing when neither is live', () => {
    expect(liveRollback([], null)).toBeNull();
    expect(liveRollback([], { at: 5, entries: [{}] })).toEqual({ kind: 'cleanup', count: 1 });
    expect(liveRollback([{ at: 9, entries: [{}] }], { at: 5, entries: [{}] }))
      .toEqual({ kind: 'merge', count: 1 });
    expect(liveRollback([{ at: 1, entries: [{}] }], { at: 5, entries: [{}] }))
      .toEqual({ kind: 'cleanup', count: 1 });
    expect(liveRollback([{ at: 1, entries: [] }], { at: 5, entries: [] })).toBeNull();
  });
});

describe('the History tab', () => {
  it('says nothing is recorded yet, and cannot be cleared', async () => {
    await renderPage(historyApi());
    expect(screen.getByText('Nothing recorded yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear history' }).disabled).toBe(true);
  });

  it('lists what was written, newest first, with the counts', async () => {
    const api = historyApi();
    await recordHistory(api, { kind: 'merge', contacts: 2, undoable: true }, 2000);
    await recordHistory(api, { kind: 'import', contacts: 3 }, 3000);
    await renderPage(api);

    expect(screen.getByText('2 entr(ies) · 5 contact(s) touched')).toBeTruthy();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Import');
    expect(rows[1].textContent).toContain('Merge');
    expect(screen.getByText('Undoable')).toBeTruthy();
  });

  it('offers the rollback that is still live and runs it', async () => {
    const api = historyApi({ 'contacts.update': async () => {} });
    await recordHistory(api, { kind: 'cleanup', contacts: 1, undoable: true }, 4000);
    await api.storage.set('lastCleanup', {
      at: 4000,
      expiresAt: Date.now() + 60_000,
      entries: [{ id: 'a', before: { emails: {} } }],
    });
    await renderPage(api);

    expect(screen.getByText('A batch of 1 change(s) can still be rolled back.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Undo the last batch' }));
    });

    await waitFor(() => expect(api.calls('contacts.update')).toHaveLength(1));
    expect(api.calls('contacts.update')[0].args[0]).toBe('a');
    expect(api.calls('toast.success').at(-1).args[0]).toBe('Put 1 contact(s) back.');
  });

  it('clears the history after the confirm', async () => {
    const api = historyApi();
    await recordHistory(api, { kind: 'bulk', contacts: 4 });
    await renderPage(api);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear history' })); });

    await waitFor(() => expect(screen.getByText('Nothing recorded yet')).toBeTruthy());
    expect(await api.storage.get(HISTORY_KEY)).toBeNull();
  });
});
