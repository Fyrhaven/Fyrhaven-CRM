// @vitest-environment jsdom
// The Health dashboard: the totals, the drill-down, and the fixes it offers.
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { makeHealthPage } from '../src/lib/health-page.js';
import { makeCard } from './fixtures.mjs';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));
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
