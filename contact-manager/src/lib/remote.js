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

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** The server the user configured, or '' when the plugin is local-only. */
export async function readRemoteUrl(api) {
  return text(await api.storage.get(REMOTE_URL_KEY));
}

/** Sets (or clears) the server; a URL without a scheme is treated as https. */
export async function writeRemoteUrl(api, url) {
  const clean = text(url);
  if (!clean) {
    await api.storage.remove(REMOTE_URL_KEY);
    return '';
  }
  const withScheme = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
  const trimmed = withScheme.replace(/\/+$/, '');
  await api.storage.set(REMOTE_URL_KEY, trimmed);
  return trimmed;
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
