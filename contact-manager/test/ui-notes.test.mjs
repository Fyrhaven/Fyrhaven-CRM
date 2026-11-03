// @vitest-environment jsdom
// The private-notes section on a contact's profile (#38, the private half):
// adding, rendering the marks, deleting, and that it never writes on its own.
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { makeNotesSection } from '../src/lib/notes-section.js';
import { readNotes } from '../src/lib/notes.js';
import { makeCard } from './fixtures.mjs';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));
const en = () => manifest.locales.en;
afterEach(cleanup);

const ADA = makeCard({ id: 'a', name: 'Ada Lovelace', emails: ['ada@example.org'] });
const GRACE = makeCard({ id: 'g', name: 'Grace Hopper' });

function sectionApi(handlers = {}) {
  return fakeApi({ translations: manifest.locales, handlers });
}

async function renderSection(api, contact = ADA) {
  const Notes = makeNotesSection(React, api);
  await act(async () => {
    render(React.createElement(Notes, { contact, revision: 0 }));
  });
  await waitFor(() => expect(screen.getByText(en()['notes.title'])).toBeTruthy());
}

const type = async (value) => {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(en()['notes.label']), { target: { value } });
  });
};
const click = async (name) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name })); }); };

describe('private notes section', () => {
  it('says so when there is nothing yet', async () => {
    await renderSection(sectionApi());

    expect(screen.getByText(en()['notes.empty'])).toBeTruthy();
  });

  it('stores a note the user types and shows it back', async () => {
    const api = sectionApi();
    await renderSection(api);

    await type('Called about the engine');
    await click(en()['notes.add']);

    await waitFor(() => expect(screen.getByText('Called about the engine')).toBeTruthy());
    const store = await readNotes(api);
    expect(store.a.map((note) => note.text)).toEqual(['Called about the engine']);
  });

  it('writes nothing for an empty box', async () => {
    const api = sectionApi();
    await renderSection(api);

    await type('   ');
    await click(en()['notes.add']);

    expect(screen.getByText(en()['notes.empty'])).toBeTruthy();
    expect(await readNotes(api)).toEqual({});
  });

  it('renders the marks a note uses, as elements and never as markup', async () => {
    const api = sectionApi();
    await api.storage.set('contactNotes', {
      a: [{ id: 'n1', at: '2026-01-01T00:00:00Z', text: 'Called **Ada** about @ada at `noon`' }],
    });
    await renderSection(api);

    expect(screen.getByText('Ada').tagName).toBe('STRONG');
    expect(screen.getByText('noon').tagName).toBe('CODE');
    expect(screen.getByText('@ada')).toBeTruthy();
  });

  it('shows only the notes about the contact that is open', async () => {
    const api = sectionApi();
    await api.storage.set('contactNotes', {
      a: [{ id: 'n1', at: '2026-01-01T00:00:00Z', text: 'about Ada' }],
      g: [{ id: 'n2', at: '2026-01-01T00:00:00Z', text: 'about Grace' }],
    });

    await renderSection(api, ADA);
    expect(screen.getByText('about Ada')).toBeTruthy();
    expect(screen.queryByText('about Grace')).toBeNull();

    cleanup();
    await renderSection(api, GRACE);
    expect(screen.getByText('about Grace')).toBeTruthy();
    expect(screen.queryByText('about Ada')).toBeNull();
  });

  it('deletes a note', async () => {
    const api = sectionApi();
    await api.storage.set('contactNotes', {
      a: [{ id: 'n1', at: '2026-01-01T00:00:00Z', text: 'gone soon' }],
    });
    await renderSection(api);

    await click(en()['notes.delete']);

    await waitFor(() => expect(screen.getByText(en()['notes.empty'])).toBeTruthy());
    expect(await readNotes(api)).toEqual({});
  });

  it('says when a note could not be saved, rather than swallowing it', async () => {
    const api = sectionApi();
    await renderSection(api);
    api.storage.set = async () => { throw new Error('refused'); };

    await type('this will not save');
    await click(en()['notes.add']);

    await waitFor(() => expect(api.calls('ui.alert')).toHaveLength(1));
    // and the box keeps the text, so the user does not lose it
    expect(screen.getByLabelText(en()['notes.label']).value).toBe('this will not save');
  });
});
