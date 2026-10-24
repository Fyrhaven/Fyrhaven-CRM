// @vitest-environment jsdom
// The bulk editor for a hand-picked selection: it only collects what to change.
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { makeBulkDialog } from '../src/lib/bulk-dialog.js';
import { makeCard } from './fixtures.mjs';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));
afterEach(cleanup);

const CARDS = [makeCard({ id: 'a', name: 'Ada Lovelace' }), makeCard({ id: 'b', name: 'Grace Hopper' })];
const BOOKS = [{ id: 'b1', name: 'Personal' }, { id: 'b2', name: 'Work' }];

async function open(props = {}) {
  const results = [];
  const api = fakeApi({ translations: manifest.locales });
  const Dialog = makeBulkDialog(React, api);
  await act(async () => {
    render(React.createElement(Dialog, {
      bulkEditor: { cards: CARDS, books: BOOKS },
      onResult: (value) => results.push(value),
      ...props,
    }));
  });
  return results;
}

describe('bulk dialog', () => {
  it('says how many contacts the change applies to', async () => {
    await open();
    expect(screen.getByText(/Applies to 2 contact\(s\)/)).toBeTruthy();
  });

  it('collects the tags to add and to remove', async () => {
    const results = await open();

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Add tags'), { target: { value: 'vip, client' } });
      fireEvent.change(screen.getByLabelText('Remove tags'), { target: { value: 'stale' } });
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Apply' })); });

    expect(results[0].tags).toEqual({ add: ['vip', 'client'], remove: ['stale'] });
  });

  it('collects the books to add to', async () => {
    const results = await open();

    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Work' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Apply' })); });

    expect(results[0].books).toEqual({ add: ['b2'], remove: [] });
  });

  it('collects the books to remove from, when that action is chosen', async () => {
    const results = await open();

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'remove' } });
      fireEvent.click(screen.getByRole('checkbox', { name: 'Personal' }));
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Apply' })); });

    expect(results[0].books).toEqual({ add: [], remove: ['b1'] });
  });

  it('does nothing when asked for nothing, and closes on cancel', async () => {
    const results = await open();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Apply' })); });
    expect(results).toEqual([]);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });
    expect(results).toEqual([null]);
  });

  it('says so when the account has no address books', async () => {
    await open({ bulkEditor: { cards: CARDS, books: [] } });
    expect(screen.getByText('No address books found.')).toBeTruthy();
  });
});
