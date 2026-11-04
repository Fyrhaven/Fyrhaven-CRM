// Talking to a configured server: the four answers, and never throwing.
import { describe, expect, it } from 'vitest';
import { fakeApi } from '../test-utils/fake-api.mjs';
import {
  CREDENTIAL_ID, REMOTE_CREDENTIAL_KEY, REMOTE_URL_KEY, callServer, connectServer, disconnectServer,
  normalizeServerUrl, readRemoteUrl, readServerState, serverVersion, writeRemoteUrl,
} from '../src/lib/remote.js';

const api = (handlers = {}) => fakeApi({ handlers });
const answer = (body, { status = 200, ok = true } = {}) => async () => ({ status, ok, body });

describe('the configured server', () => {
  it('is nothing until the user sets one', async () => {
    const subject = api();

    expect(await readRemoteUrl(subject)).toBe('');
    expect(await serverVersion(subject)).toEqual({ status: 'unconfigured' });
    expect(subject.calls('proxy.fetch')).toHaveLength(0);
  });

  it('takes a URL with or without a scheme, and without a trailing slash', async () => {
    const subject = api();

    expect(await writeRemoteUrl(subject, 'example.org/')).toBe('https://example.org');
    expect(await writeRemoteUrl(subject, 'http://box.local:8787///')).toBe('http://box.local:8787');
    expect(await writeRemoteUrl(subject, '   ')).toBe('');
    expect(subject.storageSnapshot()[REMOTE_URL_KEY]).toBeUndefined();
  });
});

describe('calling it', () => {
  const configured = (handlers = {}) => {
    const subject = api(handlers);
    return writeRemoteUrl(subject, 'example.org').then(() => subject);
  };

  it('goes through the host proxy, with the credential it holds', async () => {
    const subject = await configured({ 'proxy.fetch': answer('{"version":"0.1.0"}') });
    await subject.storage.set(REMOTE_CREDENTIAL_KEY, 'cred-1');

    expect(await serverVersion(subject)).toEqual({ status: 'ok', version: '0.1.0' });
    expect(subject.calls('proxy.fetch')[0].args)
      .toEqual(['cred-1', 'https://example.org/version', { method: 'GET', body: undefined, headers: undefined }]);
  });

  it('sends an empty credential when the server needs none', async () => {
    const subject = await configured({ 'proxy.fetch': answer('{"version":"1"}') });

    await serverVersion(subject);

    expect(subject.calls('proxy.fetch')[0].args[0]).toBe('');
  });

  it('reports a webmail without a proxy rather than throwing', async () => {
    const subject = await configured();
    subject.proxy = undefined;

    expect(await serverVersion(subject)).toEqual({ status: 'unavailable' });
  });

  it('reports a refusal, with the code', async () => {
    const subject = await configured({ 'proxy.fetch': answer('nope', { status: 503, ok: false }) });

    expect(await callServer(subject, '/version')).toEqual({ status: 'failed', code: 503, reason: 'HTTP 503' });
  });

  it('reports a request that threw, with the reason', async () => {
    const subject = await configured({ 'proxy.fetch': async () => { throw new Error('no route to host'); } });

    expect(await callServer(subject, '/version')).toEqual({ status: 'failed', reason: 'no route to host' });
  });

  it('reports an answer that is not what it should be', async () => {
    const html = await configured({ 'proxy.fetch': answer('<html>') });
    expect(await serverVersion(html)).toEqual({ status: 'failed', reason: 'the answer was not JSON' });

    const empty = await configured({ 'proxy.fetch': answer('{}') });
    expect(await serverVersion(empty)).toEqual({ status: 'failed', reason: 'no version in the answer' });

    const nothing = await configured({ 'proxy.fetch': async () => undefined });
    expect(await serverVersion(nothing)).toEqual({ status: 'failed', reason: 'no response' });
  });

  it('carries a body and a method when asked to', async () => {
    const subject = await configured({ 'proxy.fetch': answer('{}') });

    await callServer(subject, '/sync', { method: 'POST', body: '{"a":1}' });

    expect(subject.calls('proxy.fetch')[0].args[2]).toMatchObject({ method: 'POST', body: '{"a":1}' });
  });
});

