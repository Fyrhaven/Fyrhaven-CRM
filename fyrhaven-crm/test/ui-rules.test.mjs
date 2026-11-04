// @vitest-environment jsdom
// The normalisation rules dialog: picking the rules, previewing the exact edits
// and storing the choice.
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { makeRulesDialog } from '../src/lib/rules-dialog.js';
import { makeCard } from './fixtures.mjs';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));
afterEach(cleanup);

const CARDS = [
  makeCard({
    id: 'a',
    name: 'ADA   LOVELACE',
    emails: ['ada@example.org'],
    organizations: { o0: { name: 'ACME Inc.' } },
  }),
];

const rulesApi = (handlers = {}) => fakeApi({ translations: manifest.locales, handlers });

async function renderDialog(api, setup = {}) {
  const Dialog = makeRulesDialog(React, api);
  const box = { result: null };
  await act(async () => {
    render(React.createElement(Dialog, {
      rulesEditor: {
        cards: setup.cards ?? CARDS,
        rules: setup.rules ?? [],
        region: setup.region ?? '',
      },
      onResult: (value) => { box.result = value; },
    }));
  });
  return box;
}

describe('the rules dialog', () => {
  it('plans nothing, and cannot apply, until a rule is on', async () => {
    await renderDialog(rulesApi());

    expect(screen.getByText('Nothing would change in the 1 contact(s) in scope.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply rules' }).disabled).toBe(true);
    expect(screen.getByText('No rules of your own yet.')).toBeTruthy();
  });

  it('previews the exact edits of a built-in rule', async () => {
    await renderDialog(rulesApi());

    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'Title-case shouting names' }));
    });

    expect(screen.getByText('1 contact(s) · 1 change(s)')).toBeTruthy();
    // the name the contact has now, and the name it would get. The matcher is
    // compared against the whitespace-normalised text, so the runs collapse.
    expect(screen.getAllByText('ADA LOVELACE').length).toBeGreaterThan(1);
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply rules' }).disabled).toBe(false);
  });

  it('adds a rule of your own and lists it', async () => {
    await renderDialog(rulesApi());

    await act(async () => { fireEvent.change(screen.getByLabelText('Field'), { target: { value: 'organization' } }); });
    await act(async () => { fireEvent.change(screen.getByLabelText('Find'), { target: { value: 'ACME' } }); });
    await act(async () => { fireEvent.change(screen.getByLabelText('Replace with'), { target: { value: 'Acme' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add rule' })); });

    expect(screen.getByText('Organisation: ACME → Acme')).toBeTruthy();
    expect(screen.getByText('1 contact(s) · 1 change(s)')).toBeTruthy();
  });

  it('will not add a rule with nothing to find', async () => {
    await renderDialog(rulesApi());
    expect(screen.getByRole('button', { name: 'Add rule' }).disabled).toBe(true);
  });

  it('stores the chosen rules and returns the plan', async () => {
    const api = rulesApi();
    const box = await renderDialog(api);

    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'Title-case shouting names' }));
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Apply rules' })); });

    expect(await api.storage.get('normalizeRules'))
      .toEqual([{ id: 'name.case', field: 'name', builtin: true }]);
    expect(box.result.plan).toHaveLength(1);
    expect(box.result.plan[0].patch.name.full).toBe('Ada Lovelace');
  });

  it('shows a stored rule and removes it again', async () => {
    const api = rulesApi();
    await renderDialog(api, { rules: [{ id: 'r1', field: 'organization', from: 'ACME', to: 'Acme' }] });

    expect(screen.getByText('Organisation: ACME → Acme')).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove' })); });

    expect(screen.queryByText('Organisation: ACME → Acme')).toBeNull();
    expect(screen.getByText('No rules of your own yet.')).toBeTruthy();
  });
});
