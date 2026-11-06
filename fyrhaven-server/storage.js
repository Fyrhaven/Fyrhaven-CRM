// Where a workspace's bytes live (#158).
//
// One seam, two backends with the SAME four calls — `list`, `get`, `put`,
// `remove` — plus `scopes` (a migration must move every scope, not only the
// default one). Everything a backend sees is the **sealed** text, so the
// envelope moves and the encryption does not: a leaked bucket is opaque without
// `STORE_MASTER_KEY`, exactly as a stolen SQLite file is.
//
// Two rules are encoded here rather than in a route handler, because a route is
// the wrong place for a rule that must never be skipped:
//
//   * a migration copies, READS BACK AND COMPARES the sha256, flips the provider
//     row, and only then deletes the source. A copy that was silently truncated
//     aborts the whole move and leaves the originals where they were.
//   * a workspace whose provider has no configured backend raises
//     `unavailable`, so the store can say "this needs a server" instead of
//     serving an empty address book that looks like data loss.
import { createHash } from 'node:crypto';

/** The providers the seam knows how to speak. `sqlite` is always available. */
export const PROVIDERS = ['sqlite', 's3'];

/** `sha256` of an object's text — how a copy is compared with its original. */
export const digestOf = (text) => createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');

/** The object key for one record: `<workspace>/<scope>/<key>.json`. */
export const objectKey = (workspace, scope, key) => `${workspace}/${scope}/${key}.json`;

/** The reason a workspace cannot be reached at all, as opposed to being empty. */
function unavailable(workspace, provider) {
  return Object.assign(
    new Error(`workspace ${workspace} lives on ${provider}, which is not configured`),
    { unavailable: true, provider, workspace },
  );
}

/**
 * The SQLite backend: one row per record, `value` is the sealed text.
 *
 * This is what every install used before the seam existed, and it stays the
 * default — a store with no bucket behaves exactly as it did.
 */
export function sqliteBackend(db) {
  return {
    provider: 'sqlite',
    async list(workspace, scope) {
      const rows = db
        .prepare('SELECT key, value FROM records WHERE workspace = ? AND scope = ?')
        .all(workspace, scope);
      return new Map(rows.map((row) => [row.key, row.value]));
    },
    async get(workspace, scope, key) {
      const row = db
        .prepare('SELECT value FROM records WHERE workspace = ? AND scope = ? AND key = ?')
        .get(workspace, scope, key);
      return row ? row.value : null;
    },
    async put(workspace, scope, key, sealed) {
      db.prepare(`
        INSERT INTO records (workspace, scope, key, value, updated) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (workspace, scope, key)
        DO UPDATE SET value = excluded.value, updated = excluded.updated
      `).run(workspace, scope, key, sealed, new Date().toISOString());
      return true;
    },
    async remove(workspace, scope, key) {
      const info = db
        .prepare('DELETE FROM records WHERE workspace = ? AND scope = ? AND key = ?')
        .run(workspace, scope, key);
      return info.changes > 0;
    },
    async scopes(workspace) {
      return db
        .prepare('SELECT DISTINCT scope FROM records WHERE workspace = ?')
        .all(workspace).map((row) => row.scope);
    },
    /** Counted from the rows themselves, so it cannot drift from what is stored. */
    async usage(workspace) {
      const row = db
        .prepare('SELECT COUNT(*) AS records, COALESCE(SUM(LENGTH(value)), 0) AS bytes FROM records WHERE workspace = ?')
        .get(workspace);
      return { records: Number(row.records ?? 0), bytes: Number(row.bytes ?? 0) };
    },
  };
}

/**
 * The S3 backend: `<workspace>/<scope>/<key>.json`, the sealed text as the body.
 *
 * `client` is `s3.js` — the same four calls, already verified against a live R2
 * bucket. It answers `null` for a missing object, never an empty string, so
 * "not there" and "written empty" stay different answers.
 */
