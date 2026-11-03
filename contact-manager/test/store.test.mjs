// The storage seam (#68): which keys belong to the server, and that a record
// read never quietly falls back to the browser.
import { describe, expect, it } from 'vitest';
import { fakeApi, proxyResponse } from '../test-utils/fake-api.mjs';
import {
  RECORD_KEYS, VIEW_KEYS, backendFor, isRecord, isViewKey, read, recordsAvailable, remove, write,
} from '../src/lib/store.js';

// Every key constant this plugin stores, imported for real so a new store cannot
// be added without deciding whether it is a record or view state.
import { AUTOMATION_KEY } from '../src/lib/automation.js';
import { IGNORE_KEY, POLICIES_KEY } from '../src/lib/book-policies.js';
import { ROLES_KEY } from '../src/lib/book-roles.js';
import { CONSENT_KEY } from '../src/lib/consent.js';
import { DIGEST_KEY } from '../src/lib/digest.js';
import { DISMISSED_KEY, LAST_SCAN_KEY } from '../src/lib/duplicates.js';
import { HISTORY_KEY } from '../src/lib/history.js';
import { TEMPLATES_KEY } from '../src/lib/import-templates.js';
import { CLEANUP_KEY, REGION_KEY } from '../src/lib/normalise.js';
import { NOTES_KEY } from '../src/lib/notes.js';
import { ONBOARDING_KEY } from '../src/lib/onboarding.js';
import { DELETION_KEY } from '../src/lib/privacy.js';
import { PROJECTS_KEY } from '../src/lib/projects.js';
import { REMOTE_CREDENTIAL_KEY, REMOTE_URL_KEY } from '../src/lib/remote.js';
import { RULES_KEY } from '../src/lib/rules.js';
import { SAVED_KEY } from '../src/lib/saved-searches.js';
import { UNDO_KEY } from '../src/lib/undo.js';

const ALL_KEYS = [
  AUTOMATION_KEY, IGNORE_KEY, POLICIES_KEY, ROLES_KEY, CONSENT_KEY, DIGEST_KEY,
  DISMISSED_KEY, LAST_SCAN_KEY, HISTORY_KEY, TEMPLATES_KEY, CLEANUP_KEY, REGION_KEY,
  NOTES_KEY, ONBOARDING_KEY, DELETION_KEY, PROJECTS_KEY, REMOTE_CREDENTIAL_KEY,
  REMOTE_URL_KEY, RULES_KEY, SAVED_KEY, UNDO_KEY,
];

/** An api with a server configured and a proxy that answers whatever is asked. */
async function withServer(handlers = {}) {
  const api = fakeApi({ handlers: { 'proxy.fetch': async () => proxyResponse('{}'), ...handlers } });
  await api.storage.set(REMOTE_URL_KEY, 'https://crm.example');
  return api;
}

const answerWith = (value) => async () => proxyResponse(JSON.stringify({ key: 'projects', value }));

describe('the classification', () => {
  it('classifies every key this plugin stores', () => {
    for (const key of ALL_KEYS) {
      expect(isRecord(key) || isViewKey(key), `${key} is neither a record nor view state`).toBe(true);
    }
  });

  it('never calls a key both things', () => {
    for (const key of RECORD_KEYS) expect(VIEW_KEYS.has(key), key).toBe(false);
  });

  it('sends records to the server and view state to the browser', () => {
    expect(backendFor(PROJECTS_KEY)).toBe('remote');
    expect(backendFor(NOTES_KEY)).toBe('remote');
    expect(backendFor(CONSENT_KEY)).toBe('remote');
    expect(backendFor(ONBOARDING_KEY)).toBe('local');
    // the phone region is a preference, but the maintainer's call is that it
    // follows the user rather than the browser
    expect(backendFor(REGION_KEY)).toBe('remote');
    // the server's own address and credential cannot live on the server
    expect(isRecord(REMOTE_URL_KEY)).toBe(false);
    expect(isRecord(REMOTE_CREDENTIAL_KEY)).toBe(false);
    // the undo batch holds copies of removed contacts: the browser is safer
    expect(isRecord(UNDO_KEY)).toBe(false);
  });

  it('treats an unknown key as view state, so a store nobody classified still works', () => {
    expect(backendFor('something-new')).toBe('local');
  });
});

