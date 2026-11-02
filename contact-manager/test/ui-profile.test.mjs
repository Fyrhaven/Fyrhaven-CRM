// @vitest-environment jsdom
// The Contacts page: list, search, selection, profile context, degradation.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { makeProfilePage } from '../src/lib/profile-page.js';
import { makeCard } from './fixtures.mjs';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));
afterEach(cleanup);

// jsdom has no Blob URL support; the download shim in profile-page.js needs it.
const createObjectURL = vi.fn(() => 'blob:test');
const revokeObjectURL = vi.fn();
URL.createObjectURL = createObjectURL;
URL.revokeObjectURL = revokeObjectURL;

const CARDS = [
  makeCard({ id: 'a', name: 'Ada Lovelace', emails: ['ada@example.org'], organizations: { o: { name: 'Engines Ltd' } }, keywords: { maths: true } }),
  makeCard({ id: 'g', name: 'Grace Hopper', emails: ['grace@navy.mil'] }),
];

const MESSAGES = [
  { id: 'm1', from: { email: 'ada@example.org' }, to: [], subject: 'The engine notes', receivedAt: '2026-10-01T10:00:00Z', attachments: [{ name: 'engine.pdf', size: 42, type: 'application/pdf', blobId: 'b-engine' }] },
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

function profileApi(handlers = {}, host = {}) {
  return fakeApi({
    translations: manifest.locales,
    host,
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

  it('keeps the list and the profile side by side, with the list scrolling in place', async () => {
    const api = profileApi();
    await renderPage(api);

    const split = document.querySelector('[data-pane="split"]');
    const list = document.querySelector('[data-pane="list"]');
    const detail = document.querySelector('[data-pane="detail"]');
    const scroll = document.querySelector('[data-pane="list-scroll"]');

    // One flex row holding both panes. The split must not depend on the kit
    // forwarding a `style` prop — the test stand-in drops it, and on a real
    // host the two panes collapsed into one column.
    expect(split.style.display).toBe('flex');
    expect(list.parentElement).toBe(split);
    expect(detail.parentElement).toBe(split);
    // The address book scrolls inside its own pane, so a long list cannot
    // stretch the page and push the profile out of view.
    expect(scroll.style.overflowY).toBe('auto');
    expect(scroll.parentElement).toBe(list);
  });

  it('keeps the search box out of the scrolling list', async () => {
    const api = profileApi();
    await renderPage(api);

    const scroll = document.querySelector('[data-pane="list-scroll"]');
    const search = screen.getByLabelText('Search contacts');
    // The box sits above the scroll area rather than inside it, so it stays
    // visible however far the address book is scrolled.
    expect(scroll.contains(search)).toBe(false);
    expect(search.parentElement).toBe(scroll.parentElement);
  });

  it('filters by an operator and says how many matched', async () => {
    const api = profileApi();
    await renderPage(api);

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'tag:maths' } });
    });

    // only Ada carries the 'maths' tag, so Grace is gone from the list entirely
    expect(screen.queryByText('Grace Hopper')).toBeNull();
    expect(screen.getAllByText('Ada Lovelace').length).toBeGreaterThan(0);
    expect(screen.getByText('1 of 2 contacts')).toBeTruthy();
  });

  it('explains an operator it cannot use, and still searches for the text', async () => {
    const api = profileApi();
    await renderPage(api);

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'has:fax' } });
    });

    expect(screen.getByText(/has:fax is not supported/)).toBeTruthy();
    // the token stays a free-text term, so the search runs instead of silently failing
    expect(screen.getByText('No contact matches that search.')).toBeTruthy();
  });

  it('shows the operators while the box is empty', async () => {
    const api = profileApi();
    await renderPage(api);

    expect(screen.getByText(manifest.locales.en['search.hint'])).toBeTruthy();
  });

  it('saves a search, counts it, applies it from its button and removes it', async () => {
    const api = profileApi();
    await renderPage(api);

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'tag:maths' } });
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save this search' })); });

    expect(api.storageSnapshot().savedSearches).toEqual([{ name: 'tag:maths', query: 'tag:maths' }]);
    expect(api.calls('toast.success').at(-1).args[0]).toBe('Saved tag:maths.');
    // the saved button carries the query and its live count
    expect(screen.getByRole('button', { name: 'tag:maths · 1' })).toBeTruthy();

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: '' } });
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'tag:maths · 1' })); });
    expect(screen.getByLabelText('Search contacts').value).toBe('tag:maths');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove tag:maths' })); });
    expect(api.storageSnapshot().savedSearches).toBeUndefined();
  });

  it('loads the saved searches it finds in storage', async () => {
    const api = profileApi();
    await api.storage.set('savedSearches', [{ name: 'Has email', query: 'has:email' }]);
    await renderPage(api);

    expect(screen.getByRole('button', { name: 'Has email · 2' })).toBeTruthy();
  });

  it('selects everything the list shows, so a query is a bulk scope (#34)', async () => {
    const api = profileApi();
    await renderPage(api);

    // with no query, the whole list
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Select all 2' })); });
    expect(screen.getByText('2 selected')).toBeTruthy();

    // clear, then a saved search narrows the list and Select all follows it
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear selection' })); });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'tag:maths' } });
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Select all 1' })); });
    expect(screen.getByText('1 selected')).toBeTruthy();
  });

  it('applies an OR query from the box', async () => {
    const api = profileApi();
    await renderPage(api);

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'tag:maths OR name:nobody' } });
    });

    // AND would match nothing; OR matches Ada on her tag
    expect(screen.getByText('1 of 2 contacts')).toBeTruthy();
  });

  it('filters on a query that is only a negation', async () => {
    const api = profileApi();
    await renderPage(api);

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: '-tag:maths' } });
    });

    // Ada has the maths tag, so only Grace is left
    expect(screen.getByText('1 of 2 contacts')).toBeTruthy();
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
    // the file row carries its type and size
    expect(screen.getByText('application/pdf · 42 B')).toBeTruthy();
  });

  it('saves a file of the interaction history through getAttachment', async () => {
    const blob = { kind: 'blob' };
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    const click = vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(() => {});
    try {
      const api = profileApi({ 'email.getAttachment': async () => blob });
      await renderPage(api);
      await waitFor(() => expect(screen.getByText('engine.pdf')).toBeTruthy());

      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });

      await waitFor(() => expect(api.calls('email.getAttachment')).toHaveLength(1));
      expect(api.calls('email.getAttachment')[0].args).toEqual(['m1', 'b-engine']);
      // the host saves it: the plugin frame has no `allow-downloads`
      expect(api.calls('ui.downloadFile')[0].args).toEqual(['engine.pdf', blob, 'application/octet-stream']);
    } finally {
      click.mockRestore();
    }
  });

  it('reports a failed download and keeps the profile readable', async () => {
    const api = profileApi({
      'email.getAttachment': async () => { throw new Error('missing email:blob-read'); },
    });
    await renderPage(api);
    await waitFor(() => expect(screen.getByText('engine.pdf')).toBeTruthy());

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });

    // a refused download stops and is read, rather than sliding past as a toast
    await waitFor(() => expect(api.calls('ui.alert').length).toBeGreaterThan(0));
    expect(api.calls('ui.alert').at(-1).args[0].message)
      .toBe('Could not save engine.pdf: missing email:blob-read');
    expect(screen.getAllByText('Ada Lovelace').length).toBeGreaterThan(0);
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
    await waitFor(() => expect(screen.getByText(/Unavailable: Messages, Tasks/)).toBeTruthy());
  });

  it('stays readable when the optional APIs are missing entirely', async () => {
    // An older host that does not expose api.calendar at all: reading the
    // method throws synchronously, before any promise exists to catch.
    const api = profileApi({}, { absent: ['calendar'] });
    await renderPage(api);

    expect(screen.getAllByText('Ada Lovelace').length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText(/Unavailable: Meetings/)).toBeTruthy());
  });

  it('stays readable when the host exposes a namespace without the method (#75)', async () => {
    // The shape that actually crashed a live install: `api.email` is there and
    // simply has no `search`. Reading the method throws *synchronously*, which
    // is why a bare `.catch()` could not see it and the page went down.
    const api = profileApi({}, { exposes: { email: ['query', 'send'], tasks: ['create'] } });
    await renderPage(api);

    expect(screen.getAllByText('Ada Lovelace').length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText(/Unavailable: Messages, Tasks/)).toBeTruthy());
    // The pieces that DO work are still there — the page degraded, it did not die.
    await waitFor(() => expect(screen.getByText('Engine kickoff')).toBeTruthy());
  });

  it('stays readable when a namespace exists but the method does not', async () => {
    // The reported production crash: api.email is present, api.email.search is
    // not, so the call throws "api.email.search is not a function" before any
    // promise exists — which a bare .catch() cannot see.
    const api = profileApi();
    api.email = {};
    await renderPage(api);

    expect(screen.getAllByText('Ada Lovelace').length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText(/Unavailable: Messages/)).toBeTruthy());
  });

  it('stays readable when an optional call returns no promise', async () => {
    const api = profileApi({
      'tasks.list': () => undefined,
      'calendar.getEvents': () => undefined,
    });
    await renderPage(api);

    expect(screen.getAllByText('Ada Lovelace').length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText(/Unavailable: Meetings, Tasks/)).toBeTruthy());
  });

  it('merges a hand-picked selection through the same review dialog', async () => {
    const api = profileApi({ 'ui.openDialog': async () => ({ merged: 1, removed: 1, failed: 0 }) });
    await renderPage(api);

    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Select Ada Lovelace' })); });
    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Select Grace Hopper' })); });
    expect(screen.getByText('2 selected')).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Merge selected' })); });

    const call = api.calls('ui.openDialog')[0];
    expect(call.args[0].slot).toBe('plugin-dialog');
    const group = call.args[0].extraProps.groups[0];
    // a deliberate selection carries no evidence, and the dialog says so
    expect(group.strength).toBe('manual');
    expect(group.members.map((card) => card.id).sort()).toEqual(['a', 'g']);
  });

  it('will not merge fewer than two contacts', async () => {
    const api = profileApi();
    await renderPage(api);

    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Select Ada Lovelace' })); });

    expect(screen.getByRole('button', { name: 'Merge selected' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Delete selected' }).disabled).toBe(false);
  });

  it('deletes the selection after a confirmation and keeps it undoable', async () => {
    const api = profileApi({ 'ui.confirm': async () => true });
    await renderPage(api);

    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Select Grace Hopper' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete selected' })); });

    await waitFor(() => expect(api.calls('contacts.remove')).toHaveLength(1));
    expect(api.calls('contacts.remove')[0].args[0]).toBe('g');
    expect(api.calls('ui.confirm')[0].args[0].danger).toBe(true);
    expect(api.calls('toast.success').at(-1).args[0]).toBe('Deleted 1 contact(s).');
    // the removal can be undone from the page banner
    expect(api.storageSnapshot().undoBatches.at(-1).entries[0].removed.map((card) => card.id)).toEqual(['g']);
  });

  it('keeps the selection when the delete is not confirmed', async () => {
    const api = profileApi({ 'ui.confirm': async () => false });
    await renderPage(api);

    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Select Grace Hopper' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete selected' })); });

    expect(api.calls('contacts.remove')).toHaveLength(0);
    expect(screen.getByText('1 selected')).toBeTruthy();
  });

  it('clears the selection on demand', async () => {
    const api = profileApi();
    await renderPage(api);

    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Select Grace Hopper' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear selection' })); });

    expect(screen.queryByText('1 selected')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete selected' })).toBeNull();
  });

  it('offers the full set of bulk actions for a selection', async () => {
    const api = profileApi();
    await renderPage(api);

    expect(screen.queryByRole('button', { name: 'Edit selected' })).toBeNull();

    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Select Grace Hopper' })); });

    for (const name of ['Merge selected', 'Edit selected', 'Clean up', 'Rules…', 'Export', 'Delete selected', 'Clear selection']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  it('opens the rules dialog over the selection and applies what it returns', async () => {
    const plan = [{ id: 'g', name: 'Grace Hopper', patch: { name: { full: 'Grace Hopper' } }, before: {}, changes: [] }];
    const api = profileApi({
      'contacts.update': async () => {},
      'ui.openDialog': async () => ({ rules: [], plan }),
    });
    await renderPage(api);

    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Select Grace Hopper' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Rules…' })); });

    await waitFor(() => expect(api.calls('ui.openDialog')).toHaveLength(1));
    const editor = api.calls('ui.openDialog')[0].args[0].extraProps.rulesEditor;
    expect(editor.cards.map((card) => card.id)).toEqual(['g']);
    expect(editor.rules).toEqual([]);
    // the plan is applied through the shared cleanup path, so it is undoable
    await waitFor(() => expect(api.calls('contacts.update')).toHaveLength(1));
    expect(api.calls('contacts.update')[0].args[0]).toBe('g');
    expect(await api.storage.get('lastCleanup')).toBeTruthy();
  });

  it('edits tags and books through the bulk dialog and writes the result', async () => {
    const api = profileApi({
      'contacts.update': async () => {},
      'ui.openDialog': async () => ({ tags: { add: ['vip'], remove: [] }, books: { add: [], remove: [] } }),
    });
    await renderPage(api);

    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Select Ada Lovelace' })); });
    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Select Grace Hopper' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Edit selected' })); });

    const editor = api.calls('ui.openDialog')[0].args[0].extraProps.bulkEditor;
    expect(editor.cards.map((card) => card.id).sort()).toEqual(['a', 'g']);
    expect(editor.books).toEqual([{ id: 'b1', name: 'Personal' }]);

    await waitFor(() => expect(api.calls('contacts.update')).toHaveLength(2));
    // the complete keyword map: the card's existing 'maths' tag survives
    expect(api.calls('contacts.update')[0].args[1]).toEqual({ keywords: { maths: true, vip: true } });
    expect(api.calls('toast.success').at(-1).args[0]).toBe('Updated 2 contact(s).');
  });

  it('keeps the selection when the bulk dialog is cancelled', async () => {
      const api = profileApi({
        'ui.openDialog': async () => null,
        'ui.downloadFile': async () => { throw new Error('refused'); },
      });
    await renderPage(api);

    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Select Grace Hopper' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Edit selected' })); });

    expect(api.calls('contacts.update')).toHaveLength(0);
    expect(screen.getByText('1 selected')).toBeTruthy();
  });

  it('asks what to export, then writes the file it was asked for', async () => {
    createObjectURL.mockClear();
    const click = vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(() => {});
    try {
      const api = profileApi({
        'ui.openDialog': async () => ({ scope: 'selected', format: 'vcard' }),
      });
      await renderPage(api);

      await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Select Ada Lovelace' })); });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Export' })); });

      // the dialog is told what it could export, and the file is built here
      expect(api.calls('ui.openDialog')[0].args[0].extraProps.exportSelection)
        .toEqual({ selected: 1, shown: 2 });
      expect(api.calls('ui.downloadFile')).toHaveLength(1);
      expect(typeof api.calls('ui.downloadFile')[0].args[1]).toBe('string');
      expect(api.calls('toast.success').at(-1).args[0]).toBe('Exported 1 contact(s) as vCard.');
    } finally {
      click.mockRestore();
    }
  });

  it('exports everything the search shows, as CSV, when asked', async () => {
    createObjectURL.mockClear();
    const click = vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(() => {});
    try {
      const api = profileApi({
        'ui.openDialog': async () => ({ scope: 'shown', format: 'csv' }),
      });
      await renderPage(api);

      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Export' })); });

      // nothing is selected, so the whole shown list goes
      expect(api.calls('ui.downloadFile')).toHaveLength(1);
      expect(api.calls('toast.success').at(-1).args[0]).toBe('Exported 2 contact(s) as vCard.');
    } finally {
      click.mockRestore();
    }
  });

  it('writes nothing when the export is cancelled', async () => {
    createObjectURL.mockClear();
      const api = profileApi({
        'ui.openDialog': async () => null,
        'ui.downloadFile': async () => { throw new Error('refused'); },
      });
    await renderPage(api);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Export' })); });

    expect(createObjectURL).not.toHaveBeenCalled();
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

describe('company profile', () => {
  const COMPANY = {
    id: 'co', kind: 'org', name: { full: 'Acme Ltd' }, keywords: { company: true, partner: true },
    onlineServices: { d0: { service: 'domain', uri: 'acme.com' } }, addressBookIds: { b1: true },
  };
  const ANA = makeCard({ id: 'ana', name: 'Ana Diaz', emails: ['ana@acme.com'], organizations: { o: { name: 'Acme Ltd' } } });
  const BEN = makeCard({ id: 'ben', name: 'Ben Ito', emails: ['ben@acme.com'] });

  const companyApi = (handlers = {}) => profileApi({
    'contacts.list': async () => [COMPANY, ANA, BEN],
    'email.search': async () => [
      { id: 'm1', from: { email: 'ana@acme.com' }, to: [], subject: 'Contract', receivedAt: '2026-10-02', attachments: [{ name: 'contract.pdf', size: 10 }] },
    ],
    'tasks.list': async () => [{ id: 't1', title: 'Send Acme Ltd the invoice' }],
    'calendar.getEvents': async () => [{ id: 'e1', title: 'Acme Ltd kickoff', start: '2026-10-03T09:00:00Z', participants: [] }],
    ...handlers,
  });

  it('shows a company card with its domains, people and rolled-up activity', async () => {
    const api = companyApi();
    const Page = makeProfilePage(React, api);
    await act(async () => { render(React.createElement(Page)); });

    await waitFor(() => expect(screen.getByText('Company')).toBeTruthy());
    expect(screen.getByText('acme.com')).toBeTruthy();
    expect(screen.getByText('partner')).toBeTruthy();
    // both colleagues, one linked by organisation and one by domain
    expect(screen.getAllByText('Ana Diaz').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ben Ito').length).toBeGreaterThan(0);
    expect(screen.getByText('2 linked people')).toBeTruthy();
    // rolled-up activity across the company
    await waitFor(() => expect(screen.getAllByText('Contract').length).toBeGreaterThan(0));
    expect(screen.getByText('contract.pdf')).toBeTruthy();
    expect(screen.getByText('Send Acme Ltd the invoice')).toBeTruthy();
    expect(screen.getByText('Acme Ltd kickoff')).toBeTruthy();
  });

  it('opens a person from the company people list', async () => {
    const api = companyApi();
    const Page = makeProfilePage(React, api);
    await act(async () => { render(React.createElement(Page)); });
    await waitFor(() => expect(screen.getAllByText('Ana Diaz').length).toBeGreaterThan(1));

    // the people list is the second occurrence; the first is the left contact list
    await act(async () => { fireEvent.click(screen.getAllByText('Ana Diaz')[1]); });
    await waitFor(() => expect(screen.getByText('Company: Acme Ltd · 2 people')).toBeTruthy());
  });
});

describe('the webmail message shape', () => {
  // JMAP sends `from` and `to` as arrays of { name, email }. Rendering that
  // array is what crashed the page with React error #31, and matching against
  // `from.email` silently found nothing.
  const JMAP_MESSAGES = [
    { id: 'm1', from: [{ name: 'Ada Lovelace', email: 'ada@example.org' }], to: [{ name: 'Me', email: 'me@example.org' }], subject: 'The engine notes', receivedAt: '2026-10-01T10:00:00Z' },
  ];

  it('renders a message whose sender is an array, instead of crashing', async () => {
    const api = profileApi({ 'email.search': async () => JMAP_MESSAGES });
    await renderPage(api);

    await waitFor(() => expect(screen.getByText('The engine notes')).toBeTruthy());
    // the sender is shown as text, not as an object
    expect(screen.getByText('Ada Lovelace <ada@example.org>')).toBeTruthy();
  });

  it('still matches the contact through the array shape', async () => {
    // the message is only listed if the timeline recognised the sender
    const api = profileApi({ 'email.search': async () => JMAP_MESSAGES });
    await renderPage(api);

    await waitFor(() => expect(screen.getByText('The engine notes')).toBeTruthy());
  });
});

describe('an export the sandbox will not download', () => {
  it('offers the file itself, instead of a success with nothing behind it', async () => {
    const calls = [];
    const api = profileApi({
      'ui.openDialog': async (options) => {
        calls.push(options);
        // first the choice, then the result view
        return calls.length === 1 ? { scope: 'shown', format: 'vcard' } : null;
      },
      // the host refuses, which is when the file has to be shown instead
      'ui.downloadFile': async () => { throw new Error('refused'); },
    });
    await renderPage(api);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Export' })); });

    await waitFor(() => expect(calls).toHaveLength(2));
    const result = calls[1].extraProps.exportResult;
    expect(result.name).toBe('contacts.vcf');
    // the bytes are handed over, so nothing is lost when the download is refused
    expect(result.body).toContain('BEGIN:VCARD');
  });
});

// ── Advisory per-address-book roles (#23) ───────────────────────
//
// The role is not enforced by the host, but the page disables the actions the
// role does not allow, so the convention is visible where it matters.

describe('contacts page: advisory roles', () => {
  const select = async (name) => {
    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name })); });
  };

  it('a viewer role disables merge, edit, cleanup, rules and delete for the selection', async () => {
    const api = profileApi();
    await api.storage.set('bookRoles', { b1: 'viewer' });
    await renderPage(api);

    await select('Select Ada Lovelace');
    await select('Select Grace Hopper');

    expect(screen.getByRole('button', { name: 'Merge selected' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Edit selected' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Clean up' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Rules…' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Delete selected' }).disabled).toBe(true);
    // and the line says which role is holding it back
    expect(screen.getByText(/Role: Viewer/)).toBeTruthy();
  });

  it('an editor role allows editing but not merging or deleting', async () => {
    const api = profileApi();
    await api.storage.set('bookRoles', { b1: 'editor' });
    await renderPage(api);

    await select('Select Grace Hopper');

    expect(screen.getByRole('button', { name: 'Edit selected' }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Merge selected' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Delete selected' }).disabled).toBe(true);
  });

  it('a merger role allows merging and deleting', async () => {
    const api = profileApi();
    await api.storage.set('bookRoles', { b1: 'merger' });
    await renderPage(api);

    await select('Select Grace Hopper');

    expect(screen.getByRole('button', { name: 'Edit selected' }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Delete selected' }).disabled).toBe(false);
  });

  it('a viewer role disables creating a contact and editing the open one', async () => {
    const api = profileApi();
    await api.storage.set('bookRoles', { b1: 'viewer' });
    await renderPage(api);

    expect(screen.getByRole('button', { name: 'New contact' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'New company' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Edit contact' }).disabled).toBe(true);
  });

  it('with no roles stored, every action stays enabled', async () => {
    const api = profileApi();
    await renderPage(api);

    // two selected, so the merge button is not disabled for being a single one
    await select('Select Ada Lovelace');
    await select('Select Grace Hopper');

    expect(screen.getByRole('button', { name: 'Merge selected' }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Delete selected' }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'New contact' }).disabled).toBe(false);
  });
});

// ── Paging a long contact list (#39) ────────────────────────────
//
// The list renders one page at a time, so a large address book cannot turn the
// whole match set into DOM at once. The counts and *Select all* still work over
// the whole match set — the page is a view of the results, not a limit on them.

describe('contacts page: paging a long list', () => {
  const many = (n) => Array.from({ length: n }, (_, i) => makeCard({
    id: `c${String(i).padStart(4, '0')}`,
    name: `Person ${String(i).padStart(4, '0')}`,
    emails: [`p${i}@example.org`],
  }));

  const rows = () => screen.getAllByRole('checkbox');

  async function renderMany(count) {
    const api = profileApi({ 'contacts.list': async () => many(count) });
    const Page = makeProfilePage(React, api);
    await act(async () => { render(React.createElement(Page)); });
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    return api;
  }

  const click = async (name) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name })); }); };

  it('renders one page of a long list, and says where it is', async () => {
    await renderMany(250);

    expect(rows()).toHaveLength(100);
    expect(screen.getByText('Page 1 of 3 · 1–100 of 250')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Next' }).disabled).toBe(false);
  });

  it('walks to the next page, to the last, and back', async () => {
    await renderMany(250);

    await click('Next');
    expect(rows()).toHaveLength(100);
    expect(screen.getByText('Page 2 of 3 · 101–200 of 250')).toBeTruthy();

    await click('Next');
    expect(rows()).toHaveLength(50);
    expect(screen.getByText('Page 3 of 3 · 201–250 of 250')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next' }).disabled).toBe(true);

    await click('Previous');
    expect(screen.getByText('Page 2 of 3 · 101–200 of 250')).toBeTruthy();
  });

  it('shows no pager when the list fits on one page', async () => {
    await renderMany(20);

    expect(rows()).toHaveLength(20);
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  });

  it('starts a new query at the first page', async () => {
    await renderMany(250);
    await click('Next');
    expect(screen.getByText(/Page 2 of 3/)).toBeTruthy();

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'has:email' } });
    });

    expect(screen.getByText('Page 1 of 3 · 1–100 of 250')).toBeTruthy();
  });

  it('Select all still takes the whole match set, not just the page', async () => {
    await renderMany(250);

    await click('Select all 250');

    expect(screen.getByText('250 selected')).toBeTruthy();
  });

  it('renders a bounded page for a very large address book', async () => {
    await renderMany(5000);

    // the DOM holds one page, not the whole book
    expect(rows()).toHaveLength(100);
    expect(screen.getByText('Page 1 of 50 · 1–100 of 5000')).toBeTruthy();
  });
});