export function s3Backend(client) {
  return {
    provider: 's3',
    async list(workspace, scope) {
      const prefix = `${workspace}/${scope}/`;
      const entries = (await client.list(prefix))
        .filter((entry) => entry.key.startsWith(prefix) && entry.key.endsWith('.json'));
      const objects = new Map();
      // A workspace can hold hundreds of records and the plugin reads them all in
      // one call, so fetch in small batches rather than one round trip per object
      // — bounded, so a large workspace cannot open a thousand sockets at once.
      const batch = 8;
      for (let index = 0; index < entries.length; index += batch) {
        const slice = entries.slice(index, index + batch);
        const texts = await Promise.all(slice.map((entry) => client.get(entry.key)));
        slice.forEach((entry, offset) => {
          const text = texts[offset];
          if (text !== null) objects.set(entry.key.slice(prefix.length, -'.json'.length), text);
        });
      }
      return objects;
    },
    async get(workspace, scope, key) {
      return client.get(objectKey(workspace, scope, key));
    },
    async put(workspace, scope, key, sealed) {
      await client.put(objectKey(workspace, scope, key), sealed);
      return true;
    },
    async remove(workspace, scope, key) {
      await client.remove(objectKey(workspace, scope, key));
      return true;
    },
    async scopes(workspace) {
      const head = `${workspace}/`;
      const found = new Set();
      for (const entry of await client.list(head)) {
        if (!entry.key.startsWith(head)) continue;
        // Everything between the workspace and the final segment is the scope, so
        // a scope that itself contains a slash survives the round trip.
        const rest = entry.key.slice(head.length);
        const cut = rest.lastIndexOf('/');
        if (cut > 0) found.add(rest.slice(0, cut));
      }
      return [...found];
    },
    /**
     * A listing, not a cached counter: the panel and the quota must never be told
     * a workspace holds nothing while its objects sit in the bucket.
     */
    async usage(workspace) {
      const listed = await client.list(`${workspace}/`);
      return {
        records: listed.length,
        bytes: listed.reduce((sum, entry) => sum + (Number(entry.size) || 0), 0),
      };
    },
  };
}

/** The backends this process can actually reach — `s3` only when it is configured. */
export function backendsFor(db, { s3 = null } = {}) {
  const adapters = { sqlite: sqliteBackend(db) };
  if (s3) adapters.s3 = s3Backend(s3);
  return adapters;
}

/** The provider a workspace is recorded as using. `sqlite` is the default. */
export function providerOf(db, workspace) {
  const row = db.prepare('SELECT provider FROM workspace_storage WHERE workspace = ?').get(workspace);
  return row?.provider ?? 'sqlite';
}

/**
 * The backend for one workspace. A provider this process cannot reach is an
 * error, never a fall back: reading a different store would show the customer an
 * empty address book and invite them to "restore" it over their own data.
 */
export function backendFor(db, workspace, adapters, provider = providerOf(db, workspace)) {
  const backend = adapters[provider];
  if (!backend) throw unavailable(workspace, provider);
  return backend;
}


/** The whole provider row for a workspace, with the defaults an absent row implies. */
export function storageRow(db, workspace) {
  const row = db.prepare('SELECT provider, revision, objects, bytes FROM workspace_storage WHERE workspace = ?').get(workspace);
  return {
    provider: row?.provider ?? 'sqlite',
    revision: Number(row?.revision ?? 0),
    objects: Number(row?.objects ?? 0),
    bytes: Number(row?.bytes ?? 0),
  };
}

/**
 * Writes the provider row. `revision` is seeded with the global counter on the
 * way in, so a client that last saw revision 42 never sees the number go
 * backwards when its workspace changes house.
 */
export function setProvider(db, workspace, provider, { revision = 0, objects = 0, bytes = 0, now = () => Date.now() } = {}) {
  db.prepare(`
    INSERT INTO workspace_storage (workspace, provider, updated, revision, objects, bytes)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace) DO UPDATE SET
      provider = excluded.provider, updated = excluded.updated,
      revision = excluded.revision, objects = excluded.objects, bytes = excluded.bytes
  `).run(workspace, provider, new Date(now()).toISOString(), revision, objects, bytes);
}

/** A blob-backed workspace's own write counter; `null` for a SQLite workspace. */
export function bumpWorkspaceRevision(db, workspace, { now = () => Date.now(), provider = '' } = {}) {
  const name = provider || providerOf(db, workspace);
  if (name === 'sqlite') return null;
  db.prepare('UPDATE workspace_storage SET revision = revision + 1, updated = ? WHERE workspace = ?')
    .run(new Date(now()).toISOString(), workspace);
  return storageRow(db, workspace).revision;
}

/**
 * Keeps the row's object and byte counters in step with the bucket. Only used for
 * a blob-backed workspace: a SQLite workspace's usage is counted from its rows.
 */
