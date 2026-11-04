// @vitest-environment jsdom
// The policies dialog: renders books, toggles, ignore rules, and saves.
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { SlotPropsContext } from '../test-utils/ui-kit.mjs';
import { makePoliciesDialog } from '../src/lib/policies-dialog.js';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));
afterEach(cleanup);

function dialogApi(handlers = {}) {
  return fakeApi({ translations: manifest.locales, handlers: { 'ui.confirm': async () => true, ...handlers } });
}

const books = [
  { id: 'b1', name: 'Personal' },
  { id: 'b2', name: 'Work' },
];

describe('policies dialog', () => {
  it('renders the book list and ignore sections', async () => {
    const api = dialogApi();
    const Dialog = makePoliciesDialog(React, api);
    await act(async () => {
      render(
        React.createElement(SlotPropsContext.Provider, { value: { policiesDialog: true, books } },
          React.createElement(Dialog, {
            policiesDialog: true, books,
            onResult: () => {},
          })),
      );
    });
    await waitFor(() => {
      expect(screen.getByText('Personal')).toBeTruthy();
      expect(screen.getByText('Work')).toBeTruthy();
    });
    expect(screen.getByText(manifest.locales.en['policies.ignoredDomains'])).toBeTruthy();
    expect(screen.getByText(manifest.locales.en['policies.ignoredTags'])).toBeTruthy();
  });

  it('saves when the save button is clicked', async () => {
    const api = dialogApi();
    const Dialog = makePoliciesDialog(React, api);
    let result = null;
    await act(async () => {
      render(
        React.createElement(SlotPropsContext.Provider, { value: { policiesDialog: true, books } },
          React.createElement(Dialog, {
            policiesDialog: true, books,
            onResult: (v) => { result = v; },
          })),
      );
    });
    await waitFor(() => screen.getByText('Personal'));

    // Add a domain
    const domainInput = screen.getByPlaceholderText('example.com');
    await act(async () => { fireEvent.change(domainInput, { target: { value: 'spam.com' } }); });
    const addButtons = screen.getAllByText(manifest.locales.en['policies.addDomain']);
    await act(async () => { fireEvent.click(addButtons[0]); });

    // Click save (the DialogButtons renders button labels)
    const saveLabel = manifest.locales.en['policies.save'];
    await waitFor(() => screen.getByText(saveLabel));
    await act(async () => { fireEvent.click(screen.getByText(saveLabel)); });

    await waitFor(() => {
      expect(result).toEqual({ saved: true });
    });
    const stored = await api.storage.get('bookIgnore');
    expect(stored.domains).toContain('spam.com');
  });
});

// ── The per-book controls ───────────────────────────────────────
//
// These are the interactions the dialog exists for. Each one is written the
// way a user performs it — one click, not two — and each one asserts what
// lands in storage, because a control that looks right and writes nothing is
// the failure this dialog already had once.

const ONE_BOOK = [{ id: 'b1', name: 'Personal' }];
const en = () => manifest.locales.en;

async function openDialog(books = ONE_BOOK) {
  const api = dialogApi();
  const Dialog = makePoliciesDialog(React, api);
  const state = { result: undefined };
  await act(async () => {
    render(
      React.createElement(SlotPropsContext.Provider, { value: { policiesDialog: true, books } },
        React.createElement(Dialog, { policiesDialog: true, books, onResult: (v) => { state.result = v; } })),
    );
  });
  await waitFor(() => screen.getByText(en()['policies.ignoreSection']));
  return { api, state };
}

const click = async (element) => { await act(async () => { fireEvent.click(element); }); };
const save = async () => { await click(screen.getByText(en()['policies.save'])); };
const enabledBox = () => screen.getByLabelText(en()['policies.enabled']);
const strategy = (key) => screen.getByRole('radiogroup', { name: en()[key] });

