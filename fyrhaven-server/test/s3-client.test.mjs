// The S3 client's behaviour (#158), against a fake bucket — no network, no keys.
//
// This is the code that will carry every customer's bytes, so its contract is
// pinned before the storage adapter is allowed to use it: a write is readable
// back, a missing object is null rather than a throw, and a failed request is an
// error rather than a silent empty read.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { client } = await import('../s3.js');

/** A bucket in a Map, behind a `fetch` that understands the four calls. */
function fakeBucket() {
  const objects = new Map();
  const calls = [];
  const fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ method, url });
    const parsed = new URL(url);
    if (method === 'GET' && parsed.searchParams.get('list-type') === '2') {
      const prefix = parsed.searchParams.get('prefix') ?? '';
      const contents = [...objects.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => `<Contents><Key>${key}</Key><Size>${value.length}</Size></Contents>`)
        .join('');
      return { ok: true, status: 200, text: async () => `<ListBucketResult>${contents}</ListBucketResult>` };
    }
    const key = decodeURIComponent(parsed.pathname.replace(/^\/[^/]+\//, ''));
    if (method === 'PUT') {
      objects.set(key, String(init.body));
      return { ok: true, status: 200, headers: new Map(), text: async () => '' };
    }
    if (method === 'DELETE') {
      objects.delete(key);
      return { ok: true, status: 204, text: async () => '' };
    }
    if (!objects.has(key)) return { ok: false, status: 404, text: async () => 'NoSuchKey' };
    return { ok: true, status: 200, text: async () => objects.get(key) };
  };
  return { fetch, objects, calls };
}

const built = (bucket) => client({
  base: 'https://account.r2.cloudflarestorage.com/bucket',
  accessKeyId: 'AKIAEXAMPLE',
  secretKey: 'secret',
  fetch: bucket.fetch,
});

test('a write is readable back, byte for byte', async () => {
  const bucket = fakeBucket();
  const s3 = built(bucket);

  await s3.put('acct:abc/default/projects.json', '{"sealed":"value"}');
  assert.equal(await s3.get('acct:abc/default/projects.json'), '{"sealed":"value"}');
  // it went through the signed path, not around it
  assert.match(bucket.calls[0].url, /\/bucket\/acct%3Aabc\/default\/projects\.json$/);
});

test('a missing object reads as null, not as a failure', async () => {
  const s3 = built(fakeBucket());
  assert.equal(await s3.get('never/written.json'), null);
});

test('a removal is idempotent — deleting what is not there is fine', async () => {
  const bucket = fakeBucket();
  const s3 = built(bucket);
  await s3.put('a.json', 'x');
  await s3.remove('a.json');
  assert.equal(bucket.objects.size, 0);
  await s3.remove('a.json'); // no throw
});

test('the listing carries every key under a prefix, with its size', async () => {
  const bucket = fakeBucket();
  const s3 = built(bucket);
  await s3.put('acct:one/default/projects.json', '12345');
  await s3.put('acct:one/default/notes.json', '123');
  await s3.put('acct:two/default/projects.json', '1');

  const mine = await s3.list('acct:one/');
  assert.deepEqual(mine.map((entry) => entry.key).sort(), [
    'acct:one/default/notes.json', 'acct:one/default/projects.json',
  ]);
  assert.equal(mine.find((entry) => entry.key.endsWith('projects.json')).size, 5);
});

test('a refused request is an error, not an empty answer', async () => {
  const refusing = async () => ({ ok: false, status: 403, text: async () => 'AccessDenied' });
  const s3 = client({
    base: 'https://account.r2.cloudflarestorage.com/bucket',
    accessKeyId: 'AKIAEXAMPLE', secretKey: 'secret', fetch: refusing,
  });
  await assert.rejects(() => s3.get('a.json'), /403/);
  await assert.rejects(() => s3.put('a.json', 'x'), /403/);
  await assert.rejects(() => s3.list(''), /403/);
});
