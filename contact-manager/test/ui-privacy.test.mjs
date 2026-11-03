// @vitest-environment jsdom
// The Privacy tab (#26): the subject picker, the export, erasure and the
// consent editor.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { filesHost } from '../test-utils/files-host.mjs';
import { makePrivacyPage } from '../src/lib/privacy-page.js';
import { makeConsentDialog } from '../src/lib/consent-dialog.js';
import { readConsents } from '../src/lib/consent.js';
import { readHistory } from '../src/lib/history.js';
import { readDeletions } from '../src/lib/privacy.js';
import { makeCard } from './fixtures.mjs';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));
const en = (key) => manifest.locales.en[key];

// jsdom has no Blob URL support; the export falls back to it only when the host
// has no downloadFile, which the fake always does.
URL.createObjectURL = vi.fn(() => 'blob:test');
URL.revokeObjectURL = vi.fn();
afterEach(cleanup);

const ADA = makeCard({ id: 'a', name: 'Ada Lovelace', emails: ['ada@example.org'], phones: ['+491761234567'] });
const GRACE = makeCard({ id: 'g', name: 'Grace Hopper', emails: ['grace@example.org'] });

const privacyApi = (handlers = {}) => {
  // Consent records are records (#68): they need a server to live on.
  const files = filesHost();
  return fakeApi({
    translations: manifest.locales,
    host: files.host,
    handlers: {
      ...files.handlers,
    'contacts.list': async () => [ADA, GRACE],
    'ui.confirm': async () => true,
    'contacts.update': async () => {},
    'contacts.remove': async () => {},
      ...handlers,
    },
  });
};

async function renderPage(api) {
  const Page = makePrivacyPage(React, api);
  await act(async () => { render(React.createElement(Page)); });
  await waitFor(() => expect(screen.getByText(en('privacy.title'))).toBeTruthy());
}

const pick = async (name) => {
  await act(async () => { fireEvent.click(screen.getByText(name)); });
};

describe('the Privacy tab', () => {
  it('lists subjects and shows what is held for the one picked', async () => {
    await renderPage(privacyApi());
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('Grace Hopper')).toBeTruthy();

    await pick('Ada Lovelace');
    expect(screen.getByText(en('privacy.detailTitle').replace('{name}', 'Ada Lovelace'))).toBeTruthy();
    expect(screen.getByRole('button', { name: en('privacy.anonymise') })).toBeTruthy();
    expect(screen.getByRole('button', { name: en('privacy.erase') })).toBeTruthy();
  });

  it('exports the subject-access JSON through the host download', async () => {
    const api = privacyApi();
    await renderPage(api);
    await pick('Ada Lovelace');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en('privacy.exportJson') })); });

    await waitFor(() => expect(api.calls('ui.downloadFile')).toHaveLength(1));
    const [name, body, type] = api.calls('ui.downloadFile')[0].args;
    expect(name).toBe('ada-lovelace.json');
    expect(type).toBe('application/json');
    expect(JSON.parse(body).subject).toEqual({ id: 'a', name: 'Ada Lovelace' });
  });

  it('anonymises after the confirm and records the deletion', async () => {
    const api = privacyApi();
    await renderPage(api);
    await pick('Ada Lovelace');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en('privacy.anonymise') })); });

    await waitFor(() => expect(api.calls('contacts.update')).toHaveLength(1));
    expect(api.calls('contacts.update')[0].args[0]).toBe('a');
    expect(api.calls('contacts.update')[0].args[1].name.full).toBe('[anonymised]');
    expect((await readDeletions(api))[0]).toMatchObject({ id: 'a', method: 'anonymise' });
    await waitFor(() => expect(screen.getByText(en('privacy.logTitle'))).toBeTruthy());
  });

  it('erases after the confirm, and the report is only offered once there is a log', async () => {
    const api = privacyApi();
    await renderPage(api);
    expect(screen.getByRole('button', { name: en('privacy.exportReport') }).disabled).toBe(true);

    await pick('Grace Hopper');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en('privacy.erase') })); });

    await waitFor(() => expect(api.calls('contacts.remove')).toHaveLength(1));
    expect(api.calls('contacts.remove')[0].args[0]).toBe('g');
    expect((await readDeletions(api))[0]).toMatchObject({ id: 'g', method: 'erase' });
    await waitFor(() => expect(screen.getByRole('button', { name: en('privacy.exportReport') }).disabled).toBe(false));
  });

  it('opens the consent editor for the picked subject', async () => {
    const api = privacyApi();
    await renderPage(api);
    await pick('Ada Lovelace');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en('privacy.manageConsent') })); });

    const call = api.calls('ui.openDialog')[0].args[0];
    expect(call.extraProps.consentEditor.card.id).toBe('a');
  });
});

describe('the consent editor', () => {
  const renderDialog = (api, records = []) => {
    const Dialog = makeConsentDialog(React, api);
    render(React.createElement(Dialog, { consentEditor: { card: ADA, records }, onResult: () => {} }));
  };

  it('saves a consent and audits the change', async () => {
    const api = privacyApi();
    renderDialog(api);
    await act(async () => { fireEvent.change(screen.getByLabelText(/Source/), { target: { value: 'newsletter' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en('consent.save') })); });

    await waitFor(() => expect(screen.getByText(/newsletter/)).toBeTruthy());
    expect((await readConsents(api))[0]).toMatchObject({ contactId: 'a', source: 'newsletter' });
    expect((await readHistory(api))[0]).toMatchObject({ kind: 'consent', subject: 'a' });
  });

  it('shows an existing record with its status and removes it', async () => {
    const api = privacyApi();
    const record = { contactId: 'a', source: 'events', basis: 'legitimate-interest', grantedAt: '2020-01-01', expiresAt: '2020-06-01', note: '' };
    renderDialog(api, [record]);
    expect(screen.getByText(/events · Legitimate interest/)).toBeTruthy();
    expect(screen.getByText(en('consent.status.expired'))).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en('consent.remove') })); });
    await waitFor(() => expect(screen.getByText(en('consent.none'))).toBeTruthy());
    expect(await readConsents(api)).toEqual([]);
  });

  it('refuses a record with no source', async () => {
    const api = privacyApi();
    renderDialog(api);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en('consent.save') })); });
    expect(screen.getByText(en('consent.error.source'))).toBeTruthy();
    expect(await readConsents(api)).toEqual([]);
  });
});
