// @vitest-environment jsdom
// The Help dialog (#39): the operator cheatsheet, the examples, the keyboard
// shortcuts and what's new — and that closing returns nothing.
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { makeHelpDialog } from '../src/lib/help-dialog.js';
import {
  HAS_VALUES, IS_VALUES_LIST, QUERY_EXAMPLES, QUERY_OPERATORS, SHORTCUTS, WHATS_NEW,
} from '../src/lib/help.js';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));
const en = () => manifest.locales.en;
const fill = (key, vars) => en()[key].replace(/\{(\w+)\}/g, (match, name) => (
  vars && name in vars ? String(vars[name]) : match
));

afterEach(cleanup);

function renderDialog() {
  const api = fakeApi({ translations: manifest.locales });
  const Dialog = makeHelpDialog(React, api);
  const state = { result: undefined };
  act(() => {
    render(React.createElement(Dialog, { help: true, onResult: (value) => { state.result = value; } }));
  });
  return state;
}

describe('help dialog', () => {
  it('shows every field operator the box understands', () => {
    renderDialog();

    for (const entry of QUERY_OPERATORS) {
      expect(screen.getByText(entry.token)).toBeTruthy();
    }
  });

  it('shows the has: and is: values', () => {
    renderDialog();

    expect(screen.getByText(fill('help.hasValues', { values: HAS_VALUES.join(', ') }))).toBeTruthy();
    expect(screen.getByText(fill('help.isValues', { values: IS_VALUES_LIST.join(', ') }))).toBeTruthy();
  });

  it('shows the worked examples', () => {
    renderDialog();

    for (const example of QUERY_EXAMPLES) {
      expect(screen.getByText(example)).toBeTruthy();
    }
  });

  it('shows the keyboard shortcuts and what each does', () => {
    renderDialog();

    for (const shortcut of SHORTCUTS) {
      expect(screen.getByText(shortcut.keys.join(' + '))).toBeTruthy();
      expect(screen.getByText(en()[shortcut.label])).toBeTruthy();
    }
  });

  it("shows what's new, with a note for each version", () => {
    renderDialog();

    for (const entry of WHATS_NEW) {
      expect(screen.getByText(fill('help.version', { version: entry.version }))).toBeTruthy();
      expect(screen.getByText(en()[entry.note])).toBeTruthy();
    }
  });

  it('closing returns nothing', () => {
    const state = renderDialog();

    act(() => { fireEvent.click(screen.getByRole('button', { name: en()['help.close'] })); });

    expect(state.result).toBeNull();
  });
});