describe('policies dialog: the per-book controls', () => {
  it('turns a book off with ONE click, and back on with another', async () => {
    await openDialog();
    expect(enabledBox().getAttribute('aria-checked')).toBe('true');
    await click(enabledBox());
    expect(enabledBox().getAttribute('aria-checked')).toBe('false');
    await click(enabledBox());
    expect(enabledBox().getAttribute('aria-checked')).toBe('true');
  });

  it('stores the book being turned off', async () => {
    const { api, state } = await openDialog();
    await click(enabledBox());
    await save();
    await waitFor(() => expect(state.result).toEqual({ saved: true }));
    expect(await api.storage.get('bookPolicies')).toEqual({ b1: { enabled: false } });
  });

  it('offers Default, On and Off per strategy, and starts on Default', async () => {
    await openDialog();
    const group = strategy('policies.matchByEmail');
    const checked = (name) => within(group).getByRole('radio', { name: en()[name] }).getAttribute('aria-checked');
    expect(checked('policies.default')).toBe('true');
    expect(checked('policies.on')).toBe('false');
    expect(checked('policies.off')).toBe('false');
  });

  it('stores a strategy override', async () => {
    const { api, state } = await openDialog();
    await click(within(strategy('policies.matchByName')).getByRole('radio', { name: en()['policies.off'] }));
    await save();
    await waitFor(() => expect(state.result).toEqual({ saved: true }));
    expect(await api.storage.get('bookPolicies')).toEqual({ b1: { matchByName: false } });
  });

  it('reads a stored override back, and can take it back to Default', async () => {
    const api = dialogApi();
    await api.storage.set('bookPolicies', { b1: { matchByEmail: false } });
    const Dialog = makePoliciesDialog(React, api);
    await act(async () => {
      render(React.createElement(Dialog, { policiesDialog: true, books: ONE_BOOK, onResult: () => {} }));
    });
    await waitFor(() => screen.getByText('Personal'));
    const group = strategy('policies.matchByEmail');
    expect(within(group).getByRole('radio', { name: en()['policies.off'] }).getAttribute('aria-checked')).toBe('true');

    await click(within(group).getByRole('radio', { name: en()['policies.default'] }));
    await save();
    // Back to "use the global setting" means the override is GONE, not false.
    await waitFor(() => expect(api.storage.get('bookPolicies')).resolves.toBeNull());
  });

  it('cancel writes nothing', async () => {
    const { api, state } = await openDialog();
    await click(enabledBox());
    await click(screen.getByText(en()['dialog.cancel']));
    expect(state.result).toBeNull();
    expect(await api.storage.get('bookPolicies')).toBeNull();
  });

  it('says so when the account has no address books', async () => {
    const api = dialogApi();
    const Dialog = makePoliciesDialog(React, api);
    await act(async () => {
      render(React.createElement(Dialog, { policiesDialog: true, books: [], onResult: () => {} }));
    });
    await waitFor(() => screen.getByText(en()['policies.noBooks']));
  });

  it('reports a save that failed instead of swallowing it', async () => {
    const { api, state } = await openDialog();
    await click(enabledBox());
    // storage is real in the fake, so break it the only way available: replace it.
    api.storage.set = async () => { throw new Error('refused'); };
    await save();
    await waitFor(() => expect(api.calls('ui.alert')).toHaveLength(1));
    expect(state.result).toBeUndefined(); // the dialog did not claim success
  });

  it('says so when the stored policies could not be read', async () => {
    // Quietly showing an empty dialog would let the user save over the real
    // policies without ever seeing them.
    const api = dialogApi();
    api.storage.get = async () => { throw new Error('refused'); };
    const Dialog = makePoliciesDialog(React, api);
    await act(async () => {
      render(React.createElement(Dialog, { policiesDialog: true, books: ONE_BOOK, onResult: () => {} }));
    });
    await waitFor(() => expect(api.calls('ui.alert')).toHaveLength(1));
  });
});


