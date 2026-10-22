// @vitest-environment jsdom
// The Contacts page: list, search, selection, profile context, degradation.
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { makeProfilePage } from '../src/lib/profile-page.js';
import { makeCard } from './fixtures.mjs';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));
afterEach(cleanup);

const CARDS = [
  makeCard({ id: 'a', name: 'Ada Lovelace', emails: ['ada@example.org'], organizations: { o: { name: 'Engines Ltd' } }, keywords: { maths: true } }),
  makeCard({ id: 'g', name: 'Grace Hopper', emails: ['grace@navy.mil'] }),
];

const MESSAGES = [
  { id: 'm1', from: { email: 'ada@example.org' }, to: [], subject: 'The engine notes', receivedAt: '2026-10-01T10:00:00Z', attachments: [{ name: 'engine.pdf', size: 42 }] },
  { id: 'm2', from: { email: 'noise@x.de' }, to: [], subject: 'Unrelated' },
];

const EVENTS = [
  { id: 'e1', title: 'Engine kickoff', start: '2026-09-20T09:00:00Z', participants: [{ email: 'ada@example.org' }] },
  { id: 'e2', title: 'Unrelated meeting', start: '2026-09-21T09:00:00Z', participants: [{ email: 'x@y.de' }] },
];

const TASKS = [
  { id: 't1', title: 'Call Ada Lovelace', due: '2026-10-30' },
  { id: 't2', title: 'Unrelated task' },
];

function profileApi(handlers = {}) {
  return fakeApi({
    translations: manifest.locales,
    handlers: {
      'contacts.list': async () => CARDS,
      'addressBooks.list': async () => [{ id: 'b1', name: 'Personal' }],
      'contacts.search': async () => [],
      'email.search': async () => MESSAGES,
      'tasks.list': async () => TASKS,
      'calendar.getEvents': async () => EVENTS,
      ...handlers,
    },
  });
}

async function renderPage(api) {
  const Page = makeProfilePage(React, api);
  await act(async () => { render(React.createElement(Page)); });
  await waitFor(() => expect(screen.getAllByText('Ada Lovelace').length).toBeGreaterThan(0));
}

describe('contacts page', () => {
  it('lists the contacts and opens the first profile', async () => {
    const api = profileApi();
    await renderPage(api);

    expect(screen.getByText('Grace Hopper')).toBeTruthy();
    expect(screen.getByText('Engines Ltd')).toBeTruthy();
    expect(screen.getByText('maths')).toBeTruthy();
    expect(screen.getAllByText('ada@example.org').length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getAllByText('The engine notes').length).toBeGreaterThan(0));
    expect(screen.queryByText('Unrelated')).toBeNull();
  });

  it('filters the list as the user types', async () => {
    const api = profileApi();
    await renderPage(api);

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'grace' } });
    });
    // the list is filtered; the already-open profile stays open (like a mail client)
    expect(screen.getAllByText('Ada Lovelace')).toHaveLength(1);
    expect(screen.getByText('Grace Hopper')).toBeTruthy();

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'nobody' } });
    });
    expect(screen.getByText('No contact matches that search.')).toBeTruthy();
  });

  it('switches the profile when another contact is chosen', async () => {
    const api = profileApi();
    await renderPage(api);
    await act(async () => { fireEvent.click(screen.getAllByText('Grace Hopper')[0]); });

    await waitFor(() => expect(screen.getByText('grace@navy.mil')).toBeTruthy());
    expect(screen.queryByText('Engines Ltd')).toBeNull();
  });

  it('shows the meetings and files of the interaction history', async () => {
    const api = profileApi();
    await renderPage(api);

    await waitFor(() => expect(screen.getByText('Engine kickoff')).toBeTruthy());
    expect(screen.queryByText('Unrelated meeting')).toBeNull();
    expect(screen.getByText('engine.pdf')).toBeTruthy();
  });

  it('shows the open tasks that mention the contact', async () => {
    const api = profileApi();
    await renderPage(api);
    await waitFor(() => expect(screen.getByText('Call Ada Lovelace')).toBeTruthy());
    expect(screen.queryByText('Unrelated task')).toBeNull();
  });

  it('stays readable when messages and tasks are unavailable', async () => {
    const api = profileApi({
      'email.search': async () => { throw new Error('missing email:read'); },
      'tasks.list': async () => { throw new Error('missing tasks:read'); },
    });
    await renderPage(api);

    expect(screen.getAllByText('Ada Lovelace').length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText(/Messages and tasks are unavailable/)).toBeTruthy());
  });

  it('offers the editor from the profile and after creating a contact', async () => {
    const api = profileApi({ 'ui.openDialog': async () => ({ saved: 'created' }) });
    await renderPage(api);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'New contact' })); });
    expect(api.calls('ui.openDialog')[0].args[0].extraProps).toMatchObject({ editor: true, mode: 'create' });
    await waitFor(() => expect(api.calls('toast.success').at(-1).args[0]).toBe('Contact created.'));

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Edit contact' })); });
    expect(api.calls('ui.openDialog')[1].args[0].extraProps).toMatchObject({ editor: true, mode: 'edit' });
  });
});
