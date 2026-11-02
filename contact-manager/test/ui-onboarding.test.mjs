// @vitest-environment jsdom
// The Getting started guide card (#39, the onboarding half): it walks the
// steps, runs the same actions the palette does, and records that it is done.
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { makeOnboardingCard } from '../src/lib/onboarding-card.js';
import { makeCard } from './fixtures.mjs';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));
afterEach(cleanup);

const en = () => manifest.locales.en;

const ADA = makeCard({ id: 'a', name: 'Ada Lovelace', emails: ['ada@example.org'] });
const TWIN = makeCard({ id: 'b', name: 'A. Lovelace', emails: ['ada@example.org'] });

function guideApi(handlers = {}) {
  return fakeApi({
    translations: manifest.locales,
    handlers: {
      'contacts.list': async () => [ADA, TWIN],
      'addressBooks.list': async () => [{ id: 'b1', name: 'Personal' }],
      'ui.openDialog': async () => null,
      ...handlers,
    },
  });
}

async function renderGuide(api) {
  const Card = makeOnboardingCard(React, api);
  const state = { finished: 0, changed: 0 };
  await act(async () => {
    render(React.createElement(Card, {
      onFinished: () => { state.finished += 1; },
      onDataChanged: () => { state.changed += 1; },
    }));
  });
  return state;
}

const click = async (name) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name })); }); };
const progress = (n) => screen.getByText(en()['onboarding.progress']
  .replace('{step}', String(n)).replace('{total}', '5'));

describe('the Getting started guide', () => {
  it('starts on welcome, with a progress badge and no Back button', async () => {
    await renderGuide(guideApi());

    expect(progress(1)).toBeTruthy();
    expect(screen.getByText(en()['onboarding.welcome.title'])).toBeTruthy();
    expect(screen.queryByRole('button', { name: en()['onboarding.back'] })).toBeNull();
  });

  it('walks forward and back through the steps', async () => {
    await renderGuide(guideApi());

    await click(en()['onboarding.next']);
    expect(progress(2)).toBeTruthy();

    await click(en()['onboarding.back']);
    expect(progress(1)).toBeTruthy();
  });

  it('opens the import wizard from the import step, then advances', async () => {
    const api = guideApi();
    await renderGuide(api);
    await click(en()['onboarding.next']); // to import

    await click(en()['onboarding.importAction']);

    await waitFor(() => expect(api.calls('ui.openDialog')).toHaveLength(1));
    expect(api.calls('ui.openDialog')[0].args[0].extraProps.importWizard).toBe(true);
    await waitFor(() => expect(progress(3)).toBeTruthy());
  });

  it('scans and opens the review dialog from the scan step', async () => {
    const api = guideApi();
    await renderGuide(api);
    await click(en()['onboarding.next']); // import
    await click(en()['onboarding.next']); // scan

    await click(en()['onboarding.scanAction']);

    await waitFor(() => expect(api.calls('ui.openDialog')).toHaveLength(1));
    const groups = api.calls('ui.openDialog')[0].args[0].extraProps.groups;
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((member) => member.id).sort()).toEqual(['a', 'b']);
    await waitFor(() => expect(progress(4)).toBeTruthy());
  });

  it('opens the policies dialog from the policies step', async () => {
    const api = guideApi();
    await renderGuide(api);
    await click(en()['onboarding.next']); // import
    await click(en()['onboarding.next']); // scan
    await click(en()['onboarding.next']); // policies

    await click(en()['onboarding.policiesAction']);

    await waitFor(() => expect(api.calls('ui.openDialog')).toHaveLength(1));
    expect(api.calls('ui.openDialog')[0].args[0].extraProps.policiesDialog).toBe(true);
    expect(api.calls('ui.openDialog')[0].args[0].extraProps.books).toEqual([{ id: 'b1', name: 'Personal' }]);
    await waitFor(() => expect(progress(5)).toBeTruthy());
  });

  it('finishes on the last step and records it', async () => {
    const api = guideApi();
    const state = await renderGuide(api);
    for (let i = 0; i < 4; i++) await click(en()['onboarding.next']);

    expect(progress(5)).toBeTruthy();
    expect(screen.queryByRole('button', { name: en()['onboarding.next'] })).toBeNull();

    await click(en()['onboarding.finish']);

    expect(state.finished).toBe(1);
    await waitFor(() => expect(api.storage.get('onboarding')).resolves.toMatchObject({ done: true }));
  });

  it('skips the guide from any step and records it', async () => {
    const api = guideApi();
    const state = await renderGuide(api);

    await click(en()['onboarding.skip']);

    expect(state.finished).toBe(1);
    await waitFor(() => expect(api.storage.get('onboarding')).resolves.toMatchObject({ done: true }));
  });

  it('tells the page a task ran, so its numbers refresh', async () => {
    const api = guideApi();
    const state = await renderGuide(api);
    await click(en()['onboarding.next']); // import

    await click(en()['onboarding.importAction']);

    await waitFor(() => expect(state.changed).toBe(1));
  });

  it('advances even when a step action throws, so the guide never traps the user', async () => {
    const api = guideApi({ 'ui.openDialog': async () => { throw new Error('refused'); } });
    await renderGuide(api);
    await click(en()['onboarding.next']); // import

    await click(en()['onboarding.importAction']); // the dialog refuses

    await waitFor(() => expect(progress(3)).toBeTruthy());
  });
});
