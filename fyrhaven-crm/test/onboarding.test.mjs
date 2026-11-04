// The Getting started guide model (#39, the onboarding half): the step order,
// the storage round trip, and the two repairs.
import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_KEY, STEPS, completeOnboarding, isFirstStep, isLastStep, isStep,
  nextStep, normalizeOnboarding, previousStep, readOnboarding, resetOnboarding,
  stepIndex, writeOnboarding,
} from '../src/lib/onboarding.js';
import { fakeApi } from '../test-utils/fake-api.mjs';

describe('the step order', () => {
  it('walks welcome, import, scan, policies, done', () => {
    expect(STEPS).toEqual(['welcome', 'import', 'scan', 'policies', 'done']);
  });

  it('recognises a step, and reads an unknown one as the first', () => {
    expect(isStep('scan')).toBe(true);
    expect(isStep('nonsense')).toBe(false);
    expect(stepIndex('welcome')).toBe(0);
    expect(stepIndex('done')).toBe(4);
    expect(stepIndex('nonsense')).toBe(0);
  });

  it('marks the ends', () => {
    expect(isFirstStep('welcome')).toBe(true);
    expect(isFirstStep('import')).toBe(false);
    expect(isLastStep('done')).toBe(true);
    expect(isLastStep('policies')).toBe(false);
  });

  it('advances and retreats, and stays put at either end', () => {
    expect(nextStep('welcome')).toBe('import');
    expect(nextStep('done')).toBe('done');
    expect(previousStep('import')).toBe('welcome');
    expect(previousStep('welcome')).toBe('welcome');
  });
});

describe('normalizeOnboarding', () => {
  it('returns not-done for junk input', () => {
    expect(normalizeOnboarding(null)).toEqual({ done: false, at: null });
    expect(normalizeOnboarding('nope')).toEqual({ done: false, at: null });
    expect(normalizeOnboarding([])).toEqual({ done: false, at: null });
  });

  it('keeps a real done flag and a real date, and drops the rest', () => {
    expect(normalizeOnboarding({ done: true, at: '2026-01-01T00:00:00Z', extra: 1 }))
      .toEqual({ done: true, at: '2026-01-01T00:00:00Z' });
    expect(normalizeOnboarding({ done: true, at: '  ' })).toEqual({ done: true, at: null });
  });

  it('only trusts `done === true`', () => {
    expect(normalizeOnboarding({ done: 'yes' }).done).toBe(false);
    expect(normalizeOnboarding({}).done).toBe(false);
  });
});

describe('readOnboarding / writeOnboarding', () => {
  it('reads an empty store as not done', async () => {
    const api = fakeApi();
    expect(await readOnboarding(api)).toEqual({ done: false, at: null });
  });

  it('round-trips a finished state', async () => {
    const api = fakeApi();
    await writeOnboarding(api, { done: true, at: '2026-01-01T00:00:00Z' });
    expect(await readOnboarding(api)).toEqual({ done: true, at: '2026-01-01T00:00:00Z' });
  });

  it('removes the key when the state is not done', async () => {
    const api = fakeApi();
    await writeOnboarding(api, { done: false, at: null });
    expect(await api.storage.get(ONBOARDING_KEY)).toBeNull();
  });

  it('rewrites storage when junk was dropped', async () => {
    const api = fakeApi();
    await api.storage.set(ONBOARDING_KEY, { done: true, at: '2026-01-01T00:00:00Z', junk: 1 });
    expect(await readOnboarding(api)).toEqual({ done: true, at: '2026-01-01T00:00:00Z' });
    expect(await api.storage.get(ONBOARDING_KEY)).toEqual({ done: true, at: '2026-01-01T00:00:00Z' });
  });

  it('removes a stored not-done record rather than keeping it', async () => {
    const api = fakeApi();
    await api.storage.set(ONBOARDING_KEY, { done: false, junk: 1 });
    expect(await readOnboarding(api)).toEqual({ done: false, at: null });
    expect(await api.storage.get(ONBOARDING_KEY)).toBeNull();
  });

  it('reads a non-object as not done without touching it', async () => {
    const api = fakeApi();
    await api.storage.set(ONBOARDING_KEY, 'garbage');
    expect(await readOnboarding(api)).toEqual({ done: false, at: null });
    expect(await api.storage.get(ONBOARDING_KEY)).toBe('garbage');
  });
});

describe('completeOnboarding / resetOnboarding', () => {
  it('finishing records done and a date', async () => {
    const api = fakeApi();
    await completeOnboarding(api, '2026-02-02T10:00:00Z');
    expect(await readOnboarding(api)).toEqual({ done: true, at: '2026-02-02T10:00:00Z' });
  });

  it('resetting forgets it, so the guide opens again', async () => {
    const api = fakeApi();
    await completeOnboarding(api);
    expect((await readOnboarding(api)).done).toBe(true);
    await resetOnboarding(api);
    expect(await readOnboarding(api)).toEqual({ done: false, at: null });
    expect(await api.storage.get(ONBOARDING_KEY)).toBeNull();
  });
});