// ── Protected fields (#7) ───────────────────────────────────────

describe('policies dialog: protected fields', () => {
  const field = (name) => screen.getByLabelText(en()[`policies.field.${name}`]);

  it('stores a field as protected, and reads it back', async () => {
    const { api, state } = await openDialog();
    expect(field('name').getAttribute('aria-checked')).toBe('false');
    await click(field('name'));
    expect(field('name').getAttribute('aria-checked')).toBe('true');
    await save();
    await waitFor(() => expect(state.result).toEqual({ saved: true }));
    expect(await api.storage.get('bookPolicies')).toEqual({ b1: { protectedFields: ['name'] } });
  });

  it('unprotects a field again, leaving no empty list behind', async () => {
    const api = dialogApi();
    await api.storage.set('bookPolicies', { b1: { protectedFields: ['name'] } });
    const Dialog = makePoliciesDialog(React, api);
    await act(async () => {
      render(React.createElement(Dialog, { policiesDialog: true, books: ONE_BOOK, onResult: () => {} }));
    });
    await waitFor(() => screen.getByText('Personal'));
    expect(field('name').getAttribute('aria-checked')).toBe('true');

    await click(field('name'));
    await save();
    // Nothing left to store: the book's policy goes, rather than an empty list.
    await waitFor(() => expect(api.storage.get('bookPolicies')).resolves.toBeNull());
  });

  it('keeps a protected field alongside the other settings of the same book', async () => {
    const { api, state } = await openDialog();
    await click(within(strategy('policies.matchByName')).getByRole('radio', { name: en()['policies.off'] }));
    await click(field('emails'));
    await save();
    await waitFor(() => expect(state.result).toEqual({ saved: true }));
    expect(await api.storage.get('bookPolicies'))
      .toEqual({ b1: { matchByName: false, protectedFields: ['emails'] } });
  });
});


// ── Ignore rules by field (#7) ──────────────────────────────────
//
// The company rule. Enter is used to add, because the three "Add" buttons
// (domain, tag, company) carry the same label and the keyboard path is the one
// a user actually takes.

describe('policies dialog: ignored companies', () => {
  const addCompany = async (name) => {
    const input = screen.getByPlaceholderText(en()['policies.companyPlaceholder']);
    await act(async () => { fireEvent.change(input, { target: { value: name } }); });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
  };

  it('adds a company with Enter and stores it', async () => {
    const { api, state } = await openDialog();
    await addCompany('Acme');
    expect(screen.getByText('Acme \u00d7')).toBeTruthy();
    await save();
    await waitFor(() => expect(state.result).toEqual({ saved: true }));
    expect(await api.storage.get('bookIgnore'))
      .toEqual({ domains: [], tags: [], companies: ['Acme'] });
  });

  it('reads stored companies back, and removes one', async () => {
    const api = dialogApi();
    await api.storage.set('bookIgnore', { domains: [], tags: [], companies: ['Acme', 'Initech'] });
    const Dialog = makePoliciesDialog(React, api);
    await act(async () => {
      render(React.createElement(Dialog, { policiesDialog: true, books: ONE_BOOK, onResult: () => {} }));
    });
    await waitFor(() => screen.getByText('Acme \u00d7'));
    expect(screen.getByText('Initech \u00d7')).toBeTruthy();

    await click(screen.getByText('Acme \u00d7'));
    await save();
    await waitFor(() => expect(api.storage.get('bookIgnore'))
      .resolves.toEqual({ domains: [], tags: [], companies: ['Initech'] }));
  });

  it('ignores a company twice added, rather than storing it twice', async () => {
    const { api, state } = await openDialog();
    await addCompany('Acme');
    await addCompany('Acme');
    await save();
    await waitFor(() => expect(state.result).toEqual({ saved: true }));
    expect(await api.storage.get('bookIgnore'))
      .toEqual({ domains: [], tags: [], companies: ['Acme'] });
  });
});

