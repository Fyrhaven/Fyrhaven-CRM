// Talking to a server the user has configured.
//
// The host proxies every request and holds the credential, so the plugin never
// sees a secret and the `http:proxy` permission is a visible, reviewable ask at
// install. That is the whole reason this shape works for a paid tier: no API key
// ships in the ZIP.
//
// Everything here is optional by construction. With no server configured, every
// call reports `unconfigured` and the plugin behaves exactly as it does today —
// which is the requirement that does not bend.

export const REMOTE_URL_KEY = 'remoteUrl';
export const REMOTE_CREDENTIAL_KEY = 'remoteCredentialId';
/**
 * The credential id the manifest declares (`credentials.store`). The host holds
 * the token; the plugin only ever names it — that is the whole reason a paid
 * tier can ship without a secret in the ZIP.
 */
export const CREDENTIAL_ID = 'store';

/**
 * A self-hosted server is protected by a user name and password, so it has its
 * own credential: the cloud keeps a bearer token, a server you run keeps a pair.
 */
export const BASIC_CREDENTIAL_ID = 'store-basic';
export const credentialFor = (mode) => (mode === 'cloud' ? CREDENTIAL_ID : BASIC_CREDENTIAL_ID);

/**
 * The service the plugin's own cloud tier runs on (#147).
 *
 * Fixed in code, not shown as a field: a customer who bought a subscription is
 * not expected to know a hostname, and an address they could edit is one they
 * could get wrong. A self-hoster types their own instead.
 */
export const CLOUD_ORIGIN = 'https://crm.fyrhaven.com';

/** Which of the two ways this install talks to a server. */
export const SERVER_MODES = ['cloud', 'self'];
export const REMOTE_MODE_KEY = 'remoteMode';

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * A server address with a scheme and no trailing slash. A value typed without
 * one is https, because a token over plain http is a token given away.
 */
export function normalizeServerUrl(url) {
  const clean = text(url);
  if (!clean) return '';
  const withScheme = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
  return withScheme.replace(/\/+$/, '');
}

/** The server the user configured, or '' when the plugin is local-only. */
export async function readRemoteUrl(api) {
  return text(await api.storage.get(REMOTE_URL_KEY));
}

/** Sets (or clears) the server; a URL without a scheme is treated as https. */
export async function writeRemoteUrl(api, url) {
  const clean = normalizeServerUrl(url);
  if (!clean) {
    await api.storage.remove(REMOTE_URL_KEY);
    return '';
  }
  await api.storage.set(REMOTE_URL_KEY, clean);
  return clean;
}

/**
 * What the plugin knows about the server right now — for the dialog that shows
 * it. `canConnect` is the host's `api.proxy.connect` being there at all: an
 * older webmail can proxy a request but cannot hold a credential for us.
 */
export async function readServerState(api) {
  const [url, credentialId, mode] = await Promise.all([
    readRemoteUrl(api), readRemoteCredential(api), readServerMode(api),
  ]);
  return {
    url,
    credentialId,
    mode,
    // The cloud address is fixed; the dialog shows it as a fact, not a field.
    cloudOrigin: CLOUD_ORIGIN,
    canConnect: typeof api?.proxy?.connect === 'function',
  };
}

/** `'cloud'` (the plugin's service) or `'self'` (a server you run). */
export async function readServerMode(api) {
  const stored = text(await api.storage.get(REMOTE_MODE_KEY));
  return SERVER_MODES.includes(stored) ? stored : 'self';
}

/** Remembers the choice, so the dialog opens where the user left it. */
export async function writeServerMode(api, mode) {
  const clean = SERVER_MODES.includes(mode) ? mode : 'self';
  await api.storage.set(REMOTE_MODE_KEY, clean);
  return clean;
}