export function noteUsage(db, workspace, { records = 0, bytes = 0, now = () => Date.now(), provider = '' } = {}) {
  if (!records && !bytes) return;
  const name = provider || providerOf(db, workspace);
  if (name === 'sqlite') return;
  db.prepare(`
    UPDATE workspace_storage
    SET objects = MAX(0, objects + ?), bytes = MAX(0, bytes + ?), updated = ?
    WHERE workspace = ?
  `).run(records, bytes, new Date(now()).toISOString(), workspace);
}

/**
 * Adds the columns the seam needs to an existing `workspace_storage` table.
 *
 * `CREATE TABLE IF NOT EXISTS` is a no-op on a table that already exists, so a
 * deployed store would otherwise never gain `revision`/`objects`/`bytes` and the
 * first migration would fail in production only. Each column is added only when
 * it is missing, so this is safe to run on every start.
 */
export function openStorageTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_storage (
      workspace TEXT PRIMARY KEY,
      provider  TEXT NOT NULL,
      updated   TEXT NOT NULL,
      revision  INTEGER NOT NULL DEFAULT 0,
      objects   INTEGER NOT NULL DEFAULT 0,
      bytes     INTEGER NOT NULL DEFAULT 0
    );
  `);
  const columns = new Set(db.prepare('PRAGMA table_info(workspace_storage)').all().map((row) => row.name));
  for (const [name, sql] of [
    ['revision', 'INTEGER NOT NULL DEFAULT 0'],
    ['objects', 'INTEGER NOT NULL DEFAULT 0'],
    ['bytes', 'INTEGER NOT NULL DEFAULT 0'],
  ]) {
    if (!columns.has(name)) db.exec(`ALTER TABLE workspace_storage ADD COLUMN ${name} ${sql}`);
  }
  return db;
}


/**
 * Moves one workspace from one backend to another — the only order that does not
 * lose data:
 *
 *   1. read every record of every scope from the source
 *   2. write each to the target, then READ IT BACK and compare the sha256 of the
 *      sealed text. Any mismatch → remove what this run wrote, change nothing
 *   3. only when every object round-trips: `flip()` (the provider row)
 *   4. only then: remove the source copies
 *
 * A failure at step 2 or 3 leaves the workspace exactly as it was. That is the
 * whole point of doing the read-back before the flip.
 */
export async function migrateWorkspace({ from, to, workspace, flip = async () => {}, now = () => Date.now() } = {}) {
  const originals = [];
  for (const scope of await from.scopes(workspace)) {
    for (const [key, sealed] of await from.list(workspace, scope)) originals.push({ scope, key, sealed });
  }
  const bytes = originals.reduce((sum, record) => sum + Buffer.byteLength(record.sealed), 0);
  const summary = { objects: originals.length, bytes };

  const written = [];
  const discard = async () => {
    for (const record of written) {
      try {
        await to.remove(workspace, record.scope, record.key);
      } catch {
        // A target that will not clean up is still a target nothing was flipped on.
      }
    }
  };

  try {
    for (const record of originals) {
      await to.put(workspace, record.scope, record.key, record.sealed);
      written.push(record);
      const back = await to.get(workspace, record.scope, record.key);
      if (back === null) {
        await discard();
        return { ok: false, ...summary, copied: 0, reason: `${record.scope}/${record.key} did not read back after it was written` };
      }
      if (digestOf(back) !== digestOf(record.sealed)) {
        await discard();
        return { ok: false, ...summary, copied: 0, reason: `${record.scope}/${record.key} read back different bytes` };
      }
    }
  } catch (err) {
    await discard();
    return { ok: false, ...summary, copied: 0, reason: String(err?.message ?? err) };
  }

  // Every object is on the target and compares equal. Only now may the record of
  // where the workspace lives change.
  try {
    await flip(summary);
  } catch (err) {
    await discard();
    return { ok: false, ...summary, copied: 0, reason: `the provider row could not be written: ${String(err?.message ?? err)}` };
  }

  const leftBehind = [];
  for (const record of originals) {
    try {
      await from.remove(workspace, record.scope, record.key);
    } catch {
      // The data is safe in two places; the panel says which objects stayed.
      leftBehind.push(`${record.scope}/${record.key}`);
    }
  }
  return { ok: true, ...summary, copied: originals.length, leftBehind, at: new Date(now()).toISOString() };
}

