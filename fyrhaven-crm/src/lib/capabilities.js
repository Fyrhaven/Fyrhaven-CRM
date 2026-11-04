// Which optional host APIs this instance actually has.
//
// Mail, tasks and calendar are optional context, and the host does not promise
// a fixed shape for them across versions. On a current install `api.email` can
// exist as an object with no `search` method at all, which is what produced
// `api.email.search is not a function` and used to take the Contacts page down.
//
// The plugin cannot guess the real names from the outside, and its own README
// host contract turned out to describe an API the host does not have. So this
// module reports what is really there — including every key each namespace
// does expose, which is the useful part when a name is wrong — and `activate()`
// logs it once. Keep it pure: no `api` calls, no DOM, no React.

/** The optional namespaces, in the order they are reported. */
export const OPTIONAL_NAMESPACES = ['email', 'tasks', 'calendar'];

/** The methods the plugin wants from each, and what each one powers. */
export const WANTED_METHODS = {
  email: ['search', 'getAttachment'],
  tasks: ['list', 'create'],
  calendar: ['getEvents'],
};

/** The keys of a namespace, or [] when it is not there or cannot be read. */
function keysOf(value) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return [];
  try {
    return Object.keys(value).sort();
  } catch {
    return [];
  }
}

/**
 * What the host exposes right now, per optional namespace:
 * `{ present, keys, missing }` — `missing` lists the wanted methods that are
 * not there, and `keys` is what the namespace does have.
 */
export function detectCapabilities(api) {
  const found = {};
  for (const name of OPTIONAL_NAMESPACES) {
    let namespace;
    try {
      namespace = api?.[name];
    } catch {
      namespace = undefined;
    }
    const keys = keysOf(namespace);
    found[name] = {
      present: Boolean(namespace),
      keys,
      missing: WANTED_METHODS[name].filter((method) => !keys.includes(method)),
    };
  }
  return found;
}

/** The optional namespaces the plugin cannot use right now. */
export function unavailableNamespaces(capabilities) {
  return OPTIONAL_NAMESPACES.filter((name) => capabilities?.[name]?.missing?.length);
}

/**
 * One line naming what each namespace really exposes — the thing to paste into
 * a bug report, because it shows the method names the host actually uses.
 */
export function describeCapabilities(capabilities) {
  return OPTIONAL_NAMESPACES
    .map((name) => {
      const found = capabilities?.[name];
      if (!found?.present) return `${name}: absent`;
      if (!found.keys.length) return `${name}: present but exposes no keys`;
      return `${name}: ${found.keys.join(', ')}`;
    })
    .join(' | ');
}

/**
 * One cheap read per optional namespace.
 *
 * Existence is not the same as working: a namespace can be present with the
 * method attached and the **call** still refused, which is what a missing
 * permission looks like from inside a plugin. The Contacts page said "Meetings
 * are unavailable" while the existence probe found nothing missing — this tells
 * those two apart, and the error message names the reason.
 *
 * @returns {Promise<string[]>} one `"name: message"` per call that failed
 */
export async function probeOptionalApis(api, now = Date.now()) {
  const day = 24 * 3600 * 1000;
  const checks = [
    ['email', () => api.email.search({ text: 'a', limit: 1 })],
    // no `limit`: the host rejects an unknown option, and the plugin never sends one
    ['tasks', () => api.tasks.list({ includeCompleted: true })],
    // the same shape the plugin sends: `.123Z` is rejected by the host
    ['calendar', () => api.calendar.getEvents({
      from: new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      to: new Date(now + day).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    })],
  ];
  const failures = [];
  for (const [name, run] of checks) {
    try {
      await run();
    } catch (err) {
      failures.push(`${name}: ${String(err?.message ?? err)}`);
    }
  }
  return failures;
}

/** The namespaces and method names the host actually exposes. */
export function describeSurface(api) {
  // a thunk, so reading the namespace is inside the try as well: a host that
  // throws on property access must not take the log line down with it
  const keys = (read) => {
    try {
      return Object.keys(read() ?? {}).sort().join(', ') || '(none)';
    } catch {
      return '(unreadable)';
    }
  };
  return [
    `api: ${keys(() => api)}`,
    `ui: ${keys(() => api?.ui)}`,
    `email: ${keys(() => api?.email)}`,
    `tasks: ${keys(() => api?.tasks)}`,
    `calendar: ${keys(() => api?.calendar)}`,
  ].join(' | ');
}