/**
 * Connects the host-held credential and remembers where the server is.
 *
 * The host draws the dialog that takes the workspace token, so the plugin never
 * sees it: `api.proxy.connect` resolves `{ connected, origin, credentialId,
 * username }` once the user has approved. Every failure is an answer, not a
 * throw — a missing `api.proxy.connect`, a cancelled dialog and a refusal are
 * three different messages to the user.
 *
 * Nothing is written until the host says `connected`, so a cancelled dialog
 * cannot leave the plugin pointed at a server it cannot authenticate to.
 *
 * @returns {Promise<{status: 'ok'|'unavailable'|'failed', url?: string, reason?: string}>}
 */
export async function connectServer(api, url, { mode = 'self' } = {}) {
  // Cloud ignores what the dialog held: the address is the service's, and a
  // stale field must not point a subscriber at someone else's server.
  const target = mode === 'cloud' ? CLOUD_ORIGIN : normalizeServerUrl(url);
  if (!target) return { status: 'failed', reason: 'no address' };
  const connect = api?.proxy?.connect;
  if (typeof connect !== 'function') return { status: 'unavailable' };
  try {
    const answer = await connect(credentialFor(mode), { mode: 'password', server: target });
    if (!answer || answer.connected !== true) return { status: 'failed', reason: 'not connected' };
    const origin = normalizeServerUrl(answer.origin) || target;
    await api.storage.set(REMOTE_URL_KEY, origin);
    await api.storage.set(REMOTE_CREDENTIAL_KEY, text(answer.credentialId) || credentialFor(mode));
    return { status: 'ok', url: origin, username: text(answer.username) };
  } catch (err) {
    return { status: 'failed', reason: String(err?.message ?? err) };
  }
}

/**
 * Forgets the server and asks the host to drop the credential. A failing
 * disconnect is not worth blocking on — the local state is what the plugin
 * reads, and the user can remove the account in the webmail's own settings.
 */
export async function disconnectServer(api) {
  try {
    if (typeof api?.proxy?.disconnect === 'function') {
      // Both, because the mode may have been the other one when it was connected.
      // A host that refuses one of them must not stop the other.
      try { await api.proxy.disconnect(BASIC_CREDENTIAL_ID); } catch { /* not connected */ }
      try { await api.proxy.disconnect(CREDENTIAL_ID); } catch { /* not connected */ }
    }
  } catch {
    // The plugin no longer points at a server either way.
  }
  await api.storage.remove(REMOTE_URL_KEY);
  await api.storage.remove(REMOTE_CREDENTIAL_KEY);
  return { status: 'ok' };
}


/** The credential the host should attach, or '' for an unauthenticated call. */
export const readRemoteCredential = async (api) => text(await api.storage.get(REMOTE_CREDENTIAL_KEY));

/**
 * One request through the host's proxy.
 *
 * The response shape (`{ status, ok, headers, body }`) is the one the host's own
 * test double documents. A missing `api.proxy` — an older webmail — is reported
 * as `unavailable` rather than thrown, for the same reason every other optional
 * host call is.
 *
 * @returns {Promise<{status: string, code?: number, body?: string, reason?: string}>}
 *   `status` is `'ok' | 'unconfigured' | 'unavailable' | 'failed'`.
 */
export async function callServer(api, path, { method = 'GET', body, headers } = {}) {
  const base = await readRemoteUrl(api);
  if (!base) return { status: 'unconfigured' };

  const fetch = api?.proxy?.fetch;
  if (typeof fetch !== 'function') return { status: 'unavailable' };

  try {
    const credentialId = await readRemoteCredential(api);
    const response = await fetch(credentialId, `${base}${path}`, { method, body, headers });
    if (!response || typeof response !== 'object') return { status: 'failed', reason: 'no response' };
    if (response.ok === false || (typeof response.status === 'number' && response.status >= 400)) {
      return { status: 'failed', code: response.status, reason: `HTTP ${response.status}` };
    }
    return { status: 'ok', code: response.status, body: String(response.body ?? '') };
  } catch (err) {
    return { status: 'failed', reason: String(err?.message ?? err) };
  }
}

