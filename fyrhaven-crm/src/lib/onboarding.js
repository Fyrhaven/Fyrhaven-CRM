// The first-run "Getting started" guide (#39, the onboarding half).
//
// A new install should not have to guess the order of things — import, scan,
// review, set policies. The guide walks that order once and then stays out of
// the way; it is re-openable from the Overview menu at any time.
//
// Pure model plus api.storage — no DOM. The UI is onboarding-card.js.

export const ONBOARDING_KEY = 'onboarding';

/** The steps, in order. `done` is the last one; it has no action but Finish. */
export const STEPS = ['welcome', 'import', 'scan', 'policies', 'done'];

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** Is this one of the steps? */
export function isStep(value) {
  return STEPS.includes(value);
}

/** The position of a step, or 0 for an unknown one. */
export function stepIndex(step) {
  const index = STEPS.indexOf(step);
  return index < 0 ? 0 : index;
}

export function isFirstStep(step) {
  return stepIndex(step) === 0;
}

export function isLastStep(step) {
  return stepIndex(step) === STEPS.length - 1;
}

/** The next step; the last step has no next, so it stays. */
export function nextStep(step) {
  return STEPS[Math.min(stepIndex(step) + 1, STEPS.length - 1)];
}

/** The previous step; the first step has no previous, so it stays. */
export function previousStep(step) {
  return STEPS[Math.max(stepIndex(step) - 1, 0)];
}

/** The stored state, repaired: `{ done, at }` and nothing else. */
export function normalizeOnboarding(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { done: false, at: null };
  const at = text(raw.at);
  return { done: raw.done === true, at: at || null };
}

/** Read the stored state; rewrites when junk was dropped. */
export async function readOnboarding(api) {
  const stored = await api.storage.get(ONBOARDING_KEY);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return { done: false, at: null };
  }
  const state = normalizeOnboarding(stored);
  if (JSON.stringify(state) !== JSON.stringify(stored)) {
    if (state.done) await api.storage.set(ONBOARDING_KEY, state);
    else await api.storage.remove(ONBOARDING_KEY);
  }
  return state;
}

/** Write the state. A state that is not `done` removes the key. */
export async function writeOnboarding(api, state) {
  const clean = normalizeOnboarding(state);
  if (clean.done) await api.storage.set(ONBOARDING_KEY, clean);
  else await api.storage.remove(ONBOARDING_KEY);
  return clean;
}

/** Mark the guide finished, so it does not open again on its own. */
export async function completeOnboarding(api, at = new Date().toISOString()) {
  return writeOnboarding(api, { done: true, at });
}

/** Forget that the guide was finished — the next read shows it again. */
export async function resetOnboarding(api) {
  await api.storage.remove(ONBOARDING_KEY);
  return { done: false, at: null };
}
