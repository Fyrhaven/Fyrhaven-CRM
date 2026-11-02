// The Getting started guide (#39, the onboarding half): the first-run card on
// the Overview tab. It walks import → scan → review → policies once and then
// hides itself; the Overview menu re-opens it.
//
// The steps are guidance, not a second code path: every button here calls the
// shared action in lib/actions.js, the same code the palette and the menu run.

import { Badge, Button, Card, Heading, Row, Stack, Text } from '@plugin-host/ui';
import {
  STEPS, completeOnboarding, isFirstStep, isLastStep, nextStep, previousStep, stepIndex,
} from './onboarding.js';
import { findDuplicates, importContacts, managePolicies } from './actions.js';

export function makeOnboardingCard(React, api) {
  const { createElement: h, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  // The action a step offers, or null for the ones that only explain. One row
  // per step, so a new step is data rather than another render branch.
  const actionFor = (step) => {
    if (step === 'import') return { icon: 'upload', label: t('onboarding.importAction'), run: () => importContacts(api) };
    if (step === 'scan') return { icon: 'search', label: t('onboarding.scanAction'), run: () => findDuplicates(api) };
    if (step === 'policies') return { icon: 'shield', label: t('onboarding.policiesAction'), run: () => managePolicies(api) };
    return null;
  };

  return function OnboardingCard({ onFinished, onDataChanged } = {}) {
    const [step, setStep] = useState(STEPS[0]);
    const [busy, setBusy] = useState(false);
    const action = actionFor(step);
    const last = isLastStep(step);

    // Finishing (or skipping) writes the flag once and tells the page to stop
    // showing the card. The write is a by-product: a storage failure must not
    // trap the user in the guide.
    const finish = () => {
      completeOnboarding(api).catch(() => {});
      onFinished?.();
    };

    const runAction = async () => {
      setBusy(true);
      try {
        await action.run();
      } catch {
        // A step that failed (a refused dialog, a failed read) must not trap
        // the user in the guide — the action reported its own failure.
      } finally {
        setBusy(false);
      }
      onDataChanged?.();
      setStep(nextStep(step));
    };

    return h(Card, null,
      h(Stack, { gap: 3 },
        h(Row, { gap: 2 },
          h(Badge, { tone: 'primary' }, t('onboarding.progress', { step: stepIndex(step) + 1, total: STEPS.length })),
          h(Heading, { level: 3 }, t(`onboarding.${step}.title`))),
        h(Text, { tone: 'muted' }, t(`onboarding.${step}.body`)),
        h(Row, { gap: 2, wrap: true },
          !isFirstStep(step)
            ? h(Button, { size: 'sm', variant: 'ghost', onClick: () => setStep(previousStep(step)) }, t('onboarding.back'))
            : null,
          action
            ? h(Button, { size: 'sm', icon: action.icon, busy, onClick: () => void runAction() }, action.label)
            : null,
          last
            ? h(Button, { size: 'sm', onClick: finish }, t('onboarding.finish'))
            : h(Button, { size: 'sm', variant: 'secondary', onClick: () => setStep(nextStep(step)) }, t('onboarding.next')),
          !last
            ? h(Button, { size: 'sm', variant: 'ghost', onClick: finish }, t('onboarding.skip'))
            : null)));
  };
}
