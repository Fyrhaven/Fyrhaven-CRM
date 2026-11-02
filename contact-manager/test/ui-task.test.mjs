// @vitest-environment jsdom
// The follow-up task editor (#36): the prefilled title, the priority suffix, the
// due-date rule, the validation, and that it returns a draft and writes nothing.
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { makeTaskDialog } from '../src/lib/task-dialog.js';
import { makeCard } from './fixtures.mjs';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));
const en = () => manifest.locales.en;
afterEach(cleanup);

const ADA = makeCard({ id: 'a', name: 'Ada Lovelace', emails: ['ada@example.org'] });

function openDialog(contact = ADA) {
  const api = fakeApi({ translations: manifest.locales });
  const Dialog = makeTaskDialog(React, api);
  const state = { result: undefined };
  act(() => {
    render(React.createElement(Dialog, { taskEditor: { contact }, contact, onResult: (v) => { state.result = v; } }));
  });
  return { api, state };
}

const save = async () => { await act(async () => { fireEvent.click(screen.getByText(en()['tasks.save'])); }); };

describe('follow-up task dialog', () => {
  it('prefills the title from the contact', () => {
    openDialog();

    expect(screen.getByLabelText(en()['tasks.titleLabel']).value).toBe('Follow up with Ada Lovelace');
  });

  it('returns a draft carrying the contact in its description', async () => {
    const { state } = openDialog();

    await save();

    expect(state.result).toEqual({
      draft: { title: 'Follow up with Ada Lovelace', description: 'ada@example.org' },
    });
  });

  it('writes the priority into the title when it is not normal', async () => {
    const { state } = openDialog();

    await act(async () => {
      fireEvent.change(screen.getByLabelText(en()['tasks.priorityLabel']), { target: { value: 'high' } });
    });
    await save();

    expect(state.result.draft.title).toBe('Follow up with Ada Lovelace \u00b7 High');
  });

  it('includes the due date only when one is picked', async () => {
    const { state } = openDialog();

    await act(async () => {
      fireEvent.change(screen.getByLabelText(en()['tasks.dueLabel']), { target: { value: '2026-12-01' } });
    });
    await save();

    expect(state.result.draft.due).toBe('2026-12-01');
  });

  it('leaves the due date off when it is not set', async () => {
    const { state } = openDialog();

    await save();

    expect(state.result.draft).not.toHaveProperty('due');
  });

  it('puts the notes after the contact line', async () => {
    const { state } = openDialog();

    await act(async () => {
      fireEvent.change(screen.getByLabelText(en()['tasks.notesLabel']), { target: { value: 'ask about the engine' } });
    });
    await save();

    expect(state.result.draft.description).toBe('ada@example.org\nask about the engine');
  });

  it('will not submit an empty title, and says why', async () => {
    const { state } = openDialog();

    await act(async () => {
      fireEvent.change(screen.getByLabelText(en()['tasks.titleLabel']), { target: { value: '   ' } });
    });
    await save();

    expect(state.result).toBeUndefined(); // it did not close
    expect(screen.getByRole('alert').textContent).toBe(en()['tasks.titleRequired']);
  });

  it('cancel returns nothing', async () => {
    const { state } = openDialog();

    await act(async () => { fireEvent.click(screen.getByText(en()['dialog.cancel'])); });

    expect(state.result).toBeNull();
  });
});
