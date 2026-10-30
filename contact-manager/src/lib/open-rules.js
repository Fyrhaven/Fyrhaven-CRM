// One place that opens the rules dialog and applies what it returned, so the
// Contacts selection and the command palette behave the same way. The dialog
// stores the rules; applying the plan goes through `normalise.js`, so a rules
// batch is rolled back by the same *Undo cleanup* the cleanup uses.
import { loadCards } from './contacts.js';
import { applyNormalisation } from './normalise.js';
import { readRegion } from './region.js';
import { readRules } from './rules.js';

/**
 * Opens the rules dialog. `cards` defaults to every contact, which is what the
 * command palette's *Normalisation rules* asks for.
 */
export async function openRules(api, { cards = null } = {}) {
  const [rules, region, list] = await Promise.all([
    readRules(api),
    readRegion(api),
    cards ? Promise.resolve(cards) : loadCards(api).catch(() => []),
  ]);
  return api.ui.openDialog({
    title: api.i18n.t('rules.title'),
    slot: 'plugin-dialog',
    extraProps: { rulesEditor: { cards: Array.isArray(list) ? list : [], rules, region } },
  });
}

/** Applies a dialog result and toasts the outcome. Null when it was cancelled. */
export async function applyRulesResult(api, result) {
  if (!result) return null;
  const outcome = await applyNormalisation(api, result.plan);
  if (outcome.failed) {
    api.toast.warning(api.i18n.t('rules.appliedPartial', { updated: outcome.updated, failed: outcome.failed }));
  } else if (outcome.updated) {
    api.toast.success(api.i18n.t('rules.applied', { updated: outcome.updated }));
  } else {
    api.toast.info(api.i18n.t('rules.appliedNone'));
  }
  return outcome;
}

/** The palette action: rules over every contact. */
export async function runRules(api) {
  return applyRulesResult(api, await openRules(api));
}
