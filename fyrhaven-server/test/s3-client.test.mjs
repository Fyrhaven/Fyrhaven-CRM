// The S3 client's behaviour (#158), against a fake bucket — no network, no keys.
//
// This is the code that will carry every customer's bytes, so its contract is
// pinned before the storage adapter is allowed to use it: a write is readable
// back, a missing object is null rather than a throw, and a failed request is an
// error rather than a silent empty read.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fakeBucket, s3For } from './fake-bucket.mjs';
import { client } from '../s3.js';

const built = s3For;

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

test('a listing follows the continuation token, so nothing past the first page is missed', async () => {
  // S3 answers 1000 keys at a time. A client that stops there would leave every
  // record past the first page behind in a migration — and then hide them.
  const bucket = fakeBucket({ pageSize: 2 });
  const s3 = built(bucket);
  for (const name of ['a', 'b', 'c', 'd', 'e']) await s3.put(`acct:one/default/${name}.json`, name);

  const mine = await s3.list('acct:one/');
  assert.deepEqual(mine.map((entry) => entry.key).sort(), [
    'acct:one/default/a.json',
    'acct:one/default/b.json',
    'acct:one/default/c.json',
    'acct:one/default/d.json',
    'acct:one/default/e.json',
  ]);

  // three pages, and each one carried its token rather than starting over
  const listings = bucket.calls.filter((entry) => entry.url.includes('list-type=2'));
  assert.equal(listings.length, 3);
  assert.equal(new URL(listings[0].url).searchParams.get('continuation-token'), null);
  assert.equal(new URL(listings[1].url).searchParams.get('continuation-token'), '2');
  assert.equal(new URL(listings[2].url).searchParams.get('continuation-token'), '4');
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
