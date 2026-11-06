// Moving a workspace to blob storage (#158, step 2).
//
// The migration is the one operation in this service that can lose a customer's
// data, so its safety property is pinned first and directly: a target whose write
// silently truncates must abort the whole move, leave the provider as `sqlite`,
// and leave every original record intact. Everything else here is the happy
// path that has to hold for that property to mean anything.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStoreServer, openStore } from '../server.js';
import { s3Backend } from '../storage.js';
import { fakeBucket, s3For } from './fake-bucket.mjs';

const MASTER = Buffer.alloc(32, 7);

async function listen(options) {
  const own = createStoreServer({ tokenList: 'tok-a=acme', masterKey: MASTER, adminToken: 'adm', ...options });
  await new Promise((resolve) => own.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${own.server.address().port}`;
  const close = async () => {
    own.server.closeAllConnections?.();
    await new Promise((resolve) => own.server.close(resolve));
  };
  return { ...own, base, close };
}

const admin = { authorization: 'Bearer adm', 'content-type': 'application/json' };
const store = (token = 'tok-a') => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

const put = (base, key, value, { scope = '', token = 'tok-a' } = {}) => fetch(
  `${base}/v1/store/${key}${scope ? `?scope=${scope}` : ''}`,
  { method: 'PUT', headers: store(token), body: JSON.stringify({ value }) },
);

const getJson = async (base, path, headers = store()) => (await fetch(`${base}${path}`, { headers })).json();

describe('a workspace moves to the bucket (#158, the migration)', () => {
  it('copies every scope, reads each object back, flips the provider, and only then clears the source', async () => {
    const bucket = fakeBucket();
    const own = await listen({ s3: s3For(bucket) });
    try {
      // Three records in two scopes, because a migration that only moves the
      // default scope would silently drop the team's.
      await put(own.base, 'projects', [{ id: 'p1' }, { id: 'p2' }]);
      await put(own.base, 'contactNotes', [{ id: 'n1' }]);
      await put(own.base, 'savedSearches', [{ id: 's1' }], { scope: 'team' });
      const before = await getJson(own.base, '/v1/store');
      const revisionBefore = before.revision;

      const moved = await fetch(`${own.base}/v1/admin/workspaces/acme/migrate`, {
        method: 'POST', headers: admin, body: JSON.stringify({ provider: 's3' }),
      });
      const body = await moved.json();
      assert.equal(moved.status, 200, JSON.stringify(body));
      assert.equal(body.provider, 's3');
      assert.equal(body.moved, true);
      assert.equal(body.objects, 3);

      // Every object is in the bucket, under <workspace>/<scope>/<key>.json, and
      // the database keeps none of them any more.
      assert.deepEqual([...bucket.objects.keys()].sort(), [
        'acme/default/contactNotes.json',
        'acme/default/projects.json',
        'acme/team/savedSearches.json',
      ]);
      assert.equal(own.db.prepare('SELECT COUNT(*) AS n FROM records WHERE workspace = ?').get('acme').n, 0);

      // …and the values are the same values, in both scopes.
      const after = await getJson(own.base, '/v1/store');
      assert.deepEqual(after.records, before.records);
      const team = await getJson(own.base, '/v1/store?scope=team');
      assert.deepEqual(team.records, { savedSearches: [{ id: 's1' }] });
      // The revision a client holds never goes backwards across a move.
      assert.ok(after.revision >= revisionBefore, `${after.revision} < ${revisionBefore}`);

      const state = await getJson(own.base, '/v1/admin/workspaces/acme/storage', admin);
      assert.equal(state.provider, 's3');
      assert.equal(state.reachable, true);
      assert.equal(state.objects, 3);
      assert.ok(state.bytes > 0);
      assert.deepEqual(state.available.sort(), ['s3', 'sqlite']);
    } finally {
      await own.close();
    }
  });
});

describe('a migration that cannot be trusted changes nothing (#158)', () => {
  it('aborts the whole move when a written object reads back different bytes', async () => {
    // The failure this design exists for: the target accepts the write and stores
    // less than it was given. Nothing may be flipped, and nothing may be deleted.
    const bucket = fakeBucket({ truncate: true });
    const own = await listen({ s3: s3For(bucket) });
    try {
      await put(own.base, 'projects', [{ id: 'p1' }]);
      await put(own.base, 'contactNotes', [{ id: 'n1' }]);
      await put(own.base, 'savedSearches', [{ id: 's1' }]);

      const answer = await fetch(`${own.base}/v1/admin/workspaces/acme/migrate`, {
        method: 'POST', headers: admin, body: JSON.stringify({ provider: 's3' }),
      });
      const failed = await answer.json();
      assert.equal(answer.status, 502, JSON.stringify(failed));
      assert.equal(failed.ok, false);
      assert.match(failed.error, /read back different bytes/);
      assert.equal(failed.provider, 'sqlite');

      // The provider did not flip…
      assert.equal((await getJson(own.base, '/v1/admin/workspaces/acme/storage', admin)).provider, 'sqlite');
      // …the originals are all still there, unchanged…
      const records = (await getJson(own.base, '/v1/store')).records;
      assert.deepEqual(Object.keys(records).sort(), ['contactNotes', 'projects', 'savedSearches']);
      assert.deepEqual(records.projects, [{ id: 'p1' }]);
      assert.equal(own.db.prepare('SELECT COUNT(*) AS n FROM records WHERE workspace = ?').get('acme').n, 3);
      // …and nothing half-written was left behind in the bucket.
      assert.equal(bucket.objects.size, 0, [...bucket.objects.keys()].join(', '));
    } finally {
      await own.close();
    }
  });

  it('refuses a provider it does not have, and does not offer one it cannot reach', async () => {
    const own = await listen();
    try {
      await put(own.base, 'projects', [{ id: 'p1' }]);
      const refused = await fetch(`${own.base}/v1/admin/workspaces/acme/migrate`, {
        method: 'POST', headers: admin, body: JSON.stringify({ provider: 's3' }),
      });
      assert.equal(refused.status, 501);
      const unknown = await fetch(`${own.base}/v1/admin/workspaces/acme/migrate`, {
        method: 'POST', headers: admin, body: JSON.stringify({ provider: 'ftp' }),
      });
      assert.equal(unknown.status, 400);
      assert.match((await unknown.json()).error, /unknown provider/);
    } finally {
      await own.close();
    }
  });
});


describe('a moved workspace is served from the bucket (#158)', () => {
  it('reads, writes and deletes through the bucket once the provider has moved', async () => {
    const bucket = fakeBucket();
    const own = await listen({ s3: s3For(bucket) });
    try {
      await put(own.base, 'projects', [{ id: 'p1' }]);
      await fetch(`${own.base}/v1/admin/workspaces/acme/migrate`, {
        method: 'POST', headers: admin, body: JSON.stringify({ provider: 's3' }),
      });

      // a write lands in the bucket, not back in the database
      await put(own.base, 'contactNotes', [{ id: 'n1' }]);
      assert.equal(bucket.objects.size, 2);
      assert.deepEqual((await getJson(own.base, '/v1/store/contactNotes')).value, [{ id: 'n1' }]);
      assert.equal(own.db.prepare('SELECT COUNT(*) AS n FROM records WHERE workspace = ?').get('acme').n, 0);

      // …and so does a delete
      await fetch(`${own.base}/v1/store/contactNotes`, { method: 'DELETE', headers: store() });
      assert.equal(bucket.objects.size, 1);
      assert.equal((await fetch(`${own.base}/v1/store/contactNotes`, { headers: store() })).status, 404);
      // deleting what is not there is still not an error
      assert.equal((await fetch(`${own.base}/v1/store/contactNotes`, { method: 'DELETE', headers: store() })).status, 200);

      // the panel's count follows the bucket
      const state = await getJson(own.base, '/v1/admin/workspaces/acme/storage', admin);
      assert.equal(state.objects, 1);
      // …and a fresh recount from the bucket agrees with the counter
      const fresh = await getJson(own.base, '/v1/admin/workspaces/acme/storage?fresh=1', admin);
      assert.equal(fresh.objects, 1);
      assert.equal(fresh.bytes, state.bytes);
      const usage = await getJson(own.base, '/v1/admin/usage', admin);
      assert.equal(usage.customers.find((entry) => entry.workspace === 'acme').provider, 's3');
    } finally {
      await own.close();
    }
  });

  it('says a workspace on storage it cannot reach is unreachable, instead of showing it empty', async () => {
    // A row saying `s3` with no bucket configured is an operator error, and the
    // worst possible answer is 200 with no records: that looks like an empty
    // address book and invites the user to "restore" over their own data.
    const own = await listen();
    try {
      await put(own.base, 'projects', [{ id: 'p1' }]);
      own.db.prepare(`
        INSERT INTO workspace_storage (workspace, provider, updated, revision, objects, bytes)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('acme', 's3', new Date().toISOString(), 1, 1, 10);

      const answer = await fetch(`${own.base}/v1/store`, { headers: store() });
      assert.equal(answer.status, 503);
      const body = await answer.json();
      assert.equal(body.provider, 's3');
      assert.match(body.error, /not configured/);

      const state = await getJson(own.base, '/v1/admin/workspaces/acme/storage', admin);
      assert.equal(state.provider, 's3');
      assert.equal(state.reachable, false);
      assert.deepEqual(state.available, ['sqlite']);
    } finally {
      await own.close();
    }
  });

  it('erases a moved workspace from the bucket as well as the database', async () => {
    // "The key is gone, so the bytes are unreadable" is true, and it is not the
    // same thing as having deleted them. An erasure has to remove the objects.
    const bucket = fakeBucket();
    const own = await listen({ s3: s3For(bucket) });
    try {
      const signup = await (await fetch(`${own.base}/v1/accounts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'owner@example.com', password: 'a-long-password' }),
      })).json();
      assert.ok(signup.token, JSON.stringify(signup));
      const workspace = `acct:${signup.account.id}`;
      await put(own.base, 'projects', [{ id: 'p1' }], { token: signup.token });

      const moved = await fetch(`${own.base}/v1/admin/workspaces/${encodeURIComponent(workspace)}/migrate`, {
        method: 'POST', headers: admin, body: JSON.stringify({ provider: 's3' }),
      });
      assert.equal(moved.status, 200, await moved.text());
      assert.equal(bucket.objects.size, 1);

      const erased = await (await fetch(`${own.base}/v1/account`, {
        method: 'DELETE', headers: store(signup.token),
      })).json();
      assert.equal(erased.deleted, true);
      assert.equal(erased.objectsRemoved, 1);
      assert.equal(bucket.objects.size, 0, [...bucket.objects.keys()].join(', '));
      assert.equal(own.db.prepare('SELECT COUNT(*) AS n FROM workspace_storage WHERE workspace = ?').get(workspace).n, 0);
    } finally {
      await own.close();
    }
  });

  it('finishes deleting an account when the bucket refuses, and says what to clean up', async () => {
    // An erasure that stops halfway because a bucket said 500 would leave the
    // account gone but the workspace row and the objects behind.
    const bucket = fakeBucket({ failDelete: true });
    const own = await listen({ s3: s3For(bucket) });
    try {
      const signup = await (await fetch(`${own.base}/v1/accounts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'stuck@example.com', password: 'a-long-password' }),
      })).json();
      const workspace = `acct:${signup.account.id}`;
      await put(own.base, 'projects', [{ id: 'p1' }], { token: signup.token });
      await fetch(`${own.base}/v1/admin/workspaces/${encodeURIComponent(workspace)}/migrate`, {
        method: 'POST', headers: admin, body: JSON.stringify({ provider: 's3' }),
      });
      assert.equal(bucket.objects.size, 1);

      const answer = await fetch(`${own.base}/v1/account`, { method: 'DELETE', headers: store(signup.token) });
      assert.equal(answer.status, 200, await answer.clone().text());
      const erased = await answer.json();
      assert.equal(erased.deleted, true);
      assert.equal(erased.storageUnreachable, true);
      // The account is gone even though the bucket still holds the object.
      assert.equal(own.db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE id = ?').get(signup.account.id).n, 0);
      assert.equal(own.db.prepare('SELECT COUNT(*) AS n FROM workspace_storage WHERE workspace = ?').get(workspace).n, 0);
      assert.equal(bucket.objects.size, 1, 'the residue is reported, not hidden');
    } finally {
      await own.close();
    }
  });

  it('counts the projects a workspace holds in the panel, which the sealed column could not', async () => {
    const own = await listen();
    try {
      await put(own.base, 'projects', [{ id: 'p1' }, { id: 'p2' }]);
      const usage = await getJson(own.base, '/v1/admin/usage', admin);
      const row = usage.customers.find((entry) => entry.workspace === 'acme');
      assert.equal(row.projects, 2);
      assert.equal(row.provider, 'sqlite');
      assert.deepEqual(usage.providers, ['sqlite']);
    } finally {
      await own.close();
    }
  });
});

