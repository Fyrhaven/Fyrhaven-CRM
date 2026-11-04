// Optional host calls: context the plugin can live without (mail, tasks,
// calendar). The design rule is that a missing permission or an older host
// must leave the surrounding page readable, so every optional call has to
// degrade instead of throwing.
//
// `.catch()` alone is not enough. A namespace the host does not expose
// (`api.calendar` on an older webmail) throws **synchronously** when it is
// read, and a method that is present but returns nothing yields a non-promise.
// Both escape a plain `.catch()` and, inside a React effect, take the whole
// page down. `optionalCall` runs the call and always resolves: to the result,
// or to `null` when anything at all goes wrong.

/**
 * Runs an optional host call and always returns a promise.
 *
 * @param {() => any} run the call, e.g. `() => api.calendar.getEvents(range)`
 * @returns {Promise<any>} the result, or `null` when the call is unavailable,
 *   does not return a promise, or rejects.
 */
export function optionalCall(run) {
  let value;
  try {
    value = run();
  } catch {
    return Promise.resolve(null);
  }
  if (!value || typeof value.then !== 'function') return Promise.resolve(null);
  return Promise.resolve(value).catch(() => null);
}
