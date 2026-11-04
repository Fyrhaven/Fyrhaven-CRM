// Per-address-book roles (#23) — the advisory model: the ladder of roles, the
// storage round trip, and the rule that decides the role that applies.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROLE, ROLES, canManage, canPerform, capabilitiesForRole, effectiveRole,
  hasRoles, isRole, mostPermissiveRole, normalizeRoles, readRoles, roleAllows,
  roleForBook, roleForCard, setBookRole, weakestRole, writeRoles,
} from '../src/lib/book-roles.js';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { makeCard } from './fixtures.mjs';

// ── The ladder ──────────────────────────────────────────────────

describe('the role ladder', () => {
  it('lists the four roles weakest first, ending at the default', () => {
    expect(ROLES).toEqual(['viewer', 'editor', 'merger', 'admin']);
    expect(ROLES[ROLES.length - 1]).toBe(DEFAULT_ROLE);
  });

  it('a viewer may only view', () => {
    expect(roleAllows('viewer', 'view')).toBe(true);
    expect(roleAllows('viewer', 'edit')).toBe(false);
    expect(roleAllows('viewer', 'merge')).toBe(false);
    expect(roleAllows('viewer', 'delete')).toBe(false);
    expect(roleAllows('viewer', 'manage')).toBe(false);
  });

  it('an editor may edit but not merge, delete or manage', () => {
    expect(roleAllows('editor', 'edit')).toBe(true);
    expect(roleAllows('editor', 'merge')).toBe(false);
    expect(roleAllows('editor', 'delete')).toBe(false);
    expect(roleAllows('editor', 'manage')).toBe(false);
  });

  it('a merger may merge and delete but not manage', () => {
    expect(roleAllows('merger', 'merge')).toBe(true);
    expect(roleAllows('merger', 'delete')).toBe(true);
    expect(roleAllows('merger', 'manage')).toBe(false);
  });

  it('an admin may do everything', () => {
    expect(capabilitiesForRole('admin')).toEqual(['view', 'edit', 'merge', 'delete', 'manage']);
  });

  it('is monotone: a stronger role never loses a capability', () => {
    for (let i = 1; i < ROLES.length; i++) {
      const weaker = capabilitiesForRole(ROLES[i - 1]);
      const stronger = capabilitiesForRole(ROLES[i]);
      for (const capability of weaker) expect(stronger).toContain(capability);
    }
  });

  it('reads an unknown role as the default', () => {
    expect(roleAllows('nonsense', 'manage')).toBe(true);
    expect(capabilitiesForRole('nonsense')).toEqual(capabilitiesForRole(DEFAULT_ROLE));
    expect(isRole('nonsense')).toBe(false);
  });

  it('weakestRole returns the one nearer viewer, ignoring the rest', () => {
    expect(weakestRole('viewer', 'admin')).toBe('viewer');
    expect(weakestRole('merger', 'editor')).toBe('editor');
    expect(weakestRole('admin', 'admin')).toBe('admin');
    expect(weakestRole('nonsense', 'editor')).toBe('editor');
    expect(weakestRole()).toBe(DEFAULT_ROLE);
  });
});

// ── Normalisation ───────────────────────────────────────────────

describe('normalizeRoles', () => {
  it('returns an empty object for junk input', () => {
    expect(normalizeRoles(null)).toEqual({});
    expect(normalizeRoles('nope')).toEqual({});
    expect(normalizeRoles([])).toEqual({});
  });

  it('keeps known book ids with a known role', () => {
    expect(normalizeRoles({ b1: 'viewer', b2: 'admin', b3: 'merger' }))
      .toEqual({ b1: 'viewer', b2: 'admin', b3: 'merger' });
  });

  it('drops a book with an unknown role', () => {
    expect(normalizeRoles({ b1: 'owner', b2: 'editor' })).toEqual({ b2: 'editor' });
  });

  it('trims and drops empty book ids', () => {
    expect(normalizeRoles({ '': 'viewer', '  ': 'admin' })).toEqual({});
  });

  it('caps the number of book entries', () => {
    const big = {};
    for (let i = 0; i < 300; i++) big[`b${i}`] = 'viewer';
    expect(Object.keys(normalizeRoles(big)).length).toBeLessThanOrEqual(200);
  });
});

// ── Storage round trips ─────────────────────────────────────────