describe('a deployed store gains the new columns in place (#158)', () => {
  it('adds revision, objects and bytes to a workspace_storage table that predates them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fyrhaven-storage-'));
    const file = join(dir, 'store.sqlite');
    try {
      const first = openStore(file);
      // The shape every deployed store has today.
      first.exec('DROP TABLE workspace_storage');
      first.exec(`
        CREATE TABLE workspace_storage (
          workspace TEXT PRIMARY KEY, provider TEXT NOT NULL, updated TEXT NOT NULL
        );
      `);
      first.prepare('INSERT INTO workspace_storage (workspace, provider, updated) VALUES (?, ?, ?)')
        .run('acme', 'sqlite', '2026-01-01T00:00:00.000Z');
      first.close();

      const second = openStore(file);
      try {
        const columns = second.prepare('PRAGMA table_info(workspace_storage)').all().map((row) => row.name);
        for (const name of ['revision', 'objects', 'bytes']) assert.ok(columns.includes(name), `${name} missing`);
        const row = second.prepare('SELECT provider, revision, objects, bytes FROM workspace_storage WHERE workspace = ?').get('acme');
        assert.deepEqual({ ...row }, { provider: 'sqlite', revision: 0, objects: 0, bytes: 0 });
      } finally {
        second.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});


describe('the bucket backend (#158)', () => {
  it('reads every object under a scope, across list pages and in batches', async () => {
    const bucket = fakeBucket({ pageSize: 7 });
    const backend = s3Backend(s3For(bucket));
    const sealed = [];
    for (let index = 0; index < 20; index += 1) {
      const text = `sealed-${index}`;
      sealed.push(text);
      await backend.put('acme', 'default', `k${index}`, text);
    }

    // 20 objects behind a 7-key page, read back in batches of 8: all of them.
    const objects = await backend.list('acme', 'default');
    assert.equal(objects.size, 20);
    assert.equal(objects.get('k13'), 'sealed-13');

    // a missing object is null, never an empty string
    assert.equal(await backend.get('acme', 'default', 'nope'), null);
    assert.equal(await backend.get('acme', 'other', 'k1'), null);

    assert.deepEqual(await backend.scopes('acme'), ['default']);
    const used = await backend.usage('acme');
    assert.equal(used.records, 20);
    assert.equal(used.bytes, sealed.join('').length);
  });
});

