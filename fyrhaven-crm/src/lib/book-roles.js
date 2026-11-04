// Per-address-book roles (#23) — the advisory half.
//
// The plugin host grants its write permission once at install, all-or-nothing,
// so the plugin cannot enforce *who* may edit which book: the host has no
// per-book permission and no member list, and plugin storage is per browser,
// not shared. What a role recorded here does is *advise*: the pages read it and
// disable the actions the role does not allow, and the dialog says out loud
// that the host is not enforcing it. That is the honest half of #23; the
// enforced half needs the server tier (#68).
//
// Pure model plus api.storage — no DOM. The UI is roles-dialog.js, and the
// pages gate their buttons with `effectiveRole` / `canPerform`.
//
// Stored shape (one role per book, keyed by book id):
//   { [bookId]: 'viewer' | 'editor' | 'merger' | 'admin' }
//
// A book with no stored role — and a card in no book at all — grants `admin`,
// so an install that never touches this feature behaves exactly as before.

import { bookIds } from './contacts.js';

export const ROLES_KEY = 'bookRoles';
export const MAX_ROLES = 200;

/** The four roles, weakest first. The ladder is strict and monotone. */
export const ROLES = ['viewer', 'editor', 'merger', 'admin'];

/** What an unconfigured book grants: everything. */
export const DEFAULT_ROLE = 'admin';

/** The five capabilities the UI gates on, weakest first. */
export const CAPABILITIES = ['view', 'edit', 'merge', 'delete', 'manage'];

const RANK = { viewer: 0, editor: 1, merger: 2, admin: 3 };

// Each step up the ladder adds a capability and never takes one away.
//   view   — see contacts, run a scan, read a profile
//   edit   — create and edit contacts, groups, projects, import, normalise
//   merge  — merge duplicates and undo a merge
//   delete — remove contacts (single and bulk) and erase/anonymise
//   manage — change the roles and the duplicate policies
export const ROLE_CAPABILITIES = {
  viewer: ['view'],
  editor: ['view', 'edit'],
  merger: ['view', 'edit', 'merge', 'delete'],
  admin: ['view', 'edit', 'merge', 'delete', 'manage'],
};

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** Is this one of the four roles? */
export function isRole(value) {
  return ROLES.includes(value);
}

/** The ladder position of a role; an unknown role is the default (`admin`). */
export function roleRank(role) {
  return RANK[role] ?? RANK[DEFAULT_ROLE];
}

/** The capabilities a role grants. An unknown role grants the default's set. */
export function capabilitiesForRole(role) {
  return ROLE_CAPABILITIES[role] ?? ROLE_CAPABILITIES[DEFAULT_ROLE];
}

/** Does the role allow the capability? */
export function roleAllows(role, capability) {
  return capabilitiesForRole(role).includes(capability);
}

/**
 * The weaker of two roles — the one nearer `viewer`. An unknown role is
 * ignored (it reads as the default, which never weakens the answer).
 */
export function weakestRole(...roles) {
  let weakest = DEFAULT_ROLE;
  for (const role of roles) {
    if (isRole(role) && roleRank(role) < roleRank(weakest)) weakest = role;
  }
  return weakest;
}

// ── Storage ─────────────────────────────────────────────────────

/** The stored roles map, repaired: only known book ids with a known role. */
export function normalizeRoles(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  let count = 0;
  for (const [bookId, role] of Object.entries(raw)) {
    const id = text(bookId);
    if (!id || !isRole(role)) continue;
    if (count >= MAX_ROLES) break;
    out[id] = role;
    count += 1;
  }
  return out;
}

/** Read the stored roles; rewrites when junk was dropped. */
export async function readRoles(api) {
  const stored = await api.storage.get(ROLES_KEY);
  const raw = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  const roles = normalizeRoles(raw);
  if (JSON.stringify(roles) !== JSON.stringify(raw)) {
    if (Object.keys(roles).length) await api.storage.set(ROLES_KEY, roles);
    else await api.storage.remove(ROLES_KEY);
  }
  return roles;
}

/** Write a full roles map. An empty map removes the key. */
export async function writeRoles(api, roles) {
  const cleaned = normalizeRoles(roles);
  if (Object.keys(cleaned).length) await api.storage.set(ROLES_KEY, cleaned);
  else await api.storage.remove(ROLES_KEY);
  return cleaned;
}

/**
 * Set or clear one book's role. Pass `undefined` / `null` / `''` to clear it —
 * the book falls back to the default (`admin`).
 */
export async function setBookRole(api, bookId, role) {
  const roles = await readRoles(api);
  const id = text(bookId);
  if (!id) return roles;
  if (role === undefined || role === null || role === '') delete roles[id];
  else if (isRole(role)) roles[id] = role;
  else return roles;
  return writeRoles(api, roles);
}

// ── Reading the role that applies ───────────────────────────────

/** Whether any role is set at all. */
export function hasRoles(roles) {
  return Boolean(roles && Object.keys(roles).length);
}

/** The role recorded for one book, or the default. */
export function roleForBook(roles, bookId) {
  const id = text(bookId);
  const role = id ? roles?.[id] : undefined;
  return isRole(role) ? role : DEFAULT_ROLE;
}

/**
 * The role that applies to one card: the **weakest** role across every book it
 * lives in. A card in no book is unrestricted (the default book is the user's
 * own, with no role recorded against it).
 *
 * The weakest — not the most permissive — because this is a limit on what the
 * user may do: a contact that lives in a book where the user is only a viewer
 * stays read-only, even if another book they share would allow more. It is the
 * opposite direction to the match strategies in `book-policies.js`, which take
 * the most permissive reading so a book that opts out never silences another;
 * a permission is the safe direction *inwards*.
 */
export function roleForCard(card, roles) {
  if (!hasRoles(roles)) return DEFAULT_ROLE;
  const ids = bookIds(card);
  if (!ids.length) return DEFAULT_ROLE;
  return ids.reduce((acc, id) => weakestRole(acc, roleForBook(roles, id)), DEFAULT_ROLE);
}

/** The weakest role across a set of cards — the role for a selection. */
export function effectiveRole(cards, roles) {
  if (!hasRoles(roles)) return DEFAULT_ROLE;
  const list = Array.isArray(cards) ? cards : [];
  if (!list.length) return DEFAULT_ROLE;
  return list.reduce((acc, card) => weakestRole(acc, roleForCard(card, roles)), DEFAULT_ROLE);
}

/**
 * The **most** permissive role across every configured book — the role for an
 * action that is not tied to a contact (creating one, opening the roles or
 * policies dialog). If any book lets the user do it, the global action is
 * meaningful.
 */
export function mostPermissiveRole(roles) {
  const list = Object.values(roles ?? {}).filter(isRole);
  if (!list.length) return DEFAULT_ROLE;
  return list.reduce((acc, role) => (roleRank(role) > roleRank(acc) ? role : acc), list[0]);
}

/** May the capability be performed on this set of cards? */
export function canPerform(cards, capability, roles) {
  return roleAllows(effectiveRole(cards, roles), capability);
}

/** May the capability be performed as a whole-book / global action? */
export function canManage(capability, roles) {
  return roleAllows(mostPermissiveRole(roles), capability);
}