describe('readRoles / writeRoles', () => {
  it('reads an empty store as empty', async () => {
    const api = fakeApi();
    expect(await readRoles(api)).toEqual({});
  });

  it('round-trips a valid roles map', async () => {
    const api = fakeApi();
    const roles = { b1: 'viewer', b2: 'merger' };
    await writeRoles(api, roles);
    expect(await readRoles(api)).toEqual(roles);
  });

  it('rewrites storage when junk was repaired', async () => {
    const api = fakeApi();
    await api.storage.set('bookRoles', { b1: 'viewer', b2: 'nonsense', '': 'admin' });
    expect(await readRoles(api)).toEqual({ b1: 'viewer' });
    expect(await api.storage.get('bookRoles')).toEqual({ b1: 'viewer' });
  });

  it('removes the key when nothing is left to store', async () => {
    const api = fakeApi();
    await api.storage.set('bookRoles', { b1: 'viewer' });
    await writeRoles(api, { b1: 'nonsense' });
    expect(await api.storage.get('bookRoles')).toBeNull();
  });

  it('sets and clears one book through setBookRole', async () => {
    const api = fakeApi();
    await setBookRole(api, 'b1', 'viewer');
    expect(await api.storage.get('bookRoles')).toEqual({ b1: 'viewer' });
    await setBookRole(api, 'b1', undefined);
    expect(await api.storage.get('bookRoles')).toBeNull();
  });

  it('ignores an unknown role and an empty id in setBookRole', async () => {
    const api = fakeApi();
    await setBookRole(api, 'b1', 'owner');
    expect(await api.storage.get('bookRoles')).toBeNull();
    await setBookRole(api, '', 'viewer');
    expect(await api.storage.get('bookRoles')).toBeNull();
  });
});

// ── The role that applies ───────────────────────────────────────

describe('roleForBook', () => {
  it('returns the default for an unconfigured book or no roles at all', () => {
    expect(roleForBook({}, 'b1')).toBe(DEFAULT_ROLE);
    expect(roleForBook(null, 'b1')).toBe(DEFAULT_ROLE);
    expect(roleForBook({ b2: 'viewer' }, 'b1')).toBe(DEFAULT_ROLE);
  });

  it('returns the stored role', () => {
    expect(roleForBook({ b1: 'merger' }, 'b1')).toBe('merger');
  });
});

describe('roleForCard', () => {
  it('is the default without roles, and for a card in no book', () => {
    expect(roleForCard(makeCard({ id: 'a', addressBookIds: { b1: true } }), {})).toBe(DEFAULT_ROLE);
    expect(roleForCard(makeCard({ id: 'a', addressBookIds: {} }), { b1: 'viewer' })).toBe(DEFAULT_ROLE);
  });

  it('is the role of the one book the card is in', () => {
    const card = makeCard({ id: 'a', addressBookIds: { b1: true } });
    expect(roleForCard(card, { b1: 'editor' })).toBe('editor');
  });

  it('is the weakest role across every book the card is in', () => {
    const card = makeCard({ id: 'a', addressBookIds: { b1: true, b2: true } });
    expect(roleForCard(card, { b1: 'admin', b2: 'viewer' })).toBe('viewer');
  });

  it('is unrestricted when the card is only in unconfigured books', () => {
    const card = makeCard({ id: 'a', addressBookIds: { b9: true } });
    expect(roleForCard(card, { b1: 'viewer' })).toBe(DEFAULT_ROLE);
  });
});

describe('effectiveRole / mostPermissiveRole', () => {
  it('is the default for an empty selection or no roles', () => {
    expect(effectiveRole([], { b1: 'viewer' })).toBe(DEFAULT_ROLE);
    expect(effectiveRole([makeCard({ id: 'a' })], {})).toBe(DEFAULT_ROLE);
  });

  it('is the weakest role across a selection', () => {
    const cards = [
      makeCard({ id: 'a', addressBookIds: { b1: true } }),
      makeCard({ id: 'b', addressBookIds: { b2: true } }),
    ];
    expect(effectiveRole(cards, { b1: 'merger', b2: 'editor' })).toBe('editor');
  });

  it('mostPermissiveRole is the strongest configured role', () => {
    expect(mostPermissiveRole({ b1: 'viewer', b2: 'merger' })).toBe('merger');
    expect(mostPermissiveRole({})).toBe(DEFAULT_ROLE);
    expect(mostPermissiveRole(null)).toBe(DEFAULT_ROLE);
  });
});

describe('canPerform / canManage', () => {
  it('a viewer may not merge, edit or delete', () => {
    const cards = [makeCard({ id: 'a', addressBookIds: { b1: true } })];
    const roles = { b1: 'viewer' };
    expect(canPerform(cards, 'merge', roles)).toBe(false);
    expect(canPerform(cards, 'edit', roles)).toBe(false);
    expect(canPerform(cards, 'delete', roles)).toBe(false);
    expect(canPerform(cards, 'view', roles)).toBe(true);
  });

  it('a merger may merge and delete the selection but not manage globally', () => {
    const cards = [makeCard({ id: 'a', addressBookIds: { b1: true } })];
    const roles = { b1: 'merger' };
    expect(canPerform(cards, 'merge', roles)).toBe(true);
    expect(canPerform(cards, 'delete', roles)).toBe(true);
    expect(canManage('manage', roles)).toBe(false);
  });

  it('an empty roles map allows everything, so nothing changes by default', () => {
    const cards = [makeCard({ id: 'a', addressBookIds: { b1: true } })];
    for (const capability of ['view', 'edit', 'merge', 'delete', 'manage']) {
      expect(canPerform(cards, capability, {})).toBe(true);
      expect(canManage(capability, {})).toBe(true);
    }
  });

  it('hasRoles is false for an empty or missing map', () => {
    expect(hasRoles({})).toBe(false);
    expect(hasRoles(null)).toBe(false);
    expect(hasRoles({ b1: 'viewer' })).toBe(true);
  });
});
