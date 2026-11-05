// @vitest-environment jsdom
// The single app page: one navigation-rail entry whose body is split into
// sub-tabs (Duplicates, Contacts, Groups, Projects).
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { makeAppShell } from '../src/lib/app-shell.js';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));
afterEach(cleanup);

const Stub = (label) => () => React.createElement('p', null, label);

function renderShell() {
  const api = fakeApi({ translations: manifest.locales });
  const Shell = makeAppShell(React, api, {
    home: Stub('Overview body'),
    duplicates: Stub('Duplicates body'),
    contacts: Stub('Contacts body'),
    groups: Stub('Groups body'),
    projects: Stub('Projects body'),
    settings: Stub('Settings body'),
    health: Stub('Health body'),
    history: Stub('History body'),
    privacy: Stub('Privacy body'),
  });
  render(React.createElement(Shell));
  return api;
}

describe('app shell', () => {
  it('shows the nine sub-tabs, the overview first, and mounts only that one', () => {
    renderShell();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent))
      .toEqual(['Overview', 'Duplicates', 'Contacts', 'Groups', 'Projects', 'Settings', 'Health', 'History', 'Privacy']);
    // the plugin lands on its main page, not on Duplicates
    expect(screen.getByText('Overview body')).toBeTruthy();
    expect(screen.queryByText('Duplicates body')).toBeNull();
    expect(screen.queryByText('Contacts body')).toBeNull();
    expect(screen.queryByText('Groups body')).toBeNull();
    expect(screen.queryByText('Projects body')).toBeNull();
    expect(screen.queryByText('Health body')).toBeNull();
    expect(screen.queryByText('History body')).toBeNull();
    expect(screen.queryByText('Settings body')).toBeNull();
    expect(screen.queryByText('Privacy body')).toBeNull();
  });

  it('marks the active tab and keeps an opened tab mounted', async () => {
    renderShell();

    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');

    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Contacts' })); });
    expect(screen.getByRole('tab', { name: 'Contacts' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Duplicates' }).getAttribute('aria-selected')).toBe('false');
    // hidden but still mounted, so a scan result survives a tab switch
    expect(screen.getByText('Overview body')).toBeTruthy();
    expect(screen.getByText('Contacts body')).toBeTruthy();
    // a tab nobody opened is still not mounted
    expect(screen.queryByText('Duplicates body')).toBeNull();

    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Projects' })); });
    expect(screen.getByText('Projects body')).toBeTruthy();
    expect(screen.getByText('Contacts body')).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Health' })); });
    expect(screen.getByText('Health body')).toBeTruthy();
    // every tab that was opened stays mounted
    expect(screen.getByText('Overview body')).toBeTruthy();
    expect(screen.getByText('Contacts body')).toBeTruthy();
    expect(screen.getByText('Projects body')).toBeTruthy();
  });
});
