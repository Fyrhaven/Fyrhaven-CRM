// The Contact Manager cloud store (#68).
//
// A record this plugin invents — a project, a private note, a consent record,
// the change history, a saved search — cannot live in a browser, and the
// Stalwart host has nowhere to put it. So it lives here: one small service in
// front of a SQLite file, speaking the four calls `src/lib/remote.js` makes.
//
//   GET    /v1/store        -> { records: { key: value, … }, revision }
//   GET    /v1/store/{key}  -> { key, value, revision } | 404
//   PUT    /v1/store/{key}  <- { value } -> { revision }
//   DELETE /v1/store/{key}  -> { ok: true }
//
// Plus `GET /version` (what the plugin's *Check the server* asks for) and
// `GET /health` (the container's healthcheck).
//
// **No dependencies on purpose.** `node:http` and `node:sqlite` are enough, so
// the image is `node:24-alpine` plus this file — there is no lockfile to audit
// and nothing to install at build time.
//
// Tenancy: a **token is a workspace**. A token can only ever reach its own
// records, so a leaked token is one tenant's problem and never a cross-tenant
// read. The optional `scope` narrows within a workspace, which is the seam the
// team features (#23/#24) will widen; it is not a security boundary.

import { createServer as createHttpServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export const VERSION = '1.0.0';

/** The largest single record, in bytes. A project with time entries fits easily. */
export const MAX_VALUE_BYTES = 1024 * 1024;

/** The scope a request lands in when it names none. */
export const DEFAULT_SCOPE = 'default';

/** Storage keys are slugs: no slashes, no traversal, no surprises in a path. */
const KEY_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * The `token=workspace,…` list as a Map. A token written on its own is its own
 * workspace, so the single-tenant case is `STORE_TOKENS=<random string>`.
 */
export function parseTokens(value) {
  const tokens = new Map();
  for (const part of String(value ?? '').split(',')) {
    const entry = part.trim();
    if (!entry) continue;
    const [token, workspace] = entry.split('=');
    const name = String(token ?? '').trim();
    if (!name) continue;
    tokens.set(name, String(workspace ?? '').trim() || name);
  }
  return tokens;
}

/** The token a request carries: the bearer header, or `?token=` for a host that cannot set one. */
function tokenOf(req, url) {
  const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers?.authorization ?? '').trim());
  if (bearer) return bearer[1].trim();
  return String(url.searchParams.get('token') ?? '').trim();
}