/**
 * The plugin server's key/value store — where a record this plugin invents lives
 * now that the server is the source of truth (#68).
 *
 * The four calls are the whole protocol:
 *
 *     GET    /v1/store        -> { records: { key: value, … }, revision }
 *     GET    /v1/store/{key}  -> { key, value, revision } | 404
 *     PUT    /v1/store/{key}  <- { value } -> { revision }
 *     DELETE /v1/store/{key}  -> { ok: true }
 *
 * `scope` is the workspace the record belongs to. It defaults to the user the
 * host's credential identifies, which is what a single-user install wants and
 * what the team features (#23/#24) will widen.
 *
 * Every call answers with the same `{ status, … }` shape as `callServer`, so a
 * caller cannot mistake "no server configured" for "no records" — the two look
 * identical if a read is allowed to return an empty value.
 */
const storePath = (key, scope) => {
  const query = scope ? `?scope=${encodeURIComponent(scope)}` : '';
  const id = text(key);
  return id ? `/v1/store/${encodeURIComponent(id)}${query}` : `/v1/store${query}`;
};

/** Every record in the scope, as `{ key: value }`. */
export async function storeList(api, { scope } = {}) {
  const answer = await callServer(api, storePath('', scope));
  if (answer.status !== 'ok') return answer;
  try {
    const parsed = JSON.parse(answer.body);
    const records = parsed?.records;
    if (!records || typeof records !== 'object' || Array.isArray(records)) {
      return { status: 'failed', reason: 'no records in the answer' };
    }
    return { status: 'ok', records, revision: parsed.revision };
  } catch {
    return { status: 'failed', reason: 'the answer was not JSON' };
  }
}

/** One record. A 404 is `{ status: 'ok', value: null }` — absent, not broken. */
export async function storeGet(api, key, { scope } = {}) {
  const answer = await callServer(api, storePath(key, scope));
  if (answer.status === 'failed' && answer.code === 404) return { status: 'ok', value: null };
  if (answer.status !== 'ok') return answer;
  try {
    const parsed = JSON.parse(answer.body);
    return { status: 'ok', value: parsed?.value ?? null, revision: parsed?.revision };
  } catch {
    return { status: 'failed', reason: 'the answer was not JSON' };
  }
}

/** Writes one record; answers with the server's revision when it sends one. */
export async function storePut(api, key, value, { scope } = {}) {
  const answer = await callServer(api, storePath(key, scope), {
    method: 'PUT',
    body: JSON.stringify({ value }),
    headers: { 'content-type': 'application/json' },
  });
  if (answer.status !== 'ok') return answer;
  try {
    return { status: 'ok', revision: JSON.parse(answer.body ?? '{}')?.revision };
  } catch {
    // A write that answered without JSON still wrote; only the revision is lost.
    return { status: 'ok' };
  }
}

/** Removes one record. */
export async function storeDelete(api, key, { scope } = {}) {
  const answer = await callServer(api, storePath(key, scope), { method: 'DELETE' });
  return answer.status === 'ok' ? { status: 'ok' } : answer;
}

/**
 * The version the server reports — the spike endpoint.
 *
 * @returns {Promise<{status: string, version?: string, reason?: string}>}
 */
export async function serverVersion(api) {
  const answer = await callServer(api, '/version');
  if (answer.status !== 'ok') return answer;
  try {
    const parsed = JSON.parse(answer.body);
    const version = text(parsed?.version);
    return version ? { status: 'ok', version } : { status: 'failed', reason: 'no version in the answer' };
  } catch {
    return { status: 'failed', reason: 'the answer was not JSON' };
  }
}