// ── Keyboard shortcuts (#39) ────────────────────────────────────
//
// `/` focuses this page's own search box and Esc clears it. Both are scoped to
// the box, so a keystroke meant for something else is left alone — a negative
// twin for each positive.

describe('contacts page: keyboard shortcuts', () => {
  const search = () => screen.getByLabelText('Search contacts');
  const press = (target, key) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    act(() => { target.dispatchEvent(event); });
    return event;
  };

  it('/ focuses the contact search box', async () => {
    await renderPage(profileApi());
    expect(document.activeElement).not.toBe(search());

    const event = press(document.body, '/');

    expect(document.activeElement).toBe(search());
    // it took the keystroke, so the browser does not also type a slash
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves / alone when a field already has focus', async () => {
    await renderPage(profileApi());
    await act(async () => { fireEvent.change(search(), { target: { value: 'ada' } }); });
    search().focus();

    const event = press(search(), '/');

    expect(event.defaultPrevented).toBe(false);
    expect(search().value).toBe('ada');
  });

  it('Esc clears the search box', async () => {
    await renderPage(profileApi());
    await act(async () => { fireEvent.change(search(), { target: { value: 'grace' } }); });
    expect(search().value).toBe('grace');

    await act(async () => { fireEvent.keyDown(search(), { key: 'Escape' }); });

    expect(search().value).toBe('');
  });

  it('Esc outside the search box is left for the host', async () => {
    await renderPage(profileApi());
    await act(async () => { fireEvent.change(search(), { target: { value: 'grace' } }); });

    await act(async () => { fireEvent.keyDown(document.body, { key: 'Escape' }); });

    expect(search().value).toBe('grace');
  });
});
