// The consent store (#26): the record, its expiry status, and the repairs.
import { describe, expect, it } from 'vitest';
import { fakeApi } from '../test-utils/fake-api.mjs';
import {
  CONSENT_KEY, DEFAULT_BASIS, MAX_CONSENTS, consentKey, consentStatus, consentSummary,
  consentsFor, dateMs, daysUntilExpiry, eraseConsents, isoDate, normalizeConsent,
  normalizeConsents, readConsents, removeConsent, setConsent,
} from '../src/lib/consent.js';

const record = (overrides = {}) => ({
  contactId: 'a', source: 'newsletter', basis: 'consent',
  grantedAt: '2026-01-01', expiresAt: null, note: '', ...overrides,
});
const at = (iso) => Date.parse(`${iso}T00:00:00Z`);

describe('normalizeConsent', () => {
  it('repairs a record and defaults an unknown basis', () => {
    expect(normalizeConsent(record())).toEqual(record());
    expect(normalizeConsent(record({ basis: 'nonsense' })).basis).toBe(DEFAULT_BASIS);
    expect(normalizeConsent(record({ grantedAt: 'not a date' })).grantedAt).toBe('');
    expect(normalizeConsent(record({ expiresAt: '' })).expiresAt).toBeNull();
  });

  it('needs a contact and a source', () => {
    expect(normalizeConsent(record({ contactId: '' }))).toBeNull();
    expect(normalizeConsent(record({ source: '   ' }))).toBeNull();
    expect(normalizeConsent(null)).toBeNull();
    expect(normalizeConsent('nope')).toBeNull();
  });

  it('reads a date given as a number or a string', () => {
    expect(isoDate(Date.UTC(2026, 5, 15))).toBe('2026-06-15');
    expect(isoDate('')).toBe('');
    expect(isoDate('rubbish')).toBe('');
    expect(dateMs('2026-01-01')).toBe(at('2026-01-01'));
    expect(dateMs(null)).toBeNull();
  });
});

describe('normalizeConsents', () => {
  it('keeps one record per (contact, source), source case-insensitive', () => {
    const list = normalizeConsents([record({ source: 'Newsletter' }), record({ source: 'newsletter', note: 'older' })]);
    expect(list).toHaveLength(1);
    // the first occurrence (the newest, when stored newest-first) wins
    expect(list[0].note).toBe('');
    expect(consentKey(list[0])).toBe(consentKey(record()));
  });

  it('sorts newest first and caps the list', () => {
    const many = Array.from({ length: MAX_CONSENTS + 5 }, (_, i) => record({ contactId: `c${i}` }));
    expect(normalizeConsents(many)).toHaveLength(MAX_CONSENTS);
    const sorted = normalizeConsents([record({ contactId: 'x', grantedAt: '2025-01-01' }), record({ contactId: 'y', grantedAt: '2026-01-01' })]);
    expect(sorted.map((item) => item.contactId)).toEqual(['y', 'x']);
  });
});

describe('the consent store', () => {
  it('adds, replaces and reads back', async () => {
    const api = fakeApi();
    await setConsent(api, record());
    await setConsent(api, record({ source: 'Newsletter', note: 'newer' }));
    const stored = await readConsents(api);
    expect(stored).toHaveLength(1);
    expect(stored[0].note).toBe('newer');
    expect(await api.storage.get(CONSENT_KEY)).toEqual(stored);
  });

  it('filters by contact, removes one, and erases them all', async () => {
    const api = fakeApi();
    await setConsent(api, record({ contactId: 'a', source: 'newsletter' }));
    await setConsent(api, record({ contactId: 'a', source: 'events' }));
    await setConsent(api, record({ contactId: 'b', source: 'newsletter' }));
    expect(consentsFor(await readConsents(api), 'a')).toHaveLength(2);

    expect(await removeConsent(api, 'a', 'events')).toBe(true);
    expect(await removeConsent(api, 'a', 'events')).toBe(false);
    expect(consentsFor(await readConsents(api), 'a')).toHaveLength(1);

    expect(await eraseConsents(api, 'a')).toBe(1);
    expect(consentsFor(await readConsents(api), 'a')).toHaveLength(0);
    expect((await readConsents(api)).map((item) => item.contactId)).toEqual(['b']);
  });

  it('survives junk in storage and rewrites it when it dropped any', async () => {
    const api = fakeApi();
    await api.storage.set(CONSENT_KEY, [record(), { junk: true }]);
    const records = await readConsents(api);
    expect(records).toHaveLength(1);
    expect(await api.storage.get(CONSENT_KEY)).toEqual(records);
  });

  it('removes the key entirely when the last record goes', async () => {
    const api = fakeApi();
    await setConsent(api, record());
    await eraseConsents(api, 'a');
    expect(await api.storage.get(CONSENT_KEY)).toBeNull();
  });
});

describe('consentStatus', () => {
  it('is expired, expiring, active or none', () => {
    const now = at('2026-01-01');
    expect(consentStatus(null, now)).toBe('none');
    expect(consentStatus(record({ expiresAt: '2025-12-31' }), now)).toBe('expired');
    expect(consentStatus(record({ expiresAt: '2026-01-31' }), now)).toBe('expiring');
    expect(consentStatus(record({ expiresAt: '2026-06-01' }), now)).toBe('active');
    expect(consentStatus(record({ expiresAt: null }), now)).toBe('active');
    expect(daysUntilExpiry(record({ expiresAt: '2026-01-31' }), now)).toBe(30);
    expect(daysUntilExpiry(record(), now)).toBeNull();
  });
});

describe('consentSummary', () => {
  it('counts records, subjects and each status', () => {
    const now = at('2026-01-01');
    const summary = consentSummary([
      record({ contactId: 'a', source: 'newsletter', expiresAt: '2026-01-31' }),
      record({ contactId: 'a', source: 'events', expiresAt: '2025-01-01' }),
      record({ contactId: 'b', source: 'newsletter', expiresAt: null }),
    ], now);
    expect(summary).toEqual({ total: 3, active: 1, expiring: 1, expired: 1, subjects: 2, sources: 2 });
  });
});
