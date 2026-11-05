// The S3 signer (#158): the two things that were wrong, pinned.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { stampOf, signRequest, client } = await import('../s3.js');

test('the signed date has no milliseconds', () => {
  // The bug that made every request fail with SignatureDoesNotMatch: the
  // signature covered 20261105T201612.213Z while the wire carried 20261105T201612Z.
  assert.equal(stampOf(new Date('2026-11-05T20:16:12.213Z')), '20261105T201612Z');
  assert.equal(stampOf(new Date('2013-05-24T00:00:00.000Z')), '20130524T000000Z');
});

test('a signature is deterministic, and covers the body it was given', () => {
  const args = {
    method: 'PUT',
    url: 'https://account.r2.cloudflarestorage.com/bucket/probe/a%20b.txt',
    payload: 'hello',
    accessKeyId: 'AKIAEXAMPLE',
    secretKey: 'secret',
    date: new Date('2026-11-05T20:16:12.000Z'),
  };
  const first = signRequest(args);
  assert.equal(first.authorization, signRequest(args).authorization);
  assert.match(first.authorization, /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/20261105\/auto\/s3\/aws4_request/);
  assert.match(first.authorization, /SignedHeaders=host;x-amz-content-sha256;x-amz-date/);
  assert.notEqual(signRequest({ ...args, payload: 'hello!' }).authorization, first.authorization);
});

test('a client refuses to be built without credentials', () => {
  assert.throws(() => client({ base: 'https://x' }), /required/);
});
