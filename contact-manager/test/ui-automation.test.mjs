// @vitest-environment jsdom
// The automation rule builder (#33): the list, the form, the dry run, and the
// save/remove.
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { makeAutomationDialog } from '../src/lib/automation-dialog.js';
import { readAutomation, saveRule } from '../src/lib/automation.js';
import { makeCard } from './fixtures.mjs';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));
const en = (key) => manifest.locales.en[key];
afterEach(cleanup);

const ADA = makeCard({ id: 'a', name: 'Ada Lovelace', emails: ['ada@example.org'], keywords: { maths: true } });
const GRACE = makeCard({ id: 'g', name: 'Grace Hopper', emails: ['grace@navy.mil'] });
const CARDS = [ADA, GRACE];
const BOOKS = new Map([['b1', 'Personal']]);

const automationApi = (handlers = {}) => fakeApi({ translations: manifest.locales, handlers });

async function renderDialog(api) {
  const rules = await readAutomation(api);
  const Dialog = makeAutomationDialog(React, api);
  await act(async () => {
    render(React.createElement(Dialog, { automationEditor: { rules, cards: CARDS, books: BOOKS }, onResult: () => {} }));
  });
}

describe('the automation rule builder', () => {
  it('says there are no rules yet', async () => {
    await renderDialog(automationApi());
    expect(screen.getByText(en('automation.empty'))).toBeTruthy();
  });

  it('saves a rule and shows it in the list', async () => {
    const api = automationApi();
    await renderDialog(api);

    await act(async () => { fireEvent.change(screen.getByLabelText(en('automation.name')), { target: { value: 'VIP' } }); });
    await act(async () => { fireEvent.change(screen.getByLabelText(en('automation.action.addTag')), { target: { value: 'vip' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en('automation.save') })); });

    await waitFor(() => expect(screen.getByText('VIP')).toBeTruthy());
    expect(api.storageSnapshot().automationRules).toEqual([
      expect.objectContaining({ name: 'VIP', actions: [{ type: 'addTag', value: 'vip' }] }),
    ]);
  });

  it('runs a dry run and shows how many contacts match', async () => {
    const api = automationApi();
    await renderDialog(api);

    await act(async () => {
      fireEvent.change(screen.getByLabelText(en('automation.condition')), { target: { value: 'tag:maths' } });
    });
    await act(async () => { fireEvent.change(screen.getByLabelText(en('automation.action.addTag')), { target: { value: 'vip' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en('automation.test') })); });

    await waitFor(() => expect(screen.getByText(en('automation.previewCount').replace('{count}', '1'))).toBeTruthy());
  });

  it('removes a rule', async () => {
    const api = automationApi();
    await saveRule(api, { id: 'r1', name: 'VIP', trigger: 'create', actions: [{ type: 'addTag', value: 'vip' }] });
    await renderDialog(api);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en('automation.remove') })); });

    await waitFor(() => expect(screen.getByText(en('automation.empty'))).toBeTruthy());
    expect(api.storageSnapshot().automationRules).toBeUndefined();
  });

  it('toggles a rule off', async () => {
    const api = automationApi();
    await saveRule(api, { id: 'r1', name: 'VIP', trigger: 'create', actions: [{ type: 'addTag', value: 'vip' }] });
    await renderDialog(api);

    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: en('automation.enabled') })); });

    await waitFor(() => expect(api.storageSnapshot().automationRules[0].enabled).toBe(false));
  });
});