/**
 * What the server says about this credential: the plan, its expiry, and whether
 * writing is allowed (#147).
 *
 * This is the difference between "connected" and "entitled": a stranger can
 * reach the service, and an expired subscription can still read. The plugin asks
 * rather than assuming, because assuming either way is a lie to the user.
 *
 * @returns {Promise<{status: 'ok'|'unconfigured'|'unavailable'|'failed', plan?: string,
 *   entitled?: boolean, expiresAt?: string, email?: string, licences?: any[], reason?: string}>}
 */
export async function accountInfo(api) {
  const answer = await callServer(api, '/v1/account');
  if (answer.status !== 'ok') return answer;
  try {
    const parsed = JSON.parse(answer.body);
    if (!parsed || typeof parsed !== 'object') return { status: 'failed', reason: 'the answer was not an object' };
    return {
      status: 'ok',
      plan: text(parsed.plan),
      entitled: parsed.entitled === true,
      expiresAt: text(parsed.expiresAt),
      email: text(parsed.account?.email),
      licences: Array.isArray(parsed.licences) ? parsed.licences : [],
    };
  } catch {
    return { status: 'failed', reason: 'the answer was not JSON' };
  }
}


/**
 * The licence this server is running under (#148).
 *
 * `fingerprint` is the installation key the operator takes to the website; the
 * rest says what the server thinks it is allowed to do. 
 *
 * @returns {Promise<{status: 'ok'|'unconfigured'|'unavailable'|'failed', mode?: string,
 *   fingerprint?: string, licensed?: boolean, summary?: string, licence?: object, reason?: string}>}
 */
export async function licenceInfo(api) {
  const answer = await callServer(api, '/v1/licence');
  if (answer.status !== 'ok') return answer;
  try {
    const parsed = JSON.parse(answer.body);
    if (!parsed || typeof parsed !== 'object') return { status: 'failed', reason: 'the answer was not an object' };
    return {
      status: 'ok',
      mode: text(parsed.mode),
      fingerprint: text(parsed.fingerprint),
      licensed: parsed.licensed === true,
      summary: text(parsed.summary),
      licence: parsed.licence ?? null,
    };
  } catch {
    return { status: 'failed', reason: 'the answer was not JSON' };
  }
}

/** Installs a licence key the user pasted — the server checks it, not this code. */
export async function installLicence(api, licence) {
  const key = text(licence);
  if (!key) return { status: 'failed', reason: 'no licence' };
  const answer = await callServer(api, '/v1/licence', {
    method: 'POST',
    body: JSON.stringify({ licence: key }),
    headers: { 'content-type': 'application/json' },
  });
  if (answer.status !== 'ok') return answer;
  try {
    const parsed = JSON.parse(answer.body);
    return { status: 'ok', summary: text(parsed.summary), daysLeft: parsed.daysLeft, stored: parsed.stored === true };
  } catch {
    return { status: 'failed', reason: 'the answer was not JSON' };
  }
}

/** A challenge the user takes to the website to release this installation. */
export async function deactivationChallenge(api) {
  const answer = await callServer(api, '/v1/licence/challenge', {
    method: 'POST', body: '{}', headers: { 'content-type': 'application/json' },
  });
  if (answer.status !== 'ok') return answer;
  try {
    const parsed = JSON.parse(answer.body);
    return { status: 'ok', challenge: text(parsed.challenge), fingerprint: text(parsed.fingerprint) };
  } catch {
    return { status: 'failed', reason: 'the answer was not JSON' };
  }
}

/** Spends the signed release code on this server, so the licence can move. */
export async function applyDeactivation(api, code) {
  const answer = await callServer(api, '/v1/licence/deactivate', {
    method: 'POST',
    body: JSON.stringify({ code: text(code) }),
    headers: { 'content-type': 'application/json' },
  });
  if (answer.status !== 'ok') return answer;
  try {
    const parsed = JSON.parse(answer.body);
    return { status: 'ok', deactivated: parsed.deactivated === true };
  } catch {
    return { status: 'failed', reason: 'the answer was not JSON' };
  }
}
