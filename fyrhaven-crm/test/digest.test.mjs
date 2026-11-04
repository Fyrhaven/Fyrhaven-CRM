// The duplicate digest (#5, the half that needs no host timer): the window, the
// baseline, and exactly when it is worth saying something.
import { describe, expect, it } from 'vitest';
import { fakeApi } from '../test-utils/fake-api.mjs';
import {
  DIGEST_KEY, MAX_ACKNOWLEDGED, acknowledge, buildDigest, digestWindowDays, forgetDigest,
  groupSignatures, isScanStale, readDigestState, unseenSignatures,
} from '../src/lib/digest.js';

const DAY = 24 * 3600 * 1000;
const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);

describe('digestWindowDays', () => {
  it('reads the setting, and 0 or junk means off', () => {
    expect(digestWindowDays({ digestDays: 7 })).toBe(7);
    expect(digestWindowDays({ digestDays: 1 })).toBe(1);
    expect(digestWindowDays({ digestDays: 3.9 })).toBe(3);
    expect(digestWindowDays({ digestDays: 0 })).toBe(0);
    expect(digestWindowDays({ digestDays: -5 })).toBe(0);
    expect(digestWindowDays({ digestDays: 'weekly' })).toBe(0);
    expect(digestWindowDays({})).toBe(0);
    expect(digestWindowDays()).toBe(0);
  });
});

describe('groupSignatures', () => {
  it('takes each group’s signature, sorted, and drops junk', () => {
    expect(groupSignatures([{ signature: 'b' }, { signature: 'a' }, { signature: '' }, {}, null]))
      .toEqual(['a', 'b']);
    expect(groupSignatures(null)).toEqual([]);
  });
});

describe('unseenSignatures', () => {
  it('is the difference against what was acknowledged', () => {
    expect(unseenSignatures(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']);
    expect(unseenSignatures(['a'], [])).toEqual(['a']);
    expect(unseenSignatures(null, ['a'])).toEqual([]);
  });
});

describe('isScanStale', () => {
  it('is true from the window onwards, and makes no claim without a scan', () => {
    expect(isScanStale(NOW - 7 * DAY, 7, NOW)).toBe(true);
    expect(isScanStale(NOW - 7 * DAY + 1, 7, NOW)).toBe(false);
    expect(isScanStale(NOW - 30 * DAY, 7, NOW)).toBe(true);
    // never scanned, or the digest off: no alarm about a scan that does not exist
    expect(isScanStale(NaN, 7, NOW)).toBe(false);
    expect(isScanStale(NOW - 30 * DAY, 0, NOW)).toBe(false);
  });
});

describe('buildDigest', () => {
  const base = { signatures: ['g1'], acknowledged: ['g1'], baseline: true, days: 7, now: NOW, at: NOW - DAY };

  it('says nothing when the digest is off', () => {
    expect(buildDigest({ ...base, days: 0, at: NOW - 30 * DAY })).toBeNull();
  });

  it('says nothing when the scan is fresh and nothing changed', () => {
    expect(buildDigest(base)).toBeNull();
  });

  it('reports a scan older than the window', () => {
    expect(buildDigest({ ...base, at: NOW - 8 * DAY }))
      .toMatchObject({ stale: true, changed: false, count: 1, fresh: 0 });
  });

  it('reports groups the user has not been shown', () => {
    expect(buildDigest({ ...base, signatures: ['g1', 'g2'] }))
      .toMatchObject({ stale: false, changed: true, fresh: 1, count: 2 });
  });

  it('reports both at once', () => {
    expect(buildDigest({ ...base, at: NOW - 8 * DAY, signatures: ['g1', 'g2'] }))
      .toMatchObject({ stale: true, changed: true, fresh: 1, count: 2 });
  });

  it('does not call the first look a change: without a baseline nothing is new', () => {
    expect(buildDigest({ ...base, baseline: false, acknowledged: [], signatures: ['g1', 'g2'] })).toBeNull();
  });

  it('does not repeat a staleness nag the user has already been told about', () => {
    // told at or after the scan that is now old: acknowledged, not forgotten
    expect(buildDigest({ ...base, at: NOW - 8 * DAY, seenAt: NOW - 8 * DAY })).toBeNull();
    expect(buildDigest({ ...base, at: NOW - 8 * DAY, seenAt: NOW })).toBeNull();
    // told before that scan ran: this scan's age has not been mentioned yet
    expect(buildDigest({ ...base, at: NOW - 8 * DAY, seenAt: NOW - 20 * DAY }))
      .toMatchObject({ stale: true });
  });

  it('carries the scan date and the date the user was last shown', () => {
    const digest = buildDigest({ ...base, at: NOW - 8 * DAY, seenAt: NOW - 20 * DAY });
    expect(digest.at).toBe(NOW - 8 * DAY);
    expect(digest.seenAt).toBe(NOW - 20 * DAY);
  });

  it('survives nothing at all', () => {
    expect(buildDigest()).toBeNull();
    expect(buildDigest({ days: 7 })).toBeNull();
  });
});

describe('the acknowledged baseline', () => {
  it('is absent until something is acknowledged', async () => {
    const api = fakeApi({});
    expect(await readDigestState(api)).toEqual({ baseline: false, at: null, signatures: [] });
  });

  it('remembers what the user was shown, sorted and de-duplicated', async () => {
    const api = fakeApi({});
    expect(await acknowledge(api, ['b', 'a', 'b', '', null], NOW)).toEqual(['a', 'b']);
    expect(await readDigestState(api)).toEqual({ baseline: true, at: NOW, signatures: ['a', 'b'] });
  });

  it('keeps an empty baseline, so the next duplicate is still new', async () => {
    const api = fakeApi({});
    await acknowledge(api, [], NOW);
    const state = await readDigestState(api);
    expect(state.baseline).toBe(true);
    expect(state.signatures).toEqual([]);
    // that empty baseline is exactly what makes a later group reportable
    expect(buildDigest({
      days: 7, now: NOW, at: NOW, baseline: state.baseline, signatures: ['g9'], acknowledged: state.signatures,
    })).toMatchObject({ changed: true, fresh: 1 });
  });

  it('caps what it keeps, so a huge book stays bounded', async () => {
    const api = fakeApi({});
    const many = Array.from({ length: MAX_ACKNOWLEDGED + 50 }, (_, i) => `g${String(i).padStart(5, '0')}`);
    expect(await acknowledge(api, many, NOW)).toHaveLength(MAX_ACKNOWLEDGED);
  });

  it('repairs junk on the way in', async () => {
    const api = fakeApi({});
    await api.storage.set(DIGEST_KEY, { at: 'not a date', signatures: ['a', 3, null, 'a'] });
    expect(await readDigestState(api)).toEqual({ baseline: true, at: null, signatures: ['a'] });
    // an array is not the shape we write, so it is not a baseline
    await api.storage.set(DIGEST_KEY, ['a']);
    expect(await readDigestState(api)).toEqual({ baseline: false, at: null, signatures: [] });
  });

  it('can be forgotten', async () => {
    const api = fakeApi({});
    await acknowledge(api, ['a'], NOW);
    await forgetDigest(api);
    expect(await readDigestState(api)).toEqual({ baseline: false, at: null, signatures: [] });
  });
});
