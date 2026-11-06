// A bucket in a Map, behind a `fetch` that understands the four S3 calls.
//
// Shared by the S3 client's own tests and the storage-migration tests (#158), so
// both drive the same stand-in: the client signs a real request, the bucket
// answers it, and nothing reaches the network.
//
// `truncate` is the failure this whole design exists for: a write that reports
// success while storing fewer bytes than it was given.
import { client } from '../s3.js';

export const BUCKET_BASE = 'https://account.r2.cloudflarestorage.com/bucket';

export function fakeBucket({ truncate = false, pageSize = 1000 } = {}) {
  const objects = new Map();
  const calls = [];
  const fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ method, url });
    const parsed = new URL(url);
    if (method === 'GET' && parsed.searchParams.get('list-type') === '2') {
      const prefix = parsed.searchParams.get('prefix') ?? '';
      // S3 answers at most 1000 keys a page and hands back a continuation token
      // for the rest. The stand-in does the same, so a client that stops at the
      // first page fails here rather than in production.
      const start = Number(parsed.searchParams.get('continuation-token') ?? '0') || 0;
      const matching = [...objects.entries()].filter(([key]) => key.startsWith(prefix));
      const page = matching.slice(start, start + pageSize);
      const next = start + page.length;
      const truncated = next < matching.length;
      const contents = page
        .map(([key, value]) => `<Contents><Key>${key}</Key><Size>${value.length}</Size></Contents>`)
        .join('');
      const tail = truncated
        ? `<IsTruncated>true</IsTruncated><NextContinuationToken>${next}</NextContinuationToken>`
        : '<IsTruncated>false</IsTruncated>';
      return {
        ok: true,
        status: 200,
        text: async () => `<ListBucketResult>${contents}${tail}</ListBucketResult>`,
      };
    }
    const key = decodeURIComponent(new URL(url).pathname.replace(/^\/[^/]+\//, ''));
    if (method === 'PUT') {
      const body = String(init.body ?? '');
      // A backend whose write silently loses the last byte still says 200.
      objects.set(key, truncate ? body.slice(0, -1) : body);
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

/** An `s3.js` client over a fake bucket. */
export const s3For = (bucket) => client({
  base: BUCKET_BASE,
  accessKeyId: 'AKIAEXAMPLE',
  secretKey: 'secret',
  fetch: bucket.fetch,
});
