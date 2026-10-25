// @vitest-environment jsdom
// The policies dialog: renders books, toggles, ignore rules, and saves.
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