describe('connecting the host-held credential (#68)', () => {
  it('asks the host to connect the declared credential, then remembers where the server is', async () => {
    const subject = api({
      'proxy.connect': async () => ({ connected: true, origin: 'https://crm.example.com/', credentialId: 'store-reader' }),
    });

    const result = await connectServer(subject, 'crm.example.com');

    // the token is the host's business: the plugin only names the credential
    expect(subject.calls('proxy.connect')[0].args)
      .toEqual([CREDENTIAL_ID, { mode: 'password', server: 'https://crm.example.com' }]);
    expect(result).toMatchObject({ status: 'ok', url: 'https://crm.example.com' });
    expect(subject.storageSnapshot()[REMOTE_URL_KEY]).toBe('https://crm.example.com');
    expect(subject.storageSnapshot()[REMOTE_CREDENTIAL_KEY]).toBe('store-reader');
  });

  it('writes nothing when the user closes the host dialog', async () => {
    const subject = api({ 'proxy.connect': async () => ({ connected: false }) });

    expect(await connectServer(subject, 'https://crm.example.com')).toEqual({ status: 'failed', reason: 'not connected' });
    expect(subject.storageSnapshot()[REMOTE_URL_KEY]).toBeUndefined();
    expect(subject.storageSnapshot()[REMOTE_CREDENTIAL_KEY]).toBeUndefined();
  });

  it('reports a host that cannot connect rather than throwing', async () => {
    const subject = fakeApi({ host: { exposes: { proxy: ['fetch'] } } });

    expect(await connectServer(subject, 'https://crm.example.com')).toEqual({ status: 'unavailable' });
    expect(await connectServer(api(), '  ')).toEqual({ status: 'failed', reason: 'no address' });
  });

  it('reports a refused connection with the reason the host gave', async () => {
    const subject = api({ 'proxy.connect': async () => { throw new Error('the token was refused'); } });

    expect(await connectServer(subject, 'https://crm.example.com'))
      .toEqual({ status: 'failed', reason: 'the token was refused' });
    expect(subject.storageSnapshot()[REMOTE_URL_KEY]).toBeUndefined();
  });

  it('reports what the plugin is pointed at, and whether it could be', async () => {
    const subject = api();
    expect(await readServerState(subject)).toEqual({ url: '', credentialId: '', canConnect: true });

    await subject.storage.set(REMOTE_URL_KEY, 'https://crm.example.com');
    await subject.storage.set(REMOTE_CREDENTIAL_KEY, 'store');
    expect(await readServerState(subject))
      .toEqual({ url: 'https://crm.example.com', credentialId: 'store', canConnect: true });

    const old = fakeApi({ host: { exposes: { proxy: ['fetch'] } } });
    expect((await readServerState(old)).canConnect).toBe(false);
  });

  it('forgets the server on disconnect, even when the host refuses', async () => {
    const subject = api({ 'proxy.disconnect': async () => { throw new Error('no such account'); } });
    await subject.storage.set(REMOTE_URL_KEY, 'https://crm.example.com');
    await subject.storage.set(REMOTE_CREDENTIAL_KEY, 'store');

    expect(await disconnectServer(subject)).toEqual({ status: 'ok' });
    expect(subject.calls('proxy.disconnect')[0].args).toEqual([CREDENTIAL_ID]);
    expect(subject.storageSnapshot()[REMOTE_URL_KEY]).toBeUndefined();
    expect(subject.storageSnapshot()[REMOTE_CREDENTIAL_KEY]).toBeUndefined();
    expect(await readServerState(subject)).toMatchObject({ url: '', credentialId: '' });
  });

  it('normalises an address the same way the setting does', () => {
    expect(normalizeServerUrl('crm.example.com/')).toBe('https://crm.example.com');
    expect(normalizeServerUrl('https://crm.example.com')).toBe('https://crm.example.com');
    expect(normalizeServerUrl('  ')).toBe('');
  });
});
