// The cloud store's own tests: `node --test`, no dependencies, no fixtures. The
// real HTTP path is exercised on an ephemeral port, so the routing, the auth and
// the JSON shapes are all covered the way the plugin will hit them.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_VALUE_BYTES, createStoreServer, parseTokens } from './server.js';

let server;
let base;

before(async () => {
  ({ server } = createStoreServer({ tokenList: 'tok-a=acme,tok-b=other' }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  // Node's fetch keeps connections alive, and `close` waits for them.
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

const call = (path, { method = 'GET', token = 'tok-a', body } = {}) => fetch(`${base}${path}`, {
  method,
  headers: {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
  },
  body: body === undefined ? undefined : JSON.stringify(body),
});

describe('parseTokens', () => {
  it('reads a single token as its own workspace', () => {
    assert.deepEqual([...parseTokens('secret')], [['secret', 'secret']]);
  });

  it('reads token=workspace pairs, and trims them', () => {
    assert.deepEqual([...parseTokens(' tok-a = acme , tok-b=other ')], [['tok-a', 'acme'], ['tok-b', 'other']]);
  });

  it('ignores empty entries', () => {
    assert.equal(parseTokens('').size, 0);
    assert.equal(parseTokens('  ,  , ').size, 0);
    assert.equal(parseTokens(undefined).size, 0);
  });
});

describe('the open endpoints', () => {
  it('answers /health and /version without a token', async () => {
    for (const path of ['/health', '/version']) {
      const response = await call(path, { token: '' });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.ok, true);
      assert.match(body.version, /^\d+\.\d+\.\d+$/);
    }
  });
});

describe('authentication', () => {
  it('refuses the store without a token, and with the wrong one', async () => {
    assert.equal((await call('/v1/store', { token: '' })).status, 401);
    assert.equal((await call('/v1/store', { token: 'nope' })).status, 401);
    assert.equal((await call('/v1/store/projects', { token: '' })).status, 401);
  });

  it('accepts the token as a query parameter too, for a host that cannot set a header', async () => {
    const response = await call('/v1/store?token=tok-a', { token: '' });
    assert.equal(response.status, 200);
  });

  it('keeps one workspace out of another', async () => {
    await call('/v1/store/projects', { method: 'PUT', token: 'tok-a', body: { value: ['acme'] } });

    assert.equal((await call('/v1/store/projects', { token: 'tok-b' })).status, 404);
    const mine = await (await call('/v1/store/projects', { token: 'tok-a' })).json();
    assert.deepEqual(mine.value, ['acme']);
  });
});

describe('one record', () => {
  it('round-trips a value, and answers a missing key with 404', async () => {
    const put = await call('/v1/store/contactNotes', { method: 'PUT', body: { value: { c1: [{ id: 'n1' }] } } });
    assert.equal(put.status, 200);
    assert.equal(typeof (await put.json()).revision, 'number');

    const got = await (await call('/v1/store/contactNotes')).json();
    assert.deepEqual(got.value, { c1: [{ id: 'n1' }] });

    assert.equal((await call('/v1/store/nothingHere')).status, 404);
  });

  it('overwrites, and deletes', async () => {
    await call('/v1/store/savedSearches', { method: 'PUT', body: { value: ['one'] } });
    await call('/v1/store/savedSearches', { method: 'PUT', body: { value: ['one', 'two'] } });
    assert.deepEqual((await (await call('/v1/store/savedSearches')).json()).value, ['one', 'two']);

    assert.equal((await call('/v1/store/savedSearches', { method: 'DELETE' })).status, 200);
    assert.equal((await call('/v1/store/savedSearches')).status, 404);
    // deleting what is already gone is not an error
    assert.equal((await call('/v1/store/savedSearches', { method: 'DELETE' })).status, 200);
  });

  it('refuses a body that is not JSON, or has no value', async () => {
    const raw = await fetch(`${base}/v1/store/projects`, {
      method: 'PUT',
      headers: { authorization: 'Bearer tok-a', 'content-type': 'application/json' },
      body: 'not json',
    });
    assert.equal(raw.status, 400);
    assert.equal((await call('/v1/store/projects', { method: 'PUT', body: { notValue: 1 } })).status, 400);
  });

  it('refuses a key that is not a slug', async () => {
    assert.equal((await call('/v1/store/..%2Fetc')).status, 400);
    assert.equal((await call(`/v1/store/${'x'.repeat(65)}`)).status, 400);
  });

  it('refuses a value past the cap', async () => {
    const big = 'x'.repeat(MAX_VALUE_BYTES + 10);
    assert.equal((await call('/v1/store/projects', { method: 'PUT', body: { value: big } })).status, 413);
  });
});

describe('the whole scope', () => {
  it('lists every record, and the revision moves on a write', async () => {
    await call('/v1/store/automationRules', { method: 'PUT', body: { value: [{ id: 'r1' }] } });

    const first = await (await call('/v1/store')).json();
    assert.deepEqual(first.records.automationRules, [{ id: 'r1' }]);
    assert.equal(typeof first.revision, 'number');

    await call('/v1/store/automationRules', { method: 'PUT', body: { value: [{ id: 'r2' }] } });
    const second = await (await call('/v1/store')).json();
    assert.ok(second.revision > first.revision);
    assert.deepEqual(second.records.automationRules, [{ id: 'r2' }]);
  });

  it('narrows to a scope, so a team can be separated from a user', async () => {
    await call('/v1/store/projects?scope=team-1', { method: 'PUT', body: { value: ['team'] } });

    const scoped = await (await call('/v1/store/projects?scope=team-1')).json();
    assert.deepEqual(scoped.value, ['team']);

    // the default scope still holds what it held before
    const def = await (await call('/v1/store/projects')).json();
    assert.deepEqual(def.value, ['acme']);
  });
});

describe('the shape of a mistake', () => {
  it('answers an unknown path, and a method it does not serve', async () => {
    assert.equal((await call('/v1/nope')).status, 404);
    assert.equal((await call('/v1/store', { method: 'POST' })).status, 405);
    assert.equal((await call('/v1/store/projects', { method: 'PATCH' })).status, 405);
  });
});