/** Opens (and migrates) the SQLite file. `:memory:` is for the tests. */
export function openStore(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      workspace TEXT NOT NULL,
      scope     TEXT NOT NULL,
      key       TEXT NOT NULL,
      value     TEXT NOT NULL,
      updated   TEXT NOT NULL,
      PRIMARY KEY (workspace, scope, key)
    );
    CREATE TABLE IF NOT EXISTS counter (
      id       INTEGER PRIMARY KEY CHECK (id = 1),
      revision INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO counter (id, revision) VALUES (1, 0);
  `);
  return db;
}

/**
 * The four store operations, over one open database.
 *
 * `revision` is a single counter bumped by every write, so a client can tell
 * "something changed" without diffing — and a future sync can ask for
 * everything above the revision it last saw.
 */
export function storeOps(db) {
  const revision = () => db.prepare('SELECT revision FROM counter WHERE id = 1').get().revision;
  const bump = () => {
    db.prepare('UPDATE counter SET revision = revision + 1 WHERE id = 1').run();
    return revision();
  };
  return {
    revision,
    list(workspace, scope) {
      const rows = db
        .prepare('SELECT key, value FROM records WHERE workspace = ? AND scope = ?')
        .all(workspace, scope);
      const records = {};
      for (const row of rows) records[row.key] = JSON.parse(row.value);
      return records;
    },
    get(workspace, scope, key) {
      const row = db
        .prepare('SELECT value FROM records WHERE workspace = ? AND scope = ? AND key = ?')
        .get(workspace, scope, key);
      return row ? JSON.parse(row.value) : null;
    },
    put(workspace, scope, key, value) {
      db.prepare(`
        INSERT INTO records (workspace, scope, key, value, updated) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (workspace, scope, key)
        DO UPDATE SET value = excluded.value, updated = excluded.updated
      `).run(workspace, scope, key, JSON.stringify(value), new Date().toISOString());
      return bump();
    },
    remove(workspace, scope, key) {
      const info = db
        .prepare('DELETE FROM records WHERE workspace = ? AND scope = ? AND key = ?')
        .run(workspace, scope, key);
      if (info.changes) bump();
      return info.changes > 0;
    },
  };
}

// ── HTTP ────────────────────────────────────────────────────────

const send = (res, status, body) => {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
};

/** Reads the body, refusing anything past the cap rather than buffering it. */
function readBody(req, limit = MAX_VALUE_BYTES + 4096) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('too large'), { tooLarge: true }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * The request handler, as a plain function so a test can drive the real HTTP
 * path without a socket if it wants to.
 *
 * `/health` and `/version` are deliberately **open**: the plugin's *Check the
 * server* has to answer before a credential is configured, and neither reveals
 * anything but a version string. Everything under `/v1/store` needs a token.
 */
export function createRequestHandler(db, { tokens = new Map() } = {}) {
  const ops = storeOps(db);

  return async function handle(req, res) {
    let url;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      return send(res, 400, { error: 'bad request' });
    }
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method ?? 'GET';

    if (method === 'GET' && (path === '/health' || path === '/version')) {
      return send(res, 200, { ok: true, version: VERSION });
    }

    const workspace = tokens.get(tokenOf(req, url));
    if (!workspace) return send(res, 401, { error: 'unauthorized' });

    const scope = String(url.searchParams.get('scope') ?? '').trim() || DEFAULT_SCOPE;

    try {
      if (path === '/v1/store') {
        if (method !== 'GET') return send(res, 405, { error: 'method not allowed' });
        return send(res, 200, { records: ops.list(workspace, scope), revision: ops.revision() });
      }

      const match = /^\/v1\/store\/([^/]+)$/.exec(path);
      if (!match) return send(res, 404, { error: 'not found' });

      let key;
      try {
        key = decodeURIComponent(match[1]);
      } catch {
        return send(res, 400, { error: 'bad key' });
      }
      if (!KEY_PATTERN.test(key)) return send(res, 400, { error: 'bad key' });

      if (method === 'GET') {
        const value = ops.get(workspace, scope, key);
        if (value === null) return send(res, 404, { error: 'no such record' });
        return send(res, 200, { key, value, revision: ops.revision() });
      }

      if (method === 'PUT') {
        const raw = await readBody(req);
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return send(res, 400, { error: 'body is not JSON' });
        }
        if (!parsed || typeof parsed !== 'object' || !('value' in parsed)) {
          return send(res, 400, { error: 'body needs a value' });
        }
        const encoded = JSON.stringify(parsed.value);
        if (Buffer.byteLength(encoded) > MAX_VALUE_BYTES) return send(res, 413, { error: 'too large' });
        return send(res, 200, { revision: ops.put(workspace, scope, key, parsed.value) });
      }

      if (method === 'DELETE') {
        ops.remove(workspace, scope, key);
        return send(res, 200, { ok: true });
      }

      return send(res, 405, { error: 'method not allowed' });
    } catch (err) {
      if (err?.tooLarge) return send(res, 413, { error: 'too large' });
      return send(res, 500, { error: 'server error' });
    }
  };
}

/** A listening server over its own database, for `main` and for the tests. */
export function createStoreServer({ dbPath = ':memory:', tokenList = '' } = {}) {
  const db = openStore(dbPath);
  const tokens = parseTokens(tokenList);
  const server = createHttpServer(createRequestHandler(db, { tokens }));
  server.on('close', () => {
    try {
      db.close();
    } catch {
      // already closed
    }
  });
  return { server, db, tokens };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const port = Number(process.env.PORT ?? 8080);
  const dbPath = process.env.STORE_DB ?? '/data/store.sqlite';
  const tokenList = process.env.STORE_TOKENS ?? '';
  if (!parseTokens(tokenList).size) {
    // An open store on the internet is worse than a container that will not
    // start: refuse loudly rather than serve everyone.
    console.error('STORE_TOKENS is empty — set at least one token (token=workspace).');
    process.exit(1);
  }
  const { server, tokens } = createStoreServer({ dbPath, tokenList });
  server.listen(port, () => {
    console.log(`contact-manager-store v${VERSION} listening on :${port} — ${tokens.size} token(s), db ${dbPath}`);
  });
}
