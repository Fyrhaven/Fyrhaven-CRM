// The cloud store's own tests: `node --test`, no dependencies, no fixtures. The
// real HTTP path is exercised on an ephemeral port, so the routing, the auth and
// the JSON shapes are all covered the way the plugin will hit them.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_VALUE_BYTES, createStoreServer, open, parseMasterKey, parseTokens, seal,
} from './server.js';

/** A fixed master key, so a test can also try the wrong one. */
const MASTER = Buffer.alloc(32, 7);
const OTHER_MASTER = Buffer.alloc(32, 9);

let server;
let base;

before(async () => {
  ({ server } = createStoreServer({ tokenList: 'tok-a=acme,tok-b=other', masterKey: MASTER }));
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

  it('refuses a token in the URL unless it was explicitly allowed', async () => {
    // A token in a URL lands in access logs, proxy logs and Referer headers.
    assert.equal((await call('/v1/store?token=tok-a', { token: '' })).status, 401);

    const { server: lax, } = createStoreServer({
      tokenList: 'tok-a=acme', masterKey: MASTER, allowQueryToken: true,
    });
    await new Promise((resolve) => lax.listen(0, '127.0.0.1', resolve));
    try {
      const url = `http://127.0.0.1:${lax.address().port}/v1/store?token=tok-a`;
      assert.equal((await fetch(url)).status, 200);
    } finally {
      lax.closeAllConnections?.();
      await new Promise((resolve) => lax.close(resolve));
    }
  });

  it('sends the headers that keep a token out of caches and referrers', async () => {
    const response = await call('/version', { token: '' });
    assert.match(response.headers.get('strict-transport-security'), /max-age=\d+/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('cache-control'), 'no-store');
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

describe('encryption at rest', () => {
  /** A server on a real file, so the bytes on disk can be inspected. */
  async function onFile(dbPath, { masterKey = MASTER, tokenList = 'tok=acme' } = {}) {
    const { server: own } = createStoreServer({ dbPath, tokenList, masterKey });
    await new Promise((resolve) => own.listen(0, '127.0.0.1', resolve));
    return {
      url: `http://127.0.0.1:${own.address().port}`,
      stop: async () => {
        own.closeAllConnections?.();
        await new Promise((resolve) => own.close(resolve));
      },
    };
  }

  const put = (url, key, value) => fetch(`${url}/v1/store/${key}`, {
    method: 'PUT',
    headers: { authorization: 'Bearer tok' },
    body: JSON.stringify({ value }),
  });

  const dirs = [];
  const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'contact-manager-store-'));
    dirs.push(dir);
    return dir;
  };
  after(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it('seals and opens, and refuses the wrong key or a tampered blob', () => {
    const sealed = seal(MASTER, 'hello');
    assert.equal(open(MASTER, sealed), 'hello');
    assert.throws(() => open(OTHER_MASTER, sealed));
    assert.throws(() => open(MASTER, 'not-a-sealed-value'));
    // Tamper with a real byte of the ciphertext. (Appending a character would
    // not do: base64 decoding ignores what it cannot use.)
    const parts = sealed.split('.');
    const flipped = `${parts[3].slice(0, -1)}${parts[3].endsWith('A') ? 'B' : 'A'}`;
    assert.throws(() => open(MASTER, [...parts.slice(0, 3), flipped].join('.')));
    assert.throws(() => open(MASTER, [parts[0], parts[1], parts[2], 'AAAA'].join('.')));
    // a fresh IV every time, so two equal values do not look equal on disk
    assert.notEqual(seal(MASTER, 'same'), seal(MASTER, 'same'));
  });

  it('accepts a master key only when it is 32 bytes of base64', () => {
    assert.equal(parseMasterKey(Buffer.alloc(32, 1).toString('base64')).length, 32);
    assert.equal(parseMasterKey(''), null);
    assert.equal(parseMasterKey(undefined), null);
    assert.equal(parseMasterKey(Buffer.alloc(16, 1).toString('base64')), null);
  });

  it('leaves no plain text anywhere in the database', async () => {
    const dbPath = join(tempDir(), 'store.sqlite');
    const { url, stop } = await onFile(dbPath);
    try {
      await put(url, 'projects', [{ note: 'PLAINTEXT-MARKER-1' }]);
    } finally {
      await stop();
    }

    // WAL mode means the row may still be in the sidecar, so check both.
    for (const file of [dbPath, `${dbPath}-wal`]) {
      let bytes;
      try {
        bytes = readFileSync(file);
      } catch {
        continue; // no sidecar once the connection closed cleanly
      }
      // The value must not be readable. The key NAME is metadata and stays
      // visible on purpose — that boundary is documented in the README.
      assert.equal(bytes.includes('PLAINTEXT-MARKER-1'), false, `${file} holds plain text`);
    }

    // …and the value is genuinely there for the holder of the key
    const again = await onFile(dbPath);
    try {
      const body = await (await fetch(`${again.url}/v1/store/projects`, {
        headers: { authorization: 'Bearer tok' },
      })).json();
      assert.deepEqual(body.value, [{ note: 'PLAINTEXT-MARKER-1' }]);
    } finally {
      await again.stop();
    }
  });

  it('cannot be read with a different master key', async () => {
    const dbPath = join(tempDir(), 'store.sqlite');
    const first = await onFile(dbPath);
    await put(first.url, 'projects', [{ secret: true }]);
    await first.stop();

    const wrong = await onFile(dbPath, { masterKey: OTHER_MASTER });
    try {
      const response = await fetch(`${wrong.url}/v1/store/projects`, {
        headers: { authorization: 'Bearer tok' },
      });
      // It fails loudly rather than serving a hole in the data.
      assert.equal(response.status, 500);
    } finally {
      await wrong.stop();
    }
  });

  it('gives every workspace its own key', async () => {
    const dbPath = join(tempDir(), 'store.sqlite');
    const { url, stop } = await onFile(dbPath, { tokenList: 'tok-a=acme,tok-b=other' });
    try {
      await put(url, 'projects', [{ who: 'acme' }]);
      const other = await fetch(`${url}/v1/store/projects`, {
        headers: { authorization: 'Bearer tok-b' },
      });
      assert.equal(other.status, 404);
    } finally {
      await stop();
    }
  });
});

describe('the shape of a mistake', () => {
  it('answers an unknown path, and a method it does not serve', async () => {
    assert.equal((await call('/v1/nope')).status, 404);
    assert.equal((await call('/v1/store', { method: 'POST' })).status, 405);
    assert.equal((await call('/v1/store/projects', { method: 'PATCH' })).status, 405);
  });
});