describe('read', () => {
  it('reads view state from the host storage, without asking the server', async () => {
    const api = fakeApi();
    await api.storage.set(ONBOARDING_KEY, { done: true, at: null });

    expect(await read(api, ONBOARDING_KEY)).toEqual({ status: 'ok', value: { done: true, at: null } });
    expect(api.calls('proxy.fetch')).toHaveLength(0);
  });

  it('reads a record from the server', async () => {
    const api = await withServer({ 'proxy.fetch': answerWith([{ id: 'p1' }]) });

    expect(await read(api, PROJECTS_KEY)).toEqual({ status: 'ok', value: [{ id: 'p1' }] });
    const [credentialId, url] = api.calls('proxy.fetch')[0].args;
    expect(url).toBe('https://crm.example/v1/store/projects');
    expect(credentialId).toBe(''); // no credential configured: an unauthenticated call
  });

  it('reads a 404 as "nothing saved yet", not as a failure', async () => {
    const api = await withServer({
      'proxy.fetch': async () => proxyResponse('not found', { status: 404 }),
    });

    expect(await read(api, PROJECTS_KEY)).toEqual({ status: 'ok', value: null });
  });

  it('reports unavailable when no server is configured', async () => {
    const api = fakeApi();

    expect(await read(api, PROJECTS_KEY)).toEqual({ status: 'unavailable', reason: 'unconfigured' });
    expect(api.calls('proxy.fetch')).toHaveLength(0);
  });

  it('reports unavailable on a host with no proxy at all', async () => {
    const api = fakeApi({ host: { absent: ['proxy'] } });
    await api.storage.set(REMOTE_URL_KEY, 'https://crm.example');

    expect((await read(api, PROJECTS_KEY)).status).toBe('unavailable');
  });

  it('reports an answer it cannot read rather than an empty record', async () => {
    const api = await withServer({ 'proxy.fetch': async () => proxyResponse('not json') });

    expect(await read(api, PROJECTS_KEY))
      .toEqual({ status: 'unavailable', reason: 'the answer was not JSON' });
  });
});

describe('write', () => {
  it('writes view state to the host storage', async () => {
    const api = fakeApi();

    expect(await write(api, ONBOARDING_KEY, { done: true, at: 'now' })).toEqual({ status: 'ok' });
    expect(await api.storage.get(ONBOARDING_KEY)).toEqual({ done: true, at: 'now' });
    expect(api.calls('proxy.fetch')).toHaveLength(0);
  });

  it('writes a record to the server, as JSON', async () => {
    const api = await withServer({ 'proxy.fetch': async () => proxyResponse('{"revision":7}') });

    expect(await write(api, PROJECTS_KEY, [{ id: 'p1' }])).toEqual({ status: 'ok', revision: 7 });

    const [credentialId, url, init] = api.calls('proxy.fetch')[0].args;
    expect(credentialId).toBe('');
    expect(url).toBe('https://crm.example/v1/store/projects');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ value: [{ id: 'p1' }] });
    expect(init.headers['content-type']).toBe('application/json');
  });

  it('writes nothing to the browser when a record has no server', async () => {
    const api = fakeApi();

    expect(await write(api, PROJECTS_KEY, [{ id: 'p1' }]))
      .toEqual({ status: 'unavailable', reason: 'unconfigured' });
    // the point of the decision: no silent local copy
    expect(await api.storage.get(PROJECTS_KEY)).toBeNull();
  });

  it('sends the configured credential id, which the host holds', async () => {
    const api = await withServer({ 'proxy.fetch': async () => proxyResponse('{}') });
    await api.storage.set(REMOTE_CREDENTIAL_KEY, 'cred-1');

    await write(api, PROJECTS_KEY, []);

    expect(api.calls('proxy.fetch')[0].args[0]).toBe('cred-1');
  });
});

describe('remove', () => {
  it('removes view state from the host storage', async () => {
    const api = fakeApi();
    await api.storage.set(ONBOARDING_KEY, { done: true });

    expect(await remove(api, ONBOARDING_KEY)).toEqual({ status: 'ok' });
    expect(await api.storage.get(ONBOARDING_KEY)).toBeNull();
  });

  it('removes a record on the server', async () => {
    const api = await withServer({ 'proxy.fetch': async () => proxyResponse('{"ok":true}') });

    expect(await remove(api, PROJECTS_KEY)).toEqual({ status: 'ok' });
    const [, url, init] = api.calls('proxy.fetch')[0].args;
    expect(url).toBe('https://crm.example/v1/store/projects');
    expect(init.method).toBe('DELETE');
  });

  it('reports unavailable when no server is configured', async () => {
    const api = fakeApi();
    expect((await remove(api, PROJECTS_KEY)).status).toBe('unavailable');
  });
});

describe('recordsAvailable', () => {
  it('is true only once a server is configured', async () => {
    const api = fakeApi();
    expect(await recordsAvailable(api)).toBe(false);

    await api.storage.set(REMOTE_URL_KEY, 'https://crm.example');
    expect(await recordsAvailable(api)).toBe(true);
  });

  it('is false when storage cannot even be read', async () => {
    const api = fakeApi();
    api.storage.get = async () => { throw new Error('refused'); };
    expect(await recordsAvailable(api)).toBe(false);
  });
});
