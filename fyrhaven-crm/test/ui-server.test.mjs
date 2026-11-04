// @vitest-environment jsdom
// The Cloud server dialog and the funnel behind it (#68): point the plugin at a
// server, let the host connect the credential, and forget it again.
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { makeServerDialog } from '../src/lib/server-dialog.js';
import { openServer } from '../src/lib/actions.js';
import { REMOTE_CREDENTIAL_KEY, REMOTE_URL_KEY } from '../src/lib/remote.js';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));
const en = () => manifest.locales.en;
afterEach(cleanup);

const STATE = { url: '', credentialId: '', canConnect: true };

async function renderDialog(state = STATE) {
  const api = fakeApi({ translations: manifest.locales });
  const Dialog = makeServerDialog(React, api);
  const calls = [];
  await act(async () => {
    render(React.createElement(Dialog, { serverEditor: { state }, onResult: (value) => calls.push(value) }));
  });
  return calls;
}

const type = async (value) => {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(en()['server.address']), { target: { value } });
  });
};

describe('the cloud server dialog', () => {
  it('says the plugin is local-only until a server is set', async () => {
    await renderDialog();

    expect(screen.getByText(en()['server.localOnly'])).toBeTruthy();
    expect(screen.getByLabelText(en()['server.address']).value).toBe('');
  });

  it('returns the address to connect, and never connects anything itself', async () => {
    const calls = await renderDialog();
    await type('crm.mailz.se');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en()['server.connect'] })); });

    // a choice, not a write: the funnel in actions.js does the connecting
    expect(calls).toEqual([{ connect: { url: 'crm.mailz.se', mode: 'self' } }]);
  });

  it('offers the address it is already pointed at, and a way to forget it', async () => {
    const calls = await renderDialog({ url: 'https://crm.mailz.se', credentialId: 'store', canConnect: true });

    expect(screen.getByText(en()['server.connected'].replace('{url}', 'https://crm.mailz.se'))).toBeTruthy();
    expect(screen.getByLabelText(en()['server.address']).value).toBe('https://crm.mailz.se');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en()['server.disconnect'] })); });
    expect(calls).toEqual([{ disconnect: true }]);
  });

  it('cannot connect at all when the webmail has no api.proxy.connect', async () => {
    await renderDialog({ url: '', credentialId: '', canConnect: false });
    await type('crm.mailz.se');

    expect(screen.getByText(en()['server.noConnect'])).toBeTruthy();
    expect(screen.getByRole('button', { name: en()['server.connect'] }).disabled).toBe(true);
  });
});

describe('opening it from the palette', () => {
  const serverApi = (handlers = {}) => fakeApi({
    translations: manifest.locales,
    handlers: {
      'proxy.connect': async () => ({ connected: true, origin: 'https://crm.mailz.se', credentialId: 'store' }),
      'proxy.fetch': async () => ({ status: 200, ok: true, headers: {}, body: '{"ok":true,"version":"1.0.0"}' }),
      ...handlers,
    },
  });

  it('connects what the dialog chose, remembers it, and says what the server answered', async () => {
    const api = serverApi({ 'ui.openDialog': async () => ({ connect: { url: 'crm.mailz.se' } }) });

    await openServer(api);

    expect(api.calls('proxy.connect')[0].args).toEqual(['store', { mode: 'password', server: 'https://crm.mailz.se' }]);
    expect(api.storageSnapshot()[REMOTE_URL_KEY]).toBe('https://crm.mailz.se');
    expect(api.storageSnapshot()[REMOTE_CREDENTIAL_KEY]).toBe('store');
    // the mode is remembered, so the dialog opens where the user left it
    expect(api.storageSnapshot().remoteMode).toBe('self');
    expect(api.calls('toast.success').map((call) => call.args[0]))
      .toEqual(['Connected to https://crm.mailz.se.']);
    // and the plan is asked for, not assumed
    expect(api.calls('proxy.fetch')).toHaveLength(1);
  });

  it('stores nothing and says why when the host refused', async () => {
    const api = serverApi({
      'ui.openDialog': async () => ({ connect: { url: 'crm.mailz.se' } }),
      'proxy.connect': async () => ({ connected: false }),
    });

    await openServer(api);

    expect(api.storageSnapshot()[REMOTE_URL_KEY]).toBeUndefined();
    expect(api.calls('toast.error')[0].args[0]).toBe('The server could not be connected: not connected');
    expect(api.calls('proxy.fetch')).toHaveLength(0);
  });

  it('does nothing at all when the dialog was closed', async () => {
    const api = serverApi({ 'ui.openDialog': async () => null });

    await openServer(api);

    expect(api.calls('proxy.connect')).toHaveLength(0);
    expect(api.calls('toast.success')).toHaveLength(0);
  });

  it('forgets the server when the dialog asked to disconnect', async () => {
    const api = serverApi({ 'ui.openDialog': async () => ({ disconnect: true }) });
    await api.storage.set(REMOTE_URL_KEY, 'https://crm.mailz.se');

    await openServer(api);

    expect(api.calls('proxy.disconnect')[0].args).toEqual(['store']);
    expect(api.storageSnapshot()[REMOTE_URL_KEY]).toBeUndefined();
    expect(api.calls('toast.info')[0].args[0]).toBe('Disconnected. The plugin is local-only again.');
  });

  it('passes the current state to the dialog, so it opens where the user left it', async () => {
    const seen = [];
    const api = serverApi({
      'ui.openDialog': async (request) => { seen.push(request); return null; },
    });
    await api.storage.set(REMOTE_URL_KEY, 'https://crm.mailz.se');

    await openServer(api);

    expect(seen[0].extraProps.serverEditor.state).toMatchObject({
      url: 'https://crm.mailz.se', credentialId: '', canConnect: true, mode: 'self',
    });
  });
});
