// A tiny S3 client (#158). No SDK — the rest of this service has none.
//
// Only what the record store needs: list, put, get, remove, signed with AWS
// Signature Version 4 (what R2, B2, Wasabi and MinIO all speak). Verified
// against a live R2 bucket: list, a write, a read-back and a delete.
//
// Two details that cost a debugging session each, kept as comments so they are
// not rediscovered the hard way:
//   * `x-amz-date` has NO milliseconds — the signature covers the exact bytes on
//     the wire, and `…T201612.213Z` is not the same string as `…T201612Z`.
//   * the canonical URI is percent-encoded PER SEGMENT: a raw `/a b` and a signed
//     `/a%20b` are different strings, and the server only ever sees the encoded one.
//
// `base` is used exactly as given: a bucket-scoped endpoint such as R2's
// `https://<account>.r2.cloudflarestorage.com/<bucket>` already names the bucket,
// so appending it again would produce a path that does not exist.
import { createHash, createHmac } from 'node:crypto';
const enc = (v) => encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const sha = (d) => createHash('sha256').update(d).digest('hex');
const hmac = (k, d) => createHmac('sha256', k).update(d).digest();
// 20130524T000000Z — no colons, NO milliseconds (the bug that broke the last run)
export const stampOf = (date) => `${date.toISOString().slice(0, 19).replace(/[:-]/g, '')}Z`;

export function signRequest({ method, url, payload = '', accessKeyId, secretKey, region = 'auto', date = new Date() }) {
  const at = stampOf(date);
  const day = at.slice(0, 8);
  const u = new URL(url);
  const path = (u.pathname || '/').split('/').map((s) => enc(decodeURIComponent(s))).join('/');
  const query = [...u.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');
  const headers = { host: u.host, 'x-amz-content-sha256': sha(payload), 'x-amz-date': at };
  const signed = Object.keys(headers).sort();
  const head = signed.map((h) => `${h}:${headers[h]}\n`).join('');
  const canonical = [method.toUpperCase(), path, query, head, signed.join(';'), sha(payload)].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', at, scope, sha(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, day), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${signature}` };
}

export function client({ base, accessKeyId, secretKey, fetch = globalThis.fetch }) {
  // Fail here, at start-up, rather than at 3am with a 403 from a bucket.
  if (!base || !accessKeyId || !secretKey) {
    throw new Error('s3: base, accessKeyId and secretKey are required');
  }
  const root = base.replace(/\/+$/, '');
  const call = async (method, url, payload = '') => fetch(url, {
    method, headers: signRequest({ method, url, payload, accessKeyId, secretKey }), body: payload || undefined,
  });
  return {
    async list(prefix = '') {
      const r = await call('GET', `${root}?list-type=2${prefix ? `&prefix=${enc(prefix)}` : ''}`);
      const t = await r.text();
      if (!r.ok) throw new Error(`list ${r.status}: ${t.slice(0, 160)}`);
      return [...t.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(([, b]) => ({
        key: (b.match(/<Key>([\s\S]*?)<\/Key>/) ?? [])[1] ?? '',
        size: Number((b.match(/<Size>(\d+)<\/Size>/) ?? [])[1] ?? 0),
      }));
    },
    async put(key, text) {
      const r = await call('PUT', `${root}/${key.split('/').map(enc).join('/')}`, text);
      if (!r.ok) throw new Error(`put ${r.status}: ${(await r.text()).slice(0, 160)}`);
      return true;
    },
    async get(key) {
      const r = await call('GET', `${root}/${key.split('/').map(enc).join('/')}`);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`get ${r.status}: ${(await r.text()).slice(0, 160)}`);
      return r.text();
    },
    async remove(key) {
      const r = await call('DELETE', `${root}/${key.split('/').map(enc).join('/')}`);
      if (!r.ok && r.status !== 404) throw new Error(`delete ${r.status}`);
      return true;
    },
  };
}
